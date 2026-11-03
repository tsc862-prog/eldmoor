// A mock Ollama server for tests (scripts/localcheck.mjs, scripts/runnercheck.mjs): no Ollama and no
// model needed. Models: mock-tools (tool calling), mock-json (no tool support: 400 on tools), mock-text
// (writes calls as text), mock-lazy (plays like mock-tools for three turns, then only narrates a long-over
// fight, never calling a tool: the owner's live bug, issue #126), mock-zh (answers in Chinese), mock-fumble
// (issue #163: writes `(scene_act(press, "..."))`, the option unquoted, as text under a "CallCheck" label and then really calls
// wait; a structured `format` request gets the same written call instead of JSON), mock-intro (introduces
// itself to the party with party_say every turn, then waits: the owner's screenshot), mock-loop (Ollama aborts every
// generation: "token repeat limit reached", issue #221), mock-loop1 (aborts every call at the play temperature;
// the cooler retry at 0.4 plays like mock-tools), mock-slow (the start gate's warm-up call, issue #222, answers after WARM_SLOW_MS,
// then plays like mock-tools), mock-down (every call fails: a crashed warm-up), mock-busy (issue #515: every tool-loop call takes
// BUSY_MS, look, status, rest, wait, so a member is nearly always mid-turn; a scene answer (format with option) comes in SCENE_MS
// with press or the first option). Each turn it plays status,
// rest 20, a bad tool (fly), wait 20, then narrates.
// startMockOllama() -> {url, seen (every /api/chat body; seen.final counts closing calls), close()}
import http from 'node:http';

export const MOCK_MODELS = ['mock-tools:1b', 'mock-json:1b', 'mock-text:1b', 'mock-lazy:1b', 'mock-zh:1b', 'mock-fumble:1b', 'mock-intro:1b', 'mock-loop:1b', 'mock-loop1:1b', 'mock-slow:1b', 'mock-down:1b', 'mock-busy:1b'];
export const WARM_SLOW_MS = 2500; // mock-slow's warm-up answer takes this long (issue #222)
export const MOCK_BUSY = {BUSY_MS: 1200, SCENE_MS: 150}; // mock-busy's tool-loop call and scene answer times (issue #515); a check may change them
// Embeddings (issue #553): startMockOllama({embed: true}) also lists the model MOCK_EMBED_MODEL and answers POST /api/embed with a
// deterministic concept vector: every word of a text adds to the axes of the MOCK_CONCEPTS groups that hold it (a made-up thesaurus, so
// "the woman at the causeway" lands near "a hermit who counts stones" with no word in common), plus a little hashed noise per word.
// handle.embedState: {delay (ms), fail (HTTP 500), down (drops the connection)}; handle.seen.embed: every /api/embed body.
export const MOCK_EMBED_MODEL = 'nomic-embed-text:latest';
export const MOCK_CONCEPTS = [
  'hermit recluse woman crone stones counts counting pebbles causeway ford bridge crossing keeper',
  'dragon wyrm drake serpent fire breath scales lair kragmaw hoard',
  'debt owe owed gold coins borrowed lender ledger repay payment',
  'grudge feud rival enemy nemesis vengeance revenge hatred sworn',
  'food bread stew inn tavern meal ale supper hearth innkeeper',
  'wolf wolves pack howl fangs hunt hunting beast prowl',
];
const words = t => String(t).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3);
export function mockEmbedVector(text) {
  const v = new Array(MOCK_CONCEPTS.length + 64).fill(0);
  for (const w of words(String(text).replace(/^search_(query|document): /, ''))) {
    MOCK_CONCEPTS.forEach((g, i) => {if (g.split(' ').includes(w)) v[i] += 1});
    let h = 7; for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0; v[MOCK_CONCEPTS.length + (h % 64)] += 0.15;
  }
  return v;
}
export async function startMockOllama({embed = false} = {}) {
  const seen = [], embedState = {delay: 0, fail: false, down: false};
  const plan = {
    tools: [['status'], ['rest', {minutes: '20'}], ['fly'], ['wait', {minutes: 20}]],
    json: [{tool: 'status', args: {}}, {tool: 'wait', args: {minutes: 20}}, {tool: 'end', args: {}, narration: 'The hero waited, local and free.'}],
  };
  const server = http.createServer((req, res) => {
    const send = (code, o) => {res.writeHead(code, {'content-type': 'application/json'}); res.end(JSON.stringify(o))};
    if (req.url === '/api/tags') return send(200, {models: (embed ? [...MOCK_MODELS, MOCK_EMBED_MODEL] : MOCK_MODELS).map(name => ({name, model: name}))});
    if (req.url === '/api/embed' && req.method === 'POST') {
      let eb = ''; req.on('data', c => eb += c);
      return void req.on('end', () => {
        const body = JSON.parse(eb); (seen.embed || (seen.embed = [])).push(body);
        if (!embed) return send(404, {error: 'not found'});
        if (embedState.down) return void req.socket.destroy();
        if (embedState.fail) return send(500, {error: 'embedding model failed to load'});
        if (body.model !== MOCK_EMBED_MODEL && body.model !== 'nomic-embed-text') return send(404, {error: 'model "' + body.model + '" not found, try pulling it first'});
        const input = Array.isArray(body.input) ? body.input : [body.input];
        setTimeout(() => send(200, {model: body.model, embeddings: input.map(mockEmbedVector), total_duration: 1, prompt_eval_count: input.length}), embedState.delay);
      });
    }
    if (req.url !== '/api/chat' || req.method !== 'POST') return send(404, {error: 'not found'});
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      const body = JSON.parse(b); seen.push(body);
      const msgs = body.messages, lastTurn = msgs.map((m, i) => m.role === 'user' && !/^(Result of|That was not)/.test(m.content) ? i : -1).filter(i => i >= 0).pop();
      const after = msgs.slice(lastTurn + 1), done = {done: true, done_reason: 'stop', prompt_eval_count: 900, eval_count: 20, model: body.model};
      if (body.format && body.format.properties && body.format.properties.notes) { // a reflection turn (issue #179): two free-form notes from what the prompt says
        seen.reflect = (seen.reflect || 0) + 1;
        const u = String((msgs[msgs.length - 1] || {}).content || ''), why = (u.match(/\(now: ([^)]*)\)/) || [])[1] || 'a quiet day';
        return send(200, {...done, message: {role: 'assistant', content: JSON.stringify({notes: [{title: 'Reflection: ' + why.slice(0, 50), text: `At ${why} I took stock: the road was long and my companions held.`, tags: ['reflection', 'mock']}, {title: 'A lesson', text: 'Rest before the dark, not after it.', tags: ['lesson'], about: ''}]})}});
      }
      if (body.format && body.format.properties && body.format.properties.ready) { // the start gate's warm-up (issue #222)
        seen.warm = (seen.warm || 0) + 1;
        if (body.model === 'mock-down:1b') return send(500, {error: 'model runner has unexpectedly stopped'});
        const answer = () => send(200, {...done, message: {role: 'assistant', content: '{"ready": true}'}});
        return body.model === 'mock-slow:1b' ? void setTimeout(answer, WARM_SLOW_MS) : answer();
      }
      if (body.model === 'mock-down:1b') return send(500, {error: 'model runner has unexpectedly stopped'});
      if (body.model === 'mock-busy:1b') { // issue #515: slow free turns, quick scene answers
        const en = body.format && body.format.properties && body.format.properties.option && body.format.properties.option.enum;
        if (en) {seen.busyScene = (seen.busyScene || 0) + 1; return void setTimeout(() => send(200, {...done, message: {role: 'assistant', content: JSON.stringify({option: en.includes('press') ? 'press' : en[0], line: 'Steady, I am with you.'})}}), MOCK_BUSY.SCENE_MS)}
        seen.busy = (seen.busy || 0) + 1;
        const k = after.filter(m => m.role === 'assistant').length, busyPlan = [['look'], ['status'], ['rest', {minutes: '20'}], ['wait', {minutes: 20}]];
        const msg = !body.tools || k >= busyPlan.length ? {role: 'assistant', content: 'The hero looked about, rested and waited.'} : {role: 'assistant', content: '', tool_calls: [{function: {name: busyPlan[k][0], arguments: busyPlan[k][1] || {}}}]};
        return void setTimeout(() => {if (!res.destroyed) send(200, {...done, message: msg})}, MOCK_BUSY.BUSY_MS);
      }
      if (body.model === 'mock-loop:1b' || body.model === 'mock-loop1:1b' && body.options && body.options.temperature !== 0.4) { // the owner's live error (issue #221)
        seen.loop = (seen.loop || 0) + 1;
        return send(500, {error: 'an error was encountered while running the model: prediction aborted, token repeat limit reached'});
      }
      if (body.model === 'mock-json:1b') {
        if (body.tools) return send(400, {error: `registry.ollama.ai/library/mock-json does not support tools`});
        const n = after.filter(m => m.role === 'assistant').length;
        return send(200, {...done, message: {role: 'assistant', content: JSON.stringify({narration: '', ...plan.json[Math.min(n, plan.json.length - 1)]})}});
      }
      const n = after.filter(m => m.role === 'assistant').length;
      if (body.model === 'mock-fumble:1b') { // issue #163 (qwen2.5:14b live): writes scene_act as text under a made-up label, then really calls wait
        const en = body.format && body.format.properties && body.format.properties.option && body.format.properties.option.enum;
        const pick = en ? (en.includes('press') ? 'press' : en[0]) : 'press', written = `CallCheck sees the party waiting.\n(scene_act(${pick}, "Forward, together. I'll not stand idle."))\n---\nThe hero presses on.`; // the option unquoted, as Garrwen wrote deadeye live
        seen.fumble = (seen.fumble || 0) + 1;
        if (body.format) return send(200, {...done, message: {role: 'assistant', content: written}}); // even the forced answer comes back as text
        if (!body.tools || n >= 1) return send(200, {...done, message: {role: 'assistant', content: 'CallCheck: the hero pressed on with the others.'}});
        return send(200, {...done, message: {role: 'assistant', content: written, tool_calls: [{function: {name: 'wait', arguments: {minutes: 10}}}]}});
      }
      if (body.model === 'mock-intro:1b') { // the owner's screenshot: introduces itself to the party every turn, then waits
        const en = body.format && body.format.properties && body.format.properties.option && body.format.properties.option.enum;
        if (en) return send(200, {...done, message: {role: 'assistant', content: JSON.stringify({option: en[0], line: 'Here.'})}});
        const who = ((msgs[0] && msgs[0].content || '').match(/^You are (\w+)/) || [])[1] || 'Nobody';
        const plan = [['party_say', {text: `Hello friends! I am ${who} of the Concord, sworn to recover the Fenlight Lantern.`}], ['wait', {minutes: 10}]];
        if (!body.tools || n >= plan.length) return send(200, {...done, message: {role: 'assistant', content: `${who} greeted the party.`}});
        return send(200, {...done, message: {role: 'assistant', content: '', tool_calls: [{function: {name: plan[n][0], arguments: plan[n][1]}}]}});
      }
      if (body.model === 'mock-zh:1b') // answers in Chinese, never calling a tool (issue #126, the owner's live bug)
        return send(200, {...done, message: {role: 'assistant', content: '我将带领团队去见萨满奥兹雷克，询问新的任务。'}});
      if (body.model === 'mock-lazy:1b' && msgs.filter(m => m.role === 'user' && /^(Begin|Turn \d)/.test(m.content)).length > 3)
        return send(200, {...done, message: {role: 'assistant', content: 'I am still battling the Concord Rogue, blade against blade.'}});
      if (!body.tools) seen.final = (seen.final || 0) + 1; // the closing call after a wait: words only
      if (n >= plan.tools.length || !body.tools) return send(200, {...done, message: {role: 'assistant', content: 'The hero looked, rested and waited.'}});
      const [name, args = {}] = plan.tools[n];
      if (body.model === 'mock-text:1b') return send(200, {...done, message: {role: 'assistant', content: `<tool_call>${JSON.stringify({name, arguments: args})}</tool_call>`}});
      send(200, {...done, message: {role: 'assistant', content: '', tool_calls: [{function: {name, arguments: args}}]}});
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return {url: `http://127.0.0.1:${server.address().port}`, seen, embedState, close: () => server.close()};
}
