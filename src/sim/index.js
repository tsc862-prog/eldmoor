// Simulation entry point. DOM-free: the browser (src/main.js) and the headless
// harness (scripts/headless.mjs) both import init() and step() from here.
import {rnd,seedRng} from '../core/rng.js';
import {homeOf,raceOf} from '../data/races.js';
import {CLSN} from '../data/classes.js';
import {S,newWorldId,resetS} from './state.js';
import {GOODS} from '../data/items.js';
import {CRYPT} from '../world/map.js';
import {reserveNames} from '../data/races.js';
import {log,fac} from './chronicle.js';
import {updFx} from './effects.js';
import {makeHero,updAgent} from './heroes.js';
import {spawnAll,updMob,ecologyTick} from './mobs.js';
import {partyTick} from './party.js';
import {weatherTick} from './weather.js';
import {encountersTick} from './encounters.js';
import {updBoss,raidCheck} from './boss.js';
import {pvpCheck} from './pvp.js';
import {dungeonCheck} from './dungeon.js';
import {updMarket} from './market.js';
import {chatTick} from './chat.js';
import {npcsTick} from './npcs.js';
import {talkTick} from './talk.js'; // NPC conversations (#170)
import {rulingTick} from './ruling.js'; // free actions ruled by the DM (#522)
import './talkscene.js'; // a talk that turns into a decision opens a Table scene (#407)
import {localsTick} from './locals.js'; // arrival news and hails for the Fellowship's agents
import {narratorTick} from './narrator.js';
import {goalsTick} from './goals.js';
import {guildsTick} from './guilds.js';
import {rivalsTick} from './rivals.js';
import {focusTick} from './guildfocus.js'; // guild focus (#6)
import {rebuild} from './spatial.js';
import {bondsTick} from './bonds.js';
import {brainTick} from './brain.js';
import {dmTick} from './dm.js';
import {leverTick} from './levers.js';
import {memorialsTick} from './memorials.js';
import {playerUpd} from './player.js';
import {slotsTick} from './company.js'; // the slotted company's muster, watch and replacement (#588)
import {councilTick} from './council.js';
import {companionTick} from './offers.js'; // offers lapse, companies of 2+ keep a walking party, companions (#442)
import {tableTick,tableHold} from './table.js';
import {holdTick} from './gambithold.js';
export {holdResume,holdView,holdRelease} from './gambithold.js';
import './events.js'; // DM world events: festival and plague (#10)
import './crawl.js'; // the Fellowship's dungeon crawl, room by room at the Table (#65)
import {sessionTick,planOpening} from './arrival.js';
import {iqTick} from './interrogate.js'; // a yielded foe questioned at the table (#431 slice 3)
import {fireTick} from './fireside.js'; // talk round the fire and a debrief after a hard scene (#571) // session zero (#437) and a fallen member's recruit (#452)
import {legendsTick} from './legends.js';
import {campTick} from './camp.js';
import {opening} from './opening.js';
import {resetMats} from './gather.js'; // gathered materials at the auction house (#257)
import {questTick} from './questlog.js'; // several quests per hero
import {held} from './scenes.js'; // the engaged of a live-clock Table scene stay put (#518)

export {S,clockStr} from './state.js';
export {log,onLog,gold,epic,fac} from './chronicle.js';
export {onMarketTick} from './market.js';
export {xpNeed,maxHp,atkOf} from './heroes.js';
export {spatialStats} from './spatial.js';
export {actionLog,fightSummary,fights} from './actlog.js'; // action log (recording only)
export {snapshot,restore,isSave,describeSave,SAVE_VERSION} from './save.js';
export {enableBrain,disableBrain,brainStatus,setRunnerMind} from './brain.js';
export {markPlayer,playerAct,playerHero,playerSeat,playerSeats,playerNarrate} from './player.js';
export {foundSlots,autoPick,disbandSlots,slotMembers,slotHeroes,setSlotMinds,slotted} from './company.js'; // the five places (#588)
export {TABLE,bannerOf,decisionsWaiting} from './table.js';
export {setRunnerLinks,setReflexAck,agentLive,reflexMay,ownerHeld,runnerLink} from './runlink.js'; // the Fellowship's decisions wait for its runners (#148)
export {fellowshipStart,START_BANDS} from './opening.js';
export {defaultSetup,validateSetup,cleanSetup,applyPreset,PRESETS,suggestName,CLAUDE_MODELS,SETUP_PROVIDERS,slotClasses,slotLabel,planRunners,ARCHETYPE_RANDOM,resolveArchetype,slotsView,asV2,MODES,SHAPE_PRESETS,MIND_PRESETS,SEATS,seatCap,seatNote} from './setup.js'; // New World setup (#133; v2 #453)
export {dmAct,dmSeatOn,setDmSeat,dmAgentView} from './dmagent.js'; // the DM as an agent (#66)
export {setDmAlive,gone as dmGone,dmAlive} from './dmreflex.js'; // the DM's reflexes: the host's word on its runner (#561)
import {ensureCampaign,dreamTick} from './dmagent.js';
export {provideCampaigns,parseCampaign,campaignIdOf} from './campaign.js'; // the campaign seed
export {questLog,QL} from './questlog.js'; // the quest log: board, DM and oath quests, one in focus
export {planOpening,openingDue,openingPending,arrivalsView,ARRIVE} from './arrival.js'; // session zero and arrivals (#437, #452)
export {PREP,beginPrep,endPrep,prepTick,prepView,prepActive,setPrepHost,setGateHold,worldHeld,holdLine} from './prep.js'; // the DM's prep before the table opens (#437)

// Populate the world: monsters, 14 heroes per faction, the opening chronicle. By default the
// Fellowship is founded at level 1 and the others start at varied levels (sim/opening.js, #111);
// o.fellowship=false (or ELDMOOR_FELLOWSHIP=0 / ?fellowship=0) keeps the old all-level-1 start.
// What a process starts with outside S: the auction house's opening supply and the Crypt's cooldown (init() puts them back, #507).
const GOODS0={};for(const n in GOODS)GOODS0[n]={supply:GOODS[n].supply,prev:GOODS[n].prev};
const CRYPT_CD0=CRYPT.cd;
function resetWorld(){resetS();
  for(const n in GOODS0){GOODS[n].supply=GOODS0[n].supply;GOODS[n].prev=GOODS0[n].prev}
  CRYPT.group=null;CRYPT.cd=CRYPT_CD0;reserveNames([],[])}
export function init(o={}){resetWorld();
  S.worldId=newWorldId(); // a new world instance (hosts purge the old world's memory mirror on a new id)
  resetMats(); // a new world's auction house opens with the materials table's stock
  const seeded=!!(o.setup&&o.setup.seed!=null);
  if(seeded)seedRng(o.setup.seed); // the same setup and seed build the same world (sim/setup.js, #133)
  spawnAll();
  for(let f=0;f<2;f++)for(let i=0;i<14;i++)makeHero(f,CLSN[i%CLSN.length],null,i*.6+rnd()*1.5);
  try{opening(o)}finally{if(seeded)seedRng(null)}
  if(o.setup)planOpening(); // a new world from the setup page opens with session zero, once a host with runners holds it (#437)
  ensureCampaign(); // the DM's notes start from the world's campaign seed, when the host provided one
  log({t:'Kragmaw the Cinder Wyrm',c:'gd'},' sleeps in its lair beyond Cinderpass.');
  log('No guild yet holds a banner, and ',{t:'The Sunken Crypt',c:'gd'},' waits beneath Mirefen.');
  log({t:'Hardcore rules:',c:'gd'},' every hero has one life. The fallen stay fallen.');
}

// Advance the world by dt real seconds at 1x (6 game minutes per second).
export function step(dt){rulingTick(); // a ruling the DM let lapse is filled even while a Table scene holds the world (no-op without S.rulings)
  if(holdTick(dt)){updFx(dt);return} // a gambit hold stops the clock until the agent acts (#630)
  if(tableHold(dt)){updFx(dt);return} // Table mode (#68): at 1x a Fellowship scene stops the world clock until it resolves
  S.gameMin+=dt*6;
  for(let i=S.recruits.length-1;i>=0;i--){const r=S.recruits[i];r.t-=dt;if(r.t>0)continue;S.recruits.splice(i,1);
    const a=makeHero(r.fac,r.cls,null,1);if(rnd()<.5)log('A new ',raceOf(a).name,' ',r.cls.toLowerCase(),', ',a,', arrives in ',homeOf(a).name,' with no banner yet.')}
  rebuild(); // spatial grid for this step's proximity scans (sim/spatial.js); after recruits so newcomers are indexed
  for(const a of S.agents)if(a.state!=='camp'&&!held(a)&&!(a.player&&playerUpd(a,dt)))updAgent(a,dt); // 'camp': the Fellowship rests (sim/camp.js)
  // agent-played heroes (sim/player.js) run a reduced machine first
  partyTick();slotsTick(dt);companionTick();councilTick();campTick(dt);tableTick();sessionTick();fireTick();iqTick();for(const m of S.mobs)if(!held(m))updMob(m,dt);ecologyTick(dt);weatherTick(dt);encountersTick(dt);
  updBoss(dt);raidCheck(dt);pvpCheck(dt);dungeonCheck(dt);updMarket(dt);
  chatTick(dt);npcsTick(dt);talkTick();localsTick(dt);goalsTick(dt);guildsTick(dt);rivalsTick();focusTick();
  narratorTick(dt);bondsTick(dt);brainTick(dt);dmTick(dt);dreamTick();questTick();leverTick(dt);legendsTick(dt);memorialsTick(dt);
  updFx(dt)}
