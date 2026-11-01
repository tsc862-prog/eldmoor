// Simulation entry point. DOM-free: the browser (src/main.js) and the headless
// harness (scripts/headless.mjs) both import init() and step() from here.
import {rnd} from '../core/rng.js';
import {homeOf,raceOf} from '../data/races.js';
import {CLSN} from '../data/classes.js';
import {S} from './state.js';
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
import {narratorTick} from './narrator.js';
import {goalsTick} from './goals.js';
import {guildsTick} from './guilds.js';
import {rebuild} from './spatial.js';
import {bondsTick} from './bonds.js';
import {brainTick} from './brain.js';
import {dmTick} from './dm.js';
import {leverTick} from './levers.js';
import {memorialsTick} from './memorials.js';
import {playerUpd} from './player.js';
import {fellowshipTick} from './fellowship.js';

export {S,clockStr} from './state.js';
export {log,onLog,gold,epic,fac} from './chronicle.js';
export {onMarketTick} from './market.js';
export {xpNeed,maxHp,atkOf} from './heroes.js';
export {spatialStats} from './spatial.js';
export {snapshot,restore,isSave,SAVE_VERSION} from './save.js';
export {enableBrain,disableBrain,brainStatus} from './brain.js';
export {markPlayer,playerAct,playerHero,playerSeat,playerSeats,playerNarrate} from './player.js';
export {found,autoPick,disbandFellowship,fellowshipMembers,fellows} from './fellowship.js';

// Populate the world: monsters, 14 level-1 heroes per faction, the opening chronicle.
export function init(){
  spawnAll();
  for(let f=0;f<2;f++)for(let i=0;i<14;i++)makeHero(f,CLSN[i%5],null,i*.6+rnd()*1.5);
  log('Twenty-eight new heroes of ',fac(0),' and ',fac(1),' arrive in ',{t:'Eldmoor',c:'gd'},'. Every one of them is level 1.');
  log({t:'Kragmaw the Cinder Wyrm',c:'gd'},' sleeps in its lair beyond Cinderpass.');
  log('No guild yet holds a banner, and ',{t:'The Sunken Crypt',c:'gd'},' waits beneath Mirefen.');
  log({t:'Hardcore rules:',c:'gd'},' every hero has one life. The fallen stay fallen.');
}

// Advance the world by dt real seconds at 1x (6 game minutes per second).
export function step(dt){S.gameMin+=dt*6;
  for(let i=S.recruits.length-1;i>=0;i--){const r=S.recruits[i];r.t-=dt;if(r.t>0)continue;S.recruits.splice(i,1);
    const a=makeHero(r.fac,r.cls,null,1);if(rnd()<.5)log('A new ',raceOf(a).name,' ',r.cls.toLowerCase(),', ',a,', arrives in ',homeOf(a).name,' with no banner yet.')}
  rebuild(); // spatial grid for this step's proximity scans (sim/spatial.js); after recruits so newcomers are indexed
  for(const a of S.agents)if(!(a.player&&playerUpd(a,dt)))updAgent(a,dt); // agent-played heroes (sim/player.js) run a reduced machine first
  partyTick();fellowshipTick(dt);for(const m of S.mobs)updMob(m,dt);ecologyTick(dt);weatherTick(dt);encountersTick(dt);
  updBoss(dt);raidCheck(dt);pvpCheck(dt);dungeonCheck(dt);updMarket(dt);
  chatTick(dt);npcsTick(dt);goalsTick(dt);guildsTick(dt);
  narratorTick(dt);bondsTick(dt);brainTick(dt);dmTick(dt);leverTick(dt);memorialsTick(dt);
  updFx(dt)}
