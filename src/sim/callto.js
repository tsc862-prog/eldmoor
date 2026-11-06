// The DM may ask (issue #826): the world engine never puts the Crypt or a raid to a company, the DM agent may, as a deliberate
// act with a reason. Its call_to tool pulls the lever below (same caps, companies' reserve, pile-on rule and DM log as every
// lever; `when` can fire it). The call is spoken in the world: a person within CALL.EAR tiles of the leader (the gate captain by
// default in town), else the narrator. A company then gets the usual crypt or raid proposal, put to it by that person
// (askCompany, src 'dm'): the usual vote, Table decision scene, reserve and hold; the vote stays its members' agents'. A solo has
// nobody to vote with: the question waits for answer_call (accept or decline aloud), and accepting is its go_crypt or join_raid.
//
// Limits: CALL.PER_DAY a company a game day (CALL.ALL_DAY for all of them, the lever's own limit), not while it has a crypt or raid
// proposal open or a wait standing, not in the Crypt, a raid, a fight or a scene, no raid while Kragmaw is dead; a company that
// declined (a vote that failed, a solo's no, a solo's silence past CALL.ANSWER_MIN) is not asked again for CALL.AGAIN_DAYS game days.
// The reason is the lever's: the DM log only. Heroes hear the spoken line and the proposal, never who sent it.
//
// State on the company (saved with it; created by the first call only, so a world without one is unchanged):
//   C.calls {d (game day), n (calls that day), no (game minute of the last decline), last:{kind, by, line, gm, day, answer:
//            open|accepted|declined|unanswered, prop?, until? (a solo's question lapses then)}}
// DOM-free, no RNG (the scripted line is picked by a hash of ids). Owned by brain-builder.
import {S,dayNo,clockStr} from './state.js';
import {CITY,CRYPT,CRYPTS,dist} from '../world/map.js';
import {cryptFor,cryptOfHero} from './crypts.js'; // which dungeon a call, a hero or a group is about (#891)
import {FAC} from '../data/factions.js';
import {CALL_LINES} from '../data/renown-lines.js';
import {register,LEVERS} from './levers.js';
import {companyById,companyOf,members,isSolo} from './company.js';
import {askCompany,leaderOfC,openProps,setCallHook} from './council.js';
import {sceneFor} from './table.js';
import {worldHeld} from './prep.js';
import {notify} from './notify.js';
import {dmlog} from './dmlog.js';
import {notEnglish} from './lang.js';
import {ensureNpcs} from './npcs.js';
import {hear,heardOf} from './lore.js';
import {HEAR,CAP as CHAT_CAP,BUBBLE} from './chat.js';

export const CALL={
  PER_DAY:1,       // calls to one company a game day
  ALL_DAY:3,       // calls to all companies a game day (the lever's limit, so the reserve and fairness have a day to share)
  AGAIN_DAYS:2,    // game days a company that declined is left alone
  EAR:7,           // tiles: the caller stands this close to the leader
  TEXT_MAX:200,    // characters of the DM's own words
  ANSWER_MIN:240,  // game minutes a solo's question stands; silence after that counts as no
};
const DAY=1440;
const BUSY=['dungeon','raid','fight','duel','assist','downed'];
const NARRATOR={kind:'dm',name:'The Narrator'};
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const full=p=>(p.title&&!p.wander?p.title+' ':'')+p.name;
const hashN=s=>{let h=0;s=String(s);for(let i=0;i<s.length;i++)h=(Math.imul(h,31)+s.charCodeAt(i))|0;return Math.abs(h)};
const living=a=>a&&a.kind==='hero'&&a.state!=='dead';
const people=()=>{ensureNpcs();return [...(S.npcs||[]),...(S.wanderers||[])]};
const personBy=id=>people().find(x=>x.id===id)||null;
const label=C=>C.slots?'the Fellowship':isSolo(C)?(members(C)[0]||{}).name||'the hero':C.name||'the company';
const dunOf=C=>{const L=leaderOfC(C);return L?cryptFor(L):CRYPT}; // the dungeon a call to this company is about: the one its leader would go to
const placeWord=(k,dun)=>k==='crypt'?dun||CRYPT.name:'Kragmaw';
const inTown=a=>CITY.some(c=>a.x>=c.x0-1&&a.x<=c.x1+1&&a.y>=c.y0-1&&a.y<=c.y1+1);
const hoursLeft=m=>Math.max(1,Math.ceil(m/60));

// The person who asks when the DM names nobody: in town the gate captain if in earshot, else the nearest townsperson of the
// company's side (or nobody's) in earshot; anywhere else nobody, and the narrator says it.
function townVoice(C,lead){if(!inTown(lead))return null;
  const L=people().filter(p=>Number.isFinite(p.x)&&dist(p,lead)<=CALL.EAR&&(p.fac==null||p.fac<0||p.fac===C.fac));
  return L.sort((x,y)=>(y.role==='captain'?1:0)-(x.role==='captain'?1:0)||dist(x,lead)-dist(y,lead)||x.id-y.id)[0]||null}

function logAnswer(C,L,how){const n=label(C),w=placeWord(L.kind,L.dun),again=' Not asked again for '+CALL.AGAIN_DAYS+' game days.';
  const line=L.answer==='accepted'?n+' answered the call to '+w+(how?' ('+how+')':'')+'.':L.answer==='declined'?n+' declined the call to '+w+(how?' ('+how+')':'')+'.'+again:n+' never answered the call to '+w+'.'+again;
  dmlog('agent',null,[line],{by:'scripted',lever:'call_to',company:C.id,kind:L.kind,answer:L.answer},{heroes:[]})}
// A solo's silence past the wait counts as no. Settled when anyone next reads the call (no tick, no cost to a world without calls).
function settle(C){const r=C&&C.calls,L=r&&r.last;if(!L||L.answer!=='open'||L.until==null||S.gameMin<L.until)return r||null;
  L.answer='unanswered';r.no=Math.round(L.until);logAnswer(C,L);return r}
function answered(C,pass,how){const r=C&&C.calls,L=r&&r.last;if(!L||L.answer!=='open')return;L.answer=pass?'accepted':'declined';if(!pass)r.no=Math.round(S.gameMin);logAnswer(C,L,how)}

// What refuses a call to company C now, in words; null when it may go. The caps read as limits (a wait, not a wrong call).
export function callRefusal(C,kind){const n=label(C),r=settle(C),M=members(C);
  if(!M.length)return 'no such company';
  if(worldHeld())return 'the world is held: the table is not ready for a call';
  if(kind==='raid'&&!S.boss.alive)return 'Kragmaw is not in its lair: there is nothing to ride on';
  if(r&&r.d===dayNo()&&r.n>=CALL.PER_DAY)return 'limit: '+CALL.PER_DAY+' call to '+n+' a game day';
  if(r&&r.no!=null&&S.gameMin-r.no<CALL.AGAIN_DAYS*DAY)return 'limit: '+n+' declined your last call; not asked again for '+hoursLeft(r.no+CALL.AGAIN_DAYS*DAY-S.gameMin)+' game hours';
  if(r&&r.last&&r.last.answer==='open')return n+' has not answered your last call yet';
  const O=openProps(C).find(P=>P.kind==='crypt'||P.kind==='raid');if(O)return 'a '+O.kind+' vote is open among '+n+': it is theirs to settle';
  if(C.wait&&(C.wait.crypt||C.wait.raid))return n+' is already set on '+(C.wait.crypt?dunOf(C).name:'Kragmaw');
  if(sceneFor(C))return 'a scene of '+n+' is open: let it play';
  const g=M.find(a=>cryptOfHero(a));if(g)return g.name+' is in '+cryptOfHero(g).name;
  const b=M.find(a=>BUSY.includes(a.state)||a.raid);if(b)return b.name+' of '+n+(b.state==='raid'||b.raid?' is in a raid':b.state==='dungeon'?' is in '+(cryptOfHero(b)||CRYPT).name:b.state==='downed'?' is down':' is in a fight');
  if(isSolo(C)){const a=M[0];if((a.pq||[]).some(c=>c.kind==='crypt'))return a.name+' is already on the way to '+dunOf(C).name;
    if(kind==='raid'&&!S.raidOn[a.fac])return a.name+' rides alone and can only fall in with a muster that is out, and none of the '+FAC[a.fac].name+' is'}
  return null}

// Registered by installCallLever (sim/index.js, after every module has loaded: the sim's imports are one big cycle).
const CALL_LEVER={name:'call_to',about:'Put the Crypt or a raid to a company, in the world: by, a person within '+CALL.EAR+' tiles of its leader, asks (the gate captain by default in town), else the narrator; text is your words. A company votes on it as on any proposal; a solo answers aloud. '+CALL.PER_DAY+' a company a game day; not again for '+CALL.AGAIN_DAYS+' game days after a no.',
  params:{kind:{type:'enum',values:['crypt','raid']},company:{type:'id'},by:{type:'id',opt:true},text:{type:'str',max:CALL.TEXT_MAX,opt:true}},limits:{perDay:CALL.ALL_DAY},cooldown:0,
  check(p){const C=companyById(p.company);if(!C||!C.ids.length)return 'no such company';
    const e=callRefusal(C,p.kind);if(e)return e;
    if(p.text!=null&&notEnglish(p.text))return 'text must be in English';
    if(p.by!=null){const q=personBy(p.by),L=leaderOfC(C);if(!q)return 'no such person (by)';if(!L||!Number.isFinite(q.x)||dist(q,L)>CALL.EAR)return (q.name||'they')+' is not within '+CALL.EAR+' tiles of '+(L?L.name:'the leader')+' (earshot)'}
    return null},
  apply(p){const C=companyById(p.company),L=leaderOfC(C),solo=isSolo(C),D=dunOf(C),q=p.by!=null?personBy(p.by):townVoice(C,L),who=q?full(q):'The narrator';
    const T=CALL_LINES[p.kind][solo?'solo':'company'],line=clean(p.text,CALL.TEXT_MAX)||T[hashN(C.id+':'+dayNo())%T.length].replace('{crypt}',D.name).replace('{fac}',FAC[C.fac].name);
    // spoken: to those in earshot of the person (or of the leader, for the narrator) and the leader, as bestow says a name
    const e={t:clockStr(),d:dayNo(),from:q?{kind:'npc',id:q.id,name:q.name,fac:q.fac}:NARRATOR,text:line,trigger:q?'npc':'dm',dm:true};
    const at=q||L,hs=S.agents.filter(b=>living(b)&&!b.hidden&&(b===L||dist(b,at)<=HEAR));
    for(const b of hs){(b.chat||(b.chat=[])).push(e);if(b.chat.length>CHAT_CAP)b.chat.shift();hear(b,line,who)}
    if(q){q.bubble={text:line,life:BUBBLE};q.chatCd=Math.max(q.chatCd||0,10)}
    const r=C.calls||(C.calls={d:-1,n:0});if(r.d!==dayNo()){r.d=dayNo();r.n=0}r.n++;
    r.last={kind:p.kind,by:who,line,gm:Math.round(S.gameMin),day:dayNo(),answer:'open'};if(p.kind==='crypt'&&D!==CRYPT)r.last.dun=D.name; // only a dungeon past the first is named, so a one-dungeon world keeps its saves
    const eff={company:label(C),kind:p.kind,by:who,line,heard_by:hs.length};
    if(solo){r.last.until=Math.round(S.gameMin+CALL.ANSWER_MIN);if(p.kind==='crypt')heardOf(L,{kind:'landmark',name:D.name},who);
      notify(L,who+' asks you: "'+line+'" Answer aloud: answer_call {answer: accept|decline, line}.',3);
      return {ok:true,effect:{...eff,question:'open for '+Math.round(CALL.ANSWER_MIN/60)+' game hours'}}}
    const P=askCompany(C,p.kind,{src:'dm',caller:who,details:line,...(p.kind==='crypt'&&D!==CRYPT?{dun:D.name}:{})});
    if(typeof P==='string'){delete r.last;r.n--;return {ok:false,effect:P}}
    r.last.prop=P.id;return {ok:true,effect:{...eff,proposal:P.id,status:P.status}}},
  describe:p=>'the '+p.kind+' put to company #'+p.company};
// A vote the DM's call opened has settled (council.js resolveProp): the company's yes or no, as the vote says it.
export function installCallLever(){if(LEVERS.call_to)return;register(CALL_LEVER);setCallHook((C,P,pass)=>answered(C,pass,clean(P.result,60)))}

// ---- the solo's answer (sim/player.js) ----
// The question standing for hero a, or null: {kind, by, line, until}.
export function callFor(a){const C=companyOf(a);if(!isSolo(C))return null;const r=settle(C),L=r&&r.last;return L&&L.answer==='open'&&L.until!=null?L:null}
// The hero's answer, already said aloud.
export const callAnswered=(a,pass,how)=>answered(companyOf(a),pass,how);
// An order to the place asked of it is a yes too (go_crypt, join_raid).
export function callTaken(a,kind){const L=callFor(a);if(L&&L.kind===kind)callAnswered(a,true,'set out by its own order')}
// For the turn header: the question still standing.
export function callBrief(a){const L=a&&a.player?callFor(a):null;return L?{by:L.by,line:L.line,left:hoursLeft(L.until-S.gameMin)}:null}

// ---- for the DM ----
// The last call to company C, so the DM does not nag; null before any.
export function lastCall(C){const r=settle(C),L=r&&r.last;if(!L)return null;const wait=r.no!=null?r.no+CALL.AGAIN_DAYS*DAY-S.gameMin:0;
  return {kind:L.kind,by:L.by,day:L.day,hours_ago:Math.round((S.gameMin-L.gm)/60),answer:L.answer,...(wait>0?{not_again_for_hours:hoursLeft(wait)}:{})}}
// What the DM knows of the Crypt and the muster for this company: a line, or null. Never a hero's prompt; passing it on is the DM's choice.
const YOURS=' Yours to know, not theirs: they learn of it only if you pass it on (call_to, a rumour, a person).';
export function musterWord(C,quiet){const M=members(C);if(C.wait&&(C.wait.crypt||C.wait.raid))return null;if(M.some(a=>cryptOfHero(a)))return null;
  if(S.boss.alive&&S.raidOn[C.fac]&&!M.some(a=>a.raid))return 'The '+FAC[C.fac].name+' muster is out against Kragmaw.'+YOURS;
  const G=CRYPTS.find(D=>D.group&&D.group.phase==='gather'&&D.group.fac===C.fac);
  if(G)return 'A background group of the '+FAC[C.fac].name+' gathers at '+G.name+'.'+YOURS;
  const D=dunOf(C);return quiet&&!D.group?D.name+' stands free.'+YOURS:null}
