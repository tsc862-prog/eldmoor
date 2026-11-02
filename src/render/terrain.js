// Paints the map in cached 32x32-tile chunks on first request: a per-pixel procedural
// 16x16 texture for every tile, then city buildings and the crypt mouth on top.
// Owned by world-builder (textures) together with render (chunk cache).
import {hash,vnoise} from '../core/rng.js';
import {W,H,T,G,TREE,SWAMP,MUD,ROCK,PEAK,LAVA,ROAD,FLOOR,WALL,RIVER,BRIDGE,SGRASS,FLOWER,SNOW,ICE} from '../world/tiles.js';
import {tiles,zone,I,CITY,LANDMARKS} from '../world/map.js';
import {FAC} from '../data/factions.js';
import {biomeOfZone} from './palette.js';

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

// Colour of pixel (px,py) inside tile (tx,ty) of type t. px,py are 0..15.
export function texel(t,tx,ty,px,py){
  const x=tx*16+px,y=ty*16+py,h=hash(x,y,3);
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
function isWater(tx,ty){if(tx<0||ty<0||tx>=W||ty>=H)return true;const t=tiles[I(tx,ty)];return t===RIVER||t===BRIDGE}
const isPeak=(tx,ty)=>tx>=0&&ty>=0&&tx<W&&ty<H&&tiles[I(tx,ty)]===PEAK;
// Ridge height (the first rock row, 0..15) at local column px of the top peak tile (tx,ty). A tent wave
// of 26 px plus value noise, continuous in world x; at the range's open ends it slopes down to the foot.
function ridgeAt(tx,ty,px){const x=tx*16+px,ph=hash(0,ty,5)*26,t=Math.abs((((x+ph)/26)%1)*2-1),n=vnoise(x/17,ty*1.7,19);
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
function pixel(t,tx,ty,px,py){
  if(BLEND[t]){let d=3,n=-1,ox=0,oy=0;
    if(px<d){const k=tileOr(tx-1,ty);if(k>=0&&BLEND[k]&&fam(k)!==fam(t)){d=px;n=k;ox=-1;oy=0}}
    if(15-px<d){const k=tileOr(tx+1,ty);if(k>=0&&BLEND[k]&&fam(k)!==fam(t)){d=15-px;n=k;ox=1;oy=0}}
    if(py<d){const k=tileOr(tx,ty-1);if(k>=0&&BLEND[k]&&fam(k)!==fam(t)){d=py;n=k;ox=0;oy=-1}}
    if(15-py<d){const k=tileOr(tx,ty+1);if(k>=0&&BLEND[k]&&fam(k)!==fam(t)){d=15-py;n=k;ox=0;oy=1}}
    if(n>=0){const x=tx*16+px,y=ty*16+py;if(vnoise(x/2.3,y/2.3,93)>EDGE[d])return texel(n,tx+ox,ty+oy,px-ox*16,py-oy*16)}}
  return texel(t,tx,ty,px,py)}
// Light from the top left: ground just below or right of a mountain lies in its shadow, and
// the foot of a massif darkens where it meets the ground.
function shade(t,tx,ty,px,py){
  if(t===PEAK)return isPeak(tx,ty+1)||py<14?1:.82;
  if(t===WALL||t===FLOOR)return 1;
  let k=1;if(py<3&&isPeak(tx,ty-1))k=.72+py*.08;if(px<2&&isPeak(tx-1,ty))k=Math.min(k,.8+px*.08);return k}

// ---- chunks ----
// The map is painted in CH x CH tile canvases, each on its first request, and cached
// for the life of the page. draw.js asks only for the chunks that intersect the view,
// so a world 30x this size costs nothing until the camera reaches it.
export const CH=32;
export const CHUNKS_X=Math.ceil(W/CH),CHUNKS_Y=Math.ceil(H/CH);
const chunks=new Map();

// Cached canvas for chunk (cx,cy): min(CH,W-cx*CH)*T by min(CH,H-cy*CH)*T pixels.
export function getChunk(cx,cy){const k=cy*CHUNKS_X+cx;let c=chunks.get(k);if(!c){c=paintChunk(cx,cy);chunks.set(k,c)}return c}

function paintChunk(cx,cy){
  const tx0=cx*CH,ty0=cy*CH,cw=Math.min(CH,W-tx0),ch=Math.min(CH,H-ty0),stride=cw*T;
  const cv=document.createElement('canvas');cv.width=cw*T;cv.height=ch*T;
  const c=cv.getContext('2d');
  const img=c.createImageData(cw*T,ch*T),d=img.data;
  for(let j=0;j<ch;j++)for(let i=0;i<cw;i++){const tx=tx0+i,ty=ty0+j,t=tiles[I(tx,ty)];
    for(let py=0;py<T;py++)for(let px=0;px<T;px++){const col=rgb(pixel(t,tx,ty,px,py)),o=((j*T+py)*stride+i*T+px)*4,k=shade(t,tx,ty,px,py);
      d[o]=col[0]*k;d[o+1]=col[1]*k;d[o+2]=col[2]*k;d[o+3]=255}}
  c.putImageData(img,0,0);
  // decorations are painted in world pixels; the translated context clips them to this chunk
  c.translate(-tx0*T,-ty0*T);
  decorate(c,tx0,ty0,tx0+cw,ty0+ch);
  return cv}

// Paint every chunk into one W*T by H*T canvas. Compatibility helper for tools and
// previews; the renderer never calls it.
export function buildTerrain(){
  const terrain=document.createElement('canvas');terrain.width=W*T;terrain.height=H*T;
  const tctx=terrain.getContext('2d');
  for(let cy=0;cy<CHUNKS_Y;cy++)for(let cx=0;cx<CHUNKS_X;cx++)tctx.drawImage(getChunk(cx,cy),cx*CH*T,cy*CH*T);
  return terrain}

// City buildings, gate banners, graveyard stones and the crypt mouth, drawn in world
// pixels onto tctx. Only decorations whose tile box touches [x0,x1)x[y0,y1) are painted.
const hits=(ax0,ay0,ax1,ay1,x0,y0,x1,y1)=>ax0<x1&&ax1>x0&&ay0<y1&&ay1>y0;
function decorate(tctx,x0,y0,x1,y1){
  const R=(x,y,w,h,c)=>{tctx.fillStyle=c;tctx.fillRect(x,y,w,h)};
  // city buildings: auction house (faction roof, gold sign) and quest hall, gate banners, graveyard stones
  for(const c of CITY){const f=FAC[c.fac],ox=(c.x0-2)*T,dy=(c.y0-2)*T; // building layout is drawn relative to the town's top-left corner
    if(!hits(c.x0-2,c.y0-2,c.x0+13,c.y0+9,x0,y0,x1,y1))continue; // layout spans tiles x0+2..x0+12, y0+1..y0+7
    const bld=(x,y,roof,wall,sign)=>{x+=ox;
      R(x,y,48,14,roof);R(x,y,48,2,'#fff3');R(x+1,y+1,46,1,'#fff2');for(let r=4;r<14;r+=3)R(x,y+r,48,1,'#0004');R(x,y+13,48,1,'#0008');
      R(x+2,y+14,44,18,wall);R(x+2,y+30,44,2,'#0006');R(x+2,y+14,44,1,'#fff2');
      R(x+19,y+19,10,13,'#5a3a1c');R(x+20,y+20,8,12,'#3a2414');R(x+26,y+26,1,1,'#f2c14e');
      for(const wx of [x+7,x+35]){R(wx-1,wx===x+7?y+17:y+17,8,8,'#2a1c10');R(wx,y+18,6,6,'#9ad0ff');R(wx+3,y+18,1,6,'#2a1c10');R(wx,y+21,6,1,'#2a1c10');R(wx-1,y+24,8,1,'#d8d0c0')}
      if(sign){R(x+17,y+3,14,7,'#3a2414');R(x+18,y+4,12,5,sign);R(x+20,y+6,8,1,'#8a6a1a')}};
    bld(4*T,3*T+dy,f.dark,'#c8b890','#f2c14e');bld(8*T,3*T+dy,'#6a4a3a','#b8a888');
    for(const gy of [5,8]){const gx=12*T+6+ox,gyy=gy*T+dy-12;R(gx,gyy,2,20,'#3a2a1a');R(gx+2,gyy,8,6,f.color);R(gx+2,gyy+6,3,3,f.color);R(gx+7,gyy+6,3,3,f.color);R(gx+2,gyy+1,8,1,f.dark);R(gx+5,gyy+2,2,2,f.dark)}
    for(let i=0;i<3;i++){const gx=4*T+i*12+ox,gyy=8*T+dy+4;R(gx+1,gyy,4,1,'#5a5a66');R(gx,gyy+1,6,7,'#5a5a66');R(gx+1,gyy+1,4,1,'#6e6e7a');R(gx+2,gyy+3,2,2,'#3a3a46');R(gx-1,gyy+8,8,1,'#3a3a46')}
  }
  // dungeon mouths (every crypt landmark: the Sunken Crypt, the Hollow Cairn...), each over its 3x3 rock patch
  for(const L of LANDMARKS){const mo=L.kind==='crypt'&&L.mouth;
  if(mo&&hits(mo.x0,mo.y0,mo.x1+1,mo.y1+1,x0,y0,x1,y1)){const x=mo.x0*T,y=mo.y0*T;R(x+6,y+2,36,30,'#4a4652');R(x+6,y+2,36,4,'#78748a');R(x+6,y+2,4,30,'#78748a');R(x+38,y+2,4,30,'#78748a');
  R(x+10,y+6,28,1,'#2e2a34');R(x+16,y+12,16,20,'#0a0810');R(x+15,y+11,18,1,'#2e2a34');R(x+22,y+8,4,2,'#7ad0a0');R(x+23,y+9,2,1,'#c8ffd8');
  R(x+12,y+28,4,4,'#e8e4d8');R(x+32,y+28,4,4,'#e8e4d8');R(x+13,y+29,1,1,'#0a0810');R(x+15,y+29,1,1,'#0a0810');R(x+33,y+29,1,1,'#0a0810');R(x+35,y+29,1,1,'#0a0810')}}
}
