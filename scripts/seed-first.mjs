// Import this FIRST in a seeded check (#888). Some tables are rolled once when their module loads (the auction house's
// opening stock in data/items.js, which init() then restores), before any seedRng() can run, so a check that seeds only
// after its imports starts from a different market in every process. The hash probes stub Math.random before importing for
// the same reason (scripts/hashcheck.mjs); this does it for a check with static imports. A fixed LCG: the same on every machine.
let seed = 0x573a;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
