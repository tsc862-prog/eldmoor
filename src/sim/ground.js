// What the land looks like to someone standing on it (#797, slice 6 of the solid-world epic #791). Owned by brain-builder.
// The solid layer (world/passable.js) and the route (sim/path.js) hold the facts; this is the one place that puts them in words.
//   groundScan(c,r)      what stands around a point: solid ground by kind and direction, roads, water, crossings, town gates
//   groundLines(s,...)   the scan as short lines (look, a hero's survey, the DM's survey: one reader, no second geometry)
//   routeFacts(a,legs)   move_to's route fields: only what the hero can see or knows, an unseen crossing or obstacle stays unnamed
//   wayWords(o,direct)   the sentence for a tool answer; wayShort(o) the few words for the turn header; wayNow(a) the walk under way
// Read only, no dice: nothing here touches the RNG or a hero. Sight limits: a thing out of sight in a region the hero does not
// know has no name, no kind and no distance. No level, no HP. The open-world Table (#746) can read cover and edges from groundScan.
import {ROAD,BRIDGE,RIVER,WALKABLE,H,W} from '../world/tiles.js';
import {tiles,I,ZONES,CITY,zoneAt,dist} from '../world/map.js';
import {solidAt,solidWhy} from '../world/passable.js';
import {crossing} from '../world/solidgrid.js';
import {route,blockAt,doorAt} from './path.js';
import {knowsPlace} from './lore.js';
import {sightFor} from './weather.js';

export const GROUND={SIGHT:12,LOOK:3,SURVEY:6,WAYS:5,BETWEEN:2,DETOUR:1.25,DETOUR_MIN:4,OFFSET:1.5};
export const DIRS=['east','southeast','south','southwest','west','northwest','north','northeast']; // y grows downward
export const bearing=(c,p)=>DIRS[((Math.round(Math.atan2(p.y-c.y,p.x-c.x)/(Math.PI/4))%8)+8)%8];
export const compass=(dx,dy)=>Math.hypot(dx,dy)<1.5?'here':bearing({x:0,y:0},{x:dx,y:dy});
// How a person says each kind of solid ground (the layer's WHY names). many: the verb agrees with a plural.
const BAR={wall:{w:'the town wall'},river:{w:'the river'},peak:{w:'sheer cliffs and peaks',many:1},lava:{w:'a flow of lava'},building:{w:'houses',many:1},rock:{w:'a wall of bare rock'},forest:{w:'forest too thick to walk'},unknown:{w:'land you do not know'}};
const barWord=k=>(BAR[k]||{w:'the ground'}).w;
const cap=s=>s[0].toUpperCase()+s.slice(1);
const off=d=>d<1.5?'right beside you':Math.round(d)+' tiles off';
const r1=v=>Math.round(v*10)/10;
// The hero can speak of a point it can see, or one in a region it knows.
export function sees(a,x,y){const z=zoneAt(x,y);return Math.hypot(x-a.x,y-a.y)<=GROUND.SIGHT*sightFor(a,z)||knowsPlace(a,ZONES[z])}

// ---- the ground around a point ----
// c: {x,y}; r: tiles. road/water/blocked: per direction the nearest {d, at, why} (the DM's survey lists them as they are);
// kinds: per solid kind {d, dir, dirs}; crossings: runs of bridge or ford tiles, nearest first; gates: town gates in range.
export function groundScan(c,r){const cx=Math.floor(c.x),cy=Math.floor(c.y),road={},water={},blocked={},kinds={},cr=[];let onRoad=false;
  for(let y=Math.max(1,cy-r);y<=Math.min(H-2,cy+r);y++)for(let x=Math.max(1,cx-r);x<=Math.min(W-2,cx+r);x++){
    const p={x:x+.5,y:y+.5},d=dist(c,p);if(d>r)continue;const t=tiles[I(x,y)],dir=bearing(c,p),why=solidAt(x,y)?solidWhy(x,y):null,note=(B,w)=>{const o=B[dir];if(!o||d<o.d)B[dir]={d:r1(d),at:x+','+y,why:w}};
    if(t===ROAD||t===BRIDGE){note(road);if(d<1.2)onRoad=true}else if(t===RIVER)note(water);else if(why||!WALKABLE.includes(t))note(blocked,why);
    if(crossing(t,!why))cr.push({x,y,d,b:t===BRIDGE});
    if(why){const k=kinds[why]||(kinds[why]={d:Infinity,dir:null,dirs:new Set()});k.dirs.add(dir);if(d<k.d){k.d=d;k.dir=dir}}}
  // one crossing a run of touching tiles; any bridge in it makes it a bridge, as a route counts it
  const runs=[];for(const t of cr.slice().sort((p,q)=>p.d-q.d||p.y-q.y||p.x-q.x)){const near=runs.find(u=>u.tiles.some(q=>Math.abs(q.x-t.x)<=1&&Math.abs(q.y-t.y)<=1));
    if(near){near.tiles.push(t);near.bridge=near.bridge||t.b}else runs.push({x:t.x,y:t.y,d:t.d,bridge:t.b,tiles:[t]})}
  const crossings=runs.map(u=>({k:u.bridge?'bridge':'ford',x:u.x,y:u.y,d:r1(u.d),dir:bearing(c,{x:u.x+.5,y:u.y+.5}),region:ZONES[zoneAt(u.x,u.y)]||null}));
  const gates=CITY.map(t=>({town:t.name,d:dist(c,t.gate),dir:bearing(c,t.gate)})).filter(g=>g.d<=r).sort((p,q)=>p.d-q.d);
  return {road,water,blocked,kinds,crossings,gates,onRoad}}
// A set of compass words read round the circle from a gap: "east, southeast and south".
function arc(set){if(set.size>=6)return 'on nearly every side';const n=DIRS.length;let s=DIRS.findIndex((d,i)=>set.has(d)&&!set.has(DIRS[(i+n-1)%n]));if(s<0)s=0;
  const L=[];for(let i=0;i<n;i++){const d=DIRS[(s+i)%n];if(set.has(d))L.push(d)}
  return 'to the '+(L.length>1?L.slice(0,-1).join(', ')+' and '+L[L.length-1]:L[0])}
// A crossing by name: a known region names it ("the Thornvale bridge"), else plainly "a ford".
const crossText=(k,region)=>(region?'the '+region+' ':'a ')+k;
// The scan as lines, nearest first. region(c): the crossing's region when the reader knows it.
export function groundLines(s,{max=GROUND.LOOK,region=()=>null}={}){
  return Object.keys(s.kinds).sort((p,q)=>s.kinds[p].d-s.kinds[q].d||(p<q?-1:1)).slice(0,max).map(k=>{const o=s.kinds[k],many=(BAR[k]||{}).many;
    let l=cap(barWord(k))+(k==='river'?' bars the way ':many?' stand ':' stands ')+arc(o.dirs)+', '+off(o.d);
    if(k==='river'){const c=s.crossings[0];l+=c?'; '+crossText(c.k,region(c))+' crosses it to the '+c.dir+', '+off(c.d):'; no crossing in sight'}
    if(k==='wall'&&s.gates[0])l+='; its gate lies to the '+s.gates[0].dir+', '+off(s.gates[0].d);
    return l+'.'})}
// Where the roads lie, in one line, or null.
export function roadLine(s){const dirs=new Set(Object.keys(s.road).filter(d=>s.road[d].d>=2));
  if(s.onRoad)return dirs.size?'You stand on a road; it runs on '+arc(dirs)+'.':'You stand on a road.';
  const n=Object.keys(s.road).sort((p,q)=>s.road[p].d-s.road[q].d)[0];return n?'The nearest road lies to the '+n+', '+off(s.road[n].d)+'.':null}

// ---- the way a walk goes ----
// Which side of the straight line the way swings to: the compass word from the line to the point farthest off it, or null.
function swing(x0,y0,x1,y1,pts){const dx=x1-x0,dy=y1-y0,L=Math.hypot(dx,dy);if(!L)return null;let best=0,fx=0,fy=0;
  for(let i=0;i<pts.length;i+=2){const px=pts[i]-x0,py=pts[i+1]-y0,t=(px*dx+py*dy)/(L*L),ox=px-t*dx,oy=py-t*dy,o=Math.hypot(ox,oy);if(o>best){best=o;fx=ox;fy=oy}}
  return best>=GROUND.OFFSET?bearing({x:0,y:0},{x:fx,y:fy}):null}
function crossFact(a,c){if(!sees(a,c.x,c.y))return {crossing:'unknown',dir:compass(c.x-a.x,c.y-a.y)}; // the feet find it; the hero cannot say what it is
  const z=ZONES[zoneAt(c.x,c.y)],o={crossing:c.k,dir:compass(c.x-a.x,c.y-a.y),tiles:Math.round(Math.hypot(c.x-a.x,c.y-a.y))};if(z&&knowsPlace(a,z))o.region=z;return o}
// The facts of a walk along legs ({x,y,st}), or null when there is no way at all. tiles walked; blocked, what stands on the straight
// line; by, the crossings in order; round, the side the way swings to when no crossing explains it; gate, 'out' or 'in' when the walk
// goes through its town's gate first; door, the door it ends at; ends_short, short_by and at when the ground ends it early.
export function routeFacts(a,legs){let x=a.x,y=a.y,n=0,bar=null,short=null;const by=[];
  for(const l of legs){const r=route(x,y,l.x,l.y);if(!r)return null;n+=r.len;
    if(r.why&&(!bar||bar.town&&l.st!=='town')){const b=blockAt(x,y,l.x,l.y);if(b)bar={...b,town:l.st==='town',round:swing(x,y,l.x,l.y,r.pts)}}
    if(r.near&&!short)short=l;
    for(const c of r.cross||[])by.push(crossFact(a,c));
    const e=r.pts.length-2;x=r.pts[e];y=r.pts[e+1]}
  const o={tiles:Math.round(n*10)/10};
  if(bar){o.blocked=sees(a,bar.x,bar.y)?bar.why:'unknown';if(!by.length&&bar.round)o.round=bar.round}
  if(by.length)o.by=by;
  if(legs.length>1&&(legs[0].st==='town'||legs[0].st==='return'))o.gate=legs[0].st==='town'?'out':'in';
  const d=doorAt(x,y);if(d)o.door=d.serves||d.piece;
  if(short){o.ends_short=true;o.short_by=Math.round(Math.hypot(short.x-x,short.y-y));const w=sees(a,short.x,short.y)?solidWhy(short.x,short.y):null;if(w&&BAR[w])o.at=w}
  return o}
const crossWay=c=>c.crossing==='unknown'?'a crossing you have not seen, to the '+c.dir:crossText(c.crossing,c.region)+(c.dir==='here'?', right here':', '+c.dir+', '+off(c.tiles));
const crossBrief=c=>c.crossing==='unknown'?'a crossing to the '+c.dir:crossText(c.crossing,c.region)+(c.dir==='here'?'':' to the '+c.dir);
const townBar=o=>o.gate&&(o.blocked==='building'||o.blocked==='wall'); // going through the gate says it all
const isLong=(o,direct)=>direct>=2&&o.tiles>=direct*GROUND.DETOUR&&o.tiles-direct>=GROUND.DETOUR_MIN;
// The way round: the crossing, else the side it swings to. Over land the hero does not know the walk only bends.
const bends=(o,c)=>c?c.dir:o.round;
const roundBy=(o,c)=>o.blocked==='unknown'||c&&c.crossing==='unknown'?(bends(o,c)?'the walk bends to the '+bends(o,c):'the walk bends round it'):c||o.round?'you go round by '+(c?crossWay(c):'the '+o.round):'you walk round '+((BAR[o.blocked]||{}).many?'them':'it');
export const NO_WAY='You can find no way there, and you stay where you are.';
// The way in a sentence or two, or null when the walk is plain and straight. direct: tiles as the crow flies.
export function wayWords(o,direct){if(!o)return NO_WAY;const s=[],bar=o.blocked&&!townBar(o)?o.blocked:null;let c=o.by||[];
  if(o.gate)s.push(o.gate==='out'?'Out by the gate.':'In by the gate.');
  if(bar){s.push(cap(barWord(bar))+((BAR[bar]||{}).many?' bar':' bars')+' the straight way; '+roundBy(o,c[0])+'.');c=c.slice(1)}
  if(c.length)s.push('You cross by '+c.map(crossWay).join(', then ')+'.');
  if(isLong(o,direct))s.push((bar||(o.by||[]).length?'The long way round':o.gate?'The gate is the long way round':'The better ground runs longer')+': about '+Math.round(o.tiles)+' tiles, '+Math.round(direct)+' as the crow flies.');
  if(o.ends_short)s.push('You cannot reach that spot'+(o.at?' ('+barWord(o.at)+')':': nothing leads to it')+'. The walk ends as near as the ground allows'+(o.short_by?', '+o.short_by+(o.short_by===1?' tile':' tiles')+' short':'')+'.');
  if(o.door&&o.door!=='gate')s.push('You end at the '+o.door+' door.');
  return s.length?s.join(' '):null}
// A few words for the turn header, or null: the header is paid for every turn (#799), so only a detour or a dead end gets one.
export function wayShort(o){if(!o)return 'no way on from here';if(o.ends_short)return 'as near as the ground allows; that spot cannot be reached';
  const bar=o.blocked&&!townBar(o)?o.blocked:null;if(!bar)return null;const c=(o.by||[])[0];
  return (bar==='unknown'?'bending to the '+(bends(o,c)||'side'):'round '+barWord(bar)+' by '+(c?crossBrief(c):o.round?'the '+o.round:'open ground'))}
// One known place from where the hero stands: what is between, and the way round.
export function betweenWords(o){if(!o)return 'no way you can find';const bar=o.blocked&&!townBar(o)?o.blocked:null,c=(o.by||[])[0],n='about '+Math.round(o.tiles)+' tiles';
  if(o.ends_short)return 'no way leads there; the ground ends '+(o.short_by||0)+' tiles short of it';
  if(bar)return barWord(bar)+' between; '+roundBy(o,c)+', '+n+' in all';
  return (c&&c.crossing!=='unknown'?'over '+crossWay(c)+', ':'clear going, ')+n}
// The walk under way as header words: only while something still stands on the straight line, so it goes quiet once past it.
const NOT_WALKING=new Set(['fight','duel','assist','downed','camp','dead']);
export function wayNow(a){const p=a&&a.path;if(!p||!a.player||NOT_WALKING.has(a.state))return null;const c=(a.pq||[])[0];if(!a.dest&&!(c&&c.kind==='move'))return null;
  if(p.none)return wayShort(null);if(p.i>=p.pts.length||(!p.near&&!blockAt(a.x,a.y,p.tx,p.ty)))return null;
  return wayShort(routeFacts(a,[{x:p.tx,y:p.ty,st:'travel'}]))}
