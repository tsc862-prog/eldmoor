// Zero-dependency PNG codec for the art pipeline (#177): decode the images a model returns and encode
// the small post-processed assets. Node only (node:zlib). Decodes non-interlaced PNGs of colour types
// 0 (grey), 2 (RGB), 3 (palette), 4 (grey+alpha) and 6 (RGBA) at bit depth 8 (16 keeps the high byte;
// palette and grey also take 1, 2 and 4). Encodes RGBA, 8 bits, filter 0. Images are {w, h, data}
// with data a Uint8Array of w*h*4 RGBA bytes.
import {inflateSync,deflateSync} from 'node:zlib';

const SIG=Buffer.from([137,80,78,71,13,10,26,10]);
const CRC=new Int32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;CRC[n]=c}
function crc32(buf){let c=-1;for(let i=0;i<buf.length;i++)c=CRC[(c^buf[i])&255]^(c>>>8);return (c^-1)>>>0}

export const isPng=b=>b&&b.length>8&&Buffer.from(b.subarray(0,8)).equals(SIG);

export function decodePng(buf){
  buf=Buffer.from(buf);
  if(!isPng(buf))throw new Error(buf[0]===0xff&&buf[1]===0xd8?'image is JPEG; the pipeline reads PNG only (ask the provider for png)':'not a PNG');
  let p=8,w=0,h=0,depth=0,ct=0,inter=0,pal=null,trns=null;const idat=[];
  while(p<buf.length){const len=buf.readUInt32BE(p),type=buf.toString('latin1',p+4,p+8),d=buf.subarray(p+8,p+8+len);p+=12+len;
    if(type==='IHDR'){w=d.readUInt32BE(0);h=d.readUInt32BE(4);depth=d[8];ct=d[9];inter=d[12]}
    else if(type==='PLTE')pal=d;else if(type==='tRNS')trns=d;else if(type==='IDAT')idat.push(d);else if(type==='IEND')break}
  if(inter)throw new Error('interlaced PNG not supported');
  const ch={0:1,2:3,3:1,4:2,6:4}[ct];if(!ch)throw new Error('PNG colour type '+ct+' not supported');
  const bpp=Math.max(1,(ch*depth)>>3),stride=Math.ceil(w*ch*depth/8);
  const raw=inflateSync(Buffer.concat(idat)),cur=new Uint8Array(stride),prev=new Uint8Array(stride);
  const out=new Uint8Array(w*h*4);
  for(let y=0;y<h;y++){const f=raw[y*(stride+1)],o=y*(stride+1)+1;
    for(let i=0;i<stride;i++){const x=raw[o+i],a=i>=bpp?cur[i-bpp]:0,b=prev[i],c=i>=bpp?prev[i-bpp]:0;let v;
      switch(f){case 0:v=x;break;case 1:v=x+a;break;case 2:v=x+b;break;case 3:v=x+((a+b)>>1);break;
        case 4:{const pp=a+b-c,pa=Math.abs(pp-a),pb=Math.abs(pp-b),pc=Math.abs(pp-c);v=x+(pa<=pb&&pa<=pc?a:pb<=pc?b:c);break}
        default:throw new Error('bad PNG filter '+f)}
      cur[i]=v&255}
    const sample=(x,k)=>{if(depth===8)return cur[x*ch+k];if(depth===16)return cur[(x*ch+k)*2];
      const bit=(x*ch+k)*depth,byte=cur[bit>>3],sh=8-depth-(bit&7);return (byte>>sh)&((1<<depth)-1)};
    for(let x=0;x<w;x++){const q=(y*w+x)*4;
      if(ct===3){const i=sample(x,0);out[q]=pal[i*3];out[q+1]=pal[i*3+1];out[q+2]=pal[i*3+2];out[q+3]=trns&&i<trns.length?trns[i]:255}
      else{const sc=depth<8?255/((1<<depth)-1):1,g=v=>Math.round(v*sc);
        if(ct===0||ct===4){const v=g(sample(x,0));out[q]=out[q+1]=out[q+2]=v;out[q+3]=ct===4?sample(x,1):255}
        else{out[q]=sample(x,0);out[q+1]=sample(x,1);out[q+2]=sample(x,2);out[q+3]=ct===6?sample(x,3):255}}}
    prev.set(cur)}
  return {w,h,data:out}}

function chunk(type,data){const b=Buffer.alloc(12+data.length);b.writeUInt32BE(data.length,0);b.write(type,4,'latin1');Buffer.from(data).copy(b,8);
  b.writeUInt32BE(crc32(b.subarray(4,8+data.length)),8+data.length);return b}

export function encodePng({w,h,data}){
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
  const raw=Buffer.alloc(h*(w*4+1));for(let y=0;y<h;y++)Buffer.from(data.buffer,data.byteOffset+y*w*4,w*4).copy(raw,y*(w*4+1)+1);
  return Buffer.concat([SIG,chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))])}

// PNG width and height from the header alone (artcheck checks sizes without decoding).
export function pngSize(buf){buf=Buffer.from(buf);if(!isPng(buf))return null;return {w:buf.readUInt32BE(16),h:buf.readUInt32BE(20)}}
