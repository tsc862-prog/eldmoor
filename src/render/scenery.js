// Scenery (epic #940 slice E): what turns a map of tiles into a country. A world opts in with `scenery` in its spec, data only:
//   wash     region id -> ground tone (meadow, heath, woods, ash): large soft patches, so a region reads at a glance
//   fields   [x, y, w, h, wheat|cabbage|plough]: farmland round the towns, laid only on open grass
//   dress    landmark name -> weir, barrow, vaults, kiln, lair: the ground a dungeon mouth or lair stands in
//   bridges  'x,y' of a bridge tile -> stone, timber, char (default: char in ash country, else timber)
//   head     {x, y}: where the river rises
//   clear    [x, y, r]: trees that would hide a place stand as stumps (a ford clears itself the same way)
// A world with no note paints exactly as before: every entry point below answers at once.
//
// Render only: it reads tiles, zones, the solid grid and the spec; it changes none of them, draws into the cached terrain chunks,
// so it costs nothing per frame, and nothing here is tall enough to read as a wall heroes walk through. Everything is placed by
// hashes of tile coordinates. Pieces come from one sheet, `prop:scenery`; with the sheet absent the river and the tones still paint
// (from the tile art) and the pieces are simply not there. Light from the top left, like the rest of the map.
import {hash,vnoise} from '../core/rng.js';
import {U,ART,TILE} from './tile.js';
import {W,H,G,TREE,ROCK,LAVA,ROAD,RIVER,BRIDGE,SGRASS,FLOWER,SNOW,ICE,MUD,SWAMP,PEAK} from '../world/tiles.js';
import {tiles,zone,I,CITY,LANDMARKS,REGIONS,OUTPOSTS,solid} from '../world/map.js';
import {ACTIVE_SPEC} from '../world/spec.js';
import {asset,assetPixels,onAssets} from './assets.js';
import {outsideTown} from '../world/gen.js';
import {ATLAS} from './sceneryatlas.js';

export const ASSET_SCENERY={'prop:scenery':TREE}; // hook table (artcheck): the sheet of pieces; no piece, no procedural stand-in
const NOTE=ACTIVE_SPEC.scenery||null;
export const sceneryOn=!!NOTE;
const SHEET='prop:scenery';

// ---- colours ----
const rgbOf=s=>[parseInt(s.slice(1,3),16),parseInt(s.slice(3,5),16),parseInt(s.slice(5,7),16)];
const hx=v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0');
const mixC=new Map();
// a blended k of the way to b, cached by the three: the art has few colours, so the table stays small
function mix(a,b,k){const q=(k*32)|0;let m=mixC.get(b+q);if(!m){m=new Map();mixC.set(b+q,m)}let r=m.get(a);if(r)return r;
  const A=rgbOf(a),B=rgbOf(b),t=q/32;r='#'+hx(A[0]+(B[0]-A[0])*t)+hx(A[1]+(B[1]-A[1])*t)+hx(A[2]+(B[2]-A[2])*t);m.set(a,r);return r}

// ---- fields over the map, four samples a tile ----
const R=4,FW=W*R,FH=H*R;
function field(test,rad,passes=2){let a=new Float32Array(FW*FH),b=new Float32Array(FW*FH);
  for(let j=0;j<FH;j++)for(let i=0;i<FW;i++)a[j*FW+i]=test(i/R|0,j/R|0)?1:0;
  const n=rad*2+1;for(let p=0;p<passes;p++){
    for(let j=0;j<FH;j++){let s=0;const o=j*FW;for(let i=-rad;i<=rad;i++)s+=a[o+Math.max(0,Math.min(FW-1,i))];
      for(let i=0;i<FW;i++){b[o+i]=s/n;s+=a[o+Math.min(FW-1,i+rad+1)]-a[o+Math.max(0,i-rad)]}}
    for(let i=0;i<FW;i++){let s=0;for(let j=-rad;j<=rad;j++)s+=b[Math.max(0,Math.min(FH-1,j))*FW+i];
      for(let j=0;j<FH;j++){a[j*FW+i]=s/n;s+=b[Math.min(FH-1,j+rad+1)*FW+i]-b[Math.max(0,j-rad)*FW+i]}}}
  return a}
function at(f,x,y){const u=Math.max(0,Math.min(FW-1.001,x*R-.5)),v=Math.max(0,Math.min(FH-1.001,y*R-.5)),i=u|0,j=v|0,s=u-i,t=v-j,o=j*FW+i;
  return (f[o]*(1-s)+f[o+1]*s)*(1-t)+(f[o+FW]*(1-s)+f[o+FW+1]*s)*t}

const tt=(x,y)=>x<0||y<0||x>=W||y>=H?-1:tiles[I(x,y)];
const isW=t=>t===RIVER||t===BRIDGE;
const WASH={meadow:1,heath:2,woods:3,ash:4};
const STYLE={meadow:{lip:'#7a4f2b',face:'#4b2e1c',shore:'#b08e5e',tint:null},
  fen:{lip:'#5a4a2c',face:'#332818',shore:'#7a6c44',tint:['#3a5a40',.34]},
  ash:{lip:'#524643',face:'#2a2321',shore:'#7a6e66',tint:['#2c4a58',.3]},
  tundra:{lip:'#d8e4f0',face:'#93aac0',shore:'#eef4fa',tint:['#a4d4e8',.34]}};
const biomeStyle=z=>{const b=REGIONS[z]&&REGIONS[z].biome;return STYLE[b]||STYLE.meadow};

let D=null; // the world's fields, worked out on first use
function data(){if(D)return D;
  const water=field((x,y)=>isW(tt(x,y)),3),lava=field((x,y)=>tt(x,y)===LAVA,5),trees=field((x,y)=>tt(x,y)===TREE,3,1);
  const near=new Uint8Array(W*H);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(!isW(tt(x,y)))continue;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const X=x+dx,Y=y+dy;if(X>=0&&Y>=0&&X<W&&Y<H)near[I(X,Y)]=1}}
  const tone=new Float32Array(FW*FH),rust=new Float32Array(FW*FH);
  for(let j=0;j<FH;j++)for(let i=0;i<FW;i++){const x=i/R,y=j/R;tone[j*FW+i]=vnoise(x/9,y/9,301)*.62+vnoise(x/3.4,y/3.4,303)*.28+vnoise(x/1.3,y/1.3,305)*.1;rust[j*FW+i]=vnoise(x/6,y/6,307)}
  const wash=new Uint8Array(W*H);{const w=NOTE.wash||{},byZ=REGIONS.map(r=>WASH[w[r.id]]||0);for(let k=0;k<W*H;k++)wash[k]=byZ[zone[k]]||0}
  const seam=new Uint8Array(W*H);for(let y=0;y<H;y++)for(let x=0;x<W;x++){const k=I(x,y);for(let j=-4;j<=4&&!seam[k];j++)for(let i=-4;i<=4;i++){const X=x+i,Y=y+j;if(X>=0&&Y>=0&&X<W&&Y<H&&wash[I(X,Y)]!==wash[k]){seam[k]=1;break}}}
  const fords=[];for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(tt(x,y)===RIVER&&!solid[I(x,y)])fords.push([x,y]);
  const fc=fords.length?[fords.reduce((s,f)=>s+f[0],0)/fords.length+.5,fords.reduce((s,f)=>s+f[1],0)/fords.length+.5]:null;
  const farm=new Uint8Array(W*H);for(const [x,y,w,h] of NOTE.fields||[])for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++){const t=tt(i,j);
    // a field is not a box: its corners are cut and its edge cells wander (a field of 3 rows or fewer keeps its rows, losing only ends)
    const ex=i===x||i===x+w-1,ey=(j===y||j===y+h-1)&&h>3,hh=hash(i,j,879);if((ex&&ey)||((ex||ey)&&hh<.34)||(ex&&h<=3&&hh<.5&&j!==y+(h>>1)))continue;
    if(t===G||t===FLOWER)farm[I(i,j)]=1}
  const lair=LANDMARKS.find(L=>L.kind==='lair'&&(NOTE.dress||{})[L.name]==='lair')||null;
  // roads out in the country (a town's own streets keep their tiles), and the land they pass over
  const town=(x,y)=>CITY.some(c=>!outsideTown(c,x,y));
  const open=new Uint8Array(W*H);for(let y=0;y<H;y++)for(let x=0;x<W;x++)if((tt(x,y)===ROAD||tt(x,y)===BRIDGE)&&!town(x,y))open[I(x,y)]=1;
  const road=field((x,y)=>x>=0&&y>=0&&x<W&&y<H&&open[I(x,y)],2);
  const nearR=new Uint8Array(W*H);for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(!open[I(x,y)])continue;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const X=x+dx,Y=y+dy;if(X>=0&&Y>=0&&X<W&&Y<H&&!town(X,Y))nearR[I(X,Y)]=1}}
  // felled ground: trees that would hide a crossing stand as stumps instead (the tile stays solid, and looks it)
  const felled=new Uint8Array(W*H);{const cut=(cx,cy,r)=>{for(let y=Math.floor(cy-r);y<=cy+r;y++)for(let x=Math.floor(cx-r);x<=cx+r;x++)if(tt(x,y)===TREE&&Math.hypot(x+.5-cx,y+.5-cy)<=r)felled[I(x,y)]=1};
    if(fc)cut(fc[0]+.5,fc[1]+.2,3.6);for(const [x,y,r] of NOTE.clear||[])cut(x,y,r)}
  // the ground's own kinds, for soilAt: what each tile counts as, a blurred mask of each kind, and which tiles have more than one kind near them
  const cls=new Int8Array(W*H);for(let y=0;y<H;y++)for(let x=0;x<W;x++)cls[I(x,y)]=soilClass(x,y,open);
  const mask=new Map();for(const t of new Set(cls))if(t>=0)mask.set(t,field((x,y)=>x>=0&&y>=0&&x<W&&y<H&&cls[I(x,y)]===t,3));
  const soft=new Array(W*H).fill(null);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(cls[I(x,y)]<0)continue;const L=[];for(let j=-2;j<=2;j++)for(let i=-2;i<=2;i++){const X=x+i,Y=y+j;if(X<0||Y<0||X>=W||Y>=H)continue;const t=cls[I(X,Y)];if(t>=0&&!L.includes(t))L.push(t)}
    if(L.length>1)soft[I(x,y)]=L.sort((a,b)=>a-b)}
  return D={water,lava,trees,near,tone,rust,wash,seam,fords,fc,farm,lair,road,nearR,open,felled,cls,mask,soft}}

// ---- the river ----
// How wet a point is, 0 to 1: the painted water's edge is at .5. render/water.js keeps its marks on the water by it.
export const waterLevel=(x,y)=>NOTE?at(data().water,x,y):0;
export const farmAt=(x,y)=>!!NOTE&&!!data().farm[I(x,y)]; // a tile of a field as it was laid (render/sway.js ripples the wheat)
// Water is the map's RIVER and BRIDGE tiles smoothed: a blur of the tile mask cut at one half keeps the line on straight reaches and
// rounds the tile stairs, so the whole river reads as one water. Land the curve gives back to a river tile is drawn as ground; the
// bank is a dark cut face where the water lies south of it and a pale strand where it lies north (we look down from the south).
const B4=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
export function riverPixel(tx,ty,ax,ay){if(!NOTE)return null;const d=data(),k=ty*W+tx;if(!d.near[k])return null;
  const x=tx+(ax+.5)/TILE,y=ty+(ay+.5)/TILE,F=at(d.water,x,y)+(vnoise(x*2.7,y*2.7,211)-.5)*.09;
  if(F<.39)return null;
  const s=biomeStyle(zone[Math.min(W-1,Math.max(0,tx+(hash((tx*TILE+ax)>>2,(ty*TILE+ay)>>2,221)*5|0)-2))+ty*W]); // a ragged line where one region's water gives way to the next
  if(F>=.5){const A=assetPixels('tile:water');let c=A?(A.hex[((ty*TILE+ay)%A.h)*A.w+(tx*TILE+ax)%A.w]||'#3468b8'):'#3468b8';
    if(s.tint)c=mix(c,s.tint[0],s.tint[1]);
    if(d.fc){const fd=Math.hypot(x-d.fc[0],(y-d.fc[1])*.7);if(fd<4){const t=Math.min(1,(4-fd)/2.2),b=(B4[(ay&3)*4+(ax&3)]+.5)/16-.5;c=mix(c,'#7cc8c4',.68*t+b*.2);if(hash(tx*TILE+ax>>1,ty*TILE+ay>>1,223)>1-.2*t)c=mix(c,'#c4b48c',.6);if(F<.6&&t>.5)return mix(c,'#e8f4e8',.5)}}
    if(F<.53)return mix(c,'#b8f4f0',.62);
    if(F<.6)return mix(c,'#3fc0d4',.5);
    if(F>.76)return mix(c,'#0e3468',.3);
    return c}
  const g=at(d.water,x,y+.14)-at(d.water,x,y-.14),n=hash(tx*TILE+ax,ty*TILE+ay,227);
  if(g>0){if(F<.425)return n>.8?mix(s.lip,'#000000',.2):s.lip;return n>.86?s.lip:s.face}
  if(F>=.455)return n>.82?mix(s.shore,'#ffffff',.3):n<.15?s.lip:s.shore;
  return null}
// Roads get the river's treatment: the tile line smoothed, so a road on the diagonal is one track and not a stair of squares. tint: the road
// takes the colour of the country it crosses.
const ROADTINT={ash:['#5e5046',.5],tundra:['#8c8078',.36],fen:['#5a4a30',.24]};
export function roadPixel(tx,ty,ax,ay){if(!NOTE)return null;const d=data(),k=ty*W+tx;if(!d.nearR[k])return null;
  const x=tx+(ax+.5)/TILE,y=ty+(ay+.5)/TILE,F=at(d.road,x,y)+(vnoise(x*3.3,y*3.3,241)-.5)*.1;
  if(F<.385)return null;const A=assetPixels('tile:road'),X=tx*TILE+ax,Y=ty*TILE+ay;let c=A?(A.hex[(Y%A.h)*A.w+X%A.w]||'#a68a58'):'#a68a58';
  {const tintAt=(u,v)=>ROADTINT[(REGIONS[zoneNear(u,v)]||{}).biome],tn=tintAt(x,y)||tintAt(x-1.4,y)||tintAt(x+1.4,y)||tintAt(x,y-1.4)||tintAt(x,y+1.4);
    if(tn){const f=([[0,0],[-1.4,0],[1.4,0],[-.7,0],[.7,0],[0,-1.4],[0,1.4],[0,-.7],[0,.7]].filter(([i,j])=>tintAt(x+i,y+j)===tn).length/9);c=mix(c,tn[0],tn[1]*f)}} // the road takes its new colour over a couple of tiles
  if(F<.43)return hash(X,Y,243)>.55?mix(c,'#2a2014',.42):mix(c,'#2a2014',.24);
  if(F>.62&&hash(X>>1,Y>>1,245)>.965)return mix(c,'#fff0d0',.3);
  return c}
// The tile a pixel of (tx,ty) stands on once water and country roads are drawn as shapes of their own: their dry edges are plain ground.
const gC=new Map();
export function sceneGround(t,tx,ty){if(!NOTE)return t;if(t===FLOWER)return G;
  if(t===RIVER||t===BRIDGE||(t===ROAD&&data().open[ty*W+tx])){const k=ty*W+tx;let g=gC.get(k);if(g===undefined){g=dryGround(tx,ty);gC.set(k,g)}return g}
  return t}
export const treeFelled=(tx,ty)=>!!NOTE&&!!data().felled[ty*W+tx];
// The ground a water tile's dry edge is drawn with: the nearest plain ground round it.
const GROUNDS=new Set([G,FLOWER,SGRASS,MUD,SWAMP,ROCK,SNOW,ICE]);
export function dryGround(tx,ty){for(let r=1;r<=3;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const t=tt(tx+dx,ty+dy);if(GROUNDS.has(t))return t===FLOWER?G:t}return G}

// ---- the ground as shapes (#979) ----
// Grass, mud, fen water, ash, snow, ice and lava are tiles, and left to the tile grid their edges are stairs of squares. Here each kind's mask is blurred and every
// pixel near a border takes the strongest kind there, with a little noise, so ponds are round and flows run in curves. Lava stays where the sim has it to within a
// tile, as the river does. A lone speck of one kind in another (a rock tile in the snow) is smoothed away. Town tiles take no part.
// Straight runs of tiles stay straight under a blur, so the place a border is read at wanders first: this much of a tile, slowly. Region seams use it too.
const WARP=(x,y,s)=>(vnoise(x*.42,y*.42,s)-.5)*1.5+(vnoise(x*1.1,y*1.1,s+1)-.5)*.5;
const zoneCell=(x,y)=>I(Math.max(0,Math.min(W-1,Math.floor(x+WARP(x,y,237)*1.6))),Math.max(0,Math.min(H-1,Math.floor(y+WARP(x,y,239)*1.6))));
const zoneNear=(x,y)=>zone[zoneCell(x,y)];
const BIOME_SOIL={meadow:G,fen:SGRASS,ash:ROCK,tundra:SNOW,highland:G};
function soilClass(x,y,open){const t=tt(x,y);if(t===FLOWER)return G;if(t===G||t===SGRASS||t===MUD||t===SWAMP||t===ROCK||t===SNOW||t===ICE||t===LAVA)return t;
  if(t===TREE||t===PEAK){const b=REGIONS[zone[I(x,y)]]&&REGIONS[zone[I(x,y)]].biome;return BIOME_SOIL[b]??G}
  if(t===RIVER||t===BRIDGE||(t===ROAD&&open[I(x,y)]))return dryGround(x,y);
  return -1}
// The kind of ground art pixel (ax,ay) of tile (tx,ty) shows, or -1 where the tile's own kind stands alone. rim: how near the border, and against which kind.
export const soilRim={m:1,other:-1};
export function soilAt(tx,ty,ax,ay){if(!NOTE)return -1;const d=data(),L=d.soft[ty*W+tx];if(!L)return -1;
  const x0=tx+(ax+.5)/TILE,y0=ty+(ay+.5)/TILE,x=x0+WARP(x0,y0,267),y=y0+WARP(x0,y0,269),n=(vnoise(x*2.3,y*2.3,261)-.5)*.14;let b=-1,bv=-9,o=-1,ov=-9;
  for(let i=0;i<L.length;i++){const v=at(d.mask.get(L[i]),x,y)+(i&1?n:-n);if(v>bv){o=b;ov=bv;b=L[i];bv=v}else if(v>ov){o=L[i];ov=v}}
  soilRim.m=bv-ov;soilRim.other=o;return b}
// The border's own line: a lit lip and a shadow, by what meets what. c: the plain colour of kind k there.
export function soilEdge(c,k,tx,ty,ax,ay){const m=soilRim.m,o=soilRim.other,X=tx*TILE+ax,Y=ty*TILE+ay,h=hash(X,Y,265);if(m>.14)return c;
  if(k===ICE)return m<.05?mix(c,'#e4f2f8',.7):m<.1?mix(c,'#b4d8e6',.42):c; // the pool's frozen margin
  if(o===ICE&&k===SNOW){const d=data(),x=tx+(ax+.5)/TILE,y=ty+(ay+.5)/TILE,g=at(d.mask.get(ICE),x,y+.14)-at(d.mask.get(ICE),x,y-.14);return g>0?(m<.06?mix(c,'#7e9cb8',.72):m<.11?mix(c,'#a8c0d4',.5):c):(m<.05?mix(c,'#ffffff',.6):c)}
  if(k===LAVA)return m<.05?'#ffd86a':m<.1?mix(c,'#ffb040',.6):c;
  if(o===LAVA)return m<.07?mix(c,'#17100f',.86):m<.13?mix(c,'#2a1c18',.56):c;
  if(k===SWAMP)return m<.05?mix(c,'#141c14',.6):c;
  if(o===SWAMP)return m<.06?mix(c,'#26301e',.5):c;
  if(m<.035&&h>.4)return mix(c,'#000000',.14);
  return c}

// ---- ground tones ----
const LOOK=[null,
  {lo:['#2c7a36',.3],hi:['#9ac24a',.26],shade:'#1c5a2c'},
  {lo:['#5c7c38',.36],hi:['#bcaa4e',.34],shade:'#2f5a2c'},
  {all:['#2f6e58',.2],lo:['#1f5a48',.34],hi:['#7aa858',.16],shade:'#143f34'},
  {lo:['#332b2a',.64],hi:['#b0a294',.46],rust:['#7a4a34',.34]}];
const softMeadow=t=>t===G||t===FLOWER||t===TREE;
// Colour c of tile type t at art pixel (ax,ay) of tile (tx,ty), toned for its region.
export function tonePixel(c,t,tx,ty,ax,ay){if(!NOTE)return c;const d=data();
  const X=tx*TILE+ax,Y=ty*TILE+ay,x=tx+(ax+.5)/TILE,y=ty+(ay+.5)/TILE;
  const w=d.seam[ty*W+tx]?d.wash[zoneCell(x+(hash(X>>1,Y>>1,241)-.5)*2.6,y+(hash(X>>1,Y>>1,243)-.5)*2.6)]:d.wash[ty*W+tx]; // the line where one region's tone gives way to the next wanders with the ground's

  if(d.lair&&(t===SNOW||t===ICE||t===ROCK||t===TREE||t===PEAK||(t===LAVA&&parseInt(c.slice(5,7),16)>parseInt(c.slice(1,3),16)-8))){const q=Math.hypot(x-d.lair.x,y-d.lair.y)-(d.lair.r||5),n=at(d.tone,x,y),b=(B4[(Y&3)*4+(X&3)]+.5)/16-.5;
    if(q<8){const p=1-q/8+(n-.5)*1.3+b*.16;if(p>.92)c=mix(c,'#2c2624',.86);else if(p>.62)c=mix(c,'#57504e',.8);else if(p>.44)c=mix(c,'#8a8684',.6)}} // the wyrm's heat: snow gone to soot and slush round the nest
  if(w===0)return c;
  const L=LOOK[w],isAsh=w===4;
  if(isAsh?t!==ROCK:!softMeadow(t))return c; // not the peaks: toned, the cliffs lose their contrast
  if(L.all)c=mix(c,L.all[0],L.all[1]);
  const b=(B4[(Y&3)*4+(X&3)]+.5)/16-.5,v=at(d.tone,x,y)+b*.035;
  if(v<.43)c=mix(c,L.lo[0],L.lo[1]*Math.min(1,(.47-v)*9));else if(v>.56)c=mix(c,L.hi[0],L.hi[1]*Math.min(1,(v-.52)*9));
  if(isAsh){if(at(d.rust,x,y)+b*.03>.63)c=mix(c,L.rust[0],L.rust[1]);
    const f=at(d.lava,x,y);if(f>.05){const s=Math.min(1,f*2.6);c=mix(c,'#1e1716',s*.74);if(s>.3&&hash(X,Y,239)>.993)return '#f0762a'}}
  else if(L.shade){const f=at(d.trees,x,y);if(f>.34)c=mix(c,L.shade,Math.min(.36,(f-.3)*.8))}
  return c}

// ---- pieces ----
let sheet=null;onAssets(()=>{sheet=null});
const sheetImg=()=>sheet||(sheet=asset(SHEET));
const snap=v=>Math.round(v*ART)/ART;
// Piece n with its top-left at world (x,y); clip: art rows drawn (default all).
function pc(c,n,x,y,rows){const a=ATLAS[n],im=sheetImg();if(!a||!im)return;const h=rows||a[3];c.drawImage(im,a[0],a[1],a[2],h,snap(x),snap(y),a[2]/ART,h/ART)}
// Piece n standing with its foot at world (x,y), centred.
const foot=(c,n,x,y)=>{const a=ATLAS[n];if(a)pc(c,n,x-a[2]/ART/2,y-a[3]/ART)};
const rect=(c,x,y,w,h,k)=>{c.fillStyle=k;c.fillRect(x,y,w,h)};

const FLOWERS=[['#f2c94a','#c8922a'],['#f4f4ea','#c8ccd0'],['#e8604a','#b03a30'],['#7a9ce8','#4a68c0']];
// A drift of single blossoms round (x,y): a stem and a head each, thrown on a loose scatter so no tile's square shows.
function bloom(c,x,y,col,tx,ty,n){for(let i=0;i<n;i++){const a=hash(tx,ty,811+i)*6.283,r=Math.sqrt(hash(tx,ty,851+i))*13,px=snap(x+Math.cos(a)*r),py=snap(y+Math.sin(a)*r*.8),k=.5;
    rect(c,px,py+k,k,k*2,'#2c6a30');rect(c,px-k,py-k,k*3,k*2,col[1]);rect(c,px,py-k,k,k,col[0]);rect(c,px-k,py,k,k,col[0])}}
// One ember-lit crack, a walk of half-unit steps from (x,y).
function fissure(c,x,y,s){let dx=hash(x|0,y|0,s)>.5?1:-1;const n=7+(hash(x|0,y|0,s+1)*9|0);
  for(let i=0;i<n;i++){const hot=i>1&&i<n-2;rect(c,x,y,1,.5,'#1a1312');if(hot)rect(c,x,y+.5,1,.5,i&1?'#f07a2a':'#c8401a');else rect(c,x,y+.5,1,.5,'#2a201e');
    x+=1;if(hash(i,x|0,s+2)>.6)y+=dx*.5;if(hash(i,y|0,s+3)>.85)dx=-dx}}
// What lies on open ground, by the region's tone. h values are the tile's own hashes.
function scatter(c,tx,ty,t,w,d){const X=tx*U,Y=ty*U,h=hash(tx,ty,801),o=hash(tx,ty,802),ox=hash(tx,ty,803)*10-2,oy=hash(tx,ty,804)*10-2;
  if(w===1||w===2||w===3){if(t!==G&&t!==FLOWER)return;
    const f=vnoise(tx/4.5,ty/4.5,805);
    if(t===FLOWER||(w!==3&&f>.6&&o<.62)){const pick=vnoise(tx/9,ty/9,807)*1.6+o*.5;bloom(c,X+8,Y+8,FLOWERS[w===2?(pick>.9?3:0):Math.min(3,pick*2.2|0)],tx,ty,3+(h*4|0));if(t===FLOWER)return}
    if(w===1){if(h<.13)pc(c,'tuftGS',X+ox,Y+oy);else if(h<.18)pc(c,'tuftLS',X+ox,Y+oy);else if(h<.195)pc(c,'tuftG',X+ox-4,Y+oy-4);else if(h<.21)pc(c,'pebTanS',X+ox-2,Y+oy);else if(h<.235)pc(c,'blades',X+ox-6,Y+oy-6)}
    else if(w===2){if(h<.11)pc(c,'tuftBS',X+ox,Y+oy);else if(h<.2)pc(c,'tuftLS',X+ox,Y+oy);else if(h<.215)pc(c,'tuftB',X+ox-4,Y+oy-4);else if(h<.27)pc(c,'pebGreyS',X+ox-2,Y+oy);else if(h<.29)pc(c,'blades',X+ox-6,Y+oy-6)}
    else{if(h<.1)pc(c,'tuftDS',X+ox,Y+oy);else if(h<.125)pc(c,'tuftD',X+ox-4,Y+oy-4);else if(h<.15)pc(c,'stump',X+ox,Y+oy+4);else if(h<.18)pc(c,'pebGreyS',X+ox-2,Y+oy);else if(h<.22)pc(c,'blades',X+ox-6,Y+oy-6)}
    return}
  if(w===4&&t===ROCK){
    if(h<.08)pc(c,'pebDarkS',X+ox-2,Y+oy);else if(h<.1)pc(c,'pebDark',X+ox-4,Y+oy-4);else if(h<.2)pc(c,'pebGreyS',X+ox-2,Y+oy);else if(h<.27)pc(c,'pebTanS',X+ox-2,Y+oy);
    else if(h<.335)fissure(c,X+ox,Y+oy+2,811);else if(h<.36)pc(c,'stumpChar',X+ox,Y+oy+4);else if(h<.385)pc(c,'tuftBS',X+ox,Y+oy);
    else if(h<.397)pc(c,'tarPool',X+ox-4,Y+oy-4);else if(h<.406)pc(c,'skull',X+ox+2,Y+oy+4);else if(h<.42)pc(c,'femur',X+ox,Y+oy+6);else if(h<.426)foot(c,'cairn',X+8,Y+15);return}
  if(t===SGRASS||t===MUD){if(h<.12)pc(c,'tuftDS',X+ox,Y+oy);else if(h<.16)pc(c,'tuftD',X+ox-4,Y+oy-4);else if(h<.19&&t===MUD)pc(c,'pebTanS',X+ox-2,Y+oy);return}
  if(t===SNOW){if(h<.05)pc(c,'pebWhiteS',X+ox-2,Y+oy);else if(h<.07)pc(c,'pebGreyS',X+ox-2,Y+oy)}}

// The water's own furniture and the fringe of its banks.
function riverside(c,tx,ty,t,d){const X=tx*U,Y=ty*U,h=hash(tx,ty,821),o=hash(tx,ty,822),z=REGIONS[zone[I(tx,ty)]],b=z&&z.biome,ox=o*8;
  if(t===RIVER){const cen=at(d.water,tx+.5,ty+.5);if(cen<.6||!solid[I(tx,ty)])return;
    if(b==='tundra'){if(h<.4)pc(c,'floe',X+ox-2,Y+4+o*6)}
    else if(b==='ash'){if(h<.14){pc(c,'pebDarkS',X+ox-4,Y+2);rect(c,X+ox-3,Y+11,10,.5,'#e6f4f4')}}
    else if(b==='fen'){if(h<.3)pc(c,'lily',X+ox,Y+3+o*7);if(h<.1)pc(c,'lily',X+ox+6,Y+8)}
    else if(h<.09)pc(c,'lily',X+ox,Y+3+o*7);else if(h<.14){pc(c,'pebGreyS',X+ox-4,Y+2);rect(c,X+ox-3,Y+11,10,.5,'#e6f4f4')}
    return}
  const nS=isW(tt(tx,ty+1)),nN=isW(tt(tx,ty-1));if(!(nS||nN)||(t!==G&&t!==FLOWER&&t!==SGRASS&&t!==MUD&&t!==SNOW&&t!==ROCK))return;
  const y=nS?Y+8:Y-2;
  if(b==='fen'){pc(c,h<.6?'tuftD':'tuftDS',X+ox-6,y-8);if(o<.5)pc(c,'tuftDS',X+ox+2,y)}
  else if(b==='ash'){if(h<.3)pc(c,'pebDarkS',X+ox-4,y-2)}
  else if(b==='tundra'){if(h<.2)pc(c,'pebWhiteS',X+ox-4,y-2)}
  else{if(h<.55)pc(c,o<.5?'tuftGS':'tuftLS',X+ox-2,y);if(h>.8)pc(c,'tuftG',X+ox-6,y-6);else if(h>.7)pc(c,'pebTanS',X+ox-4,y)}}

function fields(c,x0,y0,x1,y1,d){for(const [fx,fy,fw,fh,kind] of NOTE.fields||[]){if(fx>x1||fy>y1||fx+fw<x0||fy+fh<y0)continue;
    for(let y=fy;y<fy+fh;y++)for(let x=fx;x<fx+fw;x++)if(d.farm[I(x,y)])pc(c,kind,x*U,y*U);
    for(let y=fy-1;y<=fy+fh;y++)for(let x=fx-1;x<=fx+fw;x++){if(x>=0&&y>=0&&x<W&&y<H&&!d.farm[I(x,y)]){const near=d.farm[I(Math.min(W-1,Math.max(0,Math.min(fx+fw-1,x))),Math.min(H-1,Math.max(0,Math.min(fy+fh-1,y))))];
        if(near&&(tt(x,y)===G||tt(x,y)===FLOWER)){const h=hash(x,y,831),px=x*U+(x<fx?10:x>=fx+fw?-6:h*8),py=y*U+(y<fy?10:y>=fy+fh?-6:h*8);pc(c,h<.5?'tuftGS':'tuftLS',px,py);if(h>.6)pc(c,'tuftGS',px+6,py-1)}}}
    const cx=fx+(fw>>1),cy=fy+(fh>>1);if(d.farm[I(cx,cy)]){if(kind==='plough')pc(c,'hay',cx*U-6,cy*U);else foot(c,'scarecrow',cx*U+8,cy*U+14)}}}

// ---- mounds: a low hill a mouth is cut into ----
const moundC=new Map();
function mound(w,h,mat,tint,key){const k=key;let cv=moundC.get(k);if(cv)return cv;if(typeof document==='undefined')return null;
  const A=assetPixels(mat),a=w/2-6,b=h-8,sd=hash(w,h,841)*50,inside=new Uint8Array(w*h),U2=new Float32Array(w*h),V2=new Float32Array(w*h);
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){const u=(i-w/2+.5)/a,v=(j-h+4)/b,q=Math.sqrt(u*u+v*v)+(vnoise(i/13+sd,j/13,843)-.5)*.2+(vnoise(i/5,j/5+sd,845)-.5)*.05;
    if(q<=1&&j<h-4){inside[j*w+i]=1;U2[j*w+i]=u;V2[j*w+i]=(v+.5)*1.7}}
  cv=document.createElement('canvas');cv.width=w;cv.height=h;const x=cv.getContext('2d'),img=x.createImageData(w,h),o=img.data;
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){const n=j*w+i,p=n*4;
    if(!inside[n]){if(i>=3&&j>=2&&inside[n-2*w-3]){o[p+3]=70}continue}
    const rim=!inside[n-1]||!inside[n+1]||!inside[n-w]||!inside[n+w],u=U2[n],v=V2[n],z=Math.sqrt(Math.max(0,1-Math.min(1,u*u+v*v))),l=-.5*u-.62*v+.6*z+((B4[(j&3)*4+(i&3)]+.5)/16-.5)*.1;
    let c=A?(A.hex[(j%A.h)*A.w+i%A.w]||'#6e6460'):'#6e6460';if(tint)c=mix(c,tint[0],tint[1]);
    c=rim?mix(c,'#15110f',.72):l>.82?mix(c,'#fff4dc',.26):l>.6?mix(c,'#fff4dc',.12):l<-.1?mix(c,'#15110f',.42):l<.18?mix(c,'#15110f',.24):c;
    const r=rgbOf(c);o[p]=r[0];o[p+1]=r[1];o[p+2]=r[2];o[p+3]=255}
  x.putImageData(img,0,0);moundC.set(k,cv);return cv}
onAssets(()=>moundC.clear());
const hit=(a,b,c2,d2,x0,y0,x1,y1)=>a<x1&&c2>x0&&b<y1&&d2>y0;
const MAT={weir:['tile:ash-rock',['#3e6c56',.42]],barrow:['tile:grass',null],vaults:['tile:mud',['#3a2a1e',.3]],kiln:['tile:ash-rock',['#2a2120',.56]]};
function dressMouth(c,L,kind){const m=L.mouth,bx=m.x0*U,by=m.y0*U,bw=(m.x1-m.x0+1)*U,base=(m.y1+1)*U,cx=bx+bw/2,M=MAT[kind];if(!M)return;
  const mw=(bw+3.2*U)*ART|0,mh=(base-by+1.6*U)*ART|0,cv=mound(mw,mh,M[0],M[1],L.name);
  if(cv)c.drawImage(cv,snap(cx-mw/ART/2),snap(base-mh/ART+1),mw/ART,mh/ART);
  const T=bw/3,tile=kind==='vaults'?'deck':'flag';for(let i=0;i<3;i++)pc(c,tile,bx+i*T,base,i===1?32:18);rect(c,bx,base,bw,1,'#0006');
  const l=bx-.6*U,r=bx+bw+.6*U;
  if(kind==='weir'){pc(c,'pool',l-1.4*U,base-4);pc(c,'pool',r-.6*U,base-4);foot(c,'torch',l,base+4);foot(c,'torch',r,base+4);pc(c,'tuftDS',l-1*U,base-U*.4);pc(c,'tuftDS',r+.5*U,base-U*.4);pc(c,'pebGreyS',cx-8,base+T);foot(c,'stone3',l-.9*U,base+.8*U)}
  if(kind==='barrow'){foot(c,'stone2',cx-1.6*U,by-.2*U);foot(c,'stone1',cx+.2*U,by-.7*U);foot(c,'stone2',cx+1.8*U,by-.1*U);foot(c,'stone3',l-.7*U,base-.6*U);foot(c,'stone1',r+.7*U,base-.5*U);foot(c,'stone3',l-.3*U,base+.9*U);foot(c,'stone1',r+.3*U,base+1*U);pc(c,'tuftL',l-1.2*U,by);pc(c,'tuftL',r,by+.3*U);pc(c,'flGold',bx-.2*U,base+T);foot(c,'cairn',r+1.6*U,base+.5*U)}
  if(kind==='vaults'){foot(c,'barrel',l-.5*U,base+.3*U);foot(c,'barrel',l+.4*U,base+.9*U);foot(c,'crate',r+.2*U,base+.2*U);foot(c,'crate',r+.8*U,base+.9*U);pc(c,'tarPool',r+.8*U,base-U*1.4);pc(c,'stumpChar',l-1.5*U,base-U*.8);pc(c,'pebDarkS',cx-8,base+T+2);pc(c,'hay',l-1.8*U,base+.9*U)}
  if(kind==='kiln'){for(const [x,y] of [[l-1.2*U,base-1.1*U],[r-.1*U,base-1.1*U]])pc(c,'brick',x,y);foot(c,'torch',l-.3*U,base+.6*U);foot(c,'torch',r+.3*U,base+.6*U);pc(c,'pebDark',l-1.7*U,base-2);pc(c,'pebDark',r+1.3*U,base-U);fissure(c,cx-14,base+T+3,851);fissure(c,cx+2,base+T+9,853)}}
// The burnt floor inside the lava ring, so the nest and the ring are one place; the way in stays open.
const floorC=new Map();
function lairFloor(L){let cv=floorC.get(L.name);if(cv!==undefined)return cv;if(typeof document==='undefined')return null;const r=(L.r||5)+2,S=Math.ceil(r*2*TILE);cv=document.createElement('canvas');cv.width=cv.height=S;
  const x=cv.getContext('2d'),img=x.createImageData(S,S),o=img.data,A=assetPixels('tile:ash-rock'),x0=L.x-r,y0=L.y-r,d=data(),dir={W:[-1,0],E:[1,0],N:[0,-1],S:[0,1]}[L.opening]||[-1,0];
  for(let j=0;j<S;j++)for(let i=0;i<S;i++){const wx=x0+(i+.5)/TILE,wy=y0+(j+.5)/TILE,t=tt(wx|0,wy|0),q=Math.hypot(wx-L.x,wy-L.y),ax=(wx-L.x)*dir[0]+(wy-L.y)*dir[1],ac=Math.abs((wx-L.x)*dir[1]+(wy-L.y)*dir[0]);
    if(t===PEAK||t===TREE||at(d.mask.get(LAVA),wx,wy)>.36)continue;const gate=ax>0&&ac<2.3-Math.max(0,q-(L.r||5))*.9+(vnoise(i/9,j/9,871)-.5)*.8;if(q>(L.r||5)+(vnoise(i/8,j/8,873)-.5)*.5&&!gate)continue;
    let c=A?(A.hex[(j%A.h)*A.w+i%A.w]||'#6e6460'):'#6e6460';c=mix(c,'#1e1817',.72);if(hash(i>>1,j>>1,875)>.996)c='#c8401a';const p=(j*S+i)*4,v=rgbOf(c);o[p]=v[0];o[p+1]=v[1];o[p+2]=v[2];o[p+3]=255}
  x.putImageData(img,0,0);floorC.set(L.name,cv);return cv}
onAssets(()=>floorC.clear());
function dressLair(c,L,x0,y0,x1,y1){const r=L.r||5,cx=L.x,cy=L.y;{const f=lairFloor(L),R2=r+2;if(f)c.drawImage(f,(cx-R2)*U,(cy-R2)*U,f.width/ART,f.height/ART)}
  // the bone field round the nest, and skulls on stakes either side of the way in (the side the lair opens to)
  for(let y=Math.floor(cy-r-5);y<=cy+r+5;y++)for(let x=Math.floor(cx-r-5);x<=cx+r+5;x++){if(x<x0-2||y<y0-2||x>x1+1||y>y1+1)continue;const t=tt(x,y),q=Math.hypot(x+.5-cx,y+.5-cy);if(t<0||q<r+.6||q>r+5.5||t===LAVA||t===PEAK||t===ROAD)continue;
    const h=hash(x,y,861),X=x*U,Y=y*U,o=hash(x,y,862)*8;
    if(h<.2)pc(c,'pebDarkS',X+o-2,Y+o);else if(h<.26)pc(c,'pebDark',X+o-4,Y+o-4);else if(h<.32)pc(c,'stumpChar',X+o-2,Y+o+3);else if(h<.38)pc(c,'femur',X+o,Y+o+2);else if(h<.42)pc(c,'skull',X+o,Y+o);else if(h<.445)pc(c,'ribs',X-4,Y+o-6)}
  const dir={W:[-1,0],E:[1,0],N:[0,-1],S:[0,1]}[L.opening]||[-1,0],px=-dir[1],py=dir[0];
  for(let i=0;i<3;i++){const a=r+1+i*1.5;for(const s of [-1,1]){const x=cx+dir[0]*a+px*s*1.9,y=cy+dir[1]*a+py*s*1.9;if(tt(x|0,y|0)<0||tt(x|0,y|0)===TREE)continue;foot(c,'stake',x*U,y*U+3)}}}

// A bridge: deck, rails and end posts over the smoothed water, turned to run the way its tiles run.
function bridges(c,x0,y0,x1,y1,d){for(const b of d.bridges||(d.bridges=findBridges())){if(!hit(b.x-2,b.y-2,b.x+b.w+2,b.y+b.h+2,x0,y0,x1,y1))continue;
    const key=`${b.x},${b.y}`,st=(NOTE.bridges||{})[key]||(REGIONS[zone[I(b.x,b.y)]]?.biome==='ash'?'char':'timber'),S=st==='stone'?['deckStone','railStone','postStone']:st==='char'?['deckChar','railChar','postChar']:['deck','rail','post'];
    const along=b.h>=b.w,len=(along?b.h:b.w)*U+U*1.3,cx=(b.x+b.w/2)*U,cy=(b.y+b.h/2)*U;
    c.save();c.translate(cx,cy);if(!along)c.rotate(Math.PI/2);
    rect(c,-8,-len/2-1,20,len+2,'#00000038'); // its shadow on the water, to the lower right
    for(let y=-len/2,left=len;left>0;y+=U,left-=U)pc(c,S[0],-8,y,Math.min(TILE,left*ART)|0);
    for(let y=-len/2,left=len;left>0;y+=U,left-=U){pc(c,S[1],-11,y,Math.min(TILE,left*ART)|0);pc(c,S[1],8,y,Math.min(TILE,left*ART)|0)}
    const a=ATLAS[S[2]];if(a)for(const y of [-len/2-2,0-a[3]/ART/2,len/2-a[3]/ART+1]){pc(c,S[2],-11-(a[2]/ART-3)/2,y);pc(c,S[2],8-(a[2]/ART-3)/2,y)}
    c.restore()}}
function findBridges(){const seen=new Uint8Array(W*H),out=[];for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(tt(x,y)!==BRIDGE||seen[I(x,y)])continue;let a=x,b=y,e=x,f=y;const st=[[x,y]];seen[I(x,y)]=1;
    while(st.length){const [u,v]=st.pop();a=Math.min(a,u);b=Math.min(b,v);e=Math.max(e,u);f=Math.max(f,v);for(const [p,q] of [[u+1,v],[u-1,v],[u,v+1],[u,v-1]])if(tt(p,q)===BRIDGE&&!seen[I(p,q)]){seen[I(p,q)]=1;st.push([p,q])}}
    out.push({x:a,y:b,w:e-a+1,h:f-b+1})}return out}
// The ford: stepping stones across the shallows, gravel where the road leaves the water, a cairn on each bank.
function ford(c,x0,y0,x1,y1,d){if(!d.fc)return;const [fx,fy]=d.fc;if(fx<x0-4||fx>x1+4||fy<y0-5||fy>y1+5)return;const span=d.fords.length/2+1.4;
  for(let i=-3;i<=3;i++){const y=fy+i*(span/5.2),x=fx+((i&1)?.22:-.22);foot(c,i&1?'stepB':'stepA',x*U,y*U+5);rect(c,x*U-3,y*U+6,6,.5,'#ecf8f4')}
  for(const dx of [1.6,2.1,2.7]){const y=fy+(hash(dx*10|0,1,871)-.5)*1.4;pc(c,'pebGreyS',(fx+dx)*U-8,y*U-4);rect(c,(fx+dx)*U-6,y*U+6,8,.5,'#ecf8f4')}
  pc(c,'pebTanS',(fx-.9)*U,(fy-span*.75)*U);pc(c,'pebTanS',(fx-.8)*U,(fy+span*.5)*U);pc(c,'pebTan',(fx-.6)*U,(fy+span*.75)*U);
  foot(c,'cairn',(fx+1.2)*U,(fy+span*.86)*U);foot(c,'post',(fx-.9)*U,(fy-span*.55)*U)}
function head(c,x0,y0,x1,y1){const hd=NOTE.head;if(!hd||hd.x<x0-4||hd.x>x1+4||hd.y<y0-4||hd.y>y1+4)return;const w=84,h=62,cv=mound(w,h,'tile:ash-rock',['#39424e',.4],'head');
  if(cv)c.drawImage(cv,snap(hd.x*U-w/ART*.3),snap(hd.y*U-h/ART*.62),w/ART,h/ART);
  pc(c,'floe',hd.x*U-1.6*U,hd.y*U-8);pc(c,'pebWhiteS',hd.x*U+.8*U,hd.y*U+6)}
function outposts(c,x0,y0,x1,y1){for(const o of OUTPOSTS){if(!hit(o.x-3,o.y-3,o.x+3,o.y+3,x0,y0,x1,y1))continue;const X=Math.floor(o.x-1)*U,Y=Math.floor(o.y-.5)*U;
    pc(c,'pebTanS',X+U*.2,Y+U*.7);pc(c,'pebTanS',X+U*1.5,Y+U*.2);foot(c,'cairn',X-U*.5,Y+U*.8);foot(c,'cairn',X+U*3.5,Y+U*1.2);foot(c,'torch',X+U*.3,Y+1);foot(c,'torch',X+U*2.7,Y+1);foot(c,'barrel',X+U*3.2,Y+U*.1);foot(c,'crate',X-U*.2,Y+U*.1)}}

// Paint chunk tiles x0..x1 by y0..y1 on context c, already in world units, under the trees and the towns.
export function paintScenery(c,x0,y0,x1,y1){if(!NOTE||!sheetImg())return;const d=data();c.imageSmoothingEnabled=false;
  fields(c,x0,y0,x1,y1,d);
  for(let ty=Math.max(0,y0-2);ty<Math.min(H,y1+2);ty++)for(let tx=Math.max(0,x0-2);tx<Math.min(W,x1+2);tx++){const k=I(tx,ty),t=tiles[k];if(d.farm[k])continue;
    if(d.near[k])riverside(c,tx,ty,t,d);
    if(d.felled[k]){const h=hash(tx,ty,885),ox=hash(tx,ty,886)*6-3,oy=hash(tx,ty,887)*5;if(h<.45)pc(c,'stump',tx*U-2+ox,ty*U+3+oy);else if(h<.8)pc(c,'tuftG',tx*U-8+ox,ty*U-8+oy);else pc(c,'pebGrey',tx*U-8+ox,ty*U-6+oy);continue}
    if(!isW(t)&&t!==ROAD&&!(d.near[k]&&at(d.water,tx+.5,ty+.5)>.3))scatter(c,tx,ty,t,d.wash[k],d)}
  bridges(c,x0,y0,x1,y1,d);ford(c,x0,y0,x1,y1,d);head(c,x0,y0,x1,y1);outposts(c,x0,y0,x1,y1);
  const dr=NOTE.dress||{};for(const L of LANDMARKS){const kind=dr[L.name];if(!kind)continue;
    if(kind==='lair'){const r=(L.r||5)+7;if(hit(L.x-r,L.y-r,L.x+r,L.y+r,x0,y0,x1,y1))dressLair(c,L,x0,y0,x1,y1)}
    else if(L.mouth&&hit(L.mouth.x0-5,L.mouth.y0-5,L.mouth.x1+6,L.mouth.y1+6,x0,y0,x1,y1))dressMouth(c,L,kind)}}
