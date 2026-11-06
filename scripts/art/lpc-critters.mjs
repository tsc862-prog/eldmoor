// Critter sheets for render/critters.js, cut from LPC-compatible animal sets (epic #830).
//
//   node scripts/art/lpc-critters.mjs [--out DIR] [--only cat,dog] [--index] [--credits-md FILE]
//
// Reads, as plain images only, the sets `npm run art:packs` fetched into assets/packs/<set>/ (nothing from them is run), and cuts
// three frames (stand, step, other step) for each of the four directions into one sheet per kind and palette variant, 3 columns by 4
// rows (down, left, right, up) as `sheetFrame` reads them: sprite:critter-<kind>-<variant>, and the flying frames of a bird as
// sprite:critter-<kind>-<variant>-fly. The choices are in scripts/art/lpc-critters.json. Nothing is scaled: a frame is cut at its
// set's own pixels, so a critter keeps its proportions beside the 32x48 heroes. Each direction stands on the frame's bottom row with its
// three frames' union centred, which keeps the walk's own bob. The licence gate is the set's own line in the config: CC-BY-SA 3.0,
// OGA-BY 3.0 or CC0, else the script stops. Index entries carry source, license, kind, variant and the set's link.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodePng,encodePng} from './png.mjs';
import {sha256,fileOf} from './lib.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
const PACKS=process.env.ELDMOOR_PACKS||path.join(ROOT,'assets','packs');
export const CONFIG=path.join(ROOT,'scripts','art','lpc-critters.json');
const LICENCES=['CC-BY-SA 3.0','OGA-BY 3.0','CC0'];
const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const hex=(r,g,b)=>'#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');

// The first image of a GIF, as RGBA (one set is a GIF sheet). A file is only ever read as pixels; the transparent index reads as clear.
export function decodeGif(b){
  if(b.toString('latin1',0,3)!=='GIF')throw new Error('not a GIF');
  const W=b.readUInt16LE(6),H=b.readUInt16LE(8),fl=b[10];let p=13,gct=null,trans=-1;
  if(fl&128){const n=2<<(fl&7);gct=b.subarray(p,p+n*3);p+=n*3}
  const data=new Uint8Array(W*H*4);
  for(;;){const c=b[p++];
    if(c===0x21){const l=b[p++];if(l===0xf9&&b[p+1]&1)trans=b[p+4];while(b[p])p+=b[p]+1;p++;continue}
    if(c!==0x2c)throw new Error('GIF has no image');
    const x0=b.readUInt16LE(p),y0=b.readUInt16LE(p+2),w=b.readUInt16LE(p+4),h=b.readUInt16LE(p+6),f=b[p+8];p+=9;
    if(f&64)throw new Error('interlaced GIF');
    let ct=gct;if(f&128){const n=2<<(f&7);ct=b.subarray(p,p+n*3);p+=n*3}
    const mcs=b[p++],parts=[];while(b[p]){parts.push(b.subarray(p+1,p+1+b[p]));p+=b[p]+1}
    const s=Buffer.concat(parts),out=[],clear=1<<mcs,eoi=clear+1;let size,dict,prev,bits=0,nb=0,i=0;
    const reset=()=>{dict=[];for(let k=0;k<clear;k++)dict[k]=[k];dict[clear]=dict[eoi]=[];size=mcs+1;prev=null};reset();
    for(;;){while(nb<size&&i<s.length){bits|=s[i++]<<nb;nb+=8}if(nb<size)break;
      const code=bits&((1<<size)-1);bits>>>=size;nb-=size;
      if(code===clear){reset();continue}if(code===eoi)break;
      const e=code<dict.length?dict[code]:[...prev,prev[0]];for(const v of e)out.push(v);
      if(prev)dict.push([...prev,e[0]]);prev=e;if(dict.length===1<<size&&size<12)size++}
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const v=out[y*w+x],o=((y0+y)*W+x0+x)*4;if(v===undefined||v===trans)continue;data[o]=ct[v*3];data[o+1]=ct[v*3+1];data[o+2]=ct[v*3+2];data[o+3]=255}
    return {w:W,h:H,data}}}

const imgs=new Map();
function load(p,key){const k=p+(key||'');if(imgs.has(k))return imgs.get(k);
  const buf=fs.readFileSync(p),im=/\.gif$/i.test(p)?decodeGif(buf):decodePng(buf);
  if(key){const [r,g,b]=rgb(key);for(let i=0;i<im.w*im.h;i++){const o=i*4;if(im.data[o]===r&&im.data[o+1]===g&&im.data[o+2]===b)im.data[o+3]=0}}
  imgs.set(k,im);return im}

// One frame as {w, h, data}: the cell at source row r, column c, mirrored on request, with the variant's colours.
function cell(im,K,V,r,c,flip){const [w,h]=K.cell,x0=K.xs?K.xs[c]:(c+(V.dc||0))*w,y0=K.ys?K.ys[r]:r*h,d=new Uint8Array(w*h*4);
  const tone=V.tone&&rgb(V.tone),map=V.map&&Object.fromEntries(Object.entries(V.map).map(([k,v])=>[k,rgb(v)]));
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const sx=x0+(flip?w-1-x:x),sy=y0+y;if(sx>=im.w||sy>=im.h)continue;const o=(sy*im.w+sx)*4;if(im.data[o+3]<128)continue;
    let [R,G,B]=[im.data[o],im.data[o+1],im.data[o+2]];
    if(map&&map[hex(R,G,B)])[R,G,B]=map[hex(R,G,B)];
    if(tone&&Math.max(R,G,B)-Math.min(R,G,B)<26){R=Math.round(R*tone[0]/255);G=Math.round(G*tone[1]/255);B=Math.round(B*tone[2]/255)} // grey and white fur only: horns, eyes and ears keep theirs
    const q=(y*w+x)*4;d[q]=R;d[q+1]=G;d[q+2]=B;d[q+3]=255}
  return {w,h,data:d}}

// A dark line one art pixel wide round the opaque pixels, for art with none. The frame grows by a pixel each way.
function outlined(f,col){const [R,G,B]=rgb(col),w=f.w+2,h=f.h+2,d=new Uint8Array(w*h*4),op=(x,y)=>x>=0&&y>=0&&x<f.w&&y<f.h&&f.data[(y*f.w+x)*4+3]>127;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const q=(y*w+x)*4,sx=x-1,sy=y-1;
    if(op(sx,sy)){const o=(sy*f.w+sx)*4;d[q]=f.data[o];d[q+1]=f.data[o+1];d[q+2]=f.data[o+2];d[q+3]=255}
    else if(op(sx-1,sy)||op(sx+1,sy)||op(sx,sy-1)||op(sx,sy+1)){d[q]=R;d[q+1]=G;d[q+2]=B;d[q+3]=255}}
  return {w,h,data:d}}

function box(frames){let x0=1e9,y0=1e9,x1=-1,y1=-1;
  for(const f of frames)for(let y=0;y<f.h;y++)for(let x=0;x<f.w;x++)if(f.data[(y*f.w+x)*4+3]>127){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}
  if(x1<0)throw new Error('an empty frame in the config');return {x0,y0,x1,y1}}

// The sheet of one kind and variant: rows down, left, right, up. `rows` are the source rows (dirs, or the bird's fly rows).
export function sheetFor(K,V,rows,packs=PACKS){
  const im=load(path.join(packs,K.set,K.src),K.key),flip=K.flip||[];
  const dirs=rows.map((r,di)=>{const fr=K.cols.map(c=>{const f=cell(im,K,V,r,c,flip.includes(di));return K.outline?outlined(f,K.outline):f});return {fr,b:box(fr)}});
  // K.ground: every frame stands on the bottom row by itself (a set whose frames climb or drop inside their cells, the rabbit's hop); else the direction's frames move together
  const feet=(d,f)=>K.ground?box([f]).y1:d.b.y1,top=d=>K.ground?Math.min(...d.fr.map(f=>box([f]).y0-box([f]).y1)):d.b.y0-d.b.y1;
  const FW=Math.max(...dirs.map(d=>d.b.x1-d.b.x0+1))+1&~1,FH=Math.max(...dirs.map(d=>1-top(d))),W=FW*3,H=FH*4,out=new Uint8Array(W*H*4);
  dirs.forEach((d,di)=>{const bw=d.b.x1-d.b.x0+1,ox=(FW-bw)>>1;
    d.fr.forEach((f,ci)=>{const fy=feet(d,f);for(let y=d.b.y0;y<=d.b.y1;y++)for(let x=d.b.x0;x<=d.b.x1;x++){const o=(y*f.w+x)*4;if(f.data[o+3]<128)continue;
      const q=((di*FH+FH-1+y-fy)*W+ci*FW+ox+x-d.b.x0)*4;out[q]=f.data[o];out[q+1]=f.data[o+1];out[q+2]=f.data[o+2];out[q+3]=255}})});
  return {w:W,h:H,data:out}}

export const jobsOf=cfg=>Object.entries(cfg.kinds).flatMap(([kind,K])=>K.variants.flatMap((V,v)=>{const base={kind,K,V,v,set:cfg.sets[K.set]};
  return [{...base,rows:K.dirs,name:`critter-${kind}-${v}`},...(K.fly?[{...base,rows:K.fly,name:`critter-${kind}-${v}-fly`}]:[])]}));

const creditLines=(cfg,used)=>Object.entries(cfg.sets).filter(([k])=>used.has(k)).map(([k,s])=>`- ${s.title} (set \`${k}\`): ${s.authors}. Offered under ${s.offered}; used under ${s.licence}. ${s.url}`);

export function main(argv=process.argv.slice(2)){
  const o={};for(let i=0;i<argv.length;i++){const a=argv[i];if(a==='--out')o.out=argv[++i];else if(a==='--only')o.only=argv[++i].split(',');else if(a==='--index')o.index=true;else if(a==='--credits-md')o.md=argv[++i]}
  const cfg=JSON.parse(fs.readFileSync(CONFIG,'utf8')),out=o.out||path.join(ROOT,'assets','sprite','32'),made=[];
  for(const [k,s] of Object.entries(cfg.sets))if(!LICENCES.includes(s.licence))throw new Error('lpc-critters.json: set '+k+' is used under '+s.licence+'; only '+LICENCES.join(', '));
  for(const j of jobsOf(cfg)){if(o.only&&!o.only.includes(j.kind))continue;
    const sh=sheetFor(j.K,j.V,j.rows),buf=encodePng(sh),file=j.name+'.png';
    fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,file),buf);made.push({...j,sh,buf});console.log('[critters]',j.name,sh.w+'x'+sh.h)}
  if(o.md){const used=new Set(jobsOf(cfg).map(j=>j.K.set)),B='<!-- lpc-critters:begin -->',E='<!-- lpc-critters:end -->',t=fs.readFileSync(o.md,'utf8'),a=t.indexOf(B),z=t.indexOf(E);
    if(a<0||z<0)throw new Error('markers missing in '+o.md);fs.writeFileSync(o.md,t.slice(0,a+B.length)+'\n'+creditLines(cfg,used).join('\n')+'\n'+t.slice(z))}
  if(o.index&&made.length){const ip=path.join(ROOT,'assets','index.json'),idx=JSON.parse(fs.readFileSync(ip,'utf8'));
    for(const m of made){const id='sprite:'+m.name;
      idx.assets[id+'@32']={id,kind:'sprite',critter:m.kind,variant:m.v,file:fileOf(id,32),w:m.sh.w,h:m.sh.h,sha256:sha256(m.buf),tier:32,source:m.K.set,license:m.set.licence,credits:'docs/CREDITS.md#critter-sheets',link:m.set.url,accepted:new Date().toISOString().slice(0,10)}}
    idx.assets=Object.fromEntries(Object.keys(idx.assets).sort().map(k=>[k,idx.assets[k]]));fs.writeFileSync(ip,JSON.stringify(idx,null,2)+'\n')}
  return made}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
