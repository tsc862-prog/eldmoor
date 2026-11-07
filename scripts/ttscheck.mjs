// ttscheck (issue #554): the narrator voice, with no engine and no network. A mock speech server on a free port stands in for
// Kokoro-FastAPI. Checks: voices as data (deterministic, no RNG), the engine module (status, speak, hash cache, voice mapping,
// loopback only, a missing engine throws and says why), the relay routes (status, say, audio, origin, RELAY_TTS=0, /health),
// the page queue (order, no overlap, the 20 s drop, the 3x/8x mute, the Sound gate, overflow, engine down) and the line sources
// (Table frame and narration, narrate, npc_say with the person's voice, hero lines only when asked, the past never read).
// Usage: npm run ttscheck
import http from 'node:http';
import {mkdtempSync, rmSync, readdirSync, readFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ttsEngine, ttsFromEnv, ttsOff, isLoopbackUrl, clampSpeed, TTS_MAX_CHARS} from './providers/tts.mjs';
import {createRelay} from './relay.mjs';
import {makeProviders} from './providers/index.mjs';
import {pickVoice, NARRATOR, POOL, ROLE, FACTION} from '../src/data/voices.js';
import {makeVoiceQueue, scanLines, newScan, allowedAt, MAX_AGE_MS, AGE_MS, BACKLOG_S, RATE, MODE_KINDS, speechSeconds, recapOfScene, dailyRecap} from '../src/ui/sound.js';

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), 'eldmoor-tts-'));
console.log('\nEldmoor ttscheck\n');

// ---- the mock engine ----
const mock = {speech: [], down: false, status: 200, voices: ['bm_george', 'af_nicole', 'am_adam'], delay: 0};
const engine = http.createServer((req, res) => {
  if (mock.down) return req.destroy();
  if (req.url === '/v1/audio/voices') {res.writeHead(200, {'content-type': 'application/json'}); return res.end(JSON.stringify({voices: mock.voices}))}
  if (req.url === '/health') {res.writeHead(200); return res.end('{}')}
  if (req.url === '/v1/audio/speech' && req.method === 'POST') {
    const ch = []; req.on('data', c => ch.push(c)); req.on('end', () => {
      const b = JSON.parse(Buffer.concat(ch).toString()); mock.speech.push(b);
      setTimeout(() => {if (mock.status !== 200) {res.writeHead(mock.status); return res.end('{}')}
        res.writeHead(200, {'content-type': 'audio/mpeg'}); res.end(Buffer.from('ID3-mock-audio-' + b.voice + '-' + b.input))}, mock.delay);
    }); return;
  }
  res.writeHead(404); res.end();
});
await new Promise(r => engine.listen(0, '127.0.0.1', r));
const EURL = 'http://127.0.0.1:' + engine.address().port;

// ---- voices as data ----
console.log('voices as data');
{
  ok(pickVoice({kind: 'narrator'}) === NARRATOR && pickVoice() === NARRATOR, 'the narrator has one voice');
  ok(pickVoice({kind: 'npc', role: 'innkeeper'}) === ROLE.innkeeper, 'a townsfolk role has its own voice');
  const hero = {kind: 'hero', name: 'Pellora', cls: 'Cleric', sex: 'f', fac: 0};
  ok(pickVoice(hero) === pickVoice({...hero}) && POOL.includes(pickVoice(hero)), 'a hero voice is picked by hash and is stable');
  const names = ['Ann', 'Bo', 'Cy', 'Di', 'Ed', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kit', 'Lu'];
  ok(new Set(names.map(n => pickVoice({kind: 'hero', name: n, cls: 'Mage'}))).size >= 4, 'different heroes get a spread of voices');
  ok(FACTION.every((f, i) => f.includes(pickVoice({kind: 'npc', role: 'nobody', fac: i, name: 'X'}))) && pickVoice({kind: 'npc', fac: 7, name: 'Y'}) != null, 'faction people use their pool (a new faction index wraps)');
  const src = readFileSync(new URL('../src/data/voices.js', import.meta.url), 'utf8');
  ok(!/Math\.random/.test(src), 'no RNG in voice picking');
}

// ---- the engine module ----
console.log('\nengine module');
{
  ok(isLoopbackUrl('http://127.0.0.1:8880') && isLoopbackUrl('http://localhost:1') && !isLoopbackUrl('https://api.example.com') && !isLoopbackUrl('http://192.168.1.5:8880'), 'only loopback engine URLs are accepted');
  ok(ttsOff({RELAY_TTS: '0'}) && ttsOff({RELAY_TTS: 'off'}) && !ttsOff({}), 'RELAY_TTS=0 turns it off');
  const e = ttsEngine({url: EURL, dir});
  const st = await e.status();
  ok(st.ok && st.voices.length === 3 && st.engine === 'kokoro', 'status: reachable, voices listed');
  const a = await e.speak('The lair shakes.', 'af_nicole');
  ok(a.id && !a.cached && existsSync(e.file(a.id)) && mock.speech.length === 1, 'speak: one call to the engine, a file in the cache');
  ok(mock.speech[0].voice === 'af_nicole' && mock.speech[0].response_format === 'mp3' && mock.speech[0].input === 'The lair shakes.', 'the OpenAI speech shape');
  const b = await e.speak('The lair shakes.', 'af_nicole');
  ok(b.id === a.id && b.cached && mock.speech.length === 1, 'the same line and voice is served from the cache');
  const c = await e.speak('The lair shakes.', 'am_adam');
  ok(c.id !== a.id && mock.speech.length === 2, 'another voice is another clip');
  await e.speak('Say it.', 'zz_unknown');
  ok(mock.speech[mock.speech.length - 1].voice === 'bm_george', 'a voice the engine lacks falls to its first voice');
  await e.speak('x'.repeat(TTS_MAX_CHARS + 300), 'af_nicole');
  ok(mock.speech[mock.speech.length - 1].input.length === TTS_MAX_CHARS, 'long text is cut to ' + TTS_MAX_CHARS + ' characters');
  const sp = await e.speak('Faster now.', 'af_nicole', 1.15), sent = mock.speech[mock.speech.length - 1], n0 = mock.speech.length, sl = await e.speak('Faster now.', 'af_nicole'), sentSlow = mock.speech[mock.speech.length - 1];
  ok(sent.speed === 1.15 && sl.id !== sp.id && mock.speech.length === n0 + 1 && sentSlow.speed === undefined, 'a speaking rate goes to the engine and makes its own clip; rate 1 sends none');
  ok(clampSpeed(9) === 1.5 && clampSpeed(0.1) === 0.7 && clampSpeed('x') === 1 && clampSpeed(undefined) === 1 && clampSpeed(1.15) === 1.15, 'the rate is clamped to 0.7-1.5');
  mock.status = 500; let msg = ''; try {await e.speak('Fails.', 'af_nicole')} catch (x) {msg = x.message}
  ok(/HTTP 500/.test(msg) && !readdirSync(dir).some(f => f.includes('Fails')), 'an engine error throws a plain message and caches nothing'); mock.status = 200;
  mock.down = true; const s2 = await e.status();
  ok(!s2.ok && /Kokoro|speech engine/.test(s2.hint || '') && s2.voices.length === 0, 'engine missing: status says so with one hint line'); mock.down = false;
  const remote = ttsEngine({url: 'https://tts.example.com', dir}); const rs = await remote.status();
  let rmsg = ''; try {await remote.speak('Hello', 'af_nicole')} catch (x) {rmsg = x.message}
  ok(!rs.ok && /on this machine/.test(rs.error) && /on this machine/.test(rmsg), 'a non-local URL is refused: the game text never leaves the machine');
  const off = ttsEngine({url: EURL, dir, enabled: false}); ok(!(await off.status()).enabled, 'disabled engine reports off');
  const fe = ttsFromEnv({TTS_URL: EURL, TTS_FORMAT: 'wav', TTS_MODEL: 'm1'}, {dir}); await fe.speak('Wav.', 'bm_george');
  ok(mock.speech[mock.speech.length - 1].response_format === 'wav' && mock.speech[mock.speech.length - 1].model === 'm1', 'TTS_FORMAT and TTS_MODEL are read from the environment');
}

// ---- the relay routes ----
console.log('\nrelay routes');
{
  const ORIGIN = 'http://localhost:5173', lines = [];
  const eng = ttsEngine({url: EURL, dir: join(dir, 'relay')});
  const relay = createRelay({client: null, providers: makeProviders({env: {}}), limits: {}, log: m => lines.push(m), tts: eng, origin: ORIGIN});
  await new Promise(r => relay.server.listen(0, '127.0.0.1', r));
  const R = 'http://127.0.0.1:' + relay.server.address().port, H = {origin: ORIGIN, 'content-type': 'application/json'};
  const j = await (await fetch(R + '/tts/status', {headers: {origin: ORIGIN}})).json();
  ok(j.ok && j.voices.length === 3, 'GET /tts/status: ready with voices');
  const say = await fetch(R + '/tts/say', {method: 'POST', headers: H, body: JSON.stringify({text: 'A hail from the gate.', voice: 'af_nicole'})});
  const sj = await say.json();
  ok(say.status === 200 && /^[0-9a-f]{24}$/.test(sj.id) && say.headers.get('access-control-allow-origin') === ORIGIN, 'POST /tts/say: an id, CORS for the page only');
  const au = await fetch(R + '/tts?id=' + sj.id);
  ok(au.status === 200 && au.headers.get('content-type') === 'audio/mpeg' && (await au.text()).startsWith('ID3-mock-audio-af_nicole'), 'GET /tts?id=: the clip');
  ok((await fetch(R + '/tts?id=../../etc/passwd')).status === 404 && (await fetch(R + '/tts?id=' + '0'.repeat(24))).status === 404, 'a bad or unknown id is a 404 (no path escape)');
  ok((await fetch(R + '/tts/say', {method: 'POST', headers: H, body: '{"text":""}'})).status === 400, 'empty text is refused');
  ok((await fetch(R + '/tts/status', {headers: {origin: 'http://evil.example'}})).status === 403, 'another origin is refused');
  const health = await (await fetch(R + '/health')).json();
  ok(health.providers && health.providers.tts && health.providers.tts.ready === true && health.providers.tts.voices.length === 3, '/health lists providers.tts (engine, voices, ready)');
  mock.down = true;
  const bad = await fetch(R + '/tts/say', {method: 'POST', headers: H, body: JSON.stringify({text: 'Nobody home.', voice: 'af_nicole'})}); const bj = await bad.json();
  ok(bad.status === 503 && /speech engine/.test(bj.hint || ''), 'engine missing: 503 with the hint, the relay keeps running');
  ok((await (await fetch(R + '/health')).json()).providers.tts.ready === false, '/health: ready false, nothing else breaks'); mock.down = false;
  relay.server.close();
  const r0 = createRelay({client: null, providers: makeProviders({env: {}}), limits: {}, log: () => {}, tts: null});
  await new Promise(r => r0.server.listen(0, '127.0.0.1', r));
  ok((await fetch('http://127.0.0.1:' + r0.server.address().port + '/tts/status')).status === 404, 'RELAY_TTS=0 (no engine): the routes do not exist');
  r0.server.close();
}

// ---- the page queue ----
console.log('\npage queue');
{
  let clock = 1000; const now = () => clock;
  const spoken = [], playing = {n: 0, max: 0}; let gateOn = true, speed = 1;
  const rel = []; // play() resolvers, so a test decides when a clip ends
  const q = makeVoiceQueue({now, speed: () => speed, gate: () => gateOn, speak: async L => {spoken.push(L.id); return 'u:' + L.id},
    play: u => new Promise(r => {playing.n++; playing.max = Math.max(playing.max, playing.n); rel.push(() => {playing.n--; r()})})});
  const end = async () => {await sleep(5); const r = rel.shift(); if (r) r(); await sleep(5)};
  q.push({id: 'a', text: 'a', kind: 'narrate'}); await sleep(5);
  q.push({id: 'h', text: 'h', kind: 'hero'}); q.push({id: 'n', text: 'n', kind: 'narrate'}); q.push({id: 'p', text: 'p', kind: 'npc'}); q.push({id: 't', text: 't', kind: 'table'});
  for (let i = 0; i < 5; i++) await end();
  ok(q.stats.order.join('') === 'atpnh', 'order: the playing line finishes, then table, npc, narrate, hero (got ' + q.stats.order.join('') + ')');
  ok(playing.max === 1, 'never two clips at once');
  q.push({id: 's1', text: 's', kind: 'narrate'}); await sleep(5); // starts playing
  q.push({id: 'old', text: 'old', kind: 'narrate'}); clock += MAX_AGE_MS + 1; q.push({id: 'fresh', text: 'f', kind: 'narrate'});
  await end(); await end();
  ok(!q.stats.order.includes('old') && q.stats.order.includes('fresh') && q.stats.dropped >= 1, 'a line older than ' + MAX_AGE_MS / 1000 + ' s is dropped unplayed');
  speed = 3; const before = q.stats.played;
  q.push({id: 'm1', text: 'm', kind: 'narrate'}); q.push({id: 'm2', text: 'm', kind: 'npc'}); q.push({id: 'm3', text: 'm', kind: 'hero'}); q.push({id: 'm4', text: 'm', kind: 'table'});
  await end(); await end();
  ok(q.stats.order.slice(before).join('') === 'm4' && allowedAt('table', 8) && !allowedAt('narrate', 8) && allowedAt('narrate', 1), 'at 3x/8x only Table scenes are heard'); speed = 1;
  gateOn = false; const d0 = q.stats.dropped;
  ok(q.push({id: 'g', text: 'g', kind: 'table'}) === false && q.stats.dropped === d0 + 1, 'Sound off: nothing is queued'); gateOn = true;
  const spokenBefore = spoken.length;
  for (let i = 0; i < 12; i++) q.push({id: 'o' + i, text: 'o', kind: i < 3 ? 'npc' : 'hero', who: 'w' + i});
  ok(q.size <= 8, 'the queue is capped (' + q.size + ')');
  while (q.size || q.busy) await end();
  ok(q.stats.order.filter(x => /^o[012]$/.test(x)).length === 3, 'overflow drops the lightest lines first (the npc lines survive)');
  let down = 0; const q2 = makeVoiceQueue({now, gate: () => true, speak: async () => null, play: async () => {}, onDown: () => {down++}});
  q2.push({id: 'x', text: 'x', kind: 'table'}); q2.push({id: 'y', text: 'y', kind: 'table'}); await sleep(10);
  ok(down === 1 && q2.size === 0 && q2.stats.played === 0, 'engine down: the queue empties and the page is told once');
}

// ---- the line sources ----
console.log('\nline sources');
{
  const St = {dmLog: [{id: 5, kind: 'agent', detail: {voice: 'narrate', text: 'Old news.'}}], table: null, npcs: [{id: 77, role: 'innkeeper', fac: 0, name: 'Marta'}], agents: []};
  const st = newScan();
  ok(scanLines(St, st).length === 0, 'the first scan reads nothing aloud (a loaded world keeps its past)');
  St.dmLog.unshift({id: 6, kind: 'agent', detail: {voice: 'narrate', text: 'Rain on the road.'}});
  St.dmLog.unshift({id: 7, kind: 'agent', detail: {voice: 'npc_say', npc: 77, text: 'Welcome, travellers.'}});
  St.dmLog.unshift({id: 8, kind: 'lever', detail: {text: 'secret reason', voice: 'narrate'}});
  const l1 = scanLines(St, st);
  ok(l1.length === 2 && l1[0].kind === 'narrate' && l1[0].voice === NARRATOR && l1[1].kind === 'npc' && l1[1].voice === ROLE.innkeeper, 'narrate in the open world and npc_say in the person\'s voice, oldest first; lever notes never');
  ok(scanLines(St, st).length === 0, 'a line is read once');
  St.table = {id: 3, frame: ['The ', {kind: 'hero', name: 'Fena'}, ' stands at the crypt door.'], narr: null};
  St.dmLog.unshift({id: 9, kind: 'agent', detail: {voice: 'narrate', text: 'The door breathes.'}});
  const l2 = scanLines(St, st);
  ok(l2.length === 2 && l2[0].kind === 'table' && l2[0].text === 'The Fena stands at the crypt door.' && l2[1].kind === 'table', 'a Table scene: its frame, and narrate while at the table, both rank as Table');
  St.table.narr = {t: '10:00', text: 'The door breathes.'};
  ok(scanLines(St, st).length === 0, 'the same narration on the banner is not read twice');
  St.table.narr = {t: '10:05', text: 'Something answers from below.'};
  ok(scanLines(St, st).length === 1, 'new banner narration is read');
  St.agents = [{id: 1, player: true, name: 'Fena', cls: 'Ranger', fac: 0, bubble: {text: 'Hold the line!'}}, {id: 2, name: 'Bg', bubble: {text: 'scripted'}}];
  const st3 = newScan(); scanLines({...St, agents: []}, st3); const l3 = scanLines(St, st3);
  ok(l3.length === 1 && l3[0].kind === 'hero' && l3[0].voice === pickVoice({kind: 'hero', name: 'Fena', cls: 'Ranger', fac: 0}), '"Heroes speak" is on by default: only agent-played heroes, in their own picked voice');
  const stOff = newScan(); scanLines({...St, agents: []}, stOff); ok(scanLines(St, stOff, {heroes: false}).length === 0, 'Heroes speak off: silent');
}

// ---- keeping up (#1015) ----
console.log('\nkeeping up');
{
  let clock = 1000; const now = () => clock, rel = []; let mode = 'all';
  const mk = (extra = {}) => makeVoiceQueue({now, kinds: () => MODE_KINDS[mode], speak: async L => 'u:' + L.id, play: () => new Promise(r => rel.push(r)), ...extra});
  const end = async () => {await sleep(5); const r = rel.shift(); if (r) r(); await sleep(5)};
  const q = mk();
  q.push({id: 'busy', text: 'The narrator speaks.', kind: 'narrate'}); await sleep(5);
  q.push({id: 'h1', text: 'First thought.', kind: 'hero', who: 'ann'}); q.push({id: 'h2', text: 'Second thought.', kind: 'hero', who: 'ann'}); q.push({id: 'b1', text: 'Other hero.', kind: 'hero', who: 'bo'});
  ok(q.size === 2 && q.stats.replaced === 1, 'in the world a newer line of the same speaker replaces the queued one');
  q.push({id: 'long1', text: 'x'.repeat(120), kind: 'npc', who: 'n1'}); q.push({id: 'long2', text: 'y'.repeat(120), kind: 'npc', who: 'n2'});
  ok(q.size <= 3 && speechSeconds('x'.repeat(120)) > 6, 'world speech waiting is capped at about ' + BACKLOG_S + ' s (the oldest goes first); queued ' + q.size);
  for (let i = 0; i < 8; i++) await end();
  ok(!q.stats.order.includes('h1'), 'the replaced hero line is never spoken');
  // table lines wait in full and in order, past the world's age limit
  const q2 = mk();
  q2.push({id: 'play', text: 'Playing.', kind: 'table'}); await sleep(5);
  for (let i = 0; i < 5; i++) q2.push({id: 't' + i, text: 'A table line number ' + i + '.', kind: 'table', who: 'ann'});
  clock += AGE_MS.hero + 5000; // longer than any world line may wait
  for (let i = 0; i < 7; i++) await end();
  ok(q2.stats.order.join(',') === 'play,t0,t1,t2,t3,t4', 'Table lines are spoken in full and in order even after ' + (AGE_MS.hero / 1000 + 5) + ' s (got ' + q2.stats.order.join(',') + ')');
  const q3 = mk(); q3.push({id: 'c', text: 'Cur.', kind: 'table'}); await sleep(5); q3.push({id: 'w', text: 'World line.', kind: 'npc', who: 'z'}); q3.push({id: 'r', text: 'Recap line.', kind: 'recap'});
  clock += AGE_MS.npc + 1; await end(); await end(); await end();
  ok(q3.stats.order.join(',') === 'c,r', 'a stale world line is dropped, a recap (90 s) is not');
  // modes
  mode = 'recaps'; const q4 = mk(); ok(q4.push({id: 'a', text: 'a', kind: 'hero'}) === false && q4.push({id: 'b', text: 'b', kind: 'table'}) === false && q4.push({id: 'c', text: 'c', kind: 'recap'}) === true, 'recaps only: heroes and table lines are not queued, a recap is');
  mode = 'scenes'; const q5 = mk(); ok(q5.push({id: 'a', text: 'a', kind: 'npc'}) === false && q5.push({id: 'b', text: 'b', kind: 'table'}) === true, 'scenes: Table lines and recaps only'); mode = 'all';
  ok(allowedAt('recap', 8) && allowedAt('table', 8) && !allowedAt('hero', 3), 'at 3x/8x recaps and Table lines are still heard');
  ok(q.stats.spokenS.narrate > 0 && q.stats.seenS.hero >= (q.stats.spokenS.hero || 0), 'seconds offered and spoken are counted per kind (to measure against the game hour)');
}

// ---- recaps (#1015) ----
console.log('\nrecaps');
{
  const base = {dmLog: [], table: null, npcs: [], agents: [{id: 1, player: true, name: 'Fena', cls: 'Ranger', sex: 'f', fac: 0, bubble: null}], gameMin: 3 * 1440 + 5 * 60};
  const C = {name: 'The Ashen Five', log: [
    {id: 3, gameMin: base.gameMin - 600, kind: 'table', parts: [{t: 'Crypt door'}, ': Fena says hold; Orin says press. They go in. The foe is down.']},
    {id: 2, gameMin: base.gameMin - 300, kind: 'camp', parts: ['Camp was made.']},
    {id: 1, gameMin: base.gameMin - 100, kind: 'level', parts: [{kind: 'hero', name: 'Fena'}, ' reached level 7.']},
    {id: 0, gameMin: base.gameMin - 3000, kind: 'death', parts: ['Long ago.']}]};
  const st = newScan();
  ok(scanLines(base, st, {company: C}).length === 0, 'the first scan reads no recap (a loaded world keeps its past)');
  base.gameMin += 30; ok(scanLines(base, st, {company: C}).length === 0, 'no daily recap before 06:00');
  base.gameMin += 120; // 07:30
  const d = scanLines(base, st, {company: C});
  ok(d.length === 1 && d[0].kind === 'recap' && d[0].voice === NARRATOR && /^Day 4, at first light\. The Ashen Five/.test(d[0].text) && /Fena reached level 7/.test(d[0].text) && !/Camp was made|Long ago/.test(d[0].text), 'once a game day at dawn: the last day from the campaign log, the narrator, no camp noise, nothing older than a day (' + (d[0] && d[0].text.slice(0, 90)) + ')');
  base.gameMin += 60; ok(scanLines(base, st, {company: C}).length === 0, 'only once a day');
  base.gameMin += 1440; ok(scanLines(base, st, {company: C}).length === 0, 'a day with nothing to tell says nothing');
  // a scene: a hero's line in the hero's voice, then a recap when it closes
  const sc = {id: 9, title: 'The ford ambush', frame: ['Wolves at the ford.'], narr: null, summary: '', beats: [{id: 1, name: 'Fena', k: 'attack', text: 'Strike', line: 'Hold the ford!', by: 'agent'}, {id: 0, name: 'Wolf', k: 'attack', text: 'Bite', by: 'foe'}]};
  const stS = newScan(); scanLines({...base, table: null}, stS);
  const withScene = {...base, table: sc};
  const l = scanLines(withScene, stS);
  ok(l.length === 2 && l[0].text === 'Hold the ford!' && l[0].kind === 'table' && l[0].voice === pickVoice({kind: 'hero', name: 'Fena', cls: 'Ranger', sex: 'f', fac: 0}) && l[1].text === 'Wolves at the ford.', 'a hero line at the table is spoken in that hero\'s voice, before the frame (got ' + l.map(x => x.text).join(' | ') + ')');
  sc.beats.push({id: 1, name: 'Fena', k: 'attack', text: 'Strike', line: 'Again!', by: 'agent'});
  ok(scanLines(withScene, stS).map(x => x.text).join() === 'Again!', 'new table lines come in order, each once');
  sc.summary = 'The wolves break and run. Nobody fell. It was a close thing, all told.';
  ok(scanLines(withScene, stS).length === 0, 'the outcome is not a line of its own while the scene is open');
  const r = scanLines({...base, table: null}, stS);
  ok(r.length === 1 && r[0].kind === 'recap' && r[0].voice === NARRATOR && r[0].text === 'At the table, The ford ambush. The wolves break and run. Nobody fell.', 'when the scene closes: a two-sentence recap in the narrator voice (got ' + (r[0] && r[0].text) + ')');
  ok(scanLines({...base, table: null}, stS).length === 0, 'the recap is said once');
  ok(recapOfScene({title: ['The ', {kind: 'hero', name: 'Fena'}, ' stands'], summary: 'It ends.'}) === 'At the table, The Fena stands. It ends.', 'a recap title may carry hero parts');
  const src = readFileSync(new URL('../src/ui/sound.js', import.meta.url), 'utf8');
  ok(!/Math\.random/.test(src) && !/anthropic|openai|api\.|\/decide\b(?!'\))/i.test(src.replace(/String\(CFG\.url\)\.replace\([^)]*\)/, '')), 'recaps cost nothing: no model call, no RNG, nothing but the relay\'s /tts routes');
}

engine.close(); rmSync(dir, {recursive: true, force: true});
console.log(fail ? `\n${fail} FAILED` : '\nttscheck passed');
process.exit(fail ? 1 : 0);
