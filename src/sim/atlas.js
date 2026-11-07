// The atlas (#1013): one campaign, one live map, the others frozen as data. It says what belongs where and who is away; the pack and
// the unpack are sim/mappack.js, the crossing itself sim/crossing.js. Every key of S is in exactly one table below: a key the crossing
// would not know how to treat is a bug waiting on the first road between two maps, so npm run crossingcheck fails on a new key until
// it is placed here. Live state stays flat on S; only a crossing moves it, so nothing here runs in a world that never leaves its map.
// A leaf: nodes.js and outposts.js read mapKey, guilds.js and legends.js read who is away, player.js the roads (sim/crossing.js is the crossing).
import {S,ownTown,noOthers} from './state.js';
import {MAP_ID,WORLD_ID,EXITS,CITY,ZONES,dist} from '../world/map.js';
import {MAPS} from '../world/spec.js';
import {MOBS} from '../data/mobs.js';

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
// Exits are data (spec.exits, EXITS); a road with no map behind it is closed (sim/roads.js says so in words). A place "beyond" a road is what its far map is known by.
export const exitById=id=>EXITS.find(e=>e.id===id)||null;
export const exitOpen=e=>!!(e&&e.to&&e.to.map&&MAPS[e.to.map]);
export const mapName=id=>MAPS[id]&&MAPS[id].name||id;
// More than one land to speak of: an open road off this map, or a map already left. Every word about lands hangs on this (#1013 slice 5), so a
// single-map world, and a chapter whose roads are all closed, says nothing of them.
export const manyMaps=()=>EXITS.some(exitOpen)||!!S.maps;
// What a map is known by: its name, towns, regions and landmarks, and the places the DM marked there before the company left.
export function namesOf(id){const m=MAPS[id];if(!m)return [];const fz=S.maps&&S.maps[id];
  return [m.name,...(m.towns||[]).map(t=>t.name),...(m.regions||[]).map(r=>r.name),...(m.landmarks||[]).map(l=>l.name),...(fz&&fz.places||[]).map(p=>p.name)].filter(Boolean)}
export const beyond=e=>exitOpen(e)?namesOf(e.to.map):[];
const exitsOf=id=>id===MAP_ID?EXITS:MAPS[id]&&MAPS[id].exits||[];
// Every map the open roads reach from this one, nearest first: id -> [{from, exit, road, to}], the hops there. through(id): may the way go on past
// that map? A hero's way goes only through lands it knows of; the last map needs no such word, since the hero named a place on it.
export function roadsFrom(through=()=>true){if(!EXITS.length)return new Map();const seen=new Map([[MAP_ID,[]]]),q=[MAP_ID];
  while(q.length){const id=q.shift(),path=seen.get(id);
    for(const x of exitsOf(id)){if(!exitOpen(x)||seen.has(x.to.map))continue;seen.set(x.to.map,[...path,{from:id,exit:x.id,road:x.name,to:x.to.map}]);if(through(x.to.map))q.push(x.to.map)}}
  seen.delete(MAP_ID);return seen}
// The names heroes may hear that belong to other lands, and the roads out of this one (sim/lore.js hear).
export const farNames=()=>[...new Set([...EXITS.map(e=>e.name),...[...roadsFrom().keys()].flatMap(namesOf)])];
export const mapBand=id=>{const L=(MAPS[id]&&MAPS[id].regions||[]).map(r=>r.band).filter(Boolean);return L.length?[Math.min(...L.map(b=>b[0])),Math.max(...L.map(b=>b[1]))]:null};
const folded=s=>String(s==null?'':s).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/^the /,'');
// The place on another map these words name, the longest name first: {map, name}, or null. knows: which names the speaker may use.
export function farNamed(text,knows=()=>true){if(!EXITS.length)return null;const t=' '+folded(text)+' ';let best=null;
  for(const id of roadsFrom().keys())for(const n of namesOf(id)){const f=folded(n);if(f&&t.includes(' '+f+' ')&&knows(n)&&(!best||n.length>best.name.length))best={map:id,name:n}}
  return best}
const landKnown=(id,knows)=>namesOf(id).some(knows);
// The hops to a map through lands the speaker knows of, or null.
export const hopsTo=(id,knows=()=>true)=>roadsFrom(x=>landKnown(x,knows)).get(id)||null;
// What these words mean for a road off this map: {e} its own name; {e, bound, map, hops} a place on a land it leads to, one road or several;
// {lost: {map, name}} a place the speaker knows of on a land no road it knows reaches; else null.
export function roadOf(text,knows=()=>true){if(!EXITS.length)return null;const t=' '+folded(text)+' ',e=EXITS.find(x=>t.includes(' '+folded(x.name)+' '));if(e)return {e};
  const f=farNamed(text,knows);if(!f)return null;const hops=hopsTo(f.map,knows);if(!hops)return {lost:f};
  return {e:EXITS.find(x=>x.id===hops[0].exit),bound:f.name,map:f.map,hops}}
// The road these words name, or null.
export function exitNamed(text,knows=()=>true){const r=roadOf(text,knows);return r&&r.e||null}

// What the crossing waits on, C.road (sim/crossing.js). Only the leader's own words make one: an order or an aim that names the road, as
// it is given, so autopilot carrying an old aim and a company hunting near the map's edge never open the scene (the review's first point).
// {exit, by, at, aim?}: by the leader, aim the number of the aim that named it (an order has none). A plain command elsewhere ends an
// order's road, not an aim's: the aim still says where they are going. A new aim that names no road ends either.
const ROAD_ORDERS=new Set(['move_to','lead_to','hunt','follow','rest','go_crypt','join_raid','enter_site','take_adventure']);
export function roadWord(a,C,ld,tool,args,r,knows=()=>true){if(!EXITS.length||!C||a!==ld||r&&r.dropped)return;const aim=tool==='intent';if(!aim&&!ROAD_ORDERS.has(tool))return;
  if(aim&&!args)return;const R=C.road;if(R&&R.phase)return; // at the table, or the vote taken: the road is settled there
  if(aim&&args.goal==null&&!args.done)return; // the tool's read
  const text=aim?args.goal:tool==='move_to'||tool==='lead_to'?args&&args.target:null,w=text?roadOf(text,knows):null,e=w&&w.e;
  if(e&&exitOpen(e)){C.road={exit:e.id,by:a.id,at:Math.round(S.gameMin),...(w.bound?{bound:w.bound}:{}),...(aim&&a.intent?{aim:a.intent.n}:{})};return}
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
// One road as the DM sees it: what is next along it, for its plans (the far map's own words, which no hero reads from here).
function roadView(e,fz){if(!exitOpen(e))return {name:e.name,open:false,...(e.to&&e.to.heard?{toward:e.to.heard}:{})};const id=e.to.map,M=MAPS[id],b=mapBand(id),on=(M.exits||[]).filter(x=>!(x.to&&x.to.map===MAP_ID)).map(x=>exitOpen(x)?mapName(x.to.map):x.to&&x.to.heard).filter(Boolean);
  return {name:e.name,open:true,to:mapName(id),walked:fz.includes(id),...(b?{levels:b[0]+'-'+b[1]}:{}),...(M.blurb?{blurb:M.blurb}:{}),towns:(M.towns||[]).map(t=>t.name),...(on.length?{then:on}:{})}}
// The DM's view of the campaign (dm_status.campaign): the map on screen, the maps walked so far, what is next along each road. Nothing in a world with no roads off it.
export function campaignMaps(){if(!EXITS.length&&!S.maps)return {};const fz=S.maps?Object.keys(S.maps):[],pk=S.dmAgent&&S.dmAgent.when&&S.dmAgent.when.parked||{};
  return {map:MAP_ID,map_name:mapName(MAP_ID),visited:[MAP_ID,...fz].map(mapName),roads:EXITS.map(e=>roadView(e,fz)),
    ...(S.maps&&noOthers()?{empty_land:'Nobody walks '+mapName(MAP_ID)+' but the company until you put them there: its people, jobs and places are yours to make.'}:{}),
    ...(Object.keys(pk).length?{waiting_on_other_maps:Object.fromEntries(Object.keys(pk).map(id=>[mapName(id),pk[id].list.length]))}:{})}}
// The head of a DM read of the ground (survey, regions): which land it is. Nothing in a world of one land.
export const landHead=()=>manyMaps()?{map:mapName(MAP_ID),map_note:'The live map: the land the company stands on. Other lands wait frozen, and nothing here reads them (dm_status campaign says what is along each road).'}:{};
// The sentence a refusal of a name adds when the name is real, on another land.
export function farHint(s){const f=farNamed(s);return f?' "'+f.name+'" is in '+mapName(f.map)+', not on the live map ('+mapName(MAP_ID)+'): near, town, region and place read the live map only. Prepare it in your notes, or leave a when {trigger: "enter_map", on: {map: "'+mapName(f.map)+'"}, ...} for where the road comes out.':''}
// A map as the DM names it, by id or name: its id, or null.
export function mapNamed(v){const s=folded(v);if(!s)return null;return [MAP_ID,...roadsFrom().keys()].find(id=>id===String(v).trim()||folded(mapName(id))===s)||null}

// ---- what does not cross with a map ----
// A region index belongs to one map. An oath sworn on one keeps its place by name when its hero crosses (markOathMap), so the same number
// on the next map is not the place sworn to: oathZone answers only on the map it was sworn on. A goal with no stamp is of this map.
export function markOathMap(a){const g=a.goal;if(g&&typeof g.zone==='number'&&!g.zoneMap){g.zoneMap=MAP_ID;g.zoneName=ZONES[g.zone]}}
export const oathZone=g=>g&&g.zone!=null&&(!g.zoneMap||g.zoneMap===MAP_ID)?g.zone:null;
export const oathZoneName=g=>g.zoneMap&&g.zoneMap!==MAP_ID?g.zoneName:ZONES[g.zone];
// A kill quest belongs to its map: its creature and region index read something else on the next (or nothing, where the fauna differs, and status
// would throw). It waits there, words kept, and comes back with the hero (a.questsAway {map: {q, text}}); the quest log lists it under left_behind.
export function questAside(a){const q=a.quest;if(!q)return;const M=MOBS[q.type]||{},z=ZONES[M.z];(a.questsAway||(a.questsAway={}))[MAP_ID]={q,text:'Kill '+q.need+' '+(M.pl||q.type)+(z?' in '+z:'')+' ('+Math.min(q.have,q.need)+'/'+q.need+')'};a.quest=null}
export function questBack(a){const L=a.questsAway,x=L&&L[MAP_ID];if(!x||a.quest)return;a.quest=x.q;delete L[MAP_ID];if(!Object.keys(L).length)delete a.questsAway}
// What a hero knows by spot, not by name: its marks and the DM's marked places stand on the map they were learned on. Stamped as the hero leaves it.
export function stampLore(a){const P=a.lore&&a.lore.p;if(!P)return;for(const n of Object.keys(P)){const e=P[n];if((e.mk||e.dm!=null)&&!e.map)e.map=MAP_ID}}
export const spotHere=e=>!e.map||e.map===MAP_ID;
// The town a name means on this map: itself, else (a hall left on another map) the nearest town that takes this hero in.
export function townNear(name,a){if(!name||!a||CITY.some(c=>c.name===name))return name;const L=CITY.filter(c=>ownTown(c,a)),P=L.length?L:CITY;let b=null,bd=1e9;
  for(const c of P){const d=dist(a,c.gate);if(d<bd){bd=d;b=c}}return b?b.name:name}
