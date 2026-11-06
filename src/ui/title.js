// Title screen (owner request): shown once per page load, before any world is built or restored, so nothing
// ticks and no save resumes behind it.
//   titleWanted()        false for ?continue=1, ?skip-title=1 or ?title=0, a queued New World setup, or a reload we
//                        asked for (Load, Import); then main.js boots straight in as before
//   showTitle(play)      the menu; play(kind) builds the world: 'continue' (the save, as auto-restore did) or
//                        'default' (no save: the default world)
// Continue (with a line on the save), New world (the setup page of #133, asking first when it replaces a save),
// Load from file (Import), the map (Eldmoor / Stepping Lands: a reload with ?world=) and the relay's status.
// Enter plays the first choice (Continue when there is a save, else New world).
// What's new (#664): the patch notes (docs/patchnotes/*.md, a Vite ?raw glob handed over by main.js through provideNotes)
// that this viewer has not read, newest first: three expanded, the rest behind a "more" fold, a NEW badge until read
// (Got it, or any choice that leaves the title). Read notes are kept per viewer in localStorage with the build's commit.
import {WORLD_ID} from '../world/map.js';
import {WORLDS} from '../world/spec.js';
import {FAC} from '../data/factions.js';
import {heroSprite,outlined} from '../render/sprites.js';
import {saveSummary,exportStored,importFile,takeSkipTitle,hasPending,afterReset} from './save.js';
import {openSetup,pollRelay,watchRelay,relayState,pulledModels} from './setup.js';
import {notesFrom,noteLabel} from './patchnotes.js';
import {cinemaWish,setCinemaWish} from './cinema.js'; // open the world in the cinema view (#979)

const HELP_URL='https://github.com/tsc862-prog/eldmoor#readme';
const DEFAULT_FIVE=['Warrior','Priest','Mage','Hunter','Rogue'];
const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
const worldName=id=>(WORLDS[id]&&WORLDS[id].name)||id;
const hhmm=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');

export function titleWanted(search){const q=new URLSearchParams(search!=null?search:(typeof location!=='undefined'&&location.search)||'');
  const skipped=takeSkipTitle(); // always consumed, so it never leaks into a later load
  if(q.get('continue')==='1'||q.get('skip-title')==='1'||q.get('title')==='0')return false;
  return !hasPending()&&!skipped}

// "3 min ago", "5 h ago", or a date.
export function ago(at,now=Date.now()){if(!at)return '';const s=Math.max(0,(now-at)/1000);
  if(s<60)return 'just now';if(s<3600)return Math.floor(s/60)+' min ago';if(s<172800)return Math.floor(s/3600)+' h ago';
  try{return new Date(at).toLocaleDateString()}catch(e){return ''}}

// The one line under Continue: world, day and time, the Fellowship and its levels, when it was saved.
export function saveLine(sum,id=WORLD_ID){if(!sum)return '';const parts=[worldName(id)+' · Day '+sum.day+', '+hhmm(sum.min)];
  const F=sum.fellowship;
  if(F&&F.members.length)parts.push((F.name?F.name+': ':'')+F.members.map(m=>m.name+' '+(m.dead?'(fallen)':m.lvl)).join(', '));
  else parts.push(sum.heroes+' heroes, no Fellowship');
  const a=ago(sum.at);parts.push(a?'saved '+a:sum.kb+' KB');
  return parts.join(' · ')}

let root=null,st=null,timer=0,unwatch=null,playFn=null;

// ---- What's new (#664) ----
const NOTES_KEY='eldmoor.notesSeen',BUILD=typeof __COMMIT__!=='undefined'?String(__COMMIT__):'';
let NOTES=[];
export function provideNotes(map){NOTES=notesFrom(map)}
const store=()=>{try{return typeof localStorage!=='undefined'?localStorage:null}catch(e){return null}};
function seenNotes(){try{const j=JSON.parse(store().getItem(NOTES_KEY)||'null');return j&&Array.isArray(j.ids)?j:null}catch(e){return null}}
export function unreadNotes(){const s=seenNotes(),ids=new Set(s?s.ids:[]);return NOTES.filter(n=>!ids.has(n.id)).reverse()} // newest first
export function markNotesRead(){if(!NOTES.length)return;try{store().setItem(NOTES_KEY,JSON.stringify({ids:NOTES.map(n=>n.id),commit:BUILD,at:Date.now()}))}catch(e){}}
function noteEl(n){const d=el('div','tnote');const h=el('div','tnh');h.append(el('span','tnn',noteLabel(n)),el('span','tnt',n.title),el('span','tnd',n.date));d.append(h);
  const ul=el('ul','tnl');for(const l of n.lines)ul.append(el('li',null,l));d.append(ul);return d}
function newsBlock(){const unread=unreadNotes(),list=unread.length?unread:NOTES.slice().reverse().slice(0,3);if(!list.length)return null;
  const box=el('section','tnews'+(unread.length?' unread':''));box.setAttribute('aria-label',"What's new");
  const head=el('div','tnhead');const h=el('h2','tnttl',"What's new");if(unread.length)h.append(el('span','tnew','NEW'));head.append(h);
  if(unread.length){const b=btn('Got it','notesread','tnread');b.title='Mark these notes read';head.append(b)}
  else{const b=btn(st.notesOpen?'Hide':'Show the latest','notesmore','tnread');b.setAttribute('aria-expanded',String(!!st.notesOpen));head.append(b)}
  box.append(head);
  if(!unread.length){if(st.notesOpen)for(const n of list)box.append(noteEl(n));return box}
  for(const n of list.slice(0,3))box.append(noteEl(n));
  const rest=list.slice(3);
  if(rest.length){const b=btn(st.notesOpen?'Fewer':rest.length+' more','notesmore','tnmore');b.setAttribute('aria-expanded',String(!!st.notesOpen));box.append(b);
    if(st.notesOpen)for(const n of rest)box.append(noteEl(n))}
  return box}

function btn(label,a,cls){const b=el('button','tbtn'+(cls?' '+cls:''),label);b.type='button';b.dataset.a=a;return b}

// The Fellowship (or five default heroes) drawn in pixels, in code.
function art(sum){const c=el('canvas','tart');const F=sum&&sum.fellowship;
  const heroes=F&&F.members.length?F.members:DEFAULT_FIVE.map(cls=>({cls,fac:0}));
  const S=4,W=14*S,H=16*S;c.width=W*heroes.length;c.height=H;c.setAttribute('aria-hidden','true');
  const x=c.getContext('2d');if(!x)return c;try{x.imageSmoothingEnabled=false}catch(e){}
  heroes.forEach((h,i)=>{try{const a={fac:FAC[h.fac]?h.fac:0,cls:h.cls,race:h.race,skin:h.skin,hair:h.hair};
    const sp=outlined(heroSprite(a,!!h.dead,0));x.drawImage(sp,i*W+Math.round((W-sp.width*S)/2),H-sp.height*S-2,sp.width*S,sp.height*S)}catch(e){}});
  x.fillStyle='#2e3456';x.fillRect(0,H-2,c.width,2);return c}

function mapRow(){const row=el('div','tmap');row.setAttribute('role','group');row.setAttribute('aria-label','World map');
  row.append(el('span','tlbl','Map'));
  for(const id of Object.keys(WORLDS)){const sum=id===WORLD_ID?st.sum:saveSummary(id);
    const b=btn(worldName(id),'map','tmapbtn');b.dataset.world=id;b.setAttribute('aria-pressed',String(id===WORLD_ID));
    b.title=sum?'Saved world: day '+sum.day:'No saved world yet';b.append(el('span','tmapsub',sum?'day '+sum.day:'new'));row.append(b)}
  return row}

function relayText(){const s=relayState(),models=pulledModels();
  const t={checking:'Checking the relay…',offline:'Relay offline: agents will not play until it runs (npm run relay -- --runners).',
    norunners:'Relay up, runners off (npm run relay -- --runners to start agents from the page).',ready:'Relay up, runners on: agents can play.'}[s];
  return {s,t:t+((s==='ready'||s==='norunners')?(models.length?' Local models: '+models.slice(0,4).join(', ')+(models.length>4?'…':'')+'.':' No local model pulled.'):'')}}
function paintRelay(){if(!root)return;const n=root.querySelector('.trelay');if(!n)return;const {s,t}=relayText();
  n.className='trelay '+s;const tx=n.querySelector('.trtext');if(tx&&tx.textContent!==t)tx.textContent=t}

function render(){const page=el('div','tpage'),sum=st.sum;
  page.append(art(sum),el('h1','ttl','Eldmoor'),el('div','tsub','A hardcore 8-bit world played by AI heroes. You watch the Fellowship’s story.'));
  page.append(mapRow());
  const menu=el('div','tmenu');
  if(sum){const c=btn('Continue','continue','primary');c.setAttribute('aria-describedby','tsaveline');menu.append(c);
    const line=el('div','tsave',saveLine(sum));line.id='tsaveline';menu.append(line)}
  if(st.ask){const box=el('div','tconfirm');box.setAttribute('role','alertdialog');box.setAttribute('aria-label','Replace the saved world?');
    box.append(el('div',null,'A new world replaces the saved '+worldName(WORLD_ID)+' world (day '+sum.day+') when you press Start on the next page. It cannot be brought back unless you export it first.'));
    const row=el('div','tbtns');row.append(btn('Export it first','export'),btn('Set up a new world','replace','danger'),btn('Back','back'));box.append(row);menu.append(box)}
  else menu.append(btn('New world','new',sum?'':'primary'));
  menu.append(btn('Load from file','load'));
  if(!sum)menu.append(btn('Watch the default world','default'));
  const cin=btn('Cinema view: '+(cinemaWish()?'on':'off')+' · C','cinema');cin.setAttribute('aria-pressed',String(cinemaWish()));cin.setAttribute('aria-keyshortcuts','c');cin.title='Open the world as a full-window film: a director camera and thin overlays. C enters and leaves it in play';menu.append(cin);
  page.append(menu);
  const news=newsBlock();if(news)page.append(news);
  if(st.msg)page.append(el('div','tmsg',st.msg));
  const rl=el('div','trelay');rl.append(el('span','sdot'),el('span','trtext',''));page.append(rl);
  const foot=el('div','tfoot');foot.append(el('span',null,'Enter: '+(sum?'Continue':'New world')+' · '));
  const help=el('a',null,'Help');help.href=HELP_URL;help.target='_blank';help.rel='noopener';foot.append(help);page.append(foot);
  const file=el('input');file.type='file';file.accept='application/json,.json';file.hidden=true;file.className='tfile';page.append(file);
  file.onchange=()=>{const f=file.files&&file.files[0];if(f)importFile(f,m=>{st.msg=m;render();focus('load')})};
  root.replaceChildren(page);paintRelay()}

function focus(a){const b=root&&root.querySelector('[data-a="'+a+'"]');if(b&&b.focus)b.focus()}
function hide(){if(root)root.hidden=true;if(timer){clearInterval(timer);timer=0}}
function show(){root.hidden=false;st.ask=false;st.msg='';st.sum=saveSummary(WORLD_ID);render();
  if(!timer&&typeof setInterval==='function')timer=setInterval(()=>pollRelay(),3000);pollRelay(true);focus(st.sum?'continue':'new')}

function play(kind){markNotesRead();hide();if(unwatch){unwatch();unwatch=null}if(root){root.remove();root=null}const f=playFn;playFn=null;if(f)f(kind)}
function newWorld(confirmed){markNotesRead();hide();openSetup({back:()=>show(),confirmed:confirmed?WORLD_ID:null})}

function onClick(e){const t=e.target&&e.target.closest?e.target.closest('[data-a]'):null;if(!t||!root||!root.contains(t))return;const a=t.dataset.a;
  if(a==='continue')return play('continue');
  if(a==='cinema'){setCinemaWish(!cinemaWish());render();focus('cinema');return}
  if(a==='notesread'){markNotesRead();st.notesOpen=false;render();focus(st.sum?'continue':'new');return}
  if(a==='notesmore'){st.notesOpen=!st.notesOpen;render();focus('notesmore');return}
  if(a==='default')return afterReset(()=>play('default')); // a world reset stops the runners first (#691)
  if(a==='new'){if(st.sum){st.ask=true;render();focus('export');return}return newWorld(false)}
  if(a==='replace')return newWorld(true);
  if(a==='back'){st.ask=false;render();focus('new');return}
  if(a==='export'){st.msg=exportStored(WORLD_ID)?'Exported the saved '+worldName(WORLD_ID)+' world.':'There is no save to export.';render();focus('replace');return}
  if(a==='load'){const f=root.querySelector('.tfile');if(f){f.value='';f.click()}return}
  if(a==='map'){const id=t.dataset.world;if(id===WORLD_ID)return;const u=new URL(location.href);
    if(id==='eldmoor')u.searchParams.delete('world');else u.searchParams.set('world',id);afterReset(()=>{location.href=u.href})}}

function onKey(e){if(!root||root.hidden)return;
  if(e.key==='Escape'&&st.ask){st.ask=false;render();focus('new');return}
  if((e.key==='c'||e.key==='C')&&!e.repeat&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&!st.ask){setCinemaWish(!cinemaWish());render();focus('cinema');return}
  if(e.key!=='Enter')return;const tag=e.target&&e.target.tagName;if(tag==='BUTTON'||tag==='A'||tag==='INPUT'||tag==='SELECT')return; // the focused control acts itself
  if(e.preventDefault)e.preventDefault();if(st.ask)return;if(st.sum)play('continue');else newWorld(false)}

export function showTitle(onPlay){playFn=onPlay;st={sum:null,ask:false,msg:''};
  root=el('div','title');root.id='title';root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','Eldmoor: title');
  document.body.append(root);root.addEventListener('click',onClick);document.addEventListener('keydown',onKey);
  unwatch=watchRelay(paintRelay);show();return root}
export const titleOpen=()=>!!(root&&!root.hidden);
