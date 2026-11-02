// What a slain creature leaves behind, read from its bestiary block (issue #84): its trade good, a little
// gold, a chance of a slot item (gear.js rollDrop) and a small chance of a zone epic. Named elites add
// their guaranteed epic in killMob. Summoned kin leave nothing. Owned by creature-designer.
import {rnd,pickA} from '../core/rng.js';
import {MOBS} from '../data/mobs.js';
import {EPICS} from '../data/items.js';
import {blockOf} from '../data/bestiary.js';
import {rollDrop} from './gear.js';
import {getEpic} from './heroes.js';
import {wakeLoot} from './wakes.js';
import {addGood,lootSupply} from './inv.js';

// Average payout per kill matches the old flat rolls: the good 72%, gold 0-0.6 x level, an item 6%, an epic 0.6%.
export function rollLoot(a,m){if(m.add)return;const M=MOBS[m.type],B=blockOf(m.type,m.v,m.role),L=B.loot;
  if(rnd()<L.p){addGood(a,M.loot);wakeLoot(a,M.loot)}
  a.gold+=Math.max(1,Math.round(m.lvl*.6*rnd()*L.gold));
  rollDrop(a,m,{rate:L.gear});lootSupply(a,m); // a potion, bandage or other supply (data/items.js USES)
  if(rnd()<L.epic)getEpic(a,pickA(EPICS[M.z]),'a '+(m.name||M.name))}
