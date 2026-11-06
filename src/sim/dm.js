// The DM (issue #63, epic #62): turns the living world into adventures and runs them for
// parties and solo heroes. An adventure is a hook (a job posted by a townsperson, a rumour,
// an oath, a grave, a robbed wagon) plus 3-5 scenes on real map points, resolved with d20
// rolls; failures carry forward (wounds, lost time, a hostile stranger, monsters in the
// night) and the payoff changes the world (gold, gear, honor, bonds, oath progress, a
// timeline entry, sometimes a follow-up hook). Templates live in data/adventures.js.
// Owned by ai-designer.
//
// ---- the DM as a policy ----
// Four decision slots, mirroring sim/brain.js. SCRIPTED_DM is the rule-of-thumb DM written
// here; a later phase plugs a model-backed DM in with setDmPolicy(). Every slot answer is
// validated, and a missing, late or illegal answer falls back to the scripted one, so the
// sim never waits on a model.
//   pickHook(a, hooks, mem)          which open hook a departing leader takes (or null)
//   frameScene(adv, sc, ctx)         the scene's opening clause (parts) for the narration
//   chooseComplication(adv, sc, roll) what a roll brings: wound|late|hostile|ambush|boon|item|null
//   resolveBranch(adv, sc)           'a' (the bold road) or 'b' (the careful one) at a choice
//
// ---- state (plain JSON, saved as-is) ----
// S.adventures: hooks ({phase:'open'}), running adventures ({phase:'active'}) and the last
// few finished ones ({phase:'done'}). Heroes and mobs are referred to by id only. A hero on
// an adventure has a.adv = adventure id; a monster spawned for one has m.adv = id.
// S.dmStats: counters for the headless report. S.dmSeen: deaths and encounters already
// turned into hooks.
//
// ---- how it runs ----
// The leader drives: a solo hero, or a party's leader ("the leader's adventure is the
// party's"). Followers keep to the follow state and join the fights (party.js), so the
// party's contact with the world is unchanged. heroes.js hands three moments to the DM:
//   dmDepart(a,c)  town gate: take a hook or resume a running adventure (true = handled)
//   dmTravel(a,dt) travel case: walk to the scene point, then resolve the scene
//   dmHunt(a,dt)   hunt case: target this scene's foes, sit out a rest, or set off again
// Every other state (fight, duel, return, follow) is the ordinary one: an adventure fight
// is a real fight with the usual caution, and a hero who goes home (flee, wounds, a party
// heading back) simply resumes the adventure from the same scene on the next trip out.
import {rnd,ri,clamp,pickA} from '../core/rng.js';
import {W,H,ROAD} from '../world/tiles.js';
import {tiles,I,ZONES,REGIONS,CITY,LANDMARKS,CRYPT,ZPTS,zoneAt,dist} from '../world/map.js';
import {standAt} from '../world/passable.js';
import {MOBS} from '../data/mobs.js';
import {homeOf} from '../data/races.js';
import {tm} from '../data/traits.js';
import * as D from '../data/adventures.js';
import {S,loreSides,ownTown} from './state.js';
import {log,gold} from './chronicle.js';
import {pop} from './effects.js';
import {maxHp,gainXp,moveTo,goHome,huntZone,xpNeed,getEpic} from './heroes.js';
import {spawnMob} from './mobs.js';
import {buildEncounter,spawnFoe} from './encounterbuilder.js';
import {blockOf,NAMED_KITS,ROLES} from '../data/bestiary.js';
import {partyMates} from './party.js';
import {checkEncounter} from './encounters.js';
import {isStorm} from './weather.js';
import {record,timeline,first} from './history.js';
import {bondEvent} from './bonds.js';
import {goalEvent} from './goals.js';
import {makeItem,equip,weakestSlot,slotLevel} from './gear.js';
import {addGear,addQuest,hasQuestFor,dropQuest} from './inv.js'; // quest items an adventure carries (sim/inv.js)
import {jobDone} from './questlog.js'; // several quests per hero (the quest log)
import {say} from './chat.js';
import {focus,focuses,focusFor,ffFor,fairness,FOCUS} from './dmfocus.js'; // the Fellowship first (issue #165), every company a thread (#450)
import {takeChance,focusOf,focusCount} from './guildfocus.js'; // a Wayfaring guild's leaders take hooks more readily (#6)
import {d20} from './narrator.js';
import {bestFor,socialSkill,SKILLS} from './abilities.js';
import {dmlog} from './dmlog.js';
import {pull,ready,spotErr,attitudeDc,activeOf} from './levers.js';
import {GOODS} from '../data/items.js';
import {playerBranch} from './player-choice.js';
import {isSolo,inSlots} from './company.js';
import {hasLinks} from './runlink.js';
import {supplyPlan,notePosted} from './supply.js'; // goods jobs: the board asks for crafted or gathered goods (#720)
import {onWorld} from './kept.js';

// ---- knobs ----
export const K={
  FLOOR:1,              // posted hooks an outlying board keeps while the Fellowship has nothing under way (issue #165)
  SOLO_PAY:.75,         // gold multiplier of a solo-sized job (a party of five is paid per head for the same template; #447)
  HOOKS:3,              // posted hooks per town (personal ones, for one hero's oath or a follow-up, come on top)
  HOOK_LIFE:[1440,2880],// game minutes a hook stays posted (one to two game days)
  LEAD:120,             // game minutes before FOCUS.STARVE_MIN that a company in the field is served, so no gap passes it (#530)
  REFILL:5,             // real seconds between hook refills
  TAKE:.9,              // chance a departing leader with a fitting hook takes one
  MIN_LVL:4,            // nobody below this level is offered an adventure
  MAX_DAYS:3,           // game days before an unfinished adventure goes cold
  RETREAT:.45,          // hunt retreat share of max HP (scaled by the retreat trait), as in heroes.js
  CAMP:.6,              // below this share of max HP between scenes, the party camps in place
  CAMP_T:[10,16],       // real seconds a camp lasts
  REST_T:[40,60],       // real seconds a rest scene lasts (4-6 game hours: a night's camp)
  REGEN:.06,            // share of max HP per real second while camping or resting
  WALK_REGEN:.015,      // share of max HP per real second walking between scenes
  SPEED:2.4,            // travel speed, as travel in heroes.js
  FIRST:.7,             // a won initiative roll leaves the foes at this share of their HP
  CHECK_XP:.35,         // a passed roll is worth this many zone kills of XP to each member
  PAY_XP:.35,           // scales every template's pay.xp: adventures carry levelling now that kill-N bounties are optional (#67; was .3)
  GONE:240,             // game minutes a finished adventure stays on S.adventures
  KEEP_DONE:24,         // finished adventures kept at most
  TOLD:2,               // adventures the Chronicle follows beat by beat at once
  ENEMY_GATE:15,        // tiles any scene point keeps from an enemy town gate
  GATE_CLEAR:10,        // tiles a road point keeps from every gate
  STRANGER:.5,          // chance an angered stranger stays on the road as a hostile camp (create_npc)
};
const OUT={success:1,partial:.5,failure:0};
const NAR={t:'',c:'nar'},dmS=t=>({t,c:'dm'}),gd=t=>({t,c:'gd'});

// ---- the scripted DM ----
export const SCRIPTED_DM={
  // Personal hooks (an oath, a follow-up) first; then the job that suits the party's temper:
  // bold or reckless leaders like fights, cautious ones like roads and talk.
  pickHook(a,hooks,mem){if(!hooks.length)return null;
    const mine=hooks.filter(h=>h.for!=null&&mem.some(b=>b.id===h.for));if(mine.length)return mine[0];
    if(rnd()>takeChance(a,K.TAKE))return null;
    const bold=tm(a,'bold')>1||tm(a,'retreat')<1,careful=tm(a,'retreat')>1;
    const w=h=>{const f=fightShare(h.tpl);return bold?1+f*2:careful?1+(1-f)*2:1};
    let tot=0;for(const h of hooks)tot+=w(h);let r=rnd()*tot;for(const h of hooks){r-=w(h);if(r<=0)return h}return hooks[0]},
  frameScene(adv,sc,ctx){return fill(spec(adv,sc).frame||'',ctx)},
  // A failed roll draws from the scene type's list; a natural 20 is a boon (an item at a fight
  // or a trap, an easier next step elsewhere); a plain pass brings nothing.
  chooseComplication(adv,sc,roll){
    if(roll.nat===20)return sc.type==='fight'||sc.type==='trap'?'item':'boon';
    if(roll.ok)return null;
    const opts=D.SCENE_TYPES[sc.type].complications;if(!opts.length)return null;
    let tot=0;for(const k of opts)tot+=D.COMPLICATIONS[k].w;let r=rnd()*tot;for(const k of opts){r-=D.COMPLICATIONS[k].w;if(r<=0)return k}return opts[0]},
  // Hurt, carrying wounds, or careful by nature: the careful road. Bold: the bold one.
  resolveBranch(adv,sc){const L=hero(adv.lead),mem=members(adv);
    const hurt=mem.some(b=>b.hp<maxHp(b)*.6)||adv.flags.wound>0;
    if(L&&(tm(L,'bold')>1||tm(L,'retreat')<1)&&!hurt)return 'a';
    if(hurt||(L&&tm(L,'retreat')>1))return 'b';
    return rnd()<.5?'a':'b'},
};
let policy=SCRIPTED_DM;
export function setDmPolicy(p){policy=p||SCRIPTED_DM}
// Ask the policy; fall back to the scripted DM when the answer is missing or not legal.
function slot(name,legal,...args){let v;
  if(policy!==SCRIPTED_DM&&typeof policy[name]==='function'){try{v=policy[name](...args)}catch(e){v=undefined}
    if(v!==undefined&&legal(v))return v;stats().fallback++;
    const ad=args[0]&&args[0].tpl?args[0]:null,hh=args[0]&&args[0].kind==='hero'?args[0]:null;
    dmlog('fallback',ad,['The DM’s ',name,' answer was ',v===undefined?'missing':'illegal',': the scripted DM answered instead.'],{slot:name,got:v===undefined?'nothing':String(typeof v==='object'?JSON.stringify(v):v).slice(0,80)},{heroes:hh?[hh.id]:undefined})}
  return SCRIPTED_DM[name](...args)}
const COMPS=Object.keys(D.COMPLICATIONS);

// ---- helpers ----
function stats(){return S.dmStats||(S.dmStats={hooks:{},offered:{},started:{},done:{},outcome:{success:0,partial:0,failure:0},
  bySrc:{},depart:{},told:0,checks:[0,0],comps:{},lines:0,quiet:0,retreats:0,camps:0,named:[0,0],fallback:0})}
const bump=(o,k,n=1)=>{o[k]=(o[k]||0)+n};
function ensure(){if(!S.adventures)S.adventures=[];if(!S.dmSeen)S.dmSeen={dead:[],enc:{}};if(S.dmT==null)S.dmT=0;if(S.dmHookT==null)S.dmHookT=0;stats()}
const hero=id=>S.agents.find(x=>x.id===id)||null;
const advOf=id=>S.adventures?S.adventures.find(v=>v.id===id)||null:null;
const alive=x=>x&&x.state!=='dead';
const members=adv=>adv.mem.map(hero).filter(alive);
const band=z=>REGIONS[z]&&REGIONS[z].band?REGIONS[z].band:[1,99];
const zoneDc=z=>10+Math.floor(band(z)[0]/4);
const fightShare=tpl=>{const sc=D.ADVENTURES[tpl].scenes;return sc.filter(s=>s.type==='fight').length/sc.length};
export const spec=(adv,sc)=>{const T=D.ADVENTURES[adv.tpl],s=T.scenes[sc.k];return sc.br?s[sc.br].scene:s};
const capFirst=s=>s?s[0].toUpperCase()+s.slice(1):s;
// Fill "{who} finds {thing}" into chronicle parts. Values are strings, parts or arrays of parts;
// {Thing} is {thing} with a capital.
export function fill(tpl,v,keepCase){const out=[];for(const seg of String(tpl).split(/(\{\w+\})/)){if(!seg)continue;const k=/^\{(\w+)\}$/.exec(seg);
  if(!k){out.push(seg);continue}let key=k[1],up=false;if(!(key in v)&&key[0]===key[0].toUpperCase()){key=key[0].toLowerCase()+key.slice(1);up=true}
  const x=v[key];if(x==null){out.push(seg);continue}
  if(Array.isArray(x))out.push(...x);else if(typeof x==='string')out.push(up?capFirst(x):x);else if(typeof x==='number')out.push(String(x));else out.push(x)}
  if(!keepCase&&typeof out[0]==='string')out[0]=capFirst(out[0]);else if(!keepCase&&out[0]&&out[0].kind!=='hero'&&typeof out[0].t==='string')out[0]={...out[0],t:capFirst(out[0].t)};return out}
const plain=parts=>parts.map(p=>typeof p==='string'?p:p.kind==='hero'?p.name:p.t).join('');
const WORDS=['no','one','two','three','four','five','six'];
function foesName(type,n){const M=MOBS[type];if(!M)return 'monsters';return n===1?'a '+M.name:(WORDS[n]||String(n))+' '+M.pl}

// The words every line can use for this adventure.
function ctx(adv){const L=hero(adv.lead),d=adv.data,mem=members(adv);
  const who=L?(mem.length>1?[L,'’s party']:[L]):['the party'];
  return {who,lead:L?[L]:['the leader'],thing:d.thing||'the job',place:d.place||'the meeting place',zone:ZONES[adv.z]||'the wilds',
    town:adv.town,giver:d.giver||'the gate captain',stranger:d.stranger||'stranger',beast:d.beast?[gd(d.beast)]:['the beast'],btitle:d.btitle||'',
    foes:d.foes||'monsters',title:[gd(adv.title)]}}
// A chronicle line in the narrator's voice, tagged with the adventure id.
function line(adv,...parts){log({t:'',c:'nar',adv:adv.id},...parts);stats().lines++;adv.lines=(adv.lines||0)+1}
// The Chronicler follows a few stories at a time: an adventure is "told" when it starts while
// fewer than TOLD others are being told, or whenever the watcher follows one of its party.
// A told adventure speaks every beat; the rest go to the heroes' own logs (the dossier), and
// only their headline moments (a named foe, a death, a hunted elite) reach the Chronicle.
const watched=adv=>!!(S.pinned&&adv.mem.includes(S.pinned.id))||adv.mem.some(id=>S.agents.some(b=>b.id===id&&inSlots(b))); // the Fellowship's adventures are always told (#68)
function beat(adv,big,...parts){if(adv.told||watched(adv)||big){line(adv,...parts);return}stats().quiet++;note(adv,plain(parts))}
function note(adv,text){for(const b of members(adv))record(b,text)}

// ---- the map: candidate points for scenes (built once, scale-safe) ----
function roadPoints(){const R=ZONES.map(()=>[]);
  for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){if(tiles[I(x,y)]!==ROAD)continue;const p={x:x+.5,y:y+.5};
    if(CITY.some(c=>dist(p,c.gate)<K.GATE_CLEAR))continue;R[zoneAt(p.x,p.y)].push(p)}
  return R}
let ROADS=roadPoints();
onWorld(()=>{ROADS=roadPoints()},()=>({dmRoads:ROADS})); // another map (#1013)
const safeFor=(p,fac)=>loreSides()||!CITY.some(c=>c.fac!==fac&&dist(p,c.gate)<K.ENEMY_GATE);
// A point from a list: preferably 8-30 tiles from `near`, never near an enemy gate.
function pickPt(list,near,fac){if(!list||!list.length)return null;let best=null;
  for(let i=0;i<30;i++){const p=pickA(list);if(!safeFor(p,fac))continue;const d=near?dist(p,near):15;if(d>=10&&d<=32)return{x:p.x,y:p.y};if(!best)best=p}
  return best?{x:best.x,y:best.y}:null}
function nearestPt(list,to){let best=null,bd=1e9;for(const p of list||[]){const d=dist(p,to);if(d<bd){bd=d;best=p}}return best?{x:best.x,y:best.y}:null}
// Resolve a scene's `at` to a point (and sometimes a place name). prev: where the last scene was.
function place(adv,at,prev,L){const z=adv.z,fac=adv.fac,d=adv.data,home=homeOf(L);
  switch(at){
  case 'here':return null;
  case 'home':return {x:home.gate.x,y:home.gate.y};
  case 'road':return pickPt(ROADS[z],prev,fac)||pickPt(ZPTS[z],prev,fac);
  case 'landmark':{const lm=LANDMARKS.filter(l=>l.kind!=='lair'&&zoneAt(l.x,l.y)===z); // not the wyrm's doorstep
    if(lm.length){const l=pickA(lm);d.place=l.name;return nearestPt(ZPTS[z],l)}
    d.place=d.place||'the old waystones of '+ZONES[z];return pickPt(ZPTS[z],prev,fac)}
  case 'hook':return d.x!=null?nearestPt(ZPTS[z],{x:d.x,y:d.y}):pickPt(ROADS[z],prev,fac)||pickPt(ZPTS[z],prev,fac);
  case 'dest':{if(d.dest)return {x:d.dest.x,y:d.dest.y};return pickPt(ROADS[z],prev,fac)||pickPt(ZPTS[z],prev,fac)}
  default:return pickPt(ZPTS[z],prev,fac)}}

// ---- hooks ----
// Who posts a job: the town's resident in that role, by name ("Gate Captain Merel").
function giverOf(town,roles){const ps=(S.npcs||[]).filter(p=>p.town===town.name&&roles.includes(p.role));
  const p=ps.length?pickA(ps):null;return p?{name:p.title+' '+p.name,role:p.role}:{name:'the gate captain',role:'captain'}}
// The board itself (the post_hook lever in sim/levers.js calls this; nothing else should).
export function postHook(c,tpl,src,o={}){ensure();const T=D.ADVENTURES[tpl],g=o.giver||giverOf(c,o.roles||T.givers);
  const h={id:++S.uid,phase:'open',town:c.name,fac:c.fac,tpl,src,giver:g,zone:o.zone==null?null:o.zone,for:o.for==null?null:o.for,
    data:{thing:o.thing||(T.things?pickA(T.things):null),...(o.data||{})},born:S.gameMin,until:S.gameMin+ri(...K.HOOK_LIFE)*(o.zone==null?1:.5)}; // news tied to one place goes stale sooner
  if(o.by&&o.by!=='scripted')h.by=o.by;if(o.ff)h.ff=1;if(o.ff&&o.cid!=null)h.cid=o.cid;if(o.solo)h.solo=1; // who made it, for the quest log (sim/questlog.js): the DM agent, or the scripted DM's Fellowship-first job
  S.adventures.push(h);bump(stats().hooks,src);bump(stats().offered,tpl);return h}
export function withdrawHook(id){ensure();const i=S.adventures.findIndex(h=>h.id===id&&h.phase==='open');if(i<0)return null;return S.adventures.splice(i,1)[0]}
// The scripted DM posts every hook through the post_hook lever. On the board refresh the lever's
// log entry is folded into the board's own entry (boardLever) instead of standing alone.
let boardLever=null;
function newHook(c,tpl,src,o={},reason,quiet){const r=pull('post_hook',{town:c.name,tpl,src,spec:o},{by:'scripted',reason:reason||HOOK_WHY[src]||'a job for the board',log:quiet?false:undefined});
  if(quiet)boardLever=r.entry?{...r.entry.detail}:null;return r.ok?r.ret:null}
const HOOK_WHY={death:'a hero of this town fell recently',remnant:'a road encounter left a remnant',rumour:'a living elite is about',oath:'a hero in town has a matching oath or thread',
  follow:'follow-up to a finished job',request:'a townsfolk request',writ:'the gate captain’s writ'};

// ---- the gate captain's bounties (issue #67) ----
// The kill-N quest is no longer handed to every hero at the quest giver; it is a background bounty the gate captain
// posts on the hall board: one standing bounty per region the town's heroes hunt ("6 boars in the Greenmarch"), with
// the reward the kill quest always paid (heroes.js turnIn: a quarter level of XP, 4+3*level gold). A bounty is a
// choice, never the main loop: a departing hero takes an adventure first (dmDepart), and only a hero with none takes
// the bounty of its hunting ground (scripted: BOUNTY.TAKE scaled by greed, heroes.js; an agent: turn_in). The posting
// stays up for others (the captain pays per head) until it expires; taking copies it into a.quest. Not a lever: the
// DM's daily limits and the Fellowship's reserve are untouched, and nothing goes to the DM log.
export const BOUNTY={
  TAKE:.55,             // chance a departing scripted hero with no adventure takes its region's bounty (x greed)
  LIFE:[1440,2880],     // game minutes a bounty stays posted
};
const bountyList=()=>S.bounties||(S.bounties=[]);
// Post a bounty for every region a living hero of the town hunts that has none; expired ones come down.
export function postBounties(){const B=bountyList();
  for(let i=B.length-1;i>=0;i--)if(S.gameMin>B[i].until)B.splice(i,1);
  for(const c of CITY){const zs=new Map();
    for(const a of S.agents){if(a.state==='dead'||homeOf(a)!==c)continue;const z=huntZone(a);if(!zs.has(z)||a.lvl<zs.get(z))zs.set(z,a.lvl)}
    for(const [z,lo] of [...zs].sort((p,q)=>p[0]-q[0])){if(B.some(b=>b.town===c.name&&b.z===z))continue;
      const all=Object.keys(MOBS).filter(k=>MOBS[k].z===z);if(!all.length)continue;const fit=all.filter(k=>MOBS[k].lv[0]<=lo+2);
      B.push({id:++S.uid,town:c.name,z,type:pickA(fit.length?fit:all),need:ri(5,8),giver:giverOf(c,['captain']).name,born:S.gameMin,until:S.gameMin+ri(...BOUNTY.LIFE)});
      bump(stats(),'bounties')}}}
export const bountiesAt=c=>{if(!S.bounties)postBounties();return bountyList().filter(b=>b.town===c.name)};
// The posted bounty at c for region z that suits a (its creature not far above the hero), or null.
export function bountyFor(a,c,z){const fit=b=>b.z===z&&MOBS[b.type]&&MOBS[b.type].lv[0]<=a.lvl+2;let b=bountiesAt(c).find(fit);
  if(!b){postBounties();b=bountiesAt(c).find(fit)}return b||null}
export function takeBounty(a,b){a.quest={type:b.type,need:b.need,have:0,at:Math.round(S.gameMin),bounty:b.id,giver:b.giver};bump(stats(),'bountiesTaken');
  record(a,'Took ',gd(b.giver),'’s bounty: '+b.need+' '+MOBS[b.type].pl+' in '+ZONES[b.z]+'.');return a.quest}

// Hooks from the world, in order of preference: a fallen hero's pack, a robbed wagon or a
// vanished merchant, a living elite the innkeeper has heard of, an oath of a hero in town,
// and otherwise a townsperson's request or the gate captain's writ.
// ---- the Fellowship first (issue #165) ----
// The board of the Fellowship's hall always keeps one posted job that concerns them: an oath a member swore, a living
// elite nearest their road, a townsfolk job set in the region they are in (when its level band suits them), or else a job
// on the captain's bounty for the region they hunt (#325). The members in slot order; the job's template is drawn. Every one
// is tagged ff, and an ff job fits the whole Fellowship (fits). Returns the posted hook or null (then the ordinary draw runs).
function fellowHook(c,fo){
  const lo=Math.min(...fo.members.map(b=>b.lvl)),hi=Math.max(...fo.members.map(b=>b.lvl)),five=!!fo.company.slots,co=fo.cid;
  if(!five&&lo<K.MIN_LVL)return null; // nothing on a board fits a company with a member this green (#450)
  if(five&&lo<K.MIN_LVL&&hasLinks())return null; // in a hosted world the hall posts no job the five's agents would be turned away from (#1016); a headless world draws as before
  for(const a of fo.members){if(a.adv||a.lvl<K.MIN_LVL||S.adventures.some(h=>h.phase==='open'&&h.for===a.id))continue;
    const o=oathTpl(a);if(o)return newHook(c,o.tpl,'oath',{for:a.id,zone:o.zone,thing:o.thing,data:o.data,ff:1,cid:co},(five?'a Fellowship member’s ':'a company member’s ')+(a.goal.offered?'unsworn thread':'oath'),true)}
  const taken=m=>S.adventures.some(h=>h.data&&h.data.eliteId===m.id&&h.phase!=='done');
  const E=S.mobs.filter(m=>m.elite&&m.alive&&!m.gone&&!taken(m)&&m.lvl<=hi+2).sort((p,q)=>dist(p,fo)-dist(q,fo)||p.id-q.id)[0];
  // a hunt needs two blades walking together (another company: its walking party)
  if(E&&(five?fo.members.length:fo.party?fo.party.mem.filter(alive).length:1)>=2){const z=MOBS[E.type].z;return newHook(c,'hunt','rumour',{zone:z,data:{eliteId:E.id,beast:E.name,btitle:E.title,eliteLvl:E.lvl},roles:['innkeeper'],ff:1,cid:co},five?'a living elite lies near the Fellowship’s road':'a living elite lies near the company’s road',true)}
  const z=fo.zone!=null&&band(fo.zone)[0]<=lo&&band(fo.zone)[1]>=lo-4?fo.zone:null;
  if(z==null)return bountyHook(c,fo);
  const tpls=Object.keys(D.ADVENTURES).filter(k=>k!=='fallen'&&(five||D.ADVENTURES[k].lvl<=lo));if(!tpls.length)return null; // the five draw as before; another company only what its lowest can take
  const tpl=pickA(tpls);const T=D.ADVENTURES[tpl],g=giverOf(c,T.givers);
  return newHook(c,tpl,g.role==='captain'?'writ':g.role==='innkeeper'?'rumour':'request',{giver:g,zone:z,ff:1,cid:co},five?'a job in the region the Fellowship rides':'a job in the region the company rides',true)}
// The captain's bounty, with a job attached (issue #325): since #67 the Fellowship rode out on a bounty and came home less
// often, and only to a board of jobs sized for background parties. When a bounty is posted for the region the Fellowship
// hunts, the captain posts a Fellowship-first job in that region; the bounty stays up for everyone else.
const BOUNTY_TPLS=Object.keys(D.ADVENTURES).filter(k=>k!=='fallen'&&(D.ADVENTURES[k].givers||[]).includes('captain'));
const fellowZone=fo=>{const P=(S.parties||[]).find(p=>p.company===fo.cid&&p.leader&&p.leader.state!=='dead');return P&&P.zone!=null?P.zone:huntZone(fo.members[0])};
function bountyHook(c,fo,b){const z=fellowZone(fo);b=b||bountiesAt(c).find(x=>x.z===z);if(!b||!BOUNTY_TPLS.length)return null;
  const five=!!fo.company.slots,lo=Math.min(...fo.members.map(m=>m.lvl)),tpls=five?BOUNTY_TPLS:BOUNTY_TPLS.filter(k=>D.ADVENTURES[k].lvl<=lo);if(!tpls.length)return null;
  const h=newHook(c,pickA(tpls),'writ',{giver:{name:b.giver,role:'captain'},zone:b.z,ff:1,cid:fo.cid,data:{bounty:b.id}},five?'the gate captain’s bounty lies in the Fellowship’s region':'the gate captain’s bounty lies in the company’s region',true);
  if(h)bump(stats(),'ffBounty');return h}
// An open Fellowship-first job (or one for a member) on this board: the only kind a full Fellowship party can take.
// Per company (#450): that company's own hall job, so two companies sharing a hall each keep one.
const ffOpen=(c,fo)=>S.adventures.some(h=>h.phase==='open'&&h.town===c.name&&(ffFor(h,fo)||h.for!=null&&fo.ids.has(h.for)));
// Town gate (heroes.js, a Fellowship leader that found no job): the bounty of the region it sets out for becomes its job.
// Returns true when the party set out on it; false leaves the ordinary bounty branch in charge. Never runs without a company:
// the hero's own company (#450; heroes.js calls it for the Fellowship's leader).
export function fellowBounty(a,c,z){const fo=focusFor(a);if(!fo||fo.town!==c||(a.party&&a.party.leader!==a)||ffOpen(c,fo))return false;
  const b=bountiesAt(c).find(x=>x.z===z);if(!b)return false;
  boardLever=null;const h=bountyHook(c,fo,b);if(!h)return false;boardLog(c,h,[],boardLever?[boardLever]:[]);
  return dmDepart(a,c)}
function makeHook(c,fo){const seen=S.dmSeen; // fo: the first company whose hall this is, or null
  if(fo&&fo.town&&fo.town.name===c.name&&!ffOpen(c,fo)){const h=fellowHook(c,fo);if(h)return h}
  const r=rnd();
  // recent deaths of this town's heroes, where they fell
  if(r<.3){const g=S.agents.find(x=>x.state==='dead'&&x.fac===c.fac&&homeOf(x)===c&&x.lvl>=3&&!seen.dead.includes(x.id)&&x.diedMin!=null&&S.gameMin-x.diedMin<1440);
    if(g){seen.dead.push(g.id);if(seen.dead.length>60)seen.dead.shift();const z=zoneAt(g.x,g.y);
      if(z>=0&&safeFor(g,c.fac))return newHook(c,'fallen','death',{zone:z,thing:g.name,data:{x:g.x,y:g.y,deadId:g.id},roles:['priest','innkeeper']},null,true)}}
  // encounter remnants: a resolved ambush or strongbox, an expired merchant
  if(r<.55){const R=S.dmRemnants||[];const i=R.findIndex(x=>safeFor(x,c.fac));
    if(i>=0){const x=R.splice(i,1)[0];const thing=x.type==='merchant'?'a wagon merchant who never came back':x.type==='chest'?'a strongbox left in a ditch':'a robbed wagon';
      return newHook(c,'investigate','remnant',{zone:x.z,thing,data:{x:x.x,y:x.y},roles:['captain','quartermaster']},null,true)}}
  // rumours: a living elite (a hunt the innkeeper would pay to see done)
  if(r<.7){const E=S.mobs.find(m=>m.elite&&m.alive&&!m.gone&&!S.adventures.some(h=>h.data&&h.data.eliteId===m.id&&h.phase!=='done'));
    if(E){const z=MOBS[E.type].z;return newHook(c,'hunt','rumour',{zone:z,data:{eliteId:E.id,beast:E.name,btitle:E.title,eliteLvl:E.lvl},roles:['innkeeper']},null,true)}}
  // an oath of a hero standing in town
  if(r<.85){const a=S.agents.find(x=>x.state==='town'&&x.fac===c.fac&&homeOf(x)===c&&!x.adv&&x.lvl>=K.MIN_LVL&&oathTpl(x)&&!S.adventures.some(h=>h.phase==='open'&&h.for===x.id));
    if(a){const o=oathTpl(a);return newHook(c,o.tpl,'oath',{for:a.id,zone:o.zone,thing:o.thing,data:o.data},null,true)}}
  return townHook(c)}
// The townsfolk: a request (smith, priest, quartermaster, bard, innkeeper) or the captain's writ.
function townHook(c){const tpl=pickA(Object.keys(D.ADVENTURES).filter(k=>k!=='fallen'));const T=D.ADVENTURES[tpl];
  const g=giverOf(c,T.givers);return newHook(c,tpl,g.role==='captain'?'writ':g.role==='innkeeper'?'rumour':'request',{giver:g},null,true)}

// An oath that an adventure can serve: which template, where, and what it is about.
function oathTpl(a){const g=a.goal;if(!g||g.done)return null;
  switch(g.type){
  case 'avenge':{const E=S.mobs.find(m=>m.elite&&m.alive&&!m.gone&&m.name===g.target);
    return E?{tpl:'hunt',zone:MOBS[E.type].z,data:{eliteId:E.id,beast:E.name,btitle:E.title,eliteLvl:E.lvl}}:null}
  case 'heirloom':case 'heirloomCrypt':return {tpl:'relic',thing:'a clue to the '+g.target,data:{heirloom:g.target}};
  case 'pilgrimCrypt':return CRYPT&&g.minLvl!=null&&a.lvl>=g.minLvl?{tpl:'deliver',zone:zoneAt(CRYPT.x,CRYPT.y),thing:'a candle for the drowned dead',data:{dest:{x:CRYPT.x,y:CRYPT.y+1.2},place:CRYPT.name}}:null;
  case 'pilgrimFar':{if(g.minLvl==null||a.lvl<g.minLvl||g.zone==null)return null;const p=nearestPt(ZPTS[g.zone],homeOf(a).gate);
    return p?{tpl:'deliver',zone:g.zone,thing:'a pilgrim’s token',data:{dest:p,place:'the edge of '+ZONES[g.zone]}}:null}
  case 'hoard':return {tpl:'escort'};
  default:return null}}

// Does this hook suit a party of these members, led by a?
function fits(h,a,mem){const T=D.ADVENTURES[h.tpl],lo=Math.min(...mem.map(b=>b.lvl)),hi=Math.max(...mem.map(b=>b.lvl));
  if(h.for!=null&&!mem.some(b=>b.id===h.for))return false;
  if(h.solo&&mem.length!==1)return false; // a solo-sized job is for one hero (#447)
  const own=h.ff&&h.cid!=null&&!slotCo(h.cid); // another company's hall job (#450): its members, whatever its size, a solo too
  const whole=h.ff&&mem.some(b=>own?b.company===h.cid:inSlots(b)); // a Fellowship-first job is theirs and takes the whole Fellowship (#325): the size cap is for background parties
  if(h.ff&&!whole)return false;
  if((!own&&mem.length<T.size[0])||(!whole&&mem.length>T.size[1])||lo<Math.max(K.MIN_LVL,T.lvl))return false;
  if(h.data.eliteId!=null){if(mem.length<2||hi<h.data.eliteLvl-2)return false;const E=S.mobs.find(m=>m.id===h.data.eliteId);if(!E||!E.alive||E.gone)return false}
  if(h.zone!=null){const b=band(h.zone),home=partyZone(a);if(h.zone!==home&&!(b[0]<=lo&&b[1]>=lo-4))return false}
  return true}
const slotCo=id=>{const C=(S.companies||[]).find(x=>x.id===id);return !!(C&&C.slots)};
const partyZone=a=>a.party?a.party.zone:huntZone(a);

// ---- starting, resuming, leaving ----
function start(h,a,mem){const T=D.ADVENTURES[h.tpl],L=a,c=homeOf(L);
  const z=h.zone!=null?h.zone:partyZone(a),d=h.data;
  // where the deliveries go: another town of the faction, else the Crypt or a far waymark
  if(T.scenes.some(s=>s.at==='dest')&&!d.dest){const towns=CITY.filter(t=>ownTown(t,L)&&t!==c);
    if(towns.length){const t=pickA(towns);d.dest={x:t.gate.x,y:t.gate.y};d.place=t.name}
    else{const p=pickPt(ROADS[z],c.gate,L.fac)||pickPt(ZPTS[z],c.gate,L.fac);if(p){d.dest=p;d.place='the '+ZONES[z]+' waymark'}}}
  if(T.scenes.some(s=>s.foe&&s.foe.named)||(T.scenes.some(s=>s.type==='choice'))){if(!d.beast){const types=Object.keys(MOBS).filter(k=>MOBS[k].z===z);const k=pickA(types.length?types:Object.keys(MOBS));
    d.beastType=k;d.beast=pickA(D.BEAST_NAMES);d.btitle=fill(pickA(D.BEAST_TITLES),{kind:MOBS[k].name.toLowerCase(),zone:ZONES[z]},true).join('')}}
  d.stranger=pickA(D.STRANGERS);d.giver=h.giver.name;
  const adv=Object.assign(h,{phase:'active',tpl:h.tpl,src:h.src,town:c.name,fac:L.fac,lead:L.id,mem:mem.map(b=>b.id),z,data:d,giver:h.giver,
    title:'',scenes:[],idx:0,stage:'go',wait:0,waitKind:null,foes:[],flags:{wound:0,late:0,hostile:0,boon:0,item:0},pass:0,fail:0,
    started:S.gameMin,away:false,lines:0,told:false});
  adv.title=plain(fill(pickA(T.title),{thing:d.thing||'',place:d.place||'',zone:ZONES[z],beast:d.beast||'the beast'}));
  // lay the scenes on the map now, so the hero card can show where each one is
  let prev=c.gate;T.scenes.forEach((s,k)=>{const at=place(adv,s.at,prev,L);adv.scenes.push(mkScene(s,k,null,at));if(at)prev=at});
  for(const b of mem){if(b.adv&&b.adv!==adv.id)drop(b);b.adv=adv.id}
  bump(stats().started,h.tpl);bump(stats().bySrc,h.src);
  adv.told=watched(adv)||S.adventures.filter(v=>v.phase==='active'&&v.told).length<K.TOLD;if(adv.told)stats().told++;
  const C=ctx(adv),by=h.src==='oath'&&hero(h.for),src=by&&by.goal&&by.goal.offered?'thread':h.src;beat(adv,false,...fill(pickA(D.OFFER[src]||D.OFFER.writ),C)); // two lines either way: the same die (#800)
  for(const b of mem)record(b,'Took up an adventure: ',gd(adv.title),' ('+(h.giver?h.giver.name:'the gate')+').');
  if(T.carry==='start')carryItem(adv);
  return adv}
function mkScene(s,k,br,at){return {k,br,type:s.type,at:at?{x:at.x,y:at.y}:null,z:at?zoneAt(at.x,at.y):null,check:s.check===undefined?D.SCENE_TYPES[s.type].check:s.check,
  dc:s.dc||0,final:!!s.final,res:null}}
// Leave an adventure (a member who went another way). An adventure nobody is on any more fails.
function drop(b){const adv=advOf(b.adv);b.adv=null;if(!adv||adv.phase!=='active')return;
  adv.mem=adv.mem.filter(id=>id!==b.id);record(b,'Left ',gd(adv.title),' to others.');
  if(!members(adv).length)finish(adv,'failure','abandoned')}

// Town gate (heroes.js town step 2): take a hook or set out again. Returns true when the DM
// sent the hero out; false leaves the ordinary kill-N departure in charge.
export function dmDepart(a,c){ensure();
  if(a.party&&a.party.leader!==a)return false; // the leader decides for the party
  const mem=[a,...partyMates(a)];
  let adv=a.adv?advOf(a.adv):null;if(adv&&adv.phase!=='active'){a.adv=null;adv=null}
  if(adv&&adv.lead!==a.id&&!mem.some(b=>b.id===adv.lead)){drop(a);adv=null} // someone else's adventure, and they are not here
  if(!adv)for(const b of mem){const x=b.adv?advOf(b.adv):null;if(x&&x.phase==='active'&&x.lead===b.id){adv=x;break}} // the leader adopts a member's
  if(adv){adv.lead=a.id;for(const b of mem){if(b.adv!==adv.id){if(b.adv)drop(b);b.adv=adv.id}if(!adv.mem.includes(b.id))adv.mem.push(b.id)}
    if(adv.away){adv.away=false;note(adv,'Set out again on '+adv.title+'.');beat(adv,false,...fill(pickA(D.RESUME),ctx(adv)))}}
  else{const dp=stats().depart;if(Math.min(...mem.map(b=>b.lvl))<K.MIN_LVL){bump(dp,'low');return false}
    const open=S.adventures.filter(h=>h.phase==='open'&&h.town===c.name&&fits(h,a,mem));
    const h=slot('pickHook',v=>v===null||open.includes(v),a,open,mem);if(!h){bump(dp,open.length?'declined':'nofit');return false}
    bump(dp,'took');if(focusOf(a)==='adventure')focusCount('hooks');
    const why=pickWhy(a,open,mem,h);
    adv=start(h,a,mem);
    dmlog('pick',adv,[a,mem.length>1?'’s party':'',' took ',gd(adv.title),' at '+c.name+' ('+why.reason+')'],why.detail)}
  const sc=adv.scenes[adv.idx];a.zone=sc&&sc.z!=null?sc.z:adv.z;a.state='travel';a.dest=null;adv.stage='go';
  say(a,'depart',{zone:ZONES[a.zone]});return true}

// Why the pick went the way it did: the scripted DM's weights (no dice), for the DM log.
function pickWhy(a,open,mem,h){const bold=tm(a,'bold')>1||tm(a,'retreat')<1,careful=tm(a,'retreat')>1;
  const w=x=>{const f=fightShare(x.tpl);return bold?1+f*2:careful?1+(1-f)*2:1};
  const personal=h.for!=null&&mem.some(b=>b.id===h.for),temper=bold?'bold':careful?'careful':'steady';
  const rows=open.map(x=>({hook:x.id,tpl:x.tpl,src:x.src,fightShare:Math.round(fightShare(x.tpl)*100)/100,weight:Math.round(w(x)*100)/100,taken:x===h}));
  return {reason:personal?'a personal hook for the party':temper+' temper, weight '+Math.round(w(h)*100)/100+' of '+Math.round(open.reduce((s,x)=>s+w(x),0)*100)/100,
    detail:{hook:h.id,tpl:h.tpl,src:h.src,personal,temper,fitting:rows.length,candidates:rows,leader:a.id,party:mem.map(b=>b.id),levels:mem.map(b=>b.lvl).join(','),
      rule:personal?'personal hooks (oath, follow-up) first':'weights: bold or reckless leaders favour fights (1+2f), careful ones favour roads and talk (1+2(1-f)); f = share of fight scenes'}}}

// The adventure this hero drives right now, or null (followers, heroes without one).
function driving(a){if(!a.adv)return null;const adv=advOf(a.adv);
  if(!adv||adv.phase!=='active'){a.adv=null;return null}
  if(a.party&&a.party.leader!==a)return null;
  if(adv.lead!==a.id){if(a.party&&a.party.leader===a&&adv.mem.includes(adv.lead)&&partyMates(a).some(b=>b.id===adv.lead))adv.lead=a.id;else return null}
  return adv}

// ---- travel: walk to the scene, then play it ----
export function dmTravel(a,dt){const adv=driving(a);if(!adv)return false;
  if(adv.stage!=='go'){a.state='hunt';return true}
  if(checkEncounter(a,dt))return true; // the road still has its merchants, shrines and bandits
  const mh=maxHp(a);a.hp=Math.min(mh,a.hp+mh*K.WALK_REGEN*dt);
  const sc=adv.scenes[adv.idx];if(!sc){finish(adv,'failure','lost');return true}
  const E=eliteOf(adv,sc),p=E||sc.at||{x:a.x,y:a.y};
  if(E&&dist(a,E)<3){a.state='hunt';a.dest=null;sc.at={x:a.x,y:a.y};sc.z=zoneAt(a.x,a.y);a.zone=sc.z;arrive(adv,a,sc);return true}
  if(moveTo(a,p.x,p.y,dt,K.SPEED)){a.state='hunt';a.dest=null;if(!sc.at)sc.at={x:a.x,y:a.y};sc.z=zoneAt(a.x,a.y);a.zone=sc.z;arrive(adv,a,sc)}
  return true}

// A real elite the adventure is hunting: walk to wherever it is now.
function eliteOf(adv,sc){if(adv.data.eliteId==null||sc.type!=='fight'||!spec(adv,sc).foe||!spec(adv,sc).foe.named)return null;
  const E=S.mobs.find(m=>m.id===adv.data.eliteId);return E&&E.alive&&!E.gone?E:null}

// ---- hunt: the leader between moments of a scene ----
export function dmHunt(a,dt){const adv=driving(a);if(!adv)return false;
  const mh=maxHp(a),mates=partyMates(a);a.hp=Math.min(mh,a.hp+mh*.025*dt);
  const F=adv.stage==='fight'?liveFoes(adv):[],fighting=F.length>0;
  if(adv.stage==='fight'&&!fighting){fightWon(adv,a);return true}
  // Caution, as in the hunt case: badly hurt or caught in a storm, go home (the scene keeps);
  // merely worn down between scenes, make camp where they stand.
  if(isStorm(zoneAt(a.x,a.y))||(fighting&&(a.hp<mh*K.RETREAT*tm(a,'retreat')||mates.some(b=>b.hp<maxHp(b)*.3)))||a.hp<mh*.25){goHome(a);return true}
  if(adv.stage==='go'&&(a.hp<mh*K.CAMP||mates.some(b=>b.hp<maxHp(b)*.45))){adv.stage='wait';adv.waitKind='camp';adv.wait=ri(...K.CAMP_T);stats().camps++;
    note(adv,'Made camp to bind wounds.');return true}
  switch(adv.stage){
  case 'go':a.state='travel';a.dest=null;return true;
  case 'fight':{let m=null,bd=1e9;for(const f of F){const d=dist(a,f);if(d<bd){bd=d;m=f}}
    a.target=m;a.state='fight';a.dest=null;if(!m.target)m.target=a;return true}
  case 'wait':{adv.wait-=dt;for(const b of [a,...mates])if(dist(a,b)<8){const h=maxHp(b);b.hp=Math.min(h,b.hp+h*K.REGEN*dt)}
    a.moving=false;if(adv.wait>0)return true;const k=adv.waitKind;adv.waitKind=null;adv.stage='go';
    if(k==='rest')restDone(adv,a,adv.scenes[adv.idx]);
    else if(k==='late')next(adv,a);
    return true}}
  return true}

// ---- scenes ----
// Roll for the party: d20 + the best member's modifier vs region DC + scene. Skill scenes use the
// scene kind's skill (sim/abilities.js: ability modifier + training + trait nudge); the fight kind
// keeps the old combat modifier (level/3 + class bonus).
const SKILL_FOR={track:['tracking','survival'],trap:'traps',social:socialSkill,lore:'lore',watch:'perception'};
function roll(adv,a,sc){const mem=[a,...partyMates(a).filter(b=>dist(a,b)<10)],kind=sc.check;
  let mod=0,by=a,skill=null,parts=null;
  if(SKILL_FOR[kind]){const bf=bestFor(mem,SKILL_FOR[kind]);mod=bf.mod;by=bf.hero;skill=bf.skill;parts=bf.parts}
  else for(const b of mem){const m=Math.floor(b.lvl/3)+((D.CHECKS[kind]||{})[b.cls]||0);if(m>mod){mod=m;by=b}}
  const zdc=zoneDc(sc.z!=null?sc.z:adv.z);let dc=zdc+sc.dc,hostile=0,boon=0,att=null;if(kind==='social'&&adv.flags.hostile){hostile=D.COMPLICATIONS.hostile.dc;dc+=hostile;adv.flags.hostile=0}
  if(kind==='social'){att=attitudeDc(adv.data.giver,sc.at,mem);if(att.dc)dc+=att.dc;else att=null} // set_attitude / create_npc: hostile +3, wary +1, friendly -2
  if(adv.flags.boon){boon=D.COMPLICATIONS.boon.dc;dc+=boon;adv.flags.boon=0}
  const r=d20(),ok=r===20||(r!==1&&r+mod>=dc);stats().checks[ok?0:1]++;
  const cb=skill?0:(D.CHECKS[kind]||{})[by.cls]||0,total=r+mod;
  lastRoll=dmlog('roll',adv,[by,' rolls '+(skill?SKILLS[skill].name.toLowerCase():kind||'a')+' check: d20 '+r+(mod?'+'+mod:'')+' = '+total+' vs DC '+dc+' - '+(r===20?'natural 20':r===1?'natural 1':ok?'pass':'fail')],
    {scene:adv.idx+1,sceneType:sc.type,check:kind,
     dc:{base:10,region:zdc-10,regionName:ZONES[sc.z!=null?sc.z:adv.z],scene:sc.dc,hostile,boon,attitude:att?att.dc:0,attitudeOf:att?att.who+' ('+att.attitude+')':null,total:dc},
     modifier:{level:skill?0:Math.floor(by.lvl/3),cls:cb,skill,parts:parts&&parts.map(p=>p.k+' '+(p.v>=0?'+':'')+p.v),total:mod,by:by.id,byName:by.name,byClass:by.cls,pool:mem.length+' within reach'},
     d20:r,total,pass:ok,nat:r===20?20:r===1?1:null,sceneIdx:adv.idx},{});
  for(const d of pendLevers)fold(lastRoll,d);pendLevers=[];
  return {r,mod,dc,ok,nat:r,by}}
let lastRoll=null; // the newest roll entry, so the scene's frame text can join it
// Lever pulls a scene made before its roll (a named foe) ride on the roll's log entry, and a
// follow-up hook on the payoff's, so the DM log keeps its volume; the Levers filter finds them.
let pendLevers=[];
function fold(e,d){if(!e)return;const L=e.detail.levers||(e.detail.levers=[]);L.push(d);e.detail.lever=L.map(x=>x.lever).join(', ')}
const rollStr=x=>'rolls '+x.r+(x.mod?'+'+x.mod:'')+' vs '+x.dc;

// The DM's framing of a scene (policy slot). The text joins the scene's roll entry when it has
// one (the roll comes first in arrive); otherwise it is its own log entry.
function frame(adv,sc,C){const p=slot('frameScene',isParts,adv,sc,C),text=plain(p),
  loc=sc.at?{x:Math.round(sc.at.x),y:Math.round(sc.at.y),zone:ZONES[sc.z]||null}:null;
  if(lastRoll&&lastRoll.advId===adv.id&&lastRoll.detail.sceneIdx===adv.idx&&lastRoll.detail.frame==null){lastRoll.detail.frame=text;lastRoll.detail.location=loc;return p}
  dmlog('frame',adv,['Scene '+(adv.idx+1)+' ('+sc.type+'): ',...p],{scene:adv.idx+1,sceneType:sc.type,text,location:loc,check:sc.check||'none'});return p}

// Apply what a roll brought. Returns the words to add to the scene's line.
function complicate(adv,a,sc,x){
  const k=slot('chooseComplication',v=>v===null||COMPS.includes(v),adv,sc,x);if(!k)return [];bump(stats().comps,k);const C=D.COMPLICATIONS[k];
  dmlog('complication',adv,['Scene '+(adv.idx+1)+': '+k+' ('+(x.nat===20?'natural 20':'the roll failed')+')'],{complication:k,scene:adv.idx+1,sceneType:sc.type,
    why:x.nat===20?'natural 20 on a '+sc.type+' scene: a boon':'failed roll ('+(x.r+x.mod)+' vs DC '+x.dc+'): drawn by weight from this scene type’s complications',
    options:D.SCENE_TYPES[sc.type].complications.join(', ')||'none'});
  switch(k){
  case 'wound':adv.flags.wound++;for(const b of [a,...partyMates(a)]){if(dist(a,b)>10)continue;const d=Math.round(maxHp(b)*C.hp);b.hp=Math.max(1,b.hp-d);pop(b.x,b.y-.6,String(d),'#ff6a5a')}break;
  case 'late':adv.flags.late++;adv.stage='wait';adv.waitKind='late';adv.wait=ri(...C.wait);break;
  case 'hostile':adv.flags.hostile=1;angered(adv,a,sc);break;
  case 'boon':adv.flags.boon=1;break;
  case 'item':adv.flags.item=1;break;
  case 'ambush':{const t=spawnFoes(adv,a,sc,{n:[1,2]});const v=ctx(adv);v.foes=foesName(t.type,t.n);return [' ',...fill(pickA(C.line),v)]}}
  return [' ',...fill(pickA(C.line),ctx(adv))]}

// The leader reached the scene's place.
function arrive(adv,a,sc){const S2=spec(adv,sc),C=ctx(adv);
  switch(sc.type){
  case 'travel':case 'social':case 'trap':{
    if(!sc.check){note(adv,plain(frame(adv,sc,C))+'.');next(adv,a);return}
    const x=roll(adv,a,sc);sc.res=x.ok?'pass':'fail';
    const tail=complicate(adv,a,sc,x);
    beat(adv,false,...frame(adv,sc,C),'... ',dmS(rollStr(x)),'. ',...fill(x.ok?S2.pass:S2.fail,C),...tail);
    if(x.ok)reward(adv,a,'check');
    if(x.ok)adv.pass++;else adv.fail++;
    if(liveFoes(adv).length){adv.stage='fight';return}
    if(sc.final){finish(adv,null);return}
    if(adv.stage!=='wait')next(adv,a);return}
  case 'fight':{const foe=S2.foe||{n:[2,3]};
    if(adv.data.eliteId!=null&&foe.named){const E=S.mobs.find(m=>m.id===adv.data.eliteId);
      if(!E||!E.alive||E.gone){beat(adv,true,...fill(pickA(D.OUTCOME.gone),C));sc.res='pass';finish(adv,'partial','gone');return}
      adv.foes=[E.id];adv.named=E.id;adv.data.foes=E.name}
    else{const t=spawnFoes(adv,a,sc,foe);C.foes=adv.data.foes=foesName(t.type,t.n)}
    const x=roll(adv,a,sc);sc.pre=x.ok?'pass':'fail';
    if(x.ok){for(const m of liveFoes(adv))m.hp=Math.round(m.hp*K.FIRST)}
    const tail=complicate(adv,a,sc,x);
    beat(adv,false,...frame(adv,sc,C),'... ',dmS(rollStr(x)),'. ',...fill(x.ok?S2.pass:S2.fail,C),...tail);
    adv.stage='fight';return}
  case 'rest':{adv.stage='wait';adv.waitKind='rest';adv.wait=ri(...K.REST_T);note(adv,plain(frame(adv,sc,C))+'.');
    const mem=members(adv);if(mem.length>1)bondEvent(a,'party',mem);return}
  case 'choice':{const pb=playerBranch(adv,sc,a,S2);if(pb==='wait')return; // agent-played leader (sim/player-choice.js): wait for its pick; on timeout the scripted branch
    const br=pb||slot('resolveBranch',v=>v==='a'||v==='b',adv,sc);const B=S2[br];sc.res=br;
    {const L=hero(adv.lead),hurt=members(adv).some(b=>b.hp<maxHp(b)*.6)||adv.flags.wound>0,bold=!!L&&(tm(L,'bold')>1||tm(L,'retreat')<1);
     dmlog('branch',adv,['Choice at scene '+(adv.idx+1)+': '+B.label+' (the '+(br==='a'?'bold':'careful')+' road)'],{scene:adv.idx+1,a:S2.a.label,b:S2.b.label,taken:br,takenLabel:B.label,
       why:pb?'player choice':br==='a'?(bold&&!hurt?'bold leader and nobody hurt':'coin flip'):hurt?'party is hurt or carrying wounds':bold?'bold leader':(L&&tm(L,'retreat')>1)?'careful leader':'coin flip',
       hurt,boldLeader:bold})}
    beat(adv,false,...fill(S2.frame,C),'. ',...fill(B.line,C));note(adv,'Chose: '+B.label+'.');
    adv.scenes.splice(adv.idx+1,0,mkScene(B.scene,sc.k,br,place(adv,B.scene.at,sc.at||{x:a.x,y:a.y},a)));
    next(adv,a);return}}}
const isParts=v=>Array.isArray(v)&&v.length>0;

function next(adv,a){adv.idx++;adv.stage='go';if(adv.idx>=adv.scenes.length){finish(adv,null);return}
  const sc=adv.scenes[adv.idx];a.zone=sc.z!=null?sc.z:a.zone}

// End of a night's rest: the watch roll; a failure brings monsters out of the dark.
function restDone(adv,a,sc){const S2=spec(adv,sc),C=ctx(adv),x=roll(adv,a,sc);sc.res=x.ok?'pass':'fail';
  const tail=complicate(adv,a,sc,x);
  beat(adv,false,...fill(S2.frame,C),'... ',dmS(rollStr(x)),'. ',...fill(x.ok?S2.pass:S2.fail,C),...tail);
  if(x.ok){adv.pass++;reward(adv,a,'check')}
  if(liveFoes(adv).length){adv.stage='fight';return}
  if(sc.final){finish(adv,null);return}
  next(adv,a)}

// Spawn monsters of the scene's region for this adventure, around the scene point.
// A named foe is one monster of the region raised to the party's top level + 1 and toughened.
// Which bestiary theme each adventure's fights draw on.
const THEME_OF={clear:'den',hunt:'den',rescue:'den',escort:'road',fallen:'road',negotiate:'road',deliver:'road',relic:'ruin',investigate:'ruin'};
function spawnFoes(adv,a,sc,foe){const mem=members(adv),lo=Math.min(...mem.map(b=>b.lvl)),hi=Math.max(...mem.map(b=>b.lvl));
  const z=sc.z!=null?sc.z:adv.z,at=sc.at||{x:a.x,y:a.y};
  const hostile=adv.flags.hostile&&!foe.named?1:0;if(hostile)adv.flags.hostile=0;
  let nmin=foe.n[0],nmax=foe.n[1]+hostile;if(mem.length<2){nmax=Math.min(nmax,2);nmin=Math.min(nmin,nmax)} // a solo hero is never mobbed by an adventure
  // The bestiary fills the fight (sim/encounterbuilder.js): one species of the region, levels within one of the weakest hero,
  // a count the scene's range and the party's budget settle. Standard foes only; a named foe is the scene's one special.
  const enc=buildEncounter(THEME_OF[adv.tpl]||'den',z,lo,mem.length,{n:[nmin,nmax],lvlBand:[Math.max(1,lo-1),lo+1],mono:true,variants:false}),type=enc.foes.length?enc.foes[0].type:Object.keys(MOBS).find(k=>MOBS[k].z===z)||Object.keys(MOBS)[0];
  const put=(m,i)=>{const ang=i*2.3+rnd(),r=.9+rnd()*1.2;Object.assign(m,standAt(at.x+Math.cos(ang)*r,at.y+Math.sin(ang)*r));m.home={x:m.x,y:m.y};m.spawn={x:m.x,y:m.y};m.adv=adv.id;m.dest=null;m.target=null;adv.foes.push(m.id)};
  adv.foes=adv.foes.filter(id=>{const m=S.mobs.find(x=>x.id===id);return m&&m.alive&&!m.gone});
  let i=0;
  if(foe.named){const k=adv.data.beastType&&MOBS[adv.data.beastType]&&MOBS[adv.data.beastType].z===z?adv.data.beastType:type; // raised through the named_foe lever (sim/levers.js)
    const R=pull('named_foe',{type:k,region:z,lvl:clamp(hi+1,band(z)[0]-3,band(z)[1]+3),name:adv.data.beast,title:adv.data.btitle||'',solo:mem.length<2},{by:'scripted',reason:'scene '+(adv.idx+1)+' of '+adv.title+' calls for '+adv.data.beast,adv,log:false});
    pendLevers.push(R.entry.detail); // folded into the scene's roll entry (roll(), below)
    if(R.ok){const m=R.ret;put(m,i++);adv.named=m.id;stats().named[0]++}}
  for(const f of enc.foes){const m=spawnFoe(f);m.hpl=m.hp;put(m,i++)}
  return {type,n:enc.foes.length}}
const liveFoes=adv=>adv.foes.map(id=>S.mobs.find(m=>m.id===id)).filter(m=>m&&m.alive&&!m.gone);
function despawn(adv){for(const id of adv.foes){const m=S.mobs.find(x=>x.id===id);if(!m||m.elite)continue;m.alive=false;m.gone=true;m.target=null}adv.foes=[]}

// Every foe of the scene is down.
function fightWon(adv,a){const sc=adv.scenes[adv.idx],C=ctx(adv);adv.foes=[];
  if(adv.named!=null){stats().named[1]++;adv.slain=true;beat(adv,false,...fill(pickA(D.NAMED_DOWN),C));adv.named=null}
  else note(adv,'Won the fight: '+plain(fill(spec(adv,sc).frame||'',C))+'.');
  if(sc.res==null){sc.res='pass';adv.pass++}
  if(sc.final){finish(adv,null);return}
  next(adv,a)}

// XP for a passed roll, to every member within reach.
function reward(adv,a,kind){const z=adv.z,zl=band(z)[0]+2;for(const b of [a,...partyMates(a)]){if(dist(a,b)>10)continue;gainXp(b,(8+zl*6)*K.CHECK_XP)}}

// ---- the end ----
// outcome null: judge it. The final roll decides between success and partial; a run of failed
// rolls or lost days drags a success down to partial and a partial to failure.
function judge(adv){const fin=adv.scenes.filter(s=>s.final).pop(),okFinal=fin&&fin.res==='pass',bad=adv.fail+adv.flags.late;
  if(okFinal)return bad>=3?'partial':'success';return bad>=3?'failure':'partial'}
function finish(adv,outcome,why){if(adv.phase!=='active')return;outcome=outcome||judge(adv);
  {const cr=adv.carrier!=null?hero(adv.carrier):null;if(cr){if(outcome==='success'&&alive(cr)&&!hasQuestFor(cr,adv.id)){outcome='partial';/* the job's object is gone */}dropQuest(cr,adv.id)}}
  adv.phase='done';adv.outcome=outcome;adv.why=why||null;adv.ended=S.gameMin;
  despawn(adv);const T=D.ADVENTURES[adv.tpl],C=ctx(adv),mem=members(adv),L=hero(adv.lead),k=OUT[outcome]||0;
  bump(stats().done,adv.tpl);stats().outcome[outcome]++;
  const key=why==='death'?'death':why==='expired'?'expired':why==='abandoned'?'abandoned':why==='gone'?null:outcome;
  const pay=[];let gp=0,item=null;
  if(k>0)for(const b of mem){const g=Math.round((6+b.lvl*3)*T.pay.gold*k*(adv.data.payMul||1));b.gold+=g;(adv.paid||(adv.paid={}))[b.id]=g;/* the quest log wake names the pay */gp=Math.max(gp,g);gainXp(b,xpNeed(b.lvl)*T.pay.xp*K.PAY_XP*k);
    if(outcome==='success'){b.honor+=T.pay.honor;
      if(b===L||adv.flags.item||rnd()<T.pay.gear){const it=rewardItem(b,adv);if(it&&b===L)item=it}}
    record(b,(outcome==='success'?'Saw through ':'Half finished ')+adv.title+' for '+g+'g.');}
  else for(const b of mem)record(b,'Failed at '+adv.title+'.');
  if(k>0){pay.push(' ',gold(gp+'g'),mem.length>1?' each':'');if(item)pay.push(', and ',L,' takes ',{t:item.name,c:'gd'});pay.push('.')}
  let endEntry=null;
  {const detail={outcome,why:why||'judged',passed:adv.pass,failed:adv.fail,late:adv.flags.late,scenes:adv.idx+'/'+adv.scenes.length,tpl:adv.tpl,days:Math.round((S.gameMin-adv.started)/144)/10,
     rule:why?'ended early':'final roll '+((adv.scenes.filter(s=>s.final).pop()||{}).res==='pass'?'passed':'missed')+'; failed rolls + lost days = '+(adv.fail+adv.flags.late)+' (3 or more drags the result down a step)'};
   if(k>0){detail.goldEach=gp;detail.honor=outcome==='success'?T.pay.honor:0;detail.item=item?item.name:null}
   const ttl=gd(adv.title);
   endEntry=dmlog(k>0?'payoff':why==='abandoned'?'abandon':'fail',adv,k>0?[ttl,' ended in '+outcome+(gp?' (+'+gp+'g'+(mem.length>1?' each':'')+')':'')+'.']:[ttl,' failed: '+(why||'the rolls went against the party')+'.'],detail,{heroes:adv.mem.slice()})}
  if(key)beat(adv,why==='death'||adv.data.eliteId!=null,...fill(pickA(D.OUTCOME[key]),C),...pay);
  if(outcome!=='failure'&&mem.length>1)bondEvent(mem[0],'party',mem);
  // oaths: an heirloom hunt may turn up the heirloom itself; anyone may count the deed
  if(outcome==='success'&&adv.data.heirloom){const h=hero(adv.for);if(alive(h)&&mem.includes(h)&&rnd()<.35)getEpic(h,adv.data.heirloom,'the end of '+adv.title)}
  for(const b of mem)goalEvent(b,'adventure',adv);
  for(const b of adv.mem.map(hero))if(b)jobDone(b,adv); // the quest log (sim/questlog.js): no dice
  if(outcome==='success'&&((adv.slain&&adv.data.eliteId!=null)||first('adv:'+adv.fac+':'+adv.tpl)))timeline('adventure',...(mem.length>1?[L||mem[0],'’s party']:[L||mem[0]]),' completed ',gd(adv.title),' for '+adv.town+'.');
  else if(why==='death'&&L)timeline('adventure',L,' died on ',gd(adv.title),'.');
  // a follow-up job for the same leader
  if(outcome==='success'&&T.follow&&alive(L)&&rnd()<.35){const c=CITY.find(t=>t.name===adv.town);if(c){boardLever=null;newHook(c,T.follow,'follow',{for:L.id,zone:adv.z,giver:adv.giver},'follow-up to '+adv.title,true);if(boardLever)fold(endEntry,boardLever)}}
  worldAfter(adv,outcome,why);
  for(const b of adv.mem.map(hero))if(b&&b.adv===adv.id)b.adv=null;
  if(L&&alive(L)&&why!=='death'&&!adv.held&&(L.state==='hunt'||L.state==='travel'))goHome(L)}
// ---- the DM's hand on the world (sim/levers.js) ----
// What a finished adventure leaves behind: a lost escort marks its road dangerous for a day (two
// in one region while marked bring bandits onto its roads), a cleared den marks the place cleared,
// a caravan brought through (an escort, or a robbed wagon's trail followed to the end) floods the
// stalls with one good for a few hours. ready() first, so a used-up lever is not even tried.
function scenePt(adv,type){const pts=adv.scenes.filter(s=>s.at&&(!type||s.type===type)).map(s=>s.at).reverse();for(const p of pts)if(!spotErr(p))return p;return null}
function worldAfter(adv,outcome,why){const by={by:'scripted',adv};
  if(adv.tpl==='escort'&&outcome==='failure'&&why!=='abandoned'){const p=scenePt(adv,'fight')||scenePt(adv);
    if(p){const z=zoneAt(p.x,p.y);
      if(ready('mark_dangerous',z))pull('mark_dangerous',{at:p,r:4,lvl:band(z)[0]+2,hours:24},{...by,reason:adv.title+' was lost on this road'});
      if(S.marks.filter(m=>m.kind==='danger'&&m.z===z).length>=2&&!S.conditions.some(c=>c.z===z)&&ready('set_condition',z))
        pull('set_condition',{region:z,kind:'bandits',strength:1,hours:12},{...by,reason:'two escorts lost on the '+ZONES[z]+' roads in a day'})}}
  if(adv.tpl==='clear'&&outcome==='success'&&adv.slain){const p=scenePt(adv,'fight');
    if(p&&ready('mark_cleared',zoneAt(p.x,p.y)))pull('mark_cleared',{at:p,r:4,hours:24},{...by,reason:'the den of '+(adv.data.beast||'the pack')+' was cleared'})}
  if(outcome==='success'&&(adv.tpl==='escort'||adv.tpl==='investigate'&&adv.src==='remnant')&&ready('price_shock')){
    const ks=Object.keys(GOODS).filter(g=>!activeOf('price_shock').some(x=>x.params.good===g));
    if(ks.length)pull('price_shock',{good:ks[adv.id%ks.length],direction:'down',size:1,hours:8},{...by,reason:(adv.data.thing||'a caravan')+' came through to '+(adv.data.place||adv.town)+': the stalls fill'})}
  if(outcome==='success'&&DSITE.FROM[adv.tpl]&&(adv.id*7)%10<DSITE.P*10){const z=adv.z,L=DSITE.FROM[adv.tpl],raid=adv.id%2===0;
    const F=hero(adv.lead);raiseSite(z,L[adv.id%L.length],raid,adv.tpl==='clear'?'the den '+adv.title+' cleared ran deeper: something older lairs below':'the trail of '+plain([adv.data.thing||'the relic'])+' leads on to a deeper place',alive(F)?F:null)}}
// Sites the scripted DM raises (#642): a lair cleared or a relic brought home leaves a deeper place behind (worldAfter), and a
// migration or an invasion raises a den or a hold in its region (eventSite). Through the create_site lever, so its limits,
// cooldown, the companies' reserved share and the DM log all hold; a raid site only where the region's band reaches the raid
// level. No dice: the adventure's id picks, so the gameplay RNG is not touched.
export const DSITE={P:.3,FROM:{clear:['den','mine'],relic:['barrow','temple','ruin']},EVENT:{migration:'den',invasion:'fortress'},RETRY:360};
// sim/sites.js siteRoom(z, raid) -> {ok, raid}: the open-site caps (checked first so no refusal is logged) and whether the region's
// band reaches the raid level. Set from sim/index.js (wireSites), as sites.js cannot be imported here (an import cycle through crawl.js).
let siteRoom=()=>({ok:false});export function setSiteRoom(f){siteRoom=f}
// finder: the hero who found the way in (an adventure's leader), so the site starts discovered and the background can answer it;
// a world event's site is talked of on the roads and starts discovered too.
export function raiseSite(z,theme,raid,reason,finder){if(z==null||z<0||!ready('create_site',z))return null;
  const w=siteRoom(z,raid);if(!w.ok)return null;
  const r=pull('create_site',{theme,region:z,...(w.raid?{raid:true}:{})},{by:'scripted',reason});if(!r.ok||!r.ret)return null;
  const st=r.ret;st.state='discovered';st.found={at:Math.round(S.gameMin),by:finder?finder.name:'the roads'};if(S.sites)S.sites.stats.found++;
  if(finder){record(finder,'Found the way into ',{t:st.name,c:'gd',dg:'site:'+st.id},'.');log(finder,' found the way into ',{t:st.name,c:'gd',dg:'site:'+st.id},' in '+ZONES[z]+(st.raid?', a place for a raid':'')+'.')}
  else log('Word goes round the roads of '+ZONES[z]+' of ',{t:st.name,c:'gd',dg:'site:'+st.id},st.raid?', a stronghold no small party will take.':'.');
  return st}
function eventSite(){const ev=S.worldEvent&&S.worldEvent.cur,th=ev&&DSITE.EVENT[ev.kind];if(!th||ev.site||(ev.siteT!=null&&S.gameMin<ev.siteT))return;
  const s=raiseSite(ev.z,th,ev.kind==='invasion',ev.kind==='invasion'?'the raiders of the invasion in '+ZONES[ev.z]+' hold a stronghold there':'the migration in '+ZONES[ev.z]+' drives a great beast to lair');
  if(s)ev.site=s.id;else ev.siteT=S.gameMin+DSITE.RETRY}
// An angered stranger (the hostile complication at a parley) may stay on the road: a camp on
// the nearest clear road tile and a hostile person in it, for two game days. Social rolls near
// them are harder (attitudeDc) and they have cold words for passing heroes. No dice: the
// adventure id decides, so the gameplay RNG stream is not touched.
const STRANGER_ROLE={'hermit':'hermit','drover':'drover','Rookscar deserter':'sellsword','tinker':'peddler'};
function angered(adv,a,sc){if(sc.type!=='social'||(adv.id*7+adv.idx)%10>=K.STRANGER*10)return;
  const at=sc.at||{x:a.x,y:a.y},z=zoneAt(at.x,at.y);if(z<0||!ready('create_npc',z)||!ready('mark_place',z))return;
  let p=null;for(const q of (ROADS[z]||[]).slice().sort((u,v)=>dist(u,at)-dist(v,at)).slice(0,16))if(!spotErr(q,{road:true})&&!(S.places||[]).some(x=>dist(x,q)<3)){p={x:q.x,y:q.y};break}
  if(!p)return;const who=adv.data.stranger||'stranger',L=hero(adv.lead),by={by:'scripted',adv};
  const camp=pull('mark_place',{kind:'camp',at:p,hours:48},{...by,reason:'the '+who+' from '+adv.title+' makes camp by the road, nursing a grudge'});if(!camp.ok)return;
  pull('create_npc',{role:STRANGER_ROLE[who]||'stranger',home:'camp',at:p,attitude:'hostile',hours:48,towardParty:L&&L.party?L.party.id:undefined},{...by,reason:'the '+who+' '+(L?L.name:'the party')+' angered will not forget it'})}
// A job's object (a sealed letter, a bone reliquary) rides in the leader's pack as a quest item until the
// job ends: never sold, never given away. A success needs it still in hand (finish).
function carryItem(adv){const L=hero(adv.lead),t=plain([adv.data.thing||'the job’s object']);if(!alive(L)||adv.carried)return;
  const name=t.charAt(0).toUpperCase()+t.slice(1);addQuest(L,name,adv.id);adv.carried=true;adv.carrier=L.id;record(L,'Took charge of ',gd(name),' for '+adv.title+'.')}
function rewardItem(b,adv){const k=weakestSlot(b);if(!k)return null;const il=b.lvl+1;if(slotLevel(b,k)>=il)return null;
  const it=makeItem(b.cls,k,il,adv.z,{src:'Reward for '+adv.title,fine:.6,rare:.1});const old=equip(b,it);if(old)addGear(b,old);return it}

// ---- once per step (sim/index.js) ----
export function dmTick(dt){ensure();S.dmClock=(S.dmClock||0)+dt;S.dmT+=dt;if(S.dmT<.5)return;const step=S.dmT;S.dmT=0;
  watchWorld();
  for(const adv of S.adventures){if(adv.phase!=='active')continue;
    const L=hero(adv.lead);
    if(!alive(L)){finish(adv,'failure','death');continue}
    if(!adv.carried&&D.ADVENTURES[adv.tpl].carry==='mid'&&adv.idx>=2)carryItem(adv); // the relic is in hand once the trap is past
    if(S.gameMin-adv.started>K.MAX_DAYS*1440){finish(adv,'failure','expired');continue}
    if(adv.held)continue; // set aside by its agent for another quest (sim/questlog.js): it waits, and still goes cold
    // the leader went home (fled, wounded, party heading back) or was called to the Crypt or a raid
    const out=L.state==='return'||L.state==='town'||L.state==='dungeon'||L.state==='raid';
    if(out&&!adv.away){adv.away=true;stats().retreats++;despawn(adv);adv.stage='go';adv.waitKind=null;
      note(adv,'Fell back from '+adv.title+'.');beat(adv,false,...fill(pickA(D.RETREAT),ctx(adv)))}
    // members out in the world but not at the leader's side have gone their own way
    for(const b of members(adv)){if(b===L)continue;const field=!(b.state==='town'||b.state==='return'||b.state==='dungeon'||b.state==='raid');
      if(field&&!(b.party&&b.party===L.party))drop(b)}}
  // foes of finished or abandoned scenes never respawn
  for(const m of S.mobs)if(m.adv!=null&&!m.gone&&!m.alive){m.gone=true}
  S.dmHookT-=step;if(S.dmHookT<=0){S.dmHookT=K.REFILL;refill();postBounties();eventSite()}}

function refill(){const gone={};
  for(let i=S.adventures.length-1;i>=0;i--){const h=S.adventures[i];
    if(h.phase==='open'&&(S.gameMin>h.until||(h.for!=null&&!alive(hero(h.for))))){(gone[h.town]||(gone[h.town]=[])).push(hookRow(h,S.gameMin>h.until?'expired':'oath-bearer died'));S.adventures.splice(i,1)}
    else if(h.phase==='done'&&S.gameMin-h.ended>K.GONE)S.adventures.splice(i,1)}
  const done=S.adventures.filter(h=>h.phase==='done');while(done.length>K.KEEP_DONE){const h=done.shift();S.adventures.splice(S.adventures.indexOf(h),1)}
  // Posted jobs (not personal ones): up to HOOKS per town. If every posted job is tied to one
  // region and none is open-ended, the oldest is taken down for a fresh townsfolk job, so a
  // party of any level always has something on the board.
  // Fellowship first (issue #165): its hall's board is filled first; other boards fill beyond a floor of one posted job only
  // while the Fellowship has a job under way (then the world's background hooks are not starved, and not ahead of the story).
  // Every company a thread (#450): each company's hall is filled first (the followed company's first) and keeps one job for
  // each company it is the hall of; boards that are nobody's hall hold at the floor while no company has a job under way.
  const fs=focuses();serveStarved(fs);const halls=[];for(const f of fs)if(f.town&&!halls.includes(f.town))halls.push(f.town);
  const order=halls.length?[...halls,...CITY.filter(c=>!halls.includes(c))]:CITY,idle=fs.every(f=>!f.busy);
  for(const c of order){const posted=S.adventures.filter(h=>h.phase==='open'&&h.town===c.name&&h.for==null&&!h.solo);
    const here=fs.filter(f=>f.town===c),fo=here[0]||null;
    if(halls.length&&!fo&&idle&&posted.length>=K.FLOOR)continue;
    // a second company with the same hall: its own job on that board too, one per company
    for(const o of here.slice(1))if(!o.busy&&!ffOpen(c,o)){boardLever=null;const h=fellowHook(c,o);if(h)boardLog(c,h,[],boardLever?[boardLever]:[])}
    // the Fellowship's hall keeps one job they can take on top of a full board (#325)
    if(fo&&!fo.busy&&posted.length>=K.HOOKS&&!ffOpen(c,fo)){boardLever=null;const h=fellowHook(c,fo);if(h){boardLog(c,h,gone[c.name]||[],boardLever?[boardLever]:[]);continue}}
    if(posted.length<K.HOOKS){boardLever=null;const h=makeHook(c,fo);boardLog(c,h,gone[c.name]||[],boardLever?[boardLever]:[]);continue}
    if(!posted.some(h=>h.zone==null)){const w=pull('withdraw_hook',{hook:posted[0].id},{by:'scripted',reason:'every posted job was tied to one region',log:false});
      boardLever=null;const h=townHook(c);boardLog(c,h,(gone[c.name]||[]).concat(w.ok?[hookRow(posted[0],'every posted job was tied to one region: oldest taken down')]:[]),[w.entry.detail].concat(boardLever?[boardLever]:[]))}}
  const five=fs.find(f=>f.company.slots)||null;
  for(const c of order){boardLever=null;const h=soloHook(c,five);if(h)boardLog(c,h,[],boardLever?[boardLever]:[])} // a solo-sized job on every board a solo's faction owns (#447)
  // goods jobs (#720): a Fellowship or company member's trade first (their hall, reserved to them), else a hero of the town; no dice
  for(const c of order){const d=supplyPlan(c,fs.find(f=>f.town===c)||null);if(!d)continue;boardLever=null;
    const h=newHook(c,d.tpl,d.o.src,d.o,d.reason,true);if(h){if(!d.ff)notePosted(c,h);boardLog(c,h,[],boardLever?[boardLever]:[])}}}
// A starved company (#530): with two or more companies, the one in the field longest unserved (fairness(), FOCUS.STARVE_MIN)
// gets its hall job before the board fills: a fresh one replaces the stale unclaimed hall job (the job is the DM's next act for
// them, so it stamps their last-served time). One a refill, no dice beyond fellowHook's own; one company never runs this.
function serveStarved(fs){if(fs.length<2)return;
  const st=fairness(fs).rows.filter(r=>r.field>0&&r.since>=FOCUS.STARVE_MIN-K.LEAD).sort((p,q)=>q.since-p.since||p.cid-q.cid);
  for(const r of st){const f=fs.find(x=>x.cid===r.cid),c=f&&f.town;if(!c)continue;
    const old=S.adventures.filter(h=>h.phase==='open'&&h.town===c.name&&h.for==null&&ffFor(h,f));
    const removed=[],lv=[];for(const o of old){const w=pull('withdraw_hook',{hook:o.id},{by:'scripted',reason:'a stale hall job for a company the DM has not served',log:false});if(w.ok){removed.push(hookRow(o,'stale: replaced for a starved company'));lv.push(w.entry.detail)}}
    boardLever=null;const h=fellowHook(c,f);if(h){boardLog(c,h,removed,lv.concat(boardLever?[boardLever]:[]));return}}}
// Solo-sized jobs (#447, epic #402): while an agent company of one exists in a faction, each of that faction's boards keeps
// one posted job sized for a single hero, inside the lowest solo's level band and paid K.SOLO_PAY. Not posted at all with
// no solo (the default together world and a world without a Fellowship draw no dice here and stay byte-identical). The
// Fellowship's hall keeps its own ff job. Returns the hook or null.
const soloHeroes=fac=>(S.companies||[]).filter(C=>isSolo(C)&&!C.slots&&(loreSides()||C.fac===fac)).map(C=>S.agents.find(a=>a.id===C.ids[0])).filter(a=>a&&a.player&&a.state!=='dead'&&a.lvl>=K.MIN_LVL);
function soloHook(c,fo){const hs=soloHeroes(c.fac);if(!hs.length)return null;
  if(fo&&fo.town&&fo.town.name===c.name)return null;
  if(S.adventures.some(h=>h.phase==='open'&&h.town===c.name&&h.solo))return null;
  const low=hs.reduce((m,a)=>a.lvl<m.lvl?a:m,hs[0]),lo=low.lvl;
  const tpls=Object.keys(D.ADVENTURES).filter(k=>{const T=D.ADVENTURES[k];return k!=='fallen'&&T.size[0]<=1&&T.lvl<=lo});if(!tpls.length)return null;
  const tpl=pickA(tpls),T=D.ADVENTURES[tpl],g=giverOf(c,T.givers),hz=huntZone(low);
  const zone=hz!=null&&band(hz)[0]<=lo&&band(hz)[1]>=lo-4?hz:null;
  return newHook(c,tpl,g.role==='captain'?'writ':g.role==='innkeeper'?'rumour':'request',{giver:g,zone,solo:1,data:{payMul:K.SOLO_PAY}},'a job sized for one blade',true)}
const hookRow=(h,why)=>({id:h.id,tpl:h.tpl,src:h.src,giver:h.giver?h.giver.name:null,zone:h.zone==null?'any':ZONES[h.zone],for:h.for==null?null:h.for,...(h.cid!=null?{cid:h.cid}:{}),why});
// One log entry per town per refresh: what went up on the board, what came down, what stands.
// levers: the post_hook / withdraw_hook pulls behind this refresh (the Levers filter shows the entry).
function boardLog(c,h,removed,levers){const open=S.adventures.filter(x=>x.phase==='open'&&x.town===c.name);
  if(!h){if(levers.length)dmlog('lever',null,['Board at '+c.name+': nothing posted ('+levers.map(l=>l.lever+' '+l.result).join('; ')+').'],{lever:levers.map(l=>l.lever).join(', '),levers,open:open.length},{town:c.name});return}
  const who=h.for!=null?hero(h.for):null;
  const why=h.src==='death'?'a hero of this town fell recently':h.src==='remnant'?'a road encounter left a remnant':h.src==='oath'?'a hero in town has a matching oath or thread':
    h.src==='follow'?'follow-up to a finished job':h.data.eliteId!=null?'a living elite is about':'townsfolk request or gate writ, template drawn at random';
  dmlog('hooks',null,['Board at '+c.name+': '+h.tpl+' posted by '+(h.giver?h.giver.name:'the gate')+' ('+h.src+')',...(who?[' for ',who]:[]),
    removed.length?'; '+removed.length+' taken down.':'.'],
    {added:[hookRow(h,'')],removed,board:open.map(x=>x.tpl+'/'+x.src).join(', '),open:open.length,why,lever:levers.map(l=>l.lever).join(', ')||null,levers},{town:c.name,heroes:who?[who.id]:[]});
  if(h.ff)hallLine(c,h,who)}
// A Fellowship-first job (h.ff) also reaches the Chronicle (#351), so the "Fellowship only" view can follow the hall board:
// one line naming the town, the job and the member it is for (the oath-bearer, else the party's leader). Other postings stay
// out of the Chronicle. No dice: the job's kind and region name it, not its drawn title. The giver is the townsperson who
// pins it up; the DM (scripted or agent) is never named.
function hallLine(c,h,who){const fo=h.cid!=null?focuses().find(f=>f.cid===h.cid):focus();if(!fo)return;
  const P=(S.parties||[]).find(p=>p.company===fo.cid&&p.leader&&fo.ids.has(p.leader.id)&&alive(p.leader));
  const a=who&&fo.ids.has(who.id)?who:P?P.leader:fo.members[0];if(!a)return;
  const T=D.ADVENTURES[h.tpl]||D.SUPPLY[h.tpl],job=(h.data&&h.data.beast?'Hunt '+h.data.beast:T&&T.name||h.tpl)+(h.zone!=null&&ZONES[h.zone]?' in '+ZONES[h.zone]:'');
  const co=fo.company.slots?'the Fellowship':fo.members.length>1?(fo.company.name||'the company'):null; // a solo's job is just theirs
  log(gold(c.name),' hall board: '+(h.giver?h.giver.name:'the gate captain')+' posts a job for ',a,who===a||!co?': ':' and '+co+': ',gold(job),'.')}

// Remember where road encounters ended, so a robbed wagon can become an investigation.
function watchWorld(){const seen=S.dmSeen.enc,E=S.encounters||[],now={};
  for(const e of E){now[e.id]=1;if(!seen[e.id])seen[e.id]={type:e.type,x:e.x,y:e.y,z:e.z,until:e.until}}
  for(const id in seen){if(now[id])continue;const e=seen[id];delete seen[id];
    const R=S.dmRemnants||(S.dmRemnants=[]);
    if(e.type==='ambush'||e.type==='chest'||(e.type==='merchant'&&S.gameMin>=e.until-1)){R.push({type:e.type,x:e.x,y:e.y,z:e.z,t:S.gameMin});if(R.length>6)R.shift()}}
  for(const a of S.agents)if(a.state==='dead'&&a.diedMin==null)a.diedMin=S.gameMin}

// ---- for the hero card ----
// "Adventure: <title> — scene 2/4: <what> (with <hero>, <hero>)" as chronicle parts, or null.
export function advLine(a){const adv=a&&a.adv?advOf(a.adv):null;if(!adv||adv.phase!=='active')return null;
  const sc=adv.scenes[adv.idx],tot=adv.scenes.filter(s=>!(s.type==='choice')).length,done=adv.scenes.slice(0,adv.idx).filter(s=>s.type!=='choice').length;
  const what=!sc?'':adv.away?'resting in town':adv.stage==='fight'?'fighting':adv.stage==='wait'?(adv.waitKind==='rest'?'resting':adv.waitKind==='camp'?'camped':'held up'):SCENE_LABEL[sc.type]+(sc.z!=null?' in '+ZONES[sc.z]:'');
  const out=['Adventure: ',gd(adv.title),' — scene '+Math.min(tot,done+1)+'/'+tot+': '+what];
  const mem=members(adv).filter(b=>b!==a);if(mem.length){out.push(' (with ');mem.forEach((b,i)=>{out.push(b);if(i<mem.length-1)out.push(', ')});out.push(')')}
  return out}
const SCENE_LABEL={travel:'on the road',fight:'a fight',social:'a parley',trap:'a trap',rest:'a rest',choice:'a choice'};

// ---- several quests per hero (sim/questlog.js) ----
// An agent-played hero may hold more than one job. Only the focused one leads it (a.adv); the others wait:
//   a taken job   a posted hook taken off the board for this hero (phase 'taken', h.taker), not started yet;
//   a held one    a running adventure set aside (adv.held = hero id): its foes are gone, its scene keeps,
//                 dmTick only ages it (MAX_DAYS from its start) and ends it if its hero dies.
// Scripted heroes never hold a second job, so none of this runs in the scripted sim. No dice anywhere here.
export function holdAdventure(a){const adv=a.adv?advOf(a.adv):null;if(!adv||adv.phase!=='active'){a.adv=null;return null}
  despawn(adv);adv.held=a.id;adv.away=true;adv.stage='go';adv.waitKind=null;adv.wait=0;
  for(const b of adv.mem.map(hero))if(b&&b!==a&&b.adv===adv.id)b.adv=null;
  adv.mem=[a.id];adv.lead=a.id;a.adv=null;note(adv,'Set '+adv.title+' aside for now.');return adv}
// Pick a held adventure back up where it stands (the hero and its party, if it leads one). Returns the adventure.
export function resumeAdventure(a,adv){if(!adv||adv.phase!=='active')return null;if(a.adv&&a.adv!==adv.id)holdAdventure(a);
  const mem=[a,...(a.party&&a.party.leader===a?partyMates(a):[])];adv.held=null;adv.lead=a.id;
  for(const b of mem){if(b.adv&&b.adv!==adv.id)drop(b);b.adv=adv.id;if(!adv.mem.includes(b.id))adv.mem.push(b.id)}
  note(adv,'Took up '+adv.title+' again.');
  if(a.state==='hunt'||a.state==='travel'||a.state==='follow'){adv.away=false;const sc=adv.scenes[adv.idx];a.zone=sc&&sc.z!=null?sc.z:adv.z;a.state='travel';a.dest=null;adv.stage='go'}
  return adv}
// Start a taken job now, from wherever the hero stands (the job-giver already said yes). Returns the adventure,
// or a reason string when it does not suit the hero (and party) any more.
export function beginJob(a,h){ensure();const mem=[a,...(a.party&&a.party.leader===a?partyMates(a):[])];
  const forWas=h.for;h.for=a.id;const ok=fits(h,a,mem);h.for=forWas;if(!ok)return 'it does not suit you (and your party) as you are now';
  if(a.adv)holdAdventure(a);h.phase='open';h.taker=null;const adv=start(h,a,mem);
  dmlog('pick',adv,[a,mem.length>1?'’s party':'',' set out on ',gd(adv.title),' (a job they had taken earlier)'],{hook:adv.id,tpl:adv.tpl,src:adv.src,personal:true,rule:'taken earlier, focused now by the hero',leader:a.id,party:mem.map(b=>b.id)});
  const sc=adv.scenes[adv.idx];a.zone=sc&&sc.z!=null?sc.z:adv.z;
  if(a.state==='town'){a.state='travel';a.dest=null}else if(a.state==='hunt'||a.state==='travel'||a.state==='follow'){a.state='travel';a.dest=null}
  adv.stage='go';return adv}
// The hero gives the adventure up: a leader (or a lone hero) ends it for everyone, a member leaves it to the others.
export function abandonAdventure(a,adv){if(!adv||adv.phase!=='active')return false;
  if(adv.lead===a.id||adv.held===a.id){adv.held=adv.held||a.id; /* no walk home: the hero only stops */finish(adv,'failure','abandoned');return true}
  drop(a);return true}
// The Fellowship's own camp (sim/camp.js) may fall on the road between an adventure's scenes (#325): with a job nearly always
// under way they would otherwise never make camp. The job waits (foes, scene and all) until camp breaks; never mid-fight or mid-scene.
export function advCampable(a){const adv=a&&a.adv?advOf(a.adv):null;if(!adv||adv.phase!=='active')return true;
  return adv.stage==='go'||(adv.stage==='wait'&&adv.waitKind==='camp')}
export const fitsJob=(h,a)=>{const mem=[a,...(a.party&&a.party.leader===a?partyMates(a):[])];const forWas=h.for;h.for=a.id;const ok=fits(h,a,mem);h.for=forWas;return ok};
