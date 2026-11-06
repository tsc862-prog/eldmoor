// Workflow guard (rulescheck rule 10): GitHub runs no jobs from a workflow file it cannot parse and shows the PR as BLOCKED
// with no failure on it (PR #597). No YAML parser is a declared dependency, so this is a strict line check for the mistakes
// that bit us: tab indentation, a flow mapping step (`- {name: ..., run: ...}`) that does not close, and a comma inside an
// unquoted value, which ends the value early. Returns [{line, why}] with the fix in plain words.
export function lintWorkflow(text) {
  const out = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1, add = why => out.push({line, why});
    if (/^\t| \t/.test(raw.match(/^\s*/)[0])) add('the line is indented with a tab; YAML allows only spaces. Replace the tab with spaces.');
    const m = raw.match(/^(\s*-\s+)\{(.*)$/);
    if (!m) return;
    const body = m[2].replace(/\s+#.*$/, '').trimEnd();
    if (!body.endsWith('}')) {add('the flow mapping step is not closed with "}" on the same line. Close it, or write the step as a block (name: / run: on their own lines).'); return}
    const inner = body.slice(0, -1);
    let depth = 0, q = '', cur = '', pieces = [];
    for (const ch of inner) {
      if (q) {cur += ch; if (ch === q) q = ''; continue}
      if ((ch === '"' || ch === "'") && /(^|[:[{,])\s*$/.test(cur)) {q = ch; cur += ch; continue}
      if ('[{'.includes(ch)) depth++; if (']}'.includes(ch)) depth--;
      if (ch === ',' && depth === 0) {pieces.push(cur); cur = ''; continue}
      cur += ch;
    }
    pieces.push(cur);
    if (q) {add('a quote in the flow mapping step is never closed. Close the quote.'); return}
    for (const p of pieces) {
      const t = p.trim();
      if (!/^[A-Za-z_][\w-]*\s*:(\s|$)/.test(t)) {
        add(`"${t}" is not "key: value", most likely because an unquoted value contains a comma, which ends it early. Put the whole value in quotes, for example name: "Foo (a, b)", or remove the comma.`);
        break;
      }
    }
  });
  return out;
}
