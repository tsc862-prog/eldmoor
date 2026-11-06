// Paths check (#794): walking over the solid grid (src/sim/path.js) on the active world. Proves: every town gate reaches every
// other gate, landmark, spawn point and gathering node; a river is crossed only at a bridge or a ford; the replan rules; the
// PATH.PER_TICK cap in a worst-case tick; a target in solid ground and an unreachable one end in arrival, not a freeze; mobs
// plan within their limit, wander stays local, a chase with no way is called off; a walker put off its path plans again; a save
// mid-path restores and walks the same; move_to's answer keeps its line, adds the route facts and names no unknown place; a
// seeded run repeats; nobody stands in a solid tile or sticks fast in a long run.
// Runs the active world; with no ELDMOOR_WORLD it runs Eldmoor, then re-runs itself for the Stepping Lands.
// Usage: npm run pathcheck
import './seed-first.mjs'; // before the sim loads: its import-time dice are fixed (#888)
import {spawnSync} from 'node:child_process';
import {tiles,I,CITY,LANDMARKS,ZPTS,ZONES,NODES,land,mainLand,zoneAt} from '../src/world/map.js';
import {W,H,RIVER,BRIDGE} from '../src/world/tiles.js';
import {solidAt,solidWhy,nearestOpen,landAt} from '../src/world/passable.js';
import {init,step,S,snapshot,restore,markPlayer,playerAct} from '../src/sim/index.js';
import {moveTo} from '../src/sim/heroes.js';
import {updMob,spawnMob} from '../src/sim/mobs.js';
import {MOBS} from '../src/data/mobs.js';
import {PATH,pathStats,pathTick,route,lineCost,clearLine,noWay,blockedBy} from '../src/sim/path.js';
import {seedRng} from '../src/core/rng.js';

let fail=0;const ok=(c,m)=>{if(!c){fail++;console.log('FAIL '+m)}else console.log('ok   '+m)};
const world=process.env.ELDMOOR_WORLD||'eldmoor';
console.log(`== ${world} ${W}x${H}`);
const walker=(x,y,o)=>({x,y,face:1,moving:false,...o});
// walks e to (x,y) at pace 2.4; returns ticks taken, or -1 past the limit
const walk=(e,x,y,max=40000)=>{for(let i=0;i<max;i++){pathTick();if(moveTo(e,x,y,1/60,2.4))return i}return -1};
const legsClear=(x0,y0,r)=>{let ax=x0,ay=y0;for(let k=0;k<r.pts.length;k+=2){if(!(lineCost(ax,ay,r.pts[k],r.pts[k+1])<Infinity))return false;ax=r.pts[k];ay=r.pts[k+1]}return true};

init();
// ---- reach ----
const gates=CITY.map(c=>({n:c.name,...c.gate}));
for(const a of gates){let bad=[];
  for(const b of gates)if(b!==a){const r=route(a.x,a.y,b.x,b.y);if(!r||r.near||!legsClear(a.x,a.y,r))bad.push(b.n)}
  for(const L of LANDMARKS){const r=route(a.x,a.y,L.x,L.y);if(!r||Math.hypot(r.pts.at(-2)-L.x,r.pts.at(-1)-L.y)>3)bad.push(L.name)}
  ZPTS.forEach((P,z)=>{for(let i=0;i<P.length;i+=Math.ceil(P.length/60)){const r=route(a.x,a.y,P[i].x,P[i].y);if(!r||r.near||!legsClear(a.x,a.y,r)){bad.push(ZONES[z]+' '+P[i].x+','+P[i].y);break}}});
  for(let i=0;i<NODES.length;i+=5){const r=route(a.x,a.y,NODES[i].x,NODES[i].y);if(!r||r.near)bad.push(NODES[i].id)}
  ok(!bad.length,a.n+' gate reaches every gate, landmark, hunting ground and node'+(bad.length?': '+bad.slice(0,6).join(', '):''))}
ok(ZPTS.every(P=>P.every(p=>!solidAt(p.x,p.y)&&landAt(p.x,p.y)===mainLand)),'no spawn or hunting point on solid ground or in a shut-in pocket');
ok(NODES.every(n=>!solidAt(n.x,n.y)&&landAt(n.x,n.y)===mainLand),'no gathering node on solid ground or in a shut-in pocket');
for(const L of LANDMARKS)if(L.kind==='lair'){const a=nearestOpen(L.x,L.y,4,p=>landAt(p.x,p.y)===mainLand);ok(a&&Math.hypot(a.x-L.x,a.y-L.y)<=2.5,L.name+': raiders can stand within reach of the wyrm')}

// ---- rivers ----
{let opens=0,crossings=0,offside=0,wet=0;
  for(let i=0;i<W*H;i++)if(tiles[i]===RIVER&&!solidAt(i%W,(i-i%W)/W))opens++;
  for(let i=0;i<W*H;i++)if(tiles[i]===BRIDGE)crossings++;
  ok(crossings>0,'the river has bridges ('+crossings+' tiles, '+opens+' open river tiles: fords and bridge shoulders)');
  // a tile walk of each sampled journey: any water on it is a ford or a bridge's shoulder, and no leg touches solid
  const P=ZPTS.flat();let seen=new Map();
  for(let i=0;i<P.length;i+=Math.ceil(P.length/300))for(const g of gates){const r=route(g.x,g.y,P[i].x,P[i].y);let ax=g.x,ay=g.y;
    for(let k=0;k<r.pts.length;k+=2){const bx=r.pts[k],by=r.pts[k+1],n=Math.ceil(Math.hypot(bx-ax,by-ay)*8);
      for(let q=0;q<=n;q++){const x=ax+(bx-ax)*q/n,y=ay+(by-ay)*q/n;if(solidAt(x,y))wet++;if(tiles[I(Math.floor(x),Math.floor(y))]===RIVER)offside++}ax=bx;ay=by}
    for(const c of r.cross||[])seen.set(c.k+' '+c.x+','+c.y,(seen.get(c.k+' '+c.x+','+c.y)||0)+1)}
  ok(wet===0,'sampled journeys never touch solid ground ('+wet+')');
  ok(seen.size>0,'journeys cross at: '+[...seen].map(([k,n])=>k+' x'+n).join(', '));
  ok([...seen.keys()].every(k=>/^(bridge|ford) /.test(k)),'every crossing is a bridge or a ford')
  // straight over the water is refused
  let line=0;for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++)if(tiles[I(x,y)]===RIVER&&solidAt(x,y)&&!lineCost(x-3.5,y+.5,x+4.5,y+.5))line++;
  ok(line===0,'no clear line runs through a river')}

// ---- replan rules ----
{const g=gates[0],P=ZPTS.flat().filter(p=>Math.hypot(p.x-g.x,p.y-g.y)>25),t=P[0],e=walker(g.x,g.y),n0=()=>pathStats.plans;
  pathTick();moveTo(e,t.x,t.y,1/60,2.4);ok(!!e.path,'a far target plans a path');const n=n0();
  for(let i=0;i<30;i++){pathTick();moveTo(e,t.x+1,t.y+1,1/60,2.4)}ok(n0()===n,'a target moved up to 2 tiles keeps the path');
  pathTick();moveTo(e,t.x+4,t.y,1/60,2.4);ok(n0()===n+1,'a target moved more than 2 tiles plans again');
  const q=nearestOpen(e.x+6,e.y+6,4);e.x=q.x;e.y=q.y;const n2=n0();pathTick();moveTo(e,t.x+4,t.y,1/60,2.4);ok(n0()===n2+1,'a walker put off its path plans again');
  // a solid step ahead: a stale leg pointed into a wall is dropped, not walked
  const w=(()=>{for(let y=2;y<H-2;y++)for(let x=2;x<W-2;x++)if(solidAt(x,y)&&!solidAt(x-1,y)&&!solidAt(x-2,y)&&!solidAt(x+1,y)&&!solidAt(x+2,y))return{x,y}})();
  if(w){const f=walker(w.x-.6,w.y+.5);f.path={tx:w.x+1.5,ty:w.y+.5,pts:[w.x+1.5,w.y+.5],i:0,lx:f.x,ly:f.y,len:2};for(let i=0;i<40;i++){pathTick();moveTo(f,w.x+1.5,w.y+.5,1/60,2.4);if(solidAt(f.x,f.y))break}ok(!solidAt(f.x,f.y),'a next step on solid ground drops the path')}}

// ---- the worst tick ----
{const g=gates[0],P=ZPTS.flat().filter(p=>Math.hypot(p.x-g.x,p.y-g.y)>PATH.NEAR+2),E=[];for(let i=0;i<200;i++)E.push(walker(g.x,g.y));
  const n0=pathStats.plans;pathTick();let held=0;const t0=performance.now();for(let i=0;i<E.length;i++){const p=P[(i*97)%P.length];moveTo(E[i],p.x,p.y,1/60,2.4);if(!E[i].path)held++}const ms=performance.now()-t0;
  const did=pathStats.plans-n0;ok(did>0&&did<=PATH.PER_TICK,'200 walkers wanting a path in one tick: '+did+' plan ('+ms.toFixed(2)+' ms), the rest wait');
  ok(held===200-did&&E.every(e=>e.x===g.x||e.path),'those who wait hold their ground');
  let t=1;for(;t<60&&E.some(e=>!e.path);t++){pathTick();for(let i=0;i<E.length;i++){const p=P[(i*97)%P.length];moveTo(E[i],p.x,p.y,1/60,2.4)}}
  ok(t<60,'all 200 are walking within '+t+' ticks')}

// ---- solid and unreachable targets ----
{const g=gates[0];
  let sx=null;for(let y=2;y<H-2&&!sx;y++)for(let x=2;x<W-2;x++)if(solidWhy(x,y)==='peak'||solidWhy(x,y)==='river'){sx={x:x+.5,y:y+.5};break}
  let e=walker(g.x,g.y),t=walk(e,sx.x,sx.y);ok(t>=0&&!solidAt(e.x,e.y),'a target on solid ground: arrives beside it in '+t+' ticks');
  const before=pathStats.plans;for(let i=0;i<50;i++){pathTick();moveTo(e,sx.x,sx.y,1/60,2.4)}ok(pathStats.plans===before,'standing there asks for no more plans');
  const pocket=(()=>{for(let i=0;i<W*H;i++)if(land[i]>=0&&land[i]!==mainLand)return{x:i%W+.5,y:(i-i%W)/W+.5}})();
  if(pocket){e=walker(g.x,g.y);t=walk(e,pocket.x,pocket.y);ok(t>=0&&landAt(e.x,e.y)===mainLand,'a target shut in by peaks: arrives as near as the ground allows ('+t+' ticks)')}
  e=walker(g.x,g.y);ok(walk(e,-5,-5)>=0,'a target off the map ends too');
  const b=CITY[0].buildings[0];if(b){const c=walker(CITY[0].spots.square.x,CITY[0].spots.square.y);ok(walk(c,b.box[0]+.5,b.box[1]+.5,4000)>=0&&!solidAt(c.x,c.y),'a target inside a building: stops at open ground')}}

// ---- bad numbers: refused, never a freeze, a teleport or a spoiled position ----
{const BAD=[NaN,Infinity,-Infinity,undefined,null,1e308,-1e308,3.7e9,'12',{}],g=gates[0],good=ZPTS.flat()[40],sane=e=>Number.isFinite(e.x)&&Number.isFinite(e.y);let spoiled=0,threw=0;const t0=performance.now();
  for(const k of [{kind:'hero'},{kind:'mob',type:'x'}])for(const x of BAD)for(const y of [...BAD,good.y]){const e=walker(g.x,g.y,k);try{for(let i=0;i<10;i++){pathTick();moveTo(e,x,y,1/60,2.4)}}catch(err){threw++}if(!sane(e)||solidAt(e.x,e.y))spoiled++}
  ok(!threw&&!spoiled&&performance.now()-t0<3000,'bad targets are refused or end at open ground ('+threw+' threw, '+spoiled+' spoiled, '+(performance.now()-t0).toFixed(0)+' ms)');
  let e=walker(NaN,5);pathTick();moveTo(e,good.x,good.y,1/60,2.4);ok(sane(e)&&!solidAt(e.x,e.y),'a walker that lost its position stands at its target');
  e=walker(good.x,good.y);const before={x:e.x,y:e.y};for(const [dt,sp] of [[NaN,2],[1/60,undefined],[1/60,-1]]){pathTick();moveTo(e,good.x+6,good.y,dt,sp)}ok(e.x===before.x&&e.y===before.y,'a bad pace walks nowhere, and never jumps');
  let bad=0;for(const p of [{},{pts:null},{pts:[1],i:0},{pts:[NaN,NaN],i:0,tx:good.x,ty:good.y,lx:good.x,ly:good.y},{pts:[good.x,good.y],i:NaN},{pts:[good.x,good.y],i:1,tx:1,ty:1,lx:1,ly:1},{none:1,tx:NaN}]){const f=walker(good.x,good.y,{path:p});try{for(let i=0;i<20;i++){pathTick();moveTo(f,good.x+2,good.y,1/60,2.4)}}catch(err){bad++}if(!sane(f))bad++}ok(bad===0,'an unreadable path, as a bad save could leave, is dropped and planned again ('+bad+')');
  ok(route(good.x,good.y,NaN,1)===null&&route(NaN,1,good.x,good.y)===null,'route refuses what is not a place');
  const t1=performance.now();blockedBy(good.x,good.y,1e308,5);blockedBy(good.x,good.y,Infinity,5);ok(performance.now()-t1<50,'a target far off the map costs no walk there')}

// ---- doors and walls ----
for(const c of CITY){let bad=0;const sp=Object.values(c.spots);for(const a of sp)for(const b of sp){const e=walker(a.x,a.y);if(walk(e,b.x,b.y,3000)<0||Math.hypot(e.x-b.x,e.y-b.y)>.2)bad++}
  const e=walker(c.spots.square.x,c.spots.square.y);let wet=walk(e,c.gate.x,c.gate.y,4000);ok(bad===0&&wet>=0,c.name+': every spot walks to every other, and out of the gate')}

// ---- mobs ----
{const type=Object.keys(MOBS)[0],m=spawnMob(type);S.mobs.splice(S.mobs.indexOf(m),1);
  // the far bank of a river, or the far side of solid ground: too far for a common mob's search
  const a=(()=>{for(const P of ZPTS)for(const p of P)if(Math.hypot(p.x-gates[0].x,p.y-gates[0].y)>30)return p})();
  m.x=gates[0].x;m.y=gates[0].y;m.path=null;const n0=pathStats.nodes;pathTick();
  moveTo(m,a.x,a.y,1/60,2.1);ok(pathStats.nodes-n0<=PATH.MOB_NODES,'a common mob searches at most '+PATH.MOB_NODES+' nodes ('+(pathStats.nodes-n0)+')');
  const lim=PATH.MOB_NODES;PATH.MOB_NODES=5;m.x=gates[0].x;m.y=gates[0].y;m.path=null;pathTick();const did=moveTo(m,a.x,a.y,1/60,2.1);PATH.MOB_NODES=lim;ok(did===true&&noWay(m),'past its limit it has no way, and says so');
  init();let far=0,n=0;for(let i=0;i<3000;i++){step(1/60);if(i%60)continue;for(const q of S.mobs){if(!q.alive||q.gone||q.target||q.elite||q.add||q.adv||q.lever)continue;n++;if(Math.hypot(q.x-q.home.x,q.y-q.home.y)>13)far++}}
  ok(far<n*.01,'wander stays local ('+far+' of '+n+' samples past the leash)')}

// ---- save mid-path ----
{seedRng(7);init({fellowship:false});for(let i=0;i<1800;i++)step(1/60);
  const a=S.agents.find(h=>h.path&&h.path.pts.length>4)||S.agents.find(h=>h.path);ok(!!a,'somebody is mid-path');
  const snap=JSON.parse(JSON.stringify(snapshot()));const id=a.id,rec=[];
  seedRng(11);for(let i=0;i<200;i++){step(1/60);rec.push(S.agents.find(h=>h.id===id).x)}
  restore(snap);const b=S.agents.find(h=>h.id===id);ok(!!b.path&&JSON.stringify(b.path)===JSON.stringify(snap.agents.find(h=>h.id===id).path),'the path comes back with the save');
  seedRng(11);let same=0;for(let i=0;i<200;i++){step(1/60);if(S.agents.find(h=>h.id===id).x===rec[i])same++}ok(same===200,'a restored walker walks the same steps ('+same+'/200)');seedRng(null)}

// ---- the agent's answer ----
{init({fellowship:false});const a=S.agents.find(h=>h.state!=='dead');markPlayer(a,true);const c=CITY.find(t=>t.fac===a.fac)||CITY[0];
  a.x=c.gate.x;a.y=c.gate.y;a.state='hunt';a.lvl=20;a.adv=null;
  const far=ZPTS.flat().filter(p=>Math.hypot(p.x-a.x,p.y-a.y)>20&&!CITY.some(t=>t.fac!==a.fac&&(Math.hypot(p.x-t.gate.x,p.y-t.gate.y)<14||(p.x>=t.x0-3&&p.x<=t.x1+3&&p.y>=t.y0-3&&p.y<=t.y1+3)))).find(p=>{const r=route(a.x,a.y,p.x,p.y);return r&&r.cross});
  const r=playerAct(a.id,'move_to',{target:Math.floor(far.x)+','+Math.floor(far.y)}),o=r&&r.result||r;
  ok(o&&o.ok&&o.going&&o.distance!=null,'move_to keeps its line ('+(o&&o.going)+', '+(o&&o.distance)+')');
  ok(o&&o.route&&o.route.tiles>=o.distance-1&&o.route.by&&o.route.by.length>0,'and adds the route: '+JSON.stringify(o&&o.route));
  const z=o&&o.route&&o.route.by&&o.route.by[0];
  a.lore=a.lore||{};const words=JSON.stringify(o.route);const known=ZONES.filter(n=>words.includes(n));
  ok(known.every(n=>{const q=playerAct(a.id,'places',{});return JSON.stringify(q).includes(n)}),'the route names only places the hero knows ('+(known.join(', ')||'none')+')');
  ok(!!z&&/^(bridge|ford)$/.test(z.crossing),'the crossing is a fact: '+JSON.stringify(z))}

// ---- a long run ----
{const run=seed=>{seedRng(seed);init();const P=[];let bad=new Map(),stuck=0;const who=[],last=new Map();
    for(let i=0;i<20*3600;i++){step(1/60);if(i%30)continue;
      for(const L of [S.agents,S.mobs,S.npcs||[],S.wanderers||[],S.traffic&&S.traffic.list||[],S.traffic&&S.traffic.guards||[]])for(const e of L){if(e.state==='dead'||e.hidden||e.alive===false||e.gone)continue;
        if(solidAt(e.x,e.y)){const k=(e.kind||'person')+':'+(e.state||'')+':'+solidWhy(e.x,e.y);bad.set(k,(bad.get(k)||0)+1)}}
      if(i%600)continue;
      for(const a of S.agents){if(a.state!=='travel'&&a.state!=='return'){last.delete(a);continue}const p=last.get(a);if(p&&p.st===a.state&&Math.hypot(p.x-a.x,p.y-a.y)<.01){stuck++;who.push(a.name+'@'+a.x.toFixed(1)+','+a.y.toFixed(1)+' '+a.state)}last.set(a,{x:a.x,y:a.y,st:a.state})}}
    seedRng(null);return {bad,stuck,who,sig:S.agents.map(a=>a.x.toFixed(4)+','+a.y.toFixed(4)).join('|')}};
  const A=run(5),B=run(5);
  ok(A.bad.size===0,'20 minutes: nobody stands in a solid tile'+(A.bad.size?' '+JSON.stringify([...A.bad]):''));
  ok(A.stuck===0,'nobody travelling stands fast for 10 seconds ('+A.stuck+(A.stuck?' '+A.who.join(' '):'')+')');
  ok(A.sig===B.sig,'a seeded run repeats')}

console.log('plans',pathStats.plans,'worst search',pathStats.peak,'nodes');
if(!process.env.ELDMOOR_WORLD&&!process.env.PATH_CHILD)for(const w of ['stepping','vale']){const r=spawnSync(process.execPath,[process.argv[1]],{env:{...process.env,ELDMOOR_WORLD:w,PATH_CHILD:'1'},stdio:'inherit'});if(r.status)fail++}
if(fail){console.log(fail+' check(s) failed');process.exit(1)}console.log('pathcheck ok');
