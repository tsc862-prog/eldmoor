// The watcher's chat filter (issue #127). With a Fellowship the Chat tab and the speech bubbles show
// the Fellowship's conversation only: the party channel, members speaking, the Narrator, and anyone
// speaking where a member can hear. Background heroes' chatter with each other is hidden unless the
// viewer turns "World chatter" on (kept per viewer in localStorage). Pure view logic: the sim only
// tags a line `fh` (heard by, or spoken by, a member) and a bubble the same way. No Fellowship: all shown.
const KEY='eldmoor.worldChatter';
let on=false;try{on=localStorage.getItem(KEY)==='1'}catch(_){}
// The company with the five places (sim/company.js slotted(), #588), read from S so this view module never imports sim.
const slotF=S=>(S.companies||[]).find(C=>C.slots)||null;
const member=(a,F)=>!!(a&&F&&a.company===F.id&&F.ids.includes(a.id));
export const worldChatter=()=>on;
export function setWorldChatter(v){on=!!v;try{localStorage.setItem(KEY,on?'1':'0')}catch(_){}}
// Line `e` (an entry in a chat buffer): shown to the watcher?
export const chatVisible=(e,S)=>{const F=slotF(S);return !F||on||!!(e.party||e.dm||e.fh||member(e.from,F))};
// A bubble over `a` (a.bubble.fh set by the sim); a member's own bubble always shows.
export const bubbleVisible=(a,S)=>{const F=slotF(S);return !F||on||!!(member(a,F)||(a.bubble&&a.bubble.fh)||a.kind==='dm')};
