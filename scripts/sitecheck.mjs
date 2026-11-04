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
//   - slice 2 (#642): raid sites (the flag, a solo refused, background raiders by the raid muster's rule, the kill's lockout and
//     its end, a save mid-gather and mid-lockout), two companies going down one raid together, a company short of a raid calling
//     its side, a background party at an ordinary site, a fresh DM-agent site left to the companies, the scripted DM's raiseSite
//     inside the caps and the companies' reserve, an invasion raising a raid hold
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
  ok((S.timeline || []).some(e => e.kind === 'site' && e.site === site.id && JSON.stringify(e.parts).includes(site.name)), 'a timeline entry names it and links the site');
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

// ---- slice 2 (#642): raid sites, the lockout, background parties, the scripted DM's sites ----
const DM = await import('../src/sim/dm.js');
const PA = await import('../src/sim/party.js');
const free = (n, fac, o = {}) => S.agents.filter(a => a.kind === 'hero' && a.state !== 'dead' && !a.company && !a.player && (o.party || !a.party) && (fac == null || a.fac === fac) && !(o.not || []).includes(a)).slice(0, n);
const park = (L, s, lvl) => {for (const a of L) {a.lvl = lvl; a.gear = Math.max(a.gear, 12); a.hp = maxHp(a); a.state = 'hunt'; a.target = null; a.dest = null; a.adv = null; a.raid = false; a.x = s.x + 3; a.y = s.y + 2}};
const settle = (s, secs) => {for (let f = 0; f < secs * 60 && s.group; f++) step(1 / 60)};

console.log('sitecheck: a raid site (#642)');
init({fellowship: false}); run(10); T.TABLE.mode = 'off'; S.mobs.length = 0;
const zr = REGIONS.findIndex(r => r.band && r.band[1] >= 14);
const rr = L.pull('create_site', {theme: 'fortress', region: zr, raid: true}, {by: 'scripted', reason: 'a test'});
ok(rr.ok && rr.effect.raid, 'create_site takes raid: true (' + ZONES[zr] + '): ' + JSON.stringify(rr.effect || rr.reason));
const rsite = S.sites.list[0]; rsite.state = 'discovered'; // the scripted DM's sites start found (sim/dm.js raiseSite)
ok(rsite.raid && rsite.kills === 0 && rsite.band[0] >= 14, 'a raid site stands at a warband\'s level (' + rsite.band.join('-') + ')');
const rb = rsite.rooms[rsite.rooms.length - 1];
ok(rb.boss && rb.raid && rb.rounds >= 4 && rb.foes[0].hits >= 8, 'its boss room holds a raid boss (' + rb.foes[0].hits + ' blows, ' + rb.rounds + ' rounds)');
ok((S.dmLog || []).some(e => e.detail && e.detail.lever === 'create_site' && /raid/.test(JSON.stringify(e.summary))), 'the DM log names it a raid');
const solo = free(1)[0]; P.markPlayer(solo, true); park([solo], rsite, 20); run(3);
const se = P.playerAct(solo.id, 'enter_site', {site: rsite.name});
ok(!se.ok && /raid/.test(se.error), 'a solo is refused at a raid site: ' + (se.error || '').slice(0, 90));
// background raiders: the raid muster's rule (5, or 4 in gear 9+)
ST.SITE.BG_P = 1;
let raiders = free(8, solo.fac === 0 ? 1 : 0, {party: true}); for (const a of raiders) PA.leaveParty(a); park(raiders, rsite, 20);
P.markPlayer(solo, false); solo.x = 2; solo.y = 2;
let tries = 0;
while (S.sites.list[0].state !== 'locked' && tries < 6) {tries++; const rs = S.sites.list[0];
  for (const a of raiders) if (a.state !== 'dead') park([a], rs, 20); S.sites.mt = 0;
  for (let f = 0; f < 6 * 60 && !rs.group; f++) step(1 / 60);
  if (tries === 1) ok(rs.group && rs.group.phase === 'gather' && rs.group.mem.length >= 5 && rs.group.mem.every(a => a.siteAt), 'background raiders muster (' + (rs.group && rs.group.mem.length) + ') and walk to the mouth');
  if (tries === 1 && rs.group) {const sn = JSON.stringify(snapshot()); const back = restore(JSON.parse(sn)); const g2 = S.sites.list[0].group;
    ok(back === S && g2 && g2.phase === 'gather' && g2.mem.every(a => S.agents.includes(a) && a.siteAt && a.siteIn === S.sites.list[0].id), 'a save taken while they gather restores the gathering party');
    raiders = raiders.map(a => S.agents.find(b => b.id === a.id)).filter(Boolean)}
  settle(S.sites.list[0], 200)}
const R2 = S.sites.list[0];
ok(R2.state === 'locked' && R2.kills === 1 && R2.lockUntil > S.gameMin, 'a kill locks the raid site (' + R2.state + ', kills ' + R2.kills + ', tries ' + tries + ')');
ok(S.sites.stats.raidKills === 1 && S.sites.stats.bgRuns >= 1, 'stats count the raid kill and the background run');
const tl = (S.timeline || []).find(e => e.kind === 'site' && e.site === R2.id);
ok(!!tl, 'the timeline has the kill, linked to the site (site ' + (tl && tl.site) + ')');
const lg = raiders.find(a => a.state !== 'dead' && (a.history || []).some(h => (h.parts || []).some(p => p && p.dg === 'site:' + R2.id)));
ok(!!lg, 'a raider\'s Log names the site as a link (dg site:' + R2.id + ')');
ok(S.places.some(p => p.id === R2.place && p.kind === 'site'), 'the marker stays while it lies quiet');
const co = free(1)[0]; P.markPlayer(co, true); park([co], R2, 20); run(3);
const lk = P.playerAct(co.id, 'enter_site', {site: R2.name});
ok(!lk.ok && /quiet/.test(lk.error), 'enter_site is refused during the lockout: ' + (lk.error || '').slice(0, 80));
S.sites.mt = 0; park(raiders.filter(a => a.state !== 'dead'), R2, 40); run(5);
ok(!R2.group, 'no party musters for a locked site');
{const sn = restore(JSON.parse(JSON.stringify(snapshot()))), R3 = S.sites.list[0]; ok(sn === S && R3.state === 'locked' && R3.kills === 1 && R3.lockUntil === R2.lockUntil, 'a save round trip keeps the lockout')}
S.gameMin += 1440 * ST.SITE.LOCK_DAYS + 60; run(3);
ok(S.sites.list[0].state === 'discovered', 'after the lockout the keeper rises again (' + S.sites.list[0].state + ')');

console.log('sitecheck: two companies go down a raid site together');
init({fellowship: false}); run(10); T.TABLE.mode = 'off'; S.mobs.length = 0;
ok(L.pull('create_site', {theme: 'den', region: zr, raid: true, rooms: 3}, by).ok, 'a raid den');
const rd = S.sites.list[0];
const six = free(6, 0, {party: true}); six.forEach(a => P.markPlayer(a, true));
CO.mergeCompanies(CO.companyOf(six[0]), CO.companyOf(six[1])); CO.mergeCompanies(CO.companyOf(six[0]), CO.companyOf(six[2]));
CO.mergeCompanies(CO.companyOf(six[3]), CO.companyOf(six[4])); CO.mergeCompanies(CO.companyOf(six[3]), CO.companyOf(six[5]));
const K1 = CO.companyOf(six[0]), K2 = CO.companyOf(six[3]);
ok(K1 && K2 && K1 !== K2 && K1.ids.length === 3 && K2.ids.length === 3, 'two companies of three');
park(six, rd, 18); run(3);
for (const [K, a0] of [[K1, six[0]], [K2, six[3]]]) {const e = P.playerAct(a0.id, 'enter_site', {site: rd.name});
  ok(e.ok && e.proposal && /raid/.test(e.note), 'company ' + K.id + ' puts it to its party, told it is short of a raid');
  for (const id of K.ids) {const Pr = C_.propById(e.proposal); if (Pr && Pr.status === 'open' && !Pr.votes[id]) C_.castVote(S.agents.find(x => x.id === id), e.proposal, 'yes', 'test')}}
ok(K1.siteGo && K2.siteGo, 'both votes pass');
for (const a of six) {a.x = rd.x + .5; a.y = rd.y + .5; a.state = 'hunt'}
for (let f = 0; f < 5 * 60 && !rd.group; f++) {for (const a of six) if (!a.hidden) {a.x = rd.x + .5; a.y = rd.y + .5; a.state = 'hunt'} step(1 / 60)}
ok(rd.group && rd.group.mem.length === 6 && six.every(a => a.hidden && a.siteIn === rd.id), 'both go down as one raid of six (' + (rd.group && rd.group.mem.length) + ')');
ok(!K1.siteGo && !K2.siteGo, 'neither still waits at the mouth');

console.log('sitecheck: a company short of a raid calls its side');
init({fellowship: false}); run(10); T.TABLE.mode = 'off'; S.mobs.length = 0;
ok(L.pull('create_site', {theme: 'mine', region: zr, raid: true, rooms: 3}, by).ok, 'a raid mine');
const rm = S.sites.list[0];
const two = free(2, 1, {party: true}); two.forEach(a => P.markPlayer(a, true)); CO.mergeCompanies(CO.companyOf(two[0]), CO.companyOf(two[1]));
const K3 = CO.companyOf(two[0]); park(two, rm, 18);
const helpers = free(4, 1, {not: two, party: true}); park(helpers, rm, 18); for (const a of helpers) {a.x = rm.x + 8; a.y = rm.y + 3}
run(3);
const e3 = P.playerAct(two[0].id, 'enter_site', {site: rm.name});
for (const id of K3.ids) {const Pr = C_.propById(e3.proposal); if (Pr && Pr.status === 'open' && !Pr.votes[id]) C_.castVote(S.agents.find(x => x.id === id), e3.proposal, 'yes', 'test')}
for (let f = 0; f < 40 * 60 && !rm.group; f++) {for (const a of two) if (!a.hidden) {a.x = rm.x + .5; a.y = rm.y + .5; a.state = 'hunt'} step(1 / 60)}
ok(helpers.some(a => a.siteFill === K3.id || a.siteIn === rm.id), 'heroes of their side answer the call');
ok(rm.group && rm.group.mem.length >= 4 && rm.group.mem[0].company === K3.id, 'they go down together, the company first (' + (rm.group && rm.group.mem.length) + ')');

console.log('sitecheck: a background party goes down an ordinary site');
init({fellowship: false}); run(10); T.TABLE.mode = 'auto'; S.mobs.length = 0; ST.SITE.BG_P = 1;
ok(L.pull('create_site', {theme: 'ruin', region: 0, rooms: 3}, {by: 'scripted', reason: 'a test'}).ok, 'a ruin the scripted DM raised');
const bs = S.sites.list[0]; bs.state = 'discovered';
const party = free(4, 0, {party: true}); for (const a of party) PA.leaveParty(a); park(party, bs, Math.min(bs.band[1] + 2, 9)); S.sites.mt = 0;
for (let f = 0; f < 6 * 60 && !bs.group; f++) step(1 / 60);
ok(bs.group && bs.group.bg && bs.group.mem.length >= 3, 'background heroes form a party for it (' + (bs.group && bs.group.name) + ')');
for (let f = 0; f < 120 * 60 && bs.group; f++) step(1 / 60);
ok(!bs.group && S.sites.stats.bgRuns === 1 && (bs.state === 'cleared' || bs.state === 'entered'), 'they go down and the roll settles it (' + bs.state + ')');
ok(party.every(a => a.siteIn == null && a.siteAt == null), 'no one is left marked for the site');
// companies first: a site the DM agent raised waits for them
init({fellowship: false}); run(10); S.mobs.length = 0; ST.SITE.BG_P = 1;
ok(L.pull('create_site', {theme: 'ruin', region: 0, rooms: 3}, by).ok, 'a ruin the DM agent raised');
const ds = S.sites.list[0]; ds.state = 'discovered'; const p2 = free(4); park(p2, ds, 8); S.sites.mt = 0; run(4);
ok(!ds.group, 'the background leaves a fresh DM-agent site to the companies');

console.log('sitecheck: the scripted DM raises sites inside the limits');
init({}); run(10); S.mobs.length = 0;
const fz = (await import('../src/sim/dmfocus.js')).focus().zones;
const zw = REGIONS.findIndex((r, i) => i !== 0 && !fz.has(i));
const raised = DM.raiseSite(zw, 'den', false, 'a test: a den found', null);
ok(raised && raised.by === 'scripted' && raised.state === 'discovered', 'raiseSite: a den in ' + ZONES[zw] + ', discovered, by the scripted DM');
ok((S.dmLog || []).some(e => e.detail && e.detail.lever === 'create_site' && e.detail.by === 'scripted' && e.detail.result === 'applied'), 'it goes through the lever and the DM log');
const nRej = () => (S.dmLog || []).filter(e => e.detail && e.detail.lever === 'create_site' && /rejected/.test(e.detail.result || '')).length;
const rj0 = nRej();
ok(DM.raiseSite(zw, 'mine', false, 'a test: a second in the region', null) === null && nRej() === rj0, 'a second in that region is not raised, and no refusal is logged');
const zw2 = REGIONS.findIndex((r, i) => i !== 0 && i !== zw && !fz.has(i));
if (zw2 >= 0) {const r2 = L.pull('create_site', {theme: 'barrow', region: zw2}, {by: 'scripted', reason: 'a test: world upkeep'});
  ok(!r2.ok && /kept for/.test(r2.reason), 'the companies\' reserve holds: a second world site the same day is refused (' + r2.reason + ')')}
nextDay(); const r3 = DM.raiseSite(0, 'ruin', true, 'a test: a raid where the band is low', null);
ok(r3 && !r3.raid, 'a raid is not raised where the region\'s band is below the raid level');
// a world event raises one
init({fellowship: false}); run(10);
const zm = REGIONS.findIndex(r => r.band && r.band[1] >= 14);
const ev = L.pull('start_event', {kind: 'invasion', region: zm, scale: 1}, {by: 'scripted', reason: 'a test'});
ok(ev.ok, 'an invasion in ' + ZONES[zm]);
for (let f = 0; f < 12 * 60 && !(S.sites && S.sites.list.length); f++) step(1 / 60);
const es = S.sites && S.sites.list[0];
ok(es && es.theme === 'fortress' && es.raid && es.region === zm && S.worldEvent.cur.site === es.id, 'the invasion raises a raid hold there (' + (es && es.name) + ')');

if (bad) {console.error('sitecheck: ' + bad + ' failed'); process.exit(1)}
console.log('sitecheck: all ok');
