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
//  10. workflows (#597): every .github/workflows/*.yml passes the strict line check in scripts/workflow-lint.mjs (a comma in an unquoted flow-mapping step name made ci.yml invalid and the PR BLOCKED with no failure).
//  11. map captures (#1013): a module-scope value built from the live map is rebound by an onWorld hook, or listed in the allowlist's "mapCaptures" with a reason (scripts/mapcapture.mjs).
//  9. every world of WORLDS has its rows (epic #940 slice B): a snapshot row, a campaign file, fauna per region, a first delve per town, its places in docs/LORE.md.
//  12. bare reads (#1013): a map may have no dungeon and no lair, so CRYPT and LAIR are read through sim/crypts.js and sim/lair.js; what reads them itself is counted in the allowlist's "bareReads" (file -> {n, why}), as name literals are.
// Usage: npm run rulescheck [-- --against origin/main] [--no-tables] [--pr N]
import {mkTmp} from './tmp.mjs';
import {readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync, mkdirSync} from 'node:fs';
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
  // the regions and towns of every world of WORLDS (a world new on this branch has nothing to compare)
  ...Object.keys(specMod.WORLDS).flatMap(id => ['regions', 'towns'].map(k => [id.toUpperCase() + '.' + k, 'src/world/spec.js', m => (m.WORLDS ? m.WORLDS[id] : m[id.toUpperCase()]) && (m.WORLDS ? m.WORLDS[id] : m[id.toUpperCase()])[k]])),
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
    // the extract is ES modules whatever the temp dir's own package.json says (tmp.mjs writes commonjs into logs/tmp; without this every table read as new)
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');
    const allow = ALLOW.tables || {};
    const newOnes = [];
    for (const [id, file, pick] of TABLES) {
      let head, base;
      try {head = keysOf(pick(await import(pathToFileURL(join(ROOT, file)).href)))} catch (e) {ok(false, id + ' loads on this branch: ' + e.message); continue}
      let baseMod = null, baseErr = null;
      try {baseMod = await import(pathToFileURL(join(dir, file)).href)} catch (e) {baseErr = e}
      if (baseErr && existsSync(join(dir, file))) {ok(false, id + ' cannot be read from ' + ref + ' although ' + file + ' exists there (' + String(baseErr.message).slice(0, 120) + '); the append-only guard would be off'); continue}
      base = baseMod ? keysOf(pick(baseMod)) : null;
      if (!base) {ok(true, id + ' is new (nothing to compare)'); newOnes.push(id); continue}
      if (base.length === 0) {ok(false, id + ' reads empty on ' + ref + '; the append-only guard would compare nothing'); continue}
      if (!head) {ok(false, id + ' is gone from this branch'); continue}
      const bad = [], al = new Set(allow[id] || []);
      base.forEach((k, i) => {if (head[i] !== k && !al.has(k)) bad.push(`row ${i}: '${k}' on ${ref}, '${head[i]}' here`)});
      ok(bad.length === 0, `${id}: ${base.length} existing rows keep their place (${head.length} now)` + (bad.length ? '\n    ' + bad.slice(0, 8).join('\n    ') + (bad.length > 8 ? `\n    ... ${bad.length - 8} more` : '') + '\n    (append new rows at the end; a coordinated rename goes in the allowlist "tables")' : ''));
    }
    ok(newOnes.length < TABLES.length, 'the guard compares tables (' + (TABLES.length - newOnes.length) + ' of ' + TABLES.length + ' read from ' + ref + '; new: ' + (newOnes.join(', ') || 'none') + ')');
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

// ---- 9. every world has its rows (epic #940 slice B) ----
console.log('\nworlds: every world of WORLDS has its table rows');
{
  const {SNAPSHOTS} = await import(pathToFileURL(join(ROOT, 'scripts/world-snapshots.mjs')).href);
  const {FAUNA} = await import(pathToFileURL(join(ROOT, 'src/data/fauna.js')).href);
  const {PROLOGUES} = await import(pathToFileURL(join(ROOT, 'src/data/prologues.js')).href);
  const lore = existsSync(join(ROOT, 'docs/LORE.md')) ? readFileSync(join(ROOT, 'docs/LORE.md'), 'utf8') : '';
  // What a world needs besides its spec: a snapshot row (scripts/world-snapshots.mjs), a campaign file, fauna for every region
  // (Eldmoor keeps the stock tables, so it is the one exception), a first delve for every town, its places in docs/LORE.md.
  const missing = (id, spec) => {
    const out = [];
    if (!SNAPSHOTS[id]) out.push('no row in scripts/world-snapshots.mjs (hashes, minSpawn)');
    if (!existsSync(join(ROOT, 'docs', 'campaigns', id + '.md'))) out.push(`no campaign file docs/campaigns/${id}.md`);
    if (id !== 'eldmoor') for (const r of spec.regions || []) if (!FAUNA[r.id]) out.push(`no FAUNA row for region ${r.id} (src/data/fauna.js)`);
    for (const t of spec.towns || []) if (!PROLOGUES.some(p => p.towns ? p.towns.includes(t.name) : p.fac === t.fac)) out.push(`no first delve naming ${t.name} (src/data/prologues.js)`);
    for (const n of [...(spec.regions || []).map(r => r.name), ...(spec.towns || []).map(t => t.name)]) if (n && !lore.includes(n)) out.push(`${n} is not in docs/LORE.md`);
    return out;
  };
  for (const [id, spec] of Object.entries(specMod.WORLDS)) {
    const m = missing(id, spec);
    ok(m.length === 0, `world ${id} has its rows` + (m.length ? '\n    ' + m.join('\n    ') : ''));
  }
  const ghost = missing('ghost', {regions: [{id: 'nowhere', name: 'Nowhereland'}], towns: [{name: 'Nowhere Town'}]});
  ok(ghost.length >= 5, 'a world with none of its rows is caught, by name (' + ghost.length + ' gaps found for a made-up world)');
}

// ---- 10. workflow files parse (#597) ----
console.log('\nworkflows: every .github/workflows/*.yml is valid for GitHub');
{
  const {lintWorkflow} = await import(pathToFileURL(join(ROOT, 'scripts/workflow-lint.mjs')).href);
  const wdir = join(ROOT, '.github', 'workflows');
  for (const f of existsSync(wdir) ? readdirSync(wdir).filter(f => /\.ya?ml$/.test(f)) : []) {
    const errs = lintWorkflow(readFileSync(join(wdir, f), 'utf8'));
    ok(errs.length === 0, `.github/workflows/${f} parses` + (errs.length ? '\n    ' + errs.map(e => `.github/workflows/${f}:${e.line}: ${e.why}`).join('\n    ') : ''));
  }
  // negative cases: the guard must fire on the PR #597 break and on an unclosed step, and stay quiet on good lines
  const bad = lintWorkflow('steps:\n  - {name: Foo (a, b), run: npm run x}\n');
  ok(bad.length === 1 && bad[0].line === 2, 'a comma in an unquoted flow-mapping step name is caught, with its line (the PR #597 break)');
  ok(lintWorkflow('steps:\n  - {name: "Foo (a, b)", run: npm run x}\n  - {name: Foo (a; b), run: npm run x}\n').length === 0, 'a quoted name with a comma, and a name without one, pass');
  ok(lintWorkflow('steps:\n  - {name: Foo, run: npm run x\n').length === 1, 'an unclosed flow-mapping step is caught');
}

// ---- 11. module-scope values built from the map (#1013) ----
console.log('\nmap captures: what a module built from the live map at load is rebound by an onWorld hook');
{
  const {scan} = await import(pathToFileURL(join(ROOT, 'scripts/mapcapture.mjs')).href);
  const allow = ALLOW.mapCaptures || {}, stop = Object.keys(allow), sites = scan({stop});
  const name = s => s.file + '#' + s.name, loose = sites.filter(s => !s.rebound && !allow[name(s)]), known = new Set(sites.map(name));
  ok(loose.length === 0, sites.filter(s => s.rebound).length + ' captures rebound, ' + stop.length + ' allowed' + (loose.length ? '\n    ' + loose.map(s => `${s.file}:${s.line} ${s.name} (${s.kind})`).join('\n    ') + '\n    (rebuild it in an onWorld hook from sim/kept.js, read the live binding inside a function, go through worded() for text, or list it under "mapCaptures" with the reason)' : ''));
  const stale = stop.filter(k => !known.has(k));
  ok(stale.length === 0, 'the allowlist has no capture that is gone' + (stale.length ? ': ' + stale.join(', ') : ''));
  // the guard must fire on a planted capture and stay quiet on the lawful forms
  const dir = mkTmp('eldmoor-mapcap-'), w = (f, s) => {mkdirSync(dirname(join(dir, f)), {recursive: true}); writeFileSync(join(dir, f), s)};
  w('src/world/map.js', 'export let CITY=[],ZONES=[];\nexport const dist=(a,b)=>0;\n');
  w('src/world/tiles.js', 'export let W=1,H=1;\n');
  w('src/world/spec.js', 'export const ACTIVE_SPEC={};\n');
  w('src/data/mobs.js', 'export const MOBS={},COUNTS={},ELITES=[],ECO={};\n'); w('src/data/items.js', 'export const EPICS=[];\n'); w('src/core/x.js', ''); w('src/sim/state.js', 'export const S={};\n');
  w('src/sim/kept.js', 'export const onWorld=f=>f;\n');
  w('src/sim/bad.js', "import {CITY,ZONES} from '../world/map.js';\nimport {W} from '../world/tiles.js';\nconst names=CITY.map(c=>c.name);\nconst size=W*2;\nconst build=()=>ZONES.map(()=>[]);\nconst tab=build();\nlet memo=null;\nexport const m=()=>memo||(memo=CITY[0]);\nconst again=names.length;\n");
  w('src/sim/good.js', "import {CITY} from '../world/map.js';\nimport {W} from '../world/tiles.js';\nimport {onWorld} from './kept.js';\nconst read=()=>CITY[0];\nconst shadow=W=>W+1;\nconst calm=shadow(2);\nlet size=W*2;\nonWorld(()=>{size=W*2});\n");
  const got = scan({root: dir}), bad = got.filter(s => !s.rebound).map(s => s.name).sort().join(' ');
  ok(bad === 'again memo names size tab', 'a planted capture, memo and second-hand table are caught, the lawful forms pass (' + bad + ')');
}

// ---- 12. no read of a dungeon or a lair that may not be there (#1013) ----
console.log('\nbare reads: a map may have no dungeon and no lair, so CRYPT and LAIR are read through sim/crypts.js and sim/lair.js');
{
  const {bareReads} = await import(pathToFileURL(join(ROOT, 'scripts/mapcapture.mjs')).href);
  const allow = ALLOW.bareReads || {}, found = bareReads();
  const over = [...found].filter(([f, l]) => l.length > ((allow[f] || {}).n || 0)).map(([f, l]) => `${f}: ${l.length} (${(allow[f] || {}).n || 0} allowed), lines ${l.join(', ')}`);
  ok(over.length === 0, [...found.values()].reduce((t, l) => t + l.length, 0) + ' bare reads of CRYPT or LAIR, each on the allowlist' + (over.length ? '\n    ' + over.join('\n    ') + '\n    (use a reader in sim/crypts.js or sim/lair.js; a read behind a guard of its own goes in the allowlist\'s "bareReads" with a reason)' : ''));
  const stale = Object.keys(allow).filter(f => (found.get(f) || []).length < allow[f].n).map(f => `${f}: ${(found.get(f) || []).length} now, ${allow[f].n} listed`);
  ok(stale.length === 0, 'the allowlist counts no read that is gone' + (stale.length ? ': ' + stale.join(', ') : ''));
  const nowhy = Object.keys(allow).filter(f => !allow[f].why);
  ok(nowhy.length === 0, 'every allowed read says why' + (nowhy.length ? ': ' + nowhy.join(', ') : ''));
  const dir = mkTmp('eldmoor-bare-'), w = (f, s) => {mkdirSync(dirname(join(dir, f)), {recursive: true}); writeFileSync(join(dir, f), s)};
  w('src/sim/bad.js', "import {CRYPT,LAIR,dist} from '../world/map.js';\nexport const a=()=>CRYPT.name;\nexport const b=p=>dist(p,LAIR);\nexport const c=x=>(x||CRYPT).x;\n");
  w('src/sim/good.js', "import {CRYPT,LAIR} from '../world/map.js';\nimport {RIV} from './x.js';\nexport const a=D=>D===CRYPT;\nexport const b=()=>!!LAIR;\nexport const c=x=>x||CRYPT;\nexport const d=CRYPT=>CRYPT.name;\nexport const e=()=>RIV.CRYPT;\n");
  w('src/sim/crypts.js', "import {CRYPT} from '../world/map.js';\nexport const n=()=>CRYPT.name;\n");
  const got = bareReads({root: dir});
  ok([...got.keys()].join() === 'src/sim/bad.js' && got.get('src/sim/bad.js').length === 3, 'a planted read is caught, a test of it, a local of the name and the reader pass');
}

console.log(fail ? `\n${fail} FAILED` : '\nall rules hold');
process.exit(fail ? 1 : 0);
