// Downed and death saves (epic #626, slices 1a #652 and 1b #653). A hero at zero HP is downed, not dead:
// prone, no actions, not a target of choice. Away from a Table scene a downed hero rolls a death save every
// DOWN.TICK game minutes (d20: 10+ a success, under 10 a failure, a 20 up on 1 HP, a 1 two failures); a blow
// taken while down is a failure (a critical two). Three successes and someone standing near = stable (wakes on
// 1 HP after DOWN.WAKE game minutes, or at once when healed); three failures (four while a healer stands within
// heal range), a blow from zero past full health, a finishing blow from a hero, or nobody standing within reach
// when the saves run out is the end: slay() in heroes.js, the one choke point that calls fall().
// Bringing them back: a heal (priestHeal, a class heal move: + DOWN.HEALER_BONUS of max HP), a potion (party
// mates, adjacent) or stabilize (d20 + Healing vs DOWN.STAB_DC, automatic with a Linen Bandage), done by a
// nearby party, company or guild mate who drops what they were doing ('aid' state).
// Same dice for every hero (the shared rng), no new random stream.
// At the table (#654): a downing in a combat scene keeps the hero in it, downed; a downing in the world with an agent
// involved opens a rescue scene (table.js due). There the saves are per round, in initiative order (tableSave), and a
// companion's act may heal, give a potion or stabilize (stabilizeAt); the world's clock leaves them be (savesAtTable).
// In the Crypt crawl a hero at zero is downed too (crawlDown): the room's dice roll the saves, a wipe ends them all.
// Not yet: Watch-mode clock (#655), wounds (#656), PvP spare (#657), agent tools and gambits (#658), UI (#659).
import {ri} from '../core/rng.js';
import {dist} from '../world/map.js';
import {CLS} from '../data/classes.js';
import {MOBS} from '../data/mobs.js';
import {blockOf} from '../data/bestiary.js';
import {S} from './state.js';
import {log} from './chronicle.js';
import {pop} from './effects.js';
import {record} from './history.js';
import {nearHeroes} from './spatial.js';
import {companyOf} from './company.js';
import {ev} from './notify.js';
import {skillMod} from './abilities.js';
import {count,take,bestUse,useItem} from './inv.js';
import {nearDeath} from './lore.js';
import {held,sceneOf} from './scenes.js';
import {maxHp,moveTo,healOne,slay,fall} from './heroes.js';

export const DOWN={
  TICK:10,          // game minutes between death saves away from a table
  DC:10,            // a death save: d20, this or more a success
  SAVES:3,          // successes to stabilize, failures to die
  HEALER_FAILS:4,   // failures to die while a healer of theirs stands within heal range
  WAKE:60,          // game minutes a stable hero lies before waking on 1 HP
  HEALER_BONUS:.15, // a healer's heal on the downed brings them up this share of max HP higher
  HEAL_RANGE:5,     // tiles: a heal reaches the downed from here
  ADJ:1,            // tiles: a potion, a bandage or stabilize needs this close
  STAB_DC:10,       // stabilize: d20 + Healing against this
  REACH:12,         // tiles: who counts as near enough to help (the shout range, #182)
  AID_FROM:['hunt','travel','follow','return','regroup'], // what a helper may drop to come
  AID_MAX:120,      // game minutes a helper keeps at it before giving up
};

const R=DOWN;
const now=()=>S.gameMin;
const stats=()=>S.downStats||(S.downStats={downed:0,stable:0,revived:0,rose:0,woke:0,stabilized:0,died:0,why:{fails:0,massive:0,finish:0,alone:0}});
export const downStats=()=>stats();
export const isDown=a=>!!a&&a.state==='downed';
const standing=b=>b&&b.kind==='hero'&&b.state!=='dead'&&b.state!=='downed'&&!b.hidden&&b.hp>0;
const heroById=id=>S.agents.find(x=>x.id===id)||null;
// Who would come for a downed hero: their party, company or guild, of their faction.
const kin=(a,b)=>b!==a&&b.fac===a.fac&&((a.party&&b.party===a.party)||(a.company!=null&&b.company===a.company)||(a.guild&&b.guild===a.guild));
const healer=b=>!!CLS[b.cls]&&!!CLS[b.cls].heal;
const nearKin=(a,r)=>nearHeroes(a.x,a.y,r).filter(b=>standing(b)&&kin(a,b)&&dist(a,b)<=r);
// The share of max HP a healer's heal adds when it lands on the downed (heroes.js healOne, moves.js heal moves).
export const reviveBonus=t=>isDown(t)?Math.round(maxHp(t)*R.HEALER_BONUS):0;

// ---- going down (agentDie in heroes.js asks first) ----
// Returns true when the hero is downed instead of slain; false sends the blow on to slay() (the death choke point).
export function goDown(a,killer){
  if(!a||a.kind!=='hero'||!killer)return false;
  if(isDown(a))return false;                                            // already down: a blow that reaches here finishes them
  if(killer.kind==='hero'){stats().why.finish++;return false}           // PvP: the victor finishes them (spare comes with #657)
  if(a.hidden||a.state==='dungeon')return false;                        // below ground: the crawl downs its own (crawlDown), the abstract Crypt kills
  if(-a.hp>=maxHp(a)){stats().why.massive++;return false}               // a blow from zero past full health
  lay(a,{kind:killer.kind,id:killer.id,type:killer.type||null,name:killer.name||null});
  pop(a.x,a.y-.8,'DOWN','#ff6a5a');
  if(killer.kind==='mob')nearDeath(a,killer); // lore: what nearly killed them (#188)
  record(a,'Went down at level '+a.lvl+' to ',killer.kind==='boss'?{t:'Kragmaw',c:'gd'}:'a '+mobName(killer),'.');
  if(a.lvl>=10||a.company!=null)log(a,' is down, bleeding, in the grass.');
  ev(a,'You are down: you lie bleeding at zero health. Death saves every '+R.TICK+' game minutes (each round at a Table scene); three failures and you die.',2);
  for(const b of nearKin(a,R.REACH))ev(b,a.name+' is down and dying nearby!',2);
  if(!sceneOf(a))callHelp(a); // at a scene the table's rounds are the rescue
  return true}
// The downed record and state, for the world and the crawl alike.
function lay(a,by){stats().downed++;
  a.down={at:now(),next:now()+R.TICK,s:0,f:0,stable:false,wake:0,by};
  a.hp=0;a.state='downed';a.target=null;a.dest=null;a.moving=false;a.raid=false;a.aid=null}
const mobName=m=>m.kind==='mob'&&MOBS[m.type]?MOBS[m.type].name:m.name||'foe';

// The killer to name at the end: the live mob or boss if still around, else a stand-in with its type.
function killerOf(a){const b=a.down&&a.down.by||{};
  if(b.kind==='boss')return S.boss;
  if(b.kind==='hero')return heroById(b.id)||{kind:'hero',id:b.id,name:b.name||'someone',nemesis:{},fac:1-a.fac};
  return S.mobs.find(m=>m.id===b.id)||{kind:'mob',id:b.id,type:b.type&&MOBS[b.type]?b.type:Object.keys(MOBS)[0],lvl:a.lvl,x:a.x,y:a.y,alive:false}}

function die(a,why){const st=stats();st.died++;st.why[why]=(st.why[why]||0)+1;
  const k=killerOf(a);
  if(why==='alone')record(a,'Bled out with no one near.');
  for(const b of S.agents)if(b.aid===a.id){b.aid=null;if(b.state==='aid'){b.state='hunt';b.dest=null}}
  const d=a.down;a.down=null;a.hp=0;
  if(d&&d.cause){record(a,d.rec||'Died of their wounds.');log(a,' died of the wounds taken there, '+d.cause+'.');fall(a,d.cause);return} // the crawl names its own foe and place
  slay(a,k)}

function rise(a,how){const st=stats();if(how==='revived')st.revived++;else if(how==='rose')st.rose++;else st.woke++;
  const deep=!!(a.down&&a.down.crawl); // up again inside the crawl: still below ground
  a.hp=Math.max(1,a.hp);a.down=null;a.state=deep?'dungeon':'hunt';a.target=null;a.dest=null;a.cd=Math.max(a.cd,1);
  pop(a.x,a.y-.8,how==='revived'?'REVIVED':'UP','#7dce5a');
  for(const b of S.agents)if(b.aid===a.id)b.aid=null; // their helper finishes in aidStep
  record(a,how==='revived'?'Was brought back from the brink.':how==='rose'?'Rose from the brink on their own.':'Woke from the dark on 1 HP.');
  ev(a,how==='revived'?'Someone brought you back: you are up, badly hurt.':how==='rose'?'You force yourself up, barely alive.':'You wake, weak, on your feet again.',2)}

// A blow on the downed: one failure, a critical two (mobs.js hurt, the boss's breath).
export function downHit(a,src,crit){if(!isDown(a))return;const d=a.down;
  if(d.stable){d.stable=false;d.s=0}                 // struck while stable: the bleeding starts again
  d.f+=crit?2:1;pop(a.x,a.y-.8,crit?'FAIL x2':'FAIL','#ff6a5a');
  if(d.f>=fails(a))die(a,'fails')}
const fails=a=>nearHeroes(a.x,a.y,R.HEAL_RANGE).some(b=>standing(b)&&kin(a,b)&&healer(b)&&dist(a,b)<=R.HEAL_RANGE)?R.HEALER_FAILS:R.SAVES;

// ---- the downed hero's step (updAgent case 'downed') ----
function downStep(a,dt){const d=a.down;a.moving=false;
  if(!d){a.down={at:now(),next:now()+R.TICK,s:0,f:0,stable:false,wake:0,by:{kind:'mob'}};return}
  if(a.hp>0){rise(a,'revived');return}               // a heal or a potion landed
  if(d.crawl||savesAtTable(sceneOf(a)))return;        // the table rolls their saves, a round at a time (#654)
  if(d.stable){if(now()>=d.wake){a.hp=1;rise(a,'woke')}return}
  if(now()<d.next)return;
  d.next+=R.TICK;
  const r=ri(1,20);
  if(r===20){a.hp=1;rise(a,'rose');return}
  if(r===1)d.f+=2;else if(r>=R.DC)d.s++;else d.f++;
  if(d.f>=fails(a)){die(a,'fails');return}
  if(d.s>=R.SAVES){if(!nearKin(a,R.REACH).length){die(a,'alone');return}
    stable(a,'their own will');return}
  callHelp(a)}

function stable(a,by){const d=a.down;if(!d||d.stable)return;d.stable=true;d.wake=now()+R.WAKE;stats().stable++;
  pop(a.x,a.y-.8,'STABLE','#9ad0ff');record(a,'Was stabilized by '+by+'.');
  ev(a,'The bleeding stops: you are stable, and will wake in about '+R.WAKE+' game minutes.',1)}

// The nearest free kin (a healer first) drops what they were doing and comes.
function callHelp(a){if(S.agents.some(b=>b.aid===a.id&&b.state==='aid'))return;
  let best=null,bs=1e9;
  for(const b of nearKin(a,R.REACH)){if(!R.AID_FROM.includes(b.state)||held(b))continue;
    const s=dist(a,b)-(healer(b)?R.REACH:0);if(s<bs){bs=s;best=b}}
  if(!best)return;
  best.state='aid';best.aid=a.id;best.aidAt=now();best.aidNext=0;best.target=null;best.dest=null}

// ---- the helper's step (updAgent case 'aid') ----
function aidStep(b,dt){const t=heroById(b.aid);
  const done=()=>{b.aid=null;b.state='hunt';b.dest=null};
  if(!t||!isDown(t)||now()-(b.aidAt||0)>R.AID_MAX){done();return}
  if(t.down.stable){if(dist(b,t)>R.ADJ+.5)moveTo(b,t.x,t.y,dt,2.6);else b.moving=false;return} // keep watch until they wake
  const d=dist(b,t);
  if(healer(b)&&b.healCd<=0&&d<=R.HEAL_RANGE){b.moving=false;healOne(b,t);aidLine(b,t,'healed');return}
  if(d>R.ADJ){moveTo(b,t.x,t.y,dt,2.6);return}
  b.moving=false;
  const pot=b.party&&t.party===b.party&&!(b.potCd>0)?bestUse(b,'potion'):null;
  if(pot&&useItem(b,pot,t).ok){aidLine(b,t,'gave a potion to');return}
  if(count(b,'Linen Bandage')>0){take(b,'use','Linen Bandage',1);stats().stabilized++;stable(t,b.name);aidLine(b,t,'bound the wounds of');return}
  if(now()<(b.aidNext||0))return;
  b.aidNext=now()+R.TICK;
  const r=ri(1,20)+skillMod(b,'healing');
  if(r>=R.STAB_DC){stats().stabilized++;stable(t,b.name);aidLine(b,t,'stabilized')}}
function aidLine(b,t,what){record(b,what[0].toUpperCase()+what.slice(1)+' ',t,' where they lay.');
  if(t.lvl>=10||t.company!=null)log(b,' ',what,' ',t,', who lay dying.')}

// One step for a hero in either state: updAgent's 'downed' and 'aid' cases.
export function downedStep(a,dt){if(a.state==='downed')downStep(a,dt);else if(a.state==='aid')aidStep(a,dt)}

// ---- foes and the downed (mobs.js updMob, boss.js) ----
// A mob whose target is down looks for someone standing first: a hero fighting it, then one who came to help.
// Mobs that finish (bestiary beh.finishes) stay on the downed. Returns the mob's target after the look.
export function foeOnDowned(m){const t=m.target;if(!isDown(t))return t;
  const B=blockOf(m.type,m.v,m.role);if(B&&B.beh&&B.beh.finishes)return t;
  let o=null;
  for(const b of nearHeroes(m.x,m.y,6)){if(!standing(b)||held(b))continue;
    if(b.state==='fight'&&b.target===m){o=b;break}
    if(!o&&b.state==='aid'&&b.aid===t.id)o=b}
  if(!o)return t;
  m.target=o;if(o.state!=='fight'){o.state='fight';o.target=m;o.dest=null}
  return o}
// The boss's breath falls on the downed in its reach too: Kragmaw finishes.
export const finisher=m=>{if(!m||m.kind!=='mob')return false;const B=blockOf(m.type,m.v,m.role);return !!(B&&B.beh&&B.beh.finishes)};
export function breathOnDowned(src,r){for(const b of nearHeroes(src.x,src.y,r))if(isDown(b)&&dist(b,src)<=r)downHit(b,src,false)}

// ---- at the table (#654) ----
// Combat scenes in rounds and the crawl's rooms roll the saves of their downed members on their turns (table.js runTurns).
const SAVE_KINDS={elite:1,ambush:1,boss:1,rescue:1};
export const savesAtTable=sc=>!!sc&&(sc.kind==='crawl'||(!!SAVE_KINDS[sc.kind]&&sc.rd!=null));
const bleeds=b=>isDown(b)&&!b.down.stable;
// The one to stabilize among L (not the actor): the bleeding hero with the most failures, ties by id.
export function bleedingOf(L,a){let t=null;for(const b of L)if(b!==a&&bleeds(b)&&(!t||b.down.f>t.down.f||(b.down.f===t.down.f&&b.id<t.id)))t=b;return t}
export const stabText=(b,t)=>'Stabilize '+t.name+', who lies bleeding ('+(count(b,'Linen Bandage')>0?'a Linen Bandage binds it for sure':'d20 + Healing vs '+R.STAB_DC)+')';
const sg=n=>(n<0?'':'+')+n;
// A death save on the downed hero's turn at the table. o.kin: someone of theirs stands at the table (else three successes
// is dying alone); o.healer: a healer of theirs stands there (four failures). Returns {die, dc, out, s, f, of} or null.
// out: 'success' | 'failure' | 'two failures' | 'stable' | 'rose' | 'dead'.
export function tableSave(a,o={}){const d=a.down;if(!isDown(a)||!d||d.stable)return null;
  const r=ri(1,20),of=o.healer?R.HEALER_FAILS:R.SAVES;let out;
  if(r===20){a.hp=1;rise(a,'rose');return {die:r,dc:R.DC,out:'rose',s:d.s,f:d.f,of}}
  if(r===1)d.f+=2;else if(r>=R.DC)d.s++;else d.f++;
  const s=d.s,f=d.f;
  if(f>=of){die(a,'fails');out='dead'}
  else if(s>=R.SAVES){if(!o.kin){die(a,'alone');out='dead'}else{stable(a,'their own will');out='stable'}}
  else out=r===1?'two failures':r>=R.DC?'success':'failure';
  return {die:r,dc:R.DC,out,s,f,of}}
// A companion's stabilize at the table: a Linen Bandage binds it, else d20 + Healing against DOWN.STAB_DC. Returns {ok, text}.
export function stabilizeAt(b,t){if(!bleeds(t))return {ok:false,text:t.name+' is not bleeding'};
  if(count(b,'Linen Bandage')>0){take(b,'use','Linen Bandage',1);stats().stabilized++;stable(t,b.name);return {ok:true,text:'bound the wounds of '+t.name+' with a Linen Bandage: stable'}}
  const d=ri(1,20),m=skillMod(b,'healing'),tot=d+m;
  if(tot>=R.STAB_DC){stats().stabilized++;stable(t,b.name);return {ok:true,die:d,mod:m,text:'d20 '+d+sg(m)+'='+tot+' vs DC '+R.STAB_DC+': '+t.name+' is stable'}}
  return {ok:false,die:d,mod:m,text:'d20 '+d+sg(m)+'='+tot+' vs DC '+R.STAB_DC+': the bleeding goes on'}}
// A heal or a potion brought them above zero at the table: they are up (the world's downStep does the same).
export function upAgain(a){if(isDown(a)&&a.hp>0){rise(a,'revived');return true}return false}
// The crawl (crawl.js foeBlow): a crew member at zero is downed below ground, not dead. False: a blow past full health,
// the caller lets them fall. cause/rec: the words of the death if it comes (the foe and the place).
export function crawlDown(a,foe,cause,rec){if(!a||a.kind!=='hero'||isDown(a))return false;
  if(-a.hp>=maxHp(a)){stats().why.massive++;return false}
  lay(a,{kind:'mob',id:null,type:null,name:foe&&foe.name||null});a.down.crawl=true;a.down.cause=cause;a.down.rec=rec;
  record(a,'Went down at level '+a.lvl+' below ground, to '+(foe&&foe.name||'a foe')+'.');
  ev(a,'You are down: you lie bleeding at zero health. A death save each round; three failures and you die.',2);
  return true}
// The crawl is over and they come up the stair still down (carried out): the world's clock and helpers take over.
export function toWorld(a){if(!a||!a.down||a.state==='dead')return;const d=a.down;/* a goHome on the way out may have changed the state */d.crawl=false;d.next=now()+R.TICK;
  a.state='downed';a.hidden=false;a.target=null;a.dest=null;a.moving=false;callHelp(a)}
// Nobody stands to carry them: the end (the crawl's wipe).
export function bleedOut(a){if(isDown(a))die(a,'alone')}
