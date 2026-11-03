// Learn the world check (issue #188): an agent-played hero knows only what it saw, heard or was told.
//   sight     a creature first seen is described, never numbered (no level, no HP) in look, status, events, the
//             state header and the fight tool; the read is deterministic (no shared RNG drawn)
//   growth    fighting it teaches its name and measure, a kill and its tricks are kept, a near death is a lesson
//             (an event and a reflection moment), a hero falling to it in sight teaches every agent hero who saw
//   words     a warning heard (a hero in earshot, a companion's shout, the criers, a townsperson) teaches the
//             creature's name and the place, and marks them dangerous; out of range nothing is learned
//   places    move_to/lead_to refuse places the hero never heard of, accept them once told, and always accept
//             a direction or coordinates; status.places lists only known places, with no level bands
//   hunting   hunt prey must be a creature known by name; hunt without prey leaves feared creatures alone
//   jobs      list_jobs gives the job's words and the gate's rumour, never "fits"
//   dm places a DM-marked place (S.places) is learned when seen, heard named or told by a job (#423), never with its
//             reason; move_to and hunt {where} take it then; it fades with the marker; background heroes learn none
//   rest      background heroes never get lore; a.lore survives snapshot -> restore
// No model, no network. Usage: npm run lorecheck (LORECHECK_SEED to vary).
let seed = 0x10ce0188 ^ (Number(process.env.LORECHECK_SEED) || 7);
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};

const SIM = await import('../src/sim/index.js');
const {init, step, S, maxHp, snapshot, restore} = SIM;
const P = await import('../src/sim/player.js');
const L = await import('../src/sim/lore.js');
const F_ = await import('../src/sim/fellowship.js');
const PC = await import('../src/sim/pace.js');
const RF = await import('../src/sim/reflect.js');
const HE = await import('../src/sim/heroes.js');
const MO = await import('../src/sim/mobs.js');
const {speak} = await import('../src/sim/chat.js');
const {rebuild} = await import('../src/sim/spatial.js');
const {ZONES, REGIONS, CRYPT, LANDMARKS, zoneAt, zonePoint, dist} = await import('../src/world/map.js');
const {MOBS} = await import('../src/data/mobs.js');
const {homeOf} = await import('../src/data/races.js');

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};
const act = (a, tool, args) => P.playerAct(a.id, tool, args || {});
const J = v => JSON.stringify(v);

console.log('\nEldmoor lorecheck: heroes learn the world in the game (#188)\n');
init({fellowship: false}); run(26); // the warm-up length picks a seed-dependent start where A's home field is clear of the other faction's wall (the roster changes with every class)
const A = S.agents.find(a => a.fac === 0 && a.state !== 'dead' && a.kind === 'hero');
const c = homeOf(A), home = zoneAt(c.gate.x, c.gate.y);
A.lvl = 3; A.hp = maxHp(A); P.markPlayer(A, true);
// park A in the field of its home region, with no creature near
const spot = zonePoint(home, null, c.gate);
const park = (x, p, st = 'hunt') => {x.x = p.x; x.y = p.y; x.state = st; x.hidden = false; x.target = null; x.dest = null; x.hp = maxHp(x); x.pq = []};
park(A, spot);
for (const m of S.mobs) if (dist(m, spot) < 16) {m.alive = false; m.gone = true}
rebuild();
// the "far" region: the next one up from A's level, which A has never seen or heard of
const up = ZONES.map((n, i) => i).filter(i => REGIONS[i] && REGIONS[i].band && REGIONS[i].band[0] > A.lvl + 1).sort((x, y) => REGIONS[x].band[0] - REGIONS[y].band[0])[0];
const upKey = Object.keys(MOBS).find(k => MOBS[k].z === up);
ok(up != null && upKey, `home ${ZONES[home]}, unknown region ${ZONES[up]} (home of ${MOBS[upKey].pl})`);

// ---------------------------------------------------------------- 1. places
console.log('places');
let st = act(A, 'status');
ok(st.places.includes(ZONES[home] + ' (home)') && !st.places.some(p => p.startsWith(ZONES[up])), `status.places: ${st.places.slice(8).join(', ')}`);
ok(!/\(L\d+-\d+\)/.test(J(st.places)) && st.hunting_ground === undefined, 'no level bands and no picked hunting ground in status');
let r = act(A, 'move_to', {target: ZONES[up]});
ok(!r.ok && /never been to|heard of/.test(r.error), `move_to an unheard-of region is refused: ${r.error}`);
r = act(A, 'move_to', {target: CRYPT.name}); ok(!r.ok, 'move_to an unheard-of landmark is refused');
// toward the middle of the map: the roster can seat A by the edge, where that way is (rightly) refused as the world's end
{const {H} = await import('../src/world/tiles.js'); const way = A.y < H / 2 ? 'south' : 'north';
  r = act(A, 'move_to', {target: 'explore ' + way}); ok(r.ok && r.explore, `a direction is always open: ${r.going}`)}
r = act(A, 'move_to', {target: Math.round(spot.x + 3) + ',' + Math.round(spot.y)}); ok(r.ok, 'coordinates are always open');
r = act(A, 'move_to', {target: ZONES[home]}); ok(r.ok, 'the home region is known');
A.pq = []; A.state = 'hunt';

// ---------------------------------------------------------------- 2. first sight: described, not numbered
console.log('a creature first seen');
const SECRET_LVL = 37;
const mob = S.mobs.find(m => m.alive && !m.gone && !m.elite && !m.named && MOBS[m.type].z === home);
const realName = MOBS[mob.type].name;
mob.x = A.x + 3; mob.y = A.y; mob.lvl = SECRET_LVL; mob.maxhp = 9137; mob.hp = 4567; mob.target = null; mob.dest = null; mob.home = {x: mob.x, y: mob.y}; mob.spawn = {x: mob.x, y: mob.y};
rebuild();
const look = act(A, 'look'), seen = (look.monsters || []).find(m => m.id === mob.id);
ok(seen && seen.lvl === undefined && seen.hurt === undefined && /lightly|badly/.test(seen.wounded), `look shows it without level or HP: ${J(seen)}`);
const e0 = A.lore.c[L.keyOf(mob)];
ok(seen && (e0.name ? seen.what === realName : seen.what.startsWith('a ') && !seen.what.includes(realName)), `named only if the read knew it (${e0.read ? 'read ok' : 'read failed'}, ${e0.name ? 'named' : 'described'}): "${seen && seen.what}", threat "${seen && seen.threat}"`);
ok(seen && seen.new_to_you, 'first sight is flagged as new');
const noNums = (what, v) => {const s = J(v); ok(!/\b37\b|9137|4567|\b50%/.test(s), `${what} carries no level or HP number of the creature`)};
noNums('look', look);
// the fight tool and what follows: events, the state header, the doing line
mob.hp = mob.maxhp = 25 + 2 * 16; mob.lvl = 2; // make it beatable
r = act(A, 'fight', {target_id: mob.id});
ok(r.ok && r.target && !/L\d/.test(r.target) && r.threat, `fight answers in words: ${r.target}, ${r.threat}${r.warning ? ', ' + r.warning : ''}`);
run(0.2);
const br = PC.paceBrief(A.id).brief;
ok(br.foe == null || !/level/.test(br.foe), `the state header's foe has no level: ${br.foe}`);
ok(A.lore.c[L.keyOf(mob)].fought === 1 && A.lore.c[L.keyOf(mob)].name, 'closing with it teaches its name');
for (let k = 0; k < 60 && mob.alive; k++) run(0.5);
console.log('    (the fight: ' + (mob.alive ? 'still alive' : 'over') + ', A ' + A.state + ', kills ' + A.kills + ')');
if (!(A.lore.c[L.keyOf(mob)].killed >= 1)) {mob.alive = true; mob.gone = false; HE.killMob(A, mob)} // someone else may have taken it: the kill itself is what is checked
ok(A.lore.c[L.keyOf(mob)].killed >= 1, `the kill is kept (killed ${A.lore.c[L.keyOf(mob)].killed})`);
let lv = act(A, 'lore', {about: realName});
ok(lv.creatures.length === 1 && lv.creatures[0].name === realName && /fought once/.test(J(lv.creatures[0].known)) && !/\b(lvl|level)\b/.test(J(lv)), `lore: ${J(lv.creatures[0])}`);
st = act(A, 'status'); noNums('status', st);

// ---------------------------------------------------------------- 3. words heard
console.log('warnings heard');
const B = S.agents.find(b => b !== A && b.fac === 0 && b.state !== 'dead' && b.kind === 'hero');
park(B, {x: A.x + 2, y: A.y}); park(A, {x: A.x, y: A.y}); rebuild();
speak(B, `Beware the ${MOBS[upKey].pl} in ${ZONES[up]}. They nearly had me.`, 'idle');
run(0.1);
const eUp = A.lore.c[upKey], pUp = A.lore.p[ZONES[up]];
ok(eUp && eUp.told && eUp.warned && /Beware/.test(eUp.warned), `a warning heard in earshot names the creature and marks it: ${eUp && eUp.warned}`);
ok(pUp && pUp.how === 'told' && pUp.warned, `and teaches the place (${ZONES[up]}: ${pUp && pUp.how})`);
r = act(A, 'move_to', {target: ZONES[up]});
ok(r.ok && r.warning && /warned/.test(r.warning), `move_to a place heard of works, with the warning: ${r.warning}`);
A.pq = []; A.state = 'hunt';
r = act(A, 'hunt', {prey: 'Snow Gryphon'}); ok(!r.ok && /know of no creature/.test(r.error), 'hunt prey nobody told of is refused');
r = act(A, 'hunt', {prey: MOBS[upKey].name}); ok(r.ok && A.pq[0].prey === upKey, `hunt a creature known by name: ${r.hunting}`);
A.pq = [];
// hunt without prey leaves what the hero fears: a warned creature close, a harmless one farther
// the world's own mobs when about, else fresh ones (the fixture must not depend on what the RNG left alive)
const spawnOne = type => {const m = MO.spawnMob(type); if (!S.mobs.includes(m)) S.mobs.push(m); return m};
const near = S.mobs.find(m => m.alive && !m.gone && m.type === upKey) || spawnOne(upKey), meek = S.mobs.find(m => m.alive && !m.gone && m.type === mob.type && m !== mob) || spawnOne(mob.type);
near.x = A.x + 2; near.y = A.y; near.target = null; meek.x = A.x + 5; meek.y = A.y; meek.target = null; rebuild();
const pick = L.pickPrey(A, {kind: 'hunt', n: 1});
ok(pick === meek, `hunt without prey passes over the ${MOBS[upKey].name} it was warned of and picks ${pick && MOBS[pick.type].name}`);
ok(L.pickPrey(A, {kind: 'hunt', n: 1, prey: upKey}) === near, 'hunt with that prey takes it on all the same (the hero\'s choice)');
near.x = meek.x = A.x + 40; rebuild();
// the town criers
r = act(A, 'read_chronicle', {n: 20});
ok(r.ok, `read_chronicle (${r.news.length} lines)`);
// a townsperson's advice: a fresh hero in town is warned off the next region up
const D = S.agents.find(b => b !== A && b !== B && b.fac === 0 && b.state !== 'dead' && b.kind === 'hero');
D.lvl = 1; P.markPlayer(D, true); const dc = homeOf(D); park(D, {x: dc.gate.x, y: dc.gate.y - 1}, 'town');
const npc = (S.npcs || []).find(p => p.town === dc.name);
if (npc) {D.x = npc.x; D.y = npc.y + .5; r = act(D, 'talk', {target: npc.role});
  const w = Object.entries(D.lore.p).find(([n, p]) => p.warned);
  ok(r.ok && /no place for green blades/.test(r.answer) && w, `a townsperson warns a green blade: "${r.answer}" (${w && w[0]})`);
  r = act(D, 'talk', {target: npc.role}); ok(!/no place for green blades/.test(r.answer || ''), 'and does not repeat it once heeded')}
else ok(false, 'a townsperson in town');

// ---------------------------------------------------------------- 4. jobs
console.log('jobs');
park(A, {x: c.gate.x, y: c.gate.y - 1}, 'town');
r = act(A, 'list_jobs');
ok(r.ok && (r.jobs || []).every(j => j.fits === undefined && j.why_not === undefined), `list_jobs gives no "fits" (${(r.jobs || []).length} jobs${r.jobs && r.jobs[0] ? ', e.g. ' + J({job: r.jobs[0].job, party: r.jobs[0].party, rumour: r.jobs[0].rumour}) : ''})`);

// ---------------------------------------------------------------- 5. lessons
console.log('lessons');
park(A, spot); rebuild();
const brute = S.mobs.find(m => m.alive && !m.gone && !m.elite && MOBS[m.type].z === home && m !== mob && L.keyOf(m) !== L.keyOf(mob)) || S.mobs.find(m => m.alive && !m.gone && !m.elite && m.type !== mob.type);
brute.x = A.x + .8; brute.y = A.y; brute.target = A; A.target = brute; A.state = 'fight'; rebuild();
run(0.05); A.hp = maxHp(A) * .2; brute.hp = brute.maxhp; run(0.05);
const eb = A.lore.c[L.keyOf(brute)];
ok(eb && eb.hurt === 1, `a near death is a lesson (${L.realName(brute)}: hurt ${eb && eb.hurt})`);
ok((A.playEv || []).some(e => /A hard lesson/.test(e.text)), 'an event says so');
const due = RF.reflectDue(A);
ok(due && /hard lesson/.test(due.why), `a reflection moment is due: ${due && due.why}`);
A.hp = maxHp(A); A.target = null; A.state = 'hunt'; brute.target = null; brute.x = A.x + 40; rebuild();
// a hero falls to a creature in sight
const V = S.agents.find(b => b !== A && b !== B && b !== D && b.fac === 0 && b.state !== 'dead' && b.kind === 'hero');
const killer = S.mobs.find(m => m.alive && !m.gone && !m.elite && m.type === upKey);
park(V, {x: A.x + 3, y: A.y}); rebuild();
const ek0 = (A.lore.c[upKey] && A.lore.c[upKey].fell) || 0;
HE.agentDie(V, killer);
ok(A.lore.c[upKey].fell === ek0 + 1 && (A.playEv || []).some(e => e.text.includes('You saw ' + V.name + ' fall')), `seeing ${V.name} fall to it teaches it (${MOBS[upKey].name})`);

// ---------------------------------------------------------------- 6. the Fellowship shares lore by talking (in range)
console.log('a lesson told is learned');
const F = F_.found(F_.autoPick(0), {fac: 0, ai: false}); F_.setMinds('agent');
const M = F_.fellowshipMembers().map(m => m.hero);
ok(F.ok && M.length === 5 && M.every(x => x.player), 'a Fellowship of five agent heroes');
const fspot = zonePoint(home, null, c.gate);
M.forEach((x, i) => park(x, i < 3 ? {x: fspot.x + i * .8, y: fspot.y} : {x: fspot.x > 40 ? 3 : 76, y: fspot.y > 25 ? 3 : 46}));
rebuild(); for (const x of M) {x.lore = null; L.loreOf(x)}
const wight = Object.keys(MOBS).sort((x, y) => MOBS[y].z - MOBS[x].z)[0];
r = act(M[0], 'party_say', {text: `Mind the ${MOBS[wight].pl}: deadly, all of them.`});
ok(r.ok, `party_say: ${r.said}`); run(0.1);
ok(M[1].lore.c[wight] && M[1].lore.c[wight].warned && M[2].lore.c[wight] && M[2].lore.c[wight].told, `companions in range learn the ${MOBS[wight].name}`);
ok(!M[3].lore.c[wight] && !M[4].lore.c[wight], 'companions out of range learn nothing');

// ---------------------------------------------------------------- 6b. DM-marked places (#423): seen, heard, told by a job
console.log('DM-marked places');
{const LV = await import('../src/sim/levers.js'), actA = (t, x) => {A.playRate = []; return act(A, t, x)};
  if (!S.places) S.places = [];
  park(A, spot); park(B, {x: spot.x + 1.5, y: spot.y}); rebuild(); run(0.05);
  const farX = spot.x > 40 ? 3 : 76, mk = (name, x, y) => {const p = {id: ++S.uid, kind: 'shrine', name, x, y, z: zoneAt(x, y), born: S.gameMin, until: S.gameMin + 600, lever: -1}; S.places.push(p); return p};
  const seenP = mk('Weeping Cairn', spot.x + 3, spot.y), heardP = mk('the Hidden Barrow', farX, spot.y), jobP = mk('Lantern Hollow', farX, spot.y > 25 ? 4 : 45);
  r = actA('move_to', {target: 'Hidden Barrow'}); ok(!r.ok && /Unknown place/.test(r.error), 'move_to a DM place out of sight and never heard of is refused: ' + r.error);
  A.pq = []; A.state = 'hunt'; run(0.05);
  ok(A.lore.p['Weeping Cairn'] && A.lore.p['Weeping Cairn'].how === 'seen' && (A.playEv || []).some(e => e.text.includes('You see Weeping Cairn')), 'a DM place in sight is seen (lore and an event)');
  ok(!A.lore.p['the Hidden Barrow'] && !A.lore.p['Lantern Hollow'], 'places out of sight are not learned');
  speak(B, 'Folk whisper of the Hidden Barrow past the hills. Beware it after dark.', 'idle'); run(0.05);
  const hb = A.lore.p['the Hidden Barrow'];
  ok(hb && hb.how === 'told' && hb.warned, 'a DM place named in earshot is heard of, with the warning: ' + (hb && hb.warned));
  st = actA('status'); ok(st.places.some(p => p.startsWith('the Hidden Barrow')), 'status.places lists it: ' + st.places.filter(p => /Barrow|Cairn/.test(p)).join(', '));
  r = actA('move_to', {target: 'Hidden Barrow'}); ok(r.ok && /Hidden Barrow/.test(r.going) && /warned/.test(r.warning || ''), 'move_to takes it once heard of ("the" optional), with the warning: ' + (r.going || r.error));
  A.pq = []; A.state = 'hunt';
  r = actA('hunt', {where: 'the Hidden Barrow'}); ok(r.ok, 'hunt {where} takes it too: ' + (r.hunting || r.going || r.error)); A.pq = []; A.state = 'hunt';
  ok(actA('lore', {about: 'Barrow'}).places.some(p => p.place === 'the Hidden Barrow' && p.how === 'you have heard of it'), 'the lore tool lists it');
  // told by a job: the DM posts one at A's board that names a place
  park(A, {x: c.gate.x, y: c.gate.y - 1}, 'town');
  const board = (S.adventures || []).filter(h => h.phase === 'open' && h.town === c.name); for (const h of board.slice(LV.LK.BOARD_MAX - 2)) h.phase = 'held';
  const secretReason = 'ZQX-REASON-423';
  r = LV.pull('post_hook', {town: c.name, tpl: 'relic', giver: 'priest', target: jobP.id}, {by: 'dm-agent', reason: secretReason});
  ok(r.ok, 'the DM posts a job at ' + c.name + ' that names Lantern Hollow' + (r.ok ? '' : ': ' + r.error));
  r = actA('list_jobs');
  ok(A.lore.p['Lantern Hollow'] && A.lore.p['Lantern Hollow'].how === 'told', 'list_jobs tells of the place the job names');
  r = actA('move_to', {target: 'lantern hollow'}); ok(r.ok, 'move_to takes the job-told place: ' + (r.going || r.error)); A.pq = [];
  for (const h of board) if (h.phase === 'held') h.phase = 'open';
  // a job offered to the hero by name, anywhere: known without reading the board
  const offerP = mk('Sunk Mill', farX, spot.y > 25 ? 8 : 41); park(A, spot); rebuild();
  const hold2 = (S.adventures || []).filter(h => h.phase === 'open' && h.town === c.name); for (const h of hold2.slice(LV.LK.BOARD_MAX - 2)) h.phase = 'held';
  r = LV.pull('post_hook', {town: c.name, tpl: 'relic', target: offerP.id, forHero: A.id}, {by: 'dm-agent', reason: secretReason}); run(0.05);
  for (const h of hold2) if (h.phase === 'held') h.phase = 'open';
  ok(r.ok && A.lore.p['Sunk Mill'] && A.lore.p['Sunk Mill'].how === 'told', 'a job offered to the hero by name tells of its place' + (r.ok ? '' : ': ' + r.error));
  ok(!J(A.lore).includes(secretReason) && !J(actA('lore')).includes(secretReason) && !J(actA('status')).includes(secretReason) && !J(A.playEv || []).includes(secretReason), 'no DM reason in the hero\'s lore, tools or events');
  // the marker goes, and the name fades with it
  S.places = S.places.filter(p => p !== heardP); run(0.05);
  ok(!A.lore.p['the Hidden Barrow'], 'a gone marker fades from lore');
  r = actA('move_to', {target: 'Hidden Barrow'}); ok(!r.ok && /Unknown place/.test(r.error), 'and move_to refuses it again: ' + r.error); A.pq = []; A.state = 'hunt';
  // a background hero beside a marker learns nothing
  const bg = S.agents.find(x => !x.player && x.state !== 'dead' && x.kind === 'hero');
  if (bg) {const bx = {x: bg.x, y: bg.y}; bg.x = seenP.x + 1; bg.y = seenP.y; L.visit(bg); L.hear(bg, 'Lantern Hollow lies east.'); ok(!bg.lore, 'a background hero learns no DM place'); bg.x = bx.x; bg.y = bx.y}
  S.places = S.places.filter(p => ![seenP, jobP, offerP].includes(p)); run(0.05)}

// ---------------------------------------------------------------- 7. the rest of the world, and saving
console.log('background heroes and saving');
ok(S.agents.filter(x => !x.player).every(x => !x.lore), 'background heroes never get lore');
const snap = JSON.parse(JSON.stringify(snapshot())), keep = J(A.lore);
A.lore = null; restore(snap);
const A2 = S.agents.find(x => x.id === A.id);
ok(A2 && J(A2.lore) === keep, 'a.lore survives snapshot -> restore');
// nothing a hero tool returned carried the creature's planted numbers
noNums('the events', A2.playEv);

// ---------------------------------------------------------------- the Crypt stair sign and the captain (#448)
console.log('crypt stair');
{
  const B = S.agents.find(x => x.id !== A2.id && x.kind === 'hero' && x.state !== 'dead' && !x.fellow);
  B.lvl = 1; B.hp = maxHp(B); P.markPlayer(B, true); B.lore = null; B.loreZ = null;
  B.x = CRYPT.x; B.y = CRYPT.y + 3; B.state = 'hunt'; B.hidden = false;
  L.visit(B);
  ok(J(B.playEv).includes('tried blades; you are not'), 'a level-1 hero at the stair reads the sign');
  ok(L.placesView(B).some(p => p.startsWith(CRYPT.name) && /danger/.test(p)), 'the stair is marked dangerous to a level-1 hero');
  ok(L.captainWarning(B) && /green blades/.test(L.captainWarning(B)), 'the gate captain warns a green blade');
  B.lvl = 8;
  ok(L.captainWarning(B) === null, 'no warning once the hero is inside the region band');
}

console.log(fail ? `\nlorecheck: ${fail} FAILED\n` : '\nlorecheck: all ok\n');
process.exit(fail ? 1 : 0);
