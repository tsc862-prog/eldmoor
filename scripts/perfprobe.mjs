// Browser frame-time probe (issue #716, epic #31 "60 fps with 100 heroes on the stepping-stone map").
// Serves the game with its own Vite dev server on a spare port (never 5173), drives headless Chrome over the DevTools
// protocol at 3440x1440 (the owner's screen), and for each world (Eldmoor, the Stepping Lands topped up to 100 heroes),
// camera (whole map, follow one hero) and speed (1x, 8x) records every requestAnimationFrame callback of the page:
//   frame  the delta between rAF callbacks (what the owner sees; vsync paced, so 16.7 ms at best on a 60 Hz clock)
//   work   the time spent inside the callbacks (sim steps + render + panels): the headroom a 60 fps frame has
// Prints median and p95 of both, fps, the share of frames whose work is over 16.7 ms and the share of dropped frames
// (delta over 1.5 vsync intervals). With --profile (default on) a short CPU profile per world and camera at 8x names the
// slowest functions and files (self time), and the renderer's own phase timer (draw.js, globalThis.__drawPhases) splits each
// frame into terrain, ground layers, entities, fx and weather, night lighting, labels and the rest; "night" is the whole map
// with the clock set to 22:30, so the light pass is measured too.
// --speeds 0 measures a frozen world: the render and the panels alone.
// The hero top-up is the probe's own hook (makeHero, as scripts/scalecheck.mjs does), run in the page; the sim has none.
//   node scripts/perfprobe.mjs [--seconds 12] [--heroes 100] [--worlds eldmoor,stepping] [--views map,follow,night]
//        [--speeds 1,8] [--seed 716|off] [--size 3440x1440] [--port 5901] [--url http://localhost:5901/] [--base DIR] [--no-profile] [--json out.json]
// --url uses a server that is already running (its own modules are imported for the hook); without it a Vite dev server
// starts on --port and stops at the end. --base DIR also serves another checkout (on --port + 1) and measures it before
// this one, world by world: a before/after on one machine, for example against main:
//   git archive origin/main | tar -x -C <empty dir>; npm run perfprobe -- --base <that dir> Exits 0, or 1 only when PERF_STRICT=1 and a run's p95 frame time is over
// PERF_P95_MS (default 50). CHROME_PATH picks the browser; PERF_GPU=0 adds --disable-gpu (software canvas, slower).
// Numbers depend on the machine and on what else uses its GPU (Ollama): read them as indicative, compare runs on one box.
import {spawn} from 'node:child_process';
import {writeFileSync, mkdirSync, existsSync, rmSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const WebSocket = createRequire(import.meta.url)('ws');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), flag = n => argv.includes('--' + n), flagv = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const SEED = flagv('seed', '716'), SECONDS = Number(flagv('seconds', 12)), HEROES = Number(flagv('heroes', 100)), PORT = Number(flagv('port', 5901));
const WORLDS = flagv('worlds', 'eldmoor,stepping').split(','), VIEWS = flagv('views', 'map,follow,night').split(','), SPEEDS = flagv('speeds', '1,8').split(',').map(Number);
const [SW, SH] = flagv('size', '3440x1440').split('x').map(Number), PROFILE = !flag('no-profile'), JSON_OUT = flagv('json', null);
const STRICT = process.env.PERF_STRICT === '1', P95_MAX = Number(process.env.PERF_P95_MS || 50);
const CANDIDATES = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
const BIN = CANDIDATES.find(p => existsSync(p));
if (!BIN) { console.error('no Chrome or Edge found; set CHROME_PATH'); process.exit(2); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- servers: the given URL, or our own Vite dev server on this checkout (watch off: the probe never edits files); with
// --base DIR a second one on PORT+1 serves another checkout (for example origin/main extracted with git archive), and each
// world is measured on both, one after the other, so a before/after compares runs minutes apart on one machine.
const servers = [], SIDES = [];
async function serve(root, port) {
  const {createServer} = await import('vite');
  const sv = await createServer({root, configFile: join(root, 'vite.config.js'), logLevel: 'error', server: {port, strictPort: true, host: '127.0.0.1', watch: null, hmr: false}});
  await sv.listen(); servers.push(sv); return `http://127.0.0.1:${port}/`;
}
const BASE_DIR = flagv('base', null);
if (BASE_DIR) SIDES.push({side: 'base', url: await serve(resolve(BASE_DIR), PORT + 1)});
const URL0 = flagv('url', null);
SIDES.push({side: 'head', url: URL0 ? (URL0.endsWith('/') ? URL0 : URL0 + '/') : await serve(ROOT, PORT)});

// --- browser
const port = 9400 + Math.floor(Math.random() * 400), prof = join(tmpdir(), `eldmoor-perf-${port}`);
const flags = ['--hide-scrollbars', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  ...(process.env.PERF_GPU === '0' ? ['--disable-gpu'] : []), ...(process.env.CHROME_NO_SANDBOX ? ['--no-sandbox'] : []),
  `--window-size=${SW},${SH}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${prof}`];
const proc = spawn(BIN, ['--headless=new', ...flags, 'about:blank'], {stdio: ['ignore', 'ignore', 'ignore']});
let ws = null;
async function cleanup() { try { ws && ws.close(); } catch {} try { proc.kill(); } catch {} for (const sv of servers) await sv.close().catch(() => {}); await sleep(300); try { rmSync(prof, {recursive: true, force: true}); } catch {} }
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });
const json = async p => { for (let i = 0; i < 120; i++) { if (proc.exitCode !== null) break; try { return await (await fetch(`http://127.0.0.1:${port}${p}`)).json(); } catch { await sleep(250); } } throw new Error(`no devtools on ${port} (${BIN})`); };
let send, evalJs;
try {
  const page = (await json('/json')).find(t => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl, {perMessageDeflate: false, maxPayload: 512 * 1024 * 1024});
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  let id = 0; const pending = new Map();
  ws.on('message', m => { const d = JSON.parse(m); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
  send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({id: i, method, params})); });
  evalJs = async expr => { const r = await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true}); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result?.result?.value; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Profiler.enable');
  await send('Emulation.setDeviceMetricsOverride', {width: SW, height: SH, deviceScaleFactor: 1, mobile: false});
  // Wrap rAF before the page's own scripts: every callback's start and duration, kept only while __perf.on.
  await send('Page.addScriptToEvaluateOnNewDocument', {source: `(() => {const P = window.__perf = {on: false, t: [], w: []}; const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = cb => raf(ts => { const t0 = performance.now(); try { cb(ts); } finally { if (P.on) { P.t.push(t0); P.w.push(performance.now() - t0); } } });})();`});
} catch (e) { console.error(e.message); await cleanup(); process.exit(2); }

const q = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
// The renderer's frame phases (src/render/draw.js, globalThis.__drawPhases), mean ms a frame.
const PHASES = ['terrain', 'ground', 'entities', 'fx+weather', 'night', 'labels', 'bubbles+minimap'];

// Boot one world: no title, no Fellowship, no save (fresh profile), the run gate off, setup and alerts hidden, heroes topped up.
async function bootWorld(base, world) {
  await send('Page.navigate', {url: `${base}?world=${world}&continue=1&fellowship=0`});
  for (let i = 0; i < 80; i++) { await sleep(250); if (await evalJs(`!!document.getElementById('cv') && document.getElementById('cv').width > 0 && !!window.__perf`).catch(() => false)) break; }
  await sleep(1500);
  return evalJs(`(async () => {
    const {S, step} = await import('/src/sim/index.js'), {makeHero} = await import('/src/sim/heroes.js'), {maxHp} = await import('/src/sim/index.js');
    const {CLSN} = await import('/src/data/classes.js'), {ri, pickA} = await import('/src/core/rng.js');
    const {setRunFree} = await import('/src/ui/rungate.js'), {seedRng, rnd} = await import('/src/core/rng.js'), {init} = await import('/src/sim/index.js');
    setRunFree(true);
    // A seeded world (--seed, default 716): both sides of a --base run and every run of the probe start from the same
    // heroes, monsters and warm-up, and at --speeds 0 the frozen world is identical, so render costs compare exactly.
    // The seed stays on for the run; frame timing still makes worlds that run drift apart.
    if (${JSON.stringify(SEED)} !== 'off') { seedRng(${Number(SEED) | 0}); init({fellowship: false}); }
    const css = document.createElement('style'); css.textContent = '#setup, .ralert, #title { display: none !important; }'; document.head.appendChild(css);
    const base = S.agents.length, want = ${world === 'stepping' ? HEROES : 0};
    while (S.agents.length < want) { const a = makeHero(ri(0, 1), pickA(CLSN), null, rnd() * 3); a.lvl = ri(1, 12); a.hp = maxHp(a); }
    for (let i = 0; i < 1200; i++) step(.05); // one game hour of warm-up so the new heroes are out of town
    return {heroes: S.agents.length, base, mobs: S.mobs.length, npcs: (S.npcs || []).length};
  })()`);
}
async function setCamera(view, speed) {
  return evalJs(`(async () => {
    const {ctl, setView, select} = await import('/src/ui/controls.js'), {S} = await import('/src/sim/index.js');
    ctl.speed = ${speed};
    if (${JSON.stringify(view)} === 'night') { S.gameMin = (Math.floor(S.gameMin / 1440) + 1) * 1440 - 90; setView('map'); return 'whole map at 22:30'; }
    if (${JSON.stringify(view)} === 'follow') { const a = S.agents.filter(a => a.state !== 'dead' && !a.hidden && a.state !== 'town').sort((a, b) => a.id - b.id)[0] || S.agents[0]; select(a); setView('follow'); return a.name; }
    setView('map'); return 'whole map';
  })()`);
}
async function measure(seconds) {
  await evalJs(`(() => { const P = window.__perf; P.t.length = 0; P.w.length = 0; P.on = true; window.__drawPhases = {on: true, ms: new Float64Array(8), n: 0, t: 0}; })()`);
  await sleep(seconds * 1000);
  const d = await evalJs(`(() => { const P = window.__perf, D = window.__drawPhases; P.on = false; D.on = false; return {t: P.t.slice(), w: P.w.slice(), ph: [...D.ms], n: D.n}; })()`);
  const dt = []; for (let i = 1; i < d.t.length; i++) dt.push(d.t[i] - d.t[i - 1]);
  const vs = q(dt, .1) || 16.7; // the vsync interval as the page sees it
  const ph = d.ph.slice(0, 7).map(ms => Math.round(100 * ms / Math.max(1, d.n)) / 100), draw = ph.reduce((a, b) => a + b, 0);
  const work = d.w.reduce((a, b) => a + b, 0) / Math.max(1, d.w.length);
  const phases = Object.fromEntries(PHASES.map((k, i) => [k, ph[i]])); phases.draw = r2(draw); phases['sim+ui'] = r2(Math.max(0, work - draw));
  return {phases, frames: d.t.length, fps: r1(d.t.length / seconds), frameP50: r1(q(dt, .5)), frameP95: r1(q(dt, .95)), workP50: r1(q(d.w, .5)), workP95: r1(q(d.w, .95)),
    workOver: r1(100 * d.w.filter(x => x > 16.7).length / Math.max(1, d.w.length)), dropped: r1(100 * dt.filter(x => x > vs * 1.5).length / Math.max(1, dt.length)), vsync: r1(vs)};
}
// A sampled CPU profile of the page while it runs; self time per function and per source file, top entries.
async function profile(seconds) {
  await send('Profiler.setSamplingInterval', {interval: 200}); await send('Profiler.start'); await sleep(seconds * 1000);
  const {result} = await send('Profiler.stop'); const P = result.profile, byId = new Map(P.nodes.map(n => [n.id, n])), self = new Map();
  for (let i = 0; i < P.samples.length; i++) self.set(P.samples[i], (self.get(P.samples[i]) || 0) + (P.timeDeltas[i] || 0));
  const fn = new Map(), file = new Map(); let total = 0;
  for (const [nid, us] of self) { const n = byId.get(nid), cf = n.callFrame; total += us;
    if (cf.functionName === '(idle)' || cf.functionName === '(program)') continue;
    const f = (cf.url || '').replace(/^.*?\/src\//, 'src/').replace(/\?.*$/, '') || '(native)', k = `${cf.functionName || '(anon)'} ${f}:${cf.lineNumber + 1}`;
    fn.set(k, (fn.get(k) || 0) + us); file.set(f, (file.get(f) || 0) + us); }
  const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, us]) => ({k, ms: r1(us / 1000 / seconds), pct: r1(100 * us / total)}));
  return {fns: top(fn, 14), files: top(file, 10)};
}

const results = [], profiles = [];
try {
  const gpu = await evalJs(`(() => { const c = document.createElement('canvas').getContext('webgl'); const x = c && c.getExtension('WEBGL_debug_renderer_info'); return x ? c.getParameter(x.UNMASKED_RENDERER_WEBGL) : 'unknown'; })()`).catch(() => 'unknown');
  console.log(`perfprobe: ${BIN.split(/[\\/]/).pop()} at ${SW}x${SH}, ${SECONDS} s a run, ${SIDES.map(x => x.side + ' ' + x.url).join(', ')}, GPU ${gpu}`);
  for (const world of WORLDS) for (const {side, url} of SIDES) {
    const info = await bootWorld(url, world);
    console.log(`\n${world}${SIDES.length > 1 ? ' [' + side + ']' : ''}: ${info.heroes} heroes (${info.base} from the world), ${info.mobs} mobs, ${info.npcs} townsfolk`);
    for (const view of VIEWS) {
      for (const speed of SPEEDS) {
        const who = await setCamera(view, speed); await sleep(2500); // settle: the follow camera eases in, chunks in view get painted
        const m = await measure(SECONDS); results.push({side, world, view, speed, who, heroes: info.heroes, mobs: info.mobs, ...m});
        console.log(`  ${view.padEnd(6)} ${speed}x  frame p50 ${m.frameP50} p95 ${m.frameP95} ms | work p50 ${m.workP50} p95 ${m.workP95} ms | ${m.fps} fps | work > 16.7 ms ${m.workOver}% | dropped ${m.dropped}%`);
        console.log('           mean ms a frame: ' + Object.entries(m.phases).map(([k, v]) => `${k} ${v}`).join(', '));
      }
      if (PROFILE && side === 'head') { await setCamera(view, Math.max(...SPEEDS)); await sleep(1000); const p = await profile(Math.min(6, SECONDS)); profiles.push({world, view, speed: Math.max(...SPEEDS), ...p});
        console.log(`    profile ${view} ${Math.max(...SPEEDS)}x, self ms per real second: ` + p.files.slice(0, 6).map(f => `${f.k} ${f.ms}`).join(', '));
        console.log('      ' + p.fns.slice(0, 6).map(f => `${f.k} ${f.ms}`).join('\n      ')); }
    }
  }
} catch (e) { console.error('probe failed: ' + e.message); await cleanup(); process.exit(2); }
await cleanup();

// Markdown tables for a PR or an issue comment. A checkout without the phase timer (older main) reads all zeros: shown as -.
const two = SIDES.length > 1, sc = r => two ? ` ${r.side} |` : '', sh = two ? ' side |' : '', sd = two ? ' --- |' : '';
console.log(`\n| world | camera | speed |${sh} heroes | frame p50 | frame p95 | work p50 | work p95 | fps | work > 16.7 ms | dropped |`);
console.log(`| --- | --- | --- |${sd} --- | --- | --- | --- | --- | --- | --- | --- |`);
for (const r of results) console.log(`| ${r.world} | ${r.view} | ${r.speed}x |${sc(r)} ${r.heroes} | ${r.frameP50} | ${r.frameP95} | ${r.workP50} | ${r.workP95} | ${r.fps} | ${r.workOver}% | ${r.dropped}% |`);
const COLS = [...PHASES, 'draw', 'sim+ui'];
console.log(`\nRender phases, mean ms a frame (draw.js phase timer; sim+ui = callback work minus draw):\n| world | camera | speed |${sh} ${COLS.join(' | ')} |`);
console.log(`| --- | --- | --- |${sd}${COLS.map(() => ' --- |').join('')}`);
for (const r of results) { const none = !r.phases.draw; console.log(`| ${r.world} | ${r.view} | ${r.speed}x |${sc(r)} ${COLS.map(k => none ? '-' : r.phases[k]).join(' | ')} |`); }
if (JSON_OUT) { mkdirSync(dirname(resolve(JSON_OUT)), {recursive: true}); writeFileSync(resolve(JSON_OUT), JSON.stringify({size: [SW, SH], seconds: SECONDS, results, profiles}, null, 2)); }
const bad = results.filter(r => r.frameP95 > P95_MAX);
if (bad.length) console.log(`\n${bad.length} run(s) with p95 frame time over ${P95_MAX} ms` + (STRICT ? ' (PERF_STRICT=1: failing)' : ' (report only; PERF_STRICT=1 fails on it)'));
process.exit(STRICT && bad.length ? 1 : 0);
