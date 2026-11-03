// Offers to ride together (epic #402, issue #442): invite, accept, decline, join_party toward an agent hero, and the
// scripted companions an invite can bring in. DOM-free, no sim RNG (a scripted invitee answers by a hash of the two ids
// and the game day). Owned by ai-designer. The tools are in data/player-tools.js; sim/player.js only calls in here.
//
// An offer is said aloud (heroes in earshot hear it) and kept on the company of the hero who made it:
//   C.offers=[{id, kind:'invite'|'ask', from, to, until, text}]
//   invite: `from` offers `to` a place in from's company (a solo's invite forms a company of two).
//   ask:    join_party toward an agent hero: `from` asks `to` (the leader of that hero's company) to be let in.
// The one asked answers through its own runner (accept / decline); an unanswered offer lapses after PARTY.OFFER_MIN
// game minutes. A scripted hero answers at once by its traits and joins as a companion (a.companion = company id):
// it rides by reflex (the scripted rules, following the company's walking party), never leads, and leaves when no
// agent is left in the company.
// The classic five-slot Fellowship keeps its roster: it takes no one in and gives no one away through these verbs.
import {S,clockStr} from './state.js';
import {hash} from '../core/rng.js';
import {zoneFor,dist} from '../world/map.js';
import {homeOf} from '../data/races.js';
import {FAC} from '../data/factions.js';
import {tm} from '../data/traits.js';
import {COMPANION_LINES} from '../data/companions.js';
import {PARTY,companyOf,members,minds,isSolo,leaveCompany,soloFor,joinCompany,dissolveCompany,linkParty,campaign,LOG_CAP} from './company.js';
import {leaveParty} from './party.js';
import {speak,agentLine,sayHearers} from './chat.js';
import {ev} from './notify.js';
import {record} from './history.js';
import {log} from './chronicle.js';
import {bondEvent} from './bonds.js';
import {spokenLine,leaderOfC,openProps,COUNCIL} from './council.js';
import {bond} from './bonds.js';
import {remember} from './memory.js';
import {notify} from './notify.js';
import {earshot} from './earshot.js';
import {inRange,placeNear,stamp} from './reach.js';
import {notEnglish} from './lang.js';
import {tableView} from './table.js';

export const OFFER={JOIN:6,BUSY:['dungeon','raid','duel','ghost','camp'],FIGHT:['fight','assist'],CHANCE:.6,STRONGER:.45,MUSTER:12,LEN:200}; // JOIN: keep equal to PK.JOIN (sim/player.js)

const hero=id=>S.agents.find(x=>x.id===id)||null;
const alive=a=>!!a&&a.kind==='hero'&&a.state!=='dead';
const gd=t=>({t,c:'gd'});
const r1=v=>Math.round(v*10)/10;
const hhmm=m=>{const x=Math.floor(m)%1440;return String(Math.floor(x/60)).padStart(2,'0')+':'+String(x%60).padStart(2,'0')};
const busyWord={dungeon:'down in a dungeon',raid:'on a raid',duel:'in a duel',ghost:'a ghost',camp:'at camp',fight:'in a fight',assist:'in a fight'};
const FELLOW='The Fellowship rides as five sworn places and takes no one else in, nor lets anyone go, by invitation.';
const no=error=>({ok:false,error});
const pick=(L,a,b)=>L[Math.floor(hash(a.id,b.id,Math.floor(S.gameMin/1440)+11)*L.length)%L.length];

// ---- reading ----
export const isCompanion=a=>!!a&&a.companion!=null;
export function allOffers(){const out=[];for(const C of S.companies||[])for(const o of C.offers||[])out.push(o);return out}
const live=o=>o&&S.gameMin<o.until&&alive(hero(o.from))&&alive(hero(o.to));
export const offersTo=a=>allOffers().filter(o=>o.to===a.id&&live(o)).sort((x,y)=>x.id-y.id);
export const offersFrom=a=>allOffers().filter(o=>o.from===a.id&&live(o)).sort((x,y)=>x.id-y.id);
function dropOffer(o){for(const C of S.companies||[])if(C.offers){const i=C.offers.indexOf(o);if(i>=0){C.offers.splice(i,1);if(!C.offers.length)delete C.offers;return}}}
// The company's leader for these verbs: an agent member, never a companion (council.js leaderOfC).
const lead=C=>leaderOfC(C);
const words=C=>C.ids.length>1?C.name+' ('+C.ids.length+')':'you alone';
// What the hero's runner sees in its state header (sim/pace.js): offers open to it, by id.
export function offersBrief(a){const L=offersTo(a);if(!L.length)return null;
  return L.map(o=>{const f=hero(o.from);return {id:o.id,kind:o.kind,from:f.name,...(o.text?{said:o.text}:{}),until:hhmm(o.until),answer:'accept {offer_id:'+o.id+'} or decline {offer_id:'+o.id+'}'}})}
// The company as the hero knows it (sim/pace.js): names only, who is within shouting range, never where the others are.
export function companyCard(a){const C=companyOf(a);if(!C||C.ids.length<2)return null;const M=members(C),L=lead(C);
  const tag=b=>b.name+(isCompanion(b)?' (companion)':'');
  return {name:C.name,size:M.length,minds:minds(C).length,leader:L?L.name:null,with_you:M.filter(b=>b!==a&&inRange(a,b)).map(tag),apart:M.filter(b=>b!==a&&!inRange(a,b)).map(tag)}}

// ---- shared refusals ----
// Why b cannot ride with company C (joining as an agent mind or a companion), or null.
function roomFor(C,b){if(C.ids.length>=PARTY.MAX)return C.name+' already holds '+PARTY.MAX+' heroes, the most a company can.';
  if(b.player&&minds(C).length>=PARTY.MINDS)return C.name+' already has '+PARTY.MINDS+' who choose their own road, the most a company can; '+b.name+' cannot join it.';
  return null}
function pending(C){if(C.wait&&(C.wait.crypt||C.wait.raid))return 'Your company is answering a call to the Crypt or a raid; settle that first.';
  if(openProps(C).some(P=>P.kind==='crypt'||P.kind==='raid'))return 'A vote on the Crypt or a raid is open in your company; settle it first.';return null}
// Said aloud: the offer is heard by everyone in earshot (in-game channels, #123). -> {text, heard} or {error}.
function sayAloud(a,text,dflt){let t=dflt;if(text!=null&&String(text).trim()){const L=spokenLine(a,text,OFFER.LEN);if(L.error)return {error:L.error};t=L.text}
  if(notEnglish(t))return {error:'Not said: speak in English. Everyone in Eldmoor speaks English; say it again in English.'};
  agentLine(a,speak(a,t,'agent'));return {text:t,heard:sayHearers(a).length}}
function newOffer(C,kind,from,to,text){const o={id:S.offerSeq=(S.offerSeq||0)+1,kind,from:from.id,to:to.id,until:Math.round(S.gameMin+PARTY.OFFER_MIN),text};(C.offers||(C.offers=[])).push(o);return o}

// ---- scripted invitees (#442): traits decide, a hash of the ids stands in for the mood of the day ----
// -> {join:true} or {join:false, why}. No RNG: the same pair asked again the same day gets the same answer.
export function scriptedAnswer(a,b,C){if(tm(b,'social')<=0)return {join:false,why:'loner'};
  if(Math.abs(b.lvl-a.lvl)>3)return {join:false,why:'gap'};
  if(b.party)return {join:false,why:'party'};
  if(b.adv)return {join:false,why:'job'};
  if(members(C).some(m=>(b.nemesis&&b.nemesis[m.id])||(m.nemesis&&m.nemesis[b.id])))return {join:false,why:'grudge'};
  const p=b.lvl>a.lvl+1?OFFER.STRONGER:OFFER.CHANCE;
  return hash(a.id,b.id,Math.floor(S.gameMin/1440)+7)<p?{join:true}:{join:false,why:'no'}}
const WHY={loner:'is a loner and will not ride with anyone',gap:'is too far from you in level (more than 3)',party:'already rides with a party',job:'has a job of their own under way',grudge:'holds a grudge against someone in your company',no:'does not want to, today'};

// ---- joining ----
// joiner rides with C from now on: the joiner's own solo log folds in, one `join` line in C's log, bonds, events.
function joinInto(C,joiner,asker){const old=companyOf(joiner),wasSolo=!!(old&&old!==C&&old.ids.length===1);
  if(wasSolo&&old.log.length){for(const e of old.log)C.log.push({...e,folded:old.id});C.log.sort((x,y)=>(y.gameMin||0)-(x.gameMin||0));if(C.log.length>LOG_CAP)C.log.length=LOG_CAP}
  if(joiner.party)leaveParty(joiner);
  const r=joinCompany(C,joiner);if(!r.ok)return r;
  if(!joiner.player)joiner.companion=C.id;else joiner.partyOk=true;
  if(asker&&asker.player)asker.partyOk=true;
  const L=lead(C)||asker,M=members(C);
  if(C.ids.length===2&&M.some(b=>b.name===C.name))C.name=L.name+'’s company'; // a solo's company keeps its leader's name
  campaign(C,'join',joiner,' rides with ',gd(C.name),isCompanion(joiner)?' (a companion)':'',' now.');
  bondEvent(L,'party',M);
  record(joiner,'Rode with ',gd(C.name),', led by ',L,'.');
  for(const b of M)if(b!==joiner){record(b,joiner.name+' rides with the company now.');if(b.player)ev(b,joiner.name+' rides with your company now ('+M.map(x=>x.name).join(', ')+').',true)}
  if(joiner.player)ev(joiner,'You ride with '+C.name+' now ('+M.map(x=>x.name).join(', ')+'); '+L.name+' leads.',true);
  log(joiner,' rides with ',gd(C.name),' now.');
  return {ok:true,company:C}}

// ---- the verbs (sim/player.js handlers call these with the hero already found) ----
// invite: a offers b a place in a's company (a solo forms one).
export function invite(a,b,text){if(a.state==='ghost')return no('Ghosts do not speak.');
  if(tableView(a))return no('Not while a scene is open at the table: act in it first (scene_act).');
  if(!b||b===a)return no(b===a?'You cannot invite yourself.':'No such hero.');
  const A=companyOf(a)||soloFor(a);if(!A)return no('You ride with no company.');if(A.slots)return no(FELLOW);
  if(b.fac!==a.fac)return no(b.name+' is of the '+FAC[b.fac].name+'; a company is of one faction.');
  if(dist(a,b)>OFFER.JOIN)return no(b.name+' is too far away to ask face to face ('+r1(dist(a,b))+' tiles; within '+OFFER.JOIN+'). move_to {target: "'+b.name+'"} first.');
  if(A.ids.includes(b.id))return no(b.name+' already rides with you.');
  if(OFFER.BUSY.includes(b.state)||OFFER.FIGHT.includes(b.state))return no(b.name+' is '+busyWord[b.state]+'; ask when they are free.');
  const B=companyOf(b);
  if(B&&B.slots)return no(b.name+' is of the Fellowship. '+FELLOW);
  if(B&&B.ids.length>1){const L=lead(B);return no(L===b?b.name+' leads '+B.name+' ('+B.ids.length+') and will not leave them; an invite asks one hero. Talk it over with them instead.':b.name+' rides with '+B.name+'; they would have to leave it first.')}
  const room=roomFor(A,b);if(room)return no(room);
  const p=pending(A);if(p)return no(p);
  if(offersFrom(a).some(o=>o.to===b.id))return no('You already asked '+b.name+'; they have until '+hhmm(offersFrom(a).find(o=>o.to===b.id).until)+' to answer.');
  {const back=offersTo(a).find(o=>o.from===b.id);if(back)return no(b.name+' already asked you: accept {offer_id: '+back.id+'} to ride together.')}
  const s=sayAloud(a,text,'Ride with me, '+b.name+'?');if(s.error)return no(s.error);
  if(b.player){const o=newOffer(A,'invite',a,b,s.text);
    ev(b,a.name+' asks you to ride with '+(A.ids.length>1?'their company, '+A.name+' ('+A.ids.length+')':'them')+': "'+s.text+'" (accept {offer_id: '+o.id+'} or decline {offer_id: '+o.id+'}; the offer stands until '+hhmm(o.until)+').',2);
    return {ok:true,said:s.text,heard_by:s.heard,offer:o.id,until:hhmm(o.until),note:b.name+' answers in their own time (accept or decline), within '+PARTY.OFFER_MIN+' game minutes. Stay near: accepting needs you within '+OFFER.JOIN+' tiles.'}}
  // a scripted hero answers at once, by its traits
  const ans=scriptedAnswer(a,b,A);
  if(!ans.join){const line=pick(COMPANION_LINES.decline[ans.why],a,b);if(S.worldVoice!=='dm')speak(b,line,'answer');
    record(a,b.name+' would not ride with us.');return {ok:true,said:s.text,heard_by:s.heard,joined:false,answer:'"'+line+'" ('+b.name+')',why:b.name+' '+WHY[ans.why]+'.'}}
  const line=pick(COMPANION_LINES.accept,a,b);if(S.worldVoice!=='dm')speak(b,line,'answer');
  const r=joinInto(A,b,a);if(!r.ok)return no(r.error);
  return {ok:true,said:s.text,heard_by:s.heard,joined:true,answer:'"'+line+'" ('+b.name+')',company:A.name,with:members(A).map(x=>x.name),
    note:b.name+' rides with you as a companion: they follow the company’s leader, fight, heal and flee by their own instincts, and never lead. They leave when no one who chooses their own road is left in the company.'}}

// join_party toward an agent hero (or a companion of a company): an offer to that company's leader. Returns null when
// the old join_party rules apply (a plain scripted hero or party), else the result.
export function askToJoin(a,b){const A=companyOf(a),B=companyOf(b);
  if(!b.player&&!isCompanion(b)){if(A&&!A.slots&&A.ids.length>1)return no('You ride with '+A.name+'; invite {name: "'+b.name+'"} to bring '+b.name+' into your company instead.');return null}
  if(A&&A===B){a.partyOk=true;delete a.splitUntil;return {ok:true,note:'You fall in with '+A.name+' again the next time you are near them.'}}
  if(B&&B.slots)return no(b.name+' is of the Fellowship. '+FELLOW);
  if(A&&A.slots)return no(FELLOW);
  if(a.state==='ghost')return no('Ghosts do not speak.');
  if(tableView(a))return no('Not while a scene is open at the table: act in it first (scene_act).');
  if(b.fac!==a.fac)return no(b.name+' is of the '+FAC[b.fac].name+'; a company is of one faction.');
  if(A&&A.ids.length>1)return no('You ride with '+A.name+'; you would have to leave it first. Or invite {name: "'+b.name+'"} into yours.');
  const C=B||soloFor(b),L=lead(C)||b;
  if(dist(a,L)>OFFER.JOIN)return no(L===b?b.name+' is too far away to ask face to face ('+r1(dist(a,b))+' tiles; within '+OFFER.JOIN+'). move_to {target: "'+b.name+'"} first.':b.name+' rides with '+C.name+', led by '+L.name+'; ask '+L.name+' face to face (within '+OFFER.JOIN+' tiles).');
  if(OFFER.BUSY.includes(L.state)||OFFER.FIGHT.includes(L.state))return no(L.name+' is '+busyWord[L.state]+'; ask when they are free.');
  const room=roomFor(C,a);if(room)return no(room);
  if(offersFrom(a).some(o=>o.to===L.id))return no('You already asked '+L.name+'; they have until '+hhmm(offersFrom(a).find(o=>o.to===L.id).until)+' to answer.');
  {const back=offersTo(a).find(o=>o.from===L.id);if(back)return no(L.name+' already asked you: accept {offer_id: '+back.id+'} to ride together.')}
  const s=sayAloud(a,null,'May I ride with you, '+L.name+'?');if(s.error)return no(s.error);
  const mine=A||soloFor(a),o=newOffer(mine,'ask',a,L,s.text);
  ev(L,a.name+' asks to ride with '+(C.ids.length>1?'your company, '+C.name:'you')+': "'+s.text+'" (accept {offer_id: '+o.id+'} or decline {offer_id: '+o.id+'}; until '+hhmm(o.until)+').',2);
  return {ok:true,said:s.text,heard_by:s.heard,offer:o.id,asked:L.name,until:hhmm(o.until),note:L.name+' answers in their own time (accept or decline), within '+PARTY.OFFER_MIN+' game minutes.'}}

function findOpen(a,offer_id){const id=Number(offer_id),o=allOffers().find(x=>x.id===id&&x.to===a.id);
  const mine=offersTo(a);const list=mine.length?' Offers open to you: '+mine.map(x=>x.id+' from '+hero(x.from).name).join(', ')+'.':' No offer is open to you.';
  if(!Number.isFinite(id))return {error:'Give offer_id (a number from the event or your state header).'+list};
  if(!o)return {error:'No offer '+id+' is open to you.'+list};return {o}}

// accept: the one asked joins (an invite) or lets the asker in (an ask).
export function accept(a,{offer_id}={}){const f=findOpen(a,offer_id);if(f.error)return no(f.error);const o=f.o,from=hero(o.from);
  if(S.gameMin>=o.until){dropOffer(o);return no('That offer lapsed at '+hhmm(o.until)+'. Ask them again (invite) if you still want it.')}
  if(!alive(from)){dropOffer(o);return no((from?from.name:'They')+' can no longer ride with anyone.')}
  if(tableView(a))return no('Not while a scene is open at the table: act in it first (scene_act).');
  if(OFFER.BUSY.includes(a.state))return no('Not while you are '+busyWord[a.state]+'.');
  if(dist(a,from)>OFFER.JOIN)return no(from.name+' has walked on ('+r1(dist(a,from))+' tiles away). Come within '+OFFER.JOIN+' tiles (move_to {target: "'+from.name+'"}) and accept again before '+hhmm(o.until)+'.');
  const joiner=o.kind==='ask'?from:a,host=o.kind==='ask'?(companyOf(a)||soloFor(a)):(companyOf(from)||soloFor(from));
  if(!host)return no('There is no company to join.');if(host.slots)return no(FELLOW);
  const J=companyOf(joiner);
  if(J&&J!==host&&J.ids.length>1)return no(joiner===a?'You ride with '+J.name+'; leave it first, then accept.':from.name+' rides with '+J.name+' now.');
  if(joiner.fac!==host.fac)return no('A company is of one faction.');
  const room=roomFor(host,joiner);if(room)return no(room);
  const p=pending(host);if(p)return no(p);
  dropOffer(o);const r=joinInto(host,joiner,o.kind==='ask'?a:from);if(!r.ok)return no(r.error);
  if(from.player)ev(from,a.name+(o.kind==='ask'?' lets you ride with ':' accepts and rides with ')+host.name+' now.',true);
  return {ok:true,company:host.name,with:members(host).map(x=>x.name),leader:(lead(host)||a).name,note:'You ride together now: the leader leads (lead_to), the others follow when they have no order of their own; party_say reaches everyone within shouting range.'}}

// decline: closes the offer; the one who made it hears your line, or sees you shake your head.
export function decline(a,{offer_id,text}={}){const f=findOpen(a,offer_id);if(f.error)return no(f.error);const o=f.o,from=hero(o.from);
  let said=null;if(text!=null&&String(text).trim()){if(a.state==='ghost')return no('Ghosts do not speak.');const s=sayAloud(a,text,'');if(s.error)return no(s.error);said=s.text}
  dropOffer(o);if(from&&from.player)ev(from,a.name+' declines your offer to ride together'+(said?': "'+said+'"':' (shakes their head).'),true);
  return {ok:true,declined:o.id,said:said||undefined,note:from?from.name+' knows your answer.':undefined}}

// ---- once per step (sim/index.js, after the Fellowship tick): offers lapse, companies of 2+ keep a walking party ----
// Touches only companies other than the five-slot Fellowship: a world without invites is unchanged (no RNG, no uid).
const loose=b=>b.state==='hunt'||b.state==='travel'||b.state==='follow'||b.state==='regroup';
export function companionTick(){const L=S.companies;if(!L||!L.length)return;
  for(const C of L.slice()){if(C.offers)for(const o of C.offers.slice())if(!live(o)){dropOffer(o);const f=hero(o.from),t=hero(o.to);
      if(alive(f)&&f.player&&S.gameMin>=o.until)ev(f,(t?t.name:'They')+' did not answer your offer to ride together.',false)}
    if(C.slots)continue;
    const M=members(C);
    if(M.length&&!M.some(b=>b.player)){for(const b of M)if(isCompanion(b))release(C,b,'with no one left to lead them');if(!C.ids.length)dissolveCompany(C,'parted');continue}
    if(M.length>1)walk(C,M)}}
// A companion leaves the company: walks home, back to the scripted rules.
export function release(C,b,why){if(b.party)leaveParty(b);delete b.companion;if(b.company===C.id)delete b.company;C.ids=C.ids.filter(id=>id!==b.id);
  if(loose(b)){b.state='return';b.target=null;b.dest=null}
  record(b,'Parted from ',gd(C.name),why?', '+why:'','.');campaign(C,'leave',b,' parted from the company'+(why?', '+why:'')+'.')}
// The company's walking party (as fellowship.js muster does for the Fellowship): formed from members in town or out
// near the leader; companions wait at the gate while the leader is in town, so they do not ride out alone.
function walk(C,M){const ld=lead(C);if(!ld)return;let P=S.parties.find(p=>p.company===C.id)||null;
  const can=b=>!b.hidden&&(isCompanion(b)||b.partyOk)&&!b.splitUntil,near=b=>b.state==='town'||(loose(b)&&dist(b,ld)<OFFER.MUSTER);
  for(const b of M)if(b.party&&b.party!==P&&can(b))leaveParty(b);
  if(P&&P.leader!==ld&&P.mem.includes(ld))P.leader=ld; // never a companion
  if(!P){if(!(ld.state==='town'||loose(ld)))return;const mem=[ld,...M.filter(b=>b!==ld&&!b.party&&can(b)&&near(b))];if(mem.length<2)return;
    P=linkParty({id:++S.uid,fac:C.fac,leader:ld,mem,zone:zoneFor(Math.min(...mem.map(b=>b.lvl)),homeOf(ld).gate),home:false,company:C.id});
    for(const b of mem)b.party=P;S.parties.push(P)}
  else if(!P.home)for(const b of M)if(!b.party&&can(b)&&near(b)){P.mem.push(b);b.party=P}
  if(ld.state==='town')for(const b of M)if(isCompanion(b)&&b.state==='town'&&b.townStep===2)b.wait=Math.max(b.wait||0,.5)}

// ---- leave_party {for_good: yes} (#443): a member leaves its company for good and rides alone, a new solo ----
// The old company's log gets a `leave` line (far companions learn of it on rejoining, reach.js AWAY.KINDS); each
// companion left behind thinks less of the leaver (COUNCIL.BOND_COST, both ways, as a split does). A company never
// ends with zero heroes through this: a leave needs a company of two or more.
export function leaveForGood(a){const C=companyOf(a);
  if(!C||isSolo(C))return no('You ride alone already.');
  if(C.slots)return no('The Fellowship rides as five sworn places; split off for a while (leave_party with a plan) rather than leaving for good.');
  if(tableView(a))return no('Not while a scene is open at the table: act in it first (scene_act).');
  if(OFFER.BUSY.includes(a.state))return no('Not while you are '+busyWord[a.state]+'.');
  if(OFFER.FIGHT.includes(a.state))return no('Not in the middle of a fight.');
  const rest=members(C).filter(b=>b!==a);
  for(const b of rest){for(const [x,y] of [[a,b],[b,a]]){(x.bonds||(x.bonds={}));x.bonds[y.id]=Math.max(-10,bond(x,y)-COUNCIL.BOND_COST)}
    remember(b,'leave',a.name+' left us for good and rides alone now.');notify(b,a.name+' has left the company for good.',false)}
  campaign(C,'leave',a,' left the company for good.');
  if(a.party)leaveParty(a);leaveCompany(a);a.partyOk=false;delete a.catchUp;delete a.apartSince;delete a.missed;delete a.splitUntil;
  record(a,'Left ',gd(C.name),' for good and rode on alone.');remember(a,'leave','I left '+C.name+' for good. I ride alone now.');
  const S1=soloFor(a);
  return {ok:true,company:S1?S1.name:undefined,left:C.name,note:'You ride alone now, a company of one. Your former companions think less of you for it. Use invite or join_party to ride with someone again.'}}

// ---- companions: the company as this hero knows it (#443) ----
// Names, classes and where each was last seen, only as 'beside you' or 'last seen near <place>' with how long ago: never
// coordinates, HP, state or what mind plays them (in-game channels, #123). Folds in earshot (who a say or a shout reaches).
export function companionsView(a){const C=companyOf(a);if(!C||isSolo(C)){const r={ok:true,alone:true,note:'You ride alone. invite someone within '+OFFER.JOIN+' tiles, or join_party, to ride together.'};
    const ofs=offersBrief(a);if(ofs)r.offers_to_you=ofs;const es=earshot(a);if(es&&es.ok)r.earshot=es;return r}
  const seen=a.seen||{},now=S.gameMin;
  const riders=members(C).filter(b=>b!==a).map(b=>{const o={name:b.name,class:b.cls,level:b.lvl+0};
    if(isCompanion(b))o.rides_as='companion';
    if(inRange(a,b))o.at='beside you';
    else{const e=seen[b.id];if(e){const h=Math.max(0,Math.round((now-e.at)/60*10)/10);o.at='last seen near '+e.where+(h>=.2?', '+h+' game hours ago':' just now')}else o.at='not seen since you joined'}
    return o});
  const L=leaderOfC(C),r={ok:true,company:C.name,riders,leader:L?(L===a?'you':L.name):null,size:C.ids.length};
  const plans=(C.plans||[]).filter(p=>p.status==='open'&&p.who.includes(a.id)).map(p=>'Meet at '+p.where+' at '+p.atText);if(plans.length)r.meeting_plans=plans;
  const post=(C.post||[]).filter(m=>m.from===a.id).map(m=>'Courier to '+m.toName+', due '+stamp(m.due));if(post.length)r.couriers_out=post;
  const ofs=offersBrief(a);if(ofs)r.offers_to_you=ofs;
  const mine=offersFrom(a).map(o=>{const t=hero(o.to);return 'Your offer to '+(t?t.name:'someone')+' stands until '+hhmm(o.until)});if(mine.length)r.your_offers=mine;
  const es=earshot(a);if(es&&es.ok)r.earshot=es;
  return r}
