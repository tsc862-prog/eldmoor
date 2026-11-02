// The DM agent check (issue #66, part 1). No API key and no Ollama needed: mock agents only.
//   1. The DM tools in the sim: a closed seat answers nothing; reads work and roll no dice; notes are
//      kept (add, edit, remove, caps); a lever pull goes through the registry with by 'dm-agent' and a
//      DM log entry; refusals past the lever's limits, past the agent's daily cap, for named_foe, and
//      for piling danger onto a badly hurt Fellowship member; no lever touches a hero's numbers.
//   2. Notes, the seat and its day counts survive snapshot -> JSON -> restore.
//   3. Silence never stalls the world: with the seat open and no runner (or a runner that never
//      calls) a seeded world runs exactly like one without the seat (two child runs, hashed).
//   4. Over HTTP (attachPlay + the headless backend): /play/health reports the seat; one claimed DM
//      seat (a second runner is refused, a closed seat refuses claims); the MCP server at
//      /mcp?role=dm lists the DM tools and none of the hero tools; /play/dm and MCP calls work.
//   1b. Staged scenes (issue #132): every refusal of stage_scene (kind, reason, frame, cast, place, town,
//      not a member, far above the party, a creature not of that region, meeting without a want, bad role,
//      a badly hurt member before a fight or trap, an open scene or vote, one at a time, per day), all in
//      the DM log tagged dm-agent; dm_status and table_call with nothing staged. In part 4 the runner's table
//      voice (scripts/dm-agent.mjs tableVoice, mock model) answers a staged meeting's calls over /play/dm.
//   5. The runner end to end: `npm run dm -- --provider ollama` against a mock Ollama and a headless
//      world opened with --dm: it claims the seat, reads, writes a note, pulls a lever, gets one
//      refused, prints a cost line per turn and keeps its session in logs/agents/dm.json (resumed next run).
import http from 'node:http';
import {spawn, spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let seed = 0x9e3779b9 ^ (Number(process.env.DMCHECK_SEED) || 66);
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const sim = await import('../src/sim/index.js');
const {init, step, S, snapshot, restore, dmAct, setDmSeat, dmSeatOn} = sim;
const {DMA, pileOn} = await import('../src/sim/dmagent.js');
const {maxHp} = await import('../src/sim/heroes.js');
const {fellows} = await import('../src/sim/fellowship.js');
const {ZONES, ZPTS, zoneAt} = await import('../src/world/map.js');
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};

// ---- determinism child: a seeded world, the seat open (silent) or not, hashed ----
if (process.argv[2] === '--hash') {
  init({fellowship: false}); if (process.argv[3] === 'seat') setDmSeat(true);
  run(150);
  if (process.argv[3] === 'seat') dmAct('dm_status'); // a read in the middle changes nothing either
  run(30);
  let h = Math.round(S.gameMin); for (const a of S.agents) h = (Math.imul(h, 31) + a.lvl * 1000 + Math.round(a.xp) + Math.round(a.x * 10) * 7 + Math.round(a.hp)) | 0;
  for (const m of S.mobs) h = (Math.imul(h, 17) + Math.round(m.x * 10) + m.lvl) | 0;
  console.log('HASH ' + h); process.exit(0);
}

// ---- Fellowship-first child (issue #165): a seeded world with a Fellowship, the scripted DM alone, the share printed ----
if (process.argv[2] === '--focus') {
  init({fac: 0}); run(1500);
  const {focusStats} = await import('../src/sim/dmfocus.js');
  console.log('FOCUS ' + JSON.stringify(focusStats()) + ' H ' + Math.round(S.gameMin) + ' ' + S.agents.length + ' ' + (S.dmLog || []).length);
  process.exit(0);
}

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
console.log('\nEldmoor dmcheck: the DM as an agent, part 1 (mock agents)\n');

// ---------------------------------------------------------------- 1. the DM tools in the sim
console.log('the DM tools');
init({fac: 0}); run(60);
ok(!!S.fellowship, `a world with a Fellowship (${S.fellowship && S.fellowship.name})`);
let r = dmAct('dm_status');
ok(r.ok === false && r.offline && /seat is closed/.test(r.error) && !S.dmAgent, 'a closed seat answers nothing and leaves no state');
setDmSeat(true);
ok(dmSeatOn() && S.dmLog[0].kind === 'agent', 'opening the seat is logged in the DM log');
const nums = () => S.agents.map(a => [a.id, a.lvl, Math.round(a.xp), a.state === 'dead' ? 0 : 1].join(':')).join(',');
const rng0 = seed, n0 = nums();
for (const t of ['dm_status', 'read_timeline', 'read_chronicle', 'read_dm_log', 'fellowship_view', 'npcs', 'regions', 'hooks', 'levers', 'notes_read']) {r = dmAct(t, {n: 5}); ok(r.ok, `${t} reads (${JSON.stringify(r).length} chars)`)}
r = dmAct('heroes_near', {near: S.fellowship.hall || 'Highgate'}); ok(r.ok && Array.isArray(r.heroes), `heroes_near ${r.place}: ${r.heroes && r.heroes.length} heroes`);
ok(dmAct('heroes_near', {near: 'Nowhere-at-all'}).ok === false, 'heroes_near refuses an unknown place');
ok(seed === rng0 && nums() === n0, 'reads roll no dice and change no hero');
const fv = dmAct('fellowship_view').fellowship;
ok(fv && fv.members.length === 5 && fv.members.every(m => m.empty || ('persona' in m && 'memory_recent' in m)) && Array.isArray(fv.open_threads), 'fellowship_view: five members with persona, memories and open threads');
ok(dmAct('levers').levers.every(l => l.name !== 'named_foe'), 'the lever menu leaves out named_foe (the scripted DM\'s, inside scenes)');

// notes
r = dmAct('notes_write', {section: 'threads', op: 'add', text: 'Who robbed the Mirefen wagon?', about: 'Mirefen road'});
const nid = r.note && r.note.id;
ok(r.ok && nid, 'notes_write add');
ok(dmAct('notes_write', {section: 'secrets', op: 'add', text: 'The innkeeper sold the route.'}).ok && /a secret/.test(JSON.stringify(S.dmLog[0].summary)), 'a secret is logged without its text in the summary');
ok(dmAct('notes_write', {section: 'threads', op: 'edit', id: nid, text: 'Who robbed the wagon, and why the innkeeper smiles.'}).ok, 'notes_write edit');
ok(dmAct('notes_write', {section: 'plans', op: 'add', text: 'Fog on the marsh road for a day.'}).ok, 'notes_write add (plans)');
ok(dmAct('notes_write', {section: 'gossip', op: 'add', text: 'x'}).ok === false && dmAct('notes_write', {section: 'threads', op: 'remove', id: 9999}).ok === false, 'bad sections and unknown ids are refused');
ok(dmAct('notes_write', {section: 'threads', op: 'add', text: 'x'.repeat(900)}).note.text.length === DMA.NOTE_MAX, `notes are capped at ${DMA.NOTE_MAX} characters`);
const nr = dmAct('notes_read').notes;
ok(nr.threads.length === 2 && nr.secrets.length === 1 && nr.plans.length === 1, 'notes_read returns every section');

// levers
const z = 1, pulls0 = (S.dmLog || []).filter(e => e.kind === 'lever').length;
r = dmAct('pull_lever', {lever: 'set_condition', params: {region: ZONES[z], kind: 'fogbound', strength: 1, hours: 12}, reason: 'the marsh closes in'});
ok(r.ok && S.conditions.some(c => c.z === z && c.kind === 'fogbound'), `pull_lever set_condition: fog over ${ZONES[z]}`);
const le = S.dmLog.find(e => e.kind === 'lever');
ok(le.detail.by === 'dm-agent' && le.detail.reason === 'the marsh closes in' && S.levers.active.some(x => x.by === 'dm-agent'), 'the pull is in the DM log with by dm-agent and its reason');
r = dmAct('pull_lever', {lever: 'set_condition', params: {region: ZONES[z], kind: 'bandits'}, reason: 'again'});
ok(r.ok === false && /already has a condition/.test(r.error), 'a second condition in the region is refused by the lever: ' + r.error);
r = dmAct('pull_lever', {lever: 'set_condition', params: {region: ZONES[2], kind: 'festival'}, reason: 'a fair'});
r = dmAct('pull_lever', {lever: 'set_condition', params: {region: ZONES[3] || ZONES[0], kind: 'festival'}, reason: 'another fair'});
ok(r.ok === false && /limit|already/.test(r.error), 'past the lever\'s limits a pull is refused: ' + r.error);
ok(dmAct('pull_lever', {lever: 'named_foe', params: {}, reason: 'x'}).ok === false, 'named_foe is refused to the agent');
ok(dmAct('pull_lever', {lever: 'set_condition', params: {region: 1}, reason: ''}).ok === false, 'a pull without a reason is refused');
ok(dmAct('pull_lever', {lever: 'kill_hero', params: {}, reason: 'x'}).ok === false, 'an unknown lever is refused');
ok(dmAct('pull_lever', {lever: 'set_condition', params: '{not json', reason: 'x'}).ok === false, 'params that are not an object are refused');
// pile-on: a badly hurt Fellowship member out in the field
const hurt = fellows()[0], hz = zoneAt(hurt.x, hurt.y);
hurt.state = 'hunt'; hurt.hp = maxHp(hurt) * .2;
const pile = pileOn('mark_dangerous', {at: {x: hurt.x + 1, y: hurt.y}});
r = dmAct('pull_lever', {lever: 'mark_dangerous', params: {at: {x: Math.round(hurt.x) + 1, y: Math.round(hurt.y)}}, reason: 'more wolves'});
ok(!!pile && r.ok === false && /does not pile on/.test(r.error), `danger next to ${hurt.name} at 20% HP is refused`);
hurt.hp = maxHp(hurt);
ok(!pileOn('mark_dangerous', {at: {x: hurt.x + 1, y: hurt.y}}) && hz != null, 'once healed, the same pull is no longer a pile-on');
// the agent's own daily cap
S.dmAgent.day.pulls = DMA.PULLS_PER_DAY;
r = dmAct('pull_lever', {lever: 'price_shock', params: {good: Object.keys((await import('../src/data/items.js')).GOODS)[0], direction: 'up'}, reason: 'a hard winter'});
ok(r.ok === false && /pulled \d+ levers today/.test(r.error), 'past the DM agent\'s daily cap a pull is refused');
ok((S.dmLog || []).filter(e => e.kind === 'lever').length > pulls0 + 4 && S.dmLog.filter(e => e.kind === 'lever' && e.detail.by === 'dm-agent' && /rejected/.test(e.detail.result)).length >= 4, 'refusals are logged too, tagged dm-agent');
ok(nums() === n0, 'no hero\'s level, XP or life changed through the DM tools');
r = dmAct('log_intent', {text: 'The wagon thread will pull the party toward Mirefen.'});
ok(r.ok && S.dmLog[0].kind === 'agent' && S.dmLog[0].detail.intent, 'log_intent writes a DM agent line');
ok(dmAct('fly').ok === false, 'unknown DM tools are refused');

// ---------------------------------------------------------------- 1b. staged scenes: the rules of the seat (issue #132)
console.log('staged scenes: refusals');
{const ST = await import('../src/sim/staged.js'), T = await import('../src/sim/table.js'), {zoneFor, zonePoint} = await import('../src/world/map.js'), {homeOf} = await import('../src/data/races.js');
  const L = fellows(), home = homeOf(L[0]).gate, spot = zonePoint(zoneFor(Math.max(1, L[0].lvl), home), null, home);
  L.forEach((x, i) => {x.x = spot.x + (i % 3) * .6; x.y = spot.y + Math.floor(i / 3) * .6; x.state = 'hunt'; x.hidden = false; x.target = null; x.dest = null; x.hp = maxHp(x)});
  T.TABLE.mode = 'off'; // nothing opens on its own while the refusals are tried
  const frame = 'Mist lies on the road, and something moves in it.', st = (a) => dmAct('stage_scene', {kind: 'mystery', near: 'fellowship', frame, cast: {}, reason: 'test', ...a});
  const no = (a, re, m) => {const x = st(a); ok(x.ok === false && re.test(x.error), m + ': ' + (x.error || 'staged!').replace(/^Refused: /, ''))};
  const n0 = S.dmLog.filter(e => /Staged scene refused/.test(e.summary.map(p => typeof p === 'string' ? p : p && p.t || '').join(''))).length;
  no({kind: 'dragon'}, /kind must be one of/, 'an unknown kind');
  no({reason: ''}, /reason is required/, 'no reason');
  no({frame: 'Mist.'}, /frame/, 'no real frame');
  no({cast: [1, 2]}, /cast must be an object/, 'a cast that is not an object');
  no({near: 'Nowhere-at-all'}, /unknown place/, 'an unknown place');
  no({near: CITYN()}, /not inside/, 'inside a town');
  const stranger = S.agents.find(a => !a.fellow && a.state !== 'dead');
  no({near: stranger.name}, /only the Fellowship/, 'a hero outside the Fellowship');
  no({kind: 'elite', cast: {level: Math.max(...L.map(a => a.lvl)) + 6}}, /far above the party/, 'a foe far above the party\'s level');
  no({kind: 'elite', cast: {foe: 'Cinder Wyrm'}}, /lives in/, 'a creature that does not live there');
  no({kind: 'meeting', cast: {role: 'drover'}}, /needs cast.want/, 'a meeting with no want');
  no({kind: 'meeting', cast: {role: 'king', want: 'x'}}, /role must be one of/, 'a role no wanderer has');
  L[1].hp = maxHp(L[1]) * .2;
  no({kind: 'ambush'}, /badly hurt/, `an ambush while ${L[1].name} is at 20% HP in the field`);
  no({kind: 'trap'}, /badly hurt/, 'a trap too');
  L[1].hp = maxHp(L[1]);
  S.table = {id: 0, kind: 'check', ids: [], ctx: {}, calls: null}; no({}, /Table scene is open/, 'while a Table scene is open'); S.table = null;
  const P0 = {id: 999, status: 'open', kind: 'other', votes: {}, by: L[0].id, details: 'x'}; (S.fellowship.props || (S.fellowship.props = [])).push(P0);
  no({}, /vote is open/, 'while a party vote is open'); P0.status = 'failed';
  const okR = st({}); ok(okR.ok && okR.staged, `a mystery is staged: ${okR.title} ${okR.where}`);
  no({kind: 'meeting', cast: {role: 'drover', want: 'a hand'}}, /one at a time/, 'a second one while the first waits');
  S.staged.cur.phase = 'done'; S.staged.day.n = ST.STAGE.PER_DAY;
  no({}, /staged scenes today/, `past ${ST.STAGE.PER_DAY} a day`);
  S.staged.day.n = 0;
  ok(S.dmLog.filter(e => /Staged scene refused/.test(e.summary.map(p => typeof p === 'string' ? p : p && p.t || '').join('')) && e.detail.by === 'dm-agent').length === n0 + 17, 'every refusal is in the DM log, tagged dm-agent');
  ok(S.dmLog.some(e => e.kind === 'frame' && e.detail.by === 'dm-agent' && e.detail.staged === okR.staged && e.detail.reason === 'test'), 'the staging is in the DM log with its reason');
  const ds = dmAct('dm_status'); ok(ds.ok && ds.staged && /\/3$/.test(ds.staged.today), `dm_status shows the day's staged scenes (${ds.staged && ds.staged.today})`);
  const tc = dmAct('table_call'); ok(tc.ok && tc.call === null && tc.scene === null, 'table_call with nothing at the table: no call');
  ok(dmAct('table_answer', {call: 1, text: 'x'}).ok === false, 'table_answer with nothing at the table is refused');
  T.TABLE.mode = 'auto'}
function CITYN() {return S.agents.length && (S.fellowship.hall || 'Highgate')}

// ---------------------------------------------------------------- 2. save and restore
console.log('save and restore');
const before = JSON.stringify(S.dmAgent.notes), day0 = S.dmAgent.day.pulls;
const snap = JSON.parse(JSON.stringify(snapshot()));
setDmSeat(false); S.dmAgent.notes.threads = []; run(5);
ok(!dmSeatOn(), 'the seat closed and the notes scribbled over');
restore(snap);
ok(dmSeatOn() && JSON.stringify(S.dmAgent.notes) === before && S.dmAgent.day.pulls === day0 && S.dmAgent.world, 'notes, the open seat and the day\'s counts survive snapshot -> JSON -> restore');
ok(dmAct('notes_read', {section: 'threads'}).notes.threads.length === 2, 'notes_read works on the restored world');
run(10);
ok(S.gameMin > snap.gameMin, 'the restored world runs on');

// ---------------------------------------------------------------- 2b. the Fellowship first (issue #165)
console.log('the Fellowship first');
{const FO = await import('../src/sim/dmfocus.js'), ST = await import('../src/sim/staged.js'), {pull} = await import('../src/sim/levers.js'), DA = await import('./dm-agent.mjs');
  const fo = FO.focus();
  ok(!!fo && fo.ids.size >= 1 && fo.town && fo.zones.size >= 1, 'the DM knows the Fellowship: hall town and the regions it rides');
  r = dmAct('dm_status');
  const keys = Object.keys(r);
  ok(r.ok && typeof r.fellowship_first === 'string' && keys.indexOf('fellowship_needs') >= 0 && keys.indexOf('fellowship_needs') < keys.indexOf('table') && keys.indexOf('fellowship_needs') < keys.indexOf('adventures'), 'dm_status lists the Fellowship first: fellowship_first and fellowship_needs come before the world');
  const n = r.fellowship_needs;
  ok(n && typeof n.summary === 'string' && n.summary.length > 10 && Array.isArray(n.items) && 'quiet' in n && n.share_of_dm_actions, 'fellowship_needs: a short summary, the items (threads, scenes, hurt members) and the share of DM actions so far: ' + (n && n.summary));
  ok(typeof r.fellowship_change === 'string' && r.fellowship_change.length > 0, 'fellowship_change is a signature of their situation (' + r.fellowship_change + ')');
  const sig0 = r.fellowship_change; S.fellowship.past.push({id: -1, name: 'Test'});
  ok(dmAct('dm_status').fellowship_change !== sig0, 'a fallen member changes the signature'); S.fellowship.past.pop();
  // the runner's bounded, event-driven cadence
  const st = {ok: true, day: 3, gameMin: 4000, fellowship_change: 'b'};
  ok(DA.eventDue(st, {sig: 'a', gm: 3000}, {day: 3, n: 0}) === true, 'cadence: a changed situation makes an extra turn due');
  ok(!DA.eventDue({...st, fellowship_change: 'a'}, {sig: 'a', gm: 3000}, {}) && !DA.eventDue(st, {sig: 'a', gm: 3000}, {day: 3, n: DA.EVENT_MAX}) && !DA.eventDue(st, {sig: 'a', gm: 3950}, {}) && !DA.eventDue(st, {sig: null, gm: 3000}, {}), 'cadence: nothing new, the day cap and the minimum gap each hold it back');
  ok(/Fellowship first:/.test(DA.dmTurnPrompt(2, {...r, day: 3, part: 'day'})) && /The Fellowship comes first/.test(DA.dmSystemPrompt(r)) && /The Fellowship comes first/.test(DA.withDmFellowshipOrders('old prompt')), 'the standing orders and every turn prompt start with the Fellowship');
  // the reserved share of the daily limits
  const far = ZONES.map((_, z) => z).find(z => !fo.zones.has(z) && (ZPTS[z] || []).length);
  const zp = ZPTS[far][0], L0 = S.levers; L0.day.d = -1;
  const fn = z => pull('mark_cleared', {at: {x: zp.x, y: zp.y}, r: 3, hours: 4}, {by: 'scripted', reason: 'test'});
  S.levers.day = {d: Math.floor(S.gameMin / 1440), n: {mark_cleared: 4}, rz: {}, nf: {mark_cleared: 4}};
  const rf = fn();
  ok(!rf.ok && /kept for the Fellowship/.test(rf.reason), 'the world cannot use the reserved share of a daily limit: ' + (rf.reason || 'pulled'));
  S.levers.day = {d: Math.floor(S.gameMin / 1440), n: {}, rz: {}, nf: {}}; S.levers.cd = {};
  const ra = fn();
  ok(ra.ok && S.levers.day.nf.mark_cleared === 1, 'a world pull below the reserve still goes through and is counted (' + (ra.reason || 'ok') + ')');
  const near = fo.members[0], pn = {x: Math.round(near.x), y: Math.round(near.y)};
  ok(FO.pullTouches('mark_cleared', {at: pn}, zoneAt(pn.x, pn.y), fo) && !FO.pullTouches('mark_cleared', {at: zp}, far, fo), 'a pull at the side of a member concerns the Fellowship; one in a far region does not');
  const G = ST.stagedState(); G.cur = null; G.day = {d: Math.floor(S.gameMin / 1440), n: 2, nw: 2};
  const stg = dmAct('stage_scene', {kind: 'mystery', near: Math.round(zp.x) + ',' + Math.round(zp.y), frame: 'A cairn stands crooked on the far moor, a lantern burning in it.', reason: 'test the reserve'});
  ok(stg.ok === false && /kept for the Fellowship|spot|outside|tile|ground|far/.test(stg.error), 'a staged scene far from the Fellowship cannot take the last slot of the day: ' + stg.error);
  G.day = {d: -1, n: 0, nw: 0}; G.cur = null;
}
{ // the scripted DM, alone, with a Fellowship: most of what it does concerns them, and it is deterministic
  const run1 = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--focus'], {cwd: ROOT, encoding: 'utf8', env: {...process.env}}), line = (run1.stdout || '').trim().split(/\r?\n/).pop();
  const m = /^FOCUS (\{.*\}) H/.exec(line), fs_ = m ? JSON.parse(m[1]) : null;
  ok(fs_ && fs_.acts >= 6 && fs_.share > 0.5, 'with a Fellowship, most DM actions concern it: ' + (fs_ ? fs_.fellow + ' of ' + fs_.acts + ' (' + Math.round(fs_.share * 100) + '%)' : line || run1.stderr.slice(-300)));
  const run2 = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--focus'], {cwd: ROOT, encoding: 'utf8', env: {...process.env}});
  ok((run2.stdout || '').trim() === (run1.stdout || '').trim(), 'the scripted DM is deterministic under the same seed (same actions, same share)');
}

// ---------------------------------------------------------------- 3. silence never stalls the world
console.log('silence');
const hashOf = arg => {const p = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--hash', arg], {cwd: ROOT, encoding: 'utf8', env: {...process.env}}); return (p.stdout || '').trim() || p.stderr};
const h1 = hashOf('none'), h2 = hashOf('seat');
ok(/^HASH -?\d+$/.test(h1) && h1 === h2, `a seeded world runs the same with the seat open and nobody in it (${h1})`);

// ---------------------------------------------------------------- 4. over HTTP and MCP
console.log('relay routes');
const {attachPlay} = await import('./relay-mcp.mjs');
const {localBackend} = await import('./play-headless.mjs');
const server = http.createServer((q, s) => {s.writeHead(404); s.end('{}')});
const play = attachPlay(server, {backend: localBackend(), log: () => {}});
await new Promise(res => server.listen(0, '127.0.0.1', res));
const B = `http://127.0.0.1:${server.address().port}`;
const post2 = (base, path, body) => fetch(base + path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}).then(async x => ({status: x.status, ...(await x.json())}));
const post = (path, body, headers = {}) => fetch(B + path, {method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: JSON.stringify(body)}).then(async x => ({status: x.status, ...(await x.json())}));
let h = await (await fetch(B + '/play/health')).json();
ok(h.dm && h.dm.seat === true && h.dm.link === 'none' && !h.dm.claimed, '/play/health reports the open DM seat, no runner');
r = await post('/play/claim', {role: 'dm', runner: 'test:1', provider: 'anthropic', model: 'claude-sonnet-5-5'});
ok(r.status === 200 && r.dm.claimed, 'a runner claims the DM seat');
r = await post('/play/claim', {role: 'dm', runner: 'test:2'});
ok(r.status === 409 && /One DM at a time/.test(r.error), 'a second DM runner is refused');
h = await (await fetch(B + '/play/health')).json();
ok(h.dm.link === 'waiting' && h.dm.runner && h.dm.runner.model === 'claude-sonnet-5-5', `the seat's link is waiting with the runner's mind (${h.dm.runner && h.dm.runner.model})`);
r = await post('/play/dm', {tool: 'dm_status', runner: 'test:1'});
ok(r.ok && r.day >= 1, 'POST /play/dm dm_status');
ok((await post('/play/dm', {tool: 'dm_status', runner: 'test:2'})).status === 409, 'a held DM seat answers only its own runner (issue #123)');
ok((await post('/play/dm', {tool: 'dm_status', runner: 'test:1', hero: 1})).status === 403, 'a call naming a hero gets no DM tools');
ok((await post('/play/dm', {tool: 'look'})).status === 400, 'hero tools are not DM tools');
ok((await post('/play/call', {tool: 'dm_status'})).status === 400, 'DM tools are not hero tools');
h = await (await fetch(B + '/play/health')).json();
ok(h.dm.link === 'connected', 'after a call the seat shows connected');
{const {Client} = await import('@modelcontextprotocol/sdk/client/index.js');
  const {StreamableHTTPClientTransport} = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const c = new Client({name: 'dmcheck', version: '1.0.0'});
  await c.connect(new StreamableHTTPClientTransport(new URL(B + '/mcp?role=dm'), {requestInit: {headers: {'X-Eldmoor-Role': 'dm', 'X-Eldmoor-Runner': 'test:1'}}}));
  const tools = (await c.listTools()).tools.map(t => t.name);
  ok(tools.includes('pull_lever') && tools.includes('notes_write') && !tools.includes('look') && !tools.includes('move_to'), `MCP /mcp?role=dm lists ${tools.length} DM tools and no hero tools`);
  ok(['stage_scene', 'table_call', 'table_answer'].every(t => tools.includes(t)), 'and the staged-scene tools (stage_scene, table_call, table_answer)');
  const res = await c.callTool({name: 'notes_write', arguments: {section: 'characters', op: 'add', text: 'Merel the gate captain, owes the party.'}});
  ok(/"ok":true/.test(res.content[0].text) && S.dmAgent.notes.characters.length === 1, 'an MCP notes_write lands in the world');
  const res2 = await c.callTool({name: 'pull_lever', arguments: {lever: 'mark_place', params: {kind: 'shrine', at: {x: 1, y: 1}}, reason: 'test'}});
  ok(/"ok":false/.test(res2.content[0].text), 'an MCP lever pull with an illegal spot is refused, not thrown');
  await c.close()}
// the runner's table voice (issue #132): a mock model answers the calls of a staged scene over /play/dm
{const {tableVoice} = await import('./dm-agent.mjs'), T = await import('../src/sim/table.js'), {zoneFor, zonePoint} = await import('../src/world/map.js'), {homeOf} = await import('../src/data/races.js');
  const L = fellows(), home = homeOf(L[0]).gate, spot = zonePoint(zoneFor(Math.max(1, L[0].lvl), home), null, home);
  L.forEach((x, i) => {x.x = spot.x + (i % 3) * .6; x.y = spot.y + Math.floor(i / 3) * .6; x.state = 'hunt'; x.hidden = false; x.target = null; x.dest = null; x.hp = maxHp(x)});
  if (S.levers) {S.levers.cd = {}; S.levers.day = {d: -1, n: {}, rz: {}}} if (S.staged) {S.staged.day.n = 0; if (S.staged.cur) S.staged.cur.phase = 'done'}
  T.TABLE.mode = 'auto'; T.TABLE.speed = 1; S.table = null;
  const st = await post('/play/dm', {tool: 'stage_scene', runner: 'test:1', args: {kind: 'meeting', near: 'fellowship', frame: 'A drover sits on a milestone, his ox lame beside him.', cast: {role: 'drover', want: 'a hand getting the ox to the ford', voice: 'tired, kind'}, reason: 'runner test'}});
  ok(st.ok, 'stage_scene over /play/dm' + (st.ok ? '' : ': ' + st.error));
  const asked = [];
  const adapter = {call: async ({user, schema}) => {asked.push(user); const e = schema.properties.pick.enum; return {text: JSON.stringify({text: 'Mock line ' + asked.length + ': the ox lows.', pick: e[e.length - 1]}), usage: {in: 300, out: 20, cost: 0}}}};
  const lines = [], v = tableVoice({base: B, adapter, model: 'mock', log: s => lines.push(s), pollIdle: 5, pollHot: 5, tool: (b, tool, args) => post('/play/dm', {tool, args, runner: 'test:1'})});
  let sc = null; const t0 = Date.now();
  while (Date.now() - t0 < 30000) {step(1 / 60); if (S.table && S.table.ctx.staged != null) sc = S.table; if (sc && !S.table && S.staged.cur.phase === 'done') break; await new Promise(res => setTimeout(res, 1))}
  await v.stop();
  const calls = sc ? sc.calls : [], mine = calls.filter(c => c.by === 'dm-agent');
  ok(sc && calls.length && mine.length >= Math.ceil(calls.length / 2), `the table voice answered ${mine.length} of ${calls.length} calls in ${((Date.now() - t0) / 1000).toFixed(1)} s (the scripted DM filled ${calls.length - mine.length})`);
  ok(asked.length && /Call \d+ \(voice/.test(asked[0]) && /drover/i.test(asked[0]), 'its prompt carries the scene and the call');
  ok(lines.some(l => /^\[table\] call \d+ /.test(l)), 'a log line per call: ' + (lines[0] || ''));
  ok(fellows().some(a => (a.chat || []).some(e => /^Mock line/.test(e.text))), 'the members hear the DM\'s lines in the game')}
r = await post('/play/release', {role: 'dm', runner: 'test:1'});
setDmSeat(false);
r = await post('/play/claim', {role: 'dm', runner: 'test:3'});
ok(r.status === 404 && /seat is closed/.test(r.error), 'a closed seat refuses claims');
ok((await post('/play/dm', {tool: 'dm_status'})).offline === true, 'and answers no DM tool');
server.close();

// ---------------------------------------------------------------- 4b. the browser bridge answers the DM seat
console.log('the browser bridge (src/ui/player-bridge.js)');
{
  const srv = http.createServer((q, s) => {s.writeHead(404); s.end('{}')});
  attachPlay(srv, {log: () => {}}); // the browser backend (WebSocket), as the real relay
  await new Promise(res => srv.listen(0, '127.0.0.1', res));
  const PB = `http://127.0.0.1:${srv.address().port}`;
  const {WebSocket: WsClient} = await import('ws');
  globalThis.WebSocket = class extends WsClient {constructor(u) {super(u, {origin: 'http://localhost:5173'})}};
  globalThis.localStorage = {getItem: k => k === 'eldmoor.playUrl' ? `ws://127.0.0.1:${srv.address().port}/play` : null};
  const BR = await import('../src/ui/player-bridge.js');
  sim.disbandFellowship(); // #148: Fellowship members are always agent-played; this part needs a world with no agent hero
  for (const a of S.agents) if (a.player) BR.agentOff(a);
  ok(BR.dmLink() === 'off' && BR.bridgeStatus() === 'off', 'seat closed, no agent hero: the page stays off the relay');
  BR.dmSeatSet(true);
  const until = async (f, ms = 5000) => {const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 50)); return f()};
  ok(await until(() => BR.bridgeStatus() === 'connected'), 'opening the seat connects the page to the relay');
  let hh = null; await until(() => false, 300); hh = await (await fetch(PB + '/play/health')).json();
  ok(hh.connected && hh.dm && hh.dm.seat === true && hh.heroes.length === 0, 'the relay sees the open DM seat and no agent hero');
  const cl = await post2(PB, '/play/claim', {role: 'dm', runner: 'page-test:1', provider: 'ollama', model: 'mock-dm:1b'});
  const rr = await post2(PB, '/play/dm', {tool: 'notes_write', args: {section: 'threads', op: 'add', text: 'Asked through the page.'}, runner: 'page-test:1'});
  ok(cl.status === 200 && rr.ok && S.dmAgent.notes.threads.some(n => n.text === 'Asked through the page.'), 'a DM call through the relay is answered by the page\'s world');
  ok(await until(() => BR.dmLink() === 'connected' && BR.dmRunnerTag() === 'mock-dm:1b · local'), `the page sees the DM runner's link and mind (${BR.dmLink()}, ${BR.dmRunnerTag()})`);
  BR.dmSeatSet(false);
  ok(await until(() => BR.bridgeStatus() === 'off'), 'closing the seat (no agent hero) disconnects the page');
  const off = await post2(PB, '/play/dm', {tool: 'dm_status', runner: 'page-test:1'});
  ok(off.ok === false && off.offline, 'and the relay says the game is not connected');
  srv.close(); setDmSeat(true);
}

// ---------------------------------------------------------------- 5. the runner, end to end (mock Ollama)
console.log('npm run dm -- --provider ollama (mock Ollama, headless world with --dm)');
const plan = [['dm_status', {}], ['notes_write', {section: 'plans', op: 'add', text: 'A pilgrim road through the fog.'}],
  ['pull_lever', {lever: 'set_condition', params: {region: 0, kind: 'festival', strength: 1, hours: 6}, reason: 'a harvest fair to lift spirits'}],
  ['pull_lever', {lever: 'set_condition', params: {region: 0, kind: 'bandits'}, reason: 'too soon'}]];
const seen = [];
const mock = http.createServer((req, res) => {
  const send = (code, o) => {res.writeHead(code, {'content-type': 'application/json'}); res.end(JSON.stringify(o))};
  if (req.url === '/api/tags') return send(200, {models: [{name: 'mock-dm:1b', model: 'mock-dm:1b'}]});
  if (req.url !== '/api/chat') return send(404, {error: 'not found'});
  let b = ''; req.on('data', c => b += c); req.on('end', () => {const body = JSON.parse(b); seen.push(body);
    const msgs = body.messages, last = msgs.map((m, i) => m.role === 'user' ? i : -1).filter(i => i >= 0).pop(), n = msgs.slice(last + 1).filter(m => m.role === 'assistant').length;
    const done = {done: true, done_reason: 'stop', prompt_eval_count: 1200, eval_count: 30, model: body.model};
    if (n >= plan.length) return send(200, {...done, message: {role: 'assistant', content: 'The DM set a fair in motion and noted the pilgrim road.'}});
    const [name, args] = plan[n]; send(200, {...done, message: {role: 'assistant', content: '', tool_calls: [{function: {name, arguments: args}}]}})});
});
await new Promise(res => mock.listen(0, '127.0.0.1', res));
const OLLAMA = `http://127.0.0.1:${mock.address().port}`;
const tmp = mkdtempSync(join(tmpdir(), 'eldmoor-dmcheck-'));
const childEnv = {...process.env, AGENT_LOGS: tmp, ANTHROPIC_API_KEY: '', OLLAMA_URL: OLLAMA, RELAY_VERBOSE: '', AGENT_MIN_GAP: '0'};
const kids = [];
function start(args, ready) {
  const p = spawn(process.execPath, args, {cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe']}); kids.push(p); let out = '';
  p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  const done = new Promise(r => p.on('exit', code => r(code)));
  const until = ready ? new Promise((res, rej) => {const t = setInterval(() => {if (ready.test(out)) {clearInterval(t); res()}}, 100); setTimeout(() => {clearInterval(t); rej(new Error('timeout waiting for ' + ready + '\n' + out))}, 90000)}) : null;
  return {p, done, until, out: () => out};
}
const port = 18100 + Math.floor(Math.random() * 500), BASE = `http://127.0.0.1:${port}`;
try {
  const world = start(['scripts/play-headless.mjs', '--port', String(port), '--dm', '--agents', '0', '--quiet', '--speed', '4', '--world', join(tmp, 'world.json')], /headless world/);
  await world.until;
  h = await (await fetch(BASE + '/play/health')).json();
  ok(h.dm && h.dm.seat && h.heroes.length === 0, 'play-headless --dm --agents 0: the DM seat open, no agent hero');
  const dm = start(['scripts/dm-agent.mjs', '--url', BASE, '--provider', 'ollama', '--model', 'mock-dm:1b', '--max-turns', '2', '--cadence', '5', '--ollama-url', OLLAMA, '--claude-concurrency', '1']);
  const watch = start(['-e', `setTimeout(async()=>{const h=await (await fetch('${BASE}/play/health')).json();console.log(JSON.stringify(h.dm))},2500)`]);
  await watch.done;
  const live = JSON.parse(watch.out().trim().split('\n').pop() || '{}');
  ok(live.claimed && live.runner && live.runner.provider === 'ollama' && live.runner.model === 'mock-dm:1b', `while it runs, the seat is claimed and tagged ${live.runner && live.runner.model}`);
  const code = await dm.done, out = dm.out();
  ok(code === 0, 'the DM runner exits cleanly after --max-turns' + (code === 0 ? '' : '\n' + out.slice(-1500)));
  ok(/DM seat taken \| local model mock-dm:1b/.test(out) && /> dm_status\(\)/.test(out) && /> notes_write\(/.test(out) && /> pull_lever\(/.test(out), 'it reads, writes a note and pulls levers through the DM tools');
  ok(/"lever":"set_condition"/.test(out) && /Refused: /.test(out), 'one pull lands, one is refused (the region already has a condition, or the day\'s limit)');
  ok((out.match(/\[turn \d\] mock-dm:1b \(local\) \| 4 tool calls.*tokens in \d+ \/ out \d+ \| \$0 \(local\)/g) || []).length === 2, 'two turns, each with a cost line');
  ok(/next turn in|waiting/.test(out), 'between turns it waits for its cadence');
  const f = join(tmp, 'agents', 'dm.json'), sess = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
  ok(sess && sess.turns === 2 && sess.runner.provider === 'ollama' && sess.world && sess.local && sess.local.history.length > 0, 'logs/agents/dm.json keeps the world tag, runner settings, turns and the conversation');
  const again = start(['scripts/dm-agent.mjs', '--url', BASE, '--max-turns', '1', '--cadence', '5', '--ollama-url', OLLAMA]);
  const c2 = await again.done, o2 = again.out(), s2 = JSON.parse(readFileSync(f, 'utf8'));
  ok(c2 === 0 && /resuming/.test(o2) && /mock-dm:1b/.test(o2) && s2.turns === 3, 'the next run resumes the saved session and settings (no flags)' + (c2 === 0 ? '' : '\n' + o2.slice(-1200)));
  h = await (await fetch(BASE + '/play/health')).json();
  ok(!h.dm.claimed, 'the runner let go of the seat on exit');
  world.p.kill();
} catch (e) {ok(false, 'runner section: ' + (e.message || e))}
for (const k of kids) try {k.kill()} catch {}
mock.close();
try {rmSync(tmp, {recursive: true, force: true})} catch {}

console.log(fail ? `\n${fail} check(s) FAILED` : '\nall DM agent checks passed');
process.exit(fail ? 1 : 0);
