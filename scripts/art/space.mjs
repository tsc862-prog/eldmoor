// The ZeroGPU Space provider of the art pipeline (#703): images made on the owner's private Space (scripts/art/space/,
// pushed with npm run art:space -- --push) draw on the PRO account's daily ZeroGPU quota (40 GPU minutes, reset 24 h after
// the first use; https://huggingface.co/docs/hub/spaces-zerogpu, read 2026-11-03), never on the Inference Providers credit.
//
// Protocol (Gradio's HTTP API, https://www.gradio.app/guides/querying-gradio-apps-with-curl): POST
// <space>/gradio_api/call/generate {data:[prompt, negative, seed, steps, guidance, width, height, lora_scale, lora]} ->
// {event_id}; GET <space>/gradio_api/call/generate/<event_id> streams server-sent events until `complete` (data: [image
// FileData {url,...}, gpu seconds]) or `error` (data: the message). Both carry Authorization: Bearer <token> (a private Space).
// The quota refusal: an HTTP 429, or an error event, whose text says the GPU quota is exceeded and "Try again in H:MM:SS";
// it becomes ArtError kind 'gpu' with resetAt, so the art loop sleeps until exactly then.
//
// The token: HF_SPACE_TOKEN if set (a fine-grained token with only read/write on the Space repo), else HF_TOKEN; read from the
// environment or .env/.env.local, sent only to the Hub and the Space, never printed. Test env: HF_SPACE_URL (the Space's
// host, default https://<owner>-<name>.hf.space), HF_HUB_URL, ART_SPACE_POLL_MS (status poll, default 5000).
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT} from './lib.mjs';
import {ArtError,promptOf,negativeOf} from './gen.mjs';
import {tierCfg,TILE} from './lib.mjs';

export const DEFAULT_SPACE='tsc862/eldmoor-art';
const HUB=()=>(process.env.HF_HUB_URL||'https://huggingface.co').replace(/\/$/,'');

// One variable from the environment or the .env files (only that line is read).
export function envVar(name,env=process.env){if(name in env)return env[name]; // set, even empty: the environment wins over .env
  for(const f of ['.env.local','.env']){const p=join(ROOT,f);if(!existsSync(p))continue;
    for(const line of readFileSync(p,'utf8').split(/\r?\n/)){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(m&&m[1]===name&&m[2]&&!line.trim().startsWith('#'))return m[2].replace(/^["']|["']$/g,'')}}
  return ''}
export const spaceToken=(env=process.env)=>envVar('HF_SPACE_TOKEN',env)||envVar('HF_TOKEN',env);

// The Space a model is made on: HF_ART_SPACE overrides the manifest's `space`. Null for router-only models.
export const spaceOf=(m,env=process.env)=>m&&m.space?(env.HF_ART_SPACE||m.space):null;
export const spaceUrl=(id,env=process.env)=>(env.HF_SPACE_URL||`https://${id.replace('/','-').replace(/[._]/g,'-').toLowerCase()}.hf.space`).replace(/\/$/,'');
export const spacePage=id=>`https://huggingface.co/spaces/${id}`;

// GPU seconds the Space reserves for one image: the same rule as app.py gpu_duration (base + per step, scaled by pixels,
// capped). The quota is charged by the time used; this reserved figure is what a run plans against (an upper bound).
export function spaceDuration(m){const px=(m.width*m.height)/(1024*1024);return Math.min(120,Math.ceil(10+(m.steps||25)*0.6*px))}

// The request: the same prompt, negative, seed, steps, guidance and size as the router body, the tier's LoRA scale.
export function buildSpaceRequest(man,m,mp,e,seed=e.seed,tier=TILE,env=process.env){
  const cfg=tierCfg(man,m,tier),scale=cfg.loraScale??m.loraScale??1;
  return {space:mp.space,url:`${spaceUrl(mp.space,env)}/gradio_api/call/generate`,
    body:{data:[promptOf(man,m,e),negativeOf(man,e),seed,m.steps,m.guidance,m.width,m.height,scale,m.repo]},reserve:spaceDuration(m)}}

// "Try again in 2:31:05" / "retry in 14:32" / a retry-after header -> the reset time (a Date), else null.
export function quotaReset(text,now=new Date(),retryAfter=0){
  const t=String(text||''),m=/try again in\s+(?:(\d+):)?(\d{1,2}):(\d{2})/i.exec(t);
  if(m)return new Date(now.getTime()+((Number(m[1]||0)*60+Number(m[2]))*60+Number(m[3]))*1000);
  const s=/try again in\s+(\d+)\s*(s|sec|seconds|m|min|minutes|h|hours)\b/i.exec(t);
  if(s)return new Date(now.getTime()+Number(s[1])*({s:1,sec:1,seconds:1,m:60,min:60,minutes:60,h:3600,hours:3600}[s[2].toLowerCase()])*1000);
  if(retryAfter>0)return new Date(now.getTime()+retryAfter*1000);
  return null}
const GPU_QUOTA=/gpu quota|zerogpu quota|exceeded your .*quota|quota exceeded|no gpu .*available.*quota/i;
const hhmm=d=>`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
export function gpuQuotaError(text,now=new Date(),retryAfter=0){
  const at=quotaReset(text,now,retryAfter),txt=String(text||'').slice(0,200).replace(/hf_[A-Za-z0-9]+/g,'hf_***').replace(/\s+/g,' ');
  const e=new ArtError('gpu',`ZeroGPU quota used (resets ${at?hhmm(at):'in 24 h at the latest'}): ${txt}`,429);e.resetAt=at;e.retryAfter=at?Math.max(0,(at-now)/1000):0;return e}

// The Space's state on the Hub: RUNNING, SLEEPING, BUILDING, APP_STARTING, ... and its hardware.
export async function spaceStatus(id,token){
  let r;try{r=await fetch(`${HUB()}/api/spaces/${id}`,{headers:{authorization:`Bearer ${token}`}})}catch(e){throw new ArtError('transient',`Space status lookup failed: ${e.message}`)}
  if(r.status===401||r.status===403)throw new ArtError('auth',`HTTP ${r.status}: the token cannot read the Space ${id} (${spacePage(id)})`,r.status);
  if(r.status===404)throw new ArtError('space',`the Space ${id} does not exist yet: run npm run art:space -- --push (${spacePage(id)})`,404);
  if(!r.ok)throw new ArtError('transient',`Space status lookup failed: HTTP ${r.status}`,r.status);
  const j=await r.json(),rt=j.runtime||{};return {stage:rt.stage||'UNKNOWN',hardware:(rt.hardware&&(rt.hardware.current||rt.hardware.requested))||null,private:j.private}}

const BROKEN=/ERROR|PAUSED|STOPPED|NO_APP_FILE/;
// Wait until the Space runs (a sleeping Space wakes on a request; loading SDXL takes 1-3 minutes). A broken or paused Space,
// one still building after maxWait, or one not on ZeroGPU hardware is an ArtError 'space' naming its page.
export async function ensureAwake(id,token,{maxWait=300000,say=s=>console.log('[art] '+s),env=process.env}={}){
  const poll=Number(env.ART_SPACE_POLL_MS)||5000,t0=Date.now();let st=await spaceStatus(id,token),poked=false;
  while(true){
    if(BROKEN.test(st.stage))throw new ArtError('space',`the Space ${id} is ${st.stage}: see ${spacePage(id)} (logs there; npm run art:space -- --push re-uploads it)`);
    if(st.hardware&&!/^zero/.test(st.hardware))throw new ArtError('space',`the Space ${id} runs on ${st.hardware}, not ZeroGPU: choose ZeroGPU under Settings on ${spacePage(id)}`);
    if(st.stage==='RUNNING'){if(poked)say(`the Space is awake (${Math.round((Date.now()-t0)/1000)} s)`);return st}
    if(!poked){poked=true;say(`waking the Space ${id} (${st.stage.toLowerCase()}; loading SDXL takes 1-3 minutes)`);
      try{await fetch(spaceUrl(id,env)+'/',{headers:{authorization:`Bearer ${token}`}})}catch{}}
    if(Date.now()-t0>maxWait)throw new ArtError('space',`the Space ${id} is still ${st.stage} after ${Math.round(maxWait/1000)} s: see ${spacePage(id)}`);
    await new Promise(f=>setTimeout(f,poll));st=await spaceStatus(id,token);
    if(st.stage!=='RUNNING')say(`waking the Space (${Math.round((Date.now()-t0)/1000)} s, ${st.stage.toLowerCase()})`)}}

// Server-sent events -> [{event, data}].
export function parseSse(text){const out=[];let ev={event:'message',data:''};
  for(const line of String(text).split(/\r?\n/)){
    if(!line){if(ev.data!==''||ev.event!=='message')out.push(ev);ev={event:'message',data:''};continue}
    if(line.startsWith('event:'))ev.event=line.slice(6).trim();else if(line.startsWith('data:'))ev.data+=(ev.data?'\n':'')+line.slice(5).trim()}
  if(ev.data!==''||ev.event!=='message')out.push(ev);return out}

async function timed(url,opt,timeout){const ac=new AbortController(),t=setTimeout(()=>ac.abort(),timeout);
  try{return await fetch(url,{...opt,signal:ac.signal})}catch(err){throw new ArtError('transient',err.name==='AbortError'?`the Space did not answer in ${timeout/1000}s`:err.message)}finally{clearTimeout(t)}}

// One image on the Space. Returns {bytes, last:false, gpuS} (gpuS: the GPU seconds the Space measured, else the reserved figure).
// count() once per HTTP attempt. now() is the clock the reset time is read against (the loop's, in tests a fake one).
export async function callSpace(req,token,{timeout=120000,count=()=>{},now=()=>new Date(),env=process.env}={}){
  const auth={authorization:`Bearer ${token}`};count();
  const r=await timed(req.url,{method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify(req.body)},timeout);
  if(!r.ok){const body=await r.text().catch(()=>''),ra=Number(r.headers.get('retry-after'))||0;
    if(r.status===429||GPU_QUOTA.test(body))throw gpuQuotaError(body,now(),ra);
    if(r.status===401||r.status===403)throw new ArtError('auth',`HTTP ${r.status}: the token cannot use the Space ${req.space} (it needs read access; ${spacePage(req.space)})`,r.status);
    if(r.status===404)throw new ArtError('space',`HTTP 404: the Space ${req.space} has no generate API: run npm run art:space -- --push (${spacePage(req.space)})`,404);
    throw new ArtError('transient',`Space HTTP ${r.status} ${body.slice(0,160).replace(/\s+/g,' ')}`,r.status)}
  let id;try{id=(await r.json()).event_id}catch{}
  if(!id)throw new ArtError('transient','the Space gave no event id');
  const s=await timed(`${req.url}/${id}`,{headers:{...auth,accept:'text/event-stream'}},timeout);
  if(!s.ok){const body=await s.text().catch(()=>'');if(s.status===429||GPU_QUOTA.test(body))throw gpuQuotaError(body,now(),Number(s.headers.get('retry-after'))||0);throw new ArtError('transient',`Space stream HTTP ${s.status}`,s.status)}
  const evs=parseSse(await s.text()),err=evs.find(v=>v.event==='error'),done=evs.find(v=>v.event==='complete');
  if(err){let msg=err.data;try{msg=JSON.parse(err.data);if(msg&&typeof msg==='object')msg=msg.message||msg.error||JSON.stringify(msg)}catch{}
    msg=String(msg??'');if(GPU_QUOTA.test(msg))throw gpuQuotaError(msg,now());
    if(/unknown lora|not in the space/i.test(msg))throw new ArtError('model',`the Space refused the model: ${msg.slice(0,160)}`);
    throw new ArtError('transient',`the Space failed: ${msg.slice(0,200)||'no message (is show_error on?)'}`)}
  if(!done)throw new ArtError('transient','the Space stream ended without a result');
  let out;try{out=JSON.parse(done.data)}catch{throw new ArtError('image','the Space result is not JSON')}
  const file=Array.isArray(out)?out[0]:out,gpuS=Array.isArray(out)&&typeof out[1]==='number'?out[1]:req.reserve;
  const url=file&&(file.url||(file.path&&`${spaceUrl(req.space,env)}/gradio_api/file=${file.path}`));
  if(!url)throw new ArtError('image','no image in the Space result');
  let bytes;if(url.startsWith('data:'))bytes=Buffer.from(url.slice(url.indexOf(',')+1),'base64');
  else{const g=await timed(url,{headers:auth},timeout);if(!g.ok)throw new ArtError('transient',`image download from the Space failed: HTTP ${g.status}`,g.status);bytes=Buffer.from(await g.arrayBuffer())}
  return {bytes,last:false,gpuS}}

// The GPU window (queue.json q.gpu): ZeroGPU's daily quota resets 24 h after the first use, so a window opens at the first call
// after the last one closed. {start, s (GPU seconds counted), images}. A quota 429's reset time closes it early.
export function gpuWindow(q,now){const g=q.gpu||{};const end=g.resetAt?new Date(g.resetAt):g.start?new Date(new Date(g.start).getTime()+24*3600e3):null;
  if(!g.start||(end&&now>=end))return {start:null,s:0,images:0};return {start:g.start,s:g.s||0,images:g.images||0,resetAt:g.resetAt||null}}
export const windowEnd=g=>g.resetAt?new Date(g.resetAt):g.start?new Date(new Date(g.start).getTime()+24*3600e3):null;
