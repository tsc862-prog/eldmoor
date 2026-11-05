// Towns as places (#177 slice 3): which building style a town is drawn in and where its buildings stand. Pure data,
// no logic beyond lookups; the renderer (src/render/townart.js) draws each piece from its generated asset when one is
// loaded and from its procedural fallback (or nothing) when not. Nothing here touches the map, its tiles or its hash.
//
// Styles: a town takes its faction's style (FAC_STYLE, indexed by faction and wrapping round, so a new faction draws in
// an existing style until it gets its own row), or a spec town's own `style`. A style is a set of generated pieces,
// `building:<style>-<piece>` in scripts/art/manifest.json; adding a style is a row here, its colours in
// src/render/palette.js TOWN, and one manifest entry per piece.
export const TOWN_STYLES={
  stone:{about:'pale dressed limestone, blue-grey slate roofs, white mortar, arched windows: an old walled town of the plains'},
  timber:{about:'dark tarred timber and black stone, rust-red hide and shingle roofs, iron bands and spikes: a hard frontier hold'},
};
export const FAC_STYLE=['stone','timber'];
export function townStyle(c){
  if(c&&c.style&&TOWN_STYLES[c.style])return c.style;
  const n=FAC_STYLE.length,f=c&&Number.isInteger(c.fac)?c.fac:0;return FAC_STYLE[((f%n)+n)%n]}

// The pieces every town has, laid out in tiles from the town's top-left corner of an 11x9 town whose gate is in the east
// wall (TOWN_REF); the world generator (src/world/gen.js planBuildings, #793) maps each box's centre through the town's gate side and size,
// rounds it to the solid footprint and picks the door; the renderer draws from that plan (town.buildings), not from here. `serves` names the spot whose keeper stands at the door.
// `box` [x, y, w, h] in tiles; a box may reach past the wall line (a spire over the north wall).
// Walls and the gate are not boxes: they follow the town's wall tiles and gate side (see the renderer).
export const TOWN_REF=[11,9];
export const TOWN_PIECES=[
  {piece:'auction',box:[2,1,3,2],serves:'quartermaster',about:'the auction house: the quartermaster trades at its door'},
  {piece:'smithy',box:[5,1,1,2],serves:'smith',about:'the smithy: a forge chimney over an open anvil shed'},
  {piece:'hall',box:[6,1,3,2],serves:'gate',about:'the hall: the gate captain posts the town\'s work at its door'},
  {piece:'chapel',box:[9,.5,1,2.5],serves:'chapel',about:'the chapel: a narrow nave under a spire'},
  {piece:'board',box:[9,3,1,1],serves:'gate',about:'the notice board by the gate road'},
  {piece:'inn',box:[6,5,3,2],serves:'inn',about:'the inn: a long house with a hanging sign and a lit window'},
];
// Wall and gate pieces, drawn for a wall running west to east with the outside up (a north wall) and turned for the
// others: 'wall' on every straight wall tile, 'wall-corner' on the four corners (the top-left one, turned), 'gate' over
// the gate's two tiles and one wall tile either side (four tiles along the wall).
export const WALL_PIECES=['wall','wall-corner','gate'];
