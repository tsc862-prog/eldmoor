// Sprite sheet post-processing (#177 slice 4, #711): a model image of one character drawn cols x rows times (stand, step,
// other step by down, left, right, up) becomes a sheet the renderer cuts into equal frames (src/render/sprites.js
// sheetFrame). The model never puts its figures on the frame grid and never in the sheet's aspect, so the figures are
// found and laid out again:
//   1. clear the background of the model image as it came (flood fill from the border, post.bgTolerance);
//   2. find the figures: rows of figures are the runs of the opaque-pixel profile down the image, columns the runs across
//      each row; specks are dropped, a figure cut in two (a staff apart from its hand) is joined to its nearest neighbour;
//      a sheet that does not hold cols x rows figures of even size is refused (kind 'flat': rejected, its raw image kept);
//   3. one scale for every figure (the largest fits its frame with a pixel to spare for the outline), each figure
//      downscaled (mode vote over the palette) and set on the frame's floor, centred: feet on one line in every frame;
//   4. quantise to the palette (tone matching only with post.tone: a sheet's palette is several unrelated ramps), then
//      the 1px outline, which stays inside each frame;
//   5. the faction key: with opts.key (the colours the renderer recolours per faction, palette.js recolour), a hero
//      sheet must show its tabard in post.keyFrames frames (default half), or it is refused: it would not take the
//      faction colour.
// Pure functions over {w, h, data: Uint8Array RGBA}; no I/O, no randomness.
import {hexToRgb,clearBackground,downscale,outline} from './post.mjs';
import {nearestScale,toneMatch,quantise,colorCount,expandPalette} from './post-texture.mjs';

export class SheetError extends Error{constructor(msg,notes){super(msg);this.kind='flat';this.notes=notes}}

// Runs of a profile (opaque pixels per line): [{a, b, m}] with a <= i < b and m the pixel mass.
function runsOf(prof){const out=[];let s=-1,m=0;
  for(let i=0;i<=prof.length;i++){const v=i<prof.length?prof[i]:0;if(v>0){if(s<0){s=i;m=0}m+=v}else if(s>=0){out.push({a:s,b:i,m});s=-1}}
  return out}
// Exactly want runs: drop specks (under 6% of the heaviest), join the two closest neighbours while there are too many,
// refuse too few or a run far wider than the others (two figures that touch).
export function fitRuns(prof,want,what,notes){let r=runsOf(prof);const big=Math.max(0,...r.map(x=>x.m));r=r.filter(x=>x.m>=big*.06);
  while(r.length>want){let k=0,g=Infinity;for(let i=0;i+1<r.length;i++){const d=r[i+1].a-r[i].b;if(d<g){g=d;k=i}}
    r.splice(k,2,{a:r[k].a,b:r[k+1].b,m:r[k].m+r[k+1].m})}
  if(r.length<want)throw new SheetError(`layout: ${r.length} ${what} of figures (needs ${want})`,notes);
  const ws=r.map(x=>x.b-x.a).sort((a,b)=>a-b),med=ws[ws.length>>1];
  if(r.some(x=>x.b-x.a>med*1.8))throw new SheetError(`layout: uneven ${what} (${r.map(x=>x.b-x.a).join(', ')} px)`,notes);
  return r}

// The figures of a cleared image, row by row: [{x0, y0, x1, y1}] (x1, y1 exclusive), rows*cols of them.
export function findFigures(img,cols,rows,notes={}){const {w,h,data}=img,op=(x,y)=>data[(y*w+x)*4+3]>=128;
  const py=new Array(h).fill(0);for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(op(x,y))py[y]++;
  const out=[];
  for(const band of fitRuns(py,rows,'rows',notes)){const px=new Array(w).fill(0);
    for(let y=band.a;y<band.b;y++)for(let x=0;x<w;x++)if(op(x,y))px[x]++;
    for(const c of fitRuns(px,cols,'columns',notes)){let y0=band.b,y1=band.a;
      for(let y=band.a;y<band.b;y++)for(let x=c.a;x<c.b;x++)if(op(x,y)){if(y<y0)y0=y;if(y+1>y1)y1=y+1}
      out.push({x0:c.a,y0,x1:c.b,y1})}}
  return out}

const crop=(img,{x0,y0,x1,y1})=>{const w=x1-x0,h=y1-y0,d=new Uint8Array(w*h*4);
  for(let y=0;y<h;y++)d.set(img.data.subarray(((y0+y)*img.w+x0)*4,((y0+y)*img.w+x1)*4),y*w*4);return {w,h,data:d}};

// img: the model image as it came (a sheet is mostly plain ground, so the pixel grid post-texture.mjs samples tiles by is
// not read here; each figure is mode-voted straight down to its frame size). pal: the entry's colours.
// opts: tier, minPalette, factors (palette widening, as for every asset), key (hex colours that are recoloured per faction).
export function postSheet(img,entry,pal,outlineColor,{tier=32,minPalette=6,factors,key=null}={},notes={}){
  const p=entry.post||{},[W,H]=(entry.sizes&&entry.sizes[tier])||entry.size,{cols,rows}=entry.frames,fw=W/cols,fh=H/rows;
  const colors=expandPalette(pal,p.minPalette??minPalette,factors);
  let im=clearBackground(img,p.bgTolerance??40);
  if(p.tone===true)im=toneMatch(im,colors);
  const figs=findFigures(im,cols,rows,notes);
  const mw=Math.max(...figs.map(f=>f.x1-f.x0)),mh=Math.max(...figs.map(f=>f.y1-f.y0)),s=Math.min((fw-2)/mw,(fh-2)/mh);
  notes.frames=`${cols}x${rows}`;notes.figure=`${mw}x${mh}`;notes.scale=+s.toFixed(3);
  const out={w:W,h:H,data:new Uint8Array(W*H*4)};
  figs.forEach((f,i)=>{const c=crop(im,f);
    const fig=s>=1?nearestScale(c,Math.floor(s)):downscale(c,Math.max(1,Math.round(c.w*s)),Math.max(1,Math.round(c.h*s)),colors,p.downscale||'mode');
    const r=Math.floor(i/cols),k=i%cols,ox=k*fw+Math.floor((fw-fig.w)/2),oy=r*fh+fh-1-fig.h; // feet on the frame's floor, one pixel up
    for(let y=0;y<fig.h;y++)for(let x=0;x<fig.w;x++){const sI=(y*fig.w+x)*4,X=ox+x,Y=oy+y;if(!fig.data[sI+3]||X<k*fw+1||X>=(k+1)*fw-1||Y<r*fh+1)continue;
      out.data.set(fig.data.subarray(sI,sI+4),(Y*W+X)*4)}});
  im=quantise(out,colors,{dither:p.dither??0});
  if(p.outline!==false)im=outline(im,p.outlineColor||outlineColor);
  notes.colors=colorCount(im);
  const min=p.minColors??2;if(notes.colors<min)throw new SheetError(`flat: ${notes.colors} colour${notes.colors===1?'':'s'} (needs ${min}+)`,notes);
  if(key&&key.length){const ks=new Set(key.map(c=>hexToRgb(c.toLowerCase()).join(','))),need=p.keyFrames??Math.ceil(cols*rows/2),least=p.keyMin??3;let n=0;
    for(let r=0;r<rows;r++)for(let k=0;k<cols;k++){let c=0;
      for(let y=r*fh;y<(r+1)*fh;y++)for(let x=k*fw;x<(k+1)*fw;x++){const o=(y*W+x)*4;if(im.data[o+3]&&ks.has(im.data[o]+','+im.data[o+1]+','+im.data[o+2]))c++}
      if(c>=least)n++}
    notes.key=`${n}/${cols*rows}`;
    if(n<need)throw new SheetError(`no faction key: the tabard shows in ${n} of ${cols*rows} frames (needs ${need}); it would not take the faction colour`,notes)}
  return {w:im.w,h:im.h,data:im.data,notes}}
