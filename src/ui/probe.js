// Test seam for headless Chrome (#736): with ?probe=1 in the URL the page exposes window.__eldmoorProbe so scripts/shoot.mjs
// (`--crawl`) can time a view in a built bundle, where module paths are not importable:
//   frameSamples() / clearSamples() / pageStats()   the watchdog's frame costs (ui/pagewatch.js)
//   stageCrawl()   a fixture: puts the slotted company in the Sunken Crypt's second chamber, two foes standing, the clock
//                  stopped, and opens the dungeon view. It writes CRYPT.group, so it exists only behind ?probe=1 (never in play).
//   stageRaid()    a fixture (#85): a raid of one faction at the lair, most on the sim's ring, two on the way in, one downed, one
//                  add, the boss hurt and its breath about to land, the clock stopped, and opens the raid arena.
//   stageSlain()   after stageRaid: the wyrm slain and the lava cooled.
// Without the query nothing is installed.
import {frameSamples,clearSamples,pageStats} from './pagewatch.js';
import {CRYPT,LANDMARKS} from '../world/map.js';
import {S} from '../sim/state.js';
import {slotted,slotMembers,companies} from '../sim/company.js';
import {ctl} from './controls.js';
import {openDungeon} from '../render/dungeonview.js';
import {trackRaid} from '../render/raidview.js';
import {CLS} from '../data/classes.js';
import {maxHp} from '../sim/heroes.js';

export function stageCrawl(){
  const C=slotted()||companies()[0],mem=C?(C.slots?slotMembers(C).map(m=>m.hero):(C.ids||[]).map(id=>S.agents.find(a=>a.id===id))).filter(a=>a&&a.state!=='dead'):[];
  if(!mem.length||!CRYPT)return {ok:false,why:'no company or no crypt'};
  ctl.speed=0;
  CRYPT.group={fac:mem[0].fac,phase:'inside',name:'Probe',mem,tSite:true,crawl:{i:Math.min(1,(CRYPT.rooms||[]).length-1),rd:1,gap:0,end:null,
    foes:[{type:'skeleton',name:'Skeleton',hp:3,hits:3,lvl:5},{type:'skeleton',name:'Skeleton',hp:2,hits:3,lvl:5}]}};
  openDungeon(CRYPT);return {ok:true,members:mem.length,rooms:(CRYPT.rooms||[]).length}}

export function stageRaid(){const L=LANDMARKS.find(l=>l.kind==='lair'),B=S.boss;if(!L||!B)return {ok:false,why:'no lair'};
  const crew=S.agents.filter(a=>a.fac===0&&a.state!=='dead').sort((p,q)=>q.lvl-p.lvl).slice(0,8);if(crew.length<6)return {ok:false,why:'too few heroes'};
  ctl.speed=0;S.table=null;B.alive=true;B.hp=B.maxhp*.62;B.dmg=[B.maxhp*.38,0];B.breath=1.1;B.t=40;S.raidOn[0]=true;
  crew.forEach((a,i)=>{const near=i<crew.length-2,ang=Math.PI*(.55+i*.18),rr=Math.min(CLS[a.cls].range+.9,3.2),out=L.opening==='E'?1:-1;
    a.raid=true;a.raidIdx=i;a.state='raid';a.hidden=false;a.moving=!near;a.hp=maxHp(a)*(.35+.6*((i*37)%10)/10);
    a.x=near?B.x-Math.cos(ang)*rr:L.x+out*(L.r+1);a.y=near?B.y-.3+Math.sin(ang)*rr*(i%2?1:-1)*.8:L.y+(i%2?.6:-.6)});
  trackRaid();const d=crew[2];d.hp=0;d.state='downed';d.raid=false;d.moving=false;d.down={at:S.gameMin,next:S.gameMin+10,s:1,f:1,stable:false,wake:0,by:'Kragmaw'};trackRaid();d.x=B.x+2.2;d.y=B.y+1.4;
  const m=S.mobs.find(x=>x.alive&&!x.hidden);if(m){m.x=B.x-2.6;m.y=B.y+2.4}
  S.fx.push({type:'ring',x:B.x,y:B.y-.5,life:.33});openDungeon(L);return {ok:true,raiders:crew.length,downed:d.name}}
// The same raid won: the wyrm slain, the raiders gone home, the one who went down still lying in the cooled lair.
export function stageSlain(){const B=S.boss;B.alive=false;B.hp=0;B.respawn=300;S.raidOn[0]=false;for(const a of S.agents)if(a.raid)a.raid=false;trackRaid();return {ok:true}}

export function installProbe(){
  if(typeof window==='undefined'||typeof location==='undefined'||!/[?&]probe=1\b/.test(location.search))return false;
  window.__eldmoorProbe={frameSamples,clearSamples,pageStats,stageCrawl,stageRaid,stageSlain};return true}
