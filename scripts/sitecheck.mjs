// DM-made dungeon sites check (issue #69, slice 1): sim/sites.js, the create_site lever and DM tool, enter_site.
//   - nothing exists until the lever is pulled (no S.sites in a scripted world)
//   - create_site builds a site: a theme, a band clamped to the region, 3-8 rooms in the crawl's room format (bestiary
//     species), a named boss, a guaranteed epic from the tables; a marker on walkable ground off the roads and away from towns
//   - limits: 1 open site a region, 3 in the world, 2 a game day; bad themes, regions and bands are refused; the DM log has it
//   - the DM agent's flat tool create_site works and is refused the same way
//   - a hero coming near discovers it; a solo agent goes down (enter_site), plays it room by room at the Table, clears it:
//     the boss's epic, a ruin marker, a timeline entry
//   - a save taken mid-crawl resumes it; a company of two votes to go down and enters once both stand at the mouth;
//     with Table mode off the abstract roll settles it; an uncleared site grows and collapses
// Usage: npm run sitecheck
let seed = 0x9e3779b9 ^ (Number(process.env.SITECHECK_SEED) || 69);
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};

const SIM = await import('../src/sim/index.js');
const {init, step, S, snapshot, restore, maxHp, dmAct, setDmSeat} = SIM;
const L = await import('../src/sim/levers.js');
const ST = await import('../src/sim/sites.js');
const P = await import('../src/sim/player.js');
const CO = await import('../src/sim/company.js');
const C_ = await import('../src/sim/council.js');
const T = await import('../src/sim/table.js');
const {species} = await import('../src/sim/crawl.js');
const {tiles, I, ZONES, REGIONS, CITY, dist} = await import('../src/world/map.js');
const {ROAD, WALKABLE} = await import('../src/world/tiles.js');
const {EPICS, DG_EPICS} = await import('../src/data/items.js');

let bad = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); bad++}};
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};
const by = {by: 'dm-agent', reason: 'a test'};
const nextDay = () => {S.gameMin += 1440};

console.log('sitecheck: generation and limits');
init({fellowship: false}); run(10);
ok(S.sites === undefined, 'a scripted world has no S.sites');
const r0 = L.pull('create_site', {theme: 'barrow', region: 0}, by);
ok(r0.ok, 'create_site barrow in ' + ZONES[0] + ': ' + JSON.stringify(r0.effect || r0.reason));
const s0 = S.sites && S.sites.list[0];
ok(s0 && s0.rooms.length >= 3 && s0.rooms.length <= 8, 'it has 3-8 rooms (' + (s0 && s0.rooms.length) + ')');
ok(s0 && s0.rooms.every(r => r.name && r.frame && r.foes.length && r.foes.every(f => species(f.type) && f.n >= 1) && r.hit > 0 && r.rounds >= 2), 'every room is a crawl room of bestiary species');
const bossRoom = s0 && s0.rooms[s0.rooms.length - 1];
ok(bossRoom && bossRoom.boss && bossRoom.foes[0].name === s0.boss && bossRoom.foes[0].hits >= 4, 'the last room holds the named boss (' + (s0 && s0.boss) + ')');
ok(s0 && (DG_EPICS.includes(s0.epic) || EPICS.flat().includes(s0.epic)), 'the boss carries an epic from the tables (' + (s0 && s0.epic) + ')');
const [lo, hi] = REGIONS[0].band;
ok(s0 && s0.band[0] >= lo && s0.band[0] <= Math.min(hi, 20) + 2, 'its level band ' + (s0 && s0.band.join('-')) + ' sits in the region band ' + lo + '-' + hi);
const pl = s0 && S.places.find(p => p.id === s0.place);
ok(pl && pl.kind === 'site' && pl.name === s0.name, 'a site marker stands on the map: ' + (pl && pl.name));
ok(pl && WALKABLE.includes(tiles[I(Math.floor(pl.x), Math.floor(pl.y))]), 'on a walkable tile');
let road = false; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {const x = Math.floor(pl.x) + dx, y = Math.floor(pl.y) + dy; if (tiles[I(x, y)] === ROAD) road = true}
ok(!road, 'no road within 3 tiles');
ok(CITY.every(c => dist(pl, c.gate) >= 12), 'away from every town gate');
ok(s0.state === 'hidden', 'it starts hidden');
ok((S.dmLog || []).some(e => e.kind === 'lever' && e.detail && e.detail.lever === 'create_site' && e.detail.result === 'applied'), 'the DM log records the creation with its reason');
ok(!L.pull('create_site', {theme: 'den', region: 0}, by).ok, 'a second open site in the region is refused');
ok(/theme/.test(L.pull('create_site', {theme: 'castle', region: 1}, by).reason), 'an unknown theme is refused');
ok(/outside/.test(L.pull('create_site', {theme: 'den', region: 1, band: 40}, by).reason), 'a level far outside the band is refused');
const r1 = L.pull('create_site', {theme: 'fortress', region: 1, band: hi + 99 > 0 ? REGIONS[1].band[1] + 2 : 1, rooms: 8}, by);
ok(r1.ok && S.sites.list[1].rooms.length === 8, 'a fortress of 8 rooms in ' + ZONES[1]);
ok(!L.pull('create_site', {theme: 'mine', region: 2}, by).ok, 'a third pull the same day is refused (2 a day)');
nextDay();
ok(L.pull('create_site', {theme: 'mine', region: 2}, by).ok, 'next day: a mine in ' + ZONES[2]);
nextDay();
if (ZONES.length > 3) {const r = L.pull('create_site', {theme: 'temple', region: 3}, by); ok(!r.ok && /3 open sites/.test(r.reason), 'a fourth open site in the world is refused: ' + r.reason)}
// the DM agent's flat tool
setDmSeat(true);
const t1 = dmAct('create_site', {theme: 'ruin', region: ZONES[3] || ZONES[0], reason: 'test'});
ok(t1.ok === false && /Refused/.test(t1.error), 'the flat tool is held to the same limits');
const t2 = dmAct('create_site', {theme: 'ruin', reason: 'test'});
ok(t2.ok === false, 'the flat tool refuses without a region or near');
ok(dmAct('dm_status').sites.length === 3, 'dm_status lists the sites');

console.log('sitecheck: discovery, a solo goes down and clears it');
init({fellowship: false}); run(10); T.TABLE.speed = 1; T.TABLE.mode = 'auto'; S.mobs.length = 0;
SIM.setRunnerLinks(() => 'connected');
setDmSeat(true);
const t3 = dmAct('create_site', {theme: 'den', near: ZONES[0], band: 3, rooms: 3, reason: 'a den on the road'});
ok(t3.ok && t3.site, 'the DM agent raises a den with the flat tool: ' + (t3.site || t3.error));
const site = S.sites.list[0];
const hero = S.agents.find(a => a.kind === 'hero' && a.state !== 'dead' && !a.company);
P.markPlayer(hero, true);
hero.lvl = 14; hero.hp = maxHp(hero); hero.state = 'hunt'; hero.target = null; hero.dest = null; hero.x = site.x + 2; hero.y = site.y + 1;
run(4);
ok(site.state === 'discovered' && site.found, 'a hero coming near discovers it (by ' + (site.found && site.found.by) + ')');
const e0 = P.playerAct(hero.id, 'enter_site', {});
ok(e0.ok && e0.entered, 'a solo goes down with enter_site: ' + JSON.stringify(e0).slice(0, 160));
ok(site.group && hero.state === 'dungeon' && hero.hidden, 'the hero is inside');
ok(site.group && site.group.crawl, 'the solo crawls it room by room at the Table');
const before = hero.epics.length;
let scenes = 0, last = null, snap = null;
for (let f = 0; f < 900 * 60 && site.group; f++) {step(1 / 60); const sc = T.sceneFor(CO.companyOf(hero));
  if (sc && sc.kind === 'crawl') {if (sc.id !== last) {last = sc.id; scenes++; if (scenes === 2 && !snap) snap = JSON.stringify(snapshot())}
    if (!sc.acts[hero.id] && (sc.phase === 'frame' || sc.phase === 'turn')) T.sceneAct(hero, 'strike', 'test')}}
ok(scenes >= 3, 'scenes opened for its rooms (' + scenes + ')');
ok(site.state === 'cleared' || hero.state === 'dead', 'the run ends: ' + site.state + ', hero ' + hero.state);
if (site.state === 'cleared') {
  ok(hero.epics.length === before + 1 && hero.epics.includes(site.epic), 'the boss\'s epic is the hero\'s');
  const ru = S.places.find(p => p.id === site.place);
  ok(ru && ru.kind === 'ruin' && ru.until > S.gameMin, 'a ruin marker is left');
  ok((S.timeline || []).some(e => e.kind === 'world' && JSON.stringify(e.parts).includes(site.name)), 'a timeline entry names it');
  ok(!P.playerAct(hero.id, 'enter_site', {site: site.name}).ok, 'a cleared site cannot be entered again');
}
// a save taken mid-crawl resumes it
ok(!!snap, 'a save was taken mid-crawl');
if (snap) {restore(JSON.parse(snap)); const s2 = S.sites.list[0], h2 = S.agents.find(a => a.id === hero.id);
  ok(s2.group && s2.group.crawl && s2.group.mem[0] === h2, 'the restored group is the restored hero');
  let last2 = null;
  for (let f = 0; f < 900 * 60 && s2.group; f++) {step(1 / 60); const sc = T.sceneFor(CO.companyOf(h2));
    if (sc && sc.kind === 'crawl' && sc.id !== last2) last2 = sc.id;
    if (sc && sc.kind === 'crawl' && !sc.acts[h2.id] && (sc.phase === 'frame' || sc.phase === 'turn')) T.sceneAct(h2, 'strike', 'test')}
  ok(!s2.group && (s2.state === 'cleared' || h2.state === 'dead' || s2.state === 'entered'), 'the restored crawl runs to its end (' + s2.state + ')');
  const back = restore(snapshot()); ok(back === S && S.sites.list.length === 1, 'a save round trip keeps the site');
}

console.log('sitecheck: a company votes to go down');
init({fellowship: false}); run(10); T.TABLE.speed = 1; T.TABLE.mode = 'auto'; S.mobs.length = 0;
SIM.setRunnerLinks(() => 'connected');
ok(L.pull('create_site', {theme: 'ruin', region: 0, rooms: 3}, by).ok, 'a ruin');
const rs = S.sites.list[0];
const [a1, a2] = S.agents.filter(a => a.kind === 'hero' && a.state !== 'dead' && !a.company && a.fac === 0).slice(0, 2);
P.markPlayer(a1, true); P.markPlayer(a2, true); CO.mergeCompanies(CO.companyOf(a1), CO.companyOf(a2));
const C2 = CO.companyOf(a1);
for (const a of [a1, a2]) {a.lvl = 12; a.hp = maxHp(a); a.state = 'hunt'; a.target = null; a.dest = null; a.x = rs.x + 4; a.y = rs.y + 1}
run(3);
const e1 = P.playerAct(a1.id, 'enter_site', {site: rs.name});
ok(e1.ok && e1.proposal, 'in a company enter_site puts it to the party: ' + JSON.stringify(e1).slice(0, 160));
for (const a of [a1, a2]) {const Pr = C_.propById(e1.proposal); if (Pr && Pr.status === 'open' && !Pr.votes[a.id]) C_.castVote(a, e1.proposal, 'yes', 'test')}
const Pr = C_.propById(e1.proposal);
ok(Pr && Pr.status === 'passed', 'the vote passes (' + (Pr && Pr.result) + ')');
ok(C2.siteGo && C2.siteGo.site === rs.id, 'the company gathers at the mouth');
for (let f = 0; f < 10 * 60 && !rs.group; f++) {for (const a of [a1, a2]) if (!a.hidden) {a.x = rs.x + .5; a.y = rs.y + .5; a.state = 'hunt'} step(1 / 60)}
ok(rs.group && rs.group.mem.length === 2 && a1.hidden && a2.hidden, 'both go down once both stand there');

console.log('sitecheck: Table off: the abstract roll; growth and collapse');
init({fellowship: false}); run(10); T.TABLE.mode = 'off';
ok(L.pull('create_site', {theme: 'temple', region: 0, rooms: 4}, by).ok, 'a temple');
const ts = S.sites.list[0];
const h3 = S.agents.find(a => a.kind === 'hero' && a.state !== 'dead' && !a.company);
P.markPlayer(h3, true); h3.lvl = 15; h3.hp = maxHp(h3); h3.state = 'hunt'; h3.x = ts.x + 1; h3.y = ts.y + 1; run(3);
ok(P.playerAct(h3.id, 'enter_site', {site: ts.name}).ok && ts.group && !ts.group.crawl, 'with Table mode off the group takes the abstract roll');
for (let f = 0; f < 120 * 60 && ts.group; f++) step(1 / 60);
ok(!ts.group && (ts.state === 'cleared' || ts.state === 'entered'), 'the roll settles it (' + ts.state + ')');
T.TABLE.mode = 'auto';
nextDay();
ok(L.pull('create_site', {theme: 'mine', region: 1}, by).ok, 'a mine left alone');
const ms = S.sites.list.find(s => s.theme === 'mine');
S.gameMin += 1440 * 5; run(3);
ok(ms.grow >= 2, 'it grows more dangerous with the days (grow ' + ms.grow + ')');
S.gameMin += 1440 * 6; run(3);
ok(ms.state === 'collapsed' && !S.places.some(p => p.id === ms.place), 'left 10+ days it collapses and its marker goes');
ok((S.timeline || []).some(e => JSON.stringify(e.parts).includes(ms.name)), 'the collapse is on the timeline');

if (bad) {console.error('sitecheck: ' + bad + ' failed'); process.exit(1)}
console.log('sitecheck: all ok');
