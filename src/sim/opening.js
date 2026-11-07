// A new world's opening (issue #111). Owned by ai-designer. DOM-free.
//
// By default a fresh world (init(), never a restored save) founds the default Fellowship at once
// and lets the other heroes start part-way through their careers, so the five set out into a world
// that already has veterans, middling hunters and greenhorns in it:
//   - the Fellowship: one faction (rolled per seed), the "form one for me" pick (autoPick) of its
//     level-1 roster, founded with foundSlots() in the leader's home town, every member agent-played (#148:
//     autopilot and reflexes until their runners claim them). They start at level 1 like everyone used to.
//   - background heroes: a starting level drawn from START_BANDS (stratified per faction, so both
//     factions get the same spread), placed hunting in the region that fits that level (zoneFor,
//     nearest their home town), with worn gear, gold, kills, ability growth and a line of history.
// Hardcore replacements (step's recruits, the Fellowship's recruit()) still arrive at level 1.
//
// The old start (28 level-1 heroes in town, no Fellowship) is kept for balance comparisons:
// ELDMOOR_FELLOWSHIP=0 in Node, ?fellowship=0 in the browser, or init({fellowship:false}).
import {rnd,ri} from '../core/rng.js';
import {CITY,LVL_CAP,LVL_FLOOR,ZONES,zoneFor,zonePoint,tileAt} from '../world/map.js';
import {ACTIVE_SPEC} from '../world/spec.js';
import {WALKABLE} from '../world/tiles.js';
import {solidAt,standAt} from '../world/passable.js';
import {homeOf} from '../data/races.js';
import {FAC} from '../data/factions.js';
import {SLOTS} from '../data/items.js';
import {PROLOGUE_DEFAULT,PROLOGUE_VALUES} from '../data/prologues.js';
import {S,noOthers} from './state.js';
import {log,fac} from './chronicle.js';
import {xpNeed,maxHp,seedLevel,makeHero} from './heroes.js';
import {makeItem,syncGear} from './gear.js';
import {record,first} from './history.js';
import {pickSetup,pickApart,applyMinds,cleanSetup,groupsOf,startOf,resolveArchetype,hallOf,CLASSIC} from './setup.js';
import {foundCompany,campaign,foundSlots,autoPick,spreadAt} from './company.js';
import {markPlayer} from './player.js';
import {disableBrain} from './brain.js';
import {seedProfs} from './professions.js';
import {applyArchetype} from './persona.js';
import {setDmSeat} from './dmagent.js';

// Starting levels of background heroes: weight per band, levels spread evenly inside a band.
// About 30% greenhorns (1-3), 36% journeymen (4-7), 24% seasoned (8-11), 10% veterans (12-15).
export const START_BANDS=[{lo:1,hi:3,w:.30},{lo:4,hi:7,w:.36},{lo:8,hi:11,w:.24},{lo:12,hi:15,w:.10}];

// The others setting (#780): 'full' (the default) or 'none', no roster at all. init's option wins, then the setup's, then
// ?others= in the browser, then ELDMOOR_OTHERS in Node.
export function othersStart(o={}){let v=o.others!=null?o.others:o.setup&&o.setup.others;
  try{if(v==null&&typeof location!=='undefined'&&location.search)v=new URLSearchParams(location.search).get('others')}catch(e){}
  if(v==null&&typeof globalThis.ELDMOOR_OTHERS!=='undefined')v=String(globalThis.ELDMOOR_OTHERS);
  if(v==null){const p=globalThis.process;if(p&&p.env&&p.env.ELDMOOR_OTHERS!=null)v=p.env.ELDMOOR_OTHERS}
  return String(v==null?'':v).trim().toLowerCase()==='none'?'none':'full'}

// The sides setting (#1025): 'lore' or nothing, read as others is: init's option, the setup's, ?sides= in the browser, ELDMOOR_SIDES in Node.
export function sidesStart(o={}){let v=o.sides!=null?o.sides:o.setup&&o.setup.sides;
  try{if(v==null&&typeof location!=='undefined'&&location.search)v=new URLSearchParams(location.search).get('sides')}catch(e){}
  if(v==null&&typeof globalThis.ELDMOOR_SIDES!=='undefined')v=String(globalThis.ELDMOOR_SIDES);
  if(v==null){const p=globalThis.process;if(p&&p.env&&p.env.ELDMOOR_SIDES!=null)v=p.env.ELDMOOR_SIDES}
  if(v==null)v=ACTIVE_SPEC.sides; // a map may be lore by nature (#1013)
  return String(v==null?'':v).trim().toLowerCase()==='lore'?'lore':null}

// The first delve (#922): 'delve' or 'none', or null when nothing asks. init's option wins, then the setup's, then ?prologue= in the browser, then
// ELDMOOR_PROLOGUE in Node. noteProlog keeps it in S.setup only when it differs from what the world would do by itself.
export function prologueStart(o={}){let v=o.prologue!=null?o.prologue:o.setup&&o.setup.prologue;const page=!!o.setup; // a setup has chosen, the default included: the URL and the environment do not overrule it
  try{if(v==null&&!page&&typeof location!=='undefined'&&location.search)v=new URLSearchParams(location.search).get('prologue')}catch(e){}
  if(v==null&&!page&&typeof globalThis.ELDMOOR_PROLOGUE!=='undefined')v=String(globalThis.ELDMOOR_PROLOGUE);
  if(v==null&&!page){const p=globalThis.process;if(p&&p.env&&p.env.ELDMOOR_PROLOGUE!=null)v=p.env.ELDMOOR_PROLOGUE}
  v=String(v==null?'':v).trim().toLowerCase();return PROLOGUE_VALUES.includes(v)?v:null}
export function noteProlog(o){const v=prologueStart(o);if(!v)return;const base=S.setup&&S.setup.world!=null?PROLOGUE_DEFAULT:'none';
  if(v!==base)S.setup={...S.setup,prologue:v};else if(S.setup)delete S.setup.prologue}

// The flag: init's option wins, then ?fellowship= in the browser, then ELDMOOR_FELLOWSHIP in Node.
export function fellowshipStart(o={}){if(o.fellowship!=null)return !!o.fellowship;let v=null;
  try{if(typeof location!=='undefined'&&location.search)v=new URLSearchParams(location.search).get('fellowship')}catch(e){}
  if(v==null&&typeof globalThis.ELDMOOR_FELLOWSHIP!=='undefined')v=String(globalThis.ELDMOOR_FELLOWSHIP);
  if(v==null){const p=globalThis.process;if(p&&p.env&&p.env.ELDMOOR_FELLOWSHIP!=null)v=p.env.ELDMOOR_FELLOWSHIP}
  return !(v!=null&&/^(0|off|false|no)$/i.test(String(v).trim()))}

// u in [0,1) -> a level from START_BANDS.
export function startLevel(u){const tot=START_BANDS.reduce((t,b)=>t+b.w,0);let r=u*tot;
  for(const b of START_BANDS){if(r<b.w){const n=b.hi-b.lo+1;return Math.min(b.hi,b.lo+Math.floor(r/b.w*n))}r-=b.w}
  return START_BANDS[START_BANDS.length-1].hi}

// Roughly the monsters a hero killed on the way to level L (most XP from kills, the rest from quests).
const killsTo=L=>{let k=0;for(let l=1;l<L;l++)k+=xpNeed(l)/(8+6*l)*.75;return Math.round(k)};
const AGO=['a season','half a year','a year','two years'];

// Give a level-1 hero the career of a level-L one and put them in the field.
export function season(a,L){if(L<=1){record(a,'New to the road out of '+homeOf(a).name+'.');return}
  seedLevel(a,L);a.xp=Math.floor(rnd()*xpNeed(L)*.8); // level, ability growth and a fitting quest (heroes.js)
  for(let l=5;l<=L;l+=5){first('lvl:'+a.fac+':'+l);if(l>=10)first('cls:'+a.fac+':'+a.cls+':'+l)} // no "first to level 10" later for a level a veteran already holds
  const fill=Math.min(1,.2+L*.12); // greenhorns have bought a piece or two; veterans wear a full set
  for(const k of SLOTS)if(rnd()<fill){const il=Math.max(1,L-ri(0,2));a.slots[k]=makeItem(a.cls,k,il,zoneFor(il),{src:'Carried from earlier days',rare:.03})}
  syncGear(a);
  a.gold=ri(3,8)*L;a.kills=Math.round(killsTo(L)*(.8+rnd()*.4));
  const c=homeOf(a),z=zoneFor(L,c.gate),p=zonePoint(z,null,c.gate);
  a.zone=z;a.x=p.x;a.y=p.y;a.state='hunt';a.dest=null;a.townStep=1;a.hp=maxHp(a);
  const ago=AGO[Math.min(AGO.length-1,Math.floor((L-1)/4))];
  record(a,'Left '+c.name+' '+ago+' ago. Level '+L+' now, '+a.kills+' kills behind them, hunting in '+ZONES[z]+'.')}

// What this map holds (#1013): a side with no town here has no heroes here, and on a chapter map nobody starts above its top band (LVL_CAP).
const sideHere=f=>CITY.some(c=>c.fac===f);
const townSide=f=>sideHere(f)?f:CITY[0].fac;
const sidesHere=()=>{const L=FAC.map((_,f)=>f).filter(sideHere);return L.flatMap((f,i)=>i?[' and ',fac(f)]:[fac(f)])};
// The opening for a fresh world. Called by init() after the level-1 roster exists.
export function opening(o={}){
  const setup=o.setup?cleanSetup(o.setup):null; // New World setup (sim/setup.js, #133): chosen classes, names, peoples and minds
  if(!setup&&!fellowshipStart(o)){if(noOthers()){emptyRoads();return null}
    const n=S.agents.length;log(...(n===28?['Twenty-eight new heroes of ']:[String(n),' new heroes of ']),...sidesHere(),' arrive in ',{t:ACTIVE_SPEC.name,c:'gd'},'. Every one of them is level 1.');return null}
  if(setup&&setup.mode==='apart')return openApart(setup);
  const ff=setup?setup.fac:townSide(o.fac!=null?o.fac:rnd()<.5?0:1),pick=setup?pickSetup(setup):autoPick(noOthers()?classicFive(ff):ff),ids=new Set(Object.values(pick).filter(id=>id!=null));
  seasonOthers(ids);
  const r=foundSlots(pick,{fac:ff,ai:false,name:setup&&setup.name,hall:hallOf(setup),gather:!!setup}); // the five set out at level 1 from their hall (the setup's town, every member standing in it, #771), agent-played from the first tick (#148)
  if(r.ok&&LVL_FLOOR>1)for(const a of S.agents.filter(h=>ids.has(h.id))){const {x,y,zone,state,dest,townStep}=a;season(a,LVL_FLOOR);Object.assign(a,{x,y,zone,state,dest,townStep})} // a map that begins above level 1 (#1013): the career, and they still stand in their hall
  if(r.ok){if(setup){const profs=applyMinds(setup);S.setup={world:setup.world,seed:setup.seed,fac:setup.fac,dm:setup.dm,...(hallOf(setup)?{hall:setup.hall}:{}),...(setup.prologue?{prologue:setup.prologue}:{}),...(profs&&Object.keys(profs).length?{profs}:{})}}}
  return r.ok?r.fellowship:null}

// Everyone not chosen starts part-way through a career (START_BANDS), then the line about the worn roads.
function seasonOthers(ids){if(noOthers()){emptyRoads();return}
  for(let f=0;f<FAC.length;f++){const hs=S.agents.filter(a=>a.fac===f&&!ids.has(a.id)&&a.state!=='dead');
    for(let i=hs.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[hs[i],hs[j]]=[hs[j],hs[i]]} // shuffle, so level does not follow class order
    hs.forEach((a,i)=>season(a,Math.max(LVL_FLOOR,Math.min(LVL_CAP,startLevel((i+rnd())/hs.length)))))}
  const bg=S.agents.filter(a=>!ids.has(a.id)),lv=bg.map(a=>a.lvl);
  log({t:ACTIVE_SPEC.name,c:'gd'},'’s roads are already worn: ',String(bg.length),' heroes of ',...sidesHere(),' hunt its wilds, from level ',String(Math.min(...lv)),' to ',String(Math.max(...lv)),'.')}

// No setup and no roster to pick from (#780): the classic five are made for the company.
const classicFive=f=>{for(const c of CLASSIC)makeHero(f,c,null,0);return f};
// A world with no others (#780): nobody to season, and the Chronicle says so.
const emptyRoads=()=>log({t:ACTIVE_SPEC.name,c:'gd'},'’s roads lie empty of banners: no other hero hunts its wilds.');

// Apart (setup v2, #453): every hero sets out from its own start town, one company per group, a company of one for
// a hero with no group. Level 1 in town, or seasoned to the low end of its start region's band and out hunting
// there. Every hero agent-played from the first tick (#148). Returns the first company.
function openApart(setup){
  const ids=pickApart(setup),hs=ids.map(id=>S.agents.find(a=>a.id===id));
  seasonOthers(new Set(ids));
  const made=[];
  for(const g of groupsOf(setup)){const lead=hs[g[0]],st=startOf(lead,setup.heroes[g[0]]),town=st.town,group=g.map(i=>hs[i]);
    for(const a of group){const was=homeOf(a).name;if(was!==town.name)a.born=was; // their people's town stays in their origin text (#771)
      a.town=town.name;Object.assign(a,standAt(town.x0+2+rnd()*7,town.y0+4+rnd()*3));a.state='town';a.dest=null}
    const lvl=Math.max(LVL_FLOOR,st.lvl);
    if(lvl>1){for(const a of group){season(a,lvl);
        if(st.zone!=null&&a.zone!==st.zone){const p=zonePoint(st.zone,null,town.gate);a.zone=st.zone;a.x=p.x;a.y=p.y}}
      const p={x:group[0].x,y:group[0].y}; // a group out hunting stands together too (#771): season() drew each a point of its own
      if(group.length>1)group.forEach((a,i)=>{const q=spreadAt(p,i,group.length);Object.assign(a,WALKABLE.includes(tileAt(q.x,q.y))&&!solidAt(q.x,q.y)?q:p)})}
    else for(const a of group)record(a,'Set out from '+town.name+(group.length>1?' with '+group.filter(b=>b!==a).map(b=>b.name).join(' and '):' alone')+'.');
    const r=foundCompany(group,{hall:town.name,name:group.length>1?group.map(b=>b.name).join(' and '):group[0].name});
    if(!r.ok)continue;made.push(r.company);
    for(const a of group){if(a.brain){disableBrain(a);delete a.fellowBrain}markPlayer(a,true)}
    for(const i of g){const h=setup.heroes[i],a=hs[i];if(h.profs&&h.profs.length)seedProfs(a,h.profs);
      const id=resolveArchetype(setup,i);if(id&&applyArchetype(a,id,group.filter(b=>b!==a)))a.persona.edited=true}
    const who=group.flatMap((b,i)=>i?[i===group.length-1?' and ':', ',b]:[b]),line=[...who,group.length>1?' set out together from '+town.name+'.':' sets out alone from '+town.name+'.'];
    campaign(r.company,'found',...line);log(...line)}
  if(made.length&&S.followId==null)S.followId=made[0].id;
  setDmSeat(true); // the DM is always an agent (#520): the seat is open from the first tick
  S.setup={world:setup.world,seed:setup.seed,fac:setup.fac,mode:'apart',dm:setup.dm,...(setup.prologue?{prologue:setup.prologue}:{})};
  return made[0]||null}
