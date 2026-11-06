// The first delve (issue #922): a new company opens at a dungeon's mouth, plays it room by room, and comes home to its first move.
//   - the prologues are table rows; a company takes its hall's row, else its faction's; each row once a world
//   - a setup world on the default opens intro -> crawl -> homecoming -> the hall gate with the first move; loot is plain, no epic,
//     the ruin stays, the site is real (S.sites, S.places)
//   - 'none', a world with no setup, a solo, and a world with no host are exactly today's opening (nothing raised, nothing stored)
//   - a save mid-prologue restores into it; a finished one never plays again
//   - the DM frames the rooms and silence is filled; heroes never read what is behind the place
// Usage: npm run prologuecheck (Eldmoor); ELDMOOR_WORLD=stepping npm run prologuecheck (npm run prologuecheck:stepping = --world stepping, #721's six towns: every hall gets a mouth in its own region, a clear walk from the gate).  --stats N sound|weak: N mock-company runs, one line of numbers each and a summary (balance reports);
// --stats N weak [alt]: alt plays the rows a second company takes; weak the same with minds that pick a random legal act half the time (a poor player, not the reflex's sound play).
{const w = process.argv.indexOf('--world'); if (w > 0) process.env.ELDMOOR_WORLD = process.argv[w + 1]}
let seed = 0x9e3779b9 ^ (Number(process.env.PROLOGUE_SEED) || 922);
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const SIM = await import('../src/sim/index.js');
const {init, step, S, snapshot, restore, setRunnerLinks, defaultSetup, cleanSetup, validateSetup, applyPreset, dmAct, setDmSeat, prologueOn, pickRow, planOpening} = SIM;
const SLT = await import('../src/sim/company.js');
const T = await import('../src/sim/table.js');
const {PROLOGUES, PROLOGUE_DEFAULT} = await import('../src/data/prologues.js');
const {CITY, ZONES, zoneAt} = await import('../src/world/map.js');
const {mouthNear, PRO} = await import('../src/sim/prologue.js');
const {clearLine} = await import('../src/sim/path.js');
const WORLD = process.env.ELDMOOR_WORLD || 'eldmoor';
const {SITE_THEMES} = await import('../src/data/sites.js');
const {species} = await import('../src/sim/crawl.js');
const {GOODS} = await import('../src/data/items.js');
const {beginPrep, endPrep} = await import('../src/sim/prep.js');

let fails = 0, n = 0; const ok = (c, m) => {n++; if (!c) {fails++; console.log('FAIL: ' + m)}};
const hosted = () => setRunnerLinks(() => 'none');
const world = (o = {}, seedN = 7, fac = 0) => {T.TABLE.mode = 'auto'; T.TABLE.speed = 1; hosted(); init({setup: cleanSetup({...defaultSetup(seedN, WORLD, fac), ...o})})};
const tick = () => step(1 / 60);
// Run until f() or the budget ends: reflexes answer at once, so a scene takes a few real seconds of ticks.
const until = (f, max = 60000) => {for (let i = 0; i < max; i++) {if (f()) return true; tick()} return !!f()};
const lives = () => SLT.slotHeroes(SLT.slotted()).filter(a => a.state !== 'dead');
const kindOpen = k => T.openScenes().some(sc => sc.kind === k);

if (process.argv[2] === '--stats') {
  const N = Number(process.argv[3]) || 20, rows = [];
  if (process.argv[5] === 'alt') {PROLOGUES.reverse(); for (const r of PROLOGUES) delete r.towns} // the rows a second company in a hall takes
  if (process.argv[4] === 'weak') {const K = T.kindHooks('crawl'), good = K.reflex; K.reflex = (sc, a) => {if (Math.random() < .5) return good(sc, a); const O = K.options(sc, a); return O[Math.floor(Math.random() * O.length)].k}} console.log('run row end rooms downs deaths minutes levels');
  for (let i = 0; i < N; i++) {
    world({}, 1000 + i, i % 2); const F = SLT.slotted(), L0 = SLT.slotHeroes(F).slice(), g0 = S.gameMin; let seen = null, began = false;
    const done = until(() => {if (F.prologue) {seen = F.prologue.row; began = true} return began && !F.prologue}, 400000);
    const r = F.crawl || {}, dead = L0.filter(a => a.state === 'dead').length, up = L0.filter(a => a.state !== 'dead');
    const row = {seen, end: !done ? 'STUCK' : r.clears ? 'clear' : r.wipes ? 'wipe' : r.driven ? 'driven' : 'withdrew', rooms: r.rooms || 0, downs: r.downs || 0, dead, min: Math.round(S.gameMin - g0), lv: up.map(a => a.lvl)};
    rows.push(row); console.log(i, row.seen, row.end, row.rooms, row.downs, row.dead, row.min, row.lv.join(','));
  }
  const sum = k => rows.reduce((t, r) => t + r[k], 0), lv = rows.flatMap(r => r.lv), c = e => rows.filter(r => r.end === e).length;
  console.log(`runs ${N}: cleared ${c('clear')}, driven ${c('driven')}, withdrew ${c('withdrew')}, wiped ${c('wipe')}, stuck ${c('STUCK')}; downs per run ${(sum('downs') / N).toFixed(2)}, deaths ${sum('dead')} (${(sum('dead') / N).toFixed(3)} per run), runs with a death ${rows.filter(r => r.dead).length}; mean level on exit ${(lv.reduce((t, x) => t + x, 0) / Math.max(1, lv.length)).toFixed(2)}, mean game minutes ${(sum('min') / N).toFixed(0)}`);
  process.exit(0);
}

// ---- the table ----
ok(PROLOGUE_DEFAULT === 'delve', 'a setup world\'s default is the first delve (owner, #922)');
for (const r of PROLOGUES) {
  ok(SITE_THEMES[r.theme], r.id + ': a theme of the site table');
  ok(r.rooms.length >= 3 && r.rooms[r.rooms.length - 1].boss, r.id + ': rooms end at a keeper');
  ok(r.rooms.every(m => m.foes.every(f => species(f.type))), r.id + ': every foe is a bestiary species');
  ok(r.loot.goods.every(g => GOODS[g]), r.id + ': goods are real');
  ok(r.closing.clear.includes('{crypt}') && r.closing.left.includes('{crypt}'), r.id + ': the closing keeps the warning');
}
for (const c of CITY) ok(pickRow(c.name, c.fac, new Set()), 'every town has a row: ' + c.name);
for (const r of PROLOGUES) if (r.towns) {const other = CITY.find(c => c.fac === r.fac && !r.towns.includes(c.name)); if (other) ok(pickRow(other.name, r.fac, new Set()) !== r, 'a town row stays its town\'s')}
ok(pickRow('Nowhere', 0, new Set()).towns === undefined, 'another hall takes the faction\'s any-town row first');
ok(pickRow(CITY[0].name, CITY[0].fac, new Set(PROLOGUES.filter(r => r.towns && r.towns.includes(CITY[0].name)).map(r => r.id))).fac === CITY[0].fac, 'a taken hall row falls back to the faction\'s');

// ---- the flow ----
{ world(); const F = SLT.slotted(), hall = F.hall; ok(prologueOn(), 'a setup world on the default is on'); ok(S.setup.prologue === undefined, 'the default stores nothing');
  ok(validateSetup(defaultSetup(1)).length === 0, 'the default setup is valid'); ok(validateSetup({...defaultSetup(1), prologue: 'maybe'}).length === 1, 'a bad value is refused');
  ok(cleanSetup({...defaultSetup(1), prologue: 'none'}).prologue === 'none' && cleanSetup({...defaultSetup(1), prologue: 'delve'}).prologue === undefined, 'only a difference is stored');
  ok(until(() => kindOpen('opening'), 2000), 'session zero opens');
  const s = S.sites && S.sites.list.find(x => x.prologue); ok(s && F.prologue && F.prologue.site === s.id, 'a real site is raised for the company');
  ok(S.places.some(p => p.id === s.place && p.kind === 'site'), 'it stands on the map');
  const L = SLT.slotHeroes(F); ok(L.every(a => Math.hypot(a.x - s.x, a.y - s.y) < 5), 'the company stands at the mouth');
  const sc = T.openScenes().find(x => x.kind === 'opening'), fr = JSON.stringify(sc.frame); ok(fr.includes('short walk from ' + hall) && sc.ctx.prologue, 'the frame is the scenario');
  ok(until(() => (sc.calls || []).some(c => c.kind === 'frame' && c.done), 2000) && !/short walk from/.test(sc.calls.find(c => c.kind === 'frame').text), 'a scripted fill adds its own line, not the frame again (#966)');
  ok(!fr.includes(PROLOGUES.find(r => r.id === s.prologue).dm.slice(0, 30)), 'what lies behind it is the DM\'s alone');
  ok(until(() => kindOpen('crawl'), 20000), 'the crawl opens after the introductions, with no vote');
  ok(F.prologue.phase === 'below' && s.group && s.group.crawl, 'the company is below');
  let home = false; ok(until(() => {home = home || kindOpen('homecoming'); return !F.prologue}, 400000), 'the delve ends'); ok(home, 'the homecoming scene played');
  ok(lives().length, 'someone came home');
  ok(lives().every(a => a.lore && Object.values(a.lore.c).some(e => e.fought)), 'the crawl taught every survivor the creatures it fought (#188 lore, as in the open)');
  if (s.state === 'cleared') {const key = 'n:' + PROLOGUES.find(r => r.id === s.prologue).boss; ok(lives().some(a => a.lore.c[key] && a.lore.c[key].killed), 'and whoever struck the keeper down knows the name')}
  const g = CITY.find(c => c.name === hall).gate; ok(lives().every(a => Math.hypot(a.x - g.x, a.y - g.y) < 6), 'the company stands at the hall gate');
  ok(!lives().some(a => (a.epics || []).length), 'no epic'); ok(!S.opening, 'the opening is spent');
  ok(JSON.stringify(lives().map(a => a.playEv || [])).includes('first move is yours'), 'the leader is told the first move');
  if (s.state === 'cleared') {const p = S.places.find(x => x.id === s.place); ok(p && p.kind === 'ruin' && p.until == null, 'the ruin stays')}
}

// ---- every town (the world's own towns: a new town gets a mouth or no delve, never a bad one) ----
{ for (const c of CITY) {
    world({hall: c.name}, 31, c.fac); const F = SLT.slotted(); ok(F.hall === c.name, c.name + ': the company founds its hall there');
    const m = mouthNear(c), g = c.gate || c.qg; ok(m, c.name + ': a mouth stands near its gate'); if (!m) continue;
    ok(zoneAt(m.x, m.y) === zoneAt(g.x, g.y), c.name + ': in its own region'); ok(clearLine(g, m), c.name + ': a clear walk from the gate (no river or wall between)');
    ok(Math.hypot(m.x - g.x, m.y - g.y) <= 12 + PRO.FAR + 1, c.name + ': within the longest walk');
    ok(until(() => kindOpen('opening'), 2000), c.name + ': session zero opens'); const s = S.sites && S.sites.list.find(x => x.prologue);
    ok(s && F.prologue && F.prologue.town === c.name && Math.hypot(s.x - m.x, s.y - m.y) < 1, c.name + ': the delve is raised at that mouth');
    ok(until(() => kindOpen('crawl'), 20000) && F.prologue && F.prologue.phase === 'below', c.name + ': the company goes down');
    ok(until(() => !F.prologue, 400000), c.name + ': the delve ends'); const gt = c.gate || c.qg; ok(lives().every(a => Math.hypot(a.x - gt.x, a.y - gt.y) < 8), c.name + ': home at its own gate');
  }
}
// ---- off ----
{ world({prologue: 'none'}); ok(!prologueOn() && S.setup.prologue === 'none', 'none is stored'); ok(until(() => kindOpen('opening'), 2000), 'none: session zero opens');
  ok(!S.sites && !SLT.slotted().prologue, 'none: nothing raised'); ok(T.openScenes().find(x => x.kind === 'opening').ctx.setting === 'tavern', 'none: it plays in the hall');
  setRunnerLinks(null); init({setup: cleanSetup(defaultSetup(7))}); for (let i = 0; i < 3000; i++) tick(); ok(!S.sites && !SLT.slotted().prologue && !T.openScenes().some(x => x.kind === 'opening'), 'no host: nothing raised, no opening');
  hosted(); init({}); planOpening(); ok(!prologueOn(), 'a world with no setup is off'); for (let i = 0; i < 200; i++) tick(); ok(!S.sites, 'no setup: nothing raised');
  init({prologue: 'delve'}); ok(S.opening && S.opening.queue.length, 'asking for it plans the opening by itself'); ok(prologueOn() && S.setup.prologue === 'delve', 'a world with no setup may ask for it'); until(() => kindOpen('opening'), 2000); ok(S.sites && SLT.slotted().prologue, 'asked for: raised');
  process.env.ELDMOOR_PROLOGUE = 'none'; world(); ok(prologueOn(), 'a setup\'s choice is not overruled by the environment'); delete process.env.ELDMOOR_PROLOGUE;
  world(); T.TABLE.mode = 'off'; for (let i = 0; i < 300; i++) tick(); ok(!S.sites, 'Table off: nothing raised'); T.TABLE.mode = 'auto';
}
// ---- companies ----
{ setRunnerLinks(a => a.player ? 'connected' : 'none'); init({setup: cleanSetup(applyPreset('pairs-and-solo', defaultSetup(9)))});
  beginPrep('opening'); endPrep('done'); const CS = SLT.companies(), withP = CS.filter(C => C.prologue), solos = CS.filter(C => SLT.isSolo(C));
  ok(withP.length === 2, 'each pair of an apart world gets one (' + withP.length + ')'); ok(new Set(withP.map(C => C.prologue.row)).size === 2, 'each its own row'); ok(!solos.some(C => C.prologue), 'a solo keeps its short opening');
}
{ setRunnerLinks(a => a.player ? 'connected' : 'none'); const s0 = cleanSetup(applyPreset('pairs-and-solo', defaultSetup(9))); const far = ZONES[ZONES.length > 2 ? 2 : 1]; s0.heroes[0].start = {town: 'home', region: far}; s0.heroes[1].start = {town: 'home', region: far}; init({setup: s0});
  beginPrep('opening'); endPrep('done'); const C = SLT.companies().find(x => SLT.members(x).some(a => a.lvl > 3)); ok(C && !C.prologue, 'a seasoned group keeps the start it chose');
}
// ---- the table goes away before they go down ----
{ world({}, 17); const F = SLT.slotted(); until(() => kindOpen('opening'), 2000); until(() => F.prologue.phase === 'descend' || kindOpen('crawl'), 200); T.TABLE.mode = 'off'; until(() => !F.prologue, 3000); T.TABLE.mode = 'auto';
  ok(!F.prologue && !(F.campaign || []).some(e => JSON.stringify(e).includes('unfinished')), 'Table off before the descent: no defeat is told');
}
// ---- save ----
{ world({}, 11); until(() => kindOpen('crawl'), 20000); restore(JSON.parse(JSON.stringify(snapshot())));
  const C = SLT.slotted(); ok(C.prologue && C.prologue.phase === 'below', 'a save mid-crawl restores into it'); ok(until(() => !C.prologue, 400000), 'and plays to its end');
  restore(JSON.parse(JSON.stringify(snapshot()))); const n0 = S.sites.list.length; for (let i = 0; i < 300; i++) tick(); ok(S.sites.list.length === n0 && !SLT.slotted().prologue, 'Continue never replays it');
}
// ---- the DM ----
{ world({}, 13); setDmSeat(true); until(() => kindOpen('opening'), 2000);
  const st = dmAct('dm_status'); ok(st.first_delve && st.first_delve[0].behind_it, 'dm_status names the delve');
  const framed = () => {const c = T.openScenes().find(x => x.kind === 'crawl'); return c && c.calls && c.calls.length};
  ok(until(framed, 40000), 'a room\'s first round asks the DM for its frame');
  const c0 = T.openScenes().find(x => x.kind === 'crawl'); c0.calls[0].done = true; c0.calls[0].text = 'The dark leans in.'; const fr = T.sceneFrame(c0); ok(fr.includes('The dark leans in.') && fr.includes('Room 1 of'), 'the DM\'s words join the room\'s frame, which keeps the foes and the round');
}
setRunnerLinks(null);
console.log(fails ? `prologuecheck: ${fails} of ${n} failed` : `prologuecheck: ok (${n})`);
process.exit(fails ? 1 : 0);
