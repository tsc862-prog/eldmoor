// The dungeon view (#85, slice 1): a dungeon's interior over the world canvas, with the crawl drawn live.
//   openDungeon(site?)  show it (site: a crypt landmark; default the Sunken Crypt, CRYPT); closeDungeon()
//   dungeonOpen()       true while it is showing (render/draw.js then draws it instead of the world)
//   drawDungeon(now)    one frame (called by the renderer); refreshDungeon() updates the bar and room list only
//   cryptAt(x, y)       the crypt landmark whose mouth is at tile (x, y), for a click on the world map
//   stateOf(site)       the live state as plain data (DOM-free): phase, rooms reached/cleared, round, party, status
//   trackCrawl()        called every frame: remembers how the last crawl it saw ended (the sim keeps only totals)
//   initDungeonView()   once: any element with a data-dungeon attribute opens the view on click (the hero card's
//                       "View inside", the Table banner's crawl button), Escape closes it
// Read-only on the sim: reads CRYPT.group and its crawl (sim/crawl.js), S.table and S.fellowship.crawl.
// The overlay sits inside #screen right after the world canvas, so the Table banner and alerts stay on top of it.
import {CRYPT,LANDMARKS} from '../world/map.js';
import {buildInterior} from '../world/interior.js';
import {S} from '../sim/state.js';
import {drawInterior} from './interior.js';

let root=null,cv=null,ctx=null,nameEl=null,statEl=null,listEl=null,site=null,open=false,inited=false,sig='';
const roomsOf=s=>(s&&s.rooms)||[];
const live=s=>!!(CRYPT&&s&&s.name===CRYPT.name);
const who=g=>g.name||(g.guild?'<'+g.guild.tag+'> '+g.guild.name:'A group');

// ---- how the last crawl ended (the sim clears CRYPT.group at once; S.fellowship.crawl keeps counts only) ----
const KINDS=['clears','driven','withdrawn','wipes'],END={clears:'clear',driven:'driven',withdrawn:'withdrawn',wipes:'wiped'};
const lastRun={};let watch=null;
const tallyNow=()=>{const C=S.fellowship&&S.fellowship.crawl;return KINDS.map(k=>C?C[k]||0:0)};
export function trackCrawl(){const g=CRYPT&&CRYPT.group,cr=g&&g.crawl;
  if(cr){watch={name:CRYPT.name,i:cr.i,end:cr.end,driven:!!cr.driven,tally:watch&&watch.name===CRYPT.name&&watch.tally||tallyNow(),who:who(g),day:Math.floor(S.gameMin/1440)+1};return}
  if(!watch)return;const now=tallyNow(),k=KINDS.find((_,j)=>now[j]>watch.tally[j]);
  const end=k?END[k]:watch.end==='clear'?'clear':watch.end==='wiped'?'wiped':watch.end==='retreat'?(watch.driven?'driven':'withdrawn'):null;
  if(end)lastRun[watch.name]={end,i:end==='clear'?roomsOf(CRYPT).length:watch.i,who:watch.who,day:watch.day};watch=null}

// ---- the live state as data ----
export function stateOf(s=site||CRYPT){const rooms=roomsOf(s),n=rooms.length,g=live(s)?CRYPT.group:null,cr=g&&g.crawl;
  const st={phase:'empty',fog:-1,cur:-1,round:'',party:[],at:null,busy:false,cleared:rooms.map(()=>false),status:'',rooms:[]};
  const living=a=>a&&a.state!=='dead';
  if(g&&g.phase==='gather'){st.phase='gather';st.status=who(g)+' gather at the mouth ('+g.mem.length+').'}
  else if(g&&!cr){st.phase='roll';st.party=g.mem.filter(living);st.at='stair';st.cur=0;st.status=who(g)+' are inside ('+st.party.length+'); their run is settled by one roll.'}
  else if(cr){st.party=g.mem.filter(living);st.busy=!!S.table;const room=rooms[cr.i]||{};
    if(cr.end==='clear'){st.phase='clear';st.cleared=rooms.map(()=>true);st.cur=-1;st.spot=n-1;st.fog=-1;st.status=who(g)+' cleared every chamber!'}
    else{st.phase=g.tSite?'crawl':'stair';st.fog=cr.i;st.cur=cr.i;for(let i=0;i<cr.i;i++)st.cleared[i]=true;
      if(!g.tSite){st.at='stair';st.status=who(g)+' at the stair: the table decides how they go down.'}
      else if(cr.end==='wiped')st.status=who(g)+' fall in '+room.name+'.';
      else if(cr.end==='retreat')st.status=who(g)+(cr.driven?' are driven back from ':' fall back from ')+room.name+'.';
      else if(cr.gap>0&&!cr.foes)st.status='The way on is open: '+who(g)+' head for '+room.name+'.';
      else{const left=cr.foes?cr.foes.filter(f=>f.hp>0).length:0,R=room.rounds||2;
        st.round='ROUND '+Math.min(R,cr.rd+1)+'/'+R;st.status='Room '+(cr.i+1)+' of '+n+': '+room.name+' · round '+Math.min(R,cr.rd+1)+'/'+R+(cr.foes?' · '+left+(left===1?' foe stands':' foes stand'):'')}}}
  else{const L=lastRun[s.name],C=S.fellowship&&S.fellowship.crawl;
    if(L){const at=rooms[Math.min(L.i,n-1)];for(let i=0;i<Math.min(L.i,n);i++)st.cleared[i]=true;
      st.status='Quiet. Last run (day '+L.day+'): '+L.who+(L.end==='clear'?' cleared every chamber.':L.end==='wiped'?' were lost in '+(at?at.name:'the dark')+'.':(L.end==='driven'?' were driven back from ':' withdrew from ')+(at?at.name:'the dark')+'.');st.last=L}
    else if(live(s)&&C&&C.runs)st.status='Quiet. The Fellowship has gone down '+C.runs+(C.runs===1?' time':' times')+': '+C.clears+' cleared, '+(C.driven+C.withdrawn)+' turned back, '+C.wipes+' lost.';
    else st.status='Quiet. No one is inside.'}
  st.rooms=rooms.map((r,i)=>({name:r.name,boss:!!r.boss,state:st.cleared[i]?'cleared':i===st.cur?'current':st.fog>=0&&i>st.fog?'unexplored':st.last&&i===st.last.i&&st.last.end!=='clear'?'lost':'room'}));
  return st}

// ---- the overlay ----
const mk=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
function build(){const scr=document.getElementById('screen');if(!scr)return false;
  root=mk('div','dgview');root.id='dungeon';root.hidden=true;root.setAttribute('role','region');root.setAttribute('aria-label','Dungeon view');
  cv=mk('canvas','dgcv');cv.setAttribute('aria-label','Map of the dungeon\'s chambers');ctx=cv.getContext('2d');
  const bar=mk('div','dgbar'),back=mk('button','dgback','◀ Back to world');back.type='button';back.onclick=e=>{e.stopPropagation();closeDungeon()};
  const txt=mk('div','dgtxt');nameEl=mk('b','dgname');statEl=mk('span','dgstat');txt.append(nameEl,' ',statEl);
  listEl=mk('ol','dgrooms');listEl.setAttribute('aria-label','Chambers');bar.append(back,txt,listEl);root.append(cv,bar);
  // the world under it must not react: no hero picks, pans or zooms through the overlay
  for(const ev of ['click','pointerdown','pointermove','wheel'])root.addEventListener(ev,e=>e.stopPropagation(),ev==='wheel'?{passive:true}:undefined);
  const after=document.getElementById('cv');if(after&&after.nextSibling)scr.insertBefore(root,after.nextSibling);else scr.append(root);return true}
export function initDungeonView(){if(inited||typeof document==='undefined')return;inited=true;
  document.addEventListener('click',e=>{const t=e.target&&e.target.closest?e.target.closest('[data-dungeon]'):null;if(!t)return;
    const name=t.dataset.dungeon;openDungeon(LANDMARKS.find(L=>L.kind==='crypt'&&L.name===name)||CRYPT)});
  document.addEventListener('keydown',e=>{if(open&&e.key==='Escape')closeDungeon()})}
export function openDungeon(s){if(!root&&!build())return false;site=s||CRYPT;open=true;sig='';root.hidden=false;
  const scr=document.getElementById('screen');if(scr)scr.classList.add('dgopen');refreshDungeon();return true}
export function closeDungeon(){open=false;if(root)root.hidden=true;const scr=document.getElementById('screen');if(scr)scr.classList.remove('dgopen')}
export const dungeonOpen=()=>open;
export const dungeonSite=()=>open?site:null;
// The crypt whose mouth (its 3x3 rock patch, plus a little slack) is under tile (x, y).
export function cryptAt(x,y){for(const L of LANDMARKS){const m=L.kind==='crypt'&&L.mouth;if(m&&x>=m.x0-.3&&x<=m.x1+1.3&&y>=m.y0-.3&&y<=m.y1+1.3)return L}return null}

// The bar and the room list: patched only when the words change.
export function refreshDungeon(){if(!root||!open)return null;const st=stateOf(site);
  const s=st.status+'|'+st.rooms.map(r=>r.state).join(',');if(s===sig)return st;sig=s;
  nameEl.textContent=String(site.name||'Dungeon').toUpperCase();statEl.textContent=st.status;
  const lis=listEl.children;while(lis.length>st.rooms.length)listEl.removeChild(lis[lis.length-1]);
  st.rooms.forEach((r,i)=>{let li=listEl.children[i];if(!li){li=mk('li');listEl.append(li)}
    const label=(st.fog>=0&&i>st.fog?'?':r.name.replace(/^the /i,''))+(r.boss?' ☠':''),word={cleared:'cleared',current:'in progress',unexplored:'not reached yet',lost:'turned back here',room:''}[r.state];
    li.className='dgroom '+r.state+(r.boss?' boss':'');li.dataset.k=String(i);li.textContent=(i+1)+'. '+label;li.title=r.name+(word?' · '+word:'')+(r.boss?' · boss chamber':'');
    li.setAttribute('aria-label',r.name+(word?', '+word:'')+(r.boss?', boss chamber':''))});
  return st}

// One frame: fit the interior below the Table banner and above the bar.
export function drawDungeon(now){if(!open||!root)return;const st=refreshDungeon();
  const dpr=window.devicePixelRatio||1,r=root.getBoundingClientRect(),W=Math.max(1,Math.round(r.width*dpr)),H=Math.max(1,Math.round(r.height*dpr));
  if(cv.width!==W||cv.height!==H){cv.width=W;cv.height=H}
  const ban=document.getElementById('tbanner'),top=ban&&!ban.hidden?(ban.offsetHeight+12)*dpr:8*dpr,bar=root.querySelector('.dgbar'),bot=(bar?bar.offsetHeight:0)*dpr+8*dpr;
  ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='rgb(6,6,11)';ctx.fillRect(0,0,W,H);
  const m=buildInterior(site);drawInterior(ctx,{x:8*dpr,y:top,w:W-16*dpr,h:Math.max(40,H-top-bot)},m,st,now,dpr)}
