// Save, load, export and import in the browser. The world auto-saves to localStorage
// (SAVE_KEY) each time the game clock crosses an hour and when the tab is hidden or
// closed; boot() restores that save on page load instead of starting fresh. The World
// buttons in index.html call the rest. Load, Import and New world all go through a page
// reload: the save is put in place (or removed) and the page starts again through boot(),
// so every panel is rebuilt from state by the normal start-up path.
import {S,log,snapshot,restore,isSave,describeSave} from '../sim/index.js';
import {WORLD_ID} from '../world/map.js';

export const saveKeyFor=id=>id==='eldmoor'?'eldmoor.save.v1':'eldmoor.save.v1.'+id;
export const SAVE_KEY=saveKeyFor(WORLD_ID); // one slot per world
export const PENDING_KEY='eldmoor.setup.pending'; // a New World setup waiting for the next boot (ui/setup.js, #133)
const atKey=key=>key+'.at'; // when that slot was last written (Date.now()), for the title screen
export const SKIP_TITLE_KEY='eldmoor.title.skip'; // sessionStorage: a reload we asked for (Load, Import) goes straight into the world
const $=id=>document.getElementById(id);
let lastHour=-1,suppress=false,hold=false,how='fresh',newWorld=null,applied=null,booted=false; // suppress: skip the unload save when we are reloading on purpose

const store=()=>{try{return window.localStorage}catch(e){return null}};
const session=()=>{try{return window.sessionStorage||null}catch(e){return null}};
const skipNext=()=>{const ss=session();try{if(ss)ss.setItem(SKIP_TITLE_KEY,'1')}catch(e){}};
// True once when the page was reloaded on purpose by Load or Import (the flag is consumed).
export function takeSkipTitle(){const ss=session();if(!ss)return false;try{const v=ss.getItem(SKIP_TITLE_KEY);ss.removeItem(SKIP_TITLE_KEY);return v==='1'}catch(e){return false}}
export const hasPending=()=>{try{const j=JSON.parse(store().getItem(PENDING_KEY));return !!(j&&j.world===WORLD_ID)}catch(e){return false}};
const dayOf=min=>Math.floor(min/1440)+1;
const clock=min=>{const m=Math.floor(min)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')};
function status(msg){const el=$('wStatus');if(el)el.textContent=msg}

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
  const at=+st.getItem(atKey(key))||null;return {...describeSave(j),kb:Math.round(raw.length/1024),at}}catch(e){return null}};
// Download a world's stored save as it is (the title screen and the setup page, before any world is loaded).
export function exportStored(id=WORLD_ID){let raw=null;try{raw=store().getItem(saveKeyFor(id))}catch(e){}if(!raw)return false;
  const j=JSON.parse(raw),blob=new Blob([raw],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='eldmoor-'+(id==='eldmoor'?'':id+'-')+'day'+dayOf(j.gameMin)+'.json';document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);return true}
// Queue a New World setup and restart the page into it. The same world's save is erased (the caller has
// already asked); another world's save is left alone. Returns an error string, or null when reloading.
export function queueNewWorld(setup){const st=store();if(!st)return 'No storage available: the setup cannot be passed to the new page.';
  try{st.setItem(PENDING_KEY,JSON.stringify(setup));st.removeItem(saveKeyFor(setup.world));st.removeItem(atKey(saveKeyFor(setup.world)));if(setup.world===WORLD_ID)suppress=true}catch(e){return 'Storage refused the setup.'}
  const u=new URL(location.href);if(setup.world==='eldmoor')u.searchParams.delete('world');else u.searchParams.set('world',setup.world);
  if(u.href===location.href)location.reload();else location.href=u.href;return null}
const takePending=()=>{const st=store();if(!st)return null;let raw=null;try{raw=st.getItem(PENDING_KEY);st.removeItem(PENDING_KEY)}catch(e){return null}
  if(!raw)return null;try{const j=JSON.parse(raw);return j&&j.world===WORLD_ID?j:null}catch(e){return null}};
export function boot(init){booted=true;let snap=null;const pend=takePending();
  if(pend){try{init({setup:pend});applied=pend;how='setup';lastHour=Math.floor(S.gameMin/60);status('New world · seed '+pend.seed);return false}
    catch(e){console.warn('Eldmoor: the New World setup failed, starting a default world',e)}}
  try{snap=readSave()}catch(e){console.warn('Eldmoor: unreadable save, starting a new world',e)}
  if(snap){try{restore(snap);how='restored';log({t:'The world was restored from a saved chronicle.',c:'dm'});
      lastHour=Math.floor(S.gameMin/60);status('Restored · Day '+dayOf(S.gameMin)+' '+clock(S.gameMin));return true}
    catch(e){console.warn('Eldmoor: could not restore the save, starting a new world',e)}}
  init();lastHour=Math.floor(S.gameMin/60);return false}

// Called every frame: saves once each time the game clock crosses an hour boundary.
export function autoSaveTick(){const h=Math.floor(S.gameMin/60);if(h!==lastHour)writeSave()}

export function exportSave(){const snap=snapshot(),blob=new Blob([JSON.stringify(snap)],{type:'application/json'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='eldmoor-day'+dayOf(snap.gameMin)+'.json';document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);status('Exported '+a.download)}

function reloadWith(json){const st=store();if(!st){status('No storage available');return}
  suppress=true;try{st.removeItem(atKey(SAVE_KEY));if(json==null)st.removeItem(SAVE_KEY);else st.setItem(SAVE_KEY,json)}catch(e){suppress=false;status('Storage refused the save');return}
  if(json!=null)skipNext();location.reload()}

// Import a save file into this world's slot and reload into it. say(msg) reports a problem (the World bar's status by default).
export function importFile(file,say=status){if(!file)return;const r=new FileReader();
  r.onload=()=>{let snap=null;try{snap=JSON.parse(String(r.result))}catch(e){}
    if(!isSave(snap)){say('Not an Eldmoor save');return}
    reloadWith(JSON.stringify(snap))};
  r.onerror=()=>say('Could not read the file');r.readAsText(file)}

export function initSaveUI(){
  const on=(id,f)=>{const el=$(id);if(el)el.onclick=f};
  on('wSave',()=>writeSave());
  on('wLoad',()=>{if(!hasSave()){status('No save yet');return}suppress=true;skipNext();location.reload()}); // boot() restores the save; progress since then is dropped
  on('wExport',exportSave);
  on('wImport',()=>{const f=$('wFile');if(f){f.value='';f.click()}});
  const file=$('wFile');if(file)file.onchange=()=>importFile(file.files&&file.files[0]);
  on('wNew',()=>{if(newWorld)return newWorld();if(confirm('Start a new world? The saved one is erased.'))reloadWith(null)});
  window.addEventListener('beforeunload',()=>{if(!suppress)writeSave()});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&!suppress)writeSave()});
  if(!$('wStatus')||!$('wStatus').textContent)status(hasSave()?'Auto-save on':'New world · auto-save on')}
