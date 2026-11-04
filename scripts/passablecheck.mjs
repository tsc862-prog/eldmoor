// Passability check (#792): the solid-ground layer (src/world/passable.js) on the active world.
// Proves: walls, rivers, peaks, lava, the Crypt mouth rock and the wyrm's nest are solid; a bridge, a road
// and a gate are open; solid forest cores keep an open ring; solidAt/nearestOpen agree; the levers refuse solid ground
// with the nearest open spot; camps never land on it; survey lists solid edges; every town gate reaches every other
// by open ground. Runs the active world; with no ELDMOOR_WORLD it runs Eldmoor, then re-runs itself for the Stepping Lands.
// Usage: npm run passablecheck
import {spawnSync} from 'node:child_process';
import {tiles,I,CITY,LANDMARKS,LAIR,CRYPT} from '../src/world/map.js';
import {W,H,ROCK,TREE,WALL,RIVER,BRIDGE,PEAK,LAVA,ROAD,WALKABLE} from '../src/world/tiles.js';
import {solidAt,solidWhy,nearestOpen,solidCounts,FOREST_CORE} from '../src/world/passable.js';
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
console.log('solid tiles:',JSON.stringify(solidCounts()));
// the other world, once
if(!process.env.ELDMOOR_WORLD&&!process.env.PASSABLE_CHILD){const r=spawnSync(process.execPath,[process.argv[1]],{env:{...process.env,ELDMOOR_WORLD:'stepping',PASSABLE_CHILD:'1'},stdio:'inherit'});if(r.status)fail++}
if(fail){console.log(fail+' check(s) failed');process.exit(1)}console.log('passablecheck ok');
