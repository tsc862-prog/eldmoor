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
export function paceSettings(opt, env = {}, {cadence = null} = {}) {
  return {
    heartbeat: Math.min(1440, Math.max(5, num(opt('heartbeat', null), num(env.AGENT_HEARTBEAT, PACE_DEFAULTS.heartbeat)))),
    minGap: Math.max(0, num(opt('min-gap', null), num(cadence, num(env.AGENT_MIN_GAP, PACE_DEFAULTS.minGap)))),
    maxFails: Math.max(1, Math.round(num(opt('max-fails', null), num(env.AGENT_MAX_FAILS, PACE_DEFAULTS.maxFails)))),
  };
}
export const paceText = p => `a turn on an event, else every ${p.heartbeat} game min, at least ${p.minGap} s apart`;
// --max-turns, else unlimited for a local (Ollama) mind, else the paid default.
export const turnCap = (asked, provider, paidDefault) => asked != null && asked !== '' ? Math.max(1, Number(asked)) : provider === 'ollama' ? Infinity : paidDefault;
export const capText = n => n === Infinity ? 'until stopped' : `up to ${n} turns`;

// Failed or empty turns in a row. ok(turnWorked) -> true when the runner must stop.
export function failTracker(maxFails) {
  let n = 0;
  return {ok(worked) {if (worked === null) return n >= maxFails; n = worked ? 0 : n + 1; return n >= maxFails}, get count() {return n}, why: () => `${n} failed or empty turns in a row`};
}
// Did a local-loop turn (scripts/local-agent.mjs result) do anything?
// (a turn with no call, every call rejected, or a narration repeating the last one with no world-changing call is empty)
// null (neither worked nor failed; also a turn whose calls failed because the game page did not answer: a hidden or reloading tab is not the runner's fault, failTracker leaves its count): a turn Ollama aborted twice for repeating tokens (#221) with no call made.
export const localWorked = r => r && r.looped && !r.tools ? null : r && r.gameDown && !r.acts ? null : !!(r && r.mode === 'reflect' ? r.answered : r && r.tools > 0 && r.rejected < r.tools && !(r.repeat && !r.acts) && !r.foreign);

// makePacer({base, hero, runner, heartbeat, minGap, log, stopped}) -> {next(), turnDone(), state}
//   next(): waits for the next turn. -> {wake:'now'|'soft'|'heartbeat', why, table, clock} or {dead} / {gone, why} / {stopped}
//   turnDone(): call when a turn ends (the gap and the heartbeat count from here).
export function makePacer({base, hero, runner, heartbeat = PACE_DEFAULTS.heartbeat, minGap = PACE_DEFAULTS.minGap, log = () => {}, stopped = () => false, fetchImpl = fetch}) {
  let lastEnd = null, since = null, nows = [], legacy = false, said = false;
  const st = {waiting: false, wake: null};
  async function pace(wake, realMs) {
    try {
      const r = await fetchImpl(base + '/play/pace', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({hero, runner, since, minutes: heartbeat, wake, realMs, reflect: REFLECT_ON}), signal: AbortSignal.timeout(realMs + 20000)});
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
  return {next, brief, turnDone() {lastEnd = Date.now(); since = null}, state: st};
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
export const earshotNote = b => b && typeof b.earshot === 'string' && b.earshot ? `\nIn earshot: ${b.earshot.slice(0, 300)} (the earshot tool tells more).` : '';
export function talkText(b) {
  if (!b) return '';
  const heard = Array.isArray(b.heard) ? b.heard : [], met = Array.isArray(b.met) ? b.met : [];
  const near = Array.isArray(b.nearby) ? b.nearby : [];
  return earshotNote(b) + (near.length ? `\nPeople about (talk to them with talk, or say a word to one): ${near.join('; ')}.` : '') + (heard.length ? `\nSaid lately (party and aloud, oldest first): ${heard.join(' / ')}` : '') +
    (met.length ? `\nCompanions you have met: ${met.join(', ')}. You know each other: do not introduce yourself again or repeat a line; talk to move the party forward (propose, vote, lead_to, or answer a question you were asked).` : '');
}

// Your own notes that bear on the moment (issue #155, src/sim/notebook.js relevant): title and id only, so the model can
// recall them. Every turn prompt carries it (local turns inside briefText, Claude turns on their own); '' when none.
export function memoryNote(b) {
  const m = b && Array.isArray(b.memories) ? b.memories : [];
  return personaNote(b) + questNote(b) + hallNote(b) + (m.length ? `\nYour memories that may matter now: ${m.map(x => `#${x.id} "${String(x.title || '').slice(0, 80)}"`).join(', ')} (recall {id} to read one).` : '');
}
// Who the hero is now (brief.persona, src/sim/persona.js personaLine, issue #409): one line in every turn header.
export const personaNote = b => b && typeof b.persona === 'string' && b.persona ? `\nWho you are: ${b.persona.slice(0, 300)} (self shows all of you; become changes one part, with a why, when your story changes you).` : '';
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
// the DM) while at most RUNNER_CLAUDE_MAX talk to the API at once. Outside the supervisor (a terminal
// runner) or when the supervisor does not answer, the turn just runs.
export async function takeClaudeSlot(base, log = () => {}, {key = process.env.ELDMOOR_RUNNER_KEY, stopped = () => false, fetchImpl = fetch} = {}) {
  if (!key || !base) return () => {};
  const post = (path, body, ms) => fetchImpl(base + path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(ms)});
  let lease = null, said = false;
  while (!stopped()) {
    let j = null; try {const r = await post('/play/runner/slot', {key}, 30000); j = r.status === 200 ? await r.json() : null} catch {}
    if (!j) break; // no supervisor here: run without a lease
    if (j.ok) {lease = j.lease; if (said) log('[pace] got a Claude slot'); break}
    if (!said) {said = true; log(`[pace] waiting for a Claude slot (all ${j.slots} in use; RUNNER_CLAUDE_MAX)`)}
  }
  return () => {if (lease) {post('/play/runner/slot/release', {key, lease}, 5000).catch(() => {}); lease = null}};
}
export async function withClaudeSlot(base, fn, log, opts) {const release = await takeClaudeSlot(base, log, opts); try {return await fn()} finally {release()}}

// ---- reflection moments (issue #179) ----
// The game names a moment to write memories in the state header (brief.reflect = {id, kind, why}, src/sim/reflect.js):
// making camp, the end of a scene, a companion's death, an oath kept, a big trade, a conversation, or the end of the day.
// The runner gives the member a short reflection turn (local/OpenAI: one forced structured answer, scripts/local-agent.mjs
// reflectTurn; Claude: this prompt with tool use) and closes the moment with pacer.reflected(id, wrote).
export const REFLECT_MAX = 3;
// Reflections also ask whether the moment changed who the hero is (issue #409): most days it has not.
export const BECOME_ASK = 'And has this changed who you are (what you want or fear, what you believe, a trait you see in yourself, how you see someone)? Most days it has not.';
export const BECOME_FIELDS = ['voice', 'wants', 'fears', 'quirk', 'never_says', 'beliefs', 'traits', 'stance'];
// Reflections are on unless AGENT_REFLECT=0 or --no-reflect (--reflect turns them on again); checks that count exact turns turn them off.
export const REFLECT_ON = process.argv.includes('--reflect') || !(process.env.AGENT_REFLECT === '0' || process.argv.includes('--no-reflect'));
export function reflectPrompt(r, {tools = true} = {}) {
  const why = r && r.why ? ` (now: ${String(r.why).slice(0, 200)})` : '';
  return `Before you rest${why}: what is worth remembering from today? ` + (tools
    ? `Write 1-${REFLECT_MAX} memories with remember (title, text, tags; about is optional), in your own words, or answer "none" if nothing is. Anything you want to keep: a promise, a debt, a friend or enemy, a place, a lesson, how you feel about a companion. Prefer remember to journal_write for this. ${BECOME_ASK} If it has, change that one part with become (field, text, why).`
    : `Write 0-${REFLECT_MAX} memories in your own words: anything you want to keep (a promise, a debt, a friend or enemy, a place, a lesson, how you feel about a companion). ${BECOME_ASK} Answer only with the JSON object {"notes": [{"title": "...", "text": "...", "tags": ["..."], "about": "who or what it concerns, or empty"}], "become": {"field": "none", "text": "", "why": "", "about": ""}}; an empty list if nothing is worth keeping, and field "none" unless you changed (else one of ${BECOME_FIELDS.join(', ')}, with your new words in text, why it changed, and for a stance who it is about).`);
}
// Should this turn be a reflection? A due moment, no scene open, and nothing that cannot wait.
export const reflectNow = (b, w) => !!(REFLECT_ON && b && b.reflect && b.reflect.id && !b.scene && !(w && (w.wake === 'now' || w.must || w.table)));
// Close the moment at the game (POST /play/pace {reflected, wrote}). Never throws; an older relay just ignores it.
export async function closeReflection(base, hero, runner, id, wrote, fetchImpl = fetch) {
  try {const r = await fetchImpl(base + '/play/pace', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({hero, runner, reflected: id, wrote}), signal: AbortSignal.timeout(8000)});
    return r.status === 200 ? await r.json() : {ok: false, error: 'HTTP ' + r.status}} catch (e) {return {ok: false, error: e.message}}
}

// A new world under the same ids (issue #219). A runner holds heroes by id; a New World can hand the same ids to
// other heroes, and a runner that keeps its claims then plays nobody. worldChanged() names the held heroes whose
// identity changed. Identity today: the hero's name for its id (and the world instance id, once /play/health carries
// it as `world`: both sides must have one). Swap the test here when the game names the world.
import {NEW_WORLD_EXIT} from './runners.mjs';
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
export const newWorldLine = ch => `[world] a new world: ${ch.map(c => `#${c.id} was ${c.was}, now ${c.now}`).join('; ')}. Releasing the heroes and exiting (code ${NEW_WORLD_EXIT}) so the runner starts again for the current members; the old sessions are set aside in logs/agents/old/.`;

// Claude turns (issue #401): the same fresh state header the local turns get (briefText: state, HP, place, foe, news,
// memories, what was said lately), without its generic last line, plus the turn order. A Claude turn used to open with
// 2-4 reads and loop wait/look/party_read until the call cap (44% of turns). scene: a table turn, header only.
export const CLAUDE_TURN_ORDER = 'Act: give one command (or answer what is asked of you), then wait. When wait returns, act on its events if they need you, otherwise end your turn with one short sentence of narration; do not look again unless the events say the world changed.';
export function claudeBrief(b, {scene = false} = {}) {
  const t = briefText(b).replace(/\nAct through the tools[^\n]*$/, '');
  if (scene) return t;
  return t + (t ? '\nThis turn: the header above is fresh from the game, so do not open with status, look or party_read unless you need ids or detail it lacks. ' : '\nThis turn: ') + CLAUDE_TURN_ORDER;
}
