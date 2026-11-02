// Talking takes presence (issue #182). Owned by ai-designer. DOM-free, no RNG, no imports from council.js.
//   shout range  the party channel carries SHOUT tiles (about 12), less in fog and storms (weather.js sightMul).
//                Same town or camp changes nothing: only distance does. `say` stays at earshot (chat.js HEAR, 7).
//   plans        a meeting plan (a place and a game time) made when the party splits, recorded for those who were
//                there as an open thread (fellowship.js openThreads) and a notebook memory (#155).
//   couriers     the one way to reach someone out of range: a paid courier hired at a town gate who takes game
//                hours to arrive (D&D style: slow, costs gold, arrives as an in-game event and a chat line).
// Plain data, saved with the world: F.plans [{id,where,at,atText,made,by,byName,who,whoNames,status}], F.post [{id,from,to,text,sent,due,cost}].
import {S,clockStr} from './state.js';
import {dist,zoneAt} from '../world/map.js';
import {sightMul} from './weather.js';
import {fellows,fellowParty,campaign,setWitness} from './fellowship.js';
import {remember} from './memory.js';
import {notify} from './notify.js';
import {addHeroNote} from './notebook.js';

export const REACH={SHOUT:12,MIN:5,PLAN_MIN_H:1,PLAN_MAX_H:48,PLAN_GRACE:720,PLANS_MAX:8,
  COURIER_BASE:90,COURIER_PER_TILE:6,FEE_BASE:3,FEE_TILE:10,COURIER_MAX:3,TEXT:200};
const gd=t=>({t,c:'gd'});
const living=a=>a&&a.state!=='dead';
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
export const stamp=m=>{const d=Math.floor(m/1440)+1,x=Math.floor(m)%1440;return 'day '+d+', '+String(Math.floor(x/60)).padStart(2,'0')+':'+String(x%60).padStart(2,'0')};

// How far the speaker's voice carries now: 12 tiles, shorter in fog and storms.
export const shoutRange=a=>Math.max(REACH.MIN,Math.round(REACH.SHOUT*sightMul(zoneAt(a.x,a.y))));
export const inRange=(a,b)=>!!(a&&b&&living(a)&&living(b)&&!a.hidden&&!b.hidden&&dist(a,b)<=shoutRange(a));
// The Fellowship members out of range of a (for status and lead_to).
export const outOfRange=a=>fellows().filter(b=>b!==a&&!inRange(a,b));
// Every living member within range of the leader (or of the first member): the Crypt and raid need all of them.
export function together(L,lead){L=L||fellows();if(!L.length)return false;const h=lead&&L.includes(lead)?lead:L[0];return L.every(b=>b===h||inRange(h,b))}
export const nameList=L=>L.length<3?L.map(b=>b.name).join(' and '):L.slice(0,-1).map(b=>b.name).join(', ')+' and '+L[L.length-1].name;

// ---- meeting plans ----
export function makePlan(a,where,hours){const F=S.fellowship;if(!F||!a.fellow)return {error:'Only a Fellowship member makes a plan.'};
  const w=clean(where,60);if(!w)return {error:'Say where to meet (a place or town).'};
  const h=Math.round(Number(hours));if(!(h>=REACH.PLAN_MIN_H&&h<=REACH.PLAN_MAX_H))return {error:'Say when: hours from now, '+REACH.PLAN_MIN_H+'-'+REACH.PLAN_MAX_H+'.'};
  const here=[a,...fellows().filter(b=>b!==a&&inRange(a,b))],at=Math.round(S.gameMin+h*60),atText=stamp(at);
  const P={id:F.planSeq=(F.planSeq||0)+1,where:w,at,atText,made:Math.round(S.gameMin),by:a.id,byName:a.name,who:here.map(b=>b.id),whoNames:here.map(b=>b.name),status:'open'};
  (F.plans||(F.plans=[])).unshift(P);if(F.plans.length>REACH.PLANS_MAX)F.plans.pop();
  const text='We meet again at '+w+' at '+atText+' ('+here.map(b=>b.name).join(', ')+' agreed).';
  for(const b of here){remember(b,'plan',text);if(b.player)addHeroNote(b,{title:'Meet at '+w,text,tags:['plan','meeting'],about:w});
    if(b!==a)notify(b,a.name+' sets a meeting: '+w+' at '+atText+'. Be there.',true)}
  campaign('council',a,' sets a meeting for the Fellowship: '+w+' at '+atText+' ('+here.map(b=>b.name).join(', ')+' know).');
  return P}
export const openPlans=()=>((S.fellowship&&S.fellowship.plans)||[]).filter(p=>p.status==='open');

// ---- couriers ----
export const courierCost=d=>REACH.FEE_BASE+Math.ceil(d/REACH.FEE_TILE);
export const courierDelay=d=>REACH.COURIER_BASE+Math.round(d*REACH.COURIER_PER_TILE);
export function sendCourier(a,to,text){const F=S.fellowship;if(!F||!a.fellow)return {error:'Only a Fellowship member can hire the Fellowship\'s courier.'};
  if(a.state!=='town')return {error:'Couriers are hired at your town gate. Go home first.'};
  const key=String(to==null?'':to).trim().toLowerCase(),b=fellows().find(x=>x!==a&&(x.name.toLowerCase()===key||String(x.id)===key));
  if(!b)return {error:'No living companion called "'+clean(to,30)+'" in the Fellowship.'};
  if(inRange(a,b))return {error:b.name+' is close enough to hear you: use party_say.'};
  const t=clean(text,REACH.TEXT+1);if(!t)return {error:'Send what?'};
  if(t.length>REACH.TEXT)return {error:'Too long: keep it under '+REACH.TEXT+' characters.'};
  const P=F.post||(F.post=[]);if(P.filter(m=>m.from===a.id).length>=REACH.COURIER_MAX)return {error:'You already have '+REACH.COURIER_MAX+' couriers out.'};
  const d=dist(a,b),cost=courierCost(d);if(a.gold<cost)return {error:'A courier to '+b.name+' costs '+cost+'g; you have '+a.gold+'g.'};
  a.gold-=cost;const m={id:F.postSeq=(F.postSeq||0)+1,from:a.id,fromName:a.name,to:b.id,toName:b.name,text:t,sent:Math.round(S.gameMin),due:Math.round(S.gameMin+courierDelay(d)),cost};P.push(m);
  remember(a,'courier','I paid '+cost+'g for a courier to carry word to '+b.name+': "'+t.slice(0,80)+'".');
  campaign('council',a,' pays a courier to carry word to ',b,'.');
  return {msg:m,hours:Math.round((m.due-S.gameMin)/6)/10}}

// ---- catching up after an absence ----
// A member out of shouting range of the main company is "apart" (b.apartSince). Meanwhile each beat the company
// witnesses is kept as a short fact (b.missed: {k kind, l label}, 12 at most; no text beyond the label). When the
// member is back after AWAY_MIN game minutes the game tells ONE present member what was missed and asks them to
// say it; the returner is only told to ask. The facts never reach the returner except through what is said in
// game (#123); if nobody speaks to them within TOLD_WAIT minutes their turn header says they have not been told.
export const AWAY={MIN:120,TOLD_WAIT:30,TTL:720,KINDS:['council','scene','npc','death','outcome','recruit','complication']};
export function witness(kind,label){if(!AWAY.KINDS.includes(kind))return;
  for(const b of fellows())if(b.apartSince!=null){const M=b.missed||(b.missed=[]);if(M.length&&M[M.length-1].l===label)continue;M.push({k:kind,l:label});if(M.length>12)M.shift()}}
setWitness(witness);
// Anyone in the company who speaks to a returner has told them something.
export function toldBy(speaker,hearers){for(const b of hearers)if(b!==speaker&&b.catchUp&&!b.catchUp.told)b.catchUp.told=true}
export const notTold=a=>!!(a&&a.catchUp&&!a.catchUp.told&&S.gameMin>=a.catchUp.at+AWAY.TOLD_WAIT&&S.gameMin<a.catchUp.at+AWAY.TTL);
export const NOT_TOLD='You have not been told what happened while you were away: ask your companions (party_say).';
function clusters(L){const seen=new Set(),out=[];
  for(const a of L){if(seen.has(a))continue;const c=[a];seen.add(a);for(let i=0;i<c.length;i++)for(const b of L)if(!seen.has(b)&&inRange(c[i],b)){seen.add(b);c.push(b)}out.push(c)}return out}
function absence(F){const L=fellows();
  if(L.length<2){for(const b of L){delete b.apartSince;delete b.missed}return}
  const P=fellowParty(),cs=clusters(L);let main=cs[0];for(const c of cs)if(c.length>main.length||(c.length===main.length&&P&&c.includes(P.leader)&&!main.includes(P.leader)))main=c;
  for(const b of L){
    if(!main.includes(b)){if(b.apartSince==null){b.apartSince=Math.round(S.gameMin);b.missed=[]}continue}
    if(b.apartSince==null)continue;
    const gone=S.gameMin-b.apartSince,miss=b.missed||[];delete b.apartSince;delete b.missed;
    if(gone<AWAY.MIN)continue;
    const hrs=Math.round(gone/60),teller=(P&&main.includes(P.leader)&&P.leader!==b?P.leader:main.find(x=>x!==b))||null,facts=miss.length?miss.map(m=>m.l).join('; '):'nothing of note';
    b.catchUp={at:Math.round(S.gameMin),told:false,by:teller?teller.id:null};
    campaign('council',b,' is back with the company after '+hrs+' hours away.');
    if(teller)notify(teller,b.name+' is back after '+hrs+' hours away. While they were gone the company saw: '+facts+'. Catch them up (party_say), in your own words.',2);
    notify(b,'You are back with the company after '+hrs+' hours away. Ask what you missed (party_say), then remember what matters.',2);
    remember(b,'return','Back with the company after '+hrs+' hours apart; I should ask what I missed.')}
  for(const b of L)if(b.catchUp&&S.gameMin>=b.catchUp.at+AWAY.TTL)delete b.catchUp}

export function reachTick(){const F=S.fellowship;if(!F)return;absence(F);
  // couriers: due messages arrive as events and chat lines; a fallen reader gets only a grave
  if(F.post&&F.post.length){const keep=[];
    for(const m of F.post){if(S.gameMin<m.due){keep.push(m);continue}
      const from=S.agents.find(x=>x.id===m.from),to=S.agents.find(x=>x.id===m.to);
      if(!living(to)){if(living(from))notify(from,'Your courier came back: '+m.toName+' has fallen. The message was not delivered.',true);continue}
      const e={t:clockStr(),from,text:m.text,trigger:'courier',party:true,courier:true,heard:[to.name],far:[]};
      (to.chat||(to.chat=[])).push(e);if(to.chat.length>20)to.chat.shift();
      notify(to,'A courier finds you with word from '+m.fromName+' (sent '+stamp(m.sent)+'): "'+m.text+'"',true,2);
      remember(to,'courier',m.fromName+' sent word by courier: "'+m.text.slice(0,100)+'".');
      if(living(from))notify(from,'Your courier reached '+m.toName+'.',false)}
    F.post=keep}
  // meeting plans: ring the hour, close when they are together again, give up long after
  for(const p of F.plans||[]){if(p.status!=='open')continue;const L=fellows();
    if(!p.rung&&S.gameMin>=p.at){p.rung=1;for(const id of p.who){const b=S.agents.find(x=>x.id===id);if(living(b))notify(b,'The hour has come for the meeting at '+p.where+'.',true)}}
    const tg=together(L);if(!tg)p.apart=1;
    if(p.apart&&tg){p.status='met';campaign('council',gd(F.name),' are together again.');for(const b of L)remember(b,'plan','We are all together again after the meeting at '+p.where+'.')}
    else if(S.gameMin>p.at+REACH.PLAN_GRACE){p.status='missed';campaign('council','The meeting at '+p.where+' ('+p.atText+') came and went without the Fellowship together.');for(const b of L)remember(b,'plan','The meeting at '+p.where+' never happened: we missed each other.')}}}
