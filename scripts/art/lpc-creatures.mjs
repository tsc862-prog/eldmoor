// Creature sheets cut from OpenGameArt LPC packs (#831, epic #830).
//
//   node scripts/art/lpc-creatures.mjs [--out DIR] [--only wolf,boar] [--index] [--credits-md FILE]
//
// Reads, as plain images only, the packs fetched into assets/packs/oga-lpc-<set>/ (gitignored; the zips were extracted into new
// empty folders, nothing from them is run), cuts three walk frames for each of the four directions (config in
// scripts/art/lpc-creatures.json, chosen by eye) into one sheet per creature, 3 columns by 4 rows (down, left, right, up) as
// `sheetFrame` reads them, and recolours it to the creature's own tint by luminance (the pack's shading steps are kept: every
// distinct source colour maps to one new colour). Nothing is scaled: a pack's frame is cut at its own pixel size, so the
// creatures keep the LPC proportions beside the LPC heroes. Each direction is placed on a common baseline (the lowest foot of its
// three frames at the bottom of the frame, the union of its frames centred), which keeps the walk's own bobbing.
// Output assets/sprite/32/mob-<key>.png; --index writes the index entries (source, licence, authors) into assets/index.json.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodePng,encodePng} from './png.mjs';
import {sha256,fileOf} from './lib.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
const PACKS=path.join(ROOT,'assets','packs');
export const CONFIG=path.join(ROOT,'scripts','art','lpc-creatures.json');
const DIRS=['down','left','right','up']; // the sheet's rows (SHEET.dirs in render/tile.js)
const hexRgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const lum=(r,g,b)=>.3*r+.59*g+.11*b;
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);

export function resolve(cfg,key){let c=cfg.creatures[key];if(!c)throw new Error('no creature '+key);if(c.like){const b=resolve(cfg,c.like);c={...b,...c}}return c}

const imgs=new Map();
const load=p=>{if(!imgs.has(p))imgs.set(p,decodePng(fs.readFileSync(p)));return imgs.get(p)};

// Recolour by luminance: the source's 3rd to 97th percentile of opaque luminance spans dark -> tint -> light.
function tint(im,hex,dk,lt){
  const base=hexRgb(hex),dark=base.map(v=>v*dk),light=base.map(v=>Math.min(255,v*lt)),ls=[];
  for(let i=0;i<im.w*im.h;i++){const o=i*4;if(im.data[o+3]>=128)ls.push(lum(im.data[o],im.data[o+1],im.data[o+2]))}
  ls.sort((a,b)=>a-b);const lo=ls[Math.floor(ls.length*.03)],hi=ls[Math.floor(ls.length*.97)],span=Math.max(1,hi-lo);
  const d=new Uint8Array(im.data);
  for(let i=0;i<im.w*im.h;i++){const o=i*4;if(d[o+3]<128){d[o+3]=0;continue}
    const t=Math.max(0,Math.min(1,(lum(d[o],d[o+1],d[o+2])-lo)/span)),c=t<.5?mix(dark,base,t/.5):mix(base,light,(t-.5)/.5);
    d[o]=Math.round(c[0]);d[o+1]=Math.round(c[1]);d[o+2]=Math.round(c[2]);d[o+3]=255}
  return {w:im.w,h:im.h,data:d}}

const bbox=(im,x,y,w,h)=>{let x0=1e9,y0=1e9,x1=-1,y1=-1;
  for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){const X=x+xx,Y=y+yy;if(X>=im.w||Y>=im.h)continue;if(im.data[(Y*im.w+X)*4+3]>=128){x0=Math.min(x0,xx);x1=Math.max(x1,xx);y0=Math.min(y0,yy);y1=Math.max(y1,yy)}}
  return x1<0?null:{x0,y0,x1,y1}};

// Which source dir a sheet row reads (vertical:'side' draws down and up from the side views).
function dirFor(c,row){if(c.vertical==='side'){if(row==='down')return c.right;if(row==='up')return c.left}return c[row]}

export function cut(cfg,key){
  const c=resolve(cfg,key),set=cfg.sets[c.set];if(!set)throw new Error(key+': set '+c.set+' not in the config');
  const file=path.join(PACKS,set.dir,c.src);if(!fs.existsSync(file))throw new Error(file+' is missing (fetch the set)');
  let im=load(file);if(c.tint)im=tint(im,c.tint,c.tintDark,c.tintLight);
  const rows=DIRS.map(r=>{const d=dirFor(c,r),cells=d.cols.map(k=>({x:d.x+k*d.w,y:d.y,w:d.w,h:d.h}));
    const bs=cells.map(q=>bbox(im,q.x,q.y,q.w,q.h));if(bs.some(b=>!b))throw new Error(`${key} ${r}: an empty cell`);
    // union box in cell coordinates
    const u={x0:Math.min(...bs.map(b=>b.x0)),x1:Math.max(...bs.map(b=>b.x1)),y0:Math.min(...bs.map(b=>b.y0)),y1:Math.max(...bs.map(b=>b.y1))};
    return {cells,u}});
  const M=1; // a transparent margin, so the outline never touches the frame's edge
  let FW=Math.max(...rows.map(r=>r.u.x1-r.u.x0+1))+2*M,FH=Math.max(...rows.map(r=>r.u.y1-r.u.y0+1))+M;
  FW+=FW%2;FH+=FH%2;
  const W=FW*3,H=FH*4,out=new Uint8Array(W*H*4);
  rows.forEach((r,ri)=>{const ux=Math.floor((FW-(r.u.x1-r.u.x0+1))/2),uy=FH-M-(r.u.y1+1); // union box centred, its lowest pixel on the baseline
    r.cells.forEach((q,ci)=>{
      for(let y=0;y<q.h;y++)for(let x=0;x<q.w;x++){const sx=q.x+x,sy=q.y+y;if(sx>=im.w||sy>=im.h)continue;const so=(sy*im.w+sx)*4;if(im.data[so+3]<128)continue;
        const dx=ux+(x-r.u.x0),dy=uy+y;if(dx<0||dx>=FW||dy<0||dy>=FH)continue;const o=((ri*FH+dy)*W+ci*FW+dx)*4;
        out[o]=im.data[so];out[o+1]=im.data[so+1];out[o+2]=im.data[so+2];out[o+3]=255}})});
  return {key,c,set,FW,FH,sh:{w:W,h:H,data:out}}}

export function main(argv=process.argv.slice(2)){
  const o={};for(let i=0;i<argv.length;i++){if(argv[i]==='--out')o.out=argv[++i];else if(argv[i]==='--only')o.only=argv[++i].split(',');else if(argv[i]==='--index')o.index=true;else if(argv[i]==='--credits-md')o.md=argv[++i]}
  const cfg=JSON.parse(fs.readFileSync(CONFIG,'utf8')),out=o.out||path.join(ROOT,'assets','sprite','32'),made=[];
  fs.mkdirSync(out,{recursive:true});
  for(const key of Object.keys(cfg.creatures)){if(o.only&&!o.only.includes(key))continue;
    const m=cut(cfg,key),buf=encodePng(m.sh),id='sprite:mob-'+key;fs.writeFileSync(path.join(out,'mob-'+key+'.png'),buf);made.push({...m,id,buf});
    console.log('[creatures]',id,m.sh.w+'x'+m.sh.h,'frame',m.FW+'x'+m.FH,m.set.licence)}
  if(o.index){const ip=path.join(ROOT,'assets','index.json'),idx=JSON.parse(fs.readFileSync(ip,'utf8'));
    for(const m of made){const k=m.id+'@32';
      idx.assets[k]={id:m.id,kind:'sprite',creature:m.key,file:fileOf(m.id,32),w:m.sh.w,h:m.sh.h,sha256:sha256(m.buf),tier:32,source:'oga-lpc-'+m.c.set,license:m.set.licence,credits:'docs/CREDITS.md#lpc-creature-sheets',accepted:new Date().toISOString().slice(0,10)}}
    idx.assets=Object.fromEntries(Object.keys(idx.assets).sort().map(k=>[k,idx.assets[k]]));fs.writeFileSync(ip,JSON.stringify(idx,null,2)+'\n')}
  if(o.md){const B='<!-- lpc-creatures:begin -->',E='<!-- lpc-creatures:end -->',t=fs.readFileSync(o.md,'utf8'),a=t.indexOf(B),z=t.indexOf(E);
    if(a<0||z<0)throw new Error('markers missing in '+o.md);
    const used=new Set(made.map(m=>m.c.set)),lines=[...used].map(s=>{const S=cfg.sets[s];return `- ${S.url}: ${S.authors}. Offered under ${S.offered}; used under ${S.licence}. Cut into: ${made.filter(m=>m.c.set===s).map(m=>'`mob-'+m.key+'`').join(', ')}.`});
    fs.writeFileSync(o.md,t.slice(0,a+B.length)+'\n'+lines.join('\n')+'\n'+t.slice(z))}
  return made}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
