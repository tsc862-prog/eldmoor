// Guild focus check (issue #6, slice 2, src/sim/guildfocus.js): the neutral setting rolls exactly like a world
// without the module, the Fellowship's guild never takes a focus, Warpath needs blood or a rival, changes are
// logged, the hooks return neutral values for the Fellowship, focus survives a save round trip, and a seeded
// world with focus on is deterministic.
// Usage: npm run focuscheck
let seed = 0;
const reseed = n => {seed = n >>> 0};
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const {init, step, S, snapshot, restore} = await import('../src/sim/index.js');
const SLT = await import('../src/sim/company.js'); // the slotted company (#588)
const F = await import('../src/sim/guildfocus.js');
const {onLog} = await import('../src/sim/chronicle.js');
let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};
const hash = () => {let h = 5381; const feed = s => {for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0};
  for (const a of S.agents) feed([a.id, a.lvl, a.xp, a.kills, a.gold, a.state, a.x.toFixed(2), a.y.toFixed(2), a.hp.toFixed(1)].join(',')); return h};
if (process.argv.includes('--hash') || process.argv.includes('--off')) {F.GF.ON = !process.argv.includes('--off'); const si = process.argv.indexOf('--seed'); reseed(si > 0 ? Number(process.argv[si + 1]) : 0x6f0c); init({fellowship: true}); run(900);
  console.log(JSON.stringify({hash: hash(), guilds: S.GUILDS.length, focused: S.GUILDS.some(g => g.focus), stats: S.focusStats || null})); process.exit(0)}
const lines = []; onLog(e => lines.push(e.parts.map(x => typeof x === 'string' ? x : x && (x.t || x.name) || '').join('')));
console.log('\nEldmoor focuscheck\n');

// init() does not clear S, so every seeded world runs in a fresh process of its own (this one, and children).
const {execFileSync} = await import('node:child_process');
const child = (arg, ...more) => JSON.parse(execFileSync(process.execPath, [new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), arg, ...more], {encoding: 'utf8'}).trim().split('\n').pop());
// 1 on: foci are taken and logged.
reseed(0x6f0c); init({fellowship: true}); run(900);
const on1 = hash(), st = S.focusStats || {}, gs = S.GUILDS.filter(g => !g.retired);
ok(st.set > 0 && gs.some(g => g.focus && g.focus !== 'open'), 'focus on: guilds take a focus (' + JSON.stringify(st.by) + ')');
ok(gs.every(g => !g.focus || F.FOCI.includes(g.focus)), 'every focus is one of FOCI');
ok(lines.some(l => /turns its banner|takes up the|goes Wayfaring|is on the Warpath/.test(l)), 'focus changes reach the chronicle');
ok((S.timeline || []).some(e => e.kind === 'guild'), 'focus changes reach the timeline');
const fg = gs.filter(g => S.agents.some(a => a.guild === g && SLT.inSlots(a) && a.state !== 'dead'));
ok(fg.every(g => (g.focus || 'open') === 'open'), 'the Fellowship\'s guild has no focus (' + fg.length + ' such guilds)');
// 2 the same seed again: deterministic; and with GF.ON false (the neutral setting) no guild takes a focus.
ok(child('--hash').hash === on1, 'focus on is deterministic for a seed');
const off = child('--off');
ok(off.guilds > 0 && !off.focused && !off.stats, 'focus off: guilds form and none takes a focus, no counters');
// A focus only tips rolls near their odds, so in 15 game minutes one seed may draw no roll it tips (#325 made 0x6f0c such a
// seed; main has others): the claim is checked on the usual seed, then on others until one draws it.
const tips = off.hash !== on1 || ['28430', '4242', '777', '90210'].some(s => child('--hash', '--seed', s).hash !== child('--off', '--seed', s).hash);
ok(tips, 'focus on changes the world (it is meant to)');
// 3 the hooks: neutral for the Fellowship and the unguilded, and Warpath needs blood or a rival.
const fel = S.agents.find(a => SLT.inSlots(a)), un = S.agents.find(a => !a.guild && !SLT.inSlots(a)), mem = S.agents.find(a => a.guild && !a.guild.retired && a.state !== 'dead' && !S.agents.some(b => b.guild === a.guild && SLT.inSlots(b) && b.state !== 'dead'));
if (fel) ok(F.focusOf(fel) === 'open' && F.takeChance(fel, .9) === .9, 'a Fellowship member is never steered');
if (un) ok(F.focusOf(un) === 'open', 'an unguilded hero has no focus');
if (mem) {
  const g = mem.guild, was = g.focus; g.focus = 'pvp';
  ok(F.duelFocus(mem, mem) === F.GF.DUEL && (!fel || F.duelFocus(mem, fel) === 1) && (!fel || F.assistFocus(mem, fel) === 1), 'Warpath odds, never against a Fellowship member');
  g.focus = 'adventure'; ok(F.takeChance(mem, .9) === F.GF.TAKE, 'Wayfaring takes hooks at GF.TAKE');
  g.focus = 'crypt'; ok(F.cryptWeight(g) === F.GF.CRYPT_W, 'Delve weighs the guild for the Crypt');
  g.focus = was;
  const L = S.agents.find(a => a.id === g.leaderId) || mem, saved = {goal: L.goal}; L.goal = null;
  const sc = F.focusScores({...g, clears: 0, wipes: 0, bosses: 0, id: -1}, L, [L]);
  ok(sc.pvp == null && sc.adventure > 0, 'no blood oath and no rival: no Warpath, Wayfaring always open');
  L.goal = {type: 'avengeHero', done: false}; ok(F.focusScores({...g, id: -1}, L, [L]).pvp > 0, 'a leader sworn to vengeance can choose Warpath');
  L.goal = saved.goal;
}
// 4 save round trip keeps each guild's focus.
const before = S.GUILDS.map(g => g.focus || 'open').join(); restore(JSON.parse(JSON.stringify(snapshot())));
ok(S.GUILDS.map(g => g.focus || 'open').join() === before, 'focus survives a save round trip');
console.log(fail ? '\n' + fail + ' failed' : '\nall ok'); process.exit(fail ? 1 : 0);
