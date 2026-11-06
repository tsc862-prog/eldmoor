// The narrator voice (issue #554): the DM's narration, townsfolk lines and the heroes' own lines read aloud
// by a LOCAL text-to-speech engine that the relay serves (scripts/providers/tts.mjs). The browser only plays audio it
// fetches from the relay (POST /tts/say, GET /tts?id=); nothing is generated here and nothing is sent anywhere else.
// Audio is for the watcher only: speaking changes nothing about who hears what in the game (channelcheck is unaffected).
//   - plays behind the page's Sound switch (the gate passed to initVoice); silent until the page had a click or key
//   - one queue, never overlapping; order: Table lines (0, in full and in order: the world waits at 1x), recaps (0.5),
//     npc_say (1), narrate in the open world (2), hero lines in the open world (3)
//   - heroes speak in their own voices (voices.js pickVoice, one per hero) by default (#1015). Out in the world only the
//     NEWEST line of each speaker is kept (a newer line from the same speaker replaces a queued one) and the queued world
//     speech is capped at BACKLOG_S seconds, so the voice is about what is on screen, never a pile
//   - age limits by kind (AGE_MS): world lines 20 s (heroes 10 s), Table lines 60 s, recaps 90 s; at 3x/8x only Table
//     lines and recaps are heard
//   - recaps (#1015): after a Table scene closes (its title and outcome) and once a game day from 06:00 (the followed
//     company's campaign log): the game's own words, no model call, no cost, in the narrator's voice, to the watcher only
//   - Voice mode (localStorage): all (default) | scenes (Table lines and recaps) | recaps (recaps only)
//   - the engine's speaking rate is RATE, passed to the relay as `speed`
//   - no engine: silent, one hint line in Settings, Sound behaves as before
// Pure parts (makeVoiceQueue, scanLines, recapOfScene, dailyRecap) are used by scripts/ttscheck.mjs without a browser.
import {S} from '../sim/state.js';
import {pickVoice} from '../data/voices.js';
import {CFG} from '../sim/brain.js';
import {followed} from '../sim/company.js';

export const MAX_AGE_MS = 20000, QUEUE_MAX = 8, PRI = {table: 0, recap: 0.5, npc: 1, narrate: 2, hero: 3};
export const AGE_MS = {table: 60000, recap: 90000, npc: MAX_AGE_MS, narrate: MAX_AGE_MS, hero: 10000};
export const RATE = 1.15, CPS = 15, BACKLOG_S = 10; // speaking rate; characters a second at rate 1 (about); seconds of world speech that may wait
export const MODES = ['all', 'scenes', 'recaps'], MODE_KINDS = {all: ['table', 'recap', 'npc', 'narrate', 'hero'], scenes: ['table', 'recap'], recaps: ['recap']};
export const MODE_TEXT = {all: 'Voices: all', scenes: 'Voices: scenes and recaps', recaps: 'Voices: recaps only'};
export const allowedAt = (kind, speed) => !(speed > 1 && kind !== 'table' && kind !== 'recap'); // 3x/8x mutes all but Table scenes and recaps
export const speechSeconds = (text, rate = RATE) => String(text || '').length / CPS / rate; // an estimate, for the backlog and the report
const WORLD = k => k === 'npc' || k === 'narrate' || k === 'hero';

// The queue. speak(line) -> Promise<url|null> (null: engine gone), play(url, line) -> Promise (resolves when the clip ends).
export function makeVoiceQueue({speak, play, now = Date.now, maxAge = null, cap = QUEUE_MAX, speed = () => 1, gate = () => true, onDown = null, kinds = () => null, backlog = BACKLOG_S} = {}) {
  const q = [], st = {played: 0, dropped: 0, failed: 0, order: [], seen: 0, replaced: 0, spokenS: {}, seenS: {}};
  let busy = false;
  const ageOf = L => maxAge != null ? maxAge : AGE_MS[L.kind] || MAX_AGE_MS;
  const kindOk = k => {const ks = kinds(); return !ks || ks.includes(k)};
  const stale = L => now() - L.t > ageOf(L), muted = L => !allowedAt(L.kind, speed()) || !kindOk(L.kind);
  const drop = () => {st.dropped++};
  function pick() {
    for (let i = q.length - 1; i >= 0; i--) if (stale(q[i]) || muted(q[i])) {q.splice(i, 1); drop()}
    if (!q.length) return null;
    let b = 0; for (let i = 1; i < q.length; i++) if (PRI[q[i].kind] < PRI[q[b].kind] || PRI[q[i].kind] === PRI[q[b].kind] && q[i].t < q[b].t) b = i;
    return q.splice(b, 1)[0];
  }
  async function pump() {
    if (busy) return; busy = true;
    try {
      for (;;) {
        if (!gate()) {st.dropped += q.length; q.length = 0; break}
        const L = pick(); if (!L) break;
        let url = null; try {url = await speak(L)} catch {}
        if (!url) {st.failed++; if (onDown) onDown(); st.dropped += q.length; q.length = 0; break}
        if (stale(L) || muted(L) || !gate()) {drop(); continue}
        st.order.push(L.id); st.played++; st.spokenS[L.kind] = (st.spokenS[L.kind] || 0) + speechSeconds(L.text);
        try {await play(url, L)} catch {}
      }
    } finally {busy = false}
  }
  return {
    push(L) {
      if (!gate() || !allowedAt(L.kind, speed()) || !kindOk(L.kind)) {drop(); return false}
      st.seen++; st.seenS[L.kind] = (st.seenS[L.kind] || 0) + speechSeconds(L.text);
      if (WORLD(L.kind)) { // out in the world the newest line of a speaker wins
        const key = L.who || L.kind;
        for (let i = q.length - 1; i >= 0; i--) if (WORLD(q[i].kind) && (q[i].who || q[i].kind) === key) {q.splice(i, 1); st.replaced++; drop()}
      }
      q.push({...L, t: L.t ?? now()});
      const wait = () => q.reduce((n, x) => n + (WORLD(x.kind) ? speechSeconds(x.text) : 0), 0); // and only a few seconds of world speech may wait
      while (wait() > backlog && q.some(x => WORLD(x.kind))) {
        let w = -1; for (let i = 0; i < q.length; i++) if (WORLD(q[i].kind) && (w < 0 || q[i].t < q[w].t)) w = i;
        q.splice(w, 1); drop();
      }
      while (q.length > cap) { // overflow: the lightest, oldest line goes
        let w = 0; for (let i = 1; i < q.length; i++) if (PRI[q[i].kind] > PRI[q[w].kind] || PRI[q[i].kind] === PRI[q[w].kind] && q[i].t < q[w].t) w = i;
        q.splice(w, 1); drop();
      }
      pump(); return true;
    },
    clear() {st.dropped += q.length; q.length = 0},
    get size() {return q.length}, get busy() {return busy}, stats: st,
  };
}

const plain = ps => (ps || []).map(p => typeof p === 'string' ? p : p && p.kind === 'hero' ? p.name : p && p.t || '').join('');
const clean = t => String(t || '').replace(/\s+/g, ' ').trim();
const firstSentences = (t, n, max) => {
  const m = clean(t).match(/[^.!?]+[.!?]+/g) || [clean(t)]; let o = '';
  for (const x of m.slice(0, n)) if ((o + x).length <= max) o += x; else break;
  return clean(o || clean(t).slice(0, max));
};

// ---- recaps (#1015): in-game words from the game's own record, no model call ----
export function recapOfScene(last) {
  const title = clean(typeof last.title === 'string' ? last.title : plain(last.title)).replace(/[.!?]+$/, '');
  return clean((title ? 'At the table, ' + title + '. ' : '') + firstSentences(last.summary, 2, 220));
}
const DAY_KINDS = {death: 5, table: 4, level: 3, oath: 3, kill: 2, outcome: 2, adventure: 2, found: 2, recruit: 2, join: 2, fight: 1};
// Once a game day, from 06:00: what the followed company did in the last day, from its campaign log (the three weightiest entries, oldest first).
export function dailyRecap(St, st, C) {
  const min = St.gameMin; if (min == null) return null;
  const day = Math.floor(min / 1440), h = (min / 60) % 24;
  if (st.recapDay == null) {st.recapDay = h >= 6 ? day : day - 1; return null} // the first scan reads no past
  if (h < 6 || day <= st.recapDay) return null;
  st.recapDay = day;
  const log = ((C && C.log) || []).filter(e => e.gameMin != null && min - e.gameMin <= 1440 && DAY_KINDS[e.kind]);
  const pick = log.slice().sort((a, b) => DAY_KINDS[b.kind] - DAY_KINDS[a.kind] || b.gameMin - a.gameMin).slice(0, 3).sort((a, b) => a.gameMin - b.gameMin);
  if (!pick.length) return null;
  const name = clean(C.name) || 'The company';
  return {day, text: 'Day ' + (day + 1) + ', at first light. ' + name + ' remembers the last day. ' + pick.map(e => firstSentences(plain(e.parts), 1, 140)).join(' ')};
}

// What is new to say. st = {lastId (DM log), frame, narr, bubbles{}, recent[], ...}; returns lines [{id, text, kind, voice, who?}].
// The first scan only records where the log stands, so a loaded world does not read its past aloud.
export function scanLines(St, st, {heroes = true, company = null} = {}) {
  const out = [], push = (id, text, kind, speaker, who) => {
    text = clean(text); if (!text || st.recent.includes(text)) return; st.recent.push(text); if (st.recent.length > 12) st.recent.shift();
    out.push({id, text, kind, voice: pickVoice(speaker), ...(who ? {who} : {})});
  };
  const sc = St.table, log = St.dmLog || [];
  const top = log.length ? log[0].id : 0;
  if (st.lastId == null) st.lastId = top;
  const fresh = top > st.lastId ? log.filter(e => e.id > st.lastId).reverse() : []; st.lastId = Math.max(st.lastId, top);
  if (sc) {
    st.last = {id: sc.id, title: sc.title, summary: sc.summary || ''};
    // a hero's spoken line at the table (a beat with a line), in order and in the hero's own voice; a scene already open at the first scan is not read from its start
    const bs = sc.beats || [];
    if (st.beatsOf !== sc.id) {st.beatsOf = sc.id; st.beats = st.seenAny ? 0 : bs.length}
    for (; st.beats < bs.length; st.beats++) {
      const b = bs[st.beats]; if (!b || !b.line || b.by === 'foe') continue;
      const a = (St.agents || []).find(x => x.id === b.id);
      if (a && a.player && heroes) push('b' + sc.id + '.' + st.beats, b.line, 'table', {kind: 'hero', name: a.name, cls: a.cls, sex: a.sex, fac: a.fac}, a.id);
    }
    if (st.frame !== sc.id) {st.frame = sc.id; push('f' + sc.id, plain(sc.frame), 'table', {kind: 'narrator'})}
    const n = sc.narr, key = n ? n.t + '|' + n.text : null;
    if (n && n.text && key !== st.narr) {st.narr = key; push('n' + key, n.text, 'table', {kind: 'narrator'})}
  } else {
    if (st.last && st.last.summary) push('r' + st.last.id, recapOfScene(st.last), 'recap', {kind: 'narrator'}); // the scene closed: say how it ended
    st.last = null; st.frame = null; st.narr = null; st.beatsOf = null;
  }
  st.seenAny = true;
  const dr = dailyRecap(St, st, company); if (dr) push('d' + dr.day, dr.text, 'recap', {kind: 'narrator'});
  for (const e of fresh) {
    const d = e.detail || {}; if (e.kind !== 'agent' || !d.text) continue;
    if (d.voice === 'narrate') push('d' + e.id, d.text, sc ? 'table' : 'narrate', {kind: 'narrator'});
    else if (d.voice === 'npc_say') {const p = (St.npcs || []).find(x => x.id === d.npc); push('d' + e.id, d.text, 'npc', {kind: 'npc', role: p && p.role, fac: p && p.fac, name: p && p.name}, 'npc' + d.npc)}
  }
  if (heroes) for (const a of St.agents || []) {
    const b = a.player && a.bubble; if (!b || !b.text) { if (st.bubbles[a.id] && !b) st.bubbles[a.id] = null; continue }
    const key = b.text; if (st.bubbles[a.id] === key) continue; st.bubbles[a.id] = key;
    push('h' + a.id + '|' + key, b.text, 'hero', {kind: 'hero', name: a.name, cls: a.cls, sex: a.sex, fac: a.fac}, a.id);
  }
  return out;
}
export const newScan = () => ({lastId: null, frame: null, narr: null, bubbles: {}, recent: [], last: null, beatsOf: null, beats: 0, recapDay: null, seenAny: false});

// ---- the browser side ----
const VOL = 'eldmoor.voiceVol', HERO = 'eldmoor.voiceHeroes', MODE = 'eldmoor.voiceMode';
const $ = id => document.getElementById(id);
let base = '', queue = null, scan = newScan(), engine = null /* null unknown, true, false */, nextCheck = 0, vol = 0.8, heroes = true, mode = 'all', cur = null, speedNow = 1, gate = () => false;
export const voiceStats = () => queue ? {...queue.stats, queued: queue.size, mode} : null; // seconds offered and spoken per kind, to measure against the game hour

async function checkEngine(t) {
  nextCheck = t + 60000;
  try {const r = await fetch(base + '/tts/status'); const j = await r.json(); engine = !!j.ok; syncUi(j)}
  catch {engine = false; syncUi({error: 'relay not reachable'})}
}
function syncUi(j) {
  const row = $('vVoiceRow'); if (!row) return;
  const note = $('vVoiceNote'), v = $('vVol'), h = $('vHeroVoice'), mb = $('vVoiceMode');
  row.hidden = !(gate() || engine === false) || (engine === false && j && j.enabled === false);
  if (v) v.hidden = !engine; if (h) h.hidden = !engine; if (mb) mb.hidden = !engine;
  if (note) note.textContent = engine ? 'Narrator voice ready: ' + (j.voices ? j.voices.length + ' voices' : 'on') + '.' : (j && j.hint) || 'Narrator voice: the relay is not reachable; the game stays silent.';
}
async function speakLine(L) {
  const r = await fetch(base + '/tts/say', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({text: L.text, voice: L.voice, speed: RATE})});
  if (!r.ok) return null;
  const j = await r.json(); return j && j.id ? base + '/tts?id=' + j.id : null;
}
function playUrl(url) {
  return new Promise(res => {
    try {const a = new Audio(url); cur = a; a.volume = vol; const done = () => {cur = null; res()}; a.onended = done; a.onerror = done; setTimeout(done, 60000);
      const p = a.play(); if (p && p.catch) p.catch(done)} catch {res()}
  });
}
export function initVoice({gate: g, relay = null} = {}) {
  gate = g || (() => false);
  base = relay || String(CFG.url).replace(/\/decide$/, '');
  try {const v = Number(localStorage.getItem(VOL)); if (v >= 0 && v <= 1 && localStorage.getItem(VOL) != null) vol = v; heroes = localStorage.getItem(HERO) !== 'off'; const m = localStorage.getItem(MODE); if (MODES.includes(m)) mode = m} catch {}
  queue = makeVoiceQueue({speak: speakLine, play: playUrl, gate: () => gate() && engine !== false, speed: () => speedNow, kinds: () => MODE_KINDS[mode], onDown: () => {engine = false; nextCheck = 0; syncUi({hint: 'Narrator voice: the engine stopped answering; checking again in a minute.'})}});
  const v = $('vVol'); if (v) {v.value = String(Math.round(vol * 100)); v.oninput = () => {vol = v.value / 100; if (cur) cur.volume = vol; try {localStorage.setItem(VOL, String(vol))} catch {}}}
  const mb = $('vVoiceMode'); if (mb) {const s = () => {mb.textContent = MODE_TEXT[mode]}; s(); mb.onclick = () => {mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length]; try {localStorage.setItem(MODE, mode)} catch {} s(); if (queue) queue.clear()}}
  const h = $('vHeroVoice'); if (h) {const s = () => {h.textContent = 'Heroes speak: ' + (heroes ? 'on' : 'off'); h.setAttribute('aria-pressed', String(heroes))}; s(); h.onclick = () => {heroes = !heroes; try {localStorage.setItem(HERO, heroes ? 'on' : 'off')} catch {} s()}}
}
// Called every frame by the Table renderer (cheap: one scan of the DM log head and the table).
export function renderVoice(speed, now = Date.now()) {
  if (!queue) return; speedNow = speed;
  const on = gate();
  if (!on) {if (queue.size) queue.clear(); if (cur) {try {cur.pause()} catch {} cur = null} }
  if (on && now >= nextCheck && engine !== true) checkEngine(now);
  const lines = scanLines(S, scan, {heroes, company: followed()});
  if (!on || engine !== true) return; // lines scanned while silent are simply let go
  for (const L of lines) queue.push({...L, t: now});
}
