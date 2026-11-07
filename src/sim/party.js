// Parties: 2-3 same-faction heroes of similar level who leave town together,
// follow their leader, join each other's fights and share XP. Owned by ai-designer.
// A party is {id, fac, leader, mem, zone, home} on S.parties; each hero has a.party. A company's walking group
// (sim/company.js, #402) is a party with p.company set; partySlotted(p) says whether it walks for the slotted company (#588).
// Rules: form in town after the quest-giver step (within 2 levels; a Priest prefers a
// Warrior, a Warrior lingers a few seconds for a Priest); leader = highest level;
// dissolve on a death, a level gap over 3, or when the party heads home together;
// a member pulled into the dungeon or a raid just leaves the party. A member jumped in a
// duel stays: the others rally to them, then everyone pulls back (regroup) or heads home.
import {rnd} from '../core/rng.js';
import {ZONES,zoneFor,zonePoint,dist} from '../world/map.js';
import {CLS} from '../data/classes.js';
import {homeOf} from '../data/races.js';
import {S,foeOf} from './state.js';
import {log} from './chronicle.js';
import {MOBS} from '../data/mobs.js';
import {maxHp,gainXp} from './heroes.js';
import {wakeQuest} from './wakes.js';
import {say} from './chat.js';
import {tm} from '../data/traits.js';
import {record} from './history.js';
import {nearestHero} from './spatial.js';
import {bondEvent} from './bonds.js';
import {inSlots,partySlotted} from './company.js'; // the slotted company (#588)

export const partyMates=a=>a.party?a.party.mem.filter(b=>b!==a&&b.state!=='dead'):[];
const inField=b=>!(b.state==='town'||b.state==='dead'||b.state==='dungeon'||b.state==='raid'||b.state==='ghost');
const loose=b=>b.state==='hunt'||b.state==='travel'||b.state==='follow';
// The hero this one should stick to, or null if solo / leading / leader not out in the world.
export function leaderOf(a){const p=a.party;if(!p||p.leader===a||!inField(p.leader))return null;return p.leader}
// A point at the leader's side, spread out by member index so the party does not stack.
export function followPt(a){const L=a.party.leader,i=a.party.mem.indexOf(a),ang=i*2.1+.6;return{x:L.x+Math.cos(ang)*1.3,y:L.y+Math.sin(ang)*1.1}}

// Caution: a party leader keeps the group away from enemy heroes rather than brawling.
// Returns true while the leader is detouring around a foe within 6 tiles (caller skips its normal move).
export function steerClear(a,dt,moveTo){if(!a.party||a.party.leader!==a)return false;const foe=nearestFoe(a,6);if(!foe)return false;
  if(!a.dest||!a.dest.away||dist(a.dest,foe)<=dist(a,foe)){a.dest=awayPoint(a,foe);a.dest.away=true}
  if(moveTo(a,a.dest.x,a.dest.y,dt,2.3))a.dest=null;return true}
const afield=b=>b.state==='travel'||b.state==='hunt'||b.state==='fight'||b.state==='return'||b.state==='duel'||b.state==='assist';
export function nearestFoe(a,r){return nearestHero(a.x,a.y,r,b=>foeOf(a,b)&&afield(b))} // #730: no list built (sim/spatial.js)
export function awayPoint(a,foe){let best=null,bd=-1;for(let i=0;i<8;i++){const p=zonePoint(a.zone,a);const d=dist(p,foe);if(d>bd){bd=d;best=p}}return best}

const names=(list)=>{const out=[];list.forEach((b,i)=>{out.push(b);if(i<list.length-2)out.push(', ');else if(i===list.length-2)out.push(' and ')});return out};

// Called when a hero finishes the quest-giver step and again while lingering at the gate.
// Returns 'wait' when a Warrior should hold at the gate a little longer for a Priest.
export function seekParty(a){if(a.party||inSlots(a)||a.company!=null||a.companion!=null||!tm(a,'social'))return; // a company's companion (#442) rides with its company // Loners never form or join a party; Fellowship members muster with their own (sim/fellowship.js)
  const cand=S.agents.filter(b=>b!==a&&!b.party&&!inSlots(b)&&b.company==null&&b.companion==null&&tm(b,'social')&&b.fac===a.fac&&homeOf(b)===homeOf(a)&&b.state==='town'&&Math.abs(b.lvl-a.lvl)<=2); // same home town: a party musters in one gate
  if(!cand.length)return;
  if(a.cls==='Warrior'&&a.linger>0&&!cand.some(b=>CLS[b.cls]&&CLS[b.cls].heal))return 'wait';
  const isHeal=c=>!!(CLS[c.cls]&&CLS[c.cls].heal),want=isHeal(a)?c=>c.cls==='Warrior':a.cls==='Warrior'?isHeal:()=>false;
  cand.sort((x,y)=>((want(y)?1:0)-(want(x)?1:0))||(Math.abs(x.lvl-a.lvl)-Math.abs(y.lvl-a.lvl)));
  const mem=[a,...cand.slice(0,2)];
  let leader=mem[0];for(const b of mem)if(b.lvl>leader.lvl)leader=b;
  // The party hunts where its weakest member can survive, not where the leader would go alone.
  const p={id:++S.uid,fac:a.fac,leader,mem,zone:zoneFor(Math.min(...mem.map(b=>b.lvl)),homeOf(a).gate),home:false};
  for(const b of mem)b.party=p;S.parties.push(p);
  for(const b of mem)record(b,'Formed a party with ',...names(mem.filter(x=>x!==b)),' bound for ',{t:ZONES[p.zone],c:'gd'},'.');
  bondEvent(leader,'party',mem);
  say(mem.find(b=>b!==leader)||leader,'party',{target:leader.name,zone:ZONES[p.zone]});
  if(rnd()<.4)log(...names(mem),' set out for ',{t:ZONES[p.zone],c:'gd'},' together.')}

// Leaving a party never leaves a dangling dest or a follower without a leader.
function solo(b,home){if(b.state==='follow')b.state=home?'return':'hunt';if(loose(b)||b.state==='return')b.dest=null}
export function disband(p){const i=S.parties.indexOf(p);if(i>=0)S.parties.splice(i,1);
  for(const b of p.mem){b.party=null;solo(b,p.home)}p.mem=[]}
export function leaveParty(a){const p=a.party;if(!p)return;p.mem.splice(p.mem.indexOf(a),1);a.party=null;solo(a,p.home);
  if(p.mem.length<2)disband(p)}

// Share a kill: mates within 8 tiles get 60% of the killer's XP and quest credit; log a notable kill.
export function shareKill(a,m,xp){const p=a.party;if(!p)return;
  const near=partyMates(a).filter(b=>dist(a,b)<=8);if(!near.length)return;
  for(const b of near){gainXp(b,xp*.6);if(b.quest&&b.quest.type===m.type&&b.quest.have<b.quest.need){b.quest.have++;wakeQuest(b,b.quest.have>=b.quest.need)}}
  const low=Math.min(...p.mem.map(b=>b.lvl));
  if(m.lvl-low>=4&&rnd()<.6)log(...names([a,...near]),' brought down a level ',String(m.lvl),' ',MOBS[m.type].name,' together.')}

// After a skirmish nobody stands beside the enemy waiting for the next duel: pull back for a moment.
export function regroup(a,foe,next,t=2.5){a.state='regroup';a.regT=t;a.regNext=next||'hunt';a.target=null;
  a.dest=leaderOf(a)?followPt(a):foe?awayPoint(a,foe):zonePoint(a.zone,a)}

function rally(p,b){const foe=b.target;if(!foe)return;let n=0;
  for(const g of p.mem){if(g===b||!(loose(g)||g.state==='return')||dist(g,b)>6)continue;
    g.regNext=g.state==='return'?'return':'hunt';g.state='assist';g.target=foe;g.dest=null;n++}
  p.brawl=true;if(n&&rnd()<.6)log(b,'’s party turns on ',foe,'.')}

// Once per step: membership, leadership, skirmish rally and regroup, heading home, fight joining.
export function partyTick(){
  for(let i=S.parties.length-1;i>=0;i--){const p=S.parties[i];
    for(const b of p.mem.slice()){
      if(b.state==='dead'){disband(p);break}
      if(b.state==='duel'&&!p.brawl)rally(p,b);
      else if(b.state==='dungeon'||b.state==='raid'||(b.state==='town'&&p.home))leaveParty(b)}
    if(!S.parties.includes(p))continue;
    for(const b of p.mem)if(b.lvl>p.leader.lvl||!p.mem.includes(p.leader))p.leader=b;
    const lv=p.mem.map(b=>b.lvl);if(p.company==null&&Math.max(...lv)-Math.min(...lv)>3){disband(p);continue} // a company's party (p.company) holds together across levels
    if(p.brawl&&!p.mem.some(b=>b.state==='assist'||b.state==='duel')){p.brawl=false;const foe=nearestFoe(p.leader,10);
      for(const b of p.mem)if(loose(b))regroup(b,foe)}
    // Heading home: everyone who is loose turns back; followers keep to the leader's side on the way.
    // The party ends as its members reach town (see leaveParty above).
    if(p.mem.some(b=>b.state==='return'))p.home=true;
    if(p.home)for(const b of p.mem)if(b.state==='hunt'||b.state==='travel'||(b.state==='follow'&&!leaderOf(b))){b.state='return';b.target=null;b.dest=null}
    const f=p.mem.find(b=>b.state==='fight'&&b.target&&b.target.alive&&b===p.leader)||p.mem.find(b=>b.state==='fight'&&b.target&&b.target.alive);
    if(f){const m=f.target;for(const b of p.mem){if(b===f||!loose(b)||dist(b,f)>6||b.hp<maxHp(b)*.45)continue;b.state='fight';b.target=m;b.dest=null}}}}
