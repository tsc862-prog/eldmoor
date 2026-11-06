// The two landmarks in the LPC look (#836, epic #830), cut and recoloured from the LPC base sheets (assets/packs/lpc-base,
// CC-BY-SA 3.0 / GPL 3.0, authors in its CREDITS.TXT) into the shapes the renderer's landmark hooks expect
// (castle arch and brick: castlewalls.png by Daniel Armstrong; charcoal rock: lavarock.png by Leana Zimmerman)
// (src/render/townart.js ASSET_TOWNS 'landmark:crypt-mouth' 96x96 over the 3x3 rock patch, 'landmark:lair' 256x256 over the lair's
// 8x8 inner disc, drawn opening west). The pixels are LPC's: no scaling, only a palette change (the castle kit is pale green-grey
// stone, so it is mapped by lightness onto the crypt's violet-grey ramp from palette.js FLAT.crypt) and a few hand-set pixels
// (the green glint over the arch, two skulls, ember cracks, the gold heap). Deterministic, no RNG.
//
//   node scripts/art/landmarkcut.mjs [--packs DIR] [--out DIR] [--index]
//
// --index writes assets/landmark/32/*.png and their index entries (source, license, authors); without it only --out DIR.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodePng,encodePng} from './png.mjs';
import {sha256} from './lib.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
const argv=process.argv.slice(2),flag=n=>{const i=argv.indexOf('--'+n);return i>=0?argv[i+1]:null};
const PACKS=flag('packs')||path.join(ROOT,'assets','packs');
const TILES=path.join(PACKS,'lpc-base','LPC Base Assets','tiles');
const sheet=n=>decodePng(fs.readFileSync(path.join(TILES,n+'.png')));
const blank=(w,h)=>({w,h,data:new Uint8Array(w*h*4)});
const px=(im,x,y)=>{if(x<0||y<0||x>=im.w||y>=im.h)return [0,0,0,0];const o=(y*im.w+x)*4;return [im.data[o],im.data[o+1],im.data[o+2],im.data[o+3]]};
const put=(im,x,y,p)=>{if(x<0||y<0||x>=im.w||y>=im.h)return;const o=(y*im.w+x)*4;im.data[o]=p[0];im.data[o+1]=p[1];im.data[o+2]=p[2];im.data[o+3]=p[3]??255};
const hex=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16),255];
const lum=p=>.299*p[0]+.587*p[1]+.114*p[2];
const rect=(im,x,y,w,h,c)=>{for(let j=0;j<h;j++)for(let i=0;i<w;i++)put(im,x+i,y+j,hex(c))};

// ---- the crypt mouth: LPC's castle arch (castlewalls.png, x 22..106, y 352..448), stone mapped onto violet-grey ----
const CRYPT_RAMP=['#2e2a34','#4a4652','#5a5668','#78748a','#9a96aa','#c4c0d2']; // dark .. light (FLAT.crypt roof/wall greys, one lighter for the keystone edge)
export function cutCrypt(){
  const src=sheet('castlewalls'),X0=22,Y0=352,AW=84,AH=88,OX=6,OY=8; // 84 wide arch centred in 96
  const o=blank(96,96);
  let lo=999,hi=0;for(let y=0;y<AH;y++)for(let x=0;x<AW;x++){const p=px(src,X0+x,Y0+y);if(p[3]>=128){const l=lum(p);lo=Math.min(lo,l);hi=Math.max(hi,l)}}
  for(let y=0;y<AH;y++)for(let x=0;x<AW;x++){const p=px(src,X0+x,Y0+y);if(p[3]<128)continue;
    const t=Math.pow((lum(p)-lo)/(hi-lo||1),1.5)*.85,k=Math.min(CRYPT_RAMP.length-1,Math.round(t*(CRYPT_RAMP.length-1)));put(o,OX+x,OY+y,hex(CRYPT_RAMP[k]))}
  // the stairwell: between the jambs on every row the arch leaves clear, black going down; the arch's own inside edge stays
  const DARK=['#0a0810','#14101c','#1c1726'];
  for(let y=0;y<96;y++){let a=-1,b=-1;for(let x=0;x<96;x++)if(px(o,x,y)[3]){if(a<0)a=x;b=x}
    if(a<0)continue;for(let x=a;x<=b;x++)if(!px(o,x,y)[3])put(o,x,y,hex(y>OY+AH-22?DARK[1]:DARK[0]))}
  // the wall the arch is set in: the castle wall's plain face (castlewalls.png, the brick course at x 64..96, y 228..260, tiled) fills every clear pixel around the arch, so the
  // mouth reads as a squat stone block, not an arch standing on the grass; a dark outline and a lit top lip
  for(let y=0;y<96;y++)for(let x=0;x<96;x++)if(!px(o,x,y)[3]){const p=px(src,64+(x%32),228+(y%32));const l=p[3]?lum(p):lo+(hi-lo)*.3;
    const t=Math.pow(Math.max(0,Math.min(1,(l-lo)/(hi-lo||1))),1.5)*.85,k=Math.min(CRYPT_RAMP.length-1,Math.round(t*(CRYPT_RAMP.length-1)));put(o,x,y,hex(CRYPT_RAMP[Math.max(1,Math.min(3,k))]))}
  for(let x=0;x<96;x++){put(o,x,0,hex('#0a0810'));put(o,x,1,hex(CRYPT_RAMP[4]));put(o,x,95,hex('#0a0810'))}
  for(let y=0;y<96;y++){put(o,0,y,hex('#0a0810'));put(o,95,y,hex('#0a0810'))}
  // the block's top corners are cut back (a rough stone, not a stamped box) and its foot gets a dark ground shadow row
  for(const [cx,sx] of [[0,1],[95,-1]])for(let j=0;j<5;j++)for(let i=0;i<5-j;i++){put(o,cx+sx*i,j,[0,0,0,0])}
  for(const [cx,sx] of [[0,1],[95,-1]])for(let j=0;j<5;j++){const i=5-j;put(o,cx+sx*i,j,hex('#0a0810'))}
  // treads: four steps going down, each a lit lip over a dark riser, narrower toward the dark
  for(let i=0;i<4;i++){const y=OY+AH-26+i*6;for(let x=19+i*2;x<=76-i*2;x++)put(o,x,y,hex(['#2f5446','#264238','#1d3029','#18222a'][i]))}
  // the green glint at the keystone and two skulls beside the steps (as the procedural arch has them)
  rect(o,45,3,6,3,'#7ad0a0');rect(o,46,6,4,2,'#3e8a68');put(o,47,2,hex('#c4f0d8'));put(o,48,2,hex('#c4f0d8'));
  for(const sx of [14,76]){rect(o,sx,84,6,5,'#e8e4d8');rect(o,sx+1,89,4,2,'#c4c0b0');put(o,sx+1,85,hex('#2e2a34'));put(o,sx+4,85,hex('#2e2a34'));put(o,sx+2,87,hex('#2e2a34'))}
  return o}

// ---- the lair's nest: a scorched basin of LPC's charcoal rock (lavarock.png) in a ragged ring, ember cracks, a gold heap ----
const lcg=s=>()=>((s=(s*1664525+1013904223)>>>0)/4294967296);
export function cutLair(){
  const S=256,C=S/2,o=blank(S,S),rock=sheet('lavarock'),r=lcg(2019);
  const tiles=[[1,5],[2,5]];
  const tex=(x,y)=>{const tx=x>>5,ty=y>>5,[a,b]=tiles[(tx*7+ty*3+((tx^ty)&1))%tiles.length];return px(rock,a*32+(x&31),b*32+(y&31))};
  // ragged radius: low-frequency wobble from a few fixed sines (no RNG order dependence)
  const rad=a=>122+4*Math.sin(a*3+1)+3*Math.sin(a*7+2)+2*Math.sin(a*13);
  const inside=new Uint8Array(S*S);
  for(let y=0;y<S;y++)for(let x=0;x<S;x++){const dx=x+.5-C,dy=y+.5-C,d=Math.hypot(dx,dy),a=Math.atan2(dy,dx);
    // opening west: the rim is left open on the left for a 60 px wide mouth
    const mouth=dx<0&&Math.abs(dy)<22;
    if(d<=rad(a)||(mouth&&d<=rad(a)+14)){inside[y*S+x]=1;const p=tex(x,y);if(p[3]>=128)put(o,x,y,[p[0],p[1],p[2],255]);else put(o,x,y,[38,36,44,255])}}
  // rim: boulders. LPC's small stones (rock.png) would need recolouring; draw the ragged edge as dark stone with a light top lip
  const edge=(x,y)=>inside[y*S+x]&&(x<=0||y<=0||x>=S-1||y>=S-1||!inside[y*S+x-1]||!inside[y*S+x+1]||!inside[(y-1)*S+x]||!inside[(y+1)*S+x]);
  const ring=[];for(let y=1;y<S-1;y++)for(let x=1;x<S-1;x++)if(edge(x,y))ring.push([x,y]);
  for(const [x,y] of ring){put(o,x,y,hex('#100c16'))}
  // inner dark lip then lighter boulders along the north and east so the light is from the top left everywhere
  for(const [x,y] of ring){const dx=x-C,dy=y-C;if(dx<0&&Math.abs(dy)<26)continue;
    for(let k=1;k<=3;k++){const px_=x-Math.sign(dx)*Math.round(k*Math.abs(dx)/Math.hypot(dx,dy)),py_=y-Math.sign(dy)*Math.round(k*Math.abs(dy)/Math.hypot(dx,dy));
      if(px(o,px_,py_)[3]&&inside[py_*S+px_]&&!(px_<0)){const lit=(dx<0||dy<0)?['#7a706c','#5a504c','#443c3a']:['#443c3a','#34302e','#262224'];put(o,px_,py_,hex(lit[k-1]))}}}
  // ember cracks: random walks from near the centre outwards, orange with a hot core
  for(let n=0;n<7;n++){let x=C+(r()-.5)*40,y=C+(r()-.5)*40,a=r()*6.28;
    for(let i=0;i<46+(r()*30|0);i++){a+=(r()-.5)*1.1;x+=Math.cos(a)*2;y+=Math.sin(a)*2;const X=Math.round(x),Y=Math.round(y);
      if(Math.hypot(X-C,Y-C)>104)break;if(Math.abs(X-C)<22&&Math.abs(Y-C)<14)continue;
      if(px(o,X,Y)[3]){put(o,X,Y,hex('#c8401a'));put(o,X+1,Y,hex('#c8401a'));put(o,X,Y+1,hex('#8a2a14'));put(o,X+1,Y+1,hex('#8a2a14'));if(i%3===0)put(o,X,Y,hex('#ffb040'))}}}
  // the gold heap at the centre
  const HY=C+46,gold=['#7a5a10','#c89a20','#f2c14e','#ffe58a'];
  for(let y=-11;y<=9;y++)for(let x=-18;x<=18;x++){const e=(x*x)/324+((y+1)*(y+1))/110;if(e>1)continue;
    const edgeBand=e>.8,hi=(x+y<-6&&e<.6);put(o,C+x,HY+y,hex(edgeBand?gold[0]:hi?gold[3]:((x*3+y*5)&3)===0?gold[2]:gold[1]))}
  for(let x=-19;x<=19;x++)for(let y=-12;y<=10;y++){const e=(x*x)/361+((y+1)*(y+1))/132;if(e>1&&e<1.18&&px(o,C+x,HY+y)[3])put(o,C+x,HY+y,hex('#100c16'))}
  return o}

export const ENTRIES={
  'landmark:crypt-mouth':{cut:cutCrypt,file:'crypt-mouth.png',w:96,h:96,authors:['Daniel Armstrong (HughSpectrum)']},
  'landmark:lair':{cut:cutLair,file:'lair.png',w:256,h:256,authors:['Leana Zimmerman (Sharm)']}};

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const out=flag('out')||path.join(ROOT,'assets','landmark','32');fs.mkdirSync(out,{recursive:true});
  const idx=argv.includes('--index')?JSON.parse(fs.readFileSync(path.join(ROOT,'assets','index.json'),'utf8')):null;
  for(const [id,e] of Object.entries(ENTRIES)){const im=e.cut(),buf=Buffer.from(encodePng(im));fs.writeFileSync(path.join(out,e.file),buf);console.log('wrote',e.file,im.w+'x'+im.h);
    if(idx)idx.assets[id+'@32']={id,kind:'landmark',file:'landmark/32/'+e.file,w:im.w,h:im.h,sha256:sha256(buf),tier:32,source:'lpc-base',license:'CC-BY-SA 3.0',authors:e.authors,accepted:'2026-11-04'}}
  if(idx)fs.writeFileSync(path.join(ROOT,'assets','index.json'),JSON.stringify(idx,null,2)+'\n')}
