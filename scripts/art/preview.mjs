#!/usr/bin/env node
// npm run art:preview (#763): look at a generated building or landmark in the game before it is accepted. The contact sheet
// shows an image alone on grey and hides what goes wrong in a town (a facade instead of a roof, speckle beside the flat
// procedural houses, no silhouette, no footing), so art:accept takes a building or landmark only with this shot.
//   npm run art:preview -- building:stone-hall          one waiting key (no tier: the game's tier; alternates as #alt1)
//   npm run art:preview -- all                          every waiting building and landmark
//   --dir DIR (assets folder, default assets/), --url URL (a running dev server; default: its own Vite on --port, 5906),
//   --port N, CHROME_PATH (else Chrome or Edge where Windows and Linux put them)
// For each key: a fresh headless browser at 3440x1440 (the owner's screen) opens the game (?continue=1), stops the clock at
// noon, takes every generated town and landmark piece out (so the neighbours are the procedural houses), installs the
// candidate from assets/incoming/<date>/ in memory only, and captures the map at camera zoom 1 (the default view) as
// <name>.preview.png next to the inbox image, plus <name>.preview-close.png at zoom 4 centred on the piece. The inbox
// index entry gets preview {file, close, sha256 (of the image looked at), shot, view {w, h, zoom}, town, at}, which
// art:accept checks. Nothing is written under assets/ but the inbox; no network beyond localhost; no key.
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,mkdtempSync,rmSync} from 'node:fs';
import {join,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {ASSETS,ROOT,loadQueue,loadIndex,sha256,TILE,PREVIEW_KINDS} from './lib.mjs';
import {parseArgs,writeIndex} from './gen.mjs';

export const VIEW={w:3440,h:1440,zoom:1};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const BROWSERS=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean);

// Where the shots of a waiting key go: beside its image in the inbox (paths relative to assets/incoming/<date>/).
export function shotFiles(file){const b=file.replace(/\.png$/,'');return {file:`${b}.preview.png`,close:`${b}.preview-close.png`}}
// The record art:accept checks, written into the inbox index entry of key.
export function recordPreview(dir,key,{shot,close,town,view=VIEW,at=new Date().toISOString()}){
  const q=loadQueue(dir),w=q.incoming[key];if(!w)throw new Error(`${key} is not waiting for review`);
  const inc=join(dir,'incoming',w.date),ii=loadIndex(inc),png=readFileSync(join(inc,w.file)),f=shotFiles(w.file);
  writeFileSync(join(inc,f.file),shot);if(close)writeFileSync(join(inc,f.close),close);
  ii.assets[key]={...(ii.assets[key]||{}),preview:{file:f.file,...(close?{close:f.close}:{}),sha256:sha256(png),shot:sha256(shot),view,town,at}};
  writeIndex(inc,ii);return {inc,...f}}

async function waitHttp(url,ms=60000){const t=Date.now();while(Date.now()-t<ms){try{const r=await fetch(url);if(r.ok)return true}catch{}await sleep(400)}return false}

// One browser page over the DevTools protocol (Node's own WebSocket).
async function browser(w,h){const bin=BROWSERS.find(p=>existsSync(p));if(!bin)throw new Error('no Chrome or Edge found; set CHROME_PATH');
  const port=9400+Math.floor(Math.random()*400),prof=mkdtempSync(join(tmpdir(),'eldmoor-preview-'));
  const proc=spawn(bin,['--headless=new','--hide-scrollbars','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-extensions',
    ...(process.env.CHROME_NO_SANDBOX?['--no-sandbox']:[]),`--window-size=${w},${h}`,`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1',`--user-data-dir=${prof}`,'about:blank'],{stdio:'ignore'});
  let page;for(let i=0;i<120&&!page;i++){try{page=(await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t=>t.type==='page')}catch{await sleep(250)}}
  if(!page){proc.kill();throw new Error('the browser gave no DevTools page')}
  const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
  let id=0;const pending=new Map();ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id&&pending.has(d.id)){pending.get(d.id)(d);pending.delete(d.id)}};
  const send=(method,params={})=>new Promise(r=>{const i=++id;pending.set(i,r);ws.send(JSON.stringify({id:i,method,params}))});
  const evalJs=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});if(r.result&&r.result.exceptionDetails)throw new Error('page: '+JSON.stringify(r.result.exceptionDetails).slice(0,400));return r.result&&r.result.result&&r.result.result.value};
  await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});
  const shot=async()=>Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64');
  return {send,evalJs,shot,close:()=>{try{ws.close()}catch{}try{proc.kill()}catch{}setTimeout(()=>{try{rmSync(prof,{recursive:true,force:true})}catch{}},1500)}}}

// The page side: procedural neighbours, the candidate installed, the camera on its town. Returns {town, box} or {error}.
const stage=(id,b64)=>`(async()=>{
  const A=await import('/src/render/assets.js'),TA=await import('/src/render/townart.js'),D=await import('/src/render/draw.js'),C=await import('/src/ui/controls.js');
  const {S}=await import('/src/sim/state.js'),{CITY}=await import('/src/world/map.js'),TD=await import('/src/data/townart.js'),{U}=await import('/src/render/tile.js');
  for(const sel of ['#setup','#ralert','#title'])for(const e of document.querySelectorAll(sel))e.style.display='none';
  C.ctl.speed=0;S.gameMin=Math.floor(S.gameMin/1440)*1440+720;
  for(const k of [...Object.keys(TA.ASSET_TOWNS),...A.assetIds().filter(k=>/^(building|tile):lpc-/.test(k))])if(A.hasAsset(k))A.setAssetPixels(k,null);
  const img=new Image();img.src='data:image/png;base64,${b64}';await img.decode();
  const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);
  A.setAssetPixels(${JSON.stringify(id)},A.pixelsOf(c.width,c.height,x.getImageData(0,0,c.width,c.height).data));
  let town=null,box=null;const m=/^building:([a-z]+)-/.exec(${JSON.stringify(id)});
  if(m){const t=CITY.find(t=>TD.townStyle(t)===m[1]);if(!t)return {error:'no town of style '+m[1]};town=t.name;box=TA.townPlan(t).find(p=>p.id===${JSON.stringify(id)}).box}
  else{const p=TA.landmarkPlan().find(p=>p.id===${JSON.stringify(id)});if(!p)return {error:'no landmark for this id on this map'};town=p.L.name||p.L.kind;box=p.box}
  window.__pv={x:(box[0]+box[2]/2)*U,y:(box[1]+box[3]/2)*U};C.setView('map');D.setZoom(${VIEW.zoom});return {town,box}})()`;
const closeUp=`(async()=>{const D=await import('/src/render/draw.js');D.setZoom(4);D.cam.camX=window.__pv.x;D.cam.camY=window.__pv.y;return true})()`;

export async function main(argv=process.argv.slice(2)){
  const o=parseArgs(argv,['dir','url','port']),dir=o.dir||ASSETS,q=loadQueue(dir),waiting=Object.keys(q.incoming).sort();
  const isGated=k=>PREVIEW_KINDS.includes(k.split(':')[0]);
  const keys=o._.includes('all')?waiting.filter(isGated):o._.map(k=>/@\d+/.test(k)?k:k.replace(/^([^#]*)/,`$1@${TILE}`));
  if(!keys.length){console.log('[art] usage: npm run art:preview -- <building or landmark key>|all (nothing to preview)');return o._.length?0:2}
  const bad=keys.filter(k=>!q.incoming[k]||!isGated(k));if(bad.length){console.error(`[art] not a waiting building or landmark: ${bad.join(', ')} (npm run art:accept -- --list)`);return 2}
  let url=o.url,vite=null;
  if(!url){const port=Number(o.port)||5906;url=`http://localhost:${port}`;
    vite=spawn(process.execPath,[join(ROOT,'node_modules','vite','bin','vite.js'),'--port',String(port),'--strictPort'],{cwd:ROOT,stdio:'ignore'});
    if(!await waitHttp(url+'/')){vite.kill();console.error(`[art] Vite did not start on ${url}`);return 1}}
  let made=0;
  try{for(const k of keys){const w=q.incoming[k],inc=join(dir,'incoming',w.date),png=readFileSync(join(inc,w.file)),{id}={id:k.replace(/@.*$/,'')};
      const b=await browser(VIEW.w,VIEW.h);
      try{await b.send('Page.navigate',{url:url+'/?continue=1'});await sleep(6000);
        const r=await b.evalJs(stage(id,png.toString('base64')));if(!r||r.error){console.error(`[art] ${k}: ${r?r.error:'the page did not answer'}`);continue}
        await sleep(2500);const shot=await b.shot();await b.evalJs(closeUp);await sleep(2000);const close=await b.shot();
        const f=recordPreview(dir,k,{shot,close,town:r.town});made++;
        console.log(`[art] ${k}: in ${r.town} at zoom ${VIEW.zoom}, ${VIEW.w}x${VIEW.h} -> ${join(f.inc,f.file)} (close-up ${basename(f.close)}). Look at it beside the procedural houses, then npm run art:accept -- ${k} or --reject`)}
      finally{b.close()}}}
  finally{if(vite)vite.kill()}
  return made===keys.length?0:1}

if(/preview\.mjs$/.test(process.argv[1]||''))main().then(c=>process.exit(c),e=>{console.error(e);process.exit(1)});
