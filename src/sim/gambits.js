// Gambits (issue #617): an agent hero's own ordered rules, "if <condition> then <action>", which its autopilot and its
// reflexes run between the agent's turns. The vocabulary and the class presets are data (data/gambits.js); the presets
// are today's hard-coded policy written out rule for rule, so a hero whose list was never edited plays exactly as before.
// Scripted heroes never come here (sim/player.js only calls this for a.player heroes).
//
// The engine knows the order and the phases; what each condition and action does lives where its helpers are:
// conditions that read only the world are here, the rest and every action are given by sim/player.js (defineGambits),
// so this module imports nothing of player.js. No RNG: conditions only read, and the actions are the code paths the
// hard-coded policy took.
//   idlePick(a, ctx)    autopilot: the first rule that holds and can run; returns a command (or list), or null
//   fightRules(a, ctx)  every moment of a fight: each fight rule that holds acts in turn; flee/retreat/hold end it
//   reflexPick(a, ctx)  idle in the field with no order: only sell_loot rules (the full-pack reflex)
import {GAMBIT,CONDS,ACTS,PRESETS,PRESET_IDLE,PRESET_FIGHT,PRESET_HEAL,PRESET_GUARD,TANK_CLASSES} from '../data/gambits.js';
import {CLS} from '../data/classes.js';
import {S} from './state.js';
import {zoneAt,dist,REGIONS} from '../world/map.js';
import {weatherKind,isStorm} from './weather.js';
import {companyOf,inSlots} from './company.js';
import {openProps,leaderFor} from './council.js';
import {feared} from './lore.js';
import {nearMobs} from './spatial.js';
import {maxHp} from './heroes.js';
import {tm} from '../data/traits.js';

// a hoisted holder: sim/player.js may register before this module has run (an import cycle through company.js)
function impl(){return impl.v||(impl.v={c:{},a:{}})}
// sim/player.js hands over the conditions that need its helpers and every action: {conds:{name:fn}, acts:{name:fn}}.
// A condition fn(a, args, ctx) returns falsy, true, or the hero it names (the target of heal/guard). An action fn(a, args,
// ctx) returns null when it cannot run here (the next rule is tried); between turns a command (or a list) or HOLD; in a
// fight true when it acted, 'end' when it acted and ends the moment.
export function defineGambits({conds={},acts={}}){Object.assign(impl().c,conds);Object.assign(impl().a,acts)}
export const HOLD={hold:true};

// ---- presets ----
const PRE={};
const clone=r=>JSON.parse(JSON.stringify(r));
// The class preset: fight rules (a healer's heal first, a tank's guard suggestion, off), then the between-turns rules.
export function presetFor(cls,name='class'){const k=cls+'|'+name;if(PRE[k])return PRE[k];
  let L=[...(CLS[cls]&&CLS[cls].heal?[PRESET_HEAL]:[]),...(TANK_CLASSES.includes(cls)?[PRESET_GUARD]:[]),...PRESET_FIGHT,...PRESET_IDLE];
  if(name==='cautious')L=L.flatMap(r=>r.when==='past_flee_mark'?[{when:'foe_is',w:{what:'elite'},and:'attacked',then:'hold'},{when:'self_hp_below',w:{pct:35},then:'flee_home'},r]:[r]);
  if(name==='empty')L=[];
  const out=L.map((r,i)=>Object.freeze({id:i+1,...clone(r),on:r.on!==false}));
  return PRE[k]=Object.freeze(out)}
// The hero's rules: its own list once it edited one, else its class preset (shared and frozen; never stored on the hero).
export const rulesOf=a=>a.gambits||presetFor(a.cls);
export const edited=a=>!!a.gambits;

// ---- runtime record (not saved: non-enumerable, like the action log) ----
function rec(a){let g=a._gb;if(!g){g={last:null,n:0,log:[],at:{},once:{}};Object.defineProperty(a,'_gb',{value:g,enumerable:false,writable:true,configurable:true})}return g}
// the command (or list) a rule gave, so a reader can tell whether the hero still carries it out
export const firedFor=(a,cmd)=>{const g=a&&a._gb,o=g&&g.last&&g.last.out;return !!(cmd&&o&&(o===cmd||Array.isArray(o)&&o.includes(cmd)))};
export const gambitRec=(a,make)=>a?(make?rec(a):a._gb||null):null;
// One fire: the last rule that acted (the Agent tab highlights it), a short log of changes, a count of rule-driven acts.
function fired(a,r,phase,out){const g=rec(a),same=g.last&&g.last.id===r.id&&S.gameMin-g.last.at<30;
  g.last={id:r.id,when:r.when,and:r.and||null,then:r.then,at:S.gameMin,phase,out:out&&typeof out==='object'?out:null};g.at[r.id]=S.gameMin;
  if(!same){g.n++;g.log.push({id:r.id,text:ruleText(r),at:Math.round(S.gameMin),phase});if(g.log.length>GAMBIT.LOG)g.log.shift()}}

// ---- conditions that read only the world ----
const pctOf=(x,p)=>x.hp<maxHp(x)*(p/100);
const leaderNear=a=>{const L=leaderFor(a)||(a.party&&a.party.leader!==a?a.party.leader:null);return L&&L!==a&&L.state!=='dead'&&!L.hidden?L:null};
const mates=a=>{const C=companyOf(a),ids=C?C.ids:[];const L=[];for(const id of ids){if(id===a.id)continue;const b=S.agents.find(x=>x.id===id);if(b)L.push(b)}
  if(a.party)for(const b of a.party.mem)if(b!==a&&!L.includes(b))L.push(b);return L};
const SEE=12;
const BASE={
  always:()=>true,
  self_hp_below:(a,w)=>a.hp<maxHp(a)*(num(w.pct,1,99,50)/100)*(w.scale==='retreat'||w.scale==='flee'?tm(a,w.scale):1),
  ally_hp_below:(a,w)=>{const p=num(w.pct,1,99,50),who=String(w.who||'').toLowerCase();let low=null;
    for(const b of mates(a)){if(b.state==='dead'||b.state==='ghost'||b.hidden||dist(a,b)>SEE)continue;if(who&&b.name.toLowerCase().split(' ')[0]!==who.split(' ')[0])continue;
      if(pctOf(b,p)&&(!low||b.hp/maxHp(b)<low.hp/maxHp(low)))low=b}return low},
  leader_hp_below:(a,w)=>{const L=leaderNear(a);return L&&dist(a,L)<=SEE&&pctOf(L,num(w.pct,1,99,50))?L:null},
  foe_is:(a,w,ctx)=>{const m=ctx&&ctx.m||(a.state==='fight'?a.target:null);if(!m||m.kind!=='mob')return false;const k=w.what;
    return k==='elite'?!!m.elite:k==='named'?!!m.named:k==='above_my_level'?m.lvl>a.lvl:k==='known_dangerous'?!!feared(a,m):false},
  foes_more_than:(a,w)=>{const n=num(w.n,1,9,1);let k=0;for(const m of nearMobs(a.x,a.y,8))if(m.alive&&!m.gone&&m.target===a)k++;return k>n},
  in_fight:a=>a.state==='fight',
  attacked:(a,w,ctx)=>{const m=ctx&&ctx.m;if(m&&m.target===a)return true;for(const x of nearMobs(a.x,a.y,6))if(x.alive&&!x.gone&&x.target===a)return true;return false},
  in_town:a=>a.state==='town',
  at_camp:a=>{const C=companyOf(a),g=C&&C.camp;return !!(g&&g.phase&&g.ids&&g.ids.includes(a.id))},
  night:()=>{const h=(S.gameMin/60)%24;return h<5||h>=21},
  storm_or_fog:a=>{const z=zoneAt(a.x,a.y);return isStorm(z)||weatherKind(z)==='fog'},
  storm:a=>isStorm(zoneAt(a.x,a.y)),
  apart_from_leader:(a,w)=>{const L=leaderNear(a);return !!L&&dist(a,L)>num(w.tiles,2,40,12)},
  leader_moving:a=>{const L=leaderNear(a);return !!(L&&L.moving)},
  level_below_region:a=>{const R=REGIONS[zoneAt(a.x,a.y)],b=R&&R.band;return !!(b&&b[0]>a.lvl)},
  gold_above:(a,w)=>(a.gold||0)>num(w.n,0,1e6,100),
  vote_open:a=>inSlots(a)&&openProps().length>0,
};
const num=(v,lo,hi,d)=>{const n=Math.round(Number(v));return Number.isFinite(n)?Math.min(hi,Math.max(lo,n)):d};
function cond(a,name,w,ctx){const f=impl().c[name]||BASE[name];return f?f(a,w||{},ctx):false}
// Both conditions of a rule; the hero either one names is the target (the first one's when both do).
function holds(a,r,ctx){const c1=cond(a,r.when,r.w,ctx);if(!c1)return null;if(!r.and)return c1;const c2=cond(a,r.and,r.w2,ctx);if(!c2)return null;return c1!==true?c1:c2}

// ---- the three phases ----
export function idlePick(a,ctx){const L=rulesOf(a);
  for(let i=0;i<L.length;i++){const r=L[i];if(r.on===false)continue;const A=ACTS[r.then];if(!A||A.phase==='fight')continue;
    const hit=holds(a,r,ctx);if(!hit)continue;const f=impl().a[r.then];if(!f)continue;ctx.hit=hit;ctx.rule=r;
    const out=f(a,r.t||{},ctx);if(out==null)continue;fired(a,r,'idle',out);return out===HOLD?null:out}
  return null}
export function fightRules(a,ctx){const L=rulesOf(a);
  for(let i=0;i<L.length;i++){const r=L[i];if(r.on===false)continue;const A=ACTS[r.then];if(!A||A.phase==='idle')continue;
    const hit=holds(a,r,ctx);if(!hit)continue;const f=impl().a[r.then];if(!f)continue;ctx.hit=hit;ctx.rule=r;
    const out=f(a,r.t||{},ctx);if(!out)continue;fired(a,r,'fight');if(out==='end'||out===HOLD)return}}
export function reflexPick(a,ctx){const L=rulesOf(a);
  for(let i=0;i<L.length;i++){const r=L[i];if(r.on===false||r.then!=='sell_loot')continue;const hit=holds(a,r,ctx);if(!hit)continue;
    const f=impl().a.sell_loot;ctx.hit=hit;ctx.rule=r;ctx.reflex=true;const out=f&&f(a,r.t||{},ctx);if(out==null)continue;fired(a,r,'reflex',out);return out===HOLD?null:out}
  return null}

// ---- words ----
const argText=o=>{const k=o?Object.keys(o):[];return k.length?' {'+k.map(x=>x+': '+o[x]).join(', ')+'}':''};
export const condText=(c,w)=>c+argText(w);
export const ruleText=r=>condText(r.when,r.w)+(r.and?' and '+condText(r.and,r.w2):'')+' -> '+r.then+argText(r.t);
// ---- editing (the tools: gambits, set_gambit, move_gambit, toggle_gambit, drop_gambit, reset_gambits) ----
// A rule is written as words: when "self_hp_below 30" (the condition, then its arguments in order or as key=value),
// optional and "in_town", then "buy_potions 3". The first edit copies the class preset onto the hero (a.gambits); from then
// on the list is the hero's own. GAMBIT.PER_DAY edits a game day. An edit that changes a safety rule (flee, potion, defend:
// ACTS[..].safety) is the agent's call, never refused: it is logged in the hero's edit history and its persona history and
// counted (S.gambitStats), and a list with no flee rule left is marked in the view (no_flee_rule).
const ARGS_OF=(T,name)=>Object.keys((T[name]&&T[name].args)||{});
const ENUMS={scale:['retreat','flee'],what:['elite','named','above_my_level','known_dangerous'],to:['leader','camp','town'],target:['self','leader','weakest_ally','foe'],inn:['yes','no']};
const NUMS=new Set(['pct','n','tiles','minutes','hours']);
// "self_hp_below 30 retreat" -> {name, args} or {error}; T is CONDS or ACTS
export function parseWords(T,s,kind){const raw=String(s==null?'':s).trim();if(!raw)return {error:'No '+kind+' given.'};
  // the name may be written with spaces ("ally hp below 40"): the longest run of words that names one is taken
  const words=raw.split(/\s+/);let name='',m=null;for(let k=Math.min(5,words.length);k>=1;k--){const n=words.slice(0,k).join('_').toLowerCase();if(T[n]){name=n;m=[null,n,words.slice(k).join(' ')];break}}
  if(!name){const x=/^([a-z_]+)\s*(.*)$/i.exec(raw);name=x?x[1].toLowerCase():''}
  if(!T[name])return {error:'"'+raw.slice(0,40)+'" is not a '+kind+'. '+(kind==='condition'?'Conditions':'Actions')+': '+Object.keys(T).join(', ')+'.'};
  const keys=ARGS_OF(T,name),out={};let rest=(m[2]||'').trim();
  if(name==='shout'){const t=rest.replace(/^text\s*=\s*/i,'').replace(/^["']|["']$/g,'').trim();if(!t)return {error:'shout needs its line: then "shout Fall back to me!".'};out.text=t.slice(0,120);return {name,args:out}}
  const toks=rest?rest.replace(/[{},]/g,' ').split(/\s+/).filter(Boolean):[];let pos=0;
  for(const tok of toks){const kv=/^([a-z_]+)\s*[=:]\s*(.+)$/i.exec(tok);let k,v;if(kv){k=kv[1].toLowerCase();v=kv[2]}else{k=keys[pos++];v=tok}
    if(!k||!keys.includes(k))return {error:name+' takes '+(keys.length?keys.join(', '):'no arguments')+'; "'+tok+'" is not one of them. '+describe(T,name)};
    v=String(v).replace(/^["']|["']$/g,'');
    if(NUMS.has(k)){const n=Math.round(Number(v));if(!Number.isFinite(n))return {error:name+': '+k+' must be a number.'};out[k]=n}
    else if(ENUMS[k]&&!ENUMS[k].includes(v.toLowerCase())&&!(k==='target'&&name!=='use_ability'))return {error:name+': '+k+' is one of '+ENUMS[k].join(', ')+'.'};
    else out[k]=ENUMS[k]?v.toLowerCase():v.slice(0,40)}
  if(name==='self_hp_below'||name==='ally_hp_below'||name==='leader_hp_below'){if(out.pct==null)return {error:name+' needs a share: "'+name+' 30" (1-99).'};out.pct=Math.min(99,Math.max(1,out.pct))}
  if(name==='foe_is'&&!out.what)return {error:'foe_is needs what: '+ENUMS.what.join(', ')+'.'};
  if((name==='foes_more_than'||name==='gold_above'||name==='potions_below')&&out.n==null)return {error:name+' needs n: "'+name+' 2".'};
  if(name==='apart_from_leader'&&out.tiles==null)return {error:'apart_from_leader needs tiles: "apart_from_leader 15".'};
  if(name==='use_ability'&&!out.id)return {error:'use_ability needs an ability id (status.abilities): then "use_ability <id> self".'};
  if(name==='retreat_to'&&!out.to)out.to='town';
  return {name,args:Object.keys(out).length?out:null}}
const describe=(T,name)=>{const d=T[name];if(!d)return '';const k=d.args?Object.keys(d.args):[];return name+(k.length?' '+k.map(x=>'<'+x+'>').join(' '):'')+': '+d.desc+(k.length?' ('+k.map(x=>x+': '+d.args[x]).join('; ')+')':'')};
export const vocabulary=()=>({conditions:Object.keys(CONDS).map(n=>describe(CONDS,n)),actions:Object.keys(ACTS).map(n=>describe(ACTS,n)+' ['+(ACTS[n].phase==='fight'?'in a fight':ACTS[n].phase==='idle'?'between turns':'both')+']')});

const today=()=>Math.floor(S.gameMin/1440)+1;
function budget(a){const d=today();if(!a.gambitDay||a.gambitDay.d!==d)a.gambitDay={d,n:0};return a.gambitDay}
const own=a=>{if(!a.gambits)a.gambits=rulesOf(a).map(r=>clone(r));return a.gambits};
const nextId=L=>L.reduce((m,r)=>Math.max(m,r.id||0),0)+1;
const safetyKinds=L=>{const o={};for(const r of L)if(r.on!==false&&ACTS[r.then]&&ACTS[r.then].safety){const k=ACTS[r.then].safety;(o[k]=o[k]||[]).push(ruleText(r))}return o};
const sig=L=>{const o=safetyKinds(L);return Object.keys(o).sort().map(k=>k+':'+o[k].join('|')).join(' / ')};
export const noFlee=a=>!rulesOf(a).some(r=>r.on!==false&&ACTS[r.then]&&ACTS[r.then].safety==='flee');
const stats=()=>S.gambitStats||(S.gambitStats={edits:0,safety:0,resets:0,refused:0});
// persona history hook (sim/player.js sets it to keep this module free of persona.js); hoisted, as sim/player.js runs first
export function onSafetyChange(f){impl().safety=f}
function err(a,msg){stats().refused++;return {ok:false,error:msg}}
// Run one edit: check the budget, apply fn to the hero's own list, record it. fn returns {text} or {error}.
function edit(a,kind,why,fn){const B=budget(a);if(B.n>=GAMBIT.PER_DAY)return err(a,'You have changed your rules '+GAMBIT.PER_DAY+' times today; they stand until tomorrow.');
  const before=a.gambits?a.gambits.map(r=>({...r})):null,L0=rulesOf(a),s0=sig(L0),flee0=!noFlee(a);
  const L=own(a);const r=fn(L);if(r.error){if(!before)a.gambits=null;else a.gambits=before;return err(a,r.error)}
  B.n++;stats().edits++;a.gambitEdits=(a.gambitEdits||0)+1;const s1=sig(L),safety=s0!==s1,fleeGone=flee0&&noFlee(a),w=String(why||'').replace(/\s+/g,' ').trim().slice(0,160);
  const h={d:today(),gm:Math.round(S.gameMin),kind,text:r.text,...(w?{why:w}:{}),...(safety?{safety:true}:{})};
  const H=a.gambitHist||(a.gambitHist=[]);H.push(h);while(H.length>GAMBIT.HIST)H.shift();
  if(safety){stats().safety++;if(impl().safety)impl().safety(a,s0||'(no safety rules)',s1||'(no safety rules)',(fleeGone?'stopped fleeing: ':'')+(w||'no reason given'))}
  const out={ok:true,done:r.text,edits_left_today:GAMBIT.PER_DAY-B.n,rules:rulesOf(a).map((x,i)=>(i+1)+'. #'+x.id+' '+ruleText(x)+(x.on===false?' (off)':''))};
  if(safety)out.note='You changed a safety rule (flee, potion or defend). It is your call; it is noted.'+(noFlee(a)?' You now have no rule that breaks you off a losing fight: one life.':'');
  return out}
const findRule=(L,id)=>{const n=Math.round(Number(String(id==null?'':id).replace(/^#/,'')));return Number.isFinite(n)?L.find(r=>r.id===n)||null:null};
const ids=L=>'Your rule ids: '+L.map(r=>r.id).join(', ')+' (gambits lists them).';

function viewList(a){const L=rulesOf(a),g=gambitRec(a),last=g&&g.last;
  return L.map((r,i)=>({id:r.id,order:i+1,rule:ruleText(r),on:r.on!==false,phase:ACTS[r.then]?ACTS[r.then].phase:'?',...(ACTS[r.then]&&ACTS[r.then].safety?{safety:ACTS[r.then].safety}:{}),
    ...(g&&g.at[r.id]!=null?{last_fired:Math.round(S.gameMin-g.at[r.id])+' game min ago'}:{}),...(last&&last.id===r.id?{fired_last:true}:{}),...(S.gambitHold&&S.gambitHold.id===a.id&&S.gambitHold.rid===r.id?{holding:true}:{})}))}
export function gambitsView(a,{vocab}={}){const g=gambitRec(a),last=g&&g.last,L=rulesOf(a),B=budget(a);
  const r={ok:true,source:a.gambits?'your own list':'your class preset (untouched: it is how you have always played)',rules:viewList(a),
    how:'In a fight every fight rule that holds acts in turn, top to bottom (flee or retreat ends the moment). Between your turns (autopilot) the first rule that holds and can run acts; one that cannot run here falls through.',
    edits_left_today:GAMBIT.PER_DAY-B.n,max_rules:GAMBIT.MAX};
  if(last){const x=L.find(y=>y.id===last.id);r.last_fired={id:last.id,rule:x?ruleText(x):last.when+' -> '+last.then,ago:Math.round(S.gameMin-last.at)+' game min'}}
  const hv=S.gambitHold&&S.gambitHold.id===a.id?S.gambitHold:null;if(hv)r.holding={rule:hv.rule,rule_id:hv.rid,seconds:Math.round(hv.s),note:'The world is held for you until your next acting call (or '+GAMBIT.HOLD_MAX_S+' s).'};
  if(noFlee(a))r.no_flee_rule='No rule breaks you off a losing fight (flee_home or retreat_to). Hardcore: one life.';
  if(vocab||!a.gambits)Object.assign(r,vocabulary());
  return r}
export function setGambit(a,{id,when,and,then,before,on,why}={}){
  const c=parseWords(CONDS,when,'condition');if(c.error)return err(a,c.error+' set_gambit {when: "self_hp_below 30", then: "flee_home"}');
  let c2=null;if(and!=null&&String(and).trim()!==''&&!/^(none|no)$/i.test(String(and).trim())){c2=parseWords(CONDS,and,'condition');if(c2.error)return err(a,'and: '+c2.error)}
  const t=parseWords(ACTS,then,'action');if(t.error)return err(a,t.error);
  return edit(a,'set',why,L=>{const rule={when:c.name,...(c.args?{w:c.args}:{}),...(c2?{and:c2.name,...(c2.args?{w2:c2.args}:{})}:{}),then:t.name,...(t.args?{t:t.args}:{}),on:!/^(no|off|false)$/i.test(String(on==null?'yes':on))};
    if(id!=null&&String(id).trim()!==''){const old=findRule(L,id);if(!old)return {error:'No rule '+id+'. '+ids(L)};const i=L.indexOf(old);L[i]={id:old.id,...rule};
      if(before!=null&&String(before).trim()!==''){const b=findRule(L,before);if(!b)return {error:'No rule '+before+' to put it before. '+ids(L)};L.splice(L.indexOf(L[i]),1);L.splice(L.indexOf(b),0,{id:old.id,...rule})}
      return {text:'rule '+old.id+' is now '+ruleText(L.find(x=>x.id===old.id))}}
    if(L.length>=GAMBIT.MAX)return {error:'You keep at most '+GAMBIT.MAX+' rules; drop_gambit one first. '+ids(L)};
    const nr={id:nextId(L),...rule};
    if(before!=null&&String(before).trim()!==''){const b=findRule(L,before);if(!b)return {error:'No rule '+before+' to put it before. '+ids(L)};L.splice(L.indexOf(b),0,nr)}else L.push(nr);
    return {text:'added rule '+nr.id+' at place '+(L.indexOf(nr)+1)+': '+ruleText(nr)}})}
export function moveGambit(a,{id,before,after,why}={}){return edit(a,'move',why,L=>{const r=findRule(L,id);if(!r)return {error:'No rule '+id+'. '+ids(L)};
  const bv=before!=null&&String(before).trim()!=='',av=after!=null&&String(after).trim()!=='';if(bv===av)return {error:'Say where: before or after (a rule id, or "top" / "bottom").'};
  const v=String(bv?before:after).trim().toLowerCase();L.splice(L.indexOf(r),1);
  if(v==='top'||v==='first')L.unshift(r);else if(v==='bottom'||v==='last')L.push(r);
  else{const o=findRule(L,v);if(!o){L.splice(0,0);return {error:'No rule '+v+'. '+ids(L)}}L.splice(L.indexOf(o)+(av?1:0),0,r)}
  return {text:'rule '+r.id+' moved to place '+(L.indexOf(r)+1)+': '+ruleText(r)}})}
export function toggleGambit(a,{id,on,why}={}){return edit(a,'toggle',why,L=>{const r=findRule(L,id);if(!r)return {error:'No rule '+id+'. '+ids(L)};
  const v=on==null||String(on).trim()===''?r.on===false:!/^(no|off|false|0)$/i.test(String(on));if((r.on!==false)===v)return {error:'Rule '+r.id+' is already '+(v?'on':'off')+'.'};
  r.on=v;return {text:'rule '+r.id+' '+(v?'on':'off')+': '+ruleText(r)}})}
export function dropGambit(a,{id,why}={}){return edit(a,'drop',why,L=>{const r=findRule(L,id);if(!r)return {error:'No rule '+id+'. '+ids(L)};L.splice(L.indexOf(r),1);return {text:'dropped rule '+r.id+': '+ruleText(r)}})}
export function resetGambits(a,{preset,why}={}){const p=String(preset==null||preset===''?'class':preset).toLowerCase().trim();
  if(!PRESETS.includes(p))return err(a,'Presets: '+PRESETS.join(', ')+' (class: how your class has always played; cautious: also flee below 35%; empty: no rules at all).');
  return edit(a,'reset',why,L=>{const P=presetFor(a.cls,p).map(r=>clone(r));L.splice(0,L.length,...P);stats().resets++;return {text:'rules reset to the '+p+' preset ('+P.length+' rules)'}})}
export {GAMBIT,CONDS,ACTS};

// ---- how a hero's list differs from its class preset (issue #679; read-only, no RNG, for the watcher) ----
// Rules are matched by identity (when + and + then and their arguments): an exact match is the preset rule (kept, or
// turned off when the preset had it on); then a rule with the same id and the same when or then, or the same when/and/then
// with other arguments, is that preset rule changed; the rest are added; preset rules left over are dropped. Among the
// matched rules, those outside the longest run kept in the preset's relative order are moved, up or down. The safety kinds
// (flee, potion, defend) are flagged when gone (no rule of the kind on any more: 'off' when one is only turned off, else
// 'gone') or weakened (a preset rule of the kind dropped, off or changed while another of the kind still stands).
const argKey=o=>o?Object.keys(o).sort().map(k=>k+'='+o[k]).join(','):'';
const idKey=r=>r.when+'('+argKey(r.w)+')&'+(r.and||'')+'('+argKey(r.w2)+')>'+r.then+'('+argKey(r.t)+')';
const shapeKey=r=>r.when+'&'+(r.and||'')+'>'+r.then;
// the hero's last edit of rule id since its last reset (the hover shows its day and why)
const histFor=(a,id)=>{const H=a.gambitHist||[];for(let i=H.length-1;i>=0;i--){const h=H[i];if(h.kind==='reset')return null;const m=/\brule (\d+)\b/.exec(h.text||'');
  if(m&&+m[1]===id)return {day:h.d,kind:h.kind,text:h.text,...(h.why?{why:h.why}:{})}}return null};
const safeOf=r=>ACTS[r.then]&&ACTS[r.then].safety||null;
export function gambitDiff(a){const P=presetFor(a.cls),L=rulesOf(a),free=new Set(P.map((_,i)=>i)),pair=new Array(L.length).fill(-1);
  const take=(i,test)=>{let best=-1;for(const j of free)if(test(P[j])){if(P[j].id===L[i].id){best=j;break}if(best<0)best=j}if(best>=0){free.delete(best);pair[i]=best}};
  for(let i=0;i<L.length;i++)take(i,p=>idKey(p)===idKey(L[i]));
  for(let i=0;i<L.length;i++)if(pair[i]<0)take(i,p=>p.id===L[i].id&&(p.then===L[i].then||p.when===L[i].when));
  for(let i=0;i<L.length;i++)if(pair[i]<0)take(i,p=>shapeKey(p)===shapeKey(L[i]));
  // moved: the matched rules outside the longest increasing run of their preset positions, in the hero's order
  const mi=[];for(let i=0;i<L.length;i++)if(pair[i]>=0)mi.push(i);
  const len=mi.map(()=>1),prev=mi.map(()=>-1);let bi=-1;
  for(let x=0;x<mi.length;x++){for(let y=0;y<x;y++)if(pair[mi[y]]<pair[mi[x]]&&len[y]+1>len[x]){len[x]=len[y]+1;prev[x]=y}if(bi<0||len[x]>len[bi])bi=x}
  const keep=new Set();for(let x=bi;x>=0;x=prev[x])keep.add(mi[x]);
  const rankH=new Map(mi.map((i,k)=>[i,k])),rankP=new Map([...mi].sort((u,v)=>pair[u]-pair[v]).map((i,k)=>[i,k]));
  const rules=L.map((r,i)=>{const j=pair[i],p=j>=0?P[j]:null,on=r.on!==false,s=safeOf(r);
    const status=!p?'added':idKey(p)!==idKey(r)?'changed':on!==(p.on!==false)?(on?'changed':'off'):'same';
    const moved=p&&!keep.has(i)?(rankH.get(i)<rankP.get(i)?'up':'down'):null;
    const o={id:r.id,order:i+1,rule:ruleText(r),on,status,moved,...(s?{safety:s}:{})};
    if(p&&(status!=='same'||moved))o.preset={id:p.id,order:j+1,rule:ruleText(p),on:p.on!==false,...(safeOf(p)?{safety:safeOf(p)}:{})};
    if(status!=='same'||moved){const h=histFor(a,r.id);if(h)o.edit=h}
    return o});
  const dropped=[...free].sort((x,y)=>x-y).map(j=>{const s=safeOf(P[j]),o={id:P[j].id,order:j+1,rule:ruleText(P[j]),on:P[j].on!==false,status:'dropped',...(s?{safety:s}:{})},h=histFor(a,P[j].id);if(h)o.edit=h;return o});
  const counts={added:0,changed:0,moved:0,off:0,dropped:dropped.length};for(const r of rules){if(r.status!=='same')counts[r.status]++;if(r.moved)counts.moved++}
  const safety={};for(const k of ['flee','potion','defend']){if(!P.some(r=>r.on!==false&&safeOf(r)===k))continue;
    if(!L.some(r=>r.on!==false&&safeOf(r)===k))safety[k]=L.some(r=>safeOf(r)===k)?'off':'gone';
    else if(rules.some(r=>r.preset&&r.preset.on&&r.preset.safety===k&&(r.status==='changed'||r.status==='off'))||dropped.some(r=>r.safety===k&&r.on))safety[k]='weakened'}
  const unchanged=!rules.some(r=>r.status!=='same'||r.moved)&&!dropped.length;
  const parts=['added','changed','moved','off','dropped'].filter(k=>counts[k]).map(k=>counts[k]+' '+(k==='off'?'turned off':k));
  for(const k of Object.keys(safety))parts.push(k+' rule '+safety[k]);
  const summary=unchanged?(a.gambits?'own list, same as the '+a.cls+' preset':'class preset, unchanged'):'differs from the '+a.cls+' preset: '+parts.join(', ');
  return {cls:a.cls,edited:!!a.gambits,unchanged,counts,safety,rules,dropped,summary}}
// a rule of the hero's own list that is not in its class preset as written (the purpose line says "by its own rule")
export const ownRule=(a,id)=>{if(!a||!a.gambits)return false;const r=a.gambits.find(x=>x.id===id);return !!r&&!presetFor(a.cls).some(p=>idKey(p)===idKey(r))};
