// The atlas (#1013): one campaign, one live map, the others frozen as data. Today it says what belongs where; the pack, the unpack
// and the crossing itself are later slices. Every key of S is in exactly one table below: a key the crossing would not know how to
// treat is a bug waiting on the first road between two maps, so npm run crossingcheck fails on a new key until it is placed here.
// Live state stays flat on S; only a crossing moves it, so nothing here runs in a world that never leaves its map.
import {S} from './state.js';
import {MAP_ID,WORLD_ID} from '../world/map.js';

// Frozen with a map: packed into the campaign when the company leaves, unpacked when it comes back.
export const MAP_KEYS=[
  'mobs','boss','fx',
  'dunRec',                                                 // beside the world module's CRYPT and CRYPTS group and cd
  'levers','places','marks','conditions','wanderers','customFoes', // the DM's marks on this land; S.levers also holds the DM's daily counts (day), which the pack must leave campaign-wide
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
  'gameMin','setup','worldId','uid','worldVoice','pauseAll','brainOn','brainHeroes','playerHeroes',
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
