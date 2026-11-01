// Save/load check: runs the real sim, snapshots it, round-trips the snapshot through
// JSON.stringify, restores it both over the same (dirtied) state and into a pristine
// module state in a child process, and asserts that nothing throws, that the world keeps
// running and that snapshot() after restore deep-equals the one before.
// Usage: npm run savecheck
// Internal: node scripts/savecheck.mjs --restore <file>   (the child phase)
import {writeFileSync, readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {init, step, S, snapshot, restore, isSave} from '../src/sim/index.js';
import {GOODS} from '../src/data/items.js';
import {CRYPT} from '../src/world/map.js';

const RUN_MIN = 20, DIRTY_MIN = 2, MORE_MIN = 10, TWO_DAYS_MIN = 8; // real minutes at 1x; a game-day is 4
let fail = 0;
const ok = (cond, msg) => {if (cond) console.log('  ok   ' + msg); else {console.error('  FAIL ' + msg); fail++}};
const run = (min) => {const frames = min * 60 * 60; for (let i = 0; i < frames; i++) step(1 / 60)};
const kb = (s) => (s.length / 1024).toFixed(0) + ' KB';

// Order-insensitive deep equality that also treats a missing key like undefined (what JSON does).
function diff(a, b, path = '$') {
  if (a === b) return null;
  if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) return null;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array vs object`;
  if (Array.isArray(a)) {if (a.length !== b.length) return `${path}: length ${a.length} != ${b.length}`;
    for (let i = 0; i < a.length; i++) {const d = diff(a[i], b[i], `${path}[${i}]`); if (d) return d} return null}
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {const d = diff(a[k], b[k], `${path}.${k}`); if (d) return d}
  return null;
}
// Nothing in a snapshot may be a function, a NaN/Infinity, a DOM object or a live entity (ids only).
function scan(v, path = '$', seen = new Set()) {
  if (v === null) return; const t = typeof v;
  if (t === 'function') throw new Error(`function at ${path}`);
  if (t === 'number' && !Number.isFinite(v)) throw new Error(`non-finite number at ${path}`);
  if (t !== 'object') return;
  if (seen.has(v)) throw new Error(`shared or cyclic object at ${path}`); seen.add(v);
  if (v.kind === 'hero' || v.kind === 'mob') {const home = path.startsWith('$.agents[') || path.startsWith('$.mobs['); if (!home || path.split('[').length > 2) throw new Error(`live ${v.kind} object at ${path}`)}
  if (typeof v.getContext === 'function' || v.nodeType) throw new Error(`DOM object at ${path}`);
  for (const k in v) scan(v[k], Array.isArray(v) ? `${path}[${k}]` : `${path}.${k}`, seen);
}
function sane(label) {
  const alive = S.agents.filter((a) => a.state !== 'dead');
  ok(alive.length >= 20 && alive.length <= 60, `${label}: ${alive.length} living heroes (${S.agents.length} entries incl. graves)`);
  ok(S.mobs.length > 50 && S.mobs.every((m) => typeof m.x === 'number'), `${label}: ${S.mobs.length} mobs`);
  ok(S.parties.every((p) => p.mem.length >= 2 && p.mem.every((a) => a.party === p) && p.mem.includes(p.leader)), `${label}: ${S.parties.length} parties consistent`);
  ok(Array.isArray(S.encounters) && S.encounters.every((e) => !e.escort || e.escort.pilgrim === e), `${label}: ${S.encounters.length} encounters consistent`);
  ok(S.chronicle.length > 0 && S.chronicle.length <= 90, `${label}: chronicle ${S.chronicle.length} lines`);
  ok(S.agents.every((a) => a.guild && S.GUILDS.includes(a.guild)), `${label}: every hero's guild is a GUILDS entry`);
  ok(S.agents.every((a) => !a.target || a.target.kind), `${label}: hero targets are entities`);
  ok(S.recruits.every((r) => S.GUILDS.includes(r.guild)), `${label}: ${S.recruits.length} recruits linked to guilds`);
}

const args = process.argv.slice(2);
if (args[0] === '--restore') {
  // ---- child phase: pristine module state, never init()'d ----
  const snap = JSON.parse(readFileSync(args[1], 'utf8'));
  const before = S.gameMin;
  restore(snap);
  ok(S.gameMin === snap.gameMin && S.gameMin !== before, `child: clock restored to ${S.gameMin} game-min (fresh state was ${before})`);
  const again = snapshot(); scan(again);
  const d = diff(snap, again); ok(!d, 'child: snapshot() after restore into a pristine state deep-equals the file' + (d ? ' -- ' + d : ''));
  sane('child after restore');
  run(MORE_MIN);
  ok(S.gameMin > snap.gameMin + MORE_MIN * 60 * 6 - 1, `child: world ran ${MORE_MIN} more minutes to game-min ${Math.round(S.gameMin)}`);
  sane(`child after ${MORE_MIN} more minutes`);
  const chron = S.chronicle.filter((e) => e.parts.every((p) => typeof p !== 'object' || p === null || p.kind === 'hero' ? true : typeof p.t === 'string'));
  ok(chron.length === S.chronicle.length, 'child: chronicle parts are strings, heroes or {t,c} spans');
  process.exit(fail ? 1 : 0);
}

// ---- main phase ----
console.log(`\nEldmoor savecheck: ${RUN_MIN} min, snapshot, round-trip, restore, ${MORE_MIN} more\n`);
init();
run(TWO_DAYS_MIN);
const twoDays = JSON.stringify(snapshot());
console.log(`  size after ${TWO_DAYS_MIN} min (2 game-days): ${kb(twoDays)}`);
ok(twoDays.length < 1.5 * 1024 * 1024, 'two-day save is under 1.5 MB');
run(RUN_MIN - TWO_DAYS_MIN);
sane(`after ${RUN_MIN} minutes`);

let A;
try {A = snapshot(); scan(A); ok(true, 'snapshot() walks clean: no functions, canvases, NaN or live entity objects')} catch (e) {ok(false, 'snapshot(): ' + e.message); process.exit(1)}
ok(isSave(A), 'snapshot is recognised by isSave()');
const json = JSON.stringify(A);
console.log(`  size after ${RUN_MIN} min (${(RUN_MIN / 4).toFixed(1)} game-days): ${kb(json)}; ${A.agents.length} heroes, ${A.mobs.length} mobs, ${A.parties.length} parties, ${(A.encounters || []).length} encounters, ${A.chronicle.length} chronicle lines`);
const A2 = JSON.parse(json);
const d0 = diff(A, A2); ok(!d0, 'JSON round-trip is lossless' + (d0 ? ' -- ' + d0 : ''));
const refs = JSON.stringify(A2).match(/"ref":"(hero|mob|party|enc|guild|boss)"/g) || [];
ok(refs.length > 0, `${refs.length} object references were written as ids`);
ok(A2.fx === undefined, 'fx is not saved');
ok(A2.GOODS && Object.keys(A2.GOODS).length === Object.keys(GOODS).length && A2.CRYPT && 'group' in A2.CRYPT, 'GOODS supply and CRYPT group/cd are in the save');

// Dirty the live state, then restore the snapshot over it.
const marker = S.agents.filter((a) => a.state !== 'dead')[0];
run(DIRTY_MIN);
const dirtyMin = S.gameMin, dirtyGoods = GOODS[Object.keys(GOODS)[0]].supply;
restore(A2);
ok(S.gameMin === A.gameMin && dirtyMin !== A.gameMin, `restore over the same S: clock back to ${A.gameMin} (was ${Math.round(dirtyMin)})`);
ok(S.agents.includes(marker) === false || S.agents.find((a) => a.id === marker.id) !== marker, 'restore rebuilt entities (old hero objects are not reused)');
ok(S.agents.find((a) => a.id === marker.id) !== undefined, 'the marker hero exists again by id');
ok(GOODS[Object.keys(GOODS)[0]].supply === A.GOODS[Object.keys(GOODS)[0]].supply || dirtyGoods === A.GOODS[Object.keys(GOODS)[0]].supply, 'GOODS supply restored');
ok(CRYPT.cd === A.CRYPT.cd, 'CRYPT.cd restored');
const B = snapshot(); scan(B);
const d1 = diff(A, B); ok(!d1, 'snapshot() after restore deep-equals the one before' + (d1 ? ' -- ' + d1 : ''));
sane('after restore');
run(MORE_MIN);
sane(`after ${MORE_MIN} more minutes`);
ok(S.gameMin > A.gameMin + MORE_MIN * 60 * 6 - 1, `world ran on to game-min ${Math.round(S.gameMin)}`);

// Pristine-state restore in a child process (what a browser reload does).
const dir = mkdtempSync(join(tmpdir(), 'eldmoor-save-'));
const file = join(dir, 'save.json');
writeFileSync(file, json);
const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--restore', file], {encoding: 'utf8'});
process.stdout.write(child.stdout); process.stderr.write(child.stderr);
ok(child.status === 0, 'child restore into a pristine module state passed');
rmSync(dir, {recursive: true, force: true});

console.log(fail ? `\n${fail} check(s) failed` : '\nsavecheck: all checks passed');
process.exit(fail ? 1 : 0);
