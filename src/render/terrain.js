// Paints the map in cached chunks on first request: a per-pixel texture for every tile, then the towns and landmarks
// on top (render/townart.js). Owned by world-builder (textures) together with render (chunk cache).
//
// Two resolutions (#177 tiers, render/tile.js): the procedural texels are drawn on a U x U (16x16) grid per tile, the
// generated assets at TILE x TILE (32x32 now, 64x64 later) art pixels. pixel() answers at art resolution and scales the
// procedural texel up where no asset covers a pixel. A chunk is painted at TILE resolution only while a terrain asset
// is loaded; with none it is painted at U and scaled by the renderer, which looks the same and costs a quarter.
import {hash,vnoise} from '../core/rng.js';
import {TILE,U,ART} from './tile.js';
import {W,H,G,TREE,SWAMP,MUD,ROCK,PEAK,LAVA,ROAD,FLOOR,WALL,RIVER,BRIDGE,SGRASS,FLOWER,SNOW,ICE} from '../world/tiles.js';
import {tiles,zone,I} from '../world/map.js';
import {biomeOfZone} from './palette.js';
import {asset,assetPixels,onAssets} from './assets.js';
import {ASSET_TOWNS,drawPlaces} from './townart.js';

// Generated tile art (#177, scripts/art/manifest.json): the asset id that may replace a tile type's
// procedural texel. A tile asset repeats every w x h art pixels (a TILE x TILE patch per tile at its tier); a missing
// or not yet loaded asset, or a transparent pixel of it, falls back to the procedural texel below. Every id
// here or in ASSET_ROAD, ASSET_EDGES or ASSET_PROPS needs a manifest entry whose hook names that table (npm run artcheck checks both ways).
export const ASSET_TILES={'tile:grass':G,'tile:meadow':FLOWER,'tile:fen-grass':SGRASS,'tile:swamp':SWAMP,'tile:mud':MUD,'tile:ash-rock':ROCK,'tile:snow':SNOW,'tile:ice':ICE};
// Road and water (slice 2): the road patch runs left to right and is turned for a north-south road; the water patch
// fills the river away from its banks (the banks are the bank-water transition pieces, else the procedural foam).
export const ASSET_ROAD={'tile:road':ROAD,'tile:water':RIVER};
const TILE_ASSET=[];for(const [id,t] of Object.entries(ASSET_TILES))TILE_ASSET[t]=id;

const rgbC={};const rgb=s=>rgbC[s]||(rgbC[s]=[parseInt(s.slice(1,3),16),parseInt(s.slice(3,5),16),parseInt(s.slice(5,7),16)]);
const pk=(a,h)=>a[Math.floor(h*a.length)%a.length];

// Per-tile feature anchors (tuft, pebble, reed, flower positions...), cached for
// the tile currently being painted so every pixel of it sees the same layout.
let fk=-1,fv=null;
function anchors(tx,ty,s,n,lo,hi){const k=ty*W+tx;if(k!==fk){fk=k;fv={}}if(fv[s])return fv[s];
  const a=[];for(let i=0;i<n;i++)a.push([lo+Math.floor(hash(tx,ty,s+i*2)*(hi-lo+1)),lo+Math.floor(hash(tx,ty,s+i*2+1)*(hi-lo+1))]);return fv[s]=a}
const at=(A,px,py)=>A.some(([ax,ay])=>ax===px&&ay===py);

// Thornvale grass: soft large-scale mottling so meadows read as one field, not a grid.
function grass(x,y,h){const n=vnoise(x/11,y/11,51);if(h>.95)return '#64b24e';return n>.6?pk(['#45923c','#4a9a40','#41893a'],h):n<.4?pk(['#377e33','#3a8236','#34782f'],h):pk(['#3f8a3a','#45923c','#3a8236','#41893a'],h)}
const SNOWP=['#e2e8ee','#d8e0e8','#dde4ec','#e6ecf2'];
function snowBase(x,y,h){return h>.985?'#ffffff':pk(SNOWP,h)}
const SGP=['#46622f','#3d5729','#42602c','#4a6632'];

// Procedural colour of pixel (px,py) inside tile (tx,ty) of type t. px,py are 0..U-1 (the 16x16 procedural grid).
export function texel(t,tx,ty,px,py){
  const x=tx*U+px,y=ty*U+py;
  const h=hash(x,y,3);
  switch(t){
    case G:{ // grass with tufts and a pebble
      for(const [ax,ay] of anchors(tx,ty,100,2,2,13)){const dx=px-ax,dy=py-ay;
        if(dx===0&&dy===-2)return '#8ad060';if((dx===0&&dy>=-1&&dy<=0)||(Math.abs(dx)===1&&dy===-1))return '#6cc050'}
      if(hash(tx,ty,115)>.5){const [ax,ay]=anchors(tx,ty,110,1,1,13)[0];if(py===ay&&(px===ax||px===ax+1))return px===ax?'#9a9080':'#7a7068';if(py===ay-1&&px===ax+1)return '#b0a898'}
      return grass(x,y,h)}
    case FLOWER:{ // meadow: grass plus three blooms on stems
      const A=anchors(tx,ty,120,3,2,11);
      for(let i=0;i<A.length;i++){const [ax,ay]=A[i],dx=px-ax,dy=py-ay,c=hash(tx,ty,130+i);
        if(dx===0&&dy===0)return '#fff6b0';
        if((Math.abs(dx)===1&&dy===0)||(dx===0&&Math.abs(dy)===1))return c>.66?'#f4e06a':c>.33?'#f08ab0':'#f4f4f8';
        if(dx===0&&(dy===2||dy===3))return '#2a6a28';if(dx===1&&dy===3)return '#3f8a3a'}
      return grass(x,y,h)}
    case TREE:{const bio=biomeOfZone(zone[I(tx,ty)]); // tree kind by the region's biome, never its index
      if(bio==='tundra'){ // Hoarfell pine: tiered blue-green spire, snow on the cap and lit tiers, trunk, on snow
        const dx=px-7.5;if(py<=11){const hw=.6+py*.6;
          if(Math.abs(dx)<hw){const tier=py%4;
            if(py<=2)return '#eef2f8';
            if(tier===0&&dx<0)return '#dde6ee';
            if(tier===3&&Math.abs(dx)>hw-2.2)return '#10302a';
            if(dx<-1.2)return h>.85?'#3a7a66':'#2c6a58';if(dx>1.2)return h>.9?'#1e4a3e':'#163a30';
            return pk(['#1e4f44','#24584a'],h)}}
        else if(px===7||px===8)return px===7?'#3a2a20':'#241810';
        if(py>=12&&px>=9&&px<=11)return '#c8d2de';
        return snowBase(x,y,h)}
      if(bio==='fen'){ // Mirefen swamp tree: wide olive canopy, hanging moss strands, crooked trunk, on wet grass
        const dx=px-7.5,dy=py-5.5,r2=(dx*dx)/58+(dy*dy)/27;
        if(r2<1){if(r2>.74)return '#2a3a1e';if(dx+dy*1.2<-3.2)return '#7a9a44';if(dx+dy>3.2)return '#34502a';return h>.88?'#5a7a3a':pk(['#4e6e2e','#46642a','#4a6a2c'],h)}
        if((px===2||px===5||px===10||px===13)&&py>=8&&py<=(px%2?11:10))return '#5a7a34';
        if(py>=9&&(px===7||px===8))return px===7?'#4a3a28':'#2e2418';
        if(py===15&&(px===6||px===9))return '#3a2e20';
        return h>.93?'#3a5a4a':pk(SGP,h)}
      // Thornvale oak: round canopy with lit crown and shadowed skirt, trunk and roots, on grass
      const dx=px-7.5,dy=py-6.5,r2=(dx*dx)/52+(dy*dy)/36;
      if(r2<1){if(r2>.74)return '#1a5a22';if(dx+dy*1.1<-3.6)return '#5cb84e';if(dx+dy>3.4)return '#1e6a28';return h>.9?'#4aa844':pk(['#2f8a36','#2a7e31','#338f3a'],h)}
      if(py>=11&&(px===7||px===8))return px===7?'#5a3a20':'#3a2414';
      if(py===15&&(px===6||px===9))return '#4a3018';
      if(py>=12&&px>=9&&px<=12)return '#2f6a2c';
      return grass(x,y,h)}
    case SNOW:{ // drifts (a soft wavy ridge on some tiles) and sparkle
      if(hash(tx,ty,8)>.35){const w=Math.sin(x/4.5+hash(tx,ty,7)*6)*1.6,c=7+Math.round(hash(tx,ty,9)*4);
        if(Math.abs(py-c-w)<.6)return '#c4ced8';if(Math.abs(py-c+1-w)<.6)return '#f8fafc'}
      const A=anchors(tx,ty,140,2,1,14);if(at(A,px,py))return '#ffffff';
      if(A.some(([ax,ay])=>(Math.abs(px-ax)===1&&py===ay)||(px===ax&&Math.abs(py-ay)===1)))return '#f0f6fa';
      return snowBase(x,y,h)}
    case ICE:{ // cracked ice with a diagonal highlight sheen
      if(hash(tx,ty,10)>.4){const [ax,ay]=anchors(tx,ty,150,1,3,12)[0],sl=(hash(tx,ty,11)-.5)*1.6;
        if(Math.abs(px-ax)<=5&&py===Math.round(ay+(px-ax)*sl))return '#6a98b0';
        if(Math.abs(px-ax)<=2&&py===Math.round(ay-2+(px-ax)*-sl))return '#7aa8c0'}
      if((px+py+tx*5+ty*3)%16<2)return '#e4f8fc';
      if(h>.96)return '#dff6fc';
      return pk(['#b4dce8','#aad4e2','#bde2ec'],h)}
    case SWAMP:{ // murky water with ripples, standing reeds and a rising bubble
      for(const [ax,ay] of anchors(tx,ty,160,2,1,14)){if(px===ax){const top=4+Math.floor(ay/3);if(py===top-1)return '#5a4a2a';if(py>=top&&py<=top+6)return py===top?'#8aa050':'#6a8a3a'}}
      const [bx,by]=anchors(tx,ty,170,1,2,13)[0];if(px===bx&&py===by)return '#9ad0c0';if(px===bx+1&&py===by-1)return '#7ab0a0';
      if(((px*2+py*5+ty*7+tx*3)%19)===0)return '#5a8a6a';
      return pk(['#2f5a4a','#2a5242','#335f4e','#2c5646'],h)}
    case MUD:{ // cracked mud with small stones and a wet sheen
      if(((px*5+py*3+tx*11)%23)===0||((px*2+py*7+ty*13)%29)===0)return '#3e3c22';
      for(const [ax,ay] of anchors(tx,ty,180,2,1,14))if(py===ay&&(px===ax||px===ax+1))return px===ax?'#7a7650':'#6a6644';
      if(vnoise(x/5,y/5,61)>.72)return pk(['#4e5a44','#4a5640'],h);
      return h>.9?'#6e6a3e':pk(['#5b5a34','#545330','#4f4e2c'],h)}
    case SGRASS:{ // fen grass: tall pale blades with a few yellowed tips
      for(const [ax,ay] of anchors(tx,ty,190,3,1,14)){if(px===ax&&py<=ay&&py>=ay-3)return py===ay-3?'#9ab060':'#7a9a46'}
      if(h>.97)return '#b0a858';
      return pk(SGP,h)}
    case ROCK:{ // grey stone with ash-dark patches, sparse lichen, cracks and highlights
      if(hash(tx,ty,12)>.72){const [ax,ay]=anchors(tx,ty,200,1,2,13)[0],dx=px-ax,dy=py-ay;if(dx*dx+dy*dy<=2)return h>.5?'#7e8a52':'#8e9a5c'}
      if(((px*3+py*5+tx*7+ty)%31)===0)return '#4a423e';
      if(h>.93)return '#8a807a';
      const n=vnoise(x/13,y/13,71);
      return n>.62?pk(['#5e5450','#585050','#625856'],h):n<.38?pk(['#746a64','#6e6460','#786e68'],h):pk(['#6e6460','#655c58','#5f5652','#6a605c'],h)}
    case PEAK:{ // mountains: a snow-capped apex where the range starts, rock faces (lit left,
      // shadowed right, a ridge down the middle) continuing on tiles below another peak
      const dx=px-7.5,up=ty>0&&tiles[I(tx,ty-1)]===PEAK;
      if(up){ // rock face: lit where the massif's west edge is, shadowed on its east edge, cracked in between
        const lft=tx>0&&tiles[I(tx-1,ty)]!==PEAK,rgt=tx<W-1&&tiles[I(tx+1,ty)]!==PEAK,edge=Math.round(Math.sin(y/4+tx*2)*1.5);
        if(lft&&px<=4+edge)return h>.85?'#b4aaa4':'#a0968e';
        if(rgt&&px>=11+edge)return h>.9?'#4e4642':'#443c38';
        if(((px*5+py*3+ty*7+tx*3)%19)===0)return '#4a423e';
        if(((px*3+py*7+tx*5)%23)===0)return '#8a807a';
        return pk(['#7a706a','#746a64','#6e6460'],h)}
      // top of a massif: one ridge line across the whole range (a tent wave plus noise, so
      // neighbouring tiles join into peaks and saddles), snow on the crest, faces lit where the
      // ridge rises to the right (they face the top-left light) and shadowed where it falls
      const r=ridgeAt(tx,ty,px),slope=ridgeAt(tx,ty,px+1)-ridgeAt(tx,ty,px-1),depth=py-r;
      if(depth<0)return groundOf(biomeOfZone(zone[I(tx,ty)]),x,y,h);
      const capped=r<6||biomeOfZone(zone[I(tx,ty)])==='tundra';
      if(capped&&depth<2.6-slope*.4)return slope<-.2?'#f4f6fa':slope>.2?'#c0c8d8':'#e2e6ee';
      if(slope<-.2)return depth<1?'#c4bab4':h>.85?'#b4aaa4':'#a0968e';
      if(slope>.2)return depth<1?'#6a625e':h>.9?'#4e4642':'#443c38';
      return depth<1?'#8a807a':pk(['#7a706a','#746a64','#6e6460'],h)}
    case LAVA:{ // glowing cells separated by dark crust, with a stray spark
      const n=vnoise(x/4,y/4,41);
      if(n>.62)return n>.7?'#3a1c16':'#5a2a1c';
      if(h>.985)return '#fff4a0';
      return n<.3?'#ffd04a':n<.45?'#f07a22':'#c8401a'}
    case ROAD:{ // packed earth with two wheel ruts and loose stones
      if((py===5||py===10)&&hash(x,py,33)>.3)return '#8e7448';
      for(const [ax,ay] of anchors(tx,ty,210,2,1,14)){if(py===ay&&(px===ax||px===ax+1))return '#c8b088';if(py===ay+1&&(px===ax||px===ax+1))return '#8a7048'}
      return h>.9?'#c4a878':pk(['#a88c5c','#9f8455','#a68a58'],h)}
    case FLOOR:{ // 8x8 flagstones with offset rows, mortar, highlights and a crack
      const ox=(py>>3)&1?4:0;if((px+ox)%8===0||py%8===0)return '#6a6a76';
      if((px+ox)%8===1&&py%8===1)return '#a0a0ac';
      if(h>.97)return '#74747e';
      return pk(['#8e8e9a','#86868f','#92929c'],h)}
    case WALL:{ // stone bricks, four rows per tile, with moss creeping up from the base
      const moss=hash(x>>1,y>>1,44);
      if(py>=10&&moss>.72)return moss>.86?'#5a8a44':'#4a7a3a';
      if(py%4===0||((px+(py>>2)*4)%8)===0)return '#2e2a34';
      if(py%4===1)return h>.6?'#6a6472':'#5a5462';
      return pk(['#5a5462','#544e5c','#504a58'],h)}
    case RIVER:{ // flowing water: wavy ripple crests and foam along the banks
      const bank=(px<=1&&!isWater(tx-1,ty))||(px>=14&&!isWater(tx+1,ty))||(py<=1&&!isWater(tx,ty-1))||(py>=14&&!isWater(tx,ty+1));
      if(bank)return h>.5?'#dce8f8':'#5a88d0';
      const wv=Math.round(Math.sin(x/3.2+ty*2.1)*1.2);
      if(((py+wv+ty*5)%8)===0&&h>.3)return h>.75?'#8ab8f0':'#6a9ce0';
      return pk(['#2e5fb0','#3468b8','#3a70c4','#3264b4'],h)}
    case BRIDGE:{ // plank deck with nails and side rails
      if(py<=1||py>=14)return py===0||py===15?'#3a2010':'#6a4426';
      if(py%4===1)return '#3a2010';
      if((px===2||px===13)&&py%4===3)return '#4a3018';
      return h>.9?'#9a6a3c':((py>>2)&1)?'#8a5a32':'#7a4e2a'}
  }return '#000'}
// The asset colour of tile type t at art pixel (ax,ay) of tile (tx,ty) (0..TILE-1), or null: the base tile patches, the
// road patch (turned for a north-south road) and the water patch (away from the banks, which keep the procedural foam).
function assetTexel(t,tx,ty,ax,ay){
  const x=tx*TILE+ax,y=ty*TILE+ay;
  if(TILE_ASSET[t]){const A=assetPixels(TILE_ASSET[t]);return A?A.hex[(y%A.h)*A.w+x%A.w]:null}
  if(t===ROAD){const A=assetPixels('tile:road');if(!A)return null;const v=roadVerticalAt(tx,ty),u=v?y:x,w=v?x:y;return A.hex[(w%A.h)*A.w+u%A.w]}
  if(t===RIVER){const A=assetPixels('tile:water');if(!A)return null;const px=Math.floor(ax/ART),py=Math.floor(ay/ART);
    if((px<=1&&!isWater(tx-1,ty))||(px>=U-2&&!isWater(tx+1,ty))||(py<=1&&!isWater(tx,ty-1))||(py>=U-2&&!isWater(tx,ty+1)))return null;
    return A.hex[(y%A.h)*A.w+x%A.w]}
  return null}
// Colour at art pixel (ax,ay): the asset where it covers the pixel, else the procedural texel scaled up to TILE.
export function artTexel(t,tx,ty,ax,ay){return assetTexel(t,tx,ty,ax,ay)||texel(t,tx,ty,Math.floor(ax/ART),Math.floor(ay/ART))} // floor: a neighbour's pixel may be negative
function isWater(tx,ty){if(tx<0||ty<0||tx>=W||ty>=H)return true;const t=tiles[I(tx,ty)];return t===RIVER||t===BRIDGE}
const isRoad=(tx,ty)=>{const t=tileOr(tx,ty);return t===ROAD||t===BRIDGE};
// A road whose only road neighbours lie north or south runs north-south: its patch is drawn turned.
export const roadVerticalAt=(tx,ty)=>(isRoad(tx,ty-1)||isRoad(tx,ty+1))&&!isRoad(tx-1,ty)&&!isRoad(tx+1,ty);
const isPeak=(tx,ty)=>tx>=0&&ty>=0&&tx<W&&ty<H&&tiles[I(tx,ty)]===PEAK;
// Ridge height (the first rock row, 0..15) at local column px of the top peak tile (tx,ty). A tent wave
// of 26 px plus value noise, continuous in world x; at the range's open ends it slopes down to the foot.
function ridgeAt(tx,ty,px){const x=tx*U+px,ph=hash(0,ty,5)*26,t=Math.abs((((x+ph)/26)%1)*2-1),n=vnoise(x/17,ty*1.7,19);
  let r=1+t*7+n*4;
  if(!isPeak(tx-1,ty))r=Math.max(r,14-px*1.3);
  if(!isPeak(tx+1,ty))r=Math.max(r,14-(15-px)*1.3);
  return r}
// Plain ground of a biome, behind a ridge.
function groundOf(bio,x,y,h){return bio==='tundra'?snowBase(x,y,h):bio==='ash'?pk(['#6e6460','#655c58','#5f5652','#6a605c'],h):bio==='fen'?pk(SGP,h):grass(x,y,h)}


// ---- tile cohesion ----
// Ground tiles bleed into their neighbours over a ragged, noise-shaped band up to three pixels
// deep, so biome and road edges stop being tile-aligned squares. Objects (trees, peaks, walls,
// floors, the river and bridges) keep their crisp edges. Same-family pairs (grass and meadow)
// never blend. The neighbour's colour comes from its own texel at the same world pixel, so
// ruts, drifts and noise run on across the seam.
const BLEND=new Uint8Array(16);for(const t of [G,FLOWER,SGRASS,MUD,SNOW,ICE,ROCK,ROAD,LAVA,SWAMP])BLEND[t]=1;
const fam=t=>t===FLOWER?G:t;
const EDGE=[.42,.6,.78]; // noise threshold by distance to the edge: nearer edges bleed more
const tileOr=(tx,ty)=>tx<0||ty<0||tx>=W||ty>=H?-1:tiles[I(tx,ty)];
// The blend is decided on the procedural grid (pixel (px,py) of U x U), so it bleeds the same at every tier; (ax,ay) is
// the art pixel (0..TILE-1) inside it whose colour is wanted, from the asset of whichever tile type wins.
// With art=false it answers at the procedural grid alone (ax,ay unused): the no-asset fast path of paintChunk.
function blendPixel(t,tx,ty,px,py,ax,ay,art=true){
  if(BLEND[t]){let d=3,n=-1,ox=0,oy=0;const L=U-1;
    if(px<d){const k=tileOr(tx-1,ty);if(k>=0&&BLEND[k]&&fam(k)!==fam(t)){d=px;n=k;ox=-1;oy=0}}
    if(L-px<d){const k=tileOr(tx+1,ty);if(k>=0&&BLEND[k]&&fam(k)!==fam(t)){d=L-px;n=k;ox=1;oy=0}}
    if(py<d){const k=tileOr(tx,ty-1);if(k>=0&&BLEND[k]&&fam(k)!==fam(t)){d=py;n=k;ox=0;oy=-1}}
    if(L-py<d){const k=tileOr(tx,ty+1);if(k>=0&&BLEND[k]&&fam(k)!==fam(t)){d=L-py;n=k;ox=0;oy=1}}
    if(n>=0){const x=tx*U+px,y=ty*U+py;if(vnoise(x/2.3,y/2.3,93)>EDGE[d])return art?artTexel(n,tx+ox,ty+oy,ax-ox*TILE,ay-oy*TILE):texel(n,tx+ox,ty+oy,px-ox*U,py-oy*U)}}
  return art?artTexel(t,tx,ty,ax,ay):texel(t,tx,ty,px,py)}
// ---- autotile (#177 slice 2) ----
// Transition pieces sit on the tile corners (a "dual grid"): every pixel belongs to the quadrant of its tile nearest
// one corner point, and the four tiles around that point decide what is drawn there. Four tiles of two ground types
// that form a pair below get one TILE x TILE piece centred on the point: an edge (two and two), a corner (one B tile) or an
// inner corner (three B tiles), turned or mirrored to fit. Pieces are drawn as A on top and B below (edge), B in the
// bottom-right quarter (corner) and A in the top-left quarter (inner). Anything else (one tile type, two in a diagonal,
// three types, objects, the map's rim), a missing piece or a transparent pixel of one falls back to the procedural
// edge blend below, per quadrant, so with no assets the map is painted exactly as before.
const PAIRS=[
  {id:'grass-road',a:[G,FLOWER],b:[ROAD]},
  {id:'bank-water',a:[G,FLOWER],b:[RIVER]},
  {id:'meadow-fen',a:[G,FLOWER],b:[SGRASS]},
  {id:'fen-ash',a:[SGRASS],b:[ROCK]},
  {id:'ash-snow',a:[ROCK],b:[SNOW]},
  {id:'fen-river',a:[SGRASS],b:[RIVER]},
  {id:'snow-river',a:[SNOW],b:[RIVER]},
  {id:'mud-swamp',a:[MUD],b:[SWAMP]}];
const PIECE={edge:'',corner:'-corner',inner:'-inner'};
export const ASSET_EDGES={};
for(const p of PAIRS)for(const k of Object.values(PIECE))ASSET_EDGES['autotile:'+p.id+k]=[p.a[0],p.b[0]];
const PAIR_AT=new Map(); // (type,type) -> pair index, either order
PAIRS.forEach((p,i)=>{for(const a of p.a)for(const b of p.b){PAIR_AT.set(a*16+b,i);PAIR_AT.set(b*16+a,i)}});
// Quadrant mask of the B tiles around a point (bit 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right) ->
// [piece, transform]. A transform maps the point-local pixel (x,y) to the piece's pixel (u,v), with L = TILE-1:
// 0 (x,y)  1 (L-x,L-y)  2 (y,x)  3 (y,L-x)  4 (x,L-y)  5 (L-x,y). Masks 6 and 9 (diagonal) have no piece.
const QUAD=[];
QUAD[12]=['edge',0];QUAD[3]=['edge',1];QUAD[10]=['edge',2];QUAD[5]=['edge',3];
QUAD[8]=['corner',0];QUAD[1]=['corner',1];QUAD[2]=['corner',4];QUAD[4]=['corner',5];
QUAD[14]=['inner',0];QUAD[7]=['inner',1];QUAD[13]=['inner',5];QUAD[11]=['inner',4];
function sampleXf(A,xf,x,y){let u=x,v=y;const L=TILE-1;
  if(xf===1){u=L-x;v=L-y}else if(xf===2){u=y;v=x}else if(xf===3){u=y;v=L-x}else if(xf===4){v=L-y}else if(xf===5){u=L-x}
  return A.hex[(v%A.h)*A.w+u%A.w]}
// The transition piece on the corner point (vx,vy) (the top-left corner of tile (vx,vy)): {id, A, xf} or null.
// With asset=false it answers the piece id the point wants even when the asset is missing (for checks and tools).
export function autotileAt(vx,vy,asset=true){
  const q0=tileOr(vx-1,vy-1),q1=tileOr(vx,vy-1),q2=tileOr(vx-1,vy),q3=tileOr(vx,vy);
  if(q0<0||q1<0||q2<0||q3<0)return null;
  let o=-1;for(const t of [q1,q2,q3])if(fam(t)!==fam(q0)){o=t;break}
  if(o<0)return null;
  const pi=PAIR_AT.get(q0*16+o);if(pi===undefined)return null;
  const P=PAIRS[pi],B=P.b;let m=0,i=0;
  for(const t of [q0,q1,q2,q3]){if(B.includes(t))m|=1<<i;else if(!P.a.includes(t))return null;i++}
  const k=QUAD[m];if(!k)return null;
  const id='autotile:'+P.id+PIECE[k[0]];
  if(!asset)return {id,xf:k[1]};
  const A=assetPixels(id);return A?{id,A,xf:k[1]}:null}

// Tree and rock variants (#177 slice 2): three of each per biome, picked by a hash of the tile (never the sim's RNG).
// A tree replaces the procedural tree of a TREE tile, standing on that biome's ground texel; a rock sits on about one
// ground tile in 28 of its biome's own ground type. A missing variant gives way to the next one there is; none at all
// is today's tree and no rock.
const VARIANTS=3,PROP_BIOMES=['meadow','fen','ash','tundra','highland'];
// The highland has its own cut rocks and canopies (Hawkwold, the Vale); a world whose highland has none of its own keeps borrowing the meadow's.
const propBiome=b=>b==='highland'?'highland':!PROP_BIOMES.includes(b)?'meadow':b;
const GROUND={meadow:G,fen:SGRASS,ash:ROCK,tundra:SNOW,highland:G};
export const ASSET_PROPS={};
for(const b of PROP_BIOMES)for(let i=1;i<=VARIANTS;i++){if(b!=='highland')ASSET_PROPS[`prop:tree-${b}-${i}`]=TREE;ASSET_PROPS[`prop:rock-${b}-${i}`]=GROUND[b]}
// Whole trees (#834): LPC crowns are 3 tiles wide and 2.5 tall, so a tree is bigger than a one-tile prop. prop:canopy-<biome>-1..3
// (96x120 art px at the 32 tier: crown, trunk and its ground shadow, root on row CANOPY_ROOT) stand on about every other TREE tile
// (a checkerboard of the map's own tiles, nothing the sim sees) and are drawn over the chunk's ground in tile-row order. A TREE tile of
// a biome with a canopy loaded paints its ground only; with none, the procedural tree of the tile is drawn as before. Trees are painted
// into the cached chunk, so they cost nothing per frame; draw.js redraws the ones standing in front of an entity (treesNear).
export const ASSET_CANOPY={};
for(const b of PROP_BIOMES)for(let i=1;i<=VARIANTS;i++)ASSET_CANOPY[`prop:canopy-${b}-${i}`]=TREE;
export const CANOPY_ROOT=108; // art px from the top of a canopy image to where its trunk meets the ground
const EMPTY={w:1,h:1,hex:[null]};
function canopyImg(b,h){const n=Math.floor(h*VARIANTS)%VARIANTS;let got=null;
  for(let k=0;k<VARIANTS;k++){const id=`prop:canopy-${b}-${1+(n+k)%VARIANTS}`,im=asset(id);if(im&&!got)got={id,im}}
  return got}
const treeSpots=new Map(); // tile key -> anchor {tree, x, y (the base, in tiles), ax, ay, w, h (world units), im} or false
function anchorAt(tx,ty){if(tx<0||ty<0||tx>=W||ty>=H)return null;const k=ty*W+tx;let a=treeSpots.get(k);if(a!==undefined)return a||null;
  a=false;if(tiles[I(tx,ty)]===TREE&&((tx+ty)&1)===0){const v=canopyImg(propBiome(biomeOfZone(zone[I(tx,ty)])),hash(tx,ty,611));
    if(v){const w=v.im.naturalWidth/ART,h=v.im.naturalHeight/ART;
      a={tree:true,id:v.id,im:v.im,x:tx+.5,y:ty+1,ax:(tx+.5)*U+(hash(tx,ty,613)-.5)*5-w/2,ay:(ty+1)*U-CANOPY_ROOT/ART+(hash(tx,ty,615)-.5)*3-1,w,h}}}
  treeSpots.set(k,a);return a||null}
// Paint the trees that reach chunk tiles x0..x1 by y0..y1 (crowns overhang: a tree rooted up to two rows below or a column aside counts).
function paintCanopy(c,x0,y0,x1,y1){for(let ty=y0;ty<Math.min(H,y1+3);ty++)for(let tx=Math.max(0,x0-2);tx<Math.min(W,x1+2);tx++){const a=anchorAt(tx,ty);if(a)c.drawImage(a.im,a.ax,a.ay,a.w,a.h)}}
export const drawTree=(c,a)=>c.drawImage(a.im,a.ax,a.ay,a.w,a.h);
export const treeAnchor=anchorAt; // the whole tree standing on tile (tx,ty), or null: shadows.js and lightmap.js read where trees are
// The trees standing in front of something at (x,y) tiles (its feet): rooted below it, close enough for a crown or a crown over a crown
// to reach it. Pushed into out once each per frame (stamp), for draw.js to sort among the entities and redraw over them.
export function treesNear(x,y,out,stamp){if(!canopyOn)return;const cx=Math.floor(x),cy=Math.floor(y);
  for(let ty=cy;ty<=cy+5;ty++)for(let tx=cx-3;tx<=cx+3;tx++){const a=anchorAt(tx,ty);if(a&&a.y>y&&a.stamp!==stamp){a.stamp=stamp;out.push(a)}}}
let canopyOn=false;
const ROCK_ODDS=.036,ROCK_ODDS_BY={highland:.06}; // a rockier upland
function pickVariant(kind,b,h,asset){const n=Math.floor(h*VARIANTS)%VARIANTS;
  for(let k=0;k<VARIANTS;k++){const id=`prop:${kind}-${b}-${1+(n+k)%VARIANTS}`;if(!asset)return {id};const A=assetPixels(id);if(A)return {id,A}}
  return null}
// The prop of tile (tx,ty): {id, A, kind:'tree'|'rock', ground} or null (asset=false: the id it wants, asset or not).
export function propAt(tx,ty,asset=true){const t=tileOr(tx,ty);if(t<0)return null;
  const b=propBiome(biomeOfZone(zone[I(tx,ty)]));
  if(t===TREE&&asset&&canopyImg(b,0))return {id:'canopy',A:EMPTY,kind:'tree',ground:GROUND[b]}; // the tree is a whole canopy tree over this tile's ground (paintCanopy)
  if(t===TREE){const v=pickVariant('tree',b==='highland'?'meadow':b,hash(tx,ty,611),asset); // highland has canopies, no one-tile trees
   return v&&{...v,kind:'tree',ground:GROUND[b]}}
  if(t===GROUND[b]&&hash(tx,ty,617)<(ROCK_ODDS_BY[b]||ROCK_ODDS)){const v=pickVariant('rock',b,hash(tx,ty,619),asset);return v&&{...v,kind:'rock',ground:t}}
  return null}

// Per-tile plan, worked out once for the tile being painted: its four corner pieces and its prop.
let planKey=-1;const plan={q:[null,null,null,null],prop:null};
function planFor(tx,ty){const k=ty*W+tx;if(k===planKey)return plan;planKey=k;
  for(let i=0;i<4;i++)plan.q[i]=autotileAt(tx+(i&1),ty+(i>>1));
  plan.prop=propAt(tx,ty);return plan}
// Final colour of art pixel (ax,ay) (0..TILE-1) of tile (tx,ty) of type t, before the shade: prop, transition piece,
// then the blend and the texel (the base tile, road and water assets, else the procedural texel scaled up).
const HALF=TILE>>1;
export function pixel(t,tx,ty,ax,ay){const P=planFor(tx,ty),pr=P.prop;
  if(pr){const c=pr.A.hex[(ay%pr.A.h)*pr.A.w+ax%pr.A.w];if(c)return c;if(pr.kind==='tree')return artTexel(pr.ground,tx,ty,ax,ay)}
  const q=P.q[(ax>=HALF?1:0)+(ay>=HALF?2:0)];
  if(q){const c=sampleXf(q.A,q.xf,(ax+HALF)%TILE,(ay+HALF)%TILE);if(c)return c}
  return blendPixel(t,tx,ty,(ax/ART)|0,(ay/ART)|0,ax,ay)}
// The same at the procedural grid only (px,py 0..U-1), for chunks painted with no terrain asset loaded.
export const procPixel=(t,tx,ty,px,py)=>blendPixel(t,tx,ty,px,py,0,0,false);

// Light from the top left: ground just below or right of a mountain lies in its shadow, and
// the foot of a massif darkens where it meets the ground. (px,py) on the procedural grid.
export function shade(t,tx,ty,px,py){
  if(t===PEAK)return isPeak(tx,ty+1)||py<14?1:.82;
  if(t===WALL||t===FLOOR)return 1;
  let k=1;if(py<3&&isPeak(tx,ty-1))k=.72+py*.08;if(px<2&&isPeak(tx-1,ty))k=Math.min(k,.8+px*.08);return k}

// ---- chunks ----
// The map is painted in CH x CH tile canvases, each on its first request, and cached
// for the life of the page. draw.js asks only for the chunks that intersect the view,
// so a world 30x this size costs nothing until the camera reaches it. A chunk is about 1024 art pixels square at any
// tier (32 tiles at 32 px, 16 at 64), so a tier change keeps the canvases the same size.
export const CH=Math.max(8,Math.round(1024/TILE));
export const CHUNKS_X=Math.ceil(W/CH),CHUNKS_Y=Math.ceil(H/CH);
const chunks=new Map();
// Bumped whenever cached chunks are thrown away, so a renderer holding a copy of them (draw.js's still-camera terrain
// cache, #716) knows to redraw it.
export let chunkGen=0;
// Whether any terrain asset is loaded (then chunks are painted at TILE, else at U). Refreshed when assets change.
let artOn=null;
const terrainIds=()=>[ASSET_TILES,ASSET_ROAD,ASSET_EDGES,ASSET_PROPS,ASSET_CANOPY,ASSET_TOWNS].flatMap(Object.keys); // a town or landmark piece too: it is drawn at TILE
export function terrainArt(){if(artOn===null)artOn=terrainIds().some(id=>assetPixels(id));return artOn}
// A tile asset arrived (or the index changed): repaint on the next request. A sprite sheet is none of the terrain's business:
// each one used to throw every chunk away, a stall on whatever camera was up when the sheets came in (#729).
onAssets(id=>{if(id!=null&&!terrainIds().includes(id))return;chunks.clear();chunkGen++;treeSpots.clear();planKey=-1;artOn=null;canopyOn=PROP_BIOMES.some(b=>canopyImg(b,0))});

// Cached canvas for chunk (cx,cy): min(CH,W-cx*CH) by min(CH,H-cy*CH) tiles at k pixels a tile (TILE, or U with no
// terrain asset). c.uw and c.uh give its size in world units (tiles * U), which is what the renderer scales it to.
export function getChunk(cx,cy){const k=cy*CHUNKS_X+cx;let c=chunks.get(k);if(!c){c=paintChunk(cx,cy);chunks.set(k,c)}return c}

function paintChunk(cx,cy){
  const art=terrainArt(),k=art?TILE:U,tx0=cx*CH,ty0=cy*CH,cw=Math.min(CH,W-tx0),ch=Math.min(CH,H-ty0),stride=cw*k;
  const cv=document.createElement('canvas');cv.width=cw*k;cv.height=ch*k;cv.uw=cw*U;cv.uh=ch*U;
  const c=cv.getContext('2d');
  const img=c.createImageData(cw*k,ch*k),d=img.data;
  for(let j=0;j<ch;j++)for(let i=0;i<cw;i++){const tx=tx0+i,ty=ty0+j,t=tiles[I(tx,ty)];
    for(let py=0;py<k;py++)for(let px=0;px<k;px++){
      const col=rgb(art?pixel(t,tx,ty,px,py):procPixel(t,tx,ty,px,py)),o=((j*k+py)*stride+i*k+px)*4,sh=art?shade(t,tx,ty,(px/ART)|0,(py/ART)|0):shade(t,tx,ty,px,py);
      d[o]=col[0]*sh;d[o+1]=col[1]*sh;d[o+2]=col[2]*sh;d[o+3]=255}}
  c.putImageData(img,0,0);
  // decorations are painted in world units; the scaled, translated context clips them to this chunk
  c.scale(k/U,k/U);c.translate(-tx0*U,-ty0*U);
  if(art)paintCanopy(c,tx0,ty0,tx0+cw,ty0+ch);
  decorate(c,tx0,ty0,tx0+cw,ty0+ch);
  return cv}

// Paint every chunk into one W*U by H*U canvas (world units). Compatibility helper for tools and
// previews; the renderer never calls it.
export function buildTerrain(){
  const terrain=document.createElement('canvas');terrain.width=W*U;terrain.height=H*U;
  const tctx=terrain.getContext('2d');tctx.imageSmoothingEnabled=false;
  for(let cy=0;cy<CHUNKS_Y;cy++)for(let cx=0;cx<CHUNKS_X;cx++){const c=getChunk(cx,cy);tctx.drawImage(c,cx*CH*U,cy*CH*U,c.uw,c.uh)}
  return terrain}

// Towns and landmarks (walls, gate, buildings, banners, graves, crypt mouths, the lair): render/townart.js draws them in
// world units onto the chunk context, from their generated assets or procedurally (#177 slice 3).
function decorate(tctx,x0,y0,x1,y1){drawPlaces(tctx,x0,y0,x1,y1)}
