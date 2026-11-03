// Open Table scenes, one per company (#518, epic #402). DOM-free; imports only state.js, so heroes.js, mobs.js,
// pvp.js, chat.js and the agent tools can ask without importing table.js.
// S.table is the primary scene (the followed company's when it has one, else the first opened): the banner, the scene
// map and the older "is a scene open" checks read it. Every other company's open scene sits in S.tables, keyed by
// company id; S.tables is absent while it would be empty, so a one-company world saves and hashes exactly as before.
// Engaged (#518): the members and foes of a scene that runs on the live clock (a company that is not followed) are held
// in place until it resolves: they do not move, fight others or get picked by mobs or duellers. table.js rebuilds the
// set once a step (tableHold); it is plain module state, never saved.
import {S} from './state.js';

export const ENG=new Set();
export const held=e=>ENG.size>0&&!!e&&ENG.has(e);

// Every open scene: the primary first, then the others by company id.
export function allScenes(){const L=S.table?[S.table]:[];const T=S.tables;
  if(T)for(const k of Object.keys(T).sort((x,y)=>x-y))if(T[k]&&T[k]!==S.table)L.push(T[k]);return L}
// The scene a hero sits in, or null.
export function sceneOf(a){if(!a)return null;const T=S.table;if(T&&T.ids&&T.ids.includes(a.id))return T;
  if(S.tables)for(const k in S.tables){const sc=S.tables[k];if(sc&&sc.ids&&sc.ids.includes(a.id))return sc}return null}
// The first open scene that passes a test (a staged scene, the scene of a proposal), or null.
export function findScene(pred){for(const sc of allScenes())if(pred(sc))return sc;return null}
