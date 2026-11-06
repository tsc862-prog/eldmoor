// Boss templates (issue #84). Pure data; sim/boss.js reads Kragmaw's, the crawl rework (#65) will read
// Vesk's. Owned by creature-designer.
//   maxhp, lvl, respawn (s)   the body
//   attack {cd, dmg:[base,spread]}   the plain blow: dmg = base + rnd * spread, one random raider each cd seconds
//   abilities[]   signature moves: fx 'breath' (everyone within radius), 'fear' (raiders lose lose seconds
//                 of attack timer), 'summon' (adds), 'drain' (damage to one raider, boss mends a share);
//                 cd seconds, dmg [base, spread], tag the damage type
//   phases[]   ordered by `at`, the boss hp share the phase begins at (1 = from the pull). A phase may
//              change the blows: hit (x damage), cd (x attack interval), say (Chronicle line on entry),
//              adds {type, n, max} (summoned when the phase begins and every `every` seconds)
//   enrage {after, hit}   after `after` seconds engaged the damage is multiplied by `hit` (null: none)
//   loot {xp, gold, epics[], p, src}   per raider on a kill; p is the chance of one of epics
// Kragmaw's numbers are the rebalance baseline: one phase, no adds, no enrage, hit 55-85 every 1.6 s,
// breath 22-30 every 7 s within 4.6 tiles, 9000 hp, 300 s to wake. Do not change them without a
// balance-tester report.
import {BOSS_EPICS, DG_EPICS} from './items.js';
import {WORDS} from '../world/words.js';

export const BOSSES={
  kragmaw:{
    id:'kragmaw',name:'Kragmaw',full:'Kragmaw the Cinder Wyrm',family:'wyrm',lvl:20,maxhp:13000,respawn:600,
    wake:' stirs again in its '+WORDS.lairRegion+' lair.',
    attack:{cd:1.6,dmg:[55,30]},
    abilities:[{id:'cinderbreath',fx:'breath',cd:7,dmg:[22,8],radius:4.6,tag:'fire',color:'#ffa040',name:'Cinder Breath'}],
    phases:[{at:1,name:'The lair'}],
    enrage:null,
    loot:{xp:400,gold:40,epics:BOSS_EPICS,p:.4,src:'Kragmaw'},
  },
  // The Sunken Crypt's lich. Not yet fought by the sim (the Crypt resolves by dice); the crawl rework
  // (#65) fights it with this. Sized for a group of 4-5 at level 9-12: about 3000 hp, hits of 18-30.
  vesk:{
    id:'vesk',name:'Vesk',full:'Lich-Warden Vesk',family:'undead',lvl:12,maxhp:3000,respawn:600,
    wake:' stirs beneath '+WORDS.crypt+'.',
    attack:{cd:1.8,dmg:[18,12]},
    abilities:[
      {id:'gravechill',fx:'drain',cd:9,dmg:[14,6],tag:'cold',name:'Grave Chill',heal:.5},
      {id:'warddread',fx:'fear',cd:16,lose:2.2,tag:'holy',name:'Warden’s Dread'}],
    phases:[
      {at:1,name:'The Warden'},
      {at:.55,name:'The Drowned Court',hit:1.15,cd:.9,adds:{type:'graveward',n:1,max:2,every:30},say:'The water in the crypt stands still, and the dead stand up in it.'},
      {at:.2,name:'Unbound',hit:1.3,cd:.8,say:'Vesk tears the phylactery from his own chest.'}],
    enrage:{after:240,hit:1.5},
    loot:{xp:250,gold:25,epics:DG_EPICS,p:.25,src:'Lich-Warden Vesk'},
  },
};

// The phase a boss is in at `share` of its hp (last phase whose threshold has been crossed).
export function phaseOf(T,share){let p=T.phases[0];for(const x of T.phases)if(share<=x.at)p=x;return p}
