// Table mode (issue #68, phase B). Owned by brain-builder. DOM-free.
// When the Fellowship reaches a moment that matters, the game becomes a table: at 1x the world
// clock stops (sim/index.js step() runs only this scene), the DM frames the scene, the members act
// in initiative order (Reflex score, highest first) and the DM narrates the outcome; then the world
// runs on. At 3x and 8x a scene whose members' agents decide asks the host to drop the world to 1x
// (TABLE.drop, #148) and pauses; only a scene where every member acts by reflex (no runner, and the
// owner said go on) resolves at once and is summarised in a line or two. Mode 'off' (Watch mode)
// never opens a scene. Only the Fellowship ever pauses the world.
//
// Triggers (tableTick, once per step after the council):
//   site / room  the Fellowship's Crypt group goes in, and reaches the inner chamber
//   boss         a member engages Kragmaw in a raid
//   elite        a member fights an elite or named foe
//   ambush       an enemy hero duels a member
//   rescue       a member falls below RESCUE of max HP in a fight
//   check        a DM check on one of the Fellowship's adventures (social, trap, lore, travel)
//   choice       a choice scene on their adventure (sim/player-choice.js asks through setFellowChoice)
//   decision     a council proposal that needs everyone (sim/council.js setProposeHook)
// Turns (#148: the Fellowship is always agent-played, and every choice is its agent's): a member whose
// runner holds it (link connected or waiting, sim/runlink.js) gets a must-answer event and the table
// waits for its scene_act (it may also answer early, before its turn), nudged again after TABLE.turnMs,
// for up to TABLE.liveMs of real time, then its reflex acts with a notice. A member whose runner is gone
// holds the table until the owner answers the page's runner-stop alert (Restart, or Resume: reflexes
// then act at once); with no host (headless sim, checks) a member without a runner acts by reflex at
// once. The scene ends if the Fellowship, the foe or the adventure goes away.
// Everyone at once (owner request): a scene whose answers do not depend on each other (PLAY[kind]==='all': votes,
// checks each member rolls for, adventure choices, staged meetings, talks, traps and mysteries) asks every member
// present at the same moment. They answer in any order; each live agent gets its own TABLE.turnMs nudge and
// TABLE.liveMs wait, side by side; then the acts resolve in Fellowship slot order (never arrival order, so a seeded
// world plays the same whatever order the answers come in), reflexes chosen at that point, and the DM narrates the
// combined result. Only members within shouting range (#182) of the scene's anchor take part.
// Scene state is plain data on S.table (ids only), so a save taken mid-scene resumes it.
import {CRYPT,ZONES,zoneAt,dist} from '../world/map.js';
import {MOBS} from '../data/mobs.js';
import {CLS} from '../data/classes.js';
import {tm} from '../data/traits.js';
import {S} from './state.js';
import {log} from './chronicle.js';
import {strike,maxHp,goHome} from './heroes.js';
import {speak,agentLine} from './chat.js';
import {notify} from './notify.js';
import {moment} from './reflect.js'; // reflection moments (#179)
import {remember} from './memory.js';
import {askRelay,snapshotFor,cleanLine} from './brain.js';
import {sayOk,setSpeedSource} from './throttle.js';
import {score} from './abilities.js';
import {bestUse,useItem} from './inv.js'; // a potion in a scene (scene_act option potion)
import {fellows,fellowParty,campaign} from './fellowship.js';
import {setProposeHook,castVote,resolveProp,reflexVote,propById,leaderOfF,openProps,waitingVoters,voters} from './council.js';
import {inRange} from './reach.js';
import {setFellowChoice} from './player-choice.js';
import {reflexMay,ownerHeld} from './runlink.js';
import {MOVES} from '../data/moves.js';
import {movesOf,ready,useMove,pickMove,tickRound} from './moves.js'; // class abilities, round cooldowns (#81)
import {TR,foeSlot,foeTurn,memberStrike,flushRolls,foeName} from './tableround.js'; // combat rounds: the foe's turn and the dice (#276)

export const TABLE={
  mode:'auto',     // 'auto' (the trigger rules) or 'off' (Watch mode: never a scene); the View group switch
  speed:1,         // the world speed the host runs at (main.js / play-headless set it); above 1 nothing pauses
  turnMs:7000,     // real milliseconds into a member's turn before its agent is nudged again (#148: the table waits)
  liveMs:120000,   // real milliseconds the table waits for a live agent's turn before its reflex acts, with a notice (#148)
  dropS:5,         // world seconds a scene waits for the host to drop 3x/8x to 1x before it resolves at once anyway
  drop:null,       // {reason}: a Fellowship decision asks the host (page or play-headless) for 1x; the host clears it
  frameS:1.6,      // real seconds the DM's framing stays on the banner before the first turn
  outcomeS:1.8,    // real seconds the outcome stays before the world runs on
  RESCUE:.25,      // a member below this share of max HP in a fight is a rescue moment
  dmMs:6000,       // real milliseconds the DM agent has for an at-the-table call in a scene it staged (#132); then the scripted DM fills it
};
export const SCENE_KINDS=['site','room','boss','elite','ambush','rescue','check','choice','decision'];
// Staged scenes (issue #132, sim/staged.js): extra scene kinds bring their own options, reflexes, dice and
// outcome; a scene the DM agent staged (ctx.staged) also carries at-the-table DM calls (sc.calls), each
// waited for up to TABLE.dmMs at 1x and filled by the scripted DM on silence. Registered, not imported, so
// this file does not depend on staged.js.
const EXTRA={};let STG=null;
export function setSceneKind(k,h){EXTRA[k]=h;if(!SCENE_KINDS.includes(k))SCENE_KINDS.push(k)}
export function setStageHooks(h){STG=h}
const staged=sc=>!!(STG&&sc&&sc.ctx&&sc.ctx.staged!=null);
const COOL={rescue:90,boss:240,ambush:120,check:0,elite:100000}; // game minutes before the same moment opens a scene again
const COMBAT={elite:1,ambush:1,boss:1,rescue:1};
// How each kind is played. 'turns': members act one by one in initiative order, because one act changes the next
// (combat rounds, the Crypt's chambers). 'all': everyone present answers at once, resolved in slot order. A kind
// not listed plays in turns.
export const PLAY={elite:'turns',ambush:'turns',boss:'turns',rescue:'turns',site:'turns',room:'turns',crawl:'turns',
  decision:'all',check:'all',choice:'all',meeting:'all',social:'all',trap:'all',mystery:'all'};
const together=sc=>!!sc&&sc.all===true;
const gd=t=>({t,c:'gd'}),nar=t=>({t,c:'nar'});
const byId=id=>S.agents.find(x=>x.id==id)||null;
const living=a=>a&&a.kind==='hero'&&a.state!=='dead';
const pct=a=>Math.round(a.hp/maxHp(a)*100);
const mobName=m=>m.kind==='boss'?m.name:m.elite||m.named?m.name:MOBS[m.type]?MOBS[m.type].name:'the foe';
const plain=ps=>(ps||[]).map(p=>typeof p==='string'?p:p&&p.kind==='hero'?p.name:p&&p.t||'').join('');
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
// Private LCG for line picks: the gameplay RNG is never touched by flavour.
let seed=0x1f2e3d4c;const r=()=>{seed=(Math.imul(seed,1103515245)+12345)&0x7fffffff;return seed/0x80000000};

export const tableOn=()=>!!S.fellowship&&TABLE.mode!=='off';
setSpeedSource(()=>TABLE.speed);
export const canPause=()=>tableOn()&&TABLE.speed<=1;
// #148: do these members' agents (or the owner, for an absent runner) have the say? Then the moment waits.
export const agentsDecide=L=>L.some(a=>a&&a.player&&a.state!=='dead'&&!reflexMay(a));
// Ask the host to drop to 1x at a Fellowship decision (3x/8x never auto-resolve the agents' choices).
export function requestDrop(reason){if(TABLE.speed>1)TABLE.drop={reason:clean(reason,80)}}
const holdOk=L=>tableOn()&&(TABLE.speed<=1||agentsDecide(L));
export const scene=()=>S.table||null;
export const inScene=a=>!!(S.table&&a&&S.table.ids.includes(a.id));

// ---- options a member has at its turn ----
const SPECIAL={Warrior:['hold','Hold the line at the front'],Priest:['ward','Ward the group with prayer'],Rogue:['scout','Scout ahead in the dark'],Hunter:['scout','Scout ahead and read the tracks'],Mage:['read','Read the old wards on the walls']};
const SITE_BONUS={hold:.45,ward:.45,scout:.45,read:.45,press:.3,careful:.15};
function foeOf(sc){const c=sc.ctx||{};if(sc.kind==='boss')return S.boss&&S.boss.alive?S.boss:null;
  if(c.mobs){for(const id of c.mobs){const m=S.mobs.find(x=>x.id===id);if(m&&m.alive&&!m.gone)return m}return null} // a staged pack: the first still standing
  if(c.mob!=null){const m=S.mobs.find(x=>x.id===c.mob);return m&&m.alive&&!m.gone?m:null}
  if(c.foe!=null){const b=byId(c.foe);return living(b)?b:null}return null}
const lowest=()=>{let lo=null;for(const b of fellows())if(!b.hidden||inScene(b))if(!lo||b.hp/maxHp(b)<lo.hp/maxHp(lo))lo=b;return lo};
// Combat rounds (#276): a combat scene plays up to TR.ROUNDS rounds; the foe acts at its place in the order (sc.foeAt).
// A scene saved before rounds (no sc.rd) plays its one pass as it did. The fight is over when the foe falls, runs or
// yields (sc.end), or no member is left in it (fallen, fallen back, or out of reach).
const rounds=sc=>!!(sc&&COMBAT[sc.kind]&&sc.rd!=null);
function foesOf(sc){const c=sc.ctx||{};if(c.mobs)return c.mobs.map(id=>S.mobs.find(x=>x.id===id)).filter(m=>m&&m.alive&&!m.gone);const f=foeOf(sc);return f?[f]:[]}
function inFight(sc,a){const f=foeOf(sc);return !!f&&living(a)&&!a.hidden&&!(sc.out||[]).includes(a.id)&&dist(a,f)<=TR.REACH&&(f.kind!=='boss'||a.state==='raid')}
const fighters=sc=>sc.ids.map(byId).filter(a=>inFight(sc,a));
const fightOver=sc=>!!sc.end||!foeOf(sc)||!fighters(sc).length;
const foeDue=sc=>rounds(sc)&&!sc.fd&&sc.i>=sc.foeAt;
function foeAct(sc){for(const b of foeTurn(sc,foesOf(sc),fighters(sc))){b.rd=sc.rd;sc.beats.push(b)}}
// The round is done: start the next one while the fight goes on (its rolls go to the DM log with the outcome). True = a new round.
function nextRound(sc){if(fightOver(sc)||sc.rd>=TR.ROUNDS)return false;
  for(const a of fellows())tickRound(a);const f=foeOf(sc);if(f)tickRound(f); // a round has passed: ability cooldowns and round-long effects run down
  sc.rd++;sc.acts={};sc.i=0;sc.fd=0;startTurn(sc);return true}
// The order as names, the foe at its place (agents' notices and tableView).
const orderNames=sc=>{const L=sc.ids.map(byId).filter(Boolean).map(a=>a.name),f=foeOf(sc);if(rounds(sc)&&f)L.splice(Math.min(sc.foeAt,L.length),0,foeName(f)+' (foe)');return L};
export function optionsFor(sc,a){const o=baseOptions(sc,a),L=sc&&sc.ctx&&sc.ctx.labels;return L?o.map(x=>L[x.k]?{k:x.k,text:L[x.k]}:x):o} // the DM's own labels for a staged scene's actions
function baseOptions(sc,a){if(!sc||!a)return [];const k=sc.kind;if(EXTRA[k])return EXTRA[k].options(sc,a);
  if(COMBAT[k]){const f=foeOf(sc),fn=f?(f.kind==='hero'?f.name:mobName(f)):'the foe',lo=lowest(),o=[{k:'strike',text:'Strike '+fn}];
    if(f&&f.kind!=='boss')o.push({k:'guard',text:'Draw '+fn+' onto yourself'});
    if(CLS[a.cls]&&CLS[a.cls].heal&&lo)o.push({k:'heal',text:'Heal '+(lo===a?'yourself':lo.name)+' ('+pct(lo)+'%)'});
    const pot=lo&&lo.hp<maxHp(lo)?bestUse(a,'potion'):null;if(pot)o.push({k:'potion',text:'Give a '+pot+' to '+(lo===a?'yourself':lo.name)+' ('+pct(lo)+'%)'});
    for(const id of movesOf(a))if(ready(a,id,'round')){const M=MOVES[id];if(M.target==='foe'&&!f)continue;if(M.target==='ally'&&!lo)continue;
      o.push({k:id,text:'Ability, '+M.name+' ('+M.kind+', cooldown '+M.rounds+' rounds): '+M.desc})} // class abilities (data/moves.js); ready ones only
    o.push({k:'retreat',text:'Fall back toward home'});return o}
  if(k==='site'||k==='room'){const s=SPECIAL[a.cls];return [...(s?[{k:s[0],text:s[1]}]:[]),{k:'press',text:'Press on, first into the dark'},{k:'careful',text:'Go carefully, one step at a time'}]}
  if(k==='choice')return [{k:'a',text:sc.ctx.a},{k:'b',text:sc.ctx.b}];
  if(k==='decision')return [{k:'yes',text:'Yes'},{k:'no',text:'No'}];
  if(k==='check'){const o=[{k:'steady',text:'Steady the others'},{k:'press',text:'Press on'}];if(CLS[a.cls]&&CLS[a.cls].heal)o.unshift({k:'aid',text:'Tend whoever is hurt'});return o}
  return []}

// The scripted choice: what a member does when nobody plays it (or its agent is silent).
export function reflexFor(sc,a){if(EXTRA[sc.kind])return EXTRA[sc.kind].reflex(sc,a);const k=sc.kind,mh=maxHp(a),hurt=a.hp<mh*.2,lo=lowest(),healer=CLS[a.cls]&&CLS[a.cls].heal;
  if(COMBAT[k]){if(lo&&lo.hp<maxHp(lo)*.35&&bestUse(a,'potion'))return 'potion';if(hurt&&!(healer&&lo===a))return 'retreat';if(healer&&lo&&lo.hp<maxHp(lo)*.6)return 'heal';
    const f=foeOf(sc);if(f){const mv=pickMove(a,f,fellows(),true,'round');if(mv)return mv.id} // the scripted ability policy, in rounds (sim/moves.js)
    if(a.cls==='Warrior'&&f&&f.kind==='mob'&&f.target&&f.target!==a)return 'guard';return 'strike'}
  if(k==='site'||k==='room')return SPECIAL[a.cls]?SPECIAL[a.cls][0]:'press';
  if(k==='choice'){const anyHurt=fellows().some(b=>b.hp<maxHp(b)*.6);return tm(a,'bold')>1&&!anyHurt?'a':anyHurt||tm(a,'retreat')>1?'b':a.fellowRole==='tank'?'a':'b'}
  if(k==='decision'){const P=propById(sc.ctx.prop);return P?reflexVote(a,P):'yes'}
  if(k==='check')return healer&&lo&&lo.hp<maxHp(lo)*.7?'aid':'steady';
  return null}

// ---- opening a scene ----
// Initiative: the Reflex score with gear (abilities.js score), highest first; ties by id.
function initiative(L){const rf=a=>score(a,'reflex')||10;return L.slice().sort((x,y)=>rf(y)-rf(x)||x.id-y.id)}
// Who is at an everyone-at-once scene (#182): a vote's voters; else the members within shouting range of the anchor
// (ctx.anchor or ctx.hero: the member it happened to; the leader when none), in slot order.
function present(kind,ctx){const L=fellows();if(kind==='decision'){const P=propById(ctx.prop);return P?voters(P):L}
  const an=byId(ctx.anchor!=null?ctx.anchor:ctx.hero),h=an&&L.includes(an)?an:leaderOfF();return h?L.filter(b=>b===h||inRange(h,b)):L}
function open(kind,title,frame,ctx={}){const F=S.fellowship;if(!F||S.table)return null;const all=PLAY[kind]==='all';
  const L=all?present(kind,ctx):fellows().filter(a=>!(kind==='site'||kind==='room'||kind==='crawl')||(CRYPT.group&&CRYPT.group.mem.includes(a)));
  if(!L.length)return null;
  const sc={id:F.tableSeq=(F.tableSeq||0)+1,kind,title:clean(title,80),frame,ids:(all?L:initiative(L)).map(a=>a.id),i:0,phase:'frame',t:0,acts:{},beats:[],ctx,pause:holdOk(L),at:Math.round(S.gameMin),...(all?{all:true,w:{}}:{})};
  if(COMBAT[kind]){sc.rd=1;sc.fd=0;sc.foeAt=foeSlot(sc.ids.map(byId),foeOf(sc))} // the foe joins the initiative order (#276)
  if(sc.pause)requestDrop(sc.title);
  S.table=sc;F.tableStats=F.tableStats||{scenes:0,agent:0,reflex:0,paused:0};F.tableStats.scenes++;if(sc.pause)F.tableStats.paused++;
  const order=orderNames(sc).join(', ');
  for(const a of L)if(a.player)notify(a,'TABLE ('+kind+'): '+plain(frame)+(all?' Everyone answers at once, each for themselves ('+order+').':' Initiative: '+order+'.')+' Your options: '+optionsFor(sc,a).map(o=>o.k+' = '+o.text).join('; ')+
    (all?'. Answer with scene_act(option, line) now; the table waits for everyone.':'. Answer with scene_act(option, line) now or on your turn; the table waits for you.'),3);
  if(!sc.pause){finishAll(sc);return sc}
  return sc}

export {open as openScene}; // sim/camp.js opens the camp ambush scene

// An agent's answer (scene_act), before or during its turn. Returns an error string or the act.
export function sceneAct(a,opt,line){const sc=S.table;if(!sc||!sc.ids.includes(a.id))return 'No scene at the table for you right now.';
  if(sc.phase==='outcome'||sc.phase==='done')return 'The scene is over.';
  if(together(sc)&&sc.resolved)return 'The table has already answered.';
  const i=sc.ids.indexOf(a.id);if(!together(sc)&&i<sc.i&&sc.phase==='turn')return 'Your turn has passed.';
  if(sc.acts[a.id])return 'You already acted in this scene.';
  const o=optionsFor(sc,a).find(x=>x.k===String(opt||'').toLowerCase());if(!o)return 'Choose one of: '+optionsFor(sc,a).map(x=>x.k).join(', ')+'.';
  sc.acts[a.id]={k:o.k,line:clean(line,120),by:'agent'};return sc.acts[a.id]}

// ---- turns ----
function take(sc,a,act){const o=optionsFor(sc,a).find(x=>x.k===act.k)||{k:act.k,text:act.k},res=apply(sc,a,act);
  const F=S.fellowship;if(F&&F.tableStats)F.tableStats[act.by==='agent'?'agent':'reflex']++;
  sc.beats.push({id:a.id,name:a.name,k:act.k,text:o.text,res,by:act.by,line:act.line||null});
  const first=!(sc.rd>1);sc.beats[sc.beats.length-1].rd=sc.rd||1;
  if(staged(sc)&&!together(sc)&&first)STG.onBeat(sc,sc.beats[sc.beats.length-1]); // the DM's per-act call in the first round only (later rounds are dice) // everyone at once: one combined DM call after all (STG.onAll)
  if(act.line&&a.state!=='dead'){const e=speak(a,act.line,'table',!a.player);if(a.player)agentLine(a,e)} // an agent's own line; a silent agent's reflex acts without a word
  else if(reflexMay(a)&&first)voice(sc,a,act.k); // a member whose runner is gone acts (and speaks) by reflex (#148)
  if(first)remember(a,'table',sc.title+': I chose to '+o.text.charAt(0).toLowerCase()+o.text.slice(1)+(res?' ('+res+')':'')+'.')}
const LINES={strike:['Now, while it turns!','Hit it together.','Mine. Leave this one to me.'],guard:['Here! Look at me!','On me. Get behind.','Come on, then.'],
  heal:['Hold still. Breathe.','Not yet. Not today.','Stay with us.'],retreat:['Back! Fall back!','Not like this. Go.','I am done in. Pull back.'],
  hold:['Shields up, eyes front.'],ward:['Light keep us in the dark.'],scout:['Wait here. I will look.'],read:['These marks are old. Mind the third step.'],
  press:['Forward. Waiting kills.'],careful:['Slowly. Count the doors.'],a:['The bold road. We have come this far.'],b:['The careful road. We live longer.'],
  yes:['Aye.'],no:['No. Not this.'],steady:['Easy. We have seen worse.'],aid:['Let me see that wound.']};
// A scripted member's line: the model voices it in persona when the relay is on and the world is
// paused (said in the moment, never cached); otherwise a plain line.
function voice(sc,a,k){const pool=LINES[k];if(!pool||a.hidden)return;const text=pool[Math.floor(r()*pool.length)];
  if(sc.pause&&a.brain&&S.fellowship&&S.fellowship.ai&&S.brainOn!==false&&sayOk(a)){const sid=sc.id;
    askRelay('say',snapshotFor(a,'say',{trigger:'table',ctx:{scene:sc.title,kind:sc.kind,choice:k}}),Math.min(TABLE.turnMs,4000)).then(j=>{
      const still=S.table&&S.table.id===sid&&living(a)&&!a.hidden;const t=j&&cleanLine(j.line);
      if(still)speak(a,t||text,'table',!!t)}).catch(()=>{});return}
  speak(a,text,'table')}

function apply(sc,a,act){if(EXTRA[sc.kind])return EXTRA[sc.kind].apply(sc,a,act);const f=foeOf(sc),k=act.k;
  switch(k){
  case 'strike':if(!f)return 'the foe was already gone';if(a.hidden&&f.kind!=='boss')return 'out of reach';
    if(f.kind==='mob'&&['hunt','follow','travel','fight','return'].includes(a.state)){a.state='fight';a.target=f;a.dest=null}
    if(dist(a,f)>TR.REACH)return 'closing in';if(rounds(sc))return memberStrike(sc,a,f); // the attack roll against Defense (#276)
    {const h=f.hp;strike(a,f);return 'hit for '+Math.max(0,Math.round(h-f.hp))}
  case 'guard':if(!f)return 'nothing to guard against';if(f.kind==='mob'){f.target=a;if(['hunt','follow','travel','fight'].includes(a.state)){a.state='fight';a.target=f;a.dest=null}return 'drew it on'}
    if(f.kind==='hero'&&['hunt','follow','travel','return'].includes(a.state)&&a.fac!==f.fac){a.regNext='hunt';a.state='assist';a.target=f;a.dest=null;return 'stepped in'}return 'stood ready';
  case 'heal':{const lo=lowest();if(!lo)return 'nobody to heal';const h=Math.round(maxHp(lo)*.25);lo.hp=Math.min(maxHp(lo),lo.hp+h);return '+'+h+' to '+lo.name}
  case 'potion':{const lo=lowest(),id=bestUse(a,'potion');if(!lo||!id)return 'nothing to give';const r=useItem(a,id,lo,{table:true});return r.ok?'+'+r.healed+' to '+lo.name:r.error}
  case 'retreat':if(rounds(sc))(sc.out||(sc.out=[])).push(a.id);if(a.raid){a.raid=false}if(f&&f.target===a)f.target=null;if(a.state==='duel'&&f&&f.target===a&&f.kind==='hero'){f.state='hunt';f.target=null}
    if(a.state!=='dungeon'){goHome(a);if(a.player)a.pq=[]}return 'fell back';
  case 'hold':case 'ward':case 'scout':case 'read':case 'press':case 'careful':{const g=CRYPT.group;if(!g)return null;g.bonus=Math.round(((g.bonus||0)+SITE_BONUS[k])*100)/100;
    if(k==='ward')for(const b of g.mem)b.hp=Math.min(maxHp(b),b.hp+maxHp(b)*.1);return '+'+SITE_BONUS[k]}
  case 'aid':{const lo=lowest();if(!lo)return null;const h=Math.round(maxHp(lo)*.15);lo.hp=Math.min(maxHp(lo),lo.hp+h);return '+'+h+' to '+lo.name}
  default:if(MOVES[k]){const M=MOVES[k],t=M.target==='foe'?f:M.target==='ally'?lowest():null;
    const r=useMove(a,k,t,{mode:'round',mates:fellows(),foe:f&&f.kind!=='hero'?f:null});return r.ok?r.text:r.error}return null;
  case 'a':case 'b':case 'yes':case 'no':if(sc.kind==='decision')castVote(a,sc.ctx.prop,k,act.line||'',act.by);return null;
  }}

function startTurn(sc){const a=byId(sc.ids[sc.i]);sc.t=0;sc.nudge=0;if(!a||!a.player||sc.acts[a.id])return;
  if(rounds(sc)&&(foeDue(sc)||fightOver(sc)||(sc.rd>1&&!inFight(sc,a))))return; // the foe goes first, or the fight is over, or this member is out of it
  notify(a,'YOUR TURN at the table ('+sc.title+(rounds(sc)?', round '+sc.rd:'')+'): '+optionsFor(sc,a).map(o=>o.k+' = '+o.text).join('; ')+'. scene_act(option, line); the table waits for you.',3)}
// Advance the turn pointer as far as it can go this step. Returns true while an agent is thinking.
function runTurns(sc,dt,instant){
  const R=rounds(sc);
  for(;;){if(sc.calls&&callWait(sc,dt,instant))return true;
    if(foeDue(sc)){sc.fd=1;if(!fightOver(sc))foeAct(sc);startTurn(sc);continue} // the foe's turn at its place in the order (#276)
    if(sc.i>=sc.ids.length){if(R&&nextRound(sc)){dt=0;continue}break}
    const a=byId(sc.ids[sc.i]);
    if(!living(a)||(COMBAT[sc.kind]&&(R?fightOver(sc)||(sc.out||[]).includes(a.id)||(sc.rd>1&&!inFight(sc,a)):!foeOf(sc)))){sc.i++;startTurn(sc);continue}
    let act=sc.acts[a.id];
    if(!act&&sc.kind==='decision'){const P=propById(sc.ctx.prop),v=P&&P.votes[a.id];if(v&&v.by!=='reflex')act=sc.acts[a.id]={k:v.v,line:v.reason||'',by:'agent'}} // voted with the vote tool meanwhile
    // #148: the table waits for the member's agent; a runner that is gone waits for the owner (the page's alert)
    // a live agent that already ran out the clock once in this fight is not waited for again in its later rounds (#276)
    if(!act&&a.player&&!instant&&!reflexMay(a)&&!(sc.lw&&sc.lw.includes(a.id))){if(ownerHeld(a))return true;
      sc.t+=dt;if(!sc.nudge&&sc.t*1000>=TABLE.turnMs){sc.nudge=1;notify(a,'Still your turn at the table ('+sc.title+'): the party waits for you. scene_act(option, line).',3)}
      if(sc.t*1000<TABLE.liveMs)return true;sc.late=(sc.late||0)+1;if(R)(sc.lw||(sc.lw=[])).push(a.id)}
    if(!act){const k=reflexFor(sc,a),late=a.player&&!reflexMay(a);act=sc.acts[a.id]={k,line:'',by:'reflex'};
      if(a.player)notify(a,late?'The table waited '+Math.round(TABLE.liveMs/1000)+' s for you; your reflexes chose: '+k+'.':'Your turn passed; your reflexes chose: '+k+'.',false)}
    take(sc,a,act);sc.i++;if(sc.i<sc.ids.length)startTurn(sc);dt=0}
  return false}
// Everyone at once: tick each unanswered live agent's own wait (nudge, then reflex), side by side; once nobody is
// waiting, resolve every act in slot order (reflexes chosen then, so arrival order never matters). True = waiting.
const fromVote=(sc,a)=>{if(sc.kind!=='decision'||sc.acts[a.id])return;const P=propById(sc.ctx.prop),v=P&&P.votes[a.id];
  if(v&&v.by!=='reflex')sc.acts[a.id]={k:v.v,line:v.reason||'',by:'agent'}}; // voted with the vote tool meanwhile
// The members an everyone-at-once scene still waits on for their agent (or owner).
export function waitingFor(sc){if(!together(sc)||sc.resolved)return [];return sc.ids.map(byId).filter(a=>living(a)&&a.player&&!sc.acts[a.id]&&!reflexMay(a)&&!(sc.w[a.id]&&sc.w[a.id].late))}
function runAll(sc,dt,instant){
  if(!sc.resolved){let hold=false;
    for(const id of sc.ids){const a=byId(id);if(!living(a))continue;fromVote(sc,a);if(sc.acts[id]||!a.player||instant||reflexMay(a))continue;
      const w=sc.w[id]||(sc.w[id]={t:0,nudge:0});if(w.late)continue;
      if(ownerHeld(a)){hold=true;continue}
      w.t+=dt;if(!w.nudge&&w.t*1000>=TABLE.turnMs){w.nudge=1;notify(a,'The table still waits for your answer ('+sc.title+'): scene_act(option, line).',3)}
      if(w.t*1000<TABLE.liveMs)hold=true;else{w.late=1;sc.late=(sc.late||0)+1}}
    if(sc.calls&&callWait(sc,dt,instant))return true; // the DM's opening voice, side by side with the members' answers
    if(hold)return true;
    sc.resolved=true;
    for(const id of sc.ids){const a=byId(id);if(!living(a))continue;let act=sc.acts[id];
      if(!act){const k=reflexFor(sc,a),late=!!(sc.w[id]&&sc.w[id].late);act=sc.acts[id]={k,line:'',by:'reflex'};
        if(a.player)notify(a,late?'The table waited '+Math.round(TABLE.liveMs/1000)+' s for you; your reflexes chose: '+k+'.':'The table moved on; your reflexes chose: '+k+'.',false)}
      take(sc,a,act)}
    if(staged(sc)&&STG.onAll)STG.onAll(sc);dt=0}
  return !!(sc.calls&&callWait(sc,dt,instant))}
// A staged scene's DM calls, oldest first: the DM agent's answer, or a wait of up to TABLE.dmMs at 1x, or
// the scripted DM's fill (at once at 3x/8x, when the seat is empty or the DM keeps missing). True = waiting.
function callWait(sc,dt,instant){if(!STG)return false;
  for(const c of sc.calls){if(c.done)continue;
    if(!instant&&sc.pause&&STG.live(sc)){c.t+=dt;if(c.t*1000<TABLE.dmMs)return true;sc.dmMiss=(sc.dmMiss||0)+1}
    STG.fill(sc,c);dt=0}
  return false}
const frameCalls=sc=>{if(staged(sc)&&!sc.framed){sc.framed=true;STG.onFrame(sc)}};

// ---- the outcome ----
function outcome(sc){const L=sc.beats,F=S.fellowship,by=k=>L.filter(b=>b.k===k).map(b=>b.name);let tail='';
  if(sc.kind==='choice'){const a=by('a').length,b=by('b').length,lead=leaderOfF(),lb=lead&&L.find(x=>x.id===lead.id);
    const br=a===b?(lb?lb.k:'b'):a>b?'a':'b';sc.result=br;tail='They take '+(br==='a'?sc.ctx.a:sc.ctx.b)+' ('+a+' to '+b+(a===b&&lead?', '+lead.name+' deciding':'')+').';
    const adv=(S.adventures||[]).find(v=>v.id===sc.ctx.adv);
    if(adv&&adv.phase==='active'){adv.tablePick={k:sc.ctx.k,br};if(adv.stage==='choose')adv.stage='go';const ld=byId(adv.lead);if(ld&&(ld.state==='hunt'||ld.state==='travel')){ld.state='travel';ld.dest=null}}}
  else if(sc.kind==='decision'){const P=resolveProp(propById(sc.ctx.prop),'voted at the table');tail=P&&P.result?P.result+'.':''}
  else if(COMBAT[sc.kind]){if(rounds(sc))flushRolls(sc);const f=foeOf(sc),fl=by('retreat'),fell=(sc.fell||[]).map(byId).filter(Boolean).map(b=>b.name);
    tail=(sc.end==='yield'&&f?foeName(f)+' yields and breaks off':sc.end==='fled'&&f?foeName(f)+' breaks away and runs':f?mobName(f.kind==='hero'?{elite:1,name:f.name}:f)+' '+(f.kind==='boss'||f.kind==='mob'?hurtWord(f.hp/(f.maxhp||maxHp(f))):'still stands'):'The foe is down')+'.'+(fl.length?' '+fl.join(' and ')+' fell back.':'')+
      (fell.length?' '+fell.join(' and ')+' fell.':'')+(sc.rd>1?' ('+sc.rd+' rounds.)':'')}
  else if(sc.kind==='site'||sc.kind==='room'){const g=CRYPT.group;tail=g?'They go on with the odds a little better for it (+'+(g.bonus||0)+').':''}
  else if(sc.kind==='check')tail='The road goes on.';
  else if(EXTRA[sc.kind])tail=EXTRA[sc.kind].outcome(sc)||'';
  const foeB=L.filter(b=>b.by==='foe'&&b.k==='attack'),mine=L.filter(b=>b.by!=='foe');
  const what=mine.map(b=>b.name+' '+(b.k==='a'||b.k==='b'||b.k==='yes'||b.k==='no'?'says '+b.text.toLowerCase():b.text.charAt(0).toLowerCase()+b.text.slice(1))+(b.res?' ('+b.res+')':'')+(b.by==='reflex'&&byId(b.id)&&byId(b.id).player?' [reflex]':'')).join('; ')+
    (foeB.length?'; the foe struck '+foeB.length+' time'+(foeB.length>1?'s':'')+', '+foeB.filter(b=>/: hit/.test(b.res||'')).length+' landed':'');
  sc.summary=tail;sc.phase='outcome';sc.t=0;
  if(F){campaign('table',gd(sc.title),': '+what+'. '+tail);
    log(nar(''),gd(F.name),' at the table: '+sc.title+'. '+tail)}
  if(COMBAT[sc.kind]){for(const a of fellows())tickRound(a);const f=foeOf(sc);if(f)tickRound(f)} // a round has passed: ability cooldowns and round-long effects run down
  for(const a of fellows()){notify(a,'The scene ends: '+sc.title+'. '+tail,true);if(sc.ids.includes(a.id))moment(a,'scene',sc.title)} // reflection moment (#179)
  if(staged(sc))STG.done(sc)}
function finishAll(sc){frameCalls(sc);if(together(sc))runAll(sc,0,true);else runTurns(sc,0,true);outcome(sc);S.table=null}

// ---- once per step: the paused scene (sim/index.js calls this first; true = skip the world) ----
export function tableHold(dt){const sc=S.table;if(!sc)return false;
  if(!S.fellowship||!fellows().length){S.table=null;return false}
  if(!sc.pause)return false;
  if(!tableOn()){finishAll(sc);return false} // switched to Watch mode mid-scene: resolve now
  // sped up mid-scene (or opened at 3x/8x): while the members' agents decide, ask the host for 1x and hold; a host that
  // does not answer within TABLE.dropS world seconds, or a table where only reflexes act, resolves at once (#148)
  if(TABLE.speed>1){if(sc.phase!=='outcome'&&agentsDecide(sc.ids.map(byId))){requestDrop(sc.title);sc.dropT=(sc.dropT||0)+dt;if(sc.dropT<TABLE.dropS)return true}
    finishAll(sc);return false}
  sc.dropT=0;
  if(sc.kind==='decision'&&!propById(sc.ctx.prop)){S.table=null;return false}
  if(sc.phase==='frame'){sc.t+=dt;if(sc.t<TABLE.frameS)return true;sc.phase='turn';sc.i=0;frameCalls(sc);if(!together(sc))startTurn(sc);dt=0}
  if(sc.phase==='turn'){if(together(sc)?runAll(sc,dt,false):runTurns(sc,dt,false))return true;outcome(sc);return true}
  if(sc.phase==='outcome'){sc.t+=dt;if(sc.t<TABLE.outcomeS)return true;S.table=null;return false}
  S.table=null;return false}

// ---- triggers ----
const seen=(key,cool)=>{const F=S.fellowship,m=F.tableSeen||(F.tableSeen={}),t=m[key];if(t!=null&&S.gameMin-t<cool)return true;m[key]=S.gameMin;
  const ks=Object.keys(m);if(ks.length>60)delete m[ks[0]];return false};
export function tableTick(){if(STG&&S.staged)STG.tick(); // a staged cast walks to the party, meets it (a scene) or gives up (#132)
  const F=S.fellowship;if(!F||S.table||!tableOn())return;const L=fellows();if(!L.length)return;
  // rescue: a member below RESCUE in a fight
  for(const a of L){if(!['fight','duel','assist','raid'].includes(a.state)||a.hp>=maxHp(a)*TABLE.RESCUE)continue;
    if(seen('rescue:'+a.id,COOL.rescue))continue;const f=a.target;
    open('rescue',a.name+' is going down',[a,' is down to '+pct(a)+'% against ',f&&f.kind==='hero'?f:gd(f?mobName(f):'the foe'),'. Who moves?'],{hero:a.id,...(f&&f.kind==='mob'?{mob:f.id}:f&&f.kind==='hero'?{foe:f.id}:{})});return}
  // boss: a raid engages Kragmaw
  if(S.boss&&S.boss.alive)for(const a of L)if(a.state==='raid'&&dist(a,S.boss)<6){if(seen('boss',COOL.boss))break;
    open('boss','Kragmaw the Cinder Wyrm',['The lair shakes. ',gd('Kragmaw the Cinder Wyrm'),' rears over the raid, the heat of it on every face.'],{});return}
  // ambush: an enemy hero duels a member
  for(const a of L){const f=a.target;if(a.state!=='duel'||!f||f.kind!=='hero'||f.fac===a.fac)continue;if(seen('duel:'+f.id,COOL.ambush))continue;
    open('ambush','Ambush: '+f.name,[f,' of the enemy falls on ',a,' in '+(ZONES[zoneAt(a.x,a.y)]||'the wilds')+'.'],{foe:f.id});return}
  // elite or named foe
  for(const a of L){const m=a.target;if(a.state!=='fight'||!m||m.kind!=='mob'||!(m.elite||m.named)||!m.alive)continue;if(seen('elite:'+m.id,COOL.elite))continue;
    open('elite',mobName(m),[a,' meets ',gd(mobName(m)+(m.title?', '+m.title:'')),' in '+(ZONES[zoneAt(a.x,a.y)]||'the wilds')+'.'],{mob:m.id});return}
  // the Crypt: going in, and the inner chamber
  const g=CRYPT.group;if(g&&g.phase==='inside'&&g.mem.some(a=>a.fellow)){
    if(!g.tSite){g.tSite=1;open('site',CRYPT.name,['The stair goes down into ',gd(CRYPT.name),'. Water drips; something below has heard the door.'],{});return}
    if(!g.tRoom&&g.t<12&&!g.crawl){g.tRoom=1;open('room','The inner chamber',['The last door of ',gd(CRYPT.name),'. Beyond it waits ',gd(CRYPT.boss),'.'],{});return}}
  // a DM check on one of their adventures
  const D=S.dmLog||[];if(F.tableDm==null)F.tableDm=S.dmLogSeq||0;
  if(D.length&&D[0].id>F.tableDm){let hit=null;for(const e of D){if(e.id<=F.tableDm)break;if(e.kind==='roll'&&e.detail&&e.detail.sceneType!=='fight'&&(e.heroes||[]).some(id=>F.ids.includes(id)))hit=e}
    F.tableDm=D[0].id;if(hit){const adv=(S.adventures||[]).find(v=>v.id===hit.advId);
      open('check',(adv?adv.title+': ':'')+(hit.detail.check||hit.detail.sceneType||'a check'),['The DM calls for a roll. ',...hit.summary,'.'],{adv:hit.advId,anchor:(hit.heroes||[]).find(id=>F.ids.includes(id))});return}}}

// ---- the hooks ----
// A new council proposal: a decision scene when the world can pause; else the votes run async.
setProposeHook(P=>{const L=fellows();if(agentsDecide(L))requestDrop('a vote: '+P.details); // #148: 3x/8x drop to 1x at a decision
  if(!holdOk(L)||S.table)return false;const by=byId(P.by);
  const sc=open('decision','Put to the party: '+P.details,[by||gd('The party'),' puts it to the party: ',gd(P.details),'. Everyone votes.'],{prop:P.id});
  if(sc)for(const id in P.votes)if(sc.ids.includes(+id))sc.acts[id]={k:P.votes[id].v,line:P.votes[id].reason||'',by:P.votes[id].by==='reflex'?'reflex':'agent'}; // a vote already cast counts as that member's turn
  return !!sc});
// A choice scene on a Fellowship adventure: the whole table chooses (undefined: the usual path).
setFellowChoice((adv,sc,a,spec)=>{if(!holdOk(fellows()))return undefined;
  const tp=adv.tablePick;if(tp&&tp.k===adv.idx){adv.tablePick=null;return tp.br}
  if(S.table){if(S.table.kind==='choice'&&S.table.ctx.adv===adv.id){adv.stage='choose';return 'wait'}return undefined}
  const d=adv.data||{},fill=s=>String(s||'').replace(/\{(\w+)\}/g,(m,k)=>{const v=d[k]!=null?d[k]:d[k.toLowerCase()];return typeof v==='string'?v:k==='who'?a.name:'the '+k.toLowerCase()});
  const A=spec&&spec.a?String(spec.a.label||'the bold road'):'the bold road',B=spec&&spec.b?String(spec.b.label||'the careful road'):'the careful road';
  const sc2=open('choice',(adv.title||'The road')+': a choice',[fill(spec&&spec.frame)||'The road forks.','. ',gd('a) '+A),' or ',gd('b) '+B),'?'],{adv:adv.id,k:adv.idx,a:A,b:B,anchor:a.id});
  if(!sc2)return undefined;
  adv.stage='choose';return 'wait'});

// Everyone at once: how many of those present have answered, and who the table still waits on (slot order).
function answered(sc){const L=sc.ids.map(byId).filter(living),wait=sc.resolved?[]:L.filter(b=>!sc.acts[b.id]);return {done:L.length-wait.length,of:L.length,wait}}
// What the table looks like to one member (agent tools: look, status, wait).
// A foe's state in words for the members (#188: no HP numbers to agents; the watcher's banner still has the bars).
const hurtWord=f=>f>=.95?'stands unhurt':f>=.6?'is hurt':f>=.25?'is badly hurt':'is close to falling';
export function tableView(a){const sc=S.table;if(!sc||!sc.ids.includes(a.id))return null;const cur=byId(sc.ids[sc.i]);
  const all=together(sc),live=all&&!sc.resolved&&(sc.phase==='frame'||sc.phase==='turn');
  const v={scene:sc.title,kind:sc.kind,frame:plain(sc.frame),phase:sc.phase,order:sc.ids.map(byId).filter(Boolean).map(b=>b.name),
    ...(rounds(sc)?{round:sc.rd+' of up to '+TR.ROUNDS,initiative:orderNames(sc)}:{}),
    turn:!all&&sc.phase==='turn'&&cur?cur.name:null,your_turn:all?live&&!sc.acts[a.id]:sc.phase==='turn'&&cur===a,acted:!!sc.acts[a.id]};
  if(all){const n=answered(sc);v.everyone_answers=true;v.answered=n.done+'/'+n.of;if(live&&n.wait.length)v.waiting_on=n.wait.map(b=>b.name)} // all answer at once; once you have, you may wait
  if(!sc.acts[a.id]&&sc.phase!=='outcome')v.options=optionsFor(sc,a).map(o=>o.k+' = '+o.text);
  if(v.your_turn)v.waiting_for_you=true; // #148: the table waits for your scene_act (a reflex only after a long wait)
  if(sc.beats.length)v.so_far=sc.beats.map(b=>b.name+': '+b.text+(b.res?' ('+b.res+')':'')+(b.line?' "'+b.line+'"':''));
  if(sc.narr)v.narrator=sc.narr.text; // the DM's narrate line at this table (issue #123)
  if(sc.summary)v.outcome=sc.summary;return v}
// The Fellowship's decisions that wait on a member's agent right now (#148), for the page's runner-stop alert:
// [{a, what}] for the member whose turn holds the table and every member an open vote or an adventure choice waits for.
export function decisionsWaiting(){const out=[],seen=new Set(),add=(a,what)=>{if(a&&!seen.has(a.id)&&a.player&&!reflexMay(a)){seen.add(a.id);out.push({a,what})}};
  const sc=S.table;if(sc&&sc.pause&&together(sc))for(const b of waitingFor(sc))add(b,'an answer at the table ('+sc.title+')');
  if(sc&&sc.pause&&sc.phase==='turn'&&!together(sc)){const cur=byId(sc.ids[sc.i]);if(cur&&!sc.acts[cur.id])add(cur,'a turn at the table ('+sc.title+')')}
  for(const P of openProps())if(!(sc&&sc.ctx&&sc.ctx.prop===P.id))for(const b of waitingVoters(P))add(b,'a vote ('+P.details+')'); // a vote at the table: the scene says who it waits on
  for(const v of S.adventures||[]){if(v.phase!=='active'||!v.pick||v.pick.chosen||v.stage!=='choose')continue;const ld=byId(v.lead);if(ld&&ld.fellow)add(ld,'a choice on '+(v.title||'an adventure'))}
  return out}
// What the banner shows (src/ui/table.js).
export function bannerOf(){const sc=S.table;if(!sc)return null;const cur=byId(sc.ids[sc.i]),last=sc.beats[sc.beats.length-1];
  let who=null,line;
  const pc=sc.calls&&sc.phase==='turn'?sc.calls.find(c=>!c.done):null;
  if(sc.phase==='frame')line='The DM is setting the scene…';
  else if(pc&&sc.pause)line='The DM is '+(pc.kind==='voice'?'giving them a voice':pc.kind==='complication'?'weighing a complication':'describing it')+'… ('+Math.max(0,Math.ceil(TABLE.dmMs/1000-pc.t))+' s)';
  else if(sc.phase==='turn'&&together(sc)){const n=answered(sc),held=n.wait.find(b=>b.player&&!reflexMay(b)&&ownerHeld(b)),w0=n.wait.reduce((m,b)=>Math.max(m,(sc.w[b.id]&&sc.w[b.id].t)||0),0);
    line=!n.wait.length?'Everyone has answered.':n.done+'/'+n.of+' answered · waiting for '+n.wait.map(b=>b.name).join(', ')+(held?' ('+held.name+' has no runner: Restart runner, or Resume without it)':w0*1000>=TABLE.turnMs?' ('+Math.max(0,Math.ceil(TABLE.liveMs/1000-w0))+' s before reflexes)':'')}
  else if(sc.phase==='turn'&&cur){who=cur;line=cur.player&&!sc.acts[cur.id]&&!reflexMay(cur)?(ownerHeld(cur)?cur.name+' has no runner: the table waits for you (Restart runner, or Resume without it)':cur.name+' is thinking…'+(sc.t*1000>=TABLE.turnMs?' ('+Math.max(0,Math.ceil(TABLE.liveMs/1000-sc.t))+' s before reflexes)':'')):cur.name+' acts'}
  else line=sc.summary||'';
  return {title:sc.title,kind:sc.kind,frame:sc.frame,line,who,last:last?last.name+': '+last.text+(last.res?' ('+last.res+')':''):null,
    order:sc.ids.map(byId).filter(Boolean),...(rounds(sc)?{round:sc.rd,rounds:TR.ROUNDS,foeAt:sc.foeAt,foe:foeOf(sc)?foeName(foeOf(sc)):null}:{}),turn:sc.phase==='turn'&&!together(sc)?sc.i:-1,all:together(sc),phase:sc.phase,paused:!!sc.pause,narr:sc.narr?sc.narr.text:null,
    ...(sc.ctx&&sc.ctx.cast?{cast:sc.ctx.cast,staged:true}:{})}} // a staged scene's cast (#132)
