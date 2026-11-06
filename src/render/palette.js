// The renderer's shared palette (#176, docs/ART-PLAN.md): every colour the world view uses
// outside the pixel tables of sprites.js and the per-texel ramps of terrain.js, in one place.
// Pure data, no DOM, so the UI and Node tools may import it too.
//
// The first group must match src/style.css (--gold, --blue, --red, --amber, --green, --ink,
// --dim): a colour that means something in the panels means the same on the map.
import {REGIONS} from '../world/map.js';
import {FAC} from '../data/factions.js';

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
// Whole-map marks (#729, render/lod.js): the colours that are not a faction's. lit: each faction's lit shoulder; night: how much of the dark dims the marks.
export const LOD={person:TEXT.person,grave:TEXT.dead,ghost:'#d8ecff',skin:'#f0d8b0',lit:['#a8c4ff','#ffa89c'],night:.5};
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
export const LIGHT={night:[10,14,60],nightA:.62,dusk:[150,36,120],dawn:[170,64,104],torch:[255,170,70],lava:[255,110,40],crypt:[120,230,170]};

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
  // a raid arena (#85, world/interior.js buildArena): ash-grey basalt, scorched rock walls, the lava ring (water = the melt
  // [bright seam, body, shore glow], crust = its cooled plates), embers in the floor's cracks, a gold hoard mound (dais)
  lair:{...T0,floor:[[92,84,86],[70,62,66],[50,43,48]],mortar:[28,20,22],ember:[255,120,40],
    hall:[[104,92,88],[82,72,70],[58,50,50]],wallFace:[[112,80,70],[82,56,50],[52,34,32]],wallTop:[[44,28,28],[32,20,20],[20,12,14]],
    water:[[255,206,96],[222,92,28],[150,44,22]],crust:[[78,36,30],[40,20,20]],stair:[[120,108,102],[92,82,78],[46,40,40]],
    dais:[[214,170,82],[170,128,56],[112,80,38]],rune:[255,214,110]},
  // DM-made dungeon sites (#642, render/siteview.js), one look per theme of data/sites.js. Below ground every one is darker
  // than a town room; each keeps its own hue so a glance tells a barrow from a mine: turf-brown stone, a keep's red-grey
  // brick and cobbles, a temple's pale sandstone with a gold dais, a mine's dirt and timber, a den's mossy earth, a burnt ruin.
  'site-barrow':{...T0,floor:[[118,110,96],[92,86,74],[66,61,52]],mortar:[36,32,26],moss:[72,96,58],hall:[[100,94,82],[78,72,62],[56,52,44]],
    wallFace:[[112,102,86],[82,74,62],[54,48,40]],wallTop:[[48,42,34],[34,30,24],[22,20,16]],water:[[90,140,130],[36,70,72],[22,46,50]],
    stair:[[132,124,108],[98,92,80],[48,44,38]],dais:[[132,124,106],[104,96,82],[66,60,50]],rune:[150,220,170],
    wood:[[122,92,58],[88,64,38],[54,38,22]],rug:[[96,70,48],[64,46,32],[200,170,100]]},
  'site-fortress':{...T0,floor:[[138,130,120],[110,104,96],[78,74,68]],mortar:[44,40,36],hall:[[124,116,106],[98,92,84],[70,66,60]],
    wallFace:[[146,112,94],[112,84,70],[74,54,46]],wallTop:[[58,44,40],[42,32,30],[28,22,20]],stair:[[140,132,122],[106,100,92],[52,48,44]],
    dais:[[150,120,96],[120,94,74],[78,60,46]],rune:[240,190,100],rug:[[164,40,40],[102,26,30],[236,192,96]]},
  'site-temple':{...T0,floor:[[176,168,146],[146,138,118],[108,100,84]],mortar:[70,64,52],moss:[100,130,90],hall:[[150,142,122],[122,114,96],[90,84,70]],
    wallFace:[[172,160,134],[138,126,102],[94,86,68]],wallTop:[[62,58,52],[46,42,38],[30,28,26]],water:[[110,180,170],[46,100,104],[28,66,72]],
    dais:[[208,186,124],[172,150,96],[112,96,60]],rune:[240,200,110],rug:[[60,96,150],[38,60,100],[230,196,110]]},
  'site-mine':{...T0,floor:[[124,98,72],[100,78,56],[72,56,40]],mortar:[42,32,24],hall:[[110,86,62],[88,68,48],[62,48,34]],
    wallFace:[[120,102,88],[90,76,64],[60,50,42]],wallTop:[[44,36,30],[32,26,22],[22,18,14]],stair:[[128,106,84],[98,80,62],[48,38,30]],
    dais:[[118,104,92],[92,80,70],[60,52,46]],rune:[140,180,255],wood:[[150,108,64],[110,76,42],[66,44,24]]},
  'site-den':{...T0,floor:[[98,90,66],[78,72,52],[56,52,38]],mortar:[30,28,20],moss:[86,110,60],hall:[[88,80,58],[70,64,46],[50,46,34]],
    wallFace:[[92,94,74],[68,70,54],[46,48,36]],wallTop:[[34,36,28],[24,26,20],[16,18,14]],water:[[96,140,110],[40,74,58],[24,48,38]],
    stair:[[110,100,78],[84,76,58],[44,40,30]],dais:[[104,94,72],[82,74,56],[54,48,36]],rune:[200,220,140]},
  'site-ruin':{...T0,floor:[[134,134,122],[106,106,96],[76,76,68]],mortar:[42,44,38],moss:[86,120,70],hall:[[118,116,106],[92,90,82],[66,64,58]],
    wallFace:[[116,106,98],[84,78,72],[54,50,46]],wallTop:[[40,36,34],[28,26,24],[18,16,16]],dais:[[138,128,118],[110,102,94],[70,64,60]],
    rune:[230,180,100],rug:[[110,40,48],[70,26,32],[210,170,90]]},
};
// Kragmaw (#85: the world and the raid arena share it): R hide, W wing membranes, E eyes, T teeth, D claws.
export const BOSS_PAL={R:'#7a2a3a',W:'#d04a2a',E:'#ffe060',T:'#f0ead0',D:'#3a1a20'};
// The raid arena's marks (render/raidview.js): the breath's telegraph and wave, the boss's bar, broke-off and fallen marks.
export const RAID={breath:[255,140,40],wave:[255,200,90],bar:'#c8402e',barHi:'#ff7a50',barBack:'#24100e',phase:UI.amber,
  fled:'#ffd070',fell:'#e0584a',add:UI.red,ring:'rgba(255,120,40,.35)'};
// The scene view's marks (render/sceneview.js): the outdoor cut's frame, the dimmed world past it, the turn chevron.
export const SCENE={frame:UI.gold,dim:'rgba(6,6,14,.5)',turn:UI.gold,foe:UI.red,person:UI.amber};

// What a hero is trying to do (#534, render/purposefx.js): the intent icon over a head and the followed or hovered hero's
// path, tether and wait line, one colour per kind (the purpose line in the panels uses the same hues).
export const INTENT={hunt:'#f2c14e',job:'#ffe040',wait:'#d9c27a',follow:'#9ad0ff',rest:'#7fd6c2',home:'#c8b4ff',flee:'#ff7050',fight:'#ffb060',travel:'#ece6d2',plate:'rgba(8,10,20,.85)'};

// ---- tiers (#177, render/tile.js) ----
// The generated art is quantised to these colours plus shades. The 8-bit palette above stays the procedural fallback's;
// the 32 px tier widens each asset's palette with shades of its own colours (post-processing: post.minPalette, else the
// tier's minPalette), the 64 tier with more. factors scale RGB, in the order shades are added.
export const TIER_SHADES={
  32:{minPalette:10,factors:[.85,1.15,.7,1.3,.55,1.45]},
  64:{minPalette:16,factors:[.9,1.1,.8,1.2,.7,1.3,.6,1.4,.5,1.5]},
};
const hx=v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0');
// hex scaled by f per channel ('#3f8a3a', .85 -> a darker shade).
export const shadeHex=(hex,f)=>'#'+[1,3,5].map(i=>hx(parseInt(hex.slice(i,i+2),16)*f)).join('');
export const shadesOf=(hex,tier=32)=>[hex,...((TIER_SHADES[tier]||TIER_SHADES[32]).factors).map(f=>shadeHex(hex,f))];

// Generated hero and creature sheets (#177 slice 4): one light from the top left, a one-pixel outline, and these ramps.
// Hero sheets are drawn in the first faction's tabard (key) and recoloured per faction at draw time (recolour), so every
// faction reads in its own colour without a sheet per faction; skin ramps come from the peoples' skins.
export const SPRITE={
  outline:[MARK.outline],
  key:[FAC[0].color,FAC[0].dark],
  // the tabard's lit and shaded steps: the key colours by the 32 tier's first two shade factors, which recolour maps too
  keyRamp:[FAC[0].color,FAC[0].dark].flatMap(c=>TIER_SHADES[32].factors.slice(0,2).map(f=>shadeHex(c,f))),
  skin:FAC.flatMap(f=>f.skin.slice(0,3)),
  hair:['#2a2020','#5a3a20','#8a6a3a','#d8c890'],
  leather:['#7a5632','#5a3a20','#3e2a18'],
  steel:['#e8ecf4','#c8d0e0','#8a94a8','#5a6478'],
  cloth:['#ece6d2','#a89a80','#5a4a3a'],
  gold:['#ffe27a','#f2c14e','#a87a1a'],
};
// Colour swaps from the key faction to faction fac (the key colours and their tier shades), cached.
const swapC=[];
export function recolour(fac){if(swapC[fac])return swapC[fac];const m={},to=FAC[fac]||FAC[0];
  if(to!==FAC[0])for(const tier of Object.keys(TIER_SHADES))for(const k of ['color','dark']){const a=shadesOf(FAC[0][k],+tier),b=shadesOf(to[k],+tier);a.forEach((c,i)=>{m[c]=b[i]})}
  return swapC[fac]=m}

// Towns and landmarks (#177 slice 3, render/townart.js): the colours of each building style (data/townart.js TOWN_STYLES)
// and of the two set pieces. The manifest's building and landmark entries quantise to these (palette from 'TOWN.<style>'),
// and the fixtures draw with them. Mid values for walls and roofs, the extremes for doors, glass and fire; light from the
// top left like everywhere.
export const TOWN={
  stone:{roof:['#8a9ab8','#5e6e8e','#3e4a66'],wall:['#ece4cc','#d0c4a4','#a89a7c'],trim:['#6a5a44','#3a2e22'],
    stone:['#b4acb8','#8a8292','#5a5462','#2e2a34'],glass:['#9ad0ff','#4a7ab0'],door:['#5a3a1c','#3a2414'],gold:['#f2c14e','#a87a1a'],moss:['#5a8a44','#4a7a3a']},
  timber:{roof:['#b0583c','#8a3a28','#5a2418'],wall:['#7a5a3e','#5a3e2a','#3a281c'],trim:['#2a2420','#141012'],
    stone:['#6a6266','#4a4448','#332e32','#1a1618'],glass:['#ffb060','#c8601a'],door:['#3a2414','#1e140c'],gold:['#c8c4bc','#7a7672'],moss:['#6a7a3a','#4a5a2a']},
};
// The town's ground and wall tops (#830), dark to light: the plaza's flagstones and the walks on the walls. A table of its own,
// because the manifest quantises generated buildings to everything in TOWN.<style>.
export const TOWN_GROUND={
  stone:{plaza:['#6e685e','#8e887c','#a49e90','#b4aea0','#c4beb0'],walk:['#4a4652','#5e5a66','#726e7a','#868290']},
  timber:{plaza:['#3a3230','#524844','#625852','#70665e','#7e746a'],walk:['#262226','#343034','#433e42','#524c50'],
    street:['#2c2420','#3e3228','#4e4030','#5e4e3a','#6e5c46']}, // packed earth, a step warmer than the paving and no brighter (a stone town's street is the road's own dirt)
};
// A house's wood shakes (scripts/art/packcut-buildings.mjs), dark to light, where they are not the town's own roof: weathered oak over
// the stone towns' cottages, a tarred brown over the timber towns'. Beside TOWN for the same reason as TOWN_GROUND.
export const HOUSE_SHAKE={stone:['#4a3224','#6e4c34','#8e6a48','#ac8a60'],timber:['#2e2018','#463226','#5e4634','#786048']};
// The palisade's stakes and its plank decking, dark to light (scripts/art/packcut-walls.mjs).
export const PALISADE={log:['#1e140e','#3a281c','#5a3e2a','#7a5a3e','#9a7a56'],deck:['#2e2218','#46342a','#5a4432','#6e563e','#826a4e']};
export const LANDMARK={
  crypt:['#78748a','#5a5668','#4a4652','#2e2a34','#0a0810','#7ad0a0','#c8ffd8','#e8e4d8','#5a8a44'],
  lair:['#5a2a1c','#3a1c16','#655c58','#4a423e','#2a2422','#c8401a','#f07a22','#ffd04a','#e8e0c8','#a8a090'],
};

// Flat building palettes (#763): what a generated building or standing landmark may use, taken from the procedural house
// (render/townart.js: three roof tones, two wall tones, one dark line, a door), per town style and for the crypt mouth and
// the lair. The manifest's building recipe quantises to exactly these (post.flat, scripts/art/post-flat.mjs, no widening,
// no dither) and its style gate measures a model image's distance from them; the fixtures draw with them too. Roles:
// roof = the top surface light to dark (light from the top left), wall = the short front strip light and shade, line = the
// outline, door = the one accent (door, glow, gold).
export const FLAT={
  stone:{roof:TOWN.stone.roof,wall:TOWN.stone.wall.slice(0,2),line:MARK.outline,door:TOWN.stone.door[0]},
  timber:{roof:TOWN.timber.roof,wall:TOWN.timber.wall.slice(0,2),line:MARK.outline,door:TOWN.timber.door[0]},
  crypt:{roof:['#78748a','#5a5668','#4a4652'],wall:['#2e2a34','#e8e4d8'],line:'#0a0810',door:'#7ad0a0'},
  lair:{roof:['#655c58','#4a423e','#2a2422'],wall:['#c8401a','#f07a22'],line:'#100c16',door:'#ffd04a'},
};
