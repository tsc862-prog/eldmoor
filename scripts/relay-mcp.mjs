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
//   POST /play/pace      {hero, runner, since?, minutes?, wake?, realMs?}: runner pacing (issue #126,
//                        src/sim/pace.js): answers when the hero's next turn should start ({wake:
//                        'now'|'soft'|'heartbeat'}) or after realMs with wake null; not a tool, does
//                        not count as activity for the link state, never consumes the hero's events;
//                        {brief:true} answers at once with the hero's state header for a turn prompt
//                        {queued:true} (issue #515): the member's scene answer waits behind other work in its
//                        runner; the table waits a bounded extra time for it (src/sim/scenewait.js)
//   POST /play/claim     {hero, runner, provider?, model?}: a runner binds itself to one hero (and
//                        refreshes the claim every few seconds); 409 when another live runner
//                        holds it. provider/model (issue #97) name the mind behind the runner
//                        (anthropic + a Claude id, ollama + a local tag) so the UI can tag it
//   POST /play/release   {hero, runner}: the runner lets go (on exit)
//   GET  /play/health    {connected, hero, heroes:[{id,name,alive,link,claimed,runner?,ready,warm?}], calls}
//   POST /play/ready     {hero|role:'dm', runner, state:'warming'|'ready'|'failed', model?, ms?, error?}: the seat's
//                        warm-up model call (issue #222, start gate); only the claiming runner; ready = null until then
//   POST /play/behavior/turn {hero | role:'dm', runner, rec}: a runner's turn line for the behavior logs (issue
//                        #129, scripts/behavior-log.mjs); only from the runner that holds the seat; the host adds
//                        the hero's state after the turn. 404 when the host keeps no behavior logs.
//                        The page's world digests, game-side anomalies and settled decisions come over the
//                        WebSocket ({type:'behavior', kind, rec}); nothing in the behavior logs goes back out.
//
// Which hero: every call names its hero by id, as the X-Eldmoor-Hero header (what
// scripts/agent-player.mjs sends on its MCP connection), a ?hero= query on the URL, or a `hero`
// field in a /play/* body. Tools then touch only that hero. A call that names no hero takes the
// old single-hero path: the first living agent-played hero.
// Link state per hero (shown in the Agent tab and the Minds panel): 'connected' (a call in flight
// or one in the last LINK_MS), 'waiting' (a runner holds the hero but is quiet: thinking, or
// between turns), 'none' (no runner).
//
// In-game channels (issue #123): seats never talk to each other here. A claimed hero answers only
// the runner that claimed it (X-Eldmoor-Runner header or ?runner= on /mcp, `runner` on /play/*;
// anyone else gets 409), a DM seat held by a runner answers only that runner, the DM role has no
// hero tools and a hero (or a runner holding one) has no DM tools, and one runner never holds both
// a hero and the DM seat. /play/narrate only reaches the watcher's Agent tab. No route carries text
// from one seat to another: the DM reaches heroes through the game (narrate, npc_say).
// Safety: the server only listens on 127.0.0.1. Requests must carry a localhost Host header
// (DNS rebinding). /mcp and /play/* refuse any request with an Origin header (a web page
// cannot drive a hero); the WebSocket accepts only the game's dev origin. Every tool only
// touches an agent-played hero the game names; there is no file, shell or key access.
// Verbose (RELAY_VERBOSE=1 or --verbose) appends each tool call to logs/play.jsonl.
//
// The DM seat (issue #66): the DM as an agent has its own tools (src/data/dm-tools.js), selected
// with an X-Eldmoor-Role: dm header or /mcp?role=dm, plain JSON at POST /play/dm {tool, args}, and
// one claimed seat (POST /play/claim {role:'dm', runner}); /play/health reports it as `dm`. The game
// answers DM calls only while its DM seat is open (the DM panel's "DM agent", or play-headless --dm).
//
// A backend is {call(heroId,tool,args) -> Promise<result>, narrate(heroId,text),
// info() -> {connected, heroes:[{id,name,alive}], dm?}, links?(map, runners, dm), dmCall?(tool,args)}. attachPlay() makes a browser
// backend (WebSocket) unless one is passed in (headless).
import {mkdirSync, appendFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocketServer} from 'ws';
import {z} from 'zod';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {PLAYER_TOOLS} from '../src/data/player-tools.js';
import {DM_TOOLS} from '../src/data/dm-tools.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PLAY_LOG = join(ROOT, 'logs', 'play.jsonl');
export const CALL_MS = 15000, WAIT_MS = 60000, MAX_BODY = 16 * 1024;
export const DM_VOICE_MS = 10000; // the longest a voice call counts as pending without its answer (#682)
export const DM_WAIT_MAX = 25000; // the longest long poll of table_call / npc_call / ruling_call {wait_ms} (#680; src/sim/player-host.js DM_WAIT.MAX)
// What an agent hears while the game page is away (#399): a pause in the world, not advice to a human ("Press Agent ...", which
// models read as something they must do). offline:true marks it for the runners (not the model's mistake, scripts/local-agent.mjs).
export const PAUSED = 'The world is paused or reloading; wait and try again (your runner picks up when it is back).';
const paused = why => ({ok: false, error: PAUSED, offline: true, why});
export const CLAIM_MS = 45000, LINK_MS = 20000; // a runner claim lives this long unrefreshed; a call keeps the link 'connected' this long
export const HERO_HEADER = 'x-eldmoor-hero', ROLE_HEADER = 'x-eldmoor-role', RUNNER_HEADER = 'x-eldmoor-runner', DM_KEY = 'dm'; // DM_KEY: the DM seat's key in the claim and link maps
// A runner id from a header, query or body value (what /play/claim was given), or null.
export const runnerParam = v => typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null;
// The runner's mind as a claim reports it (issue #97): {provider, model} with safe names, or null.
export const runnerInfo = b => {const p = typeof b.provider === 'string' && /^[a-z][a-z0-9_-]{0,19}$/.test(b.provider) ? b.provider : null;
  const m = typeof b.model === 'string' && /^[A-Za-z0-9][\w.:\/+-]{0,99}$/.test(b.model) ? b.model : null;
  return p ? {provider: p, model: m} : null};
export const DM_INSTRUCTIONS = 'You are the Dungeon Master of Eldmoor, a hardcore fantasy world that runs on its own. Between scenes you read the world, keep campaign notes and shape what comes next through validated world levers. You never control a hero and never decide who dies: the dice do.';
export const INSTRUCTIONS = 'You play one hero in Eldmoor, a hardcore fantasy world that keeps running whether you act or not. One life: death is permanent. Use status and look to orient, act with one command at a time, then wait() to let game time pass. Keep a journal with journal_write.';

const localHost = h => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(String(h || ''));
// A hero id from a header, query or body value: a positive integer, null when absent, NaN when bad.
export const heroParam = v => v == null || v === '' ? null : /^\d{1,9}$/.test(String(v).trim()) ? Number(String(v).trim()) : NaN;
const cleanHeroes = list => (Array.isArray(list) ? list : []).filter(h => h && typeof h === 'object' && Number.isInteger(h.id))
  .slice(0, 64).map(h => ({id: h.id, name: String(h.name || '').slice(0, 40), alive: h.alive !== false, ...(Number.isInteger(h.succeeds) ? {succeeds: h.succeeds} : {}), ...(h.fellow ? {fellow: true, role: String(h.role || '').slice(0, 12) || null} : {}), ...(Number.isInteger(h.company) ? {company: h.company, companyName: String(h.companyName || '').slice(0, 40) || null, size: Number.isInteger(h.size) ? h.size : 1} : {}), ...(h.fellow || (Number.isInteger(h.company) && h.size > 1) ? {lead: !!h.lead, table: !!h.table, ...(h.due ? {due: true} : {})} : {})})); // fellow/role: the five-place Fellowship (#68); company/lead/table/due: the hero's company (#460), for the company runner
// The hero a call without a hero id goes to (the old single-hero path).
export const defaultHero = heroes => (heroes.find(h => h.alive) || heroes[heroes.length - 1] || null);

// ---- the browser backend: one page at a time over a WebSocket, serving all its agent heroes ----
export function browserBackend({log = () => {}, onBehavior = null, onWorld = null, onMirror = null, onHello = null} = {}) {
  let sock = null, heroes = [], seq = 0, lastLinks = '', dmSeat = false, dmPrep = null;
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
          const seat = m.dm === true || !!(m.dm && m.dm.seat); if (seat !== dmSeat) log(`[play] DM seat ${seat ? 'open' : 'closed'}`); dmSeat = seat;
          dmPrep = m.dm && m.dm.prep && typeof m.dm.prep === 'object' ? {state: String(m.dm.prep.state || '').slice(0, 12), kind: String(m.dm.prep.kind || '').slice(0, 12), calls: Number(m.dm.prep.calls) || 0, max_calls: Number(m.dm.prep.max_calls) || 0, ...(m.dm.prep.why ? {why: String(m.dm.prep.why).slice(0, 12)} : {})} : null; // the DM's prep (#437)
          if (onWorld && typeof m.world === 'string') onWorld(m.world, typeof m.worldId === 'string' ? m.worldId : null); // the behavior logs' folder (issue #129)
          if (onHello) try {onHello()} catch {} // the links at once: a page that (re)connected never shows 'no runner' while it waits for the next tick (#563)
        } else if (m.type === 'behavior' && onBehavior && typeof m.kind === 'string') {try {onBehavior(m.kind, m.rec)} catch (e) {log('[play] behavior log: ' + e.message)}}
        else if (m.type === 'mirror' && onMirror && Array.isArray(m.seats)) {try {onMirror(m.seats)} catch (e) {log('[play] memory mirror: ' + e.message)}} // agent memories as Markdown (#155); written, never read back
        else if (m.type === 'result' && waiting.has(m.id)) {const w = waiting.get(m.id); waiting.delete(m.id); clearTimeout(w.t); w.res(m.result)}
      });
      ws.on('close', () => {if (sock !== ws) return; sock = null; heroes = []; dmSeat = false; dmPrep = null; log('[play] game page disconnected');
        for (const [id, w] of waiting) {clearTimeout(w.t); w.res(paused('page went away')); waiting.delete(id)}});
    },
    info: () => ({connected: !!sock, heroes: heroes.slice(), dm: dmSeat, ...(dmPrep ? {dmPrep} : {})}),
    // A DM tool call (issue #66), answered by the page through src/sim/dmagent.js.
    dmCall(tool, args) {
      if (!sock || sock.readyState !== 1) return Promise.resolve(paused('game not connected'));
      if (!dmSeat) return Promise.resolve({ok: false, error: 'The DM seat is closed: the page opens it for the world it plays.', offline: true});
      const id = ++seq;
      const held = Math.min(DM_WAIT_MAX, Math.max(0, Number(args && args.wait_ms) || 0)); // a long-polled voice call (#680) is held by the page up to wait_ms
      return new Promise(res => {
        const t = setTimeout(() => {waiting.delete(id); res(paused('no answer in time'))}, CALL_MS + held);
        waiting.set(id, {res, t});
        send({type: 'dmcall', id, tool, args: args || {}});
      });
    },
    call(heroId, tool, args) {
      if (!sock || sock.readyState !== 1) return Promise.resolve(paused('game not connected'));
      if (!heroes.length) return Promise.resolve(paused('no agent hero listed'));
      if (!heroes.some(h => h.id === heroId)) return Promise.resolve({ok: false, error: `Hero #${heroId} is not agent-played in the game.`, offline: true});
      const id = ++seq;
      return new Promise(res => {
        const t = setTimeout(() => {waiting.delete(id); res(paused('no answer in time'))}, tool === 'wait' || tool === 'pace' ? WAIT_MS : CALL_MS);
        waiting.set(id, {res, t});
        send({type: 'call', id, hero: heroId, tool, args: args || {}});
      });
    },
    narrate(heroId, text) {send({type: 'narrate', hero: heroId, text: String(text).slice(0, 600)})},
    // Runner link states for the page's Agent tab and Minds panel; sent only when they change.
    // runners: hero id -> {provider, model} of the runner holding it (issue #97), for the mind tag.
    // dm: the DM seat's link and runner ({seat, link, claimed, runner?}), issue #66.
    // ready: hero id -> the seat's warm-up {state:'warming'|'ready'|'failed', model?, ms?, at, error?} (issue #222).
    links(map, runners = {}, dm = null, ready = {}) {const k = JSON.stringify([map, runners, dm, ready]); if (k === lastLinks) return; lastLinks = k; send({type: 'links', links: map, runners, ready, ...(dm ? {dm} : {})})},
  };
}

// ---- MCP: one stateless server per request ----
// One argument's schema: 'object' (the DM's lever params), 'array' (a list of strings, e.g. memory tags, #155; a
// comma-separated string is taken too), enums, numbers, strings.
const zArg = a => a.type === 'object' ? z.record(z.string(), z.any()) : a.type === 'array' ? z.union([z.array(z.string()), z.string()]) : a.enum ? z.enum(a.enum) : a.type === 'integer' ? z.number().int() : a.type === 'number' ? z.number() : z.string();
function zodFor(spec) {
  const shape = {};
  for (const [k, a] of Object.entries(spec.args || {})) {
    let s = zArg(a);
    s = s.describe(a.desc || k); if (a.optional) s = s.optional(); shape[k] = s;
  }
  return shape;
}
// The DM's MCP server (issue #66): the tools of src/data/dm-tools.js ('object' args: the lever params).
export function buildDmMcp(call) {
  const server = new McpServer({name: 'eldmoor-dm', version: '1.0.0'}, {instructions: DM_INSTRUCTIONS});
  for (const t of DM_TOOLS) {
    const shape = {};
    for (const [k, a] of Object.entries(t.args || {})) {let s = zArg(a);
      s = s.describe(a.desc || k); if (a.optional) s = s.optional(); shape[k] = s}
    server.registerTool(t.name, {description: t.desc, inputSchema: shape, annotations: {readOnlyHint: !t.act, destructiveHint: false, openWorldHint: false}},
      async args => {const r = await call(t.name, args || {}); return {content: [{type: 'text', text: JSON.stringify(r)}], isError: !!(r && r.offline)}});
  }
  return server;
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

// attachPlay(server, {backend?, origin, log, verbose, now, behavior?, mirror?}) -> {backend, stats, call, linkOf, links, behaviorIngest}
// embed: a scripts/embed.mjs semanticRecall (issue #553): recall and journal_search of a hero (and the DM's recall) get the meaning scores the game folds into its keyword ranking; without it, or when it has nothing, the tool answers as before.
// mirror: a scripts/memory-mirror.mjs writer (issue #155) for the page's {type:'mirror', seats} messages.
// behavior: a scripts/behavior-log.mjs writer (issue #129); without it the host keeps no behavior logs.
export function attachPlay(server, {backend = null, origin = 'http://localhost:5173', log = console.log, verbose = null, now = () => Date.now(), behavior = null, mirror = null, embed = null} = {}) {
  let links = () => ({}), runners = () => ({}); // defined below; the page's digests carry them
  // A wish (#663) is stamped with the model that holds its seat; nothing of it ever goes back out.
  const wishRunner = seat => {try {const s = String(seat || ''), r = s === 'dm' ? runnerOf(DM_KEY) : runnerOf(Number.isFinite(+s.slice(5)) ? +s.slice(5) : s.slice(5)); return r ? {provider: r.provider || null, model: r.model || null} : {}} catch (e) {return {}}};
  const behaviorIngest = (kind, rec) => behavior ? behavior.ingest(kind, kind === 'wish' && rec && rec.type === 'wish' ? {...wishRunner(rec.seat), ...rec} : rec, {links: links(), runners: runners()}) : false;
  const be = backend || browserBackend({log, onBehavior: behavior ? behaviorIngest : null, onWorld: behavior || mirror || embed ? (w, id) => {if (behavior) behavior.setWorld(w); if (mirror) mirror.setWorld(w, id); if (embed) embed.setWorld(w, id)} : null,
    onMirror: mirror ? seats => mirror.write(seats) : null, onHello: () => pushLinks()}); // mirror: scripts/memory-mirror.mjs (issue #155)
  const stats = {calls: 0, errors: 0};
  const claims = new Map(), act = new Map(); // hero id -> {runner, at} / {last, inflight}
  const vlog = rec => {if (!verbose) return; try {mkdirSync(dirname(verbose), {recursive: true}); appendFileSync(verbose, JSON.stringify(rec) + '\n')} catch (e) {log(`[play] verbose log failed: ${e.message}`)}};
  const claimOf = id => {const c = claims.get(id); return c && now() - c.at < CLAIM_MS ? c : null};
  const linkOf = id => {const a = act.get(id), busy = a && (a.inflight > 0 || now() - a.last < LINK_MS);
    return busy ? 'connected' : claimOf(id) ? 'waiting' : 'none'};
  links = () => Object.fromEntries((be.info().heroes || []).map(h => [h.id, linkOf(h.id)]));
  const runnerOf = id => {const c = claimOf(id); return c && c.info ? c.info : null};
  runners = () => Object.fromEntries((be.info().heroes || []).map(h => [h.id, runnerOf(h.id)]).filter(e => e[1]));
  // the DM seat (issue #66): open in the game?, its link and its runner's mind
  const dmOpen = () => !!(be.info().dm);
  // Start gate (issue #222): a seat is ready once its runner completed one warm-up model call (POST /play/ready).
  // Kept per seat for the runner that posted it: a new runner (a restart) starts over at 'claimed'.
  const readies = new Map(); // hero id | DM_KEY -> {runner, state, model?, ms?, at, error?}
  const readyOf = id => {const c = claimOf(id), r = readies.get(id); if (!c || !r || r.runner !== c.runner) return null; const {runner, ...o} = r; return o};
  const readyMap = () => Object.fromEntries((be.info().heroes || []).map(h => [h.id, readyOf(h.id)]).filter(e => e[1]));
  const dmInfo = () => {const r = runnerOf(DM_KEY), rd = readyOf(DM_KEY), pp = be.info().dmPrep; return {seat: dmOpen(), link: linkOf(DM_KEY), claimed: !!claimOf(DM_KEY), ...(r ? {runner: r} : {}), ...(rd ? {ready: rd} : {}), ...(pp ? {prep: pp} : {})}}; // prep: the DM's prep before the table opens (#437)
  const pushLinks = () => {if (be.links) be.links(links(), runners(), dmInfo(), readyMap())};
  const resolve = hero => hero != null ? hero : (defaultHero(be.info().heroes || []) || {}).id ?? null;

  // Every tool call goes through here: routed to one hero, counted, logged when verbose, never thrown.
  // In-game channels (issue #123): a claimed hero answers only the runner that claimed it, so no
  // process reads another seat's tool results (another hero's journal, events, chat) or acts for it.
  const heldBy = (id, rid) => {const c = id != null ? claimOf(id) : null; return c && c.runner !== rid ? c.runner : null};
  const refusedSeat = (id, holder) => ({ok: false, refused: true, error: `Hero #${id} is played by another runner (${holder}). A runner plays only the hero it claimed: name it (X-Eldmoor-Runner, or runner in the body).`});
  // Semantic memory search (issue #553). The agent never sets `_sem` or `_pool` (they are the relay's words to the game):
  // both are stripped from what it sends. For a query the relay asks the game for the texts to embed (`_pool`, one extra bridge call),
  // ranks them by meaning (scripts/embed.mjs, a 300 ms budget, a cold cache fills in the background) and passes the strengths on as
  // `_sem`; any failure or nothing to add leaves the call as the agent made it, so the tool ranks by keywords as it always did.
  const SEARCH = new Set(['recall', 'journal_search']);
  const bare = a => {if (a && typeof a === 'object' && ('_sem' in a || '_pool' in a)) {const {_sem, _pool, ...r} = a; return r} return a};
  async function meaning(tool, args, seat, ask) {
    if (!embed || !SEARCH.has(tool) || !args || typeof args.query !== 'string' || !args.query.trim() || (tool === 'recall' && args.id != null && args.id !== '')) return {args};
    try {
      const pr = await Promise.race([ask(), new Promise(res => setTimeout(() => res(null), 1500))]);
      if (!pr || pr.ok === false || !Array.isArray(pr.pool) || !pr.pool.length) return {args};
      const rk = await embed.rank({seat, pool: pr.pool, query: args.query});
      return rk && rk.hits ? {args: {...args, _sem: rk.sem}, note: ` [meaning ${rk.hits}/${rk.total}${rk.cold ? ', cold' : ''}, ${rk.ms} ms]`} : {args};
    } catch (e) {return {args}}
  }
  async function call(hero, tool, args, rid = null) {
    const t0 = now(), id = resolve(hero); stats.calls++;
    const holder = heldBy(id, rid); if (holder) {stats.errors++; log(`[play] #${id} ${tool} refused: held by ${holder}, asked by ${rid || 'no runner'}`); return refusedSeat(id, holder)}
    const a = id != null ? act.get(id) || {last: 0, inflight: 0} : null; if (a) {a.inflight++; a.last = t0; act.set(id, a); pushLinks()}
    if (behavior && id != null) behavior.call('hero:' + id);
    let r, note = '';
    args = bare(args);
    try {
      let send = args;
      if (id != null && embed && SEARCH.has(tool)) {const h = (be.info().heroes || []).find(x => x.id === id); if (h && h.alive !== false) {const m = await meaning(tool, args, {kind: 'hero', id, name: h.name}, () => be.call(id, tool, {_pool: true})); send = m.args; note = m.note || ''}}
      r = id == null ? paused('no agent hero') : await be.call(id, tool, send);
    } catch (e) {r = {ok: false, error: String(e.message || e)}}
    if (a) {a.inflight--; a.last = now(); pushLinks()}
    if (!r || typeof r !== 'object') r = {ok: false, error: 'no answer'};
    if (r.ok === false) stats.errors++;
    log(`[play] #${id ?? '?'} ${tool}${args && Object.keys(args).length ? ' ' + JSON.stringify(args) : ''} -> ${r.ok === false ? 'x ' + String(r.error).slice(0, 80) : 'ok'}${note} (${now() - t0} ms)`);
    vlog({ts: new Date().toISOString(), hero: id, tool, args, result: r, ms: now() - t0});
    return r;
  }
  // The DM's voice is answering a call (#682): a voice poll handed it a call (table/talk/ruling) and its answer has not come
  // yet. The runner supervisor lets a hero's Claude slot request yield DM_FIRST_MS meanwhile (scripts/runners.mjs).
  let dmVoiceAt = 0;
  const VOICE_POLLS = new Set(['table_call', 'npc_call', 'ruling_call']), VOICE_ANSWERS = new Set(['table_answer', 'ruling_answer', 'npc_say']);
  const dmVoiceBusy = () => dmVoiceAt > 0 && now() - dmVoiceAt < DM_VOICE_MS;
  // A DM tool call (issue #66): counted, logged, never thrown.
  async function dmCall(tool, args) {
    const t0 = now(); stats.calls++;
    const a = act.get(DM_KEY) || {last: 0, inflight: 0}; a.inflight++; a.last = t0; act.set(DM_KEY, a); pushLinks();
    if (behavior) behavior.call('dm');
    let r, note = '';
    args = bare(args);
    try {
      let send = args;
      if (embed && be.dmCall && SEARCH.has(tool) && tool === 'recall') {const m = await meaning(tool, args, {kind: 'dm'}, () => be.dmCall('recall', {_pool: true})); send = m.args; note = m.note || ''}
      r = be.dmCall ? await be.dmCall(tool, send) : {ok: false, error: 'This host has no DM seat.', offline: true};
    } catch (e) {r = {ok: false, error: String(e.message || e)}}
    a.inflight--; a.last = now(); pushLinks();
    if (!r || typeof r !== 'object') r = {ok: false, error: 'no answer'};
    if (r.ok === false) stats.errors++;
    if (VOICE_POLLS.has(tool) && r.ok && r.call && Number(r.call.seconds_left) > 0) dmVoiceAt = now(); else if (VOICE_ANSWERS.has(tool) && (tool !== 'npc_say' || (args && args.conv != null))) dmVoiceAt = 0;
    if ((tool === 'table_call' || tool === 'npc_call' || tool === 'ruling_call') && r.ok && !r.call) return r; // the runner's idle poll of the table (issue #132): not worth a log line
    log(`[play] DM ${tool}${args && Object.keys(args).length ? ' ' + JSON.stringify(args).slice(0, 200) : ''} -> ${r.ok === false ? 'x ' + String(r.error).slice(0, 80) : 'ok'}${note} (${now() - t0} ms)`);
    vlog({ts: new Date().toISOString(), role: 'dm', tool, args, result: r, ms: now() - t0});
    return r;
  }
  // A runner's turn line (issue #129): only the runner holding the seat may write it (issue #123: no seat writes
  // lines for another), and the host adds the hero's state header after the turn (src/sim/pace.js paceBrief).
  // A turn line also proves the seat's model answers (#563): a claimed seat with no warm-up record (an older runner, or
  // readiness lost to a relay restart) counts as ready once its runner has played a turn, so the start gate never holds
  // the world on a seat that is plainly playing.
  // A failed warm-up whose runner then plays a turn is ready too (owner decision on #559: a runner that plays is active).
  const turnPlayed = (key, rid) => {const r = readies.get(key); if (r && r.runner === rid && r.state !== 'failed') return; readies.set(key, {runner: rid, state: 'ready', implied: true, at: now(), ...(r && r.runner === rid && r.state === 'failed' ? {warmFailed: r.error || true} : {})}); pushLinks()};
  async function behaviorTurn(b, hero, rid, dm) {
    const rec = b.rec && typeof b.rec === 'object' ? b.rec : null; if (!rec) return [400, {ok: false, error: 'turn needs {rec}'}];
    if (dm) {const c = claimOf(DM_KEY); if (!c || c.runner !== rid) return [409, {ok: false, refused: true, error: 'Only the runner holding the DM seat writes its turns.'}];
      turnPlayed(DM_KEY, rid); if (!behavior) return [404, {ok: false, error: 'this host keeps no behavior logs'}];
      behavior.turn({...rec, seat: 'dm', hero: null, runner: rid, provider: (c.info && c.info.provider) || rec.provider, model: (c.info && c.info.model) || rec.model});
      // the game keeps the DM's per-turn record (issue #181): this turn's cost, model and seconds close it (DM-only data, never shown to heroes)
      if (be.dmCall) try {Promise.resolve(be.dmCall('turn_end', {turn: rec.turn, model: (c.info && c.info.model) || rec.model, provider: (c.info && c.info.provider) || rec.provider, cost: rec.cost, seconds: rec.seconds, tokensIn: rec.tokensIn, tokensOut: rec.tokensOut, cacheRead: rec.cacheRead, cacheWrite: rec.cacheWrite})).catch(() => {})} catch {}
      return [200, {ok: true}]}
    if (hero == null || Number.isNaN(hero)) return [400, {ok: false, error: 'turn needs the hero id'}];
    const c = claimOf(hero); if (!c || c.runner !== rid) return [409, {ok: false, refused: true, error: `Only the runner holding hero #${hero} writes its turns.`}];
    turnPlayed(hero, rid); if (!behavior) return [404, {ok: false, error: 'this host keeps no behavior logs'}];
    const h = (be.info().heroes || []).find(x => x.id === hero) || {id: hero, name: null};
    let after = null; try {const r = await Promise.race([be.call(hero, 'pace', {brief: true}), new Promise(res => setTimeout(() => res(null), 3000))]); after = r && r.ok && r.brief ? r.brief : null} catch {}
    const af = after ? {state: after.state, doing: after.doing || null, hp: after.hp, level: after.level, place: after.place || null, foe: after.foe || null, autopilot: !!after.autopilot, table: !!after.table, clock: after.clock || null} : null;
    behavior.turn({...rec, seat: 'hero:' + hero, hero: {id: hero, name: h.name}, runner: rid, after: af, clock: rec.clock || (af && af.clock) || null});
    return [200, {ok: true}];
  }
  // Link states change with time alone (claims and calls age out); refresh the page now and then.
  const tick = setInterval(() => {pushLinks(); if (embed) for (const h of (be.info().heroes || [])) if (h.alive === false) embed.drop({kind: 'hero', id: h.id, name: h.name})}, 2000); if (tick.unref) tick.unref();
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
    // the DM seat (issue #66): X-Eldmoor-Role: dm or ?role=dm (or role:'dm' in a /play/claim|release body)
    const q = new URLSearchParams(qs || ''), role = String(req.headers[ROLE_HEADER] || q.get('role') || '').trim().toLowerCase();
    let rid = runnerParam(req.headers[RUNNER_HEADER] || q.get('runner')); // the runner asking (a body field may override below)
    if (role && role !== 'dm' && role !== 'hero') return send(400, {error: 'unknown role (dm or hero)'});
    let hero = role === 'dm' ? null : heroParam(req.headers[HERO_HEADER]); if (hero === null && role !== 'dm') hero = heroParam(q.get('hero'));
    if (Number.isNaN(hero)) return send(400, {error: 'bad hero id (use the numeric id, e.g. X-Eldmoor-Hero: 12)'});
    try {
      if (path === '/mcp' && role === 'dm') {
        if (req.method !== 'POST') return send(405, {jsonrpc: '2.0', error: {code: -32000, message: 'Method not allowed (stateless server: POST only).'}, id: null});
        const body = await readBody(req);
        if (heroParam(req.headers[HERO_HEADER]) != null || heroParam(q.get('hero')) != null || [...claims.entries()].some(([k, c]) => k !== DM_KEY && c.runner === rid && now() - c.at < CLAIM_MS))
          return send(403, {jsonrpc: '2.0', error: {code: -32000, message: 'Heroes have no DM tools: a hero hears the DM only in the game.'}, id: null});
        const dh = heldBy(DM_KEY, rid); if (dh) return send(409, {jsonrpc: '2.0', error: {code: -32000, message: `The DM seat is held by another runner (${dh}).`}, id: null});
        const mcp = buildDmMcp((tool, args) => dmCall(tool, args)), transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true});
        res.on('close', () => {transport.close(); mcp.close()});
        await mcp.connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }
      if (path === '/play/health' && req.method === 'GET') {const i = be.info(), hs = i.heroes || [], d = defaultHero(hs);
        return send(200, {ok: true, connected: i.connected, hero: d ? {id: d.id, name: d.name, alive: d.alive} : null, heroes: hs.map(h => {const r = runnerOf(h.id), rd = readyOf(h.id); return {...h, link: linkOf(h.id), claimed: !!claimOf(h.id), ...(r ? {runner: r} : {}), ready: rd ? rd.state : null, ...(rd ? {warm: rd} : {})}}), dm: dmInfo(), ...stats})}
      if (path === '/mcp') {
        if (req.method !== 'POST') return send(405, {jsonrpc: '2.0', error: {code: -32000, message: 'Method not allowed (stateless server: POST only).'}, id: null});
        const body = await readBody(req);
        const mcp = buildMcp((tool, args) => call(hero, tool, args, rid)), transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true});
        res.on('close', () => {transport.close(); mcp.close()});
        await mcp.connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }
      if (req.method !== 'POST') return send(404, {error: 'not found'});
      const b = await readBody(req) || {};
      if (b.runner !== undefined) rid = runnerParam(b.runner);
      const heroClaimOf = r => r != null && [...claims.entries()].some(([k, c]) => k !== DM_KEY && c.runner === r && now() - c.at < CLAIM_MS);
      const dmAsked = role === 'dm' || b.role === 'dm';
      // POST /play/ready {hero | role:'dm', runner, state:'warming'|'ready'|'failed', model?, ms?, error?} (issue #222): only the runner holding the seat
      if (path === '/play/ready') {const dmSeat = dmAsked;
        const id = dmSeat ? DM_KEY : heroParam(b.hero ?? hero), runner = typeof b.runner === 'string' ? b.runner.slice(0, 80) : rid;
        if (id == null || Number.isNaN(id) || !runner) return send(400, {ok: false, error: 'ready needs {hero|role:"dm", runner, state}'});
        const c = claimOf(id); if (!c || c.runner !== runner) return send(409, {ok: false, refused: true, error: 'Only the runner holding this seat reports it ready.'});
        const state = ['warming', 'ready', 'failed'].includes(b.state) ? b.state : 'ready', prev = readies.get(id);
        const rec = {runner, state, at: state === 'warming' || !prev || prev.runner !== runner ? now() : prev.at,
          ...(typeof b.model === 'string' && runnerInfo({provider: 'x', model: b.model}).model ? {model: b.model} : {}), ...(Number.isFinite(Number(b.ms)) && b.ms != null ? {ms: Math.max(0, Math.round(Number(b.ms)))} : {}),
          ...(state === 'failed' && b.error ? {error: String(b.error).replace(/sk-[\w-]{8,}/g, '[key]').slice(0, 200)} : {})};
        readies.set(id, rec);
        if (state !== 'warming') log(`[play] ${id === DM_KEY ? 'DM seat' : 'hero #' + id} ${state === 'ready' ? 'ready' : 'warm-up failed'}${rec.model ? ' (' + rec.model + (rec.ms != null ? ', ' + (rec.ms / 1000).toFixed(1) + ' s' : '') + ')' : ''}${rec.error ? ': ' + rec.error : ''}`);
        pushLinks(); return send(200, {ok: true, ready: readyOf(id)})}
      if (path === '/play/behavior/turn') return send(...await behaviorTurn(b, b.hero !== undefined ? heroParam(b.hero) : hero, rid, dmAsked));
      if (path === '/play/dm') {
        if (typeof b.tool !== 'string' || !DM_TOOLS.some(t => t.name === b.tool)) return send(400, {error: 'unknown DM tool'});
        // seats stay apart (issue #123): a hero's runner has no DM tools, and a held DM seat answers only its runner
        if (role === 'hero' || b.role === 'hero' || hero != null || b.hero != null || heroClaimOf(rid)) return send(403, {ok: false, error: 'Heroes have no DM tools: a hero hears the DM only in the game.'});
        const dh = heldBy(DM_KEY, rid); if (dh) return send(409, {ok: false, refused: true, error: `The DM seat is held by another runner (${dh}).`});
        return send(200, await dmCall(b.tool, b.args && typeof b.args === 'object' ? b.args : {}))}
      if ((path === '/play/call' || path === '/play/narrate' || path === '/play/pace') && dmAsked) return send(403, {ok: false, error: 'The DM seat has no hero tools: the DM speaks to heroes only in the game (narrate, npc_say).'});
      if ((path === '/play/claim' || path === '/play/release') && (role === 'dm' || b.role === 'dm')) {
        const runner = typeof b.runner === 'string' ? b.runner.slice(0, 80) : '';
        if (!runner) return send(400, {error: 'claim needs {role:"dm", runner}'});
        const held = claimOf(DM_KEY);
        if (path === '/play/release') {if (held && held.runner === runner) {claims.delete(DM_KEY); log('[play] runner let go of the DM seat'); pushLinks()} return send(200, {ok: true})}
        if (held && held.runner !== runner) return send(409, {ok: false, error: `The DM seat already has a live runner (${held.runner}). One DM at a time.`});
        if (heroClaimOf(runner)) return send(409, {ok: false, error: 'This runner plays a hero; the DM seat needs a runner of its own (seats stay apart).'});
        if (!dmOpen()) return send(404, {ok: false, error: 'The DM seat is closed in this world: the page opens it for the world it plays; headless: start play-headless with --dm.'});
        const info = runnerInfo(b) || (held && held.info) || null;
        if (!held) log(`[play] runner ${runner} took the DM seat${info ? ' (' + info.provider + (info.model ? ' ' + info.model : '') + ')' : ''}`);
        claims.set(DM_KEY, {runner, at: now(), info}); pushLinks();
        return send(200, {ok: true, dm: dmInfo(), ...(info ? {runner: info} : {})})}
      if (b.hero !== undefined) {hero = heroParam(b.hero); if (Number.isNaN(hero)) return send(400, {error: 'bad hero id'})}
      if (path === '/play/call') {
        if (typeof b.tool !== 'string' || !PLAYER_TOOLS.some(t => t.name === b.tool)) return send(400, {error: 'unknown tool'});
        const r = await call(hero, b.tool, b.args && typeof b.args === 'object' ? b.args : {}, rid);
        return send(r && r.refused ? 409 : 200, r)}
      // Runner pacing (issue #126): the claimed runner's long poll between turns. Not a tool call: it is not
      // counted, not logged, and does not keep the link 'connected' (a runner between turns is 'waiting').
      if (path === '/play/pace') {const id = hero;
        if (id == null) return send(400, {ok: false, error: 'pace needs the hero id'});
        const holder = heldBy(id, rid); if (holder) return send(409, refusedSeat(id, holder));
        const a = b.args && typeof b.args === 'object' ? b.args : b, args = a.brief ? {brief: true, ...(a.self ? {self: true} : {})} : a.queued != null ? {queued: !!a.queued} : a.reflected != null ? {reflected: String(a.reflected).slice(0, 40), wrote: Number(a.wrote) || 0} : {since: a.since ?? null, minutes: a.minutes, wake: a.wake === 'now' || a.wake === 'must' ? a.wake : 'all', reflect: !!a.reflect, realMs: Math.min(30000, Math.max(0, Number(a.realMs) || 10000))};
        let r; try {r = await be.call(id, 'pace', args)} catch (e) {r = {ok: false, error: String(e.message || e)}}
        return send(200, r && typeof r === 'object' ? r : {ok: false, error: 'no answer'})}
      if (path === '/play/narrate') {const id = resolve(hero);
        const holder = heldBy(id, rid); if (holder) return send(409, refusedSeat(id, holder));
        if (id != null && typeof b.text === 'string' && b.text.trim()) {be.narrate(id, b.text.trim()); vlog({ts: new Date().toISOString(), hero: id, narrate: b.text.slice(0, 600)})}
        return send(200, {ok: true})}
      if (path === '/play/claim' || path === '/play/release') {
        const runner = typeof b.runner === 'string' ? b.runner.slice(0, 80) : '';
        if (hero == null || !runner) return send(400, {error: 'claim needs {hero, runner}'});
        const held = claimOf(hero);
        if (path === '/play/release') {if (held && held.runner === runner) {claims.delete(hero); act.delete(hero); log(`[play] runner let go of #${hero}`); pushLinks()} return send(200, {ok: true})}
        if (held && held.runner !== runner) return send(409, {ok: false, error: `Hero #${hero} already has a live agent runner (${held.runner}). One agent per hero.`});
        if (path === '/play/claim' && claimOf(DM_KEY) && claimOf(DM_KEY).runner === runner) return send(409, {ok: false, error: 'This runner holds the DM seat; a hero needs a runner of its own (seats stay apart).'});
        const h = (be.info().heroes || []).find(x => x.id === hero);
        if (!h) return send(404, {ok: false, error: `Hero #${hero} is not agent-played in this world.`});
        const info = runnerInfo(b) || (held && held.info) || null;
        if (!held) log(`[play] runner ${runner} took ${h.name} #${hero}${info ? ' (' + info.provider + (info.model ? ' ' + info.model : '') + ')' : ''}`);
        claims.set(hero, {runner, at: now(), info}); pushLinks();
        return send(200, {ok: true, hero: h, link: linkOf(hero), ...(info ? {runner: info} : {})})}
      send(404, {error: 'not found'});
    } catch (e) {if (!res.headersSent) send(400, {error: String(e.message || e)})}
  });
  // For the runner supervisor (scripts/runners.mjs): whether a live runner holds a hero, and dropping the
  // claims of a runner process that is gone (a stopped child cannot always release on its way out).
  const claimed = id => !!claimOf(id);
  const dropRunner = prefix => {let n = 0; for (const [id, c] of claims) if (c.runner === prefix || c.runner.startsWith(prefix + ':')) {claims.delete(id); act.delete(id); n++}
    if (n) {log(`[play] runner ${prefix} gone: ${n} claim(s) dropped`); pushLinks()} return n};
  const holderOf = id => {const c = claimOf(id); return c ? c.runner : null}; // the runner id holding a seat (the supervisor matches its children by host:pid, #563)
  return {backend: be, stats, call, dmCall, dmVoiceBusy, dmInfo, linkOf, links, runnerOf, readyOf, claimed, holderOf, dropRunner, behaviorIngest, behavior};
}
