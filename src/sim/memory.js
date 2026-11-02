// Memory layers for Fellowship members (issue #68). Owned by brain-builder. DOM-free, RNG-free.
//
//   a.memory = {recent:[{t, day, gameMin, k, text}], long:'', stances:{heroId: line}, n, longAt}
//
// remember(a, k, text) appends a 1-2 line memory (k: scene, roll, fight, flee, level, death,
// town, bond, loot, adventure, join, quest, kill). When recent grows past RECENT_MAX the
// oldest COMPRESS entries fold into the long-term summary: a scripted digest at once, and,
// when the relay is up, a model summary (kind 'memory') that replaces the digest if it comes
// back while nothing newer has been folded in. Stances toward companions follow bonds and
// party events (refreshStances). Everything is plain data saved with the hero.
import {S,clockStr} from './state.js';
import {MEMORY_LONG_MAX,cleanText} from '../data/prompts.js';
import {scriptedStance,authoredStance} from './persona.js';
import {speedNow,blocked} from './throttle.js';
import {memoryLine} from './tiers.js'; // landmarks (#153): a companion's death, a joining

export const RECENT_MAX=12,COMPRESS=6;
const day=()=>Math.floor(S.gameMin/1440)+1;
const byId=id=>S.agents.find(x=>x.id==id);
export const memOf=a=>a.memory||(a.memory={recent:[],long:'',stances:{},n:0,longAt:0});
let summarise=null; // (a, items, longBefore) => void; set by fellowship.js to ask the relay
export const setSummariser=f=>{summarise=f};

export function remember(a,k,text){if(!a||!text)return;const M=memOf(a),t=String(text).replace(/\s+/g,' ').trim().slice(0,200);
  const same=M.recent.find(e=>e.text===t&&e.k===k); // an identical line folds into the one already kept, with a count (#117)
  if(same){same.c=(same.c||1)+1;same.gameMin=Math.round(S.gameMin);return}
  M.recent.push({t:'D'+day()+' '+clockStr(),day:day(),gameMin:Math.round(S.gameMin),k,text:t});M.n=(M.n||0)+1;memoryLine(a,k,t);
  if(M.recent.length>RECENT_MAX)compress(a)}

// Scripted digest: count what happened and keep the lines that matter (deaths, levels, scenes won or lost).
const KEEP={death:4,level:3,adventure:3,scene:2,fight:2,flee:2,bond:2,loot:2,kill:3,join:3,quest:1,roll:1,town:0};
export function digest(items){if(!items.length)return '';
  const d0=items[0].day,d1=items[items.length-1].day;
  const best=items.slice().sort((x,y)=>(KEEP[y.k]||1)-(KEEP[x.k]||1)).slice(0,3).filter(e=>(KEEP[e.k]||0)>0);
  const towns=items.filter(e=>e.k==='town').length;
  const keep=items.filter(e=>best.includes(e)).map(e=>e.text.replace(/\.$/,''));
  return (d0===d1?'Day '+d0:'Days '+d0+'-'+d1)+': '+(keep.length?keep.join('; '):'quiet roads')+(towns?'; '+towns+' night'+(towns>1?'s':'')+' in town':'')+'.'}
// Keep the long summary under its cap by dropping the oldest sentences first.
export function capLong(t){t=String(t||'').replace(/\s+/g,' ').trim();while(t.length>MEMORY_LONG_MAX){const i=t.indexOf('. ');if(i<0){t=t.slice(t.length-MEMORY_LONG_MAX);break}t=t.slice(i+2)}return t}

export function compress(a){const M=memOf(a);const items=M.recent.splice(0,COMPRESS);if(!items.length)return;
  const before=M.long||'';M.long=capLong((before?before+' ':'')+digest(items));M.longAt=(M.longAt||0)+1;
  // The model summary is coalesced (#117): folds pile up in M.pend and go out as one request, at most one per
  // member per game day, none at 3x/8x except the fold that opens a new day (the last one of the day before).
  const D=day(),newDay=M.foldDay!=null&&D>M.foldDay;M.foldDay=D;
  if(!M.pend||!M.pend.length){M.pend=[];M.pendBefore=before}
  M.pend=M.pend.concat(items).slice(-30);
  const due=(M.sumAt==null||S.gameMin-M.sumAt>=1440)&&(speedNow()<=1||newDay);
  if(summarise&&due&&!blocked('memory',a)){const p=M.pend,b=M.pendBefore;M.pend=[];M.sumAt=S.gameMin;try{summarise(a,p,b,M.longAt)}catch(e){}}}
// A model summary arrives: use it only if no later fold happened in the meantime.
export function applyLong(a,text,stamp){const M=memOf(a);if(M.longAt!==stamp)return false;const v=cleanText(text,MEMORY_LONG_MAX);if(!v)return false;M.long=v;M.longSrc='model';return true}

// Stances: a line the persona holds itself (model-written, owner-written or the archetype's, #305:
// authoredStance) stands, with a note from the latest shared event; otherwise the scripted reading of
// bond, hamlet and backstory link (it drifts as the bond moves), plus that note.
export function refreshStances(a,ids){const M=memOf(a);
  for(const id in M.stances)if(!ids.some(x=>x==id))delete M.stances[id]; // only current companions
  for(const id of ids){if(id==a.id)continue;const b=byId(id);if(!b||b.state==='dead'){delete M.stances[id];continue}
    const s=authoredStance(a,b)||scriptedStance(a,b),ev=M.events&&M.events[id];
    M.stances[id]=(s+(ev?' '+ev:'')).slice(0,160)}}
// A party event between two members (healed, saved, quarrelled) colours the stance until the next one.
export function stanceEvent(a,b,text){if(!a||!b||a===b)return;const M=memOf(a);(M.events||(M.events={}))[b.id]=String(text).slice(0,80)}

export const memorySnapshot=(a,items,before)=>({name:a.name,voice:a.persona?a.persona.voice:null,long:before||'',items:items.map(e=>e.t+': '+e.text+(e.c>1?' (x'+e.c+')':''))});
