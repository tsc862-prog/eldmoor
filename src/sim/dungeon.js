// The spec dungeons (one or more, sim/crypts.js, #891): group formation, the gather-and-run phases and the
// success roll. Tuning: entry level 7 (a landmark's `entry` says otherwise), groups of 4-5, success chance
// clamp((pw-need)/8, .15, .92) where pw = avg(level + gear*.3) + Priest 2.5 + Warrior 1.5 + n*.6 and need is 8 at entry 7.
import {wounded} from './wounds.js'; // a wounded background hero stays out of the Crypt (#656)
import {rnd,ri,clamp,pickA} from '../core/rng.js';
import {CRYPT,CRYPTS,dist} from '../world/map.js';
import {CRYPT_LVL,entryOf,needOf,cryptFor,cryptOfGroup,cryptRun} from './crypts.js';
import {standAt} from '../world/passable.js';
import {CLS} from '../data/classes.js';
import {FAC} from '../data/factions.js';
import {DG_EPICS} from '../data/items.js';
import {addGood,addUse,cryptDraughts} from './inv.js';
import {S} from './state.js';
import {log} from './chronicle.js';
import {gainXp,getEpic,goHome,fall} from './heroes.js';
import {cryptPull,goalEvent} from './goals.js';
import {record,timeline,first} from './history.js';
import {livingGuilds} from './guilds.js';
import {brainOk} from './brain.js';
import {unitDraft,cryptHold,cryptReserved,inMuster,leaderFor} from './council.js';
import {companyOf} from './company.js';
import {notify} from './notify.js';
import {rivalDeed} from './rivals.js';
import {cryptWeight,focusCount} from './guildfocus.js';

// The dungeon crawl (sim/crawl.js, #65) registers itself here; without it (or without a Fellowship in the group) the single roll below runs.
export {CRYPT_LVL};
let CRAWL=null;export const setCrawlHook=h=>{CRAWL=h};
export const firstKey=(D,who)=>'crypt:'+who+(D===CRYPT?'':':'+D.name); // a first clear is counted per dungeon
const tagOf=(gu,f,name)=>gu?{t:'<'+gu.tag+'> '+gu.name,c:'f'+f}:name?{t:name,c:'f'+f}:{t:'A '+FAC[f].name+' group',c:'f'+f};
// A group sets out for the Crypt (also called by sim/council.js when the Fellowship votes to go).
export function musterCrypt(mem,f,main,name,D=CRYPT){
  mem.forEach((a,i)=>{a.state='dungeon';a.dgIdx=i;a.target=null;a.dest=null});
  D.group={fac:f,mem,guild:main,phase:'gather',t:30};if(name)D.group.name=name;
  for(const a of mem)record(a,'Joined a group for ',{t:D.name,c:'gd'},'.');
  log(tagOf(main,f,name),' formed a group for ',{t:D.name,c:'gd'},'.')}
// A background group still gathering gives way to the Fellowship (#135): back to hunting. A group already
// inside is left alone (the Fellowship goes next, see council.js cryptHold). True when one stepped aside.
export function yieldCrypt(F,D=CRYPT){const g=D.group;if(!g||g.phase!=='gather'||g.mem.some(a=>companyOf(a)))return false;
  for(const a of g.mem){a.state='hunt';a.dest=null;a.target=null;record(a,'Stepped aside at ',{t:D.name,c:'gd'},' for the Fellowship.');notify(a,'Your group steps aside at '+D.name+' to let the Fellowship go first; you go back to hunting.',true)}
  log(tagOf(g.guild,g.fac,g.name),' step aside at the mouth of ',{t:D.name,c:'gd'},' to let ',{t:F.name,c:'gd'},' go first.');
  D.group=null;return true}
// What a cleared Crypt pays each member (the abstract roll and the Fellowship's crawl alike).
export const clearXp=a=>250+a.lvl*20;
export function payClear(g,perRoom){const D=cryptOfGroup(g);
  for(const a of g.mem)record(a,'Cleared ',{t:D.name,c:'gd'},' and destroyed ',{t:D.boss,c:'gd'},'.');
  for(const a of g.mem){gainXp(a,perRoom?Math.round(clearXp(a)*perRoom):clearXp(a));a.gold+=25+ri(0,20);a.kills+=ri(8,14);addGood(a,'Grave Dust',3);addUse(a,'Marrowmend Tonic',1);
    if(rnd()<.25)getEpic(a,pickA(DG_EPICS),D.boss);goalEvent(a,'crypt',D.name);goHome(a)}}
// One die, like pickA: with every weight 1 it returns exactly pickA's choice.
function pickW(list,w){let tot=0;for(const x of list)tot+=w(x);let r=rnd()*tot;for(const x of list){r-=w(x);if(r<0)return x}return list[list.length-1]}
// Each dungeon keeps its own group and cooldown (#891). A hero answers only the dungeon that fits it (crypts.js cryptFor), one sworn to
// clear a dungeon that dungeon; a company answers as its leader, so it is never split between two calls. No dice; with one dungeon, always yes.
const calledTo=(a,D)=>{if(CRYPTS.length<2)return true;const g=a.goal;if(g&&g.type==='delve'&&!g.done)return (g.dun||CRYPT.name)===D.name;return cryptFor(leaderFor(a)||a)===D};
export function dungeonCheck(dt){for(const D of CRYPTS)checkCrypt(D,dt)}
function checkCrypt(D,dt){const agents=S.agents;
  const g=D.group;
  if(!g){if(cryptHold(D))return; // a company's own vote holds the dungeon (reserved, or waiting with the cooldown waived)
    D.cd-=dt;if(D.cd>0)return;D.cd=20+rnd()*25;
    const f=ri(0,1);const pool=agents.filter(a=>a.fac===f&&(a.lvl>=entryOf(D)||companyOf(a))&&!a.raid&&(a.player||!wounded(a))&&['hunt','travel','town','return'].includes(a.state)&&calledTo(a,D)&&inMuster(a,'crypt')&&brainOk(a,'crypt'));
    const cands=livingGuilds().filter(x=>x.fac===f&&pool.filter(a=>a.guild===x).length>=3),gu=cands.length?pickW(cands,cryptWeight):null; // none: the unguilded mixed pool below; a Delve guild (sim/guildfocus.js) weighs more
    let mem=pool.filter(a=>gu&&a.guild===gu).sort((x,y)=>(cryptPull(y)-cryptPull(x))||(y.lvl-x.lvl)).slice(0,5); // oath-bound (crypt heirloom, delve) first
    if(mem.length<5)mem=mem.concat(pool.filter(a=>!mem.includes(a)).sort((x,y)=>cryptPull(y)-cryptPull(x)).slice(0,5-mem.length));
    mem=unitDraft(mem,pool,5,'crypt',D); // the Fellowship (#68) goes all together or not at all; unchanged without one
    const co=mem.map(companyOf).find(Boolean),need=co?Math.min(4,co.ids.length):4; // a drafted company of 2 or 3 may go with fill-ins; a Fellowship (5) needs 4 as before
    if(D.group||cryptReserved(D)||mem.length<need)return; // the Fellowship may have just taken or reserved the dungeon
    if(gu&&cryptWeight(gu)>1&&mem.filter(a=>a.guild===gu).length>=3)focusCount('crypt');
    musterCrypt(mem,f,gu&&mem.filter(a=>a.guild===gu).length>=3?gu:null,co?co.name:null,D);return}
  g.mem=g.mem.filter(a=>a.state==='dungeon'||(a.down&&a.down.crawl&&a.state==='downed')); // the downed below ground stay with the crawl (#654)
  if(!g.mem.length){if(g.crawl&&CRAWL)CRAWL.lost(g);D.group=null;return} // a crawl whose last hero fell at the table
  g.t-=dt;
  if(g.phase==='gather'){const here=g.mem.filter(a=>dist(a,D)<2.4);
    if(here.length===g.mem.length||(g.t<=0&&here.length>=3)){g.mem.filter(a=>!here.includes(a)).forEach(a=>{a.state='hunt'});g.mem=here;
      here.forEach(a=>{a.hidden=true;a.x=D.x;a.y=D.y;a.moving=false});g.phase='inside';g.t=30+rnd()*20;if(CRAWL&&g.mem.some(a=>companyOf(a)))CRAWL.start(g)}
    else if(g.t<=0){g.mem.forEach(a=>a.state='hunt');D.group=null}return}
  if(g.crawl&&CRAWL){CRAWL.tick(g,dt);return} // the Fellowship goes room by room at the Table (sim/crawl.js)
  if(g.t>0)return;
  const n=g.mem.length,avg=g.mem.reduce((t,a)=>t+a.lvl+a.gear*.3,0)/n;
  const pw=avg+(g.mem.some(a=>CLS[a.cls]&&CLS[a.cls].heal)?2.5:0)+(g.mem.some(a=>a.cls==='Warrior')?1.5:0)+n*.6+(g.bonus||0)+Math.min(1.5,cryptDraughts(g.mem)/n*.6); // g.bonus: the Fellowship's choices at the table (sim/table.js); the draughts the party drinks below (sim/inv.js)
  const ok=rnd()<clamp((pw-needOf(D))/8,.15,.92),who=tagOf(g.guild,g.fac,g.name);
  for(const a of g.mem){a.hidden=false;Object.assign(a,standAt(D.x+(rnd()-.5)*1.5,D.y+.5+rnd()*.6))}
  if(ok){if(g.guild){g.guild.clears++;rivalDeed('crypt',g.guild)} // a clear close behind an enemy guild's stokes a rivalry (sim/rivals.js)
    log(who,' cleared ',{t:D.name,c:'gd'},' and destroyed ',{t:D.boss,c:'gd'},'!');
    if(first(firstKey(D,g.guild?g.guild.tag:'f'+g.fac)))timeline('crypt',who,' cleared ',{t:D.name,c:'gd'},' for the first time.');
    payClear(g);cryptRun(D,'clears')}
  else{if(g.guild)g.guild.wipes++;const lost=[];
    for(const a of g.mem)record(a,'The group wiped in ',{t:D.name,c:'gd'},'.');
    for(const a of g.mem){if(rnd()<.40){lost.push(a);fall(a,'lost in '+D.name)}else goHome(a)}
    for(const a of lost)record(a,'Lost forever in ',{t:D.name,c:'gd'},'.');cryptRun(D,'wipes',lost.length);
    const parts=[who,' wiped in ',{t:D.name,c:'gd'},'.'];
    if(lost.length){parts.push(' Lost forever: ');lost.forEach((a,i)=>{parts.push(a);if(i<lost.length-1)parts.push(', ')});parts.push('.')}
    else parts.push(' Everyone escaped.');log(...parts);if(lost.length)timeline('death',...parts)}
  D.group=null}
