// The pack (#1013, slice 2): the live map's state moves into S.maps[id] when a company leaves it and back when one returns. Live state
// is flat on S everywhere else, so nothing reads S.maps but this file, atlas.js (who is away) and save.js (the campaign in the save).
// switchMap is the one door; slice 3's cross() wraps it. Nothing here runs in a world that never leaves its map: S.maps stays absent.
//
// A frozen map, S.maps[id]: {left, mapRev?, <the keys of MAP_KEYS it held>, agents, dead, crypts:{<name>:{group, cd}}, kept}.
// Its entities stay live objects, so whatever names them (a chronicle line, a guild, a hero's nemesis) still does; save.js writes them
// by reference as it does the live map's. Who stays out of it: heroes who ride with a company and those who share a party with one.
//   agents  the living heroes left behind, history capped at FROZEN_HISTORY, and dead company heroes and the watched hero, whole.
//   dead    every other dead hero, cut down in place to a stub (STUB): what graves, the Chronicle and references need. They never go
//           back on S.agents: a stub is a recycled grave, which every reader already takes, and S.graves keeps the stone.
// Three keys are split (SPLIT): the part that counts the DM's day or paces the DM stays on S for the campaign.
// SUMMON.ALIVE reads S.agents, so the cap is 8 a map: frozen summons do nothing, and summon_hero's daily cap stays campaign-wide with the levers.
import {S,freshValue,dayNo,inCompany} from './state.js';
import {homeOf} from '../data/races.js';
import {CRYPTS,MAP_ID,setWorld,zoneAt,zoneFor} from '../world/map.js';
import {MAPS} from '../world/spec.js';
import {MAP_KEYS,KEPT_MAP} from './atlas.js';
import {keptState,restoreKept} from './kept.js';
import {spawnAll} from './mobs.js';
import {dmlog} from './dmlog.js';
import {forgetFight} from './company.js';

export const FROZEN_HISTORY=8; // a frozen hero's log lines; a hero's log is the heaviest thing in a frozen map (346 of 968 KiB on the Vale's day 51)
const STUB=new Set(['kind','id','name','fac','cls','lvl','state','cause','diedAt','town','race','skin','hair','x','y','guild','epithet']);

// The keys with a campaign part. out() takes the map's part off S and returns it; in(m) puts a frozen part back.
// levers: the daily counts (day.d, n, nf), seq, stats and cooldowns by bare name are the DM's; day.rz and "name:<region>" cooldowns index
// this map's regions, and active is what is in force on this land. rz is good only on the day it was counted. ecoT, a five-second pass
// over whatever map is live, stays where it is.
const ownCd=k=>k.includes(':');
const SPLIT={
  levers:{out(){const L=S.levers,cd={};for(const k of Object.keys(L.cd))if(ownCd(k)){cd[k]=L.cd[k];delete L.cd[k]}
      const m={active:L.active,cd,rz:L.day.rz||{},d:L.day.d};L.active=[];L.day.rz={};return m},
    in(m){const L=S.levers;L.active=m.active;Object.assign(L.cd,m.cd);L.day.rz=L.day.d===m.d?m.rz:{}}},
  dmSeen:{out(){const m={enc:S.dmSeen.enc};S.dmSeen.enc={};return m},in(m){S.dmSeen.enc=m.enc}}, // dead: ids are the campaign's, and a death is hooked once
  worldEvent:{out(){const w=S.worldEvent;if(!w)return undefined;const m={cur:w.cur,done:w.done};delete w.cur;w.done=[];return m}, // lastEnd stays: the cooldown between events paces the DM, not the land
    in(m){const w=S.worldEvent||(S.worldEvent={lastEnd:null,done:[]});w.done=m.done||[];if(m.cur)w.cur=m.cur;else delete w.cur}},
};

// Who goes where the company goes: the living heroes who ride with one, and anyone in a party with them (a party moves as one).
function crossers(){const go=new Set(S.agents.filter(a=>a.state!=='dead'&&inCompany(a)));
  for(const a of [...go])if(a.party)for(const b of a.party.mem)go.add(b);return go}
const whole=a=>a===S.pinned||a.company!=null||!!a.player||a.companion!=null;
function stub(a){for(const k of Object.keys(a))if(!STUB.has(k))delete a[k];return a}
function capHistory(a){if(a.history&&a.history.length>FROZEN_HISTORY)a.history.splice(0,a.history.length-FROZEN_HISTORY)}

// Empties a map key on S: an array S always holds keeps its identity (restore's rule), a key lazily made is simply gone.
function empty(k){const f=freshValue(k);if(f===undefined){delete S[k];return}
  if(Array.isArray(S[k])&&Array.isArray(f)){S[k].length=0;S[k].push(...f)}else S[k]=f}
function put(k,v){if(Array.isArray(S[k])&&Array.isArray(v)){S[k].length=0;S[k].push(...v)}else S[k]=v}

// Take the live map off S. The caller changes the map next (setWorld rebuilds the dungeons, and its hook gives S a new boss).
export function packMap(){const id=MAP_ID,spec=MAPS[id],m={left:S.gameMin};if(spec&&spec.rev)m.mapRev=spec.rev;
  const go=crossers(),rest=S.agents.filter(a=>!go.has(a));
  m.agents=[];m.dead=[];
  for(const a of rest){if(a.state==='dead'&&!whole(a))m.dead.push(stub(a));else{capHistory(a);m.agents.push(a)}}
  S.agents.length=0;S.agents.push(...go);S.agents.sort((a,b)=>a.id-b.id);
  const riding=S.parties.filter(p=>p.mem.some(a=>go.has(a)));m.parties=S.parties.filter(p=>!riding.includes(p));
  S.parties.length=0;S.parties.push(...riding);
  for(const k of MAP_KEYS){if(k==='fx'){S.fx.length=0;continue}
    if(k==='parties')continue;
    if(k==='boss'){m.boss=S.boss;continue}
    if(SPLIT[k]){if(S[k]){const v=SPLIT[k].out();if(v!==undefined)m[k]=v}continue}
    if(!(k in S))continue;
    m[k]=Array.isArray(S[k])&&Array.isArray(freshValue(k))?S[k].slice():S[k];empty(k)}
  m.crypts={};for(const D of CRYPTS)m.crypts[D.name]={group:D.group,cd:D.cd}; // setWorld rebuilds the dungeons, so what is in them rides here
  const K=keptState();m.kept={};for(const k of KEPT_MAP){m.kept[k]=K[k]}
  restoreKept(Object.fromEntries(KEPT_MAP.map(k=>[k,0]))); // both are timers; a map new to the world starts them over
  (S.maps||(S.maps={}))[id]=m;return m}

// Put a frozen map back on S, into the bindings setWorld already gave the world module.
export function unpackMap(id){const m=S.maps[id];
  S.agents.push(...m.agents);S.agents.sort((a,b)=>a.id-b.id); // heroes are made in id order and only ever leave, so this is the order they stood in
  S.parties.push(...m.parties);S.parties.sort((a,b)=>a.id-b.id);
  for(const k of MAP_KEYS){if(k==='fx'||k==='parties')continue;
    if(k==='boss'){S.boss=m.boss;continue}
    if(SPLIT[k]){if(k in m)SPLIT[k].in(m[k]);continue}
    if(k in m)put(k,m[k]);else empty(k)}
  for(const D of CRYPTS){const s=m.crypts[D.name];if(s){D.group=s.group;D.cd=s.cd}}
  restoreKept(m.kept);
  delete S.maps[id];if(!Object.keys(S.maps).length)delete S.maps;
  catchUp(S.gameMin-m.left);return m}

// A map the campaign has not seen: its creatures, and everything else its own ticks make when they first run. No background heroes in
// this slice: the crossing decides who a new map holds. A world with no others (#780) stays as empty as it asked to be.
function initMap(){spawnAll()}

// Time on a frozen map waits: nobody levels, nothing walks. On entry the timers that count down real seconds at 1x lose the time gone,
// clamped at zero (6 game minutes a second). What is stamped in gameMin (marks, places, rumours, nodes, the eco's cooldowns) lapses by itself.
export function catchUp(elapsed){const dt=Math.max(0,elapsed)/6;if(!dt)return;
  const down=(o,k)=>{if(o&&typeof o[k]==='number'&&o[k]>0)o[k]=Math.max(0,o[k]-dt)};
  for(const D of CRYPTS)down(D,'cd');
  down(S.boss,'respawn');down(S,'raidT');down(S,'dmHookT');down(S.eco,'t');down(S.eco,'eliteT');
  for(const r of S.recruits)down(r,'t');
  for(const x of S.mobs)if(!x.alive)down(x,'respawn')}

// Those who go leave whatever held them here: a fight, a path, a place to walk to. What hunted them loses them.
function letGo(go){for(const a of go){a.target=null;a.dest=null;a.path=null;a.moving=false;if(a.state==='fight'||a.state==='return'||a.state==='travel')a.state='hunt';forgetFight(a)}
  for(const m of S.mobs)if(go.has(m.target))m.target=null}

// Leave the live map for another: pack, switch, then unpack it or build it. Those who go stand at at ({x, y}), else at their home's gate.
// A frozen map whose ground was cut again since (spec.rev) cannot be put back: its people stood on land that no longer exists, so the map
// starts again and the DM log says so.
export function switchMap(to,at){if(to===MAP_ID)return false;if(!MAPS[to])throw new Error('switchMap: no map '+to);
  const go=crossers();letGo(go);packMap();setWorld(to);
  const m=S.maps&&S.maps[to];
  if(m&&(m.mapRev||0)!==(MAPS[to].rev||0)){delete S.maps[to];if(!Object.keys(S.maps).length)delete S.maps;
    dmlog('agent',null,['The land of '+MAPS[to].name+' was drawn anew since anyone was last there (day '+dayNo()+'): those left on it are gone from the story.'],{by:'dm-agent',notice:true});initMap()}
  else if(m)unpackMap(to);else initMap();
  for(const a of go){const p=at||homeOf(a).gate;a.x=p.x;a.y=p.y;a.zone=zoneAt(p.x,p.y)}
  for(const p of S.parties)if(go.has(p.leader))p.zone=zoneFor(Math.min(...p.mem.map(b=>b.lvl)),homeOf(p.leader).gate); // a region index means nothing on the next map
  return true}
