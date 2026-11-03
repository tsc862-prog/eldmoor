// Visions (issue #639, owner request 2026-11-03): an omen at a shrine, a shared dream at camp, a vision in a strange place. Owned
// by ai-designer. DOM-free.
//
//   staging  the DM agent stages it (stage_scene kind 'vision', sim/staged.js): no cast to walk, no dice, no complication. near a
//            member, a company or "fellowship": it opens when they next rest (a camp, or a rest at an inn), within hours; near a
//            place (a marked place, a landmark, "x,y", a region): when a member stands there. It counts as a staged scene (the day's
//            limit and the companies' reserve) and never opens while one of them fights, raids or is down in the Crypt.
//   play     PLAY 'all' in sim/table.js: every member present (within shouting range of the one it found) gets the frame at once
//            and answers with one option: see (the line is what they see, up to TABLE.LINE_MAX), turn_away, or ask (the line is
//            one question; the DM may answer it through the vision). Nothing here rolls or hurts; free actions (attempt) are not
//            offered.
//   the DM   voiced like the fireside (sim/arrival.js voicedKind; table_call / table_answer): one frame call as the scene opens,
//            one answer call per question asked, one combined outcome call once everyone answered. A call the DM leaves
//            unanswered is filled by its reflexes after the bounded wait (sim/dmreflex.js, #561) and logged as a fill.
//   after    if anyone looked (see or ask), cast.reveal, cast.place and cast.creature land in every present member's lore (a place
//            learned, a creature or place named in the reveal heard of: sim/lore.js); if all turned away, the vision fades and
//            teaches nothing. Every member present remembers it (memory.js); agents keep a note tagged vision (what they saw,
//            what the others saw, what the vision answered) and get a reflection moment (kind 'vision').
//
// Determinism: nothing opens unless the DM agent stages one, so npm run sim and the seeded hashes are unchanged. Picks use
// hashes, never the gameplay RNG.
import {S} from './state.js';
import {hash} from '../core/rng.js';
import {notify} from './notify.js';
import {remember} from './memory.js';
import {addHeroNote} from './notebook.js';
import {moment} from './reflect.js';
import {hear,learnPlace} from './lore.js';
import {setSceneKind,stageDone} from './table.js';
import {pushCall,resolveCall,voiceLive,voicedKind} from './arrival.js';

export const VISION={
  NOTE:600,      // characters of the note an agent keeps of it (the wait: STAGE.VISION_H in sim/staged.js)
};
const byId=id=>S.agents.find(x=>x.id==id)||null;
const living=a=>!!a&&a.kind==='hero'&&a.state!=='dead';
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f<>{}]+/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const cut=(s,n)=>{s=clean(s,1e4);return s.length<=n?s:s.slice(0,n-1).trimEnd()+'…'};
const plain=ps=>(ps||[]).map(p=>typeof p==='string'?p:p&&p.kind==='hero'?p.name:p&&p.t||'').join('');
const names=L=>L.length<2?L.join(''):L.slice(0,-1).join(', ')+' and '+L[L.length-1];
const low=s=>s?s.charAt(0).toLowerCase()+s.slice(1):s;
const pickH=(seed,k,list)=>list[Math.floor(hash(seed|0,k,639)*list.length)%list.length];
const atScene=sc=>sc.ids.map(byId).filter(living);
const LOOKED={see:1,ask:1};

// ---- at the table ----
function options(sc,a){return [{k:'see',text:'Look into the vision and say what you see (your line is what you see)'},
  {k:'ask',text:'Ask the vision one question (your line is the question; it may answer)'},
  {k:'turn_away',text:'Turn away from it'}]}
const reflex=()=>'see'; // a silent agent looks, and says nothing: nobody's words are made up for them
function apply(sc,a,act){const k=act.k,line=act.line||'';
  if(k==='turn_away')return 'turns away';
  if(k==='ask')return line?'asks the vision':'means to ask, but no words come';
  if(k==='see')return line?'sees':'looks, and keeps it to themselves';
  return null}
function view(sc,a){const c=sc.ctx;return {vision:sc.title,...(c.trig==='rest'?{while:'you rest'}:{}),
  how:'Say what you see (see: your line is what you see), ask the vision one question (ask), or turn away. No dice: nothing in a vision can hurt you. What it shows stays with you.'}}
// What each member made of it, from the beats and the DM's calls.
const asked=sc=>sc.beats.filter(b=>b.k==='ask'&&b.line);
const answerTo=(sc,b)=>{const c=(sc.calls||[]).find(x=>x.kind==='answer'&&x.beat===sc.beats.indexOf(b));return c&&c.text?c.text:null};
function outcome(sc){const c=sc.ctx,L=atScene(sc),looked=sc.beats.filter(b=>LOOKED[b.k]),away=sc.beats.filter(b=>b.k==='turn_away').map(b=>b.name);
  const told=(sc.calls||[]).find(x=>x.kind==='outcome'),end=told&&told.text?told.text:'',seen=sc.beats.filter(b=>b.k==='see'&&b.line);
  const lore=looked.length&&(c.reveal||c.place||c.creature);
  for(const b of L){const me=sc.beats.find(x=>x.id===b.id),turned=me&&me.k==='turn_away';
    if(lore){if(c.place)learnPlace(b,c.place,'told');for(const t of [c.reveal,c.creature,c.place])if(t)hear(b,t,'a vision')} // a place, a creature: what it shows is known now
    remember(b,'table',(turned?'I turned away from a vision ('+sc.title+')':'A vision ('+sc.title+')')+(looked.length&&c.reveal?': '+cut(c.reveal,120):end?': '+cut(end,120):'')+'.');
    if(!b.player)continue;
    const parts=['The vision: '+cut(plain(sc.frame),200)+'.'];
    if(me&&me.line)parts.push((me.k==='ask'?'I asked: ':'I saw: ')+'"'+cut(me.line,160)+'"'+(me.k==='ask'&&answerTo(sc,me)?' It answered: '+cut(answerTo(sc,me),160):''));
    else if(turned)parts.push('I turned away.');
    for(const x of seen)if(x.id!==b.id)parts.push(x.name+' saw: "'+cut(x.line,100)+'"');
    for(const x of asked(sc))if(x.id!==b.id){const ans=answerTo(sc,x);parts.push(x.name+' asked "'+cut(x.line,80)+'"'+(ans?'; it answered: '+cut(ans,100):''))}
    if(lore&&c.reveal)parts.push('It showed: '+cut(c.reveal,160));if(end)parts.push(cut(end,160));
    addHeroNote(b,{title:'Vision: '+cut(sc.title,50),text:cut(parts.join(' '),VISION.NOTE),tags:['vision'],...(c.place?{about:c.place}:{})});
    moment(b,'vision',cut(sc.title,60));
    notify(b,'The vision fades: '+sc.title+'.'+(lore&&c.reveal?' It showed: '+cut(c.reveal,160):''),true,1)}
  if(!looked.length)return 'They turn from it, every one, and the vision fades.';
  return names(looked.map(b=>b.name))+(looked.length>1?' look':' looks')+' into it'+(away.length?'; '+names(away)+' turn'+(away.length>1?'':'s')+' away':'')+'.'} // what it showed stays with them: the summary goes to the whole company and the chronicle

// ---- the DM's voice ----
const AIR=['The world goes quiet and very far away, and the colours run like wet paint.','Sound drains out of the air; what is left is a light with no fire behind it.','For a breath the stars are close enough to touch, and they are not the stars of Eldmoor.','The ground tilts, and the dark opens like a door.'];
const ANSWER=['No words come back; only an image, sharp as cold water: {r}','The answer is a feeling more than a sound: {r}','Something answers, slow, from very far down: {r}'];
const NOANSWER=['No answer comes; the question echoes and is gone.','The vision does not answer; it only looks back.'];
const DM_VISION={
  onFrame(sc){const c=sc.ctx,L=atScene(sc);
    pushCall(sc,{kind:'frame',who:'the narrator',about:'A vision takes '+L.map(a=>a.name+' ('+a.cls+')').join(', ')+(c.trig==='rest'?' as they rest':' where they stand')+'. Your frame: '+plain(sc.frame)+
      (c.reveal?' What it may show: '+c.reveal+'.':'')+(c.place?' A place in it: '+c.place+'.':'')+(c.creature?' A creature in it: '+c.creature+'.':'')+
      ' Describe the vision as it takes them: what they see, hear and feel, one short paragraph, in images. Decide nothing for them; they each say what they see, ask it one question, or turn away.'})},
  onAll(sc){const c=sc.ctx;
    for(const b of asked(sc))pushCall(sc,{kind:'answer',who:b.name,beat:sc.beats.indexOf(b),about:b.name+' asks the vision: "'+b.line+'". Answer through the vision in one or two lines (an image, a voice, a sign)'+(c.reveal?'; you may show part of this truth: '+c.reveal:'')+'. Answer only what was asked.'});
    pushCall(sc,{kind:'outcome',beat:'all',who:'the party',about:'Everyone answered the vision at once: '+sc.beats.map(b=>b.name+' chose to '+low(b.text)+(b.line?' ("'+b.line+'")':'')).join('; ')+'. Describe how it ends for them together, one or two lines, true to what each chose'+
      (sc.beats.some(b=>LOOKED[b.k])?(c.reveal?'; those who looked keep this: '+c.reveal:''):'; they all turned away, so it shows them nothing more')+'. No harm comes of it.'})},
  live:voiceLive,
  fill(sc,c){const r=sc.ctx.reveal,seed=(sc.id|0)*13+(c.id|0)+(sc.company|0);let text;
    if(c.kind==='frame')text=pickH(seed,1,AIR);
    else if(c.kind==='answer')text=r?pickH(seed,2,ANSWER).replace('{r}',r):pickH(seed,3,NOANSWER);
    else text=sc.beats.some(b=>LOOKED[b.k])?'The vision lets them go; '+(r?'what it showed stays: '+low(r).replace(/[.!?]*$/,'.'):'a cold taste stays on the tongue.'):'They turn from it, and it is gone as if it had never been.';
    resolveCall(sc,c,{text,by:'scripted'})},
  done(sc){if(sc.ctx.staged!=null)stageDone(sc)}, // the staging closes its record with the scene's outcome (sim/staged.js)
};
// The ctx of a staged vision (sim/staged.js calls this when it opens).
function stagedCtx(rec){const C=rec.cast||{};return {trig:rec.trig||'place',...(C.reveal?{reveal:C.reveal}:{}),...(C.place?{place:C.place}:{}),...(C.creature?{creature:C.creature}:{})}}
setSceneKind('vision',{options,reflex,apply,outcome,view,dm:DM_VISION,stagedCtx,noAttempt:true});
voicedKind('vision',null);
