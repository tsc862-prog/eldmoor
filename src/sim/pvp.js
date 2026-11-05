// Open-world PvP: nemesis hunts, chance duels between factions outside
// Thornvale, and guildmates rushing to assist. Tuning: duel range 3 tiles,
// level gap 5, 25% chance per check; nemesis spotted within 8 tiles.
// Every "who is near this hero" question goes through the spatial grid (sim/spatial.js);
// candidates come back id-ascending, the same order the old whole-roster loops used, so
// per-candidate dice rolls and first-match breaks behave exactly as before.
import {rnd} from '../core/rng.js';
import {dist,zoneAt} from '../world/map.js';
import {S} from './state.js';
import {log} from './chronicle.js';
import {say,duelBark} from './chat.js';
import {sightMul} from './weather.js';
import {tm} from '../data/traits.js';
import {record} from './history.js';
import {bondEvent,grudgeOf} from './bonds.js';
import {ZONES} from '../world/map.js';
import {nearHeroes} from './spatial.js';
import {clearLine} from './path.js'; // no duel across a river or a wall (#794)
import {held} from './scenes.js'; // the engaged of a live-clock Table scene (#518)
import {rivalMul,rivalCount} from './rivals.js';
import {duelFocus,assistFocus,focusCount} from './guildfocus.js';
import {inSlots} from './company.js'; // the slotted company (#588)
import {owes,mercyTick,debtTick,mercyCount} from './mercy.js'; // finish or spare, life-debts (#657)

export function pvpCheck(dt){S.pvpT-=dt;if(S.pvpT>0)return;S.pvpT=.5;const agents=S.agents;
  mercyTick();debtTick(); // a victor's choice over a downed enemy, and life-debts repaid (sim/mercy.js)
  const free=agents.filter(a=>(a.state==='hunt'||a.state==='travel'||a.state==='return')&&zoneAt(a.x,a.y)>=1&&!held(a)); // held in a scene (#518): no duels
  const freeSet=new Set(free);
  const isFree=a=>freeSet.has(a)&&(a.state==='hunt'||a.state==='travel'||a.state==='return');
  // Nemesis: the lowest-id free hero in sight who is on this hero's grudge list (nemesis keys are ids, iterated ascending).
  for(const a of free){a.spotCd-=.5;if(!isFree(a)||a.spotCd>0)continue;const r=8*sightMul(zoneAt(a.x,a.y));
    for(const b of nearHeroes(a.x,a.y,r)){const id=b.id;if(!a.nemesis[id]||!isFree(b)||dist(a,b)>=r||!clearLine(a,b))continue;if(owes(a,b)){mercyCount('held');continue} // a life owed holds the blade
      a.state=b.state='duel';a.target=b;b.target=a;a.dest=b.dest=null;a.spotCd=45;
      log(a,' spots ',b,', who killed ',grudgeOf(a,id),{t:a.nemesis[id],c:'f'+a.fac},', and charges.');break}}
  // Chance duels: each free Concord hero rolls against every free Warband hero within 3 tiles (sight-scaled), in id order.
  for(const a of free){if(a.fac!==0)continue;const r=3*sightMul(zoneAt(a.x,a.y));
    for(const b of nearHeroes(a.x,a.y,r)){if(!freeSet.has(b)||b.fac!==1||a.state==='duel'||b.state==='duel'||owes(a,b)||owes(b,a))continue;
      if(dist(a,b)<r&&Math.abs(a.lvl-b.lvl)<=2&&clearLine(a,b)){const rm=rivalMul(a,b,'duel'),fm=duelFocus(a,b); // declared guild rivals duel more often (sim/rivals.js), as do Warpath guilds (sim/guildfocus.js)
        if(rnd()<.03*tm(a,'bold')*tm(b,'bold')*rm*fm){a.state=b.state='duel';a.target=b;b.target=a;a.dest=b.dest=null;if(rm>1)rivalCount('duels');if(fm>1)focusCount('duels')}}}}
  for(const a of agents){if(a.state==='duel'&&a.target){if(a.histDuel!==a.target){a.histDuel=a.target;record(a,'Dueled ',a.target,' in '+ZONES[zoneAt(a.x,a.y)]+'.')}}else a.histDuel=null}
  for(const a of agents)if(a.state==='duel'&&a.target)duelBark(a,a.target);
  // Assists: free guildmates within 8 tiles of a dueller roll to rush in; the first to pass goes.
  for(const a of agents){if(a.state!=='duel'||!a.target)continue;const foe=a.target;
    const rm=g0=>inSlots(g0)?1:rivalMul(a,foe,'assist')*assistFocus(g0,foe); // against a declared rival guild, or in a Warpath guild (sim/guildfocus.js), guildmates rush in more readily
    for(const g of nearHeroes(a.x,a.y,8)){if(!isFree(g)||!a.guild||g.guild!==a.guild||dist(g,a)>8||owes(g,foe)||rnd()>.2*tm(g,'loyal')*rm(g))continue;if(rivalMul(a,foe,'assist')>1&&!inSlots(g))rivalCount('assists');if(!inSlots(g)&&assistFocus(g,foe)>1)focusCount('assists');
      say(g,'assist',{target:a.name});
      bondEvent(g,'assist',[a]);g.state='assist';g.target=foe;g.dest=null;if(rnd()<.6)log(g,' rushes to help guildmate ',a,' against ',foe,'.');break}}}
