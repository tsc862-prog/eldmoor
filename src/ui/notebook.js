// Agent memories in the panels (issue #155): the Memories section of a hero's Memory tab and the DM notes viewer of
// the Dungeon Master panel. Read-only views of a.memories and S.dmAgent.notes (src/sim/notebook.js), for the watcher:
// a searchable list, pinned first, with game day stamps. The watcher sees every seat's notes; no agent ever sees this.
//   renderNotebook(node, a)     the hero's Memories section (appended to the Memory tab)
//   notebookSig(a)              changes when the section must be rebuilt (panels.js rebuilds the tab only then, so the
//                               search box keeps its focus)
//   renderDmNotes(node)         the DM's notes by section, pinned first, with a search box
//   dmNotesSig()
import {S} from '../sim/index.js';
import {words} from '../sim/notebook.js';

const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
const q={hero:'',dm:''};
// A note matches the search when every word of it appears in its title, tags, about or text (prefixes count).
const matches=(n,query)=>{const qs=words(query);if(!qs.length)return true;const ws=words([n.title,(n.tags||[]).join(' '),n.about,n.text].join(' '));
  return qs.every(x=>ws.some(w=>w.startsWith(x)))};
const order=(x,y)=>(y.pin?1:0)-(x.pin?1:0)||(y.up??y.gm??0)-(x.up??x.gm??0)||y.id-x.id;
function noteLi(n,sec){const li=el('li');
  li.append(el('time',null,'D'+(n.day||'?')+(n.upDay&&n.upDay!==n.day?'→'+n.upDay:'')));
  if(n.pin)li.append(el('span','badge',(n.tags||[]).includes('letter')?'LETTER':'PIN'),' ');
  if(n.arch)li.append(el('span','badge','OLD'),' ');
  if(sec)li.append(el('span','dm',sec+' · '));
  li.append(el('b',null,'#'+n.id+' '+(n.title||String(n.text||'').slice(0,40))),' ');
  if(n.about)li.append(el('span','dm','about '+n.about+' '));
  if(n.tags&&n.tags.length)li.append(el('span','dm','['+n.tags.join(', ')+'] '));
  li.append(el('div',null,n.text));return li}
function searchBox(key,onChange){const i=el('input','sinput');i.type='search';i.placeholder='Search title, tags, about, text';i.value=q[key];i.setAttribute('aria-label','Search memories');
  i.style.cssText='width:100%;box-sizing:border-box;font:inherit;background:#0a0b14;color:inherit;border:1px solid #333;padding:2px 4px;margin:2px 0';
  i.addEventListener('input',()=>{q[key]=i.value;onChange()});return i}

export const notebookSig=a=>{const M=a&&a.memories;return M?(a.id+':'+(M.v||0)+':'+a.state):''};
export function renderNotebook(b,a){const M=a.memories;
  b.append(el('div','dm','Memories ('+(M?M.notes.length:0)+(M&&M.arch.length?' + '+M.arch.length+' archived':'')+')'+(a.state==='dead'?' · died with them':'')));
  if(!M||!M.notes.length&&!M.arch.length){b.append(el('div','dm',a.player?'No memories written yet (the agent keeps them with remember).':'Only agent-played heroes keep a notebook.'));return}
  const ul=el('ul','log hist'),fill=()=>{ul.replaceChildren();const all=[...M.notes,...M.arch.map(n=>({...n,arch:true}))].filter(n=>matches(n,q.hero)).sort(order);
    for(const n of all.slice(0,80))ul.append(noteLi(n));if(!all.length)ul.append(el('li','dm','Nothing matches.'))};
  b.append(searchBox('hero',fill),ul);fill()}

export const dmNotesSig=()=>{const D=S.dmAgent;return D?String(D.mv||0)+':'+Object.values(D.notes||{}).reduce((t,l)=>t+l.length,0):''};
export function renderDmNotes(b){const D=S.dmAgent;
  if(!D||!D.notes){b.append(el('li','dm','The DM agent has kept no notes yet.'));return}
  const box=el('li'),ul=el('ul','log hist'),fill=()=>{ul.replaceChildren();
    const all=[...Object.entries(D.notes).flatMap(([k,l])=>l.map(n=>({n,k}))),...(D.arch||[]).map(n=>({n:{...n,arch:true},k:n.sec||''}))].filter(x=>matches(x.n,q.dm)).sort((x,y)=>order(x.n,y.n));
    for(const x of all.slice(0,120))ul.append(noteLi(x.n,x.k));if(!all.length)ul.append(el('li','dm',q.dm?'Nothing matches.':'No notes yet.'))};
  const counts=Object.entries(D.notes).map(([k,l])=>k+' '+l.length).join(' · ');
  box.append(el('div','dm','DM agent notes: '+counts+((D.arch||[]).length?' · archived '+D.arch.length:'')),searchBox('dm',fill),ul);fill();b.append(box)}
