// More kinds of tree in a wood (chapter maps, #1013): the LPC cut gives each biome three whole trees (#834, prop:canopy-<biome>-1..3), and a
// wood of three shapes repeats. In a region a scenery note washes as woods, some trees are made from those images here, in the browser:
// a birch (the broad crown gone light and yellow-green, the trunk white with dark marks), a copper beech (the crown in autumn copper) and a
// dead tree (the trunk alone, grey, with bare branches drawn up from it). Nothing new is committed; with the canopy images absent there is
// nothing to derive and the wood is drawn as before. Picked by a hash of the tile (render/terrain.js), never the sim's dice.
import {hash} from '../core/rng.js';
import {onAssets} from './assets.js';

const cache=new Map();onAssets(()=>cache.clear());
function hsl(r,g,b){r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b),l=(mx+mn)/2,d=mx-mn;let h=0;
  if(d){h=mx===r?((g-b)/d)%6:mx===g?(b-r)/d+2:(r-g)/d+4;h*=60;if(h<0)h+=360}return [h,d?d/(1-Math.abs(2*l-1)):0,l]}
function rgb(h,s,l){const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;let r=0,g=0,b=0;
  if(h<60)[r,g,b]=[c,x,0];else if(h<120)[r,g,b]=[x,c,0];else if(h<180)[r,g,b]=[0,c,x];else if(h<240)[r,g,b]=[0,x,c];else if(h<300)[r,g,b]=[x,0,c];else[r,g,b]=[c,0,x];
  return [(r+m)*255,(g+m)*255,(b+m)*255].map(v=>Math.max(0,Math.min(255,Math.round(v))))}
const leaf=(h,s,l)=>h>=60&&h<=175&&s>.25; // the crown's greens (the outline is a dark blue-grey, the trunk brown)
const bark=(h,s,l)=>(h<=45||h>=340)&&s>.15&&l<.5; // the trunk's browns

// Kinds, as a share of a wood's whole trees (the rest stay the cut three): read by terrain.js.
export const WOOD_KINDS=[['birch',.16],['copper',.08],['dead',.08]];
export const woodKind=(tx,ty)=>{let r=hash(tx,ty,617);for(const [k,p] of WOOD_KINDS){if(r<p)return k;r-=p}return null};

// The tree of kind k made from canopy image im (an Image or canvas, 96x120 at the 32 tier), or null with no DOM.
export function deriveTree(k,id,im){const key=k+'|'+id;if(cache.has(key))return cache.get(key);if(typeof document==='undefined')return null;
  const w=im.naturalWidth||im.width,h=im.naturalHeight||im.height,c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(im,0,0);
  const D=x.getImageData(0,0,w,h),d=D.data;
  let top=h;for(let y=0;y<h&&top===h;y++)for(let i=0;i<w;i++){const o=(y*w+i)*4;if(d[o+3]===255){const [a,s,l]=hsl(d[o],d[o+1],d[o+2]);if(bark(a,s,l)){top=y;break}}} // where the trunk shows below the crown
  let tx0=w,tx1=0;{const y=Math.min(h-1,top+5);for(let i=0;i<w;i++){const o=(y*w+i)*4;if(d[o+3]===255){const [a,s,l]=hsl(d[o],d[o+1],d[o+2]);if(bark(a,s,l)){tx0=Math.min(tx0,i);tx1=Math.max(tx1,i)}}}}
  for(let y=0;y<h;y++)for(let i=0;i<w;i++){const o=(y*w+i)*4;if(!d[o+3])continue;const [a,s,l]=hsl(d[o],d[o+1],d[o+2]);let p=null;
    if(d[o+3]<255){if(k==='dead'){d[o+3]=Math.round(d[o+3]*.55)}continue} // the ground shadow: a bare tree throws less of one
    if(k==='birch'){if(leaf(a,s,l))p=rgb(a<100?78:96,Math.min(.62,s*.92),Math.min(.66,l*1.08+.05));
      else if(bark(a,s,l)&&y>=top){const mark=y%5===0&&hash(i>>2,y,623)<.55;p=mark?[46,40,38]:i<=tx0+2?[236,232,222]:i>=tx1-3?[164,158,150]:[212,206,196]}}
    else if(k==='copper'){if(leaf(a,s,l))p=rgb(a<100?32:18,Math.min(.68,s*.92),Math.min(.6,l*1.1+.05))}
    else if(k==='dead'){if(y<top||leaf(a,s,l)||(y<top+4&&(i<tx0-1||i>tx1+1))){d[o+3]=0;continue}if(bark(a,s,l))p=rgb(30,.12,l*.95+.04)}
    if(p){d[o]=p[0];d[o+1]=p[1];d[o+2]=p[2]}}
  x.putImageData(D,0,0);
  if(k==='dead'){ // bare branches up from the trunk's top, one art pixel thick with a lit side, forking as they climb
    const R=(a,b,ww,hh,col)=>{x.fillStyle=col;x.fillRect(Math.round(a),Math.round(b),ww,hh)},seed=id.length*31+7;
    // limbs: from (px,py) at angle ang (0 up, radians to the right), len art px, th thick, forking as they climb; outlines first, then the wood
    const seg=[];const grow=(px,py,ang,len,th,n)=>{let cx=px,cy=py;const pts=[];for(let s2=0;s2<len;s2++){ang=Math.max(-1,Math.min(1,ang+(hash(n,s2,seed)-.5)*.14));cx+=Math.sin(ang);cy-=Math.cos(ang);pts.push([cx,cy])}seg.push({pts,th});
      if(len>7){grow(cx,cy,ang-.32-hash(n,2,seed)*.2,Math.round(len*.66),Math.max(1,th-1),n*3+1);grow(cx,cy,ang+.32+hash(n,3,seed)*.2,Math.round(len*.6),Math.max(1,th-1),n*3+2)}
      else if(hash(n,4,seed)<.6)grow(cx,cy,ang+(hash(n,5,seed)<.5?-.5:.5),3,1,n*3+3)};
    const mid=(tx0+tx1)/2;grow(mid-3,top+3,-.35,22,3,1);grow(mid+3,top+3,.4,20,3,2);grow(mid,top+2,.04,30,3,3);
    for(const {pts,th} of seg)for(const [a,b] of pts)R(a-1,b-1,th+2,th+2,'#1a1414');
    for(const {pts,th} of seg)for(const [a,b] of pts){R(a,b,th,th,th>2?'#6e645a':'#5a5048');if(th>1)R(a,b,1,th,'#8a8070')}
    }
  cache.set(key,c);return c}
