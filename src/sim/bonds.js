// Bonds and blood debts (issue #5). Heroes who fight side by side grow fond of each
// other; the killer of a friend becomes a nemesis, and the debt passes down.
//
// a.bonds = {[heroId]: score}, numbers keyed by id so save/load serialises them as-is
// (recycled graves leave harmless stubs; ids never collide). Scores grow on shared
// events and drift down by one each game-day the two are not within reach of each
// other. friends = score >= FRIEND, close friends = score >= CLOSE, capped at CAP.
//
// Scoring: shared mob kill within 8 tiles +1, a heal given or received +2, rushing to a
// duel +3, forming a party +2, avenging a friend's killer +3 from every friend of the dead.
// Inheritance: when a hero is slain by a hero, every close friend takes the killer as a
// nemesis (a.nemesis[killerId] = victimName, the same map pvp.js hunts with) and friends
// do so half the time. a.grudges = {[killerId]: victimId} marks grudges born of friendship
// so the Chronicle can say "who killed their friend" and tell a blood debt from guild duty.
// Grudges end only with the killer's death (existing behaviour, untouched).
import {rnd} from '../core/rng.js';
import {dist,ZONES,zoneAt} from '../world/map.js';
import {MOBS} from '../data/mobs.js';
import {S} from './state.js';
import {log} from './chronicle.js';
import {record} from './history.js';
import {say} from './chat.js';
import {rivalKill} from './rivals.js';

export const FRIEND=6,CLOSE=15,CAP=30,NEAR=8,DAY=1440;
const GAIN={kill:1,heal:2,assist:3,party:2,avenge:3};

const alive=x=>x&&x.state!=='dead';
const stats=()=>S.bondStats||(S.bondStats={friends:0,close:0,inherited:0,mourned:0,bloodDebts:0});
export const bond=(a,b)=>(a.bonds&&a.bonds[b.id])||0;
// Living friends, closest first. One scan, so it can move to an index with the others.
export const friendsOf=(a,min=FRIEND)=>S.agents.filter(b=>b!==a&&alive(b)&&bond(a,b)>=min).sort((x,y)=>bond(a,y)-bond(a,x));
const byId=id=>S.agents.find(x=>x.id==id); // loose: object keys are strings

// Raise the bond both ways; crossing a threshold is worth a line in the Chronicle.
function grow(a,b,n){if(a===b||!alive(a)||!alive(b)||a.fac!==b.fac)return;
  const was=bond(a,b),now=Math.min(CAP,was+n);
  (a.bonds||(a.bonds={}))[b.id]=now;(b.bonds||(b.bonds={}))[a.id]=now;
  if(was<FRIEND&&now>=FRIEND){stats().friends++;record(a,'Became friends with ',b,'.');record(b,'Became friends with ',a,'.');
    if(rnd()<.5)log(a,' and ',b,' have become friends over shared hunts in ',ZONES[zoneAt(a.x,a.y)],'.')}
  if(was<CLOSE&&now>=CLOSE){stats().close++;record(a,'Now counts ',b,' a sworn companion.');record(b,'Now counts ',a,' a sworn companion.');
    if(rnd()<.35)log(a,' and ',b,' are sworn companions now; each would die for the other.')}}

// bondEvent(a, kind, list): 'kill' with party mates (only those within NEAR tiles count),
// 'heal' with the one healed, 'assist' with the duelist helped, 'party' with the members,
// 'died' with [killer] to let friends mourn.
export function bondEvent(a,kind,list=[]){
  if(kind==='died'){mourn(a,list[0]);return}
  if(kind==='party'){for(const x of list)for(const y of list)if(x!==y&&x.id<y.id)grow(x,y,GAIN.party);return}
  for(const b of list){if(kind==='kill'&&dist(a,b)>NEAR)continue;grow(a,b,GAIN[kind]||1)}}

// Friends mourn, close friends record the loss, and the closest friend speaks for all of them.
function mourn(a,killer){const fr=friendsOf(a);if(!fr.length)return;
  const who=!killer?null:killer.kind==='hero'?killer:killer.kind==='boss'?{t:'Kragmaw',c:'gd'}:'a '+MOBS[killer.type].name;
  for(const x of fr){say(x,'mourn',{target:a.name});
    record(x,'Lost a '+(bond(a,x)>=CLOSE?'close friend':'friend')+', ',a,who?', to ':'.',...(who?[who,'.']:[]))}
  stats().mourned++;const c=fr[0];
  if(killer&&killer.kind==='hero')log(c,' swears ',a,'’s death will be paid for.');
  else if(bond(a,c)>=CLOSE)log(c,' mourns ',a,', lost to ',who||'the wilds',' in ',ZONES[zoneAt(a.x,a.y)],'.')}

// A hero has been slain by a hero: close friends inherit the killer as nemesis, friends
// half the time. Called from agentDie after the guildmates' grudge is set.
export function inheritGrudge(a,killer){if(!killer||killer.kind!=='hero')return;
  rivalKill(a,killer); // guild rivalry heat (sim/rivals.js, #6)
  for(const x of friendsOf(a)){if(x.fac===killer.fac)continue;
    const close=bond(a,x)>=CLOSE;if(!close&&rnd()<.5)continue;
    if(!x.nemesis[killer.id])stats().inherited++;
    x.nemesis[killer.id]=a.name;(x.grudges||(x.grudges={}))[killer.id]=a.id}}

// Chronicle fragment for pvp.js: 'their friend ' when this nemesis killed a friend.
export const grudgeOf=(a,id)=>a.grudges&&a.grudges[id]?'their friend ':'';

// The nemesis is dead. If the grudge was a friend's, say so and record the blood debt paid;
// either way the dead one's friends warm to the avenger.
export function avenged(avenger,slain){const victim=avenger.nemesis[slain.id];if(!victim)return;
  const vid=avenger.grudges&&avenger.grudges[slain.id];
  const v=vid!=null?byId(vid):S.agents.find(x=>x.state==='dead'&&x.name===victim&&x.fac===avenger.fac);
  if(vid!=null){stats().bloodDebts++;delete avenger.grudges[slain.id];
    record(avenger,'Paid the blood debt for '+victim+' by slaying ',slain,'.');
    log(avenger,' has paid the blood debt for ',{t:victim,c:'f'+avenger.fac},': ',slain,' lies dead.')}
  if(v&&v.bonds)for(const id in v.bonds){if(v.bonds[id]<FRIEND)continue;const f=byId(id);if(f&&f!==avenger&&alive(f))grow(f,avenger,GAIN.avenge)}}

// Once per game-day: bonds between heroes who are not within reach of each other drift
// down by one; entries for the dead are dropped.
export function bondsTick(dt){S.bondT=(S.bondT||0)+dt*6;if(S.bondT<DAY)return;S.bondT-=DAY;
  for(const a of S.agents){if(!alive(a)||!a.bonds)continue;
    for(const id in a.bonds){const b=byId(id);
      if(!alive(b)){delete a.bonds[id];continue}
      if(dist(a,b)>NEAR&&--a.bonds[id]<=0)delete a.bonds[id]}}}
