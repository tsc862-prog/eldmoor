// The Fellowship (issue #68, phase A): one party of five that is the story. Owned by brain-builder.
// DOM-free. Every other hero stays scripted and keeps the world alive and dangerous around them.
//
// Roles are fixed (owner's rule): one Tank (Warrior), one Healer (Priest) and three DPS (Mage,
// Hunter, Rogue; one of each preferred, repeats allowed). SLOTS lists them in display order.
//
// S.fellowship = {id, name, fac, hall, slots:{tank,healer,dps1,dps2,dps3: heroId|null}, ids:[heroId],
//   founded (gameMin), day (current session day), log:[entry], past:[{id,name,cls,slot,lvl,cause,day}],
//   npcs:[name], dmSeen (last DM log id read), ai (relay enrichment on), enrich:{calls,ok,fail,usd,ms}}
// log entry: {id, day, t, gameMin, kind, parts}; kinds: found join leave adventure scene roll branch
//   complication outcome npc fight level kill death recruit session thread. Parts follow the chronicle
//   convention (strings, heroes, {t,c} spans), so every name in the panel is clickable.
// Members carry a.fellow=true, a.fellowRole (slot key), a.fellowFrom (home town before joining; the
// Fellowship lodges in its hall town so the five muster at one gate), a.persona, a.backstory, a.memory.
//
// How it runs (fellowshipTick, once per step, a no-op without a Fellowship):
//   muster   the five form one party (p.fellow) in town; party.js keeps the usual follow / shared XP /
//            heal behaviour, never dissolves it on a level gap and never lets a member join another party
//   hold     a member at the gate waits (up to HOLD_MAX real seconds) for companions still selling,
//            questing or walking home, so the party leaves together
//   watch    level-ups, elite kills, bonds, loot and blood debts (record hook), notable fights and flights,
//            town visits and every DM beat of their adventures become memories and campaign log lines
//   death    hardcore: the dead stay dead; survivors head home and the DM offers the empty slot to the
//            most-bonded living hero of that class, else the next recruit of that class
import {ZONES,zoneFor,zoneAt,dist} from '../world/map.js';
import {FAC} from '../data/factions.js';
import {homeOf} from '../data/races.js';
import {ELITES} from '../data/mobs.js';
import {MOBS} from '../data/mobs.js';
import {hash} from '../core/rng.js';
import {S,clockStr} from './state.js';
import {log} from './chronicle.js';
import {record,timeline,onRecord} from './history.js';
import {makeHero,maxHp,goHome,seedLevel} from './heroes.js';
import {leaveParty} from './party.js';
import {bond} from './bonds.js';
import {moment} from './reflect.js'; // reflection moments (#179)
import {disableBrain,askRelay} from './brain.js';
import {markPlayer} from './player.js';
import {seedProfs} from './professions.js';
import {buildPersona,buildBackstory,personaSnapshot,backstorySnapshot,applyPersona,applyBackstory,ROLE_NAME} from './persona.js';
import {STANCE_MAX} from '../data/prompts.js';
import {remember,memOf,refreshStances,stanceEvent,setSummariser,memorySnapshot,applyLong} from './memory.js';

export const DPS=['Mage','Hunter','Rogue','Skald'];
export const HEALERS=['Priest','Wildspeaker'];
export const SLOTS=[{key:'tank',role:'tank',label:'Tank',cls:['Warrior']},{key:'healer',role:'healer',label:'Healer',cls:HEALERS},
  {key:'dps1',role:'dps',label:'DPS',cls:DPS},{key:'dps2',role:'dps',label:'DPS',cls:DPS},{key:'dps3',role:'dps',label:'DPS',cls:DPS}];
export const SLOT_KEYS=SLOTS.map(s=>s.key);
export const LOG_CAP=300,HOLD_MAX=20,TIMEOUT={backstory:65000,persona:45000,memory:16000};
const slotOf=k=>SLOTS.find(s=>s.key===k);
const lcRole=k=>{const l=slotOf(k).label;return l==='DPS'?l:l.toLowerCase()};
export const fits=(k,a)=>!!(a&&slotOf(k)&&slotOf(k).cls.includes(a.cls));
const byId=id=>S.agents.find(x=>x.id==id);
const alive=x=>x&&x.kind==='hero'&&x.state!=='dead';
const day=()=>Math.floor(S.gameMin/1440)+1;
const gd=t=>({t,c:'gd'});
const plain=ps=>(ps||[]).map(p=>typeof p==='string'?p:p&&p.kind==='hero'?p.name:p&&p.t||'').join('');
const loose=b=>b.state==='hunt'||b.state==='travel'||b.state==='follow'||b.state==='return';

// ---- reading the Fellowship (for any UI module) ----
export const fellowship=()=>S.fellowship||null;
// Members in slot order: [{slot, role, label, hero|null}] (hero null while a slot stands empty).
export function fellowshipMembers(){const F=S.fellowship;if(!F)return [];
  return SLOTS.map(s=>({slot:s.key,role:s.role,label:s.label,hero:F.slots[s.key]!=null?byId(F.slots[s.key])||null:null}))}
export const fellows=()=>fellowshipMembers().map(m=>m.hero).filter(alive);
export const isFellow=a=>!!(a&&a.fellow&&S.fellowship);
export const wasFellow=a=>!!(a&&S.fellowship&&(a.fellow||S.fellowship.past.some(p=>p.id===a.id)));
export const fellowParty=()=>S.parties.find(p=>p.fellow)||null;
export const roleName=a=>{const s=a&&a.fellowRole&&slotOf(a.fellowRole);return s?s.label:null};

// ---- the campaign log ----
var witnessFn; // no initializer: reach.js may set it while this module is still loading // sim/reach.js (#182): who was apart while this happened. A var, set while the import cycle loads.
export function setWitness(f){witnessFn=f}
export function campaign(kind,...parts){const F=S.fellowship;if(!F)return null;
  const e={id:F.seq=(F.seq||0)+1,day:day(),t:clockStr(),gameMin:Math.round(S.gameMin),kind,parts};
  F.log.unshift(e);if(F.log.length>LOG_CAP)F.log.pop();if(witnessFn)witnessFn(kind,plain(parts).slice(0,80));return e}
// The same beat for several members at once (a shared kill, a party level-up) is one line: 'A, B and C slew ...'.
export function campaignBy(kind,a,...tail){const F=S.fellowship;if(!F)return null;const e=F.log[0],tt=plain(tail);
  if(e&&e.kind===kind&&e.tail===tt&&Math.abs(e.gameMin-S.gameMin)<=3&&Array.isArray(e.who)&&!e.who.includes(a.id)){e.who.push(a.id);
    const hs=e.who.map(byId).filter(Boolean),ps=[];hs.forEach((h,i)=>{ps.push(h);if(i<hs.length-2)ps.push(', ');else if(i===hs.length-2)ps.push(' and ')});e.parts=[...ps,...tail];return e}
  const n=campaign(kind,a,...tail);n.who=[a.id];n.tail=tt;return n}
// Open threads: unfinished jobs, living nemeses, oaths still sworn. Computed live, not stored.
export function openThreads(){const F=S.fellowship;if(!F)return [];const out=[],seen=new Set();
  for(const v of S.adventures||[])if(v.phase==='active'&&v.mem&&v.mem.some(id=>F.ids.includes(id)))out.push({kind:'job',parts:['Unfinished job: ',gd(v.title),' (scene '+((v.idx||0)+1)+' of '+((v.scenes||[]).length||'?')+')']});
  for(const p of F.plans||[])if(p.status==='open')out.push({kind:'meeting',parts:['Meeting: ',gd(p.where),' at '+p.atText+' ('+p.whoNames.join(', ')+' know)']}); // #182
  for(const a of fellows()){for(const id in a.nemesis||{}){const n=byId(id);if(alive(n)&&!seen.has(n.id)){seen.add(n.id);out.push({kind:'nemesis',parts:['Blood owed: ',n,' of the '+FAC[n.fac].name+' (',a,' swore it for '+a.nemesis[id]+')']})}}
    if(a.goal&&!a.goal.done)out.push({kind:'oath',parts:[a,' swore to ',gd(a.goal.text.charAt(0).toLowerCase()+a.goal.text.slice(1)),' ('+(a.goal.progress||0)+'/'+a.goal.need+')']})}
  return out}

// ---- names in faction voice (a lore-keeper pass reviews the word lists) ----
const NAME_PARTS=[
  {forms:['The {adj} {noun}','The {noun} of {hall}','The {adj} {noun} of {home}','The {noun} of the {adj} Road'],
   adj:['Dun','Quiet','Hedge','Ninth','Iron','Last','Patient','Saltwater','Lamplit','Long'], // no Grey (+Company = Tolkien) and no words shared with the noun list
   noun:['Company','Covenant','Fellowship','Lantern','Watch','Oath','Ledger','Wardens']},
  {forms:['The {adj} {noun}','{lead}’s {adj} Five','The {noun} of {hall}','The {adj} {noun}'],
   adj:['Broken','Red','Ash','Gnashing','Black','Bone','Mud','Scarred','Howling','Last'],
   noun:['Teeth','Fist','Five','Pack','Knot','Tusks','Banner','Pit']}];
export function fellowshipName(fac,lead,seed){const P=NAME_PARTS[fac===1?1:0],h=(i,l)=>l[Math.floor(hash(seed|0,i,31)*l.length)%l.length];
  const hall=homeOf(lead).name,home=lead.home||hall;
  return h(1,P.forms).replace('{adj}',h(2,P.adj)).replace('{noun}',h(3,P.noun)).replace('{hall}',hall).replace('{home}',home).replace('{lead}',lead.name)}

// ---- choosing the five ----
const eligible=(a,fac)=>alive(a)&&a.fac===fac&&!a.fellow&&!a.player;
// "Form one for me": for each tank, greedily add the healer and three DPS with the best bonds to
// those already chosen and the closest levels (distinct DPS classes preferred); keep the best team.
// An empty slot (no hero of that class alive) is left null and filled with a recruit at founding.
export function autoPick(fac){const pool=S.agents.filter(a=>eligible(a,fac));
  const of=cls=>pool.filter(a=>cls.includes(a.cls));
  const tanks=of(['Warrior']).sort((x,y)=>y.lvl-x.lvl||x.id-y.id).slice(0,8);
  const score=(c,team)=>{let s=0;for(const b of team)s+=bond(c,b)*2-Math.abs(c.lvl-b.lvl)*1.5;return s};
  let best=null,bs=-1e9;
  for(const T of tanks.length?tanks:[null]){const team=T?[T]:[],slots={tank:T?T.id:null};
    const add=(k,cands)=>{const c=cands.filter(x=>!team.includes(x)).sort((x,y)=>score(y,team)-score(x,team)||y.lvl-x.lvl||x.id-y.id)[0];slots[k]=c?c.id:null;if(c)team.push(c)};
    add('healer',of(HEALERS));
    for(const k of ['dps1','dps2','dps3']){const used=team.filter(b=>DPS.includes(b.cls)).map(b=>b.cls);
      const fresh=of(DPS).filter(x=>!used.includes(x.cls)&&!team.includes(x));add(k,fresh.length?fresh:of(DPS))}
    let s=team.length*100;for(const x of team)for(const y of team)if(x.id<y.id)s+=bond(x,y)*2-Math.abs(x.lvl-y.lvl)*1.5;
    if(s>bs){bs=s;best=slots}}
  return best||{tank:null,healer:null,dps1:null,dps2:null,dps3:null}}

// Check a proposed slot map: five distinct living heroes (or null = recruit), one faction, classes fit.
export function checkSlots(slots,fac){const seen=new Set();
  for(const s of SLOTS){const id=slots[s.key];if(id==null)continue;const a=byId(id);
    if(!alive(a))return s.label+': that hero is not alive.';if(a.fac!==fac)return a.name+' is not of the '+FAC[fac].name+'.';
    if(!fits(s.key,a))return a.name+' is a '+a.cls+'; the '+s.label+' slot needs '+s.cls.join(' or ')+'.';
    if(a.fellow&&!(S.fellowship&&S.fellowship.ids.includes(a.id)))return a.name+' already rides with a Fellowship.';
    if(seen.has(a.id))return a.name+' is in two slots.';seen.add(a.id)}
  return null}

// The next recruit of a class: a pending recruit of that faction and class arrives now, else a fresh one.
// It arrives a few levels under the party's lowest living member (balance #107), not at level 1 beside veterans.
const SEED_BEHIND=2;
function recruit(fac,cls){const i=S.recruits.findIndex(r=>r.fac===fac&&r.cls===cls);if(i>=0)S.recruits.splice(i,1);
  const mates=fellows(),a=makeHero(fac,cls,null,1);if(mates.length)seedLevel(a,Math.min(...mates.map(b=>b.lvl))-SEED_BEHIND);log('A new ',cls.toLowerCase(),', ',a,', is sent for to fill a place in the Fellowship.');return a}

// ---- founding, joining, leaving ----
export function found(slots,o={}){if(S.fellowship)return {ok:false,error:'A Fellowship already rides. Disband it first.'};
  const ids=SLOT_KEYS.map(k=>slots[k]).filter(id=>id!=null),first=ids.map(byId).find(alive);
  const fac=o.fac!=null?o.fac:first?first.fac:null;if(fac==null)return {ok:false,error:'Pick at least one hero, or a faction.'};
  const bad=checkSlots(slots,fac);if(bad)return {ok:false,error:bad};
  const filled={};for(const s of SLOTS){const id=slots[s.key];filled[s.key]=id!=null?byId(id):recruit(fac,s.cls.find(c=>!SLOTS.some(t=>t.key!==s.key&&filled[t.key]&&filled[t.key].cls===c))||s.cls[0])}
  const mem=SLOT_KEYS.map(k=>filled[k]);let lead=mem[0];for(const b of mem)if(b.lvl>lead.lvl)lead=b;
  const F=S.fellowship={id:++S.uid,name:'',fac,hall:homeOf(lead).name,slots:{},ids:[],founded:Math.round(S.gameMin),day:day(),log:[],past:[],npcs:[],
    dmSeen:S.dmLogSeq||0,ai:o.ai!==false,minds:'agent',enrich:{calls:0,ok:0,fail:0,usd:0,ms:0},seq:0};
  F.name=(o.name&&String(o.name).trim().slice(0,40))||fellowshipName(fac,lead,F.id);
  for(const s of SLOTS)join(filled[s.key],s.key,null,true);
  const roster=[];mem.forEach((b,i)=>{roster.push(b,' ('+slotOf(SLOT_KEYS[i]).label+')');if(i<mem.length-2)roster.push(', ');else if(i===mem.length-2)roster.push(' and ')});
  campaign('found',gd(F.name),' is founded in '+F.hall+': ',...roster,'.');
  log('In ',F.hall,', ',...roster,' swear themselves into ',gd(F.name),'. Whatever comes, it comes to the five of them.');
  timeline('oath',gd(F.name),' is founded in '+F.hall+' by ',lead,' and four companions.');
  for(const b of mem){record(b,'Swore into ',gd(F.name),' as its '+roleName(b)+'.');remember(b,'join','Swore into '+F.name+' in '+F.hall+' as its '+roleName(b)+', beside '+mem.filter(x=>x!==b).map(x=>x.name).join(', ')+'.')}
  for(const b of mem)if(!b.persona||!b.backstory)sheets(b);
  for(const b of mem)refreshStances(b,F.ids);
  muster();if(F.ai)for(const b of mem)enrich(b);
  return {ok:true,fellowship:F}}

// Put a hero in a slot. quiet: the founding writes its own lines.
export function join(a,key,why,quiet){const F=S.fellowship;if(!F||!alive(a)||!fits(key,a))return false;
  const old=F.slots[key]!=null?byId(F.slots[key]):null;if(old&&old!==a)leave(old,'replaced');
  if(a.party&&!a.party.fellow)leaveParty(a);
  F.slots[key]=a.id;F.ids=SLOT_KEYS.map(k=>F.slots[k]).filter(id=>id!=null);
  a.fellow=true;a.fellowRole=key;if(a.fellowFrom==null)a.fellowFrom=a.town||null;a.town=F.hall;
  memOf(a);agentMind(a); // the Fellowship is always agent-played (#148): one mind per member, its agent (#126)
  if(!quiet){campaign('recruit',a,' joins ',gd(F.name),' as its '+slotOf(key).label+(why?' ('+why+')':'')+'.');
    log(a,' takes the empty place in ',gd(F.name),' as its '+lcRole(key)+'.');
    timeline('oath',a,' joins ',gd(F.name),' as its '+slotOf(key).label+'.');
    record(a,'Joined ',gd(F.name),' as its '+slotOf(key).label+'.');
    sheets(a);remember(a,'join','Joined '+F.name+' as its '+slotOf(key).label+(why?', '+why:'')+'. '+fellows().filter(b=>b!==a).map(b=>b.name).join(', ')+' ride with me now.');
    for(const b of fellows())if(b!==a){remember(b,'join',a.name+' took the empty place as our '+slotOf(key).label+'.');refreshStances(b,F.ids)}
    refreshStances(a,F.ids);if(F.ai)enrich(a);muster()}
  return true}

// A hero leaves (removed by the user, replaced, or the Fellowship disbands). Dead members go through onDeath.
export function leave(a,why){const F=S.fellowship;if(!F||!a)return;const k=SLOT_KEYS.find(k=>F.slots[k]===a.id);if(k)F.slots[k]=null;
  F.ids=SLOT_KEYS.map(k=>F.slots[k]).filter(id=>id!=null);
  if(a.party&&a.party.fellow)leaveParty(a);
  a.fellow=false;delete a.fellowRole;if(a.fellowBrain){disableBrain(a);delete a.fellowBrain}if(a.fellowAgent){if(a.state!=='dead')markPlayer(a,false);delete a.fellowAgent}delete a.splitUntil;if(a.fellowFrom!=null&&a.state!=='dead'){a.town=a.fellowFrom}delete a.fellowFrom;
  if(alive(a)&&why!=='disband'){campaign('leave',a,' leaves ',gd(F.name),why?' ('+why+')':'','.');record(a,'Left ',gd(F.name),'.')}}

// Who plays the members (hard rule, #148): always their agents. There is no scripted or single-call AI
// mode for a member; the only choice left is which model each member's runner plays with (the runner
// settings, ui/runners.js). Every member is agent-played (markPlayer) from founding, joining or
// replacement on; one who leaves is handed back to the scripted rules (background heroes may be scripted).
// Between decisions a member auto-plays (sim/player.js autopilot and reflexes); its decisions wait for its
// runner (sim/runlink.js). 'off' and 'relay' are gone: an older save that still has them is converted.
export const MINDS=['agent'];
export const mindsOf=F=>F?'agent':'off';
// A member's one mind: its agent. No relay brain (the relay still writes sheets when F.ai).
function agentMind(a){let n=0;if(a.brain||a.fellowBrain){disableBrain(a);delete a.fellowBrain;n++}
  if(!a.player){if(markPlayer(a,true)){a.fellowAgent=true;n++}}return n}
export function setMinds(mode){const F=S.fellowship;if(!F||!MINDS.includes(mode))return false;F.minds='agent';for(const a of fellows())agentMind(a);return true}
// Every member agent-played (called each tick: a restored older save, or anything that unmarked one).
// An older save's scripted or AI members are converted with a notice (#148).
export function enforceAgents(){const F=S.fellowship;if(!F)return 0;let n=0;for(const a of fellows())n+=agentMind(a)?1:0;
  if(F.minds!=='agent'){const was=F.minds||(F.ai?'relay':'off');F.minds='agent';
    if(n){campaign('note','The Fellowship is always agent-played now: '+n+' member'+(n===1?'':'s')+' who '+(n===1?'was':'were')+' '+(was==='relay'?'played by the relay or the scripted rules':'scripted')+' '+(n===1?'is':'are')+' agent-played (start their runners; reflexes keep them alive meanwhile).');
      log(gd(F.name),' is agent-played from now on: every member answers to their own agent.')}}
  return n}

export function disbandFellowship(){const F=S.fellowship;if(!F)return;
  for(const a of fellows())leave(a,'disband');const p=fellowParty();if(p){p.fellow=false}
  log(gd(F.name),' is disbanded. The road takes them back one at a time.');
  S.fellowshipsPast=(S.fellowshipsPast||[]).concat([{id:F.id,name:F.name,fac:F.fac,founded:F.founded,ended:Math.round(S.gameMin),fallen:F.past.length}]).slice(-10);
  S.fellowship=null}

// Hardcore replacement: the most-bonded living hero who fits the slot, else the next recruit of the class.
export function offerReplacement(key){const F=S.fellowship;if(!F||F.slots[key]!=null)return null;const s=slotOf(key),mates=fellows();
  const used=mates.filter(b=>DPS.includes(b.cls)).map(b=>b.cls);
  const avg=mates.length?mates.reduce((t,b)=>t+b.lvl,0)/mates.length:1;
  const cands=S.agents.filter(a=>eligible(a,F.fac)&&s.cls.includes(a.cls)).map(a=>({a,b:mates.reduce((t,m)=>t+bond(a,m),0),d:Math.abs(a.lvl-avg),fresh:s.role!=='dps'||!used.includes(a.cls)}))
    .sort((x,y)=>y.b-x.b||(y.fresh-x.fresh)||x.d-y.d||x.a.id-y.a.id);
  const c=cands[0];
  if(c&&(c.b>0||c.d<=3)){join(c.a,key,c.b>0?'the DM offered the place to the hero who knew them best':'the DM offered the place to a hero of their level');placeProfs(c.a,key);return c.a}
  const cls=s.role==='dps'?(DPS.find(x=>!used.includes(x))||DPS[0]):s.cls[0];
  const a=recruit(F.fac,cls);join(a,key,'a fresh recruit, sent for by the DM');placeProfs(a,key);return a}
// The professions the owner chose for this place at setup (S.setup.profs, #259) pass to whoever fills it.
function placeProfs(a,key){const p=S.setup&&S.setup.profs;if(p&&p[key])seedProfs(a,p[key])}

// The record of a member whose grave was recycled before the tick saw them fall: last seen name, class and level.
function ghost(key){const F=S.fellowship,l=(F.last||{})[key]||{},f=S.fallen.find(x=>x.name===l.name);
  return {id:l.id==null?null:l.id,name:l.name||'A companion',cls:l.cls||'?',lvl:(f&&f.lvl)||l.lvl||0,cause:(f&&f.cause)||'lost'}}
function onDeath(a,key){const F=S.fellowship;F.slots[key]=null;F.ids=SLOT_KEYS.map(k=>F.slots[k]).filter(id=>id!=null);
  const lvl=a?a.lvl:0,cause=a&&a.cause||'lost';
  F.past.push({id:a?a.id:null,name:a?a.name:'?',cls:a?a.cls:'?',slot:key,lvl,cause,day:day()});
  if(a){a.fellow=false;a.fellowPast=F.id}
  const who=a&&a.kind==='hero'?a:gd(a&&a.name||'a companion');
  campaign('death',who,' fell at level '+lvl+' ('+cause+'). The '+lcRole(key)+'’s place stands empty.');
  log({t:'',c:'nar'},gd(F.name),' has lost ',who,', their '+lcRole(key)+', '+cause+'. Hardcore: there is no coming back.');
  for(const b of fellows())moment(b,'death',(a&&a.name||'a companion')+' fell ('+cause+')'); // reflection moment (#179)
  for(const b of fellows()){remember(b,'death',(a&&a.name||'A companion')+', our '+lcRole(key)+', fell ('+cause+'). One life each, and that was theirs.');
    if(b.state==='hunt'||b.state==='travel'||b.state==='follow')goHome(b)} // the survivors carry the news home
  offerReplacement(key)}

// ---- relay enrichment: backstory, then persona, once per member; never awaited ----
const pending=new Set();
export const enriching=a=>!!a&&pending.has(a.id);
function sheets(a){const F=S.fellowship,mates=fellows();
  if(!a.backstory||!a.backstory.edited)a.backstory=buildBackstory(a,mates,F?F.name:'the Fellowship');
  if(!a.persona||!a.persona.edited)a.persona=buildPersona(a,mates)}
function cost(j,F){if(!F||!j)return;F.enrich.calls++;if(j.usage)F.enrich.usd=Math.round((F.enrich.usd+(+j.usage.cost||0))*1e6)/1e6;if(j.ms)F.enrich.ms=j.ms}
const written=x=>!!x&&(x.src==='model'||x.edited); // a sheet the model (or the user) already wrote is never asked for again (#117)
export function enrich(a){const F=S.fellowship;if(!F||!F.ai||pending.has(a.id))return false;
  const needB=!written(a.backstory),needP=!written(a.persona);if(!needB&&!needP)return false;pending.add(a.id);
  const fid=F.id,still=()=>S.fellowship&&S.fellowship.id===fid&&a.fellow&&a.state!=='dead';
  const none=Promise.resolve(needB?null:{skip:true});
  (needB?askRelay('backstory',backstorySnapshot(a,fellows(),F.name),TIMEOUT.backstory,a):none).then(j=>{
    if(!still())return;if(needB){cost(j,S.fellowship);
      if(j&&!(a.backstory&&a.backstory.edited)&&applyBackstory(a,j,fellows(),j.model))S.fellowship.enrich.ok++;else S.fellowship.enrich.fail++}
    if(!needP)return;
    return askRelay('persona',personaSnapshot(a,fellows(),S.fellowship.name),TIMEOUT.persona,a).then(p=>{if(!still())return;cost(p,S.fellowship);
      if(p&&!(a.persona&&a.persona.edited)&&applyPersona(a,p,fellows(),p.model)){S.fellowship.enrich.ok++;refreshStances(a,S.fellowship.ids)}else S.fellowship.enrich.fail++})})
    .catch(()=>{}).finally(()=>pending.delete(a.id));return true}
setSummariser((a,items,before,stamp)=>{const F=S.fellowship;if(!F||!F.ai||!a.fellow)return;
  askRelay('memory',memorySnapshot(a,items,before),TIMEOUT.memory,a).then(j=>{if(j&&S.fellowship){cost(j,S.fellowship);applyLong(a,j.long,stamp)}}).catch(()=>{})});

// User edits from the Fellowship panel: plain strings, cut to the same caps the model gets.
export function editSheet(a,which,field,text){if(!a)return false;const v=String(text==null?'':text).replace(/\r/g,'').slice(0,600);
  if(which==='persona'){a.persona=a.persona||buildPersona(a,fellows());a.persona[field]=v;a.persona.edited=true;return true}
  if(which==='stance'){const b=byId(field);if(!b||b===a)return false;const P=a.persona=a.persona||buildPersona(a,fellows()),t=v.trim().slice(0,STANCE_MAX);
    const st=P.stances={...(P.stances||{})},by=P.stanceBy={...(P.stanceBy||{})}; // the owner's line toward one companion (#305); empty hands it back to the bond reading
    if(t){st[b.id]=t;by[b.id]='owner'}else{delete st[b.id];delete by[b.id]}P.edited=true;refreshStances(a,S.fellowship?S.fellowship.ids:[]);return true}
  if(which==='backstory'){a.backstory=a.backstory||buildBackstory(a,fellows(),S.fellowship?S.fellowship.name:'the Fellowship');
    if(field==='summary')a.backstory.summary=v;else (a.backstory.paras||(a.backstory.paras={}))[field]=v;a.backstory.edited=true;return true}
  return false}

// ---- the tick ----
function muster(){const F=S.fellowship,L=fellows();let P=fellowParty();
  for(const b of L)if(b.party&&b.party!==P)leaveParty(b);
  if(!P){const inTown=L.filter(b=>b.state==='town'&&!b.splitUntil);if(inTown.length<2)return;
    let lead=inTown[0];for(const b of inTown)if(b.lvl>lead.lvl)lead=b;
    P={id:++S.uid,fac:F.fac,leader:lead,mem:inTown.slice(),zone:zoneFor(Math.min(...inTown.map(b=>b.lvl)),homeOf(lead).gate),home:false,fellow:true};
    for(const b of inTown)b.party=P;S.parties.push(P);return}
  if(P.home)return;
  for(const b of L)if(!b.party&&!b.splitUntil&&(b.state==='town'||(loose(b)&&b.state!=='return'&&dist(b,P.leader)<12))){P.mem.push(b);b.party=P}}

const fightSeen=new Map(),lastState=new Map();
function watch(a){const st=a.state,prev=lastState.get(a.id);lastState.set(a.id,st);
  if(st==='fight'&&a.target&&a.target.kind==='mob'){const m=a.target;fightSeen.set(a.id,{m,lvl:m.lvl,elite:!!m.elite,name:m.elite?m.name:MOBS[m.type].name,z:zoneAt(a.x,a.y)});}
  else if(fightSeen.has(a.id)){const f=fightSeen.get(a.id);fightSeen.delete(a.id);
    if(!f.m.alive&&!f.elite&&f.lvl>=a.lvl+2){remember(a,'fight','Brought down a level '+f.lvl+' '+f.name+' in '+ZONES[f.z]+', two levels above me or more.');
      if(f.lvl>=a.lvl+3)campaignBy('fight',a,' brought down a level '+f.lvl+' '+f.name+' in '+ZONES[f.z]+'.')}
    else if(st==='return'&&f.m.alive&&a.hp<maxHp(a)*.35){remember(a,'flee','Broke off from a level '+f.lvl+' '+f.name+' in '+ZONES[f.z]+', bleeding, and ran.');campaignBy('fight',a,' fled a level '+f.lvl+' '+f.name+' in '+ZONES[f.z]+'.')}}
  if(prev&&prev!=='town'&&st==='town')remember(a,'town','Back in '+homeOf(a).name+' with '+a.gold+'g'+(a.party&&a.party.fellow?', the party with me.':'.'))}

// The record hook (history.js): the hero's own log lines that are worth remembering.
const REC=[[/^Reached level (\d+)/,'level'],[/^Slew /,'kill'],[/^(Became friends|Now counts)/,'bond'],[/^Lost a /,'death'],[/^Looted /,'loot'],
  [/^Completed /,'quest'],[/^(Paid the blood debt|Avenged |Killed )/,'kill']];
onRecord((a,text)=>{const F=S.fellowship;if(!F||!a.fellow)return;const r=REC.find(([re])=>re.test(text));if(!r)return;
  if(r[1]==='death'&&F.past.some(p=>text.includes(p.name)))return; // a fallen companion is remembered by onDeath
  remember(a,r[1],text);
  if(r[1]==='level'){const n=+(text.match(/(\d+)/)||[0,0])[1];if(n%5===0)campaignBy('level',a,' reached level '+n+'.')}
  else if(r[1]==='kill')campaignBy('kill',a,': '+text);
  else if(r[1]==='bond')for(const b of fellows())if(b!==a&&text.includes(b.name))stanceEvent(a,b,'Lately: '+text)});

// DM beats for the Fellowship's adventures: campaign log lines and per-scene memories.
function readDm(){const F=S.fellowship,L=S.dmLog||[];if(!L.length||L[0].id<=F.dmSeen)return;
  const fresh=[];for(const e of L){if(e.id<=F.dmSeen)break;fresh.push(e)}F.dmSeen=L[0].id;
  for(const e of fresh.reverse()){const ours=(e.heroes||[]).filter(id=>F.ids.includes(id));if(!ours.length)continue;
    const adv=e.advId!=null?(S.adventures||[]).find(v=>v.id===e.advId):null,ttl=adv?adv.title:'the job',txt=plain(e.summary),mem=ours.map(byId).filter(alive);
    if(e.kind==='pick'){campaign('adventure','Took up ',gd(ttl),' at '+(e.town||F.hall)+'.');for(const b of mem)remember(b,'adventure','Took up '+ttl+(adv&&adv.giver?' for '+adv.giver.name:'')+'.');
      const g=adv&&adv.giver;if(g&&g.name&&!F.npcs.includes(g.name)){F.npcs.push(g.name);if(F.npcs.length>40)F.npcs.shift();{const r=g.title||g.role;campaign('npc','Met ',gd(g.name),(r&&!g.name.toLowerCase().includes(String(r).toLowerCase())?', '+r:'')+', in '+(e.town||F.hall)+'.')}}}
    else if(e.kind==='frame')campaign('scene',...e.summary);
    else if(e.kind==='roll'){campaign('roll',...e.summary);for(const b of mem)remember(b,'roll',ttl+': '+txt.replace(/^.*? rolls /,(b.name&&txt.startsWith(b.name)?'I rolled ':'we rolled ')))}
    else if(e.kind==='branch'){campaign('branch',...e.summary);for(const b of mem)remember(b,'scene',ttl+': '+txt)}
    else if(e.kind==='complication')campaign('complication',...e.summary);
    else if(e.kind==='payoff'||e.kind==='fail'||e.kind==='abandon'){campaign('outcome',...e.summary);for(const b of mem)remember(b,'adventure',txt)}}}

function session(){const F=S.fellowship,d=day();if(d<=F.day)return;const prev=F.day;F.day=d;
  const of=F.log.filter(e=>e.day===prev),n=k=>of.filter(e=>e.kind===k).length;
  const th=openThreads();
  campaign('session','Day '+prev+' ends: '+n('adventure')+' job'+(n('adventure')===1?'':'s')+' taken, '+n('outcome')+' finished, '+n('roll')+' rolls, '+n('death')+' fallen. Open threads: '+(th.length?th.length:'none')+'.');
  for(const a of fellows())refreshStances(a,F.ids)}

let acc=0;
export function fellowshipTick(dt){const F=S.fellowship;if(!F)return;
  enforceAgents();
  for(const k of SLOT_KEYS){const id=F.slots[k];if(id==null)continue;const a=byId(id);if(!alive(a))onDeath(a||ghost(k),k);else (F.last||(F.last={}))[k]={id:a.id,name:a.name,cls:a.cls,lvl:a.lvl}}
  muster();
  const P=fellowParty(),L=fellows();let holding=false;
  if(P)for(const b of L){if(b.state!=='town'||b.townStep!==2||b.party!==P)continue;
    if(L.some(x=>x!==b&&((x.state==='town'&&x.townStep<2)||x.state==='return'))&&(F.hold||0)<HOLD_MAX){b.wait=Math.max(b.wait,.4);holding=true}}
  F.hold=holding?(F.hold||0)+dt:0;
  for(const a of L)watch(a);
  acc+=dt;if(acc>=1){acc=0;readDm();session()}}

// ---- the Chronicle's "Fellowship only" filter ----
// Fellowship lines (any member, past or present, or one of their adventures), plus the world's
// major events: Kragmaw, elites in the Fellowship's current region, and deaths of their rivals.
// Guild lines (#341) stay when they name a guild a living member belongs to: guilds.js, guildfocus.js and
// rivals.js write a guild as the part {t:'<TAG> Name'}, so the match is on that label. Read-only, no dice.
export const guildLabel=g=>'<'+g.tag+'> '+g.name;
export function chronicleFocus(e){const F=S.fellowship;if(!F)return true;const ps=e.parts||[];
  const ids=new Set([...F.ids,...F.past.map(p=>p.id)]);
  const guilds=new Set();for(const a of fellows())if(a.guild)guilds.add(guildLabel(a.guild));
  const lead=fellowParty()?fellowParty().leader:fellows()[0],z=lead?ZONES[zoneAt(lead.x,lead.y)]:null;
  const rivals=new Set();for(const a of fellows())for(const id in a.nemesis||{})rivals.add(+id);
  for(const p of ps){if(!p||typeof p!=='object')continue;
    if(p.kind==='hero'&&(ids.has(p.id)||rivals.has(p.id)))return true;
    if(p.adv!=null){const v=(S.adventures||[]).find(x=>x.id===p.adv);if(v&&v.mem&&v.mem.some(id=>ids.has(id)))return true}
    if(typeof p.t==='string'&&(p.t===F.name||guilds.has(p.t)||/Kragmaw/.test(p.t)))return true}
  const text=plain(ps);
  if(z&&ELITES.some(E=>text.includes(E.name))&&text.includes(z))return true;
  return false}
