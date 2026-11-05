// A hero the DM brings on purpose (issue #780): a rival, a wandering healer, a band when the story wants one. The DM agent's
// summon_hero tool pulls the lever below (same daily caps, companies' reserve, pile-on rule and DM log as every lever; `when`
// can fire it). The hero is an ordinary background hero, made by makeHero at the level asked and played by the scripted rules:
// usual oath and origin, a career to match its level. It is never a company member and never an agent's.
//
// Limits: SUMMON.PER_DAY a game day; SUMMON.ALIVE of them alive at once; a level at most SUMMON.LVL_UP above the average of the
// company nearest the spot; never inside a town no company stands in, nor inside a town of another faction; never near a
// company member badly hurt in the field (PILING in dmagent.js). A summoned hero who dies leaves no replacement behind.
// The DM's why is the lever's reason: the DM log only, never a hero.
//
// State on the hero: a.summoned {day}. No other state, so a world with no summons is unchanged. Owned by ai-designer.
import {rnd} from '../core/rng.js';
import {S,dayNo} from './state.js';
import {CITY,ZONES,zoneAt,dist} from '../world/map.js';
import {standAt} from '../world/passable.js';
import {FAC} from '../data/factions.js';
import {CLS} from '../data/classes.js';
import {racesOf,raceOf,homeOf} from '../data/races.js';
import {register,LEVERS,spotErr} from './levers.js';
import {makeHero,maxHp} from './heroes.js';
import {season} from './opening.js';
import {restyle} from './setup.js';
import {focuses} from './dmfocus.js';
import {log} from './chronicle.js';
import {record} from './history.js';

export const SUMMON={
  PER_DAY:2,   // heroes summoned a game day
  ALIVE:8,     // alive at once
  LVL_UP:2,    // levels above the nearest company's average
  MAX_LVL:20,
  NAME_MAX:24,
};
const NAME_OK=/^[\p{L}][\p{L}' -]*$/u;
const living=a=>a&&a.kind==='hero'&&a.state!=='dead';
const inTown=(a,c)=>a.x>=c.x0-1&&a.x<=c.x1+1&&a.y>=c.y0-1&&a.y<=c.y1+1;
const facIndex=v=>{const lo=String(v==null?'':v).trim().toLowerCase();const i=FAC.findIndex(f=>f.name.toLowerCase()===lo);return i>=0?i:/^\d+$/.test(lo)&&FAC[+lo]?+lo:-1};
const peopleOf=(f,v)=>{const lo=String(v==null?'':v).trim().toLowerCase();return racesOf(f).find(r=>r.id===lo||r.name.toLowerCase()===lo)||null};
const townRow=v=>CITY.find(c=>c.name===v)||null;
const spotOf=p=>{if(p.at)return p.at;const c=townRow(p.town);return c?{x:(c.x0+c.x1)/2,y:(c.y0+c.y1)/2}:null};
export const summonedAlive=()=>S.agents.filter(a=>a.summoned&&living(a));
// For dm_status: how many walk the world, and who.
export const summonView=()=>{const L=summonedAlive();return {alive:L.length+'/'+SUMMON.ALIVE,heroes:L.map(a=>({id:a.id,name:a.name,cls:a.cls,lvl:a.lvl,fac:FAC[a.fac].name}))}};

// The company nearest the spot: its average level says how strong a summoned hero may be.
function nearest(at){let best=null,bd=Infinity;for(const f of focuses())for(const a of f.members){const d=dist(a,at);if(d<bd){bd=d;best=f}}return best}
const avgOf=f=>f.members.reduce((t,a)=>t+a.lvl,0)/f.members.length;
// {cap, base, who}: the highest level allowed at this spot and the level asked for by default. With no company in the world
// the strongest living hero stands in for it (an empty world: level 1).
function levelBand(at){const f=at&&nearest(at);
  if(f){const v=avgOf(f);return {cap:Math.min(SUMMON.MAX_LVL,Math.floor(v)+SUMMON.LVL_UP),base:Math.max(1,Math.round(v)),who:(f.company.name||'the company')+' (average level '+Math.round(v*10)/10+')'}}
  const top=Math.max(1,...S.agents.filter(living).map(a=>a.lvl));return {cap:Math.min(SUMMON.MAX_LVL,top+SUMMON.LVL_UP),base:top,who:'the strongest hero alive'}}

function townError(p,f){const c=townRow(p.town);
  if(!focuses().some(o=>o.members.some(a=>inTown(a,c))))return 'no company stands in '+c.name+', and nobody is summoned inside a town no company is in: use a spot outside its gate (survey near '+c.name+' lists open ground as "x,y") or near a region';
  if(c.fac!==f)return c.name+' is a town of the '+FAC[c.fac].name+' and this hero is of the '+FAC[f].name+': use a spot outside its gate (survey near '+c.name+' lists open ground as "x,y")';
  return null}

// Registered by installSummonLever (sim/index.js, after every module has loaded: the sim's imports are one big cycle).
const SUMMON_LEVER={name:'summon_hero',allow:['cls'],about:'Bring a background hero into the world: a rival, a wandering healer, a band when the story wants one. Scripted, with the usual oath and origin. at: open ground; town: only a town of their faction a company stands in. level: at most '+SUMMON.LVL_UP+' above the nearest company\'s average (default that average).',
  params:{fac:{type:'str',max:24},cls:{type:'enum',values:Object.keys(CLS)},level:{type:'int',min:1,max:SUMMON.MAX_LVL,opt:true},at:{type:'point',opt:true},town:{type:'town',opt:true},name:{type:'str',max:40,opt:true},people:{type:'str',max:24,opt:true}},
  limits:{perDay:SUMMON.PER_DAY},cooldown:0,region:p=>p.at?zoneAt(p.at.x,p.at.y):null,
  check(p){const f=facIndex(p.fac);if(f<0)return 'fac must be one of '+FAC.map(x=>x.name).join(', ');
    const n=summonedAlive().length;if(n>=SUMMON.ALIVE)return 'limit: '+SUMMON.ALIVE+' heroes you summoned are alive already; bring another when one has fallen, or use place_person for someone who is not a hero';
    if(p.people!=null&&!peopleOf(f,p.people))return 'people must be a people of the '+FAC[f].name+': '+racesOf(f).map(r=>r.name).join(', ');
    if(p.name!=null){if(p.name.length<2||p.name.length>SUMMON.NAME_MAX||!NAME_OK.test(p.name))return 'name must be 2-'+SUMMON.NAME_MAX+' letters (spaces, hyphens and apostrophes allowed)';
      if(S.agents.some(a=>living(a)&&a.name.toLowerCase()===p.name.toLowerCase()))return 'a hero called '+p.name+' is alive already: pick another name or leave it out';}
    if(!!p.at===!!p.town)return 'give one of at (a point on open ground) or town';
    if(p.town){const e=townError(p,f);if(e)return e}
    else{const e=spotErr(p.at);if(e)return 'that spot is '+e+': survey lists open ground as "x,y"'}
    const B=levelBand(spotOf(p));if(p.level!=null&&p.level>B.cap)return 'level '+p.level+' is too high here: the nearest strength is '+B.who+', so at most level '+B.cap;
    return null},
  apply(p){const f=facIndex(p.fac),spot=spotOf(p),L=p.level!=null?p.level:levelBand(spot).base,a=makeHero(f,p.cls,null,0,p.name);
    if(p.people!=null)restyle(a,peopleOf(f,p.people).id);
    season(a,L); // the career of a hero of that level: gear, gold, kills, a line of history
    a.summoned={day:dayNo()};a.dest=null;a.townStep=1;a.hp=maxHp(a);
    let where;
    if(p.town){const c=townRow(p.town),was=homeOf(a).name;if(was!==c.name)a.born=was;
      a.town=c.name;Object.assign(a,standAt(c.x0+2+rnd()*7,c.y0+4+rnd()*3));a.state='town';where='in '+c.name}
    else{Object.assign(a,standAt(p.at.x,p.at.y));a.zone=zoneAt(a.x,a.y);a.state='hunt';where='in '+ZONES[a.zone]}
    record(a,'Came '+(p.town?'to '+p.town:'onto the roads of '+ZONES[a.zone])+'.');
    log('A ',raceOf(a).name,' ',p.cls.toLowerCase(),', ',a,', comes '+(p.town?'to '+p.town:'onto the roads of '+ZONES[a.zone])+'.');
    return {ok:true,effect:{hero:a.name,id:a.id,cls:a.cls,fac:FAC[f].name,people:raceOf(a).name,level:a.lvl,where,alive:summonedAlive().length+'/'+SUMMON.ALIVE}}},
  describe:p=>'a '+p.cls+(p.level?' of level '+p.level:'')+(p.town?' in '+p.town:' at '+p.at.x+','+p.at.y)};
export function installSummonLever(){if(!LEVERS.summon_hero)register(SUMMON_LEVER)}
