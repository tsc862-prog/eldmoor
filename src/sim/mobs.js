// Monster spawning and AI: wander near home, chase an engaged hero, ambush
// travellers inside the mob's own zone, respawn after death. Also the zone
// ecology: unhunted zones fill toward a cap and their mobs drift toward the
// roads; named rare elites (ELITES) spawn, stalk their zone and drop epics.
import {rnd,ri,pickA} from '../core/rng.js';
import {W,H,ROAD} from '../world/tiles.js';
import {tiles,zone,I,ZONES,zonePoint,zoneAt,dist} from '../world/map.js';
import {MOBS,COUNTS,ELITES,ECO} from '../data/mobs.js';
import {CLS} from '../data/classes.js';
import {S} from './state.js';
import {log} from './chronicle.js';
import {pop} from './effects.js';
import {moveTo,agentDie} from './heroes.js';
import {guardMul} from './gear.js';
import {sightMul} from './weather.js';
import {eliteSight} from './narrator.js';

// Per-zone target population (today's COUNTS total), a COUNTS-weighted species list for extra
// spawns, and the road tiles mobs may drift toward.
const ZTARGET=[0,0,0,0],ZTYPES=[[],[],[],[]],ZROADS=[[],[],[],[]];
for(const t in COUNTS){ZTARGET[MOBS[t].z]+=COUNTS[t];for(let i=0;i<COUNTS[t];i++)ZTYPES[MOBS[t].z].push(t)}
for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(tiles[I(x,y)]!==ROAD)continue;const z=zone[I(x,y)];if(x>=ECO.roadMinX[z])ZROADS[z].push({x:x+.5,y:y+.5})}
const zoneOf=m=>MOBS[m.type].z;
const zonePop=z=>{let n=0;for(const m of S.mobs)if(!m.gone&&!m.elite&&zoneOf(m)===z)n++;return n};

// E: an ELITES entry turns the spawn into that named elite (level and multipliers from the table).
export function spawnMob(type,E){const M=MOBS[type],p=zonePoint(M.z);const lvl=E?E.lvl:ri(M.lv[0],M.lv[1]);
  const m={id:++S.uid,kind:'mob',type,lvl,x:p.x,y:p.y,home:{...p},spawn:{...p},maxhp:Math.round((25+lvl*16)*(E?E.scale:1)),hit:E?E.hit:1,
    alive:true,respawn:0,target:null,cd:0,face:1,wait:rnd()*3,dest:null,scan:rnd()};
  if(E){m.elite=true;m.name=E.name;m.title=E.title}
  m.hp=m.maxhp;S.mobs.push(m);return m}
export function spawnAll(){for(const t in COUNTS)for(let i=0;i<COUNTS[t];i++)spawnMob(t);
  S.zoneLastHero=[S.gameMin,S.gameMin,S.gameMin,S.gameMin];
  S.eco={t:ECO.tick,eliteT:60,empty:[false,false,false,false],eliteNext:[0,0,0,0],stats:{extra:0,culled:0,eliteSpawns:0,eliteKills:0,eliteDeaths:0}}}

function spawnElite(z){const E=ELITES[z],m=spawnMob(E.base,E);S.eco.stats.eliteSpawns++;
  log('Rumours spread of ',{t:m.name,c:'gd'},', ',E.title,', stalking ',ZONES[z],'.')}

// Slide a mob's home toward the nearest road tile of its zone, never across a zone border.
function driftHome(m,z){const R=ZROADS[z];if(!R.length)return;let best=null,bd=1e9;
  for(const r of R){const d=dist(m.home,r);if(d<bd){bd=d;best=r}}
  if(bd<1)return;const st=Math.min(ECO.drift,bd-.8),nx=m.home.x+(best.x-m.home.x)/bd*st,ny=m.home.y+(best.y-m.home.y)/bd*st;
  if(zoneAt(nx,ny)!==z)return;m.home.x=nx;m.home.y=ny}

// Called once per step after the mob loop. Tracks hero presence per zone, grows unhunted zones
// toward their cap and drifts their mobs roadward, purges culled mobs, and rolls for elites.
export function ecologyTick(dt){const E=S.eco;
  for(const a of S.agents){if(a.state==='dead'||a.state==='town'||a.state==='ghost'||a.hidden||a.x<14)continue;S.zoneLastHero[zoneAt(a.x,a.y)]=S.gameMin}
  for(let z=0;z<4;z++)E.empty[z]=S.gameMin-S.zoneLastHero[z]>ECO.emptyAfter;
  E.t-=dt;if(E.t<=0){E.t=ECO.tick;
    for(let z=0;z<4;z++){if(!E.empty[z])continue;
      if(zonePop(z)<Math.round(ZTARGET[z]*ECO.cap)){spawnMob(pickA(ZTYPES[z]));E.stats.extra++}
      for(const m of S.mobs)if(m.alive&&!m.gone&&!m.elite&&zoneOf(m)===z)driftHome(m,z)}
    for(let i=S.mobs.length-1;i>=0;i--)if(S.mobs[i].gone)S.mobs.splice(i,1)}
  E.eliteT-=dt;if(E.eliteT<=0){E.eliteT=60;
    for(let z=0;z<4;z++){if(S.gameMin<E.eliteNext[z]||S.mobs.some(m=>m.elite&&!m.gone&&zoneOf(m)===z))continue;if(rnd()<1/ECO.eliteRoll)spawnElite(z)}}}

export function updMob(m,dt){
  if(m.gone)return;const z=zoneOf(m);
  if(!m.alive){
    if(m.elite){m.gone=true;S.eco.eliteNext[z]=S.gameMin+ECO.eliteCd;S.eco.stats.eliteKills++;return} // elites do not respawn; the zone rolls a new one after the cooldown
    m.respawn-=dt*(S.eco.empty[z]?3:1); // unhunted zones refill faster
    if(m.respawn<=0){
      if(!S.eco.empty[z]&&zonePop(z)>ZTARGET[z]){m.gone=true;S.eco.stats.culled++;return} // hunted zones decay back to target
      m.alive=true;m.hp=m.maxhp;m.home={...m.spawn};m.x=m.home.x;m.y=m.home.y;m.target=null;m.dest=null}return}
  eliteSight(m,dt); // Chronicler: first hero within sight of a living elite (sim/narrator.js)
  m.cd-=dt;const t=m.target;
  if(t){const engaged=(t.state==='fight'&&t.target===m)||(t.state==='hunt'||t.state==='travel');
    if(t.state==='ghost'||!engaged||dist(m,m.home)>10){m.target=null;m.dest={...m.home};return}
    if(t.state!=='fight'){t.state='fight';t.target=m;t.dest=null}
    const d=dist(m,t);m.face=t.x>m.x?1:-1;
    if(d>1){moveTo(m,t.x,t.y,dt,2.1);return}m.moving=false;
    if(m.cd<=0){m.cd=1.3;const dm=Math.round((3+m.lvl*2)*m.hit*(.8+rnd()*.4)*(CLS[t.cls].arm||1)*guardMul(t));t.hp-=dm;pop(t.x,t.y-.6,String(dm),'#ff6a5a');
      if(t.hp<=0){if(m.elite)S.eco.stats.eliteDeaths++;agentDie(t,m)}}return}
  m.hp=Math.min(m.maxhp,m.hp+m.maxhp*(m.elite?.01:.1)*dt); // elites mend slowly: hit-and-run heroes can wear one down
  if(m.dest){if(moveTo(m,m.dest.x,m.dest.y,dt,.9))m.dest=null}
  else{m.wait-=dt;if(m.wait<=0){m.wait=2+rnd()*5;if(m.elite&&rnd()<.25)m.home=zonePoint(z,m.home); // elites stalk the whole zone
    m.dest={x:m.home.x+(rnd()-.5)*4,y:m.home.y+(rnd()-.5)*4}}}
  m.scan-=dt;if(m.scan<=0){m.scan=.6;
    for(const a of S.agents){if((a.state!=='travel'&&a.state!=='hunt')||zoneAt(a.x,a.y)!==z)continue; // territorial: no ambushing travellers outside the mob's own zone
      if(m.elite){if(a.lvl<m.lvl-2||a.hp<.9*(CLS[a.cls].hp+a.lvl*14+a.gear*6+a.epics.length*10))continue; // elites ignore small prey and the already wounded
        if(dist(a,m)<2.2&&rnd()<.5){m.target=a;a.state='fight';a.target=m;a.dest=null;break}continue}
      if(m.lvl<a.lvl-3)continue;
      if(dist(a,m)<1.3*sightMul(z)&&rnd()<.3){m.target=a;a.state='fight';a.target=m;a.dest=null;break}}}}
