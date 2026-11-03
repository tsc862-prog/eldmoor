// What a hero is trying to do, on the map (issue #534). Two layers, both read-only over sim/purpose.js:
//   drawPurposeGround  under the entities, for the followed (selected) or hovered hero only: a dotted path to where it is
//                      going with a small marker of what is there (job, foe, person, town, place); a thin tether from a
//                      follower to whom it follows; a dashed line from a waiting hero to whoever or wherever it waits for.
//                      Lines are a constant CSS width; the marker label is constant CSS size like every map label.
//   drawIntentIcon     in the entity loop (draw order by y), a tiny pixel icon at a hero's right shoulder: hunting,
//                      errand/job, waiting, following, resting/camp, going home, fleeing (plus fighting and travelling).
//                      Close zoom only and only while the Intent icons switch (Settings) is on (cam.icons); the followed or
//                      hovered hero's hourglass shows whenever it waits, at any zoom, switch or not.
// Icons are 5x5 pixel strings on a dark 7x7 plate, drawn in world pixels like the selection chevron.
import {U as T} from './tile.js'; // world units a tile (render/tile.js; art is drawn at TILE)
import {purposeOf,ICON_OF} from '../sim/purpose.js';
import {INTENT,MARK} from './palette.js';

const G={ // '#' lit, '.' empty
  hunt:  ['..#..','.#.#.','##.##','.#.#.','..#..'], // crosshair
  job:   ['..#..','..#..','..#..','.....','..#..'], // the quest mark
  wait:  ['#####','.#.#.','..#..','.#.#.','#####'], // hourglass
  follow:['#.#..','.#.#.','..#.#','.#.#.','#.#..'], // chevrons: after someone
  rest:  ['#####','...#.','..#..','.#...','#####'], // Z
  home:  ['..#..','.###.','#####','.#.#.','.#.#.'], // a house
  flee:  ['..#..','.#...','#####','.#...','..#..'], // back arrow
  fight: ['#...#','.#.#.','..#..','.#.#.','#...#'], // crossed blades
  travel:['..#..','...#.','#####','...#.','..#..'], // on the road
};
const MARKS={job:'job',foe:'fight',person:'follow',town:'home',place:'travel'};
let cache=new Map(),stamp=-1;
// One purpose per hero per frame (the icons and the ground layer share it).
function pOf(a,S){const t=S.gameMin+'|'+Math.floor((typeof performance!=='undefined'?performance.now():0)/250);if(stamp!==t){cache=new Map();stamp=t}let p=cache.get(a);if(!p){p=purposeOf(a);cache.set(a,p)}return p}
function glyph(ctx,k,x,y,col){const g=G[k];if(!g)return;ctx.fillStyle=INTENT.plate;ctx.fillRect(x-1,y-1,7,7);ctx.fillStyle=col;
  for(let j=0;j<5;j++){const r=g[j];for(let i=0;i<5;i++)if(r.charCodeAt(i)===35)ctx.fillRect(x+i,y+j,1,1)}}
const live=a=>a&&!a.hidden&&a.state!=='dead';
// The heroes whose purpose is drawn on the ground: the followed one and the hovered one (at most two).
function focus(cam){const L=[];if(live(cam.sel))L.push(cam.sel);if(live(cam.hover)&&cam.hover!==cam.sel)L.push(cam.hover);return L}

export function drawPurposeGround(ctx,S,cam,{drawText,blink}){const L=focus(cam);if(!L.length)return;const sc=cam.sc,px1=cam.dpr/sc;
  for(const a of L){const p=pOf(a,S),col=INTENT[ICON_OF[p.kind]]||INTENT.travel,ax=a.x*T,ay=a.y*T-3;
    ctx.save();ctx.lineCap='round';
    // the road ahead: dots marching toward the destination
    if(p.path&&p.path.length){ctx.strokeStyle=col;ctx.globalAlpha=.85;ctx.lineWidth=2*px1;ctx.setLineDash([2*px1,5*px1]);ctx.lineDashOffset=-(blink*14%7)*px1;
      ctx.beginPath();ctx.moveTo(ax,ay);for(const q of p.path)ctx.lineTo(q.x*T,q.y*T);ctx.stroke()}
    ctx.setLineDash([]);ctx.globalAlpha=1;
    if(p.to){const x=p.to.x*T,y=p.to.y*T,s=px1,k=MARKS[p.to.mark]||'travel'; // the marker: a pin with what is there
      ctx.fillStyle=MARK.edge;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-5*s,y-8*s);ctx.lineTo(x+5*s,y-8*s);ctx.fill();
      ctx.save();ctx.translate(x,y-15*s);ctx.scale(s*1.6,s*1.6);ctx.imageSmoothingEnabled=false;glyph(ctx,k,-2.5,-2.5,INTENT[k]||col);ctx.restore();
      if(p.to.label&&drawText)drawText(p.to.label,x,y-23*s,col,13)}
    // a follower's tether to the one it follows
    if(p.tether){const b=S.agents.find(h=>h.id===p.tether.id);if(live(b)){ctx.strokeStyle=INTENT.follow;ctx.globalAlpha=.9;ctx.lineWidth=2*px1;
      ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(b.x*T,b.y*T-3);ctx.stroke();ctx.globalAlpha=1;ctx.fillStyle=INTENT.follow;ctx.fillRect(b.x*T-2*px1,b.y*T-3-2*px1,4*px1,4*px1)}}
    // a waiting hero: a dashed line to whoever (or wherever) it waits for
    if(p.wait){const b=p.wait.id!=null?S.agents.find(h=>h.id===p.wait.id):null,wx=b?b.x:p.wait.x,wy=b?b.y:p.wait.y;
      if(wx!=null&&Math.hypot(wx-a.x,wy-a.y)>.8){ctx.strokeStyle=INTENT.wait;ctx.globalAlpha=.9;ctx.lineWidth=2*px1;ctx.setLineDash([5*px1,4*px1]);
        ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(wx*T,wy*T-3);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1}}
    ctx.restore()}}

// The icon at a hero's right shoulder (called from the entity loop with its sprite's top and width in world px).
export function drawIntentIcon(ctx,S,cam,a,px,top,w,close){if(!live(a))return;const foc=a===cam.sel||a===cam.hover;
  if(!close&&!foc)return;const p=pOf(a,S),k=ICON_OF[p.kind];if(!k)return;
  if(!(cam.icons!==false&&close)&&!(foc&&k==='wait'))return;
  if(close){glyph(ctx,k,px+Math.ceil(w/2)+1,top-1,INTENT[k]);return}
  const s=Math.max(1,1.4*cam.dpr/cam.sc);ctx.save();ctx.translate(px,top-6*s);ctx.scale(s,s);glyph(ctx,k,-2.5,-5,INTENT[k]);ctx.restore()} // far: over the head, a constant size
