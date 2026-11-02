// The DM's first priority (issue #165): the Fellowship first, then the overall world. One small module
// both DMs read: where the Fellowship is, what is open for it, whether a DM action touched it, and the
// running share of DM actions that did. DOM-free, rolls no random number, reads S only (it imports no
// sim module, so dmlog, levers, staged and dm can all use it). With no Fellowship every function is
// inert and the world plays exactly as before.
//
//   focus()        null without a living Fellowship; else {ids:Set, town, zone, zones:Set, x, y, field, busy}
//                    town   the CITY row of the Fellowship's hall (the board that serves them first)
//                    zone   the region of the leader's party in the field (or the hall's region)
//                    zones  regions the Fellowship is in or has a running job in
//                    busy   a Fellowship member has an adventure under way
//   touches(e)     does a DM log entry concern the Fellowship (by heroes, town, region or scene)?
//   countable(e)   is this DM log entry a DM action (a board post, an applied lever, a staged scene)?
//   tally(e)       bump S.dmFocus {acts, fellow, day:{d,acts,fellow}} for a countable entry
//   share()        the share of DM actions that touched the Fellowship (null before any)
//   pullTouches(name, p, z)  does a lever pull concern the Fellowship (for the reserved daily share)?
import {S} from './state.js';
import {ZONES,CITY,zoneAt,dist} from '../world/map.js';

export const FOCUS={
  RESERVE:.34,   // share of a lever's per-day limit (and of the staged scenes) kept for the Fellowship
  NEAR:16,       // tiles from a member: a pull or a staged spot this close concerns the Fellowship
  MIN_ACTS:6,    // actions before the share means anything (dmcheck, the digest)
};
const DAY=1440;
const alive=a=>a&&a.state!=='dead';

export function focus(){const F=S.fellowship;if(!F)return null;
  const ids=new Set(F.ids||[]),L=S.agents.filter(a=>ids.has(a.id)&&alive(a));if(!L.length)return null;
  const party=(S.parties||[]).find(p=>p.fellow),lead=party&&party.leader&&alive(party.leader)&&ids.has(party.leader.id)?party.leader:L[0];
  const field=L.filter(a=>a.state!=='town'&&!a.hidden),at=field.find(a=>a===lead)||field[0]||lead;
  const town=CITY.find(c=>c.name===F.hall)||CITY.find(c=>c.fac===F.fac)||CITY[0]||null;
  const zones=new Set(),z0=zoneAt(at.x,at.y);if(z0>=0)zones.add(z0);
  for(const a of field){const z=zoneAt(a.x,a.y);if(z>=0)zones.add(z)}
  let busy=false;
  for(const v of S.adventures||[])if(v.phase==='active'&&v.mem&&v.mem.some(id=>ids.has(id))){busy=true;if(v.z!=null&&v.z>=0)zones.add(v.z)}
  return {ids,town,zone:z0>=0?z0:null,zones,x:at.x,y:at.y,field:field.length,busy,members:L}}

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
export function tally(e){if(!countable(e))return;const f=focus();if(!f)return;
  const F=S.dmFocus||(S.dmFocus={acts:0,fellow:0,day:{d:-1,acts:0,fellow:0}}),t=touches(e,f)?1:0,D=dayRec(F);
  F.acts++;F.fellow+=t;D.acts++;D.fellow+=t}
export function share(){const F=S.dmFocus;return F&&F.acts>0?F.fellow/F.acts:null}
export const focusStats=()=>{const F=S.dmFocus;return F?{acts:F.acts,fellow:F.fellow,share:F.acts?Math.round(100*F.fellow/F.acts)/100:null}:{acts:0,fellow:0,share:null}};

// A lever pull that concerns the Fellowship: its region, its town, one of its members, or a spot near one.
export function pullTouches(name,p,z,f=focus()){if(!f)return false;p=p&&typeof p==='object'?p:{};
  if(z!=null&&f.zones.has(z))return true;
  if(p.hero!=null&&f.ids.has(Number(p.hero)))return true;
  if(p.for!=null&&f.ids.has(Number(p.for)))return true;
  if(p.town&&f.town&&p.town===f.town.name)return true;
  const sp=p.spec&&typeof p.spec==='object'?p.spec:null;
  if(sp&&(sp.for!=null&&f.ids.has(Number(sp.for))||sp.zone!=null&&f.zones.has(sp.zone)))return true;
  if(p.region!=null&&f.zone!=null&&(p.region===f.zone||String(p.region).toLowerCase()===String(ZONES[f.zone]).toLowerCase()))return true;
  const at=p.at&&typeof p.at==='object'?p.at:p;return nearMember(f,at)}

// The size of the share a limit keeps for the Fellowship: none for a limit of 1, else at least one.
export const reserveOf=limit=>limit>=2?Math.max(1,Math.floor(limit*FOCUS.RESERVE)):0;
