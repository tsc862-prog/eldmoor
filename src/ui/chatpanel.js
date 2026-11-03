// The Fellowship chat panel (#169): the whole conversation in one stream, always one click away, plus the
// DM agent's actions as a sibling tab. A side-column panel under the Fellowship panel, open by default.
//   Chat tab   party lines, members speaking aloud, the Narrator and DM-voiced characters, Table scene lines, and
//              the party's proposals, votes and results as small system lines. Filters: All, Party, Aloud, DM, Table.
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
import {companies,companyOf} from '../sim/company.js';
import {companyLabel} from './companyview.js';
import {dmTable,dmParts,dmBadge,dmByAgent} from './dmpanel.js';
import {dmTurns,dmTurnsVer,turnCard} from './dmturns.js'; // per-turn cards (#181)

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
function ingest(){for(const a of S.agents){if(!a.fellow||!a.chat)continue;for(const e of a.chat){if(known.has(e))continue;known.add(e);items.push({k:sortKey(e),n:++seq,kind:'chat',e})}}
  items.sort((x,y)=>x.k-y.k||x.n-y.n);if(items.length>KEEP)items.splice(0,items.length-KEEP)}
// The council as system lines, made from the proposals themselves (no second record): "Garrwen proposes: ... [job · vote open]",
// "Kerin votes yes: reason" (the proposer's own automatic yes is left out), "Passed 4-1".
const stamp=gm=>({d:Math.floor(gm/1440)+1,t:String(Math.floor(gm%1440/60)).padStart(2,'0')+':'+String(Math.floor(gm%60)).padStart(2,'0')});
function councilItems(){const F=S.fellowship,out=[];if(!F||!F.props)return out;
  for(const P of F.props){const by=S.agents.find(a=>a.id===P.by),st=P.status==='open'?'vote open':P.status;
    out.push({k:P.at,n:-3,kind:'prop',id:'p'+P.id,P,who:by||{name:P.byName||'?'},cats:['party'],text:' proposes: '+P.details+' ['+P.kind+' · '+st+']',gm:P.at});
    for(const id in P.votes){const v=P.votes[id],h=S.agents.find(a=>String(a.id)===String(id));if(!h)continue;
      if(h.id===P.by&&v.v==='yes'&&!v.reason)continue;
      const gm=v.at!=null?v.at:P.done!=null?P.done:P.at;
      out.push({k:gm,n:-2,kind:'vote',id:'v'+P.id+'-'+id,P,who:h,cats:['party'],text:' votes '+v.v+(v.reason?': '+v.reason:''),gm})}
    if(P.status!=='open'&&P.result){const m=/^(Passed|Failed) (\d+-\d+)/.exec(P.result);
      out.push({k:P.done!=null?P.done:P.at,n:-1,kind:'result',id:'r'+P.id,P,cats:['party'],text:m?m[1]+' '+m[2]:P.status==='passed'?'Passed':'Failed',gm:P.done!=null?P.done:P.at})}}
  return out}
const matches=(it)=>{if(filter==='all')return true;const c=it.kind==='chat'?catsOf(it.e):it.cats;return c.has?c.has(filter):c.includes(filter)};
const visible=it=>it.kind!=='chat'||chatVisible(it.e,S);
export const streamItems=()=>{ingest();return items.concat(councilItems()).filter(visible).filter(matches).sort((x,y)=>x.k-y.k||x.n-y.n)};
// The dossier's Chat tab (#181): the same stream, filtered to one hero: what it said or heard (its own chat buffer),
// and the council lines it proposed or voted. Newest first like the panel; the panel's channel filter does not apply.
export function heroStream(a){ingest();const mine=new Set(a.chat||[]);
  return items.concat(councilItems()).filter(visible).filter(it=>it.kind==='chat'?(mine.has(it.e)||it.e.from===a):(it.who===a||it.kind==='result'&&it.P.votes&&it.P.votes[a.id]!=null))
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
function renderChat(){if(!list)return;const rows=streamItems().reverse(),last=rows.length?rows[0]:null; // newest first
  const s=filter+':'+rows.length+':'+(last?(last.id||keyOf(last.e)):'')+':'+rows.map(r=>r.kind==='prop'||r.kind==='result'?r.text:'').join('').length+':'+(S.fellowship?1:0)+':'+companies().map(C=>C.id+companyLabel(C)).join(',');
  if(s===sig)return;if(held(list))return;sig=s;
  const top=atTop(),before=rowsIn();
  patch(list,tmp=>{let lastDay=null;
    for(const it of rows){const d=it.kind==='chat'?dayOf(it.e):Math.floor(it.gm/1440)+1;if(d!=null&&d!==lastDay){tmp.append(daySep(d));lastDay=d}
      tmp.append(it.kind==='chat'?shoutLine(it.e):sysLine(it))}
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

function sync(){const F=!!S.fellowship,sec=$('chatSec');if(!sec)return;if(sec.hidden===F)sec.hidden=!F;
  $('chatPane').hidden=tab!=='chat';$('dmPane').hidden=tab!=='dm';$('chatFilter').hidden=tab!=='chat';
  for(const b of $('chatTabs').children){if(!b.dataset.ctab)continue;if(b.dataset.ctab==='chat')b.hidden=tab==='chat';else b.setAttribute('aria-pressed',String(tab==='dm'))}}
export function renderChatPanel(){if(!box)return;sync();if(!S.fellowship)return;if(tab==='chat')renderChat();else renderDm()}
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
