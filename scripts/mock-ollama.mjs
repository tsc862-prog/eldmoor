// A mock Ollama server for tests (scripts/localcheck.mjs, scripts/runnercheck.mjs): no Ollama and no
// model needed. Models: mock-tools (tool calling), mock-json (no tool support: 400 on tools), mock-text
// (writes calls as text), mock-lazy (plays like mock-tools for three turns, then only narrates a long-over
// fight, never calling a tool: the owner's live bug, issue #126). Each turn it plays status, rest 20, a bad
// tool (fly), wait 20, then narrates.
// startMockOllama() -> {url, seen (every /api/chat body; seen.final counts closing calls), close()}
import http from 'node:http';

export const MOCK_MODELS = ['mock-tools:1b', 'mock-json:1b', 'mock-text:1b', 'mock-lazy:1b', 'mock-zh:1b'];
export async function startMockOllama() {
  const seen = [];
  const plan = {
    tools: [['status'], ['rest', {minutes: '20'}], ['fly'], ['wait', {minutes: 20}]],
    json: [{tool: 'status', args: {}}, {tool: 'wait', args: {minutes: 20}}, {tool: 'end', args: {}, narration: 'The hero waited, local and free.'}],
  };
  const server = http.createServer((req, res) => {
    const send = (code, o) => {res.writeHead(code, {'content-type': 'application/json'}); res.end(JSON.stringify(o))};
    if (req.url === '/api/tags') return send(200, {models: MOCK_MODELS.map(name => ({name, model: name}))});
    if (req.url !== '/api/chat' || req.method !== 'POST') return send(404, {error: 'not found'});
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      const body = JSON.parse(b); seen.push(body);
      const msgs = body.messages, lastTurn = msgs.map((m, i) => m.role === 'user' && !/^(Result of|That was not)/.test(m.content) ? i : -1).filter(i => i >= 0).pop();
      const after = msgs.slice(lastTurn + 1), done = {done: true, done_reason: 'stop', prompt_eval_count: 900, eval_count: 20, model: body.model};
      if (body.model === 'mock-json:1b') {
        if (body.tools) return send(400, {error: `registry.ollama.ai/library/mock-json does not support tools`});
        const n = after.filter(m => m.role === 'assistant').length;
        return send(200, {...done, message: {role: 'assistant', content: JSON.stringify({narration: '', ...plan.json[Math.min(n, plan.json.length - 1)]})}});
      }
      const n = after.filter(m => m.role === 'assistant').length;
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
  return {url: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close()};
}
