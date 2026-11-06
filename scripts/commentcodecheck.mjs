// A "//" comment runs to the end of the line, so code written after it never runs (#933).
// Flags a // comment whose text contains code-looking statements: ";" followed by an identifier and "(" or "=",
// or a call chain, and the comment ends in ; or }. Strings, regexes and URLs are skipped by a small scanner. Exit 1 on a hit.
import fs from 'node:fs';
import path from 'node:path';

const roots = ['src', 'scripts'];
const hits = [];

function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    if (f.name === 'node_modules' || f.name === 'packs' || f.name === 'space') continue;
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.m?js$/.test(f.name)) scan(p);
  }
}

// index of the // that starts a comment on this line, or -1
function commentStart(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && line[i + 1] === '/') { if (line[i - 1] === ':') continue; return i; }
    if (c === '/' && line[i + 1] === '*') { const j = line.indexOf('*/', i + 2); if (j < 0) return -1; i = j + 1; continue; }
    if (c === '/') { // a regex literal after an operator
      const prev = line.slice(0, i).trimEnd().slice(-1);
      if (prev === '' || '(,=:[!&|?{};'.includes(prev)) {
        let k = i + 1, cls = false;
        for (; k < line.length; k++) {
          const d = line[k];
          if (d === '\\') { k++; continue; }
          if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break;
        }
        if (k < line.length) { i = k; continue; }
      }
    }
  }
  return -1;
}

const CODE = /;\s*[A-Za-z_$][\w$.]*\s*(\(|=[^=])|\)\s*;\s*[A-Za-z_$][\w$.]*[.(]/;

function scan(p) {
  fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
    const at = commentStart(l);
    if (at < 0 || !l.slice(0, at).trim()) return; // none, or a comment on its own line
    const c = l.slice(at + 2);
    if (CODE.test(c) && /[;}]\s*$/.test(c)) hits.push(`${p}:${i + 1}: ${c.trim().slice(0, 110)}`);
  });
}

roots.forEach(walk);
if (hits.length) {
  console.log('code after a // comment (it never runs):');
  hits.forEach(h => console.log('  ' + h));
  process.exit(1);
}
console.log('commentcodecheck: no code hidden after a // comment');
