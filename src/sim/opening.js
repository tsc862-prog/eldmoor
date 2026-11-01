// A new world's opening (issue #111). Owned by ai-designer. DOM-free.
//
// By default a fresh world (init(), never a restored save) founds the default Fellowship at once
// and lets the other heroes start part-way through their careers, so the five set out into a world
// that already has veterans, middling hunters and greenhorns in it:
//   - the Fellowship: one faction (rolled per seed), the "form one for me" pick (autoPick) of its
//     level-1 roster, founded with found() in the leader's home town, Minds scripted ('off'); the
//     owner switches members to AI or Agent from their rows. They start at level 1 like everyone used to.
//   - background heroes: a starting level drawn from START_BANDS (stratified per faction, so both
//     factions get the same spread), placed hunting in the region that fits that level (zoneFor,
//     nearest their home town), with worn gear, gold, kills, ability growth and a line of history.
// Hardcore replacements (step's recruits, the Fellowship's recruit()) still arrive at level 1.
//
// The old start (28 level-1 heroes in town, no Fellowship) is kept for balance comparisons:
// ELDMOOR_FELLOWSHIP=0 in Node, ?fellowship=0 in the browser, or init({fellowship:false}).
import {rnd,ri} from '../core/rng.js';
import {ZONES,zoneFor,zonePoint} from '../world/map.js';
import {homeOf} from '../data/races.js';
import {FAC} from '../data/factions.js';
import {SLOTS} from '../data/items.js';
import {S} from './state.js';
import {log,fac} from './chronicle.js';
import {xpNeed,maxHp,seedLevel} from './heroes.js';
import {makeItem,syncGear} from './gear.js';
import {record,first} from './history.js';
import {found,autoPick} from './fellowship.js';
import {pickSetup,applyMinds,cleanSetup} from './setup.js';

// Starting levels of background heroes: weight per band, levels spread evenly inside a band.
// About 30% greenhorns (1-3), 36% journeymen (4-7), 24% seasoned (8-11), 10% veterans (12-15).
export const START_BANDS=[{lo:1,hi:3,w:.30},{lo:4,hi:7,w:.36},{lo:8,hi:11,w:.24},{lo:12,hi:15,w:.10}];

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

// The opening for a fresh world. Called by init() after the level-1 roster exists.
export function opening(o={}){
  const setup=o.setup?cleanSetup(o.setup):null; // New World setup (sim/setup.js, #133): chosen classes, names, peoples and minds
  if(!setup&&!fellowshipStart(o)){
    log('Twenty-eight new heroes of ',fac(0),' and ',fac(1),' arrive in ',{t:'Eldmoor',c:'gd'},'. Every one of them is level 1.');return null}
  const ff=setup?setup.fac:o.fac!=null?o.fac:rnd()<.5?0:1,pick=setup?pickSetup(setup):autoPick(ff),ids=new Set(Object.values(pick).filter(id=>id!=null));
  for(let f=0;f<FAC.length;f++){const hs=S.agents.filter(a=>a.fac===f&&!ids.has(a.id)&&a.state!=='dead');
    for(let i=hs.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[hs[i],hs[j]]=[hs[j],hs[i]]} // shuffle, so level does not follow class order
    hs.forEach((a,i)=>season(a,startLevel((i+rnd())/hs.length)))}
  const bg=S.agents.filter(a=>!ids.has(a.id)),lv=bg.map(a=>a.lvl);
  log({t:'Eldmoor',c:'gd'},'’s roads are already worn: ',String(bg.length),' heroes of ',fac(0),' and ',fac(1),' hunt its wilds, from level ',String(Math.min(...lv)),' to ',String(Math.max(...lv)),'.');
  const r=found(pick,{fac:ff,ai:false,name:setup&&setup.name}); // the five set out at level 1 from their hall, Minds scripted unless the setup chose
  if(r.ok){r.fellowship.minds='off';if(setup){applyMinds(setup);S.setup={world:setup.world,seed:setup.seed,fac:setup.fac,dm:setup.dm}}}
  return r.ok?r.fellowship:null}
