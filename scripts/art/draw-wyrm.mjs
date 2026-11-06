// Kragmaw the Cinder Wyrm as a sheet (#979): drawn here in code, no pack and no model, because no free LPC set has a wyrm. A body of tapered limbs along splines, each
// shaded as a round form lit from the top left, scale rows with embers in the cracks, one dark outline per part, painted back to front. Writes
// assets/sprite/32/boss-kragmaw.png (3 frames by 4 facings, as sheetFrame reads a sheet: wings up, level, down) and its index entry with --index.
//
//   node scripts/art/draw-wyrm.mjs [--out FILE] [--index]
// The procedural sprite (sprites.js SPR.boss) stays the fallback.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {encodePng} from './png.mjs';
import {sha256} from './lib.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
const FW=176,FH=152;
const rgb=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
const hsh=(x,y,s=0)=>{let h=(x*374761393+y*668265263+s*2147483647)|0;h=(h^(h>>>13))*1274126177|0;return ((h^(h>>>16))>>>0)/4294967296};
const SCALE=['#160c10','#221216','#34161c','#4e1a22','#742630','#a63a2e','#d86a30'].map(rgb);
const BELLY=['#5a3a2a','#8a5c3a','#b88a52','#dcb878','#f0dca8'].map(rgb);
const MEMB=['#2a0e16','#4a1420','#74202a','#a03428'].map(rgb),LINE=rgb('#120a0c'),EMBER=rgb('#ffb648'),HOT=rgb('#ffe68a');
const ramp=(R,t)=>R[Math.max(0,Math.min(R.length-1,Math.round(t*(R.length-1))))];
const blank=()=>({c:new Array(FW*FH).fill(null)});
const put=(L,x,y,v)=>{if(x>=0&&y>=0&&x<FW&&y<FH)L.c[(y|0)*FW+(x|0)]=v};
// A point along a Catmull-Rom spline through pts.
function spline(pts,n=48){const out=[];for(let s=0;s<pts.length-1;s++){const p0=pts[Math.max(0,s-1)],p1=pts[s],p2=pts[s+1],p3=pts[Math.min(pts.length-1,s+2)];
    for(let i=0;i<n;i++){const t=i/n,q=k=>.5*(2*p1[k]+(p2[k]-p0[k])*t+(2*p0[k]-5*p1[k]+4*p2[k]-p3[k])*t*t+(3*p1[k]-p0[k]-3*p2[k]+p3[k])*t*t*t);out.push([q(0),q(1),q(2)])}}
  out.push(pts[pts.length-1]);return out}
// A tapered limb: pts [x, y, radius]. Scale rows run along its length, the belly side (facing `belly`, 1 down) is plated when belly is given.
function limb(pts,{belly=0,scale=1,tone=0}={}){const L=blank(),S=spline(pts),len=[0];for(let i=1;i<S.length;i++)len[i]=len[i-1]+Math.hypot(S[i][0]-S[i-1][0],S[i][1]-S[i-1][1]);
  let x0=FW,y0=FH,x1=0,y1=0;for(const [x,y,r] of S){x0=Math.min(x0,x-r);y0=Math.min(y0,y-r);x1=Math.max(x1,x+r);y1=Math.max(y1,y+r)}
  for(let y=Math.max(0,y0|0);y<=Math.min(FH-1,y1+1);y++)for(let x=Math.max(0,x0|0);x<=Math.min(FW-1,x1+1);x++){let best=1e9,bi=-1;
    for(let i=0;i<S.length;i+=2){const d=Math.hypot(x+.5-S[i][0],y+.5-S[i][1])/Math.max(.6,S[i][2]);if(d<best){best=d;bi=i}}
    if(best>1)continue;const [cx,cy,r]=S[bi],nx=(x+.5-cx)/r,ny=(y+.5-cy)/r,nz=Math.sqrt(Math.max(0,1-nx*nx-ny*ny)),l=.06+(-.48*nx-.62*ny+.62*nz)*.8+tone;
    const along=len[bi]/5,row=Math.floor(along),across=Math.round((Math.atan2(ny,nx)*r)/5+(row&1)*.5),ph=along-row;
    if(belly&&ny*belly>.46-.1*Math.abs(nx)){const pl=Math.floor(len[bi]/6.5),edge=(len[bi]/6.5-pl)<.2;put(L,x,y,edge?ramp(BELLY,.1):ramp(BELLY,.35+l*.6));continue}
    let t=l;const seam=ph<.2||Math.abs(((Math.atan2(ny,nx)*r)/5+(row&1)*.5)-across)>.4;
    if(scale&&seam){t-=.2;if(l<.72&&hsh(row,across,3)>.72&&ph<.2){put(L,x,y,hsh(row,across,4)>.5?EMBER:ramp(SCALE,.8));continue}}
    if(scale&&!seam&&hsh(row,across,5)>.55)t+=.07;
    put(L,x,y,ramp(SCALE,t))}
  return L}
function poly(pts,paint){const L=blank();let y0=FH,y1=0;for(const p of pts){y0=Math.min(y0,p[1]);y1=Math.max(y1,p[1])}
  for(let y=Math.max(0,y0|0);y<=Math.min(FH-1,y1|0);y++){const xs=[];for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length];if((a[1]<=y+.5)!==(b[1]<=y+.5))xs.push(a[0]+(y+.5-a[1])/(b[1]-a[1])*(b[0]-a[0]))}
    xs.sort((p,q)=>p-q);for(let i=0;i+1<xs.length;i+=2)for(let x=Math.round(xs[i]);x<Math.round(xs[i+1]);x++)put(L,x,y,paint(x,y))}
  return L}
// A part laid on the frame with its outline.
function lay(F,L){for(let y=0;y<FH;y++)for(let x=0;x<FW;x++){const v=L.c[y*FW+x];if(!v)continue;
    const edge=[[1,0],[-1,0],[0,1],[0,-1]].some(([i,j])=>{const X=x+i,Y=y+j;return X<0||Y<0||X>=FW||Y>=FH||!L.c[Y*FW+X]});F.c[y*FW+x]=edge?LINE:v}}
const rot=([x,y],[cx,cy],a)=>[cx+(x-cx)*Math.cos(a)-(y-cy)*Math.sin(a),cy+(x-cx)*Math.sin(a)+(y-cy)*Math.cos(a)];
// A wing from the shoulder: arm to the wrist, four fingers, the membrane scalloped between them.
function wing(F,sh,a,dark){const R=p=>rot(p,sh,a),arm=[[sh[0],sh[1]],[sh[0]+30,sh[1]-40],[sh[0]+50,sh[1]-58]].map(R),w=arm[2],tips=[[sh[0]+96,sh[1]-40],[sh[0]+92,sh[1]-2],[sh[0]+72,sh[1]+22],[sh[0]+40,sh[1]+30]].map(R);
  const edge=[arm[0],arm[1],w];for(let i=0;i<tips.length;i++){const t=tips[i],n=i+1<tips.length?tips[i+1]:[sh[0]+10,sh[1]+24].map((v,k)=>R([sh[0]+10,sh[1]+24])[k]);edge.push(t,[(t[0]+n[0])/2+(w[0]-(t[0]+n[0])/2)*.2,(t[1]+n[1])/2+(w[1]-(t[1]+n[1])/2)*.2])}
  lay(F,poly(edge,(x,y)=>{const d=Math.hypot(x-w[0],y-w[1])/100,n=hsh(x>>2,y>>2,7);return ramp(MEMB,(dark?.1:.34)+(1-d)*.5+(n>.7?.1:0)-(n<.12?.12:0))}));
  for(const t of tips)lay(F,limb([[w[0],w[1],2.2],[(w[0]+t[0])/2,(w[1]+t[1])/2-3,1.5],[t[0],t[1],.8]],{scale:0,tone:dark?-.2:.05}));
  lay(F,limb([[arm[0][0],arm[0][1],6],[arm[1][0],arm[1][1],4],[w[0],w[1],2.6]],{scale:0,tone:dark?-.25:0}));
  lay(F,limb([[w[0],w[1],2],[w[0]-3,w[1]-6,1.2],[w[0]-8,w[1]-9,.6]],{scale:0,tone:.2}))}
function frame(a){const F=blank();
  wing(F,[78,62],a-.28,true);
  // the tail, round behind and forward along the ground
  lay(F,limb([[120,104,19],[146,114,14],[166,106,9],[168,88,5.5],[156,80,3],[146,84,1]],{belly:1}));
  for(let i=0;i<6;i++){const [x,y]=[[150,96],[163,94],[172,84],[166,76],[158,72],[147,76]][i],s=6-i*.6;lay(F,poly([[x-s,y+s*.7],[x+s*.2,y-s*1.1],[x+s,y+s*.7]],(px,py)=>ramp(SCALE,.5-(py-y)/s*.2)))}
  // the far legs
  lay(F,limb([[60,112,8],[52,126,6],[44,138,4.6]],{tone:-.28}));lay(F,limb([[112,118,10],[122,132,6.5],[114,142,4.6]],{tone:-.28}));
  // the body
  lay(F,limb([[52,92,20],[74,98,27],[100,102,27],[124,106,20]],{belly:1}));
  // spines along the back
  for(let i=0;i<7;i++){const x=56+i*11,y=73+Math.abs(i-3)*1.2+(i>4?(i-4)*3:0),s=7.5-Math.abs(i-2)*.5;lay(F,poly([[x-s,y+5],[x+s*.5,y-s*1.25],[x+s,y+5]],(px,py)=>ramp(SCALE,.75-(py-y+6)/16)))}
  // the neck and head
  lay(F,limb([[52,86,17],[42,68,13],[46,50,10.5],[42,36,9]],{belly:1}));
  for(let i=0;i<5;i++){const [x,y]=[[58,62],[56,48],[52,36],[48,28],[60,76]][i];lay(F,poly([[x-6,y+3],[x+6,y-5],[x+3,y+6]],()=>ramp(SCALE,.6)))}
  lay(F,limb([[48,22,3.8],[60,12,2.6],[74,10,.8]],{scale:0,tone:.28}));lay(F,limb([[42,20,3.2],[50,7,2.2],[62,2,.7]],{scale:0,tone:.42}));
  lay(F,limb([[42,32,10],[30,32,8.5],[17,37,6.2],[9,38,4.4]],{}));
  lay(F,limb([[36,42,5.5],[22,46,4.2],[11,47,2.6]],{tone:-.1}));
  // the mouth: the fire in it, teeth down its edge, the eye under its brow
  for(let y=41;y<=44;y++)for(let x=11;x<=33;x++)if(F.c[y*FW+x]&&(y-41)<=(x-9)/7)F.c[y*FW+x]=y<43?rgb('#ff9a34'):rgb('#c83a1c');
  for(let x=11;x<31;x+=4){F.c[41*FW+x]=rgb('#f4ead0');F.c[42*FW+x]=rgb('#f4ead0');F.c[41*FW+x+1]=rgb('#f4ead0')}
  for(const [x,y,c] of [[28,27,LINE],[29,27,LINE],[30,27,LINE],[31,27,LINE],[32,27,LINE],[29,28,HOT],[30,28,HOT],[31,28,EMBER],[30,29,EMBER],[31,29,LINE],[29,29,LINE],[12,34,LINE],[13,34,LINE]])F.c[y*FW+x]=c;
  // the near legs, claws on the rock
  lay(F,limb([[76,112,12],[68,128,8.5],[62,142,6]],{}));for(const x of [53,60,67])lay(F,limb([[x+3,142,2.6],[x,146,1.8],[x-3,149,.7]],{scale:0,tone:.5}));
  lay(F,limb([[126,110,17],[134,126,11],[122,142,6.4]],{}));for(const x of [112,119,126])lay(F,limb([[x+3,143,2.6],[x,146,1.8],[x-3,149,.7]],{scale:0,tone:.5}));
  wing(F,[84,68],a,false);
  return F}
function sheet(){const W=FW*3,H=FH*4,data=new Uint8Array(W*H*4),fr=[-.14,.02,.18].map(frame);
  for(let r=0;r<4;r++)for(let c=0;c<3;c++){const F=fr[c],flip=r===2;for(let y=0;y<FH;y++)for(let x=0;x<FW;x++){const v=F.c[y*FW+(flip?FW-1-x:x)];if(!v)continue;const o=((r*FH+y)*W+c*FW+x)*4;data[o]=v[0];data[o+1]=v[1];data[o+2]=v[2];data[o+3]=255}}
  return {w:W,h:H,data}}
function main(argv=process.argv.slice(2)){const i=argv.indexOf('--out'),file='sprite/32/boss-kragmaw.png',out=i>=0?argv[i+1]:path.join(ROOT,'assets',file),buf=encodePng(sheet());fs.writeFileSync(out,buf);console.log('[wyrm]',out,FW*3,FH*4);
  if(argv.includes('--index')){const ip=path.join(ROOT,'assets','index.json'),idx=JSON.parse(fs.readFileSync(ip,'utf8')),id='sprite:boss-kragmaw',k=id+'@32';
    idx.assets[k]={id,kind:'sprite',file,w:FW*3,h:FH*4,sha256:sha256(buf),tier:32,source:'code',license:'CC0',authors:['Eldmoor'],url:'scripts/art/draw-wyrm.mjs',accepted:idx.assets[k]?.accepted||new Date().toISOString().slice(0,10)};
    idx.assets=Object.fromEntries(Object.keys(idx.assets).sort().map(q=>[q,idx.assets[q]]));fs.writeFileSync(ip,JSON.stringify(idx,null,2)+'\n')}}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
