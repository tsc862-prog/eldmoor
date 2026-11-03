// DM-made dungeon sites (issue #69, slice 1). The DM raises a site with the create_site lever (sim/levers.js; the DM agent's
// flat tool create_site, sim/dmagent.js): a barrow, fortress, temple, mine, den or ruin in a region, at a level clamped to the
// region's band. It appears as a real marker on the map (S.places, kind 'site', never terrain), is discovered when a hero
// comes near, entered by a company (enter_site: a solo goes down at once, a company votes like a Crypt call), played room by
// room at the Table through the dungeon crawl (sim/crawl.js, #65/#441; the abstract roll when no agent of the company has the
// say or Table mode is off), and ends cleared (a ruin marker, a timeline entry, the boss's guaranteed epic) or collapsed
// (left too long). Uncleared sites grow more dangerous every few days. Nothing here runs until the lever is pulled: S.sites
// does not exist before, so a scripted world is unchanged (npm run hashcheck).
//
// State (plain JSON, saved with S):
//   S.sites {seq, list:[site], stats:{made, found, runs, clears, wipes, collapsed}, t}
//   site {id, name, theme, label, region, band:[lo,hi], x, y, place (S.places id), state: hidden|discovered|entered|cleared|collapsed,
//         born, by, reason, lever, boss, bossTitle, epic, rooms (crawl rooms: {id,name,frame,foes:[{type,n,name?,hits?,atk?}],alvl,hit,rounds,boss?}),
//         loot {gold, goods[], ilvl}, grow, found {at, by}, runs, cleared {at, by}, group (while a company is inside; heroes saved as refs)}
// Raid sites, scripted-DM triggers and the dungeon view of a site are later slices.
import {rnd,clamp,hash} from '../core/rng.js';
import {W,H,ROAD} from '../world/tiles.js';
import {tiles,I,ZONES,REGIONS,CITY,CRYPT,zoneAt,dist} from '../world/map.js';
import {EPICS,DG_EPICS} from '../data/items.js';
import {baseId,ELITE_TEMPLATE} from '../data/bestiary.js';
import {CLS} from '../data/classes.js';
import {SITE_THEMES,SITE_THEME_IDS,SITE_WORDS,SITE_BANNED} from '../data/sites.js';
import {S} from './state.js';
import {log} from './chronicle.js';
import {record,timeline} from './history.js';
import {notify} from './notify.js';
import {provide,spotErr,bandLvl} from './levers.js';
import {buildSite,buildEncounter} from './encounterbuilder.js';
import {gainXp,getEpic,goHome,fall,maxHp} from './heroes.js';
import {addGood,addGear} from './inv.js';
import {makeItem} from './gear.js';
import {clearXp} from './dungeon.js';
import {companyOf,members,isSolo,campaign as clog} from './company.js';
import {propose,setSiteHook} from './council.js';
import {startCrawl,crawlFits,crawlTick,crawlLost,setSiteEnd,siteById} from './crawl.js';
import {companyAtTable} from './table.js';
import {knownMark} from './lore.js';
import {sightFor} from './weather.js';

export const SITE={
  PER_REGION:1,     // open sites (not cleared or collapsed) a region may hold
  PER_WORLD:3,      // open sites in the whole world
  ROOMS:[3,8],      // rooms a site may have; default 4-6
  MOUTH:3,          // tiles from the mouth a company must stand to go down
  NEAR:6,           // tiles within which a solo's enter_site goes down at once (it walks the last few)
  FIND:6,           // tiles within which a hero comes upon a hidden site
  ROAD_GAP:3,       // tiles a site keeps from any road
  TOWN_GAP:12,      // tiles from every town gate (levers.js LK.TOWN_CLEAR 8, plus 4)
  PLACE_GAP:5,      // tiles from any other marker or site
  GROW_DAYS:2,      // an uncleared site grows one level more dangerous every this many game days ...
  GROW_MAX:3,       // ... up to this many
  COLLAPSE_DAYS:10, // an uncleared, unoccupied site falls in after this many game days
  RUIN_DAYS:14,     // a cleared site's ruin marker stays this long
  WAIT_MIN:480,     // game minutes a passed vote to go down stands while the company gathers at the mouth
  TICK:2,           // seconds between the slow passes (discovery, waits, growth, collapse)
  KEEP:24,          // closed sites kept in the list for the record
  HIT:{guard:.26,trap:.3,puzzle:.24,shrine:.2,treasure:.24,boss:.4}, // a room's blow, a share of a hero's max HP (the Crypt runs .22-.43)
  ROOM_HITS:6,      // the foes of one room need at most this many blows in all (the boss room: plus the boss's)
  LOST:.4,          // the abstract roll's wipe: each member is lost with this chance (as the Crypt)
};
const DAY=1440;
const gd=t=>({t,c:'gd'});
const OPEN=['hidden','discovered','entered'];
export const ensureSites=()=>S.sites||(S.sites={seq:0,list:[],stats:{made:0,found:0,runs:0,clears:0,wipes:0,collapsed:0},t:SITE.TICK});
export const openSites=()=>(S.sites?S.sites.list:[]).filter(s=>OPEN.includes(s.state));
export {siteById};
const placeOf=s=>(S.places||[]).find(p=>p.id===s.place)||null;
const cap=t=>t.charAt(0).toUpperCase()+t.slice(1);

// ---- a private, seeded die: generation never touches the gameplay RNG ----
function lcg(seed){let x=(seed>>>0)||1;return ()=>{x=(Math.imul(x,1664525)+1013904223)>>>0;return x/4294967296}}

// ---- the name ----
function siteName(theme,z,R){const b=(REGIONS[z]&&REGIONS[z].biome)||'other',[A,B]=SITE_WORDS[b]||SITE_WORDS.other;
  const badWord=(a,b)=>{const n=a+b,lo=n.toLowerCase();return a.slice(-1).toLowerCase()===b[0]||SITE_BANNED.includes(n)||ZONES.some(z=>String(z).toLowerCase()===lo)||CITY.some(c=>c.name.toLowerCase()===lo)||(REGIONS||[]).some(r=>String(r.name||'').toLowerCase()===lo)};
  for(let k=0;k<24;k++){const a=A[Math.floor(R()*A.length)],b=B[Math.floor(R()*B.length)];if(badWord(a,b))continue;const n=a+b,name=SITE_THEMES[theme].name(n);
    if(!(S.sites.list.some(s=>s.name===name)||(S.places||[]).some(p=>p.name===name)))return name}
  return SITE_THEMES[theme].name(A[0]+B[0])+' '+(S.sites.seq+1)}

// ---- the ground: a walkable tile in the region, away from towns, roads, landmarks and other markers ----
function roadNear(p,r){const x0=Math.max(0,Math.floor(p.x-r)),x1=Math.min(W-1,Math.floor(p.x+r)),y0=Math.max(0,Math.floor(p.y-r)),y1=Math.min(H-1,Math.floor(p.y+r));
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(tiles[I(x,y)]===ROAD)return true;return false}
export function siteSpotErr(p,z){const e=spotErr(p,{region:z,clear:SITE.TOWN_GAP});if(e)return e;
  if(roadNear(p,SITE.ROAD_GAP))return 'within '+SITE.ROAD_GAP+' tiles of a road';
  if(CRYPT&&dist(p,CRYPT)<SITE.PLACE_GAP+(CRYPT.exclude||0))return 'too close to '+CRYPT.name;
  const q=(S.places||[]).find(x=>dist(x,p)<SITE.PLACE_GAP);if(q)return 'too close to '+q.name;
  return null}
function findSpot(z,near,R){const ok=q=>!siteSpotErr(q,z);const r1=q=>({x:Math.floor(q.x)+.5,y:Math.floor(q.y)+.5});
  if(near){for(let d=0;d<=10;d+=1)for(let k=0;k<16;k++){const ang=k*Math.PI/8,q=r1({x:near.x+Math.cos(ang)*d,y:near.y+Math.sin(ang)*d});if(ok(q))return q;if(d===0)break}return null}
  for(let i=0;i<1500;i++){const q=r1({x:1+R()*(W-2),y:1+R()*(H-2)});if(zoneAt(q.x,q.y)===z&&ok(q))return q}
  return null}

// ---- the rooms: the encounter builder's site plan in the crawl's room format ----
const ROOM_KINDS=['guard','trap','puzzle','shrine','treasure','boss'];
function toRooms(theme,z,band,n,R){const T=SITE_THEMES[theme],plan=buildSite(T.enc,band,n,{rng:R,region:z,partySize:5}),used={},rooms=[];let boss=null;
  for(const r of plan.rooms){const kind=ROOM_KINDS.includes(r.kind)?r.kind:'guard',names=T.rooms[kind]||T.rooms.guard,k=used[kind]=(used[kind]||0)+1;
    const name=names[(k-1)%names.length]+(k>names.length?' '+['Beyond','Below','Deeper'][Math.min(2,Math.floor((k-1)/names.length)-1)]:'');
    let foes=r.foes||[];
    if(!foes.length)foes=buildEncounter(T.enc,z,r.level,5,{rng:R,n:[1,2],budgetMul:.45,lvlBand:[Math.max(1,r.level-1),r.level]}).foes; // a trap, puzzle or shrine still has its keepers
    const by={},out=[];let hits=0;
    for(const f of foes){if(f.boss){boss=f;continue}const t=f.variant||baseId(f.type);(by[t]||(by[t]={type:t,n:0})).n++}
    for(const t of Object.keys(by)){const e=by[t];out.push(e)}
    // keep the room winnable in its rounds: trim the most numerous kind until the blows needed fit
    const blows=e=>e.n*(e.hits||2);const total=()=>out.reduce((s,e)=>s+blows(e),0);
    while(out.length&&total()>SITE.ROOM_HITS){const m=out.reduce((a,b)=>b.n>a.n?b:a);if(m.n>1)m.n--;else out.splice(out.indexOf(m),1)}
    hits=total();
    const room={id:kind+(k>1?k:''),name:cap(name),frame:T.frame[kind].replace('{h}',r.hazard?r.hazard.name:'something waiting'),foes:out,alvl:r.level,hit:SITE.HIT[kind],rounds:2};
    if(kind==='boss'&&boss){room.foes.unshift({type:boss.variant||baseId(boss.type),n:1,name:boss.name,hits:Math.round(2*ELITE_TEMPLATE.hp),atk:ELITE_TEMPLATE.dmg});
      room.boss=true;room.rounds=3;room.alvl=boss.lvl}
    if(!room.foes.length)room.foes=[{type:baseId(Object.keys(by)[0]||'wolf'),n:1}];
    void hits;rooms.push(room)}
  const loot={gold:plan.rooms.reduce((t,r)=>t+((r.loot&&r.loot.gold)||0),0),goods:plan.rooms.flatMap(r=>(r.loot&&r.loot.goods)||[]).slice(0,8),ilvl:band[1]+1};
  return {rooms,boss,loot}}

// ---- the lever's implementation (levers.js create_site: validation, limits, cooldown and the DM log are the lever's) ----
// p: {theme, region, band?, rooms?, at?, name?}; ctx: {by, reason, id}. Returns {ok, effect, ret} or {ok:false, effect: why}.
export function createSite(p,ctx){ensureSites();const z=p.region,T=SITE_THEMES[p.theme];if(!T)return {ok:false,effect:'no such theme'};
  const open=openSites();
  if(open.length>=SITE.PER_WORLD)return {ok:false,effect:'limit: '+SITE.PER_WORLD+' open sites in the world ('+open.map(s=>s.name).join(', ')+'); one must be cleared or collapse first'};
  const inZ=open.filter(s=>s.region===z);if(inZ.length>=SITE.PER_REGION)return {ok:false,effect:'limit: '+SITE.PER_REGION+' open site per region; '+ZONES[z]+' has '+inZ[0].name};
  const [lo,hi0]=REGIONS[z]&&REGIONS[z].band?REGIONS[z].band:[1,20],hi=Math.min(hi0,20);
  let L=lo+1;if(p.band!=null){const b=bandLvl(z,p.band);if(b.err)return {ok:false,effect:b.err};L=b.lvl}
  L=clamp(L,lo,Math.max(lo,hi));const band=[L,Math.min(L+2,hi+2)];
  const R=lcg(Math.floor(hash(S.sites.seq+1,z,Math.round(S.gameMin))*4294967296)^SITE_THEME_IDS.indexOf(p.theme)*7919);
  if(p.at&&zoneAt(p.at.x,p.at.y)!==z)return {ok:false,effect:'at '+Math.round(p.at.x)+','+Math.round(p.at.y)+' is outside '+ZONES[z]};
  const at=findSpot(z,p.at||null,R);if(!at)return {ok:false,effect:p.at?'no open ground near '+Math.round(p.at.x)+','+Math.round(p.at.y)+' (a site keeps '+SITE.ROAD_GAP+' tiles from roads, '+SITE.TOWN_GAP+' from town gates, '+SITE.PLACE_GAP+' from other places; see survey)':'no open ground in '+ZONES[z]+' away from roads, towns and other places'};
  const n=p.rooms!=null?clamp(p.rooms,SITE.ROOMS[0],SITE.ROOMS[1]):4+Math.floor(R()*3);
  const name=p.name&&!(S.places||[]).some(q=>q.name===p.name)&&!S.sites.list.some(s=>s.name===p.name)?p.name:siteName(p.theme,z,R);
  const g=toRooms(p.theme,z,band,n,R),epics=T.relic==='crypt'?DG_EPICS:(EPICS[z]||EPICS[z%EPICS.length]),epic=epics[Math.floor(R()*epics.length)];
  const s={id:++S.sites.seq,name,theme:p.theme,label:T.label,region:z,band,x:at.x,y:at.y,place:null,state:'hidden',born:Math.round(S.gameMin),by:ctx.by,reason:ctx.reason,lever:ctx.id,
    boss:g.boss?g.boss.name:'its keeper',bossTitle:g.boss&&g.boss.title||'',epic,rooms:g.rooms,loot:g.loot,grow:0,found:null,runs:0,cleared:null,group:null};
  const pl={id:++S.uid,kind:'site',theme:p.theme,name,x:at.x,y:at.y,z,born:s.born,until:null,lever:ctx.id,site:s.id};
  (S.places||(S.places=[])).push(pl);s.place=pl.id;S.sites.list.push(s);S.sites.stats.made++;
  return {ok:true,effect:{site:s.id,name,theme:p.theme,region:ZONES[z],at:{x:at.x,y:at.y},band:band[0]+'-'+band[1],rooms:s.rooms.length,boss:s.boss,clamped:p.band!=null&&p.band!==L},ret:s}}

// ---- what the DM sees (dm_status.sites) ----
export const sitesView=()=>S.sites?S.sites.list.slice(-12).map(s=>({id:s.id,name:s.name,theme:s.theme,region:ZONES[s.region],at:Math.round(s.x)+','+Math.round(s.y),band:s.band.join('-'),
  state:s.state,rooms:s.rooms.length,boss:s.boss,grow:s.grow,found_by:s.found?s.found.by:null,runs:s.runs,inside:s.group?s.group.name||null:null,cleared_by:s.cleared?s.cleared.by:null})):[];

// ---- a hero's view: the sites it knows or sees ----
const sight=a=>12*sightFor(a,zoneAt(a.x,a.y));
const knows=(a,s)=>{if(!a.player)return true;const p=placeOf(s);if(p&&dist(a,p)<=sight(a))return true;return !!(p&&knownMark(a,p.name)===p)};
export function knownSites(a){return openSites().filter(s=>s.state!=='hidden'||dist(a,s)<=sight(a)).filter(s=>knows(a,s))}
const lineOf=(a,s)=>s.name+' ('+s.label+', '+ZONES[s.region]+', '+Math.round(dist(a,s))+' tiles'+(s.group?', a company is inside':'')+')';
function resolve(a,v){const L=knownSites(a);const t=String(v==null?'':v).trim().toLowerCase().replace(/^the\s+/,'');
  if(!t)return L.filter(s=>dist(a,s)<=sight(a)).sort((x,y)=>dist(a,x)-dist(a,y))[0]||null;
  return L.find(s=>String(s.id)===t||s.name.toLowerCase().replace(/^the\s+/,'')===t)||L.find(s=>s.name.toLowerCase().includes(t))||null}
// Green warning, as the Crypt's sign (#448): the game never refuses, it warns.
const greenOf=(L,s)=>L.some(m=>m.lvl<s.band[0])?' The air of the place is heavier than your blades: those who should go down here are tried blades, and some of you are not.':'';

// enter_site {site}: a solo goes down when near; a company puts it to the party. Returns a result object or {ok:false,error}.
export function enterSiteTool(a,args){const no=e=>({ok:false,error:e});const C=companyOf(a);
  if(!C)return no('Only a company goes down into a site (you ride with none).');
  if(['fight','duel','assist','dungeon','raid','ghost'].includes(a.state))return no('Not now ('+a.state+'): finish what you are in first.');
  const s=resolve(a,args&&args.site);
  if(!s){const L=knownSites(a);return no((args&&args.site?'You know of no open site called "'+String(args.site).slice(0,40)+'".':'No site in sight.')+(L.length?' Sites you know: '+L.map(x=>lineOf(a,x)).join('; ')+'.':' You know of none: they are found by walking near them, or heard of.'))}
  if(s.group)return no('Another company is inside '+s.name+' now. Wait for them to come out.');
  const L=members(C);
  if(isSolo(C)){if(dist(a,s)>SITE.NEAR)return no(s.name+' is '+Math.round(dist(a,s))+' tiles away: walk there first (move_to "'+s.name+'"), then enter_site.');
    enterSite(C,s);return {ok:true,site:s.name,entered:true,note:'You go down into '+s.name+' alone. Every chamber is a scene at the table.'+greenOf(L,s)}}
  const P=propose(a,'site','go down into '+s.name+' together, all of us',{site:s.id});
  if(typeof P==='string')return no(P);
  return {ok:true,site:s.name,proposal:P.id,status:P.status,note:'Put to the party: everyone votes. If it passes, walk to '+s.name+' together; you go down once all of you stand at its mouth.'+greenOf(L,s)}}

// ---- the vote (council.js setSiteHook) ----
const VOTE={
  vote(a,P){const s=siteById(P.site);if(!s||!OPEN.includes(s.state))return 'no';return a.lvl>=s.band[0]-2&&a.hp>=.6*maxHp(a)?'yes':'no'},
  go(F,P){const s=siteById(P.site);if(!s||!OPEN.includes(s.state)){P.result+='; the place is gone';return}
    F.siteGo={site:s.id,until:S.gameMin+SITE.WAIT_MIN};P.result+='; we gather at the mouth of '+s.name;
    clog(F,'council',gd(F.name),' agree to go down into ',gd(s.name),' together.');
    for(const b of members(F))notify(b,'The vote stands: gather at the mouth of '+s.name+' (move_to "'+s.name+'"; the leader may lead_to it). You go down once all of you stand there.',true)}};

// ---- going down ----
export function enterSite(C,s){const L=members(C).filter(a=>!a.hidden);if(!L.length||s.group)return false;
  for(const a of L){a.state='dungeon';a.hidden=true;a.x=s.x;a.y=s.y;a.moving=false;a.target=null;a.dest=null;a.siteIn=s.id;if(a.player)a.pq=[];record(a,'Went down into ',gd(s.name),'.')}
  const g={site:s.id,fac:C.fac,mem:L.slice(),name:C.name||L[0].name,phase:'inside',t:30+rnd()*20,tSite:1};s.group=g;s.runs++;S.sites.stats.runs++;
  if(s.state!=='entered'){s.state='entered';if(!s.found)s.found={at:Math.round(S.gameMin),by:L[0].name}}
  delete C.siteGo;
  log(gd(g.name),' go down into ',gd(s.name),'.');clog(C,'council',gd(C.name||g.name),' go down into ',gd(s.name),'.');
  if(crawlFits(g)&&companyAtTable(C))startCrawl(g); // room by room at the Table; else the abstract roll below
  return true}

// The crawl's end (crawl.js setSiteEnd) or the abstract roll's: pay, mark, record.
function siteEnd(g,end){const s=siteById(g.site);if(!s)return;const who=gd(g.name||'The company'),L=g.mem.filter(a=>a.state!=='dead');
  for(const a of g.mem)delete a.siteIn;
  if(end==='clear'){clearSite(s,g,L,g.crawl?.1:1);return}
  if(end==='wiped'){S.sites.stats.wipes++;return}
  log(who,end==='driven'?' were driven back from ':' withdrew from ',gd(s.name),'.');
  for(const a of L){record(a,end==='driven'?'Driven back from ':'Withdrew from ',gd(s.name),'.');goHome(a)}}
// share: of the clear XP paid at the end (the crawl already paid most of it room by room).
function clearSite(s,g,L,share){S.sites.stats.clears++;const who=gd(g.name||'The company');
  s.state='cleared';s.cleared={at:Math.round(S.gameMin),by:g.name||null};
  const each=L.length?Math.round(s.loot.gold*(1+.2*s.grow)/L.length):0,heir=L.slice().sort((x,y)=>((x.epics||[]).length-(y.epics||[]).length)||(x.id-y.id))[0];
  L.forEach((a,i)=>{gainXp(a,Math.round(clearXp(a)*share*(1+.1*s.grow)));a.gold+=each;a.kills+=s.rooms.length*2;
    for(let k=i;k<s.loot.goods.length;k+=L.length)addGood(a,s.loot.goods[k],1);record(a,'Cleared ',gd(s.name),' and destroyed ',gd(s.boss),'.')});
  const gearTo=L.slice().sort((x,y)=>(x.gear-y.gear)||(x.id-y.id))[0],slots=['head','chest','hands','feet','main','trinket'];
  if(gearTo&&CLS[gearTo.cls])addGear(gearTo,makeItem(gearTo.cls,slots[s.id%slots.length],s.loot.ilvl,Math.min(s.region,3),{quality:'rare',src:s.boss}));
  if(heir)getEpic(heir,s.epic,{t:s.boss,c:'gd'}); // the boss's guaranteed epic
  log(who,' cleared ',gd(s.name),' and destroyed ',gd(s.boss),'!');
  timeline('world',who,' cleared ',gd(s.name),' in '+ZONES[s.region]+' and destroyed ',gd(s.boss),'.');
  const p=placeOf(s);if(p){p.kind='ruin';p.cleared=true;p.until=S.gameMin+SITE.RUIN_DAYS*DAY}
  for(const a of L)goHome(a)}

// The abstract roll (no agent of the company has the say, or Table mode is off): the Crypt's formula against the site's level.
function rollSite(g,s){const n=g.mem.length,avg=g.mem.reduce((t,a)=>t+a.lvl+a.gear*.3,0)/n;
  const pw=avg+(g.mem.some(a=>CLS[a.cls]&&CLS[a.cls].heal)?2.5:0)+(g.mem.some(a=>a.cls==='Warrior')?1.5:0)+n*.6;
  const need=s.band[1]+s.grow+1,ok=rnd()<clamp((pw-need)/8,.15,.92);
  for(const a of g.mem){a.hidden=false;a.x=s.x+(rnd()-.5)*1.5;a.y=s.y+.5+rnd()*.6}
  if(ok){siteEnd(g,'clear');return}
  const lost=[];for(const a of g.mem){if(rnd()<SITE.LOST){lost.push(a);record(a,'Lost forever in ',gd(s.name),'.');fall(a,'lost in '+s.name)}else{record(a,'Fled ',gd(s.name),'.');goHome(a)}}
  for(const a of g.mem)delete a.siteIn;S.sites.stats.wipes++;
  const parts=[gd(g.name||'The company'),' were beaten back in ',gd(s.name),'.'];
  if(lost.length){parts.push(' Lost forever: ');lost.forEach((a,i)=>{parts.push(a);if(i<lost.length-1)parts.push(', ')});parts.push('.')}else parts.push(' Everyone escaped.');
  log(...parts);if(lost.length)timeline('death',...parts)}

// Wired from sim/index.js once every module has loaded (an import cycle runs through levers, council and crawl).
export function wireSites(){provide('createSite',createSite);setSiteHook(VOTE);setSiteEnd(siteEnd)}

// ---- once per step (sim/index.js), a no-op until a site exists ----
export function siteTick(dt){const X=S.sites;if(!X)return;
  for(const s of X.list){const g=s.group;if(!g)continue;
    g.mem=g.mem.filter(a=>a.state==='dungeon');
    if(!g.mem.length){if(g.crawl)crawlLost(g);s.group=null;continue}
    if(g.crawl){crawlTick(g,dt);continue}
    g.t-=dt;if(g.t<=0){s.group=null;rollSite(g,s)}}
  X.t-=dt;if(X.t>0)return;X.t=SITE.TICK;slow()}
function slow(){const X=S.sites,now=S.gameMin;
  for(const s of X.list){if(!OPEN.includes(s.state))continue;
    if(s.state==='hidden'){const a=S.agents.find(b=>b.kind==='hero'&&b.state!=='dead'&&b.state!=='ghost'&&!b.hidden&&dist(b,s)<=SITE.FIND);
      if(a){s.state='discovered';s.found={at:Math.round(now),by:a.name};X.stats.found++;const T=SITE_THEMES[s.theme];
        log(a,' came upon ',gd(s.name),' in '+ZONES[s.region]+'.');record(a,'Came upon ',gd(s.name),'.');
        notify(a,'You come upon '+s.name+': '+T.mouth+'. enter_site "'+s.name+'" to go down (a company goes together).',true)}}
    const age=(now-s.born)/DAY;if(!s.group)s.grow=Math.min(SITE.GROW_MAX,Math.max(s.grow,Math.floor(age/SITE.GROW_DAYS)));
    if(!s.group&&age>=SITE.COLLAPSE_DAYS){s.state='collapsed';X.stats.collapsed++;const p=placeOf(s);if(p)S.places.splice(S.places.indexOf(p),1);
      log(gd(s.name),' in '+ZONES[s.region]+' falls in on itself; whatever was inside is buried for good.');timeline('world',gd(s.name),' in '+ZONES[s.region]+' collapsed, never cleared.')}}
  // a company that voted to go down: it goes once everyone stands at the mouth
  for(const C of (S.companies||[])){const w=C.siteGo;if(!w)continue;const s=siteById(w.site);
    if(!s||!OPEN.includes(s.state)||now>=w.until){delete C.siteGo;if(s)clog(C,'council',gd(C.name),' give up waiting at ',gd(s.name),'.');continue}
    const L=members(C);if(L.length&&!s.group&&L.every(a=>!a.hidden&&dist(a,s)<=SITE.MOUTH&&!['fight','duel','assist','dungeon','raid','ghost'].includes(a.state)))enterSite(C,s)}
  // ruins fade; old records go
  for(let i=(S.places||[]).length-1;i>=0;i--){const p=S.places[i];if(p.site!=null&&p.until!=null&&now>=p.until)S.places.splice(i,1)}
  const closed=X.list.filter(s=>!OPEN.includes(s.state)&&!s.group);if(closed.length>SITE.KEEP)X.list=X.list.filter(s=>OPEN.includes(s.state)||s.group||closed.indexOf(s)>=closed.length-SITE.KEEP)}
