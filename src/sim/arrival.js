// Arrival and opening scenes (issues #452 and #437; epic #402 slice 15, owner decisions on PR #406 and #437). Owned by
// ai-designer; the DM's calls are answered by the DM runner's table voice (scripts/dm-agent.mjs, brain-builder). DOM-free.
//
// One mechanism, two scenes, both played at the Table "everyone at once" (PLAY 'all' in sim/table.js):
//   opening   session zero. A new world (a setup world, or play-headless --session-zero) opens one scene per company once
//             the start gate is ready and the DM has prepared (sim/prep.js): the DM frames it (a table_call with the
//             campaign's premise and opening beats, DM-only; the scripted DM frames it from the hall, the oaths, the day
//             and the first board job), the members introduce themselves (a silent agent's reflex shows its persona line),
//             the leader is confirmed or contested, and the first move (the hall's job, the gate captain's writ) is put to
//             them. Introductions at the opening count as met (sim/talk.js). A solo's opening is short: the gate captain
//             and a rumour; an heir's (below) adds the Chronicle's line about who fell. It waits for the whole company (#771): with
//             a member out of shouting range of the leader the opening holds (q.hold), tells them to walk there, and after
//             ARRIVE.GATHER_MIN opens with those present, the frame naming who is missing.
//   arrival   a fallen member's recruit. Owner decision 5: the recruit is seeded into the company as today (the fallen
//             member's class, SEED_BEHIND under the lowest living member) but arrives in a DM-narrated scene at the
//             company's next camp or town, never in the Crypt, a raid or a fight. The newcomer is made and seated when the
//             scene opens (so it never stands idle far away), placed at the camp's edge or the town gate, and voiced by the
//             DM (the DM agent's table voice when it holds the seat, the scripted DM otherwise); the members greet,
//             question, object or keep silent; the oath is sworn at the table (campaign 'recruit', memories). An objection
//             is spoken, not a veto. The recruit is agent-played from that moment and carries a.succeeds (the fallen
//             hero's id) so the runners give it the fallen member's runner settings.
//   heir      owner answer 2 on PR #406: when a solo dies, its heir starts at level 1 at home as a company of one, with a
//             short opening (the gate captain, a rumour, the Chronicle's line about who fell). No level seed.
//
// Determinism: all of it runs only in a world with a host that reports runner links (the page, play-headless; hasLinks in
// sim/runlink.js). npm run sim and the checks (no host) replace the fallen at once, exactly as before, and never open an
// opening scene, so the seeded hashes do not move. Flavour picks use a hash of ids, never the gameplay RNG.
//
// State (plain data, saved with the world):
//   S.opening  {queue:[{company, kind:'new'|'heir', fallen?, cause?, hold?:{since, away:[id], where}}]}  openings still to play; gone once all have
//   C.arrivals [{slot?, cls, fallen, name, lvl, since}]                   recruits waiting for the next camp or town
import {S,clockStr,dayNo,noOthers} from './state.js';
import {ZONES,REGIONS,zoneFor,zoneAt,dist} from '../world/map.js';
import {cryptOfHero} from './crypts.js';
import {standAt} from '../world/passable.js';
import {homeOf} from '../data/races.js';
import {FAC} from '../data/factions.js';
import {MOBS} from '../data/mobs.js';
import * as AD from '../data/adventures.js';
import {hash} from '../core/rng.js';
import {log} from './chronicle.js';
import {record,timeline} from './history.js';
import {dmlog} from './dmlog.js';
import {makeHero,seedLevel} from './heroes.js';
import {markPlayer} from './player.js';
import {notify} from './notify.js';
import {remember} from './memory.js';
import {bond} from './bonds.js';
import {tm} from '../data/traits.js';
import {CAP as CHAT_CAP,speak,agentLine} from './chat.js';
import {swornOf,threadOf,threadText,oathSaid,hushOath} from './oath.js'; // only what was sworn is told at the table (#800)
import {swearBlock,swearWord,takeOath,setAside} from './sworn.js';
import {hasLinks,runnerLink,agentLive} from './runlink.js';
import {prepActive} from './prep.js';
import {heard,tableLive,fillWhy,lateWhy} from './dmreflex.js'; // the DM's reflexes fill a call it leaves unanswered (#561)
import {TABLE,openScene,setSceneKind,tableOn,sceneFor,callSeen,callLeft} from './table.js';
import {findScene} from './scenes.js'; // one open scene per company (#518)
import {companies,companyById,companyOf,members,leaderOf,followed,campaign,joinCompany,soloFor,setCompanyDeathHook,roleOf,slotHeroes,slotParty,slotted,seatRecruit,setArrivalHook,lcRoleOf,placeWord} from './company.js';
import {inRange} from './reach.js';
import {jobBar,jobShort} from './jobbar.js';

export const ARRIVE={
  POLL_MS:5000,   // the table waits for the DM's voice only if its runner polled table_call this recently (as staged scenes)
  MISS_MAX:2,     // missed calls before the scripted DM fills the rest of the scene at once
  LINE_MAX:2000,  // a technical ceiling for the DM's lines
  WAIT_DAYS:4,    // a recruit waits this many game days for a camp or a town, then arrives wherever the company is (at once when nobody of the company is left)
  HEIR_WAIT:60,   // game minutes a solo's heir's opening waits for a runner to hold the heir (a new hero id), then plays without one
  GATHER_MIN:540, // game minutes session zero waits for members out of range (#771): PREP.MS of real time at 1x, then it opens with those present
};
const gd=t=>({t,c:'gd'}),nar=t=>({t,c:'nar'});
const byId=id=>S.agents.find(x=>x.id==id)||null;
const living=a=>!!a&&a.kind==='hero'&&a.state!=='dead';
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f<>{}]+/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const plain=ps=>(ps||[]).map(p=>typeof p==='string'?p:p&&p.kind==='hero'?p.name:p&&p.t||'').join('');
const low=s=>s?s.charAt(0).toLowerCase()+s.slice(1):s;
const names=L=>L.length<2?L.join(''):L.slice(0,-1).join(', ')+' and '+L[L.length-1];
const pickH=(seed,k,list)=>list[Math.floor(hash(seed|0,k,53)*list.length)%list.length];
const NARRATOR={kind:'dm',name:'The Narrator'};
const LIVE={connected:1,waiting:1};
const isFellowship=C=>!!C&&C===slotted();
const memOf=C=>!C?[]:isFellowship(C)?slotHeroes(slotted()):members(C).filter(a=>!a.hire); // a hire is never seated at a scene (#634)
const leadOf=C=>{if(!C)return null;if(isFellowship(C)){const P=slotParty(slotted());if(P&&living(P.leader))return P.leader;const L=slotHeroes(slotted());let b=L[0]||null;for(const x of L)if(x.lvl>b.lvl)b=x;return b}return leaderOf(C)||members(C)[0]||null};
const townOf=C=>{const ld=leadOf(C);return C&&C.hall?C.hall:ld?homeOf(ld).name:'town'};

// ---- what the company has before it: the hall's first job, the gate captain's writ, a rumour ----
function jobTitle(h){const T=AD.ADVENTURES[h.tpl]||{},th=h.data&&h.data.thing;return (h.title||T.name||h.tpl)+(th?': '+plain(Array.isArray(th)?th:[th]):'')}
function firstMoves(town,C){const hooks=(S.adventures||[]).filter(v=>v.phase==='open'&&v.town===town);
  // A company is offered what it can take (#1016): in a hosted world the first move is a job its lowest member's level meets, else the board is honest about it.
  const lo=C&&hasLinks()?Math.min(...memOf(C).map(a=>a.lvl)):null,fit=lo==null?hooks:hooks.filter(v=>jobShort(v,lo)==null);
  const job=fit.find(v=>v.ff)||fit[0]||null,far=!job&&lo!=null?hooks.find(v=>v.ff)||hooks[0]||null:null;
  const b=(S.bounties||[]).find(x=>x.town===town&&MOBS[x.type]&&(lo==null||(REGIONS[x.z]&&REGIONS[x.z].band&&REGIONS[x.z].band[0]<=lo+2)));
  const g=lo!=null?ZONES[zoneFor(lo)]:null;
  return {job:job?jobTitle(job):null,writ:b?b.need+' '+(MOBS[b.type].pl||MOBS[b.type].name)+' in '+(ZONES[b.z]||'the wilds'):null,
    ...(far?{beyond:{title:jobTitle(far),need:jobBar(far),lvl:lo,ground:g}}:{})}}
function rumourNear(a){let best=null,bd=1e9;for(const m of S.mobs||[]){if(!m.alive||!(m.elite||m.named))continue;const d=dist(a,m);if(d<bd){bd=d;best=m}}
  return best?(best.name||MOBS[best.type].name)+' is seen in '+(ZONES[zoneAt(best.x,best.y)]||'the wilds'):null}
// A member's introduction in their own words, from their persona (a silent agent's reflex shows this line).
function introLine(a){const P=a.persona||{},home=a.born||homeOf(a).name,own=!(a.goal&&a.goal.offered)||(P.by&&P.by.wants==='self'),w=P.wants&&own?low(String(P.wants)).replace(/[.!?]+$/,''):null; // a want seeded from an unsworn thread is not said for them (#800)
  return a.name+', a '+(a.cls||'hero').toLowerCase()+' of '+home+(w?', who wants '+w:'')}

// ---- the opening (session zero, #437) ----
// The first delve (#922, sim/prologue.js) registers here: a company with C.prologue plays session zero at a dungeon's mouth, not in the hall.
let PRO=null;export const setPrologueHook=h=>{PRO=h};
export const prologueStatus=()=>PRO?PRO.view():null;
export const openingDue=()=>!!(S.opening&&S.opening.queue&&S.opening.queue.some(q=>q.kind==='new'));
export const openingPending=()=>!!(S.opening&&S.opening.queue&&S.opening.queue.length);
// A new world plans one opening per company (sim/index.js init with a setup; play-headless --session-zero).
export function planOpening(){const CS=companies();if(!CS.length)return null;const f=followed();
  const ids=CS.map(C=>C.id).sort((x,y)=>(f&&x===f.id?-1:f&&y===f.id?1:x-y));
  S.opening={queue:ids.map(id=>({company:id,kind:'new'}))};return S.opening}
// Members the leader cannot shout to: the opening takes only those in range (present() in sim/table.js).
const farFrom=C=>{const ld=leadOf(C);return ld?memOf(C).filter(b=>b!==ld&&b.state!=='downed'&&!inRange(ld,b)):[]};
// Session zero waits for the whole company (#771). True when the opening may open: everyone in range, or the wait is up.
function gathered(q){const C=q.kind==='new'?companyById(q.company):null;if(!C||!tableOn())return true;
  const far=farFrom(C);if(!far.length){delete q.hold;return true}
  const ld=leadOf(C),town=townOf(C),inTown=ld.state==='town',where=inTown?town:ld.name;
  if(!q.hold){q.hold={since:Math.round(S.gameMin),away:[],where};const who=names(far.map(a=>a.name));
    log(gd(C.name||ld.name+'\'s company'),' holds its first table in ',gd(town),' for ',who,'.');
    for(const b of memOf(C))if(!far.includes(b))notify(b,'The first table waits for '+who+'; stay close, it opens when they reach you.',false)}
  for(const a of far)if(!q.hold.away.includes(a.id))notify(a,'Your company waits for you at '+where+' for its first table: walk there now ('+(inTown?'move_to '+town:'follow '+ld.name)+').',true,2);
  q.hold.away=far.map(a=>a.id);q.hold.where=where;
  return S.gameMin-q.hold.since>=ARRIVE.GATHER_MIN}
// The panels and the DM's status: who session zero waits for, or null.
export function openingWait(){const q=S.opening&&S.opening.queue&&S.opening.queue.find(x=>x.hold);if(!q)return null;const C=companyById(q.company);
  return {company:C&&C.name||null,where:q.hold.where,names:q.hold.away.map(byId).filter(living).map(a=>a.name),minutes_left:Math.max(0,Math.round(ARRIVE.GATHER_MIN-(S.gameMin-q.hold.since)))}}
function openingFrame(C,q){const L=memOf(C),ld=leadOf(C),town=townOf(C),d=Math.floor(S.gameMin/1440)+1,{job,writ}=firstMoves(town,C);
  if(L.length===1){const a=L[0],r=rumourNear(a);
    const head=q.kind==='heir'?[a,' comes to ',gd(town),', sent for after ',gd(q.fallen||'one who fell'),' fell'+(q.cause?' ('+q.cause+')':'')+'. ']:[a,' stands at the gate of ',gd(town),' on day '+d+'. '];
    return [...head,'The gate captain has '+(writ?'a writ: '+writ:'nothing posted yet')+'.',r?' In the inn they say '+r+'.':'']}
  const oaths=L.filter(swornOf).map(a=>oathSaid(a));
  const far=farFrom(C),here=L.filter(a=>!far.includes(a));
  if(C.prologue&&PRO)return PRO.frame(C,here,ld,oaths);
  return [gd(C.name||'The company'),' sits at one table in '+town+' for the first time, day '+d+': '+names(here.map(a=>a.name))+'. ',far.length?names(far.map(a=>a.name))+(far.length>1?' have':' has')+' not reached the table. ':'',ld?ld.name+' has the head of the table. ':'',
    oaths.length?oaths.join('; ')+'. ':'','On the board by the door: '+(job||'nothing yet')+(writ?'; the gate captain\'s writ: '+writ:'')+'.']}
function openOpening(q){const C=companyById(q.company),L=memOf(C);if(!C||!L.length)return null;const ld=leadOf(C),town=townOf(C),solo=L.length===1;
  if(q.kind==='heir')log(nar(''),'The Chronicle remembers ',gd(q.fallen||'one who fell'),(q.cause?', '+q.cause:'')+'. In '+town+', ',L[0],' takes up the road.');
  const title='SESSION ZERO · '+(solo?L[0].name:C.name||ld.name+'\'s company');
  const ctx={opening:q.kind,lead:ld?ld.id:null,town,anchor:ld?ld.id:null,solo:solo?1:0,setting:C.prologue?'field':'tavern',...(C.prologue?{prologue:1}:{}),...(q.fallen?{fallen:q.fallen}:{}),...firstMoves(town,C)};
  const frame=openingFrame(C,q);
  if(!tableOn())return settleOpening(C,ctx,[],title);
  const far=farFrom(C),sc=openScene('opening',title,frame,ctx,C);
  for(const b of far)notify(b,'Your company sat down in '+town+' without you. Ask them what was said when you reach them.',false);
  if(!sc)return settleOpening(C,ctx,[],title); // nobody of theirs has the say: the line for the record, no scene
  return sc}
function optsOpening(sc,a){const c=sc.ctx,ld=byId(c.lead);
  if(c.solo)return [{k:'introduce',text:'Say who you are and what you came for'},{k:'listen',text:'Hear the gate captain out first'}];
  if(ld===a)return [{k:'introduce',text:c.prologue?'Introduce yourself and go in front':'Introduce yourself and take the head of the table'},{k:'yield',text:'Introduce yourself and offer the lead to whoever wants it'}];
  return [{k:'introduce',text:'Introduce yourself'+(ld?'; '+ld.name+' leads':'')},{k:'lead',text:'Introduce yourself and offer to lead instead'+(ld?' of '+ld.name:'')}]}
function reflexOpening(sc,a){const c=sc.ctx;if(c.solo)return 'listen';const ld=byId(c.lead);if(ld===a)return 'introduce';
  return tm(a,'bold')>1.2&&ld&&a.lvl>ld.lvl?'lead':'introduce'}
function applyOpening(sc,a,act){const k=act.k,c=sc.ctx,sw=act.swear?swearAt(sc,a,act.swear):'';
  if(k==='introduce'){const t=introLine(a);if(act.by!=='agent'&&a.player)return 'introduces themself: '+t;return 'introduces themself'+sw}
  if(k==='lead')return 'offers to lead'+sw;
  if(k==='yield')return 'offers the lead'+sw;
  if(k==='listen')return (c.writ?'hears the writ: '+c.writ:'hears the gate captain out')+sw;
  return null}
// The hero's own answer to its past (#800): sworn aloud before those at the table, or set aside in silence.
function swearAt(sc,a,raw){const w=swearWord(raw);if(swearBlock(a,w))return '';if(w==='no'){setAside(a);return ''}
  const t=w==='yes'?a.goal.text:w;agentLine(a,speak(a,(/swear/i.test(t)?t:'I swear it: '+t).slice(0,240),'agent'));
  const g=takeOath(a,w,{by:'table',hearers:sc.ids.map(byId).filter(b=>living(b)&&b!==a)});return ' and swears: "'+g.text+'"'}
// What the first table asks of this hero alone (tableView): its thread, and that nothing binds it.
function viewOpening(sc,a){if(sc.acts[a.id]||swornOf(a))return {};const t=threadText(a);
  return {swear:'You may swear your own oath as you act (swear: your words; "yes" takes up what your past holds, "no" sets it aside). Say nothing of it and you are bound to nothing.',...(t?{your_past:t}:{})}}
// The first move in words, and the leader told it (at the first table, or at the hall gate after a first delve, #922).
const firstLine=m=>m.beyond&&!m.job?'The hall\'s job ('+m.beyond.title+') asks for level '+m.beyond.need+' and the company is level '+m.beyond.lvl+': the job-giver would turn you away, so do not put it to the table yet. '+(m.writ?'Before them instead: the gate captain\'s writ ('+m.writ+'). ':'')+'Grow first'+(m.beyond.ground?': hunt '+m.beyond.ground+' together':'')+', and take the job at level '+m.beyond.need+'.':m.job||m.writ?'Before them: '+[m.job?'the hall\'s job ('+m.job+')':null,m.writ?'the gate captain\'s writ ('+m.writ+')':null].filter(Boolean).join(' and ')+'.':'The board is bare; the road is theirs to choose.';
export const firstMove=(town,C)=>({first:firstLine(firstMoves(town,C))});
export function tellFirstMove(ld,first,many){if(ld&&ld.player)notify(ld,'The first move is yours to put to them: '+first+(many?' Propose it (propose, kind job) or name another road.':' Take it up (quests, take_quest) or choose your own road.'),true,2)}
export const openingLead=leadOf;
// The outcome: met, the leader, the first move. beats: the table's acts (none when no scene could open).
function settleOpening(C,ctx,beats,title){const L=memOf(C),ids=beats.length?beats.map(b=>b.id):L.map(a=>a.id),here=ids.map(byId).filter(living);
  for(const a of here)for(const b of here)if(a!==b)(a.talkHeard||(a.talkHeard={}))[b.id]=1; // introductions at the opening count as met (sim/talk.js)
  let ld=byId(ctx.lead),tail='';
  if(!ctx.solo&&here.length>1){const yielded=beats.some(b=>b.id===ctx.lead&&b.k==='yield'),want=beats.filter(b=>b.k==='lead').map(b=>byId(b.id)).filter(living);
    if(yielded&&want.length){let nl=want[0];for(const x of want)if(x.lvl>nl.lvl)nl=x;const P=isFellowship(C)?slotParty(slotted()):(S.parties||[]).find(p=>p.company===C.id);
      if(P&&P.mem.includes(nl))P.leader=nl;tail=(ld?ld.name+' offers the lead and ':'')+nl.name+' takes it.';ld=nl}
    else if(want.length)tail=names(want.map(b=>b.name))+' offered to lead; '+(ld?ld.name:'the leader')+' keeps the head of the table.';
    else tail=(ld?ld.name+' leads, and no one says otherwise.':'')}
  const pro=C.prologue&&PRO?PRO:null,first=pro?pro.ahead(C):firstLine(ctx);
  const out=(here.length>1?'Introductions are made. ':'')+tail+' '+first;
  campaign(C,'session',gd(title),': '+out.trim());
  log(nar(''),gd(C.name||(here[0]||{}).name||'A company'),pro?' meets for the first time at the mouth of '+pro.where(C)+'.':here.length>1?' sits down together for the first time in '+ctx.town+'.':' sets out from '+ctx.town+'.');
  for(const a of here)remember(a,'table',(pro?'Session zero at '+pro.where(C)+': we met at its mouth, '+names(here.map(b=>b.name))+'. '+(ld?ld.name+' leads.':''):here.length>1?'Session zero in '+ctx.town+': we sat at one table, '+names(here.map(b=>b.name))+'. '+(ld?ld.name+' leads.':''):'Day one in '+ctx.town+'.')+' '+first);
  if(pro)pro.introduced(C);else tellFirstMove(ld,first,here.length>1);
  return out.trim()}

// ---- the arrival (#452) ----
// A death refills the seat through an arrival scene, in a world with runners. Returns true when it queued one.
function hosted(){return hasLinks()}
function reserve(fac,cls){const i=(S.recruits||[]).findIndex(r=>r.fac===fac&&r.cls===cls);if(i>=0)S.recruits.splice(i,1)} // the step's background recruit is this one
function queueArrival(C,q){if(!q.cls)return false;reserve(C.fac,q.cls);(C.arrivals||(C.arrivals=[])).push({...q,since:Math.round(S.gameMin)});
  for(const b of memOf(C))if(b.player)notify(b,'Word goes back to '+townOf(C)+': '+q.name+'\'s place will be filled. The newcomer will meet you at your next camp or in town.',false);return true}
setArrivalHook((F,q)=>hosted()?queueArrival(F,q):false);
// Any other company: an agent member's seat is refilled the same way; a solo's heir starts at home (owner answer 2).
// In a world with no others (#780) no recruit comes behind them: the last of a company always leaves an heir, host or no host.
// A company that falls to the last leaves one heir: the seats still waiting go to the heir's company, and whoever fell in the same tick waits there too, so no seat and no reserved recruit is lost with it.
setCompanyDeathHook((C,a)=>{const none=noOthers();if(!(hosted()||none)||!a||!a.player)return;
  const rest=C.ids.map(byId).filter(x=>living(x)&&x!==a);
  if(rest.length){if(hosted())queueArrival(C,{cls:a.cls,fallen:a.id,name:a.name,lvl:a.lvl});return}
  const had=companyById(C.heirCo);if(had){queueArrival(had,{cls:a.cls,fallen:a.id,name:a.name,lvl:a.lvl});return}
  if(!none&&C.ids.length<2&&!(C.arrivals&&C.arrivals.length)&&!LIVE[runnerLink(a)])return; // a solo nobody was playing leaves no heir behind (its replacement is the world's usual recruit)
  reserve(a.fac,a.cls);const h=hushOath(()=>makeHero(a.fac,a.cls,null,1));h.succeeds=a.id;markPlayer(h,true);const N=soloFor(h);
  if(N){C.heirCo=N.id;if(C.arrivals){N.arrivals=C.arrivals;delete C.arrivals}}
  if(N&&C.letters){N.letters={};for(const k in C.letters){const l=C.letters[k];if(l&&l.from===a.id)N.letters[k]={...l}}}
  if(N)(S.opening||(S.opening={queue:[]})).queue.push({company:N.id,kind:'heir',fallen:a.name,cause:a.cause||null,since:Math.round(S.gameMin)})});
// An heir's opening waits (up to HEIR_WAIT) until a runner holds the new hero, so the scene is its agent's and not settled
// unseen the moment it is made; a session-zero opening has the start gate for that (ui/rungate.js).
function heirReady(q){if(q.kind!=='heir')return true;const C=companyById(q.company),h=C&&members(C)[0];
  return !h||agentLive(h)||S.gameMin-(q.since||0)>=ARRIVE.HEIR_WAIT}
// Settled: out of the Crypt, a raid and every fight, and at a camp or in town.
function settled(C){const L=memOf(C);if(!L.length)return false;
  if(L.some(cryptOfHero))return false;
  if(L.some(a=>['raid','dungeon','fight','duel','assist'].includes(a.state)||a.raid))return false;
  if(C.camp&&C.camp.phase&&L.some(a=>a.state==='camp'))return 'camp';
  const ld=leadOf(C);return ld&&ld.state==='town'?'town':false}
function makeRecruit(C,q){if(isFellowship(C))return seatRecruit(C,q);
  const L=members(C);if(!L.length||C.ids.length>=8)return null;
  const a=hushOath(()=>makeHero(C.fac,q.cls,null,1));seedLevel(a,Math.min(...L.map(b=>b.lvl))-2);
  if(!joinCompany(C,a).ok)return null;markPlayer(a,true);if(q.fallen!=null)a.succeeds=q.fallen;return a}
function place(C,a,where){const ld=leadOf(C)||a,town=isFellowship(C)?C.hall:ld.town||a.town;
  if(a.town&&a.town!==town){a.born=a.born||a.town;a.town=town} // home is where the company is (#771); their people's town stays in their origin text
  if(where==='road'){Object.assign(a,standAt(ld.x+1.2,ld.y+.9));a.zone=ld.zone;a.state='hunt';a.dest=null;a.moving=false;return ld.name+'\'s side'} // the wait ran out in the field: they come to the company, not to an empty gate
  if(where==='camp'){const g=C.camp;Object.assign(a,standAt(g.x+1.2,g.y+.9));a.state='camp';a.camp=g.ids.length;a.dest=null;a.moving=false;if(!g.ids.includes(a.id))g.ids.push(a.id);return 'the camp\'s edge'}
  const c=homeOf(ld),gt=c.gate||c.qg;if(gt){a.x=gt.x;a.y=gt.y}a.state='town';a.townStep=1;return 'the gate of '+c.name}
function openArrival(C,q,where){const lead=leadOf(C);if(where==='town'&&lead&&lead.state!=='town')where='road';
  const a=makeRecruit(C,q);if(!a)return null;const at=place(C,a,where),ld=leadOf(C),role=placeWord(a.cls);
  if(!memOf(C).some(b=>b!==a))log(nar(''),gd(C.name||'The company'),' fell to the last. ',a,' is the first to answer the call to ',gd(townOf(C)),'.'); // nobody is left to greet them: the outcome below seats them, no scene
  const title='A newcomer: '+a.name;
  const frame=[a,', a level '+a.lvl+' '+a.cls.toLowerCase()+', comes to '+at+', sent to take ',gd(q.name),'\'s place as the company\'s '+role+'.'];
  const ctx={arrival:1,recruit:a.id,fallen:q.fallen,fname:q.name,role,slot:q.slot||null,skip:[a.id],anchor:ld?ld.id:null,at,...(where==='town'?{setting:'tavern',town:homeOf(leadOf(C)||a).name}:{})};
  for(const b of memOf(C))if(b!==a&&b.player)notify(b,a.name+' has come to take '+q.name+'\'s place.',false);
  if(!tableOn())return settleArrival(C,ctx,[]);
  const sc=openScene('arrival',title,frame,ctx,C);
  if(!sc)return settleArrival(C,ctx,[]);
  return sc}
function optsArrival(sc,a){const n=(byId(sc.ctx.recruit)||{}).name||'the newcomer';
  return [{k:'greet',text:'Greet '+n+' and make room at the table'},{k:'question',text:'Ask '+n+' who they are and why they came'},
    {k:'object',text:'Object: '+sc.ctx.fname+'\'s place is not so easily filled'},{k:'silent',text:'Say nothing; watch '+n}]}
function reflexArrival(sc,a){const f=byId(sc.ctx.fallen);if(a.cls==='Priest'||a.cls==='Wildspeaker')return 'greet';
  if(f&&f!==a&&bond(a,f)>=40)return 'silent';return tm(a,'bold')>1?'question':'greet'}
function applyArrival(sc,a,act){const n=(byId(sc.ctx.recruit)||{}).name||'the newcomer';
  return act.k==='greet'?'welcomes '+n:act.k==='question'?'asks '+n+' who they are':act.k==='object'?'speaks against filling '+sc.ctx.fname+'\'s place':null}
function settleArrival(C,ctx,beats){const a=byId(ctx.recruit);if(!a)return '';const L=memOf(C).filter(b=>b!==a);
  const obj=beats.filter(b=>b.k==='object').map(b=>b.name),q=beats.filter(b=>b.k==='question').map(b=>b.name);
  campaign(C,'recruit',a,' swears into ',gd(C.name||'the company'),' at the table as its '+ctx.role+', in ',gd(ctx.fname),'\'s place'+(obj.length?' ('+names(obj)+' spoke against it)':'')+'.');
  log(a,' swears the oath at the table and takes ',gd(ctx.fname),'\'s place in ',gd(C.name||'the company'),'.');
  timeline('oath',a,' joins ',gd(C.name||'the company'),' in ',gd(ctx.fname),'\'s place.');
  record(a,'Swore into ',gd(C.name||'the company'),' at the table, in '+ctx.fname+'\'s place.');
  remember(a,'join','Swore into '+(C.name||'the company')+' at the table as its '+ctx.role+', in '+ctx.fname+'\'s place. '+(L.length?names(L.map(b=>b.name))+' ride with me now.':'Nobody of the old company is left; what they were starts again with me.')+(obj.length?' '+names(obj)+' spoke against it.':''));
  for(const b of L)remember(b,'join',a.name+' swore in at the table, in '+ctx.fname+'\'s place'+(obj.includes(b.name)?'; I said my piece against it.':'.'));
  notify(a,'You have sworn into '+(C.name||'the company')+' at the table, in '+ctx.fname+'\'s place: '+(L.length?names(L.map(b=>b.name))+' ride with you now.':'nobody of the old company is left, and more are sent for.')+(q.length?' '+names(q)+' asked who you are.':''),true,2);
  return a.name+' swears the oath'+(obj.length?'; '+names(obj)+' spoke against it, and it stands':'')+'.'}

// ---- the scene kinds and the DM's calls ----
const live=sc=>tableLive(sc,ARRIVE.MISS_MAX,ARRIVE.POLL_MS); // the DM is listening (#561: no seat-closed path; silence = the reflex fill)
const push=(sc,c)=>{(sc.calls||(sc.calls=[])).push({id:sc.callSeq=(sc.callSeq||0)+1,t:0,done:false,by:null,...c})};
function say(sc,text,from){const t=clean(text,ARRIVE.LINE_MAX);if(!t)return;const e={t:clockStr(),d:dayNo(),from,text:t,scene:true,trigger:'dm',dm:true,fh:true};
  const ids=sc.ids.concat(sc.ctx&&sc.ctx.recruit!=null?[sc.ctx.recruit]:[]);
  for(const id of ids){const b=byId(id);if(!living(b))continue;(b.chat||(b.chat=[])).push(e);if(b.chat.length>CHAT_CAP)b.chat.shift()}
  sc.narr={t:e.t,text:t}}
// What the campaign file's notes of one tag say (#922: the Prologue section), DM-only.
export function campaignNotes(tag){const D=S.dmAgent,P=D&&D.notes&&D.notes.plans||[];return clean(P.filter(n=>(n.tags||[]).includes(tag)).map(n=>(n.title?n.title+': ':'')+n.text).join(' | '),600)}
function premise(){const D=S.dmAgent;if(!D||!D.notes)return '';const P=(D.notes.plans||[]);
  const pr=P.filter(n=>(n.tags||[]).includes('premise')).map(n=>(n.title?n.title+': ':'')+n.text),ob=P.filter(n=>(n.tags||[]).includes('openings')).map(n=>n.text);
  return (pr.length?' Your premise: '+clean(pr.join(' | '),900)+'.':'')+(ob.length?' Your opening beats: '+clean(ob.join(' | '),600)+'.':'')}
const castOf=sc=>{const a=byId(sc.ctx.recruit);return a?[a.name+' (newcomer, level '+a.lvl+' '+a.cls+(a.persona&&a.persona.voice?'; voice: '+a.persona.voice:'')+(a.persona&&a.persona.wants?'; wants: '+a.persona.wants:'')+')']:[]};
const DM_OPEN={
  onFrame(sc){const L=sc.ids.map(byId).filter(living);
    push(sc,{kind:'frame',ms:TABLE.frameMs,who:'the narrator',about:'Session zero: frame the opening of the campaign for '+(sc.ctx.solo?L.map(a=>a.name+' ('+a.cls+', alone)').join(''):L.map(a=>a.name+' ('+a.cls+')').join(', '))+' in '+sc.ctx.town+
      '. What the table already shows: '+plain(sc.frame)+premise()+(sc.ctx.prologue&&PRO?PRO.about(companyById(sc.company)||slotted()):'')+' Write what they see and hear as they sit down (or set out): one or two short paragraphs. Hint at the premise through what can be seen; reveal none of your secrets; decide nothing for them.'})},
  onAll(){},
  live,
  fill(sc,c){if(sc.ctx.prologue&&PRO){resolve(sc,c,{text:PRO.fillLine(companyById(sc.company)||slotted(),sc)+' '+plain(sc.frame),by:'scripted'});return}
    resolve(sc,c,{text:pickH(sc.id,1,['The fire is low and the room smells of rain and old wood.','Outside, the gate bell marks the hour; inside, a bench scrapes as someone makes room.','Lamps along the road outside burn low, one already dark.'])+' '+plain(sc.frame),by:'scripted'})},
  done(sc){sc.summaryDone=1},
};
const DM_ARRIVE={
  onFrame(sc){const a=byId(sc.ctx.recruit);if(!a)return;
    push(sc,{kind:'voice',ms:TABLE.frameMs,who:a.name,about:'Voice '+a.name+', a level '+a.lvl+' '+a.cls+' sent to take '+sc.ctx.fname+'\'s place as the company\'s '+sc.ctx.role+', as they reach '+sc.ctx.at+': what they say and how they come in, one or two lines'+(a.persona&&a.persona.voice?' (their voice: '+a.persona.voice+')':'')+'. They know '+sc.ctx.fname+' fell; they do not know the company.'})},
  onAll(sc){const a=byId(sc.ctx.recruit);if(!a||!sc.beats.length)return;
    push(sc,{kind:'oath',who:a.name,about:'Everyone answered at once: '+sc.beats.map(b=>b.name+' chose to '+low(b.text)+(b.line?' and said "'+b.line+'"':'')).join('; ')+'. Voice '+a.name+' answering them and swearing the company\'s oath at the table, one or two lines, true to what was said (an objection is spoken, not a veto).'})},
  live,
  fill(sc,c){const a=byId(sc.ctx.recruit),n=a?a.name:'The newcomer',w=a&&a.persona&&a.persona.wants?low(String(a.persona.wants)).replace(/[.!?]+$/,''):null;
    const text=c.kind==='voice'?n+' sets down a pack at '+sc.ctx.at+'. "I was sent for. I know whose place this was'+(w?', and I came because I want '+w:'')+'."'
      :n+' puts a hand flat on the table. "Where you ride, I ride. I will try to be worth '+sc.ctx.fname+'\'s place."';
    resolve(sc,c,{text,by:'scripted'})},
  done(){},
};
function resolve(sc,c,{text,by}){c.done=true;c.by=by;c.text=text||'';if(text)say(sc,text,NARRATOR);
  dmlog('agent',null,['At the table ('+sc.kind+', '+c.kind+'): ',text||'-',by==='scripted'?' [scripted fill'+(c.t>0?': '+lateWhy(c.seen):'')+']':''],{by,call:c.kind,scene:sc.kind,text,...(by==='scripted'?{fill:true,why:fillWhy(c),...(c.t>0?{late:lateWhy(c.seen)}:{})}:{})},{heroes:[]})}
setSceneKind('opening',{options:optsOpening,reflex:reflexOpening,apply:applyOpening,view:viewOpening,swear:(sc,a,raw)=>swearBlock(a,raw),outcome:sc=>settleOpening(companyById(sc.company)||slotted(),sc.ctx,sc.beats,sc.title),dm:DM_OPEN});
setSceneKind('arrival',{options:optsArrival,reflex:reflexArrival,apply:applyArrival,outcome:sc=>settleArrival(companyById(sc.company)||slotted(),sc.ctx,sc.beats),dm:DM_ARRIVE});

// ---- the DM's tools for these scenes (sim/dmagent.js hands table_call / table_answer here while one is at the table) ----
// Other kinds voiced the same way register here (#571: the fireside and the debrief, sim/fireside.js): onAnswer(sc, call, args)
// runs after the DM's answer (the fireside reads rounds from it).
const VOICED={opening:null,arrival:null};
export function voicedKind(k,onAnswer){VOICED[k]=typeof onAnswer==='function'?onAnswer:null}
// A scene of another kind the DM voices only sometimes (#922: a first delve's rooms, sim/prologue.js).
const ALSO=[];export const voicedScene=f=>{ALSO.push(f)};
export {push as pushCall,resolve as resolveCall,live as voiceLive,say as sayAtTable};
export const ourScene=()=>findScene(sc=>sc.kind in VOICED||ALSO.some(f=>f(sc))); // any company's (#518)
export function sceneCall(){heard('table');const sc=ourScene();if(!sc)return null;const c=(sc.calls||[]).find(x=>!x.done)||null;
  const out={ok:true,staged:null,scene:{title:sc.title,kind:sc.kind,frame:plain(sc.frame),order:sc.ids.map(byId).filter(Boolean).map(b=>b.name+' (L'+b.lvl+' '+b.cls+')'),
    so_far:sc.beats.map(b=>b.name+': '+b.text+(b.res?' ('+b.res+')':'')+(b.line?' "'+b.line+'"':'')),said:(sc.calls||[]).filter(x=>x.done&&x.text).slice(-4).map(x=>x.text),cast:sc.kind==='arrival'?castOf(sc):[]},call:null};
  if(c){const waiting=sc.pause&&live(sc);if(waiting)callSeen(c); // the budget starts at pickup (#680)
    out.call={id:c.id,kind:c.kind,about:c.about,who:c.who||null,seconds_left:waiting?callLeft(c):0,max_chars:ARRIVE.LINE_MAX}}
  return out}
export function sceneAnswer(a){a=a&&typeof a==='object'?a:{};const sc=ourScene();if(!sc)return null;const id=Math.round(Number(a.call)),text=clean(a.text,ARRIVE.LINE_MAX);
  const c=(sc.calls||[]).find(x=>x.id===id);if(!c)return {ok:false,error:'no call '+(a.call==null?'':a.call)+' in this scene (see table_call)'};
  if(c.done)return {ok:false,error:'too late: the '+(c.by==='scripted'?'scripted DM':'DM')+' already answered call '+id};
  if(!text)return {ok:false,error:'say something'};
  resolve(sc,c,{text,by:'dm-agent'});const more=VOICED[sc.kind]?VOICED[sc.kind](sc,c,a)||{}:{};return {ok:true,...more,call:id,kind:c.kind,said:text,next:(sc.calls||[]).some(x=>!x.done)?'another call is waiting (table_call)':null}}

// ---- once per step (sim/index.js, after the table): openings first, then the arrivals ----
export function sessionTick(){const O=S.opening,CS=S.companies;
  if(!(O&&O.queue&&O.queue.length)&&!(CS&&CS.some(C=>C.arrivals&&C.arrivals.length)))return; // the common case: nothing to open
  if(!hosted()){if(O&&!O.queue.length)delete S.opening;return}
  if(O&&O.queue&&O.queue.length){if(prepActive())return;if(PRO)PRO.ready();const i=O.queue.findIndex(q=>heirReady(q)&&!sceneFor(companyById(q.company))&&gathered(q));
    if(i>=0){const q=O.queue.splice(i,1)[0];if(!O.queue.length)delete S.opening;openOpening(q);return}}
  // Not companies(): a company with nobody left is what this loop must not miss. Each company its own table (#518); an heir's opening goes first.
  for(const C of (CS||[]).filter(x=>x.arrivals&&x.arrivals.length).sort((x,y)=>x.id-y.id)){if(sceneFor(C)||(O&&O.queue&&O.queue.some(q=>q.kind==='heir'&&q.company===C.id)))continue;
    const L=memOf(C);if(L.length&&L.every(x=>x.succeeds!=null&&!agentLive(x))&&S.gameMin-C.arrivals[0].since<ARRIVE.HEIR_WAIT)continue; // the next newcomer is greeted by an agent, so its table waits for theirs as an heir's opening does
    const where=settled(C)||(!L.length?'town':false)||(S.gameMin-C.arrivals[0].since>ARRIVE.WAIT_DAYS*1440&&!memOf(C).some(cryptOfHero)?'town':false);if(!where)continue;
    const q=C.arrivals.shift();if(!C.arrivals.length)delete C.arrivals;openArrival(C,q,where);return}}
// The panels: what waits.
export function arrivalsView(C){return (C&&C.arrivals||[]).map(q=>({cls:q.cls,fallen:q.name,since:q.since}))}
