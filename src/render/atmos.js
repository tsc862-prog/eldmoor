// The air between the camera and the ground (#979): mist on the water at dawn, haze lying over fen and ash, and weather fog with some depth. All of it is one
// small canvas (a sixth of the screen): for each kind of air a soft mask of where it lies, cut by a slow drifting cloud of noise, then the middle of the view is
// thinned so what the watcher is looking at stays clear, and one smooth blit puts it on the world, under the light map, so mist takes the hour's colour and
// flames glow through it. Masks are from the tiles and the regions' biomes; fog follows weatherKind by zone. Far views fade it out: it is ground air, a whole map
// sees none. Time is the frame clock, the noise is baked with core/rng's pure hash noise: no dice, no sim state.
import {W,H,RIVER,SWAMP,MUD,SGRASS,LAVA} from '../world/tiles.js';
import {tiles,I,zone,ZONES} from '../world/map.js';
import {vnoise} from '../core/rng.js';
import {U as T} from './tile.js';
import {biomeOfZone} from './palette.js';
import {weatherKind} from '../sim/weather.js';
import {G} from './grade.js';
import {FX} from './quality.js';

const NR=6,MK=2; // screen pixels a pixel; mask pixels a tile
const mk=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c};
const air=mk(4,4),ax=air.getContext('2d'),lay=mk(4,4),yx=lay.getContext('2d');
// A tileable cloud: value noise wrapped by blending the far edge. Alpha only, in the given colour, one canvas per colour.
const NOISE=256,clouds=new Map();
function cloud(rgb){let c=clouds.get(rgb);if(c)return c;c=mk(NOISE,NOISE);const x=c.getContext('2d'),id=x.createImageData(NOISE,NOISE),[r,g,b]=rgb.split(',').map(Number);
  const f=(u,v)=>vnoise(u/44,v/44,701)*.55+vnoise(u/19,v/19,703)*.3+vnoise(u/8,v/8,707)*.15;
  for(let j=0;j<NOISE;j++)for(let i=0;i<NOISE;i++){const wx=i/NOISE,wy=j/NOISE,n=(f(i,j)*(1-wx)+f(i-NOISE,j)*wx)*(1-wy)+(f(i,j-NOISE)*(1-wx)+f(i-NOISE,j-NOISE)*wx)*wy,o=(j*NOISE+i)*4;
    id.data[o]=r;id.data[o+1]=g;id.data[o+2]=b;id.data[o+3]=Math.max(0,Math.min(255,(n-.24)*400))}
  x.putImageData(id,0,0);clouds.set(rgb,c);return c}
// Soft masks of where each air lies, baked once.
// Each keeps a summed count of its tiles, so a layer with nothing in the view costs nothing.
function maskOf(fn){const r=mk(W*MK,H*MK),x=r.getContext('2d'),sat=new Int32Array((W+1)*(H+1));x.fillStyle='#fff';let any=false;
  for(let ty=0;ty<H;ty++)for(let tx=0;tx<W;tx++){const a=fn(tx,ty);if(a>0){x.globalAlpha=a;x.fillRect(tx*MK,ty*MK,MK,MK);any=true}
    sat[(ty+1)*(W+1)+tx+1]=(a>0?1:0)+sat[ty*(W+1)+tx+1]+sat[(ty+1)*(W+1)+tx]-sat[ty*(W+1)+tx]}
  if(!any)return null;const m=mk(W*MK,H*MK),o=m.getContext('2d');o.filter=`blur(${MK*.9}px)`;o.drawImage(r,0,0);o.filter='none';return {m,sat}}
const tilesIn=(s,x0,y0,x1,y1)=>{x0=Math.max(0,Math.min(W,x0|0));y0=Math.max(0,Math.min(H,y0|0));x1=Math.max(0,Math.min(W,Math.ceil(x1)));y1=Math.max(0,Math.min(H,Math.ceil(y1)));const r=W+1;return s[y1*r+x1]-s[y0*r+x1]-s[y1*r+x0]+s[y0*r+x0]};
let M=null;
function masks(){const bio=(x,y)=>biomeOfZone(zone[I(x,y)]);
  M={river:maskOf((x,y)=>tiles[I(x,y)]===RIVER?1:0),
    fen:maskOf((x,y)=>{const t=tiles[I(x,y)];return t===SWAMP?1:t===MUD||t===SGRASS?.65:bio(x,y)==='fen'?.3:0}),
    ash:maskOf((x,y)=>tiles[I(x,y)]===LAVA?1:bio(x,y)==='ash'?.55:0)}}
// Fog by zone, remade when the zones in fog change: a pixel a tile, smoothed by the scale.
let fogKey='',fog=null;
function fogMask(){let k='';for(let z=0;z<ZONES.length;z++)k+=weatherKind(z)==='fog'?'1':'0';if(k===fogKey)return fog;fogKey=k;if(!k.includes('1'))return fog=null;
  fog=maskOf((x,y)=>weatherKind(zone[I(x,y)])==='fog'?1:0);return fog}
const ramp=(h,a,b,c,d)=>h<=a||h>=d?0:h<b?(h-a)/(b-a):h<=c?1:(d-h)/(d-c);
// Clear space around the view's centre, in the fog's own canvas.
let hole=null;function clearing(){if(hole)return hole;hole=mk(128,128);const x=hole.getContext('2d'),g=x.createRadialGradient(64,64,10,64,64,64);g.addColorStop(0,'rgba(0,0,0,.85)');g.addColorStop(.55,'rgba(0,0,0,.5)');g.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=g;x.fillRect(0,0,128,128);return hole}

const PAT=new Map();
function layer(w,h,k,ox,oy,mask,rgb,a,now,vx,vy,scale){if(!mask||a<.01||!tilesIn(mask.sat,-ox/k/T-3,-oy/k/T-3,(w-ox)/k/T+3,(h-oy)/k/T+3))return;
  let p=PAT.get(rgb);if(!p){p=yx.createPattern(cloud(rgb),'repeat');PAT.set(rgb,p)}const s=k*scale;
  yx.globalCompositeOperation='copy';yx.setTransform(s,0,0,s,ox+now*vx*k,oy+now*vy*k);yx.fillStyle=p;yx.fillRect(-ox/s-now*vx/scale-2,-oy/s-now*vy/scale-2,w/s+4,h/s+4);
  yx.globalCompositeOperation='source-over';yx.setTransform(1,0,0,1,0,0); // a second sheet, slower, so it billows rather than slides
  yx.globalAlpha=.6;yx.setTransform(s*1.7,0,0,s*1.7,ox-now*vx*k*.5,oy+now*vy*k*.3);yx.fillStyle=p;yx.fillRect((-ox+now*vx*k*.5)/(s*1.7)-2,(-oy-now*vy*k*.3)/(s*1.7)-2,w/(s*1.7)+4,h/(s*1.7)+4);yx.globalAlpha=1;
  yx.globalCompositeOperation='destination-in';yx.setTransform(k,0,0,k,ox,oy);yx.imageSmoothingEnabled=true;yx.drawImage(mask.m,0,0,W*MK,H*MK,0,0,W*T,H*T);
  yx.setTransform(1,0,0,1,0,0);yx.globalCompositeOperation='source-over';
  ax.globalAlpha=a;ax.drawImage(lay,0,0);ax.globalAlpha=1;drew++}

// Draw the air; sc the scale, far views fade it. ctx is left in the world transform.
export function drawAir(ctx,cv,cam,sc,now){if(!FX.full)return;const fade=Math.max(0,Math.min(1,(sc-1.1)/1.1));if(fade<=0)return;if(!M)masks();
  const h=G.hour,w=Math.ceil(cv.width/NR),hh=Math.ceil(cv.height/NR),dawn=ramp(h,3.5,5.5,7.4,9.5),eve=ramp(h,19.5,21.5,23,24.5),fg=fogMask();
  const river=Math.max(dawn*.62,eve*.22),fen=.08+dawn*.2+eve*.1,ash=.1+ramp(h,17,19,23,24)*.06;
  if(!M.river&&!M.fen&&!M.ash&&!fg)return;
  if(air.width!==w||air.height!==hh){air.width=lay.width=w;air.height=lay.height=hh}
  const k=sc/NR,ox=cam.offX/NR,oy=cam.offY/NR;
  // the air drifts slowly: a held camera repaints it every third frame, and the blit below carries on from the last one
  const moved=Math.abs(ox-lastX)+Math.abs(oy-lastY)>.25||sc!==lastS;
  if(moved||++tick>=3){tick=0;lastX=ox;lastY=oy;lastS=sc;any=paint(w,hh,k,ox,oy,now,river,fen,ash,fg)}
  if(!any)return;
  ctx.setTransform(1,0,0,1,0,0);ctx.imageSmoothingEnabled=true;ctx.globalAlpha=fade;ctx.drawImage(air,0,0,w,hh,0,0,w*NR,hh*NR);ctx.globalAlpha=1;ctx.imageSmoothingEnabled=false;ctx.setTransform(sc,0,0,sc,cam.offX,cam.offY)}
let tick=0,lastX=0,lastY=0,lastS=0,any=false,drew=0;
function paint(w,hh,k,ox,oy,now,river,fen,ash,fg){drew=0;
  ax.setTransform(1,0,0,1,0,0);ax.globalCompositeOperation='source-over';ax.clearRect(0,0,w,hh);
  layer(w,hh,k,ox,oy,M.river,'232,238,246',river,now,2.2,.25,.42);
  layer(w,hh,k,ox,oy,M.fen,'206,220,196',fen,now,1.4,.4,.6);
  layer(w,hh,k,ox,oy,M.ash,'158,136,124',ash,now,3,-.5,.7);
  layer(w,hh,k,ox,oy,fg,'226,230,240',.95,now,3.6,.5,.9);
  // what the camera looks at stays clear
  ax.globalCompositeOperation='destination-out';const rx=w*.42,ry=hh*.62;ax.drawImage(clearing(),w/2-rx,hh/2-ry,rx*2,ry*2);ax.globalCompositeOperation='source-over';return drew>0}
