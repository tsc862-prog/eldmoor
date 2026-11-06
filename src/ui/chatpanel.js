// The Fellowship chat panel (#169): the whole conversation in one stream, always one click away, plus the
// DM agent's actions as a sibling tab. A side-column panel under the Fellowship panel, open by default.
//   Chat tab   party lines, members speaking aloud, the Narrator and DM-voiced characters, Table scene lines, and
//              the party's proposals, votes and results as small system lines. Filters: All, Party, Aloud, DM, Table.
//              A Table scene reads as one exchange (#734): a header (title, kind, where; live: who it waits for), the DM's
//              frame (a vote: the proposal), the members' lines with their act dimmed, and the result; the group stays together.
//              Newest first, newest on top (owner). At the top, new lines simply appear there; scrolled down to read
//              older lines the line being read stays put and a "N new lines" chip scrolls back up. Rows are patched in place (stable.js).
//   DM agent   the DM agent's entries from the DM log (intent, notes, levers pulled or refused, scenes, narration),
//              newest first, one line each, a click opens the detail; the scripted DM's entries are behind a toggle, dimmed.
// Pure view: reads S, the sim never imports this. The dossier's Chat tab uses the same line builder (panels.chatLine).
import {S} from '../sim/index.js';
import {chatVisible} from '../core/chatview.js';
import {chatLine,chatName,liveOf} from './panels.js';
import {daySep,dayOf,stampOf} from './daystamp.js';
import {patch,held,keyOf} from './stable.js';
import {classColor,DISP} from '../core/colors.js';
import {companies,companyOf,inSlots,slotted} from '../sim/company.js';
import {companyLabel} from './companyview.js';
import {dmTable,dmParts,dmBadge,dmByAgent} from './dmpanel.js';
import {dmTurns,dmTurnsVer,turnCard} from './dmturns.js'; // per-turn cards (#181)
import {openScenes,sceneFrame,waitingFor,bannerOf} from '../sim/table.js';

const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
const WKEY='eldmoor.chatTall';let wide=false;try{wide=localStorage.getItem(WKEY)==='1'}catch(e){} // the chat's height under the map, per viewer
const KEEP=400; // lines kept in the stream
export const FILTERS=[['all','All'],['party','Party'],['aloud','Aloud'],['dm','DM'],['table','Table']];
let filter='all',tab='chat',showScripted=false,items=[],seq=0,known=new WeakSet(),box,list,chip,newN=0,sig='',dmSig='',dmList,dmBar,openDm=new Set(),dmView='turns',turnList,tSig='';
export const chatFilter=()=>filter;

// ---- the stream ----
const minOf=e=>{const m=/(\d\d):(\d\d)$/.exec(String(e.t||''));return m?(+m[1])*60+(+m[2]):null};
const sortKey=e=>e.d!=null&&minOf(e)!=null?(e.d-1)*1440+minOf(e):S.gameMin; // an old entry with no day sorts by when it was first seen
// A line's categories (the filters), from what the sim tagged it with.
export function catsOf(e){const f=e.from||{},c=new Set();
  if(e.party)c.add('party');
  if(e.dm||f.kind==='dm'||f.kind==='npc'||e.trigger==='dm'||e.trigger==='npc')c.add('dm');
  if(e.scene)c.add('table');
  if(!c.has('party')&&!c.has('dm')&&!e.scene)c.add('aloud');
  return c}
function ingest(){for(const a of S.agents){if(!inSlots(a)||!a.chat)continue;for(const e of a.chat){if(known.has(e))continue;known.add(e);items.push({k:sortKey(e),n:++seq,kind:'chat',e})}}
  items.sort((x,y)=>x.k-y.k||x.n-y.n);if(items.length>KEEP)items.splice(0,items.length-KEEP)}
// The council as system lines, made from the proposals themselves (no second record): "Garrwen proposes: ... [job · vote open]",
// "Kerin votes yes: reason" (the proposer's own automatic yes is left out), "Passed 4-1".
const stamp=gm=>({d:Math.floor(gm/1440)+1,t:String(Math.floor(gm%1440/60)).padStart(2,'0')+':'+String(Math.floor(gm%60)).padStart(2,'0')});
function councilItems(){const F=slotted(),out=[];if(!F||!F.props)return out;const VS=voteScenes(F);
  for(const P of F.props){const by=S.agents.find(a=>a.id===P.by),st=P.status==='open'?'vote open':P.status,r=VS.get(P.id),g=r?r.key:null;
    // a vote played at the table (#734): the proposal is the scene's question and its result the scene's result (Table and Party);
    // the single votes stay under Party (under All and Table each voter's line or act says it, with the vote dimmed)
    out.push({k:P.at,n:-3,kind:'prop',id:'p'+P.id,P,who:by||{name:P.byName||'?'},cats:g?['party','table']:['party'],text:' proposes: '+P.details+(g?'':' ['+P.kind+' · '+st+']'),gm:P.at,g});
    for(const id in P.votes){const v=P.votes[id],h=S.agents.find(a=>String(a.id)===String(id));if(!h)continue;
      if(h.id===P.by&&v.v==='yes'&&!v.reason)continue;
      const gm=v.at!=null?v.at:P.done!=null?P.done:P.at;
      out.push({k:gm,n:-2,kind:'vote',id:'v'+P.id+'-'+id,P,who:h,cats:['party'],text:' votes '+v.v+(v.reason?': '+v.reason:''),gm,g,...(g&&(r.ids||[]).includes(h.id)?{allHide:true}:{})})}
    if(P.status!=='open'&&P.result){const m=/^(Passed|Failed) (\d+-\d+)/.exec(P.result);
      out.push({k:P.done!=null?P.done:P.at,n:-1,kind:'result',id:'r'+P.id,P,cats:g?['party','table']:['party'],text:g?P.result:m?m[1]+' '+m[2]:P.status==='passed'?'Passed':'Failed',gm:P.done!=null?P.done:P.at,g})}}
  return out}
// ---- Table scenes as one exchange (#734) ----
// A company's scenes: the closed ones from the sim's write-only record (S.tableLog) and the open ones as they stand.
const KINDW={decision:'vote',choice:'choice',check:'check',site:'Crypt stair',room:'Crypt room',crawl:'crawl',boss:'boss',elite:'elite foe',ambush:'ambush',rescue:'rescue'};
export const kindWord=k=>KINDW[k]||k;
const hero=id=>S.agents.find(a=>a.id===id);
function liveState(sc){if(sc.phase==='frame')return 'the DM sets the scene';if(sc.phase!=='turn')return '';
  const L=sc.ids.map(hero).filter(a=>a&&a.state!=='dead');
  if(sc.all){if(sc.resolved)return 'everyone has answered';const done=L.filter(a=>sc.acts[a.id]).length,w=waitingFor(sc).map(a=>a.name);
    return done+'/'+L.length+' answered'+(w.length?' · waiting for '+w.join(', '):'')}
  const cur=hero(sc.ids[sc.i]);return (sc.rd!=null?'round '+sc.rd+' · ':'')+(cur?cur.name+'’s turn':'')}
const firstActs=beats=>{const seen=new Set(),out=[];for(const b of beats||[]){if(b.by==='foe'||b.by==='cond'||(b.rd||1)!==1||seen.has(b.id))continue;seen.add(b.id);
  out.push({id:b.id,name:b.name,k:b.k==='a'||b.k==='b'?String(b.text||b.k).slice(0,40):b.k,by:b.by,said:!!b.line})}return out};
export function scenesOf(F){if(!F)return [];const out=[],have=new Set();
  for(const r of S.tableLog||[])if(r&&r.company===F.id){out.push(r);have.add(r.key)}
  for(const sc of openScenes()){if(!sc||sc.company!==F.id)continue;const key=sc.company+':'+sc.id;if(have.has(key))continue;const b=bannerOf(sc);
    out.push({key,company:sc.company,kind:sc.kind,title:sc.title,frame:sceneFrame(sc),at:sc.at,where:b&&b.where,ids:sc.ids.slice(),...(sc.ctx&&sc.ctx.prop!=null?{prop:sc.ctx.prop}:{}),acts:firstActs(sc.beats),result:null,live:liveState(sc)})}
  return out}
function voteScenes(F){const m=new Map();for(const r of scenesOf(F))if(r.prop!=null)m.set(r.prop,r);return m}
const headText=r=>[r.title,kindWord(r.kind),r.where].filter(Boolean).join(' · ');
// The rows a scene adds besides the members' lines: the header, the frame (a vote's question is its proposal row), the
// acts of members who said nothing (a reflex: "(reflex: no)"), and the result (a vote's is its result row).
function sceneItems(F,said){const out=[];
  for(const r of scenesOf(F)){const vote=r.kind==='decision',g=r.key,at=r.at!=null?r.at:S.gameMin;
    out.push({k:at,n:-9,kind:'sch',id:'sh'+g,g,r,gm:at,cats:vote?['table','party']:['table'],text:headText(r),live:r.live||''});
    if(!vote&&r.frame)out.push({k:at,n:-8,kind:'scf',id:'sf'+g,g,r,gm:at,cats:['table'],text:r.frame});
    for(const x of r.acts||[]){if(said.has(g+':'+x.id))continue;const h=hero(x.id)||{name:x.name};
      out.push({k:at,n:-4,kind:'sca',id:'sa'+g+'-'+x.id,g,r,who:h,gm:at,cats:['table'],text:'',opt:x.k,rfx:x.by!=='agent'})}
    if(!vote&&r.result)out.push({k:r.end!=null?r.end:at,n:9,kind:'scr',id:'sr'+g,g,r,gm:r.end!=null?r.end:at,cats:['table'],text:r.result})}
  return out}
const saidSet=()=>{const m=new Set();for(const it of items)if(it.e.sk)m.add(it.e.sk+':'+(it.e.from&&it.e.from.id));return m};
// Groups stay together: a scene's rows in reading order (header, question, lines and acts as they came, result), placed in
// the stream where the scene opened. Returns [{it, cls, day}] newest first, for the panel and the dossier alike.
const RANK={sch:0,scf:1,prop:1,scr:3,result:3};
// A group in reading order: header, question, then the lines as spoken with each silent member's act at its seat in the
// first round (a later round starts when the seat order turns back), then the result.
function order(rows){const rk=x=>RANK[x.kind]??2,ref=(rows.find(x=>x.r)||{}).r,ids=ref&&ref.ids||[];
  const seat=x=>{const h=x.kind==='chat'?x.e.from:x.who,i=h?ids.indexOf(h.id):-1;return i<0?99:i};
  const head=rows.filter(x=>rk(x)<2).sort((x,y)=>rk(x)-rk(y)||x.k-y.k||x.n-y.n),tail=rows.filter(x=>rk(x)>2).sort((x,y)=>x.k-y.k||x.n-y.n);
  const acts=rows.filter(x=>x.kind==='sca').sort((x,y)=>seat(x)-seat(y)),said=rows.filter(x=>rk(x)===2&&x.kind!=='sca').sort((x,y)=>x.k-y.k||x.n-y.n);
  const mid=[];let ai=0,prev=-1,r1=true;
  for(const x of said){const s=seat(x);if(r1&&s<prev)r1=false;while(r1&&ai<acts.length&&seat(acts[ai])<s)mid.push(acts[ai++]);mid.push(x);prev=s}
  while(ai<acts.length)mid.push(acts[ai++]);
  return head.concat(mid,tail)}
export function arrange(rows){const units=[],by=new Map();
  for(const it of rows){const g=it.g||(it.kind==='chat'&&it.e.sk);if(!g){units.push({one:it});continue}
    let u=by.get(g);if(!u){u={g,rows:[]};by.set(g,u);units.push(u)}u.rows.push(it)}
  const out=[];for(let i=units.length-1;i>=0;i--){const u=units[i];if(u.one){out.push({it:u.one,cls:''});continue}
    const R=order(u.rows),d=R[0].kind==='chat'?dayOf(R[0].e):Math.floor(R[0].gm/1440)+1;
    R.forEach((it,j)=>out.push({it,cls:'scg'+(it.kind==='sch'?' scg-h':'')+(RANK[it.kind]===3?' scg-r':'')+(j===R.length-1?' scg-end':''),day:d}))}
  return out}
// One row of the stream, grouped or not.
export function rowEl({it,cls}){const li=it.kind==='chat'?shoutLine(it.e):it.kind==='sch'?headRow(it):it.kind==='scf'?frameRow(it):it.kind==='sca'?actRow(it):sysLine(it);
  if(cls)for(const c of cls.split(' '))li.classList.add(c);return li}
function headRow(it){const li=el('li','chl sys sys-sch');li.setAttribute('data-k',it.id);const s=stamp(it.gm);li.append(el('time',null,stampOf({d:s.d,t:s.t})));
  li.append(el('span','scgt','TABLE'),' '+it.text);if(it.live)li.append(el('span','dm sclive',' · '+it.live));return li}
function frameRow(it){const li=el('li','chl scf');li.setAttribute('data-k',it.id);const s=stamp(it.gm);li.append(el('time',null,stampOf({d:s.d,t:s.t})),el('span','gd chn','DM'),': ',el('span','scft',it.text));return li}
function actRow(it){const li=el('li','chl sys sys-sca');li.setAttribute('data-k',it.id);const s=stamp(it.gm);li.append(el('time',null,stampOf({d:s.d,t:s.t})));
  const n=chatName(it.who);n.classList.remove('chn');li.append(n,' ',optTag(it.opt,it.rfx));return li}
export const optTag=(k,rfx)=>el('span','dm chopt','('+(rfx?'reflex: ':'')+String(k).replace(/^use:/,'use ')+')');
const matches=(it)=>{if(filter==='all')return !it.allHide;const c=it.kind==='chat'?catsOf(it.e):it.cats;return c.has?c.has(filter):c.includes(filter)};
const visible=it=>it.kind!=='chat'||chatVisible(it.e,S);
export const streamItems=()=>{ingest();return items.concat(councilItems(),sceneItems(slotted(),saidSet())).filter(visible).filter(matches).sort((x,y)=>x.k-y.k||x.n-y.n)};
// The dossier's Chat tab (#181): the same stream, filtered to one hero: what it said or heard (its own chat buffer),
// and the council lines it proposed or voted. Newest first like the panel; the panel's channel filter does not apply.
// A scene it sat in brings its header, question and result around its line (#734); a vote it gave at the table shows once.
export function heroStream(a){ingest();const mine=new Set(a.chat||[]),F=slotted(),sat=new Set(scenesOf(F).filter(r=>(r.ids||[]).includes(a.id)).map(r=>r.key));
  return items.concat(councilItems(),sceneItems(F,saidSet())).filter(visible).filter(it=>it.kind==='chat'?(mine.has(it.e)||it.e.from===a):
      it.kind==='sch'||it.kind==='scf'||it.kind==='scr'?sat.has(it.g):it.kind==='sca'?it.who===a&&sat.has(it.g):it.g&&(it.kind==='prop'||it.kind==='result')?sat.has(it.g):
      it.allHide?false:(it.who===a||it.kind==='result'&&it.P.votes&&it.P.votes[a.id]!=null))
    .sort((x,y)=>x.k-y.k||x.n-y.n)}
// A shout names its company when more than one exists (#506): "Kerin (Ashen Road) shouts: ...". '' in a together world.
export function shoutCompany(e){if(!e||!e.party||e.courier||!e.from||e.from.kind==='dm'||companies().length<2)return '';const C=companyOf(e.from);return C?companyLabel(C):''}
export function shoutLine(e){const li=chatLine(e,1),c=shoutCompany(e);
  if(c){const nm=li.children&&li.children[1],sp=el('span','dm chco',' ('+c+')');if(nm&&li.insertBefore)li.insertBefore(sp,nm.nextSibling||null);else li.append(sp)}return li}
export {sysLine};

function sysLine(it){const li=el('li','chl sys sys-'+it.kind);li.setAttribute('data-k',it.id);const s=stamp(it.gm);
  li.append(el('time',null,stampOf({d:s.d,t:s.t})));
  if(it.who){const n=chatName(it.who);n.classList.remove('chn');li.append(n)}
  li.append(it.text);return li}

// ---- rendering the Chat tab ----
function atTop(){return !list||list.scrollTop<=6}
const rowsIn=()=>Array.from(list.children||[]).filter(c=>!(c.classList&&c.classList.contains('daysep'))).length;
function renderChat(){if(!list)return;const rows=arrange(streamItems()); // newest first, a scene's rows together (#734)
  const s=filter+':'+rows.length+':'+rows.map(({it,cls})=>(it.id||keyOf(it.e))+(it.kind==='chat'?'':it.text+(it.live||''))+cls).join('|')+':'+(slotted()?1:0)+':'+companies().map(C=>C.id+companyLabel(C)).join(',');
  if(s===sig)return;if(held(list))return;sig=s;
  const top=atTop(),before=rowsIn();
  patch(list,tmp=>{let lastDay=null;
    for(const x of rows){const it=x.it,d=x.day!=null?x.day:it.kind==='chat'?dayOf(it.e):Math.floor(it.gm/1440)+1;if(d!=null&&d!==lastDay){tmp.append(daySep(d));lastDay=d}
      tmp.append(rowEl(x))}
    if(!rows.length)tmp.append(el('li','dm','Nothing said yet.'))},{force:true}); // anchored: scrolled down, the line being read stays put
  const after=rowsIn();
  if(top){list.scrollTop=0;newN=0}else if(after>before)newN+=after-before;
  syncChip()}
function syncChip(){if(!chip)return;chip.hidden=newN<=0;if(newN>0)chip.textContent=newN+' new line'+(newN>1?'s':'')+' ↑'}

// ---- the DM agent tab ----
const entries=()=>{const L=S.dmLog||[];return L.filter(e=>dmByAgent(e)||e.kind==='agent'||showScripted)};
function renderTurns(){if(!turnList)return;const T=dmTurns(),sg=dmTurnsVer()+':'+T.length;
  if(sg===tSig)return;if(held(turnList))return;tSig=sg;
  patch(turnList,tmp=>{let last=null;for(const t of T){if(t.day!==last){tmp.append(daySep(t.day));last=t.day}tmp.append(turnCard(t))}
    if(!T.length)tmp.append(el('li','dm','No DM turns seen yet. Cards appear as the DM agent acts (open the DM seat in Agents, then start the DM).'))},{force:true})}
function renderDm(){if(!dmList)return;const tv=dmView==='turns';dmList.hidden=tv;if(turnList)turnList.hidden=!tv;if(dmBar&&dmBar.firstChild)dmBar.firstChild.hidden=tv;if(tv){renderTurns();return}
  const L=entries(),sg=L.length+':'+(L[0]?L[0].id:0)+':'+showScripted+':'+[...openDm].join(',');
  if(sg===dmSig)return;if(held(dmList))return;dmSig=sg;
  patch(dmList,tmp=>{let lastDay=null;
    for(const e of L){const agent=dmByAgent(e)||e.kind==='agent',d=dayOf(e);if(d!=null&&d!==lastDay){tmp.append(daySep(d));lastDay=d}
      const li=el('li','tl dmrow dm-'+e.kind+(agent?'':' dimmed'));li.dataset.dmid=e.id;li.setAttribute('data-k','d'+e.id);li.tabIndex=0;li.setAttribute('role','button');li.setAttribute('aria-expanded',String(openDm.has(e.id)));
      li.append(el('time',null,stampOf(e)),el('span','badge b-dm'+(agent?' b-dma':''),dmBadge(e)));const t=el('span','tx dmtx');dmParts(t,e.summary);li.append(t);
      if(openDm.has(e.id))li.append(dmTable(e));tmp.append(li)}
    if(!L.length)tmp.append(el('li','dm','The DM agent has not acted yet (open the DM seat in Agents, then npm run dm).'))},{force:true})}

function sync(){const F=!!slotted(),sec=$('chatSec');if(!sec)return;if(sec.hidden===F)sec.hidden=!F;
  $('chatPane').hidden=tab!=='chat';$('dmPane').hidden=tab!=='dm';$('chatFilter').hidden=tab!=='chat';
  for(const b of $('chatTabs').children){if(!b.dataset.ctab)continue;if(b.dataset.ctab==='chat')b.hidden=tab==='chat';else b.setAttribute('aria-pressed',String(tab==='dm'))}}
export function renderChatPanel(){if(!box)return;sync();if(!slotted())return;if(tab==='chat')renderChat();else renderDm()}
export function setChatTab(t){if(t!=='chat'&&t!=='dm')return;tab=t;sig='';dmSig='';renderChatPanel()}
export function setChatFilter(f){if(!FILTERS.some(([k])=>k===f))return;filter=f;sig='';for(const b of $('chatFilter').children)b.setAttribute('aria-pressed',String(b.dataset.cf===f));renderChatPanel()}
export const chatTab=()=>tab;
export const setDmView=v=>{if(v==='turns'||v==='entries'){const b=dmBar&&[...dmBar.children].find(x=>x.dataset.dview===v);if(b)b.click()}};

export function initChatPanel(){const sec=$('chatSec');if(!sec)return;
  box=el('details','tlbox chatbox');box.id='chatbox';box.open=true;
  const sum=el('summary',null,'Chat');box.append(sum);
  // One row (#546): the channel chips, then the DM agent toggle (and, in its view, a way back to the chat), Taller and the
  // left/under-map switch. The colour key is the row's and the list's tooltip.
  const tabs=el('div','tfilter chatrow');tabs.id='chatTabs';tabs.setAttribute('role','toolbar');tabs.setAttribute('aria-label','Chat channels and the DM agent');
  const fb=el('div','chatchips');fb.id='chatFilter';fb.setAttribute('role','group');fb.setAttribute('aria-label','Chat filter');
  for(const [k,l] of FILTERS){const b=el('button',null,l);b.dataset.cf=k;b.setAttribute('aria-pressed',String(k===filter));b.addEventListener('click',()=>setChatFilter(k));fb.append(b)}
  tabs.append(fb);
  for(const [k,l] of [['chat','◀ Chat'],['dm','DM agent']]){const b=el('button',k==='dm'?'chatdmbtn':'chatback',l);b.dataset.ctab=k;
    b.title=k==='dm'?'The DM agent’s turns and actions (click again for the chat)':'Back to the chat';
    b.addEventListener('click',()=>setChatTab(k==='dm'&&tab==='dm'?'chat':k));tabs.append(b)}
  {const w=el('button','chatwidebtn','Taller');w.id='chatTall';w.title='Make the chat under the map taller (remembered)';
   const apply=()=>{document.body.classList.toggle('chat-tall',wide);w.setAttribute('aria-pressed',String(wide));w.textContent=wide?'Shorter':'Taller'};
   w.addEventListener('click',()=>{wide=!wide;try{localStorage.setItem(WKEY,wide?'1':'0')}catch(e){}apply()});tabs.append(w);apply()}
  box.append(tabs);
  const pane=el('div');pane.id='chatPane';
  // the colour key: member = class colour, others = disposition colour with an underline (a shape as well as a colour)
  const lg=el('div','chatlegend dm');lg.id='chatLegend';lg.hidden=true;lg.append('Names: class colour = member; underlined = others: ');
  for(const k of ['hostile','neutral','friendly']){const s=el('span','npcn npc-'+k,k);s.style.color=DISP[k].color;lg.append(s,' ')}
  const key='Names: class colour = a company member; underlined = others (red hostile, amber neutral, green friendly)';fb.title=key;
  const wrap=el('div','chatwrap');list=el('ul','log chat chatlist');list.id='chatList';list.tabIndex=0;list.setAttribute('role','log');list.setAttribute('aria-label','Fellowship chat');list.title=key;
  chip=el('button','chatnew','new lines');chip.hidden=true;chip.addEventListener('click',()=>{list.scrollTop=0;newN=0;syncChip()});
  list.addEventListener('scroll',()=>{if(atTop()){newN=0;syncChip()}});
  wrap.append(list,chip);pane.append(lg,wrap);
  const dp=el('div');dp.id='dmPane';dp.hidden=true;
  dmBar=el('div','tfilter');const tg=el('button',null,'Scripted DM');tg.setAttribute('aria-pressed','false');tg.title='Also show the scripted DM’s entries, dimmed';
  tg.addEventListener('click',()=>{showScripted=!showScripted;tg.setAttribute('aria-pressed',String(showScripted));dmSig='';renderChatPanel()});dmBar.append(tg);
  for(const [k,l] of [['turns','Turns'],['entries','Entries']]){const b=el('button',null,l);b.dataset.dview=k;b.setAttribute('aria-pressed',String(k===dmView));
    b.addEventListener('click',()=>{dmView=k;dmSig='';tSig='';for(const x of dmBar.children)if(x.dataset.dview)x.setAttribute('aria-pressed',String(x.dataset.dview===k));renderChatPanel()});dmBar.append(b)}
  dmList=el('ul','tlist dmlist chatdm');dmList.id='dmChatList';
  dmList.addEventListener('click',e=>{const t=e.target;if(!t||!t.closest||t.closest('.hn[data-hid]')||t.closest('.dmkv'))return;const r=t.closest('[data-dmid]');if(r)toggleRow(r.dataset.dmid)});
  dmList.addEventListener('keydown',e=>{if(e.key!=='Enter'&&e.key!==' ')return;const r=e.target&&e.target.closest&&e.target.closest('[data-dmid]');if(r&&e.target===r){e.preventDefault();toggleRow(r.dataset.dmid)}});
  turnList=el('ul','tlist dmlist chatdm dmcards');turnList.id='dmTurnList';
  dp.append(dmBar,turnList,dmList);box.append(pane,dp);sec.append(box);sync();renderChatPanel()}
function toggleRow(id){id=Number(id);if(openDm.has(id))openDm.delete(id);else openDm.add(id);dmSig='';renderChatPanel()}
