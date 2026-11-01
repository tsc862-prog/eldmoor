// Agent player, headless (issues #75, #93): runs the real sim in Node in real time (no browser),
// makes one or more heroes agent-played and serves the same tools as the relay: MCP at /mcp,
// plain JSON at /play/call, narration at /play/narrate, runner claims at /play/claim. Each agent
// runner names its hero (npm run agent -- --hero NAME), so several agents can play side by side.
//
//   npm run play-headless                          new world, port 8789, 1x speed, one agent hero
//   node scripts/play-headless.mjs --agents 2      two agent heroes (the top Concord and Warband heroes)
//   node scripts/play-headless.mjs --hero Ann,Bo   these heroes (by name or id)
//   node scripts/play-headless.mjs --port 8790 --speed 2 --warm 20 --class Hunter
//   node scripts/play-headless.mjs --resume        reload logs/agent-world.json and its agent heroes
//
// Options: --port (or PLAY_PORT, default 8789), --speed (world speed, default 1),
// --warm N (fast-forward N real minutes at 1x before choosing heroes, default 0),
// --class C / --hero NAME[,NAME] / --agents N (who to play; default the highest-level living
// Concord hero), --world FILE (default logs/agent-world.json), --resume, --quiet. The world is
// saved every minute and on exit, so `--resume` (and `npm run agent`, which keeps one session per
// hero in logs/agents/) pick up where they stopped.
import http from 'node:http';
import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';
import {init, step, S, snapshot, restore, isSave, markPlayer, playerSeat, playerSeats, playerNarrate} from '../src/sim/index.js';
import {onLog} from '../src/sim/chronicle.js';
import {hostCall} from '../src/sim/player-host.js';
import {attachPlay, PLAY_LOG} from './relay-mcp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const WORLD_FILE = join(ROOT, 'logs', 'agent-world.json');
const argv = process.argv.slice(2);
const opt = (k, d) => {const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d};
const flag = k => argv.includes('--' + k);

// The local backend: tool calls go straight into the sim through the shared host, for the hero
// the call names (attachPlay resolves a call without a hero to the first living agent hero).
// hostOpts is passed to hostCall (tests drive game time through it).
export function localBackend(hostOpts) {
  const seats = () => playerSeats();
  return {
    call: (heroId, tool, args) => {const a = heroId != null ? playerSeat(heroId) : playerSeat();
      return a ? hostCall(a.id, tool, args, hostOpts) : Promise.resolve({ok: false, error: heroId != null ? `Hero #${heroId} is not agent-played.` : 'No agent-played hero.', offline: true})},
    narrate: (heroId, text) => {const a = heroId != null ? playerSeat(heroId) : playerSeat(); if (a) playerNarrate(a.id, text)},
    info: () => ({connected: true, heroes: seats().map(a => ({id: a.id, name: a.name, alive: a.state !== 'dead'}))}),
  };
}

// Pick a hero to play in a fresh world.
export function chooseHero({cls = null, name = null, fac = 0, skip = []} = {}) {
  const live = S.agents.filter(a => a.state !== 'dead' && !a.hidden && !a.player && !skip.includes(a.id));
  if (name) {const n = String(name).toLowerCase(); return live.find(a => a.name.toLowerCase() === n || String(a.id) === n) || null}
  const pool = live.filter(a => a.fac === fac && (!cls || a.cls.toLowerCase() === String(cls).toLowerCase()));
  return pool.sort((x, y) => y.lvl - x.lvl || y.xp - x.xp)[0] || live[0] || null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(opt('port', process.env.PLAY_PORT || 8789)), speed = Math.max(.25, Math.min(8, Number(opt('speed', 1)))), quiet = flag('quiet');
  const worldFile = opt('world', null) ? resolve(opt('world')) : WORLD_FILE;
  if (flag('resume') && existsSync(worldFile)) {
    const snap = JSON.parse(readFileSync(worldFile, 'utf8')); if (!isSave(snap)) throw new Error('not a save: ' + worldFile);
    restore(snap);
    console.log(`[play] resumed ${worldFile} at day ${Math.floor(S.gameMin / 1440) + 1}`);
  } else {
    init(); const warm = Number(opt('warm', 0)) * 3600; for (let i = 0; i < warm; i++) step(1 / 60);
  }
  // Heroes to play: named ones, else --agents N alternating the factions (Concord first).
  const names = String(opt('hero', '') || '').split(',').map(s => s.trim()).filter(Boolean), want = Math.max(1, Math.min(8, Number(opt('agents', names.length || 1))));
  for (const n of names) {const a = chooseHero({name: n}); if (!a) throw new Error('no living hero called ' + n); markPlayer(a, true)}
  for (let k = 0; playerSeats().filter(a => a.state !== 'dead').length < want && k < 16; k++) {
    const a = chooseHero({cls: opt('class', null), fac: k % 2}); if (!a) break; markPlayer(a, true)}
  if (!playerSeats().length) throw new Error('no hero to play');
  for (const h of playerSeats()) console.log(`[play] agent hero: ${h.name} (#${h.id}), level ${h.lvl} ${h.cls} of ${h.fac ? 'the Warband' : 'the Concord'}${h.state === 'dead' ? ' (dead)' : ''}`);
  if (!quiet) onLog(e => {const t = e.parts.map(p => typeof p === 'string' ? p : p && p.kind === 'hero' ? p.name : p && p.t || '').join(''); if (playerSeats().some(h => t.includes(h.name))) console.log(`[world ${e.t}] ${t}`)});

  const save = () => {try {mkdirSync(dirname(worldFile), {recursive: true}); writeFileSync(worldFile, JSON.stringify(snapshot()))} catch (e) {console.error('[play] save failed: ' + e.message)}};
  let last = Date.now(), saveT = 0;
  setInterval(() => {const now = Date.now(), real = Math.min(.25, (now - last) / 1000); last = now;
    const dt = real * speed, n = Math.ceil(dt / (1 / 60)); for (let i = 0; i < n; i++) step(dt / n);
    saveT += real; if (saveT >= 60) {saveT = 0; save()}}, 50);

  const server = http.createServer((req, res) => {res.writeHead(404, {'content-type': 'application/json'}); res.end('{"error":"not found"}')});
  attachPlay(server, {backend: localBackend(), log: quiet ? () => {} : console.log, verbose: /^(1|true|yes)$/i.test(process.env.RELAY_VERBOSE || '') || flag('verbose') ? PLAY_LOG : null});
  server.listen(port, '127.0.0.1', () => console.log(`[play] headless world at ${speed}x; MCP http://127.0.0.1:${port}/mcp  (plain: POST /play/call)\n[play] run one agent per hero: npm run agent -- --url http://127.0.0.1:${port} --hero <name>`));
  const stop = () => {save(); console.log('[play] world saved to ' + worldFile); process.exit(0)};
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
