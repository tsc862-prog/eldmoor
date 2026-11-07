// Where the page keeps its saves (#1013). A campaign holds every map it has left, more than localStorage's 5 MB an origin will take, so the
// save slots live in IndexedDB. The rest of ui/save.js reads and writes as it always did, in one call: openSaves() loads every slot into
// a mirror before the title screen asks about them, saveStore() is then a Storage-shaped object over that mirror, and each write goes
// on to IndexedDB in the background (whenSaved() is the promise a reload waits for).
// A slot found in localStorage moves over on open, unless IndexedDB holds a newer one. With no IndexedDB (a private window, an old
// browser, a Node check), or if it fails to open, the mirror stays off and saveStore() is localStorage, exactly as before.
// Only the save slots move: the New World setup queue and the small per-viewer settings stay in localStorage.
const DB='eldmoor',STORE='saves',OPEN_MS=5000;
export const SLOT_PREFIX='eldmoor.save.v1';
export const isSlot=k=>k===SLOT_PREFIX||k.startsWith(SLOT_PREFIX+'.');
const AT='.at',REPLACED='.replaced';

let db=null,mem=null,pending=Promise.resolve(),failed=null,opening=null;
const local=()=>{try{return window.localStorage||null}catch(e){return null}};
const idb=()=>{try{return window.indexedDB||null}catch(e){return null}};
const whenDone=tx=>new Promise((ok,no)=>{tx.oncomplete=()=>ok();tx.onerror=tx.onabort=()=>no(tx.error||new Error('the save was not written'))});

function open(f){return new Promise((ok,no)=>{const r=f.open(DB,1),t=setTimeout(()=>no(new Error('IndexedDB did not open')),OPEN_MS);
  r.onupgradeneeded=()=>{r.result.createObjectStore(STORE)};
  r.onsuccess=()=>{clearTimeout(t);ok(r.result)};r.onerror=()=>{clearTimeout(t);no(r.error)}})}
function readAll(d){return new Promise((ok,no)=>{const m=new Map(),r=d.transaction(STORE,'readonly').objectStore(STORE).openCursor();
  r.onsuccess=()=>{const c=r.result;if(!c){ok(m);return}m.set(c.key,c.value);c.continue()};r.onerror=()=>no(r.error)})}

// Slots still in localStorage move over: the slot and its write time in one transaction, and only then out of localStorage.
async function moveOver(d,m){const ls=local();if(!ls)return;const keys=[];for(let i=0;i<ls.length;i++){const k=ls.key(i);if(k&&isSlot(k))keys.push(k)}
  const slots=keys.filter(k=>!k.endsWith(AT));if(!keys.length)return;
  const tx=d.transaction(STORE,'readwrite'),st=tx.objectStore(STORE),done=whenDone(tx);done.catch(()=>{}); // awaited below; a put that throws must not leave this one unhandled
  for(const k of slots){const at=ls.getItem(k+AT);if(m.has(k)&&(+at||0)<(+m.get(k+AT)||0))continue; // a tie goes to localStorage: it only holds a copy IndexedDB refused
    const v=ls.getItem(k);if(m.has(k)&&m.get(k)!==v&&!k.endsWith(REPLACED)){st.put(m.get(k),k+REPLACED);m.set(k+REPLACED,m.get(k))} // a build without IndexedDB played on: what it displaces is kept once
    st.put(v,k);m.set(k,v);if(at!=null){st.put(at,k+AT);m.set(k+AT,at)}}
  await done;for(const k of keys)ls.removeItem(k)}

// Call once before anything reads a save. Always resolves; true when IndexedDB holds the saves.
export function openSaves(){if(opening)return opening;
  return opening=(async()=>{const f=idb();if(!f)return false;
    try{const d=await open(f),m=await readAll(d);await moveOver(d,m);db=d;mem=m;return true}
    catch(e){console.warn('Eldmoor: IndexedDB is not available, saves stay in localStorage',e);db=null;mem=null;return false}})()}

function write(run){try{const tx=db.transaction(STORE,'readwrite'),done=whenDone(tx);run(tx.objectStore(STORE));if(tx.commit)try{tx.commit()}catch(e){}return done}catch(e){return Promise.reject(e)}} // a refusal that throws on the spot takes the same road as one that aborts later
// A write IndexedDB refused still has one place to go; the next open moves it over.
// Its write time goes with it, or the next open could take IndexedDB's older copy for the newer one.
function refused(k,v,e){console.warn('Eldmoor: could not save',e);let kept=false;try{const ls=local();if(ls&&v!=null){ls.setItem(k,v);if(!k.endsWith(AT))ls.setItem(k+AT,String(Date.now()));kept=true}}catch(x){}if(failed)failed(e,kept)}
const mirror={
  getItem:k=>mem.has(k)?mem.get(k):null,
  setItem(k,v){v=String(v);mem.set(k,v);pending=Promise.all([pending,write(s=>s.put(v,k)).catch(e=>refused(k,v,e))])},
  removeItem(k){mem.delete(k);pending=Promise.all([pending,write(s=>s.delete(k)).catch(e=>refused(k,null,e))])},
};
export const saveStore=()=>mem?mirror:local();
export const whenSaved=()=>pending;
export const onSaveFail=f=>{failed=f};
