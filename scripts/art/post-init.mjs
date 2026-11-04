// Post-processing of an image made from an init image (#763; scripts/art/init.mjs). The model was handed the game's own art, one
// asset pixel a k x k cell at a known place on its canvas, so nothing has to be found in its answer:
//   1. each cell of the answer is one asset pixel: mode vote over the entry's colours (the flat palette, or the palette
//      widened for the tier), through the same layout (scaled if the answer came at another size);
//   2. the silhouette is the procedural art's: what the art leaves clear stays clear, whatever the model did there;
//   3. two measures of how far the model strayed, both refused like an off-style image (kind 'flat', raw kept):
//      drift, the mean RGB distance of the answer's cells from the art inside the silhouette (the worst frame of a sheet: a
//      figure repainted or moved), over gate maxDrift; spill, the share of clear cells the model painted on (a prop, a second
//      figure, a scene round the subject), over gate maxSpill. Both limits in INIT_GATE, post.gate overrides;
//   4. the recipe's own finish and gates: buildings and landmarks on post.flat go through post-flat.mjs finishFlat (the style
//      gate, despeckle, rim outline; the distance read from the cells); sheets get a rim outline per frame and post-sheet.mjs
//      checkSheet (colours, the tabard in the faction key); the masonry pieces a colour count.
// Pure functions over {w, h, data: Uint8Array RGBA}; no I/O, no randomness.
import {downscale} from './post.mjs';
import {sampleCells,expandPalette,colorCount} from './post-texture.mjs';
import {paletteDistance,finishFlat} from './post-flat.mjs';
import {checkSheet} from './post-sheet.mjs';
import {BACKGROUND,rimFrames} from './init.mjs';

export const INIT_GATE={maxDrift:64,maxSpill:.2};
export class InitError extends Error{constructor(msg,notes){super(`off-style: ${msg}`);this.kind='flat';this.why='off-style';this.notes=notes}}

// The part of the model's image that holds the art.
function subject(img,{small,k,ox,oy,cw}){const s=img.w/cw,x0=Math.round(ox*s),y0=Math.round(oy*s),w=Math.round(small.w*k*s),h=Math.round(small.h*k*s),out=new Uint8Array(w*h*4);
  for(let y=0;y<h;y++)out.set(img.data.subarray(((y+y0)*img.w+x0)*4,((y+y0)*img.w+x0+w)*4),y*w*4);return {w,h,data:out}}
const gap=(a,i,b,j)=>Math.hypot(a[i]-b[j],a[i+1]-b[j+1],a[i+2]-b[j+2]);
// Drift inside the silhouette (overall and worst frame) and spill outside it, cell by cell.
function stray(cells,small,frames){const {w,h}=small,{cols,rows}=frames||{cols:1,rows:1},fw=w/cols,fh=h/rows,sum=new Float64Array(cols*rows),n=new Uint32Array(cols*rows),bg=Uint8Array.from(BACKGROUND);let clear=0,spilt=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const o=(y*w+x)*4;
    if(small.data[o+3]>=128){const f=Math.floor(y/fh)*cols+Math.floor(x/fw);sum[f]+=gap(cells.data,o,small.data,o);n[f]++}
    else{clear++;if(gap(cells.data,o,bg,0)>60)spilt++}}
  const per=[...sum].map((s,i)=>n[i]?s/n[i]:0),r=v=>Math.round(v*1000)/1000;
  return {drift:r(Math.max(...per)),mean:r(sum.reduce((a,b)=>a+b,0)/Math.max(1,n.reduce((a,b)=>a+b,0))),spill:r(clear?spilt/clear:0)}}

// img: the model's answer; pal: the entry's colours; init: {small, k, ox, oy, cw, ch, strength}. Returns {w, h, data, notes}.
export function postInit(img,entry,pal,outlineColor,{tier=32,minPalette=6,factors,key=null,init}){
  const p=entry.post||{},{small}=init,{w:W,h:H}=small,lim={...INIT_GATE,...(p.gate||{})},notes={recipe:'init',grid:`${init.k} (init)`,native:`${img.w}x${img.h}`,strength:init.strength};
  if(img.w*init.ch!==img.h*init.cw)throw new InitError(`the answer is ${img.w}x${img.h}, the canvas was ${init.cw}x${init.ch}`,notes);
  const colors=p.flat?pal:expandPalette(pal,p.minPalette??minPalette,factors),sub=subject(img,init),cs=sub.w/W;
  const cells=sampleCells(sub,{x:{s:cs,o:0},y:{s:cs,o:0}}),st=stray(cells,small,entry.frames);Object.assign(notes,st);
  const why=[];if(st.drift>lim.maxDrift)why.push(`redrawn: drift ${st.drift} from the procedural art (at most ${lim.maxDrift})`);
  if(st.spill>lim.maxSpill)why.push(`drew outside the silhouette: ${Math.round(st.spill*100)}% of the clear cells (at most ${Math.round(lim.maxSpill*100)}%)`);
  if(why.length)throw new InitError(why.join('; '),notes);
  const q=downscale(sub,W,H,colors,p.downscale||'mode');
  for(let i=0;i<W*H;i++){const o=i*4;if(small.data[o+3]<128){q.data.fill(0,o,o+4);cells.data[o+3]=0}else cells.data[o+3]=255}
  if(p.flat)return finishFlat(q,entry,pal,paletteDistance(cells,pal),notes);
  if(entry.frames){const im=rimFrames(q,entry.frames.cols,entry.frames.rows,p.outlineColor||outlineColor);notes.frames=`${entry.frames.cols}x${entry.frames.rows}`;return checkSheet(im,{...entry,post:{...p,minColors:Math.min(p.minColors??2,colorCount(small))}},key,notes,tier)} // the art's own few colours are not a flat answer
  notes.colors=colorCount(q);const min=Math.min(p.minColors??2,colorCount(small));if(notes.colors<min)throw new InitError(`flat: ${notes.colors} colours (needs ${min}+)`,notes);
  return {...q,notes}}

