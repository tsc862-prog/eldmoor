// Semantic memory search, the game's half (issue #553). The sim never calls a network: meaning is ranked by the
// relay (scripts/embed.mjs, local embeddings through Ollama), which hands the tool a map of
// {key: strength 0..1} (`_sem`), and the game folds it into the keyword score it already has. A key is the hash of
// the text that was embedded, so the relay's vector cache never needs the game's ids and a rewritten note simply
// has a new key. No imports, no RNG: the same arguments always rank the same.
export const SEM = {MAX: 2, POOL: 600, TEXT: 1200}; // MAX: the most a meaning match adds to a hit's score (a title or tag word is worth 3, so keywords still win)
// Two FNV-1a passes (different seeds) -> 16 hex characters.
export function semKey(text) {
  const s = String(text == null ? '' : text); let a = 0x811c9dc5, b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < s.length; i++) {const c = s.charCodeAt(i); a = Math.imul(a ^ c, 16777619) >>> 0; b = Math.imul(b ^ c ^ (i & 255), 0x85ebca6b) >>> 0}
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
// The relay's map, cleaned: plain object of finite 0..1 values keyed by 16 hex characters, else null.
export function semOf(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out = {}; let n = 0;
  for (const k of Object.keys(v)) {if (!/^[0-9a-f]{16}$/.test(k)) continue; const x = Number(v[k]); if (Number.isFinite(x) && x > 0) {out[k] = Math.min(1, x); if (++n >= SEM.POOL * 2) break}}
  return n ? out : null;
}
export const semBonus = x => (Number.isFinite(x) && x > 0 ? SEM.MAX * Math.min(1, x) : 0);
