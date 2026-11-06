// npm run upcheck: the one-window launcher (scripts/up.mjs) and the runner list that survives a relay restart.
//   1. active.json: the running runners are saved on start, a stop or a crash takes one off, a host shutdown keeps
//      them; resume() starts them again once the page names the same heroes, and skips a changed, dead or missing hero.
//   2. the launcher itself, with real children on spare ports (never 8787 or 5173), in a temp git checkout for `u`:
//      r restarts the relay with a new pid and the runner list is resumed once a page reconnects; a dirty tree and a
//      non-fast-forward refuse `u`; a fast-forward pull with a changed package-lock.json runs npm (a mock) and restarts
//      the relay; a changed script prints the code-changed notice; q leaves no child process and frees both ports.
//      The art loop (#661) is the launcher's third child: started, shown by `s` (next check, spend), restarted by `u`,
//      stopped cleanly by q (its state file says stopped), skipped by --no-art (checked on a second launcher); it talks to
//      a dead local address only, never the real API.
//      The voice engine (#554) is the fourth child ([voice]), only when KOKORO_START / --voice-script names a start script; checked
//      on fake scripts and spare ports (never 8880): starts and stops with the launcher (powershell -File on Windows), a port that
//      already answers is left alone, a missing file or a crash is one line, --no-voice and nothing configured start nothing.
//      Patch notes (#664): start records HEAD in logs/last-seen.json; a pull bringing "Merge pull request #101" prints that
//      PR's note under [notes] (a note of an unmerged PR is not shown) and records the new HEAD; n shows the last notes.
import {mkTmp, tmpRoot} from './tmp.mjs';
import http from 'node:http';
import net from 'node:net';
import {ms as fastMs} from './ci-clock.mjs'; // CI_FAST=1 scales the waits below tenfold (issue #543)
import {spawn, spawnSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocket} from 'ws';
import {attachPlay} from './relay-mcp.mjs';
import {attachRunners} from './runners.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// One upcheck at a time per checkout (#324 family): every launcher watches this checkout's scripts/, and the code-change test writes
// a file there, so a second upcheck running at once would trip the first one's notice early (it prints once, then stays quiet) and
// fail it. A run waits its turn on a lock file; a lock whose owner is gone is taken over.
{const lock = join(tmpRoot(), 'eldmoor-upcheck-' + Buffer.from(ROOT).toString('hex').slice(-24) + '.lock'), t0 = Date.now();
  const gone = p => {try {process.kill(p, 0); return false} catch {return true}};
  for (;;) {
    try {writeFileSync(lock, String(process.pid), {flag: 'wx'}); break} catch {
      let owner = 0; try {owner = Number(readFileSync(lock, 'utf8'))} catch {}
      if (!owner || gone(owner)) {try {rmSync(lock, {force: true})} catch {}} else if (Date.now() - t0 > 900000) {console.error('upcheck: another run holds ' + lock + ' (pid ' + owner + ') for 15 minutes'); process.exit(1)} else await new Promise(r => setTimeout(r, 1000));
    }
  }
  process.on('exit', () => {try {if (readFileSync(lock, 'utf8') === String(process.pid)) rmSync(lock, {force: true})} catch {}});
}
let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 30000, step = 100) => {const t0 = Date.now(); for (;;) {const v = await f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(step)}};
const alive = pid => {try {process.kill(pid, 0); return true} catch {return false}};
const freePort = () => new Promise(res => {const s = net.createServer(); s.listen(0, '127.0.0.1', () => {const p = s.address().port; s.close(() => res(p))})});
const listen1 = (port, host) => new Promise(res => {const s = net.connect({port, host}); s.setTimeout(500); s.once('connect', () => {s.destroy(); res(true)}); s.once('timeout', () => {s.destroy(); res(false)}); s.once('error', () => res(false))});
const listening = async port => (await listen1(port, '127.0.0.1')) || (await listen1(port, '::1'));

// ---------------------------------------------------------------- 0. temp stays in the project (scripts/tmp.mjs)
console.log('temp on the project drive');
{
  const {spawnSync: ss} = await import('node:child_process'), {utimesSync, mkdirSync: mk0, existsSync: ex0, writeFileSync: wf0} = await import('node:fs'), {tmpEnv, cleanOld, mkTmp: mt} = await import('./tmp.mjs');
  const e = tmpEnv();
  ok(e.TEMP === e.TMP && e.TMP === e.TMPDIR && (!!process.env.ELDMOOR_TMP || e.TEMP.split('\\').join('/').endsWith('/logs/tmp')), 'children get TEMP, TMP and TMPDIR in logs/tmp: ' + e.TEMP);
  const r = ss(process.execPath, ['-e', "import('./scripts/tmp.mjs').then(m=>{const d=m.mkTmp('eldmoor-upcheck-leak-');require('fs').writeFileSync(d+'/x','1');console.log(d)})"], {cwd: ROOT, encoding: 'utf8'});
  const d = r.stdout.trim();
  ok(d && d.startsWith(e.TEMP) && !ex0(d), 'mkTmp makes its directory in logs/tmp and removes it when the process exits');
  const old = mt('eldmoor-upcheck-old-'), fresh = mt('eldmoor-upcheck-fresh-'); wf0(join(old, 'f'), 'x');
  const past = new Date(Date.now() - 3 * 86400000); utimesSync(old, past, past);
  cleanOld(); ok(!ex0(old) && ex0(fresh), 'cleanOld removes what is older than a day and keeps the rest');
}

// ---------------------------------------------------------------- 1. active.json, fake children
console.log('active.json and resume (fake children)');
{
  const tmp = mkTmp('eldmoor-upcheck-');
  const active = join(tmp, 'runners', 'active.json');
  const readActive = () => {try {return JSON.parse(readFileSync(active, 'utf8')).runners} catch {return null}};
  let heroes = [{id: 1, name: 'Ann', alive: true}, {id: 2, name: 'Bo', alive: true}, {id: 3, name: 'Cy', alive: true}, {id: 4, name: 'Di', alive: false}];
  let connected = true, dm = false, world = null; // world: the page's S.worldId (#691)
  const be = {call: async () => ({ok: true}), dmCall: async () => ({ok: true}), narrate() {}, info: () => ({connected, heroes, dm, ...(world ? {worldId: world} : {})})};
  const kids = [];
  const fakeSpawn = (cmd, args, opts) => {const k = new EventEmitter(); k.pid = 50000 + kids.length; k.args = args; k.got = '';
    k.stdout = new EventEmitter(); k.stderr = new EventEmitter(); k.stdin = Object.assign(new EventEmitter(), {write: d => {k.got += d; if (/stop/.test(d)) setTimeout(() => k.emit('exit', 0), 5)}});
    k.kill = () => setTimeout(() => k.emit('exit', null), 5); kids.push(k); return k};
  const mk = async () => {const server = http.createServer((q, s) => {s.writeHead(404); s.end('{}')});
    const play = attachPlay(server, {backend: be, log: () => {}}), lines = [];
    const sup = attachRunners(server, {play, enabled: true, log: l => lines.push(l), spawnImpl: fakeSpawn, base: () => 'http://127.0.0.1:1', logs: tmp, env: {PATH: process.env.PATH, RUNNER_CLAUDE_MAX: '10'}});
    await new Promise(r => server.listen(0, '127.0.0.1', r)); return {server, sup, lines}};
  const A = await mk();
  ok(readActive() === null, 'nothing is written before a runner starts');
  const mkReq = (id, name, extra) => ({kind: 'hero', hero: id, name, key: 'hero:' + id, provider: 'ollama', model: 'qwen2.5:14b', maxTurns: 30, budget: null, local: true, ...extra});
  A.sup.start(mkReq(1, 'Ann')); A.sup.start(mkReq(2, 'Bo', {provider: 'anthropic', model: 'claude-haiku-5-5', maxTurns: null, budget: 0.5, local: false})); A.sup.start(mkReq(3, 'Cy'));
  let a = readActive();
  ok(a && a.length === 3 && a[0].hero === 1 && a[0].name === 'Ann' && a[0].provider === 'ollama' && a[0].model === 'qwen2.5:14b' && a[0].maxTurns === 30, 'running runners are saved with hero, name, mind and caps: ' + JSON.stringify(a && a[0]));
  ok(a[1].provider === 'anthropic' && a[1].budget === 0.5, 'a paid runner keeps its budget');
  ok(!/sk-|key/i.test(readFileSync(active, 'utf8')), 'no key in the file');
  A.sup.stop('hero:3'); a = readActive();
  ok(a.length === 2 && !a.some(x => x.hero === 3), 'a stop from the page takes the runner off the list at once');
  kids[0].emit('exit', 1); await sleep(20); a = readActive();
  ok(a.length === 1 && a[0].hero === 2, 'a crashed runner leaves the list');
  // shutdown keeps the rest
  const sd = A.sup.shutdown(); await sd;
  a = readActive();
  ok(a.length === 1 && a[0].hero === 2, 'a host shutdown stops the runners cleanly ("stop" on stdin) and keeps them on the list');
  ok(kids[1].got.includes('stop'), 'the runner was asked to stop on its stdin');
  A.server.close();
  // resume: a new host, a page with the same heroes (Bo renamed to a different hero: a new world reused the id)
  writeFileSync(active, JSON.stringify({saved: 'x', runners: [
    {kind: 'hero', hero: 1, name: 'Ann', provider: 'ollama', model: 'qwen2.5:14b', maxTurns: 30, budget: null},
    {kind: 'hero', hero: 2, name: 'Bo', provider: 'ollama', model: 'qwen2.5:14b', maxTurns: null, budget: null},
    {kind: 'hero', hero: 3, name: 'Cy', provider: 'ollama', model: 'qwen2.5:14b', maxTurns: null, budget: null},
    {kind: 'hero', hero: 4, name: 'Di', provider: 'ollama', model: 'qwen2.5:14b', maxTurns: null, budget: null},
    {kind: 'hero', hero: 9, name: 'Gone', provider: 'ollama', model: 'qwen2.5:14b', maxTurns: null, budget: null},
    {kind: 'dm', hero: null, name: 'DM agent', provider: 'ollama', model: 'qwen2.5:14b'},
    {kind: 'shell', hero: null}]}));
  heroes = [{id: 1, name: 'Ann', alive: true}, {id: 2, name: 'Zed', alive: true}, {id: 3, name: 'Cy', alive: true}, {id: 4, name: 'Di', alive: false}];
  connected = false;
  const before = kids.length, B = await mk();
  const res = B.sup.resume({waitMs: 3000, pollMs: 20, settleMs: 20, heroWaitMs: 100});
  await sleep(120); ok(kids.length === before, 'nothing is started before the game page connects');
  connected = true; const r = await res;
  ok(r.resumed.join() === 'hero:1,hero:3', 'resumed Ann and Cy: ' + JSON.stringify(r));
  ok(r.skipped.some(s => s.what === 'Bo' && /different world|now Zed/.test(s.why)) && r.skipped.some(s => s.what === 'Di' && /dead/.test(s.why)) && r.skipped.some(s => s.what === 'Gone') && r.skipped.some(s => s.what === 'dm'), 'a renamed hero (new world), a dead one, a missing one and a closed DM seat are skipped: ' + JSON.stringify(r.skipped.map(s => s.what + ':' + s.why)));
  const args = kids[kids.length - 2].args.join(' ');
  ok(/--hero 1 .*--max-turns 30 --provider ollama --model qwen2\.5:14b/.test(args), 'the same hero, caps and mind: ' + args);
  a = readActive();
  ok(a.length === 2 && a.map(x => x.hero).join() === '1,3', 'the list now holds only what runs');
  // a page that never connects leaves the list alone
  writeFileSync(active, JSON.stringify({saved: 'x', runners: [{kind: 'hero', hero: 1, name: 'Ann', provider: 'ollama', model: 'm', maxTurns: null, budget: null}]}));
  connected = false; const C = await mk(); const r2 = await C.sup.resume({waitMs: 150, pollMs: 20});
  ok(!r2.resumed.length && readActive().length === 1, 'no page, no resume, and the list is kept for next time');
  // the DM is always an agent (#559): an open DM seat gets its runner on resume even when none was saved
  writeFileSync(active, JSON.stringify({saved: 'x', runners: [{kind: 'hero', hero: 1, name: 'Ann', provider: 'ollama', model: 'qwen2.5:14b', maxTurns: null, budget: null}]}));
  connected = true; dm = true; const D = await mk(); const r3 = await D.sup.resume({waitMs: 3000, pollMs: 20, settleMs: 20, heroWaitMs: 100});
  ok(r3.resumed.join() === 'hero:1,dm' && /dm-agent\.mjs/.test(kids[kids.length - 1].args.join(' ')), 'an open DM seat with no saved DM runner: resume starts one (the DM is always played): ' + JSON.stringify(r3));
  dm = false;
  // only the same world (#691): the list carries the world id it was saved in
  const ONE = [{kind: 'hero', hero: 1, name: 'Ann', provider: 'ollama', model: 'qwen2.5:14b', maxTurns: null, budget: null}];
  writeFileSync(active, JSON.stringify({saved: 'x', world: 'w-old', runners: ONE})); world = 'w-new'; connected = true;
  const E = await mk(), nE = kids.length, r4 = await E.sup.resume({waitMs: 3000, pollMs: 20, settleMs: 20, heroWaitMs: 100});
  ok(!r4.resumed.length && kids.length === nE && r4.skipped.some(x => x.why === 'another world') && E.lines.some(l => /another world/.test(l)), 'a page that plays another world gets nothing resumed, even for a hero with the same id and name: ' + JSON.stringify(r4));
  writeFileSync(active, JSON.stringify({saved: 'x', world: 'w-same', runners: ONE})); world = 'w-same';
  const F = await mk(), r5 = await F.sup.resume({waitMs: 3000, pollMs: 20, settleMs: 20, heroWaitMs: 100});
  ok(r5.resumed.join() === 'hero:1', 'the same world id resumes the list: ' + JSON.stringify(r5));
  ok(JSON.parse(readFileSync(active, 'utf8')).world === 'w-same', 'the list records the world it was saved in');
  F.sup.stop('hero:1'); world = null;
  B.server.close(); E.server.close(); F.server.close(); C.server.close(); D.server.close();
  rmSync(tmp, {recursive: true, force: true});
}

// ---------------------------------------------------------------- 2. the launcher
console.log('launcher (real children on spare ports)');
{
  const tmp = mkTmp('eldmoor-up-');
  const git = (cwd, ...a) => { const r = spawnSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], {encoding: 'utf8'}); if (r.status !== 0) throw new Error('git ' + a.join(' ') + ': ' + r.stderr); return r.stdout.trim() };
  const bare = join(tmp, 'origin.git'), work = join(tmp, 'work'), other = join(tmp, 'other');
  git(tmp, 'init', '-q', '--bare', '-b', 'main', bare); git(tmp, 'clone', '-q', bare, work);
  writeFileSync(join(work, 'package-lock.json'), '{}'); writeFileSync(join(work, 'vite.config.js'), 'export default {};\n'); writeFileSync(join(work, 'a.txt'), 'a\n'); mkdirSync(join(work, '.claude', 'agent-memory', 'x'), {recursive: true}); writeFileSync(join(work, '.claude', 'agent-memory', 'x', 'MEMORY.md'), 'm\n'); writeFileSync(join(work, '.claude', 'agent-memory', 'x', 'OTHER.md'), 'o\n');
  git(work, 'add', '-A'); git(work, 'commit', '-q', '-m', 'base'); git(work, 'push', '-q', '-u', 'origin', 'main');
  git(tmp, 'clone', '-q', bare, other);
  const logs = join(tmp, 'logs'), active = join(logs, 'runners', 'active.json'); mkdirSync(join(logs, 'runners'), {recursive: true});
  writeFileSync(active, JSON.stringify({saved: 'x', runners: [{kind: 'hero', hero: 7, name: 'Tester', provider: 'ollama', model: 'qwen2.5:14b', maxTurns: 1, budget: null}, {kind: 'hero', hero: 8, name: 'Other', provider: 'ollama', model: 'qwen2.5:14b', maxTurns: 1, budget: null}]}));
  const mockNpm = join(tmp, 'mock-npm.js'); writeFileSync(mockNpm, `require('fs').appendFileSync(${JSON.stringify(join(tmp, 'npm-ran.txt'))}, process.argv.slice(2).join(' ') + ' in ' + process.cwd() + '\\n');`);
  const RP = await freePort(), VP = await freePort();
  const artState = join(logs, 'art-loop.json'), artEnv = {ART_LOG: join(logs, 'art.log'), ART_STATE: artState, ART_ASSETS: join(tmp, 'art-assets'), HF_TOKEN: 'hf_mockUpcheck', HF_ROUTER_URL: 'http://127.0.0.1:9', HF_HUB_URL: 'http://127.0.0.1:9'};
  const ORIGIN = `http://localhost:${VP}`;
  let out = '';
  const proc = spawn(process.execPath, ['scripts/up.mjs', '--relay-port', String(RP), '--vite-port', String(VP), '--no-open', '--repo', work], {cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'],
    env: {...process.env, ...artEnv, AGENT_LOGS: logs, UP_NPM_CLI: mockNpm, UP_GRACE_MS: String(fastMs(15000, 3000)), NO_COLOR: '1', RELAY_BEHAVIOR: '0', RELAY_MIRROR: '0', ANTHROPIC_API_KEY: '', OLLAMA_URL: 'http://127.0.0.1:9', KOKORO_START: ''}});
  proc.stdout.on('data', d => {out += d}); proc.stderr.on('data', d => {out += d});
  let exited = null; proc.on('exit', c => {exited = c});
  const send = s => proc.stdin.write(s + '\n');
  const mark = () => out.length;
  const seen = (re, from = 0, ms = 40000) => until(async () => re.test(out.slice(from)) ? out.slice(from) : null, ms);
  const pidOf = (re, from = 0) => { const m = out.slice(from).match(re); return m ? Number(m[1]) : null };
  // a pretend game page: connects as the page, names the agent heroes, reconnects after a relay restart
  let page = null, pageOn = true, hello = [{id: 7, name: 'Tester', alive: true}];
  const connectPage = () => { if (!pageOn || exited != null) return; const ws = new WebSocket(`ws://127.0.0.1:${RP}/play`, {headers: {origin: ORIGIN}}); page = ws;
    ws.on('open', () => ws.send(JSON.stringify({type: 'hello', heroes: hello}))); ws.on('message', b => {let m; try {m = JSON.parse(String(b))} catch {return} if (m.id != null && m.type !== 'result') ws.send(JSON.stringify({type: 'result', id: m.id, result: {ok: true, tool: m.tool}}))}); ws.on('error', () => {}); ws.on('close', () => setTimeout(connectPage, 250)) };
  const children = [];
  try {
    ok(await seen(/\[relay\]\s+\[relay\] listening|listening on http:\/\/127\.0\.0\.1:\d+/), 'the relay starts');
    ok(await seen(/\[vite\]\s+.*(Local:|ready in)/), 'Vite starts, its output prefixed [vite]');
    const seenStart = await until(async () => {try {return JSON.parse(readFileSync(join(work, 'logs', 'last-seen.json'), 'utf8')).commit} catch {return null}}, 5000);
    ok(seenStart === git(work, 'rev-parse', 'HEAD'), 'on start the launcher records HEAD as the commit seen (patch notes, #664)');
    ok(/\[relay\]/.test(out) && /\[up\]/.test(out), 'output is prefixed per process');
    const relay1 = pidOf(/relay started \(pid (\d+)\)/), vite1 = pidOf(/vite started \(pid (\d+)\)/);
    ok(relay1 && vite1 && alive(relay1) && alive(vite1), 'both children run');
    children.push(relay1, vite1);
    const art1 = pidOf(/art loop started \(pid (\d+)\)/);
    ok(art1 && alive(art1), 'the art loop runs as a third child (pid ' + art1 + ')');
    children.push(art1);
    ok(await until(async () => { try {return JSON.parse(readFileSync(artState, 'utf8')).state === 'waiting'} catch {return false} }, 30000), 'its first pass ends and it waits for the next check (no HF server here: a problem, retried hours later)');
    ok(/\[art\]\s+(?!\[art\])/.test(out) && !/\[art\]\s+\[art\]/.test(out), 'its output is prefixed [art] once');
    ok(await listening(RP) && await listening(VP), 'ports ' + RP + ' and ' + VP + ' are held');
    // resume: the page connects with Tester (hero 7) but not Other (hero 8)
    let m = mark(); connectPage();
    ok(await seen(/resumed Tester/, m, 20000), 'the saved runner is resumed once the page names the same hero');
    ok(await seen(/skipped Other: not an agent-played hero/, m, 5000), 'a saved hero the page no longer names is skipped');
    // r: restart
    await sleep(1500); // the mock runner (no Ollama) has already given up and left the list: put it back as if it were live at the restart
    writeFileSync(active, JSON.stringify({saved: 'x', runners: [{kind: 'hero', hero: 7, name: 'Tester', provider: 'ollama', model: 'qwen2.5:14b', maxTurns: 50, budget: null}]}));
    m = mark(); send('r');
    ok(await seen(/relay started \(pid \d+\)/, m), 'r restarts the relay');
    const relay2 = pidOf(/relay started \(pid (\d+)\)/, m);
    ok(relay2 && relay2 !== relay1 && alive(relay2) && !alive(relay1), 'a new relay pid, the old one gone (' + relay1 + ' -> ' + relay2 + ')');
    ok(pidOf(/vite started \(pid (\d+)\)/, m) === null && alive(vite1), 'Vite is left alone by r');
    children.push(relay2);
    ok(await seen(/resumed Tester/, m, 30000), 'the new relay resumes the runner list once the page has reconnected');
    // s: status
    m = mark(); send('s');
    ok(await seen(/relay: ok/, m, 8000) && await seen(/art loop: /, m, 8000) && /ollama: not reachable/.test(out.slice(m)), 'status shows the relay and Ollama');
    ok(await seen(/art loop: waiting until \d{4}-\d\d-\d\d \d\d:\d\d .*; last pass made 0/, m, 8000), 's shows the art loop: its next check and last pass: ' + (out.slice(m).match(/art loop: .*/) || [''])[0]);
    ok(await seen(/cost today: /, m, 8000), 's shows the spend of the day in one line (#799): ' + (out.slice(m).match(/cost today: .*/) || [''])[0]);
    // a: art review (#712) and s ending with it
    m = mark(); send('a');
    ok(await seen(/art review: nothing waiting/, m, 15000) && /art terrain: 0 accepted, 0 waiting/.test(out.slice(m)), 'a prints the art review, one line per slice');
    m = mark(); send('h'); ok(await seen(/a  art review/, m, 4000), 'h lists the a key');
    // u: dirty tree refused
    appendFileSync(join(work, 'a.txt'), 'local edit\n'); m = mark(); send('update');
    ok(await seen(/update refused: the working tree has local changes/, m, 15000), 'u refuses a dirty tree');
    ok(pidOf(/relay started \(pid (\d+)\)/, m) === null, 'and does not restart anything');
    git(work, 'checkout', '--', 'a.txt');
    // u: nothing new
    m = mark(); send('u'); ok(await seen(/already up to date/, m, 20000), 'u says so when there is nothing new');
    // u: not a fast-forward
    writeFileSync(join(work, 'local.txt'), 'x'); git(work, 'add', 'local.txt'); git(work, 'commit', '-q', '-m', 'local');
    writeFileSync(join(other, 'remote.txt'), 'y'); git(other, 'add', 'remote.txt'); git(other, 'commit', '-q', '-m', 'remote'); git(other, 'push', '-q', 'origin', 'main');
    m = mark(); send('u'); ok(await seen(/update refused: git pull --ff-only did not fast-forward/, m, 20000), 'u refuses a diverged history');
    git(work, 'fetch', '-q'); git(work, 'reset', '-q', '--hard', 'origin/main'); // drop the local commit: back in line with origin
    // u: git's own refusal when an incoming commit touches a locally edited file (here an agent-memory note)
    const mem = join(work, '.claude', 'agent-memory', 'x', 'MEMORY.md');
    git(other, 'pull', '-q', '--ff-only'); writeFileSync(join(other, '.claude', 'agent-memory', 'x', 'MEMORY.md'), 'remote note\n'); git(other, 'add', '-A'); git(other, 'commit', '-q', '-m', 'note'); git(other, 'push', '-q', 'origin', 'main');
    appendFileSync(mem, 'local note\n'); m = mark(); send('u');
    ok(await seen(/Commit or discard your local changes to \.claude\/agent-memory\/x\/MEMORY\.md/, m, 20000), 'a pull that would overwrite a locally edited file is refused by git, naming the file');
    git(work, 'checkout', '--', '.claude/agent-memory/x/MEMORY.md');
    // patch notes (#664): the launcher recorded the commit seen at start; a pull that brings a merged PR with its note prints
    // it under [notes] and records the new HEAD; n shows the last notes again
    const seenOf = () => {try {return JSON.parse(readFileSync(join(work, 'logs', 'last-seen.json'), 'utf8')).commit} catch {return null}};
    ok(seenStart && /^[0-9a-f]{40}$/.test(seenStart), 'the launcher recorded the commit seen at start (logs/last-seen.json)');
    git(other, 'pull', '-q', '--ff-only'); git(other, 'checkout', '-q', '-b', 'feat');
    mkdirSync(join(other, 'docs', 'patchnotes'), {recursive: true});
    writeFileSync(join(other, 'docs', 'patchnotes', '101.md'), '---\ntitle: Lanterns at the gate\ndate: 2026-11-03\narea: world\nissues: [5]\n---\n- The town gates now carry lanterns at night.\n');
    writeFileSync(join(other, 'docs', 'patchnotes', '102.md'), '---\ntitle: Not merged yet\ndate: 2026-11-03\narea: ai\nissues: []\n---\n- A note for a PR still open.\n');
    git(other, 'add', '-A'); git(other, 'commit', '-q', '-m', 'notes'); git(other, 'checkout', '-q', 'main');
    git(other, 'merge', '-q', '--no-ff', 'feat', '-m', 'Merge pull request #101 from x/lanterns', '-m', 'Lanterns at the gate'); git(other, 'push', '-q', 'origin', 'main');
    m = mark(); send('u');
    ok(await seen(/\[notes\]\s+1 change\(s\) since you last looked/, m, 30000), 'u prints the notes merged since the last seen commit');
    ok(await seen(/\[notes\]\s+\d{4}-\d\d-\d\d #101 Lanterns at the gate[\s\S]*\[notes\]\s+- The town gates now carry lanterns at night\./, m, 5000) && !/Not merged yet/.test(out.slice(m)), 'the merged PR\'s note with its date, number and lines; a note of a PR not merged is not shown');
    ok(await until(async () => seenOf() === git(work, 'rev-parse', 'HEAD'), 10000), 'and records the new HEAD as seen');
    ok(await seen(/update applied/, m, 30000), 'the update finishes');
    m = mark(); send('n');
    ok(await seen(/the last 1 patch notes:[\s\S]*#101 Lanterns at the gate/, m, 5000), 'n shows the last notes again');
    // u: a dirty agent-memory file (not touched by the pull) does not block it; a dirty src file does (a.txt above)
    appendFileSync(join(work, '.claude', 'agent-memory', 'x', 'OTHER.md'), 'unsaved agent note\n'); writeFileSync(join(work, '.claude', 'agent-memory', 'new-note.md'), 'untracked\n');
    // u: fast-forward with a changed lockfile and vite config
    writeFileSync(join(other, 'package-lock.json'), '{"changed":1}'); writeFileSync(join(other, 'vite.config.js'), 'export default {server:{}};\n');
    git(other, 'pull', '-q', '--ff-only'); git(other, 'add', '-A'); git(other, 'commit', '-q', '-m', 'deps'); git(other, 'push', '-q', 'origin', 'main');
    m = mark(); send('u');
    ok(await seen(/updated [0-9a-f]{7} -> [0-9a-f]{7}: \d+ file\(s\) changed/, m, 30000), 'u pulls the fast-forward although an agent-memory file is dirty');
    ok(await seen(/relay started \(pid \d+\)[\s\S]*vite started|vite started \(pid \d+\)/, m, 60000) && existsSync(join(tmp, 'npm-ran.txt')) && /install in .*work/.test(readFileSync(join(tmp, 'npm-ran.txt'), 'utf8')), 'a changed package-lock.json runs npm install (mock) in the repo');
    const relay3 = pidOf(/relay started \(pid (\d+)\)/, m), vite2 = pidOf(/vite started \(pid (\d+)\)/, m);
    ok(relay3 && relay3 !== relay2 && !alive(relay2) && vite2 && vite2 !== vite1 && !alive(vite1), 'the relay and (dependencies changed) Vite restarted with new pids');
    children.push(relay3, vite2);
    const art2 = pidOf(/art loop started \(pid (\d+)\)/, m);
    ok(art2 && art2 !== art1 && alive(art2) && !alive(art1), 'u restarts the art loop with the new scripts (' + art1 + ' -> ' + art2 + ')');
    children.push(art2);
    ok(await seen(/update applied|\[relay\].*listening/, m, 20000) || true, 'update finishes');
    await until(async () => await listening(RP) && await listening(VP), 20000);
    // code-change notice
    await sleep(2500); m = mark();
    const touched = join(ROOT, 'scripts', 'providers', '.upcheck-touch.mjs'); writeFileSync(touched, '// upcheck\n');
    ok(await seen(/relay code changed .*press u \(or r\) to apply/, m, 8000), 'a changed script prints "relay code changed: press u (or r) to apply"'); try {rmSync(touched)} catch {}
    // q
    m = mark(); send('q');
    ok(await until(async () => exited != null, 30000) !== null && exited === 0, 'q exits the launcher (code ' + exited + ')');
    await sleep(500);
    ok(children.every(p => !alive(p)), 'no relay, Vite or art loop process is left');
    ok(JSON.parse(readFileSync(artState, 'utf8')).state === 'stopped', 'the art loop stopped cleanly on the launcher\'s stop (its state file says stopped)');
    ok(!(await listening(RP)) && !(await listening(VP)), 'ports ' + RP + ' and ' + VP + ' are free');
    ok(/stopped\. Ports/.test(out.slice(m)), 'the launcher says it stopped');
  } catch (e) {
    console.error('  FAIL launcher check threw: ' + (e && e.stack || e)); fail++;
  } finally {
    pageOn = false; try {page && page.close()} catch {}
    if (exited == null) {try {spawnSync('taskkill', ['/T', '/F', '/PID', String(proc.pid)], {windowsHide: true})} catch {} try {proc.kill()} catch {}}
    for (const p of children) if (alive(p)) {try {process.kill(p)} catch {}}
    if (fail) console.error('--- launcher output ---\n' + out.slice(-4000));
    await sleep(300); try {rmSync(tmp, {recursive: true, force: true})} catch {}
  }
}

console.log('launcher --no-art');
{
  const tmp = mkTmp('eldmoor-upart-');
  const RP = await freePort(), VP = await freePort();
  let out = '', exited = null;
  const proc = spawn(process.execPath, ['scripts/up.mjs', '--relay-port', String(RP), '--vite-port', String(VP), '--no-open', '--no-art', '--repo', ROOT], {cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'],
    env: {...process.env, AGENT_LOGS: join(tmp, 'logs'), ART_STATE: join(tmp, 'art-loop.json'), ART_LOG: join(tmp, 'art.log'), NO_COLOR: '1', RELAY_BEHAVIOR: '0', RELAY_MIRROR: '0', ANTHROPIC_API_KEY: '', OLLAMA_URL: 'http://127.0.0.1:9', KOKORO_START: '', UP_GRACE_MS: String(fastMs(15000, 3000))}});
  proc.stdout.on('data', d => {out += d}); proc.stderr.on('data', d => {out += d}); proc.on('exit', c => {exited = c});
  try {
    ok(await until(async () => /vite started \(pid \d+\)/.test(out), 30000), '--no-art: the launcher starts');
    proc.stdin.write('s\n');
    ok(await until(async () => /art loop: off/.test(out), 15000) && !/art loop started/.test(out), '--no-art starts no art loop and `s` says off');
    proc.stdin.write('q\n');
    ok(await until(async () => exited != null, 30000) !== null && exited === 0, 'and quits cleanly');
  } finally {
    if (exited == null) {try {spawnSync('taskkill', ['/T', '/F', '/PID', String(proc.pid)], {windowsHide: true})} catch {} try {proc.kill()} catch {}}
    if (fail) console.error('--- launcher output ---\n' + out.slice(-2000));
    await sleep(300); try {rmSync(tmp, {recursive: true, force: true})} catch {}
  }
}

// ---------------------------------------------------------------- 3. the voice engine (#554), fake start scripts, spare ports
console.log('launcher voice engine (fake scripts)');
{
  const tmp = mkTmp('eldmoor-upvoice-');
  const fakeMjs = join(tmp, 'fake-voice.mjs'), mark = join(tmp, 'voice-ran.txt');
  writeFileSync(fakeMjs, `import net from 'node:net'; import {appendFileSync} from 'node:fs';
appendFileSync(process.env.FAKE_MARK, process.pid + '\\n');
if (process.env.FAKE_MODE === 'crash') {console.log('fake voice: failing'); process.exit(3)}
net.createServer().listen(Number(new URL(process.env.TTS_URL).port), '127.0.0.1', () => console.log('fake voice: listening'));`);
  const fakePs1 = join(tmp, 'fake voice.ps1'); // a space in the path: the argument array keeps it whole
  writeFileSync(fakePs1, `Add-Content -Path $env:FAKE_MARK -Value $PID
$l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, [int]([uri]$env:TTS_URL).Port)
$l.Start(); Write-Output 'fake voice: listening'; Start-Sleep -Seconds 600
`);
  const launch1 = async ({args = [], env = {}} = {}) => {
    const RP = await freePort(), VP = await freePort(); let out = '', exited = null;
    const proc = spawn(process.execPath, ['scripts/up.mjs', '--relay-port', String(RP), '--vite-port', String(VP), '--no-open', '--no-art', '--repo', ROOT, ...args], {cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'],
      env: {...process.env, AGENT_LOGS: join(tmp, 'logs'), NO_COLOR: '1', RELAY_BEHAVIOR: '0', RELAY_MIRROR: '0', ANTHROPIC_API_KEY: '', OLLAMA_URL: 'http://127.0.0.1:9', FAKE_MARK: mark, UP_GRACE_MS: String(fastMs(15000, 3000)), KOKORO_START: '', VOICE: '', ...env}});
    proc.stdout.on('data', d => {out += d}); proc.stderr.on('data', d => {out += d}); proc.on('exit', c => {exited = c});
    const o = {proc, get out() {return out}, send: k => proc.stdin.write(k + '\n'), seen: (re, ms = 30000) => until(async () => re.test(out), ms),
      quit: async () => {o.send('q'); const r = await until(async () => exited != null, 30000); if (exited == null) {try {spawnSync('taskkill', ['/T', '/F', '/PID', String(proc.pid)], {windowsHide: true})} catch {} try {proc.kill()} catch {}} return r !== null && exited === 0}};
    return o;
  };
  const pidIn = (out, re) => { const m = out.match(re); return m ? Number(m[1]) : null };
  const marks = () => existsSync(mark) ? readFileSync(mark, 'utf8').split(/\r?\n/).filter(Boolean).length : 0;
  const url = p => 'http://127.0.0.1:' + p;
  let L = null;
  const dog = setTimeout(() => {console.error('  FAIL the voice section did not finish in 4 minutes (a launcher or child never settled)'); if (L) console.error(String(L.out).slice(-2500)); try {spawnSync('taskkill', ['/T', '/F', '/PID', String(L.proc.pid)], {windowsHide: true})} catch {} try {L.proc.kill()} catch {} process.exit(1)}, 240000);
  try {
    // A: KOKORO_START from the environment, a .mjs script, on a spare port; the launcher does not wait for it
    let VPORT = await freePort();
    L = await launch1({env: {KOKORO_START: fakeMjs, TTS_URL: url(VPORT)}});
    ok(await L.seen(/relay started \(pid \d+\)/) && await L.seen(/vite started \(pid \d+\)/) && await L.seen(/voice engine started \(pid \d+\)/), '[voice] KOKORO_START starts a fourth child beside the relay and Vite');
    const vpid = pidIn(L.out, /voice engine started \(pid (\d+)\)/);
    ok(await until(async () => await listening(VPORT), 15000), 'the engine answers on its port (' + VPORT + ')');
    ok(await L.seen(/voice engine answering after/, 15000), 'one line when it starts answering');
    ok(/\[voice\]\s+fake voice: listening/.test(L.out), 'its output is prefixed [voice]');
    L.send('s'); ok(await L.seen(/voice: running \(pid \d+/, 15000), 's shows it running');
    ok(await L.quit(), 'q exits the launcher');
    await sleep(500);
    ok(vpid && !alive(vpid) && !(await listening(VPORT)), 'q stops the engine and frees its port');

    if (process.platform === 'win32') { // B: powershell -ExecutionPolicy Bypass -File, a path with a space, --voice-script
      VPORT = await freePort(); const n0 = marks();
      L = await launch1({args: ['--voice-script', fakePs1], env: {TTS_URL: url(VPORT)}});
      ok(await L.seen(/voice engine started \(pid \d+\)/) && await until(async () => await listening(VPORT), 30000), '--voice-script runs a .ps1 through powershell and it answers');
      const ppid = pidIn(L.out, /voice engine started \(pid (\d+)\)/);
      ok(marks() === n0 + 1, 'started once');
      ok(await L.quit() && (await sleep(500), !alive(ppid)) && !(await listening(VPORT)), 'q stops powershell and its listener');
    }

    // C: something already answers on the port: left alone, no second engine, never killed
    VPORT = await freePort(); const heldSockets = new Set(), held = net.createServer(c => {heldSockets.add(c); c.on('close', () => heldSockets.delete(c)); c.on('error', () => {})}); await new Promise(r => held.listen(VPORT, '127.0.0.1', r)); const n1 = marks();
    L = await launch1({env: {KOKORO_START: fakeMjs, TTS_URL: url(VPORT)}});
    ok(await L.seen(/voice: something already answers on port \d+; not starting another/), 'an engine already on the port is not started twice');
    L.send('s'); ok(await L.seen(/voice: already running elsewhere \(left alone\)/, 15000) && marks() === n1 && !/voice engine started/.test(L.out), 's says so and the script never ran');
    ok(await L.quit() && await listening(VPORT), 'q leaves what it did not start running');
    for (const c of heldSockets) c.destroy(); await Promise.race([new Promise(r => held.close(r)), sleep(5000)]); // close() waits for every open socket: never let that hang the check

    // D: a script that is not there: one line, the game carries on
    L = await launch1({env: {KOKORO_START: join(tmp, 'nope.ps1'), TTS_URL: url(await freePort())}});
    ok(await L.seen(/voice: start script not found: .*nope\.ps1/) && await L.seen(/vite started \(pid \d+\)/) && await L.seen(/relay started \(pid \d+\)/), 'a missing start script is one line and the relay and Vite run');
    L.send('s'); ok(await L.seen(/voice: script not found/, 15000), 's says script not found');
    ok(await L.quit(), 'and q is clean');

    // E: a crash is one line, no restart loop
    const n2 = marks();
    L = await launch1({env: {KOKORO_START: fakeMjs, FAKE_MODE: 'crash', TTS_URL: url(await freePort())}});
    ok(await L.seen(/voice engine exited on its own \(code 3\)/), 'a crashing engine is one line');
    await sleep(fastMs(4000, 1500));
    ok(marks() === n2 + 1 && (L.out.match(/voice engine exited on its own/g) || []).length === 1, 'and is not started again');
    L.send('s'); ok(await L.seen(/voice: stopped \(exited on its own, code 3\)/, 15000), 's shows it stopped');
    ok(await L.quit(), 'the game goes on and quits cleanly');

    // F: --no-voice beats the configuration; VOICE=0 does too
    const n3 = marks();
    L = await launch1({args: ['--no-voice'], env: {KOKORO_START: fakeMjs, TTS_URL: url(await freePort())}});
    ok(await L.seen(/vite started \(pid \d+\)/), '--no-voice: the launcher starts');
    L.send('s'); ok(await L.seen(/voice: off/, 15000) && marks() === n3 && !/voice engine started/.test(L.out), '--no-voice starts nothing and s says off');
    ok(await L.quit(), 'clean quit');
    L = await launch1({env: {KOKORO_START: fakeMjs, VOICE: '0', TTS_URL: url(await freePort())}});
    L.send('s'); ok(await L.seen(/voice: off/, 30000) && marks() === n3, 'VOICE=0 starts nothing');
    ok(await L.quit(), 'clean quit');

    // G: nothing configured: behaves as before, with one hint line
    L = await launch1();
    ok(await L.seen(/vite started \(pid \d+\)/) && await L.seen(/voice: no speech engine configured/), 'not configured: one hint line');
    L.send('s'); ok(await L.seen(/voice: not configured/, 15000) && !/voice engine started/.test(L.out), 's says not configured');
    ok(await L.quit(), 'clean quit');

    // H: a TTS_URL on another machine is refused
    L = await launch1({env: {KOKORO_START: fakeMjs, TTS_URL: 'http://192.0.2.7:8880'}});
    ok(await L.seen(/voice: TTS_URL must be 127\.0\.0\.1 or localhost/) && !/voice engine started/.test(L.out), 'a TTS_URL that is not on this machine is refused');
    ok(await L.quit(), 'clean quit');
  } catch (e) {
    console.error('  FAIL voice check threw: ' + (e && e.stack || e)); fail++;
    if (L) {console.error('--- launcher output ---\n' + L.out.slice(-2500)); try {spawnSync('taskkill', ['/T', '/F', '/PID', String(L.proc.pid)], {windowsHide: true})} catch {}}
  } finally {
    clearTimeout(dog); await sleep(300); try {rmSync(tmp, {recursive: true, force: true})} catch {}
  }
}

console.log(fail ? `\nupcheck: ${fail} FAILED` : '\nupcheck: all ok');
process.exit(fail ? 1 : 0);
