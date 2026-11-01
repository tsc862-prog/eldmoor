// The Chronicler: a Dungeon Master voice in the Chronicle (issue #26). Scene lines when a
// hero or party enters its hunting zone after dark or under weather, visible d20 checks
// whose results change the fight (scout and flee), the first sighting of a named elite,
// the moment a raid pulls Kragmaw, and a recap at every dawn. Owned by ai-designer;
// line templates live in data/narration.js (lore-keeper owns the voice).
//
// A narrator entry is a chronicle line whose first part is the empty marker {t:'',c:'nar'};
// the UI styles those entries. Scene lines keep to one per CAP real seconds; dice results
// of consequence (a failed roll that lands a hit, a roll that kills) and dawn recaps ignore
// the cap. Dice use the game RNG (ri) so a roll is a real roll, not decoration.
// Hooks called from other modules (each a single inserted line there):
//   scoutCheck(a,m)  heroes.js fight case   fleeCheck(a,m)  heroes.js FLEE pop
//   eliteSight(m,dt) mobs.js updMob         bossPull(eng)   boss.js updBoss
// Zone-entry scenes and the dawn recap need no hook: narratorTick scans S each step.
import {rnd,ri,pickA} from '../core/rng.js';
import {ZONES,zoneAt,dist} from '../world/map.js';
import {MOBS} from '../data/mobs.js';
import {CLS} from '../data/classes.js';
import * as N from '../data/narration.js';
import {S} from './state.js';
import {log,fac} from './chronicle.js';
import {pop} from './effects.js';
import {agentDie,strike,maxHp} from './heroes.js';
import {weatherKind,sightMul} from './weather.js';
import {record} from './history.js';

// ---- knobs ----
const CAP=20;            // real seconds between scene lines
const SHOW_SCOUT=.15;    // share of scout rolls that are narrated (about 13 rolls a minute happen)
const SHOW_FLEE=.4;      // share of flee rolls that are narrated (a fatal one always is)
const SCOUT_RECHECK=30;  // real seconds before the same hero re-rolls against the same mob
const FLEE_DC=11;
const FLEE_GLANCE=.35;   // a failed flee roll takes this share of a mob hit (a full one killed ~10 heroes an hour)
const SCENE_P=.4;        // share of eligible zone entries that get a scene line
const NIGHT_FROM=19,NIGHT_TO=5; // game hours
const ELITE_SIGHT=6;     // tiles

const NAR={t:'',c:'nar'},dm=t=>({t,c:'dm'}),gd=t=>({t,c:'gd'});
const d20=()=>ri(1,20);
const hour=()=>(S.gameMin/60)%24;
const isNight=()=>{const h=hour();return h>=NIGHT_FROM||h<NIGHT_TO};
const dawnIdx=()=>Math.floor((S.gameMin-360)/1440); // increments at every 06:00
const WORDS=['no','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve'];
const num=n=>n<WORDS.length?WORDS[n]:String(n);
const Num=n=>{const w=num(n);return w[0].toUpperCase()+w.slice(1)};
const rollStr=(r,mod,dc)=>'rolls '+r+(mod?'+'+mod:'')+(dc?' vs '+dc:'');
const afield=a=>a.state!=='dead'&&a.state!=='town'&&a.state!=='ghost'&&!a.hidden;

// Lazily created so state.js stays untouched. S.nar holds the working counters, S.narStats
// the totals the headless harness can print.
function ensure(){if(S.nar)return;
  S.nar={t:0,last:-CAP,dawn:dawnIdx(),pulled:false,lastFallen:null,deaths:[],elites:[],raidOn:[false,false],raids:0,
    clears:0,wipes:0,bosses:[0,0]};
  S.narStats={lines:0,scenes:0,scouts:[0,0],flees:[0,0],fleeDeaths:0,elites:0,pulls:0,recaps:0}}

// Fill a template: "{who} enters {zone}" with vars whose values are strings, parts or arrays
// of parts (a hero object passes straight through as a clickable name).
function fill(tpl,v){const out=[];for(const seg of tpl.split(/(\{\w+\})/)){if(!seg)continue;const k=/^\{(\w+)\}$/.exec(seg);
  if(!k){out.push(seg);continue}const x=v[k[1]];if(Array.isArray(x))out.push(...x);else if(x!=null)out.push(typeof x==='number'?String(x):x)}return out}
const cap=p=>{if(typeof p[0]==='string'&&p[0])p[0]=p[0][0].toUpperCase()+p[0].slice(1);return p};
const canSpeak=()=>S.nar.t-S.nar.last>=CAP;
function speak(...parts){log(NAR,...parts);S.nar.last=S.nar.t;S.narStats.lines++}
// Monster naming for templates: "a Fen Lurker" / "A Fen Lurker" / "the Fen Lurker"; a named elite is just its name.
const mobNames=m=>{if(m.elite){const n=gd(m.name);return{mob:n,Mob:n,the:n,The:n}}const n=MOBS[m.type].name;return{mob:'a '+n,Mob:'A '+n,the:'the '+n,The:'The '+n}};

// ---- scene: zone entry after dark or under weather ----
function sceneEnter(a){const z=zoneAt(a.x,a.y),wk=weatherKind(z),night=isNight(),wx=N.WX[wk];
  if(!night&&!wx)return;if(!canSpeak()||rnd()>SCENE_P)return;
  const who=a.party&&a.party.leader===a&&a.party.mem.length>1?[a,'’s party']:[a];
  const tpl=pickA(night?(wx?N.WEATHER_NIGHT:N.NIGHT):N.WEATHER_DAY);
  speak(...cap(fill(tpl,{who,zone:ZONES[z],wx})));S.narStats.scenes++}

// ---- dice: scout check at fight entry ----
// Fires once per engagement when a mob ambushed the hero (it already had them as target) or
// the hero took on something two or more levels up. d20 + lvl/3 (+2 Hunter/Rogue) vs
// 10 + 2 per zone (+3 when the weather cuts sight). Pass: the hero lands a strike before the
// fight proper (if in reach; otherwise simply swings first) and the mob's first bite is delayed.
// Fail: one free hit lands (never fatal: the fight itself decides that). The strike resets a.cd so
// the fight case cannot swing again this tick, and a kill here leaves the case's own
// strike/flee checks inert (state is already 'hunt').
export function scoutCheck(a,m){ensure();
  if(a.scoutTgt===m&&S.nar.t-a.scoutT<SCOUT_RECHECK)return;a.scoutTgt=m;a.scoutT=S.nar.t;
  const ambush=m.target===a;if(!ambush&&m.lvl<a.lvl+2)return;
  const z=MOBS[m.type].z,mod=Math.floor(a.lvl/3)+(a.cls==='Hunter'||a.cls==='Rogue'?2:0),dc=10+z*2+(sightMul(z)<1?3:0),r=d20(),ok=r+mod>=dc;
  let dmg=0;if(ok){m.cd=1.3;if(dist(a,m)<=CLS[a.cls].range+.5){strike(a,m);a.cd=1.1}else a.cd=0}else{dmg=3+m.lvl*2;a.hp=Math.max(1,a.hp-dmg);pop(a.x,a.y-.6,String(dmg),'#ff6a5a')}
  a.scoutOk=ok;S.narStats.scouts[ok?0:1]++;const nm=mobNames(m),plain=m.elite?m.name:MOBS[m.type].name;
  record(a,(ok?'Spotted ':'Was surprised by ')+(m.elite?'':'a ')+plain+' ('+rollStr(r,mod,dc)+').');
  if(rnd()<SHOW_SCOUT&&(canSpeak()||(!ok&&a.hp<maxHp(a)*.5))) // only a hit that leaves the hero under half health jumps the cap
    speak(...fill(pickA(N.SCOUT_LEAD),{hero:a}),' ',dm(rollStr(r,mod,dc)),'. ',...fill(pickA(ok?N.SCOUT_PASS:N.SCOUT_FAIL),{hero:a,dmg,...nm}))}

// ---- dice: flee roll at the FLEE pop ----
// d20 + lvl/4 vs 11. Fail: the mob lands a glancing hit (FLEE_GLANCE of a bite) as the hero turns;
// at flee health that can still kill, and a death here is always narrated.
export function fleeCheck(a,m){ensure();if(a.state!=='return'||!m||!m.alive)return;
  const mod=Math.floor(a.lvl/4),r=d20(),ok=r+mod>=FLEE_DC;let dmg=0;
  if(!ok){dmg=Math.max(1,Math.round((3+m.lvl*2)*m.hit*(.8+rnd()*.4)*(CLS[a.cls].arm||1)*FLEE_GLANCE));a.hp-=dmg;pop(a.x,a.y-.6,String(dmg),'#ff6a5a')}
  const dead=a.hp<=0;S.narStats.flees[ok?0:1]++;if(dead)S.narStats.fleeDeaths++;
  const nm=mobNames(m),plain=m.elite?m.name:'a '+MOBS[m.type].name;
  record(a,(ok?'Got clear of ':'Was caught fleeing ')+plain+' ('+rollStr(r,mod,FLEE_DC)+').');
  if(dead||(rnd()<SHOW_FLEE&&(!ok||canSpeak())))
    speak(...fill(pickA(N.FLEE_LEAD),{hero:a,...nm}),' ',dm(rollStr(r,mod,FLEE_DC)),', ',...fill(pickA(dead?N.FLEE_DEATH:ok?N.FLEE_PASS:N.FLEE_FAIL),{hero:a,dmg,...nm}));
  if(dead){if(m.elite)S.eco.stats.eliteDeaths++;agentDie(a,m)}}

// ---- scene: first sighting of a named elite ----
export function eliteSight(m,dt){if(!m.elite||m.seen||!m.alive)return;ensure();
  m.seenScan=(m.seenScan||0)-dt;if(m.seenScan>0)return;m.seenScan=.5;
  if(!canSpeak())return;let who=null;for(const a of S.agents){if(afield(a)&&dist(a,m)<ELITE_SIGHT){who=a;break}}
  if(!who)return;m.seen=true;S.narStats.elites++;const zone=ZONES[MOBS[m.type].z];
  speak(...fill(pickA(N.ELITE_OPEN[zone]||N.GENERIC_ELITE),{zone}),' ',...fill(pickA(N.ELITE_TAIL),{elite:gd(m.name),title:m.title,zone,hero:who}))}

// ---- scene: a raid pulls the boss ----
export function bossPull(eng){ensure();if(S.nar.pulled||!eng.length||!canSpeak())return;S.nar.pulled=true;S.narStats.pulls++;
  const f=eng[0].fac;let n=0;for(const a of S.agents)if(a.raid&&a.fac===f&&a.state==='raid')n++;
  speak(...fill(pickA(N.BOSS_PULL),{boss:gd(S.boss.name),n:num(Math.max(n,eng.length)),fac:fac(f)}))}

// ---- dawn recap ----
const isMob=c=>c.startsWith('slain by a '),isCrypt=c=>c.startsWith('lost in'),isBoss=c=>c.startsWith('incinerated');
function causeOf(f){const c=f.cause;if(isMob(c))return c.slice(9);if(isCrypt(c))return gd(c.slice(8));if(isBoss(c))return gd('Kragmaw');return c.replace('slain by ','')}
function dawnRecap(){const n=S.nar,day=Math.floor(S.gameMin/1440)+1,D=n.deaths,parts=fill(pickA(N.DAWN_OPEN),{day});
  // 1. the dead
  if(!D.length)parts.push(' ',pickA(N.DAWN_QUIET));
  else if(D.length<=2){parts.push(' Lost since the last dawn: ');D.forEach((f,i)=>{parts.push({t:f.name,c:'f'+f.fac},' (level '+f.lvl+') to ',causeOf(f),i<D.length-1?'; ':'.')})}
  else{const mob=D.filter(f=>isMob(f.cause)).length,crypt=D.filter(f=>isCrypt(f.cause)).length,boss=D.filter(f=>isBoss(f.cause)).length,pvp=D.length-mob-crypt-boss;
    const bits=[];if(mob)bits.push(num(mob)+' to monsters');if(pvp)bits.push(num(pvp)+' to enemy heroes');if(crypt)bits.push(num(crypt)+' lost in the Crypt');if(boss)bits.push(num(boss)+' to Kragmaw');
    parts.push(' '+Num(D.length)+' fell since the last dawn'+(bits.length>1?': '+bits.slice(0,-1).join(', ')+' and '+bits[bits.length-1]:', all '+bits[0].replace(/^\S+ /,''))+'.')}
  // 2. levels and elites
  let gained=0,top=null;for(const a of S.agents){if(a.state==='dead')continue;gained+=Math.max(0,a.lvl-(a.narLvl||1));a.narLvl=a.lvl;if(!top||a.lvl>top.lvl)top=a}
  const lv=gained?Num(gained)+' level'+(gained>1?'s':'')+' gained':'Not one level gained';
  parts.push(' '+lv);if(top){parts.push(gained?'; ':', and ',top,' stands highest at '+top.lvl)}
  if(n.elites.length){parts.push(gained||top?', and ':'; ');n.elites.forEach((e,i)=>parts.push(gd(e),i<n.elites.length-1?' and ':''));parts.push(n.elites.length>1?' are dead.':' is dead.')}else parts.push('.');
  // 3. the Crypt and the boss
  let clears=0,wipes=0;for(const g of S.GUILDS){clears+=g.clears;wipes+=g.wipes}const dc=clears-n.clears,dw=wipes-n.wipes;n.clears=clears;n.wipes=wipes;
  const crypt=dc||dw?'The Crypt was '+(dc?'cleared '+(dc===1?'once':dc===2?'twice':num(dc)+' times'):'')+(dc&&dw?' and ':'')+(dw?'wiped '+(dw===1?'once':dw===2?'twice':num(dw)+' times'):''):'';
  const kills=S.facStats.map((f,i)=>f.bosses-n.bosses[i]);n.bosses=S.facStats.map(f=>f.bosses);
  let boss;if(kills[0]||kills[1])boss=[gd('Kragmaw'),' fell to ',fac(kills[0]>=kills[1]?0:1),'.'];
  else if(n.raids)boss=[Num(n.raids)+' raid'+(n.raids>1?'s':'')+' broke on ',gd('Kragmaw'),'; it holds at '+Math.round(S.boss.hp/S.boss.maxhp*100)+'%.'];
  else boss=S.boss.alive?[gd('Kragmaw'),' sleeps untouched.']:[gd('Kragmaw'),'’s lair lies empty.'];
  parts.push(' ',...(crypt?[crypt+'; ',...boss.map((p,i)=>i===0&&typeof p==='string'?p.toLowerCase():p)]:boss));
  speak(...parts);S.narStats.recaps++;n.deaths=[];n.elites=[];n.raids=0}

// Once per step after the sim tick: the real-time clock for the cap, zone-entry scenes,
// bookkeeping for the recap (deaths, elite deaths, raids, boss pull reset) and the dawn check.
export function narratorTick(dt){ensure();const n=S.nar;n.t+=dt;
  for(const a of S.agents){if(a.state==='dead')continue;
    if(a.state==='town'){a.narScene=false;continue}
    if(a.state==='follow'){a.narScene=true;continue}
    if(a.state!=='hunt'||a.narScene)continue;a.narScene=true;
    if(!a.party||a.party.leader===a)sceneEnter(a)}
  for(const f of S.fallen){if(f===n.lastFallen)break;n.deaths.push(f)}n.lastFallen=S.fallen[0]||null;
  for(const m of S.mobs)if(m.elite&&!m.alive&&!m.narDead){m.narDead=true;n.elites.push(m.name)}
  for(let f=0;f<S.raidOn.length;f++){if(S.raidOn[f]&&!n.raidOn[f])n.raids++;n.raidOn[f]=S.raidOn[f]}
  if(n.pulled&&!S.agents.some(a=>a.state==='raid'))n.pulled=false;
  if(dawnIdx()>n.dawn){n.dawn=dawnIdx();dawnRecap()}}
