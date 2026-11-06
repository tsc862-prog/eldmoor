// Kragmaw the Cinder Wyrm: the world boss fight and raid mustering.
// Numbers live in data/bosses.js (template `kragmaw`): hit 55-85 every 1.6s, breath 22-30 every 7s on everyone within 4.6 tiles;
// raids need level 14+ heroes from one faction, 5+ of them or 4 with average gear score 9+; respawn 300s after a kill.
import {rnd,ri,pickA} from '../core/rng.js';
import {dist} from '../world/map.js';
import {BOSSES,phaseOf} from '../data/bosses.js';
import {S,loreSides,inCompany,raidSide} from './state.js';
import {log,fac} from './chronicle.js';
import {pop} from './effects.js';
import {maxHp,gainXp,getEpic,goHome,agentDie} from './heroes.js';
import {breathOnDowned} from './downed.js'; // Kragmaw's breath finishes the downed in its reach (#626)
import {actHurt} from './actlog.js';
import {dmgTaken} from './stats.js';
import {raidPull,goalEvent} from './goals.js';
import {record,timeline} from './history.js';
import {bossPull} from './narrator.js';
import {unitDraft,raidReserve,raidCompany,inMuster} from './council.js';
import {companyOf,members} from './company.js';
import {rivalDeed} from './rivals.js';
import {raidFirst,raidCore,focusCount} from './guildfocus.js';

export const RAID_LVL=14;
const RAID_COOLDOWN=240;export const RAID_FULL=5,RAID_GEAR=9; // party size that needs no gear check, average gear score otherwise
// The raid muster's size rule, shared with raid sites (sim/sites.js, #642): 5 or more, or 4 whose average gear score is 9+.
export const raidSized=c=>c.length>=RAID_FULL||c.length>=4&&c.reduce((t,a)=>t+a.gear,0)/c.length>=RAID_GEAR;
// Runs the template's phases, signature moves and enrage; Kragmaw has one phase, one breath and no enrage,
// so this plays exactly the fight the rebalance tuned. Adds are declared by templates but spawned by the crawl rework.
const tplOf=boss=>BOSSES[boss.tpl||'kragmaw'];
// Who raids under side f, for the Chronicle: a company by name in a lore world (#1025), else the faction.
const raidWho=f=>S.raidName&&S.raidName[f]?{t:S.raidName[f],c:'gd'}:fac(f);
export function updBoss(dt){const boss=S.boss,agents=S.agents,T=tplOf(boss);
  if(!boss.alive){boss.respawn-=dt;if(boss.respawn<=0){boss.alive=true;boss.hp=boss.maxhp;boss.dmg=[0,0];log({t:T.name,c:'gd'},T.wake)}return}
  const eng=agents.filter(a=>a.state==='raid'&&dist(a,boss)<5);
  if(!eng.length){boss.t=0;boss.hp=Math.min(boss.maxhp,boss.hp+boss.maxhp*.08*dt);if(boss.hp>=boss.maxhp)boss.dmg=[0,0];return}
  bossPull(eng); // Chronicler: scene line when a raid first engages (sim/narrator.js)
  boss.cd-=dt;boss.breath-=dt;boss.t=(boss.t||0)+dt;
  const ph=phaseOf(T,boss.hp/boss.maxhp),en=T.enrage&&boss.t>T.enrage.after?T.enrage.hit:1,hm=(ph.hit||1)*en,A=T.abilities[0];
  if(ph.name!==boss.phase){if(boss.phase&&ph.say)log({t:T.name,c:'gd'},': ',ph.say);boss.phase=ph.name}
  if(boss.cd<=0){boss.cd=T.attack.cd*(ph.cd||1);const t=pickA(eng);boss.face=t.x>boss.x?1:-1;const d=Math.round((T.attack.dmg[0]+rnd()*T.attack.dmg[1])*hm*dmgTaken(t));t.hp-=d;actHurt(t,boss,d);pop(t.x,t.y-.6,String(d),'#ff6a5a');if(t.hp<=0)agentDie(t,boss)}
  if(boss.breath<=0){boss.breath=A.cd;S.fx.push({type:'ring',x:boss.x,y:boss.y-.5,life:.6});
    for(const t of eng){if(t.state!=='raid'||dist(t,boss)>A.radius)continue;const d=Math.round((A.dmg[0]+rnd()*A.dmg[1])*hm);t.hp-=d;actHurt(t,boss,d,'breath');pop(t.x,t.y-.6,String(d),A.color||'#ffa040');if(t.hp<=0)agentDie(t,boss)}
    breathOnDowned(boss,A.radius)}
  if(boss.hp<=0){boss.alive=false;boss.respawn=T.respawn;boss.t=0;boss.phase=null;const f=boss.dmg[0]>=boss.dmg[1]?0:1;S.facStats[f].bosses++;
    log('The lava ring around the lair cools to black rock; the hoard lies open until the wyrm wakes.'); // memorials: render/memorials.js draws the cooled lair while the boss is dead
    log(raidWho(f),' slew ',{t:T.full,c:'gd'},'!');timeline('boss',raidWho(f),' slew ',{t:T.full,c:'gd'},'.');
    for(const a of agents)if(a.raid&&raidSide(a)===f&&a.state==='raid')record(a,'Slew ',{t:T.full,c:'gd'},'!');
    const gs=new Set();for(const a of agents)if(a.raid&&raidSide(a)===f&&a.state==='raid')gs.add(a.guild);gs.delete(null);gs.forEach(g=>g.bosses++);
    const foes=[];for(const a of agents)if(a.raid&&raidSide(a)!==f&&a.guild)foes.push(a.guild);gs.forEach(g=>rivalDeed('boss',g,foes)); // contested kills stoke rivalries (sim/rivals.js)
    for(const a of agents)if(a.raid&&raidSide(a)===f&&a.state==='raid'){gainXp(a,T.loot.xp);a.gold+=T.loot.gold;if(rnd()<T.loot.p)getEpic(a,pickA(T.loot.epics),T.loot.src);goalEvent(a,'boss')}
    for(const a of agents)if(a.raid){a.raid=false;goHome(a)}}}

// A solo's join_raid (#826): it falls in with its faction's muster already out. Returns false when none is; there is none to join in a lore world (#1025).
export function joinRaid(a){if(loreSides()||!S.boss.alive||!S.raidOn[a.fac])return false;
  a.raidOk=true;a.raid=true;a.raidIdx=S.agents.filter(b=>b.raid&&b.fac===a.fac).length;a.state='raid';a.target=null;a.dest=null;a.pq=[];a.hp=Math.max(a.hp,maxHp(a)*.8);
  record(a,'Joined the raid on ',{t:'Kragmaw',c:'gd'},'’s lair.');log(a,' rides to join the ',fac(a.fac),' raid on Kragmaw’s lair.');return true}
export function raidCheck(dt){const boss=S.boss,agents=S.agents;
  for(let f=0;f<2;f++){if(S.raidOn[f]&&!agents.some(a=>a.raid&&raidSide(a)===f)){S.raidOn[f]=false;if(boss.alive){const by=S.raidName&&S.raidName[f]?[raidWho(f),'’s']:['The ',fac(f)];log(...by,' raid on Kragmaw ended in defeat.');timeline('raid',...by,' raid on Kragmaw ended in defeat.');S.raidT=Math.max(S.raidT,RAID_COOLDOWN)}}}
  const rf=raidReserve(); // the Fellowship's muster comes first (#135): its faction is checked every few seconds and no background muster beats it
  S.raidT-=dt;if(S.raidT>0)return;S.raidT=rf>=0?6:45+rnd()*30;if(!boss.alive)return;
  const f=rf>=0?rf:ri(0,1);if(S.raidOn[f])return;
  // sides as lore (#1025): a company raids alone, all of it whatever its peoples, and the background's muster is its own
  const lore=loreSides(),RC=lore&&rf>=0?raidCompany():null,inPool=a=>RC?companyOf(a)===RC:a.fac===f&&!(lore&&inCompany(a))&&(a.lvl>=RAID_LVL||companyOf(a));
  const pool=agents.filter(a=>inPool(a)&&['hunt','travel','town','return'].includes(a.state)&&inMuster(a,'raid')).sort((x,y)=>(rf>=0&&(companyOf(y)?1:0)-(companyOf(x)?1:0))||(raidPull(y)-raidPull(x))||(raidFirst(y)-raidFirst(x))||(y.lvl-x.lvl)); // a Wyrmhunt guild's members (sim/guildfocus.js) muster first
  const cand=unitDraft(pool,pool,6,'raid'); // oath-bound (legend, Kragmaw heirloom) first; the Fellowship (#68) all together or not at all
  if(rf>=0&&!cand.some(a=>companyOf(a)))return; // reserved: background raiders only join under the Fellowship
  const core=cand.length>=4&&raidCore(cand); // a Wyrmhunt core goes without the gear check
  if(cand.length<4||(!core&&!raidSized(cand)))return;S.raidOn[f]=true;if(core)focusCount('raids');
  if(lore)(S.raidName||(S.raidName=[]))[f]=RC?RC.name:null;
  cand.forEach((a,i)=>{a.raid=true;a.raidIdx=i;if(RC)a.raidSide=f;else if(lore)delete a.raidSide;a.state='raid';a.target=null;a.dest=null;a.hp=Math.max(a.hp,maxHp(a)*.8)});
  for(const a of cand)record(a,'Mustered with '+(cand.length-1)+' others to raid ',{t:'Kragmaw',c:'gd'},'’s lair.');
  log(raidWho(f),' musters ',String(cand.length),' heroes to raid Kragmaw’s lair.');timeline('raid',raidWho(f),' mustered '+cand.length+' heroes to raid Kragmaw’s lair.')}
