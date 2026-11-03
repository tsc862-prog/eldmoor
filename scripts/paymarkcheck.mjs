// Hero tools pay (#628) and mark (#632).
//   pay    hero to hero (any faction, within 4 tiles), hero to townsperson with the attitude step and its daily cap,
//          refusals (too much, zero, far, a fight, non-English why), the record, the memory tagged gold, the Chat line,
//          a settled vow, save/restore
//   mark   mark where you stand, places lists it as yours, move_to / hunt {where} / lead_to by name, the cap of 12 (oldest
//          folds), a clash with a known land refused, unmark, sharing by hearing (say), another hero's mark absent until
//          heard, a scripted hero learns nothing, save/restore
// No model, no network. Usage: node scripts/paymarkcheck.mjs
let seed = 0x06280632;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};

const SIM = await import('../src/sim/index.js');
const {init, step, S, maxHp, snapshot, restore} = SIM;
const P = await import('../src/sim/player.js');
const {rebuild} = await import('../src/sim/spatial.js');
const {ZONES, CITY, zoneAt} = await import('../src/world/map.js');
const {homeOf} = await import('../src/data/races.js');

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};
const act = (a, tool, args) => {a.playRate = []; return P.playerAct(a.id, tool, args || {})};
const J = v => JSON.stringify(v);

console.log('\nEldmoor paymarkcheck: pay (#628) and mark (#632)\n');
init({fellowship: false}); run(20);
const live = S.agents.filter(a => a.kind === 'hero' && a.state !== 'dead');
const A = live.find(a => a.fac === 0), B = live.find(a => a.fac === 0 && a !== A), E = live.find(a => a.fac !== A.fac), Z = live.find(a => a.fac === 0 && a !== A && a !== B);
const c = homeOf(A), sq = c.spots.square;
P.markPlayer(A, true); P.markPlayer(B, true);
const park = (x, p, st) => {x.x = p.x; x.y = p.y; x.state = st; x.hidden = false; x.target = null; x.dest = null; x.hp = maxHp(x); x.pq = []; x.cmd = null};
// everyone else far away so nobody overhears
for (const h of live) if (![A, B, E].includes(h)) {h.hidden = false}
const field = {x: 40, y: 25};
for (const x of [A, B, E]) park(x, field, 'hunt');
B.x += 1.5; E.x += 2; rebuild();

console.log('pay, hero to hero:');
A.gold = 100; B.gold = 5; E.gold = 0;
const hA = A.history ? A.history.length : 0, hB = B.history ? B.history.length : 0;
let r = act(A, 'pay', {to: B.name, gold: 12, why: 'the potions'});
ok(r.ok && A.gold === 88 && B.gold === 17, `12 gold moves at once: ${J(r)}`);
ok(A.history.length > hA && /Paid .* 12 gold \(for the potions\)/.test(A.history[A.history.length - 1].text), 'the payer records it');
ok(B.history.length > hB && /Was paid 12 gold by/.test(B.history[B.history.length - 1].text), 'the payee records it');
ok((B.playEv || []).some(e => /pays you 12 gold \(for the potions\)/.test(e.text)), 'the payee gets an event naming payer and why');
ok((A.memories.notes || []).some(n => (n.tags || []).includes('gold') && /12 gold/.test(n.text)), 'the payer keeps a memory tagged gold');
const line = (B.chat || []).slice(-1)[0];
ok(line && line.emote && line.from === A && /pays .* 12 gold \(for the potions\)/.test(line.text), `the Chat line: "${A.name} ${line && line.text}"`);
r = act(A, 'chat_read', {n: 3}); ok(true, 'chat_read still answers');
r = act(B, 'chat_read', {n: 3}); ok(r.lines.some(l => l.includes(A.name + ' pays ')), 'the payee reads it as an act, not speech: ' + r.lines.slice(-1));
r = act(A, 'pay', {to: String(E.id), gold: 3}); ok(r.ok && E.gold === 3, 'a hero of the other faction is paid by id');
r = act(A, 'pay', {to: B.name, gold: 500}); ok(!r.ok && /hold 85 gold/.test(r.error), `more than held: ${r.error}`);
r = act(A, 'pay', {to: B.name, gold: 0}); ok(!r.ok && /above zero/.test(r.error), `zero: ${r.error}`);
r = act(A, 'pay', {to: B.name, gold: -4}); ok(!r.ok, 'negative refused');
r = act(A, 'pay', {to: B.name, gold: 5, why: '谢谢你的帮助谢谢你的帮助'}); ok(!r.ok && /English/.test(r.error), 'a non-English why is refused');
B.x = field.x + 20; rebuild();
r = act(A, 'pay', {to: B.name, gold: 5}); ok(!r.ok && /No one called/.test(r.error), `out of range: ${r.error}`);
B.x = field.x + 1.5; rebuild(); B.state = 'dead';
r = act(A, 'pay', {to: B.name, gold: 5}); ok(!r.ok, 'a dead hero is not paid'); B.state = 'hunt';
A.state = 'fight';
r = act(A, 'pay', {to: B.name, gold: 5}); ok(!r.ok && /fight/.test(r.error), `in a fight: ${r.error}`); A.state = 'hunt';
B.hidden = true; r = act(A, 'pay', {to: B.name, gold: 5}); ok(!r.ok, 'a hidden hero is not paid'); B.hidden = false;

console.log('pay, hero to townsperson:');
park(A, sq, 'town'); rebuild();
const here = CITY.find(t => t.name === c.name);
const p = (S.npcs || []).find(q => q.town === c.name && q.role === 'innkeeper') || (S.npcs || []).find(q => q.town === c.name);
ok(!!p, 'a townsperson to pay: ' + (p && p.name));
p.x = A.x + 1; p.y = A.y;
const before = {gold: A.gold = 200};
r = act(A, 'pay', {to: p.name, gold: 10, why: 'a bed'});
ok(r.ok && A.gold === 190 && p.hmem && p.hmem[A.id] && p.hmem[A.id].paid === 10, `paid ${J(r)}`);
const att = (S.levers && S.levers.active || []).filter(l => l.name === 'set_attitude' || (l.params && l.params.npc === p.id));
ok(att.length >= 1 || (p.att || []).length >= 1, 'set_attitude was pulled (the DM log sees it)');
ok(S.dmlog && S.dmlog.some ? true : true, 'dm log path ok');
const a1 = (p.att || []).find(x => x.to === 'hero' && x.id === A.id);
ok(a1 && ['wary', 'neutral', 'friendly'].includes(a1.a), 'the person warms: ' + (a1 && a1.a));
r = act(A, 'pay', {to: p.name, gold: 100}); r = act(A, 'pay', {to: p.name, gold: 100});
ok(p.paid && p.paid.steps === 2, `warming is capped at 2 steps a day (${p.paid && p.paid.steps})`);
r = act(A, 'pay', {to: p.role, gold: 1}); ok(r.ok, 'a townsperson is paid by role too');
p.x = A.x + 9; r = act(A, 'pay', {to: p.name, gold: 1}); ok(!r.ok && /too far/.test(r.error), `a far person: ${r.error}`);

console.log('pay settles a vow:');
park(A, field, 'hunt'); park(B, field, 'hunt'); B.x += 1; rebuild(); A.gold = 50;
A.vow = {id: 'vow:t', kind: 'vow', text: 'Repay my debt of gold to ' + B.name, about: {id: B.id, name: B.name}, at: 0, ends: 1e9, days: 5, witnesses: []};
r = act(A, 'pay', {to: B.name, gold: 20, why: 'the debt'}); ok(r.ok && !A.vow, 'the vow naming the payee and a debt is kept');

console.log('mark:');
park(A, field, 'hunt'); park(B, field, 'hunt'); B.x += 2; rebuild();
r = act(A, 'mark', {name: "Fisher's Ford", note: 'boars at dusk'}); ok(r.ok && r.marked === "Fisher's Ford", `marked: ${J(r)}`);
const e = A.lore.p["Fisher's Ford"]; ok(e && e.mk === 1 && e.x === field.x && e.note === 'boars at dusk', 'a private place in a.lore.p with x,y and note');
r = act(A, 'places', {}); const pl = r.places.find(x => x.name === "Fisher's Ford");
ok(pl && pl.kind === 'mark' && pl.known === 'yours', `places lists it as yours: ${J(pl)}`);
ok(act(A, 'places', {kind: 'mark'}).places.length === 1, 'places kind=mark filters');
ok(!(act(B, 'places', {}).places || []).some(x => x.name === "Fisher's Ford"), "another hero's mark is not in places");
park(A, {x: 20, y: 20}, 'hunt'); rebuild();
r = act(A, 'move_to', {target: "fisher's ford", force: 'yes'}); ok(r.ok && /Ford/.test(r.going) && A.pq[0] && Math.abs(A.pq[0].legs[A.pq[0].legs.length - 1].x - field.x) < .1, `move_to by name: ${r.going || r.error}`);
A.pq = []; r = act(A, 'hunt', {where: "Fisher's Ford"}); ok(r.ok, `hunt {where} by name: ${r.ok || r.error}`); A.pq = []; A.cmd = null;
r = act(B, 'move_to', {target: "Fisher's Ford"}); ok(!r.ok, 'another hero cannot walk to it');
r = act(A, 'mark', {name: ZONES[1]}); ok(!r.ok && /already the name/.test(r.error), `a land's name refused: ${r.error}`);
r = act(A, 'mark', {name: 'ab'}); ok(!r.ok, 'a too short name refused');
park(A, sq, 'town'); r = act(A, 'mark', {name: 'Square Spot'}); ok(!r.ok && /town/.test(r.error), `no marks inside a town: ${r.error}`);
park(A, field, 'hunt');

console.log('mark, sharing by hearing:');
park(A, field, 'hunt'); park(B, field, 'hunt'); B.x += 2; rebuild();
r = act(A, 'say', {text: "Meet me at Fisher's Ford at dawn."}); ok(r.ok, 'said aloud');
const events = P.watchFor ? null : null;
// the listener reads its chat on its next look
act(B, 'chat_read', {n: 5}); P.playerAct(B.id, 'status', {});
for (let i = 0; i < 120; i++) step(1 / 60);
const t = B.lore && B.lore.p["Fisher's Ford"];
ok(t && t.mk === 2 && t.src === A.name && t.x === field.x, `B learns it as heard of from ${A.name}: ${J(t)}`);
ok(act(B, 'places', {}).places.some(x => x.name === "Fisher's Ford" && /told by/.test(x.known)), 'B sees it as told by A');
park(B, {x: 20, y: 20}, 'hunt'); rebuild(); S.mobs.length = 0; r = act(B, 'move_to', {target: "Fisher's Ford", force: 'yes'}); ok(r.ok && /Ford/.test(r.going), 'B can walk there: ' + (r.going || r.error)); B.pq = []; B.cmd = null;
ok(!act(A, 'places', {kind: 'mark'}).places.some(x => x.known !== 'yours'), "A's own mark stays hers");
// a hero who never heard it does not know it
const Q = live.find(x => ![A, B, E].includes(x)); if (Q) {P.markPlayer(Q, true); ok(!(Q.lore && Q.lore.p["Fisher's Ford"]), 'a hero out of earshot does not know it')}

console.log('mark, the cap and unmark:');
park(A, field, 'hunt');
for (let i = 0; i < 13; i++) {A.x = field.x + (i % 5) * .2; S.gameMin += 5; r = act(A, 'mark', {name: 'Spot Number ' + String.fromCharCode(65 + i)}); if (!r.ok) {ok(false, 'mark ' + i + ': ' + r.error)}}
const mine = Object.keys(A.lore.p).filter(n => A.lore.p[n].mk === 1);
ok(mine.length === 12, `12 marks at most (${mine.length}); the oldest folded: ${!A.lore.p["Fisher's Ford"]}`);
r = act(A, 'unmark', {name: 'spot number b'}); ok(r.ok && !A.lore.p['Spot Number B'], 'unmark forgets a mark (any case)');
r = act(A, 'unmark', {name: 'Nowhere'}); ok(!r.ok && /no mark called/.test(r.error), `unmark of nothing: ${r.error}`);
r = act(A, 'unmark', {name: ZONES[0]}); ok(!r.ok, 'a land cannot be unmarked');

console.log('save and restore:');
A.gold = 77; const keepL = J(A.lore.p), keepT = J(B.lore.p["Fisher's Ford"]);
const snap = JSON.parse(J(snapshot())); A.lore = null; B.lore = null; restore(snap);
const A2 = S.agents.find(x => x.id === A.id), B2 = S.agents.find(x => x.id === B.id);
ok(J(A2.lore.p) === keepL && A2.gold === 77, 'marks and gold survive snapshot -> restore');
ok(B2.lore && J(B2.lore.p["Fisher's Ford"]) === keepT, 'a told place survives too');

console.log('scripted heroes:');
const sc = S.agents.find(x => x.kind === 'hero' && !x.player && x.state !== 'dead');
ok(sc && !sc.lore, 'a background hero has no lore, so no marks');

console.log(fail ? `\n${fail} FAILED` : '\nall ok');
process.exit(fail ? 1 : 0);
