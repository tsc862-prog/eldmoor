// Talk round the fire (issue #571, owner request 2026-11-03: "long conversations that build up the characters' knowledge, as well
// as their own bio"). Owned by ai-designer; the DM's frame is answered by the DM runner's table voice (scripts/dm-agent.mjs). DOM-free.
//
//   fireside  when a company with agents at the table makes camp and settles to rest (sim/camp.js onCamp 'rest'), a Table scene
//             opens round the fire (PLAY 'turns' in sim/table.js): a topic from the company's day (the scripted DM picks it: a
//             companion's death, a newcomer, an oath kept, the Crypt or a boss, a job done, a hard lesson; else a member's oath or a
//             question one asks another), framed by the DM agent through table_call when it holds the seat. The members speak in
//             turn, round after round: speak, ask a named companion (who may answer on their turn), tell a story of their own past,
//             or listen. No votes, no dice. FIRE.STD (3) rounds on an ordinary night, FIRE.BIG (6) after a big event (a death, the
//             Crypt, a boss, a newcomer, an oath kept, a merge or an expulsion); the DM agent may set 3-6 with table_answer
//             {rounds}. A round in which nobody says a word ends the talk; a member whose agent let FIRE.LIVE_MS pass is not waited
//             for again that night (it listens). Only members at the camp take part.
//   debrief   after a hard scene (a rescue, a member fallen, a fight that left half of them below FIRE.HURT, a vote decided by one
//             voice) the members present get one round, everyone at once (PLAY 'all'): how was that.
//   after     the fire's talk becomes knowledge: each agent member gets a reflection moment (sim/reflect.js, kind 'fireside':
//             "what did you learn about <companions> tonight?", memories with about and, rarely, a stance change via become).
//             A story told of one's own past goes into the teller's backstory (persona.js tellStory: a.told and a "told: ..."
//             line in its persona history; every turn header reminds it, toldLine) and into each listener's notebook (about the
//             teller, tags story and fireside).
//
// Determinism: it runs only in a world whose host reports runner links (hasLinks: the page, play-headless) and only for a company
// in which an agent has the say (agentsDecide). npm run sim and the seeded checks (no host) never queue or open one, so their
// hashes do not move. Picks use hashes of ids, never the gameplay RNG.
//
// State (plain data, saved with the world): C.fire {last, seq, past, ev:[{k, text, big, gm}]}: the last fireside's game minute,
// the campaign-log entry and fallen count it had read, and the day's oaths and lessons since; C.fireQ {mode, at, ...}: one waiting.
import {S} from './state.js';
import {swornOf,oathSaid} from './oath.js'; // only a spoken oath is talk for the fire (#800)
import {ZONES} from '../world/map.js';
import {cryptOfHero} from './crypts.js';
import {hash} from '../core/rng.js';
import {maxHp} from './heroes.js';
import {notify} from './notify.js';
import {remember} from './memory.js';
import {addHeroNote} from './notebook.js';
import {moment,onMoment} from './reflect.js';
import {tellStory} from './persona.js';
import {emoteAct} from './aside.js';
import {hasLinks} from './runlink.js';
import {worldHeld} from './prep.js';
import {inRange} from './reach.js';
import {onCamp,campOf} from './camp.js';
import {companies,companyOf,members,slotHeroes,slotted} from './company.js';
import {openScene,setSceneKind,tableOn,agentsDecide,onSceneEnd,sceneCompany,sceneFor} from './table.js';
import {pushCall,resolveCall,voiceLive,voicedKind} from './arrival.js';

export const FIRE={
  ON:true,         // off: no fireside or debrief opens (checks about other things at camp turn it off)
  STD:3,BIG:6,MIN:3,MAX:6, // rounds of talk: an ordinary night, a night after a big event, and the range the DM agent may set
  LIVE_MS:60000,   // real ms the fire waits for a live agent's line before it listens (not waited for again that night)
  COOL:360,        // game minutes between two firesides of one company
  DEBRIEF_COOL:120,// game minutes between two debriefs of one company
  QUEUE_MIN:120,   // game minutes a waiting fireside or debrief keeps before it is dropped
  HURT:.35,        // a fight that leaves half of those in it below this share of HP is a hard one
  TOPICS:3,        // topics named in the frame
  EV:6,            // oaths and lessons kept for the next fire
  DAY:1440,        // game minutes back the fire looks for the day's talk (at most since the last fire)
};
const gd=t=>({t,c:'gd'});
const byId=id=>S.agents.find(x=>x.id==id)||null;
const living=a=>!!a&&a.kind==='hero'&&a.state!=='dead';
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f<>{}]+/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const cut=(s,n)=>{s=clean(s,1e4);return s.length<=n?s:s.slice(0,n-1).trimEnd()+'…'};
const plain=ps=>(ps||[]).map(p=>typeof p==='string'?p:p&&p.kind==='hero'?p.name:p&&p.t||'').join('');
const names=L=>L.length<2?L.join(''):L.slice(0,-1).join(', ')+' and '+L[L.length-1];
const slug=s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const pickH=(seed,k,list)=>list[Math.floor(hash(seed|0,k,71)*list.length)%list.length];
const memOf=C=>!C?[]:C===slotted()?slotHeroes(slotted()):members(C).filter(a=>!a.hire); // a hire is never seated at a scene (#634)
const fireOf=C=>C.fire||(C.fire={last:-1e9,seq:0,past:0,ev:[]});
const FIGHTING=['fight','duel','assist','raid','dungeon'];
const isFire=k=>k==='fireside'||k==='debrief';

// ---- what the day gave them to talk about ----
const BIG_MARK={death:1,boss:1,crypt:1},TALK_MARK={...BIG_MARK,elite:1,nemesis:1,vow:1}; // joining comes from the log (recruit, join), not the founding's landmarks
function topicsOf(C,here){const F=fireOf(C),since=Math.max(F.last,S.gameMin-FIRE.DAY),out=[],add=(k,text,big)=>{const t=cut(text,140);if(t&&!out.some(x=>x.text===t))out.push({k,text:t,big:!!big})};
  for(const e of C.log||[]){if(e.id<=(F.seq||0))break;const t=plain(e.parts);
    if(e.gameMin<since)break;if(e.kind==='death')add('death',t,1);else if(e.kind==='recruit'||e.kind==='join')add('newcomer',t,1);else if(e.kind==='merge'||e.kind==='expel')add(e.kind,t,1);
    else if(e.kind==='leave')add('leave',t);else if(e.kind==='outcome')add('job',t)}
  for(const p of (C.past||[]).slice(F.past||0))if(p.day>=Math.floor(since/1440)+1)add('death',p.name+' fell'+(p.cause?' ('+p.cause+')':''),1); // a company's fallen (sim/company.js)
  for(const a of here)for(const m of (a.tiers&&a.tiers.marks)||[])if(m.gm>since&&TALK_MARK[m.k])add(m.k,a.name+': '+m.text,BIG_MARK[m.k]); // landmarks (sim/tiers.js)
  for(const v of F.ev||[])if(v.gm>since)add(v.k,v.text,v.big);
  out.sort((x,y)=>y.big-x.big);
  if(!out.length){const sworn=here.filter(a=>swornOf(a)&&a.goal.text);
    const fresh=here.filter(a=>C.joined&&C.joined[a.id]!=null&&S.gameMin-C.joined[a.id]<2*1440);
    if(fresh.length)add('newcomer','There is a newer face at the fire: '+fresh[0].name);
    if(sworn.length){const a=pickH(C.id+S.gameMin,1,sworn);add('oath',oathSaid(a))}
    if(here.length>1){const a=pickH(C.id+S.gameMin,2,here),o=here.filter(b=>b!==a),b=pickH(a.id+S.gameMin,3,o);
      add('question',a.name+' has a question for '+b.name+': '+pickH(a.id+b.id,4,['where do you come from, truly?','why did you take this road?','what are you afraid of?','who taught you to fight?','what will you do when this is done?']))}}
  return out}
const INTRO={death:'No one has said it yet: ',newcomer:'',merge:'',expel:'',oath:'',question:'',boss:'The day is still in their ears: ',crypt:'The day is still in their ears: ',job:'The work is done: ',lesson:'A hard lesson today: '};
const intro=t=>t?(INTRO[t.k]!=null?INTRO[t.k]:'Today: ')+t.text.replace(/[.!?]*$/,'.'):'The night is quiet.';
const AIR=['The fire cracks and settles; beyond its light the dark is very still.','Sparks go up into a clear, cold sky.','Wind moves in the grass at the edge of the light, and the fire leans with it.','Someone feeds the fire a dry branch; for a moment every face is bright.'];

// ---- opening ----
const ok=(C,L)=>FIRE.ON&&hasLinks()&&tableOn()&&L.length>=2&&agentsDecide(L);
function hereAt(C,q){const L=memOf(C).filter(living);
  if(q.mode==='camp'){const g=campOf(C);if(!g||g.phase!=='rest')return false;const H=L.filter(a=>a.state==='camp'&&g.ids.includes(a.id));return H.length>=2?H:false}
  const ids=(q.ids||[]).map(byId).filter(living);if(ids.some(a=>FIGHTING.includes(a.state)||a.raid)||ids.some(cryptOfHero))return null; // not yet: still in it
  const an=ids.find(a=>a.id===q.anchor&&!a.hidden)||ids.find(a=>!a.hidden);if(!an)return false;const H=ids.filter(b=>b===an||inRange(an,b));return H.length>=2?H:false}
function openFire(C,q,H){const skip=memOf(C).filter(a=>!H.includes(a)).map(a=>a.id),F=fireOf(C),gm=Math.round(S.gameMin);
  if(q.mode==='camp'){const T=topicsOf(C,H),big=T.some(t=>t.big),g=campOf(C),zn=g?ZONES[g.zone]||'the wilds':'the wilds',rounds=big?FIRE.BIG:FIRE.STD;
    const topic=T[0]||null,frame=['The fire is lit in ',gd(zn),'. ',intro(topic),big?' It will be a long night of talk.':''];
    const sc=openScene('fireside','Round the fire',frame,{mode:'camp',topic:topic?topic.text:null,tk:topic?topic.k:null,topics:T.slice(0,FIRE.TOPICS).map(t=>t.text),rounds,rd:1,asked:{},told:[],zone:zn,skip,anchor:H[0].id,...(g?{camp:{x:g.x,y:g.y}}:{})},C);
    if(!sc)return null;sc.rd=1;F.last=gm;F.ev=[];if(g)g.agentTalk=1;return sc} // the fire is the talk: no extra "the fire is lit" nudge (sim/camp.js)
  const sc=openScene('debrief','After '+cut(q.title,60),[gd(cut(q.title,60)),' is over. ',pickH(C.id+gm,5,['They catch their breath.','Nobody speaks at first.','Someone laughs, too loud, and stops.']),' How was that?'],{mode:'debrief',about:q.title,skip,anchor:H[0].id},C);
  if(sc)F.dlast=gm;return sc}
// Once per step (sim/index.js, after the table): a waiting fireside or debrief opens when its company's table is free.
export function fireTick(){const CS=S.companies;if(!CS||!CS.some(C=>C.fireQ)||worldHeld())return; // the start gate or the DM's prep holds the world (#559): no fire opens meanwhile
  for(const C of companies()){const q=C.fireQ;if(!q)continue;
    if(S.gameMin-q.at>FIRE.QUEUE_MIN||!hasLinks()){delete C.fireQ;continue}
    if(sceneFor(C))continue; // each company its own table (#518)
    const H=hereAt(C,q);if(H===null)continue;delete C.fireQ;if(!H||!ok(C,H))continue;
    if(openFire(C,q,H))return}}
// A company settles to rest at its camp: the fire's talk waits for the table (sim/camp.js emits 'rest').
onCamp((kind,g)=>{if(kind!=='rest'||!g||!hasLinks())return;const a=byId(g.ids[0]),C=a&&companyOf(a);if(!C)return;
  const F=C.fire;if(F&&S.gameMin-F.last<FIRE.COOL)return;if(C.fireQ&&C.fireQ.mode==='camp')return;
  const L=g.ids.map(byId).filter(living);if(!ok(C,L))return;C.fireQ={mode:'camp',at:Math.round(S.gameMin)}});
// The day's oaths and lessons, for the next fire (agent heroes only: sim/reflect.js raises moments for no one else).
onMoment((a,kind,detail)=>{if(kind!=='oath'&&kind!=='lesson')return;const C=companyOf(a);if(!C||!hasLinks())return;const F=fireOf(C);
  F.ev.push({k:kind,text:kind==='oath'?a.name+' kept an oath: '+clean(detail,100):a.name+': '+clean(detail,100),big:kind==='oath',gm:Math.round(S.gameMin)});while(F.ev.length>FIRE.EV)F.ev.shift()});
// A hard scene is over: one round of how was that. A fireside's end marks what the fire has talked over.
function hard(sc){const ids=sc.ids.map(byId).filter(Boolean);if(sc.kind==='rescue'||(sc.fell||[]).length||ids.some(a=>!living(a)))return true;
  if(sc.kind==='elite'||sc.kind==='ambush'||sc.kind==='boss'||sc.kind==='crawl'){const L=ids.filter(living);return L.length>1&&L.filter(a=>a.hp<maxHp(a)*FIRE.HURT).length*2>=L.length}
  if(sc.kind==='decision'){const y=sc.beats.filter(b=>b.k==='yes').length,n=sc.beats.filter(b=>b.k==='no').length;return y+n>=3&&Math.abs(y-n)<=1}
  return false}
onSceneEnd(sc=>{if(!hasLinks())return;const C=sceneCompany(sc);if(!C)return;
  if(isFire(sc.kind)){const F=fireOf(C);F.seq=C.seq||0;F.past=(C.past||[]).length;return}
  if(sc.kind==='opening'||sc.kind==='arrival'||!hard(sc))return;const F=fireOf(C);if(S.gameMin-(F.dlast||-1e9)<FIRE.DEBRIEF_COOL)return;
  if(C.fireQ&&C.fireQ.mode==='camp')return; // the fire will talk it over
  const c=sc.ctx||{};C.fireQ={mode:'debrief',at:Math.round(S.gameMin),title:sc.title,ids:sc.ids.slice(),anchor:c.anchor!=null?c.anchor:c.hero!=null?c.hero:null}});

// ---- at the fire ----
const atFire=sc=>sc.ids.map(byId).filter(living);
const others=(sc,a)=>atFire(sc).filter(b=>b!==a);
function options(sc,a){const c=sc.ctx,o=[];
  if(c.mode==='debrief')return [{k:'speak',text:'Say how that was for you (your line)'},{k:'listen',text:'Say nothing; let the others talk'}];
  const q=c.asked&&c.asked[a.id];if(q)o.push({k:'answer',text:'Answer '+q.name+'\'s question: "'+cut(q.q,90)+'"'});
  o.push({k:'speak',text:'Speak'+(c.topic?' to the talk ('+cut(c.topic,60)+')':' your mind')});
  for(const b of others(sc,a))o.push({k:'ask-'+slug(b.name),text:'Ask '+b.name+' something (your line is the question; they may answer on their turn)'});
  o.push({k:'tell',text:'Tell a story from your own past (your line is the story; it becomes part of your backstory and they will remember it)'});
  o.push({k:'listen',text:'Listen; say nothing this round (a short line is an act, shown as "<you> <line>", like "pokes the fire")'});return o}
// A silent agent, or a member with no runner, listens: nobody's words are made up for them.
const reflex=()=>'listen';
function apply(sc,a,act){const c=sc.ctx,k=act.k,line=act.line||'';
  if(k==='listen'){const t=line&&emoteAct(a,{text:line});act.line=''; // a listener's line is an emote, never speech (#646)
    return t&&t.ok?'listens, and '+t.emoted:'listens'}
  if(k==='speak')return line?'speaks':'says little';
  if(k==='answer'){const q=c.asked&&c.asked[a.id];if(q)delete c.asked[a.id];return line?'answers '+(q?q.name:'them'):'shrugs off the question'}
  if(k==='tell'){if(!line)return 'begins a story, then lets it go';(c.told||(c.told=[])).push({id:a.id,text:line});return 'tells of their past'}
  if(k.startsWith('ask-')){const b=others(sc,a).find(x=>'ask-'+slug(x.name)===k);if(!b)return 'asks no one';if(!line)return 'looks at '+b.name+' and says nothing';
    (c.asked||(c.asked={}))[b.id]={id:a.id,name:a.name,q:line};if(b.player)notify(b,a.name+' asks you round the fire: "'+cut(line,160)+'". Answer on your turn (answer).',false,1);return 'asks '+b.name}
  return null}
// Another round while the talk holds: rounds left, two or more still at the fire, and a word said in the round just played.
function next(sc){const c=sc.ctx;if(c.mode!=='camp'||(c.rd||1)>=c.rounds)return false;
  const g=campOf(sceneCompany(sc)),here=atFire(sc).filter(a=>a.state==='camp'&&(!g||g.ids.includes(a.id)));if(here.length<2)return false;
  const rd=sc.rd||1;if(!sc.beats.some(b=>(b.rd||1)===rd&&b.line)){c.quiet=1;return false} // a silent round: the talk has run out
  sc.rd=c.rd=rd+1;return true}
function outcome(sc){const c=sc.ctx,here=atFire(sc),spoke=sc.beats.filter(b=>b.line),who=[...new Set(spoke.map(b=>b.name))];
  for(const a of here)for(const b of here)if(a!==b&&who.includes(b.name))(a.talkHeard||(a.talkHeard={}))[b.id]=1; // heard round the fire: met (sim/talk.js)
  const tellers=[];
  for(const t of c.told||[]){const a=byId(t.id);if(!living(a))continue;const to=here.filter(b=>b!==a),told=tellStory(a,t.text,to);if(!told)continue;tellers.push(a.name);
    remember(a,'camp','Round the fire I told them of my past: "'+cut(told,150)+'"');
    for(const b of to){remember(b,'camp',a.name+' told round the fire: "'+cut(told,150)+'"');
      if(b.player)addHeroNote(b,{title:a.name+'\'s story',text:a.name+' told us round the fire: "'+told+'"',tags:['story','fireside'],about:a.name})}}
  if(c.mode==='camp'){for(const a of here){if(!a.player)continue;const o=here.filter(b=>b!==a).map(b=>b.name);
      if(o.length)moment(a,'fireside','what did you learn about '+names(o)+' tonight? (remember it with about: their name)')}
    const n=sc.rd||1;return (who.length?names(who)+' talked round the fire':'The fire burned down in silence')+(c.topic&&who.length?' ('+cut(c.topic,70)+')':'')+(who.length?', '+n+' round'+(n>1?'s':'')+(c.quiet&&n<c.rounds?' before the talk ran out':''):'')+'.'+(tellers.length?' '+names(tellers)+' told of '+(tellers.length>1?'their':'their own')+' past.':'')}
  return who.length?names(who)+' talked it over.':'Nobody said much.'}
function view(sc,a){const c=sc.ctx;if(c.mode!=='camp')return {talk:'one round: how was that'};const q=c.asked&&c.asked[a.id];
  return {topic:c.topic||null,talk_round:(sc.rd||1)+' of up to '+c.rounds,...(q?{asked_you:q.name+': "'+cut(q.q,120)+'"'}:{}),how:'Speak in your own voice; ask a companion by name; tell a story of your past (it becomes your backstory); or listen.'}}

// ---- the DM's frame (the DM agent through table_call; a bounded wait, then the DM's reflex fills it and is logged as a fill, #561) ----
const DM_FIRE={
  onFrame(sc){const c=sc.ctx,L=atFire(sc);
    pushCall(sc,{kind:'frame',who:'the narrator',about:'Frame the night\'s talk round the fire for '+L.map(a=>a.name+' ('+a.cls+')').join(', ')+' at their camp in '+c.zone+
      '. What the day gave them: '+(c.topics.length?c.topics.join(' | '):'a quiet day')+'. Planned: '+c.rounds+' rounds of talk ('+FIRE.STD+' for an ordinary night, '+FIRE.BIG+' after a big one; you may set '+FIRE.MIN+'-'+FIRE.MAX+' with table_answer rounds).'+
      ' Write the fire and the night, and open the talk with one question or image on the topic (one short paragraph). Decide nothing for them; speak for none of them.'})},
  onAll(){},
  live:voiceLive,
  fill(sc,c){resolveCall(sc,c,{text:pickH(sc.id+(sc.company|0),6,AIR)+' '+intro(sc.ctx.topic?{k:sc.ctx.tk,text:sc.ctx.topic}:null),by:'scripted'})},
  done(){},
};
setSceneKind('fireside',{options,reflex,apply,outcome,next,view,get liveMs(){return FIRE.LIVE_MS},dm:DM_FIRE});
setSceneKind('debrief',{options,reflex,apply,outcome,view,get liveMs(){return FIRE.LIVE_MS}});
voicedKind('fireside',(sc,c,a)=>{if(c.kind!=='frame'||a==null||a.rounds==null)return null;const n=Math.round(Number(a.rounds));if(!Number.isFinite(n))return null;
  sc.ctx.rounds=Math.max(FIRE.MIN,Math.min(FIRE.MAX,n));return {rounds:sc.ctx.rounds}});
export const fireView=C=>C&&C.fireQ?{waiting:C.fireQ.mode}:null;
