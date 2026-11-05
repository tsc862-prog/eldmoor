// Footprints in snow (#795): a hero walking over snow leaves a trail of prints that fills in again. A small ring of
// prints kept by the renderer (no sim state, no RNG): one every half tile an agent walks, fading over game time.
import {tiles,I} from '../world/map.js';
import {SNOW} from '../world/tiles.js';
import {S} from '../sim/state.js';
import {U as T} from './tile.js';
import {F} from './life.js';

const N=160,PX=new Float32Array(N),PY=new Float32Array(N),PT=new Float32Array(N).fill(-1e9),PS=new Int8Array(N);
let head=0;const lastAt=new Map(); // agent id -> {x,y,s}
const FADE=150; // game minutes a print lasts
export function trackSteps(agents){
  for(const a of agents){if(!a.moving||a.hidden||a.state==='dead'||a.x<F.x0||a.x>F.x1||a.y<F.y0||a.y>F.y1)continue;
    if(tiles[I(Math.floor(a.x),Math.floor(a.y))]!==SNOW)continue;
    let l=lastAt.get(a.id);if(!l){lastAt.set(a.id,{x:a.x,y:a.y,s:0});continue}
    const dx=a.x-l.x,dy=a.y-l.y;if(dx*dx+dy*dy<.3)continue;
    l.s^=1;const len=Math.hypot(dx,dy),ox=-dy/len*.12*(l.s?1:-1),oy=dx/len*.12*(l.s?1:-1);
    PX[head]=a.x+ox;PY[head]=a.y+oy;PT[head]=S.gameMin;PS[head]=dx<0?-1:1;head=(head+1)%N;l.x=a.x;l.y=a.y}}
// Prints are drawn on the ground, under everything standing.
export function drawFootprints(ctx){if(F.tpx<14)return;
  for(let i=0;i<N;i++){const age=S.gameMin-PT[i];if(age<0||age>FADE)continue;const x=PX[i],y=PY[i];if(x<F.x0||x>F.x1||y<F.y0||y>F.y1)continue;
    ctx.fillStyle='rgba(88,104,140,'+(.55*(1-age/FADE)).toFixed(2)+')';const px=Math.round(x*T),py=Math.round(y*T);
    ctx.fillRect(px-1,py-2,3,2);ctx.fillRect(px,py,2,1)}}
