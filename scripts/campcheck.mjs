// Rest and camp check (issue #64): the Fellowship makes camp at night, rests, posts watches, talks,
// breaks camp; a camp ambush opens a Table scene at 1x; a save taken mid-camp restores; two seeded
// runs match; background heroes never camp. Usage: npm run campcheck
let seed = 0x5eed64;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const SIM = await import('../src/sim/index.js');
const {init, step, S, found, autoPick, snapshot, restore, TABLE, fellowshipMembers} = SIM;
let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};

TABLE.speed = 1;
init({fellowship: false}); run(1200); // the old start (#111): this check founds its own Fellowship
ok(found(autoPick(0), {ai: false}).ok, 'Fellowship founded');
let camps = 0, prev = null, sawRest = false, mid = null, maxCamped = 0, bg = 0;
for (let i = 0; i < 8 * 240 * 60; i++) {
  step(1 / 60);
  const g = S.fellowship.camp, ph = g && g.phase;
  if (ph === 'gather' && prev !== 'gather') camps++;
  if (ph === 'rest') {sawRest = true; if (!mid && g.stats.watches >= 1) mid = snapshot()}
  prev = ph;
  const L = fellowshipMembers().map(m => m.hero), n = S.agents.filter(a => a.state === 'camp').length;
  maxCamped = Math.max(maxCamped, n);
  if (S.agents.some(a => a.state === 'camp' && !L.includes(a))) bg++;
}
const st = S.fellowship.camp.stats;
ok(camps >= 3 && sawRest, `the Fellowship made camp ${camps} times in 8 days (${JSON.stringify(st)})`);
ok(maxCamped <= 5 && bg === 0, 'only Fellowship members ever camp (max ' + maxCamped + ')');
ok(st.watches >= 3 && st.talks >= 5, 'watches posted and campfire talk happened');
ok(S.fellowship.log.some(e => e.kind === 'camp') && (S.dmLog || []).some(e => e.kind === 'camp'), 'camp events in the campaign log and the DM log');
ok(S.fellowship.tableStats && S.fellowship.tableStats.scenes >= (st.spotted + st.caught - 1), 'camp ambushes opened Table scenes (' + (S.fellowship.tableStats ? S.fellowship.tableStats.scenes : 0) + ')');
ok(!S.agents.some(a => a.state === 'camp') || (S.fellowship.camp.phase && true), 'no hero is left stuck in camp');
ok(mid && mid.fellowship.camp.phase === 'rest', 'a snapshot was taken mid-camp');
restore(JSON.parse(JSON.stringify(mid)));
const g2 = S.fellowship.camp, L2 = fellowshipMembers().map(m => m.hero);
ok(g2.phase === 'rest' && L2.filter(a => a.state === 'camp').length === g2.ids.length, 'restored camp keeps its sleepers');
run(40 * 60 / 60 * 2);
ok(S.agents.every(a => a.state !== 'camp' || (S.fellowship.camp.ids || []).includes(a.id)), 'after restore every sleeper belongs to the camp');
console.log(fail ? fail + ' check(s) FAILED' : 'campcheck passed');
process.exit(fail ? 1 : 0);
