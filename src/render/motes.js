// Small things in the air (#979): a fixed set of motes that drift through the view and wrap round it. Where a mote is decides what it is: leaves in the green lands by day,
// fireflies there from dusk, insects over the fen, embers and ash over ash ground, snow over the tundra. No state: a mote's place is a function of the clock and a hash, so nothing
// is kept and nothing allocates. Biomes come from the zone table, never a named place. Close views only. drawMotes(ctx,0) goes under the light, what shines (1) over it.
import {W,H,TREE} from '../world/tiles.js';
import {tiles,I,zone} from '../world/map.js';
import {hash} from '../core/rng.js';
import {U as T} from './tile.js';
import {F} from './life.js';
import {G} from './grade.js';
import {biomeOfZone} from './palette.js';

const N=150,SEED=new Float32Array(N*4);for(let i=0;i<N;i++)for(let k=0;k<4;k++)SEED[i*4+k]=hash(i,k,901);
const LEAF=['#c8a03a','#a8802e','#8fae3e','#b86a2a'],mod=(v,m)=>((v%m)+m)%m;
const dusk=h=>h>=19||h<4.6;
export function drawMotes(ctx,lit){if(F.tpx<30)return;const t=F.now,vw=F.x1-F.x0,vh=F.y1-F.y0,h=G.hour,fly=dusk(h);
  for(let i=0;i<N;i++){const a=SEED[i*4],b=SEED[i*4+1],c=SEED[i*4+2],d=SEED[i*4+3];
    // where it would be if it were still; what the ground is there says how it moves
    const bx=F.x0+a*vw,by=F.y0+b*vh,tx=bx|0,ty=by|0;if(tx<0||ty<0||tx>=W||ty>=H)continue;const bio=biomeOfZone(zone[I(tx,ty)]);
    if(bio==='ash'){const ember=i%3===0;if(ember!==!!lit)continue;const u=mod(t*(ember?.16:.1)+d,1);
      const x=F.x0+mod(a*vw+t*(ember?.5:.9)+Math.sin(t*.9+c*6)*.5,vw),y=F.y0+mod(b*vh+(ember?-1:1)*t*(ember?1.3:.5),vh);
      if(ember){const f=.5+.5*Math.sin(t*3+c*9);ctx.fillStyle=f>.5?'#ffd27a':'#ff7a2c';ctx.globalAlpha=(1-u)*.9;ctx.fillRect(Math.round(x*T),Math.round(y*T),1.5,1.5)}
      else{ctx.fillStyle=c>.5?'#3a3230':'#8a827c';ctx.globalAlpha=.55;ctx.fillRect(Math.round(x*T),Math.round(y*T),1.5,1)}}
    else if(bio==='tundra'){if(lit)continue;const x=F.x0+mod(a*vw+t*.35+Math.sin(t*.8+c*7)*.45,vw),y=F.y0+mod(b*vh+t*(.6+c*.5),vh);ctx.fillStyle='#f4f8ff';ctx.globalAlpha=.8;ctx.fillRect(Math.round(x*T),Math.round(y*T),c>.8?2:1,c>.8?2:1)}
    else if(fly&&i%2===0){if(!lit)continue;const x=bx+Math.sin(t*.5+c*9)*1.4+Math.sin(t*1.3+d*7)*.4,y=by+Math.cos(t*.43+d*9)*1+Math.sin(t*1.7+c*5)*.3,on=Math.sin(t*(1+c)+d*12);if(on<.15)continue;
      const k=on*Math.min(1,G.dk/.3);ctx.fillStyle='#d8ff7a';const X=Math.round(x*T),Y=Math.round(y*T);ctx.globalAlpha=k*.3;ctx.fillRect(X-1,Y,3.5,1.5);ctx.fillRect(X,Y-1,1.5,3.5);ctx.globalAlpha=k;ctx.fillRect(X,Y,1.5,1.5)}
    else if(bio==='fen'){if(lit||fly||i%4===1)continue;const cx=bx+Math.sin(t*.2+c*9)*.8,cy=by+Math.cos(t*.17+d*9)*.5; // a little cloud of gnats
      ctx.fillStyle='#1c1e14';ctx.globalAlpha=.75;for(let k=0;k<5;k++){const q=t*(3+k*.7)+k*2.1;ctx.fillRect(Math.round((cx+Math.sin(q)*.3)*T),Math.round((cy+Math.cos(q*1.2)*.2)*T),1,1)}}
    else if(i%3===0){if(lit||fly)continue;const u=mod(t*.07+d,1); // a leaf comes off near trees, turning as it falls
      if(!nearTree(tx,ty))continue;const x=F.x0+mod(a*vw+t*.8+Math.sin(t*1.1+c*7)*.5,vw),y=F.y0+mod(b*vh+t*.4,vh),f=Math.sin(t*3+c*9);ctx.fillStyle=LEAF[(c*4)|0];ctx.globalAlpha=Math.min(1,u*5,(1-u)*5)*.9;ctx.fillRect(Math.round(x*T),Math.round(y*T),f>0?2:1,f>0?1:2)}}
  ctx.globalAlpha=1}
const nearTree=(x,y)=>{for(let j=-2;j<=2;j++)for(let i=-2;i<=2;i++){const X=x+i,Y=y+j;if(X>=0&&Y>=0&&X<W&&Y<H&&tiles[I(X,Y)]===TREE)return true}return false};
