// Dungeon crawl check (issue #65): the Fellowship goes down the Sunken Crypt room by room, every round of
// every room a Table scene resolved by dice (sim/crawl.js), rooms read from the spec (CRYPT.rooms).
//   - the rooms are data in the world spec and name bestiary species
//   - the Fellowship's crawl opens room scenes in order, each resolves at the table (every living member
//     acts), and a seeded run repeats exactly (child runs)
//   - a retreat (most fall back), a driven-back party and a wipe at the table's dice are handled; the dead
//     are dead (hardcore), the table never sticks, the Crypt is free again
//   - a save taken mid-crawl resumes it; 8x resolves without stalling
//   - without a Fellowship the abstract roll runs and a seeded background world repeats exactly
//     (CRAWL_BASELINE_HASH=<hash from main> also asserts it equals main's)
// Usage: npm run crawlcheck   (CRAWLCHECK_SEED to vary)
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

let seed = 0x9e3779b9 ^ (Number(process.env.CRAWLCHECK_SEED) || 65);
const argv = process.argv.slice(2);
if (argv[0] === '--run') seed = 0x9e3779b9 ^ Number(argv[1]);
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};

const SIM = await import('../src/sim/index.js');
const {init, step, S, snapshot, restore, maxHp} = SIM;
const F_ = await import('../src/sim/fellowship.js');
const T = await import('../src/sim/table.js');
const D = await import('../src/sim/dungeon.js');
const {CRYPT} = await import('../src/world/map.js');
const {species} = await import('../src/sim/crawl.js');
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};

// Put the whole Fellowship at the Crypt door at level 9 and send them down.
function descend(lvl = 9) {
  init(); run(20);
  T.TABLE.speed = 1; T.TABLE.mode = 'auto';
  const M = F_.fellows(); S.mobs.length = 0;
  for (const a of M) {a.lvl = lvl; a.hp = maxHp(a); a.state = 'hunt'; a.hidden = false; a.target = null; a.dest = null; a.x = CRYPT.x + (Math.random() - .5); a.y = CRYPT.y + 1}
  D.musterCrypt(M, M[0].fac, null, S.fellowship.name);
  return M;
}
// Step until the crawl ends (the group is gone) or the budget runs out; collect the scenes seen.
function crawl(M, {act, maxS = 900, onScene} = {}) {
  const seen = []; let last = null, went = false;
  for (let f = 0; f < maxS * 60 && (CRYPT.group || !went); f++) {
    step(1 / 60); if (CRYPT.group) went = true;
    const sc = S.table;
    if (sc && sc.kind === 'crawl' && sc.id !== last) {last = sc.id; seen.push({id: sc.id, title: sc.title, room: sc.ctx.room, rd: sc.ctx.rd, ids: sc.ids.slice(), beats: 0}); if (onScene) onScene(sc)}
    if (sc && sc.kind === 'crawl') seen[seen.length - 1].beats = sc.beats.length;
    if (sc && sc.kind === 'crawl' && act && (sc.phase === 'frame' || sc.phase === 'turn')) for (const id of sc.ids) {const a = S.agents.find(x => x.id === id); if (a && a.state !== 'dead' && !sc.acts[id]) T.sceneAct(a, act(a, sc), 'test')}
  }
  return seen;
}
const signature = (M, seen) => JSON.stringify({scenes: seen.map(s => [s.room, s.rd]), alive: M.map(a => a.state === 'dead' ? 'x' : Math.round(a.hp)), lvl: M.map(a => a.lvl), xp: M.map(a => Math.round(a.xp)), gold: M.map(a => a.gold), t: Math.round(S.gameMin)});

if (argv[0] === '--run') {const M = descend(); const seen = crawl(M); console.log('SIG ' + signature(M, seen)); process.exit(0)}
if (argv[0] === '--hash' || argv[0] === '--hash-off') {
  if (argv[0] === '--hash-off') D.setCrawlHook(null); // the crawl unplugged: the world as it was before #65
  init({fellowship: false}); for (let i = 0; i < 1500 * 60; i++) step(1 / 60);
  let h = Math.round(S.gameMin); for (const a of S.agents) h = (Math.imul(h, 31) + a.lvl * 1000 + Math.round(a.xp) + Math.round(a.x * 10) * 7 + Math.round(a.hp) + a.deaths * 13 + Math.round(a.gold)) | 0;
  const gu = (S.GUILDS || []).reduce((t, g) => t + g.clears * 7 + g.wipes * 3, 0);
  console.log('HASH ' + h + ' guilds:' + gu); process.exit(0);
}

// Stepping section (#369): runs in a child with ELDMOOR_WORLD=stepping (the world is chosen at import).
if (argv[0] === '--stepping') {
  const sk = {n: 0}; const sok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); sk.n++}};
  const NAMES = ['The Reed Sump', 'The Salt-Bone Hall', "The Mere-Warden's Seat"];
  const rooms = CRYPT.rooms || [];
  sok(rooms.length === 3 && rooms.map(r => r.name).join('|') === NAMES.join('|'), 'the Stepping crypt lists its three rooms from the spec: ' + rooms.map(r => r.id).join(', '));
  sok(rooms.every(r => r.name && r.frame && r.foes.every(f => species(f.type) && f.n >= 1)), 'every room names bestiary species');
  sok(rooms.map(r => !!r.boss).join() === 'false,false,true' && rooms[2].foes.some(f => f.name === CRYPT.boss), 'only the last room is the boss room and it holds ' + CRYPT.boss);
  const M = descend(14); const seen = crawl(M, {act: () => 'strike'});
  const order = [...new Set(seen.map(s => s.room))];
  sok(seen.length >= 3 && seen.every(s => s.title && s.beats >= 1), seen.length + ' room scenes opened, each resolved at the table');
  sok(order.every((r, i) => r === i), 'rooms come in order, none skipped: ' + order.join(' > '));
  sok(seen.every((s, i) => i === 0 || s.room >= seen[i - 1].room), 'no scene goes back a room');
  sok(order.length === 3 && order[2] === 2, 'all three rooms were reached, the boss room last');
  sok(S.fellowship.crawl.clears >= 1 && !CRYPT.group && !S.table, 'the Fellowship cleared the crypt and the table and group are free again');
  {
    const R = descend(14); const rs = crawl(R, {act: () => 'retreat', maxS: 300});
    sok(rs.length === 1 && rs[0].room === 0, 'a retreat withdraws the party at the first room (the sump)');
    sok(!CRYPT.group && !S.table && R.some(a => a.state !== 'dead') && R.filter(a => a.state !== 'dead').every(a => a.state === 'return'), 'survivors go home, group and table are free');
  }
  {
    const W = descend(14); const saved = CRYPT.rooms[0], orig = JSON.stringify(saved);
    CRYPT.rooms[0] = {...saved, foes: [{type: 'tombskit', n: 14}], hit: 4};
    try {
      crawl(W, {act: () => 'strike', maxS: 300});
      sok(W.every(a => a.state === 'dead') && W.every(a => /felled by/.test(a.cause || '')), 'a wipe: everyone falls and each death names the foe');
      sok(!CRYPT.group && !S.table, 'after the wipe the group and table are cleared');
    } finally {CRYPT.rooms[0] = JSON.parse(orig)}
  }
  console.log('SIG ' + signature(M, seen));
  process.exit(sk.n ? 1 : 0);
}

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};

console.log('rooms as data');
ok(Array.isArray(CRYPT.rooms) && CRYPT.rooms.length >= 4, `the Crypt lists ${CRYPT.rooms.length} rooms in the world spec`);
ok(CRYPT.rooms.every(r => r.name && r.frame && r.foes.every(f => species(f.type) && f.n >= 1)), 'every room names bestiary species');
ok(CRYPT.rooms[CRYPT.rooms.length - 1].foes.some(f => f.name === CRYPT.boss), 'the last room holds the boss');

console.log('a Fellowship crawl, room by room');
{
  const M = descend();
  const seen = crawl(M, {});
  ok(seen.length >= 2 && seen.every(s => s.title), `${seen.length} room scenes opened (${[...new Set(seen.map(s => s.title))].join(' > ')})`);
  ok(seen.every((s, i) => i === 0 || s.room === seen[i - 1].room || s.room === seen[i - 1].room + 1), 'rooms come in order, none skipped');
  ok(seen.every(s => s.beats >= 1), 'every round was resolved at the table (the members acted)');
  ok(!S.table && !CRYPT.group && S.agents.every(a => !a.hidden), 'the table and the Crypt are free again at the end');
  console.log('       ' + signature(M, seen));
}

console.log('a retreat, most fall back');
{
  const M = descend(); const seen = crawl(M, {act: () => 'retreat', maxS: 300});
  ok(seen.length === 1, `the party withdrew at the first room (${seen.length} scene)`);
  ok(!CRYPT.group && M.some(a => a.state !== 'dead'), 'the group is gone and survivors are out');
  ok(M.filter(a => a.state !== 'dead').every(a => a.state === 'return'), 'the survivors go home');
  ok(!S.table, 'no scene left open');
}

console.log('a wipe at the table');
{
  const M = descend(); const saved = CRYPT.rooms[0], orig = JSON.stringify(saved);
  CRYPT.rooms[0] = {...saved, foes: [{type: 'tombskit', n: 14}], hit: 4};
  try {
    const seen = crawl(M, {act: () => 'strike', maxS: 300});
    ok(M.every(a => a.state === 'dead'), `everyone fell to the dice (${seen.length} rounds)`);
    ok(M.every(a => /felled by/.test(a.cause || '')), 'each death names the foe that did it');
    ok(!CRYPT.group && !S.table, 'the group and the table are cleared');
  } finally {CRYPT.rooms[0] = JSON.parse(orig)}
}

console.log('driven back');
{
  const M = descend(); const saved = CRYPT.rooms[0], orig = JSON.stringify(saved);
  CRYPT.rooms[0] = {...saved, foes: [{type: 'graveward', n: 1, hits: 60}], hit: .001, rounds: 3};
  try {
    const seen = crawl(M, {act: () => 'strike', maxS: 300});
    ok(seen.length === 3 && !CRYPT.group, `a room not won in 3 rounds drives the party back (${seen.length} rounds)`);
    ok(M.every(a => a.state !== 'dead'), 'nobody died');
  } finally {CRYPT.rooms[0] = JSON.parse(orig)}
}

console.log('a save mid-crawl');
{
  const M = descend(); let snap = null, at = null;
  crawl(M, {maxS: 600, onScene: sc => {if (!snap && sc.ctx.room >= 1) {snap = JSON.stringify(snapshot()); at = sc.ctx.room}}});
  ok(snap, 'a snapshot was taken in room ' + at);
  if (snap) {
    restore(JSON.parse(snap)); T.TABLE.speed = 1;
    ok(CRYPT.group && CRYPT.group.crawl && CRYPT.group.crawl.i >= 1, 'the crawl came back from the save');
    crawl(F_.fellows(), {maxS: 600});
    ok(!CRYPT.group && !S.table, 'it plays on to its end');
  }
}

console.log('fast speed');
{
  const M = descend(), c0 = (S.fellowship.crawl || {runs: 0}).runs; T.TABLE.speed = 8; crawl(M, {maxS: 600});
  ok(!CRYPT.group && !S.table && S.fellowship.crawl.runs === c0 + 1, 'at 8x the crawl resolves without stalling, once');
}

console.log('determinism');
{
  const sig = n => spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--run', String(n)], {encoding: 'utf8'}).stdout.split('\n').find(l => l.startsWith('SIG '));
  const a = sig(7), b = sig(7), c = sig(8);
  ok(a && a === b, 'the same seed crawls the same way');
  ok(a && c && a !== c, 'a different seed crawls differently');
}

console.log('Stepping crypt, three rooms');
{
  const me = fileURLToPath(import.meta.url), env = {...process.env, ELDMOOR_WORLD: 'stepping'};
  const r = spawnSync(process.execPath, [me, '--stepping'], {encoding: 'utf8', env});
  process.stdout.write(r.stdout.split(String.fromCharCode(10)).filter(l => !l.startsWith('SIG ')).join(String.fromCharCode(10)));
  if (r.stderr) process.stderr.write(r.stderr);
  ok(r.status === 0, 'the Stepping crawl checks pass in a stepping-world child');
  const sg = n => spawnSync(process.execPath, [me, '--stepping'], {encoding: 'utf8', env: {...env, CRAWLCHECK_SEED: String(n)}}).stdout.split(String.fromCharCode(10)).find(l => l.startsWith('SIG '));
  const a = sg(7), b = sg(7);
  ok(a && a === b, 'a seeded Stepping crawl repeats exactly (same seed, same hash)');
}

console.log('background groups keep the abstract roll');
{
  const BASE = process.env.CRAWL_BASELINE_HASH;
  const hash = () => spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--hash'], {encoding: 'utf8'}).stdout.split('\n').find(l => l.startsWith('HASH '));
  const h1 = hash(), h2 = hash();
  const off = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--hash-off'], {encoding: 'utf8'}).stdout.split(String.fromCharCode(10)).find(l => l.startsWith('HASH '));
  ok(h1 && h1 === h2, 'a seeded world without a Fellowship repeats: ' + h1);
  ok(h1 && h1 === off, 'with the crawl unplugged it hashes the same: the background does not touch it');
  ok(!BASE || h1 === 'HASH ' + BASE, 'it matches the hash on main (' + BASE + ')');
}

if (fail) {console.error('\ncrawlcheck: ' + fail + ' check(s) failed'); process.exit(1)}
console.log('\ncrawlcheck: all checks passed');
