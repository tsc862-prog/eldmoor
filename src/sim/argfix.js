// The door every tool call goes through (scripts/toolfuzz.mjs found why it is needed): arguments made to fit the tool's own table
// before the game reads them, and a refusal that says what is missing instead of printing "undefined".
//   cleanArgs(tool, args)        -> args as the table says they should be. Only what the table rules out is touched: an object or an
//                                   array where a string or number belongs, a non-finite number, a fraction for an integer, null.
//                                   A well-formed call comes through unchanged (same keys, same values), and keys the table does
//                                   not list (the relay's _pool, _sem, _poll) are kept.
//   polishRefusal(tool, args, r) -> r with its error text mended: "No pack entry undefined." when the call left out index becomes
//                                   "index is missing (Pack index from inventory)", and a one-word refusal ("Say what?") gets the
//                                   argument that answers it. Words only; no refusal turns into success.
// No RNG, no state: nothing here can move a seeded hash.
const PLAIN = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const JS_ERR = /Cannot read propert|Cannot set propert|is not a function|is not defined|is not iterable|Cannot destructure|TypeError|RangeError|ReferenceError/; // a thrown error is never reworded: it is a bug to see
const BAD = /\bundefined\b|\bNaN\b|\[object Object\]/;

export function cleanArgs(tool, args) {
  if (!PLAIN(args)) return {};
  const spec = tool && tool.args;
  if (!spec) return args;
  let out = null;
  const set = (k, v) => {if (!out) out = {...args}; if (v === undefined) delete out[k]; else out[k] = v};
  for (const k of Object.keys(spec)) {
    if (!Object.hasOwn(args, k)) continue;
    const v = args[k], t = spec[k].type;
    if (v === undefined) continue;
    const word = t === 'string' || t === 'integer' || t === 'number';
    if (v === null) {if (word) set(k, undefined); continue} // null is "left out" for a word or a number; a shape is read by its tool
    if (t === 'string') {if (Array.isArray(v) || (typeof v === 'object' && !(Number.isFinite(v.x) && Number.isFinite(v.y))) || typeof v === 'function' || typeof v === 'symbol') set(k, undefined)} // a point {x, y} is kept: near and at read it
    else if (t === 'integer' || t === 'number') {
      if (typeof v === 'object' || typeof v === 'function') set(k, undefined);
      else if (typeof v === 'string') {if (/^\s*[-+]?(\d|\.\d)/.test(v) && !Number.isFinite(Number(v))) set(k, undefined)} // "1e999"
      else if (typeof v === 'number') {if (!Number.isFinite(v)) set(k, undefined); else if (t === 'integer' && !Number.isInteger(v)) set(k, Math.trunc(v))}
    } // arrays, objects and booleans are validated by the tool itself (a cast that is not an object is refused there)
  }
  return out || args;
}

const missingOf = (tool, args) => {
  const spec = (tool && tool.args) || {};
  return Object.keys(spec).filter(k => !spec[k].optional && (!args || args[k] === undefined || args[k] === null || args[k] === ''));
};
const hint = (tool, ks) => ks.map(k => k + (tool.args[k].desc ? ' (' + String(tool.args[k].desc).replace(/\s+/g, ' ').slice(0, 90).replace(/[.\s]+$/, '') + ')' : '')).join(', ');

export function polishRefusal(tool, args, r) {
  if (!r || r.ok !== false || !tool) return r;
  const e = typeof r.error === 'string' ? r.error.trim() : '', bad = BAD.test(e);
  if (JS_ERR.test(e)) return r;
  if (!bad && e.split(/\s+/).filter(Boolean).length >= 3) return r;
  const miss = missingOf(tool, args), need = miss.length ? (miss.length === 1 ? 'Missing argument: ' : 'Missing arguments: ') + hint(tool, miss) + '.' : '';
  if (bad) r.error = need ? need : e.replace(/\bundefined\b|\bNaN\b|\[object Object\]/g, 'that') + ' Check the arguments of ' + tool.name + ' and try again.';
  else r.error = (e ? e + ' ' : 'Not done. ') + (need || 'Check the arguments of ' + tool.name + ' and try again.');
  return r;
}
