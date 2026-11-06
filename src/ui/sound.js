// The narrator voice (issue #554): the DM's narration, townsfolk lines and (if asked) the heroes' own lines read aloud
// by a LOCAL text-to-speech engine that the relay serves (scripts/providers/tts.mjs). The browser only plays audio it
// fetches from the relay (POST /tts/say, GET /tts?id=); nothing is generated here and nothing is sent anywhere else.
// Audio is for the watcher only: speaking changes nothing about who hears what in the game (channelcheck is unaffected).
//   - plays behind the page's Sound switch (the gate passed to initVoice); silent until the page had a click or key
//   - one queue, never overlapping; order: Table narration (0), npc_say (1), narrate in the open world (2), hero lines (3, off by default)
//   - a line older than MAX_AGE_MS (20 real seconds) is dropped unplayed; at 3x/8x everything but Table scenes is muted
//   - no engine: silent, one hint line in Settings, Sound behaves as before
// Pure parts (makeVoiceQueue, scanLines) are used by scripts/ttscheck.mjs without a browser.
import {S} from '../sim/state.js';
import {pickVoice} from '../data/voices.js';
import {CFG} from '../sim/brain.js';

export const MAX_AGE_MS = 20000, QUEUE_MAX = 8, PRI = {table: 0, npc: 1, narrate: 2, hero: 3};
export const allowedAt = (kind, speed) => !(speed > 1 && kind !== 'table'); // 3x/8x mutes all but Table scenes

// The queue. speak(line) -> Promise<url|null> (null: engine gone), play(url, line) -> Promise (resolves when the clip ends).
export function makeVoiceQueue({speak, play, now = Date.now, maxAge = MAX_AGE_MS, cap = QUEUE_MAX, speed = () => 1, gate = () => true, onDown = null} = {}) {
  const q = [], st = {played: 0, dropped: 0, failed: 0, order: [], seen: 0};
  let busy = false;
  const stale = L => now() - L.t > maxAge, muted = L => !allowedAt(L.kind, speed());
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
        st.order.push(L.id); st.played++;
        try {await play(url, L)} catch {}
      }
    } finally {busy = false}
  }
  return {
    push(L) {
      if (!gate() || !allowedAt(L.kind, speed())) {drop(); return false}
      q.push({...L, t: L.t ?? now()}); st.seen++;
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

// What is new to say. st = {lastId (DM log), frame, narr, bubbles{}, recent[]}; returns lines [{id, text, kind, voice}].
// The first scan only records where the log stands, so a loaded world does not read its past aloud.
export function scanLines(St, st, {heroes = false} = {}) {
  const out = [], push = (id, text, kind, speaker) => {
    text = clean(text); if (!text || st.recent.includes(text)) return; st.recent.push(text); if (st.recent.length > 12) st.recent.shift();
    out.push({id, text, kind, voice: pickVoice(speaker)});
  };
  const sc = St.table, log = St.dmLog || [];
  const top = log.length ? log[0].id : 0;
  if (st.lastId == null) st.lastId = top;
  const fresh = top > st.lastId ? log.filter(e => e.id > st.lastId).reverse() : []; st.lastId = Math.max(st.lastId, top);
  if (sc) {
    if (st.frame !== sc.id) {st.frame = sc.id; push('f' + sc.id, plain(sc.frame), 'table', {kind: 'narrator'})}
    const n = sc.narr, key = n ? n.t + '|' + n.text : null;
    if (n && n.text && key !== st.narr) {st.narr = key; push('n' + key, n.text, 'table', {kind: 'narrator'})}
  } else {st.frame = null; st.narr = null}
  for (const e of fresh) {
    const d = e.detail || {}; if (e.kind !== 'agent' || !d.text) continue;
    if (d.voice === 'narrate') push('d' + e.id, d.text, sc ? 'table' : 'narrate', {kind: 'narrator'});
    else if (d.voice === 'npc_say') {const p = (St.npcs || []).find(x => x.id === d.npc); push('d' + e.id, d.text, 'npc', {kind: 'npc', role: p && p.role, fac: p && p.fac, name: p && p.name})}
  }
  if (heroes) for (const a of St.agents || []) {
    const b = a.player && a.bubble; if (!b || !b.text) { if (st.bubbles[a.id] && !b) st.bubbles[a.id] = null; continue }
    const key = b.text; if (st.bubbles[a.id] === key) continue; st.bubbles[a.id] = key;
    push('h' + a.id + '|' + key, b.text, 'hero', {kind: 'hero', name: a.name, cls: a.cls, sex: a.sex, fac: a.fac});
  }
  return out;
}
export const newScan = () => ({lastId: null, frame: null, narr: null, bubbles: {}, recent: []});

// ---- the browser side ----
const VOL = 'eldmoor.voiceVol', HERO = 'eldmoor.voiceHeroes';
const $ = id => document.getElementById(id);
let base = '', queue = null, scan = newScan(), engine = null /* null unknown, true, false */, nextCheck = 0, vol = 0.8, heroes = false, cur = null, speedNow = 1, gate = () => false;

async function checkEngine(t) {
  nextCheck = t + 60000;
  try {const r = await fetch(base + '/tts/status'); const j = await r.json(); engine = !!j.ok; syncUi(j)}
  catch {engine = false; syncUi({error: 'relay not reachable'})}
}
function syncUi(j) {
  const row = $('vVoiceRow'); if (!row) return;
  const note = $('vVoiceNote'), v = $('vVol'), h = $('vHeroVoice');
  row.hidden = !(gate() || engine === false) || (engine === false && j && j.enabled === false);
  if (v) v.hidden = !engine; if (h) h.hidden = !engine;
  if (note) note.textContent = engine ? 'Narrator voice ready: ' + (j.voices ? j.voices.length + ' voices' : 'on') + '.' : (j && j.hint) || 'Narrator voice: the relay is not reachable; the game stays silent.';
}
async function speakLine(L) {
  const r = await fetch(base + '/tts/say', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({text: L.text, voice: L.voice})});
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
  try {const v = Number(localStorage.getItem(VOL)); if (v >= 0 && v <= 1 && localStorage.getItem(VOL) != null) vol = v; heroes = localStorage.getItem(HERO) === 'on'} catch {}
  queue = makeVoiceQueue({speak: speakLine, play: playUrl, gate: () => gate() && engine !== false, speed: () => speedNow, onDown: () => {engine = false; nextCheck = 0; syncUi({hint: 'Narrator voice: the engine stopped answering; checking again in a minute.'})}});
  const v = $('vVol'); if (v) {v.value = String(Math.round(vol * 100)); v.oninput = () => {vol = v.value / 100; if (cur) cur.volume = vol; try {localStorage.setItem(VOL, String(vol))} catch {}}}
  const h = $('vHeroVoice'); if (h) {const s = () => {h.textContent = 'Heroes speak: ' + (heroes ? 'on' : 'off'); h.setAttribute('aria-pressed', String(heroes))}; s(); h.onclick = () => {heroes = !heroes; try {localStorage.setItem(HERO, heroes ? 'on' : 'off')} catch {} s()}}
}
// Called every frame by the Table renderer (cheap: one scan of the DM log head and the table).
export function renderVoice(speed, now = Date.now()) {
  if (!queue) return; speedNow = speed;
  const on = gate();
  if (!on) {if (queue.size) queue.clear(); if (cur) {try {cur.pause()} catch {} cur = null} }
  if (on && now >= nextCheck && engine !== true) checkEngine(now);
  const lines = scanLines(S, scan, {heroes});
  if (!on || engine !== true) return; // lines scanned while silent are simply let go
  for (const L of lines) queue.push({...L, t: now});
}
