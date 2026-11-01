// Hero chatter: say(a,trigger,ctx) picks a faction-flavoured line from data/barks.js,
// stores it on the speaker's chat buffer and on every living hero within earshot, and
// shows it as a speech bubble (render/bubbles.js, follow view only). Owned by ai-designer.
// Rules: a hero speaks at most once per COOL real seconds; death, epic, duel and kill
// lines may interrupt after URGENT seconds. Chatter has no gameplay effect and rolls its
// own random numbers so the gameplay stream is untouched. Per-hero fields (chat, chatCd,
// bubble, spotTgt, duelFoe) are created lazily here so heroes.js only gains say() calls.
import {dist} from '../world/map.js';
import {MOBS} from '../data/mobs.js';
import {BARKS,CLASS_BARKS} from '../data/barks.js';
import {S,clockStr} from './state.js';
import {nearHeroes} from './spatial.js';
import {brainLine} from './brain.js';

export const COOL=20,URGENT=3,HEAR=7,CAP=20,BUBBLE=3,BANTER=60;
const URGENT_TRIGGERS={mourn:1,epic:1,duel:1,kill:1};
// An agent-played hero says only what its agent says (issue #126): no scripted bark, banter or call at all.
// Its own lines (say, party_say, a table line) are marked here for the watcher's Chat tab: "AGENT · <runner
// model>" (e.ai stays for model-written mind lines). The tag comes from the host (the page knows each runner's
// model, src/ui/player-bridge.js); heroes never read it (chat_read and events carry the text only).
let agentTag=()=>null;export function setAgentTag(fn){agentTag=typeof fn==='function'?fn:()=>null}
export function agentLine(a,e){if(!e||e.from!==a)return e;e.agent=true;delete e.ai;const t=agentTag(a);e.model='AGENT · '+(t||'agent');return e}

// Private LCG so picking lines never perturbs the gameplay RNG.
let seed=0x2545f491;
const r=()=>{seed=(Math.imul(seed,1103515245)+12345)&0x7fffffff;return seed/0x80000000};

// Fill placeholders, then fix the article before a vowel ("a Ash Drake" -> "an Ash Drake").
const fill=(s,a,ctx)=>s.replace(/\{(\w+)\}/g,(_,k)=>k==='name'?a.name:ctx[k]!=null?String(ctx[k]):k).replace(/\b([Aa]) (?=[AEIOUaeiou])/g,'$1n ');

export function say(a,trigger,ctx={}){
  if(!a||a.state==='dead'||a.state==='ghost')return;
  if(a.player)return;
  if(ctx.p!=null&&r()>=ctx.p)return;
  a.chatCd=a.chatCd||0;
  if(a.chatCd>(URGENT_TRIGGERS[trigger]?COOL-URGENT:0))return;
  const base=BARKS[trigger];if(!base)return;
  const cls=CLASS_BARKS[trigger]&&CLASS_BARKS[trigger][a.fac]&&CLASS_BARKS[trigger][a.fac][a.cls];
  const pool=cls?base[a.fac].concat(cls):base[a.fac];
  let line=pool[Math.floor(r()*pool.length)];
  if(pool.length>1&&line===a.lastBark)line=pool[(pool.indexOf(line)+1)%pool.length];
  a.lastBark=line;
  const text=fill(line,a,ctx);
  // BRAIN: an AI-played hero asks for a line in the moment (said later by brain.js via speak);
  // with aiQuietTable the table line is held back and said only if no model line comes in time.
  if(a.brain&&brainLine(a,trigger,ctx,text)==='held'){a.chatCd=COOL;return}
  speak(a,text,trigger)}

// Put a line in the speaker's and every nearby listener's chat buffer and show the bubble.
// ai marks a model-written line (brain.js speaks those as follow-ups); a string is the model tag (#97).
export function speak(a,text,trigger,ai){const e={t:clockStr(),from:a,text,trigger};if(ai){e.ai=true;if(typeof ai==='string')e.model=ai}
  const ls=[];for(const b of nearHeroes(a.x,a.y,HEAR)){if(b===a||b.state==='dead'||b.hidden||dist(a,b)>HEAR)continue;ls.push(b)}
  // fh: a Fellowship member said it or can hear it (the watcher's Chat tab and bubbles, issue #127)
  if(S.fellowship&&(a.fellow||ls.some(b=>b.fellow)))e.fh=true;
  hear(a,e);for(const b of ls)hear(b,e);
  a.bubble={text,life:BUBBLE};if(e.fh)a.bubble.fh=true;a.chatCd=COOL;return e}

function hear(b,e){(b.chat||(b.chat=[])).push(e);if(b.chat.length>CAP)b.chat.shift()}

// Fight entry: speak once per target, and only when the monster is a real threat
// (two or more levels above the hero, or a named elite). Solo hunters only pick mobs up
// to one level above them, so this mostly fires for party members joining a leader's fight.
export function spotMob(a,m){if(!m||a.spotTgt===m)return;a.spotTgt=m;
  if(m.lvl>=a.lvl+2||m.elite)say(a,'spot',{mob:MOBS[m.type].name,level:m.lvl})}

// Duel start: each duelist speaks once per foe (pvp.js calls this every check).
export function duelBark(a,b){if(!b||a.duelFoe===b)return;a.duelFoe=b;say(a,'duel',{target:b.name})}

// Once per step: cool-downs, bubble fade, and party banter after BANTER seconds afield.
export function chatTick(dt){
  for(const a of S.agents){if(a.chatCd>0)a.chatCd-=dt;
    if(a.bubble){a.bubble.life-=dt;if(a.bubble.life<=0)a.bubble=null}}
  for(const p of S.parties){
    const out=p.mem.filter(b=>b.state==='hunt'||b.state==='follow'||b.state==='fight');
    if(out.length<2){p.chatT=0;continue}
    p.chatT=(p.chatT||0)+dt;if(p.chatT<BANTER)continue;p.chatT=0;
    say(out[Math.floor(r()*out.length)],'banter',{zone:p.zone})}}
