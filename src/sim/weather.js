// Per-zone weather: a small state machine per zone that changes every 1-3 game
// hours and feeds three multipliers into the sim. Rain and snow slow movement
// (speedMul), fog and storms shrink how far mobs, duellists and hunters see
// (sightMul), and true storms (isStorm) send hunting heroes home. Owned by
// world-builder. DOM-free; the renderer reads weatherKind() to draw it.
import {rnd} from '../core/rng.js';
import {ZONES,REGIONS} from '../world/map.js';
import {S} from './state.js';
import {log} from './chronicle.js';
import {sightLever} from './levers.js';

// Every weather kind with its gameplay multipliers and chronicle line ({z} is the zone name).
export const WEATHER={
  clear:   {name:'Clear',     speed:1,   sight:1,   storm:false,msg:'The sky clears above {z}.'},
  drizzle: {name:'Drizzle',   speed:.95, sight:1,   storm:false,msg:'A thin drizzle settles on {z}.'},
  rain:    {name:'Rain',      speed:.9,  sight:.9,  storm:false,msg:'Rain sets in over {z}.'},
  fog:     {name:'Fog',       speed:1,   sight:.5,  storm:false,msg:'Fog rolls over {z}.'},
  ashfall: {name:'Ashfall',   speed:.95, sight:.85, storm:false,msg:'Grey ash drifts down across {z}.'},
  ashstorm:{name:'Ash storm', speed:.7,  sight:.6,  storm:true, msg:'An ash storm howls through {z}.'},
  snow:    {name:'Snow',      speed:.8,  sight:.85, storm:false,msg:'Snow falls on {z}.'},
  squall:  {name:'Squall',    speed:.65, sight:.6,  storm:true, msg:'A squall closes {z}.'},
};
// What each biome's sky can do, with transition weights (clear about half the time). A region takes
// the table of its biome (spec.js), so any world's regions get weather without an entry of their own.
const BIOME_SKY={
  meadow:  [['clear',.5],['rain',.25],['drizzle',.25]],   // Thornvale, Lowmark
  fen:     [['clear',.5],['fog',.3],['rain',.2]],         // Mirefen, Sedgewater
  ash:     [['clear',.5],['ashfall',.3],['ashstorm',.2]], // Cinderpass, Cinderreach
  tundra:  [['clear',.5],['snow',.3],['squall',.2]],      // Hoarfell, Rimeholt, Palereach
  highland:[['clear',.5],['fog',.25],['drizzle',.15],['squall',.1]], // Cairnwold
};
const ZW=REGIONS.map(r=>BIOME_SKY[r.biome]||BIOME_SKY.meadow);
// Game minutes a spell lasts: clear skies 1.5-3 h, weather 1-2.5 h.
const dur=k=>k==='clear'?90+rnd()*90:60+rnd()*90;

function pickNext(z,cur){const opts=ZW[z].filter(o=>o[0]!==cur);let tot=0;for(const o of opts)tot+=o[1];
  let r=rnd()*tot;for(const o of opts){r-=o[1];if(r<=0)return o[0]}return opts[opts.length-1][0]}

// Lazily set up on the first tick so state.js stays untouched: every zone starts clear.
function ensure(){if(!S.weather)S.weather=ZONES.map(()=>({k:'clear',until:S.gameMin+dur('clear')}))}

// Called once per step after the mob loop; rolls each zone whose spell has run out.
export function weatherTick(dt){ensure();
  for(let z=0;z<S.weather.length;z++){const w=S.weather[z];if(S.gameMin<w.until)continue;
    w.k=pickNext(z,w.k);w.until=S.gameMin+dur(w.k);
    log({t:WEATHER[w.k].msg.replace('{z}',ZONES[z]),c:'dm'})}}

export const weatherKind=z=>S.weather&&S.weather[z]?S.weather[z].k:'clear';
export const weatherName=z=>WEATHER[weatherKind(z)].name;
export const speedMul=z=>WEATHER[weatherKind(z)].speed;
export const sightMul=z=>WEATHER[weatherKind(z)].sight*sightLever(z); // a fog-bound condition (DM lever) closes in on top of the sky
export const isStorm=z=>WEATHER[weatherKind(z)].storm;
