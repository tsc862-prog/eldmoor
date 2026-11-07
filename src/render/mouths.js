// Dungeon mouths of their own (chapter maps, after #1059): a dungeon named in data/townart.js DELVE_LOOKS draws its own way in instead of the one
// grey arch, and a first delve (sim/sites.js, a place of kind 'site') draws a small mouth by its theme (SITE_LOOKS) instead of the plain dark box.
//   den     a hollow in a salt-grey crag, roots over the lip, a torn net on the rock (the Gull Cliff Den)
//   cairn   a heap of fieldstones with a slab door and a herder's crook against it (the Herders' Cairn)
//   barrow  a long grassed mound, a kerb of stones, a lintel cut with a kestrel (the Kestrel Barrow)
//   weir    the LPC arch gone green, black water standing in its mouth (the Drowned Weir)
//   vaults  the broken ring of a burnt kiln, cellar hatches flung open over a stair (the Sallow Vaults)
//   quarry  a pale cut face, drill marks, a timbered adit (the Quarry Cellars, and a mine's first delve)
//   ruin    two stubs of wall and a stair going down (a ruin's first delve)
// Everything is drawn here, pixel by pixel at art resolution, from the LPC textures already loaded (ash rock, grass, the stone wall kit, the
// crypt arch) where they are, and flat ramps where they are not, so no new image is needed and a missing asset never leaves a gap. A landmark's
// door fills its 3x3 mouth box and nothing past it (terrain.js paints it into the chunks with townart.js); the low hill round it and the
// pieces on the ground are scenery.js dressMouth. Render only: the map, the sim and their hashes never see any of it.
import {hash,vnoise} from '../core/rng.js';
import {TILE} from './tile.js';
import {assetPixels,onAssets} from './assets.js';
import {drawCryptMouth} from './pieceart.js';
import {HARBOUR,MOUTH} from './palette.js';
import {delveLookId,SITE_LOOKS} from '../data/townart.js';

// ---- a small raster of hex colours (null = clear), turned into a canvas in the browser and handed as is to Node's raster ----
const RGB=new Map(),rgb=h=>{let v=RGB.get(h);if(!v){v=[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];RGB.set(h,v)}return v};
const hx=v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0');
const MIX=new Map();
export function mixHex(a,b,k){k=Math.max(0,Math.min(1,k));const key=a+b+((k*64)|0);let r=MIX.get(key);if(r)return r;const p=rgb(a),q=rgb(b),t=((k*64)|0)/64;
  r='#'+hx(p[0]+(q[0]-p[0])*t)+hx(p[1]+(q[1]-p[1])*t)+hx(p[2]+(q[2]-p[2])*t);MIX.set(key,r);return r}
export const lumOf=h=>{const v=rgb(h);return (v[0]*.3+v[1]*.59+v[2]*.11)/255};
export function pix(w,h){const hex=new Array(w*h).fill(null);
  const P={w,h,hex,
    set(x,y,c){x|=0;y|=0;if(c&&x>=0&&y>=0&&x<w&&y<h)hex[y*w+x]=c},
    get(x,y){x|=0;y|=0;return x>=0&&y>=0&&x<w&&y<h?hex[y*w+x]:null},
    rect(x,y,a,b,c){for(let j=y|0;j<(y+b|0);j++)for(let i=x|0;i<(x+a|0);i++)P.set(i,j,c)},
    // one outline pixel round everything drawn, where it meets the clear
    outline(c){const o=[];for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(!hex[y*w+x]&&(P.get(x-1,y)||P.get(x+1,y)||P.get(x,y-1)||P.get(x,y+1)))o.push(x,y);for(let i=0;i<o.length;i+=2)P.set(o[i],o[i+1],c)}};
  return P}
// The raster as something drawImage takes: a canvas in the browser, itself in Node (artcheck's raster draws {w, h, hex}).
export function finish(P){if(typeof document==='undefined')return P;const c=document.createElement('canvas');c.width=P.w;c.height=P.h;const x=c.getContext('2d'),img=x.createImageData(P.w,P.h);
  for(let i=0;i<P.w*P.h;i++){const h=P.hex[i];if(!h)continue;const v=rgb(h),o=i*4;img.data[o]=v[0];img.data[o+1]=v[1];img.data[o+2]=v[2];img.data[o+3]=255}
  x.putImageData(img,0,0);return c}
// A loaded texture sampled with wrap, tinted; the flat colour where it is not loaded.
export function texture(id,flat,tint){const A=assetPixels(id);return (x,y)=>{let c=A?(A.hex[(((y%A.h)+A.h)%A.h)*A.w+(((x%A.w)+A.w)%A.w)]||flat):flat;return tint?mixHex(c,tint[0],tint[1]):c}}
const B4=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
const dith=(x,y)=>(B4[(y&3)*4+(x&3)]+.5)/16-.5;
// Light from the top left: l in about -1..1 lifts toward the highlight or sinks toward the shadow, in a few bands, dithered at their edges.
function lit(c,l,x,y){l+=dith(x,y)*.18;return l>.55?mixHex(c,MOUTH.hi,.28):l>.25?mixHex(c,MOUTH.hi,.13):l<-.55?mixHex(c,MOUTH.lo,.5):l<-.2?mixHex(c,MOUTH.lo,.26):c}

// ---- the faces ----
// A crag: an irregular lump of rock filling the lower part of the raster, lit as a dome.
function crag(P,tex,top,s,wide=.47){const {w,h}=P,cx=w/2,R=w*wide;
  const dome=(x,y)=>{const u=(x+.5-cx)/R,v=(y+.5-h)/(h*(1-top));return 1-u*u-v*v};
  const hf=(x,y)=>Math.sqrt(Math.max(0,dome(x,y)))*.9+(vnoise(x/9+s,y/9,911)-.5)*.7+(vnoise(x/3.5,y/3.5+s,913)-.5)*.18;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){if(dome(x,y)+(vnoise(x/6,y/6+s,915)-.5)*.22<0)continue;
    const l=(hf(x-1,y-1)-hf(x+1,y+1))*5-.1;P.set(x,y,lit(tex(x,y),l,x,y))}}
// A heap of fieldstones in a dome: cells of a jittered grid, a dark joint where two cells meet, each stone lit on its own top left.
function heap(P,rx,ry,s,ramp){const {w,h}=P,cx=w/2,C=9,pts=[];
  for(let j=-1;j<=h/C+1;j++)for(let i=-1;i<=w/C+1;i++)pts.push([i*C+(j&1?C/2:0)+(hash(i,j,s)-.5)*5,j*C+(hash(i,j,s+1)-.5)*5,(hash(i,j,s+2)*ramp.length)|0]);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const u=(x+.5-cx)/rx,v=(y+.5-h)/ry,q=u*u+v*v+(vnoise(x/6,y/6+s,915)-.5)*.18;if(q>1)continue;
    let d1=1e9,d2=1e9,b=null;for(const p of pts){const dx=x-p[0],dy=y-p[1];if(Math.abs(dx)>C*1.6||Math.abs(dy)>C*1.6)continue;const d=dx*dx+dy*dy;if(d<d1){d2=d1;d1=d;b=p}else if(d<d2)d2=d}
    if(!b)continue;const gap=Math.sqrt(d2)-Math.sqrt(d1);
    if(gap<1.3){P.set(x,y,MOUTH.joint);continue}
    const sx=(x-b[0])/C,sy=(y-b[1])/C,l=-.9*sx-.9*sy-.5*u-.4*v-.2;P.set(x,y,lit(ramp[b[2]],l,x,y))}}
// A dark way in: inside(x,y) says which pixels; the deeper (farther from the rim), the darker; the lip lit above and shaded below.
function hole(P,inside,deep){const {w,h}=P,inn=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(inside(x,y))inn[y*w+x]=1;
  const at=(x,y)=>x>=0&&y>=0&&x<w&&y<h&&inn[y*w+x];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){if(!inn[y*w+x]){if(at(x,y+1)||at(x+1,y+1))P.set(x,y,MOUTH.lip);else if(at(x-1,y)||at(x-1,y-1))P.set(x,y,MOUTH.lo);continue}
    let d=0;while(d<deep&&at(x,y-d-1)&&at(x-d-1,y)&&at(x+d+1,y))d++;P.set(x,y,MOUTH.dark[Math.min(MOUTH.dark.length-1,(d*MOUTH.dark.length/deep)|0)])}
  return inn}
// A slab: a dressed stone block, outlined, lit on its top and left edges.
function slab(P,x,y,w,h,c){P.rect(x,y,w,h,MOUTH.joint);P.rect(x+1,y+1,w-2,h-2,c);P.rect(x+1,y+1,w-2,1,mixHex(c,MOUTH.hi,.35));P.rect(x+1,y+1,1,h-2,mixHex(c,MOUTH.hi,.2));P.rect(x+w-2,y+2,1,h-3,mixHex(c,MOUTH.lo,.35))}
// A post or beam of timber.
function timber(P,x,y,w,h,ramp,along){P.rect(x,y,w,h,ramp[0]);P.rect(x+1,y+1,w-2,h-2,ramp[2]);if(along)P.rect(x+1,y+1,w-2,1,ramp[3]);else P.rect(x+1,y+1,1,h-2,ramp[3]);P.rect(along?x+1:x+w-2,along?y+h-2:y+1,along?w-2:1,along?1:h-2,ramp[1]);
  for(let i=0;i<(along?w:h);i+=5)if(hash(x+i,y,921)>.6)P.set(along?x+1+i:x+1+(i%2),along?y+2:y+1+i,ramp[1])}
// Stair treads going down into the dark, the top one lit.
function stair(P,x,y,w,h){P.rect(x,y,w,h,MOUTH.dark[3]);const n=Math.max(3,Math.round(h/5));for(let i=0;i<n;i++){const ty=y+Math.round(i*h/n),k=1-i/n;P.rect(x,ty,w,2,mixHex(i?MOUTH.tread:MOUTH.lip,MOUTH.dark[3],(1-k)*.9));P.rect(x,ty+2,w,2,mixHex(MOUTH.riser,MOUTH.dark[3],(1-k)*.9))}}

// ---- each look, drawn into a w x h raster whose bottom row is the ground line ----
const LOOKS={
  den(P,s,big){const {w,h}=P,cx=w/2,rock=texture('tile:ash-rock',MOUTH.salt[2],[MOUTH.salt[1],.42]);crag(P,rock,big?.04:.1,s,.45);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(P.get(x,y)&&hash(x,y,s+7)<.006&&lumOf(P.get(x,y))>.5)P.set(x,y,MOUTH.salt[0]); // the gulls' white
    const ow=w*.6,oh=h*.58,inn=hole(P,(x,y)=>{const u=(x+.5-cx)/(ow/2),v=(y+.5-h)/oh,r=1+(vnoise(x/5,y/5+s,917)-.5)*.34;return u*u+v*v<r*r&&y<h},big?8:5);
    for(let x=0;x<w;x++)for(let y=h-3;y<h;y++)if(inn[y*w+x])P.set(x,y,MOUTH.dark[1]); // a floor of wet shingle in the mouth
    // roots over the lip: each finds the hole's top at its column and hangs down into the dark
    const n=big?7:4;for(let i=0;i<n;i++){let x=Math.round(cx-ow*.4+ow*.8*(i+.5)/n+(hash(i,s,923)-.5)*4),y=0;while(y<h&&!inn[y*w+x])y++;const L=6+hash(i,s,925)*(big?16:9);
      for(let k=-2;k<L;k++){if(hash(i,k,927)>.75)x+=hash(i,k,929)>.5?1:-1;P.set(x,y+k,MOUTH.root[1]);P.set(x+1,y+k,MOUTH.root[0]);if(k>L-3)P.set(x+1,y+k,null)}}
    // a torn net hung on the rock to the left of the mouth: a diamond mesh with a ragged foot
    const nx0=Math.round(cx-ow/2-w*.18),nx1=Math.round(cx-ow/2+3),ny0=Math.round(h*.42);for(let x=nx0;x<nx1;x++){const foot=h-3-Math.round(hash(x>>1,s,931)*8);for(let y=ny0+Math.abs(x-(nx0+nx1)/2)*.3;y<foot;y++){
      if(((x+y)%5===0||(x-y+60)%5===0)&&hash(x,y,933)>.12&&!inn[(y|0)*w+x]&&P.get(x,y))P.set(x,y,(x+y)&1?HARBOUR.net[0]:HARBOUR.net[1])}}},
  cairn(P,s,big){const {w,h}=P,cx=w/2;heap(P,w*.49,h*(big?.86:.9),s,MOUTH.stones);
    const lw=Math.round(w*(big?.4:.46)),ly=Math.round(h*(big?.38:.32)),lh=Math.round(h*.1)+2,pw=Math.round(w*.085),gap=Math.round(w*(big?.17:.2));
    P.rect(cx-gap/2,ly+lh,gap,h-ly-lh,MOUTH.dark[3]);for(let y=ly+lh;y<h;y++){const k=(y-ly-lh)/(h-ly-lh);P.rect(cx-gap/2+1,y,gap-2,1,MOUTH.dark[k<.3?2:k<.7?3:1])}
    slab(P,cx-gap/2-pw,ly+lh-1,pw,h-ly-lh+1,MOUTH.slab);slab(P,cx+gap/2,ly+lh-1,pw,h-ly-lh+1,MOUTH.slab);slab(P,cx-lw/2,ly,lw,lh,MOUTH.slab);
    // the old herder's crook against the door: a staff and its hook
    const x0=Math.round(cx+gap/2+pw+3),top=Math.round(h*(big?.3:.24));for(let y=top;y<h-1;y++){const x=x0+Math.round((h-1-y)*.12);P.set(x,y,MOUTH.wood[2]);P.set(x+1,y,MOUTH.wood[0])}
    const tx=x0+Math.round((h-1-top)*.12);[[0,0],[0,-1],[1,-2],[2,-3],[3,-3],[4,-2],[4,-1],[4,0]].forEach(([a,b])=>{P.set(tx+a,top+b,MOUTH.wood[2]);P.set(tx+a+1,top+b,MOUTH.wood[0])})},
  barrow(P,s,big){const {w,h}=P,cx=w/2,grass=texture('tile:grass',MOUTH.turf[1],[MOUTH.turf[0],.22]);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const u=(x+.5-cx)/(w*.5),v=(y+.5-h)/(h*.82),q=u*u+v*v+(vnoise(x/7,y/7+s,941)-.5)*.12;if(q>1)continue;P.set(x,y,lit(grass(x,y),-.8*u-.9*v-.45,x,y))}
    // a kerb of stones along the foot, broken for the door
    const gap=Math.round(w*.2);for(let x=Math.round(w*.1);x<w*.9-6;x+=7+((hash(x,s,943)*2)|0)){if(Math.abs(x+3-cx)<gap/2+5)continue;const y=h-7;slab(P,x,y,6+((hash(x,s,945)*3)|0),6,MOUTH.stones[(hash(x,s,947)*MOUTH.stones.length)|0])}
    const pw=Math.round(w*.09),ly=Math.round(h*.42),lh=Math.round(h*.12)+2,lw=gap+2*pw+8;
    P.rect(cx-gap/2,ly+lh,gap,h-ly-lh,MOUTH.dark[3]);for(let y=ly+lh+2;y<h;y++)P.rect(cx-gap/2+1,y,gap-2,1,MOUTH.dark[y>h-4?1:2]);
    slab(P,cx-gap/2-pw,ly+lh-1,pw,h-ly-lh+1,MOUTH.ashlar);slab(P,cx+gap/2,ly+lh-1,pw,h-ly-lh+1,MOUTH.ashlar);slab(P,cx-lw/2,ly,lw,lh,MOUTH.ashlar);
    // the kestrel cut in the lintel: wings out, a fanned tail
    const kx=Math.round(cx),ky=ly+Math.round(lh/2);for(const [a,b] of [[0,-2],[0,-1],[0,0],[0,1],[-1,1],[1,1],[0,2],[-1,-1],[1,-1],[-2,-1],[2,-1],[-3,0],[3,0],[-4,0],[4,0],[-5,1],[5,1],[-2,0],[2,0]])P.set(kx+a,ky+b,MOUTH.cut)},
  weir(P,s){const {w,h}=P,A=assetPixels('landmark:crypt-mouth');
    if(A)for(let y=0;y<h;y++)for(let x=0;x<w;x++)P.set(x,y,A.hex[((y*A.h/h)|0)*A.w+((x*A.w/w)|0)]);
    else{const k=w/48;drawCryptMouth((x,y,a,b,c)=>P.rect(x*k,y*k,a*k,b*k,c),0,0)}
    // green stone, moss drips down from every top edge, and the water standing in the mouth up to a line
    for(let i=0;i<w*h;i++){const c=P.hex[i];if(c&&lumOf(c)>.12)P.hex[i]=mixHex(c,MOUTH.moss[2],.38)}
    for(let x=0;x<w;x++){let y=0;while(y<h&&!P.get(x,y))y++;const L=hash(x,s,951)<.35?2+((hash(x,s,953)*6)|0):1;for(let k=0;k<L;k++)if(P.get(x,y+k)&&lumOf(P.get(x,y+k))>.12)P.set(x,y+k,MOUTH.moss[k?1:0])}
    const wl=Math.round(h*.6);for(let y=wl;y<h;y++)for(let x=0;x<w;x++){const c=P.get(x,y);if(!c||lumOf(c)>.12)continue;P.set(x,y,y===wl?MOUTH.water[2]:hash(x>>2,y,955)<.08?MOUTH.water[1]:MOUTH.water[0])}},
  vaults(P,s,big){const {w,h}=P,cx=w/2,rx=w*.47,ry=h*(big?.8:.85),top=h-ry;
    // the kiln: a beehive of brick, soot-black toward its top, the crown fallen in
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const u=(x+.5-cx)/rx,v=(y+.5-h)/ry,q=u*u+v*v+(vnoise(x/5,y/5+s,961)-.5)*.1;if(q>1)continue;
      const row=Math.floor((y-top)/4),j=(y-top)%4===3||((x+(row&1)*4)%8===0),b=MOUTH.brick[(hash((x+(row&1)*4)>>3,row,963)*MOUTH.brick.length)|0],soot=Math.max(0,1-(y-top)/(ry*.75))*.8+hash(x>>1,y>>1,965)*.15;
      P.set(x,y,j?MOUTH.char[0]:mixHex(lit(b,-.7*u-.8*v-.3,x,y),MOUTH.char[0],soot))}
    const cy=top+ry*.2;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const u=(x+.5-cx)/(rx*.5),v=(y+.5-cy)/(ry*.16),q=u*u+v*v+(vnoise(x/3,y/3+s,967)-.5)*.5;if(q<1)P.set(x,y,q>.72?MOUTH.brick[1]:MOUTH.dark[2])}
    // the cellar: a stair down through the kiln's mouth under a charred lintel, and the two hatch doors flung open either side
    const sw=Math.round(w*.3),sy=Math.round(h*.56);P.rect(cx-sw/2-2,sy-2,sw+4,h-sy+2,MOUTH.char[0]);stair(P,cx-sw/2,sy,sw,h-sy);
    timber(P,cx-sw/2-4,sy-5,sw+8,4,MOUTH.charwood,true);
    for(const side of [-1,1]){const dw=Math.round(w*.17),x0=side<0?Math.round(cx-sw/2-4-dw):Math.round(cx+sw/2+4),dh=Math.round((h-sy)*.8);
      for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){const yy=h-dh+y-Math.round((side<0?dw-x:x)*.12);const edge=x===0||x===dw-1||y===0||y===dh-1;P.set(x0+x,yy,edge?MOUTH.charwood[0]:x%4===0?MOUTH.charwood[1]:y===Math.round(dh*.3)||y===Math.round(dh*.7)?MOUTH.iron:MOUTH.charwood[3])}}},
  quarry(P,s,big){const {w,h}=P,cx=w/2,rock=texture('tile:ash-rock',MOUTH.cut2[1],[MOUTH.cut2[0],.42]);crag(P,rock,big?.06:.1,s,.49);
    // a face cut square into the crag round the way in: planed flat, drill marks down it, one bedding line across, its top edge lit
    const fw=Math.round(w*.62),fy=Math.round(h*(big?.3:.24));for(let y=fy;y<h;y++)for(let x=Math.round(cx-fw/2);x<cx+fw/2;x++){if(!P.get(x,y))continue;
      let c=mixHex(rock(x,y),MOUTH.cut2[0],.35);if(y<fy+2)c=MOUTH.cut2[2];else if(x%6===2&&y<fy+6+((hash(x,s,973)*h*.35)|0))c=mixHex(c,MOUTH.lo,.3);else if(y===fy+Math.round((h-fy)*.45))c=mixHex(c,MOUTH.lo,.22);
      if(x>cx+fw/2-4)c=mixHex(c,MOUTH.lo,.3);P.set(x,y,c)}
    const aw=Math.round(w*.3),ay=Math.round(h*(big?.52:.46));hole(P,(x,y)=>Math.abs(x+.5-cx)<aw/2&&y>=ay,big?7:5);
    const pw=Math.max(4,Math.round(w*.055)),bh=Math.max(4,Math.round(h*.065));timber(P,cx-aw/2-pw+1,ay-1,pw,h-ay+1,MOUTH.wood,false);timber(P,cx+aw/2-1,ay-1,pw,h-ay+1,MOUTH.wood,false);timber(P,cx-aw/2-pw-2,ay-bh,aw+2*pw+4,bh,MOUTH.wood,true);
    for(const rx of [cx-aw*.25,cx+aw*.25-1])P.rect(rx,h-Math.round(h*.16),1,Math.round(h*.16),MOUTH.rail)}, // rails running in
  ruin(P,s){const {w,h}=P,cx=w/2;
    // two stubs of coursed wall, ragged at the top, lit on the left; the stair goes down in the gap between them
    for(const [x0,x1,lo,hi] of [[2,Math.round(w*.34),.45,.85],[Math.round(w*.66),w-2,.3,.6]])for(let x=x0;x<x1;x++){const t=Math.round(h*(1-lo-(hi-lo)*hash(x>>2,s,981)))-2;
      for(let y=t;y<h-1;y++){const row=(y-h)>>2,bx=(x+(row&1)*4)>>3,c=MOUTH.stones[(hash(bx,row,983)*MOUTH.stones.length)|0],j=((y-h)&3)===3||((x+(row&1)*4)&7)===0;
        P.set(x,y,y<t+2?mixHex(c,MOUTH.hi,.3):j?MOUTH.joint:lit(c,(x-x0<2?.6:x1-x<2?-.6:0),x,y))}}
    const sw=Math.round(w*.28),sy=Math.round(h*.45);P.rect(cx-sw/2-1,sy-1,sw+2,h-sy+1,MOUTH.joint);stair(P,cx-sw/2,sy,sw,h-sy);
    for(const [x,y] of [[w*.12,h-3],[w*.4,h-2],[w*.8,h-3],[w*.9,h-2]])slab(P,Math.round(x),Math.round(y)-3,5,4,MOUTH.stones[0])}};
// What first delves look like by theme, and what a landmark's look is; null: the old drawing.
export const siteLook=theme=>SITE_LOOKS[theme]||null;

// ---- cached images ----
const C=new Map();onAssets(()=>C.clear());
// A landmark's door over its mouth box (the whole box, TILE a tile), or null when it keeps the arch.
export function mouthImage(L){const look=delveLookId(L);if(!look||!LOOKS[look]||!L.mouth)return null;const m=L.mouth,w=(m.x1-m.x0+1)*TILE,h=(m.y1-m.y0+1)*TILE,key='L|'+L.name+'|'+look+'|'+w+'x'+h;
  let im=C.get(key);if(im)return im;const P=pix(w,h),s=(hash(m.x0,m.y0,991)*997)|0;LOOKS[look](P,s,true);if(look!=='weir'&&look!=='ruin')P.outline(MOUTH.joint);im=finish(P);C.set(key,im);return im}
// A first delve's mouth, about two tiles wide, standing on its place's spot; null for a theme with no look.
export const SITE_SIZE={den:[2.3,1.7],cairn:[2.1,1.6],quarry:[2.2,1.6],ruin:[2.4,1.4]};
export function siteImage(theme){const look=siteLook(theme);if(!look||!LOOKS[look])return null;const key='S|'+look;let im=C.get(key);if(im)return im;
  const [a,b]=SITE_SIZE[look]||[2,1.6],P=pix(Math.round(a*TILE),Math.round(b*TILE));LOOKS[look](P,331,false);P.outline(MOUTH.joint);im=finish(P);C.set(key,im);return im}
