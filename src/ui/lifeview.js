// The Fellowship's lives (issue #389): the sheet's "Life" view, one card per member with its landmarks (newest
// first), chapter titles with their days, and the last 10 journal entries cut to 300 characters. Read-only: it reads
// the tiered memory through tiersView() (src/sim/tiers.js, a plain copy, never tiersOf(), which would migrate and so
// write) and a.journal. The watcher sees everything, so nothing is filtered. A member with no tiers yet (or an old
// save) shows an empty state. Built through patch() (src/ui/stable.js): cards and rows are keyed, so an unchanged
// row is the same node and the scroll position holds; a signature skips the work when nothing changed.
// lifeRows() gives the same content as plain data for the headless smoke.
import {fellowshipMembers} from '../sim/fellowship.js';
import {tiersView} from '../sim/tiers.js';
import {patch,keyed} from './stable.js';

export const LIFE={ENTRIES:10,ENTRY_LEN:300,MARK_LEN:200};
const KIND={death:'loss',friend:'loss',fellowship:'fellowship',level:'level',crypt:'crypt',boss:'boss',elite:'elite',vow:'vow',nemesis:'debt paid',own:'own'};
const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
const clean=s=>String(s==null?'':s).replace(/\s+/g,' ').trim();
export const cutText=(s,n)=>{s=clean(s);if(s.length<=n)return s;const t=s.slice(0,n-1),i=t.lastIndexOf(' ');return (i>n*.6?t.slice(0,i):t)+'…'};
const daysOf=(d0,d1)=>d0===d1?'Day '+d0:'Days '+d0+'-'+d1;

// ---- as data: one card per Fellowship place ----
export function lifeRows(){return fellowshipMembers().map(m=>{const a=m.hero;
  if(!a)return {slot:m.slot,role:m.role,label:m.label,hero:null};
  const T=tiersView(a),J=Array.isArray(a.journal)?a.journal:[];
  const marks=T?T.marks.slice().reverse().map(x=>({day:x.day,k:x.k,kind:KIND[x.k]||x.k,text:cutText(x.text,LIFE.MARK_LEN)})):[];
  const chapters=T?T.chapters.map(c=>{const t=clean(c.title).replace(/^Days? [\d-]+:? ?/,'');
    return {n:c.n,days:daysOf(c.d0,c.d1),title:t||(c.src==='migrated'?'the journal before chapters':'untitled'),text:clean(c.text),src:c.src}}):[];
  const entries=J.slice(-LIFE.ENTRIES).reverse().map(e=>({t:clean(e.t),text:cutText(e.text,LIFE.ENTRY_LEN),key:(e.gameMin||0)+':'+clean(e.text).slice(0,40)}));
  return {slot:m.slot,role:m.role,label:m.label,hero:a,tiers:!!T,marks,chapters,entries,total:J.length,pend:T?T.pend:0}})}

// ---- DOM ----
function section(title,n,rows,empty){const s=el('section','lfsec');const h=el('h4','lfh',title+(n?' ('+n+')':''));s.append(h);
  if(!rows.length){s.append(el('p','dm lfnone',empty));return s}
  const ul=el('ul','lflist');for(const r of rows)ul.append(r);s.append(ul);return s}
function card(c){const box=keyed(el('article','lfcard'),'lf'+c.slot);
  const hd=el('header','lfhd');hd.append(el('span','frole r-'+c.role,c.label));
  if(!c.hero){hd.append(el('span','dm',' place empty'));box.append(hd);return box}
  const a=c.hero,n=el('span','hn f'+a.fac,a.name);n.dataset.hid=a.id;
  hd.append(' ',n,el('span','dm',' '+a.cls+' · L'+a.lvl+(a.state==='dead'?' · fallen':'')));box.append(hd);
  if(!c.tiers&&!c.entries.length){box.append(el('p','dm lfnone','No life written yet: landmarks, chapters and journal entries appear once '+a.name+' lives through something worth keeping.'));return box}
  box.append(section('Landmarks',c.marks.length,c.marks.map(m=>{const li=keyed(el('li','lfrow lfmark k-'+m.k),'m'+m.day+':'+m.k+':'+m.text.slice(0,40));
    li.append(el('span','lfday','Day '+m.day),el('span','lftag',m.kind),el('span','lftx',m.text));return li}),'No landmarks yet.'));
  box.append(section('Chapters',c.chapters.length,c.chapters.map(ch=>{const li=keyed(el('li','lfrow lfch'),'c'+ch.n);
    li.append(el('span','lfday','Ch. '+ch.n+' · '+ch.days),el('span','lftx',ch.title));if(ch.text)li.title=ch.text;return li}),
    c.pend?c.pend+' line'+(c.pend===1?'':'s')+' waiting for the first chapter.':'No chapters yet.'));
  box.append(section('Journal',c.total>c.entries.length?c.entries.length+' of '+c.total:c.entries.length,c.entries.map(e=>{const li=keyed(el('li','lfrow lfent'),'j'+e.key);
    li.append(el('span','lfday',e.t),el('span','lftx',e.text));return li}),'No journal entries yet.'));
  return box}

let sig='';
// Patch the life cards into host. Returns true when it changed (or was held and must try again).
export function renderLife(host,{force=false}={}){if(!host)return false;const L=lifeRows();
  const k=JSON.stringify(L.map(c=>c.hero?[c.slot,c.hero.id,c.hero.name,c.hero.lvl,c.hero.state==='dead',c.marks,c.chapters,c.entries,c.total,c.pend]:[c.slot]));
  if(!force&&k===sig&&host.firstChild)return false;
  const done=patch(host,t=>{const g=el('div','lfgrid');for(const c of L)g.append(card(c));t.append(g)},{force});
  if(done)sig=k;return done}
export const resetLife=()=>{sig=''};
