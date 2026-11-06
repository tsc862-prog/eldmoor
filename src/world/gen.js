// World generator: turns a spec (see spec.js) into tiles, zones, towns,
// landmarks, roads, spawn points, lights and labels. Deterministic; the only
// randomness is in zonePoint, which picks from the precomputed spawn lists.
// Knows nothing about the map size in tiles.js: every array is sized from the
// spec, so several worlds can be built side by side (scripts/worldcheck.mjs).
// Owned by world-builder.
import {hash,vnoise,fbm,clamp,pickA} from '../core/rng.js';
import {placeNodes} from './nodes.js';
import {solidGrid,landsOf} from './solidgrid.js';
import {TOWN_PIECES,TOWN_REF} from '../data/townart.js';
import {G,TREE,SWAMP,MUD,ROCK,PEAK,LAVA,ROAD,FLOOR,WALL,RIVER,BRIDGE,SGRASS,FLOWER,SNOW,ICE,WALKABLE} from './tiles.js';

// ---- biomes: tile painters. n and n2 are the two fbm fields of the spec seeds.
export const BIOMES={
  meadow:(x,y,n,n2)=>n>.58?TREE:(hash(x,y,5)>.95?FLOWER:G),
  fen:(x,y,n,n2)=>n>.6?SWAMP:n2>.63?TREE:(hash(x,y,6)>.5?SGRASS:MUD),
  ash:(x,y,n,n2)=>n>.6?PEAK:n2>.66?LAVA:ROCK,
  tundra:(x,y,n,n2)=>n>.68?PEAK:n2>.64?TREE:vnoise(x/2.5,y/2.5,31)>.74?ICE:hash(x,y,8)>.94?ROCK:SNOW,
  // Dry upland: grass, scree and stunted trees, a few crags. Reuses existing tiles.
  highland:(x,y,n,n2)=>n>.66?PEAK:n2>.62?TREE:vnoise(x/3,y/3,41)>.66?ROCK:(hash(x,y,9)>.94?FLOWER:G),
};

// Travel cost per tile for road routing. Rivers are crossable but dear, so a
// routed road bridges once at a narrow point instead of running along the bank.
const ROAD_COST=[];
ROAD_COST[G]=1;ROAD_COST[FLOWER]=1;ROAD_COST[SGRASS]=1.1;ROAD_COST[MUD]=1.4;ROAD_COST[TREE]=1.8;ROAD_COST[ROCK]=1.3;
ROAD_COST[SNOW]=1.2;ROAD_COST[ICE]=1.2;ROAD_COST[SWAMP]=3;ROAD_COST[PEAK]=4;ROAD_COST[LAVA]=12;ROAD_COST[RIVER]=6;
ROAD_COST[ROAD]=.4;ROAD_COST[BRIDGE]=.4;ROAD_COST[FLOOR]=Infinity;ROAD_COST[WALL]=Infinity;

// ---- curves: t -> integer threshold.
function compileCurve(c){
  const sin=c.sin||[],nz=c.noise,wp=c.warp; // warp {at, by} (a world widened in the middle, #979): from `at` on the curve reads the line `by` columns back
  return t=>{if(wp&&t>=wp.at)t-=wp.by;let v=0;for(const [p,a,ph=0] of sin)v+=Math.sin(t/p+ph)*a;
    if(nz)v+=((c.axis==='y'?vnoise(nz.slice,t/nz.scale,nz.seed):vnoise(t/nz.scale,nz.slice,nz.seed))-.5)*nz.amp;
    return c.base+Math.round(v)}}

// ---- masks: (x,y) -> boolean.
function compileMask(m,curves){
  const cv=()=>{const c=curves[m.curve];if(!c)throw new Error('world spec: unknown curve '+m.curve);return c.fn};
  switch(m.kind){
    case 'all':return()=>true;
    case 'rect':return(x,y)=>x>=m.x0&&x<=m.x1&&y>=m.y0&&y<=m.y1;
    case 'west-of-curve':{const c=cv();return(x,y)=>x<c(y)}
    case 'east-of-curve':{const c=cv();return(x,y)=>x>=c(y)}
    case 'north-of-curve':{const c=cv();return(x,y)=>y<c(x)}
    case 'south-of-curve':{const c=cv();return(x,y)=>y>=c(x)}
    case 'and':{const ms=m.masks.map(k=>compileMask(k,curves));return(x,y)=>ms.every(f=>f(x,y))}
    case 'or':{const ms=m.masks.map(k=>compileMask(k,curves));return(x,y)=>ms.some(f=>f(x,y))}
    case 'not':{const f=compileMask(m.mask,curves);return(x,y)=>!f(x,y)}
    default:throw new Error('world spec: unknown mask kind '+m.kind)}}

// ---- towns: the rect plus the interior points the sim uses.
// Default interior spots as fractions of the rect, in a frame where the gate is on the
// right (fx=1): quartermaster and gate are the old ah/qg offsets of an 11x9 east-gated
// town; the others place the inn south, the forge north, the chapel in the gate-side
// corner and the square mid-path. A spec may override any of them with [dx,dy] offsets.
const SPOT_DEFAULTS={quartermaster:[.35,.475],gate:[.75,.475],inn:[.35,.9125],smith:[.55,.2],chapel:[.85,.2375],square:[.55,.7625]};
function spotAt(t,fx,fy){const g=t.gate||'E',w=t.w-1,h=t.h-1;
  if(g==='E')return{x:t.x0+fx*w,y:t.y0+fy*h};
  if(g==='W')return{x:t.x0+(1-fx)*w,y:t.y0+fy*h};
  if(g==='S')return{x:t.x0+fy*w,y:t.y0+fx*h};
  return{x:t.x0+fy*w,y:t.y0+(1-fx)*h}}
// ---- town plans (#793): the buildings of a town as sim data, {piece, box:[x,y,w,h], door:[x,y], serves, draw}.
// The layout (data/townart.js TOWN_PIECES, drawn for an 11x9 town with the gate east) is mapped through the town's gate
// side and size like the spots; `draw` is that exact (maybe fractional) art box, `box` the whole tiles the building stands
// on (solid, src/world/passable.js), `door` the one open tile of the footprint, on the edge that faces the street that runs
// from the gate. The keeper of `serves` stands at the door: those spots are the door tiles. A spec town may list its own
// `buildings` instead (same shape, whole-tile boxes, door optional: the middle of the south edge).
function placeBox(t,[bx,by,bw,bh]){const fx=(bx+bw/2)/(TOWN_REF[0]-1),fy=(by+bh/2)/(TOWN_REF[1]-1),w=t.w-1,h=t.h-1,g=t.gate||'E';
  const p=g==='E'?[t.x0+fx*w,t.y0+fy*h]:g==='W'?[t.x0+(1-fx)*w,t.y0+fy*h]:g==='S'?[t.x0+fy*w,t.y0+fx*h]:[t.x0+fy*w,t.y0+(1-fx)*h];
  return [p[0]-bw/2,p[1]-bh/2,bw,bh]}
function planBuildings(t,gateTiles){
  const x0=t.x0,y0=t.y0,x1=x0+t.w-1,y1=y0+t.h-1,g=t.gate||'E',along=g==='E'||g==='W',E=1e-6;
  if(Array.isArray(t.buildings))return t.buildings.map(b=>{const [bx,by,bw,bh]=b.box;
    return{piece:b.piece,box:[bx,by,bw,bh],door:b.door?[b.door[0],b.door[1]]:[bx+Math.floor((bw-1)/2),by+bh-1],serves:b.serves||null,draw:b.draw||[bx,by,bw,bh],...(b.kit?{kit:b.kit}:{})}});
  // the street: the line through the middle of the two gate tiles
  const sx=gateTiles[0][0]+(along?0:1),sy=gateTiles[0][1]+(along?1:0);
  return TOWN_PIECES.map(P=>{const d=placeBox(t,P.box);
    let l=Math.ceil(d[0]-E),r=Math.floor(d[0]+d[2]+E),tp=Math.ceil(d[1]-E),b=Math.floor(d[1]+d[3]+E);
    if(r<=l){l=Math.round(d[0]+d[2]/2-.5);r=l+1}if(b<=tp){tp=Math.round(d[1]+d[3]/2-.5);b=tp+1}
    l=Math.max(l,x0+1);tp=Math.max(tp,y0+1);r=Math.min(r,x1);b=Math.min(b,y1); // inside the walls
    const w=r-l,h=b-tp;let door;
    if(along){const cy=tp+h/2;door=[l+Math.floor((w-1)/2),cy<sy?b-1:tp]}
    else{const cx=l+w/2;door=[cx<sx?r-1:l,tp+Math.floor((h-1)/2)]}
    return{piece:P.piece,box:[l,tp,w,h],door,serves:P.serves||null,draw:d}})}
function mkTown(t){
  const x0=t.x0,y0=t.y0,x1=x0+t.w-1,y1=y0+t.h-1,g=t.gate||'E';
  const mx=t.gateAt!=null?t.gateAt:Math.floor(t.w/2),my=t.gateAt!=null?t.gateAt:Math.floor(t.h/2); // middle wall tile (or the spec's `gateAt`, tiles from the corner); the gate is this tile and the next
  let gateTiles,gate;
  if(g==='E'){gateTiles=[[x1,y0+my],[x1,y0+my+1]];gate={x:x1+1.8,y:y0+my+1}}
  else if(g==='W'){gateTiles=[[x0,y0+my],[x0,y0+my+1]];gate={x:x0-.8,y:y0+my+1}}
  else if(g==='S'){gateTiles=[[x0+mx,y1],[x0+mx+1,y1]];gate={x:x0+mx+1,y:y1+1.8}}
  else{gateTiles=[[x0+mx,y0],[x0+mx+1,y0]];gate={x:x0+mx+1,y:y0-.8}}
  const buildings=planBuildings(t,gateTiles),spots={};
  for(const k in SPOT_DEFAULTS){const o=t.spots&&t.spots[k];
    spots[k]=o?{x:x0+o[0],y:y0+o[1]}:spotAt(t,SPOT_DEFAULTS[k][0],SPOT_DEFAULTS[k][1])}
  for(const k in t.spots||{})if(!spots[k])spots[k]={x:x0+t.spots[k][0],y:y0+t.spots[k][1]};
  for(const k of Object.keys(spots)){const b=buildings.find(q=>q.serves===k);if(b)spots[k]={x:b.door[0]+.5,y:b.door[1]+.5}} // the keeper stands at the door
  return{name:t.name,fac:t.fac,race:t.race===undefined?null:t.race,x0,x1,y0,y1,w:t.w,h:t.h,gateSide:g,gateTiles,buildings,...(t.wall?{wall:t.wall}:{}),...(t.ground?{ground:t.ground}:{}),...(t.notch?{notch:t.notch}:{}),...(t.homes?{homes:t.homes}:{}),
    spots,npcs:t.npcs||null,ah:spots.quartermaster,qg:spots.gate,gate,grave:t.grave?{x:x0+t.grave[0],y:y0+t.grave[1]}:{x:x1-1.5,y:y0+6.2},dx:x0-2,dy:y0-2}}
// A spec town's outline (#979): `notch: [[dx,dy,w,h], ...]` are rects at its edge left outside the walls, so the wall ring steps round them.
// The town's x0..y1 stay its bounds, which is all the sim asks of it. With no notch this is the plain rectangle.
const OPEN_GROUND={fen:SGRASS,ash:ROCK,tundra:SNOW}; // what a felled tree leaves, by biome (else grass)
export const outsideTown=(c,x,y)=>x<c.x0||x>c.x1||y<c.y0||y>c.y1||(c.notch||[]).some(([dx,dy,w,h])=>x>=c.x0+dx&&x<c.x0+dx+w&&y>=c.y0+dy&&y<c.y0+dy+h);
export function townRing(c,x,y){if(outsideTown(c,x,y))return false;for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++)if(outsideTown(c,x+i,y+j))return true;return false}

// ---- roads
// Paint a polyline: river tiles become bridges, everything but town tiles becomes road.
export function paintPolyline(world,pts){const {tiles,I,w,h}=world;
  const put=(x,y)=>{if(x<0||y<0||x>=w||y>=h)return;const t=tiles[I(x,y)];
    if(t===RIVER)tiles[I(x,y)]=BRIDGE;else if(t!==FLOOR&&t!==WALL&&t!==BRIDGE)tiles[I(x,y)]=ROAD};
  for(let i=0;i<pts.length-1;i++){const[a,b]=[pts[i],pts[i+1]];const n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])*3);
    for(let k=0;k<=n;k++)put(Math.round(a[0]+(b[0]-a[0])*k/n),Math.round(a[1]+(b[1]-a[1])*k/n))}}

// A* over tile cost from tile a to tile b (both [x,y] ints). 8-neighbour, so a
// routed road looks like the hand-drawn ones. Returns the tile list or null.
export function routeRoad(world,a,b){const {tiles,I,w,h}=world;
  const sx=clamp(a[0],0,w-1),sy=clamp(a[1],0,h-1),tx=clamp(b[0],0,w-1),ty=clamp(b[1],0,h-1);
  const N=w*h,gs=new Float64Array(N).fill(Infinity),prev=new Int32Array(N).fill(-1),closed=new Uint8Array(N);
  const heur=(x,y)=>Math.hypot(x-tx,y-ty)*.4; // ≤ the cheapest step cost, so A* stays exact
  const heap=[];const push=(f,i)=>{heap.push([f,i]);let k=heap.length-1;while(k>0){const p=(k-1)>>1;if(heap[p][0]<=heap[k][0])break;[heap[p],heap[k]]=[heap[k],heap[p]];k=p}};
  const pop=()=>{const top=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let k=0;for(;;){let l=k*2+1,r=l+1,m=k;if(l<heap.length&&heap[l][0]<heap[m][0])m=l;if(r<heap.length&&heap[r][0]<heap[m][0])m=r;if(m===k)break;[heap[m],heap[k]]=[heap[k],heap[m]];k=m}}return top};
  const s=I(sx,sy),t=I(tx,ty);gs[s]=0;push(heur(sx,sy),s);
  while(heap.length){const [,i]=pop();if(closed[i])continue;closed[i]=1;if(i===t)break;
    const x=i%w,y=(i-x)/w;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;
      const j=I(nx,ny);if(closed[j])continue;const c=ROAD_COST[tiles[j]];if(!(c<Infinity))continue;
      // no diagonal hops across a river: a bridge needs an orthogonal step onto it
      if(dx&&dy&&(tiles[j]===RIVER||tiles[i]===RIVER))continue;
      const ng=gs[i]+c*(dx&&dy?1.4142:1);if(ng<gs[j]){gs[j]=ng;prev[j]=i;push(ng+heur(nx,ny),j)}}}
  if(!(gs[t]<Infinity))return null;
  const out=[];for(let i=t;i>=0;i=prev[i]){const x=i%w;out.push([x,(i-x)/w]);if(i===s)break}
  return out.reverse()}

// ---- the build
export function buildWorld(spec){
  const w=spec.size.w,h=spec.size.h,I=(x,y)=>y*w+x;
  const tiles=new Uint8Array(w*h),zone=new Uint8Array(w*h);
  const seeds={terrain:11,detail:23,...(spec.seeds||{})};
  const curves={};for(const k in spec.curves||{})curves[k]={...spec.curves[k],fn:compileCurve(spec.curves[k])};
  const regions=spec.regions.map((r,i)=>({...r,idx:i}));
  const masks=regions.map(r=>compileMask(r.mask,curves));
  for(const r of regions)if(!BIOMES[r.biome])throw new Error('world spec: unknown biome '+r.biome);

  // regions and biome terrain
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let z=0;for(let i=0;i<regions.length;i++)if(masks[i](x,y))z=i;
    zone[I(x,y)]=z;
    tiles[I(x,y)]=BIOMES[regions[z].biome](x,y,fbm(x,y,seeds.terrain),fbm(x+50,y+20,seeds.detail));
    // region.pools {sx, sy, at, seed}: round, wide ice pools in place of the biome's own grain (opt-in, so other worlds are not touched)
    const pl=regions[z].pools;if(pl){let t=tiles[I(x,y)];if(t===ICE)t=SNOW;
      if(t===SNOW&&vnoise(x/pl.sx,y/pl.sy,pl.seed)*.78+vnoise(x/2.1,y/2.1,pl.seed+2)*.22>pl.at)t=ICE;tiles[I(x,y)]=t}}

  // river
  if(spec.river){const c=curves[spec.river.curve];if(!c)throw new Error('world spec: unknown river curve '+spec.river.curve);
    const wd=spec.river.width||2;
    // spec.river.span [from,to] (optional): painted only for those rows (a north-south river) or columns, so a river can rise in a spring.
    const sp=spec.river.span,s0=sp?Math.max(0,sp[0]):0,s1=sp?sp[1]:Infinity;
    if(c.axis==='y'){for(let y=s0;y<h&&y<=s1;y++){const x0=c.fn(y);for(let k=0;k<wd;k++)if(x0+k>=0&&x0+k<w)tiles[I(x0+k,y)]=RIVER}}
    else{for(let x=s0;x<w&&x<=s1;x++){const y0=c.fn(x);for(let k=0;k<wd;k++)if(y0+k>=0&&y0+k<h)tiles[I(x,y0+k)]=RIVER}}
    // spec.river.mouth {reach, flare} (an east-west river that meets the sea at the west edge): the water flares out over the last
    // `reach` columns, up to `flare` rows each side at x=0, with a ragged shore. spec.river.pool {x, y, r}: a spring pool at the head,
    // ringed on its far side with rock and ice so the river rises from somewhere.
    const mo=spec.river.mouth;
    if(mo&&c.axis==='x')for(let x=0;x<mo.reach&&x<w;x++){const y0=c.fn(x),e=Math.round(mo.flare*(1-x/mo.reach)+(vnoise(x/2.2,3.7,71)-.5)*1.8);
      for(let y=y0-e;y<y0+wd+e;y++)if(y>=0&&y<h)tiles[I(x,y)]=RIVER}
    const po=spec.river.pool;
    if(po){for(let y=Math.floor(po.y-po.r-3);y<=po.y+po.r+3;y++)for(let x=Math.floor(po.x-po.r-3);x<=po.x+po.r+3;x++){if(x<0||y<0||x>=w||y>=h)continue;
        const dx=x+.5-po.x,dy=y+.5-po.y,d=Math.hypot(dx,dy)+(vnoise(x/1.7,y/1.7,73)-.5)*1.3;
        if(d<po.r)tiles[I(x,y)]=RIVER;
        else if(d<po.r+1.6&&dx>0&&tiles[I(x,y)]!==LAVA)tiles[I(x,y)]=hash(x,y,75)>.45?ROCK:ICE;
        else if(d<po.r+3&&dx>1.5&&hash(x,y,76)>.6&&tiles[I(x,y)]!==LAVA)tiles[I(x,y)]=PEAK}}}
  // fords (#794): spec.river.fords, places along the river (a y on a north-south river, an x on an east-west one) where it
  // can be waded. The tiles stay RIVER, so they keep its slow pace; the solid grid leaves them open.
  const fords=[];
  if(spec.river)for(const t of spec.river.fords||[]){const c=curves[spec.river.curve],wd=spec.river.width||2,at=c.fn(t);
    for(let k=0;k<wd;k++)fords.push(c.axis==='y'?I(at+k,t):I(t,at+k))}

  // towns
  const CITY=(spec.towns||[]).map(mkTown);
  for(const c of CITY){
    for(let y=c.y0;y<=c.y1;y++)for(let x=c.x0;x<=c.x1;x++)if(!outsideTown(c,x,y))
      tiles[I(x,y)]=townRing(c,x,y)?WALL:FLOOR;
    for(const [gx,gy] of c.gateTiles)tiles[I(gx,gy)]=FLOOR}
  // spec town `clear: n` (#979): no trees within n tiles south of the walls, nor two either side and one north, nor in its notches, because a tree's crown stands
  // three tiles over its root and would hide the wall and the street behind it. Absent, nothing changes.
  (spec.towns||[]).forEach((t,i)=>{const c=CITY[i];if(!t.clear)return;
    for(let y=Math.max(0,c.y0-1);y<=Math.min(h-1,c.y1+t.clear);y++)for(let x=Math.max(0,c.x0-2);x<=Math.min(w-1,c.x1+2);x++){
      if(tiles[I(x,y)]===TREE&&outsideTown(c,x,y))tiles[I(x,y)]=OPEN_GROUND[regions[zone[I(x,y)]].biome]??G}});
  // A town's streets and approaches (epic #940 slice C): spec town `ground: [[dx,dy,w,h], ...]`, rects from the town's top-left
  // corner, laid as ROAD over anything but wall, water and a building's footprint (inside the walls this turns floor into street;
  // outside it is a causeway or quay). Absent, nothing is painted: Eldmoor and Stepping build as before.
  (spec.towns||[]).forEach((t,i)=>{const c=CITY[i];
    for(const [dx,dy,rw,rh] of t.ground||[])for(let y=c.y0+dy;y<c.y0+dy+rh;y++)for(let x=c.x0+dx;x<c.x0+dx+rw;x++){
      if(x<0||y<0||x>=w||y>=h)continue;const q=tiles[I(x,y)];
      if(q===WALL||q===RIVER||q===BRIDGE)continue;
      if(c.buildings.some(b=>x>=b.box[0]&&x<b.box[0]+b.box[2]&&y>=b.box[1]&&y<b.box[1]+b.box[3]&&!(x===b.door[0]&&y===b.door[1])))continue;
      tiles[I(x,y)]=ROAD}});

  // Piers: spec town `pier: [[dx,dy,w,h], ...]`, rects from the town's corner laid as BRIDGE over water and ROAD over land: a jetty into the river or sea.
  (spec.towns||[]).forEach((t,i)=>{const c=CITY[i];
    for(const [dx,dy,rw,rh] of t.pier||[])for(let y=c.y0+dy;y<c.y0+dy+rh;y++)for(let x=c.x0+dx;x<c.x0+dx+rw;x++){
      if(x<0||y<0||x>=w||y>=h)continue;const q=tiles[I(x,y)];if(q===WALL||q===FLOOR)continue;tiles[I(x,y)]=q===RIVER?BRIDGE:ROAD}});

  // landmarks
  // A dungeon's chambers (#65): plain data, checked for shape here; the creature types are the bestiary's (checked by crawlcheck).
  const roomsOf=L=>{const rs=L.rooms||[];if(!Array.isArray(rs))throw new Error('world spec: rooms of '+L.name+' must be a list');
    rs.forEach((r,i)=>{if(!r||!r.name||!Array.isArray(r.foes)||!r.foes.length||!r.foes.every(f=>f&&f.type&&f.n>=1))throw new Error('world spec: room '+i+' of '+L.name+' needs a name and foes [{type,n}]')});return rs};
  const LANDMARKS=[],CRYPTS=[];let LAIR=null; // CRYPTS: every dungeon a group can enter, spec order; the first is CRYPT (#891)
  for(const L of spec.landmarks||[]){
    if(L.kind==='lair'){const r=L.r||5.4,inner=L.inner||4,m=L.mouth||'W';
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){const dx=x+.5-L.x,dy=y+.5-L.y,d=Math.hypot(dx,dy);
        if(d<=inner)tiles[I(x,y)]=ROCK;
        else if(d<=r){const along=m==='W'?-dx:m==='E'?dx:m==='N'?-dy:dy,perp=(m==='W'||m==='E')?dy:dx;
          tiles[I(x,y)]=(along>2.5&&Math.abs(perp)<1.6)?ROCK:LAVA}}
      const o={kind:'lair',name:L.name,x:L.x,y:L.y,r,inner,opening:m,exclude:L.exclude||0,light:L.light||null};LANDMARKS.push(o);if(!LAIR)LAIR={x:L.x,y:L.y,name:L.name}}
    else if(L.kind==='crypt'){const mo=L.mouth,mouth=mo?{x0:mo.x0,y0:mo.y0,x1:mo.x0+mo.w-1,y1:mo.y0+mo.h-1}:null;
      if(mouth)for(let y=mouth.y0;y<=mouth.y1;y++)for(let x=mouth.x0;x<=mouth.x1;x++)if(x>=0&&y>=0&&x<w&&y<h)tiles[I(x,y)]=ROCK;
      const rooms=roomsOf(L);
      const o={kind:'crypt',name:L.name,boss:L.boss,x:L.x,y:L.y,mouth,exclude:L.exclude||0,light:L.light||null,rooms,sign:L.sign||null,captain:L.captain||null};LANDMARKS.push(o);
      CRYPTS.push({name:L.name,boss:L.boss,x:L.x,y:L.y,group:null,cd:L.cd===undefined?25:L.cd,mouth,rooms,entry:L.entry})}
    else throw new Error('world spec: unknown landmark kind '+L.kind)}

  // roads: polylines are painted as drawn; {from,to,via} endpoints are routed.
  const world={tiles,zone,I,w,h};
  const named=k=>{const c=CITY.find(t=>t.name===k);if(c)return[c.gate.x,c.gate.y];
    const l=LANDMARKS.find(t=>t.name===k);if(l)return[l.x,l.y];
    const p=(spec.points||{})[k];if(p)return p;throw new Error('world spec: unknown road endpoint '+k)};
  const ROUTES=[];
  for(const r of spec.roads||[]){
    if(Array.isArray(r)){paintPolyline(world,r);continue}
    const stops=[r.from,...(r.via||[]),r.to].map(named).map(p=>[Math.floor(p[0]),Math.floor(p[1])]);
    for(let i=0;i<stops.length-1;i++){const path=routeRoad(world,stops[i],stops[i+1]);
      if(!path)throw new Error('world spec: no road route from '+r.from+' to '+r.to);
      ROUTES.push(path);paintPolyline(world,path)}}

  // what cannot be walked (solidgrid.js, #794): after the roads, since a road opens what it crosses
  const solid=solidGrid({tiles,I,w,h,CITY,LANDMARKS,fords}),{land,main:mainLand}=landsOf({tiles,I,w,h,CITY},solid);

  // level ladder: the region whose band holds the level. Ties go to the one
  // nearest `near` (a hero's home) when given, else the lower index.
  const bands=regions.map(r=>r.band||[1,Infinity]);
  const centroid=regions.map(()=>({x:0,y:0,n:0}));
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const c=centroid[zone[I(x,y)]];c.x+=x+.5;c.y+=y+.5;c.n++}
  for(const c of centroid)if(c.n){c.x/=c.n;c.y/=c.n}
  const zoneFor=(l,near)=>{let best=-1,bd=Infinity;
    for(let i=0;i<bands.length;i++){if(l<bands[i][0]||l>bands[i][1])continue;
      if(!near){return i}const d=Math.hypot(centroid[i].x-near.x,centroid[i].y-near.y);if(d<bd){bd=d;best=i}}
    if(best>=0)return best;
    let lo=0,hi=0;for(let i=1;i<bands.length;i++){if(bands[i][0]<bands[lo][0])lo=i;if(bands[i][1]>bands[hi][1])hi=i}
    return l<bands[lo][0]?lo:hi};
  const zoneAt=(x,y)=>zone[I(clamp(Math.floor(x),0,w-1),clamp(Math.floor(y),0,h-1))];
  const tileAt=(x,y)=>tiles[I(clamp(Math.floor(x),0,w-1),clamp(Math.floor(y),0,h-1))];

  // spawn and hunting points per region, away from towns and landmarks
  const pad=(spec.spawn&&spec.spawn.townPad)||[4,3];
  const excl=LANDMARKS.filter(l=>l.exclude>0).map(l=>l.mouth?{x:(l.mouth.x0+l.mouth.x1+1)/2,y:(l.mouth.y0+l.mouth.y1+1)/2,r:l.exclude}:{x:l.x,y:l.y,r:l.exclude});
  const ZPTS=regions.map(()=>[]);
  for(let y=1;y<h-1;y++)tile:for(let x=1;x<w-1;x++){const t=tiles[I(x,y)];
    if(WALKABLE.indexOf(t)<0||land[I(x,y)]!==mainLand)continue; // never on solid ground, nor in a pocket nobody can walk to (#794)
    for(const c of CITY)if(x>=c.x0-pad[0]&&x<=c.x1+pad[0]&&y>=c.y0-pad[1]&&y<=c.y1+pad[1])continue tile;
    for(const e of excl)if(Math.hypot(x+.5-e.x,y+.5-e.y)<e.r)continue tile;
    ZPTS[zone[I(x,y)]].push({x:x+.5,y:y+.5})}
  const nearest=(spec.spawn&&spec.spawn.nearest)||0;
  const zonePoint=(z,near,home)=>{const L=ZPTS[z];
    // big regions (spec.spawn.nearest): the closest of N random points to the hero, or to their home town
    const to=nearest&&(near||home);if(to){let best=null,bd=Infinity;for(let i=0;i<nearest;i++){const p=pickA(L),d=Math.hypot(p.x-to.x,p.y-to.y);if(d<bd){bd=d;best=p}}return{...best}}
    if(near){for(let i=0;i<14;i++){const p=pickA(L);if(Math.hypot(p.x-near.x,p.y-near.y)<7)return{...p}}}return{...pickA(L)}};

  // lights and labels
  const LIGHTS=[];const torch=(spec.lights&&spec.lights.townTorches)||[];
  (spec.towns||[]).forEach((t,i)=>{const c=CITY[i];for(const [dx,dy] of t.torches||torch)LIGHTS.push({x:c.x0+dx,y:c.y0+dy})});
  for(const l of LANDMARKS)if(l.light)LIGHTS.push({x:l.x,y:l.y,...l.light});
  for(const p of (spec.lights&&spec.lights.points)||[])LIGHTS.push({...p}); // braziers, embers: free-standing lights named by the spec
  const LABELS=spec.labels?spec.labels.map(l=>[...l]):[
    ...regions.map((r,i)=>[r.name.toUpperCase(),Math.round(centroid[i].x),Math.round(centroid[i].y)]),
    ...CITY.map(c=>[c.name.toUpperCase(),(c.x0+c.x1+1)/2,c.y0>2?c.y1+2.2:c.y0-.6])];

  const OUTPOSTS=(spec.outposts||[]).map(o=>({id:o.id,name:o.name,x:o.x,y:o.y,r:o.r||3.5,z:zoneAt(o.x,o.y)})); // contested outposts (#11): data only, never painted
  const NODES=placeNodes({tiles,zone,w,h,I,REGIONS:regions,CITY,LANDMARKS,land,mainLand},spec); // gathering nodes (#255): an overlay list, not tiles
  return{name:spec.name,w,h,I,tiles,zone,NODES,curves:Object.fromEntries(Object.keys(curves).map(k=>[k,curves[k].fn])),
    REGIONS:regions,ZONES:regions.map(r=>r.name),CITY,LANDMARKS,LAIR,CRYPT:CRYPTS[0]||null,CRYPTS,ROUTES,OUTPOSTS,
    zoneFor,zoneAt,tileAt,ZPTS,zonePoint,LIGHTS,LABELS,solid,land,mainLand,fords,
    road:pts=>paintPolyline(world,pts)}}
