// Agent player (issue #75): an AI agent plays one hero end to end through tools (the list is
// data/player-tools.js). This module is the game side and is DOM-free:
//   playerAct(id, tool, args)  one tool call for hero `id`; returns a plain result object
//   playerUpd(a, dt)           the reduced state machine for an a.player hero (sim/index.js
//                              calls it before updAgent; false hands the step to updAgent)
//   markPlayer(a, on)          make a hero agent-played or give it back to the scripted rules
//   waitOver / finishWait      the `wait` tool: the host polls these (sim/player-host.js)
//
// Rules an agent hero keeps (the same world, the same dice):
//   - Hardcore: one life. A dead hero's tools all answer "dead"; nothing respawns it.
//   - Sight: look reports what is within SIGHT tiles (scaled by weather), or the hero's town
//     when inside it. Other heroes' HP is never reported, only "wounded" when visibly so;
//     party members' HP only within sight.
//   - Hearing, not telepathy (issue #123): what others say reaches the hero only in the game, as
//     lines it hears (say within earshot, the party channel, townsfolk, the DM's narrate) in its
//     chat buffer; never the DM's notes or log, nor another hero's journal, memories, mind or prompt.
//   - Commands queue on a.pq and run through the ordinary movement and combat code
//     (moveTo, strike, findMob, priestHeal from heroes.js). Reflexes keep the hero alive
//     when the agent is slow or silent: defend when attacked (mobs pull the hero into a
//     fight as they do anyone), flee below FLEE HP, go home when the bag is full and idle.
//   - Crypt groups and raid musters do not draft an agent hero (it goes where it is told);
//     scripted heroes pulling it into their party are turned down unless it asked to join.
//   - Adventures are only taken through take_adventure (never auto-picked at the gate);
//     while one runs, the DM (sim/dm.js) leads the hero between scenes and asks for scene
//     choices through sim/player-choice.js, with a timeout so the world never waits.
//   - World-changing tools are rate limited (RATE per game hour).
// Everything on the hero is plain data and saves with the world: a.player, a.pq, a.journal, a.tiers (#153), a.memories (#155),
// a.playLog (recent tool calls), a.playEv (events), a.playNarr (the runner's narration).
import {W,H} from '../world/tiles.js';
import {outpostsView} from './outposts.js';
import {OUTPOSTS,CITY,ZONES,REGIONS,LANDMARKS,CRYPT,ZPTS,zoneAt,zoneFor,zonePoint,dist} from '../world/map.js';
import {homeOf,raceOf} from '../data/races.js';
import {FAC} from '../data/factions.js';
import {CLS} from '../data/classes.js';
import {MOBS} from '../data/mobs.js';
import {TRAITS,tm} from '../data/traits.js';
import {listings,mine,listFor,buyListing,cancelListing,gearRef,goodRef,gearUpgrade,TRADE} from './market.js'; // hero-to-hero trades (#14)
import {GOODS,price,SLOTS,USES,INV,useLines,EPIC_ITEMS,QUEST_ITEMS} from '../data/items.js';
import * as D from '../data/adventures.js';
import {PLAYER_TOOLS} from '../data/player-tools.js';
import {S,clockStr,dayNo} from './state.js';
import {soloFor,companyOf,leaveCompany,inSlots,partySlotted,slotKeyOf,slotted} from './company.js'; // every agent hero rides in exactly one company (#438)
import {pop} from './effects.js';
import {maxHp,xpNeed,atkOf,moveTo,strike,priestHeal,healOne,findMob,turnIn,huntZone} from './heroes.js';
import {partyMates,leaderOf,leaveParty} from './party.js';
import {speak,say,agentLine,sayHearers} from './chat.js';
import {whisperTo,emoteAct} from './aside.js'; // whisper and emote (#627)
import {earshot} from './earshot.js'; // who hears you now (#395)
import {npcSay,ensureNpcs} from './npcs.js';
import {talkTo,addressed,findPerson,traderFor,npcBuy,npcSell,stockOf,tradePrice,metIds} from './talk.js'; // NPC conversations (#170)
import {equip,makeItem,SHOP_COST,SELL_VALUE,slotLevel,weakestSlot,itemStats,gearScore,refreshEpics,itemArmor,itemDamage} from './gear.js';
import {weatherName,sightFor,isStorm} from './weather.js';
import {record,asSrc} from './history.js';
import {fleeCheck} from './narrator.js';
import {nearHeroes,nearMobs} from './spatial.js';
import {dmDepart,advLine,K as DMK,holdAdventure,resumeAdventure,beginJob,abandonAdventure,bountiesAt,bountyFor,takeBounty} from './dm.js';
import {questLog,questsView,parseJob,heldOf,takenOf,heldCount,setFocus,killAbandoned,takenGone,jobId,QL} from './questlog.js'; // several quests per hero
import {CHOICE_MIN} from './player-choice.js';
import {fellowCard,selfView,become} from './persona.js'; // Fellowship (#68); self and become (#409)
import {ev} from './notify.js';
import {campView,campBlock,leaderBreak,leaderRest,onCamp} from './camp.js';
import {heroMemory} from './notebook.js'; // agent memories (#155)
import {tiersOf,spillEntry,ownMark,overview as journalOverview,search as journalSearch} from './tiers.js'; // tiered memory (#153)
import {moment,talked,REFLECT} from './reflect.js'; // reflection moments (#179)
// making camp is a reflection moment for each agent-played member at the fire (camp.js event 'make', #178/#179)
onCamp((kind,g,d)=>{if(kind!=='make'||!g)return;for(const id of g.ids||[])moment(S.agents.find(x=>x.id===id),'camp',d&&d.zone)});
import {reflexMay,agentLive,hasLinks} from './runlink.js';
import {notEnglish} from './lang.js';
const ENGLISH='Not said: speak in English. Everyone in Eldmoor speaks English; say it again in English.'; // #126
import {spokenLine,partySay,partyRead,propose,castVote,propById,openProps,noProposal,leaderFor,splitOff,followLead,makeMeeting,hearNote} from './council.js';
import {SIGHT,writeSighting,sightingLines,postNotice,noticesAt} from './sightings.js';
import {outOfRange,sendCourier,notTold,NOT_TOLD,nameList,REACH} from './reach.js';
import {invite as offerInvite,accept as offerAccept,decline as offerDecline,askToJoin,leaveForGood,companionsView} from './offers.js'; // invite, accept, decline; join_party toward agent heroes (#442)
import {sceneAct,tableView} from './table.js';
import {sceneOf} from './scenes.js'; // the hero's own company's scene (#518)
import {waitsNote,waitedS,FRAMING} from './scenewait.js'; // a scene that waits on you, said in every tool result; how long it waited (#515)
import {followRefusal,startFollow,followStep,followLine,followersOf,standingFollow} from './follow.js'; // follow without joining (#445)
import {passOnTo,gateWord} from './rumours.js'; // what the town is saying (seed_rumour, #637)
import {titleOf,styled} from './epithet.js'; // a name given for a deed (bestow, #638)
import {lineRefusal,noteSaid,publicAnswer} from './talk.js'; // no repeated lines or second introductions from an agent (owner's screenshot)
import {MOVES} from '../data/moves.js';
import {searchAct,examineView,SR} from './search.js'; // search and examine marked places, signs and landmarks (#525)
import {enterSiteTool} from './sites.js'; // DM-made dungeon sites (#69)
import {noticeHeroes,sighted} from './sighthero.js'; // heroes coming into sight (#570)
import {INTENT,setIntent,endIntent,attachOrder,intentWatch,aimHeld,intentView,waitish} from './intent.js'; // the hero's stated aim (#535)
import {pay as payGold} from './pay.js'; // pay (#628)
import {markPlace,unmarkPlace,markAt,markHow,hearMarks} from './marks.js'; // mark (#632)
import {mobView,foeName,threatText,perceived,engage,nearDeath,visit,hear,knowsPlace,learnPlace,placesView,placeWarn,placeMemory,roadsLine,loreView,loreOf,knownMark,learnJob,preyKey,pickPrey,feared,keyOf,sight,npcWarning,captainWarning,jobRumour,LORE} from './lore.js'; // learn the world (#188)
import {movesOf,useMove,abilityView,abilityLine} from './moves.js'; // class abilities (#81)
import {actFlee,fights,actionLog} from './actlog.js';
import {specOf,specChoices,specBlock,chooseSpec} from './spec.js'; // specialisations (#82)
import {SPEC_LVL} from '../data/classes.js';
import {GATHER,canGather,gatherCmd,pickNode,nodesView,recipesView,learnProfession,unlearnProfession,profKey} from './gather.js'; // professions and gathering (#257)
import {craftTool,smithTool} from './craft.js'; // crafting (#258)
import {MATERIALS} from '../data/items.js';
import {invOf,used,capOf,isGear,kindOf,load,addGear,addUse,sellLoot,sellEntry,equipSpare,useItem,giveItem,dropEntry,fightAid,bestUse} from './inv.js'; // the pack (#124)
import {VOW,swear as swearVow,renounce as renounceVow,canSwear,vowLeft,vowText,placeNamed,norm as vnorm} from './vows.js'; // sworn vows (#526)
import {attempt as attemptRuled} from './ruling.js'; // free actions ruled by the DM (#522)
import {holdStart,holdAnswered} from './gambithold.js'; // a gambit hold stops the world until the agent acts (#630)
import {worldHeld,holdLine} from './prep.js'; // the world held before play (#559)
import {defineGambits,idlePick,fightRules,reflexPick,HOLD,gambitRec,ruleText,GAMBIT,gambitsView,setGambit,moveGambit,toggleGambit,dropGambit,resetGambits,onSafetyChange} from './gambits.js'; // the hero's own rules (#617)
import {histNote} from './persona.js';
onSafetyChange((a,before,after,why)=>histNote(a,'gambits',before,after,why)); // a safety rule changed: the persona history says so (#617)

// ---- knobs ----
export const PK={
  SIGHT:12,          // tiles a hero can see in clear weather
  TALK:4,            // tiles to a townsperson or hero to talk (keep equal to EAR.TALK in sim/earshot.js, #395)
  JOIN:6,            // tiles to a hero to join their party
  FLEE:.15,          // reflex: break off a fight below this share of max HP (no command says otherwise)
  RETREAT:.45,       // hunt command ends below this share of max HP (scaled by the retreat trait)
  WARY_FLEE:.22,     // autopilot (#487): break off a fight below this share (scaled by the flee trait), as scripted heroes do
  WARY_OUT:.5,       // autopilot: break off sooner, below this share, from a creature it would not have picked (one that jumped it)
  WARY_UP:2,        // autopilot hunts creatures at most this many levels above the hero (scripted: 1, but they hunt in parties)
  REST_CLEAR:6,      // autopilot rests out in the field only with no creature this close; else it walks home to heal
  ROAM:3,            // autopilot: legs walked on a ground with no prey it can take before it ranges across the whole ground
  READY:.9,         // autopilot heads out of town only above this share of max HP
  BAG:8,             // reflex: idle in the field with this many bag entries -> go home
  REST_REGEN:.06,    // share of max HP per real second while resting (the DM's camp rate)
  RATE:12,           // world-changing tool calls per game hour
  HEAR_WAKE:15,      // game minutes: an agent's line heard starts the listener's turn at most this often (#126)
  IDLE:120,          // game minutes without a command or an action before autopilot carries on for the agent (#126)
  HOLD:180,          // game minutes at most that autopilot holds (starts nothing new) while the agent's turn is open (#240)
  STALE:15,          // game minutes after a look before tool results say how old the agent's view is (#240)
  WAIT:[10,240],     // game minutes a wait may span
  WAIT_REAL_MS:45000,// a wait never holds the agent longer than this in real time (paused world, hidden tab)
  JOURNAL:100,JOURNAL_LEN:600,LOG:40,EV:40,EV_OUT:15,NARR:20,SAY_LEN:200, // EV_OUT: events handed back per tool result
};

// ---- helpers ----
const hero=id=>S.agents.find(x=>x.id===id)||null;
const pct=(h,m)=>Math.max(0,Math.round(h/m*100));
const r1=v=>Math.round(v*10)/10;
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const plain=parts=>(parts||[]).map(p=>typeof p==='string'?p:p&&p.kind==='hero'?p.name:p&&p.t||'').join('');
const day=()=>'Day '+(Math.floor(S.gameMin/1440)+1)+' '+clockStr();
const dayPart=()=>{const h=(S.gameMin/60)%24;return h<5||h>=21?'night':h<8?'dawn':h<18?'day':'dusk'};
const advOf=a=>a.adv&&S.adventures?S.adventures.find(v=>v.id===a.adv&&v.phase==='active')||null:null;
const mobName=m=>m.elite||m.named?m.name+(m.title?', '+m.title:''):MOBS[m.type]?MOBS[m.type].name:'monster';
const sightOf=a=>PK.SIGHT*sightFor(a,zoneAt(a.x,a.y));
const inRect=(c,p,pad=0)=>p.x>=c.x0-pad&&p.x<=c.x1+1+pad&&p.y>=c.y0-pad&&p.y<=c.y1+1+pad;
const cityAt=p=>CITY.find(c=>inRect(c,p,.5))||null;
const inTown=a=>a.state==='town';
const zoneName=p=>{const l=p.legs&&p.legs[p.legs.length-1];return l&&ZONES[zoneAt(l.x,l.y)]||''};
// the innkeeper repeats who has passed the gate (#446)
function innRumour(a,r){const L=sightingLines(a,homeOf(a).name);if(!L.length)return;for(const x of L)if(x.bound)learnPlace(a,x.bound,'told');r.rumours=L.map(x=>x.text)}
const cmdOf=a=>a.pq&&a.pq.length?a.pq[0]:null;
const legal=['town','hunt','travel','return','fight','follow','regroup','duel','assist'];
const FOLLOWS=['town','hunt','travel','return','follow'];

// Events: what happened to the hero, handed to the agent with the next tool result.
function takeEvents(a){const seen=a.playEvSeen||0,out=(a.playEv||[]).filter(e=>e.n>seen).map(e=>e.t+' '+e.text);a.playEvSeen=a.playEvN||0;
  return out.length>PK.EV_OUT?['('+(out.length-PK.EV_OUT)+' earlier events not shown)',...out.slice(-PK.EV_OUT)]:out}
function done(a,text,urgent=true){if(a.pq&&a.pq.length)a.pq.shift();if(text)ev(a,text,urgent)}
const key=e=>e?e.t+'|'+e.text:'';
// Entries of list that came after the one whose key is k (all of them when k is not found).
function since(list,k){if(!list||!list.length)return [];if(!k)return list.slice(-3);for(let i=list.length-1;i>=0;i--)if(key(list[i])===k)return list.slice(i+1);return list.slice(-3)}

// Autopilot's next command (issue #126): what the hero's own reflexes and last order call for. In the field:
// rest when hurt, else hunt again when the last order was a hunt; in town it heals and waits; a Fellowship
// member follows its leader (the 'follow' state); a full bag already sends it home (field()).
// #466: in town it carries on too (townPilot below); out in the field with no hunt order it hunts a ground that fits, or
// heads home from one that does not. Returns one command or a list of them (a walk, then a hunt).
// #487: with the scripted heroes' caution. A hurt hero walks home to heal (it rests out here only when no creature is
// close), a storm sends it home, and every hunt autopilot starts is wary (field(), fight()): it keeps to one ground,
// takes only prey it sizes up as an even match or less, and breaks off at PK.WARY_FLEE.
function autopilot(a){const field=(a.state==='hunt'||a.state==='travel')&&!cityAt(a);
  if(!field&&a.state!=='town')return null;
  return idlePick(a,{town:a.state==='town',field}); // the hero's gambits (#617): its class preset is the policy above, rule for rule
}
// A living creature within r tiles (resting out in the open is only safe without one).
const creatureNear=(a,r)=>nearMobs(a.x,a.y,r).some(m=>m.alive&&!m.gone&&!m.hidden&&dist(a,m)<=r);
// Wary prey (#487): the nearest creature on the hunting ground that this hero sizes up as an even match or less (no named
// foe, none it learned to fear, none more than PK.WARY_UP levels above it, near the scripted findMob rule), or one already on
// it. Nothing of this reaches the agent: it is the hero's own judgement while it carries on alone.
function waryPrey(a,cmd){const R=9*sightFor(a,zoneAt(a.x,a.y)),gz=cmd.ground;let best=null,bs=1e9;
  for(const m of nearMobs(a.x,a.y,R)){if(!m.alive||m.gone||m.hidden||(m.target&&m.target!==a))continue;const d=dist(a,m);if(d>R)continue;
    if(m.target!==a){if(m.elite||m.named||m.lvl>a.lvl+PK.WARY_UP||feared(a,m)||m.spared>S.gameMin)continue;if(gz!=null&&MOBS[m.type]&&MOBS[m.type].z!==gz)continue}
    const s=d-(cmd.prey&&keyOf(m)===cmd.prey?4:0)-(a.quest&&a.quest.type===m.type?4:0)-(m.target===a?6:0);if(s<bs){bs=s;best=m}}
  if(best)sight(a,best);return best}

// ---- autopilot in town (issue #466) ----
// A local model's turn can take hours of game time, so a hero (solo or in a company of any size) left in town with no order
// used to stand at the gate for days. Now, once idle there, it does what its own habits call for, one step at a time and
// never a decision that belongs to its agent (no vote, proposal, job, Crypt or raid): rest at the inn when hurt, sell its
// loot, buy a potion or two, then walk out to its last hunting ground (or a known region that fits its level) and hunt.
// A follower waits for its leader (it follows them out, town()) and only goes hunting near town on its own after TP.WAIT
// more game minutes with the leader still in town. Agent-played heroes only: the scripted world never comes here.
const TP={HUNT:5,POTIONS:2,LOOT:4,WAIT:240,FIT_UP:1,DANGER:5,DARE_MIN:720};
const bandOf=z=>REGIONS[z]&&REGIONS[z].band||null;
// A region this hero can hunt: its lowest level within TP.FIT_UP of the hero's.
const fits=(a,z)=>{const b=bandOf(z);return !!(b&&b[0]<=a.lvl+TP.FIT_UP)};
// Where autopilot hunts: the last ground the hero hunted on (a.playGround) if it still fits, else the known region that fits
// best (its band holds the level, then the nearest), else the region the scripted ladder would pick if the hero knows it.
function groundFor(a){const g=a.playGround;if(g!=null&&ZONES[g]&&fits(a,g)&&knowsPlace(a,ZONES[g]))return g;
  const L=huntGrounds(a).map(n=>ZONES.indexOf(n)).filter(z=>z>=0&&fits(a,z));
  const holds=L.find(z=>{const b=bandOf(z);return a.lvl>=b[0]&&(b[1]==null||a.lvl<=b[1])});if(holds!=null)return holds;if(L.length)return L[0];
  const h=huntZone(a);return h!=null&&ZONES[h]&&knowsPlace(a,ZONES[h])?h:null}
const potionsHeld=a=>invOf(a).list.reduce((n,e)=>n+(!isGear(e)&&USES[e.id]&&USES[e.id].kind==='potion'?e.n||1:0),0);
const bestPotion=a=>Object.keys(USES).filter(k=>{const U=USES[k];return U.kind==='potion'&&!U.craft&&U.lvl<=a.lvl}).sort((x,y)=>USES[y].lvl-USES[x].lvl)[0]||null;
// ---- the stated aim (issue #535) ----
// What autopilot carries on for an aim (sim/intent.js), where it maps to one: walk on to its place, hunt its ground (one that
// fits, wary as ever), wait where it is. A follow aim is the standing follow order (a.playOrder, #445). Safety comes first:
// autopilot only gets here once hurt, storm and full-pack checks passed, and an aim that is done maps to nothing.
function intentPilot(a){if(!aimHeld(a))return null;const I=a.intent,o=I.order;if(!o)return null;const why=' (your aim: '+clean(I.goal,60)+')';
  const sg=o.kind==='move'?sighted(a):null;if(sg)return {kind:'rest',until:S.gameMin+30,auto:'holding where you are: you saw '+sg.name+' (your aim: '+clean(I.goal,60)+')',label:'rest'}; // stopped on sight (#570): the agent decides next
  if(o.kind==='wait')return {kind:'rest',until:S.gameMin+60,auto:'waiting where you are'+why,label:'rest'};
  if(o.kind==='move'){if(o.to&&dist(a,o.to)<=INTENT.NEAR)return null;let p=o.target?plan(a,o.target):null;
    if((!p||p.error)&&o.to&&o.last!=='town')p=toFieldOf(a,o.to,o.label);if(!p||p.error)return null;
    return {kind:'move',legs:p.legs,last:p.last,label:p.label,auto:'carrying on to '+p.label+why}}
  if(o.kind==='hunt'){const z=o.ground!=null?ZONES.indexOf(o.ground):zoneAt(a.x,a.y);if(z<0||!fits(a,z))return null;
    const h={kind:'hunt',n:o.n||TP.HUNT,flee:o.flee,prey:o.prey,wary:true,ground:z,auto:'hunting in '+ZONES[z]+why,label:'hunt'};
    if(zoneAt(a.x,a.y)===z&&!cityAt(a)&&!inTown(a)){h.k0=a.kills;return h}
    const p=planOne(a,ZONES[z].toLowerCase());if(!p||p.error)return null;
    return [{kind:'move',legs:p.legs,last:'hunt',label:p.label,auto:'heading to '+ZONES[z]+why},h]}
  return null}
// ---- gambits (issue #617): what each rule does for this hero ----
// The conditions that need this module's knobs and every action. Each action is a piece of the policy autopilot and the
// reflexes followed before #617, unchanged, so the class preset (data/gambits.js) plays as before; an action that cannot
// run here returns null and the next rule is tried. ctx: {town, field} between turns, {m, cmd, list} in a fight.
const homeCmd=(a,why)=>{const c=homeOf(a);return {kind:'move',legs:[{x:c.gate.x,y:c.gate.y,st:'return'}],last:'town',label:c.name,auto:'heading home to '+c.name+' ('+why+')'}};
function homeWhy(a,r){const z=zoneAt(a.x,a.y),w=r.and&&r.when==='always'?r.and:r.when;
  if(w==='self_hp_below')return 'too hurt to stay out';if(w==='storm')return 'a storm over '+ZONES[z];if(w==='storm_or_fog')return 'storm or fog over '+ZONES[z];
  if(w==='always')return 'this land is beyond you';return 'your rule: '+ruleText(r)}
const gLeader=a=>a.party&&a.party.leader!==a&&a.party.leader.state!=='dead'?a.party.leader:null;
const gZone=(a,v)=>{if(v==null||v==='')return null;const z=ZONES.findIndex(n=>n&&n.toLowerCase()===String(v).toLowerCase().trim());return z>=0&&knowsPlace(a,ZONES[z])&&fits(a,z)?z:-1};
const gAlly=(a,who,ctx)=>{if(ctx.hit&&ctx.hit!==true)return ctx.hit;const w=String(who||'').toLowerCase();if(w==='self')return a;if(w==='leader')return leaderFor(a)||gLeader(a);
  const L=(ctx.list||(a.party?a.party.mem:[a])).filter(b=>b.state!=='dead'&&b.state!=='ghost'&&dist(a,b)<=sightOf(a));
  if(w&&w!=='weakest_ally')return L.find(b=>b.name.toLowerCase().split(' ')[0]===w.split(' ')[0])||null;
  let low=null;for(const b of L)if(!low||b.hp/maxHp(b)<low.hp/maxHp(low))low=b;return low};
const gOnce=(a,r,k,gap)=>{const g=gambitRec(a,true);const t=g.once[k+r.id];if(t!=null&&S.gameMin-t<gap)return false;g.once[k+r.id]=S.gameMin;return true};
defineGambits({
  conds:{
    pack_full:(a,w)=>load(a)>=(w.n!=null&&Number.isFinite(Number(w.n))?Math.max(1,Math.round(Number(w.n))):PK.BAG),
    potions_below:(a,w)=>potionsHeld(a)<Math.max(1,Math.min(9,Math.round(Number(w.n))||1)),
    no_potions:a=>potionsHeld(a)===0,
    no_quest_in_focus:a=>!questLog(a).focus,
    quest_target_in_sight:a=>{const q=a.quest;if(!q||q.have>=q.need)return false;const R=sightOf(a);return nearMobs(a.x,a.y,R).some(m=>m.alive&&!m.gone&&!m.hidden&&m.type===q.type&&dist(a,m)<=R)},
    node_ready:(a,w)=>{if(inTown(a)||cityAt(a))return false;const p=pickNode(a,w.kind||'',sightOf(a));return !!(p&&p.node&&canGather(a,p.node).ok)},
    // the flee mark of the fight reflex, as before #617: PK.FLEE, the hunt order's flee_below, autopilot's wary marks (#487)
    past_flee_mark:(a,w,ctx)=>{const m=ctx&&ctx.m,cmd=ctx&&ctx.cmd;if(!m)return false;
      const wary=a.playIdle||cmd&&cmd.wary,wv=(m.lvl>a.lvl+PK.WARY_UP||m.elite||m.named?PK.WARY_OUT:PK.WARY_FLEE)*tm(a,'flee');
      const fb=cmd&&cmd.flee!=null?(wary?Math.max(cmd.flee,wv):cmd.flee):wary?wv:PK.FLEE;return a.hp<maxHp(a)*fb}},
  acts:{
    // ---- in a fight ----
    heal:(a,t,ctx)=>{if(!CLS[a.cls].heal)return null;const r=ctx.rule;
      if(r.when==='always'&&!r.and&&!t.who){const h=a.healCd,p=a.potCd;priestHeal(a,ctx.list);return a.healCd!==h||a.potCd!==p} // its own judgement, as before
      if(a.healCd>0)return null;const b=gAlly(a,t.who,ctx);if(!b||b.state==='ghost'||dist(a,b)>4||b.hp>=maxHp(b))return null;healOne(a,b);return true},
    defend:(a,t,ctx)=>{if(a.cd>0)return null;strike(a,ctx.m);a.cd=1.1;return true},
    drink_potion:(a,t,ctx)=>{const r=ctx.rule;
      if(r.when==='always'&&!r.and)return asSrc('reflex',()=>fightAid(a,ctx.m)); // reflex: a potion or ward from the pack keeps the hero up while the agent thinks (sim/inv.js)
      if(a.potCd>0)return null;const id=bestUse(a,'potion');if(!id)return null;return asSrc('reflex',()=>useItem(a,id)).ok||null},
    flee_home:a=>{if(a.state!=='fight')return null;asSrc('reflex',()=>flee(a,true));return 'end'},
    retreat_to:(a,t)=>{if(a.state!=='fight')return null;const to=String(t.to||'town').toLowerCase();let p=null,label=null;
      if(to==='leader'){const L=leaderFor(a)||gLeader(a);if(L&&L!==a&&L.state!=='dead'&&!L.hidden){p={x:L.x,y:L.y};label=L.name}}
      else if(to==='camp'){const C=companyOf(a),g=C&&C.camp;if(g&&g.phase){p={x:g.x,y:g.y};label='the camp'}}
      if(to!=='town'&&!p)return null;asSrc('reflex',()=>flee(a,true));
      if(p&&a.state==='return')a.pq=[{kind:'move',legs:[{x:p.x,y:p.y,st:'return'}],last:'hunt',label,flee:true}];return 'end'},
    use_ability:(a,t,ctx)=>{const key=String(t.id||'').toLowerCase().replace(/[^a-z]/g,'');const id=movesOf(a).find(i=>i===key||MOVES[i].name.toLowerCase().replace(/[^a-z]/g,'')===key);if(!id)return null;
      const M=MOVES[id],w=String(t.target||'').toLowerCase();let on=null;
      if(M.target==='foe')on=ctx.m;else if(M.target==='ally'){on=w==='foe'?null:gAlly(a,w===''?'self':w,ctx);if(!on)return null}
      const r=useMove(a,id,on,{mates:ctx.list,foe:ctx.m});if(!r||!r.ok)return null;if(M.swing)a.cd=Math.max(a.cd,0)+1.1;return true},
    guard:(a,t,ctx)=>{const b=gAlly(a,t.who,ctx);if(!b||b===a)return null;
      const x=nearMobs(b.x,b.y,4).find(m=>m.alive&&!m.gone&&m.target===b&&dist(a,m)<=6);if(!x)return null;x.target=a;return true},
    // ---- both ----
    hold_position:(a,t,ctx)=>ctx.m?'end':HOLD,
    shout:(a,t,ctx)=>{const text=clean(t.text,120);if(!text||notEnglish(text)||!gOnce(a,ctx.rule,'s',GAMBIT.SHOUT_GAP))return null;const n=partySay(a,text);if(typeof n==='string')return null;
      const e=a.chat&&a.chat[a.chat.length-1];if(e)agentLine(a,e);return ctx.m?true:HOLD},
    wake_me:(a,t,ctx)=>{if(!gOnce(a,ctx.rule,'w',GAMBIT.WAKE_GAP))return null;ev(a,'Your rule calls you: '+ruleText(ctx.rule)+'.',2);return ctx.m?true:HOLD},
    hold:(a,t,ctx)=>{if(!gOnce(a,ctx.rule,'h',GAMBIT.HOLD_GAP))return null;ev(a,'Your rule holds the world for you: '+ruleText(ctx.rule)+'. Act (any acting tool) to let it run on.',2);holdStart(a,ctx.rule);return ctx.m?true:HOLD}, // #630: wake_me that also stops the clock
    // ---- between turns ----
    follow_order:a=>a.hp>=maxHp(a)*PK.RETREAT*tm(a,'retreat')?standingFollow(a):null, // a standing follow order (#445): fall in behind them again
    follow_leader:(a,t,ctx)=>{if(ctx.field)return leaderOf(a)?HOLD:null; // a follower keeps to its leader out here (the follow state); one whose leader stayed in town hunts on
      const L=gLeader(a);return L&&S.gameMin-(a.playActAt||0)<PK.IDLE+TP.WAIT?HOLD:null}, // in town: wait for the leader a while; it follows them out (town())
    rest:(a,t,ctx)=>{const min=Math.min(240,Math.max(10,Math.round(Number(t.minutes))||60));
      if(ctx.town){if(t.inn&&t.inn!=='no'){const c=homeOf(a),inn=c.spots&&c.spots.inn||c.ah;return [{kind:'move',legs:[{x:inn.x,y:inn.y,st:'town'}],last:'town',label:'the inn in '+c.name,auto:'walking to the inn to rest (hurt)'},{kind:'rest',until:S.gameMin+min,auto:'resting at the inn'}]}
        return {kind:'rest',until:S.gameMin+min,auto:'resting before heading out'}} // #487: out only near full health
      return creatureNear(a,PK.REST_CLEAR)?homeCmd(a,'hurt, and creatures close by'):{kind:'rest',until:S.gameMin+min,auto:'resting while hurt',label:'rest'}},
    go_home:(a,t,ctx)=>ctx.field?homeCmd(a,homeWhy(a,ctx.rule)):null,
    sell_loot:(a,t,ctx)=>{if(ctx.town)return {kind:'sell',auto:'selling your loot'};const c=homeOf(a);
      const cmd={kind:'move',legs:[{x:c.gate.x,y:c.gate.y,st:'return'},{x:c.ah.x,y:c.ah.y,st:'town'}],last:'town',label:'the '+c.name+' auction house (pack full)'};
      if(!ctx.reflex)cmd.auto='heading home to sell (pack full)';return cmd},
    buy_potions:(a,t,ctx)=>{if(!ctx.town)return null;const n=Math.min(6,Math.max(1,Math.round(Number(t.n))||TP.POTIONS)),pk=bestPotion(a),held=potionsHeld(a);
      return pk&&held<n&&a.gold>=USES[pk].price*n&&used(a)<capOf(a)?{kind:'buy',item:pk,n:n-held,auto:'buying '+pk}:null},
    pursue_aim:a=>intentPilot(a)||null, // the hero's stated aim (#535) is the standing order where it maps to one
    hunt_again:(a,t,ctx)=>{if(!ctx.field)return null;const o=a.playOrder,z=zoneAt(a.x,a.y);
      return o&&o.kind==='hunt'&&fits(a,z)?{kind:'hunt',n:o.n,k0:a.kills,flee:o.flee,prey:o.prey,wary:true,ground:z,auto:'hunting again (your last order: hunt '+o.n+')',label:'hunt'}:null},
    hunt_here:(a,t,ctx)=>{if(!ctx.field)return null;const z=zoneAt(a.x,a.y),b=bandOf(z),g=groundFor(a),holds=b&&a.lvl>=b[0]&&(b[1]==null||a.lvl<=b[1]);
      return fits(a,z)&&(g==null||g===z||holds)?{kind:'hunt',n:TP.HUNT,k0:a.kills,wary:true,ground:z,auto:'hunting in '+ZONES[z]+' (it suits your strength)',label:'hunt'}:null},
    hunt_region:(a,t,ctx)=>{const gz=gZone(a,t.region);if(gz===-1)return null;
      if(ctx.town){const z=gz!=null?gz:groundFor(a);if(z==null)return null;const p=planOne(a,ZONES[z].toLowerCase());if(!p||p.error)return null;
        const L=gLeader(a),o=a.playOrder&&a.playOrder.kind==='hunt'?a.playOrder:null,n=o?o.n:TP.HUNT;
        const why=o?'your last order: hunt '+o.n:L?L.name+' is still in town; hunting nearby':'it suits your strength';
        return [{kind:'move',legs:p.legs,last:'hunt',label:p.label,auto:'heading out to '+ZONES[z]+' to hunt ('+why+')'},{kind:'hunt',n,flee:o?o.flee:undefined,prey:o?o.prey:undefined,wary:true,ground:z,auto:'hunting in '+ZONES[z]+' ('+why+')'}]}
      const z=zoneAt(a.x,a.y),g=gz!=null?gz:groundFor(a);if(g==null||g===z)return null;const p=planOne(a,ZONES[g].toLowerCase());if(!p||p.error)return null;
      return [{kind:'move',legs:p.legs,last:'hunt',label:p.label,auto:'moving on to '+ZONES[g]+' ('+ZONES[z]+(fits(a,z)?' is not your ground':' is beyond you')+')'},{kind:'hunt',n:TP.HUNT,wary:true,ground:g,auto:'hunting in '+ZONES[g]+' (it suits your strength)'}]},
    make_camp:(a,t,ctx)=>{if(!ctx.field)return null;const C=companyOf(a);if(!C||leaderFor(a)!==a||(C.camp&&C.camp.phase))return null;return leaderRest(a,t.hours||2)==null?HOLD:null},
    gather:(a,t,ctx)=>{if(!ctx.field||!fieldState(a))return null;const p=pickNode(a,t.kind||'',sightOf(a));if(!p||!p.node||!canGather(a,p.node).ok)return null;
      return {kind:'gather',node:p.node.id,label:p.node.name,auto:'gathering at a '+String(p.node.name).toLowerCase()}},
  }});
// The order an aim maps to: the command the agent just gave (or carries out now), else what the goal's words name.
function orderOf(a,c,target){if(!c||c.auto)return null;
  if(c.kind==='move'&&!c.flee){const e=(c.legs||[])[c.legs.length-1];return e?{kind:'move',label:c.label,target:target||null,to:{x:e.x,y:e.y},last:c.last}:null}
  if(c.kind==='hunt'){const m=(a.pq||[]).find(x=>x.kind==='move'),g=m&&ZONES.includes(m.label)?m.label:ZONES[zoneAt(a.x,a.y)]||null;return {kind:'hunt',n:c.n,k0:a.kills,flee:c.flee,prey:c.prey,ground:g}}
  if(c.kind==='follow'){if(!a.playOrder||a.playOrder.kind!=='follow')a.playOrder={kind:'follow',id:c.id,until:c.until,h:c.h};return {kind:'follow',id:c.id,name:c.name}}
  if(c.kind==='rest')return {kind:'wait'};
  return null}
function goalOrder(a,goal){const g=String(goal||'').toLowerCase();if(waitish(g))return {kind:'wait'};
  const f=/\bfollow(?:ing)?\s+([a-z' -]+)/.exec(g);if(f){const w=f[1].trim().split(/\s+/)[0];const b=S.agents.find(x=>x!==a&&x.kind==='hero'&&x.state!=='dead'&&x.name.toLowerCase().split(' ')[0]===w&&!x.hidden&&dist(a,x)<=sightOf(a));
    if(b&&!followRefusal(a,b)){a.playOrder={kind:'follow',id:b.id};return {kind:'follow',id:b.id,name:b.name}}}
  const hit=knownNames(a).filter(n=>n&&new RegExp('(^|[^a-z])'+reEsc(n.toLowerCase())+'($|[^a-z])').test(g)).sort((x,y)=>y.length-x.length)[0];
  const huntish=/\b(hunt|hunting|kill|slay|grind|level|xp)\b/.test(g);
  if(hit){if(huntish&&ZONES.includes(hit))return {kind:'hunt',n:TP.HUNT,k0:a.kills,ground:hit};
    const p=planOne(a,hit.toLowerCase());if(p&&!p.error){const e=p.legs[p.legs.length-1];return {kind:'move',label:p.label,target:hit,to:{x:e.x,y:e.y},last:p.last}}}
  if(huntish&&!inTown(a)&&!cityAt(a))return {kind:'hunt',n:TP.HUNT,k0:a.kills,ground:ZONES[zoneAt(a.x,a.y)]||null};
  return null}
// The leader's shout (#535): a company leader's new aim reaches the companions in shouting range as a party line, and
// each who heard it carries it in its header (a.heardAim). Nothing else of the aim leaves the hero.
function shoutAim(a){const C=companyOf(a);if(!C||C.ids.length<2||leaderFor(a)!==a||a.state==='ghost')return null;const I=a.intent;
  const text=clean(I.goal+(I.why?', '+I.why:''),PK.SAY_LEN);if(!text||notEnglish(text)||a.aimShout===text)return null;
  const n=partySay(a,text);if(typeof n==='string')return null;a.aimShout=text;const e=a.chat&&a.chat[a.chat.length-1];if(!e)return null;e.aim=true;agentLine(a,e);
  const H=S.agents.filter(b=>b!==a&&b.chat&&b.chat[b.chat.length-1]===e);noteSaid(a,e.text,H);
  for(const b of H)if(companyOf(b)===C)b.heardAim={id:a.id,name:a.name,text:e.text,at:Math.round(S.gameMin)};
  return {heard_by:e.heard||[],too_far:e.far&&e.far.length?e.far:undefined}}

// ---- the agent's turn and its last look (issue #240) ----
// A local model's turn can take a game hour at 1x. While the hero's turn is open (from the pace wake, or the first tool
// call, until the runner's next pace call or a wait) autopilot finishes what it is doing (a fight resolves, a walk or a
// rest goes on, a reflex flees) but starts nothing new: no autopilot rest or hunt, no new prey, no walk home with a full
// pack, no following the party out of town. Capped at PK.HOLD game minutes, and off once a host says no runner holds it.
export function turnStart(a){if(a&&a.player)a.playTurn=S.gameMin}
export function turnEnd(a){if(a)a.playTurn=null}
export const turnHeld=a=>!!(a&&a.player&&a.playTurn!=null&&S.gameMin-a.playTurn<PK.HOLD&&(!hasLinks()||agentLive(a)));
const clockAt=gm=>{const m=Math.floor(gm)%1440;return 'Day '+(Math.floor(gm/1440)+1)+' '+String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')};
const fighting=a=>(a.state==='fight'||a.state==='duel'||a.state==='assist')&&a.target&&alive(a.target)?a.target:null;
const whereOf=a=>{const c=cityAt(a);return c?c.name:ZONES[zoneAt(a.x,a.y)]||'the wilds'};
const stateWord=s=>({town:'in town',hunt:'out in the field',travel:'on the road',return:'heading home',fight:'fighting',duel:'in a duel',assist:'helping in a fight',follow:'following the party',dungeon:'in '+CRYPT.name,raid:'on a raid',ghost:'a ghost'})[s]||s;
// What the agent saw: game time, place, state, foe, what it was doing (look, status, the turn's state header).
export function lookSnap(a){if(!a||!a.player)return;const f=fighting(a);
  a.playLook={gm:S.gameMin,x:a.x,y:a.y,state:a.state,where:whereOf(a),doing:a.playDoing||null,foe:f?{id:f.id,name:foeName(a,f)}:null,ev:a.playEvN||0,kills:a.kills}}
// Why an order no longer fits: what changed since that look, or null when nothing did.
function sinceLook(a,args){const L=a.playLook;if(!L)return null;const out=[],f=fighting(a);
  if(L.foe&&(!f||f.id!==L.foe.id)){const t=findTarget(L.foe.id);out.push('the fight with '+L.foe.name+' is over'+(t&&!alive(t)?' ('+(t.kind==='mob'?'it is dead':L.foe.name+' has fallen')+')':''))}
  if(a.kills>L.kills)out.push((a.kills-L.kills)+' kill'+(a.kills-L.kills>1?'s':'')+' made');
  const w=whereOf(a);if(w!==L.where)out.push('you were in '+L.where+', now you are in '+w);else if(dist(a,L)>3)out.push('you moved '+Math.round(dist(a,L))+' tiles');
  if(a.state!==L.state)out.push('you were '+stateWord(L.state)+', now you are '+stateWord(a.state));
  if(a.playIdle&&a.playDoing)out.push(a.playDoing);
  if(!out.length)return null; // nothing moved on: the refusal stands as it is
  const tid=args&&args.target_id!=null?Number(args.target_id):null;
  if(tid!=null&&Number.isFinite(tid)){const t=findTarget(tid);out.push(!t||(t.kind==='mob'&&t.gone)?'target #'+tid+' is gone':!alive(t)?'target #'+tid+' is dead':t.hidden?'target #'+tid+' is out of sight':dist(a,t)>sightOf(a)?'target #'+tid+' is out of sight ('+Math.round(dist(a,t))+' tiles off)':'target #'+tid+' is '+r1(dist(a,t))+' tiles away')}
  const evs=(a.playEv||[]).filter(e=>e.n>L.ev).slice(-3).map(e=>e.t+' '+e.text);
  return 'Since your last look ('+clockAt(L.gm)+', '+Math.round(S.gameMin-L.gm)+' game min ago): '+out.join('; ')+'.'+(evs.length?' Lately: '+evs.join(' / '):'')+' look() to see the world as it is now.'}

// ---- marking ----
export function markPlayer(a,on){if(!a||a.kind!=='hero')return false;
  if(on){if(a.state==='dead')return false;a.player=true;a.playActAt=S.gameMin;a.playIdle=false;a.playTurn=null;a.pq=a.pq||[];a.journal=a.journal||[];a.playLog=a.playLog||[];a.playEv=a.playEv||[];
    a.playW={hp:a.hp,lvl:a.lvl,state:a.state,kills:a.kills,hist:key((a.history||[]).slice(-1)[0]),chat:key((a.chat||[]).slice(-1)[0])};
    if(!S.playerHeroes)S.playerHeroes=[];if(!S.playerHeroes.includes(a.id))S.playerHeroes.push(a.id);
    ev(a,a.name+' wakes with a will of their own.');record(a,'Began to choose their own road.');soloFor(a);return true}
  if(inSlots(a)&&a.state!=='dead')return false; // the Fellowship is always agent-played (#148): a member is handed back only by leaving
  a.player=false;a.pq=[];a.partyOk=false;a.playDoing=null;if(S.playerHeroes)S.playerHeroes=S.playerHeroes.filter(id=>id!==a.id);
  {const C=companyOf(a);if(C&&!C.slots)leaveCompany(a)} // out of agent play: a solo's company ends with it
  return true}
export const isPlayer=a=>!!(a&&a.player);

// ---- the reduced state machine ----
// Returns true when it handled the step; false hands it to updAgent (duels, assists, regroups,
// ghosts, a consented crypt or raid, following a party leader, and the DM-led legs of an adventure).
export function playerUpd(a,dt){if(!a.player||a.state==='dead')return false;
  watch(a);intentWatch(a);noticeHeroes(a); // sight events (#570); aim progress progress toward the stated aim (#535)
  // A Fellowship member whose runner is gone, once the owner said go on (or with no host at all: the headless sim,
  // play-headless before a runner claims it): its reflexes play it whole, the scripted rules, until a runner holds
  // it again (#148). While a runner holds it, or the owner has not answered yet, autopilot below carries on.
  if(inSlots(a)&&reflexMay(a)){a.playIdle=false;a.playDoing='reflexes (no runner)';return false}
  // Drafts the agent did not ask for: a crypt group or a raid muster. Step back out.
  if(a.state==='dungeon'&&!a.hidden&&!a.cryptOk){a.state=cityAt(a)?'town':'hunt';a.dest=null;ev(a,'Turned down a call to '+CRYPT.name+' (you go only where you choose).')}
  if(a.state==='raid'&&a.raid&&!a.raidOk){a.raid=false;a.target=null;a.state=cityAt(a)?'town':'hunt';a.dest=null;ev(a,'Turned down a raid muster on Kragmaw.')}
  if(a.party&&!a.partyOk&&!partySlotted(a.party)){leaveParty(a);ev(a,'Turned down a party (use join_party to join one).')} // the Fellowship's own party is always theirs
  const adv=advOf(a);
  // Autopilot (issue #126): no command and no action for PK.IDLE game minutes, outside an adventure or a scene.
  // The agent stays the hero's mind; until it acts again the hero carries on its last order and does what a
  // reflex would (rest when hurt, follow the party, fight back, go home when hurt or full), never the scripted rules.
  const lastAct=a.playActAt??(a.playActAt=S.gameMin);
  // ...but not while the agent's turn is open (#240): it is deciding right now, so nothing new starts under it.
  if(!cmdOf(a)&&!adv&&!tableView(a)&&S.gameMin-lastAct>=PK.IDLE&&!turnHeld(a)){if(!a.playIdle){a.playIdle=true;ev(a,'No order from you for a while: autopilot carries on (your last order, rest when hurt, follow the party). Any command takes over.')}
    const ap=autopilot(a);if(ap){const L=Array.isArray(ap)?ap:[ap];a.pq=L;a.playAuto=L[0].label||L[0].kind;if(a.state==='town'&&L[0].auto)ev(a,'Autopilot: '+L[0].auto+'.',false)}}
  else if(a.playIdle&&S.gameMin-lastAct<PK.IDLE){a.playIdle=false;a.playAuto=null}
  const cmd=cmdOf(a);
  // A choice scene answered (or timed out): send the hero back to the scene point so the DM
  // reaches the choice again and takes the pick (sim/player-choice.js).
  if(adv&&adv.stage==='choose'&&adv.pick&&(adv.pick.chosen||S.gameMin>=adv.pick.until)){adv.pick.rearm=true;adv.stage='go';if(a.state==='hunt'||a.state==='travel'){a.state='travel';a.dest=null}}
  const driving=adv&&adv.lead===a.id&&(!a.party||a.party.leader===a);
  a.playDoing=doingText(a,adv,cmd);if(a.playIdle)a.playDoing='autopilot: '+(cmd&&cmd.auto?cmd.auto:a.playDoing||'standing watch');
  if(cmd&&cmd.kind==='follow'&&FOLLOWS.includes(a.state))return followStep(a,dt,cmd); // walk at their side (#445); a fight goes on in fight() and the follow after it
  switch(a.state){
  case 'town':return town(a,dt,cmd);
  case 'follow':if(!cmd)return false;a.state='hunt';a.dest=null;return cmd.kind==='move'?travel(a,dt,cmd):field(a,dt,cmd);
  case 'fight':return fight(a,dt,cmd);
  case 'return':if(cmd)return travel(a,dt,cmd);a.cd-=dt;return homeward(a,dt);
  case 'travel':case 'hunt':
    if(cmd)return a.state==='travel'||cmd.kind==='move'?travel(a,dt,cmd):field(a,dt,cmd);
    if(driving)return false; // the DM leads the adventure's legs (dmTravel / dmHunt)
    if((a.partyOk||(a.party&&partySlotted(a.party)))&&leaderOf(a)){a.state='follow';a.dest=null;return false}
    if(a.state==='travel'){a.state='hunt';a.dest=null}
    return field(a,dt,null);
  default:return false}}

// A line the hero heard (sim/chat.js, council.js party chat, an NPC, the DM's narrate), as the agent reads it.
const heardText=e=>e.whisper?'(whispered) '+(e.from&&e.from.name||'Someone')+': '+e.text:e.emote?'*'+(e.from&&e.from.name||'Someone')+' '+e.text+'*':e.dream?e.text:e.from&&e.from.kind==='dm'?'The narrator: '+e.text:(e.party?'[party] ':'')+(e.from&&e.from.name||'Someone')+' says: "'+e.text+'"';
// Hearing (issue #126): a line from an agent-played hero (aloud in earshot, or on the party channel) starts the
// listener's turn promptly (2), at most once per PK.HEAR_WAKE game minutes per listener so two agents cannot
// talk each other into turns forever; the narrator, an NPC or a scripted companion's party line wake after the gap (1).
function hearWake(a,e){const f=e.from;
  if(f&&f.kind==='hero'&&f.player){if(S.gameMin-(a.playHeardAt??-1e9)>=PK.HEAR_WAKE){a.playHeardAt=S.gameMin;return 2}return 0}
  if(e.talk||e.dream)return 2; // a person answering the hero in a conversation (#170): a turn at once
  return e.party||f&&(f.kind==='dm'||f.kind==='npc')?1:0}
// Notice what changed since the last step and turn it into events.
function watch(a){const w=a.playW||(a.playW={hp:a.hp,lvl:a.lvl,state:a.state,kills:a.kills});const mh=maxHp(a);
  visit(a); // learn the world (#188): the region underfoot, landmarks in sight, what the quest giver named
  const foe=a.target&&a.target.kind==='mob'&&a.target.alive?a.target:null;if(foe&&a.state==='fight')engage(a,foe);
  if(a.lvl>w.lvl)ev(a,'Reached level '+a.lvl+'.',true);
  if(a.kills>w.kills&&a.target==null&&a.state!=='fight')ev(a,'Made a kill ('+a.kills+' in all).');
  if(a.state!==w.state){
    if(a.state==='fight'&&a.target&&a.target.kind==='mob'&&a.target.target===a&&!(cmdOf(a)&&cmdOf(a).kind!=='move'))ev(a,'Attacked by '+foeName(a,a.target)+' ('+threatText(a,a.target)+')!',2);
    if(a.state==='duel'&&a.target)ev(a,'In a duel with '+a.target.name+' ('+FAC[a.target.fac].name+' '+a.target.cls+', level '+a.target.lvl+')!',2);
    if(a.state==='assist'&&a.target)ev(a,'Rushing to help against '+a.target.name+'.',2)}
  if(a.hp<mh*.3&&w.hp>=mh*.3)ev(a,'Badly hurt: '+pct(a.hp,mh)+'% HP.',2);
  if(a.hp<mh*LORE.NEAR&&a.hp>0){const m=foe||(a.loreFoe!=null?S.mobs.find(x=>x.id===a.loreFoe&&x.target===a):null);if(m)nearDeath(a,m)} // a lesson (#188)
  if(a.playChoiceNew){a.playChoiceNew=false;const adv=advOf(a),p=adv&&adv.pick;
    if(p)ev(a,'A choice on '+(p.title||'your adventure')+': '+p.frame+'. a) '+p.opts.a+'  b) '+p.opts.b+'. choose() within '+Math.max(0,Math.round(p.until-S.gameMin))+' game minutes.',3)}
  const hs=since(a.history,w.hist);for(const e of hs)if(!/^Began to choose/.test(e.text))ev(a,e.text);if(a.history&&a.history.length)w.hist=key(a.history[a.history.length-1]);
  const cs=since(a.chat,w.chat);for(const e of cs)if(e.from!==a&&!(e.from&&e.from.kind!=='npc'&&e.from.id===a.id)){ev(a,heardText(e),false,hearWake(a,e));hear(a,e.text,e.from&&e.from.kind==='dm'?'the narrator':e.from&&e.from.name);hearMarks(a,e.from,e.text)} /* a lesson told is learned (#188) */if(a.chat&&a.chat.length)w.chat=key(a.chat[a.chat.length-1]);
  w.hp=a.hp;w.lvl=a.lvl;w.state=a.state;w.kills=a.kills}

function town(a,dt,cmd){const mh=maxHp(a);a.cd-=dt;a.hp=Math.min(mh,a.hp+mh*.3*dt);
  // Fellowship (#68): with nothing else to do, a member follows the leader out of town (leave_party to stay)
  if(!cmd&&a.party&&partySlotted(a.party)&&a.party.leader!==a&&leaderOf(a)&&!a.splitUntil&&!turnHeld(a)){const c=homeOf(a);
    cmd={kind:'move',legs:[{x:c.gate.x,y:c.gate.y,st:'town'}],last:'hunt',label:'the gate, following '+a.party.leader.name};a.pq=[cmd];ev(a,'The party is out with '+a.party.leader.name+'; you follow them out of '+c.name+'.')}
  if(cmd&&cmd.kind==='move')return travel(a,dt,cmd);
  if(cmd&&cmd.kind==='rest'){if(S.gameMin>=cmd.until||(!cmd.search&&a.hp>=mh))done(a,cmd.search?'You finish searching.':'Rested. HP '+pct(a.hp,mh)+'%.');a.moving=false;return true}
  if(cmd&&cmd.kind==='sell'){const r=sellLoot(a);a.gold+=r.gold;done(a,r.n?'Sold '+r.n+' thing'+(r.n>1?'s':'')+' for '+r.gold+'g (gold '+a.gold+').':null,false);a.moving=false;return true} // autopilot (#466)
  if(cmd&&cmd.kind==='buy'){const U=USES[cmd.item];let got=0;while(U&&got<cmd.n&&a.gold>=U.price&&addUse(a,cmd.item,1)){a.gold-=U.price;got++}
    done(a,got?'Bought '+cmd.item+' x'+got+' (gold '+a.gold+').':null,false);a.moving=false;return true}
  if(cmd)done(a,'Cannot '+cmd.kind+' inside the town walls.');
  a.moving=false;return true}

// Walk the legs of a move command. Each leg says which state the hero is in while walking it:
// 'town' inside the walls, 'return' heading for the home gate (monsters let it go), 'travel' out in the world.
function travel(a,dt,cmd){a.cd-=dt;const leg=cmd.legs&&cmd.legs[0];
  if(!leg){finishMove(a,cmd);return true}
  if(a.state!=='fight')a.state=leg.st;a.dest=null;const mh=maxHp(a);
  if(leg.st==='town')a.hp=Math.min(mh,a.hp+mh*.3*dt);else a.hp=Math.min(mh,a.hp+mh*.015*dt);
  if(moveTo(a,leg.x,leg.y,dt,leg.st==='town'?2.2:2.4)){cmd.legs.shift();if(!cmd.legs.length)finishMove(a,cmd)}
  return true}
function finishMove(a,cmd){a.moving=false;const last=cmd.last||'hunt';a.state=last;a.zone=zoneAt(a.x,a.y);
  done(a,cmd.flee?'Made it back to '+homeOf(a).name+'.':'Arrived: '+cmd.label+'.')}
// No command and heading home (fled, a party turning back, an adventure ended): walk to the gate.
function homeward(a,dt){const c=homeOf(a);if(moveTo(a,c.gate.x,c.gate.y,dt,2.4)){a.state='town';a.moving=false;ev(a,'Back in '+c.name+'.')}return true}

// Out in the world, not walking: hunt, rest, or stand and keep watch.
function field(a,dt,cmd){const mh=maxHp(a);a.cd-=dt;a.zone=zoneAt(a.x,a.y);
  if(a.state!=='hunt')a.state='hunt';
  if(cmd&&cmd.kind==='rest'){a.moving=false;a.hp=Math.min(mh,a.hp+mh*PK.REST_REGEN*dt);if(S.gameMin>=cmd.until||(!cmd.search&&a.hp>=mh))done(a,cmd.search?'You finish searching.':'Rested. HP '+pct(a.hp,mh)+'%.');return true}
  a.hp=Math.min(mh,a.hp+mh*.025*dt);
  if(cmd&&cmd.kind==='fight'){const t=findTarget(cmd.id);
    if(!t||!alive(t)){done(a,t&&t.kind==='mob'&&!t.alive?'Slew '+(t.elite?t.name:'the '+mobName(t))+'.':'Your target is gone.');return true}
    if(t.kind==='mob'){a.target=t;a.state='fight';a.dest=null;return true}
    done(a,'Your foe is out of reach.');return true}
  if(cmd&&cmd.kind==='hunt'){if(cmd.k0==null)cmd.k0=a.kills;const left=cmd.n-(a.kills-cmd.k0);
    if(left<=0){done(a,'Hunt done: '+cmd.n+' kill'+(cmd.n>1?'s':'')+'. HP '+pct(a.hp,mh)+'%.');return true}
    if(a.hp<mh*PK.RETREAT*tm(a,'retreat')){done(a,'Too hurt to keep hunting ('+pct(a.hp,mh)+'% HP).');return true}
    if(isStorm(a.zone)&&!cmd.stormSaid){cmd.stormSaid=true;ev(a,'A storm rolls over '+ZONES[a.zone]+'.',true)}
    if(cmd.wary&&isStorm(a.zone)){done(a,'A storm over '+ZONES[a.zone]+': the hunt ends.');return true} // autopilot (#487) heads home next
    if(cmd.auto&&turnHeld(a)){a.moving=false;a.dest=null;return true} // autopilot's hunt picks no new prey while the agent's turn is open (#240)
    // the ground it hunts on (autopilot goes back there, #466); a wary hunt (#487) keeps to its ground and its prey to what the hero can take
    const gz=cmd.wary&&cmd.ground!=null&&ZPTS[cmd.ground]&&ZPTS[cmd.ground].length?cmd.ground:a.zone;
    a.scan-=dt;if(a.scan<=0){a.scan=.5;const m=cmd.wary?waryPrey(a,cmd):pickPrey(a,cmd);if(m){a.target=m;a.state='fight';a.dest=null;a.playGround=gz;cmd.dry=0;return true}}
    // a wary hunt that walked PK.ROAM legs without finding prey it can take ranges across its whole ground for the next one
    if(!a.dest||cmd.wary&&gz!==a.zone&&zoneAt(a.dest.x,a.dest.y)!==gz){const far=cmd.wary&&(cmd.dry||0)>=PK.ROAM;a.dest=zonePoint(gz,far?null:a);if(far)cmd.dry=0}
    if(moveTo(a,a.dest.x,a.dest.y,dt,1.8)){a.dest=null;if(cmd.wary)cmd.dry=(cmd.dry||0)+1}return true}
  if(cmd&&cmd.kind==='gather'){const t=gatherCmd(a,dt,cmd,moveTo);if(t)done(a,t);return true} // walk to the node, work it, try (sim/gather.js, #257)
  if(cmd){done(a,'Cannot '+cmd.kind+' here.');return true}
  // idle reflex: a full bag goes home to be sold
  a.moving=false;
  if(!turnHeld(a)){const r=reflexPick(a,{field:true,town:false});if(r){a.pq=Array.isArray(r)?r:[r];ev(a,r.why||'Your pack is full of loot; heading home to sell.',true);delete r.why}} // the pack reflex: the hero's sell_loot gambits (#617)
  return true}

function fight(a,dt,cmd){const m=a.target,mh=maxHp(a);a.cd-=dt;
  if(!m||m.kind!=='mob'||!m.alive||m.gone){a.target=null;a.state=cmd&&cmd.kind==='move'?cmd.legs[0]?cmd.legs[0].st:'hunt':'hunt';
    if(cmd&&cmd.kind==='fight'){done(a,m&&!m.alive?'Slew '+(m.elite?m.name:'the '+mobName(m))+'.':'The fight is over.')}
    return true}
  const r=CLS[a.cls].range,d=dist(a,m);a.face=m.x>a.x?1:-1;
  if(d>r){moveTo(a,m.x,m.y,dt,2.4);return true}a.moving=false;
  if(!m.target)m.target=a;
  // The hero's fight gambits (#617), every moment in order. The class preset is the old fixed sequence: the class heal
  // (priestHeal), a blow when the weapon is ready, the pack's reflex (sim/inv.js fightAid), and the flee mark (past_flee_mark).
  fightRules(a,{m,cmd,list:a.party?a.party.mem:[a]});
  return true}

// Break off: a monster lets go (one parting blow is rolled), a duel ends in a pull-back.
function flee(a,reflex){const t=a.target,c=homeOf(a);
  a.pq=[{kind:'move',legs:[{x:c.gate.x,y:c.gate.y,st:'return'}],last:'town',label:c.name,flee:true}];
  if(t&&t.kind==='hero'&&(a.state==='duel'||a.state==='assist')){if(t.target===a&&t.state==='duel'){t.state='hunt';t.target=null}a.target=null;a.state='return'}
  else{if(t&&t.target===a)t.target=null;a.target=null;a.state='return';if(t&&t.kind==='mob')fleeCheck(a,t)}
  actFlee(a);pop(a.x,a.y-.8,'FLEE','#ffb060');ev(a,(reflex?'Your nerve breaks at '+pct(a.hp,maxHp(a))+'% HP: ':'')+'Fled toward '+c.name+'.',true);
  say(a,'flee',{mob:t&&t.kind==='mob'?mobName(t):'them'})}

const alive=t=>t&&(t.kind==='mob'?t.alive&&!t.gone:t.state!=='dead');
function findTarget(id){return S.mobs.find(m=>m.id===id)||S.agents.find(b=>b.id===id)||null}
// Targets by name or id, and refusals that list what is legal (#399): small models guessed ids ("target_id":5) and got
// "No such friend." with nothing to pick from. Only what the hero can see: companions and foes in sight, never across the map.
const idIn=v=>{if(v==null||v==='')return null;if(typeof v==='number')return Number.isFinite(v)?v:null;const m=/^\s*#?(\d+)\s*$/.exec(String(v))||/(?:#|\bid\s*)(\d+)/i.exec(String(v));return m?Number(m[1]):null};
const nameKey=v=>String(v==null?'':v).toLowerCase().replace(/\s*[#(].*$/,'').replace(/^(?:an?|the)\s+/,'').trim();
const byDist=a=>(x,y)=>dist(a,x)-dist(a,y);
function friendsInSight(a){const R=sightOf(a);return (a.party?a.party.mem:[]).filter(b=>b!==a&&b.state!=='dead'&&!b.hidden&&dist(a,b)<=R).sort(byDist(a))}
function foesInSight(a){const R=sightOf(a);return [...nearMobs(a.x,a.y,R).filter(m=>alive(m)&&!m.hidden),...nearHeroes(a.x,a.y,R).filter(b=>b.fac!==a.fac&&b.state!=='dead'&&!b.hidden)].filter(t=>dist(a,t)<=R).sort(byDist(a))}
const friendList=a=>{const L=friendsInSight(a);return L.length?'Companions in sight: '+L.slice(0,5).map(b=>b.name+' (id '+b.id+', '+Math.round(dist(a,b))+' tiles)').join(', ')+'; or leave the target out for yourself.':'No companion is in sight; leave the target out for yourself.'};
const taken=(a,t)=>t.kind==='mob'&&t.target&&t.target!==a&&t.target.state!=='dead';
const foeList=(a,free)=>{const L=foesInSight(a).filter(t=>!free||!taken(a,t));return L.length?(free?'Free foes in sight: ':'Foes in sight: ')+L.slice(0,6).map(t=>foeName(a,t)+' (id '+t.id+', '+Math.round(dist(a,t))+' tiles'+(taken(a,t)?', taken':'')+')').join(', ')+'.':(free?'No free foe is in sight.':'No foe is in sight.')};
// A companion named or numbered by the agent: a hero (any id, as before), a name in sight, or null.
function friendBy(a,id,name){const i=idIn(id);if(i!=null)return i===a.id?a:hero(i);const n=nameKey(name!=null&&name!==''?name:id);if(!n)return null;
  if(n==='me'||n==='self'||n==='myself'||n==='you'||n===a.name.toLowerCase())return a;const L=friendsInSight(a);
  return L.find(b=>b.name.toLowerCase()===n)||L.find(b=>b.name.toLowerCase().split(' ')[0]===n)||L.find(b=>b.name.toLowerCase().startsWith(n))||null}
// A foe named or numbered by the agent: any id (checked for sight later, as before), or the nearest in sight by the name the hero knows it by.
function foeBy(a,id,name){const i=idIn(id);if(i!=null)return findTarget(i);const n=nameKey(name!=null&&name!==''?name:id);if(!n)return null;const L=foesInSight(a),nm=t=>nameKey(foeName(a,t));
  return L.find(t=>nm(t)===n&&!taken(a,t))||L.find(t=>nm(t)===n)||L.find(t=>nm(t).includes(n)&&!taken(a,t))||L.find(t=>nm(t).includes(n))||null}
const givenAs=(id,name)=>{const v=name!=null&&name!==''?name:id;return v==null||v===''?'':' "'+clean(String(v),40)+'"'};

// ---- what the hero is doing, for the card and the tools ----
function doingText(a,adv,cmd){
  if(a.state==='fight'&&a.target)return 'Fighting '+foeName(a,a.target);
  if(cmd){if(cmd.kind==='move')return (cmd.flee?'Fleeing to ':'Walking to ')+cmd.label;
    if(cmd.kind==='hunt')return 'Hunting in '+ZONES[zoneAt(a.x,a.y)]+' ('+Math.max(0,cmd.n-(cmd.k0==null?0:a.kills-cmd.k0))+' to go)';
    if(cmd.kind==='rest')return 'Resting';
    if(cmd.kind==='gather')return 'Gathering at a '+String(cmd.label||'node').toLowerCase();
    if(cmd.kind==='fight')return 'Closing on a foe';
    if(cmd.kind==='follow'){const f=followLine(a);return f?f[0].toUpperCase()+f.slice(1):'Following '+cmd.name}}
  if(adv){if(adv.stage==='choose')return 'Weighing a choice on '+adv.title;return 'On an adventure: '+adv.title}
  if(a.state==='town')return 'Waiting in '+homeOf(a).name;
  if(a.state==='hunt')return 'Standing watch in '+ZONES[zoneAt(a.x,a.y)];
  if(a.state==='return')return 'Heading back to '+homeOf(a).name;
  return null}

// ---- places ----
const SPOT_ALIASES={'auction house':'ah','ah':'ah','market':'ah','quest giver':'qg','questgiver':'qg','quests':'qg','gate':'gate','graveyard':'grave','grave':'grave'};
function townSpot(c,name){const k=SPOT_ALIASES[name];if(k&&c[k])return {x:c[k].x,y:c[k].y,label:name};
  if(c.spots&&c.spots[name])return {x:c.spots[name].x,y:c.spots[name].y,label:'the '+name};
  ensureNpcs();const p=(S.npcs||[]).find(p=>p.town===c.name&&(p.name.toLowerCase()===name||p.role===name||p.title.toLowerCase()===name||(p.title+' '+p.name).toLowerCase()===name));
  if(p)return {x:p.x,y:p.y+.6,label:p.title+' '+p.name};return null}
const enemyNear=(a,p,r=12)=>CITY.some(c=>c.fac!==a.fac&&(dist(p,c.gate)<r||inRect(c,p,2)));
// Resolve a move_to target into legs, or {error}. Tool quick wins (#399): the target is read the way the game wrote it
// ("gate in Highgate", "the inn", "Lowmark (home)", "(4, 5)", "Highgate (town; Lowmark around it)"), a known region inside longer
// words ("Lowmark Forest"), the world's own name, or a companion in sight; an unknown place gets the nearest name the hero knows.
// Only places this hero knows are ever named back to it (#188).
function plan(a,target){const raw=clean(target,60),t0=raw.toLowerCase().trim();
  if(!t0)return {error:'Say where to go.'};
  for(const v of placeVariants(a,t0)){const r=planOne(a,v.t,v.town);if(r){if(v.note&&!r.error)r.note=v.note;return r}}
  return placeFallback(a,t0,raw)||{error:unknownPlace(a,t0,raw)}}
const SPOT_WORDS={blacksmith:'smith',smithy:'smith',forge:'smith',armorer:'smith',armourer:'smith',tanner:'smith',tavern:'inn',innkeeper:'inn',temple:'chapel',church:'chapel',shrine:'chapel',plaza:'square',gates:'gate','town gate':'gate','main gate':'gate','city gate':'gate',auctioneer:'auction house'};
const TOWN_SPOTS=['gate','inn','smith','chapel','square','auction house','quest giver'];
const spotWord=x=>{x=x.trim().replace(/^the\s+/,'');return SPOT_WORDS[x]||(/^(?:town|market|main|village|city)?\s*square$/.test(x)?'square':x)};
// The ways an agent writes a place, most literal first: as given, without a trailing "(...)", without "the"/"town", a spot word,
// and "<spot> in|of|at <town>" or "<town> <spot>" (a friendly town that is not home: its gate).
function placeVariants(a,t0){const out=[],seen=new Set(),add=(t,town)=>{t=String(t||'').trim();const k=t+'|'+(town?town.name:'');if(t&&!seen.has(k)){seen.add(k);out.push({t,town})}};
  add(t0);const p=/^\((.+)\)$/.exec(t0);let s=p?p[1].trim():t0.replace(/\s*\([^)]*\)\s*$/,'').trim();add(s);
  s=s.replace(/[.!?]+$/,'').replace(/^(?:to|towards?|into)\s+/,'');for(let i=0;i<3;i++)s=s.replace(/^(?:the|a|an|town|main|market|village|city)\s+(?=\S)/,'');add(s);
  add(spotWord(s));
  const c=homeOf(a),m=/^(.+?)\s+(?:in|of|at|near)\s+(?:the\s+)?(.+)$/.exec(s);
  if(m){const tn=CITY.find(x=>x.name.toLowerCase()===m[2]),zn=ZONES.findIndex(n=>n&&n.toLowerCase()===m[2]);
    if(tn&&tn===c)add(spotWord(m[1]));else if(tn&&tn.fac===a.fac)add(spotWord(m[1]),tn);else if(tn)add(tn.name.toLowerCase());else if(zn>=0)add(m[1])}
  for(const tn of CITY){const n=tn.name.toLowerCase();if(s.startsWith(n+' ')&&s.length>n.length+1){const rest=spotWord(s.slice(n.length+1));if(tn===c)add(rest);else if(tn.fac===a.fac)add(rest,tn);else add(n)}}
  return out}
// Names the hero knows to go to (#188): known regions and landmarks, friendly towns.
function knownNames(a){const L=a.lore&&a.lore.p?Object.keys(a.lore.p):ZONES.filter(Boolean);return [...new Set([...L,...CITY.filter(x=>x.fac===a.fac).map(x=>x.name)])]}
const reEsc=s=>s.replace(/[.*+?^$\x7b}()|[\]\\]/g,'\\$&');
// What the target could still mean: a known place inside longer words, the world's name, a companion in sight.
function placeFallback(a,t,raw){const c=homeOf(a);
  const hit=knownNames(a).filter(n=>n&&new RegExp('(^|[^a-z])'+reEsc(n.toLowerCase())+'($|[^a-z])').test(t)).sort((x,y)=>y.length-x.length)[0];
  if(hit){const r=planOne(a,hit.toLowerCase());if(r&&!r.error){r.note='Read "'+raw+'" as '+hit+'.';return r}if(r)return r}
  if(/\b(eldmoor|stepping lands?)\b/.test(t)||/^(?:the\s+)?(?:world|land|lands|realm|wilds|wilderness|countryside|outside)$/.test(t)){
    const hz=ZONES[zoneAt(c.gate.x,c.gate.y)],r=hz&&knowsPlace(a,hz)?planOne(a,hz.toLowerCase()):null;
    const also=knownNames(a).filter(n=>n!==hz&&n!==c.name).slice(0,6);
    if(r&&!r.error){r.note='"'+raw+'" is the whole land, not one place: you set out for '+hz+', the country around '+c.name+'.'+(also.length?' Other places you know: '+also.join(', ')+'.':'');return r}
    return {error:'"'+raw+'" is the whole land, not one place. Name a place you know ('+knownNames(a).slice(0,8).join(', ')+'), a direction ("north") or "x,y".'}}
  const who=t.replace(/^(?:follow|join|meet|find|with|go to|walk to)\s+/,'').replace(/^the\s+/,'').trim(),mates=a.party?a.party.mem.filter(b=>b!==a&&b.state!=='dead'):[];
  let b=null;if(/^(?:follow|leader|party leader|party|fellowship|group|companions?|friends?)$/.test(who))b=a.party&&a.party.leader!==a&&a.party.leader.state!=='dead'?a.party.leader:mates.slice().sort((x,y)=>dist(a,x)-dist(a,y))[0]||null;
  else b=mates.find(x=>x.name.toLowerCase()===who||x.name.toLowerCase().split(' ')[0]===who)||null;
  if(b){if(b.hidden||dist(a,b)>sightOf(a))return {error:b.name+' is not in sight, so you cannot walk to them. party_say to ask where they are'+(a.party&&a.party.leader===b?', or wait for their lead_to':'')+'; or move_to a place you know.'};
    const p={x:b.x,y:b.y},ct=cityAt(p),here=inTown(a),home=ct&&ct===c;
    const legs=home?(here?[{x:p.x,y:p.y,st:'town'}]:[{x:c.gate.x,y:c.gate.y,st:'return'},{x:p.x,y:p.y,st:'town'}]):here?[{x:c.gate.x,y:c.gate.y,st:'town'},{x:p.x,y:p.y,st:'travel'}]:[{x:p.x,y:p.y,st:'travel'}];
    return {legs,last:home?'town':'hunt',label:'where '+b.name+' stands',note:'You walk to where '+b.name+' is now ('+Math.round(dist(a,b))+' tiles); they may move on.'}}
  return null}
const lev=(x,y)=>{const m=x.length,n=y.length;if(!m||!n)return m+n;let p=Array.from({length:n+1},(_,j)=>j);for(let i=1;i<=m;i++){const q=[i];for(let j=1;j<=n;j++)q[j]=Math.min(p[j]+1,q[j-1]+1,p[j-1]+(x[i-1]===y[j-1]?0:1));p=q}return p[n]};
// The refusal for a place nobody can find: the nearest name the hero knows first, then the short list.
function unknownPlace(a,t,raw){const c=homeOf(a),cands=[...knownNames(a),...TOWN_SPOTS,'home'];
  const s=t.replace(/\s*\([^)]*\)\s*$/,'').replace(/^(?:the|a|an)\s+/,'');let best=null,bd=1e9;
  for(const n of cands){const k=n.toLowerCase();const d=k.length>2&&(k.includes(s)||s.includes(k))?Math.abs(k.length-s.length)/4:lev(s,k);if(d<bd){bd=d;best=n}}
  const close=best&&bd<=Math.max(2,Math.floor(s.length/3));
  return 'Unknown place "'+raw+'".'+(close?' Did you mean "'+best+'"?':'')+' Places you know: '+(placesView(a).slice(0,8).join(', ')||'none yet')+'. In '+c.name+': '+TOWN_SPOTS.join(', ')+', or "home". Or a direction ("north", "explore east") or "x,y".'}
// Hunting grounds the hero knows (#411): known regions, nearest first (the closest spawn point, sampled; no dice).
function huntGrounds(a){const out=[];for(let z=0;z<ZONES.length;z++){const n=ZONES[z],L=ZPTS[z];if(!n||!L||!L.length||!knowsPlace(a,n))continue;
    let bd=Infinity;const st=Math.max(1,Math.floor(L.length/60));for(let i=0;i<L.length;i+=st){const d=Math.hypot(L[i].x-a.x,L[i].y-a.y);if(d<bd)bd=d}out.push([n,bd])}
  return out.sort((x,y)=>x[1]-y[1]).map(x=>x[0])}
const toFieldOf=(a,p,label)=>{const c=homeOf(a);return {legs:inTown(a)?[{x:c.gate.x,y:c.gate.y,st:'town'},{x:p.x,y:p.y,st:'travel'}]:[{x:p.x,y:p.y,st:'travel'}],last:'hunt',label}};
function planOne(a,t,inT){const c=homeOf(a),here=inTown(a);
  if(inT){if(!(t==='town'||t==='home'||SPOT_ALIASES[t]||TOWN_SPOTS.includes(t)||inT.spots&&inT.spots[t]))return null;
    return toFieldOf(a,{x:inT.gate.x,y:inT.gate.y},'the gate of '+inT.name)}
  const toTown=(p,label)=>({legs:here?[{x:p.x,y:p.y,st:'town'}]:[{x:c.gate.x,y:c.gate.y,st:'return'},{x:p.x,y:p.y,st:'town'}],last:'town',label});
  const toField=(p,label)=>({legs:here?[{x:c.gate.x,y:c.gate.y,st:'town'},{x:p.x,y:p.y,st:'travel'}]:[{x:p.x,y:p.y,st:'travel'}],last:'hunt',label});
  if(t==='home'||t==='town'||t===c.name.toLowerCase()){const p=c.spots&&c.spots.square||c.ah;return toTown(p,c.name)}
  const sp=townSpot(c,t);if(sp)return toTown(sp,sp.label+' in '+c.name);
  // Places by name only when this hero knows them: its home region, where it has been, what it saw or was told (#188).
  const unknown=n=>({error:'You have never been to '+n+' nor heard of it. Ask around (talk, the town criers, your companions), or explore a direction ("north", "east", ...) or "x,y".'});
  const z=ZONES.findIndex(n=>n.toLowerCase()===t);
  if(z>=0){if(!knowsPlace(a,ZONES[z]))return unknown(ZONES[z]);let p=zonePoint(z,null,c.gate);for(let i=0;i<8&&enemyNear(a,p);i++)p=zonePoint(z,null,c.gate); // a region around both towns (#411): pick again, away from the enemy wall
    if(enemyNear(a,p))return {error:'That part of '+ZONES[z]+' is under an enemy town wall.'};
    const r=toField(p,ZONES[z]);const w=placeMemory(a,ZONES[z]);if(w)r.warn=w;return r}
  if(t==='crypt'||t===CRYPT.name.toLowerCase()||t==='the crypt'){if(!knowsPlace(a,CRYPT.name))return unknown(CRYPT.name);const r=toField({x:CRYPT.x,y:CRYPT.y+1.4},CRYPT.name+' (the entrance)');const w=placeMemory(a,CRYPT.name);if(w)r.warn=w;return r}
  const op=OUTPOSTS.find(o=>o.name.toLowerCase()===t);
  if(op){if(!knowsPlace(a,ZONES[op.z])&&dist(a,op)>30)return unknown(op.name);return toField({x:op.x,y:op.y},op.name)}
  const lm=LANDMARKS.find(l=>l.name.toLowerCase()===t||l.kind===t);
  if(lm){if(!knowsPlace(a,lm.name))return unknown(lm.kind==='lair'?'that lair':lm.name);const r=toField({x:lm.x,y:lm.y+(lm.r||1)+1},lm.name);if(lm.kind==='lair')r.warn='That is the lair of Kragmaw the Cinder Wyrm. Few who go there come back.';return r}
  const ow=markAt(a,t);if(ow){const r=toField({x:ow.x,y:ow.y},ow.name);if(ow.warn)r.warn=ow.warn;return r} // a place the hero marked or was told of (#632)
  const dp=knownMark(a,t);if(dp){const r=toField({x:dp.x,y:dp.y},dp.name);const w=placeMemory(a,dp.name);if(w)r.warn=w;return r} // a DM place it knows (#423)
  const town=CITY.find(x=>x.name.toLowerCase()===t);
  if(town){if(town.fac!==a.fac)return {error:town.name+' is an enemy town. You would not leave it alive.'};return toField({x:town.gate.x,y:town.gate.y},'the gate of '+town.name)}
  // Exploring (#188): a direction walks about LORE.DIR tiles that way, into whatever lies there.
  const dm=/^(?:explore|go|head|walk)?\s*(north|south|east|west|north-?east|north-?west|south-?east|south-?west)(?:\s+(\d+))?$/.exec(t);
  if(dm){const k=dm[1].replace('-',''),v=DIRS[k],far=Math.min(40,Math.max(4,Number(dm[2])||LORE.DIR)),n=Math.hypot(v[0],v[1]);
    for(let d=far;d>=3;d-=3){const p={x:Math.max(1.5,Math.min(W-2.5,a.x+v[0]/n*d)),y:Math.max(1.5,Math.min(H-2.5,a.y+v[1]/n*d))};
      if(dist(a,p)<2.5)break;if(enemyNear(a,p)||cityAt(p))continue;const r=toField(p,k+' (about '+Math.round(dist(a,p))+' tiles)');r.explore=true;return r}
    return {error:'You cannot go '+k+' from here: the edge of the world or an enemy town wall is that way.'}}
  const m=/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(t);
  if(m){const p={x:+m[1],y:+m[2]};if(!(p.x>=1&&p.y>=1&&p.x<W-1&&p.y<H-1))return {error:'That is off the map (0-'+W+', 0-'+H+').'};
    if(enemyNear(a,p))return {error:'That is under an enemy town wall.'};
    const ct=cityAt(p);if(ct&&ct===c)return toTown(p,'('+p.x+', '+p.y+') in '+c.name);
    return toField(p,'('+p.x+', '+p.y+') in '+(ZONES[zoneAt(p.x,p.y)]||'the wilds'))}
  const mk=markInSight(a,t);if(mk)return toField({x:mk.x,y:mk.y},mk.name); // a DM-marked place in sight (#414)
  const named=placeNameIn(t);if(named)return unknown(named);
  return null}
// ---- walking into danger (issue #465) ----
// A walk (move_to, hunt {where}) whose road crosses into a region whose lowest level is TP.DANGER or more above the hero's stops
// at its edge the first time, with the danger in words (the land's feel, the hero's own lore, what townsfolk say). Maximum
// agency (owner): never a hard block; the same call again, or force: "yes", walks on. Read-only and dice-free.
const FEEL={meadow:'even the meadow beasts here move like hunters',fen:'the air turns to rot and the things in the reeds are huge',ash:'ash drifts on a hot wind and the beasts here are scarred and huge',
  tundra:'the wind brings a bitter cold, and the tracks in the snow are bigger than you are',highland:'the wind howls over bare stone, and something up there has been feeding well'};
// The first point of the walk that enters such a region: {z, li (the leg), stop (the last safe point before it)}, or null.
function dangerAhead(a,legs){const here=zoneAt(a.x,a.y);let px=a.x,py=a.y,safe={x:a.x,y:a.y};
  for(let li=0;li<legs.length;li++){const l=legs[li],k=Math.max(1,Math.ceil(Math.hypot(l.x-px,l.y-py)));
    for(let i=1;i<=k;i++){const x=px+(l.x-px)*i/k,y=py+(l.y-py)*i/k;
      if(l.st!=='town'){const z=zoneAt(x,y),b=bandOf(z);if(z!==here&&b&&b[0]>=a.lvl+TP.DANGER)return {z,li,stop:safe}}
      safe={x,y}}
    px=l.x;py=l.y}
  return null}
function dangerWords(a,z){const n=ZONES[z],known=knowsPlace(a,n),b=bandOf(z),R=REGIONS[z];
  const feel=FEEL[R&&R.biome]||'the beasts here look far beyond you',worse=b[0]-a.lvl>=10;
  const lw=known?placeWarn(a,n):null,tw=npcWarning(a);
  return (known?n:'The land ahead')+': '+feel+'. '+(worse?'Nothing there would even notice a blade of your strength before it killed you.':'The beasts there look far beyond you.')
    +(lw?' What you know: '+lw:'')+(tw&&known&&tw.startsWith(n)?' The townsfolk said: "'+tw+'"':'')+' Hardcore: one life.'}
const forceYes=f=>f===true||/^(yes|true|1|force)$/i.test(String(f==null?'':f).trim());
// Check a planned walk. Returns {p} to go as planned (p.warn may be set), {p, stopped} with the walk cut at the edge, or {refuse}.
function guardWalk(a,p,force){const dz=dangerAhead(a,p.legs);if(!dz)return {p};const n=ZONES[dz.z],known=knowsPlace(a,n),words=dangerWords(a,dz.z);
  const D=a.playDare;if(forceYes(force)||D&&D.z===dz.z&&S.gameMin-D.t<=TP.DARE_MIN){p.warn=(p.warn?p.warn+' ':'')+'You go on into '+(known?n:'the land ahead')+' knowing the danger: '+words;return {p}}
  a.playDare={z:dz.z,t:S.gameMin};const again=' To go on anyway, make the same call again (or add force: "yes").';
  const legs=p.legs.slice(0,dz.li),st=p.legs[dz.li].st;
  if(!legs.length&&dist(a,dz.stop)<1.5)return {refuse:'You stand at the edge. '+words+again};
  legs.push({x:dz.stop.x,y:dz.stop.y,st});
  return {p:{...p,legs,last:'hunt',label:'the edge of '+(known?n:'the land ahead'),warn:'You stop at the edge. '+words+again},stopped:true}}
// Walking away from a party leader that will not follow: say so, with who will be out of earshot (#465, companies of any size).
function apartNote(a,p){const L=a.party&&a.party.leader!==a&&a.party.leader.state!=='dead'?a.party.leader:null;if(!L)return null;
  const end=p.legs[p.legs.length-1];if(!end||dist(end,L)<=REACH.SHOUT)return null;
  const mates=a.party.mem.filter(b=>b!==a&&b.state!=='dead');
  return 'This takes you away from '+nameList(mates)+': '+L.name+' leads and will not follow, and past about '+REACH.SHOUT+' tiles they cannot hear you. Out there, every fight is yours alone.'}
const DIRS={north:[0,-1],south:[0,1],east:[1,0],west:[-1,0],northeast:[1,-1],northwest:[-1,-1],southeast:[1,1],southwest:[-1,1]};
// A place name the agent used that the world has but the hero has not heard of (so the refusal does not confirm others).
const placeNameIn=t=>{const n=[...LANDMARKS.map(l=>l.name),CRYPT&&CRYPT.name].filter(Boolean).find(x=>x.toLowerCase()===t);return n||null};

// ---- places (#414): the places this hero knows, nearest first, with direction, distance and what it learned there ----
// Read only and dice-free. Only the hero's known set (the same knownNames move_to and hunt resolve, #188/#399/#411) plus
// a DM-marked place it can see right now; never DM notes, lever reasons or numbers it could not know.
const COMPASS=['east','southeast','south','southwest','west','northwest','north','northeast'];
const compass=(dx,dy)=>Math.hypot(dx,dy)<1.5?'here':COMPASS[((Math.round(Math.atan2(dy,dx)/(Math.PI/4))%8)+8)%8];
const PL={MAX:12,MIN_PER_TILE:3}; // rough game minutes a tile on foot (roads faster, marsh and snow slower)
const walkTime=d=>{const m=d*PL.MIN_PER_TILE;return d<1.5?'you are there':m<50?'under an hour on foot':m<90?'about an hour on foot':'about '+Math.round(m/60)+' hours on foot'};
// DM-marked places (mark_place) the hero sees with its own eyes now; move_to takes them by name while in sight.
const markInSight=(a,name)=>(S.places||[]).find(p=>p&&p.name&&(name==null||p.name.toLowerCase()===name)&&dist(a,p)<=sightOf(a))||null;
function knownPlaces(a,from){const L=a.lore&&a.lore.p?a.lore.p:null,c=homeOf(a),out=[];
  const at=(name,kind,p,how,go)=>{const dx=p.x-from.x,dy=p.y-from.y,d=Math.hypot(dx,dy);out.push({name,kind,how,dir:compass(dx,dy),tiles:Math.round(d),travel:walkTime(d),go:go||name})};
  for(const name of knownNames(a)){
    const town=CITY.find(x=>x.name===name);if(town){at(name,'town',town.gate,town===c?'your home town':'a town of your people');continue}
    const p=L&&L[name],how=!p?'you know of it':p.how==='home'?'your home region':p.how==='been'?'you have been there':p.how==='seen'?'you have seen it':'only heard of it';
    const z=ZONES.indexOf(name);
    if(z>=0){const pts=ZPTS[z]||[];let best=null,bd=Infinity;const st=Math.max(1,Math.floor(pts.length/60));
      for(let i=0;i<pts.length;i+=st){const d=Math.hypot(pts[i].x-from.x,pts[i].y-from.y);if(d<bd){bd=d;best=pts[i]}}
      if(zoneAt(from.x,from.y)===z)best={x:from.x,y:from.y};if(!best)continue;at(name,'region',best,how);continue}
    if(p&&p.mk&&p.x!=null){at(name,'mark',p,markHow(p));continue} // yours, or told by a companion (#632)
    const lm=LANDMARKS.find(l=>l.name===name)||(CRYPT&&CRYPT.name===name?CRYPT:null);
    if(lm){at(lm.kind==='lair'?name+"'s lair":name,'landmark',lm,how,name);continue}
    const mk=p&&p.dm!=null?(S.places||[]).find(x=>x.id===p.dm):null;if(mk)at(name,'place',mk,how)} // a DM place it learned (#423)
  for(const m of (S.places||[]))if(m&&m.name&&dist(a,m)<=sightOf(a)&&!out.some(x=>x.name===m.name))at(m.name,'place',m,'in sight now: '+(m.kind||'a marked place'));
  return out}
function placesList(a,{about,kind,near}={}){const L=loreOf(a);
  let from=a,fromLabel='where you stand';const nr=clean(near,60).trim();
  if(nr){const all=knownPlaces(a,a),q=nr.toLowerCase().replace(/^(?:the)\s+/,''),m=/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(nr);
    if(m)from={x:+m[1],y:+m[2]};
    else{const hit=all.find(x=>x.name.toLowerCase()===q||x.go.toLowerCase()===q)||all.find(x=>x.name.toLowerCase().includes(q));
      if(!hit)return {ok:false,error:'You know no place called "'+nr+'". Places you know: '+all.map(x=>x.name).slice(0,10).join(', ')+'.'};
      const town=CITY.find(x=>x.name===hit.go),lm=LANDMARKS.find(l=>l.name===hit.go)||(CRYPT&&CRYPT.name===hit.go?CRYPT:null),z=ZONES.indexOf(hit.go),mk=markInSight(a,hit.go.toLowerCase());
      from=town?town.gate:lm?lm:mk?mk:z>=0&&ZPTS[z]&&ZPTS[z].length?ZPTS[z][Math.floor(ZPTS[z].length/2)]:a;fromLabel=hit.name}
    if(m)fromLabel='('+from.x+', '+from.y+')'}
  let list=knownPlaces(a,from);
  // what the hero learned there, in its own words (lore.js placeLine via placeWarn; creatures by the lore's own lines)
  const lv=loreView(a),keys=Object.keys(L.c);
  for(const x of list){const w=placeWarn(a,x.go);if(w)x.learned=w.slice(x.go.length+2).replace(/\.$/,'');
    const z=ZONES.indexOf(x.go);if(z>=0){x.word=jobRumour(a,z);const cs=[];keys.forEach((k,i)=>{const e=L.c[k];if(e&&e.z&&e.z.includes(x.go)&&lv.creatures[i])cs.push(lv.creatures[i].threat&&lv.creatures[i].threat!=='only heard of'?lv.creatures[i].name+' ('+lv.creatures[i].threat+')':lv.creatures[i].name)});if(cs.length)x.creatures=cs.slice(0,6)}
    if(x.kind==='landmark'&&LANDMARKS.some(l=>l.kind==='lair'&&l.name===x.go))x.learned=(x.learned?x.learned+'; ':'')+'the lair of Kragmaw the Cinder Wyrm: few who go there come back'}
  const k=clean(kind,20).toLowerCase().trim().replace(/s$/,'');
  if(k){const kk=k==='city'||k==='home'?'town':k==='dungeon'||k==='crypt'||k==='lair'?'landmark':k==='marker'||k==='spot'?'place':k;
    if(!['town','region','landmark','place','mark'].includes(kk))return {ok:false,error:'kind is one of town, region, landmark, place (a marked spot in sight) or mark (yours and told).'};list=list.filter(x=>x.kind===kk)}
  const q=clean(about,60).toLowerCase().trim();
  if(q)list=list.filter(x=>x.name.toLowerCase().includes(q)||x.kind===q||(x.learned||'').toLowerCase().includes(q)||(x.creatures||[]).some(s=>s.toLowerCase().includes(q)));
  list.sort((x,y)=>x.tiles-y.tiles||(x.name<y.name?-1:1));const total=list.length;list=list.slice(0,PL.MAX);
  const r={ok:true,from:fromLabel,places:list.map(x=>{const o={name:x.name,kind:x.kind,known:x.how,way:x.dir==='here'?'here':x.dir+', '+x.tiles+' tiles ('+x.travel+')'};
    if(x.word)o.word=x.word;if(x.creatures)o.creatures=x.creatures;if(x.learned)o.learned=x.learned;if(x.go!==x.name)o.go=x.go;return o})};
  if(total>list.length)r.more=total-list.length+' more (filter with kind, about or near)';
  if(!list.length)r.note=q||k?'No place you know fits that. places with no arguments lists all you know.':'You know no places yet.';
  r.use='move_to or hunt {where} takes any name here (or its go); a direction ("north") or "x,y" reaches places you have never heard of.';
  return r}

// ---- the tools ----
// ---- shop (#424): what the smiths or a trader sell, read only (no dice, no change to gold, stock or the pack) ----
// Smith prices are the buy tool's own sources (USES[id].price, SHOP_COST(level)); a trader's prices come from npcBuy itself,
// priced by talk.js's own rule (tradePrice, the one npcBuy charges by).
const traderPrice=(a,p,args)=>tradePrice(p,args.item?USES[args.item].price:SHOP_COST(a.lvl));
const pts=(n,w)=>(n>0?'+':'')+n+' '+w;
// One slot's line: the piece buy would put there (item level = your level, plain, sometimes fine) against what you wear.
// The change is the new piece's armor and damage minus the worn one's, the same numbers equip swaps.
function shopSlot(a,k,cost){const cur=a.slots&&a.slots[k],wear=cur?itemText(cur):'nothing';
  if(cur&&cur.epic)return {slot:k,wearing:wear,offer:null,note:'An epic holds this slot; nothing for sale beats it.'};
  if(slotLevel(a,k)>=a.lvl)return {slot:k,wearing:wear,offer:null,note:'You wear item level '+slotLevel(a,k)+'; gear is sold only at your level, so the next piece needs level '+(slotLevel(a,k)+1)+'.'};
  const ar=itemArmor(a.cls,k,a.lvl),dm=itemDamage(a.cls,k,a.lvl),c=itemStats(cur),da=ar-(c.armor||0),dd=dm-(c.damage||0),ch=[];
  if(ar||c.armor)ch.push(pts(da,'armor')+' ('+(c.armor||0)+' -> '+ar+')');if(dm||c.damage)ch.push(pts(dd,'damage')+' ('+(c.damage||0)+' -> '+dm+')');
  const word=(da>0||dd>0)&&da>=0&&dd>=0?'better':(da<0||dd<0)&&da<=0&&dd<=0?'worse':ch.length?'mixed':'no armor or damage on this slot';
  return {slot:k,wearing:wear,offer:'item level '+a.lvl+' (plain, sometimes fine: 15% more)',price:cost,change:word+(ch.length?': '+ch.join(', '):''),
    afford:a.gold>=cost?'yes':'no ('+(cost-a.gold)+'g short)',buy:'buy {slot: "'+k+'"}'}}
function shopUse(a,id,price){const U=USES[id],o={item:id,price,level:U.lvl,kind:U.kind,buy:'buy {item: "'+id+'"}'};
  if(U.lvl>a.lvl)o.needs='needs level '+U.lvl;else if(U.kind==='pack'&&invOf(a).pack)o.needs='you already carry one';else if(a.gold<price)o.needs=(price-a.gold)+'g short';
  const L=useLines(id);if(L.length)o.does=L.map(x=>x[1]).join('; ');return o}
function shopView(a,tr,all){const out={ok:true,gold:a.gold,pack:used(a)+'/'+capOf(a)},weak=a.slots?weakestSlot(a):null;need(a.slots,'You have no gear slots to shop for.');
  if(tr){const st=stockOf(tr);out.from=(tr.title?tr.title+' ':'')+tr.name;out.where='trade open with you nearby';
    out.supplies=st.filter(x=>x!=='gear'&&USES[x]).map(x=>{const v=shopUse(a,x,traderPrice(a,tr,{item:x}));v.buy='buy {npc: "'+tr.name+'", item: "'+x+'"}';return v});
    if(st.includes('gear')){const cost=traderPrice(a,tr,{slot:SLOTS[0]});out.gear=SLOTS.map(k=>{const v=shopSlot(a,k,cost);if(v.buy)v.buy='buy {npc: "'+tr.name+'", slot: "'+k+'"}';return v})}
    else out.gear='No gear: '+out.from+' sells supplies only.';
  }else{const c=homeOf(a),cost=SHOP_COST(a.lvl);out.from='the smiths and quartermaster of '+(c?c.name:'town');
    out.gear=SLOTS.map(k=>shopSlot(a,k,cost));out.supplies=Object.keys(USES).map(x=>shopUse(a,x,USES[x].price))}
  if(Array.isArray(out.gear)&&weak&&out.gear.some(g=>g.slot===weak&&g.buy))out.note='buy with no slot fills your weakest slot, '+weak+'. Gear bought is worn at once; what it replaces goes to your pack.';
  return all?out:shopBrief(out,tr)}
// The short answer (#425; the full one is about 1.5k tokens): only the gear that would help you and the supplies you may buy now.
function shopBrief(out,tr){const o={ok:true,from:out.from,gold:out.gold,pack:out.pack};if(out.where)o.where=out.where;
  if(Array.isArray(out.gear)){const good=out.gear.filter(g=>g.buy&&/^(better|mixed)/.test(g.change||''));
    o.gear=good.length?good.map(g=>({slot:g.slot,price:g.price,change:g.change,...(g.afford==='yes'?{}:{short:g.afford.replace(/^no \((.*)\)$/,'$1')})})):'Nothing on offer is better than what you wear.';
    const rest=out.gear.filter(g=>!good.includes(g)).map(g=>g.slot);if(good.length&&rest.length)o.no_better_for=rest.join(', ')}
  else o.gear=out.gear;
  o.supplies=out.supplies.filter(x=>!/^needs level|already carry/.test(x.needs||'')).map(x=>({item:x.item,price:x.price,...(x.does?{does:x.does.split('; ')[0]}:{}),...(x.needs?{short:x.needs}:{})}));
  const by=tr?'npc: "'+tr.name+'", ':'';
  o.how='buy {'+by+'slot: "<slot>"} for gear, buy {'+by+'item: "<name>", count: N} for supplies. shop {'+by+'all: "yes"} lists every slot, what you wear and the locked supplies.';
  if(out.note)o.note=out.note;return o}
const need=(cond,msg)=>{if(!cond)throw new Rule(msg)};
class Rule extends Error{}
const fieldState=a=>['hunt','travel','follow','return'].includes(a.state);

// ---- inspect (#425): one person, creature or item, the way this hero perceives it. Read only: no dice, no change to the
// world (a creature seen for the first time is sized up, as look does). Never a number for anyone else's HP, never a
// creature's level, and nothing of another hero's persona, memories, mind or journal, nor a person's DM record.
const HURT=(h,m)=>{const r=m>0?h/m:1;return r>=.95?'unhurt':r>=.7?'lightly hurt':r>=.4?'hurt':r>=.15?'badly hurt':'near death'};
const ST_WORD={town:'in town',travel:'on the road',hunt:'out hunting',return:'heading home',follow:'following their party',regroup:'regrouping with their party',camp:'at camp',dungeon:'down in a dungeon',raid:'on a raid',ghost:'a pale ghost, walking to the graveyard'};
const fullName=p=>(p.title?p.title+' ':'')+p.name;
const gearWord=it=>it.name+' ('+it.slot+(it.epic?', epic':it.quality&&it.quality!=='plain'?', '+it.quality:'')+')';
// Who and what is in sight now, nearest first: the look rule (sight radius; the whole town square inside a town).
function inSight(a){const R=sightOf(a),here=inTown(a)?homeOf(a):null,vis=p=>dist(a,p)<=R||!!(here&&inRect(here,p,1)),out=[];
  for(const b of nearHeroes(a.x,a.y,here?Math.max(R,Math.hypot(here.w,here.h)):R))if(b!==a&&!b.hidden&&b.state!=='dead'&&vis(b))out.push({kind:'hero',e:b,name:b.name});
  ensureNpcs();for(const p of [...(S.npcs||[]),...(S.wanderers||[])])if(Number.isFinite(p.x)&&Number.isFinite(p.y)&&(here&&p.town===here.name||dist(a,p)<=R))out.push({kind:'person',e:p,name:fullName(p)});
  for(const m of nearMobs(a.x,a.y,R))if(alive(m)&&!m.hidden&&dist(a,m)<=R)out.push({kind:'creature',e:m,name:foeName(a,m)});
  return out.sort((x,y)=>dist(a,x.e)-dist(a,y.e))}
const sightLine=(a,L)=>L.length?'In sight: '+L.slice(0,8).map(c=>c.name+(c.kind==='person'?' ('+c.e.role+')':' (id '+c.e.id+')')).join(', ')+(L.length>8?' and '+(L.length-8)+' more':'')+'.':'Nobody and nothing is in sight.';
function heroDoing(a,b){const t=b.target&&alive(b.target)?(b.target===a?'you':foeName(a,b.target)):null;
  if(b.state==='fight')return 'fighting'+(t?' '+t:'');if(b.state==='duel')return 'in a duel'+(t?' with '+t:'');if(b.state==='assist')return 'helping someone in a fight';
  if(b.state==='town'&&b.moving)return 'walking through town';return ST_WORD[b.state]||b.state}
function heroLook(a,b){const self=b===a,o={ok:true,kind:'hero',name:b.name,...(titleOf(b)?{known_as:styled(b)}:{}),who:raceOf(b).name+' '+b.cls+', level '+b.lvl,
    faction:FAC[b.fac].name+(self?'':b.fac===a.fac?' (your side)':' (the other side: they may attack you)'),looks:HURT(b.hp,maxHp(b)),doing:heroDoing(a,b)};
  if(b.guild)o.guild='<'+b.guild.tag+'> '+b.guild.name;
  if(inSlots(b)&&slotKeyOf(b)){const L={tank:'Tank',healer:'Healer'}[slotKeyOf(b)]||'DPS';o.fellowship='of the Fellowship ('+L+')'}
  const w=SLOTS.map(k=>b.slots&&b.slots[k]).filter(Boolean).map(gearWord);o.wears=w.length?w:'plain clothes, no gear to speak of';
  if(self){o.note='This is you. status has your numbers, inventory your pack.';return o}
  o.distance=r1(dist(a,b))+' tiles';const ties=[];
  if(a.party&&b.party===a.party)ties.push(a.party.leader===b?'in your party (leads it)':'in your party');
  if(a.nemesis&&a.nemesis[b.id])ties.push('a blood debt: you are sworn to pay them back');
  if(metIds(a).includes(b.id))ties.push('you have spoken with them');
  o.to_you=ties.length?ties.join('; '):b.fac===a.fac?'a stranger of your own side':'a stranger of the other side';
  o.next=b.fac===a.fac?(dist(a,b)<=PK.TALK?'talk {target: "'+b.name+'"}':'move_to {target: "'+b.name+'"} to come within talking distance'):'fight {target: "'+b.name+'"} if you mean to, or keep your distance';
  return o}
function personLook(a,p){const o={ok:true,kind:'person',name:fullName(p),role:p.role,
    faction:p.fac===0||p.fac===1?FAC[p.fac].name+(p.fac===a.fac?' (your side)':' (the other side)'):'of no side',
    doing:p.errand?'on an errand':p.state==='post'?'at their post':p.state==='walk'?'walking about':p.state==='home'?'at home, off work':'about',
    where:p.town?'in '+p.town:ZONES[zoneAt(p.x,p.y)]||'the wilds',distance:r1(dist(a,p))+' tiles'};
  // only what shows: open hostility, the mood learned by talking, or the other side's coldness. Never their record or wants.
  o.mood=p.hostile?'hostile: they have turned against the Fellowship':p.fmem&&p.fmem.talks>0&&p.mood?p.mood+' (from talking with them)':(p.fac===0||p.fac===1)&&p.fac!==a.fac?'cold: they serve the other side':'not known: you have not spoken with them';
  if(p.trade&&p.trade.until>S.gameMin&&inSlots(a)&&p.trade.fac===a.fac)o.trade='open with you: shop {npc: "'+p.name+'"}';
  o.next=dist(a,p)<=PK.TALK?'talk {target: "'+p.name+'"}':'move_to {target: "'+(p.wander?Math.round(p.x)+','+Math.round(p.y):p.role)+'"}, then talk';
  return o}
function creatureLook(a,m){const v=mobView(a,m),o={ok:true,kind:'creature',what:v.what,threat:v.threat,looks:HURT(m.hp,m.maxhp)};
  if(v.new_to_you)o.new_to_you=true;if(v.named)o.named='a named one, not a common beast';
  o.doing=m.target===a?'coming for you':m.target&&m.target.kind==='hero'?'fighting '+m.target.name:'roaming';
  const L=(loreView(a,v.what).creatures||[]).find(c=>c.name===v.what||c.name==='unnamed: '+v.what||v.what.startsWith(c.name));
  o.you_know=L&&L.known&&L.known.length?L.known:'nothing yet beyond what you see (fight it, or ask about it)';
  o.distance=r1(dist(a,m))+' tiles';o.next='fight {target: "'+v.what+'"} (id '+m.id+'), or lore {about} for what you know';return o}
// An item: a pack entry, a piece you wear, or (by name) a supply or trade good you know of.
function itemLook(a,e,at){const o={ok:true,kind:'item'};
  if(isGear(e)){o.item=itemText(e);o.where=at;const ep=e.epic&&EPIC_ITEMS[e.name];if(ep&&ep.flavour)o.lore=ep.flavour;
    o.sells='about '+SELL_VALUE(e)+'g at the auction house';
    if(e.cls&&!e.epic&&e.cls!==a.cls)o.wear='made for a '+e.cls+'; you cannot wear it';
    else if(at!=='worn'&&e.ilvl>a.lvl+INV.WEAR_OVER)o.wear='too far above you: wearable from level '+(e.ilvl-INV.WEAR_OVER);
    else if(at!=='worn'){const cur=a.slots&&a.slots[e.slot];o.wear='you can wear it (equip {index}); on your '+e.slot+' now: '+(cur?itemText(cur):'nothing')}
    if(e.src)o.from=e.src;return o}
  const id=e.id;o.item=id;if(at)o.where=at;if(e.n)o.count=e.n;
  if(USES[id]){const U=USES[id];o.does=useLines(id).map(l=>l[1]).join('; ');if(U.flavour)o.lore=U.flavour;o.town_price=U.price+'g at the quartermaster (from level '+U.lvl+')';o.sells='supplies are kept, not sold';if(at)o.use='use_item {index}'}
  else if(GOODS[id]){o.does='a trade good: worth gold, nothing more';o.sells='about '+price(id)+'g each at the auction house now'}
  else{const Q=QUEST_ITEMS[id];o.does='a quest item: bound to its bearer, never sold, dropped or given';if(Q&&Q.flavour)o.lore=Q.flavour}
  return o}
function catalogueItem(q){const n=normName(q),sq=singular(n),all=[...Object.keys(USES),...Object.keys(GOODS),...Object.keys(QUEST_ITEMS)];
  return all.find(x=>normName(x)===n||singular(normName(x))===sq)||all.find(x=>singular(normName(x)).includes(sq))||null}
function inspectView(a,{who,target,item}={}){const raw=[who,target,item].find(v=>v!=null&&String(v).trim()!=='');
  need(raw!=null,'Inspect whom or what? who: a name or id from look (a hero, a townsperson, a creature), or an item in your pack or on you. '+sightLine(a,inSight(a)));
  const s=String(raw),L=inSight(a),id=idIn(raw),n=nameKey(s);
  const show=c=>c.kind==='hero'?heroLook(a,c.e):c.kind==='person'?personLook(a,c.e):creatureLook(a,c.e);
  if(['me','self','myself','yourself'].includes(n)||n===a.name.toLowerCase())return heroLook(a,a);
  if(id!=null&&/^\s*#?\d+\s*$|\bid\b|#/i.test(s)){const c=L.find(x=>x.e.id===id);if(c)return show(c);
    throw new Rule('Nothing with id '+id+' is in sight. look first, or move_to near them. '+sightLine(a,L))}
  // names as fight and give take them (#404, #412): the whole name, then a first name, title or role, then a start or a part
  const nm=c=>nameKey(c.name),pe=c=>c.kind==='person'?[c.e.name.toLowerCase(),c.e.role,String(c.e.title||'').toLowerCase()]:[];
  const tiers=[L.filter(c=>nm(c)===n||c.name.toLowerCase()===n),L.filter(c=>pe(c).includes(n)||nm(c).split(' ')[0]===n),L.filter(c=>nm(c).startsWith(n)),L.filter(c=>n.length>=3&&nm(c).includes(n))];
  for(const t of tiers){if(!t.length)continue;const ppl=[...new Set(t.filter(c=>c.kind!=='creature').map(c=>c.name))];
    if(ppl.length>1)throw new Rule('"'+clean(s,40)+'" fits '+ppl.length+' people in sight: '+t.filter(c=>c.kind!=='creature').slice(0,6).map(c=>c.name+(c.kind==='hero'?' (id '+c.e.id+')':' ('+c.e.role+')')).join(', ')+'. Give the full name or the id.');
    return show(t[0])}
  // then your own things: the pack, what you wear (by name or slot), then a supply or trade good you know by name
  const m=packFind(a,s,'Inspect');if(!m.error)return itemLook(a,invOf(a).list[m.index],'your pack, index '+m.index);
  if(/ matches \d+ things/.test(m.error))throw new Rule(m.error);
  const worn=SLOTS.map(k=>a.slots&&a.slots[k]).filter(Boolean),w=worn.find(it=>it.slot===n||normName(it.name)===normName(s))||worn.find(it=>normName(it.name).includes(normName(s)));
  if(w)return itemLook(a,w,'worn');if(SLOTS.includes(n))throw new Rule('You wear nothing on your '+n+' slot. shop shows what the smiths sell for it.');
  const cat=catalogueItem(s);if(cat)return itemLook(a,{id:cat},null);
  throw new Rule('"'+clean(s,40)+'" is not in sight, and you carry nothing by that name. look first, or move_to near them. '+sightLine(a,L))}

function seen(a){const R=sightOf(a),here=inTown(a)?homeOf(a):null,out={heroes:[],monsters:[],townsfolk:[]};
  const vis=p=>dist(a,p)<=R||(here&&inRect(here,p,1));
  const qr=here?Math.max(R,Math.hypot(here.w,here.h)):R;
  for(const b of nearHeroes(a.x,a.y,qr)){if(b===a||b.hidden||b.state==='dead'||!vis(b))continue;
    const mate=a.party&&b.party===a.party,o={id:b.id,name:b.name,fac:FAC[b.fac].name,cls:b.cls,lvl:b.lvl,dist:r1(dist(a,b)),doing:b.state};
    if(mate)o.party=true,o.hp=pct(b.hp,maxHp(b))+'%';else if(b.hp<maxHp(b)*.5)o.wounded=true;
    if(titleOf(b))o.known_as=styled(b); // a name given for a deed (#638)
    if(b.guild)o.guild=b.guild.tag;out.heroes.push(o);if(out.heroes.length>=10)break}
  for(const m of nearMobs(a.x,a.y,R)){if(!m.alive||m.gone)continue;
    const o=mobView(a,m);o.dist=r1(dist(a,m));if(m.target===a)o.onYou=true;else if(m.target)o.busy=true; // described, never numbered (#188)
    out.monsters.push(o)}
  out.monsters.sort((x,y)=>x.dist-y.dist);out.monsters=out.monsters.slice(0,10);
  if(here){ensureNpcs();for(const p of S.npcs||[])if(p.town===here.name)out.townsfolk.push({name:p.title+' '+p.name,role:p.role,dist:r1(dist(a,p))})}
  if(!out.townsfolk.length)delete out.townsfolk;
  return out}

function choiceInfo(a){const adv=advOf(a),p=adv&&adv.pick;if(!p||p.chosen||adv.stage!=='choose')return null;
  return {adventure:adv.title,scene:p.frame,options:{a:p.opts.a,b:p.opts.b},minutes_left:Math.max(0,Math.round(p.until-S.gameMin))}}

// A hero of your faction in sight, by id or name (join_party, invite): the hero, or a Rule naming who is in sight.
function sideHero(a,hero_id,who){const n=nameKey(who!=null&&who!==''?who:hero_id),i=idIn(hero_id)??idIn(who),seen=()=>nearHeroes(a.x,a.y,sightOf(a)).filter(x=>x!==a&&x.fac===a.fac&&x.state!=='dead'&&!x.hidden).sort(byDist(a));
  const b=i!=null?hero(i):seen().find(x=>x.name.toLowerCase()===n||x.name.toLowerCase().split(' ')[0]===n)||null;
  need(b&&b!==a&&b.state!=='dead','No such hero'+givenAs(hero_id,who)+'. Heroes of your faction in sight: '+(seen().slice(0,5).map(x=>x.name+' (id '+x.id+')').join(', ')||'none')+'.');return b}
const T={
  look(a){const z=zoneAt(a.x,a.y),here=inTown(a)?homeOf(a):null,s=seen(a);
    const r={ok:true,time:day()+' ('+dayPart()+')',where:here?'inside '+here.name+' ('+FAC[here.fac].name+')':(ZONES[z]||'the wilds'),pos:[r1(a.x),r1(a.y)],
      weather:weatherName(z),you:{hp:pct(a.hp,maxHp(a))+'%',state:a.state,doing:a.playDoing||null},sight:here?'the whole town':Math.round(sightOf(a))+' tiles',...s};
    const ch=choiceInfo(a);if(ch)r.choice=ch;const tv=tableView(a);if(tv)r.table=tv;
    const near=LANDMARKS.filter(l=>dist(a,l)<20).map(l=>l.name+' ('+r1(dist(a,l))+' tiles)');if(near.length)r.landmarks=near;
    {const f=followLine(a);if(f)r.following=f;const by=followersOf(a);if(by.length)r.walks_with_you=by.map(b=>b.name+' walks with you')} // follow (#445)
    lookSnap(a);return r},
  status(a){const mh=maxHp(a),q=a.quest,adv=advOf(a),c=homeOf(a);
    const r={ok:true,name:a.name,...(titleOf(a)?{known_as:styled(a)}:{}),people:raceOf(a).name,cls:a.cls,faction:FAC[a.fac].name,home:c.name,level:a.lvl,
      xp:a.lvl>=20?'max':Math.round(a.xp)+'/'+xpNeed(a.lvl),hp:Math.round(a.hp)+'/'+mh,attack:Math.round(atkOf(a)),gear_score:r1(gearScore(a)),gold:a.gold,
      state:a.state,doing:a.playDoing||null,queue:(a.pq||[]).map(cmdText),
      traits:(a.traits||[]).map(t=>t+(TRAITS[t]?' ('+TRAITS[t].desc+')':'')),origin:a.origin||null,
      oath:a.goal?a.goal.text+(a.goal.done?' (kept)':' ('+(a.goal.progress||0)+'/'+a.goal.need+')'):null,vow:a.vow?a.vow.text+' ('+vowLeft(a)+' game days left)':null,
      quest:q?(MOBS[q.type].q||q.type)+': kill '+q.need+' '+MOBS[q.type].pl+' in '+ZONES[MOBS[q.type].z]+' ('+q.have+'/'+q.need+')'+(q.have>=q.need?' - done, turn it in at home':''):null,
      abilities:abilityView(a).filter(r=>r.learned).map(abilityLine),specialisation:specOf(a)?specOf(a).name+': '+specOf(a).desc:a.lvl>=SPEC_LVL?'CHOOSE NOW with choose_specialisation: '+specChoices(a).map(x=>x.name+' ('+x.desc+')').join(' | '):'paths open at level '+SPEC_LVL,guild:a.guild?'<'+a.guild.tag+'> '+a.guild.name:null,kills:a.kills,honor:a.honor};
    if(a.party)r.party=a.party.mem.filter(b=>b!==a).map(b=>b.name+' (id '+b.id+', '+b.cls+' L'+b.lvl+(dist(a,b)<=sightOf(a)?', '+pct(b.hp,maxHp(b))+'% HP':', out of sight')+')'+(a.party.leader===b?' leads':''));
    if(a.party&&a.party.leader===a)r.party_lead=true;
    const cv=campView(a);if(cv)r.camp=cv;
    if(adv)r.adventure=plain(advLine(a));const ch=choiceInfo(a);if(ch)r.choice=ch;
    {const L=questLog(a),fq=L.active.find(q=>q.focus);if(fq)r.quest_focus=fq.title+(L.active.length>1?' (and '+(L.active.length-1)+' more: quests)':'')}
    if(inSlots(a)){const fc=fellowCard(a);if(fc)r.fellowship=fc;const P=a.party&&partySlotted(a.party)?a.party:null;if(P){r.party_leader=P.leader.name;if(P.dest)r.party_heading=P.dest.label}
      const op=openProps(companyOf(a)).map(propText);if(op.length)r.proposals=op;const far=outOfRange(a);if(far.length)r.out_of_earshot=far.map(b=>b.name);if(notTold(a))r.warning=NOT_TOLD;const tv=tableView(a);if(tv)r.table=tv} // Fellowship (#68): persona, memory, companions, council, table
    else{const C=companyOf(a);if(C&&C.ids.length>1){const op=openProps(C).map(propText);if(op.length)r.proposals=op;const far=outOfRange(a);if(far.length)r.out_of_earshot=far.map(b=>b.name)}} // any company of two or more (#439)
    if(!r.table){const tv=tableView(a);if(tv)r.table=tv} // any company's scene, a solo's too (#440)
    const nm=Object.keys(a.nemesis||{}).map(id=>hero(+id)).filter(x=>x&&x.state!=='dead').map(x=>x.name);if(nm.length)r.nemesis=nm;
    // only the places this hero knows (#188); the rest of the world is learned by going there or hearing of it
    r.places=['home','auction house','quest giver','gate','inn','smith','chapel','square',...placesView(a),...CITY.filter(x=>x.fac===a.fac&&x!==c).map(x=>x.name)];r.explore='a direction (north, south, east, west, northeast, ...) or "x,y" takes you where you have never been';
    lookSnap(a);return r},
  inventory(a){const slots={};for(const k of SLOTS){const it=a.slots&&a.slots[k];slots[k]=it?itemText(it):null}
    // Only this hero's own pack (inventory, #124): stacks, spare gear, consumables and quest items, by index.
    return {ok:true,gold:a.gold,slots,capacity:{used:used(a),max:capOf(a)},items:invOf(a).list.map((e,i)=>({index:i,kind:kindOf(e),item:entryText(e)}))}},
  use_item(a,{index,target_id,target}){const i=Number(index),e=invOf(a).list[i];need(e&&!isGear(e)&&e.kind==='use','No usable item at pack index '+index+'.');
    let on=a;if((target_id!=null&&target_id!=='')||(target!=null&&target!=='')){on=friendBy(a,target_id,target);need(on&&on.kind==='hero'&&on.state!=='dead','No such party member'+givenAs(target_id,target)+'. '+friendList(a))}
    const r=useItem(a,e.id,on);need(r.ok,r.error);return {ok:true,result:r.text,hp:pct(a.hp,maxHp(a))+'%',pack:invOf(a).list.length+'/'+capOf(a)}},
  use_ability(a,{ability,target_id,target}){const named=(target_id!=null&&target_id!=='')||(target!=null&&target!=='');const key=String(ability==null?'':ability).toLowerCase().replace(/[^a-z]/g,'');
    const id=movesOf(a).find(i=>i===key||MOVES[i].name.toLowerCase().replace(/[^a-z]/g,'')===key);
    need(id,'You have no ability "'+ability+'". Yours: '+(movesOf(a).map(i=>MOVES[i].name).join(', ')||'none yet')+'.');
    const M=MOVES[id];let t=null;
    if(M.target==='foe'){t=named?foeBy(a,target_id,target):a.target;need(t&&alive(t)&&!t.hidden,(named?'No such target'+givenAs(target_id,target)+'. ':'')+'Name a living foe in sight (target_id from look, or target by name), or be in a fight with one. '+foeList(a))}
    else if(M.target==='ally'){t=named?friendBy(a,target_id,target):a;need(t&&t.kind==='hero'&&t.state!=='dead','No such friend'+givenAs(target_id,target)+'. '+friendList(a))}
    const r=useMove(a,id,t,{mates:a.party?a.party.mem:[a],foe:a.target&&a.target.kind!=='hero'?a.target:null});need(r.ok,r.error);
    if(M.swing)a.cd=Math.max(a.cd,0)+1.1; // an attack ability takes the place of a weapon blow
    if(t&&t.kind==='mob'&&M.target==='foe'){if(!t.target)t.target=a;if(a.state==='hunt'||a.state==='travel'){a.state='fight';a.target=t;a.dest=null}}
    return {ok:true,result:r.text,hp:pct(a.hp,maxHp(a))+'%',cooldown_s:M.cd}},
  combat_log(a,{n}){const k=Math.max(1,Math.min(10,Math.round(Number(n))||3)),fs=fights(a,k);
    return {ok:true,fights:fs.map(f=>({...f,minutes_ago:Math.round(S.gameMin-f.end)})),recent:actionLog(a,{n:12}).map(e=>({min_ago:Math.round(S.gameMin-e.t),kind:e.kind,target:e.target,name:e.name,amount:e.amount,crit:e.crit||undefined}))}},
  choose_specialisation(a,{path}){const key=String(path==null?'':path).toLowerCase().replace(/[^a-z]/g,'');
    const id=specChoices(a).find(x=>x.id===key||x.name.toLowerCase().replace(/[^a-z]/g,'')===key);
    const err=specBlock(a);need(!err,err);need(id,'Not a path for a '+a.cls+'. Yours: '+specChoices(a).map(x=>x.name).join(', ')+'.');
    const r=chooseSpec(a,id.id,{by:'agent'});need(r.ok,r.error);return {ok:true,result:r.text}},
  drop(a,{index,count}){const r=dropEntry(a,Number(index),count);need(r.ok,r.error);return {ok:true,result:r.text}},
  give(a,{index,item,hero_id,to,count}){need((hero_id!=null&&hero_id!=='')||(to!=null&&to!==''),'Give to whom? hero_id or to (a companion\'s name). '+friendList(a));
    const b=friendBy(a,hero_id,to);need(b&&b!==a&&b.state!=='dead','No such companion'+givenAs(hero_id,to)+'. '+friendList(a));
    // the item by pack index or by name (#412): "Redroot Draught", "potion", "2 rations", a partial name
    const hasI=index!=null&&index!=='',hasN=item!=null&&String(item).trim()!=='';let i,n=count;
    if(hasI&&!hasN&&!Number.isFinite(Number(index)))item=String(index); // a name sent as the index
    else if(hasI&&!hasN){i=Number(index)}
    if(item!=null&&String(item).trim()!==''){const m=packFind(a,item);need(!m.error,m.error);
      if(hasI&&hasN&&Number.isFinite(Number(index))&&Number(index)!==m.index&&!m.all.includes(Number(index)))
        throw new Rule('Pack index '+index+' is not "'+clean(String(item),40)+'" ('+m.name+' is at index '+m.index+'). Give index or item, not both. '+packList(a));
      i=m.index;if((n==null||n==='')&&m.count!=null)n=m.count}
    need(i!=null&&Number.isFinite(i),'Give what? item (a name, like "Redroot Draught" or "2 rations") or index (from inventory). '+packList(a));
    need(invOf(a).list[i],'No pack entry '+i+'. '+packList(a));
    const r=giveItem(a,b,i,n==null||n===''?1:n);need(r.ok,r.error);return {ok:true,result:r.text}},
  pay(a,{to,gold,why}){need(!['fight','duel','assist'].includes(a.state),'You are in a fight. Pay when it is over.');need(a.state!=='ghost','Ghosts carry no gold.');
    if(why!=null&&String(why).trim())need(!notEnglish(String(why)),ENGLISH);
    const r=payGold(a,{to,gold,why});need(!r.error,r.error);return r},
  mark(a,{name,note,what}){need(a.state!=='ghost','Ghosts leave no marks.');for(const t of [name,note])if(t!=null&&String(t).trim())need(!notEnglish(String(t)),ENGLISH);
    const r=markPlace(a,{name,note,what});need(!r.error,r.error);return r},
  unmark(a,{name}){const r=unmarkPlace(a,{name});need(!r.error,r.error);return r},
  move_to(a,{target,force}){need(a.state!=='camp',campBlock(a)||'The Fellowship is camped.');need(legal.includes(a.state),'You cannot walk away right now ('+a.state+').');
    need(a.state!=='fight'&&a.state!=='duel'&&a.state!=='assist','You are in a fight. flee() first.');
    const p0=plan(a,target);if(p0.error)throw new Rule(p0.error);
    const g=guardWalk(a,p0,force);if(g.refuse)throw new Rule(g.refuse);const p=g.p; // a region far above the hero: stop at its edge first (#465)
    if(inTown(a)&&p.last==='hunt')writeSighting(a,zoneName(p));a.pq=[{kind:'move',legs:p.legs,last:p.last,label:p.label}];if(a.state==='follow')a.state='hunt';a.dest=null;
    const r={ok:true,going:p.label,distance:r1(p.legs.reduce((t,l,i)=>t+dist(i?p.legs[i-1]:a,l),0))};if(p.warn)r.warning=p.warn;if(p.note)r.note=p.note;if(p.explore)r.explore=true;
    if(g.stopped)r.stops_short=true;const ap=apartNote(a,p);if(ap)r.apart=ap;return r},
  talk(a,{target,text}){const t=clean(target,60).toLowerCase();need(t,'Talk to whom?');
    ensureNpcs();const here=cityAt(a);
    // NPC conversations (#170): a Fellowship member's words to a person open a conversation the DM answers (sim/talk.js)
    if(inSlots(a)&&slotted()){const q=findPerson(a,target,PK.TALK);
      if(q&&q.far)throw new Rule(q.far.title+' '+q.far.name+' is too far away ('+r1(q.d)+' tiles). move_to("'+(q.far.wander?Math.round(q.far.x)+','+Math.round(q.far.y):q.far.role)+'") first.');
      if(q&&(q.wander||q.fac===a.fac)){need(a.state!=='ghost','Ghosts do not speak.');let line='';
        if(text!=null&&String(text).trim()){const L=spokenLine(a,text,PK.SAY_LEN);need(!L.error,L.error);need(!notEnglish(L.text),ENGLISH);line=L.text;agentLine(a,speak(a,line,'agent'))}
        const r=talkTo(a,q,line);need(!r.error,r.error);talked(a,[q.name]);if(q.role==='innkeeper')innRumour(a,r);return r}}
    const p=(S.npcs||[]).find(p=>(!here||p.town===here.name)&&(p.name.toLowerCase()===t||p.role===t||p.title.toLowerCase()===t||(p.title+' '+p.name).toLowerCase()===t));
    if(p){need(dist(a,p)<=PK.TALK,p.title+' '+p.name+' is too far away ('+r1(dist(a,p))+' tiles). move_to("'+p.role+'") first.');
      if(p.fac!==a.fac)return {ok:true,who:p.title+' '+p.name,answer:'('+p.name+' looks at you with open contempt and says nothing.)'};
      // a question gets the town's public answer (#540); a plain greeting the role's greeting, and the warning only on a first meeting or about the danger
      const met=a.metNpc||(a.metNpc={}),fresh=!met[p.id];met[p.id]=1;const pa=text!=null&&String(text).trim()?publicAnswer(p,a,String(text)):null;
      const before=p.lastBark;if(!pa)npcSay(p,'greet',{target:a.name},{dm:true});const line=pa?pa.text:p.bubble&&p.lastBark!==before?p.bubble.text:p.bubble?p.bubble.text:null;
      const warn=pa?null:fresh?((p.role==='captain'&&captainWarning(a))||npcWarning(a)):null;if(warn)hear(a,warn,p.title+' '+p.name); // a townsperson's advice (#188); the captain warns of the Crypt (#448)
      talked(a,[p.name]);const rr={ok:true,who:p.title+' '+p.name,answer:(line||'('+p.name+' nods.)')+(warn?' "'+warn+'"':'')};if(p.role==='innkeeper')innRumour(a,rr);
      {const w=passOnTo(p,a);if(w.length)rr.answer+=' '+w.map(x=>'"'+x+'"').join(' ')} // word the town is passing on (#637)
      return rr}
    const id=Number(target),b=S.agents.find(x=>x!==a&&x.state!=='dead'&&(x.id===id||x.name.toLowerCase()===t));
    need(b,'Nobody called "'+target+'" is here.');need(dist(a,b)<=PK.TALK*1.5,b.name+' is too far away to talk to.');
    if(b.fac!==a.fac)return {ok:true,who:b.name,answer:'('+b.name+' of the '+FAC[b.fac].name+' answers with a hand on their weapon.)'};
    talked(a,[b.name]);const n=(b.chat||[]).length;say(b,'idle',{});const e=(b.chat||[])[(b.chat||[]).length-1];
    return {ok:true,who:b.name,answer:(b.chat||[]).length>n&&e&&e.from===b?e.text:'('+b.name+' is busy and does not answer.)'}},
  attempt(a,{what,how,at}){return attemptRuled(a,{what,how,at})}, // anything the tools never named; the DM rules on it (#522)
  say(a,{text}){const L=spokenLine(a,text,PK.SAY_LEN);need(!L.error,L.error);const t=L.text;need(!notEnglish(t),ENGLISH);need(a.state!=='ghost','Ghosts do not speak.');
    const no=lineRefusal(a,t);need(!no,no); // not the same line again, no second introduction (sim/talk.js)
    agentLine(a,speak(a,t,'agent'));const H=sayHearers(a);noteSaid(a,t,H);talked(a,H.map(b=>b.name));const heard=H.length;
    const to=addressed(a,t);if(to){const r=talkTo(a,to,t);if(!r.error)return {...r,heard_by:heard,to:r.who}} // said to a person: the conversation goes on (#170)
    return {ok:true,said:t,heard_by:heard}},
  whisper(a,args){return whisperTo(a,args)}, // a line only one hero within 2 tiles hears (#627)
  emote(a,args){return emoteAct(a,args)}, // a wordless act seen by those in earshot (#627)
  join_party(a,{hero_id,who}){const n=nameKey(who!=null&&who!==''?who:hero_id),i=idIn(hero_id)??idIn(who);
    const b=i!=null?hero(i):nearHeroes(a.x,a.y,sightOf(a)).filter(x=>x!==a&&x.fac===a.fac&&x.state!=='dead'&&!x.hidden).sort(byDist(a)).find(x=>x.name.toLowerCase()===n||x.name.toLowerCase().split(' ')[0]===n)||null;
    need(b&&b!==a&&b.state!=='dead','No such hero'+givenAs(hero_id,who)+'. Heroes of your faction in sight: '+(nearHeroes(a.x,a.y,sightOf(a)).filter(x=>x!==a&&x.fac===a.fac&&x.state!=='dead'&&!x.hidden).sort(byDist(a)).slice(0,5).map(x=>x.name+' (id '+x.id+')').join(', ')||'none')+'.');
    if(inSlots(a)&&inSlots(b)){delete a.splitUntil;a.partyOk=true;return {ok:true,note:'You will fall in with the Fellowship again the next time you meet them in town or on the road.'}}
    {const r=askToJoin(a,b);if(r)return r} // toward an agent hero or a company's companion: an offer to that company's leader (#442)
    need(b.fac===a.fac,b.name+' is of the '+FAC[b.fac].name+'.');need(dist(a,b)<=PK.JOIN,b.name+' is too far away (within '+PK.JOIN+' tiles).');
    need(Math.abs(b.lvl-a.lvl)<=3,'Too far apart in level (more than 3).');need(!['dungeon','raid','duel','ghost'].includes(b.state),b.name+' is busy.');
    need(tm(b,'social')||b.player,b.name+' is a loner and will not travel with anyone.');
    if(a.party&&a.party===b.party)return {ok:true,party:a.party.mem.map(x=>x.name),note:'Already together.'};
    if(a.party)leaveParty(a);
    let p=b.party;
    if(p){need(p.mem.length<3,b.name+'\'s party is full.');p.mem.push(a)}
    else{p={id:++S.uid,fac:a.fac,leader:b.lvl>a.lvl?b:a,mem:[b,a],zone:zoneAt(b.x,b.y)>0?zoneAt(b.x,b.y):huntZone(b.lvl<a.lvl?b:a),home:false};b.party=p;S.parties.push(p)}
    a.party=p;a.partyOk=true;for(const m of p.mem)if(m.lvl>p.leader.lvl)p.leader=m;
    record(a,'Joined ',b,' on the road.');record(b,a.name+' joined them.');
    return {ok:true,party:p.mem.map(x=>x.name),leader:p.leader.name}},
  // companies (#442): an offer to ride together, said aloud; the one asked answers with accept or decline
  invite(a,{hero_id,name,who,text}){const b=sideHero(a,hero_id,name!=null&&name!==''?name:who);return offerInvite(a,b,text)},
  accept(a,{offer_id}){return offerAccept(a,{offer_id})},
  decline(a,{offer_id,text}){return offerDecline(a,{offer_id,text})},
  companions(a){return companionsView(a)}, // #443: the company as the hero knows it (read-only)
  follow(a,{hero_id,name,who,hours}){need(a.state!=='camp',campBlock(a)||'You are camped.');need(FOLLOWS.includes(a.state),'You cannot walk away right now ('+a.state+').'); // #445
    const n=nameKey(name!=null&&name!==''?name:who!=null&&who!==''?who:hero_id),i=idIn(hero_id)??idIn(who)??idIn(name),R=sightOf(a),here=cityAt(a);
    const vis=()=>nearHeroes(a.x,a.y,here?Math.max(R,Math.hypot(here.w,here.h)):R).filter(x=>x!==a&&x.state!=='dead'&&!x.hidden&&(dist(a,x)<=R||cityAt(x)===here&&here)).sort(byDist(a));
    const b=i!=null?hero(i):n?vis().find(x=>x.name.toLowerCase()===n)||vis().find(x=>x.name.toLowerCase().split(' ')[0]===n)||vis().find(x=>x.name.toLowerCase().startsWith(n))||null:null;
    const no=b&&b!==a?followRefusal(a,b):null;
    need(b&&b!==a,'Follow whom'+givenAs(hero_id,name||who)+'? Heroes in sight: '+(vis().slice(0,5).map(x=>x.name+' (id '+x.id+')').join(', ')||'none')+'.');need(!no,no);
    const cmd=startFollow(a,b,hours);a.pq=[cmd];a.dest=null;if(a.state==='follow')a.state='hunt';
    return {ok:true,following:b.name,...(cmd.until!=null?{hours:cmd.h}:{}),note:'You walk at the side of '+b.name+(cmd.until!=null?' for '+cmd.h+' hour'+(cmd.h>1?'s':''):' until you give another order')+' (move_to, hunt, fight or rest end it). You do not ride in their company: no shared XP, votes or party shouts. If you lose sight of them you go to where you last saw them, then stop.'}},
  leave_party(a,{where,when_hours,for_good}){if(for_good===true||/^(yes|true|1)$/i.test(String(for_good==null?'':for_good))){const r=leaveForGood(a);if(!r.ok)throw new Rule(r.error);return r}
    if(inSlots(a)){need(!a.splitUntil,'You have already gone your own way.');
      // a meeting plan (#182): made aloud before parting, so it is recorded only for those who hear it
      let plan=null;if(where||when_hours){plan=makeMeeting(a,where,when_hours);if(plan.error)throw new Rule(plan.error)}
      splitOff(a,false);a.partyOk=false;
      return {ok:true,plan:plan?'Meet at '+plan.where+' at '+plan.atText+' (they know: '+plan.whoNames.join(', ')+')':undefined,note:'You go your own way for a while ('+Math.round((a.splitUntil-S.gameMin)/60)+' game hours); your companions think less of you for it.'+(plan?'':' You made no plan to meet again, and out of shouting range (about '+REACH.SHOUT+' tiles) no one will hear you: next time give where and when_hours.')+' join_party with a companion to come back sooner.'}}
    need(a.party,'You are not in a party.');leaveParty(a);a.partyOk=false;return {ok:true}},
  list_jobs(a){need(inTown(a),'Jobs are posted at your town gate. Go home first.');const c=homeOf(a),mem=[a,...partyMates(a)];
    const mine=advOf(a);const out=[];
    if(mine)out.push({id:mine.id,title:mine.title,yours:true,resume:true,scene:plain(advLine(a))});
    // the job's own words and the gate's rumour of it (#188), not whether it "fits": the job-giver decides at take_adventure
    for(const h of (S.adventures||[]))if(h.phase==='open'&&h.town===c.name){const T=D.ADVENTURES[h.tpl],zn=h.zone!=null?ZONES[h.zone]:null;learnJob(a,h); // its region and the place it names (#188, #423)
      out.push({id:h.id,job:jobText(h),giver:h.giver?h.giver.name:'the gate captain',where:zn||'near the town',party:T&&T.size?(T.size[0]>1?'wants '+T.size[0]+' to '+T.size[1]+' blades':'one blade will do'):undefined,
        for_you:h.for!=null?h.for===a.id:undefined,rumour:h.zone!=null?jobRumour(a,h.zone):undefined,expires_in_min:Math.max(0,Math.round(h.until-S.gameMin))})}
    const bounties=bountiesAt(c).filter(b=>MOBS[b.type]).map(b=>({bounty:MOBS[b.type].q,kill:b.need+' '+MOBS[b.type].pl,where:ZONES[b.z],giver:b.giver,yours:a.quest&&a.quest.bounty===b.id||undefined,expires_in_min:Math.max(0,Math.round(b.until-S.gameMin))}));
    const sg=sightingLines(a,c.name),nt=noticesAt(a,c.name);for(const x of sg)if(x.bound)learnPlace(a,x.bound,'told');
    const gw=gateWord(a,c.name); // the gate's word: what the town is saying (#637)
    return {ok:true,jobs:out,...(gw.length?{word_at_the_gate:gw}:{}),bounties:bounties.length?bounties:undefined,sightings:sg.length?sg.map(x=>x.text):undefined,notices:nt.length?nt.map(({poster,...r})=>r):undefined,note:(out.length?'':'No adventure posted right now; jobs refill every few game hours. ')+(bounties.length?'Bounties are background work (turn_in takes one): adventures are the road to renown.':'')||undefined}},
  take_adventure(a,{job_id}){need(inTown(a),'Take jobs at your town gate. Go home first.');const id=Number(job_id),c=homeOf(a),mem=[a,...partyMates(a)];
    need(!(a.party&&a.party.leader!==a),'In the Fellowship the party decides: propose {kind:"job", job_id:'+(Number.isFinite(id)?id:'N')+'} (vote; the leader settles it).');
    const mine=advOf(a);
    if(mine&&mine.id===id){a.pq=[];const ok=dmDepart(a,c);need(ok,'The adventure could not resume.');return {ok:true,resumed:mine.title,scene:plain(advLine(a))}}
    if(heldOf(a).some(v=>v.id===id)||takenOf(a).some(h=>h.id===id))return T.focus_quest(a,{id:'job:'+id}); // one you hold: focus it (the quest log)
    if(mine)need(heldCount(a)<QL.MAX,'You already hold '+QL.MAX+' quests. Finish or abandon_quest one first.');
    const h=(S.adventures||[]).find(x=>x.id===id&&x.phase==='open'&&x.town===c.name);need(h,'No open job '+id+' at '+c.name+'.');
    const w=jobFit(a,h,mem);need(!w,'The job-giver turns you away: '+w+'.'+growHint(a,w,mem));
    // Offer only this job to the DM: the others are held back for the moment and the job is
    // marked as personal to this hero, so the scripted DM's pickHook takes it without a roll.
    const held=(S.adventures||[]).filter(x=>x!==h&&x.phase==='open'&&x.town===c.name);for(const x of held)x.phase='held';
    const forWas=h.for;h.for=a.id;a.pq=[];let ok=false,setAside=null;
    try{if(mine)setAside=holdAdventure(a);ok=dmDepart(a,c)}finally{for(const x of held)if(x.phase==='held')x.phase='open';if(h.phase==='open'||forWas==null)h.for=forWas}
    if(!(ok&&a.adv===h.id)){if(setAside)resumeAdventure(a,setAside);need(false,'The job-giver turned you away.')}
    setFocus(a,jobId(h));const adv=advOf(a);return {ok:true,adventure:adv.title,scenes:adv.scenes.length,scene:plain(advLine(a)),set_aside:setAside?setAside.title:undefined,note:'The adventure now leads you. Scene choices wait for choose(); fights are real.'+(setAside?' '+setAside.title+' waits in your quest log (focus_quest to go back to it).':'')}},
  // ---- the quest log (sim/questlog.js): several quests, one in focus ----
  quests(a){return {ok:true,...questsView(a)}},
  take_quest(a,{id}){const n=parseJob(id);need(n!=null,'Give a job id (job:42 or 42) from list_jobs or quests.');
    const h=(S.adventures||[]).find(x=>x.id===n);need(h&&h.phase!=='done','No job '+n+' is open.');
    need(!(h.phase==='taken'&&h.taker===a.id)&&!(h.phase==='active'&&(h.held===a.id||h.mem&&h.mem.includes(a.id))),'You already hold that one: focus_quest {id: "job:'+n+'"}.');
    need(h.phase==='open','Someone else has that job.');
    const c=homeOf(a),mine=h.for===a.id;
    need(h.town===c.name&&(mine||inTown(a)),h.town!==c.name?'That job is posted in '+h.town+', not your town.':'Take a posted job at your town board: go home first.');
    need(heldCount(a)<QL.MAX,'You already hold '+QL.MAX+' quests. Finish or abandon_quest one first.');
    const w=jobFit(a,h,[a,...(a.party&&a.party.leader===a?partyMates(a):[])]);need(!w,'The job-giver will not give it to you: '+w+'.');
    h.phase='taken';h.taker=a.id;h.takenAt=Math.round(S.gameMin);h.until=S.gameMin+DMK.MAX_DAYS*1440;learnJob(a,h);
    const q=questLog(a).active.find(x=>x.id==='job:'+n),t=q?q.title:jobText(h);record(a,'Took a job: ',{t,c:'gd'},' ('+(h.giver?h.giver.name:'the board')+').');
    return {ok:true,took:t,id:'job:'+n,holding:heldCount(a)+'/'+QL.MAX,note:'It waits in your quest log for up to '+DMK.MAX_DAYS+' game days: focus_quest {id: "job:'+n+'"} to set out on it.'}},
  focus_quest(a,{id}){const q=findQ(a,id);need(q,'You hold no quest "'+id+'". quests lists them.');
    if(q.focus)return {ok:true,focus:q.title,note:'Already your focus.'};
    need(!/^scene:/.test(q.id),'A scene at the table needs no focus: answer it with scene_act.');
    need(!['fight','duel','assist','dungeon','raid','ghost','camp'].includes(a.state),'Not now ('+a.state+'): finish what you are in first.');
    need(!tableView(a),'Not while a scene is open at the table.');
    const run=advOf(a),lead=!(a.party&&a.party.leader!==a);
    need(lead||!run,'Your party is on '+(run&&run.title)+'; your leader decides what the party pursues.');
    const n=parseJob(q.id);
    if(n!=null){need(lead,'In a party, the leader picks the party\'s job.');
      const h=(S.adventures||[]).find(x=>x.id===n);need(h,'That job is gone.');let adv;
      if(h.phase==='taken'){const r=beginJob(a,h);if(typeof r==='string')throw new Rule('You cannot set out on it now: '+r+'.');adv=r}
      else{adv=resumeAdventure(a,h);need(adv,'That adventure is over.');if(a.state==='town')dmDepart(a,homeOf(a))}
      a.pq=[];setFocus(a,q.id);const held=questLog(a).active.filter(x=>x.status==='held').map(x=>x.title);
      return {ok:true,focus:adv.title,scene:plain(advLine(a))||undefined,held:held.length?held:undefined,note:'The adventure leads you now; what you set aside waits in your quest log.'}}
    let aside=null;if(run)aside=holdAdventure(a);setFocus(a,q.id);
    return {ok:true,focus:q.title,set_aside:aside?aside.title:undefined,note:aside?aside.title+' waits where it stands (focus_quest it, or come back near its place).':undefined}},
  swear_oath(a,{text,kind,about,days}){const no=canSwear(a);need(!no,no);
    const k=clean(kind,12).toLowerCase()||'vow';need(VOW.KINDS.includes(k),'kind is one of '+VOW.KINDS.join(', ')+'.');
    const w=clean(about,60);need(k==='vow'||w,'A '+k+' vow needs an about: '+(k==='reach'?'a region, town or landmark you know':k==='protect'?'a companion by name':k==='recover'?'the epic you mean to find':'the foe you mean to slay')+'.');
    let ab=w?{name:w}:null;
    if(k==='reach'){const p=placeNamed(w);need(p,'No such place: "'+w+'".');need(knowsPlace(a,p.name),'You do not know where '+p.name+' is yet.');ab={name:p.name,zone:p.zone,x:p.x,y:p.y,r:p.r}}
    if(k==='protect'){const c=companyOf(a),ids=new Set([...(c?c.ids:[]),...partyMates(a).map(b=>b.id)]);const b=S.agents.find(x=>x!==a&&alive(x)&&ids.has(x.id)&&vnorm(x.name)===vnorm(w));
      need(b,'You can protect only a companion: '+([...ids].map(id=>S.agents.find(x=>x.id===id)).filter(x=>x&&x!==a&&alive(x)).map(x=>x.name).join(', ')||'you ride alone')+'.');ab={name:b.name,id:b.id}}
    const t=vowText(k,ab,clean(text,VOW.TEXT));need(t,'Say the words of the vow (text).');need(!notEnglish(t),ENGLISH);
    const H=sayHearers(a),line=t.toLowerCase().indexOf('swear')>=0?t:'I swear it: '+t;
    agentLine(a,speak(a,clean(line,PK.SAY_LEN),'agent'));talked(a,H.map(b=>b.name));
    const v=swearVow(a,{kind:k,about:ab,text:t,days,hearers:H});
    return {ok:true,sworn:v.text,id:v.id,kind:k,term_days:v.days,heard_by:H.map(b=>b.name),note:'It is in your quest log as an oath. Keep it, or renounce_oath (that costs).'}},
  renounce_oath(a,{id,reason}){need(a.vow,'You hold no sworn vow. Only a vow you swore with swear_oath can be renounced; the oath you began with is not yours to break.');
    need(!id||String(id).trim()===a.vow.id||vnorm(id)===vnorm(a.vow.text),'You hold no vow "'+id+'" (yours is '+a.vow.id+').');
    const r=renounceVow(a,clean(reason,120));return {ok:true,renounced:r.vow.text,cooled:r.bonds_cooled.length?r.bonds_cooled:undefined,note:'You broke your word. The witnesses remember it, and so do you.'}},
  abandon_quest(a,{id,reason}){const why=clean(reason,120)||null,q=findQ(a,id);need(q,'You hold no quest "'+id+'". quests lists them.');
    need(q.kind!=='oath','An oath is not set down with a word: it is kept, or it fails on its own'+(a.vow&&a.vow.id===q.id?' (a vow you swore: renounce_oath, at a cost)':'')+'.');
    need(!/^scene:/.test(q.id),'You are in that scene; it ends at the table.');
    if(/^kill:/.test(q.id)){killAbandoned(a,why);a.quest=null;record(a,'Gave up ',{t:q.title,c:'gd'},why?': '+why+'.':'.');return {ok:true,abandoned:q.title,note:'The gate captain’s bounties stay posted: turn_in takes one if you want it.'}}
    const n=parseJob(q.id),h=(S.adventures||[]).find(x=>x.id===n);need(h,'That job is gone.');
    if(h.phase==='taken'){h.phase='open';h.taker=null;takenGone(a,h,'abandoned',why);if(S.gameMin>h.until)S.adventures.splice(S.adventures.indexOf(h),1);
      record(a,'Gave up ',{t:q.title,c:'gd'},why?': '+why+'.':'.');return {ok:true,abandoned:q.title,note:'It goes back on the board.'}}
    if(why)h.quitWhy=why;const lead=h.lead===a.id||h.held===a.id;abandonAdventure(a,h);record(a,'Gave up ',{t:q.title,c:'gd'},why?': '+why+'.':'.');
    return {ok:true,abandoned:q.title,note:lead?'It ends here, for anyone who was on it with you.':'You leave it to the others.'}},
  choose(a,{option}){const o=clean(option,4).toLowerCase();need(o==='a'||o==='b','Choose "a" or "b".');const adv=advOf(a),p=adv&&adv.pick;
    need(p&&adv.stage==='choose'&&!p.chosen,'No choice is waiting for you.');need(S.gameMin<p.until,'Too late: the moment passed.');
    p.chosen=o;return {ok:true,chose:o+') '+p.opts[o]}},
  fight(a,{target_id,target,flee_below}){need(fieldState(a)||a.state==='fight','You can only pick a fight out in the world.');
    const t=foeBy(a,target_id,target);need(t&&alive(t)&&!t.hidden,'No such target'+givenAs(target_id,target)+'. '+foeList(a));need(dist(a,t)<=sightOf(a),'You cannot see that from here. '+foeList(a));
    const fb=flee_below==null?PK.FLEE:Math.min(.6,Math.max(.05,Number(flee_below)/100));
    if(t.kind==='mob'){need(!(t.target&&t.target!==a&&t.target.state!=='dead'),'Someone else is already fighting it. '+foeList(a,true));
      a.pq=[{kind:'fight',id:t.id,flee:fb}];a.target=t;a.state='fight';a.dest=null;
      const pr=perceived(a,t);return {ok:true,target:foeName(a,t),threat:threatText(a,t),warning:pr==null?'You cannot tell how strong it is.':pr>=3?'You judge it '+threatText(a,t).replace(/^looks /,'')+'.':undefined}}
    need(t.kind==='hero'&&t!==a,'No such target'+givenAs(target_id,target)+'. '+foeList(a));need(t.fac!==a.fac,'You will not raise a hand against your own faction.');
    need(zoneAt(a.x,a.y)>=1&&zoneAt(t.x,t.y)>=1,'Thornvale is the peaceful vale: no duels there.');
    need(['hunt','travel','return','follow'].includes(t.state),t.name+' is not free to be challenged right now.');
    a.pq=[];a.state=t.state='duel';a.target=t;t.target=a;a.dest=t.dest=null;record(a,'Challenged ',t,'.');
    return {ok:true,duel:t.name+' ('+t.cls+' L'+t.lvl+')',note:'A duel runs until one falls or breaks off; you break off on your own at low HP, or flee().'}},
  // hunt {where} (#411): a known region, place, direction or "x,y" (read the way move_to reads it, #399/#188); the hero
  // walks there first (the move_to walk), then hunts. In town with no where, the refusal names the nearest known ground.
  hunt(a,{count,flee_below,prey,where,force}){const w=where!=null&&String(where).trim()?String(where):null;
    if(!w&&!(fieldState(a)&&!inTown(a))){const ct=cityAt(a)||(inTown(a)?homeOf(a):null),g=huntGrounds(a)[0];
      need(false,'Hunt out in the world, not in town'+(ct?' (you are in '+ct.name+')':'')+': '+(g?'hunt {where: "'+g+'"} walks you to '+g+' and hunts there'+(ct&&g===ZONES[zoneAt(ct.gate.x,ct.gate.y)]?' ('+g+' lies around '+ct.name+')':'')+', or move_to a place you know first.':'hunt {where: "north"} (a direction or "x,y") walks out and hunts; no hunting ground is known to you yet.'))}
    need(w||a.state!=='return','You are heading home. hunt {where: "<a region you know>"} to turn around and hunt there.');
    const n=Math.min(10,Math.max(1,Math.round(Number(count)||3))),fl=flee_below==null?PK.FLEE:Math.min(.6,Math.max(.05,Number(flee_below)/100));
    // what the hero chooses (#188): a creature it knows by name, or whatever is around that it has not learned to fear
    let pk=null;if(prey!=null&&String(prey).trim()&&!/^(any|anything|around|whatever.*)$/i.test(String(prey).trim())){pk=preyKey(a,prey);need(pk,'You know of no creature called "'+clean(prey,40)+'". Hunt what is around (no prey), or learn its name first (fight one, look, ask around).')}
    const what=n+' kill'+(n>1?'s':'')+(pk?' ('+clean(prey,40)+' only)':' (whatever is around that you do not fear)'),hunt={kind:'hunt',n,prey:pk||undefined,flee:fl};
    if(w){need(a.state!=='camp',campBlock(a)||'The Fellowship is camped.');need(legal.includes(a.state),'You cannot walk away right now ('+a.state+').');
      need(a.state!=='fight'&&a.state!=='duel'&&a.state!=='assist','You are in a fight. flee() first, or hunt with no where once it is over.');
      const gl=()=>{const L=huntGrounds(a).slice(0,3);return L.length?' Hunting grounds you know: '+L.join(', ')+'.':''};
      const p0=plan(a,w);if(p0.error)throw new Rule('Cannot hunt at "'+clean(w,60)+'": '+p0.error+gl());
      if(p0.last==='town')throw new Rule(p0.label+' is inside the town walls: hunt out in the world.'+gl()+' Or a direction ("north") or "x,y".');
      const g=guardWalk(a,p0,force);if(g.refuse)throw new Rule(g.refuse);if(g.stopped){a.pq=[{kind:'move',legs:g.p.legs,last:'hunt',label:g.p.label}];if(a.state==='follow'||a.state==='return')a.state=inTown(a)?'town':'hunt';a.dest=null;
        return {ok:true,going:g.p.label,stops_short:true,warning:g.p.warn,hunting:'not yet: you stop at the edge first',apart:apartNote(a,g.p)||undefined}}
      const p=g.p; // #465
      const z=ZONES.indexOf(p.label);
      if(z>=0&&fieldState(a)&&!inTown(a)&&!cityAt(a)&&zoneAt(a.x,a.y)===z){a.pq=[{...hunt,k0:a.kills}];a.state='hunt';a.dest=null;return {ok:true,hunting:what+' in '+ZONES[z],note:'You are already in '+ZONES[z]+'.'}}
      a.pq=[{kind:'move',legs:p.legs,last:'hunt',label:p.label},hunt];if(a.state==='follow'||a.state==='return')a.state=inTown(a)?'town':'hunt';a.dest=null;
      const r={ok:true,going:'going to '+p.label+' to hunt',hunting:what+' once there',distance:r1(p.legs.reduce((t,l,i)=>t+dist(i?p.legs[i-1]:a,l),0))};if(p.warn)r.warning=p.warn;if(p.note)r.note=p.note;if(p.explore)r.explore=true;return r}
    a.pq=[{...hunt,k0:a.kills}];a.state='hunt';a.dest=null;
    return {ok:true,hunting:what+' in '+ZONES[zoneAt(a.x,a.y)]}},
  flee(a){need(['fight','duel','assist'].includes(a.state),'You are not in a fight.');flee(a,false);return {ok:true,fleeing_to:homeOf(a).name,hp:pct(a.hp,maxHp(a))+'%'}},
  rest(a,{minutes,hours}){if(a.state==='camp'){const v=campView(a);return {ok:true,camp:'You rest at camp'+(v&&v.ends?': '+v.ends:'')+'.',note:campBlock(a)}} // resting is what camp is (#400)
    if(hours!=null&&hours!==''&&companyOf(a)){const e=leaderRest(a,hours);if(e)throw new Rule(e);return {ok:true,camp:campView(a)&&campView(a).status||'making camp',note:(inSlots(a)?'The Fellowship makes':'You make')+' camp; sleepers get no turns but wake events.'}} // any company, a solo too (#439)
    need(a.state==='hunt'||a.state==='town'||a.state==='travel'||a.state==='follow','You cannot rest now ('+(a.state==='return'?'you are heading home; rest in town':a.state)+').');
    if(a.state==='travel'||a.state==='follow')a.state='hunt'; // stop walking and sit down where you are
    const m=Math.min(240,Math.max(10,Math.round(Number(minutes)||60)));a.pq=[{kind:'rest',until:S.gameMin+m}];a.dest=null;return {ok:true,resting_min:m}},
  buy(a,{slot,item,count,npc}){const tr=npc!=null&&npc!==''||!inTown(a)?traderFor(a,npc,PK.TALK):null; // a person who opened their stock (#170)
    if(tr){need(!tr.error,tr.error);const r=npcBuy(a,tr,{slot,item,count});need(!r.error,r.error);return r}
    need(inTown(a),'The smiths are in town.');
    if(item!=null&&item!==''){const id=Object.keys(USES).find(x=>!USES[x].craft&&x.toLowerCase()===String(item).toLowerCase());
      need(id,'Not sold here. For sale: '+Object.keys(USES).filter(x=>!USES[x].craft&&USES[x].lvl<=a.lvl).map(x=>x+' ('+USES[x].price+'g)').join(', ')+'.');
      const U=USES[id];need(U.lvl<=a.lvl,id+' is sold from level '+U.lvl+'.');const n=Math.min(10,Math.max(1,Math.round(Number(count)||1)));
      need(a.gold>=U.price,'That costs '+U.price+'g each; you have '+a.gold+'g.');
      if(U.kind==='pack'){need(!invOf(a).pack,'You already carry a Wayfarer\'s Pack.');a.gold-=U.price;invOf(a).pack=1;return {ok:true,bought:id,cost:U.price,gold:a.gold,capacity:capOf(a)}}
      let got=0;while(got<n&&a.gold>=U.price&&addUse(a,id,1)){a.gold-=U.price;got++}need(got,'Your pack is full ('+used(a)+'/'+capOf(a)+').');
      return {ok:true,bought:id+' x'+got,cost:got*U.price,gold:a.gold}}
    const k=slot?String(slot):weakestSlot(a);need(k&&SLOTS.includes(k),'No slot to fill.');
    const cur=a.slots[k];need(!(cur&&cur.epic),'An epic holds that slot.');need(slotLevel(a,k)<a.lvl,'Nothing better than your '+(cur?cur.name:'gear')+' (item level '+slotLevel(a,k)+') is for sale at your level.');
    const cost=SHOP_COST(a.lvl);need(a.gold>=cost,'That costs '+cost+'g; you have '+a.gold+'g.');
    refreshEpics(a);a.gold-=cost;const it=makeItem(a.cls,k,a.lvl,zoneFor(a.lvl),{src:'Bought in '+homeOf(a).name,rare:0});
    const old=equip(a,it);if(old)addGear(a,old);a.hp=Math.min(a.hp,maxHp(a));
    if(cost>=REFLECT.TRADE)moment(a,'trade','bought '+itemText(it)+' for '+cost+'g');
    return {ok:true,bought:itemText(it),cost,gold:a.gold,replaced:old?itemText(old)+' (now in your pack)':null}},
  sell(a,{index,npc}){const tr=npc!=null&&npc!==''||!inTown(a)?traderFor(a,npc,PK.TALK):null; // a person who buys (#170)
    if(tr){need(!tr.error,tr.error);const r=npcSell(a,tr,{index});need(!r.error,r.error);return r}
    need(inTown(a),'The auction house is in town.');let tot=0,n=0;
    if(index!=null){const i=Number(index);need(i>=0&&i<used(a),'No pack entry '+index+'.');tot=sellEntry(a,i);need(tot>=0,'That cannot be sold (consumables and quest items are kept).');n=1}
    else{const s=sellLoot(a);tot=s.gold;n=s.n}
    need(n,'Nothing to sell.');a.gold+=tot;if(tot>=REFLECT.TRADE)moment(a,'trade','sold '+n+' thing'+(n>1?'s':'')+' for '+tot+'g');return {ok:true,sold:n,gold_gained:tot,gold:a.gold}},
  auction_browse(a){need(inTown(a),'The auction house is in town.');const ago=l=>Math.max(0,Math.round((l.until-S.gameMin)/60));
    const row=l=>({id:l.id,what:l.kind==='gear'?itemText(l.item):l.good,n:l.n,each:l.ask,seller:l.sname,hours_left:ago(l),...(l.kind==='gear'?{slot:l.item.slot,level:l.item.ilvl,class:l.item.cls||'any',better_by:Math.max(0,gearUpgrade(a,l.item)),wearable:gearUpgrade(a,l.item)>=0}:{})});
    const all=listings();return {ok:true,listings:all.filter(l=>l.seller!==a.id).map(row),yours:all.filter(l=>l.seller===a.id).map(row),recent_trades:(S.trades||[]).slice(0,5).map(t=>t.seller+' sold '+t.what+(t.n>1?' x'+t.n:'')+' to '+t.buyer+' for '+t.gold+'g'),gold:a.gold}},
  auction_list(a,{index,n,price:ask}){need(inTown(a),'The auction house is in town.');const i=Number(index);need(i>=0&&i<used(a),'No pack entry '+index+'.');
    need(mine(a).length<TRADE.MAX_PER_HERO,'You already have '+TRADE.MAX_PER_HERO+' listings.');const e=invOf(a).list[i];
    if(isGear(e)){const ref=gearRef(e),p=ask==null?ref:Number(ask);need(p>=ref*TRADE.MIN_X&&p<=ref*TRADE.MAX_X,'Ask between '+Math.ceil(ref*TRADE.MIN_X)+'g and '+Math.floor(ref*TRADE.MAX_X)+'g for that.');
      invOf(a).list.splice(i,1);const l=listFor(a,{item:e},p);return {ok:true,listed:itemText(e),id:l.id,each:l.ask,lapses_in_hours:TRADE.DAYS*24}}
    need(e.kind==='good'&&(GOODS[e.id]||MATERIALS[e.id]),'Only trade goods and gear can be listed (consumables and quest items are kept).');
    const k=n==null?e.n:Math.floor(Number(n));need(k>=1&&k<=e.n,'You carry '+e.n+' of that.');const ref=goodRef(e.id),p=ask==null?ref:Number(ask);
    need(p>=Math.max(1,Math.floor(ref*TRADE.MIN_X))&&p<=Math.ceil(ref*TRADE.MAX_X),'Ask between '+Math.max(1,Math.floor(ref*TRADE.MIN_X))+'g and '+Math.ceil(ref*TRADE.MAX_X)+'g each for '+e.id+'.');
    e.n-=k;if(e.n<=0)invOf(a).list.splice(i,1);const l=listFor(a,{good:e.id,n:k},p);return {ok:true,listed:e.id+' x'+k,id:l.id,each:l.ask,lapses_in_hours:TRADE.DAYS*24}},
  auction_buy(a,{id,n}){need(inTown(a),'The auction house is in town.');const l=listings().find(x=>x.id===Number(id));need(l,'No listing '+id+' (auction_browse lists them).');
    const r=buyListing(a,l,n);need(r.ok,r.error);if(r.cost>=REFLECT.TRADE)moment(a,'trade','bought '+r.what+' from '+r.seller+' for '+r.cost+'g');return {ok:true,bought:r.what+(r.n>1?' x'+r.n:''),cost:r.cost,seller:r.seller,gold:r.gold}},
  auction_cancel(a,{id}){need(inTown(a),'The auction house is in town.');const l=mine(a).find(x=>x.id===Number(id));need(l,'You have no listing '+id+'.');
    need(cancelListing(a,l),'Your pack is full ('+used(a)+'/'+capOf(a)+').');return {ok:true,returned:l.kind==='gear'?itemText(l.item):l.good+' x'+l.n}},
  equip(a,{index}){need(!['fight','duel','assist'].includes(a.state),'Not in the middle of a fight.');const i=Number(index);
    const it=invOf(a).list[i];need(isGear(it),'No gear at pack index '+index+'.');need(!it.cls||it.cls===a.cls||it.epic,'That is made for a '+it.cls+'.');need(it.ilvl<=a.lvl+INV.WEAR_OVER,'Too far above your level to wear.');
    const old=equipSpare(a,it);a.hp=Math.min(a.hp,maxHp(a));return {ok:true,wearing:itemText(it),replaced:old?itemText(old)+' (now in your pack)':null}},
  shop(a,{npc,all}={}){all=all===true||/^(true|yes|1|all)$/i.test(String(all==null?'':all).trim()); // brief by default (#425); brief:true asks for it too
   const named=npc!=null&&npc!=='',tr=named||!inTown(a)?traderFor(a,npc,PK.TALK):null; // the same seller buy would use
    if(tr&&!tr.error)return shopView(a,tr,all);need(!(tr&&named),tr&&tr.error);
    if(!inTown(a)){const c=homeOf(a),g=c&&c.gate,d=g?Math.hypot(g.x-a.x,g.y-a.y):0;
      throw new Rule('The smiths are in town. '+(g?c.name+' lies '+compass(g.x-a.x,g.y-a.y)+', about '+Math.round(d)+' tiles ('+walkTime(d)+'): move_to {target: "home"}, then shop. ':'')+(tr&&tr.error?tr.error:'Out here only a person who opened their trade with you sells (talk to them, then shop {npc}).'))}
    return shopView(a,null,all)},
  // The gate captain's bounties (issue #67): hand in a finished one, or take one if you hold none. Never handed out unasked.
  turn_in(a,{region}={}){need(inTown(a),'The gate captain is at '+homeOf(a).name+'’s gate ('+Math.round(dist(a,homeOf(a).gate))+' tiles). move_to("home"), then turn_in.');const q=a.quest,doneQ=q&&q.have>=q.need,g=a.gold,l=a.lvl,c=homeOf(a);
    const bt=x=>(MOBS[x.type].q)+': '+x.need+' '+MOBS[x.type].pl+' in '+ZONES[MOBS[x.type].z];
    if(doneQ){turnIn(a);return {ok:true,reward_gold:a.gold-g,leveled:a.lvl>l||undefined,note:'The captain keeps bounties posted: turn_in again to take another (list_jobs shows them).'}}
    if(q)return {ok:false,error:'Your bounty is not done ('+q.have+'/'+q.need+').',bounty:bt(q)};
    need(heldCount(a)<QL.MAX,'You already hold '+QL.MAX+' quests. Finish or abandon_quest one first.');
    const want=clean(region,40).toLowerCase(),z=want?ZONES.findIndex(n=>n&&n.toLowerCase().includes(want)):huntZone(a);need(z>=0,'No region "'+region+'".');
    const b=bountyFor(a,c,z);need(b,'The gate captain has no bounty posted for you in '+ZONES[z]+' right now (list_jobs shows what is posted).');
    takeBounty(a,b);return {ok:true,new_bounty:bt(a.quest),reward:'about '+(4+a.lvl*3)+'g and XP, paid here when done'}},
  read_chronicle(a,{n}){const k=Math.min(20,Math.max(1,Math.round(Number(n)||8))),news=S.chronicle.slice(0,k).map(e=>e.t+' '+plain(e.parts));
    for(const l of news)hear(a,l,'the town criers');return {ok:true,news}}, // the criers' news teaches names and places (#188)
  places:(a,x)=>placesList(a,x||{}), // #414: known places, nearest first
  inspect:(a,x)=>inspectView(a,x||{}), // #425: one person, creature or item, as the hero perceives it
  enter_site:(a,x)=>enterSiteTool(a,x||{}), // #69: a DM-made dungeon site (sim/sites.js)
  examine:(a,x)=>examineView(a,x||{},sightOf(a)), // #525: a closer look at a marked place, landmark or sign; read only
  search(a,x){need(['hunt','town','travel','follow','camp'].includes(a.state),'You cannot search now ('+a.state+'). Not in a fight, a dungeon or on the road home.');
    const r=searchAct(a,x||{},sightOf(a));if(r.ok===false)return r;
    if(a.state!=='camp'&&!(r.result==='already searched')){a.pq=[{kind:'rest',until:S.gameMin+SR.MIN,search:true}];a.dest=null;if(a.state==='travel'||a.state==='follow')a.state='hunt'}
    return r},
  lore(a,{about}){return {ok:true,...loreView(a,about),note:'What you know, in your own words: no one knows the measure of a creature until they have met it or been told.'}},
  // the journal (#153: tiers in sim/tiers.js): without n an overview (landmarks, chapter titles, latest entries) to re-ground on
  journal_read(a,{n}){if(n==null||n==='')return {ok:true,...journalOverview(a)};
    const k=Math.min(50,Math.max(1,Math.round(Number(n)||10)));return {ok:true,entries:(a.journal||[]).slice(-k).map(e=>e.t+': '+e.text),total:(a.journal||[]).length}},
  journal_search:(a,x)=>journalSearch(a,x||{}),
  journal_write(a,{text,landmark}){const t=clean(text,PK.JOURNAL_LEN);need(t,'Write what?');const j=a.journal||(a.journal=[]);tiersOf(a);j.push({t:day(),gameMin:Math.round(S.gameMin),text:t});while(j.length>PK.JOURNAL)spillEntry(a,j.shift()); // the oldest entry folds into a chapter (#153)
    const lm=landmark===true||/^(true|yes)$/i.test(String(landmark||''))?ownMark(a,t):null;
    const m=heroMemory(a,'remember',{title:t.split(/(?<=[.!?])\s/)[0].slice(0,60),text:t,tags:['journal']}); // the entry is also a memory tagged journal (#179)
    return {ok:true,entries:j.length,...(m.ok?{memory:m.remembered.id}:{}),...(lm?lm.ok?{landmark:lm.id}:{note:lm.note}:{})}},
  // memories (issue #155, sim/notebook.js): the hero's own notebook only
  // who you are (#409, sim/persona.js): the hero's own persona, read and grown by its agent
  self:a=>selfView(a),
  become(a,x){const t=x&&x.text!=null?String(Array.isArray(x.text)?x.text.join(', '):x.text):'';need(!t||!notEnglish(t),'Not changed: write it in English, as everyone in Eldmoor speaks.');return become(a,x||{})},
  remember:(a,x)=>heroMemory(a,'remember',x),recall:(a,x)=>heroMemory(a,'recall',x),update_memory:(a,x)=>heroMemory(a,'update_memory',x),forget:(a,x)=>heroMemory(a,'forget',x),pin:(a,x)=>heroMemory(a,'pin',x),
  party_say(a,{text}){need(a.state!=='ghost','Ghosts do not speak.');need(!notEnglish(text),ENGLISH);const no=lineRefusal(a,spokenLine(a,text,1e9).text);need(!no,no); // not the same line again, no second introduction (sim/talk.js)
    const n=partySay(a,text);if(typeof n==='string')throw new Rule(n);const e=a.chat&&a.chat[a.chat.length-1];agentLine(a,e);
    if(e){const H=S.agents.filter(b=>b!==a&&b.chat&&b.chat[b.chat.length-1]===e);noteSaid(a,e.text,H);talked(a,H.map(b=>b.name))}return {ok:true,said:e?e.text:'',heard_by:e&&e.heard||[],too_far:e&&e.far&&e.far.length?e.far:undefined,note:hearNote(e)||undefined}},
  party_read(a,{n}){return {ok:true,lines:partyRead(a,Math.round(Number(n)||10))}},
  earshot(a){return earshot(a)}, // read-only (#395): the same hearer sets say and party_say use
  chat_read(a,{n}){const k=Math.min(20,Math.max(1,Math.round(Number(n)||10)));return {ok:true,lines:(a.chat||[]).slice(-k).map(e=>e.t+' '+(e.from===a||e.from&&e.from.kind!=='npc'&&e.from.id===a.id?'(you) '+(e.whisper?'(whispered to '+e.toName+') ':e.emote&&!e.veil?'*':'')+e.text+(e.emote&&!e.veil?'*':''):heardText(e)))}},
  propose(a,{kind,details,job_id,meet_at,meet_in_hours,hero_id,company}){need(companyOf(a),'Only a member of a company can put something to the party.');const k=String(kind||'').toLowerCase();
    // a second break_camp while one is open is a yes on it (#400): the agent wants exactly what is already asked
    if(k==='break_camp'){const O=openProps(companyOf(a)).find(P=>P.kind==='break_camp');if(O)return secondBreak(a,O,details)}
    const P=propose(a,k,details,{job:job_id,where:meet_at,hours:meet_in_hours,hero:hero_id,company});
    if(typeof P==='string')throw new Rule(P);return {ok:true,proposal:propText(P),status:P.status,note:P.status==='open'?'The others vote; the leader settles it when all have voted or in '+Math.round(P.until-S.gameMin)+' game minutes.'+(P.absent&&P.absent.length?' Out of shouting range, so not asked: '+nameList(S.agents.filter(x=>P.absent.includes(x.id)))+'.':''):P.result}},
  vote(a,{proposal_id,vote,reason}){const C=companyOf(a);need(C&&C.ids.length>1,C?'You ride alone: there is nothing to vote on.':'Only members of a company vote.');const P=propById(proposal_id,C);need(P,noProposal(proposal_id,C));
    const sc=tableView(a);if(sc&&sc.kind==='decision'&&!sc.acted&&sceneOf(a)&&sceneOf(a).ctx.prop===P.id){const x=sceneAct(a,vote,reason);if(typeof x==='string')throw new Rule(x);return {ok:true,voted:x.k,note:'Counted at the table on your turn.'}}
    const x=castVote(a,P.id,vote,reason,'agent');if(typeof x==='string')throw new Rule(x);return {ok:true,voted:String(vote).toLowerCase(),proposal:propText(P)}},
  break_camp(a){need(companyOf(a),'Only a member of a company can break camp.');
    // a member who does not lead calls for it instead (#400): the call goes to the vote, or is a yes on the open one
    if(a.state==='camp'&&leaderFor(a)!==a){const O=openProps(companyOf(a)).find(P=>P.kind==='break_camp');if(O)return secondBreak(a,O,'');
      const P=propose(a,'break_camp','',{});if(typeof P==='string')throw new Rule(P);
      return {ok:true,proposal:propText(P),status:P.status,note:'Only the leader ('+(leaderFor(a)?leaderFor(a).name:'none')+') breaks camp outright, so your call went to the vote as proposal #'+P.id+' (your vote: yes).'+(P.status==='open'?'':' '+P.result)}}
    const e=leaderBreak(a);if(e)throw new Rule(e);return {ok:true,broke_camp:true}},
  lead_to(a,{target}){need(!inSlots(a)||a.state!=='camp',campBlock(a)||'The Fellowship is camped.');
    need(inSlots(a)&&a.party&&partySlotted(a.party),'You are not with the Fellowship.');need(a.party.leader===a,'Only the leader ('+a.party.leader.name+') leads the party.');
    need(legal.includes(a.state),'You cannot lead from here ('+a.state+').');need(a.state!=='fight'&&a.state!=='duel'&&a.state!=='assist','You are in a fight. flee() first.');
    const p=plan(a,target);if(p.error)throw new Rule(p.error);a.pq=[{kind:'move',legs:p.legs,last:p.last,label:p.label}];if(a.state==='follow')a.state='hunt';a.dest=null;
    const n=followLead(a,p.label);const r={ok:true,leading:p.label,followers:n};const far=outOfRange(a);if(far.length)r.not_told=nameList(far)+' too far away to hear the order; they stay where they are until you are together or a courier reaches them.';if(p.warn)r.warning=p.warn;if(p.note)r.note=p.note;return r},
  post_notice(a,{text}){need(inTown(a),'Notices are pinned at your town board. Go home first.');need(!notEnglish(text),ENGLISH);const c=homeOf(a),n=postNotice(a,text,c.name);need(!n.error,n.error);
    record(a,'Pinned a notice at ',c.name,'.');return {ok:true,posted:n.text,town:c.name,lapses_in_days:SIGHT.NOTICE_DAYS,note:'Anyone who reads the board at '+c.name+' learns your name and this text. Ask for them at the inn.'}},
  send_courier(a,{to,text}){need(companyOf(a),'Only an agent hero can hire a courier.');need(!notEnglish(text),ENGLISH);const r=sendCourier(a,to,text);if(r.error)throw new Rule(r.error);
    return {ok:true,to:r.msg.toName,cost:r.msg.cost,gold:a.gold,arrives_in_hours:r.hours,note:'The courier rides out; the message arrives as an event after that many game hours. A reply needs its own courier from a town gate.'}},
  scene_act(a,{option,line}){const x=sceneAct(a,option,line);if(x===FRAMING)return {ok:false,error:x,offline:true,waiting_for:'the DM'}; // not a failed turn (#682)
    if(typeof x==='string')throw new Rule(x);const v=tableView(a);
    return {ok:true,chose:x.k,said:x.line||undefined,waited_s:waitedS(sceneOf(a),a),note:v&&v.everyone_answers?'Locked in; the table resolves once everyone present has answered ('+v.answered+').':v&&v.your_turn?'Done; it happens now.':'Locked in; it happens on your turn.'}},
  // ---- professions and gathering (#257): only the caller's own hero ----
  recipes(a,{profession}={}){let id=null;if(profession!=null&&String(profession).trim()){id=profKey(profession);
      need(id,'There is no profession called "'+clean(profession,40)+'". Leave it out for all of yours, or name one: herbalism, mining, skinning, fishing, alchemy, smithing, leatherworking, cooking, scribing.')}
    return recipesView(a,id)},
  learn_profession(a,{id,profession}={}){const v=id!=null&&String(id).trim()!==''?id:profession;
    need(v!=null&&String(v).trim()!=='','Which profession? learn_profession {id: "herbalism"} (recipes lists them all and what each does).');
    const ct=cityAt(a),here=inTown(a)||!!(ct&&ct.fac===a.fac);
    const r=learnProfession(a,v,{inTown:here});need(r.ok,r.why+(r.why&&/^Trainers/.test(r.why)&&ct&&ct.fac!==a.fac?' '+ct.name+' is not a town of your side.':''));return r},
  unlearn_profession(a,{id,profession}={}){const v=id!=null&&String(id).trim()!==''?id:profession;
    need(v!=null&&String(v).trim()!=='','Which profession? unlearn_profession {id: "<one you hold>"}; recipes lists yours. Its skill is lost for good.');
    need(!(a.pq||[]).some(c=>c.kind==='gather'),'You are gathering right now; let it finish (wait) or give another order first.');
    const r=unlearnProfession(a,v);need(r.ok,r.why);return r},
  outposts(a){const L=outpostsView().filter(o=>dist(a,o)<=30||knowsPlace(a,ZONES[o.region])).map(o=>({name:o.name,region:ZONES[o.region],dir:compass(o.x-a.x,o.y-a.y),tiles:Math.round(dist(a,o)),held_by:o.held_by||'nobody',control:o.control,contested:o.contested,standing_there:o.present.map((n,f)=>n?n+' '+FAC[f].name:null).filter(Boolean).join(', ')||'nobody',yours:o.holder===a.fac}));
    return {ok:true,outposts:L,note:L.length?'move_to an outpost by name and stay in its ring to contest it.':'You know of no outposts yet: explore the roads of the middle regions.'}},
  nodes(a,{kind}={}){const R=sightOf(a),k=kind!=null&&String(kind).trim()?String(kind).toLowerCase().trim():null;
    const kk=k?(['herb','ore','hide','fish'].find(x=>k.startsWith(x))||({herbalism:'herb',mining:'ore',skinning:'hide',fishing:'fish'})[profKey(k)]||null):null;
    need(!k||kk,'kind is one of herb, ore, hide or fish (or leave it out for every kind).');
    if(inTown(a)||cityAt(a))return {ok:true,nodes:[],note:'No gathering spot lies inside the walls: herb patches, ore veins, game trails and fishing spots are out in the world.'};
    const L=nodesView(a,R,kk);
    const r={ok:true,sight:Math.round(R)+' tiles',nodes:L};
    if(!L.length)r.note='No gathering spot'+(kk?' of that kind':'')+' in sight. Walk on and look again.';
    else r.how='gather {node: "<node id>"} walks you there and works it (about '+GATHER.MIN+' game minutes at the spot).';
    return r},
  gather(a,{node,kind}={}){const v=node!=null&&String(node).trim()!==''?node:kind;
    need(!inTown(a)&&!cityAt(a),'Nothing is gathered inside the walls: herb patches, ore veins, game trails and fishing spots lie out in the world. Walk out (move_to or hunt {where}), then nodes and gather.');
    need(a.state!=='camp',campBlock(a)||'The Fellowship is camped.');
    need(!['fight','duel','assist'].includes(a.state),'You are in a fight. Finish it or flee() first.');
    need(fieldState(a),'You cannot gather now ('+a.state+').');
    const p=pickNode(a,v,sightOf(a));need(p.node,p.why);const n=p.node,c=canGather(a,n);
    need(c.ok,c.why+(c.need?' learn_profession {id: "'+c.need+'"} at a trainer in town'+((a.profs||[]).length>=2?' (you hold two already: unlearn_profession one first)':'')+'.':''));
    a.pq=[{kind:'gather',node:n.id,label:n.name}];if(a.state!=='hunt')a.state='hunt';a.dest=null;
    const d=Math.round(dist(a,n)*10)/10;
    return {ok:true,gathering:n.name+' ('+n.id+')',material:c.mat,distance:d,takes:'about '+Math.round(GATHER.MIN+d*3)+' game minutes',
      odds:c.chance>=.7?'a sure hand':c.chance>=.5?'likely':'a stretch for your skill',note:'wait() while you work; an attack interrupts and you go back to it after the fight.'}},
  smith(a,args={}){const ct=cityAt(a),here=inTown(a)||!!(ct&&ct.fac===a.fac);const r=smithTool(a,args,{inTown:here});need(r.ok,r.why);return r},
  craft(a,{recipe,count,for:forWho}={}){need(recipe!=null&&String(recipe).trim()!=='','Which recipe? craft {recipe: "meal-perch"}; recipes lists yours, what each needs and how many you carry.');
    need(!['fight','duel','assist','dead','ghost'].includes(a.state),'Not now ('+a.state+').');
    const ct=cityAt(a),here=inTown(a)||!!(ct&&ct.fac===a.fac); // crafting (#258): a friendly town's workshops, or the camp fire
    const r=craftTool(a,{recipe,count,for:forWho},{inTown:here});need(r.ok,r.why);return r},
  wait(a,{minutes}){const tv=tableView(a); // #163: no waiting out your own turn at the table (a local model waited instead of acting)
    if(tv&&!tv.acted&&tv.options&&(tv.your_turn||(tv.phase==='frame'&&sceneOf(a).ids[0]===a.id)))throw new Rule('It is your turn at the table: call scene_act with one of: '+tv.options.map(o=>o.split(' = ')[0]).join(', ')+'.');
    let m=Math.min(PK.WAIT[1],Math.max(PK.WAIT[0],Math.round(Number(minutes)||60)));
    const noAim=!aimHeld(a)&&m>INTENT.WAIT_NOAIM;if(noAim)m=INTENT.WAIT_NOAIM; // waiting needs a reason and a limit (#535)
    return {ok:true,pending:{hero:a.id,from:S.gameMin,until:S.gameMin+m,mark:a.playEvN||0,realMs:PK.WAIT_REAL_MS,...(noAim?{limit:'You have no aim stated, so the wait is held to '+INTENT.WAIT_NOAIM+' game minutes. intent {goal, why, until} says what you wait for.'}:{})}}},
  // the stated aim (#535, sim/intent.js): read it, state it, or set it down
  // gambits (#617): the hero's own rules; edits never refused for being unwise, only for words outside the vocabulary or the day's limit
  gambits(a,{vocabulary}={}){return gambitsView(a,{vocab:/^(yes|true|1)$/i.test(String(vocabulary||''))})},
  set_gambit(a,args={}){const r=setGambit(a,args);need(r.ok,r.error);return r},
  move_gambit(a,args={}){const r=moveGambit(a,args);need(r.ok,r.error);return r},
  toggle_gambit(a,args={}){const r=toggleGambit(a,args);need(r.ok,r.error);return r},
  drop_gambit(a,args={}){const r=dropGambit(a,args);need(r.ok,r.error);return r},
  reset_gambits(a,args={}){const r=resetGambits(a,args);need(r.ok,r.error);return r},
  intent(a,{goal,why,until,done}={}){const g=goal!=null?String(goal).trim():'';
    if(/^(yes|true|done|kept|abandon(ed)?|drop(ped)?)$/i.test(String(done==null?'':done))||/^(done|none|nothing)$/i.test(g))return endIntent(a,why);
    if(!g)return intentView(a,leaderFor(a));
    need(!notEnglish(g+' '+(why||'')),'Not set: say it in English, as everyone in Eldmoor speaks.');
    const c=a.pq&&a.pq[0],order=orderOf(a,c&&!c.auto?(c.kind==='move'&&a.pq[1]&&a.pq[1].kind==='hunt'?a.pq[1]:c):null)||goalOrder(a,g);
    const r=setIntent(a,{goal:g,why,until},order);if(r.ok===false)throw new Rule(r.error);
    const sh=shoutAim(a);if(sh){r.shouted=sh.heard_by.length?'heard by '+sh.heard_by.join(', '):'no one was near enough to hear';if(sh.too_far)r.too_far=sh.too_far}
    return r},
};
// A quest the hero holds, by its id from quests (a bare number is a job id).
function findQ(a,id){const L=questLog(a),s=String(id==null?'':id).trim(),n=parseJob(s);return L.active.find(x=>x.id===s)||(n!=null?L.active.find(x=>x.id==='job:'+n):null)||null}
// A second call to break camp while a break_camp proposal is open: the caller's yes on it, never a refusal (#400).
function secondBreak(a,P,reason){const had=P.votes[a.id]&&P.votes[a.id].v==='yes';
  if(!had){const x=castVote(a,P.id,'yes',clean(reason,120),'agent');if(typeof x==='string')throw new Rule(x)}
  return {ok:true,proposal:propText(P),status:P.status,your_vote:had?'yes (you had already said yes)':'yes (counted on the open proposal #'+P.id+')',
    note:P.status==='open'?'The proposal to break camp was already open, so your call counts as a yes. The leader settles it when all have voted.':P.result}}
function propText(P){const v=Object.keys(P.votes||{}).length;return '#'+P.id+' '+P.kind+': '+P.details+' (by '+P.byName+', '+v+' vote'+(v===1?'':'s')+(P.status!=='open'?', '+P.result:'')+')'}
function cmdText(c){if(c.kind==='move')return (c.flee?'flee to ':'walk to ')+c.label;if(c.kind==='hunt')return 'hunt ('+c.n+' kills)';if(c.kind==='rest')return 'rest until '+Math.round(c.until)+' game-min';if(c.kind==='fight')return 'fight #'+c.id;if(c.kind==='follow')return 'follow '+c.name+(c.until!=null?' until '+Math.round(c.until)+' game-min':'');return c.kind}
// A pack entry by name (#412, give): case-insensitive, exact name first, then a consumable kind ("potion") or a
// partial name; "2 rations" or "all rations" also sets the count. Copied inventory text ("Redroot Draught x3 (...)") reads too.
// Returns {index, all, name, count?} or {error} listing the matches (with pack indexes) or what the pack holds.
const entryName=e=>isGear(e)?e.name:e.id;
const normName=t=>String(t).toLowerCase().replace(/\([^)]*\)?/g,' ').replace(/\[[^\]]*\]?/g,' ').replace(/[^a-z0-9' ]+/g,' ').replace(/'/g,'').replace(/\s+/g,' ').trim();
const oneWord=w=>w.length>3&&/ies$/.test(w)?w.slice(0,-3)+'y':w.length>3&&/(ch|sh|x|ss)es$/.test(w)?w.slice(0,-2):w.length>3&&/[^s]s$/.test(w)?w.slice(0,-1):w;
const singular=t=>t.split(' ').map(oneWord).join(' ');
function packList(a){const L=invOf(a).list;if(!L.length)return 'Your pack is empty.';
  return 'Your pack: '+L.slice(0,5).map((e,i)=>i+': '+entryName(e)+(isGear(e)?'':' x'+e.n)).join('; ')+(L.length>5?'; and '+(L.length-5)+' more (inventory lists them all)':'')+'.'}
function packFind(a,raw,verb='Give'){let q=normName(raw),count;
  const lead=q.match(/^(\d+|all|every|my)\s+(?:of\s+)?(?:the\s+|my\s+)?(.+)$/);if(lead){if(/^\d+$/.test(lead[1]))count=Number(lead[1]);else if(lead[1]!=='my')count='all';q=lead[2]}
  q=q.replace(/\s+x\s*\d+$/,'').replace(/^(a|an|the|some)\s+/,'').trim();
  if(!q)return {error:verb+' what? Name an item from your pack. '+packList(a)};
  const L=invOf(a).list,sq=singular(q),words=sq.split(' ');const tiers=[[],[],[]];
  L.forEach((e,i)=>{const nm=normName(entryName(e)),sn=singular(nm);
    if(nm===q||sn===sq)tiers[0].push(i);
    else if(!isGear(e)&&e.kind==='use'&&USES[e.id]&&(USES[e.id].kind===sq||USES[e.id].kind===q))tiers[1].push(i);
    else if(sn.includes(sq)||words.every(w=>sn.split(' ').some(x=>x.startsWith(w))))tiers[2].push(i)});
  let hit=tiers.find(t=>t.length);
  if(!hit)return {error:'You carry nothing called "'+clean(String(raw),40)+'". '+packList(a)};
  if(hit.length>1){const free=hit.filter(i=>isGear(L[i])||L[i].kind!=='quest');if(free.length)hit=free} // a quest item never goes, so it never makes a name ambiguous
  const first=L[hit[0]],same=hit.every(i=>!isGear(L[i])&&!isGear(first)&&L[i].id===first.id); // two stacks of one thing are one thing
  if(hit.length>1&&!same)return {error:'"'+clean(String(raw),40)+'" matches '+hit.length+' things in your pack: '+hit.map(i=>i+': '+entryName(L[i])+(isGear(L[i])?'':' x'+L[i].n)).join('; ')+'. '+verb+' the one you mean by its index, or its full name.'};
  if(count==='all')count=isGear(first)?1:hit.reduce((t,i)=>t+L[i].n,0);
  return {index:hit[0],all:hit,name:entryName(first),count}}
function entryText(e){if(isGear(e))return itemText(e)+(e.cls&&!e.epic?' ['+e.cls+' gear]':'')+', sells '+SELL_VALUE(e)+'g';
  if(e.kind==='good')return e.id+' x'+e.n+(GOODS[e.id]||MATERIALS[e.id]?' (sells for about '+price(e.id)+'g each'+(MATERIALS[e.id]?'; a crafting material':'')+')':'');
  if(e.kind==='use')return e.id+' x'+e.n+' ('+useLines(e.id).map(l=>l[1]).join('; ')+')';
  return e.id+' (quest item: cannot be sold, dropped or given)'}
function itemText(it){if(!it)return null;const st=itemStats(it);return it.name+' (ilvl '+it.ilvl+(it.epic?', epic':it.quality&&it.quality!=='plain'?', '+it.quality:'')+(it.slot?', '+it.slot:'')+': '+Object.keys(st).map(k=>'+'+st[k]+' '+k).join(' ')+(it.property?' '+it.property:'')+')'}
function jobText(h){const T=D.ADVENTURES[h.tpl];const thing=h.data&&h.data.thing;return (T&&T.name?T.name:h.tpl)+(thing?': '+thing:'')+(h.data&&h.data.beast?' ('+h.data.beast+')':'')}
// Why a job does not suit this hero (and party), or null. The DM's own fits() decides in the end.
// A refusal for level names the way on (#466): hunt to grow, with the ground that fits, and who follows; never a dead end
// that leaves a company at the gate.
function growHint(a,w,mem){if(!/^needs level/.test(w))return '';const lo=mem.reduce((x,b)=>b.lvl<x.lvl?b:x,a),z=groundFor(lo);
  const g=z!=null?ZONES[z]:null,n=mem.length-1;
  return ' Grow first: '+(g?'hunt {where: "'+g+'"}':'hunt out in the world')+(n?(a.party&&a.party.leader===a?' and your companions follow you out':'; tell the others where you hunt'):'')+'. Left at the gate, autopilot hunts there too.'}
function jobFit(a,h,mem){const T=D.ADVENTURES[h.tpl];if(!T)return 'unknown job';const lo=Math.min(...mem.map(b=>b.lvl));
  if(h.for!=null&&!mem.some(b=>b.id===h.for))return 'it is meant for someone else';
  if(lo<Math.max(DMK.MIN_LVL,T.lvl||0))return 'needs level '+Math.max(DMK.MIN_LVL,T.lvl||0);
  if(mem.length<T.size[0])return 'needs a party of '+T.size[0]+'+';if(mem.length>T.size[1])return 'for at most '+T.size[1];
  if(h.data&&h.data.eliteId!=null&&mem.length<2)return 'a hunt for a named beast needs a party';
  return null}

// ---- the entry point ----
const TOOL_META=Object.fromEntries(PLAYER_TOOLS.map(t=>[t.name,t]));
export function playerAct(id,tool,args={}){const a=hero(Number(id));
  if(!a)return {ok:false,error:'No such hero.'};
  if(!a.player)return {ok:false,error:a.name+' is not agent-played.'};
  if(a.state==='dead'){const r={ok:false,dead:true,error:a.name+' is dead ('+(a.cause||'fallen')+', at '+(a.diedAt||'?')+'). Hardcore: one life. Their story is over.'};logCall(a,tool,args,r);return r}
  const meta=TOOL_META[tool],fn=T[tool];if(!meta||!fn)return {ok:false,error:'Unknown tool '+tool+'.'};
  if(meta.act){const why=worldHeld();if(why){const r={ok:false,held:why,offline:true,error:holdLine()};logCall(a,tool,args,r);return r}} // held before play (#559): look, recall and the other reads still answer
  if(args&&args._pool===true&&(tool==='recall'||tool==='journal_search'))return fn(a,args); // the relay's ask for the texts it embeds (#553): not a turn, not logged
  if(meta.act){const st=a.playRate||(a.playRate=[]);while(st.length&&st[0]<S.gameMin-60)st.shift();
    if(st.length>=PK.RATE){const r={ok:false,error:'Slow down: at most '+PK.RATE+' actions per game hour. Try wait().',retry_after_min:Math.ceil(st[0]+60-S.gameMin)};logCall(a,tool,args,r);return r}
    st.push(S.gameMin)}
  a.playFresh=false;if(tool==='wait')turnEnd(a);else if(a.playTurn==null)turnStart(a); // the turn is open while the agent calls tools; a wait hands the world back (#240)
  const q0=a.pq&&a.pq[0];let r;try{r=asSrc('agent',()=>fn(a,args&&typeof args==='object'?args:{}))}catch(e){r=e instanceof Rule?{ok:false,error:e.message}:{ok:false,error:'The world did not understand that ('+String(e&&e.message||e).slice(0,120)+').'}}
  if(r&&r.ok===false){const w=sinceLook(a,args);if(w){r.error=r.error+' '+w;r.changed=w}} // a refused order says what moved on since the agent looked (#240)
  if(r&&!r.pending){r.as_of=day();const L=a.playLook,m=L?Math.round(S.gameMin-L.gm):null;if(m!=null&&m>PK.STALE)r.since_look=m+' game min since your last look'}
  if(meta.act&&r&&r.ok!==false){holdAnswered(a);a.playActAt=S.gameMin;a.playIdle=false;a.playAuto=null;if(tool==='hunt'){const h=(a.pq||[]).find(c=>c.kind==='hunt');if(h)a.playOrder={kind:'hunt',n:h.n,flee:h.flee,prey:h.prey}}
    if((tool==='move_to'||tool==='hunt'||tool==='follow'||tool==='rest')&&a.intent&&!a.intent.done&&!a.intent.order){const c=a.pq&&a.pq[0];attachOrder(a,orderOf(a,c&&c.kind==='move'&&a.pq[1]&&a.pq[1].kind==='hunt'?a.pq[1]:c,tool==='move_to'?args&&args.target:null))} // a command under an aim with none becomes its order (#535)
    if(tool==='follow'){const f=a.pq[0];a.playOrder={kind:'follow',id:f.id,until:f.until,h:f.h}}else if(a.playOrder&&a.playOrder.kind==='follow'&&(a.pq&&a.pq[0])!==q0)a.playOrder=null} // a new order ends a standing follow (#445) // the agent's last action that went through (autopilot, #126)
  if(!r.pending){const evs=takeEvents(a);if(evs.length)r.events=evs}
  if(!r.pending&&tool!=='scene_act'){const tv=tableView(a),n=tv&&tv.options?waitsNote(a,tv.options):null;if(n)r.table_waits=n} // a turn in flight when the scene opened learns of it at its next call (#515)
  logCall(a,tool,args,r);return r}

// The wait tool: the host polls waitOver and then calls finishWait (sim/player-host.js).
export function waitOver(p){const a=hero(p.hero);if(!a||a.state==='dead'||!a.player)return true;if(S.gameMin>=p.until)return true;
  return (a.playEv||[]).some(e=>e.n>p.mark&&e.u)}
export function finishWait(p,realOut){const a=hero(p.hero);if(!a)return {ok:false,error:'No such hero.'};
  const r={ok:true,waited_min:Math.round(S.gameMin-p.from)};r.as_of=day();
  if(a.state==='dead')Object.assign(r,{ok:false,dead:true,error:a.name+' died ('+(a.cause||'fallen')+'). Hardcore: one life.'});
  else{r.why=S.gameMin>=p.until?'time passed':realOut&&tableView(a)?'the world is paused for a scene at the table':realOut?'the world is paused or slow; nothing much happened':'something needs you';
    if(p.limit)r.limit=p.limit;r.hp=pct(a.hp,maxHp(a))+'%';r.state=a.state;r.doing=a.playDoing||null;const ch=choiceInfo(a);if(ch)r.choice=ch;const tv=tableView(a);if(tv){r.table=tv;const n=tv.options?waitsNote(a,tv.options):null;if(n)r.table_waits=n}}
  const evs=takeEvents(a);if(evs.length)r.events=evs;
  const e=(a.playLog||[])[0];if(e&&e.tool==='wait'&&e.pending){e.pending=false;e.text=summarize(r)}
  return r}

// Recent tool calls for the Agent tab: newest first, short text.
function logCall(a,tool,args,r){const L=a.playLog||(a.playLog=[]);
  L.unshift({t:clockStr(),d:dayNo(),tool,args:argText(args),ok:r.ok!==false,pending:!!r.pending||undefined,text:r.pending?'waiting...':summarize(r)});if(L.length>PK.LOG)L.pop()}
const argText=x=>{if(!x||typeof x!=='object')return '';const k=Object.keys(x).filter(j=>j[0]!=='_');return k.length?clean(k.map(j=>j+'='+(typeof x[j]==='string'?'"'+x[j]+'"':x[j])).join(' '),120):''};
function summarize(r){if(r.ok===false)return 'x '+clean(r.error,160);const skip={ok:1,events:1,pending:1,as_of:1,since_look:1,changed:1,table_waits:1};
  return clean(Object.keys(r).filter(k=>!skip[k]).map(k=>{const v=r[k];return k+': '+(typeof v==='string'||typeof v==='number'?v:Array.isArray(v)?v.length+' item'+(v.length===1?'':'s'):v&&typeof v==='object'?'{...}':String(v))}).join(' · '),200)}

// The runner's narration (the agent's own text between tool calls), for the Agent tab.
export function playerNarrate(id,text){const a=hero(Number(id));if(!a||!a.player)return false;const t=clean(text,600);if(!t)return false;
  const N=a.playNarr||(a.playNarr=[]);N.unshift({t:clockStr(),d:dayNo(),text:t});if(N.length>PK.NARR)N.pop();return true}

// Agent-played heroes (issue #93: several at once, one agent each). With an id, these answer
// for that hero only (null when it is not agent-played); without one, the old single-hero path:
// playerHero() the first living agent-played hero, playerSeat() that hero or, when every agent
// hero has died, the last of them (its tools then answer "dead").
const seatOf=id=>{const a=hero(Number(id));return a&&a.player?a:null};
export const playerHero=id=>{if(id!=null){const a=seatOf(id);return a&&a.state!=='dead'?a:null}
  return (S.playerHeroes||[]).map(hero).find(a=>a&&a.player&&a.state!=='dead')||null};
export const playerSeat=id=>id!=null?seatOf(id):playerHero()||(S.playerHeroes||[]).map(hero).filter(a=>a&&a.player).pop()||null;
// Every agent-played hero, living or dead, in the order they were marked.
export const playerSeats=()=>(S.playerHeroes||[]).map(hero).filter(a=>a&&a.player);
export {CHOICE_MIN};
