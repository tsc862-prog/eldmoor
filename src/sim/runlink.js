// Runner links (issue #148): is an agent-played hero's runner there to decide? Owned by ai-designer. DOM-free, no RNG.
// The Fellowship is always agent-played, and every decision belongs to its agents. Whether a decision waits or falls to
// reflex depends on the member's runner, as the relay's claims report it (the host passes them in):
//   connected  the runner is calling tools                         -> the decision waits for it (long cap, with a notice)
//   waiting    a runner holds the hero but is thinking or between   -> the decision waits for it (connected but slow)
//              turns (its claim is refreshed every 10 s)
//   none / offline / anything else: the runner is gone             -> the decision waits for the owner, who answers the
//              runner-stop alert (Restart, or Resume: reflexes decide until a runner returns)
// Hosts: the page (ui/runalert.js wires player-bridge's links and the alert's Resume), play-headless (the relay's claims,
// no owner to ask: reflexes at once when no runner holds the hero). With no host (npm run sim, the checks) nobody
// plays the members, so their reflexes decide at once: the world never waits on a runner that does not exist.
let linkFn=null,ackFn=null;
// fn(a) -> 'connected' | 'waiting' | 'none' | ...; null clears it
export function setRunnerLinks(fn){linkFn=typeof fn==='function'?fn:null}
export const runnerLinks=()=>linkFn; // the host's link function, so a check can put it back (#603)
// fn(a) -> true when the owner let reflexes decide for a hero whose runner is gone; null = always (no owner to ask)
export function setReflexAck(fn){ackFn=typeof fn==='function'?fn:null}
const LIVE={connected:1,waiting:1};
// A host reports runner links (the page, play-headless); without one (npm run sim, the checks) nobody can say a runner left.
export const hasLinks=()=>!!linkFn;
export const runnerLink=a=>!a||!a.player?'off':linkFn?String(linkFn(a)||'none'):'none';
// A runner holds this hero: its decisions wait for it.
export const agentLive=a=>!!(a&&a.player&&a.state!=='dead'&&LIVE[runnerLink(a)]);
// A reflex may decide for this hero now: not agent-played, dead, or its runner is gone and the owner said so.
export const reflexMay=a=>!a||!a.player||a.state==='dead'||(!agentLive(a)&&(!ackFn||!!ackFn(a)));
// The runner is gone and the owner has not answered yet: the decision holds (the page's alert pauses the world).
export const ownerHeld=a=>!!(a&&a.player&&a.state!=='dead'&&!agentLive(a)&&!reflexMay(a));
