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
//   --tier N                           the art tier to make (32 or 64; default src/render/tile.js TILE): its sizes from the
//                                      manifest entry, its LoRA scale, pixel grid and palette widening from manifest tiers
//
// Each image: prompt -> the model's provider (fal-ai for the pixel-art LoRAs) -> PNG -> post-processing
// (scripts/art/post.mjs: background, downscale to the pixel grid, quantise to src/render/palette.js colours, outline)
// -> assets/<kind>/<tier>/<name>.png, and assets/index.json gets '<id>@<tier>': {id, tier, kind, file, w, h, sha256, model,
// repo, provider, seed, at}.
// The index is written after every image, so an interrupted run keeps what it made.
//
// The token: HF_TOKEN in the environment or in .env / .env.local at the repo root (gitignored). It is read here only,
// sent only to the Hugging Face router, never printed, and no paid option (no bill-to header, no provider key) is ever
// sent. Nothing under src/ sees it. Env for tests: HF_ROUTER_URL (default https://router.huggingface.co), HF_HUB_URL
// (default https://huggingface.co).
import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {ROOT,MANIFEST,ASSETS,loadManifest,loadIndex,fileOf,keyFile,sha256,validateManifest,TILE,TIERS,tierKey,tierCfg,nextCheck,loadQueue,saveQueue} from './lib.mjs';
import {decodePng,encodePng,isPng} from './png.mjs';
import {resolvePalette} from './post.mjs';
import {postProcess} from './post-texture.mjs';
import {spaceOf,buildSpaceRequest,callSpace,spaceToken,DEFAULT_SPACE,ensureAwake,spaceDuration,gpuWindow,windowEnd} from './space.mjs';

export const today=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

export function parseArgs(argv,valued){const o={_:[]};for(let i=0;i<argv.length;i++){const a=argv[i];if(!a.startsWith('--')){o._.push(a);continue}const k=a.slice(2);
  if(valued.includes(k)){o[k]=argv[i+1];i++}else o[k]=true}return o}

// Only HF_TOKEN is read from the .env files; every other line is left alone.
export function hfToken(env=process.env){if(env.HF_TOKEN)return env.HF_TOKEN;
  for(const f of ['.env.local','.env']){const p=join(ROOT,f);if(!existsSync(p))continue;
    for(const line of readFileSync(p,'utf8').split(/\r?\n/)){const m=line.match(/^\s*HF_TOKEN\s*=\s*(.*?)\s*$/);if(m&&m[1])return m[1].replace(/^["']|["']$/g,'')}}
  return ''}

const ROUTER=()=>(process.env.HF_ROUTER_URL||'https://router.huggingface.co').replace(/\/$/,'');
const HUB=()=>(process.env.HF_HUB_URL||'https://huggingface.co').replace(/\/$/,'');
export const SUPPORTED=['fal-ai','hf-inference']; // router providers whose request body this script knows
// Where images are made (#703): 'space' (default: the owner's private ZeroGPU Space, daily GPU quota, $0) or 'router'
// (Inference Providers, billed against the monthly credit). The router is used only when --provider router is given;
// it is never a fallback for a Space that fails.
export const PROVIDERS=['space','router'];
export function providerOf(o){const p=o.provider===true||o.provider===undefined?'space':String(o.provider);return PROVIDERS.includes(p)?p:null}
// A model's route in a mode: the Space ({provider:'space', space}) or the router mapping. A router-only model has no Space route.
export async function routeOf(m,mode){if(mode==='space'){const id=spaceOf(m);if(!id)throw new ArtError('model',`${m.repo} is not on the Space (router only)`);return {provider:'space',space:id}}
  return mapping(m.provider==='space'?{...m,provider:m.routerProvider}:m)}
export const tokenFor=(mode,env=process.env)=>mode==='space'?spaceToken(env):hfToken(env);

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

// The top-level style, or the kind's own (manifest kindStyle: buildings and landmarks are not seamless ground tiles).
export const styleOf=(man,e)=>(man.kindStyle&&man.kindStyle[e.kind])||man.style;
export function promptOf(man,m,e){return [m.trigger,e.prompt,styleOf(man,e)].filter(Boolean).join(', ')}
export function negativeOf(man,e){return [e.negative,man.negativeStyle].filter(Boolean).join(', ')}

// The HTTP request for one image. fal-ai takes its own body (prompt, image_size, loras); hf-inference takes the
// task spec of https://huggingface.co/docs/inference-providers/tasks/text-to-image ({inputs, parameters}).
// The tier picks the LoRA scale (manifest tiers, a model's own tiers win, else the model's loraScale).
export function buildRequest(man,m,mp,e,seed=e.seed,tier=TILE){
  const prompt=promptOf(man,m,e),negative=negativeOf(man,e),cfg=tierCfg(man,m,tier);
  if(mp.provider==='hf-inference')return {url:`${ROUTER()}/hf-inference/models/${m.repo}`,body:{inputs:prompt,parameters:{negative_prompt:negative,width:m.width,height:m.height,num_inference_steps:m.steps,guidance_scale:m.guidance,seed}}};
  const body={prompt,negative_prompt:negative,image_size:{width:m.width,height:m.height},num_inference_steps:m.steps,guidance_scale:m.guidance,seed,num_images:1,sync_mode:true,output_format:'png',format:'png'};
  if(mp.adapter==='lora'&&mp.adapterWeightsPath)body.loras=[{path:`${HUB()}/${m.repo}/resolve/main/${mp.adapterWeightsPath}`,scale:cfg.loraScale??m.loraScale??1}];
  return {url:`${ROUTER()}/${mp.provider}/${mp.providerId}`,body}}

// Image bytes from a provider answer: raw image bytes, or JSON with images[0].url (https or data:), image, or b64_json.
async function imageBytes(r,info={}){
  const ct=r.headers.get('content-type')||'';
  if(ct.startsWith('image/'))return Buffer.from(await r.arrayBuffer());
  let j;try{j=await r.json()}catch{throw new ArtError('image','answer is neither an image nor JSON')}
  info.json=j;
  const it=(j.images&&j.images[0])||(j.data&&j.data[0])||j;
  const url=typeof it==='string'?it:it.url,b64=it.b64_json||it.image||it.base64;
  if(url&&url.startsWith('data:'))return Buffer.from(url.slice(url.indexOf(',')+1),'base64');
  if(url){const g=await fetch(url);if(!g.ok)throw new ArtError('transient',`image download failed: HTTP ${g.status}`,g.status);return Buffer.from(await g.arrayBuffer())}
  if(b64)return Buffer.from(b64,'base64');
  throw new ArtError('image','no image in the answer')}

const QUOTA=/quota|credit|exceeded|limit reached|usage limit|monthly|daily|subscribe|pre-?paid|payment/i;
// HTTP status + body -> ArtError. 402 and a 429 that speaks of quota or credit mean the credits are used up.
export function classify(status,body,retryAfter){const e=classify0(status,body,retryAfter);e.retryAfter=retryAfter||0;return e}
function classify0(status,body,retryAfter){
  const txt=String(body||'').slice(0,240).replace(/hf_[A-Za-z0-9]+/g,'hf_***').replace(/\s+/g,' ');
  if(status===402)return new ArtError('quota',`allowance used: HTTP 402 ${txt}`,status);
  if(status===429)return QUOTA.test(txt)||retryAfter>120?new ArtError('quota',`allowance used: HTTP 429 ${txt}`,status):new ArtError('rate',`rate limited: HTTP 429 ${txt}`,status);
  if(status===401)return new ArtError('auth',`HTTP 401 bad or missing HF_TOKEN ${txt}`,status);
  if(status===403)return new ArtError(QUOTA.test(txt)?'quota':'auth',`HTTP 403 ${QUOTA.test(txt)?'allowance or plan refused':'token lacks the "Inference Providers" permission'} ${txt}`,status);
  if(status===400||status===404||status===405||status===410||status===422)return new ArtError('model',`HTTP ${status} model or route refused ${txt}`,status);
  return new ArtError('transient',`HTTP ${status} ${txt}`,status)}

// What the answer says it cost, in dollars, or null (#661). The HF docs promise no cost field for image routes (the chat
// route has usage.estimated_cost, used by the OpenAI-style adapter), so look at the likely places: a header named like
// cost/price/billed, usage.estimated_cost, estimated_cost, cost, billing.cost in the JSON. probe lists what the answer
// carried (header names and values that look billing-ish, the JSON's top-level keys), logged once so the real shape is known.
const COSTISH=/cost|price|bill|credit|usage|ratelimit/i;
export function billed(headers,json){
  let cost=null,from='';const num=v=>{const n=typeof v==='string'?parseFloat(v):v;return typeof n==='number'&&isFinite(n)&&n>=0?n:null},hs={};
  for(const [k,v] of headers.entries())if(COSTISH.test(k)){hs[k]=String(v).slice(0,40);if(cost===null&&/cost|price|billed/i.test(k)&&!/ratelimit/i.test(k)){const n=num(v);if(n!==null){cost=n;from='header '+k}}}
  if(json&&typeof json==='object'){
    for(const [name,v] of [['usage.estimated_cost',json.usage&&json.usage.estimated_cost],['estimated_cost',json.estimated_cost],['cost',json.cost],['billing.cost',json.billing&&json.billing.cost]])if(cost===null){const n=num(v);if(n!==null){cost=n;from='body '+name}}}
  return {cost,costFrom:from,probe:{headers:hs,bodyKeys:json&&typeof json==='object'?Object.keys(json).slice(0,12):[]}}}

// One image call. Returns {bytes, last, cost, costFrom, probe}: last is true when the rate headers say nothing is left after this call.
// count() is called once per HTTP attempt (the daily cap counts attempts).
export async function callImage(req,token,{timeout=120000,count=()=>{},wait=s=>new Promise(f=>setTimeout(f,s*1000))}={}){
  for(let attempt=0;attempt<3;attempt++){
    const ac=new AbortController(),t=setTimeout(()=>ac.abort(),timeout);count();
    let r;try{r=await fetch(req.url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'image/png, application/json'},body:JSON.stringify(req.body),signal:ac.signal})}
    catch(err){clearTimeout(t);throw new ArtError('transient',err.name==='AbortError'?`timed out after ${timeout/1000}s`:err.message)}
    clearTimeout(t);
    if(r.ok){const rem=r.headers.get('x-ratelimit-remaining')??r.headers.get('ratelimit-remaining'),info={},bytes=await imageBytes(r,info);return {bytes,last:rem!==null&&Number(rem)<=0,...billed(r.headers,info.json)}}
    const ra=Number(r.headers.get('retry-after'))||0,e=classify(r.status,await r.text().catch(()=>''),ra);
    if((e.kind==='rate'||r.status===503)&&attempt<2){const s=Math.min(60,ra||5*(attempt+1));console.log(`  ${r.status}, waiting ${s}s`);await wait(s);continue}
    throw e}}

// One call: the provider's image bytes. Callers keep them raw (saveRaw) before anything else happens.
export async function fetchRaw({man,m,mp,e,token,seed=e.seed,timeout,count,tier=TILE,now}){
  if(mp.provider==='space')return callSpace(buildSpaceRequest(man,m,mp,e,seed,tier),token,{timeout,count,now});
  return callImage(buildRequest(man,m,mp,e,seed,tier),token,{timeout,count})}

// Raw bytes -> asset image and PNG (post-texture.mjs). Throws ArtError 'image' (not a PNG) or 'flat' (too few colours; a
// sprite sheet without cols x rows figures or, for a hero, without its faction tabard: post-sheet.mjs).
// At a tier: its size from e.sizes, the model's pixel grid and the palette widening from the tier's settings.
export function processRaw(bytes,e,PAL,m,tier=TILE,man=null){
  let raw;try{raw=decodePng(bytes)}catch(err){throw new ArtError('image',err.message)}
  const cfg=tierCfg(man,m,tier),sh=(PAL.TIER_SHADES&&PAL.TIER_SHADES[tier])||{};
  const key=e.frames&&((e.palette&&e.palette.from)||[]).includes('SPRITE.key')&&PAL.recolour?Object.keys(PAL.recolour(1)):null; // a hero sheet must keep its tabard recolourable
  try{const img=postProcess(raw,e,resolvePalette(e.palette,PAL).colors,PAL.MARK.outline,{hint:cfg.grid||(m&&m.grid)||8,tier,minPalette:cfg.minPalette??sh.minPalette??6,factors:sh.factors,key});return {img,png:encodePng(img)}}
  catch(err){if(err.kind==='flat')throw Object.assign(new ArtError('flat',err.message),{notes:err.notes});throw err}}

// Keep the provider's image as it came, before post-processing, so every later tweak re-runs offline
// (npm run art:reprocess): <inc>/raw/<kind>/<name>[.altK].<png|jpg|bin> plus <inc>/raw/index.json with the request facts.
export function saveRaw(inc,key,bytes,meta){
  const ext=isPng(bytes)?'png':bytes[0]===0xff&&bytes[1]===0xd8?'jpg':'bin',file=keyFile(key).replace(/\.png$/,'.'+ext),p=join(inc,'raw',file);
  mkdirSync(dirname(p),{recursive:true});writeFileSync(p,bytes);
  const ri=loadIndex(join(inc,'raw'));ri.assets[key]={...meta,file,bytes:bytes.length,sha256:sha256(bytes),at:new Date().toISOString()};writeIndex(join(inc,'raw'),ri);
  return file}

export function writeIndex(dir,idx){mkdirSync(dir,{recursive:true});const p=join(dir,'index.json'),s={version:1,assets:Object.fromEntries(Object.keys(idx.assets).sort().map(k=>[k,idx.assets[k]]))};
  writeFileSync(p+'.tmp',JSON.stringify(s,null,1)+'\n');renameSync(p+'.tmp',p)}

// The model to use: --model, the manifest's pin, else the first candidate.
export const modelKey=(man,e,want)=>(e&&e.model)||want||man.pinnedModel||(man.candidates||Object.keys(man.models))[0];

export async function main(argv=process.argv.slice(2)){
  const o=parseArgs(argv,['max','only','out','manifest','timeout','model','tier','provider']),out=o.out||ASSETS,man=loadManifest(o.manifest||MANIFEST),tier=o.tier?Number(o.tier):TILE;
  if(!TIERS.includes(tier)){console.error(`--tier: ${o.tier} is not one of ${TIERS.join(', ')}`);return 2}
  const mode=providerOf(o);if(!mode){console.error(`--provider: ${o.provider} is not one of ${PROVIDERS.join(', ')}`);return 2}
  const PAL=await import('../../src/render/palette.js');
  const bad=validateManifest(man,PAL,resolvePalette);if(bad.length){console.error('manifest problems:\n  '+bad.join('\n  '));return 2}
  if(o.model&&!man.models[o.model]){console.error(`--model: ${o.model} is not in the manifest`);return 2}
  const idx=loadIndex(out),only=o.only?new Set(String(o.only).split(',')):null;
  if(only)for(const id of only)if(!man.assets.some(e=>e.id===id)){console.error(`--only: ${id} is not in the manifest`);return 2}
  const have=e=>idx.assets[tierKey(e.id,tier)],want=man.assets.filter(e=>(!only||only.has(e.id))&&(o.force||!have(e)||!existsSync(join(out,have(e).file))));
  const max=o.max!==undefined?Math.max(0,parseInt(o.max,10)||0):Infinity,todo=want.slice(0,max);
  const mk=e=>mode==='space'?(e.model||o.model||(man.candidates||[]).find(k=>spaceOf(man.models[k]))):modelKey(man,e,o.model);
  if(mode==='space'&&todo.some(e=>!mk(e)||!spaceOf(man.models[mk(e)]))){console.error('[art] no model of the manifest is on the Space (models[].space); --provider router uses the paid router');return 2}
  const cost=mode==='space'?0:todo.reduce((s,e)=>s+man.models[mk(e)].costPerImage,0);
  console.log(`[art] tier ${tier}: ${man.assets.length} in the manifest, ${Object.values(idx.assets).filter(a=>a.tier===tier).length} in ${out.replace(ROOT,'.')}/index.json, ${want.length} to make`+(todo.length<want.length?`, stopping at --max ${todo.length}`:''));
  for(const [k,n] of Object.entries(todo.reduce((a,e)=>{const k=mk(e);a[k]=(a[k]||0)+1;return a},{})))console.log(mode==='space'?`[art]   ${n} x ${k} (${man.models[k].repo}) on the Space ${spaceOf(man.models[k])||DEFAULT_SPACE}: $0, daily ZeroGPU quota`:`[art]   ${n} x ${k} (${man.models[k].repo}) at ~$${man.models[k].costPerImage}/image`);
  console.log(mode==='space'?`[art] provider: the ZeroGPU Space (cost $0.000; GPU quota, not credits)`:`[art] estimated cost: $${cost.toFixed(3)} for ${todo.length} image${todo.length===1?'':'s'} (--provider router: Inference Providers credits; art:daily keeps to a daily budget, art:gen does not)`);
  if(!todo.length){console.log('[art] nothing to do');return 0}
  if(o['dry-run']){const e=todo[0],m=man.models[mk(e)];let mp;try{mp=await routeOf(m,mode)}catch(err){mp={provider:m.routerProvider||m.provider||'?',providerId:m.providerId||'?'};console.log('[art] mapping lookup failed: '+err.message)}
    const {url,body}=mp.provider==='space'?buildSpaceRequest(man,m,mp,e,e.seed,tier):buildRequest(man,m,mp,e,e.seed,tier);console.log(`[art] dry run: first request POST ${url}\n${JSON.stringify(body,null,1)}`);return 0}
  if(!o.yes){console.log('[art] add --yes to generate');return 0}
  const token=tokenFor(mode);if(!token){console.error(mode==='space'?'[art] no HF_TOKEN (or HF_SPACE_TOKEN): put it in .env (a token that can read the Space)':'[art] no HF_TOKEN: put HF_TOKEN=hf_... in .env (a token with the "Inference Providers" permission)');return 2}
  const timeout=(Number(o.timeout)||120)*1000,maps=new Map();let made=0,failed=0;
  // the Space: the same GPU window and stop as art:daily (the queue beside the assets), so a direct run never runs into overage
  let first=true;const q=mode==='space'?loadQueue(out):null,zg=(man.allowance&&man.allowance.zeroGpu)||{},capS=(Number(process.env.ART_GPU_MINUTES)||zg.stopAtMinutes||36)*60;
  for(const e of todo){const k=mk(e),m=man.models[k],t0=Date.now();
    if(q){const gw=gpuWindow(q,new Date());if(gw.s+spaceDuration(m)>capS){console.error(`[art] GPU cap reached (${(gw.s/60).toFixed(1)} of ${capS/60} min counted); the quota resets ${windowEnd(gw)?windowEnd(gw).toLocaleTimeString():'within 24 h'}`);break}}
    try{let mp=maps.get(k);if(!mp){mp=await routeOf(m,mode);maps.set(k,mp)}
      if(mp.provider==='space'&&first)await ensureAwake(mp.space,token);
      const key=tierKey(e.id,tier),got=await fetchRaw({man,m,mp,e,token,timeout:first&&mp.provider==='space'?Math.max(timeout,300000):timeout,tier}),{bytes}=got;first=false;
      if(q){const gw=gpuWindow(q,new Date());q.gpu={...gw,start:gw.start||new Date().toISOString(),s:gw.s+(got.gpuS||0),images:gw.images+1};saveQueue(out,q)}saveRaw(join(out,'incoming',today()),key,bytes,{id:e.id,tier,model:k,repo:m.repo,provider:mp.provider,seed:e.seed});
      const {img,png}=processRaw(bytes,e,PAL,m,tier,man);
      const file=fileOf(e.id,tier),p=join(out,file);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,png);
      idx.assets[key]={id:e.id,tier,kind:e.kind,file,w:img.w,h:img.h,sha256:sha256(png),model:k,repo:m.repo,provider:mp.provider,seed:e.seed,at:new Date().toISOString()};
      writeIndex(out,idx);made++;console.log(`[art] ${e.id} -> ${file} ${img.w}x${img.h} (${((Date.now()-t0)/1000).toFixed(1)}s${mp.provider==='space'?`, quota: ${(got.gpuS||0).toFixed(1)} s of GPU`:''})`)}
    catch(err){failed++;console.error(`[art] ${e.id} failed: ${err.message}`);if(q&&err.kind==='gpu'){const gw=gpuWindow(q,new Date());q.gpu={...gw,start:gw.start||new Date().toISOString(),resetAt:(err.resetAt||new Date(Date.now()+864e5)).toISOString()};saveQueue(out,q)}if(['quota','auth','rate','gpu','space'].includes(err.kind)){const n=nextCheck(err.kind==='auth'?'error':'provider',new Date(),{retryHours:Number(process.env.ART_RETRY_HOURS)||4,retryAfter:err.retryAfter});console.error(`[art] stopped at the provider's limit: check again at ${today(n)} ${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')} (npm run art:loop does this by itself)`);break}}}
  console.log(`[art] made ${made}, failed ${failed}; npm run art:sheet to review, then npm run artcheck`);
  return failed?1:0}

if(/gen\.mjs$/.test(process.argv[1]||''))main().then(c=>process.exit(c),e=>{console.error(e);process.exit(1)});
