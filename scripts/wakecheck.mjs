// More turn triggers check: XP, level ups, loot, quest progress wake an agent-played hero's runner.
//   xp       XP from 3 kills is one bundled soft news event (updated in place, not stacked)
//   level    a level up wakes at once and names what it unlocked (ability, passive, the level-10 path)
//   loot     a rare drop wakes at once; plain loot is soft news
//   quest    quest progress is soft; a finished quest wakes at once
//   scripted a scripted hero gets no events at all
//   hash     `node scripts/wakecheck.mjs --hash` prints a state hash of a seeded scripted run (with and without a
//            Fellowship, nobody agent-played); the hash must equal main's (checked by hand in the PR)
//   beat     the runner's default heartbeat is 120 game minutes, and a quiet hero's pace check wakes by then
// Usage: npm run wakecheck
let seed = 0x3a4e5 ^ (Number(process.env.WAKECHECK_SEED) || 11);
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const SIM = await import('../src/sim/index.js');
const {init, step, S, maxHp} = SIM;
const P = await import('../src/sim/player.js');
const HE = await import('../src/sim/heroes.js');
const PC = await import('../src/sim/pace.js');
const W = await import('../src/sim/wakes.js').catch(() => null);
const {PACE_DEFAULTS} = await import('./pacing.mjs');
const {wakeLevel} = await import('../src/sim/notify.js');
const {MOVES} = await import('../src/data/moves.js');
let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
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

console.log('\nEldmoor wakecheck: XP, level ups, loot and quest progress start agent turns\n');
init({fellowship: false}); run(1);
const hero = () => S.agents.find(x => x.kind === 'hero' && x.state !== 'dead' && !x.player);
const a = hero(); a.lvl = 5; a.xp = 0; a.hp = maxHp(a); P.markPlayer(a, true);
const b = S.agents.filter(x => x.kind === 'hero' && x.state !== 'dead' && !x.player)[0];
const fresh = () => {a.playEv = []; a.playEvSeen = 0; a.playPend = {}; a.playXp = null; a.playLoot = null};
const mob = (name, extra = {}) => ({name, type: 'boar', lvl: 3, ...extra});
const lastEv = () => a.playEv[a.playEv.length - 1];

// xp: 3 kills, one pending event
fresh();
const need0 = Math.round(60 * Math.pow(5, 1.45));
for (const n of ['Bristleback Boar', 'Bristleback Boar', 'Mire Leech']) {W.wakeKill(a, mob(n)); HE.gainXp(a, 30)}
const xpEv = a.playEv.filter(e => /XP/.test(e.text));
ok(xpEv.length === 1 && /\+90 XP from 3 kills \(Bristleback Boar x2, Mire Leech\); \d+ XP to level 6/.test(xpEv[0].text), `one bundled XP line: "${xpEv[0] && xpEv[0].text}"`);
ok(wakeLevel(xpEv[0]) === 1, 'XP news is soft (waits for the minimum gap)');
a.playEvSeen = xpEv[0].n; W.wakeKill(a, mob('Mire Leech')); HE.gainXp(a, 10);
ok(a.playEv.filter(e => /XP/.test(e.text)).length === 2 && /\+10 XP from 1 kill \(Mire Leech\)/.test(lastEv().text), 'after the agent read it, a new bundle starts');

// level up: at once, names the unlock
fresh();
const target = Object.values(MOVES).find(m => m.cls === a.cls && !m.spec && m.lvl > 1);
a.lvl = target.lvl - 1; a.xp = 0; HE.gainXp(a, 1e6);
const lv = a.playEv.find(e => /LEVEL UP/.test(e.text));
ok(lv && wakeLevel(lv) === 2 && new RegExp('ability ' + target.name).test(lv.text), `level up wakes at once and names the unlock: "${lv && lv.text}"`);
fresh(); a.lvl = 9; a.xp = 0; HE.gainXp(a, 1e6);
ok(a.playEv.some(e => /choose_specialisation/.test(e.text) && wakeLevel(e) === 2), 'level 10 names the specialisation choice');
a.lvl = 5; a.xp = 0;

// loot
fresh();
W.wakeLoot(a, 'Grave Dust'); W.wakeLoot(a, 'Grave Dust');
ok(a.playEv.length === 1 && wakeLevel(a.playEv[0]) === 1 && /Grave Dust x2/.test(a.playEv[0].text), 'plain loot is one soft bundled line');
W.wakeLoot(a, 'Moonsilver Blade', 'rare');
ok(wakeLevel(lastEv()) === 2 && /rare/i.test(lastEv().text), 'a rare drop wakes at once');
fresh(); HE.getEpic(a, 'Kragmaw\'s Tooth', 'Kragmaw');
ok(a.playEv.some(e => wakeLevel(e) === 2 && /epic/.test(e.text)), 'an epic wakes at once');

// quest
fresh(); a.quest = {type: 'boar', have: 1, need: 3}; W.wakeQuest(a, false);
ok(wakeLevel(lastEv()) === 1 && /1 of 3/.test(lastEv().text), 'quest progress is soft');
a.quest.have = 3; W.wakeQuest(a, true);
ok(a.playEv.length === 1 && /3 of 3/.test(lastEv().text), 'progress updates one pending event');
a.quest = null; W.wakeQuestDone(a, 'Hides for the tanner', 12);
ok(wakeLevel(lastEv()) === 2, 'a finished quest wakes at once');

// scripted
const n0 = (b.playEv || []).length;
W.wakeKill(b, mob('Boar')); W.wakeXp(b, 50, 100); W.wakeLevelUp(b, 90); W.wakeLoot(b, 'X', 'rare'); W.wakeQuestDone(b, 'q', 1);
HE.gainXp(b, 1e5);
ok((b.playEv || []).length === n0 && !b.playXp && !b.playPend, 'a scripted hero gets nothing');

// pace wake
fresh(); a.playEvSeen = 0;
HE.gainXp(a, 5);
const pc = PC.paceCheck(a.id, {minutes: 120});
ok(pc && pc.wake === 'soft' && /XP/.test(pc.why), `pace: XP news is a soft wake (${pc && pc.wake})`);
fresh(); a.playEvSeen = 0; HE.gainXp(a, 1e6);
ok(PC.paceCheck(a.id, {minutes: 120, wake: 'now'}).wake === 'now', 'pace: a level up is an at-once wake');
fresh();
const t0 = S.gameMin; a.playEvSeen = 1e9;
ok(PC.paceCheck(a.id, {since: t0, minutes: 120}) === null, 'a quiet hero is not woken early');
ok(PC.paceCheck(a.id, {since: t0 - 125, minutes: 120}).wake === 'heartbeat', 'a quiet hero takes a turn within the heartbeat');
ok(PACE_DEFAULTS.heartbeat === 120, 'default heartbeat is 120 game minutes');

console.log(fail ? `\n${fail} FAILED` : '\nall ok');
process.exit(fail ? 1 : 0);
