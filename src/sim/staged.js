// Staged scenes (issue #132, part of #66): the DM agent stages a narrated encounter (an elite, an
// ambush, a meeting, a trap, a mystery or a social scene) near the Fellowship, a member or a place;
// the cast walks to the party (or waits where it will pass) and a Table scene opens when they meet.
// While a staged scene runs, the DM agent is asked for short at-the-table calls (voice the NPC or foe,
// describe each member's action, pick one complication from a legal set); each call has a real-time
// budget (TABLE.dmMs) and the scripted DM fills the slot on silence or timeout, so nothing waits.
// Owned by brain-builder. DOM-free.
//
// Fair hardcore: dice and stats decide. A staged foe is built from the bestiary at a level bounded by
// the party's (never more than STAGE.LVL_UP above its average; asking for more than STAGE.FAR above is
// refused), a trap or a hard word is a d20 roll against a DC, and no outcome is DM fiat. A trap never
// takes a member below STAGE.TRAP_FLOOR of max HP. People go through the create_npc lever, a mystery's
// marker through mark_place (so their limits and the DM log apply). Every stage, refusal, roll, call and
// outcome is in the DM log with detail.by 'dm-agent' (the DM AGENT tag), the scripted fills as 'scripted'.
// In-game only (#123): the frame, the voiced lines and the outcomes reach the members as narration and
// speech at the table (their chat buffers, so the Chat tab, chat_read, events and the banner); the
// DM's reason stays in the DM log.
//
// Nothing here runs unless the DM agent stages a scene: the scripted path (npm run sim, a seat with no
// runner) is untouched, and the scripted DM keeps its own elites and ambushes as before.
//
// ---- state (plain JSON on S, saved with the world) ----
//   S.staged {seq, day:{d,n}, cur: rec|null, past:[short records], stats}
//   rec {id, kind, title, frame, reason, near:{hero, label}, at:{x,y}, z, lvl, cast:{...}, labels, born, until, phase, scene, result}
//   S.table.calls [{id, kind, about, legal?, who?, t, done, by, text, pick}] while a staged scene is open
import {S,clockStr,dayNo} from './state.js';
import {ZONES,REGIONS,CITY,LANDMARKS,ZPTS,zoneAt,dist} from '../world/map.js';
import {MOBS} from '../data/mobs.js';
import {BESTIARY} from '../data/bestiary.js';
import {WANDER_ROLES} from '../data/npcs.js';
import {TRAPS} from '../data/encounter-tables.js';
import {dmlog} from './dmlog.js';
import {maxHp} from './heroes.js';
import {check,socialSkill} from './abilities.js';
import {buildEncounter,spawnFoe} from './encounterbuilder.js';
import {pull,spotErr,takeBack} from './levers.js';
import {nearText,pointHint} from './nearform.js'; // the place shapes a local model writes (issue #467)
import {focus,focuses,nearMember} from './dmfocus.js';
import {companies,companyOf,companyById,members as coMembers,slotHeroes,slotKeyOf,slotted} from './company.js'; // staging per company (#451)
import {openProps,leaderOfF} from './council.js';
import {leaderOf as companyLead} from './company.js';
import {remember} from './memory.js';
import {notify} from './notify.js';
import {CAP as CHAT_CAP,BUBBLE} from './chat.js';
import {TABLE,openScene,tableOn,setSceneKind,setStageHooks,kindHooks} from './table.js';
import {setProps} from './props.js';
import {findScene} from './scenes.js'; // a staged scene may sit beside another company's (#518)
import {heard,tableLive,fillWhy} from './dmreflex.js'; // the DM's reflexes fill a call it leaves unanswered (#561)
import {talkFromScene} from './talk.js'; // NPC conversations (#170)
import {SETTINGS,SETTING_IDS} from '../data/settings.js'; // scene maps (#431): the rooms a meeting or social scene plays in

// ---- knobs ----
export const STAGE={
  get PER_DAY(){return 2+Math.max(1,companies().length)}, // staged scenes the DM agent may set up per game day: 2 + companies (3 for one company, #451)
  RESERVE:1,        // ... of which this many per company only for a spot at that company's side (issues #165, #451); the rest may be set far from it
  WAIT_MIN:360,     // game minutes a staged cast waits for the party before it gives up
  MEET_R:4.5,       // tiles: a member this close to the cast (or the spot) opens the scene
  SPOT_MIN:6, SPOT_MAX:10, // tiles from the member a cast that walks to them starts
  AHEAD_MIN:2.5, AHEAD_MAX:4, // tiles ahead of the member a trap or a strange place staged near them lies
  POLL_MS:5000,     // real ms: the table waits for the DM only if its runner polled table_call this recently
  REANCHOR:16,      // tiles: a walking cast left this far behind starts again nearer
  LVL_UP:2,         // a staged foe is at most this many levels above the party's average
  FAR:3,            // asking for more than this above the average is refused ("far above the party")
  PILE_HP:.35,      // no staged fight or trap while a member out in the field is below this share of HP
  TRAP_FLOOR:.1,    // a sprung trap never takes a member below this share of max HP
  PACK_MAX:6,       // foes in a staged ambush (a reinforcement included)
  MISS_MAX:2,       // missed at-the-table calls before the scripted DM fills the rest of the scene at once
  FRAME_MAX:280, TITLE_MAX:60, LINE_MAX:2000, NAME_MAX:32, // LINE_MAX: a technical ceiling for the DM's lines at the table, not a style limit (owner, #170)
  WANT_MAX:160, REVEAL_MAX:200, LABEL_MAX:60, REASON_MAX:160,
  PAST_KEEP:8,
  TOWN_WAIT_MIN:720, // game minutes a person staged in a town (at) waits there for the party
  TOWN_PAD:1,       // tiles round a town's walls that count as being in it (the scene opens when a member is there)
};
export const STAGE_KINDS=['elite','ambush','meeting','trap','mystery','social','interrogation']; // interrogation: a suspect questioned at the table (#431 slice 3, sim/interrogate.js)
const COMBAT_ACTS=['strike','guard','heal','potion','retreat'];
// The legal Table actions per kind: the DM may relabel them (cast.choices), never add to them.
export const STAGE_ACTS={elite:COMBAT_ACTS,ambush:COMBAT_ACTS,meeting:['hear','help','pass'],trap:['spot','disarm','round'],mystery:['study','search','leave'],social:['parley','press','leave'],interrogation:['ask','threaten','bargain','read','release','hand_over','watch']};
// The complications the DM may pick at the table (one per scene), per kind. 'none' and 'omen' change nothing but the words.
export const COMPLICATIONS={elite:['none','omen','falter','reinforce'],ambush:['none','omen','falter','reinforce'],meeting:['none','omen','rival'],social:['none','omen','rival'],trap:['none','omen','tremor'],mystery:['none','omen','tremor'],interrogation:['none','omen','rival']};
const COMP_ABOUT={none:'nothing changes',omen:'a sign or a sound, words only',falter:'the foe, if already below half its health, breaks off for a moment',reinforce:'one more foe of the pack (two levels under the party) joins',
  rival:'the person turns one step colder (the next words are harder)',tremor:'the place turns against them: the remaining rolls are 2 harder'};
const FIGHTING={elite:1,ambush:1,trap:1}; // kinds the pile-on rule guards
const STATIC={trap:1,mystery:1}; // kinds with no one to walk: they wait where the party passes
const SKILL={hear:'empathy',spot:'perception',disarm:'traps',round:'survival',study:'lore',search:'perception',parley:'persuasion',press:'intimidation'};
const ATT=['hostile','wary','neutral','friendly'],ATT_DC={hostile:3,wary:1,neutral:0,friendly:-2};
const NARRATOR={kind:'dm',name:'The Narrator'}; // the same stub sim/dmagent.js narrates with
const DAY=1440;
const gd=t=>({t,c:'gd'});
// Private LCG for flavour and spots: the gameplay RNG only rolls the dice of the scene itself.
let seed=0x51a6ed13;const r=()=>{seed=(Math.imul(seed,1103515245)+12345)&0x7fffffff;return seed/0x80000000};
const pickR=a=>a[Math.floor(r()*a.length)];
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f<>{}]+/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const cap=s=>s?s.charAt(0).toUpperCase()+s.slice(1):s;
const low=s=>s?s.charAt(0).toLowerCase()+s.slice(1):s;
const names=ids=>{const L=ids.map(id=>byId(id)).filter(Boolean).map(b=>b.name);return L.length<2?L.join(''):L.slice(0,-1).join(', ')+' and '+L[L.length-1]};
const byId=id=>S.agents.find(x=>x.id===id)||null;
const living=a=>a&&a.kind==='hero'&&a.state!=='dead';
const pct=a=>Math.round(100*a.hp/Math.max(1,maxHp(a)));
const mobOf=id=>S.mobs.find(m=>m.id===id)||null;
const npcOf=id=>(S.wanderers||[]).find(w=>w.id===id)||null;
const liveMob=m=>m&&m.alive&&!m.gone;
const gameDay=()=>Math.floor(S.gameMin/DAY);

export function stagedState(){return S.staged||(S.staged={seq:0,day:{d:-1,n:0,nw:0},cur:null,past:[],stats:{staged:0,met:0,expired:0,refused:0,calls:0,answered:0,filled:0,late:0,rejected:0}})}
// A spot at the Fellowship's side (issue #165): the day keeps STAGE.RESERVE of its scenes for these.
const nearFellow=at=>nearMember(focus(),at);
const dayCo=(cid)=>{const d=today();return ((d.c||{})[cid])||0};
const today=()=>{const G=stagedState();if(G.day.d!==gameDay())G.day={d:gameDay(),n:0,nw:0};return G.day};
const recById=id=>{const G=S.staged;return G&&G.cur&&G.cur.id===id?G.cur:null};
const recOf=sc=>sc&&sc.ctx&&sc.ctx.staged!=null?recById(sc.ctx.staged):null;
const field=()=>slotHeroes(slotted()).filter(a=>!a.hidden&&a.state!=='town');
// Companies (#451): a scene is staged for one company (rec.company; absent = the Fellowship). Its members, its party level.
const fiveCo=C=>!C||C===slotted()||!!C.slots;
const memOfCo=C=>fiveCo(C)?slotHeroes(slotted()):coMembers(C).filter(a=>a.kind==='hero');
const everyone=()=>{const out=slotHeroes(slotted()).slice();for(const C of companies())if(!fiveCo(C))for(const a of memOfCo(C))if(!out.includes(a))out.push(a);return out};
const recCo=rec=>rec&&rec.company!=null?companyById(rec.company):null;
const recMem=rec=>memOfCo(rec&&rec.company!=null?companyById(rec.company):null);
const coName=C=>fiveCo(C)?'the Fellowship':C.name||'company '+C.id;
const nearAny=at=>focuses().some(f=>nearMember(f,at));
const partyLvl=(L=slotHeroes(slotted()))=>{if(!L.length)return {avg:1,lo:1,hi:1,n:0};const ls=L.map(a=>a.lvl);return {avg:Math.round(ls.reduce((s,x)=>s+x,0)/ls.length),lo:Math.min(...ls),hi:Math.max(...ls),n:L.length}};
const band=z=>REGIONS[z]&&REGIONS[z].band?REGIONS[z].band:[1,99];

// ---- the DM log ----
// Entries name no heroes (heroes: []): the Fellowship's campaign log and memories (company.js readDm) take
// the scene from the Table's own outcome, in the world's words, never the DM's bookkeeping ("staged", reasons).
const LOG=(kind,summary,detail)=>dmlog(kind,null,summary,{by:'dm-agent',...detail},{heroes:[]});
// The call's contract, added to the refusals of a call shaped wrong (issue #401), so the next call can be right.
export const STAGE_USAGE='stage_scene takes: kind ('+STAGE_KINDS.join('|')+'), near ("fellowship", a member\'s name or id, "x,y", a place, a landmark or a region), frame (12-280 characters: what the heroes see as it begins), reason (one sentence for the DM log), title?, cast? (an object: name, title, foe, level, role, want, voice, attitude, faction, trap, place, reveal, item (an object the first prop of the frame holds, found with search), choices); with preview "true" only kind, near and reason are needed';
function refuse(why,a,usage){const err='Refused: '+why+(usage?'. '+STAGE_USAGE:'');if(a&&a.preview)return {ok:false,error:err}; // a preview stages nothing, so it leaves no trace
  const G=stagedState();G.stats.refused++;
  LOG('agent',['Staged scene refused: '+why+(a&&a.kind?' ('+clean(a.kind,12)+')':'')+'.'],{staged:null,kind:a&&a.kind?clean(a.kind,12):null,reason:clean(a&&a.reason,STAGE.REASON_MAX),result:'rejected: '+why});
  return {ok:false,error:err}}

// ---- where ----
// A free spot min-max tiles from c: ahead toward `toward` if it can, else around; in c's own region if it can
// (a cast staged near a member does not wait over a region border, in ground far above the party).
function spotNear(c,min,max,toward){const z0=zoneAt(c.x,c.y),R=q=>Math.round(q*10)/10;
  for(const same of [true,false]){
    if(toward){const dx=toward.x-c.x,dy=toward.y-c.y,d=Math.hypot(dx,dy),mid=(min+max)/2;
      if(d>3)for(const k of [mid,min,max,(mid+min)/2,(mid+max)/2]){const q={x:R(c.x+dx/d*Math.min(k,d)),y:R(c.y+dy/d*Math.min(k,d))};if(!spotErr(q)&&(!same||zoneAt(q.x,q.y)===z0))return q}}
    for(let i=0;i<40;i++){const ang=r()*6.283,d=min+r()*(max-min),q={x:R(c.x+Math.cos(ang)*d),y:R(c.y+Math.sin(ang)*d)};if(!spotErr(q)&&(!same||zoneAt(q.x,q.y)===z0))return q}}
  return null}
// near: '' / 'fellowship' / 'party' (the leader, or whoever is out in the field), a member's name or id,
// "x,y", a DM-placed place's name, or a region. Returns {hero?, at, label} or {err}.
function whereOf(near){const nt=nearText(near);if(nt.err)return {err:nt.err};const s=clean(nt.s,60),lo=s.toLowerCase();
  const cm=/^company\s*[:#]?\s*(\d+)$/.exec(lo),CO=cm?companies().find(c=>c.id===Number(cm[1])):companies().find(c=>!c.slots&&c.name&&c.name.toLowerCase()===lo);
  if(cm&&!CO)return {err:'no company '+cm[1]+' rides ('+companies().map(c=>c.id+(c.name?' '+c.name:'')).join(', ')+')'};
  if(CO){const F=memOfCo(CO).filter(a=>!a.hidden&&a.state!=='town'&&a.state!=='dungeon'),ld=fiveCo(CO)?leaderOfF():companyLead(CO),h=ld&&F.includes(ld)?ld:F[0];
    if(!h)return {err:coName(CO)+' is in town or out of reach; stage it near a place on their road, or when they ride out'};return {hero:h,company:CO}}
  if(!s||lo==='fellowship'||lo==='party'||lo==='the fellowship'){const F=field(),L=leaderOfF(),h=L&&F.includes(L)?L:F[0];
    if(!h)return {err:'the whole Fellowship is in town; stage it near a place on their road, or when they ride out'};return {hero:h}}
  const m=/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(s);if(m){const at={x:Number(m[1]),y:Number(m[2])},e=spotErr(at);return e?{err:'that spot is '+e+pointHint(s)}:{at,label:(nt.from?'off '+nt.from+' ':'')+'at '+m[1]+','+m[2]}}
  const h=everyone().find(a=>String(a.id)===s||a.name.toLowerCase()===lo);
  if(h){if(h.hidden||h.state==='town'||h.state==='dungeon')return {err:h.name+' is '+(h.state==='town'?'in town':'out of reach')+' right now'};return {hero:h}}
  if(S.agents.some(a=>a.name.toLowerCase()===lo||String(a.id)===s))return {err:'only the Fellowship meets staged scenes; '+s+' is not one of them'};
  const town=CITY.find(c=>c.name.toLowerCase()===lo);if(town){const tz=zoneAt(town.gate.x,town.gate.y);
    return {err:'a staged scene happens out in the world, not inside '+town.name+'; pick a road spot ("x,y") or a region'+(tz!=null&&tz>=0?' (near: "'+ZONES[tz]+'")':'')}}
  const pl=(S.places||[]).find(p=>p.name.toLowerCase()===lo);if(pl){const at=spotNear(pl,1,3)||{x:pl.x,y:pl.y};return {at,label:'at '+pl.name}}
  // a landmark (the Sunken Crypt, Kragmaw): the ground just outside it (issue #401)
  const lm=LANDMARKS.find(l=>{const n=l.name.toLowerCase();return n===lo||n.replace(/^the /,'')===lo.replace(/^the /,'')});
  if(lm){const e=(lm.exclude||0)+1,at=spotNear(lm,e,e+4);return at?{at,label:'near '+lm.name}:{err:'no open ground near '+lm.name}}
  const z=ZONES.findIndex(n=>n.toLowerCase()===lo);if(z>=0){const P=ZPTS[z]||[];if(!P.length)return {err:'no ground to stage on in '+ZONES[z]};
    let x=0,y=0;for(const p of P){x+=p.x;y+=p.y}const c={x:x/P.length,y:y/P.length},at=spotErr(c)?spotNear(c,1,6):{x:Math.round(c.x*10)/10,y:Math.round(c.y*10)/10};
    return at?{at,label:'in '+ZONES[z]}:{err:'no open ground in the middle of '+ZONES[z]}}
  const pls=(S.places||[]).map(p=>p.name).filter(Boolean).slice(0,8);
  return {err:'unknown place "'+s+'". near takes "fellowship", a member ('+everyone().map(a=>a.name).join(', ')+')'+(companies().length>1?', a company (company:<id>)':'')+', "x,y", a landmark ('+LANDMARKS.map(l=>l.name).join(', ')+')'+(pls.length?', a place ('+pls.join(', ')+')':'')+' or a region ('+ZONES.join(', ')+')'}}

// ---- the setting and the town (scene maps, issue #431 slice 2) ----
// A meeting or social scene may play in a room from data/settings.js (setting) and in a real town, at one of its
// buildings (at). The outdoor kinds keep the ground where they happen and ignore both, with a note.
export const INDOOR_STAGE={meeting:1,social:1,interrogation:1};
const SET_ALIAS={home:'house',cottage:'house',farmhouse:'house','back room':'tavern','tavern back room':'tavern',inn:'tavern',alehouse:'tavern',
  temple:'chapel',church:'chapel','interrogation cell':'cell','interrogation room':'cell',interrogation:'cell',prison:'cell',jail:'cell',gaol:'cell',
  ship:'hold',"ship's hold":'hold','ships hold':'hold',boat:'hold'};
const settingList=()=>SETTING_IDS.map(k=>{const n=low(SETTINGS[k].name.replace(/^an? /i,''));return n===k?k:k+' ('+n+')'}).join(', ');
// v: a settings key, its name ("a tavern back room") or a plain alias. {id} | {err} | {} when none was asked.
export function settingOf(v){if(v==null||v==='')return {};const s=clean(v,40).toLowerCase().replace(/^(an?|the)\s+/,'').replace(/[’]/g,"'");
  if(!s)return {};if(SETTINGS[s])return {id:s};
  const byName=SETTING_IDS.find(k=>SETTINGS[k].name.toLowerCase().replace(/^an?\s+/,'')===s);if(byName)return {id:byName};
  if(SET_ALIAS[s])return {id:SET_ALIAS[s]};
  return {err:'unknown setting "'+clean(v,40)+'"; setting takes one of: '+settingList()}}
// The buildings of a town a scene can be set at (the town spots of world/gen.js) and the words that name them.
const BLDG_ALIAS={inn:'inn',tavern:'inn',alehouse:'inn',smith:'smith',smithy:'smith',forge:'smith',quartermaster:'quartermaster',stores:'quartermaster',
  chapel:'chapel',temple:'chapel',church:'chapel',square:'square',market:'square','market square':'square',gate:'gate',gatehouse:'gate'};
const BLDG_SET={inn:'tavern',chapel:'chapel'}; // a building that is itself a setting
// at: a town ("Highgate"), or a building in it ("the inn in Highgate", "Highgate chapel", "Highgate, forge"). {town, spot} | {err} | {}.
export function atOf(v){if(v==null||v==='')return {};const s=clean(v,60).toLowerCase();if(!s)return {};
  const c=CITY.find(t=>s.includes(t.name.toLowerCase()));
  if(!c)return {err:'unknown town in at "'+clean(v,60)+'"; at takes a town ('+CITY.map(t=>t.name).join(', ')+'), optionally with a building ('+[...new Set(Object.values(BLDG_ALIAS))].join(', ')+'), such as "the inn in '+(CITY[0]?CITY[0].name:'town')+'"'};
  const rest=s.replace(c.name.toLowerCase(),' ').replace(/\b(the|in|at|of|by)\b|[,.]/g,' ').replace(/\s+/g,' ').trim();
  if(!rest)return {town:c,spot:null};
  const hit=Object.keys(BLDG_ALIAS).find(w=>new RegExp('\\b'+w+'\\b').test(rest)),k=BLDG_ALIAS[rest]||(hit?BLDG_ALIAS[hit]:null);
  if(!k||!c.spots||!c.spots[k])return {err:'no building "'+rest+'" in '+c.name+'; at takes '+c.name+' alone or one of its buildings: '+Object.keys(c.spots||{}).join(', ')};
  return {town:c,spot:k}}
// The room a meeting or social scene plays in when the DM names none (the scripted pick): the building it is set at
// (the inn: the tavern back room; the chapel), then the words of the title, frame, want and role (data/settings.js
// words), then a tavern back room for a meeting and a house for a social call. No dice.
export function fitSetting(kind,{spot,title,frame,want,role}={}){if(kind==='interrogation'&&!/\b(tavern|inn|cellar|chapel|house|hold|shrine)\b/i.test([title,frame].join(' ')))return 'cell'; // a suspect is questioned in a cell unless the words name another room
  if(spot&&BLDG_SET[spot])return BLDG_SET[spot];
  for(const w of [[title,frame].join(' '),[want,role].join(' ')])for(const id of SETTING_IDS)if(SETTINGS[id].words&&SETTINGS[id].words.test(w||''))return id;
  return kind==='interrogation'?'cell':kind==='meeting'?'tavern':'house'}
const inTown=(c,p)=>!!(c&&p)&&p.x>=c.x0-STAGE.TOWN_PAD&&p.x<=c.x1+1+STAGE.TOWN_PAD&&p.y>=c.y0-STAGE.TOWN_PAD&&p.y<=c.y1+1+STAGE.TOWN_PAD;
const townOf=n=>CITY.find(c=>c.name===n)||null;
// A place an interrogated suspect may give up (cast.place): a landmark, a region, a town or a marked place, by name.
function placeName(v){const lo=clean(v,60).toLowerCase().replace(/^the /,'');if(!lo)return null;const eq=n=>!!n&&String(n).toLowerCase().replace(/^the /,'')===lo;
  const l=LANDMARKS.find(x=>eq(x.name));if(l)return l.name;const z=ZONES.find(eq);if(z)return z;const c=CITY.find(x=>eq(x.name));if(c)return c.name;const p=(S.places||[]).find(x=>eq(x.name));return p?p.name:null}

// ---- staging (the DM tool stage_scene) ----
// a: {kind, near, frame, title?, cast:{name, title, foe, level, role, faction, attitude, want, voice, reveal, item, trap, place, choices:{act:label}}, reason} (cast.item: a give_item name the frame's first prop holds; search finds it)
export function stageScene(a){a=a&&typeof a==='object'?a:{};const G=stagedState(),F=slotted()||companies()[0]||null,seed0=seed,pv=a.preview===true||a.preview==='true';
  const kind=String(a.kind||'').toLowerCase().trim(),reason=clean(a.reason,STAGE.REASON_MAX);
  let cast=a.cast;if(typeof cast==='string'){try{cast=cast.trim()?JSON.parse(cast):{}}catch(e){cast=null}}if(cast==null)cast={};
  if(!STAGE_KINDS.includes(kind))return refuse('kind must be one of '+STAGE_KINDS.join(', '),a,1);
  if(typeof cast!=='object'||Array.isArray(cast))return refuse('cast must be an object such as {"foe":"wolf","name":"Greyjaw"}',a,1);
  if(!pv&&!reason)return refuse('a reason is required (one sentence, for the DM log)',a,1);
  const frame=clean(a.frame,STAGE.FRAME_MAX);if(!pv&&frame.length<12)return refuse('the frame (what the heroes see as it begins) is missing or too short',a,1);
  if(!F||!everyone().length)return refuse('no Fellowship rides in this world',a);
  if(!pv){
  if(S.table)return refuse('a Table scene is open; stage the next one when it is over',a);
  if(openProps().length)return refuse('a party vote is open; let them settle it first',a);
  if(G.cur&&G.cur.phase!=='done')return refuse('your staged '+G.cur.kind+' "'+G.cur.title+'" is still '+(G.cur.phase==='waiting'?'waiting for the party':'running')+'; one at a time',a);
  if(today().n>=STAGE.PER_DAY)return refuse(STAGE.PER_DAY+' staged scenes today already; the world needs room to breathe',a)}
  const multi=companies().length>1; // one company plays exactly as before (#451)
  if(!pv&&FIGHTING[kind]&&!multi){const h=slotHeroes(slotted()).find(b=>b.state!=='town'&&!b.hidden&&b.hp<maxHp(b)*STAGE.PILE_HP);
    if(h)return refuse(h.name+' of the Fellowship is badly hurt ('+pct(h)+'% HP) out in the field: no staged '+kind+' until they recover',a)}
  // the room and the town (#431): a meeting or social scene may name a setting and a town or building; the rest ignore them
  const notes=[],given=v=>v!=null&&v!=='';let setId=null,town=null,spot=null,named=false,picked=false;
  if(INDOOR_STAGE[kind]){const st=settingOf(a.setting);if(st.err)return refuse(st.err,a);setId=st.id||null;
    const tw=atOf(a.at);if(tw.err)return refuse(tw.err,a);
    if(tw.town){if(F.fac!=null&&tw.town.fac!=null&&tw.town.fac!==F.fac)return refuse(tw.town.name+' is an enemy town: the Fellowship would not be met there; pick one of their own ('+CITY.filter(c=>c.fac===F.fac).map(c=>c.name).join(', ')+')',a);
      town=tw.town;named=!!tw.spot;if(!setId){setId=fitSetting(kind,{spot:tw.spot,title:a.title,frame,want:cast.want,role:cast.role});picked=true}spot=tw.spot||(setId==='tavern'?'inn':setId==='chapel'?'chapel':'square')}}
  else if(given(a.setting)||given(a.at))notes.push('setting and at are for meeting and social scenes; '+(/^[aeiou]/.test(kind)?'an ':'a ')+kind+' plays on the ground where it happens, so '+(given(a.setting)&&given(a.at)?'both were':given(a.setting)?'setting was':'at was')+' ignored');
  const W=town?{at:{x:town.spots[spot].x,y:town.spots[spot].y},label:(named?'at the '+spot+' in ':'in ')+town.name}:whereOf(a.near);
  if(W.err)return refuse(W.err+(INDOOR_STAGE[kind]&&/in town|not inside/.test(W.err)?' (or, for a '+kind+' in town, pass at: the town or a building in it, such as "the inn in '+(focus()&&focus().town?focus().town.name:CITY[0].name)+'")':''),a,/^unknown place/.test(W.err));
  // the company this scene is for (#451): the one the hero belongs to, else whose member or hall it is set at; none = a world scene
  let cmp=W.company||(W.hero?companyOf(W.hero):null);
  if(!cmp&&!W.hero){const f=focuses().find(f=>nearMember(f,W.at)||(town&&f.town===town));cmp=f?f.company:null}
  const scope=cmp||(F&&!F.slots&&!slotted()?F:null),SM=scope?memOfCo(scope):slotHeroes(slotted()),P=partyLvl(SM.length?SM:everyone());
  let at=W.at,label=W.label;
  // a cast walks in from out of sight; a trap or a strange place lies just ahead, where they pass
  if(W.hero){at=STATIC[kind]?spotNear(W.hero,STAGE.AHEAD_MIN,STAGE.AHEAD_MAX,W.hero.dest||null):spotNear(W.hero,STAGE.SPOT_MIN,STAGE.SPOT_MAX,W.hero.dest||null);if(!at)return refuse('no open ground near '+W.hero.name,a);label='near '+W.hero.name}
  const z=town?zoneAt(town.gate.x,town.gate.y):zoneAt(at.x,at.y);if(z==null||z<0)return refuse('that spot is outside every region',a);
  if(!cmp){const f=focuses().find(f=>nearMember(f,at));if(f)cmp=f.company}
  const nco=Math.max(1,companies().length),forThem=nearAny(at)||!!cmp||!!(town&&focuses().some(f=>f.town===town));
  if(!pv&&!forThem&&(today().nw||0)>=STAGE.PER_DAY-STAGE.RESERVE*nco)return refuse('the last staged scene of the day is kept for '+(nco>1?'the companies’':'the Fellowship’s')+' own road; set this one near a member (near: "fellowship")',a);
  if(!pv&&cmp&&(multi||!fiveCo(cmp))){ // each company keeps its own staged scene of the day, and a staged fight waits for its own members to be well (#451)
    const wait=companies().filter(c=>c!==cmp&&!dayCo(c.id));if(today().n+wait.length>=STAGE.PER_DAY)return refuse('the last staged scene'+(wait.length>1?'s':'')+' of the day '+(wait.length>1?'are':'is')+' kept for '+wait.map(coName).join(' and ')+' first; '+coName(cmp)+' has had its share',a);
    if(FIGHTING[kind]){const h=SM.find(b=>b.state!=='town'&&!b.hidden&&b.hp<maxHp(b)*STAGE.PILE_HP);
      if(h)return refuse(h.name+' of '+coName(cmp)+' is badly hurt ('+pct(h)+'% HP) out in the field: no staged '+kind+' for them until they recover',a)}}
  if(!pv&&FIGHTING[kind]&&band(z)[0]>P.avg+STAGE.FAR)return refuse(ZONES[z]+' (levels '+band(z)[0]+'+) is far above the party (average level '+P.avg+')',a);
  // the cast
  const C={name:clean(cast.name,STAGE.NAME_MAX)||null,title:clean(cast.title,40)||null,want:clean(cast.want,STAGE.WANT_MAX)||null,voice:clean(cast.voice,60)||null,reveal:clean(cast.reveal,STAGE.REVEAL_MAX)||null,item:clean(cast.item,40)||null,mobs:[],npc:null,place:null};
  const labels={},ignored=[];
  if(cast.choices!=null){if(typeof cast.choices!=='object'||Array.isArray(cast.choices))return refuse('cast.choices must be an object {action: label}',a);
    for(const k in cast.choices){const kk=String(k).toLowerCase(),t=clean(cast.choices[k],STAGE.LABEL_MAX);if(STAGE_ACTS[kind].includes(kk)&&t)labels[kk]=t;else ignored.push(k)}}
  let lvl=null,foeKey=null;
  if(kind==='elite'||kind==='ambush'){
    const want=cast.level!=null?Math.round(Number(cast.level)):kind==='elite'?P.avg+1:P.avg;
    if(!Number.isFinite(want))return refuse('cast.level must be a number',a);
    if(want>P.avg+STAGE.FAR)return refuse('level '+want+' is far above the party (average level '+P.avg+'; at most '+(P.avg+STAGE.LVL_UP)+')',a);
    lvl=Math.max(1,Math.max(P.lo-3,Math.min(P.avg+(kind==='elite'?STAGE.LVL_UP:0),want)));
    if(cast.foe!=null&&cast.foe!==''){const f=String(cast.foe).toLowerCase().trim(),ks=Object.keys(MOBS).filter(k=>MOBS[k].z===z);
      foeKey=ks.find(k=>k.toLowerCase()===f)||ks.find(k=>MOBS[k].name.toLowerCase()===f)||null;
      if(!foeKey)return refuse('no '+clean(cast.foe,30)+' lives in '+ZONES[z]+' (there: '+[...new Set(ks.map(k=>MOBS[k].name))].join(', ')+')',a)}}
  // the creatures of a fight, decided before anything is spawned: a preview shows them, the frame is checked against them
  let plan=null;
  if(kind==='elite'){const type=foeKey||(buildEncounter('den',z,lvl,1,{rng:r,n:[1,1],lvlBand:[lvl,lvl],mono:true,variants:false}).foes[0]||{}).type||Object.keys(MOBS).find(k=>MOBS[k].z===z);
    if(!type)return refuse('no creature lives in '+ZONES[z],a);
    plan=[{type,lvl}]}
  else if(kind==='ambush'){const E=buildEncounter('road',z,P.avg,Math.max(2,P.n),{rng:r,n:[2,STAGE.PACK_MAX-1],lvlBand:[Math.max(1,P.avg-2),Math.max(1,P.avg)],mono:true,variants:false});
    if(!E.foes.length)return refuse('nothing in '+ZONES[z]+' could spring an ambush',a);
    plan=E.foes.map(f=>{if(foeKey)f.type=foeKey;f.lvl=Math.min(f.lvl,lvl+1);return f})}
  if(plan){plan.forEach(f=>{f.name=MOBS[f.type]?MOBS[f.type].name:f.name||f.type;f.family=(BESTIARY[f.type]&&BESTIARY[f.type].family)||f.family||''});
    if(pv){seed=seed0;return {ok:true,preview:true,kind,where:label+' in '+ZONES[z],...(notes.length?{setting_note:notes.join('; ')}:{}),region:ZONES[z],cast:castPlan(kind,plan),creatures:plan.map(f=>f.name+' (L'+f.lvl+')'),level:lvl,party_level:P.avg,
      people:planHasPeople(plan),note:'Nothing is staged yet. Write a frame that fits this cast (name the creature, or its kind such as '+famWords(plan).slice(0,3).join(', ')+'), then call stage_scene again without preview.'}}
    const bad=frameMisfit(frame,plan,cast.name,kind);if(bad){seed=seed0;return refuse(bad,a)}}
  else if(pv){const here=[...new Set(Object.keys(MOBS).filter(k=>MOBS[k].z===z).map(k=>MOBS[k].name))];
    return {ok:true,preview:true,kind,where:whereLine(label,z,town,setId),region:ZONES[z],cast:null,creatures_here:here,...(setId?{setting:setId}:{}),note:'A '+kind+' has no creature cast: you describe it with cast and frame. Nothing is staged.'+(notes.length?' Note: '+notes.join('; ')+'.':'')}}
  const rid=G.seq+1;
  if(kind==='elite'){const type=plan[0].type;
    const m=spawnFoe({type,roleOv:'leader',lvl,hpMul:1.5,hitMul:1.1});
    m.name=C.name||('The '+MOBS[type].name+' of '+ZONES[z]);if(C.title)m.title=C.title;m.named=true;place(m,at);m.staged=rid;C.mobs.push(m.id);C.name=m.name}
  else if(kind==='ambush'){
    plan.forEach((f,i)=>{const m=spawnFoe(f);place(m,{x:at.x+(i%3-1)*.8,y:at.y+Math.floor(i/3)*.8});m.staged=rid;C.mobs.push(m.id)});
    C.foe=MOBS[mobOf(C.mobs[0]).type].name;if(!C.name)C.name=C.foe+(C.mobs.length>1?' pack':'')}
  else if(kind==='meeting'||kind==='social'||kind==='interrogation'){const roles=WANDER_ROLES.map(x=>x.id),role=String(cast.role||'stranger').toLowerCase();
    if(!roles.includes(role))return refuse('cast.role must be one of '+roles.join(', '),a);
    const att=String(cast.attitude||(kind==='social'?'wary':kind==='interrogation'?'hostile':'neutral')).toLowerCase();if(!ATT.includes(att))return refuse('cast.attitude must be one of '+ATT.join(', '),a);
    const fac=String(cast.faction||'neutral').toLowerCase();
    if(!C.want&&kind!=='interrogation')return refuse('a '+kind+' needs cast.want: what this person wants from the party',a);
    if(kind==='interrogation'){if(!C.reveal)return refuse('an interrogation needs cast.reveal: what the suspect knows (the truth the dice may get out of them)',a);
      if(cast.place!=null&&cast.place!==''){const pn=placeName(cast.place);if(!pn)return refuse('cast.place must name a place they could learn of: a landmark ('+LANDMARKS.map(l=>l.name).join(', ')+'), a region ('+ZONES.join(', ')+'), a town or one of your marked places',a);C.place=pn}
      C.lie=clean(cast.lie,STAGE.REVEAL_MAX)||null}
    const res=pull('create_npc',{role,...(C.name?{name:C.name.slice(0,24)}:{}),faction:['concord','warband','neutral'].includes(fac)?fac:'neutral',...(town?{home:'town',town:town.name,spot}:{home:'camp',at}),attitude:att,hours:town?Math.ceil(STAGE.TOWN_WAIT_MIN/60)+6:12},{by:'dm-agent',reason:'staged '+kind+': '+reason});
    if(!res.ok)return refuse('the people lever said no: '+res.reason,a);
    const w=res.ret;w.staged=rid;if(C.want)w.want=C.want;C.npc=w.id;C.name=w.name;C.role=w.title;C.attitude=att}
  else if(kind==='trap'){const t=TRAPS.find(x=>x.id===String(cast.trap||'').toLowerCase())||pickR(TRAPS.filter(x=>x.dmg>0));
    C.trap={id:t.id,name:t.name,dmg:t.dmg};C.dc=8+Math.ceil(P.avg/2)+1;if(!C.name)C.name=cap(t.name)}
  else if(kind==='mystery'){const k=['shrine','cairn_door','ruin'].includes(String(cast.place||'').toLowerCase())?String(cast.place).toLowerCase():'shrine';
    const res=pull('mark_place',{kind:k,at,...(C.name?{name:C.name}:{}),hours:24},{by:'dm-agent',reason:'staged mystery: '+reason});
    if(res.ok){C.place=res.ret.id;C.name=res.ret.name}else if(!C.name)C.name='Something strange';
    C.dc=9+Math.ceil(P.avg/2)}
  G.seq=rid;today().n++;if(!nearAny(at))today().nw=(today().nw||0)+1;if(cmp){const c=today().c||(today().c={});c[cmp.id]=(c[cmp.id]||0)+1}G.stats.staged++;
  const title=clean(a.title,STAGE.TITLE_MAX)||defaultTitle(kind,C);
  const rec={id:rid,kind,title,frame,reason,near:{hero:W.hero?W.hero.id:null,label},...(cmp&&!cmp.slots?{company:cmp.id}:{}),at:{x:at.x,y:at.y},z,lvl,cast:C,labels,born:Math.round(S.gameMin),until:Math.round(S.gameMin+(town?STAGE.TOWN_WAIT_MIN:STAGE.WAIT_MIN)),phase:'waiting',scene:null,result:null,
    ...(setId?{setting:setId}:{}),...(town?{town:town.name,spot}:{})};
  const where=whereLine(label,z,town,setId);if(ignored.length)notes.push('choices must map to the legal actions: '+STAGE_ACTS[kind].join(', '));
  G.cur=rec;
  LOG('frame',['DM agent stages ',gd(kind),': ',gd(title),' '+where+(lvl!=null?' (level '+lvl+', party '+P.avg+')':'')+' - '+reason+'.'],
    {staged:rid,kind,title,frame,reason,cast:castLine(rec),at:rec.at,region:ZONES[z],lvl,party:P.avg,...(setId?{setting:setId,picked}:{}),...(town?{town:town.name,spot}:{}),...(Object.keys(labels).length?{labels}:{}),...(ignored.length?{ignored}:{})});
  return {ok:true,staged:rid,kind,title,where,at:rec.at,cast:castLine(rec),...(setId?{setting:setId,setting_name:SETTINGS[setId].name,...(picked?{setting_picked:'you named no setting; the game picked one that fits'}:{})}:{}),...(lvl!=null?{level:lvl,party_level:P.avg}:{}),
    choices:STAGE_ACTS[kind].map(k=>k+(labels[k]?' = '+labels[k]:'')),...(ignored.length?{ignored_choices:ignored}:{}),...(notes.length?{note:cap(notes.join('; '))+'.'}:{}),
    waits_until_h:Math.round((rec.until-rec.born)/60),scenes_today:today().n+'/'+STAGE.PER_DAY}}
// "A tavern back room in Highgate", "at the inn in Highgate", "near Kerin in Thornvale", "A house near Kerin in Thornvale".
function whereLine(label,z,town,setId){return town?(setId?SETTINGS[setId].name+' in '+town.name:label):(setId?SETTINGS[setId].name+' ':'')+label+' in '+ZONES[z]}
// ---- does the frame fit the cast? (issue #211) ----
// A frame that names people over a cast of beasts (or never names what comes) is refused with the actual cast,
// so the table never opens on "armed men" and then a boar. Lenient: a creature's name, any word of it (3+ letters,
// plural or not), its family word or a general word for creatures passes; people words are refused only when the cast has no people.
const PEOPLE=/\b(men|man|women|woman|people|folk|bandits?|brigands?|soldiers?|guards?|guardsm[ae]n|warriors?|raiders?|outlaws?|thugs?|cultists?|mercenar(?:y|ies)|sellswords?|robbers?|highwaym[ae]n|knights?|archers?|swordsm[ae]n|captains?|chieftains?|leader|boss|travell?ers?|villagers?|hooded|riders?)\b/i;
const FAM_WORDS={beast:['beast','animal'],vermin:['vermin','crawler','insect'],undead:['undead','dead','wight','ghoul','bones'],elemental:['elemental','stone','ember'],'brute-folk':['brute'],bandit:['bandit','raider'],wyrm:['wyrm','dragon','drake','serpent']};
const GENERIC=['creature','monster','pack','herd','brood','swarm','figure','shape','shadow','eyes','howl','growl','snort','claw','fang','hoof','tusk','paw','teeth','horn'];
const plural=n=>/(s|x|ch|sh)$/i.test(n)?n+'es':/fe?$/i.test(n)?n.replace(/fe?$/i,'ves'):n+'s';
const planHasPeople=plan=>plan.some(f=>f.family==='bandit'||PEOPLE.test(f.name));
const famWords=plan=>{const o=[];for(const f of plan){for(const w of f.name.toLowerCase().split(/\s+/))if(w.length>=3&&!o.includes(w))o.push(w);for(const w of FAM_WORDS[f.family]||[])if(!o.includes(w))o.push(w)}return o};
function castPlan(kind,plan){const g=new Map();for(const f of plan){const e=g.get(f.name)||{n:0,lo:99,hi:0};e.n++;e.lo=Math.min(e.lo,f.lvl);e.hi=Math.max(e.hi,f.lvl);g.set(f.name,e)}
  const parts=[...g].map(([n,e])=>(kind==='elite'?'a named '+n:e.n+' '+(e.n>1?plural(n):n))+' (L'+(e.lo===e.hi?e.lo:e.lo+'-'+e.hi)+')');
  return (kind==='ambush'?'a pack of ':'')+(parts.length<2?parts.join(''):parts.slice(0,-1).join(', ')+' and '+parts[parts.length-1])}
function frameMisfit(frame,plan,castName,kind){const f=' '+frame.toLowerCase().replace(/pack leader|herd leader|alpha|leader of the (pack|herd)/g,'pack')+' ';
  const words=famWords(plan).concat(GENERIC);if(castName)for(const w of castName.toLowerCase().split(/\s+/))if(w.length>=4&&!['the','old'].includes(w))words.push(w);
  const named=words.some(w=>f.includes(w)||f.includes(plural(w)))||plan.some(x=>f.includes(x.name.toLowerCase())||f.includes(plural(x.name).toLowerCase()));
  const ppl=!planHasPeople(plan)&&PEOPLE.exec(f);
  if(named&&!ppl)return null;
  const own=kind==='elite'?'Your elite is '+castPlan(kind,plan):'Your ambush is '+castPlan(kind,plan);
  return 'the frame does not fit the cast. '+own+(ppl?', not people: no "'+ppl[1]+'" in this scene':'')+'. Write the frame for '+(plan.length>1?'them':'it')+' (name the creature, or say '+famWords(plan).slice(0,3).join(', ')+') and try again, or call stage_scene with preview:true to see the cast first';
}
function place(m,p){m.x=p.x;m.y=p.y;m.home={x:p.x,y:p.y};m.spawn={x:p.x,y:p.y};m.dest=null;m.target=null;m.hpl=m.hp}
function defaultTitle(kind,C){return kind==='ambush'?'Ambush: '+C.name:kind==='trap'?'A trap on the road':kind==='mystery'?C.name:C.name||cap(kind)}
function castLine(rec){const C=rec.cast,out=[];
  for(const id of C.mobs){const m=mobOf(id);if(m)out.push((m.name||MOBS[m.type].name)+(m.title?', '+m.title:'')+' (L'+m.lvl+' '+MOBS[m.type].name+')'+(liveMob(m)?'':' - down'))}
  if(C.npc!=null){const w=npcOf(C.npc);out.push(C.name+(w?'':' (gone)'))}
  if(rec.kind==='trap')out.push(C.trap.name+' (DC '+C.dc+')');
  if(rec.kind==='mystery')out.push(C.name+' (DC '+C.dc+')');
  return out}
const anchorOf=rec=>{for(const id of rec.cast.mobs){const m=mobOf(id);if(liveMob(m))return m}if(rec.cast.npc!=null){const w=npcOf(rec.cast.npc);if(w)return w}return rec.at};

// ---- once per step, before the Table triggers (sim/table.js tableTick): walk, meet, expire ----
function tick(){const G=S.staged;if(!G||!G.cur)return false;const rec=G.cur;
  if(rec.phase==='open'){if(!findScene(sc=>sc.ctx&&sc.ctx.staged===rec.id))finish(rec,null,'the scene broke off');return false}
  if(rec.phase!=='waiting')return false;
  for(const id of rec.cast.mobs){const m=mobOf(id);if(m&&!m.alive&&!m.gone){m.gone=true;m.target=null}}
  const fight=rec.kind==='elite'||rec.kind==='ambush';
  if(S.gameMin>=rec.until||!recMem(rec).length||fight&&!rec.cast.mobs.some(id=>liveMob(mobOf(id)))||rec.cast.npc!=null&&!npcOf(rec.cast.npc)){expire(rec);return false}
  const T=rec.town?townOf(rec.town):null,A=anchorOf(rec),L=T?recMem(rec).filter(b=>living(b)&&!b.hidden&&inTown(T,b)):recMem(rec).filter(b=>!b.hidden&&b.state!=='town'); // set in a town (#431): whoever of them is in it
  // a staged fight or trap holds back while a member out in the field is badly hurt (the pile-on rule, at the meeting too)
  if(FIGHTING[rec.kind]&&L.some(b=>b.hp<maxHp(b)*STAGE.PILE_HP)){for(const id of rec.cast.mobs){const m=mobOf(id);if(liveMob(m)&&!m.target)m.dest=null}return false}
  // walk the cast to the member it was staged near (a cast left far behind starts again nearer)
  const h=rec.near.hero!=null?byId(rec.near.hero):null;
  if(h&&living(h)&&!h.hidden&&h.state!=='town'&&A!==rec.at){const d=dist(A,h);
    if(d>STAGE.REANCHOR){const q=spotNear(h,STAGE.SPOT_MIN,STAGE.SPOT_MAX,h.dest||null);if(q){let i=0;for(const id of rec.cast.mobs){const m=mobOf(id);if(liveMob(m))place(m,{x:q.x+(i%3-1)*.8,y:q.y+Math.floor(i/3)*.8});i++}
      const w=rec.cast.npc!=null?npcOf(rec.cast.npc):null;if(w){w.x=q.x;w.y=q.y;w.home={...q};w.post={...q};w.stroll=null}}}
    else{for(const id of rec.cast.mobs){const m=mobOf(id);if(liveMob(m)&&!m.target){m.home={x:h.x,y:h.y};m.dest={x:h.x,y:h.y}}}
      const w=rec.cast.npc!=null?npcOf(rec.cast.npc):null;if(w){w.home={x:h.x,y:h.y};w.stroll={x:h.x,y:h.y}}}}
  // the meeting
  const met=T?L[0]:L.find(b=>dist(b,A)<=STAGE.MEET_R||rec.cast.mobs.some(id=>{const m=mobOf(id);return liveMob(m)&&m.target===b}));
  if(!met)return false;
  if(S.table||openProps().length)return false; // the table is busy: the cast waits a moment longer
  return meet(rec,met)}

function meet(rec,a){const G=S.staged,F=slotted(),fight=rec.kind==='elite'||rec.kind==='ambush';G.stats.met++;
  if(fight){const mobs=rec.cast.mobs.map(mobOf).filter(liveMob),L=recMem(rec).filter(b=>!b.hidden);
    for(const m of mobs){let best=null,bd=1e9;for(const b of L){const d=dist(m,b);if(d<bd){bd=d;best=b}}if(!best)continue;
      m.target=best;m.dest=null;if(['hunt','travel','follow','return'].includes(best.state)){best.state='fight';best.target=m;best.dest=null}}
    if(F){const s=F.tableSeen||(F.tableSeen={});for(const m of mobs)s['elite:'+m.id]=S.gameMin}} // the elite trigger does not open the same foe twice
  const w=rec.cast.npc!=null?npcOf(rec.cast.npc):null;if(w){w.stroll=null;w.face=a.x>w.x?1:-1}
  LOG('frame',['Staged ',gd(rec.kind),' meets '+coName(recCo(rec))+': ',gd(rec.title),' ('+a.name+' in '+(ZONES[zoneAt(a.x,a.y)]||'the wilds')+').'],{staged:rec.id,kind:rec.kind,met:a.id});
  if(!tableOn()){finish(rec,null,'played out in the world (Table mode is off)');return false}
  rec.phase='open';
  const ctx={staged:rec.id,by:'dm-agent',labels:rec.labels,cast:castLine(rec),...(rec.setting?{setting:rec.setting}:{}),...(rec.town?{town:rec.town}:{}),...(fight?{mob:rec.cast.mobs.find(id=>liveMob(mobOf(id))),mobs:rec.cast.mobs.slice()}:{}),...(rec.cast.npc!=null?{npc:rec.cast.npc}:{}),dcUp:0,tally:{}};
  const pre={ids:recMem(rec).map(b=>b.id)};say(pre,rec.frame,NARRATOR); // the frame reaches the members as narration (#123), before any line of the scene
  ctx.anchor=a.id; // an everyone-at-once scene takes the members within shouting range of the one they met (#182)
  {const K=kindHooks(rec.kind);if(K&&K.stagedCtx)Object.assign(ctx,K.stagedCtx(rec,recMem(rec).filter(living)),{staged:rec.id})} // an interrogation's truth, lie and resolve (sim/interrogate.js, #431 slice 3)
  const sc=openScene(rec.kind,rec.title,[rec.frame],ctx);
  if(!sc){rec.phase='waiting';return false}
  rec.scene=sc.id;if(S.table===sc&&!sc.narr)sc.narr=pre.narr;setProps(sc,rec.cast.item); // the frame's props as data (#592)
  return false}

function expire(rec){const G=S.staged;G.stats.expired++;
  for(const id of rec.cast.mobs){const m=mobOf(id);if(m&&!m.gone){m.alive=false;m.gone=true;m.target=null}}
  LOG('abandon',['Staged ',gd(rec.kind),' ',gd(rec.title),' never met '+coName(recCo(rec))+'; the cast moves on.'],{staged:rec.id,kind:rec.kind,result:'expired'});
  rec.phase='done';rec.result='expired';retire(rec)}
// Take a staged scene back before the Table has opened it (issue #636, the DM's unstage): the cast walks off (mobs gone, a
// placed person sent away, a mystery's marker taken down), the scene is logged as unstaged. Refused once it is open.
export function unstage(which){const G=S.staged,rec=G&&G.cur&&G.cur.phase!=='done'?G.cur:null;
  if(!rec)return {ok:false,reason:'no staged scene is pending'};
  const w=which==null||which===''?null:String(which).trim().toLowerCase();
  if(w&&w!==String(rec.id)&&w!==String(rec.title).toLowerCase()&&w!==rec.kind)return {ok:false,reason:'your pending scene is #'+rec.id+' "'+rec.title+'" ('+rec.kind+'), not "'+clean(which,40)+'"'};
  if(rec.phase!=='waiting')return {ok:false,reason:'the Table has opened "'+rec.title+'"; it runs to its end'};
  for(const id of rec.cast.mobs){const m=mobOf(id);if(m&&!m.gone){m.alive=false;m.gone=true;m.target=null}}
  if(rec.cast.npc!=null){const wn=npcOf(rec.cast.npc);if(wn){const t=wn.lever!=null?takeBack(wn.lever):{ok:false};if(!t.ok&&S.wanderers.includes(wn))S.wanderers.splice(S.wanderers.indexOf(wn),1)}}
  if(rec.cast.place!=null){const pl=(S.places||[]).find(x=>x.id===rec.cast.place);if(pl&&pl.lever!=null){const t=takeBack(pl.lever);if(!t.ok)S.places.splice(S.places.indexOf(pl),1)}}
  G.stats.unstaged=(G.stats.unstaged||0)+1;
  LOG('abandon',['DM agent takes back staged ',gd(rec.kind),' ',gd(rec.title),'; the cast moves on.'],{staged:rec.id,kind:rec.kind,result:'unstaged'});
  rec.phase='done';rec.result='unstaged';retire(rec);
  return {ok:true,staged:rec.id,kind:rec.kind,title:rec.title}}
function finish(rec,sc,why){if(rec.phase==='done')return;rec.phase='done';rec.result=why||(sc&&sc.summary)||'done';
  for(const id of rec.cast.mobs){const m=mobOf(id);if(m&&!m.alive&&!m.gone){m.gone=true;m.target=null}}
  LOG('payoff',['Staged ',gd(rec.kind),' ',gd(rec.title),' ends: '+clean(rec.result,180)],{staged:rec.id,kind:rec.kind,result:rec.result,calls:sc&&sc.calls?sc.calls.map(c=>({kind:c.kind,by:c.by,...(c.pick?{pick:c.pick}:{})})):null,heroes:sc?sc.ids:[]});
  const F=slotted();if(F)F.tableDm=S.dmLogSeq||0; // the scene's own rolls do not reopen the table as a DM check
  if(sc&&(rec.kind==='meeting'||rec.kind==='social')&&rec.cast.npc!=null){const w=npcOf(rec.cast.npc);if(w&&w.attitude!=='hostile')talkFromScene(w,sc.ids)} // the members' next words go on with it (#170)
  retire(rec)}
function retire(rec){const G=S.staged;G.past.unshift({id:rec.id,kind:rec.kind,title:rec.title,day:Math.floor(rec.born/DAY)+1,result:rec.result});if(G.past.length>STAGE.PAST_KEEP)G.past.pop()}

// ---- at the table: the members' options, reflexes, dice and outcome for the new kinds ----
const nameOf=sc=>{const rec=recOf(sc);return rec?rec.cast.name:'them'};
const TEXT={hear:n=>'Hear '+n+' out',help:n=>'Offer '+n+' your help',pass:()=>'Nod and ride on',spot:()=>'Look for the trigger',disarm:()=>'Work the trap loose',round:()=>'Lead the others round it',
  study:()=>'Study the marks',search:()=>'Search the place',leave:()=>'Leave it be',parley:n=>'Talk '+n+' round',press:n=>'Lean on '+n};
const opts=k=>(sc,a)=>STAGE_ACTS[k].map(x=>({k:x,text:x==='leave'&&k==='social'?'Walk away':TEXT[x](nameOf(sc))}));
function dcOf(sc){const rec=recOf(sc),c=sc.ctx;let dc=rec&&rec.cast.dc||11;
  if(sc.kind==='meeting'||sc.kind==='social'){const w=npcOf(c.npc);dc=11+(ATT_DC[w?w.attitude:'neutral']||0)}
  return dc+(c.dcUp||0)}
function roll(sc,a,act,dc){const skill=SKILL[act],R=check(a,skill,dc,{nat:true});
  LOG('roll',[a.name+' rolls '+skill+' '+R.d20+(R.mod>=0?'+':'')+R.mod+' = '+R.total+' vs DC '+dc+(R.pass?': success':': failure')+' ('+sc.title+').'],
    {staged:sc.ctx.staged,sceneType:'staged',kind:sc.kind,act,skill,d20:R.d20,mod:R.mod,total:R.total,dc,pass:R.pass,hero:a.id});
  return R}
const res=R=>(R.pass?'success':'failure')+', '+R.total+' vs '+R.dc;
function spring(sc,a){const rec=recOf(sc),t=rec?rec.cast.trap:{dmg:.4,name:'the trap'},mh=maxHp(a),hit=Math.round(mh*t.dmg*.5),floor=Math.min(a.hp,Math.ceil(mh*STAGE.TRAP_FLOOR)),was=a.hp;
  a.hp=Math.max(floor,a.hp-hit);return Math.round(was-a.hp)}
function setAtt(w,att){if(!w)return;w.attitude=att}
function applyNew(sc,a,act){const k=act.k,T=sc.ctx.tally;T[k]=T[k]||{n:0,win:0,who:[]};T[k].n++;T[k].who.push(a.id);
  if(k==='pass'||k==='leave')return null;
  if(k==='help'){T.help.win++;return 'gives their word'}
  let dc=dcOf(sc);if(sc.kind==='trap'&&sc.ctx.spotted&&(k==='disarm'||k==='round'))dc-=2;
  const R=roll(sc,a,k,dc);if(R.pass){T[k].win++;(T[k].won||(T[k].won=[])).push(a.id)}
  // hearing someone out (#170): everyone listens; the roll is whether they caught what lies under the words
  if(k==='hear'){const rec=recOf(sc),n=nameOf(sc),w=rec&&(rec.cast.reveal||rec.cast.want),d=' ('+R.total+' vs '+R.dc+')';
    if(R.pass){notify(a,'You read '+n+(w?': '+w:'')+'.',true);if(w)remember(a,'table','At '+sc.title+' I understood '+n+': '+w);return 'understood '+n+(w?': '+w:'')+d}
    notify(a,'You heard '+n+' out, but missed what lies under the words.',true);return 'listened, but missed what '+n+' truly wants'+d}
  if(sc.kind==='trap'){if(k==='spot'&&R.pass)sc.ctx.spotted=true;if(k==='disarm'){if(R.pass)sc.ctx.disarmed=true;else{const h=spring(sc,a);sc.ctx.sprung=(sc.ctx.sprung||[]).concat(a.id);return res(R)+'; it springs on them (-'+h+')'}}
    if(k==='round'&&R.pass)(sc.ctx.safe||(sc.ctx.safe=[])).push(a.id)}
  if(sc.kind==='mystery'&&R.pass&&!sc.ctx.found){sc.ctx.found=a.id;const rec=recOf(sc),t=rec&&rec.cast.reveal||pickR(REVEALS);sc.ctx.reveal=t;
    remember(a,'table','At '+sc.title+' I found: '+t);notify(a,'You find something at '+sc.title+': '+t,true)}
  return res(R)}
function reflexNew(sc,a){const k=sc.kind,hurt=a.hp<maxHp(a)*.3;
  if(k==='meeting')return slotKeyOf(a)==='healer'?'help':'hear';
  if(k==='social')return hurt?'leave':socialSkill(a)==='intimidation'?'press':'parley';
  if(k==='trap')return a.cls==='Rogue'?'disarm':a.cls==='Hunter'&&!sc.ctx.spotted?'spot':'round';
  if(k==='mystery')return a.cls==='Mage'||a.cls==='Priest'?'study':'search';
  return null}
function outcomeNew(sc){const rec=recOf(sc),T=sc.ctx.tally,w=npcOf(sc.ctx.npc),n=nameOf(sc),win=x=>T[x]?T[x].win:0;
  if(sc.kind==='meeting'){const helped=win('help'),heard=win('hear'),H=T.hear||{who:[],won:[]},got=H.won||[],missed=H.who.filter(id=>!got.includes(id)),want=rec&&rec.cast.want;
    const att=helped?'friendly':heard?(w&&ATT.indexOf(w.attitude)<2?'neutral':w?w.attitude:'neutral'):w?w.attitude:'neutral';setAtt(w,att);
    if(helped&&rec&&rec.cast.want)for(const id of sc.ids){const b=byId(id);if(living(b))remember(b,'table','We gave our word to '+n+': '+rec.cast.want+'.')}
    const parts=[];if(helped)parts.push(names(T.help.who)+' gave '+n+' their word ('+(want||'as asked')+')');if(got.length)parts.push(names(got)+' understood '+n+(want&&!helped?' ('+want+')':''));
    if(missed.length)parts.push(names(missed)+' listened but missed the point');
    return parts.length?parts.join('; ')+'.'+(helped?'':heard?' '+n+' is glad to be heard, and watches them go.':' '+n+' watches them go.'):n+' watches them ride on.'}
  if(sc.kind==='social'){const p=win('parley'),q=win('press'),tried=(T.parley?T.parley.n:0)+(T.press?T.press.n:0);
    const cur=w?w.attitude:'neutral',i=ATT.indexOf(cur);
    let att=cur,t;if(p){att='friendly';t=n+' comes round.'}else if(q){att=i>1?'wary':cur;t=n+' gives way, and will not forget it.'}else if(tried){att=ATT[Math.max(0,i-1)];t=n+' is not moved, and likes them less for trying.'}else t='They walk away from '+n+'.';
    setAtt(w,att);if((p||q)&&rec&&rec.cast.reveal){sc.ctx.reveal=rec.cast.reveal;say(sc,rec.cast.reveal,w?npcFrom(w):NARRATOR)}
    return t}
  if(sc.kind==='trap'){if(sc.ctx.disarmed)return 'The trap is undone'+(sc.ctx.sprung?' (it caught '+sc.ctx.sprung.map(id=>byId(id)).filter(Boolean).map(b=>b.name).join(' and ')+' first)':'')+'.';
    const safe=sc.ctx.safe||[],sprung=sc.ctx.sprung||[];let v=null;for(const id of sc.ids){const b=byId(id);if(living(b)&&!b.hidden&&!safe.includes(id)&&!sprung.includes(id)){v=b;break}}
    if(!v)return 'They go round it, every one.';
    const R=roll(sc,v,'round',dcOf(sc)-(sc.ctx.spotted?2:0));if(R.pass)return 'It springs, and '+v.name+' is out of the way in time.';
    const h=spring(sc,v);return 'It springs on '+v.name+' (-'+h+').'}
  if(sc.kind==='mystery')return sc.ctx.found?byId(sc.ctx.found).name+' finds something: '+sc.ctx.reveal:'The place keeps its secret.';
  return ''}
for(const k of ['meeting','trap','mystery','social'])setSceneKind(k,{options:opts(k),reflex:reflexNew,apply:applyNew,outcome:outcomeNew});

// ---- at-the-table DM calls ----
// A call is put to the DM agent (table_call / table_answer); the Table waits up to TABLE.dmMs for it at
// 1x (sim/table.js), then the scripted DM fills it. At 3x/8x, or once the DM has missed MISS_MAX calls in
// a scene, the scripted DM fills at once.
const push=(sc,c)=>{const G=stagedState();(sc.calls||(sc.calls=[])).push({id:sc.callSeq=(sc.callSeq||0)+1,t:0,done:false,by:null,...c});G.stats.calls++};
function onFrame(sc){const rec=recOf(sc);if(!rec)return;const C=rec.cast,w=npcOf(C.npc),m=C.mobs.map(mobOf).find(liveMob);
  push(sc,{kind:'voice',who:w?C.name:m?m.name||MOBS[m.type].name:'the narrator',
    about:w?'Voice '+C.name+' as the scene opens: one line they say out loud'+(C.want?' (they want: '+C.want+')':'')+(C.voice?', in this voice: '+C.voice:'')+'.':
      m?'Describe '+(m.name||MOBS[m.type].name)+' (level '+m.lvl+(C.mobs.length>1?', with '+(C.mobs.length-1)+' more':'')+') as it comes on: one line of what the heroes see and hear (a creature, not a person; the cast is '+castLine(rec).join('; ')+').':
      'Describe '+C.name+' as the heroes reach it: one line of what they see, hear or smell.'})}
function onBeat(sc,b){const rec=recOf(sc);if(!rec)return;
  push(sc,{kind:'outcome',beat:sc.beats.length-1,who:b.name,about:b.name+' chose to '+low(b.text)+(b.res?' ('+b.res+')':'')+(b.line?' and said "'+b.line+'"':'')+'. Describe what happens, one line, true to the result.'});
  if(!sc.complicated&&sc.beats.length>=Math.max(1,Math.floor(sc.ids.length/2))){sc.complicated=true;const L=COMPLICATIONS[sc.kind];
    push(sc,{kind:'complication',legal:L.slice(),about:'Pick one complication for the rest of the scene from: '+L.map(x=>x+' ('+COMP_ABOUT[x]+')').join('; ')+'. Add one line of what the heroes notice.'})}}
// Everyone answered at once (sim/table.js PLAY 'all'): one call to narrate the combined result, then the complication.
function onAll(sc){const rec=recOf(sc);if(!rec||!sc.beats.length)return;
  push(sc,{kind:'outcome',beat:'all',who:'the party',about:'Everyone answered at once: '+sc.beats.map(b=>b.name+' chose to '+low(b.text)+(b.res?' ('+b.res+')':'')+(b.line?' and said "'+b.line+'"':'')).join('; ')+'. Describe what happens to them together, one or two lines, true to every result.'});
  if(!sc.complicated){sc.complicated=true;const L=COMPLICATIONS[sc.kind];
    push(sc,{kind:'complication',legal:L.slice(),about:'Pick one complication for the end of the scene from: '+L.map(x=>x+' ('+COMP_ABOUT[x]+')').join('; ')+'. Add one line of what the heroes notice.'})}}
// The table waits for the DM while its runner is listening (it polled table_call within POLL_MS of real time, or the host
// says a runner holds the seat), at most TABLE.dmMs a call and STAGE.MISS_MAX missed calls a scene; then the DM's reflexes
// (the scripted lines below) fill it (sim/dmreflex.js, #561). A runner that went away gets the reflexes at once.
const live=sc=>tableLive(sc,STAGE.MISS_MAX,STAGE.POLL_MS); // any staged scene, whoever staged it (#561: the DM is always an agent)
const npcFrom=w=>({kind:'npc',id:w.id,name:w.name,fac:w.fac});
// A DM line at the table: every member at the scene hears it (their chat, so events and chat_read), the banner shows it.
function say(sc,text,from){const t=clean(text,STAGE.LINE_MAX);if(!t)return;const e={t:clockStr(),d:dayNo(),from,text:t,scene:true,trigger:from.kind==='dm'?'dm':'npc',...(from.kind==='dm'?{dm:true}:{}),fh:true};
  for(const id of sc.ids){const b=byId(id);if(!living(b))continue;(b.chat||(b.chat=[])).push(e);if(b.chat.length>CHAT_CAP)b.chat.shift()}
  if(from.kind==='npc'){const w=npcOf(from.id);if(w)w.bubble={text:t,life:BUBBLE,fh:true}}
  sc.narr={t:e.t,text:(from.kind==='npc'?from.name+': ':'')+t}}
const VOICE={elite:['{n} lowers its head and comes on, unhurried.','{n} steps out of the brush and does not look away.'],ambush:['Shapes break from cover on both sides of the road.','The brush moves all at once: they were waiting.'],
  trap:['Something about the ground ahead is wrong.','A thin line glints across the path, then is gone.'],mystery:['The air at {n} is still, and older than it should be.','Old marks cover {n}, worn but not forgotten.']};
const OMENS=['A crow calls twice and goes quiet.','The wind drops all at once.','Far off, a bell rings once.','The light turns the colour of old brass.'];
const REVEALS=['The marks name a family that ruled here before the towns.','A cold draught from the stones points north, toward older ruins.','Under the moss, a sign of the old road wardens: safe water within a mile.'];
function fill(sc,c){const rec=recOf(sc),G=stagedState(),n=rec?rec.cast.name:'the foe';let text='',pick=null,from=NARRATOR;
  if(c.kind==='voice'){const w=rec&&npcOf(rec.cast.npc);if(w){from=npcFrom(w);text=rec.cast.want?'Hear me out. I need someone to '+low(rec.cast.want).replace(/[.!?]+$/,'')+'.':'Well met, travellers.'}
    else text=pickR(VOICE[sc.kind]||VOICE.mystery).replace('{n}',c.who||n)}
  else if(c.kind==='outcome'){if(c.beat==='all')text=clean(sc.beats.map(b=>b.name+' '+low(b.text)+(b.res?' ('+b.res+')':'')).join('; ')+'.',STAGE.LINE_MAX);
    else{const b=sc.beats[c.beat];text=b?b.name+' moves: '+low(b.text)+(b.res?' - '+b.res:'')+'.':''}}
  else if(c.kind==='complication'){pick=r()<.3?'omen':'none';text=pick==='omen'?pickR(OMENS):''}
  resolve(sc,c,{text,pick,by:'scripted',from});G.stats.filled++}
function resolve(sc,c,{text,pick,by,from}){c.done=true;c.by=by;c.text=text||'';if(pick)c.pick=pick;
  let effect=null;if(c.kind==='complication')effect=complicate(sc,c.pick||'none');
  if(text)say(sc,text,from||NARRATOR);
  LOG('agent',['At the table ('+c.kind+(c.pick?': '+c.pick:'')+'): ',text||'-',by==='scripted'?' [scripted fill]':''],{staged:sc.ctx.staged,call:c.kind,pick:c.pick||null,text,effect,...(by==='scripted'?{by:'scripted',fill:true,why:fillWhy(c)}:{})})} // every reflex fill is logged (#561)
function complicate(sc,pick){const rec=recOf(sc),c=sc.ctx;
  if(pick==='falter'){const m=(c.mobs||[]).map(mobOf).find(liveMob);if(m&&m.hp<m.maxhp*.5){m.fled=2.5;return (m.name||MOBS[m.type].name)+' breaks off for a moment'}return 'the foe stands firm (above half its health)'}
  if(pick==='reinforce'){if(!rec)return null;const alive=(c.mobs||[]).map(mobOf).filter(liveMob);if(!alive.length||alive.length>=STAGE.PACK_MAX)return 'nothing more comes';
    const f=alive[0],P=partyLvl(recMem(rec)),m=spawnFoe({type:f.type,lvl:Math.max(1,P.avg-2)});place(m,{x:f.x+.8,y:f.y+.6});m.staged=rec.id;rec.cast.mobs.push(m.id);c.mobs.push(m.id);
    const L=recMem(rec).filter(b=>!b.hidden);let best=null,bd=1e9;for(const b of L){const d=dist(m,b);if(d<bd){bd=d;best=b}}if(best)m.target=best;
    c.cast=castLine(rec);return 'one more '+MOBS[m.type].name+' (L'+m.lvl+') joins'}
  if(pick==='rival'){const w=npcOf(c.npc);if(w){const i=ATT.indexOf(w.attitude);w.attitude=ATT[Math.max(0,i-1)];return w.name+' turns '+w.attitude}return null}
  if(pick==='tremor'){c.dcUp=(c.dcUp||0)+2;return 'the remaining rolls are 2 harder'}
  return null}
function done(sc){const rec=recOf(sc);if(rec)finish(rec,sc,sc.summary||null)}
setStageHooks({tick,onFrame,onBeat,onAll,fill,live,done}); // a kind with its own DM voice (an interrogation, sim/interrogate.js) hands its end back through table.js stageDone

// ---- the DM tools ----
// table_call: what the table asks of the DM right now (the pending call, the scene) and the staged scene's state.
export function tableCall(){heard('table');const G=S.staged,rec=G&&G.cur&&G.cur.phase!=='done'?G.cur:null,sc=findScene(x=>x.ctx&&x.ctx.staged!=null);
  const c=sc&&sc.calls?sc.calls.find(x=>!x.done):null;
  const out={ok:true,staged:rec?{id:rec.id,kind:rec.kind,title:rec.title,phase:rec.phase,near:rec.near.label,cast:castLine(rec),hours_left:Math.max(0,Math.round((rec.until-S.gameMin)/60))}:null,
    scene:sc?{title:sc.title,kind:sc.kind,frame:rec?rec.frame:'',order:sc.ids.map(byId).filter(Boolean).map(b=>b.name+' (L'+b.lvl+' '+b.cls+', '+pct(b)+'% HP)'),
      so_far:sc.beats.map(b=>b.name+': '+b.text+(b.res?' ('+b.res+')':'')),said:(sc.calls||[]).filter(x=>x.done&&x.text).slice(-4).map(x=>x.text),cast:sc.ctx.cast||[]}:null,
    call:null};
  if(c){const waiting=sc.pause&&live(sc);out.call={id:c.id,kind:c.kind,about:c.about,...(c.legal?{legal:c.legal}:{}),...(c.who?{who:c.who}:{}),
    seconds_left:waiting?Math.max(0,Math.round((TABLE.dmMs/1000-c.t)*10)/10):0,max_chars:STAGE.LINE_MAX}}
  return out}
// table_answer: {call, text, pick}. Late, unknown or illegal answers are refused (and counted); the slot stays the scripted DM's.
export function tableAnswer(a){a=a&&typeof a==='object'?a:{};const G=stagedState(),sc=findScene(x=>x.ctx&&x.ctx.staged!=null);
  const id=Math.round(Number(a.call)),text=clean(a.text,STAGE.LINE_MAX),pick=a.pick!=null?String(a.pick).toLowerCase().trim():null;
  const no=(why,late)=>{if(late)G.stats.late++;else G.stats.rejected++;
    LOG('agent',['At the table: answer refused: '+why+'.'],{staged:sc?sc.ctx.staged:null,call:id||null,result:'rejected: '+why},[]);return {ok:false,error:why}};
  if(!sc)return no('no staged scene is at the table now',true);
  const c=(sc.calls||[]).find(x=>x.id===id);if(!c)return no('no call '+(a.call==null?'':a.call)+' in this scene (see table_call)');
  if(c.done)return no('too late: the '+(c.by==='scripted'?'scripted DM':'DM')+' already answered call '+id,true);
  if(c.kind==='complication'){if(!pick||!c.legal.includes(pick))return no('pick must be one of '+c.legal.join(', '))}
  else if(!text)return no('say something');
  const rec=recOf(sc),w=rec&&npcOf(rec.cast.npc);
  resolve(sc,c,{text,pick:c.kind==='complication'?pick:null,by:'dm-agent',from:c.kind==='voice'&&w?npcFrom(w):NARRATOR});G.stats.answered++;
  return {ok:true,call:id,kind:c.kind,said:text,...(c.pick?{pick:c.pick}:{}),next:(sc.calls||[]).some(x=>!x.done)?'another call is waiting (table_call)':null}}
// For dm_status and the panels.
// settings: the rooms a meeting or social scene can be set in (stage_scene setting) and how to set one in a town (at).
export const SETTINGS_NOTE='A meeting or social scene can play in a room: stage_scene setting (one of the keys in settings) and at (a town of theirs, or a building in it: inn, smith, quartermaster, chapel, square, gate), such as at "the inn in '+(CITY[0]?CITY[0].name:'town')+'" with setting "tavern". Name no setting and the game picks one that fits. Elite, ambush, trap and mystery play on the ground where they happen and ignore both.';
const settingRows=()=>Object.fromEntries(SETTING_IDS.map(k=>[k,SETTINGS[k].name]));
export function stagedView(){const G=S.staged;if(!G)return {today:'0/'+STAGE.PER_DAY,cur:null,settings:settingRows(),settings_note:SETTINGS_NOTE};const rec=G.cur&&G.cur.phase!=='done'?G.cur:null;
  return {today:(G.day.d===gameDay()?G.day.n:0)+'/'+STAGE.PER_DAY,cur:rec?{id:rec.id,kind:rec.kind,title:rec.title,phase:rec.phase,near:rec.near.label,hours_left:Math.max(0,Math.round((rec.until-S.gameMin)/60)),...(rec.setting?{setting:rec.setting}:{}),...(rec.town?{town:rec.town}:{})}:null,
    settings:settingRows(),settings_note:SETTINGS_NOTE,
    past:G.past.slice(0,4).map(p=>({kind:p.kind,title:p.title,day:p.day,result:p.result}))}}
