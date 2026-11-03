// hashcheck (issue #573): the one source of the seeded hashes that PRs quote ("the scripted world is unchanged").
// Runs every seeded determinism probe, prints a table, and (by default) extracts `git archive <ref>` (default
// origin/main) into a temp dir (never a worktree), runs the same probes there and compares.
// Usage: npm run hashcheck [-- --against origin/main] [--md FILE] [--json FILE] [--only a,b] [--no-compare]
// Exit: 0 all equal (or no comparison), 2 at least one hash moved, 1 a probe failed to run.
// Probes that need no flag of their own live in this file (company, world); the rest call the check scripts' own
// hash modes (professioncheck --hash, tablecheck --hash/--hash-talk, crawlcheck --hash, dmcheck --hash, focuscheck --hash).
// This file is copied into the extracted base, so both sides run the same probe code against their own src/.
import {spawn, spawnSync} from 'node:child_process';
import {mkdtempSync, copyFileSync, writeFileSync, mkdirSync, symlinkSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)), ME = fileURLToPath(import.meta.url);
const argv = process.argv.slice(2), opt = (n, d) => {const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d};
const imp = rel => import(pathToFileURL(join(HERE, rel)).href);

// ---- in-file child probes ----
if (argv[0] === '--child') {
  const which = argv[1];
  let seed = 0x573a;
  Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
  if (which === 'world') {
    const {ELDMOOR} = await imp('../src/world/spec.js'), {buildWorld} = await imp('../src/world/gen.js');
    const fnv = a => {let h = 0x811c9dc5; for (let i = 0; i < a.length; i++) {h ^= a[i]; h = Math.imul(h, 16777619) >>> 0} return h.toString(16).padStart(8, '0')};
    const w = buildWorld(ELDMOOR); console.log('HASH zone ' + fnv(w.zone) + ' tiles ' + fnv(w.tiles)); process.exit(0);
  }
  if (which === 'company') { // no company ever formed: a seeded world with the company module loaded, hashed
    const SIM = await imp('../src/sim/index.js'); await imp('../src/sim/company.js');
    SIM.init({fellowship: false}); for (let i = 0; i < 600 * 60; i++) SIM.step(1 / 60);
    let h = 5381; const feed = s => {for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0};
    for (const a of SIM.S.agents) feed([a.id, a.lvl, a.xp, a.kills, a.gold, a.state, a.x.toFixed(2), a.y.toFixed(2), a.hp.toFixed(1)].join(','));
    console.log('HASH ' + h); process.exit(0);
  }
  console.error('unknown child ' + which); process.exit(1);
}

const lines = rx => out => out.split(/\r?\n/).filter(l => rx.test(l)).map(l => l.trim()).join(' | ') || null;
const PROBES = [
  {id: 'professioncheck (with and without Fellowship)', args: ['scripts/professioncheck.mjs', '--hash'], read: lines(/^hash fellowship=/)},
  {id: 'tablecheck --hash', args: ['scripts/tablecheck.mjs', '--hash'], read: lines(/^HASH /)},
  {id: 'tablecheck --hash-talk', args: ['scripts/tablecheck.mjs', '--hash-talk'], read: lines(/^HASH /)},
  {id: 'crawlcheck --hash', args: ['scripts/crawlcheck.mjs', '--hash'], read: lines(/^HASH /)},
  {id: 'dmcheck (seat closed)', args: ['scripts/dmcheck.mjs', '--hash', 'none'], read: lines(/^HASH /)},
  {id: 'dmcheck (seat open)', args: ['scripts/dmcheck.mjs', '--hash', 'seat'], read: lines(/^HASH /)},
  {id: 'focuscheck --hash', args: ['scripts/focuscheck.mjs', '--hash'], read: out => {
    const l = out.split(/\r?\n/).find(x => x.startsWith('{')); if (!l) return null;
    try {const j = JSON.parse(l); return 'hash ' + j.hash + ' guilds ' + j.guilds + ' focused ' + j.focused} catch { return null }}},
  {id: 'companycheck (no company)', args: ['scripts/hashcheck.mjs', '--child', 'company'], read: lines(/^HASH /)},
  {id: 'worldcheck (Eldmoor map)', args: ['scripts/hashcheck.mjs', '--child', 'world'], read: lines(/^HASH /)},
];
const only = opt('--only') ? opt('--only').split(',') : null;
const probes = PROBES.filter(p => !only || only.some(o => p.id.includes(o)));

function runProbe(root, p) {
  return new Promise(res => {
    const t0 = Date.now(), c = spawn(process.execPath, p.args, {cwd: root, env: {...process.env, CRAWL_BASELINE_HASH: ''}, stdio: ['ignore', 'pipe', 'pipe']});
    let out = '', err = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d);
    const timer = setTimeout(() => c.kill(), 600000);
    c.on('close', code => {clearTimeout(timer); res({id: p.id, hash: p.read(out), code, ms: Date.now() - t0, err: err.slice(-300)})});
  });
}
async function runAll(root) {
  const out = [], queue = probes.slice(), N = Math.max(1, Math.min(4, Number(process.env.HASHCHECK_JOBS) || 4));
  await Promise.all(Array.from({length: N}, async () => {for (let p; (p = queue.shift());) out.push(await runProbe(root, p))}));
  return probes.map(p => out.find(o => o.id === p.id));
}

const ROOT = resolve(HERE, '..'), ref = opt('--against', 'origin/main');
let baseRoot = null;
if (!argv.includes('--no-compare')) {
  const dir = mkdtempSync(join(tmpdir(), 'eldmoor-base-'));
  const a = spawnSync('git', ['archive', ref], {cwd: ROOT, maxBuffer: 1 << 30});
  if (a.status !== 0) {console.error('git archive ' + ref + ' failed: ' + String(a.stderr)); process.exit(1)}
  const t = spawnSync('tar', ['-x'], {cwd: dir, input: a.stdout, maxBuffer: 1 << 30});
  if (t.status !== 0) {console.error('tar failed: ' + String(t.stderr)); process.exit(1)}
  mkdirSync(join(dir, 'scripts'), {recursive: true}); copyFileSync(ME, join(dir, 'scripts/hashcheck.mjs'));
  // the base probes only read node_modules (a junction in the temp dir; the worktree is never touched)
  if (existsSync(join(ROOT, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'junction');
  baseRoot = dir;
}
const [head, base] = await Promise.all([runAll(ROOT), baseRoot ? runAll(baseRoot) : Promise.resolve(null)]);

let moved = 0, broke = 0;
const rows = head.map((h, i) => {
  const b = base && base[i], bad = !h.hash, badBase = base && !b.hash;
  if (bad) broke++;
  const same = base && !bad && !badBase && h.hash === b.hash;
  const status = bad ? 'ERROR' : !base ? '' : badBase ? 'no base' : same ? 'same' : 'MOVED';
  if (status === 'MOVED') moved++;
  return {id: h.id, head: h.hash || ('(no hash, exit ' + h.code + ') ' + h.err.replace(/\s+/g, ' ')), base: b ? (b.hash || ('(none, exit ' + b.code + ') ' + b.err.replace(/\s+/g, ' ').slice(-120))) : '', status, ms: h.ms};
});
const md = ['| Probe | This branch | ' + ref + ' | |', '| --- | --- | --- | --- |',
  ...rows.map(r => `| ${r.id} | \`${r.head}\` | ${base ? '`' + r.base + '`' : ''} | ${r.status} |`)].join('\n');
console.log(md);
const verdict = moved ? `${moved} hash(es) moved against ${ref}.` : base ? `All hashes equal ${ref}.` : '';
console.log('\n' + verdict);
if (opt('--md')) writeFileSync(opt('--md'), '### Seeded hashes (hashcheck)\n\n' + md + '\n\n' + (moved ? `**${moved} moved** against \`${ref}\`. A merge needs the \`hash-change-ok\` label.` : verdict) + '\n');
if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify({ref, rows, moved, broke}, null, 1));
process.exit(broke ? 1 : moved ? 2 : 0);
