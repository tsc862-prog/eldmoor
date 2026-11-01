// Save, load, export and import in the browser. The world auto-saves to localStorage
// (SAVE_KEY) each time the game clock crosses an hour and when the tab is hidden or
// closed; boot() restores that save on page load instead of starting fresh. The World
// buttons in index.html call the rest. Load, Import and New world all go through a page
// reload: the save is put in place (or removed) and the page starts again through boot(),
// so every panel is rebuilt from state by the normal start-up path.
import {S,log,snapshot,restore,isSave} from '../sim/index.js';

export const SAVE_KEY='eldmoor.save.v1';
const $=id=>document.getElementById(id);
let lastHour=-1,suppress=false; // suppress: skip the unload save when we are reloading on purpose

const store=()=>{try{return window.localStorage}catch(e){return null}};
const dayOf=min=>Math.floor(min/1440)+1;
const clock=min=>{const m=Math.floor(min)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')};
function status(msg){const el=$('wStatus');if(el)el.textContent=msg}

export function readSave(){const st=store();if(!st)return null;const raw=st.getItem(SAVE_KEY);if(!raw)return null;
  const snap=JSON.parse(raw);return isSave(snap)?snap:null}
export const hasSave=()=>{try{return !!readSave()}catch(e){return false}};

// Write the current world. Returns the serialised save, or null when storage refused it.
export function writeSave(){const st=store();if(!st)return null;
  const json=JSON.stringify(snapshot());
  try{st.setItem(SAVE_KEY,json)}catch(e){console.warn('Eldmoor: could not save',e);status('Save failed: storage full?');return null}
  lastHour=Math.floor(S.gameMin/60);status('Saved · Day '+dayOf(S.gameMin)+' '+clock(S.gameMin)+' · '+(json.length/1024).toFixed(0)+' KB');return json}

// Start the world: from the save when one exists and restores cleanly, else fresh via init().
// Returns true when the world was restored.
export function boot(init){let snap=null;
  try{snap=readSave()}catch(e){console.warn('Eldmoor: unreadable save, starting a new world',e)}
  if(snap){try{restore(snap);log({t:'The world was restored from a saved chronicle.',c:'dm'});
      lastHour=Math.floor(S.gameMin/60);status('Restored · Day '+dayOf(S.gameMin)+' '+clock(S.gameMin));return true}
    catch(e){console.warn('Eldmoor: could not restore the save, starting a new world',e)}}
  init();lastHour=Math.floor(S.gameMin/60);return false}

// Called every frame: saves once each time the game clock crosses an hour boundary.
export function autoSaveTick(){const h=Math.floor(S.gameMin/60);if(h!==lastHour)writeSave()}

function download(){const snap=snapshot(),blob=new Blob([JSON.stringify(snap)],{type:'application/json'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='eldmoor-day'+dayOf(snap.gameMin)+'.json';document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);status('Exported '+a.download)}

function reloadWith(json){const st=store();if(!st){status('No storage available');return}
  suppress=true;try{if(json==null)st.removeItem(SAVE_KEY);else st.setItem(SAVE_KEY,json)}catch(e){suppress=false;status('Storage refused the save');return}
  location.reload()}

function importFile(file){if(!file)return;const r=new FileReader();
  r.onload=()=>{let snap=null;try{snap=JSON.parse(String(r.result))}catch(e){}
    if(!isSave(snap)){status('Not an Eldmoor save');return}
    reloadWith(JSON.stringify(snap))};
  r.onerror=()=>status('Could not read the file');r.readAsText(file)}

export function initSaveUI(){
  const on=(id,f)=>{const el=$(id);if(el)el.onclick=f};
  on('wSave',()=>writeSave());
  on('wLoad',()=>{if(!hasSave()){status('No save yet');return}suppress=true;location.reload()}); // boot() restores the save; progress since then is dropped
  on('wExport',download);
  on('wImport',()=>{const f=$('wFile');if(f){f.value='';f.click()}});
  const file=$('wFile');if(file)file.onchange=()=>importFile(file.files&&file.files[0]);
  on('wNew',()=>{if(confirm('Start a new world? The saved one is erased.'))reloadWith(null)});
  window.addEventListener('beforeunload',()=>{if(!suppress)writeSave()});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&!suppress)writeSave()});
  if(!$('wStatus')||!$('wStatus').textContent)status(hasSave()?'Auto-save on':'New world · auto-save on')}
