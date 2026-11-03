// Request-rate check (issue #117). A Fellowship with relay minds runs at 8x for several game days
// against an in-process counting relay (brain.setFetch, no network). Each phase is its own child
// process (the sim keeps its state in module singletons). Proves:
//   - the request rate stays under a bound per minute of play (wall-clock at 8x);
//   - memory summaries are at most one per member per game day;
//   - enrichment is asked once per member at founding, never for written sheets, never on restore;
//   - when the relay answers 429 every writing kind backs off (gaps never below the first backoff)
//     and the writing requests stay bounded;
//   - failures are recorded for the UI (requests per minute, recent failures);
//   - the scripted path is deterministic with a dead relay.
// Usage: npm run ratecheck     (RATE_BOUND=n to change the bound; --count prints the healthy run only)
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const DAYS = 6, SPEED = 8, DAY_SIM = 240; // one game day is 240 sim seconds
const phase = process.argv[2] === '--phase' ? process.argv[3] : null;

if (phase) {
  const reseed = n => {let s = n >>> 0; Math.random = () => {s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296}};
  reseed(phase === 'fp' ? 0xabc : 0x117a);
  const SIM = await import('../src/sim/index.js');
  const SLT = await import('../src/sim/company.js'); // the slotted company (#588)
  const B = await import('../src/sim/brain.js');
  const T = await import('../src/sim/throttle.js').catch(() => null); // absent on code from before #117 (for before/after counts)
  const FEL = await import('../src/sim/company.js');
  const {init, step, S, found, autoPick, snapshot, restore, TABLE, fellowshipMembers} = SIM;
  const yieldLoop = () => new Promise(r => setImmediate(r));
  let simSec = 0, log = [];
  const mode = phase === '429' ? '429' : 'ok';
  B.setFetch(async (url, opts) => {
    const body = JSON.parse(opts.body), kind = body.kind, sn = body.snapshot || {};
    log.push([kind, sn.name || sn.hero || '?', Math.floor(S.gameMin / 1440) + 1, simSec]);
    if (mode === '429') return {ok: false, status: 429, json: async () => ({error: 'rate limited (429)'})};
    const j = kind === 'memory' ? {long: 'They rode out together and came back.', usage: {in: 600, out: 40, cost: .0001}}
      : kind === 'say' ? {line: 'Steady now.'}
      : kind === 'persona' || kind === 'backstory' ? {}
      : {choice: (sn.options && sn.options[0]) || null, crypt: false, reason: 'ok'};
    return {ok: true, status: 200, json: async () => j};
  });
  const play = async (days, speed) => {TABLE.speed = speed; const n = Math.round(days * DAY_SIM * 60);
    for (let i = 0; i < n; i++) {step(1 / 60); simSec += 1 / 60; if (i % 20 === 0) await yieldLoop()} await yieldLoop()};
  TABLE.speed = 1; init({fellowship: false});
  for (let i = 0; i < 1200 * 60; i++) step(1 / 60); // the old start (as campcheck does)
  const out = {};
  if (phase === 'fp') {
    SLT.foundSlots(SLT.autoPick(0), {ai: false});
    for (let i = 0; i < 600 * 60; i++) step(1 / 60);
    out.fp = JSON.stringify(S.agents.map(a => [a.id, a.state, a.lvl, a.xp, Math.round(a.x * 100), Math.round(a.y * 100), a.deaths, a.kills, a.gold]));
  } else {
    log = []; simSec = 0; B.resetBrain();
    if (!SLT.foundSlots(SLT.autoPick(0), {ai: true}).ok) throw new Error('found failed');
    await yieldLoop();
    out.found = log.length;
    await play(DAYS, SPEED);
    out.past = SLT.slotted() ? SLT.slotted().past.length : 0; // members lost and replaced in the run (each replacement is a new member and is enriched once)
    out.sim = simSec; out.log = log; out.totals = T ? JSON.parse(JSON.stringify(T.totals)) : {sent: log.length, failed: 0}; out.rpm = T ? T.rpm() : 0; out.fails = T ? T.recentFailures() : []; // totals copied: the restore phase below may send more (the live object would count those too)
    if (phase === 'ok') {
      const snap = JSON.parse(JSON.stringify(snapshot()));
      log = []; restore(snap); await play(0.02, SPEED);
      out.restoreSent = log.length;
      out.restoreSheets = log.filter(e => e[0] === 'persona' || e[0] === 'backstory').length;
      const m0 = SLT.slotMembers(SLT.slotted())[0].hero;
      m0.persona = {...(m0.persona || {}), src: 'model'}; m0.backstory = {...(m0.backstory || {}), src: 'model'};
      log = []; out.reask = SLT.enrich(SLT.slotted(), m0) !== false || log.length > 0;
    }
  }
  console.log('RESULT ' + JSON.stringify(out));
  process.exit(0);
}

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
// The phases are independent processes: all four start at once (CI runners have several cores), each awaited where it is read.
const phases = {};
const run = p => phases[p] || (phases[p] = new Promise((res, rej) => {
  const k = spawn(process.execPath, [fileURLToPath(import.meta.url), '--phase', p.replace(/2$/, '')], {stdio: ['ignore', 'pipe', 'pipe']}); let out = '', err = '';
  k.stdout.on('data', d => out += d); k.stderr.on('data', d => err += d);
  k.on('close', () => {const line = out.split(String.fromCharCode(10)).find(l => l.startsWith('RESULT ')); if (!line) {console.error(err || out); rej(new Error('phase ' + p + ' failed'))} else res(JSON.parse(line.slice(7)))})}));
for (const p of ['ok', '429', 'fp', 'fp2']) run(p).catch(() => {});
const by = l => {const o = {}; for (const e of l) o[e[0]] = (o[e[0]] || 0) + 1; return o};
const BOUND = +process.env.RATE_BOUND || 30;

console.log('healthy relay, ' + DAYS + ' game days at ' + SPEED + 'x');
const h = await run('ok'), mins = h.sim / SPEED / 60, rate = h.log.length / mins, k = by(h.log);
console.log('  requests ' + h.log.length + ' in ' + mins.toFixed(1) + ' min of play -> ' + rate.toFixed(1) + '/min', JSON.stringify(k), '(founding burst ' + h.found + ')');
if (process.argv.includes('--count')) process.exit(0);
ok(rate <= BOUND, 'request rate ' + rate.toFixed(1) + '/min stays under ' + BOUND + '/min');
const mk = {}; for (const e of h.log) if (e[0] === 'memory') mk[e[1] + '|' + e[2]] = (mk[e[1] + '|' + e[2]] || 0) + 1;
ok(Math.max(0, ...Object.values(mk)) <= 1, 'at most one memory summary per member per game day (' + (k.memory || 0) + ' sent)');
ok((k.say || 0) <= Math.ceil(h.sim / SPEED / 3), 'chatter stays under the global say cap (' + (k.say || 0) + ' say requests)');
const MEM = 5 + (h.past || 0); // the five founders plus one per replacement; a crypt wipe or a fall in the run is dice, not a bug
ok((k.persona || 0) <= MEM && (k.backstory || 0) <= MEM, 'enrichment asked once per member (' + (k.persona || 0) + ' personas, ' + (k.backstory || 0) + ' backstories, ' + MEM + ' members over the run)');
ok(h.restoreSheets === 0, 'a restore sends no persona or backstory request');
ok(h.reask === false, 'a member with written sheets is not asked again');
ok(h.totals.sent === h.log.length && h.rpm >= 0, 'the throttle counts every request (' + h.totals.sent + ')');

console.log('relay answering 429');
const f = await run('429'), fk = by(f.log), fr = f.log.length / (f.sim / SPEED / 60);
console.log('  requests ' + f.log.length + ' -> ' + fr.toFixed(1) + '/min', JSON.stringify(fk));
ok(fr <= BOUND, 'failing relay: rate ' + fr.toFixed(1) + '/min under the bound');
const last = {}, gaps = {}; let minGap = 1e9;
for (const e of f.log) if (['persona', 'backstory', 'memory'].includes(e[0])) {
  const key = e[0] + '|' + e[1], t = e[3] / SPEED;
  if (last[key] != null) {minGap = Math.min(minGap, t - last[key]); (gaps[key] || (gaps[key] = [])).push(t - last[key])}
  last[key] = t}
ok(minGap >= 14, 'writing kinds wait at least the first backoff after a failure (shortest gap ' + (minGap > 1e8 ? 'n/a' : minGap.toFixed(1) + ' s') + ' of play)');
const wr = (fk.memory || 0) + (fk.persona || 0) + (fk.backstory || 0);
ok(wr < (k.memory || 0) + (k.persona || 0) + (k.backstory || 0), 'failing relay sends fewer writing requests than a healthy one');
ok(wr <= 5 * (DAYS + 2), 'failing relay: writing requests stay bounded (' + wr + ')');
ok(f.totals.failed > 0 && f.fails.length > 0 && /429/.test(f.fails[0].why), 'failures are recorded for the UI (' + f.totals.failed + ' failed, last: ' + (f.fails[0] ? f.fails[0].why : '-') + ')');

console.log('determinism');
ok((await run('fp')).fp === (await run('fp2')).fp, 'two scripted runs match');
console.log(fail ? fail + ' check(s) FAILED' : 'ratecheck passed');
process.exit(fail ? 1 : 0);
