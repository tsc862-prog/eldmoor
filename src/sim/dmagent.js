// The DM as an agent (issue #66, part 1): prep and world-shaping between scenes. An AI agent
// (scripts/dm-agent.mjs, through the MCP tools of src/data/dm-tools.js) takes the DM seat, reads
// the world as the DM sees it, keeps campaign notes saved with the world, and pulls the world
// levers of sim/levers.js with by:'dm-agent', so every pull is validated, held to the lever's
// limits and cooldown, and written to the DM log with its reason. DOM-free; both hosts (the
// browser page through src/ui/player-bridge.js, scripts/play-headless.mjs) answer dmAct().
//
// What the DM agent cannot do, by construction: control a hero (no hero tools here), touch a
// hero's HP, level or life (no lever can), or pile danger onto a badly hurt Fellowship member
// out in the field (pileOn below refuses it). The scripted DM keeps running exactly as before:
// an agent's pulls replace nothing, they just leave the scripted DM fewer empty slots (a job the
// agent posts counts toward the board's three). No seat, no runner, or a silent runner: nothing
// changes, nothing waits. Reads roll no dice and write nothing but the seat's own bookkeeping.
// In-game only (issue #123): the DM speaks to the heroes through narrate and npc_say, heard by the
// heroes in range like any line said in the world. Its notes, log_intent lines and lever reasons
// are for the DM and the watcher; no hero tool, prompt or snapshot ever carries them.
//
// ---- state (plain JSON, saved with the world; created on first use only) ----
//   S.dmAgent {world (a tag the runner keys its session by), seat, notes:{threads,characters,plans,secrets:[note]}, seq, arch:[note], mv,
//              (note: sim/notebook.js {id,title,text,tags,about,rk,day,t,gm,up,pin?,sec}; older saves' notes lack title and tags)
//              day:{d, pulls, notes, intents, narr, npc}, calls:[{t,tool,args,ok}] newest first,
//              seen:{tl, chron, log} (what dm_status last showed), stats:{calls, pulls, refused},
//              turns:[turn] newest first (issue #181, DMA.TURNS_KEEP), tseq, tv (created on the first call; older saves lack them)
//              turn: {id, day, t (clock), gm0, gm1 (game minutes), open, calls, errors, reads:{tool:n}, tools:{tool:{ok,bad}}, notes, levers, staged, said, other,
//                     and once the runner reported: turn (its number), model, provider, cost, seconds, tokensIn, tokensOut}
//   The turn record is the DM's own data for the watcher's DM tab: no hero tool, prompt or snapshot reads it (issue #123).
import {S,clockStr,dayNo} from './state.js';
import {ZONES,REGIONS,CITY,ZPTS,zoneAt,dist} from '../world/map.js';
import {FAC} from '../data/factions.js';
import {MOBS} from '../data/mobs.js';
import {DM_TOOLS,NOTE_SECTIONS} from '../data/dm-tools.js';
import {parseCampaign,campaignText} from './campaign.js'; // the campaign seed (owner request)
import {dmlog} from './dmlog.js';
import {pull,leverMenu,LEVERS} from './levers.js';
import {maxHp} from './heroes.js';
import {fellowshipMembers,fellows,openThreads,mindsOf} from './fellowship.js';
import {openProps} from './council.js';
import {HEAR,CAP as CHAT_CAP,BUBBLE} from './chat.js';
import {ensureNpcs} from './npcs.js';
import {stageScene,tableCall,tableAnswer,stagedView} from './staged.js';
import {npcCall,dmAnswer,offer as npcOfferApply,convWith,convById,convSummary,recordView,dmHeard,warm,legalOffers,CONV} from './talk.js'; // NPC conversations (#170)
import {focus,focusStats} from './dmfocus.js'; // the Fellowship first (issue #165)
import {dmBook,addNote,updateNote,forgetNote,pinNote,recallNotes,relevant,dmContext,DM_NB} from './notebook.js'; // searchable notes (issue #155) // staged scenes and the at-the-table calls (issue #132)

// ---- knobs ----
export const DMA={
  PULLS_PER_DAY:8,     // lever pulls the agent may make per game day (each lever has its own limits on top)
  NOTES_PER_DAY:60,    // note writes per game day (notes_write, remember, update_memory, forget, pin)
  INTENTS_PER_DAY:8,   // log_intent lines per game day
  NOTE_MAX:600, NOTES_CAP:DM_NB.PER_SEC, INTENT_MAX:200, REASON_MAX:160, // a full section archives its oldest unpinned note (#155)
  TURNS_KEEP:40,       // DM turns kept in the per-turn record (issue #181)
  TURN_STALE:240,      // an open turn with no call for this many game minutes is closed by the next call
  CALLS_KEEP:24,       // recent calls kept for the panels
  NEAR_R:12,           // default radius of heroes_near
  PILE_HP:.35,         // a Fellowship member below this share of HP out in the field is not piled on
  PILE_R:14,           // ... within this many tiles of the pull (or in its region)
  NARRATE_PER_DAY:12,  // narrate lines per game day (issue #123: the DM's voice in the game)
  NPC_SAY_PER_DAY:16,  // npc_say lines per game day
  NARRATE_MAX:2000, NPC_SAY_MAX:2000, // a technical ceiling for the UI and the logs only: the DM writes as much as the moment needs (owner, #170)
  NARRATE_R:10,        // default radius of a narrate line around its place
};
const DAY=1440;
const PILING=['mark_dangerous','custom_foe','named_foe','set_condition'];

// ---- the seat ----
// The campaign seed: once per world, the notes start from docs/campaigns/<world>.md (notes marked from:'campaign', the premise pinned in plans).
// A new world seeds when its DM state is created; an older save only when its notes are empty. No RNG; the caps of the books apply.
export function seedCampaign(D){
  if(D.campaign)return D.campaign;const text=campaignText();if(!text)return null;
  const empty=NOTE_SECTIONS.every(k=>!D.notes[k].length)&&!(D.arch&&D.arch.length);
  if(!empty)return D.campaign={loaded:false,sections:{}};
  const c=parseCampaign(text),b=dmBook(D),got={};
  for(const k of NOTE_SECTIONS){got[k]=0;for(const it of c[k]){if(D.notes[k].length>=DMA.NOTES_CAP)break;
    const r=addNote(b,{title:it.title,text:it.text,tags:it.tags,sec:k,pin:it.pin},DMA.NOTE_MAX);if(r.ok){r.note.from='campaign';got[k]++}}}
  return D.campaign={loaded:true,sections:got}}
// Called by init() and restore(): a world with a campaign file gets its DM notes now, so the watcher and the mirror see them.
export function ensureCampaign(){if(!campaignText())return;const D=dmState();if(!D.campaign)seedCampaign(D)}
export function dmState(){if(S.dmAgent)return S.dmAgent;const D=newDm();S.dmAgent=D;seedCampaign(D);return D}
function newDm(){return {world:'w'+Math.round(S.gameMin)+'-'+(S.uid||0),seat:false,notes:Object.fromEntries(NOTE_SECTIONS.map(k=>[k,[]])),seq:0,
  day:{d:-1,pulls:0,notes:0,intents:0},calls:[],seen:{tl:0,chron:'',log:0},stats:{calls:0,pulls:0,refused:0}}}
export const dmSeatOn=()=>!!(S.dmAgent&&S.dmAgent.seat);
// Open or close the DM seat (the DM panel's "DM agent" button, play-headless --dm). Notes stay either way.
export function setDmSeat(on){const D=dmState();on=!!on;if(D.seat===on)return on;D.seat=on;
  dmlog('agent',null,[on?'The DM seat is open: an agent DM may sit in (npm run dm).':'The DM seat is closed: the scripted DM runs alone.'],{by:'dm-agent',seat:on});return on}
// For the panels: the seat's recent calls and today's counts.
export const dmAgentView=()=>S.dmAgent?{seat:S.dmAgent.seat,calls:S.dmAgent.calls.slice(0,8),day:{...S.dmAgent.day},stats:{...S.dmAgent.stats}}:null;

// ---- helpers ----
const gameDay=()=>Math.floor(S.gameMin/DAY);
function today(){const D=dmState();if(D.day.d!==gameDay())D.day={d:gameDay(),pulls:0,notes:0,intents:0,narr:0,npc:0};return D.day}
const txt=ps=>(ps||[]).map(p=>typeof p==='string'?p:p&&(p.kind==='hero'||p.ref==='hero')?p.name||'?':p&&p.t!=null?p.t:'').join('');
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const nOf=(v,d,lo,hi)=>{const n=Math.round(Number(v));return Number.isFinite(n)?Math.max(lo,Math.min(hi,n)):d};
const alive=a=>a&&a.state!=='dead';
const pct=a=>Math.round(100*a.hp/Math.max(1,maxHp(a)));
const facName=f=>f===0||f===1?FAC[f].name:'neutral';
const band=z=>{const b=REGIONS[z]&&REGIONS[z].band?REGIONS[z].band:[1,99];return b[0]+'-'+(b[1]===Infinity?'+':b[1])};
const regionIdx=v=>{if(Number.isInteger(v)&&v>=0&&v<ZONES.length)return v;if(typeof v==='string'){const s=v.trim().toLowerCase();if(/^\d+$/.test(s))return regionIdx(Number(s));
  const i=ZONES.findIndex(n=>n.toLowerCase()===s);return i>=0?i:null}return null};
const townOf=v=>typeof v==='string'?CITY.find(c=>c.name.toLowerCase()===v.trim().toLowerCase())||null:null;
const where=a=>a.state==='town'?'in '+(a.town||'town'):a.state==='dead'?'dead':'in '+(ZONES[zoneAt(a.x,a.y)]||'the wilds')+' at '+Math.round(a.x)+','+Math.round(a.y);
const heroLine=a=>({id:a.id,name:a.name,lvl:a.lvl,cls:a.cls,faction:facName(a.fac),hp:pct(a)+'%',doing:a.state,where:where(a),party:a.party?a.party.id:null,
  ...(a.fellow?{fellowship:a.fellowRole||true}:{}),...(a.adv?{adventure:a.adv}:{})});
// The centre of a region (the mean of its spawn points), for heroes_near.
const centreOf=z=>{const P=ZPTS[z]||[];if(!P.length)return null;let x=0,y=0;for(const p of P){x+=p.x;y+=p.y}return {x:x/P.length,y:y/P.length}};
function placeOf(near){const s=String(near||'').trim();if(!s)return null;
  const m=/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(s);if(m)return {x:Number(m[1]),y:Number(m[2]),label:'around '+m[1]+','+m[2]};
  const lo=s.toLowerCase(),h=S.agents.find(a=>alive(a)&&!a.hidden&&(String(a.id)===s||a.name.toLowerCase()===lo));if(h)return {x:h.x,y:h.y,label:'around '+h.name};
  const c=townOf(s);if(c)return {x:c.gate.x,y:c.gate.y,label:'around '+c.name+'’s gate',town:c.name};
  const z=regionIdx(s);if(z!=null){const p=centreOf(z);return p?{...p,label:'in '+ZONES[z],z}:null}
  return null}
function remember(tool,args,ok){const D=dmState();D.stats.calls++;
  D.calls.unshift({t:clockStr(),tool,args:args&&Object.keys(args).length?JSON.stringify(args).slice(0,140):'',ok:!!ok});if(D.calls.length>DMA.CALLS_KEEP)D.calls.pop()}

// ---- the per-turn record (issue #181) ----
// Each call lands in the open turn (opened by the first call after the last turn closed); the runner closes it with
// turn_end {turn, model, provider, cost, seconds, tokensIn, tokensOut}, sent by the relay when the seat's runner reports the turn
// (never a DM tool: the agent cannot write it). Game time only, no dice; a silent seat records nothing.
const READS=new Set(['dm_status','read_timeline','read_chronicle','read_dm_log','fellowship_view','heroes_near','npcs','regions','hooks','levers','notes_read','recall']);
const NOTEW=new Set(['notes_write','remember','update_memory','forget','pin']);
const cutT=(s,n)=>{s=clean(s,400);return s.length>n?s.slice(0,n-1)+'…':s};
function openTurn(D){if(!Array.isArray(D.turns)){D.turns=[];D.tseq=0;D.tv=0}
  let t=D.turns[0];if(t&&t.open&&S.gameMin-t.gm1>DMA.TURN_STALE){t.open=false}
  if(!t||!t.open){t={id:++D.tseq,day:dayNo(),t:clockStr(),gm0:Math.round(S.gameMin),gm1:Math.round(S.gameMin),open:true,calls:0,errors:0,reads:{},tools:{},notes:[],levers:[],staged:[],said:[],other:0};
    D.turns.unshift(t);if(D.turns.length>DMA.TURNS_KEEP)D.turns.length=DMA.TURNS_KEEP}
  return t}
function recordTurn(tool,args,res){const D=dmState(),t=openTurn(D);
  res=res&&typeof res==='object'?res:{};const ok=res.ok!==false;t.calls++;t.gm1=Math.round(S.gameMin);if(!ok)t.errors++;
  const c=t.tools[tool]||(t.tools[tool]={ok:0,bad:0});c[ok?'ok':'bad']++;
  if(READS.has(tool)&&!NOTEW.has(tool))t.reads[tool]=(t.reads[tool]||0)+1;
  else if(NOTEW.has(tool))t.notes.push({ok,title:cutT(args.title||args.text||(res.note&&res.note.text)||tool,60),sec:args.section||null,why:ok?null:cutT(res.error,100)});
  else if(tool==='pull_lever')t.levers.push({ok,name:cutT(args.name,32),why:cutT(ok?(res.effect||args.reason):res.error,120)});
  else if(tool==='stage_scene')t.staged.push({ok,kind:cutT(args.kind,16),near:cutT(args.near,24),why:ok?null:cutT(res.error,120)});
  else if(tool==='narrate'||tool==='npc_say'||tool==='npc_offer'&&args.text)t.said.push({ok,who:tool==='narrate'?'Narrator':cutT(res.who||args.npc,24),text:cutT(args.text,140),why:ok?null:cutT(res.error,100)});
  else if(tool==='table_answer')t.said.push({ok,who:'Table',text:cutT(args.line||args.text||args.complication||'answered a call',100),why:ok?null:cutT(res.error,100)});
  else t.other++;
  D.tv++}
// The runner's report closes the open turn and carries what only it knows. A turn with no calls still gets its entry.
function turnEnd(a){const D=dmState(),t=openTurn(D);a=a&&typeof a==='object'?a:{};
  const num=(v,hi)=>{v=Number(v);return Number.isFinite(v)&&v>=0?Math.min(hi,v):null};
  t.open=false;t.gm1=Math.round(S.gameMin);
  const n=num(a.turn,1e6);if(n!=null)t.turn=Math.round(n);
  if(a.model)t.model=clean(a.model,60);if(a.provider)t.provider=clean(a.provider,20);
  const cost=num(a.cost,1000),sec=num(a.seconds,36000),ti=num(a.tokensIn,1e9),to=num(a.tokensOut,1e9);
  if(cost!=null)t.cost=Math.round(cost*1e6)/1e6;if(sec!=null)t.seconds=Math.round(sec*10)/10;if(ti!=null)t.tokensIn=Math.round(ti);if(to!=null)t.tokensOut=Math.round(to);
  D.tv++;return {ok:true,turn:t.id}}
// For the DM tab (src/ui/dmturns.js): the record newest first, and a counter that changes whenever it does.
export const dmTurnLog=()=>S.dmAgent&&Array.isArray(S.dmAgent.turns)?S.dmAgent.turns:[];
export const dmTurnVer=()=>S.dmAgent&&S.dmAgent.tv||0;

// A Fellowship member badly hurt out in the field near the pull: the DM does not pile on.
export function pileOn(name,p){if(!PILING.includes(name)||!p||typeof p!=='object')return null;
  if(name==='set_condition'&&!['bandits','migration'].includes(p.kind))return null;
  const at=p.at&&typeof p.at==='object'&&Number.isFinite(Number(p.at.x))?{x:Number(p.at.x),y:Number(p.at.y)}:null,z=p.region!=null?regionIdx(p.region):at?zoneAt(at.x,at.y):null;
  for(const a of fellows()){if(a.state==='town'||a.hp>=maxHp(a)*DMA.PILE_HP)continue;
    if(at&&dist(a,at)<=DMA.PILE_R||z!=null&&zoneAt(a.x,a.y)===z)return a.name+' of the Fellowship is badly hurt ('+pct(a)+'% HP) out in '+(ZONES[zoneAt(a.x,a.y)]||'the wilds')+': the DM does not pile on. Try again when they have recovered or reached a town.'}
  return null}

// ---- the Fellowship first (issue #165) ----
// A short account of what the Fellowship needs from the DM right now, and a change signature the runner watches: when it
// differs from the one of the last turn (they arrived somewhere or set out, a scene ended, a member fell, an oath or a
// job finished or began) a bounded extra turn is due (scripts/dm-agent.mjs eventDue). Reads only; hero notes are never read.
function fellowshipNeeds(){const F=S.fellowship,fo=focus();if(!F||!fo)return null;
  const th=openThreads(),props=openProps(),items=[],hurt=fo.members.filter(a=>a.state!=='town'&&!a.hidden&&a.hp<maxHp(a)*DMA.PILE_HP);
  const field=fo.members.filter(a=>a.state!=='town'&&!a.hidden),inTown=fo.members.length-field.length;
  const sv=stagedView(),at=field.length?(ZONES[zoneAt(fo.x,fo.y)]||'the wilds'):(fo.town?fo.town.name:'town');
  if(S.table)items.push('A Table scene is open: let it play; answer only calls of a scene you staged.');
  if(props.length)items.push('A vote is open ('+props.map(P=>P.kind).join(', ')+'): leave it to them.');
  for(const a of hurt)items.push(a.name+' is badly hurt ('+pct(a)+'% HP) out in '+(ZONES[zoneAt(a.x,a.y)]||'the wilds')+': no danger near them; a road home, a camp, a friendly face.');
  const open=th.slice(0,4).map(t=>txt(t.parts));
  for(const t of open)items.push('Open thread: '+t);
  const adv=(S.adventures||[]).filter(v=>v.phase==='active'&&v.mem&&v.mem.some(id=>fo.ids.has(id)));
  for(const v of adv.slice(0,2))items.push('Under way: '+(v.title||v.tpl)+' (scene '+((v.idx||0)+1)+' of '+((v.scenes||[]).length||'?')+').');
  if(!adv.length&&!sv.cur&&!S.table&&!props.length&&!hurt.length)items.push('Nothing is under way for them: a hook near '+at+', a rumour of a named foe on their road, or a staged scene (stage_scene near "fellowship") would give their next game hours something.');
  const quiet=!S.table&&!props.length&&!hurt.length&&!adv.length&&!sv.cur;
  return {summary:(field.length?field.length+' riding in '+at:'all '+fo.members.length+' in '+at)+(inTown&&field.length?', '+inTown+' in town':'')+'; '+(th.length?th.length+' open thread'+(th.length===1?'':'s'):'no open threads')+(adv.length?'; a job is under way':'; no job under way')+(hurt.length?'; '+hurt.length+' badly hurt':'')+(S.table?'; a Table scene is open':'')+'.',
    where:at,riding:field.length,in_town:inTown,items,quiet,share_of_dm_actions:focusStats()}}
// What changed for them since the last look: place, falls, scenes, finished jobs and oaths. A string; equal means nothing new.
function fellowshipSig(){const F=S.fellowship,fo=focus();if(!F||!fo)return '';
  const field=fo.members.filter(a=>a.state!=='town'&&!a.hidden),z=field.length?zoneAt(fo.x,fo.y):-1,t=F.tableStats||{};
  const done=(S.adventures||[]).filter(v=>v.phase==='done'&&v.mem&&v.mem.some(id=>fo.ids.has(id))).length,oaths=fo.members.filter(a=>a.goal&&a.goal.done).length;
  return [z,field.length?1:0,(F.past||[]).length,t.scenes||0,done,oaths,openThreads().length,!!S.table].join('|')}

// ---- the tools ----
function status(){const D=dmState(),day=today(),tl=S.timeline||[],ch=S.chronicle||[],L=S.dmLog||[],F=S.fellowship;
  const sinceTl=tl.filter(e=>e.gameMin>D.seen.tl).length,i=ch.findIndex(e=>(e.t+txt(e.parts))===D.seen.chron),sinceCh=i<0?Math.min(ch.length,30):i,sinceLog=L.filter(e=>e.id>D.seen.log).length;
  D.seen.tl=tl[0]?tl[0].gameMin:D.seen.tl;D.seen.chron=ch[0]?ch[0].t+txt(ch[0].parts):D.seen.chron;D.seen.log=L[0]?L[0].id:D.seen.log;
  const sc=S.table||null,props=F?openProps():[];
  const h=Math.floor((S.gameMin%DAY)/60);
  return {ok:true,world:D.world,day:gameDay()+1,time:clockStr(),gameMin:Math.round(S.gameMin),part:h<6?'night':h<12?'morning':h<18?'afternoon':'evening',
    fellowship_first:F?'The Fellowship comes first: read fellowship_needs, act for them, and only then shape the wider world (and only when nothing is pending for them).':null,
    fellowship_needs:fellowshipNeeds(),fellowship_change:F?fellowshipSig():null,
    table:sc?(sc.ctx&&sc.ctx.staged!=null?{open:true,kind:sc.kind||null,staged:true,call:!!(sc.calls&&sc.calls.some(c=>!c.done)),note:'The scene you staged is at the table: answer its calls with table_call and table_answer (a few seconds each; silence is filled by the scripted DM).'}
      :{open:true,kind:sc.kind||null,note:'A Table scene is running: let it play out; its calls are not yours (only scenes you staged are).'}):{open:false},
    staged:stagedView(),
    proposals:props.map(P=>({id:P.id,kind:P.kind,details:P.details||null})),pending:!!sc||props.length>0,
    fellowship:F?{name:F.name,minds:mindsOf(F),members:fellowshipMembers().map(m=>m.hero?{id:m.hero.id,name:m.hero.name,role:m.label,lvl:m.hero.lvl,hp:pct(m.hero)+'%',doing:m.hero.state,where:where(m.hero)}:{role:m.label,empty:true})}:null,
    since_last_look:{timeline:sinceTl,chronicle:sinceCh,dm_log:sinceLog},
    adventures:(S.adventures||[]).filter(v=>v.phase==='active').length,open_jobs:(S.adventures||[]).filter(v=>v.phase==='open').length,
    levers_active:(S.levers&&S.levers.active||[]).length,your_pulls_today:day.pulls+'/'+DMA.PULLS_PER_DAY,
    your_lines_today:{narrate:(day.narr||0)+'/'+DMA.NARRATE_PER_DAY,npc_say:(day.npc||0)+'/'+DMA.NPC_SAY_PER_DAY},
    conversations:convSummary(), // NPC conversations (#170): waiting ones first; answer them with npc_call / npc_say {conv} / npc_offer
    campaign:D.campaign?{loaded:!!D.campaign.loaded,sections:{...D.campaign.sections}}:{loaded:false,sections:{}},
    notes:Object.fromEntries(NOTE_SECTIONS.map(k=>[k,D.notes[k].length])),relevant_notes:relevant(dmBook(D),dmContext())}} // relevant_notes: your notes that bear on the moment, {id,title} (#155)

function timelineRead(n){return {ok:true,timeline:(S.timeline||[]).slice(0,nOf(n,12,1,30)).map(e=>({day:Math.floor((e.gameMin||0)/DAY)+1,t:e.t,kind:e.kind,text:txt(e.parts)}))}}
function chronicleRead(n){return {ok:true,news:(S.chronicle||[]).slice(0,nOf(n,12,1,30)).map(e=>e.t+' '+txt(e.parts))}}
const LOG_KINDS={talk:['talk'],hooks:['hooks','pick'],scenes:['frame','branch','camp'],rolls:['roll','complication'],outcomes:['payoff','fail','abandon','fallback'],levers:['lever'],agent:['agent']};
function dmLogRead(n,kind){const k=LOG_KINDS[kind]||null,out=[];
  for(const e of S.dmLog||[]){if(k&&!(k.includes(e.kind)||kind==='agent'&&e.detail&&e.detail.by==='dm-agent'))continue;
    out.push({id:e.id,day:Math.floor((e.gameMin||0)/DAY)+1,t:e.t,kind:e.kind,town:e.town||null,adventure:e.advId,text:txt(e.summary),...(e.detail&&e.detail.by?{by:e.detail.by}:{})});
    if(out.length>=nOf(n,12,1,30))break}
  return {ok:true,log:out}}

function fellowshipView(){const F=S.fellowship;if(!F)return {ok:true,fellowship:null,note:'No Fellowship rides in this world yet.'};
  const members=fellowshipMembers().map(m=>{const a=m.hero;if(!a)return {role:m.label,empty:true};
    const P=a.persona||{},M=a.memory||{};
    return {...heroLine(a),role:m.label,persona:a.persona?{voice:P.voice,wants:P.wants,fears:P.fears,quirk:P.quirk}:null,backstory:a.backstory?a.backstory.summary||null:null,
      oath:a.goal&&!a.goal.done?a.goal.text:null,memory_long:M.long?String(M.long).slice(0,500):null,memory_recent:(M.recent||[]).slice(-5).map(e=>e.text),
      stances:Object.fromEntries(Object.entries(M.stances||{}).slice(0,6).map(([id,s])=>{const b=S.agents.find(x=>String(x.id)===String(id));return [b?b.name:'#'+id,String(s).slice(0,120)]}))}});
  return {ok:true,fellowship:{name:F.name,faction:facName(F.fac),hall:F.hall||null,founded_day:F.day||null,minds:mindsOf(F),members,
    open_threads:openThreads().map(t=>({kind:t.kind,text:txt(t.parts)})),proposals:openProps().map(P=>({id:P.id,kind:P.kind,details:P.details||null,by:P.by||null})),
    campaign_log:(F.log||[]).slice(0,10).map(e=>'D'+e.day+' '+e.t+' '+txt(e.parts)),fallen:(F.past||[]).slice(-5).map(p=>p.name||('#'+p.id))}}}

function heroesNear(near,radius){const p=placeOf(near);if(!p)return {ok:false,error:'Unknown place "'+clean(near,40)+'". Use a hero name or id, a town, a region name, or "x,y".'};
  const r=nOf(radius,DMA.NEAR_R,4,30),hs=[];
  for(const a of S.agents){if(!alive(a)||a.hidden)continue;if(p.town?!(a.state==='town'&&a.town===p.town)&&dist(a,p)>r:dist(a,p)>r)continue;hs.push(a)}
  hs.sort((x,y)=>dist(x,p)-dist(y,p));const parties=new Map();for(const a of hs)if(a.party&&!parties.has(a.party.id))parties.set(a.party.id,a.party);
  return {ok:true,place:p.label,radius:r,heroes:hs.slice(0,24).map(heroLine),more:Math.max(0,hs.length-24),
    parties:[...parties.values()].map(P=>({id:P.id,leader:P.leader?P.leader.name:null,members:(P.members||[]).filter(alive).map(b=>b.name),fellowship:!!P.fellow}))}}

const attOf=n=>(n.att||[]).filter(x=>x.until==null||x.until>S.gameMin).map(x=>({toward:x.to+' '+x.id,attitude:x.a}));
function npcsRead(town){const c=town?townOf(town):null;if(town&&!c)return {ok:false,error:'No town called '+clean(town,40)+'. Towns: '+CITY.map(t=>t.name).join(', ')};
  const folk=(S.npcs||[]).filter(n=>!c||n.town===c.name).map(n=>({id:n.id,name:n.title+' '+n.name,role:n.role,town:n.town,...(attOf(n).length?{attitudes:attOf(n)}:{}),...(recordView(n)?{fellowship:recordView(n)}:{})}));
  const wand=(S.wanderers||[]).filter(w=>!c||w.town===c.name||dist(w,c.gate)<=20).map(w=>({id:w.id,name:w.title+' '+w.name,role:w.role,where:w.town||ZONES[zoneAt(w.x,w.y)],home:w.homeKind,attitude:w.attitude||'neutral',
    ...(attOf(w).length?{attitudes:attOf(w)}:{}),...(recordView(w)?{fellowship:recordView(w)}:{}),placed_by_lever:w.lever||null}));
  return {ok:true,townsfolk:folk.slice(0,60),wanderers:wand}}

function regionsRead(){const mobs=new Array(ZONES.length).fill(0),heroes=new Array(ZONES.length).fill(0);
  for(const m of S.mobs)if(m.alive&&!m.gone){const z=zoneAt(m.x,m.y);if(z>=0)mobs[z]++}
  for(const a of S.agents)if(alive(a)&&a.state!=='town'&&!a.hidden){const z=zoneAt(a.x,a.y);if(z>=0)heroes[z]++}
  return {ok:true,regions:ZONES.map((name,z)=>{const cond=(S.conditions||[]).filter(c=>c.z===z),marks=(S.marks||[]).filter(m=>m.z===z),pl=(S.places||[]).filter(p=>p.z===z);
    return {index:z,name,levels:band(z),monsters:mobs[z],heroes_out:heroes[z],creatures:Object.keys(MOBS).filter(k=>MOBS[k].z===z).slice(0,8),
      ...(cond.length?{condition:cond.map(c=>c.kind+' '+c.str+' ('+Math.max(0,Math.round((c.until-S.gameMin)/60))+'h left)')}:{}),
      ...(marks.length?{areas:marks.map(m=>m.kind+' at '+Math.round(m.x)+','+Math.round(m.y)+' r'+m.r)}:{}),
      ...(pl.length?{places:pl.map(p=>({id:p.id,kind:p.kind,name:p.name,at:Math.round(p.x)+','+Math.round(p.y)}))}:{})}}),
    towns:CITY.map(c=>({name:c.name,faction:facName(c.fac),gate:Math.round(c.gate.x)+','+Math.round(c.gate.y),region:ZONES[zoneAt(c.gate.x,c.gate.y)]}))}}

function hooksRead(town){const c=town?townOf(town):null;if(town&&!c)return {ok:false,error:'No town called '+clean(town,40)};
  const A=(S.adventures||[]).filter(v=>!c||v.town===c.name),hn=id=>{const b=S.agents.find(x=>x.id===id);return b?b.name:'#'+id};
  return {ok:true,open_jobs:A.filter(v=>v.phase==='open').map(h=>({id:h.id,town:h.town,tpl:h.tpl,src:h.src,giver:h.giver?h.giver.name:null,region:h.zone==null?'any':ZONES[h.zone],
      ...(h.for!=null?{for:hn(h.for)}:{}),hours_left:Math.max(0,Math.round((h.until-S.gameMin)/60))})),
    under_way:A.filter(v=>v.phase==='active').map(v=>({id:v.id,title:v.title,tpl:v.tpl,town:v.town,leader:hn(v.lead),members:v.mem.map(hn),scene:(v.idx||0)+1,of:(v.scenes||[]).length,away:!!v.away})),
    recently_done:A.filter(v=>v.phase==='done').slice(-5).map(v=>({id:v.id,title:v.title,outcome:v.outcome||null}))}}

function leversRead(){const L=S.levers,d=today(),hrs=m=>Math.max(0,Math.round(m/60));
  return {ok:true,levers:leverMenu().filter(l=>l.available&&l.name!=='named_foe').map(l=>({name:l.name,about:l.about,params:l.params,limits:l.limits,cooldown_min:l.cooldown})),
    note:'named_foe belongs to the scripted DM inside a running scene. post_hook may not use tpl "fallen" or spec.',
    active:(L&&L.active||[]).map(x=>({id:x.id,lever:x.name,by:x.by,region:x.region!=null?ZONES[x.region]:null,hours_left:hrs(x.until-S.gameMin),reason:x.reason})),
    pulled_today:L&&L.day&&L.day.d===gameDay()?{...L.day.n}:{},cooldowns:Object.fromEntries(Object.entries(L&&L.cd||{}).filter(([,t])=>t>S.gameMin).map(([k,t])=>[k,hrs(t-S.gameMin)+'h'])),
    your_pulls_today:d.pulls+'/'+DMA.PULLS_PER_DAY}}

function notesRead(section){const D=dmState(),ks=section&&section!=='all'?[section]:NOTE_SECTIONS;
  if(!ks.every(k=>NOTE_SECTIONS.includes(k)))return {ok:false,error:'section must be one of all, '+NOTE_SECTIONS.join(', ')};
  return {ok:true,notes:Object.fromEntries(ks.map(k=>[k,D.notes[k].map(n=>({id:n.id,...(n.title?{title:n.title}:{}),text:n.text,...(n.tags&&n.tags.length?{tags:n.tags}:{}),...(n.about?{about:n.about}:{}),day:n.day,...(n.pin?{pinned:true}:{})}))]))}}
function noteLog(op,k,n){const D=dmState();
  dmlog('agent',null,['DM agent ',op==='add'?'noted':op==='edit'?'revised':op==='pin'?'pinned':op==='unpin'?'unpinned':'struck',' ('+k+')',k==='secrets'?': a secret.':': '+(n.title&&n.title!==n.text.slice(0,n.title.length)?n.title+' - ':'')+n.text.slice(0,90)+(n.text.length>90?'…':'')],
    {by:'dm-agent',notes:k,op,id:n.id,title:n.title||null,text:n.text,about:n.about||null,...(n.tags&&n.tags.length?{tags:n.tags.join(', ')}:{})});return D}
const secOf=(D,id)=>{for(const k of NOTE_SECTIONS)if(D.notes[k].some(n=>n.id===id))return k;const n=(D.arch||[]).find(x=>x.id===id);return n?n.sec||'threads':null};
function notesWrite(a){const D=dmState(),day=today(),k=a.section;
  if(!NOTE_SECTIONS.includes(k))return {ok:false,error:'section must be one of '+NOTE_SECTIONS.join(', ')};
  if(day.notes>=DMA.NOTES_PER_DAY)return {ok:false,error:'That is enough note-keeping for one game day ('+DMA.NOTES_PER_DAY+').'};
  const b=dmBook(D),id=nOf(a.id,null,1,1e9);let r;
  if(a.op==='add')r=addNote(b,{text:a.text,about:a.about,sec:k},DMA.NOTE_MAX);
  else if(a.op==='edit'||a.op==='remove'){if(secOf(D,id)!==k)return {ok:false,error:'No note '+a.id+' in '+k};
    r=a.op==='edit'?updateNote(b,id,{text:a.text==null?'':a.text,...(clean(a.about,60)?{about:a.about}:{})},DMA.NOTE_MAX):forgetNote(b,id)}
  else return {ok:false,error:'op must be add, edit or remove'};
  if(!r.ok)return {ok:false,error:r.error.replace(/^update_memory needs the new text.*/,'edit needs text').replace(/^Remember what\?.*/,'add needs text')};
  day.notes++;const n=r.note;noteLog(a.op,k,n);
  return {ok:true,note:{id:n.id,section:k,text:n.text,...(n.about?{about:n.about}:{})},op:a.op,count:D.notes[k].length,...(r.archived?{archived:{id:r.archived.id,title:r.archived.title}}:{})}}
// The searchable notes (issue #155): remember, recall, update_memory, forget and pin over the same sections.
function dmMemory(tool,a){const D=dmState(),b=dmBook(D);
  if(tool==='recall')return recallNotes(b,a);
  const day=today();if(day.notes>=DMA.NOTES_PER_DAY)return {ok:false,error:'That is enough note-keeping for one game day ('+DMA.NOTES_PER_DAY+'). recall still works.'};
  const id=nOf(a.id,null,1,1e9),k0=tool==='remember'?(a.section||'threads'):secOf(D,id);let r,op;
  if(tool==='remember'){if(!NOTE_SECTIONS.includes(k0))return {ok:false,error:'section must be one of '+NOTE_SECTIONS.join(', ')};r=addNote(b,{title:a.title,text:a.text,tags:a.tags,about:a.about,sec:k0},DMA.NOTE_MAX);op='add'}
  else if(tool==='update_memory'){r=updateNote(b,id,{text:a.text,title:a.title,tags:a.tags,about:a.about},DMA.NOTE_MAX);op='edit'}
  else if(tool==='forget'){r=forgetNote(b,id);op='remove'}
  else{const on=!/^(false|no|off)$/i.test(String(a.on||''));r=pinNote(b,id,on);op=on?'pin':'unpin'}
  if(!r.ok)return r;day.notes++;const n=r.note;noteLog(op,k0||'threads',n);
  return {ok:true,[op==='add'?'remembered':op==='edit'?'updated':op==='remove'?'forgot':op==='pin'?'pinned':'unpinned']:{id:n.id,title:n.title,section:k0},...(r.archived?{archived:{id:r.archived.id,title:r.archived.title,note:'the oldest unpinned note of that section was archived (recall still finds it)'}}:{})}}

function pullLever(a){const day=today(),D=dmState(),name=clean(a.lever,40),reason=clean(a.reason,DMA.REASON_MAX);
  let params=a.params;if(typeof params==='string'){try{params=params.trim()?JSON.parse(params):{}}catch(e){params=null}}
  const refuse=why=>{D.stats.refused++;dmlog('lever',null,['Lever ',{t:name||'?',c:'gd'},' refused: '+why+(reason?' (wanted: '+reason+')':'')+'.'],{lever:name,by:'dm-agent',params:params&&typeof params==='object'?params:String(a.params).slice(0,200),reason,result:'rejected: '+why});
    return {ok:false,error:'Refused: '+why}};
  if(!params||typeof params!=='object'||Array.isArray(params))return refuse('params must be an object');
  if(!LEVERS[name])return refuse('no such lever (see levers)');
  if(name==='named_foe')return refuse('named foes are raised by the scripted DM inside a running scene');
  if(day.pulls>=DMA.PULLS_PER_DAY)return refuse('the DM agent has pulled '+DMA.PULLS_PER_DAY+' levers today; the world needs time to answer');
  const pile=pileOn(name,params);if(pile)return refuse(pile);
  const r=pull(name,params,{by:'dm-agent',reason});
  if(!r.ok){D.stats.refused++;return {ok:false,error:'Refused: '+r.reason}}
  day.pulls++;D.stats.pulls++;
  return {ok:true,lever:name,id:r.id,effect:r.effect,hours:r.until!=null?Math.round((r.until-S.gameMin)/60):null,your_pulls_today:day.pulls+'/'+DMA.PULLS_PER_DAY}}

function logIntent(text){const day=today(),t=clean(text,DMA.INTENT_MAX);if(!t)return {ok:false,error:'Say what you intend.'};
  if(day.intents>=DMA.INTENTS_PER_DAY)return {ok:false,error:'Enough plans logged for one game day ('+DMA.INTENTS_PER_DAY+'): keep the rest in notes.'};
  day.intents++;dmlog('agent',null,['DM agent: ',t],{by:'dm-agent',intent:t});return {ok:true,logged:t}}

// ---- the DM's voice in the game (issue #123) ----
// The owner's rule: the DM and the players talk only inside the game. These two tools are the only
// way the DM's words reach a hero: a line the heroes in range hear (their chat buffer, so the Chat
// tab, an agent's chat_read and events, a brain hero's snapshot), and the Table banner while a scene
// is open. Notes, log_intent and lever reasons never reach a hero (scripts/channelcheck.mjs).
export const NARRATOR={kind:'dm',name:'The Narrator'}; // a stub `from`, like an NPC's (sim/npcs.js), so saves stay small
const hearLine=(b,e)=>{(b.chat||(b.chat=[])).push(e);if(b.chat.length>CHAT_CAP)b.chat.shift()};
const byIdA=id=>S.agents.find(x=>x.id===id)||null;
function narrate(a){const day=today(),t=clean(a.text,DMA.NARRATE_MAX);if(!t)return {ok:false,error:'Narrate what?'};
  if((day.narr||0)>=DMA.NARRATE_PER_DAY)return {ok:false,error:'Enough narration for one game day ('+DMA.NARRATE_PER_DAY+'): let the world speak for itself.'};
  const near=clean(a.near,60);let hs,label;
  if(near.toLowerCase()==='table'){const sc=S.table;if(!sc)return {ok:false,error:'No Table scene is open.'};hs=sc.ids.map(byIdA).filter(alive);label='at the table'}
  else{const p=placeOf(near);if(!p)return {ok:false,error:'Unknown place "'+near+'". Use a hero name or id, a town, a region name, "x,y", or "table".'};
    const r=nOf(a.radius,DMA.NARRATE_R,4,20);label=p.label;
    hs=S.agents.filter(b=>alive(b)&&!b.hidden&&(dist(b,p)<=r||p.town&&b.state==='town'&&b.town===p.town))}
  const e={t:clockStr(),d:dayNo(),from:NARRATOR,text:t,trigger:'dm',dm:true};for(const b of hs)hearLine(b,e);
  if(S.table&&hs.some(b=>S.table.ids.includes(b.id)))S.table.narr={t:e.t,text:t}; // the banner and tableView show it
  day.narr=(day.narr||0)+1;
  dmlog('agent',null,['Narrator ('+label+'): ',t],{by:'dm-agent',voice:'narrate',text:t,heard:hs.map(b=>b.id)});
  return {ok:true,narrated:t,where:label,heard_by:hs.length,heroes:hs.slice(0,12).map(b=>b.name)}}
// A person by id or name (townsfolk or a DM-placed person).
function personOf(v){ensureNpcs();const k=clean(v,60).toLowerCase(),all=[...(S.npcs||[]),...(S.wanderers||[])];
  return all.find(n=>String(n.id).toLowerCase()===k)||all.find(n=>String(n.name||'').toLowerCase()===k||((n.title||'')+' '+n.name).toLowerCase()===k)||null}
// npc_say as the answer in a conversation (#170): with conv, or to a person whose conversation waits for the DM.
function convAnswer(a){const p=personOf(a.npc);if(!p)return null;
  const c=a.conv!=null&&a.conv!==''?convById(a.conv):convWith(p);
  if(a.conv!=null&&a.conv!==''&&(!c||c.npc!==p.id))return {ok:false,error:'No open conversation '+clean(a.conv,12)+' with '+p.name+' (see npc_call or dm_status conversations).'};
  if(!c||!(c.wait||a.conv!=null&&a.conv!==''))return null;
  return dmAnswer(c,p,a.text,{warmth:a.warmth,remember:a.remember})}
// npc_offer (#170): one follow-up of a conversation.
function npcOffer(a){const p=personOf(a.npc);if(!p)return {ok:false,error:'Nobody called "'+clean(a.npc,40)+'" (see npcs).'};
  const c=a.conv!=null&&a.conv!==''?convById(a.conv):convWith(p);if(!c||c.npc!==p.id)return {ok:false,error:'No open conversation with '+p.name+': a follow-up belongs to a conversation a member started.'};
  const kind=clean(a.kind,12).toLowerCase();
  if(c.wait&&!legalOffers(c,p).includes(kind))return npcOfferApply(c,p,kind,a,'dm-agent'); // refused before the line is spoken (it says why)
  let said=null;if(c.wait&&clean(a.text,CONV.DM_LINE_MAX)){said=dmAnswer(c,p,a.text,{});if(!said.ok)return said}
  const r=npcOfferApply(c,p,kind,a,'dm-agent');
  if(r.ok){const w=Number(a.warmth);if(Number.isFinite(w)&&w)warm(p,Math.max(-3,Math.min(3,Math.round(w))),'the DM: '+kind)}
  return said?{...r,said:said.ok}:r}
function npcSay(a){const cv=convAnswer(a);if(cv)return cv;
  const day=today(),t=clean(a.text,DMA.NPC_SAY_MAX);if(!t)return {ok:false,error:'Say what?'};
  if((day.npc||0)>=DMA.NPC_SAY_PER_DAY)return {ok:false,error:'Enough lines for the townsfolk for one game day ('+DMA.NPC_SAY_PER_DAY+').'};
  ensureNpcs();const k=clean(a.npc,60).toLowerCase(),all=[...(S.npcs||[]),...(S.wanderers||[])];
  const p=all.find(n=>String(n.id).toLowerCase()===k)||all.find(n=>String(n.name||'').toLowerCase()===k||((n.title||'')+' '+n.name).toLowerCase()===k);
  if(!p)return {ok:false,error:'Nobody called "'+clean(a.npc,40)+'" (see npcs for ids and names).'};
  if(!Number.isFinite(p.x)||!Number.isFinite(p.y))return {ok:false,error:p.name+' is nowhere the heroes could hear them.'};
  const e={t:clockStr(),d:dayNo(),from:{kind:'npc',id:p.id,name:p.name,fac:p.fac},text:t,trigger:'npc'};
  const hs=S.agents.filter(b=>alive(b)&&!b.hidden&&dist(b,p)<=HEAR);if(S.fellowship&&hs.some(b=>b.fellow))e.fh=true;for(const b of hs)hearLine(b,e);
  p.bubble={text:t,life:BUBBLE};if(e.fh)p.bubble.fh=true;day.npc=(day.npc||0)+1;
  dmlog('agent',null,[(p.title?p.title+' ':'')+p.name+' (DM agent): "',t,'"'],{by:'dm-agent',voice:'npc_say',npc:p.id,text:t,heard:hs.map(b=>b.id)});
  return {ok:true,who:(p.title?p.title+' ':'')+p.name,said:t,heard_by:hs.length,heroes:hs.slice(0,12).map(b=>b.name)}}

const BY_NAME=new Map(DM_TOOLS.map(t=>[t.name,t]));
// One DM tool call: validated, answered, never thrown. The seat must be open.
export function dmAct(tool,args={}){
  if(tool==='turn_end'){if(!dmSeatOn())return {ok:false,error:'The DM seat is closed.',offline:true};return turnEnd(args)} // the relay's report of a finished turn, not a tool of the agent's
  const t=BY_NAME.get(tool);if(!t)return {ok:false,error:'Unknown DM tool '+String(tool).slice(0,40)+'.'};
  if(!dmSeatOn())return {ok:false,error:'The DM seat is closed. Open it in the game (Dungeon Master panel: "DM agent") or start the headless world with --dm.',offline:true};
  args=args&&typeof args==='object'?args:{};let r;dmHeard(tool,args); // a DM present: conversations wait for it a little (#170)
  try{switch(tool){
    case 'dm_status':r=status();break;
    case 'read_timeline':r=timelineRead(args.n);break;
    case 'read_chronicle':r=chronicleRead(args.n);break;
    case 'read_dm_log':r=dmLogRead(args.n,args.kind);break;
    case 'fellowship_view':r=fellowshipView();break;
    case 'heroes_near':r=heroesNear(args.near,args.radius);break;
    case 'npcs':r=npcsRead(args.town);break;
    case 'regions':r=regionsRead();break;
    case 'hooks':r=hooksRead(args.town);break;
    case 'levers':r=leversRead();break;
    case 'notes_read':r=notesRead(args.section);break;
    case 'notes_write':r=notesWrite(args);break;
    case 'pull_lever':r=pullLever(args);break;
    case 'log_intent':r=logIntent(args.text);break;
    case 'remember':case 'recall':case 'update_memory':case 'forget':case 'pin':r=dmMemory(tool,args);break;
    case 'narrate':r=narrate(args);break;
    case 'npc_say':r=npcSay(args);break;
    case 'npc_call':r=npcCall();break;
    case 'npc_offer':r=npcOffer(args);break;
    case 'stage_scene':r=stageScene(args);break;
    case 'table_call':r=tableCall();break;
    case 'table_answer':r=tableAnswer(args);break;
  }}catch(e){r={ok:false,error:'The DM tool failed: '+String(e&&e.message||e).slice(0,160)}}
  if(!r)r={ok:false,error:'no answer'};
  if(!((tool==='table_call'||tool==='npc_call')&&r.ok&&!r.call)){remember(tool,args,r.ok!==false);try{recordTurn(tool,args,r)}catch(e){}} // an idle poll of the table is not a call worth keeping
  return r}
