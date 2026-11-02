// The renderer's shared palette (#176, docs/ART-PLAN.md): every colour the world view uses
// outside the pixel tables of sprites.js and the per-texel ramps of terrain.js, in one place.
// Pure data, no DOM, so the UI and Node tools may import it too.
//
// The first group must match src/style.css (--gold, --blue, --red, --amber, --green, --ink,
// --dim): a colour that means something in the panels means the same on the map.
import {CLS} from '../data/classes.js';
import {REGIONS} from '../world/map.js';

export const UI={gold:'#f2c14e',blue:'#5b8ff2',red:'#e8544a',amber:'#f0a040',green:'#7dce5a',ink:'#ece6d2',dim:'#8f8ca8',bg:'#0d0e19'};

// NPC and creature disposition toward the heroes, as the UI shows it.
export const DISPO={hostile:UI.red,neutral:UI.amber,friendly:UI.green};
// Disposition of a townsperson or DM-placed person: a wanderer's own attitude, else the strongest live
// attitude a townsperson holds toward anyone (hostile beats wary); townsfolk are friendly by default.
// 'wary' shows as neutral amber.
export function dispoOf(p,now,def='friendly'){const a=p.attitude||null;if(a)return a==='hostile'?'hostile':a==='friendly'?'friendly':'neutral';
  let d=def;for(const x of p.att||[]){if(x.until!=null&&x.until<=now)continue;if(x.a==='hostile')return 'hostile';if(x.a==='wary'||x.a==='neutral')d='neutral'}
  return d}
// Fellowship roles, as the .frole badges; the light cut is for small marks on dark (bubbles, minimap).
export const ROLE={tank:UI.blue,healer:UI.green,dps:UI.red};
export const ROLE_LIGHT={tank:'#8fb4ff',healer:'#a6f07a',dps:'#ff7a6a'};
export const roleOf=a=>a&&a.fellowRole?String(a.fellowRole).replace(/\d+$/,''):'dps';

// Class colour: the class accent of CLS. The UI's classColor helper returns the same value.
export const classColor=cls=>(CLS[cls]&&CLS[cls].acc)||UI.ink;

// Map text. VT323 with a one-pixel black shadow everywhere.
export const TEXT={
  label:'#f4ecd0',   // region names, bubble text
  place:'#f2c14e',   // towns and landmarks
  person:'#d8c890',  // townsfolk, plaques, place names
  elite:'#ffb060',   // named elites and Kragmaw
  crypt:'#9ae0b8',   // crypt names and the party inside
  dead:'#9a98ac',    // graves
  hero:'#fff2d0',    // Fellowship names at far zoom
  camp:'#f4c070',
};

// Marks drawn by the renderer.
export const MARK={
  sel:UI.gold,selHi:'#fff2b0',  // the selection chevron blinks between these
  hpHero:'#3fbf4a',hpFoe:'#e0483e',hpBack:'#000',
  quest:'#ffe040',shadow:'rgba(0,0,0,.35)',edge:'#05060c',
  outline:'#100c16',
  ember:'#ffe27a',
  mind:'#7fd6c2', // AI- or agent-played, same teal as the badge
  party:'rgba(242,193,78,.55)',
};

// Light: warm torch and fire light added in the night pass; the night itself.
export const LIGHT={night:[8,10,40],torch:[255,170,70],lava:[255,110,40],crypt:[120,230,170]};

// Ground colour per biome and the darker forest shade on top of it, for the minimap and
// anything else that needs one colour per tile. Keyed by biome name (gen.js BIOMES), never by
// zone index, so new regions only need a biome.
export const BIOME={
  meadow:  {ground:'#3f8a3a',forest:'#2a6e2c'},
  highland:{ground:'#3f8a3a',forest:'#2a6e2c'},
  fen:     {ground:'#3a5a3c',forest:'#2c4a2a'},
  ash:     {ground:'#6a605c',forest:'#4a4642'},
  tundra:  {ground:'#dde4ec',forest:'#1e4f44'},
};
// The biome of zone z (index into REGIONS), with meadow as the fallback.
export const biomeOfZone=z=>(REGIONS[z]&&REGIONS[z].biome)||'meadow';
// One colour per non-ground tile family for the minimap.
export const TILE_FLAT={water:'#3468b8',road:'#a88c5c',wall:'#2e2a34',rock:'#6a605c',lava:'#e0602a',snow:'#dde4ec',swamp:'#3a5a3c'};
