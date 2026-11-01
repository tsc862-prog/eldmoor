// The Sunken Crypt: group formation, the gather-and-run phases and the
// success roll. Tuning: entry level 7, groups of 4-5, success chance
// clamp((pw-8)/8, .15, .92) where pw = avg(level + gear*.3) + Priest 2.5 + Warrior 1.5 + n*.6.
import {rnd,ri,clamp,pickA} from '../core/rng.js';
import {CRYPT,dist} from '../world/map.js';
import {FAC} from '../data/factions.js';
import {DG_EPICS} from '../data/items.js';
import {S} from './state.js';
import {log} from './chronicle.js';
import {gainXp,getEpic,goHome,fall} from './heroes.js';
import {cryptPull,goalEvent} from './goals.js';
import {record} from './history.js';
import {brainOk} from './brain.js';

export function dungeonCheck(dt){const agents=S.agents;
  const g=CRYPT.group,tagOf=(gu,f)=>gu?{t:'<'+gu.tag+'> '+gu.name,c:'f'+f}:{t:'A '+FAC[f].name+' group',c:'f'+f};
  if(!g){CRYPT.cd-=dt;if(CRYPT.cd>0)return;CRYPT.cd=20+rnd()*25;
    const f=ri(0,1);const pool=agents.filter(a=>a.fac===f&&a.lvl>=7&&!a.raid&&['hunt','travel','town','return'].includes(a.state)&&brainOk(a,'crypt'));
    const gu=pickA(S.GUILDS.filter(x=>x.fac===f));
    let mem=pool.filter(a=>a.guild===gu).sort((x,y)=>(cryptPull(y)-cryptPull(x))||(y.lvl-x.lvl)).slice(0,5); // oath-bound (crypt heirloom, delve) first
    if(mem.length<5)mem=mem.concat(pool.filter(a=>!mem.includes(a)).sort((x,y)=>cryptPull(y)-cryptPull(x)).slice(0,5-mem.length));
    if(mem.length<4)return;
    mem.forEach((a,i)=>{a.state='dungeon';a.dgIdx=i;a.target=null;a.dest=null});
    const main=mem.filter(a=>a.guild===gu).length>=3?gu:null;
    CRYPT.group={fac:f,mem,guild:main,phase:'gather',t:30};
    for(const a of mem)record(a,'Joined a group for ',{t:CRYPT.name,c:'gd'},'.');
    log(tagOf(main,f),' formed a group for ',{t:CRYPT.name,c:'gd'},'.');return}
  g.mem=g.mem.filter(a=>a.state==='dungeon');
  if(!g.mem.length){CRYPT.group=null;return}
  g.t-=dt;
  if(g.phase==='gather'){const here=g.mem.filter(a=>dist(a,CRYPT)<2.4);
    if(here.length===g.mem.length||(g.t<=0&&here.length>=3)){g.mem.filter(a=>!here.includes(a)).forEach(a=>{a.state='hunt'});g.mem=here;
      here.forEach(a=>{a.hidden=true;a.x=CRYPT.x;a.y=CRYPT.y;a.moving=false});g.phase='inside';g.t=30+rnd()*20}
    else if(g.t<=0){g.mem.forEach(a=>a.state='hunt');CRYPT.group=null}return}
  if(g.t>0)return;
  const n=g.mem.length,avg=g.mem.reduce((t,a)=>t+a.lvl+a.gear*.3,0)/n;
  const pw=avg+(g.mem.some(a=>a.cls==='Priest')?2.5:0)+(g.mem.some(a=>a.cls==='Warrior')?1.5:0)+n*.6;
  const ok=rnd()<clamp((pw-8)/8,.15,.92),who=tagOf(g.guild,g.fac);
  for(const a of g.mem){a.hidden=false;a.x=CRYPT.x+(rnd()-.5)*1.5;a.y=CRYPT.y+.5+rnd()*.6}
  if(ok){if(g.guild)g.guild.clears++;log(who,' cleared ',{t:CRYPT.name,c:'gd'},' and destroyed ',{t:CRYPT.boss,c:'gd'},'!');
    for(const a of g.mem)record(a,'Cleared ',{t:CRYPT.name,c:'gd'},' and destroyed ',{t:CRYPT.boss,c:'gd'},'.');
    for(const a of g.mem){gainXp(a,250+a.lvl*20);a.gold+=25+ri(0,20);a.kills+=ri(8,14);for(let k=0;k<3;k++)a.bag.push('Grave Dust');
      if(rnd()<.25)getEpic(a,pickA(DG_EPICS),CRYPT.boss);goalEvent(a,'crypt');goHome(a)}}
  else{if(g.guild)g.guild.wipes++;const lost=[];
    for(const a of g.mem)record(a,'The group wiped in ',{t:CRYPT.name,c:'gd'},'.');
    for(const a of g.mem){if(rnd()<.6){lost.push(a);fall(a,'lost in '+CRYPT.name)}else goHome(a)}
    for(const a of lost)record(a,'Lost forever in ',{t:CRYPT.name,c:'gd'},'.');
    const parts=[who,' wiped in ',{t:CRYPT.name,c:'gd'},'.'];
    if(lost.length){parts.push(' Lost forever: ');lost.forEach((a,i)=>{parts.push(a);if(i<lost.length-1)parts.push(', ')});parts.push('.')}
    else parts.push(' Everyone escaped.');log(...parts)}
  CRYPT.group=null}
