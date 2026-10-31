// Monster spawning and AI: wander near home, chase an engaged hero, ambush
// travellers inside the mob's own zone, respawn after death.
import {rnd,ri} from '../core/rng.js';
import {zonePoint,zoneAt,dist} from '../world/map.js';
import {MOBS,COUNTS} from '../data/mobs.js';
import {CLS} from '../data/classes.js';
import {S} from './state.js';
import {pop} from './effects.js';
import {moveTo,agentDie} from './heroes.js';

export function spawnMob(type){const M=MOBS[type],p=zonePoint(M.z);const lvl=ri(M.lv[0],M.lv[1]);
  const m={id:++S.uid,kind:'mob',type,lvl,x:p.x,y:p.y,home:{...p},maxhp:25+lvl*16,alive:true,respawn:0,target:null,cd:0,face:1,wait:rnd()*3,dest:null,scan:rnd()};
  m.hp=m.maxhp;S.mobs.push(m)}
export function spawnAll(){for(const t in COUNTS)for(let i=0;i<COUNTS[t];i++)spawnMob(t)}

export function updMob(m,dt){
  if(!m.alive){m.respawn-=dt;if(m.respawn<=0){m.alive=true;m.hp=m.maxhp;m.x=m.home.x;m.y=m.home.y;m.target=null}return}
  m.cd-=dt;const t=m.target;
  if(t){const engaged=(t.state==='fight'&&t.target===m)||(t.state==='hunt'||t.state==='travel');
    if(t.state==='ghost'||!engaged||dist(m,m.home)>10){m.target=null;m.dest={...m.home};return}
    if(t.state!=='fight'){t.state='fight';t.target=m;t.dest=null}
    const d=dist(m,t);m.face=t.x>m.x?1:-1;
    if(d>1){moveTo(m,t.x,t.y,dt,2.1);return}m.moving=false;
    if(m.cd<=0){m.cd=1.3;const dm=Math.round((3+m.lvl*2)*(.8+rnd()*.4)*(CLS[t.cls].arm||1));t.hp-=dm;pop(t.x,t.y-.6,String(dm),'#ff6a5a');
      if(t.hp<=0)agentDie(t,m)}return}
  m.hp=Math.min(m.maxhp,m.hp+m.maxhp*.1*dt);
  if(m.dest){if(moveTo(m,m.dest.x,m.dest.y,dt,.9))m.dest=null}
  else{m.wait-=dt;if(m.wait<=0){m.wait=2+rnd()*5;m.dest={x:m.home.x+(rnd()-.5)*4,y:m.home.y+(rnd()-.5)*4}}}
  m.scan-=dt;if(m.scan<=0){m.scan=.6;
    for(const a of S.agents){if((a.state!=='travel'&&a.state!=='hunt')||m.lvl<a.lvl-3||zoneAt(a.x,a.y)!==MOBS[m.type].z)continue; // territorial: no ambushing travellers outside the mob's own zone
      if(dist(a,m)<1.3&&rnd()<.3){m.target=a;a.state='fight';a.target=m;a.dest=null;break}}}}
