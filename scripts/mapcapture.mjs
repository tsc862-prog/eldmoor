// mapcapture (#1013 slice 1b): which module-scope values were built from the live map at import, and which are rebound.
// A module that reads CITY or W inside a function follows the live binding by itself; one that builds a table from them at
// module scope keeps the first map's copy after setWorld. This walks the ASTs of src/sim, src/data, src/world and src/core:
//   roots      the names map.js and tiles.js export live (plus ACTIVE_SPEC),
//   map fns    functions that read a root, or a captured value, or call a map fn, followed across imports,
//   captures   a module-scope binding whose initializer runs such code while the module loads,
//   memos      a module-scope binding a function fills from such code (a lazy cache of the map),
// to a fixed point, so a table built from another module's table counts. A binding is rebound when the module's onWorld hook
// (or a function that hook calls) assigns or clears it. Shadowing is honoured; member calls (X.fn()) are not followed, so this is
// a net, not a proof: the values crossingcheck compares are the proof. rulescheck fails a binding that is neither rebound nor on
// the allowlist. `node scripts/mapcapture.mjs` prints everything found.
import {readFileSync, readdirSync} from 'node:fs';
import {join, dirname, resolve, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseAst} from 'rollup/parseAst';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LAYERS = ['sim', 'data', 'world', 'core'];
const LIVE = new Set(['src/world/map.js', 'src/world/tiles.js']);
// Tables a map's fauna rewrites in place (setWorld applies it): built from them means built from the map.
const TABLES = {'src/data/mobs.js': ['MOBS', 'COUNTS', 'ELITES', 'ECO'], 'src/data/items.js': ['EPICS']};
const NOT_ROOTS = new Set(['dist', 'WORLD_ID', 'T', 'G', 'TREE', 'SWAMP', 'MUD', 'ROCK', 'PEAK', 'LAVA', 'ROAD', 'FLOOR', 'WALL', 'RIVER', 'BRIDGE', 'SGRASS', 'FLOWER', 'SNOW', 'ICE', 'SPEED', 'WALKABLE', 'setWorld', 'setWorldSize']);
// Callbacks handed to these run later, not while the module loads.
const LATER = /^(worded|keep|onWorld|onLog|on[A-Z]\w*|set[A-Z]\w*Hook|set[A-Z]\w*|register\w*|wire\w*|lever|defineLever|addEventListener|setTimeout|setInterval)$/;

const walkDir = d => readdirSync(d, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walkDir(join(d, e.name)) : [join(d, e.name)]);

const isFn = n => n && (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration');

// Every name a pattern binds.
function patNames(p, out = []) {
  if (!p) return out;
  if (p.type === 'Identifier') out.push(p.name);
  else if (p.type === 'ObjectPattern') for (const q of p.properties) patNames(q.type === 'RestElement' ? q.argument : q.value, out);
  else if (p.type === 'ArrayPattern') for (const q of p.elements) patNames(q, out);
  else if (p.type === 'AssignmentPattern') patNames(p.left, out);
  else if (p.type === 'RestElement') patNames(p.argument, out);
  return out;
}
const kids = n => {
  const out = [];
  for (const k of Object.keys(n)) {
    if (k === 'type' || k === 'start' || k === 'end') continue;
    const v = n[k];
    if (Array.isArray(v)) {for (const c of v) if (c && typeof c.type === 'string') out.push([k, c, n])}
    else if (v && typeof v.type === 'string') out.push([k, v, n]);
  }
  return out;
};
// Names declared inside a function (block scopes folded in: a shadow anywhere in it counts for all of it).
export function localsOf(fn) {
  const s = new Set();
  for (const p of fn.params || []) patNames(p).forEach(x => s.add(x));
  if (fn.id && fn.type === 'FunctionExpression') s.add(fn.id.name);
  const go = n => {
    if (n.type === 'VariableDeclaration') for (const d of n.declarations) patNames(d.id).forEach(x => s.add(x));
    if (n.type === 'FunctionDeclaration' && n.id) s.add(n.id.name);
    if (n.type === 'CatchClause' && n.param) patNames(n.param).forEach(x => s.add(x));
    if (n.type === 'ClassDeclaration' && n.id) s.add(n.id.name);
    if (isFn(n) && n !== fn) return;
    for (const [, c] of kids(n)) go(c);
  };
  if (fn.body) go(fn.body);
  return s;
}
// Is this Identifier, under this parent and key, a reference?
const isRef = (key, parent) => {
  if (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return false;
  if (parent.type === 'Property' && key === 'key' && !parent.computed) return false;
  if ((parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && key === 'key' && !parent.computed) return false;
  if (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') return false;
  return true;
};
// Walk code. onRef(name) for each reference not shadowed; `enter(fn)` says whether to go into a nested function (default no).
function refs(node, shadow, onRef, enter) {
  const go = (n, sh, key, parent) => {
    if (n.type === 'Identifier') {if (isRef(key, parent) && !sh.has(n.name)) onRef(n.name, n); return}
    if (n.type === 'MemberExpression' && !n.computed && n.object.name === 'WORDS' && n.property.name === 'world') return; // the campaign's name: the same on every map
    if (isFn(n)) {
      if (!enter || !enter(n, key, parent)) return;
      const inner = new Set([...sh, ...localsOf(n)]);
      for (const p of n.params) go(p, inner, 'param', n);
      go(n.body, inner, 'body', n); return;
    }
    if (n.type === 'ImportDeclaration' || n.type === 'ExportAllDeclaration') return;
    for (const [k, c] of kids(n)) go(c, sh, k, n);
  };
  go(node, shadow, '', {type: 'Root'});
}

export function scan({root = ROOT, stop = []} = {}) {
  const rel = f => relative(root, f).split(sep).join('/');
  const files = LAYERS.flatMap(l => walkDir(join(root, 'src', l))).filter(f => f.endsWith('.js'));
  const mods = new Map(); // rel -> module facts
  for (const f of files) {
    const ast = parseAst(readFileSync(f, 'utf8'));
    const m = {file: rel(f), ast, imports: new Map(), fns: new Map(), vals: new Map(), exports: new Map(), reexports: [], tops: new Set()};
    for (const st of ast.body) {
      if (st.type === 'ImportDeclaration') {
        const src = st.source.value; if (!src.startsWith('.')) continue;
        const from = rel(resolve(dirname(f), src));
        for (const s of st.specifiers) m.imports.set(s.local.name, {from, name: s.type === 'ImportSpecifier' ? s.imported.name : s.type === 'ImportDefaultSpecifier' ? 'default' : '*'});
      }
      if (st.type === 'ExportNamedDeclaration' && st.source) {
        const from = rel(resolve(dirname(f), st.source.value));
        for (const s of st.specifiers) m.reexports.push({from, name: s.local.name, as: s.exported.name});
      }
      if (st.type === 'ExportNamedDeclaration' && !st.source) for (const s of st.specifiers) m.exports.set(s.exported.name, s.local.name);
      const decl = st.type === 'ExportNamedDeclaration' ? st.declaration : st;
      if (!decl) continue;
      const exported = st.type === 'ExportNamedDeclaration';
      if (decl.type === 'FunctionDeclaration') {m.fns.set(decl.id.name, decl); m.tops.add(decl.id.name); if (exported) m.exports.set(decl.id.name, decl.id.name)}
      if (decl.type === 'VariableDeclaration') for (const d of decl.declarations) {
        for (const n of patNames(d.id)) {
          m.tops.add(n); if (exported) m.exports.set(n, n);
          if (isFn(d.init) && d.id.type === 'Identifier') m.fns.set(n, d.init);
          else m.vals.set(n, {decl: d, kind: decl.kind, line: lineOf(f, d.start)});
        }
      }
    }
    mods.set(m.file, m);
  }
  function lineOf(f, pos) {return readFileSync(f, 'utf8').slice(0, pos).split('\n').length}
  // Is `name` as seen in module m map-dependent? kind: 'val' (a live or captured value) or 'fn' (a function that reads one).
  const taintVal = new Set(), taintFn = new Set(); // 'file#name'
  const key = (file, name) => file + '#' + name;
  const resolveName = (m, name, seen = new Set()) => { // -> [file, localName] of the definition
    if (m.tops.has(name)) return [m.file, name];
    const imp = m.imports.get(name);
    if (!imp) return null;
    return resolveExport(imp.from, imp.name, seen);
  };
  const resolveExport = (file, name, seen) => {
    if (seen.has(file + name)) return null; seen.add(file + name);
    const t = mods.get(file); if (!t) return null;
    if (t.exports.has(name)) return [file, t.exports.get(name)];
    for (const r of t.reexports) if (r.as === name) return resolveExport(r.from, r.name, seen);
    const viaImp = t.imports.get(name); // export {x} of an import lands in exports already; this is a safety net
    return viaImp ? resolveExport(viaImp.from, viaImp.name, seen) : null;
  };
  // roots
  for (const f of LIVE) {
    const t = mods.get(f); if (!t) continue;
    for (const [as, local] of t.exports) if (!NOT_ROOTS.has(as) && !t.fns.has(local)) taintVal.add(key(f, local));
    if (f === 'src/world/map.js') for (const n of ['zoneFor', 'zoneAt', 'tileAt', 'zonePoint', 'nodeById', 'nodesIn', 'nodeNear']) taintVal.add(key(f, n));
  }
  const spec = mods.get('src/world/spec.js'); if (spec) taintVal.add(key(spec.file, 'ACTIVE_SPEC'));
  for (const [f, names] of Object.entries(TABLES)) for (const n of names) taintVal.add(key(f, n));
  const stopped = new Set(['src/sim/state.js#S', ...stop]); // S is classified key by key (sim/atlas.js); what is allowed stays where it is
  const isTaint = (m, name) => {const d = resolveName(m, name); if (!d) return false; const k = key(d[0], d[1]); return !stopped.has(k) && (taintVal.has(k) || taintFn.has(k))};
  // Runs at load: function arguments are entered unless the callee is a registration.
  const enterAtLoad = (n, k, parent) => {
    if (parent.type === 'CallExpression' && k === 'callee') return true; // an IIFE
    if (parent.type === 'CallExpression' && k === 'arguments') {
      const c = parent.callee, name = c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' && !c.computed ? c.property.name : '';
      return !LATER.test(name);
    }
    return false;
  };
  // fixed point
  for (let changed = true; changed;) {
    changed = false;
    for (const m of mods.values()) {
      if (LIVE.has(m.file)) continue;
      for (const [n, fn] of m.fns) {
        if (taintFn.has(key(m.file, n))) continue;
        let hit = false;
        refs(fn.body, localsOf(fn), r => {if (isTaint(m, r)) hit = true}, () => true);
        if (hit) {taintFn.add(key(m.file, n)); changed = true}
      }
      for (const [n, v] of m.vals) {
        if (taintVal.has(key(m.file, n)) || !v.decl.init) continue;
        let hit = false;
        // A plain reference to a map function is not reading the map (a table of callbacks); calling it is.
        const onRef = (r, id) => {
          const d = resolveName(m, r); if (!d || stopped.has(key(d[0], d[1]))) return;
          if (taintVal.has(key(d[0], d[1]))) hit = true;
          else if (taintFn.has(key(d[0], d[1])) && calledHere(v.decl.init, id)) hit = true;
        };
        refs(v.decl.init, new Set(), onRef, enterAtLoad);
        if (hit) {taintVal.add(key(m.file, n)); changed = true}
      }
      // Statements that run at load and fill a module-scope value: for(...)TABLE.push(CITY[i]), TABLE[x]=ZONES[x].
      for (const st of m.ast.body) {
        if (st.type !== 'ExpressionStatement' && st.type !== 'ForStatement' && st.type !== 'ForOfStatement' && st.type !== 'ForInStatement' && st.type !== 'IfStatement' && st.type !== 'BlockStatement') continue;
        let reads = false; const writes = new Set();
        refs(st, new Set(), (r, id) => {
          const d = resolveName(m, r); if (!d || stopped.has(key(d[0], d[1]))) return;
          if (taintVal.has(key(d[0], d[1])) || (taintFn.has(key(d[0], d[1])) && calledHere(st, id))) reads = true;
        }, enterAtLoad);
        if (!reads) continue;
        const go = (n, p, k) => {
          if (n.type === 'AssignmentExpression') {const b = baseOf(n.left); if (b) writes.add(b)}
          if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression') {const b = baseOf(n.callee.object); if (b) writes.add(b)}
          for (const [kk, c] of kids(n)) go(c, n, kk);
        };
        go(st);
        for (const b of writes) if (m.vals.has(b) && !taintVal.has(key(m.file, b))) {taintVal.add(key(m.file, b)); m.vals.get(b).filled = true; changed = true}
      }
    }
  }
  function baseOf(n) {while (n && n.type === 'MemberExpression') n = n.object; return n && n.type === 'Identifier' ? n.name : null}
  function calledHere(root, id) {
    let yes = false;
    const go = n => {
      if (n.type === 'CallExpression' && n.callee === id) yes = true;
      if (n.type === 'CallExpression' && n.arguments.includes(id)) yes = true; // .map(skyFor)
      for (const [, c] of kids(n)) go(c);
    };
    go(root); return yes;
  }
  // Results.
  const sites = [];
  for (const m of mods.values()) {
    if (LIVE.has(m.file) || m.file === 'src/world/spec.js' || Object.keys(TABLES).includes(m.file)) continue;
    // what the module's onWorld hook assigns, following its calls inside the module
    const reset = new Set();
    const followed = new Set();
    const follow = fn => {
      const go = n => {
        if (n.type === 'AssignmentExpression') {const b = n.left.type === 'ObjectPattern' || n.left.type === 'ArrayPattern' ? patNames(n.left) : [baseOf(n.left)]; for (const x of b) if (x) reset.add(x)}
        if (n.type === 'UpdateExpression') {const b = baseOf(n.argument); if (b) reset.add(b)}
        if (n.type === 'CallExpression') {
          const c = n.callee;
          if (c.type === 'MemberExpression') {const b = baseOf(c.object); if (b && /^(clear|fill|set|add|delete|splice|push|length)$/.test(c.property.name)) reset.add(b)}
          if (c.type === 'MemberExpression' && c.object.name === 'Object' && c.property.name === 'assign') {const b = baseOf(n.arguments[0]); if (b) reset.add(b)}
          if (c.type === 'Identifier' && m.fns.has(c.name) && !followed.has(c.name)) {followed.add(c.name); follow(m.fns.get(c.name))}
        }
        for (const [, x] of kids(n)) go(x);
      };
      go(fn.body || fn);
    };
    const hookCalls = n => {
      if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'onWorld') {
        const a = n.arguments[0];
        if (isFn(a)) follow(a);
        else if (a && a.type === 'Identifier' && m.fns.has(a.name)) {followed.add(a.name); follow(m.fns.get(a.name))}
      }
      for (const [, c] of kids(n)) hookCalls(c);
    };
    hookCalls(m.ast);
    for (const [n, v] of m.vals) if (taintVal.has(key(m.file, n))) sites.push({file: m.file, name: n, line: v.line, kind: 'capture', rebound: reset.has(n)});
    // Memos: a module-scope binding assigned or filled inside a function from map code.
    const seen = new Set();
    for (const [fname, fn] of m.fns) {
      const sh = localsOf(fn);
      const go = n => {
        const note = (b, rhs) => {
          if (!b || sh.has(b) || !m.vals.has(b) || taintVal.has(key(m.file, b)) || seen.has(b)) return;
          // Read from the map on the spot, or a cache (null, or an empty Map) filled by a function that reads the map: NET={stops,...}, cache.set(key,grid).
          const d = m.vals.get(b).decl.init, cacheLike = d && ((d.type === 'Literal' && d.value === null) || (d.type === 'NewExpression' && /^(Map|WeakMap)$/.test(d.callee.name)));
          let hit = !!cacheLike && taintFn.has(key(m.file, fname));
          refs(rhs, sh, r => {if (isTaint(m, r)) hit = true}, () => true);
          if (hit) {seen.add(b); sites.push({file: m.file, name: b, line: m.vals.get(b).line, kind: 'memo', rebound: reset.has(b), by: fname})}
        };
        if (n.type === 'AssignmentExpression') note(baseOf(n.left), n.right);
        if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && /^(set|push|add)$/.test(n.callee.property.name)) note(baseOf(n.callee.object), n);
        for (const [, c] of kids(n)) go(c);
      };
      go(fn.body);
    }
  }
  return sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

// Where src reads the map's first dungeon or its lair as if it were there (#1013): a map may have neither, and the two are null.
// A member of it (CRYPT.name), of a fallback ending in it ((x||CRYPT).name), or handing it to a call (dist(p,LAIR)). The readers
// (sim/crypts.js, sim/lair.js) and the files that build the two are the places that may. A test of it (CRYPT&&, D===CRYPT, x||CRYPT) is
// not a read. A local or parameter of the name is not it; `D=CRYPT` then `D.x` is out of reach of this, so it is a net, not a proof.
export const BARE_READERS = new Set(['src/sim/crypts.js', 'src/sim/lair.js', 'src/world/map.js', 'src/world/gen.js']);
export function bareReads({root = ROOT} = {}) {
  const out = new Map(), BARE = /^(CRYPT|LAIR)$/;
  for (const f of ['sim', 'data', 'world', 'core', 'render', 'ui'].flatMap(l => {try {return walkDir(join(root, 'src', l))} catch {return []}}).filter(f => f.endsWith('.js'))) {
    const rel = relative(root, f).split(sep).join('/'), src = readFileSync(f, 'utf8'), ast = parseAst(src);
    if (BARE_READERS.has(rel)) continue;
    const named = new Set();
    for (const n of ast.body) if (n.type === 'ImportDeclaration' && /(world\/|^\.\/)map\.js$/.test(n.source.value)) for (const s of n.specifiers) if (s.imported && BARE.test(s.imported.name)) named.add(s.local.name);
    if (!named.size) continue;
    const hits = [], line = n => src.slice(0, n.start).split('\n').length;
    const it = (n, sh) => n && n.type === 'Identifier' && named.has(n.name) && !sh.has(n.name);
    const go = (n, sh) => {
      if (isFn(n)) sh = new Set([...sh, ...localsOf(n)]);
      if (n.type === 'MemberExpression' && (it(n.object, sh) || (n.object.type === 'LogicalExpression' && it(n.object.right, sh)))) hits.push(line(n));
      if (n.type === 'CallExpression') for (const a of n.arguments) if (it(a, sh)) hits.push(line(a));
      for (const [, c] of kids(n)) go(c, sh);
    };
    go(ast, new Set());
    if (hits.length) out.set(rel, hits);
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = scan();
  for (const x of s) console.log(`${x.rebound ? 'ok ' : '   '} ${x.kind.padEnd(7)} ${x.file}:${x.line} ${x.name}${x.by ? ' (by ' + x.by + ')' : ''}`);
  console.log(`\n${s.length} sites, ${s.filter(x => x.rebound).length} rebound`);
}
