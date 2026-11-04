// Texture-preserving post-processing (#177 fix after the first real run): the first five real tiles came out flat
// (1-2 colours) because the whole 1024 px model image was area-voted down to 16 px. Here the model's own pixel grid
// is found (pixel-art-xl draws ~8 px blocks at 1024), each cell's centre is sampled to get the image at its native
// pixel scale (~128 px), and a tile is a seamless window of that, 1 model pixel = 1 game pixel.
//   1. detectGrid + sampleCells: the native-scale image;
//   2. tiles: seamlessCrop, the window of the asset's size whose wrap-around best matches its continuation;
//      sprites and the rest: clear the background, scale the subject down to the asset's size, centre it;
//   3. toneMatch to the palette (mean and spread per channel), quantise to the palette widened with shades when
//      short (expandPalette), optional ordered dither (post.dither, in RGB steps, e.g. 12);
//   4. optional 1px outline; 5. refuse an output with fewer than post.minColors colours (4 for tiles) as flat.
// Pure functions over {w, h, data: Uint8Array RGBA}; no I/O, no randomness.
import {hexToRgb,rgbToHex,quantiser,clearBackground,downscale,outline} from './post.mjs';
import {postFlat} from './post-flat.mjs';
import {postSheet} from './post-sheet.mjs';
import {postInit} from './post-init.mjs';

const luma=(d,o)=>d[o]*.299+d[o+1]*.587+d[o+2]*.114;
// Edge energy per column (axis 'x') or row ('y'): how much the image changes across that line.
function edges(img,axis){const {w,h,data}=img,n=axis==='x'?w:h,m=axis==='x'?h:w,e=new Float64Array(n);
  for(let i=1;i<n;i++){let s=0;for(let j=0;j<m;j+=2){const a=axis==='x'?(j*w+i)*4:(i*w+j)*4,b=axis==='x'?(j*w+i-1)*4:((i-1)*w+j)*4;s+=Math.abs(luma(data,a)-luma(data,b))}e[i]=s}
  return e}
// Block size and offset of the model's pixel grid along one axis: the period (3..32 px, quarter steps) whose lines
// carry the most edge energy relative to the average. Multiples of the true period score as high, so the smallest
// period within 85% of the best wins. null when nothing looks like a grid.
export function gridAxis(e,fund=true){const n=e.length;let mean=0;for(let i=1;i<n;i++)mean+=e[i];mean/=Math.max(1,n-1);if(mean<=0)return null;
  const res=[];for(let s=3;s<=32;s+=.25){let best=0,bo=0;for(let o=0;o<Math.ceil(s);o++){let t=0,c=0;for(let x=o;x<n;x+=s){const i=Math.round(x);if(i>=1&&i<n){t+=e[i];c++}}const sc=c?t/c/mean:0;if(sc>best){best=sc;bo=o}}res.push({s,o:bo,score:best})}
  const top=Math.max(...res.map(r=>r.score));if(top<1.6)return null;
  const pick=res.find(r=>r.score>=top*.85);return fund?fundamental(e,mean,pick,top):pick}
// Score and best offset of one integer period d (the same measure as above).
function gridAt(e,mean,d){const n=e.length;let best=0,bo=0;
  for(let o=0;o<d;o++){let t=0,c=0;for(let x=o;x<n;x+=d){if(x>=1){t+=e[x];c++}}const sc=c?t/c/mean:0;if(sc>best){best=sc;bo=o}}
  return {s:d,o:bo,score:best}}
// A structured image (bricks, cracks, long lines) has its edges on every 2nd or 3rd pixel line, so a multiple of the true
// period scores as high as the period and the 85% rule can land on 16, 24 or 32 for a model that drew 8 px blocks (the
// striped ice, mud, snow and swamp tiles of 2026-11-03). A period that divides the pick (within half a pixel over the
// image, so 23.75 counts as 3 x 8) is the real one when the lines it adds carry real energy, not chance: its score above 1
// (1 is chance) must be at least 60% of the best score's above 1. Chance lines of a wrong period sit at 0.0 to 0.4 of it.
export function fundamental(e,mean,pick,top){
  for(let d=3;d<pick.s;d++){const r=Math.round(pick.s/d);if(r<2||Math.abs(pick.s-r*d)>.5)continue;
    const g=gridAt(e,mean,d);if(g.score-1>=.6*(top-1))return g}
  return pick}
// Block size and offset per axis; an axis with no grid of its own takes the other's size (the model draws square pixels)
// at its own best offset.
export function detectGrid(img,hint=8,fund=true){const ex=edges(img,'x'),ey=edges(img,'y');let gx=gridAxis(ex,fund),gy=gridAxis(ey,fund);
  const mean=e=>{let m=0;for(let i=1;i<e.length;i++)m+=e[i];return m/Math.max(1,e.length-1)};
  if(gx&&!gy&&mean(ey)>0&&Number.isInteger(gx.s))gy=gridAt(ey,mean(ey),gx.s);
  else if(gy&&!gx&&mean(ex)>0&&Number.isInteger(gy.s))gx=gridAt(ex,mean(ex),gy.s);
  const fb={s:hint,o:0,score:0};
  return {x:gx||fb,y:gy||fb,found:!!(gx&&gy)}}
// One output pixel per grid cell: the mean of the cell's middle half (block edges are often blurred).
export function sampleCells(img,g){const {w,h,data}=img,cols=Math.floor((w-g.x.o)/g.x.s),rows=Math.floor((h-g.y.o)/g.y.s),out=new Uint8Array(cols*rows*4);
  for(let Y=0;Y<rows;Y++)for(let X=0;X<cols;X++){const x0=g.x.o+X*g.x.s,y0=g.y.o+Y*g.y.s;
    const ax=Math.floor(x0+g.x.s*.25),bx=Math.max(ax+1,Math.ceil(x0+g.x.s*.75)),ay=Math.floor(y0+g.y.s*.25),by=Math.max(ay+1,Math.ceil(y0+g.y.s*.75));
    let r=0,gg=0,b=0,a=0,n=0;for(let y=ay;y<by&&y<h;y++)for(let x=ax;x<bx&&x<w;x++){const o=(y*w+x)*4;r+=data[o];gg+=data[o+1];b+=data[o+2];a+=data[o+3];n++}
    const O=(Y*cols+X)*4;if(n){out[O]=r/n;out[O+1]=gg/n;out[O+2]=b/n;out[O+3]=a/n>=128?255:0}}
  return {w:cols,h:rows,data:out}}
export function nearestScale(img,k){const {w,h,data}=img,W=w*k,H=h*k,out=new Uint8Array(W*H*4);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const s=(((y/k)|0)*w+((x/k)|0))*4,o=(y*W+x)*4;out[o]=data[s];out[o+1]=data[s+1];out[o+2]=data[s+2];out[o+3]=data[s+3]}
  return {w:W,h:H,data:out}}
// The W x H window in the middle half of the image whose right/bottom continuation best matches its own left/top
// edge, so the tile repeats with the least visible seam.
export function seamlessCrop(img,W,H){let im=img;if(im.w<W+1||im.h<H+1)im=nearestScale(im,Math.ceil(Math.max((W+1)/im.w,(H+1)/im.h)));
  const {w,h,data}=im,px=(x,y)=>(y*w+x)*4,d=(a,b)=>Math.abs(data[a]-data[b])+Math.abs(data[a+1]-data[b+1])+Math.abs(data[a+2]-data[b+2]);
  const x0a=Math.floor((w-W-1)/4),x0b=Math.ceil((w-W-1)*3/4),y0a=Math.floor((h-H-1)/4),y0b=Math.ceil((h-H-1)*3/4);
  let best=Infinity,bx=x0a,by=y0a;
  for(let y0=y0a;y0<=y0b;y0++)for(let x0=x0a;x0<=x0b;x0++){let c=0;for(let y=0;y<H;y++)c+=d(px(x0+W,y0+y),px(x0,y0+y));for(let x=0;x<W;x++)c+=d(px(x0+x,y0+H),px(x0+x,y0));if(c<best){best=c;bx=x0;by=y0}}
  const out=new Uint8Array(W*H*4);for(let y=0;y<H;y++)for(let x=0;x<W;x++){const s=px(bx+x,by+y),o=(y*W+x)*4;for(let k=0;k<4;k++)out[o+k]=data[s+k]}
  return {w:W,h:H,data:out,at:[bx,by],seam:best/(2*(W+H))}}
// Move the image's colour mean and spread per channel onto the palette's, so a model that drew a slightly different
// green still spreads over the palette's shades instead of all landing on one. The stretch is capped at 4x.
export function toneMatch(img,colors){const P=colors.map(hexToRgb),{w,h,data}=img,out=new Uint8Array(data);
  for(let c=0;c<3;c++){let pm=0;for(const p of P)pm+=p[c];pm/=P.length;let pv=0;for(const p of P)pv+=(p[c]-pm)**2;const ps=Math.sqrt(pv/P.length);
    let im=0,n=0;for(let i=0;i<w*h;i++)if(data[i*4+3]>=128){im+=data[i*4+c];n++}if(!n)continue;im/=n;
    let iv=0;for(let i=0;i<w*h;i++)if(data[i*4+3]>=128)iv+=(data[i*4+c]-im)**2;const is=Math.sqrt(iv/n),k=Math.min(4,ps/Math.max(is,1));
    for(let i=0;i<w*h;i++){const o=i*4+c;out[o]=Math.max(0,Math.min(255,Math.round((data[o]-im)*k+pm)))}}
  return {w,h,data:out}}
// Widen a short palette with lighter and darker shades of its own colours (a ramp needs 6+ steps to show texture).
// Shade factors in order (the tier's, src/render/palette.js TIER_SHADES, so a recoloured key colour's shades match).
export function expandPalette(colors,min=6,factors=[.85,1.15,.7,1.3]){const out=[...colors];
  for(const f of factors)for(const c of colors){if(out.length>=min)break;out.push(rgbToHex(hexToRgb(c).map(v=>Math.max(0,Math.min(255,Math.round(v*f))))))}
  return [...new Set(out)]}
const BAYER=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5].map(v=>v/16-.5);
export function quantise(img,colors,{dither=0}={}){const q=quantiser(colors),P=colors.map(hexToRgb),{w,h,data}=img,out=new Uint8Array(w*h*4),cl=v=>Math.max(0,Math.min(255,Math.round(v)));
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const o=(y*w+x)*4;if(data[o+3]<128)continue;const t=dither*BAYER[(y&3)*4+(x&3)],i=q(cl(data[o]+t),cl(data[o+1]+t),cl(data[o+2]+t));
    out[o]=P[i][0];out[o+1]=P[i][1];out[o+2]=P[i][2];out[o+3]=255}
  return {w,h,data:out}}
export function colorCount(img){const s=new Set();for(let i=0;i<img.w*img.h;i++){const o=i*4;if(img.data[o+3]>=128)s.add((img.data[o]<<16)|(img.data[o+1]<<8)|img.data[o+2])}return s.size}

// A transition piece of the renderer's dual grid (src/render/terrain.js autotileAt/QUAD): an edge is ground A on top and
// ground B below, a corner is B in the bottom-right quarter and A elsewhere, an inner corner is A in the top-left quarter
// and B elsewhere. So the check samples quarter-size boxes: an edge's A is the top band and B the bottom band; a corner's B is the bottom-right box and
// A the other three; an inner corner's A is the top-left box and B the other three. The two must be clearly different colours and each box must be mostly its own
// one (nearest of the two means), or the image is not that piece: the scenes, walls and random blotches the model drew
// for "transition tile" on 2026-11-03 (a wrong subject cannot be repaired by processing). Returns {dist, sep, pa, pb, ok}.
export function pieceStats(img,piece='edge'){const {w,h,data}=img,bw=Math.max(2,w>>2),bh=Math.max(2,h>>2),TL=[0,0,bw,bh],TR=[w-bw,0,w,bh],BL=[0,h-bh,bw,h],BR=[w-bw,h-bh,w,h];
  const A=piece==='edge'?[[0,0,w,bh]]:piece==='corner'?[TL,TR,BL]:[TL],B=piece==='edge'?[[0,h-bh,w,h]]:piece==='corner'?[BR]:[TR,BL,BR];
  const each=(rs,f)=>{for(const r of rs)for(let y=r[1];y<r[3];y++)for(let x=r[0];x<r[2];x++){const q=(y*w+x)*4;if(data[q+3]>=128)f([data[q],data[q+1],data[q+2]])}};
  const mean=rs=>{const s=[0,0,0];let n=0;each(rs,p=>{s[0]+=p[0];s[1]+=p[1];s[2]+=p[2];n++});return n?s.map(v=>v/n):null};
  const ma=mean(A),mb=mean(B);if(!ma||!mb)return {dist:0,sep:0,pa:0,pb:0,ok:false};
  const d=(p,q)=>Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2]);
  const pur=(rs,m,o)=>{let g=0,n=0;each(rs,p=>{n++;if(d(p,m)<=d(p,o))g++});return n?g/n:0};
  const mad=(rs,m)=>{let t=0,n=0;each(rs,p=>{t+=d(p,m);n++});return n?t/n:0};
  const pmin=Math.min(...A.map(r=>pur([r],ma,mb)),...B.map(r=>pur([r],mb,ma))); // every box on its own: one box of the wrong ground fails
  const dist=d(ma,mb),pa=pur(A,ma,mb),pb=pur(B,mb,ma),sep=dist/Math.max(1,(mad(A,ma)+mad(B,mb))/2);
  return {dist:Math.round(dist),sep:Math.round(sep*10)/10,pa:Math.round(pa*100)/100,pb:Math.round(pb*100)/100,ok:dist>=SHAPE.DIST&&sep>=SHAPE.SEP&&pa>=SHAPE.PURE&&pb>=SHAPE.PURE&&pmin>=SHAPE.BOX}}
export const SHAPE={DIST:25,SEP:1.5,PURE:.4,BOX:.3}; // the mean-colour gap, that gap over the boxes' own spread, and the share of each box nearer its own mean (the 2026-11-03 failures: sep 0.1-0.7; drawn fixtures: 3-38)
export const pieceOf=id=>/-corner$/.test(id||'')?'corner':/-inner$/.test(id||'')?'inner':'edge';
// kind 'flat' on purpose: a rejected image is handled the same way downstream (raw kept, redrawn on a later run, art:reprocess).
export class ShapeError extends Error{constructor(piece,st,notes){super(`not ${piece==='edge'?'an':'a'} ${piece} piece: its two grounds are not clearly apart (colour gap ${st.dist}, gap over spread ${st.sep}, purity ${st.pa} and ${st.pb})`);this.kind='flat';this.shape=true;this.notes=notes}}
export class FlatError extends Error{constructor(n,min,notes){super(`flat: ${n} colour${n===1?'':'s'} (needs ${min}+)`);this.kind='flat';this.colors=n;this.notes=notes}}

// The whole chain for one manifest entry. pal = resolved colour list; outlineColor from palette MARK.outline.
// Returns {w, h, data, notes} (notes: grid found, native size, crop, seam, colours) or throws FlatError.
// opts: hint (the model's pixel grid at this tier), tier (picks entry.sizes[tier]; an entry with a plain size [w,h] is
// taken as is), minPalette and factors (the tier's palette widening; post.minPalette wins), key (sprite sheets: the
// colours recoloured per faction, which a hero sheet must show; post-sheet.mjs).
// An entry with frames {cols, rows} is a sprite sheet: its figures are found in the model image and laid on the frame
// grid (post-sheet.mjs). opts.init: the image was made from this init (scripts/art/init.mjs): its cells are read back through
// the same layout and the silhouette is the procedural art's (post-init.mjs), then the recipe's own gates apply.
export function postProcess(img,entry,pal,outlineColor,{hint=8,tier=32,minPalette=6,factors,key=null,init=null}={}){
  if(init)return postInit(img,entry,pal,outlineColor,{tier,minPalette,factors,key,init});
  const p=entry.post||{};if(p.flat)return postFlat(img,entry,pal,{hint,tier}); // buildings and standing landmarks (#763): post-flat.mjs
  const [W,H]=(entry.sizes&&entry.sizes[tier])||entry.size,tile=entry.kind==='tile'||entry.kind==='autotile';
  // a sprite sheet: the figures from the full image (a sheet is mostly plain ground, where no pixel grid shows)
  if(entry.frames)return postSheet(img,entry,pal,outlineColor,{tier,minPalette,factors,key},{grid:'figures',native:`${img.w}x${img.h}`});
  const g=detectGrid(img,p.grid||hint,p.fundamental!==false);let native=sampleCells(img,g),im;
  const notes={grid:g.found?`${g.x.s}x${g.y.s}`:`none (used ${g.x.s})`,native:`${native.w}x${native.h}`};
  if(tile&&(p.fit||'crop')==='crop'){const c=seamlessCrop(native,W,H);im=c;notes.crop=c.at;notes.seam=Math.round(c.seam)}
  else{if(p.transparent)native=clearBackground(native,p.bgTolerance??40);
    im=native.w>W||native.h>H?downscale(native,W,H,pal,p.downscale||'mode'):nearestScale(native,Math.max(1,Math.floor(Math.min(W/native.w,H/native.h))));
    if(im.w!==W||im.h!==H){const pad={w:W,h:H,data:new Uint8Array(W*H*4)},ox=Math.floor((W-im.w)/2),oy=Math.floor((H-im.h)/2);
      for(let y=0;y<im.h&&y+oy<H;y++)for(let x=0;x<im.w&&x+ox<W;x++){const s=(y*im.w+x)*4,o=((y+oy)*W+x+ox)*4;for(let k=0;k<4;k++)pad.data[o+k]=im.data[s+k]}im=pad}}
  const colors=expandPalette(pal,p.minPalette??minPalette,factors);
  if(p.tone!==false)im=toneMatch(im,colors);
  im=quantise(im,colors,{dither:p.dither??0});
  if(entry.kind==='autotile'&&p.shape!==false){const pc=pieceOf(entry.id),st=pieceStats(im,pc);notes.piece=`${pc} ${st.dist}/${st.pa}/${st.pb}`;if(!st.ok)throw new ShapeError(pc,st,notes)}
  if(p.outline)im=outline(im,p.outlineColor||outlineColor);
  notes.colors=colorCount(im);const min=p.minColors??(tile?4:2);
  if(notes.colors<min)throw new FlatError(notes.colors,min,notes);
  return {w:im.w,h:im.h,data:im.data,notes}}
