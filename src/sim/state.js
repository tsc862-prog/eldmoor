// All mutable simulation state in one object, so every sim module and the
// renderer, UI and headless harness read the same world. No DOM here.
import {LAIR} from '../world/map.js';
import {BOSSES} from '../data/bosses.js';

export const S={
  worldVoice:'dm', // issue #164: 'dm' = background heroes and townsfolk say no scripted lines (only the DM voices world characters who meet the Fellowship); 'scripted' brings the old barks back (Settings)
  agents:[],      // heroes, living and dead (graves are recycled past 40)
  mobs:[],
  fx:[],          // transient effects: damage text, bolts, boss rings
  fallen:[],      // graveyard entries, newest first, capped at 15
  recruits:[],    // pending replacements for the dead
  parties:[],     // hero parties {id, fac, leader, mem, zone, home}; each member has a.party
  timeline:[],    // world events {t, gameMin, kind, parts}, newest first, capped at 200 (sim/history.js)
  dmLog:[],       // DM log entries, newest first, capped at 200 (sim/dmlog.js)
  chronicle:[],  // log entries {t, parts}, newest first, capped at 90
  boss:{kind:'boss',tpl:'kragmaw',name:'Kragmaw',x:LAIR.x,y:LAIR.y+.6,lvl:BOSSES.kragmaw.lvl,maxhp:BOSSES.kragmaw.maxhp,hp:BOSSES.kragmaw.maxhp,alive:true,respawn:0,cd:0,breath:7,dmg:[0,0],face:-1},
  GUILDS:[],      // guilds founded by the heroes (sim/guilds.js); retired ones stay with retired:true
  guildSeq:0,     // last guild id handed out, never reused
  facStats:[{honor:0,bosses:0,fallen:0},{honor:0,bosses:0,fallen:0}],
  raidOn:[false,false],raidT:40,pvpT:0,mktT:0,
  gameMin:15*60,  // game clock in minutes; 1 real second at 1x = 6 game minutes
  uid:0,
  worldId:'',     // one id per world instance, new at init() and kept by saves; hosts use it to tell a new world from a reload (memory mirror purge). Not simulation state: never read by step().
  pinned:null,    // the hero the watcher is following; its grave is never recycled
};
// Save-file format version (sim/save.js). Bump it and add a migration there when the shape of S changes.
export const SAVE_VERSION=6;
// A fresh world instance id. Deliberately not from the seeded rng, so a seeded world keeps its dice.
export const newWorldId=()=>'w'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
export const dayNo=()=>Math.floor(S.gameMin/1440)+1; // game day, 1-based (the UI shows D4 03:12 with it)
export const clockStr=()=>{const m=Math.floor(S.gameMin)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')};
