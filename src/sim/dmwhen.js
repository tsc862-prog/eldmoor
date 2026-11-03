// The DM's deferred actions and chosen wakes (issue #635): `when` and `watch`.
//   when {trigger, on, action, args, hours?, once?, reason}: the DM leaves an action behind (narrate, npc_say, whisper, dream,
//     stage_scene, a flat lever tool or any lever) that fires when a trigger trips (a company reaches a place, a hero levels,
//     night falls, ...). It is validated when set (the tool, its arguments, the trigger's targets; a staged elite or ambush is
//     previewed) and runs at fire time through the very same tool code as a direct call, so the daily caps, the lever limits,
//     the Fellowship reserve, the pile-on rule and every refusal apply as if the DM called it then. A refusal at that moment is
//     logged and the when is dropped (never retried blindly).
//   watch {trigger, on, note?, hours?, once?}: the same triggers, but a hit is a wake for the DM runner (dm_status
//     watches_fired; scripts/dm-agent.mjs eventDue takes an event turn within EVENT_MAX / EVENT_GAP).
// Triggers are edges: a condition already true when set does not fire until it turns false and true again. Checked every
// WHEN.EVERY game minutes from the step (dreamTick in dmagent.js); with nothing set the tick returns at once and writes
// nothing, so a seeded world is unchanged. No RNG anywhere. DOM-free; the DM's own data (no hero tool reads it, #123).
//
// state: S.dmAgent.when {seq, hseq, at (last check, game min), day:{d, when, watch}, list:[entry], fired:[rec], hits:[hit]}
//   entry {id, kind:'when'|'watch', trigger, on (resolved targets), label, tool?, args?, reason?, note?, once, set, until,
//          st (edge state), n (times fired), lastDay}
//   rec   {seq, id (the when), gm, t, day, trigger (label), who, tool, ok, why?, status:'fired'|'refused'|'expired'|'lapsed'}
//   hit   {id (hit seq), watch, gm, t, day, what, note}
import {S,clockStr,dayNo} from './state.js';
import {ZONES,CITY,LANDMARKS,zoneAt,dist} from '../world/map.js';
import {DM_TOOLS,TRIGGER_NAMES as TRIGGER_ROWS} from '../data/dm-tools.js';
import {leverNames,leverAlias} from './levers.js';
import {dmlog} from './dmlog.js';
import {companies,companyById,slotted} from './company.js';
import {ensureNpcs} from './npcs.js';
import {maxHp} from './heroes.js';

export const WHEN={MAX:6,PER_DAY:12,HOURS:24,MIN_H:1,MAX_H:72,EVERY:2,KEEP:12,SEEN_H:24,R:4,R_MIN:1,R_MAX:15};
export const WATCH={MAX:6,PER_DAY:12};
const DAY=1440,NIGHT_HH=20,DAWN_HH=6;
// The actions a when may carry: the DM's voice and its world tools (only those that exist in DM_TOOLS; create_site joins when it lands).
const DEFER0=['narrate','npc_say','whisper','dream','stage_scene','post_hook','place_person','mark_place','give_item','take_item','create_site','pull_lever'];
export const deferTools=()=>DEFER0.filter(n=>DM_TOOLS.some(t=>t.name===n));
const WHO_RE=/\{who\}|\$who\b/gi,WHO_TEST=/\{who\}|\$who\b/i;
// The trigger table (append-only): args (? = optional), what it means, and whether it names a hero ({who}).
export const TRIGGERS={
  enter_region:{args:'region, company? | hero?',who:true,desc:'a hero (any agent hero, or of company, or hero) enters the region'},
  enter_town:{args:'town, company? | hero?',who:true,desc:'a hero reaches the town (walks in)'},
  near_place:{args:'place (a place or marker by name or id, a landmark, a town or "x,y"), radius? (1-15, default 4), company? | hero?',who:true,desc:'a hero comes within radius tiles of the place'},
  near_person:{args:'npc (a townsperson or a person you placed, by id or name), radius? (1-15, default 4), company? | hero?',who:true,desc:'a hero comes within radius tiles of the person'},
  talks_to:{args:'npc, hero? | company?',who:true,desc:'a hero starts a conversation with the person'},
  member_hp_below:{args:'pct (5-90), company? | hero?',who:true,desc:'a hero drops below pct% of their health'},
  foe_dies:{args:'name (a named foe alive now, as heroes_near or regions show it)',who:false,desc:'the named foe dies (or is gone)'},
  quest_scene:{args:'quest (a job id from hooks), scene (1-based)',who:true,desc:'the job reaches that scene ({who} is its leader)'},
  camp_made:{args:'company? | hero?',who:true,desc:'a hero makes camp'},
  night_falls:{args:'none',who:false,desc:'night falls (20:00)'},
  day_breaks:{args:'none',who:false,desc:'day breaks (06:00)'},
  at_time:{args:'hh (0-23)',who:false,desc:'the clock reaches hh:00'},
  after_hours:{args:'h (1-72)',who:false,desc:'h game hours pass from now'},
  hero_levels:{args:'company? | hero?, level? (the level reached)',who:true,desc:'a hero gains a level (or reaches level)'},
  oath_kept:{args:'company? | hero?',who:true,desc:'a hero keeps an oath'},
};
export const TRIGGER_NAMES=Object.keys(TRIGGERS);
if(TRIGGER_NAMES.join()!==TRIGGER_ROWS.join())throw new Error('dmwhen TRIGGERS and dm-tools TRIGGER_NAMES differ');
const ON_KEYS=['region','town','place','npc','hero','company','radius','pct','name','quest','scene','hh','h','level'];

// The tool code lives in dmagent.js: it registers fire(tool, args) -> result and check(tool, args) -> null | {error} | {preview}.
let HOOK={fire:null,check:null};
export function setWhenHooks(h){HOOK={...HOOK,...h}}

// ---- helpers ----
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const alive=a=>a&&a.state!=='dead';
const gameDay=()=>Math.floor(S.gameMin/DAY);
const byId=id=>S.agents.find(x=>x.id===id)||null;
const people=()=>{ensureNpcs();return [...(S.npcs||[]),...(S.wanderers||[])]};
const squeeze=s=>String(s==null?'':s).toLowerCase().replace(/[^a-z0-9]+/g,'');
const personOf=v=>{const k=clean(v,60).toLowerCase(),q=squeeze(k);if(!k)return null;const all=people();
  return all.find(n=>String(n.id).toLowerCase()===k)||all.find(n=>String(n.name||'').toLowerCase()===k||((n.title||'')+' '+n.name).toLowerCase()===k)||(q?all.find(n=>squeeze(n.name)===q||squeeze((n.title||'')+n.name)===q):null)||null};
const pname=p=>(p.title&&!p.wander?p.title+' ':'')+p.name;
const heroOf=v=>{const s=clean(v,40),lo=s.toLowerCase();return s?S.agents.find(a=>alive(a)&&(String(a.id)===s||a.name.toLowerCase()===lo))||null:null};
const regionIdx=v=>{const s=clean(v,40).toLowerCase();if(!s)return null;if(/^\d+$/.test(s)){const n=Number(s);return n<ZONES.length?n:null}const i=ZONES.findIndex(n=>n.toLowerCase()===s);return i>=0?i:null};
const townOf=v=>{const s=clean(v,40).toLowerCase();return s?CITY.find(c=>c.name.toLowerCase()===s)||null:null};
function companyOfArg(v){const s=clean(v,40),lo=s.toLowerCase();if(!s)return null;
  if(lo==='fellowship'||lo==='the fellowship'||lo==='party'){const F=slotted();return F||null}
  return companies().find(C=>String(C.id)===s||String(C.name||'').toLowerCase()===lo)||null}
function placeArg(v){const s=clean(v,60),lo=s.toLowerCase();if(!s)return null;
  const m=/^\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?$/.exec(s);if(m)return {x:Number(m[1]),y:Number(m[2]),name:m[1]+','+m[2]};
  const pl=(S.places||[]).find(p=>String(p.id)===s||(p.name||'').toLowerCase()===lo);if(pl)return {x:pl.x,y:pl.y,name:pl.name,pid:pl.id};
  const mk=(S.marks||[]).find(p=>String(p.id)===s||(p.name||'').toLowerCase()===lo);if(mk)return {x:mk.x,y:mk.y,name:mk.name||'the marked spot'};
  const lm=LANDMARKS.find(l=>{const n=l.name.toLowerCase();return n===lo||n.replace(/^the /,'')===lo.replace(/^the /,'')});if(lm)return {x:lm.x,y:lm.y,name:lm.name};
  const c=townOf(s);if(c)return {x:c.gate.x,y:c.gate.y,name:c.name};
  return null}
function W(){const D=S.dmAgent;if(!D)return null;const w=D.when||(D.when={seq:0,hseq:0,at:null,day:{d:-1,when:0,watch:0},list:[],fired:[],hits:[]});
  if(w.day.d!==gameDay())w.day={d:gameDay(),when:0,watch:0};return w}
const nextHour=(hh,from)=>{const base=Math.floor(from/DAY)*DAY+hh*60;return base>from?base:base+DAY};

// Who the trigger watches: one hero, a company's members, or every agent-played hero.
function subjects(on){if(on.hero!=null){const a=byId(on.hero);return a&&alive(a)&&!a.hidden?[a]:[]}
  if(on.cid!=null){const C=companyById(on.cid);return C?C.ids.map(byId).filter(a=>a&&alive(a)&&!a.hidden):[]}
  return S.agents.filter(a=>a.player&&alive(a)&&!a.hidden)}
const subjText=on=>on.hero!=null?(byId(on.hero)||{name:'#'+on.hero}).name:on.cid!=null?(companyById(on.cid)||{name:'a company'}).name||'a company':'any agent hero';

// Resolve a trigger's arguments when it is set: {on, label} or {error}.
function resolve(trigger,o){const T=TRIGGERS[trigger];if(!T)return {error:'trigger must be one of: '+TRIGGER_NAMES.join(', ')};
  const on={},need=k=>'"'+trigger+'" needs '+k+' ('+T.args+')';
  if(o.hero!=null&&o.hero!==''){const h=heroOf(o.hero);if(!h)return {error:'hero: no living hero called "'+clean(o.hero,40)+'"'};on.hero=h.id}
  else if(o.company!=null&&o.company!==''){const C=companyOfArg(o.company);if(!C)return {error:'company: no company called "'+clean(o.company,40)+'" (an id or name from companies_view, or "fellowship")'};on.cid=C.id}
  const r=o.radius==null||o.radius===''?WHEN.R:Math.round(Number(o.radius));
  switch(trigger){
    case 'enter_region':{const z=regionIdx(o.region);if(z==null)return {error:need('region')+'; regions: '+ZONES.join(', ')};on.z=z;on.what='enters '+ZONES[z];break}
    case 'enter_town':{const c=townOf(o.town);if(!c)return {error:need('town')+'; towns: '+CITY.map(c=>c.name).join(', ')};on.town=c.name;on.what='reaches '+c.name;break}
    case 'near_place':{const p=placeArg(o.place);if(!p)return {error:need('place')+': no place, marker, landmark or town called "'+clean(o.place,40)+'"'};
      if(!(r>=WHEN.R_MIN&&r<=WHEN.R_MAX))return {error:'radius is '+WHEN.R_MIN+'-'+WHEN.R_MAX};on.x=p.x;on.y=p.y;on.r=r;on.pname=p.name;if(p.pid!=null)on.pid=p.pid;on.what='comes within '+r+' tiles of '+p.name;break}
    case 'near_person':case 'talks_to':{const p=personOf(o.npc);if(!p)return {error:need('npc')+': nobody called "'+clean(o.npc,40)+'" (see npcs)'};on.npc=p.id;on.pname=pname(p);
      if(trigger==='near_person'){if(!(r>=WHEN.R_MIN&&r<=WHEN.R_MAX))return {error:'radius is '+WHEN.R_MIN+'-'+WHEN.R_MAX};on.r=r;on.what='comes within '+r+' tiles of '+on.pname}else on.what='talks to '+on.pname;break}
    case 'member_hp_below':{const p=Math.round(Number(o.pct));if(!(p>=5&&p<=90))return {error:need('pct')+' (5-90)'};on.pct=p;on.what='drops below '+p+'% health';break}
    case 'foe_dies':{const q=clean(o.name,60).toLowerCase();if(!q)return {error:need('name')};const ms=foes(q);if(!ms.length)return {error:'no named foe called "'+clean(o.name,60)+'" is alive now'};on.foe=q;on.fname=ms[0].name;on.what=ms[0].name+' dies';break}
    case 'quest_scene':{const id=Math.round(Number(o.quest)),sc=Math.round(Number(o.scene));const v=(S.adventures||[]).find(x=>x.id===id&&(x.phase==='open'||x.phase==='active'));
      if(!v)return {error:need('quest')+': no open or running job '+clean(o.quest,12)+' (see hooks)'};if(!(sc>=1&&sc<=12))return {error:need('scene')+' (1-12)'};on.adv=id;on.scene=sc;on.what='job '+id+(v.title?' ('+clean(v.title,60)+')':'')+' reaches scene '+sc;break}
    case 'camp_made':on.what='makes camp';break;
    case 'night_falls':on.hh=NIGHT_HH;on.what='night falls';break;
    case 'day_breaks':on.hh=DAWN_HH;on.what='day breaks';break;
    case 'at_time':{const hh=Math.round(Number(o.hh));if(!(hh>=0&&hh<=23))return {error:need('hh')+' (0-23)'};on.hh=hh;on.what='the clock reaches '+String(hh).padStart(2,'0')+':00';break}
    case 'after_hours':{const h=Number(o.h);if(!(h>=1&&h<=WHEN.MAX_H))return {error:need('h')+' (1-'+WHEN.MAX_H+')'};on.h=Math.round(h*10)/10;on.what=on.h+' game hours pass';break}
    case 'hero_levels':{if(o.level!=null&&o.level!==''){const l=Math.round(Number(o.level));if(!(l>=2&&l<=60))return {error:'level is 2-60'};on.level=l}on.what=on.level?'reaches level '+on.level:'gains a level';break}
    case 'oath_kept':on.what='keeps an oath';break}
  const label=T.who?subjText(on)+' '+on.what:on.what;
  return {on,label}}
const foes=q=>(S.mobs||[]).filter(m=>m.hp>0&&m.name&&(m.name.toLowerCase()===q||m.name.toLowerCase().includes(q)));

// The edge state when set: what is already true does not fire.
function baseline(e){const on=e.on,st={};
  switch(e.trigger){
    case 'enter_region':case 'enter_town':case 'near_place':case 'near_person':case 'member_hp_below':case 'camp_made':st.on=subjects(on).filter(a=>holds(e,a)).map(a=>a.id);break;
    case 'talks_to':{const T=S.talks;st.base=T?T.seq||0:0;break}
    case 'foe_dies':st.ids=foes(on.foe).map(m=>m.id);break;
    case 'night_falls':case 'day_breaks':case 'at_time':st.at=nextHour(on.hh,S.gameMin);break;
    case 'after_hours':st.at=S.gameMin+on.h*60;break;
    case 'hero_levels':st.lv=Object.fromEntries(subjects(on).map(a=>[a.id,a.lvl]));break;
    case 'oath_kept':st.g=Object.fromEntries(subjects(on).map(a=>[a.id,goalKey(a)]));break}
  return st}
const goalKey=a=>a.goal?clean(a.goal.text,80)+'|'+(a.goal.done?1:0):'';
function holds(e,a){const on=e.on;switch(e.trigger){
  case 'enter_region':return a.state!=='dungeon'&&zoneAt(a.x,a.y)===on.z;
  case 'enter_town':return a.state==='town'&&a.town===on.town;
  case 'near_place':{let p=on;if(on.pid!=null){const q=(S.places||[]).find(x=>x.id===on.pid);if(q)p=q}return a.state!=='dungeon'&&dist(a,p)<=on.r}
  case 'near_person':{const p=people().find(n=>n.id===on.npc);return !!p&&Number.isFinite(p.x)&&dist(a,p)<=on.r}
  case 'member_hp_below':return a.hp<on.pct/100*Math.max(1,maxHp(a));
  case 'camp_made':return a.state==='camp'}return false}
// One check of an entry: {who?, what} when it trips, 'lapse' when it can never trip, else null. Updates the edge state.
function check(e){const on=e.on,st=e.st;
  switch(e.trigger){
    case 'enter_region':case 'enter_town':case 'near_place':case 'near_person':case 'member_hp_below':case 'camp_made':{
      if(e.trigger==='near_person'&&!people().some(n=>n.id===on.npc))return 'lapse';
      const cur=subjects(on).filter(a=>holds(e,a)),was=new Set(st.on||[]);st.on=cur.map(a=>a.id);const a=cur.find(x=>!was.has(x.id));return a?{who:a,what:a.name+' '+on.what}:null}
    case 'talks_to':{const T=S.talks;if(!T)return null;const ids=new Set(subjects(on).map(a=>a.id)),cs=[...(T.cur||[]),...(T.past||[])].filter(c=>c.id>(st.base||0));
      if(!cs.length)return null;st.base=Math.max(st.base||0,...cs.map(c=>c.id));const c=cs.find(c=>c.npc===on.npc&&(c.heroes||[]).some(id=>ids.has(id)));
      if(!c)return null;const a=byId((c.heroes||[]).find(id=>ids.has(id)));return {who:a,what:(a?a.name:'a hero')+' '+on.what}}
    case 'foe_dies':{const live=new Set((S.mobs||[]).filter(m=>m.hp>0).map(m=>m.id)),gone=(st.ids||[]).filter(id=>!live.has(id));
      if(!gone.length)return st.ids&&st.ids.length?null:'lapse';st.ids=foes(on.foe).map(m=>m.id);return {who:null,what:on.what}}
    case 'quest_scene':{const v=(S.adventures||[]).find(x=>x.id===on.adv);if(!v||v.phase!=='open'&&v.phase!=='active')return 'lapse';
      if(v.phase!=='active'||(v.idx||0)+1<on.scene||st.done===((v.idx||0)+1))return null;st.done=(v.idx||0)+1;const a=byId(v.lead);return {who:a&&alive(a)?a:null,what:on.what}}
    case 'night_falls':case 'day_breaks':case 'at_time':case 'after_hours':{if(S.gameMin<st.at)return null;
      st.at=e.trigger==='after_hours'?S.gameMin+on.h*60:nextHour(on.hh,S.gameMin);return {who:null,what:on.what}}
    case 'hero_levels':{let hit=null;for(const a of subjects(on)){const was=st.lv[a.id];st.lv[a.id]=a.lvl;
        if(was==null||a.lvl<=was)continue;if(on.level&&!(a.lvl>=on.level&&was<on.level))continue;if(!hit)hit={who:a,what:a.name+' reaches level '+a.lvl}}return hit}
    case 'oath_kept':{let hit=null;for(const a of subjects(on)){const was=st.g[a.id],k=goalKey(a);st.g[a.id]=k;
        if(was==null||was===k||!k.endsWith('|1'))continue;if(!hit)hit={who:a,what:a.name+' keeps an oath: '+clean(a.goal.text,80)}}return hit}}
  return null}

// ---- setting, listing, cancelling ----
const yes=v=>v===true||/^(yes|true|1|on)$/i.test(String(v==null?'':v).trim());
const objArg=v=>{if(typeof v==='string'){try{v=v.trim()?JSON.parse(v):{}}catch(e){return null}}return v==null?{}:typeof v==='object'&&!Array.isArray(v)?{...v}:null};
const hoursOf=v=>v==null||v===''?WHEN.HOURS:Number(v);
const usesWho=x=>WHO_TEST.test(typeof x==='string'?x:JSON.stringify(x||{}));
export const WHEN_USAGE='when takes: trigger ('+TRIGGER_NAMES.join('|')+'), on (an object of the trigger\'s arguments, e.g. {"region":"'+ZONES[ZONES.length-1]+'","company":"fellowship"}), action (a tool: '+deferTools().join('|')+', or a lever name such as set_condition), args (an object of that tool\'s arguments, as you would call it; "{who}" in a text is the hero who tripped it), hours? (1-72 until it lapses, default 24), once? (yes|no, default yes; a repeating one fires at most once a game day), reason';
export const WATCH_USAGE='watch takes: trigger ('+TRIGGER_NAMES.join('|')+'), on (the trigger\'s arguments, as for when), note? (what to remember when it wakes you), hours? (1-72, default 24), once? (yes|no, default yes)';
const triggersList=()=>Object.entries(TRIGGERS).map(([k,t])=>k+' {'+t.args+'}: '+t.desc);
// Split loose top-level keys between the trigger (on) and the action (args).
function sortArgs(a,toolRow){const on=objArg(a.on);if(on==null)return {error:'on must be an object of the trigger\'s arguments, such as {"region":"'+ZONES[0]+'"}'};
  const args=toolRow===undefined?{}:objArg(a.args);if(args==null)return {error:'args must be an object of the action\'s arguments, as you would call the tool'};
  const skip=new Set(['trigger','on','action','args','hours','once','reason','note','tool']);
  for(const k in a){if(skip.has(k))continue;if(ON_KEYS.includes(k)&&!(k in on))on[k]=a[k];else if(toolRow&&toolRow.args&&k in toolRow.args&&!(k in args))args[k]=a[k]}
  return {on,args}}

export function setWhen(a){const w=W();if(!w)return {ok:false,error:'The DM seat has no state yet.'};a=a&&typeof a==='object'?a:{};
  const trigger=clean(a.trigger,30).toLowerCase(),reason=clean(a.reason,160),usage=WHEN_USAGE;
  if(!TRIGGERS[trigger])return {ok:false,error:'Refused: trigger must be one of: '+TRIGGER_NAMES.join(', ')+'. '+usage,triggers:triggersList()};
  if(!reason)return {ok:false,error:'Refused: a reason is required (one sentence for the DM log). '+usage};
  if(w.list.filter(e=>e.kind==='when').length>=WHEN.MAX)return {ok:false,error:'Refused: '+WHEN.MAX+' whens are pending already; cancel one with unwhen {id} (whens lists them).'};
  if(w.day.when>=WHEN.PER_DAY)return {ok:false,error:'Refused: '+WHEN.PER_DAY+' whens set today already.'};
  let act=a.action,args0=a.args;if(act&&typeof act==='object'){args0=act.args||args0;act=act.tool||act.name}
  const action=clean(act,40).toLowerCase();if(!action)return {ok:false,error:'Refused: action is required (a tool: '+deferTools().join(', ')+', or a lever name). '+usage};
  let tool=action,lever=null;const tools=deferTools();
  if(!tools.includes(action)){const lv=leverAlias(action);if(leverNames().includes(lv)&&action!=='pull_lever'){tool='pull_lever';lever=lv}
    else return {ok:false,error:'Refused: "'+action+'" cannot be deferred. Actions: '+tools.join(', ')+', or a lever name ('+leverNames().join(', ')+').'}}
  const row=DM_TOOLS.find(t=>t.name===tool),sa=sortArgs({...a,args:args0},row);if(sa.error)return {ok:false,error:'Refused: '+sa.error+'. '+usage};
  let args=sa.args;
  if(lever){const params=args.params!=null?objArg(args.params):(()=>{const q={...args};delete q.reason;delete q.lever;return q})();if(params==null)return {ok:false,error:'Refused: params must be an object. '+usage};args={lever,params,reason:args.reason||reason}}
  if(row&&row.args&&row.args.reason&&!clean(args.reason,160))args.reason=reason;
  const R=resolve(trigger,sa.on);if(R.error)return {ok:false,error:'Refused: '+R.error+'. '+usage,triggers:triggersList()};
  if(usesWho(args)&&!TRIGGERS[trigger].who)return {ok:false,error:'Refused: "{who}" needs a trigger that names a hero ('+TRIGGER_NAMES.filter(k=>TRIGGERS[k].who).join(', ')+'); '+trigger+' names nobody.'};
  // the action's own arguments, checked now as the tool would (it is checked again, for real, when it fires)
  if(row&&row.args)for(const [k,s] of Object.entries(row.args)){const v=args[k];
    if(!s.optional&&(v==null||v===''))return {ok:false,error:'Refused: the action '+tool+' needs '+k+' ('+s.desc+'). '+usage};
    if(v!=null&&v!==''&&s.enum&&!s.enum.includes(String(v))&&!usesWho(v))return {ok:false,error:'Refused: '+tool+' '+k+' must be one of '+s.enum.join(', ')+'.'}}
  let preview=null;if(HOOK.check){const c=HOOK.check(tool,args,{who:usesWho(args)});if(c&&c.error)return {ok:false,error:'Refused: '+c.error,...(c.usage?{usage:c.usage}:{})};if(c&&c.preview)preview=c.preview}
  const h=hoursOf(a.hours);if(!(h>=WHEN.MIN_H&&h<=WHEN.MAX_H))return {ok:false,error:'Refused: hours is '+WHEN.MIN_H+'-'+WHEN.MAX_H+' (how long it waits before it lapses).'};
  const e={id:++w.seq,kind:'when',trigger,on:R.on,label:R.label,tool,args,reason,once:a.once==null||a.once===''?true:yes(a.once),set:Math.round(S.gameMin),until:Math.round(S.gameMin+h*60),n:0,lastDay:-1};
  e.st=baseline(e);w.list.push(e);w.day.when++;
  dmlog('agent',null,['When #'+e.id+' set: when '+e.label+', '+actLine(e)+' - '+reason+'.'],{by:'dm-agent',when:e.id,trigger,on:R.label,tool,reason,hours:h,once:e.once});
  return {ok:true,when:e.id,trigger:R.label,action:actLine(e),hours:h,once:e.once,...(preview?{preview}:{}),pending:w.list.filter(x=>x.kind==='when').length+'/'+WHEN.MAX,
    note:'It fires through '+tool+' as if you called it then: its limits and refusals apply at that moment. whens lists it, unwhen {id} cancels it.'}}

export function setWatch(a){const w=W();if(!w)return {ok:false,error:'The DM seat has no state yet.'};a=a&&typeof a==='object'?a:{};
  const trigger=clean(a.trigger,30).toLowerCase(),usage=WATCH_USAGE;
  if(!TRIGGERS[trigger])return {ok:false,error:'Refused: trigger must be one of: '+TRIGGER_NAMES.join(', ')+'. '+usage,triggers:triggersList()};
  if(w.list.filter(e=>e.kind==='watch').length>=WATCH.MAX)return {ok:false,error:'Refused: '+WATCH.MAX+' watches are set already; drop one with unwatch {id}.'};
  if(w.day.watch>=WATCH.PER_DAY)return {ok:false,error:'Refused: '+WATCH.PER_DAY+' watches set today already.'};
  const sa=sortArgs(a,undefined);if(sa.error)return {ok:false,error:'Refused: '+sa.error+'. '+usage};
  const R=resolve(trigger,sa.on);if(R.error)return {ok:false,error:'Refused: '+R.error+'. '+usage,triggers:triggersList()};
  const h=hoursOf(a.hours);if(!(h>=WHEN.MIN_H&&h<=WHEN.MAX_H))return {ok:false,error:'Refused: hours is '+WHEN.MIN_H+'-'+WHEN.MAX_H+'.'};
  const e={id:++w.seq,kind:'watch',trigger,on:R.on,label:R.label,note:clean(a.note,200),once:a.once==null||a.once===''?true:yes(a.once),set:Math.round(S.gameMin),until:Math.round(S.gameMin+h*60),n:0,lastDay:-1};
  e.st=baseline(e);w.list.push(e);w.day.watch++;
  dmlog('agent',null,['Watch #'+e.id+' set: wake the DM when '+e.label+'.'],{by:'dm-agent',watch:e.id,trigger,on:R.label,hours:h,once:e.once});
  return {ok:true,watch:e.id,trigger:R.label,hours:h,once:e.once,watches:w.list.filter(x=>x.kind==='watch').length+'/'+WATCH.MAX,
    note:'When it trips, your runner takes an extra turn (within the day\'s event turns) and the turn prompt names it; unwatch {id} drops it.'}}

export function cancel(kind,id){const w=W();if(!w)return {ok:false,error:'Nothing is set.'};const n=Math.round(Number(id)),i=w.list.findIndex(e=>e.kind===kind&&e.id===n);
  if(i<0)return {ok:false,error:'No pending '+kind+' '+clean(id,12)+' ('+(kind==='when'?'whens':'watches')+' lists them).'};
  const e=w.list.splice(i,1)[0];dmlog('agent',null,[(kind==='when'?'When':'Watch')+' #'+e.id+' cancelled ('+e.label+').'],{by:'dm-agent',[kind]:e.id,cancelled:true});
  return {ok:true,cancelled:e.id,[kind==='when'?'whens':'watches']:w.list.filter(x=>x.kind===kind).length}}

const actLine=e=>{const a=e.args||{},t=a.text||a.frame||a.title||'';
  return e.tool==='pull_lever'?'pull '+(a.lever||'?'):e.tool+(a.near?' near '+a.near:a.hero?' to '+a.hero:a.npc?' as '+a.npc:a.town?' at '+a.town:'')+(t?': "'+clean(t,60)+(String(t).length>60?'…':'')+'"':'')};
const hoursLeft=e=>Math.max(0,Math.round((e.until-S.gameMin)/6)/10);
const viewOf=e=>e.kind==='when'?{id:e.id,when:e.label,action:actLine(e),hours_left:hoursLeft(e),once:e.once,...(e.n?{fired:e.n}:{})}:{id:e.id,watch:e.label,...(e.note?{note:e.note}:{}),hours_left:hoursLeft(e),once:e.once,...(e.n?{fired:e.n}:{})};
const recent=(L,h)=>(L||[]).filter(r=>S.gameMin-r.gm<=h*60);
export function whensView(){const w=S.dmAgent&&S.dmAgent.when;const L=w?w.list:[];
  return {ok:true,whens:L.filter(e=>e.kind==='when').map(viewOf),watches:L.filter(e=>e.kind==='watch').map(viewOf),fired:recent(w&&w.fired,WHEN.SEEN_H).slice(-8).reverse(),watches_fired:recent(w&&w.hits,WHEN.SEEN_H).slice(-8).reverse(),
    limits:{whens:WHEN.MAX,watches:WATCH.MAX,per_day:WHEN.PER_DAY,set_today:w?{when:w.day.d===gameDay()?w.day.when:0,watch:w.day.d===gameDay()?w.day.watch:0}:{when:0,watch:0}},triggers:triggersList(),actions:deferTools()}}
// For dm_status (compact) and the DM frame.
export function whenStatus(){const w=S.dmAgent&&S.dmAgent.when;if(!w)return null;
  const p=w.list.filter(e=>e.kind==='when'),q=w.list.filter(e=>e.kind==='watch'),f=recent(w.fired,WHEN.SEEN_H),h=recent(w.hits,WHEN.SEEN_H);
  if(!p.length&&!q.length&&!f.length&&!h.length)return null;
  return {whens:p.map(viewOf),watches:q.map(viewOf),fired:f.slice(-6).reverse(),watches_fired:h.slice(-6).reverse()}}
export const whenPending=()=>{const w=S.dmAgent&&S.dmAgent.when;return w?w.list.map(e=>({kind:e.kind,id:e.id,label:e.label,action:e.kind==='when'?actLine(e):null,hours_left:hoursLeft(e)})):[]};

// ---- the tick ----
const subWho=(v,name)=>typeof v==='string'?v.replace(WHO_RE,name):Array.isArray(v)?v.map(x=>subWho(x,name)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,subWho(x,name)])):v;
function keep(L,x){L.push(x);while(L.length>WHEN.KEEP)L.shift()}
function fire(w,e,hit){const rec={seq:w.fseq=(w.fseq||0)+1,id:e.id,gm:Math.round(S.gameMin),t:clockStr(),day:dayNo(),trigger:hit.what,who:hit.who?hit.who.name:null,tool:e.tool==='pull_lever'?(e.args||{}).lever:e.tool};
  const top=(S.dmLog||[])[0],mark=top?top.id:-1;let r;
  try{r=HOOK.fire?HOOK.fire(e.tool,hit.who?subWho(e.args,hit.who.name):e.args):{ok:false,error:'no DM tools'}}catch(x){r={ok:false,error:String(x&&x.message||x).slice(0,160)}}
  for(const x of S.dmLog||[]){if(x.id<=mark)break;if(x.detail&&typeof x.detail==='object')x.detail.when=e.id} // the action's own DM log lines name the when
  rec.ok=!!(r&&r.ok);rec.status=rec.ok?'fired':'refused';if(!rec.ok)rec.why=clean(r&&(r.error||r.reason),200).replace(/^Refused:\s*/,'');
  keep(w.fired,rec);
  dmlog('agent',null,['When #'+e.id+' fired ('+hit.what+'): '+actLine(e)+(rec.ok?'.':' - refused: '+rec.why+'.')],{by:'dm-agent',when:e.id,trigger:hit.what,tool:rec.tool,result:rec.ok?'applied':'refused: '+rec.why});
  return rec.ok}
function wake(w,e,hit){const x={id:++w.hseq,watch:e.id,gm:Math.round(S.gameMin),t:clockStr(),day:dayNo(),what:hit.what,...(e.note?{note:e.note}:{})};keep(w.hits,x);
  dmlog('agent',null,['Watch #'+e.id+' tripped: '+hit.what+'.'],{by:'dm-agent',watch:e.id,trigger:hit.what})}
function drop(w,e,status,why){const i=w.list.indexOf(e);if(i>=0)w.list.splice(i,1);
  if(e.kind==='when'){keep(w.fired,{seq:w.fseq=(w.fseq||0)+1,id:e.id,gm:Math.round(S.gameMin),t:clockStr(),day:dayNo(),trigger:e.label,who:null,tool:e.tool==='pull_lever'?(e.args||{}).lever:e.tool,ok:false,status,why});
    dmlog('agent',null,['When #'+e.id+' '+status+' ('+e.label+'): '+why+'.'],{by:'dm-agent',when:e.id,result:status})}}
// Called from the step (dreamTick): nothing set, nothing done.
export function whenTick(){const D=S.dmAgent,w=D&&D.when;if(!w||!w.list.length)return;
  if(w.at!=null&&S.gameMin>=w.at&&S.gameMin-w.at<WHEN.EVERY)return;w.at=S.gameMin;
  for(const e of w.list.slice()){
    if(S.gameMin>=e.until){drop(w,e,e.n?'ended':'expired',e.n?'its hours are up':'it never tripped in its hours');continue}
    const hit=check(e);if(!hit)continue;
    if(hit==='lapse'){drop(w,e,'lapsed','it can no longer trip (the person, foe or job is gone)');continue}
    if(!e.once&&e.lastDay===gameDay())continue; // a repeating one: once a game day
    e.n++;e.lastDay=gameDay();
    if(e.kind==='when'){const ok=fire(w,e,hit);if(e.once||!ok){const i=w.list.indexOf(e);if(i>=0)w.list.splice(i,1)}}
    else{wake(w,e,hit);if(e.once){const i=w.list.indexOf(e);if(i>=0)w.list.splice(i,1)}}}}
