// The solid grid of one world, as a pure function of its tiles (#792, #794). Owned by world-builder.
// gen.js builds it once per world, after the roads, because spawn points and gathering nodes must keep off it;
// passable.js is the one reader for everyone else (solidAt, nearestOpen, landAt).
// Solid: WALL, RIVER (a BRIDGE is a different tile; a ford is a RIVER tile left open), PEAK, LAVA, the towns' building
// footprints and the landmarks' solid parts. Open but slow: TREE, MUD, SWAMP, ... (speeds stay in tiles.js SPEED).
import {ROCK,TREE,WALL,RIVER,PEAK,LAVA,BRIDGE,ROAD} from './tiles.js';

// Terrain that is solid by its tile id.
export const SOLID_TILES=[WALL,RIVER,PEAK,LAVA];
// Forest mask (the world-builder's call, #792): a TREE tile is solid only when every tile within
// FOREST_CORE tiles of it (a (2n+1) square) is a TREE too. At 2 that is the middle of a 5x5 stand:
// about 11% of Eldmoor's trees and 7% of the Stepping Lands'. Every solid core keeps a ring of
// open, slow forest at least two tiles thick, so a core is an island you walk around and can
// never wall off a road, a pass or a camp. 0 turns the mask off.
export const FOREST_CORE=2;
// The wyrm's nest: the rock it lies on, this many tiles from the lair's centre (#794). Raiders stand on the rest of the
// inner rock, so it must stay open; the whole inner rock solid would keep every blade out of reach of the wyrm.
export const NEST_CORE=1.5;
export const WHY=['open','wall','river','peak','lava','building','rock','forest']; // reason names, index = code

// Each town.buildings entry {box:[x,y,w,h], door:[x,y]} (world tile units) is solid except its door tile.
function footprints(c){const out=[];
  for(const b of c.buildings||[]){const [bx,by,bw,bh]=b.box||[];if(!(bw>0&&bh>0))continue;
    for(let y=by;y<by+bh;y++)for(let x=bx;x<bx+bw;x++)if(!b.door||x!==b.door[0]||y!==b.door[1])out.push([x,y])}
  return out}

// world: {tiles, I, w, h, CITY, LANDMARKS, fords (tile indices of open river)}. Returns a Uint8Array of WHY codes.
export function solidGrid({tiles,I,w,h,CITY,LANDMARKS,fords}){
  const solid=new Uint8Array(w*h);
  for(let i=0;i<w*h;i++){const k=SOLID_TILES.indexOf(tiles[i]);if(k>=0)solid[i]=1+k} // 1 wall,2 river,3 peak,4 lava
  for(const i of fords||[])solid[i]=0;
  if(FOREST_CORE>0){const R=FOREST_CORE;
    for(let y=R;y<h-R;y++)for(let x=R;x<w-R;x++){if(tiles[I(x,y)]!==TREE)continue;let ok=true;
      for(let dy=-R;dy<=R&&ok;dy++)for(let dx=-R;dx<=R;dx++)if(tiles[I(x+dx,y+dy)]!==TREE){ok=false;break}
      if(ok)solid[I(x,y)]=7}}
  for(const c of CITY)for(const [x,y] of footprints(c))if(x>=0&&y>=0&&x<w&&y<h)solid[I(x,y)]=5;
  for(const L of LANDMARKS){
    if(L.kind==='lair'){ // the nest: the rock at the heart of the lair (the rest of the inner rock and its mouth corridor stay open)
      const r=Math.min(NEST_CORE,L.inner);
      for(let y=Math.max(0,Math.floor(L.y-r));y<=Math.min(h-1,Math.ceil(L.y+r));y++)for(let x=Math.max(0,Math.floor(L.x-r));x<=Math.min(w-1,Math.ceil(L.x+r));x++)
        if(tiles[I(x,y)]===ROCK&&Math.hypot(x+.5-L.x,y+.5-L.y)<=r)solid[I(x,y)]=6}
    else if(L.kind==='crypt'&&L.mouth){const m=L.mouth; // the mouth rock
      for(let y=m.y0;y<=m.y1;y++)for(let x=m.x0;x<=m.x1;x++)if(x>=0&&y>=0&&x<w&&y<h&&tiles[I(x,y)]===ROCK)solid[I(x,y)]=6}}
  // A road may run corner to corner between two solid tiles (a bridge over the river, a pass through peaks). Those two tiles are
  // its shoulders and stay open, so walkers follow it on the plain step rule and no line ever scrapes solid ground. Never a wall, a building or a landmark's rock.
  const way=i=>tiles[i]===ROAD||tiles[i]===BRIDGE,soft=i=>solid[i]>1&&solid[i]<5||solid[i]===7; // river, peak, lava, forest
  for(let y=0;y<h-1;y++)for(let x=0;x<w;x++){if(!way(I(x,y)))continue;
    for(const dx of [-1,1]){const nx=x+dx;if(nx<0||nx>=w||!way(I(nx,y+1)))continue;const a=I(nx,y),b=I(x,y+1);
      if(soft(a)&&soft(b))solid[a]=solid[b]=0}}
  return solid}

// A crossing tile: a bridge, or river left open (a ford, or a bridge's shoulder).
export const crossing=(t,open)=>t===BRIDGE||(t===RIVER&&open);
// One step of a walker: onto an open tile, and on a diagonal only with both tiles beside it open.
export function stepOpen(solid,I,x,y,dx,dy){if(solid[I(x+dx,y+dy)])return false;return !dx||!dy||(!solid[I(x+dx,y)]&&!solid[I(x,y+dy)])}

// Walkable lands: open tiles joined by legal steps. Returns {land (Int32Array, -1 on solid), main}: main is the land of the
// first town's gate, else the largest. A land apart from main is a pocket shut in by peaks or trees: nobody is put there.
export function landsOf({tiles,I,w,h,CITY},solid){
  const land=new Int32Array(w*h).fill(-1),sizes=[];
  for(let s=0;s<w*h;s++){if(solid[s]||land[s]>=0)continue;
    const id=sizes.length,st=[s];land[s]=id;let n=0;
    while(st.length){const i=st.pop(),x=i%w,y=(i-x)/w;n++;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;
        if(land[I(nx,ny)]<0&&stepOpen(solid,I,x,y,dx,dy)){land[I(nx,ny)]=id;st.push(I(nx,ny))}}}
    sizes.push(n)}
  let main=sizes.indexOf(Math.max(0,...sizes));
  const c=(CITY||[]).find(t=>t.gate);if(c){const l=land[I(Math.min(w-1,Math.floor(c.gate.x)),Math.min(h-1,Math.floor(c.gate.y)))];if(l>=0)main=l}
  return {land,main}}
