// Agent player bridge (issues #75, #93). Adds to an http.Server (the brain relay, or the headless
// host in scripts/play-headless.mjs) everything AI agents need to play heroes, several at once,
// one agent per hero:
//
//   POST /mcp            MCP over streamable HTTP (stateless, JSON responses): the tools of
//                        src/data/player-tools.js. Any MCP client can connect here.
//   WS   /play           the browser page connects here while any hero is agent-played
//                        (src/ui/player-bridge.js); tool calls are forwarded to it and the
//                        page answers through src/sim/player.js.
//   POST /play/call      {tool, args, hero?} -> result; the same tools without MCP (the stdio
//                        MCP entry scripts/mcp-stdio.mjs and tests use it)
//   POST /play/narrate   {text, hero?}: the runner's narration, shown in the hero's Agent tab
//   POST /play/claim     {hero, runner}: a runner binds itself to one hero (and refreshes the
//                        claim every few seconds); 409 when another live runner holds it
//   POST /play/release   {hero, runner}: the runner lets go (on exit)
//   GET  /play/health    {connected, hero, heroes:[{id,name,alive,link}], calls}
//
// Which hero: every call names its hero by id, as the X-Eldmoor-Hero header (what
// scripts/agent-player.mjs sends on its MCP connection), a ?hero= query on the URL, or a `hero`
// field in a /play/* body. Tools then touch only that hero. A call that names no hero takes the
// old single-hero path: the first living agent-played hero.
// Link state per hero (shown in the Agent tab and the Minds panel): 'connected' (a call in flight
// or one in the last LINK_MS), 'waiting' (a runner holds the hero but is quiet: thinking, or
// between turns), 'none' (no runner).
//
// Safety: the server only listens on 127.0.0.1. Requests must carry a localhost Host header
// (DNS rebinding). /mcp and /play/* refuse any request with an Origin header (a web page
// cannot drive a hero); the WebSocket accepts only the game's dev origin. Every tool only
// touches an agent-played hero the game names; there is no file, shell or key access.
// Verbose (RELAY_VERBOSE=1 or --verbose) appends each tool call to logs/play.jsonl.
//
// A backend is {call(heroId,tool,args) -> Promise<result>, narrate(heroId,text),
// info() -> {connected, heroes:[{id,name,alive}]}, links?(map)}. attachPlay() makes a browser
// backend (WebSocket) unless one is passed in (headless).
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
export const CLAIM_MS = 30000, LINK_MS = 20000; // a runner claim lives this long unrefreshed; a call keeps the link 'connected' this long
export const HERO_HEADER = 'x-eldmoor-hero';
export const INSTRUCTIONS = 'You play one hero in Eldmoor, a hardcore fantasy world that keeps running whether you act or not. One life: death is permanent. Use status and look to orient, act with one command at a time, then wait() to let game time pass. Keep a journal with journal_write.';

const localHost = h => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(String(h || ''));
// A hero id from a header, query or body value: a positive integer, null when absent, NaN when bad.
export const heroParam = v => v == null || v === '' ? null : /^\d{1,9}$/.test(String(v).trim()) ? Number(String(v).trim()) : NaN;
const cleanHeroes = list => (Array.isArray(list) ? list : []).filter(h => h && typeof h === 'object' && Number.isInteger(h.id))
  .slice(0, 64).map(h => ({id: h.id, name: String(h.name || '').slice(0, 40), alive: h.alive !== false, ...(h.fellow ? {fellow: true, role: String(h.role || '').slice(0, 12) || null, lead: !!h.lead, table: !!h.table} : {})})); // fellow/role/lead: Fellowship members (#68), for npm run fellowship
// The hero a call without a hero id goes to (the old single-hero path).
export const defaultHero = heroes => (heroes.find(h => h.alive) || heroes[heroes.length - 1] || null);

// ---- the browser backend: one page at a time over a WebSocket, serving all its agent heroes ----
export function browserBackend({log = () => {}} = {}) {
  let sock = null, heroes = [], seq = 0, lastLinks = '';
  const waiting = new Map();
  const send = o => {if (sock && sock.readyState === 1) sock.send(JSON.stringify(o))};
  return {
    attach(ws) {
      if (sock && sock !== ws) try {sock.close(4000, 'replaced')} catch {}
      sock = ws; heroes = []; lastLinks = ''; log('[play] game page connected');
      ws.on('message', buf => {
        let m; try {m = JSON.parse(String(buf))} catch {return}
        if (m.type === 'hello') {
          // {heroes:[...]} since #93; an older page sends {hero} alone
          const next = cleanHeroes(Array.isArray(m.heroes) ? m.heroes : m.hero ? [m.hero] : []);
          const k = next.map(h => h.id + ':' + h.name + ':' + h.alive).join(',');
          if (k !== heroes.map(h => h.id + ':' + h.name + ':' + h.alive).join(',')) log(`[play] agent heroes: ${next.length ? next.map(h => h.name + ' #' + h.id + (h.alive ? '' : ' (dead)')).join(', ') : 'none'}`);
          heroes = next; lastLinks = '';
        } else if (m.type === 'result' && waiting.has(m.id)) {const w = waiting.get(m.id); waiting.delete(m.id); clearTimeout(w.t); w.res(m.result)}
      });
      ws.on('close', () => {if (sock !== ws) return; sock = null; heroes = []; log('[play] game page disconnected');
        for (const [id, w] of waiting) {clearTimeout(w.t); w.res({ok: false, error: 'The game page went away.'}); waiting.delete(id)}});
    },
    info: () => ({connected: !!sock, heroes: heroes.slice()}),
    call(heroId, tool, args) {
      if (!sock || sock.readyState !== 1) return Promise.resolve({ok: false, error: 'The game is not connected. Open the game page and press "Agent" on a hero.', offline: true});
      if (!heroes.length) return Promise.resolve({ok: false, error: 'No hero is agent-played. Press "Agent" on a hero in the game.', offline: true});
      if (!heroes.some(h => h.id === heroId)) return Promise.resolve({ok: false, error: `Hero #${heroId} is not agent-played in the game.`, offline: true});
      const id = ++seq;
      return new Promise(res => {
        const t = setTimeout(() => {waiting.delete(id); res({ok: false, error: 'The game did not answer in time (is the tab hidden or paused?).'})}, tool === 'wait' ? WAIT_MS : CALL_MS);
        waiting.set(id, {res, t});
        send({type: 'call', id, hero: heroId, tool, args: args || {}});
      });
    },
    narrate(heroId, text) {send({type: 'narrate', hero: heroId, text: String(text).slice(0, 600)})},
    // Runner link states for the page's Agent tab and Minds panel; sent only when they change.
    links(map) {const k = JSON.stringify(map); if (k === lastLinks) return; lastLinks = k; send({type: 'links', links: map})},
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
  const server = new McpServer({name: 'eldmoor-player', version: '1.1.0'}, {instructions: INSTRUCTIONS});
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

// attachPlay(server, {backend?, origin, log, verbose, now}) -> {backend, stats, call, linkOf, links}
export function attachPlay(server, {backend = null, origin = 'http://localhost:5173', log = console.log, verbose = null, now = () => Date.now()} = {}) {
  const be = backend || browserBackend({log});
  const stats = {calls: 0, errors: 0};
  const claims = new Map(), act = new Map(); // hero id -> {runner, at} / {last, inflight}
  const vlog = rec => {if (!verbose) return; try {mkdirSync(dirname(verbose), {recursive: true}); appendFileSync(verbose, JSON.stringify(rec) + '\n')} catch (e) {log(`[play] verbose log failed: ${e.message}`)}};
  const claimOf = id => {const c = claims.get(id); return c && now() - c.at < CLAIM_MS ? c : null};
  const linkOf = id => {const a = act.get(id), busy = a && (a.inflight > 0 || now() - a.last < LINK_MS);
    return busy ? 'connected' : claimOf(id) ? 'waiting' : 'none'};
  const links = () => Object.fromEntries((be.info().heroes || []).map(h => [h.id, linkOf(h.id)]));
  const pushLinks = () => {if (be.links) be.links(links())};
  const resolve = hero => hero != null ? hero : (defaultHero(be.info().heroes || []) || {}).id ?? null;

  // Every tool call goes through here: routed to one hero, counted, logged when verbose, never thrown.
  async function call(hero, tool, args) {
    const t0 = now(), id = resolve(hero); stats.calls++;
    const a = id != null ? act.get(id) || {last: 0, inflight: 0} : null; if (a) {a.inflight++; a.last = t0; act.set(id, a); pushLinks()}
    let r;
    try {r = id == null ? {ok: false, error: 'No hero is agent-played.', offline: true} : await be.call(id, tool, args)} catch (e) {r = {ok: false, error: String(e.message || e)}}
    if (a) {a.inflight--; a.last = now(); pushLinks()}
    if (!r || typeof r !== 'object') r = {ok: false, error: 'no answer'};
    if (r.ok === false) stats.errors++;
    log(`[play] #${id ?? '?'} ${tool}${args && Object.keys(args).length ? ' ' + JSON.stringify(args) : ''} -> ${r.ok === false ? 'x ' + String(r.error).slice(0, 80) : 'ok'} (${now() - t0} ms)`);
    vlog({ts: new Date().toISOString(), hero: id, tool, args, result: r, ms: now() - t0});
    return r;
  }
  // Link states change with time alone (claims and calls age out); refresh the page now and then.
  const tick = setInterval(pushLinks, 2000); if (tick.unref) tick.unref();
  server.on('close', () => clearInterval(tick));

  const wss = backend ? null : new WebSocketServer({noServer: true, maxPayload: 256 * 1024});
  server.on('upgrade', (req, socket, head) => {
    const path = (req.url || '').split('?')[0];
    if (path !== '/play' || !wss || !localHost(req.headers.host) || req.headers.origin !== origin) {socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return}
    wss.handleUpgrade(req, socket, head, ws => be.attach(ws));
  });

  // Put our routes in front of whatever the server already handles.
  const prior = server.listeners('request'); server.removeAllListeners('request');
  server.on('request', async (req, res) => {
    const [path, qs] = (req.url || '').split('?');
    if (!(path === '/mcp' || path.startsWith('/play'))) {for (const f of prior) f.call(server, req, res); return}
    const send = (code, obj) => {res.writeHead(code, {'content-type': 'application/json'}); res.end(JSON.stringify(obj))};
    if (!localHost(req.headers.host)) return send(403, {error: 'host not allowed'});
    if (req.headers.origin) return send(403, {error: 'browser origins may not drive the hero'});
    // the hero this request is for: header, then query (a body field may override below)
    let hero = heroParam(req.headers[HERO_HEADER]); if (hero === null) hero = heroParam(new URLSearchParams(qs || '').get('hero'));
    if (Number.isNaN(hero)) return send(400, {error: 'bad hero id (use the numeric id, e.g. X-Eldmoor-Hero: 12)'});
    try {
      if (path === '/play/health' && req.method === 'GET') {const i = be.info(), hs = i.heroes || [], d = defaultHero(hs);
        return send(200, {ok: true, connected: i.connected, hero: d ? {id: d.id, name: d.name, alive: d.alive} : null, heroes: hs.map(h => ({...h, link: linkOf(h.id)})), ...stats})}
      if (path === '/mcp') {
        if (req.method !== 'POST') return send(405, {jsonrpc: '2.0', error: {code: -32000, message: 'Method not allowed (stateless server: POST only).'}, id: null});
        const body = await readBody(req);
        const mcp = buildMcp((tool, args) => call(hero, tool, args)), transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true});
        res.on('close', () => {transport.close(); mcp.close()});
        await mcp.connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }
      if (req.method !== 'POST') return send(404, {error: 'not found'});
      const b = await readBody(req) || {};
      if (b.hero !== undefined) {hero = heroParam(b.hero); if (Number.isNaN(hero)) return send(400, {error: 'bad hero id'})}
      if (path === '/play/call') {
        if (typeof b.tool !== 'string' || !PLAYER_TOOLS.some(t => t.name === b.tool)) return send(400, {error: 'unknown tool'});
        return send(200, await call(hero, b.tool, b.args && typeof b.args === 'object' ? b.args : {}))}
      if (path === '/play/narrate') {const id = resolve(hero);
        if (id != null && typeof b.text === 'string' && b.text.trim()) {be.narrate(id, b.text.trim()); vlog({ts: new Date().toISOString(), hero: id, narrate: b.text.slice(0, 600)})}
        return send(200, {ok: true})}
      if (path === '/play/claim' || path === '/play/release') {
        const runner = typeof b.runner === 'string' ? b.runner.slice(0, 80) : '';
        if (hero == null || !runner) return send(400, {error: 'claim needs {hero, runner}'});
        const held = claimOf(hero);
        if (path === '/play/release') {if (held && held.runner === runner) {claims.delete(hero); log(`[play] runner let go of #${hero}`); pushLinks()} return send(200, {ok: true})}
        if (held && held.runner !== runner) return send(409, {ok: false, error: `Hero #${hero} already has a live agent runner (${held.runner}). One agent per hero.`});
        const h = (be.info().heroes || []).find(x => x.id === hero);
        if (!h) return send(404, {ok: false, error: `Hero #${hero} is not agent-played in this world.`});
        if (!held) log(`[play] runner ${runner} took ${h.name} #${hero}`);
        claims.set(hero, {runner, at: now()}); pushLinks();
        return send(200, {ok: true, hero: h, link: linkOf(hero)})}
      send(404, {error: 'not found'});
    } catch (e) {if (!res.headersSent) send(400, {error: String(e.message || e)})}
  });
  return {backend: be, stats, call, linkOf, links};
}
