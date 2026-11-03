// Follow (issue #445, epic #402 slice 8): walk at a hero's side without joining them. Owned by ai-designer. DOM-free, no RNG.
// Agent-played heroes only (the `follow` tool in sim/player.js); the scripted world never comes here, so seeded hashes hold.
//   follow       a.pq=[{kind:'follow', id, name, until?, last}]: the follower keeps beside the hero it follows (FOLLOW.GAP tiles
//                off, on its side), at the hero's pace, hurrying once it falls past half its sight. Not a company: no shared XP,
//                no votes, no party shout. Any other order (move_to, hunt, fight, rest, flee) replaces the command and ends it.
//                It defends when struck, drinks a potion and flees below its flee line as every reflex does; it never stops
//                to hunt or loot.
//   lost them    (owner's choice on #445) a follower that loses sight walks to the spot where it last saw them (cmd.last, its
//                own knowledge) and, if they are not in sight there, stops with an urgent event ("You lost sight of Dovas
//                near the Hollow road"); the followed hero is told "X has fallen behind" (soft). A place name, never
//                coordinates: the event says only what the follower saw.
//   ends too     the hours given run out; the followed hero falls in sight of the follower; walks into a town of the other
//                faction; (another faction) walks out of the town they shared.
//   standing     autopilot (sim/player.js) keeps a standing follow order (a.playOrder {kind:'follow'}): when a reflex took the
//                command away (fled home, camp) and the hero is in sight again, it falls in behind them once more.
import {S} from './state.js';
import {CITY,dist,zoneAt} from '../world/map.js';
import {sightMul} from './weather.js';
import {moveTo,maxHp} from './heroes.js';
import {ev,notify} from './notify.js';
import {placeNear} from './reach.js';
import {nearHeroes} from './spatial.js';

export const FOLLOW={SIGHT:12,GAP:1.2,NEAR:1.7,PACE:2.5,HURRY:2.9,MAX_H:12}; // SIGHT = PK.SIGHT in sim/player.js
const hero=id=>S.agents.find(x=>x.id===id)||null;
const sight=a=>FOLLOW.SIGHT*sightMul(zoneAt(a.x,a.y));
const cityOf=p=>CITY.find(c=>p.x>=c.x0-.5&&p.x<=c.x1+1.5&&p.y>=c.y0-.5&&p.y<=c.y1+1.5)||null;
const alive=b=>!!(b&&b.state!=='dead');
// The follower can see b now: alive, not hidden (the Crypt), within its sight (or in the same town).
export function seesHero(a,b){if(!alive(b)||b.hidden)return false;const c=cityOf(a);return dist(a,b)<=sight(a)||!!(c&&c===cityOf(b))}
export const followCmd=a=>{const c=a&&a.pq&&a.pq[0];return c&&c.kind==='follow'?c:null};
const lastOf=b=>({x:b.x,y:b.y,where:placeNear(b),at:Math.round(S.gameMin)});

// Why a cannot follow b, or null. b is any hero the agent named (sim/player.js resolves it).
export function followRefusal(a,b){
  if(!b||b===a)return 'Follow whom? Name a hero you can see.';
  if(!alive(b))return b.name+' has fallen.';
  if(!seesHero(a,b))return b.name+' is not in sight. You can only fall in behind someone you can see.';
  if(b.fac!==a.fac&&!(cityOf(a)&&cityOf(a)===cityOf(b)))return b.name+' is of the other side: out here you will not walk at an enemy\'s side.';
  if(a.party&&a.party.leader===a&&a.party.mem.length>1)return 'You lead your company: lead_to takes them with you, or leave_party first.';
  const fb=followCmd(b);if(fb&&fb.id===a.id)return b.name+' already follows you.';
  return null}
// Start following: the command (the caller puts it on a.pq) and the followed hero's soft event.
export function startFollow(a,b,hours){const h=hours==null||hours===''?null:Math.max(1,Math.min(FOLLOW.MAX_H,Math.round(Number(hours)||1)));
  const cmd={kind:'follow',id:b.id,name:b.name,last:lastOf(b)};if(h){cmd.h=h;cmd.until=Math.round(S.gameMin)+h*60}
  notify(b,a.name+' falls in behind you.',false);return cmd}

function stop(a,cmd,text,urgent){if(a.pq&&a.pq[0]===cmd)a.pq.shift();a.moving=false;a.dest=null;
  if(a.playOrder&&a.playOrder.kind==='follow')a.playOrder=null; // the order is over: autopilot does not take it up again
  if(a.state==='travel')a.state=cityOf(a)?'town':'hunt';ev(a,text,urgent)}

// One step of the follow command (sim/player.js routes it here from town, travel, hunt and return).
export function followStep(a,dt,cmd){a.cd-=dt;const b=hero(cmd.id),mh=maxHp(a);
  if(cmd.until!=null&&S.gameMin>=cmd.until){stop(a,cmd,'You stop following '+cmd.name+': the '+cmd.h+' hour'+(cmd.h>1?'s':'')+' you gave are up.',true);return true}
  if(b&&b.state==='dead'&&!b.hidden&&dist(a,b)<=sight(a)){stop(a,cmd,cmd.name+' has fallen before your eyes. You stop following.',2);return true}
  const here=cityOf(a);a.state=here&&here.fac===a.fac?'town':'travel';
  a.hp=Math.min(mh,a.hp+mh*(a.state==='town'?.3:.015)*dt);
  if(seesHero(a,b)){const c=cityOf(b);
    if(c&&c.fac!=null&&c.fac!==a.fac){stop(a,cmd,cmd.name+' goes into '+c.name+', where you cannot follow.',true);return true}
    if(b.fac!==a.fac&&!(here&&here===c)){stop(a,cmd,cmd.name+' walks out of town; you will not walk at an enemy\'s side out here.',true);return true}
    cmd.last=lastOf(b);if(cmd.seek){delete cmd.seek}
    const d=dist(a,b);if(d<=FOLLOW.NEAR){a.moving=false;return true}
    const k=FOLLOW.GAP/d,x=b.x+(a.x-b.x)*k,y=b.y+(a.y-b.y)*k; // beside them, on the side the follower walks
    moveTo(a,x,y,dt,d>sight(a)/2?FOLLOW.HURRY:FOLLOW.PACE);return true}
  // out of sight: walk to where they were last seen; not there either -> lost them
  const L=cmd.last;if(!cmd.seek){cmd.seek=1}
  if(!L||moveTo(a,L.x,L.y,dt,FOLLOW.HURRY)){
    stop(a,cmd,'You lost sight of '+cmd.name+(L?' near '+L.where:'')+'. You went to where you last saw them, and they are gone; you stop following.',2);
    if(alive(b))notify(b,a.name+' has fallen behind.',false);
    return true}
  return true}

// What the follower knows of its own follow, for look, status and the pace header; null when it follows no one.
export function followLine(a){const c=followCmd(a);if(!c)return null;const b=hero(c.id);
  const left=c.until!=null?' ('+Math.max(0,Math.round((c.until-S.gameMin)/60*10)/10)+' h left)':'';
  if(seesHero(a,b))return 'following '+c.name+(dist(a,b)<=FOLLOW.NEAR+.5?' (beside you)':' (in sight, catching up)')+left;
  return 'looking for '+c.name+': walking to where you last saw them'+(c.last?', near '+c.last.where:'')+left}
// Heroes in sight who follow a (look lists them as walking with you).
export function followersOf(a){const R=sight(a);return nearHeroes(a.x,a.y,R).filter(b=>b!==a&&alive(b)&&!b.hidden&&dist(a,b)<=R&&(followCmd(b)||{}).id===a.id).sort((x,y)=>x.id-y.id)}
// The pace header's follow block: {following?, followed_by?} or null.
export function followBrief(a){const f=followLine(a),by=followersOf(a).map(b=>b.name);if(!f&&!by.length)return null;
  const o={};if(f)o.following=f;if(by.length)o.followed_by=by;return o}

// Autopilot (sim/player.js): a standing follow order is taken up again when the hero is in sight; once they are not, the order lapses.
export function standingFollow(a){const o=a.playOrder;if(!o||o.kind!=='follow')return null;
  if(o.until!=null&&S.gameMin>=o.until){a.playOrder=null;return null}
  const b=hero(o.id);if(!seesHero(a,b)||followRefusal(a,b)){a.playOrder=null;return null}
  const cmd={kind:'follow',id:b.id,name:b.name,last:lastOf(b),auto:'falling in behind '+b.name+' again (your order: follow)',label:'follow'};
  if(o.until!=null){cmd.until=o.until;cmd.h=o.h}return cmd}
