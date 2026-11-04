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
//   node scripts/play-headless.mjs --fellowship    found a Fellowship ("form one for me", Concord) with Minds
//                                                  set to agents: all five are agent-played (npm run fellowship);
//                                                  --no-relay keeps the world off the brain relay, --turn-ms MS the table
//                                                  turn budget, --watch never pauses for scenes
//   node scripts/play-headless.mjs --dm            open the DM seat (issue #66) for npm run dm -- --url http://127.0.0.1:8789
//                                                  (with --agents 0 no hero is agent-played: only the DM agent plays)
//   node scripts/play-headless.mjs --runners       runners can be started and stopped over HTTP (scripts/runners.mjs)
//
// Options: --port (or PLAY_PORT, default 8789), --speed (world speed, default 1),
// --warm N (fast-forward N real minutes at 1x before choosing heroes, default 0),
// --class C / --hero NAME[,NAME] / --agents N (who to play; default the highest-level living
// Concord hero), --world FILE (default logs/agent-world.json), --resume, --quiet, --log-world NAME (the behavior logs'
// folder, logs/behavior/<NAME>/, default <world id>-headless; issue #129; also the memory mirror's logs/agents/<NAME>/, #155),
// --wait-ready (issue #222: hold the world until every living agent hero and the DM seat report a completed
// warm-up model call, POST /play/ready; it opens the DM seat, #559, unless --no-dm; without it the world runs as before;
// while held, agent heroes get no turn and their acting tools are refused), --no-behavior (keep none), --no-mirror (no Markdown copy of the agents' memories), --embed (semantic recall through a local Ollama embedding model, #553; off by default so a headless run never reaches for Ollama on its own). The world is
// saved every minute and on exit, so `--resume` (and `npm run agent`, which keeps one session per
// hero in logs/agents/) pick up where they stopped.
import http from 'node:http';
import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';
import {init, step, S, snapshot, restore, isSave, markPlayer, playerSeat, playerSeats, playerNarrate, autoPick, TABLE, dmAct, dmSeatOn, setDmSeat, setRunnerLinks, planOpening, openingDue, beginPrep, endPrep, prepTick, prepView, prepActive, setPrepHost, setGateHold, setDmAlive} from '../src/sim/index.js';
import * as SLT from '../src/sim/company.js'; // the slotted company (#588)
import {onLog} from '../src/sim/chronicle.js';
import {hostCall, hostDm, seatInfo} from '../src/sim/player-host.js';
import {attachPlay, PLAY_LOG} from './relay-mcp.mjs';
import {attachRunners} from './runners.mjs';
import {behaviorLog} from './behavior-log.mjs';
import {makeWatch} from '../src/sim/behavior.js';
import {mirrorDirty} from '../src/sim/notebook.js';
import {memoryMirror} from './memory-mirror.mjs';
import {semanticRecall} from './embed.mjs'; // semantic memory search, opt in with --embed (issue #553)
import {ollamaAdapter} from './providers/ollama.mjs';
import {WORLD_ID} from '../src/world/map.js';
import {loadCampaigns} from './campaign-files.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const WORLD_FILE = join(ROOT, 'logs', 'agent-world.json');
const argv = process.argv.slice(2);
const opt = (k, d) => {const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d};
const flag = k => argv.includes('--' + k);

// The local backend: tool calls go straight into the sim through the shared host, for the hero
// the call names (attachPlay resolves a call without a hero to the first living agent hero).
// hostOpts is passed to hostCall (tests drive game time through it).
// links: the relay's claims per hero (attachPlay pushes them); the sim's decisions wait for a hero whose runner
// holds it and fall to reflex at once when none does (no owner to ask here, #148).
export function localBackend(hostOpts) {
  const seats = () => playerSeats();
  let linkMap = {}; setRunnerLinks(a => linkMap[a.id] || 'none');
  return {
    links: map => {linkMap = map && typeof map === 'object' ? map : {}},
    call: (heroId, tool, args) => {const a = heroId != null ? playerSeat(heroId) : playerSeat();
      return a ? hostCall(a.id, tool, args, hostOpts) : Promise.resolve({ok: false, error: heroId != null ? `Hero #${heroId} is not agent-played.` : 'No agent-played hero.', offline: true})},
    dmCall: (tool, args) => hostDm(tool, args, hostOpts), // the DM seat (issue #66): answered at once, the voice calls long-polled (#680)
    narrate: (heroId, text) => {const a = heroId != null ? playerSeat(heroId) : playerSeat(); if (a) playerNarrate(a.id, text)},
    info: () => ({connected: true, dm: dmSeatOn(), ...(prepView().state !== 'idle' ? {dmPrep: prepView()} : {}), heroes: seats().map(seatInfo)}),
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
  const port = Number(opt('port', process.env.PLAY_PORT || 8789)), quiet = flag('quiet'); let speed = Math.max(.25, Math.min(8, Number(opt('speed', 1))));
  loadCampaigns(); // the DM's campaign seed (docs/campaigns/<world>.md), before the world is built or restored
  const worldFile = opt('world', null) ? resolve(opt('world')) : WORLD_FILE;
  if (flag('resume') && existsSync(worldFile)) {
    const snap = JSON.parse(readFileSync(worldFile, 'utf8')); if (!isSave(snap)) throw new Error('not a save: ' + worldFile);
    restore(snap);
    console.log(`[play] resumed ${worldFile} at day ${Math.floor(S.gameMin / 1440) + 1}`);
  } else {
    const fs = flag('fellowship') || opt('fellowship', null); init(fs ? {fac: Number(opt('fac', 0)) === 1 ? 1 : 0} : {fellowship: false}); const warm = Number(opt('warm', 0)) * 3600; for (let i = 0; i < warm; i++) step(1 / 60);
  }
  // Heroes to play: named ones, else --agents N alternating the factions (Concord first).
  // The Fellowship (#68): found one with every member agent-played, unless the save already has one.
  if (flag('fellowship') || opt('fellowship', null)) {
    if (!SLT.slotted()) {const fac = Number(opt('fac', 0)) === 1 ? 1 : 0, r = SLT.foundSlots(SLT.autoPick(fac), {fac, ai: !flag('no-relay')}); if (!r.ok) throw new Error('could not found a Fellowship: ' + r.error)}
    SLT.setSlotMinds(SLT.slotted(), 'agent'); if (flag('no-relay')) S.brainOn = false; // --no-relay: never call a brain relay (sheets and table lines stay scripted)
    console.log(`[play] Fellowship: ${SLT.slotted().name} (${SLT.slotted().ids.length} members, Minds: agents)`);
  }
  TABLE.speed = speed; if (opt('turn-ms', null)) TABLE.turnMs = Math.max(1000, Number(opt('turn-ms'))); if (flag('watch')) TABLE.mode = 'off';
  const names = String(opt('hero', '') || '').split(',').map(s => s.trim()).filter(Boolean), want = Math.max(flag('dm') ? 0 : 1, Math.min(8, Number(opt('agents', names.length || 1)))); // --dm --agents 0: the DM agent alone
  for (const n of names) {const a = chooseHero({name: n}); if (!a) throw new Error('no living hero called ' + n); markPlayer(a, true)}
  for (let k = 0; !SLT.slotted() && playerSeats().filter(a => a.state !== 'dead').length < want && k < 16; k++) {
    const a = chooseHero({cls: opt('class', null), fac: k % 2}); if (!a) break; markPlayer(a, true)}
  // The DM is always an agent (#520, #559): --wait-ready plays the world as the page does, so it opens the DM seat and the
  // start gate counts it; --no-dm keeps a heroes-only hold (checks that test hero runners alone).
  if (flag('dm') || (flag('wait-ready') && !flag('no-dm'))) {setDmSeat(true); console.log('[play] DM seat open: npm run dm -- --url http://127.0.0.1:' + port)}
  // Session zero (issue #437): a new world opens with one opening Table scene per company once the world first runs (after
  // the start gate and the DM's prep with --wait-ready). --session-zero turns it on here; a setup world from the page has it.
  const resumed = flag('resume') && existsSync(worldFile);
  if (flag('wait-ready')) setPrepHost(true); // the DM's prep holds this world too (#437)
  if (flag('session-zero') && !resumed && planOpening()) console.log('[play] session zero: the opening scene opens when the world first runs');
  if (!playerSeats().length && !dmSeatOn()) throw new Error('no hero to play');
  for (const h of playerSeats()) console.log(`[play] agent hero: ${h.name} (#${h.id}), level ${h.lvl} ${h.cls} of ${h.fac ? 'the Warband' : 'the Concord'}${h.state === 'dead' ? ' (dead)' : ''}`);
  if (!quiet) onLog(e => {const t = e.parts.map(p => typeof p === 'string' ? p : p && p.kind === 'hero' ? p.name : p && p.t || '').join(''); if (playerSeats().some(h => t.includes(h.name))) console.log(`[world ${e.t}] ${t}`)});

  const save = () => {try {mkdirSync(dirname(worldFile), {recursive: true}); writeFileSync(worldFile, JSON.stringify(snapshot()))} catch (e) {console.error('[play] save failed: ' + e.message)}};
  let last = Date.now(), saveT = 0, playRef = null, heldSig = null, prepSig = null, prepping = false, ran = resumed;
  // --wait-ready (issue #222): the seats not ready yet, or [] (never held without the flag)
  // Continuous (owner decision on #559): a runner that stops or crashes releases its claim and holds the world again at once.
  // A failed warm-up whose runner still holds the seat counts as active.
  const active = id => {const r = playRef.readyOf(id); return !!(r && (r.state === 'ready' || r.state === 'failed') && playRef.claimed(id))};
  const notReady = () => {if (!flag('wait-ready') || !playRef) return [];
    const out = playerSeats().filter(h => h.state !== 'dead').filter(h => !active(h.id)).map(h => {const r = playRef.readyOf(h.id); return `${h.name}: ${r ? r.state + (r.error ? ' (' + r.error + ')' : '') : playRef.claimed(h.id) ? 'claimed' : 'no runner'}`});
    if (dmSeatOn()) {const r = playRef.readyOf('dm'); if (!active('dm')) out.push(`DM: ${r ? r.state + (r.error ? ' (' + r.error + ')' : '') : playRef.claimed('dm') ? 'claimed' : 'no runner'}`)}
    return out};
  setInterval(() => {const now = Date.now(), real = Math.min(.25, (now - last) / 1000); last = now;
    const wait = notReady(), ws = wait.join(' · '); setGateHold(wait.length > 0); // heroes get no turn and no acting tool while held (#559)
    if (ws !== heldSig) {if (ws) console.log(`[play] world held, waiting for minds: ${ws}`); else if (heldSig) console.log('[play] every mind is ready: the world runs'); heldSig = ws}
    if (prepping && !prepActive()) {const v = prepView(); console.log(`[play] the DM's prep is over (${v.why}: ${v.calls} calls, ${v.seconds} s)`); prepping = false} // prep_done may come just before its runner leaves
    if (wait.length) return;
    // the DM's prep (issue #437) with --wait-ready: once per ready DM runner, the full one before session zero, a short one on
    // --resume or for a DM runner started again; the world stays held until the DM ends it, a cap ends it or the seat goes
    if (flag('wait-ready') && playRef) {
      const rd = dmSeatOn() ? playRef.readyOf('dm') : null, liveDm = rd && rd.state === 'ready' && playRef.claimed('dm');
      prepTick(); if (prepActive() && !liveDm) endPrep('seat');
      if (!prepActive() && liveDm) {const k = JSON.stringify(rd); if (k !== prepSig) {prepSig = k; if (openingDue() || ran) {const v = beginPrep(openingDue() ? 'opening' : 'resume'); console.log(`[play] the DM prepares the table (${v.kind}: at most ${v.max_calls} calls, ${v.max_seconds} s)`)}}}
      if (prepActive()) {prepping = true; return}
    }
    ran = true;
    if (TABLE.drop) {if (speed > 1) {console.log(`[play] ${speed}x -> 1x: a Fellowship decision waits for its agents (${TABLE.drop.reason})`); speed = 1; TABLE.speed = 1} TABLE.drop = null} // #148
    const dt = real * speed, n = Math.ceil(dt / (1 / 60)); for (let i = 0; i < n; i++) step(dt / n);
    saveT += real; if (saveT >= 60) {saveT = 0; save()}}, 50);

  const server = http.createServer((req, res) => {res.writeHead(404, {'content-type': 'application/json'}); res.end('{"error":"not found"}')});
  // Behavior logs (issue #129): runners' turn lines, the world digest and game-side anomalies under logs/behavior/<world>/.
  const behavior = flag('no-behavior') ? null : behaviorLog({world: opt('log-world', WORLD_ID + '-headless'), log: console.log}), watch = behavior ? makeWatch({dmLink: () => playRef && playRef.claimed('dm') ? 'connected' : 'none'}) : null;
  // Semantic memory search (issue #553) is opt in here (--embed): a headless run never reaches for a local Ollama on its own.
  const embed = flag('embed') ? semanticRecall({adapter: ollamaAdapter({url: process.env.OLLAMA_URL || undefined}), world: opt('log-world', WORLD_ID + '-headless'), log: console.log}) : null;
  if (embed) embed.setWorld(opt('log-world', WORLD_ID + '-headless'), S.worldId);
  const play = attachPlay(server, {behavior, embed, backend: localBackend(), log: quiet ? () => {} : console.log, verbose: /^(1|true|yes)$/i.test(process.env.RELAY_VERBOSE || '') || flag('verbose') ? PLAY_LOG : null});
  playRef = play;
  setDmAlive(() => dmSeatOn() && playRef.claimed('dm')); // a claimed DM seat is a live runner: its calls wait their bounded time, then its reflexes fill (#561)
  if (watch) setInterval(() => {try {for (const o of watch.tick()) play.behaviorIngest(o.kind, o.rec)} catch (e) {console.error('[play] behavior watch: ' + e.message)}}, 250);
  // Agent memories (issue #155): the notebooks mirrored as Markdown under logs/agents/<world>/ (--no-mirror: none); written, never read back.
  const mirror = flag('no-mirror') ? null : memoryMirror({world: opt('log-world', WORLD_ID + '-headless'), log: console.log}), sentMem = new Map();
  if (mirror) mirror.setWorld(opt('log-world', WORLD_ID + '-headless'), S.worldId); // a fresh world purges the old one's memory folders; --resume keeps them
  const mirrorNow = () => {if (!mirror) return; try {const out = mirrorDirty(sentMem); if (out.length) {mirror.write(out); for (const o of out) sentMem.set(o.key, o.sig)}} catch (e) {console.error('[play] memory mirror: ' + e.message)}};
  if (mirror) setInterval(mirrorNow, 2000);
  // --runners (or RELAY_RUNNERS=1): runners can be started over HTTP (POST /play/runner/start), as from the game page
  const sup = attachRunners(server, {play, enabled: flag('runners') || /^(1|true|yes)$/i.test(process.env.RELAY_RUNNERS || ''), log: quiet ? () => {} : console.log, base: () => `http://127.0.0.1:${port}`});
  server.listen(port, '127.0.0.1', () => console.log(`[play] headless world at ${speed}x; MCP http://127.0.0.1:${port}/mcp  (plain: POST /play/call)\n[play] run one agent per hero: npm run agent -- --url http://127.0.0.1:${port} --hero <name>`));
  const stop = () => {sup.stopAll(); save(); mirrorNow(); console.log('[play] world saved to ' + worldFile); setTimeout(() => process.exit(0), 1000)};
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
