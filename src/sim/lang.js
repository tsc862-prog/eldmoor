// English only (issue #126): a small local model drifted into Chinese, then Thai mixed with Chinese, and
// its lines reached the game chat. A simple check: of the letters in a text, at least LATIN_SHARE must be
// Latin script (A-Z with accents). Used by the local agent loop (scripts/local-agent.mjs) and the game's say
// and party_say tools (sim/player.js), so no foreign-script line reaches the chat. DOM-free, no imports.
export const LATIN_SHARE=0.8;
export function notEnglish(s){const t=String(s==null?'':s),letters=t.match(/\p{L}/gu);if(!letters||letters.length<3)return false;
  let latin=0;for(const c of letters)if(/[A-Za-zÀ-ɏ]/.test(c))latin++;
  return latin/letters.length<LATIN_SHARE}
