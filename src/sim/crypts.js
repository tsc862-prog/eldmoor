// The spec dungeons of a world (#891): every crypt landmark is a record of CRYPTS (src/world/gen.js) with its own group and
// cooldown; CRYPT is the first. Which dungeon a group, a scene, a hero or a vote belongs to is read here and nowhere else.
// A leaf: world tables and S only, so any sim, render or ui module may import it. No dice.
//
// Nothing here writes a field for the first dungeon that the world did not have before: a scene's ctx, a proposal and a walking
// order name a dungeon only when it is not the first, so a world with one dungeon keeps its seeded hashes.
import {CRYPT,CRYPTS,REGIONS,zoneAt,dist} from '../world/map.js';
import {WORDS} from '../world/words.js';
import {S} from './state.js';

export const CRYPT_LVL=7; // the level a hero needs to be called up for the first dungeon; a landmark's `entry` says otherwise for its own
const CRYPT_NEED=8;       // the abstract roll's bar at that level (dungeon.js)
export const entryOf=D=>D.entry!=null?D.entry:CRYPT_LVL;
export const needOf=D=>CRYPT_NEED+entryOf(D)-CRYPT_LVL; // a dungeon that wants tried blades sets the bar as far up

export const cryptNamed=n=>CRYPTS.find(D=>D.name===n)||null;
export const cryptOfGroup=g=>CRYPTS.find(D=>D.group===g)||CRYPT;
// The dungeon whose group holds this hero, or null. Gathering at the mouth counts.
export function cryptOfHero(a){for(const D of CRYPTS)if(D.group&&D.group.mem.includes(a))return D;return null}
// The group gathering for a faction, in any dungeon (the priest's blessing at the gate).
export function gatheringFor(fac){for(const D of CRYPTS){const g=D.group;if(g&&g.phase==='gather'&&g.fac===fac)return g}return null}

// A map may hold no dungeon at all (#1013): CRYPT is null and CRYPTS empty. The first dungeon is read through these, so nothing
// outside this file dereferences it (npm run rulescheck counts what does).
export const NO_CRYPT='No great dungeon lies on this land. Look to the town board (list_jobs), or go down into a place the world has thrown up (enter_site).';
export const hasCrypt=()=>!!CRYPT;
export const cryptTitle=()=>CRYPT?CRYPT.name:null;          // the first dungeon's name, or null: for lists of what is on this map
export const cryptName=(D=CRYPT)=>D?D.name:WORDS.cryptName; // for a sentence: with no dungeon here, the world's word for the one far off
export const heroCryptName=a=>cryptName(cryptOfHero(a)||CRYPT);
export const cryptIf=test=>CRYPT&&test(CRYPT.name)?CRYPT:null; // the first dungeon, if its name passes
export const cryptZone=()=>CRYPT?zoneAt(CRYPT.x,CRYPT.y):-1;
export const cryptBand=()=>{const R=CRYPT&&REGIONS[cryptZone()];return R?R.band:null};
export const cryptMouth=dy=>CRYPT?{x:CRYPT.x,y:CRYPT.y+dy}:null;
export const nearCrypt=(p,r)=>!!CRYPT&&dist(p,CRYPT)<r;

// A scene, a proposal, a company's standing wait and a walking order all name a dungeon the same way.
export const cryptCtx=D=>D===CRYPT?{}:{dun:D.name};
export const cryptOfCtx=ctx=>(ctx&&ctx.dun&&cryptNamed(ctx.dun))||CRYPT;
export const cryptGroupOf=ctx=>{const D=cryptOfCtx(ctx);return D?D.group:null}; // the group a scene is about; a scene at a site on a map with no dungeon has none

const bare=n=>String(n||'').toLowerCase().replace(/^the\s+/,'').trim();
// A dungeon by the word a hero used: its name with or without "the", or part of it ("cairn").
export function cryptByWord(w){const t=bare(w);if(!t)return null;
  return CRYPTS.find(D=>bare(D.name)===t)||CRYPTS.find(D=>bare(D.name).split(/\s+/).includes(t))||(t==='crypt'?CRYPT:null)}
// A dungeon named in a sentence ("we go down into the Hollow Cairn"), or null.
export function cryptInWords(text){const t=String(text||'').toLowerCase();return CRYPTS.find(D=>t.includes(bare(D.name)))||null}

const nearest=(a,L)=>{let best=null,bd=Infinity;for(const D of L){const d=dist(a,D);if(d<bd){bd=d;best=D}}return best};
export const cryptNearest=(a,L=CRYPTS)=>nearest(a,L.length?L:CRYPTS)||CRYPT;
// The dungeon that fits a hero: the nearest whose entry its level meets, else the nearest. No dice, so a group's choice moves no roll.
export function cryptFor(a){if(CRYPTS.length<2)return CRYPT;const fit=CRYPTS.filter(D=>a.lvl>=entryOf(D));return cryptNearest(a,fit)}

// The record, one row a dungeon (S.dunRec, made at the first run's end): runs and how each ended, and the heroes lost below.
const ROW=()=>({runs:0,clears:0,wipes:0,driven:0,withdrawn:0,lost:0});
export const cryptRow=D=>(S.dunRec&&S.dunRec[D.name])||ROW(); // read only
export function cryptRun(D,end,lost=0){const R=S.dunRec||(S.dunRec={}),r=R[D.name]||(R[D.name]=ROW());r.runs++;r[end]++;r.lost+=lost}
// What a clear paid (#976): plain data for the watcher, written as it is paid, no dice. {at, by, gold (the party's total),
// goods:{name:n}, items:[{name, who}], run}. A row keeps its last clear as r.paid; run is that clear's number in r.runs (the
// clear is counted just after it is paid), so r.paid.run===r.runs says the last run on the record was this clear. An older
// save has no r.paid: the view says "not recorded", never "nothing". A DM-made site keeps the same record as site.paid.
export const paidNew=by=>({at:Math.round(S.gameMin),by:by||null,gold:0,goods:{},items:[]});
export const paidGood=(P,id,n)=>{if(n)P.goods[id]=(P.goods[id]||0)+n};
export function cryptPaid(D,P){const R=S.dunRec||(S.dunRec={}),r=R[D.name]||(R[D.name]=ROW());P.run=r.runs+1;r.paid=P}
