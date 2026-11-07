// The world answers you (#797, slice 6 of #791): look, survey and move_to describe obstacles and routes in words, from the
// same layer as the DM's survey. Cases on the real map: a river, a town wall, a door, a detour, an unknown region, a target
// with no way, cliffs; no level, HP or unknown name in any line; a detour is never silent; the header line is short and goes
// quiet past the obstacle; the DM reads the same ground; nothing draws from the RNG. Runs the active world; with no
// ELDMOOR_WORLD it runs Eldmoor, then re-runs itself for the Stepping Lands.
// Usage: npm run waycheck
import {spawnSync} from 'node:child_process';
import {tiles,I,CITY,ZONES,ZPTS,zoneAt,land,mainLand} from '../src/world/map.js';
import {W,H,RIVER} from '../src/world/tiles.js';
import {solidAt,solidWhy,nearestOpen} from '../src/world/passable.js';
import {init,step,S,markPlayer,playerAct} from '../src/sim/index.js';
import {route,blockedBy} from '../src/sim/path.js';
import {GROUND,groundScan,groundLines,routeFacts,wayWords,wayShort,wayNow,betweenWords,NO_WAY} from '../src/sim/ground.js';
import {learnPlace} from '../src/sim/lore.js';
import {survey} from '../src/sim/dmsight.js';
import {paceBrief} from '../src/sim/pace.js';
import {wayNote} from './pacing.mjs';
import {seedRng,rnd} from '../src/core/rng.js';

let fail=0;const ok=(c,m)=>{if(!c){fail++;console.log('FAIL '+m)}else console.log('ok   '+m)};
const world=process.env.ELDMOOR_WORLD||'eldmoor';
console.log(`== ${world} ${W}x${H}`);
seedRng(3);init({fellowship:false});
const a=S.agents.find(h=>h.state!=='dead');markPlayer(a,true);
const home=CITY.find(c=>c.fac===a.fac)||CITY[0];
a.home=a.home??home.id;
const put=(x,y)=>{a.x=x;a.y=y;a.state='hunt';a.dest=null;a.pq=[];a.path=null;a.adv=null;a.lvl=20;a.playDoing=null};
const act=(t,args={})=>{a.playRate=[];const r=playerAct(a.id,t,args);return r&&r.result||r};
const knowAll=()=>{for(const z of ZONES)if(z)learnPlace(a,z,'told')};
const forget=()=>{a.lore={c:{},p:{}};a.loreZ=null};
const xy=(x,y)=>Math.floor(x)+','+Math.floor(y);
const NUMBERS=/\b(level|lvl|L\d+|\d+\s*hp|hp\b|\d+%)/i;

// open tiles on the main land on the two banks of the river, a clear crossing needed between them
function banks(){for(let y=2;y<H-2;y++)for(let x=2;x<W-2;x++){if(tiles[I(x,y)]!==RIVER||!solidAt(x,y))continue;
    for(const [dx,dy] of [[1,0],[0,1]]){let i=1;while(i<6&&solidAt(x+dx*i,y+dy*i)&&solidWhy(x+dx*i,y+dy*i)==='river')i++;
      const p={x:x-dx+.5,y:y-dy+.5},q={x:x+dx*(i+1)+.5,y:y+dy*(i+1)+.5};
      if(p.x<1||p.y<1||q.x>=W||q.y>=H||solidAt(p.x,p.y)||solidAt(q.x,q.y))continue;
      if(land[I(Math.floor(p.x),Math.floor(p.y))]!==mainLand||land[I(Math.floor(q.x),Math.floor(q.y))]!==mainLand)continue;
      const r=route(p.x,p.y,q.x,q.y);if(r&&r.cross&&r.len>12&&!CITY.some(c=>Math.hypot(c.gate.x-p.x,c.gate.y-p.y)<8))return {p,q,r}}}
  return null}

// ---- a river and a detour ----
{const b=banks();ok(!!b,'a place where the river stands between two banks');
  if(b){knowAll();put(b.p.x,b.p.y);const o=act('move_to',{target:xy(b.q.x,b.q.y)});
    console.log('     e.g. '+o.way);
    ok(o.ok&&/^The river bars the straight way/.test(o.way||''),'the river is named: '+o.way);
    ok(/you go round by the .+ (bridge|ford), \w+, \d+ tiles off/.test(o.way||''),'and the crossing, by its known region, with its direction');
    ok(/The long way round: about \d+ tiles, \d+ as the crow flies/.test(o.way||''),'a detour says so');
    ok(o.going&&o.distance!=null&&o.route&&o.route.blocked==='river','the old line and the facts stay beside the words');
    for(let i=0;i<2;i++)step(1/60);const lk=act('look');console.log('     e.g. '+(lk.ground||[]).join(' | '));
    ok((lk.ground||[]).some(l=>/^The river bars the way to the .+, right beside you/.test(l)),'look names the river at your feet');
    ok(/^round the river by /.test(lk.your_way||''),'look says what the walk is going round: '+lk.your_way);
    const sv=act('survey');ok(sv.ok&&sv.ground.some(l=>/river/.test(l))&&!!sv.use,'survey reads the same ground');
    put(b.p.x,b.p.y);const pk=act('survey',{to:xy(b.q.x,b.q.y)});ok(pk.way===o.way&&a.pq.length===0,'survey {to} tells the same way and walks nowhere');
    forget();put(b.p.x,b.p.y);const u=act('survey',{to:xy(b.q.x,b.q.y)}),z=(u.route.by||[])[0];
    ok(!z||z.crossing==='unknown'||Math.hypot(b.q.x-b.p.x,b.q.y-b.p.y)<GROUND.SIGHT,'a hero who knows no land there is not told the crossing')}
}

// ---- a wall ----
{knowAll();const c=home,g=c.gate,mx=(c.x0+c.x1)/2,my=(c.y0+c.y1)/2;
  // from the side of town away from the gate, into town: round the wall and in by the gate
  const o0=nearestOpen(2*mx-g.x,2*my-g.y+(g.y>my?-(c.y1-c.y0):c.y1-c.y0),10,p=>!(p.x>=c.x0-1&&p.x<=c.x1+2&&p.y>=c.y0-1&&p.y<=c.y1+2));
  ok(!!o0,'ground behind the town');
  put(o0.x,o0.y);const o=act('move_to',{target:'square'});console.log('     e.g. '+o.way);
  ok(o.ok&&/^In by the gate\./.test(o.way||''),'into town: in by the gate');
  put(g.x,g.y+(g.y>my?-1:1));const inside=act('look');
  const put2=()=>{a.x=mx;a.y=my;a.state='town';a.dest=null;a.pq=[];a.path=null};
  put2();const out=act('survey',{to:ZONES[zoneAt(g.x,g.y)]});ok(out.ok&&/^Out by the gate\./.test(out.way||''),'out of town: out by the gate: '+out.way);
  const wall=(()=>{for(let r=1;r<8;r++){const t=groundScan(g,r);if(t.kinds.wall)return t}return null})();
  ok(!!wall&&groundLines(wall,{max:9}).some(l=>/^The town wall stands .*its gate lies to the/.test(l)),'the wall line points to its gate');
  ok(!NUMBERS.test(JSON.stringify(inside.ground||[])),'no level or HP in the ground lines')}

// ---- a door ----
{knowAll();const c=home;put(c.gate.x,c.gate.y);a.state='town';a.x=(c.x0+c.x1)/2;a.y=(c.y0+c.y1)/2;const o=act('move_to',{target:'inn'});
  ok(o.ok&&/You end at the inn door\./.test(o.way||'')&&o.route.door==='inn','a walk to the inn ends at its door: '+o.way)}

// ---- cliffs ----
{let peak=null;for(let i=0;i<W*H&&!peak;i+=3){const x=i%W,y=(i-x)/W;if(solidWhy(x,y)==='peak')peak={x:x+.5,y:y+.5}}
  if(peak){const s=groundScan(peak,6);ok(groundLines(s,{max:9}).some(l=>/^Sheer cliffs and peaks stand /.test(l)),'cliffs and peaks in words');
    const f=routeFacts({x:0,y:0,player:false},[]);ok(f&&f.tiles===0,'an empty walk is nothing')}
  else console.log('     (no peak on this map)')}

// ---- an unknown region ----
{forget();const here=home;put(here.gate.x,here.gate.y+(here.gate.y>(here.y0+here.y1)/2?2:-2));learnPlace(a,ZONES[zoneAt(a.x,a.y)],'home');
  const others=ZONES.filter((z,i)=>z&&z!==ZONES[zoneAt(a.x,a.y)]);
  const far=ZPTS.flat().filter(p=>Math.hypot(p.x-a.x,p.y-a.y)>GROUND.SIGHT*1.5&&route(a.x,a.y,p.x,p.y)&&!others.includes(ZONES[zoneAt(a.x,a.y)])).filter(p=>ZONES[zoneAt(p.x,p.y)]!==ZONES[zoneAt(a.x,a.y)])[0];
  ok(!!far,'a far spot in a region this hero has not heard of');
  const seen=[act('look'),act('survey'),act('survey',{to:xy(far.x,far.y)}),act('move_to',{target:xy(far.x,far.y)})];
  put(a.x,a.y);a.adv=null;seen.push(act('hunt',{where:xy(far.x,far.y)}));
  const words=JSON.stringify(seen);console.log('     e.g. '+seen[3].going+' / '+(seen[3].way||'(plain)'));
  const told=others.filter(n=>words.includes(n));
  ok(!told.length,'no unknown region is named in look, survey, move_to or hunt'+(told.length?': '+told.join(', ')+' '+words.slice(0,400):''));
  ok(!NUMBERS.test(seen.map(s=>s.way||'').join(' ')),'no level or HP in the way');
  const r0=act('survey',{to:others[0]});ok(r0.ok===false&&/never been/.test(r0.error||''),'survey {to} refuses a place it never heard of');
  const b=blockedBy(a.x,a.y,far.x,far.y);if(b){const o=routeFacts(a,[{x:far.x,y:far.y,st:'travel'}]);ok(o.blocked===b||o.blocked==='unknown','what bars it is named or unnamed, never wrong: '+o.blocked)}
  const fake={tiles:40,blocked:'unknown',by:[{crossing:'unknown',dir:'southeast'}]};
  ok(wayWords(fake,30)==='Land you do not know bars the straight way; the walk bends to the southeast. The long way round: about 40 tiles, 30 as the crow flies.','unknown land reads: '+wayWords(fake,30));
  ok(wayShort(fake)==='bending to the southeast','and the header says only the bend')}

// ---- a target with no way ----
{knowAll();const solidSpot=(()=>{for(let y=3;y<H-3;y++)for(let x=3;x<W-3;x++){const w=solidWhy(x,y);if((w==='peak'||w==='river'||w==='lava')&&!CITY.some(c=>Math.hypot(c.gate.x-x,c.gate.y-y)<6))return {x,y,w}}return null})();
  ok(!!solidSpot,'a solid spot');const st=home;put(st.gate.x,st.gate.y+(st.gate.y>(st.y0+st.y1)/2?2:-2));
  const o=act('move_to',{target:solidSpot.x+','+solidSpot.y});console.log('     e.g. '+o.way);
  ok(o.ok&&o.route&&o.route.ends_short&&/You cannot reach that spot \(.+\)\. The walk ends as near as the ground allows/.test(o.way||''),'a spot in solid ground: told, and the walk ends near it: '+o.way);
  ok(wayShort(o.route)==='as near as the ground allows; that spot cannot be reached','the header says so');
  ok(wayWords(null,10)===NO_WAY&&wayShort(null)==='no way on from here'&&betweenWords(null)==='no way you can find','no route at all is said, never silent');
  const pocket=wayWords({tiles:5,ends_short:true,short_by:3},8);ok(/nothing leads to it\..*3 tiles short/.test(pocket),'land shut off from yours: '+pocket)}

// ---- never silent on a detour ----
{knowAll();let bent=0,silent=[],n=0;const P=ZPTS.flat();
  const st={x:home.gate.x,y:home.gate.y+(home.gate.y>(home.y0+home.y1)/2?2:-2)};
  for(let i=0;i<P.length;i+=Math.ceil(P.length/150)){const p=P[i],o=routeFacts({...a,x:st.x,y:st.y},[{x:p.x,y:p.y,st:'travel'}]);if(!o)continue;n++;
    const d=Math.hypot(p.x-st.x,p.y-st.y),w=wayWords(o,d);if(o.tiles>=d*GROUND.DETOUR&&o.tiles-d>=GROUND.DETOUR_MIN||o.blocked||o.by){bent++;if(!w)silent.push(xy(p.x,p.y))}}
  ok(n>20&&bent>0&&!silent.length,'every walk that bends or crosses has words ('+bent+' of '+n+')'+(silent.length?': silent '+silent.slice(0,4):''))}

// ---- the header ----
{const b=banks();if(b){knowAll();put(b.p.x,b.p.y);act('move_to',{target:xy(b.q.x,b.q.y)});for(let i=0;i<3;i++)step(1/60);
    const w=wayNow(a),br=paceBrief(a.id).brief;ok(!!w&&br.way===w&&w.length<=70,'the header carries a short line on a detour: '+w);
    ok(wayNote(br)==='\nYour way: '+w+'.','as one line');
    a.pq=[];a.dest=null;ok(wayNow(a)===null&&wayNote(paceBrief(a.id).brief)==='','with no walk it says nothing');
    put(b.q.x,b.q.y);a.pq=[{kind:'move',legs:[{x:b.q.x+1,y:b.q.y,st:'travel'}],last:'hunt',label:'near'}];ok(wayNow(a)===null,'and nothing on plain going')}}

// ---- the DM reads the same layer ----
{const b=banks()||{p:{x:home.gate.x,y:home.gate.y},q:{x:home.gate.x+3,y:home.gate.y+3}};const r=8,s=survey({x:b.p.x,y:b.p.y,label:'bank'},r,{x:b.q.x,y:b.q.y,label:'far bank'});
  const lines=groundLines(groundScan(b.p,r),{max:GROUND.SURVEY,region:k=>k.region});
  ok(s.ok&&lines.every(l=>s.ground.includes(l)),'the DM survey carries the same lines');
  ok(Array.isArray(s.crossings)&&s.way&&s.way.to==='far bank'&&typeof s.way.words==='string'&&s.way.tiles>0,'with crossings and the way between two points: '+s.way.words);
  ok(s.roads&&s.water&&s.impassable&&s.legal_spots,'and keeps its old fields')}

// ---- no dice ----
{seedRng(9);const first=rnd();seedRng(9);knowAll();put(home.gate.x,home.gate.y+2);for(const z of ZONES)if(z)act('survey',{to:z});act('survey');act('look');
  ok(rnd()===first,'survey and look draw nothing from the RNG');seedRng(null)}

if(fail){console.log(fail+' check(s) failed');process.exit(1)}
if(!process.env.ELDMOOR_WORLD){const r=spawnSync(process.execPath,[process.argv[1]],{stdio:'inherit',env:{...process.env,ELDMOOR_WORLD:'stepping'}});if(r.status)process.exit(r.status)}
console.log('waycheck ok');
