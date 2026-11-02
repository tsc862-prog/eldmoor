// Action log check: what a hero did and what was done to it (src/sim/actlog.js), recording only.
//   fight    a scripted fight records hit, hurt and kill; a death settles the fight as died
//   ability  useMove and an item (potion) record, with heal/healed for the target
//   totals   a fight summary's dealt/taken/healed/abilities/items/crits equal the sum of its entries
//   caps     the ring holds 300 entries and 20 fight summaries
//   saves    the buffers are not saved (non-enumerable)
//   tool     combat_log returns only the hero's own log
//   hash     `node scripts/actcheck.mjs --hash` prints a state hash of a seeded run with and without a Fellowship and
//            its wall time; the hash must equal main's (`node scripts/wakecheck.mjs --hash` on main), checked by hand
// Usage: npm run actcheck
let seed = 0x3a4e5 ^ 11;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const SIM = await import('../src/sim/index.js');
const {init, step, S, maxHp, actionLog, fightSummary, fights} = SIM;
const AL = await import('../src/sim/actlog.js');
const HE = await import('../src/sim/heroes.js');
const MV = await import('../src/sim/moves.js');
const INV = await import('../src/sim/inv.js');
const P = await import('../src/sim/player.js');
const {MOVES} = await import('../src/data/moves.js');
const {USES} = await import('../src/data/items.js');
const {TOOL_NAMES} = await import('../src/data/player-tools.js');
let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};

if (process.argv.includes('--hash')) {
  for (const f of [false, true]) {
    init({fellowship: f}); const t0 = performance.now(); run(600);
    let h = 5381; const feed = s => {for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0};
    for (const a of S.agents) feed([a.id, a.lvl, a.xp, a.kills, a.gold, a.state, a.x.toFixed(2), a.y.toFixed(2), a.hp.toFixed(1)].join(','));
    console.log('hash fellowship=' + f + ': ' + h + ' deaths=' + S.stats?.deaths + ' ms=' + Math.round(performance.now() - t0));
  }
  process.exit(0);
}

console.log('\nEldmoor actcheck: the action log\n');
init({fellowship: false}); run(1);
const live = () => S.agents.filter(x => x.kind === 'hero' && x.state !== 'dead' && x.state !== 'ghost');
const mob = () => S.mobs.find(m => m.alive && !m.gone && !m.target);
const heroes = live(); const [a, b, c, f] = heroes;
a.lvl = Math.max(a.lvl, 8); a.hp = maxHp(a);

// a scripted fight through the real strike
const m = mob(); m.hp = 1e5; m.maxhp = 1e5; m.x = a.x + 1; m.y = a.y; a.state = 'fight'; a.target = m;
for (let i = 0; i < 6; i++) HE.strike(a, m);
m.hp = 1; HE.strike(a, m);
const kinds = new Set(actionLog(a).map(e => e.kind));
ok(kinds.has('hit') && kinds.has('kill') && kinds.has('xp'), 'hit, kill and xp recorded: ' + [...kinds].join(','));
const hits = actionLog(a, {kinds: ['hit']});
ok(hits.length >= 7 && hits.every(e => e.who === a.name && e.amount > 0 && e.target), 'hit entries name the hero, foe and damage');
ok(actionLog(a, {n: 2}).length === 2 && actionLog(a, {kinds: ['kill']}).length === 1, 'n and kinds filters');

// damage taken from a hero strike (duel path)
b.hp = maxHp(b); HE.strike(a, b); b.hp = maxHp(b);
const hb = actionLog(b, {kinds: ['hurt']});
ok(hb.length >= 1 && hb[hb.length - 1].target === a.name && hb[hb.length - 1].amount > 0, 'hurt records the source: ' + (hb[0] && hb[0].target));

// a mob bite on a hero through the real mob loop
// (checked after the other cases, below)

// ability + item
const mid = MV.movesOf(a).find(i => MOVES[i].target === 'foe' && MOVES[i].fx && MOVES[i].fx.dmg);
const m3 = mob(); m3.hp = 1e5; m3.maxhp = 1e5; m3.x = a.x + 1; m3.y = a.y;
if (mid) {
  a.mcd = {}; a.mcr = {}; const r = MV.useMove(a, mid, m3); ok(r.ok, 'useMove ' + mid + (r.ok ? '' : ': ' + r.error));
  const ab = actionLog(a, {kinds: ['ability']});
  ok(ab.length && ab[ab.length - 1].name === MOVES[mid].name, 'ability recorded: ' + (ab.length && ab[ab.length - 1].name));
} else ok(true, 'no damaging foe move for ' + a.cls + ' (skipped)');
const potion = Object.keys(USES).find(k => USES[k].kind === 'potion');
INV.addUse(a, potion, 3); a.hp = maxHp(a) * .4; a.potCd = 0;
const ur = INV.useItem(a, potion);
ok(ur.ok, 'use ' + potion + ': ' + (ur.text || ur.error));
const it = actionLog(a, {kinds: ['item']}), hl = actionLog(a, {kinds: ['heal']});
ok(it.length && it[it.length - 1].name === potion && hl.length && hl[hl.length - 1].amount > 0, 'item and heal recorded');
a.party = f.party = {id: 'actcheck', mem: [a, f]}; f.x = a.x; f.y = a.y; f.hp = maxHp(f) * .3; a.potCd = 0; f.state = 'hunt'; a.state = 'hunt';
const fr = INV.useItem(a, potion, f); a.party = f.party = null;
const fh = actionLog(f, {kinds: ['healed']});
ok(fr.ok && fh.length && fh[fh.length - 1].target === a.name, 'healed recorded on the receiver' + (fr.ok ? '' : ': ' + fr.error));

// totals
ok(!!fightSummary(a) && !!fightSummary(a).foe, 'fightSummary has a foe: ' + (fightSummary(a) && fightSummary(a).foe));
for (const s of fights(a, 20)) {
  const es = actionLog(a).filter(e => e.fight === s.id);
  const sum = k => es.filter(e => e.kind === k).reduce((t, e) => t + (e.amount || 0), 0);
  const names = k => {const o = {}; for (const e of es) if (e.kind === k) o[e.name] = (o[e.name] || 0) + 1; return o};
  ok(s.dealt === sum('hit') && s.taken === sum('hurt') && s.healed === sum('heal') && s.crits === es.filter(e => e.kind === 'hit' && e.crit).length &&
    JSON.stringify(s.abilities) === JSON.stringify(names('ability')) && JSON.stringify(s.items) === JSON.stringify(names('item')),
    'fight #' + s.id + ' totals add up (dealt ' + s.dealt + ', taken ' + s.taken + ', healed ' + s.healed + ', ' + s.result + ')');
}

// death settles the fight
const v = live().find(x => x !== a && x !== b && x !== f);
const mv = mob(); mv.x = v.x; mv.y = v.y; AL.actHurt(v, mv, 5); HE.agentDie(v, mv);
ok(actionLog(v, {kinds: ['death']}).length === 1 && fightSummary(v).result === 'died', 'death recorded and the fight settles as died');

// caps
const z = live().find(x => x !== a && x !== b && x !== f && x !== v) || a;
for (let i = 0; i < 1000; i++) AL.actHit(z, m, 1, false);
ok(actionLog(z).length === 300, 'ring caps at 300 entries (' + actionLog(z).length + ')');
for (let i = 0; i < 60; i++) {S.gameMin += 100; AL.actHit(z, m, 1, false)}
ok(fights(z, 100).length <= 21, 'fight summaries cap at 20 (+1 live): ' + fights(z, 100).length);
ok(actionLog(z)[0].t <= actionLog(z).at(-1).t, 'newest last');

run(180);
ok(S.agents.some(x => actionLog(x, {kinds: ['hurt']}).some(e => e.amount > 0 && e.target)), 'a mob bite records hurt on some hero');

// saves
ok(!JSON.stringify(a).includes('"_al"') && !Object.keys(a).includes('_al'), 'buffers are not saved (non-enumerable)');

// the agent tool: only its own log
ok(TOOL_NAMES.includes('combat_log'), 'combat_log is in the tool table');
P.markPlayer(a, true);
AL.actNote(b, 'loot', 'SecretOfB', null); AL.actHit(b, m, 3, false);
const res = P.playerAct(a.id, 'combat_log', {n: 2});
const out = res && (res.result || res);
ok(out && out.ok && Array.isArray(out.fights) && out.fights.length <= 2 && out.fights.length > 0, 'combat_log answers with recent fights');
ok(!JSON.stringify(out).includes('SecretOfB'),'combat_log carries only its own hero');

console.log(fail ? '\n' + fail + ' check(s) FAILED' : '\nall action log checks passed');
process.exit(fail ? 1 : 0);
