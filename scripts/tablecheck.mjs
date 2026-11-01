// Fellowship phase B check (issue #68): Table mode, the council and the party as one unit, with
// mock agents (no model, no network). Five members: two agent-played (one answers, one is
// silent), three scripted.
//   - a rescue scene at 1x pauses the world, runs the turns in initiative order (the answering
//     agent's act, the silent agent's reflex after the turn budget, scripted members at once) and
//     resumes; the world never hangs; a save taken mid-scene resumes the scene
//   - at 3x the same kind of scene resolves at once, without pausing, and is summarised
//   - proposals: a decision scene at the table, async votes at 3x with a timeout, all votes in
//   - lead_to: the leader leads, the party follows (the silent agent too)
//   - the Crypt: the Fellowship is drafted all together or not at all; an agent party is asked
//     first (a proposal) and goes together when it votes yes
//   - without a Fellowship, two seeded runs are identical (determinism)
// Usage: npm run tablecheck   (TABLECHECK_SEED to vary the world)
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

let seed = 0x9e3779b9 ^ (Number(process.env.TABLECHECK_SEED) || 68);
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};

const SIM = await import('../src/sim/index.js');
const {init, step, S, snapshot, restore, maxHp} = SIM;
const P = await import('../src/sim/player.js');
const F_ = await import('../src/sim/fellowship.js');
const T = await import('../src/sim/table.js');
const C = await import('../src/sim/council.js');
const {CRYPT, zoneFor, zonePoint, dist} = await import('../src/world/map.js');
const {homeOf} = await import('../src/data/races.js');
const {score} = await import('../src/sim/abilities.js');

// ---- determinism child: a seeded world without a Fellowship, hashed ----
if (process.argv[2] === '--hash') {
  init({fellowship: false}); for (let i = 0; i < 180 * 60; i++) step(1 / 60);
  let h = Math.round(S.gameMin); for (const a of S.agents) h = (Math.imul(h, 31) + a.lvl * 1000 + Math.round(a.xp) + Math.round(a.x * 10) * 7 + Math.round(a.hp)) | 0;
  console.log('HASH ' + h + ' table:' + (S.table ? 1 : 0) + ' fellowship:' + (S.fellowship ? 1 : 0)); process.exit(0);
}

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};
const act = (a, tool, args) => P.playerAct(a.id, tool, args || {});

console.log('\nEldmoor tablecheck: Table mode, the council and the party as one unit (mock agents)\n');
init({fellowship: false}); run(60); // the old start (#111): this check founds its own Fellowship
for (const a of S.agents) if (a.fac === 0) {a.lvl = 8; a.hp = maxHp(a)}
const r0 = F_.found(F_.autoPick(0), {fac: 0, ai: false});
ok(r0.ok && F_.fellows().length === 5, `founded ${S.fellowship && S.fellowship.name} with ${F_.fellows().length} members`);
const M = F_.fellowshipMembers().map(m => m.hero);
const [A, B, ...rest] = M; // A answers, B is silent; the rest are scripted
F_.setMinds('agent');
for (const x of rest) {P.markPlayer(x, false); delete x.fellowAgent}
ok(A.player && B.player && rest.every(x => !x.player), `agents: ${A.name} (answers), ${B.name} (silent); scripted: ${rest.map(x => x.name).join(', ')}`);

// Put the whole party in the field around a monster.
const zone = zoneFor(8, homeOf(A).gate), spot = zonePoint(zone, null, homeOf(A).gate);
const place = () => {M.forEach((x, i) => {x.x = spot.x + (i % 3) * .6; x.y = spot.y + Math.floor(i / 3) * .6; x.state = 'hunt'; x.hidden = false; x.target = null; x.dest = null; x.hp = maxHp(x); x.pq = []})};
const mobNear = () => {const m = S.mobs.filter(m => m.alive && !m.gone && !m.elite).sort((p, q) => dist(p, spot) - dist(q, spot))[0]; m.x = spot.x + 1; m.y = spot.y; m.hp = m.maxhp; return m};
const startFight = (x, m) => {x.state = 'fight'; x.target = m; m.target = x; x.hp = maxHp(x) * .24; m.maxhp *= 20; m.hp = m.maxhp; m.cd = 99}; // a tough foe that holds its blow, so no one dies or flees mid-test

// ---- 1. a rescue scene at 1x ----
T.TABLE.speed = 1; T.TABLE.turnMs = 7000; T.TABLE.mode = 'auto';
place(); let m = mobNear(); const victim = rest[0]; startFight(victim, m);
T.tableTick(); // the trigger rules (step() runs them after the heroes move)
let sc = S.table;
ok(sc && sc.kind === 'rescue' && sc.pause, `a member at ${Math.round(victim.hp / maxHp(victim) * 100)}% opens a rescue scene (${sc && sc.title}), world paused`);
ok(sc && sc.ids.length === 5 && sc.ids.every((id, i) => i === 0 || score(S.agents.find(x => x.id === sc.ids[i - 1]), 'reflex') >= score(S.agents.find(x => x.id === id), 'reflex')), 'initiative order follows Reflex (with gear)');
const evA = (A.playEv || []).slice(-3).map(e => e.text).join(' | ');
ok(/TABLE \(rescue\)/.test(evA) && (A.playEv || []).some(e => e.u), 'the agent gets an urgent table event with its options');
let st = act(A, 'status');
ok(st.ok && st.table && st.table.options && st.table.options.length >= 2, `status shows the table: ${st.table && st.table.options.join('; ')}`);
let w = act(A, 'scene_act', {option: 'strike', line: 'Hold on, I am coming!'});
ok(w.ok && w.chose === 'strike', 'the answering agent locks in strike before its turn');
ok(!act(A, 'scene_act', {option: 'retreat'}).ok, 'a second act in the same scene is refused');
ok(!act(B, 'scene_act', {option: 'dance'}).ok, 'an option the scene does not offer is refused');
const g0 = S.gameMin; let frames = 0, maxPause = 0;
while (S.table && frames < 60 * 40) {const before = S.gameMin; step(1 / 60); frames++; if (S.table && S.gameMin !== before) maxPause = 1}
ok(!S.table, `the scene resolved after ${(frames / 60).toFixed(1)} s of real time (silent agent budget ${T.TABLE.turnMs / 1000} s)`);
ok(frames / 60 <= T.TABLE.frameS + T.TABLE.outcomeS + T.TABLE.turnMs / 1000 + 1, 'the scene took no longer than one turn budget plus framing (the world never hangs)');
ok(maxPause === 0, 'the world clock stood still for the whole scene');
const beats = sc.beats, bA = beats.find(b => b.id === A.id), bB = beats.find(b => b.id === B.id);
ok(bA && bA.by === 'agent' && bA.k === 'strike' && bB && bB.by === 'reflex' && rest.every(x => (beats.find(b => b.id === x.id) || {}).by === 'reflex'), `turns: ${beats.map(b => b.name + '=' + b.k + '(' + b.by + ')').join(', ')}`);
ok(S.fellowship.log.some(e => e.kind === 'table'), 'the outcome is in the campaign log');
step(1 / 60); ok(S.gameMin > g0, 'the world runs on after the scene');

// ---- 1b. a save mid-scene ----
place(); m = mobNear(); startFight(rest[1], m); T.tableTick();
ok(S.table && S.table.pause, 'a second rescue scene opens');
const snap = JSON.parse(JSON.stringify(snapshot())); restore(snap);
ok(S.table && S.table.kind === 'rescue', 'a save taken mid-scene restores the scene');
frames = 0; while (S.table && frames < 60 * 40) {step(1 / 60); frames++}
ok(!S.table, `the restored scene resolves (${(frames / 60).toFixed(1)} s)`);
const RA = S.agents.find(x => x.id === A.id), RB = S.agents.find(x => x.id === B.id), Rrest = rest.map(x => S.agents.find(y => y.id === x.id)), RM = [RA, RB, ...Rrest];

// ---- 2. the same moment at 3x: no pause, resolved and summarised at once ----
T.TABLE.speed = 3;
RM.forEach((x, i) => {x.x = spot.x + (i % 3) * .6; x.y = spot.y; x.state = 'hunt'; x.hidden = false; x.target = null; x.hp = maxHp(x); x.pq = []});
m = S.mobs.filter(q => q.alive && !q.gone && !q.elite)[3]; m.x = spot.x + 1; m.y = spot.y; startFight(Rrest[2], m);
const n0 = S.fellowship.log.filter(e => e.kind === 'table').length, g1 = S.gameMin;
T.tableTick(); step(1 / 60);
ok(!S.table && S.fellowship.log.filter(e => e.kind === 'table').length === n0 + 1 && S.gameMin > g1, 'at 3x the scene resolves in the same step, summarised in the log, the clock running');

// ---- 3. proposals (in town, where nothing attacks) ----
T.TABLE.speed = 1;
RM.forEach(x => {const c = homeOf(x); x.state = 'town'; x.townStep = 2; x.wait = 9; x.x = c.gate.x; x.y = c.gate.y - 1; x.target = null; x.pq = []; x.hp = maxHp(x)});
let pr = act(RA, 'propose', {kind: 'other', details: 'Camp by the water tonight'});
ok(pr.ok && S.table && S.table.kind === 'decision', `a proposal at 1x becomes a decision scene (${pr.proposal})`);
const pid = Number(String(pr.proposal).match(/#(\d+)/)[1]);
frames = 0; while (S.table && frames < 60 * 40) {step(1 / 60); frames++}
let PP = C.propById(pid);
ok(PP && PP.status !== 'open' && Object.keys(PP.votes).length === 5 && PP.votes[RB.id].by === 'reflex' && PP.votes[RA.id].by === 'agent', `the table voted (${PP && PP.result}); the silent agent's vote fell to reflex`);
ok(S.fellowship.log.some(e => e.kind === 'council' && /settles it/.test(e.parts.map(p => typeof p === 'string' ? p : '').join(''))), 'the leader settles it in the campaign log');
T.TABLE.speed = 3;
pr = act(RA, 'propose', {kind: 'split', details: 'Each of us hunts alone until dusk'});
const pid2 = Number(String(pr.proposal).match(/#(\d+)/)[1]);
ok(pr.ok && !S.table && Object.keys(C.propById(pid2).votes).length === 4, 'at 3x the scripted members vote at once; the agents have until the timeout');
let g2 = S.gameMin; while (C.propById(pid2).status === 'open' && S.gameMin - g2 < 200) step(1 / 60);
PP = C.propById(pid2);
ok(PP.status === 'failed' && /time ran out/.test(PP.result), `a silent agent never holds a vote open: ${PP.result}`);
pr = act(RA, 'propose', {kind: 'other', details: 'Buy rope in town'});
const pid3 = Number(String(pr.proposal).match(/#(\d+)/)[1]);
const v = act(RB, 'vote', {proposal_id: pid3, vote: 'no', reason: 'We have rope.'});
PP = C.propById(pid3);
ok(v.ok && PP.status !== 'open' && /everyone voted/.test(PP.result), `all votes in settles it at once: ${PP.result}`);
ok(!act(rest[0].player ? rest[0] : RB, 'vote', {proposal_id: pid3, vote: 'yes'}).ok, 'a settled proposal takes no more votes');
ok(act(RA, 'party_say', {text: 'Rope it is, then.'}).ok && Rrest.every(x => (x.chat || []).some(e => e.party && e.text === 'Rope it is, then.')), 'party_say reaches every member');
ok(act(RB, 'party_read', {n: 5}).lines.some(l => /Rope it is/.test(l)), 'party_read shows it');

// ---- 4. lead_to ----
T.TABLE.mode = 'off'; T.TABLE.speed = 1;
const hall = homeOf(RA);
RM.forEach(x => {x.x = hall.gate.x; x.y = hall.gate.y - 1; x.state = 'town'; x.townStep = 2; x.wait = 0; x.target = null; x.hp = maxHp(x); x.pq = []; delete x.splitUntil});
RA.lvl = 9; for (const p of S.parties.slice()) if (p.fellow) {for (const b of p.mem) b.party = null; S.parties.splice(S.parties.indexOf(p), 1)}
run(1);
const FP = F_.fellowParty();
ok(FP && FP.leader === RA, `the Fellowship musters with ${RA.name} leading (${FP && FP.mem.length} in the party)`);
ok(!act(RB, 'lead_to', {target: 'Mirefen'}).ok, 'only the leader may lead');
const ld = act(RA, 'lead_to', {target: 'Mirefen'});
ok(ld.ok, `lead_to: ${ld.leading || ld.error}`);
// followers fall in behind; a fight or a full bag can still send the party home later, so take the best moment
let near = [], outT = 0;
for (let t = 0; t < 90; t++) {run(1); const nn = RM.filter(x => x !== RA && dist(x, RA) < 8).map(x => x.name); if (dist(RA, hall.gate) > 10 && nn.length > near.length) {near = nn; outT = t + 1}}
ok(dist(RA, hall.gate) > 8, `the leader left ${hall.name} (${dist(RA, hall.gate).toFixed(1)} tiles out)`);
ok(near.length >= 3 && near.includes(RB.name), `the party follows, the silent agent too: ${near.join(', ')} within 8 tiles after ${outT} s`);
const bond0 = (RA.bonds || {})[RB.id] || 0;
const lp = act(RB, 'leave_party');
ok(lp.ok && RB.splitUntil && !RB.party, 'leave_party splits a member off (for a while)');
ok(((RA.bonds || {})[RB.id] || 0) === Math.max(-10, bond0 - C.COUNCIL.BOND_COST), `splitting off costs bonds (${bond0} -> ${(RA.bonds || {})[RB.id]})`);
act(RB, 'join_party', {hero_id: RA.id});

// ---- 5. the Crypt: all together or not at all ----
T.TABLE.mode = 'auto'; T.TABLE.speed = 3;
const reset = () => {if (CRYPT.group) for (const a of CRYPT.group.mem) {a.state = 'hunt'; a.hidden = false} CRYPT.group = null; CRYPT.cd = 0};
// everyone of the faction safe in town (in the Crypt pool, and nothing attacks them there)
const field = () => {for (const a of S.agents) if (a.fac === 0 && a.state !== 'dead') {const c = homeOf(a); a.lvl = a.fellow ? 8 : 6; a.state = 'town'; a.townStep = 2; a.wait = 9; a.x = c.gate.x; a.y = c.gate.y - 1; a.target = null; a.pq = []; a.hidden = false; a.raid = false; a.hp = maxHp(a)}};
F_.setMinds('relay');
ok(RM.every(x => !x.player), 'Minds back to relay: every member scripted again');
field(); const others = S.agents.filter(a => a.fac === 0 && !a.fellow && a.state !== 'dead').slice(0, 2); for (const a of others) a.lvl = 8;
let formed = null; for (let k = 0; k < 400 && !formed; k++) {reset(); field(); for (const a of others) a.lvl = 8; S.dmLogSeq = S.dmLogSeq; step(1 / 60); const g = CRYPT.group; if (g && g.fac === 0) formed = g.mem.slice();}
ok(formed && F_.fellows().every(a => formed.includes(a)), `a Crypt call drafts the whole Fellowship together (${formed && formed.map(a => a.name + (a.fellow ? '*' : '')).join(', ')})`);
reset(); field(); for (const a of others) a.lvl = 8; RM[4].lvl = 6; // one member cannot go
let split = false; for (let k = 0; k < 400; k++) {reset(); field(); for (const a of others) a.lvl = 8; RM[4].lvl = 6; step(1 / 60); const g = CRYPT.group; if (g && g.mem.some(a => a.fellow)) {split = true; break}}
ok(!split, 'with one member unable to go, none of them is drafted');
ok(S.fellowship.log.some(e => e.kind === 'council' && /not all of/.test(e.parts.map(p => typeof p === 'string' ? p : '').join(''))), 'the log says they stayed together');
// an agent party is asked, not drafted
F_.setMinds('agent'); reset(); field(); for (const a of others) a.lvl = 8; S.fellowship.cool = {};
let prop = null; for (let k = 0; k < 400 && !prop; k++) {reset(); field(); for (const a of others) a.lvl = 8; step(1 / 60); prop = C.openProps().find(q => q.kind === 'crypt'); if (CRYPT.group && CRYPT.group.mem.some(a => a.fellow)) break}
ok(prop && !(CRYPT.group && CRYPT.group.mem.some(a => a.fellow)), `an agent-played Fellowship gets a proposal instead of a draft: "${prop && prop.details}"`);
reset(); field();
for (const a of F_.fellows()) if (!prop.votes[a.id]) act(a, 'vote', {proposal_id: prop.id, vote: 'yes', reason: 'Together.'});
ok(prop.status === 'passed' && CRYPT.group && F_.fellows().every(a => CRYPT.group.mem.includes(a) && a.cryptOk), `they vote yes and set out together (${prop.result})`);
step(1 / 60); step(1 / 60);
ok(F_.fellows().every(a => a.state === 'dungeon'), 'agent members stay in the Crypt group (not turned down as an unasked draft)');

// ---- 6. determinism without a Fellowship ----
const me = fileURLToPath(import.meta.url), h1 = spawnSync(process.execPath, [me, '--hash'], {encoding: 'utf8'}).stdout.trim(), h2 = spawnSync(process.execPath, [me, '--hash'], {encoding: 'utf8'}).stdout.trim();
ok(/^HASH -?\d+ table:0 fellowship:0$/.test(h1) && h1 === h2, `no Fellowship: two seeded 3-minute runs are identical (${h1})`);

console.log(fail ? `\n${fail} check(s) FAILED\n` : '\nAll table checks passed.\n');
process.exit(fail ? 1 : 0);
