// The DM's summon_hero lever (issue #780), run as a child by scripts/dmcheck.mjs (or alone: node scripts/summon-test.mjs).
// One scripted hero made at the level asked and placed where asked; its limits and refusals (2 a day, 8 alive, the nearest
// company's average +2, a town with no company in it, a town of another faction, the pile-on rule, the world's share of the
// day), each naming the way on; the DM log; no hero hears the why; a `when` fires it; no replacement after its death; a
// save and restore. Seeded Math.random. Prints SUMMON OK.
let seed = 0x2545f491;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const sim = await import('../src/sim/index.js');
const {init, step, S, snapshot, restore, dmAct, setDmSeat} = sim;
const {SUMMON, summonedAlive} = await import('../src/sim/summon.js');
const {slay, maxHp} = await import('../src/sim/heroes.js');
const SLT = await import('../src/sim/company.js');
const {FAC} = await import('../src/data/factions.js');
const {racesOf} = await import('../src/data/races.js');
const {CITY, ZONES, ZPTS, zoneAt, zoneFor, zonePoint, dist} = await import('../src/world/map.js');
const {DM_TOOLS} = await import('../src/data/dm-tools.js');
const {WHEN} = await import('../src/sim/dmwhen.js');

let fails = 0;
const ok = (c, msg, extra) => {if (c) console.log('  ok   ' + msg); else {fails++; console.log('  FAIL ' + msg + (extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 400) : ''))}};
const newDay = () => {S.gameMin = (Math.floor(S.gameMin / 1440) + 1) * 1440 + 480; if (S.dmAgent.day) S.dmAgent.day.pulls = 0};
const byName = n => S.agents.find(a => a.name === n);

init({others: 'none', fac: 0}); setDmSeat(true);
const F = SLT.slotted(), mem = SLT.slotHeroes(F), home = CITY.find(c => c.name === F.hall), foe = CITY.find(c => c.fac === 1);
const N0 = S.agents.length, FN = [FAC[0].name, FAC[1].name];
for (const a of mem) a.lvl = 6;
const field = () => {const z = zoneFor(6, home.gate), p = zonePoint(z, null, home.gate); mem.forEach((a, i) => {a.x = p.x + (i % 3) * .5; a.y = p.y + Math.floor(i / 3) * .5; a.state = 'hunt'; a.hp = maxHp(a); a.hidden = false; a.target = null; a.dest = null})};
const town = () => mem.forEach((a, i) => {a.x = home.x0 + 2 + i; a.y = home.y0 + 4; a.state = 'town'; a.hp = maxHp(a); a.target = null; a.dest = null});

ok(N0 === 5 && DM_TOOLS.some(t => t.name === 'summon_hero' && t.act && t.args.why && !t.args.why.optional && t.args.level.optional), 'summon_hero is a DM tool and a why is required');

// one hero, near the company, at the level asked
field();
const nums = () => JSON.stringify(mem.map(m => [m.id, m.hp, m.xp, m.lvl, m.cls, m.gold, m.honor, m.gear])), nums0 = nums();
let r = dmAct('summon_hero', {fac: FN[1], cls: 'Rogue', level: 8, near: 'fellowship', name: 'Sefa Dray', people: racesOf(1)[0].name, why: 'a rival to test them'});
const a = r.ok && byName('Sefa Dray');
ok(nums() === nums0, 'cls and level name the new hero only: the numbers of those already here do not change');
ok(r.ok && a && S.agents.length === N0 + 1, 'one hero is made' + (r.ok ? '' : ': ' + r.error));
ok(a && a.lvl === 8 && a.fac === 1 && a.cls === 'Rogue' && a.race === racesOf(1)[0].id && a.hp === maxHp(a), 'at the level, faction, class and people asked');
ok(a && !a.player && a.company == null && !a.brain && a.state === 'hunt' && a.summoned && a.guild == null, 'a scripted background hero, in no company, hunting');
ok(a && dist(a, mem[0]) <= 8 && a.zone === zoneAt(a.x, a.y), 'placed near the company');
ok(a && a.origin && a.goal, 'with the usual origin and oath');
{const e = S.dmLog.find(x => x.kind === 'lever' && x.detail.lever === 'summon_hero');
  ok(e && e.detail.by === 'dm-agent' && e.detail.reason === 'a rival to test them' && e.detail.result === 'applied', 'in the DM log with the DM agent tag and the why');
  ok(S.dmAgent.day.pulls === 1, 'it counts as one lever pull');
  const shown = S.chronicle.slice(0, 5).flatMap(e => e.parts.map(p => typeof p === 'string' ? p : p && (p.name || p.t) || '')).join(' ') + JSON.stringify(mem.map(m => [m.playEv, m.chat]));
  ok(!shown.includes('a rival to test them'), 'no hero and no chronicle line carries the why')}
ok(dmAct('dm_status').summoned.alive === '1/' + SUMMON.ALIVE && /summon_hero/.test(dmAct('dm_status').others), 'dm_status counts them and says this world has no others');

// the default level: the nearest company's average
r = dmAct('summon_hero', {fac: FN[0], cls: 'Priest', near: 'fellowship', why: 'a wandering healer'});
ok(r.ok && r.level === 6, 'no level asked: the company\'s average' + (r.ok ? '' : ': ' + r.error));

// the day's cap
r = dmAct('summon_hero', {fac: FN[0], cls: 'Mage', near: 'fellowship', why: 'a third today'});
ok(!r.ok && /limit: 2 summon_hero per game day/.test(r.error) && S.agents.length === N0 + 2, 'two a game day: ' + r.error);

// refusals, each naming the way on
newDay(); field();
const pulls0 = S.dmAgent.day.pulls, refused = (args, re, what) => {const n = S.agents.length; r = dmAct('summon_hero', {fac: FN[0], cls: 'Mage', near: 'fellowship', why: 'x', ...args}); ok(!r.ok && re.test(r.error) && S.agents.length === n, what + ': ' + String(r.error).slice(0, 170))};
refused({level: 9}, /level 9 is too high here.*at most level 8/, 'above the company\'s average +2');
refused({why: ''}, /a reason is required/, 'no why');
refused({fac: 'Nobody'}, /fac must be one of/, 'an unknown faction');
refused({cls: 'Baker'}, /cls must be one of/, 'an unknown class');
refused({people: 'Nobody'}, /people must be a people of/, 'a people not of that faction');
refused({name: 'Sefa Dray'}, /is alive already: pick another name/, 'a name in use');
refused({name: '12'}, /name must be/, 'a name that is not letters');
refused({near: 'Nowhere-at-all'}, /unknown place.*near takes/, 'an unknown place');
refused({near: foe.name}, /no company stands in .*survey near/, 'a town no company is in');
ok(S.dmAgent.day.pulls === pulls0, 'a refusal is no pull');
{const n = S.dmLog.filter(x => x.kind === 'lever' && /rejected/.test(x.detail.result || '')).length; ok(n >= 9, 'refusals are in the DM log')}

// a badly hurt member in the field: no piling on
mem[1].hp = 1; refused({}, /badly hurt.*does not pile on/, 'near a badly hurt member'); mem[1].hp = maxHp(mem[1]);

// the town the company stands in, of the hero's faction; never a town of the other
town();
r = dmAct('summon_hero', {fac: FN[0], cls: 'Hunter', near: home.name, why: 'a friend at the inn'});
{const h = r.ok && S.agents.find(x => x.id === r.hero_id); ok(r.ok && h.state === 'town' && h.town === home.name && h.x >= home.x0 && h.x <= home.x1, 'in the town the company stands in' + (r.ok ? '' : ': ' + r.error))}
r = dmAct('summon_hero', {fac: FN[1], cls: 'Hunter', near: home.name, why: 'an enemy at the inn'});
ok(!r.ok && /is a town of the .*survey near/.test(r.error), 'never inside a town of another faction: ' + String(r.error).slice(0, 150));
ok(foe && !dmAct('summon_hero', {fac: FN[1], cls: 'Hunter', near: foe.name, why: 'x'}).ok, 'nor in the far town of their own faction with no company in it');

// the world's share: away from every company only part of the day's limit is free
newDay(); field();
{const {focus} = await import('../src/sim/dmfocus.js'), fo = focus(), z = ZONES.map((n, i) => i).find(i => !fo.zones.has(i) && ZPTS[i].some(p => dist(p, mem[0]) > 30)); // any region with ground far off: one random point is a coin flip
  const nm = ZONES[z];
  r = dmAct('summon_hero', {fac: FN[0], cls: 'Rogue', level: 3, near: nm, why: 'the world first'});
  ok(r.ok, 'far from the company: the world\'s share' + (r.ok ? '' : ': ' + r.error));
  r = dmAct('summon_hero', {fac: FN[0], cls: 'Rogue', level: 3, near: nm, why: 'the world again'});
  ok(!r.ok && /kept for/.test(r.error), 'the rest of the day is kept for the company: ' + String(r.error).slice(0, 120));
  r = dmAct('summon_hero', {fac: FN[0], cls: 'Rogue', level: 3, near: 'fellowship', why: 'for the company'});
  ok(r.ok, 'near the company the reserved one is free' + (r.ok ? '' : ': ' + r.error))}

// pull_lever reads near the same way
newDay(); field();
r = dmAct('pull_lever', {lever: 'summon_hero', params: {fac: FN[0], cls: 'Warrior', near: 'fellowship'}, reason: 'through pull_lever'});
ok(r.ok && r.lever === 'summon_hero', 'pull_lever takes near like the tool' + (r.ok ? '' : ': ' + r.error));

// a `when` fires it
newDay(); field(); S.dmAgent.day.pulls = 0;
{const n = S.agents.length;
  r = dmAct('when', {trigger: 'after_hours', on: {h: 1}, action: 'summon_hero', args: {fac: FN[1], cls: 'Warrior', near: mem[0].name}, reason: 'a rival when the hour is up'});
  ok(r.ok, 'a when takes summon_hero, its reason the why' + (r.ok ? '' : ': ' + r.error));
  const {whenTick} = await import('../src/sim/dmwhen.js');
  S.gameMin += 61 + WHEN.EVERY; whenTick();
  const h = S.agents[S.agents.length - 1];
  ok(S.agents.length === n + 1 && h.summoned && h.fac === 1, 'and it fires through the same tool');
  const e = S.dmLog.find(x => x.kind === 'lever' && x.detail.lever === 'summon_hero');
  ok(e && e.detail.when != null && e.detail.reason === 'a rival when the hour is up', 'the DM log names the when and its reason')}

// the cap of the living
{newDay(); field(); while (summonedAlive().length < SUMMON.ALIVE) {const d = S.agents.find(x => x.summoned); const b = {...d}; S.agents.push({...b, id: ++S.uid, name: 'Filler ' + 'abcdefghij'[S.agents.length % 10] + S.agents.length})}
  refused({}, /limit: 8 heroes you summoned are alive/, 'eight alive');
  const dead = summonedAlive()[0], q = S.recruits.length; slay(dead, S.mobs[0]); newDay(); field();
  ok(dead.state === 'dead' && S.recruits.length === q, 'a summoned hero who dies leaves no replacement');
  r = dmAct('summon_hero', {fac: FN[0], cls: 'Mage', near: 'fellowship', why: 'one fell'});
  ok(r.ok, 'and a place opens for another' + (r.ok ? '' : ': ' + r.error))}

// save and restore
{const snap = JSON.parse(JSON.stringify(snapshot())), n = summonedAlive().length; restore(snap);
  ok(summonedAlive().length === n && S.setup.others === 'none', 'the summoned and the setting survive a save');
  for (let i = 0; i < 300; i++) step(1); ok(S.agents.every(x => x.state === 'dead' || Number.isFinite(x.hp)), 'and the world runs on')}

// a full world: the lever works there too, and a summoned hero's death queues no recruit
init({fac: 0}); setDmSeat(true);
{const L = SLT.slotHeroes(SLT.slotted()), n = S.agents.length; for (const a of L) {a.state = 'town'; a.hp = maxHp(a)}
  r = dmAct('summon_hero', {fac: FN[0], cls: 'Warrior', near: L[0].name, why: 'a stranger comes to town'});
  ok(r.ok && S.agents.length === n + 1, 'in a full world too' + (r.ok ? '' : ': ' + r.error));
  const h = r.ok && S.agents.find(x => x.id === r.hero_id), q = S.recruits.length; if (h) slay(h, S.mobs[0]); ok(S.recruits.length === q, 'no recruit behind a summoned hero there either');
  const b = S.agents.find(x => !x.summoned && !x.player && x.state !== 'dead'); slay(b, S.mobs[0]); ok(S.recruits.length === q + 1, 'a background hero\'s death still queues one')}

console.log(fails ? 'SUMMON FAIL ' + fails : 'SUMMON OK');
process.exit(fails ? 1 : 0);
