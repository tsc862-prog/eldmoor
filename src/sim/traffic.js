// Road traffic and guard patrols (#796, slice 5 of the solid-world epic #791): the people between the towns.
// Carts and travellers leave the towns on a schedule and walk the road net; guards walk the gate roads and the bridges by
// the hour. Nobody here fights, has HP or a level, and no hero or mob is moved or touched by them. What they do:
//   - walk: a walker follows a list of road tiles, derived once from the map (ROAD and BRIDGE tiles, tile by tile), so traffic
//     needs no path planner, stays on the road whatever moveTo does, and new towns on the road net join by themselves.
//   - carry goods: a cart of a traded good that arrives adds TRAFFIC.SUPPLY to its auction-house supply (the small price effect).
//   - carry word: a cart or traveller leaves with the DM's live rumours of its town; on arrival the next town has the word too,
//     and an agent hero it passes within RUMOUR_R tiles hears it on the road (sim/rumours.js tell, once a game day as ever).
//   - get beset: a creature wandering by may stop one (the mob itself is not touched: it may wander off again), or the DM's
//     staged ambush may (stage_scene near "traffic:<n>"). Agent heroes in sight are told. The rescue offer in a world with
//     runners is a staged scene through stageScene, so its caps, reserve and pile-on rule are the DM's own; killing the
//     creature is a rescue too. One left alone may be lost.
//   - be seen: look and the turn header name those in sight, in words, no numbers (roadSight). Fuller wording is slice 6 (#797).
// Drawing is not here: S.traffic is plain data, a renderer may read list[] and guards[] ({x, y, face, moving, kind, on}).
//
// Seeded worlds: all dice are this module's own LCG (the seed lives on S.traffic, so a load goes on with it), ids are its own
// counter (never S.uid), and nothing reads the gameplay RNG. The only reach into the scripted world is TRAFFIC.MARKET (the
// supply a cart adds, and a rescuer's thanks): with it false every seeded hash equals a world without traffic (trafficcheck).
//
// State (plain JSON on S, saved with the world, made by the first tick):
//   S.traffic {seed, seq, hour, list:[walker], guards:[guard], day:{d, rescues}, stats}
//   walker {id, n, kind:'cart'|'traveller', word, good?, from, to, p, sp, lane, x, y, face, moving, wait, scan, news:[rumour id], beset?, home?}
//   guard  {id, kind:'guard', post, shift, town, p, dir, sp, x, y, face, moving, on}
//   beset  {mob?, foe, since, until, chk, staged?}
// DOM-free. Owned by ai-designer; the road net it reads is world-builder's.
import {S,dayNo} from './state.js';
import {onWorld} from './kept.js';
import {tiles,I,CITY,LANDMARKS,OUTPOSTS,ZONES,zoneAt,dist} from '../world/map.js';
import {W,H,ROAD,BRIDGE} from '../world/tiles.js';
import {solidAt} from '../world/passable.js';
import {CARGO,TRAVELLERS,ROAD_WORDS} from '../data/traffic.js';
import {GOODS} from '../data/items.js';
import {MOBS} from '../data/mobs.js';
import {log} from './chronicle.js';
import {record} from './history.js';
import {notify} from './notify.js';
import {nearHeroes,nearMobs,within} from './spatial.js';
import {foeName,hear} from './lore.js';
import {sightRange,compass} from './sighthero.js';
import {hasLinks} from './runlink.js';
import {companyOf} from './company.js';
import {stageScene} from './staged.js';
import {liveRumours,tell,RUMOUR} from './rumours.js';

export const TRAFFIC={
  ON:true,          // false: the roads stand empty
  MARKET:true,      // false: carts add no supply and rescuers get no thanks in gold, so the scripted world is exactly a world without traffic
  GAP:4,            // game hours between departures from one town
  DAY:[6,20],       // the hours anyone sets out
  PER_TOWN:3,       // walkers on the roads at once, per town ...
  BASE:2,           // ... plus this many ...
  CAP:60,           // ... and never more than this
  CART_SP:.55,      // tiles a real second at 1x (a hero walks about 1): a cart is slow
  FOOT_SP:.8,
  GUARD_SP:.45,
  TURN_S:12,        // real seconds someone stays at a road's end before turning back
  SUPPLY:2,         // auction-house supply one cart of a traded good adds (one good sold by a hero adds 1; supply decays 2.5% a second)
  SCAN:6,           // real seconds between a walker's looks around
  CHECK:1,          // real seconds between checks on a beset walker
  BESET_R:2.5,      // tiles: how near a creature must wander to stop someone
  BESET_P:.12,      // the chance it does, per look
  BESET_MIN:180,    // game minutes a beset walker holds out
  LEAVE_R:6,        // tiles: a creature this far off has lost interest, and the walker goes on
  LOST_P:.5,        // the chance one left alone to the end is lost (else it limps on)
  GUARD_R:6,        // tiles round a guard on duty where nothing besets anyone
  HELP_R:7,         // tiles: a hero this near when the creature dies gets the credit
  RESCUE_R:12,      // tiles: an agent company member this near may be offered the rescue
  RESCUE_MIN:180,   // game minutes a staged rescue waits for them
  RESCUE_DAY:1,     // rescue scenes offered a game day (on top of the DM's own caps, which also apply)
  THANKS:6,THANKS_LVL:1, // gold a rescued carter gives an agent hero: 6 + 1 a level
  RUMOUR_R:4,       // tiles: passing this near an agent hero, a walker tells its news
  GATE_BEAT:5,BRIDGE_BEAT:4, // road tiles a guard walks out from the gate, and to each side of a bridge
  SHIFTS:{day:[6,20],night:[20,6]},
  SEEN:4,           // people named in look at most
  BRIEF:2,          // ... and in the turn header
};
const SEED0=0x7a11c0de;
const inHours=([a,b],h)=>b>a?h>=a&&h<b:h>=a||h<b;
const an=w=>/^[aeiou]/i.test(w)?'an':'a';
const fill=(s,o)=>s.replace(/\{(\w+)\}/g,(_,k)=>o[k]!=null?o[k]:k);

// ---- the road net: from the map, once a world ----
// A stop is a place on the net: a town's gate, an outpost, a landmark. Non-town stops are ends of the road: people turn back there.
const walkable=i=>{const t=tiles[i],x=i%W,y=(i-x)/W;return (t===ROAD||t===BRIDGE)&&!solidAt(x+.5,y+.5)};
function roadNear(x,y,r){const cx=Math.floor(x),cy=Math.floor(y);let best=-1,bd=Infinity;
  for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const tx=cx+dx,ty=cy+dy;if(tx<0||ty<0||tx>=W||ty>=H)continue;const i=I(tx,ty);if(!walkable(i))continue;
    const d=Math.hypot(tx+.5-x,ty+.5-y);if(d<bd){bd=d;best=i}}
  return best}
const STEPS=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
const neighbours=i=>{const x=i%W,y=(i-x)/W,out=[];
  for(const [dx,dy] of STEPS){const tx=x+dx,ty=y+dy;if(tx<0||ty<0||tx>=W||ty>=H)continue;const j=I(tx,ty);if(walkable(j))out.push(j)}
  return out};
// Breadth first along the road from tile s, at most `depth` steps: {prev: tile -> the tile it was reached from, far: the last tile reached}.
function flood(s,depth=Infinity){const prev=new Map([[s,-1]]);let cur=[s],far=s,d=0;
  while(cur.length&&d<depth){const nx=[];for(const i of cur)for(const j of neighbours(i))if(!prev.has(j)){prev.set(j,i);nx.push(j);far=j}cur=nx;d++}
  return {prev,far}}
const unwind=(prev,t)=>{const out=[];for(let i=t;i!==-1&&i!=null;i=prev.get(i))out.push(i);return out.reverse()};
// A beat: road tiles from tile s out `depth` steps; through: from `depth` out on one side to `depth` out on the other.
const beatFrom=(s,depth)=>{const A=flood(s,depth);return unwind(A.prev,A.far)};
const beatThrough=(s,depth)=>{const B=flood(flood(s,depth).far,depth*2);return unwind(B.prev,B.far)};
const middleOf=l=>l.mouth?{x:l.mouth.x0+(l.mouth.w||0)/2,y:l.mouth.y0+(l.mouth.h||0)/2}:{x:l.x,y:l.y};

let NET=null;
onWorld(()=>{NET=null},()=>{const n=net();return {roadStops:n.stops,roadPosts:[...n.posts.keys()]}}); // another map (#1013): its own road net
function net(){if(NET)return NET;const stops=[];
  const add=(name,kind,p,r)=>{const tile=roadNear(p.x,p.y,r);if(tile>=0)stops.push({name,kind,tile})};
  for(const c of CITY)add(c.name,'town',c.gate,4);
  for(const o of OUTPOSTS||[])add(o.name,'outpost',o,6);
  for(const l of LANDMARKS)if(l.kind!=='lair')add(l.name,'landmark',middleOf(l),Math.ceil((l.r||0)+4)); // nobody walks to a wyrm's lair for choice
  const byName=new Map(stops.map(s=>[s.name,s])),trees=new Map(),routes=new Map();
  const tree=s=>{if(!trees.has(s.name))trees.set(s.name,flood(s.tile).prev);return trees.get(s.name)};
  // the tiles from stop a to stop b, or null
  const route=(a,b)=>{const k=a+'>'+b;if(routes.has(k))return routes.get(k);const A=byName.get(a),B=byName.get(b),P=A&&B?tree(A):null,r=P&&P.has(B.tile)?unwind(P,B.tile):null;routes.set(k,r&&r.length>1?r:null);return routes.get(k)};
  // guard posts: every town gate on the net, and every bridge (a run of BRIDGE tiles) on it, kept by the nearest town
  const posts=new Map(),seen=new Set();
  for(const s of stops)if(s.kind==='town')posts.set('gate:'+s.name,{kind:'gate',town:s.name,beat:beatFrom(s.tile,TRAFFIC.GATE_BEAT)});
  for(let i=0;i<W*H;i++){if(tiles[i]!==BRIDGE||seen.has(i)||!walkable(i))continue;const run=[i];seen.add(i);
    for(let k=0;k<run.length;k++)for(const j of neighbours(run[k]))if(tiles[j]===BRIDGE&&!seen.has(j)){seen.add(j);run.push(j)}
    const mid=run[run.length>>1],x=mid%W,y=(mid-x)/W,c=CITY.slice().sort((p,q)=>Math.hypot(p.gate.x-x,p.gate.y-y)-Math.hypot(q.gate.x-x,q.gate.y-y))[0];
    if(c)posts.set('bridge:'+mid,{kind:'bridge',town:c.name,beat:beatThrough(mid,TRAFFIC.BRIDGE_BEAT)})}
  for(const [k,p] of posts)if(p.beat.length<2)posts.delete(k);
  return NET={stops,byName,route,posts}}

// ---- state ----
export function trafficState(){return S.traffic||(S.traffic={seed:SEED0,seq:0,hour:-1,list:[],guards:[],day:{d:0,rescues:0},stats:{departed:0,arrived:0,turned:0,beset:0,freed:0,rescued:0,lost:0,staged:0,goods:0,news:0,told:0}})}
const rand=T=>{T.seed=(Math.imul(T.seed,1103515245)+12345)&0x7fffffff;return T.seed/0x80000000};
const pick=(T,L)=>L[Math.floor(rand(T)*L.length)];
const towns=()=>net().stops.filter(s=>s.kind==='town');
export const trafficCap=()=>Math.min(TRAFFIC.CAP,TRAFFIC.BASE+TRAFFIC.PER_TOWN*towns().length);
function place(e,R,p,lane=0){const i=Math.min(R.length-2,Math.max(0,Math.floor(p))),f=Math.min(1,p-i),a=R[i],b=R[i+1],ax=a%W,ay=(a-ax)/W,bx=b%W,by=(b-bx)/W;
  const tx=f<.5?ax:bx,ty=f<.5?ay:by,cl=(v,t)=>Math.min(t+.98,Math.max(t+.02,v)); // the corner of a diagonal step is another tile: stay on this one
  e.x=cl(ax+(bx-ax)*f+.5+lane,tx);e.y=cl(ay+(by-ay)*f+.5+lane,ty);if(bx!==ax)e.face=bx>ax?1:-1}
const nameOf=w=>w.kind==='cart'?fill(ROAD_WORDS.cart,{a:an(w.word),word:w.word}):an(w.word)+' '+w.word;
const bare=w=>nameOf(w).replace(/^an? /,'');

// ---- setting out ----
function depart(T,from){const N=net(),out=N.stops.filter(s=>s!==from&&N.route(from.name,s.name));if(!out.length)return null;
  const cart=T.stats.departed%2===0,dest=out.filter(s=>s.kind==='town'),to=pick(T,cart&&dest.length?dest:out);
  const row=pick(T,cart?CARGO:TRAVELLERS),n=++T.seq,R=N.route(from.name,to.name);
  const w={id:'t'+n,n,kind:cart?'cart':'traveller',word:row.word,...(row.good?{good:row.good}:{}),from:from.name,to:to.name,p:0,sp:cart?TRAFFIC.CART_SP:TRAFFIC.FOOT_SP,lane:(rand(T)-.5)*.5,x:0,y:0,face:1,moving:true,wait:0,scan:TRAFFIC.SCAN*rand(T),news:[]};
  for(const r of liveRumours())if(r.towns.includes(from.name))w.news.push(r.id);
  place(w,R,0,w.lane);T.list.push(w);T.stats.departed++;return w}
function schedule(T,h){if(!inHours(TRAFFIC.DAY,h))return;
  towns().forEach((s,i)=>{if((h+i)%TRAFFIC.GAP===0&&T.list.length<trafficCap())depart(T,s)})}

// ---- arriving ----
function spreadNews(T,w,town){if(!w.news.length||!S.rumours)return;const L=liveRumours();
  for(const id of w.news){const r=L.find(x=>x.id===id);if(!r||r.towns.includes(town))continue;if(L.filter(x=>x.towns.includes(town)).length>=RUMOUR.PER_TOWN)break;r.towns.push(town);T.stats.news++}}
// True when the walker leaves the road: in at a town's gate, or home from a road's end.
function arrive(T,w){const s=net().byName.get(w.to);T.stats.arrived++;
  if(s&&s.kind==='town'){spreadNews(T,w,s.name);
    if(w.good&&TRAFFIC.MARKET&&GOODS[w.good]){GOODS[w.good].supply+=TRAFFIC.SUPPLY;T.stats.goods+=TRAFFIC.SUPPLY}
    return true}
  if(w.home)return true;
  T.stats.turned++;const f=w.from;w.from=w.to;w.to=f;w.p=0;w.wait=TRAFFIC.TURN_S;w.home=true;w.moving=false;return false}

// ---- trouble ----
const living=b=>b&&b.state!=='dead'&&!b.hidden;
const mobById=id=>S.mobs.find(m=>m.id===id)||null;
const here=w=>ZONES[zoneAt(w.x,w.y)]||'the wilds';
const foeWord=m=>m.name||(MOBS[m.type]?an(MOBS[m.type].name)+' '+MOBS[m.type].name.toLowerCase():'something');
function goOn(w){w.beset=null;w.moving=true}
function lost(T,w){T.stats.lost++;T.list.splice(T.list.indexOf(w),1);log('A ',bare(w),' never came off the road in ',here(w),'.')}
function endAlone(T,w){if(rand(T)<TRAFFIC.LOST_P)lost(T,w);else{T.stats.freed++;goOn(w)}}
function rescued(T,w,h,foe){T.stats.rescued++;goOn(w);
  log(h,' drove ',foe,' off ',nameOf(w),' on the road in ',here(w),'.');
  record(h,'Drove ',foe,' off ',nameOf(w),' on the road.');
  if(!h.player)return;
  const gold=TRAFFIC.MARKET?TRAFFIC.THANKS+TRAFFIC.THANKS_LVL*h.lvl:0;if(gold)h.gold+=gold;
  notify(h,(w.kind==='cart'?'The carter':'The '+w.word)+' thanks you'+(gold?' and presses '+gold+' gold on you':'')+', and goes on toward '+w.to+'.',1)}
// A staged scene ends for the walker it was about (sim/staged.js): won by these heroes, or left to it.
// mob: the scene never played and this creature of its cast is still out there, so the walker stays held by it.
export function trafficSceneEnd(id,won,ids=[],mob=null){const T=S.traffic,w=T&&T.list.find(x=>x.id===id);if(!w||!w.beset)return;
  if(mob!=null){w.beset.staged=null;w.beset.mob=mob;w.beset.until=Math.round(S.gameMin+TRAFFIC.BESET_MIN);return}
  const h=won?ids.map(i=>S.agents.find(a=>a.id===i)).find(b=>living(b)&&within(b,w,TRAFFIC.RESCUE_R)):null;
  if(h)rescued(T,w,h,w.beset.foe);else if(won){T.stats.freed++;goOn(w)}else endAlone(T,w)}
// The creature is dead or bored, or the time is up.
function hold(T,w,dt){const B=w.beset;B.chk-=dt;if(B.chk>0)return;B.chk=TRAFFIC.CHECK;
  if(B.staged!=null)return; // its scene ends it (trafficSceneEnd)
  const m=mobById(B.mob);
  if(!m||!m.alive||m.gone){const h=nearHeroes(w.x,w.y,TRAFFIC.HELP_R,living).sort((a,b)=>dist(a,w)-dist(b,w)||a.id-b.id)[0];if(h)rescued(T,w,h,B.foe);else{T.stats.freed++;goOn(w)}return}
  if(!within(m,w,TRAFFIC.LEAVE_R)){T.stats.freed++;goOn(w);return}
  if(S.gameMin>=B.until)endAlone(T,w)}
// The rescue hook: only with a host and runners (a world that can play the scene), through the DM's own stage caps.
function offerRescue(T,w,m){if(!hasLinks())return;const d=dayNo();if(T.day.d!==d)T.day={d,rescues:0};if(T.day.rescues>=TRAFFIC.RESCUE_DAY)return;
  const h=nearHeroes(w.x,w.y,TRAFFIC.RESCUE_R,b=>living(b)&&b.player&&!!companyOf(b))[0];if(!h)return;
  const M=MOBS[m.type];if(!M||M.z!==zoneAt(w.x,w.y))return; // a stray from another region: stage_scene casts a region's own creatures
  const foe=M.pl.toLowerCase();
  const r=stageScene({kind:'ambush',near:'traffic:'+w.n,title:'Trouble on the road',frame:'Ahead on the road '+nameOf(w)+' has stopped dead, with '+foe+' all round it.',reason:'a '+bare(w)+' beset on the road, a hero in reach',cast:{foe:m.type}},{by:'scripted',quiet:true,minutes:TRAFFIC.RESCUE_MIN});
  if(r.ok){T.day.rescues++;T.stats.staged++}}
function tellBeset(w,m){for(const a of nearHeroes(w.x,w.y,TRAFFIC.RESCUE_R,b=>living(b)&&b.player))if(dist(a,w)<=sightRange(a))notify(a,'On the road '+compass(a,w)+' of you, '+nameOf(w)+' has stopped: '+foeName(a,m)+' is on it.',1)}
// Stop a walker: for a wandering creature, or for a staged foe (the staged scene ends it).
export function besetBy(w,B){const T=trafficState();w.beset={chk:TRAFFIC.CHECK,since:Math.round(S.gameMin),until:Math.round(S.gameMin+TRAFFIC.BESET_MIN),...B};w.moving=false;T.stats.beset++}
// A staged foe falls on walker w: the scene owns it from here (held by a creature already, or stopped now).
export function stagedBeset(w,rid,foe){if(w.beset)w.beset.staged=rid;else besetBy(w,{foe:foe||'something',staged:rid})}
function lookAround(T,w){
  if(w.news.length)roadNews(T,w);
  for(const m of nearMobs(w.x,w.y,TRAFFIC.BESET_R)){if(!m.alive||m.gone||m.hidden||m.target||m.staged!=null)continue;
    if(rand(T)>=TRAFFIC.BESET_P||trafficNear(w.x,w.y,TRAFFIC.GUARD_R,g=>g.kind==='guard').length)return;
    besetBy(w,{mob:m.id,foe:foeWord(m)});tellBeset(w,m);offerRescue(T,w,m);return}}
// Word told in passing: an agent hero in reach hears what the walker carries (a rumour once a game day, as from a townsperson).
function roadNews(T,w){const L=liveRumours(),d=dayNo();if(!L.length){w.news.length=0;return}
  const near=nearHeroes(w.x,w.y,TRAFFIC.RUMOUR_R,b=>living(b)&&b.player);if(!near.length)return;
  const teller={id:w.id,name:nameOf(w),role:'road'};
  for(const a of near)for(const id of w.news){const r=L.find(x=>x.id===id);if(!r||r.heard[a.id]===d)continue;notify(a,'From '+nameOf(w)+' as it passes: '+tell(r,teller,a,'road'));T.stats.told++}}

// ---- guards ----
function ensureGuards(T){if(T.guards.length)return;let n=0;
  for(const [post,P] of net().posts){const shifts=P.kind==='gate'?['day','day','night']:['day'];
    shifts.forEach((shift,k)=>{const g={id:'g'+(++n),kind:'guard',post,shift,town:P.town,p:k*(P.beat.length-1)/2,dir:k%2?-1:1,sp:TRAFFIC.GUARD_SP,x:0,y:0,face:1,moving:false,on:false};place(g,P.beat,g.p);T.guards.push(g)})}}
function patrol(g,dt,h){const P=net().posts.get(g.post);if(!P)return;g.on=inHours(TRAFFIC.SHIFTS[g.shift],h);g.moving=g.on;if(!g.on)return;
  const end=P.beat.length-1;g.p+=g.dir*g.sp*dt;if(g.p>=end){g.p=end;g.dir=-1}else if(g.p<=0){g.p=0;g.dir=1}place(g,P.beat,g.p)}

// ---- the tick ----
export function trafficTick(dt){if(!TRAFFIC.ON)return;const T=trafficState();ensureGuards(T);
  const hr=Math.floor(S.gameMin/60),h=hr%24;if(hr!==T.hour){T.hour=hr;schedule(T,h)}
  for(const g of T.guards)patrol(g,dt,h);
  for(let i=T.list.length-1;i>=0;i--){const w=T.list[i];
    if(w.beset){hold(T,w,dt);continue}
    if(w.wait>0){w.wait-=dt;if(w.wait<=0)w.moving=true;continue}
    const R=net().route(w.from,w.to);if(!R){T.list.splice(i,1);continue} // the map changed under an old save: this road is gone
    w.p+=w.sp*dt;if(w.p>=R.length-1){if(arrive(T,w))T.list.splice(i,1);continue}
    place(w,R,w.p,w.lane);w.scan-=dt;if(w.scan<=0){w.scan=TRAFFIC.SCAN;lookAround(T,w)}}}

// ---- who reads it ----
// The one scan of the road's people: walkers and guards on duty within r tiles of (x,y). Small lists, so linear; a bigger world moves this to sim/spatial.js.
export function trafficNear(x,y,r,pred){const T=S.traffic;if(!T)return [];const P={x,y},out=[];
  for(const w of T.list)if(within(w,P,r)&&(!pred||pred(w)))out.push(w);
  for(const g of T.guards)if(g.on&&within(g,P,r)&&(!pred||pred(g)))out.push(g);
  return out}
function lineOf(a,e){if(e.kind==='guard')return fill(ROAD_WORDS[net().posts.get(e.post).kind],{town:e.town});
  if(!e.beset)return nameOf(e)+' '+fill(ROAD_WORDS.heading,{to:e.to});
  const m=e.beset.mob!=null?mobById(e.beset.mob):null;return nameOf(e)+' '+fill(ROAD_WORDS.beset,{foe:m?foeName(a,m):e.beset.foe})}
// What a hero can see of the road's people, nearest first, as lines of words: the sight rule of look, never from inside a town's walls.
export function roadSight(a,n=TRAFFIC.SEEN){if(!a||!S.traffic||a.state==='town'||a.hidden)return [];
  return trafficNear(a.x,a.y,sightRange(a)).sort((p,q)=>dist(a,p)-dist(a,q)||String(p.id).localeCompare(String(q.id))).slice(0,n)
    .map(e=>{const d=Math.round(dist(a,e));return lineOf(a,e)+(d<2?', beside you':', '+d+' tiles '+compass(a,e))})}
// look: the same lines, and a place a passer-by is heading for is a place the hero has now heard of.
export function roadLook(a){const out=roadSight(a);if(out.length&&a.player)for(const w of trafficNear(a.x,a.y,sightRange(a),e=>e.kind!=='guard'))hear(a,'Heading for '+w.to,'a passer-by');return out}
// A walker by its DM reference, "traffic:<n>", or its words ("the salt cart").
export function trafficBy(s){const T=S.traffic;if(!T)return null;const lo=String(s||'').toLowerCase().replace(/^(an?|the)\s+/,''),m=/^traffic\s*[:#]?\s*(\d+)$/.exec(lo);
  return m?T.list.find(w=>w.n===Number(m[1]))||null:T.list.find(w=>bare(w).toLowerCase()===lo)||null}
// dm_status: who is on the road, nearest the given heroes first, for stage_scene near "traffic:<n>". Null when the roads are empty.
export function trafficView(heroes=[]){const T=S.traffic;if(!T||!T.list.length)return null;const d=w=>heroes.reduce((b,a)=>Math.min(b,dist(a,w)),1e9);
  return T.list.slice().sort((p,q)=>d(p)-d(q)||p.n-q.n).slice(0,6).map(w=>({ref:'traffic:'+w.n,what:nameOf(w),heading:w.to,region:here(w),at:Math.round(w.x)+','+Math.round(w.y),...(w.beset?{beset:w.beset.foe}:{}),...(w.news.length?{carries_word:w.news.length}:{})}))}
export const trafficStops=()=>net().stops.map(s=>({name:s.name,kind:s.kind}));
export const trafficRoute=(a,b)=>net().route(a,b);
export const trafficPosts=()=>[...net().posts].map(([k,p])=>({key:k,kind:p.kind,town:p.town,beat:p.beat}));
