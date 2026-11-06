// Mountains in the LPC look (#895): cliffs drawn from dual-grid atlases (assets autotile:peak-<set>, cut by
// scripts/art/packcut-peaks.mjs from the LPC cliff set) over whatever ground the biome has, so any border with a mountain (lava, ice,
// a road) is the ground's own and the cliff lies on it. With no atlas of this tier peakArt() is false and terrain.js paints the
// procedural mountain as before. Reads the map's tiles only; nothing here reaches the sim or the map hash.
//
// A massif is drawn in tiers, each a smaller shape standing on the one below: tier 1 is every PEAK tile, the next is what is left
// after taking one tile off all round the top surface of the last. A tier has two shapes on the dual grid (the same corner masks as
// terrain.js QUAD): the massif (the tier's tiles, a cliff face with its foot) and the cap (those with a tile of the tier below them,
// the top surface), so the bottom row of every tier shows a face and the rest its top. All of it stays on mountain tiles, which nothing
// walks on, so entities never pass behind it.
import {hash} from '../core/rng.js';
import {TILE} from './tile.js';
import {W,H,PEAK} from '../world/tiles.js';
import {tiles,zone,I} from '../world/map.js';
import {biomeOfZone} from './palette.js';
import {assetPixels,onAssets} from './assets.js';

const TIERS=3,HALF=TILE>>1;
// The rock of each biome, by tier of the massif from the foot up. A biome not listed takes the default.
const ROCK_OF={tundra:['snow','snow','snow'],ash:['ash','ash','ash'],default:['stone','stone','stone']};
export const ASSET_PEAKS={};for(const s of ['stone','ash','snow'])ASSET_PEAKS['autotile:peak-'+s]=PEAK;
const rockOf=(tier,tx,ty)=>(ROCK_OF[biomeOfZone(zone[I(tx,ty)])]||ROCK_OF.default)[tier-1];

const clampX=x=>Math.min(W-1,Math.max(0,x)),clampY=y=>Math.min(H-1,Math.max(0,y));
// mass[i], cap[i]: the highest tier tile i belongs to in that shape (0: none). near[i]: a mountain tile touches tile i.
let mass=null,cap=null,near=null;
function build(){
  const at=(a,x,y)=>a[I(clampX(x),clampY(y))]; // the map's rim counts as more of the same
  mass=new Uint8Array(W*H);cap=new Uint8Array(W*H);near=new Uint8Array(W*H);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(tiles[I(x,y)]===PEAK){mass[I(x,y)]=1;for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++)near[I(clampX(x+i),clampY(y+j))]=1}
  for(let t=1;t<=TIERS;t++){
    for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(mass[I(x,y)]>=t&&at(mass,x,y+1)>=t)cap[I(x,y)]=t;
    if(t<TIERS)for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(cap[I(x,y)]>=t&&at(cap,x-1,y)>=t&&at(cap,x+1,y)>=t&&at(cap,x,y-1)>=t&&at(cap,x,y+1)>=t)mass[I(x,y)]=t+1}}
const maskOf=(a,vx,vy,t)=>{const c=(x,y)=>a[I(clampX(x),clampY(y))]>=t?1:0;return c(vx-1,vy-1)|c(vx,vy-1)<<1|c(vx-1,vy)<<2|c(vx,vy)<<3};

let on=null;
export function peakArt(){if(on===null)on=Object.keys(ASSET_PEAKS).every(id=>assetPixels(id));return on}
// The pieces at corner (vx,vy), top first: flat [atlas, piece x, piece y, ...]. A whole piece (mask 15) hides what lies under it.
function pieces(vx,vy){const out=[],cx=clampX(vx),cy=clampY(vy);
  for(let t=TIERS;t>=1;t--)for(let r=1;r>=0;r--){const m=maskOf(r?cap:mass,vx,vy,t);if(!m)continue;
    const A=assetPixels('autotile:peak-'+rockOf(t,cx,cy));if(A)out.push(A,m*TILE,r*TILE);
    if(m===15)return out}
  return out}
// Peaks stand on the tops: whole sprites from the atlas (below its pieces: VARIANTS big ones, then VARIANTS small), on mountain tiles only, their
// feet LIFT art pixels above the bottom of a tile with a top surface (the lip below stays seen). Laid out once from the south up, by a hash of
// the place, never where one stands already; a tile keeps the list of those that reach it, the southern (nearer) first.
const VARIANTS=3,Z=TILE/32,BIG={w:96*Z,h:84*Z,tw:3,th:3,odds:.5},SMALL={w:64*Z,h:54*Z,tw:2,th:2,odds:.6},LIFT=10*Z;
let stamps=null;
function place(){stamps=new Array(W*H).fill(null);const used=new Uint8Array(W*H);
  const fits=(x,y,k)=>{if(x+k.tw>W||y-k.th+1<0)return false;
    for(let i=0;i<k.tw;i++){if(!cap[I(x+i,y)])return false;for(let j=0;j<k.th;j++)if(!mass[I(x+i,y-j)]||used[I(x+i,y-j)])return false}return true};
  const stand=(x,y,k,sx)=>{const s={k,tx:x,ty:y,sx,flip:hash(x,y,743)<.5,ox:x*TILE+((k.tw*TILE-k.w)>>1),oy:(y+1)*TILE-LIFT-k.h};
    for(let i=0;i<k.tw;i++)for(let j=0;j<k.th;j++){const n=I(x+i,y-j);used[n]=j<k.th-1?1:used[n];(stamps[n]||(stamps[n]=[])).push(s)}};
  for(let y=H-1;y>=0;y--)for(let x=0;x<W;x++){const v=Math.floor(hash(x,y,745)*VARIANTS);
    if(hash(x,y,741)<BIG.odds&&fits(x,y,BIG))stand(x,y,BIG,v*BIG.w);
    else if(hash(x,y,747)<SMALL.odds&&fits(x,y,SMALL))stand(x,y,SMALL,VARIANTS*BIG.w+v*SMALL.w)}}
let pk=-1,here=null;const quad=[null,null,null,null];
// The colour of art pixel (ax,ay) of tile (tx,ty) from the cliffs, or null where they leave the ground showing.
export function peakPixel(tx,ty,ax,ay){const k=ty*W+tx;
  if(!mass){build();place()}
  if(!near[I(tx,ty)])return null;
  if(k!==pk){pk=k;for(let i=0;i<4;i++)quad[i]=pieces(tx+(i&1),ty+(i>>1));here=stamps[I(tx,ty)]}
  if(here){const X=tx*TILE+ax,Y=ty*TILE+ay;for(const s of here){const u=X-s.ox,v=Y-s.oy;if(u<0||v<0||u>=s.k.w||v>=s.k.h)continue;
    const A=assetPixels('autotile:peak-'+rockOf(1,s.tx,s.ty)),c=A&&A.hex[(TILE*2+v)*A.w+s.sx+(s.flip?s.k.w-1-u:u)];if(c)return c}}
  const q=quad[(ax>=HALF?1:0)+(ay>=HALF?2:0)],u=(ax+HALF)%TILE,v=(ay+HALF)%TILE;
  for(let i=0;i<q.length;i+=3){const A=q[i],c=A.hex[(q[i+2]+v)*A.w+q[i+1]+u];if(c)return c}
  return null}
onAssets(()=>{on=null;pk=-1});
