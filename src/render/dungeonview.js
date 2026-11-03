// The dungeon view (#85, slice 1): a dungeon's interior over the world canvas, with the crawl drawn live.
//   openDungeon(site?)  show it (site: a crypt landmark; default the Sunken Crypt, CRYPT); closeDungeon()
//   dungeonOpen()       true while it is showing (render/draw.js then draws it instead of the world)
//   drawDungeon(now)    one frame (called by the renderer); refreshDungeon() updates the bar and room list only
//   cryptAt(x, y)       the crypt landmark whose mouth is at tile (x, y), for a click on the world map
//   stateOf(site)       the live state as plain data (DOM-free): phase, rooms reached/cleared, round, party, status
//   trackCrawl()        called every frame: remembers how the last crawl it saw ended (the sim keeps only totals)
//   initDungeonView()   once: any element with a data-dungeon attribute opens the view on click (the hero card's
//                       "View inside", the Table banner's crawl button), Escape closes it
// Slice 2 (#85): foes in the chamber being fought with HP bars (render/dgfoes.js, from the live crawl), hover and click
//   detail for a chamber or a foe (roomDetail: name, type, state, foes, what happened there), the History panel
//   (historyOf: who entered, which chambers fell to them, who fell where; kept for the session on this side, as the sim
//   keeps only totals), and the minimap's mark (dungeonSite).
// Read-only on the sim: reads CRYPT.group and its crawl (sim/crawl.js), S.table and slotted().crawl.
// Raid slice (#85): a lair landmark (kind 'lair') opens the raid arena in the same frame (render/raidview.js): the boss with
//   its HP, phase and breath, the raiders where they stand, adds, who broke off or fell, a raider list on the bar, hover and
//   click detail and a raid history; the minimap marks the lair.
// The overlay sits inside #screen right after the world canvas, so the Table banner and alerts stay on top of it.
// DM-made sites (#642; sim/sites.js, #69): a site opens the same view with its own interior (render/siteview.js: the chambers
//   in plan order dressed in its theme: barrow, fortress, temple, mine, den or ruin) and its live crawl (site.group.crawl,
//   the same crawl as the Crypt's), its state when nobody is inside (hidden, found, cleared, collapsed, grown), a company
//   gathering at its mouth, and the room kinds in the detail. Every dungeon is tracked by its key (keyOf: the Crypt's name,
//   'site:<id>' for a site); a site is looked up fresh from S.sites each frame, so a restored save shows the live one.
import {CRYPT,LANDMARKS} from '../world/map.js';
import {buildInterior} from '../world/interior.js';
import {S} from '../sim/state.js';
import {companyById,slotted,members} from '../sim/company.js';
import {siteById} from '../sim/crawl.js';
import {siteInterior,roomKind} from './siteview.js';
import {drawInterior} from './interior.js';
import {foeKind,foeAt} from './dgfoes.js';
import {U as T} from './tile.js'; // world units a tile (render/tile.js; art is drawn at TILE)
import {classColor} from '../core/colors.js';
import {isArena,arenaOf,raidState,raidDetail,raidRows,raidHistory,drawArena,arenaHit} from './raidview.js';

let root=null,cv=null,ctx=null,nameEl=null,statEl=null,listEl=null,tipEl=null,pinEl=null,histEl=null,histBtn=null,site=null,open=false,inited=false,sig='';
let fit=null,hov={room:-1,foe:null,key:null,x:0,y:0},pin=-1,histOpen=false,tipSig='',topPx=-1,barPx=-1; // fit: where the last frame put the interior (for pointer maths)
const roomsOf=s=>(s&&s.rooms)||[];
const live=s=>!!(CRYPT&&s&&s.name===CRYPT.name);
// A DM-made site (sim/sites.js): an entry of S.sites.list (id, theme, band, rooms, group); landmarks have a kind instead.
export const isSite=s=>!!(s&&s.id!=null&&s.theme&&Array.isArray(s.band)&&!s.kind);
const fresh=s=>isSite(s)?siteById(s.id)||s:s;
export const keyOf=s=>isSite(s)?'site:'+s.id:s&&s.name;
// The group inside a dungeon: a site's own, else the Crypt's.
export const groupOf=s=>isSite(s)?s.group||null:live(s)?CRYPT.group:null;
export const dungeonGroup=s=>groupOf(fresh(s)); // the same, for a dungeon object held across frames (a site is looked up again)
const interiorOf=s=>isSite(s)?siteInterior(s):buildInterior(s);
// The dungeon a Table scene plays in: the site its context names, else the Sunken Crypt.
export const dungeonOf=sc=>{const id=sc&&sc.ctx&&sc.ctx.site;return id!=null?siteById(id)||null:CRYPT};
const who=(g,cr)=>{const C=coOf(cr||g.crawl);return g.name||(C&&C.name)||whoG(g)};
const whoG=g=>g.name||(g.guild?'<'+g.guild.tag+'> '+g.guild.name:'A group');

// ---- how the last crawl ended (the sim clears CRYPT.group at once; slotted().crawl keeps counts only) ----
const KINDS=['clears','driven','withdrawn','wipes'],END={clears:'clear',driven:'driven',withdrawn:'withdrawn',wipes:'wiped'};
const lastRun={},watches=new Map(),curs=new Map(); // per dungeon key: the crawl being watched, and its run record
// The company in a group's live crawl (#441: cr.co); a crawl with none (older, or the abstract roll) reads as the Fellowship's.
const coOf=cr=>cr&&cr.co!=null?companyById(cr.co):null;
const crewOf=(g,cr)=>{const C=coOf(cr);return C&&C.ids?g.mem.filter(a=>C.ids.includes(a.id)):g.mem};
const tallyNow=co=>{const H=co||slotted(),C=H&&H.crawl;return KINDS.map(k=>C?C[k]||0:0)};
// Every crawl this page has seen, newest last (session memory): {site (the dungeon's key), who, day, party:[{name,cls}],
// rooms:{i:{rounds, result}}, falls:[{name,cls,room}], reached, end}. Filled from the live crawl each frame, so a page opened
// mid-crawl has the rest.
const runs=[];
const noteRun=(cur,g,cr)=>{
  if(cr.i>cur.reached){for(let j=cur.reached;j<cr.i;j++){const q=cur.rooms[j]||(cur.rooms[j]={rounds:0,result:''});q.result='cleared'}cur.reached=cr.i}
  const rec=cur.rooms[cr.i]||(cur.rooms[cr.i]={rounds:0,result:''});if(cr.foes&&cr.rd+1>rec.rounds)rec.rounds=cr.rd+1;
  if(cr.end==='clear')rec.result='cleared';else if(cr.end==='retreat')rec.result=cr.driven?'driven':'fell back';else if(cr.end==='wiped')rec.result='lost';
  for(const a of g.mem)if(a.state==='dead'&&!cur.fell[a.id]){cur.fell[a.id]=1;cur.falls.push({name:a.name,cls:a.cls,room:cr.i});if(!rec.result)rec.result=''}};
function closeRun(key,n,end){const cur=curs.get(key);if(!cur)return;cur.end=end||'ended';
  if(end==='clear')for(let j=0;j<n;j++)(cur.rooms[j]||(cur.rooms[j]={rounds:0,result:''})).result='cleared';
  else for(let j=0;j<cur.reached;j++){const q=cur.rooms[j]||(cur.rooms[j]={rounds:0,result:''});if(!q.result)q.result='cleared'}
  runs.push(cur);if(runs.length>24)runs.shift();curs.delete(key)}
// One dungeon: note the live crawl, or how the one it watched ended (the sim drops the group the step a crawl ends).
function track1(key,g,n){const cr=g&&g.crawl;let w=watches.get(key);
  if(cr){if(!w){w={name:key,i:0,end:null,driven:false,co:null,tally:tallyNow(coOf(cr)),who:who(g),day:Math.floor(S.gameMin/1440)+1};watches.set(key,w)}
    w.i=cr.i;w.end=cr.end;w.driven=!!cr.driven;w.co=coOf(cr);w.n=n;
    let cur=curs.get(key);if(!cur){cur={site:key,who:w.who,day:w.day,party:crewOf(g,cr).map(a=>({name:a.name,cls:a.cls})),rooms:{},falls:[],fell:{},reached:0,end:null};curs.set(key,cur)}
    noteRun(cur,g,cr);return}
  if(!w)return;const now=tallyNow(w.co),k=KINDS.find((_,j)=>now[j]>w.tally[j]);
  const end=k?END[k]:w.end==='clear'?'clear':w.end==='wiped'?'wiped':w.end==='retreat'?(w.driven?'driven':'withdrawn'):null;
  if(end)lastRun[key]={end,i:end==='clear'?n:w.i,who:w.who,day:w.day};closeRun(key,n,end);watches.delete(key)}
export function trackCrawl(){
  if(CRYPT)track1(CRYPT.name,CRYPT.group,roomsOf(CRYPT).length);
  const L=S.sites&&S.sites.list;if(L)for(let i=0;i<L.length;i++){const s=L[i];if(s.group||watches.size)track1('site:'+s.id,s.group,s.rooms.length)}
  if(watches.size>(CRYPT&&watches.has(CRYPT.name)?1:0))for(const [k,w] of watches){if(k===(CRYPT&&CRYPT.name))continue; // a site gone from the list (a new world): close its run
    const id=+k.slice(5);if(!siteById(id))track1(k,null,w.n||0)}}
const curOf=s=>curs.get(keyOf(s))||null;
const runsOf=s=>{const k=keyOf(s);return runs.filter(r=>r.site===k)};
// "2 Crypt Shamblers, Bone Archer": the foes still standing, by kind (memoised on the standing count of the same array)
let sumFor=null,sumN=-1,sumText='';
function foeSummary(foes){let n=0;for(const f of foes)if(f.hp>0)n++;if(foes===sumFor&&n===sumN)return sumText;sumFor=foes;sumN=n;
  const by=new Map();const nameOf=f=>f.name||foeKind(f.type).name;for(const f of foes)if(f.hp>0)by.set(nameOf(f),(by.get(nameOf(f))||0)+1);
  sumText=[...by].map(([nm,c])=>{const k=foeKind(foes.find(f=>nameOf(f)===nm).type);return c>1&&nm===k.name?c+' '+k.pl:c>1?c+' '+nm:nm}).join(', ');return sumText}

// ---- the live state as data ----
const dayOf=t=>Math.floor((t||0)/1440)+1;
// A site with nobody inside: its own state (sim/sites.js) says more than the last run this page saw.
function siteQuiet(s,st,L){const nm=i=>(roomsOf(s)[i]||{}).name||'the dark';
  if(s.state==='cleared'){st.cleared=roomsOf(s).map(()=>true);st.status='Cleared'+(s.cleared?' on day '+dayOf(s.cleared.at)+(s.cleared.by?' by '+s.cleared.by:''):'')+': '+(s.boss||'its keeper')+' is destroyed. Only a ruin is left.';return}
  if(s.state==='collapsed'){st.status='Fallen in, never cleared: whatever was inside is buried for good.';return}
  if(L){const at=Math.min(L.i,roomsOf(s).length-1);for(let i=0;i<Math.min(L.i,roomsOf(s).length);i++)st.cleared[i]=true;st.last=L;
    st.status='Quiet. Last run (day '+L.day+'): '+L.who+(L.end==='wiped'?' were lost in ':L.end==='driven'?' were driven back from ':' withdrew from ')+nm(at)+'.';return}
  if(s.state==='hidden'){st.status='Hidden: no one has come upon it yet. '+(s.boss||'Its keeper')+' waits below.';return}
  if(s.state==='discovered'){st.status='Found'+(s.found?' on day '+dayOf(s.found.at)+' by '+s.found.by:'')+'; no one has gone down yet.';return}
  st.status='Quiet. Gone down '+(s.runs||0)+((s.runs||0)===1?' time':' times')+'; not cleared yet.'}
export function stateOf(s0=site||CRYPT){const s=fresh(s0),rooms=roomsOf(s),n=rooms.length,g=groupOf(s),cr=g&&g.crawl,cur=curOf(s);
  const st={company:'',phase:'empty',fog:-1,cur:-1,round:'',party:[],at:null,busy:false,cleared:rooms.map(()=>false),status:'',rooms:[]};
  const living=a=>a&&a.state!=='dead';
  const wait=!g&&isSite(s)?(S.companies||[]).find(C=>C.siteGo&&C.siteGo.site===s.id):null; // a company that voted to go down (sim/sites.js siteGo)
  if(g&&g.phase==='gather'){st.phase='gather';st.status=who(g)+' gather at the mouth ('+g.mem.length+').'}
  else if(wait){const L=members(wait),at=L.filter(a=>!a.hidden&&Math.hypot(a.x-s.x,a.y-s.y)<=3).length;st.phase='gather';
    st.status=(wait.name||'A company')+' gather at the mouth ('+at+' of '+L.length+' there); they go down once all stand at it.'}
  else if(g&&!cr){st.phase='roll';st.party=g.mem.filter(living);st.at='stair';st.cur=0;st.status=who(g)+' are inside ('+st.party.length+'); their run is settled by one roll.'}
  else if(cr){st.party=crewOf(g,cr).filter(living);st.company=coOf(cr)?coOf(cr).name:'';st.busy=!!S.table;const room=rooms[cr.i]||{};
    if(cr.end==='clear'){st.phase='clear';st.cleared=rooms.map(()=>true);st.cur=-1;st.spot=n-1;st.fog=-1;st.status=who(g)+' cleared every chamber!'}
    else{st.phase=g.tSite?'crawl':'stair';st.fog=cr.i;st.cur=cr.i;for(let i=0;i<cr.i;i++)st.cleared[i]=true;
      if(!g.tSite){st.at='stair';st.status=who(g)+' at the stair: the table decides how they go down.'}
      else if(cr.end==='wiped')st.status=who(g)+' fall in '+room.name+'.';
      else if(cr.end==='retreat')st.status=who(g)+(cr.driven?' are driven back from ':' fall back from ')+room.name+'.';
      else if(cr.gap>0&&!cr.foes)st.status='The way on is open: '+who(g)+' head for '+room.name+'.';
      else{const left=cr.foes?cr.foes.filter(f=>f.hp>0).length:0,R=room.rounds||2;
        st.round='ROUND '+Math.min(R,cr.rd+1)+'/'+R;st.status='Room '+(cr.i+1)+' of '+n+': '+room.name+' · round '+Math.min(R,cr.rd+1)+'/'+R+(cr.foes?' · '+left+(left===1?' foe stands':' foes stand'):'')}}}
  else{const L=lastRun[keyOf(s)],C=slotted()&&slotted().crawl;
    if(isSite(s)&&(s.state==='cleared'||s.state==='collapsed'||!L))siteQuiet(s,st,L);
    else if(L){const at=rooms[Math.min(L.i,n-1)];for(let i=0;i<Math.min(L.i,n);i++)st.cleared[i]=true;
      st.status='Quiet. Last run (day '+L.day+'): '+L.who+(L.end==='clear'?' cleared every chamber.':L.end==='wiped'?' were lost in '+(at?at.name:'the dark')+'.':(L.end==='driven'?' were driven back from ':' withdrew from ')+(at?at.name:'the dark')+'.');st.last=L}
    else if(live(s)&&C&&C.runs)st.status='Quiet. The Fellowship has gone down '+C.runs+(C.runs===1?' time':' times')+': '+C.clears+' cleared, '+(C.driven+C.withdrawn)+' turned back, '+C.wipes+' lost.';
    else st.status='Quiet. No one is inside.'}
  if(cr&&cr.foes&&!cr.end&&g.tSite&&cr.foes.length){st.foes=cr.foes;st.foeRoom=cr.i;st.foeText=foeSummary(cr.foes)}
  if(isSite(s)&&!cr&&s.grow>0&&s.state!=='cleared'&&s.state!=='collapsed')st.status+=' It has grown more dangerous for being left (+'+s.grow+(s.grow===1?' level).':' levels).');
  const run=cur||runsOf(s).pop();
  if(run&&run.falls.length){const per={};st.falls=run.falls.map(f=>({room:f.room,name:f.name,k:per[f.room]=(per[f.room]||-1)+1}))}
  st.rooms=rooms.map((r,i)=>({name:r.name,boss:!!r.boss,state:st.cleared[i]?'cleared':i===st.cur?'current':st.fog>=0&&i>st.fog?'unexplored':st.last&&i===st.last.i&&st.last.end!=='clear'?'lost':'room'}));
  return st}

// ---- what the watcher may read: a chamber's detail and the history (DOM-free) ----
const STATE_WORD={cleared:'Cleared',current:'Fight in progress',unexplored:'Not reached yet',lost:'Turned back here',room:'Quiet'};
const RESULT_WORD={cleared:'cleared',driven:'the party was driven back',lost:'the party was lost','fell back':'the party fell back'};
const foeLine=(f,live)=>{const k=foeKind(f.type),nm=f.name||k.name;
  return nm+' · '+k.role+(k.family?', '+k.family:'')+(live&&f.lvl?' · L'+f.lvl:'')+(live?' · HP '+Math.max(0,f.hp)+'/'+(f.hits||f.hp):'')};
// roomDetail(i): {i, title, kind, state, stateText, frame, foes:[text], notes:[text]} for chamber i of the site
const KIND_WORD={guard:'Guarded chamber',trap:'Trap chamber',puzzle:'Puzzle chamber',shrine:'Shrine',treasure:'Treasure chamber',boss:'Boss chamber'};
export function roomDetail(i,s0=site||CRYPT,st=stateOf(s0)){const s=fresh(s0),r=roomsOf(s)[i];if(!r)return null;
  const rs=st.rooms[i],fog=rs.state==='unexplored'&&!r.boss,sk=isSite(s);
  const kind=sk?KIND_WORD[roomKind(s,i)]+(r.alvl!=null?' · foes L'+(r.alvl+(s.grow||0)):''):r.boss?'Boss chamber':'Chamber';
  const d={i,title:fog?'Unexplored chamber':r.name,kind,state:rs.state,stateText:STATE_WORD[rs.state]||'',frame:fog?'':r.frame||'',foes:[],notes:[]};
  if(rs.state==='current'&&st.round)d.stateText+=' · '+st.round.toLowerCase();
  if(rs.state==='current'&&!st.foes)d.stateText='The party is heading here';
  if(st.foeRoom===i&&st.foes){for(const f of st.foes)if(f.hp>0)d.foes.push(foeLine(f,true));const down=st.foes.filter(f=>f.hp<=0).length;if(down)d.foes.push(down+(down===1?' foe':' foes')+' already down')}
  else if(!fog)for(const f of r.foes||[])d.foes.push((f.n>1?f.n+'x ':'')+foeLine(f,false));
  const cur=curOf(s),list=runsOf(s).concat(cur?[cur]:[]).reverse();
  for(const run of list){const rec=run.rooms[i],falls=run.falls.filter(f=>f.room===i);if(!rec&&!falls.length)continue;
    if(rec&&(rec.result||rec.rounds))d.notes.push('Day '+run.day+', '+run.who+': '+(RESULT_WORD[rec.result]||(run===cur?'fight under way':'fought here'))+(rec.rounds?' ('+rec.rounds+(rec.rounds===1?' round)':' rounds)'):''));
    for(const f of falls)d.notes.push(f.name+' fell here.');if(d.notes.length>=5)break}
  return d}
// historyOf(s): the crawls seen this session, newest first: {title, outcome, lines:[text]}
export function historyOf(s0=site||CRYPT){const s=fresh(s0),rooms=roomsOf(s),nm=i=>(rooms[i]||{}).name||'the dark',cur=curOf(s);
  return runsOf(s).concat(cur?[cur]:[]).reverse().map(run=>{
    const n=Object.keys(run.rooms).filter(j=>run.rooms[j].result==='cleared').map(Number).sort((a,b)=>a-b);
    const out=!run.end?'In progress':run.end==='clear'?'Cleared every chamber':run.end==='wiped'?'Lost in '+nm(run.reached):run.end==='driven'?'Driven back from '+nm(run.reached):run.end==='withdrawn'?'Withdrew from '+nm(run.reached):'Ended';
    return {title:'Day '+run.day+' · '+run.who,outcome:out,lines:['Entered: '+(run.party.map(p=>p.name).join(', ')||'-'),'Chambers cleared: '+(n.length?n.map(nm).join(', '):'none'),
      'Fell: '+(run.falls.length?run.falls.map(f=>f.name+' in '+nm(f.room)).join('; '):'no one')]}})}

// ---- the overlay ----
const mk=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
function build(){const scr=document.getElementById('screen');if(!scr)return false;
  root=mk('div','dgview');root.id='dungeon';root.hidden=true;root.setAttribute('role','region');root.setAttribute('aria-label','Dungeon view');
  cv=mk('canvas','dgcv');cv.setAttribute('aria-label','Map of the dungeon\'s chambers');ctx=cv.getContext('2d');
  const bar=mk('div','dgbar'),back=mk('button','dgback','◀ Back to world');back.type='button';back.onclick=e=>{e.stopPropagation();closeDungeon()};
  const txt=mk('div','dgtxt');nameEl=mk('b','dgname');statEl=mk('span','dgstat');txt.append(nameEl,' ',statEl);
  listEl=mk('ol','dgrooms');listEl.setAttribute('aria-label','Chambers');histBtn=mk('button','dghbtn','History');histBtn.type='button';histBtn.setAttribute('aria-expanded','false');histBtn.onclick=e=>{e.stopPropagation();histOpen=!histOpen;sig='';refreshDungeon()};
  bar.append(back,txt,histBtn,listEl);
  tipEl=mk('div','dgtip');tipEl.hidden=true;tipEl.setAttribute('aria-hidden','true');
  pinEl=mk('div','dgpin');pinEl.hidden=true;pinEl.setAttribute('role','region');pinEl.setAttribute('aria-label','Chamber detail');
  histEl=mk('div','dghist');histEl.hidden=true;histEl.setAttribute('role','region');histEl.setAttribute('aria-label','Dungeon history');
  root.append(cv,histEl,pinEl,tipEl,bar);
  cv.addEventListener('pointermove',onMove);cv.addEventListener('pointerleave',()=>{hov.room=-1;hov.foe=null;tipEl.hidden=true});
  cv.addEventListener('click',e=>{onMove(e);if(isArena(site))setPin(hov.key==null||hov.key===pin?-1:hov.key);else setPin(hov.room===pin?-1:hov.room)});
  // the world under it must not react: no hero picks, pans or zooms through the overlay
  for(const ev of ['click','pointerdown','pointermove','wheel'])root.addEventListener(ev,e=>e.stopPropagation(),ev==='wheel'?{passive:true}:undefined);
  const after=document.getElementById('cv');if(after&&after.nextSibling)scr.insertBefore(root,after.nextSibling);else scr.append(root);return true}
// Pointer to chamber: the pixel under the pointer, through the last frame's fit, to a tile; chambers have even regions.
function onMove(e){if(!fit||!site)return;if(isArena(site))return onArenaMove(e);const r=cv.getBoundingClientRect(),dpr=cv.width/Math.max(1,r.width),m=interiorOf(fresh(site)),st=stateOf(site);
  const wx=((e.clientX-r.left)*dpr-fit.ox)/fit.sc,wy=((e.clientY-r.top)*dpr-fit.oy)/fit.sc,tx=Math.floor(wx/T),ty=Math.floor(wy/T);
  hov.foe=foeAt(m,st,wx,wy);const reg=tx<0||ty<0||tx>=m.w||ty>=m.h?-1:m.reg[ty*m.w+tx];hov.room=hov.foe?st.foeRoom:reg>=0&&(reg&1)===0?reg>>1:-1;
  hov.x=e.clientX-root.getBoundingClientRect().left;hov.y=e.clientY-root.getBoundingClientRect().top;cv.style.cursor=hov.room>=0?'pointer':'default';placeTip(st)}
// The raid arena: the boss, a raider or an add under the pointer (the hit boxes of the last frame).
let arenaSt=null;
function onArenaMove(e){const r=cv.getBoundingClientRect(),dpr=cv.width/Math.max(1,r.width),wx=((e.clientX-r.left)*dpr-fit.ox)/fit.sc,wy=((e.clientY-r.top)*dpr-fit.oy)/fit.sc;
  hov.key=arenaHit(arenaSt,wx,wy);hov.room=-1;hov.x=e.clientX-root.getBoundingClientRect().left;hov.y=e.clientY-root.getBoundingClientRect().top;cv.style.cursor=hov.key!=null?'pointer':'default';placeArenaTip()}
function placeArenaTip(){if(!tipEl)return;const st=arenaSt;if(hov.key==null||hov.key===pin||!st){tipEl.hidden=true;return}const d=raidDetail(hov.key,st);if(!d){tipEl.hidden=true;return}
  const sg=hov.key+':'+d.stateText;if(sg!==tipSig){tipSig=sg;fillDetail(tipEl,d,st,true);tipEl.append(mk('div','dgdh','Click for the full detail'))}
  tipEl.hidden=false;const rw=root.clientWidth,rh=root.clientHeight,w=tipEl.offsetWidth,h=tipEl.offsetHeight,fx=hov.x+18+w>rw-4?hov.x-w-18:hov.x+18;
  tipEl.style.left=Math.max(4,Math.min(rw-w-4,fx))+'px';tipEl.style.top=Math.max(4,Math.min(rh-h-4,hov.y-h/2))+'px'}
function fillDetail(el,d,st,brief){el.textContent='';const t=mk('div','dgdt',d.title);const k=mk('div','dgdk',d.kind+' · '+d.stateText);el.append(t,k);
  if(d.frame&&!brief)el.append(mk('div','dgdf',d.frame));
  if(d.foes.length){el.append(mk('div','dgdh',d.foesHead||'Foes'));for(const f of d.foes)el.append(mk('div','dgdl',f))}
  if(d.notes.length&&!brief){el.append(mk('div','dgdh',d.notesHead||'What happened'));for(const n of d.notes)el.append(mk('div','dgdl',n))}
  if(!d.foes.length&&!(d.notes.length&&!brief))el.append(mk('div','dgdl',d.state==='unexplored'?'Nothing is known of it yet.':'Nothing is stirring here.'))}
function placeTip(st){if(!tipEl)return;if(hov.room<0||hov.room===pin&&!hov.foe){tipEl.hidden=true;return}
  const d=roomDetail(hov.room,site,st),sg=hov.room+':'+(hov.foe?hov.foe.hp:'')+':'+st.status+':'+(st.foes?st.foes.map(f=>f.hp).join():'');
  if(sg!==tipSig){tipSig=sg;if(hov.foe)d.foes=[foeLine(hov.foe,true)];fillDetail(tipEl,d,st,true);tipEl.append(mk('div','dgdh','Click for the full detail'))}
  tipEl.hidden=false;const rw=root.clientWidth,rh=root.clientHeight,w=tipEl.offsetWidth,h=tipEl.offsetHeight;
  const fx=hov.x+18+w>rw-4?hov.x-w-18:hov.x+18,fy=hov.y-h/2; // beside the pointer, never over it; to the other side at the edge
  tipEl.style.left=Math.max(4,Math.min(rw-w-4,fx))+'px';tipEl.style.top=Math.max(4,Math.min(rh-h-4,fy))+'px'}
function setPin(i){pin=i;sig='';refreshDungeon();tipEl.hidden=true}
export function pinRoom(i){setPin(i)}
// Client point (px) of chamber i's floor at (fx, fy) in 0..1 as the last frame laid it out, or null before one: for tests and shots.
export function roomPoint(i,fx=.5,fy=.5){if(!fit||!site||!cv)return null;const r=interiorOf(fresh(site)).rooms[i];if(!r)return null;const b=cv.getBoundingClientRect(),dpr=cv.width/Math.max(1,b.width);
  return {x:b.left+(fit.ox+(r.x+r.w*fx)*T*fit.sc)/dpr,y:b.top+(fit.oy+(r.y+r.h*fy)*T*fit.sc)/dpr}}
export function initDungeonView(){if(inited||typeof document==='undefined')return;inited=true;
  document.addEventListener('click',e=>{const t=e.target&&e.target.closest?e.target.closest('[data-dungeon]'):null;if(!t)return;
    const name=t.dataset.dungeon,sm=/^site:(\d+)$/.exec(name||''),ss=sm&&siteById(+sm[1]); // 'site:<id>': a DM-made site (#642)
    openDungeon(ss||LANDMARKS.find(L=>(L.kind==='crypt'||L.kind==='lair')&&L.name===name)||CRYPT)});
  document.addEventListener('keydown',e=>{if(open&&e.key==='Escape')closeDungeon()})}
export function openDungeon(s){if(!root&&!build())return false;site=s||CRYPT;open=true;sig='';pin=-1;root.hidden=false;
  const ar=isArena(site);root.classList.toggle('raid',ar);root.setAttribute('aria-label',ar?'Raid view':'Dungeon view');cv.setAttribute('aria-label',ar?'Map of the lair and the raid':"Map of the dungeon's chambers");listEl.setAttribute('aria-label',ar?'Raiders':'Chambers');
  const scr=document.getElementById('screen');if(scr)scr.classList.add('dgopen');refreshDungeon();return true}
export function closeDungeon(){open=false;hov.room=-1;hov.foe=null;hov.key=null;pin=-1;if(tipEl)tipEl.hidden=true;if(root)root.hidden=true;const scr=document.getElementById('screen');if(scr)scr.classList.remove('dgopen')}
export const dungeonOpen=()=>open;
export const dungeonSite=()=>open?site:null;
// The crypt whose mouth (its 3x3 rock patch, plus a little slack) is under tile (x, y).
export function cryptAt(x,y){for(const L of LANDMARKS){const m=L.kind==='crypt'&&L.mouth;if(m&&x>=m.x0-.3&&x<=m.x1+1.3&&y>=m.y0-.3&&y<=m.y1+1.3)return L}return null}

// The lair whose ring (its lava, plus a little slack) is under tile (x, y), for a click on the world map.
export function lairAt(x,y){for(const L of LANDMARKS)if(L.kind==='lair'&&Math.hypot(x-L.x,y-L.y)<=(L.r||5)+.5)return L;return null}

// The raid arena's bar: the status, one row per raider (fighting, on the way in, fled, fallen), the pinned detail, the history.
function refreshArena(){const st=raidState(site);arenaSt=st;const rows=raidRows(st);
  const s=st.company+'|'+st.status+'|'+rows.map(r=>r.key+r.state+r.label).join(',')+'|'+pin+'|'+histOpen+'|'+(pin!==-1?(raidDetail(pin,st)||{}).stateText:'');if(s===sig)return st;sig=s;
  nameEl.textContent=String(st.boss?st.boss.name+'’s lair':site.name||'Lair').toUpperCase()+(st.company?' · '+st.company.toUpperCase():'');statEl.textContent=st.status;
  while(listEl.children.length>rows.length)listEl.removeChild(listEl.children[listEl.children.length-1]); // (children read fresh: a stub DOM's list may not be live)
  rows.forEach((r,i)=>{let li=listEl.children[i];if(!li){li=mk('li');listEl.append(li)}
    li.className='dgroom raider '+r.state+(pin===r.key?' pinned':'');if(!li.onclick){li.tabIndex=0;li.setAttribute('role','button');li.onclick=e=>{e.stopPropagation();const k=li.dataset.k,key=k!==''&&!isNaN(+k)?+k:k;setPin(pin===key?-1:key)};li.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();li.click()}}}
    li.dataset.k=String(r.key);li.textContent=r.label;li.title=r.title;li.setAttribute('aria-label',r.title);if(li.style.setProperty)li.style.setProperty('--cc',classColor(r.cls))});
  histBtn.textContent='History ('+raidHistory().length+')';histBtn.setAttribute('aria-expanded',String(histOpen));
  const d=pin!==-1?raidDetail(pin,st):null;
  if(d){fillDetail(pinEl,d,st);const x=mk('button','dgx','x');x.type='button';x.setAttribute('aria-label','Close the detail');x.onclick=e=>{e.stopPropagation();setPin(-1)};pinEl.prepend(x);pinEl.hidden=false}else pinEl.hidden=true;
  if(histOpen){histEl.textContent='';histEl.append(mk('div','dgdt','Raids'));const H=raidHistory();
    if(!H.length)histEl.append(mk('div','dgdl','No raid has come to the lair while this page was watching.'));
    for(const h of H){histEl.append(mk('div','dgdh',h.title+' · '+h.outcome));for(const l of h.lines)histEl.append(mk('div','dgdl',l))}histEl.hidden=false}else histEl.hidden=true;
  return st}

// The bar and the room list: patched only when the words change.
export function refreshDungeon(){if(!root||!open)return null;if(isArena(site))return refreshArena();const D=fresh(site),st=stateOf(D),cur=curOf(D);
  const s=st.company+'|'+st.status+'|'+st.rooms.map(r=>r.state).join(',')+'|'+pin+'|'+histOpen+'|'+(st.foes?st.foes.map(f=>f.hp).join():'')+'|'+runs.length+(cur?cur.reached+':'+cur.falls.length:'');if(s===sig)return st;sig=s;
  nameEl.textContent=String(D.name||'Dungeon').toUpperCase()+(isSite(D)?' · '+String(D.label||D.theme).toUpperCase()+' L'+D.band[0]+'-'+D.band[1]:'')+(st.company?' · '+st.company.toUpperCase():'');statEl.textContent=st.status;
  while(listEl.children.length>st.rooms.length)listEl.removeChild(listEl.children[listEl.children.length-1]);
  st.rooms.forEach((r,i)=>{let li=listEl.children[i];if(!li){li=mk('li');listEl.append(li)}
    const label=(st.fog>=0&&i>st.fog?'?':r.name.replace(/^the /i,''))+(r.boss?' ☠':''),word={cleared:'cleared',current:'in progress',unexplored:'not reached yet',lost:'turned back here',room:''}[r.state];
    li.className='dgroom '+r.state+(r.boss?' boss':'')+(pin===i?' pinned':'');if(!li.onclick){li.tabIndex=0;li.setAttribute('role','button');li.onclick=e=>{e.stopPropagation();const k=Number(li.dataset.k);setPin(pin===k?-1:k)};li.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();li.click()}}}
    li.dataset.k=String(i);li.textContent=(i+1)+'. '+label;li.title=r.name+(word?' · '+word:'')+(r.boss?' · boss chamber':'');
    li.setAttribute('aria-label',r.name+(word?', '+word:'')+(r.boss?', boss chamber':''))});
  histBtn.textContent='History ('+(runsOf(D).length+(cur?1:0))+')';histBtn.setAttribute('aria-expanded',String(histOpen));
  if(pin>=0){fillDetail(pinEl,roomDetail(pin,D,st),st);const x=mk('button','dgx','x');x.type='button';x.setAttribute('aria-label','Close the chamber detail');x.onclick=e=>{e.stopPropagation();setPin(-1)};pinEl.prepend(x);pinEl.hidden=false}else pinEl.hidden=true;
  if(histOpen){histEl.textContent='';histEl.append(mk('div','dgdt','History'));const H=historyOf(D);
    if(!H.length)histEl.append(mk('div','dgdl','No one has gone down while this page was watching.'));
    for(const h of H){histEl.append(mk('div','dgdh',h.title+' · '+h.outcome));for(const l of h.lines)histEl.append(mk('div','dgdl',l))}histEl.hidden=false}else histEl.hidden=true;
  return st}

// One frame: fit the interior below the Table banner and above the bar.
export function drawDungeon(now){if(!open||!root)return;const st=refreshDungeon();
  const dpr=window.devicePixelRatio||1,r=root.getBoundingClientRect(),W=Math.max(1,Math.round(r.width*dpr)),H=Math.max(1,Math.round(r.height*dpr));
  if(cv.width!==W||cv.height!==H){cv.width=W;cv.height=H}
  const ban=document.getElementById('tbanner'),top=ban&&!ban.hidden?(ban.offsetHeight+12)*dpr:8*dpr,bar=root.querySelector('.dgbar'),bot=(bar?bar.offsetHeight:0)*dpr+8*dpr;
  ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='rgb(6,6,11)';ctx.fillRect(0,0,W,H);
  const tp=Math.round(top/dpr),bp=Math.round((bar?bar.offsetHeight:0));
  if(tp!==topPx||bp!==barPx){topPx=tp;barPx=bp;root.style.setProperty('--dgtop',tp+'px');const scr=document.getElementById('screen');if(scr)scr.style.setProperty('--dgbar',bp+'px')}
  if(isArena(site)){fit=drawArena(ctx,{x:8*dpr,y:top,w:W-16*dpr,h:Math.max(40,H-top-bot)},arenaOf(site),st,now,dpr);if(hov.key!=null&&!tipEl.hidden)placeArenaTip();return}
  st.hover=hov.room;st.pin=pin;
  const m=interiorOf(fresh(site));fit=drawInterior(ctx,{x:8*dpr,y:top,w:W-16*dpr,h:Math.max(40,H-top-bot)},m,st,now,dpr);
  if(hov.room>=0&&!tipEl.hidden)placeTip(st)}

// The DM-made site (#642) whose mouth is under tile (x, y), for a click on the world map; a collapsed one is gone.
export function siteAt(x,y){const L=S.sites&&S.sites.list;if(!L)return null;for(const s of L)if(s.state!=='collapsed'&&Math.abs(x-s.x)<=1.1&&Math.abs(y-s.y)<=1.1)return s;return null}
