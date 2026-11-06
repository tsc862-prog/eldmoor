// Interrogation (issue #431, slice 3): a yielded foe or a suspect questioned at the table. Owned by ai-designer. DOM-free.
//
//   who      a foe that yielded at the table (sim/tableround.js parley or a duellist's yield: an enemy hero, or a creature
//            with speech) is held and questioned by the company that beat it; or a suspect the DM agent staged (stage_scene
//            kind 'interrogation', sim/staged.js: a person placed through create_npc, played in the cell setting in a town).
//   play     PLAY 'turns' in sim/table.js, up to IQ.ROUNDS rounds. On their turn a member may ask plainly (persuasion),
//            threaten (intimidation; a failed threat hardens them), bargain (coin, persuasion made easier), read their face
//            (empathy: catches a lie told at this table), let them go (release), hand them to the watch (hand_over, only near
//            a friendly town), or watch. Every question is a d20 check against the suspect's resolve (IQ.DC, +3 a named or
//            elite one, + its level over the asker's, hostile +2 / friendly -2 for a staged person, ± what the table did).
//   answers  the dice decide what the suspect gives up, never the DM: a pass is the truth (a lead: a place the members learn
//            through lore.js learnPlace, a remembered line, a notebook entry for agents); a near miss is a lie (a wrong
//            place, remembered as said, until a read catches it); a bad miss is silence. The DM agent voices each answer
//            through table_call / table_answer, true to the dice (the bounded wait of sim/dmreflex.js, #561: a few seconds,
//            then the scripted line fills it and the DM log marks it a fill).
//   ending   release (a yielded hero walks home, a creature is spared, a staged person warms one step and goes), hand_over
//            (the watch pays a small bounty to each member present; the suspect is taken out of the world: a creature or
//            person is gone, an enemy hero is marched home), or the rounds run out (they let them go).
//
// Determinism: a yield opens an interrogation only in a world whose host reports runner links (hasLinks) and only for a
// company whose agents have the say (agentsDecide), like the fireside; npm run sim and the seeded checks never queue one.
// Picks use hashes, never the gameplay RNG; only the checks at the table roll dice.
//
// State: C.iqQ {at, foe:{kind:'hero'|'mob', id}, ids, anchor, camp?} one waiting interrogation per company; the scene's
// ctx {mode:'yield'|'staged', who:{kind, id, name}, dc, secret:{text, place}, lie:{text, place}, said:[], lied, caught,
// broken, end, town, camp?} (plain data, saved with the table).
import {S,loreSides} from './state.js';
import {CITY,LANDMARKS,ZONES,REGIONS,zoneAt,dist} from '../world/map.js';
import {hash} from '../core/rng.js';
import {check,socialSkill,trained} from './abilities.js';
import {notify} from './notify.js';
import {remember} from './memory.js';
import {record} from './history.js';
import {log} from './chronicle.js';
import {addHeroNote} from './notebook.js';
import {learnPlace,knowsPlace} from './lore.js';
import {hasLinks} from './runlink.js';
import {worldHeld} from './prep.js';
import {inRange} from './reach.js';
import {campaign,companies,companyOf,members,slotHeroes,slotted} from './company.js';
import {openScene,setSceneKind,tableOn,agentsDecide,onSceneEnd,sceneCompany,sceneFor,stageDone} from './table.js';
import {pushCall,resolveCall,voiceLive,voicedKind} from './arrival.js';
import {canParley} from './tableround.js';
import {MOBS} from '../data/mobs.js';

export const IQ={
  ON:true,          // off: a yield opens no interrogation (checks about other things at the table turn it off)
  ROUNDS:3,         // rounds of questions at most
  DC:12,            // the suspect's resolve before what it is and what the table does
  LIVE_MS:90000,    // real ms the table waits for a live agent's question before its reflex acts
  QUEUE_MIN:30,     // game minutes a waiting interrogation keeps (the foe walks off after that)
  NEAR:10,          // tiles: the foe must still be this close to a member when the table opens
  WATCH:36,         // tiles from a friendly town's gate within which the watch will take a prisoner
  BRIBE:4,          // gold per suspect level a bargain costs (at least 8)
  PAY:3,            // gold per suspect level the watch pays each member present on a hand_over (at least 6)
  PLACES:40,        // tiles: how far a yielded foe's knowledge reaches for a lead
};
const gd=t=>({t,c:'gd'});
const byId=id=>S.agents.find(x=>x.id==id)||null;
const living=a=>!!a&&a.kind==='hero'&&a.state!=='dead';
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f<>{}]+/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const cut=(s,n)=>{s=clean(s,1e4);return s.length<=n?s:s.slice(0,n-1).trimEnd()+'…'};
const names=L=>L.length<2?L.join(''):L.slice(0,-1).join(', ')+' and '+L[L.length-1];
const pickH=(seed,k,list)=>list[Math.floor(hash(seed|0,k,431)*list.length)%list.length];
const low=s=>s?s.charAt(0).toLowerCase()+s.slice(1):s;
const memOf=C=>!C?[]:C===slotted()?slotHeroes(slotted()):members(C).filter(a=>!a.hire); // a hire is never seated at a scene (#634)
const ASKS={ask:'persuasion',threaten:'intimidation',bargain:'persuasion',read:'empathy'};
const FIGHT=new Set(['elite','ambush','rescue']);

// ---- the suspect ----
const mobOf=id=>S.mobs.find(m=>m.id===id)||null;
const npcOf=id=>(S.wanderers||[]).find(w=>w.id===id)||(S.npcs||[]).find(w=>w.id===id)||null;
function whoOf(sc){const w=sc.ctx.who;if(!w)return null;return w.kind==='hero'?byId(w.id):w.kind==='mob'?mobOf(w.id):npcOf(w.id)}
const here=e=>!!e&&(e.kind==='hero'?e.state!=='dead':e.kind==='mob'?e.alive&&!e.gone:true);
const nameOf=sc=>sc.ctx.who?sc.ctx.who.name:'the prisoner';
const foeName=f=>f.kind==='hero'?f.name:f.elite||f.named?f.name:MOBS[f.type]?MOBS[f.type].name:'the creature';
const lvlOf=f=>f.lvl||1;

// Directions in words, from a spot to a place.
function dirTo(a,b){const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);if(d<3)return 'close by';
  const k=Math.round(Math.atan2(dy,dx)/(Math.PI/4)),w=['east','south-east','south','south-west','west','north-west','north','north-east'][(k+8)%8];
  return (d>24?'far ':'')+w+' of here'}
const OPP={'east':'west','west':'east','north':'south','south':'north','north-east':'south-west','south-west':'north-east','north-west':'south-east','south-east':'north-west'};
const flip=t=>t.replace(/(north-east|north-west|south-east|south-west|north|south|east|west)/,m=>OPP[m]||m);
// What a yielded foe knows: the places near where it was beaten that the members do not know yet (a DM-marked place, a
// landmark, the region its kind comes from), nearest first. Picks by distance and hashes only.
function leadsFor(f,at,mem){const out=[],unknown=n=>mem.some(a=>!knowsPlace(a,n)),seen=new Set();
  const add=(name,x,y,what)=>{if(!name||seen.has(name))return;seen.add(name);const d=Math.hypot(x-at.x,y-at.y);if(d>IQ.PLACES&&what!=='region')return;out.push({name,x,y,d,what,fresh:unknown(name)})};
  for(const p of S.places||[])if(p.name&&(p.until==null||p.until>S.gameMin))add(p.name,p.x,p.y,p.kind||'place');
  for(const l of LANDMARKS||[])add(l.name,l.x,l.y,l.kind);
  const z=zoneAt(f.x,f.y),band=REGIONS[z]&&REGIONS[z].band;
  for(let i=0;i<ZONES.length;i++){if(i===z)continue;const b=REGIONS[i]&&REGIONS[i].band;if(!b||!band)continue;
    if(b[0]<=lvlOf(f)+2&&b[1]>=lvlOf(f)-2){const c=CITY.find(t=>zoneAt(t.gate.x,t.gate.y)===i)||null;add(ZONES[i],c?c.gate.x:at.x,c?c.gate.y:at.y,'region')}}
  out.sort((p,q)=>(q.fresh?1:0)-(p.fresh?1:0)||p.d-q.d||(p.name<q.name?-1:1));return out}
const WHAT={crypt:'the old stair down',lair:'the great beast\'s den',camp:'a camp',ruin:'a ruin',shrine:'a shrine',cairn_door:'a sealed door in a cairn',region:'where their kind ride'};
function leadText(p,at,lie){const where=lie?flip(dirTo(at,p)):dirTo(at,p);
  return p.what==='region'?'their kind hunt in '+p.name+', '+where:p.name+' ('+(WHAT[p.what]||'a place')+') lies '+where}

// The secret and the lie of a yielded foe.
function yieldSecret(f,at,mem,seed){const L=leadsFor(f,at,mem);if(!L.length)return {secret:{text:'they were sent by no one and know nothing worth the asking',place:null},lie:{text:'there is gold buried on the old road, and they will show you for their freedom',place:null}};
  const t=L[0],w=L.length>1?L[1+Math.floor(hash(seed,3,431)*(L.length-1))%(L.length-1)]:t;
  return {secret:{text:leadText(t,at,false),place:t.name},lie:{text:leadText(w,at,true),place:null}}}

// ---- opening ----
const ok=(C,L)=>IQ.ON&&hasLinks()&&tableOn()&&L.length>=1&&agentsDecide(L);
// The yielded foe and the members present: null = not yet, false = never.
function presentFor(C,q){const f=q.foe.kind==='hero'?byId(q.foe.id):mobOf(q.foe.id);if(!here(f))return false;
  const L=memOf(C).filter(living).filter(a=>!a.hidden),an=L.find(a=>a.id===q.anchor)||L.find(a=>dist(a,f)<=IQ.NEAR);if(!an)return false;
  if(L.some(a=>['fight','duel'].includes(a.state)&&a.target&&a.target!==f))return null; // still fighting something else
  const H=L.filter(a=>a===an||inRange(an,a));return H.some(a=>dist(a,f)<=IQ.NEAR)?H:false}
const friendlyTown=(C,at)=>{const fac=(memOf(C)[0]||{}).fac;let best=null,bd=1e9;for(const t of CITY){if(!loreSides()&&fac!=null&&t.fac!=null&&t.fac!==fac)continue;const d=Math.hypot(t.gate.x-at.x,t.gate.y-at.y);if(d<bd){bd=d;best=t}}
  return best&&bd<=IQ.WATCH?best:null};
function openYield(C,q,H){const f=q.foe.kind==='hero'?byId(q.foe.id):mobOf(q.foe.id),nm=foeName(f),at={x:f.x,y:f.y},seed=(f.id|0)*31+(C.id|0);
  const {secret,lie}=yieldSecret(f,at,H,seed),T=friendlyTown(C,at),skip=memOf(C).filter(a=>!H.includes(a)).map(a=>a.id);
  const dc=IQ.DC+(f.elite||f.named?3:0);f.dest=null;f.target=null;if(f.kind==='mob'){f.spared=Math.max(f.spared||0,S.gameMin+120)}
  const frame=[gd(nm),' has yielded. ',pickH(seed,1,['They keep their hands where the company can see them.','It is on its knees in the trampled grass, breathing hard.','Weapons on the ground between them; nobody has moved yet.']),' Now there are questions.'];
  const ctx={mode:'yield',who:{kind:f.kind,id:f.id,name:nm,lvl:lvlOf(f)},...(f.kind==='hero'?{foe:f.id}:{mob:f.id}),dc,secret,lie,said:[],skip,anchor:q.anchor,...(T?{watch:T.name}:{}),...(q.camp?{camp:q.camp}:{})};
  const sc=openScene('interrogation','Questioning '+nm,frame,ctx,C);if(sc&&sc.rd==null)sc.rd=1;return sc}
// Once per step (sim/index.js, after the fire): a waiting interrogation opens when its company's table is free.
export function iqTick(){const CS=S.companies;if(!CS||!CS.some(C=>C.iqQ)||worldHeld())return;
  for(const C of companies()){const q=C.iqQ;if(!q)continue;
    if(S.gameMin-q.at>IQ.QUEUE_MIN||!hasLinks()){delete C.iqQ;continue}
    if(sceneFor(C))continue;
    const H=presentFor(C,q);if(H===null)continue;delete C.iqQ;if(!H||!ok(C,H))continue;
    if(openYield(C,q,H))return}}
// A fight ends with the foe yielding: hold it for questions (the fight scene's members, an agent with the say).
onSceneEnd(sc=>{if(!IQ.ON||!hasLinks()||!FIGHT.has(sc.kind)||sc.end!=='yield')return;const C=sceneCompany(sc);if(!C||C.iqQ)return;
  const c=sc.ctx||{},f=c.foe!=null?byId(c.foe):(c.mobs||[c.mob]).map(mobOf).find(m=>m&&m.alive&&!m.gone);if(!here(f)||(f.kind==='mob'&&!canParley(f)))return;
  const L=sc.ids.map(byId).filter(living);if(!ok(C,L))return;
  C.iqQ={at:Math.round(S.gameMin),foe:{kind:f.kind,id:f.id},ids:sc.ids.slice(),anchor:(L.find(a=>a.name===sc.talk)||L[0]).id,...(c.camp?{camp:c.camp}:{})}});

// ---- at the table ----
const atTable=sc=>sc.ids.map(byId).filter(living);
function cost(sc){return Math.max(8,IQ.BRIBE*((sc.ctx.who&&sc.ctx.who.lvl)||1))}
export function options(sc,a){const c=sc.ctx,n=nameOf(sc);
  if(c.end)return [{k:'watch',text:'It is settled; watch '+n+' go'}];
  const o=[{k:'ask',text:'Ask '+n+' plainly (persuasion; your line is the question)'},{k:'threaten',text:'Threaten '+n+' (intimidation; a failed threat hardens them)'}];
  if((a.gold||0)>=cost(sc))o.push({k:'bargain',text:'Offer '+n+' '+cost(sc)+' gold for the truth (persuasion, easier)'});
  if(c.said.length)o.push({k:'read',text:'Read '+n+'\'s face: was that the truth? (empathy)'});
  o.push({k:'release',text:'Let '+n+' go'});
  if(c.watch)o.push({k:'hand_over',text:'Hand '+n+' over to the watch at '+c.watch+' (a bounty for each of you)'});
  o.push({k:'watch',text:'Say nothing; watch '+n});return o}
// A member played by reflex (or an agent that let the wait run out): read a told answer once, else ask in its own manner;
// once the truth is out, a town near enough gets them to the watch, else they go.
export function reflex(sc,a){const c=sc.ctx;if(c.end)return 'watch';
  if(c.broken)return c.watch?'hand_over':'release';
  if(c.said.length&&!c.caught&&c.lied&&trained(a,'empathy'))return 'read';
  return socialSkill(a)==='intimidation'?'threaten':'ask'}
function resolveDc(sc,a){const c=sc.ctx,w=whoOf(sc);let dc=c.dc+(c.up||0);if(w)dc+=Math.max(0,Math.min(5,lvlOf(w)-(a.lvl||1)));return dc}
// One question: the d20 against the resolve. Returns the beat's result text; the answer the dice give goes in c.said.
function question(sc,a,k){const c=sc.ctx,skill=ASKS[k],dc=resolveDc(sc,a)-(k==='bargain'?4:0),R=check(a,skill,dc,{nat:true}),by=R.total-dc;
  sc.rc={kind:'question',skill,result:'',die:R.d20,mod:R.mod,total:R.total,vs:dc,hit:R.pass,crit:R.d20===20,dmg:0,target:nameOf(sc),down:false};
  const roll=skill+' d20 '+R.d20+(R.mod>=0?'+':'')+R.mod+'='+R.total+' vs DC '+dc+(R.nat===20?' (a natural 20)':R.nat===1?' (a natural 1)':'');
  let ans;
  if(k==='read'){const last=c.said[c.said.length-1];
    if(R.pass){c.up=(c.up||0)-2;if(c.lied&&!c.caught){c.caught=a.id;ans='caught'}else ans='honest'}else ans='unsure';
    sc.rc.result=ans;c.said.push({k:ans,by:a.id,rd:sc.rd||1,about:last?last.k:null});return roll+': '+(ans==='caught'?'the lie shows':ans==='honest'?(last&&last.k==='truth'?'they mean it':'nothing hidden there'):'their face gives nothing away')}
  if(c.broken)ans='again';
  else if(R.pass)ans='truth';
  else if(by>=-4&&!c.lied&&R.nat!==1)ans='lie';
  else ans='silent';
  if(k==='threaten'&&!R.pass)c.up=(c.up||0)+2; // a failed threat hardens them
  if(k==='bargain'){const g=cost(sc);a.gold=Math.max(0,(a.gold||0)-g);const w=whoOf(sc);if(w&&w.kind==='hero')w.gold=(w.gold||0)+g}
  if(ans==='truth'){c.broken=a.id;teach(sc,a)}
  if(ans==='lie')c.lied=a.id;
  sc.rc.result=ans;c.said.push({k:ans,by:a.id,rd:sc.rd||1});
  return roll+': '+(ans==='truth'?'they talk':ans==='again'?'they have told all they know':ans==='lie'?'they answer, too quickly':'they say nothing')}
// The truth reaches everyone at the table: a place learned through lore, a memory, a note for the agents.
function teach(sc,a){const c=sc.ctx,n=nameOf(sc),s=c.secret;if(!s)return;
  for(const b of atTable(sc)){if(s.place)learnPlace(b,s.place,'told');
    remember(b,'table',n+' told us under questioning: '+cut(s.text,150)+'.');
    if(b.player)addHeroNote(b,{title:'What '+n+' told us',text:n+' told us under questioning'+(b===a?' (I got it out of them)':' ('+a.name+' got it out of them)')+': '+s.text+'.',tags:['interrogation','lead'],about:n})}}
export function apply(sc,a,act){const c=sc.ctx,k=act.k,n=nameOf(sc);
  if(k==='watch')return c.end?'watches them go':'watches '+n;
  if(c.end)return 'it is already settled';
  if(ASKS[k])return question(sc,a,k);
  if(k==='release'){c.end='released';c.endBy=a.id;return 'lets '+n+' go'}
  if(k==='hand_over'){if(!c.watch)return 'there is no watch near enough';c.end='handed';c.endBy=a.id;return 'hands '+n+' to the watch at '+c.watch}
  return null}
// Another round while there is something left to ask: rounds left, the suspect not let go or handed over, the truth not out.
export function next(sc){const c=sc.ctx;if(c.end||c.broken||(sc.rd||1)>=IQ.ROUNDS)return false;
  const rd=sc.rd||1;if(!sc.beats.some(b=>(b.rd||1)===rd&&ASKS[b.k]))return false; // nobody asked anything: they are done with it
  if(!here(whoOf(sc)))return false;sc.rd=rd+1;return true}
export function outcome(sc){const c=sc.ctx,n=nameOf(sc),L=atTable(sc),w=whoOf(sc),C=sceneCompany(sc),end=c.end||'released';
  const lies=c.said.filter(x=>x.k==='lie').length,truth=!!c.broken;
  for(const b of L){if(c.lied&&!truth)remember(b,'table',n+' told us '+cut(c.lie.text,120)+(c.caught?' - a lie; '+(byId(c.caught)||{}).name+' saw through it.':'. I am not sure it was the truth.'));
    else if(c.lied&&c.caught)remember(b,'table',n+' lied to us first; '+(byId(c.caught)||{}).name+' caught it.');
    if(b.player){const what=truth?'the truth came out: '+c.secret.text:c.lied?(c.caught?'they lied and it was caught; the truth stayed with them':'they told you '+c.lie.text+' (true or not, you cannot tell)'):'they gave nothing up';
      notify(b,'The questioning of '+n+' is over: '+what+'. '+(end==='handed'?'They go to the watch at '+c.watch+'.':'They go free.'),true,1)}}
  if(c.lied&&!truth&&c.lie.place)for(const b of L)learnPlace(b,c.lie.place,'told');
  // the ending
  if(end==='handed'&&w){const pay=Math.max(6,IQ.PAY*((c.who&&c.who.lvl)||1));for(const b of L){b.gold=(b.gold||0)+pay;record(b,'Handed ',gd(n),' to the watch at '+c.watch+' (+'+pay+' gold).')}
    if(w.kind==='mob'){w.alive=false;w.gone=true;w.target=null}
    else if(w.kind==='hero'){w.state='return';w.target=null;w.dest=null;record(w,'Taken to the watch at '+c.watch+' by ',gd(C&&C.name||'a company'),' and sent home in disgrace.')}
    else{w.hours=0;w.until=S.gameMin;w.gone=true}
    log(gd(C&&C.name||'A company'),' hands ',w.kind==='hero'?w:gd(n),' over to the watch at ',gd(c.watch),'.')}
  else if(w){if(w.kind==='hero'){w.state='return';w.target=null;w.dest=null;record(w,'Questioned by ',gd(C&&C.name||'a company'),' and let go.')}
    else if(w.kind==='mob'){w.spared=Math.max(w.spared||0,S.gameMin+120);w.target=null;w.dest=w.home?{...w.home}:null}
    else if(w.attitude){const A=['hostile','wary','neutral','friendly'],i=A.indexOf(w.attitude);if(i>=0&&i<3)w.attitude=A[i+1]}}
  if(C)campaign(C,'table',gd('Questioning '+n),': '+(truth?'the truth came out ('+cut(c.secret.text,90)+')':c.lied?(c.caught?'a lie, caught':'an answer they could not trust'):'nothing')+'; '+(end==='handed'?'handed to the watch at '+c.watch:'let go')+'.');
  return (truth?n+' gave up what they knew: '+cut(c.secret.text,100)+'.':c.lied?(c.caught?n+' lied, and '+(byId(c.caught)||{}).name+' saw it.':n+' told them something; true or not, they cannot tell.'):n+' gave nothing up.')+
    ' '+(end==='handed'?n+' goes to the watch at '+c.watch+'.':n+' goes free.')+(lies>1?'':'')}
export function view(sc,a){const c=sc.ctx;return {questioning:nameOf(sc),round:(sc.rd||1)+' of up to '+IQ.ROUNDS,
  told_so_far:c.said.filter(x=>x.k!=='silent').map(x=>x.k==='truth'||x.k==='again'?'"'+c.secret.text+'"':x.k==='lie'?'"'+c.lie.text+'"':x.k==='caught'?'(a lie, seen through)':x.k==='honest'?'(they meant it)':'(no read)'),
  ...(c.watch?{watch:c.watch}:{}),how:'Ask your own question in your line. The dice decide what they give up: the truth, a lie (read can catch it) or silence. Then let them go, or hand them to the watch.'}}

// ---- the DM's voice (table_call; a bounded wait, then the DM's reflex fills it and the DM log marks it a fill, #561) ----
const SAY={
  truth:['"Fine. Fine! {t}. That is all I know."','"You want it? {t}. Now let me be."','A long breath. "{t}."'],
  lie:['"{t}. I swear it."','"{t}," without a blink.','"Easy. {t}. Ask anyone."'],
  silent:['Nothing. A stare, and nothing.','"I have nothing to say to you."','They spit on the ground and look away.'],
  again:['"I told you already. There is nothing more."','"That is all of it. On my life."'],
  caught:['Their eyes slide away; the lie is plain on their face.','A flush, a swallow: they know they are caught.'],
  honest:['They hold the gaze; whatever it is, they believe it.'],unsure:['A face like a shut door.'],
  released:['"I will not forget this."','They back away, then run.'],handed:['"You will regret this," as the ropes go on.','They go quiet when they hear the word "watch".'],
};
const textOf=(sc,k)=>{const c=sc.ctx;return k==='truth'||k==='again'?c.secret.text:k==='lie'?c.lie.text:''};
const DM_IQ={
  onFrame(sc){const c=sc.ctx,L=atTable(sc),n=nameOf(sc);
    pushCall(sc,{kind:'voice',who:n,about:'Voice '+n+(c.mode==='yield'?', who just yielded to '+L.map(a=>a.name).join(', ')+' and is now held for questions':', a suspect brought before '+L.map(a=>a.name).join(', ')+' for questioning')+(c.want?' (they want: '+c.want+')':'')+
      '. One or two lines as they face the questions: fear, defiance or a bargain, in their own voice. Give away nothing yet; the dice decide what they tell.'})},
  onBeat(sc,b){if(!ASKS[b.k]&&b.k!=='release'&&b.k!=='hand_over')return;const c=sc.ctx,n=nameOf(sc),last=c.said[c.said.length-1],k=ASKS[b.k]?(last&&last.k):b.k==='release'?'released':'handed';
    const truth=k==='truth'||k==='again'?' They tell the truth: '+c.secret.text+'.':k==='lie'?' They lie: they say '+c.lie.text+' (it is not true).':k==='silent'?' They give nothing up.':k==='caught'?' The lie they told shows on their face.':k==='honest'?' What they said was meant.':k==='unsure'?' Their face gives nothing away.':'';
    pushCall(sc,{kind:'answer',who:n,beat:sc.beats.length-1,k,about:b.name+' '+low(b.text)+(b.line?' and says "'+b.line+'"':'')+(b.res?' ('+b.res+')':'')+'. The dice decided:'+truth+(k==='released'?' They are let go.':k==='handed'?' They are handed to the watch at '+c.watch+'.':'')+
      ' Voice '+n+' answering, one or two lines, true to the dice: say what the dice say they say, and nothing more.'})},
  onAll(){},
  live:voiceLive,
  fill(sc,c){const n=nameOf(sc),k=c.kind==='voice'?null:c.k,seed=(sc.id|0)*7+(c.id|0);
    const text=c.kind==='voice'?pickH(seed,2,sc.ctx.mode==='yield'?['"Ask, then. I will not beg."','"You won. What do you want?"','"Kill me or ask. I am tired."']:['"I have done nothing. Ask what you like."','"Whoever sent you has it wrong."']):pickH(seed,3,SAY[k]||SAY.silent).replace('{t}',cap(textOf(sc,k)));
    resolveCall(sc,c,{text:n+': '+text,by:'scripted'});speaking(sc,n)},
  done(sc){if(sc.ctx.staged!=null)stageDone(sc)}, // a staged suspect: the staging closes its record (sim/staged.js)
};
const cap=s=>s?s.charAt(0).toUpperCase()+s.slice(1):s;
// The banner and the scene map: the suspect's words are theirs ("Name: ..."), so the bubble sits over them.
function speaking(sc,n){if(sc.narr&&sc.narr.text&&!sc.narr.text.startsWith(n+': '))sc.narr.text=n+': '+sc.narr.text}
setSceneKind('interrogation',{options,reflex,apply,outcome,next,view,get liveMs(){return IQ.LIVE_MS},everyBeat:true,dm:DM_IQ,stagedCtx:(rec,mem)=>stagedCtx(rec,mem)});
voicedKind('interrogation',(sc,c)=>{speaking(sc,nameOf(sc));return null});
export const iqView=C=>C&&C.iqQ?{waiting:'interrogation'}:null;

// ---- a suspect the DM agent staged (sim/staged.js calls this when the party meets them) ----
// rec.cast {name, npc, reveal, place, lie, attitude, want}; returns the ctx fields of the scene.
export function stagedCtx(rec,mem){const C=rec.cast,w=npcOf(C.npc),at=w?{x:w.x,y:w.y}:rec.at,ATT={hostile:2,wary:1,neutral:0,friendly:-2};
  const L=leadsFor({x:at.x,y:at.y,lvl:rec.lvl||5},at,mem),wrong=L.find(p=>p.name!==C.place);
  return {mode:'staged',who:{kind:'npc',id:C.npc,name:C.name||'the suspect',lvl:rec.lvl||Math.max(1,Math.round(mem.reduce((s,a)=>s+a.lvl,0)/Math.max(1,mem.length)))},
    dc:IQ.DC+(ATT[C.attitude]||0),secret:{text:C.reveal||'they know nothing',place:C.place||null},
    lie:{text:C.lie||(wrong?leadText(wrong,at,true):'they were nowhere near it'),place:null},said:[],...(C.want?{want:C.want}:{}),...(rec.town?{watch:rec.town}:{})}}
