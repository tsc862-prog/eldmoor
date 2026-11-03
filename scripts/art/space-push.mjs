#!/usr/bin/env node
// npm run art:space (#703): the owner's private ZeroGPU Space for the art (scripts/art/space/).
//
//   npm run art:space                 the plan: the Space, its files, the LoRAs from the manifest; no call
//   npm run art:space -- --push       create the Space if missing (private, Gradio SDK, ZeroGPU), upload app.py,
//                                     requirements.txt, README.md and loras.json in one commit, ask for ZeroGPU hardware
//   npm run art:space -- --status     the Space's state on the Hub (running, sleeping, building, error) and hardware
//   --space OWNER/NAME                another Space (default: the manifest's, or HF_ART_SPACE)
//
// Hub HTTP API only (the same calls huggingface_hub makes: whoami-v2, repos/create, the NDJSON commit, spaces/<id>/hardware),
// so nothing needs Python on this machine. The token is HF_SPACE_TOKEN, else HF_TOKEN (.env); it needs write access to the
// Space repo. A read-only token is named as such and nothing is sent. The token is never printed.
import {readFileSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadManifest,MANIFEST} from './lib.mjs';
import {parseArgs} from './gen.mjs';
import {spaceToken,spaceOf,spacePage,spaceStatus,DEFAULT_SPACE} from './space.mjs';

const DIR=join(dirname(fileURLToPath(import.meta.url)),'space');
const HUB=()=>(process.env.HF_HUB_URL||'https://huggingface.co').replace(/\/$/,'');
export const FILES=['app.py','requirements.txt','README.md'];
export const FLAVOR='zero-a10g'; // the Hub's hardware id for ZeroGPU (huggingface_hub SpaceHardware.ZERO_A10G)
const scrub=t=>String(t||'').replace(/hf_[A-Za-z0-9]+/g,'hf_***').replace(/\s+/g,' ').slice(0,240);

// loras.json for the Space: the manifest's models that live on it, in candidate order.
export function lorasOf(man,space){
  const keys=[...new Set([...(man.candidates||[]),...Object.keys(man.models||{})])].filter(k=>man.models[k]&&spaceOf(man.models[k],{})===space);
  return {about:'Written by npm run art:space -- --push from scripts/art/manifest.json (#703). Do not edit on the Hub.',
    base:'stabilityai/stable-diffusion-xl-base-1.0',vae:'madebyollin/sdxl-vae-fp16-fix',
    loras:keys.map(k=>({key:k,repo:man.models[k].repo,weights:man.models[k].weights}))}}

// What the token may do, from whoami-v2: {name, write: true|false|'scoped', why}.
export function tokenRights(who,space){
  const at=(who&&who.auth&&who.auth.accessToken)||{},role=at.role,[owner]=space.split('/');
  if(role==='write')return {name:who.name,write:true};
  if(role==='read')return {name:who.name,write:false,why:'a read-only token'};
  if(role==='fineGrained'){const fg=at.fineGrained||{},scoped=fg.scoped||[];
    const w=s=>(s.permissions||[]).includes('repo.write');
    if(scoped.some(s=>w(s)&&s.entity&&((s.entity.type==='user'||s.entity.type==='org')&&s.entity.name===owner)))return {name:who.name,write:true};
    if(scoped.some(s=>w(s)&&s.entity&&s.entity.type==='space'&&s.entity.name===space))return {name:who.name,write:'scoped'};
    return {name:who.name,write:false,why:`a fine-grained token without write access to ${space}`}}
  return {name:who&&who.name,write:false,why:'a token whose rights the Hub did not say'}}

async function hub(path,opt={},token){return fetch(HUB()+path,{...opt,headers:{authorization:`Bearer ${token}`,...(opt.headers||{})}})}

export async function main(argv=process.argv.slice(2),env=process.env){
  const o=parseArgs(argv,['space','manifest']),man=loadManifest(o.manifest||MANIFEST);
  const space=o.space||env.HF_ART_SPACE||Object.values(man.models).map(m=>m.space).find(Boolean)||DEFAULT_SPACE;
  if(!/^[\w.-]+\/[\w.-]+$/.test(space)){console.error(`[space] ${space} is not OWNER/NAME`);return 2}
  const loras=lorasOf(man,space);
  if(!loras.loras.length){console.error(`[space] no model of the manifest is on ${space} (models[].space)`);return 2}
  const missing=FILES.filter(f=>!existsSync(join(DIR,f)));if(missing.length){console.error(`[space] missing ${missing.join(', ')} in scripts/art/space/`);return 2}
  if(!o.push&&!o.status){
    console.log(`[space] ${space} (${spacePage(space)}): private, Gradio SDK, ZeroGPU hardware`);
    console.log(`[space] files: ${FILES.join(', ')}, loras.json (${loras.loras.map(l=>`${l.key} = ${l.repo}/${l.weights}`).join('; ')})`);
    console.log('[space] npm run art:space -- --push to create or update it; --status for its state');return 0}
  const token=spaceToken(env);
  if(!token){console.error('[space] no HF_SPACE_TOKEN or HF_TOKEN in .env: make a fine-grained token with write access to '+space+' on https://huggingface.co/settings/tokens');return 2}
  if(o.status){try{const st=await spaceStatus(space,token);console.log(`[space] ${space}: ${st.stage}, hardware ${st.hardware||'?'}, ${st.private?'private':'PUBLIC'} (${spacePage(space)})`);return 0}
    catch(e){console.error('[space] '+e.message);return 2}}
  // 1. the token's rights: a read-only token is said plainly, before anything is sent
  let r=await hub('/api/whoami-v2',{},token);
  if(r.status===401){console.error('[space] HTTP 401: the token is not valid (check HF_SPACE_TOKEN / HF_TOKEN in .env)');return 2}
  if(!r.ok){console.error(`[space] whoami failed: HTTP ${r.status} ${scrub(await r.text().catch(()=>''))}`);return 2}
  const rights=tokenRights(await r.json(),space);
  if(!rights.write){console.error(`[space] the token is read-only for ${space} (${rights.why}). Make a fine-grained token on https://huggingface.co/settings/tokens with write access to ${space} (or to your repos), put it in .env as HF_SPACE_TOKEN, and run this again. Nothing was sent.`);return 2}
  console.log(`[space] token of ${rights.name}: write access${rights.write==='scoped'?' to '+space+' only':''}`);
  // 2. the repo: create it private (409 = it exists); a public one is made private
  const [owner,name]=space.split('/');
  r=await hub('/api/repos/create',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'space',name,...(owner!==rights.name?{organization:owner}:{}),private:true,sdk:'gradio',hardware:FLAVOR})},token);
  if(r.ok)console.log(`[space] created ${space} (private, Gradio)`);
  else if(r.status===409)console.log(`[space] ${space} exists: updating it`);
  else if(r.status===403){console.error(`[space] HTTP 403: the token may not create ${space}. Either create it once on https://huggingface.co/new-space (owner ${owner}, name ${name}, Gradio, private, ZeroGPU) and run this again, or give the token write access to your repos. ${scrub(await r.text().catch(()=>''))}`);return 2}
  else{console.error(`[space] creating ${space} failed: HTTP ${r.status} ${scrub(await r.text().catch(()=>''))}`);return 2}
  {const g=await hub(`/api/spaces/${space}`,{},token);if(g.ok){const j=await g.json();if(j.private===false){
    const p=await hub(`/api/spaces/${space}/settings`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({private:true})},token);
    console.log(p.ok?`[space] ${space} was public: made private`:`[space] WARNING: ${space} is public and could not be made private (HTTP ${p.status}); set it private on ${spacePage(space)}/settings`)}}}
  // 3. one commit with every file (NDJSON, as huggingface_hub create_commit sends small files)
  const files=[...FILES.map(f=>({path:f,content:readFileSync(join(DIR,f))})),{path:'loras.json',content:Buffer.from(JSON.stringify(loras,null,1)+'\n')}];
  const nd=[{key:'header',value:{summary:'Eldmoor art Space (npm run art:space -- --push)',description:'scripts/art/space/ and loras.json from scripts/art/manifest.json (#703)'}},
    ...files.map(f=>({key:'file',value:{path:f.path,content:f.content.toString('base64'),encoding:'base64'}}))].map(x=>JSON.stringify(x)).join('\n')+'\n';
  r=await hub(`/api/spaces/${space}/commit/main`,{method:'POST',headers:{'content-type':'application/x-ndjson'},body:nd},token);
  if(r.status===401||r.status===403){console.error(`[space] HTTP ${r.status}: the token is read-only for ${space}: give it write access to that repo (https://huggingface.co/settings/tokens). ${scrub(await r.text().catch(()=>''))}`);return 2}
  if(!r.ok){console.error(`[space] upload failed: HTTP ${r.status} ${scrub(await r.text().catch(()=>''))}`);return 2}
  let commit='';try{const j=await r.json();commit=j.commitOid||j.commitUrl||''}catch{}
  console.log(`[space] uploaded ${files.map(f=>f.path).join(', ')}${commit?' ('+String(commit).slice(0,12)+')':''}`);
  // 4. ZeroGPU hardware (the Space builds and starts by itself after the commit)
  r=await hub(`/api/spaces/${space}/hardware`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({flavor:FLAVOR})},token);
  if(r.ok)console.log(`[space] hardware: ZeroGPU (${FLAVOR}) requested`);
  else console.log(`[space] the hardware request was refused (HTTP ${r.status} ${scrub(await r.text().catch(()=>''))}): choose ZeroGPU under Settings on ${spacePage(space)} once`);
  console.log(`[space] done: ${spacePage(space)} builds now (a few minutes). Then npm run art:daily -- --now; npm run art:space -- --status shows its state.`);
  return 0}

if(/space-push\.mjs$/.test(process.argv[1]||''))main().then(c=>process.exit(c),e=>{console.error(scrub(e&&e.message||e));process.exit(1)});
