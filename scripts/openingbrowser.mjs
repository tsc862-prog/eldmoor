// Headless Chrome check of the setup page's Opening field (issue #922 follow-up): the page's own New world flow at 3440x1440, once with the
// default ("A first delve") and once with "Straight to the hall". The default must stand the company at the mouth of a dungeon (a Chronicle line,
// the session-zero scene framed there); the other must open session zero in the hall with no dungeon raised. No key, no relay, no network beyond
// the URL; the start gate is waived with Start anyway. Not in CI (it needs a browser and a served page): run it for PRs that touch the Opening.
//   node scripts/openingbrowser.mjs <url> [outDir]       (a `vite` dev server or `vite preview`; CHROME_PATH picks the browser)
import {spawn} from 'node:child_process';
import {writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {createRequire} from 'node:module';
const WebSocket = createRequire(import.meta.url)('ws');
const url = process.argv[2], OUT = resolve(process.argv[3] || 'logs/opening-shots');
if (!url) { console.error('usage: node scripts/openingbrowser.mjs <url> [outDir]'); process.exit(2); }
const BIN = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(p => existsSync(p));
if (!BIN) { console.error('no Chrome or Edge found; set CHROME_PATH'); process.exit(2); }
mkdirSync(OUT, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };

async function session(tag, w = 3440, h = 1440) {
  const port = 9600 + Math.floor(Math.random() * 300), prof = join(OUT, 'prof-' + tag + '-' + Date.now()); // a fresh profile every run: a saved world would put Continue first
  const flags = ['--hide-scrollbars', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', ...(process.env.CHROME_NO_SANDBOX ? ['--no-sandbox'] : []),
    `--window-size=${w},${h}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${prof}`];
  const proc = spawn(BIN, ['--headless=new', ...flags, 'about:blank'], {stdio: 'ignore'});
  let page = null;
  for (let i = 0; i < 120 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch { await sleep(250); } }
  if (!page) { proc.kill(); throw new Error('Chrome did not start'); }
  const ws = new WebSocket(page.webSocketDebuggerUrl, {perMessageDeflate: false});
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  let id = 0; const pending = new Map();
  ws.on('message', m => { const d = JSON.parse(m); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({id: i, method, params})); });
  const js = async expr => (await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true})).result?.result?.value;
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {width: w, height: h, deviceScaleFactor: 1, mobile: false});
  const click = (sel, re) => js(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find(b => ${re || '/./'}.test(b.textContent.trim()) && b.offsetParent !== null); if (b) { b.click(); return true; } return false; })()`);
  const shot = async name => { const r = await send('Page.captureScreenshot', {format: 'png'}); writeFileSync(join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64')); };
  const text = () => js('document.body.innerText');
  return {send, js, click, shot, text, close: () => { try { ws.close(); } catch {} proc.kill(); }};
}

// Plays the New world flow with the Opening select left alone or set; returns what the page shows once the world runs.
async function play(tag, opening) {
  const s = await session(tag);
  try {
    await s.send('Page.navigate', {url});
    let nw = 'none'; for (let i = 0; i < 40 && nw === 'none'; i++) { nw = await s.js("(() => { const b = document.querySelector('button[data-a=new]'); if (!b) return 'none'; b.click(); return b.textContent + '|' + document.querySelectorAll('[id]').length; })()"); if (nw === 'none') await sleep(500); } if (nw === 'none') { await s.shot(tag + '-notitle'); console.log((await s.text()).slice(0, 300)); } ok(nw !== 'none', tag + ': the title offers New world (' + nw + ')');
    await sleep(4000);
    const sel = await s.js(`(() => { const s = document.querySelector('select[data-f="prologue"]'); return s ? {value: s.value, w: s.getBoundingClientRect().width, shown: s.offsetParent !== null, opts: [...s.options].map(o => o.value + ':' + o.text)} : null; })()`);
    ok(sel && sel.shown && sel.value === 'delve' && sel.opts.join('|') === 'delve:A first delve|none:Straight to the hall', tag + ': the setup page shows Opening, on "A first delve" by default (' + JSON.stringify(sel) + ')');
    await s.shot(tag + '-setup');
    if (opening) {
      await s.js(`(() => { const s = document.querySelector('select[data-f="prologue"]'); s.value = ${JSON.stringify(opening)}; s.dispatchEvent(new Event('change', {bubbles: true})); })()`); await sleep(400);
      ok(await s.js(`document.querySelector('select[data-f="prologue"]').value`) === opening, tag + ': the choice stays on the page');
    }
    ok(await s.click('button[data-a="start"]'), tag + ': Start'); await sleep(5000);
    const pend = await s.js('localStorage.getItem("eldmoor.setup.pending")'); // consumed once the world is built; present only if the reload has not happened
    if (pend) ok(false, tag + ': the queued setup was not taken up');
    for (let i = 0; i < 12; i++) { if (await s.click('button', '/Start anyway/i')) break; await sleep(1500); }
    await sleep(2500); await s.click('button', '/^1x$/'); await sleep(10000);
    const t = await s.text(); await s.shot(tag + '-world');
    return {t, s};
  } catch (e) { s.close(); throw e; }
}

const a = await play('default', null);
const mouth = /stands at the mouth of/.test(a.t), session0 = /SESSION ZERO/i.test(a.t), shortWalk = /short walk from/.test(a.t);
ok(session0, 'default: session zero is on the table'); ok(mouth || shortWalk, 'default: the company stands at a dungeon\'s mouth (Chronicle line "stands at the mouth of" or the frame "short walk from"): mouth=' + mouth + ' frame=' + shortWalk);
a.s.close();
const b = await play('none', 'none');
ok(/SESSION ZERO/i.test(b.t), 'straight to the hall: session zero is on the table');
ok(!/stands at the mouth of/.test(b.t) && !/short walk from/.test(b.t), 'straight to the hall: no dungeon is raised and nothing is said of a mouth');
b.s.close();
console.log(fails ? `openingbrowser: ${fails} failed` : 'openingbrowser: ok'); process.exit(fails ? 1 : 0);
