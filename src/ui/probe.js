// Test seam for headless Chrome (#736): with ?probe=1 in the URL the page exposes window.__eldmoorProbe so scripts/shoot.mjs
// (`--crawl`) can time a view in a built bundle, where module paths are not importable:
//   frameSamples() / clearSamples() / pageStats()   the watchdog's frame costs (ui/pagewatch.js)
//   stageCrawl()   a fixture: puts the slotted company in the Sunken Crypt's second chamber, two foes standing, the clock
//                  stopped, and opens the dungeon view. It writes CRYPT.group, so it exists only behind ?probe=1 (never in play).
//   stageLooted()  after stageCrawl and a frame: that crawl clears (the real payout and record), for the looted marks (#976).
// Without the query nothing is installed.
import {frameSamples,clearSamples,pageStats} from './pagewatch.js';
import {CRYPT} from '../world/map.js';
import {S} from '../sim/state.js';
import {slotted,slotMembers,companies} from '../sim/company.js';
import {ctl} from './controls.js';
import {openDungeon} from '../render/dungeonview.js';
import {payClear} from '../sim/dungeon.js';
import {cryptRun} from '../sim/crypts.js';

export function stageCrawl(){
  const C=slotted()||companies()[0],mem=C?(C.slots?slotMembers(C).map(m=>m.hero):(C.ids||[]).map(id=>S.agents.find(a=>a.id===id))).filter(a=>a&&a.state!=='dead'):[];
  if(!mem.length||!CRYPT)return {ok:false,why:'no company or no crypt'};
  ctl.speed=0;
  CRYPT.group={fac:mem[0].fac,phase:'inside',name:'Probe',mem,tSite:true,crawl:{i:Math.min(1,(CRYPT.rooms||[]).length-1),rd:1,gap:0,end:null,lvl:5,
    foes:[{type:'skeleton',name:'Skeleton',hp:3,hits:3,lvl:5},{type:'skeleton',name:'Skeleton',hp:2,hits:3,lvl:5}]}};
  openDungeon(CRYPT);return {ok:true,members:mem.length,rooms:(CRYPT.rooms||[]).length}}

export function stageLooted(){const g=CRYPT&&CRYPT.group;if(!g||!g.crawl)return {ok:false,why:'no staged crawl'};
  g.crawl.end='clear';g.crawl.i=(CRYPT.rooms||[]).length-1;setTimeout(()=>{payClear(g,.1);cryptRun(CRYPT,'clears');CRYPT.group=null},300);return {ok:true}} // a few frames first: the view reads the end off the crawl

export function installProbe(){
  if(typeof window==='undefined'||typeof location==='undefined'||!/[?&]probe=1\b/.test(location.search))return false;
  window.__eldmoorProbe={frameSamples,clearSamples,pageStats,stageCrawl,stageLooted};return true}
