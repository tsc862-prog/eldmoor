// The world map's picture (#1013 slice 6, src/ui/worldmap.js owns the screen): one pixel a tile, scaled up whole by the page.
// It paints what the view hands it and reads nothing else of the game: sea, the world's outline, each land by what the company knows of it
// (a walked land is its real ground, from its spec, built once; a land heard of is a hatch; an unknown one a fog), and the roads.
// Interface only: no sim state, no shared dice (hash and fbm are pure).
import {buildWorld} from '../world/gen.js';
import {MAPS} from '../world/spec.js';
import {TREE,SWAMP,MUD,ROCK,PEAK,LAVA,ROAD,FLOOR,WALL,RIVER,BRIDGE,SGRASS,SNOW,ICE} from '../world/tiles.js';
import {BIOME,TILE_FLAT} from './palette.js';
import {fbm,hash} from '../core/rng.js';

const rgb=s=>[parseInt(s.slice(1,3),16),parseInt(s.slice(3,5),16),parseInt(s.slice(5,7),16)];
const INK={sea:rgb('#0a0e1e'),sea2:rgb('#0e1428'),land:rgb('#191e2e'),land2:rgb('#1e2436'),coast:rgb('#3a4262'),
  fog:rgb('#272d42'),fogEdge:rgb('#454c6c'),heard:rgb('#6e5c34'),heardEdge:rgb('#bda262'),beenEdge:rgb('#d8c48a'),hereEdge:rgb('#f2c14e')};
const ROADS={walked:{c:rgb('#c8a86a'),on:9,off:0},known:{c:rgb('#a88c5c'),on:5,off:2},closed:{c:rgb('#a88c5c'),on:2,off:3},faint:{c:rgb('#4a5170'),on:1,off:5},active:{c:rgb('#f2c14e'),on:9,off:0}};
const FLAT=[];FLAT[SWAMP]=FLAT[MUD]=FLAT[SGRASS]=TILE_FLAT.swamp;FLAT[ROCK]=FLAT[PEAK]=TILE_FLAT.rock;FLAT[LAVA]=TILE_FLAT.lava;FLAT[SNOW]=FLAT[ICE]=TILE_FLAT.snow;
FLAT[RIVER]=TILE_FLAT.water;FLAT[ROAD]=FLAT[BRIDGE]=FLAT[FLOOR]=TILE_FLAT.road;FLAT[WALL]=TILE_FLAT.wall;
const SEED=47;

// A built map's ground as colours, once: its spec never changes while a page is open.
const ground={};
function groundOf(id){if(ground[id])return ground[id];const sp=MAPS[id];if(!sp)return null;const m=buildWorld(sp),px=new Uint8Array(m.w*m.h*3);
  for(let i=0;i<m.w*m.h;i++){const t=m.tiles[i],b=BIOME[(m.REGIONS[m.zone[i]]||{}).biome]||BIOME.meadow,c=rgb(t===TREE?b.forest:FLAT[t]||b.ground);px[i*3]=c[0];px[i*3+1]=c[1];px[i*3+2]=c[2]}
  return ground[id]={w:m.w,h:m.h,px}}

const segDist=(x,y,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(x-a.x-t*dx,y-a.y-t*dy)};
const rectDist=(x,y,l)=>Math.hypot(Math.max(l.x-x,0,x-l.x-l.w),Math.max(l.y-y,0,y-l.y-l.h));
// The sea and the world's outline: a coast round every land and along every road. The same for a campaign whatever anyone knows.
let base=null,baseKey='';
function baseOf(v){const {x:bx,y:by,w,h}=v.box,key=[bx,by,w,h,v.lands.map(l=>l.id).join()].join();if(base&&baseKey===key)return base;
  const isLand=(x,y)=>{const n=(fbm(x*.42,y*.42,SEED)-.5)*46;let d=1e9;for(const l of v.lands)d=Math.min(d,rectDist(x,y,l)-22);for(const r of v.roads)d=Math.min(d,segDist(x,y,r.pa,r.pb)-11);return d<n};
  const m=new Uint8Array(w*h),px=new Uint8ClampedArray(w*h*4);
  for(let j=0;j<h;j++)for(let i=0;i<w;i++)m[j*w+i]=isLand(bx+i,by+j)?1:0;
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){const k=j*w+i,x=bx+i,y=by+j,on=m[k],edge=on&&(!i||!j||i===w-1||j===h-1||!m[k-1]||!m[k+1]||!m[k-w]||!m[k+w]);
    const c=edge?INK.coast:on?(hash(x>>1,y>>1,SEED)<.16?INK.land2:INK.land):(hash(x>>2,y,SEED+1)<.07?INK.sea2:INK.sea);px[k*4]=c[0];px[k*4+1]=c[1];px[k*4+2]=c[2];px[k*4+3]=255}
  baseKey=key;return base=px}

// The land's own shape: its box with a ragged edge, so nothing on the map reads as a window.
function inLand(l,x,y){const e=Math.min(x-l.x,l.x+l.w-1-x,y-l.y,l.y+l.h-1-y);return e>=0&&e>=fbm(x*1.3,y*1.3,SEED+3)*6-1.5}
function paintLand(px,box,l){const put=(x,y,c)=>{const i=x-box.x,j=y-box.y;if(i<0||j<0||i>=box.w||j>=box.h)return;const o=(j*box.w+i)*4;px[o]=c[0];px[o+1]=c[1];px[o+2]=c[2]};
  const walked=l.state==='here'||l.state==='been',g=walked?groundOf(l.id):null,dim=l.state==='been'?.66:1,edge=l.state==='here'?INK.hereEdge:l.state==='been'?INK.beenEdge:l.state==='heard'?INK.heardEdge:INK.fogEdge;
  for(let y=l.y;y<l.y+l.h;y++)for(let x=l.x;x<l.x+l.w;x++){if(!inLand(l,x,y))continue;
    const rim=!inLand(l,x-1,y)||!inLand(l,x+1,y)||!inLand(l,x,y-1)||!inLand(l,x,y+1);
    if(rim){if(walked||l.state==='heard'||(x+y)%4<2)put(x,y,edge);continue}
    if(g){const o=(Math.min(g.h-1,Math.floor((y-l.y)*g.h/l.h))*g.w+Math.min(g.w-1,Math.floor((x-l.x)*g.w/l.w)))*3;put(x,y,[g.px[o]*dim,g.px[o+1]*dim,g.px[o+2]*dim]);continue}
    if(l.state==='heard'?(x-y)%3===0:(x+y)%4===0)put(x,y,l.state==='heard'?INK.heard:INK.fog)}}
// A road in stepped pixels, two wide. Who may see what of it is decided before it gets here.
function paintRoad(px,box,r){const s=ROADS[r.active?'active':r.state]||ROADS.faint,n=Math.ceil(Math.max(Math.abs(r.pb.x-r.pa.x),Math.abs(r.pb.y-r.pa.y)))||1,put=(x,y)=>{const i=x-box.x,j=y-box.y;if(i<0||j<0||i>=box.w||j>=box.h)return;const o=(j*box.w+i)*4;px[o]=s.c[0];px[o+1]=s.c[1];px[o+2]=s.c[2]};
  for(let i=0;i<=n;i++){if(s.off&&i%(s.on+s.off)>=s.on)continue;const x=Math.round(r.pa.x+(r.pb.x-r.pa.x)*i/n),y=Math.round(r.pa.y+(r.pb.y-r.pa.y)*i/n);put(x,y);put(x+1,y);put(x,y+1);put(x+1,y+1)}}

// view: {box:{x,y,w,h}, lands:[{id,x,y,w,h,state}], roads:[{pa,pb,state,active}]}. The canvas takes the box's size; CSS scales it.
export function paintAtlas(cv,v){const {w,h}=v.box;if(cv.width!==w)cv.width=w;if(cv.height!==h)cv.height=h;const c=cv.getContext('2d'),img=c.createImageData(w,h),px=img.data;
  px.set(baseOf(v));for(const r of v.roads)paintRoad(px,v.box,r);for(const l of v.lands)paintLand(px,v.box,l);c.putImageData(img,0,0)}
