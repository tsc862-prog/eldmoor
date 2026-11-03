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
// Same dice for every hero (the shared rng), no new random stream. Not yet: the Table rescue scene and crawl rooms
// (#654), Watch-mode clock (#655), wounds (#656), PvP spare (#657), agent tools and gambits (#658), UI (#659).
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
import {maxHp,moveTo,healOne,slay} from './heroes.js';
import {pvpDowned} from './mercy.js'; // finish or spare (#657)

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
  if(a.hidden||a.state==='dungeon')return false;                        // below ground: the Crypt's own rules
  if(sceneOf(a))return false;                                           // at a Table scene: as before until the rescue scene (#654)
  if(-a.hp>=maxHp(a)){stats().why.massive++;return false}               // a blow from zero past full health
  const st=stats();st.downed++;
  a.down={at:now(),next:now()+R.TICK,s:0,f:0,stable:false,wake:0,by:{kind:killer.kind,id:killer.id,type:killer.type||null,name:killer.name||null}};
  a.hp=0;a.state='downed';a.target=null;a.dest=null;a.moving=false;a.raid=false;a.aid=null;
  pop(a.x,a.y-.8,'DOWN','#ff6a5a');
  if(killer.kind==='mob')nearDeath(a,killer); // lore: what nearly killed them (#188)
  record(a,'Went down at level '+a.lvl+' to ',killer.kind==='boss'?{t:'Kragmaw',c:'gd'}:killer.kind==='hero'?killer:'a '+mobName(killer),'.');
  if(a.lvl>=10||a.company!=null)log(a,' is down, bleeding, in the grass.');
  ev(a,'You are down: you lie bleeding at zero health. Death saves every '+R.TICK+' game minutes; three failures and you die.',2);
  for(const b of nearKin(a,R.REACH))ev(b,a.name+' is down and dying nearby!',2);
  callHelp(a);
  if(killer.kind==='hero')pvpDowned(a,killer); // the victor finishes or spares (sim/mercy.js, #657)
  return true}
const mobName=m=>m.kind==='mob'&&MOBS[m.type]?MOBS[m.type].name:m.name||'foe';

// The killer to name at the end: the live mob or boss if still around, else a stand-in with its type.
function killerOf(a){const b=a.down&&a.down.by||{};
  if(b.kind==='boss')return S.boss;
  if(b.kind==='hero')return heroById(b.id)||{kind:'hero',id:b.id,name:b.name||'someone',nemesis:{},fac:1-a.fac};
  return S.mobs.find(m=>m.id===b.id)||{kind:'mob',id:b.id,type:b.type&&MOBS[b.type]?b.type:Object.keys(MOBS)[0],lvl:a.lvl,x:a.x,y:a.y,alive:false}}

function die(a,why){const st=stats();st.died++;st.why[why]=(st.why[why]||0)+1;
  const k=killerOf(a),bled=a.down&&a.down.by&&a.down.by.kind==='hero';
  if(why==='alone')record(a,'Bled out with no one near.');
  for(const b of S.agents)if(b.aid===a.id){b.aid=null;if(b.state==='aid'){b.state='hunt';b.dest=null}}
  a.down=null;a.hp=0;
  slay(a,k,bled?{bled:true}:null)}  // left to bleed by an enemy hero: no honour to anyone (#657)

function rise(a,how){const st=stats();if(how==='revived')st.revived++;else if(how==='rose')st.rose++;else st.woke++;
  a.hp=Math.max(1,a.hp);a.down=null;a.state='hunt';a.target=null;a.dest=null;a.cd=Math.max(a.cd,1);
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
export function breathOnDowned(src,r){for(const b of nearHeroes(src.x,src.y,r))if(isDown(b)&&dist(b,src)<=r)downHit(b,src,false)}
