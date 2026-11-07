import {PRICES} from './providers/anthropic.mjs';
// Runner pacing (issue #126): a runner's turns follow the game, not a stopwatch. Shared by the hero
// runner (scripts/agent-player.mjs) and the Fellowship runner (scripts/fellowship.mjs); plain Node.
//
// Between turns the runner long-polls POST /play/pace (scripts/relay-mcp.mjs -> src/sim/pace.js) and
// starts the next turn when
//   - something cannot wait (attacked, badly hurt, a choice, a table scene): at once, even inside the
//     minimum gap (at most NOW_MAX such turns per NOW_WINDOW of real time; past that they wait for the gap,
//     except a choice or a table scene, which must be answered in time and always starts at once);
//   - something happened the agent has not read (an arrival, a vote, a party line, the narrator), or
//     `heartbeat` game minutes passed: once `minGap` real seconds have passed since the last turn.
// So a quiet hero at 1x takes a turn about once a real minute (240 game minutes = 40 s, plus the
// turn), and at 8x at most one per minGap seconds plus the turn. A paused world takes none.
// Hosts without /play/pace (an older relay or game page) fall back to the real-time estimate of the
// heartbeat at 1x, never less than the gap.
// Safety stop: failTracker(maxFails) counts failed or empty turns in a row (a turn that threw, made no
// tool call, or had every call rejected); the runner stops after maxFails of them.
export const PACE_DEFAULTS = {heartbeat: 120, minGap: 20, maxFails: 5};
// Another local model held by Ollama (the relay's minds, another runner) evicts ours on a single GPU: say so.
// And our own model held at another context size (issue #221) reloads on every call that asks ours.
export async function localModelNote(adapter, model) {
  const rows = adapter && adapter.held ? await adapter.held() : adapter && adapter.loaded ? ((await adapter.loaded()) || []).map(name => ({name, ctx: null})) : null;
  const others = (rows || []).map(m => m.name).filter(m => m !== model), notes = [];
  if (others.length) notes.push(`note: Ollama also holds ${others.join(', ')} in memory (the relay's minds or another runner?). On one GPU two local models evict each other and every call waits for a reload: use one local model for minds and runners.`);
  const ours = (rows || []).find(m => m.name === model), want = adapter && adapter.numCtx;
  if (ours && ours.ctx && want && ours.ctx !== want) notes.push(ctxNote(model, ours.ctx, want));
  return notes.length ? notes.join(' ') : null;
}
export const ctxNote = (model, held, want) => `note: Ollama holds ${model} at ${held}; runners ask ${want}, so it reloads each time. Set OLLAMA_NUM_CTX=${want} for everything that uses it (the relay, every runner) or restart them with one value.`;
// The local model a runner should use when nobody picked one (no --model): the one Ollama already holds in
// memory, when it is pulled (the relay's minds keep it loaded; a second model would never get the GPU).
// -> {model, note}
export async function preferLoaded(adapter, model, pulled = []) {
  const held = adapter && adapter.loaded ? await adapter.loaded() : null;
  if (!held || !held.length || held.includes(model)) return {model, note: null};
  const alt = held.find(m => pulled.includes(m));
  return alt ? {model: alt, note: `Ollama already holds ${alt} in memory (the relay's minds?), so this runner plays with it instead of ${model}; pick a model explicitly to override.`} : {model, note: null};
}
export const NOW_MAX = 2, NOW_WINDOW = 60000, POLL_REAL_MS = 10000, LEGACY_SEC_PER_GAME_MIN = 10 / 60; // 1x: 1 real s = 6 game min

const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = (v, d) => {const n = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(n) ? d : n};

// The pacing settings from flags (--heartbeat MIN, --min-gap S, --max-fails N), then env (AGENT_HEARTBEAT,
// AGENT_MIN_GAP, AGENT_MAX_FAILS), then the defaults. cadence: an older flag name for the gap (Fellowship).
// hearWake (--hear-wake MIN, AGENT_HEAR_WAKE_MIN, #787): game minutes between the turns a companion's line may start for this
// listener, sent with every pace call; null keeps the game's own PK.HEAR_WAKE (15). The owner's knob for a chatty company.
export function paceSettings(opt, env = {}, {cadence = null} = {}) {
  return {
    heartbeat: Math.min(1440, Math.max(5, num(opt('heartbeat', null), num(env.AGENT_HEARTBEAT, PACE_DEFAULTS.heartbeat)))),
    minGap: Math.max(0, num(opt('min-gap', null), num(cadence, num(env.AGENT_MIN_GAP, PACE_DEFAULTS.minGap)))),
    maxFails: Math.max(1, Math.round(num(opt('max-fails', null), num(env.AGENT_MAX_FAILS, PACE_DEFAULTS.maxFails)))),
    hearWake: hearWakeOf(num(opt('hear-wake', null), num(env.AGENT_HEAR_WAKE_MIN, null))),
  };
}
const hearWakeOf = v => v == null || !(v > 0) ? null : Math.min(1440, Math.max(1, Math.round(v)));
export const paceText = p => `a turn on an event, else every ${p.heartbeat} game min, at least ${p.minGap} s apart`;
// --max-turns when asked, else until stopped (owner, #563: paid minds are limited by their budget in dollars, not by turns;
// a local mind costs nothing). provider and paidDefault are kept for callers; neither caps a run any more.
export const turnCap = (asked, provider, paidDefault) => asked != null && asked !== '' ? Math.max(1, Number(asked)) : Infinity;
export const capText = n => n === Infinity ? 'until stopped' : `up to ${n} turns`;

// Failed or empty turns in a row. ok(turnWorked) -> true when the runner must stop.
export function failTracker(maxFails) {
  let n = 0;
  return {ok(worked) {if (worked === null) return n >= maxFails; n = worked ? 0 : n + 1; return n >= maxFails}, get count() {return n}, why: () => `${n} failed or empty turns in a row`};
}
// Did a local-loop turn (scripts/local-agent.mjs result) do anything?
// (a turn with no call, every call rejected, or a narration repeating the last one with no world-changing call is empty)
// null (neither worked nor failed; a turn cut by its own scene before any call, flag scene-cut, #515; also a turn whose calls failed because the game page did not answer: a hidden or reloading tab is not the runner's fault, failTracker leaves its count): a turn Ollama aborted twice for repeating tokens (#221) with no call made.
export const localWorked = r => r && r.looped && !r.tools ? null : r && r.sceneJump && !r.tools ? null : r && r.gameDown && !r.acts ? null : !!(r && r.mode === 'reflect' ? r.answered : r && r.tools > 0 && r.rejected < r.tools && !(r.repeat && !r.acts) && !r.repeatAct && !r.foreign && !(r.chatbot && !r.acts));

// makePacer({base, hero, runner, heartbeat, minGap, log, stopped}) -> {next(), turnDone(), state}
//   next(): waits for the next turn. -> {wake:'now'|'soft'|'heartbeat', why, table, clock} or {dead} / {gone, why} / {stopped}
//   turnDone(): call when a turn ends (the gap and the heartbeat count from here).
export function makePacer({base, hero, runner, heartbeat = PACE_DEFAULTS.heartbeat, minGap = PACE_DEFAULTS.minGap, hearWake = null, log = () => {}, stopped = () => false, fetchImpl = fetch}) {
  let lastEnd = null, since = null, nows = [], legacy = false, said = false;
  const st = {waiting: false, wake: null};
  async function pace(wake, realMs) {
    try {
      const r = await fetchImpl(base + '/play/pace', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({hero, runner, since, minutes: heartbeat, wake, realMs, reflect: REFLECT_ON, ...(hearWake ? {hearWake} : {})}), signal: AbortSignal.timeout(realMs + 20000)});
      if (r.status === 404) return {unsupported: true};
      const j = await r.json().catch(() => ({ok: false, error: 'bad answer'}));
      if (j && j.ok === false && /unknown tool pace|not found/i.test(String(j.error || ''))) return {unsupported: true};
      return j;
    } catch (e) {return {ok: false, offline: true, error: e.message}}
  }
  async function next() {
    st.waiting = true; said = false;
    try {
      for (;;) {
        if (stopped()) return {stopped: true};
        const gapLeft = lastEnd == null ? 0 : lastEnd + minGap * 1000 - Date.now();
        if (legacy) { // an older host: real time only, as if at 1x
          const left = Math.max(gapLeft, lastEnd == null ? 0 : lastEnd + heartbeat * LEGACY_SEC_PER_GAME_MIN * 1000 - Date.now());
          if (!said) {said = true; log(`[pace] this game has no /play/pace (older relay or page): next turn in ${Math.ceil(left / 1000)} s`)}
          if (left <= 0) return {wake: 'heartbeat', why: 'real-time fallback', legacy: true};
          await sleep(Math.min(left, 1000)); continue;
        }
        nows = nows.filter(t => Date.now() - t < NOW_WINDOW);
        const mode = gapLeft <= 0 ? 'all' : nows.length < NOW_MAX ? 'now' : 'must';
        if (!said) {said = true; log(`[pace] waiting: ${paceText({heartbeat, minGap})}`)}
        const r = await pace(mode, mode !== 'all' ? Math.max(50, Math.min(gapLeft, POLL_REAL_MS)) : POLL_REAL_MS);
        if (r.unsupported) {legacy = true; said = false; continue}
        if (r.ok === false) {
          if (r.dead) return {dead: true, why: r.error};
          if (r.gone) return {gone: true, why: r.error};
          if (r.refused) return {gone: true, why: r.error};
          if (/not agent-played/i.test(String(r.error || ''))) return {gone: true, why: r.error}; // the game says so (the host answers before the sim does)
          await sleep(2000); continue; // the game is not answering (page gone, offline): keep the claim, try again
        }
        if (r.since != null) since = r.since;
        if (!r.wake) continue;
        if (r.wake === 'now' && gapLeft > 0 && !r.must) nows.push(Date.now());
        st.wake = r.wake;
        log(`[pace] woke (${r.wake}${r.clock ? ', ' + r.clock : ''}): ${String(r.why || '').slice(0, 160)}`);
        return r;
      }
    } finally {st.waiting = false}
  }
  // The hero's state header for a turn prompt (src/sim/pace.js paceBrief), or null on an older host.
  // self: also the whole persona text (brief.self) for the standing orders (#409).
  async function brief({self = false} = {}) {
    if (legacy) return null;
    try {
      const r = await fetchImpl(base + '/play/pace', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({hero, runner, brief: true, ...(self ? {self: true} : {})}), signal: AbortSignal.timeout(8000)});
      if (r.status === 404) return null;
      const j = await r.json(); return j && j.ok && j.brief ? j.brief : null;
    } catch {return null}
  }
  // The first turn of a run (#770): wait while the start gate or the DM's prep holds the world, as a paced turn does.
  // -> {} when it may start, or {dead}/{gone}/{stopped}. An older host, or one that does not answer, never blocks it.
  async function ready() {
    let said = false;
    for (;;) {
      if (stopped()) return {stopped: true};
      let r = null;
      try {
        const x = await fetchImpl(base + '/play/pace', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({hero, runner, held: true}), signal: AbortSignal.timeout(8000)});
        r = x.status === 404 ? null : await x.json().catch(() => null);
      } catch {r = null}
      if (!r) return {};
      if (r.ok === false) {if (r.dead) return {dead: true, why: r.error}; if (r.gone) return {gone: true, why: r.error}; return {}}
      if (!r.held) return {};
      if (!said) {said = true; log(`[pace] the world is held (${r.held}): the first turn waits`)}
      await sleep(1000);
    }
  }
  return {next, ready, brief, turnDone() {lastEnd = Date.now(); since = null}, state: st};
}

// The state header as prompt text: fresh from the game every turn, so even a lazy model cannot narrate
// a fight that ended long ago (coordinator's live bug, issue #126). The hero's own state only.
export function briefText(b) {
  if (!b) return '';
  const bits = [b.clock, `you are ${b.state}${b.doing ? ' (' + b.doing + ')' : ''}`, `HP ${b.hp}`, `level ${b.level}`];
  if (b.place) bits.push('in ' + b.place);
  bits.push(b.foe ? 'fighting ' + b.foe : 'no foe engaged');
  if (b.table) bits.push('a scene is open at the table');
  if (b.autopilot) bits.push('no order from you for a while, so autopilot carries on your last order (give a command to take over)');
  return `\n\nRight now (from the game, trust this over anything you said before): ${bits.join(' | ')}.` + memoryNote(b) +
    (b.news && b.news.length ? `\nNew since you last looked: ${b.news.join(' / ')}` : '\nNothing new since you last looked.') + talkText(b) +
    '\nAct through the tools (look, status, move_to, hunt, rest, wait, ...): words alone change nothing in the world.';
}
// What was said lately and whom the hero has met (the brief's heard/met, sim/talk.js), so a trimmed or fresh context
// does not re-introduce itself or ask the same question again. Also used alone in Claude members' turn prompts.
// The earshot line (brief.earshot, src/sim/earshot.js, #395) leads it: who hears a say or a shout now, who to talk to.
// The in-sight line (brief.insight, src/sim/sighthero.js, #570): companions and the one you seek, in sight beyond earshot.
export const sightNote = b => b && typeof b.insight === 'string' && b.insight ? `\nIn sight: ${b.insight.slice(0, 300)}.` : '';
// The gambit hold (brief.hold, #630): the world waits for this hero's next acting call.
// Session zero held for members out of range (brief.gather, #771).
export const gatherNote = b => b && typeof b.gather === 'string' && b.gather ? `\nSESSION ZERO: ${b.gather.slice(0, 200)}` : '';
// A road off the map held by something (brief.crossing_waits, #1013).
export const crossingNote = b => b && typeof b.crossing_waits === 'string' && b.crossing_waits ? `\nTHE ROAD: ${b.crossing_waits.slice(0, 200)}` : '';
export const holdNote = b => b && typeof b.hold === 'string' && b.hold ? `\nTHE WORLD IS HELD FOR YOU by your rule (${b.hold.slice(0, 160)}): nothing moves until you act (any acting tool), at most 2 minutes. Look, then act.` : '';
export const woundNote = b => b && typeof b.wounds === 'string' && b.wounds ? `\n${b.wounds.slice(0, 320)}.` : ''; // a lasting wound (brief.wounds, #656)
// One rare line naming a tool that fits here (brief.invite, src/sim/invite.js, #872, #864): absent on most turns.
export const inviteNote = b => b && b.invite && typeof b.invite.text === 'string' ? `\n${b.invite.text.slice(0, 240)}` : '';
export const earshotNote = b => b && typeof b.earshot === 'string' && b.earshot ? `\nIn earshot: ${b.earshot.slice(0, 300)} (the earshot tool tells more).` : '';
export function talkText(b) {
  if (!b) return '';
  const heard = Array.isArray(b.heard) ? b.heard : [], met = Array.isArray(b.met) ? b.met : [];
  const near = Array.isArray(b.nearby) ? b.nearby : [];
  const road = Array.isArray(b.road) ? b.road : [];
  return holdNote(b) + inviteNote(b) + earshotNote(b) + sightNote(b) + (road.length ? `\nOn the road: ${road.join('; ')}.` : '') + (near.length ? `\nPeople about (talk to them with talk, or say a word to one): ${near.join('; ')}.` : '') + (heard.length ? `\nSaid lately (party and aloud, oldest first): ${heard.join(' / ')}` : '') +
    (met.length ? `\nCompanions you have met: ${met.join(', ')}. You know each other: do not introduce yourself again or repeat a line; talk to move the party forward (propose, vote, lead_to, or answer a question you were asked).` : '');
}

// Your own notes that bear on the moment (issue #155, src/sim/notebook.js relevant): title and id only, so the model can
// recall them. Every turn prompt carries it (local turns inside briefText, Claude turns on their own); '' when none.
// The roads line (brief.roads, src/sim/lore.js roadsLine, #539): what the hero knows of where it is, where it goes and the places it knows to fear.
export const roadsNote = b => b && typeof b.roads === 'string' && b.roads ? `
What you know of the roads: ${b.roads.slice(0, 300)} (lore and places tell more; look before you leave).` : '';
// The way (brief.way, sim/ground.js wayNow, #797): what the walk is going round. Only while something stands on the straight line; absent on plain going.
export const wayNote = b => b && typeof b.way === 'string' && b.way ? `\nYour way: ${b.way.slice(0, 120)}.` : '';
export function memoryNote(b) {
  const m = b && Array.isArray(b.memories) ? b.memories : [];
  return gatherNote(b) + crossingNote(b) + personaNote(b) + woundNote(b) + oathNote(b) + (b && b.growth ? `
${b.growth}` : '') + askedNote(b) + aimNote(b) + wayNote(b) + roadsNote(b) + questNote(b) + hallNote(b) + companyNote(b) + followNote(b) + (m.length ? `
Your memories that may matter now: ${m.map(x => `#${x.id} "${String(x.title || '').slice(0, 80)}"`).join(', ')} (recall {id} to read one).` : '');
}
// The hero's stated aim (brief.aim, src/sim/intent.js aimBrief, issue #535): "Your aim: ... (set 3 h ago)" in every turn
// header; when it is done, stale or was never stated, the turn asks first "What are you trying to do now?" (any mind: the
// intent tool; local and OpenAI reflections also carry an optional intent in their forced answer). A scene comes first:
// with one open the header only names the aim. The leader's shouted aim follows, for a companion who heard it.
export const AIM_ASK = 'What are you trying to do now?';
export function aimNote(b) {
  const m = b && b.aim; if (!m || typeof m !== 'object') return '';
  const lead = m.leader ? `\nYour leader's aim: ${String(m.leader).slice(0, 260)}.` : '';
  const line = m.line ? String(m.line).slice(0, 260) : '';
  const errand = m.errand && !b.scene && !b.table ? `\n${String(m.errand).slice(0, 200)}` : ''; // in town on an errand: the next step, named (#727)
  if (!m.ask || b.scene || b.table) return (line && !m.ask ? `\nYour aim: ${line} (intent changes it, or sets it down when done).` : line ? `\nYour aim: ${line}.` : '') + errand + lead;
  const why = String(m.why || '').slice(0, 120);
  return `\n${AIM_ASK} ${line ? 'Your aim was: ' + line + '; ' + why : why.charAt(0).toUpperCase() + why.slice(1)}. Say it first with intent {goal, why, until} (one call), then act on it.${m.wait_limit ? ' Until you do, ' + String(m.wait_limit).replace(/^with no aim, /, '') + '.' : ''}` + lead;
}
// A question someone in the world put to a hero riding alone (issue #826): it stands a few game hours, and silence is a no.
export const askedNote = b => { const q = b && b.asked; return q && q.line ? `\n${String(q.by).slice(0, 60)} asked you: "${String(q.line).slice(0, 200)}" Answer aloud with answer_call {answer: accept|decline, line}; it lapses as a no in about ${Number(q.left) || 1} game hours.` : ''; };
// What the hero swore, or for a while what its past offers (issue #800). A thread is the past, never a promise.
export const oathNote = b => (b && b.oath ? `\nYour oath: ${String(b.oath).slice(0, 200).replace(/[.!?]+$/, '')}.` : '') + (b && b.thread ? `\nFrom your past, not sworn: ${String(b.thread).slice(0, 200)} It binds you to nothing unless you swear it (swear_oath, in your own words).` : '');
// Who the hero is now (brief.persona, src/sim/persona.js personaLine, issue #409): one line in every turn header.
export const personaNote = b => (b && typeof b.persona === 'string' && b.persona ? `\nWho you are: ${b.persona.slice(0, 300)} (self shows all of you; become changes one part, with a why, when your story changes you).` : '') + (b && typeof b.told === 'string' && b.told ? `\n${b.told.slice(0, 500)}` : ''); // #571: what it told of its past round the fire
// The persona in the standing orders (issue #409): the block between PERSONA_HEAD and PERSONA_TAIL (src/sim/persona.js
// selfText) replaced, or appended. text '' leaves the orders as they are.
const P_HEAD = 'YOUR PERSONA', P_TAIL = '(end of your persona)';
export function withPersona(sys, text) {
  const s = String(sys || ''); if (!text) return s;
  const i = s.indexOf('\n' + P_HEAD), j = i >= 0 ? s.indexOf(P_TAIL, i) : -1;
  return i >= 0 && j > i ? s.slice(0, i) + '\n' + text + s.slice(j + P_TAIL.length) : s + '\n' + text;
}
// Before a Claude turn: when the persona changed since the orders were written (brief.personaV), fetch its text and
// rewrite the block in sess.system (the SDK sends the system prompt with every query, resumed or not). -> true when changed.
export async function refreshPersona(pacer, sess, b0) {
  if (!pacer || !sess || !b0 || !b0.personaV || b0.personaV === sess.personaV) return false;
  const full = await pacer.brief({self: true});
  if (!full || typeof full.self !== 'string' || !full.self) return false;
  sess.system = withPersona(sess.system, full.self); sess.personaV = b0.personaV; return true;
}

// The quest in focus and how many others the hero holds (brief.quest, src/sim/questlog.js); every turn prompt carries it with the memories.
export function questNote(b) {
  const q = b && b.quest;
  return q && q.focus ? `\nYour quest in focus: ${String(q.focus).slice(0, 120)}${q.others ? ` (and ${q.others} more you hold: quests lists them, focus_quest switches)` : ''}.` : '';
}

// Offers to ride together open to the hero (brief.offers) and its company of two or more (brief.company), issue #442:
// names and who is within shouting range only, never where the others are.
export function companyNote(b) {
  const o = b && Array.isArray(b.offers) ? b.offers : [], c = b && b.company;
  const offer = x => `${x.id} from ${x.from}${x.kind === 'ask' ? ' (asks to join you)' : ' (invites you)'}${x.said ? ': "' + String(x.said).slice(0, 120) + '"' : ''}, until ${x.until}`;
  const offers = o.length ? `\nOffers to ride together, open to you: ${o.map(offer).join('; ')} (accept {offer_id} or decline {offer_id}).` : '';
  const comp = c && c.name ? `\nYour company: ${c.name} (${c.size} heroes${c.leader ? ', ' + c.leader + ' leads' : ''})${c.with_you && c.with_you.length ? '; within shouting range: ' + c.with_you.join(', ') : ''}${c.apart && c.apart.length ? '; apart: ' + c.apart.join(', ') : ''}.` : '';
  return offers + comp;
}

// Whom the hero follows and who walks with it (brief.follow, src/sim/follow.js, issue #445): words only, never positions.
export function followNote(b) {
  const f = b && b.follow; if (!f) return '';
  return (f.following ? `
You are ${String(f.following).slice(0, 160)} (any other order ends it).` : '') + (Array.isArray(f.followed_by) && f.followed_by.length ? `
Walking with you (following, not in your company): ${f.followed_by.join(', ')}.` : '');
}

// The hall board's open jobs for the Fellowship (brief.hall, issue #326): only for a member in town, only when there are some.
export function hallNote(b) {
  const h = b && Array.isArray(b.hall) ? b.hall : [];
  return h.length ? `
Posted at your hall for the Fellowship: ${h.map(x => `${x.id} "${String(x.title || '').slice(0, 90)}"${x.giver ? ' from ' + x.giver : ''}${x.reward ? ' (' + x.reward + ')' : ''}`).join('; ')} (take_quest {id} holds one; the party leader sets out with take_adventure).` : '';
}

// The line a turn prompt carries about why it started (the hero's own events only, issue #123).
export function wakeNote(w) {
  if (!w || !w.wake) return '';
  if (w.wake === 'heartbeat') return w.legacy ? '' : ` Some quiet time has passed (${w.clock || 'now'}).`;
  return ` ${w.wake === 'now' ? 'Something needs you now' : 'Something happened'}: ${String(w.why || '').slice(0, 200)}`;
}

// A Claude turn under the app's runner supervisor (scripts/runners.mjs): lease one of the Claude slots
// for the turn and release it after, so any number of Claude runners can be started (five members and
// the DM) while at most RUNNER_CLAUDE_MAX talk to the API at once (the DM has its own, RUNNER_DM_SLOTS, #733; while the DM's
// prep holds the world a hero's request waits for it). Outside the supervisor (a terminal runner) or when the supervisor does
// not answer, the turn just runs. One slot of RUNNER_CLAUDE_MAX is kept for scene answers (RUNNER_SCENE_SLOTS, #868).
// #687: due() says whether the member's own Table scene waits for its answer (the /play/health watch). While the runner waits for
// a slot it asks every DUE_POLL_MS; once due, onDue() runs once (the runner tells the game its answer is queued: POST /play/pace
// {queued:true, why:'slot'}) and the request is asked again with scene:true, which the supervisor serves first. The release
// function carries .scene = true when the scene came up while waiting, so the turn answers it first.
// #868: a lease is held by a turn that says so: every SLOT_BEAT_MS the holder posts /play/runner/slot/beat with its tool-call count
// (tools()), so the supervisor can reclaim what nobody holds any more. onLost() runs when the answer says the slot was taken back (a
// turn with no tool call for SLOT_MAX_MS): the runner ends that turn, so a reclaimed slot never runs alongside its new holder.
// Each request names a ticket; a request cut off here is cancelled by it, so a grant whose answer never reached us goes back at once.
// A time-out asks again (running without a lease would pass RUNNER_CLAUDE_MAX). The release function carries .idle(on): the runner
// reports while it sits in a wait call, which GET /play/runner shows. member: who the lease is for (a company runner has many).
export const DUE_POLL_MS = 1000;
let slotTickets = 0;
export async function takeClaudeSlot(base, log = () => {}, {key = process.env.ELDMOOR_RUNNER_KEY, stopped = () => false, fetchImpl = fetch, due = null, onDue = null, member = null, tools = () => 0, onLost = null, beatMs = SLOT_BEAT_MS} = {}) {
  if (!key || !base) return Object.assign(() => {}, {scene: false, idle: () => {}});
  const post = (path, body, ms, signal) => fetchImpl(base + path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms)});
  const isDue = async () => {try {return !!(due && await due())} catch {return false}};
  let lease = null, said = false, scene = await isDue(), told = false, waitedFor = false;
  while (!stopped()) {
    const ac = new AbortController(), ticket = process.pid + '-' + (++slotTickets);
    const watch = due ? setInterval(async () => {if (!(await isDue())) return; waitedFor = true;
      if (!told) {told = true; try {if (onDue) await onDue()} catch {}}
      if (!scene) {scene = true; ac.abort()}}, DUE_POLL_MS) : null;
    let j = null, cut = false, late = false;
    try {const r = await post('/play/runner/slot', {key, ticket, ...(member ? {member} : {}), ...(scene ? {scene: true} : {})}, 30000, ac.signal); j = r.status === 200 ? await r.json() : null} catch (e) {cut = ac.signal.aborted; late = !cut && e && e.name === 'TimeoutError'}
    if (watch) clearInterval(watch);
    if (cut || late) await post('/play/runner/slot/cancel', {key, ticket}, 5000).catch(() => {}); // it may have been granted as we gave up on it
    if (cut) {log('[pace] its own Table scene opened while it waited for a Claude slot: asking again, scene first'); continue}
    if (late) continue;
    if (!j) break; // no supervisor here: run without a lease
    if (j.ok) {lease = j.lease; if (said) log('[pace] got a ' + (j.dm ? 'DM slot' : 'Claude slot') + (waitedFor ? ' (scene first)' : '')); break}
    if (!said || (j.prep ? said !== 'prep' : said === 'prep')) {said = j.prep ? 'prep' : true; // #733: the DM's prep holds hero turns; the DM's line names its own slot
      log(j.prep ? '[pace] the DM prepares the table: no Claude turn until it is done' : j.dm ? `[pace] waiting for the DM slot (its ${j.dmSlots ?? 1} and all ${j.slots} hero slots in use; RUNNER_DM_SLOTS)` : `[pace] waiting for a Claude slot (all ${j.slots} in use; RUNNER_CLAUDE_MAX)`)}
  }
  const beat = async idle => {if (!lease) return;
    try {const r = await post('/play/runner/slot/beat', {key, lease, tools: tools(), ...(idle == null ? {} : {idle})}, 5000), b = await r.json();
      if (b && b.lost && lease) {lease = null; clearInterval(timer); log('[pace] the supervisor took this Claude slot back: ' + (b.why || 'no tool call for too long') + '; the turn ends'); if (onLost) onLost()}} catch {}};
  const timer = lease ? setInterval(() => beat(), beatMs) : null; if (timer && timer.unref) timer.unref();
  return Object.assign(() => {if (timer) clearInterval(timer); if (lease) {post('/play/runner/slot/release', {key, lease}, 5000).catch(() => {}); lease = null}}, {scene: waitedFor, idle: on => {beat(!!on)}});
}
// opts.onLease(release): the turn's lease, for release.idle. A runner told to stop runs no turn on the way out (it would run unleased).
export async function withClaudeSlot(base, fn, log, opts = {}) {const release = await takeClaudeSlot(base, log, opts); if (opts.onLease) opts.onLease(release);
  try {return opts.stopped && opts.stopped() ? false : await fn()} finally {release()}}

// #868: the Agent SDK hooks of a Claude hero turn. A wait that came back with turn_over ends the turn right there: the PostToolUse hook
// stops the query, so no further model call is made (the turn's result, cost and session arrive as usual; checked on the real CLI,
// sessioncheck). A model that would call wait again cannot, so nobody keeps a slot at the table. idle(on) reports the wait to the lease.
export const WAIT_TOOL = 'mcp__eldmoor__wait';
export const turnOver = v => /turn_over\\*"\s*:\s*true/.test(typeof v === 'string' ? v : JSON.stringify(v) || '');
export function tableHooks({idle = () => {}, onOver = () => {}} = {}) {
  return {PreToolUse: [{matcher: WAIT_TOOL, hooks: [async () => {idle(true); return {}}]}],
    PostToolUse: [{matcher: WAIT_TOOL, hooks: [async i => {idle(false); if (!turnOver(i && i.tool_response)) return {}; onOver(); return {continue: false, stopReason: 'your turn is over at the table'}}]}]};
}

// #687 (follow-up): a Claude member whose own Table scene has been due for SCENE_GRAB_MS with no scene_act is mid-turn in a model
// call that no tool result can interrupt. sceneGrab polls due() every `every` ms; once it has held for `ms` it calls abort() once
// (the runner aborts the Agent SDK query; the session stays resumable) and onGrab(). stop() ends the poll when the turn does;
// grabbed() says whether it fired. due() is the runner's own view of /play/health (the member's scene waits on it).
export const SCENE_GRAB_MS = 15000;
export function sceneGrab({due, abort, onGrab = null, ms = SCENE_GRAB_MS, every = 1000}) {
  let since = null, fired = false, busy = false;
  const t = setInterval(async () => {
    if (fired || busy) return; busy = true; let d = false;
    try {d = !!(await due())} catch {} busy = false;
    if (fired) return;
    if (!d) {since = null; return}
    if (since == null) since = Date.now();
    if (Date.now() - since >= ms) {fired = true; clearInterval(t); try {if (onGrab) onGrab()} catch {} try {abort()} catch {}}
  }, every);
  if (t.unref) t.unref();
  return {stop: () => clearInterval(t), grabbed: () => fired};
}
// #747: an aborted query sends no result message, so its spend would never reach the run budget. grabSpend() watches the stream:
// every assistant message carries the usage of its model call (one call can repeat under the same id as it streams; the largest
// figure per field wins). grabSpend(...).cost(model, {sent}) prices what was reported with the Anthropic price table (cache reads at
// 0.1x and cache writes at 1.25x the input rate) -> {usd, how: 'reported'}; with nothing reported (cut before the first model call
// finished) it estimates from the characters sent (system + prompt, 3 chars a token, all at the full input rate, plus GRAB_EST_OUT
// output tokens) -> {usd, how: 'estimated'}. An unpriced model counts as the dearest listed. No RNG, no network.
export const GRAB_EST_OUT = 400;
export function grabSpend() {
  const calls = new Map(); let n = 0;
  return {
    add(msg) {const u = msg && msg.message && msg.message.usage; if (!u) return; const id = msg.message.id || ('anon' + n++), c = calls.get(id) || {in: 0, out: 0, cr: 0, cw: 0};
      c.in = Math.max(c.in, u.input_tokens || 0); c.out = Math.max(c.out, u.output_tokens || 0); c.cr = Math.max(c.cr, u.cache_read_input_tokens || 0); c.cw = Math.max(c.cw, u.cache_creation_input_tokens || 0); calls.set(id, c)},
    reported: () => calls.size,
    cost(model, {sent = 0} = {}) {
      const p = PRICES[model] || Object.values(PRICES).reduce((a, b) => b.out > a.out ? b : a);
      if (calls.size) {let usd = 0; for (const c of calls.values()) usd += (c.in * p.in + c.cr * p.in * .1 + c.cw * p.in * 1.25 + c.out * p.out) / 1e6; return {usd, how: 'reported', calls: calls.size}}
      return {usd: (Math.ceil(sent / 3) * p.in + GRAB_EST_OUT * p.out) / 1e6, how: 'estimated', calls: 0}}};
}
export const GRAB_RESUME = 'Your turn was paused so the Table scene could be answered, and it has been (see the state header). Carry on from what you were doing; do not repeat what you already did.';

// ---- reflection moments (issue #179) ----
// The game names a moment to write memories in the state header (brief.reflect = {id, kind, why}, src/sim/reflect.js):
// making camp, the end of a scene, a companion's death, an oath kept, a big trade, a conversation, or the end of the day.
// The runner gives the member a short reflection turn (local/OpenAI: one forced structured answer, scripts/local-agent.mjs
// reflectTurn; Claude: this prompt with tool use) and closes the moment with pacer.reflected(id, wrote).
export const REFLECT_MAX = 3;
// Reflections also ask whether the moment changed who the hero is (issue #409): most days it has not.
export const BECOME_ASK = 'And has this changed who you are (what you want or fear, what you believe, a trait you see in yourself, how you see someone)? Most days it has not.';
// ... and what the hero is trying to do next (issue #535): an optional new aim.
export const INTENT_ASK = 'What are you trying to do next? If your aim changed or you have none, say it.';
export const BECOME_FIELDS = ['voice', 'wants', 'fears', 'quirk', 'never_says', 'beliefs', 'traits', 'stance'];
// Reflections are on unless AGENT_REFLECT=0 or --no-reflect (--reflect turns them on again); checks that count exact turns turn them off.
export const REFLECT_ON = process.argv.includes('--reflect') || !(process.env.AGENT_REFLECT === '0' || process.argv.includes('--no-reflect'));
// Downed (#658): the hero lies at zero health and cannot act; its turn is this reflection, with no acting tools.
export const DOWNED_ASK = 'You lie in the dark, bleeding at zero health: you cannot move, fight or speak, and your acting tools are refused until someone brings you back or you rise. What do you hear? What do you think of, lying there?';
// The dusk reflection asks once (#829): a thing wanted today that no tool allowed. One sentence, no extra turn.
export const WISH_ASK = 'Was there a thing you wanted to do today that no tool allowed?';
const wishAsk = (r, tools) => r && r.kind === 'dusk' ? ' ' + WISH_ASK + (tools ? ' If so, say it with wish {tool, what, why, moment} (read later by the builders; nothing changes now); if not, leave it.' : ' If so, fill "wish" {"tool": the name you would give it, "what", "why", "moment"}, else leave its fields empty.') : '';
export function reflectPrompt(r, {tools = true} = {}) {
  const why = r && r.why ? ` (now: ${String(r.why).slice(0, 200)})` : '';
  const lead = r && r.kind === 'downed' ? `${DOWNED_ASK}${why} What is worth remembering? ` : `Before you rest${why}: what is worth remembering from today? `;
  const past = r && r.thread ? ` Asked once, and not again: your past holds this: ${String(r.thread).slice(0, 200)} Is it an oath to you? ` : '';
  if (past) return lead + reflectBody(tools) + wishAsk(r, tools) + past + (tools ? 'swear_oath swears it in your own words (thread yes takes it as it stands, thread no sets it aside); or leave it and you are bound to nothing.' : 'In the JSON, "swear": your own words, or "yes" to take it as it stands, "no" to set it aside, or empty to leave it.');
  return lead + reflectBody(tools) + wishAsk(r, tools);
}
function reflectBody(tools) {
  return (tools
    ? `Write 1-${REFLECT_MAX} memories with remember (title, text, tags; about is optional), in your own words, or answer "none" if nothing is. Anything you want to keep: a promise, a debt, a friend or enemy, a place, a lesson, how you feel about a companion. Prefer remember to journal_write for this. ${BECOME_ASK} If it has, change that one part with become (field, text, why). ${INTENT_ASK} (intent {goal, why, until}).`
    : `Write 0-${REFLECT_MAX} memories in your own words: anything you want to keep (a promise, a debt, a friend or enemy, a place, a lesson, how you feel about a companion). ${BECOME_ASK} ${INTENT_ASK} Answer only with the JSON object {"notes": [{"title": "...", "text": "...", "tags": ["..."], "about": "who or what it concerns, or empty"}], "become": {"field": "none", "text": "", "why": "", "about": ""}, "intent": {"goal": "", "why": "", "until": ""}}; an empty list if nothing is worth keeping, and field "none" unless you changed (else one of ${BECOME_FIELDS.join(', ')}, with your new words in text, why it changed, and for a stance who it is about); intent goal empty to keep your aim as it is (else what you will do next, why, and until: game hours or a condition).`);
}
// Should this turn be a reflection? A due moment, no scene open, and nothing that cannot wait.
// A downed hero (#658): its turn is the reflection whatever woke it (its acting tools are refused anyway), unless a scene is open.
export const reflectNow = (b, w) => !!(REFLECT_ON && b && b.reflect && b.reflect.id && !b.scene && ((b.state === 'downed' && b.reflect.kind === 'downed') || !(w && (w.wake === 'now' || w.must || w.table))));
// Close the moment at the game (POST /play/pace {reflected, wrote}). Never throws; an older relay just ignores it.
export async function closeReflection(base, hero, runner, id, wrote, fetchImpl = fetch) {
  try {const r = await fetchImpl(base + '/play/pace', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({hero, runner, reflected: id, wrote}), signal: AbortSignal.timeout(8000)});
    return r.status === 200 ? await r.json() : {ok: false, error: 'HTTP ' + r.status}} catch (e) {return {ok: false, error: e.message}}
}

// A new world under the same ids (issue #219). A runner holds heroes by id; a New World can hand the same ids to
// other heroes, and a runner that keeps its claims then plays nobody. worldChanged() names the held heroes whose
// identity changed. Identity today: the hero's name for its id (and the world instance id, once /play/health carries
// it as `world`: both sides must have one). Swap the test here when the game names the world.
import {NEW_WORLD_EXIT, SLOT_BEAT_MS} from './runners.mjs';
export {NEW_WORLD_EXIT};
export function worldChanged(known, heroes) {
  const out = [];
  for (const [id, k] of known) {const h = (heroes || []).find(x => x.id === id);
    if (h && (h.name !== k.name || (k.world != null && h.world != null && h.world !== k.world))) out.push({id, was: k.name, now: h.name});}
  return out;
}
// watchWorld({base, known: () => Map(id -> {name, world?}), onNew(changed), every, fetchImpl}) -> stop()
// Polls /play/health; on the first change calls onNew once (the runner releases its heroes and exits NEW_WORLD_EXIT).
export function watchWorld({base, known, onNew, every = 3000, fetchImpl = fetch}) {
  let done = false;
  const t = setInterval(async () => {
    if (done) return;
    const h = await fetchImpl(base + '/play/health', {signal: AbortSignal.timeout(4000)}).then(r => r.json()).catch(() => null);
    if (!h || !h.ok) return;
    const ch = worldChanged(known(), h.heroes); if (ch.length && !done) {done = true; clearInterval(t); onNew(ch)}
  }, every);
  t.unref();
  return () => {done = true; clearInterval(t)};
}
export const newWorldLine = ch => `[world] a new world: ${ch.map(c => `#${c.id} was ${c.was}, now ${c.now}`).join('; ')}. Releasing the heroes and exiting (code ${NEW_WORLD_EXIT}); nothing starts this runner again by itself (#691), the new world's setup or a resume starts the ones it wants, and the old sessions are set aside in logs/agents/old/.`;

// Claude turns (issue #401): the same fresh state header the local turns get (briefText: state, HP, place, foe, news,
// memories, what was said lately), without its generic last line, plus the turn order. A Claude turn used to open with
// 2-4 reads and loop wait/look/party_read until the call cap (44% of turns). scene: a table turn, header only.
export const CLAUDE_TURN_ORDER = 'Act: if the header asks what you are trying to do, say it with intent first; then give one command (or answer what is asked of you), then wait. Wait once, after your last command: when wait returns, act on its events if they need you, otherwise end your turn with one short sentence of narration. A second wait with nothing new only spends calls (a turn has about ten); the next turn starts by itself when something happens. Do not look again unless the events say the world changed.';
// Whether a Table scene waits on this member now (b.scene is the member's own due scene). A turn that opens with scene_act when none does is refused.
export const sceneNote = b => !b || b.scene ? '' : b.table ? '\nA Table scene is open but nothing waits on you in it (not your turn yet, or you have answered): do not call scene_act; say or do what you want elsewhere, then wait.' : '\nNo Table scene waits on you: do not call scene_act.';
export function claudeBrief(b, {scene = false} = {}) {
  const t = briefText(b).replace(/\nAct through the tools[^\n]*$/, '');
  if (scene) return t;
  return t + sceneNote(b) + (t ? '\nThis turn: the header above is fresh from the game, so do not open with status, look or party_read unless you need ids or detail it lacks. ' : '\nThis turn: ') + CLAUDE_TURN_ORDER;
}
