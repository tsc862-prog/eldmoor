// Agent player, headless (issue #75): runs the real sim in Node in real time (no browser),
// makes one hero agent-played and serves the same tools as the relay: MCP at /mcp, plain
// JSON at /play/call, narration at /play/narrate. For testing, CI and playing without the UI.
//
//   npm run play-headless                       new world, port 8789, 1x speed
//   node scripts/play-headless.mjs --port 8790 --speed 2 --warm 20 --class Hunter
//   node scripts/play-headless.mjs --resume     reload logs/agent-world.json and its agent hero
//
// Options: --port (or PLAY_PORT, default 8789), --speed (world speed, default 1),
// --warm N (fast-forward N real minutes at 1x before choosing a hero, default 0),
// --class C / --hero NAME (who to play; default the highest-level living Concord hero),
// --resume, --quiet. The world is saved to logs/agent-world.json every minute and on exit,
// so `--resume` (and `npm run agent`, which keeps its session id in logs/agent-session.json)
// pick up where they stopped.
import http from 'node:http';
import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {init, step, S, snapshot, restore, isSave, markPlayer, playerSeat, playerNarrate} from '../src/sim/index.js';
import {onLog} from '../src/sim/chronicle.js';
import {hostCall} from '../src/sim/player-host.js';
import {attachPlay, PLAY_LOG} from './relay-mcp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const WORLD_FILE = join(ROOT, 'logs', 'agent-world.json');
const argv = process.argv.slice(2);
const opt = (k, d) => {const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d};
const flag = k => argv.includes('--' + k);

// The local backend: tool calls go straight into the sim through the shared host.
export function localBackend(getHero) {
  return {
    call: (tool, args) => {const a = getHero(); return a ? hostCall(a.id, tool, args) : Promise.resolve({ok: false, error: 'No agent-played hero.'})},
    narrate: text => {const a = getHero(); if (a) playerNarrate(a.id, text)},
    info: () => {const a = getHero(); return {connected: true, hero: a ? {id: a.id, name: a.name, alive: a.state !== 'dead'} : null}},
  };
}

// Pick the hero to play in a fresh world.
export function chooseHero({cls = null, name = null} = {}) {
  const live = S.agents.filter(a => a.state !== 'dead' && !a.hidden);
  if (name) return live.find(a => a.name.toLowerCase() === String(name).toLowerCase()) || null;
  const pool = live.filter(a => a.fac === 0 && (!cls || a.cls.toLowerCase() === String(cls).toLowerCase()));
  return pool.sort((x, y) => y.lvl - x.lvl || y.xp - x.xp)[0] || live[0] || null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(opt('port', process.env.PLAY_PORT || 8789)), speed = Math.max(.25, Math.min(8, Number(opt('speed', 1)))), quiet = flag('quiet');
  let heroId = null;
  if (flag('resume') && existsSync(WORLD_FILE)) {
    const snap = JSON.parse(readFileSync(WORLD_FILE, 'utf8')); if (!isSave(snap)) throw new Error('not a save: ' + WORLD_FILE);
    restore(snap); const a = playerSeat(); heroId = a ? a.id : null;
    console.log(`[play] resumed ${WORLD_FILE} at day ${Math.floor(S.gameMin / 1440) + 1}${a ? ', playing ' + a.name : ''}`);
  } else {
    init(); const warm = Number(opt('warm', 0)) * 3600; for (let i = 0; i < warm; i++) step(1 / 60);
  }
  if (heroId == null) {const a = chooseHero({cls: opt('class', null), name: opt('hero', null)}); if (!a) throw new Error('no hero to play'); markPlayer(a, true); heroId = a.id}
  const hero = () => S.agents.find(x => x.id === heroId) || null;
  const h = hero(); console.log(`[play] agent hero: ${h.name} (#${h.id}), level ${h.lvl} ${h.cls} of ${h.fac ? 'the Warband' : 'the Concord'}`);
  if (!quiet) onLog(e => {const t = e.parts.map(p => typeof p === 'string' ? p : p && p.kind === 'hero' ? p.name : p && p.t || '').join(''); if (t.includes(h.name)) console.log(`[world ${e.t}] ${t}`)});

  const save = () => {try {mkdirSync(dirname(WORLD_FILE), {recursive: true}); writeFileSync(WORLD_FILE, JSON.stringify(snapshot()))} catch (e) {console.error('[play] save failed: ' + e.message)}};
  let last = Date.now(), saveT = 0;
  setInterval(() => {const now = Date.now(), real = Math.min(.25, (now - last) / 1000); last = now;
    const dt = real * speed, n = Math.ceil(dt / (1 / 60)); for (let i = 0; i < n; i++) step(dt / n);
    saveT += real; if (saveT >= 60) {saveT = 0; save()}}, 50);

  const server = http.createServer((req, res) => {res.writeHead(404, {'content-type': 'application/json'}); res.end('{"error":"not found"}')});
  attachPlay(server, {backend: localBackend(hero), log: quiet ? () => {} : console.log, verbose: /^(1|true|yes)$/i.test(process.env.RELAY_VERBOSE || '') || flag('verbose') ? PLAY_LOG : null});
  server.listen(port, '127.0.0.1', () => console.log(`[play] headless world at ${speed}x; MCP http://127.0.0.1:${port}/mcp  (plain: POST /play/call)`));
  const stop = () => {save(); console.log('[play] world saved to ' + WORLD_FILE); process.exit(0)};
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
