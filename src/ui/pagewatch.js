// Page watchdog (#736): how long each frame of the page takes, so a page that stops answering the relay names the cost.
// The page answers the agents' tool calls on the same thread that draws the map (ui/player-bridge.js), so a frame that
// takes seconds is a page the relay gives up on ("no answer in time") and runners that read the world as offline.
//   frameDone({ms, sim, render, ui}, now)  main.js, once a frame: the frame's own cost split into its halves
//   gapSeen(ms, now)                         main.js: the time between two frames when it is far over a frame (the thread
//                                            was busy outside the frame loop: a tool call, a layout, a long message)
//   setWhere(fn)                             what was on screen: fn() -> short text (world, scene kind, dungeon room, canvas size)
//   relayLate(info, now)                     the relay timed a call to this page out (it says so over the play socket)
//   pageBusy(now) -> {ms, why} | null        a frame of BUSY_MS or more in the last BUSY_SHOW_MS, or a relay time-out: the
//                                            link labels read "page busy (3.2 s frame)" instead of connecting
//   takeAnomalies() / pageDigest()           for the behavior logs (ui/player-bridge.js): page-stall anomalies as they fire,
//                                            and the hour's {longFrames, worstMs, where} carried on the world digest
// DOM-free (the uismoke stub drives it with a fake clock); never touches the sim.
export const PW={
  STALL_MS:250,        // a frame (or a gap between frames) this long is a long frame: one console line, counted
  BIG_MS:2000,         // one frame this long is a page-stall anomaly at once
  RUN_N:3,RUN_MS:60000,// or RUN_N long frames within RUN_MS
  BUSY_MS:1000,        // a frame this long makes the link labels read page busy ...
  BUSY_SHOW_MS:30000,  // ... for this long after it (a relay time-out too)
  LINE_GAP_MS:1000,    // at most one console line a second
  KEEP:20,             // long frames kept for the probe and the digest
};
const st={long:[],out:[],hour:{n:0,worst:0,where:null},busy:null,lineAt:-1e9,where:()=>'world',log:(...a)=>{try{console.warn(...a)}catch(e){}}};
export function setWhere(fn){if(typeof fn==='function')st.where=fn}
export function setPageLog(fn){st.log=typeof fn==='function'?fn:()=>{}}
const r1=x=>Math.round(x||0);
const secs=ms=>(ms/1000).toFixed(1)+' s';
function whereNow(){try{return String(st.where()||'?').slice(0,120)}catch(e){return '?'}}
function long(rec,now){
  rec.at=now;rec.where=whereNow();st.long.push(rec);if(st.long.length>PW.KEEP)st.long.shift();
  const h=st.hour;h.n++;if(rec.ms>h.worst){h.worst=rec.ms;h.where=rec.where}
  if(rec.ms>=PW.BUSY_MS)st.busy={ms:rec.ms,at:now,why:'frame'};
  if(now-st.lineAt>=PW.LINE_GAP_MS){st.lineAt=now;
    st.log('[page] '+r1(rec.ms)+' ms '+(rec.gap?'between frames':'frame')+(rec.gap?'':' (sim '+r1(rec.sim)+', render '+r1(rec.render)+', ui '+r1(rec.ui)+' ms)')+' · '+rec.where)}
  const recent=st.long.filter(x=>now-x.at<=PW.RUN_MS);
  if(rec.ms>=PW.BIG_MS||recent.length>=PW.RUN_N){
    st.out.push({kind:'page-stall',seat:'page',severity:rec.ms>=PW.BIG_MS?'bad':'warn',
      text:(rec.ms>=PW.BIG_MS?'the page froze for '+secs(rec.ms):recent.length+' frames over '+PW.STALL_MS+' ms in a minute (worst '+secs(Math.max(...recent.map(x=>x.ms)))+')')+' · '+rec.where,
      evidence:{ms:r1(rec.ms),sim:r1(rec.sim),render:r1(rec.render),ui:r1(rec.ui),gap:!!rec.gap,where:rec.where,longFrames:recent.length}});
    if(rec.ms<PW.BIG_MS)for(const x of recent)x.at=-1e12; // one anomaly per run of long frames, not one per frame after the third
    if(st.out.length>20)st.out.shift()}}
// The last RING frames' costs (no allocation a frame), for npm run shoot -- --crawl and probes: frameSamples() -> {n, total, render}
const RING=600,ringT=new Float32Array(RING),ringR=new Float32Array(RING);let ringI=0,ringN=0;
export function frameSamples(){const n=ringN,t=[],r=[];for(let k=0;k<n;k++){const j=(ringI-n+k+RING)%RING;t.push(ringT[j]);r.push(ringR[j])}return {n,total:t,render:r}}
export function clearSamples(){ringI=0;ringN=0}
export function frameDone(f,now){const ms=+f.ms||0;ringT[ringI]=ms;ringR[ringI]=+f.render||0;ringI=(ringI+1)%RING;if(ringN<RING)ringN++;if(ms<PW.STALL_MS)return false;long({ms,sim:+f.sim||0,render:+f.render||0,ui:+f.ui||0},now);return true}
export function gapSeen(ms,now){if(!(ms>=PW.STALL_MS))return false;long({ms,gap:true,sim:0,render:0,ui:0},now);return true}
// The relay timed out a call to this page (scripts/relay-mcp.mjs sends {type:'pagelate', tool, ms, silentMs}).
export function relayLate(info,now=clock()){const ms=Math.max(+(info&&info.silentMs)||0,+(info&&info.ms)||0);st.busy={ms,at:now,why:'relay',tool:info&&info.tool||null}}
const clock=()=>typeof performance!=='undefined'?performance.now():Date.now();
export function pageBusy(now=clock()){const b=st.busy;return b&&now-b.at<=PW.BUSY_SHOW_MS?{ms:b.ms,why:b.why}:null}
export const busyText=b=>b?'page busy ('+(b.why==='relay'?'no answer for '+secs(b.ms):secs(b.ms)+' frame')+')':'';
export function takeAnomalies(){const o=st.out.slice();st.out.length=0;return o}
// The hour's long frames for the world digest; resets the counters.
export function pageDigest(){const h=st.hour,o={longFrames:h.n,worstMs:r1(h.worst),where:h.where};st.hour={n:0,worst:0,where:null};return o}
export const pageStats=()=>({long:st.long.map(x=>({...x})),hour:{...st.hour},busy:st.busy?{...st.busy}:null});
export function resetPageWatch(){st.long.length=0;st.out.length=0;st.hour={n:0,worst:0,where:null};st.busy=null;st.lineAt=-1e9}
