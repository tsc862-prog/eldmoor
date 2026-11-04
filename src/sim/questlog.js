// The quest log: several quests per hero, one in focus. Owned by ai-designer. DOM-free, no dice.
//
// A hero's quests come from three places, and each keeps living where it always lived:
//   board  the kill quest from the quest giver (a.quest) and jobs from the town board, a townsperson or a follow-up
//          (S.adventures hooks and adventures, sim/dm.js);
//   dm     what the DM made: jobs the DM agent posted (h.by 'dm-agent'), the scripted DM's Fellowship-first jobs
//          (h.ff), and a staged scene at the table the hero sits in (sim/staged.js);
//   oath   the hero's oath (a.goal, sim/goals.js) and its blood debts (a.nemesis: a living killer of a friend).
//
// Holding several (agent-played heroes; scripted heroes keep the one quest and the one adventure they always had):
//   take_quest   takes a job off the board (or one a person offered) without dropping the current one: the hook is
//                set aside for this hero (phase 'taken', h.taker) and waits up to DM K.MAX_DAYS game days;
//   focus_quest  the one quest the hero pursues: a job in focus is a.adv and the DM leads it (sim/dm.js); focusing
//                another sets the running one aside (adv.held = hero id: its foes go, its scene keeps, it still goes
//                cold after K.MAX_DAYS) and starts or resumes the other; focusing the kill quest or an oath sets any
//                running adventure aside. A held adventure is taken up again when focused, or by itself when its
//                hero (solo or leading, nothing queued) comes within QL.NEAR tiles of its next scene;
//   abandon_quest  gives a job up (a taken one goes back on the board); oaths keep their own rules.
// At most QL.MAX quests at once (the kill quest, the running adventure, held and taken jobs); oaths and debts on top.
//
// State (plain JSON, saved with the world): a.qlog = {focus: id|null, done: [Q], scene?} made lazily (an old save
// has none: its quest or adventure is the focus, so nothing to migrate), the taken hooks and held adventures on
// S.adventures. questLog(a) reads only; questTick(dt) writes only for agent-played heroes and staged scenes.
// In-game channels (#123): the watcher's questLog says who made a job (from); the hero's own view (questsView, the
// quests tool) never does, and nothing here carries a DM note, a lever reason or a staged scene's reason.
import {S} from './state.js';
import {MOBS} from '../data/mobs.js';
import {ZONES,CRYPT,dist} from '../world/map.js';
import {homeOf} from '../data/races.js';
import * as D from '../data/adventures.js';
import {K as DMK,holdAdventure,resumeAdventure} from './dm.js';
import {ev} from './notify.js';
import {wakeQuestDone} from './wakes.js'; // finished quests wake the agent (one wake helper, no copy)
import {inSlots} from './company.js'; // the slotted company (#588)
import {supplyTick,supplyOf,openAt,supplyId,textOf as supplyText,wantText,rewardText,have as supplyHave,setSupplyDone,SUP} from './supply.js'; // goods jobs (#720)

export const QL={
  MAX:5,        // quests a hero holds at once (oaths and blood debts come on top)
  DONE:20,      // finished quests kept in an agent-played or Fellowship hero's log
  DONE_BG:6,    // ... in a scripted hero's (the save stays small)
  NEAR:6,       // tiles: a held adventure is taken up again when its hero comes this close to its next scene
  DEBTS:3,      // blood debts listed at most
  VIEW_DONE:8,  // finished quests the quests tool shows
};

const hero=id=>S.agents.find(x=>x.id===id)||null;
const alive=x=>x&&x.state!=='dead';
const clip=(s,n)=>{s=String(s==null?'':s);return s.length>n?s.slice(0,n-1)+'…':s};
const plain=p=>Array.isArray(p)?p.map(x=>typeof x==='string'?x:x&&x.kind==='hero'?x.name:x&&x.t||'').join(''):String(p||'');
const advs=()=>S.adventures||[];

// ---- ids ----
export const killId=q=>'kill:'+q.type+':'+(q.at!=null?q.at:0);
export const jobId=h=>'job:'+h.id;
export const oathId=g=>'oath:'+g.type+':'+(g.tier||0)+':'+(g.targetId!=null?g.targetId:g.target!=null?g.target:g.need);
const debtId=k=>'debt:'+k;
const sceneId=r=>'scene:'+r;
export const parseJob=id=>{const m=/^(?:job:)?(\d+)$/.exec(String(id==null?'':id).trim());return m?Number(m[1]):null};

// ---- builders (no writes) ----
const mk=(o)=>({id:o.id,kind:o.kind,title:clip(o.title,90),giver:o.giver||null,where:o.where||null,objective:clip(o.objective,160),progress:o.progress||null,
  reward:o.reward||null,status:o.status,focus:!!o.focus,started:o.started==null?null:Math.round(o.started),ends:o.ends==null?null:Math.round(o.ends),from:o.from});

function killQ(a,q,status,focus){const M=MOBS[q.type]||{},home=homeOf(a).name,z=ZONES[M.z]||null,fin=q.have>=q.need;
  return mk({id:killId(q),kind:'board',title:M.q||'Kill '+(M.pl||q.type),giver:'the quest giver of '+home,where:z,
    objective:'Kill '+q.need+' '+(M.pl||q.type)+(z?' in '+z:'')+(fin?': done, hand it in at '+home:''),progress:{have:Math.min(q.have,q.need),need:q.need},
    reward:'about '+(4+a.lvl*3)+'g and XP',status,focus,started:q.at,ends:null,from:'quest giver'})}

const jobKind=h=>h.by==='dm-agent'||h.ff?'dm':'board';
const jobFrom=(h,a)=>h.by==='dm-agent'?'DM agent':h.ff?'scripted DM':h.src==='follow'?'follow-up':h.for===a.id&&h.src==='request'?'a person':h.src==='oath'?'oath board':'town board';
const jobTitle=h=>{if(h.title)return h.title;const T=D.ADVENTURES[h.tpl]||{},th=h.data&&h.data.thing;return (T.name||h.tpl)+(th?': '+plain(th):'')+(h.data&&h.data.beast?' ('+h.data.beast+')':'')};
function payText(a,h){const T=D.ADVENTURES[h.tpl];if(!T||!T.pay)return null;const g=Math.round((6+a.lvl*3)*T.pay.gold*(h.data&&h.data.payMul||1));
  return 'about '+g+'g and XP'+(T.pay.honor?', '+T.pay.honor+' honor':'')+(T.pay.gear>=.35?', maybe gear':'')}
const SCENE={travel:'on the road',fight:'a fight',social:'a parley',trap:'a trap',rest:'a rest',choice:'a choice'};
function sceneProgress(adv){const tot=adv.scenes.filter(s=>s.type!=='choice').length,done=adv.scenes.slice(0,adv.idx).filter(s=>s.type!=='choice').length;return {have:Math.min(done,tot),need:tot}}
function jobQ(a,h,status,focus){const T=D.ADVENTURES[h.tpl]||{},on=h.phase==='active';let where=null,objective;
  if(on){const sc=h.scenes[h.idx],p=sceneProgress(h);where=sc&&sc.z!=null?ZONES[sc.z]:ZONES[h.z]||null;
    const what=!sc?'the end':h.held?'set aside':h.away?'back in town between scenes':h.stage==='fight'?'fighting':h.stage==='wait'?'resting':h.stage==='choose'?'a choice to make':SCENE[sc.type]||sc.type;
    objective='Scene '+Math.min(p.need,p.have+1)+' of '+p.need+': '+what+(where?' in '+where:'')}
  else{where=h.zone!=null?ZONES[h.zone]||null:h.data&&h.data.place?h.data.place:h.town;objective=(T.name||h.tpl)+(h.data&&h.data.thing?': '+plain(h.data.thing):'')+(h.town?', from '+h.town:'')}
  return mk({id:jobId(h),kind:jobKind(h),title:jobTitle(h),giver:h.giver?h.giver.name:null,where,objective,progress:on?sceneProgress(h):null,reward:payText(a,h),status,focus,
    started:h.started!=null?h.started:h.phase==='taken'?h.takenAt:h.born,ends:h.started!=null?h.started+DMK.MAX_DAYS*1440:h.until,from:jobFrom(h,a)})}

// A goods job (sim/supply.js, #720): bring crafted or gathered goods to the town that posted it. A taken one is held; one on the
// board is offered. Kind dm when the DM agent or the scripted DM's Fellowship-first posting made it.
function supplyQ(a,j,status,focus){return mk({id:supplyId(j),kind:j.by==='dm-agent'||j.ff?'dm':'board',title:supplyText(j),giver:j.giver?j.giver.name:null,where:j.town,
  objective:wantText(j)+(j.hint?'. '+j.hint:''),progress:{have:Math.min(supplyHave(a,j.want),j.want.n),need:j.want.n},reward:rewardText(j),status,focus,
  started:j.phase==='taken'?j.takenAt:j.born,ends:j.until,from:j.by==='dm-agent'?'DM agent':j.ff?'scripted DM':'town board'})}
function oathQ(a,g,status,focus){const where=g.type==='pilgrimCrypt'&&CRYPT?CRYPT.name:g.zone!=null&&typeof g.zone==='number'?ZONES[g.zone]||null:null;
  return mk({id:oathId(g),kind:'oath',title:g.text,giver:null,where,objective:g.text+(g.target?' ('+g.target+')':''),
    progress:g.need>1?{have:Math.min(g.progress||0,g.need),need:g.need}:null,reward:null,status,focus,started:g.at,ends:null,from:'oath'})}
function vowQ(a,v,status,focus,why){const where=v.about&&v.about.zone!=null?ZONES[v.about.zone]||null:v.kind==='reach'?v.about&&v.about.name:null;
  return mk({id:v.id,kind:'oath',title:v.text,giver:null,where,objective:'Your vow: '+v.text+(why?' ('+why+')':''),progress:null,reward:null,status,focus,started:v.at,ends:v.ends,from:'sworn vow'})}
function debtQ(a,k,victim,focus){return mk({id:debtId(k.id),kind:'oath',title:'Blood debt: '+k.name,giver:null,where:null,
  objective:'Avenge '+victim+': slay '+k.name+' of the other side',progress:null,reward:null,status:'active',focus,started:null,ends:null,from:'blood debt'})}
const tableRec=a=>{const T=S.table,G=S.staged;if(!T||!T.ctx||T.ctx.staged==null||!T.ids||!T.ids.includes(a.id)||!G||!G.cur||G.cur.id!==T.ctx.staged)return null;return G.cur};
function sceneQ(a,rec,status){return mk({id:sceneId(rec.id),kind:'dm',title:rec.title||'A scene',giver:null,where:rec.z!=null?ZONES[rec.z]||null:null,
  objective:'A scene at the table: '+(rec.title||rec.kind),progress:null,reward:null,status,focus:false,started:S.table?S.table.at:null,ends:null,from:'DM agent'})}

// ---- what the hero holds ----
const runningOf=a=>{if(!a.adv)return null;const v=advs().find(x=>x.id===a.adv&&x.phase==='active');return v||null};
export const heldOf=a=>advs().filter(v=>v.phase==='active'&&v.held===a.id);
export const takenOf=a=>advs().filter(h=>h.phase==='taken'&&h.taker===a.id);
export const offersOf=a=>advs().filter(h=>h.phase==='open'&&h.for===a.id&&h.town===homeOf(a).name);
// Quests that count toward QL.MAX.
export const heldCount=a=>(a.quest?1:0)+(runningOf(a)?1:0)+heldOf(a).length+takenOf(a).length+supplyOf(a).length;

// The id in focus: a running adventure always (the DM leads it), else what the hero focused (while it still holds
// it), else the kill quest, else the oath.
export function focusId(a){const r=runningOf(a);if(r)return jobId(r);
  const f=a.qlog&&a.qlog.focus;if(f&&holds(a,f))return f;
  if(a.quest)return killId(a.quest);if(a.goal&&!a.goal.done)return oathId(a.goal);return null}
function holds(a,id){if(a.vow&&a.vow.id===id)return true;if(a.quest&&killId(a.quest)===id)return true;if(a.goal&&!a.goal.done&&oathId(a.goal)===id)return true;
  if(/^debt:/.test(id)){const k=hero(Number(id.slice(5)));return !!(a.nemesis&&k&&a.nemesis[k.id]&&alive(k))}
  if(/^supply:/.test(id))return supplyOf(a).some(j=>supplyId(j)===id);
  const n=parseJob(id);return n!=null&&(heldOf(a).some(v=>v.id===n)||takenOf(a).some(h=>h.id===n))}

// ---- the read API (the dossier's Quest tab, the quests tool) ----
// questLog(a) -> {active: Q[], done: Q[] (newest first, at most QL.DONE), focus: id|null, offered: Q[]}
export function questLog(a){if(!a||a.kind!=='hero')return {active:[],done:[],focus:null,offered:[]};
  const f=focusId(a),out=[],r=runningOf(a);
  if(r)out.push(jobQ(a,r,'active',true));
  for(const v of heldOf(a))out.push(jobQ(a,v,'held',f===jobId(v)));
  for(const h of takenOf(a))out.push(jobQ(a,h,'held',false));
  for(const j of supplyOf(a))out.push(supplyQ(a,j,'held',f===supplyId(j)));
  if(a.quest)out.push(killQ(a,a.quest,'active',f===killId(a.quest)));
  if(a.goal&&!a.goal.done)out.push(oathQ(a,a.goal,'active',f===oathId(a.goal)));
  if(a.vow)out.push(vowQ(a,a.vow,'active',f===a.vow.id));
  let n=0;for(const k in a.nemesis||{}){const x=hero(Number(k));if(!alive(x))continue;if(n++>=QL.DEBTS)break;out.push(debtQ(a,x,a.nemesis[k],f===debtId(x.id)))}
  const rec=tableRec(a);if(rec)out.push(sceneQ(a,rec,'active'));
  out.sort((p,q)=>(q.focus?1:0)-(p.focus?1:0));
  const offered=offersOf(a).map(h=>({...jobQ(a,h,'active',false),status:'offered'}));
  for(const j of openAt(homeOf(a)))if(j.for===a.id)offered.push({...supplyQ(a,j,'active',false),status:'offered'});
  return {active:out,done:(a.qlog&&a.qlog.done||[]).slice(0,QL.DONE).map(unpack),focus:f,offered}}

// The hero's own view (the quests tool): no word of who made a job behind the scenes.
const KIND_SEEN=q=>q.kind==='oath'?'oath':/^scene:/.test(q.id)?'scene':/^kill:/.test(q.id)?'quest':'job';
const hoursTo=m=>m==null?undefined:Math.max(0,Math.round((m-S.gameMin)/60));
export function seenQ(q){const o={id:q.id,kind:KIND_SEEN(q),title:q.title,status:q.status};if(q.focus)o.focus=true;
  if(q.giver)o.giver=q.giver;if(q.where)o.where=q.where;o.objective=q.objective;if(q.progress)o.progress=q.progress.have+'/'+q.progress.need;if(q.reward)o.reward=q.reward;
  if(q.ends!=null&&q.status!=='done'&&q.status!=='failed'&&q.status!=='abandoned'&&q.status!=='expired')o.ends_in_hours=hoursTo(q.ends);return o}
export function questsView(a){const L=questLog(a),fq=L.active.find(q=>q.focus);
  return {focus:fq?fq.title:null,active:L.active.map(seenQ),offered:L.offered.length?L.offered.map(seenQ):undefined,done:L.done.slice(0,QL.VIEW_DONE).map(seenQ),
    holding:heldCount(a)+'/'+QL.MAX}}
// The line for the state header (pace brief): the focused quest and how many others.
export function questBrief(a){const L=questLog(a);if(!L.active.length)return null;const fq=L.active.find(q=>q.focus)||L.active[0];
  return {focus:fq.title+(fq.progress?' ('+fq.progress.have+'/'+fq.progress.need+')':''),id:fq.id,others:L.active.length-1}}

// ---- the finished ones (called from heroes.js, dm.js, goals.js; pushes only, no dice) ----
function logOf(a){return a.qlog||(a.qlog={focus:null,done:[]})}
// Stored lean (a save carries many heroes): empty fields are left out and filled back in on read.
const pack=q=>{const o={};for(const k in q){const v=q[k];if(v!=null&&v!==false)o[k]=v}return o};
const FIELDS={giver:null,where:null,progress:null,reward:null,focus:false,started:null,ends:null};
const unpack=q=>({...FIELDS,...q});
// A quest finished well wakes its agent at once (sim/wakes.js), whether it was in focus or held. The kill quest's
// turn-in already wakes from heroes.js turnIn, so it is skipped here (one wake per quest). Agent heroes only, no dice.
function wakeDone(a,q,gold){if(a.player&&q.status==='done'&&!/^kill:/.test(q.id))wakeQuestDone(a,q.title,gold||0)}
function push(a,q,gold){if(!a||a.kind!=='hero')return;wakeDone(a,q,gold);const L=logOf(a);L.done.unshift(pack(q));const cap=a.player||inSlots(a)?QL.DONE:QL.DONE_BG;if(L.done.length>cap)L.done.length=cap;
  if(L.focus===q.id)L.focus=null}
const ended=(q,status,extra)=>Object.assign(q,{status,focus:false,ends:Math.round(S.gameMin)},extra||{});
export function killDone(a){if(a&&a.quest)push(a,ended(killQ(a,a.quest,'done',false),'done'))}
const JOB_END={success:'done',partial:'done'};
export function jobDone(b,adv){const why=adv.why,st=JOB_END[adv.outcome]||(why==='abandoned'?'abandoned':why==='expired'?'expired':'failed');
  const q=jobQ(b,adv,st,false);q.objective=clip((adv.outcome==='partial'?'Half done: ':adv.outcome==='success'?'Done: ':'')+jobTitle(adv)+(adv.quitWhy&&adv.held===b.id?' ('+adv.quitWhy+')':''),160);q.progress=sceneProgress(adv);
  push(b,ended(q,st,{outcome:adv.outcome}),adv.paid&&adv.paid[b.id])}
export function takenGone(a,h,st,why){const q=jobQ(a,h,st,false);if(why)q.objective=clip(q.objective+' ('+why+')',160);push(a,ended(q,st))}
export function vowDone(a,v,st,why){push(a,ended(vowQ(a,v,st,false,why),st))}
export function oathDone(a,g,st){push(a,ended(oathQ(a,g,st,false),st))}
export function debtDone(a,k){const v=a.nemesis&&a.nemesis[k.id];if(!v)return;push(a,ended(debtQ(a,k,v,false),'done'))}
export function killAbandoned(a,why){if(!a.quest)return;const q=killQ(a,a.quest,'abandoned',false);if(why)q.objective=clip(q.objective+' ('+why+')',160);push(a,ended(q,'abandoned'))}
export function setFocus(a,id){logOf(a).focus=id}
// A goods job ended (sim/supply.js calls this through setSupplyDone): filled, or gone cold in the hero's hands.
export function supplyDone(a,j,st,gold){const q=supplyQ(a,j,st,false);if(st==='done'){q.progress={have:j.want.n,need:j.want.n};q.objective=clip('Done: '+wantText(j),160)}
  else q.objective=clip(q.objective+' (it went cold before you filled it)',160);push(a,ended(q,st),gold)}
setSupplyDone(supplyDone);

// ---- once per step (sim/index.js): no dice; only taken jobs, held adventures and staged scenes ----
export function questTick(){
  supplyTick();
  let A=S.adventures;if(A&&A.length){
    for(let i=A.length-1;i>=0;i--){const h=A[i];if(h.phase!=='taken')continue;const t=hero(h.taker);
      if(alive(t)&&S.gameMin<=h.until)continue;A.splice(i,1);if(alive(t)){takenGone(t,h,'expired','it went cold before you set out');ev(t,'The job '+jobTitle(h)+' went cold before you set out on it.')}}
    for(const v of A){if(v.phase!=='active'||v.held==null)continue;const a=hero(v.held);
      if(!alive(a)||!a.player||a.adv||(a.pq&&a.pq.length)||(a.party&&a.party.leader!==a)||!(a.state==='hunt'||a.state==='travel'))continue;
      const sc=v.scenes[v.idx];if(!sc||!sc.at||dist(a,sc.at)>QL.NEAR)continue;
      if(resumeAdventure(a,v)){setFocus(a,jobId(v));ev(a,'Back near the place of '+v.title+': you take it up again.',true)}}}
  // a staged scene at the table: the members in it hold it while it lasts, then it goes to their done list
  const T=S.table,rec=T&&T.ctx&&T.ctx.staged!=null&&S.staged&&S.staged.cur&&S.staged.cur.id===T.ctx.staged?S.staged.cur:null;
  if(rec)for(const id of T.ids){const a=hero(id);if(a){const L=logOf(a);if(!L.scene||L.scene.id!==rec.id)L.scene={id:rec.id,title:rec.title,z:rec.z,at:T.at}}}
  if(S.staged)for(const a of S.agents){const L=a.qlog;if(!L||!L.scene||rec&&L.scene.id===rec.id)continue;const s=L.scene;L.scene=null;
    push(a,ended(mk({id:sceneId(s.id),kind:'dm',title:s.title||'A scene',where:s.z!=null?ZONES[s.z]||null:null,objective:'A scene at the table: '+(s.title||'over'),status:'done',started:s.at,from:'DM agent'}),'done'))}}

// Holding the running adventure aside while the hero turns to something else (focus_quest on a kill quest or oath).
export {holdAdventure,resumeAdventure};
