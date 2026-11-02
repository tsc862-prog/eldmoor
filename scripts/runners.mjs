// Runner supervisor (app runners): lets the game page start and stop agent runners, so the owner
// never needs a terminal per hero. The relay (scripts/relay.mjs --runners) and the headless host
// (scripts/play-headless.mjs --runners) attach it next to the agent-player routes of relay-mcp.mjs.
//
//   GET  /play/runner         {ok, enabled, how?, max, kinds:{kind:{defaults,caps}}, providers, runners:[...]}
//   POST /play/runner/start   {kind?:'hero'|'fellowship'|'dm', hero?, provider?, model?, maxTurns?, budget?}
//                             -> {ok, runner} | 4xx {error}
//   POST /play/runner/stop    {kind?, hero?} (or {key}) -> {ok, runner}
//   POST /play/runner/limits  {sessionBudget?: number|null} and/or {key, maxTurns?, budget?} -> {ok, session, runner?, applies?}
//                             (issue #145: limits set in the game). The session budget caps what all paid runners
//                             started by this supervisor spend together: the spend so far is in GET's `session`, a paid
//                             runner's budget is clipped to what is left, and when it runs out every paid runner is
//                             stopped ("session budget reached") and new paid starts are refused. A running runner's
//                             own turn cap or budget can be lowered live (the supervisor stops it on reaching it);
//                             raising it past what it was started with applies on its next start (applies: 'next start').
//
// A runner is one child process of a known kind (RUNNER_KINDS): 'hero' plays one agent-played hero
// (scripts/agent-player.mjs --hero <id>), 'fellowship' plays every agent-played Fellowship member
// (scripts/fellowship.mjs), 'dm' the DM agent (scripts/dm-agent.mjs, once installed; one at most). Each runner has a
// key ('hero:12', 'fellowship'), a state (starting, live, waiting, stopping, stopped, crashed), pid,
// uptime, turns and cost (read from its turn lines), turns per minute and the last turn's time (issue
// #126), what its pacing waits for (its last "[pace]" line), provider and model (from its claim, else as
// asked), the last lines of its output and, when it crashed, its last error line. Output goes to
// logs/runners/<key>.log (AGENT_LOGS moves logs/ for tests).
//
// Children are spawned with process.execPath and an argument array (no npm, no shell). They inherit
// the host's environment as a terminal runner would (the relay has read .env; the key is never put
// in arguments or logs) plus ELDMOOR_SUPERVISED=1: a supervised runner stops cleanly on a "stop"
// line on stdin and also when stdin closes, so a relay that dies takes its runners with it. On stop
// the supervisor writes "stop", waits STOP_GRACE_MS, then kills; on host exit every child is killed.
//
// Safety: off unless enabled (--runners / RELAY_RUNNERS=1); only loopback sockets with a localhost
// Host; only no Origin (local tools) or the game page's origin; a hero must be one the game names as
// agent-played (and not already held by a live runner); providers limited to RUNNER_PROVIDERS, model
// names to MODEL_RE; maxTurns and budget capped per kind (local models: no budget, and no turn cap unless
// one is asked: a local runner plays until stopped, issue #126; Claude and OpenAI keep the kind's default); at
// most MAX_RUNNERS at once, and at most CLAUDE_SLOTS concurrent Claude requests across them.
import {spawn} from 'node:child_process';
import {mkdirSync, appendFileSync, readFileSync, existsSync} from 'node:fs';
import {join, dirname, relative} from 'node:path';
import {hostname} from 'node:os';
import {fileURLToPath} from 'node:url';
import {LOGS, RUNNER_PROVIDERS, sessionPath} from './agent-sessions.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Claude slots: concurrent Claude turns the app's runners may run (env RUNNER_CLAUDE_MAX, at least 1). A
// supervised Claude runner leases a slot for each turn (POST /play/runner/slot, released after the turn;
// scripts/pacing.mjs withClaudeSlot) and waits its turn when all are taken, so any number of Claude runners
// can be started (five members and the DM always fit) while at most this many talk to the API at once.
// A Fellowship runner also gets --claude-concurrency so its members queue inside it (scene turns first).
// The relay itself keeps RELAY_ANTHROPIC_CONCURRENCY (default 2) for brain calls; keep the sum of the two
// within the API org's concurrent-request limit (default 2 + 3 = 5). Local (Ollama) runners take none.
export const CLAUDE_SLOTS = 3, LEASE_MS = 15 * 60000, LEASE_WAIT_MS = 20000;
// At most MAX_RUNNERS at once (env RELAY_MAX_RUNNERS). SEATS: the Fellowship's five and the DM, which always
// fit whatever the setting: a runner for a Fellowship member, the Fellowship runner or the DM is refused only
// when SEATS such runners already run.
export const SEATS = 6;
// The Claude model a runner started from the app plays when neither the request nor the hero's saved settings name
// one (the owner's cost ask, #126): Haiku. Terminal runners keep their own default (Sonnet). AGENT_MODEL / DM_MODEL
// in the relay's environment override it.
export const APP_CLAUDE_MODEL = 'claude-haiku-5-5';
export const MAX_RUNNERS = 6, STOP_GRACE_MS = 6000, KEEP_LINES = 12, MAX_BODY = 4096, KEEP_DONE = 20, TPM_WINDOW = 10 * 60000;
export const MODEL_RE = /^[A-Za-z0-9][\w.:\/+-]{0,99}$/; // the relay's (providers/index.mjs), kept here so this module has no SDK imports
export const HOW = 'Runners are off. Start the relay with runners on: npm run relay -- --runners (or set RELAY_RUNNERS=1, or use start-eldmoor.cmd).';
// Kinds of runner. defaults: what the terminal runner uses; caps: the most a request may ask.
// heroes(req, heroes): the agent-played heroes this runner plays, from the game's list.
export const RUNNER_KINDS = {
  hero: {script: 'scripts/agent-player.mjs', label: 'hero runner', needsHero: true,
    defaults: {maxTurns: 20, budget: 1}, caps: {maxTurns: 200, budget: 5},
    key: r => 'hero:' + r.hero, args: r => ['--hero', String(r.hero)], heroes: (r) => [r.hero]},
  fellowship: {script: 'scripts/fellowship.mjs', label: 'Fellowship runner', needsHero: false,
    defaults: {maxTurns: 6, budget: 2}, caps: {maxTurns: 100, budget: 10},
    key: () => 'fellowship', args: () => [], heroes: (r, hs) => hs.filter(h => h.fellow && h.alive).map(h => h.id)},
  // The DM agent (#66): one at most, no hero; it claims the DM seat itself. Installed once scripts/dm-agent.mjs exists.
  dm: {script: 'scripts/dm-agent.mjs', label: 'DM agent', needsHero: false, noHeroes: true, missing: 'The DM agent is not installed yet (scripts/dm-agent.mjs comes with the DM agent PR).',
    defaults: {maxTurns: 12, budget: 1}, caps: {maxTurns: 200, budget: 5},
    key: () => 'dm', args: () => [], heroes: () => [], session: 'dm', seat: 'dm'}, // seat: the claim key it holds at the relay (DM_KEY in relay-mcp.mjs)
};
export const kindInstalled = K => existsSync(join(ROOT, K.script));

const localHost = h => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(String(h || ''));
const loopback = a => /^(127\.|::1$|::ffff:127\.)/.test(String(a || ''));
const stripAnsi = s => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const num = v => v === undefined || v === null || v === '' ? null : Number(v);
export const SESSION_BUDGET_MAX = 500; // dollars: the most a session budget may be set to

// Check a start request against the kinds, providers and caps. Returns {req} or {error, code}.
const seatRunner = r => r.kind === 'dm' || r.kind === 'fellowship' || !!r.fellow;
export function checkStart(b, heroes, {running = [], max = MAX_RUNNERS} = {}) {
  if (!b || typeof b !== 'object') return {error: 'bad body', code: 400};
  const kind = b.kind == null ? 'hero' : b.kind, K = RUNNER_KINDS[kind];
  if (!K) return {error: 'unknown runner kind (one of: ' + Object.keys(RUNNER_KINDS).join(', ') + ')', code: 400};
  const req = {kind};
  if (b.provider != null && b.provider !== '') {if (!RUNNER_PROVIDERS.includes(b.provider)) return {error: 'unknown provider (one of: ' + RUNNER_PROVIDERS.join(', ') + ')', code: 400}; req.provider = b.provider}
  if (b.model != null && b.model !== '') {if (typeof b.model !== 'string' || !MODEL_RE.test(b.model)) return {error: 'bad model name', code: 400}; req.model = b.model}
  const local = req.provider === 'ollama'; // openai is paid: it keeps the budget cap and takes no Claude slot
  const mt = num(b.maxTurns), bu = num(b.budget);
  if (mt !== null && !(Number.isInteger(mt) && mt >= 1 && mt <= K.caps.maxTurns)) return {error: `maxTurns must be a whole number from 1 to ${K.caps.maxTurns}`, code: 400};
  if (bu !== null && !(Number.isFinite(bu) && bu >= .01 && bu <= K.caps.budget)) return {error: `budget must be from $0.01 to $${K.caps.budget.toFixed(2)}`, code: 400};
  req.maxTurns = mt; // null: the runner's own default (Claude/OpenAI: the kind's default; a local mind: until stopped)
  req.budget = local ? null : bu ?? K.defaults.budget; // a local model costs nothing: turns are its only cap
  const known = (heroes || []);
  if (K.needsHero) {
    const id = typeof b.hero === 'number' ? b.hero : /^\d{1,9}$/.test(String(b.hero ?? '').trim()) ? Number(String(b.hero).trim()) : NaN;
    if (!Number.isInteger(id)) return {error: 'start needs the hero id', code: 400};
    const h = known.find(x => x.id === id);
    if (!h) return {error: `Hero #${id} is not agent-played in the game (press Agent on it first).`, code: 404};
    if (!h.alive) return {error: `${h.name} is dead. Hardcore: one life.`, code: 409};
    req.hero = id; req.name = h.name; if (h.fellow) req.fellow = true;
  } else if (K.noHeroes) {
    if (!kindInstalled(K)) return {error: K.missing || `${K.label} is not installed.`, code: 501};
    req.name = K.label;
  } else {
    const ids = K.heroes(req, known);
    if (!ids.length) return {error: kind === 'fellowship' ? 'No agent-played Fellowship member. Set the Fellowship\'s Minds to agents first.' : 'Nothing for this runner to play.', code: 404};
    req.name = kind === 'fellowship' ? 'the Fellowship' : kind;
  }
  req.key = K.key(req);
  if (running.some(r => r.key === req.key)) return {error: `A ${K.label} for ${req.name} is already running.`, code: 409};
  if (running.length >= max && !(seatRunner(req) && running.filter(seatRunner).length < SEATS)) return {error: `At most ${max} runners at once (RELAY_MAX_RUNNERS). Stop one first.`, code: 429};
  return {req};
}

// The command line for a runner (no key, no shell): node <script> --url <base> ...
export function runnerArgs(req, base) {
  const K = RUNNER_KINDS[req.kind], a = [K.script, '--url', base, ...K.args(req)];
  if (req.maxTurns != null) a.push('--max-turns', String(req.maxTurns));
  if (req.budget != null) a.push('--budget', String(req.budget));
  if (req.provider) a.push('--provider', req.provider);
  if (req.model) a.push('--model', req.model);
  if (req.claudeConcurrency) a.push('--claude-concurrency', String(req.claudeConcurrency));
  return a;
}

// attachRunners(server, {play, enabled, origin, base, log, spawnImpl, logs}) -> {list, start, stop, stopAll}
//   play: attachPlay()'s return (backend, linkOf, runnerOf, claimed, dropRunner)
//   base: () => the URL runners use to reach this server (http://127.0.0.1:<port>)
export function attachRunners(server, {play, enabled = false, origin = 'http://localhost:5173', base, log = console.log, spawnImpl = spawn, logs = LOGS, env = process.env, now = () => Date.now()} = {}) {
  const claudeMax = Number.isFinite(Number(env.RUNNER_CLAUDE_MAX)) && env.RUNNER_CLAUDE_MAX !== '' && env.RUNNER_CLAUDE_MAX != null ? Math.max(1, Number(env.RUNNER_CLAUDE_MAX)) : CLAUDE_SLOTS;
  const maxRunners = Number(env.RELAY_MAX_RUNNERS) >= 1 ? Math.round(Number(env.RELAY_MAX_RUNNERS)) : MAX_RUNNERS;
  // Claude slot leases: lease id -> {key, at}; waiters get the next free one in order
  const leases = new Map(), waiters = []; let leaseSeq = 0;
  const grantNext = () => {for (const [id, l] of leases) if (now() - l.at > LEASE_MS) leases.delete(id); // a lease never held forever
    while (waiters.length && leases.size < claudeMax) {const w = waiters.shift(); const id = 'L' + (++leaseSeq); leases.set(id, {key: w.key, at: now()}); clearTimeout(w.t); w.res(id)}};
  const dropLeases = key => {for (const [id, l] of leases) if (l.key === key) leases.delete(id); grantNext()};
  // the provider a hero's runner will use: the request's, else the hero's saved runner settings, else the default
  const providerFor = (id, asked) => {if (asked) return asked;
    try {const f = typeof id === 'string' ? join(logs, 'agents', id + '.json') : sessionPath(id, logs); if (existsSync(f)) {const j = JSON.parse(readFileSync(f, 'utf8')); if (j && j.runner && j.runner.provider) return j.runner.provider}} catch {}
    return env.AGENT_PROVIDER || 'anthropic'};
  const table = new Map(); // key -> runner record (running and recently finished)
  const session = {budget: null, spent: 0}; // issue #145: one budget across every paid runner of this supervisor
  const left = () => session.budget == null ? Infinity : Math.max(0, session.budget - session.spent);
  const paid = r => r.budget != null; // local (Ollama) runners have no budget: they cost nothing
  const sessionView = () => ({budget: session.budget, spent: Math.round(session.spent * 10000) / 10000, left: session.budget == null ? null : Math.round(left() * 10000) / 10000})
  const dir = join(logs, 'runners');
  const heroes = () => (play.backend.info().heroes || []);
  const running = () => [...table.values()].filter(r => !r.done);
  const host = hostname();

  // A runner's state from its process and its heroes' claims and links.
  function stateOf(r) {
    if (r.done) return r.state;
    if (r.stopping) return 'stopping';
    const K = RUNNER_KINDS[r.kind];
    if (K.seat) {if (!play.claimed(K.seat)) return 'starting'; return play.linkOf(K.seat) === 'connected' ? 'live' : 'waiting'} // the DM seat's claim and link (#66)
    if (K.noHeroes) return r.turns ? 'live' : r.lines.length ? 'waiting' : 'starting'; // no hero claims to read: its output tells
    const ids = r.kind === 'hero' ? [r.hero] : RUNNER_KINDS[r.kind].heroes(r, heroes());
    const links = ids.map(id => play.linkOf(id)), held = ids.filter(id => play.claimed(id));
    if (!held.length) return 'starting';
    return links.includes('connected') ? 'live' : 'waiting';
  }
  function view(r) {
    const ids = r.kind === 'hero' ? [r.hero] : r.done ? r.heroes || [] : RUNNER_KINDS[r.kind].heroes(r, heroes());
    if (!r.done) r.heroes = ids;
    const seat = RUNNER_KINDS[r.kind].seat, mind = seat ? play.runnerOf(seat) : ids.map(id => play.runnerOf(id)).find(Boolean);
    return {key: r.key, kind: r.kind, hero: r.hero ?? null, heroes: ids, name: r.name, state: stateOf(r), pid: r.pid,
      startedAt: new Date(r.started).toISOString(), uptime: Math.round(((r.ended || now()) - r.started) / 1000),
      turns: r.turns, cost: Math.round(r.cost * 10000) / 10000, provider: (mind && mind.provider) || r.provider || null, model: (mind && mind.model) || r.model || null,
      capTurns: r.capTurns ?? null, capBudget: r.capBudget ?? null, stopWhy: r.stopWhy || null,
      maxTurns: r.maxTurns ?? null, turnCap: r.maxTurns != null ? 'up to ' + r.maxTurns + ' turns' : r.local ? 'until stopped' : 'up to ' + RUNNER_KINDS[r.kind].defaults.maxTurns + ' turns' + (r.kind === 'fellowship' ? ' each' : ''),
      ...turnRate(r), pace: r.pace || null, budget: r.budget, claudeSlots: r.claude || 0, lines: r.lines.slice(-8), error: r.error || null, exit: r.exit ?? null,
      log: relative(ROOT, r.logFile).replace(/\\/g, '/')};
  }
  // turns per minute over the last TPM_WINDOW (or the uptime when shorter) and the last turn's time
  function turnRate(r) {const t = now(), since = Math.max(r.started, t - TPM_WINDOW), n = (r.turnTimes || []).filter(x => x >= since).length, mins = Math.max(1 / 6, ((r.ended || t) - since) / 60000);
    const last = r.turnTimes && r.turnTimes.length ? r.turnTimes[r.turnTimes.length - 1] : null;
    return {turnsPerMin: Math.round(n / mins * 10) / 10, lastTurnAt: last ? new Date(last).toISOString() : null, lastTurnAgo: last ? Math.round(((r.ended || t) - last) / 1000) : null}}
  const list = () => [...table.values()].map(view);

  function start(req) {
    const args = runnerArgs(req, base());
    mkdirSync(dir, {recursive: true});
    const logFile = join(dir, req.key.replace(/[^A-Za-z0-9_-]+/g, '-') + '.log');
    const r = {...req, started: now(), turns: 0, cost: 0, lines: [], logFile, done: false};
    const write = line => {try {appendFileSync(logFile, line + '\n')} catch {}};
    write(`=== ${new Date().toISOString()} start ${req.kind} ${req.name} | node ${args.join(' ')}`);
    let child;
    try {child = spawnImpl(process.execPath, args, {cwd: ROOT, env: {...env, ELDMOOR_SUPERVISED: '1', ELDMOOR_RUNNER_KEY: req.key, AGENT_MODEL: env.AGENT_MODEL || APP_CLAUDE_MODEL, DM_MODEL: env.DM_MODEL || APP_CLAUDE_MODEL}, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true})}
    catch (e) {return {error: 'could not start: ' + e.message}}
    r.child = child; r.pid = child.pid;
    const take = (buf, err) => {
      r.partial = (r.partial || '') + stripAnsi(String(buf));
      const parts = r.partial.split(/\r?\n/); r.partial = parts.pop();
      for (const line of parts) {if (!line.trim()) continue;
        write(line); r.lines.push(line.slice(0, 300)); if (r.lines.length > KEEP_LINES) r.lines.shift();
        if (/\[turn \d+/.test(line)) {r.turns++; (r.turnTimes || (r.turnTimes = [])).push(now()); if (r.turnTimes.length > 200) r.turnTimes.shift()}
        const pc = line.match(/\[pace\] (.*)$/); if (pc) r.pace = pc[1].slice(0, 160);
        const c = line.match(/\| run \$(\d+\.\d+)/); if (c) {const v = Number(c[1]); if (v > r.cost) session.spent += v - r.cost; r.cost = v}
        if (err || /failed|error|not ready|refused|No ANTHROPIC|is not|cannot|could not/i.test(line)) r.lastErr = line.slice(0, 300);
      }};
    child.stdout && child.stdout.on('data', d => {take(d, false); checkCaps()});
    child.stderr && child.stderr.on('data', d => {take(d, true); checkCaps()});
    if (child.stdin) child.stdin.on('error', () => {});
    child.on('error', e => {r.lastErr = 'could not start: ' + e.message; finish(null)});
    child.on('exit', code => finish(code));
    function finish(code) {
      if (r.done) return;
      if (r.partial) take('\n', false);
      r.done = true; r.ended = now(); r.exit = code; clearTimeout(r.killT);
      r.state = r.stopping || code === 0 ? 'stopped' : 'crashed';
      if (r.state === 'crashed') r.error = r.lastErr || (code == null ? 'the process could not start' : 'exited with code ' + code);
      write(`=== ${new Date().toISOString()} ${r.state}${code != null ? ' (exit ' + code + ')' : ''}${r.error ? ': ' + r.error : ''}`);
      log(`[runners] ${r.key} ${r.name} ${r.state}${r.error ? ': ' + r.error : ''} (${r.turns} turns${r.cost ? ', $' + r.cost.toFixed(4) : ''})`);
      if (r.pid) play.dropRunner(`${host}:${r.pid}`); // its claims, in case it could not release them
      dropLeases(r.key);
      const done = [...table.values()].filter(x => x.done); // keep a few finished runners for the page
      if (done.length > KEEP_DONE) table.delete(done[0].key);
    }
    table.delete(req.key); table.set(req.key, r);
    log(`[runners] started ${req.kind} runner for ${req.name} (pid ${r.pid}): ${req.provider || 'saved provider'}${req.model ? ' ' + req.model : ''}, ${req.maxTurns != null ? req.maxTurns + ' turns' : req.local ? 'until stopped' : 'default turns'}${req.budget != null ? ', $' + req.budget.toFixed(2) : ''}`);
    return {runner: view(r)};
  }

  // Limits set in the game (#145): a lowered turn cap or budget, and the session budget. The runner's own reason
  // line ("stopped after N turns (reason)") is what the page's runner-stop alert reads.
  function checkCaps() {
    for (const r of running()) {if (r.stopping) continue;
      const why = r.capTurns != null && r.kind !== 'fellowship' && r.turns >= r.capTurns ? `turn cap reached: ${r.turns} of ${r.capTurns}`
        : r.capBudget != null && r.cost >= r.capBudget ? `budget reached: $${r.cost.toFixed(2)} of $${r.capBudget.toFixed(2)}`
        : paid(r) && session.budget != null && left() <= 0 ? `session budget reached: $${session.spent.toFixed(2)} of $${session.budget.toFixed(2)}` : null;
      if (why) {r.lines.push(`[runners] stopped after ${r.turns} turns (${why})`); if (r.lines.length > KEEP_LINES) r.lines.shift(); stop(r.key, why)}}}
  // Change limits. Returns {session, runner?, applies?} or {error, code}.
  function limits(b) {
    if (!b || typeof b !== 'object') return {error: 'bad body', code: 400};
    if ('sessionBudget' in b) {const v = num(b.sessionBudget);
      if (v !== null && !(Number.isFinite(v) && v >= .01 && v <= SESSION_BUDGET_MAX)) return {error: `sessionBudget must be from $0.01 to $${SESSION_BUDGET_MAX}, or null for none`, code: 400};
      session.budget = v; log(`[runners] session budget ${v == null ? 'off' : '$' + v.toFixed(2)} (spent $${session.spent.toFixed(4)})`)}
    let out = {session: sessionView()};
    if (b.key != null) {const r = table.get(String(b.key)); if (!r || r.done) return {error: 'no such live runner', code: 404};
      const K = RUNNER_KINDS[r.kind], mt = num(b.maxTurns), bu = num(b.budget); let later = false;
      if ('maxTurns' in b) {if (mt !== null && !(Number.isInteger(mt) && mt >= 1 && mt <= K.caps.maxTurns)) return {error: `maxTurns must be a whole number from 1 to ${K.caps.maxTurns}`, code: 400};
        const own = r.maxTurns ?? (r.local ? Infinity : K.defaults.maxTurns); r.capTurns = mt; if (mt == null ? own !== Infinity : mt > own || r.kind === 'fellowship') later = true}
      if ('budget' in b) {if (!paid(r)) return {error: 'a local runner has no budget', code: 400};
        if (bu !== null && !(Number.isFinite(bu) && bu >= .01 && bu <= K.caps.budget)) return {error: `budget must be from $0.01 to $${K.caps.budget.toFixed(2)}`, code: 400};
        r.capBudget = bu; if (bu == null || bu > r.budget) later = true}
      out = {...out, runner: view(r), applies: later ? 'next start' : 'now'}}
    checkCaps(); out.session = sessionView(); return out}

  function stop(key, why) {
    const r = table.get(key);
    if (!r) return {error: 'no such runner', code: 404};
    if (r.done) return {runner: view(r)};
    if (!r.stopping) {
      r.stopping = true; if (why) r.stopWhy = why;
      try {r.child.stdin && r.child.stdin.write('stop\n')} catch {}
      r.killT = setTimeout(() => {try {r.child.kill()} catch {}}, STOP_GRACE_MS); if (r.killT.unref) r.killT.unref();
      log(`[runners] stopping ${r.key} ${r.name} (pid ${r.pid})${why ? ': ' + why : ''}`);
    }
    return {runner: view(r)};
  }
  function stopAll() {for (const r of running()) stop(r.key)}
  function killAll() {for (const r of running()) {try {r.child.kill()} catch {}}}
  process.on('exit', killAll);
  server.on('close', killAll);

  const readBody = req => new Promise((res, rej) => {let size = 0; const chunks = [];
    req.on('data', c => {size += c.length; if (size > MAX_BODY) {rej(new Error('too large')); req.destroy()} else chunks.push(c)});
    req.on('end', () => {try {res(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})} catch {rej(new Error('bad json'))}});
    req.on('error', rej)});

  // Routes in front of everything else on the server (the page calls these, so they answer CORS).
  const prior = server.listeners('request'); server.removeAllListeners('request');
  server.on('request', async (req, res) => {
    const path = (req.url || '').split('?')[0];
    if (!(path === '/play/runner' || path.startsWith('/play/runner/'))) {for (const f of prior) f.call(server, req, res); return}
    const o = req.headers.origin, okOrigin = !o || o === origin;
    const send = (code, obj) => {const h = {'content-type': 'application/json'}; if (o && o === origin) {h['access-control-allow-origin'] = origin; h.vary = 'origin'} res.writeHead(code, h); res.end(JSON.stringify(obj))};
    if (!localHost(req.headers.host) || !loopback(req.socket.remoteAddress)) return send(403, {error: 'host not allowed'});
    if (!okOrigin) return send(403, {error: 'origin not allowed'});
    if (req.method === 'OPTIONS') {res.writeHead(204, o === origin ? {'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600', vary: 'origin'} : {}); return res.end()}
    const kinds = Object.fromEntries(Object.entries(RUNNER_KINDS).map(([k, K]) => [k, {defaults: K.defaults, caps: K.caps, installed: kindInstalled(K)}]));
    // The runners' output (narration, tool results, the DM's thinking) is for the watcher's page only (issue #123):
    // a request without the page's origin (another local process, a runner) gets the states without the lines.
    if (path === '/play/runner' && req.method === 'GET') {const page = o === origin, rs = enabled ? list().map(v => page ? v : {...v, lines: [], error: v.error ? 'see the runner log' : null}) : [];
      return send(200, {ok: true, enabled, ...(enabled ? {} : {how: HOW}), session: sessionView(), max: maxRunners, seats: SEATS, claude: {slots: claudeMax, used: leases.size, waiting: waiters.length}, kinds, providers: RUNNER_PROVIDERS, runners: rs})}
    if (req.method !== 'POST') return send(404, {error: 'not found'});
    if (!enabled) return send(403, {error: 'runners are off', how: HOW});
    let b; try {b = await readBody(req)} catch (e) {return send(400, {error: e.message})}
    if (path === '/play/runner/start') {
      const c = checkStart(b, heroes(), {running: running(), max: maxRunners});
      if (c.error) {log(`[runners] start refused: ${c.error}`); return send(c.code, {ok: false, error: c.error})}
      if (c.req.kind === 'hero' && play.claimed(c.req.hero)) return send(409, {ok: false, error: `${c.req.name} already has a live agent runner (one agent per hero).`});
      if (c.req.kind === 'dm') {const d = play.dmInfo ? play.dmInfo() : null; // the DM seat (#66)
        if (d && !d.seat) return send(409, {ok: false, error: 'The DM seat is closed: open it first (Dungeon Master panel, "Open seat").'});
        if (d && d.claimed) return send(409, {ok: false, error: 'The DM seat already has a live runner (one DM at a time).'})}
      // Claude slots (see CLAUDE_SLOTS): its Claude minds lease a slot per turn, so starting never waits on them
      const K = RUNNER_KINDS[c.req.kind], ids = K.session ? [K.session] : K.heroes(c.req, heroes()), want = ids.filter(id => providerFor(id, c.req.provider) === 'anthropic').length;
      c.req.claude = want; if (c.req.kind === 'fellowship' && want) c.req.claudeConcurrency = Math.min(want, claudeMax);
      c.req.local = ids.length > 0 && ids.every(id => providerFor(id, c.req.provider) === 'ollama'); // no turn cap unless asked (issue #126)
      if (paid(c.req) && session.budget != null) {const l = left(); // the session budget (#145): clip this runner's budget to what is left
        if (l < .01) return send(402, {ok: false, error: `Session budget reached ($${session.spent.toFixed(2)} of $${session.budget.toFixed(2)}). Raise it in the game's Agents settings.`});
        if (c.req.budget > l) c.req.budget = Math.floor(l * 100) / 100}
      const s = start(c.req); if (s.error) return send(500, {ok: false, error: s.error});
      return send(200, {ok: true, runner: s.runner});
    }
    // A supervised runner's Claude turn: lease a slot (waits up to LEASE_WAIT_MS, then {ok:false, busy}; the
    // runner asks again) and release it after the turn. Only for a live runner of this supervisor.
    if (path === '/play/runner/slot') {
      const key = typeof b.key === 'string' ? b.key : '', r = table.get(key);
      if (!r || r.done) return send(404, {ok: false, error: 'no such live runner'});
      grantNext();
      if (leases.size < claudeMax && !waiters.length) {const id = 'L' + (++leaseSeq); leases.set(id, {key, at: now()}); return send(200, {ok: true, lease: id, slots: claudeMax})}
      const id = await new Promise(res => {const w = {key, res}; w.t = setTimeout(() => {const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); res(null)}, LEASE_WAIT_MS); waiters.push(w)});
      return send(200, id ? {ok: true, lease: id, slots: claudeMax} : {ok: false, busy: true, slots: claudeMax, waiting: waiters.length});
    }
    if (path === '/play/runner/slot/release') {
      if (typeof b.lease === 'string' && leases.has(b.lease)) {leases.delete(b.lease); grantNext()}
      return send(200, {ok: true});
    }
    if (path === '/play/runner/limits') {
      const l = limits(b); if (l.error) return send(l.code, {ok: false, error: l.error});
      return send(200, {ok: true, ...l});
    }
    if (path === '/play/runner/stop') {
      let key = typeof b.key === 'string' ? b.key : null;
      if (!key) {const K = RUNNER_KINDS[b.kind == null ? 'hero' : b.kind]; if (!K) return send(400, {ok: false, error: 'unknown runner kind'}); key = K.key({hero: Number(b.hero)})}
      const s = stop(key); if (s.error) return send(s.code, {ok: false, error: s.error});
      return send(200, {ok: true, runner: s.runner});
    }
    send(404, {error: 'not found'});
  });
  return {list, start, stop, stopAll, killAll, table, limits, session: sessionView};
}

// A supervised runner (ELDMOOR_SUPERVISED=1) calls this once: fn runs on a "stop" line on stdin, or
// when stdin closes (the supervisor went away). Returns false when not supervised.
export function onSupervisorStop(fn) {
  if (process.env.ELDMOOR_SUPERVISED !== '1' || !process.stdin) return false;
  let fired = false; const go = why => {if (fired) return; fired = true; fn(why)};
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => {if (/\bstop\b/.test(d)) go('stopped from the game')});
  process.stdin.on('end', () => go('the supervisor went away'));
  process.stdin.on('error', () => go('the supervisor went away'));
  process.stdin.resume();
  return true;
}
