// Table condition glyphs (issue #307): a small pixel glyph over every combatant that is stunned, rooted,
// poisoned or warded (the conditions of #296, sim/eff.js). Read-only: the conditions come from the sim's
// own reader (condOn, the same test condsOf uses, asked id by id so the frame allocates nothing), and a
// sprite with none shows nothing. Stun, root and poison only live in Table rounds (clearRounds ends them
// with the scene). The ward glyph also shows for a real-time ward (#342): a ward move used outside Table
// rounds stores 'taken' with a duration in seconds, which condOn (round form only) does not see, so on()
// reads it through effOn/effLeft as the Abilities block's ward chips do (#337).
//
// Glyphs are pixel strings like sprites.js, cached once as outlined canvases. They are drawn on the
// sprites' own pixel grid (one glyph pixel = one world pixel, snapped to whole device pixels) and never
// under 2 CSS px a pixel, so they read at every close zoom; far zoom draws none (draw.js calls this only
// when close). Side by side in the order stun, root, poison, ward, on the head (see Placement below).
// Called right after the entity's sprite in the y-sorted pass, so a glyph keeps its sprite's depth
// order; the labels and markers are drawn after every sprite, lifted clear of the glyphs.
import {condOn,effOn,effLeft} from '../sim/eff.js';
import {sprite,outlined,SPR} from './sprites.js';
import {MOBS} from '../data/mobs.js';
import {UI,MARK} from './palette.js';

// The order is the sim's: COND_IDS (stun, root, poison) then ward.
const IDS=['stun','root','poison','ward'];
// Light from the top left: the highlight sits up and left, the shade down and right.
const GLYPH={
  // stun: three stars circling the head; the two frames turn them
  stun:[[
    '..Y....',
    '.YWY.Y.',
    '..Y.YWY',
    '.....Y.',
    '.Y.....',
    'YWY....',
    '.Y.....'],[
    '....Y..',
    '.Y.YWY.',
    'YWY.Y..',
    '.Y.....',
    '.....Y.',
    '....YWY',
    '.....Y.']],
  // root: two links of a chain, steel
  root:[[
    '.LM....',
    'L..M...',
    'M..D...',
    '.MD.LM.',
    '...L..M',
    '...M..D',
    '....MD.']],
  // poison: a green drop
  poison:[[
    '..G..',
    '..G..',
    '.GGG.',
    'GLGGG',
    'GLGGD',
    'GGGGD',
    '.GDD.']],
  // ward: a blue shield
  ward:[[
    '.BBBBB.',
    'BLLBBBD',
    'BLBBBBD',
    'BLBBBBD',
    '.BBBBD.',
    '..BBD..',
    '...D...']],
};
const PAL={
  stun:{Y:MARK.quest,W:'#fffbe0'},
  root:{L:'#e4e8f0',M:'#a8acb8',D:'#5c6070'},
  poison:{G:'#5cc840',L:'#c8f8a0',D:'#2a7a2a'},
  ward:{B:UI.blue,L:'#cfe0ff',D:'#2a4a9a'},
};
// Outlined glyph canvas for condition id and frame f (cached by sprite() and outlined()).
// Is condition id on e? The sim's condOn, plus the real-time ward (seconds left, blows land lighter).
const on=(e,id)=>condOn(e,id)||(id==='ward'&&effOn(e,'taken')&&effLeft(e,'taken')>0&&e.eff.taken.v<1);
const glyph=(id,f)=>{const fr=GLYPH[id],k=f%fr.length;return outlined(sprite('cond-'+id+k,fr[k],PAL[id]))};

// Placement (#317, design (a)): the glyphs sit directly above the head, one world pixel over the HP
// bar (over the selection arrow when e is the selected one), centred, in the sprites' own grid. While a
// condition is on, draw.js lifts e's nameplate and a member's role marker by condLift(e,cam), so the
// name and marker ride above the glyphs and nothing overlaps; with no condition the lift is 0 and the
// labels sit exactly where they always did.

// Sprite height in world px (heroes and townsfolk 12, creatures by their art, Kragmaw 22).
function headH(e){if(e.kind==='boss')return SPR.boss[0].length;
  if(e.kind==='mob'){const M=MOBS[e.type],a=M&&SPR[M.spr];return a?a[0].length:12}return 12}
// Device px per glyph pixel: the sprites' own grid, never under 2 CSS px.
const gpx=cam=>Math.max(Math.round(2*cam.dpr),Math.round(cam.sc));
// Gap under the glyphs in world px: one over the HP bar, or over the selection arrow.
const under=(e,cam)=>e===cam.sel?8:5;

// How far (world px) e's nameplate and marker rise so they clear its glyphs: 0 with no condition
// and at far zoom (no glyphs there). Labels sit at y-17 (Kragmaw y-28) on their alphabetic
// baseline; 3 CSS px leave the descenders clear of the glyphs' outline.
export function condLift(e,cam){
  if(!cam.close||!e.eff||e.state==='dead'||e.state==='ghost')return 0;
  let h=0;for(const id of IDS)if(on(e,id))h=Math.max(h,glyph(id,0).height);
  if(!h)return 0;
  const sc=cam.sc,top=-headH(e),gtop=top-under(e,cam)-h*gpx(cam)/sc,base=e.kind==='boss'?-28:-17;
  return Math.max(0,base-(gtop-3*cam.dpr/sc));
}

// Draw e's condition glyphs. ctx is in world transform (sc, offX, offY); px, py the sprite's feet and
// top its head in world px; close-zoom only. Restores the world transform when done.
export function drawConditions(ctx,S,cam,e,px,py,top,blink){
  if(!e.eff||e.state==='dead'||e.state==='ghost')return;
  let n=0,w=0;for(const id of IDS)if(on(e,id)){n++;w+=glyph(id,0).width}
  if(!n)return;
  const sc=cam.sc,G=gpx(cam),gap=G,tw=w*G+(n-1)*gap;
  let sx=Math.round(px*sc+cam.offX-tw/2);const sy=Math.round((top-under(e,cam))*sc+cam.offY);
  const f=Math.floor(blink*2.5);
  ctx.setTransform(1,0,0,1,0,0);ctx.imageSmoothingEnabled=false;
  for(const id of IDS){if(!on(e,id))continue;const g=glyph(id,f);
    ctx.drawImage(g,sx,sy-g.height*G,g.width*G,g.height*G);sx+=g.width*G+gap}
  ctx.setTransform(sc,0,0,sc,cam.offX,cam.offY);
}
