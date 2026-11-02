// Timers that survive a background tab (issue: runner links blipping). Chrome stops requestAnimationFrame in a hidden or
// minimised tab and throttles page timers to once a second, then (after about 5 minutes hidden) to once a minute. A
// dedicated Web Worker's timers are not throttled that way, and its messages reach the page as events, so the page's
// bridge and, while hidden, the sim loop run off a worker clock instead. Without Worker/Blob (Node checks, old
// browsers) everything falls back to plain setTimeout.
let worker=null,tried=false,seq=0;const pend=new Map(),ticks=new Set();
const SRC="const t=new Map();onmessage=e=>{const m=e.data;if(m.cmd==='sleep')setTimeout(()=>postMessage({id:m.id}),m.ms);"+
  "else if(m.cmd==='tick'){if(t.has(m.id))clearInterval(t.get(m.id));t.set(m.id,setInterval(()=>postMessage({tick:m.id}),m.ms))}"+
  "else if(m.cmd==='untick'){clearInterval(t.get(m.id));t.delete(m.id)}};";
function w(){if(tried)return worker;tried=true;
  try{if(typeof Worker==='undefined'||typeof Blob==='undefined'||typeof URL==='undefined'||!URL.createObjectURL)return null;
    worker=new Worker(URL.createObjectURL(new Blob([SRC],{type:'text/javascript'})));
    worker.onmessage=e=>{const m=e.data||{};if(m.id!=null&&pend.has(m.id)){const f=pend.get(m.id);pend.delete(m.id);f()}else if(m.tick!=null){for(const t of ticks)if(t.id===m.tick)t.fn()}};
    worker.onerror=()=>{worker=null;for(const [,f] of pend)f();pend.clear()}}catch(e){worker=null}
  return worker}
// sleep(ms): resolves after ms on the worker clock (setTimeout without a worker).
export function sleep(ms){const k=w();if(!k)return new Promise(r=>setTimeout(r,ms));
  return new Promise(r=>{const id=++seq;pend.set(id,r);try{k.postMessage({cmd:'sleep',id,ms})}catch(e){pend.delete(id);setTimeout(r,ms)}})}
// every(ms, fn) -> stop(): fn runs on the worker clock; with no worker, on setInterval.
export function every(ms,fn){const k=w();if(!k){const i=setInterval(fn,ms);return()=>clearInterval(i)}
  const id=++seq,rec={id,fn};ticks.add(rec);k.postMessage({cmd:'tick',id,ms});
  return()=>{ticks.delete(rec);try{k.postMessage({cmd:'untick',id})}catch(e){}}}
