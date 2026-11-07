// A crossing on screen (#1013 slice 4): the road's end fading to the far side. The sim switches the live map inside one step (sim/crossing.js), so by the next
// frame the world under the camera is another land; every render module has already dropped what it held of the old one (their onWorld hooks) and rebuilds on
// first use. This covers the handover. Beats, each a frame's work in draw.js's place:
//   out    the last picture of the land left behind, kept at the moment of the switch, drifts on along the road while the dark comes in from the road's end, in
//          blocks, as the map's own pixels would go
//   dark   black with the land's name. The far side is made here, out of sight: one heavy table a frame (scenery fields, mountains, shadows, water), then chunks a
//          row of tiles at a time (terrain.js, #990), nearest the camera first. It lasts until the first view's chunks are done, HOLD_S at least, MAX_S at most
//   lift   the name goes
//   in     the real world, with the dark leaving the way it came. In the cinema view this beat is director.enter's fade up instead (ui/mapswitch.js)
// An exit on a map's edge says which way the road ran (`edge.side`); a road that leaves inland (`at`) simply fades. Render only: nothing here is read by the sim, it
// allocates only the one copy of the picture for the length of the crossing, and a map that never switches never gets past fading().
import {hash} from '../core/rng.js';
import {EXITS,MAP_ID} from '../world/map.js';
import {MAPS} from '../world/spec.js';
import {TEXT} from './palette.js';
import {warmNow,warmRest,chunksDone} from './terrain.js';
import {warmScenery} from './scenery.js';
import {warmPeaks} from './peaks.js';
import {warmCast} from './shadows.js';
import {warmWater} from './water.js';
import {warmSway} from './sway.js';
import {warmSheen} from './sheen.js';
import {warmShade} from './lightmap.js';
import {warmAir} from './atmos.js';
import {warmCritters} from './critters.js';

export const FADE={
  OUT_S:.85,   // the road's end going dark
  HOLD_S:.9,   // the far side's name stands at least this long
  MAX_S:4,     // and the first view is never waited for longer than this: what is still unpainted comes in as it is done
  LIFT_S:.3,   // the name goes before the dark does
  IN_S:1,      // the dark leaving
  REST_S:1.5,  // the rest of the map waits this long to be painted, so the picture comes back smooth (the cinema view's fade up is the longer)
  PUSH:.05,    // of the window: how far the old picture drifts along the road
  CELL:16,     // CSS px of a block of the dark's edge
  RAG:.22,     // of the window: how ragged that edge is
  SLICE:14,    // ms of chunk painting a dark frame
};
const WAYS={E:[1,0],W:[-1,0],S:[0,1],N:[0,-1]};
const STEPS=[warmScenery,warmPeaks,warmCast,warmWater,warmSway,warmSheen,warmShade,warmAir,warmCritters]; // scenery and the mountains first: the chunks and shadows read them
const smooth=x=>x*x*(3-2*x);

let v=null,last=0;
export const fading=()=>!!v;
export const fadeBeat=()=>v?v.beat:null; // for the shots and the checks

// Copy what is on the canvas now: the frame before the switch.
export function beginFade(cv){const pic=document.createElement('canvas');pic.width=cv.width;pic.height=cv.height;pic.getContext('2d').drawImage(cv,0,0);
  v={beat:'out',t:0,pic,aimed:false,step:0,way:null,ready:false,sub:null,name:(MAPS[MAP_ID]||{}).name||''};last=0}

// The road they came in by: the exit they stand beside. None near (a map switched some other way): no way to read, and it simply fades.
function entry(at){let best=null,bd=1e9;for(const e of EXITS){const d=Math.hypot(e.x-at.x,e.y-at.y);if(d<bd){bd=d;best=e}}return best&&bd<=(best.r||2)+6?best:null}
// The dark over the whole window but for what has not reached it: p 0 to 1, entering from the side the road ran toward; lifting, it leaves from that same side, so
// the land ahead shows first. A cell's own hash breaks up the edge. With no way known it is one even fade.
function dark(ctx,cv,p,lifting){const w=cv.width,h=cv.height;ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#000';
  if(!v.way){ctx.globalAlpha=lifting?1-p:p;ctx.fillRect(0,0,w,h);ctx.globalAlpha=1;return}
  const [dx,dy]=v.way,cs=Math.max(4,Math.round(FADE.CELL*(typeof devicePixelRatio==='number'?devicePixelRatio:1))),n=Math.ceil((dx?w:h)/cs),m=Math.ceil((dx?h:w)/cs),rag=FADE.RAG,edge=p*(1+rag)-rag; // edge: in fractions of the window from the entering side
  const from=dx>0?w:dy>0?h:0,back=dx>0||dy>0,put=(a,b,j0,j1)=>{const lo=back?from-b*cs:from+a*cs,len=(b-a)*cs;if(dx)ctx.rect(lo,j0*cs,len,(j1-j0)*cs);else ctx.rect(j0*cs,lo,(j1-j0)*cs,len)}; // cells a..b counted from that side, rows j0..j1 across it
  const a=Math.max(0,Math.floor(edge*n)),b=Math.min(n,Math.ceil((edge+rag)*n));ctx.beginPath();
  if(lifting){if(b<n)put(Math.max(0,b),n,0,m)}else if(a>0)put(0,Math.min(n,a),0,m);
  for(let i=a;i<b;i++){const k=(i/n-edge)/rag;for(let j=0;j<m;j++){const s=hash(i,j,1013);if(lifting?k>s:k<s)put(i,i+1,j,j+1)}}
  ctx.fill()}
function title(ctx,cv,a){if(a<=.01||!v.name)return;const w=cv.width,h=cv.height,s=Math.max(16,Math.round(h/42));ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=a;ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle=TEXT.place;ctx.font=s+'px "Press Start 2P", monospace';ctx.fillText(v.name,w/2,h/2-(v.sub?s*.7:0));
  if(v.sub){ctx.fillStyle=TEXT.region;ctx.font=Math.round(s*1.05)+'px VT323, monospace';ctx.fillText(v.sub,w/2,h/2+s*1.1)}
  ctx.globalAlpha=1;ctx.textBaseline='alphabetic'}

// A frame of the crossing. True when it drew the frame; false lets draw.js draw the world (paintFade then lays the dark over it). aim() puts the camera on the company and
// answers who it looks at, view() says which tiles it will show, shown() hands the picture back and answers true when something else takes the last beat.
export function fadeFrame(ctx,cv,aim,view,shown){const now=performance.now(),dt=last?Math.min(.1,(now-last)/1000):0;last=now;v.t+=dt;
  if(!v.aimed){v.aimed=true;const who=aim(),e=who?entry(who):null;if(e){v.way=e.edge&&WAYS[e.edge.side]?WAYS[e.edge.side].map(n=>-n):null;v.sub='by '+e.name}} // an exit on the west edge: they walked west to east
  if(v.beat==='in'){if(v.t>=FADE.IN_S)v=null;return false}
  ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#000';ctx.fillRect(0,0,cv.width,cv.height);
  if(v.beat==='out'){const p=Math.min(1,v.t/FADE.OUT_S),k=smooth(p)*FADE.PUSH,way=v.way||[0,0];ctx.drawImage(v.pic,-way[0]*k*cv.width,-way[1]*k*cv.height);dark(ctx,cv,smooth(p),false);
    if(p>=1){v.beat='dark';v.t=0;v.pic=null}return true}
  if(v.beat==='dark'){if(v.step<STEPS.length)STEPS[v.step++]();else{const b=view();warmNow(FADE.SLICE,(b[0]+b[2])/2,(b[1]+b[3])/2);v.ready=chunksDone(b[0],b[1],b[2],b[3])}
    title(ctx,cv,Math.min(1,v.t/.3));if(v.t>=FADE.HOLD_S&&(v.ready||v.t>=FADE.MAX_S)){v.beat='lift';v.t=0}return true}
  title(ctx,cv,1-v.t/FADE.LIFT_S);
  if(v.t>=FADE.LIFT_S){if(v.ready)warmRest(FADE.REST_S*1000);if(shown()){v=null;return false}v.beat='in';v.t=0;return false}
  return true}
// Over the finished frame, during `in`.
export function paintFade(ctx,cv){if(v&&v.beat==='in')dark(ctx,cv,smooth(Math.min(1,v.t/FADE.IN_S)),true)}
