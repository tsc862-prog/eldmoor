// App runners check: the game page can start and stop agent runners through the relay
// (scripts/runners.mjs). No API key and no Ollama needed (a mock Ollama plays), so it runs in CI.
//   1. The request rules: kinds, providers, model names, caps, concurrency; the command line never
//      carries a key.
//   2. The routes with fake child processes: off without --runners (and says how to turn it on),
//      origin, host and hero checks, CORS for the game page, at most MAX_RUNNERS, one runner per key,
//      stop sends "stop" then kills, a crash keeps its last error line.
//   3. End to end: a headless world with --runners on a spare port, a local runner started over HTTP
//      claims its hero and plays turns (state, turns, provider/model, log file), is stopped and lets
//      go of the hero; a short run ends by itself; a Fellowship runner; and a runner whose host dies
//      hard stops by itself (stdin closes).
//   4. The real relay script on a spare port: off by default, on with --runners.
// Usage: npm run runnercheck
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdtempSync, existsSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir, hostname} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {attachPlay} from './relay-mcp.mjs';
import {attachRunners, checkStart, runnerArgs, MAX_RUNNERS, SEATS, RUNNER_KINDS, HOW} from './runners.mjs';
import {startMockOllama} from './mock-ollama.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PAGE = 'http://localhost:5173';
const until = async (f, ms = 30000, step = 150) => {const t0 = Date.now(); for (;;) {const v = await f().catch(() => null); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(step)}};
// as the page asks (with its origin): only the watcher's page sees the runners' output lines (issue #123)
const req = (base, path, {method = 'GET', body, origin = path.startsWith('/play/runner') ? PAGE : undefined, host} = {}) => fetch(base + path, {method, headers: {...(body ? {'content-type': 'application/json'} : {}), ...(origin ? {origin} : {}), ...(host ? {host} : {})}, body: body ? JSON.stringify(body) : undefined})
  .then(async r => ({status: r.status, headers: r.headers, ...(await r.json().catch(() => ({})))}));
const alive = pid => {try {process.kill(pid, 0); return true} catch {return false}};

// ---------------------------------------------------------------- 1. rules
console.log('start requests');
{
  const hs = [{id: 1, name: 'Ann', alive: true}, {id: 2, name: 'Bo', alive: false}, {id: 3, name: 'Cy', alive: true, fellow: true}, {id: 4, name: 'Di', alive: true, fellow: true}];
  const c = checkStart({hero: 1}, hs);
  ok(c.req && c.req.key === 'hero:1' && c.req.maxTurns === null && c.req.budget === 1, 'a hero runner keeps $1.00 and leaves the turn cap to the runner (Claude 20, a local mind until stopped; issue #126)');
  const l = checkStart({hero: '1', provider: 'ollama', model: 'qwen2.5:14b', maxTurns: 40}, hs);
  ok(l.req && l.req.budget === null && l.req.maxTurns === 40 && l.req.model === 'qwen2.5:14b', 'a local runner has no budget, only a turn cap');
  ok(checkStart({hero: 9}, hs).code === 404 && checkStart({hero: 2}, hs).code === 409 && checkStart({}, hs).code === 400, 'unknown, dead and missing heroes are refused');
  const oa = checkStart({hero: 1, provider: 'openai', model: 'gpt-6-luna'}, hs);
  ok(oa.req && oa.req.budget === 1 && oa.req.model === 'gpt-6-luna', 'an OpenAI runner is paid: it keeps the budget cap');
  ok(checkStart({hero: 1, provider: 'google'}, hs).code === 400 && checkStart({hero: 1, provider: 'x;rm'}, hs).code === 400, 'only providers with a runner (anthropic, ollama, openai)');
  ok(checkStart({hero: 1, model: 'a b'}, hs).code === 400 && checkStart({hero: 1, model: '--env=x'}, hs).code === 400, 'model names must be plain (no spaces, no leading dash)');
  ok(checkStart({hero: 1, maxTurns: 201}, hs).code === 400 && checkStart({hero: 1, maxTurns: 1.5}, hs).code === 400 && checkStart({hero: 1, budget: 5.01}, hs).code === 400 && checkStart({hero: 1, budget: 0}, hs).code === 400, 'turns and budget are capped (200 turns, $5.00 for one hero)');
  ok(checkStart({kind: 'shell'}, hs).code === 400, 'unknown runner kinds are refused');
  const f = checkStart({kind: 'fellowship'}, hs);
  ok(f.req && f.req.key === 'fellowship' && f.req.maxTurns === null && f.req.budget === 2, 'a Fellowship runner keeps $2.00 and leaves the turn cap to the runner (Claude members 6, local ones until stopped)');
  ok(checkStart({kind: 'fellowship'}, hs.filter(h => !h.fellow)).code === 404, 'no Fellowship runner without agent-played members');
  ok(checkStart({hero: 1}, hs, {running: [{key: 'hero:1'}]}).code === 409, 'one runner per hero');
  ok(checkStart({hero: 1}, hs, {running: Array.from({length: MAX_RUNNERS}, (_, i) => ({key: 'hero:' + (100 + i)}))}).code === 429, `at most ${MAX_RUNNERS} at once`);
  const args = runnerArgs({...c.req, provider: 'anthropic', model: 'claude-sonnet-5-5'}, 'http://127.0.0.1:8787');
  ok(args[0] === RUNNER_KINDS.hero.script && args.join(' ') === 'scripts/agent-player.mjs --url http://127.0.0.1:8787 --hero 1 --budget 1 --provider anthropic --model claude-sonnet-5-5', 'the command line: script, url, hero, budget, provider, model (no turn cap unless asked)');
  ok(runnerArgs({...l.req}, 'u').join(' ') === 'scripts/agent-player.mjs --url u --hero 1 --max-turns 40 --provider ollama --model qwen2.5:14b', 'an asked turn cap goes on the command line');
  {const fs = hs.map(h => ({...h, fellow: true, alive: true})), full = Array.from({length: MAX_RUNNERS}, (_, i) => ({key: 'hero:' + (100 + i)}));
    ok(checkStart({hero: 3}, fs, {running: full}).req && checkStart({kind: 'dm'}, fs, {running: full, max: 2}).req, 'a Fellowship member or the DM still fits when other runners fill the cap (six seats)');
    const seats = Array.from({length: SEATS}, (_, i) => ({key: 'hero:' + (200 + i), fellow: true}));
    ok(checkStart({hero: 3}, fs, {running: seats}).code === 429, `but not past ${SEATS} seats`)}
  ok(!args.some(a => /key|sk-ant/i.test(a)), 'no key on the command line');
  ok(runnerArgs({...f.req, claudeConcurrency: 2}, 'u').join(' ').endsWith('--budget 2 --claude-concurrency 2'), 'a Fellowship runner gets its share of Claude slots (--claude-concurrency)');
}

// ---------------------------------------------------------------- 2. routes, fake children
console.log('runner routes (fake children)');
{
  const tmp = mkdtempSync(join(tmpdir(), 'eldmoor-runnercheck-'));
  const heroes = [1, 2, 3, 4, 5, 6, 7].map(id => ({id, name: 'H' + id, alive: true}));
  let dmSeat = true; // the game's DM seat (#66): a DM runner starts only while it is open
  const be = {call: async () => ({ok: true}), dmCall: async () => ({ok: true}), narrate() {}, info: () => ({connected: true, heroes, dm: dmSeat})};
  const kids = [];
  const fakeSpawn = (cmd, args, opts) => {const k = new EventEmitter(); k.pid = 40000 + kids.length; k.cmd = cmd; k.args = args; k.opts = opts; k.got = '';
    k.stdout = new EventEmitter(); k.stderr = new EventEmitter(); k.stdin = Object.assign(new EventEmitter(), {write: d => {k.got += d}});
    k.kill = () => {k.killed = true; setTimeout(() => k.emit('exit', null), 5)}; kids.push(k); return k};
  const mk = async (enabled, extra = {RUNNER_CLAUDE_MAX: '10'}) => {const server = http.createServer((q, s) => {s.writeHead(404); s.end('{}')});
    const play = attachPlay(server, {backend: be, log: () => {}});
    const sup = attachRunners(server, {play, enabled, log: () => {}, spawnImpl: fakeSpawn, base: () => 'http://127.0.0.1:1', logs: tmp, env: {PATH: process.env.PATH, ANTHROPIC_API_KEY: 'sk-test-not-a-key', ...extra}});
    await new Promise(r => server.listen(0, '127.0.0.1', r)); return {server, sup, base: `http://127.0.0.1:${server.address().port}`}};

  const off = await mk(false);
  let g = await req(off.base, '/play/runner', {origin: PAGE});
  ok(g.status === 200 && g.enabled === false && g.how === HOW && g.headers.get('access-control-allow-origin') === PAGE, 'without --runners: the page hears runners are off and how to turn them on');
  let s = await req(off.base, '/play/runner/start', {method: 'POST', body: {hero: 1}, origin: PAGE});
  ok(s.status === 403 && /off/.test(s.error) && s.how, 'without --runners a start is refused');
  off.server.close();

  const on = await mk(true);
  g = await req(on.base, '/play/runner');
  ok(g.enabled === true && g.max === MAX_RUNNERS && g.kinds.hero.defaults.maxTurns === 20 && g.providers.includes('ollama'), 'with --runners: enabled, with the kinds, caps and providers');
  s = await req(on.base, '/play/runner/start', {method: 'POST', body: {hero: 1}, origin: 'http://evil.example'});
  ok(s.status === 403 && kids.length === 0, 'another origin is refused');
  s = await new Promise(res => {const u = new URL(on.base); const q = http.request({host: u.hostname, port: u.port, path: '/play/runner', headers: {host: 'evil.example'}}, r => {r.resume(); res({status: r.statusCode})}); q.end()});
  ok(s.status === 403, 'a non-local Host header is refused (DNS rebinding)');
  const pre = await fetch(on.base + '/play/runner/start', {method: 'OPTIONS', headers: {origin: PAGE, 'access-control-request-method': 'POST'}});
  ok(pre.status === 204 && pre.headers.get('access-control-allow-origin') === PAGE, 'the page\'s preflight is answered');
  s = await req(on.base, '/play/runner/start', {method: 'POST', body: {hero: 99}, origin: PAGE});
  ok(s.status === 404 && kids.length === 0, 'a hero the game does not name is refused');
  s = await req(on.base, '/play/runner/start', {method: 'POST', body: {hero: 1, budget: 50}, origin: PAGE});
  ok(s.status === 400 && kids.length === 0, 'a budget over the cap is refused');
  s = await req(on.base, '/play/runner/start', {method: 'POST', body: {hero: 1, provider: 'ollama', model: 'qwen2.5:14b', maxTurns: 30}, origin: PAGE});
  const k1 = kids[0];
  ok(s.status === 200 && s.runner.state === 'starting' && s.runner.pid === k1.pid && s.runner.provider === 'ollama', 'a start spawns one runner, state starting');
  ok(k1.cmd === process.execPath && Array.isArray(k1.args) && k1.args[0] === 'scripts/agent-player.mjs' && !k1.opts.shell && k1.opts.env.ELDMOOR_SUPERVISED === '1', 'spawned with node itself, an argument array, no shell, supervised');
  ok(!k1.args.includes('--budget') && k1.args.includes('--max-turns') && k1.args[k1.args.indexOf('--max-turns') + 1] === '30', 'a local runner gets its turn cap and no budget');
  s = await req(on.base, '/play/runner/start', {method: 'POST', body: {hero: 1}, origin: PAGE});
  ok(s.status === 409 && kids.length === 1, 'a second runner for the same hero is refused');
  // claims make it live/waiting; output lines give turns and cost
  await req(on.base, '/play/claim', {method: 'POST', body: {hero: 1, runner: hostname() + ':' + k1.pid, provider: 'ollama', model: 'qwen2.5:14b'}});
  k1.stdout.emit('data', '[agent] H1 #1 ...\n[turn 1] 3 tool calls | run $0.0150 | session $0.02\n[turn 2] 2 tool calls | run $0.0310 |');
  k1.stdout.emit('data', ' session $0.04\n');
  g = await req(on.base, '/play/runner');
  let v = g.runners.find(r => r.key === 'hero:1');
  ok(v && v.state === 'waiting' && v.turns === 2 && v.cost === 0.031 && v.lines.length === 3 && v.model === 'qwen2.5:14b', `claimed and quiet: waiting, 2 turns, $0.031, model from the claim (${v && v.state}, ${v && v.turns}, ${v && v.cost})`);
  {const nv = (await req(on.base, '/play/runner', {origin: null})).runners.find(r => r.key === 'hero:1');
    ok(nv && nv.state === 'waiting' && nv.lines.length === 0, 'without the page\'s origin the runners\' output lines are withheld (issue #123: for the watcher only)')}
  // up to MAX_RUNNERS
  for (const id of [2, 3, 4, 5, 6]) await req(on.base, '/play/runner/start', {method: 'POST', body: {hero: id}, origin: PAGE});
  s = await req(on.base, '/play/runner/start', {method: 'POST', body: {hero: 7}, origin: PAGE});
  ok(kids.length === MAX_RUNNERS && s.status === 429, `${MAX_RUNNERS} runners at once, the next is refused`);
  // stop: "stop" on stdin; the child exits cleanly
  s = await req(on.base, '/play/runner/stop', {method: 'POST', body: {hero: 1}, origin: PAGE});
  ok(s.status === 200 && s.runner.state === 'stopping' && k1.got === 'stop\n', 'stop asks the runner to stop (on its stdin)');
  k1.emit('exit', 0); await sleep(20);
  v = (await req(on.base, '/play/runner')).runners.find(r => r.key === 'hero:1');
  ok(v.state === 'stopped' && (await req(on.base, '/play/health')).heroes.find(h => h.id === 1).claimed === false, 'stopped, and its claim on the hero is dropped');
  // a crash keeps its last error line
  const k2 = kids[1]; k2.stderr.emit('data', '[agent] Ollama at http://localhost:11434 is not reachable. Start Ollama.\n'); k2.emit('exit', 1); await sleep(20);
  v = (await req(on.base, '/play/runner')).runners.find(r => r.key === 'hero:2');
  ok(v.state === 'crashed' && /not reachable/.test(v.error) && v.exit === 1, 'a crash shows its last error line: ' + (v && v.error));
  const logTxt = readFileSync(join(tmp, 'runners', 'hero-2.log'), 'utf8');
  ok(/start hero H2/.test(logTxt) && /crashed \(exit 1\)/.test(logTxt) && !/sk-test/.test(logTxt), 'the log file has the start line, the output and the end, and never the key');
  // a runner that ignores stop is killed after the grace period (skipped: shortened via a direct kill)
  s = await req(on.base, '/play/runner/stop', {method: 'POST', body: {key: 'nope'}, origin: PAGE});
  ok(s.status === 404, 'stopping an unknown runner says so');
  on.sup.killAll(); await sleep(20);
  ok(kids.slice(2).every(k => k.killed), 'the host closing kills every child');
  on.server.close();
  // Claude slots: concurrent Claude turns the app's runners may run on top of the relay's own; leased per turn
  const sl = await mk(true, {RUNNER_CLAUDE_MAX: '1'}), n0 = kids.length;
  s = await req(sl.base, '/play/runner/start', {method: 'POST', body: {hero: 1, provider: 'anthropic'}, origin: PAGE});
  const s2 = await req(sl.base, '/play/runner/start', {method: 'POST', body: {hero: 2}, origin: PAGE});
  const s3 = await req(sl.base, '/play/runner/start', {method: 'POST', body: {hero: 3, provider: 'ollama', model: 'qwen2.5:14b'}, origin: PAGE});
  ok(s.status === 200 && s2.status === 200 && s3.status === 200 && kids.length === n0 + 3 && kids[n0].opts.env.ELDMOOR_RUNNER_KEY === 'hero:1', 'with RUNNER_CLAUDE_MAX=1 two Claude runners and a local one all start (slots are leased per turn)');
  ok(kids[n0].opts.env.AGENT_MODEL === 'claude-haiku-5-5' && kids[n0].opts.env.DM_MODEL === 'claude-haiku-5-5', 'a Claude runner started from the app plays Claude Haiku unless the request or the saved settings of the hero say otherwise');
  const l1 = await req(sl.base, '/play/runner/slot', {method: 'POST', body: {key: 'hero:1'}});
  const t2 = Date.now(), p2 = req(sl.base, '/play/runner/slot', {method: 'POST', body: {key: 'hero:2'}});
  await sleep(150); g = await req(sl.base, '/play/runner');
  ok(l1.ok && l1.lease && g.claude.slots === 1 && g.claude.used === 1 && g.claude.waiting === 1, 'the first Claude turn gets the slot, the second waits for it (the page sees used and waiting)');
  await req(sl.base, '/play/runner/slot/release', {method: 'POST', body: {key: 'hero:1', lease: l1.lease}});
  const l2 = await p2;
  ok(l2.ok && l2.lease !== l1.lease && Date.now() - t2 < 5000, 'released after the turn, the slot goes to the waiting runner');
  ok((await req(sl.base, '/play/runner/slot', {method: 'POST', body: {key: 'nope'}})).status === 404, 'only a live runner of this supervisor may lease a slot');
  kids[n0 + 1].emit('exit', 0); await sleep(20);
  ok((await req(sl.base, '/play/runner')).claude.used === 0, 'a runner that exits gives its slot back');
  sl.sup.killAll(); sl.server.close();
  // six minds: the Fellowship's five as hero runners and the DM start together, whatever the caps
  {for (const h of heroes) h.fellow = h.id <= 5;
    const six = await mk(true, {RUNNER_CLAUDE_MAX: '1', RELAY_MAX_RUNNERS: '2'}), n2 = kids.length;
    const realDm6 = RUNNER_KINDS.dm.script; RUNNER_KINDS.dm.script = 'scripts/mock-ollama.mjs';
    const st = [];
    for (const id of [1, 2, 3, 4, 5]) st.push(await req(six.base, '/play/runner/start', {method: 'POST', body: {hero: id, provider: 'anthropic'}, origin: PAGE}));
    st.push(await req(six.base, '/play/runner/start', {method: 'POST', body: {kind: 'dm', provider: 'anthropic'}, origin: PAGE}));
    const extra = await req(six.base, '/play/runner/start', {method: 'POST', body: {hero: 6, provider: 'ollama', model: 'qwen2.5:14b'}, origin: PAGE});
    ok(st.every(x => x.status === 200) && kids.length === n2 + 6, `five members and the DM start together with RUNNER_CLAUDE_MAX=1 and RELAY_MAX_RUNNERS=2 (${st.map(x => x.status).join(',')})`);
    ok(extra.status === 429, 'a seventh runner, for a hero outside the Fellowship, is refused by the cap');
    RUNNER_KINDS.dm.script = realDm6; six.sup.killAll(); six.server.close();
    for (const h of heroes) delete h.fellow}
  // the DM agent: kind 'dm', no hero, one at most, counted in the Claude slots; refused until installed
  const dm = await mk(true, {RUNNER_CLAUDE_MAX: '2'}), n1 = kids.length;
  s = await req(dm.base, '/play/runner/start', {method: 'POST', body: {kind: 'dm', provider: 'anthropic', model: 'claude-sonnet-5-5', maxTurns: 10, budget: 1}, origin: PAGE});
  ok(existsSync(join(ROOT, 'scripts', 'dm-agent.mjs')) ? s.status === 200 : s.status === 501 && /DM agent is not installed yet/.test(s.error) && kids.length === n1, 'a DM runner before scripts/dm-agent.mjs exists: "not installed yet"');
  const realDm = RUNNER_KINDS.dm.script; RUNNER_KINDS.dm.script = 'scripts/mock-ollama.mjs'; // stand-in so the route can be tested now
  for (const k of dm.sup.list()) {dm.sup.stop(k.key); kids[kids.length - 1].emit('exit', 0)} await sleep(10); // the real DM runner, started above, is let go
  s = await req(dm.base, '/play/runner/start', {method: 'POST', body: {kind: 'dm', provider: 'anthropic', maxTurns: 10, budget: 1}, origin: PAGE});
  const kd = kids[kids.length - 1];
  const sd = await req(dm.base, '/play/runner/start', {method: 'POST', body: {kind: 'dm'}, origin: PAGE});
  g = await req(dm.base, '/play/runner');
  ok(s.status === 200 && s.runner.key === 'dm' && s.runner.hero === null && kd.args[0] === 'scripts/mock-ollama.mjs' && kd.args.includes('--budget') && sd.status === 409, 'a DM runner starts with no hero, its flags, and only one at a time');
  ok(g.runners.find(r => r.key === 'dm').claudeSlots === 1 && g.kinds.dm.installed === true, 'it counts as a Claude mind (it leases a slot per turn)');
  ok((await req(dm.base, '/play/runner')).runners.find(r => r.key === 'dm').state === 'starting', 'it is starting until it holds the DM seat');
  await fetch(dm.base + '/play/claim', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({role: 'dm', runner: 'fake:1'})});
  ok((await req(dm.base, '/play/runner')).runners.find(r => r.key === 'dm').state === 'waiting', 'it shows waiting once it holds the seat');
  await fetch(dm.base + '/play/dm', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({tool: 'dm_status', role: 'dm', runner: 'fake:1'})});
  kd.stdout.emit('data', '[dm] [turn 1] ... | run $0.0100 |\n'); await sleep(5);
  ok((await req(dm.base, '/play/runner')).runners.find(r => r.key === 'dm').state === 'live', 'it shows live once it calls the DM tools');
  s = await req(dm.base, '/play/runner/stop', {method: 'POST', body: {kind: 'dm'}, origin: PAGE});
  ok(s.status === 200 && kd.got === 'stop\n', 'stop {kind: "dm"} stops it');
  kd.emit('exit', 0); await sleep(20); dmSeat = false;
  s = await req(dm.base, '/play/runner/start', {method: 'POST', body: {kind: 'dm', provider: 'ollama', model: 'qwen2.5:14b'}, origin: PAGE});
  ok(s.status === 409 && /DM seat is closed/.test(s.error), 'with the DM seat closed a DM runner is refused');
  dmSeat = true;
  RUNNER_KINDS.dm.script = realDm; dm.sup.killAll(); dm.server.close();
  rmSync(tmp, {recursive: true, force: true});
}

// ---------------------------------------------------------------- 3. end to end
const tmp = mkdtempSync(join(tmpdir(), 'eldmoor-runnercheck-'));
const mock = await startMockOllama();
const childEnv = {...process.env, AGENT_LOGS: tmp, ANTHROPIC_API_KEY: '', OLLAMA_URL: mock.url, RELAY_RUNNERS: '', AGENT_MIN_GAP: '0', AGENT_HEARTBEAT: '30'}; // pacing (issue #126) kept short
const procs = [];
function start(args, {wait = null, env = childEnv} = {}) {
  const p = spawn(process.execPath, args, {cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe']}); procs.push(p);
  let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  const done = new Promise(r => p.on('exit', c => r(c)));
  const ready = wait ? until(async () => wait.test(out), 60000, 100) : null;
  return {p, done, ready, out: () => out};
}
const port = 19300 + Math.floor(Math.random() * 500), BASE = `http://127.0.0.1:${port}`;
console.log(`end to end: headless world --runners on port ${port}, mock Ollama`);
{
  const world = start(['scripts/play-headless.mjs', '--port', String(port), '--agents', '2', '--quiet', '--speed', '8', '--runners', '--world', join(tmp, 'world.json')], {wait: /headless world/});
  ok(await world.ready, 'the headless world is up');
  const [hA, hB] = (await req(BASE, '/play/health')).heroes;
  let s = await req(BASE, '/play/runner/start', {method: 'POST', origin: PAGE, body: {hero: hA.id, provider: 'ollama', model: 'mock-tools:1b', maxTurns: 60}});
  ok(s.status === 200 && s.runner.pid > 0, `started a local runner for ${hA.name} from "the page" (pid ${s.runner.pid})`);
  const pid = s.runner.pid;
  const live = await until(async () => {const r = (await req(BASE, '/play/runner')).runners.find(x => x.key === 'hero:' + hA.id); return r && r.turns >= 1 && ['live', 'waiting'].includes(r.state) ? r : null}, 60000);
  ok(live && live.provider === 'ollama' && live.model === 'mock-tools:1b', `it claims ${hA.name} and plays: ${live && live.state}, ${live && live.turns} turn(s), ${live && live.provider}/${live && live.model}`);
  const h = (await req(BASE, '/play/health')).heroes.find(x => x.id === hA.id);
  ok(h.claimed && h.runner && h.runner.model === 'mock-tools:1b', 'the game sees the claim and the local model');
  const logf = join(tmp, 'runners', `hero-${hA.id}.log`);
  ok(existsSync(logf) && /\[turn 1\] mock-tools:1b \(local\)/.test(readFileSync(logf, 'utf8')), 'its output goes to logs/runners/hero-<id>.log');
  s = await req(BASE, '/play/runner/stop', {method: 'POST', origin: PAGE, body: {hero: hA.id}});
  ok(s.status === 200 && s.runner.state === 'stopping', 'stop from the page');
  const st = await until(async () => {const r = (await req(BASE, '/play/runner')).runners.find(x => x.key === 'hero:' + hA.id); return r && r.done !== false && r.state === 'stopped' ? r : null}, 15000);
  ok(st && st.exit === 0 && !alive(pid), `the runner stops cleanly (exit ${st && st.exit}) and its process is gone`);
  const h2 = (await req(BASE, '/play/health')).heroes.find(x => x.id === hA.id);
  ok(!h2.claimed, 'the hero is free again');
  ok(/stopped from the game: releasing the hero/.test(readFileSync(logf, 'utf8')), 'the runner logged why it stopped');

  // a short run ends on its own
  s = await req(BASE, '/play/runner/start', {method: 'POST', origin: PAGE, body: {hero: hB.id, provider: 'ollama', model: 'mock-tools:1b', maxTurns: 1}});
  const fin = await until(async () => {const r = (await req(BASE, '/play/runner')).runners.find(x => x.key === 'hero:' + hB.id); return r && (r.state === 'stopped' || r.state === 'crashed') ? r : null}, 60000);
  ok(fin && fin.state === 'stopped' && fin.turns === 1 && fin.exit === 0, `a 1-turn run ends by itself: ${fin && fin.state}, ${fin && fin.turns} turn`);
  // a model that is not pulled: crashed with the reason
  s = await req(BASE, '/play/runner/start', {method: 'POST', origin: PAGE, body: {hero: hB.id, provider: 'ollama', model: 'nope:1b', maxTurns: 1}});
  const cr = await until(async () => {const r = (await req(BASE, '/play/runner')).runners.find(x => x.key === 'hero:' + hB.id); return r && r.state === 'crashed' ? r : null}, 30000);
  ok(cr && /not pulled/.test(cr.error), 'a runner that cannot play shows crashed with its reason: ' + (cr && cr.error));

  // the host dies hard: the runner notices its stdin closing and stops by itself
  s = await req(BASE, '/play/runner/start', {method: 'POST', origin: PAGE, body: {hero: hB.id, provider: 'ollama', model: 'mock-tools:1b', maxTurns: 60}});
  const pid2 = s.runner.pid;
  await until(async () => (await req(BASE, '/play/runner')).runners.find(x => x.key === 'hero:' + hB.id && x.turns >= 1), 60000);
  world.p.kill('SIGKILL');
  const gone = await until(async () => !alive(pid2), 15000, 200);
  ok(gone, 'when the host is killed, its runner exits too (no orphans)');
}

console.log('end to end: a Fellowship runner');
{
  const fport = port + 1, FB = `http://127.0.0.1:${fport}`;
  const fw = start(['scripts/play-headless.mjs', '--fellowship', '--no-relay', '--port', String(fport), '--quiet', '--speed', '8', '--runners', '--world', join(tmp, 'fworld.json')], {wait: /headless world/});
  ok(await fw.ready, 'a headless Fellowship world is up');
  let s = await req(FB, '/play/runner/start', {method: 'POST', origin: PAGE, body: {kind: 'fellowship', provider: 'ollama', model: 'mock-tools:1b', maxTurns: 20}});
  ok(s.status === 200 && s.runner.key === 'fellowship', 'Start all five: one Fellowship runner');
  const r = await until(async () => {const x = (await req(FB, '/play/runner')).runners.find(y => y.key === 'fellowship'); return x && x.heroes.length === 5 && x.turns >= 5 ? x : null}, 90000);
  ok(r && (await req(FB, '/play/health')).heroes.filter(h => h.claimed).length === 5, `it plays all five members (${r && r.turns} turns so far)`);
  s = await req(FB, '/play/runner/start', {method: 'POST', origin: PAGE, body: {hero: r ? r.heroes[0] : 0, provider: 'ollama', model: 'mock-tools:1b'}});
  ok(s.status === 409, 'a hero runner for a member the Fellowship runner holds is refused');
  await req(FB, '/play/runner/stop', {method: 'POST', origin: PAGE, body: {kind: 'fellowship'}});
  const st = await until(async () => {const x = (await req(FB, '/play/runner')).runners.find(y => y.key === 'fellowship'); return x && x.state === 'stopped' ? x : null}, 20000);
  ok(st && (await req(FB, '/play/health')).heroes.every(h => !h.claimed), 'Stop all: stopped, every member free');
  fw.p.kill();
}

console.log('the relay script');
{
  const rport = port + 2, RB = `http://127.0.0.1:${rport}`, renv = {...childEnv, RELAY_PORT: String(rport)};
  let relay = start(['scripts/relay.mjs', '--play-only'], {wait: /app runners/, env: renv});
  ok(await relay.ready && /app runners off/.test(relay.out()), 'the relay starts with runners off by default');
  let g = await req(RB, '/play/runner', {origin: PAGE});
  ok(g.enabled === false && /--runners/.test(g.how), 'and tells the page how to turn them on');
  relay.p.kill(); await relay.done;
  relay = start(['scripts/relay.mjs', '--play-only', '--runners'], {wait: /app runners/, env: {...renv, RELAY_PORT: String(rport + 1)}});
  ok(await relay.ready && /app runners ON/.test(relay.out()), 'with --runners it says so');
  const RB2 = `http://127.0.0.1:${rport + 1}`;
  g = await req(RB2, '/play/runner', {origin: PAGE});
  const s = await req(RB2, '/play/runner/start', {method: 'POST', origin: PAGE, body: {hero: 1}});
  ok(g.enabled === true && s.status === 404, 'runners on; a hero no page has made agent-played is refused');
  const bad = await req(RB2, '/play/runner/start', {method: 'POST', origin: 'http://localhost:5174', body: {hero: 1}});
  ok(bad.status === 403, 'another page origin is refused');
  relay.p.kill();
}

// ---------------------------------------------------------------- 5. relay concurrency (mock 429 provider)
console.log('relay concurrency: queue, deadlines, 429 (mock provider)');
{
  const {makeLimiter, rateLimitOf} = await import('./providers/limiter.mjs');
  const lim = makeLimiter({max: 2}), order = [], gates = [];
  const job = name => () => new Promise(r => {order.push(name); gates.push(r)});
  const w1 = lim.run(job('w1')), w2 = lim.run(job('w2')), w3 = lim.run(job('w3'));
  const d1 = lim.run(job('d1'), {urgent: true}), ac = new AbortController(), d2 = lim.run(job('d2'), {urgent: true, signal: ac.signal});
  await sleep(10);
  ok(lim.stats().inflight === 2 && lim.stats().queued === 3, 'two in flight, three queued');
  ac.abort(); let dropped = null; await d2.catch(e => dropped = e);
  ok(dropped && dropped.name === 'AbortError' && dropped.queued && lim.stats().dropped === 1, 'a queued decision whose deadline passes is dropped, never sent');
  gates.shift()(); await sleep(10);
  ok(order.join() === 'w1,w2,d1', 'a decision goes ahead of a queued writing call');
  while (gates.length) {gates.shift()(); await sleep(10)}
  await Promise.all([w1, w2, w3, d1]);
  ok(order.join() === 'w1,w2,d1,w3', 'then the writing call');
  ok(rateLimitOf({status: 429, headers: {get: k => k === 'retry-after' ? '2' : null}}).retryAfterMs === 2000 && rateLimitOf({status: 500}) === null, 'a 429 and its retry-after are read from the SDK error');

  const {createRelay, makeLimits} = await import('./relay.mjs');
  let live = 0, peak = 0, calls = 0, mode = 'ok', fail429 = 0;
  const reply = req => {const sch = req.output_config.format.schema, o = {};
    for (const k in sch.properties) {const pr = sch.properties[k]; o[k] = pr.enum ? pr.enum[0] : pr.type === 'boolean' ? true : pr.type === 'object' ? {} : 'Text for ' + k + '.'}
    return {stop_reason: 'end_turn', model: req.model, usage: {input_tokens: 100, output_tokens: 10}, content: [{type: 'text', text: JSON.stringify(o)}]}};
  const create = async (req, opt) => {calls++; live++; peak = Math.max(peak, live);
    try {
      await new Promise((res, rej) => {const t = setTimeout(res, 80); opt.signal && opt.signal.addEventListener('abort', () => {clearTimeout(t); rej(Object.assign(new Error('aborted'), {name: 'AbortError'}))})});
      if (fail429 > 0) {fail429--; throw Object.assign(new Error('429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of concurrent requests across all models has exceeded your organization\'s limit"}}'), {status: 429, headers: {'retry-after': '0.1'}})}
      return reply(req);
    } finally {live--}};
  const client = {messages: {create}, beta: {messages: {create}}};
  const relay = createRelay({client, timeoutMs: 2000, log: () => {}, limits: makeLimits({RELAY_ANTHROPIC_CONCURRENCY: '2'})});
  await new Promise(r => relay.server.listen(0, '127.0.0.1', r));
  const RB = `http://127.0.0.1:${relay.server.address().port}`;
  const dec = (body) => fetch(RB + '/decide', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}).then(async r => ({status: r.status, ...(await r.json())}));
  const town = n => ({kind: 'townPlan', snapshot: {fac: 'Concord', name: 'T' + n, options: ['Thornvale', 'Mirefen']}});
  const persona = n => ({kind: 'persona', snapshot: {fac: 'Concord', name: 'P' + n, companions: []}});
  let rs = await Promise.all([...[1, 2, 3, 4, 5].map(n => dec(persona(n))), ...[1, 2, 3, 4, 5, 6].map(n => dec(town(n)))]);
  ok(peak <= 2 && rs.every(r => r.status === 200), `a burst of 5 persona writes and 6 townPlans: all answered, at most 2 at once (peak ${peak})`);
  // deadlines: a short decision timeout, a long queue
  const quick = createRelay({client, timeoutMs: 400, log: () => {}, limits: makeLimits({RELAY_ANTHROPIC_CONCURRENCY: '1'})});
  await new Promise(r => quick.server.listen(0, '127.0.0.1', r));
  const QB = `http://127.0.0.1:${quick.server.address().port}`; calls = 0;
  rs = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(n => fetch(QB + '/decide', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(town(n))}).then(async r => ({status: r.status, ...(await r.json())}))));
  const late = rs.filter(r => r.status === 504 && /queued/.test(r.error)).length;
  ok(late >= 3 && calls <= 5 && rs.filter(r => r.status === 200).length >= 3, `decisions whose deadline passes in the queue are dropped (${late} dropped, ${calls} sent; the sim plays them scripted)`);
  let h = await fetch(QB + '/health').then(r => r.json());
  ok(h.queues && h.queues.anthropic && h.queues.anthropic.dropped >= 2 && h.queues.anthropic.max === 1, '/health shows the queue: ' + JSON.stringify(h.queues.anthropic));
  quick.server.close();
  // 429: writing kinds retry after retry-after, decisions do not; the queue pauses
  fail429 = 2; calls = 0;
  const p = await dec(persona(9));
  ok(p.status === 200 && p.voice && calls === 3, `a persona write rate-limited twice retries after retry-after and succeeds (${calls} calls)`);
  fail429 = 1; calls = 0;
  const t = await dec(town(9));
  ok(t.status === 429 && /rate limited/.test(t.error) && calls === 1, 'a rate-limited decision is not retried (status 429, scripted fallback)');
  h = await fetch(RB + '/health').then(r => r.json());
  ok(h.queues.anthropic.rateLimited === 3 && h.queues.anthropic.max === 2 && 'queued' in h.queues.anthropic, `/health counts 429s (${h.queues.anthropic.rateLimited}) and shows queue depth`);
  relay.server.close();
}

for (const p of procs) try {p.kill()} catch {}
mock.close();
await sleep(300);
try {rmSync(tmp, {recursive: true, force: true})} catch {}
console.log(fail ? `\nrunnercheck: ${fail} FAILED` : '\nrunnercheck: all ok');
process.exit(fail ? 1 : 0);
