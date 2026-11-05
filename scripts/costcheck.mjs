// npm run costcheck (issue #799): scripts/cost-report.mjs on fixture logs in a temporary folder. No model, no network, nothing
// under logs/. Proves: money is the logged cost (cached reads never repriced), wake reasons, tokens a call with and without ctx
// (#787) and tokensCached (#778), older lines, game hours from digests and clocks, DM voices and their world, the DM's share,
// budgets, --world/--all/--hours, history replacing a day's line, the behavior report's section, the launcher's line, and that
// no chat, narration or key-shaped text reaches a report.
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {COST, wakeClass, promptOf, gameHours, activeHours, costData, costLines, readRunnerLogs, voicesByWorld, budgetLines, readRuns, dayLines, writeHistory, todayLine} from './cost-report.mjs';
import {buildReport} from './behavior-report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let fails = 0, n = 0;
const ok = (c, m) => {n++; if (c) console.log('  ok  ' + m); else {fails++; console.log('  FAIL ' + m)}};
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

const SECRET = 'chat-text-never-in-a-report', KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
const iso = min => new Date(Date.UTC(2026, 10, 3, 12, 0) + min * 60e3).toISOString();
const turn = (min, seat, o = {}) => ({ts: iso(min), world: 'alpha', seat, hero: seat === 'dm' ? null : {id: Number(seat.slice(5)), name: o.name ?? 'Ann'}, runner: o.runner || 'pc:1:fellowship', provider: 'anthropic', model: 'claude-haiku-5-5', turn: 5, gameMin: null, clock: o.clock || null,
  wake: o.wake === undefined ? {wake: 'soft', why: 'You arrived. ' + SECRET} : o.wake, tools: [], calls: o.calls ?? 1, failed: 0, narration: SECRET + ' ' + KEY, seconds: 5, tokensIn: 4, tokensOut: 100, cacheRead: o.cacheRead ?? 20000, cacheWrite: o.cacheWrite ?? 1000, cost: o.cost ?? 0.01, flags: o.flags || [], ...o.extra});

console.log('Wake reasons:');
const wc = o => wakeClass(turn(0, 'hero:1', o));
ok(wakeClass(turn(0, 'dm', {wake: null})) === 'dm turn', 'the DM seat');
ok(wc({wake: null}) === 'start-up', 'no wake is a runner\'s first turn');
ok(wc({wake: {wake: 'now', why: 'a scene at the table: The stair'}}) === 'scene' && wc({flags: ['forced-scene', 'scene-first']}) === 'scene', 'a scene, by its wake or its flags');
ok(wc({wake: {wake: 'now', why: 'a scene at the table: Round the fire'}}) === 'fireside', 'the fire is its own reason');
ok(wc({flags: ['reflection']}) === 'reflection' && wc({wake: {wake: 'soft', why: 'a moment to reflect: dusk'}}) === 'reflection', 'a reflection');
ok(wc({wake: {wake: 'now', why: '[party] Bo says: "On we go."'}}) === 'hear: party', 'a party line');
ok(wc({wake: {wake: 'now', why: 'Boast-singer Zugash says: "Aye."'}}) === 'hear: others', 'a line heard from someone else');
ok(wc({wake: {wake: 'heartbeat', why: '120 game minutes passed'}}) === 'heartbeat', 'a heartbeat');
ok(wc({wake: {wake: 'now', why: 'Hurt: 30% HP.'}}) === 'urgent' && wc({}) === 'soft', 'anything else keeps its wake level');

console.log('Prompt sizes:');
const p1 = promptOf(turn(0, 'hero:1', {calls: 2, cacheRead: 299000, cacheWrite: 996}));
ok(p1.calls === 3 && p1.prompt === 300000 && p1.perCall === 100000 && p1.cached === 299000, 'no ctx: the turn\'s prompt tokens over tool calls plus one');
ok(promptOf(turn(0, 'hero:1', {calls: 2, extra: {ctx: 150000}})).perCall === 150000, 'ctx (#787), when logged, is the size a call');
const oa = {...turn(0, 'hero:1', {calls: 0}), provider: 'openai', tokensIn: 4000, tokensCached: 3000, cacheRead: null, cacheWrite: null};
ok(promptOf(oa).prompt === 4000 && promptOf(oa).cached === 3000, 'tokensCached (#778) is inside tokensIn: counted as cached, never added to the prompt');
const old = turn(0, 'hero:1'); delete old.cacheRead; delete old.cacheWrite; old.tokensIn = 3300000;
ok(promptOf(old) === null, 'a line from before #282 (cumulative tokens) gives no size');
ok(promptOf({...turn(0, 'hero:1', {calls: 3, flags: ['forced-scene']})}).calls === 3 && promptOf(turn(0, 'hero:1', {calls: 0, flags: ['forced-scene']})).calls === 1, 'a forced scene answer is its own call');
ok(promptOf({...turn(0, 'hero:1'), tokensIn: 0, cacheRead: 0, cacheWrite: 0}) === null, 'a turn with no model call has no size');

console.log('Game and real hours:');
ok(gameHours([], [{minutes: 60}, {minutes: 60}, {}]) === 3, 'each digest is a game hour, whatever the clock did between worlds');
ok(gameHours([turn(0, 'hero:1', {clock: 'Day 1 10:00'}), turn(1, 'hero:1', {clock: 'Day 1 12:00'}), turn(2, 'hero:1', {clock: 'Day 1 11:50'}), turn(3, 'hero:1', {clock: 'Day 1 13:00'})]) === 3, 'no digests: the clock\'s forward steps, a late line adds nothing');
ok(gameHours([turn(0, 'hero:1', {clock: 'Day 5 10:00'}), turn(1, 'hero:1', {clock: 'Day 5 11:00'}), turn(2, 'hero:1', {clock: 'Day 1 09:00'}), turn(3, 'hero:1', {clock: 'Day 1 10:00'})]) === 2, 'a new world starts the clock over');
ok(near(activeHours([turn(0, 'hero:1'), turn(10, 'hero:1'), turn(300, 'hero:1')]), 10 / 60), 'real hours skip the gaps between sittings');

console.log('Money:');
const T = [
  turn(0, 'hero:1', {wake: null, cost: 0.01, cacheRead: 30000}),
  turn(1, 'hero:1', {wake: {wake: 'now', why: '[party] Bo says: "' + SECRET + '"'}, cost: 0.05, cacheRead: 500000, calls: 1}),
  turn(2, 'hero:2', {name: '', wake: {wake: 'heartbeat', why: '240 game minutes passed'}, cost: 0.02, runner: 'pc:2', cacheRead: 40000}),
  {...turn(3, 'hero:2', {name: 'Bo', runner: 'pc:2'}), cost: null},
  {...turn(4, 'dm', {wake: null, cost: 0.12, runner: 'pc:3:dm'}), provider: 'anthropic', model: 'claude-sonnet-5-5'},
  {...turn(5, 'hero:1', {cost: 0}), provider: 'ollama', model: 'qwen2.5:14b', tokensIn: 16000, cacheRead: null, cacheWrite: null},
];
const W = [{ts: iso(1), minutes: 60, gameMin: 60, members: [{id: 1, name: 'Ann'}, {id: 2, name: 'Bo'}]}, {ts: iso(2), minutes: 60, gameMin: 120, members: [{id: 1, name: 'Ann'}]}];
const D = [{ts: iso(1), src: 'relay', kind: 'memory', ok: true, provider: 'anthropic', model: 'claude-haiku-5-5', cost: 0.002}, {ts: iso(1), src: 'relay', kind: 'memory', ok: true}, {ts: iso(1), src: 'relay', kind: 'say', ok: false}, {ts: iso(1), src: 'game', kind: 'say', outcome: 'applied'}];
const c = costData(T, W, D, {voices: {talk: {n: 2, cost: 0.03}}});
ok(near(c.turnCost, 0.2) && near(c.spend, 0.232) && near(c.relayCost, 0.002) && near(c.voiceCost, 0.03), 'spend is the logged cost, plus DM voices and relay calls: ' + c.spend);
ok(c.total.noCost === 1 && c.total.turns === 6, 'a turn with no cost is counted as such, not as zero');
ok(near(c.dmCost, 0.15) && near(c.dmShare, 0.15 / 0.232), 'the DM\'s share counts its turns and voices');
ok(c.gameHours === 2 && near(c.perGameHour, 0.116) && near(c.perTurn, 0.2 / 6), '$ per game hour and per turn');
const ann = c.seats.find(s => s.name === 'Ann' && /haiku/.test(s.mind)), bo = c.seats.find(s => s.name === 'Bo');
ok(ann && near(ann.cost, 0.06) && ann.hours === 2 && bo && bo.turns === 2 && bo.hours === 1, 'seats by hero and model; a line with no name finds it, hours from the digests');
const hk = c.minds.find(m => /haiku/.test(m.mind)), wk = w => c.wakes.find(x => x.wake === w);
ok(hk.callsPast === 2 && hk.turnsPast === 1 && near(hk.costPast, 0.05) && near(hk.costUnder, 0.03) && c.total.callsPast === 2, 'calls past the line, split by model');
ok(wk('hear: party').turns === 1 && near(wk('hear: party').cost, 0.05) && wk('start-up').turns === 1 && wk('dm turn').turns === 1 && wk('heartbeat').turns === 1, 'turns and spend by wake reason');
ok(c.kinds.find(k => k.kind === 'company runner').turns === 3 && c.kinds.find(k => k.kind === 'hero runner').turns === 2 && c.kinds.find(k => k.kind === 'dm').turns === 1, 'spend by runner kind');
ok(c.relay.find(r => r.kind === 'memory').costN === 1 && c.relay.find(r => r.kind === 'say').failed === 1 && c.relay.length === 2, 'relay calls by kind; game decisions are not relay calls');
const md = costLines(c).join('\n');
ok(/## Cost/.test(md) && /2 calls priced|1 calls priced/.test(md) && /not logged/.test(md), 'relay lines without a cost read "not logged"');
ok(!md.includes(SECRET) && !md.includes('sk-ant'), 'no chat, narration or key in the section');
ok(/_No runner turn logged yet._/.test(costLines(costData()).join('\n')), 'empty logs say so');
const many = costData(Array.from({length: COST.SEATS + 3}, (_, i) => turn(i, 'hero:' + (i + 1), {name: 'H' + i}))), mm = costLines(many).join('\n');
ok(/3 more seats: 3 turns/.test(mm), 'a long seat list ends in one line');

console.log('Fixture logs:');
const base = mkdtempSync(join(tmpdir(), 'eldmoor-cost-')), root = join(base, 'behavior'), out = join(base, 'cost');
const jl = rows => rows.map(r => JSON.stringify(r)).join('\n') + '\n';
for (const w of ['alpha', 'beta']) mkdirSync(join(root, w), {recursive: true});
mkdirSync(join(base, 'runners'));
writeFileSync(join(root, 'alpha', 'turns.jsonl'), jl(T)); writeFileSync(join(root, 'alpha', 'world.jsonl'), jl(W)); writeFileSync(join(root, 'alpha', 'decisions.jsonl'), jl(D));
writeFileSync(join(root, 'beta', 'turns.jsonl'), jl([{...turn(-2000, 'dm', {wake: null, cost: 0.5}), world: 'beta'}]));
writeFileSync(join(base, 'runners', 'dm.log'), [
  `=== ${iso(-1)} start dm DM agent | node scripts/dm-agent.mjs`,
  '[dm] DM seat taken | model claude-haiku-5-5 (effort medium) | new session',
  `[talk] Quartermaster to Ann: "${SECRET}" | 2.2 s, 472 in / 72 out, $0.0100`,
  `[table] call 2 outcome: "${SECRET}" | 1.9 s, 1573 in / 141 out, $0.0200`,
  `[ruling] Ann "${SECRET}": lore fair -> pass | 1.2 s, 100 in / 10 out, $0.0010`,
  `[companion] Bo (camp): "${SECRET}" | 1.2 s, 100 in / 10 out, $0.0040`,
  '[table] call 3 voice: the model\'s reply was not JSON; the scripted DM fills it',
  '[turn 1] 3 tool calls, 13.6 s, 4 model calls | session tokens this turn: in 6 / cache read 483704 / cache write 5118 / out 744 | turn $0.1200 | run $0.2288 | session $0.4180',
  `=== ${iso(30)} stopped (exit 0)`,
  `=== ${iso(-1990)} start dm DM agent | old`,
  '[talk] Innkeeper to Cy: "x" | 2 s, 4 in / 7 out, $0.5000',
  `=== ${iso(-1980)} stopped (exit 0)`,
  `=== ${iso(-5000)} start dm DM agent | a run with no turn line`,
  '[talk] Innkeeper to Cy: "x" | 2 s, 4 in / 7 out, $0.7000',
  `=== ${iso(-4990)} stopped (exit 0)`,
].join('\n'));
writeFileSync(join(base, 'runners', 'fellowship.log'), [
  `=== ${iso(-1)} start fellowship the Fellowship`,
  '[12:00:01] [Ann] [turn 9] claude-haiku-5-5 | 4 tool calls, 12.4 s | tokens this turn: in 8 / cache read 2136809 / cache write 2771 / out 338 | turn $0.0600 | member $0.5975 | run $1.9665 of $2.0000',
  '[12:00:03] [Ann] [turn 10, scene] qwen2.5:14b (local) | 0 tool calls, 2.2 s | tokens in 0 / out 0 | $0 (local) | empty turn',
  '[12:00:05] [Bo] [turn 176] scene answer first | claude-haiku-5-5 | tokens in 8418 / out 37 | $0.0200 | run $0.8059',
].join('\n'));
writeFileSync(join(base, 'fellowship-runs.jsonl'), jl([{at: iso(5), spent: 2.25, budget: 2, members: []}, {at: iso(10), spent: 0.5, budget: 2, members: []}, {at: iso(-3000), spent: 1, budget: null}]) + 'not json\n');

const runs = readRunnerLogs(join(base, 'runners')), dmRuns = runs.filter(r => r.seat === 'dm');
ok(dmRuns.length === 3 && dmRuns.find(r => r.start === Date.parse(iso(-1))).end === Date.parse(iso(30)), 'runner logs cut into runs at their start and stop lines');
const v = voicesByWorld(runs, {alpha: T.filter(t => t.seat === 'dm').map(t => Date.parse(t.ts)), beta: [Date.parse(iso(-1985))]});
ok(near(v.alpha.talk.cost, 0.01) && near(v.alpha.table.cost, 0.02) && v.alpha.table.n === 1 && near(v.alpha.ruling.cost, 0.001) && near(v.alpha.companion.cost, 0.004), 'each voice line priced once; a line with no cost is skipped');
ok(near(v.beta.talk.cost, 0.5) && near(v.null.talk.cost, 0.7), 'a DM run goes to the world of its turn lines; one with none goes nowhere');
const fr = runs.find(r => r.seat === 'company');
ok(near(fr.turn, 0.08) && fr.turnN === 2, 'turn costs read from a company log, $0 local lines left out');
const bl = budgetLines(readRuns(join(base, 'fellowship-runs.jsonl'))).join('\n');
ok(/3 company runs spent \$3\.75; 1 ended on their budget/.test(bl) && /\$2\.00 \| 2 \| \$2\.75 \| \$0\.25/.test(bl), 'budgets: runs, spend, and what went past them');

const run = (...a) => spawnSync(process.execPath, [join(HERE, 'cost-report.mjs'), '--dir', root, '--out', out, ...a], {encoding: 'utf8', env: {...process.env, BEHAVIOR_DIR: root}});
const date = d => {const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`};
const today = join(out, date(Date.now()) + '.md');
let r = run('--world', 'alpha');
ok(r.status === 0 && /alpha: \$0\.24, 6 turns/.test(r.stdout), '--world alpha: ' + r.stdout.split('\n')[0]);
let rep = readFileSync(today, 'utf8');
ok(/## alpha/.test(rep) && !/## beta/.test(rep) && /## Company runs and budgets/.test(rep) && /Runner logs beside the turn lines/.test(rep), 'the report: one world, budgets, the runner logs beside the turn lines');
ok(!rep.includes(SECRET) && !rep.includes('sk-ant'), 'no chat, narration, voice text or key in the report file');
const hist = () => readFileSync(join(out, 'history.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
ok(hist().length === 1 && hist()[0].world === 'alpha' && hist()[0].turns === 6 && near(hist()[0].spend, 0.202), 'history: one line for the world and day');
r = run('--all');
ok(r.status === 0 && /beta: /.test(r.stdout) && /All 2 worlds: /.test(readFileSync(today, 'utf8')), '--all: every world and their total');
ok(hist().length === 2 && new Set(hist().map(h => h.date + h.world)).size === 2, 'a second run replaces its day\'s lines, never doubles them');
writeHistory(join(out, 'history.jsonl'), [{date: '2020-01-01', world: 'alpha', spend: 9}]); writeHistory(join(out, 'history.jsonl'), dayLines('alpha', T, W, D));
ok(hist().some(h => h.date === '2020-01-01') && hist().filter(h => h.world === 'alpha').length === 2, 'a day no log holds any more stays');
const before = readFileSync(join(out, 'history.jsonl'), 'utf8');
r = run('--world', 'alpha', '--hours', '1');
ok(r.status === 0 && /alpha: \$0\.00, 0 turns/.test(r.stdout) && readFileSync(join(out, 'history.jsonl'), 'utf8') === before, '--hours N leaves out older lines and leaves history alone');
r = run('--world', 'nowhere');
ok(r.status === 1 && /No behavior logs for world "nowhere"/.test(r.stderr), 'an unknown world is named');
ok(spawnSync(process.execPath, [join(HERE, 'cost-report.mjs'), '--dir', join(base, 'none'), '--out', out], {encoding: 'utf8'}).status === 1, 'no logs at all says so');

console.log('The behavior report and the launcher:');
const b = buildReport(join(root, 'alpha'), {world: 'alpha'});
ok(/## Cost\n/.test(b.md) && /Per seat and model:/.test(b.md) && b.cost && near(b.cost.spend, 0.237), 'the behavior report carries the section, voices included: ' + (b.cost && b.cost.spend));
ok(!/Cost section failed/.test(b.md) && !existsSync(join(base, 'cost', 'report.md')), 'the section writes no file of its own');
const noon = new Date(iso(30));
const line = todayLine(root, noon);
ok(/^cost today: \$0\.\d+ over \d+ turns, \$0\.\d+ a game hour, DM \d+% \(npm run cost-report\)$/.test(line), 'the launcher\'s line: ' + line);
ok(todayLine(join(base, 'none')) === 'cost today: no runner turn yet', 'no logs, no spend');

console.log(fails ? `\ncostcheck: ${fails} of ${n} FAILED` : `\ncostcheck: all ${n} passed`);
process.exit(fails ? 1 : 0);
