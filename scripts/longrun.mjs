// A long headless run for #826's question: do companies and solos start Crypt runs and raids by themselves? (#926)
// A world with a Fellowship and --solos agent heroes, played by the real runners against a mock Ollama (model mock-crypt:1b: the
// leader of a company proposes the Crypt from level 8 and Kragmaw from level 14, a solo walks in with go_crypt / join_raid).
// No paid API, nothing beyond 127.0.0.1. Samples the world process' memory and the health every minute.
//   node scripts/longrun.mjs [--minutes 60] [--speed 8] [--solos 2] [--port 8795] [--out DIR] [--model mock-crypt:1b] [--fellowship-level 8]
import {spawn, execFileSync} from 'node:child_process';
import {mkdirSync, writeFileSync, appendFileSync} from 'node:fs';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const MINUTES = Number(opt('minutes', 60)), SPEED = Number(opt('speed', 8)), SOLOS = Number(opt('solos', 2)), PORT = Number(opt('port', 8795)), MODEL = opt('model', 'mock-crypt:1b'), FL = Number(opt('fellowship-level', 0));
const OUT = resolve(opt('out', join(ROOT, 'logs', 'longrun'))), WORLD = 'longrun', sleep = ms => new Promise(r => setTimeout(r, ms));
const rss = pid => { try { return Number(execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).WorkingSet64`], {encoding: 'utf8'}).trim()) / 1048576; } catch { return -1; } };
const {startMockOllama} = await import('./mock-ollama.mjs');
const mock = await startMockOllama(); mkdirSync(OUT, {recursive: true});
const env = {...process.env, AGENT_LOGS: join(OUT, 'agents'), BEHAVIOR_DIR: join(OUT, 'behavior'), ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', OLLAMA_URL: mock.url, AGENT_MIN_GAP: '2', AGENT_HEARTBEAT: '60', AGENT_REFLECT: '1', RELAY_VERBOSE: ''};
const kids = [], log = [];
const kid = (name, a) => { const p = spawn(process.execPath, a, {cwd: ROOT, env, stdio: ['pipe', 'pipe', 'pipe']}); const k = {name, p, done: new Promise(r => p.on('exit', c => r(c)))};
  const keep = d => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) { log.push(`[${name}] ${l}`); appendFileSync(join(OUT, 'run.log'), `[${name}] ${l}\n`); } };
  p.stdout.on('data', keep); p.stderr.on('data', keep); kids.push(k); return k; };
writeFileSync(join(OUT, 'run.log'), '');
const world = kid('world', ['scripts/play-headless.mjs', '--fellowship', '--solos', String(SOLOS), '--told-crypt', ...(FL ? ['--fellowship-level', String(FL)] : []), '--port', String(PORT), '--quiet', '--speed', String(SPEED), '--warm', '1', '--world', join(OUT, 'world.json'), '--log-world', WORLD, '--no-relay']);
for (let i = 0; i < 400 && !log.some(l => /headless world at /.test(l)); i++) await sleep(200);
if (!log.some(l => /headless world at /.test(l))) throw new Error('the world did not start\n' + log.slice(-20).join('\n'));
const base = `http://127.0.0.1:${PORT}`, rflags = ['--url', base, '--provider', 'ollama', '--model', MODEL, '--ollama-url', mock.url, '--min-gap', '2', '--heartbeat', '60'];
kid('fellowship', ['scripts/fellowship.mjs', ...rflags]);
const spawned = new Set();
for (const l of log.slice()) { const m = l.match(/solo agent hero: (\w+) \(#(\d+)\)/); if (m) spawned.add(Number(m[2])), kid('solo-' + m[1], ['scripts/agent-player.mjs', ...rflags, '--hero', m[2]]); }
console.log(`[longrun] ${base}, ${kids.length} processes; ${MINUTES} real minutes at ${SPEED}x`);
const end = Date.now() + MINUTES * 60000, samples = join(OUT, 'samples.jsonl');
while (Date.now() < end) {
  await sleep(Math.min(30000, end - Date.now()));
  const dead = kids.filter(k => k.p.exitCode !== null).map(k => k.name + ':' + k.p.exitCode);
  let h = null; try { h = await (await fetch(base + '/play/health')).json(); } catch (e) { h = {err: String(e)}; }
  const s = {t: Math.round((Date.now() - (end - MINUTES * 60000)) / 60000), worldMB: Math.round(rss(world.p.pid)), dead, calls: h.calls, errors: h.errors, links: (h.heroes || []).map(x => x.link).join(','), mock: {scene: mock.seen.tableScene, crypt: mock.seen.crypt}};
  appendFileSync(samples, JSON.stringify(s) + '\n'); console.log('[longrun] ' + JSON.stringify(s));
  // no supervisor here: a solo's heir (a living agent hero of a company of one that no runner holds) gets a runner like the one before it
  for (const x of h.heroes || []) if (x.alive && !x.claimed && x.size === 1 && !spawned.has(x.id) && x.company) { spawned.add(x.id); kid('heir-' + x.name, ['scripts/agent-player.mjs', ...rflags, '--hero', String(x.id)]); console.log('[longrun] runner for ' + x.name + ' #' + x.id); }
  if (dead.some(d => d.startsWith('world'))) break;
}
for (const k of kids.slice().reverse()) { try { k.p.stdin.write('stop\n'); } catch {} }
await sleep(4000); for (const k of kids.slice().reverse()) if (k.p.exitCode === null) k.p.kill();
await Promise.race([Promise.all(kids.map(k => k.done)), sleep(8000)]); mock.close();
