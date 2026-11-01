// Simulation entry point. DOM-free: the browser (src/main.js) and the headless
// harness (scripts/headless.mjs) both import init() and step() from here.
import {rnd} from '../core/rng.js';
import {CITY} from '../world/map.js';
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
import {narratorTick} from './narrator.js';

export {S,clockStr} from './state.js';
export {log,onLog,gold,epic,fac} from './chronicle.js';
export {onMarketTick} from './market.js';
export {xpNeed,maxHp,atkOf} from './heroes.js';

// Populate the world: monsters, 14 level-1 heroes per faction, the opening chronicle.
export function init(){
  spawnAll();
  for(let f=0;f<2;f++)for(let i=0;i<14;i++)makeHero(f,CLSN[i%5],S.GUILDS[f*2+(i%2)],i*.6+rnd()*1.5);
  log('Twenty-eight new heroes of ',fac(0),' and ',fac(1),' arrive in ',{t:'Eldmoor',c:'gd'},'. Every one of them is level 1.');
  log({t:'Kragmaw the Cinder Wyrm',c:'gd'},' sleeps in its lair beyond Cinderpass.');
  log('Four guilds compete for glory, and ',{t:'The Sunken Crypt',c:'gd'},' waits beneath Mirefen.');
  log({t:'Hardcore rules:',c:'gd'},' every hero has one life. The fallen stay fallen.');
}

// Advance the world by dt real seconds at 1x (6 game minutes per second).
export function step(dt){S.gameMin+=dt*6;
  for(let i=S.recruits.length-1;i>=0;i--){const r=S.recruits[i];r.t-=dt;if(r.t>0)continue;S.recruits.splice(i,1);
    const a=makeHero(r.fac,r.cls,r.guild,1);if(rnd()<.5)log('A new ',r.cls.toLowerCase(),', ',a,', joins ',{t:'<'+r.guild.tag+'> '+r.guild.name,c:'f'+r.fac},' in ',CITY[r.fac].name,'.')}
  for(const a of S.agents)updAgent(a,dt);partyTick();for(const m of S.mobs)updMob(m,dt);ecologyTick(dt);weatherTick(dt);encountersTick(dt);
  updBoss(dt);raidCheck(dt);pvpCheck(dt);dungeonCheck(dt);updMarket(dt);
  chatTick(dt);
  narratorTick(dt);
  updFx(dt)}
