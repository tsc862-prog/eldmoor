// Kragmaw the Cinder Wyrm: the world boss fight and raid mustering.
// Tuning: hit 55-85 every 1.6s, breath 22-30 every 7s on everyone within 4.6 tiles;
// raids need level 14+ heroes from one faction, 5+ of them or 4 with average gear score 9+; respawn 300s after a kill.
import {rnd,ri,pickA} from '../core/rng.js';
import {dist} from '../world/map.js';
import {BOSS_EPICS} from '../data/items.js';
import {S} from './state.js';
import {log,fac} from './chronicle.js';
import {pop} from './effects.js';
import {maxHp,gainXp,getEpic,goHome,agentDie} from './heroes.js';
import {guardMul} from './gear.js';
import {raidPull,goalEvent} from './goals.js';
import {record,timeline} from './history.js';
import {bossPull} from './narrator.js';

const RAID_COOLDOWN=240,RAID_LVL=14,RAID_FULL=5,RAID_GEAR=9; // entry level, party size that needs no gear check, average gear score otherwise
export function updBoss(dt){const boss=S.boss,agents=S.agents;
  if(!boss.alive){boss.respawn-=dt;if(boss.respawn<=0){boss.alive=true;boss.hp=boss.maxhp;boss.dmg=[0,0];log({t:'Kragmaw',c:'gd'},' stirs again in its Cinderpass lair.')}return}
  const eng=agents.filter(a=>a.state==='raid'&&dist(a,boss)<5);
  if(!eng.length){boss.hp=Math.min(boss.maxhp,boss.hp+boss.maxhp*.08*dt);if(boss.hp>=boss.maxhp)boss.dmg=[0,0];return}
  bossPull(eng); // Chronicler: scene line when a raid first engages (sim/narrator.js)
  boss.cd-=dt;boss.breath-=dt;
  if(boss.cd<=0){boss.cd=1.6;const t=pickA(eng);boss.face=t.x>boss.x?1:-1;const d=Math.round((55+rnd()*30)*guardMul(t));t.hp-=d;pop(t.x,t.y-.6,String(d),'#ff6a5a');if(t.hp<=0)agentDie(t,boss)}
  if(boss.breath<=0){boss.breath=7;S.fx.push({type:'ring',x:boss.x,y:boss.y-.5,life:.6});
    for(const t of eng){if(t.state!=='raid'||dist(t,boss)>4.6)continue;const d=Math.round(22+rnd()*8);t.hp-=d;pop(t.x,t.y-.6,String(d),'#ffa040');if(t.hp<=0)agentDie(t,boss)}}
  if(boss.hp<=0){boss.alive=false;boss.respawn=300;const f=boss.dmg[0]>=boss.dmg[1]?0:1;S.facStats[f].bosses++;
    log(fac(f),' slew ',{t:'Kragmaw the Cinder Wyrm',c:'gd'},'!');timeline('boss',fac(f),' slew ',{t:'Kragmaw the Cinder Wyrm',c:'gd'},'.');
    for(const a of agents)if(a.raid&&a.fac===f&&a.state==='raid')record(a,'Slew ',{t:'Kragmaw the Cinder Wyrm',c:'gd'},'!');
    const gs=new Set();for(const a of agents)if(a.raid&&a.fac===f&&a.state==='raid')gs.add(a.guild);gs.forEach(g=>g.bosses++);
    for(const a of agents)if(a.raid&&a.fac===f&&a.state==='raid'){gainXp(a,400);a.gold+=40;if(rnd()<.4)getEpic(a,pickA(BOSS_EPICS),'Kragmaw');goalEvent(a,'boss')}
    for(const a of agents)if(a.raid){a.raid=false;goHome(a)}}}

export function raidCheck(dt){const boss=S.boss,agents=S.agents;
  for(let f=0;f<2;f++){if(S.raidOn[f]&&!agents.some(a=>a.raid&&a.fac===f)){S.raidOn[f]=false;if(boss.alive){log('The ',fac(f),' raid on Kragmaw ended in defeat.');timeline('raid','The ',fac(f),' raid on Kragmaw ended in defeat.');S.raidT=Math.max(S.raidT,RAID_COOLDOWN)}}}
  S.raidT-=dt;if(S.raidT>0)return;S.raidT=45+rnd()*30;if(!boss.alive)return;
  const f=ri(0,1);if(S.raidOn[f])return;
  const cand=agents.filter(a=>a.fac===f&&a.lvl>=RAID_LVL&&['hunt','travel','town','return'].includes(a.state)).sort((x,y)=>(raidPull(y)-raidPull(x))||(y.lvl-x.lvl)).slice(0,6); // oath-bound (legend, Kragmaw heirloom) first
  if(cand.length<4||(cand.length<RAID_FULL&&cand.reduce((t,a)=>t+a.gear,0)/cand.length<RAID_GEAR))return;S.raidOn[f]=true;
  cand.forEach((a,i)=>{a.raid=true;a.raidIdx=i;a.state='raid';a.target=null;a.dest=null;a.hp=Math.max(a.hp,maxHp(a)*.8)});
  for(const a of cand)record(a,'Mustered with '+(cand.length-1)+' others to raid ',{t:'Kragmaw',c:'gd'},'’s lair.');
  log(fac(f),' musters ',String(cand.length),' heroes to raid Kragmaw’s lair.');timeline('raid',fac(f),' mustered '+cand.length+' heroes to raid Kragmaw’s lair.')}
