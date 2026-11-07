// The cinema view's director camera (#979): where the camera looks while ui/cinema.js has the map as the whole window.
// draw.js calls cam.director.step() instead of its own camera lines while cam.director is set, and paint() last of all, so
// the normal views run exactly as before. Render only: it reads S and writes nothing to it, its timers and its dice are its
// own (a small private stream, never the sim's RNG), and nothing here runs in step(), so no seeded hash can move.
//
// What it does, a frame at a time:
//   follow    the followed company, or the part of it riding with its leader. Position and zoom ease on a critically
//             damped spring, so a move starts and stops softly and nothing overshoots.
//   zoom      close: the view rests where a hero stands about a fifteenth of the window tall, on the road as in town, and goes
//             closer for a fight or a Table scene (draw.js hands over the cut). It pulls out only for a beat: a few seconds as the
//             company sets out, again every so often on a long road, then it eases back in. Scales sit on half steps: at
//             3440x1440 4 at rest (two screen pixels an art pixel), 5 close, 3 on a beat. A fixed half step does not shimmer: the
//             chunks scale rigidly and move by whole pixels; only a zoom in progress does.
//   drift     after a few quiet seconds the view wanders slowly round the company; the amplitude eases in and out.
//   sights    now and then, when the company is not busy, it cuts away to something worth seeing and back: a duel, a raid on
//             the wyrm, a cart beset, a fight with an elite, another company's fight; failing those the wyrm in its lair, a
//             dungeon's mouth or a town. Each sight has a cooldown. A busy company or a scene calls the camera straight back.
//   a cut     a target further off than DIR.FAR of a view is never panned to: the picture dips to black, the camera moves in
//             the dark, the picture comes back. The camera only ever jumps at full black.
import {clamp} from '../core/rng.js';
import {W,H} from '../world/tiles.js';
import {U as T} from './tile.js';
import {S} from '../sim/state.js';
import {LANDMARKS,CITY} from '../world/map.js';
import {followed,members,companies,leaderOf} from '../sim/company.js';

export const DIR={
  ROWS:22.5,                               // tiles high at rest, rounded to a half step, never under scale 2 or the map's cover
  WIDE:1,CLOSE:1,                          // taken off that scale for a beat, added for a fight, a Table scene or a sight
  BEAT_S:7,BEAT_GAP:50,                    // seconds of a pull-out on the road, and at least this long between two
  POS_S:1.3,FIGHT_POS_S:.9,ZOOM_S:1.9,     // spring times, in seconds
  MAX_PAN:26,                              // tiles a second at most: a longer way is a cut
  FAR:.8,                                  // a target more than this many view widths off is reached by a cut
  SIGHT_FAR:.35,                           // a sight (or the way back) this far off is a cut; nearer it eases over
  OUT_S:.38,IN_S:.6,ENTER_S:1.1,           // the dip to black and back, and the fade up on entering
  CLUSTER:16,NEAR:7,                       // tiles from the leader: further out rides apart from the shot; NEAR when they would not fit
  MARGIN_X:10,MARGIN_Y:6,                  // tiles round the people who must stay in frame
  LEAD_S:1.4,LEAD_MAX:5,                   // how far ahead of a moving company the view looks (seconds of travel, tiles)
  DRIFT:2.6,DRIFT_AFTER:5,DRIFT_IN:9,      // tiles of wander, quiet seconds before it starts, seconds to reach it
  HOLD_MODE:2.5,                           // seconds a new pace must last before the zoom follows it (no pumping)
  HOLD_IN:2,                               // seconds a closer framing must hold before the zoom goes in
  FIGHT_HOLD:4,                            // the view stays in this long after the last blow
  GAP:[60,120],FIRST:35,                   // seconds between sights, and before the first
  HOT_GAP:30,                              // a duel or a raid may come this soon after the last sight
  HOLD:[9,14],                             // seconds on a sight
  COOL:240,                                // seconds before the same sight again
  SPOT_S:14,                               // seconds close on a hero the watcher picked
  LIFT:.02,                                // of the window's height: the view sits this much low, clear of the plates
};
const FIGHT={fight:1,duel:1,assist:1,downed:1};
const ROAD={travel:1,return:1,flee:1};
const seen=a=>!!a&&a.state!=='dead'&&!a.hidden;
const smooth=x=>x*x*(3-2*x);
// Rest scales sit on half steps: 2 is one screen pixel an art pixel (ART 2). Below it the art would lose pixels; below the
// cover the window would show past the map's edge.
export const coverScale=(w,h)=>Math.max(w/(W*T),h/(H*T));
const floorScale=(w,h)=>Math.max(2,Math.ceil(coverScale(w,h)*2-1e-6)/2);
export const restScale=(w,h)=>Math.max(floorScale(w,h),Math.round(h/(DIR.ROWS*T)*2)/2);
export const wideScale=(w,h)=>Math.max(floorScale(w,h),restScale(w,h)-DIR.WIDE);
export const closeScale=(w,h)=>restScale(w,h)+DIR.CLOSE;
// One axis of the spring (critically damped, stable at any frame time).
function damp(s,target,time,dt,maxV){const o=2/Math.max(.01,time),x=o*dt,e=1/(1+x+.48*x*x+.235*x*x*x);
  let c=s.p-target;if(maxV){const m=maxV*time;c=clamp(c,-m,m)}
  const t=s.p-c,tmp=(s.v+o*c)*dt;s.v=(s.v-o*tmp)*e;s.p=t+(c+tmp)*e}

// opts: still() true while the world is held or paused (no sights), reduced() true for a viewer who asked for less motion
// (no drift), seed for the private dice.
export function createDirector(opts={}){
  const X={p:0,v:0},Y={p:0,v:0},Z={p:0,v:0}; // Z: the log of the scale, so a zoom reads even at any distance
  const d={t:0,seed:(opts.seed||0x9e3779b9)>>>0,fade:0,dip:null,sight:null,next:null,nextAt:DIR.FIRST,lastSight:-1e3,cool:new Map(),spot:null,sel:null,bias:0,
    cx:null,cy:null,sx:0,sy:0,cvx:0,cvy:0,beatTo:-1e3,beatAt:0,shotSc:0,shotT:0,mode:'rest',modeWant:'rest',modeT:0,fightT:-1e3,quiet:0,driftA:0,fid:null,last:0,busy:false,scan:0};
  const rnd=()=>{d.seed=(Math.imul(d.seed,1664525)+1013904223)>>>0;return d.seed/4294967296};
  const between=([a,b])=>a+(b-a)*rnd();
  const calm=()=>!!(opts.reduced&&opts.reduced());
  const still=()=>!!(opts.still&&opts.still());

  // ---- who the shot is about ----
  const fitOf=(L,w,h)=>{let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const a of L){x0=Math.min(x0,a.x);y0=Math.min(y0,a.y);x1=Math.max(x1,a.x);y1=Math.max(y1,a.y)}
    return Math.min(w/((x1-x0+DIR.MARGIN_X)*T),h/((y1-y0+DIR.MARGIN_Y)*T))};
  // Those the shot is about: the company with its leader; if they are too scattered to fit close, whoever is near the leader.
  function band(cam,w,h){const C=followed();d.fid=C?C.id:null;const all=C?members(C).filter(seen):[];
    if(!all.length)return seen(cam.sel)?[cam.sel]:[];
    const L=leaderOf(C),lead=seen(L)&&all.includes(L)?L:all[0],near=r=>all.filter(a=>Math.hypot(a.x-lead.x,a.y-lead.y)<=r),wide=near(DIR.CLUSTER);
    return fitOf(wide,w,h)>=wideScale(w,h)?wide:near(DIR.NEAR)}
  // The shot on the company: {x, y, sc} in world units. Keeps the pace (road, rest, fight) with some hysteresis.
  function companyShot(w,h,dt,people){
    let n=0,x0=1e9,y0=1e9,x1=-1e9,y1=-1e9,fight=false,road=0,mx=0,my=0;
    const add=(x,y)=>{x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y)};
    for(const a of people){n++;mx+=a.x;my+=a.y;add(a.x,a.y);
      if(FIGHT[a.state]){fight=true;const t=a.target;if(t&&t.x!=null&&!t.hidden&&t.alive!==false&&Math.hypot(t.x-a.x,t.y-a.y)<9)add(t.x,t.y)}
      if(ROAD[a.state]||a.moving)road++}
    if(n){const cx=mx/n,cy=my/n;if(dt>0&&d.cx!=null){const k=Math.min(1,dt*2);d.cvx+=((cx-d.cx)/dt-d.cvx)*k;d.cvy+=((cy-d.cy)/dt-d.cvy)*k}d.cx=cx;d.cy=cy;d.sx=(x0+x1)/2;d.sy=(y0+y1)/2}
    else{x0=x1=d.sx;y0=y1=d.sy;d.cvx=d.cvy=0}
    if(fight)d.fightT=d.t;
    const want=d.t-d.fightT<DIR.FIGHT_HOLD?'fight':n&&road*2>=n?'road':'rest';
    if(want!==d.modeWant){d.modeWant=want;d.modeT=0}else d.modeT+=dt;
    if(want==='fight'||d.modeT>=DIR.HOLD_MODE)d.mode=want;
    d.busy=d.mode==='fight';d.quiet=d.mode==='rest'?d.quiet+dt:0;
    if(d.mode==='road'&&d.t>=d.beatAt&&!calm()){d.beatTo=d.t+DIR.BEAT_S;d.beatAt=d.t+DIR.BEAT_GAP} // a beat of the land, then back in
    const base=d.mode==='fight'?closeScale(w,h):d.t<d.beatTo?wideScale(w,h):restScale(w,h);
    // everyone in frame: step down a half scale at a time, never past the pull-out
    const need=Math.min(w/((x1-x0+DIR.MARGIN_X)*T),h/((y1-y0+DIR.MARGIN_Y)*T));
    let sc=base;if(need<sc)sc=Math.max(wideScale(w,h),Math.floor(need*2)/2);
    // out at once so nobody leaves the frame, back in only once it has held: people milling in a fight must not pump the zoom
    if(sc<d.shotSc||dt===0){d.shotSc=sc;d.shotT=0}else if(sc>d.shotSc&&(d.shotT+=dt)>=DIR.HOLD_IN){d.shotSc=sc;d.shotT=0}else if(sc===d.shotSc)d.shotT=0;
    sc=d.shotSc;
    const a=calm()?0:clamp((d.quiet-DIR.DRIFT_AFTER)/DIR.DRIFT_IN,0,1);d.driftA+=(a-d.driftA)*Math.min(1,dt*.8);
    const lead=d.mode==='road'?DIR.LEAD_S:0,sp=Math.hypot(d.cvx,d.cvy),k=sp*lead>DIR.LEAD_MAX?DIR.LEAD_MAX/(sp*lead):1;
    return {x:(d.sx+d.cvx*lead*k+Math.sin(d.t*.134)*DIR.DRIFT*d.driftA)*T,y:(d.sy+d.cvy*lead*k+Math.sin(d.t*.103+1)*DIR.DRIFT*.6*d.driftA)*T,sc}}

  // ---- something worth seeing ----
  // A sight: {key, hot (0 fills a gap, 1 may come early, 2 before the rest), label, wide, at() -> {x, y} in tiles, or null once it is over}.
  function sights(){const out=[],own=a=>a.company!=null&&a.company===d.fid;
    for(const a of S.agents){if(!seen(a)||own(a))continue;
      if(a.state==='duel'&&a.target&&a.id<a.target.id){const b=a.target;out.push({key:'duel'+a.id+'.'+b.id,hot:1,label:a.name+' and '+b.name+' cross blades',at:()=>a.state==='duel'&&seen(a)?{x:(a.x+b.x)/2,y:(a.y+b.y)/2}:null})}
      else if(a.state==='fight'&&a.target&&a.target.elite&&a.target.alive){const m=a.target;out.push({key:'elite'+m.id,hot:1,label:a.name+' against '+m.name,at:()=>m.alive?{x:m.x,y:m.y}:null})}}
    const B=S.boss;if(B&&B.alive&&(S.raidOn||[]).some(Boolean))out.push({key:'raid',hot:2,label:'The raid on '+(B.name||'the wyrm'),at:()=>B.alive&&S.raidOn.some(Boolean)?{x:B.x,y:B.y}:null});
    for(const w of (S.traffic&&S.traffic.list)||[])if(w.beset)out.push({key:'beset'+w.id,hot:1,label:(w.kind==='cart'?'A '+w.word+' cart':'A '+w.word)+' beset on the road',at:()=>w.beset&&S.traffic.list.includes(w)?{x:w.x,y:w.y}:null});
    for(const C of companies()){if(C.id===d.fid)continue;const f=members(C).filter(seen).find(a=>FIGHT[a.state]);if(f)out.push({key:'co'+C.id,hot:1,label:(C.name||f.name)+', in a fight',at:()=>seen(f)&&FIGHT[f.state]?{x:f.x,y:f.y}:null})}
    if(B&&B.alive&&B.x!=null)out.push({key:'wyrm',wide:true,label:(B.name||'The wyrm')+', in the lair',at:()=>B.alive?{x:B.x,y:B.y}:null});
    for(const c of CITY)out.push({key:'town'+c.name,wide:true,label:c.name,at:()=>({x:(c.x0+c.x1+1)/2,y:(c.y0+c.y1+1)/2})});
    for(const L of LANDMARKS)if(L.kind==='crypt'&&L.mouth)out.push({key:'crypt'+L.name,wide:true,label:L.name,at:()=>({x:(L.mouth.x0+L.mouth.x1+1)/2,y:L.mouth.y1+1})});
    return out}
  function pickSight(hotOnly){const open=sights().filter(s=>(d.cool.get(s.key)||0)<=d.t&&(!hotOnly||s.hot));if(!open.length)return null;
    const top=Math.max(...open.map(s=>s.hot||0)),best=open.filter(s=>(s.hot||0)===top);return best[Math.floor(rnd()*best.length)]}
  function sightShot(w,h){const s=d.sight,p=s.at();if(p){s.x=p.x;s.y=p.y}else s.left=Math.min(s.left,1.2);
    return {x:s.x*T,y:s.y*T,sc:s.wide?wideScale(w,h):closeScale(w,h)}}
  const startSight=s=>{s.left=between(DIR.HOLD);const p=s.at();s.x=p?p.x:0;s.y=p?p.y:0;d.cool.set(s.key,d.t+DIR.COOL);d.lastSight=d.t;return s};
  function considerSights(dt,sceneOn){
    if(d.dip)return;
    if(d.sight){d.sight.left-=dt;if(sceneOn||d.busy||d.spot||d.sight.left<=0)d.next={sight:null};return}
    if(d.next||sceneOn||d.busy||d.spot||still())return;
    d.scan-=dt;let s=null;const due=d.t>=d.nextAt;
    if(due)s=pickSight(false);else if(d.scan<=0&&d.t-d.lastSight>=DIR.HOT_GAP){d.scan=2;s=pickSight(true)}
    if(due||s)d.nextAt=d.t+between(DIR.GAP);if(s)d.next={sight:startSight(s)}}
  function shotNow(w,h,dt,cut,people){
    const comp=companyShot(w,h,dt,people); // always run: the pace and the velocity keep up during a sight
    if(cut){const sc=Math.min(cut.sc,closeScale(w,h));return {x:cut.x+(cut.dx||0)/sc,y:cut.y+((cut.dy||0)+h*DIR.LIFT)/sc,sc,free:true,room:2*(cut.dx||0)/sc,pos:DIR.FIGHT_POS_S}}
    if(d.sight)return {...sightShot(w,h),pos:DIR.POS_S};
    if(d.spot&&seen(d.spot.a))return {x:d.spot.a.x*T,y:d.spot.a.y*T,sc:closeScale(w,h),pos:DIR.POS_S};
    comp.y+=h*DIR.LIFT/comp.sc;return {...comp,pos:d.mode==='fight'?DIR.FIGHT_POS_S:DIR.POS_S}}
  function keep(s,w,h){ // the target stays inside the map, so the spring never leans on the clamp. A scene's cut (free) is off centre for the banner beside it: past the east edge only what that hides
    const vw=w/s.sc,vh=h/s.sc,far=s.room||0;s.x=vw>=W*T?s.free?s.x:W*T/2:clamp(s.x,vw/2,W*T-vw/2+far);s.y=vh>=H*T?s.free?s.y:H*T/2:clamp(s.y,vh/2,H*T-vh/2);return s}
  const write=(cam,w,h)=>{cam.sc=Math.exp(Z.p);cam.camX=X.p;cam.camY=Y.p;cam.vw=w/cam.sc;cam.vh=h/cam.sc};
  const jump=s=>{X.p=s.x;Y.p=s.y;Z.p=Math.log(s.sc)+d.bias;X.v=Y.v=Z.v=0};
  const away=(s,w)=>Math.hypot(s.x-X.p,s.y-Y.p)/(w/Math.exp(Z.p)); // view widths from here to the shot

  return {
    get fade(){return d.fade},
    get sightLabel(){return d.sight&&!d.dip?d.sight.label:''},
    get shotKind(){return d.dip?'cut':d.sight?'sight':d.spot?'spot':d.mode},
    // the fade up on entering: the camera starts on its shot, in the dark
    enter(cam,w,h){d.sight=null;d.next=null;d.spot=null;d.sel=cam.sel;d.cvx=d.cvy=0;d.cx=d.cy=null;d.quiet=0;d.driftA=0;d.fade=1;d.bias=0;d.last=0;
      d.nextAt=d.t+DIR.FIRST;d.lastSight=d.t-DIR.HOT_GAP+DIR.FIRST*.5;d.dip={t:DIR.OUT_S,dark:true,into:DIR.ENTER_S};d.sx=(cam.camX||0)/T;d.sy=(cam.camY||0)/T;
      d.mode=d.modeWant='rest';d.beatTo=-1e3;d.beatAt=d.t+DIR.BEAT_GAP/2;jump(keep(companyShot(w,h,0,band(cam,w,h)),w,h));write(cam,w,h)},
    // the wheel: the viewer's nudge in or out, kept until the view is left
    nudge(n){d.bias=clamp(d.bias+n*.18,-.7,.7)},
    // a name over a head: the hovered hero, the selected hero and their company, the followed company
    named(a,cam){if(a===cam.hover||a===cam.sel)return true;const c=a.company;return c!=null&&(c===d.fid||(!!cam.sel&&c===cam.sel.company))},
    step(cam,w,h,cut,dtForced){const now=typeof performance!=='undefined'?performance.now()/1000:0;
      const dt=dtForced!=null?dtForced:d.last?Math.min(.1,Math.max(0,now-d.last)):1/60;d.last=now;d.t+=dt;
      if(cam.sel!==d.sel){d.sel=cam.sel;d.spot=seen(cam.sel)?{a:cam.sel,until:d.t+DIR.SPOT_S}:null} // the watcher picked someone
      if(d.spot&&d.t>d.spot.until)d.spot=null;
      const people=band(cam,w,h);considerSights(dt,!!cut);
      if(d.next&&!d.dip){const n=d.next,was=d.sight;d.next=null;d.sight=n.sight;const t=keep(shotNow(w,h,0,cut,people),w,h);
        if(away(t,w)>DIR.SIGHT_FAR){d.sight=was;d.dip={t:0,go:n}}} // a far sight waits for the dark; a near one eases over
      let s=keep(shotNow(w,h,dt,cut,people),w,h);
      if(!d.dip&&away(s,w)>DIR.FAR)d.dip={t:0};
      if(d.dip){const q=d.dip;q.t+=dt;
        if(!q.dark&&q.t<DIR.OUT_S)d.fade=smooth(q.t/DIR.OUT_S);
        else{if(!q.dark){q.dark=true;q.t=DIR.OUT_S;if(q.go)d.sight=q.go.sight;s=keep(shotNow(w,h,0,cut,people),w,h);jump(s)} // only ever at full black
          const k=(q.t-DIR.OUT_S)/(q.into||DIR.IN_S);d.fade=1-smooth(clamp(k,0,1));if(k>=1){d.dip=null;d.fade=0}}}
      const time=s.pos||DIR.POS_S;damp(X,s.x,time,dt,DIR.MAX_PAN*T);damp(Y,s.y,time,dt,DIR.MAX_PAN*T);damp(Z,Math.log(s.sc)+d.bias,DIR.ZOOM_S,dt);
      write(cam,w,h)},
    // the dip, over everything the frame drew
    paint(ctx,w,h){if(d.fade<=.003)return;ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='rgba(0,0,0,'+d.fade.toFixed(3)+')';ctx.fillRect(0,0,w,h)}}}
