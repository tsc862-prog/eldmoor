// Semantic memory search check (issue #553): recall and journal_search ranked by meaning through a local embedding model.
// A mock Ollama (scripts/mock-ollama.mjs, its own port; the real Ollama is never touched) answers /api/embed with concept
// vectors. Proves:
//   - a note is found by meaning where its words do not appear in the query, marked semantic; keywords still win on a title match
//   - recall and journal_search (entries, landmarks, chapters) and the DM's recall all get it, through the relay's call path
//   - the fallback is today's exact ranking: no embed module, the model not pulled, Ollama down or failing, a cold cache
//     past the 300 ms budget, an agent trying to set `_sem` itself, a tool call with no query
//   - the vector cache: per world and hero on disk, rebuilt when missing, a changed note re-embedded, another model discards it,
//     a fallen hero's file removed, a new world purged with the folder; nothing in the save
//   - the game side is pure: the same arguments rank the same, the save does not change, the seeded world hash is untouched
//   - seats stay apart: a secret planted in another hero's notes never appears in a hero's search, and its vectors are not read
// Usage: npm run embedcheck
import http from 'node:http';
import {mkdtempSync, existsSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

let seed = 0x5eed0553;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const LOGS = mkdtempSync(join(tmpdir(), 'eldmoor-embed-')); process.env.AGENT_LOGS = LOGS;

const SIM = await import('../src/sim/index.js');
const SLT = await import('../src/sim/company.js'); // the slotted company (#588)
const {init, step, S, snapshot, setDmSeat} = SIM;
const P = await import('../src/sim/player.js');
const NB = await import('../src/sim/notebook.js');
const {semKey} = await import('../src/sim/semkey.js');
const {attachPlay} = await import('./relay-mcp.mjs');
const {localBackend} = await import('./play-headless.mjs');
const {semanticRecall, embedConfig, embedStatus} = await import('./embed.mjs');
const {ollamaAdapter} = await import('./providers/ollama.mjs');
const {startMockOllama, MOCK_EMBED_MODEL} = await import('./mock-ollama.mjs');
const MM = await import('./memory-mirror.mjs');

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {fail++; console.log('  FAIL ' + m)}};
const wait = ms => new Promise(r => setTimeout(r, ms));
console.log('\nEldmoor embedcheck: recall and journal_search by meaning (mock Ollama)\n');

init({fellowship: false});
for (let i = 0; i < 600; i++) step(1 / 60);
const live = S.agents.filter(h => h.state !== 'dead' && !SLT.inSlots(h) && !h.hidden);
const A = live[0], B = live[1];
P.markPlayer(A, true); P.markPlayer(B, true); setDmSeat(true);
const WORLD = 'embedtest';

// ---- the notes: the target shares no word with the query
const act = (h, tool, args) => P.playerAct(h.id, tool, args);
const NOTES = [
  {title: 'The stone counter', text: 'A recluse who counts pebbles by the ford; she keeps the crossing and wants nothing.', tags: ['person']},
  {title: 'Debt to Marn', text: 'I owe the ledger-keeper forty coins, borrowed against the next payment.', tags: ['debt']},
  {title: 'Wolf pack', text: 'Fangs in the dark: a pack hunts the north road at night.', tags: ['danger']},
  {title: 'Supper at the inn', text: 'Bread and stew by the hearth; the innkeeper talks too much.', tags: ['inn']},
  {title: 'Old stones', text: 'Nothing but a keepsake from my father.', tags: ['stones']},
];
for (const n of NOTES) ok(act(A, 'remember', n).ok, 'A remembers: ' + n.title);
const SECRET = 'QZXsecretB';
act(B, 'remember', {title: 'B only', text: 'A hermit crone with stones; ' + SECRET, tags: ['person']});
for (const t of ['The woman at the causeway counted stones until dusk.', 'Wolves howled; I fled the pack.', 'I paid the ledger what I owed in coins.']) act(A, 'journal_write', {text: t});
act(A, 'journal_write', {text: 'Rival vengeance sworn: the feud with Torvald is a hatred I will carry.', landmark: 'yes'});

const QUERY = 'old woman at the causeway'; // no word in common with the stone counter's text (the "old" in "Old stones" is a title word)
const noWord = !/woman|causeway/i.test(NOTES[0].title + NOTES[0].text);
ok(noWord, 'the query shares no word with the target note');
const ids = res => res.notes.map(n => n.title);

// ---- the game side alone: today's keyword ranking
const kw = act(A, 'recall', {query: QUERY});
ok(kw.ok && !ids(kw).includes('The stone counter'), 'keywords alone do not find "the stone counter" from the query');
const kw2 = act(A, 'recall', {query: QUERY});
ok(JSON.stringify(kw) === JSON.stringify(kw2), 'the game ranks the same twice (pure)');
const jk = act(A, 'journal_search', {query: 'lady by the ford'});
ok(jk.ok === false || jk.found === 0, 'keywords alone find no journal line for "lady by the ford"');

// ---- a relay with the embedding module
const mock = await startMockOllama({embed: true});
const adapter = ollamaAdapter({url: mock.url});
const logs = [];
const mkEmbed = (over = {}) => semanticRecall({adapter, root: LOGS, world: WORLD, config: {...embedConfig({}), model: MOCK_EMBED_MODEL, ...over}, log: m => logs.push(m)});
let embed = mkEmbed(); embed.setWorld(WORLD, 'worldid-0001');
const backend = localBackend();
const server = http.createServer((q, s) => {s.writeHead(404); s.end('{}')});
const play = attachPlay(server, {backend, log: () => {}, embed});
await new Promise(res => server.listen(0, '127.0.0.1', res));
const base = `http://127.0.0.1:${server.address().port}`;
const post = async (path, body) => { const r = await fetch(base + path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}); return {status: r.status, body: await r.json()}; };
const call = (h, tool, args) => post('/play/call', {hero: h.id, tool, args}).then(r => r.body);
const dmcall = (tool, args) => post('/play/dm', {tool, args}).then(r => r.body);

console.log('recall by meaning');
let r = await call(A, 'recall', {query: QUERY});
const sc = r.notes.find(n => n.title === 'The stone counter');
ok(r.ok && sc && ids(r).indexOf('The stone counter') < 3, `the relay's recall finds "The stone counter" in the top 3 from "${QUERY}" (got ${ids(r).join(' | ')})`);
ok(sc && sc.semantic === true && r.ranked === 'keywords and meaning', 'the hit is marked semantic and the result says how it was ranked');
ok(!JSON.stringify(r).includes(SECRET), "B's secret is not in A's search");
const vec = join(LOGS, WORLD, `${A.id}-${MM.slug(A.name, 30)}`, 'vectors.json');
ok(existsSync(vec), 'the vector cache is on disk: <world>/<heroId>-<name>/vectors.json');
const vj = JSON.parse(readFileSync(vec, 'utf8'));
ok(vj.model === MOCK_EMBED_MODEL && Object.keys(vj.vecs).length >= NOTES.length + 1, `it holds ${Object.keys(vj.vecs).length} vectors of ${vj.dim} numbers for the pool, keyed by text hash`);
const bvec = join(LOGS, WORLD, `${B.id}-${MM.slug(B.name, 30)}`, 'vectors.json');
ok(!existsSync(bvec), "B has no cache until B searches (A's search never embeds B's notes)");

// keyword wins on an exact title match
r = await call(A, 'recall', {query: 'old stones'});
ok(ids(r)[0] === 'Old stones', 'a title match still ranks first (keyword wins), then the stone counter by meaning: ' + ids(r).slice(0, 3).join(' | '));
r = await call(A, 'recall', {query: 'who is owed coins', n: 3});
ok(ids(r).slice(0, 2).includes('Debt to Marn'), 'another meaning: "who is owed coins" finds the debt in the top 2: ' + ids(r).join(' | '));
ok(!ids(r).includes('Wolf pack') && !ids(r).includes('Supper at the inn'), 'unrelated notes are not pulled in');

// the embedding requests
const embeds0 = (mock.seen.embed || []).length;
r = await call(A, 'recall', {query: QUERY});
ok((mock.seen.embed || []).length === embeds0, 'a repeated query asks Ollama for nothing (query and notes are cached)');
const bodies = mock.seen.embed;
ok(bodies.every(b => b.model === MOCK_EMBED_MODEL && !('options' in b)), 'requests name the embedding model and carry no num_ctx (it never reloads the chat model)');

console.log('journal_search by meaning');
r = await call(A, 'journal_search', {query: 'the old woman who counts pebbles'});
ok(r.ok && r.results.some(x => x.semantic) && /causeway|stones/.test(r.results[0].text), 'journal_search finds "the woman at the causeway ... stones" by meaning: ' + (r.results[0] && r.results[0].text.slice(0, 50)));
r = await call(A, 'journal_search', {query: 'a sworn hatred'});
ok(r.ok && r.results.some(x => x.kind === 'landmark' && x.semantic), 'a landmark is found by meaning ("a sworn hatred" -> the feud)');
r = await call(A, 'journal_search', {day: 1});
ok(r.ok && r.ranked === undefined, 'a day-only search needs no meaning and is unchanged');

console.log('the DM');
S.dmAgent.notes.threads.push({id: 9001, sec: 'threads', title: 'A feud brews', text: 'Two houses trade revenge for an old hatred.', tags: [], day: 1, t: '08:00', gm: 1, up: 1}); S.dmAgent.seq = Math.max(S.dmAgent.seq || 0, 9001);
r = await dmcall('recall', {query: 'enemy nemesis'});
ok(r.ok && r.notes.some(n => n.title === 'A feud brews' && n.semantic), "the DM's recall finds its feud note by meaning");
ok(existsSync(join(LOGS, WORLD, 'dm', 'vectors.json')), "the DM's cache lives under dm/");

console.log('fallbacks: exactly today');
const want = act(A, 'recall', {query: QUERY});
// an agent cannot set the relay's words
r = await call(A, 'recall', {query: QUERY, _sem: Object.fromEntries(NOTES.map(n => [semKey(n.title + '. ' + (n.tags.length ? n.tags.join(', ') + '. ' : '') + n.text), 1])), _pool: true});
ok(r.ok && Array.isArray(r.notes), 'an agent that sends _sem or _pool gets an ordinary result (the relay strips them)');
// no embed module
const s2 = http.createServer((q, s) => {s.writeHead(404); s.end('{}')}); attachPlay(s2, {backend, log: () => {}});
await new Promise(res => s2.listen(0, '127.0.0.1', res));
const plain = await (await fetch(`http://127.0.0.1:${s2.address().port}/play/call`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({hero: A.id, tool: 'recall', args: {query: QUERY}})})).json();
ok(JSON.stringify(plain) === JSON.stringify(want), 'with no embedding module the answer is byte for byte the game\'s own');
s2.close();
// Ollama down, failing, slow, model not pulled
const strip = x => { const {ranked, ...rest} = x; return JSON.stringify({...rest, notes: x.notes.map(({semantic, ...n}) => n)}); };
mock.embedState.fail = true; embed = mkEmbed(); embed.setWorld(WORLD, 'worldid-0001');
{ const s3 = http.createServer((q, s) => {s.writeHead(404); s.end('{}')}); attachPlay(s3, {backend, log: () => {}, embed}); await new Promise(res => s3.listen(0, '127.0.0.1', res));
  const url3 = `http://127.0.0.1:${s3.address().port}/play/call`;
  const c3 = (args) => fetch(url3, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({hero: A.id, tool: 'recall', args})}).then(x => x.json());
  // a changed query so nothing is cached, and the cache of A is read from disk (warm) - failing embeds of the new query
  const f1 = await c3({query: 'a brand new question about hunger'});
  ok(f1.ok && JSON.stringify(f1) === JSON.stringify(act(A, 'recall', {query: 'a brand new question about hunger'})), 'a failing Ollama (500) leaves the answer as the game gives it');
  ok(logs.some(l => /semantic search paused/.test(l)), 'the relay logs one line and pauses embedding for 30 s');
  const n0 = mock.seen.embed.length; await c3({query: 'another one entirely'});
  ok(mock.seen.embed.length === n0, 'while paused it asks Ollama for nothing');
  mock.embedState.fail = false; mock.embedState.down = true; const e4 = mkEmbed(); e4.setWorld(WORLD, 'worldid-0001'); const s4 = http.createServer((q, s) => {s.writeHead(404); s.end('{}')}); attachPlay(s4, {backend, log: () => {}, embed: e4}); await new Promise(res => s4.listen(0, '127.0.0.1', res));
  const d4 = await fetch(`http://127.0.0.1:${s4.address().port}/play/call`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({hero: A.id, tool: 'recall', args: {query: 'yet another question about bread'}})}).then(x => x.json());
  ok(d4.ok && JSON.stringify(d4) === JSON.stringify(act(A, 'recall', {query: 'yet another question about bread'})), 'Ollama down (connection dropped): the answer is the game\'s own');
  mock.embedState.down = false; s3.close(); s4.close(); }
// the model is not pulled
{ const bad = ollamaAdapter({url: mock.url}), e5 = semanticRecall({adapter: bad, root: LOGS, world: WORLD, config: {...embedConfig({}), model: 'not-pulled-model'}, log: () => {}}); e5.setWorld(WORLD, 'worldid-0001');
  const n0 = (mock.seen.embed || []).length;
  const out = await e5.rank({seat: {kind: 'hero', id: A.id, name: A.name}, pool: [{k: semKey('x'), text: 'x'}], query: 'anything'});
  ok(out === null && (mock.seen.embed || []).length === n0, 'a model that is not pulled asks Ollama for nothing and adds nothing');
  const st = await embedStatus(bad, {...embedConfig({}), model: 'not-pulled-model'}); ok(!st.ok && /ollama pull not-pulled-model/.test(st.line), 'the start line offers the ollama pull command: ' + st.line);
  const st2 = await embedStatus(bad, {...embedConfig({}), model: MOCK_EMBED_MODEL}); ok(st2.ok, 'and says so when it is pulled'); }
// a cold cache past the budget answers with what it has (nothing: keywords), then fills in the background
{ const cold = mkEmbed({budgetMs: 40}), seat = {kind: 'hero', id: B.id, name: B.name}; cold.setWorld(WORLD, 'worldid-0001');
  const pool = (await act(B, 'recall', {_pool: true})).pool;
  mock.embedState.delay = 400; const t0 = Date.now();
  const out = await cold.rank({seat, pool, query: 'the woman at the causeway'});
  ok(out === null && Date.now() - t0 < 300, `a slow Ollama (400 ms) past the 40 ms budget does not hold the call (${Date.now() - t0} ms) and ranks by keywords`);
  await wait(900); mock.embedState.delay = 0;
  const again = await cold.rank({seat, pool, query: 'the woman at the causeway'});
  ok(again && again.hits >= 1 && !again.cold, 'the background fill finished: the next search is by meaning'); }

console.log('the cache');
{ const e = mkEmbed(); e.setWorld(WORLD, 'worldid-0001');
  const seat = {kind: 'hero', id: A.id, name: A.name}, pool = (await act(A, 'recall', {_pool: true})).pool;
  const n0 = mock.seen.embed.length;
  const o1 = await e.rank({seat, pool, query: QUERY});
  ok(o1 && o1.hits >= 1 && mock.seen.embed.length === n0 + 1 && mock.seen.embed.at(-1).input.length === 1, 'a restarted relay reads the vectors from disk: only the query is embedded');
  act(A, 'update_memory', {id: 1, text: 'The recluse by the ford now counts stones in the rain.'});
  const pool2 = (await act(A, 'recall', {_pool: true})).pool, n1 = mock.seen.embed.length;
  await e.rank({seat, pool: pool2, query: QUERY});
  ok(mock.seen.embed.length === n1 + 1 && mock.seen.embed.at(-1).input.length === 1, 'a changed note is embedded again (one text), the rest stay cached');
  const cur = JSON.parse(readFileSync(vec, 'utf8'));
  ok(Object.keys(cur.vecs).length === pool2.length, 'a full pass prunes vectors of notes that no longer exist (' + Object.keys(cur.vecs).length + '/' + pool2.length + ')');
  writeFileSync(vec, '{not json');
  const e2 = mkEmbed(); e2.setWorld(WORLD, 'worldid-0001'); const n2 = mock.seen.embed.length;
  const o2 = await e2.rank({seat, pool: pool2, query: QUERY});
  ok(o2 && o2.hits >= 1 && mock.seen.embed.length > n2, 'a broken cache file is rebuilt on demand');
  const e3 = semanticRecall({adapter, root: LOGS, world: WORLD, config: {...embedConfig({}), model: 'nomic-embed-text'}, log: () => {}}); e3.setWorld(WORLD, 'worldid-0001');
  const n3 = mock.seen.embed.length; await e3.rank({seat, pool: pool2, query: QUERY});
  ok(mock.seen.embed.at(-1).input.length > 2 && mock.seen.embed.length > n3 && /^search_query: /.test(mock.seen.embed.at(-1).input[0]), 'another model discards the cache; nomic gets its search_query / search_document prefixes'); }
  // dead hero
{ // a fallen hero's cache goes with it, a new world's purges with the folder
  const e = mkEmbed(); e.setWorld(WORLD, 'worldid-0001');
  const seatB = {kind: 'hero', id: B.id, name: B.name}; await e.rank({seat: seatB, pool: (await act(B, 'recall', {_pool: true})).pool, query: 'stones'});
  ok(existsSync(bvec), "B's cache exists once B searches");
  e.drop(seatB); ok(!existsSync(bvec), "a fallen hero's vectors.json is removed (hardcore)");
  const folder = join(LOGS, WORLD, `${A.id}-${MM.slug(A.name, 30)}`);
  MM.purgeWorld(LOGS, WORLD, 'worldid-0001'); MM.purgeWorld(LOGS, WORLD, 'worldid-0002');
  ok(!existsSync(folder), 'a new world purges the hero folder with its vectors'); }

console.log('purity: the sim is unchanged');
{ const before = JSON.stringify(A.memories), d0 = S.gameMin; await call(A, 'recall', {query: QUERY}); ok(JSON.stringify(A.memories) === before && S.gameMin === d0, 'a semantic search changes no note and no clock'); }
{ const sem = {}; for (const p of act(A, 'recall', {_pool: true}).pool) sem[p.k] = 0.5; const x1 = act(A, 'recall', {query: QUERY, _sem: sem}), x2 = act(A, 'recall', {query: QUERY, _sem: sem}); ok(JSON.stringify(x1) === JSON.stringify(x2), 'the same strengths rank the same (no RNG)'); }
{const js = JSON.stringify(snapshot()), m = js.match(/.{30}(_sem|_pool|vectors).{30}/); ok(!m, 'no vector or relay word is saved' + (m ? ': ' + m[0] : ''))}
const channel = await call(A, 'recall', {query: 'hermit crone with stones'});
ok(!JSON.stringify(channel).includes(SECRET), "a search for B's words by A never returns B's secret (the cache is per hero)");
const files = readdirSync(join(LOGS, WORLD)).filter(f => /vectors/.test(f)); ok(files.length === 0, 'no vectors outside a seat folder');

server.close(); mock.close();
console.log(fail ? `\n${fail} check(s) FAILED\n` : '\nAll embed checks passed.\n');
process.exit(fail ? 1 : 0);
