#!/usr/bin/env node
// Generate Eldmoor's image assets (#177) from scripts/art/manifest.json through Hugging Face Inference Providers.
// The daily, quota-driven run is scripts/art/daily.mjs (npm run art:daily); this is the direct tool:
//
//   npm run art:gen                    plan only: what is missing, how many images, estimated cost; then stops
//   npm run art:gen -- --yes           generate every missing asset straight into assets/ (no review step)
//   npm run art:gen -- --yes --max 3   at most 3 images this run
//   npm run art:gen -- --only tile:grass,tile:snow --force --yes   regenerate these even if present
//   npm run art:gen -- --dry-run       print the plan and the request of the first image, call nothing
//   --model KEY                        a key of the manifest's models (default: the pinned model, else the first candidate)
//
// Each image: prompt -> the model's provider (fal-ai for the pixel-art LoRAs) -> PNG -> post-processing
// (scripts/art/post.mjs: background, downscale to the pixel grid, quantise to src/render/palette.js colours, outline)
// -> assets/<kind>/<name>.png, and assets/index.json gets {id, kind, file, w, h, sha256, model, repo, provider, seed, at}.
// The index is written after every image, so an interrupted run keeps what it made.
//
// The token: HF_TOKEN in the environment or in .env / .env.local at the repo root (gitignored). It is read here only,
// sent only to the Hugging Face router, never printed, and no paid option (no bill-to header, no provider key) is ever
// sent. Nothing under src/ sees it. Env for tests: HF_ROUTER_URL (default https://router.huggingface.co), HF_HUB_URL
// (default https://huggingface.co).
import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {ROOT,MANIFEST,ASSETS,loadManifest,loadIndex,fileOf,sha256,validateManifest} from './lib.mjs';
import {decodePng,encodePng} from './png.mjs';
import {resolvePalette,postProcess} from './post.mjs';

export function parseArgs(argv,valued){const o={_:[]};for(let i=0;i<argv.length;i++){const a=argv[i];if(!a.startsWith('--')){o._.push(a);continue}const k=a.slice(2);
  if(valued.includes(k)){o[k]=argv[i+1];i++}else o[k]=true}return o}

// Only HF_TOKEN is read from the .env files; every other line is left alone.
export function hfToken(env=process.env){if(env.HF_TOKEN)return env.HF_TOKEN;
  for(const f of ['.env.local','.env']){const p=join(ROOT,f);if(!existsSync(p))continue;
    for(const line of readFileSync(p,'utf8').split(/\r?\n/)){const m=line.match(/^\s*HF_TOKEN\s*=\s*(.*?)\s*$/);if(m&&m[1])return m[1].replace(/^["']|["']$/g,'')}}
  return ''}

const ROUTER=()=>(process.env.HF_ROUTER_URL||'https://router.huggingface.co').replace(/\/$/,'');
const HUB=()=>(process.env.HF_HUB_URL||'https://huggingface.co').replace(/\/$/,'');
export const SUPPORTED=['fal-ai','hf-inference']; // providers whose request body this script knows

// An error with a class the daily run acts on: quota (allowance used: stop for today), auth (stop), rate (stop),
// model (this model or route does not work: try the next candidate), transient (5xx, timeout: next asset), image.
export class ArtError extends Error{constructor(kind,msg,status){super(msg);this.kind=kind;this.status=status}}

// Which provider serves a model, under which id, and its LoRA file. The manifest may pin it; otherwise the public
// Hub API says (a free GET with no token).
export async function mapping(m){
  if(m.provider&&(m.providerId||m.provider==='hf-inference'))return {provider:m.provider,providerId:m.providerId||m.repo,adapter:m.adapter,adapterWeightsPath:m.adapterWeightsPath};
  let r;try{r=await fetch(`${HUB()}/api/models/${m.repo}?expand[]=inferenceProviderMapping`)}catch(e){throw new ArtError('transient',`Hub lookup of ${m.repo} failed: ${e.message}`)}
  if(!r.ok)throw new ArtError(r.status===404?'model':'transient',`Hub lookup of ${m.repo} failed: HTTP ${r.status}`,r.status);
  const map=(await r.json()).inferenceProviderMapping||{};
  const live=k=>map[k]&&map[k].status==='live'&&map[k].task==='text-to-image';
  const pick=[m.provider,...SUPPORTED].find(k=>k&&SUPPORTED.includes(k)&&live(k));
  if(!pick)throw new ArtError('model',`${m.repo}: no live text-to-image route on ${SUPPORTED.join(' or ')} (has: ${Object.keys(map).join(', ')||'none'})`);
  return {provider:pick,providerId:map[pick].providerId,adapter:map[pick].adapter,adapterWeightsPath:map[pick].adapterWeightsPath}}

export function promptOf(man,m,e){return [m.trigger,e.prompt,man.style].filter(Boolean).join(', ')}
export function negativeOf(man,e){return [e.negative,man.negativeStyle].filter(Boolean).join(', ')}

// The HTTP request for one image. fal-ai takes its own body (prompt, image_size, loras); hf-inference takes the
// task spec of https://huggingface.co/docs/inference-providers/tasks/text-to-image ({inputs, parameters}).
export function buildRequest(man,m,mp,e,seed=e.seed){
  const prompt=promptOf(man,m,e),negative=negativeOf(man,e);
  if(mp.provider==='hf-inference')return {url:`${ROUTER()}/hf-inference/models/${m.repo}`,body:{inputs:prompt,parameters:{negative_prompt:negative,width:m.width,height:m.height,num_inference_steps:m.steps,guidance_scale:m.guidance,seed}}};
  const body={prompt,negative_prompt:negative,image_size:{width:m.width,height:m.height},num_inference_steps:m.steps,guidance_scale:m.guidance,seed,num_images:1,sync_mode:true,output_format:'png',format:'png'};
  if(mp.adapter==='lora'&&mp.adapterWeightsPath)body.loras=[{path:`${HUB()}/${m.repo}/resolve/main/${mp.adapterWeightsPath}`,scale:m.loraScale??1}];
  return {url:`${ROUTER()}/${mp.provider}/${mp.providerId}`,body}}

// Image bytes from a provider answer: raw image bytes, or JSON with images[0].url (https or data:), image, or b64_json.
async function imageBytes(r){
  const ct=r.headers.get('content-type')||'';
  if(ct.startsWith('image/'))return Buffer.from(await r.arrayBuffer());
  let j;try{j=await r.json()}catch{throw new ArtError('image','answer is neither an image nor JSON')}
  const it=(j.images&&j.images[0])||(j.data&&j.data[0])||j;
  const url=typeof it==='string'?it:it.url,b64=it.b64_json||it.image||it.base64;
  if(url&&url.startsWith('data:'))return Buffer.from(url.slice(url.indexOf(',')+1),'base64');
  if(url){const g=await fetch(url);if(!g.ok)throw new ArtError('transient',`image download failed: HTTP ${g.status}`,g.status);return Buffer.from(await g.arrayBuffer())}
  if(b64)return Buffer.from(b64,'base64');
  throw new ArtError('image','no image in the answer')}

const QUOTA=/quota|credit|exceeded|limit reached|usage limit|monthly|daily|subscribe|pre-?paid|payment/i;
// HTTP status + body -> ArtError. 402 and a 429 that speaks of quota or credit mean the free allowance is used up.
export function classify(status,body,retryAfter){
  const txt=String(body||'').slice(0,240).replace(/hf_[A-Za-z0-9]+/g,'hf_***').replace(/\s+/g,' ');
  if(status===402)return new ArtError('quota',`allowance used: HTTP 402 ${txt}`,status);
  if(status===429)return QUOTA.test(txt)||retryAfter>120?new ArtError('quota',`allowance used: HTTP 429 ${txt}`,status):new ArtError('rate',`rate limited: HTTP 429 ${txt}`,status);
  if(status===401)return new ArtError('auth',`HTTP 401 bad or missing HF_TOKEN ${txt}`,status);
  if(status===403)return new ArtError(QUOTA.test(txt)?'quota':'auth',`HTTP 403 ${QUOTA.test(txt)?'allowance or plan refused':'token lacks the "Inference Providers" permission'} ${txt}`,status);
  if(status===400||status===404||status===405||status===410||status===422)return new ArtError('model',`HTTP ${status} model or route refused ${txt}`,status);
  return new ArtError('transient',`HTTP ${status} ${txt}`,status)}

// One image call. Returns {bytes, last}: last is true when the rate headers say nothing is left after this call.
// count() is called once per HTTP attempt (the daily cap counts attempts).
export async function callImage(req,token,{timeout=120000,count=()=>{},wait=s=>new Promise(f=>setTimeout(f,s*1000))}={}){
  for(let attempt=0;attempt<3;attempt++){
    const ac=new AbortController(),t=setTimeout(()=>ac.abort(),timeout);count();
    let r;try{r=await fetch(req.url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'image/png, application/json'},body:JSON.stringify(req.body),signal:ac.signal})}
    catch(err){clearTimeout(t);throw new ArtError('transient',err.name==='AbortError'?`timed out after ${timeout/1000}s`:err.message)}
    clearTimeout(t);
    if(r.ok){const rem=r.headers.get('x-ratelimit-remaining')??r.headers.get('ratelimit-remaining');return {bytes:await imageBytes(r),last:rem!==null&&Number(rem)<=0}}
    const ra=Number(r.headers.get('retry-after'))||0,e=classify(r.status,await r.text().catch(()=>''),ra);
    if((e.kind==='rate'||r.status===503)&&attempt<2){const s=Math.min(60,ra||5*(attempt+1));console.log(`  ${r.status}, waiting ${s}s`);await wait(s);continue}
    throw e}}

// prompt -> PNG buffer and image for one manifest entry (seed may differ for alternates).
export async function makeAsset({man,PAL,m,mp,e,token,seed=e.seed,timeout,count}){
  const {bytes,last}=await callImage(buildRequest(man,m,mp,e,seed),token,{timeout,count});
  let raw;try{raw=decodePng(bytes)}catch(err){throw new ArtError('image',err.message)}
  const img=postProcess(raw,e,resolvePalette(e.palette,PAL).colors,PAL.MARK.outline);
  return {img,png:encodePng(img),last}}

export function writeIndex(dir,idx){mkdirSync(dir,{recursive:true});const p=join(dir,'index.json'),s={version:1,assets:Object.fromEntries(Object.keys(idx.assets).sort().map(k=>[k,idx.assets[k]]))};
  writeFileSync(p+'.tmp',JSON.stringify(s,null,1)+'\n');renameSync(p+'.tmp',p)}

// The model to use: --model, the manifest's pin, else the first candidate.
export const modelKey=(man,e,want)=>(e&&e.model)||want||man.pinnedModel||(man.candidates||Object.keys(man.models))[0];

export async function main(argv=process.argv.slice(2)){
  const o=parseArgs(argv,['max','only','out','manifest','timeout','model']),out=o.out||ASSETS,man=loadManifest(o.manifest||MANIFEST);
  const PAL=await import('../../src/render/palette.js');
  const bad=validateManifest(man,PAL,resolvePalette);if(bad.length){console.error('manifest problems:\n  '+bad.join('\n  '));return 2}
  if(o.model&&!man.models[o.model]){console.error(`--model: ${o.model} is not in the manifest`);return 2}
  const idx=loadIndex(out),only=o.only?new Set(String(o.only).split(',')):null;
  if(only)for(const id of only)if(!man.assets.some(e=>e.id===id)){console.error(`--only: ${id} is not in the manifest`);return 2}
  const want=man.assets.filter(e=>(!only||only.has(e.id))&&(o.force||!idx.assets[e.id]||!existsSync(join(out,idx.assets[e.id].file))));
  const max=o.max!==undefined?Math.max(0,parseInt(o.max,10)||0):Infinity,todo=want.slice(0,max);
  const cost=todo.reduce((s,e)=>s+man.models[modelKey(man,e,o.model)].costPerImage,0);
  console.log(`[art] ${man.assets.length} in the manifest, ${Object.keys(idx.assets).length} in ${out.replace(ROOT,'.')}/index.json, ${want.length} to make`+(todo.length<want.length?`, stopping at --max ${todo.length}`:''));
  for(const [k,n] of Object.entries(todo.reduce((a,e)=>{const k=modelKey(man,e,o.model);a[k]=(a[k]||0)+1;return a},{})))console.log(`[art]   ${n} x ${k} (${man.models[k].repo}) at ~$${man.models[k].costPerImage}/image`);
  console.log(`[art] estimated cost: $${cost.toFixed(3)} for ${todo.length} image${todo.length===1?'':'s'} (an estimate; inside the free allowance nothing is billed)`);
  if(!todo.length){console.log('[art] nothing to do');return 0}
  if(o['dry-run']){const e=todo[0],m=man.models[modelKey(man,e,o.model)];let mp;try{mp=await mapping(m)}catch(err){mp={provider:m.provider||'?',providerId:m.providerId||'?'};console.log('[art] mapping lookup failed: '+err.message)}
    const {url,body}=buildRequest(man,m,mp,e);console.log(`[art] dry run: first request POST ${url}\n${JSON.stringify(body,null,1)}`);return 0}
  if(!o.yes){console.log('[art] add --yes to generate');return 0}
  const token=hfToken();if(!token){console.error('[art] no HF_TOKEN: put HF_TOKEN=hf_... in .env (a token with the "Inference Providers" permission)');return 2}
  const timeout=(Number(o.timeout)||120)*1000,maps=new Map();let made=0,failed=0;
  for(const e of todo){const k=modelKey(man,e,o.model),m=man.models[k],t0=Date.now();
    try{let mp=maps.get(k);if(!mp){mp=await mapping(m);maps.set(k,mp)}
      const {img,png}=await makeAsset({man,PAL,m,mp,e,token,timeout});
      const file=fileOf(e.id),p=join(out,file);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,png);
      idx.assets[e.id]={id:e.id,kind:e.kind,file,w:img.w,h:img.h,sha256:sha256(png),model:k,repo:m.repo,provider:mp.provider,seed:e.seed,at:new Date().toISOString()};
      writeIndex(out,idx);made++;console.log(`[art] ${e.id} -> ${file} ${img.w}x${img.h} (${((Date.now()-t0)/1000).toFixed(1)}s)`)}
    catch(err){failed++;console.error(`[art] ${e.id} failed: ${err.message}`);if(['quota','auth','rate'].includes(err.kind))break}}
  console.log(`[art] made ${made}, failed ${failed}; npm run art:sheet to review, then npm run artcheck`);
  return failed?1:0}

if(/gen\.mjs$/.test(process.argv[1]||''))main().then(c=>process.exit(c),e=>{console.error(e);process.exit(1)});
