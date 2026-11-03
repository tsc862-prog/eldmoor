// Agent runner sessions, one file per hero (issue #93): logs/agents/<heroId>.json holds the Agent
// SDK session id, the system prompt it was built with, turns and cost for that hero only, so
// several runners (one per hero) never touch each other's files and switching heroes never
// discards a conversation. Hero ids restart with a new world, so a file whose hero name differs
// from the hero now behind that id belongs to an older world: it is moved to logs/agents/old/
// rather than overwritten. The single logs/agent-session.json of #75 is migrated on first use.
// Plain Node, no SDK import (scripts/playcheck.mjs tests it).
import {existsSync, readFileSync, writeFileSync, mkdirSync, renameSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const LOGS = process.env.AGENT_LOGS ? resolve(process.env.AGENT_LOGS) : join(ROOT, 'logs'); // AGENT_LOGS: tests keep their sessions elsewhere
export const sessionDir = (logs = LOGS) => join(logs, 'agents');
export const sessionPath = (heroId, logs = LOGS) => join(sessionDir(logs), Math.floor(Number(heroId)) + '.json');
const readJson = f => {try {return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null} catch {return null}};
const safe = s => String(s || 'hero').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40);
// Write through a temp file and rename, so a crash mid-write never leaves half a session.
function writeAtomic(f, obj) {mkdirSync(dirname(f), {recursive: true}); const tmp = f + '.' + process.pid + '.tmp'; writeFileSync(tmp, JSON.stringify(obj, null, 1)); renameSync(tmp, f)}
function archive(f, s, logs) {const to = join(sessionDir(logs), 'old', `${s.heroId}-${safe(s.heroName)}-${Date.now()}.json`); mkdirSync(dirname(to), {recursive: true}); renameSync(f, to); return to}

// Move the #75 single session file into the per-hero folder (once). Returns a note or null.
export function migrateLegacy(logs = LOGS) {
  const old = join(logs, 'agent-session.json'), s = readJson(old);
  if (!s) return null;
  if (s.heroId == null) {renameSync(old, old + '.migrated'); return 'old session file had no hero; kept as agent-session.json.migrated'}
  const f = sessionPath(s.heroId, logs);
  if (existsSync(f)) {const to = join(sessionDir(logs), 'old', `${s.heroId}-${safe(s.heroName)}-legacy.json`); mkdirSync(dirname(to), {recursive: true}); renameSync(old, to); return `old session for ${s.heroName} kept at ${to} (a newer one exists)`}
  mkdirSync(dirname(f), {recursive: true}); renameSync(old, f);
  return `moved logs/agent-session.json to ${f} (${s.heroName})`;
}

// The session for this hero, or a fresh one. fresh(): the new session object to start.
// Returns {sess, note}; note says when an older world's file was set aside.
export function loadSession(heroId, heroName, fresh, {logs = LOGS, startNew = false} = {}) {
  const f = sessionPath(heroId, logs), s = readJson(f);
  if (s && s.heroId === heroId && s.heroName === heroName && !startNew) return {sess: s, note: null};
  let note = null;
  if (s && (s.heroName !== heroName || startNew)) note = 'earlier session kept at ' + archive(f, s, logs);
  return {sess: fresh(), note};
}
// Per-hero runner settings, kept in the session file as sess.runner = {provider, model, effort}.
// Each hero can have its own mind: 'anthropic' (Claude Agent SDK) and 'ollama' (a local model through
// scripts/local-agent.mjs) both run in scripts/agent-player.mjs and scripts/fellowship.mjs; the relay routes by hero id alone and never assumes a model or an SDK, so
// other providers can read the same file later. Precedence: command-line overrides,
// then the hero's saved settings, then the defaults (environment / built-in). Returns the settings
// and whether they changed what was saved.
export const DEFAULT_PROVIDER = 'anthropic';
export const RUNNER_PROVIDERS = ['anthropic', 'ollama', 'openai', 'huggingface']; // providers with an agent runner (google: not yet)
export function runnerSettings(sess, overrides = {}, defaults = {}) {
  const saved = sess && sess.runner && typeof sess.runner === 'object' ? sess.runner : {};
  const pick = k => overrides[k] != null && overrides[k] !== '' ? String(overrides[k]) : saved[k] != null ? String(saved[k]) : defaults[k] != null ? String(defaults[k]) : null;
  const r = {provider: pick('provider') || DEFAULT_PROVIDER, model: pick('model'), effort: pick('effort')};
  // a provider switch drops the saved model and effort (they belong to the old provider)
  if (saved.provider && r.provider !== saved.provider) {r.model = overrides.model || defaults.model || null; r.effort = overrides.effort || defaults.effort || null}
  const changed = JSON.stringify(saved) !== JSON.stringify(r);
  return {runner: r, changed};
}

// A recruit who took a fallen hero's place (issue #452: /play/health heroes[].succeeds) plays with the fallen hero's runner
// settings until it has its own: read from the predecessor's session file (never written). Returns true when it took them.
export function inheritRunner(sess, fromId, logs = LOGS) {
  if (!sess || (sess.runner && typeof sess.runner === 'object') || !Number.isInteger(fromId)) return false;
  const s = readJson(sessionPath(fromId, logs)); if (!s || !s.runner || typeof s.runner !== 'object') return false;
  sess.runner = {...s.runner}; sess.inherited = fromId; return true;
}

// Which hero a runner takes, from /play/health's heroes ([{id,name,alive,link}]):
// --hero NAME|ID names one (case-insensitive name, or id); without it the first living hero
// with no live runner (link 'none'). Returns {hero} or {error} with the list to choose from.
// Held by a live runner: the claim decides when health reports it (a runner that just let go still
// shows 'connected' for a few seconds after its last call, and may start again at once).
const busy = h => h.claimed != null ? !!h.claimed || h.link === 'waiting' : !!h.link && h.link !== 'none';
export function pickHero(heroes, want) {
  const list = (heroes || []).map(h => `${h.name} #${h.id}${h.alive ? '' : ' (dead)'}: ${h.link === 'none' ? 'free' : 'runner ' + h.link}`).join('; ') || 'none';
  if (want != null && String(want).trim()) {
    const w = String(want).trim().toLowerCase(), h = (heroes || []).find(x => String(x.id) === w || x.name.toLowerCase() === w);
    if (!h) return {error: `No agent-played hero "${want}". Agent-played heroes: ${list}. Press "Agent" on the hero in the game first.`};
    if (busy(h)) return {error: `${h.name} #${h.id} already has a live agent runner (${h.link}). One agent per hero.`};
    return {hero: h};
  }
  const h = (heroes || []).find(x => x.alive && !busy(x));
  return h ? {hero: h} : {error: `No free agent-played hero (${list}). Press "Agent" on another hero, or name one with --hero.`};
}
export function saveSession(sess, extra = {}, logs = LOGS) {writeAtomic(sessionPath(sess.heroId, logs), {...sess, ...extra, updated: new Date().toISOString()})}

// ---- the DM seat (issue #66): one session for the DM agent, logs/agents/dm.json ----
// The file carries the world tag the game reports (dm_status.world); a file from another world, or
// the old one on --new, is moved to logs/agents/old/ rather than overwritten, like a hero's.
export const dmSessionPath = (logs = LOGS) => join(sessionDir(logs), 'dm.json');
export function loadDmSession(world, fresh, {logs = LOGS, startNew = false} = {}) {
  const f = dmSessionPath(logs), s = readJson(f);
  if (s && s.world === world && !startNew) return {sess: s, note: null};
  let note = null;
  if (s) {const to = join(sessionDir(logs), 'old', `dm-${safe(s.world)}-${Date.now()}.json`); mkdirSync(dirname(to), {recursive: true}); renameSync(f, to); note = 'earlier DM session kept at ' + to}
  return {sess: fresh(), note};
}
export function saveDmSession(sess, extra = {}, logs = LOGS) {writeAtomic(dmSessionPath(logs), {...sess, ...extra, updated: new Date().toISOString()})}
// The DM runner as a row for the relay's runner supervisor (scripts/runners.mjs RUNNER_KINDS, in-app
// Start/Stop). Same shape as its 'hero' and 'fellowship' rows; needsDmSeat: start only while the game
// reports an open DM seat (/play/health dm.seat), since it plays no hero.
export const DM_RUNNER_KIND = {script: 'scripts/dm-agent.mjs', label: 'DM runner', needsHero: false, needsDmSeat: true,
  defaults: {maxTurns: 12, budget: 1}, caps: {maxTurns: 200, budget: 5},
  key: () => 'dm', args: () => [], heroes: () => []};
