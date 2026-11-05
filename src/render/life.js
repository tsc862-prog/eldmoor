// The frame's shared facts for the ambient life of the map (#795, slice 4 of the solid-world epic #791): the hour, the
// frame time, the heroes near the view, the weather over a spot. Render only: it reads S and the world and never writes
// either, and everything alive on the map (critters, birds, smoke, stalls, guards, footprints) draws from here and from
// its own private random stream (`lrand`, never core/rng.js's shared one, as #674 set out), so a seeded world cannot move.
import {zoneAt} from '../world/map.js';
import {weatherKind} from '../sim/weather.js';

// The frame record, refilled once a frame by frame(): hero positions are tile units, in or near the view.
export const F={hour:12,now:0,dt:.016,n:0,hx:new Float64Array(96),hy:new Float64Array(96),hm:new Uint8Array(96),tpx:29,
  x0:0,y0:0,x1:0,y1:0,sc:1};
let last=0;
// Fill F for this frame: S (the world), cam (the camera), T world units a tile, now in seconds.
export function frame(S,cam,T,now){
  F.hour=(S.gameMin/60)%24;F.dt=last?Math.min(.1,Math.max(0,now-last)):.016;last=now;F.now=now;F.sc=cam.sc;F.tpx=cam.sc*T;
  F.x0=(cam.camX-cam.vw/2)/T-5;F.x1=(cam.camX+cam.vw/2)/T+5;F.y0=(cam.camY-cam.vh/2)/T-5;F.y1=(cam.camY+cam.vh/2)/T+5;
  let n=0;for(const a of S.agents){if(a.hidden||a.state==='dead'||a.state==='ghost'||a.x<F.x0||a.x>F.x1||a.y<F.y0||a.y>F.y1)continue;
    F.hx[n]=a.x;F.hy[n]=a.y;F.hm[n]=a.moving?1:0;if(++n>=96)break}
  F.n=n}
export const inTiles=(x,y,m=0)=>x>F.x0-m&&x<F.x1+m&&y>F.y0-m&&y<F.y1+m;
// A private random stream (mulberry32): the same sequence on every machine, apart from the sim's.
let rs=0x9e3779b9;
export function lrand(){rs=(rs+0x6d2b79f5)|0;let t=Math.imul(rs^(rs>>>15),1|rs);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296}
// Weather over a spot.
export const skyAt=(x,y)=>weatherKind(zoneAt(x,y));
export const WET={rain:1,squall:1,ashstorm:1};          // creatures that shelter, stalls that close
export const WIND={clear:.3,drizzle:.25,rain:.35,fog:.05,ashfall:.3,ashstorm:1.3,snow:.2,squall:1.5};
// A 0..1 ramp: up from a to b, down from c to d (hours, may wrap past midnight when c<a handled by the caller).
export const ramp=(h,a,b,c,d)=>h<a||h>=d?0:h<b?(h-a)/(b-a):h<c?1:1-(h-c)/(d-c);
// Daylight 0..1 (day creatures out, stalls open): dawn 5-7, dusk 19-21.
export const day=h=>ramp(h,5,7,19,21);
// Lamps: lit from dusk to dawn, ramping 17-18.5 and 6-7.
export const lamps=h=>h>=18.5||h<6?1:h>=17?(h-17)/1.5:h<7?1-(h-6):0;
