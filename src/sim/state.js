// All mutable simulation state in one object, so every sim module and the
// renderer, UI and headless harness read the same world. No DOM here.
import {LAIR} from '../world/map.js';
import {BOSSES} from '../data/bosses.js';

const fresh=()=>({
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
  companies:[],   // companies of 1..PARTY.MAX heroes, id order (sim/company.js, #402); every agent hero rides in exactly one. slotted() is the one with the five places (#588).
  companySeq:0,   // last company id handed out, never reused
  followId:null,  // the company the watcher follows (null = the first)
});
export const S=fresh();
// Back to a brand-new world's state, in place (every module keeps its S and its arrays): init() calls it first (#507).
export function resetS(){const f=fresh();
  for(const k of Object.keys(S))if(!(k in f))delete S[k];
  for(const k in f){const c=S[k],v=f[k];
    if(Array.isArray(c)&&Array.isArray(v)){c.length=0;for(const x of v)c.push(x)}
    else if(k==='boss'&&c&&v){for(const q in c)delete c[q];Object.assign(c,v)}
    else S[k]=v}}

// Save-file format version (sim/save.js). Bump it and add a migration there when the shape of S changes.
export const SAVE_VERSION=7;
// A fresh world instance id. Deliberately not from the seeded rng or Math.random (a stubbed Math.random must not shift), so a seeded world keeps its dice.
export const newWorldId=()=>'w'+Date.now().toString(36)+[...globalThis.crypto.getRandomValues(new Uint8Array(5))].map(b=>b.toString(36).padStart(2,'0')).join('').slice(0,6);
// The world setting others (#780): 'none' = no background heroes, only the setup's and whoever the DM summons. S.setup holds it, so a load keeps it.
export const noOthers=()=>!!(S.setup&&S.setup.others==='none');
// The world setting sides (#1025): 'lore' = Concord and Warband are peoples and history, not sides. S.setup holds it, so a load keeps it; a seeded or
// older world has no such field and every gate reads as before. a.fac stays set on every hero and town as a lore tag.
export const loreSides=()=>!!(S.setup&&S.setup.sides==='lore');
export const sameSide=(a,b)=>loreSides()||a.fac===b.fac; // may these two stand together? Everyone may, in a lore world
export const dayNo=()=>Math.floor(S.gameMin/1440)+1; // game day, 1-based (the UI shows D4 03:12 with it)
export const clockStr=()=>{const m=Math.floor(S.gameMin)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')};
