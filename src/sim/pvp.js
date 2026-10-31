// Open-world PvP: nemesis hunts, chance duels between factions outside
// Thornvale, and guildmates rushing to assist. Tuning: duel range 3 tiles,
// level gap 5, 25% chance per check; nemesis spotted within 8 tiles.
import {rnd} from '../core/rng.js';
import {dist,zoneAt} from '../world/map.js';
import {S} from './state.js';
import {log} from './chronicle.js';
import {tm} from '../data/traits.js';

export function pvpCheck(dt){S.pvpT-=dt;if(S.pvpT>0)return;S.pvpT=.5;const agents=S.agents;
  const free=agents.filter(a=>(a.state==='hunt'||a.state==='travel'||a.state==='return')&&zoneAt(a.x,a.y)>=1);
  const isFree=a=>free.includes(a)&&(a.state==='hunt'||a.state==='travel'||a.state==='return');
  for(const a of free){a.spotCd-=.5;if(!isFree(a)||a.spotCd>0)continue;
    for(const id in a.nemesis){const b=agents.find(x=>x.id==id);
      if(b&&isFree(b)&&dist(a,b)<8){a.state=b.state='duel';a.target=b;b.target=a;a.dest=b.dest=null;a.spotCd=20;
        log(a,' spots ',b,', who killed ',{t:a.nemesis[id],c:'f'+a.fac},', and charges.');break}}}
  for(const a of free)for(const b of free){if(a.fac!==0||b.fac!==1||a.state==='duel'||b.state==='duel')continue;
    if(dist(a,b)<3&&Math.abs(a.lvl-b.lvl)<=5&&rnd()<.25*tm(a,'bold')*tm(b,'bold')){a.state=b.state='duel';a.target=b;b.target=a;a.dest=b.dest=null}}
  for(const a of agents){if(a.state!=='duel'||!a.target)continue;const foe=a.target;
    for(const g of free){if(!isFree(g)||g.guild!==a.guild||dist(g,a)>8||rnd()>.35*tm(g,'loyal'))continue;
      g.state='assist';g.target=foe;g.dest=null;if(rnd()<.6)log(g,' rushes to help guildmate ',a,' against ',foe,'.');break}}}
