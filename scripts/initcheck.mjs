// init() reset check (#507): a second init() in one process builds exactly the world a fresh process builds.
// Math.random is a seeded stub restarted before each init, so the worlds are comparable by hash.
// Usage: node scripts/initcheck.mjs
// (core/rng.js captures Math.random at load, so the stub is installed once and only its state is reset)
let seed = 0; const reseed = () => {seed = 0x3a4e5 ^ 11};
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
reseed();
const {init, step, S, snapshot} = await import('../src/sim/index.js');
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};
const hash = () => {let h = 5381; const feed = s => {for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0};
  for (const a of S.agents) feed([a.id, a.lvl, a.xp, a.kills, a.gold, a.state, a.x.toFixed(2), a.y.toFixed(2), a.hp.toFixed(1)].join(','));
  feed(JSON.stringify(S.companies.map(c => [c.id, c.ids]))); return h};
let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
console.log('\nEldmoor initcheck\n');
for (const f of [false, true]) {
  const o = {fellowship: f};
  reseed(); init(o); const h0 = hash(), n0 = S.agents.length, c0 = S.companies.length; run(120); const r0 = hash();
  const wid = S.worldId;
  reseed(); init(o); const h1 = hash();
  ok(S.agents.length === n0 && S.companies.length === c0, `fellowship=${f}: same hero and company counts after a second init (${n0}/${c0})`);
  ok(h1 === h0, `fellowship=${f}: hash after init twice equals one init (${h0})`);
  ok(S.worldId !== wid, 'a second init is a new world instance');
  ok(S.companies.every(c => c.ids.every(id => S.agents.some(a => a.id === id && a.company === c.id))), 'every company member id names its own hero');
  run(120); ok(hash() === r0, `fellowship=${f}: and the run after it matches (${r0})`);
  reseed(); init(o); reseed(); init(o); init(o);
}
const s1 = JSON.stringify(Object.keys(snapshot()).sort());
ok(s1.length > 2, 'snapshot works after repeated init');
process.exit(fail ? 1 : 0);
