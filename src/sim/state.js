// All mutable simulation state in one object, so every sim module and the
// renderer, UI and headless harness read the same world. No DOM here.
import {LAIR} from '../world/map.js';
import {GUILD_DEFS} from '../data/factions.js';

export const S={
  agents:[],      // heroes, living and dead (graves are recycled past 40)
  mobs:[],
  fx:[],          // transient effects: damage text, bolts, boss rings
  fallen:[],      // graveyard entries, newest first, capped at 15
  recruits:[],    // pending replacements for the dead
  parties:[],     // hero parties {id, fac, leader, mem, zone, home}; each member has a.party
  chronicle:[],   // log entries {t, parts}, newest first, capped at 90
  boss:{kind:'boss',name:'Kragmaw',x:LAIR.x,y:LAIR.y+.6,lvl:18,maxhp:9000,hp:9000,alive:true,respawn:0,cd:0,breath:7,dmg:[0,0],face:-1},
  GUILDS:GUILD_DEFS.map(g=>({...g,clears:0,wipes:0,bosses:0})),
  facStats:[{honor:0,bosses:0,fallen:0},{honor:0,bosses:0,fallen:0}],
  raidOn:[false,false],raidT:40,pvpT:0,mktT:0,
  gameMin:15*60,  // game clock in minutes; 1 real second at 1x = 6 game minutes
  uid:0,
  pinned:null,    // the hero the watcher is following; its grave is never recycled
};
export const clockStr=()=>{const m=Math.floor(S.gameMin)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')};
