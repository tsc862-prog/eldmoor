// Monster spawning and AI: wander near home, chase an engaged hero, ambush
// travellers inside the mob's own zone, respawn after death. Also the zone
// ecology: unhunted zones fill toward a cap and their mobs drift toward the
// roads; named rare elites (ELITES) spawn, stalk their zone and drop epics.
import {rnd,ri,pickA} from '../core/rng.js';
import {W,H,ROAD,WALKABLE} from '../world/tiles.js';
import {tiles,zone,I,ZONES,zonePoint,zoneAt,dist,tileAt} from '../world/map.js';
import {MOBS,COUNTS,ELITES,ECO} from '../data/mobs.js';
import {blockOf,ABILITIES,ELITE_TEMPLATE,ELITE_EXTRA,NAMED_KITS,tagMul,heroTag} from '../data/bestiary.js';
import {CLS} from '../data/classes.js';
import {S} from './state.js';
import {log} from './chronicle.js';
import {timeline} from './history.js';
import {pop} from './effects.js';
import {moveTo,agentDie} from './heroes.js';
import {actHurt} from './actlog.js';
import {dmgTaken} from './stats.js';
import {sightMul} from './weather.js';
import {eliteSight} from './narrator.js';
import {nearHeroes,nearMobs,LOD,heroCellsNear} from './spatial.js';
import {held} from './scenes.js'; // the engaged of a live-clock Table scene (#518)
import {trick as loreTrick} from './lore.js'; // a creature's tricks, learned by the agent hero it is used on (#188)
import {inSlots} from './company.js'; // the slotted company (#588)

// Per-zone target population (today's COUNTS total), a COUNTS-weighted species list for extra
// spawns, and the road tiles mobs may drift toward.
const NZ=ZONES.length,ZTARGET=ZONES.map(()=>0),ZTYPES=ZONES.map(()=>[]),ZROADS=ZONES.map(()=>[]);
for(const t in COUNTS){ZTARGET[MOBS[t].z]+=COUNTS[t];for(let i=0;i<COUNTS[t];i++)ZTYPES[MOBS[t].z].push(t)}
for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(tiles[I(x,y)]!==ROAD)continue;const z=zone[I(x,y)];if(x>=(ECO.roadMinX[z]||0))ZROADS[z].push({x:x+.5,y:y+.5})}
const zoneOf=m=>MOBS[m.type].z;
const zonePop=z=>{let n=0;for(const m of S.mobs)if(!m.gone&&!m.elite&&!m.add&&zoneOf(m)===z)n++;return n};

// The stat block a mob fights with (data/bestiary.js): its species or site variant.
export const blk=m=>blockOf(m.type,m.v,m.role);
// E: an ELITES entry turns the spawn into that named elite (level and multipliers from the table; the elite
// template adds its one extra ability). opt: lvl, variant (a VARIANTS key), name, title, abilities (replaces
// the block's), role-free multipliers hpMul / hitMul, add (a summoned lesser kin: no respawn, no loot),
// special (a custom foe), res / weak (replace the block's), xpMul.
export function spawnMob(type,E,opt={}){const M=MOBS[type],p=zonePoint(M.z),B=blockOf(type,opt.variant,opt.role);
  const lvl=E?E.lvl:opt.lvl!=null?opt.lvl:ri(M.lv[0],M.lv[1]);
  const m={id:++S.uid,kind:'mob',type,lvl,x:p.x,y:p.y,home:{...p},spawn:{...p},
    maxhp:Math.round((25+lvl*16)*B.hp*(E?E.scale:1)*(opt.hpMul||1)),hit:B.hit*(E?E.hit:1)*(opt.hitMul||1),acd:B.cd,
    alive:true,respawn:0,target:null,cd:0,face:1,wait:rnd()*3,dest:null,scan:rnd()};
  if(opt.variant){m.v=opt.variant;m.name=B.name}if(opt.role)m.role=opt.role;
  const ab=opt.abilities||B.abilities.slice();
  if(E){m.elite=true;m.name=E.name;m.title=E.title;const x=ELITE_EXTRA[E.name];if(x&&!ab.includes(x))ab.push(x)}
  if(opt.name)m.name=opt.name;if(opt.title)m.title=opt.title;
  m.ab=ab;m.abcd={};if(opt.res)m.res=opt.res;if(opt.weak)m.weak=opt.weak;if(opt.xpMul!=null)m.xpMul=opt.xpMul;
  if(opt.add){m.add=true;m.parent=opt.parent;m.xpMul=.25}if(opt.special)m.special=true;
  m.hp=m.maxhp;m.hpl=m.hp;S.mobs.push(m);return m}
export function spawnAll(){for(const t in COUNTS)for(let i=0;i<COUNTS[t];i++)spawnMob(t);
  S.zoneLastHero=ZONES.map(()=>S.gameMin);
  S.eco={t:ECO.tick,eliteT:60,empty:ZONES.map(()=>false),eliteNext:ZONES.map(()=>0),stats:{extra:0,culled:0,eliteSpawns:0,eliteKills:0,eliteDeaths:0}}}

function spawnElite(z){const E=ELITES[z];if(!E)return; // no row for this zone (#308): skip, never throw
  const m=spawnMob(E.base,E);S.eco.stats.eliteSpawns++;
  log('Rumours spread of ',{t:m.name,c:'gd'},', ',E.title,', stalking ',ZONES[z],'.');timeline('elite',{t:m.name,c:'gd'},', '+E.title+', began stalking '+ZONES[z]+'.')}

// Slide a mob's home toward the nearest road tile of its zone, never across a zone border.
function driftHome(m,z){const R=ZROADS[z];if(!R.length)return;let best=null,bd=1e9;
  for(const r of R){const d=dist(m.home,r);if(d<bd){bd=d;best=r}}
  if(bd<1)return;const st=Math.min(ECO.drift,bd-.8),nx=m.home.x+(best.x-m.home.x)/bd*st,ny=m.home.y+(best.y-m.home.y)/bd*st;
  if(zoneAt(nx,ny)!==z)return;m.home.x=nx;m.home.y=ny}

// Called once per step after the mob loop. Tracks hero presence per zone, grows unhunted zones
// toward their cap and drifts their mobs roadward, purges culled mobs, and rolls for elites.
export function ecologyTick(dt){const E=S.eco;
  for(const a of S.agents){if(a.state==='dead'||a.state==='town'||a.state==='ghost'||a.hidden||a.x<14)continue;S.zoneLastHero[zoneAt(a.x,a.y)]=S.gameMin}
  for(let z=0;z<NZ;z++)E.empty[z]=S.gameMin-S.zoneLastHero[z]>ECO.emptyAfter;
  E.t-=dt;if(E.t<=0){E.t=ECO.tick;
    for(let z=0;z<NZ;z++){if(!E.empty[z])continue;
      if(zonePop(z)<Math.round(ZTARGET[z]*ECO.cap)){spawnMob(pickA(ZTYPES[z]));E.stats.extra++}
      for(const m of S.mobs)if(m.alive&&!m.gone&&!m.elite&&zoneOf(m)===z)driftHome(m,z)}
    for(let i=S.mobs.length-1;i>=0;i--)if(S.mobs[i].gone)S.mobs.splice(i,1)}
  E.eliteT-=dt;if(E.eliteT<=0){E.eliteT=60;
    for(let z=0;z<NZ;z++){if(S.gameMin<E.eliteNext[z]||S.mobs.some(m=>m.elite&&!m.gone&&zoneOf(m)===z))continue;if(rnd()<1/ECO.eliteRoll)spawnElite(z)}}}

// ---- abilities (issue #84) ----
// A scripted policy: when a mob's attack timer is ready it fires the first ability that is off cooldown and
// whose `when` holds, else bites. Effects touch only the mob, the hero's attack timer, position and hp, so
// heroes.js needs no hooks. unit = the mob's own bite before variance.
const MOB_HIT=1.35; // #154: mobs from level 7 bite 1.35x (deaths floor); ramps in from level 3 so level 1-3 heroes are not hit harder
const hitRamp=m=>1+(MOB_HIT-1)*Math.min(1,Math.max(0,(m.lvl-3)/4));
const unitOf=m=>(3+m.lvl*2)*m.hit*hitRamp(m);
function hurt(t,m,dm){if(dm<=0||t.state==='dead'||t.state==='ghost')return;if(inSlots(t))dm/=hitRamp(m); // the Fellowship keeps the old bite (#154: the world is deadlier, the story is not ground down)
  dm=Math.max(1,Math.round(dm*dmgTaken(t)));t.hp-=dm;actHurt(t,m,dm);pop(t.x,t.y-.6,String(dm),'#ff6a5a');
  if(t.hp<=0){if(m.elite)S.eco.stats.eliteDeaths++;agentDie(t,m)}}
// One bite at the Table (sim/tableround.js, #276): the creature's own blow (variance, crit, the Fellowship's cut) through
// hurt(); mul scales it (a natural 20). Returns the damage dealt.
export function mobBlow(m,t,mul=1){const h=t.hp;hurt(t,m,unitOf(m)*(.8+rnd()*.4)*(rnd()<blk(m).crit?1.6:1)*mul);return Math.max(0,Math.round(h-Math.max(0,t.hp)))}
const alliesHurt=m=>nearMobs(m.x,m.y,6,o=>o!==m&&o.alive&&!o.gone&&o.hp<o.maxhp*.5)[0]||null;
const packNear=m=>nearMobs(m.x,m.y,5,o=>o!==m&&o.alive&&!o.gone&&o.type===m.type&&(o.target||m.target)).length>0;
const liveAdds=m=>S.mobs.reduce((n,o)=>n+(o.add&&o.parent===m.id&&o.alive&&!o.gone?1:0),0);
function ready(m,A,id){if((m.abcd[id]||0)>0)return false;
  switch(A.when){case 'hurt':return m.hp<m.maxhp*(A.hp||.5)&&(A.fx!=='summon'||liveAdds(m)<A.max);case 'pack':return packNear(m);case 'ally':return !!alliesHurt(m);default:return true}}
// Fire one ability at t. Returns true when it used the mob's attack turn.
function useAbility(m,t){for(const id of m.ab||[]){const A=ABILITIES[id];if(!A||!ready(m,A,id))continue;
  m.abcd[id]=A.cd;const u=unitOf(m);if(t&&t.player)loreTrick(t,m,id);
  switch(A.fx){
    case 'frenzy':m.frenzy=A.dur;pop(m.x,m.y-.8,'FRENZY','#ff8a5a');continue; // a free action: the bite still lands
    case 'poison':{const dps=A.dmg*u/A.dur/(inSlots(t)?hitRamp(m):1),d=(m.dots||(m.dots=[])).find(x=>x.h===t&&x.id===id);if(d){d.rem=A.dur;d.dps=dps}else m.dots.push({h:t,id,rem:A.dur,dps});pop(t.x,t.y-.9,'POISON','#7dce5a');break}
    case 'slow':case 'root':case 'fear':t.cd+=A.lose;hurt(t,m,A.dmg*u);pop(t.x,t.y-.9,A.fx==='slow'?'SLOWED':A.fx==='root'?'ROOTED':'FEAR','#9ad0ff');break;
    case 'knockback':{hurt(t,m,A.dmg*u);if(t.hp>0){const dx=t.x-m.x,dy=t.y-m.y,d=Math.hypot(dx,dy)||1,nx=t.x+dx/d*A.push,ny=t.y+dy/d*A.push;
      if(WALKABLE.includes(tileAt(nx,ny))&&zoneAt(nx,ny)===zoneAt(t.x,t.y)){t.x=nx;t.y=ny}t.cd+=A.lose;pop(t.x,t.y-.9,'KNOCKED BACK','#ffd080')}break}
    case 'summon':{for(let k=0;k<A.n&&liveAdds(m)<A.max;k++){const a=spawnMob(m.type,null,{variant:m.v,lvl:Math.max(1,m.lvl-3),hpMul:.4,hitMul:.6,abilities:[],add:true,parent:m.id});
      a.x=m.x+(rnd()-.5)*1.4;a.y=m.y+(rnd()-.5)*1.4;a.home={x:a.x,y:a.y};a.spawn={x:a.x,y:a.y};a.target=t;a.pack=true}pop(m.x,m.y-.8,'KIN','#c0e090');break}
    case 'heal':{const o=alliesHurt(m);if(!o)break;o.hp=Math.min(o.maxhp,o.hp+o.maxhp*A.amount);o.hpl=o.hp;pop(o.x,o.y-.6,'+'+Math.round(o.maxhp*A.amount),'#7dce5a');break}
    case 'breath':{S.fx.push({type:'ring',x:m.x,y:m.y-.5,life:.5});for(const h of nearHeroes(m.x,m.y,A.radius,h=>h===t||h.target===m))hurt(h,m,A.dmg*u);break}
  }
  m.cd=m.acd*(m.frenzy>0?.8:1);return true}return false}
function tickDots(m,dt){const L=m.dots;for(let i=L.length-1;i>=0;i--){const d=L[i],h=d.h;
  if(!h||h.state==='dead'||h.state==='ghost'||h.state==='town'||h.hp<=0){L.splice(i,1);continue}
  d.acc=(d.acc||0)+d.dps*Math.min(dt,d.rem);d.rem-=dt;
  if(d.acc>=1){const n=Math.floor(d.acc);d.acc-=n;const dd=Math.max(1,Math.round(n*dmgTaken(h)));h.hp-=dd;actHurt(h,m,dd,'venom');if(h.hp<=0){if(m.elite)S.eco.stats.eliteDeaths++;L.splice(i,1);agentDie(h,m);continue}}
  if(d.rem<=0)L.splice(i,1)}}
// A pack-caller drags nearby kin into the fight; they bite the same hero while it fights the first.
function callPack(m,a,B){if(!B.beh.pack)return;let n=B.beh.pack;
  for(const o of nearMobs(m.x,m.y,5,o=>o!==m&&o.alive&&!o.gone&&o.type===m.type&&!o.target&&!o.elite&&!o.add)){if(n--<=0)break;o.target=a;o.pack=true;o.dest=null}
  if(a&&a.player&&n<B.beh.pack)loreTrick(a,m,'pack')}

export function updMob(m,dt){
  if(m.gone)return;const z=zoneOf(m),B=blk(m);
  if(!m.alive){
    m.dots=null;
    if(m.elite||m.add){m.gone=true;if(m.elite){S.eco.eliteNext[z]=S.gameMin+ECO.eliteCd;S.eco.stats.eliteKills++}return} // elites do not respawn; the zone rolls a new one after the cooldown
    m.respawn-=dt*(S.eco.empty[z]?3:1); // unhunted zones refill faster
    if(m.respawn<=0){
      if(!S.eco.empty[z]&&zonePop(z)>ZTARGET[z]){m.gone=true;S.eco.stats.culled++;return} // hunted zones decay back to target
      m.alive=true;m.hp=m.maxhp;m.hpl=m.hp;m.home={...m.spawn};m.x=m.home.x;m.y=m.home.y;m.target=null;m.dest=null;m.fledOnce=false;m.fled=0;m.frenzy=0;m.pack=false}return}
  // Guard and resistance act on the hits taken since last frame (the killing blow is already resolved by the hero).
  if(m.hpl!=null&&m.hp<m.hpl){const t=m.target,f=(1-B.guard)*tagMul(m.res||B.res,m.weak||B.weak,t&&t.cls?heroTag(t.cls):'physical');m.hp=m.hpl-(m.hpl-m.hp)*f}
  if(m.dots&&m.dots.length)tickDots(m,dt);
  eliteSight(m,dt); // Chronicler: first hero within sight of a living elite (sim/narrator.js)
  m.cd-=dt;for(const id in m.abcd)m.abcd[id]-=dt;if(m.frenzy>0)m.frenzy-=dt;const t=m.target;
  if(m.fled>0){m.fled-=dt;if(t){const dx=m.x-t.x,dy=m.y-t.y,d=Math.hypot(dx,dy)||1;moveTo(m,m.x+dx/d*3,m.y+dy/d*3,dt,2.1)}m.hpl=m.hp;return}
  if(t){const engaged=(t.state==='fight'&&(t.target===m||m.pack))||(t.state==='hunt'||t.state==='travel');
    if(t.state==='ghost'||t.state==='dead'||!engaged||dist(m,t)>10||held(t)){m.target=null;m.pack=false;m.dest={...m.home};m.hpl=m.hp;return} // a hero held in a scene (#518) is let be
    if(t.state!=='fight'){t.state='fight';t.target=m;t.dest=null}
    const d=dist(m,t);m.face=t.x>m.x?1:-1;
    if(d>B.reach){moveTo(m,t.x,t.y,dt,2.1);m.hpl=m.hp;return}m.moving=false;
    for(const id of m.ab||[])if(m.abcd[id]==null)m.abcd[id]=ABILITIES[id].cd*(.4+rnd()*.4); // first use a little way into the fight
    if(B.beh.flee&&!m.fledOnce&&!m.elite&&m.hp<m.maxhp*B.beh.flee){m.fledOnce=true;m.fled=2.5;pop(m.x,m.y-.8,'FLEES','#ffb060');m.hpl=m.hp;return}
    if(m.cd<=0&&!useAbility(m,t)){m.cd=m.acd*(m.frenzy>0?.8:1);hurt(t,m,unitOf(m)*(m.frenzy>0?1.35:1)*(.8+rnd()*.4)*(rnd()<B.crit?1.6:1))}
    m.hpl=m.hp;return}
  m.hp=Math.min(m.maxhp,m.hp+m.maxhp*(m.elite?.01:.1)*dt); // elites mend slowly: hit-and-run heroes can wear one down
  if(LOD.on&&!m.elite&&!heroCellsNear(m.x,m.y,LOD.SLEEP_R)){m.moving=false;m.hpl=m.hp;return} // #433 LOD (off by default): asleep, nobody near
  if(m.dest){if(moveTo(m,m.dest.x,m.dest.y,dt,.9))m.dest=null}
  else{m.wait-=dt;if(m.wait<=0){m.wait=2+rnd()*5;if(m.elite&&rnd()<.25)m.home=zonePoint(z,m.home); // elites stalk the whole zone
    m.dest={x:m.home.x+(rnd()-.5)*4,y:m.home.y+(rnd()-.5)*4}}}
  m.scan-=dt;if(m.scan<=0&&m.spared>S.gameMin)m.scan=.6; // talked down at the Table (#296): it leaves people be for a while
  if(m.scan<=0){m.scan=.6;const reach=m.elite?ELITE_TEMPLATE.aggro:B.beh.aggro*sightMul(z); // ambush reach; the index returns heroes within it, id-ascending (sim/spatial.js)
    for(const a of nearHeroes(m.x,m.y,reach)){if((a.state!=='travel'&&a.state!=='hunt')||held(a)||(B.beh.territorial&&zoneAt(a.x,a.y)!==z))continue; // territorial: no ambushing travellers outside the mob's own zone
      if(m.elite){if(a.lvl<m.lvl-2||a.hp<.9*(CLS[a.cls].hp+a.lvl*14+a.gear*6+a.epics.length*10))continue; // elites ignore small prey and the already wounded
        if(dist(a,m)<ELITE_TEMPLATE.aggro&&rnd()<.5){m.target=a;a.state='fight';a.target=m;a.dest=null;break}continue}
      if(m.lvl<a.lvl-3)continue;
      if(dist(a,m)<B.beh.aggro*sightMul(z)&&rnd()<.3){m.target=a;a.state='fight';a.target=m;a.dest=null;callPack(m,a,B);break}}}
  m.hpl=m.hp}
