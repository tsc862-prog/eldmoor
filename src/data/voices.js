// Voices as data (issue #554, the narrator voice). Which local text-to-speech voice speaks which kind of speaker.
// Pure table and pure picking: no RNG, the same speaker always gets the same voice. Names are Kokoro-82M voice ids
// (af_ american female, am_ american male, bf_ british female, bm_ british male); the relay maps a name the engine does
// not offer to the engine's default voice. The audio is for the watcher only: speaking changes nothing about who hears
// what in the game.
export const NARRATOR = 'bm_george';
export const POOL = ['af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'am_adam', 'am_michael', 'bf_emma', 'bf_isabella', 'bm_lewis', 'bm_daniel'];
// One voice per townsfolk role; roles not listed fall to the faction pool.
export const ROLE = {innkeeper: 'af_nicole', smith: 'am_adam', quartermaster: 'am_michael', priest: 'bf_emma', bard: 'af_bella', captain: 'bm_lewis',
  peddler: 'am_michael', hermit: 'bm_daniel', drover: 'am_adam', sellsword: 'bm_lewis', minstrel: 'bf_isabella', stranger: 'bm_daniel'};
// A faction's people, by faction index (a new faction needs no row: the index wraps).
export const FACTION = [['bf_emma', 'bm_lewis', 'af_sarah', 'bm_george'], ['am_adam', 'af_nicole', 'am_michael', 'af_bella']];
export const hashOf = s => {let x = 2166136261; for (const c of String(s)) {x ^= c.charCodeAt(0); x = Math.imul(x, 16777619)} return x >>> 0};
// speaker: {kind: 'narrator'|'npc'|'hero', role?, fac?, name?, cls?, sex?}
export function pickVoice(sp = {}) {
  if (!sp || !sp.kind || sp.kind === 'narrator') return NARRATOR;
  const key = [sp.name || '', sp.cls || '', sp.sex || '', sp.fac == null ? '' : sp.fac].join('|');
  if (sp.kind === 'npc') {
    if (sp.role && ROLE[sp.role]) return ROLE[sp.role];
    const f = Number.isInteger(sp.fac) ? FACTION[sp.fac % FACTION.length] : POOL;
    return f[hashOf(key) % f.length];
  }
  return POOL[hashOf(key) % POOL.length]; // a hero: hash of name, class, sex and faction
}
