// Screenshot driver for UI and render PRs (issue #574): headless Chrome (or Edge) over the DevTools protocol against a
// served build (CI: `vite preview`; locally any URL). Opens the title screen, boots the game, dismisses the setup page and the
// start gate by clicking buttons by their text, runs the world briefly at 8x, then captures views at 3440x1440 (the owner's
// screen) and one at 1280x800 for layout sanity. Needs no key, no relay, no network beyond the URL.
//   node scripts/shoot.mjs <url> <outDir> [--sizes 3440x1440,1280x800] [--run-seconds 10]
// Writes <outDir>/title-3440.png, default-3440.png, follow-3440.png, bottom-3440.png, default-1280.png and shots.json (names,
// sizes, notes). A view that cannot be reached is noted in shots.json, never a crash: the job is a look, not a gate.
// CHROME_PATH picks the browser; CI passes --no-sandbox through CHROME_NO_SANDBOX=1.
import {spawn} from 'node:child_process';
import {writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {createRequire} from 'node:module';
const WebSocket = createRequire(import.meta.url)('ws');
const argv = process.argv.slice(2), pos = argv.filter(a => !a.startsWith('--') && !/^\d+x\d+(,|$)/.test(a));
const flagv = n => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : null; };
const url = pos[0], OUT = resolve(pos[1] || 'shots');
if (!url) { console.error('usage: node scripts/shoot.mjs <url> <outDir> [--sizes WxH,WxH] [--run-seconds N]'); process.exit(2); }
const SIZES = (flagv('sizes') || '3440x1440,1280x800').split(',').map(s => s.split('x').map(Number)), RUN_S = Number(flagv('run-seconds') || 10);
const CANDIDATES = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
const BIN = CANDIDATES.find(p => existsSync(p));
if (!BIN) { console.error('no Chrome or Edge found; set CHROME_PATH'); process.exit(2); }
mkdirSync(OUT, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const notes = [], shots = [];

async function session(w, h) {
  const port = 9333 + Math.floor(Math.random() * 500), prof = join(OUT, `prof-${port}`);
  const flags = ['--hide-scrollbars', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    ...(process.env.CHROME_NO_SANDBOX ? ['--no-sandbox'] : []), `--window-size=${w},${h}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${prof}`];
  let err = '', proc = null;
  const launch = mode => { err = ''; proc = spawn(BIN, [mode, ...flags, 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']}); proc.stderr.on('data', d => { err = (err + d).slice(-2000); }); };
  const json = async p => { for (let i = 0; i < 160; i++) { if (proc.exitCode !== null) break; try { return await (await fetch(`http://127.0.0.1:${port}${p}`)).json(); } catch { await sleep(250); } } throw new Error(`no devtools on ${port} (${BIN}, exit ${proc.exitCode}): ${err.trim().slice(-600)}`); };
  launch('--headless=new');
  let page; try { page = (await json('/json')).find(t => t.type === 'page'); } catch (e) { console.error(e.message + ' - retrying with --headless'); try { proc.kill(); } catch {} await sleep(500); launch('--headless'); page = (await json('/json')).find(t => t.type === 'page'); }
  const ws = new WebSocket(page.webSocketDebuggerUrl, {perMessageDeflate: false});
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  let id = 0; const pending = new Map();
  ws.on('message', m => { const d = JSON.parse(m); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({id: i, method, params})); });
  const evalJs = async expr => (await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true})).result?.result?.value;
  const clickText = (re, tag = 'button') => evalJs(`(() => { const b = [...document.querySelectorAll('${tag}')].find(b => ${re}.test(b.textContent.trim()) && b.offsetParent !== null); if (b) { b.click(); return true; } return false; })()`);
  const shot = async name => { const r = await send('Page.captureScreenshot', {format: 'png'}); writeFileSync(join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64')); shots.push({name, w, h}); console.log('wrote', name); };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {width: w, height: h, deviceScaleFactor: 1, mobile: false});
  return {send, evalJs, clickText, shot, close: () => { try { ws.close(); } catch {} proc.kill(); }};
}
const withQuery = (u, q) => u + (u.includes('?') ? '&' : '?') + q;

async function boot(s, startUrl) {
  await s.send('Page.navigate', {url: startUrl}); await sleep(4000);
  if (await s.clickText(/Play the default world/i)) notes.push('setup page dismissed');
  await sleep(2500);
  if (await s.clickText(/Start anyway/i)) notes.push('start gate waived');
  await s.clickText(/^8x$/); await sleep(RUN_S * 1000); await s.clickText(/^1x$/); await sleep(1500);
}

for (const [w, h] of SIZES) {
  const s = await session(w, h);
  try {
    if (w === SIZES[0][0]) { // the title screen, once, at the first size
      await s.send('Page.navigate', {url: url.split('?')[0]}); await sleep(3000); await s.shot(`title-${w}`);
    }
    await boot(s, withQuery(url, 'skip-title=1'));
    await s.shot(`default-${w}`);
    if (w === SIZES[0][0]) {
      notes.push(await s.clickText(/^Fellowship$/i) ? 'follow view clicked' : 'no Fellowship view button');
      await sleep(2500); await s.shot(`follow-${w}`);
      await s.evalJs('window.scrollTo(0, document.body.scrollHeight)'); await sleep(1000); await s.shot(`bottom-${w}`);
      notes.push(await s.evalJs(`JSON.stringify({scrollH: document.body.scrollHeight, panels: document.querySelectorAll('section.panel').length, visibleButtons: [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null).length})`));
    }
  } catch (e) { notes.push(`${w}x${h} failed: ${e.message}`); console.error(e.message); }
  s.close(); await sleep(500);
}
writeFileSync(join(OUT, 'shots.json'), JSON.stringify({url, shots, notes}, null, 2));
console.log(`${shots.length} screenshots in ${OUT}`);
process.exit(shots.length ? 0 : 1);
