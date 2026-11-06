// Nightly long run of agent play (issue #574). A headless world with a Fellowship of agent-played members (the mock minds cannot play the DM seat, which stays scripted),
// played by the real runners against a mock Ollama (scripts/mock-ollama.mjs): no paid API, no real model, nothing
// beyond 127.0.0.1. After the run it writes the behavior report and checks it against scripts/nightly-thresholds.json.
//   node scripts/nightly-run.mjs [--minutes 60] [--speed 8] [--out DIR] [--thresholds FILE] [--check-only]
// Writes <out>/summary.md (what was measured, which threshold was crossed), <out>/report.md (npm run behavior-report) and the
// logs under <out>/behavior. Exit 0 when every threshold holds, 1 when one is crossed, 2 when the run itself broke.
// --check-only re-reads an existing <out> (no run), for testing the thresholds.
import {spawn} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : d; }, flag = n => args.includes('--' + n);
const MINUTES = Number(opt('minutes', 60)), SPEED = Number(opt('speed', 8)), OUT = resolve(opt('out', join(ROOT, 'logs', 'nightly')));
const TH = JSON.parse(readFileSync(resolve(opt('thresholds', join(HERE, 'nightly-thresholds.json'))), 'utf8'));
const WORLD = 'nightly';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let restarts = 0; // Fellowship runners started again for the recruits (#822)

// ---- the run ----
async function run() {
  const {startMockOllama} = await import('./mock-ollama.mjs');
  const mock = await startMockOllama(), port = 18700 + Math.floor(Math.random() * 200), base = `http://127.0.0.1:${port}`;
  mkdirSync(OUT, {recursive: true});
  const env = {...process.env, AGENT_LOGS: join(OUT, 'agents'), BEHAVIOR_DIR: join(OUT, 'behavior'), ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', OLLAMA_URL: mock.url,
    AGENT_MIN_GAP: '2', AGENT_HEARTBEAT: '60', AGENT_REFLECT: '1', RELAY_VERBOSE: ''};
  const kids = [], log = [];
  const kid = (name, a) => { const p = spawn(process.execPath, a, {cwd: ROOT, env, stdio: ['pipe', 'pipe', 'pipe']}); const k = {name, p, dead: 0, other: 0, done: new Promise(r => p.on('exit', (c, sig) => { k.how = sig ? 'signal ' + sig : 'code ' + c; r(c); }))};
    const keep = d => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) { const e = /\] done \(([^)]+)\)/.exec(l); if (e) k[/^(dead|left agent play)$/.test(e[1]) ? 'dead' : 'other']++; log.push(`[${name}] ${l}`); if (log.length > 20000) log.shift(); } };
    p.stdout.on('data', keep); p.stderr.on('data', keep); kids.push(k); return k; };
  kid('world', ['scripts/play-headless.mjs', '--fellowship', '--agents', '0', '--port', String(port), '--quiet', '--speed', String(SPEED), '--warm', '1',
    '--world', join(OUT, 'world.json'), '--log-world', WORLD, '--no-relay']);
  for (let i = 0; i < 300 && !log.some(l => /headless world at /.test(l)); i++) await sleep(200);
  if (!log.some(l => /headless world at /.test(l))) throw new Error('the headless world did not start\n' + log.slice(-20).join('\n'));
  const rflags = ['--url', base, '--provider', 'ollama', '--model', 'mock-table:1b', '--ollama-url', mock.url];
  const startRunner = () => kid('fellowship', ['scripts/fellowship.mjs', ...rflags, '--min-gap', '2', '--heartbeat', '60']);
  let runner = startRunner();
  // A Fellowship runner ends by itself when its last member dies, and in the game the supervisor starts it again for the recruits (adopt in
  // scripts/runners.mjs). There is no supervisor here, so this is that step: without it the rest of the run measured seats nobody plays (#822: every
  // reflex-scenes and stuck-state of the 2026-11-06 run came after the runner left at minute 4). A runner that ended any other way stays down and shows in the numbers.
  const recruits = async () => { try { const h = await (await fetch(base + '/play/health')).json(); return (h.heroes || []).some(x => x.alive && x.fellow); } catch { return false; } };
  console.log(`[nightly] world on ${base}, runners started; playing ${MINUTES} real minutes at ${SPEED}x`);
  const end = Date.now() + MINUTES * 60000;
  let said = 0;
  while (Date.now() < end) {
    await sleep(Math.min(2000, end - Date.now()));
    const gone = kids.find(k => k.name === 'world' && k.how);
    if (gone) { writeFileSync(join(OUT, 'run.log'), log.join('\n') + '\n'); throw new Error(`the headless world exited early (${gone.how})\n` + log.filter(l => l.startsWith('[world]')).slice(-10).join('\n')); }
    if (runner.p.exitCode !== null && runner.dead && !runner.other && await recruits()) { runner = startRunner(); restarts++; console.log(`[nightly] the last member fell: runner started again for the recruits (${restarts})`); }
    if (Date.now() - said >= 30000) { said = Date.now(); console.log(`[nightly] ${Math.round((end - Date.now()) / 60000)} min left; ${restarts ? restarts + ' runner restarts; ' : ''}${runner.p.exitCode === null ? 'all up' : 'the runner is down: ' + runner.p.exitCode}`); }
  }
  for (const k of kids.slice().reverse()) { if (k.p.exitCode === null) try { k.p.stdin.write('stop\n'); } catch {} }
  await sleep(3000);
  for (const k of kids.slice().reverse()) { if (k.p.exitCode === null) k.p.kill(); }
  await Promise.race([Promise.all(kids.map(k => k.done)), sleep(8000)]);
  mock.close && mock.close();
  writeFileSync(join(OUT, 'run.log'), log.join('\n') + '\n');
}

// ---- the check ----
function jsonl(dir, name) {
  const out = []; if (!existsSync(dir)) return out;
  for (let i = 3; i >= 0; i--) { const f = join(dir, i ? `${name}.${i}` : name); if (!existsSync(f)) continue;
    for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch {} } }
  return out;
}
export function measure(dir) {
  const T = jsonl(dir, 'turns.jsonl'), W = jsonl(dir, 'world.jsonl'), A = jsonl(dir, 'anomalies.jsonl');
  const sh = {agent: 0, autopilot: 0, relay: 0, scripted: 0}; let scenes = 0, deaths = 0, idleMax = 0;
  const members = new Set(W.flatMap(w => (w.members || []).map(m => m.name))); // a fallen member gone from the roster by the next digest carries no flag (#822)
  for (const w of W) {
    const s = w.share || {}; for (const k of Object.keys(sh)) sh[k] += Number(s[k]) || 0;
    scenes += (w.table && w.table.opened) || 0; deaths += Array.isArray(w.deaths) ? w.deaths.filter(d => d.fellow || d.agent || d.watched || members.has(d.name)).length : 0;
  }
  for (const a of A) if (a.kind === 'idle') idleMax = Math.max(idleMax, Number(a.evidence && a.evidence.minutes || 0) / 60);
  const tot = Object.values(sh).reduce((a, b) => a + b, 0), kinds = {};
  for (const a of A) kinds[a.kind] = (kinds[a.kind] || 0) + 1 + (a.heldBack || 0);
  const empty = T.filter(t => (t.flags || []).includes('empty')).length;
  return {turns: T.length, empty, emptyRate: T.length ? empty / T.length : 0, digests: W.length, autopilotShare: tot ? sh.autopilot / tot : 0, share: sh, scenes, deaths, idleMaxHours: idleMax, anomalies: kinds};
}
export function judge(m, th) {
  const bad = [], chk = (c, msg) => { if (!c) bad.push(msg); };
  chk(m.turns >= th.minTurns, `only ${m.turns} agent turns in the run (needs ${th.minTurns}): the runners barely played`);
  chk(m.digests > 0, 'no world digests were written');
  chk(m.autopilotShare <= th.maxAutopilotShare, `autopilot share ${(m.autopilotShare * 100).toFixed(0)}% is above ${(th.maxAutopilotShare * 100).toFixed(0)}%`);
  chk(m.scenes >= th.minTableScenes, `${m.scenes} Table scenes opened (needs ${th.minTableScenes})`);
  chk(m.deaths <= th.maxDeaths, `${m.deaths} watched deaths (limit ${th.maxDeaths})`);
  chk(m.emptyRate <= th.maxEmptyTurnRate, `empty turn rate ${(m.emptyRate * 100).toFixed(0)}% is above ${(th.maxEmptyTurnRate * 100).toFixed(0)}%`);
  chk(m.idleMaxHours <= th.maxIdleGameHours, `a seat idle ${m.idleMaxHours.toFixed(1)} game hours (limit ${th.maxIdleGameHours})`);
  for (const [k, lim] of Object.entries(th.maxAnomalies || {})) chk((m.anomalies[k] || 0) <= lim, `anomaly ${k} x${m.anomalies[k] || 0} (limit ${lim})`);
  return bad;
}

async function main() {
  if (!flag('check-only')) { try { await run(); } catch (e) { console.error('[nightly] the run broke: ' + e.message); mkdirSync(OUT, {recursive: true}); writeFileSync(join(OUT, 'summary.md'), `# Nightly agent run\n\nThe run itself broke: ${e.message.split('\n')[0]}\n`); process.exit(2); } }
  const dir = join(OUT, 'behavior', WORLD);
  try { const {writeReport} = await import('./behavior-report.mjs'); const r = writeReport(join(OUT, 'behavior'), WORLD); if (r && r.file) writeFileSync(join(OUT, 'report.md'), readFileSync(r.file, 'utf8')); } catch (e) { console.error('[nightly] report failed: ' + e.message); }
  const m = measure(dir), bad = judge(m, TH);
  const L = [`# Nightly agent run (${MINUTES} min at ${SPEED}x, mock minds)`, '', bad.length ? `**${bad.length} threshold${bad.length > 1 ? 's' : ''} crossed**` : 'Every threshold holds.', '', ...bad.map(b => '- ' + b), '',
    '| measure | value | limit |', '| --- | --- | --- |',
    `| agent turns | ${m.turns} | at least ${TH.minTurns} |`, `| empty turn rate | ${(m.emptyRate * 100).toFixed(0)}% | ${(TH.maxEmptyTurnRate * 100).toFixed(0)}% |`,
    `| autopilot share | ${(m.autopilotShare * 100).toFixed(0)}% | ${(TH.maxAutopilotShare * 100).toFixed(0)}% |`, `| Table scenes | ${m.scenes} | at least ${TH.minTableScenes} |`,
    `| deaths (watched) | ${m.deaths} | ${TH.maxDeaths} |`, `| longest idle (game hours) | ${m.idleMaxHours.toFixed(1)} | ${TH.maxIdleGameHours} |`,
    `| runner restarts for recruits | ${restarts} | none set |`, `| anomalies | ${Object.entries(m.anomalies).map(([k, n]) => k + ' ' + n).join(', ') || 'none'} | see thresholds |`, ''];
  writeFileSync(join(OUT, 'summary.md'), L.join('\n')); console.log(L.join('\n'));
  process.exit(bad.length ? 1 : 0);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
