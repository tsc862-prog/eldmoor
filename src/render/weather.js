// Weather overlay: tints each zone's tiles by its current weather and scatters
// a few hundred stateless particles (rain streaks, snow and ash flecks, squall
// streaks, fog banks) over that zone only. Zone spans are built once from the
// zone array; draw.js calls drawWeather after the night overlay and before the
// labels so the labels stay readable. Owned by world-builder.
import {W,H} from '../world/tiles.js';
import {U as T} from './tile.js';
import {zone,I,ZONES} from '../world/map.js';
import {weatherKind} from '../sim/weather.js';

// Per zone: a bounding box for particles.
const BOX=ZONES.map(()=>({x0:W,y0:H,x1:0,y1:0}));
for(let y=0;y<H;y++){let x=0;while(x<W){const z=zone[I(x,y)];let x1=x;while(x1<W&&zone[I(x1,y)]===z)x1++;
  const b=BOX[z];b.x0=Math.min(b.x0,x);b.x1=Math.max(b.x1,x1);b.y0=Math.min(b.y0,y);b.y1=Math.max(b.y1,y+1);x=x1}}

// The look of each weather kind: zone tint, then n particles with velocity in tiles/s,
// size in px, colour (col2 alternates on odd particles), optional sideways wobble and a
// 'big' stride that makes every n-th fleck 2x2.
const LOOK={
  drizzle: {tint:'rgba(70,85,110,.1)',   n:40,vx:-.3,vy:4,  w:1, h:2, col:'rgba(170,190,230,.45)'},
  rain:    {tint:'rgba(70,85,110,.15)',  n:70,vx:-.6,vy:7,  w:1, h:3, col:'rgba(170,190,230,.7)'},
  fog:     {tint:'rgba(200,205,215,.35)',n:24,vx:.5, vy:0,  w:40,h:12,col:'rgba(225,230,240,.14)',wob:.3},
  ashfall: {tint:'rgba(60,50,45,.12)',   n:50,vx:.3, vy:.9, w:1, h:1, col:'rgba(40,32,30,.75)',wob:.4,big:4},
  ashstorm:{tint:'rgba(150,100,70,.3)',  n:90,vx:9,  vy:.6, w:2, h:1, col:'rgba(235,160,95,.75)',col2:'rgba(50,38,32,.8)'},
  snow:    {tint:'rgba(230,235,245,.12)',n:60,vx:.4, vy:1.2,w:1, h:1, col:'rgba(245,248,255,.85)',wob:.6,big:3},
  squall:  {tint:'rgba(240,244,250,.3)', n:90,vx:10, vy:.8, w:2, h:1, col:'rgba(245,248,255,.8)'},
};
// Fixed per-particle seeds (start offset x, y and a speed spread), so particles need no state.
const frac=v=>v-Math.floor(v),SEED=[];
for(let i=0;i<100;i++)SEED.push([frac(Math.sin(i*12.9898+1)*43758.5453),frac(Math.sin(i*78.233+2)*43758.5453),frac(Math.sin(i*37.719+3)*43758.5453)]);
const mod=(v,m)=>((v%m)+m)%m;

// The zone tints are one low-resolution map (a texel a tile), blurred a few tiles and drawn smoothed, so a front of weather
// fades out over its edge instead of cutting a hard, stair-stepped line along the zone boundary (a straight full-height
// seam at night, pale blocks where two regions met by day). Rebuilt only when some zone's weather changes. Render only.
const TR=3; // blur radius in tiles
let tintCv=null,tintSig='',tintBuf=null,tintTmp=null;
const parseRgba=c=>{const m=c.match(/[0-9.]+/g).map(Number);return[m[0],m[1],m[2],m[3]]};
for(const k of Object.keys(LOOK))LOOK[k].rgba=parseRgba(LOOK[k].tint);
function blur(src,dst,w,h,horiz){const n=horiz?w:h,m=horiz?h:w,sx=horiz?4:4*w,ox=horiz?4*w:4;
  for(let l=0;l<m;l++){const base=l*ox;for(let c=0;c<4;c++){let acc=0;
    for(let i=-TR;i<=TR;i++)acc+=src[base+Math.min(n-1,Math.max(0,i))*sx+c];
    for(let i=0;i<n;i++){dst[base+i*sx+c]=acc/(2*TR+1);acc+=src[base+Math.min(n-1,i+TR+1)*sx+c]-src[base+Math.max(0,i-TR)*sx+c]}}}}
function drawTint(ctx){
  let sig='';for(let z=0;z<ZONES.length;z++){const L=LOOK[weatherKind(z)];sig+=L?weatherKind(z)+',':'-,'}
  if(!/[a-z]/.test(sig))return;
  if(sig!==tintSig){tintSig=sig;
    if(!tintCv){tintCv=document.createElement('canvas');tintCv.width=W;tintCv.height=H;tintBuf=new Float32Array(W*H*4);tintTmp=new Float32Array(W*H*4)}
    const kz=ZONES.map((_,z)=>LOOK[weatherKind(z)]);
    for(let i=0;i<W*H;i++){const L=kz[zone[i]],o=i*4;
      if(L){const c=L.rgba;tintBuf[o]=c[3];tintBuf[o+1]=c[0]*c[3];tintBuf[o+2]=c[1]*c[3];tintBuf[o+3]=c[2]*c[3]}else tintBuf[o]=tintBuf[o+1]=tintBuf[o+2]=tintBuf[o+3]=0}
    blur(tintBuf,tintTmp,W,H,true);blur(tintTmp,tintBuf,W,H,false);
    const x=tintCv.getContext('2d'),img=x.createImageData(W,H),d=img.data;
    for(let i=0;i<W*H;i++){const o=i*4,a=tintBuf[o];if(a<.002)continue;
      d[o]=Math.round(tintBuf[o+1]/a);d[o+1]=Math.round(tintBuf[o+2]/a);d[o+2]=Math.round(tintBuf[o+3]/a);d[o+3]=Math.min(255,Math.round(a*255))}
    x.putImageData(img,0,0)}
  const sm=ctx.imageSmoothingEnabled;ctx.imageSmoothingEnabled=true;ctx.drawImage(tintCv,0,0,W,H,0,0,W*T,H*T);ctx.imageSmoothingEnabled=sm}

// cam is part of the agreed renderer call signature; the overlay is cheap enough to draw whole.
export function drawWeather(ctx,S,cam,blink){
  drawTint(ctx);
  for(let z=0;z<ZONES.length;z++){const L=LOOK[weatherKind(z)];if(!L)continue;
    const b=BOX[z],bw=b.x1-b.x0,bh=b.y1-b.y0;
    for(let i=0;i<L.n;i++){const s=SEED[i],sp=.7+s[2]*.6;
      let px=b.x0+mod(s[0]*bw+L.vx*sp*blink,bw);const py=b.y0+mod(s[1]*bh+L.vy*sp*blink,bh);
      if(L.wob)px+=Math.sin(blink*1.5+i)*L.wob;
      const tx=Math.floor(px),ty=Math.floor(py);if(tx<0||tx>=W||ty<0||ty>=H||zone[I(tx,ty)]!==z)continue;
      const big=L.big&&i%L.big===0;ctx.fillStyle=L.col2&&(i&1)?L.col2:L.col;
      ctx.fillRect(Math.round(px*T),Math.round(py*T),big?2:L.w,big?2:L.h)}}}
