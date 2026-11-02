// In-game channels check (issue #123): the DM and the players communicate only inside the game.
// The owner's rule: the DM and the heroes (Fellowship members, agent-played heroes) talk only through
// in-game chat and what their characters can perceive; no seat ever reads another seat's text.
//
// Plants a unique secret in every place a seat keeps private text, then proves none of them reaches
// a hero, while the in-game channels do:
//   secrets  DM notes (secrets and threads), DM log intent, a lever reason, the DM log's model
//            prompt, another member's journal, memories (recent and long), persona and backstory,
//            mind (a brain prompt), runner narration (Agent tab) and saved session prompt, the notebooks of
//            issue #155 (another member's memories, a fallen member's private note, the DM's remember)
//   hero     every hero tool result (status, look, chat_read, party_read, journal_read, events,
//            wait, scene views ...), the runner prompts (system prompt, Fellowship orders, turn
//            prompts) and the brain snapshots (townPlan, say, fightOrFlee, cryptCall, persona,
//            backstory, memory, the Fellowship card)
//   reach    the DM's narrate line reaches the members in range (chat_read, events, the snapshot's
//            chat, the Table banner and view) and not a member far away; npc_say reaches heroes in
//            earshot; party chat reaches every member
//   relay    a claimed hero answers only its runner; heroes have no DM tools and the DM no hero
//            tools; one runner never holds a hero and the DM seat; /play/health carries no text
//   memories (issue #155) remember, recall (word, tag, about, id), update_memory, forget, pin, the state
//            header's notes, the caps (200 notes, 600 characters, archive, pins, writes a day), the letter a
//            fallen member leaves (and nothing else of theirs), the Markdown mirror, snapshot -> restore, and
//            the DM's tools never showing a hero's notes
// No model, no network beyond 127.0.0.1. Usage: npm run channelcheck (CHANNELCHECK_SEED to vary).
import http from 'node:http';
import {mkdtempSync, rmSync, existsSync, readdirSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

let seed = 0x5eed1230 ^ (Number(process.env.CHANNELCHECK_SEED) || 123);
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const LOGS = mkdtempSync(join(tmpdir(), 'eldmoor-channel-')); process.env.AGENT_LOGS = LOGS; // session files go here, never into logs/

const SIM = await import('../src/sim/index.js');
const {init, step, S, maxHp} = SIM;
const P = await import('../src/sim/player.js');
const F_ = await import('../src/sim/fellowship.js');
const T = await import('../src/sim/table.js');
const C = await import('../src/sim/council.js');
const DMA = await import('../src/sim/dmagent.js');
const BR = await import('../src/sim/brain.js');
const PE = await import('../src/sim/persona.js');
const ME = await import('../src/sim/memory.js');
const NBm = await import('../src/sim/notebook.js');
const PC = await import('../src/sim/pace.js');
const HE = await import('../src/sim/heroes.js');
const MM = await import('./memory-mirror.mjs');
const {memoryNote} = await import('./pacing.mjs');
const {dmTurnPrompt} = await import('./dm-agent.mjs');
const {zoneFor, zonePoint, dist, ZONES, zoneAt} = await import('../src/world/map.js');
const {homeOf} = await import('../src/data/races.js');
const {PLAYER_TOOLS} = await import('../src/data/player-tools.js');
const {systemPrompt, turnPrompt} = await import('./agent-player.mjs');
const {fellowshipPrompt, memberPrompt} = await import('./fellowship.mjs');
const SS = await import('./agent-sessions.mjs');
const {attachPlay} = await import('./relay-mcp.mjs');
const {localBackend} = await import('./play-headless.mjs');

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};
const act = (a, tool, args) => P.playerAct(a.id, tool, args || {});
let n = 0; const secret = label => 'QZX' + label + (++n) + 'K' + Math.floor(Math.random() * 1e9).toString(36) + 'Q';
const SECRETS = {};
const plant = label => (SECRETS[label] = secret(label));
// Every hero-side text gathered here; the check is that no secret appears in any of it.
const heard = [];
const keep = (what, v) => {heard.push({what, text: typeof v === 'string' ? v : JSON.stringify(v)}); return v};
const leaks = () => {const out = []; for (const [k, s] of Object.entries(SECRETS)) for (const h of heard) if (h.text.includes(s)) out.push(k + ' in ' + h.what); return out};

console.log('\nEldmoor channelcheck: the DM and the players meet only inside the game\n');
init({fellowship: false}); run(60);
for (const a of S.agents) if (a.fac === 0) {a.lvl = 8; a.hp = maxHp(a)}
const r0 = F_.found(F_.autoPick(0), {fac: 0, ai: false});
ok(r0.ok && F_.fellows().length === 5, `founded ${S.fellowship && S.fellowship.name} (5 members)`);
F_.setMinds('agent');
const M = F_.fellowshipMembers().map(m => m.hero);
const [A, B] = M, rest = M.slice(2);
ok(M.every(x => x.player), `every member agent-played; A = ${A.name}, B = ${B.name}`);
DMA.setDmSeat(true);
T.TABLE.mode = 'off'; // no scene opens on its own; the Table part opens one by hand

// Put A in the field with two companions, B and the rest far away (out of sight and earshot).
const zone = zoneFor(8, homeOf(A).gate), spot = zonePoint(zone, null, homeOf(A).gate);
const park = (x, p) => {x.x = p.x; x.y = p.y; x.state = 'hunt'; x.hidden = false; x.target = null; x.dest = null; x.hp = maxHp(x); x.pq = []};
park(A, spot); park(rest[0], {x: spot.x + 1, y: spot.y}); park(rest[1], {x: spot.x, y: spot.y + 1});
const far = {x: spot.x > 40 ? 3 : 76, y: spot.y > 25 ? 3 : 46};
park(B, far); park(rest[2], {x: far.x + 1, y: far.y});
for (const m of S.mobs) if (dist(m, spot) < 14 || dist(m, far) < 14) {m.alive = false; m.gone = true}
ok(dist(A, B) > 30, `A and B are ${Math.round(dist(A, B))} tiles apart`);

// ---------------------------------------------------------------- 1. plant the secrets
console.log('plant a secret in every private place');
let r = DMA.dmAct('notes_write', {section: 'secrets', op: 'add', text: 'The innkeeper is ' + plant('dmSecret'), about: A.name});
ok(r.ok, 'DM notes: a secret');
r = DMA.dmAct('notes_write', {section: 'threads', op: 'add', text: 'Thread ' + plant('dmThread'), about: A.name});
ok(r.ok, 'DM notes: an open thread (its text goes into the DM log)');
r = DMA.dmAct('notes_write', {section: 'plans', op: 'add', text: 'Plan ' + plant('dmPlan')});
ok(r.ok, 'DM notes: a plan');
r = DMA.dmAct('log_intent', {text: 'Intent ' + plant('dmIntent')});
ok(r.ok, 'DM log: an intent line');
r = DMA.dmAct('pull_lever', {lever: 'set_condition', params: {region: ZONES[zone > 0 ? zone : 1], kind: 'fogbound', strength: 1, hours: 6}, reason: 'Reason ' + plant('leverReason')});
DMA.dmAct('pull_lever', {lever: 'mark_place', params: {kind: 'shrine', at: {x: 1, y: 1}}, reason: 'Refused ' + plant('leverRefused')});
ok(S.dmLog.some(e => JSON.stringify(e).includes(SECRETS.leverReason) || JSON.stringify(e).includes(SECRETS.leverRefused)), 'lever reasons (granted or refused) in the DM log');
// a staged scene (issue #132): its reason is the DM's own (DM log only); the frame and the person's want are said in the game
r = DMA.dmAct('stage_scene', {kind: 'meeting', near: A.name, frame: 'A drover waits by the road with a lame ox.', cast: {role: 'drover', want: 'a hand with the ox'}, reason: 'Stage ' + plant('stageReason')});
ok(r.ok && S.dmLog.some(e => JSON.stringify(e).includes(SECRETS.stageReason)), 'a staged scene\'s reason in the DM log' + (r.ok ? '' : ': ' + r.error));
S.dmLog[0].prompt = 'DM model prompt ' + plant('dmPrompt'); S.dmLog[0].reply = 'DM model reply ' + plant('dmReply');
ok(act(B, 'journal_write', {text: 'Dear diary, ' + plant('bJournal')}).ok, 'B\'s journal');
ME.remember(B, 'scene', 'I remember ' + plant('bMemory'));
ME.memOf(B).long = (ME.memOf(B).long || '') + ' Long ago ' + plant('bLong') + '.';
B.persona = {...(B.persona || PE.buildPersona(B, M)), wants: 'B wants ' + plant('bWants'), fears: 'B fears ' + plant('bFears'), voice: 'B speaks ' + plant('bVoice')};
B.backstory = {...(B.backstory || PE.buildBackstory(B, M, S.fellowship.name)), summary: 'B is ' + plant('bSummary')};
B.backstory.paras = {...B.backstory.paras, flaw: 'B hides ' + plant('bFlaw')};
B.mind = [{id: 1, t: 'D1 08:00', kind: 'townPlan', snapshot: {secret: plant('bMind')}, sent: {user: 'prompt ' + plant('bMindPrompt')}, outcome: 'applied'}];
P.playerNarrate(B.id, 'B thinks ' + plant('bNarration'));
const bs = SS.loadSession(B.id, B.name, () => ({sessionId: 's-b', heroId: B.id, heroName: B.name, system: 'You are B. ' + plant('bPrompt'), turns: 3, costUsd: 0, lastTotal: 0})).sess; SS.saveSession(bs, {});
// and what A's companions keep about A stays theirs too: a rest member's private journal
ok(act(rest[0], 'journal_write', {text: 'Of A I think ' + plant('mateJournal')}).ok, 'a third member\'s journal');
// the notebooks (issue #155): every seat's own, the DM's included
ok(act(B, 'remember', {title: 'What I hide', text: 'My memory ' + plant('bNote'), tags: ['secret'], about: A.name}).ok, 'B\'s memories (remember)');
ok(act(rest[0], 'remember', {title: 'About the others', text: 'Of A I note ' + plant('mateNote'), tags: ['party'], about: A.name}).ok, 'a third member\'s memories');
ok(act(rest[2], 'remember', {title: 'Private', text: 'Hidden ' + plant('deadNote'), tags: ['secret']}).ok, 'a member who will fall keeps a private note');
ok(DMA.dmAct('remember', {title: 'The fogbound road', text: 'DM memory ' + plant('dmMemory'), tags: ['fog'], about: A.name, section: 'plans'}).ok, 'DM memories (remember, plans)');
ok(DMA.dmAct('notes_read').notes.secrets.some(x => x.text.includes(SECRETS.dmSecret)) && S.dmLog.some(e => JSON.stringify(e).includes(SECRETS.dmIntent)), 'the DM still reads its own notes and log (the check is not vacuous)');

// ---------------------------------------------------------------- 2. the in-game channels
console.log('in-game: narrate, npc_say, party chat');
const said = {narr: 'The fog smells of ' + secret('narr') + ' and wet stone.', party: 'Hold the line, ' + secret('party') + '!', npc: 'Mind the north road, ' + secret('npc') + '.', table: 'Water drips in the dark ' + secret('table') + '.'};
r = DMA.dmAct('narrate', {text: said.narr, near: A.name, radius: 6});
ok(r.ok && r.heard_by >= 3 && r.heroes.includes(A.name) && !r.heroes.includes(B.name), `narrate near ${A.name}: heard by ${r.heard_by} (${(r.heroes || []).join(', ')})`);
ok((A.chat || []).some(e => e.text === said.narr && e.from && e.from.kind === 'dm') && !(B.chat || []).some(e => e.text === said.narr), 'A hears the narrator; B, far away, does not');
ok(act(B, 'party_say', {text: said.party}).ok, 'B speaks on the party channel');
// an NPC: the nearest townsperson to A's home gate, with A walked next to them
const npc = (S.npcs || []).filter(p => Number.isFinite(p.x)).sort((p, q) => dist(p, homeOf(A).gate) - dist(q, homeOf(A).gate))[0];
const before = {x: A.x, y: A.y};
if (npc) {A.x = npc.x + 1; A.y = npc.y}
r = npc ? DMA.dmAct('npc_say', {npc: String(npc.id), text: said.npc}) : {ok: false, error: 'no npc'};
ok(r.ok && r.heard_by >= 1 && (A.chat || []).some(e => e.text === said.npc && e.from.kind === 'npc'), `npc_say: ${r.who || r.error} speaks; A hears it`);
ok(!(B.chat || []).some(e => e.text === said.npc), 'B, out of earshot, does not');
// #164: the world is muted (only the DM voices it): a background hero says no scripted line, a townsperson near a member
// speaks only as the scripted DM (tagged dm), and the old chatter comes back with S.worldVoice = 'scripted'
{const {say} = await import('../src/sim/chat.js'), {npcSay} = await import('../src/sim/npcs.js');
  ok(S.worldVoice === 'dm', 'the world voice defaults to the DM');
  const bg = S.agents.find(h => !h.fellow && !h.player && h.state !== 'dead' && h.state !== 'ghost');
  if (bg) {const n0 = (bg.chat || []).length; bg.chatCd = 0; say(bg, 'idle', {}); say(bg, 'kill', {mob: 'Boar', level: 3});
    ok((bg.chat || []).length === n0 && !bg.bubble, 'a background hero speaks no scripted line while the flag is on');
    S.worldVoice = 'scripted'; bg.chatCd = 0; say(bg, 'kill', {mob: 'Boar', level: 3});
    ok((bg.chat || []).length > n0, 'with the flag off the old scripted chatter returns'); S.worldVoice = 'dm'}
  if (npc) {const n1 = (A.chat || []).length; npc.chatCd = 0; ok(npcSay(npc, 'greet', {target: A.name}) && (A.chat || []).length === n1 + 1 && A.chat[A.chat.length - 1].dm, 'a townsperson meeting a member is voiced by the scripted DM (attributed to them, tagged dm)');
    const far = {x: A.x + 30, y: A.y + 30}; const saved = {x: npc.x, y: npc.y}; npc.x = far.x; npc.y = far.y; npc.chatCd = 0; const n2 = (A.chat || []).length;
    npcSay(npc, 'greet', {target: 'x'}); ok((A.chat || []).length === n2, 'a townsperson with no member in earshot says nothing scripted'); npc.x = saved.x; npc.y = saved.y}}
A.x = before.x; A.y = before.y;
ok(!DMA.dmAct('narrate', {text: 'x', near: 'nowhere at all'}).ok && !DMA.dmAct('npc_say', {npc: 'Nobody Atall', text: 'x'}).ok && !DMA.dmAct('narrate', {text: 'x', near: 'table'}).ok, 'unknown places, people, and "table" without a scene are refused');

// ---------------------------------------------------------------- 3. everything a hero gets
console.log('hero tools, events, prompts and snapshots');
run(2); // let the watch() step turn heard lines into events
const argsFor = {move_to: {target: 'home'}, talk: {target: B.name}, say: {text: 'Well met.'}, join_party: {hero_id: B.id}, take_adventure: {job_id: 1}, choose: {option: 'a'},
  fight: {target_id: 0}, hunt: {count: 1}, rest: {minutes: 10}, buy: {}, sell: {index: 99}, equip: {index: 99}, read_chronicle: {n: 20}, journal_read: {n: 50}, journal_write: {text: 'A writes.'},
  party_say: {text: 'Aye.'}, party_read: {n: 20}, chat_read: {n: 20}, propose: {kind: 'other', details: 'A small fire tonight.'}, vote: {proposal_id: 1, vote: 'yes', reason: 'fine'},
  lead_to: {target: 'home'}, scene_act: {option: 'a'}, wait: {minutes: 10}, list_jobs: {},
  remember: {title: 'Road notes', text: 'A notes the road home.', tags: ['road', 'secret'], about: B.name}, recall: {query: 'road hide secret memory'}, update_memory: {id: 1, text: 'A rewrites the road note.'}, forget: {id: 9999}, pin: {id: 1}};
const first = {};
for (const t of ['status', 'look', 'chat_read', 'party_read', 'journal_read', 'read_chronicle']) first[t] = keep('A ' + t, act(A, t, argsFor[t]));
ok((first.chat_read.lines || []).some(l => l.includes(said.narr) && /narrator/i.test(l)) && (first.chat_read.lines || []).some(l => l.includes(said.party)), 'chat_read: the narrator and B\'s party line');
ok((first.party_read.lines || []).some(l => l.includes(said.party)), 'party_read: B\'s party line');
ok(JSON.stringify(first.status.events || []).includes(said.narr) || JSON.stringify(first.status).includes(said.narr) || heard.some(h => h.text.includes('The narrator: ' + said.narr)), 'events: "The narrator: ..." reaches A\'s agent');
ok(JSON.stringify(first.status.events || []).includes(said.npc) || (first.chat_read.lines || []).some(l => l.includes(said.npc)) || heard.some(h => h.text.includes(said.npc)), 'an npc_say near a member reaches that member agent (events or chat_read)');
for (const t of PLAYER_TOOLS) if (t.name !== 'wait') keep('A ' + t.name, act(A, t.name, argsFor[t.name] || {}));
// A's own notebook only: every way of asking (about B, B's tag, ids B's notes also carry, everything), and the state header
for (const [k, v] of Object.entries({about: {about: B.name}, aboutId: {about: String(B.id)}, tag: {tag: 'secret'}, party: {tag: 'party'}, all: {n: 20}, id1: {id: 1}, id2: {id: 2}, words: {query: 'hide note others private'}})) keep('A recall ' + k, act(A, 'recall', v));
ok(act(A, 'recall', {n: 20}).notes.every(n => n.title === 'Road notes' || n.title === 'A writes.'), 'A\'s recall finds only A\'s own notes (its note and its journal entry, #179), whatever it asks');
{const br = keep('A pace brief', PC.paceBrief(A.id)); keep('A memory line', memoryNote(br.brief)); keep('A brief text', SIM.S && br.brief ? JSON.stringify(br.brief) : '')}
// a wait, finished by the host the way sim/player-host.js does
const w = act(A, 'wait', {minutes: 10}); run(3); keep('A wait', P.finishWait(w.pending, true));
for (const x of [rest[0], rest[1]]) for (const t of ['status', 'chat_read', 'party_read', 'look']) keep(x.name + ' ' + t, act(x, t, argsFor[t]));
// B (far): its own journal is its own; the narration did not reach it
const bc = act(B, 'chat_read', {n: 20}); ok(!JSON.stringify(bc).includes(said.narr), 'B\'s chat_read has no narration it could not hear');
ok(JSON.stringify(act(B, 'journal_read', {n: 50})).includes(SECRETS.bJournal), 'B still reads its own journal');
// the runner prompts for A: standing orders (from A's own status), Fellowship orders, every turn prompt
const st = act(A, 'status');
keep('A system prompt', systemPrompt(st)); keep('A fellowship prompt', fellowshipPrompt(st));
for (let k = 0; k < 4; k++) {keep('A turn prompt ' + k, turnPrompt(k)); keep('A member prompt ' + k, memberPrompt(k, false)); keep('A scene prompt ' + k, memberPrompt(k, true))}
ok(!/QZX/.test(memberPrompt(0, false) + memberPrompt(3, true) + turnPrompt(2)), 'turn prompts are fixed text: nothing from any other seat');
// the brain snapshots for A (a model-played hero sees only these)
BR.enableBrain(A);
const snaps = {townPlan: BR.snapshotFor(A, 'townPlan'), say: BR.snapshotFor(A, 'say', {trigger: 'idle', ctx: {}}), fightOrFlee: BR.snapshotFor(A, 'fightOrFlee', {mob: S.mobs.find(m => m.alive)}), cryptCall: BR.snapshotFor(A, 'cryptCall'),
  persona: PE.personaSnapshot(A, F_.fellows(), S.fellowship.name), backstory: PE.backstorySnapshot(A, F_.fellows(), S.fellowship.name),
  memory: ME.memorySnapshot(A, ME.memOf(A).recent, ME.memOf(A).long), card: PE.fellowCard(A)};
for (const [k, v] of Object.entries(snaps)) keep('A snapshot ' + k, v);
BR.disableBrain(A);
ok(JSON.stringify(snaps.say.chat || []).includes(said.narr) || JSON.stringify(snaps.say.chat || []).includes(said.party), 'the say snapshot carries what A heard (the narrator or the party)');
ok(snaps.persona.companions.some(c => c.name === B.name) && !snaps.persona.companions.some(c => 'summary' in c), 'persona snapshot: companions by name, class and origin, never their sheets');

// ---------------------------------------------------------------- 4. the Table: narration on the banner and in the view
console.log('the Table');
T.TABLE.mode = 'auto'; T.TABLE.speed = 1;
const sc = T.openScene('check', 'A narrow stair', ['The stair goes down.'], {});
ok(!!sc && S.table, 'a scene is open');
r = DMA.dmAct('narrate', {text: said.table, near: 'table'});
ok(r.ok && r.heard_by === S.table.ids.length, `narrate "table": every member at the table hears it (${r.heard_by})`);
const tv = act(A, 'look'); keep('A look at the table', tv);
ok(tv.table && tv.table.narrator === said.table && T.bannerOf().narr === said.table, 'the line shows in the Table banner and in each member\'s table view');
ok((B.chat || []).some(e => e.text === said.table), 'B, at the table, hears it too (the scene is where they are)');
keep('A status at the table', act(A, 'status'));
{const own = JSON.stringify(act(B, 'status')), other = Object.entries(SECRETS).filter(([k]) => !k.startsWith('b')).filter(([, v]) => own.includes(v)).map(([k]) => k);
  ok(own.includes(SECRETS.bWants) && !other.length, 'B\'s own status carries B\'s own sheet and memories, and nothing of the DM\'s or another member\'s' +(other.length ? ': ' + other.join(', ') : ''))}
S.table = null; T.TABLE.mode = 'off';

// ---------------------------------------------------------------- 5. the relay: seats stay apart
console.log('relay and MCP');
const server = http.createServer((q, s) => {s.writeHead(404); s.end('{}')});
attachPlay(server, {backend: localBackend(), log: () => {}});
await new Promise(res => server.listen(0, '127.0.0.1', res));
const base = `http://127.0.0.1:${server.address().port}`;
const post = (path, body, headers = {}) => fetch(base + path, {method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: JSON.stringify(body)}).then(async x => ({status: x.status, body: await x.json().catch(() => ({}))}));
ok((await post('/play/claim', {hero: A.id, runner: 'run-A'})).status === 200 && (await post('/play/claim', {hero: B.id, runner: 'run-B'})).status === 200, 'run-A claims A, run-B claims B');
ok((await post('/play/claim', {role: 'dm', runner: 'run-DM'})).status === 200, 'run-DM takes the DM seat');
let x = await post('/play/claim', {role: 'dm', runner: 'run-A'}); ok(x.status === 409, 'a hero\'s runner cannot also take the DM seat');
x = await post('/play/claim', {hero: rest[0].id, runner: 'run-DM'}); ok(x.status === 409, 'the DM\'s runner cannot also take a hero');
x = await post('/play/call', {hero: B.id, tool: 'journal_read', args: {n: 50}, runner: 'run-A'}); keep('run-A asks for B', x.body);
ok(x.status === 409 && x.body.refused, 'run-A cannot read B\'s journal (409)');
x = await post('/play/call', {hero: A.id, tool: 'chat_read', args: {n: 20}, runner: 'run-A'}); keep('run-A chat_read', x.body);
ok(x.status === 200 && JSON.stringify(x.body).includes(said.narr), 'run-A reads A\'s chat: the narrator is there');
x = await post('/play/dm', {tool: 'notes_read', runner: 'run-A'}); keep('run-A asks DM tools', x.body);
ok(x.status === 403, 'a hero\'s runner gets no DM tools (403)');
x = await post('/play/dm', {tool: 'notes_read', hero: A.id, runner: 'run-DM'}); keep('DM call naming a hero', x.body);
ok(x.status === 403, 'a DM call that names a hero is refused (403)');
x = await post('/play/dm', {tool: 'notes_read', runner: 'run-B'}); keep('run-B asks DM tools', x.body); ok(x.status === 403, 'nor run-B');
x = await post('/play/dm', {tool: 'notes_read', runner: 'run-DM'}); ok(x.status === 200 && JSON.stringify(x.body).includes(SECRETS.dmSecret), 'run-DM reads its notes');
x = await post('/play/call', {hero: A.id, tool: 'status', role: 'dm', runner: 'run-DM'}); keep('DM asks hero tools', x.body);
ok(x.status === 403, 'the DM role has no hero tools (403)');
x = await post('/play/narrate', {hero: A.id, text: 'whisper', role: 'dm'}); ok(x.status === 403, 'nor a way to whisper into a hero\'s narration');
x = await fetch(base + '/mcp?role=dm', {method: 'POST', headers: {'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-eldmoor-hero': String(A.id), 'x-eldmoor-runner': 'run-DM'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}})});
ok(x.status === 403, 'MCP role=dm with a hero header is refused');
const mcp = (hero, runner, name, args) => fetch(base + '/mcp', {method: 'POST', headers: {'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-eldmoor-hero': String(hero.id), 'x-eldmoor-runner': runner}, body: JSON.stringify({jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name, arguments: args || {}}})}).then(r => r.json()).then(j => JSON.parse(j.result.content[0].text));
for (const t of ['status', 'chat_read', 'party_read', 'journal_read', 'look']) keep('MCP A ' + t, await mcp(A, 'run-A', t, argsFor[t]));
x = await mcp(B, 'run-A', 'journal_read', {n: 50}); keep('MCP run-A for B', x); ok(x.ok === false && x.refused, 'over MCP too: run-A cannot play B');
x = await mcp(B, 'run-A', 'recall', {n: 20}); keep('MCP run-A recalls for B', x); ok(x.ok === false && x.refused, 'run-A cannot recall B\'s memories (refused)');
x = await post('/play/call', {hero: B.id, tool: 'recall', args: {query: 'hide'}, runner: 'run-A'}); keep('run-A /play/call recall for B', x.body); ok(x.status === 409, 'nor over /play/call (409)');
x = await mcp(A, 'run-A', 'remember', {title: 'Over MCP', text: 'Tags as a list.', tags: ['mcp', 'list']}); keep('MCP A remember', x); ok(x.ok && x.remembered.tags.join() === 'mcp,list', 'MCP remember takes tags as a list');
x = await mcp(A, 'run-A', 'recall', {tag: 'mcp'}); keep('MCP A recall', x); ok(x.ok && x.notes.length === 1, 'MCP recall by tag');
const health = await (await fetch(base + '/play/health')).json(); keep('/play/health', health);
ok(health.heroes.length === 5 && !/QZX/.test(JSON.stringify(health)), '/play/health: ids, names and links only, no text');
server.close();

// ---------------------------------------------------------------- 6. memories (issue #155)
console.log('memories: tools, ranking, header, caps, the letter, the mirror, save');
const C1 = rest[1], mem = (t, a2) => keep(C1.name + ' ' + t, act(C1, t, a2));
const m1 = mem('remember', {title: 'Debt to ' + B.name, text: 'I owe ' + B.name + ' ten gold for the draught.', tags: ['debt', 'gold'], about: B.name});
ok(m1.ok && /hero/.test(m1.remembered.about) && m1.remembered.tags.join() === 'debt,gold', 'remember: a titled, tagged note about a companion');
const m2 = mem('remember', {title: 'Wolves at the ford', text: 'A pack hunts the river crossing at night.', tags: 'danger, wolves', about: ZONES[zoneAt(C1.x, C1.y)]});
mem('remember', {title: 'Plan for the crypt', text: 'Buy torches before we go down. Gold is short.', tags: ['plan']});
let rc = mem('recall', {query: 'gold'}); ok(rc.ok && rc.found === 2 && rc.notes[0].title.startsWith('Debt'), 'recall by word: a title or tag match ranks above a text match');
rc = mem('recall', {tag: 'wolves'}); ok(rc.notes.length === 1 && rc.notes[0].id === m2.remembered.id, 'recall by tag (comma-separated tags are split)');
rc = mem('recall', {about: String(B.id)}); ok(rc.notes.length === 1 && rc.notes[0].id === m1.remembered.id, 'recall by about: an id finds the note written with the name');
rc = mem('recall', {query: 'crypt torches'}); ok(rc.notes[0].title === 'Plan for the crypt', 'recall: best match first');
const id1 = m1.remembered.id;
ok(mem('update_memory', {id: id1, text: 'Paid ' + B.name + ' back in full.'}).ok && mem('recall', {id: id1}).notes[0].text.startsWith('Paid'), 'update_memory rewrites a note');
ok(mem('pin', {id: id1}).ok && mem('recall', {}).notes[0].id === id1, 'pin: a pinned note comes first');
{const br = PC.paceBrief(C1.id).brief, line = memoryNote(br);
  ok(br.memories.length >= 1 && br.memories.length <= 3 && br.memories.some(x => x.id === m2.remembered.id) && br.memories.every(x => Object.keys(x).join() === 'id,title'), `the state header lists up to 3 notes, title and id only (${br.memories.map(x => x.title).join('; ')})`);
  ok(line.includes('#' + m2.remembered.id) && !line.includes('river crossing'), 'the turn prompt line carries titles, never the text')}
ok(mem('forget', {id: m2.remembered.id}).ok && !mem('recall', {tag: 'wolves'}).notes.length && !mem('forget', {id: m2.remembered.id}).ok, 'forget removes a note for good');
ok(!mem('update_memory', {id: id1, text: ''}).ok && !mem('remember', {title: 'x'}).ok && !mem('pin', {id: 4242}).ok, 'empty text and unknown ids are refused');
// caps
NBm.NB.WRITES_PER_DAY = 1e6;
for (let i = 0; i < 205; i++) act(C1, 'remember', {title: 'Filler ' + i, text: 'f'.repeat(700), tags: ['f' + i]});
const M1 = C1.memories;
ok(M1.notes.length === NBm.NB.NOTES && M1.arch.length > 0, `cap: ${M1.notes.length} notes kept, ${M1.arch.length} archived`);
ok(M1.notes.every(n => n.text.length <= NBm.NB.LEN) && M1.notes.some(n => n.id === id1), 'notes are capped at 600 characters; the pinned note is never archived');
rc = act(C1, 'recall', {tag: 'f0'}); ok(rc.notes.length === 1 && rc.notes[0].archived, 'recall still finds an archived note, marked archived');
ok(act(C1, 'pin', {id: rc.notes[0].id}).ok && M1.notes.some(n => n.id === rc.notes[0].id) && M1.notes.length === NBm.NB.NOTES, 'pinning an archived note brings it back (the next oldest goes)');
NBm.NB.WRITES_PER_DAY = 60; M1.day.w = 60;
ok(!act(C1, 'remember', {title: 'One more', text: 'Too many.'}).ok && act(C1, 'recall', {query: 'paid'}).ok, 'writes a day are capped; recall still works');
M1.day.w = 0;
// the letter: a member's pinned "letter" outlives them; nothing else does
const D2 = rest[2], slot = D2.fellowRole;
const lt = act(D2, 'remember', {title: 'To whoever comes next', text: 'Trust the healer and keep to the river road.', tags: ['letter']});
const lp = act(D2, 'pin', {id: lt.remembered.id}); ok(lp.ok && /letter/.test(lp.note || ''), 'pin a note tagged "letter": sealed for the Fellowship');
HE.fall(D2, 'a test of the hardcore rule'); run(2);
const nh = S.agents.find(x => x.id === S.fellowship.slots[slot]);
ok(nh && nh !== D2 && nh.player, `${D2.name} fell; ${nh && nh.name} takes the place, agent-played`);
ok(act(D2, 'recall', {}).dead === true, 'the fallen hero\'s tools answer dead');
{const br = keep(nh.name + ' brief', PC.paceBrief(nh.id)).brief;
  ok(br.memories.some(x => /letter from/i.test(x.title)), 'the replacement\'s state header shows the letter');
  const all = keep(nh.name + ' recall', act(nh, 'recall', {n: 20}));
  ok(all.notes.length === 1 && all.notes[0].pinned && /river road/.test(all.notes[0].text) && all.notes[0].tags.includes('letter'), 'the replacement finds the letter, pinned, and nothing else of the fallen');
  keep(nh.name + ' recall secret', act(nh, 'recall', {tag: 'secret'}))}
// the DM's side: its notes, never a hero's
{const st = DMA.dmAct('dm_status'), dmSide = JSON.stringify([st, DMA.dmAct('fellowship_view'), DMA.dmAct('recall', {n: 20}), DMA.dmAct('recall', {query: 'hide note private others debt'}), DMA.dmAct('notes_read')]);
  ok(!['bNote', 'mateNote', 'deadNote'].some(k => dmSide.includes(SECRETS[k])) && !dmSide.includes('river road'), 'the DM\'s tools never show a hero\'s memories');
  ok(st.relevant_notes.some(x => x.title === 'The fogbound road') && dmTurnPrompt(3, st).includes('The fogbound road'), 'dm_status names the DM notes that bear on the Fellowship, and so does its turn prompt');
  const rr = DMA.dmAct('recall', {query: 'innkeeper'}); ok(rr.ok && rr.notes.some(n => n.section === 'secrets'), 'DM recall searches across sections (notes_write notes too)')}
// the mirror: Markdown for the owner, never read back
const mir = MM.memoryMirror({root: LOGS, world: 'check'}), sentM = new Map();
const flush = () => {const out = NBm.mirrorDirty(sentM); mir.write(out); for (const o of out) sentM.set(o.key, o.sig); return out};
flush();
const dirOf = h => join(LOGS, 'check', h.id + '-' + MM.slug(h.name, 30), 'memory');
const hideF = (existsSync(dirOf(B)) ? readdirSync(dirOf(B)) : []).find(f => /^\d+-what-i-hide\.md$/.test(f)) || 'none'; // B's journal entry is note 1 (#179: journal entries are memories too)
ok(existsSync(join(dirOf(B), 'MEMORY.md')) && existsSync(join(dirOf(B), hideF)), 'mirror: logs/agents/<world>/<id>-<name>/memory/ with MEMORY.md and <id>-<slug>.md');
{const f = readFileSync(join(dirOf(B), hideF), 'utf8');
  ok(/^---\nid: \d+\ntitle: "What I hide"\ntags: \["secret"\]\nabout: ".+"\nday: \d+/.test(f) && f.includes(SECRETS.bNote), 'front matter (title, tags, about, game day) and the text')}
ok(existsSync(join(LOGS, 'check', 'dm', 'memory', 'MEMORY.md')) && readdirSync(join(LOGS, 'check', 'dm', 'memory')).some(f => /the-fogbound-road/.test(f)), 'the DM\'s notes go under dm/');
ok(/Fallen/.test(readFileSync(join(dirOf(D2), 'MEMORY.md'), 'utf8')), 'a fallen hero\'s index says the notes died with them');
act(C1, 'forget', {id: id1});
{const out = flush(); ok(out.length === 1 && out[0].key === 'hero:' + C1.id && !readdirSync(dirOf(C1)).some(f => f.startsWith(id1 + '-')), 'only the changed seat is written again; a forgotten note loses its file')}
{const runners = ['agent-player.mjs', 'fellowship.mjs', 'local-agent.mjs', 'dm-agent.mjs', 'agent-sessions.mjs', 'pacing.mjs'].map(f => readFileSync(new URL('./' + f, import.meta.url), 'utf8')).join('\n');
  ok(!/memory-mirror|MEMORY\.md/.test(runners), 'no runner opens the mirror: it is never read back into a prompt')}
// save: the notebooks are character knowledge, saved with the world
{const before = JSON.stringify([C1.memories, nh.memories, S.dmAgent.notes, S.dmAgent.arch, S.fellowship.letters || {}]), cid = C1.id, nid = nh.id;
  SIM.restore(JSON.parse(JSON.stringify(SIM.snapshot())));
  const c2 = S.agents.find(x => x.id === cid), n2 = S.agents.find(x => x.id === nid);
  ok(JSON.stringify([c2.memories, n2.memories, S.dmAgent.notes, S.dmAgent.arch, S.fellowship.letters || {}]) === before, 'notebooks, archives and the DM\'s notes survive snapshot -> JSON -> restore');
  ok(P.playerAct(cid, 'recall', {tag: 'f3'}).notes.length === 1 && DMA.dmAct('recall', {tag: 'fog'}).notes.length === 1, 'recall works on the restored world')}

// ---------------------------------------------------------------- 7. the verdict
console.log('the verdict');
const L = leaks();
ok(Object.keys(SECRETS).length >= 20, `${Object.keys(SECRETS).length} secrets planted`);
ok(heard.length >= 60, `${heard.length} hero-side texts gathered (tool results, events, prompts, snapshots, relay answers)`);
ok(!L.length, L.length ? 'LEAKS: ' + L.slice(0, 12).join('; ') : 'no secret reached any hero tool result, prompt or snapshot');
ok(S.dmLog.some(e => e.detail && e.detail.voice === 'narrate' && e.detail.text === said.narr), 'the watcher still sees the narration in the DM log');

try {rmSync(LOGS, {recursive: true, force: true})} catch {}
console.log(fail ? `\n${fail} check(s) FAILED` : '\nchannelcheck: all checks passed');
process.exit(fail ? 1 : 0);
