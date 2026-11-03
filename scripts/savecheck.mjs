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
import {init, step, S, snapshot, restore, isSave, describeSave, markPlayer, playerAct, found, autoPick, TABLE} from '../src/sim/index.js';
TABLE.mode = 'off'; // Watch mode: the clock checks below expect the world never to pause for the Fellowship's scenes (tablecheck covers Table mode)
import {GOODS} from '../src/data/items.js';
import {CRYPT} from '../src/world/map.js';
import {splitOff} from '../src/sim/council.js';
import {seedRng} from '../src/core/rng.js';
import {openScene} from '../src/sim/table.js';
import {companyOf, companies, PARTY, roleOf, foundCompany, joinCompany, leaveCompany, mergeCompanies, members, leaderOf, isSolo, mates} from '../src/sim/company.js';

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
  ok(S.agents.every((a) => a.guild === null || S.GUILDS.includes(a.guild)), `${label}: every hero's guild is null or a GUILDS entry (${S.GUILDS.filter((g) => !g.retired).length} living, ${S.GUILDS.filter((g) => g.retired).length} retired, ${S.agents.filter((a) => !a.guild && a.state !== 'dead').length} unguilded alive)`);
  ok(new Set(S.GUILDS.map((g) => g.id)).size === S.GUILDS.length && S.GUILDS.every((g) => g.id <= S.guildSeq), `${label}: guild ids unique and below guildSeq ${S.guildSeq}`);
  ok(S.agents.every((a) => !a.target || a.target.kind), `${label}: hero targets are entities`);
  {const F = S.fellowship; ok(!!F && F.ids.length >= 4 && F.ids.every((id) => {const a = S.agents.find((x) => x.id === id); return a && a.fellow && a.state !== 'dead' && a.persona && a.backstory && a.memory && Array.isArray(a.memory.recent)}) && F.log.length > 0, `${label}: Fellowship ${F ? F.name + ' with ' + F.ids.length + ' members, ' + F.log.length + ' log entries, ' + F.past.length + ' fallen' : 'missing'}`)}
  ok(S.agents.filter((a) => a.player).every((a) => Array.isArray(a.journal) && Array.isArray(a.pq) && (a.fellow || a.state === 'dead' || a.journal.length >= 1)),`${label}: ${S.agents.filter((a) => a.player).length} agent-played hero(es) keep journal and queue`);
  ok(S.fellowship.ids.every((id) => {const a = S.agents.find((x) => x.id === id); return a && a.player && !a.brain}) && S.fellowship.minds === 'agent', `${label}: every Fellowship member is agent-played (#148)`);
}

// A world hash that ignores company ids (a migrated save numbers its companies afresh).
function fixHash() {let h = 5381; const feed = (x) => {const t = String(x); for (let i = 0; i < t.length; i++) h = (Math.imul(h, 33) ^ t.charCodeAt(i)) >>> 0};
  for (const a of S.agents) feed([a.id, a.lvl, a.xp, a.gold, a.state, a.x.toFixed(2), a.y.toFixed(2), a.hp.toFixed(1), !!a.fellow, a.fellowRole || '', a.party ? a.party.id + ':' + !!a.party.fellow : '', a.splitUntil || '', companyOf(a) ? companyOf(a).name : ''].join(','));
  const F = S.fellowship; feed(F ? [F.name, F.ids.join('.'), Object.values(F.slots).join('.'), F.log.length, F.seed].join('|') : 'none');
  const t = S.table; feed(t ? [t.id, t.kind, t.ids.join('.'), t.i, t.phase, t.beats.length, !!t.resolved].join('|') : 'no table');
  feed(S.companies.map((c) => c.name + ':' + c.ids.join('.')).join(';')); return h}

const args = process.argv.slice(2);
if (args[0] === '--fixture') {
  // ---- child phase for the v6 fixture (#438): restore, hash, run 10 s at 1x with seeded dice, hash ----
  seedRng(0x5eed); let seed = 0x5eed; Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
  TABLE.mode = 'auto'; restore(JSON.parse(readFileSync(args[1], 'utf8')));
  const a = fixHash(), open = !!S.table; for (let i = 0; i < 600; i++) step(1 / 60);
  console.log(JSON.stringify({a, b: fixHash(), open, min: S.gameMin})); process.exit(0);
}
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
// An agent-played hero (issue #75) with a journal and a command in its queue rides along.
{const p = S.agents.find((a) => a.state !== 'dead');
  ok(markPlayer(p, true) && playerAct(p.id, 'journal_write', {text: 'Savecheck was here.'}).ok && playerAct(p.id, 'move_to', {target: 'home'}).ok !== undefined, `agent-played hero ${p.name} with a journal entry`)}
// The Fellowship (issue #68) rides along: five heroes with personas, backstories, memories and a campaign log (relay off).
{const r = S.fellowship ? {ok: true} : found(autoPick(0), {ai: false}); ok(r.ok && S.fellowship, 'Fellowship founded: ' + (r.ok ? S.fellowship.name + (S.agents.some((a) => !a.fellow && a.lvl > 1) ? ' (new-world start, #111)' : '') : r.error))}
run(TWO_DAYS_MIN);
const twoDays = JSON.stringify(snapshot());
console.log(`  size after ${TWO_DAYS_MIN} min (2 game-days): ${kb(twoDays)}`);
ok(twoDays.length < 1.5 * 1024 * 1024, 'two-day save is under 1.5 MB');
run(RUN_MIN - TWO_DAYS_MIN);
sane(`after ${RUN_MIN} minutes`);

// Make sure the world under test has several guilds, a retired one and unguilded heroes.
{
  const live = S.GUILDS.filter((g) => !g.retired);
  ok(live.length >= 2, `${live.length} living guilds founded by the heroes after ${RUN_MIN} min`);
  if (!S.GUILDS.some((g) => g.retired) && live.length > 1) {
    const g = live[live.length - 1];
    for (const a of S.agents) if (a.guild === g) a.guild = null;
    g.retired = true; g.disbanded = S.gameMin;
  }
  ok(S.GUILDS.some((g) => g.retired), 'a retired guild is in the world');
  ok(S.agents.some((a) => a.state !== 'dead' && !a.guild), 'an unguilded hero is in the world');
}
let A;
try {A = snapshot(); scan(A); ok(true, 'snapshot() walks clean: no functions, canvases, NaN or live entity objects')} catch (e) {ok(false, 'snapshot(): ' + e.message); process.exit(1)}
ok(isSave(A), 'snapshot is recognised by isSave()');
{const d = describeSave(JSON.parse(JSON.stringify(A))), F = S.fellowship, mem = F ? Object.values(F.slots).filter((id) => id != null && S.agents.some((x) => x.id === id)) : [];
  ok(d && d.day === Math.floor(S.gameMin / 1440) + 1 && d.min === Math.floor(S.gameMin) % 1440 && (!F || (d.fellowship.name === F.name && d.fellowship.members.length === mem.length && d.fellowship.members.every((m) => m.lvl === S.agents.find((x) => x.name === m.name).lvl))) && describeSave({}) === null,
    'describeSave (title screen): day ' + (d && d.day) + ', ' + (d && d.fellowship ? d.fellowship.members.map((m) => m.name + ' ' + m.lvl).join(', ') : 'no Fellowship'))}
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

// An older world whose members were scripted (or relay-played) is converted on restore, with a notice (#148).
{const old = JSON.parse(json), OF = old.companies.find((c) => c.slots); OF.minds = 'off'; OF.ai = false;
  for (const h of old.agents) if (OF.ids.includes(h.id)) {h.player = false; delete h.fellowAgent}
  old.playerHeroes = (old.playerHeroes || []).filter((id) => !OF.ids.includes(id));
  restore(old); const was = S.fellowship.ids.filter((id) => S.agents.find((x) => x.id === id).player).length; step(1 / 60);
  const F = S.fellowship, txt = F.log.map((e) => e.parts.map((p) => typeof p === 'string' ? p : '').join('')).join('\n');
  ok(was === 0 && F.ids.every((id) => {const a = S.agents.find((x) => x.id === id); return a.player && a.fellowAgent}) && F.minds === 'agent' && /always agent-played now/.test(txt), `an older save with scripted members restores agent-played, with a notice (${F.ids.length} converted)`)}

// ---- companies (#402, #438): the v7 shape, and a v6 save (a Fellowship, a split member, a scene open at the table) ----
{restore(JSON.parse(json));
  if (!companies().some((C) => C.ids.length === 1 && !C.slots)) markPlayer(S.agents.find((a) => a.state !== 'dead' && !a.player && !a.fellow), true); // a solo rides along (the first one may have fallen)
  const v7 = snapshot(), txt = JSON.stringify(v7);
  ok(v7.version === 7 && Array.isArray(v7.companies) && !('fellowship' in v7) && !/"fellow(Role|From)?":/.test(JSON.stringify([v7.agents, v7.parties])),
    `v7 save: ${v7.companies.length} companies, no fellowship key, no a.fellow / a.fellowRole / a.fellowFrom / p.fellow`);
  const live = S.agents.filter((a) => a.player && a.state !== 'dead');
  ok(live.length > 0 && live.every((a) => companyOf(a) && S.companies.filter((C) => C.ids.includes(a.id)).length === 1),
    `every agent-played hero rides in exactly one company (${live.length}; solos: ${companies().filter((C) => C.ids.length === 1).map((C) => C.name).join(', ') || 'none'})`);
  ok(S.fellowship && S.fellowship.ids.every((id) => {const a = S.agents.find((x) => x.id === id); return a.fellow && a.fellowRole && a.company === S.fellowship.id}) && S.parties.filter((p) => p.fellow).every((p) => p.company === S.fellowship.id),
    'the shims: S.fellowship, a.fellow, a.fellowRole and p.fellow read through the company');
  const d = describeSave(JSON.parse(txt));
  ok(d && d.companies.length === S.companies.length && d.fellowship && d.fellowship.name === S.fellowship.name, 'describeSave lists the companies (' + d.companies.map((c) => c.name + ' ' + c.members.length).join(', ') + ')');
}
{TABLE.mode = 'auto'; // a scene stays open at the table (world paused at 1x) so the save is taken mid-scene
  const F = S.fellowship, mem = F.ids.map((id) => S.agents.find((x) => x.id === id)), lead = mem.reduce((x, y) => y.lvl > x.lvl ? y : x);
  const split = mem.find((b) => b !== lead && b.state !== 'dead'); splitOff(split, true);
  const foe = S.mobs.filter((m) => m.alive).sort((x, y) => Math.hypot(x.x - lead.x, x.y - lead.y) - Math.hypot(y.x - lead.x, y.y - lead.y))[0];
  if (S.table) S.table = null;
  const sc = openScene('elite', 'Save fixture', ['A brute bars the road.'], {mob: foe.id});
  ok(!!sc && S.table === sc && !sc.resolved && split.splitUntil > S.gameMin, `fixture: ${split.name} split off, an ${sc ? sc.kind : '?'} scene open at the table`);
  const v7 = JSON.parse(JSON.stringify(snapshot()));
  // The same world written the v6 way (the shape main wrote before companies).
  const v6 = JSON.parse(JSON.stringify(v7)), C = v6.companies.find((c) => c.slots);
  v6.fellowship = {...C, id: C.seed}; delete v6.fellowship.seed; delete v6.fellowship.from;
  for (const h of v6.agents) {if (h.kind !== 'hero') continue;
    if (C.ids.includes(h.id)) {h.fellow = true; h.fellowRole = Object.keys(C.slots).find((k) => C.slots[k] === h.id); h.fellowFrom = C.from[h.id] ?? null} else if (h.fellowPast == null) h.fellow = false;
    delete h.company}
  for (const p of v6.parties) {if (p.company === C.id) p.fellow = true; delete p.company}
  if (v6.companiesPast) v6.fellowshipsPast = v6.companiesPast;
  delete v6.companies; delete v6.companySeq; delete v6.followId; delete v6.companiesPast; v6.version = 6;
  ok(!/"company":/.test(JSON.stringify(v6)) && v6.fellowship.slots && v6.table, 'fixture: a v6 save with a Fellowship, a.fellow / p.fellow and an open table');
  restore(JSON.parse(JSON.stringify(v7))); const a7 = JSON.parse(JSON.stringify(snapshot()));
  restore(JSON.parse(JSON.stringify(v6))); const a6 = JSON.parse(JSON.stringify(snapshot()));
  for (const s of [a7, a6]) for (const c of s.companies) if (!c.slots) {delete c.founded; delete c.day} // a solo made by the migration is founded at load (a v6 save has no record of it)
  // C.from may keep the home town of a member who has since left or died (nothing reads it; v6 kept it on the hero's own
  // a.fellowFrom, which the migration reads only for current members): compare it for current members only
  for (const s of [a7, a6]) for (const c of s.companies) if (c.from) for (const id of Object.keys(c.from)) if (!c.ids.some((x) => String(x) === id)) delete c.from[id];
  // ... and numbered in hero order, while the world numbered its solos in the order heroes became agent-played: compare
  // solos by their hero, not their id (the check was flaky on main whenever those orders differed)
  for (const s of [a7, a6]) {const solo = new Map(s.companies.filter((c) => !c.slots && c.ids.length === 1).map((c) => [c.id, 'solo:' + c.ids[0]]));
    for (const c of s.companies) if (solo.has(c.id)) c.id = solo.get(c.id);
    s.companies.sort((x, y) => String(x.id).localeCompare(String(y.id)));
    for (const h of s.agents) if (solo.has(h.company)) h.company = solo.get(h.company);
    if (solo.has(s.followId)) s.followId = solo.get(s.followId); delete s.companySeq}
  const d6 = diff(a7, a6);
  ok(!d6 && !!S.table, 'the v6 save restores to the same world as the v7 one (snapshots deep-equal but for when the solos were founded, the scene still open)' + (d6 ? ' -- ' + d6 : ''));
  ok(S.agents.filter((a) => a.player && a.state !== 'dead').every((a) => companyOf(a)) && S.companies.every((c) => c.ids.length <= PARTY.MAX) && S.followId === S.fellowship.id,
    'after the v6 migration every agent hero rides in a company and the Fellowship is followed');
  // Running on is compared in fresh processes: module-level timers and caches are not part of a save, so two restores in
  // one process drift apart even from the same file.
  const dir = mkdtempSync(join(tmpdir(), 'eldmoor-v6-')), runs = {};
  for (const [k, snap] of [['v7', v7], ['v6', v6]]) {const f = join(dir, k + '.json'); writeFileSync(f, JSON.stringify(snap));
    const c = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--fixture', f], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
    try {runs[k] = JSON.parse((c.stdout || '').trim().split(/\r?\n/).pop())} catch {runs[k] = {err: (c.stderr || c.stdout || '').slice(-400)}}}
  rmSync(dir, {recursive: true, force: true});
  const r7 = runs.v7, r6 = runs.v6;
  ok(r7.a && r7.a === r6.a && r6.open, `fixture hashes the same after restore: v7 ${r7.a} / v6 ${r6.a}` + (r6.err ? ' -- ' + r6.err : ''));
  ok(r7.b && r7.b === r6.b && r7.min === r6.min, `and 10 s later: v7 ${r7.b} / v6 ${r6.b}`);
  TABLE.mode = 'off';
}

// The company helpers (data only): one faction, at most PARTY.MAX heroes, solos, merge, leave.
{const free = (f) => S.agents.filter((a) => a.state !== 'dead' && a.fac === f && !a.company);
  ok(roleOf('Warrior') === 'tank' && roleOf('Priest') === 'healer' && roleOf('Wildspeaker') === 'healer' && roleOf('Mage') === 'dps' && PARTY.MAX === 8 && PARTY.MINDS === 5, 'roleOf labels and the caps (8 heroes, 5 minds)');
  const [x, y] = [free(0)[0], free(1)[0]];
  ok(!foundCompany([x, y]).ok, 'a company of two factions is refused');
  const nine = free(0).slice(0, 9); ok(nine.length < 9 || !foundCompany(nine).ok, 'a company of nine is refused');
  const r = foundCompany([x]); const C = r.company;
  ok(r.ok && isSolo(C) && x.company === C.id && members(C)[0] === x && !x.fellow, `a solo: ${x.name}`);
  ok(!joinCompany(C, y).ok, 'joining across factions is refused');
  const more = free(0).slice(0, 7); for (const b of more) joinCompany(C, b);
  ok(C.ids.length === Math.min(8, 1 + more.length) && mates(x).length === C.ids.length - 1, `${C.ids.length} heroes ride together`);
  const extra = free(0)[0]; ok(!extra || C.ids.length < 8 || !joinCompany(C, extra).ok, 'a ninth hero is refused');
  for (const b of members(C)) b.player = true; const L = leaderOf(C); ok(L && members(C).every((b) => b.lvl <= L.lvl), `leaderOf: ${L && L.name} (highest level)`); for (const b of members(C)) b.player = false;
  const D = foundCompany([free(0)[0]]).company; ok(!D || !mergeCompanies(C, D).ok || C.ids.length <= 8, 'a merge past 8 heroes is refused');
  const E = foundCompany([C.ids.length > 1 ? members(C).pop() : x]).company; ok(E && isSolo(E) && !C.ids.includes(E.ids[0]), 'founding moves a hero out of its old company');
  const ma = mergeCompanies(C, E); ok(ma.ok && !S.companies.includes(E) && C.ids.includes(members(C).slice(-1)[0].id), 'merge folds one company into the other');
  for (const b of members(C)) leaveCompany(b); ok(!S.companies.includes(C) && !x.company, 'a company left by everyone ends');
  if (D) leaveCompany(members(D)[0]);
}

// Pristine-state restore in a child process (what a browser reload does).
const dir = mkdtempSync(join(tmpdir(), 'eldmoor-save-'));
const file = join(dir, 'save.json');
writeFileSync(file, json);
const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--restore', file], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
process.stdout.write(child.stdout || ''); process.stderr.write(child.stderr || '');
{const out = (child.stdout || '') + (child.stderr || ''), bad = out.split(/\r?\n/).filter((l) => /FAIL|Error|\bat .*\.m?js/.test(l));
  if (child.status !== 0) console.error(`  child exited with status ${child.status}, signal ${child.signal}${child.error ? ', error ' + child.error.message : ''}; its failing lines:\n` + (bad.join('\n') || '    (none printed)'))}
ok(child.status === 0, 'child restore into a pristine module state passed');
rmSync(dir, {recursive: true, force: true});

console.log(fail ? `\n${fail} check(s) failed` : '\nsavecheck: all checks passed');
process.exit(fail ? 1 : 0);
