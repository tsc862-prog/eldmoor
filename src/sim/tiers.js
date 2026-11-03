// Tiered long-term memory for agent-played heroes (issue #153). Owned by brain-builder. DOM-free, RNG-free: it only
// keeps books on what already happened (the record hook of sim/history.js, the memory lines of sim/memory.js, the
// journal of sim/player.js and the notebook archive of sim/notebook.js), so the seeded headless sim is unchanged.
//
//   a.tiers = {v, seq, marks:[mark], chapters:[chapter], pend:[item], nem:[heroId], own:{d, n}}
//     mark    {id, k, w, day, gm, text, key}: a landmark, kept outside every rolling cap. k: death (a companion fell),
//             friend (a friend lost), fellowship (sworn in, joined, left), level (every LVL_BAND levels), crypt
//             (Sunken Crypt cleared), boss (a world boss slain), elite (a named elite slain), vow (a nemesis taken),
//             nemesis (a blood debt paid),
//             own (an entry the agent marked with journal_write {landmark:true}). w: weight; past TIER.MARKS the
//             lightest (then oldest) folds into the chapter that covers its day.
//     chapter {n, d0, d1, title, text, kw:[words], src:'scripted'|'model'|'migrated', items, stamp}: what fell off the
//             end of the journal (entries past PK.JOURNAL) and of the notebook (archived notes past NB.ARCH), folded
//             TIER.BLOCK at a time. The digest is scripted at once; when the relay is up a model rewrites the
//             title and text (kind 'chapter'), applied only while the chapter is unchanged (stamp). kw keeps the
//             names and words of the folded lines, so journal_search still finds them. Past TIER.CHAPTERS the two
//             oldest chapters merge.
//     pend    the lines spilled since the last chapter (TIER.BLOCK at most; searchable too).
//
// Rules:
//   - Only agent-played heroes and Fellowship members keep tiers (a.player || inSlots(a)); nobody else is touched.
//   - Seats stay apart (issue #123): journal_search and journal_read answer from the caller's own hero only.
//   - Hardcore: the tiers die with the hero (the dead hero's tools answer "dead"); the replacement starts empty.
//     Only the pinned "letter" note of sim/notebook.js crosses to the next member.
//   - Bounded: a turn sees at most TIER.MARKS landmarks, TIER.CHAPTERS chapter titles and TIER.OVERVIEW entries,
//     however long the world runs.
//   - Old saves migrate on first touch: an existing journal becomes chapter 1 (unlabeled, src 'migrated') while its
//     entries stay readable, and the hero's log and memories are scanned once for landmarks.
import {S} from './state.js';
import {onRecord} from './history.js';
import {words} from './words.js';
import {SEM,semKey,semOf,semBonus} from './semkey.js'; // meaning search supplied by the relay (#553)
import {inSlots,slotted} from './company.js'; // the slotted company (#588)

export const TIER={
  V:1,
  MARKS:30,       // landmarks kept
  MARK_LEN:200,   // characters of a landmark
  OWN_PER_DAY:3,  // landmarks the agent may mark itself in one game day
  LVL_BAND:5,     // a level that is a multiple of this is a landmark
  BLOCK:20,       // spilled lines folded into one chapter
  CHAPTERS:24,    // chapters kept; past it the two oldest merge
  CH_LEN:320,     // characters of a chapter's text
  TITLE:60,       // characters of a chapter's title
  KW:40,          // words a chapter keeps for search
  N:5,N_MAX:10,   // journal_search results by default and at most
  HIT_LEN:240,    // characters of one search result
  OVERVIEW:10,    // latest journal entries in the overview
  OV_MARK:120,    // characters of a landmark in the overview
  OV_ENTRY:300,   // characters of an entry in the overview (journal_read {n} gives them whole)
};
// Weights: the heaviest are kept longest.
const W={death:5,boss:5,fellowship:5,nemesis:4,own:4,friend:3,crypt:3,level:3,vow:3,elite:2};

const DAY=1440;
const dayNo=gm=>Math.floor((gm==null?S.gameMin:gm)/DAY)+1;
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const cut=(s,n)=>{s=clean(s,1e4);if(s.length<=n)return s;const t=s.slice(0,n-1);const i=t.lastIndexOf(' ');return (i>n*.6?t.slice(0,i):t)+'…'};
const keeps=a=>!!(a&&a.kind==='hero'&&(a.player||inSlots(a)));
const entryDay=e=>{const m=/^Day (\d+)/.exec(e&&e.t||'');return m?Number(m[1]):dayNo(e&&e.gameMin)};

let writer=null; // (a, snapshot, stamp) => void: asks the relay for a chapter (set by sim/brain.js)
export const setChapterWriter=f=>{writer=f};

// ---- the store ----
export function tiersOf(a){if(a.tiers&&a.tiers.v===TIER.V)return a.tiers;
  const T=a.tiers={v:TIER.V,seq:0,marks:[],chapters:[],pend:[],nem:[],own:{d:0,n:0}};
  // migrate: an existing journal is chapter 1, unlabeled; its entries stay readable and fold into it later
  const J=a.journal||[];
  if(J.length){const it=J.map(e=>({day:entryDay(e),gm:e.gameMin||0,text:e.text}));const c=chapterOf(it,1);c.title=null;c.src='migrated';T.chapters.push(c);for(const e of J)e.ch=1}
  // the hero's own log and Fellowship memories, read once for landmarks it already lived through
  for(const h of a.history||[])classify(a,h.text,h.d);
  if(a.memory)for(const e of a.memory.recent||[])fromMemory(a,e.k,e.text,e.day);
  for(const id in a.nemesis||{})T.nem.push(Number(id)); // older vows are not news
  return T}

// ---- landmarks ----
export function mark(a,k,text,d){const T=a.tiers&&a.tiers.v===TIER.V?a.tiers:tiersOf(a),t=cut(text,TIER.MARK_LEN);if(!t)return null;
  const day=d||dayNo(),key=k+':'+day+':'+words(t).slice(0,6).join(' ');if(T.marks.some(m=>m.key===key))return null;
  const m={id:++T.seq,k,w:W[k]||2,day,gm:d?(d-1)*DAY:Math.round(S.gameMin),text:t,key};T.marks.push(m);T.marks.sort((p,q)=>p.day-q.day||p.id-q.id);
  while(T.marks.length>TIER.MARKS)foldMark(a,T);return m}
// The lightest landmark (the oldest of them) goes into the chapter that covers its day, or waits for the next one.
function foldMark(a,T){let k=0;for(let i=1;i<T.marks.length;i++){const x=T.marks[i],y=T.marks[k];if(x.w<y.w||x.w===y.w&&x.id<y.id)k=i}
  const m=T.marks.splice(k,1)[0],c=T.chapters.find(c=>m.day>=c.d0&&m.day<=c.d1);
  if(c)c.kw=mergeKw(c.kw,kwOf([m.text]));else spill(a,{day:m.day,gm:m.gm,text:m.text,src:'landmark'})}

// A line of the hero's own log (sim/history.js record) that marks a turn in its life.
const RX=[
  [/^Reached level (\d+)/,(m)=>Number(m[1])%TIER.LVL_BAND===0?'level':null],
  [/^Cleared /,()=>'crypt'],
  [/^Slew .+!$/,()=>'boss'],
  [/^Slew .+, .+, in /,()=>'elite'],
  [/^(Paid the blood debt|Avenged )/,()=>'nemesis'],
  [/^Lost a close friend/,()=>'friend'],
  [/^Lost a friend/,()=>'friend'],
  [/^Left (.+)\.$/,(m)=>slotted()&&m[1]===slotted().name?'fellowship':null],
];
function classify(a,text,d){for(const [re,f] of RX){const m=re.exec(text||'');if(m){const k=f(m);if(k)mark(a,k,text,d);return}}}
// A Fellowship memory line (sim/memory.js remember): a companion's death and the joinings.
function fromMemory(a,k,text,d){if(k==='death')mark(a,'death',text,d);else if(k==='join')mark(a,'fellowship',text,d)}
// New blood vows: a nemesis the hero did not have before.
function vows(a){const T=tiersOf(a),N=a.nemesis||{};for(const id in N){const i=Number(id);if(T.nem.includes(i))continue;T.nem.push(i);if(T.nem.length>60)T.nem.shift();
  const k=S.agents.find(x=>x.id===i);mark(a,'vow','Swore blood vengeance on '+(k?k.name:'a killer')+' for '+N[id]+'.')}}

onRecord((a,text)=>{if(!keeps(a)||a.state==='dead')return;classify(a,text);vows(a)});
export function memoryLine(a,k,text){if(keeps(a)&&a.state!=='dead')fromMemory(a,k,text)}

// ---- chapters ----
// A line leaves a rolling store (the journal, the notebook archive, a folded landmark): it waits in pend until
// TIER.BLOCK lines make a chapter.
export function spill(a,item){if(!keeps(a))return;const T=tiersOf(a);
  T.pend.push({day:item.day||dayNo(item.gm),gm:item.gm||0,text:clean(item.text,600),src:item.src||'journal'});
  if(T.pend.length>=TIER.BLOCK)foldPend(a,T)}
// The journal is full (sim/player.js): its oldest entry leaves. Migrated entries already live in chapter 1.
export function spillEntry(a,e){if(!e)return;const T=tiersOf(a);
  if(e.ch){const c=T.chapters.find(c=>c.n===e.ch)||T.chapters[0];if(c){c.kw=mergeKw(c.kw,kwOf([e.text]));return}}
  spill(a,{day:entryDay(e),gm:e.gameMin,text:e.text,src:'journal'})}
// The notebook's archive is full (sim/notebook.js): its oldest note leaves. Journal notes are the journal's to spill.
export function spillNote(a,n){if(!n||(n.tags||[]).includes('journal'))return;spill(a,{day:n.day,gm:n.gm,text:n.title+': '+n.text,src:'note'})}

function foldPend(a,T){const items=T.pend.splice(0);if(!items.length)return;
  const c=chapterOf(items,(T.chapters.length?Math.max(...T.chapters.map(c=>c.n)):0)+1);T.chapters.push(c);
  while(T.chapters.length>TIER.CHAPTERS)mergeOldest(T);
  if(writer&&T.chapters.includes(c)){try{writer(a,chapterSnapshot(a,c,items),c.stamp)}catch(e){}}}

// Scripted digest: the lines that carry the most names and weight, in the order they happened.
const HEAVY=/\b(fell|fall|died|dead|slain|slew|killed|swore|oath|vow|debt|cleared|level|friend|enemy|nemesis|betray|saved|lost|joined|left|crypt|kragmaw|promise)\b/i;
const namesIn=s=>{const out=[];const parts=String(s).split(/(?<=[.!?;:])\s+/);for(const p of parts){const ws=p.split(/\s+/);for(let i=1;i<ws.length;i++){const w=ws[i].replace(/[^\p{L}'-]/gu,'');if(w.length>=3&&/^\p{Lu}/u.test(w)&&!/^(The|And|But|Day|Days|Then|They|She|His|Her|Our|We|My|You|It)$/.test(w))out.push(w)}}return out};
function kwOf(texts){const nm=new Map(),wd=new Map();for(const t of texts){for(const n of namesIn(t)){const k=n.toLowerCase();nm.set(k,(nm.get(k)||0)+1)}for(const w of words(t))wd.set(w,(wd.get(w)||0)+1)}
  const by=m=>[...m.entries()].sort((p,q)=>q[1]-p[1]||(p[0]<q[0]?-1:1)).map(e=>e[0]);
  const out=[];for(const w of [...by(nm),...by(wd)])if(!out.includes(w)){out.push(w);if(out.length>=TIER.KW)break}return out}
const mergeKw=(a,b)=>{const out=[];for(const w of [...(a||[]),...(b||[])])if(!out.includes(w))out.push(w);return out.slice(0,TIER.KW)};
const daysOf=(d0,d1)=>d0===d1?'Day '+d0:'Days '+d0+'-'+d1;
function chapterOf(items,n){items=items.slice().sort((p,q)=>p.gm-q.gm||p.day-q.day);const d0=Math.min(...items.map(i=>i.day)),d1=Math.max(...items.map(i=>i.day));
  const first=t=>cut(String(t).split(/(?<=[.!?])\s/)[0],120).replace(/[.!?]$/,'');
  const sc=items.map((it,i)=>({it,i,s:namesIn(it.text).length+(HEAVY.test(it.text)?3:0)+(it.src==='landmark'?3:0)}));
  const pick=[];let len=0;const head=daysOf(d0,d1)+': ';
  for(const x of sc.slice().sort((p,q)=>q.s-p.s||p.i-q.i)){const f=first(x.it.text);if(!f)continue;if(head.length+len+f.length+2>TIER.CH_LEN)continue;pick.push(x);len+=f.length+2}
  pick.sort((p,q)=>p.i-q.i);
  const text=cut(head+(pick.length?pick.map(x=>first(x.it.text)).join('; '):'quiet roads')+'.',TIER.CH_LEN);
  const kw=kwOf(items.map(i=>i.text)),top=kw.slice(0,2).filter(w=>namesIn(items.map(i=>i.text).join(' ')).some(n=>n.toLowerCase()===w)).map(w=>w.charAt(0).toUpperCase()+w.slice(1));
  return {n,d0,d1,title:cut(daysOf(d0,d1)+(top.length?': '+top.join(' and '):''),TIER.TITLE),text,kw,src:'scripted',items:items.length,stamp:n+':'+items.length+':'+d1}}
function mergeOldest(T){const [p,q]=T.chapters.splice(0,2);const strip=t=>String(t||'').replace(/^Days? [\d-]+: /,'');
  const m={n:p.n,d0:Math.min(p.d0,q.d0),d1:Math.max(p.d1,q.d1),title:null,text:'',kw:mergeKw(p.kw,q.kw),src:p.src==='model'&&q.src==='model'?'model':'scripted',items:(p.items||0)+(q.items||0)};
  m.title=cut(daysOf(m.d0,m.d1)+(p.title&&/: /.test(p.title)?': '+p.title.split(': ').slice(1).join(': '):''),TIER.TITLE);
  m.text=cut(daysOf(m.d0,m.d1)+': '+strip(p.text)+' '+strip(q.text),TIER.CH_LEN);m.stamp=m.n+':'+m.items+':'+m.d1+':m';T.chapters.unshift(m)}
// The relay's rewrite (kind 'chapter'): applied only while the chapter it was asked for is unchanged.
export function applyChapter(a,stamp,j){const T=a&&a.tiers;if(!T||!j)return false;const c=T.chapters.find(c=>c.stamp===stamp);if(!c)return false;
  const ti=clean(j.title,TIER.TITLE),tx=clean(j.text,TIER.CH_LEN);if(!tx)return false;c.text=tx;if(ti)c.title=ti;c.src='model';if(typeof j.model==='string')c.model=j.model.slice(0,100);return true}
export const chapterSnapshot=(a,c,items)=>({name:a.name,fac:a.fac,voice:a.persona?a.persona.voice:null,days:daysOf(c.d0,c.d1),items:items.map(i=>'Day '+i.day+': '+cut(i.text,200))});

// ---- the hero's tools (sim/player.js hands these on; the hero is always the caller's own) ----
// journal_write {landmark:true}: the agent marks its own entry, a few a day.
export function ownMark(a,text){const T=tiersOf(a),d=dayNo();if(T.own.d!==d)T.own={d,n:0};
  if(T.own.n>=TIER.OWN_PER_DAY)return {ok:false,note:'At most '+TIER.OWN_PER_DAY+' landmarks of your own a game day: saved as a plain entry.'};
  const m=mark(a,'own',text);if(!m)return {ok:false,note:'Already a landmark.'};T.own.n++;return {ok:true,id:m.id}}
// journal_read with no arguments: who you have been (landmarks, chapter titles) and the latest entries.
export function overview(a){const T=tiersOf(a),J=a.journal||[];vows(a);
  return {landmarks:T.marks.map(m=>'Day '+m.day+': '+cut(m.text,TIER.OV_MARK)),
    chapters:T.chapters.map(c=>{const t=String(c.title||'').replace(/^Days? [\d-]+:? ?/,'');return 'Ch. '+c.n+' ('+daysOf(c.d0,c.d1)+')'+(t?': '+t:'')}),
    entries:J.slice(-TIER.OVERVIEW).map(e=>e.t+': '+cut(e.text,TIER.OV_ENTRY)),total:J.length,
    note:'Older entries live on as chapters; journal_search finds anything in them, your landmarks and your entries.'}}
// journal_search {query, day?, n?}: keyword and name match over entries, landmarks, chapters and lines waiting
// for a chapter. Title and landmark hits weigh more; ties go to the newer. Meaning (issue #553): the relay may hand
// `_sem` {key: 0..1} (src/sim/semkey.js; the sim never calls a network) which adds up to SEM.MAX to a hit and finds
// what the words miss, marked semantic; `_pool` (the relay's own ask) returns the texts to embed. Without them, as before.
const rawTexts=a=>{const T=tiersOf(a),out=[];
  for(const e of a.journal||[])out.push(e.t+': '+e.text);
  for(const m of T.marks)out.push(m.text);
  for(const c of T.chapters)out.push((c.title?c.title+' | ':'')+c.text);
  for(const p of T.pend)out.push(p.text);
  return out};
export function searchPool(a){tiersOf(a);vows(a);const out=[];for(const r of rawTexts(a)){const t=cut(r,SEM.TEXT);out.push({k:semKey(t),text:t});if(out.length>=SEM.POOL)break}return {ok:true,pool:out}}
export function search(a,{query,day,n,_sem,_pool}={}){if(_pool===true)return searchPool(a);const T=tiersOf(a);vows(a);const k=Math.max(1,Math.min(TIER.N_MAX,Math.round(Number(n)||TIER.N)));
  const qs=words(query),dd=day!=null&&day!==''&&Number.isFinite(Number(day))?Math.round(Number(day)):null,sem=semOf(_sem);
  if(!qs.length&&dd==null&&!(sem&&String(query||'').trim()))return {ok:false,error:'Search for what? Give a few words (a name, a place, what happened), or a day.'};
  const searching=qs.length>0||!!sem&&String(query||'').trim()!=='';
  const hit=(ws)=>{let c=0;for(const q of qs)if(ws.some(w=>w===q||q.length>=4&&w.startsWith(q)||w.length>=4&&q.startsWith(w)))c++;return c};
  const out=[];
  const add=(kind,d0,d1,text,s,extra,raw)=>{if(dd!=null&&(dd<d0||dd>d1))return;const sb=sem&&searching?semBonus(sem[semKey(cut(raw,SEM.TEXT))]):0;if(searching&&!s&&!sb)return;
    out.push({kind,day:d0===d1?d0:d0+'-'+d1,text:cut(text,TIER.HIT_LEN),s:s+sb+(dd!=null?1:0),o:d1,...(sb>0?{semantic:true}:{}),...extra})};
  for(const e of a.journal||[]){const d=entryDay(e);add('entry',d,d,e.t+': '+e.text,hit(words(e.text)),{},e.t+': '+e.text)}
  for(const m of T.marks)add('landmark',m.day,m.day,m.text,qs.length?3*hit(words(m.text)):searching?0:1,{},m.text);
  for(const c of T.chapters){const s=qs.length?2*hit(words(c.title||''))+hit(words(c.text))+hit(c.kw||[]):searching?0:1;add('chapter',c.d0,c.d1,(c.title?c.title+' | ':'')+c.text,s,{chapter:c.n},(c.title?c.title+' | ':'')+c.text)}
  for(const p of T.pend)add('older',p.day,p.day,p.text,hit(words(p.text)),{},p.text);
  out.sort((p,q)=>q.s-p.s||q.o-p.o);
  return {ok:true,found:out.length,...(sem&&searching?{ranked:'keywords and meaning'}:{}),results:out.slice(0,k).map(({s,o,...r})=>r),...(out.length>k?{more:out.length-k}:{})}}

// The mirror and the panels: a plain copy.
export const tiersView=a=>{const T=a&&a.tiers;if(!T)return null;return {marks:T.marks.map(m=>({day:m.day,k:m.k,text:m.text})),chapters:T.chapters.map(c=>({n:c.n,d0:c.d0,d1:c.d1,title:c.title,text:c.text,src:c.src})),pend:T.pend.length}};
