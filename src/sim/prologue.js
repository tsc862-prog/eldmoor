// The first delve (issue #922, owner decision 2026-11-05): a new company's story opens with intros, then an easy pre-made dungeon,
// then the open world. Owned by ai-designer. DOM-free. It is the one place the world opens a dungeon for a company: #826 (companies
// initiate) stays the rule everywhere after it. Hardcore holds inside: easy, not safe. A member can go down and can die, and a
// lost seat refills through an arrival as anywhere. Every act below is the agents', on the crawl's own options.
//
// The flow, per company of two or more (a solo keeps its short opening):
//   ready      before the DM's prep, or at the latest before the opening opens: a row of data/prologues.js is chosen by the
//              company's hall, a real site is raised on open ground a short walk from it, and the company stands at its mouth.
//   intro      session zero plays there (sim/arrival.js reads C.prologue): the DM frames it, members introduce themselves.
//   descend    the opening's outcome sends the company down, with no vote (the scenario is why they came).
//   below      the ordinary site crawl (sim/sites.js, sim/crawl.js), each room's first round framed by the DM.
//   out        at the hall's gate, a one-round 'homecoming' scene the DM frames, then the leader is told the first move.
//
// Only with a host that reports runner links and the table on (hasLinks, tableOn, companyAtTable): anywhere else it never starts, so
// npm run sim and the seeded hashes do not move, and a setup world on the default stores nothing at all: the setting is in S.setup
// only when it differs. Nothing here rolls the gameplay dice except the crawl itself.
//
// State (plain data, saved with the world):
//   C.prologue {row, site, phase:'intro'|'descend'|'below'|'out', town, ids?, end?:'clear'|'left'|'off'}   gone when the delve is over
//   q.pro      on an opening in S.opening.queue: this opening has been looked at, so nothing is raised twice
//   site.prologue  the row's id: its ruin stays on the map; site.xp its share of a site's XP; its loot is plain and it has no epic
import {CITY,CRYPT,zoneAt} from '../world/map.js';
import {onMainLand} from '../world/passable.js';
import {clearLine} from './path.js';
import {hash} from '../core/rng.js';
import {homeOf} from '../data/races.js';
import {PROLOGUES,PROLOGUE_DEFAULT} from '../data/prologues.js';
import {SITE_THEMES} from '../data/sites.js';
import {S} from './state.js';
import {log} from './chronicle.js';
import {timeline} from './history.js';
import {remember} from './memory.js';
import {hasLinks} from './runlink.js';
import {found} from './lore.js';
import {companies,companyById,members,campaign,spreadAt,slotted,slotHeroes} from './company.js';
import {PLAY,TABLE,openScene,setSceneKind,kindHooks,sceneFor,tableOn,companyAtTable} from './table.js';
import {setPrepStart} from './prep.js';
import {setPrologueHook,voicedKind,voicedScene,pushCall,resolveCall,voiceLive,firstMove,tellFirstMove,openingLead,campaignNotes} from './arrival.js';
import {SITE,ensureSites,siteSpotErr,enterSite,siteById,siteTag} from './sites.js';

export const PRO={
  NEAR:14,  // tiles past SITE.TOWN_GAP the mouth may stand from the gate: a short walk
  FAR:30,   // the longest walk, for a town the short ring leaves nothing for (a river, a neighbour: Brinereach): still the gate's own region
  MAX_LVL:3, // a company with anyone above this is past a green blade's chore: a seasoned apart group keeps the start it chose
};
const gd=t=>({t,c:'gd'}),nar=t=>({t,c:'nar'});
const byId=id=>S.agents.find(x=>x.id==id)||null;
const living=a=>!!a&&a.kind==='hero'&&a.state!=='dead';
const memOf=C=>(C===slotted()?slotHeroes(C):members(C).filter(a=>!a.hire)).filter(living);
const names=L=>L.length<2?L.join(''):L.slice(0,-1).join(', ')+' and '+L[L.length-1];
const rowOf=id=>PROLOGUES.find(r=>r.id===id)||null;
const fill=(t,P)=>String(t).replace(/\{town\}/g,P.town).replace(/\{crypt\}/g,CRYPT?CRYPT.name:'the deep places');
const cap=t=>t.charAt(0).toUpperCase()+t.slice(1);
const words=ps=>(ps||[]).map(p=>typeof p==='string'?p:p&&p.t||'').join('');

// The setting: in S.setup only when it differs. A setup world (S.setup.world) takes the default; a world with no setup never does.
export const prologueOn=()=>!!S.setup&&(S.setup.prologue||(S.setup.world!=null?PROLOGUE_DEFAULT:'none'))==='delve';

// ---- raising it ----
const used=()=>new Set(((S.sites&&S.sites.list)||[]).map(s=>s.prologue).filter(Boolean));
export function pickRow(town,fac,taken=used()){const free=PROLOGUES.filter(r=>!taken.has(r.id));
  return free.find(r=>r.towns&&r.towns.includes(town))||free.find(r=>r.fac===fac&&!r.towns)||free.find(r=>r.fac===fac)||null}
// The nearest open ground past the town's clear ring, walking outward from the gate: no dice, so a town always gets the same spot.
// It stays in the gate's own region (a new town beside a river or a higher band must not put a green company in the next land) and in
// a clear walk of the gate (#721's towns: Murkstead's nearest ground lay across the Greywater, Brinereach's in Sedgewater).
export function mouthNear(c){const g=c.gate||c.qg;if(!g)return null;const gz=zoneAt(g.x,g.y);
  for(const n of [16,64])for(let d=SITE.TOWN_GAP+1;d<=SITE.TOWN_GAP+PRO.FAR;d++)for(let k=0;k<n;k++){const ang=k*2*Math.PI/n,q={x:Math.floor(g.x+Math.cos(ang)*d)+.5,y:Math.floor(g.y+Math.sin(ang)*d)+.5}; // a second, finer look for a town the sixteen rays miss
    if(q.x<1||q.y<1)continue;const z=zoneAt(q.x,q.y);if(z!=null&&z===gz&&!siteSpotErr(q,z)&&onMainLand(q.x,q.y)&&clearLine(g,q))return {...q,z}}
  return null}
function raise(row,at){const X=ensureSites(),T=SITE_THEMES[row.theme],born=Math.round(S.gameMin);
  const s={id:++X.seq,name:row.name,theme:row.theme,label:T.label,region:at.z,band:[1,2],x:at.x,y:at.y,place:null,state:'discovered',born,by:'prologue',reason:'the first delve',lever:null,
    boss:row.boss,bossTitle:'',epic:null,rooms:JSON.parse(JSON.stringify(row.rooms)),loot:{...row.loot,goods:row.loot.goods.slice()},grow:0,found:{at:born,by:'the company'},runs:0,cleared:null,group:null,prologue:row.id,xp:row.xp};
  const pl={id:++S.uid,kind:'site',theme:row.theme,name:row.name,x:at.x,y:at.y,z:at.z,born,until:null,lever:null,site:s.id};
  (S.places||(S.places=[])).push(pl);s.place=pl.id;X.list.push(s);X.stats.made++;return s}
function placeAtMouth(s,L){const p={x:s.x,y:s.y+1.5},T=SITE_THEMES[s.theme];
  L.forEach((a,i)=>{Object.assign(a,spreadAt(p,i,L.length),{state:'hunt',zone:s.region,dest:null,target:null,moving:false});found(a,s.name,T.mouth,s.place)})}
function begin(C){const L=memOf(C);if(L.length<2||L.some(a=>a.lvl>PRO.MAX_LVL)||!tableOn()||!companyAtTable(C))return false;
  const town=C.hall||homeOf(L[0]).name,c=CITY.find(x=>x.name===town)||homeOf(L[0]),row=pickRow(town,C.fac),at=row&&mouthNear(c);if(!at)return false;
  const s=raise(row,at);placeAtMouth(s,L);C.prologue={row:row.id,site:s.id,phase:'intro',town};
  log(gd(C.name||L[0].name+'\'s company'),' stands at the mouth of ',siteTag(s),', a short walk from ',gd(town),'.');return true}
// Every opening still to come that may have one. Called as the DM's prep begins, so the DM reads the place, and by sessionTick
// for a world with no prep. An opening is looked at once.
export function readyPrologues(){const O=S.opening;if(!O||!O.queue||!hasLinks()||!prologueOn())return;
  for(const q of O.queue){if(q.kind!=='new'||q.pro)continue;q.pro=1;const C=companyById(q.company);if(C)begin(C)}}

// ---- what session zero says of it (sim/arrival.js) ----
const where=C=>{const s=siteById(C.prologue.site);return s?s.name:'the mouth'};
const frame=(C,here,ld,oaths)=>{const P=C.prologue,row=rowOf(P.row);
  return [fill(row.scenario,P)+' ',gd(C.name||'The company'),': '+names(here.map(a=>a.name))+'. ',ld?ld.name+' stands in front. ':'',oaths.length?oaths.join('; ')+'. ':'']};
const about=C=>{const P=C.prologue,row=rowOf(P.row),n=campaignNotes('prologue');
  return ' This is the first delve: they stand at the mouth of '+where(C)+', a short walk from '+P.town+', and go down when the introductions are done. Behind it (yours alone): '+row.dm+(n?' Your campaign says: '+n:'')};
const fillLine=(C,sc)=>{const L=rowOf(C.prologue.row).fill;return L[Math.floor(hash(sc.id|0,7,922)*L.length)%L.length]};
const ahead=C=>'Below them: '+where(C)+'.';
const introduced=C=>{C.prologue.phase='descend'};
const view=()=>{const out=companies().filter(C=>C.prologue).map(C=>{const P=C.prologue,s=siteById(P.site),row=rowOf(P.row);
    return {company:C.name||null,site:s?s.name:null,phase:P.phase,town:P.town,rooms:s?s.rooms.map(r=>r.name):[],keeper:row?row.boss:null,behind_it:row?row.dm:null}});
  return out.length?out:null};

// ---- the rooms: the DM frames each room's first round; the room's own words stand when it is slow ----
const siteOfScene=sc=>sc&&sc.ctx&&sc.ctx.site!=null?siteById(sc.ctx.site):null;
const delveRoom=sc=>{const s=siteOfScene(sc);return !!(sc&&sc.kind==='crawl'&&s&&s.prologue)};
voicedScene(sc=>delveRoom(sc)&&!!(sc.calls&&sc.calls.some(c=>!c.done))); // only while its call waits: a long crawl never hides another company's scene
const DM_ROOM={
  onFrame(sc){if(!delveRoom(sc)||sc.ctx.rd)return;const s=siteOfScene(sc),room=s.rooms[sc.ctx.room],row=rowOf(s.prologue);
    pushCall(sc,{kind:'voice',ms:TABLE.frameMs,who:'the narrator',about:'The first delve, '+s.name+', room '+(sc.ctx.room+1)+' of '+s.rooms.length+': '+room.name+'. What the table shows, which stays on it: '+words(sc.frame)+' Behind it (yours alone): '+row.dm+' Add what they see and hear as they come in, a few lines, true to the foes named; decide nothing for them.'})}, // voice, not frame: the foes left and who is hurt stay on the table
  live:voiceLive,
  fill(sc,c){resolveCall(sc,c,{text:'',by:'scripted'})}, // the room's own frame is already on the table
  done(){},
};
// Only while a first delve runs: every other crawl, and every world without one, keeps exactly the path it had.
Object.defineProperty(kindHooks('crawl'),'dm',{get:()=>(S.companies||[]).some(C=>C.prologue)?DM_ROOM:undefined});

// ---- the way home ----
PLAY.homecoming='all';
const optsHome=()=>[{k:'speak',text:'Say what the place taught you'},{k:'quiet',text:'Say nothing; look at the town'}];
const applyHome=(sc,a,act)=>act.k==='speak'?'says what the place taught them':act.k==='quiet'?'keeps quiet':null;
function settleHome(C,ctx){const L=memOf(C),ld=openingLead(C),m=firstMove(ctx.town,C);delete C.prologue;
  const line=(ctx.end==='clear'?'They came out of '+ctx.site+' a company':'They came back from '+ctx.site+' with it unfinished')+(ctx.lost.length?', without '+names(ctx.lost):'')+'.';
  campaign(C,'session',gd(ctx.site),': '+line+' '+m.first);
  timeline('oath',gd(C.name||'A company'),ctx.end==='clear'?' cleared ':' came back from ',gd(ctx.site),' and reached the gate of ',gd(ctx.town),'.');
  for(const a of L)remember(a,'table',line+' '+m.first);
  if(ld)tellFirstMove(ld,m.first,L.length>1);
  return line+' '+m.first}
const DM_HOME={
  onFrame(sc){const c=sc.ctx;pushCall(sc,{kind:'frame',ms:TABLE.frameMs,who:'the narrator',about:'The first delve is over: '+(c.end==='clear'?'they cleared ':'they came away from ')+c.site+(c.lost.length?', and lost '+names(c.lost):'')+'. They are at the gate of '+c.town+'. What the table shows: '+c.words+' Write the close of the prologue, a few lines: the walk back, the gate, the captain. Keep the warning: this place was the least of them. Decide nothing for them.'})},
  onAll(){},
  live:voiceLive,
  fill(sc,c){resolveCall(sc,c,{text:'',by:'scripted'})},
  done(){},
};
setSceneKind('homecoming',{options:optsHome,reflex:()=>'quiet',apply:applyHome,outcome:sc=>settleHome(companyById(sc.company)||slotted(),sc.ctx),dm:DM_HOME});
voicedKind('homecoming',null);
function atGate(P,L){const c=CITY.find(x=>x.name===P.town)||homeOf(L[0]),g=c.gate||c.qg;
  L.forEach((a,i)=>{Object.assign(a,spreadAt(g,i,L.length),{zone:zoneAt(g.x,g.y),dest:null,target:null,moving:false});if(a.state!=='downed'){a.state='town';a.townStep=1}})}
function comeHome(C,P){const L=memOf(C),s=siteById(P.site),row=rowOf(P.row);
  if(!L.length){delete C.prologue;return}
  if(P.end==='off'){delete C.prologue;const ld=openingLead(C);if(ld)tellFirstMove(ld,firstMove(P.town,C).first,L.length>1);return} // the table went away before they went down: nobody fled anything, and the place stays open
  atGate(P,L);const end=P.end==='clear'?'clear':'left',words=fill(row.closing[end],P);
  const lost=(P.ids||[]).map(byId).filter(a=>a&&a.state==='dead').map(a=>a.name),site=s?s.name:row.name;
  const ctx={prologue:1,town:P.town,anchor:(openingLead(C)||L[0]).id,setting:'gate',end,site,lost,words};
  const sc=tableOn()?openScene('homecoming',cap(site)+': the way home',[words],ctx,C):null;
  if(!sc)settleHome(C,ctx)}

// ---- once per step ----
export function prologueTick(){const CS=S.companies;if(!CS)return;
  for(const C of CS){const P=C.prologue;if(!P||sceneFor(C))continue;const s=siteById(P.site);
    if(P.phase==='descend'){P.ids=memOf(C).map(a=>a.id);
      if(s&&tableOn()&&companyAtTable(C)&&enterSite(C,s)){P.phase='below';continue}
      P.end='off';P.phase='out'}
    else if(P.phase==='below'){if(s&&s.group)continue;P.end=s&&s.state==='cleared'?'clear':'left';P.phase='out'}
    if(P.phase==='out')comeHome(C,P)}}

setPrepStart(readyPrologues);
setPrologueHook({ready:readyPrologues,frame,about,fillLine,ahead,introduced,where,view});
