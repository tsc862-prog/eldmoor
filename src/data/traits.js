// Personality traits: data only. Owned by character-builder; the decision
// logic that reads these modifiers (heroes.js, pvp.js, party.js) belongs to ai-designer.
// Each hero rolls 1-2 traits in makeHero, weighted by class; exclusive pairs never co-occur.
// Modifier keys (a multiplier on a tuning constant, default 1):
//   retreat  hunt go-home HP threshold (45% * retreat)       flee    fight/duel flee threshold (22% / 20% * flee)
//   greed    bag-full size (8 * greed)                        thrift  gear-buy ceiling (lvl + 2 * thrift)
//   bold     chance-duel odds (both duelists multiply in)     loyal   odds of answering a guildmate's duel (35% * loyal)
//   social   0 = never forms or joins a party                 mercy   priest heal threshold (55% * mercy): heals sooner
import {rnd,pickA} from '../core/rng.js';

export const TRAITS={
  Reckless:{desc:'Fights on when wiser heads would run, and calls it courage.',mods:{retreat:.7,flee:.6,bold:1.5}},
  Cautious:{desc:'Counts the exits before the enemies, and leaves while both are still open.',mods:{retreat:1.25,flee:1.4,bold:.6}},
  Greedy:{desc:'Never comes home while the bag has room, and buys gear only when the gold starts to itch.',mods:{greed:1.5,thrift:.8}},
  Loyal:{desc:'Drops whatever they are doing when a guildmate shouts.',mods:{loyal:1.6}},
  Loner:{desc:'Leaves the gate alone and likes it that way.',mods:{social:0,bold:1.1}},
  Vengeful:{desc:'Keeps a list. Everyone on it is on it for good.',mods:{bold:1.2,loyal:1.2}},
  Pious:{desc:'Tends the wounded before the wounds are grave, and does not stay to be martyred.',mods:{mercy:1.25,flee:1.2,loyal:1.3}},
  Boastful:{desc:'Picks fights for the story, and loots for the audience.',mods:{bold:1.2,greed:1.1}},
};
export const TRAITN=Object.keys(TRAITS);
// Traits that never share a hero.
const EXCL=[['Reckless','Cautious'],['Loyal','Loner']];
// Class leanings: weight per trait (unlisted traits weigh 1).
const LEAN={Rogue:{Reckless:3,Greedy:3},Priest:{Cautious:3,Loyal:2,Pious:3},Warrior:{Loyal:3,Reckless:2},Mage:{Cautious:2,Boastful:2},Hunter:{Loner:2,Greedy:2}};

function weighted(pool,cls){const w=pool.map(t=>(LEAN[cls]||{})[t]||1);let r=rnd()*w.reduce((s,x)=>s+x,0);
  for(let i=0;i<pool.length;i++){r-=w[i];if(r<0)return pool[i]}return pool[pool.length-1]}
const clash=(t,u)=>EXCL.some(([x,y])=>(t===x&&u===y)||(t===y&&u===x));

// One trait always, a second half the time.
export function rollTraits(cls){const first=weighted(TRAITN,cls);const out=[first];
  if(rnd()<.5){const pool=TRAITN.filter(t=>t!==first&&!clash(t,first));if(pool.length)out.push(weighted(pool,cls))}return out}

// Product of the hero's trait modifiers for a key; 1 when no trait touches it.
export function tm(a,key){let m=1;if(a.traits)for(const t of a.traits){const v=TRAITS[t].mods[key];if(v!==undefined)m*=v}return m}

// "reckless and greedy", for the Chronicle.
export const traitPhrase=a=>a.traits.map(t=>t.toLowerCase()).join(' and ');
