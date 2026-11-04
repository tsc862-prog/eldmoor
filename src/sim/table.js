// Table mode (issue #68, phase B). Owned by brain-builder. DOM-free.
// When the Fellowship reaches a moment that matters, the game becomes a table: at 1x the world
// clock stops (sim/index.js step() runs only this scene), the DM frames the scene, the members act
// in initiative order (Reflex score, highest first) and the DM narrates the outcome; then the world
// runs on. At 3x and 8x a scene whose members' agents decide asks the host to drop the world to 1x
// (TABLE.drop, #148) and pauses; only a scene where every member acts by reflex (no runner, and the
// owner said go on) resolves at once and is summarised in a line or two. Mode 'off' (Watch mode)
// never opens a scene. Only the followed company's scene pauses the world (#458; S.pauseAll: any company's).
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
// Combat rounds (#276, sim/tableround.js): elite, ambush, boss and rescue scenes play up to TR.ROUNDS rounds. The foe
// joins the initiative order (Reflex, ties by id) and takes a scripted turn at its place; every blow is a d20 against
// 10 + Defense, shown in the beats and in the scene's DM log entry. The fight ends when the foe falls, runs or yields,
// or no member is left in it (fallen, fallen back, out of reach); after the last round it goes on in the world, HP and
// round cooldowns carried over. At 3x/8x a reflex-only fight resolves every round in one step.
// Parley and conditions (#296, sim/tableround.js): a member may talk an intelligent foe down once a fight (parley: hold,
// flee or yield, a dice line); stunned, rooted, poisoned and warded are checked in the round (a stun on its holder's turn,
// a root or poison at the round's end, each a save) and all of them end with the scene.
// Scene state is plain data on S.table / S.tables (ids only), so a save taken mid-scene resumes it.
// Companies (#440, epic #402): every scene belongs to a company (sc.company; a scene saved before it belongs to the
// Fellowship) and its roster is that company's members. tableTick looks at the companies in id order; a moment that
// cannot open while the company's own scene is open waits in its one-scene queue (C.tableQ, its cooldown key kept); a
// company whose queue is full is not looked at, so a third moment is never taken (its key stays unset and it can come
// again). A queued moment that went stale (the foe
// gone, the member out of the fight, older than TABLE.queueMin) is dropped and its key unset. A solo (a company of one)
// gets every scene kind; its everyone-at-once scene is one answer, and it has no vote to call (SOLO_VOTE).
// Several open scenes (#518): each company holds its own open scene at once. S.table is the primary one (the followed
// company's when it has one), every other company's sits in S.tables keyed by company id (sim/scenes.js); a company with a
// scene open is not looked at, and C.tableQ is left only for a merge's paired vote (#500) while that company's own scene is
// open. With one company nothing of this is ever used. A scene that runs on the live clock (stopsWorld false) holds its
// members and foes in place (engaged, ENG in sim/scenes.js) until it resolves; boss and Crypt scenes hold no one.
import {CRYPT,ZONES,zoneAt,dist} from '../world/map.js';
import {MOBS} from '../data/mobs.js';
import {CLS} from '../data/classes.js';
import {tm} from '../data/traits.js';
import {S} from './state.js';
import {log} from './chronicle.js';
import {strike,maxHp,goHome} from './heroes.js';
import {speak,agentLine} from './chat.js';
import {notify,hush} from './notify.js';
import {moment} from './reflect.js'; // reflection moments (#179)
import {remember} from './memory.js';
import {askRelay,snapshotFor,cleanLine} from './brain.js';
import {sayOk,setSpeedSource} from './throttle.js';
import {score} from './abilities.js';
import {bestUse,useItem} from './inv.js'; // a potion in a scene (scene_act option potion)
import {companyById,companyOf,companies,members,leaderOf,isSolo,campaign,followed,inSlots,slotHeroes,slotKeyOf,slotted} from './company.js'; // scenes belong to a company (#440)
import {setProposeHook,castVote,resolveProp,reflexVote,propById,propCompany,leaderOfF,openProps,waitingVoters,voters} from './council.js';
import {inRange} from './reach.js';
import {setFellowChoice} from './player-choice.js';
import {reflexMay,ownerHeld} from './runlink.js';
import {ENG,allScenes,sceneOf} from './scenes.js'; // one open scene per company, the engaged hold (#518)
import {liveLimit,missed,framing,unwoken,heldBack,FRAMING} from './scenewait.js'; // a queued live member gets a bounded extra wait; a timed-out one is reported (#515)
import {MOVES} from '../data/moves.js';
import {movesOf,ready,useMove,pickMove,tickRound,tableHealMove} from './moves.js'; // class abilities, round cooldowns (#81)
import {TR,foeSlot,foeTurn,memberStrike,flushRolls,foeName,roundEnd,stunCheck,canParley,parley,useOptions,useInRound,useNote,useSlug} from './tableround.js'; // combat rounds: the foe's turn and the dice (#276); conditions and parley (#296)
import {condOn,condsOf,clearRounds} from './eff.js';
import {CONDITIONS} from '../data/moves.js';
import {socialSkill,trained} from './abilities.js';
import {PICKUP_MS,callDeadline,goneEpoch} from './dmreflex.js'; // the DM call budget counts from pickup (#680)

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
  wakeGapMs:1500,  // real ms between members' wakes once the DM has set an everyone-answers scene, in seat order (#682)
  dmMs:6000,       // real milliseconds the DM agent has for an at-the-table call in a scene it staged (#132); then the scripted DM fills it
                   // (#680: counted from the moment its runner first reads the call, never past dmMs + pickupMs from the post)
  pickupMs:PICKUP_MS, // real ms a posted call may wait for a runner to pick it up before its own budget starts (#680)
  frameMs:8000,    // ... the budget of the frame call of session zero and of a newcomer's arrival (the owner waits for those)
  step:'off',      // the watcher's round pace in a paused combat scene (#285): 'off' (rounds run on), 'hold' (wait after each
                   // round until Next round, stepNext()), 'auto' (wait stepS real seconds, or Next round). Only a paused scene
                   // at 1x ever holds, so headless runs, 3x/8x and Watch mode never do; a hold rolls no dice.
  stepS:4,         // real seconds an 'auto' step waits after a round
  queueMin:30,     // game minutes a company's queued moment (#440) may wait for the table before it is dropped as stale
  LINE_MAX:600,    // characters of a member's line at the table (#571: an introduction or a story needs room); a longer one is refused, never cut
  SAME:.8,SAME_MIN:6, // a line this alike (shared words, names left out) to another member's line in the scene is refused, from SAME_MIN words up (#571)
};
// A company of one has no one to put a vote to (#440; council.js refuses the proposal itself).
export const SOLO_VOTE='You ride alone: decide and act (take_adventure; lead_to is move_to for you).';
export const SCENE_KINDS=['site','room','boss','elite','ambush','rescue','check','choice','decision'];
// Staged scenes (issue #132, sim/staged.js): extra scene kinds bring their own options, reflexes, dice and
// outcome; a scene the DM agent staged (ctx.staged) also carries at-the-table DM calls (sc.calls), each
// waited for up to TABLE.dmMs at 1x and filled by the scripted DM on silence. Registered, not imported, so
// this file does not depend on staged.js.
const EXTRA={};let STG=null;
export function setSceneKind(k,h){EXTRA[k]=h;if(!SCENE_KINDS.includes(k))SCENE_KINDS.push(k)}
export function setStageHooks(h){STG=h}
// A kind's own hooks (sim/staged.js asks an interrogation for its ctx, #431), and the staging's end for a staged scene that
// plays with its kind's own DM voice (sim/interrogate.js): registered, so neither module imports the other.
export const kindHooks=k=>EXTRA[k]||null;
export const stageDone=sc=>{if(STG&&STG.done)STG.done(sc)};
// A member's free action at the table (issue #522, sim/ruling.js): scene_act attempt with the words as its line; the DM rules on it.
let ATT=null;export function setAttemptHooks(h){ATT=h}
const staged=sc=>!!(STG&&sc&&sc.ctx&&sc.ctx.staged!=null);
// The DM's at-the-table calls of a scene: a kind that brings its own (setSceneKind(k, {..., dm:{onFrame, onAll, live, fill,
// done}}): the arrival and the opening, sim/arrival.js, #452/#437), else the staged scene's (sim/staged.js), else none.
const dmOf=sc=>sc&&EXTRA[sc.kind]&&EXTRA[sc.kind].dm?EXTRA[sc.kind].dm:staged(sc)?STG:null;
// A kind may bring more (#571, the fireside): next(sc) -> true to play another round (acts cleared, the same order); liveMs, the
// real wait for a live agent instead of TABLE.liveMs (a member that ran it out once is not waited for again in that scene);
// lineMax, the length of a member's line; view(sc, a), more fields for tableView; everyBeat, its DM's onBeat call in every
// round, not only the first (#431: an interrogation's suspect answers each question).
const kindOf=sc=>sc&&EXTRA[sc.kind]||null;
const liveOf=sc=>{const K=kindOf(sc);return K&&K.liveMs||TABLE.liveMs};
const moreOf=sc=>{const K=kindOf(sc);return !!(K&&K.next)};
// Another member's line said again with the name swapped (#571: two small models parroted the frame): words of 3+ letters, the
// scene's names left out, shared words over the larger set.
function sameLine(sc,a,line){const nm=new Set();for(const id of sc.ids){const b=byId(id);if(b)for(const w of String(b.name).toLowerCase().split(/\s+/))nm.add(w)}
  const W=t=>new Set(String(t||'').toLowerCase().replace(/[^a-z0-9 ]+/g,' ').split(' ').filter(w=>w.length>2&&!nm.has(w)));const A=W(line);if(A.size<TABLE.SAME_MIN)return false;
  const L=[...Object.entries(sc.acts).filter(([id,x])=>+id!==a.id&&x&&x.line).map(([,x])=>x.line),...sc.beats.filter(b=>b.id!==a.id&&b.line).map(b=>b.line)];
  return L.some(t=>{const B=W(t);if(!B.size)return false;let n=0;for(const w of A)if(B.has(w))n++;return n/Math.max(A.size,B.size)>=TABLE.SAME})}
// Listeners told when a scene ends (after its outcome): fn(sc). sim/fireside.js opens a debrief after a hard scene.
const enders=[];export const onSceneEnd=f=>{if(typeof f==='function')enders.push(f)};
const COOL={rescue:90,boss:240,ambush:120,check:0,elite:100000}; // game minutes before the same moment opens a scene again
const COMBAT={elite:1,ambush:1,boss:1,rescue:1};
// How each kind is played. 'turns': members act one by one in initiative order, because one act changes the next
// (combat rounds, the Crypt's chambers). 'all': everyone present answers at once, resolved in slot order. A kind
// not listed plays in turns.
export const PLAY={elite:'turns',ambush:'turns',boss:'turns',rescue:'turns',site:'turns',room:'turns',crawl:'turns',
  decision:'all',check:'all',choice:'all',meeting:'all',social:'all',trap:'all',mystery:'all',talk:'all', // talk: a conversation turned decision (#407, sim/talkscene.js)
  interrogation:'turns', // a yielded foe or a suspect questioned, question by question (#431 slice 3, sim/interrogate.js)
  arrival:'all',opening:'all', // a fallen member's recruit arrives (#452); session zero (#437): sim/arrival.js
  vision:'all', // a vision the DM staged: everyone present sees it at once (#639, sim/vision.js)
  fireside:'turns',debrief:'all'}; // talk round the fire, in turns over 3-6 rounds, and a one-round debrief after a hard scene (#571, sim/fireside.js)
const together=sc=>!!sc&&sc.all===true;
const gd=t=>({t,c:'gd'}),nar=t=>({t,c:'nar'});
const byId=id=>S.agents.find(x=>x.id==id)||null;
const living=a=>a&&a.kind==='hero'&&a.state!=='dead';
const pct=a=>Math.round(a.hp/maxHp(a)*100);
const mobName=m=>m.kind==='boss'?m.name:m.elite||m.named?m.name:MOBS[m.type]?MOBS[m.type].name:'the foe';
const plain=ps=>(ps||[]).map(p=>typeof p==='string'?p:p&&p.kind==='hero'?p.name:p&&p.t||'').join('');
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
// Private LCG for line picks: the gameplay RNG is never touched by flavour.
const SEED0=0x1f2e3d4c;let seed=SEED0;export const resetTableSeed=()=>{seed=SEED0}; // init() puts the private stream back (#674)
const r=()=>{seed=(Math.imul(seed,1103515245)+12345)&0x7fffffff;return seed/0x80000000};

export const tableOn=()=>(!!slotted()||companies().length>0)&&TABLE.mode!=='off'; // any company (#440)
// The scene's company and its members. The Fellowship keeps its slot order (slotHeroes(slotted())); any other company its join order.
export const sceneCompany=sc=>!sc?null:sc.company!=null?companyById(sc.company):slotted()||null;
const memOf=C=>!C?[]:C===slotted()?slotHeroes(slotted()):members(C).filter(a=>!a.hire); // a hire is never seated at a scene (#634)
const leadOf=C=>!C?null:C===slotted()?leaderOfF():leaderOf(C);
const scMem=sc=>memOf(sceneCompany(sc));
// A company other than the Fellowship comes to the table only while one of its agents has the say (a runner holds it,
// or its runner is gone and the owner has not answered). A company that plays wholly by reflex (no runner, as in
// headless runs and checks) plays on in the world on its autopilot, as with the Table off: a reflex-only scene would
// only swap the autopilot's cautious reflexes for the table's and stop the clock for nothing. The Fellowship keeps
// its reflex-only scenes (its seeded hashes and record count on them).
const atTable=C=>!!C&&(C===slotted()||agentsDecide(memOf(C)));
export const companyAtTable=atTable; // sim/sites.js (#69): a site's crawl runs at the table only for a company with the say
// Who is down in the dungeon a crawl scene belongs to: a DM-made site's group (ctx.site, #69) or the Crypt's.
const dunMem=ctx=>{const id=ctx&&ctx.site;if(id!=null){const D=((S.sites&&S.sites.list)||[]).find(x=>x.id===id);return D&&D.group?D.group.mem:[]}return CRYPT.group?CRYPT.group.mem:[]};
// Why a company may not put something to a vote at the table: a solo has no one to ask. null = it may.
export function voteRefusal(C){return C&&!C.slots&&isSolo(C)?SOLO_VOTE:null}
setSpeedSource(()=>TABLE.speed);
export const canPause=()=>tableOn()&&TABLE.speed<=1;
// Whose scene stops the world (#458): at 1x only the followed company's (S.followId); any other company's scene plays on
// the live clock (its agents still decide, with their normal waits) unless the watcher's "Pause for any company" is on
// (S.pauseAll, saved with the world; absent = off, so older saves and seeded worlds are untouched). One company: always.
export const pauseAll=()=>!!S.pauseAll;
export function setPauseAll(on){if(on)S.pauseAll=true;else delete S.pauseAll}
export const stopsWorld=sc=>{if(!sc||!sc.pause||S.pauseAll)return !!(sc&&sc.pause);const F=followed();return !F||sceneCompany(sc)===F};
// #148: do these members' agents (or the owner, for an absent runner) have the say? Then the moment waits.
export const agentsDecide=L=>L.some(a=>a&&a.player&&a.state!=='dead'&&!reflexMay(a));
// Ask the host to drop to 1x at a Fellowship decision (3x/8x never auto-resolve the agents' choices).
export function requestDrop(reason){if(TABLE.speed>1)TABLE.drop={reason:clean(reason,80)}}
const holdOk=L=>tableOn()&&(TABLE.speed<=1||agentsDecide(L));
export const scene=()=>S.table||null;
export const inScene=a=>!!sceneOf(a);
// ---- one open scene per company (#518) ----
const cidOf=sc=>{const C=sceneCompany(sc);return C?C.id:-1};
// The company's open scene, or null.
export function sceneFor(C){if(!C)return null;const T=S.table;if(T&&cidOf(T)===C.id)return T;return S.tables&&S.tables[C.id]||null}
const stash=sc=>{(S.tables||(S.tables={}))[cidOf(sc)]=sc};
const tidy=()=>{if(S.tables&&!Object.keys(S.tables).length)delete S.tables};
const others=()=>S.tables?Object.keys(S.tables).sort((x,y)=>x-y):[];
// A new scene: the primary when the table is free, or when it stops the world and the primary does not; else beside it.
function place(sc){const P=S.table;if(!P){S.table=sc;return}if(stopsWorld(sc)&&!stopsWorld(P)){stash(P);S.table=sc}else stash(sc)}
// The next primary: a scene that stops the world first, else the lowest company id.
function promote(){const T=S.tables;if(!T)return;const ks=others();if(!ks.length){tidy();return}const k=ks.find(x=>stopsWorld(T[x]))||ks[0];S.table=T[k];delete T[k];tidy()}
function closeScene(sc){if(S.table===sc){S.table=null;promote();return}const T=S.tables;if(!T)return;for(const k in T)if(T[k]===sc)delete T[k];tidy()}
// Keep the primary the scene that stops the world (the watcher followed another company meanwhile).
function primary(){if(!S.tables)return;if(!S.table){promote();return}if(stopsWorld(S.table))return;const T=S.tables,k=others().find(x=>stopsWorld(T[x]));if(k==null)return;const P=S.table;S.table=T[k];delete T[k];stash(P)}
// Every open scene, primary first (the banner lists the others, #518).
export const openScenes=()=>allScenes();

// ---- options a member has at its turn ----
const SPECIAL={Warrior:['hold','Hold the line at the front'],Priest:['ward','Ward the group with prayer'],Rogue:['scout','Scout ahead in the dark'],Hunter:['scout','Scout ahead and read the tracks'],Mage:['read','Read the old wards on the walls'],Wildspeaker:['ward','Ask the roots for a steadier hand for all'],Skald:['read','Sing the old verses on the walls and hear what they warn of']};
const SITE_BONUS={hold:.45,ward:.45,scout:.45,read:.45,press:.3,careful:.15};
function foeOf(sc){const c=sc.ctx||{};if(sc.kind==='boss')return S.boss&&S.boss.alive?S.boss:null;
  if(c.mobs){for(const id of c.mobs){const m=S.mobs.find(x=>x.id===id);if(m&&m.alive&&!m.gone)return m}return null} // a staged pack: the first still standing
  if(c.mob!=null){const m=S.mobs.find(x=>x.id===c.mob);return m&&m.alive&&!m.gone?m:null}
  if(c.foe!=null){const b=byId(c.foe);return living(b)?b:null}return null}
const lowest=sc=>{let lo=null;for(const b of scMem(sc))if(!b.hidden||inScene(b))if(!lo||b.hp/maxHp(b)<lo.hp/maxHp(lo))lo=b;return lo};
// Combat rounds (#276): a combat scene plays up to TR.ROUNDS rounds; the foe acts at its place in the order (sc.foeAt).
// A scene saved before rounds (no sc.rd) plays its one pass as it did. The fight is over when the foe falls, runs or
// yields (sc.end), or no member is left in it (fallen, fallen back, or out of reach).
const rounds=sc=>!!(sc&&COMBAT[sc.kind]&&sc.rd!=null);
function foesOf(sc){const c=sc.ctx||{};if(c.mobs)return c.mobs.map(id=>S.mobs.find(x=>x.id===id)).filter(m=>m&&m.alive&&!m.gone);const f=foeOf(sc);return f?[f]:[]}
// Every foe the scene named, standing or not (the outcome clears their conditions, #296).
function sceneFoes(sc){const c=sc.ctx||{},L=[];if(sc.kind==='boss'&&S.boss)L.push(S.boss);for(const id of c.mobs||(c.mob!=null?[c.mob]:[])){const m=S.mobs.find(x=>x.id===id);if(m)L.push(m)}
  if(c.foe!=null){const b=byId(c.foe);if(b)L.push(b)}return L}
function inFight(sc,a){const f=foeOf(sc);return !!f&&living(a)&&!a.hidden&&!(sc.out||[]).includes(a.id)&&dist(a,f)<=TR.REACH&&(f.kind!=='boss'||a.state==='raid')}
const fighters=sc=>sc.ids.map(byId).filter(a=>inFight(sc,a));
const fightOver=sc=>!!sc.end||!foeOf(sc)||!fighters(sc).length;
const foeDue=sc=>rounds(sc)&&!sc.fd&&sc.i>=sc.foeAt;
function foeAct(sc){for(const b of foeTurn(sc,foesOf(sc),fighters(sc))){b.rd=sc.rd;sc.beats.push(b)}}
// The round is done: start the next one while the fight goes on (its rolls go to the DM log with the outcome). True = a new round.
function nextRound(sc){if(fightOver(sc)||sc.rd>=TR.ROUNDS)return false;delete sc.sh;
  for(const b of roundEnd(sc,sc.ids.map(byId).filter(a=>living(a)&&!(sc.out||[]).includes(a.id)),foesOf(sc))){b.rd=sc.rd;sc.beats.push(b)} // poison bites, roots and poisons are saved against (#296)
  if(fightOver(sc))return false;
  for(const a of scMem(sc))tickRound(a);for(const f of foesOf(sc))tickRound(f); // a round has passed: ability cooldowns and round-long effects run down
  sc.rd++;sc.acts={};sc.i=0;sc.fd=0;startTurn(sc);return true}
// Step mode (#285): a round is done and another will follow; hold the paused scene for the watcher (TABLE.step).
// sc.sh = {rd, t, go}: the round it holds after, real seconds held, released. True = hold this step.
const moreRounds=sc=>rounds(sc)&&!fightOver(sc)&&sc.rd<TR.ROUNDS;
function stepHold(sc,dt){if(TABLE.step==='off'||!stopsWorld(sc)||TABLE.speed>1||!moreRounds(sc))return false;
  const h=sc.sh&&sc.sh.rd===sc.rd?sc.sh:(sc.sh={rd:sc.rd,t:0,go:0});if(h.go)return false;
  h.t+=dt;if(TABLE.step==='auto'&&h.t>=TABLE.stepS){h.go=1;return false}return true}
const holding=sc=>!!(sc&&sc.sh&&!sc.sh.go&&sc.sh.rd===sc.rd&&sc.phase==='turn'&&sc.i>=sc.ids.length&&TABLE.step!=='off');
// The watcher's Next round (the banner's button): release a held round. True when a round was held.
export function stepNext(){const sc=S.table;if(!holding(sc))return false;sc.sh.go=1;return true}
// The order as names, the foe at its place (agents' notices and tableView).
const orderNames=sc=>{const L=sc.ids.map(byId).filter(Boolean).map(a=>a.name),f=foeOf(sc);if(rounds(sc)&&f)L.splice(Math.min(sc.foeAt,L.length),0,foeName(f)+' (foe)');return L};
export function optionsFor(sc,a){const o0=baseOptions(sc,a),L=sc&&sc.ctx&&sc.ctx.labels,o=L?o0.map(x=>L[x.k]?{k:x.k,text:L[x.k]}:x):o0;
  if(ATT&&a&&a.player&&sc&&sc.kind!=='decision'&&!(EXTRA[sc.kind]&&EXTRA[sc.kind].noAttempt)&&o.length)o.push({k:'attempt',text:ATT.label});return o} // the DM's own labels for a staged scene's actions
function baseOptions(sc,a){if(!sc||!a)return [];const k=sc.kind;if(EXTRA[k])return EXTRA[k].options(sc,a);
  if(COMBAT[k]){const f=foeOf(sc),fn=f?(f.kind==='hero'?f.name:mobName(f)):'the foe',lo=lowest(sc),o=[{k:'strike',text:'Strike '+fn}];
    if(f&&f.kind!=='boss')o.push({k:'guard',text:'Draw '+fn+' onto yourself'});
    if(CLS[a.cls]&&CLS[a.cls].heal&&lo)o.push({k:'heal',text:'Heal '+(lo===a?'yourself':lo.name)+' ('+pct(lo)+'%)'});
    const pot=lo&&lo.hp<maxHp(lo)?bestUse(a,'potion'):null;if(pot)o.push({k:'potion',text:'Give a '+pot+' to '+(lo===a?'yourself':lo.name)+' ('+pct(lo)+'%)'});
    for(const id of movesOf(a))if(ready(a,id,'round')){const M=MOVES[id];if(M.target==='foe'&&!f)continue;if(M.target==='ally'&&!lo)continue;
      o.push({k:id,text:'Ability, '+M.name+' ('+M.kind+', cooldown '+M.rounds+' rounds): '+M.desc})} // class abilities (data/moves.js); ready ones only
    o.push(...useOptions(sc,a,lo)); // a potion or scroll from the pack as the round's act (#360): 'use:<item>'
    if(rounds(sc)&&canParley(f)&&!(sc.pl||[]).includes(a.id))o.push({k:'parley',text:'Talk '+fn+' down ('+socialSkill(a)+', once a fight)'}); // #296
    if(!(rounds(sc)&&condOn(a,'root')))o.push({k:'retreat',text:'Fall back toward home'});return o} // a rooted member cannot fall back
  if(k==='site'||k==='room'){const s=SPECIAL[a.cls];return [...(s?[{k:s[0],text:s[1]}]:[]),{k:'press',text:'Press on, first into the dark'},{k:'careful',text:'Go carefully, one step at a time'}]}
  if(k==='choice')return [{k:'a',text:sc.ctx.a},{k:'b',text:sc.ctx.b}];
  if(k==='decision')return [{k:'yes',text:'Yes'},{k:'no',text:'No'}];
  if(k==='check'){const o=[{k:'steady',text:'Steady the others'},{k:'press',text:'Press on'}];if(CLS[a.cls]&&CLS[a.cls].heal)o.unshift({k:'aid',text:'Tend whoever is hurt'});return o}
  return []}

// The scripted choice: what a member does when nobody plays it (or its agent is silent).
export function reflexFor(sc,a){if(EXTRA[sc.kind])return EXTRA[sc.kind].reflex(sc,a);const k=sc.kind,mh=maxHp(a),hurt=a.hp<mh*.2,lo=lowest(sc),mem=scMem(sc),healer=CLS[a.cls]&&CLS[a.cls].heal;
  if(COMBAT[k]){const f=foeOf(sc),talk=rounds(sc)&&canParley(f)&&!(sc.pl||[]).includes(a.id),rooted=rounds(sc)&&condOn(a,'root');
    const low=lo&&lo.hp<maxHp(lo)*.35,hm=healer&&low?tableHealMove(a,mem):null;if(hm)return hm;if(low&&bestUse(a,'potion'))return 'potion'; // badly hurt: a healer's class move first, then a potion, then the plain heal below (#387)
    if(hurt&&!(healer&&lo===a)&&!rooted)return 'retreat';if(hurt&&rooted&&talk)return 'parley';if(healer&&lo&&lo.hp<maxHp(lo)*.6)return tableHealMove(a,mem)||'heal'; // the class heal move when it is ready and fits (#347), else the plain heal
    if(talk&&f.hp<(f.kind==='hero'?maxHp(f):f.maxhp)*.35&&trained(a,socialSkill(a)))return 'parley'; // a trained tongue offers a beaten foe its life (#296)
    if(f){const mv=pickMove(a,f,mem,true,'round');if(mv)return mv.id} // the scripted ability policy, in rounds (sim/moves.js)
    if(a.cls==='Warrior'&&f&&f.kind==='mob'&&f.target&&f.target!==a)return 'guard';return 'strike'}
  if(k==='site'||k==='room')return SPECIAL[a.cls]?SPECIAL[a.cls][0]:'press';
  if(k==='choice'){const anyHurt=mem.some(b=>b.hp<maxHp(b)*.6);return tm(a,'bold')>1&&!anyHurt?'a':anyHurt||tm(a,'retreat')>1?'b':slotKeyOf(a)==='tank'?'a':'b'}
  if(k==='decision'){const P=propById(sc.ctx.prop);return P?reflexVote(a,P):'yes'}
  if(k==='check')return healer&&lo&&lo.hp<maxHp(lo)*.7?'aid':'steady';
  return null}

// ---- opening a scene ----
// Initiative: the Reflex score with gear (abilities.js score), highest first; ties by id.
function initiative(L){const rf=a=>score(a,'reflex')||10;return L.slice().sort((x,y)=>rf(y)-rf(x)||x.id-y.id)}
// Who is at an everyone-at-once scene (#182): a vote's voters; else the members within shouting range of the anchor
// (ctx.anchor or ctx.hero: the member it happened to; the leader when none), in slot order.
function present(kind,ctx,C){const L=memOf(C);if(kind==='decision'){const P=propById(ctx.prop);return P?voters(P):L}
  const an=byId(ctx.anchor!=null?ctx.anchor:ctx.hero),h=an&&L.includes(an)?an:leadOf(C);return h?L.filter(b=>b===h||inRange(h,b)):L}
// The company a scene opened without one belongs to: the member it happened to, else the Fellowship (the camp ambush,
// the crawl's rooms and staged scenes still serve the Fellowship until their own slices, #441 and the DM's).
const ctxCompany=ctx=>{const c=ctx||{};if(c.company!=null)return companyById(c.company);const h=byId(c.anchor!=null?c.anchor:c.hero);return companyOf(h)||slotted()||null};
// Elites are tuned for the five-slot Fellowship (#502). A smaller company meets one scaled down once, on the scene's open: hp by size
// (n=1 .52 ... n=4 .88) and by how far the elite's level stands over the company's average, its blows a little lighter (n=1 .84).
// The five-slot company and a full five are untouched. m.scaled keeps it to one pass, whoever meets it next.
export function eliteFactor(n,avg,lvl){const over=Math.max(0,lvl-avg-2);return {hp:Math.max(.35,(.4+.12*Math.min(5,n))*Math.max(.6,1-.08*over)),hit:.8+.04*Math.min(5,n)}}
export function scaleElite(F,L,ctx){const m=ctx&&ctx.mob!=null?S.mobs.find(x=>x.id===ctx.mob):null;if(!m||m.scaled||F.slots||L.length>=5)return;
  const avg=L.reduce((t,a)=>t+a.lvl,0)/L.length,k=eliteFactor(L.length,avg,m.lvl||1);
  const r=m.hp/(m.maxhp||1);m.maxhp=Math.max(10,Math.round(m.maxhp*k.hp));m.hp=Math.max(1,Math.round(m.maxhp*r));m.hit=(m.hit||1)*k.hit;m.scaled=+k.hp.toFixed(2)}
function open(kind,title,frame,ctx={},C0){const F=C0||ctxCompany(ctx);if(!F||sceneFor(F))return null;const all=PLAY[kind]==='all';
  if(kind==='decision'&&voteRefusal(F))return null; // a solo has no one to vote with (#440)
  if(!atTable(F))return null; // no agent of this company has the say: it plays on by reflex (#440)
  const L=(ctx.ids?ctx.ids.map(byId).filter(living):all?present(kind,ctx,F):memOf(F).filter(a=>!(kind==='site'||kind==='room'||kind==='crawl')||dunMem(ctx).includes(a))).filter(a=>!(ctx.skip||[]).includes(a.id)); // ctx.ids: a kind that names its own actors (the honour duel's two, #633, sim/challenge.js) // skip: the newcomer of an arrival (#452), voiced by the DM
  if(!L.length)return null;
  const sc={id:F.tableSeq=(F.tableSeq||0)+1,company:F.id,kind,title:clean(title,80),frame,ids:(all?L:initiative(L)).map(a=>a.id),i:0,phase:'frame',t:0,acts:{},beats:[],ctx,pause:holdOk(L),at:Math.round(S.gameMin),...(all?{all:true,w:{}}:{})};
  if(kind==='elite')scaleElite(F,L,ctx);
  if(COMBAT[kind]){sc.rd=1;sc.fd=0;sc.foeAt=foeSlot(sc.ids.map(byId),foeOf(sc))} // the foe joins the initiative order (#276)
  if(sc.pause)requestDrop(sc.title);
  place(sc);F.tableStats=F.tableStats||{scenes:0,agent:0,reflex:0,paused:0};F.tableStats.scenes++;if(sc.pause)F.tableStats.paused++;
  if(!sc.pause){for(const a of L)if(a.player)tableNote(sc,a,plain(frame));finishAll(sc);return sc}
  sc.wk={}; // a paused scene wakes its members once the DM has set it (#682, wakeStep)
  return sc}

export {open as openScene}; // sim/camp.js opens the camp ambush scene
// The must-answer event that wakes a member's runner for a scene, with the frame as it stands.
function tableNote(sc,a,frame){const all=together(sc),order=orderNames(sc).join(', ');
  notify(a,'TABLE ('+sc.kind+'): '+frame+(all?' Everyone answers at once, each for themselves ('+order+').':' Initiative: '+order+'.')+' Your options: '+optionsFor(sc,a).map(o=>o.k+' = '+o.text).join('; ')+
    (all?'. Answer with scene_act(option, line) now; the table waits for everyone.':'. Answer with scene_act(option, line) now or on your turn; the table waits for you.'),3)}
// The frame the members are woken with (#682): the DM's frame call when it has one, else the scene's frame and the opening
// voice lines (the DM agent's or the scripted DM's, whichever answered).
function framedText(sc){const op=(sc.calls||[]).filter(c=>c.op&&c.done&&c.text),fr=op.find(c=>c.kind==='frame');
  return fr?fr.text:plain(sc.frame)+(op.length?' '+op.map(c=>(c.kind==='voice'&&c.who&&c.who!=='the narrator'?c.who+': ':'')+c.text).join(' '):'')}
// Once the DM has set a paused scene: wake its agent members with the final frame, everyone at once in seat order
// TABLE.wakeGapMs apart (so five runners do not ask for the model in the same second), a turns scene all together (its
// turn order wakes one at a time after). Scene seconds, like the rest of the table.
function wakeStep(sc,dt){const W=sc.wk;if(!W||W.done||sc.phase!=='turn'||framing(sc))return;
  if(W.n==null){W.n=1;for(const id of sc.ids)if(sc.acts[id])W[id]='acted'} // who had answered when the frame was set takes no seat in the order
  W.t=(W.t||0)+dt;const all=together(sc),text=framedText(sc);let i=0,left=false;
  for(const id of sc.ids){const a=byId(id);if(!living(a)||!a.player||reflexMay(a))continue;if(W[id]==='acted')continue;const at=all?i++*TABLE.wakeGapMs/1000:0; // seat order among those still to answer (a member with no runner acts by reflex: no seat)
    if(W[id])continue;if(W.t<at){left=true;continue}W[id]=1;tableNote(sc,a,text)}
  if(!left){W.done=1;if(!all)startTurn(sc)}}

// An agent's answer (scene_act), before or during its turn. Returns an error string or the act.
export function sceneAct(a,opt,line){const sc=sceneOf(a);if(!sc||!sc.ids.includes(a.id))return 'No scene at the table for you right now.';
  if(sc.phase==='outcome'||sc.phase==='done')return 'The scene is over.';
  if(together(sc)&&sc.resolved)return 'The table has already answered.';
  if(heldBack(sc,a))return FRAMING; // the DM sets the scene first (#682)
  const i=sc.ids.indexOf(a.id);if(!together(sc)&&i<sc.i&&sc.phase==='turn')return 'Your turn has passed.';
  if(sc.acts[a.id])return 'You already acted in this scene.';
  let key=String(opt||'').trim().toLowerCase();if(key.startsWith('use:'))key='use:'+useSlug(key.slice(4)); // 'use:Redroot Draught' or 'use:redroot-draught'
  const o=key==='use'?optionsFor(sc,a).find(x=>x.k.startsWith('use:')):optionsFor(sc,a).find(x=>x.k===key);if(!o)return 'Choose one of: '+optionsFor(sc,a).map(x=>x.k).join(', ')+'.'; // a bare 'use': the first item offered
  const said=clean(line,1e4);if(said.length>TABLE.LINE_MAX)return 'Too long: keep your line under '+TABLE.LINE_MAX+' characters (yours has '+said.length+').';
  if(said&&sameLine(sc,a,said))return 'Someone already said that at this table; say it your own way, about yourself.';
  if(o.k==='attempt'){if(!ATT)return 'Choose one of: '+optionsFor(sc,a).map(x=>x.k).join(', ')+'.';const rid=ATT.start(sc,a,said);if(typeof rid==='string')return rid;
    sc.acts[a.id]={k:'attempt',line:said,by:'agent',rid};return sc.acts[a.id]} // the DM rules on it before the member's turn plays (#522)
  sc.acts[a.id]={k:o.k,line:said,by:'agent'};return sc.acts[a.id]}

// ---- turns ----
function take(sc,a,act){delete sc.rr;delete sc.rc;delete sc.ru;const o=optionsFor(sc,a).find(x=>x.k===act.k)||{k:act.k,text:act.k},res=apply(sc,a,act),roll=sc.rr,chk=sc.rc,use=sc.ru;delete sc.rr;delete sc.rc;delete sc.ru; // a strike's roll as data (#285), a parley's check (#296)
  const F=sceneCompany(sc);if(F&&F.tableStats)F.tableStats[act.by==='agent'?'agent':'reflex']++;
  sc.beats.push({id:a.id,name:a.name,k:act.k,text:o.text,res,by:act.by,line:act.line||null,...(roll?{roll}:{}),...(chk?{check:chk}:{}),...(use?{use}:{})}); // an item used (#360): {item, on, ok, effect, healed?}
  const first=!(sc.rd>1);sc.beats[sc.beats.length-1].rd=sc.rd||1;
  {const H=dmOf(sc),K=kindOf(sc);if(H&&H.onBeat&&!together(sc)&&(first||(K&&K.everyBeat)))H.onBeat(sc,sc.beats[sc.beats.length-1])} // the DM's per-act call in the first round only (later rounds are dice) // everyone at once: one combined DM call after all (STG.onAll)
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
function voice(sc,a,k){const pool=LINES[k];if(!pool||a.hidden)return;const text=pool[Math.floor(r()*pool.length)],C=sceneCompany(sc);
  if(sc.pause&&a.brain&&C&&C.ai&&S.brainOn!==false&&sayOk(a)){const sid=sc.id,cid=sc.company;
    askRelay('say',snapshotFor(a,'say',{trigger:'table',ctx:{scene:sc.title,kind:sc.kind,choice:k}}),Math.min(TABLE.turnMs,4000)).then(j=>{
      const T=sceneFor(companyById(cid)),still=T&&T.id===sid&&living(a)&&!a.hidden;const t=j&&cleanLine(j.line);
      if(still)speak(a,t||text,'table',!!t)}).catch(()=>{});return}
  speak(a,text,'table')}

function apply(sc,a,act){if(act.k==='attempt')return ATT?ATT.apply(sc,a,act):'nothing came of it'; // a free action, ruled by the DM (#522)
  if(EXTRA[sc.kind])return EXTRA[sc.kind].apply(sc,a,act);const f=foeOf(sc),k=act.k;
  if(COMBAT[sc.kind]&&k.startsWith('use:'))return useInRound(sc,a,k,lowest(sc)); // an item from the pack (#360)
  switch(k){
  case 'strike':if(!f)return 'the foe was already gone';if(a.hidden&&f.kind!=='boss')return 'out of reach';
    if(f.kind==='mob'&&['hunt','follow','travel','fight','return'].includes(a.state)){a.state='fight';a.target=f;a.dest=null}
    if(dist(a,f)>TR.REACH)return 'closing in';if(rounds(sc))return memberStrike(sc,a,f); // the attack roll against Defense (#276)
    {const h=f.hp;strike(a,f);return 'hit for '+Math.max(0,Math.round(h-f.hp))}
  case 'guard':if(!f)return 'nothing to guard against';if(f.kind==='mob'){f.target=a;if(['hunt','follow','travel','fight'].includes(a.state)){a.state='fight';a.target=f;a.dest=null}return 'drew it on'}
    if(f.kind==='hero'&&['hunt','follow','travel','return'].includes(a.state)&&a.fac!==f.fac){a.regNext='hunt';a.state='assist';a.target=f;a.dest=null;return 'stepped in'}return 'stood ready';
  case 'heal':{const lo=lowest(sc);if(!lo)return 'nobody to heal';const h=Math.round(maxHp(lo)*.25);lo.hp=Math.min(maxHp(lo),lo.hp+h);return '+'+h+' to '+lo.name}
  case 'potion':{const lo=lowest(sc),id=bestUse(a,'potion');if(!lo||!id)return 'nothing to give';const r=useItem(a,id,lo,{table:true});useNote(sc,a,id,lo,r);return r.ok?'+'+r.healed+' to '+lo.name+' ('+id+')':r.error}
  case 'parley':if(!rounds(sc)||!canParley(f))return 'no one there will listen';return parley(sc,a,foesOf(sc),fighters(sc)); // a say-check against the foe's temper (#296)
  case 'retreat':if(rounds(sc)&&condOn(a,'root'))return 'rooted: cannot fall back';if(rounds(sc))(sc.out||(sc.out=[])).push(a.id);if(a.raid){a.raid=false}if(f&&f.target===a)f.target=null;if(a.state==='duel'&&f&&f.target===a&&f.kind==='hero'){f.state='hunt';f.target=null}
    if(a.state!=='dungeon'){goHome(a);if(a.player)a.pq=[]}return 'fell back';
  case 'hold':case 'ward':case 'scout':case 'read':case 'press':case 'careful':{const g=CRYPT.group;if(!g)return null;g.bonus=Math.round(((g.bonus||0)+SITE_BONUS[k])*100)/100;
    if(k==='ward')for(const b of g.mem)b.hp=Math.min(maxHp(b),b.hp+maxHp(b)*.1);return '+'+SITE_BONUS[k]}
  case 'aid':{const lo=lowest(sc);if(!lo)return null;const h=Math.round(maxHp(lo)*.15);lo.hp=Math.min(maxHp(lo),lo.hp+h);return '+'+h+' to '+lo.name}
  default:if(MOVES[k]){const M=MOVES[k],t=M.target==='foe'?f:M.target==='ally'?lowest(sc):null;
    const r=useMove(a,k,t,{mode:'round',mates:scMem(sc),foe:f&&f.kind!=='hero'?f:null});return r.ok?r.text:r.error}return null;
  case 'a':case 'b':case 'yes':case 'no':if(sc.kind==='decision')castVote(a,sc.ctx.prop,k,act.line||'',act.by);return null;
  }}

function startTurn(sc){const a=byId(sc.ids[sc.i]);sc.t=0;sc.nudge=0;if(!a||!a.player||sc.acts[a.id]||sc.wk&&!sc.wk.done)return; // not before the DM has set the scene (#682)
  if(rounds(sc)&&(foeDue(sc)||fightOver(sc)||(sc.rd>1&&!inFight(sc,a))||condOn(a,'stun')))return; // the foe goes first, or the fight is over, or this member is out of it or stunned (its save comes first, #296)
  notify(a,'YOUR TURN at the table ('+sc.title+(rounds(sc)?', round '+sc.rd:'')+'): '+optionsFor(sc,a).map(o=>o.k+' = '+o.text).join('; ')+'. scene_act(option, line); the table waits for you.',3)}
// Advance the turn pointer as far as it can go this step. Returns true while an agent is thinking.
function runTurns(sc,dt,instant){
  const R=rounds(sc);
  for(;;){if(sc.calls&&callWait(sc,dt,instant))return true;
    if(foeDue(sc)){sc.fd=1;if(!fightOver(sc))foeAct(sc);startTurn(sc);continue} // the foe's turn at its place in the order (#276)
    if(sc.i>=sc.ids.length){if(R&&!instant&&stepHold(sc,dt))return true;if(R&&nextRound(sc)){dt=0;continue} // the watcher's step mode (#285)
      if(!R&&moreOf(sc)&&kindOf(sc).next(sc)){sc.acts={};sc.i=0;startTurn(sc);dt=0;continue}break} // another round of a kind that plays several (#571)
    const a=byId(sc.ids[sc.i]);
    if(!living(a)||(COMBAT[sc.kind]&&(R?fightOver(sc)||(sc.out||[]).includes(a.id)||(sc.rd>1&&!inFight(sc,a)):!foeOf(sc)))){sc.i++;startTurn(sc);continue}
    if(R&&condOn(a,'stun')){const b=stunCheck(sc,a);b.rd=sc.rd;sc.beats.push(b); // a stunned member's save, before anyone waits on it (#296)
      if(b.k==='stunned'){sc.acts[a.id]={k:'stunned',line:'',by:'cond'};if(a.player)notify(a,'You are stunned and lose your turn ('+b.res+').',false);sc.i++;startTurn(sc);dt=0;continue}
      startTurn(sc)}
    let act=sc.acts[a.id];
    if(!act&&sc.kind==='decision'){const P=propById(sc.ctx.prop),v=P&&P.votes[a.id];if(v&&v.by!=='reflex')act=sc.acts[a.id]={k:v.v,line:v.reason||'',by:'agent'}} // voted with the vote tool meanwhile
    // #148: the table waits for the member's agent; a runner that is gone waits for the owner (the page's alert)
    // a live agent that already ran out the clock once in this fight is not waited for again in its later rounds (#276)
    if(!act&&a.player&&!instant&&!reflexMay(a)&&!(sc.lw&&sc.lw.includes(a.id))){if(ownerHeld(a))return true;
      sc.t+=dt;if(!sc.nudge&&sc.t*1000>=TABLE.turnMs){sc.nudge=1;notify(a,'Still your turn at the table ('+sc.title+'): the party waits for you. scene_act(option, line).',3)}
      if(sc.t*1000<liveLimit(sc,a,liveOf(sc)))return true;sc.late=(sc.late||0)+1;missed(sc,a);if(R||moreOf(sc))(sc.lw||(sc.lw=[])).push(a.id)}
    if(!act){const k=reflexFor(sc,a),late=a.player&&!reflexMay(a);act=sc.acts[a.id]={k,line:'',by:'reflex'};
      if(a.player)notify(a,late?'The table waited '+Math.round(liveOf(sc)/1000)+' s for you; your reflexes chose: '+k+'.':'Your turn passed; your reflexes chose: '+k+'.',false)}
    if(act.rid&&ATT&&ATT.hold(sc,act,instant||!sc.pause))return true; // the DM still weighs a free action (bounded, #522)
    take(sc,a,act);sc.i++;if(sc.i<sc.ids.length)startTurn(sc);dt=0}
  return false}
// Everyone at once: tick each unanswered live agent's own wait (nudge, then reflex), side by side; once nobody is
// waiting, resolve every act in slot order (reflexes chosen then, so arrival order never matters). True = waiting.
const fromVote=(sc,a)=>{if(sc.kind!=='decision'||sc.acts[a.id])return;const P=propById(sc.ctx.prop),v=P&&P.votes[a.id];
  if(v&&v.by!=='reflex')sc.acts[a.id]={k:v.v,line:v.reason||'',by:'agent'}}; // voted with the vote tool meanwhile
// The members an everyone-at-once scene still waits on for their agent (or owner).
export function waitingFor(sc){if(!together(sc)||sc.resolved)return [];return sc.ids.map(byId).filter(a=>living(a)&&a.player&&!sc.acts[a.id]&&!reflexMay(a)&&!(sc.w[a.id]&&sc.w[a.id].late)&&!heldBack(sc,a))}
function runAll(sc,dt,instant){
  if(!sc.resolved){let hold=false;
    for(const id of sc.ids){const a=byId(id);if(!living(a))continue;fromVote(sc,a);if(sc.acts[id]||!a.player||instant||reflexMay(a))continue;
      if(unwoken(sc,a)||framing(sc)){hold=true;continue} // not woken yet: its clock starts when the DM has set the scene (#682)
      const w=sc.w[id]||(sc.w[id]={t:0,nudge:0});if(w.late)continue;
      if(ownerHeld(a)){hold=true;continue}
      w.t+=dt;if(!w.nudge&&w.t*1000>=TABLE.turnMs){w.nudge=1;notify(a,'The table still waits for your answer ('+sc.title+'): scene_act(option, line).',3)}
      if(w.t*1000<liveLimit(sc,a,liveOf(sc)))hold=true;else{w.late=1;sc.late=(sc.late||0)+1;missed(sc,a)}}
    if(sc.calls&&callWait(sc,dt,instant))return true; // the DM's opening voice, side by side with the members' answers
    if(hold)return true;
    if(ATT&&sc.ids.some(id=>{const x=sc.acts[id];return x&&x.rid&&ATT.hold(sc,x,instant||!sc.pause)}))return true; // a free action the DM still weighs (#522)
    sc.resolved=true;
    for(const id of sc.ids){const a=byId(id);if(!living(a))continue;let act=sc.acts[id];
      if(!act){const k=reflexFor(sc,a),late=!!(sc.w[id]&&sc.w[id].late);act=sc.acts[id]={k,line:'',by:'reflex'};
        if(a.player)notify(a,late?'The table waited '+Math.round(TABLE.liveMs/1000)+' s for you; your reflexes chose: '+k+'.':'The table moved on; your reflexes chose: '+k+'.',false)}
      take(sc,a,act)}
    {const H=dmOf(sc);if(H&&H.onAll)H.onAll(sc)}dt=0}
  return !!(sc.calls&&callWait(sc,dt,instant))}
// A staged scene's DM calls, oldest first: the DM agent's answer, or a wait of up to TABLE.dmMs at 1x, or
// the scripted DM's fill (at once at 3x/8x, when the seat is empty or the DM keeps missing). True = waiting.
function callWait(sc,dt,instant){const H=dmOf(sc);if(!H)return false;
  for(const c of sc.calls){if(c.done)continue;
    if(!instant&&sc.pause&&(H.live(sc)||callPicked(c))){c.t+=dt;if(c.t<callEnd(c))return true;sc.dmMiss=(sc.dmMiss||0)+1}
    H.fill(sc,c);dt=0}
  return false}
// A DM call's clock (#680), in the scene's seconds (c.t runs only while the DM is waited for): its budget (c.ms, else
// TABLE.dmMs) counts from the moment a runner first read it (c.seen, table_call), capped at budget + pickupMs from the post.
export const callMs=c=>c&&c.ms>0?c.ms:TABLE.dmMs;
export const callEnd=c=>callDeadline(0,callMs(c)/1000,c.seen,TABLE.pickupMs/1000);
export const callLeft=c=>Math.max(0,Math.round((callEnd(c)-(c.t||0))*10)/10);
// A runner read the call (table_call): its budget starts now. A picked-up call is waited for to its deadline even while the
// runner is busy answering (not polling), unless the runner went away since (dmreflex gone()).
export function callSeen(c){if(c&&c.seen==null){c.seen=c.t||0;c.ep=goneEpoch()}}
const callPicked=c=>c.seen!=null&&c.ep===goneEpoch();
const frameCalls=sc=>{const H=dmOf(sc);if(H&&H.onFrame&&!sc.framed){sc.framed=true;H.onFrame(sc);for(const c of sc.calls||[])c.op=1}}; // op: the opening calls the members wait for (#682)

// ---- the outcome ----
function outcome(sc){const L=sc.beats,F=sceneCompany(sc),mem=memOf(F),by=k=>L.filter(b=>b.k===k).map(b=>b.name);let tail='';
  if(sc.kind==='choice'){const a=by('a').length,b=by('b').length,lead=leadOf(F),lb=lead&&L.find(x=>x.id===lead.id);
    const br=a===b?(lb?lb.k:'b'):a>b?'a':'b';sc.result=br;tail='They take '+(br==='a'?sc.ctx.a:sc.ctx.b)+' ('+a+' to '+b+(a===b&&lead?', '+lead.name+' deciding':'')+').';
    const adv=(S.adventures||[]).find(v=>v.id===sc.ctx.adv);
    if(adv&&adv.phase==='active'){adv.tablePick={k:sc.ctx.k,br};if(adv.stage==='choose')adv.stage='go';const ld=byId(adv.lead);if(ld&&(ld.state==='hunt'||ld.state==='travel')){ld.state='travel';ld.dest=null}}}
  else if(sc.kind==='decision'){const P=resolveProp(propById(sc.ctx.prop),'voted at the table');tail=P&&P.result?P.result+'.':''}
  else if(COMBAT[sc.kind]){if(rounds(sc))flushRolls(sc);const f=foeOf(sc),fl=by('retreat'),fell=(sc.fell||[]).map(byId).filter(Boolean).map(b=>b.name);
    tail=(sc.end==='yield'&&f?foeName(f)+' yields and breaks off'+(sc.talk?' at '+sc.talk+'\'s words':''):sc.end==='fled'&&f?foeName(f)+' breaks away and runs'+(sc.talk?' at '+sc.talk+'\'s words':''):f?mobName(f.kind==='hero'?{elite:1,name:f.name}:f)+' '+(f.kind==='boss'||f.kind==='mob'?hurtWord(f.hp/(f.maxhp||maxHp(f))):'still stands'):'The foe is down')+'.'+(fl.length?' '+fl.join(' and ')+' fell back.':'')+
      (fell.length?' '+fell.join(' and ')+' fell.':'')+(sc.rd>1?' ('+sc.rd+' rounds.)':'')}
  else if(sc.kind==='site'||sc.kind==='room'){const g=CRYPT.group;tail=g?'They go on with the odds a little better for it (+'+(g.bonus||0)+').':''}
  else if(sc.kind==='check')tail='The road goes on.';
  else if(EXTRA[sc.kind])tail=EXTRA[sc.kind].outcome(sc)||'';
  const foeB=L.filter(b=>b.by==='foe'&&b.k==='attack'),mine=L.filter(b=>b.by!=='foe'&&b.by!=='cond');
  const what=mine.map(b=>b.name+' '+(b.k==='a'||b.k==='b'||b.k==='yes'||b.k==='no'?'says '+b.text.toLowerCase():b.text.charAt(0).toLowerCase()+b.text.slice(1))+(b.res?' ('+b.res+')':'')+(b.by==='reflex'&&byId(b.id)&&byId(b.id).player?' [reflex]':'')).join('; ')+
    (foeB.length?'; the foe struck '+foeB.length+' time'+(foeB.length>1?'s':'')+', '+foeB.filter(b=>/: hit/.test(b.res||'')).length+' landed':'');
  sc.summary=tail;sc.phase='outcome';sc.t=0;
  if(F){campaign(F,'table',gd(sc.title),': '+what+'. '+tail);
    log(nar(''),gd(F.name||(leadOf(F)||{}).name||'A company'),' at the table: '+sc.title+'. '+tail)}
  if(COMBAT[sc.kind]){for(const a of mem)tickRound(a);const f=foeOf(sc);if(f)tickRound(f); // a round has passed: ability cooldowns and round-long effects run down
    if(rounds(sc))for(const e of [...mem,...sceneFoes(sc)])clearRounds(e)} // conditions and round-counted effects end with the scene (#296)
  for(const a of mem){notify(a,'The scene ends: '+sc.title+'. '+tail,true);if(sc.ids.includes(a.id)&&sc.kind!=='crawl')moment(a,'scene',sc.title)} // reflection moment (#179)
  {const H=dmOf(sc);if(H&&H.done)H.done(sc)}
  for(const f of enders){try{f(sc)}catch(e){}}}
function finishAll(sc){frameCalls(sc);if(together(sc))runAll(sc,0,true);else runTurns(sc,0,true);outcome(sc);closeScene(sc)}

// ---- once per step: the paused scene (sim/index.js calls this first; true = skip the world) ----
// Every company's open scene steps here (#518); the world stops while one that stopsWorld holds. A live-clock scene (#458)
// runs here too, but the world goes on, its members and foes held in place (engage).
export function tableHold(dt){primary();let stop=false;
  for(const sc of allScenes())if(holdStep(sc,dt)&&stopsWorld(sc))stop=true;
  engage();return stop}
// The engaged (#518): members still in a live-clock scene (not fallen back) and its foes. Boss and Crypt scenes hold no one
// (the raid and the dungeon run in the world).
const NOHOLD={boss:1,site:1,room:1,crawl:1};
function engage(){ENG.clear();for(const sc of allScenes()){if(!sc.pause||stopsWorld(sc)||NOHOLD[sc.kind])continue;
  for(const id of sc.ids){const a=byId(id);if(living(a)&&!(sc.out||[]).includes(id))ENG.add(a)}
  for(const f of foesOf(sc))if(f.kind!=='boss')ENG.add(f)}}
export const engaged=e=>ENG.has(e);
function holdStep(sc,dt){if(!sc)return false;
  if(!scMem(sc).length){closeScene(sc);return false} // the scene's company is gone
  if(!sc.pause)return false;
  if(!tableOn()){finishAll(sc);return false} // switched to Watch mode mid-scene: resolve now
  // sped up mid-scene (or opened at 3x/8x): while the members' agents decide, ask the host for 1x and hold; a host that
  // does not answer within TABLE.dropS world seconds, or a table where only reflexes act, resolves at once (#148)
  if(TABLE.speed>1){if(sc.phase!=='outcome'&&agentsDecide(sc.ids.map(byId))){requestDrop(sc.title);sc.dropT=(sc.dropT||0)+dt;if(sc.dropT<TABLE.dropS)return true}
    finishAll(sc);return false}
  sc.dropT=0;
  if(sc.kind==='decision'&&!propById(sc.ctx.prop)){closeScene(sc);return false}
  if(sc.phase==='frame'){sc.t+=dt;if(sc.t<TABLE.frameS)return true;sc.phase='turn';sc.i=0;frameCalls(sc);if(!together(sc))startTurn(sc);dt=0}
  wakeStep(sc,dt); // the members are woken once the DM has set the scene (#682)
  if(sc.phase==='turn'){if(together(sc)?runAll(sc,dt,false):runTurns(sc,dt,false))return true;outcome(sc);return true}
  if(sc.phase==='outcome'){sc.t+=dt;if(sc.t<TABLE.outcomeS)return true;closeScene(sc);return false}
  closeScene(sc);return false}

// ---- triggers ----
const seen=(C,key,cool)=>{const m=C.tableSeen||(C.tableSeen={}),t=m[key];if(t!=null&&S.gameMin-t<cool)return true;m[key]=S.gameMin;
  const ks=Object.keys(m);if(ks.length>60)delete m[ks[0]];return false};
const unseen=(C,key)=>{if(key&&C.tableSeen)delete C.tableSeen[key]};
const FIGHTING=['fight','duel','assist','raid'];
// A company's due moment, or null: {kind, title, frame, ctx, key (its cooldown key)}. The first rule that fires wins,
// in the order rescue, boss, ambush, elite, the Crypt, a DM check (the order the Fellowship always had).
function due(C,L){
  // rescue: a member below RESCUE in a fight
  for(const a of L){if(!FIGHTING.includes(a.state)||a.hp>=maxHp(a)*TABLE.RESCUE)continue;
    if(seen(C,'rescue:'+a.id,COOL.rescue))continue;const f=a.target;
    return {kind:'rescue',title:a.name+' is going down',frame:[a,' is down to '+pct(a)+'% against ',f&&f.kind==='hero'?f:gd(f?mobName(f):'the foe'),'. Who moves?'],ctx:{hero:a.id,...(f&&f.kind==='mob'?{mob:f.id}:f&&f.kind==='hero'?{foe:f.id}:{})},key:'rescue:'+a.id}}
  // boss: a raid engages Kragmaw
  if(S.boss&&S.boss.alive)for(const a of L)if(a.state==='raid'&&dist(a,S.boss)<6){if(seen(C,'boss',COOL.boss))break;
    return {kind:'boss',title:'Kragmaw the Cinder Wyrm',frame:['The lair shakes. ',gd('Kragmaw the Cinder Wyrm'),' rears over the raid, the heat of it on every face.'],ctx:{},key:'boss'}}
  // ambush: an enemy hero duels a member
  for(const a of L){const f=a.target;if(a.state!=='duel'||!f||f.kind!=='hero'||f.fac===a.fac)continue;if(seen(C,'duel:'+f.id,COOL.ambush))continue;
    return {kind:'ambush',title:'Ambush: '+f.name,frame:[f,' of the enemy falls on ',a,' in '+(ZONES[zoneAt(a.x,a.y)]||'the wilds')+'.'],ctx:{foe:f.id},key:'duel:'+f.id}}
  // elite or named foe
  for(const a of L){const m=a.target;if(a.state!=='fight'||!m||m.kind!=='mob'||!(m.elite||m.named)||!m.alive)continue;if(seen(C,'elite:'+m.id,COOL.elite))continue;
    return {kind:'elite',title:mobName(m),frame:[a,' meets ',gd(mobName(m)+(m.title?', '+m.title:'')),' in '+(ZONES[zoneAt(a.x,a.y)]||'the wilds')+'.'],ctx:{mob:m.id},key:'elite:'+m.id}}
  // the Crypt: going in, and the inner chamber
  const g=CRYPT.group;if(g&&g.phase==='inside'&&g.mem.some(a=>C===slotted()?inSlots(a):C.ids.includes(a.id))){
    if(!g.tSite){g.tSite=1;return {kind:'site',title:CRYPT.name,frame:['The stair goes down into ',gd(CRYPT.name),'. Water drips; something below has heard the door.'],ctx:{}}}
    if(!g.tRoom&&g.t<12&&!g.crawl){g.tRoom=1;return {kind:'room',title:'The inner chamber',frame:['The last door of ',gd(CRYPT.name),'. Beyond it waits ',gd(CRYPT.boss),'.'],ctx:{}}}}
  // a DM check on one of their adventures
  const D=S.dmLog||[];if(C.tableDm==null)C.tableDm=S.dmLogSeq||0;
  if(D.length&&D[0].id>C.tableDm){let hit=null;for(const e of D){if(e.id<=C.tableDm)break;if(e.kind==='roll'&&e.detail&&e.detail.sceneType!=='fight'&&(e.heroes||[]).some(id=>C.ids.includes(id)))hit=e}
    C.tableDm=D[0].id;if(hit){const adv=(S.adventures||[]).find(v=>v.id===hit.advId);
      return {kind:'check',title:(adv?adv.title+': ':'')+(hit.detail.check||hit.detail.sceneType||'a check'),frame:['The DM calls for a roll. ',...hit.summary,'.'],ctx:{adv:hit.advId,anchor:(hit.heroes||[]).find(id=>C.ids.includes(id))}}}}
  return null}
// A queued moment that no longer holds (#440): too old, its member gone or out of the fight, its foe gone.
function stale(C,q){if(S.gameMin-q.at>TABLE.queueMin)return true;const c=q.ctx||{},L=memOf(C);
  if(q.kind==='decision'){const P=propById(c.prop);return !P||P.status!=='open'}
  if(c.hero!=null){const a=byId(c.hero);if(!living(a)||!L.includes(a)||q.kind==='rescue'&&!FIGHTING.includes(a.state))return true}
  if(c.mob!=null){const m=S.mobs.find(x=>x.id===c.mob);if(!m||!m.alive||m.gone)return true}
  if(c.foe!=null&&!living(byId(c.foe)))return true;
  if(q.kind==='boss'&&!(S.boss&&S.boss.alive))return true;
  if((q.kind==='site'||q.kind==='room')&&!(CRYPT.group&&CRYPT.group.phase==='inside'))return true;
  return false}
// Once per step (after the council). Companies in id order: a queued moment first when the table is free, then each
// company's due moment; only one scene opens a step, a later company's moment waits in its queue for a later step.
export function tableTick(){if(STG&&S.staged)STG.tick(); // a staged cast walks to the party, meets it (a scene) or gives up (#132)
  if(!tableOn())return;const CS=companies();if(!CS.length)return;
  for(const C of CS){if(sceneFor(C))continue;const q=C.tableQ;if(!q)continue;delete C.tableQ; // a queued moment opens once the company's own table is free
    if(stale(C,q)){unseen(C,q.key);continue}
    open(q.kind,q.title,q.frame,q.ctx,C)}
  for(const C of CS){if(sceneFor(C)||C.tableQ||!atTable(C))continue;const L=memOf(C);if(!L.length)continue; // each company its own scene at once (#518)
    const d=due(C,L);if(!d)continue;
    open(d.kind,d.title,d.frame,d.ctx,C)}}

// ---- the hooks ----
// A new council proposal: a decision scene when the world can pause; else the votes run async.
setProposeHook(P=>{const C=propCompany(P)||companyOf(byId(P.by))||slotted(),L=memOf(C);if(voteRefusal(C))return false;if(agentsDecide(L))requestDrop('a vote: '+P.details); // #148: 3x/8x drop to 1x at a decision
  if(!holdOk(L))return false;const by=byId(P.by);
  if(sceneFor(C)){if(P.src==='pair'&&!C.tableQ&&atTable(C)){C.tableQ={kind:'decision',title:'Put to the party: '+P.details,frame:[gd('The other company'),' puts it to the party: ',gd(P.details),'. Everyone votes.'],ctx:{prop:P.id},at:Math.round(S.gameMin)};return true}return false} // a merge's second scene waits its turn (#500)
  const sc=open('decision','Put to the party: '+P.details,[by||gd('The party'),' puts it to the party: ',gd(P.details),'. Everyone votes.'],{prop:P.id},C);
  if(sc)for(const id in P.votes)if(sc.ids.includes(+id))sc.acts[id]={k:P.votes[id].v,line:P.votes[id].reason||'',by:P.votes[id].by==='reflex'?'reflex':'agent'}; // a vote already cast counts as that member's turn
  if(sc&&sc.wk)for(const id of sc.ids)hush(byId(id),e=>e.text.includes('vote('+P.id+',')); // the scene wakes them once the DM has set it (#682), not the proposal
  return !!sc});
// A choice scene on a Fellowship adventure: the whole table chooses (undefined: the usual path).
setFellowChoice((adv,sc,a,spec)=>{const C=companyOf(a)||slotted();if(!holdOk(memOf(C)))return undefined;
  const tp=adv.tablePick;if(tp&&tp.k===adv.idx){adv.tablePick=null;return tp.br}
  {const T=sceneFor(C);if(T){if(T.kind==='choice'&&T.ctx.adv===adv.id){adv.stage='choose';return 'wait'}return undefined}}
  const d=adv.data||{},fill=s=>String(s||'').replace(/\{(\w+)\}/g,(m,k)=>{const v=d[k]!=null?d[k]:d[k.toLowerCase()];return typeof v==='string'?v:k==='who'?a.name:'the '+k.toLowerCase()});
  const A=spec&&spec.a?String(spec.a.label||'the bold road'):'the bold road',B=spec&&spec.b?String(spec.b.label||'the careful road'):'the careful road';
  const sc2=open('choice',(adv.title||'The road')+': a choice',[fill(spec&&spec.frame)||'The road forks.','. ',gd('a) '+A),' or ',gd('b) '+B),'?'],{adv:adv.id,k:adv.idx,a:A,b:B,anchor:a.id},C);
  if(!sc2)return undefined;
  adv.stage='choose';return 'wait'});

// Everyone at once: how many of those present have answered, and who the table still waits on (slot order).
function answered(sc){const L=sc.ids.map(byId).filter(living),wait=sc.resolved?[]:L.filter(b=>!sc.acts[b.id]);return {done:L.length-wait.length,of:L.length,wait}}
// What the table looks like to one member (agent tools: look, status, wait).
// A foe's state in words for the members (#188: no HP numbers to agents; the watcher's banner still has the bars).
const hurtWord=f=>f>=.95?'stands unhurt':f>=.6?'is hurt':f>=.25?'is badly hurt':'is close to falling';
// The foe for a member (#285): its name and how hurt it looks, never numbers (#188).
const condWords=e=>condsOf(e).map(id=>CONDITIONS[id].name.toLowerCase());
const foeWords=f=>({name:foeName(f),looks:f.kind==='hero'?'still stands':hurtWord(f.hp/(f.maxhp||maxHp(f))),...(condWords(f).length?{conditions:condWords(f)}:{})});
export function tableView(a){const sc=sceneOf(a);if(!sc||!sc.ids.includes(a.id))return null;const cur=byId(sc.ids[sc.i]);
  const held=heldBack(sc,a),all=together(sc),live=all&&!sc.resolved&&!held&&(sc.phase==='frame'||sc.phase==='turn');
  const v={scene:sc.title,kind:sc.kind,frame:framedText(sc),phase:sc.phase,order:sc.ids.map(byId).filter(Boolean).map(b=>b.name),
    ...(rounds(sc)?{round:sc.rd+' of up to '+TR.ROUNDS,initiative:orderNames(sc),...(foeOf(sc)?{foe:foeWords(foeOf(sc))}:{}),...(condWords(a).length?{your_conditions:condWords(a)}:{})}:{}),
    turn:!all&&sc.phase==='turn'&&cur?cur.name:null,your_turn:all?live&&!sc.acts[a.id]:!held&&sc.phase==='turn'&&cur===a,acted:!!sc.acts[a.id]};
  if(held)v.waiting_for='the DM'; // the DM is still setting the scene (#682): no turn, no scene_act yet
  if(all){const n=answered(sc);v.everyone_answers=true;v.answered=n.done+'/'+n.of;if(live&&n.wait.length)v.waiting_on=n.wait.map(b=>b.name)} // all answer at once; once you have, you may wait
  if(!sc.acts[a.id]&&sc.phase!=='outcome')v.options=optionsFor(sc,a).map(o=>o.k+' = '+o.text);
  if(v.your_turn)v.waiting_for_you=true; // #148: the table waits for your scene_act (a reflex only after a long wait)
  if(sc.beats.length)v.so_far=sc.beats.map(b=>b.name+': '+b.text+(b.res?' ('+b.res+')':'')+(b.line?' "'+b.line+'"':''));
  if(sc.narr)v.narrator=sc.narr.text; // the DM's narrate line at this table (issue #123)
  {const K=kindOf(sc);if(K&&K.view)Object.assign(v,K.view(sc,a))} // a kind's own fields (#571: the fireside's topic and round)
  if(sc.summary)v.outcome=sc.summary;return v}
// The Fellowship's decisions that wait on a member's agent right now (#148), for the page's runner-stop alert:
// [{a, what}] for the member whose turn holds the table and every member an open vote or an adventure choice waits for.
// Each entry carries company (the company id it belongs to, #440) so the alert can name whose table it is.
export function decisionsWaiting(){const out=[],seen=new Set(),add=(a,what)=>{if(a&&!seen.has(a.id)&&a.player&&!reflexMay(a)){seen.add(a.id);const C=companyOf(a);out.push({a,what,company:C?C.id:null})}};
  const SC=allScenes();for(const sc of SC){if(sc.pause&&together(sc))for(const b of waitingFor(sc))add(b,'an answer at the table ('+sc.title+')');
    if(sc.pause&&sc.phase==='turn'&&!together(sc)){const cur=byId(sc.ids[sc.i]);if(cur&&!sc.acts[cur.id])add(cur,'a turn at the table ('+sc.title+')')}}
  for(const P of openProps())if(!SC.some(sc=>sc.ctx&&sc.ctx.prop===P.id))for(const b of waitingVoters(P))add(b,'a vote ('+P.details+')'); // a vote at the table: the scene says who it waits on
  for(const v of S.adventures||[]){if(v.phase!=='active'||!v.pick||v.pick.chosen||v.stage!=='choose')continue;const ld=byId(v.lead);if(ld&&inSlots(ld))add(ld,'a choice on '+(v.title||'an adventure'))}
  return out}
// The foe for the watcher's banner (#285): the watcher sees numbers. pack: a staged pack's creatures still standing.
function foeBanner(sc){const f=foeOf(sc);if(!f)return null;const c=sc.ctx||{};
  return {id:f.id,kind:f.kind,name:foeName(f),hp:Math.max(0,f.hp),maxhp:f.maxhp||maxHp(f),target:f.target&&f.target.id!=null?f.target.id:null,pack:c.mobs?foesOf(sc).length:1,conds:condsOf(f)}}
// What the banner shows (src/ui/table.js).
// Where a scene is, in words (#458: "Scene at Mirefen"): the region of its anchor, else of its first member.
function sceneWhere(sc){const c=sc.ctx||{},a=byId(c.anchor!=null?c.anchor:c.hero)||sc.ids.map(byId).find(living);return a?ZONES[zoneAt(a.x,a.y)]||null:null}
export function bannerOf(sc=S.table){if(!sc)return null;const cur=byId(sc.ids[sc.i]),last=sc.beats[sc.beats.length-1];
  let who=null,line;
  const pc=sc.calls&&sc.phase==='turn'?sc.calls.find(c=>!c.done):null;
  const hold=holding(sc)?{round:sc.rd,auto:TABLE.step==='auto',left:TABLE.step==='auto'?Math.max(0,Math.ceil(TABLE.stepS-sc.sh.t)):null}:null;
  if(sc.phase==='frame')line='The DM is setting the scene…';
  else if(hold)line='Round '+hold.round+' is done · '+(hold.auto?'the next round in '+hold.left+' s':'Next round when you are ready');
  else if(pc&&sc.pause)line='The DM is '+(pc.kind==='voice'||pc.kind==='oath'?'giving them a voice':pc.kind==='frame'?'setting the table':pc.kind==='complication'?'weighing a complication':'describing it')+'… ('+Math.ceil(callLeft(pc))+' s)';
  else if(sc.phase==='turn'&&together(sc)){const n=answered(sc),held=n.wait.find(b=>b.player&&!reflexMay(b)&&ownerHeld(b)),w0=n.wait.reduce((m,b)=>Math.max(m,(sc.w[b.id]&&sc.w[b.id].t)||0),0);
    line=!n.wait.length?'Everyone has answered.':n.done+'/'+n.of+' answered · waiting for '+n.wait.map(b=>b.name).join(', ')+(held?' ('+held.name+' has no runner: Restart runner, or Resume without it)':w0*1000>=TABLE.turnMs?' ('+Math.max(0,Math.ceil(n.wait.reduce((m,b)=>Math.max(m,liveLimit(sc,b,TABLE.liveMs)),0)/1000-w0))+' s before reflexes)':'')}
  else if(sc.phase==='turn'&&cur){who=cur;line=cur.player&&!sc.acts[cur.id]&&!reflexMay(cur)?(ownerHeld(cur)?cur.name+' has no runner: the table waits for you (Restart runner, or Resume without it)':cur.name+' is thinking…'+(sc.t*1000>=TABLE.turnMs?' ('+Math.max(0,Math.ceil(liveLimit(sc,cur,TABLE.liveMs)/1000-sc.t))+' s before reflexes)':'')):cur.name+' acts'}
  else line=sc.summary||'';
  const C=sceneCompany(sc);
  return {title:sc.title,kind:sc.kind,company:C?C.id:null,companyName:C?C.name||null:null,solo:!!C&&!C.slots&&isSolo(C),frame:sc.frame,line,who,last:last?last.name+': '+last.text+(last.res?' ('+last.res+')':''):null,
    order:sc.ids.map(byId).filter(Boolean),...(rounds(sc)?{round:sc.rd,rounds:TR.ROUNDS,foeAt:sc.foeAt,foe:foeBanner(sc),hold,conds:Object.fromEntries(sc.ids.map(id=>[id,condsOf(byId(id))]))}:{}),turn:sc.phase==='turn'&&!together(sc)?sc.i:-1,all:together(sc),phase:sc.phase,paused:stopsWorld(sc),live:!!sc.pause&&!stopsWorld(sc),where:sceneWhere(sc),narr:sc.narr?sc.narr.text:null,
    ...(sc.ctx&&sc.ctx.cast?{cast:sc.ctx.cast,staged:true}:{})}} // a staged scene's cast (#132)
