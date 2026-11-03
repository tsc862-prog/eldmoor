// Dungeon Master panel (issue #76): S.dmLog newest first, with a filter row (All, Hooks,
// Scenes, Rolls, Outcomes), clickable hero names (.hn[data-hid], handled by panels.js) and a
// small key/value table per entry that opens on click. showAdventure(id) filters to one
// adventure (the hero card's "Adventure:" line calls it). Rebuilds only when the log, the
// filter or an expanded entry changes; one pass over at most 200 entries.
import {S} from '../sim/index.js';
import {renderDmNotes,dmNotesSig} from './notebook.js'; // the DM agent's notes viewer (#155)
import {patch,held} from './stable.js'; // update in place, keep scroll (#145)
import {styled} from '../sim/epithet.js'; // a name given for a deed (bestow, #638)

const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};

export const FILTERS=[['all','All',null],['hooks','Hooks',['hooks','pick']],['scenes','Scenes',['frame','branch','camp']],['rolls','Rolls',['roll','complication']],
  ['outcomes','Outcomes',['payoff','fail','abandon','fallback']],['levers','Levers',['lever']],['agent','DM agent',['agent']],['notes','Notes',[]]]; // agent: the DM agent's notes, plans and pulls (#66); notes: its notebook (#155)
const BADGE={hooks:'BOARD',pick:'PICK',frame:'SCENE',roll:'ROLL',complication:'TWIST',branch:'FORK',payoff:'PAYOFF',fail:'FAIL',abandon:'DROP',fallback:'FALLBACK',lever:'LEVER',camp:'CAMP',agent:'DM AGENT'};
const byAgent=e=>!!(e.detail&&e.detail.by==='dm-agent'); // the DM agent's entries (issue #66) carry a tag
let filter='all',advId=null,seen='',box=null,list=null,bar=null,chip=null;
const open=new Set();
export const dmFilter=()=>filter;
export const dmAdventure=()=>advId;

// The Levers filter also finds entries that carry folded lever pulls (board posts, named foes on a roll).
const matches=e=>{const f=FILTERS.find(([k])=>k===filter);return (!f[2]||f[2].includes(e.kind)||filter==='levers'&&!!(e.detail&&e.detail.levers)||filter==='agent'&&byAgent(e))&&(advId==null||e.advId===advId)};
// Lever pulls in an entry (its own, or folded ones) and how long each has left: "18h left", "ended".
const leversOf=e=>e.kind==='lever'&&e.detail&&e.detail.lever&&!e.detail.levers?[e.detail]:(e.detail&&e.detail.levers)||[];
// A world event pull (start_event, #352) is named by its event: "festival", "plague".
const evName=l=>l&&l.lever==='start_event'&&l.params&&typeof l.params==='object'&&l.params.kind?String(l.params.kind).slice(0,24):null;
const eventOf=e=>{for(const l of leversOf(e)){const k=evName(l);if(k)return k+(l.region?' · '+l.region:typeof l.params.region==='string'?' · '+l.params.region.slice(0,24):'')}return null};
const hrs=m=>{const h=Math.max(0,Math.round(m/60));return h>=24?Math.floor(h/24)+'d'+(h%24?' '+h%24+'h':''):h+'h'};
function left(e){const out=[];for(const l of leversOf(e)){if(l.until==null)continue;
  const live=(S.levers&&S.levers.active||[]).some(x=>x.id===l.id);out.push((evName(l)||l.lever)+' '+(live&&l.until>S.gameMin?hrs(l.until-S.gameMin)+' left':'ended'))}return out.join(', ')}
const dayOf=e=>Math.floor((e.gameMin||0)/1440)+1;
const heroSpan=(id,h)=>{const s=el('span','hn f'+(h?h.fac:0),h?h.name:'#'+id);s.dataset.hid=id;return s};

function partsTo(node,ps){for(const p of ps||[]){if(typeof p==='string')node.append(p);
  else if(p&&p.kind==='hero'||p&&p.ref==='hero'){const s=el('span','hn f'+(p.fac||0),p.kind==='hero'?styled(p):p.name||'?');s.dataset.hid=p.id;node.append(s)}
  else if(p&&p.t!=null)node.append(el('span',p.c||'',p.t))}}

// Flatten detail to [key, text] rows: nested objects get dotted keys, arrays of objects list one row per item.
function rows(o,pre,out){for(const k in o){const v=o[k],key=pre+k;
  if(v==null||v==='')continue;
  if(Array.isArray(v)){if(v.length&&typeof v[0]==='object')v.forEach((x,i)=>rows(x,key+'['+(i+1)+'].',out));else out.push([key,v.join(', ')])}
  else if(typeof v==='object')rows(v,key+'.',out);
  else out.push([key,String(v)])}return out}

function table(e){const t=el('table','dmkv'),b=el('tbody');
  const add=(k,v)=>{const r=el('tr');r.append(el('td','dm',k));const c=el('td');if(v instanceof Node)c.append(v);else c.textContent=v;r.append(c);b.append(r)};
  const hs=el('span');(e.heroes||[]).forEach((id,i)=>{if(i)hs.append(', ');hs.append(heroSpan(id,S.agents.find(x=>x.id===id)))});
  if(e.heroes&&e.heroes.length)add('heroes',hs);
  if(e.advId!=null)add('adventure','#'+e.advId);
  if(e.town)add('town',e.town);
  {const r=left(e);if(r)add('remaining',r)}
  for(const [k,v] of rows(e.detail||{},'',[]))add(k,v);
  if(e.prompt)add('prompt',e.prompt);
  if(e.reply)add('reply',e.reply);
  t.append(b);return t}

// for the chat panel's DM agent tab (#169): the same row pieces, one place
export const dmTable=table,dmParts=partsTo,dmByAgent=byAgent,dmBadge=e=>BADGE[e.kind]||e.kind.toUpperCase();
function advTitle(id){const a=(S.adventures||[]).find(x=>x.id===id);return a&&a.title?a.title:'#'+id}

export function renderDmLog(){if(!list)return;
  const L=S.dmLog||[],sig=L.length+':'+(L[0]?L[0].id:0)+':'+filter+':'+advId+':'+open.size+':'+[...open].join(',')+(filter==='levers'?':'+Math.floor(S.gameMin/60):'')+(filter==='notes'?':'+dmNotesSig():'');
  if(sig===seen)return;if(held(list))return;seen=sig;
  if(filter==='notes'){if(chip)chip.hidden=true;list.replaceChildren();renderDmNotes(list);return} // the notes viewer instead of the log (#155)
  if(chip){chip.replaceChildren();if(advId!=null){chip.hidden=false;chip.append('Adventure: '+advTitle(advId)+' ');const x=el('button',null,'show all');x.dataset.dmclear='1';chip.append(x)}else chip.hidden=true}
  patch(list,list=>{let n=0;
  for(const e of L){if(!matches(e))continue;
    const li=el('li','tl dmrow dm-'+e.kind);li.dataset.dmid=e.id;li.setAttribute('data-k','d'+e.id);
    li.append(el('time',null,'D'+dayOf(e)+' '+e.t),el('span','badge b-dm',BADGE[e.kind]||e.kind.toUpperCase()));if(byAgent(e)&&e.kind!=='agent')li.append(el('span','badge b-dm b-dma','DM AGENT'));{const ev=eventOf(e);if(ev)li.append(el('span','badge b-dm','EVENT: '+ev.toUpperCase()))}
    const t=el('span','tx dmtx');partsTo(t,e.summary);{const r=left(e);if(r)t.append(el('span','dm',' ('+r+')'))}li.append(t);
    if(open.has(e.id))li.append(table(e));
    list.append(li);n++}
  if(!n)list.append(el('li','dm','Nothing logged yet.'))},{force:true})}

export function setDmFilter(f){if(FILTERS.some(([k])=>k===f)){filter=f;renderDmLog();if(bar)for(const x of bar.children)x.setAttribute('aria-pressed',String(x.dataset.dm===f))}}
// Open the panel on one adventure's entries (all kinds).
export function showAdventure(id){advId=id==null?null:Number(id);filter='all';if(bar)for(const x of bar.children)x.setAttribute('aria-pressed',String(x.dataset.dm==='all'));
  if(box){box.open=true;if(box.scrollIntoView)box.scrollIntoView({block:'nearest'})}renderDmLog()}
// Open the Dungeon Master panel (the DM frame's click): its World group too, optionally on one filter.
export function openDmPanel(f){const w=$('worldbox');if(w&&!w.open)w.open=true;if(f)setDmFilter(f);if(box){box.open=true;if(box.scrollIntoView)box.scrollIntoView({block:'nearest'})}renderDmLog()}
export function toggleDmEntry(id){id=Number(id);if(open.has(id))open.delete(id);else open.add(id);renderDmLog()}

export function initDmLog(){box=$('dmlog');list=$('dmlist');if(!box||!list)return;
  bar=$('dmfilter');chip=$('dmchip');
  if(bar){bar.replaceChildren();for(const [k,label] of FILTERS){const b=el('button',null,label);b.dataset.dm=k;b.setAttribute('aria-pressed',String(k===filter));
    b.addEventListener('click',()=>setDmFilter(k));bar.append(b)}}
  // the list's own clicks: hero names go to panels.js; a row toggles its detail, the chip clears the adventure filter
  list.addEventListener('click',e=>{const t=e.target;if(!t||!t.closest||t.closest('.hn[data-hid]')||t.closest('.dmkv'))return;
    const r=t.closest('[data-dmid]');if(r)toggleDmEntry(r.dataset.dmid)});
  if(chip)chip.addEventListener('click',e=>{if(e.target.closest&&e.target.closest('[data-dmclear]')){advId=null;renderDmLog()}});
  renderDmLog()} // refreshed each second by ui/app.js
