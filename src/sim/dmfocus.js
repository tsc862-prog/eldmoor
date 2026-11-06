// The DM's first priority (issue #165): the Fellowship first, then the overall world. One small module
// both DMs read: where the Fellowship is, what is open for it, whether a DM action touched it, and the
// running share of DM actions that did. DOM-free, rolls no random number, reads S only (it imports no
// sim module, so dmlog, levers, staged and dm can all use it). Since #450 every company of agent heroes is a thread
// (a solo is a company of one); with no company every function is inert and the world plays exactly as before.
//
//   focuses()      one record per company (#450), the followed company first, then id order; [] with none:
//                    {company, cid, ids:Set, town, zone, zones:Set, x, y, field, busy, members, lastTouched}
//   focusOf(C), focusFor(a)  one company's record; ffFor(h,f) is h that company's hall job; touchesWhich(e) -> [cid]
//   focus()        the five-slot Fellowship's record (the old single focus): null without a living Fellowship
//                    town   the CITY row of the Fellowship's hall (the board that serves them first)
//                    zone   the region of the leader's party in the field (or the hall's region)
//                    zones  regions the Fellowship is in or has a running job in
//                    busy   a Fellowship member has an adventure under way
//   touches(e)     does a DM log entry concern the Fellowship (by heroes, town, region or scene)?
//   countable(e)   is this DM log entry a DM action (a board post, an applied lever, a staged scene)?
//   tally(e)       bump S.dmFocus {acts, fellow, day:{d,acts,fellow}} for a countable entry
//   share()        the share of DM actions that touched the Fellowship (null before any)
//   pullTouches(name, p, z)  does a lever pull concern the Fellowship (for the reserved daily share)?
//   hallHooks(town)  the open hooks on that board that concern the Fellowship (the hall's own first), raw; [] without one
//   hallBoard(C?)  the watcher's rows for the hall board's jobs for the Fellowship (or for company C) (who posted it included; never hero-facing)
//   hallTitle(h)   a hook's title as the board shows it
import {S} from './state.js';
import {ZONES,REGIONS,CITY,zoneAt,dist} from '../world/map.js';
import * as ADV from '../data/adventures.js'; // pure table: job names for the board titles
import {slotted} from './company.js'; // the slotted company (#588)

export const FOCUS={
  RESERVE:.34,   // share of a lever's per-day limit (and of the staged scenes) kept for the Fellowship
  NEAR:16,       // tiles from a member: a pull or a staged spot this close concerns the Fellowship
  MIN_ACTS:6,    // actions before the share means anything (dmcheck, the digest)
  STARVE_MIN:360, // game minutes without a DM action for a company in the field before it counts as starved (#451)
  FAIR_MIN:240,   // a company touched this recently gives way to a starved one when only the reserve is left (#451)
};
const DAY=1440;
const alive=a=>a&&a.state!=='dead';

// One record per company (epic #402, issue #450): every company is a thread. The company of the hero being
// followed first, then id order. A record is {company, cid, ids:Set, town, zone, zones:Set, x, y, field, busy, members,
// lastTouched}; a company with no living member has none. Read straight from S.companies (no import of company.js).
const companyList=()=>(S.companies||[]).filter(C=>C&&C.ids&&C.ids.length).sort((x,y)=>x.id-y.id);
export function followedCompany(){const L=companyList();return L.find(C=>C.id===S.followId)||L[0]||null}
export function focusOf(C){if(!C)return null;
  const ids=new Set(C.ids||[]),L=S.agents.filter(a=>ids.has(a.id)&&alive(a));if(!L.length)return null;
  const party=(S.parties||[]).find(p=>p.company===C.id),lead=party&&party.leader&&alive(party.leader)&&ids.has(party.leader.id)?party.leader:L[0];
  const field=L.filter(a=>a.state!=='town'&&!a.hidden),at=field.find(a=>a===lead)||field[0]||lead;
  const town=CITY.find(c=>c.name===C.hall)||CITY.find(c=>c.fac===C.fac)||CITY[0]||null;
  const zones=new Set(),z0=zoneAt(at.x,at.y);if(z0>=0)zones.add(z0);
  for(const a of field){const z=zoneAt(a.x,a.y);if(z>=0)zones.add(z)}
  let busy=false;
  for(const v of S.adventures||[])if(v.phase==='active'&&v.mem&&v.mem.some(id=>ids.has(id))){busy=true;if(v.z!=null&&v.z>=0)zones.add(v.z)}
  return {company:C,cid:C.id,ids,town,zone:z0>=0?z0:null,zones,x:at.x,y:at.y,field:field.length,busy,members:L,party:party||null,lastTouched:touchedAt(C)}}
export function focuses(){const L=companyList(),f=followedCompany(),out=[];
  for(const C of f?[f,...L.filter(c=>c!==f)]:L){const r=focusOf(C);if(r)out.push(r)}
  return out}
// The focus of the five-slot Fellowship (the old single focus, kept for its callers): null without one.
export function focus(){const F=slotted();return F?focusOf(F):null}
// The focus of the company a hero rides with, or null.
export function focusFor(a){if(!a||a.company==null)return null;const C=companyList().find(c=>c.id===a.company);return C&&C.ids.includes(a.id)?focusOf(C):null}
// Is this posted job (h.ff) the hall job of the company behind f (h.cid, its id)? A job posted before companies (no h.cid) belongs to
// the five-slot Fellowship.
export const ffFor=(h,f)=>!!(h&&h.ff&&f&&(h.cid!=null?h.cid===f.cid:!!f.company.slots));

const zoneNames=f=>[...f.zones].map(z=>ZONES[z]);
// Do these map coordinates lie within FOCUS.NEAR of a living member?
export const nearMember=(f,p)=>!!(f&&p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&f.members.some(a=>dist(a,p)<=FOCUS.NEAR));

export function touches(e,f=focus()){if(!f||!e)return false;
  if((e.heroes||[]).some(id=>f.ids.has(id)))return true;
  const d=e.detail||{};
  if(d.fellow===true)return true;
  if(d.hero!=null&&f.ids.has(Number(d.hero)))return true;
  if(d.params&&d.params.hero!=null&&f.ids.has(Number(d.params.hero)))return true;
  if(e.kind==='hooks'){const a=d.added&&d.added[0];if(a&&a.for!=null&&f.ids.has(Number(a.for)))return true;
    if(a&&a.cid!=null)return a.cid===f.cid; // a company's hall job is that company's alone (#450)
    if(a&&a.zone!=null&&a.zone!=='any'&&zoneNames(f).includes(a.zone))return true;
    return !!(f.town&&e.town===f.town.name&&(d.added||[]).length)}
  if(d.region&&zoneNames(f).includes(d.region))return true;
  if(d.params&&pullTouches(d.lever,d.params,null,f))return true;
  if(d.at&&nearMember(f,d.at))return true;
  return false}

// A DM action: a hook posted, a lever applied, a scene staged. Everything else in the DM log is bookkeeping.
export function countable(e){if(!e)return false;const d=e.detail||{};
  if(e.kind==='hooks')return !!(d.added&&d.added.length);
  if(e.kind==='lever')return d.result==='applied'&&e.advId==null; // a lever inside an adventure's scene is that adventure's, not a DM action of its own
  return e.kind==='frame'&&d.staged!=null&&!d.met}

function dayRec(F){const d=Math.floor(S.gameMin/DAY);if(F.day.d!==d)F.day={d,acts:0,fellow:0};return F.day}
// Which companies a DM log entry concerns (their ids, focus order).
export function touchesWhich(e,fs=focuses()){return fs.filter(f=>touches(e,f)).map(f=>f.cid)}
// A DM action counts toward the share when any company rides; it touched the companies it concerns (S.dmFocus.by[id],
// and S.dmFocus.last[id], the game minute the DM last did something for them). share() is unchanged: any company counts.
export function tally(e){if(!countable(e))return;const fs=focuses();if(!fs.length)return;
  const F=S.dmFocus||(S.dmFocus={acts:0,fellow:0,day:{d:-1,acts:0,fellow:0}}),hit=touchesWhich(e,fs),t=hit.length?1:0,D=dayRec(F);
  F.acts++;F.fellow+=t;D.acts++;D.fellow+=t;
  if(hit.length){const by=F.by||(F.by={});for(const id of hit){by[id]=(by[id]||0)+1;(F.last||(F.last={}))[id]=Math.round(S.gameMin)}}}
// The game minute the DM last did something for company C (null: never). Kept on S.dmFocus, not on the company, so a save's
// company records stay as they were.
export const touchedAt=C=>{const L=S.dmFocus&&S.dmFocus.last;return C&&L&&L[C.id]!=null?L[C.id]:null};
export function share(){const F=S.dmFocus;return F&&F.acts>0?F.fellow/F.acts:null}
export const focusStats=()=>{const F=S.dmFocus;return F?{acts:F.acts,fellow:F.fellow,share:F.acts?Math.round(100*F.fellow/F.acts)/100:null}:{acts:0,fellow:0,share:null}};

// A lever pull that concerns the Fellowship: its region, its town, one of its members, or a spot near one.
export function pullTouches(name,p,z,f=focus()){if(!f)return false;p=p&&typeof p==='object'?p:{};
  if(z!=null&&f.zones.has(z))return true;
  if(p.hero!=null&&f.ids.has(Number(p.hero)))return true;
  if(p.for!=null&&f.ids.has(Number(p.for)))return true;
  if(p.company!=null&&Number(p.company)===f.cid)return true; // call_to names its company (#826)
  if(p.town&&f.town&&p.town===f.town.name)return true;
  const sp=p.spec&&typeof p.spec==='object'?p.spec:null;
  if(sp&&(sp.for!=null&&f.ids.has(Number(sp.for))||sp.zone!=null&&f.zones.has(sp.zone)))return true;
  if(p.region!=null&&f.zone!=null&&(p.region===f.zone||String(p.region).toLowerCase()===String(ZONES[f.zone]).toLowerCase()))return true;
  const at=p.at&&typeof p.at==='object'?p.at:p;return nearMember(f,at)}

// The size of the share a limit keeps for the Fellowship: none for a limit of 1, else at least one.
// Does a lever pull concern any company (the reserved share is kept for every company alike; fairness between them is #451)?
export const pullTouchesAny=(name,p,z,fs=focuses())=>fs.some(f=>pullTouches(name,p,z,f));
export const reserveOf=limit=>limit>=2?Math.max(1,Math.floor(limit*FOCUS.RESERVE)):0;
export const companyCount=()=>companyList().length;
const coName=C=>C.slots?'the Fellowship':C.name||'company '+C.id;

// Fairness between companies (#451): minutes since the DM last did something for each company (a company never touched counts
// from the start of the world), the spread between the longest and the shortest, and the companies starved: in the field with no
// DM action for FOCUS.STARVE_MIN. Read-only, no RNG. {spread, rows:[{cid, name, since, field}], starved:[{cid, name, since}]}; spread null below two companies.
export function fairness(fs=focuses()){
  const rows=fs.map(f=>{const t=touchedAt(f.company);return {cid:f.cid,name:coName(f.company),since:Math.round(S.gameMin-(t==null?0:t)),field:f.field}});
  const sinces=rows.map(r=>r.since);
  return {spread:rows.length>1?Math.max(...sinces)-Math.min(...sinces):null,rows,starved:rows.filter(r=>r.field>0&&r.since>=FOCUS.STARVE_MIN).map(r=>({cid:r.cid,name:r.name,since:r.since}))}}
// The fairness refusal of a lever pull (levers.js reserveOf's caller, only when just the reserve is left): a pull that touches
// companies the DM served in the last FOCUS.FAIR_MIN minutes, and none of them the followed one, gives way while another
// company is starved. Returns the refusal text or null. One company never refuses.
export function fairRefusal(name,p,z,fs=focuses()){if(fs.length<2)return null;
  const hit=fs.filter(f=>pullTouches(name,p,z,f));if(!hit.length||hit.some(f=>f===fs[0]))return null; // fs[0] is the followed company
  const recent=f=>{const t=touchedAt(f.company);return t!=null&&S.gameMin-t<FOCUS.FAIR_MIN};
  if(!hit.every(recent))return null;
  const st=fairness(fs).starved.filter(r=>!hit.some(f=>f.cid===r.cid));
  return st.length?'kept for '+st[0].name+' first':null}

// The hall board's jobs for the Fellowship (issues #326, #334). One selection for the agents' turn brief (sim/pace.js,
// which names only what the posting says) and the watcher's Fellowship panel (which may say who posted it): an open
// hook on that town's board that is for one of the five, the scripted DM's Fellowship job (ff), or tied to a region
// they ride or work in; a job for someone outside the Fellowship never. The hall's own Fellowship jobs first, then by
// age. Reads S only, no RNG.
export function hallHooks(town,f=focus()){if(!f||!town)return [];
  const mine=h=>ffFor(h,f)||(h.for!=null&&f.ids.has(h.for))||(h.zone!=null&&f.zones.has(h.zone));
  const L=(S.adventures||[]).filter(h=>h.phase==='open'&&h.town===town&&(h.for==null||f.ids.has(h.for))&&(!h.ff||ffFor(h,f))&&mine(h)); // another company's hall job is theirs (#450)
  return L.sort((x,y)=>(y.ff?1:0)-(x.ff?1:0)||x.id-y.id)}
const plainText=p=>Array.isArray(p)?p.map(x=>typeof x==='string'?x:x&&x.kind==='hero'?x.name:x&&x.t||'').join(''):String(p||'');
export const hallTitle=h=>{const T=ADV.ADVENTURES[h.tpl]||{},th=h.data&&h.data.thing;return String(h.title||(T.name||h.tpl)+(th?': '+plainText(th):'')+(h.data&&h.data.beast?' ('+h.data.beast+')':'')).slice(0,90)};
// Rows for the watcher: {id, title, region, band:[lo,hi]|null, day, by, oath:{id,name}|null, elite:{name,lvl,alive}|null, giver}.
export function hallBoard(C){const co=C||slotted();if(!co)return []; // a company's own jobs (#457); no C: the Fellowship's
  const f=focusOf(co);if(!f)return [];
  return hallHooks(co.hall,f).map(h=>{const z=h.zone!=null&&h.zone>=0?h.zone:null,R=z!=null&&REGIONS?REGIONS[z]:null,d=h.data||{};
    const who=h.for!=null?S.agents.find(a=>a.id===h.for):null;
    const E=d.eliteId!=null?S.mobs&&S.mobs.find(m=>m.id===d.eliteId):null;
    return {id:h.id,title:hallTitle(h),region:z!=null?ZONES[z]:null,band:R&&R.band?[R.band[0],R.band[1]]:null,
      day:Math.floor((h.born||0)/DAY)+1,by:h.by==='dm-agent'?'DM agent':h.ff?'scripted DM':'town board',
      oath:who?{id:who.id,name:who.name,...(who.goal&&who.goal.offered?{thread:true}:{})}:null,elite:d.beast?{name:d.beast,lvl:d.eliteLvl==null?null:d.eliteLvl,alive:!!E}:null,
      giver:h.giver&&h.giver.name||null}})}
