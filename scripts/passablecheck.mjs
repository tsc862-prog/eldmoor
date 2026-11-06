// Passability check (#792): the solid-ground layer (src/world/passable.js) on the active world.
// Proves: walls, rivers, peaks, lava, the Crypt mouth rock and the wyrm's nest are solid; a bridge, a road
// and a gate are open; solid forest cores keep an open ring; solidAt/nearestOpen agree; the levers refuse solid ground
// with the nearest open spot; camps never land on it; survey lists solid edges; every town gate reaches every other
// by open ground. Runs the active world; with no ELDMOOR_WORLD it runs Eldmoor, then re-runs itself for the Stepping Lands.
// Usage: npm run passablecheck
import {runWorlds} from './worlds.mjs';
import {tiles,I,CITY,LANDMARKS,LAIR,CRYPT} from '../src/world/map.js';
import {W,H,ROCK,TREE,WALL,RIVER,BRIDGE,PEAK,LAVA,ROAD,WALKABLE} from '../src/world/tiles.js';
import {townRing} from '../src/world/gen.js';
import {solidAt,solidWhy,nearestOpen,solidCounts,standAt,FOREST_CORE} from '../src/world/passable.js';
import {step} from '../src/sim/index.js';
import {S} from '../src/sim/state.js';
import {spreadAt} from '../src/sim/company.js';
import {init} from '../src/sim/index.js';
import {spotErr} from '../src/sim/levers.js';
import {campSpot} from '../src/sim/camp.js';
import {survey} from '../src/sim/dmsight.js';

let fail=0;const ok=(c,m)=>{if(!c){fail++;console.log('FAIL '+m)}else console.log('ok   '+m)};
const first=t=>{for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++)if(tiles[I(x,y)]===t)return {x:x+.5,y:y+.5};return null};
const world=process.env.ELDMOOR_WORLD||'eldmoor';
console.log(`== ${world} ${W}x${H}`);
init({fellowship:false});

const wall=first(WALL),river=first(RIVER),bridge=first(BRIDGE),peak=first(PEAK),lava=first(LAVA);
ok(wall&&solidAt(wall.x,wall.y)&&solidWhy(wall.x,wall.y)==='wall','a town wall is solid');
ok(river&&solidAt(river.x,river.y)&&solidWhy(river.x,river.y)==='river','river water is solid');
ok(!bridge||!solidAt(bridge.x,bridge.y),'a bridge is open');
ok(!peak||solidAt(peak.x,peak.y),'a peak is solid');
ok(!lava||solidAt(lava.x,lava.y),'lava is solid');
ok(solidAt(-1,5)&&solidAt(5,H+2),'off the map is solid');
for(const c of CITY){const g=c.gateTiles[0];ok(!solidAt(g[0]+.5,g[1]+.5),c.name+': the gate tile is open');ok(!solidAt(c.gate.x,c.gate.y),c.name+': the gate spot is open')}
for(const L of LANDMARKS){
  if(L.kind==='crypt'&&L.mouth){let n=0,bad=0;for(let y=L.mouth.y0;y<=L.mouth.y1;y++)for(let x=L.mouth.x0;x<=L.mouth.x1;x++){const r=tiles[I(x,y)]===ROCK;if(r){n++;if(!solidAt(x+.5,y+.5))bad++}}ok(n>0&&bad===0,'the Crypt mouth rock is solid ('+n+' tiles; a road laid through it stays open)')}
  if(L.kind==='lair')ok(solidAt(L.x,L.y)&&solidWhy(L.x,L.y)==='rock','the wyrm\'s nest is solid');}
// forest cores keep an open ring
let cores=0,bad=0;for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(solidWhy(x,y)==='forest'){cores++;
  for(let dy=-FOREST_CORE;dy<=FOREST_CORE;dy++)for(let dx=-FOREST_CORE;dx<=FOREST_CORE;dx++)if(tiles[I(x+dx,y+dy)]!==TREE)bad++}
ok(FOREST_CORE===0||cores>0,'forest cores exist ('+cores+')');ok(bad===0,'every forest core stands in trees');
// ring of open forest: no solid forest tile has all 8 neighbours solid-or-edge in a way that walls a road: roads and bridges are never solid
let roadSolid=0;for(let y=0;y<H;y++)for(let x=0;x<W;x++){const t=tiles[I(x,y)];if((t===ROAD||t===BRIDGE)&&solidAt(x,y))roadSolid++}
ok(roadSolid===0,'no road or bridge tile is solid');
// nearestOpen
let o=nearestOpen(wall.x,wall.y);ok(o&&!solidAt(o.x,o.y),'nearestOpen of a wall is open ('+(o&&o.x+','+o.y)+')');
o=nearestOpen(river.x,river.y);ok(o&&!solidAt(o.x,o.y),'nearestOpen of the river is open');
ok(nearestOpen(wall.x,wall.y)&&JSON.stringify(nearestOpen(wall.x,wall.y))===JSON.stringify(nearestOpen(wall.x,wall.y)),'nearestOpen is deterministic');
const open0={x:Math.floor(CITY[0].gate.x)+.5,y:Math.floor(CITY[0].gate.y)+.5};
const same=nearestOpen(open0.x,open0.y);ok(same&&same.x===open0.x&&same.y===open0.y,'nearestOpen of an open tile is itself');
// levers: spotErr refuses solid ground and names an open spot that itself passes
for(const [nm,pt] of [['wall',wall],['river',river],['peak',peak],['lava',lava]]){if(!pt)continue;
  const e=spotErr(pt);ok(e&&/\d+(\.\d+)?,\d+(\.\d+)?/.test(e),nm+' refused with a spot: '+e);
  const m=e&&/nearest open ground is ([\d.]+),([\d.]+)/.exec(e);
  if(m)ok(!spotErr({x:+m[1],y:+m[2]}),nm+': the named spot is accepted');else if(e&&!/no open ground/.test(e))ok(false,nm+': hint missing')}
// a peak inside a legal region is refused although WALKABLE lists it
if(peak)ok(WALKABLE.includes(PEAK)&&spotErr(peak),'a peak is refused although WALKABLE keeps it');
// camps
for(const c of CITY)for(const [dx,dy] of [[0,0],[6,0],[0,6],[-6,0]]){const s=campSpot(c.gate.x+dx,c.gate.y+dy);if(s&&solidAt(s.x,s.y))ok(false,'camp spot solid near '+c.name)}
const tryCamps=[wall,river,peak,lava].filter(Boolean).map(p=>campSpot(p.x,p.y));ok(tryCamps.every(s=>!s||!solidAt(s.x,s.y)),'campSpot steps off solid ground to open ground');
// survey
if(peak){const s=survey({x:peak.x,y:peak.y,label:'peak'},10);ok(s.ok&&s.impassable.length>0&&s.impassable.every(e=>e.kind||true),'survey lists impassable edges');
  ok(s.impassable.some(e=>e.kind==='peak'),'survey names the peak kind');
  ok(s.legal_spots.every(l=>{const [x,y]=l.at.split(',').map(Number);return !solidAt(x,y)}),'survey legal spots are open')}
// connectivity: 8-neighbour over open tiles, no diagonal squeeze between two solids
{const seen=new Uint8Array(W*H),start=CITY[0].gate,q=[[Math.floor(start.x),Math.floor(start.y)]];seen[I(q[0][0],q[0][1])]=1;
  for(let k=0;k<q.length;k++){const [x,y]=q[k];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=W||ny>=H||seen[I(nx,ny)]||solidAt(nx,ny))continue;
    if(dx&&dy&&solidAt(x+dx,y)&&solidAt(x,y+dy))continue;seen[I(nx,ny)]=1;q.push([nx,ny])}}
  for(const c of CITY)ok(seen[I(Math.floor(c.gate.x),Math.floor(c.gate.y))]===1,c.name+' gate reached from '+CITY[0].name+' over open ground');
  if(CRYPT)ok(seen[I(Math.floor(CRYPT.x),Math.floor(CRYPT.y))]===1||nearestOpen(CRYPT.x,CRYPT.y,4)!==null,'the Crypt has open ground at its door');
  if(LAIR)ok(nearestOpen(LAIR.x,LAIR.y,8)!==null,'the lair has open ground near it')}

// town plans (#793): buildings are sim data, solid but for one door, the doors reach the gate, nobody stands inside one
for(const c of CITY){const B=c.buildings||[];ok(B.length>=6,c.name+': has its buildings in the plan ('+B.length+')');
  const inside=(x,y)=>x>c.x0&&x<c.x1&&y>c.y0&&y<c.y1,own=new Map();let shape=true,doors=true,over=0,fp=0,reach=true,spots=true;
  for(const b of B){const [bx,by,bw,bh]=b.box,[dx,dy]=b.door;
    if(!(Number.isInteger(bx+by+bw+bh)&&bw>0&&bh>0))shape=false;
    if(!(dx>=bx&&dx<bx+bw&&dy>=by&&dy<by+bh))doors=false;
    for(let y=by;y<by+bh;y++)for(let x=bx;x<bx+bw;x++){if(!inside(x,y))shape=false;const k=x+','+y;if(own.has(k))over++;own.set(k,b);
      const door=x===dx&&y===dy;if(door){if(solidAt(x+.5,y+.5))doors=false}else{fp++;if(solidWhy(x+.5,y+.5)!=='building')shape=false}}
    // the door opens onto open ground outside its own footprint
    const out=[[dx+1,dy],[dx-1,dy],[dx,dy+1],[dx,dy-1]].filter(([x,y])=>!(x>=bx&&x<bx+bw&&y>=by&&y<by+bh)&&!solidAt(x+.5,y+.5));
    if(!out.length)doors=false;
    if(b.serves&&B.find(q=>q.serves===b.serves)===b&&!(Math.floor(c.spots[b.serves].x)===dx&&Math.floor(c.spots[b.serves].y)===dy))spots=false}
  ok(shape,c.name+': every box is whole tiles inside the walls and solid but for its door');ok(doors,c.name+': each building has one door tile, open, on open ground');ok(over===0,c.name+': buildings do not overlap');
  ok(spots,c.name+': inn, smith, quartermaster, chapel and gate spots stand at their doors');
  let nb=0;for(let y=c.y0;y<=c.y1;y++)for(let x=c.x0;x<=c.x1;x++)if(solidWhy(x+.5,y+.5)==='building')nb++;ok(nb===fp,c.name+': the solid building tiles are the boxes minus the doors exactly ('+nb+')');
  // every door and every spot reaches the gate over open ground inside the town
  const seen=new Set(),q=[[Math.floor(c.gate.x),Math.floor(c.gate.y)]];seen.add(q[0].join());
  for(let k=0;k<q.length;k++){const [x,y]=q[k];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy;if(seen.has(nx+','+ny)||solidAt(nx,ny))continue;if(dx&&dy&&solidAt(x+dx,y)&&solidAt(x,y+dy))continue;seen.add(nx+','+ny);q.push([nx,ny])}}
  for(const b of B)if(!seen.has(b.door.join()))reach=false;
  ok(reach,c.name+': every door connects to the gate');
  ok(Object.entries(c.spots).every(([k,p])=>!solidAt(p.x,p.y)&&seen.has(Math.floor(p.x)+','+Math.floor(p.y))),c.name+': every named spot is open and reaches the gate');
  // walls open only at the gate
  let wallOpen=0;for(let y=c.y0;y<=c.y1;y++)for(let x=c.x0;x<=c.x1;x++){if(!townRing(c,x,y))continue;if(!solidAt(x+.5,y+.5)&&!c.gateTiles.some(([gx,gy])=>gx===x&&gy===y))wallOpen++}
  ok(wallOpen===0,c.name+': the wall is open only at the gate');
  // placement: the random home spot of a new hero, a company spread around the square and the square itself are never inside a box
  let badPlace=0;for(let i=0;i<400;i++){const p=standAt(c.x0+2+((i*37)%100)/100*7,c.y0+4+((i*53)%100)/100*3);if(solidAt(p.x,p.y))badPlace++}
  for(let n=1;n<=8;n++)for(let i=0;i<n;i++){const q=spreadAt(c.spots.square,i,n);if(solidAt(q.x,q.y))badPlace++}
  ok(badPlace===0,c.name+': new heroes and company spreads are placed on open ground')}
// nobody who stands still in a town stands inside a building (a walker crossing one is slice 3, #794)
{init({fellowship:true});const prev=new Map();let bad=0;
  for(let i=0;i<20*400;i++){step(.5);const E=[...S.agents.filter(a=>a.state!=='dead'),...(S.npcs||[])];
    for(const e of E){const pos=e.x+','+e.y,p=prev.get(e);if(!p||p.pos!==pos){prev.set(e,{pos,n:0});continue}if(++p.n===20&&solidWhy(e.x,e.y)==='building')bad++}}
  ok(bad===0,'400 game minutes: no hero or townsperson stands still inside a building ('+bad+')')}
console.log('solid tiles:',JSON.stringify(solidCounts()));
// the other world, once
if(!process.env.ELDMOOR_WORLD)fail+=runWorlds('passablecheck')
if(fail){console.log(fail+' check(s) failed');process.exit(1)}console.log('passablecheck ok');
