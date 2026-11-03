// Heroes: stats, quests, movement, combat, death and the per-hero state
// machine (town, travel, hunt, follow, fight, return, ghost, duel, assist, regroup, dungeon, raid).
// Party behaviour (forming, following, joining fights, shared XP) lives in party.js.
// Owned by ai-designer (behaviour) and character-builder (stat formulas).
import {writeSighting} from './sightings.js';
import {rnd,ri,clamp,pickA} from '../core/rng.js';
import {outpostHonor,outpostDest} from './outposts.js';
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
import {blockOf} from '../data/bestiary.js';
import {rollLoot} from './loot.js';
import {rollScores,growScores} from './abilities.js'; // ability scores (sim/abilities.js)
import {combatStats,dmgTaken} from './stats.js'; // Health, Attack, Defense, Crit, Speed (sim/stats.js)
import {emptySlots,equipEpic,shopUpgrade} from './gear.js';
import {newInv,load,sellLoot,autoEquip,passSpares,restock,fightAid,idleTend,tendAlly} from './inv.js'; // the pack (sim/inv.js)
import {record,timeline,first} from './history.js';
import {bondEvent,inheritGrudge,avenged} from './bonds.js';
import {checkEncounter} from './encounters.js';
import {scoutCheck,fleeCheck} from './narrator.js';
import {nearHeroes,nearMobs} from './spatial.js';
import {held} from './scenes.js'; // the engaged of a live-clock Table scene (#518)
import {slain as loreSlain,witness as loreWitness} from './lore.js'; // learn the world (#188): agent heroes only, no RNG
import {effMul,passiveMul} from './eff.js'; // timed effects and class passives (sim/eff.js, #81)
import {actHit,actHurt,actHeal,actKill,actDeath,actFlee,actNote} from './actlog.js'; // action log (recording only)
import {wakeKill,wakeXp,wakeLevelUp,wakeQuest,wakeQuestDone,wakeLoot} from './wakes.js'; // more turn triggers (agent heroes only)
import {fightMoves} from './moves.js'; // class abilities (sim/moves.js, #81)
import {townZone,partyZone,brainJob,brainFight} from './brain.js'; // brain hooks (sim/brain.js): scripted unless a.brain
import {killDone,killAbandoned,debtDone} from './questlog.js'; // the quest log: finished quests (no dice)
import {dmDepart,dmTravel,dmHunt,BOUNTY,bountyFor,takeBounty,fellowBounty} from './dm.js'; // adventures (sim/dm.js): a hero with a.adv goes where the scene is
import {townCraft,keepFor,townSmith} from './craft.js'; // crafting (#258): a scripted crafter makes what it wants in town before the sale
import {gatherTick} from './gather.js'; // gathering (#257): a scripted hunter works a node of its trade now and then
import {inSlots} from './company.js'; // the slotted company (#588)

// ---- stat formulas (tuning knobs) ----
export const xpNeed=l=>Math.round(60*Math.pow(l,1.45)*(1+.8*Math.min(1,Math.max(0,(l-9)/7)))); // veterans: L10-16 ramp to +80% (balance #107)
export const maxHp=a=>combatStats(a).health;
export const atkOf=a=>combatStats(a).attack;

// Where a hero of this level hunts: the band's region, or the one nearest their home town when bands overlap.
export const huntZone=a=>zoneFor(a.lvl,homeOf(a).gate);
// Kill-N quests are the gate captain's background bounties now (issue #67, sim/dm.js BOUNTY): nobody is handed one.
// A departing hero with no adventure may take the bounty of the region it sets out for. a.quest = {type, need, have,
// at (the quest log's id), bounty, giver}; an old save's kill quest (no bounty field) is finished and paid the same way.
function chooseBounty(a,c,z){
  if(a.quest&&MOBS[a.quest.type]&&MOBS[a.quest.type].z!==z){killAbandoned(a,'left for '+ZONES[z]);record(a,'Let the bounty on '+MOBS[a.quest.type].pl+' go.');a.quest=null}
  if(a.quest)return;const b=bountyFor(a,c,z);if(b&&rnd()<BOUNTY.TAKE*tm(a,'greed'))takeBounty(a,b)}

export function makeHero(f,cls,guild,wait){
  const a={id:++S.uid,kind:'hero',name:genName(f),fac:f,cls,lvl:1,xp:0,gear:0,gold:ri(2,6),
    inv:newInv(),kills:0,deaths:0,honor:0,epics:[],skin:pickA(FAC[f].skin),x:0,y:0,state:'town',townStep:1,
    wait,face:1,cd:0,healCd:0,scan:0,quest:null,target:null,dest:null,zone:0,moving:false,guild,nemesis:{},hidden:false,spotCd:0,party:null,linger:0,adv:null};
  a.traits=rollTraits(cls);
  a.slots=emptySlots();
  assignRace(a,S.agents); // people, skin, hair, name and home town (data/races.js)
  assignBackstory(a);
  rollScores(a); // six ability scores and skill training, after the people and trade are known
  a.hp=maxHp(a);
  const c=homeOf(a);a.x=c.x0+2+rnd()*7;a.y=c.y0+4+rnd()*3;
  S.agents.push(a);
  // Trait reveal for recruits (not the opening roster): "Thrakash is reckless and greedy; Grimhold will remember that."
  if(S.gameMin>0&&rnd()<.3)log(a,' is ',{t:traitPhrase(a),c:'gd'},'; ',c.name,' will remember that.');
  return a}

// A recruit seeded above level 1 (Fellowship replacements, balance #107): the ability growth of every fifth level.
export function seedLevel(a,lvl){lvl=Math.max(1,Math.min(20,Math.round(lvl)));if(lvl<=a.lvl)return a;
  for(let l=a.lvl+1;l<=lvl;l++)if(l%5===0)growScores(a,l);
  a.lvl=lvl;a.xp=0;a.hp=maxHp(a);return a}

export function moveTo(e,x,y,dt,sp){const dx=x-e.x,dy=y-e.y,d=Math.hypot(dx,dy);if(d<.12){e.moving=false;return true}
  const st=sp*SPEED[tileAt(e.x,e.y)]*speedMul(zoneAt(e.x,e.y))*dt;e.moving=true;if(Math.abs(dx)>.05)e.face=dx>0?1:-1;
  if(st>=d){e.x=x;e.y=y;e.moving=false;return true}e.x+=dx/d*st;e.y+=dy/d*st;return false}

export function gainXp(a,x){if(a.lvl>=20)return;a.xp+=Math.round(x);actNote(a,'xp',null,Math.round(x));
  while(a.lvl<20&&a.xp>=xpNeed(a.lvl)){a.xp-=xpNeed(a.lvl);a.lvl++;actNote(a,'level',null,a.lvl);if(a.lvl%5===0)growScores(a,a.lvl);a.hp=maxHp(a);pop(a.x,a.y-.5,'LEVEL UP','#f2c14e');wakeLevelUp(a,maxHp(a));
    if(a.lvl%5===0||a.lvl>=15)say(a,'levelup',{level:a.lvl});
    record(a,'Reached level '+a.lvl+'.');
    if(a.lvl%5===0||a.lvl>=15)log(a,' reached level ',gold(String(a.lvl)),a.lvl===20?'. The first steps of a legend.':'.');
    if(a.lvl%5===0){const fa=first('lvl:'+a.fac+':'+a.lvl),cl=a.lvl>=10&&first('cls:'+a.fac+':'+a.cls+':'+a.lvl),fn={t:FAC[a.fac].name,c:'f'+a.fac};
      if(fa)timeline('level',a,' is the first of the ',fn,' to reach level '+a.lvl+'.');else if(cl)timeline('level',a,' is the first '+a.cls+' of the ',fn,' to reach level '+a.lvl+'.')}
    goalEvent(a,'level');}
  if(a.lvl>=20)a.xp=0;else wakeXp(a,x,xpNeed(a.lvl))}

export function getEpic(a,name,src){a.epics.push(name);actNote(a,'loot',name,null);wakeLoot(a,name,'epic');pop(a.x,a.y,'EPIC!','#c58cff');log(a,' looted ',epic(name),' from ',src,'.');
  equipEpic(a,name,'Looted from '+src);
  record(a,'Looted ',epic(name),' from '+src+'.');
  say(a,'epic',{item:name});
  goalEvent(a,'epic',name)}

export function killMob(a,m){actKill(a,m);m.alive=false;m.respawn=22+rnd()*20;m.target=null;a.kills++;
  const diff=m.lvl-a.lvl,xp=(8+m.lvl*6)*(diff<-4?.3:diff>2?1.3:1)*blockOf(m.type,m.v,m.role).xp*(m.xpMul!=null?m.xpMul:1);wakeKill(a,m);gainXp(a,xp);
  const M=MOBS[m.type];shareKill(a,m,xp);rollLoot(a,m); // trade good, gold, slot item, zone epic: the creature's bestiary loot table (sim/loot.js)
  bondEvent(a,'kill',partyMates(a));
  if(m.elite)record(a,'Slew ',{t:m.name,c:'gd'},', '+m.title+', in '+ZONES[M.z]+'.');
  if(m.elite){timeline('elite',a,' slew ',{t:m.name,c:'gd'},', '+m.title+', in '+ZONES[M.z]+'.');a.eliteKills=(a.eliteKills||0)+1;log(a,' slew ',{t:m.name,c:'gd'},', ',m.title,', in ',ZONES[M.z],'!');getEpic(a,pickA(EPICS[M.z]),m.name)} // named elite: guaranteed epic from the zone table
  if(a.quest&&a.quest.type===m.type&&a.quest.have<a.quest.need){a.quest.have++;wakeQuest(a,a.quest.have>=a.quest.need)}
  goalEvent(a,'kill',m);
  if(a.player)loreSlain(a,m);
  a.target=null;a.state='hunt'}

// Permanent death: graveyard entry, a recruit is scheduled, old graves recycled.
export function fall(a,cause){
  a.deaths++;a.state='dead';a.cause=cause;a.diedAt=clockStr();a.hp=0;a.target=null;a.raid=false;a.moving=false;a.hidden=false;a.dest=null;
  if(a.party)disband(a.party);
  for(const m of S.mobs)if(m.target===a)m.target=null;
  S.facStats[a.fac].fallen++;
  S.fallen.unshift({name:a.name,fac:a.fac,lvl:a.lvl,cls:a.cls,cause,t:a.diedAt});if(S.fallen.length>15)S.fallen.pop();
  goalEvent(a,'died');
  if(a.lvl>=10&&!/^lost in/.test(cause))timeline('death',a,' fell at level '+a.lvl+' ('+cause+').'+(a.lvl>=15?' A legend ends.':''));
  S.recruits.push({fac:a.fac,cls:a.cls,t:8+rnd()*8});
  const graves=S.agents.filter(x=>x.state==='dead');
  if(graves.length>40){const old=graves.find(x=>x!==S.pinned);if(old)S.agents.splice(S.agents.indexOf(old),1)}}

const GUILD_GRUDGE_LVL=12,RAID_FLEE=.15;
export function agentDie(a,killer){
  actDeath(a,killer);if(killer.kind==='hero')actKill(killer,a);
  if(killer&&killer.kind==='mob')loreWitness(a,killer); // those who see it learn what it can do (#188)
  const lv={t:'(level '+a.lvl+')',c:'dm'};
  record(a,'Fell at level '+a.lvl+', slain by ',killer.kind==='hero'?killer:killer.kind==='boss'?{t:'Kragmaw',c:'gd'}:'a '+MOBS[killer.type].name,'.');
  bondEvent(a,'died',[killer]);
  for(const x of nearHeroes(a.x,a.y,10))if(x!==a&&x.state!=='dead'&&((a.guild&&x.guild===a.guild)||(a.party&&x.party===a.party))&&dist(x,a)<=10)say(x,'mourn',{target:a.name});
  if(killer.kind==='hero'){const oh=outpostHonor(a);killer.honor+=oh;S.facStats[killer.fac].honor+=oh;const g=Math.floor(a.gold*.1);a.gold-=g;killer.gold+=g;
    killer.state=killer.raid?'raid':'hunt';killer.target=null;gainXp(killer,40+a.lvl*8);
    say(killer,'kill',{target:a.name});
    record(killer,killer.nemesis[a.id]?'Avenged '+killer.nemesis[a.id]+' by slaying ':'Killed ',a,' (level '+a.lvl+').');
    avenged(killer,a);
    if(killer.nemesis[a.id]){debtDone(killer,a);log(killer,' avenged ',{t:killer.nemesis[a.id],c:'f'+killer.fac},' by slaying ',a,' ',lv,'.');delete killer.nemesis[a.id]}
    else log(killer,' killed ',a,' ',lv,' in ',ZONES[zoneAt(a.x,a.y)],'.');
    const mates=S.agents.filter(x=>x!==a&&x.state!=='dead'&&a.guild&&x.guild===a.guild);
    mates.forEach(x=>{if(a.lvl>=GUILD_GRUDGE_LVL||(a.party&&x.party===a.party))x.nemesis[killer.id]=a.name}); // only a fallen veteran swears the whole guild; lesser deaths bind just their party
    inheritGrudge(a,killer);
    goalEvent(killer,'slay',a);
    if(mates.length&&a.guild&&a.lvl>=4)log({t:'<'+a.guild.tag+'> '+a.guild.name,c:'f'+a.fac},' swears vengeance on ',killer,'.');
    fall(a,'slain by '+killer.name);}
  else if(killer.kind==='boss'){log(a,' ',lv,' was incinerated by ',{t:'Kragmaw',c:'gd'},'.');fall(a,'incinerated by Kragmaw')}
  else{const n=MOBS[killer.type].name;log(a,' ',lv,' fell to a ',n,'.');fall(a,'slain by a '+n)}}

// o: an ability's blow (sim/moves.js): {mul: damage multiplier, crit: extra crit chance}. Returns the damage dealt.
export function strike(a,t,o){
  const c=CLS[a.cls];let d=atkOf(a)*(.8+rnd()*.4)*(o&&o.mul||1);const crit=rnd()<combatStats(a).crit+(o&&o.crit||0);if(crit)d*=1.8;
  if(t.hp>=(t.kind==='hero'?maxHp(t):t.maxhp)*.95)d*=passiveMul(a,'openerMul'); // Opening Rune
  d*=effMul(t,'mark'); // Quarry Mark
  if(a.blessed){d*=1.2;a.blessed=0} // wayside shrine blessing: one strike at +20% (sim/encounters.js)
  if(t.kind==='hero')d*=.6*dmgTaken(t);
  d=Math.round(d);t.hp-=d;actHit(a,t,d,crit);if(t.kind==='hero')actHurt(t,a,d);if(c.range>2)bolt(a,t,c.orb||c.acc);
  pop(t.x,t.y-.6,crit?d+'!':String(d),crit?'#ffe060':'#ffffff');
  if(t.kind==='boss'){S.boss.dmg[a.fac]+=d;return d}
  if(t.hp<=0){if(t.kind==='mob')killMob(a,t);else agentDie(t,a)}
  return d}

export function priestHeal(a,list){if(!CLS[a.cls].heal)return;if(a.healCd>0){tendAlly(a,list);return}let low=null; // spell on cooldown: a potion for a member nearly down (sim/inv.js)
  for(const b of list){if(b.state==='ghost'||dist(a,b)>4)continue;if(b.hp<maxHp(b)*.55*tm(a,'mercy')&&(!low||b.hp/maxHp(b)<low.hp/maxHp(low)))low=b}
  if(low)healOne(a,low)}
// One cast of the class heal on one hero (priestHeal's pick, or a gambit's target, #617).
export function healOne(a,low){const h=Math.round((20+a.lvl*5)*passiveMul(a,'healMul'));low.hp=Math.min(maxHp(low),low.hp+h);pop(low.x,low.y-.6,'+'+h,'#7dce5a');a.healCd=3.5;actHeal(a,low,h,'Heal');if(low!==a)bondEvent(a,'heal',[low])}

export function goHome(a){a.state='return';a.target=null;a.dest=null}

// Town: craft (#258), wear a better spare, pass spares to a party member they suit, sell goods and the rest, buy gear, then stock the pack.
export function sellAndShop(a){const c=homeOf(a);townCraft(a);autoEquip(a);passSpares(a);const sold=sellLoot(a,keepFor(a)),tot=sold.gold,n=sold.goods;a.gold+=tot; // craft first (#258): it uses the materials the sale would take
  if(n>=6&&rnd()<.35)log(a,' sold ',String(n),' goods at the ',c.name,' auction house for ',gold(tot+'g'),'.');
  if(shopUpgrade(a))a.hp=maxHp(a);
  restock(a);townSmith(a)}

export function turnIn(a){if(a.quest&&a.quest.have>=a.quest.need){const M=MOBS[a.quest.type];gainXp(a,xpNeed(a.lvl)*.25);const g=4+a.lvl*3;a.gold+=g;
    wakeQuestDone(a,M.q,g);say(a,'quest',{mob:M.pl});
    record(a,'Completed ',{t:'“'+M.q+'”',c:'gd'},' for '+g+'g.');
  if(rnd()<.4)log(a,' completed ',{t:'“'+M.q+'”',c:'gd'},' for ',gold(g+'g'),'.');killDone(a);a.quest=null;if(S.dmStats)S.dmStats.bountiesDone=(S.dmStats.bountiesDone||0)+1}}

export function findMob(a){let best=null,bs=1e9;const L=leaderOf(a),range=(L?5:9)*sightMul(a.zone),lq=L&&L.quest?L.quest.type:null;
  for(const m of nearMobs(a.x,a.y,range)){if(!m.alive||(m.target&&m.target!==a)||held(m)||MOBS[m.type].z!==a.zone||m.lvl>a.lvl+1||m.spared>S.gameMin)continue; // spared: talked down at the Table (#296)
    const d=dist(a,m);if(d>range)continue;const s=d-(a.quest&&a.quest.type===m.type||m.type===lq?4:0);if(s<bs){bs=s;best=m}}return best}

// Caution thresholds: retreat from the hunt at 45% HP, flee a fight at 22%, flee a duel at 20% (50% when outnumbered).
// Personality traits (data/traits.js) scale these via tm(a,key): Reckless lowers retreat/flee, Cautious raises them, etc.
export function updAgent(a,dt){
  a.cd-=dt*combatStats(a).speed;a.healCd-=dt;if(a.potCd>0)a.potCd-=dt;if(a.wardT>0)a.wardT-=dt;const mh=maxHp(a),c=homeOf(a),boss=S.boss;
  switch(a.state){
  case 'town':{a.hp=Math.min(mh,a.hp+mh*.3*dt);const sp=[c.ah,c.qg,c.gate][a.townStep];
    if(moveTo(a,sp.x,sp.y,dt,2.2)){a.wait-=dt;if(a.wait>0)break;
      if(a.townStep===0)say(a,'idle',{p:.35});
      if(a.townStep===0){sellAndShop(a);a.townStep=1;a.wait=1+rnd()*1.5}
      else if(a.townStep===1){turnIn(a);a.townStep=2;a.wait=.2;a.linger=a.cls==='Warrior'?4+rnd()*2:2;seekParty(a)}
      else{if(a.linger>0&&!a.party&&seekParty(a)==='wait'){a.linger--;a.wait=1;break}
        if(a.linger>0&&a.party&&partyMates(a).some(b=>b.state==='town'&&b.townStep<2)){a.linger--;a.wait=1;break}
        // Order is deliberate: a posted adventure outranks any zone plan, so the DM goes first
        // and an AI hero's (or leader's) town plan is then settled 'overruled' (brainJob).
        if(dmDepart(a,c)){brainJob(a);break} // DM: take a posted adventure or resume one (sim/dm.js)
        const tz=a.party?partyZone(a):townZone(a); // BRAIN: zone pick (scripted = huntZone(a); a party's zone, which an AI leader may set)
        if(inSlots(a)&&fellowBounty(a,c,tz)){brainJob(a);break} // the Fellowship first (#325): the captain's bounty for its region becomes a Fellowship job
        chooseBounty(a,c,tz); // no adventure: the captain's bounty for that region, if the hero wants it (issue #67)
        say(a,'depart',{zone:ZONES[tz]});
        a.zone=tz;a.state='travel';a.dest=zonePoint(a.zone,null,c.gate);if(a.player)writeSighting(a,ZONES[tz],c.name)}}break}
  case 'travel':{if(leaderOf(a)){a.state='follow';a.dest=null;break}
    if(a.adv&&dmTravel(a,dt))break; // DM: walking to the adventure's next scene
    if(checkEncounter(a,dt))break; // road encounter in reach: detour and resolve (sim/encounters.js)
    if(zoneAt(a.x,a.y)===a.zone&&a.zone>0&&rnd()<dt*.5){a.state='hunt';a.dest=null;break}
    if(!a.dest)a.dest=zonePoint(a.zone,null,c.gate);if(moveTo(a,a.dest.x,a.dest.y,dt,2.4)){a.state='hunt';a.dest=null}break}
  case 'hunt':{if(leaderOf(a)){a.state='follow';a.dest=null;break}
    if(a.adv&&dmHunt(a,dt))break; // DM: the adventure's fight, rest or next leg instead of the kill-N hunt
    a.hp=Math.min(mh,a.hp+mh*.025*dt);idleTend(a);const mates=partyMates(a);
    if(a.party)priestHeal(a,mates);
    if(a.hp<mh*.45*tm(a,'retreat')||load(a)>=Math.round(8*tm(a,'greed'))||(a.quest&&a.quest.have>=a.quest.need)||mates.some(b=>b.hp<maxHp(b)*.3)||isStorm(a.zone)){goHome(a);break}
    if(steerClear(a,dt,moveTo))break;
    if(gatherTick(a,dt,moveTo))break; // at a node (sim/gather.js): still 'hunt', so mobs, duels and the party see a hunter
    a.scan-=dt;if(a.scan<=0){a.scan=.4+rnd()*.3;const m=findMob(a);if(m){a.target=m;a.state='fight';a.dest=null;break}}
    if(!a.dest)a.dest=outpostDest(a)||zonePoint(a.zone,a);if(moveTo(a,a.dest.x,a.dest.y,dt,1.8))a.dest=null;break}
  // Party member at the leader's side: heals, picks off nearby mobs, joins the leader's fights (party tick),
  // hangs back when hurt. Drops to solo hunting (or heads home) the moment there is no leader to follow.
  case 'follow':{const L=leaderOf(a);if(!L){a.state=a.party&&a.party.home?'return':'hunt';a.dest=null;break}
    a.hp=Math.min(mh,a.hp+mh*.025*dt);priestHeal(a,a.party.mem);
    a.scan-=dt;if(a.scan<=0&&a.hp>=mh*.45&&L.state!=='return'){a.scan=.4+rnd()*.3;const m=findMob(a);if(m){a.target=m;a.state='fight';a.dest=null;break}}
    if(dist(a,L)>2){a.dest=followPt(a);moveTo(a,a.dest.x,a.dest.y,dt,L.state==='return'?2.5:2.1)}else{a.dest=null;a.moving=false}break}
  case 'fight':{const m=a.target;if(!m||!m.alive||held(m)){a.state='hunt';a.target=null;break} // a foe held in another company's scene (#518) is not fought
    spotMob(a,m);
    scoutCheck(a,m); // Chronicler: ambush / outleveled scout roll at fight entry (sim/narrator.js)
    const r=CLS[a.cls].range,d=dist(a,m);a.face=m.x>a.x?1:-1;
    if(d>r){moveTo(a,m.x,m.y,dt,2.4);break}a.moving=false;
    if(!m.target)m.target=a;
    const mates=a.party?a.party.mem:[a];priestHeal(a,mates);
    const mv=fightMoves(a,m,mates,a.cd<=0); // class abilities: free ones at once, a striking one in place of the blow
    if(a.cd<=0){if(mv!=='swing')strike(a,m);a.cd=1.1}
    fightAid(a,m); // potion, antidote, ward or Hearthward from the pack (sim/inv.js)
    brainFight(a,m,mh); // BRAIN: optional earlier bail-out at 50% HP for AI-played heroes
    if(a.state==='fight'&&a.hp<mh*.22*tm(a,'flee')&&rnd()<dt*1.2){m.target=null;goHome(a);actFlee(a);pop(a.x,a.y-.8,'FLEE','#ffb060')}
    fleeCheck(a,m); // Chronicler: flee roll, a failure lands one more hit (sim/narrator.js)
    if(a.state==='return')say(a,'flee',{mob:MOBS[m.type].name});
    break}
  case 'regroup':{a.regT-=dt;if(a.regT<=0||!a.dest||moveTo(a,a.dest.x,a.dest.y,dt,2.4)){a.state=a.regNext==='return'?'return':leaderOf(a)?'follow':'hunt';a.dest=null;a.regNext=null}break}
  case 'return':if(steerClear(a,dt,moveTo))break;if(checkEncounter(a,dt))break;if(moveTo(a,c.gate.x,c.gate.y,dt,2.4)){a.state='town';a.townStep=0;a.wait=.5}break;
  case 'ghost':if(moveTo(a,c.grave.x,c.grave.y,dt,4)){a.state='town';a.hp=mh*.5;a.townStep=0;a.wait=2;pop(a.x,a.y-.6,'REVIVED','#9ad0ff')}break;
  case 'duel':{const b=a.target;if(!b||b.state!=='duel'||b.target!==a){a.state='hunt';a.target=null;break}
    const r=CLS[a.cls].range,d=dist(a,b);a.face=b.x>a.x?1:-1;
    if(d>r){moveTo(a,b.x,b.y,dt,2.4);break}a.moving=false;priestHeal(a,[a]);
    {const mv=fightMoves(a,b,[a],a.cd<=0);if(a.cd<=0){if(mv!=='swing')strike(a,b);a.cd=1.1}}
    fightAid(a,b); // a potion in a duel too
    // Caution: break off at 20% HP, or at 50% when outnumbered (helpers on you, none on your foe).
    const outn=S.agents.some(g=>g.state==='assist'&&g.target===a)&&!S.agents.some(g=>g.state==='assist'&&g.target===b);
    if(a.state==='duel'&&a.hp<mh*(outn?.5:.3*tm(a,'flee'))&&rnd()<dt*1.5){b.state='hunt';b.target=null;regroup(a,b,'return',3);actFlee(a);
      if(rnd()<.5)log(a,' fled from ',b,' in ',ZONES[zoneAt(a.x,a.y)],'.')}
    break}
  case 'assist':{const b=a.target;if(!b||b.state!=='duel'||held(b)){regroup(a,b&&b.state!=='dead'?b:null,a.regNext);break}
    const r=CLS[a.cls].range,d=dist(a,b);a.face=b.x>a.x?1:-1;if(d>r){moveTo(a,b.x,b.y,dt,2.8);break}a.moving=false;
    if(b.target&&b.target.kind==='hero')priestHeal(a,[b.target,a,...partyMates(a)]);
    {const mv=fightMoves(a,b,[a,...partyMates(a)],a.cd<=0);if(a.cd<=0){if(mv!=='swing')strike(a,b);a.cd=1.1}}break}
  case 'dungeon':{if(a.hidden)break;a.hp=Math.min(mh,a.hp+mh*.03*dt);const k=a.dgIdx;
    moveTo(a,CRYPT.x+(k%3-1)*.9,CRYPT.y+.6+Math.floor(k/3)*.7,dt,2.6);break}
  case 'raid':{if(!boss.alive){a.raid=false;goHome(a);break}
    if(a.hp<mh*RAID_FLEE&&rnd()<dt*2){a.raid=false;a.target=null;pop(a.x,a.y-.6,'RETREAT','#ffd070');log(a,' broke from the raid on ',{t:'Kragmaw',c:'gd'},' wounded and fled the lair.');goHome(a);break} // live to raid again
    const idx=a.raidIdx,ang=Math.PI*(.55+idx*.18),rr=Math.min(CLS[a.cls].range+.9,3.2);
    const px=boss.x+Math.cos(ang)*rr*-1,py=boss.y-.3+Math.sin(ang)*rr*(idx%2?1:-1)*.8;
    if(dist(a,boss)>rr+.6){moveTo(a,px,py,dt,2.4);break}a.moving=false;a.face=boss.x>a.x?1:-1;
    const raiders=S.agents.filter(b=>b.raid&&b.fac===a.fac);priestHeal(a,raiders);
    {const mv=fightMoves(a,boss,raiders,a.cd<=0);if(a.cd<=0){if(mv!=='swing')strike(a,boss);a.cd=1.1}}
    fightAid(a,boss);break}
  }}
