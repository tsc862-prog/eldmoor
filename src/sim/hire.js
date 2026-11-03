// Hero tool: hire (#634). A sellsword, a drover or a guide (or any placed person the DM gave a want of coin, or who made a
// hire offer through npc_offer) rides with an agent hero's company for gold a day, paid up front, as a scripted companion
// (offers.js path: a.companion = the company id, the company's walking party carries it, it fights, flees by instinct,
// never leads and never votes). Agent heroes only (the tool is theirs); no sim RNG beyond makeHero's own, so a seeded
// world with no agent hiring is untouched.
//
// The hire is a real scripted hero (a.hire = the terms) made at the company's lowest level, with the person's name. The
// person leaves the town's people while hired (S.hireAway keeps them) and returns when the hire ends: a townsperson
// to their post (remembering the company in p.hmem), a placed person goes on their way. Days up, a dismissal or an
// expulsion send the hire home (state return); a hire that falls is dead for good (hardcore) and its town mourns.
// A hire that ends in a wipe (the hirer's company fell, or the hire fell with no one left) makes the town's sellswords
// wary for HIRE.WARY_DAYS (S.hireWary[town]).
//   S.hireAway [{p, list:'npcs'|'wanderers', i, hero}]   people out on a hire
//   S.hireWary {town: untilGameMin}
//   a.hire {npc, npcName, role:'blade'|'guide', kind (the person's role), by, cid, days, wage, paid, t, until, town, zone,
//           region, line, over, overAt, why, end:'days'|'dismissed'|'company'|'fell'}
import {S} from './state.js';
import {dist,zoneAt,ZONES,LANDMARKS} from '../world/map.js';
import {homeOf} from '../data/races.js';
import {makeHero,seedLevel} from './heroes.js';
import {PARTY,companyOf,members,soloFor,slotParty,campaign} from './company.js';
import {joinInto,release,roomFor,pending,OFFER,isCompanion} from './offers.js';
import {findPerson} from './talk.js';
import {tableView} from './table.js';
import {attitudeOf} from './levers.js';
import {act as chatAct} from './chat.js';
import {record} from './history.js';
import {log} from './chronicle.js';
import {remember} from './memory.js';
import {ev} from './notify.js';
import {learnPlace} from './lore.js';

const DAY=1440;
export const HIRE={BASE:4,MAX_DAYS:5,RANGE:4,WARY_DAYS:3,GONE_MIN:720,OFFER_MIN:120};
// Who hires out and what rides: kind blade fights beside the company, guide scouts and knows the roads of its region.
// cls is the class list tried in order (the first the company does not already have).
const ROLES={
  sellsword:{kind:'blade',cls:['Warrior','Rogue'],line:'A sellsword: a steady arm, plain about money, gone when the days are up.',open:true},
  drover:{kind:'guide',cls:['Hunter'],line:'A drover who knows the roads and the herds, and does not like to be hurried.',open:true},
  hermit:{kind:'guide',cls:['Wildspeaker'],line:'A hermit who knows the quiet ways and will mend a wound for coin.'},
  stranger:{kind:'blade',cls:['Rogue','Warrior'],line:'A stranger with a blade, paid by the day and asking nothing else.'},
  minstrel:{kind:'blade',cls:['Skald'],line:'A minstrel who will sing the company on for coin.'},
  peddler:{kind:'blade',cls:['Rogue'],line:'A peddler who will carry a pack and a knife for coin.'},
};
const COIN=/\b(coin|coins|gold|silver|pay|paid|wage|wages|hire|hired|purse)\b/i;
const no=error=>({ok:false,error});
const alive=h=>!!h&&h.kind==='hero'&&h.state!=='dead';
const hero=id=>S.agents.find(x=>x.id===id)||null;
const full=p=>(p.title?p.title+' ':'')+p.name;
const gd=t=>({t,c:'gd'});
const nk=s=>String(s==null?'':s).toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();

// ---- reading ----
export const isHire=h=>!!h&&!!h.hire;
// The hire spec for a person (their role, class list and line), or null when they do not hire out.
export function hireKind(p){if(!p)return null;if(p.hireOffer&&S.gameMin<p.hireOffer.until)return ROLES[p.role]||ROLES.stranger;
  const R=ROLES[p.role];if(!R)return null;return R.open||COIN.test(String(p.want||''))?R:null}
export const rate=a=>HIRE.BASE+Math.max(1,Math.round(a.lvl||1)); // gold a day, by the hiring hero's level
// A live offer the DM made through npc_offer for this hero: {price, ...} or null.
const offerFor=(p,a)=>{const o=p&&p.hireOffer;return o&&S.gameMin<o.until&&(o.hero==null||o.hero===a.id)?o:null};
export const priceFor=(p,a)=>{const o=offerFor(p,a);return o&&o.price>0?o.price:rate(a)};
export const hiresOf=C=>members(C).filter(h=>h.hire&&!h.hire.over);
const guideOf=a=>{const C=companyOf(a);return C?members(C).find(h=>h.hire&&!h.hire.over&&h.hire.role==='guide')||null:null};
const wary=town=>!!town&&!!S.hireWary&&S.hireWary[town]>S.gameMin;

// ---- the guide's words: the danger-edge warning (#465) and the region's landmarks as heard of ----
export function guideWords(a,z){const g=guideOf(a);if(!g)return null;const home=g.hire.region,n=ZONES[z];
  return g.name+' (your guide, who knows the roads of '+home+') '+(home===n?'has walked '+n+' and says it plainly: "Not at your strength. I have turned back from it myself."'
    :'knows '+home+', not '+n+', but has heard the same said of it: "'+n+' eats the careless. Be sure of yourself first."')}
function teach(A,g){const z=g.hire.zone;if(z==null)return;
  for(const b of members(A))if(b.player){learnPlace(b,ZONES[z],'told');for(const l of LANDMARKS)if(l.name&&zoneAt(l.x,l.y)===z)learnPlace(b,l.name,'told')}}

// ---- hire ----
const where=C=>C.name||'the company';
function stash(p){for(const list of ['npcs','wanderers']){const L=S[list]||[],i=L.indexOf(p);if(i>=0){L.splice(i,1);(S.hireAway||(S.hireAway=[])).push({p,list,i});return list}}return null}
export function hire(a,{npc,days}={}){
  if(!a.player)return no('Only a hero played by an agent hires.');
  if(a.state==='ghost')return no('Ghosts carry no gold.');
  if(tableView(a))return no('Not while a scene is open at the table: act in it first (scene_act).');
  if(OFFER.FIGHT.includes(a.state))return no('Not in the middle of a fight.');
  if(OFFER.BUSY.includes(a.state))return no('Not while you are '+({dungeon:'down in a dungeon',raid:'on a raid',duel:'in a duel',ghost:'a ghost',camp:'at camp'}[a.state]||a.state)+'.');
  if(npc==null||String(npc).trim()==='')return no('Hire whom? npc: the name or role of a sellsword, drover or guide within '+HIRE.RANGE+' tiles.');
  const n=days==null||days===''?1:Math.round(Number(days));
  if(!Number.isFinite(n)||n<1||n>HIRE.MAX_DAYS)return no('days is 1 to '+HIRE.MAX_DAYS+' (paid up front, a day at a time).');
  const A=companyOf(a)||soloFor(a);if(!A)return no('You ride with no company.');
  const p=findPerson(a,npc,HIRE.RANGE);
  if(p&&p.far)return no(full(p.far)+' is too far away ('+Math.round(p.d*10)/10+' tiles). Come within '+HIRE.RANGE+' tiles.');
  if(!p)return no('No one called "'+String(npc).slice(0,40)+'" within '+HIRE.RANGE+' tiles. A sellsword stands at a town gate, a drover or a guide in the square; talk shows who is near.');
  const R=hireKind(p);
  if(!R)return no(full(p)+' does not hire out. Sellswords and drovers do; so does anyone placed on the road who wants coin.');
  if(p.hired!=null)return no(full(p)+' is already hired.');
  if(wary(p.town))return no('The sellswords of '+p.town+' are wary of hiring out just now; word of a company that fell has gone round. Try again in a few days or ask elsewhere.');
  const att=attitudeOf(p,[a]);
  if(att==='hostile'||att==='wary'||p.hostile||p.mood==='hostile')return no(full(p)+' does not like you enough to ride with you. Win them over first (talk, pay).');
  if(A.ids.length>=PARTY.MAX)return no(where(A)+' already holds '+PARTY.MAX+' heroes, the most a company can.');
  const room=roomFor(A,{});if(room)return no(room);
  const pd=pending(A);if(pd)return no(pd);
  const wage=priceFor(p,a),cost=wage*n;
  if(Math.floor(a.gold||0)<cost)return no('You hold '+Math.floor(a.gold||0)+' gold; '+n+' day'+(n>1?'s':'')+' of '+p.name+' is '+cost+' ('+wage+' a day, paid up front).');
  const lvl=Math.max(1,Math.min(...members(A).map(b=>b.lvl)));
  const have=new Set(members(A).map(b=>b.cls)),cls=R.cls.find(c=>!have.has(c))||R.cls[0];
  // paid, then made
  a.gold-=cost;p.purse=(p.purse||0)+cost;
  const h=makeHero(A.fac,cls,null,1);
  h.name=p.name;if(p.race)h.race=p.race;if(p.skin)h.skin=p.skin;if(p.hair)h.hair=p.hair;
  seedLevel(h,lvl);h.gold=0;h.x=a.x+(a.face||1)*.6;h.y=a.y;
  h.state=a.state==='town'?'town':'hunt';
  const z=zoneAt(p.x,p.y),region=ZONES[z]||'the wilds';
  h.hire={npc:p.id,npcName:full(p),role:R.kind,kind:p.role,by:a.id,cid:A.id,days:n,wage,paid:cost,t:Math.round(S.gameMin),until:Math.round(S.gameMin+n*DAY),
    town:p.town||null,zone:z>=0?z:null,region,line:R.line};
  p.hired=h.id;p.hireOffer=null;
  const list=stash(p);h.hire.list=list;
  const r=joinInto(A,h,a);
  if(!r.ok){ // the company would not take them: undo (no one was ever hired)
    a.gold+=cost;p.purse-=cost;p.hired=null;unstash(h,p);S.agents.splice(S.agents.indexOf(h),1);return no(r.error||'The company could not take them in.')}
  const H=p.hmem||(p.hmem={}),m=H[a.id]||(H[a.id]={n:0});m.hired=(m.hired||0)+n;m.hireAt=Math.round(S.gameMin);m.gm=m.gm??Math.round(S.gameMin);
  record(a,'Hired ',h,' for '+n+' day'+(n>1?'s':'')+' ('+cost+' gold, '+(R.kind==='guide'?'a guide':'a blade')+').');
  record(h,'Hired by ',a,' for '+n+' day'+(n>1?'s':'')+' at '+wage+' gold a day.');
  chatAct(a,'hires '+full(p)+' for '+n+' day'+(n>1?'s':'')+' ('+cost+' gold)','hire');
  campaign(A,'hire',h,' is hired for '+n+' day'+(n>1?'s':'')+' ('+wage+' gold a day), a '+(R.kind==='guide'?'guide':'blade')+' for the road.');
  log(h,' hires out to ',gd(where(A)),' for '+n+' day'+(n>1?'s':'')+'.');
  for(const b of members(A))if(b!==h&&b.player){remember(b,'hire',h.name+', a '+p.role+', rides with us for '+n+' day'+(n>1?'s':'')+' ('+wage+' gold a day).');if(b!==a)ev(b,a.name+' hired '+h.name+' for '+n+' day'+(n>1?'s':'')+': a scripted companion who follows, fights and flees by instinct, never leads and never votes.',true)}
  if(R.kind==='guide')teach(A,h);
  return {ok:true,hired:h.name,role:p.role,as:cls,level:h.lvl,days:n,wage,paid:cost,left:Math.floor(a.gold),until_day:Math.floor(h.hire.until/DAY)+1,
    note:h.name+' rides with '+where(A)+' now for '+n+' day'+(n>1?'s':'')+'. A hire follows the leader, fights and flees by instinct, never leads and never votes; when the days are up, or on dismiss {npc}, they walk home.'+(R.kind==='guide'?' They know the roads of '+region+': places lists them as heard of, and a walk into danger carries their warning.':'')}}

function unstash(h,p){const A=S.hireAway||[],i=A.findIndex(e=>e.p===p);if(i<0)return;const e=A.splice(i,1)[0];const L=S[e.list]||(S[e.list]=[]);L.splice(Math.min(e.i,L.length),0,p)}

// ---- dismiss ----
// A hire is found by name or id among the hirer's company, or the word "hire".
export function dismiss(a,{npc}={}){
  if(a.state==='ghost')return no('Ghosts pay no one.');
  if(tableView(a))return no('Not while a scene is open at the table: act in it first (scene_act).');
  const C=companyOf(a);const L=C?hiresOf(C):[];
  if(!L.length)return no('You have no hire riding with you.');
  const k=nk(npc);const h=!k?(L.length===1?L[0]:null):L.find(x=>String(x.id)===k||nk(x.name)===k||nk(x.name).split(' ')[0]===k||x.hire.kind===k);
  if(!h)return no('Dismiss whom? '+L.map(x=>x.name).join(', ')+'.');
  if(OFFER.FIGHT.includes(h.state)||OFFER.BUSY.includes(h.state))return no(h.name+' is busy ('+h.state+'); dismiss them when the fight or the descent is over.');
  const days=Math.max(0,Math.ceil((h.hire.until-S.gameMin)/DAY));
  endHire(h,'dismissed','paid off by '+a.name);
  chatAct(a,'pays off '+h.name,'hire');
  return {ok:true,dismissed:h.name,note:h.name+' keeps the wage ('+days+' paid day'+(days===1?'':'s')+' unused; there is no refund) and walks home.'}}

// ---- ending ----
function endHire(h,end,why){const t=h.hire;if(!t||t.over)return;t.over=true;t.overAt=Math.round(S.gameMin);t.end=end;t.why=why;
  const C=companyOf(h);
  if(C&&isCompanion(h))release(C,h,why);else delete h.companion;
  const a=hero(t.by);if(a&&alive(a)&&a.player)ev(a,h.name+' leaves your company ('+why+') and walks home.',true);
  log(h,' parts from ',gd(C?where(C):'the company'),' ('+why+').')}
function finish(h,mourned){const t=h.hire,p=(S.hireAway||[]).find(e=>e.p&&e.p.id===t.npc);
  if(p&&!mourned){S.hireAway.splice(S.hireAway.indexOf(p),1);const q=p.p;q.hired=null;
    const L=S[p.list]||(S[p.list]=[]);L.splice(Math.min(p.i,L.length),0,q);q.state='post';q.x=q.post?q.post.x:q.x;q.y=q.post?q.post.y:q.y;q.moving=false;q.wait=2;
    const H=q.hmem||(q.hmem={}),m=H[t.by]||(H[t.by]={n:0});m.hireEnd=t.end;m.hireEndAt=Math.round(S.gameMin);m.gm=Math.round(S.gameMin)}
  if(mourned&&p)S.hireAway.splice(S.hireAway.indexOf(p),1);
  const i=S.agents.indexOf(h);if(i>=0&&!mourned){if(S.pinned===h)S.pinned=null;S.agents.splice(i,1)}
  t.done=true}
function mourn(h){const t=h.hire;t.mourned=true;
  log(t.town||'The road',' mourns ',gd(t.npcName),', who fell riding for hire in ',gd(ZONES[zoneAt(h.x,h.y)]||'the wilds'),'.');
  const a=hero(t.by);if(a&&alive(a)&&a.player){ev(a,h.name+' fell, the hire you paid for, and '+(t.town||'their town')+' will hear of it.',true);remember(a,'hire',h.name+', whom I hired, fell in '+(ZONES[zoneAt(h.x,h.y)]||'the wilds')+'. Hardcore: no coin buys it back.')}
  for(const b of (companyOf(h)?members(companyOf(h)):[]))if(b!==h&&b.player&&b!==a)remember(b,'hire',h.name+', our hire, fell.');
  if(t.town)(S.hireWary||(S.hireWary={}))[t.town]=Math.round(S.gameMin+HIRE.WARY_DAYS*DAY);
  finish(h,true)}

const busy=h=>OFFER.FIGHT.includes(h.state)||OFFER.BUSY.includes(h.state);
// Once a step (sim/index.js, after companionTick): days run out, a hire released elsewhere goes home, the fallen are
// mourned, a hire in the Fellowship's company joins its party, and a hire that has reached town is a townsperson again.
export function hireTick(){const hs=S.agents.filter(h=>h.hire&&!h.hire.done);if(!hs.length)return;
  for(const h of hs){const t=h.hire;
    if(h.state==='dead'){if(!t.mourned)mourn(h);continue}
    if(!t.over){const C=companyOf(h),by=hero(t.by);
      if(!C||h.companion==null){t.over=true;t.overAt=Math.round(S.gameMin);t.end='company';t.why='the company parted';
        if(t.town&&(!by||!alive(by)))(S.hireWary||(S.hireWary={}))[t.town]=Math.round(S.gameMin+HIRE.WARY_DAYS*DAY);continue}
      if(!members(C).some(b=>b.player)){endHire(h,'company','no one left to lead them');if(t.town)(S.hireWary||(S.hireWary={}))[t.town]=Math.round(S.gameMin+HIRE.WARY_DAYS*DAY);continue}
      if(S.gameMin>=t.until&&!busy(h)){endHire(h,'days','the days are up');continue}
      if(C.slots){const P=slotParty(C),ld=P&&P.leader;if(P&&!P.home&&!h.party&&!h.hidden&&ld&&(h.state==='town'||(['hunt','travel','follow','regroup'].includes(h.state)&&dist(h,ld)<OFFER.MUSTER))){P.mem.push(h);h.party=P}}
      continue}
    // over: home, then a townsperson again
    if(h.state==='town'||S.gameMin-t.overAt>=HIRE.GONE_MIN){
      if(t.end==='days')record(h,'Rode for hire and was paid; back in '+homeOf(h).name+'.');
      finish(h,false)}
    else if(h.state!=='return'&&!busy(h)&&['hunt','travel','follow','regroup'].includes(h.state)){h.state='return';h.target=null;h.dest=null;if(h.party)h.party=null}}}
