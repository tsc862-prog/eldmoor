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
// Same dice for every hero (the shared rng), no new random stream.
// At the table (#654): a downing in a combat scene keeps the hero in it, downed; a downing in the world with an agent
// involved opens a rescue scene (table.js due). There the saves are per round, in initiative order (tableSave), and a
// companion's act may heal, give a potion or stabilize (stabilizeAt); the world's clock leaves them be (savesAtTable).
// In the Crypt crawl a hero at zero is downed too (crawlDown): the room's dice roll the saves, a wipe ends them all.
// Watch mode (#655, owner answer 2): with the Table Off and a host that reports runner links, a downed agent hero's saves come
// every DOWN.WATCH_TICK game minutes instead of DOWN.TICK, and its kin in reach get an urgent wake at each save, so their
// runners have a turn before the next one (table.js registers the test, onWatch). The DM voices each downing, save and end
// through its table_call (sim/downcall.js, onDownNews): words only, the dice here decide.
// Every downing leaves a wound (#656, sim/tend.js takeWound); a death ends it with the hero. Not yet: UI (#659).
import {ri,rnd} from '../core/rng.js';
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
import {maxHp,moveTo,healOne,slay,fall} from './heroes.js';
import {pvpDowned} from './mercy.js'; // finish or spare (#657)
import {takeWound} from './tend.js'; // the lasting cost of a downing (#656)

export const DOWN={
  TICK:10,          // game minutes between death saves away from a table
  WATCH_TICK:20,    // the same for an agent hero in Watch mode (Table Off) with live runners (#655): time for its companions to act
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
  // Below ground the Crypt stays deadly (owner, #269: about 0.6 Fellowship deaths per 120-minute run in the crawl; #654 with
  // the rules above alone gave 0.0, since a healer lifts the downed the next round). Crawl-only, world and Table rescues untouched.
  // A harder save or blows on the downed barely moved it (measured); the deaths come from the room the party loses.
  CRAWL_LEFT:.6,     // driven back or withdrawing, the chance a downed hero not yet stable is lost on the stair (dies there)
  CARRY:.6,         // a carrier's pace, a share of a helper's (#658)
  SEE:8,            // tiles: heroes not of their kin who still see a downing (agents hear of it, #658)
  DOWNS:8,          // an agent hero's own downings kept (a.downs, game minutes) for the self_downed_count gambit
};

const R=DOWN;
// Watch mode (#655): table.js registers the test (Table Off, an agent hero, a host with runner links). Hoisted holders, as
// aidHook: an import cycle through heroes.js.
function watchHook(){}
export function onWatch(f){watchHook.f=typeof f==='function'?f:null}
const watching=a=>!!(watchHook.f&&watchHook.f(a));
export const tickOf=a=>watching(a)?R.WATCH_TICK:R.TICK;
// The DM's voice on a downing (#655, sim/downcall.js): told of each downing, save and end. kind: down, save, stable, revived,
// up, died, finished.
function newsHook(){}
export function onDownNews(f){newsHook.f=typeof f==='function'?f:null}
const news=(a,kind,info)=>{if(newsHook.f)newsHook.f(a,kind,info)};
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
  if(a.hidden||a.state==='dungeon')return false;                        // below ground: the crawl downs its own (crawlDown), the abstract Crypt kills
  if(-a.hp>=maxHp(a)){stats().why.massive++;return false}               // a blow from zero past full health
  lay(a,{kind:killer.kind,id:killer.id,type:killer.type||null,name:killer.name||null});
  pop(a.x,a.y-.8,'DOWN','#ff6a5a');
  if(killer.kind==='mob')nearDeath(a,killer); // lore: what nearly killed them (#188)
  record(a,'Went down at level '+a.lvl+' to ',killer.kind==='boss'?{t:'Kragmaw',c:'gd'}:killer.kind==='hero'?killer:'a '+mobName(killer),'.');
  if(a.lvl>=10||a.company!=null)log(a,' is down, bleeding, in the grass.');
  ev(a,'You are down: you lie bleeding at zero health. Death saves every '+tickOf(a)+' game minutes (each round at a Table scene); three failures and you die.',2);
  if(a.player){const L=a.downs||(a.downs=[]);L.push(Math.round(now()));if(L.length>R.DOWNS)L.shift();
    moment(a,'downed','struck down by '+(killer.kind==='boss'?'Kragmaw':killer.kind==='hero'?killer.name:'a '+mobName(killer)))} // the downed agent's next turn: a reflection, no acting tools (#658)
  takeWound(a,killer.kind==='boss'?'Kragmaw':killer.kind==='hero'?killer.name:'a '+mobName(killer),killer);
  for(const b of nearKin(a,R.REACH))if(!b.player)ev(b,a.name+' is down and dying nearby!',2);
  tellNear(a,'down');
  if(!sceneOf(a))callHelp(a); // at a scene the table's rounds are the rescue (#654)
  if(killer.kind==='hero')pvpDowned(a,killer); // the victor finishes or spares (sim/mercy.js, #657), at a Table scene too: the table rolls the saves meanwhile
  return true}
// The downed record and state, for the world and the crawl alike.
function lay(a,by){stats().downed++;
  a.down={at:now(),next:now()+tickOf(a),s:0,f:0,stable:false,wake:0,by};
  a.hp=0;a.state='downed';a.target=null;a.dest=null;a.moving=false;a.raid=false;a.aid=null}
const mobName=m=>m.kind==='mob'&&MOBS[m.type]?MOBS[m.type].name:m.name||'foe';

// The killer to name at the end: the live mob or boss if still around, else a stand-in with its type.
function killerOf(a){const b=a.down&&a.down.by||{};
  if(b.kind==='boss')return S.boss;
  if(b.kind==='hero')return heroById(b.id)||{kind:'hero',id:b.id,name:b.name||'someone',nemesis:{},fac:1-a.fac};
  return S.mobs.find(m=>m.id===b.id)||{kind:'mob',id:b.id,type:b.type&&MOBS[b.type]?b.type:Object.keys(MOBS)[0],lvl:a.lvl,x:a.x,y:a.y,alive:false}}

function die(a,why){const st=stats();st.died++;st.why[why]=(st.why[why]||0)+1;
  tellNear(a,'died');
  const k=killerOf(a),bled=a.down&&a.down.by&&a.down.by.kind==='hero';
  if(why==='alone')record(a,'Bled out with no one near.');
  for(const b of S.agents)if(b.aid===a.id){b.aid=null;if(b.aidHow)b.aidHow=null;if(b.state==='aid'){b.state='hunt';b.dest=null}}
  const d=a.down;a.down=null;a.hp=0;
  if(d&&d.cause){record(a,d.rec||'Died of their wounds.');log(a,' died of the wounds taken there, '+d.cause+'.');fall(a,d.cause);return} // the crawl names its own foe and place
  slay(a,k,bled?{bled:true}:null)}  // left to bleed by an enemy hero: no honour to anyone (#657)

function rise(a,how){const st=stats();if(how==='revived')st.revived++;else if(how==='rose')st.rose++;else st.woke++;
  const deep=!!(a.down&&a.down.crawl); // up again inside the crawl: still below ground
  a.hp=Math.max(1,a.hp);a.down=null;a.state=deep?'dungeon':'hunt';a.target=null;a.dest=null;a.cd=Math.max(a.cd,1);
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
  if(d.crawl||savesAtTable(sceneOf(a)))return;        // the table rolls their saves, a round at a time (#654)
  if(d.stable){if(now()>=d.wake){a.hp=1;rise(a,'woke')}return}
  if(now()<d.next)return;
  d.next+=tickOf(a);
  const r=ri(1,20);
  if(r===20){a.hp=1;rise(a,'rose');return}
  if(r===1)d.f+=2;else if(r>=R.DC)d.s++;else d.f++;
  const of=fails(a);
  if(d.f>=of){die(a,'fails');return}
  if(d.s>=R.SAVES){if(!nearKin(a,R.REACH).length){die(a,'alone');return}
    stable(a,'their own will');return}
  news(a,'save',{die:r,s:d.s,f:d.f,of,out:r===1?'two failures':r>=R.DC?'success':'failure'});
  if(watching(a))watchWake(a,of);
  callHelp(a)}
// Watch mode (#655): no table gives the companions a turn, so each save wakes the kin in reach at once.
function watchWake(a,of){const d=a.down,first=a.name.split(' ')[0];
  for(const b of nearKin(a,R.REACH))if(b.player)notify(b,a.name+' still lies bleeding ('+dirOf(b,a)+'): '+d.s+' of '+R.SAVES+' saves made, '+d.f+' of '+of+' failed; the next comes in about '+R.WATCH_TICK+' game minutes. stabilize {who: "'+first+'"}, a potion or a heal can save them.',2)}

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
export function tellNear(a,kind){for(const b of nearHeroes(a.x,a.y,R.REACH)){if(b===a||!b.player||b.state==='dead'||b.hidden||b.kind!=='hero')continue;const d=dist(a,b),k=kin(a,b);
  if(d>R.REACH||!k&&d>R.SEE)continue;const where=' ('+dirOf(b,a)+')',first=a.name.split(' ')[0];
  const text=kind==='down'?(k?a.name+' is down and dying'+where+'! stabilize {who: "'+first+'"}, a potion (use_item with target) or a heal can save them; tend does all you can.':a.name+' falls and lies bleeding'+where+'.')
    :kind==='stable'?a.name+' has stopped bleeding'+where+': stable, still down.'+(k?' carry {who: "'+first+'"} can bring them to safety.':'')
    :kind==='revived'?a.name+' is brought back up'+where+'.':kind==='up'?a.name+' is back on their feet'+where+'.'
    :kind==='finished'?a.name+' is finished where they lay'+where+'.'
    :a.name+' has died of their wounds'+where+'.';
  notify(b,text,2)}
  news(a,kind)}
// The agent heroes who see a downing (tellNear's hearers): kin within shouting range, anyone else within sight (sim/downcall.js).
export const hearersOf=a=>nearHeroes(a.x,a.y,R.REACH).filter(b=>b!==a&&b.player&&b.state!=='dead'&&!b.hidden&&b.kind==='hero'&&dist(a,b)<=(kin(a,b)?R.REACH:R.SEE));

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
  const r=ri(1,20),of=o.healer?R.HEALER_FAILS:R.SAVES,dc=R.DC;let out;
  if(r===20){a.hp=1;rise(a,'rose');return {die:r,dc,out:'rose',s:d.s,f:d.f,of}}
  if(r===1)d.f+=2;else if(r>=dc)d.s++;else d.f++;
  const s=d.s,f=d.f;
  if(f>=of){die(a,'fails');out='dead'}
  else if(s>=R.SAVES){if(!o.kin){die(a,'alone');out='dead'}else{stable(a,'their own will');out='stable'}}
  else out=r===1?'two failures':r>=dc?'success':'failure';
  if(out!=='dead'&&out!=='stable')news(a,'save',{die:r,s,f,of,out});
  return {die:r,dc,out,s,f,of}}
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
  takeWound(a,foe&&foe.name||'a foe',foe);
  news(a,'down');
  return true}
// The crawl is over and they come up the stair still down (carried out): the world's clock and helpers take over.
export function toWorld(a){if(!a||!a.down||a.state==='dead')return;const d=a.down;/* a goHome on the way out may have changed the state */d.crawl=false;d.next=now()+tickOf(a);
  a.state='downed';a.hidden=false;a.target=null;a.dest=null;a.moving=false;callHelp(a)}
// Left on the stair (DOWN.CRAWL_LEFT): a party driven back or withdrawing cannot carry one still bleeding.
export function leftBehind(a){if(!isDown(a)||!a.down.crawl||a.down.stable||rnd()>=R.CRAWL_LEFT)return false;a.down.rec=(a.down.rec||'')+' Left behind as the party fell back.';die(a,'fails');return true}
// Nobody stands to carry them: the end (the crawl's wipe).
export function bleedOut(a){if(isDown(a))die(a,'alone')}
