// PvP finish or spare, and life-debts (#657, epic #626 slice 4). Owned by ai-designer.
// A hero's blow that brings an enemy hero to zero HP downs them (sim/downed.js) instead of killing them. The victor then
// stands over them and chooses:
//   finish  the downed enemy dies (slay in heroes.js): honour, the kill XP and the gold go to the finisher only, and the
//           fallen hero's whole guild swears vengeance on the finisher, as for a death at GUILD_GRUDGE_LVL or above.
//   spare   the victor binds nothing and takes nothing: the downed is left stable (wakes on 1 HP after DOWN.WAKE) and owes
//           the sparer a life (a.debts[sparerId], the inverse of a nemesis): they will not raise a hand against the
//           sparer (no duel, no charge, no assist against them) and owe one helping hand, paid the first time the
//           sparer is down near them or hard pressed by a creature near them. Both get a landmark; the chronicle names it.
// A downed enemy left to bleed out dies with no credit to anyone (heroes.js slay {bled}); the usual grudge rule holds.
// Scripted victors decide at once by boldness and mercy (one rnd()); an agent victor whose runner holds it gets an urgent
// event and the finish/spare tools, MERCY.WAIT game minutes, then its reflex decides the same way.
// Stats on S.mercyStats (finished, spared, bled, repaid, held: a blow held back by a debt).
import {rnd,clamp} from '../core/rng.js';
import {dist,zoneAt,ZONES} from '../world/map.js';
import {S,mayFight} from './state.js';
import {log} from './chronicle.js';
import {pop} from './effects.js';
import {record} from './history.js';
import {ev} from './notify.js';
import {tm} from '../data/traits.js';
import {nearHeroes} from './spatial.js';
import {held} from './scenes.js';
import {reflexMay} from './runlink.js';
import {DOWN,isDown,tellNear} from './downed.js';
import {slay,maxHp} from './heroes.js';

export const MERCY={
  REACH:4,       // tiles: a downed enemy can be finished or spared from here
  WAIT:30,       // game minutes an agent victor whose runner holds it has to choose before its reflex does
  FINISH:.5,     // a scripted victor's odds of finishing, times boldness, divided by mercy
  SWORN:1.5,     // ... times this when the downed had sworn vengeance on the victor (they came for blood)
  MIN:.1,MAX:.9, // clamp on the odds
  REPAY_R:8,     // tiles: a debtor this near the sparer repays
  REPAY_HP:.5,   // the sparer below this share of max HP in a fight with a creature
  REPAY_LVL:3,   // a debtor does not throw itself at a creature more than this many levels above it
};
const M=MERCY;
const now=()=>S.gameMin;
export const mercyStats=()=>S.mercyStats||(S.mercyStats={finished:0,spared:0,bled:0,repaid:0,held:0});
export const mercyCount=k=>{mercyStats()[k]++};
const byId=id=>S.agents.find(x=>x.id===id)||null;
const alive=b=>!!b&&b.state!=='dead';
const free=b=>(b.state==='hunt'||b.state==='travel'||b.state==='return')&&!held(b);
// a owes b a life: a will not raise a hand against b.
export const owes=(a,b)=>!!(a&&b&&a.debts&&a.debts[b.id]);
const lv=a=>({t:'(level '+a.lvl+')',c:'dm'});

// ---- the victor's choice ----
// goDown (downed.js) calls this once an enemy hero's blow has downed a.
export function pvpDowned(a,k){if(!a.down||!k||k.kind!=='hero')return;
  a.down.victor=k.id;a.down.until=now()+M.WAIT;
  ev(a,k.name+' stands over you. They may finish you or spare you.',2);
  if(k.player&&!reflexMay(k)){ // an agent whose runner holds it: its decision
    ev(k,a.name+' lies downed at your feet. finish {hero:"'+a.name+'"} to end them (honour, XP and their gold are yours; their guild will want your blood) or spare {hero:"'+a.name+'"} (they will owe you a life). '+M.WAIT+' game minutes to choose.',2);
    return}
  decide(k,a)}

// The scripted choice (and an agent's reflex): one die, boldness against mercy; a sworn blood debt is always paid.
export function finishOdds(k,a){if(k.nemesis&&k.nemesis[a.id])return 1;
  return clamp(M.FINISH*tm(k,'bold')/tm(k,'mercy')*(a.nemesis&&a.nemesis[k.id]?M.SWORN:1),M.MIN,M.MAX)}
function decide(k,a){const p=finishOdds(k,a);if(p>=1||rnd()<p)finish(k,a);else spare(k,a)}

// Each pvp tick: a waiting agent victor whose time ran out (or whose runner left) lets its reflex choose, if still near.
export function mercyTick(){for(const a of S.agents){const d=a.down;if(!d||d.victor==null||!isDown(a))continue;
  const k=byId(d.victor);if(!alive(k)||isDown(k)||dist(k,a)>DOWN.REACH){d.victor=null;continue}
  if(now()>=d.until||reflexMay(k))decide(k,a)}}

// Finish: the one road for a hero to kill a downed hero on purpose. Credit and the guild grudge come from slay().
export function finish(k,a){if(!isDown(a))return false;
  for(const b of S.agents)if(b.aid===a.id){b.aid=null;if(b.aidHow)b.aidHow=null;if(b.state==='aid'){b.state='hunt';b.dest=null}}
  pop(a.x,a.y-.8,'FINISHED','#ff4a3a');tellNear(a,'finished'); // agent heroes in range hear it (#658)
  a.down=null;a.hp=0;
  slay(a,k,{finish:true});
  return true}

// Spare: the downed is left stable and owes the sparer a life.
export function spare(k,a){if(!isDown(a))return false;const d=a.down;mercyCount('spared');
  d.victor=null;d.spared=k.id;if(!d.stable){d.stable=true;d.s=Math.max(d.s,DOWN.SAVES);d.wake=now()+DOWN.WAKE}
  (a.debts||(a.debts={}))[k.id]={name:k.name,fac:k.fac,day:Math.floor(now()/1440)+1};
  pop(a.x,a.y-.8,'SPARED','#9ad0ff');
  record(k,'Spared ',a,' where they lay.');
  record(a,'Was spared by ',k,' and owes them a life.');
  log(k,' spared ',a,' ',lv(a),' in ',ZONES[zoneAt(a.x,a.y)],' and walked away. ',a,' owes them a life.');
  ev(a,k.name+' spared you and left you stable. You owe them a life: you will not raise a hand against them, and you owe them one helping hand.',2);
  if(k.player)ev(k,'You spared '+a.name+'. They owe you a life.',1);
  return true}

// ---- the life-debt ----
// The debtor repays once: the sparer down near them (they come to aid, sim/downed.js aidStep) or hard pressed by a
// creature near them (they join the fight). Debts to the dead lapse.
export function debtTick(){for(const a of S.agents){if(!a.debts||a.state==='dead')continue;
  for(const id in a.debts){const c=byId(Number(id));
    if(!alive(c)){delete a.debts[id];continue}
    if(!free(a)||dist(a,c)>(isDown(c)?DOWN.REACH:M.REPAY_R))continue;
    if(isDown(c)){if(S.agents.some(b=>b.aid===c.id&&b.state==='aid'))continue;
      a.state='aid';a.aid=c.id;a.aidAt=now();a.aidNext=0;a.target=null;a.dest=null;repaid(a,c);break}
    const m=c.state==='fight'&&c.target;
    if(m&&m.kind==='mob'&&m.alive&&c.hp<maxHp(c)*M.REPAY_HP&&m.lvl<=a.lvl+M.REPAY_LVL){
      a.state='fight';a.target=m;a.dest=null;repaid(a,c);break}}
  if(a.debts&&!Object.keys(a.debts).length)delete a.debts}}
function repaid(a,c){delete a.debts[c.id];mercyCount('repaid');
  record(a,'Repaid the life owed to ',c,'.');
  record(c,a.name+' repaid the life they owed you.');
  log(a,' came to the aid of ',c,', who once spared them: the life-debt is paid.');
  ev(c,a.name+', whom you once spared, comes to your aid.',1)}

// ---- agent tools: finish {hero}, spare {hero} ----
function downedEnemy(a,hero){const k=String(hero==null?'':hero).toLowerCase().trim();if(!k)return {error:'Name the downed hero: hero (name or id).'};
  const t=nearHeroes(a.x,a.y,M.REACH+1).find(b=>b!==a&&(String(b.id)===k||b.name.toLowerCase()===k||b.name.toLowerCase().split(' ')[0]===k));
  if(!t)return {error:'No hero by that name within '+M.REACH+' tiles.'};
  if(!isDown(t))return {error:t.name+' is not down.'};
  if(!mayFight(a,t))return {error:t.name+' is of your own faction: help them instead (stabilize, a heal, a potion).'};
  if(dist(a,t)>M.REACH)return {error:t.name+' lies too far off: come within '+M.REACH+' tiles.'};
  return {t}}
export function finishTool(a,hero){if(isDown(a))return {error:'You are down yourself.'};
  const r=downedEnemy(a,hero);if(r.error)return r;const t=r.t;
  if(owes(a,t)){mercyCount('held');return {error:'You owe '+t.name+' a life: you will not raise a hand against them.'}}
  const lvl=t.lvl;finish(a,t);
  return {ok:true,result:'You finish '+t.name+' (level '+lvl+'). Their honour, gold and the kill are yours, and their guild will want your blood.'}}
export function spareTool(a,hero){if(isDown(a))return {error:'You are down yourself.'};
  const r=downedEnemy(a,hero);if(r.error)return r;const t=r.t;
  spare(a,t);
  return {ok:true,result:'You spare '+t.name+' and leave them stable. They owe you a life: they will not raise a hand against you, and owe you one helping hand.'}}
