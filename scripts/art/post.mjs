// Post-processing for generated art (#177): a model image becomes a game asset. Steps, in order:
//   1. transparent background (sprites, props): flood-fill from the border over pixels near the corner colour;
//   2. downscale to the asset's pixel grid, one cell per output pixel ('mode': the most common palette colour
//      in the cell, crisp; 'mean': the cell's average, softer);
//   3. quantise every pixel to the asset's palette (colours from src/render/palette.js plus the manifest's extras);
//   4. optional 1px outline around opaque pixels, in palette MARK.outline unless the entry names one.
// Pure functions over {w, h, data: Uint8Array RGBA}; no I/O, no randomness, so the same input gives the same PNG.

const HEX=/^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
export const hexToRgb=s=>{s=s.slice(1);if(s.length===3)s=s.replace(/./g,c=>c+c);return [parseInt(s.slice(0,2),16),parseInt(s.slice(2,4),16),parseInt(s.slice(4,6),16)]};
export const rgbToHex=([r,g,b])=>'#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');

// Every opaque hex colour under one palette path ("BIOME.meadow", "UI", "SPELL.leaf"), walked recursively.
function collect(v,out){if(typeof v==='string'){if(HEX.test(v))out.push(v.toLowerCase())}
  else if(Array.isArray(v)||(v&&typeof v==='object'))for(const k of Object.values(v))collect(k,out)}
export function resolvePalette(spec,PAL){
  const out=[],missing=[];
  for(const path of (spec&&spec.from)||[]){let v=PAL;for(const k of path.split('.'))v=v==null?undefined:v[k];
    if(v===undefined){missing.push(path);continue}collect(v,out)}
  for(const c of (spec&&spec.extra)||[]){if(HEX.test(c))out.push(c.toLowerCase());else missing.push(c)}
  return {colors:[...new Set(out)],missing}}

// Perceptual-ish distance ("redmean"), cheap and good enough for a few dozen colours.
function dist(a,b){const rm=(a[0]+b[0])/2,dr=a[0]-b[0],dg=a[1]-b[1],db=a[2]-b[2];return (2+rm/256)*dr*dr+4*dg*dg+(2+(255-rm)/256)*db*db}
export function quantiser(colors){
  const P=colors.map(hexToRgb),cache=new Map();
  return (r,g,b)=>{const k=(r<<16)|(g<<8)|b;let i=cache.get(k);
    if(i===undefined){let best=1e18;i=0;for(let j=0;j<P.length;j++){const d=dist([r,g,b],P[j]);if(d<best){best=d;i=j}}cache.set(k,i)}
    return i}}

// Clear the background: flood-fill from every border pixel over colours within tol of the corner median.
export function clearBackground(img,tol=40){
  const {w,h,data}=img,d=new Uint8Array(data),corners=[[0,0],[w-1,0],[0,h-1],[w-1,h-1]].map(([x,y])=>{const o=(y*w+x)*4;return [d[o],d[o+1],d[o+2]]});
  const med=k=>corners.map(c=>c[k]).sort((a,b)=>a-b)[1],bg=[med(0),med(1),med(2)],lim=tol*tol*9;
  const seen=new Uint8Array(w*h),st=[];
  const push=(x,y)=>{if(x<0||y<0||x>=w||y>=h)return;const i=y*w+x;if(seen[i])return;seen[i]=1;const o=i*4;
    if(d[o+3]<128||dist([d[o],d[o+1],d[o+2]],bg)<=lim){d[o+3]=0;st.push(x,y)}};
  for(let x=0;x<w;x++){push(x,0);push(x,h-1)}for(let y=0;y<h;y++){push(0,y);push(w-1,y)}
  while(st.length){const y=st.pop(),x=st.pop();push(x+1,y);push(x-1,y);push(x,y+1);push(x,y-1)}
  return {w,h,data:d}}

export function downscale(img,W,H,colors,mode='mode'){
  const q=quantiser(colors),P=colors.map(hexToRgb),out=new Uint8Array(W*H*4),{w,h,data}=img;
  for(let Y=0;Y<H;Y++)for(let X=0;X<W;X++){
    const x0=Math.floor(X*w/W),x1=Math.max(x0+1,Math.floor((X+1)*w/W)),y0=Math.floor(Y*h/H),y1=Math.max(y0+1,Math.floor((Y+1)*h/H));
    let n=0,op=0,r=0,g=0,b=0;const votes=new Map();
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const o=(y*w+x)*4;n++;if(data[o+3]<128)continue;op++;
      if(mode==='mean'){r+=data[o];g+=data[o+1];b+=data[o+2]}else{const i=q(data[o],data[o+1],data[o+2]);votes.set(i,(votes.get(i)||0)+1)}}
    const O=(Y*W+X)*4;if(op*2<n)continue; // mostly transparent: stays clear
    let i;if(mode==='mean')i=q(Math.round(r/op),Math.round(g/op),Math.round(b/op));
    else{let best=-1;for(const [k,v] of votes)if(v>best||(v===best&&k<i)){best=v;i=k}}
    out[O]=P[i][0];out[O+1]=P[i][1];out[O+2]=P[i][2];out[O+3]=255}
  return {w:W,h:H,data:out}}

export function outline(img,color){
  const {w,h,data}=img,d=new Uint8Array(data),c=hexToRgb(color),op=(x,y)=>x>=0&&y>=0&&x<w&&y<h&&data[(y*w+x)*4+3]>=128;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){if(op(x,y))continue;if(op(x+1,y)||op(x-1,y)||op(x,y+1)||op(x,y-1)){const o=(y*w+x)*4;d[o]=c[0];d[o+1]=c[1];d[o+2]=c[2];d[o+3]=255}}
  return {w,h,data:d}}

// The whole chain for one manifest entry. pal = resolved colour list; outlineColor from palette MARK.outline.
export function postProcess(img,entry,pal,outlineColor){
  const p=entry.post||{};const [W,H]=entry.size;
  let im=img;if(p.transparent)im=clearBackground(im,p.bgTolerance??40);
  im=downscale(im,W,H,pal,p.downscale||'mode');
  if(p.outline)im=outline(im,p.outlineColor||outlineColor);
  return im}
