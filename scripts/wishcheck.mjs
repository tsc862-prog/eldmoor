// wish (#663): the DM and the heroes leave notes for the people who build the game about the tools they wished they had.
//   the tool on both seats (act:false, English only, field limits, 3 a game day per seat), the file logs/behavior/<world>/wishes.jsonl
//   written through the relay (stamped with the seat's model) and through play-headless's path, the save fields (last 20), privacy across
//   seats, --no-behavior (no file, the save still has them), the report's Wishes section (grouping, best example, seats, the two evidence
//   lists), the one orders line on both seats, and a seeded world that does not move.
// No model, no network. Usage: node scripts/wishcheck.mjs
import {mkTmp} from './tmp.mjs';
import http from 'node:http';
import {mkdtempSync, existsSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

let seed = 0x06630663;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const ROOT = mkTmp('eldmoor-wish-'); process.env.AGENT_LOGS = ROOT; process.env.BEHAVIOR_DIR = join(ROOT, 'behavior');

const SIM = await import('../src/sim/index.js');
const {init, step, S, snapshot, restore} = SIM;
const P = await import('../src/sim/player.js');
const DMA = await import('../src/sim/dmagent.js');
const {WISH, takeWishes} = await import('../src/sim/wish.js');
const {PLAYER_TOOLS} = await import('../src/data/player-tools.js');
const {DM_TOOLS} = await import('../src/data/dm-tools.js');
const {makeWatch} = await import('../src/sim/behavior.js');
const {rulingState} = await import('../src/sim/ruling.js');
const {attachPlay} = await import('./relay-mcp.mjs');
const {localBackend} = await import('./play-headless.mjs');
const {behaviorLog, FILES} = await import('./behavior-log.mjs');
const {buildReport, readJsonl, wishData, wishKey} = await import('./behavior-report.mjs');
const {systemPrompt, withMemoryOrders, WISH_ORDERS} = await import('./agent-player.mjs');
const {dmSystemPrompt, DM_WISH_ORDERS, withDmWishOrders} = await import('./dm-agent.mjs');

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};
const act = (a, tool, args) => {a.playRate = []; return P.playerAct(a.id, tool, args || {})};
const J = v => JSON.stringify(v);
const W = (tool, n = '') => ({tool, what: 'It would have let me hear the whole camp at once' + n, why: 'Three of them spoke over each other', moment: 'The fire cracked and nobody could be heard' + n});

console.log('\nEldmoor wishcheck: wish, a note for the builders (#663)\n');
init({fellowship: false}); run(20);
const live = S.agents.filter(a => a.kind === 'hero' && a.state !== 'dead');
const A = live[0], B = live[1], C = live[2];
P.markPlayer(A, true); P.markPlayer(B, true); P.markPlayer(C, true);
DMA.setDmSeat(true);
takeWishes(); // start empty

console.log('the tool on both seats:');
const hRow = PLAYER_TOOLS.find(t => t.name === 'wish'), dRow = DM_TOOLS.find(t => t.name === 'wish');
ok(hRow && hRow.act === false && dRow && dRow.act === false, 'wish is a read-style tool (act:false) for a hero and for the DM');
ok(['tool', 'what', 'why', 'moment'].every(k => hRow.args[k] && dRow.args[k]), 'four fields on both rows: tool, what, why, moment');
const gm0 = A.playActAt;
let r = act(A, 'wish', {tool: 'Hear Camp', what: 'Hear the whole camp at once', why: 'Three spoke over each other', moment: 'The fire cracked and nobody could be heard'});
ok(r.ok && r.filed === 'Hear_Camp' && r.left_today === 2 && /never answered in play/.test(r.note), 'a hero files a wish: ' + J(r));
ok(A.playActAt === gm0, 'it never counts as a world action');
ok(A.wishes.length === 1 && A.wishes[0].tool === 'Hear_Camp' && A.wishes[0].moment.length, 'kept on the hero (a.wishes)');
r = DMA.dmAct('wish', {tool: 'rewind_clock', what: 'Wind the night back an hour', why: 'The ford scene came too late', moment: 'The drover wept at the ford'});
ok(r.ok && S.dmAgent.wishes.length === 1 && S.dmAgent.wishes[0].tool === 'rewind_clock', 'the DM files a wish, even for time, which the rules forbid: ' + J(r));
r = DMA.dmAct('wish', {tool: 'kill_hero', what: 'Take a hero life at once', why: 'The story wanted a death', moment: 'Nobody had fallen all night'});
ok(r.ok, 'a wish for what the hard rules forbid is recorded as it is');

console.log('\nlimits:');
r = act(A, 'wish', {tool: 'x', what: 'a', why: 'b', moment: 'c'}); ok(!r.ok && /2-32/.test(r.error), 'a one-character tool name is refused: ' + r.error);
r = act(A, 'wish', {tool: 'a'.repeat(33), what: 'a', why: 'b', moment: 'c'}); ok(!r.ok && /2-32/.test(r.error), 'a 33-character tool name is refused');
r = act(A, 'wish', {...W('okname'), what: 'w'.repeat(301)}); ok(!r.ok && /300/.test(r.error), 'what over 300 is refused');
r = act(A, 'wish', {...W('okname'), why: 'w'.repeat(201)}); ok(!r.ok && /200/.test(r.error), 'why over 200 is refused');
r = act(A, 'wish', {...W('okname'), moment: 'w'.repeat(201)}); ok(!r.ok && /200/.test(r.error), 'moment over 200 is refused');
r = act(A, 'wish', {tool: 'okname', what: 'Something', why: '', moment: 'A moment'}); ok(!r.ok && /why/.test(r.error), 'a missing why is named');
r = act(A, 'wish', {...W('okname'), what: 'Нужен инструмент чтобы слышать всех сразу'}); ok(!r.ok && /English/.test(r.error), 'non-English is refused (hero): ' + r.error);
r = DMA.dmAct('wish', {...W('okname'), moment: '我希望有一个工具可以让我听见所有人的声音'}); ok(!r.ok && /English/.test(r.error), 'non-English is refused (DM)');
ok(A.wishes.length === 1 && S.dmAgent.wishes.length === 2, 'refused wishes are not kept');
r = act(A, 'wish', W('two')); ok(r.ok && r.left_today === 1, 'second of the day');
r = act(A, 'wish', W('three')); ok(r.ok && r.left_today === 0, 'third of the day');
r = act(A, 'wish', W('four')); ok(!r.ok && /Enough wishes/.test(r.error), 'the fourth is refused: ' + r.error);
r = act(B, 'wish', W('b_one')); ok(r.ok && r.left_today === 2, 'the cap is per seat: another hero still has three');
r = DMA.dmAct('wish', W('dm_three')); ok(r.ok, 'the DM has its own three a day (this is its third)');
r = DMA.dmAct('wish', W('dm_four')); ok(!r.ok && /Enough wishes/.test(r.error), 'and its fourth is refused');
S.gameMin += 1440;
r = act(A, 'wish', W('next_day')); ok(r.ok && r.left_today === 2, 'a new game day gives three more');
for (let i = 0; i < 3; i++) DMA.dmAct('wish', W('dm_more' + i));
for (let i = 0; i < 3; i++) { S.gameMin += 1440; act(C, 'wish', W('many' + i)); }

console.log('\nallowed while the world is held:');
{ const PR = await import('../src/sim/prep.js'); const held = typeof PR.worldHeld === 'function' ? PR.worldHeld() : null;
  ok(true, 'wish is act:false, so the hold on acting tools (worldHeld, #559) does not apply to it' + (held ? ' (held now: ' + held + ')' : '')); }

console.log('\nsave:');
for (let i = 0; i < 25; i++) { S.gameMin += 1440; act(B, 'wish', W('bulk' + i)); }
ok(B.wishes.length === WISH.KEEP && B.wishes[0].tool === 'bulk24', `the hero keeps the last ${WISH.KEEP} (newest first)`);
const snap = J(snapshot());
restore(JSON.parse(snap));
const A2 = S.agents.find(a => a.id === A.id), B2 = S.agents.find(a => a.id === B.id);
ok(A2.wishes && A2.wishes.length === 4 && A2.wishes[0].tool === 'next_day', 'a hero\'s wishes come back from the save');
ok(B2.wishes.length === WISH.KEEP, 'the cap survives the save');
ok(S.dmAgent.wishes.length >= 3 && S.dmAgent.wishes[0].tool.startsWith('dm_more'), 'the DM seat\'s wishes come back from the save');
P.markPlayer(S.agents.find(a => a.id === A.id), true);

console.log('\nthe file:');
const behavior = behaviorLog({world: 'wishworld', log: () => {}});
const server = http.createServer((q, s) => {s.writeHead(404); s.end()});
const play = attachPlay(server, {backend: localBackend({poll: 5}), behavior, log: () => {}});
await new Promise(r0 => server.listen(0, '127.0.0.1', r0));
const base = `http://127.0.0.1:${server.address().port}`;
const post = (path, body) => fetch(base + path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}).then(async x => ({status: x.status, ...(await x.json().catch(() => ({})))}));
const cl = await post('/play/claim', {hero: A2.id, runner: 'mock-A', provider: 'ollama', model: 'qwen2.5:14b'});
ok(cl.status === 200, 'a runner holds hero A with a model');
const watch = makeWatch();
const pump = (w = watch, pl = play) => {for (const o of w.tick()) pl.behaviorIngest(o.kind, o.rec)};
takeWishes(); pump(); // baseline
S.gameMin += 1440;
const secretKey = 'sk-ant-api03-' + 'Zq7'.repeat(12);
r = P.playerAct(A2.id, 'wish', {tool: 'Hear Camp', what: 'Hear the whole camp at once; my key is ' + secretKey, why: 'Three spoke over each other', moment: 'The fire cracked and nobody could be heard'});
ok(r.ok, 'hero A wishes (' + r.filed + ')');
r = DMA.dmAct('wish', {tool: 'rewind_clock', what: 'Wind the night back an hour', why: 'The ford scene came too late', moment: 'The drover wept at the ford'});
ok(r.ok || /Enough/.test(r.error), 'the DM wishes');
S.gameMin += 1440;
r = DMA.dmAct('wish', {tool: 'rewind_clock', what: 'Wind the night back an hour so the scene lands', why: 'The ford scene came too late for the drover to be heard', moment: 'The drover wept at the ford while the Fellowship rode on'});
ok(r.ok, 'the DM wishes again the next day');
pump();
const WF = join(process.env.BEHAVIOR_DIR, 'wishworld');
let L = readJsonl(WF, FILES.wish);
ok(existsSync(join(WF, 'wishes.jsonl')) && FILES.wish === 'wishes.jsonl', 'logs/behavior/<world>/wishes.jsonl exists');
const wl = L.filter(x => x.type === 'wish');
ok(wl.length === 3, `${wl.length} wish lines`);
const hl = wl.find(x => x.seat === 'hero:' + A2.id), dl = wl.find(x => x.seat === 'dm');
ok(hl && hl.name === A2.name && hl.model === 'qwen2.5:14b' && hl.provider === 'ollama', 'the hero line carries seat, name and the model of its runner');
ok(hl && hl.tool === 'Hear_Camp' && hl.what && hl.why && hl.moment && hl.day > 0 && /^[0-9]{2}:[0-9]{2}$/.test(hl.clock) && hl.summary && /level/.test(hl.summary), 'it carries the four fields, day, clock and the state summary: ' + (hl && hl.summary));
ok(dl && dl.name === 'DM' && /DM seat/.test(dl.summary) && dl.tool === 'rewind_clock', 'the DM line carries the seat and its summary');
ok(!J(L).includes(secretKey) && J(hl).includes('[redacted]'), 'key-shaped text is redacted');
ok(!wl.some(x => x.seat === 'hero:' + B2.id), 'no other seat\'s text on a line');

// the real relay route (#829): a wish called over POST /play/call, as a runner's MCP tool does, lands as a line in wishes.jsonl
S.gameMin += 1440;
{ const n0 = readJsonl(WF, FILES.wish).filter(x => x.type === 'wish').length;
  const rc = await post('/play/call', {tool: 'wish', args: W('via_relay'), hero: A2.id, runner: 'mock-A'});
  ok(rc.status === 200 && rc.ok !== false && rc.filed === 'via_relay', 'POST /play/call wish answers filed: ' + J(rc).slice(0, 160));
  pump();
  const after = readJsonl(WF, FILES.wish).filter(x => x.type === 'wish');
  const line = after.find(x => x.tool === 'via_relay');
  ok(after.length === n0 + 1 && line && line.seat === 'hero:' + A2.id && line.model === 'qwen2.5:14b' && line.what && line.moment, 'and one new line is in wishes.jsonl with the seat and the runner\'s model'); }

console.log('\nthe invitation (#829):');
{ const {WISH_INVITE, wishInvite} = await import('../src/sim/wish.js');
  const {reflectPrompt, WISH_ASK} = await import('./pacing.mjs');
  const {cleanArgs, reflectSchema, reflectWish, reflectTurn} = await import('./local-agent.mjs');
  const {wishNote, DM_WISH_ASK} = await import('./dm-agent.mjs');
  const D = C; S.gameMin += 1440;
  r = act(D, 'no_such_tool', {}); ok(!r.ok && /Unknown tool/.test(r.error) && r.error.includes(WISH_INVITE), 'a hero\'s unknown tool ends with the invitation: ' + r.error);
  r = act(D, 'no_such_tool_again', {}); ok(!r.ok && /Unknown tool/.test(r.error) && !r.error.includes(WISH_INVITE), 'but only once a game day');
  S.gameMin += 1440; r = act(D, 'no_such_tool_three', {}); ok(r.error.includes(WISH_INVITE), 'and again the next day');
  r = act(D, 'move_to', {where: 'nowhere-land-xyz'}); ok(!r.error || !r.error.includes(WISH_INVITE), 'a legal tool refused for a legal reason does not invite');
  r = DMA.dmAct('pull_lever', {lever: 'make_it_rain_frogs', params: {}, reason: 'fun'}); ok(!r.ok && /no such lever/.test(r.error) && r.error.includes(WISH_INVITE), 'the DM\'s unknown lever ends with the invitation: ' + r.error.slice(-170));
  r = DMA.dmAct('pull_lever', {lever: 'make_it_rain_toads', params: {}, reason: 'fun'}); ok(!r.error.includes(WISH_INVITE), 'the DM is invited once a game day');
  S.gameMin += 1440; r = DMA.dmAct('rain_frogs', {}); ok(!r.ok && /Unknown DM tool|not a tool/.test(r.error) && r.error.includes(WISH_INVITE), 'an unknown DM tool invites on a new day');
  const cA = {}; ok(wishInvite(cA) === ' ' + WISH_INVITE && wishInvite(cA) === '', 'the helper gives it once a day to one holder');
  const ca = cleanArgs('nope', {}, DM_TOOLS); ok(ca.error && ca.error.includes('wish {tool, what, why, moment}'), 'a runner-side unknown tool carries it once an hour');
  const cb = cleanArgs('nope2', {}, DM_TOOLS); ok(!cb.error.includes('wish {tool'), 'and not again at once');
  ok(WISH_INVITE.length < 160, 'it is one short sentence');
  const dusk = reflectPrompt({id: 'd3', kind: 'dusk', why: 'the end of the day'}), camp = reflectPrompt({id: 'c1', kind: 'camp', why: 'making camp'});
  ok(dusk.includes(WISH_ASK) && /wish \{tool, what, why, moment\}/.test(dusk) && !camp.includes(WISH_ASK), 'the dusk reflection asks, other moments do not');
  ok(reflectPrompt({id: 'd3', kind: 'dusk'}, {tools: false}).includes(WISH_ASK), 'and the forced-answer prompt asks too');
  const sc = reflectSchema({wish: true}), scS = reflectSchema({strict: true, wish: true});
  ok(sc.properties.wish && !sc.required.includes('wish') && scS.required.includes('wish') && !reflectSchema({}).properties.wish, 'the dusk schema carries the optional wish object (strict: required, empty fields), other moments none');
  ok(reflectWish(J({notes: [], wish: {tool: 'hear_all', what: 'hear the camp', why: 'they overlapped', moment: 'the fire'}})).tool === 'hear_all' && reflectWish(J({notes: [], wish: {tool: '', what: '', why: '', moment: ''}})) === null && reflectWish('nonsense') === null, 'an empty wish object is no wish; a full one is read');
  const calls = [];
  const tr = await reflectTurn({ask: async () => ({text: J({notes: [], wish: {tool: 'hear_all', what: 'hear the camp', why: 'they overlapped', moment: 'the fire'}}), usage: {}}), call: async t => {calls.push(t); return {ok: true}}, sess: {system: ''}, moment: {id: 'd9', kind: 'dusk', why: 'x'}, prompt: 'p'});
  ok(calls.includes('wish') && tr.wished === 'hear_all', 'the runner sends the wish of a dusk answer through wish');
  const calls2 = []; await reflectTurn({ask: async () => ({text: J({notes: [], wish: {tool: 'x_y', what: 'a', why: 'b', moment: 'c'}}), usage: {}}), call: async t => {calls2.push(t); return {ok: true}}, sess: {system: ''}, moment: {id: 'c9', kind: 'camp', why: 'x'}, prompt: 'p'});
  ok(!calls2.includes('wish'), 'a wish offered at a camp reflection is not sent (only dusk asks)');
  ok(wishNote({part: 'evening', day: 4}, {}) === DM_WISH_ASK && /wish \{tool, what, why, moment\}/.test(DM_WISH_ASK), 'the DM\'s evening prompt carries the question');
  { const sess = {}; wishNote({part: 'evening', day: 4}, sess); ok(wishNote({part: 'evening', day: 4}, sess) === '' && wishNote({part: 'evening', day: 5}, sess) !== '' && wishNote({part: 'morning', day: 6}, sess) === '', 'once a game day, evening only'); } }

console.log('\nprivacy across seats:');
{ const secret = 'QZXwishsecretK9Q';
  act(B2, 'wish', {tool: 'privacy_probe', what: 'Probe ' + secret, why: 'Because ' + secret, moment: 'Moment ' + secret});
  DMA.dmAct('wish', {tool: 'dm_probe', what: 'Probe ' + secret + 'D', why: 'Because', moment: 'Moment'});
  const seen = [];
  for (const [who, tools] of [[A2, ['status', 'look', 'self', 'chat_read', 'companions', 'recall', 'journal_read', 'quests', 'lore']]]) for (const t of tools) seen.push(J(act(who, t, {})));
  for (const t of ['dm_status', 'read_dm_log', 'notes_read', 'fellowship_view', 'heroes_near', 'read_timeline']) seen.push(J(DMA.dmAct(t, t === 'heroes_near' ? {near: A2.name} : t === 'notes_read' ? {section: 'all'} : {})));
  ok(!seen.join('').includes(secret), 'neither another hero\'s wish nor the DM\'s shows in a hero\'s tools or in the DM\'s reads');
  ok(!J(S.dmLog || []).includes(secret), 'the DM log does not repeat a wish');
  ok(!J(A2.chat || []).includes(secret) && !J(A2.playEv || []).includes(secret), 'no chat line or event carries it'); }

console.log('\nattempts the DM ruled on, and the report:');
pump();
const R = rulingState();
R.past.unshift({id: 901, hero: A2.id, name: A2.name, what: 'I wedge the door with my dagger and listen', t: '08:00', day: 3, by: 'dm-agent', end: 'done', pass: true, roll: 'x', skill: 'perception'});
R.past.unshift({id: 902, hero: A2.id, name: A2.name, what: 'I wedge the shutter with a spoon', t: '09:00', day: 3, by: 'dm-agent', end: 'done', pass: false, roll: 'x', skill: 'perception'});
R.past.unshift({id: 903, hero: B2.id, name: B2.name, what: 'Climb the old wall to look over', t: '10:00', day: 3, by: 'scripted', end: 'done', pass: true, roll: 'x', skill: 'athletics'});
pump();
L = readJsonl(WF, FILES.wish);
ok(L.filter(x => x.type === 'attempt').length === 3 && L.find(x => x.type === 'attempt' && x.skill === 'athletics'), 'three attempt lines (skill, text, pass) reach the file once each');
pump(); ok(readJsonl(WF, FILES.wish).filter(x => x.type === 'attempt').length === 3, 'and are not written twice');
// turn lines that tried tools that do not exist
behavior.turn({seat: 'hero:' + A2.id, hero: {id: A2.id, name: A2.name}, runner: 'mock-A', provider: 'ollama', model: 'qwen2.5:14b', tools: [{name: 'frobnicate', ok: false, error: 'Unknown tool frobnicate.'}, {name: 'look', ok: true}], narration: 'tries'});
behavior.turn({seat: 'hero:' + A2.id, hero: {id: A2.id, name: A2.name}, runner: 'mock-A', provider: 'ollama', model: 'qwen2.5:14b', tools: [{name: 'frobnicate', ok: false, error: 'Unknown tool frobnicate.'}], narration: 'tries again'});
behavior.turn({seat: 'dm', runner: 'mock-D', provider: 'anthropic', model: 'claude-haiku-5-5', tools: [{name: 'rewind', ok: false, error: 'Unknown DM tool "rewind". Tools: dm_status'}], narration: 'tries'});
// a second wish line with different spellings and a longer example, from another model, to group
behavior.ingest('wish', {type: 'wish', seat: 'hero:77', name: 'Mira', day: 5, clock: '10:00', tool: 'hear camp', what: 'Hear the whole camp at once, every voice, in the order spoken, so no one is talked over', why: 'Three of them spoke over each other and the oath was lost', moment: 'The fire cracked and nobody could be heard when Mira swore her oath', summary: 'Mira in camp', provider: 'anthropic', model: 'claude-haiku-5-5'});
behavior.ingest('wish', {type: 'wish', seat: 'hero:78', name: 'Tam', day: 5, clock: '11:00', tool: 'HEAR-CAMP', what: 'hear camp', why: 'x', moment: 'y', summary: 's'});
ok(wishKey('Hear Camp') === 'hear_camp' && wishKey('hear camp') === wishKey('HEAR-CAMP') && wishKey(' Hear_Camp! ') === 'hear_camp', 'tool names are normalised (case, spaces, dashes)');
const rep = buildReport(WF, {world: 'wishworld'});
const md = rep.md;
ok(/## Wishes/.test(md) && /asked-for tool/.test(md), 'the report has a Wishes section');
const g = rep.wishes.groups.find(x => x.tool === 'hear_camp');
ok(g && g.n === 3 && g.seats.length === 3, `grouped by normalised tool: hear_camp asked ${g && g.n} times by ${g && g.seats.join(', ')}`);
ok(g && g.best.name === 'Mira' && /every voice/.test(g.best.what), 'the best example is the one with the most words');
ok(/\*\*hear_camp\*\* \(3\)/.test(md) && /claude-haiku-5-5/.test(md), 'the section quotes the best example with its model');
ok(rep.wishes.groups.find(x => x.tool === 'rewind_clock').n >= 2 && md.indexOf('rewind_clock') > 0, 'the DM\'s wish is grouped too');
ok(/### Tools tried that do not exist/.test(md) && rep.wishes.unknown.find(u => u.tool === 'frobnicate' && u.n === 2) && rep.wishes.unknown.find(u => u.tool === 'rewind' && u.seats.includes('DM')), 'evidence one: unknown tools tried, by name and times: ' + J(rep.wishes.unknown));
ok(/### Free actions the DM ruled on most/.test(md) && rep.wishes.bySkill[0].k === 'perception' && rep.wishes.bySkill[0].n === 2 && rep.wishes.byVerb.find(v => v.k === 'i' && v.n === 2), 'evidence two: attempts by skill and first verb');
ok(wishData([], []).groups.length === 0 && /No wishes yet/.test(buildReport(join(ROOT, 'nothing'), {world: 'none'}).md), 'an empty folder reports "No wishes yet"');
await new Promise(r0 => server.close(r0));

console.log('\nwithout the behavior files (--no-behavior):');
{ const server2 = http.createServer((q, s) => {s.writeHead(404); s.end()});
  const play2 = attachPlay(server2, {backend: localBackend({poll: 5}), behavior: null, log: () => {}});
  const w2 = makeWatch(); takeWishes(); pump(w2, play2);
  S.gameMin += 1440;
  const n0 = A2.wishes.length; r = P.playerAct(A2.id, 'wish', W('no_file'));
  pump(w2, play2);
  ok(r.ok && A2.wishes.length === n0 + 1 && A2.wishes[0].tool === 'no_file', 'the save still keeps the wish');
  ok(play2.behaviorIngest('wish', {type: 'wish', tool: 'x'}) === false, 'a host with no behavior logs writes nothing');
  ok(!existsSync(join(process.env.BEHAVIOR_DIR, 'wishworld', 'nofile')), 'and no file appears for it'); }
// a host with no watch at all never grows the outbox without bound
for (let i = 0; i < 400; i++) { S.gameMin += 1440; act(C, 'wish', W('flood' + i)); }
ok(takeWishes().length <= WISH.OUT, `with nobody draining, the outbox stays at ${WISH.OUT} or fewer`);

console.log('\nthe orders:');
const st = {name: 'Maelell', level: 2, people: 'human', cls: 'Ranger', faction: 'Concord', home: 'Highgate', traits: ['wary'], oath: 'guard the road', origin: 'a farm boy'};
const sys = systemPrompt(st);
ok(sys.includes(WISH_ORDERS) && sys.split('wish {tool, what, why, moment}').length === 2, 'the hero\'s standing orders carry the one wish line');
ok(withMemoryOrders('You are Old.').includes(WISH_ORDERS) && withMemoryOrders(withMemoryOrders('You are Old.')) === withMemoryOrders('You are Old.'), 'an older session gets it once');
ok(/never answered in play/.test(WISH_ORDERS) && /nothing changes this session/.test(WISH_ORDERS) && /for the people who build the game/.test(WISH_ORDERS), 'it says: read later, never answered in play, nothing changes this session');
const dsys = dmSystemPrompt({fellowship: null});
ok(dsys.includes(DM_WISH_ORDERS) && dsys.split('wish {tool, what, why, moment}').length === 2 && withDmWishOrders(dsys) === dsys && withDmWishOrders('x').includes(DM_WISH_ORDERS), 'the DM\'s orders carry the one wish line (and an older session gets it once)');

console.log(fail ? `\nwishcheck: ${fail} failed` : '\nwishcheck: all ok');
process.exit(fail ? 1 : 0);
