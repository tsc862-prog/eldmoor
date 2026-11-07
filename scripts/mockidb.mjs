// A small in-memory IndexedDB and a quota-limited localStorage for the checks that run src/ui/savestore.js in Node: only what that module
// calls. Answers come a microtask later, as the real one's come after the call. Several opens of one mock share its data, as pages share a browser's.
const later = f => queueMicrotask(f);
export function mockIdb() {
  const data = new Map();
  const store = tx => ({
    put(v, k) {tx.ops.push(() => data.set(k, v))},
    delete(k) {tx.ops.push(() => data.delete(k))},
    openCursor() {const rows = [...data], r = {result: null}; let i = 0; const step = () => later(() => {
      r.result = i < rows.length ? {key: rows[i][0], value: rows[i][1], continue() {i++; step()}} : null; if (r.onsuccess) r.onsuccess()}); step(); return r}});
  const db = {createObjectStore() {}, transaction() {const tx = {ops: [], objectStore: () => store(tx)};
    setTimeout(() => {if (mock.fail) {tx.error = new Error('QuotaExceededError'); if (tx.onabort) tx.onabort(); return} for (const f of tx.ops) f(); if (tx.oncomplete) tx.oncomplete()}, 0); return tx}};
  const mock = {fail: false, open() {const r = {result: db}; later(() => {if (r.onupgradeneeded) r.onupgradeneeded(); if (r.onsuccess) r.onsuccess()}); return r}, dump: () => data};
  return mock;
}
export function mockStorage(quota = Infinity) {
  const m = new Map(), used = () => [...m].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {get length() {return m.size}, key: i => [...m.keys()][i] ?? null, getItem: k => m.has(k) ? m.get(k) : null, removeItem: k => {m.delete(k)},
    setItem(k, v) {v = String(v); if (used() - (m.get(k) || '').length + v.length > quota) throw new Error('QuotaExceededError'); m.set(k, v)}};
}
