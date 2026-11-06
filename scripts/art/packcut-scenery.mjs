// The scenery sheet of the Wending Vale art pass (epic #940 slice E): one image, `prop:scenery`, of the small things that make the
// map's places (src/render/scenery.js): bridge decks and rails, ground bits, crops, bones, stones. Most pieces are cut 1:1 from the LPC
// base assets (bridges, hay, barrel, brick: Lanea Zimmerman; the brazier: Daniel Armstrong; CC-BY-SA 3.0) and "[LPC] Terrains" (pebbles, tufts, pools,
// flowers, CC-BY-SA 3.0, authors in its credit file), recoloured where a biome needs it; the rest (crops, bones, standing stones,
// stepping stones, stone deck) are drawn here in the same ramps. Nothing is scaled. Deterministic: no clock, no random.
//   node scripts/art/packcut-scenery.mjs [--out DIR] [--index]        (ELDMOOR_PACKS: a packs folder kept outside this checkout)
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodePng,encodePng} from './png.mjs';
import {sha256,fileOf} from './lib.mjs';
import {ATLAS,SHEET_W,SHEET_H} from '../../src/render/sceneryatlas.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
const PACKS=process.env.ELDMOOR_PACKS||path.join(ROOT,'assets','packs');
const base=n=>decodePng(fs.readFileSync(path.join(PACKS,'lpc-base','LPC Base Assets','tiles',n+'.png')));
const TERR=()=>decodePng(fs.readFileSync(path.join(PACKS,'lpc-terrains','lpc-terrains','terrain-v7.png')));
const blank=(w,h)=>({w,h,data:new Uint8Array(w*h*4)});
const get=(im,x,y)=>{if(x<0||y<0||x>=im.w||y>=im.h)return [0,0,0,0];const o=(y*im.w+x)*4;return [im.data[o],im.data[o+1],im.data[o+2],im.data[o+3]]};
const put=(im,x,y,p)=>{if(x<0||y<0||x>=im.w||y>=im.h)return;const o=(y*im.w+x)*4;im.data[o]=p[0];im.data[o+1]=p[1];im.data[o+2]=p[2];im.data[o+3]=p[3]};
const sub=(im,x,y,w,h)=>{const o=blank(w,h);for(let j=0;j<h;j++)for(let i=0;i<w;i++)put(o,i,j,get(im,x+i,y+j));return o};
const hex=s=>[parseInt(s.slice(1,3),16),parseInt(s.slice(3,5),16),parseInt(s.slice(5,7),16),255];
const stamp=(d,s,ox,oy)=>{for(let j=0;j<s.h;j++)for(let i=0;i<s.w;i++){const p=get(s,i,j);if(p[3]>=128)put(d,ox+i,oy+j,[p[0],p[1],p[2],255])}};
const map=(im,f)=>{const o=blank(im.w,im.h);for(let j=0;j<im.h;j++)for(let i=0;i<im.w;i++){const p=get(im,i,j);if(p[3]>=128)put(o,i,j,f(p,i,j))}return o};
// a fixed hash, so hand-drawn texture is the same on every run
const hs=(x,y,s)=>{let h=(x*374761393+y*668265263+s*2147483647)|0;h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296};
const lum=p=>(p[0]*.3+p[1]*.59+p[2]*.11)/255;
const ramp=cols=>{const c=cols.map(hex);return p=>c[Math.min(c.length-1,Math.floor(lum(p)*c.length*1.25))]};
// Key a solid ground colour out of a block: the most common colours go, what stands on them stays.
function keyOut(im,n,tol){const cnt=new Map();for(let j=0;j<im.h;j++)for(let i=0;i<im.w;i++){const p=get(im,i,j),k=p.slice(0,3).join();cnt.set(k,(cnt.get(k)||0)+1)}
  const bg=[...cnt.entries()].sort((a,b)=>b[1]-a[1]).slice(0,n).map(e=>e[0].split(',').map(Number));
  return map(im,p=>bg.some(b=>Math.abs(b[0]-p[0])+Math.abs(b[1]-p[1])+Math.abs(b[2]-p[2])<tol)?[0,0,0,0]:p)}
const rows=(lines,pal)=>{const o=blank(lines[0].length,lines.length);lines.forEach((l,y)=>[...l].forEach((c,x)=>{if(pal[c])put(o,x,y,hex(pal[c]))}));return o};

function pieces(){const out={},T=TERR(),B=base('bridges'),L=base('castle_lightsources'),D=base('dungeon'),BA=base('barrel'),TR=base('trunk');
  // ground bits: columns of the terrain sheet's bits strip (a big cluster over a small one)
  const cell=(c,y,h)=>sub(T,c*32,y,32,h);
  [['pebTan',0],['pebWhite',3],['pebGrey',4],['pebDark',6]].forEach(([n,c])=>{out[n]=cell(c,1696,32);out[n+'S']=cell(c,1730,24)});
  [['tuftG',9],['tuftL',10],['tuftD',11],['tuftB',12]].forEach(([n,c])=>{out[n]=cell(c,1696,32);out[n+'S']=sub(T,c*32+8,1736,16,16)});
  out.blades=keyOut(sub(T,160,1216,32,32),2,24);
  // a loose drift of blooms on stems, in the size of LPC's own flowers: a plus of petals round a bright eye
  const drift=(hi,lo,eye)=>{const o=blank(48,32),pal={a:hi,b:lo,e:eye,g:'#2a6a2e',l:'#4fa040'},bloom=rows(['.aa..','abba.','aeeab','.abbb','..bb.'],pal),stem=rows(['g.','g.','gl','g.'],pal);
    for(const [x,y] of [[3,3],[17,1],[33,4],[9,14],[24,12],[40,15],[2,23],[17,24],[31,23]]){stamp(o,stem,x+2,y+5);stamp(o,bloom,x,y)}return o};
  out.flRed=drift('#e8404a','#a82838','#f4d860');out.flGold=drift('#f7dc5a','#d8a632','#b86a20');out.flWhite=drift('#f5f4ec','#c9cbd8','#e8c84a');out.flBlue=drift('#a8b8f4','#6878d0','#f4e8a0');
  out.pool=sub(T,96,1760,32,32);out.tarPool=sub(T,160,1760,32,32);
  // bridge: the straight plank deck and its side rail, the capped post; a charred recolour for the ash country
  out.deck=sub(B,0,96,32,32);out.rail=sub(B,32,80,6,32);out.post=sub(B,64,64,8,20);
  const char=ramp(['#1c1716','#2c2422','#3e3431','#544743','#6b5b54']);
  out.deckChar=map(out.deck,char);out.railChar=map(out.rail,char);out.postChar=map(out.post,char);
  // stone deck, parapet and pier cap: dressed courses, drawn
  {const S=['#5d5a63','#79767f','#97949a','#b4b0b2'],d=blank(32,32);
    for(let y=0;y<32;y++)for(let x=0;x<32;x++){const row=y>>3,off=row&1?8:0,seam=y%8===7||(x+off)%16===15,h=hs((x+off)>>4,row,5),n=hs(x,y,6);
      put(d,x,y,hex(seam?S[0]:y%8===0||(x+off)%16===0?S[3]:S[h>.5?2:1]));if(!seam&&n>.94)put(d,x,y,hex(S[1]))}
    out.deckStone=d;const r=blank(6,32);for(let y=0;y<32;y++)for(let x=0;x<6;x++)put(r,x,y,hex(y%16===15?S[0]:x===0?S[3]:x>=4?S[0]:S[2]));out.railStone=r;
    const p=blank(10,16);for(let y=0;y<16;y++)for(let x=0;x<10;x++)put(p,x,y,hex(y<2?S[3]:y===15||x===9?S[0]:x===0?S[3]:S[2]));out.postStone=p}
  // light, stores
  out.torch=sub(L,72,0,16,60);{const h=sub(D,362,150,44,30);out.hay=map(h,(p,x,y)=>{const u=(x-21.5)/21,v=(y-20)/20;return u*u+v*v>1||y>28?[0,0,0,0]:p})}out.barrel=sub(BA,0,0,24,32);
  // stumps: the foot of the LPC trunk with its root flare; charred for the burnt country
  {const pal={k:'#2a1c12',r:'#b98a5a',R:'#8f6236',b:'#6a4426',d:'#4a3020'},st=rows(['.....kkkkkkkkk.....','....krrRRRrrRrk....','....krRrrrrRrrk....','....kRrRRRrRrbk....','....kbrrrrrrbdk....','....kbbbbbbbbdk....','...kkbbdbbbdbdkk...','..kbbbbdbbbdbbddk..','.kkkkkkkkkkkkkkkk..'],pal);out.stump=st;out.stumpChar=map(st,char)}
  // crate, bones, stones: drawn in LPC's ramps (light from the top left, dark outline)
  {const o=blank(28,28),W=['#3a2415','#6a4426','#8f6236','#b3854f'];for(let y=0;y<28;y++)for(let x=0;x<28;x++){const e=x===0||y===0||x===27||y===27;
      const band=y<4||y>23||x<4||x>23;put(o,x,y,hex(e?W[0]:band?(x+y<16?W[3]:W[2]):(y%6===0?W[0]:W[1])))}out.crate=o}
  const BN={k:'#2a2420',s:'#a89c88',w:'#e4dcc8',d:'#6e6456'};
  out.skull=rows(['...kkkkk...','..kwwwwwk..','.kwwwwwwsk.','.kwwwwwwsk.','.kwkkwkksk.','.kwkkwkksk.','.kwwwswwsk.','..ksssssk..','..kwkwksk..','...kkkkk...'],BN);
  out.femur=rows(['.kk.........kk..','kwwk.......kwwk.','kwwwkkkkkkkwwssk','kswwwwwwwwwwwssk','.ksssssssssssdk.','..kk.......kk...'],BN);
  {const o=blank(48,28);for(let i=0;i<6;i++){const cx=4+i*8,hgt=14+Math.round(9*Math.sin((i+.5)/6*Math.PI));for(let t=0;t<=hgt;t++){const x=cx+Math.round(6*Math.sin(t/hgt*2.2)),y=27-t;
        put(o,x-1,y,hex(BN.k));put(o,x,y,hex(t>hgt*.6?BN.w:BN.s));put(o,x+1,y,hex(BN.s));put(o,x+2,y,hex(BN.k))}}
    for(let x=2;x<46;x++){put(o,x,26,hex(BN.d));put(o,x,27,hex(BN.k));if(x%5===0)put(o,x,25,hex(BN.w))}out.ribs=o}
  {const o=blank(12,26);for(let y=8;y<26;y++){put(o,5,y,hex('#4a3524'));put(o,6,y,hex('#2e2016'))}stamp(o,out.skull,0,0);out.stake=o}
  const stone=(w,h,lean,S)=>{const o=blank(w,h);for(let y=0;y<h;y++){const t=y/h,sl=Math.round(lean*(1-t)),hw=(w/2-1)*Math.min(1,.55+t*.9+.15*Math.sin(y*.9));for(let x=0;x<w;x++){const dx=x-w/2+.5-sl;if(Math.abs(dx)>hw)continue;
        const e=Math.abs(dx)>hw-1||y===h-1,n=hs(x,y,9),c=e?S[0]:dx<-hw*.3?S[3]:dx>hw*.35?S[1]:S[2];put(o,x,y,hex(n>.9&&!e?S[1]:c))}}return o};
  const GS=['#36323a','#5e5a62','#807b80','#a8a2a2'];out.stone1=stone(14,26,1,GS);out.stone2=stone(16,30,-1,GS);out.stone3=stone(18,20,2,GS);
  {const o=blank(28,26);for(const [dx,dy,w,h] of [[0,14,14,12],[13,15,15,11],[6,6,15,12],[10,0,9,8]])stamp(o,stone(w,h,0,GS),dx,dy);out.cairn=o}
  // crops: a tile of each, seamless along a furrow row
  {const P=['#3f2c1b','#5a3f27','#73522f','#8a6a3e'],pl=blank(32,32);for(let y=0;y<32;y++)for(let x=0;x<32;x++){const f=y%8,n=hs(x>>1,y,3);put(pl,x,y,hex(f===0?P[0]:f===1?P[1]:f<5?P[n>.8?3:2]:P[n>.7?2:1]))}out.plough=pl;
    const ca=blank(32,32);stamp(ca,pl,0,0);for(const [x,y] of [[0,0],[16,0],[8,8],[24,8],[0,16],[16,16],[8,24],[24,24]])stamp(ca,out.tuftLS,x,y);out.cabbage=ca;
    const Wt=['#7d5a22','#b98a2e','#deb948','#f4dc7a'],wh=blank(32,32);stamp(wh,pl,0,0);for(let x=0;x<32;x++)for(let r=0;r<4;r++){const top=r*8+Math.floor(hs(x,r,4)*3)-3,len=7+Math.floor(hs(x,r,7)*3);
        for(let t=0;t<len;t++){const y=top+t;if(y<0||y>=32)continue;put(wh,x,y,hex(t<2?Wt[3]:t===len-1?Wt[0]:(x&1?Wt[2]:Wt[1])))}}out.wheat=wh;
    out.scarecrow=rows(['........kkkk........','.......khhhhk.......','.......kfffk........','.......kfkfk........','..kk...kfffk...kk...','.ksskkkkccckkkkssk..','.kssssccccccssssk...','..kkkkkccccckkkk....','.......kcsck........','.......kcsck........','.......kcsck........','........kpk.........','........kpk.........','........kpk.........','........kpk.........','........kpk.........','........kpk.........','........kpk.........','........kpk.........','........kpk.........'],{k:'#2a1c12',h:'#8a6a3e',f:'#d8c28a',c:'#7a3a2a',s:'#a85a38',p:'#5a3f27'})}
  // ruined brick, flagstones, stepping stones, lily pads, ice floes
  {const b=sub(D,226,28,40,26);out.brick=map(b,(p,x,y)=>y<Math.floor(hs(x>>2,1,12)*12)+(x>30?5:0)?[0,0,0,0]:y===25?hex('#1a0f0c'):p)}
  {const S=['#4a4750','#6a6770','#858289','#a29ea2'],d=blank(32,32);const cells=[[0,0,14,10],[14,0,18,12],[0,10,10,12],[10,12,12,10],[22,12,10,12],[0,22,16,10],[16,22,16,10]];
    for(const [cx,cy,w,h] of cells){const v=hs(cx,cy,2);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const X=cx+x,Y=cy+y,e=x===w-1||y===h-1,l=x===0||y===0;if(X<32&&Y<32)put(d,X,Y,hex(e?S[0]:l?S[3]:S[v>.5?2:1]))}}out.flag=d}
  const flatStone=(w,h)=>{const o=blank(w,h),a=w/2-.5,b=h/2-.5,S=['#2c3a40','#5a6468','#7f898a','#a9b0ae'];for(let y=0;y<h;y++)for(let x=0;x<w;x++){const u=(x-a)/a,v=(y-b)/b,d=u*u+v*v;if(d>1)continue;
      put(o,x,y,hex(d>.72&&(v>0||u>0)?S[0]:u+v<-.5?S[3]:v>.45?S[1]:S[2]))}return o};
  out.stepA=flatStone(16,12);out.stepB=flatStone(20,12);
  out.lily=rows(['..gggggg..','.gLLLLLdg.','gLLLLLLLdg','gLLLwLLLdg','gLLLLLddg.','.gLLdddg..','..gggg....','..........'],{g:'#1f5a3a',L:'#4f9a4e',d:'#2f7a44',w:'#f4e8f0'});
  {const o=blank(20,12),a=9.5,b=5.5;for(let y=0;y<12;y++)for(let x=0;x<20;x++){const u=(x-a)/a,v=(y-b)/b,d=u*u+v*v+hs(x>>1,y>>1,8)*.3;if(d>1)continue;put(o,x,y,hex(d>.75?'#9fc4d8':u+v<-.2?'#ffffff':'#dcecf4'))}out.floe=o}
  return out}

export function sheet(){const P=pieces(),im=blank(SHEET_W,SHEET_H);
  for(const [n,[x,y,w,h]] of Object.entries(ATLAS)){const s=P[n];if(!s)throw new Error('no piece '+n);for(let j=0;j<Math.min(h,s.h);j++)for(let i=0;i<Math.min(w,s.w);i++){const p=get(s,i,j);if(p[3]>=128)put(im,x+i,y+j,[p[0],p[1],p[2],255])}}
  return im}
function main(){const a=process.argv.slice(2),o=a.includes('--out')?a[a.indexOf('--out')+1]:path.join(ROOT,'assets'),id='prop:scenery',file=fileOf(id,32),im=sheet(),buf=encodePng(im);
  fs.mkdirSync(path.dirname(path.join(o,file)),{recursive:true});fs.writeFileSync(path.join(o,file),buf);console.log('[cut]',id,'->',path.join(o,file),im.w+'x'+im.h);
  if(a.includes('--index')){const ip=path.join(ROOT,'assets','index.json'),idx=JSON.parse(fs.readFileSync(ip,'utf8'));
    idx.assets[id+'@32']={id,kind:'prop',file,w:im.w,h:im.h,sha256:sha256(buf),tier:32,source:'lpc-terrains',license:'CC-BY-SA 3.0',authors:['Lanea Zimmerman (Sharm)','Daniel Armstrong (HughSpectrum)','bluecarrot16','Daniel Eddeland (Daneeklu)','Richard Kettering (Jetrel)','Zachariah Husiar (Zabin)'],url:'https://opengameart.org/content/lpc-terrains',accepted:idx.assets[id+'@32']?.accepted||'2026-11-05'};
    fs.writeFileSync(ip,JSON.stringify(idx,null,2)+'\n')}}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
