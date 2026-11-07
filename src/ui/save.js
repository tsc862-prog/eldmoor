// Save, load, export and import in the browser. The world auto-saves to its slot (SAVE_KEY; IndexedDB through
// ui/savestore.js, else localStorage) each time the game clock crosses an hour and when the tab is hidden or
// closed; boot() restores that save on page load instead of starting fresh. The World
// buttons in index.html call the rest. Load, Import and New world all go through a page
// reload: the save is put in place (or removed) and the page starts again through boot(),
// so every panel is rebuilt from state by the normal start-up path.
import {S,log,snapshot,restore,isSave,describeSave} from '../sim/index.js';
import {mapStale} from '../sim/save.js';
import {WORLD_ID} from '../world/map.js';
import {stopAllForReset} from './runners.js';
import {saveStore,whenSaved,onSaveFail} from './savestore.js';

export const saveKeyFor=id=>id==='eldmoor'?'eldmoor.save.v1':'eldmoor.save.v1.'+id;
export const SAVE_KEY=saveKeyFor(WORLD_ID); // one slot per world
export const PENDING_KEY='eldmoor.setup.pending'; // a New World setup waiting for the next boot (ui/setup.js, #133)
const atKey=key=>key+'.at'; // when that slot was last written (Date.now()), for the title screen
export const SKIP_TITLE_KEY='eldmoor.title.skip'; // sessionStorage: a reload we asked for (Load, Import) goes straight into the world
const $=id=>document.getElementById(id);
let lastHour=-1,suppress=false,hold=false,how='fresh',newWorld=null,applied=null,booted=false; // suppress: skip the unload save when we are reloading on purpose

const store=()=>{try{return saveStore()}catch(e){return null}}; // the save slots
const local=()=>{try{return window.localStorage}catch(e){return null}}; // the setup queue, which is small and read before the slots are open
const session=()=>{try{return window.sessionStorage||null}catch(e){return null}};
const skipNext=()=>{const ss=session();try{if(ss)ss.setItem(SKIP_TITLE_KEY,'1')}catch(e){}};
// True once when the page was reloaded on purpose by Load or Import (the flag is consumed).
export function takeSkipTitle(){const ss=session();if(!ss)return false;try{const v=ss.getItem(SKIP_TITLE_KEY);ss.removeItem(SKIP_TITLE_KEY);return v==='1'}catch(e){return false}}
export const hasPending=()=>{try{const j=JSON.parse(local().getItem(PENDING_KEY));return !!(j&&j.world===WORLD_ID)}catch(e){return false}};
const dayOf=min=>Math.floor(min/1440)+1;
const clock=min=>{const m=Math.floor(min)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')};
function status(msg){const el=$('wStatus');if(el)el.textContent=msg}
// A world reset (#691): every runner is stopped with one relay call before the page replaces the world (New world, Load,
// Import, the default world, another map); the page then says so once, here and again after the reload.
export const RESET_NOTE_KEY='eldmoor.reset.note';
let resetting=null;
export function resetRunners(){if(resetting)return resetting;
  resetting=stopAllForReset().then(n=>{resetting=null;if(n==null)return null;const msg='World reset: '+n+' runner'+(n===1?'':'s')+' stopped';status(msg);
    const ss=session();try{if(ss)ss.setItem(RESET_NOTE_KEY,msg)}catch(e){}return n},()=>{resetting=null;return null});return resetting}
// Stop the runners, then go (a failed or slow relay never keeps the page from reloading).
export const afterReset=go=>{resetRunners().then(whenSaved,whenSaved).then(go,go)}; // a save still on its way to IndexedDB lands first

export function readSave(){const st=store();if(!st)return null;const raw=st.getItem(SAVE_KEY);if(!raw)return null;
  const snap=JSON.parse(raw);return isSave(snap)?snap:null}
export const hasSave=()=>{try{return !!readSave()}catch(e){return false}};

// Write the current world. Returns the serialised save, or null when storage refused it.
export function writeSave(){const st=store();if(!st||hold)return null;
  const json=JSON.stringify(snapshot());
  try{st.setItem(SAVE_KEY,json);try{st.setItem(atKey(SAVE_KEY),String(Date.now()))}catch(x){}}catch(e){console.warn('Eldmoor: could not save',e);status('Save failed: storage full?');return null}
  lastHour=Math.floor(S.gameMin/60);status('Saved · Day '+dayOf(S.gameMin)+' '+clock(S.gameMin)+' · '+(json.length/1024).toFixed(0)+' KB');return json}

// Start the world: from the save when one exists and restores cleanly, else fresh via init().
// Returns true when the world was restored.
// How the world started: 'restored' (a save), 'setup' (a New World setup was applied) or 'fresh' (defaults).
export const bootKind=()=>how;
export const isBooted=()=>booted; // false while the title screen is up: no world has been built or restored yet
export const appliedSetup=()=>applied;
export const holdSave=on=>{hold=!!on}; // no autosave while the setup page sits over a world nobody chose
export const setNewWorldHandler=f=>{newWorld=f};
// What a world's save holds, without loading it: {day, min, heroes, fellowship, kb, at} (at: ms of the last write, or null).
export const saveSummary=id=>{try{const st=store(),key=saveKeyFor(id),raw=st.getItem(key);if(!raw)return null;const j=JSON.parse(raw);if(!isSave(j))return null;
  const at=+st.getItem(atKey(key))||null;return {...describeSave(j),kb:Math.round(raw.length/1024),at,stale:mapStale(j,id),map:(j.campaign&&j.campaign.map)||null}}catch(e){return null}};
// Download a world's stored save as it is (the title screen and the setup page, before any world is loaded).
export function exportStored(id=WORLD_ID){let raw=null;try{raw=store().getItem(saveKeyFor(id))}catch(e){}if(!raw)return false;
  const j=JSON.parse(raw),blob=new Blob([raw],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='eldmoor-'+(id==='eldmoor'?'':id+'-')+'day'+dayOf(j.gameMin)+'.json';document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);return true}
// Queue a New World setup and restart the page into it. The same world's save is erased (the caller has
// already asked); another world's save is left alone. Returns an error string, or null when reloading.
export function queueNewWorld(setup){const st=store(),ls=local();if(!st||!ls)return 'No storage available: the setup cannot be passed to the new page.';
  try{ls.setItem(PENDING_KEY,JSON.stringify(setup));st.removeItem(saveKeyFor(setup.world));st.removeItem(atKey(saveKeyFor(setup.world)));if(setup.world===WORLD_ID)suppress=true}catch(e){return 'Storage refused the setup.'}
  const u=new URL(location.href);if(setup.world==='eldmoor')u.searchParams.delete('world');else u.searchParams.set('world',setup.world);
  afterReset(()=>{if(u.href===location.href)location.reload();else location.href=u.href});return null}
const takePending=()=>{const st=local();if(!st)return null;let raw=null;try{raw=st.getItem(PENDING_KEY);st.removeItem(PENDING_KEY)}catch(e){return null}
  if(!raw)return null;try{const j=JSON.parse(raw);return j&&j.world===WORLD_ID?j:null}catch(e){return null}};
// A save from an earlier map (#979) is never overwritten by the new world's autosave: a copy goes under its own key first (once), and the page says so.
export const EARLIER_KEY=SAVE_KEY+'.earlier-map';
function keepEarlier(snap){try{const st=store();if(st&&!st.getItem(EARLIER_KEY))st.setItem(EARLIER_KEY,JSON.stringify(snap));
    note('This world was saved on an earlier, narrower map and cannot continue. A copy is kept; a new world has started.')}catch(e){}}
const note=m=>{const ss=session();try{if(ss)ss.setItem(RESET_NOTE_KEY,m)}catch(e){}};
export function boot(init){booted=true;let snap=null;const pend=takePending();
  if(pend){try{init({setup:pend});applied=pend;how='setup';lastHour=Math.floor(S.gameMin/60);status('New world · seed '+pend.seed);return false}
    catch(e){console.warn('Eldmoor: the New World setup failed, starting a default world',e)}}
  try{snap=readSave()}catch(e){console.warn('Eldmoor: unreadable save, starting a new world',e)}
  if(snap){try{restore(snap);how='restored';log({t:'The world was restored from a saved chronicle.',c:'dm'});
      lastHour=Math.floor(S.gameMin/60);status('Restored · Day '+dayOf(S.gameMin)+' '+clock(S.gameMin));return true}
    catch(e){console.warn('Eldmoor: could not restore the save, starting a new world',e)
      if(e&&e.code==='stale-map')keepEarlier(snap)}}
  init();lastHour=Math.floor(S.gameMin/60);return false}

// Called every frame: saves once each time the game clock crosses an hour boundary.
export function autoSaveTick(){const h=Math.floor(S.gameMin/60);if(h!==lastHour)writeSave()}

export function exportSave(){const snap=snapshot(),blob=new Blob([JSON.stringify(snap)],{type:'application/json'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='eldmoor-day'+dayOf(snap.gameMin)+'.json';document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);status('Exported '+a.download)}

function reloadWith(json){const st=store();if(!st){status('No storage available');return}
  suppress=true;try{st.removeItem(atKey(SAVE_KEY));if(json==null)st.removeItem(SAVE_KEY);else st.setItem(SAVE_KEY,json)}catch(e){suppress=false;status('Storage refused the save');return}
  if(json!=null)skipNext();afterReset(()=>location.reload())}

// Import a save file into this world's slot and reload into it. say(msg) reports a problem (the World bar's status by default).
export function importFile(file,say=status){if(!file)return;const r=new FileReader();
  r.onload=()=>{let snap=null;try{snap=JSON.parse(String(r.result))}catch(e){}
    if(!isSave(snap)){say('Not an Eldmoor save');return}
    reloadWith(JSON.stringify(snap))};
  r.onerror=()=>say('Could not read the file');r.readAsText(file)}

export function initSaveUI(){
  onSaveFail((e,kept)=>status(kept?'IndexedDB refused the save; kept in localStorage instead, so nothing is lost':'Save failed: the browser refused to store it (storage full?)'));
  const on=(id,f)=>{const el=$(id);if(el)el.onclick=f};
  on('wSave',()=>writeSave());
  on('wLoad',()=>{if(!hasSave()){status('No save yet');return}suppress=true;skipNext();afterReset(()=>location.reload())}); // boot() restores the save; progress since then is dropped
  on('wExport',exportSave);
  on('wImport',()=>{const f=$('wFile');if(f){f.value='';f.click()}});
  const file=$('wFile');if(file)file.onchange=()=>importFile(file.files&&file.files[0]);
  on('wNew',()=>{if(newWorld)return newWorld();if(confirm('Start a new world? The saved one is erased.'))reloadWith(null)});
  window.addEventListener('beforeunload',()=>{if(!suppress)writeSave()});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&!suppress)writeSave()});
  {const ss=session();let note=null;try{note=ss&&ss.getItem(RESET_NOTE_KEY);if(ss)ss.removeItem(RESET_NOTE_KEY)}catch(e){}if(note)status(note)}
  if(!$('wStatus')||!$('wStatus').textContent)status(hasSave()?'Auto-save on':'New world · auto-save on')}
