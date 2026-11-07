// Shadows that move with the sun (#979). Two kinds:
//   cast     what stands still (trees, buildings, town walls, mountains) throws one world-sized shadow canvas at SK pixels a tile, multiplied in by the light map, so it falls on people too. Each kind of
//            caster is a mask with a height band; the shadow is that mask swept along the sun by doubling (drawn over itself at 1, 2, 4...
//            steps), so a whole map costs a few dozen small blits, and only when the sun has moved. A frame costs one scaled blit.
//   figures  what moves throws its own silhouette on the ground, sheared along the sun: long and thin at dusk, a short smudge at noon.
// The sweep leaves out the art of the casters themselves: cast shadows lie on the ground, and crowns and roofs are painted into the terrain
// chunks. Depth inside a wood comes from the light map's canopy shade (lightmap.js), which falls on crowns and people alike.
// From the world's tiles, CITY, and the trees as terrain.js stands them: no zone, no town, no asset needed (with no canopy art every TREE tile casts).
import {W,H,TREE,WALL,PEAK} from '../world/tiles.js';
import {tiles,I,CITY} from '../world/map.js';
import {U as T} from './tile.js';
import {treeAnchor,chunkGen} from './terrain.js';
import {buildingArt,gateArt} from './townart.js';
import {G} from './grade.js';
import {peakArt,peakFaces,peakDirty,FACE} from './peaks.js';
import {onWorld} from '../sim/kept.js';

const SK=FACE; // shadow pixels a tile
const mk=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c};
let CW=W*SK,CHT=H*SK;
let bands=null,cover=null,work=null,out=null,gen=-1,key=-1,castAt=0,peakStale=false,peakBox=null;
const TALL=5; // tiles of art from which a building counts as tall
const FACE_A=.95; // how far a mountain face turned from the sun takes the shade
// Caster masks, built once per set of terrain art.
function build(){if(!bands){bands={trunk:mk(CW,CHT),crown:mk(CW,CHT),wall:mk(CW,CHT),house:mk(CW,CHT),great:mk(CW,CHT),peak:mk(CW,CHT),tall:mk(CW,CHT),east:mk(CW,CHT),west:mk(CW,CHT)};cover=mk(CW,CHT);work=mk(CW,CHT);out=mk(CW,CHT)}
  const x=n=>bands[n].getContext('2d'),tr=x('trunk'),cr=x('crown'),wl=x('wall'),ho=x('house'),gr=x('great'),pk=x('peak'),cv=cover.getContext('2d');
  for(const c of [tr,cr,wl,ho,gr,pk,cv]){c.clearRect(0,0,CW,CHT);c.fillStyle='#000'}
  let canopy=false;const art=peakArt();
  for(let ty=0;ty<H;ty++)for(let tx=0;tx<W;tx++){const t=tiles[I(tx,ty)];
    if(t===WALL){wl.fillRect(tx*SK,ty*SK,SK,SK);cv.fillRect(tx*SK,ty*SK,SK,SK)}
    else if(t===PEAK&&!art){pk.fillRect(tx*SK,ty*SK,SK,SK);cv.fillRect(tx*SK,ty*SK,SK,SK)} // with the art on, the mountains' own outline comes as they are painted (peakMasks)
    else if(t===TREE){const a=treeAnchor(tx,ty);
      if(a){canopy=true;const px=a.x*SK,py=a.y*SK;tr.fillRect(px-SK*.14,py-SK*.1,SK*.28,SK*.2);
        cr.beginPath();cr.ellipse(px,py,SK*1.15,SK*.8,0,0,7);cr.fill();
        cv.drawImage(a.im,a.ax/T*SK,a.ay/T*SK,a.w/T*SK,a.h/T*SK)}}}
  if(!canopy)for(let ty=0;ty<H;ty++)for(let tx=0;tx<W;tx++)if(tiles[I(tx,ty)]===TREE){const px=(tx+.5)*SK,py=(ty+.9)*SK; // the one-tile procedural tree
    tr.fillRect(px-SK*.1,py-SK*.1,SK*.2,SK*.2);cr.beginPath();cr.ellipse(px,py,SK*.5,SK*.36,0,0,7);cr.fill();cv.fillRect(tx*SK,ty*SK,SK,SK)}
  for(const c of CITY)for(const b of c.buildings||[]){if(b.piece==='board')continue;const [bx,by,bw,bh]=b.box,art=buildingArt(c,b);
    const m=art&&art.box[3]>=TALL?gr:ho; // what stands tall goes on throwing shadow past the houses' height
    if(art){for(const q of m===gr?[ho,gr]:[ho]){q.save();q.beginPath();q.rect(bx*SK,by*SK,bw*SK,bh*SK);q.clip();q.drawImage(art.img,art.box[0]*SK,art.box[1]*SK,art.box[2]*SK,art.box[3]*SK);q.restore()}}else ho.fillRect(bx*SK,by*SK,bw*SK,bh*SK); // the art's own outline: a spire or a well has clear corners in its box
    if(art)cv.drawImage(art.img,art.box[0]*SK,art.box[1]*SK,art.box[2]*SK,art.box[3]*SK);else{const q=b.draw||b.box;cv.fillRect(q[0]*SK,q[1]*SK,q[2]*SK,q[3]*SK)}}
  for(const c of CITY){const g=gateArt(c);if(!g)continue;const [x,y,w,h]=g.box,f=g.along?[x,y,w,h]:[x,g.foot-1,w,1]; // a gatehouse: its towers and span, standing as tall as the great halls
    gr.fillRect(f[0]*SK,f[1]*SK,f[2]*SK,f[3]*SK);ho.fillRect(f[0]*SK,f[1]*SK,f[2]*SK,f[3]*SK);if(!g.along)cv.fillRect(x*SK,(g.foot-2)*SK,w*SK,2*SK);else cv.fillRect(x*SK,y*SK,w*SK,h*SK)}
  gen=chunkGen;key=-1;if(art)peakMasks([0,0,CW,CHT])}
// What of the mountains has been painted, into the masks: their outline casts and covers, the tall of them casts farther, and their faces take the sun.
function peakMasks(b){const f=peakFaces(),w=b[2]-b[0],h=b[3]-b[1],im=new ImageData(w,h),d=im.data;
  const up=(src,c)=>{for(let y=0,o=3;y<h;y++){let i=(b[1]+y)*CW+b[0];for(let x=0;x<w;x++,o+=4)d[o]=src[i++]}c.getContext('2d').putImageData(im,b[0],b[1])};
  up(f.mask,bands.peak);up(f.tall,bands.tall);up(f.east,bands.east);up(f.west,bands.west);
  cover.getContext('2d').drawImage(bands.peak,b[0],b[1],w,h,b[0],b[1],w,h)}
// One band swept along the sun from height h0 to h1 (tiles), added to the shadow.
function sweep(o,m,h0,h1,dx,dy){const wx=work.getContext('2d');wx.globalCompositeOperation='copy';wx.drawImage(m,dx*h0,dy*h0);wx.globalCompositeOperation='source-over';
  const span=h1-h0,step=1.6/Math.max(.2,Math.hypot(dx,dy));let c=step;while(c<span){const d=Math.min(c,span-c);wx.drawImage(work,dx*d,dy*d);c+=d}
  o.drawImage(work,0,0)}
function cast(){const o=out.getContext('2d'),L=G.len*SK,dx=G.sx*L,dy=G.sy*L;
  o.globalCompositeOperation='source-over';o.clearRect(0,0,CW,CHT);
  sweep(o,bands.trunk,0,1.1,dx,dy);sweep(o,bands.crown,.95,2.3,dx,dy);sweep(o,bands.wall,0,.9,dx,dy);sweep(o,bands.house,0,1.7,dx,dy);sweep(o,bands.great,1.6,3.2,dx,dy);sweep(o,bands.peak,0,1.3,dx,dy);sweep(o,bands.tall,1.2,2.8,dx,dy);
  // a soft edge, then off the art of what casts
  const wx=work.getContext('2d');wx.globalCompositeOperation='copy';wx.filter='blur(1.2px)';wx.drawImage(out,0,0);wx.filter='none';wx.globalCompositeOperation='source-over';
  o.globalCompositeOperation='copy';o.drawImage(work,0,0);
  o.globalCompositeOperation='destination-out';o.drawImage(cover,0,0);
  o.globalCompositeOperation='source-over';o.globalAlpha=FACE_A*Math.abs(G.sx);o.imageSmoothingEnabled=true;o.drawImage(G.sx>0?bands.east:bands.west,0,0);o.globalAlpha=1; // the mountain faces turned from the sun: east ones at dusk, west at dawn
  o.globalCompositeOperation='source-in';o.fillStyle=`rgb(${G.shade[0]|0},${G.shade[1]|0},${G.shade[2]|0})`;o.fillRect(0,0,CW,CHT);o.globalCompositeOperation='source-over'}
// Keep the cast shadows up to date with the sun. They are laid down by the light map (castInto), not on the ground, so whoever stands in one is in its shade.
export function drawCast(gameMin){if(G.sunA<.01)return;if(!bands||gen!==chunkGen)build();
  // every three game minutes, and no oftener than four times a real second however fast the world runs
  const k=Math.floor(gameMin/3),t=performance.now(),pd=peakDirty();if(pd){if(peakStale){peakBox[0]=Math.min(peakBox[0],pd[0]);peakBox[1]=Math.min(peakBox[1],pd[1]);peakBox[2]=Math.max(peakBox[2],pd[2]);peakBox[3]=Math.max(peakBox[3],pd[3])}else{peakBox=pd;peakStale=true}}
  if((k!==key||peakStale)&&(key<0||t-castAt>250)){if(peakStale){peakMasks(peakBox);peakStale=false}key=k;castAt=t;cast()}
}
// Multiply the cast shadows into the light map; lx is mid-multiply, k and ox,oy its scale and offset. The art of what casts is cut out of them, so crowns and roofs stay lit, and a blit
// here is a sixteenth of the pixels of one on the world.
export function castInto(lx,k,ox,oy){if(G.sunA<.01||!out)return;lx.globalAlpha=G.sunA;lx.setTransform(k,0,0,k,ox,oy);lx.drawImage(out,0,0,CW,CHT,0,0,W*T,H*T);lx.setTransform(1,0,0,1,0,0);lx.globalAlpha=1}

// The art of what casts, at shadow scale, for others that lie on the ground (sheen.js).
export const castCover=()=>cover;

// ---- figures ----
const SIL=new WeakMap();
// The dark cut-out of a sprite canvas or sheet, once each. Taken from the image, so any art casts its own shape.
function silhouette(img){let s=SIL.get(img);if(s)return s;const w=img.naturalWidth||img.width,h=img.naturalHeight||img.height;s=mk(w,h);const c=s.getContext('2d');
  c.drawImage(img,0,0);c.globalCompositeOperation='source-in';c.fillStyle='#0a0c26';c.fillRect(0,0,w,h);SIL.set(img,s);return s}
// The shear of this frame's figure shadows: where the head's shadow lies, in figure heights from the feet.
const reach=()=>Math.min(G.len,2.2)*.62;
export const figureX=()=>G.sx*reach(),figureY=()=>Math.max(.16,G.sy*reach());
// One figure's shadow: the source rect of img, a dw x dh figure with its feet at (px,py), under the world transform tf. flip mirrors it.
export function castFigure(ctx,tf,img,sx,sy,sw,sh,px,py,dw,dh,flip){const s=silhouette(img),a=tf.a;
  // image rows run head (v=-dh) to feet (v=0); the transform sends v to the ground along the sun
  ctx.setTransform(flip?-a:a,0,-figureX()*a,-figureY()*a,tf.e+px*a,tf.f+py*a);ctx.drawImage(s,sx,sy,sw,sh,-dw/2,-dh,dw,dh)}
// A soft stretched blob along the sun, for what paints itself (critters, stalls, carts): a path segment, the caller fills. h its height in world units.
export function castBlob(ctx,px,py,w,h){const bx=figureX()*h,by=figureY()*h,L=Math.hypot(bx,by);ctx.moveTo(px+bx,py+by);ctx.ellipse(px+bx/2,py+by/2,Math.max(w,L/2),w*.7,Math.atan2(by,bx),0,7)}
// Another map (#1013): the masks are the size of the map, and hold its trees, walls and mountains.
onWorld(()=>{CW=W*SK;CHT=H*SK;bands=cover=work=out=peakBox=null;gen=key=-1;peakStale=false},()=>({castSize:[CW,CHT]}));
export const warmCast=()=>{if(!bands||gen!==chunkGen)build()};
