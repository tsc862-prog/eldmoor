// Fellowship phase B check (issue #68): Table mode, the council and the party as one unit, with
// mock agents (no model, no network). Five members, all agent-played (#148): one whose runner answers,
// one whose runner is connected but silent, three with no runner (mock link states, sim/runlink.js).
//   - a rescue scene at 1x pauses the world and waits for the silent but connected agent (nudged, no
//     reflex) until it answers; reflex only for members with no runner; a runner gone holds the table
//     until the owner resumes; a live agent that never answers falls to reflex after TABLE.liveMs;
//     a save taken mid-scene resumes the scene
//   - at 3x a scene with agents to decide holds and asks the host for 1x (TABLE.drop); a host that never
//     drops resolves it after TABLE.dropS; a reflex-only table resolves at once
//   - proposals: a decision scene that waits for the silent agent's vote; outside a scene the vote holds
//     past PROP_MIN for a live agent (HOLD_MIN, with notices) and for an absent runner until the owner
//     resumes; all votes in; at 3x a proposal drops to 1x and becomes a scene
//   - lead_to: the leader leads, the party follows (the silent agent too)
//   - the Crypt: the Fellowship is drafted all together or not at all; an agent party is asked
//     first (a proposal) and goes together when it votes yes
//   - staged scenes (issue #132, a child with a fresh world): the DM agent stages each kind (elite,
//     ambush, meeting, trap, mystery, social); the cast meets the party and a paused scene opens;
//     a mock DM answers every at-the-table call; a silent DM is filled by the scripted DM after
//     its budget (then at once); no runner = no wait; 3x resolves at once; a save mid-scene; expiry
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
const {CRYPT, ZONES, zoneFor, zonePoint, dist} = await import('../src/world/map.js');
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

// ---- staged scenes (issue #132), in a child with a fresh world: node scripts/tablecheck.mjs --staged ----
if (process.argv[2] === '--staged') {
  const {dmAct, setDmSeat} = SIM;
  const ST = await import('../src/sim/staged.js');
  init({fellowship: false}); run(30);
  for (const a of S.agents) if (a.fac === 0) {a.lvl = 8; a.hp = maxHp(a)}
  F_.found(F_.autoPick(0), {fac: 0, ai: false}); setDmSeat(true);
  const M = F_.fellowshipMembers().map(m => m.hero), A = M[0];
  // #148: every member is agent-played; with no runner link they all play by reflex (A's answers come from play() below).
  // A camp (the world's, not the DM's) may fall in a scene's window: its DM-log lines are not the DM's to tag.
  const home = homeOf(A).gate, zone = zoneFor(8, home), spot = zonePoint(zone, null, home);
  const place = () => M.forEach((x, i) => {x.x = spot.x + (i % 3) * .6; x.y = spot.y + Math.floor(i / 3) * .6; x.state = 'hunt'; x.hidden = false; x.target = null; x.dest = null; x.hp = maxHp(x); x.pq = []});
  const fresh = () => {place(); if (S.staged) S.staged.day.n = 0; if (S.levers) {S.levers.cd = {}; S.levers.day = {d: -1, n: {}, rz: {}}} // the people lever's own limits are not under test here
    for (const m of S.mobs) if (!m.staged && dist(m, spot) < 16) {m.alive = false; m.gone = true}};
  const tag = e => e.detail && (e.detail.by === 'dm-agent' || e.detail.by === 'scripted');
  // mock DM: 'answer' answers every call at once, 'silent' polls but never answers, 'away' never polls
  const play = (mode, maxS = 120) => {let f = 0, opened = null, maxPause = 0;
    while (f < 60 * maxS) {const g = S.gameMin; step(1 / 60); f++;
      if (S.table && S.table.ctx.staged != null) {opened = opened || S.table; if (S.table.pause && S.table.phase !== 'frame' && S.gameMin !== g) maxPause = 1;
        if (mode !== 'away') {const t = dmAct('table_call'); if (mode === 'answer' && t.call) {const c = t.call; dmAct('table_answer', {call: c.id, text: 'DM line ' + c.id + ': the ' + c.kind + ' lands hard.', ...(c.legal ? {pick: c.legal[c.legal.length - 1]} : {})})}}
        if (A.player && !S.table.acts[A.id] && S.table.phase === 'turn') {const st = act(A, 'status'); const o = st.table && st.table.options; if (o && o.length) act(A, 'scene_act', {option: o[0].split(' = ')[0], line: 'On my word.'})}}
      if (!S.table && S.staged.cur.phase === 'done') break}
    return {opened, secs: f / 60, maxPause}};
  console.log('staged scenes (issue #132)');
  T.TABLE.speed = 1; T.TABLE.mode = 'auto';
  const CAST = {meeting: {role: 'drover', name: 'Hesk', want: 'find my lost ox before the frost', voice: 'slow and worried', choices: {help: 'Promise Hesk to find the ox'}},
    social: {role: 'sellsword', want: 'a toll for the ford', attitude: 'wary', reveal: 'The toll goes to the Rookscar crew.'}, trap: {trap: 'spikes'},
    mystery: {place: 'shrine', reveal: 'The shrine remembers a drowned king.'}, elite: {name: 'Old Greyjaw', title: 'the Hungry', choices: {strike: 'Go for the throat'}}, ambush: {}};
  for (const kind of ST.STAGE_KINDS) {
    fresh(); const log0 = S.dmLogSeq, hp0 = M.map(x => x.hp);
    const r = dmAct('stage_scene', {kind, near: 'fellowship', frame: 'The road narrows between thorn banks, and something waits for them.', cast: CAST[kind], reason: 'tablecheck ' + kind});
    ok(r.ok && r.staged, `stage_scene ${kind}: ${r.title || r.error} ${r.where || ''}${r.level ? ' (level ' + r.level + ', party ' + r.party_level + ')' : ''}`);
    if (!r.ok) continue;
    const {opened: sc, secs, maxPause} = play('answer');
    ok(sc && sc.kind === kind && sc.ctx.staged === r.staged && sc.pause, `the cast met the party and a ${kind} scene opened at the table (${secs.toFixed(1)} s), world paused`);
    if (!sc) continue;
    ok(!maxPause, 'the world clock stood still through the scene');
    ok((A.chat || []).some(e => e.from.kind === 'dm' && /thorn banks/.test(e.text)), 'the frame reached the members as narration');
    const calls = sc.calls || [];
    ok(calls.length >= sc.ids.length + 2 && calls.every(c => c.done) && calls.filter(c => c.by === 'dm-agent').length === calls.length, `${calls.length} DM calls (voice, an outcome per member, one complication), all answered by the mock DM`);
    const comp = calls.find(c => c.kind === 'complication');
    ok(comp && ST.COMPLICATIONS[kind].includes(comp.pick), `the complication is one of the legal set: ${comp && comp.pick}`);
    ok(sc.beats.length === sc.ids.length || ['elite', 'ambush'].includes(kind), `every member acted (${sc.beats.map(b => b.name + '=' + b.k + '(' + b.by + ')').join(', ')})`);
    if (CAST[kind].choices) ok(sc.beats.some(b => Object.values(CAST[kind].choices).includes(b.text)), 'the DM\'s own label for a legal action shows at the table');
    if (kind === 'meeting' || kind === 'social') ok((A.chat || []).some(e => e.from.kind === 'npc' && /^DM line/.test(e.text)), 'the voice call is said by the person, in the game');
    if (kind === 'meeting') {const hr = sc.beats.filter(b => b.k === 'hear');
      ok(hr.every(b => /^(understood |listened, but missed what )/.test(b.res || '')) && S.dmLog.filter(e => e.id > log0 && e.kind === 'roll' && e.detail.act === 'hear').every(e => e.detail.skill === 'empathy'),
        `hearing someone out is an Empathy check worded as what they caught or missed (${hr.map(b => b.name + ': ' + b.res).join('; ') || 'nobody chose to hear'})`);
      ok(!/\b(success|failure)\b/.test(sc.summary || '') && (/understood|listened but missed|their word|watches them/.test(sc.summary || '')), 'the meeting\'s summary reads plainly: ' + sc.summary)}
    const mine = S.dmLog.filter(e => e.id > log0);
    ok(mine.some(e => e.kind === 'frame' && tag(e)) && mine.some(e => e.kind === 'payoff' && tag(e)) && mine.every(e => tag(e) || e.kind === 'lever' || e.kind === 'camp'), `DM log: ${mine.length} entries, every one tagged (${[...new Set(mine.map(e => e.kind))].join(', ')})`);
    if (!['elite', 'ambush'].includes(kind)) ok(mine.some(e => e.kind === 'roll' && e.detail.d20 >= 1 && e.detail.dc), 'the dice decide: d20 rolls against a DC are logged');
    ok(M.every(x => x.state !== 'dead') && (kind !== 'trap' || M.every((x, i) => x.hp >= Math.min(hp0[i], Math.ceil(maxHp(x) * ST.STAGE.TRAP_FLOOR)))), 'nobody died; a trap never takes anyone below ' + ST.STAGE.TRAP_FLOOR * 100 + '% HP');
    ok(S.staged.cur.phase === 'done' && S.staged.cur.result, `the staged scene ends: ${S.staged.cur.result}`);
    for (const id of S.staged.cur.cast.mobs) {const m = S.mobs.find(x => x.id === id); if (m && m.alive) {m.alive = false; m.gone = true}}
    run(1);
  }
  // a silent DM (polls, never answers): each call waits its budget, then the scripted DM; after MISS_MAX misses, at once
  fresh(); T.TABLE.dmMs = 1500;
  let r = dmAct('stage_scene', {kind: 'mystery', near: A.name, frame: 'A ring of old stones stands in the bracken, humming faintly.', cast: {}, reason: 'silent DM'});
  let p = play('silent');
  let calls = p.opened ? p.opened.calls : [];
  ok(r.ok && p.opened && calls.length && calls.every(c => c.done && c.by === 'scripted'), `a silent DM: every call filled by the scripted DM (${calls.length})`);
  ok(p.opened && p.opened.dmMiss === ST.STAGE.MISS_MAX, `it waited for ${ST.STAGE.MISS_MAX} calls, then stopped waiting`);
  ok(p.secs <= T.TABLE.frameS + T.TABLE.outcomeS + ST.STAGE.MISS_MAX * T.TABLE.dmMs / 1000 + T.TABLE.turnMs / 1000 + 25, `the scene still ended (${p.secs.toFixed(1)} s, walk included)`);
  // nobody listening at all: no wait
  fresh(); const poll0 = ST.STAGE.POLL_MS; ST.STAGE.POLL_MS = 0; // as if the last poll were long ago
  r = dmAct('stage_scene', {kind: 'social', near: A.name, frame: 'A toll-keeper leans on a pike across the track.', cast: {role: 'sellsword', want: 'two silver for the ford'}, reason: 'no runner'});
  const t0 = Date.now(); p = play('away');
  ok(r.ok && p.opened && p.opened.calls.every(c => c.by === 'scripted') && !p.opened.dmMiss && p.secs < 30, `no runner listening: the scripted DM fills at once (scene over after ${p.secs.toFixed(1)} s game-step time)`);
  ST.STAGE.POLL_MS = poll0;
  T.TABLE.dmMs = 6000;
  // late and illegal answers
  ok(dmAct('table_answer', {call: 1, text: 'x'}).ok === false, 'an answer with no staged scene at the table is refused');
  // at 3x: no pause, everything resolved at once, scripted
  fresh(); T.TABLE.speed = 3;
  r = dmAct('stage_scene', {kind: 'trap', near: A.name, frame: 'Fresh earth across the path, raked too smooth.', cast: {trap: 'gas'}, reason: 'fast'});
  p = play('answer'); const pay = S.dmLog.find(e => e.kind === 'payoff' && e.detail.staged === r.staged);
  ok(r.ok && !p.opened && pay && pay.detail.calls.length && pay.detail.calls.every(c => c.by === 'scripted'), 'at 3x the staged scene resolves in one step (never paused) with the scripted DM in every slot');
  T.TABLE.speed = 1;
  // a save mid-scene, with a pending call
  fresh();
  r = dmAct('stage_scene', {kind: 'meeting', near: A.name, frame: 'A pilgrim sits by a cairn, mending a sandal.', cast: {role: 'hermit', want: 'company as far as the ford'}, reason: 'save'});
  let f = 0; while (f++ < 60 * 60 && !(S.table && S.table.calls && S.table.calls.some(c => !c.done))) {step(1 / 60); dmAct('table_call')}
  const pend = S.table && S.table.calls.find(c => !c.done);
  ok(!!pend, `a call is waiting (${pend && pend.kind})`);
  const snap = JSON.parse(JSON.stringify(snapshot())); restore(snap);
  ok(S.table && S.table.ctx.staged === r.staged && S.staged.cur.phase === 'open', 'a save mid-scene restores the staged scene and its calls');
  const bad = dmAct('table_answer', {call: 999, text: 'x'}), c1 = dmAct('table_call').call;
  ok(bad.ok === false && c1 && dmAct('table_answer', {call: c1.id, text: 'The pilgrim looks up and smiles.'}).ok && dmAct('table_answer', {call: c1.id, text: 'again'}).ok === false, 'unknown and repeated answers are refused; the pending one is taken');
  p = play('away');
  ok(!S.table && S.staged.cur.phase === 'done', 'the restored scene runs to its end');
  // expiry: a cast that never meets the party gives up
  fresh(); const far = M.map(x => ({x: x.x, y: x.y}));
  r = dmAct('stage_scene', {kind: 'ambush', near: Math.round(spot.x + 12) + ',' + Math.round(spot.y), frame: 'Something watches the road from the hedges.', cast: {}, reason: 'never met'});
  if (!r.ok) r = dmAct('stage_scene', {kind: 'mystery', near: ZONES[zone], frame: 'Something watches the road from the hedges.', cast: {}, reason: 'never met'});
  for (const x of M) {const c = homeOf(x); x.state = 'town'; x.townStep = 2; x.wait = 9e9; x.x = c.gate.x; x.y = c.gate.y - 1}
  T.TABLE.speed = 8; const g0 = S.gameMin; while (S.gameMin - g0 < ST.STAGE.WAIT_MIN + 30) step(1 / 60);
  ok(r.ok && S.staged.cur.phase === 'done' && S.staged.cur.result === 'expired' && S.dmLog.some(e => e.kind === 'abandon' && tag(e)), `a cast nobody meets gives up after ${ST.STAGE.WAIT_MIN / 60} game hours (logged)`);
  ok(S.staged.cur.cast.mobs.every(id => {const m = S.mobs.find(x => x.id === id); return !m || m.gone}), 'and its foes leave the map');
  console.log('STAGED ' + (fail ? 'FAIL ' + fail : 'OK'));
  process.exit(fail ? 1 : 0);
}

console.log('\nEldmoor tablecheck: Table mode, the council and the party as one unit (mock agents)\n');
init({fellowship: false}); run(60); // the old start (#111): this check founds its own Fellowship
for (const a of S.agents) if (a.fac === 0) {a.lvl = 8; a.hp = maxHp(a)}
const r0 = F_.found(F_.autoPick(0), {fac: 0, ai: false});
ok(r0.ok && F_.fellows().length === 5, `founded ${S.fellowship && S.fellowship.name} with ${F_.fellows().length} members`);
const M = F_.fellowshipMembers().map(m => m.hero);
const [A, B, ...rest] = M; // A answers, B is silent but its runner holds it; the rest have no runner (#148)
// #148: the Fellowship is always agent-played; whether a decision waits is the runner's link (the relay's claims).
const LINK = {}, link = (x, k) => {LINK[x.id] = k}; SIM.setRunnerLinks(x => LINK[x.id] || 'none');
const unasked = new Set(); SIM.setReflexAck(x => !unasked.has(x.id)); // the page's alert: not answered yet for these (else Resume)
link(A, 'connected'); link(B, 'waiting');
ok(M.every(x => x.player && x.fellowAgent) && S.fellowship.minds === 'agent', 'every member is agent-played from founding (#148)');
ok(!F_.setMinds('off') && !F_.setMinds('relay') && !P.markPlayer(rest[0], false) && rest[0].player, 'no scripted or relay mode: setMinds refuses them, a member cannot be unmarked');
ok(SIM.agentLive(A) && SIM.agentLive(B) && rest.every(x => !SIM.agentLive(x) && SIM.reflexMay(x)), `links: ${A.name} connected (answers), ${B.name} waiting (silent); ${rest.map(x => x.name).join(', ')} no runner`);

// Put the whole party in the field around a monster.
const zone = zoneFor(8, homeOf(A).gate), spot = zonePoint(zone, null, homeOf(A).gate);
const place = () => {M.forEach((x, i) => {x.x = spot.x + (i % 3) * .6; x.y = spot.y + Math.floor(i / 3) * .6; x.state = 'hunt'; x.hidden = false; x.target = null; x.dest = null; x.hp = maxHp(x); x.pq = []})};
const mobNear = () => {const m = S.mobs.filter(m => m.alive && !m.gone && !m.elite).sort((p, q) => dist(p, spot) - dist(q, spot))[0]; m.x = spot.x + 1; m.y = spot.y; m.hp = m.maxhp; return m};
const startFight = (x, m) => {x.state = 'fight'; x.target = m; m.target = x; x.hp = maxHp(x) * .24; m.maxhp *= 20; m.hp = m.maxhp; m.cd = 99}; // a tough foe that holds its blow, so no one dies or flees mid-test
const stepUntil = (cond, maxS) => {let f = 0, moved = 0; while (!cond() && f < 60 * maxS) {const g = S.gameMin; step(1 / 60); f++; if (S.table && S.gameMin !== g) moved = 1} return {secs: f / 60, moved}};

// ---- 1. a rescue scene at 1x: the table waits for a silent but connected agent ----
T.TABLE.speed = 1; T.TABLE.turnMs = 7000; T.TABLE.mode = 'auto';
place(); let m = mobNear(); const victim = rest[0]; startFight(victim, m);
T.tableTick(); // the trigger rules (step() runs them after the heroes move)
let sc = S.table;
ok(sc && sc.kind === 'rescue' && sc.pause, `a member at ${Math.round(victim.hp / maxHp(victim) * 100)}% opens a rescue scene (${sc && sc.title}), world paused`);
ok(sc && sc.ids.length === 5 && sc.ids.every((id, i) => i === 0 || score(S.agents.find(x => x.id === sc.ids[i - 1]), 'reflex') >= score(S.agents.find(x => x.id === id), 'reflex')), 'initiative order follows Reflex (with gear)');
const evA = (A.playEv || []).slice(-3).map(e => e.text).join(' | ');
ok(/TABLE \(rescue\)/.test(evA) && (A.playEv || []).some(e => e.w === 3), 'the agent gets a must-answer table event with its options');
let st = act(A, 'status');
ok(st.ok && st.table && st.table.options && st.table.options.length >= 2, `status shows the table: ${st.table && st.table.options.join('; ')}`);
let w = act(A, 'scene_act', {option: 'strike', line: 'Hold on, I am coming!'});
ok(w.ok && w.chose === 'strike', 'the answering agent locks in strike before its turn');
ok(!act(A, 'scene_act', {option: 'retreat'}).ok, 'a second act in the same scene is refused');
ok(!act(B, 'scene_act', {option: 'dance'}).ok, 'an option the scene does not offer is refused');
const g0 = S.gameMin;
let p1 = stepUntil(() => !S.table, 30);
ok(S.table && S.table.phase === 'turn' && S.table.ids[S.table.i] === B.id && p1.moved === 0, `30 s on, the table still waits for ${B.name}'s silent but connected agent (no reflex, the world clock still)`);
ok((B.playEv || []).some(e => /Still your turn/.test(e.text) && e.w === 3), 'the waiting agent was nudged again (must-answer)');
ok(/is thinking/.test((T.bannerOf() || {}).line || ''), `the banner: ${(T.bannerOf() || {}).line}`);
ok(act(B, 'scene_act', {option: st.table.options.map(o => o.split(' = ')[0]).includes('heal') ? 'heal' : 'strike', line: 'Sorry, I am here.'}).ok, 'the slow agent answers at last');
p1 = stepUntil(() => !S.table, 20);
ok(!S.table && p1.moved === 0, `then the scene resolves (${p1.secs.toFixed(1)} s more), the world clock still until then`);
const beats = sc.beats, bA = beats.find(b => b.id === A.id), bB = beats.find(b => b.id === B.id);
ok(bA && bA.by === 'agent' && bA.k === 'strike' && bB && bB.by === 'agent' && rest.every(x => (beats.find(b => b.id === x.id) || {}).by === 'reflex'), `turns: ${beats.map(b => b.name + '=' + b.k + '(' + b.by + ')').join(', ')} (reflex only for members with no runner)`);
ok(S.fellowship.log.some(e => e.kind === 'table'), 'the outcome is in the campaign log');
step(1 / 60); ok(S.gameMin > g0, 'the world runs on after the scene');

// ---- 1a. a runner gone: the table waits for the owner; Resume lets the reflexes act ----
link(B, 'none'); unasked.add(B.id);
place(); m = mobNear(); startFight(rest[1], m); S.fellowship.tableSeen = {}; T.tableTick(); act(A, 'scene_act', {option: 'strike'});
ok(S.table && SIM.ownerHeld(B) && !SIM.reflexMay(B), `${B.name}'s runner is gone and the owner has not answered: held`);
p1 = stepUntil(() => !S.table, 60); const atB = S.table && S.table.ids[S.table.i] === B.id;
ok(S.table && atB && SIM.decisionsWaiting().some(d => d.a === B && /turn at the table/.test(d.what)) && /no runner/.test(T.bannerOf().line), `the table holds at ${B.name}'s turn and names it for the alert: ${T.bannerOf() && T.bannerOf().line}`);
unasked.delete(B.id); p1 = stepUntil(() => !S.table, 20);
ok(!S.table && (S.table === null), `the owner resumes: ${B.name}'s reflexes act and the scene ends (${p1.secs.toFixed(1)} s)`);
link(B, 'waiting');

// ---- 1c. a live agent that never answers: reflex after TABLE.liveMs, with a notice ----
T.TABLE.liveMs = 4000;
place(); m = mobNear(); startFight(rest[1], m); S.fellowship.tableSeen = {}; T.tableTick(); act(A, 'scene_act', {option: 'strike'});
p1 = stepUntil(() => !S.table, 60);
ok(!S.table && p1.secs <= T.TABLE.frameS + T.TABLE.outcomeS + T.TABLE.liveMs / 1000 + 1 && (B.playEv || []).some(e => /table waited/.test(e.text)), `a silent agent's turn falls to reflex after ${T.TABLE.liveMs / 1000} s, with a notice (${p1.secs.toFixed(1)} s)`);
T.TABLE.liveMs = 120000;

// ---- 1b. a save mid-scene ----
place(); m = mobNear(); startFight(rest[1], m); S.fellowship.tableSeen = {}; T.tableTick();
ok(S.table && S.table.pause, 'a second rescue scene opens');
act(A, 'scene_act', {option: 'strike'}); act(B, 'scene_act', {option: 'strike'});
const snap = JSON.parse(JSON.stringify(snapshot())); restore(snap);
ok(S.table && S.table.kind === 'rescue', 'a save taken mid-scene restores the scene');
p1 = stepUntil(() => !S.table, 40);
ok(!S.table, `the restored scene resolves (${p1.secs.toFixed(1)} s)`);
const RA = S.agents.find(x => x.id === A.id), RB = S.agents.find(x => x.id === B.id), Rrest = rest.map(x => S.agents.find(y => y.id === x.id)), RM = [RA, RB, ...Rrest];

// ---- 2. at 3x: a Fellowship decision drops the world to 1x; reflex-only tables still resolve at once ----
T.TABLE.speed = 3;
const field3 = () => RM.forEach((x, i) => {x.x = spot.x + (i % 3) * .6; x.y = spot.y; x.state = 'hunt'; x.hidden = false; x.target = null; x.hp = maxHp(x); x.pq = []});
field3(); m = S.mobs.filter(q => q.alive && !q.gone && !q.elite)[3]; m.x = spot.x + 1; m.y = spot.y; startFight(Rrest[2], m);
T.TABLE.drop = null; S.fellowship.tableSeen = {}; T.tableTick(); let g1 = S.gameMin; step(1 / 60);
ok(S.table && S.table.pause && T.TABLE.drop && S.gameMin === g1, `at 3x with agents to decide, the scene holds and asks the host for 1x (${T.TABLE.drop && T.TABLE.drop.reason})`);
T.TABLE.speed = 1; T.TABLE.drop = null; act(RA, 'scene_act', {option: 'strike'}); act(RB, 'scene_act', {option: 'strike'}); // the host drops to 1x; the agents answer
p1 = stepUntil(() => !S.table, 30);
ok(!S.table && S.table === null && S.fellowship.log.some(e => e.kind === 'table'), `at 1x the agents' scene runs as usual (${p1.secs.toFixed(1)} s)`);
T.TABLE.speed = 3; field3(); m = S.mobs.filter(q => q.alive && !q.gone && !q.elite)[4]; m.x = spot.x + 1; m.y = spot.y; startFight(Rrest[2], m);
S.fellowship.tableSeen = {}; T.tableTick(); p1 = stepUntil(() => !S.table, 30);
ok(!S.table && p1.secs <= T.TABLE.dropS + .2, `a host that never drops: the scene resolves after ${T.TABLE.dropS} world seconds anyway (${p1.secs.toFixed(1)} s, never hangs)`);
link(RA, 'none'); link(RB, 'none');
field3(); m = S.mobs.filter(q => q.alive && !q.gone && !q.elite)[5]; m.x = spot.x + 1; m.y = spot.y; startFight(Rrest[2], m);
const n0 = S.fellowship.log.filter(e => e.kind === 'table').length; g1 = S.gameMin; T.TABLE.drop = null;
S.fellowship.tableSeen = {}; T.tableTick(); step(1 / 60);
ok(!S.table && !T.TABLE.drop && S.fellowship.log.filter(e => e.kind === 'table').length === n0 + 1 && S.gameMin > g1, 'at 3x with no runner anywhere (reflexes only) the scene resolves in the same step, the clock running');
link(RA, 'connected'); link(RB, 'waiting');

// ---- 3. proposals (in town, where nothing attacks) ----
T.TABLE.speed = 1;
const toTown = () => RM.forEach(x => {const c = homeOf(x); x.state = 'town'; x.townStep = 2; x.wait = 9; x.x = c.gate.x; x.y = c.gate.y - 1; x.target = null; x.pq = []; x.hp = maxHp(x)});
toTown();
let pr = act(RA, 'propose', {kind: 'other', details: 'Camp by the water tonight'});
ok(pr.ok && S.table && S.table.kind === 'decision', `a proposal at 1x becomes a decision scene (${pr.proposal})`);
const pid = Number(String(pr.proposal).match(/#(\d+)/)[1]);
p1 = stepUntil(() => !S.table, 20);
ok(S.table && C.propById(pid).status === 'open', 'the decision scene waits for the silent agent\'s vote');
ok(act(RB, 'vote', {proposal_id: pid, vote: 'no', reason: 'The water is cold.'}).ok, 'it votes with the vote tool, at its own pace');
p1 = stepUntil(() => !S.table, 20);
let PP = C.propById(pid);
ok(PP && PP.status !== 'open' && Object.keys(PP.votes).length === 5 && PP.votes[RB.id].by === 'agent' && PP.votes[RB.id].v === 'no' && PP.votes[RA.id].by === 'agent' && Rrest.every(x => PP.votes[x.id].by === 'reflex'), `the table voted (${PP && PP.result}); reflex only for members with no runner`);
ok(S.fellowship.log.some(e => e.kind === 'council' && /settles it/.test(e.parts.map(p => typeof p === 'string' ? p : '').join(''))), 'the leader settles it in the campaign log');
// outside a scene (Watch mode): the vote holds past PROP_MIN for a live agent while the world runs on
T.TABLE.mode = 'off';
pr = act(RA, 'propose', {kind: 'split', details: 'Each of us hunts alone until dusk'});
const pid2 = Number(String(pr.proposal).match(/#(\d+)/)[1]);
ok(pr.ok && !S.table && Object.keys(C.propById(pid2).votes).length === 4 && !C.propById(pid2).votes[RB.id], 'outside a scene the members with no runner vote at once by reflex; the agent\'s vote is waited for');
ok((RB.playEv || []).some(e => /waits for your vote/.test(e.text) && e.w === 3), 'the waiting agent is nudged at once (a must-answer event for its pacing)');
let g2 = S.gameMin; while (C.propById(pid2).status === 'open' && S.gameMin - g2 < C.COUNCIL.PROP_MIN + 60) step(1 / 60);
ok(C.propById(pid2).status === 'open' && S.gameMin - g2 >= C.COUNCIL.PROP_MIN + 59 && (RB.playEv || []).some(e => /still waits for you/.test(e.text)), `past PROP_MIN the vote still waits for a live agent, with a notice (the world ran on ${Math.round(S.gameMin - g2)} game minutes)`);
while (C.propById(pid2).status === 'open' && S.gameMin - g2 < C.COUNCIL.PROP_MIN + C.COUNCIL.HOLD_MIN + 30) step(1 / 60);
PP = C.propById(pid2);
ok(PP.status !== 'open' && /waited for/.test(PP.result) && PP.votes[RB.id].by === 'reflex', `after HOLD_MIN more it settles by reflex: ${PP.result}`);
link(RB, 'none'); unasked.add(RB.id);
pr = act(RA, 'propose', {kind: 'other', details: 'Buy rope in town'});
const pid3 = Number(String(pr.proposal).match(/#(\d+)/)[1]);
g2 = S.gameMin; while (S.gameMin - g2 < C.COUNCIL.PROP_MIN + C.COUNCIL.HOLD_MIN + 30) step(1 / 60);
ok(C.propById(pid3).status === 'open' && SIM.decisionsWaiting().some(d => d.a === RB && /vote/.test(d.what)), 'a runner gone and the owner not asked: the vote holds (and names the member for the alert)');
unasked.delete(RB.id); step(1 / 60); PP = C.propById(pid3);
ok(PP.status !== 'open' && PP.votes[RB.id].by === 'reflex', `the owner resumes: its reflexes vote at once (${PP.result})`);
link(RB, 'waiting');
pr = act(RA, 'propose', {kind: 'other', details: 'Mend the nets'});
const pid4 = Number(String(pr.proposal).match(/#(\d+)/)[1]);
const v = act(RB, 'vote', {proposal_id: pid4, vote: 'no', reason: 'We have rope.'});
PP = C.propById(pid4);
ok(v.ok && PP.status !== 'open' && /everyone voted/.test(PP.result), `all votes in settles it at once: ${PP.result}`);
ok(!act(RB, 'vote', {proposal_id: pid4, vote: 'yes'}).ok, 'a settled proposal takes no more votes');
ok(act(RA, 'party_say', {text: 'Rope it is, then.'}).ok && Rrest.every(x => (x.chat || []).some(e => e.party && e.text === 'Rope it is, then.')), 'party_say reaches every member');
ok(act(RB, 'party_read', {n: 5}).lines.some(l => /Rope it is/.test(l)), 'party_read shows it');
// at 3x with Table on, a proposal drops the world to 1x and becomes a decision scene
T.TABLE.mode = 'auto'; T.TABLE.speed = 3; T.TABLE.drop = null;
pr = act(RA, 'propose', {kind: 'other', details: 'Sing on the road'});
ok(pr.ok && S.table && S.table.kind === 'decision' && S.table.pause && T.TABLE.drop, 'at 3x a proposal asks the host for 1x and opens a decision scene (never auto-resolved)');
{const pid5 = Number(String(pr.proposal).match(/#(\d+)/)[1]); T.TABLE.speed = 1; T.TABLE.drop = null; act(RB, 'vote', {proposal_id: pid5, vote: 'yes'});
 stepUntil(() => C.propById(pid5).status !== 'open', 20); PP = C.propById(pid5);
 ok(PP.status !== 'open' && PP.votes[RB.id].by === 'agent', `and resolves once the agents have voted (${PP.result})`);
 for (let k = 0; k < 600 && S.table; k++) {for (const x of [RA, RB]) if (S.table && !S.table.acts[x.id] && S.table.ids.includes(x.id)) {const o = act(x, 'status').table; if (o && o.options) act(x, 'scene_act', {option: o.options[0].split(' = ')[0]})} step(1 / 60)}} // let any scene that followed end

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
let near = [], outT = 0, farD = 0; // the leader may reach Mirefen and turn home later: judge by the farthest point
for (let t = 0; t < 90; t++) {run(1); farD = Math.max(farD, dist(RA, hall.gate)); const nn = RM.filter(x => x !== RA && dist(x, RA) < 8).map(x => x.name); if (dist(RA, hall.gate) > 10 && nn.length > near.length) {near = nn; outT = t + 1}}
ok(farD > 8, `the leader left ${hall.name} (${farD.toFixed(1)} tiles out at most)`);
ok(near.length >= 3 && near.includes(RB.name), `the party follows, the silent agent too: ${near.join(', ')} within 8 tiles after ${outT} s`);
const bond0 = (RA.bonds || {})[RB.id] || 0;
const lp = act(RB, 'leave_party');
ok(lp.ok && RB.splitUntil && !RB.party, 'leave_party splits a member off (for a while)');
ok(((RA.bonds || {})[RB.id] || 0) === Math.max(-10, bond0 - C.COUNCIL.BOND_COST), `splitting off costs bonds (${bond0} -> ${(RA.bonds || {})[RB.id]})`);
act(RB, 'join_party', {hero_id: RA.id});

// ---- 5. the Crypt: all together or not at all ----
T.TABLE.mode = 'off'; T.TABLE.speed = 1; // outside Table mode: the Crypt call is a proposal the agents answer with vote
const reset = () => {if (CRYPT.group) for (const a of CRYPT.group.mem) {a.state = 'hunt'; a.hidden = false} CRYPT.group = null; CRYPT.cd = 0};
// everyone of the faction safe in town (in the Crypt pool, and nothing attacks them there)
const field = () => {for (const a of S.agents) if (a.fac === 0 && a.state !== 'dead') {const c = homeOf(a); a.lvl = a.fellow ? 8 : 6; a.state = 'town'; a.townStep = 2; a.wait = 9; a.x = c.gate.x; a.y = c.gate.y - 1; a.target = null; a.pq = []; a.hidden = false; a.raid = false; a.hp = maxHp(a)}};
for (const x of RM) link(x, 'none');
ok(RM.every(x => x.player && SIM.reflexMay(x)), 'no runner holds any member: their reflexes play them and vote (#148)');
field(); const others = S.agents.filter(a => a.fac === 0 && !a.fellow && a.state !== 'dead').slice(0, 2); for (const a of others) a.lvl = 8;
let formed = null; for (let k = 0; k < 400 && !formed; k++) {reset(); field(); for (const a of others) a.lvl = 8; S.dmLogSeq = S.dmLogSeq; step(1 / 60); const g = CRYPT.group; if (g && g.fac === 0) formed = g.mem.slice();}
ok(formed && F_.fellows().every(a => formed.includes(a)), `a Crypt call drafts the whole Fellowship together (${formed && formed.map(a => a.name + (a.fellow ? '*' : '')).join(', ')})`);
reset(); field(); for (const a of others) a.lvl = 8; RM[4].lvl = 6; // one member cannot go
let split = false; for (let k = 0; k < 400; k++) {reset(); field(); for (const a of others) a.lvl = 8; RM[4].lvl = 6; step(1 / 60); const g = CRYPT.group; if (g && g.mem.some(a => a.fellow)) {split = true; break}}
ok(!split, 'with one member unable to go, none of them is drafted');
ok(S.fellowship.log.some(e => e.kind === 'council' && /not all of/.test(e.parts.map(p => typeof p === 'string' ? p : '').join(''))), 'the log says they stayed together');
// an agent party is asked, not drafted
for (const x of RM) link(x, 'waiting'); reset(); field(); for (const a of others) a.lvl = 8; S.fellowship.cool = {};
let prop = null; for (let k = 0; k < 400 && !prop; k++) {reset(); field(); for (const a of others) a.lvl = 8; step(1 / 60); prop = C.openProps().find(q => q.kind === 'crypt'); if (CRYPT.group && CRYPT.group.mem.some(a => a.fellow)) break}
ok(prop && !(CRYPT.group && CRYPT.group.mem.some(a => a.fellow)), `an agent-played Fellowship gets a proposal instead of a draft: "${prop && prop.details}"`);
reset(); field();
for (const a of F_.fellows()) if (!prop.votes[a.id]) act(a, 'vote', {proposal_id: prop.id, vote: 'yes', reason: 'Together.'});
ok(prop.status === 'passed' && CRYPT.group && F_.fellows().every(a => CRYPT.group.mem.includes(a) && a.cryptOk), `they vote yes and set out together (${prop.result})`);
step(1 / 60); step(1 / 60);
ok(F_.fellows().every(a => a.state === 'dungeon'), 'agent members stay in the Crypt group (not turned down as an unasked draft)');

// ---- 5c. priority (#135): a gathering group steps aside; a group inside means we go next, the cooldown waived ----
{const D = await import('../src/sim/dungeon.js');
 reset(); field(); for (const x of RM) link(x, 'none'); S.fellowship.cool = {}; S.fellowship.wait = {};
 const bg = S.agents.filter(a => a.fac === 0 && !a.fellow && a.state !== 'dead').slice(0, 4); for (const a of bg) a.lvl = 8;
 const voteCrypt = () => {const q = C.propose(C.leaderOfF(), 'crypt', 'Down we go.', {vote: 'yes'}); for (const a of F_.fellows()) if (q.status === 'open' && !q.votes[a.id]) C.castVote(a, q.id, 'yes', '', 'agent'); return q};
 D.musterCrypt(bg, 0, null, 'Hollow Cleavers'); const before = CRYPT.group;
 const q1 = voteCrypt();
 ok(q1.status === 'passed' && CRYPT.group && CRYPT.group !== before && F_.fellows().every(a => CRYPT.group.mem.includes(a)) && bg.every(a => !CRYPT.group.mem.includes(a) && a.state === 'hunt'), `a gathering group steps aside and the Fellowship takes the Crypt (${q1.result})`);
 reset(); field(); for (const a of bg) a.lvl = 8; S.fellowship.cool = {}; S.fellowship.wait = {};
 D.musterCrypt(bg, 0, null, 'Hollow Cleavers'); CRYPT.group.phase = 'inside'; CRYPT.group.t = 400; for (const a of bg) a.hidden = true;
 const q2 = voteCrypt();
 ok(q2.status === 'passed' && /another group is inside/.test(q2.result) && S.fellowship.wait.crypt > S.gameMin, `a passed vote is not dropped while a group is inside (${q2.result})`);
 CRYPT.cd = 9999; CRYPT.group.t = 0.01; field(); for (const a of bg) {a.state = 'dungeon'; a.hidden = true}
 for (let k = 0; k < 20 && !(CRYPT.group && CRYPT.group.mem.some(a => a.fellow)); k++) {step(1 / 60); field()}
 ok(CRYPT.group && F_.fellows().every(a => CRYPT.group.mem.includes(a)) && !S.fellowship.wait.crypt, 'when they come out the Fellowship goes next, cooldown waived');
 reset(); S.fellowship.wait = {}; CRYPT.cd = 0;
}
// ---- 5b. staged scenes (issue #132): a fresh world in a child ----
{const ch = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--staged'], {encoding: 'utf8', env: {...process.env}});
  process.stdout.write(ch.stdout || ''); if (ch.stderr) process.stderr.write(ch.stderr);
  ok(ch.status === 0 && /STAGED OK/.test(ch.stdout || ''), 'staged scenes: every kind with a mock DM, a silent DM, no runner, 3x, a save mid-scene, expiry')}

// ---- 6. determinism without a Fellowship ----
const me = fileURLToPath(import.meta.url), h1 = spawnSync(process.execPath, [me, '--hash'], {encoding: 'utf8'}).stdout.trim(), h2 = spawnSync(process.execPath, [me, '--hash'], {encoding: 'utf8'}).stdout.trim();
ok(/^HASH -?\d+ table:0 fellowship:0$/.test(h1) && h1 === h2, `no Fellowship: two seeded 3-minute runs are identical (${h1})`);

console.log(fail ? `\n${fail} check(s) FAILED\n` : '\nAll table checks passed.\n');
process.exit(fail ? 1 : 0);
