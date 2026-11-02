// Table condition glyphs (issue #307): a small pixel glyph over every combatant that is stunned, rooted,
// poisoned or warded (the conditions of #296, sim/eff.js). Read-only: the conditions come from the sim's
// own reader (condOn, the same test condsOf uses, asked id by id so the frame allocates nothing), and a
// sprite with none shows nothing. Conditions only live in Table rounds (clearRounds ends them with the
// scene), so outside a combat scene this draws nothing.
//
// Glyphs are pixel strings like sprites.js, cached once as outlined canvases. They are drawn on the
// sprites' own pixel grid (one glyph pixel = one world pixel, snapped to whole device pixels) and never
// under 2 CSS px a pixel, so they read at every close zoom; far zoom draws none (draw.js calls this only
// when close). They sit above the constant-size name labels and markers, so the offsets are in CSS px.
// Placement: side by side in the order stun, root, poison, ward, centred above the head and above the
// name label (and a member's role marker), so neither covers the other. Called right after the
// entity's sprite in the y-sorted pass, so a glyph keeps its sprite's depth order.
import {condOn} from '../sim/eff.js';
import {sprite,outlined} from './sprites.js';
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
const glyph=(id,f)=>{const fr=GLYPH[id],k=f%fr.length;return outlined(sprite('cond-'+id+k,fr[k],PAL[id]))};

// Is e a living Fellowship member (who wears a role marker above the name)?
function member(e,S){const F=S.fellowship;if(!F||e.kind!=='hero')return false;for(const k in F.slots)if(F.slots[k]==e.id)return true;return false}

// Draw e's condition glyphs. ctx is in world transform (sc, offX, offY); px, py the sprite's feet and
// top its head in world px; close-zoom only. Restores the world transform when done.
export function drawConditions(ctx,S,cam,e,px,py,top,blink){
  if(!e.eff||e.state==='dead'||e.state==='ghost')return;
  let n=0,w=0;for(const id of IDS)if(condOn(e,id)){n++;w+=glyph(id,0).width}
  if(!n)return;
  const sc=cam.sc,px1=cam.dpr/sc,G=Math.max(Math.round(2*cam.dpr),Math.round(sc)); // device px per glyph pixel: the sprites' own grid, never under 2 CSS px
  // The lowest clear line above the head, in world px: above the nameplate (and a member's marker),
  // else just above the HP bar. Mirrors draw.js: names at y-17 (14 css), Kragmaw at y-28 (15 css).
  let y;
  if(e.kind==='boss')y=py-28-15*px1*.8;
  else if(e.kind==='hero'||e.elite){y=py-17-14*px1*.8;
    if(member(e,S)){const m=Math.max(3,5*px1),cy=py-17-16*px1-m;y=Math.min(y,cy-m-px1)}}
  else y=top-5; // just above the HP bar
  const gap=G,tw=w*G+(n-1)*gap;
  let sx=Math.round(px*sc+cam.offX-tw/2);const sy=Math.round(y*sc+cam.offY)-gap;
  const f=Math.floor(blink*2.5);
  ctx.setTransform(1,0,0,1,0,0);ctx.imageSmoothingEnabled=false;
  for(const id of IDS){if(!condOn(e,id))continue;const g=glyph(id,f);
    ctx.drawImage(g,sx,sy-g.height*G,g.width*G,g.height*G);sx+=g.width*G+gap}
  ctx.setTransform(sc,0,0,sc,cam.offX,cam.offY);
}
