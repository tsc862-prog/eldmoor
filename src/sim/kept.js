// World state that lives in a module instead of on S: a private dice stream, a once-a-second timer. It belongs to the
// world all the same, so save.js writes it (snap.kept) and puts it back, and a reloaded world plays on as it would have.
// A module registers one getter and one setter with keep(); a leaf, so any module can import it, cycles or not.
const KEPT=new Map();
export const keep=(name,get,set)=>{KEPT.set(name,{get,set})};
export const keptState=()=>{const o={};for(const [k,h] of KEPT)o[k]=h.get();return o};
// An older save carries none of it: the module keeps what it has, as before.
export const restoreKept=o=>{if(o)for(const [k,h] of KEPT)if(o[k]!==undefined)h.set(o[k])};

// A module that captured map data at import (a size, a grid, a table built from the towns) registers a rebind here; map.js
// `setWorld` fires it after the live bindings changed (#1013). A single-map world never fires it. Render subscribes too.
const WORLD_HOOKS=[];
export const onWorld=fn=>{WORLD_HOOKS.push(fn)};
export const fireWorld=mapId=>{for(const fn of WORLD_HOOKS)fn(mapId)};
