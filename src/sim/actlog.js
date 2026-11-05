// Action log (owner request): what each hero did and what was done to it. Recording only: no RNG, no entity scans,
// no effect on combat. The combat code calls the tiny recorders below at points it already passes through.
//
// Storage: a ring of CAP entries and the last FCAP fight summaries per hero, held in a NON-ENUMERABLE property
// (a._al) so JSON saves skip it: the buffers are not saved and rebuild as play continues (savecheck unchanged,
// save files do not grow by ~300 entries x 100+ heroes). Every hero records, so the watcher can open anyone.
//
// A fight opens on the first hit or hurt and is settled after FIGHT_GAP game minutes with no combat entry (a pack
// of three boars is one fight). Result: 'died' (death), 'fled' (only after a flee), 'won' (a kill, or kill xp shared from a companion's), 'over' (ended with the foe alive),
// 'ongoing' while the last combat entry is within the gap. miss/dodge/block are in the kind list but the combat
// code rolls no such outcome today, so nothing records them.
import {S} from './state.js';
import {MOBS} from '../data/mobs.js';

export const CAP=300,FCAP=20,FIGHT_GAP=30; // game minutes
const store=a=>a._al||(Object.defineProperty(a,'_al',{value:{b:[],n:0,f:[],cur:null,fid:0},writable:true,enumerable:false}),a._al);
export const nameOf=e=>!e?null:e.kind==='hero'?e.name:e.kind==='boss'?'Kragmaw':e.name||(MOBS[e.type]&&MOBS[e.type].name)||'a foe';

function close(st,t){const c=st.cur;if(!c)return;
  c.end=c.last;c.result=c.died?'died':c.fled?'fled':c.kills>0||c.xp>0?'won':'over';
  st.f.push(c);if(st.f.length>FCAP)st.f.shift();st.cur=null}
const settle=(st,t)=>{if(st.cur&&t-st.cur.last>FIGHT_GAP)close(st,t)};
function open(st,t,foe){settle(st,t);
  if(!st.cur)st.cur={id:++st.fid,foe,start:t,end:t,last:t,dealt:0,taken:0,healed:0,abilities:{},items:{},crits:0,kills:0,xp:0,died:false,fled:false,result:'ongoing'};
  st.cur.last=t;return st.cur}
function put(st,e){const i=st.n%CAP;st.b[i]=e;st.n++}

// ---- recorders (one-liners at the combat points) ----
export function actHit(a,t,d,crit){if(a.kind!=='hero')return;const st=store(a),T=S.gameMin,c=open(st,T,nameOf(t));
  c.dealt+=d;if(crit)c.crits++;put(st,{t:T,kind:'hit',who:a.name,target:nameOf(t),name:null,amount:d,crit:!!crit,fight:c.id})}
export function actHurt(h,src,d,note){if(h.kind!=='hero')return;const st=store(h),T=S.gameMin,c=open(st,T,nameOf(src));
  c.taken+=d;put(st,{t:T,kind:'hurt',who:nameOf(src),target:h.name,name:note||null,amount:d,fight:c.id})}
export function actHeal(a,on,amt,name){if(amt<=0)return;const T=S.gameMin;
  if(a.kind==='hero'){const st=store(a);settle(st,T);if(st.cur){st.cur.healed+=amt;st.cur.last=T}
    put(st,{t:T,kind:'heal',who:a.name,target:nameOf(on),name:name||null,amount:amt,fight:st.cur?st.cur.id:undefined})}
  if(on!==a&&on.kind==='hero'){const s2=store(on);settle(s2,T);if(s2.cur)s2.cur.last=T;
    put(s2,{t:T,kind:'healed',who:on.name,target:nameOf(a),name:name||null,amount:amt,fight:s2.cur?s2.cur.id:undefined})}}
export function actAbility(a,name,t,amt){if(a.kind!=='hero')return;const st=store(a),T=S.gameMin;settle(st,T);
  if(st.cur){st.cur.abilities[name]=(st.cur.abilities[name]||0)+1;st.cur.last=T}
  put(st,{t:T,kind:'ability',who:a.name,target:t&&t!==a?nameOf(t):null,name,amount:amt||null,fight:st.cur?st.cur.id:undefined})}
export function actPassive(a,name,note){if(a.kind!=='hero')return;const st=store(a);
  put(st,{t:S.gameMin,kind:'passive',who:a.name,target:null,name,amount:null,note:note||undefined})}
export function actItem(a,name,on,amt){if(a.kind!=='hero')return;const st=store(a),T=S.gameMin;settle(st,T);
  if(st.cur){st.cur.items[name]=(st.cur.items[name]||0)+1;st.cur.last=T}
  put(st,{t:T,kind:'item',who:a.name,target:on&&on!==a?nameOf(on):null,name,amount:amt||null,fight:st.cur?st.cur.id:undefined})}
export function actKill(a,m){if(a.kind!=='hero')return;const st=store(a),T=S.gameMin;settle(st,T);
  if(st.cur){st.cur.kills++;st.cur.last=T}
  put(st,{t:T,kind:'kill',who:a.name,target:nameOf(m),name:null,amount:null,fight:st.cur?st.cur.id:undefined})}
export function actDeath(a,killer){if(a.kind!=='hero')return;const st=store(a),T=S.gameMin;
  if(st.cur){st.cur.died=true;st.cur.last=T}
  put(st,{t:T,kind:'death',who:a.name,target:nameOf(killer),name:null,amount:null,fight:st.cur?st.cur.id:undefined});close(st,T)}
export function actFlee(a){if(a.kind!=='hero')return;const st=store(a),T=S.gameMin;
  if(st.cur){st.cur.fled=true;st.cur.last=T}
  put(st,{t:T,kind:'flee',who:a.name,target:null,name:null,amount:null,fight:st.cur?st.cur.id:undefined});close(st,T)}
// xp, loot and level: a note, no fight bookkeeping.
export function actNote(a,kind,name,amt){if(a.kind!=='hero')return;const st=store(a),T=S.gameMin;
  if(kind==='xp'&&st.cur&&T-st.cur.last<=FIGHT_GAP)st.cur.xp++; // shared kill xp: a companion's kill is still a win
  put(st,{t:T,kind,who:a.name,target:null,name:name||null,amount:amt==null?null:amt,fight:st.cur?st.cur.id:undefined})}

// ---- read API ----
export function actionLog(a,o={}){const st=a&&a._al;if(!st)return [];
  const out=[],n=Math.min(st.n,CAP),kinds=o.kinds&&o.kinds.length?o.kinds:null;
  for(let k=st.n-n;k<st.n;k++){const e=st.b[k%CAP];if(o.since!=null&&e.t<o.since)continue;if(kinds&&!kinds.includes(e.kind))continue;out.push(e)}
  return o.n>0&&out.length>o.n?out.slice(out.length-o.n):out}
const view=(c,live)=>({id:c.id,foe:c.foe,start:c.start,end:live?c.last:c.end,dealt:c.dealt,taken:c.taken,healed:c.healed,abilities:{...c.abilities},items:{...c.items},crits:c.crits,kills:c.kills,
  result:live?'ongoing':c.result});
export function fights(a,n=5){const st=a&&a._al;if(!st)return [];settle(st,S.gameMin);
  const l=st.f.map(c=>view(c,false));if(st.cur)l.push(view(st.cur,true));return n>0&&l.length>n?l.slice(l.length-n):l}
export function fightSummary(a,fight){const l=fights(a,FCAP+1);if(!l.length)return null;
  return fight==null?l[l.length-1]:l.find(f=>f.id===fight)||null}
