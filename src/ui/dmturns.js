// DM per-turn cards (issue #181). The sim keeps no per-turn record of the DM agent (S.dmAgent.calls holds the
// last 24 calls with no result text), so the page builds one from the calls it answers: player-bridge.js hands
// every DM tool call and its result to noteDmCall(); calls close together belong to one turn. The records are
// small, capped (TURNS_KEEP) and kept in this browser (localStorage, per world), not in the save. A sim-side
// record (day, cost, what it read) would let the cards survive another browser and carry the cost per turn.
import {S} from '../sim/index.js';

export const TURNS_KEEP=40,GAP_MS=25000; // a quiet gap of 25 real seconds ends a turn
const KEY='eldmoor.dmTurns.';
const READS=new Set(['dm_status','read_timeline','read_chronicle','read_dm_log','fellowship_view','heroes_near','npcs','regions','hooks','levers','notes_read','recall']);
const NOTES=new Set(['notes_write','remember','update_memory','forget','pin']);
let turns=[],loaded=null,lastAt=0,seq=0,ver=0;
const worldKey=()=>KEY+String(S.worldId||'w');
function load(){const k=worldKey();if(loaded===k)return;loaded=k;turns=[];lastAt=0;
  try{const v=JSON.parse(localStorage.getItem(k)||'[]');if(Array.isArray(v))turns=v.slice(0,TURNS_KEEP)}catch(e){}
  seq=turns.reduce((m,t)=>Math.max(m,t.id),0);ver++}
function save(){try{localStorage.setItem(worldKey(),JSON.stringify(turns))}catch(e){}}
const cut=(s,n)=>{s=String(s==null?'':s).replace(/\s+/g,' ').trim();return s.length>n?s.slice(0,n-1)+'…':s};
const clock=()=>{const m=Math.floor(S.gameMin||0)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')};

export function noteDmCall(tool,args,res,now=Date.now()){
  if(!tool||(tool==='table_call'&&res&&res.ok&&!res.call)||(tool==='npc_call'&&res&&res.ok&&!res.call))return; // an idle poll is not a call
  load();args=args&&typeof args==='object'?args:{};res=res&&typeof res==='object'?res:{};
  let t=turns[0];
  const acted=t&&(t.notes.length||t.levers.length||t.staged.length||t.said.length);
  if(!t||now-lastAt>GAP_MS||(tool==='dm_status'&&acted)){t={id:++seq,day:Math.floor((S.gameMin||0)/1440)+1,t:clock(),at:now,calls:0,reads:{},notes:[],levers:[],staged:[],said:[],other:0,errors:0};turns.unshift(t);if(turns.length>TURNS_KEEP)turns.length=TURNS_KEEP}
  lastAt=now;t.calls++;const ok=res.ok!==false;if(!ok)t.errors++;
  if(READS.has(tool))t.reads[tool]=(t.reads[tool]||0)+1;
  else if(NOTES.has(tool)){t.notes.push({ok,title:cut(args.title||args.text||(res.note&&res.note.text)||tool,60),sec:args.section||null,why:ok?null:cut(res.error,100)})}
  else if(tool==='pull_lever')t.levers.push({ok,name:cut(args.name,32),why:cut(ok?(res.effect||args.reason):res.error,120)});
  else if(tool==='stage_scene')t.staged.push({ok,kind:cut(args.kind,16),near:cut(args.near,24),why:ok?null:cut(res.error,120)});
  else if(tool==='narrate'||tool==='npc_say'||tool==='npc_offer'&&args.text)t.said.push({ok,who:tool==='narrate'?'Narrator':cut(res.who||args.npc,24),text:cut(args.text,140),why:ok?null:cut(res.error,100)});
  else if(tool==='table_answer'){t.said.push({ok,who:'Table',text:cut(args.line||args.text||args.complication||'answered a call',100),why:ok?null:cut(res.error,100)})}
  else t.other++;
  ver++;save()}

export const dmTurns=()=>{load();return turns};
export const dmTurnsVer=()=>{load();return ver};
export function clearDmTurns(){load();turns=[];ver++;save()}

// ---- cards ----
const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
const READ_WORD={dm_status:'status',read_timeline:'timeline',read_chronicle:'chronicle',read_dm_log:'DM log',fellowship_view:'Fellowship',heroes_near:'heroes near',npcs:'people',regions:'regions',hooks:'board',levers:'levers',notes_read:'notes',recall:'recall'};
// One card: head (day, time, calls), then a line per kind of act that happened. Plain text, no live data.
export function turnCard(t){const li=el('li','dmcard');li.setAttribute('data-k','t'+t.id);
  const head=el('div','dmch');head.append(el('time',null,'D'+t.day+' '+t.t),el('span','badge b-dm b-dma','TURN'),el('span','dm',t.calls+' call'+(t.calls===1?'':'s')+(t.errors?' · '+t.errors+' refused':'')));li.append(head);
  const line=(label,kids,cls)=>{const r=el('div','dmcl'+(cls?' '+cls:''));r.append(el('span','dmck',label));const v=el('span','dmcv');for(const k of kids){if(typeof k==='string')v.append(k);else v.append(k)}r.append(v);li.append(r)};
  const rd=Object.entries(t.reads).map(([k,n])=>(READ_WORD[k]||k)+(n>1?' ×'+n:''));
  if(rd.length)line('Read',[rd.join(', ')]);
  if(t.notes.length)line('Notes',[t.notes.map(n=>(n.ok?'':'refused: ')+n.title).join('; ')]);
  for(const l of t.levers)line(l.ok?'Lever':'Refused',[l.name+(l.why?' · '+l.why:'')],l.ok?'':'bad');
  for(const s of t.staged)line(s.ok?'Staged':'Refused',[s.kind+(s.near?' near '+s.near:'')+(s.why?' · '+s.why:'')],s.ok?'':'bad');
  for(const s of t.said)line(s.who,[s.ok?'“'+s.text+'”':'refused: '+(s.why||s.text)],s.ok?'':'bad');
  if(!rd.length&&!t.notes.length&&!t.levers.length&&!t.staged.length&&!t.said.length)li.append(el('div','dm',t.other?t.other+' other call'+(t.other===1?'':'s'):'No acts.'));
  return li}
