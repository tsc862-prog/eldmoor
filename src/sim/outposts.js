// Contested outposts (#11). The world spec lists them (spec.outposts -> OUTPOSTS); this file owns who holds each.
// Control is one number per outpost, ctl in -100..100: positive leans to faction 0, negative to faction 1.
// Heroes of one faction standing within the outpost's radius push it their way (OP.RATE a hero a game minute);
// heroes of both factions present freeze it (contested). A faction holds an outpost from the moment ctl reaches
// its full end until ctl crosses zero. Holding gives a rest aura (heroes of the holder within OP.AURA tiles heal
// OP.HEAL of max HP a second) and kills within r + OP.NEAR tiles count double honor (outpostHonor, used by agentDie).
// Scripted background heroes sometimes pick the outpost as their hunting ground (outpostDest); agent-played heroes
// see them with the `outposts` tool and contest by standing there. No loops over zone or faction counts beyond the
// tables: the outposts come from the spec. State S.outposts is rebuilt per world id and saved with S.
import {S} from './state.js';
import {OUTPOSTS,zoneAt} from '../world/map.js';
import {FAC} from '../data/factions.js';
import {log} from './chronicle.js';
import {nearHeroes} from './spatial.js';
import {combatStats} from './stats.js';
const maxHp=a=>combatStats(a).health;

export const OP={ON:true,RATE:2,AURA:6,HEAL:.012,NEAR:2,GO_P:.25,STEP:.5};
const alive=a=>a.state!=='dead'&&a.state!=='town'&&a.state!=='camp'&&a.state!=='ghost'&&a.hp>0;

function st(){if(!S.outposts||S.outposts.world!==S.worldId||typeof S.outposts.o!=='object')S.outposts={world:S.worldId,t:0,flips:0,o:{}};
  for(const p of OUTPOSTS)if(!S.outposts.o[p.id])S.outposts.o[p.id]={ctl:0,hold:-1,contested:false,flips:0,since:0};
  return S.outposts}
export const holderOf=p=>{const s=st().o[p.id];return s?s.hold:-1};
// Who stands at the outpost now: counts per faction (the tables' faction count, not a literal 2).
function presence(p){const n=FAC.map(()=>0);for(const a of nearHeroes(p.x,p.y,p.r,alive))if(n[a.fac]!==undefined)n[a.fac]++;return n}

export function outpostsTick(dt){if(!OP.ON||!OUTPOSTS.length)return;const s=st();s.t-=dt;if(s.t>0)return;s.t=OP.STEP;
  const gm=OP.STEP*6; // game minutes per tick
  for(const p of OUTPOSTS){const o=s.o[p.id],n=presence(p),who=n.map((c,f)=>c?f:-1).filter(f=>f>=0);
    o.contested=who.length>1;
    if(who.length===1){const f=who[0],dir=f===0?1:-1,before=o.ctl;o.ctl=Math.max(-100,Math.min(100,o.ctl+dir*n[f]*OP.RATE*gm)); // RATE is per hero per game minute
      if(o.hold!==f&&Math.abs(o.ctl)>=100&&Math.sign(o.ctl)===dir){const prev=o.hold;o.hold=f;o.since=S.gameMin;o.flips++;s.flips++;
        log({t:p.name,c:'gd'},prev>=0?' falls to the ':' is taken by the ',{t:FAC[f].name,c:'f'+f},prev>=0?'; the '+FAC[prev].name+' banner comes down.':'; their banner goes up.')}
      else if(o.hold>=0&&o.hold!==f&&Math.sign(before)!==Math.sign(o.ctl)&&before!==0){const prev=o.hold;o.hold=-1;
        log({t:p.name,c:'gd'},' slips from the ',{t:FAC[prev].name,c:'f'+prev},'; no banner flies there now.')}}
    if(o.hold>=0){ // the holder's rest aura
      for(const a of nearHeroes(p.x,p.y,p.r+OP.AURA,alive))if(a.fac===o.hold&&a.hp<maxHp(a))a.hp=Math.min(maxHp(a),a.hp+maxHp(a)*OP.HEAL*OP.STEP)}}}

// Kills near an outpost count double honor (the killer's honor and the faction's).
export function outpostHonor(victim){if(!OP.ON)return 1;for(const p of OUTPOSTS)if(Math.hypot(victim.x-p.x,victim.y-p.y)<=p.r+OP.NEAR)return 2;return 1}

// A scripted hunter in an outpost's region (and level band) sometimes hunts around it instead: to take it, or to hold it
// against the other faction. Returns a point or null. Agent-played heroes choose for themselves.
// No RNG draws (the world's dice stream is untouched): a hash of the hero and the clock.
const hz=(a,k)=>{let h=(a.id*2654435761+Math.floor(S.gameMin/5)*40503+k*9973)>>>0;h^=h>>>15;h=Math.imul(h,2246822519)>>>0;h^=h>>>13;return (h>>>0)/4294967296};
export function outpostDest(a){if(!OP.ON||a.player||!OUTPOSTS.length)return null;const s=st();
  let best=null;for(const p of OUTPOSTS){if(p.z!==a.zone)continue;const o=s.o[p.id];
    if(o.hold===a.fac&&!o.contested&&Math.abs(o.ctl)>=100&&!presence(p).some((c,f)=>f!==a.fac&&c))continue; // safely ours and nobody threatens it
    if(!best||Math.hypot(p.x-a.x,p.y-a.y)<Math.hypot(best.x-a.x,best.y-a.y))best=p}
  if(!best||hz(a,1)>OP.GO_P)return null;const an=hz(a,2)*6.283,d=hz(a,3)*best.r*.8;return{x:best.x+Math.cos(an)*d,y:best.y+Math.sin(an)*d}}

// Read-only view for the DM (world_standing), the Faction panel and the agent tool.
export function outpostsView(){const s=st();return OUTPOSTS.map(p=>{const o=s.o[p.id],z=p.z;
  return{id:p.id,name:p.name,x:p.x,y:p.y,region:z,holder:o.hold,held_by:o.hold>=0?FAC[o.hold].name:null,
    control:Math.abs(o.ctl)>=100?'held':o.ctl===0?'unclaimed':'leaning '+FAC[o.ctl>0?0:1].name+' '+Math.round(Math.abs(o.ctl))+'%',ctl:Math.round(o.ctl),
    contested:!!o.contested,flips:o.flips,present:presence(p)}})}
export const outpostCounts=()=>{const n=FAC.map(()=>0);if(!OUTPOSTS.length)return n;const s=st();for(const p of OUTPOSTS){const h=s.o[p.id].hold;if(h>=0&&n[h]!==undefined)n[h]++}return n};
