// rulescheck (issue #573): the repo's written rules, checked mechanically.
//  1. layering: src/sim, src/world and src/data never import src/render or src/ui (and sim/world/data stay DOM-free).
//  2. no zone, faction or town name literals outside the data and world tables (heuristic: a quoted string equal to a
//     region id/name, town name or faction name of the worlds, in src/ outside src/data and src/world). Known uses are
//     listed in scripts/rulescheck.allow.json ("literals": {"<file>": ["<name>", ...]}); a new use fails.
//  3. append-only data tables (MOBS, EPICS, GOODS, CLS, the regions of every world spec, ...): against origin/main
//     (git archive, never a worktree) no existing row is reordered or renamed. A deliberate coordinated change is listed
//     in the allowlist under "tables" ("<table>": ["<key>", ...]) in the same PR.
//  4. every scripts/*check.mjs with a package.json script is a step in .github/workflows/ci.yml ("npm run <name>").
//  5. nothing reads the old Fellowship shims (#588): no S.fellowship, no a.fellowRole read, no import of sim/fellowship.js.
//  6. patch notes (#664): every docs/patchnotes/*.md has front matter and 1-6 player-facing lines; on a pull request the
//     checked-out (merged) tree holds docs/patchnotes/<PR>.md, unless the PR carries the label no-notes. The PR number
//     comes from --pr N or PR_NUMBER (CI); the label is read live with gh (GH_TOKEN), so adding it and re-running works.
// Usage: npm run rulescheck [-- --against origin/main] [--no-tables] [--pr N]
import {mkTmp} from './tmp.mjs';
import {readFileSync, readdirSync, existsSync, mkdtempSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join, dirname, resolve, relative, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), opt = (n, d) => {const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d};
const ALLOW = JSON.parse(readFileSync(join(ROOT, 'scripts/rulescheck.allow.json'), 'utf8'));
let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const rel = f => relative(ROOT, f).split(sep).join('/');
const walk = d => readdirSync(d, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
const srcFiles = walk(join(ROOT, 'src')).filter(f => f.endsWith('.js'));
// code only: a line without // comments (a rough strip that keeps strings containing // such as URLs out of the way)
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1'));

console.log('\nEldmoor rulescheck\n');

// ---- 1. layering ----
console.log('layering: sim, world and data never import render or ui');
{
  const bad = [];
  for (const f of srcFiles) {
    const r = rel(f), layer = (r.match(/^src\/(sim|world|data)\//) || [])[1]; if (!layer) continue;
    const lines = stripComments(readFileSync(f, 'utf8'));
    lines.forEach((l, i) => {
      for (const m of l.matchAll(/(?:from\s*|import\s*\(\s*|import\s+|require\s*\(\s*)['"]([^'"]+)['"]/g)) {
        const spec = m[1]; if (!spec.startsWith('.')) continue;
        const target = rel(resolve(dirname(f), spec));
        if (/^src\/(render|ui)(\/|$)/.test(target) || /^src\/main(\.js)?$/.test(target)) bad.push(`${r}:${i + 1} imports ${target}`);
      }
    });
  }
  const allowed = new Set(ALLOW.layering || []);
  const fresh = bad.filter(b => !allowed.has(b.split(' imports ')[0].replace(/:\d+$/, '') + ' -> ' + b.split(' imports ')[1]));
  ok(fresh.length === 0, 'no import of src/render or src/ui from src/sim, src/world or src/data' + (fresh.length ? '\n    ' + fresh.join('\n    ') : ''));
}

// ---- 2. name literals ----
console.log('name literals: zones, towns and factions come from the tables');
const specMod = await import(pathToFileURL(join(ROOT, 'src/world/spec.js')).href);
const facMod = await import(pathToFileURL(join(ROOT, 'src/data/factions.js')).href);
const NAMES = new Set();
for (const w of Object.values(specMod.WORLDS || {})) {
  for (const r of w.regions || []) {NAMES.add(String(r.id).toLowerCase()); NAMES.add(String(r.name).toLowerCase())}
  for (const t of w.towns || []) NAMES.add(String(t.name).toLowerCase());
}
for (const f of facMod.FAC || []) NAMES.add(String(f.name).toLowerCase());
{
  const rx = new RegExp('([\'"`])(' + [...NAMES].map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\1', 'gi');
  const found = new Map(); // file -> Set(name)
  for (const f of srcFiles) {
    const r = rel(f); if (/^src\/(data|world)\//.test(r)) continue;
    for (const l of stripComments(readFileSync(f, 'utf8'))) for (const m of l.matchAll(rx)) {if (!found.has(r)) found.set(r, new Set()); found.get(r).add(m[2].toLowerCase())}
  }
  const allow = ALLOW.literals || {}, fresh = [], stale = [];
  for (const [f, set] of found) for (const n of set) if (!(allow[f] || []).map(x => x.toLowerCase()).includes(n)) fresh.push(`${f}: '${n}'`);
  for (const [f, list] of Object.entries(allow)) for (const n of list) if (!(found.get(f) || new Set()).has(n.toLowerCase())) stale.push(`${f}: '${n}'`);
  ok(fresh.length === 0, 'every zone, faction or town literal outside the tables is on the allowlist' + (fresh.length ? '\n    ' + fresh.join('\n    ') + '\n    (loop the tables, or add it to scripts/rulescheck.allow.json "literals" with a reason in "why")' : ''));
  ok(stale.length === 0, 'the allowlist has no entry that no longer matches' + (stale.length ? '\n    ' + stale.join('\n    ') : ''));
}

// ---- 3. append-only tables ----
const TABLES = [ // [id, file, picker(module) -> table]; an array row is named by its name/id/key/first element
  ['MOBS', 'src/data/mobs.js', m => m.MOBS], ['COUNTS', 'src/data/mobs.js', m => m.COUNTS], ['ELITES', 'src/data/mobs.js', m => m.ELITES],
  ['EPICS', 'src/data/items.js', m => m.EPICS], ['BOSS_EPICS', 'src/data/items.js', m => m.BOSS_EPICS], ['DG_EPICS', 'src/data/items.js', m => m.DG_EPICS],
  ['EPIC_ITEMS', 'src/data/items.js', m => m.EPIC_ITEMS], ['GOODS', 'src/data/items.js', m => m.GOODS], ['MATERIALS', 'src/data/items.js', m => m.MATERIALS],
  ['USES', 'src/data/items.js', m => m.USES], ['CLS', 'src/data/classes.js', m => m.CLS], ['CLSN', 'src/data/classes.js', m => m.CLSN], ['SPECS', 'src/data/classes.js', m => m.SPECS],
  ['FAC', 'src/data/factions.js', m => m.FAC],
  ['PROF', 'src/data/professions.js', m => m.PROF],
  ['ELDMOOR.regions', 'src/world/spec.js', m => m.ELDMOOR.regions], ['ELDMOOR.towns', 'src/world/spec.js', m => m.ELDMOOR.towns],
  ['STEPPING.regions', 'src/world/spec.js', m => m.STEPPING.regions], ['STEPPING.towns', 'src/world/spec.js', m => m.STEPPING.towns],
];
const rowKey = r => r == null ? String(r) : typeof r !== 'object' ? String(r) : Array.isArray(r) ? (typeof r[0] === 'object' ? JSON.stringify(r[0]) : String(r[0])) : String(r.id ?? r.name ?? r.key ?? JSON.stringify(Object.keys(r)));
const keysOf = t => t == null ? null : Array.isArray(t) ? t.map(rowKey) : Object.keys(t);
if (argv.includes('--no-tables')) console.log('append-only tables: skipped (--no-tables)');
else {
  console.log('append-only tables: no existing row reordered or renamed against ' + opt('--against', 'origin/main'));
  const ref = opt('--against', 'origin/main'), dir = mkTmp('eldmoor-rules-');
  const a = spawnSync('git', ['archive', ref, 'src'], {cwd: ROOT, maxBuffer: 1 << 30});
  let t = a.status === 0 ? spawnSync('tar', ['-x'], {cwd: dir, input: a.stdout, maxBuffer: 1 << 30}) : null;
  if (!t || t.status !== 0) ok(false, 'could not read ' + ref + ' (git archive failed: ' + String(a.stderr || (t && t.stderr)).trim().slice(0, 200) + '); run `git fetch origin main`');
  else {
    const allow = ALLOW.tables || {};
    for (const [id, file, pick] of TABLES) {
      let head, base;
      try {head = keysOf(pick(await import(pathToFileURL(join(ROOT, file)).href)))} catch (e) {ok(false, id + ' loads on this branch: ' + e.message); continue}
      try {base = keysOf(pick(await import(pathToFileURL(join(dir, file)).href)))} catch {base = null}
      if (!base) {ok(true, id + ' is new (nothing to compare)'); continue}
      if (!head) {ok(false, id + ' is gone from this branch'); continue}
      const bad = [], al = new Set(allow[id] || []);
      base.forEach((k, i) => {if (head[i] !== k && !al.has(k)) bad.push(`row ${i}: '${k}' on ${ref}, '${head[i]}' here`)});
      ok(bad.length === 0, `${id}: ${base.length} existing rows keep their place (${head.length} now)` + (bad.length ? '\n    ' + bad.slice(0, 8).join('\n    ') + (bad.length > 8 ? `\n    ... ${bad.length - 8} more` : '') + '\n    (append new rows at the end; a coordinated rename goes in the allowlist "tables")' : ''));
    }
  }
}

// ---- 4. every check script is a CI step ----
console.log('CI coverage: every check script with an npm script runs in ci.yml');
{
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts || {}, ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const skip = new Set(ALLOW.ciExempt || []), missing = [];
  for (const [name, cmd] of Object.entries(pkg)) {
    const m = String(cmd).match(/scripts\/(\w+check)\.mjs/); if (!m || skip.has(name)) continue;
    if (!new RegExp('npm run ' + name.replace(/[-]/g, '\\-') + '(?![\\w-])').test(ci)) missing.push(`${name} (${cmd})`);
  }
  ok(missing.length === 0, 'no check script is missing from ci.yml' + (missing.length ? '\n    ' + missing.join('\n    ') + '\n    (add a step, or list it under "ciExempt" with a reason)' : ''));
  const stale = [...skip].filter(n => !pkg[n]);
  ok(stale.length === 0, 'ciExempt names only existing npm scripts' + (stale.length ? ': ' + stale.join(', ') : ''));
}

// ---- 5. no Fellowship shims (#588) ----
console.log('companies: nothing reads the old Fellowship shims (S.fellowship, a.fellowRole, sim/fellowship.js)');
{
  const bad = [], files = srcFiles.concat(walk(join(ROOT, 'scripts')).filter(f => f.endsWith('.mjs') && !f.endsWith('rulescheck.mjs')));
  for (const f of files) {
    const r = rel(f); if (r === 'src/sim/save.js') continue; // the v6 -> v7 migration reads the old fields of a saved file
    stripComments(readFileSync(f, 'utf8')).forEach((l, i) => {
      const imp = [...l.matchAll(/(?:from\s*|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)].some(m => m[1].startsWith('.') && rel(resolve(dirname(f), m[1])) === 'src/sim/fellowship.js');
      if (imp || /\bS\.fellowship\b(?!s)/.test(l) || (/\.fellowRole\b/.test(l) && !/delete [\w.]*\.fellowRole|h\.fellowRole = /.test(l))) bad.push(`${r}:${i + 1}`);
    });
  }
  ok(!existsSync(join(ROOT, 'src/sim/fellowship.js')) && bad.length === 0, 'no shim reads; read slotted(), inSlots(a), slotKeyOf(a), partySlotted(p) from sim/company.js' + (bad.length ? '\n    ' + bad.join('\n    ') : ''));
}

// ---- 6. patch notes (#664) ----
console.log('patch notes: one player-facing note per PR (docs/patchnotes/<PR>.md)');
{
  const {parseNote, lintNote} = await import(pathToFileURL(join(ROOT, 'src/ui/patchnotes.js')).href);
  const dir = join(ROOT, 'docs', 'patchnotes'), files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('_')) : [];
  const bad = [];
  for (const f of files) {const e = lintNote(parseNote(readFileSync(join(dir, f), 'utf8'), f)); if (e.length) bad.push(f + ': ' + e.join('; '))}
  const pr = Number(opt('--pr', process.env.PR_NUMBER || '')) || 0;
  // A PR answers for its own note; a note another PR merged in an older shape is a warning, so one PR cannot block the next.
  const own = bad.filter(b => b.startsWith(pr + '.md:')), others = bad.filter(b => !b.startsWith(pr + '.md:'));
  ok(own.length === 0, (pr ? `PR #${pr}'s note has` : `every note (${files.length}) has`) + ' front matter and 1-6 lines for the player' + (own.length ? '\n    ' + own.join('\n    ') : ''));
  if (others.length) {console.log(`  warn ${others.length} older note(s) need work (not this PR's; fix them in passing):\n    ` + others.join('\n    ')); if (!pr) fail++}
  if (!pr) console.log("  -    not a pull-request run (no --pr N or PR_NUMBER): the PR's own note is checked in CI");
  else if (files.includes(pr + '.md')) ok(true, `PR #${pr} carries its note (docs/patchnotes/${pr}.md)`);
  else {
    const r = spawnSync('gh', ['pr', 'view', String(pr), '--json', 'labels', '--jq', '.labels[].name'], {cwd: ROOT, encoding: 'utf8'});
    const labels = (r.status === 0 ? r.stdout.split('\n') : (process.env.PR_LABELS || '').split(',')).map(s => s.trim());
    ok(labels.includes('no-notes'), labels.includes('no-notes') ? `PR #${pr} has no note and the label no-notes` :
      `PR #${pr} has no patch note: add docs/patchnotes/${pr}.md (title, date, area, issues in front matter, then 1-6 "- " lines on what the player will see; "Nothing you will notice: ..." for CI and tests), or label the PR no-notes and re-run`);
  }
}

// ---- 8. no code hidden after a // comment (#933) ----
console.log('\ncomments: no code hides after a // comment');
{
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/commentcodecheck.mjs')], {cwd: ROOT, encoding: 'utf8'});
  ok(r.status === 0, 'no statement written after a // comment on the same line (scripts/commentcodecheck.mjs)' + (r.status === 0 ? '' : '\n    ' + r.stdout.trim().split('\n').slice(1).join('\n    ')));
}

console.log(fail ? `\n${fail} FAILED` : '\nall rules hold');
process.exit(fail ? 1 : 0);
