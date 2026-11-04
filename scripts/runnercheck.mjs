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
import {attachRunners, checkStart, runnerArgs, MAX_RUNNERS, SEATS, HERO_SEATS, RUNNER_KINDS, HOW, NEW_WORLD_EXIT, RESTART_MS} from './runners.mjs';
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
  ok(checkStart({hero: 1, provider: 'gemini'}, hs).code === 400 && checkStart({hero: 1, provider: 'x;rm'}, hs).code === 400 && !checkStart({hero: 1, provider: 'google'}, hs).error, 'only providers with a runner (anthropic, ollama, openai, huggingface, google)');
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
  {const fs = hs.map(h => ({...h, fellow: true, alive: true})), full = Array.from({length: 4}, (_, i) => ({key: 'hero:' + (100 + i), provider: 'anthropic'}));
    ok(checkStart({hero: 3}, fs, {running: full, max: 4}).req && checkStart({kind: 'dm'}, fs, {running: full, max: 4}).req, 'a Fellowship member or the DM still fits when other runners fill the cap (five paid seats and the DM)');
    const seats = Array.from({length: HERO_SEATS.PAID}, (_, i) => ({key: 'hero:' + (200 + i), fellow: true, provider: 'anthropic'}));
    ok(checkStart({hero: 3, provider: 'anthropic'}, fs, {running: seats}).code === 429 && /Seats full: 5/.test(checkStart({hero: 3, provider: 'anthropic'}, fs, {running: seats}).error), 'a sixth paid agent hero is refused with the seat message');
    ok(checkStart({kind: 'dm'}, fs, {running: seats}).req, 'the DM seat is outside the count');
    const loc = Array.from({length: 9}, (_, i) => ({key: 'hero:' + (300 + i), provider: 'ollama'}));
    ok(checkStart({hero: 3, provider: 'ollama', model: 'qwen2.5:14b'}, fs, {running: loc}).req, 'ten local agent heroes fit');
    ok(checkStart({hero: 3, provider: 'ollama', model: 'qwen2.5:14b'}, fs, {running: [...loc, {key: 'hero:399', provider: 'ollama'}]}).code === 429, 'an eleventh local hero is refused');
    ok(checkStart({hero: 3, provider: 'anthropic'}, fs, {running: loc.slice(0, 5)}).code === 429, 'a paid mind among five local runners is a sixth paid-world seat: refused');
    ok(SEATS === HERO_SEATS.LOCAL + 1 && MAX_RUNNERS === SEATS, 'RELAY_MAX_RUNNERS default covers ten local runners plus the DM')}
  ok(!args.some(a => /key|sk-ant/i.test(a)), 'no key on the command line');
  ok(runnerArgs({...f.req, claudeConcurrency: 2}, 'u').join(' ').endsWith('--budget 2 --claude-concurrency 2'), 'a Fellowship runner gets its share of Claude slots (--claude-concurrency)');
}

// ---------------------------------------------------------------- 2. routes, fake children
console.log('runner routes (fake children)');
{
  const tmp = mkdtempSync(join(tmpdir(), 'eldmoor-runnercheck-'));
  const heroes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(id => ({id, name: 'H' + id, alive: true}));
  let dmSeat = true; // the game's DM seat (#66): a DM runner starts only while it is open
  const be = {call: async () => ({ok: true}), dmCall: async t => t === 'table_call' ? {ok: true, call: {id: 1, kind: 'frame', seconds_left: 8}} : {ok: true}, narrate() {}, info: () => ({connected: true, heroes, dm: dmSeat})}; // a frame call waits for the DM's voice (#682)
  const kids = [];
  const fakeSpawn = (cmd, args, opts) => {const k = new EventEmitter(); k.pid = 40000 + kids.length; k.cmd = cmd; k.args = args; k.opts = opts; k.got = '';
    k.stdout = new EventEmitter(); k.stderr = new EventEmitter(); k.stdin = Object.assign(new EventEmitter(), {write: d => {k.got += d; if (exitOnStop && /stop/.test(d)) setTimeout(() => k.emit('exit', 0), 5)}});
    k.kill = () => {k.killed = true; setTimeout(() => k.emit('exit', null), 5)}; kids.push(k); return k};
  let exitOnStop = false; // a runner that releases its heroes and leaves on the stop line (the real ones do)
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
  ok(g.enabled === true && g.max === MAX_RUNNERS && g.kinds.hero.defaults.maxTurns === null && g.kinds.hero.defaults.budget === 1 && g.providers.includes('ollama'), 'with --runners: enabled, with the kinds, caps and providers');
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
  // up to MAX_RUNNERS: ten local agent heroes fit (the DM is outside the count), the eleventh is refused
  {const lo = {provider: 'ollama', model: 'qwen2.5:14b'};
    for (const id of [2, 3, 4, 5, 6, 7, 8, 9, 10]) await req(on.base, '/play/runner/start', {method: 'POST', body: {hero: id, ...lo}, origin: PAGE});}
  s = await req(on.base, '/play/runner/start', {method: 'POST', body: {hero: 11, provider: 'ollama', model: 'qwen2.5:14b'}, origin: PAGE});
  ok(s.status === 429 && /Seats full: 10/.test(JSON.stringify(s.body || s)), 'ten local agent heroes at most, the eleventh is refused');
  // issue #787: the context size from the turn lines, the rolls, and the page's fresh session
  {k1.stdout.emit('data', Buffer.from('tokens this turn | ctx 212k | turn\n  [session rolled: 212k tokens]\ntokens this turn | ctx 31k | turn\n')); await sleep(10);
    const v = (await req(on.base, '/play/runner', {origin: PAGE})).runners.find(r => r.key === 'hero:1');
    ok(v && v.ctx === 31 && v.rolls === 1, `the runner view carries the last context size and the rolls: ctx ${v && v.ctx}k, ${v && v.rolls} roll`);
    let f = await req(on.base, '/play/runner/fresh', {method: 'POST', body: {key: 'hero:1'}, origin: PAGE});
    ok(f.status === 200 && f.asked.length === 1 && /fresh\n$/.test(k1.got), 'fresh session: a "fresh" line on the runner\'s stdin');
    f = await req(on.base, '/play/runner/fresh', {method: 'POST', body: {}, origin: PAGE});
    ok(f.status === 200 && f.asked.includes('hero:1') && f.asked.length > 1, `fresh sessions for all: ${f.asked.length} runners asked`);
    f = await req(on.base, '/play/runner/fresh', {method: 'POST', body: {key: 'hero:99'}, origin: PAGE}); ok(f.status === 404, 'a runner that is not live is refused');
    f = await req(on.base, '/play/runner/fresh', {method: 'POST', body: {}, origin: 'http://evil.example'}); ok(f.status === 403, 'another origin is refused');
    const c = checkStart({hero: 1, fresh: true}, [{id: 1, name: 'Ann', alive: true}]);
    ok(c.req.fresh === true && runnerArgs(c.req, 'http://x').includes('--new') && !runnerArgs(checkStart({hero: 1}, [{id: 1, name: 'Ann', alive: true}]).req, 'http://x').includes('--new'), 'Fresh session on a start is --new, and only when asked');
    ok(!/fresh/.test(readFileSync(join(tmp, 'runners', 'active.json'), 'utf8')), 'it is never saved for a resume');
    k1.got = ''}
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
  // a runner that sees a new world exits with NEW_WORLD_EXIT: it is NOT started again (#691: a world reset stops everything, the new world's setup or resume starts what it wants)
  {const k3 = kids[2], n0 = kids.length; k3.stdout.emit('data', '[world] a new world: #3 was H3, now Zed. Releasing the heroes and exiting (code 75)\n'); k3.left75 = true; k3.emit('exit', NEW_WORLD_EXIT);
    await sleep(RESTART_MS + 600); ok(kids.length === n0, 'a runner that exits for a new world is not started again');
    v = (await req(on.base, '/play/runner')).runners.find(r => r.key === 'hero:3');
    ok(v && v.state === 'stopped' && !v.error && /new world/.test(v.stopWhy || ''), 'it reads stopped for a new world, not crashed: ' + (v && v.state));
    const old = readFileSync(join(tmp, 'runners', 'hero-3.log'), 'utf8');
    ok(/stopped \(exit 75\)/.test(old) && !/crashed/.test(old), 'a new world is a stop in the log, not a crash');
    for (let i = 0; i < 7; i++) {const a = await req(on.base, '/play/runner/start', {method: 'POST', body: {hero: 3, provider: 'ollama', model: 'qwen2.5:14b'}, origin: PAGE}); const kk = kids[kids.length - 1]; kk.stdout.emit('data', 'x\n'); kk.left75 = true; kk.emit('exit', NEW_WORLD_EXIT); await sleep(30)}
    const n1 = kids.length; await sleep(RESTART_MS + 400); ok(kids.length === n1, 'seven new-world exits in a row start nothing by themselves (no restart budget to spend)');
    // one call stops everything before the page replaces the world
    exitOnStop = true;
    const live = (await req(on.base, '/play/runner')).runners.filter(r => !['stopped', 'crashed'].includes(r.state)).map(r => r.key).sort();
    const rs = await req(on.base, '/play/runner/stop-all', {method: 'POST', body: {why: 'world reset'}, origin: PAGE});
    ok(rs.status === 200 && rs.ok && rs.stopped === live.length && live.length >= 2 && rs.keys.slice().sort().join() === live.join() && rs.left === 0, 'stop-all stops every live runner in one call and waits for them: ' + JSON.stringify({stopped: rs.stopped, live: live.length, left: rs.left}));
    const after = (await req(on.base, '/play/runner')).runners;
    ok(after.every(r => ['stopped', 'crashed'].includes(r.state)) && true, 'every runner reads stopped afterwards');
    const act = JSON.parse(readFileSync(on.sup.activeFile, 'utf8')); ok(act.runners.length === 0, 'the active list is empty, so --resume-runners brings nothing back');
    const rs2 = await req(on.base, '/play/runner/stop-all', {method: 'POST', body: {}, origin: PAGE}); ok(rs2.ok && rs2.stopped === 0, 'stop-all with nothing running says 0');
    const bad = await req(on.base, '/play/runner/stop-all', {method: 'POST', body: {}, origin: 'http://evil.example'}); ok(bad.status === 403, 'stop-all is for the page origin only');
    exitOnStop = false}
  // a runner that ignores stop is killed after the grace period (skipped: shortened via a direct kill)
  s = await req(on.base, '/play/runner/stop', {method: 'POST', body: {key: 'nope'}, origin: PAGE});
  ok(s.status === 404, 'stopping an unknown runner says so');
  on.sup.killAll(); await sleep(20);
  ok(kids.slice(2).every(k => k.killed || k.got.includes('stop') || k.left75), 'the host closing kills every child that is still running (a reset already stopped the rest)');
  on.server.close();

  // limits set in the game (issue #145): a session budget across paid runners, live per-runner caps
  console.log('limits set in the game');
  const lim = await mk(true); const lim0 = kids.length, kid = id => kids.slice(lim0).find(k => k.args.includes(String(id)));
  const L = body => req(lim.base, '/play/runner/limits', {method: 'POST', body, origin: PAGE});
  g = await req(lim.base, '/play/runner');
  ok(g.session && g.session.budget === null && g.session.spent === 0, 'GET shows the session: no budget, nothing spent');
  ok((await L({sessionBudget: 0})).status === 400 && (await L({sessionBudget: 1e6})).status === 400, 'a session budget out of range is refused');
  s = await L({sessionBudget: .05});
  ok(s.status === 200 && s.session.budget === .05, 'the session budget is set to $0.05');
  s = await req(lim.base, '/play/runner/start', {method: 'POST', body: {hero: 1}, origin: PAGE});
  ok(s.status === 200 && s.runner.budget === .05 && kid(1).args[kid(1).args.indexOf('--budget') + 1] === '0.05', 'a paid runner\'s budget is clipped to what is left of the session ($1.00 -> $0.05)');
  s = await req(lim.base, '/play/runner/start', {method: 'POST', body: {hero: 2, provider: 'ollama', model: 'qwen2.5:14b'}, origin: PAGE});
  ok(s.status === 200 && s.runner.budget == null, 'a local runner starts with no budget');
  s = await req(lim.base, '/play/runner/start', {method: 'POST', body: {hero: 3}, origin: PAGE});
  kid(1).stdout.emit('data', '[turn 1] 2 tool calls | run $0.0300 | session $0.03\n');
  g = await req(lim.base, '/play/runner');
  ok(g.session.spent === .03 && !kid(1).got, 'spend is counted live ($0.03 of $0.05), the runner plays on');
  kid(3).stdout.emit('data', '[turn 1] 1 tool call | run $0.0250 | session $0.03\n');
  ok(kid(1).got === 'stop\n' && kid(3).got === 'stop\n' && !kid(2).got, 'the session budget runs out: every paid runner is stopped, the local one plays on');
  g = await req(lim.base, '/play/runner');
  {const v = g.runners.find(r => r.key === 'hero:1');
    ok(v.stopWhy && /session budget reached/.test(v.stopWhy) && v.lines.some(l => /stopped after 1 turns \(session budget reached/.test(l)), 'the stop says why, in the line the page\'s alert reads: ' + v.stopWhy)}
  s = await req(lim.base, '/play/runner/start', {method: 'POST', body: {hero: 4}, origin: PAGE});
  ok(s.status === 402 && /Session budget reached/.test(s.error), 'a new paid start is refused while the session budget is spent');
  s = await L({sessionBudget: null});
  ok(s.status === 200 && s.session.budget === null && s.session.spent === .055, 'the session budget can be lifted; the spend so far stays ($' + s.session.spent + ')');
  s = await req(lim.base, '/play/runner/start', {method: 'POST', body: {hero: 4}, origin: PAGE});
  ok(s.status === 200 && s.runner.budget === 1, 'with no session budget a paid runner keeps its own ($1.00)');
  s = await L({key: 'hero:4', maxTurns: 2});
  ok(s.status === 200 && s.applies === 'now' && s.runner.capTurns === 2, 'lowering a running runner\'s turn cap applies now');
  kid(4).stdout.emit('data', '[turn 1] a | run $0.0100 | x\n'); ok(!kid(4).got, 'one turn: still playing');
  kid(4).stdout.emit('data', '[turn 2] b | run $0.0200 | x\n'); ok(kid(4).got === 'stop\n', 'two turns: stopped by the cap set in the game');
  s = await req(lim.base, '/play/runner/start', {method: 'POST', body: {hero: 5}, origin: PAGE});
  s = await L({key: 'hero:5', budget: 4});
  ok(s.status === 200 && s.applies === 'next start', 'raising a running runner\'s budget past its start budget applies on the next start');
  s = await L({key: 'hero:5', budget: .01});
  ok(s.status === 200 && s.applies === 'now' && kid(5).got === '' , 'a lowered budget applies now');
  kid(5).stdout.emit('data', '[turn 1] a | run $0.0100 | x\n'); ok(kid(5).got === 'stop\n', 'and stops the runner once spent');
  ok((await L({key: 'hero:2', budget: 1})).status === 400, 'a local runner has no budget to set');
  ok((await L({key: 'hero:2', maxTurns: 500})).status === 400 && (await L({key: 'nope', maxTurns: 5})).status === 404, 'turn caps over the kind\'s cap and unknown runners are refused');
  ok((await L({key: 'hero:2', maxTurns: 5})).applies === 'now', 'a local runner (until stopped) takes a turn cap live');
  lim.sup.killAll(); await sleep(20); lim.server.close();
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
  {const {DM_FIRST_MS} = await import('./runners.mjs');
    await req(sl.base, '/play/dm', {method: 'POST', body: {tool: 'table_call', args: {}, role: 'dm'}}); // the DM's voice picks up a call
    let t = Date.now(); const y = await req(sl.base, '/play/runner/slot', {method: 'POST', body: {key: 'hero:1'}}), waited = Date.now() - t;
    ok(y.ok && waited >= DM_FIRST_MS - 50, `a hero's slot request yields to the DM's pending voice call first (${waited} ms, #682)`);
    await req(sl.base, '/play/runner/slot/release', {method: 'POST', body: {key: 'hero:1', lease: y.lease}});
    await req(sl.base, '/play/dm', {method: 'POST', body: {tool: 'table_answer', args: {call: 1, text: 'x'}, role: 'dm'}}); // answered
    t = Date.now(); const z = await req(sl.base, '/play/runner/slot', {method: 'POST', body: {key: 'hero:1'}});
    ok(z.ok && Date.now() - t < 500, 'once the DM has answered, a slot is leased at once');
    await req(sl.base, '/play/runner/slot/release', {method: 'POST', body: {key: 'hero:1', lease: z.lease}})}
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

// ---------------------------------------------------------------- 2a. offline calls are bounded by a health check (#691)
console.log('offline calls: one health check, not a retry loop (#691)');
{
  let up = false, listed = [], calls = 0;
  const be = {call: async (id, tool) => {calls++; return up && listed.length ? {ok: true} : {ok: false, error: 'The world is paused or reloading', offline: true, why: 'no agent hero listed'}}, dmCall: async () => ({ok: true}), narrate() {}, info: () => ({connected: up, heroes: listed, dm: false})};
  const server = http.createServer((q, s) => {s.writeHead(404); s.end('{}')});
  const play = attachPlay(server, {backend: be, log: () => {}, offlineWaitMs: 600});
  // the page is away: one call answers offline only after the wait, so a runner cannot spin
  let t0 = Date.now(), r = await play.call(1, 'status', {});
  ok(r.offline && Date.now() - t0 >= 550 && play.stats.offlineWaits === 1 && calls === 1, 'a call with no page waits the health window, then answers offline (once): ' + (Date.now() - t0) + ' ms');
  // twenty runner retries in a row take at least the window each, never a tight loop
  t0 = Date.now(); const rs = await Promise.all([1, 2, 3].map(i => play.call(1, 'status', {}))); ok(Date.now() - t0 >= 550 && calls === 4, 'parallel callers each wait the window; none spins');
  // the page comes back while a call waits: the call is tried again and succeeds
  const p = play.call(1, 'status', {}); await sleep(250); up = true; listed = [{id: 1, name: 'H1', alive: true}];
  r = await p; ok(r.ok === true, 'a page that lists the hero during the wait gets the call answered (retried once)');
  // a listed page answers an offline reason at once (no wait)
  be.call = async () => ({ok: false, error: 'no answer in time', offline: true, why: 'no answer in time'}); const w0 = play.stats.offlineWaits; t0 = Date.now(); r = await play.call(1, 'status', {});
  ok(r.offline && Date.now() - t0 < 300 && play.stats.offlineWaits === w0, 'with the page listing its heroes an offline answer is immediate (no extra wait)');
  server.close();
}

// ---------------------------------------------------------------- 2a. a slow page (#736)
console.log('a slow page: late answers kept for the retry, held waits, page busy (#736)');
{
  const {browserBackend, HELD_WAIT} = await import('./relay-mcp.mjs');
  const page = () => {const ws = new EventEmitter(); ws.readyState = 1; ws.sent = []; ws.send = t => ws.sent.push(JSON.parse(t)); ws.close = () => {}; ws.say = o => ws.emit('message', Buffer.from(JSON.stringify(o))); return ws};
  const be = browserBackend({callMs: 150, waitMs: 250, lateMs: 400, silentMs: 1000}), ws = page(); be.attach(ws);
  ws.say({type: 'hello', heroes: [{id: 1, name: 'Ann', alive: true}]});
  const beat = setInterval(() => ws.say({type: 'beat'}), 50); // the page's thread runs: it beats
  const calls = () => ws.sent.filter(m => m.type === 'call');
  // 1. a scene_act the page answers 100 ms after the relay gave up: the runner's retry gets that answer, the page is not asked twice
  let r = await be.call(1, 'scene_act', {option: 'strike', line: 'Hold the gap.'});
  ok(r.offline && r.why === 'no answer in time', 'a slow answer still times out at the call limit for the runner (' + r.why + ')');
  const first = calls().at(-1); ws.say({type: 'result', id: first.id, result: {ok: true, chose: 'strike'}}); await sleep(20);
  r = await be.call(1, 'scene_act', {line: 'Hold the gap.', option: 'strike'}); // same args, other key order
  ok(r.ok && r.chose === 'strike' && r.late === true && calls().length === 1, 'the retry of the same tool and args gets the late answer (late: true), without a second call to the page');
  r = await be.call(1, 'scene_act', {option: 'strike', line: 'Hold the gap.'}).catch(() => null);
  ok(calls().length === 2, 'the kept answer is used once: the next call asks the page again');
  ws.say({type: 'result', id: calls().at(-1).id, result: {ok: true}});
  // 2. a retry while the page still works on the first call joins it
  const p1 = be.call(1, 'status', {}); r = await p1; ok(r.offline, 'status times out');
  const n = calls().length, p2 = be.call(1, 'status', {}); await sleep(30);
  ok(calls().length === n, 'a retry while the first call is still pending joins it (no new call to the page)');
  ws.say({type: 'result', id: calls().at(-1).id, result: {ok: true, state: 'town'}}); r = await p2;
  ok(r.ok && r.state === 'town' && r.late, 'the joined retry gets the page\'s answer when it comes');
  // 3. other arguments are another call
  const p3 = be.call(1, 'say', {text: 'a'}); await sleep(10); ws.say({type: 'result', id: calls().at(-1).id, result: {ok: true}}); await p3;
  const p4 = be.call(1, 'say', {text: 'b'}); await sleep(10); ok(calls().length === n + 2, 'a call with other arguments is a new call'); ws.say({type: 'result', id: calls().at(-1).id, result: {ok: true}}); await p4;
  // 4. a late answer is kept only lateMs
  r = await be.call(1, 'look', {}); ws.say({type: 'result', id: calls().at(-1).id, result: {ok: true, seen: 1}}); await sleep(500);
  const before = calls().length, p5 = be.call(1, 'look', {}); await sleep(10);
  ok(calls().length === before + 1, 'past lateMs the kept answer is gone and the page is asked again'); ws.say({type: 'result', id: calls().at(-1).id, result: {ok: true}}); await p5;
  // 5. a wait the live page still holds (an answered Table scene) is not offline
  r = await be.call(1, 'wait', {minutes: 10});
  ok(r.ok === true && r.held === true && !r.offline && r.why === HELD_WAIT.why, 'a wait still held by a live page answers "still waiting", not offline');
  const w0 = calls().length, p6 = be.call(1, 'wait', {minutes: 10}); await sleep(20);
  ok(calls().length === w0, 'the next wait joins the one the page still holds');
  ws.say({type: 'result', id: calls().filter(m => m.tool === 'wait').at(-1).id, result: {ok: true, waited_min: 0, why: 'the table settled'}}); r = await p6;
  ok(r.ok && r.why === 'the table settled', 'and gets the table\'s end when it comes');
  // 6. a silent page (no beat) is page busy, and is told so
  clearInterval(beat); await sleep(1050);
  r = await be.call(1, 'wait', {minutes: 5});
  ok(r.offline && r.why === 'page busy' && ws.sent.some(m => m.type === 'pagelate'), 'with no beat for silentMs the page is busy: offline "page busy", and a pagelate goes to the page');
  ok(be.page().late >= 5 && be.page().lateServed >= 2 && be.page().joined >= 2 && be.page().pageBusy === 1, 'the counts: ' + JSON.stringify(be.page()));
  ws.emit('close');
}

// ---------------------------------------------------------------- 2b. company runners (#460), fake children
console.log('company runners (fake children, #460)');
{
  const tmp = mkdtempSync(join(tmpdir(), 'eldmoor-runnercheck-co-'));
  const heroes = [{id: 1, name: 'Ann', alive: true, company: 7, companyName: '', size: 2, lead: true}, {id: 2, name: 'Bo', alive: true, company: 7, companyName: '', size: 2, lead: false}, {id: 3, name: 'Cy', alive: true, company: 8, companyName: 'Cy', size: 1}];
  const c = checkStart({kind: 'company', company: 7}, heroes), byHero = checkStart({kind: 'company', hero: 2}, heroes);
  ok(c.req && c.req.key === 'company:7' && c.req.company === 7 && c.req.budget === 2 && c.req.maxTurns === null && /Ann and Bo/.test(c.req.name), 'a company runner: key company:<id>, $2.00, no turn cap, named for its members');
  ok(byHero.req && byHero.req.key === 'company:7', 'a company runner may be asked for by one of its members');
  ok(checkStart({kind: 'company', company: 99}, heroes).code === 404 && checkStart({kind: 'company'}, heroes).code === 400, 'an unknown company, or none named, is refused');
  ok(runnerArgs({...c.req, provider: 'ollama', model: 'm'}, 'u').join(' ').startsWith('scripts/fellowship.mjs --url u --company 7'), 'it runs scripts/fellowship.mjs --company <id>');
  {const paid = [{key: 'company:7', kind: 'company', company: 7, provider: 'anthropic'}, {key: 'hero:3', kind: 'hero', hero: 3, provider: 'anthropic'}, {key: 'hero:20', kind: 'hero', hero: 20, provider: 'anthropic'}];
    const hs = [...heroes, {id: 20, name: 'Ed', alive: true, company: 20, size: 1}, {id: 21, name: 'Fi', alive: true, company: 21, size: 1}, {id: 22, name: 'Gu', alive: true, company: 22, size: 1}];
    ok(checkStart({hero: 21, provider: 'anthropic'}, hs, {running: paid}).req && checkStart({hero: 22, provider: 'anthropic'}, hs, {running: [...paid, {key: 'hero:21', kind: 'hero', provider: 'anthropic'}]}).code === 429, 'a company runner takes one seat per living member (2 + 3 paid seats: a sixth is refused)')}

  const be = {call: async () => ({ok: true}), dmCall: async () => ({ok: true}), narrate() {}, info: () => ({connected: true, heroes, dm: false})};
  const kids = [];
  const fakeSpawn = (cmd, args, opts) => {const k = new EventEmitter(); k.pid = 50000 + kids.length; k.args = args; k.got = '';
    k.stdout = new EventEmitter(); k.stderr = new EventEmitter(); k.stdin = Object.assign(new EventEmitter(), {write: d => {k.got += d}});
    k.kill = () => {setTimeout(() => k.emit('exit', null), 5)}; kids.push(k); return k};
  const server = http.createServer((q, r) => {r.writeHead(404); r.end('{}')});
  const play = attachPlay(server, {backend: be, log: () => {}});
  const sup = attachRunners(server, {play, enabled: true, log: () => {}, spawnImpl: fakeSpawn, base: () => 'http://127.0.0.1:1', logs: tmp, env: {PATH: process.env.PATH, ANTHROPIC_API_KEY: 'sk-test-not-a-key', RUNNER_CLAUDE_MAX: '10'}});
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const B = `http://127.0.0.1:${server.address().port}`;
  let s = await req(B, '/play/runner/start', {method: 'POST', body: {kind: 'company', company: 7, provider: 'ollama', model: 'mock-tools:1b'}});
  const k = kids[0];
  ok(s.status === 200 && s.runner.key === 'company:7' && k.args.includes('--company') && k.args[k.args.indexOf('--company') + 1] === '7', 'Start <company>: one company runner spawned with --company 7');
  const rid = hostname() + ':' + k.pid + ':company';
  for (const id of [1, 2]) await req(B, '/play/claim', {method: 'POST', body: {hero: id, runner: rid, provider: 'ollama', model: 'mock-tools:1b'}});
  let v = (await req(B, '/play/runner')).runners.find(r => r.key === 'company:7');
  ok(v && v.heroes.join() === '1,2' && v.state === 'waiting' && v.model === 'mock-tools:1b', `it plays both members (${v && v.heroes}, ${v && v.state})`);
  s = await req(B, '/play/runner/start', {method: 'POST', body: {hero: 1, provider: 'ollama', model: 'm'}});
  ok(s.status === 409, 'a hero runner for a member the company runner holds is refused');
  // Bo leaves the company and rides alone: the company runner lets go, the supervisor gives Bo a hero runner with its mind
  sup.adopt(); heroes[1] = {...heroes[1], company: 9, size: 1}; heroes[0] = {...heroes[0], size: 1};
  await req(B, '/play/release', {method: 'POST', body: {hero: 2, runner: rid}});
  const got = sup.adopt();
  const kb = kids.find(x => x.args.includes('--hero') && x.args[x.args.indexOf('--hero') + 1] === '2');
  ok(got.includes('hero:2') && kb && kb.args.includes('mock-tools:1b'), 'a member who left the company gets a hero runner with the company runner\'s mind');
  ok(sup.adopt().length === 0, 'once only');
  // a solo's heir: Cy's hero runner ends with Cy's death; the recruit who succeeds Cy gets a hero runner of the same mind
  s = await req(B, '/play/runner/start', {method: 'POST', body: {hero: 3, provider: 'ollama', model: 'mock-heir:1b'}});
  const kc = kids[kids.length - 1];
  heroes[2] = {...heroes[2], alive: false}; kc.emit('exit', 0); await sleep(20);
  ok(sup.adopt().length === 0, 'no heir yet: nothing started');
  heroes.push({id: 4, name: 'Di', alive: true, succeeds: 3, company: 10, companyName: 'Di', size: 1});
  const h2 = sup.adopt(), kd = kids[kids.length - 1];
  ok(h2.includes('hero:4') && kd.args.includes('mock-heir:1b'), 'a solo\'s heir gets a hero runner with the fallen hero\'s mind (the seat restarts)');
  // a stop from the page is never restarted
  s = await req(B, '/play/runner/stop', {method: 'POST', body: {kind: 'company', company: 7}});
  ok(s.status === 200 && s.runner.state === 'stopping' && k.got === 'stop\n', 'Stop <company> stops the company runner');
  server.close();
}

// ---------------------------------------------------------------- 2c. budget stops (#807), fake children
console.log('budget stops (fake children, #807)');
{
  const tmp = mkdtempSync(join(tmpdir(), 'eldmoor-runnercheck-bud-'));
  const heroes = [{id: 1, name: 'Ann', alive: true, company: 7, size: 2, lead: true}, {id: 2, name: 'Bo', alive: true, company: 7, size: 2}, {id: 3, name: 'Cy', alive: true, company: 8, size: 1}, {id: 5, name: 'Fi', alive: true, company: 12, size: 2, lead: true}, {id: 6, name: 'Gu', alive: true, company: 12, size: 2}, {id: 9, name: 'Ivo', alive: true, company: 13, size: 1}, {id: 11, name: 'Kit', alive: true, company: 14, size: 1}];
  const be = {call: async () => ({ok: true}), dmCall: async () => ({ok: true}), narrate() {}, info: () => ({connected: true, heroes, dm: true, worldId: 'w1'})};
  const kids = [];
  const fakeSpawn = (cmd, args, opts) => {const k = new EventEmitter(); k.pid = 60000 + kids.length; k.args = args; k.got = '';
    k.stdout = new EventEmitter(); k.stderr = new EventEmitter(); k.stdin = Object.assign(new EventEmitter(), {write: d => {k.got += d}});
    k.kill = () => {setTimeout(() => k.emit('exit', null), 5)}; kids.push(k); return k};
  const host = async () => {const server = http.createServer((q, r) => {r.writeHead(404); r.end('{}')}), play = attachPlay(server, {backend: be, log: () => {}}), lines = [];
    const sup = attachRunners(server, {play, enabled: true, log: l => lines.push(l), spawnImpl: fakeSpawn, base: () => 'http://127.0.0.1:1', logs: tmp, env: {PATH: process.env.PATH, ANTHROPIC_API_KEY: 'sk-test-not-a-key', RUNNER_CLAUDE_MAX: '10'}});
    await new Promise(r => server.listen(0, '127.0.0.1', r)); return {server, play, sup, lines, B: `http://127.0.0.1:${server.address().port}`}};
  const A = await host(), {B, sup} = A;
  const start = (body, origin = PAGE) => req(B, '/play/runner/start', {method: 'POST', body: {provider: 'anthropic', ...body}, origin});
  const say = (k, l) => k.stdout.emit('data', Buffer.from(l + '\n'));
  const look = async key => (await req(B, '/play/runner')).runners.find(r => r.key === key);
  const events = () => readFileSync(join(tmp, 'runners', 'events.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const active = () => JSON.parse(readFileSync(sup.activeFile, 'utf8'));
  const RN = await import('../src/ui/runners.js');

  // a hero runner ends on its own budget: stopped, marked, logged, and nothing starts it again
  let s = await start({hero: 3, by: 'owner'}); const kc = kids[0], n0 = kids.length;
  say(kc, '[turn 83] 1 tool calls | turn $0.0175 | run $1.0067 | session $2.4588 | error_max_budget_usd');
  say(kc, '[agent] stopped after 83 turns this session (budget reached); this run $1.0067, session $2.4588.');
  kc.emit('exit', 0); await sleep(10);
  let v = await look('hero:3');
  ok(v.state === 'stopped' && v.budgetSpent === true && v.endWhy === 'budget reached' && v.by === 'owner', `a hero runner that spent its budget reads stopped, marked, with why and who started it (${v.state}, ${v.endWhy}, by ${v.by})`);
  for (let i = 0; i < 3; i++) sup.adopt();
  ok(kids.length === n0 && !active().runners.length && active().spent.some(x => x.key === 'hero:3' && x.cost === 1.0067), 'a budget stop is not adopted, leaves the active list and is kept as spent');
  // the alert names the spend and the price of another start
  ok(RN.reasonOf(v, null) === 'budget spent: $1.01 of $1.00', 'the alert names the spend: ' + RN.reasonOf(v, null));
  ok(RN.costNote('fellowship') === ' · another $2.00' && RN.anotherText(RN.startCost('hero', 3)) === 'another $1.00', 'and what another start costs: ' + RN.costNote('fellowship'));
  // the stop reason is logged: the runner's log, and events.jsonl for reports
  ok(/stopped \(exit 0\) \| why budget reached, \$1\.01 of \$1\.00/.test(readFileSync(join(tmp, 'runners', 'hero-3.log'), 'utf8')) && /\| by owner/.test(readFileSync(join(tmp, 'runners', 'hero-3.log'), 'utf8')), 'the runner log says who started it and why it ended, with the spend');
  {const e = events().filter(x => x.key === 'hero:3');
    ok(e.some(x => x.event === 'start' && x.by === 'owner' && x.budget === 1) && e.some(x => x.event === 'end' && x.why === 'budget reached' && x.cost === 1.0067 && x.budget === 1 && x.exit === 0 && x.world === 'w1'), 'events.jsonl has the start with who asked and the end with why and how much')}

  // the owner's click brings it back; a spent seat's start is told apart in the log
  s = await start({hero: 3, by: 'owner'}); const kc2 = kids[kids.length - 1];
  ok(s.status === 200 && !(await look('hero:3')).budgetSpent && !active().spent, 'the owner\'s click starts it again, and it is no longer spent');
  ok(events().some(x => x.event === 'start' && x.key === 'hero:3' && x.by === 'owner' && x.afterBudget === 1.0067), 'the log shows that start came after a budget stop');
  s = await start({hero: 9, by: 'owner'}, 'http://evil.example'); ok(s.status === 403, 'another origin is still refused');
  s = await req(B, '/play/runner/start', {method: 'POST', body: {hero: 9, by: 'owner', provider: 'anthropic'}, origin: null});
  ok(s.status === 200 && s.runner.by === 'local', 'only the page may say "owner": a local tool logs as local');
  const k9 = kids[kids.length - 1]; say(k9, '[agent] stopped after 1 turns this session (5 empty or failed turns); this run $0.01.'); k9.emit('exit', 0); await sleep(10);
  v = await look('hero:9'); ok(v.endWhy === '5 empty or failed turns' && !v.budgetSpent, 'another way to end is logged as itself, not as a budget stop');
  say(kc2, '[agent] stopped from the game: releasing the hero and stopping'); await req(B, '/play/runner/stop', {method: 'POST', body: {hero: 3}}); kc2.emit('exit', 0); await sleep(10);
  ok(events().some(x => x.event === 'end' && x.key === 'hero:3' && x.by === 'owner' && /stopped by owner/.test(x.why)), 'a stop from the page is logged as the owner\'s');

  // a crash: not a budget stop, and the seats that restart themselves still do. A crash with the hero alive starts nothing, as
  // before (the supervisor has no crash restart since #691); the hero's heir does.
  s = await start({hero: 11, provider: 'ollama', model: 'mock-heir:1b', by: 'owner'}); const kk = kids[kids.length - 1];
  kk.stderr.emit('data', Buffer.from('TypeError: boom\n')); heroes[6] = {...heroes[6], alive: false}; kk.emit('exit', 1); await sleep(10);
  v = await look('hero:11'); ok(v.state === 'crashed' && v.endWhy === 'crash' && !v.budgetSpent && events().some(x => x.event === 'end' && x.key === 'hero:11' && x.why === 'crash' && x.exit === 1), 'a crash is logged as a crash, not a budget stop');
  heroes.push({id: 12, name: 'Lem', alive: true, succeeds: 11, company: 15, size: 1});
  let got = sup.adopt(), kl = kids[kids.length - 1];
  ok(got.includes('hero:12') && kl.args.includes('mock-heir:1b'), 'a crash still restarts its seat: the heir of a crashed runner\'s fallen hero gets a runner');
  ok(events().some(x => x.event === 'start' && x.key === 'hero:12' && x.by === 'adopt'), 'and the log says adopt started it, not the owner');

  // a heir still gets a seat when the runner ended for any other reason (above, and #460's check); not when it was out of money
  s = await start({hero: 9, by: 'owner'}); const k92 = kids[kids.length - 1], n1 = kids.length;
  say(k92, '[turn 9] x | run $1.0100 | session $1.01'); say(k92, '[agent] stopped after 9 turns this session (budget reached); this run $1.01.');
  heroes[5] = {...heroes[5], alive: false}; k92.emit('exit', 0); await sleep(10);
  heroes.push({id: 10, name: 'Jo', alive: true, succeeds: 9, company: 16, size: 1});
  ok(!sup.adopt().length && kids.length === n1 && A.lines.some(l => /Jo: no hero runner: Ivo spent its budget/.test(l)) && events().some(x => x.event === 'no-restart' && x.by === 'adopt' && x.hero === 10), 'a heir of a runner that ended on its budget gets none; the refusal is logged');

  // a company runner on budget: the first member let go marks it at once; none of its members gets a hero runner, even one who leaves
  s = await start({kind: 'company', company: 7, by: 'owner'}); const ko = kids[kids.length - 1], rid = hostname() + ':' + ko.pid + ':company', n2 = kids.length;
  for (const id of [1, 2]) await req(B, '/play/claim', {method: 'POST', body: {hero: id, runner: rid, provider: 'anthropic', model: 'claude-haiku-5-5'}, origin: null});
  await look('company:7'); sup.adopt();
  say(ko, '[08:07:47] [Bo] [turn 9] x | turn $0.20 | member $0.60 | run $2.2545 of $2.0000'); say(ko, '[08:07:48] [Bo] done (budget reached): 6 turns, 1 at the table, $0.3716');
  await req(B, '/play/release', {method: 'POST', body: {hero: 2, runner: rid}, origin: null});
  v = await look('company:7');
  ok(v.state !== 'stopped' && v.budgetSpent === true && !active().runners.some(x => x.key === 'company:7' || x.kind === 'company') && active().spent.some(x => x.key === 'company:7'), `a company runner is out of budget from its first member's "done" while another plays on (${v.state}), and is off the active list`);
  heroes[1] = {...heroes[1], company: 9, size: 1}; heroes[0] = {...heroes[0], size: 1};
  ok(!sup.adopt().length && kids.length === n2 && A.lines.some(l => /Bo: no hero runner:/.test(l)), 'a member who leaves that company gets no hero runner');
  say(ko, '[08:07:50] [Ann] done (budget reached): 8 turns, 2 at the table, $0.51'); await req(B, '/play/release', {method: 'POST', body: {hero: 1, runner: rid}, origin: null}); ko.emit('exit', 0); await sleep(10);
  ok(!sup.adopt().length && kids.length === n2, 'and when it ends none of its members gets one');
  v = await look('company:7'); ok(v.state === 'stopped' && v.endWhy === 'budget reached' && Math.abs(v.cost - 2.2545) < 1e-9, 'it ends as a budget stop with the spend: $' + v.cost);

  // a member leaving a company on a live budget keeps its seat
  s = await start({kind: 'company', company: 12, by: 'owner'}); const kf = kids[kids.length - 1], rf = hostname() + ':' + kf.pid + ':company';
  for (const id of [5, 6]) await req(B, '/play/claim', {method: 'POST', body: {hero: id, runner: rf, provider: 'anthropic', model: 'claude-haiku-5-5'}, origin: null});
  await look('company:12'); say(kf, '[turn 1] x | run $0.2000 of $2.0000'); heroes[4] = {...heroes[4], company: 17, size: 1};
  await req(B, '/play/release', {method: 'POST', body: {hero: 6, runner: rf}, origin: null});
  got = sup.adopt(); ok(got.includes('hero:6'), 'a member who leaves a company on a live budget still gets a hero runner');

  // the DM: a budget stop survives a relay restart; resume starts neither it nor anything spent, and the page still sees why
  s = await start({kind: 'dm', by: 'owner'}); const kd = kids[kids.length - 1];
  say(kd, '[turn 3] x | turn $0.05 | run $1.0100 | session $1.01'); say(kd, '[dm] stopped after 3 turns this session (budget reached); this run $1.01, session $1.01.'); kd.emit('exit', 0); await sleep(10);
  ok(active().spent.some(x => x.key === 'dm' && x.cost === 1.01), 'a DM on budget is kept as spent');
  await sup.shutdown(300); A.server.close(); const n3 = kids.length;
  const C = await host(), r = await C.sup.resume({waitMs: 2000, pollMs: 20, settleMs: 10, heroWaitMs: 50});
  ok(!r.resumed.includes('dm') && !r.resumed.includes('company:7') && !r.resumed.includes('hero:9') && kids.slice(n3).every(k => !/dm-agent|--company 7/.test(k.args.join(' '))), 'resume brings back no runner that spent its budget, the open DM seat included: ' + JSON.stringify(r.resumed));
  ok(r.skipped.some(x => x.what === 'dm' && /budget/.test(x.why)) && C.lines.some(l => /DM agent spent its budget \(\$1\.01\): not started/.test(l)), 'and says so');
  v = (await req(C.B, '/play/runner')).runners.find(x => x.key === 'dm');
  ok(v && v.state === 'stopped' && v.budgetSpent && v.cost === 1.01 && v.budget === 1 && RN.reasonOf(v, null) === 'budget spent: $1.01 of $1.00', 'after the restart the page still reads the budget stop: ' + (v && RN.reasonOf(v, null)));
  s = await req(C.B, '/play/runner/start', {method: 'POST', body: {kind: 'dm', provider: 'anthropic', by: 'owner'}, origin: PAGE});
  ok(s.status === 200 && s.runner.by === 'owner', 'the owner can still start it');
  // a world reset forgets them: a new world's DM is not held back by the old world's spend
  await req(C.B, '/play/runner/stop-all', {method: 'POST', body: {}, origin: PAGE}).then(() => {});
  ok(!JSON.parse(readFileSync(C.sup.activeFile, 'utf8')).spent, 'a world reset clears the spent list');
  // the DM's chosen mind (#824): --resume-runners starts it on the same provider and model, any provider
  s = await req(C.B, '/play/runner/start', {method: 'POST', body: {kind: 'dm', provider: 'huggingface', model: 'meta-llama/Llama-3.3-70B-Instruct', budget: 2, by: 'setup'}, origin: PAGE});
  ok(s.status === 200, 'a DM on a Hugging Face model starts' + (s.status === 200 ? '' : ': ' + s.error));
  await C.sup.shutdown(300); C.server.close(); const n4 = kids.length, D = await host(), r4 = await D.sup.resume({waitMs: 2000, pollMs: 20, settleMs: 10, heroWaitMs: 50});
  const a4 = (kids.slice(n4).find(k => /dm-agent/.test(k.args.join(' '))) || {args: []}).args.join(' ');
  ok(r4.resumed.includes('dm') && /--provider huggingface/.test(a4) && /--model meta-llama\/Llama-3\.3-70B-Instruct/.test(a4) && /--budget 2/.test(a4), 'resume starts it with the provider, model and budget chosen: ' + a4);
  D.sup.killAll(); await sleep(20); D.server.close();
}

// ---------------------------------------------------------------- 3. end to end
const tmp = mkdtempSync(join(tmpdir(), 'eldmoor-runnercheck-'));
const mock = await startMockOllama();
const childEnv = {...process.env, AGENT_LOGS: tmp, ANTHROPIC_API_KEY: '', OLLAMA_URL: mock.url, RELAY_RUNNERS: '', AGENT_MIN_GAP: '0', AGENT_HEARTBEAT: '30', AGENT_REFLECT: '0'}; // pacing (issue #126) kept short
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
  const world = start(['scripts/play-headless.mjs', '--port', String(port), '--agents', '2', '--quiet', '--speed', '8', '--runners', '--world', join(tmp, 'world.json')], {wait: /^\[play\] headless world at /m});
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
  const fw = start(['scripts/play-headless.mjs', '--fellowship', '--no-relay', '--port', String(fport), '--quiet', '--speed', '8', '--runners', '--world', join(tmp, 'fworld.json')], {wait: /^\[play\] headless world at /m});
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
  // the same five as a company runner (#460): kind company, the company named by one of its members
  const h0 = (await req(FB, '/play/health')).heroes, m0 = h0.find(h => h.fellow);
  ok(m0 && Number.isInteger(m0.company) && h0.filter(h => h.company === m0.company).length === 5, '/play/health names each member\'s company');
  s = await req(FB, '/play/runner/start', {method: 'POST', origin: PAGE, body: {kind: 'company', hero: m0 && m0.id, provider: 'ollama', model: 'mock-tools:1b'}});
  ok(s.status === 200 && s.runner.key === 'company:' + (m0 && m0.company), 'a company runner for the Fellowship\'s company starts');
  const cr = await until(async () => {const x = (await req(FB, '/play/runner')).runners.find(y => y.key === 'company:' + m0.company); return x && x.heroes.length === 5 && x.turns >= 5 ? x : null}, 90000);
  ok(cr && (await req(FB, '/play/health')).heroes.filter(h => h.claimed).length === 5, `the company runner plays all five (${cr && cr.turns} turns so far)`);
  await req(FB, '/play/runner/stop', {method: 'POST', origin: PAGE, body: {kind: 'company', company: m0 && m0.company}});
  ok(await until(async () => {const x = (await req(FB, '/play/runner')).runners.find(y => y.key === 'company:' + m0.company); return x && x.state === 'stopped'}, 20000), 'the company runner stops');
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

// issue #221: the relay's minds (makeProviders -> call(), which the DM's table and talk voices also use) and the app's runners ask Ollama one num_ctx
console.log('one num_ctx for every local call (issue #221)');
{
  const {makeProviders} = await import('./providers/index.mjs'), {numCtxFrom} = await import('./providers/ollama.mjs');
  const pv = makeProviders({env: {OLLAMA_URL: mock.url}});
  await pv.ollama.call({system: 's', user: 'u', schema: {type: 'object', properties: {option: {type: 'string', enum: ['a']}, line: {type: 'string'}}}, maxTokens: 50, model: 'mock-intro:1b'});
  const st = await pv.ollama.status(), sizes = [...new Set(mock.seen.map(b => b.options && b.options.num_ctx))];
  ok(mock.seen.length > 3 && sizes.length === 1 && sizes[0] === numCtxFrom(), `every mock Ollama request (app runners and the relay's call()) carries the same num_ctx: ${sizes.join(', ')} over ${mock.seen.length}`);
  ok(st.numCtx === numCtxFrom() && makeProviders({env: {OLLAMA_URL: mock.url, OLLAMA_NUM_CTX: '8192'}}).ollama.numCtx === 8192, '/health shows the context in use, read from OLLAMA_NUM_CTX');
}

for (const p of procs) try {p.kill()} catch {}
mock.close();
await sleep(300);
try {rmSync(tmp, {recursive: true, force: true})} catch {}
console.log(fail ? `\nrunnercheck: ${fail} FAILED` : '\nrunnercheck: all ok');
process.exit(fail ? 1 : 0);
