// Agent player bridge (issue #75). Adds to an http.Server (the brain relay, or the headless
// host in scripts/play-headless.mjs) everything an AI agent needs to play one hero:
//
//   POST /mcp            MCP over streamable HTTP (stateless, JSON responses): the tools of
//                        src/data/player-tools.js. Any MCP client can connect here.
//   WS   /play           the browser page connects here when a hero is marked agent-played
//                        (src/ui/player-bridge.js); tool calls are forwarded to it and the
//                        page answers through src/sim/player.js.
//   POST /play/call      {tool, args} -> result; the same tools without MCP (the stdio MCP
//                        entry scripts/mcp-stdio.mjs and tests use it)
//   POST /play/narrate   {text}: the runner's narration, shown in the hero's Agent tab
//   GET  /play/health    {connected, hero, calls}
//
// Safety: the server only listens on 127.0.0.1. Requests must carry a localhost Host header
// (DNS rebinding). /mcp and /play/* refuse any request with an Origin header (a web page
// cannot drive the hero); the WebSocket accepts only the game's dev origin. Every tool only
// touches the one agent-played hero the game names; there is no file, shell or key access.
// Verbose (RELAY_VERBOSE=1 or --verbose) appends each tool call to logs/play.jsonl.
//
// A backend is {call(tool,args) -> Promise<result>, narrate(text), info() -> {connected,hero}}.
// attachPlay() makes a browser backend (WebSocket) unless one is passed in (headless).
import {mkdirSync, appendFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocketServer} from 'ws';
import {z} from 'zod';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {PLAYER_TOOLS} from '../src/data/player-tools.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PLAY_LOG = join(ROOT, 'logs', 'play.jsonl');
export const CALL_MS = 15000, WAIT_MS = 60000, MAX_BODY = 16 * 1024;
export const INSTRUCTIONS = 'You play one hero in Eldmoor, a hardcore fantasy world that keeps running whether you act or not. One life: death is permanent. Use status and look to orient, act with one command at a time, then wait() to let game time pass. Keep a journal with journal_write.';

const localHost = h => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(String(h || ''));

// ---- the browser backend: one page at a time over a WebSocket ----
export function browserBackend({log = () => {}} = {}) {
  let sock = null, hero = null, seq = 0;
  const waiting = new Map();
  return {
    attach(ws) {
      if (sock && sock !== ws) try {sock.close(4000, 'replaced')} catch {}
      sock = ws; hero = null; log('[play] game page connected');
      ws.on('message', buf => {
        let m; try {m = JSON.parse(String(buf))} catch {return}
        if (m.type === 'hello') {hero = m.hero && typeof m.hero === 'object' ? {id: m.hero.id, name: String(m.hero.name || '').slice(0, 40)} : null; log(`[play] agent hero: ${hero ? hero.name + ' #' + hero.id : 'none'}`)}
        else if (m.type === 'result' && waiting.has(m.id)) {const w = waiting.get(m.id); waiting.delete(m.id); clearTimeout(w.t); w.res(m.result)}
      });
      ws.on('close', () => {if (sock !== ws) return; sock = null; hero = null; log('[play] game page disconnected');
        for (const [id, w] of waiting) {clearTimeout(w.t); w.res({ok: false, error: 'The game page went away.'}); waiting.delete(id)}});
    },
    info: () => ({connected: !!sock, hero}),
    call(tool, args) {
      if (!sock || sock.readyState !== 1) return Promise.resolve({ok: false, error: 'The game is not connected. Open the game page and press "Agent" on a hero.', offline: true});
      if (!hero) return Promise.resolve({ok: false, error: 'No hero is agent-played. Press "Agent" on a hero in the game.', offline: true});
      const id = ++seq;
      return new Promise(res => {
        const t = setTimeout(() => {waiting.delete(id); res({ok: false, error: 'The game did not answer in time (is the tab hidden or paused?).'})}, tool === 'wait' ? WAIT_MS : CALL_MS);
        waiting.set(id, {res, t});
        sock.send(JSON.stringify({type: 'call', id, tool, args: args || {}}));
      });
    },
    narrate(text) {if (sock && sock.readyState === 1) sock.send(JSON.stringify({type: 'narrate', text: String(text).slice(0, 600)}))},
  };
}

// ---- MCP: one stateless server per request ----
function zodFor(spec) {
  const shape = {};
  for (const [k, a] of Object.entries(spec.args || {})) {
    let s = a.enum ? z.enum(a.enum) : a.type === 'integer' ? z.number().int() : a.type === 'number' ? z.number() : z.string();
    s = s.describe(a.desc || k); if (a.optional) s = s.optional(); shape[k] = s;
  }
  return shape;
}
export function buildMcp(call) {
  const server = new McpServer({name: 'eldmoor-player', version: '1.0.0'}, {instructions: INSTRUCTIONS});
  for (const t of PLAYER_TOOLS) {
    server.registerTool(t.name, {description: t.desc, inputSchema: zodFor(t), annotations: {readOnlyHint: !t.act, destructiveHint: false, openWorldHint: false}},
      async args => {const r = await call(t.name, args || {}); return {content: [{type: 'text', text: JSON.stringify(r)}], isError: !!(r && r.offline)}});
  }
  return server;
}

const readBody = req => new Promise((res, rej) => {
  let size = 0; const chunks = [];
  req.on('data', c => {size += c.length; if (size > MAX_BODY) {rej(new Error('too large')); req.destroy()} else chunks.push(c)});
  req.on('end', () => {try {res(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined)} catch {rej(new Error('bad json'))}});
  req.on('error', rej);
});

// attachPlay(server, {backend?, origin, log, verbose}) -> {backend, stats}
export function attachPlay(server, {backend = null, origin = 'http://localhost:5173', log = console.log, verbose = null} = {}) {
  const be = backend || browserBackend({log});
  const stats = {calls: 0, errors: 0};
  const vlog = rec => {if (!verbose) return; try {mkdirSync(dirname(verbose), {recursive: true}); appendFileSync(verbose, JSON.stringify(rec) + '\n')} catch (e) {log(`[play] verbose log failed: ${e.message}`)}};
  // Every tool call goes through here: counted, logged when verbose, never thrown.
  async function call(tool, args) {
    const t0 = Date.now(); stats.calls++;
    let r; try {r = await be.call(tool, args)} catch (e) {r = {ok: false, error: String(e.message || e)}}
    if (!r || typeof r !== 'object') r = {ok: false, error: 'no answer'};
    if (r.ok === false) stats.errors++;
    log(`[play] ${tool}${args && Object.keys(args).length ? ' ' + JSON.stringify(args) : ''} -> ${r.ok === false ? 'x ' + String(r.error).slice(0, 80) : 'ok'} (${Date.now() - t0} ms)`);
    vlog({ts: new Date().toISOString(), tool, args, result: r, ms: Date.now() - t0});
    return r;
  }

  const wss = backend ? null : new WebSocketServer({noServer: true, maxPayload: 256 * 1024});
  server.on('upgrade', (req, socket, head) => {
    const path = (req.url || '').split('?')[0];
    if (path !== '/play' || !wss || !localHost(req.headers.host) || req.headers.origin !== origin) {socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return}
    wss.handleUpgrade(req, socket, head, ws => be.attach(ws));
  });

  // Put our routes in front of whatever the server already handles.
  const prior = server.listeners('request'); server.removeAllListeners('request');
  server.on('request', async (req, res) => {
    const path = (req.url || '').split('?')[0];
    if (!(path === '/mcp' || path.startsWith('/play'))) {for (const f of prior) f.call(server, req, res); return}
    const send = (code, obj) => {res.writeHead(code, {'content-type': 'application/json'}); res.end(JSON.stringify(obj))};
    if (!localHost(req.headers.host)) return send(403, {error: 'host not allowed'});
    if (req.headers.origin) return send(403, {error: 'browser origins may not drive the hero'});
    try {
      if (path === '/play/health' && req.method === 'GET') return send(200, {ok: true, ...be.info(), ...stats});
      if (path === '/play/call' && req.method === 'POST') {const b = await readBody(req) || {};
        if (typeof b.tool !== 'string' || !PLAYER_TOOLS.some(t => t.name === b.tool)) return send(400, {error: 'unknown tool'});
        return send(200, await call(b.tool, b.args && typeof b.args === 'object' ? b.args : {}))}
      if (path === '/play/narrate' && req.method === 'POST') {const b = await readBody(req) || {};
        if (typeof b.text === 'string' && b.text.trim()) {be.narrate(b.text.trim()); vlog({ts: new Date().toISOString(), narrate: b.text.slice(0, 600)})}
        return send(200, {ok: true})}
      if (path === '/mcp') {
        if (req.method !== 'POST') return send(405, {jsonrpc: '2.0', error: {code: -32000, message: 'Method not allowed (stateless server: POST only).'}, id: null});
        const body = await readBody(req);
        const mcp = buildMcp(call), transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true});
        res.on('close', () => {transport.close(); mcp.close()});
        await mcp.connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }
      send(404, {error: 'not found'});
    } catch (e) {if (!res.headersSent) send(400, {error: String(e.message || e)})}
  });
  return {backend: be, stats, call};
}
