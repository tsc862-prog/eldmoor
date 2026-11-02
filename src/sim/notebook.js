// Agent memories (issue #155): each agent-played hero and the DM keep their own searchable notes, saved
// with the world as character knowledge. Owned by brain-builder. DOM-free, RNG-free, never called by step():
// only tool calls (sim/player.js, sim/dmagent.js), the runner's state header (sim/pace.js), the hosts' mirror
// (scripts/memory-mirror.mjs) and the panels read or write it, so the seeded headless sim is unchanged.
//
//   a.memories = {seq, notes:[note], arch:[note], v, day:{d, w}}                   a hero's notebook
//   S.dmAgent.notes = {threads,characters,plans,secrets:[note]}, .arch, .seq, .mv  the DM's (sections of #66)
//   note = {id, title, text, tags:[], about, rk, day, t, gm, up, upDay?, pin?, sec? (DM)}
//     about: who or what it concerns as written (cleaned); rk: the same resolved to 'hero:12', 'npc:n3',
//     'town:Highgate', 'region:Mirefen', 'place:7' or 'adv:45' when the world knows it (for relevance only).
//
// Rules:
//   - Seats stay apart (issue #123): a hero's tools touch only its own notebook, the DM's only the DM's; no
//     snapshot, prompt, other seat's tool or DM tool reads another notebook (scripts/channelcheck.mjs).
//   - Caps: NB.NOTES notes of NB.LEN characters (DM: DM_NB.PER_SEC a section); a new note over the cap
//     archives the oldest unpinned one (kept in arch, NB.ARCH at most, still found by recall, marked archived);
//     pinned notes are never archived (NB.PINS at most).
//   - Hardcore: the notebook dies with the hero. The dead hero's tools all answer "dead" (sim/player.js), its
//     replacement starts with an empty one. One exception, chosen for the Fellowship: a member's newest pinned
//     note tagged "letter" is sealed for the party (S.fellowship.letters[slot]); when that member has fallen,
//     the next hero to take the slot finds it as a pinned note "A letter from <name>". Nothing else crosses.
//   - Relevance is keyword scoring, deterministic (see score/relevant below); no embeddings, no model.
import {S,clockStr} from './state.js';
import {ZONES,CITY,zoneAt,dist} from '../world/map.js';
import {nearHeroes} from './spatial.js';
import {sightMul} from './weather.js';
import {partyMates} from './party.js';
import {tableView} from './table.js';
import {openProps} from './council.js';

export const NB={
  NOTES:200,        // notes a hero keeps before the oldest unpinned is archived
  LEN:600,TITLE:80, // characters of a note's text and title
  TAGS:6,TAG_LEN:24,ABOUT:60,
  ARCH:40,          // archived notes kept (oldest dropped beyond)
  PINS:20,          // pinned notes at most (so there is always something to archive)
  WRITES_PER_DAY:60,// remember, update_memory, forget and pin calls per game day
  N:5,N_MAX:20,     // recall results by default and at most
  HEAD:3,           // notes in the state header
  SIGHT:12,         // tiles: the people a hero can see count as "present" (the look radius of sim/player.js)
};
export const DM_NB={PER_SEC:50}; // the DM: notes a section (four sections, 200 in all)

const DAY=1440;
const dayNo=()=>Math.floor(S.gameMin/DAY)+1;
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const hero=id=>S.agents.find(x=>x.id===id)||null;

// ---- the books ----
// A book is a thin view over a store: {secs, list(sec), arch, next(), touch(), cap, pins, kind}.
export const notebookOf=a=>{const M=a.memories||(a.memories={seq:0,notes:[],arch:[],v:0,day:{d:0,w:0}});deliverLetter(a,M);return M};
function heroBook(a){const M=notebookOf(a);return {kind:'hero',secs:['notes'],list:()=>M.notes,arch:M.arch,next:()=>++M.seq,touch:()=>{M.v=(M.v||0)+1;syncLetter(a)},cap:NB.NOTES,M}}
export function dmBook(D){if(!D.arch)D.arch=[];for(const k in D.notes)for(const n of D.notes[k])if(n.sec!==k)n.sec=k; // each DM note knows its section (older saves' do not)
  return {kind:'dm',secs:Object.keys(D.notes),list:s=>D.notes[s],arch:D.arch,next:()=>++D.seq,touch:()=>{D.mv=(D.mv||0)+1},cap:DM_NB.PER_SEC}}
const allOf=b=>{const out=[];for(const s of b.secs)for(const n of b.list(s))out.push(n);return out};
function find(b,id){id=Number(id);if(!Number.isFinite(id))return null;
  for(const s of b.secs){const L=b.list(s),i=L.findIndex(n=>n.id===id);if(i>=0)return {n:L[i],L,i,sec:s,arch:false}}
  const i=b.arch.findIndex(n=>n.id===id);return i>=0?{n:b.arch[i],L:b.arch,i,sec:b.arch[i].sec||b.secs[0],arch:true}:null}

// ---- the parts of a note ----
const tagsOf=v=>{const raw=Array.isArray(v)?v:typeof v==='string'?v.split(/[,;]/):[];const out=[];
  for(const t of raw){const x=clean(t,NB.TAG_LEN).toLowerCase().replace(/[^\p{L}\p{N} _-]/gu,'').trim();if(x&&!out.includes(x))out.push(x);if(out.length>=NB.TAGS)break}return out};
// What `about` names, resolved against what the world knows: a hero, a townsperson or placed person, a town,
// a region, a marked place, or an adventure ("quest 12", "adv:12"). Unknown text stays text.
export function resolveAbout(v){const s=clean(v,NB.ABOUT);if(!s)return {about:null,ref:null};const lo=s.toLowerCase();
  const q=/^(?:quest|adv|adventure|job)\s*[:#]?\s*(\d+)$/i.exec(s);if(q){const A=(S.adventures||[]).find(x=>x.id===Number(q[1]));return A?{about:(A.title||'adventure')+' (quest '+A.id+')',ref:'adv:'+A.id}:{about:s,ref:null}}
  const num=/^#?(\d+)$/.exec(s),hid=num?Number(num[1]):null;
  const h=S.agents.find(x=>x.kind==='hero'&&(hid!=null?x.id===hid:x.name.toLowerCase()===lo));if(h)return {about:h.name+' (hero '+h.id+')',ref:'hero:'+h.id};
  const p=[...(S.npcs||[]),...(S.wanderers||[])].find(n=>String(n.id).toLowerCase()===lo||String(n.name||'').toLowerCase()===lo||((n.title?n.title+' ':'')+n.name).toLowerCase()===lo);
  if(p)return {about:(p.title?p.title+' ':'')+p.name,ref:'npc:'+p.id};
  const c=CITY.find(x=>x.name.toLowerCase()===lo);if(c)return {about:c.name,ref:'town:'+c.name};
  const z=ZONES.findIndex(n=>String(n).toLowerCase()===lo);if(z>=0)return {about:ZONES[z],ref:'region:'+ZONES[z]};
  const pl=(S.places||[]).find(x=>String(x.id)===s||String(x.name||'').toLowerCase()===lo);if(pl)return {about:pl.name,ref:'place:'+pl.id};
  if(hid!=null){const A=(S.adventures||[]).find(x=>x.id===hid);if(A)return {about:(A.title||'adventure')+' (quest '+A.id+')',ref:'adv:'+A.id}}
  return {about:s,ref:null}}
const view=(n,full=true)=>({id:n.id,title:n.title,...(full?{text:n.text}:{}),...(n.tags&&n.tags.length?{tags:n.tags}:{}),...(n.about?{about:n.about}:{}),...(n.sec&&n.sec!=='notes'?{section:n.sec}:{}),
  day:n.day,...(n.upDay&&n.upDay!==n.day?{updated_day:n.upDay}:{}),...(n.pin?{pinned:true}:{}),...(n.arch?{archived:true}:{})});
const titleOf=(t,text)=>clean(t,NB.TITLE)||clean(text,NB.TITLE).replace(/\s\S*$/,'')||'Untitled';

// ---- write ----
// Make room in a list of `cap`: archive the oldest unpinned note (by last update). -> the archived note, or null when all are pinned.
function makeRoom(b,L,sec){if(L.length<b.cap)return {};let k=-1;for(let i=0;i<L.length;i++)if(!L[i].pin&&(k<0||(L[i].up??L[i].gm??0)<(L[k].up??L[k].gm??0)))k=i;
  if(k<0)return {full:true};const n=L.splice(k,1)[0];n.arch=true;n.sec=sec;b.arch.push(n);while(b.arch.length>NB.ARCH)b.arch.shift();return {archived:n}}
function restoreNote(b,f){if(!f.arch)return null;const L=b.list(f.sec)||b.list(b.secs[0]),room=makeRoom(b,L,f.sec);if(room.full)return 'Your notes are full of pinned ones: unpin one first.';
  b.arch.splice(b.arch.indexOf(f.n),1);delete f.n.arch;if(b.kind==='hero')delete f.n.sec;L.push(f.n);f.L=L;f.arch=false;return null}
export function addNote(b,{title,text,tags,about,sec,pin},len=NB.LEN){const t=clean(text,len);if(!t)return {ok:false,error:'Remember what? Give text (and a short title).'};
  sec=sec||b.secs[0];const L=b.list(sec);if(!L)return {ok:false,error:'section must be one of '+b.secs.join(', ')};
  const room=makeRoom(b,L,sec);if(room.full)return {ok:false,error:'Your notes are full of pinned ones: unpin or forget one first.'};
  const ab=resolveAbout(about),gm=Math.round(S.gameMin);
  const n={id:b.next(),title:titleOf(title,t),text:t,tags:tagsOf(tags),about:ab.about,rk:ab.ref,day:dayNo(),t:clockStr(),gm,up:gm,...(b.kind==='dm'?{sec}:{})};
  if(pin&&pinCount(b)<NB.PINS)n.pin=true;
  L.push(n);b.touch();return {ok:true,note:n,archived:room.archived||null}}
export function updateNote(b,id,{text,title,tags,about},len=NB.LEN){const f=find(b,id);if(!f)return {ok:false,error:'No memory '+id+'.'};
  const t=text!=null?clean(text,len):null;if(text!=null&&!t)return {ok:false,error:'update_memory needs the new text (forget removes a note).'};
  if(t==null&&title==null&&tags==null&&about==null)return {ok:false,error:'Nothing to change: give text (and optionally title, tags, about).'};
  const e=restoreNote(b,f);if(e)return {ok:false,error:e};const n=f.n;
  if(t!=null)n.text=t;if(title!=null&&clean(title,NB.TITLE))n.title=clean(title,NB.TITLE);if(tags!=null)n.tags=tagsOf(tags);
  if(about!=null){const ab=resolveAbout(about);n.about=ab.about;n.rk=ab.ref}
  n.up=Math.round(S.gameMin);n.upDay=dayNo();n.t=clockStr();b.touch();return {ok:true,note:n}}
export function forgetNote(b,id){const f=find(b,id);if(!f)return {ok:false,error:'No memory '+id+'.'};f.L.splice(f.i,1);b.touch();return {ok:true,note:f.n}}
const pinCount=b=>allOf(b).filter(n=>n.pin).length;
export function pinNote(b,id,on=true){const f=find(b,id);if(!f)return {ok:false,error:'No memory '+id+'.'};
  if(on&&!f.n.pin&&pinCount(b)>=NB.PINS)return {ok:false,error:'At most '+NB.PINS+' pinned notes: unpin one first.'};
  if(on){const e=restoreNote(b,f);if(e)return {ok:false,error:e}}
  if(on)f.n.pin=true;else delete f.n.pin;b.touch();return {ok:true,note:f.n}}

// ---- search ----
// Words of a text: lower case, letters and digits, 3+ characters, minus the commonest words.
const STOP=new Set('the and for with that this from have has had was were are you your our their them they his her him she its not but all any can will would into onto out about who what when where why how than then there here one two some more most very just also over under after before again'.split(' '));
export const words=s=>String(s||'').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>=3&&!STOP.has(w));
const hit=(qs,ws)=>{let k=0;for(const q of qs)if(ws.some(w=>w===q||q.length>=4&&w.startsWith(q)||w.length>=4&&q.startsWith(w)))k++;return k};
const recency=n=>2/(1+Math.max(0,S.gameMin-(n.up??n.gm??0))/DAY); // 2 today, 1 a day ago, .5 three days ago
// recall: query words in the title (3) and tags (3), the about line (2) and the text (1); a tag or about filter
// keeps only the notes that match it; then +1 pinned and the recency bonus. Ties: the newer id first.
export function recallNotes(b,{query,tag,about,id,n,section}={}){
  const k=Math.max(1,Math.min(NB.N_MAX,Math.round(Number(n)||NB.N)));
  if(id!=null&&id!==''){const f=find(b,id);return f?{ok:true,notes:[view(f.n)]}:{ok:false,error:'No memory '+id+'.'}}
  const qs=words(query),tg=tag?clean(tag,NB.TAG_LEN).toLowerCase():null,ab=about?resolveAbout(about):null,abw=ab?words(ab.about):[];
  if(section&&!b.secs.includes(section))return {ok:false,error:'section must be one of '+b.secs.join(', ')};
  const pool=[...allOf(b),...b.arch].filter(x=>!section||(x.sec||b.secs[0])===section||b.kind==='hero');
  const out=[];
  for(const x of pool){
    if(tg&&!(x.tags||[]).includes(tg))continue;
    if(ab&&!(ab.ref&&x.rk===ab.ref||!ab.ref&&abw.length&&hit(abw,words(x.about))===abw.length))continue;
    let s=0;if(qs.length){s=3*hit(qs,words(x.title))+3*hit(qs,x.tags||[])+2*hit(qs,words(x.about))+hit(qs,words(x.text));if(!s)continue}
    s+=(x.pin?1:0)+recency(x)-(x.arch?1:0);out.push({x,s})}
  out.sort((p,q)=>q.s-p.s||q.x.id-p.x.id);
  return {ok:true,found:out.length,notes:out.slice(0,k).map(o=>view(o.x)),...(out.length>k?{more:out.length-k}:{})}}

// ---- what matters now ----
// The context of a moment: refs of the people, places and quest present, their names, and the words of an open
// scene or vote. relevant() scores each active note: a ref match 6, a present name in the title, tags or about 3
// (in the text 1), scene and vote words in the title or tags 1 each (at most 3), pinned 1; notes with a score get
// the recency bonus on top, and the best `k` come back as {id, title} only.
export function relevant(b,ctx,k=NB.HEAD){if(!ctx)return [];const names=ctx.names.map(s=>s.toLowerCase()),out=[];
  for(const x of allOf(b)){const head=words(x.title+' '+(x.about||'')).concat(x.tags||[]),body=words(x.text);
    let s=x.rk&&ctx.refs.has(x.rk)?6:0;
    for(const nm of names){const nw=words(nm);if(!nw.length)continue;if(nw.every(w=>head.includes(w)))s+=3;else if(nw.every(w=>body.includes(w)))s+=1}
    s+=Math.min(3,hit(ctx.words,head));if(x.pin)s+=1;
    if(s>0)out.push({x,s:s+recency(x)/4})}
  out.sort((p,q)=>q.s-p.s||q.x.id-p.x.id);return out.slice(0,k).map(o=>({id:o.x.id,title:o.x.title}))}
function ctxNew(){return {refs:new Set(),names:[],words:[]}}
const addRef=(c,ref,name)=>{if(ref)c.refs.add(ref);if(name&&!c.names.includes(name))c.names.push(name)};
// A hero's moment, from what it perceives: its region and town, the heroes it can see and its party, the
// townsfolk at hand, its foe, its adventure, an open table scene and the Fellowship's open votes.
export function heroContext(a){const c=ctxNew(),z=zoneAt(a.x,a.y);
  if(ZONES[z])addRef(c,'region:'+ZONES[z],ZONES[z]);
  const town=CITY.find(t=>a.x>=t.x0-.5&&a.x<=t.x1+1.5&&a.y>=t.y0-.5&&a.y<=t.y1+1.5);if(town)addRef(c,'town:'+town.name,town.name);
  const r=NB.SIGHT*sightMul(z);
  for(const b of partyMates(a))addRef(c,'hero:'+b.id,b.name);
  for(const b of nearHeroes(a.x,a.y,r,b=>b!==a&&b.state!=='dead'&&!b.hidden).slice(0,12))addRef(c,'hero:'+b.id,b.name);
  for(const p of [...(S.npcs||[]),...(S.wanderers||[])])if(Number.isFinite(p.x)&&dist(p,a)<=6)addRef(c,'npc:'+p.id,p.name);
  for(const p of S.places||[])if(dist(p,a)<=r)addRef(c,'place:'+p.id,p.name);
  const t=a.target;if(t&&t.kind==='hero')addRef(c,'hero:'+t.id,t.name);else if(t&&(t.elite||t.named)&&t.name)addRef(c,null,t.name);
  const adv=a.adv&&(S.adventures||[]).find(v=>v.id===a.adv&&v.phase==='active');if(adv){addRef(c,'adv:'+adv.id,null);c.words.push(...words(adv.title))}
  const tv=tableView(a);if(tv)c.words.push(...words((tv.title||'')+' '+(tv.scene||'')));
  if(a.fellow)for(const P of openProps())c.words.push(...words(P.kind+' '+(P.details||'')));
  return c}
// The DM's moment: the Fellowship (members, where they are, their adventures), an open or staged scene, open votes.
export function dmContext(){const c=ctxNew(),F=S.fellowship;
  if(F)for(const id of F.ids||[]){const a=hero(id);if(!a||a.state==='dead')continue;addRef(c,'hero:'+a.id,a.name);const z=zoneAt(a.x,a.y);if(ZONES[z])addRef(c,'region:'+ZONES[z],ZONES[z]);
    if(a.adv)addRef(c,'adv:'+a.adv,null)}
  if(F){const town=F.hall;if(town)addRef(c,'town:'+town,town);for(const P of openProps())c.words.push(...words(P.kind+' '+(P.details||'')))}
  const sc=S.table;if(sc)c.words.push(...words((sc.title||'')+' '+(sc.kind||'')));
  return c}
// The state header's notes (sim/pace.js): nothing for a hero with no notebook, unless a letter waits for it.
const letterFor=a=>!!(a.fellow&&a.fellowRole&&S.fellowship&&S.fellowship.letters&&S.fellowship.letters[a.fellowRole]);
export const heroRelevant=a=>(a.memories&&a.memories.notes.length)||letterFor(a)?relevant(heroBook(a),heroContext(a)):[];

// ---- the hero's tools (sim/player.js hands these on; the hero is always the caller's own) ----
function spend(M){const d=dayNo();if(M.day.d!==d)M.day={d,w:0};if(M.day.w>=NB.WRITES_PER_DAY)return false;M.day.w++;return true}
const SLOW={ok:false,error:'That is enough note-keeping for one game day ('+NB.WRITES_PER_DAY+' writes). recall still works.'};
export function heroMemory(a,tool,args){const b=heroBook(a),M=b.M;args=args||{};
  if(tool==='recall')return recallNotes(b,args);
  if(!spend(M))return SLOW;
  if(tool==='remember'){const r=addNote(b,{title:args.title,text:args.text,tags:args.tags,about:args.about,pin:false});if(!r.ok)return r;
    return {ok:true,remembered:view(r.note,false),notes:M.notes.length,...(r.archived?{archived:{id:r.archived.id,title:r.archived.title,note:'your oldest unpinned note was archived (recall still finds it)'}}:{})}}
  if(tool==='update_memory'){const r=updateNote(b,args.id,args);return r.ok?{ok:true,updated:view(r.note)}:r}
  if(tool==='forget'){const r=forgetNote(b,args.id);return r.ok?{ok:true,forgot:{id:r.note.id,title:r.note.title},notes:M.notes.length}:r}
  if(tool==='pin'){const on=!(args.on===false||/^(false|no|off)$/i.test(String(args.on||'')));const r=pinNote(b,args.id,on);if(!r.ok)return r;
    return {ok:true,[on?'pinned':'unpinned']:{id:r.note.id,title:r.note.title},...(on&&a.fellow&&(r.note.tags||[]).includes('letter')?{note:'Sealed as your letter to the Fellowship: if you fall, whoever takes your place will find it.'}:{})}}
  return {ok:false,error:'Unknown memory tool '+tool+'.'}}

// ---- the letter (Fellowship only) ----
// The newest pinned note tagged "letter" of a living member is sealed for its slot; delivered once, to the next
// hero who takes the slot after the writer has fallen.
function syncLetter(a){const F=S.fellowship;if(!F||!a.fellow||!a.fellowRole||a.state==='dead')return;const L=F.letters||(F.letters={});
  const n=(a.memories.notes||[]).filter(x=>x.pin&&(x.tags||[]).includes('letter')).sort((p,q)=>(q.up||0)-(p.up||0)||q.id-p.id)[0];
  const cur=L[a.fellowRole];if(cur&&cur.from!==a.id){const w=hero(cur.from);if(!w||w.state==='dead')return} // a fallen writer's letter still waits for its reader
  if(n)L[a.fellowRole]={from:a.id,name:a.name,title:n.title,text:n.text,day:n.day};else if(cur&&cur.from===a.id)delete L[a.fellowRole]}
function deliverLetter(a,M){const F=S.fellowship;if(!F||!F.letters||!a.fellow||!a.fellowRole)return;const l=F.letters[a.fellowRole];
  if(!l||l.from===a.id)return;const w=hero(l.from);if(w&&w.state!=='dead')return; // the writer still lives: not for anyone yet
  delete F.letters[a.fellowRole];const gm=Math.round(S.gameMin);
  M.notes.push({id:++M.seq,title:clean('A letter from '+l.name,NB.TITLE),text:clean(l.title+': '+l.text,NB.LEN),tags:['letter'],about:l.name,rk:'hero:'+l.from,day:dayNo(),t:clockStr(),gm,up:gm,pin:true});M.v=(M.v||0)+1}

// ---- the mirror (scripts/memory-mirror.mjs writes it; nothing reads it back) ----
// Seats whose notebook changed since `sent` (a Map of seat key -> signature the host keeps), as plain payloads.
// The host marks them sent itself after writing. Agent-played heroes (living or dead) and the DM seat.
export function mirrorDirty(sent){const out=[];
  for(const id of S.playerHeroes||[]){const a=hero(id);if(!a||!a.memories)continue;const M=a.memories,dead=a.state==='dead';
    const sig=(M.v||0)+':'+(dead?1:0)+':'+a.name,key='hero:'+a.id;if(sent.get(key)===sig)continue;
    out.push({key,sig,seat:{kind:'hero',id:a.id,name:a.name,cls:a.cls,lvl:a.lvl,dead,died:dead?(a.diedAt||null):null,cause:dead?(a.cause||null):null,
      fellow:!!(a.fellow||a.fellowPast),notes:M.notes.map(n=>view(n)),arch:M.arch.map(n=>view(n))}})}
  const D=S.dmAgent;if(D&&D.notes){const sig=String(D.mv||0)+':'+Object.values(D.notes).reduce((t,l)=>t+l.length,0),key='dm';
    if(sent.get(key)!==sig)out.push({key,sig,seat:{kind:'dm',sections:Object.fromEntries(Object.entries(D.notes).map(([k,l])=>[k,l.map(n=>view({...n,title:n.title||titleOf(null,n.text)}))])),arch:(D.arch||[]).map(n=>view({...n,title:n.title||titleOf(null,n.text)}))}})}
  return out}
export {titleOf};
