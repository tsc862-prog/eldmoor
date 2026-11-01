// Backstories and personal goals. Every recruit gets an origin sentence (a.origin, with
// a.originShort for the recruit line and a.home for the hamlet) and an oath (a.goal =
// {type, text, tier, target?, targetId?, victim?, need, progress, done}) drawn from the
// living world: real elites, real epics, a guildmate's real killer, a living rival.
// Owned by character-builder (templates in data/origins.js, assignment and progress here);
// the three decision hooks are the ai-designer's: pilgrim travel (pilgrimSteer, called from
// goalsTick), crypt-group picks (cryptPull in dungeon.js) and raid picks (raidPull in boss.js).
//
// Goal types and how they finish:
//   avenge        kill the named rare elite                 (killMob -> goalEvent 'kill')
//   avengeHero    kill, or be in the fight that kills, the enemy who slew a guildmate (agentDie -> 'slay'); also a nemesis entry
//   heirloom      loot a named zone epic                    (getEpic -> 'epic')
//   heirloomCrypt loot a named Sunken Crypt epic            (getEpic -> 'epic'); joins crypt groups first
//   heirloomBoss  loot a named Kragmaw epic                 (getEpic -> 'epic'); first pick for raids
//   pilgrimFar    set foot in PILGRIM_ZONE                  (goalsTick); steers travel once within 3 levels of its band
//   pilgrimCrypt  reach the Sunken Crypt mouth              (goalsTick); same steering
//   ascend        reach level N                             (gainXp -> 'level')
//   rival         out-level a named living enemy hero       (goalsTick)
//   legend        be in the raid that kills Kragmaw         (updBoss -> 'boss'); first pick for raids
//   hoard         hold N gold at once                       (goalsTick)
//   delve         clear the Sunken Crypt                    (dungeonCheck -> 'crypt'); joins crypt groups first
// Tiers: a recruit's first oath is tier 0; each kept oath rolls the next tier (max 2). An oath
// whose target dies first is void and re-rolled at the same tier. Counts live on S.goals.
import {rnd,ri,pickA} from '../core/rng.js';
import {CITY,CRYPT,ZONES,ZPTS,zoneAt,zoneFor,dist} from '../world/map.js';
import {FAC} from '../data/factions.js';
import {ELITES} from '../data/mobs.js';
import {EPICS,DG_EPICS,BOSS_EPICS} from '../data/items.js';
import {HAMLETS,TRADES,RAIDERS,PILGRIM_ZONE,KIN,CHILD,ORIGINS,GOAL_TEXT,GOAL_DONE} from '../data/origins.js';
import {S} from './state.js';
import {log} from './chronicle.js';
import {goHome} from './heroes.js';

const fill=(t,v)=>t.replace(/\{(\w+)\}/g,(m,k)=>v[k]!==undefined?String(v[k]):m);
const lc=t=>t.charAt(0).toLowerCase()+t.slice(1);
const stats=()=>S.goals||(S.goals={rolled:{},done:{},moot:0,pilgrimSteers:0});
const bump=(o,k)=>{o[k]=(o[k]||0)+1};

// Lowest level that hunts in zone z (from the zoneFor ladder), so goals can speak in bands.
const bandMin=z=>{for(let l=1;l<=20;l++)if(zoneFor(l)===z)return l;return 99};
const FAR=ZONES.indexOf(PILGRIM_ZONE),CRYPT_Z=zoneAt(CRYPT.x,CRYPT.y);
const alive=x=>x&&x.state!=='dead';
const byId=id=>S.agents.find(x=>x.id==id); // loose: nemesis keys are strings

// ---- origins ----
// Low-zone elites come up more often in backstories: a recruit who swears to kill one should
// have a chance of living to do it.
function originElite(){const w=ELITES.map((E,i)=>ELITES.length-i);let r=rnd()*w.reduce((s,x)=>s+x,0);
  for(let i=0;i<ELITES.length;i++){r-=w[i];if(r<0)return ELITES[i]}return ELITES[0]}
// A family heirloom: any zone epic below the far zone, or a Crypt relic.
const originEpic=()=>pickA([...EPICS.filter((e,z)=>z!==FAR).flat(),...DG_EPICS]);

export function assignBackstory(a){const f=a.fac,o=pickA(ORIGINS[f]),E=originElite(),ep=originEpic();
  const v={name:a.name,hamlet:pickA(HAMLETS[f]),trade:pickA(TRADES[f]),child:pickA(CHILD),kin:pickA(KIN),elite:E.name,
    other:pickA(RAIDERS.filter((r,i)=>i!==f)),epic:ep,city:CITY[f].name};
  a.origin=fill(o.text,v);a.originShort=fill(o.short,v);a.home=v.hamlet;
  const bias=o.loss==='elite'?{avenge:E}:o.loss==='heirloom'?{heirloom:ep}:o.loss==='raiders'?{raiders:true}:null;
  a.goal=rollGoal(a,0,bias);bump(stats().rolled,a.goal.type);
  // Recruits (not the opening roster) announce their oath about a third of the time.
  if(S.chronicle.length&&rnd()<.3)log(a,', ',a.originShort,', swears to ',lc(a.goal.text),'.')}

// ---- goal makers (each returns null when the world holds no sensible target) ----
const mk=(type,tier,v={})=>({type,tier,text:fill(GOAL_TEXT[type],v),target:v.target,targetId:v.targetId,targetFac:v.targetFac,victim:v.victim,
  need:v.need!==undefined?v.need:1,progress:0,done:false});
const ELITE_LV=[[0,12],[10,18],[15,99]],BAND=[[0,6],[6,11],[11,99]],HOARD=[[40,90],[150,300],[300,500]];
const zonesFor=tier=>ZONES.map((z,i)=>i).filter(z=>bandMin(z)>=BAND[tier][0]&&bandMin(z)<=BAND[tier][1]&&EPICS[z]&&EPICS[z].length);
const M={
  ascend:(a,t)=>{if(a.lvl>=20)return null;const need=Math.min(20,Math.max(a.lvl+ri(3,4),t===0?a.lvl+ri(4,7):t===1?ri(10,14):ri(16,20)));return mk('ascend',t,{need})},
  hoard:(a,t)=>mk('hoard',t,{need:Math.max(ri(...HOARD[t]),a.gold+30)}),
  pilgrimCrypt:(a,t)=>CRYPT_Z>=0?Object.assign(mk('pilgrimCrypt',t),{zone:CRYPT_Z,minLvl:Math.max(1,bandMin(CRYPT_Z)-3)}):null,
  pilgrimFar:(a,t)=>FAR>=0?Object.assign(mk('pilgrimFar',t,{zone:PILGRIM_ZONE}),{zone:FAR,minLvl:Math.max(1,bandMin(FAR)-3)}):null,
  avenge:(a,t,E)=>{if(!E){const pool=ELITES.filter(e=>e.lvl>=ELITE_LV[t][0]&&e.lvl<=ELITE_LV[t][1]);if(!pool.length)return null;E=pickA(pool)}
    const g=mk('avenge',t,{target:E.name+', '+E.title});g.target=E.name;return g},
  heirloom:(a,t,name)=>{if(name){if(DG_EPICS.includes(name))return mk('heirloomCrypt',t,{target:name});if(BOSS_EPICS.includes(name))return mk('heirloomBoss',t,{target:name});return mk('heirloom',t,{target:name})}
    const zs=zonesFor(t);if(!zs.length)return null;return mk('heirloom',t,{target:pickA(EPICS[pickA(zs)])})},
  heirloomCrypt:(a,t)=>mk('heirloomCrypt',t,{target:pickA(DG_EPICS)}),
  heirloomBoss:(a,t)=>mk('heirloomBoss',t,{target:pickA(BOSS_EPICS)}),
  delve:(a,t)=>mk('delve',t),
  legend:(a,t)=>a.lvl>=8||t>=2?mk('legend',t):null, // a mid-tier oath only for heroes already past Mirefen
  rival:(a,t)=>{const pool=S.agents.filter(x=>x.fac!==a.fac&&alive(x)&&x.lvl>a.lvl&&x.lvl<=a.lvl+6);if(!pool.length)return null;const r=pickA(pool);
    return mk('rival',t,{target:r.name,targetId:r.id,targetFac:r.fac,fac:FAC[r.fac].name,need:r.lvl+1})},
  // A guildmate's killer who still lives; the hero takes them as a nemesis so pvp.js hunts them on sight.
  avengeHero:(a,t)=>{const seen={};for(const x of S.agents){if(x.guild!==a.guild||!alive(x))continue;for(const id in x.nemesis){const k=byId(id);if(alive(k)&&k.fac!==a.fac)seen[id]=x.nemesis[id]}}
    const ids=Object.keys(seen).sort((p,q)=>byId(p).lvl-byId(q).lvl);if(!ids.length)return null;const id=ids[ri(0,Math.min(1,ids.length-1))],k=byId(id);a.nemesis[k.id]=seen[id]; // the two lowest-level killers: a recruit can catch those
    return mk('avengeHero',t,{target:k.name,targetId:k.id,targetFac:k.fac,victim:seen[id]})},
};
const TIERS=[
  ['ascend','hoard','pilgrimCrypt','avenge','heirloom','rival','avengeHero'],
  ['ascend','hoard','pilgrimFar','avenge','heirloom','heirloomCrypt','delve','rival','avengeHero','legend'],
  ['ascend','hoard','legend','heirloomBoss','avenge','heirloom','delve','rival','avengeHero'],
];

function rollGoal(a,tier,bias){
  if(bias){const g=bias.avenge?M.avenge(a,tier,bias.avenge):bias.heirloom?M.heirloom(a,tier,bias.heirloom):M.avengeHero(a,tier)||M.rival(a,tier);if(g)return g}
  const opts=TIERS[tier].map(k=>M[k](a,tier)).filter(Boolean);
  return pickA(opts)||M.hoard(a,tier)}

function next(a,tier){const g=rollGoal(a,tier,null);bump(stats().rolled,g.type);a.goal=g;return g}

function complete(a){const g=a.goal;g.done=true;bump(stats().done,g.type);
  const n=next(a,Math.min(TIERS.length-1,g.tier+1));
  log(a,fill(GOAL_DONE[g.type],g),' A new oath: ',lc(n.text),'.')}

// The target died before the oath could be kept: re-roll at the same tier.
function voided(a){const g=a.goal;stats().moot++;const n=next(a,g.tier);
  if(rnd()<.5)log(a,' outlived ',{t:g.target,c:'f'+g.targetFac},' with the oath unkept. A new oath: ',lc(n.text),'.')}

function checkRival(a){const g=a.goal,t=byId(g.targetId);if(!alive(t)){voided(a);return}
  g.need=t.lvl+1;g.progress=a.lvl;if(a.lvl>t.lvl)complete(a)}

// ---- hooks called from heroes.js, dungeon.js and boss.js ----
export function goalEvent(a,kind,x){
  // An enemy hero x fell to a: every oath-bearer of a's side in the fight (within 8 tiles) shares the vengeance.
  if(kind==='slay'){for(const h of S.agents){const g=h.goal;if(!g||g.done||g.type!=='avengeHero'||g.targetId!==x.id||!alive(h))continue;if(h===a||(h.fac!==x.fac&&dist(h,x)<=8))complete(h)}return}
  const g=a&&a.goal;if(!g||g.done)return;
  switch(kind){
  case 'kill':if(g.type==='avenge'&&x.elite&&x.name===g.target)complete(a);break;
  case 'epic':if(g.type.indexOf('heirloom')===0&&x===g.target)complete(a);break;
  case 'level':if(g.type==='ascend'){g.progress=a.lvl;if(a.lvl>=g.need)complete(a)}else if(g.type==='rival')checkRival(a);break;
  case 'crypt':if(g.type==='delve')complete(a);break;
  case 'boss':if(g.type==='legend')complete(a);break;
  case 'died':if(rnd()<.5)log(a,' died with the oath unkept: ',{t:g.text,c:'dm'},'.');break;
  }}

// Sort keys for the crypt pool (dungeon.js) and raid muster (boss.js): oath-bound heroes first.
export const cryptPull=a=>a.goal&&!a.goal.done&&(a.goal.type==='heirloomCrypt'||a.goal.type==='delve'||a.goal.type==='pilgrimCrypt')?1:0;
export const raidPull=a=>a.goal&&!a.goal.done&&(a.goal.type==='legend'||a.goal.type==='heirloomBoss')?1:0;

// Pilgrims: once within 3 levels of the goal zone's band, a solo hero leaving town (or hunting)
// heads for the goal point instead of a random hunting spot. a.zone is left alone, so a low
// hero crossing a higher zone neither stops to hunt there nor picks its monsters. On arrival
// the oath is kept and, if the zone is above their band, they turn for home.
function goalPoint(a,g){if(g.type==='pilgrimCrypt')return{x:CRYPT.x,y:CRYPT.y+1};
  const gate=CITY[a.fac].gate;let best=null,bd=1e9;for(const p of ZPTS[g.zone]){const d=dist(p,gate);if(d<bd){bd=d;best=p}}return best}
function pilgrimStep(a,g){
  const arrived=g.type==='pilgrimCrypt'?dist(a,CRYPT)<2.6:zoneAt(a.x,a.y)===g.zone;
  if(arrived&&a.state!=='ghost'){complete(a);if(zoneFor(a.lvl)!==g.zone&&(a.state==='hunt'||a.state==='travel'))goHome(a);return}
  if(a.lvl<g.minLvl||a.party||(a.state!=='travel'&&a.state!=='hunt'))return;
  if(!a.dest||!a.dest.pil){const p=goalPoint(a,g);if(!p)return;stats().pilgrimSteers++;a.dest={x:p.x,y:p.y,pil:true}}}

// Periodic checks (twice a real second): hoards, rivals, void targets, pilgrim steering.
export function goalsTick(dt){S.goalT=(S.goalT===undefined?0:S.goalT)-dt;if(S.goalT>0)return;S.goalT=.5;
  for(const a of S.agents){const g=a.goal;if(!g||g.done||a.state==='dead')continue;
    switch(g.type){
    case 'hoard':g.progress=a.gold;if(a.gold>=g.need)complete(a);break;
    case 'rival':checkRival(a);break;
    case 'avengeHero':if(!alive(byId(g.targetId)))voided(a);break;
    case 'ascend':g.progress=a.lvl;if(a.lvl>=g.need)complete(a);break;
    case 'pilgrimFar':case 'pilgrimCrypt':pilgrimStep(a,g);break;
    }}}
