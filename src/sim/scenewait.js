// Scene waits (issue #515): what the table needs to know about a member's runner, and what a member needs to know
// about the table while its turn is in flight. Owned by brain-builder. DOM-free, no RNG, never read by step() outside
// an open Table scene with a live agent, so a world with no runner (npm run sim, the seeded checks) is unchanged.
//
//   queued     A runner tells the game (POST /play/pace {queued:true}) that a member's scene answer is coming but waits
//              behind something: its own turn in flight, or other members' calls on the runner's one model queue. The
//              table then waits up to SW.EXTRA_MS more for that live member before its reflex acts (sc.q, per scene).
//   missed     A live member (its runner held it) whose scene turn was resolved by reflex after the wait: sc.miss, read by
//              the behavior watch (src/sim/behavior.js) as the `scene-missed` anomaly.
//   waited     How long the table had waited on a member when its scene_act came (table seconds: the paused world's
//              real time), returned by scene_act as waited_s and logged per turn (sceneS) for the latency report.
//   waits note Every tool result of a member whose own scene is open (other than scene_act) carries a short line saying
//              so, so a turn already in flight when the scene opened learns of it at its next call.
import {sceneOf} from './scenes.js'; // the member's own company's scene (#518: one open scene per company)

export const SW={EXTRA_MS:90000}; // at most this much longer (real ms) for a live member its runner reports as queued

// (in a turns scene a member whose turn has passed cannot answer any more, as sceneAct says: not due)
const unanswered=(sc,a)=>!!(sc&&a&&sc.ids.includes(a.id)&&!sc.acts[a.id]&&sc.phase!=='outcome'&&sc.phase!=='done'&&!(sc.all&&sc.resolved)&&(sc.all||sc.phase!=='turn'||sc.ids.indexOf(a.id)>=sc.i));
// The open scene still waits for this member's answer (any phase before the outcome; it may answer early).
export const sceneDue=a=>unanswered(sceneOf(a),a);

// A runner's report: the member's answer is queued (on) or no longer (off). -> the pace answer.
export function markQueued(a,on){const sc=sceneOf(a);
  if(!a||!a.player)return {ok:false,error:'not agent-played'};
  if(!on){if(sc&&sc.q)sc.q=sc.q.filter(id=>id!==a.id);return {ok:true,queued:false}}
  if(!unanswered(sc,a))return {ok:true,queued:false,why:'no scene waits for you'};
  const q=sc.q||(sc.q=[]);if(!q.includes(a.id))q.push(a.id);
  return {ok:true,queued:true,scene:sc.title,extra_s:Math.round(SW.EXTRA_MS/1000)}}
// The real-time wait the table gives this live member: its base (TABLE.liveMs), plus the bounded extra when queued.
export const liveLimit=(sc,a,base)=>base+(sc&&sc.q&&a&&sc.q.includes(a.id)?SW.EXTRA_MS:0);
// The table ran out of time for a live member: its reflex acts (the behavior watch reports it).
export function missed(sc,a){if(!sc||!a)return;const L=sc.miss||(sc.miss=[]);if(!L.includes(a.id))L.push(a.id)}
// Table seconds the scene had waited on this member when it answered (0 before its turn in a turns scene).
export function waitedS(sc,a){if(!sc||!a)return 0;const t=sc.all?(sc.w&&sc.w[a.id]?sc.w[a.id].t:0):sc.phase==='turn'&&sc.ids[sc.i]===a.id?sc.t:0;
  return Math.round((Number(t)||0)*10)/10}
// The line a member's tool results carry while its own scene waits, or null.
export function waitsNote(a,options){if(!sceneDue(a))return null;const sc=sceneOf(a);
  const keys=(options||[]).map(o=>String(o).split(' = ')[0]).filter(Boolean);
  return 'A Table scene waits on you ('+sc.title+'): answer with scene_act now'+(keys.length?' (options: '+keys.join(', ')+')':'')+'; the party is held until you do.'}
