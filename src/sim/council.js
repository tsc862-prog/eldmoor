// The Fellowship's council (issue #68, phase B). Owned by brain-builder. DOM-free, no RNG.
//   party chat   partySay / partyRead: a shout the members within COUNCIL.SHOUT tiles hear (Chat tab and
//                speech bubble); beyond it nobody hears (issue #182, sim/reach.js: ranges, meeting plans, couriers)
//   proposals    propose / castVote / resolveProp for decisions that need everyone: take a job,
//                answer a Crypt or raid call, split up (or 'other', logged only). Members vote with
//                the vote tool (or on their turn at the table); every vote waits for the member's
//                agent (#148): a member whose runner holds it is nudged at once (a must-answer event)
//                and the vote stays open past PROP_MIN, up to HOLD_MIN more, while autopilot carries
//                on; a member whose runner is gone waits for the owner (the page's runner-stop alert)
//                and, once the owner resumes without it, or with no host at all, votes by reflex at
//                once. The leader resolves: majority of the votes cast, the leader's vote breaks a tie.
//                Results go to the campaign log, the chronicle and every member's memory.
//   lead_to      the leader sets the party's destination; followers follow unless they split off
//   splitOff     leave_party for a member: they go their own way for SPLIT_MIN game minutes, at a
//                bond cost with every companion (unless the party agreed to split)
//   unitDraft    the Fellowship goes into a Crypt group or a raid all together or not at all; a
//                party with agent-played members is asked first (a proposal), never drafted
// Plain data, saved with the world: F.props [{id,kind,details,by,at,until,votes,status,result}],
// F.accept {crypt|raid: gameMin until a passed call stands}, a.splitUntil, a.cryptOk / a.raidOk.
import {CRYPT,dist} from '../world/map.js';
import {S,clockStr,dayNo} from './state.js';
import {log} from './chronicle.js';
import {maxHp} from './heroes.js';
import {leaveParty,partyMates} from './party.js';
import {nearHeroes} from './spatial.js';
import {bond} from './bonds.js';
import {remember} from './memory.js';
import {notify} from './notify.js';
import {fellows,fellowParty,campaign} from './fellowship.js';
import {musterCrypt,yieldCrypt} from './dungeon.js';
import {reflexMay,ownerHeld} from './runlink.js';
import {inRange,together,outOfRange,nameList,makePlan,reachTick,toldBy,REACH} from './reach.js';

export const COUNCIL={PROP_MIN:120,HOLD_MIN:600,SPLIT_MIN:360,BOND_COST:3,ACCEPT_MIN:240,WAIT_MIN:480,CALL_COOL:240,PROPS_MAX:20,SAY_LEN:200,HEAR:7,SHOUT:REACH.SHOUT}; // SHOUT: how far party_say carries, in tiles (issue #182, sim/reach.js)
const NEED_ALL=['crypt','raid']; // calls that take the whole Fellowship, together
// The whole Fellowship in shouting range of each other (#182). A party its reflexes play whole (no live agent, no runner; the headless sim) moves as one unit and is not held to it.
const gathered=L=>!L.some(b=>!reflexMay(b))||together(L,leaderOfF());
export const PROP_KINDS=['job','crypt','raid','split','break_camp','other'];
const KIND_TEXT={job:'take a job',crypt:'answer a call to '+CRYPT.name,raid:'answer a raid muster on Kragmaw',split:'split up for a while',break_camp:'break camp and move on',other:'decide'};
const gd=t=>({t,c:'gd'});
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
// A spoken line (#145): whitespace folded, a leading "<own name>:" / "<own name> here," dropped (the game already
// shows who speaks), and never cut: over `max` characters it is refused. Returns {text} or {error}.
const esc=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function spokenLine(a,text,max=COUNCIL.SAY_LEN){let t=String(text==null?'':text).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
  if(a&&a.name){const re=new RegExp('^[\\[(]?(?:party\\]?\\s*)?'+esc(a.name)+'(?:\\s+here)?\\s*[:,\\-\u2013\u2014]\\s*','i');const s=t.replace(re,'');if(s&&s!==t)t=s.charAt(0).toUpperCase()+s.slice(1)}
  if(!t)return {error:'Say what?'};if(t.length>max)return {error:'Too long: keep it under '+max+' characters (this was '+t.length+').'};return {text:t}}
const living=a=>a&&a.state!=='dead';
export const leaderOfF=()=>{const P=fellowParty();if(P&&living(P.leader)&&P.leader.fellow)return P.leader;const L=fellows();let b=L[0]||null;for(const x of L)if(x.lvl>b.lvl)b=x;return b};

// ---- party chat ----
// The speaker's party (the whole Fellowship for a member) hears it within COUNCIL.SHOUT tiles, no further;
// heroes within earshot hear it too. Returns the number of listeners, or an error string.
// An agent's line over the cap is refused (party_say shows the error); a scripted line is cut at a word with an ellipsis.
const wordCut=(t,n)=>{if(t.length<=n)return t;const c=t.slice(0,n-1),i=c.lastIndexOf(' ');return (i>n*.6?c.slice(0,i):c).replace(/[\s,.;:]+$/,'')+'…'};
// Who a party shout by a reaches (#182): its companions (the Fellowship, else its party) split into near (within
// shoutRange, sim/reach.js) and far. One helper for partySay and the earshot tool (#395).
export function shoutHearers(a){const mates=(a.fellow?fellows().filter(b=>b!==a):partyMates(a)).filter(living);
  const near=mates.filter(b=>inRange(a,b));return {mates,near,far:mates.filter(b=>!near.includes(b))}}
export function partySay(a,text){let L=spokenLine(a,text);if(L.error&&/^Too long/.test(L.error)&&!a.player)L={text:wordCut(spokenLine(a,text,1e9).text,COUNCIL.SAY_LEN)};if(L.error)return L.error;const t=L.text;
  const {mates,near,far}=shoutHearers(a);if(!mates.length)return 'You have no party to talk to.';
  const e={t:clockStr(),d:dayNo(),from:a,text:t,trigger:'party',party:true,heard:near.map(b=>b.name),far:far.map(b=>b.name)},heard=new Set([a]);
  const hear=b=>{if(heard.has(b))return;heard.add(b);(b.chat||(b.chat=[])).push(e);if(b.chat.length>20)b.chat.shift()};
  (a.chat||(a.chat=[])).push(e);if(a.chat.length>20)a.chat.shift();
  for(const b of near)hear(b);
  for(const b of nearHeroes(a.x,a.y,COUNCIL.HEAR))if(b!==a&&living(b)&&!b.hidden&&dist(a,b)<=COUNCIL.HEAR)hear(b);
  toldBy(a,near);a.bubble={text:t,life:3};return heard.size-1}
// What the speaker is told: "heard by Kerin, Lorwyn; Fena and Garrwen are too far away".
export function hearNote(e){if(!e||!e.party)return '';const h=e.heard||[],f=e.far||[];if(!h.length&&!f.length)return '';
  const fl=f.length?nameList(f.map(name=>({name})))+(f.length>1?' are':' is')+' too far away':'';
  return h.length?'heard by '+h.join(', ')+(fl?'; '+fl:''):'No one is near enough to hear: '+fl}
export const partyRead=(a,n=10)=>(a.chat||[]).filter(e=>e.party).slice(-Math.max(1,Math.min(20,n))).map(e=>e.t+' '+(e.from&&e.from.name||'?')+': '+e.text);

// ---- proposals ----
const F_=()=>S.fellowship;
export const openProps=()=>((F_()&&F_().props)||[]).filter(P=>P.status==='open');
export const propById=id=>((F_()&&F_().props)||[]).find(P=>P.id===Number(id))||null;
// sim/table.js turns a new proposal into a decision scene when it can pause. A hoisted function and
// a var without initializer, because table.js registers it while the import cycle is still loading.
var proposeHook,campHook;
export function setProposeHook(f){proposeHook=f}
export function setCampHook(f){campHook=f} // sim/camp.js: break the camp when a break_camp vote passes

// How a member votes by reflex: its runner is gone (and the owner said go on), or its agent let HOLD_MIN pass.
export function reflexVote(a,P){const mh=maxHp(a),hurt=a.hp<mh*.6;
  switch(P.kind){
  case 'crypt':return a.lvl>=7&&!hurt?'yes':'no';
  case 'raid':return a.lvl>=14&&!hurt?'yes':'no';
  case 'split':return 'no';
  case 'break_camp':{const g=F_()&&F_().camp;return g&&g.phase&&fellows().every(b=>b.hp>=maxHp(b)*.9)?'yes':'no'}
  default:return 'yes'}}

export function propose(a,kind,details,o={}){const F=F_();if(!F||!a||!a.fellow)return 'Only a Fellowship member can put something to the party.';
  if(!PROP_KINDS.includes(kind))return 'Kind must be one of: '+PROP_KINDS.join(', ')+'.';
  if(kind==='break_camp'&&!(F.camp&&F.camp.phase))return 'There is no camp to break: the Fellowship is not camped. Go on with move_to'+(leaderOfF()===a?' or lead_to':'')+'.';
  {const O=openProps().find(P=>P.kind===kind);if(O)return 'Proposal '+propLine(O)+' is already open. Vote on it with vote('+O.id+', yes|no), or wait for it to settle'+leftText(O)+' before proposing another.'}
  const d=clean(details,200);if(!d&&kind==='other')return 'Say what you propose.';
  // presence (#182): only members within shouting range hear a proposal and vote; the absent hear of it on rejoining
  const away=fellows().filter(b=>b!==a&&!inRange(a,b));
  if(away.length&&NEED_ALL.includes(kind)&&o.src!=='call')return 'The '+KIND_TEXT[kind]+' takes the whole Fellowship together; '+nameList(away)+(away.length>1?' are':' is')+' too far away to hear. Gather first, or send a courier.';
  const P={id:F.propSeq=(F.propSeq||0)+1,kind,details:d||KIND_TEXT[kind],by:a.id,byName:a.name,at:Math.round(S.gameMin),until:S.gameMin+COUNCIL.PROP_MIN,votes:{},status:'open',result:null,src:o.src||'member'};
  if(away.length)P.absent=away.map(b=>b.id);
  if(kind==='split'&&o.where)P.meet={where:clean(o.where,60),hours:o.hours}; // the plan to meet again, recorded if the split passes
  if(o.job!=null)P.job=Number(o.job);
  (F.props||(F.props=[])).unshift(P);if(F.props.length>COUNCIL.PROPS_MAX)F.props.pop();
  if(kind==='crypt')yieldCrypt(F); // reserve on proposal: a background group still gathering steps aside
  campaign('council',a,' proposes to '+KIND_TEXT[kind]+(d&&d!==KIND_TEXT[kind]?': '+d:'')+'.'+(away.length?' '+nameList(away)+(away.length>1?' are':' is')+' too far away to hear.':''));
  for(const b of voters(P))if(b!==a)notify(b,a.name+' proposes to '+KIND_TEXT[kind]+(d?': '+d:'')+'. The party waits for your vote: vote('+P.id+', yes|no, reason).',3); // 3: pacing starts the runner's turn at once (#148)
  if(o.vote!==false)castVote(a,P.id,o.vote||'yes',o.reason||'','agent');
  if(!(proposeHook&&proposeHook(P)))reflexFill(P);
  settleIfDone(P);return P}

// Refusal texts that name the open proposals and the legal next step (#400): agents act on them instead of retrying.
const propLine=P=>'#'+P.id+' ('+P.kind+': "'+P.details+'")';
const leftText=P=>{const m=Math.max(0,Math.round(P.until-S.gameMin));return ' (about '+m+' game min)'};
export function openNote(){const O=openProps();return O.length?'Open now: '+O.map(P=>propLine(P)+', vote('+P.id+', yes|no)').join('; ')+'.':'No proposal is open; put one to the party with propose {kind, details}.'}
export const noProposal=id=>'No proposal '+id+'. '+openNote();
export function castVote(a,id,v,reason,by='agent'){const P=propById(id);if(!P)return noProposal(id);if(P.status!=='open')return 'Proposal '+propLine(P)+' is already '+P.status+(P.result?' ('+P.result+')':'')+'; there is nothing to vote on. '+openNote();
  if(!a.fellow)return 'Only members vote.';if(!voters(P).includes(a))return 'You are too far from the others to hear this proposal; it reaches you when you rejoin them (or by courier).';v=String(v||'').toLowerCase();if(v!=='yes'&&v!=='no')return 'Vote yes or no: vote('+P.id+', yes|no, reason).';
  P.votes[a.id]={v,reason:clean(reason,120),by,at:Math.round(S.gameMin)};settleIfDone(P);return P}

// Members a reflex may vote for (no runner, and the owner said go on; or no host): they vote at once.
// Who a proposal reaches (#182): the living members who were within shouting range when it was made, and any who have rejoined since.
export const voters=P=>fellows().filter(b=>!(P.absent||[]).includes(b.id));
const atTable=P=>!!(S.table&&S.table.ctx&&S.table.ctx.prop===P.id);
function reflexFill(P){for(const b of voters(P))if(!P.votes[b.id]&&reflexMay(b)&&P.status==='open')castVote(b,P.id,reflexVote(b,P),'','reflex')}
// Who the open vote still waits for: members without a vote whose agent (or owner) has the say (#148).
export const waitingVoters=P=>P&&P.status==='open'?voters(P).filter(b=>!P.votes[b.id]&&!reflexMay(b)):[];

// Everyone has voted (or the time is up): the leader settles it.
function settleIfDone(P){if(P.status!=='open')return;if(voters(P).every(b=>P.votes[b.id]))resolveProp(P,'everyone voted')}
export function resolveProp(P,why){if(!P||P.status!=='open')return P;const L=voters(P),lead=leaderOfF();
  for(const b of L)if(!P.votes[b.id])P.votes[b.id]={v:reflexVote(b,P),reason:'',by:'reflex',at:Math.round(S.gameMin)};
  let yes=0,no=0;for(const b of L){const x=P.votes[b.id];if(x.v==='yes')yes++;else no++}
  const tie=yes===no,pass=tie?(lead&&P.votes[lead.id]?P.votes[lead.id].v==='yes':false):yes>no;
  P.status=pass?'passed':'failed';P.result=(pass?'Passed ':'Failed ')+yes+'-'+no+(tie&&lead?', '+lead.name+' breaking the tie':'')+' ('+why+')';P.done=Math.round(S.gameMin);
  const F=F_(),reasons=L.map(b=>P.votes[b.id]&&P.votes[b.id].reason?b.name+': '+P.votes[b.id].reason:null).filter(Boolean);
  campaign('council',...(lead?[lead,' settles it: ']:[]),'"'+P.details+'". '+P.result+'.'+(reasons.length?' '+reasons.slice(0,3).join('; ')+'.':''));
  log(gd(F.name),' put it to a vote: '+P.details+'. '+(pass?'Agreed':'Refused')+', '+yes+' to '+no+'.');
  for(const b of L){remember(b,'council','We voted on "'+P.details+'": '+(pass?'agreed':'refused')+' '+yes+'-'+no+'; I said '+P.votes[b.id].v+'.');notify(b,'The vote on "'+P.details+'" '+(pass?'passed':'failed')+' '+yes+'-'+no+'.',true)}
  if(pass)carryOut(P);else if(P.kind==='crypt'||P.kind==='raid'){F.cool=F.cool||{};F.cool[P.kind]=S.gameMin+COUNCIL.CALL_COOL}
  return P}

// Priority (#135): the Fellowship comes first at the Crypt and the Kragmaw muster. A proposal that is open or
// passed-and-waiting (F.wait[kind] = game minute until which the call stands) keeps background groups from forming.
export const cryptReserved=()=>openProps().some(P=>P.kind==='crypt');
const waiting=(F,k)=>F&&F.wait&&F.wait[k]>S.gameMin;
function setWait(F,k){(F.wait||(F.wait={}))[k]=S.gameMin+COUNCIL.WAIT_MIN}
// The faction whose raid muster is reserved for the Fellowship, or -1.
export function raidReserve(){const F=F_();return F&&(openProps().some(P=>P.kind==='raid')||waiting(F,'raid'))?F.fac:-1}
function cryptReady(L){return L.every(b=>b.lvl>=7&&['hunt','travel','town','return','follow'].includes(b.state))&&gathered(L)} // the whole Fellowship, in shouting range of each other (#182)
function goCrypt(F,L){for(const b of L)if(b.player)b.cryptOk=true;
  musterCrypt(L,F.fac,null,F.name);campaign('council',gd(F.name),' sets out for ',gd(CRYPT.name),' together.')}
// Called by dungeonCheck while no group holds the Crypt. True: the Crypt is the Fellowship's (reserved or just launched); the
// background must not form a group. A waiting Fellowship goes the moment the Crypt is free and everyone can, the cooldown waived.
export function cryptHold(){const F=F_();if(!F)return false;
  if(F.wait&&F.wait.crypt){if(!waiting(F,'crypt')){delete F.wait.crypt;campaign('council',gd(F.name),' gives up waiting at ',gd(CRYPT.name),'.');return false}
    const L=fellows();if(L.length&&cryptReady(L)){delete F.wait.crypt;goCrypt(F,L);log(gd(F.name),' go down into ',gd(CRYPT.name),' as the way clears.');return true}return true}
  return cryptReserved()}
function carryOut(P){const F=F_(),L=fellows();
  if(P.kind==='crypt'){const mine=CRYPT.group&&CRYPT.group.mem.some(a=>a.fellow);if(mine){P.result+='; we are already on our way';return}
    yieldCrypt(F);
    if(CRYPT.group||!cryptReady(L)){setWait(F,'crypt');const inside=!!CRYPT.group;
      P.result+=inside?'; another group is inside, we go when they come out':'; not everyone can go yet, we go as soon as we can';
      campaign('council',gd(F.name),inside?' wait for the group inside ':' ready themselves for ',gd(CRYPT.name),'.');
      if(inside)log(gd(F.name),' wait at the mouth of ',gd(CRYPT.name),' for the group inside to come out.');
      for(const b of L)notify(b,inside?'Another group is inside '+CRYPT.name+'. The vote stands: you go the moment they come out.':'The vote stands: you go to '+CRYPT.name+' as soon as everyone can.',true);return}
    goCrypt(F,L)}
  else if(P.kind==='raid'){setWait(F,'raid');(F.accept||(F.accept={})).raid=S.gameMin+COUNCIL.ACCEPT_MIN;for(const b of L)if(b.player)b.raidOk=true}
  else if(P.kind==='break_camp'){if(campHook&&campHook('called'))P.result+='; camp is broken'}
  else if(P.kind==='split'){const pr=P.meet&&L.find(b=>b.id===P.by),pl=pr?makeMeeting(pr,P.meet.where,P.meet.hours):null;
    if(pl&&!pl.error)P.result+='; we meet at '+pl.where+' at '+pl.atText;
    for(const b of voters(P))splitOff(b,true);campaign('council',gd(F.name),' splits up for a while, by agreement.');
    for(const b of voters(P))notify(b,(pl&&!pl.error?'You part by agreement; the plan is to meet at '+pl.where+' at '+pl.atText+'.':'You part by agreement with no plan to meet again. Out of shouting range (about '+REACH.SHOUT+' tiles) you cannot talk except by a courier from a town gate.'),3)}
  else if(P.kind==='job'){const lead=leaderOfF();if(lead)notify(lead,'The party agreed to take '+(P.job!=null?'job '+P.job:'a job')+'. As leader, take_adventure('+(P.job!=null?P.job:'id')+') at the gate.',true)}}

// ---- moving as a party ----
// A meeting plan (where, hours from now) made aloud: recorded for the members who hear it, then shouted so the chat shows it.
export function makeMeeting(a,where,hours){const P=makePlan(a,where,hours);if(P.error)return P;partySay(a,'We meet again at '+P.where+' at '+P.atText+'.');return P}

// leave_party for a member: go your own way for a while; costs bonds unless agreed.
export function splitOff(a,agreed){if(!a.fellow)return false;a.splitUntil=S.gameMin+COUNCIL.SPLIT_MIN;if(a.party&&a.party.fellow)leaveParty(a);
  if(!agreed){for(const b of fellows())if(b!==a){for(const [x,y] of [[a,b],[b,a]]){(x.bonds||(x.bonds={}));x.bonds[y.id]=Math.max(-10,bond(x,y)-COUNCIL.BOND_COST)}
      remember(b,'split',a.name+' went off alone, away from the rest of us.');notify(b,a.name+' has left the party for now.',false)}
    campaign('council',a,' splits off from the party.')}
  return true}
// lead_to: the followers within shouting range drop what they were walking to and fall in behind the leader.
export function followLead(lead,label){const P=lead.party;if(!P||P.leader!==lead)return 0;let n=0;P.dest={label,at:Math.round(S.gameMin)};
  for(const b of P.mem){if(b===lead||!inRange(lead,b))continue;n++; // only those who hear the order (#182)
   
    if(b.player){if(b.pq&&b.pq.length&&b.pq[0].kind!=='fight')b.pq=[];if(['hunt','travel','follow'].includes(b.state)){b.state='follow';b.dest=null}
      notify(b,lead.name+' leads the party to '+label+'. You follow (leave_party to split off).',true)}}
  campaign('council',lead,' leads the party toward '+label+'.');return n}

// ---- the Fellowship as one unit in a Crypt group or a raid (dungeon.js, boss.js) ----
// list: candidates in preference order; pool: everyone eligible (refills); n: group size.
// Without a Fellowship member among the first n this is exactly list.slice(0,n).
export function unitDraft(list,pool,n,kind){const top=list.slice(0,n),F=F_();if(!F||!top.some(a=>a.fellow))return top;
  // a member following the leader counts as free to answer (the pools only list hunt/travel/town/return)
  const lvl=kind==='crypt'?7:14,free=a=>pool.includes(a)||(a.state==='follow'&&a.lvl>=lvl&&!a.raid);
  const L=fellows(),ready=L.length>0&&L.every(free)&&gathered(L),agents=L.filter(a=>a.player);
  const accepted=!agents.length||(F.accept&&F.accept[kind]>S.gameMin);
  if(ready&&accepted){for(const a of agents){if(kind==='crypt')a.cryptOk=true;else a.raidOk=true}
    if(F.accept)delete F.accept[kind];if(F.wait)delete F.wait[kind];
    const out=L.slice();for(const a of top.concat(pool))if(out.length<n&&!a.fellow&&!out.includes(a))out.push(a);
    campaign('council','The call to '+(kind==='crypt'?CRYPT.name:'raid Kragmaw')+' came; ',gd(F.name),' answers it together.');return out}
  if(ready&&!(F.cool&&F.cool[kind]>S.gameMin)&&!openProps().some(P=>P.kind===kind)){const lead=leaderOfF();
    if(lead)propose(lead,kind,kind==='crypt'?'A group is forming for '+CRYPT.name+'; do we all go?':'The faction musters to raid Kragmaw; do we all go?',{src:'call',vote:lead.player?false:reflexVote(lead,{kind})})}
  else if(!ready&&!(F.cool&&F.cool['n'+kind]>S.gameMin)){(F.cool||(F.cool={}))['n'+kind]=S.gameMin+COUNCIL.CALL_COOL;
    campaign('council','The call to '+(kind==='crypt'?CRYPT.name:'raid Kragmaw')+' came, but not all of ',gd(F.name),' could answer; they stay together.')}
  const out=top.filter(a=>!a.fellow);for(const a of pool)if(out.length<n&&!a.fellow&&!out.includes(a))out.push(a);return out}

// ---- once per step (after the Fellowship tick) ----
export function councilTick(){const F=F_();if(!F)return;reachTick();
  // a member who has come back within earshot of the others hears of the proposals made while away (#182)
  for(const P of openProps())if(P.absent&&P.absent.length){const back=fellows().filter(b=>P.absent.includes(b.id)&&fellows().some(o=>o!==b&&!P.absent.includes(o.id)&&inRange(b,o)));
    if(back.length){P.absent=P.absent.filter(id=>!back.some(b=>b.id===id));for(const b of back)notify(b,'Back among your companions you hear of a proposal made while you were away: "'+P.details+'". vote('+P.id+', yes|no, reason).',3)}}
  for(const P of openProps()){if(!atTable(P))reflexFill(P);if(P.status!=='open')continue;
    if(S.gameMin<P.until){settleIfDone(P);continue}
    // past PROP_MIN: a vote waits for a live agent up to HOLD_MIN more (nudged once more), and for an absent
    // runner until the owner answers the runner-stop alert (#148); otherwise the reflexes fill in
    const wait=waitingVoters(P);
    if(wait.length&&(wait.some(ownerHeld)||S.gameMin<P.until+COUNCIL.HOLD_MIN)){
      if(!P.held){P.held=1;for(const b of wait)notify(b,'The vote on "'+P.details+'" still waits for you: vote('+P.id+', yes|no, reason).',3)}continue}
    resolveProp(P,wait.length?'waited for '+wait.map(b=>b.name).join(' and ')+' as long as it could':'time ran out')}
  for(const a of fellows()){if(a.cryptOk&&a.state!=='dungeon')a.cryptOk=false;if(a.raidOk&&!a.raid&&a.state!=='raid'&&!(F.accept&&F.accept.raid>S.gameMin))a.raidOk=false;
    if(a.splitUntil&&S.gameMin>=a.splitUntil)delete a.splitUntil}}
