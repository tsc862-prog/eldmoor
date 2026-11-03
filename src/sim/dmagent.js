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
import {ZONES,REGIONS,CITY,ZPTS,LANDMARKS,zoneAt,dist} from '../world/map.js';
import {FAC} from '../data/factions.js';
import {nearText,pointHint} from './nearform.js'; // the place shapes a local model writes (issue #467)
import {MOBS} from '../data/mobs.js';
import {DM_TOOLS,NOTE_SECTIONS} from '../data/dm-tools.js';
import {parseCampaign,campaignText} from './campaign.js'; // the campaign seed (owner request)
import {dmlog} from './dmlog.js';
import {pull,leverAlias,aliasParams,leverMenu,LEVERS,ready,activeOf,leverUsage,leverNames,spotErr,LK} from './levers.js';
import {EVENTS} from './events.js'; // world event kinds (#10), read only here (#352)
import {maxHp} from './heroes.js';
import {fellowshipMembers,fellows,openThreads,mindsOf} from './fellowship.js';
import {openProps} from './council.js';
import {HEAR,CAP as CHAT_CAP,BUBBLE} from './chat.js';
import {moment} from './reflect.js'; // a dream is a reflection moment (#523)
import {ensureNpcs} from './npcs.js';
import {stageScene,tableCall,tableAnswer,stagedView,STAGE} from './staged.js';
import {sceneCall,sceneAnswer,ourScene,openingDue} from './arrival.js'; // session zero and a newcomer's arrival ask for the DM's voice too (#437, #452)
import {prepCall,prepView,endPrep,prepActive} from './prep.js'; // the bounded prep before the table opens (#437)
import {npcCall,dmAnswer,offer as npcOfferApply,convWith,convById,convSummary,recordView,dmHeard,warm,legalOffers,CONV} from './talk.js'; // NPC conversations (#170)
import {focus,focuses,followedCompany,focusStats,touchedAt} from './dmfocus.js'; // the Fellowship first (issue #165), every company a thread (#450)
import {openThreads as companyThreads} from './company.js';
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
  WHISPER_PER_DAY:8,   // whispers per game day (#523: one hero hears a line nobody else does)
  DREAM_PER_DAY:2,     // dreams per game day (delivered when the hero next sleeps)
  WHISPER_R:4,         // tiles from the placed person (as) a hero must be within to hear a whisper outside a Table scene
  NARRATE_R:10,        // default radius of a narrate line around its place
};
const DAY=1440;
const PILING=['mark_dangerous','custom_foe','named_foe','set_condition','start_event'];
const DANGER_CONDS=['bandits','migration']; // the region conditions that add danger: set_condition of these kinds, or a world event that runs as one (invasion = bandits, migration)

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
function placeOf(near){const nt=nearText(near);if(nt.err)return null;const s=String(nt.s||'').trim();if(!s)return null;
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
const READS=new Set(['dm_status','read_timeline','read_chronicle','read_dm_log','fellowship_view','companies_view','heroes_near','npcs','regions','hooks','levers','notes_read','recall']);
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
  else if(tool==='pull_lever'||FLAT_LEVERS[tool])t.levers.push({ok,name:cutT(FLAT_LEVERS[tool]||args.lever||args.name,32),why:cutT(ok?(res.effect||args.reason):res.error,120)});
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
  if(name==='set_condition'&&!DANGER_CONDS.includes(p.kind))return null;
  if(name==='start_event'){const ev=EVENTS[p.kind];if(!DANGER_CONDS.includes(ev&&ev.cond||p.kind))return null}
  const at=p.at&&typeof p.at==='object'&&Number.isFinite(Number(p.at.x))?{x:Number(p.at.x),y:Number(p.at.y)}:null,z=p.region!=null?regionIdx(p.region):at?zoneAt(at.x,at.y):null;
  const fs=focuses(),five=new Set(fellows()),coOf=a=>fs.find(f=>f.ids.has(a.id)),who=a=>{if(five.has(a))return ' of the Fellowship';const f=coOf(a);return f&&f.members.length>1?' of '+(f.company.name||'a company'):' (riding alone)'};
  const L=[...fellows(),...fs.flatMap(f=>f.members).filter(a=>!five.has(a))]; // the Fellowship as before, then every other company's members (#450)
  for(const a of L){if(a.state==='town'||a.hp>=maxHp(a)*DMA.PILE_HP)continue;
    if(at&&dist(a,at)<=DMA.PILE_R||z!=null&&zoneAt(a.x,a.y)===z)return a.name+who(a)+' is badly hurt ('+pct(a)+'% HP) out in '+(ZONES[zoneAt(a.x,a.y)]||'the wilds')+': the DM does not pile on. Try again when they have recovered or reached a town.'}
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
  if(!adv.length&&!sv.cur&&!S.table&&!props.length&&!hurt.length)items.push('Nothing is under way for them: a hook near '+at+', a rumour of a named foe on their road, or a staged scene ('+(field.length?'stage_scene near "fellowship"':'in town: stage_scene kind meeting or social with at "'+at+'" and a setting')+') would give their next game hours something.');
  const quiet=!S.table&&!props.length&&!hurt.length&&!adv.length&&!sv.cur;
  return {summary:(field.length?field.length+' riding in '+at:'all '+fo.members.length+' in '+at)+(inTown&&field.length?', '+inTown+' in town':'')+'; '+(th.length?th.length+' open thread'+(th.length===1?'':'s'):'no open threads')+(adv.length?'; a job is under way':'; no job under way')+(hurt.length?'; '+hurt.length+' badly hurt':'')+(S.table?'; a Table scene is open':'')+'.',
    where:at,riding:field.length,in_town:inTown,items,quiet,share_of_dm_actions:focusStats()}}
// What changed for them since the last look: place, falls, scenes, finished jobs and oaths. A string; equal means nothing new.
function sigOf(fo){const F=fo.company,field=fo.members.filter(a=>a.state!=='town'&&!a.hidden),z=field.length?zoneAt(fo.x,fo.y):-1,t=F.tableStats||{};
  const done=(S.adventures||[]).filter(v=>v.phase==='done'&&v.mem&&v.mem.some(id=>fo.ids.has(id))).length,oaths=fo.members.filter(a=>a.goal&&a.goal.done).length;
  return [z,field.length?1:0,(F.past||[]).length,t.scenes||0,done,oaths,companyThreads(F).length,!!S.table].join('|')}
// One signature per company joined with | (#450): any company's change makes a DM event turn due. One company: its own
// (the Fellowship alone reads exactly as before).
export function companiesSig(){const fs=focuses();if(!fs.length)return null;return fs.length===1?sigOf(fs[0]):fs.map(f=>f.cid+':'+sigOf(f)).join('|')}

// ---- every company a thread (#450) ----
// What each company needs from the DM, neediest first: the followed company when it must choose (a scene or vote of its own
// is open); then any company with a pending scene or vote; then one with members badly hurt out in the field; then the one
// longest without a DM action for it (touchedAt; never = longest); then the smaller (a solo is the most fragile); then id.
// Read only: game state, never hero notes.
const pendingOf=fo=>({scene:!!(S.table&&(S.table.ids||[]).some(id=>fo.ids.has(id))),vote:(fo.company.props||[]).some(P=>P.status==='open')});
export const NEED_WHY=['the followed company must choose','a scene or vote is pending','members badly hurt in the field','longest without you','the most fragile'];
export function companiesNeeds(){const fs=focuses();if(!fs.length)return [];const fol=followedCompany();
  const rows=fs.map(fo=>{const C=fo.company,pend=pendingOf(fo),field=fo.members.filter(a=>a.state!=='town'&&!a.hidden),hurt=field.filter(a=>a.hp<maxHp(a)*DMA.PILE_HP);
    const at=field.length?(ZONES[zoneAt(fo.x,fo.y)]||'the wilds'):(fo.town?fo.town.name:'town'),th=companyThreads(C),since=touchedAt(C)==null?null:Math.max(0,Math.round(S.gameMin-touchedAt(C)));
    const n=fo.members.length,label=C.slots?'the Fellowship':n===1?fo.members[0].name+' (riding alone)':(C.name||'a company of '+n),items=[],must=C===fol&&(pend.scene||pend.vote);
    if(pend.scene)items.push('A Table scene of theirs is open: let it play.');
    if(pend.vote)items.push('A vote is open among them: leave it to them.');
    for(const a of hurt)items.push(a.name+' is badly hurt ('+pct(a)+'% HP) out in '+(ZONES[zoneAt(a.x,a.y)]||'the wilds')+': no danger near them.');
    for(const t of th.slice(0,2))items.push('Open thread: '+txt(t.parts));
    const quiet=!pend.scene&&!pend.vote&&!hurt.length&&!fo.busy;
    if(quiet)items.push('Nothing is under way for them: a hook on their road near '+at+(fo.town?' or on the '+fo.town.name+' board':'')+', a person, or a staged scene near one of them.');
    const why=must?NEED_WHY[0]:pend.scene||pend.vote?NEED_WHY[1]:hurt.length?NEED_WHY[2]:since==null?'no DM action for them yet':NEED_WHY[3];
    return {id:C.id,company:label,size:n,solo:n===1,followed:C===fol,hall:fo.town?fo.town.name:null,where:at,riding:field.length,
      pending:pend.scene?'scene':pend.vote?'vote':null,hurt:hurt.length,busy:fo.busy,since_dm_min:since,open_threads:th.length,
      summary:(field.length?field.length+' riding in '+at:(n===1?'in ':'all '+n+' in ')+at)+(fo.busy?'; a job is under way':'; no job under way')+(hurt.length?'; '+hurt.length+' badly hurt':'')+(since==null?'; nothing from you yet':'; your last act for them '+Math.round(since/60)+'h ago')+'.',
      items:items.slice(0,4),quiet,why,
      _k:[must?0:1,pend.scene||pend.vote?0:1,hurt.length?0:1,-(since==null?Infinity:since),n,C.id]}});
  rows.sort((x,y)=>{for(let i=0;i<x._k.length;i++)if(x._k[i]!==y._k[i])return x._k[i]<y._k[i]?-1:1;return 0});
  for(const r of rows)delete r._k;
  return rows}

// ---- the tools ----
// World events (issue #352): the start_event pulls running now (kind, region, days left, who and why) and whether one
// may start today; read only (S.levers, S.conditions, the Fellowship's regions), no dice. The Fellowship first: their
// regions are named so an event goes on their road, and only once nothing is pending for them.
function worldEvents(){const def=LEVERS.start_event;if(!def)return null;
  const L=S.levers,lim=def.limits||{},run=activeOf('start_event'),used=L&&L.day&&L.day.d===gameDay()?(L.day.n.start_event||0):0,d=today();
  const running=run.map(x=>({kind:x.params&&x.params.kind||null,region:x.region!=null?ZONES[x.region]:null,days_left:Math.max(0,Math.round((x.until-S.gameMin)/144)/10),by:x.by,reason:x.reason||null}));
  const why=!ready('start_event')?(lim.maxActive!=null&&run.length>=lim.maxActive?'a world event is already running ('+lim.maxActive+' at a time)':lim.perDay!=null&&used>=lim.perDay?'one world event has started today; try another game day':'not available')
    :d.pulls>=DMA.PULLS_PER_DAY?'you have pulled '+DMA.PULLS_PER_DAY+' levers today':null;
  const cooling=Object.entries(L&&L.cd||{}).filter(([k,t])=>k.startsWith('start_event:')&&t>S.gameMin).map(([k,t])=>ZONES[+k.split(':')[1]]+' '+Math.round((t-S.gameMin)/60)+'h');
  const fo=focus(),F=S.fellowship;
  return {running,open_today:!why,...(why?{why_not:why}:{}),kinds:Object.keys(EVENTS),per_day:lim.perDay??null,at_a_time:lim.maxActive??null,
    regions_with_a_condition:(S.conditions||[]).map(c=>ZONES[c.z]+' ('+c.kind+')'),...(cooling.length?{cooling}:{}),
    ...(F?{fellowship_regions:fo?[...fo.zones].map(z=>ZONES[z]):[],note:'Fellowship first: start an event only when nothing is pending for them, in a region they ride (fellowship_regions) or are headed to, and say why it serves their story.'}:{})}}

// companies_needs is shown once a company other than the Fellowship rides (with the Fellowship alone dm_status reads as before).
const manyCompanies=()=>{const fs=focuses();return fs.length>1||fs.length===1&&!fs[0].company.slots};
export const COMPANIES_FIRST='Every company is a thread: serve the company at the head of companies_needs first (the followed company first only when it must choose), then each other company in turn, the one longest without you next; a split-off member is a thread of its own, and a solo is the most fragile.';
function status(){const D=dmState(),day=today(),tl=S.timeline||[],ch=S.chronicle||[],L=S.dmLog||[],F=S.fellowship;
  const sinceTl=tl.filter(e=>e.gameMin>D.seen.tl).length,i=ch.findIndex(e=>(e.t+txt(e.parts))===D.seen.chron),sinceCh=i<0?Math.min(ch.length,30):i,sinceLog=L.filter(e=>e.id>D.seen.log).length;
  D.seen.tl=tl[0]?tl[0].gameMin:D.seen.tl;D.seen.chron=ch[0]?ch[0].t+txt(ch[0].parts):D.seen.chron;D.seen.log=L[0]?L[0].id:D.seen.log;
  const sc=S.table||null,props=F?openProps():[];
  const h=Math.floor((S.gameMin%DAY)/60);
  return {ok:true,world:D.world,day:gameDay()+1,time:clockStr(),gameMin:Math.round(S.gameMin),part:h<6?'night':h<12?'morning':h<18?'afternoon':'evening',
    fellowship_first:F?'The Fellowship comes first: read fellowship_needs, act for them, and only then shape the wider world (and only when nothing is pending for them).':null,
    fellowship_needs:fellowshipNeeds(),fellowship_change:companiesSig(),
    ...(manyCompanies()?{companies_first:COMPANIES_FIRST,companies_needs:companiesNeeds()}:{}),
    prep:{...prepView(),...(openingDue()?{opening_due:true}:{})}, // #437: while it runs the world is held for you; end it with prep_done
    table:sc?(ourScene()?{open:true,kind:sc.kind,voice:true,call:!!(sc.calls&&sc.calls.some(c=>!c.done)),note:sc.kind==='opening'?'Session zero is at the table: your voice frames it (table_call, table_answer; a few seconds, then the scripted DM fills it).':'A newcomer arrives at the table: your voice speaks for them (table_call, table_answer; a few seconds, then the scripted DM fills it).'}
      :sc.ctx&&sc.ctx.staged!=null?{open:true,kind:sc.kind||null,staged:true,call:!!(sc.calls&&sc.calls.some(c=>!c.done)),note:'The scene you staged is at the table: answer its calls with table_call and table_answer (a few seconds each; silence is filled by the scripted DM).'}
      :{open:true,kind:sc.kind||null,note:'A Table scene is running: let it play out; its calls are not yours (only scenes you staged are).'}):{open:false},
    staged:stagedView(),
    proposals:props.map(P=>({id:P.id,kind:P.kind,details:P.details||null})),pending:!!sc||props.length>0,
    fellowship:F?{name:F.name,minds:mindsOf(F),members:fellowshipMembers().map(m=>m.hero?{id:m.hero.id,name:m.hero.name,role:m.label,lvl:m.hero.lvl,hp:pct(m.hero)+'%',doing:m.hero.state,where:where(m.hero)}:{role:m.label,empty:true})}:null,
    since_last_look:{timeline:sinceTl,chronicle:sinceCh,dm_log:sinceLog},
    adventures:(S.adventures||[]).filter(v=>v.phase==='active').length,open_jobs:(S.adventures||[]).filter(v=>v.phase==='open').length,
    levers_active:(S.levers&&S.levers.active||[]).length,world_events:worldEvents(),your_pulls_today:day.pulls+'/'+DMA.PULLS_PER_DAY,
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

// Every company (#450): who rides in it, where, its hall, open threads and votes, the latest campaign lines and when you last
// did something for it. Personas and memories stay in fellowship_view (the Fellowship) and are never shown for the others.
function companiesView(){const fs=focuses(),fol=followedCompany();if(!fs.length)return {ok:true,companies:[],note:'No company rides in this world yet.'};
  return {ok:true,companies:fs.map(fo=>{const C=fo.company;return {id:C.id,name:C.name||null,fellowship:!!C.slots,followed:C===fol,faction:facName(C.fac),hall:C.hall||null,size:fo.members.length,solo:fo.members.length===1,
    members:fo.members.map(a=>({...heroLine(a),oath:a.goal&&!a.goal.done?a.goal.text:null})),busy:fo.busy,regions:[...fo.zones].map(z=>ZONES[z]),
    open_threads:companyThreads(C).map(t=>({kind:t.kind,text:txt(t.parts)})),proposals:(C.props||[]).filter(P=>P.status==='open').map(P=>({id:P.id,kind:P.kind,details:P.details||null})),
    campaign_log:(C.log||[]).slice(0,6).map(e=>'D'+e.day+' '+e.t+' '+txt(e.parts)),fallen:(C.past||[]).slice(-5).map(p=>p.name||('#'+p.id)),
    last_dm_action_min_ago:touchedAt(C)==null?null:Math.max(0,Math.round(S.gameMin-touchedAt(C))),dm_actions:(S.dmFocus&&S.dmFocus.by&&S.dmFocus.by[C.id])||0}}),
    needs_order:companiesNeeds().map(r=>r.id)}}

function heroesNear(near,radius){const p=placeOf(near);if(!p)return {ok:false,error:'Unknown place "'+clean(near,40)+'". Use a hero name or id, a town, a region name, or "x,y".'};
  const r=nOf(radius,DMA.NEAR_R,4,30),hs=[];
  for(const a of S.agents){if(!alive(a)||a.hidden)continue;if(p.town?!(a.state==='town'&&a.town===p.town)&&dist(a,p)>r:dist(a,p)>r)continue;hs.push(a)}
  hs.sort((x,y)=>dist(x,p)-dist(y,p));const parties=new Map();for(const a of hs)if(a.party&&!parties.has(a.party.id))parties.set(a.party.id,a.party);
  return {ok:true,place:p.label,radius:r,heroes:hs.slice(0,24).map(heroLine),more:Math.max(0,hs.length-24),
    parties:[...parties.values()].map(P=>({id:P.id,leader:P.leader?P.leader.name:null,members:(P.members||[]).filter(alive).map(b=>b.name),fellowship:!!P.fellow}))}}

const attOf=n=>(n.att||[]).filter(x=>x.until==null||x.until>S.gameMin).map(x=>({toward:x.to+' '+x.id,attitude:x.a}));
// The scope of a hooks or npcs read (issue #427): a town, or a region (the towns whose gate lies in it, and what is out in it).
// A town value that names a region is read as the region (the reply says so). Unknown: the refusal names the regions and towns.
function readScope(tool,town,region){const t=clean(town,40),g=clean(region,40);if(!t&&!g)return {};
  if(t){const c=townOf(t);if(c)return {towns:[c.name],c,label:c.name}}
  const v=g||t,z=regionIdx(v);
  if(z==null)return {err:'No '+(g?'region':'town or region')+' called "'+v+'". '+tool+' takes town ('+CITY.map(c=>c.name).join(', ')+') or region ('+ZONES.join(', ')+').'};
  return {z,towns:CITY.filter(c=>zoneAt(c.gate.x,c.gate.y)===z).map(c=>c.name),label:ZONES[z],...(!g?{note:'"'+t+'" is a region, not a town: read as the region '+ZONES[z]+'.'}:{})}}
const scopeHead=Q=>Q.label?{scope:Q.z!=null?{region:Q.label,towns:Q.towns}:{town:Q.label},...(Q.note?{note:Q.note}:{})}:{};
function npcsRead(town,region){const Q=readScope('npcs',town,region);if(Q.err)return {ok:false,error:Q.err};const c=Q.c,inT=n=>!Q.label||Q.towns.includes(n.town);
  const wIn=w=>!Q.label||(c?w.town===c.name||dist(w,c.gate)<=20:Q.towns.includes(w.town)||zoneAt(w.x,w.y)===Q.z);
  const folk=(S.npcs||[]).filter(inT).map(n=>({id:n.id,name:n.title+' '+n.name,role:n.role,town:n.town,...(attOf(n).length?{attitudes:attOf(n)}:{}),...(recordView(n)?{fellowship:recordView(n)}:{})}));
  const wand=(S.wanderers||[]).filter(wIn).map(w=>({id:w.id,name:w.name,title:w.title,role:w.role,where:w.town||ZONES[zoneAt(w.x,w.y)],home:w.homeKind,attitude:w.attitude||'neutral',
    ...(attOf(w).length?{attitudes:attOf(w)}:{}),...(recordView(w)?{fellowship:recordView(w)}:{}),placed_by_lever:w.lever||null}));
  return {ok:true,...scopeHead(Q),townsfolk:folk.slice(0,60),wanderers:wand}}

function regionsRead(){const mobs=new Array(ZONES.length).fill(0),heroes=new Array(ZONES.length).fill(0);
  for(const m of S.mobs)if(m.alive&&!m.gone){const z=zoneAt(m.x,m.y);if(z>=0)mobs[z]++}
  for(const a of S.agents)if(alive(a)&&a.state!=='town'&&!a.hidden){const z=zoneAt(a.x,a.y);if(z>=0)heroes[z]++}
  return {ok:true,regions:ZONES.map((name,z)=>{const cond=(S.conditions||[]).filter(c=>c.z===z),marks=(S.marks||[]).filter(m=>m.z===z),pl=(S.places||[]).filter(p=>p.z===z);
    return {index:z,name,levels:band(z),monsters:mobs[z],heroes_out:heroes[z],creatures:Object.keys(MOBS).filter(k=>MOBS[k].z===z).slice(0,8),
      ...(cond.length?{condition:cond.map(c=>c.kind+' '+c.str+' ('+Math.max(0,Math.round((c.until-S.gameMin)/60))+'h left)')}:{}),
      ...(marks.length?{areas:marks.map(m=>m.kind+' at '+Math.round(m.x)+','+Math.round(m.y)+' r'+m.r)}:{}),
      ...(pl.length?{places:pl.map(p=>({id:p.id,kind:p.kind,name:p.name,at:Math.round(p.x)+','+Math.round(p.y)}))}:{})}}),
    towns:CITY.map(c=>({name:c.name,faction:facName(c.fac),gate:Math.round(c.gate.x)+','+Math.round(c.gate.y),region:ZONES[zoneAt(c.gate.x,c.gate.y)]}))}}

function hooksRead(town,region){const Q=readScope('hooks',town,region);if(Q.err)return {ok:false,error:Q.err};
  const A=(S.adventures||[]).filter(v=>!Q.label||Q.towns.includes(v.town)||(Q.z!=null&&v.zone===Q.z)),hn=id=>{const b=S.agents.find(x=>x.id===id);return b?b.name:'#'+id};
  return {ok:true,...scopeHead(Q),open_jobs:A.filter(v=>v.phase==='open').map(h=>({id:h.id,town:h.town,tpl:h.tpl,src:h.src,giver:h.giver?h.giver.name:null,region:h.zone==null?'any':ZONES[h.zone],
      ...(h.for!=null?{for:hn(h.for)}:{}),hours_left:Math.max(0,Math.round((h.until-S.gameMin)/60))})),
    under_way:A.filter(v=>v.phase==='active').map(v=>({id:v.id,title:v.title,tpl:v.tpl,town:v.town,leader:hn(v.lead),members:v.mem.map(hn),scene:(v.idx||0)+1,of:(v.scenes||[]).length,away:!!v.away})),
    recently_done:A.filter(v=>v.phase==='done').slice(-5).map(v=>({id:v.id,title:v.title,outcome:v.outcome||null}))}}

function leversRead(){const L=S.levers,d=today(),hrs=m=>Math.max(0,Math.round(m/60));
  return {ok:true,levers:leverMenu().filter(l=>l.available&&l.name!=='named_foe').map(l=>({name:l.name,about:l.about,params:l.params,limits:l.limits,cooldown_min:l.cooldown})),
    note:'named_foe belongs to the scripted DM inside a running scene. post_hook may not use tpl "fallen" or spec.',
    active:(L&&L.active||[]).map(x=>({id:x.id,lever:x.name,by:x.by,region:x.region!=null?ZONES[x.region]:null,hours_left:hrs(x.until-S.gameMin),reason:x.reason})),
    pulled_today:L&&L.day&&L.day.d===gameDay()?{...L.day.n}:{},cooldowns:Object.fromEntries(Object.entries(L&&L.cd||{}).filter(([,t])=>t>S.gameMin).map(([k,t])=>[k,hrs(t-S.gameMin)+'h'])),
    world_events:worldEvents(),your_pulls_today:d.pulls+'/'+DMA.PULLS_PER_DAY}}

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

// The shapes a model sends for a lever's params, made into what the lever reads (issue #401): params as a JSON string,
// the lever's own keys at the top level beside lever/reason, and a point given as x,y / coords / "x,y" instead of {x,y}.
// It only reshapes; the lever validates the result as before.
const PULL_KEYS=['lever','params','reason'];
function leverParams(name,a){let params=a.params;
  if(typeof params==='string'){try{params=params.trim()?JSON.parse(params):{}}catch(e){return null}}
  if(params==null)params={};if(typeof params!=='object'||Array.isArray(params))return null;params={...params};
  const def=LEVERS[name];if(!def)return params;
  for(const k in a)if(!PULL_KEYS.includes(k)&&k in def.params&&!(k in params))params[k]=a[k];
  const pts=Object.keys(def.params).filter(k=>def.params[k].type==='point'),num=v=>v!==''&&v!=null&&Number.isFinite(Number(v));
  const asPt=v=>{if(typeof v==='string'){const t=nearText(v),m=/^\s*\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?\s*$/.exec(t.s||v);return m?{x:Number(m[1]),y:Number(m[2])}:v} // "Town,dx,dy" and {"x":..} as text too (#467)
    if(Array.isArray(v)&&v.length===2&&num(v[0])&&num(v[1]))return {x:Number(v[0]),y:Number(v[1])};
    if(v&&typeof v==='object'&&num(v.x)&&num(v.y))return {x:Number(v.x),y:Number(v.y)};return v};
  for(const k of pts)if(params[k]!=null)params[k]=asPt(params[k]);
  const loose=pts.filter(k=>params[k]==null);
  if(loose.length===1){const k=loose[0],src=num(params.x)&&num(params.y)?params:num(a.x)&&num(a.y)?a:null,c=params.coords!=null?params.coords:a.coords;
    if(src){params[k]={x:Number(src.x),y:Number(src.y)};if(!('x' in def.params))delete params.x;if(!('y' in def.params))delete params.y}
    else if(c!=null){const p=asPt(c);if(p&&typeof p==='object'&&!Array.isArray(p)){params[k]=p;delete params.coords}}}
  return params}
// via (issue #413): a flat lever tool (post_hook, place_person, mark_place) that built the params itself; its own
// contract replaces the pull_lever call shape in the refusals. Everything else (caps, pile-on, limits, log) is the same.
function pullLever(a,via){const day=today(),D=dmState(),name0=clean(a.lever,40),name=leverAlias(name0),reason=clean(a.reason,DMA.REASON_MAX); // give_token / take_token are give_item / take_item (#524)
  const params=via?a.params:aliasParams(name0,leverParams(name,a));
  const refuse=(why,usage)=>leverRefuse(name,why,usage,reason,params&&typeof params==='object'?params:String(a.params).slice(0,200),via);
  const call=via?via.usage:'call it as pull_lever {"lever":"'+(name||'<name>')+'","params":{...},"reason":"one sentence"}';
  if(!name)return refuse('lever is required (one of: '+leverNames().join(', ')+')',call);
  if(!LEVERS[name])return refuse('no such lever "'+name+'"; levers: '+leverNames().join(', '));
  const usage=via?via.usage+'. The lever: '+leverUsage(name):leverUsage(name)+'; '+call;
  if(!params)return refuse('params must be an object such as {"region":"'+ZONES[0]+'"}',usage);
  if(name==='named_foe')return refuse('named foes are raised by the scripted DM inside a running scene');
  if(!reason)return refuse('a reason is required (one sentence for the DM log)',usage);
  if(day.pulls>=DMA.PULLS_PER_DAY)return refuse('the DM agent has pulled '+DMA.PULLS_PER_DAY+' levers today; the world needs time to answer');
  const pile=pileOn(name,params);if(pile)return refuse(pile);
  const r=pull(name,params,{by:'dm-agent',reason});
  // a limit, a cooldown or the reserved share is a refusal to wait out, not a wrong call: no contract with it
  if(!r.ok){D.stats.refused++;const shape=!/^(limit|cooldown|not available)/.test(r.reason);
    return {ok:false,error:'Refused: '+r.reason+(shape?'. '+usage:''),...(shape?{usage}:{})}}
  day.pulls++;D.stats.pulls++;if(via&&via.after)try{via.after(r)}catch(e){}
  return {ok:true,lever:name,id:r.id,effect:r.effect,hours:r.until!=null?Math.round((r.until-S.gameMin)/60):null,your_pulls_today:day.pulls+'/'+DMA.PULLS_PER_DAY}}

// A refused lever call, counted and written to the DM log with its reason (pull_lever and the flat lever tools alike).
function leverRefuse(name,why,usage,reason,params,via){const D=dmState();D.stats.refused++;
  dmlog('lever',null,['Lever ',{t:name||'?',c:'gd'},' refused: '+why+(reason?' (wanted: '+reason+')':'')+'.'],{lever:name,by:'dm-agent',...(via?{tool:via.tool}:{}),params,reason,result:'rejected: '+why});
  return {ok:false,error:'Refused: '+why+(usage?'. '+usage:''),...(usage?{usage}:{})}}

// ---- flat lever tools (issue #413) ----
// post_hook, place_person and mark_place are thin wrappers over pull_lever for the three levers the DM reaches for most:
// flat arguments, a near read the way stage_scene reads it, then pullLever(), so the DM agent's daily cap, the pile-on
// rule, the lever's own limits, cooldown and the Fellowship's reserved share (levers.js pull) and the DM log are identical.
// Nothing is validated twice: the lever refuses, and its contract comes back with the refusal.
export const FLAT_LEVERS={post_hook:'post_hook',place_person:'create_npc',mark_place:'mark_place',give_item:'give_item',take_item:'take_item'};
const NEAR_FORMS='"fellowship", a member or hero, "x,y", a town, a place, a landmark or a region';
const FLAT_USAGE={
  post_hook:'post_hook takes: town (a town: '+CITY.map(c=>c.name).join('|')+', or "fellowship", a member or a region for the nearest board), tpl (rescue|escort|investigate|clear|relic|negotiate|hunt|deliver), giver? (captain|innkeeper|smith|quartermaster|priest|bard), reward? (small|fair|generous), region? (where the job leads), place? (a place or person by name or id), for? (a hero by name or id), reason',
  place_person:'place_person takes: role (peddler|hermit|drover|sellsword|minstrel|stranger), near ('+NEAR_FORMS+'), name?, faction? (concord|warband|neutral), want?, attitude? (hostile|wary|neutral|friendly), hours? (6-168), spot? (in a town: inn|smith|quartermaster|chapel|square|gate), reason',
  give_item:'give_item takes: hero (a hero by name or id), item (a quest item or token, a consumable, or a gear slot head|chest|hands|feet|main|off|trinket), by? (a person in earshot, by name or id), ilvl? (gear only, never above the hero’s level), reason',
  take_item:'take_item takes: hero (a hero by name or id), item (a quest item or token), by? (a person in earshot, by name or id), reason',
  mark_place:'mark_place takes: kind (ruin|camp|shrine|cairn_door|watchtower), near ('+NEAR_FORMS+'), name?, hours? (12-336), reason'};
// A walkable spot between min and max tiles of c (rings outward, no dice), clear of towns, landmarks and, by gap, other places.
function openSpot(c,min,max,gap){const R=q=>Math.round(q*10)/10,okAt=q=>!spotErr(q)&&!(gap&&(S.places||[]).some(p=>dist(p,q)<gap));
  if(min<=0&&okAt({x:R(c.x),y:R(c.y)}))return {x:R(c.x),y:R(c.y)};
  for(let d=Math.max(.5,min);d<=max;d+=.5)for(let k=0;k<16;k++){const ang=k*Math.PI/8,q={x:R(c.x+Math.cos(ang)*d),y:R(c.y+Math.sin(ang)*d)};if(okAt(q))return q}
  return null}
const nearestTown=p=>CITY.reduce((b,c)=>!b||dist(p,c.gate)<dist(p,b.gate)?c:b,null);
const nearTakes=()=>'near takes "fellowship", a member ('+fellows().map(a=>a.name).join(', ')+'), a hero, "x,y", a town ('+CITY.map(c=>c.name).join(', ')+'), a landmark ('+LANDMARKS.map(l=>l.name).join(', ')+')'+((S.places||[]).length?', a place ('+S.places.slice(0,8).map(p=>p.name).join(', ')+')':'')+' or a region ('+ZONES.join(', ')+')';
// near -> {town?, hero?, at?, label} or {err}. o.gap keeps a spot clear of other places (mark_place); o.min/o.max set
// how far from a hero or place the spot lies; o.townSpot asks a spot outside a town's gate as well.
function nearSpot(near,o={}){const nt=nearText(near);if(nt.err)return {err:nt.err};const s=clean(nt.s,60),lo=s.toLowerCase(),gap=o.gap||0,mn=o.min!=null?o.min:1,mx=o.max!=null?o.max:5;
  if(!s)return {err:'near is required'};
  const gateSpot=c=>o.townSpot?openSpot(c.gate,LK.TOWN_CLEAR+.5,LK.TOWN_CLEAR+6,gap):null;
  const fromHero=h=>{if(h.state==='town'||h.state==='dungeon'){const c=CITY.find(x=>x.name===h.town)||nearestTown(h);return {town:c.name,hero:h,label:'in '+c.name,at:gateSpot(c)}}
    const at=openSpot(h,mn,mx,gap);return at?{at,hero:h,label:'near '+h.name}:{err:'no open ground near '+h.name}};
  if(lo==='fellowship'||lo==='party'||lo==='the fellowship'){const fo=focus();if(!fo)return {err:'no Fellowship rides in this world'};
    const L=fo.members.filter(a=>a.state!=='town'&&!a.hidden),h=L.find(a=>a.x===fo.x&&a.y===fo.y)||L[0];
    if(h)return fromHero(h);const c=fo.town;return c?{town:c.name,label:'in '+c.name,at:gateSpot(c)}:{err:'the Fellowship has no town'}}
  const m=/^\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?$/.exec(s);
  if(m){const p={x:Number(m[1]),y:Number(m[2])},e=spotErr(p),at=openSpot(p,0,3,gap);return at?{at,label:(nt.from?'off '+nt.from+' ':'')+'at '+at.x+','+at.y}:{err:'no open ground at '+m[1]+','+m[2]+(e?' ('+e+')':'')+pointHint(s)}}
  const h=S.agents.find(a=>alive(a)&&!a.hidden&&(String(a.id)===s||a.name.toLowerCase()===lo));if(h)return fromHero(h);
  const c=townOf(s);if(c)return {town:c.name,label:'in '+c.name,at:gateSpot(c)};
  const pl=(S.places||[]).find(p=>(p.name||'').toLowerCase()===lo||String(p.id)===s);if(pl){const at=openSpot(pl,Math.max(mn,gap),mx+gap,gap);return at?{at,label:'near '+pl.name}:{err:'no open ground near '+pl.name}}
  const lm=LANDMARKS.find(l=>{const n=l.name.toLowerCase();return n===lo||n.replace(/^the /,'')===lo.replace(/^the /,'')});
  if(lm){const e=(lm.exclude||0)+1,at=openSpot(lm,e,e+5,gap);return at?{at,label:'near '+lm.name}:{err:'no open ground near '+lm.name}}
  const z=regionIdx(s);if(z!=null){const p=centreOf(z),at=p&&openSpot(p,0,8,gap);return at?{at,label:'in '+ZONES[z]}:{err:'no open ground in the middle of '+ZONES[z]}}
  return {err:'unknown place "'+s+'"'}}
const heroOf=v=>{const s=clean(v,40),lo=s.toLowerCase();return s?S.agents.find(a=>alive(a)&&(String(a.id)===s||a.name.toLowerCase()===lo))||null:null};
const placeOrPerson=v=>{const s=clean(v,60),lo=s.toLowerCase();if(!s)return null;
  return (S.places||[]).find(p=>String(p.id)===s||(p.name||'').toLowerCase()===lo)||peopleAll().find(n=>String(n.id)===s||n.name.toLowerCase()===lo||((n.title?n.title+' ':'')+n.name).toLowerCase()===lo)||null};
function flatLever(tool,a){a=a&&typeof a==='object'?a:{};const lever=FLAT_LEVERS[tool],usage=FLAT_USAGE[tool],reason=clean(a.reason,DMA.REASON_MAX),via={tool,usage};
  const no=(why,params)=>leverRefuse(lever,why,usage+'. The lever: '+leverUsage(lever),reason,params||{},via);
  const opt=(k,v)=>v==null||v===''?{}:{[k]:v},str=(v,n)=>typeof v==='string'?clean(v,n)||undefined:v;
  const int=v=>v==null||v===''?undefined:Number.isFinite(Number(v))?Math.round(Number(v)):v;
  let params;
  if(tool==='post_hook'){const t=clean(a.town,40);if(!t)return no('town is required (post_hook needs a town board: a town, or "fellowship", a member or a region for the nearest board)');
    let town=townOf(t);if(!town){const W=nearSpot(t);if(W.err)return no('town: '+W.err+'; '+nearTakes().replace(/^near/,'town'));town=W.town?townOf(W.town):nearestTown(W.at)}
    let target;if(a.place!=null&&a.place!==''){const q=placeOrPerson(a.place);if(!q)return no('place: no place or person called "'+clean(a.place,40)+'" (see npcs and regions)');target=q.id}
    let forHero;if(a.for!=null&&a.for!==''){const h=heroOf(a.for);if(!h)return no('for: no living hero called "'+clean(a.for,40)+'"');forHero=h.id}
    params={town:town.name,tpl:str(a.tpl,20),...opt('giver',str(a.giver,20)),...opt('reward',str(a.reward,12)),...opt('region',str(a.region,40)),...opt('target',target),...opt('forHero',forHero)}}
  else if(tool==='give_item'||tool==='take_item'){const h=heroOf(a.hero);if(!h)return no('hero: no living hero called "'+clean(a.hero,40)+'" (see heroes_near)');
    let by;if(a.by!=null&&a.by!==''){const q=personOf(a.by);if(!q)return no('by: no person called "'+clean(a.by,40)+'" (see npcs)');by=q.id}
    params={hero:h.id,item:str(a.item,40),...opt('by',by),...(tool==='give_item'?opt('ilvl',int(a.ilvl)):{})}}
  else if(tool==='place_person'){const W=nearSpot(a.near,{min:2,max:5});if(W.err)return no(W.err+' (create_npc needs town for a town home, or at: a point {x,y} for a camp); '+nearTakes());
    const base={role:str(a.role,20),...opt('name',str(a.name,24)),...opt('faction',str(a.faction,12)),...opt('attitude',str(a.attitude,12)),...opt('hours',int(a.hours))};
    params=W.town?{...base,home:'town',town:W.town,...opt('spot',str(a.spot,16))}:{...base,home:'camp',at:W.at}}
  else {const W=nearSpot(a.near,{min:1,max:5,gap:LK.PLACE_GAP,townSpot:true});
    if(W.err||!W.at)return no((W.err||'no open ground outside '+W.town+'’s gate')+' (mark_place needs at: a point {x,y} on open ground, '+LK.PLACE_GAP+' tiles from other places); '+nearTakes());
    params={kind:str(a.kind,16),at:W.at,...opt('name',str(a.name,32)),...opt('hours',int(a.hours))}}
  const want=tool==='place_person'?clean(a.want,STAGE.WANT_MAX||160):'';
  if(want)via.after=r=>{if(r.ret)r.ret.want=want}; // what they want from heroes, read by conversations (talk.js), as a staged meeting sets it
  const r=pullLever({lever,params,reason},via);if(!r.ok)return r;
  const e=r.effect||{};
  return {...r,tool,...(tool==='mark_place'?{place:e.name,at:params.at}:{}),...(tool==='place_person'?{person:e.name,npc:e.npc,at:e.at,where:e.where}:{}),...(want?{want}:{})}}

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
// ---- whisper and dream (#523): a secret for one hero ----
// whisper: a line only that hero hears (its chat buffer, so chat_read and a soft event), in an open Table scene or within
// WHISPER_R tiles of the person (as) the DM placed. The table sees only that someone leans close, never the words.
// dream: kept until the hero next sleeps (a camp, or a rest in town) and delivered when it wakes, as "You dream: ...".
// The words show in the watcher's Chat tab; the DM log names the hero, not the text.
function whisper(a){const day=today(),t=clean(a.text,DMA.NARRATE_MAX);if(!t)return {ok:false,error:'Whisper what? whisper takes hero (name or id), text, and as (the person who whispers, optional).'};
  const h=heroOf(a.hero);if(!h)return {ok:false,error:'hero: no living hero called "'+clean(a.hero,40)+'" (see heroes_near or fellowship_view).'};
  if(h.hidden)return {ok:false,error:h.name+" is out of anyone's reach."};
  if((day.wh||0)>=DMA.WHISPER_PER_DAY)return {ok:false,error:'Enough whispers for one game day ('+DMA.WHISPER_PER_DAY+').'};
  const inScene=!!(S.table&&S.table.ids.includes(h.id));let p=null;
  if(a.as!=null&&a.as!==''){p=personOf(a.as);if(!p)return nobody(a.as);
    if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||dist(h,p)>DMA.WHISPER_R&&!inScene)return {ok:false,error:h.name+' is too far from '+p.name+' to be whispered to (within '+DMA.WHISPER_R+' tiles, or in the Table scene).'}}
  else if(!inScene)return {ok:false,error:h.name+' is not in an open Table scene: name the person who whispers (as), and have the hero within '+DMA.WHISPER_R+' tiles of them.'};
  const e={t:clockStr(),d:dayNo(),from:p?{kind:'npc',id:p.id,name:p.name,fac:p.fac}:NARRATOR,text:'(whispered) '+t,trigger:p?'npc':'dm',dm:true,whisper:true};hearLine(h,e);
  if(inScene)S.table.narr={t:e.t,text:(p?(p.title&&!p.wander?p.title+' ':'')+p.name:'Someone')+' leans close to '+h.name+'.'}; // the fact of it, not the words
  day.wh=(day.wh||0)+1;
  dmlog('agent',null,['Whisper to '+h.name+' (DM agent)'],{by:'dm-agent',voice:'whisper',hero:h.id,npc:p?p.id:undefined});
  return {ok:true,whispered_to:h.name,as:p?p.name:'the narrator',note:'Only '+h.name+' heard it; the table sees that someone leans close.'}}
function dream(a){const day=today(),t=clean(a.text,DMA.NARRATE_MAX);if(!t)return {ok:false,error:'Dream what? dream takes hero (name or id) and text.'};
  const h=heroOf(a.hero);if(!h)return {ok:false,error:'hero: no living hero called "'+clean(a.hero,40)+'".'};
  if(!h.player)return {ok:false,error:h.name+" is not agent-played: only agent heroes dream a DM's dream."};
  if((day.dr||0)>=DMA.DREAM_PER_DAY)return {ok:false,error:'Enough dreams for one game day ('+DMA.DREAM_PER_DAY+').'};
  const D=dmState(),L=D.dreams||(D.dreams=[]);if(L.filter(x=>x.hero===h.id).length>=3)return {ok:false,error:h.name+' already has dreams waiting.'};
  L.push({hero:h.id,text:t,day:dayNo(),slept:false});day.dr=(day.dr||0)+1;
  dmlog('agent',null,['Dream for '+h.name+' (DM agent), when they next sleep'],{by:'dm-agent',voice:'dream',hero:h.id});
  return {ok:true,dream_for:h.name,note:'Delivered when '+h.name+' wakes from camp or an inn rest.'}}
const sleeping=h=>h.state==='camp'||h.state==='town'&&Array.isArray(h.pq)&&!!h.pq[0]&&h.pq[0].kind==='rest';
export function dreamTick(){const D=S.dmAgent,L=D&&D.dreams;if(!L||!L.length)return;
  for(let i=L.length-1;i>=0;i--){const d=L[i],h=byIdA(d.hero);
    if(!h||!alive(h)){L.splice(i,1);continue}
    if(sleeping(h)){d.slept=true;continue}
    if(!d.slept)continue;
    hearLine(h,{t:clockStr(),d:dayNo(),from:NARRATOR,text:'You dream: '+d.text,trigger:'dm',dm:true,dream:true});
    try{moment(h,'dream','a dream')}catch(e){}
    L.splice(i,1)}}
// A person by id or name (townsfolk or a DM-placed person).
// Names match ignoring case, spaces and punctuation too ("EdrinPask" is Edrin Pask, issue #401).
const squeeze=s=>String(s==null?'':s).toLowerCase().replace(/[^a-z0-9]+/g,'');
const peopleAll=()=>{ensureNpcs();return [...(S.npcs||[]),...(S.wanderers||[])]};
function personOf(v){const k=clean(v,60).toLowerCase(),q=squeeze(k),all=peopleAll();if(!k)return null;
  return all.find(n=>String(n.id).toLowerCase()===k)||all.find(n=>String(n.name||'').toLowerCase()===k||((n.title||'')+' '+n.name).toLowerCase()===k)
    ||(q?all.find(n=>squeeze(n.name)===q||squeeze((n.title||'')+n.name)===q):null)||null}
// The person a call means: npc, else the person of the conversation conv (an answer may name only the conversation).
function personFor(a){const p=personOf(a.npc);if(p||clean(a.npc,60))return p;
  if(a.conv==null||a.conv==='')return null;const c=convById(a.conv);return c?peopleAll().find(n=>n.id===c.npc)||null:null}
// "Nobody called X" with the closest names, so the next call can be right.
function edits(x,y){if(x===y)return 0;const m=x.length,n=y.length;if(!m||!n)return m||n;let prev=Array.from({length:n+1},(_,j)=>j);
  for(let i=1;i<=m;i++){const cur=[i];for(let j=1;j<=n;j++)cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(x[i-1]===y[j-1]?0:1));prev=cur}return prev[n]}
function nobody(v){const q=squeeze(v),all=peopleAll(),nm=n=>(n.title?n.title+' ':'')+n.name;
  if(!clean(v,40))return {ok:false,error:'npc is required: the person\'s id or name from npcs (when answering a conversation, conv alone is enough).'};
  const near=q?all.map(n=>({n,d:Math.min(edits(q,squeeze(n.name)),edits(q,squeeze(nm(n))),squeeze(n.name).includes(q)||q.includes(squeeze(n.name))?1:99)})).sort((x,y)=>x.d-y.d).slice(0,3).filter(x=>x.d<=Math.max(3,q.length/2)):[];
  return {ok:false,error:'Nobody called "'+clean(v,40)+'".'+(near.length?' Did you mean '+near.map(x=>nm(x.n)+' (id '+x.n.id+')').join(', ')+'?':'')+' npc takes a person\'s id or name from npcs.',...(near.length?{did_you_mean:near.map(x=>({id:x.n.id,name:nm(x.n)}))}:{})}}
// npc_say as the answer in a conversation (#170): with conv, or to a person whose conversation waits for the DM.
function convAnswer(a){const p=personOf(a.npc);if(!p)return null;
  const c=a.conv!=null&&a.conv!==''?convById(a.conv):convWith(p);
  if(a.conv!=null&&a.conv!==''&&(!c||c.npc!==p.id))return {ok:false,error:'No open conversation '+clean(a.conv,12)+' with '+p.name+' (see npc_call or dm_status conversations).'};
  if(!c||!(c.wait||a.conv!=null&&a.conv!==''))return null;
  return dmAnswer(c,p,a.text,{warmth:a.warmth,remember:a.remember})}
// npc_offer (#170): one follow-up of a conversation.
function npcOffer(a){const p=personFor(a);if(!p)return nobody(a.npc);
  const c=a.conv!=null&&a.conv!==''?convById(a.conv):convWith(p);if(!c||c.npc!==p.id)return {ok:false,error:'No open conversation with '+p.name+': a follow-up belongs to a conversation a member started.'};
  const kind=clean(a.kind,12).toLowerCase();
  if(c.wait&&!legalOffers(c,p).includes(kind))return npcOfferApply(c,p,kind,a,'dm-agent'); // refused before the line is spoken (it says why)
  let said=null;if(c.wait&&clean(a.text,CONV.DM_LINE_MAX)){said=dmAnswer(c,p,a.text,{});if(!said.ok)return said}
  const r=npcOfferApply(c,p,kind,a,'dm-agent');
  if(r.ok){const w=Number(a.warmth);if(Number.isFinite(w)&&w)warm(p,Math.max(-3,Math.min(3,Math.round(w))),'the DM: '+kind)}
  return said?{...r,said:said.ok}:r}
function npcSay(a){const p0=personFor(a);if(p0)a={...a,npc:String(p0.id)};const cv=convAnswer(a);if(cv)return cv;
  const day=today(),t=clean(a.text,DMA.NPC_SAY_MAX);if(!t)return {ok:false,error:'Say what? npc_say takes npc (id or name from npcs), text (the line), and conv when answering a conversation.'};
  if((day.npc||0)>=DMA.NPC_SAY_PER_DAY)return {ok:false,error:'Enough lines for the townsfolk for one game day ('+DMA.NPC_SAY_PER_DAY+').'};
  const p=p0;
  if(!p)return nobody(a.npc);
  if(!Number.isFinite(p.x)||!Number.isFinite(p.y))return {ok:false,error:p.name+' is nowhere the heroes could hear them.'};
  const e={t:clockStr(),d:dayNo(),from:{kind:'npc',id:p.id,name:p.name,fac:p.fac},text:t,trigger:'npc'};
  const hs=S.agents.filter(b=>alive(b)&&!b.hidden&&dist(b,p)<=HEAR);if(S.fellowship&&hs.some(b=>b.fellow))e.fh=true;for(const b of hs)hearLine(b,e);
  p.bubble={text:t,life:BUBBLE};if(e.fh)p.bubble.fh=true;day.npc=(day.npc||0)+1;
  dmlog('agent',null,[(p.title?p.title+' ':'')+p.name+' (DM agent): "',t,'"'],{by:'dm-agent',voice:'npc_say',npc:p.id,text:t,heard:hs.map(b=>b.id)});
  return {ok:true,who:(p.title?p.title+' ':'')+p.name,said:t,heard_by:hs.length,heroes:hs.slice(0,12).map(b=>b.name)}}

// The DM ends its prep (#437): the host lets the world run and the opening scene opens.
function prepDone(a){const t=clean(a&&a.summary,DMA.INTENT_MAX);if(!prepActive())return {ok:true,prep:prepView(),note:'No prep is running; nothing to end.'};
  const v0=prepView();endPrep('done');dmlog('agent',null,['DM prep done ('+v0.kind+', '+v0.calls+' calls, '+v0.seconds+' s)'+(t?': '+t:'.')],{by:'dm-agent',prep:v0.kind,calls:v0.calls,seconds:v0.seconds,text:t||null},{heroes:[]});
  return {ok:true,prep:prepView(),note:'The table opens now.'}}
const BY_NAME=new Map(DM_TOOLS.map(t=>[t.name,t]));
// A tool name that is not a DM tool (issue #401): a lever name called as a tool (post_hook, mark_place, create_npc,
// or create_npc_placeholder) is pointed at pull_lever with that lever's contract; anything else lists the tools.
const flatOf=lv=>Object.keys(FLAT_LEVERS).find(t=>FLAT_LEVERS[t]===lv)||null;
export function unknownTool(tool){const s=String(tool==null?'':tool).slice(0,40),lo=s.toLowerCase();
  const lv=LEVERS[lo]?lo:Object.keys(LEVERS).filter(n=>lo.includes(n)).sort((x,y)=>y.length-x.length)[0];
  if(lv&&leverNames().includes(lv))return {ok:false,error:'"'+s+'" is not a tool'+(lv===lo?'':'; it looks like the lever '+lv)+'. Levers are pulled through pull_lever: pull_lever {"lever":"'+lv+'","params":{...},"reason":"one sentence"}. '+leverUsage(lv)+'.'+(flatOf(lv)?' Or call '+flatOf(lv)+' (flat arguments): '+FLAT_USAGE[flatOf(lv)]+'.':''),hint:'pull_lever',lever:lv,usage:leverUsage(lv)};
  return {ok:false,error:'Unknown DM tool "'+s+'". Tools: '+DM_TOOLS.map(t=>t.name).join(', ')+'. World levers ('+leverNames().join(', ')+') go through pull_lever.'}}
// One DM tool call: validated, answered, never thrown. The seat must be open.
export function dmAct(tool,args={}){
  if(tool==='turn_end'){if(!dmSeatOn())return {ok:false,error:'The DM seat is closed.',offline:true};return turnEnd(args)} // the relay's report of a finished turn, not a tool of the agent's
  const t=BY_NAME.get(tool);if(!t)return unknownTool(tool);
  if(!dmSeatOn())return {ok:false,error:'The DM seat is closed. Open it in the game (Dungeon Master panel: "DM agent") or start the headless world with --dm.',offline:true};
  args=args&&typeof args==='object'?args:{};let r;dmHeard(tool,args);
  const prepping=prepActive();prepCall(tool); // a call during the prep counts toward its cap (#437); the cap ends it // a DM present: conversations wait for it a little (#170)
  try{switch(tool){
    case 'dm_status':r=status();break;
    case 'read_timeline':r=timelineRead(args.n);break;
    case 'read_chronicle':r=chronicleRead(args.n);break;
    case 'read_dm_log':r=dmLogRead(args.n,args.kind);break;
    case 'fellowship_view':r=fellowshipView();break;
    case 'companies_view':r=companiesView();break;
    case 'heroes_near':r=heroesNear(args.near,args.radius);break;
    case 'npcs':r=npcsRead(args.town,args.region);break;
    case 'regions':r=regionsRead();break;
    case 'hooks':r=hooksRead(args.town,args.region);break;
    case 'levers':r=leversRead();break;
    case 'notes_read':r=notesRead(args.section);break;
    case 'notes_write':r=notesWrite(args);break;
    case 'pull_lever':r=pullLever(args);break;
    case 'post_hook':case 'place_person':case 'mark_place':case 'give_item':case 'take_item':r=flatLever(tool,args);break;
    case 'log_intent':r=logIntent(args.text);break;
    case 'remember':case 'recall':case 'update_memory':case 'forget':case 'pin':r=dmMemory(tool,args);break;
    case 'narrate':r=narrate(args);break;
    case 'npc_say':r=npcSay(args);break;
    case 'whisper':r=whisper(args);break;
    case 'dream':r=dream(args);break;
    case 'npc_call':r=npcCall();break;
    case 'npc_offer':r=npcOffer(args);break;
    case 'stage_scene':r=stageScene(args);break;
    case 'table_call':r=sceneCall()||tableCall();break;
    case 'table_answer':r=sceneAnswer(args)||tableAnswer(args);break;
    case 'prep_done':r=prepDone(args);break;
  }}catch(e){r={ok:false,error:'The DM tool failed: '+String(e&&e.message||e).slice(0,160)}}
  if(!r)r={ok:false,error:'no answer'};
  if(prepping&&!prepActive()&&tool!=='prep_done'&&r&&typeof r==='object')r={...r,prep:'Your prep is over (its '+(prepView().why==='calls'?'calls':'time')+' ran out): the table opens now. End this turn.'};
  if(!((tool==='table_call'||tool==='npc_call')&&r.ok&&!r.call)){remember(tool,args,r.ok!==false);try{recordTurn(tool,args,r)}catch(e){}} // an idle poll of the table is not a call worth keeping
  return r}
