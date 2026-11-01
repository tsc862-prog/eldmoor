// Heroes: stats, quests, movement, combat, death and the per-hero state
// machine (town, travel, hunt, follow, fight, return, ghost, duel, assist, regroup, dungeon, raid).
// Party behaviour (forming, following, joining fights, shared XP) lives in party.js.
// Owned by ai-designer (behaviour) and character-builder (stat formulas).
import {rnd,ri,clamp,pickA} from '../core/rng.js';
import {SPEED} from '../world/tiles.js';
import {CRYPT,ZONES,zoneFor,zoneAt,tileAt,dist,zonePoint} from '../world/map.js';
import {assignRace,homeOf} from '../data/races.js';
import {FAC,genName} from '../data/factions.js';
import {CLS} from '../data/classes.js';
import {rollTraits,tm,traitPhrase} from '../data/traits.js';
import {MOBS} from '../data/mobs.js';
import {EPICS,GOODS,price} from '../data/items.js';
import {S,clockStr} from './state.js';
import {log,gold,epic} from './chronicle.js';
import {pop,bolt} from './effects.js';
import {partyMates,leaderOf,followPt,seekParty,shareKill,disband,regroup,steerClear} from './party.js';
import {say,spotMob} from './chat.js';
import {speedMul,sightMul,isStorm} from './weather.js';
import {assignBackstory,goalEvent} from './goals.js';
import {emptySlots,gearScore,gearHp,gearAtk,gearCrit,guardMul,hasteMul,rollDrop,equipEpic,sellGear,shopUpgrade} from './gear.js';
import {record} from './history.js';
import {bondEvent,inheritGrudge,avenged} from './bonds.js';
import {checkEncounter} from './encounters.js';
import {scoutCheck,fleeCheck} from './narrator.js';
import {nearHeroes,nearMobs} from './spatial.js';
import {townZone,brainFight} from './brain.js'; // brain hooks (sim/brain.js): scripted unless a.brain

// ---- stat formulas (tuning knobs) ----
export const xpNeed=l=>Math.round(60*Math.pow(l,1.45));
export const maxHp=a=>Math.round(CLS[a.cls].hp+a.lvl*14+gearHp(a)+a.epics.length*10);
export const atkOf=a=>CLS[a.cls].atk+a.lvl*2.4+gearAtk(a)+a.epics.length*3;

export function newQuest(a){const z=zoneFor(a.lvl);const opts=Object.keys(MOBS).filter(k=>MOBS[k].z===z&&MOBS[k].lv[0]<=a.lvl+2);
  const type=pickA(opts.length?opts:Object.keys(MOBS).filter(k=>MOBS[k].z===z));a.quest={type,need:ri(5,8),have:0}}

export function makeHero(f,cls,guild,wait){
  const a={id:++S.uid,kind:'hero',name:genName(f),fac:f,cls,lvl:1,xp:0,gear:0,gold:ri(2,6),
    bag:[],kills:0,deaths:0,honor:0,epics:[],skin:pickA(FAC[f].skin),x:0,y:0,state:'town',townStep:1,
    wait,face:1,cd:0,healCd:0,scan:0,quest:null,target:null,dest:null,zone:0,moving:false,guild,nemesis:{},hidden:false,spotCd:0,party:null,linger:0};
  a.traits=rollTraits(cls);newQuest(a);
  a.slots=emptySlots();
  assignRace(a,S.agents); // people, skin, hair, name and home town (data/races.js)
  assignBackstory(a);
  a.hp=maxHp(a);
  const c=homeOf(a);a.x=c.x0+2+rnd()*7;a.y=c.y0+4+rnd()*3;
  S.agents.push(a);
  // Trait reveal for recruits (not the opening roster): "Thrakash is reckless and greedy; Grimhold will remember that."
  if(S.gameMin>0&&rnd()<.3)log(a,' is ',{t:traitPhrase(a),c:'gd'},'; ',c.name,' will remember that.');
  return a}

export function moveTo(e,x,y,dt,sp){const dx=x-e.x,dy=y-e.y,d=Math.hypot(dx,dy);if(d<.12){e.moving=false;return true}
  const st=sp*SPEED[tileAt(e.x,e.y)]*speedMul(zoneAt(e.x,e.y))*dt;e.moving=true;if(Math.abs(dx)>.05)e.face=dx>0?1:-1;
  if(st>=d){e.x=x;e.y=y;e.moving=false;return true}e.x+=dx/d*st;e.y+=dy/d*st;return false}

export function gainXp(a,x){if(a.lvl>=20)return;a.xp+=Math.round(x);
  while(a.lvl<20&&a.xp>=xpNeed(a.lvl)){a.xp-=xpNeed(a.lvl);a.lvl++;a.hp=maxHp(a);pop(a.x,a.y-.5,'LEVEL UP','#f2c14e');
    if(a.lvl%5===0||a.lvl>=15)say(a,'levelup',{level:a.lvl});
    record(a,'Reached level '+a.lvl+'.');
    if(a.lvl%5===0||a.lvl>=15)log(a,' reached level ',gold(String(a.lvl)),a.lvl===20?'. The first steps of a legend.':'.');
    goalEvent(a,'level');}
  if(a.lvl>=20)a.xp=0}

export function getEpic(a,name,src){a.epics.push(name);pop(a.x,a.y,'EPIC!','#c58cff');log(a,' looted ',epic(name),' from ',src,'.');
  equipEpic(a,name,'Looted from '+src);
  record(a,'Looted ',epic(name),' from '+src+'.');
  say(a,'epic',{item:name});
  goalEvent(a,'epic',name)}

export function killMob(a,m){m.alive=false;m.respawn=22+rnd()*20;m.target=null;a.kills++;
  const diff=m.lvl-a.lvl,xp=(8+m.lvl*6)*(diff<-4?.3:diff>2?1.3:1);gainXp(a,xp);
  const M=MOBS[m.type];shareKill(a,m,xp);if(rnd()<.72)a.bag.push(M.loot);a.gold+=Math.max(1,Math.round(m.lvl*.6*rnd()));
  rollDrop(a,m);
  bondEvent(a,'kill',partyMates(a));
  if(rnd()<.006)getEpic(a,pickA(EPICS[M.z]),'a '+M.name);
  if(m.elite)record(a,'Slew ',{t:m.name,c:'gd'},', '+m.title+', in '+ZONES[M.z]+'.');
  if(m.elite){a.eliteKills=(a.eliteKills||0)+1;log(a,' slew ',{t:m.name,c:'gd'},', ',m.title,', in ',ZONES[M.z],'!');getEpic(a,pickA(EPICS[M.z]),m.name)} // named elite: guaranteed epic from the zone table
  if(a.quest&&a.quest.type===m.type&&a.quest.have<a.quest.need)a.quest.have++;
  goalEvent(a,'kill',m);
  a.target=null;a.state='hunt'}

// Permanent death: graveyard entry, a recruit is scheduled, old graves recycled.
export function fall(a,cause){
  a.deaths++;a.state='dead';a.cause=cause;a.diedAt=clockStr();a.hp=0;a.target=null;a.raid=false;a.moving=false;a.hidden=false;a.dest=null;
  if(a.party)disband(a.party);
  for(const m of S.mobs)if(m.target===a)m.target=null;
  S.facStats[a.fac].fallen++;
  S.fallen.unshift({name:a.name,fac:a.fac,lvl:a.lvl,cls:a.cls,cause,t:a.diedAt});if(S.fallen.length>15)S.fallen.pop();
  goalEvent(a,'died');
  S.recruits.push({fac:a.fac,guild:a.guild,cls:a.cls,t:8+rnd()*8});
  const graves=S.agents.filter(x=>x.state==='dead');
  if(graves.length>40){const old=graves.find(x=>x!==S.pinned);if(old)S.agents.splice(S.agents.indexOf(old),1)}}

export function agentDie(a,killer){
  const lv={t:'(level '+a.lvl+')',c:'dm'};
  record(a,'Fell at level '+a.lvl+', slain by ',killer.kind==='hero'?killer:killer.kind==='boss'?{t:'Kragmaw',c:'gd'}:'a '+MOBS[killer.type].name,'.');
  bondEvent(a,'died',[killer]);
  for(const x of nearHeroes(a.x,a.y,10))if(x!==a&&x.state!=='dead'&&(x.guild===a.guild||(a.party&&x.party===a.party))&&dist(x,a)<=10)say(x,'mourn',{target:a.name});
  if(killer.kind==='hero'){killer.honor++;S.facStats[killer.fac].honor++;const g=Math.floor(a.gold*.1);a.gold-=g;killer.gold+=g;
    killer.state=killer.raid?'raid':'hunt';killer.target=null;gainXp(killer,40+a.lvl*8);
    say(killer,'kill',{target:a.name});
    record(killer,killer.nemesis[a.id]?'Avenged '+killer.nemesis[a.id]+' by slaying ':'Killed ',a,' (level '+a.lvl+').');
    avenged(killer,a);
    if(killer.nemesis[a.id]){log(killer,' avenged ',{t:killer.nemesis[a.id],c:'f'+killer.fac},' by slaying ',a,' ',lv,'.');delete killer.nemesis[a.id]}
    else log(killer,' killed ',a,' ',lv,' in ',ZONES[zoneAt(a.x,a.y)],'.');
    const mates=S.agents.filter(x=>x!==a&&x.state!=='dead'&&x.guild===a.guild);
    mates.forEach(x=>x.nemesis[killer.id]=a.name);
    inheritGrudge(a,killer);
    goalEvent(killer,'slay',a);
    if(mates.length&&a.lvl>=4)log({t:'<'+a.guild.tag+'> '+a.guild.name,c:'f'+a.fac},' swears vengeance on ',killer,'.');
    fall(a,'slain by '+killer.name);}
  else if(killer.kind==='boss'){log(a,' ',lv,' was incinerated by ',{t:'Kragmaw',c:'gd'},'.');fall(a,'incinerated by Kragmaw')}
  else{const n=MOBS[killer.type].name;log(a,' ',lv,' fell to a ',n,'.');fall(a,'slain by a '+n)}}

export function strike(a,t){
  const c=CLS[a.cls];let d=atkOf(a)*(.8+rnd()*.4);const crit=rnd()<(c.crit||.08)+gearCrit(a);if(crit)d*=1.8;
  if(a.blessed){d*=1.2;a.blessed=0} // wayside shrine blessing: one strike at +20% (sim/encounters.js)
  if(t.kind==='hero')d*=.6*(CLS[t.cls].arm||1)*guardMul(t);
  d=Math.round(d);t.hp-=d;if(c.range>2)bolt(a,t,c.orb||c.acc);
  pop(t.x,t.y-.6,crit?d+'!':String(d),crit?'#ffe060':'#ffffff');
  if(t.kind==='boss'){S.boss.dmg[a.fac]+=d;return}
  if(t.hp<=0){if(t.kind==='mob')killMob(a,t);else agentDie(t,a)}}

export function priestHeal(a,list){if(!CLS[a.cls].heal||a.healCd>0)return;let low=null;
  for(const b of list){if(b.state==='ghost'||dist(a,b)>4)continue;if(b.hp<maxHp(b)*.55*tm(a,'mercy')&&(!low||b.hp/maxHp(b)<low.hp/maxHp(low)))low=b}
  if(low){const h=Math.round(20+a.lvl*5);low.hp=Math.min(maxHp(low),low.hp+h);pop(low.x,low.y-.6,'+'+h,'#7dce5a');a.healCd=3.5;if(low!==a)bondEvent(a,'heal',[low])}}

export function goHome(a){a.state='return';a.target=null;a.dest=null}

export function sellAndShop(a){const c=homeOf(a);let tot=sellGear(a),n=0;
  for(const it of a.bag){if(GOODS[it]){tot+=price(it);GOODS[it].supply++;n++}}a.bag=[];a.gold+=tot;
  if(n>=6&&rnd()<.35)log(a,' sold ',String(n),' goods at the ',c.name,' auction house for ',gold(tot+'g'),'.');
  if(shopUpgrade(a))a.hp=maxHp(a)}

export function turnIn(a){if(a.quest&&a.quest.have>=a.quest.need){const M=MOBS[a.quest.type];gainXp(a,xpNeed(a.lvl)*.25);const g=4+a.lvl*3;a.gold+=g;
    say(a,'quest',{mob:M.pl});
    record(a,'Completed ',{t:'“'+M.q+'”',c:'gd'},' for '+g+'g.');
  if(rnd()<.4)log(a,' completed ',{t:'“'+M.q+'”',c:'gd'},' for ',gold(g+'g'),'.');a.quest=null}
  if(!a.quest||MOBS[a.quest.type].z!==zoneFor(a.lvl))newQuest(a)}

export function findMob(a){let best=null,bs=1e9;const L=leaderOf(a),range=(L?5:9)*sightMul(a.zone),lq=L&&L.quest?L.quest.type:null;
  for(const m of nearMobs(a.x,a.y,range)){if(!m.alive||(m.target&&m.target!==a)||MOBS[m.type].z!==a.zone||m.lvl>a.lvl+1)continue;
    const d=dist(a,m);if(d>range)continue;const s=d-(a.quest&&a.quest.type===m.type||m.type===lq?4:0);if(s<bs){bs=s;best=m}}return best}

// Caution thresholds: retreat from the hunt at 45% HP, flee a fight at 22%, flee a duel at 20% (50% when outnumbered).
// Personality traits (data/traits.js) scale these via tm(a,key): Reckless lowers retreat/flee, Cautious raises them, etc.
export function updAgent(a,dt){
  a.cd-=dt*hasteMul(a);a.healCd-=dt;const mh=maxHp(a),c=homeOf(a),boss=S.boss;
  switch(a.state){
  case 'town':{a.hp=Math.min(mh,a.hp+mh*.3*dt);const sp=[c.ah,c.qg,c.gate][a.townStep];
    if(moveTo(a,sp.x,sp.y,dt,2.2)){a.wait-=dt;if(a.wait>0)break;
      if(a.townStep===0)say(a,'idle',{p:.35});
      if(a.townStep===0){sellAndShop(a);a.townStep=1;a.wait=1+rnd()*1.5}
      else if(a.townStep===1){turnIn(a);a.townStep=2;a.wait=.2;a.linger=a.cls==='Warrior'?4+rnd()*2:2;seekParty(a)}
      else{if(a.linger>0&&!a.party&&seekParty(a)==='wait'){a.linger--;a.wait=1;break}
        if(a.linger>0&&a.party&&partyMates(a).some(b=>b.state==='town'&&b.townStep<2)){a.linger--;a.wait=1;break}
        const tz=a.party?a.party.zone:townZone(a); // BRAIN: zone pick (scripted = zoneFor(a.lvl))
        say(a,'depart',{zone:ZONES[tz]});
        a.zone=tz;a.state='travel';a.dest=zonePoint(a.zone)}}break}
  case 'travel':{if(leaderOf(a)){a.state='follow';a.dest=null;break}
    if(checkEncounter(a,dt))break; // road encounter in reach: detour and resolve (sim/encounters.js)
    if(zoneAt(a.x,a.y)===a.zone&&a.zone>0&&rnd()<dt*.5){a.state='hunt';a.dest=null;break}
    if(!a.dest)a.dest=zonePoint(a.zone);if(moveTo(a,a.dest.x,a.dest.y,dt,2.4)){a.state='hunt';a.dest=null}break}
  case 'hunt':{if(leaderOf(a)){a.state='follow';a.dest=null;break}
    a.hp=Math.min(mh,a.hp+mh*.025*dt);const mates=partyMates(a);
    if(a.party)priestHeal(a,mates);
    if(a.hp<mh*.45*tm(a,'retreat')||a.bag.length>=Math.round(8*tm(a,'greed'))||(a.quest&&a.quest.have>=a.quest.need)||mates.some(b=>b.hp<maxHp(b)*.3)||isStorm(a.zone)){goHome(a);break}
    if(steerClear(a,dt,moveTo))break;
    a.scan-=dt;if(a.scan<=0){a.scan=.4+rnd()*.3;const m=findMob(a);if(m){a.target=m;a.state='fight';a.dest=null;break}}
    if(!a.dest)a.dest=zonePoint(a.zone,a);if(moveTo(a,a.dest.x,a.dest.y,dt,1.8))a.dest=null;break}
  // Party member at the leader's side: heals, picks off nearby mobs, joins the leader's fights (party tick),
  // hangs back when hurt. Drops to solo hunting (or heads home) the moment there is no leader to follow.
  case 'follow':{const L=leaderOf(a);if(!L){a.state=a.party&&a.party.home?'return':'hunt';a.dest=null;break}
    a.hp=Math.min(mh,a.hp+mh*.025*dt);priestHeal(a,a.party.mem);
    a.scan-=dt;if(a.scan<=0&&a.hp>=mh*.45&&L.state!=='return'){a.scan=.4+rnd()*.3;const m=findMob(a);if(m){a.target=m;a.state='fight';a.dest=null;break}}
    if(dist(a,L)>2){a.dest=followPt(a);moveTo(a,a.dest.x,a.dest.y,dt,L.state==='return'?2.5:2.1)}else{a.dest=null;a.moving=false}break}
  case 'fight':{const m=a.target;if(!m||!m.alive){a.state='hunt';a.target=null;break}
    spotMob(a,m);
    scoutCheck(a,m); // Chronicler: ambush / outleveled scout roll at fight entry (sim/narrator.js)
    const r=CLS[a.cls].range,d=dist(a,m);a.face=m.x>a.x?1:-1;
    if(d>r){moveTo(a,m.x,m.y,dt,2.4);break}a.moving=false;
    if(!m.target)m.target=a;
    priestHeal(a,a.party?a.party.mem:[a]);
    if(a.cd<=0){strike(a,m);a.cd=1.1}
    brainFight(a,m,mh); // BRAIN: optional earlier bail-out at 50% HP for AI-played heroes
    if(a.state==='fight'&&a.hp<mh*.22*tm(a,'flee')&&rnd()<dt*1.2){m.target=null;goHome(a);pop(a.x,a.y-.8,'FLEE','#ffb060')}
    fleeCheck(a,m); // Chronicler: flee roll, a failure lands one more hit (sim/narrator.js)
    if(a.state==='return')say(a,'flee',{mob:MOBS[m.type].name});
    break}
  case 'regroup':{a.regT-=dt;if(a.regT<=0||!a.dest||moveTo(a,a.dest.x,a.dest.y,dt,2.4)){a.state=a.regNext==='return'?'return':leaderOf(a)?'follow':'hunt';a.dest=null;a.regNext=null}break}
  case 'return':if(steerClear(a,dt,moveTo))break;if(checkEncounter(a,dt))break;if(moveTo(a,c.gate.x,c.gate.y,dt,2.4)){a.state='town';a.townStep=0;a.wait=.5}break;
  case 'ghost':if(moveTo(a,c.grave.x,c.grave.y,dt,4)){a.state='town';a.hp=mh*.5;a.townStep=0;a.wait=2;pop(a.x,a.y-.6,'REVIVED','#9ad0ff')}break;
  case 'duel':{const b=a.target;if(!b||b.state!=='duel'||b.target!==a){a.state='hunt';a.target=null;break}
    const r=CLS[a.cls].range,d=dist(a,b);a.face=b.x>a.x?1:-1;
    if(d>r){moveTo(a,b.x,b.y,dt,2.4);break}a.moving=false;priestHeal(a,[a]);
    if(a.cd<=0){strike(a,b);a.cd=1.1}
    // Caution: break off at 20% HP, or at 50% when outnumbered (helpers on you, none on your foe).
    const outn=S.agents.some(g=>g.state==='assist'&&g.target===a)&&!S.agents.some(g=>g.state==='assist'&&g.target===b);
    if(a.state==='duel'&&a.hp<mh*(outn?.5:.2*tm(a,'flee'))&&rnd()<dt*(outn?1.5:.5)){b.state='hunt';b.target=null;regroup(a,b,'return',3);
      if(rnd()<.5)log(a,' fled from ',b,' in ',ZONES[zoneAt(a.x,a.y)],'.')}
    break}
  case 'assist':{const b=a.target;if(!b||b.state!=='duel'){regroup(a,b&&b.state!=='dead'?b:null,a.regNext);break}
    const r=CLS[a.cls].range,d=dist(a,b);a.face=b.x>a.x?1:-1;if(d>r){moveTo(a,b.x,b.y,dt,2.8);break}a.moving=false;
    if(b.target&&b.target.kind==='hero')priestHeal(a,[b.target,a,...partyMates(a)]);
    if(a.cd<=0){strike(a,b);a.cd=1.1}break}
  case 'dungeon':{if(a.hidden)break;a.hp=Math.min(mh,a.hp+mh*.03*dt);const k=a.dgIdx;
    moveTo(a,CRYPT.x+(k%3-1)*.9,CRYPT.y+.6+Math.floor(k/3)*.7,dt,2.6);break}
  case 'raid':{if(!boss.alive){a.raid=false;goHome(a);break}
    const idx=a.raidIdx,ang=Math.PI*(.55+idx*.18),rr=Math.min(CLS[a.cls].range+.9,3.2);
    const px=boss.x+Math.cos(ang)*rr*-1,py=boss.y-.3+Math.sin(ang)*rr*(idx%2?1:-1)*.8;
    if(dist(a,boss)>rr+.6){moveTo(a,px,py,dt,2.4);break}a.moving=false;a.face=boss.x>a.x?1:-1;
    priestHeal(a,S.agents.filter(b=>b.raid&&b.fac===a.fac));
    if(a.cd<=0){strike(a,boss);a.cd=1.1}break}
  }}
