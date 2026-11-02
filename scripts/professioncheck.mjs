// Professions check (issue #254): the table, learn/refuse, skill gain and cap, save round trip, an older save without
// a.profs, and that the scripted world is untouched (the seeded hash is printed with --hash, same recipe as wakecheck).
// Usage: npm run professioncheck   |   node scripts/professioncheck.mjs --hash
let seed = 0x3a4e5 ^ 11;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const SIM = await import('../src/sim/index.js');
const {init, step, S, snapshot, restore} = SIM;
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};
if (process.argv.includes('--hash')) {
  for (const f of [false, true]) {
    init({fellowship: f}); run(600);
    let h = 5381; const feed = s => {for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0};
    for (const a of S.agents) feed([a.id, a.lvl, a.xp, a.kills, a.gold, a.state, a.x.toFixed(2), a.y.toFixed(2), a.hp.toFixed(1)].join(','));
    console.log('hash fellowship=' + f + ': ' + h + ' deaths=' + S.stats?.deaths);
  }
  process.exit(0);
}
const {PROF, PROF_IDS, MAX_PROF, SKILL_MAX} = await import('../src/data/professions.js');
const P = await import('../src/sim/professions.js');
let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
console.log('\nEldmoor professioncheck\n');
ok(PROF_IDS.length === 9 && PROF_IDS.every(id => PROF[id].id === id && PROF[id].name && PROF[id].blurb), 'nine professions, each with id, name, blurb');
ok(PROF_IDS.filter(i => PROF[i].kind === 'gather').length === 4 && PROF_IDS.filter(i => PROF[i].kind === 'craft').length === 5, 'four gather, five craft');
init({fellowship: false});
const a = S.agents.find(x => x.kind === 'hero');
ok(P.professionsOf(a).length === 0 && P.skillOf(a, 'mining') === 0 && a.profs === undefined, 'a fresh hero has none, reads as []');
ok(P.learn(a, 'mining').ok && P.skillOf(a, 'mining') === 1, 'learn starts at skill 1');
ok(!P.learn(a, 'mining').ok, 'a duplicate is refused');
ok(P.learn(a, 'smithing').ok, 'a second profession is learned');
const third = P.learn(a, 'cooking');
ok(!third.ok && /2/.test(third.why) && P.professionsOf(a).length === MAX_PROF, 'a third is refused');
ok(!P.learn(a, 'nonsense').ok, 'an unknown id is refused');
ok(!P.gainSkill(a, 'cooking', 5).ok, 'no gain for a profession not held');
ok(!P.gainSkill(a, 'mining', 0).ok && !P.gainSkill(a, 'mining', -3).ok && !P.gainSkill(a, 'mining', NaN).ok, 'gain must be a positive amount');
let r = P.gainSkill(a, 'mining', 0.5); ok(r.ok && r.skill === 1 && !r.up, 'a fraction does not level yet');
r = P.gainSkill(a, 'mining', 0.5); ok(r.skill === 2 && r.up, 'two halves make a point (deterministic)');
P.gainSkill(a, 'mining', 1000);
ok(P.skillOf(a, 'mining') === SKILL_MAX && !P.gainSkill(a, 'mining', 5).up, 'skill caps at 100');
ok([1, 24, 25, 49, 50, 74, 75, 99, 100].map(P.skillBand).join() === '0,0,1,1,2,2,3,3,4', 'skill bands');
ok(a.prof === undefined || Array.isArray(a.prof), 'does not touch a.prof (ability skills)');
// save round trip
const snap = JSON.parse(JSON.stringify(snapshot()));
const hs = snap.agents.find(x => x.id === a.id);
ok(Array.isArray(hs.profs) && hs.profs.length === 2, 'a.profs is saved');
restore(snap);
const b = S.agents.find(x => x.id === a.id);
ok(P.skillOf(b, 'mining') === 100 && P.skillOf(b, 'smithing') === 1, 'a.profs restores');
// older save: no field; and a malformed one is cleaned
const old = JSON.parse(JSON.stringify(snapshot()));
for (const h of old.agents) delete h.profs;
old.agents.find(x => x.id === a.id).profs = [{id: 'fishing', skill: 500}, {id: 'fishing', skill: 3}, {id: 'zzz', skill: 4}, {id: 'cooking', skill: 0}, {id: 'mining', skill: 9}];
restore(old);
const c = S.agents.find(x => x.id === a.id), d = S.agents.find(x => x.kind === 'hero' && x.id !== a.id);
ok(P.professionsOf(d).length === 0, 'a save without a.profs loads with none');
ok(P.professionsOf(c).map(p => p.id + ':' + p.skill).join() === 'fishing:100,cooking:1', 'a malformed list is cleaned (dupes, unknown, over 2, clamped)');
run(5);
ok(true, 'the world keeps running after restore');
console.log(fail ? `\n${fail} FAILED` : '\nall ok'); process.exit(fail ? 1 : 0);
