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
// Agents (#658): agent-played helpers come only as their own aid rules say (sim/gambits.js aidPlan: revive_ally, stabilize,
// carry; the class presets are the old reflex), the stabilize, tend and carry tools order it (sim/player.js aidOrder), and
// agent heroes in range hear of a downing, a stable, a revival and a death (urgent); the downed agent's next turn is a
// reflection (sim/reflect.js kind 'downed') while its acting tools are refused.
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
import {ev,notify} from './notify.js';
import {moment,downedOver} from './reflect.js'; // the downed agent's turn is a reflection (#658)
import {homeOf} from '../data/races.js';
import {skillMod} from './abilities.js';
import {count,take,bestUse,useItem} from './inv.js';
import {nearDeath} from './lore.js';
import {held,sceneOf} from './scenes.js';
import {maxHp,moveTo,healOne,slay} from './heroes.js';

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
  CARRY:.6,         // a carrier's pace, a share of a helper's (#658)
  SEE:8,            // tiles: heroes not of their kin who still see a downing (agents hear of it, #658)
  DOWNS:8,          // an agent hero's own downings kept (a.downs, game minutes) for the self_downed_count gambit
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
  if(a.hidden||a.state==='dungeon')return false;                        // below ground: the Crypt's own rules
  if(sceneOf(a))return false;                                           // at a Table scene: as before until the rescue scene (#654)
  if(-a.hp>=maxHp(a)){stats().why.massive++;return false}               // a blow from zero past full health
  const st=stats();st.downed++;
  a.down={at:now(),next:now()+R.TICK,s:0,f:0,stable:false,wake:0,by:{kind:killer.kind,id:killer.id,type:killer.type||null,name:killer.name||null}};
  a.hp=0;a.state='downed';a.target=null;a.dest=null;a.moving=false;a.raid=false;a.aid=null;
  pop(a.x,a.y-.8,'DOWN','#ff6a5a');
  if(killer.kind==='mob')nearDeath(a,killer); // lore: what nearly killed them (#188)
  record(a,'Went down at level '+a.lvl+' to ',killer.kind==='boss'?{t:'Kragmaw',c:'gd'}:'a '+mobName(killer),'.');
  if(a.lvl>=10||a.company!=null)log(a,' is down, bleeding, in the grass.');
  ev(a,'You are down: you lie bleeding at zero health. Death saves every '+R.TICK+' game minutes; three failures and you die.',2);
  if(a.player){const L=a.downs||(a.downs=[]);L.push(Math.round(now()));if(L.length>R.DOWNS)L.shift();
    moment(a,'downed','struck down by '+(killer.kind==='boss'?'Kragmaw':'a '+mobName(killer)))} // the downed agent's next turn: a reflection, no acting tools (#658)
  for(const b of nearKin(a,R.REACH))if(!b.player)ev(b,a.name+' is down and dying nearby!',2);
  tellNear(a,'down');
  callHelp(a);
  return true}
const mobName=m=>m.kind==='mob'&&MOBS[m.type]?MOBS[m.type].name:m.name||'foe';

// The killer to name at the end: the live mob or boss if still around, else a stand-in with its type.
function killerOf(a){const b=a.down&&a.down.by||{};
  if(b.kind==='boss')return S.boss;
  if(b.kind==='hero')return heroById(b.id)||{kind:'hero',id:b.id,name:b.name||'someone',nemesis:{},fac:1-a.fac};
  return S.mobs.find(m=>m.id===b.id)||{kind:'mob',id:b.id,type:b.type&&MOBS[b.type]?b.type:Object.keys(MOBS)[0],lvl:a.lvl,x:a.x,y:a.y,alive:false}}

function die(a,why){const st=stats();st.died++;st.why[why]=(st.why[why]||0)+1;
  tellNear(a,'died');
  const k=killerOf(a);
  if(why==='alone')record(a,'Bled out with no one near.');
  for(const b of S.agents)if(b.aid===a.id){b.aid=null;if(b.aidHow)b.aidHow=null;if(b.state==='aid'){b.state='hunt';b.dest=null}}
  a.down=null;a.hp=0;
  slay(a,k)}

function rise(a,how){const st=stats();if(how==='revived')st.revived++;else if(how==='rose')st.rose++;else st.woke++;
  a.hp=Math.max(1,a.hp);a.down=null;a.state='hunt';a.target=null;a.dest=null;a.cd=Math.max(a.cd,1);
  pop(a.x,a.y-.8,how==='revived'?'REVIVED':'UP','#7dce5a');
  for(const b of S.agents)if(b.aid===a.id)b.aid=null; // their helper finishes in aidStep
  tellNear(a,how==='revived'?'revived':'up');if(a.player)downedOver(a);
  record(a,how==='revived'?'Was brought back from the brink.':how==='rose'?'Rose from the brink on their own.':'Woke from the dark on 1 HP.');
  ev(a,how==='revived'?'Someone brought you back: you are up, badly hurt.':how==='rose'?'You force yourself up, barely alive.':'You wake, weak, on your feet again.',2)}

// A blow on the downed: one failure, a critical two (mobs.js hurt, the boss's breath).
export function downHit(a,src,crit){if(!isDown(a))return;const d=a.down;
  if(d.stable){d.stable=false;d.s=0}                 // struck while stable: the bleeding starts again
  d.f+=crit?2:1;pop(a.x,a.y-.8,crit?'FAIL x2':'FAIL','#ff6a5a');
  if(d.f>=fails(a))die(a,'fails')}
const fails=a=>nearHeroes(a.x,a.y,R.HEAL_RANGE).some(b=>standing(b)&&kin(a,b)&&healer(b)&&dist(a,b)<=R.HEAL_RANGE)?R.HEALER_FAILS:R.SAVES;
// Read-only, for the watcher (#659): failures that would end a downed hero now (four while a healer of theirs is near).
export const failsOf=a=>isDown(a)?fails(a):R.SAVES;

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
  pop(a.x,a.y-.8,'STABLE','#9ad0ff');record(a,'Was stabilized by '+by+'.');tellNear(a,'stable');
  ev(a,'The bleeding stops: you are stable, and will wake in about '+R.WAKE+' game minutes.',1)}

// The nearest free kin (a healer first) drops what they were doing and comes.
// An agent-played hero comes only when one of its aid rules holds (#658, sim/gambits.js aidPlan), and then does only what
// they say; its class preset is the old reflex, so it is chosen and acts as before. no_healer: no healer nearer to the
// downed than this hero is free to come (healers among themselves by who is free, the others by who would come).
function aidHook(){} // hoisted holder: sim/gambits.js registers {plan, fire} (an import cycle through heroes.js)
export function onAid(o){aidHook.o=o}
function callHelp(a){if(S.agents.some(b=>b.aid===a.id&&b.state==='aid'))return;
  const free=nearKin(a,R.REACH).filter(b=>R.AID_FROM.includes(b.state)&&!held(b)),H=aidHook.o,plans=new Map();
  const nearer=(b,ok)=>free.some(h=>h!==b&&healer(h)&&dist(h,a)<dist(b,a)&&ok(h));
  const plan=b=>{if(!b.player||!H)return true;if(!plans.has(b))plans.set(b,H.plan(b,a,{noHealer:!nearer(b,healer(b)?()=>true:h=>!!plan(h))}));return plans.get(b)};
  let best=null,bs=1e9;
  for(const b of free){if(!plan(b))continue;
    const s=dist(a,b)-(healer(b)?R.REACH:0);if(s<bs){bs=s;best=b}}
  if(!best)return;
  best.state='aid';best.aid=a.id;best.aidAt=now();best.aidNext=0;best.target=null;best.dest=null;
  if(best.player&&H){const p=plans.get(best);best.aidHow=p.how;H.fire(best,p)}else if(best.aidHow)best.aidHow=null}
// Is a healer of t's kin, other than b and nearer to t than b, standing within reach and free to come? (the no_healer gambit)
export function healerNearer(t,b){if(!t)return false;return nearKin(t,R.REACH).some(h=>h!==b&&healer(h)&&R.AID_FROM.includes(h.state)&&!held(h)&&(!b||dist(h,t)<dist(b,t)))}
// An agent's order to help a downed hero (the stabilize, tend and carry tools, sim/player.js): b goes to t and does what how
// allows ({revive, stab, carry}). -> {ok} or {error}.
export function aidOrder(b,t,how){if(!isDown(t))return {error:t.name+' is not down.'};if(!standing(b))return {error:'You cannot help anyone now.'};
  b.state='aid';b.aid=t.id;b.aidAt=now();b.aidNext=0;b.target=null;b.dest=null;b.moving=false;b.aidHow={...how};
  return {ok:true,stable:!!t.down.stable,tiles:Math.round(dist(b,t)*10)/10}}
// What a hero helping someone is doing, for the tools (null when not helping).
export function aidView(b){if(!b||b.state!=='aid')return null;const t=heroById(b.aid);if(!t)return null;const h=b.aidHow;
  return {helping:t.name,stable:!!(t.down&&t.down.stable),will:h?['revive','stab','carry'].filter(k=>h[k]).map(k=>k==='stab'?'stabilize':k==='carry'?'carry to '+h.carry:k):['everything you can']}}

// Agent heroes in range hear of it (#658): kin within shouting range, anyone else within sight. kind: down, stable,
// revived, up, died. A downed hero among them hears too (it lies there listening). Only the name, where, and what any
// bystander sees: never the saves, the helper's rules or the hero's own mind.
const DIRS=['east','south-east','south','south-west','west','north-west','north','north-east'];
const dirOf=(b,a)=>{const dx=a.x-b.x,dy=a.y-b.y,d=Math.hypot(dx,dy);return d<1.5?'right beside you':Math.round(d)+' tiles '+DIRS[((Math.round(Math.atan2(dy,dx)/(Math.PI/4))%8)+8)%8]};
function tellNear(a,kind){for(const b of nearHeroes(a.x,a.y,R.REACH)){if(b===a||!b.player||b.state==='dead'||b.hidden||b.kind!=='hero')continue;const d=dist(a,b),k=kin(a,b);
  if(d>R.REACH||!k&&d>R.SEE)continue;const where=' ('+dirOf(b,a)+')',first=a.name.split(' ')[0];
  const text=kind==='down'?(k?a.name+' is down and dying'+where+'! stabilize {who: "'+first+'"}, a potion (use_item with target) or a heal can save them; tend does all you can.':a.name+' falls and lies bleeding'+where+'.')
    :kind==='stable'?a.name+' has stopped bleeding'+where+': stable, still down.'+(k?' carry {who: "'+first+'"} can bring them to safety.':'')
    :kind==='revived'?a.name+' is brought back up'+where+'.':kind==='up'?a.name+' is back on their feet'+where+'.'
    :a.name+' has died of their wounds'+where+'.';
  notify(b,text,2)}}

// ---- the helper's step (updAgent case 'aid') ----
function aidStep(b,dt){const t=heroById(b.aid);
  const done=()=>{b.aid=null;b.state='hunt';b.dest=null;if(b.aidHow)b.aidHow=null};
  if(!t||!isDown(t)||now()-(b.aidAt||0)>R.AID_MAX){done();return}
  const how=b.aidHow||null,can=k=>!how||!!how[k]; // an agent-played helper does what its aid rules or its order say (#658); anyone else all of it
  if(t.down.stable){if(how&&how.carry){carryStep(b,t,dt,how);return}
    if(dist(b,t)>R.ADJ+.5)moveTo(b,t.x,t.y,dt,2.6);else b.moving=false;return} // keep watch until they wake
  const d=dist(b,t);
  if(can('revive')&&healer(b)&&b.healCd<=0&&d<=R.HEAL_RANGE){b.moving=false;healOne(b,t);aidLine(b,t,'healed');return}
  if(d>R.ADJ){moveTo(b,t.x,t.y,dt,2.6);return}
  b.moving=false;
  const mate=b.party&&t.party===b.party,pot=can('revive')&&mate&&!(b.potCd>0)?bestUse(b,'potion'):null;
  if(pot&&useItem(b,pot,t).ok){aidLine(b,t,'gave a potion to');return}
  if(!can('stab')){if(!(healer(b)||mate&&bestUse(b,'potion')))done();return} // revive only: a healer waits for its heal, a potion for its cooldown
  if(count(b,'Linen Bandage')>0){take(b,'use','Linen Bandage',1);stats().stabilized++;stable(t,b.name);aidLine(b,t,'bound the wounds of');return}
  if(now()<(b.aidNext||0))return;
  b.aidNext=now()+R.TICK;
  const r=ri(1,20)+skillMod(b,'healing');
  if(r>=R.STAB_DC){stats().stabilized++;stable(t,b.name);aidLine(b,t,'stabilized')}}
// Carry a stable companion (#658): to them first, then at DOWN.CARRY of the pace with them, and lay them down on arrival.
function carryTo(b,to){if(to==='camp'){const C=companyOf(b),g=C&&C.camp;if(g&&g.phase)return {x:g.x,y:g.y,label:'the camp'}}
  if(to==='leader'){const L=b.party&&b.party.leader;if(L&&L!==b&&standing(L))return {x:L.x,y:L.y,label:L.name}}
  const c=homeOf(b);return c&&c.gate?{x:c.gate.x,y:c.gate.y,label:c.name}:null}
function carryStep(b,t,dt,how){const p=carryTo(b,how.carry);
  if(!p){how.carry=null;return}
  if(dist(b,t)>R.ADJ+.5){moveTo(b,t.x,t.y,dt,2.6);return}
  const there=moveTo(b,p.x,p.y,dt,2.6*R.CARRY);t.x=b.x;t.y=b.y;
  if(!how.carrying){how.carrying=1;record(b,'Took up ',t,' to carry them to '+p.label+'.')}
  if(there||dist(b,p)<1){how.carry=null;how.carried=p.label;b.moving=false;record(b,'Carried ',t,' to '+p.label+' and laid them down.');
    if(b.player)ev(b,'You lay '+t.name+' down at '+p.label+'; they will wake in time.',1);if(t.player)ev(t,'You are carried to '+p.label+' and laid down.',0)}}
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
