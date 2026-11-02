// The renderer's shared palette (#176, docs/ART-PLAN.md): every colour the world view uses
// outside the pixel tables of sprites.js and the per-texel ramps of terrain.js, in one place.
// Pure data, no DOM, so the UI and Node tools may import it too.
//
// The first group must match src/style.css (--gold, --blue, --red, --amber, --green, --ink,
// --dim): a colour that means something in the panels means the same on the map.
import {REGIONS} from '../world/map.js';

export const UI={gold:'#f2c14e',blue:'#5b8ff2',red:'#e8544a',amber:'#f0a040',green:'#7dce5a',ink:'#ece6d2',dim:'#8f8ca8',bg:'#0d0e19'};

// Class and disposition colours have one source, src/core/colors.js (#169), which the UI uses too:
// classColor(cls) from CLS[cls].acc, DISP for hostile/neutral/friendly. Re-exported here for the renderer.
export {classColor,DISP} from '../core/colors.js';

// Map text. VT323 with a one-pixel black shadow everywhere.
export const TEXT={
  label:'#f4ecd0',   // bubble text
  region:'#e8e0c8',  // region names, larger than the rest
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

// Spell effects (#374, render/spellfx.js): three-step ramps [highlight, body, shade] per element.
// The kind fallbacks keep the hue of the name pop in sim/moves.js NOTE (attack orange, heal green,
// control blue, defend pale, move violet, buff gold).
export const SPELL={
  rune:  ['#eef6ff','#7fb0ff','#3a5ad0'],
  frost: ['#ffffff','#bfeaff','#5ab0e0'],
  arcane:['#f6e8ff','#c58cff','#6a3aa0'],
  holy:  ['#fffbe0','#ffe07a','#c8902a'],
  leaf:  ['#d0f490','#6cc04a','#2f6a2a'],
  bark:  ['#b08a58','#7a5632','#3e2a18'],
  blood: ['#ffb0a0','#e8544a','#8a1a1a'],
  steel: ['#ffffff','#c8d0e0','#6a7488'],
  shout: ['#ffe0c0','#ff8a5a','#b0381a'],
  song:  ['#fff4c8','#f2c14e','#a87a1a'],
  dirge: ['#dce4f4','#8a9ac8','#3a4870'],
  hearth:['#ffe6d6','#f0a080','#b0503a'],
  smoke: ['#e4e4ec','#a0a0b0','#5a5a68'],
  sand:  ['#f4e0a8','#c8a868','#7a5a30'],
  mark:  ['#ffe6c0','#ffb060','#c05a1a'],
  ward:  ['#f4f8ff','#a8c0f0','#4a6aa8'],
  shadow:['#d8c8f0','#6a4a90','#24183a'],
};
