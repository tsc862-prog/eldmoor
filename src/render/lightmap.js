// The light map (#979): every frame the world is multiplied by one small canvas (a quarter of the screen) that holds the hour's ambient, the soft dark
// under canopies and along walls, a light vignette, and every flame added back in its own colour. So a fire lights the ground and the people round it
// instead of a glow floating over a dark picture. After the multiply the flames themselves are added on top, thinly, with the lava, which glows at
// all hours. One small canvas, a handful of stamps from cached sprites (no gradient made per light), two full-screen blits.
import {W,H,LAVA,TREE,WALL,PEAK} from '../world/tiles.js';
import {tiles,I,LANDMARKS,LIGHTS,CITY} from '../world/map.js';
import {vnoise} from '../core/rng.js';
import {U as T,HEAD,PROC_SCALE} from './tile.js';
import {LIGHT} from './palette.js';
import {treeAnchor,chunkGen} from './terrain.js';
import {drawCampLight} from './camp.js';
import {lifeLight,lifeWindows} from './townlife.js';
import {G} from './grade.js';
import {FX} from './quality.js';

const NR=4; // the map is this many times coarser than the screen
const mk=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c};
const lm=mk(4,4),lx=lm.getContext('2d');
const SCENE=[255,232,196],PERSON=[255,224,186];

// A soft round stamp per colour, cached by colour.
const STAMPS=new Map();
function stamp(c){const k=c[0]<<16|c[1]<<8|c[2];let s=STAMPS.get(k);if(s)return s;s=mk(96,96);const x=s.getContext('2d'),g=x.createRadialGradient(48,48,0,48,48,48),v=c[0]+','+c[1]+','+c[2];
  g.addColorStop(0,`rgba(${v},1)`);g.addColorStop(.3,`rgba(${v},.62)`);g.addColorStop(.62,`rgba(${v},.2)`);g.addColorStop(1,`rgba(${v},0)`);x.fillStyle=g;x.fillRect(0,0,96,96);STAMPS.set(k,s);return s}
// The frame's lights, world units: filled by the sources through glow(), read twice. No allocation: the arrays stay.
const QN=320,QX=new Float32Array(QN),QY=new Float32Array(QN),QR=new Float32Array(QN),QA=new Float32Array(QN),QS=new Array(QN),QB=new Uint8Array(QN);let qn=0;
const glow=(x,y,r,c,a,flat)=>{if(qn>=QN||a<=.004)return;QX[qn]=x;QY[qn]=y;QR[qn]=r;QA[qn]=a;QS[qn]=stamp(c);QB[qn]=flat?0:1;qn++};
// Slow, uneven: a flame breathing, not a strobe.
export const flick=(seed,now)=>.86+.09*Math.sin(now*1.7+seed)+.05*Math.sin(now*4.1+seed*2.3);

// Lava: a pixel a tile, each tile's share of lava in a 7x7 window, scaled up smooth. Two variants: with and without the lair's ring, which cools with the wyrm dead.
const glowC={};
function lavaGlow(cooled){const k=cooled?1:0;if(glowC[k]!==undefined)return glowC[k];
  const lair=LANDMARKS.find(l=>l.kind==='lair'),c=mk(W,H),x=c.getContext('2d'),img=x.createImageData(W,H),d=img.data,C=LIGHT.lava;
  const lava=(tx,ty)=>tx>=0&&ty>=0&&tx<W&&ty<H&&tiles[I(tx,ty)]===LAVA&&!(cooled&&lair&&Math.hypot(tx+.5-lair.x,ty+.5-lair.y)<=lair.r+1)?1:0;let any=false;
  for(let ty=0;ty<H;ty++)for(let tx=0;tx<W;tx++){let n=0;for(let j=-3;j<=3;j++)for(let i=-3;i<=3;i++)n+=lava(tx+i,ty+j)*(Math.abs(i)<3&&Math.abs(j)<3?(i||j?1:3):.5);
    if(!n)continue;any=true;const o=(ty*W+tx)*4;d[o]=C[0];d[o+1]=C[1];d[o+2]=C[2];d[o+3]=Math.min(255,n*14)}
  x.putImageData(img,0,0);return glowC[k]=any?c:null}

// The soft dark of the land, baked once a set of terrain art at SH pixels a tile: what stands under canopies, the feet of walls, houses and
// mountains, and a slow mottling so a meadow is not one flat green. White is no change: this is multiplied in.
const SH=6;let shade=null,shadeGen=-1;
function buildShade(){shade=mk(W*SH,H*SH);const x=shade.getContext('2d'),m=mk(W*SH,H*SH),o=m.getContext('2d');
  const blob=(px,py,rx,ry,a)=>{o.fillStyle=`rgba(10,18,44,${a})`;o.beginPath();o.ellipse(px*SH,py*SH,rx*SH,ry*SH,0,0,7);o.fill()};
  let canopy=false;for(let ty=0;ty<H&&!canopy;ty++)for(let tx=0;tx<W;tx++)if(tiles[I(tx,ty)]===TREE&&treeAnchor(tx,ty)){canopy=true;break}
  for(let ty=0;ty<H;ty++)for(let tx=0;tx<W;tx++){const t=tiles[I(tx,ty)];
    if(t===TREE){const a=canopy?treeAnchor(tx,ty):null;if(a){blob(a.x,a.y-.1,1.5,.75,.34);blob(a.x+.25,a.y-1.1,1.2,1,.1)}else if(!canopy)blob(tx+.5,ty+.9,.8,.5,.3)}
    else if(t===WALL){if(ty+1<H&&tiles[I(tx,ty+1)]!==WALL){o.fillStyle='rgba(10,12,36,.34)';o.fillRect(tx*SH,(ty+1)*SH,SH,SH*.6)}}
    else if(t===PEAK&&ty+1<H&&tiles[I(tx,ty+1)]!==PEAK){o.fillStyle='rgba(10,12,36,.3)';o.fillRect(tx*SH,(ty+1)*SH,SH,SH*.8)}}
  for(const c of CITY)for(const b of c.buildings||[]){if(b.piece==='board')continue;const [bx,by,bw,bh]=b.box;o.fillStyle='rgba(10,12,36,.34)';o.fillRect((bx-.1)*SH,(by+bh)*SH,(bw+.2)*SH,SH*.7)}
  x.fillStyle='#fff';x.fillRect(0,0,W*SH,H*SH);
  // the mottling: a pixel per two tiles, smoothed by the scale
  const n=mk(W>>1,H>>1),nx=n.getContext('2d'),id=nx.createImageData(n.width,n.height);
  for(let j=0;j<n.height;j++)for(let i=0;i<n.width;i++){const v=vnoise(i/5.5,j/5.5,307)*.6+vnoise(i/2.2,j/2.2,311)*.4,q=(j*n.width+i)*4,a=Math.max(0,(v-.42)*1.6);id.data[q]=24;id.data[q+1]=44;id.data[q+2]=70;id.data[q+3]=Math.min(255,a*70)}
  nx.putImageData(id,0,0);x.imageSmoothingEnabled=true;x.drawImage(n,0,0,W*SH,H*SH);
  x.filter='blur(3px)';x.drawImage(m,0,0);x.filter='none';shadeGen=chunkGen}

// A light vignette, made for the size of the map.
let vig=null;
function vignette(w,h){if(vig&&vig.width===w&&vig.height===h)return vig;vig=mk(w,h);const x=vig.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,w,h);
  x.setTransform(w/2,0,0,h/2,w/2,h/2);const g=x.createRadialGradient(0,0,.55,0,0,1.42);g.addColorStop(0,'rgba(14,12,34,0)');g.addColorStop(.55,'rgba(14,12,34,.07)');g.addColorStop(1,'rgba(14,12,34,.34)');x.fillStyle=g;x.fillRect(-1,-1,2,2);return vig}

// Cloud shadows: a tileable sheet of soft dark patches, drifting across the land by day. Value noise baked once, multiplied into the map, so the ground, the people and the
// trees all pass under it. The sun's own strength fades it at dawn and dusk and under an overcast sky.
let sky=null,skyPat=null;
function cloudSheet(){const N=256;sky=mk(N,N);const x=sky.getContext('2d'),id=x.createImageData(N,N),f=(u,v)=>vnoise(u/60,v/60,331)*.62+vnoise(u/26,v/26,337)*.28+vnoise(u/11,v/11,347)*.1;
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){const a=i/N,b=j/N,n=(f(i,j)*(1-a)+f(i-N,j)*a)*(1-b)+(f(i,j-N)*(1-a)+f(i-N,j-N)*a)*b,q=(j*N+i)*4,t=Math.max(0,Math.min(1,(n-.5)/.13));
    id.data[q]=255-t*58;id.data[q+1]=255-t*50;id.data[q+2]=255-t*34;id.data[q+3]=255}
  x.putImageData(id,0,0);skyPat=lx.createPattern(sky,'repeat')}
function cloudShadows(k,ox,oy,w,h,now){if(!FX.full)return;const a=Math.min(1,G.sunA/.3)*(G.up?1:0);if(a<.03)return;if(!sky)cloudSheet();
  const s=k*3.4,dx=now*5.5*k,dy=now*1.6*k;lx.globalAlpha=a;lx.setTransform(s,0,0,s,ox+dx,oy+dy);lx.fillStyle=skyPat;lx.fillRect((-ox-dx)/s-1,(-oy-dy)/s-1,w/s+2,h/s+2);lx.globalAlpha=1;lx.setTransform(1,0,0,1,0,0)}

// Light the frame. o: {S, sel, sc, inView, cut}. The caller's ctx is in the world transform and is left there.
export function lightPass(ctx,cv,cam,o){const {S,sel,sc,inView,cut,seen}=o,dk=G.dk,w=Math.ceil(cv.width/NR),h=Math.ceil(cv.height/NR),now=performance.now()/1000;
  if(lm.width!==w||lm.height!==h){lm.width=w;lm.height=h}
  if(!shade||shadeGen!==chunkGen)buildShade();
  const k=sc/NR,ox=cam.offX/NR,oy=cam.offY/NR,A=G.amb,night=Math.min(1,dk/.4);
  lx.setTransform(1,0,0,1,0,0);lx.globalCompositeOperation='source-over';lx.globalAlpha=1;
  lx.fillStyle=`rgb(${A[0]|0},${A[1]|0},${A[2]|0})`;lx.fillRect(0,0,w,h);
  lx.globalCompositeOperation='multiply';lx.imageSmoothingEnabled=true;
  lx.setTransform(k,0,0,k,ox,oy);lx.drawImage(shade,0,0,W*SH,H*SH,0,0,W*T,H*T);lx.setTransform(1,0,0,1,0,0);
  lx.drawImage(vignette(w,h),0,0);
  cloudShadows(k,ox,oy,w,h,now);
  // the lights
  qn=0;
  if(dk>0){let n=0;const lit=(e,r,a,dy)=>{if(n>90)return;const x=e.x*T,y=e.y*T-dy;if(!inView(x,y,r))return;n++;glow(x,y,r,PERSON,a*night*.8,true)};
    for(const m of S.mobs){if(m.alive&&!m.hidden)lit(m,18,.3,6)}
    for(const a of S.agents){if(a.hidden||a.state==='dead')continue;if(a===sel||a.company!=null)lit(a,a===sel?56:48,.8,7);else lit(a,26,.42,7)}}
  for(const L of LIGHTS){const r=L.big?120:40;if(!inView(L.x*T,L.y*T,r))continue;const fl=flick(L.x*3.1+L.y,now);
    glow(L.x*T,L.y*T,r*(.96+.04*fl),LIGHT.torch,L.big?Math.max(dk*1.3,.2)*fl:dk*1.2*fl)}
  for(const L of LANDMARKS)if(L.kind==='crypt'&&L.mouth){const x=(L.mouth.x0+L.mouth.x1+1)/2*T,y=(L.mouth.y0+1)*T;if(inView(x,y,48))glow(x,y,36,LIGHT.crypt,dk*(.7+.15*Math.sin(now*1.3)))}
  if(dk>0){drawCampLight(glow,S,dk,inView,now);if(!cut)lifeLight(null,glow,dk,LIGHT);
    if(cut)for(const e of cut.members.concat(cut.foes)){const p=seen?seen(e):e;glow(p.x*T,p.y*T-HEAD/2,22*PROC_SCALE*.85,SCENE,dk*1.1,true)}}
  lx.globalCompositeOperation='lighter';
  const lava=lavaGlow(!S.boss.alive),pulse=.9+.1*Math.sin(now*.9);
  if(lava){lx.setTransform(k,0,0,k,ox,oy);lx.globalAlpha=Math.min(1,.25+dk*1.5)*pulse;lx.drawImage(lava,0,0,W,H,0,0,W*T,H*T);lx.setTransform(1,0,0,1,0,0)}
  for(let i=0;i<qn;i++){const r=QR[i]*k;lx.globalAlpha=Math.min(1,QA[i]*1.5);lx.drawImage(QS[i],QX[i]*k+ox-r,QY[i]*k+oy-r,r*2,r*2)}
  lx.globalAlpha=1;
  // onto the world
  ctx.setTransform(1,0,0,1,0,0);ctx.imageSmoothingEnabled=true;ctx.globalCompositeOperation='multiply';ctx.drawImage(lm,0,0,w,h,0,0,w*NR,h*NR);
  // the low sun's veil, from its side of the view
  if(G.washA>.005){const c=G.wash,v=c[0]|0,u=c[1]|0,b=c[2]|0,dx=-G.sx,dy=-G.sy,cx=cv.width/2,cy=cv.height/2,R=Math.abs(dx)*cx+Math.abs(dy)*cy;
    const g=ctx.createLinearGradient(cx+dx*R,cy+dy*R,cx-dx*R*.3,cy-dy*R*.3);g.addColorStop(0,`rgba(${v},${u},${b},${G.washA})`);g.addColorStop(1,`rgba(${v},${u},${b},${G.washA*.12})`);
    ctx.globalCompositeOperation='screen';ctx.fillStyle=g;ctx.fillRect(0,0,cv.width,cv.height)}
  // what burns: thin, on top
  ctx.setTransform(sc,0,0,sc,cam.offX,cam.offY);ctx.globalCompositeOperation='lighter';
  if(lava){ctx.globalAlpha=(.16+dk*.5)*pulse;ctx.drawImage(lava,0,0,W,H,0,0,W*T,H*T)}
  for(let i=0;i<qn;i++){if(!QB[i])continue;const r=QR[i]*.62;ctx.globalAlpha=Math.min(.6,QA[i]*.26);ctx.drawImage(QS[i],QX[i]-r,QY[i]-r,r*2,r*2)}
  ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.imageSmoothingEnabled=false;
  if(dk>0&&!cut)lifeWindows(ctx)}
