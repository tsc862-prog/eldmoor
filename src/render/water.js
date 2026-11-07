// Water that moves (#979): the river's flow, worked out once from the tiles, and what rides on it each frame. Nothing is repainted: the chunks stay as they are and
// small marks go on top, under everyone standing.
//   glints   short bright streaks that run with the current, each with its own place and phase on its tile (a hash, no state), coloured by the hour
//   foam     white flecks that swell and fade along the banks, thicker at the ford and round bridge piers
//   ripples  rings where someone wades, one every step, kept in a small ring buffer
// The flow: river tiles are numbered by their walk from the source (the end of the river nearest the map's edge at its lowest tile index), and each tile runs
// toward its next-numbered neighbours, smoothed. Any shape of river, any number of branches; a world with none costs nothing. Time is the frame clock.
import {W,H,RIVER,BRIDGE} from '../world/tiles.js';
import {tiles,I,solid} from '../world/map.js';
import {hash} from '../core/rng.js';
import {U as T} from './tile.js';
import {F} from './life.js';
import {quayOver} from './harbour.js';
import {G} from './grade.js';
import {sceneryOn,waterLevel} from './scenery.js';
import {onWorld} from '../sim/kept.js';

const isW=(x,y)=>x>=0&&y>=0&&x<W&&y<H&&(tiles[I(x,y)]===RIVER||tiles[I(x,y)]===BRIDGE);
const N8=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
const near=(x,y)=>{for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++)if(isW(x+i,y+j))return true;return false},FORD=[];
let flow=null,rows=null; // flow: per tile [dx,dy] packed; rows: per y, the river tiles of that row
function build(){const d=new Int32Array(W*H).fill(-1),fx=new Float32Array(W*H),fy=new Float32Array(W*H);rows=Array.from({length:H},()=>[]);
  // each joined stretch of water from its end tile: the water tile with fewest water neighbours, nearest the rim
  const q=[];for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(!isW(x,y)||d[y*W+x]>=0)continue;
    const part=[[x,y]];d[y*W+x]=0;for(let i=0;i<part.length;i++){const [a,b]=part[i];for(const [i2,j2] of N8){const X=a+i2,Y=b+j2;if(isW(X,Y)&&d[Y*W+X]<0){d[Y*W+X]=0;part.push([X,Y])}}}
    let s=part[0],best=1e9;for(const [a,b] of part){const rim=Math.min(a,b,W-1-a,H-1-b);if(rim<best){best=rim;s=[a,b]}}
    for(const [a,b] of part)d[b*W+a]=-2;d[s[1]*W+s[0]]=1;q.length=0;q.push(s);
    for(let i=0;i<q.length;i++){const [a,b]=q[i],n=d[b*W+a];for(const [i2,j2] of N8){const X=a+i2,Y=b+j2;if(isW(X,Y)&&d[Y*W+X]===-2){d[Y*W+X]=n+1;q.push([X,Y])}}}}
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const v=d[y*W+x];if(v<=0)continue;let sx=0,sy=0;
    for(let j=-3;j<=3;j++)for(let i=-3;i<=3;i++){const X=x+i,Y=y+j;if(!isW(X,Y)||(!i&&!j))continue;const e=d[Y*W+X]-v,l=Math.hypot(i,j);sx+=i/l*e/l;sy+=j/l*e/l}
    const l=Math.hypot(sx,sy)||1;fx[y*W+x]=sx/l;fy[y*W+x]=sy/l;if(tiles[I(x,y)]===RIVER){if(!quayOver(x,y))rows[y].push(x);if(!solid[I(x,y)])FORD.push([x,y])}}
  flow={fx,fy}}
// Bank flecks: [x,y,phase,strength] in world units, per row of tiles, built once.
let banks=null;
function buildBanks(){banks=Array.from({length:H},()=>[]);
  // a scenery world paints its water as a smooth shape: the foam follows that line, not the tiles'
  if(sceneryOn){for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(!near(x,y)||quayOver(x,y))continue;for(let k=0;k<14;k++){const u=x+hash(x*14+k,y,43),v=y+hash(x*14+k,y,47),l=waterLevel(u,v);if(l>.5&&l<.66)banks[y].push(u*T,v*T,hash(x,y*14+k,49)*6.28,.8)}}
    for(const b of FORD)for(let k=0;k<9;k++)banks[b[1]].push((b[0]+hash(b[0],b[1]*9+k,51))*T,(b[1]+hash(b[0],b[1]*9+k,53))*T,hash(k,b[0],55)*6.28,.9);return}
  for(let y=0;y<H;y++)for(const x of rows[y]){const ford=!solid[I(x,y)],put=(px,py,s)=>banks[y].push(px,py,hash(px|0,py|0,41)*6.28,s);
    for(const [i,j] of [[1,0],[-1,0],[0,1],[0,-1]]){const X=x+i,Y=y+j,br=X>=0&&Y>=0&&X<W&&Y<H&&tiles[I(X,Y)]===BRIDGE;if(isW(X,Y)&&!br)continue;
      const n=br?7:4;for(let k=0;k<n;k++){const u=hash(x*4+k,y*4+i+2,43),v=hash(x*4+k,y*4+j+2,47)*(br?3.4:2.2);
        const px=(x+.5+i*.5)*T+(j?(u-.5)*T:0)-i*v,py=(y+.5+j*.5)*T+(i?(u-.5)*T:0)-j*v;put(px,py,br?1:.75)}}
    if(ford)for(let k=0;k<9;k++)put((x+hash(x,y*9+k,51))*T,(y+hash(x,y*9+k,53))*T,.9)}}
// Wading rings.
const RN=24,RX=new Float32Array(RN),RY=new Float32Array(RN),RT=new Float32Array(RN).fill(-9),LX=new Float32Array(96),LY=new Float32Array(96);let rh=0;
function wade(){for(let i=0;i<F.n;i++){const x=F.hx[i],y=F.hy[i],tx=x|0,ty=y|0;if(tx<0||ty<0||tx>=W||ty>=H||tiles[I(tx,ty)]!==RIVER)continue;if(Math.hypot(x-LX[i],y-LY[i])<.35)continue;LX[i]=x;LY[i]=y;
    RX[rh]=x*T;RY[rh]=y*T;RT[rh]=F.now;rh=(rh+1)%RN}}
const hex=(r,g,b,a)=>`rgba(${r|0},${g|0},${b|0},${a})`;
// The colours of the hour, cached for a few seconds' worth of frames.
let glintLo='',glintHi='',foam='',colKey=-1;
function colours(){const k=(G.hour*4)|0;if(k===colKey)return;colKey=k;const w=G.washA,nt=Math.min(1,G.dk/.5),r=200+55*w*3,g=232-40*w*2,b=255-110*w*3;
  glintLo=hex(r,g,Math.max(120,b),.4);glintHi=hex(Math.min(255,r+20),Math.min(255,g+16),Math.max(150,b+10),.85-.25*nt);foam=hex(236,240,246,.72-.3*nt)}
export function drawWater(ctx){if(F.tpx<30)return;if(!flow){build();buildBanks()}colours();wade();
  const t=F.now,y0=Math.max(0,F.y0|0),y1=Math.min(H-1,Math.ceil(F.y1)),x0=F.x0,x1=F.x1,{fx,fy}=flow,sp=1.05;
  // glints: two passes of one colour each, so a frame sets fillStyle twice
  for(let pass=0;pass<2;pass++){ctx.fillStyle=pass?glintHi:glintLo;const n=pass?1:2;
    for(let y=y0;y<=y1;y++){const R=rows[y];for(let i=0;i<R.length;i++){const x=R[i];if(x<x0||x>x1)continue;const dx=fx[y*W+x],dy=fy[y*W+x];
      for(let k=0;k<n;k++){const s=x*7+k+pass*3,h1=hash(s,y,61),h2=hash(s,y,67),h3=hash(s,y,71),u=(t*sp*(.7+h3*.6)+h1*7)%1.6;if(u>1)continue;
        const cx=(x+h2)*T+dx*(u-.5)*T*1.5,cy=(y+h1)*T+dy*(u-.5)*T*1.5,L=pass?2:3;if(sceneryOn&&waterLevel(cx/T,cy/T)<.62)continue;
        ctx.fillRect(Math.round(cx),Math.round(cy),Math.abs(dx)>=Math.abs(dy)?L:1,Math.abs(dx)>=Math.abs(dy)?1:L)}}}}
  // foam, swelling and fading
  ctx.fillStyle=foam;
  for(let y=y0;y<=y1;y++){const B=banks[y];for(let i=0;i<B.length;i+=4){const px=B[i],py=B[i+1];if(px<x0*T||px>x1*T)continue;const v=Math.sin(t*1.9+B[i+2])*B[i+3];if(v<.25)continue;const q=v>.7?2:1;ctx.fillRect(Math.round(px),Math.round(py),q,1)}}
  // rings
  ctx.strokeStyle=foam;ctx.lineWidth=.8;for(let i=0;i<RN;i++){const a=t-RT[i];if(a<0||a>1.1)continue;ctx.globalAlpha=1-a/1.1;ctx.beginPath();ctx.ellipse(RX[i],RY[i],2+a*9,1+a*4,0,0,7);ctx.stroke()}ctx.globalAlpha=1}
// Another map (#1013): its own river, or none.
onWorld(()=>{flow=rows=banks=null;FORD.length=0;RT.fill(-9);LX.fill(0);LY.fill(0);rh=0});
export const warmWater=()=>{if(!flow){build();buildBanks()}};
