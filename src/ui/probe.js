// Test seam for headless Chrome (#736): with ?probe=1 in the URL the page exposes window.__eldmoorProbe so scripts/shoot.mjs
// (`--crawl`) can time a view in a built bundle, where module paths are not importable:
//   frameSamples() / clearSamples() / pageStats()   the watchdog's frame costs (ui/pagewatch.js)
//   stageCrawl()   a fixture: puts the slotted company in the Sunken Crypt's second chamber, two foes standing, the clock
//                  stopped, and opens the dungeon view. It writes CRYPT.group, so it exists only behind ?probe=1 (never in play).
// Without the query nothing is installed.
import {frameSamples,clearSamples,pageStats} from './pagewatch.js';
import {CRYPT} from '../world/map.js';
import {S} from '../sim/state.js';
import {slotted,slotMembers,companies} from '../sim/company.js';
import {ctl} from './controls.js';
import {openDungeon} from '../render/dungeonview.js';

export function stageCrawl(){
  const C=slotted()||companies()[0],mem=C?(C.slots?slotMembers(C).map(m=>m.hero):(C.ids||[]).map(id=>S.agents.find(a=>a.id===id))).filter(a=>a&&a.state!=='dead'):[];
  if(!mem.length||!CRYPT)return {ok:false,why:'no company or no crypt'};
  ctl.speed=0;
  CRYPT.group={fac:mem[0].fac,phase:'inside',name:'Probe',mem,tSite:true,crawl:{i:Math.min(1,(CRYPT.rooms||[]).length-1),rd:1,gap:0,end:null,
    foes:[{type:'skeleton',name:'Skeleton',hp:3,hits:3,lvl:5},{type:'skeleton',name:'Skeleton',hp:2,hits:3,lvl:5}]}};
  openDungeon(CRYPT);return {ok:true,members:mem.length,rooms:(CRYPT.rooms||[]).length}}

export function installProbe(){
  if(typeof window==='undefined'||typeof location==='undefined'||!/[?&]probe=1\b/.test(location.search))return false;
  window.__eldmoorProbe={frameSamples,clearSamples,pageStats,stageCrawl};return true}
