// The solid-ground layer (#792, slice 1 of the solid-world epic #791). Owned by world-builder.
// One grid per world, built once from the map and cached: solidAt(x,y) says whether a tile cannot
// be stood on or walked through, nearestOpen(x,y) names the closest tile that can.
// Solid: WALL, RIVER (a BRIDGE is a different tile, so it stays open), PEAK, LAVA, the town
// building footprints (see FOOTPRINT SEAM) and the landmarks' solid parts: the Crypt's mouth
// rock and the wyrm's nest (the inner rock of the lair), except where a road was laid through them (a road tile is always open). Open but slow: TREE, MUD, SWAMP, ...
// (movement speeds stay in tiles.js SPEED). Dense forest cores are solid by FOREST_CORE below.
// Nothing here changes movement: slice 3 (#794) makes moveTo read it. WALKABLE keeps its meaning.
// The sim never imports render, so building boxes can only come from world data, not townart.js.
import {tiles,I,CITY,LANDMARKS} from './map.js';
import {W,H,ROCK,TREE,WALL,RIVER,PEAK,LAVA} from './tiles.js';

// Terrain that is solid by its tile id.
export const SOLID_TILES=[WALL,RIVER,PEAK,LAVA];
// Forest mask (the world-builder's call, #792): a TREE tile is solid only when every tile within
// FOREST_CORE tiles of it (a (2n+1) square) is a TREE too. At 2 that is the middle of a 5x5 stand:
// about 11% of Eldmoor's trees and 7% of the Stepping Lands'. Every solid core keeps a ring of
// open, slow forest at least two tiles thick, so a core is an island you walk around and can
// never wall off a road, a pass or a camp. 0 turns the mask off.
export const FOREST_CORE=2;

// FOOTPRINT SEAM (slice 2, #793): town plans become sim data, town.buildings = [{piece, box:[x,y,w,h], door:[x,y]}]
// in world tile units. Until then no town has the list and nothing is marked; once it does, each box
// is solid except its door tile. Rects may be passed in too (solidRects) for sites made later (#69).
function footprints(c){const out=[];
  for(const b of c.buildings||[]){const [bx,by,bw,bh]=b.box||[];if(!(bw>0&&bh>0))continue;
    for(let y=by;y<by+bh;y++)for(let x=bx;x<bx+bw;x++)if(!b.door||x!==b.door[0]||y!==b.door[1])out.push([x,y])}
  return out}

let G=null; // {solid:Uint8Array, why:Uint8Array} for the world this module was loaded with
const WHY=['open','wall','river','peak','lava','building','rock','forest']; // reason names, index = code
function build(){
  const solid=new Uint8Array(W*H);
  for(let i=0;i<W*H;i++){const t=tiles[i];const k=SOLID_TILES.indexOf(t);if(k>=0)solid[i]=1+k} // 1 wall,2 river,3 peak,4 lava
  if(FOREST_CORE>0){const R=FOREST_CORE;
    for(let y=R;y<H-R;y++)for(let x=R;x<W-R;x++){if(tiles[I(x,y)]!==TREE)continue;let ok=true;
      for(let dy=-R;dy<=R&&ok;dy++)for(let dx=-R;dx<=R;dx++)if(tiles[I(x+dx,y+dy)]!==TREE){ok=false;break}
      if(ok)solid[I(x,y)]=7}}
  for(const c of CITY)for(const [x,y] of footprints(c))if(x>=0&&y>=0&&x<W&&y<H)solid[I(x,y)]=5;
  for(const L of LANDMARKS){
    if(L.kind==='lair'){ // the nest: the inner rock of the lair (its mouth corridor stays open)
      for(let y=Math.max(0,Math.floor(L.y-L.inner));y<=Math.min(H-1,Math.ceil(L.y+L.inner));y++)for(let x=Math.max(0,Math.floor(L.x-L.inner));x<=Math.min(W-1,Math.ceil(L.x+L.inner));x++)
        if(tiles[I(x,y)]===ROCK&&Math.hypot(x+.5-L.x,y+.5-L.y)<=L.inner)solid[I(x,y)]=6}
    else if(L.kind==='crypt'&&L.mouth){const m=L.mouth; // the mouth rock
      for(let y=m.y0;y<=m.y1;y++)for(let x=m.x0;x<=m.x1;x++)if(x>=0&&y>=0&&x<W&&y<H&&tiles[I(x,y)]===ROCK)solid[I(x,y)]=6}}
  return solid}
const grid=()=>G||(G=build());

const inb=(x,y)=>x>=0&&y>=0&&x<W&&y<H;
// True when the tile at (x,y) (world units, floored) cannot be stood on or walked through. Off the map is solid.
export function solidAt(x,y){const tx=Math.floor(x),ty=Math.floor(y);return !inb(tx,ty)||grid()[I(tx,ty)]!==0}
// Why a tile is solid: 'wall' | 'river' | 'peak' | 'lava' | 'building' | 'rock' | 'forest', or null when open.
export function solidWhy(x,y){const tx=Math.floor(x),ty=Math.floor(y);if(!inb(tx,ty))return 'off the map';const c=grid()[I(tx,ty)];return c?WHY[c]:null}
// The nearest open tile centre to (x,y), searching outward by rings up to maxR tiles (default 12).
// ok(p) is an optional extra test (the levers pass their own rules). Returns {x,y} or null.
export function nearestOpen(x,y,maxR=12,ok){const cx=Math.floor(x),cy=Math.floor(y);let best=null,bd=Infinity;
  for(let r=0;r<=maxR;r++){
    if(best&&r>bd+1)break; // a ring can no longer beat the best found
    for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){if(Math.max(Math.abs(dx),Math.abs(dy))!==r)continue;
      const tx=cx+dx,ty=cy+dy;if(!inb(tx,ty)||grid()[I(tx,ty)]!==0)continue;
      const p={x:tx+.5,y:ty+.5};if(ok&&!ok(p))continue;
      const d=Math.hypot(p.x-x,p.y-y);if(d<bd){bd=d;best=p}}}
  return best}
// Count of solid tiles, by reason (for the world check and the survey note).
export function solidCounts(){const g=grid(),o={};for(let i=0;i<g.length;i++)if(g[i])o[WHY[g[i]]]=(o[WHY[g[i]]]||0)+1;return o}
