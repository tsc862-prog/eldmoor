// Free actions ruled by the DM (issue #522, owner request: "The ability to do anything in DnD is what makes it awesome").
// Owned by brain-builder (tools, the DM's call, the scripted ruling); the effects table is the bounded set below.
//
// A hero's agent may try anything the tools never named (attempt {what, how?, at?}; in a Table scene, scene_act attempt with
// the words as its line). The game asks the DM for a ruling (ruling_call / ruling_answer, like table_call): which skill, how
// hard (a DC word from a small table) and which bounded effects follow a success and a failure, plus the line the heroes
// hear. The game then rolls the d20 with the hero's own skill and applies the effects in one resolver (resolve, below).
//   - The DM is waited for only while its ruling voice polls (POLL_MS, Date.now): a bounded wait (TABLE.dmMs at 1x, or the
//     budget the voice asked for), then the scripted ruling fills it (the DM's reflex: skill by keywords, DC fair, reveal on
//     a 15+). Nobody listening: the scripted ruling answers at once. Every ruling is logged in the DM log (detail.ruling;
//     by 'dm-agent' or 'scripted' with fill:true and why 'slow'|'gone').
//   - Effects never touch level, XP, gold or life: a wound is at most ATTEMPT.WOUND_MAX % of max HP and never takes a hero
//     below ATTEMPT.FLOOR of it (the trap rule); an item goes through the give_item/take_item levers (their limits apply).
//   - Channels (#123): the hero hears the DM's text, the roll and what changed; never the DM's note or the call itself.
//   - State on S.rulings (plain data, saved). Only agent heroes attempt, so a seeded scripted world never reaches this
//     module (rulingTick is a no-op without S.rulings).
import {S,clockStr,dayNo} from './state.js';
import {ZONES,LANDMARKS,CRYPT,zoneAt,tileAt,dist} from '../world/map.js';
import {W,H,WALL,RIVER,LAVA} from '../world/tiles.js';
import {MOBS} from '../data/mobs.js';
import {SKILLS,SKILL_IDS,check,skillMod,trained} from './abilities.js';
import {ri} from '../core/rng.js';
import {notify} from './notify.js';
import {speak,agentLine,sayHearers} from './chat.js';
import {findPerson,warm,talkTo,convWith} from './talk.js';
import {ensureNpcs} from './npcs.js';
import {pull} from './levers.js';
import {stageScene} from './staged.js';
import {hear as hearLore,learnPlace,knowsPlace,foeName} from './lore.js';
import {heroMemory} from './notebook.js';
import {maxHp} from './heroes.js';
import {setEff,effOn} from './eff.js';
import {nearMobs,nearHeroes} from './spatial.js';
import {sceneOf} from './scenes.js';
import {setAttemptHooks,TABLE} from './table.js';
import {dmlog} from './dmlog.js';
import {notEnglish} from './lang.js';
import {record} from './history.js';
import {inSlots,slotted} from './company.js'; // the slotted company (#588)
import {dmAlive,goneEpoch,callDeadline,lateWhy} from './dmreflex.js'; // the one place that knows whether the DM listens (#561)
import {spokenAbout} from './epithet.js'; // a hero refusing a name given (#638)


export const ATTEMPT={
  PER_HOUR:3,        // attempts per hero per game hour (the DM is not asked to rule on every step)
  WHAT_MAX:300,      // characters: one or two sentences
  HOW_MAX:200,AT_MAX:80,
  POLL_MS:6000,      // real ms: a ruling_call poll this recent counts as the DM listening
  BUDGET_MIN:4,BUDGET_MAX:30, // seconds a ruling voice may ask for (ruling_call {budget_s}); default TABLE.dmMs
  WAIT_GM:60,        // game minutes a ruling may wait at most, whatever the clock
  MOVE_MAX:6,        // tiles a move effect may carry the hero
  WOUND_MAX:15,FLOOR:.1, // a wound: at most 15% of max HP, never below 10% HP
  EFFECTS_MAX:3,     // effects per side (success, failure)
  TEXT_MAX:2000,NOTE_MAX:200,FACT_MAX:200,
  BOON_GM:360,       // a boon holds for the hero's next attempt within 6 game hours
  COND_GM:[10,240],  // minutes a condition may last
  PAST:30,LOG:12,
};
export const DC={easy:8,fair:12,hard:15,heroic:18};
export const DC_WORDS=Object.keys(DC);
export const EFFECT_KINDS=['none','move','reveal','attitude','open_talk','open_scene','item','wound','condition','boon'];
export const REVEAL_KINDS=['place','fact','creature'];
export const SCENE_KINDS=['mystery','meeting','social','ambush','trap'];
export const CONDS={warded:{taken:.85,text:'warded (blows land a little lighter)'},exposed:{taken:1.15,text:'exposed (blows land a little harder)'}};
export const BOONS={d4:4,d6:6,d8:8};
const IN_SCENE_NO=['move','open_talk','open_scene']; // a Table scene keeps everyone where they are
const FIGHT_STATES=['fight','duel','assist','raid'];
// The words a ruling may not reach for (nothing touches level, XP, gold or life; HP only as a small wound).
const FORBID=/\b(levels?|lvl|xp|experience|hp|health|heal(?:s|ing)?|kill|slay|die|death|dead|life|revive|resurrect|gold|coins?|money)\b/i;
// Skill words a DM (or a small model) may use for the game's skills.
const SKILL_ALIAS={cunning:'traps',lockpicking:'traps',locks:'traps',might:'athletics',strength:'athletics',reflex:'athletics',presence:'persuasion',
  charm:'persuasion',bargain:'persuasion',insight:'perception',search:'perception',wits:'lore',knowledge:'lore',grit:'survival',stealthy:'stealth',medicine:'healing'};

const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f<>{}]+/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const lc=s=>String(s==null?'':s).toLowerCase().replace(/[^a-z0-9,.\- ]+/g,' ').replace(/\s+/g,' ').trim();
const hero=id=>S.agents.find(x=>x.id===id)||null;
const alive=a=>!!a&&a.state!=='dead'&&a.state!=='ghost';
const NARRATOR={kind:'dm',name:'The Narrator'};
const cap1=s=>s?s.charAt(0).toUpperCase()+s.slice(1):s;

export function rulingState(){return S.rulings||(S.rulings={seq:0,cur:[],past:[],day:{d:-1,asked:0,dm:0,scripted:0,refused:0},stats:{asked:0,dm:0,scripted:0,refused:0,late:0}})}
function today(){const R=rulingState(),d=Math.floor(S.gameMin/1440);if(R.day.d!==d)R.day={d,asked:0,dm:0,scripted:0,refused:0};return R.day}

// ---- is the DM listening? ----
// Its ruling voice polled ruling_call within POLL_MS, or the host says a runner holds the seat (sim/dmreflex.js dmAlive: a busy
// runner still gets its bounded TABLE.dmMs). The runner gone (dmreflex gone(), the seat closing) ends every wait at once.
// Module state only (never saved, never read by step()).
let polledAt=0,pollMs=0,epoch=0;
export function rulingHeard(budgetS){polledAt=Date.now();epoch=goneEpoch();const b=Number(budgetS);pollMs=Number.isFinite(b)&&b>0?Math.max(ATTEMPT.BUDGET_MIN,Math.min(ATTEMPT.BUDGET_MAX,b))*1000:0}
const goneNow=()=>{if(epoch!==goneEpoch()){epoch=goneEpoch();polledAt=0;pollMs=0;return true}return false};
const polled=()=>polledAt>0&&Date.now()-polledAt<ATTEMPT.POLL_MS;
const listening=()=>{goneNow();return !!(S.dmAgent&&S.dmAgent.seat)&&(polled()||dmAlive())};
const budget=()=>pollMs||TABLE.dmMs;
// When a waiting ruling is due (#680): its budget from the moment the DM first read it (ruling_call: seen), never past
// budget + PICKUP_MS from the attempt.
const due=r=>callDeadline(r.real,r.ms,r.seen);

// ---- the hero's side ----
function rate(a){const L=a.attempts||(a.attempts=[]);while(L.length&&(L[0]>S.gameMin||L[0]<=S.gameMin-60))L.shift();return L}
export const attemptsLeft=a=>Math.max(0,ATTEMPT.PER_HOUR-rate(a).length);
// Refusal for the words themselves (length, language); null when fine. Never for content.
function wordsRefusal(what,how){
  if(!what)return 'Say what you try: attempt {what: "one or two sentences", how?, at?}.';
  if(what.length>ATTEMPT.WHAT_MAX)return 'Too long: keep what you try under '+ATTEMPT.WHAT_MAX+' characters (one or two sentences).';
  if(how&&how.length>ATTEMPT.HOW_MAX)return 'Too long: keep how under '+ATTEMPT.HOW_MAX+' characters.';
  if(notEnglish(what)||how&&notEnglish(how))return 'Say it in English.';
  return null}
function heroRefusal(a){if(!alive(a))return 'The dead try nothing more.';if(a.hidden)return 'You are out of the world\'s reach just now (inside a dungeon run); try when you are back.';
  if(rate(a).length>=ATTEMPT.PER_HOUR)return 'You have tried '+ATTEMPT.PER_HOUR+' things this game hour; give the world a moment (wait), then try again.';return null}

// attempt {what, how?, at?}: a free action outside a fight round. Returns a tool result.
export function attempt(a,args={}){const what=clean(args.what,1e4),how=clean(args.how,1e4),at=clean(args.at,ATTEMPT.AT_MAX);
  const w=wordsRefusal(what,how);if(w)return {ok:false,error:w};
  const h=heroRefusal(a);if(h)return {ok:false,error:h};
  if(sceneOf(a))return {ok:false,error:'You are in a Table scene: try it there with scene_act {option: "attempt", line: "what you try"}.'};
  if(FIGHT_STATES.includes(a.state))return {ok:false,error:'You are in a fight: strike, use_ability, use_item or flee. attempt is for outside a fight round (in a Table scene, scene_act attempt).'};
  rate(a).push(S.gameMin);
  agentLine(a,speak(a,what+(how?' ('+how+')':''),'attempt'));spokenAbout(a,what); // refusing a name given aloud (#638) // the act said aloud: companions in earshot see what was tried
  const r=open(a,what,how,at,null);
  if(r.state==='wait')return {ok:true,attempt:what,ruling:'The DM weighs it (up to '+Math.round(r.ms/1000)+' s); the ruling comes as an event and in your chat.',call:r.id,attempts_left_this_hour:attemptsLeft(a)};
  return {ok:true,attempt:what,...heroView(r),attempts_left_this_hour:attemptsLeft(a)}}

// A request: asks the DM when it listens (state 'wait'), else is ruled by the scripted DM at once. sc: an open Table scene
// (the ruling is decided now, applied when the member's turn comes).
function open(a,what,how,at,sc){const R=rulingState(),d=today();R.stats.asked++;d.asked++;
  const r={id:++R.seq,hero:a.id,name:a.name,what,how:how||'',at:at||'',gm:Math.round(S.gameMin),day:dayNo(),t:clockStr(),scene:sc?sc.id:null,state:'wait',ms:0,real:0};
  R.cur.push(r);
  if(listening()){r.ms=budget();r.real=Date.now();return r}
  rule(r,scriptedRuling(a,r),'scripted','gone');if(!sc)resolve(r);return r}
// The DM's (or the scripted) ruling decided: kept on r until applied (a scene applies it on the member's turn).
function rule(r,ru,by,why){r.ru=ru;r.by=by;if(why)r.why=why;r.state='ruled';const R=rulingState(),d=today();
  if(by==='dm-agent'){R.stats.dm++;d.dm++}else{R.stats.scripted++;d.scripted++;if(why==='slow'&&r.real&&Date.now()>=due(r))R.stats.late++}}
function fill(r,why){if(r.state!=='wait')return;const a=hero(r.hero);if(!alive(a)){close(r,'lapsed');return}rule(r,scriptedRuling(a,r),'scripted',why)}

// Once per step (sim/index.js, before the Table hold): waits that ran out are filled; a ruled request outside a scene is applied.
export function rulingTick(){const R=S.rulings;if(!R||!R.cur.length)return;
  const gone=goneNow()||!(S.dmAgent&&S.dmAgent.seat);
  for(const r of R.cur.slice()){
    if(r.state==='wait'&&(gone||Date.now()>=due(r)||S.gameMin-r.gm>=ATTEMPT.WAIT_GM))fill(r,gone?'gone':'slow');
    if(r.state==='ruled'&&r.scene==null)resolve(r);
    else if(r.state==='ruled'&&r.scene!=null&&S.gameMin-r.gm>=ATTEMPT.WAIT_GM*4)close(r,'lapsed')}} // a scene that ended first

// ---- the scripted ruling (the DM's reflex) ----
// Skill by keywords (a door or lock: Traps; climb, swim, jump: Athletics; persuade, bargain, lie: Persuasion; search,
// listen: Perception; read, recall: Lore; ...; else Athletics, the hero's might); DC fair; a reveal on a total of 15+.
const KEYS=[[/\b(doors?|locks?|latch|bolts?|traps?|snares?|disarm|pick|wedge|pry|prise|jam|hinges?|mechanism)\b/,'traps'],
  [/\b(sneak|hide|creep|slip|unseen|quietly|shadows?)\b/,'stealth'],[/\b(threaten|intimidate|scare|glare|menace|warn off)\b/,'intimidation'],
  [/\b(persuade|bargain|haggle|lie|bluff|convince|offer|plead|charm|ask|beg|trade|toll|bribe)\b/,'persuasion'],
  [/\b(read|study|recall|decipher|runes?|inscriptions?|marks?|carvings?|lore|remember)\b/,'lore'],
  [/\b(search|listen|look|watch|spot|examine|inspect|peer|scan|notice|sniff|smell)\b/,'perception'],
  [/\b(track|trail|prints?|spoor|follow the)\b/,'tracking'],[/\b(bandage|tend|bind|herbs?|poultice|mend|splint)\b/,'healing'],
  [/\b(forage|fish|shelter|kindle|fire|weather|water)\b/,'survival'],[/\b(soothe|calm|comfort|understand|read (?:her|him|them))\b/,'empathy'],
  [/\b(climb|swim|jump|leap|lift|haul|push|break|run|vault|force|wade|scale)\b/,'athletics']];
export function keywordSkill(text){const t=lc(text);for(const [re,k] of KEYS)if(re.test(t))return k;return 'athletics'}
const PASS={traps:'It gives under {n}\'s hands with a dull click.',stealth:'{n} slips through unremarked.',intimidation:'It works: they think better of it.',
  persuasion:'{n}\'s words find their mark; the answer is yes, for now.',lore:'{n} remembers the old meaning of it.',perception:'{n} catches what others would miss.',
  tracking:'The trail is there for {n} to read.',healing:'{n}\'s hands are sure.',survival:'{n} knows this ground well enough.',empathy:'{n} reads them truly.',
  athletics:'{n} manages it, breathing hard.'};
const FAIL={traps:'It will not give; {n} only scrapes a knuckle.',stealth:'A twig, a glance: {n} is noticed.',intimidation:'They do not scare.',
  persuasion:'They hear {n} out and shake their head.',lore:'The meaning will not come to {n}.',perception:'Nothing {n} can make out.',
  tracking:'The trail runs cold under {n}\'s eye.',healing:'It is harder than it looked.',survival:'The land gives {n} nothing here.',empathy:'Their face tells {n} nothing.',
  athletics:'{n} tries and comes up short.'};
const nm=a=>String(a.name||'').split(' ')[0];
// Something real and near to reveal on a strong scripted success: a landmark the hero does not know, else a creature in sight.
function scriptedReveal(a){
  for(const l of [...LANDMARKS,CRYPT].filter(Boolean)){if(!l.name||knowsPlace(a,l.name))continue;const p=l.x!=null?l:l.door||l.gate||l.entry||null;if(p&&Number.isFinite(p.x)&&dist(a,p)<=20)return 'reveal:place:'+l.name}
  for(const m of nearMobs(a.x,a.y,10)){if(!m.alive||m.gone||m.hidden||!MOBS[m.type])continue;const n=MOBS[m.type].name;if(foeName(a,m)!==n)return 'reveal:creature:'+n}
  return null}
export function scriptedRuling(a,r){const skill=keywordSkill(r.what+' '+(r.how||'')),dc='fair',n=nm(a);
  return {skill,dc,effects:[],fail_effects:['none'],text:PASS[skill].replace(/\{n\}/g,n),fail_text:FAIL[skill].replace(/\{n\}/g,n),scripted:true}}

// ---- effects: parse and check ----
// An effect is a string "kind[:target[:value]]" (reveal:fact may hold more colons) or {kind, target, value}.
export function parseEffect(x){let k,t='',v='';
  if(x&&typeof x==='object'){k=lc(x.kind);t=clean(x.target,ATTEMPT.FACT_MAX);v=clean(x.value,ATTEMPT.FACT_MAX)}
  else{const s=clean(x,ATTEMPT.FACT_MAX+60);const i=s.indexOf(':');k=lc(i<0?s:s.slice(0,i));const rest=i<0?'':s.slice(i+1);
    if(k==='reveal'||k==='item'||k==='attitude'||k==='condition'){const j=rest.indexOf(':');t=(j<0?rest:rest.slice(0,j)).trim();v=(j<0?'':rest.slice(j+1)).trim()}else t=rest.trim()}
  k=k.replace(/\s+/g,'_');if(k==='talk')k='open_talk';if(k==='scene')k='open_scene';if(k==='give'||k==='take'){v=t;t=k;k='item'}
  return {k,t,v}}
const DIRS={north:[0,-1],south:[0,1],east:[1,0],west:[-1,0],northeast:[.71,-.71],northwest:[-.71,-.71],southeast:[.71,.71],southwest:[-.71,.71],
  n:[0,-1],s:[0,1],e:[1,0],w:[-1,0],ne:[.71,-.71],nw:[-.71,-.71],se:[.71,.71],sw:[-.71,.71],up:[0,-1],down:[0,1],ahead:null,forward:null};
const open_=(x,y)=>x>=0&&y>=0&&x<W&&y<H&&![WALL,RIVER,LAVA].includes(tileAt(x,y));
function moveSpot(a,to){const s=lc(to),m=/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(s);let x,y;
  if(m){x=+m[1];y=+m[2]}else{const w=s.split(' '),d=DIRS[w[0]];if(d===undefined)return {err:'move: to is a direction (north, south-east, ...) with tiles (up to '+ATTEMPT.MOVE_MAX+'), or "x,y" within '+ATTEMPT.MOVE_MAX+' tiles'};
    const v=d||(a.dest?[(a.dest.x-a.x)/(dist(a,a.dest)||1),(a.dest.y-a.y)/(dist(a,a.dest)||1)]:[0,-1]),n=Math.min(ATTEMPT.MOVE_MAX,Math.max(1,Number(w[1])||3));x=a.x+v[0]*n;y=a.y+v[1]*n}
  const D=Math.hypot(x-a.x,y-a.y);if(D>ATTEMPT.MOVE_MAX+.01)return {err:'move: at most '+ATTEMPT.MOVE_MAX+' tiles (that is '+Math.round(D)+')'};
  for(let f=1;f>0.05;f-=.1){const px=a.x+(x-a.x)*f,py=a.y+(y-a.y)*f;if(open_(px,py))return {x:px,y:py}}
  return {err:'move: no open ground that way'}}
const placeNames=()=>[...ZONES,...LANDMARKS.map(l=>l.name),CRYPT&&CRYPT.name,...(S.places||[]).filter(p=>p&&p.name&&!(p.until<S.gameMin)).map(p=>p.name)].filter(Boolean);
const creatureName=v=>{const s=lc(v);for(const k in MOBS){const M=MOBS[k];if(lc(M.name)===s||M.pl&&lc(M.pl)===s)return M.name}return null};
// Check one effect for hero a (sc: in a Table scene). Returns {k,t,v} normalised, or {err}.
export function checkEffect(a,x,sc){const e=parseEffect(x),{k}=e;
  if(!EFFECT_KINDS.includes(k)){const bad=FORBID.test(k+' '+e.t+' '+e.v);return {err:'"'+clean(typeof x==='string'?x:k,40)+'" is not in the bounded set ('+EFFECT_KINDS.join(', ')+')'+(bad?'; nothing touches level, XP, gold or life, and HP only as a small wound':''),forbidden:bad}}
  if(sc&&IN_SCENE_NO.includes(k))return {err:k+' is not allowed inside a Table scene (it keeps everyone in place)'};
  switch(k){
  case 'none':return e;
  case 'move':{const m=moveSpot(a,e.t||e.v);return m.err?{err:m.err}:{...e,x:m.x,y:m.y}}
  case 'reveal':{const t=lc(e.t);if(!REVEAL_KINDS.includes(t))return {err:'reveal: target is place, fact or creature (reveal:fact:<what they learn>)'};
    if(!e.v)return {err:'reveal: say what is revealed (reveal:'+t+':<name or fact>)'};
    if(t==='place'){const n=placeNames().find(p=>lc(p)===lc(e.v));return n?{...e,t,v:n}:{err:'reveal:place: no place called "'+clean(e.v,40)+'" (a region, landmark or a marked place)'}}
    if(t==='creature'){const n=creatureName(e.v);return n?{...e,t,v:n}:{err:'reveal:creature: no creature called "'+clean(e.v,40)+'" in the bestiary'}}
    return {...e,t,v:clean(e.v,ATTEMPT.FACT_MAX)}}
  case 'attitude':{const p=findPerson(a,e.t,7);if(!p||p.far)return {err:'attitude: no person called "'+clean(e.t,40)+'" within earshot (7 tiles) of '+a.name};
    const d=Math.round(Number(e.v));if(!Number.isFinite(d)||!d||Math.abs(d)>3)return {err:'attitude: delta is -3..3, not 0 (attitude:<person>:<delta>)'};return {...e,p,d}}
  case 'open_talk':{if(!inSlots(a)||!slotted())return {err:'open_talk: only the Fellowship holds conversations'};const p=findPerson(a,e.t,6);if(!p||p.far)return {err:'open_talk: no person called "'+clean(e.t,40)+'" within 6 tiles'};return {...e,p}}
  case 'open_scene':{const t=lc(e.t);return SCENE_KINDS.includes(t)?{...e,t}:{err:'open_scene: kind is one of '+SCENE_KINDS.join(', ')}}
  case 'item':{const t=lc(e.t);if(t!=='give'&&t!=='take')return {err:'item: give or take (item:give:<item>)'};if(!e.v)return {err:'item: name the item (item:'+t+':<item>)'};
    if(FORBID.test(e.v))return {err:'item: gold and the like are not handed out by a ruling',forbidden:true};return {...e,t}}
  case 'wound':{const n=Math.round(Number(e.t||e.v));if(!Number.isFinite(n)||n<1)return {err:'wound: a percentage of max HP, 1..'+ATTEMPT.WOUND_MAX+' (wound:10)'};
    if(n>ATTEMPT.WOUND_MAX)return {err:'wound: at most '+ATTEMPT.WOUND_MAX+'% of max HP (a ruling never kills or maims)',forbidden:true};return {...e,n}}
  case 'condition':{const t=lc(e.t);if(!CONDS[t])return {err:'condition: one of '+Object.keys(CONDS).join(', ')+' (condition:<id>:<minutes>)'};
    const m=Math.round(Number(e.v)||60);return {...e,t,m:Math.max(ATTEMPT.COND_GM[0],Math.min(ATTEMPT.COND_GM[1],m))}}
  case 'boon':{const t=lc(e.t||e.v||'d4');return BOONS[t]?{...e,t}:{err:'boon: d4, d6 or d8 (added to the hero\'s next attempt)'}}}
  return {err:'unknown effect'}}

// ---- applying one effect (success or failure) ----
// Returns a line for the hero in plain words, or null when nothing came of it.
function applyEffect(a,e,r){const by=r.by==='dm-agent'?'dm-agent':'scripted',why='ruling on '+a.name+'\'s attempt';
  switch(e.k){
  case 'none':return null;
  case 'move':{const m=moveSpot(a,e.t||e.v);if(m.err)return null;a.x=m.x;a.y=m.y;a.dest=null;a.moving=false;return 'You are now a few paces off ('+Math.round(m.x)+','+Math.round(m.y)+').'}
  case 'reveal':{if(e.t==='place'){learnPlace(a,e.v,'told');return 'You learn of '+e.v+'.'}
    if(e.t==='creature'){hearLore(a,'This is a '+e.v+'.');return 'You know it now: '+e.v+'.'}
    heroMemory(a,'remember',{title:clean('Learned: '+e.v,60),text:e.v,tags:['learned','attempt']});return 'You learn: '+e.v}
  case 'attitude':{const p=findPerson(a,e.t,7);if(!p||p.far)return null;warm(p,e.d,'ruling');return (p.title?p.title+' ':'')+p.name+(e.d>0?' warms to you.':' cools toward you.')}
  case 'open_talk':{const p=findPerson(a,e.t,6);if(!p||p.far||convWith(p))return null;const t=talkTo(a,p,'');if(!t||t.error)return null;return 'You have '+(p.title?p.title+' ':'')+p.name+'\'s ear.'}
  case 'open_scene':{const s=stageScene({kind:e.t,near:a.name,frame:clean(r.ru&&r.ru.text||r.what,400)||'Something stirs where '+a.name+' tried their hand.',
      reason:why,title:'After '+a.name+'\'s attempt',cast:e.t==='meeting'||e.t==='social'?{want:'to see what comes of '+a.name+'\'s doing'}:e.t==='mystery'?{reveal:clean(e.v||r.what,120)}:{}});
    return s&&s.ok!==false?'Something comes of it.':null}
  case 'item':{const res=pull(e.t==='give'?'give_item':'take_item',{hero:a.id,item:e.v},{by,reason:why});return res&&res.ok?(e.t==='give'?'You come away with '+((res.effect&&res.effect.item)||e.v)+'.':'You part with the '+e.v+'.'):null}
  case 'wound':{const mh=maxHp(a),floor=mh*ATTEMPT.FLOOR,cut=Math.min(mh*e.n/100,Math.max(0,a.hp-floor));if(cut<1)return null;a.hp-=cut;return 'It costs you: a small wound ('+Math.round(cut)+' HP).'}
  case 'condition':{if(effOn(a,'taken'))return null;setEff(a,'taken',CONDS[e.t].taken,e.m/6);return 'For a while you are '+CONDS[e.t].text+'.'}
  case 'boon':{a.boon={die:e.t,until:S.gameMin+ATTEMPT.BOON_GM};return 'Fortune leans your way: a '+e.t+' on your next attempt.'}}
  return null}

// ---- resolving: the d20, the effects, the words ----
function resolve(r){const a=hero(r.hero);if(!alive(a)){close(r,'lapsed');return null}
  const ru=r.ru,dcN=DC[ru.dc]||DC.fair,c=check(a,ru.skill,dcN,{nat:true});
  let boon=0;if(a.boon){if(S.gameMin<=a.boon.until&&BOONS[a.boon.die])boon=ri(1,BOONS[a.boon.die]);delete a.boon}
  const total=c.total+boon,pass=c.nat===20||(c.nat!==1&&total>=dcN);
  // a scripted ruling reveals something real on a strong success (the issue's "reveal on a 15+")
  let list=pass?ru.effects:ru.fail_effects;if(ru.scripted&&pass&&total>=15){const rv=scriptedReveal(a);if(rv)list=[rv]}
  const sc=r.scene!=null?sceneOf(a):null,done=[];
  for(const x of list||[]){const e=checkEffect(a,x,sc);if(e.err)continue;const line=applyEffect(a,e,r);if(line)done.push(line)}
  const text=clean(pass?ru.text:(ru.fail_text||FAIL[ru.skill]&&FAIL[ru.skill].replace(/\{n\}/g,nm(a))||'It does not come off.'),ATTEMPT.TEXT_MAX);
  const roll=(SKILLS[ru.skill]?SKILLS[ru.skill].name:ru.skill)+' d20 '+c.d20+(c.mod>=0?' +':' ')+c.mod+(boon?' + boon '+boon:'')+' = '+total+' vs '+ru.dc+' ('+dcN+')';
  r.res={pass,roll,text,effects:done,skill:ru.skill,d20:c.d20,total,dc:ru.dc};r.state='done';
  // the DM's words, heard by the hero and everyone in earshot (and the open table)
  const e={t:clockStr(),d:dayNo(),from:NARRATOR,text,trigger:'dm',dm:true,ruling:true};
  const hs=[a,...sayHearers(a)];for(const b of hs){(b.chat||(b.chat=[])).push(e);if(b.chat.length>60)b.chat.shift()}
  if(sc)sc.narr={t:e.t,text};
  notify(a,'The DM rules on your attempt ("'+clean(r.what,60)+'"): '+(pass?'success':'failure')+' ('+roll+'). '+text+(done.length?' '+done.join(' '):''),true,2);
  record(a,'Tried: ',clean(r.what,80)+' ('+(pass?'success':'failure')+')');
  {const L=a.playLog;if(a.player&&L){L.unshift({t:clockStr(),d:dayNo(),tool:'ruling',args:'call='+r.id,ok:true,text:clean((pass?'success':'failure')+' · '+roll+' · '+text,200)});if(L.length>30)L.pop()}} // the Agent tab
  dmlog('agent',null,['Ruling on ',a.name,'\'s attempt',r.by==='scripted'?' [scripted'+(r.why?' fill, '+r.why+(r.why==='slow'?', '+lateWhy(r.seen):''):'')+']':'',': "',clean(r.what,80),'" -> ',(pass?'success':'failure'),' (',roll,')',done.length?'; '+done.join(' '):''],
    {by:r.by,ruling:true,call:r.id,hero:a.id,skill:ru.skill,dc:ru.dc,pass,total,effects:list,...(ru.note?{note:ru.note}:{}),...(r.by==='scripted'?{fill:true,why:r.why||'gone',...(r.why==='slow'?{late:lateWhy(r.seen)}:{})}:{})},{heroes:[]});
  close(r,'done');return r.res}
function close(r,how){const R=rulingState(),i=R.cur.indexOf(r);if(i>=0)R.cur.splice(i,1);r.end=how;
  R.past.unshift({id:r.id,hero:r.hero,name:r.name,what:r.what,t:r.t,day:r.day,by:r.by||null,end:how,...(r.res?{pass:r.res.pass,roll:r.res.roll,skill:r.res.skill}:{})});if(R.past.length>ATTEMPT.PAST)R.past.pop()}
const heroView=r=>r.res?{outcome:r.res.pass?'success':'failure',roll:r.res.roll,ruling:r.res.text,...(r.res.effects.length?{changed:r.res.effects}:{})}:{outcome:'lapsed'};

// ---- the DM's side: ruling_call / ruling_answer ----
const band=l=>l<=4?'a green blade (levels 1-4)':l<=9?'seasoned (levels 5-9)':l<=14?'a veteran (levels 10-14)':'one of the realm\'s best (15+)';
const health=a=>{const f=a.hp/maxHp(a);return f>=.9?'unhurt':f>=.5?'hurt':f>=.25?'badly hurt':'close to falling'};
function sight(a){ensureNpcs();const R=12;
  const creatures=[...new Set(nearMobs(a.x,a.y,R).filter(m=>m.alive&&!m.gone&&!m.hidden&&MOBS[m.type]&&dist(a,m)<=R).map(m=>MOBS[m.type].name))].slice(0,8);
  const heroes=nearHeroes(a.x,a.y,R).filter(b=>b!==a&&alive(b)&&!b.hidden&&dist(a,b)<=R).map(b=>b.name).slice(0,8);
  const people=[...(S.npcs||[]),...(S.wanderers||[])].filter(p=>Number.isFinite(p.x)&&dist(a,p)<=R).sort((x,y)=>dist(a,x)-dist(a,y)).slice(0,8)
    .map(p=>({name:(p.title?p.title+' ':'')+p.name,role:p.role||null,tiles:Math.round(dist(a,p)),...(p.mood?{mood:p.mood}:{})}));
  const places=[...LANDMARKS,CRYPT,...(S.places||[])].filter(Boolean).filter(l=>{const p=l.x!=null?l:l.door||l.gate||l.entry;return l.name&&p&&Number.isFinite(p.x)&&dist(a,p)<=20}).map(l=>l.name).slice(0,6);
  return {creatures,heroes,people,places}}
function callView(r){const a=hero(r.hero);if(!a)return null;const sc=r.scene!=null?sceneOf(a):null;
  const skills=SKILL_IDS.map(k=>({k,m:skillMod(a,k),t:trained(a,k)})).sort((x,y)=>y.m-x.m).slice(0,5).map(s=>SKILLS[s.k].name+' '+(s.m>=0?'+':'')+s.m+(s.t?' (trained)':''));
  const gear=a.slots?Object.values(a.slots).filter(Boolean).map(g=>g.name).slice(0,7):[];
  const quest=(a.inv&&a.inv.list||[]).filter(x=>x.kind==='quest').map(x=>x.id).slice(0,6);
  const z=ZONES[zoneAt(a.x,a.y)]||null;
  return {call:r.id,seconds_left:Math.max(0,Math.round((due(r)-Date.now())/100)/10),
    hero:{name:a.name,cls:a.cls,level:band(a.lvl||1),health:health(a),best_skills:skills,gear,quest_items:quest,...(a.boon?{boon:a.boon.die}:{})},
    attempt:{what:r.what,...(r.how?{how:r.how}:{}),...(r.at?{at:r.at}:{})},
    where:{region:z,town:a.state==='town'&&a.town!=null?String(a.town):null,x:Math.round(a.x),y:Math.round(a.y),...(sc?{table_scene:sc.title}:{})},
    in_sight:sight(a),
    legal:{skills:SKILL_IDS,dc:DC,effects:sc?EFFECT_KINDS.filter(k=>!IN_SCENE_NO.includes(k)):EFFECT_KINDS,effect_forms:EFFECT_FORMS,scene_kinds:SCENE_KINDS,conditions:Object.keys(CONDS),boons:Object.keys(BOONS)},
    rules:RULES}}
export const EFFECT_FORMS=['none','move:<north|south-east|...> [tiles] or move:<x,y> (up to '+ATTEMPT.MOVE_MAX+' tiles; not in a Table scene)','reveal:place:<a region, landmark or marked place>',
  'reveal:creature:<a bestiary creature>','reveal:fact:<what they learn, up to '+ATTEMPT.FACT_MAX+' characters>','attitude:<person in earshot>:<-3..3>','open_talk:<person within 6 tiles> (the Fellowship)',
  'open_scene:<mystery|meeting|social|ambush|trap>','item:give:<quest item, consumable or gear slot>','item:take:<quest item or token>','wound:<1..'+ATTEMPT.WOUND_MAX+'> (% of max HP; never below '+(ATTEMPT.FLOOR*100)+'% HP)',
  'condition:<warded|exposed>:<minutes>','boon:<d4|d6|d8> (on the hero\'s next attempt)'];
export const RULES='Rule on what the hero tries: pick the skill it tests and how hard it is (easy 8, fair 12, hard 15, heroic 18); the game rolls d20 + the hero\'s skill (a 20 always succeeds, a 1 always fails). '+
  'effects follow a success, fail_effects a failure: at most '+ATTEMPT.EFFECTS_MAX+' each, only from the forms listed. Nothing touches level, XP, gold or life. text is what the heroes hear on a success, fail_text on a failure (as much as the moment needs; never decide what a hero thinks or chooses). note is for your DM log only. Most attempts deserve none or one small effect; reward a clever idea with a reveal or an attitude, punish a reckless one with a small wound or exposed.';

export function rulingCall(args={}){rulingHeard(args&&args.budget_s);const R=S.rulings;const r=R&&R.cur.find(x=>x.state==='wait');
  if(r&&r.seen==null&&r.real)r.seen=Date.now(); // the budget starts at pickup (#680)
  if(!r)return {ok:true,call:null,waiting:0,note:'No attempt waits for your ruling.'};
  return {ok:true,call:callView(r),waiting:R.cur.filter(x=>x.state==='wait').length}}
function refuse(why,r,forbidden){const R=rulingState(),d=today();R.stats.refused++;d.refused++;
  dmlog('agent',null,['Ruling refused',r?' (call '+r.id+')':'',': ',why],{by:'dm-agent',ruling:true,refused:why,...(forbidden?{forbidden:true}:{}),...(r?{call:r.id}:{})},{heroes:[]});
  return {ok:false,error:why,hint:'Answer with ruling_answer {call, skill, dc (easy|fair|hard|heroic), effects:[...], fail_effects:[...], text, fail_text}; effect forms: '+EFFECT_FORMS.join('; ')}}
const asList=v=>Array.isArray(v)?v:typeof v==='string'?(v.trim()?(v.trim().startsWith('[')?(()=>{try{return JSON.parse(v)}catch(e){return [v]}})():v.split(/\s*;\s*|\s*\|\s*/)):[]):v&&typeof v==='object'?[v]:[];
export function rulingAnswer(args={}){const R=S.rulings,id=Math.round(Number(args.call));const r=R&&R.cur.find(x=>x.id===id);
  if(!r){const p=R&&R.past.find(x=>x.id===id);return {ok:false,error:p?'Call '+id+' was already ruled'+(p.by==='scripted'?' (the scripted DM filled it while you were silent)':'')+'.':'No ruling call '+(Number.isFinite(id)?id:'')+' is waiting (ruling_call shows the one that is).'}}
  if(r.state!=='wait')return {ok:false,error:'Call '+id+' was already ruled'+(r.by==='scripted'?' (the scripted DM filled it while you were silent)':'')+'.'};
  const a=hero(r.hero);if(!alive(a)){close(r,'lapsed');return {ok:false,error:'The hero is gone; the attempt lapses.'}}
  let skill=lc(args.skill).replace(/ /g,'');skill=SKILL_ALIAS[skill]||skill;if(!SKILLS[skill])return refuse('skill must be one of '+SKILL_IDS.join(', '),r);
  const dc=lc(args.dc);if(!DC[dc])return refuse('dc must be one of easy, fair, hard, heroic',r);
  const text=clean(args.text,ATTEMPT.TEXT_MAX);if(text.length<4)return refuse('text (what the heroes hear on a success) is missing',r);
  const sc=r.scene!=null?sceneOf(a):null,E=asList(args.effects),F=asList(args.fail_effects);
  if(E.length>ATTEMPT.EFFECTS_MAX||F.length>ATTEMPT.EFFECTS_MAX)return refuse('at most '+ATTEMPT.EFFECTS_MAX+' effects on each side',r);
  const errs=[];let forb=false;for(const x of [...E,...F]){const e=checkEffect(a,x,sc);if(e.err){errs.push(e.err);if(e.forbidden)forb=true}}
  if(errs.length)return refuse(errs.join('; '),r,forb);
  rule(r,{skill,dc,effects:E,fail_effects:F,text,fail_text:clean(args.fail_text,ATTEMPT.TEXT_MAX),note:clean(args.note,ATTEMPT.NOTE_MAX)},'dm-agent');
  if(r.scene==null){const res=resolve(r);return {ok:true,call:id,ruled:true,...(res?{outcome:res.pass?'success':'failure',roll:res.roll,said:res.text,changed:res.effects}:{lapsed:true})}}
  return {ok:true,call:id,ruled:true,note:'It plays out on '+a.name+'\'s turn at the table.'}}
// dm_status: what waits and today's count.
export function rulingSummary(){const R=S.rulings;if(!R)return {waiting:0,today:{asked:0,by_you:0,scripted:0,refused:0}};const d=today();
  return {waiting:R.cur.filter(x=>x.state==='wait').length,today:{asked:d.asked,by_you:d.dm,scripted:d.scripted,refused:d.refused},
    ...(R.cur.some(x=>x.state==='wait')?{note:'A hero tries something and waits for your ruling: ruling_call, then ruling_answer at once (a few seconds, then the scripted DM rules).'}:{})}}
export const rulingsView=()=>S.rulings?{cur:S.rulings.cur.map(r=>({id:r.id,name:r.name,what:r.what,state:r.state})),past:S.rulings.past.slice(0,ATTEMPT.LOG),stats:{...S.rulings.stats}}:null;

// ---- Table mode: attempt as a member's act (registered with sim/table.js) ----
setAttemptHooks({
  label:'Try something of your own: put what you try in line (one or two sentences); the DM rules on it',
  start(sc,a,line){if(!clean(line,10))return 'Say what you try in line: scene_act {option: "attempt", line: "one or two sentences"}.';const w=wordsRefusal(clean(line,1e4),'');if(w)return w;const h=heroRefusal(a);if(h)return h;
    rate(a).push(S.gameMin);return open(a,clean(line,ATTEMPT.WHAT_MAX),'','',sc).id},
  // true while the DM is still weighing it (the table waits, bounded); instant (3x/8x, a scene not pausing) fills at once
  hold(sc,act,instant){const R=S.rulings,r=R&&R.cur.find(x=>x.id===act.rid);if(!r||r.state!=='wait')return false;
    const g=goneNow()||!(S.dmAgent&&S.dmAgent.seat);if(instant||g||Date.now()>=due(r)){fill(r,instant||g?'gone':'slow');return false}return true},
  apply(sc,a,act){const R=S.rulings,r=R&&R.cur.find(x=>x.id===act.rid);if(!r)return 'nothing came of it';if(r.state==='wait')fill(r,'slow');
    const res=resolve(r);return res?(res.pass?'success':'failure')+', '+res.roll+(res.effects.length?'; '+res.effects.join(' '):''):'nothing came of it'}});
