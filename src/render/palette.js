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

// Dungeon interiors (#85, render/interior.js): the crypt's stone in the same cool violet-grey as its mouth on the
// world map (terrain.js) and the teal-green crypt light. Ramps are [highlight, body, shade] as RGB triples for
// the per-texel textures; light from the top left like the world above.
export const DUNGEON={
  void:[6,6,11],
  floor:[[108,104,122],[84,80,98],[64,60,76]], mortar:[30,28,40], moss:[62,96,74],
  hall:[[90,86,104],[70,66,84],[52,48,64]],
  wallTop:[[46,42,56],[33,30,42],[24,22,32]], wallFace:[[96,92,112],[66,62,80],[44,40,56]],
  water:[[90,168,160],[30,78,84],[18,52,58]], stair:[[132,128,146],[96,92,110],[44,41,54]],
  dais:[[132,124,150],[104,96,124],[62,56,80]], rune:[122,208,160], wood:[[138,104,62],[96,70,40],[58,40,22]],
  fog:'rgba(4,4,10,.9)', fogA:230,       // over chambers the party has not reached
  cur:UI.gold, clear:UI.green, boss:UI.red, flame:'#ffd866', ghost:[120,230,170],
};
// Scene settings (#431, data/settings.js theme keys): each a DUNGEON-shaped ramp table for render/interior.js, plus
// beam (timber framing), rug [field, border, figure], glass (window panes) and bars (iron). Warm wood and plaster
// in town, cold stone below ground, tarred oak in a hold. Light from the top left as everywhere.
const T0={void:[6,6,11],water:[[110,170,200],[46,92,120],[26,58,80]],stair:[[150,140,124],[112,104,92],[56,50,44]],
  dais:[[168,160,144],[136,128,114],[88,82,72]],rune:[230,196,110],wood:[[150,108,64],[110,76,42],[66,44,24]],moss:null,
  beam:[[124,86,50],[92,62,34],[56,36,20]],glass:[[200,226,240],[120,170,210],[70,110,150]],bars:[[160,160,172],[96,96,108],[38,38,46]],
  rug:[[150,52,46],[96,32,34],[226,184,104]],hall:[[120,110,98],[96,88,78],[70,64,56]],fogA:0,cur:UI.gold,flame:'#ffd866',ghost:[120,230,170]};
export const THEMES={
  house:{...T0,floor:[[184,136,84],[152,108,62],[110,76,44]],mortar:[66,44,26],
    wallFace:[[226,212,182],[200,184,152],[150,134,106]],wallTop:[[78,58,42],[58,42,30],[40,28,20]]},
  tavern:{...T0,floor:[[156,110,66],[126,86,50],[90,60,34]],mortar:[50,32,18],rug:[[60,90,70],[36,58,44],[200,170,90]],
    wallFace:[[204,184,146],[174,154,118],[126,108,84]],wallTop:[[66,48,34],[48,34,24],[32,22,16]],beam:[[110,74,42],[80,52,28],[48,30,16]]},
  chapel:{...T0,floor:[[184,180,168],[156,152,142],[118,114,106]],mortar:[86,82,78],rug:[[60,80,150],[38,48,100],[226,196,110]],
    wallFace:[[196,188,172],[164,156,142],[118,110,100]],wallTop:[[70,66,72],[52,48,56],[36,34,40]],dais:[[196,190,176],[168,160,146],[116,110,100]],
    glass:[[240,200,120],[150,90,190],[70,120,200]]},
  cellar:{...T0,floor:[[124,116,104],[100,92,82],[72,66,58]],mortar:[40,36,32],moss:[84,96,70],
    wallFace:[[118,108,94],[90,82,70],[60,54,46]],wallTop:[[44,40,36],[32,30,26],[22,20,18]],stair:[[140,130,116],[106,98,86],[52,46,40]]},
  cell:{...T0,floor:[[116,120,112],[92,96,90],[64,68,62]],mortar:[36,38,36],
    wallFace:[[108,104,110],[82,78,86],[56,52,60]],wallTop:[[40,38,44],[30,28,34],[20,18,24]]},
  shrine:{...T0,floor:[[140,148,126],[112,120,100],[80,86,70]],mortar:[44,50,40],moss:[96,140,80],
    wallFace:[[126,128,114],[96,98,86],[64,66,56]],wallTop:[[42,46,40],[30,34,28],[20,24,20]],dais:[[160,166,146],[130,136,118],[88,92,78]],rune:[140,230,170]},
  smithy:{...T0,floor:[[132,126,118],[104,98,90],[72,68,62]],mortar:[38,34,30],
    wallFace:[[150,120,96],[118,92,72],[78,60,46]],wallTop:[[48,36,30],[36,28,22],[24,18,14]]},
  gate:{...T0,floor:[[138,134,126],[108,104,96],[74,70,64]],mortar:[40,38,36],
    wallFace:[[132,128,120],[102,98,92],[68,64,60]],wallTop:[[50,48,52],[38,36,40],[26,24,28]]},
  hold:{...T0,floor:[[150,108,68],[120,84,50],[84,58,32]],mortar:[34,22,14],
    wallFace:[[128,92,56],[98,70,40],[64,44,24]],wallTop:[[46,32,20],[34,24,14],[22,16,10]],beam:[[104,72,42],[76,52,28],[46,30,16]]},
};
// The scene view's marks (render/sceneview.js): the outdoor cut's frame, the dimmed world past it, the turn chevron.
export const SCENE={frame:UI.gold,dim:'rgba(6,6,14,.5)',turn:UI.gold,foe:UI.red,person:UI.amber};

// What a hero is trying to do (#534, render/purposefx.js): the intent icon over a head and the followed or hovered hero's
// path, tether and wait line, one colour per kind (the purpose line in the panels uses the same hues).
export const INTENT={hunt:'#f2c14e',job:'#ffe040',wait:'#d9c27a',follow:'#9ad0ff',rest:'#7fd6c2',home:'#c8b4ff',flee:'#ff7050',fight:'#ffb060',travel:'#ece6d2',plate:'rgba(8,10,20,.85)'};
