// A town's own look (chapter maps, #1013): the LPC town kit (#830, #833) is cut once per style, so every town of a style stood in the
// same blue slate, cream plaster, grey wall and paving. A town names a look (data/townart.js TOWN_LOOKS by name, or its own `look`; render data only, nothing
// in the sim or the map reads it), a row of palette.js TOWN_LOOK: each material of the cut images is moved to the look's hue,
// saturation and lightness, keeping the cut's own banding and light, so a town differs by its roofs, walls, stone and paving.
// Materials are told apart by colour, which the cutter's ramps keep apart (palette.js TOWN): slate is a dull blue, glass a bright one,
// plaster a pale cream, the wall and ashlar stone a cool grey, the paving a dull warm grey, the street a sandy brown. Doors, trim, gold,
// glass and the outline are never moved. A town with no look, or no such row, draws the image as cut.
import {TOWN_LOOK} from './palette.js';
import {onAssets} from './assets.js';
import {onWorld} from '../sim/kept.js';
import {townLookId} from '../data/townart.js';

export const lookOf=c=>TOWN_LOOK[townLookId(c)]||null;

function hsl(r,g,b){r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b),l=(mx+mn)/2,d=mx-mn;let h=0;
  if(d){h=mx===r?((g-b)/d)%6:mx===g?(b-r)/d+2:(r-g)/d+4;h*=60;if(h<0)h+=360}
  return [h,d?d/(1-Math.abs(2*l-1)):0,l]}
function rgb(h,s,l){const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;let r=0,g=0,b=0;
  if(h<60)[r,g,b]=[c,x,0];else if(h<120)[r,g,b]=[x,c,0];else if(h<180)[r,g,b]=[0,c,x];else if(h<240)[r,g,b]=[0,x,c];else if(h<300)[r,g,b]=[x,0,c];else[r,g,b]=[c,0,x];
  const q=v=>Math.max(0,Math.min(255,Math.round((v+m)*255))).toString(16).padStart(2,'0');return '#'+q(r)+q(g)+q(b)}
// Which material a colour of the cut kit is, or null (left alone). Ranges read off the cut images' colours.
export function material(h,s,l,street=false){
  if(l<.1)return null; // the outline
  if(h>=205&&h<=235&&s>=.12&&s<.36&&l<.7)return 'roof'; // slate; glass is the brighter, more saturated blue
  if(h>=36&&h<=52&&s>=.17&&s<.46&&l>=.5)return 'wall'; // plaster
  if(h>=250&&h<=290&&s<.16&&l<.78)return 'mason'; // wall, tower and ashlar stone
  if(h>=28&&h<=52&&s<.16&&l>=.3&&l<.75)return 'plaza'; // the paving
  if(street&&h>=28&&h<=50&&s>=.3&&s<.5&&l>=.44&&l<.6)return 'street'; // the street's sand (only in the street's own cut: the same sand is wood elsewhere)
  return null}
// One colour moved by look L: {h, s, l:[k, add]} per material; s is the new saturation scaled by the source's against its material's middle.
const MID={roof:.24,wall:.3,mason:.08,plaza:.1,street:.42};
export function moveColour(hex,L,street=false){const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16),[h,s,l]=hsl(r,g,b),m=material(h,s,l,street),t=m&&L[m];
  if(!t)return hex;const k=t.l||[1,0];return rgb(t.h,Math.max(0,Math.min(1,t.s*s/MID[m])),Math.max(0,Math.min(1,l*k[0]+k[1])))}

// The image of asset pixels A ({w,h,hex}) in look L: a canvas in the browser, the moved pixels with no DOM. Cached per look and id.
const cache=new Map();
onAssets(()=>cache.clear());onWorld(()=>cache.clear());
export function lookImage(id,A,L,name){if(!A||!L)return null;const key=name+'|'+id;let o=cache.get(key);if(o)return o;
  const street=/-street$/.test(id),memo=new Map(),hex=A.hex.map(h=>{if(!h)return h;let v=memo.get(h);if(v===undefined){v=moveColour(h,L,street);memo.set(h,v)}return v});
  if(typeof document==='undefined'){o={w:A.w,h:A.h,hex};cache.set(key,o);return o}
  const c=document.createElement('canvas');c.width=A.w;c.height=A.h;const x=c.getContext('2d'),img=x.createImageData(A.w,A.h);
  for(let i=0;i<A.w*A.h;i++){const h=hex[i];if(!h)continue;const q=i*4;img.data[q]=parseInt(h.slice(1,3),16);img.data[q+1]=parseInt(h.slice(3,5),16);img.data[q+2]=parseInt(h.slice(5,7),16);img.data[q+3]=255}
  x.putImageData(img,0,0);cache.set(key,c);return c}

// A draw-well for the square of a look that has one (`centre: 'well'`), in place of the cut fountain: a round stone curb, dark water,
// two posts under a shake roof with a windlass and a bucket, a trough beside it. Art pixels for a w x h tile footprint (the fountain's
// 3x3), the curb in the look's stone. Browser only: with no DOM the cut fountain stands.
const wellC=new Map();
export function wellArt(name,L,wt,ht,TILE){const key=name+'|'+wt+'x'+ht+'@'+TILE;if(wellC.has(key))return wellC.get(key);if(typeof document==='undefined')return null;
  const W=wt*TILE,H=ht*TILE,c=document.createElement('canvas');c.width=W;c.height=H;const x=c.getContext('2d'),R=(a,b,w,h,k)=>{x.fillStyle=k;x.fillRect(a,b,w,h)};
  const st=['#2e2a34','#5a5462','#8a8292','#b4acb8'].map(h=>moveColour(h,L)),line='#14101c',wood=['#2e2018','#4a3224','#6e4c34','#8e6a48'],shake=['#3a2a1c','#5e4634','#7e6046','#9a7c5a'];
  const cx=W>>1,cy=H-30,rx=25,ry=14,fh=11;
  // shadow, then the curb: an elliptic ring of dressed stone with a coursed front face, lit from the top left
  x.fillStyle='#14101c50';x.beginPath();x.ellipse(cx+6,cy+fh+4,rx+6,ry+3,0,0,7);x.fill();
  for(let j=-ry;j<=ry+fh;j++)for(let i=-rx;i<=rx;i++){const top=Math.hypot(i/rx,j/ry)<=1,face=!top&&j>0&&Math.abs(i)<=rx&&Math.hypot(i/rx,(j-fh)/ry)<=1;
    if(!top&&!face)continue;let k;
    if(!top){const row=Math.floor((j-ry*Math.sqrt(Math.max(0,1-(i/rx)**2)))/4),joint=((i+40+(row&1)*4)%8===0),bed=((j-Math.round(ry*Math.sqrt(Math.max(0,1-(i/rx)**2))))%4===0);k=joint||bed?st[0]:i<-rx*.45?st[2]:st[1]}
    else{const d=Math.hypot(i/rx,j/ry);k=d>.66?(j<0&&i<6?st[3]:st[2]):d>.56?line:(((i*7+j*13)&31)===0?'#6a9ac8':j<-3?'#18242e':'#20323e')}
    R(cx+i,cy+j,1,1,k)}
  for(let i=-rx;i<=rx;i++){const j=Math.round(ry*Math.sqrt(Math.max(0,1-(i/rx)**2)));R(cx+i,cy+j+fh,1,1,line);R(cx+i,cy-j-1,1,1,line)}
  for(let j=0;j<=fh;j++){R(cx-rx-1,cy+j,1,1,line);R(cx+rx+1,cy+j,1,1,line)}
  // posts, windlass with its crank, rope and bucket
  const p0=cx-rx+4,p1=cx+rx-9,top=cy-44;
  for(const px of [p0,p1]){R(px-1,top,7,cy-top+4,line);R(px,top+1,5,cy-top+2,wood[2]);R(px,top+1,1,cy-top+2,wood[3]);R(px+4,top+1,1,cy-top+2,wood[1])}
  R(p0+2,cy-33,p1-p0,6,line);R(p0+3,cy-32,p1-p0-2,4,wood[2]);R(p0+3,cy-32,p1-p0-2,1,wood[3]);R(p0+3,cy-29,p1-p0-2,1,wood[1]);
  R(p1+6,cy-33,4,2,line);R(p1+9,cy-33,2,8,line);R(p1+9,cy-26,4,2,line);
  R(cx,cy-27,1,17,'#c8b890');R(cx-4,cy-11,9,8,line);R(cx-3,cy-10,7,6,wood[2]);R(cx-3,cy-10,7,1,'#a8a0a0');R(cx-3,cy-7,7,1,'#5a5462');
  // the roof: a ridge of shakes over the posts, its near slope lit, the far slope in shade, the gable ends dark
  const rw=rx+9,ry0=top-14;
  for(let j=0;j<18;j++){const y=ry0+j,lit=j<8;R(cx-rw-1,y,2*rw+2,1,line);for(let i=-rw;i<rw;i++){const row=Math.floor(j/3),sh=((i+40+(row&1)*3)%6===0);R(cx+i,y,1,1,j===7?shake[3]:sh?shake[0]:lit?shake[2]:(j%3===2?shake[0]:shake[1]))}}
  R(cx-rw-1,ry0-1,2*rw+2,1,line);R(cx-rw-1,ry0+18,2*rw+2,1,line);R(cx-rw,ry0+17,2*rw,1,'#00000040');
  // a trough to the right, a bucket and a sack to the left
  const tx=cx+rx+4,ty=cy+6;if(tx+18<=W){R(tx-1,ty-1,19,11,line);R(tx,ty,17,9,wood[2]);R(tx,ty,17,1,wood[3]);R(tx+2,ty+1,13,3,'#20323e');R(tx+2,ty+1,13,1,'#6a9ac8');R(tx+1,ty+9,2,3,line);R(tx+14,ty+9,2,3,line)}
  const bx=cx-rx-12;if(bx>1){R(bx-1,cy+7,9,11,line);R(bx,cy+8,7,9,wood[2]);R(bx,cy+10,7,1,'#5a5462');R(bx,cy+14,7,1,'#5a5462');R(bx,cy+8,7,1,wood[3])}
  wellC.set(key,c);return c}
