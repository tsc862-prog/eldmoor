// Agent runner sessions, one file per hero (issue #93): logs/agents/<heroId>.json holds the Agent
// SDK session id, the system prompt it was built with, turns and cost for that hero only, so
// several runners (one per hero) never touch each other's files and switching heroes never
// discards a conversation. Hero ids restart with a new world, so a file whose hero name differs
// from the hero now behind that id belongs to an older world: it is moved to logs/agents/old/
// rather than overwritten. The single logs/agent-session.json of #75 is migrated on first use.
// Plain Node, no SDK import (scripts/playcheck.mjs tests it).
import {existsSync, readFileSync, writeFileSync, mkdirSync, renameSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const LOGS = join(ROOT, 'logs');
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
// Which hero a runner takes, from /play/health's heroes ([{id,name,alive,link}]):
// --hero NAME|ID names one (case-insensitive name, or id); without it the first living hero
// with no live runner (link 'none'). Returns {hero} or {error} with the list to choose from.
export function pickHero(heroes, want) {
  const list = (heroes || []).map(h => `${h.name} #${h.id}${h.alive ? '' : ' (dead)'}: ${h.link === 'none' ? 'free' : 'runner ' + h.link}`).join('; ') || 'none';
  if (want != null && String(want).trim()) {
    const w = String(want).trim().toLowerCase(), h = (heroes || []).find(x => String(x.id) === w || x.name.toLowerCase() === w);
    if (!h) return {error: `No agent-played hero "${want}". Agent-played heroes: ${list}. Press "Agent" on the hero in the game first.`};
    if (h.link && h.link !== 'none') return {error: `${h.name} #${h.id} already has a live agent runner (${h.link}). One agent per hero.`};
    return {hero: h};
  }
  const h = (heroes || []).find(x => x.alive && (!x.link || x.link === 'none'));
  return h ? {hero: h} : {error: `No free agent-played hero (${list}). Press "Agent" on another hero, or name one with --hero.`};
}
export function saveSession(sess, extra = {}, logs = LOGS) {writeAtomic(sessionPath(sess.heroId, logs), {...sess, ...extra, updated: new Date().toISOString()})}
