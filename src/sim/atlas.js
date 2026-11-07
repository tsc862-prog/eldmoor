// The atlas (#1013): one campaign, one live map, the others frozen as data. It says what belongs where and who is away; the pack and
// the unpack are sim/mappack.js, the crossing itself sim/crossing.js. Every key of S is in exactly one table below: a key the crossing
// would not know how to treat is a bug waiting on the first road between two maps, so npm run crossingcheck fails on a new key until
// it is placed here. Live state stays flat on S; only a crossing moves it, so nothing here runs in a world that never leaves its map.
// A leaf: nodes.js and outposts.js read mapKey, guilds.js and legends.js read who is away, player.js the roads (sim/crossing.js is the crossing).
import {S,ownTown} from './state.js';
import {MAP_ID,WORLD_ID,EXITS,CITY,ZONES,dist} from '../world/map.js';
import {MAPS} from '../world/spec.js';

// Frozen with a map: packed into the campaign when the company leaves, unpacked when it comes back.
export const MAP_KEYS=[
  'mobs','boss','fx',
  'dunRec',                                                 // beside the world module's CRYPT and CRYPTS group and cd
  'levers','places','marks','conditions','wanderers','customFoes', // the DM's marks on this land; levers, dmSeen and worldEvent are split: see SPLIT in sim/mappack.js
  'npcs','npcNews','rumours','notices','sightings','traffic','weather',
  'encounters','encNext','nodes','outposts','sites','graves','statues',
  'adventures','bounties','dmT','dmHookT','dmSeen','dmRemnants','supply','supplyAt', // the scripted DM's boards and what they ask of this map's towns
  'zoneLastHero','worldEvent','eco','raidOn','raidName','raidT','pvpT',
  'parties','recruits',                                     // with the heroes in no company, who freeze too
];
// Crosses with the company: heroes in a company go where it goes (those in none leave S.agents and freeze with their map).
export const COMPANY_KEYS=[
  'agents','companies','companySeq','followId','pinned','offerSeq',
  'table','tables','tableLog','staged','rulings','talks','challenges','challengeSeq','gambitHold','downCalls', // none open at a crossing, by its holds
  'dmAgent','opening',
];
// Lives once for the campaign, whichever map is on screen.
export const CAMPAIGN_KEYS=[
  'gameMin','setup','worldId','uid','maps','worldVoice','pauseAll','brainOn','brainHeroes','playerHeroes',
  'GUILDS','guildSeq','guildT','rivals','focusT','facStats','fallen','legends','hireAway','hireWary','companiesPast',
  'chronicle','timeline','tlFirsts','dmLog','dmLogSeq','dmClock','nar','compVoice','narrVoice',
  'listings','listingId','trades','mktT','goals','goalT','bondT','vowSeq','sightSeq','noticeSeq',
  'bondStats','craftStats','dmFocus','dmStats','downStats','encStats','focusStats','gambitStats','gatherStats','guildStats','invStats','mercyStats','moveStats','narStats','patchStats','supplyStats','tradeStats','woundStats',
];
// What modules keep outside S (kept.js): the same three ways, with the private dice and the per-hero watch campaign-wide.
export const KEPT_MAP=['locals','memorials'];
export const KEPT_CAMPAIGN=['chat','levers','npcs','staged','table','talk','watch','slots'];

const WHERE=new Map([...MAP_KEYS.map(k=>[k,'map']),...COMPANY_KEYS.map(k=>[k,'company']),...CAMPAIGN_KEYS.map(k=>[k,'campaign'])]);
export const keyClass=k=>WHERE.get(k)||null;
// The keys of S (or of any list given) nobody has placed.
export const unclassified=(keys=Object.keys(S))=>keys.filter(k=>!WHERE.has(k));

// The id per-map state is stamped with (S.nodes, S.outposts): the world instance, plus the map when it is not the campaign's first.
// A world on its first map keeps the stamp it always had, so old saves and seeded hashes read the same; S.worldId alone would let
// another map take the first's state, and MAP_ID alone would let a new world take an old one's.
export const mapKey=()=>MAP_ID===WORLD_ID?S.worldId:S.worldId+':'+MAP_ID;

// ---- who is away ----
// S.maps holds the frozen maps, by id, as sim/mappack.js leaves them; absent in a world that never left its map, so these are free there.
// A frozen hero is not in S.agents: nothing steps it and no scan finds it. Campaign-wide records that name one (a guild's roll, the
// Legends hall) ask here before they read "not in S.agents" as "gone".
export const frozenMaps=()=>S.maps?Object.values(S.maps):[];
export const frozenHeroes=()=>frozenMaps().flatMap(m=>m.agents||[]);
export const isAway=id=>!!S.maps&&frozenHeroes().some(a=>a.id==id);
// How many living members a guild has on frozen maps. A guild with people away holds still: no new leader, no split, no dwindling, since
// a roll read from the live map alone would call them gone.
export const awayIn=g=>S.maps?frozenHeroes().filter(a=>a.guild===g&&a.state!=='dead').length:0;

// ---- the roads between maps (#1013 slice 3) ----
// Exits are data (spec.exits, EXITS); a road with no map behind it is closed. A place "beyond" a road is what its far map is known by.
export const exitById=id=>EXITS.find(e=>e.id===id)||null;
export const exitOpen=e=>!!(e&&e.to&&e.to.map&&MAPS[e.to.map]);
export const mapName=id=>MAPS[id]&&MAPS[id].name||id;
export const closedRoad=e=>e.name.charAt(0).toUpperCase()+e.name.slice(1)+' runs on past the last milestone. Nobody here has walked it, and the way is not yet open.';
export function beyond(e){const m=exitOpen(e)?MAPS[e.to.map]:null;if(!m)return [];
  return [m.name,...(m.towns||[]).map(t=>t.name),...(m.regions||[]).map(r=>r.name),...(m.landmarks||[]).map(l=>l.name)].filter(Boolean)}
const folded=s=>String(s==null?'':s).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/^the /,'');
// The road these words name: by its own name, else by a place beyond it (knows: which of those the speaker may use), or null.
export function exitNamed(text,knows=()=>true){if(!EXITS.length)return null;const t=' '+folded(text)+' ',has=n=>t.includes(' '+folded(n)+' ');
  return EXITS.find(e=>has(e.name))||EXITS.find(e=>beyond(e).some(n=>knows(n)&&has(n)))||null}

// What the crossing waits on, C.road (sim/crossing.js). Only the leader's own words make one: an order or an aim that names the road, as
// it is given, so autopilot carrying an old aim and a company hunting near the map's edge never open the scene (the review's first point).
// {exit, by, at, aim?}: by the leader, aim the number of the aim that named it (an order has none). A plain command elsewhere ends an
// order's road, not an aim's: the aim still says where they are going. A new aim that names no road ends either.
const ROAD_ORDERS=new Set(['move_to','lead_to','hunt','follow','rest','go_crypt','join_raid','enter_site','take_adventure']);
export function roadWord(a,C,ld,tool,args,r){if(!EXITS.length||!C||a!==ld||r&&r.dropped)return;const aim=tool==='intent';if(!aim&&!ROAD_ORDERS.has(tool))return;
  if(aim&&!args)return;const R=C.road;if(R&&R.phase)return; // at the table, or the vote taken: the road is settled there
  if(aim&&args.goal==null&&!args.done)return; // the tool's read
  const text=aim?args.goal:tool==='move_to'||tool==='lead_to'?args&&args.target:null,e=text?exitNamed(text):null;
  if(e&&exitOpen(e)){C.road={exit:e.id,by:a.id,at:Math.round(S.gameMin),...(aim&&a.intent?{aim:a.intent.n}:{})};return}
  if(R&&(aim||R.aim==null))delete C.road}
// An aim's road holds while that aim does; arriving ends an aim, so only its time running out takes the road with it.
export function roadHolds(R,ld){if(R.aim==null)return true;const I=ld.intent;return !!I&&I.n===R.aim&&!(I.done&&I.untilAt!=null&&S.gameMin>=I.untilAt)}
const companyById=id=>(S.companies||[]).find(C=>C.id===id)||null;
// The turn header's line while a company stands at its road and something holds it (sim/pace.js).
export function crossingBrief(a){const C=a.company!=null?companyById(a.company):null,h=C&&C.road&&C.road.hold;if(!h)return {};
  return {crossing_waits:(h.away||[]).includes(a.id)&&h.come?h.come:h.text}}
// The DM's view (dm_status.crossing), and the banner's in slice 4: who stands at which road, and what it waits on.
export function crossingView(){const C=(S.companies||[]).find(x=>x.road);if(!C)return null;const R=C.road,e=exitById(R.exit);
  return {company:C.name||null,road:e?e.name:null,phase:R.phase||'walking',...(R.hold?{waits:R.hold.text}:{})}}
// The DM's view of the campaign (dm_status.campaign): the map on screen, the maps walked so far, the roads off this one.
export function campaignMaps(){const fz=S.maps?Object.keys(S.maps):[],pk=S.dmAgent&&S.dmAgent.when&&S.dmAgent.when.parked||{};
  return {map:MAP_ID,map_name:mapName(MAP_ID),visited:[MAP_ID,...fz].map(mapName),roads:EXITS.map(e=>({name:e.name,open:exitOpen(e),...(exitOpen(e)?{to:mapName(e.to.map),walked:fz.includes(e.to.map)}:{})})),
    ...(Object.keys(pk).length?{waiting_on_other_maps:Object.fromEntries(Object.keys(pk).map(id=>[mapName(id),pk[id].list.length]))}:{})}}

// ---- what does not cross with a map ----
// A region index belongs to one map. An oath sworn on one keeps its place by name when its hero crosses (markOathMap), so the same number
// on the next map is not the place sworn to: oathZone answers only on the map it was sworn on. A goal with no stamp is of this map.
export function markOathMap(a){const g=a.goal;if(g&&typeof g.zone==='number'&&!g.zoneMap){g.zoneMap=MAP_ID;g.zoneName=ZONES[g.zone]}}
export const oathZone=g=>g&&g.zone!=null&&(!g.zoneMap||g.zoneMap===MAP_ID)?g.zone:null;
export const oathZoneName=g=>g.zoneMap&&g.zoneMap!==MAP_ID?g.zoneName:ZONES[g.zone];
// The town a name means on this map: itself, else (a hall left on another map) the nearest town that takes this hero in.
export function townNear(name,a){if(!name||!a||CITY.some(c=>c.name===name))return name;const L=CITY.filter(c=>ownTown(c,a)),P=L.length?L:CITY;let b=null,bd=1e9;
  for(const c of P){const d=dist(a,c.gate);if(d<bd){bd=d;b=c}}return b?b.name:name}
