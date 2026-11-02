// Mind comparison (issue #280, part 3 of #97): how each mind (provider/model) played each Fellowship member, and
// overall, from the behavior logs (logs/behavior/<world>/: turns.jsonl, decisions.jsonl, world.jsonl). Read only;
// used by scripts/behavior-report.mjs for its "Mind comparison" section. Plain Node, no dependency.
//
// One row per watched hero (Fellowship members first, then other agent-played heroes) and mind:
//   agent turns      runner turn lines (turns.jsonl), keyed by the line's provider/model
//   empty, failed    turns flagged empty; turns with an error, a failed run or every call refused
//   Table answers    scene_act calls that went through (the agent's own Table answers); reflex Table turns are
//                    counted by the game for the whole party only (overall line)
//   decisions        settled Mind entries from the game (src 'game'); rejected = the model's answer was illegal;
//                    fallbacks = the scripted rules played it (rejected, late, offline)
//   writing          relay calls that write the member's sheet (persona, backstory, memory, chapter), as the relay saw them
//   latency          agent turn seconds p50/p90; decision ms p50/p90 (game entries, else relay decision calls)
//   tokens, cost     summed from the turn lines ($0 for local models). Tokens in = uncached input; cache read shown apart (Claude only). Claude lines from before #282 (cumulative totals) are left out
//   hours            the hourly world digests: hours the member was seen under this mind's runner, and how many of
//                    them it ran on autopilot or the scripted rules (no runner) instead of its agent
//   deaths survived  Fellowship deaths (from the digests) while the member lived; close calls = digests at 25% HP or less
//   lifetime         game hours from the first to the last digest (or the death); "died" with its cause
// A member with no data for a column shows "-", never 0. Names, model ids, counts and death causes only: no
// narration, prompts or another seat's text.
import {WRITE_KINDS} from '../src/data/prompts.js';
import {legacyTokens} from './behavior-log.mjs';

export const MC = {CLOSE: 25}; // HP percent at or below which a digest counts as a close call

const tsOf = r => {const t = Date.parse(r.ts); return Number.isFinite(t) ? t : 0};
const mindKey = (p, m) => (p || '?') + '/' + (m || '?');
const fin = xs => xs.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
export function pctile(xs, p) {const v = fin(xs); if (!v.length) return null; return v[Math.min(v.length - 1, Math.max(0, Math.ceil(p / 100 * v.length) - 1))]}
const dash = (n, has) => has ? String(n) : '-';
const r1 = v => v == null ? '-' : String(Math.round(v * 10) / 10);
const money = v => v == null ? '-' : '$' + v.toFixed(4);
const seatId = s => {const m = /^hero:(\d+)$/.exec(s || ''); return m ? Number(m[1]) : null};

// Compare the minds. T, D, W: the parsed turn, decision and world lines. Returns {rows, overall, table, deaths}.
export function compareMinds(T = [], D = [], W = []) {
  // who the watched heroes are, from the digests: id+name -> {role, fellow, fellowship}
  const heroes = new Map(), byId = new Map(); // byId: id -> [{ts, name}] for naming turn lines without a name
  const hk = (id, name) => id + ':' + name;
  const Ws = W.slice().sort((a, b) => tsOf(a) - tsOf(b));
  for (const w of Ws) for (const m of w.members || []) {
    const k = hk(m.id, m.name); let h = heroes.get(k);
    if (!h) heroes.set(k, h = {key: k, id: m.id, name: m.name, role: m.role || null, fellow: !!m.fellow, agent: !!m.agent, fs: w.fellowship && w.fellowship.name || null, first: w.gameMin, last: w.gameMin, samples: []});
    if (m.role) h.role = m.role; if (m.fellow) h.fellow = true;
    h.with = h.with || new Set(); for (const o of w.members) if (o !== m) h.with.add(hk(o.id, o.name));
    h.last = Math.max(h.last, w.gameMin); h.first = Math.min(h.first, w.gameMin);
    h.samples.push({gm: w.gameMin, ts: tsOf(w), mind: m.mind, hp: m.hp, runner: m.runner && m.runner.provider ? mindKey(m.runner.provider, m.runner.model) : null});
    let L = byId.get(m.id); if (!L) byId.set(m.id, L = []); if (!L.length || L[L.length - 1].name !== m.name) L.push({ts: tsOf(w), name: m.name});
  }
  const nameAt = (id, ts) => {const L = byId.get(id); if (!L) return null; let n = L[0].name; for (const x of L) if (x.ts <= ts) n = x.name; return n};
  const heroOf = (id, name) => {const k = hk(id, name); let h = heroes.get(k);
    if (!h) heroes.set(k, h = {key: k, id, named: !!name, name: name || 'hero ' + id, role: null, fellow: false, agent: true, fs: null, first: null, last: null, samples: []}); return h};
  const byName = new Map(); for (const h of heroes.values()) if (!byName.has(h.name)) byName.set(h.name, h);

  const rows = new Map();
  const row = (h, mind) => {const k = h.key + '|' + mind; let r = rows.get(k);
    if (!r) rows.set(k, r = {hero: h, mind, turns: 0, empty: 0, failed: 0, table: 0, sceneTurns: 0, secs: [], tin: 0, tout: 0, tokN: 0, cr: 0, crN: 0, legacy: 0, cost: 0, costN: 0,
      dec: 0, rejected: 0, fallback: 0, decMs: [], relayDec: 0, relayDecFail: 0, relayMs: [], writing: 0, writingFail: 0, hours: 0, autopilot: 0, scripted: 0, close: 0, died: null}); return r};

  // agent turns
  let lastNamed = new Map();
  for (const t of T.slice().sort((a, b) => tsOf(a) - tsOf(b))) {
    const id = seatId(t.seat); if (id == null) continue; // the DM seat is not a member
    const name = t.hero && t.hero.name || nameAt(id, tsOf(t)) || lastNamed.get(id) || null; if (name) lastNamed.set(id, name);
    const r = row(heroOf(id, name), mindKey(t.provider, t.model)), f = new Set(t.flags || []);
    r.turns++; if (f.has('empty')) r.empty++;
    else if (t.error || f.has('failed') || f.has('refused')) r.failed++;
    if (f.has('scene') || f.has('forced-scene')) r.sceneTurns++;
    r.table += (t.tools || []).filter(x => x.name === 'scene_act' && x.ok).length;
    r.secs.push(t.seconds);
    if (legacyTokens(t)) r.legacy++; // before #282: the SDK's cumulative total, not a per-turn count
    else if (Number.isFinite(t.tokensIn) || Number.isFinite(t.tokensOut)) {r.tin += t.tokensIn || 0; r.tout += t.tokensOut || 0; r.tokN++; if (Number.isFinite(t.cacheRead)) {r.cr += t.cacheRead; r.crN++}}
    if (Number.isFinite(t.cost)) {r.cost += t.cost; r.costN++}
  }
  // decisions: settled Mind entries (game) and relay calls (decisions and writing kinds)
  const FALLBACK = new Set(['rejected', 'late', 'offline']);
  for (const d of D) {
    if (d.src === 'game') {const id = d.hero && d.hero.id, name = d.hero && d.hero.name; if (id == null) continue;
      const h = heroes.get(hk(id, name)); if (!h) continue; // a background hero, not watched
      const r = row(h, mindKey(d.provider, d.model || 'relay default')); r.dec++; if (d.outcome === 'rejected') r.rejected++; if (FALLBACK.has(d.outcome)) r.fallback++; r.decMs.push(d.ms)}
    else if (d.src === 'relay') {const name = typeof d.hero === 'string' ? d.hero : d.hero && d.hero.name; const h = name && byName.get(name); if (!h) continue;
      const r = row(h, mindKey(d.provider, d.model));
      if (WRITE_KINDS.includes(d.kind)) {r.writing++; if (!d.ok) r.writingFail++}
      else {r.relayDec++; if (!d.ok) r.relayDecFail++; r.relayMs.push(d.ms)}}
  }
  // the digests: hours under each runner's mind, autopilot and scripted hours, close calls
  for (const h of heroes.values()) {
    if (!h.samples.length) continue;
    const own = [...rows.values()].filter(r => r.hero === h && r.turns).sort((a, b) => b.turns - a.turns);
    const dflt = own.length ? own[0].mind : null;
    for (const s of h.samples) {
      const mind = s.runner || dflt || (s.mind === 'relay' ? 'relay mind' : s.mind === 'scripted' ? 'scripted' : 'no runner');
      const r = row(h, mind); r.hours++; if (s.mind === 'autopilot') r.autopilot++; if (s.mind === 'scripted') r.scripted++;
      if (Number.isFinite(s.hp) && s.hp <= MC.CLOSE) r.close++; h.lastMind = mind;
    }
  }
  // deaths: a watched hero's death (by name) ends its life; other members survive it if they were alive then
  const deaths = [];
  for (const w of Ws) for (const x of w.deaths || []) {const h = byName.get(x.name); if (h) deaths.push({h, gm: w.gameMin, cause: x.cause || '?', fs: h.fs})}
  for (const d of deaths) {d.h.died = d; const r = d.h.lastMind ? row(d.h, d.h.lastMind) : null; if (r) r.died = d.cause}
  for (const h of heroes.values()) {
    h.survived = deaths.filter(d => d.h !== h && h.fellow && d.h.fellow && h.with && h.with.has(d.h.key) && h.first != null && d.gm >= h.first && d.gm <= (h.died ? h.died.gm : h.last + 60)).length; // a companion seen beside it
    h.lifeH = h.first == null ? null : ((h.died ? h.died.gm : h.last) - h.first) / 60;
  }

  // the relay writing a member's sheet is not the mind that plays it: fold writing-only rows into the member's
  // playing row (most turns, else most digest hours) as "sheets written by <model>"; the overall table keeps them apart
  for (const h of heroes.values()) {
    const mine = [...rows.entries()].filter(([, r]) => r.hero === h), play = mine.filter(([, r]) => r.turns || r.hours || r.dec).sort((a, b) => b[1].turns - a[1].turns || b[1].hours - a[1].hours)[0];
    if (!play) continue;
    for (const [k, r] of mine) if (r !== play[1] && !r.turns && !r.hours && !r.dec && !r.relayDec && r.writing) {
      const w = play[1].writers || (play[1].writers = {}); w[r.mind] = (w[r.mind] || 0) + r.writing; play[1].writingFail += r.writingFail; play[1].folded = (play[1].folded || []).concat([r]); rows.delete(k)}
  }
  // overall per mind
  const overall = new Map();
  for (const r of [...rows.values()].flatMap(r => [r, ...(r.folded || [])])) {let o = overall.get(r.mind); if (!o) overall.set(r.mind, o = {mind: r.mind, heroes: new Set(), turns: 0, empty: 0, failed: 0, table: 0, secs: [], tin: 0, tout: 0, tokN: 0, cr: 0, crN: 0, legacy: 0, cost: 0, costN: 0, dec: 0, rejected: 0, fallback: 0, decMs: [], writing: 0, writingFail: 0, hours: 0, autopilot: 0, scripted: 0, close: 0, deaths: 0});
    o.heroes.add(r.hero.key); for (const k of ['turns', 'empty', 'failed', 'table', 'tin', 'tout', 'tokN', 'cr', 'crN', 'legacy', 'cost', 'costN', 'dec', 'rejected', 'fallback', 'writing', 'writingFail', 'hours', 'autopilot', 'scripted', 'close']) o[k] += r[k];
    o.secs.push(...r.secs); o.decMs.push(...(r.dec ? r.decMs : r.relayMs)); if (r.died) o.deaths++}
  const table = {opened: 0, agentTurns: 0, reflexTurns: 0}, votes = {agent: 0, reflex: 0};
  for (const w of W) {if (w.table) {table.opened += w.table.opened || 0; table.agentTurns += w.table.agentTurns || 0; table.reflexTurns += w.table.reflexTurns || 0} if (w.votes) {votes.agent += w.votes.agent || 0; votes.reflex += w.votes.reflex || 0}}
  const order = r => (r.hero.fellow ? 0 : 1);
  const list = [...rows.values()].sort((a, b) => order(a) - order(b) || String(a.hero.fs).localeCompare(String(b.hero.fs)) || (a.hero.first ?? 1e12) - (b.hero.first ?? 1e12) || a.hero.name.localeCompare(b.hero.name) || b.turns - a.turns);
  return {rows: list, overall: [...overall.values()].sort((a, b) => b.turns - a.turns || b.hours - a.hours), table, votes, deaths};
}

// The section, as Markdown lines. tableFn: the report's Markdown table builder.
export function mindSection(T, D, W, tableFn) {
  const c = compareMinds(T, D, W), L = [];
  L.push('## Mind comparison', '');
  if (!c.rows.length) {L.push('_No member or agent-hero activity logged yet._', ''); return {lines: L, data: c}}
  L.push('Per Fellowship member (then other agent-played heroes) and the mind (provider/model) that played it. "-" means no data of that kind for that member and mind. Decisions are settled Mind entries; fallbacks are the ones the scripted rules played (rejected, late, offline); sheets written are the relay writing the member\'s persona, backstory, memory and chapters (often another model). Hours come from the hourly world digests (autopilot or scripted hours of those in brackets); close calls are digests at ' + MC.CLOSE + '% HP or less; deaths survived are companions who fell while seen beside the member.', '');
  const writes = r => {const parts = Object.entries(r.writers || {}).map(([m, n]) => n + ' by ' + m); if (r.writing) parts.unshift(r.writing + ' by this mind');
    return parts.length ? parts.join(', ') + (r.writingFail ? ' (' + r.writingFail + ' failed)' : '') : '-'};
  const lat = (xs, unit) => {const a = pctile(xs, 50), b = pctile(xs, 90); return a == null ? '-' : `${r1(a)} / ${r1(b)}${unit}`};
  L.push(tableFn(['member', 'role', 'mind', 'agent turns', 'empty', 'failed', 'Table answers', 'decisions', 'rejected', 'fallbacks', 'sheets written', 'turn s p50/p90', 'decision ms p50/p90', 'tokens in/out', 'cache read', 'cost', 'hours (autopilot, scripted)', 'close calls', 'deaths survived', 'lifetime (game h)'],
    c.rows.map(r => {const h = r.hero, t = r.turns > 0, d = r.dec > 0, life = h.lifeH == null ? '-' : r1(h.lifeH) + (h.died ? ' (died' + (r.died ? ': ' + r.died : '') + ')' : ' (alive)');
      return [h.name + (h.named === false ? ' (unnamed)' : ''), h.role || (h.fellow ? 'member' : 'agent hero'), r.mind, dash(r.turns, t), dash(r.empty, t), dash(r.failed, t), t || r.table ? r.table : '-', dash(r.dec, d), dash(r.rejected, d), dash(r.fallback, d),
        writes(r), lat(r.secs, ' s'), lat(d ? r.decMs : r.relayMs, ' ms'), r.tokN ? `${r.tin} / ${r.tout}` : '-', r.crN ? r.cr : '-', r.costN ? money(r.cost) : '-',
        r.hours ? `${r.hours} (${r.autopilot}, ${r.scripted})` : '-', r.hours ? r.close : '-', h.first == null ? '-' : h.survived, life]})), '');
  L.push('Overall per mind:', '');
  L.push(tableFn(['mind', 'heroes', 'agent turns', 'empty', 'failed', 'Table answers', 'decisions', 'fallbacks', 'sheets written (failed)', 'turn s p50/p90', 'decision ms p50/p90', 'tokens in/out per turn', 'cache read per turn', 'cost per turn', 'cost', 'hours (autopilot, scripted)', 'close calls', 'deaths'],
    c.overall.map(o => {const t = o.turns > 0;
      return [o.mind, o.heroes.size, dash(o.turns, t), t ? `${o.empty} (${Math.round(o.empty / o.turns * 100)}%)` : '-', t ? `${o.failed} (${Math.round(o.failed / o.turns * 100)}%)` : '-', t || o.table ? o.table : '-',
        dash(o.dec, o.dec > 0), o.dec ? o.fallback : '-', o.writing ? `${o.writing} (${o.writingFail})` : '-', lat(o.secs, ' s'), lat(o.decMs, ' ms'),
        o.tokN ? `${Math.round(o.tin / o.tokN)} / ${Math.round(o.tout / o.tokN)}` : '-', o.crN ? Math.round(o.cr / o.crN) : '-', o.costN ? money(o.cost / o.costN) : '-', o.costN ? money(o.cost) : '-',
        o.hours ? `${o.hours} (${o.autopilot}, ${o.scripted})` : '-', o.hours ? o.close : '-', o.hours ? o.deaths : '-']})), '');
  const legacyN = c.overall.reduce((t, o) => t + o.legacy, 0);
  if (legacyN) L.push(`${legacyN} Claude turn line${legacyN === 1 ? '' : 's'} from before the per-turn token fix (#282) are left out of the token columns (they logged the SDK's cumulative total).`, '');
  const tt = c.table.agentTurns + c.table.reflexTurns, vv = c.votes.agent + c.votes.reflex;
  L.push(`- Table turns of agent members (the whole party, from the digests): ${c.table.agentTurns} by the agent, ${c.table.reflexTurns} by reflex${tt ? ' (' + Math.round(c.table.agentTurns / tt * 100) + '% agent)' : ''}, in ${c.table.opened} scenes.`);
  L.push(`- Votes of agent members: ${c.votes.agent} by the agent, ${c.votes.reflex} by reflex${vv ? ' (' + Math.round(c.votes.agent / vv * 100) + '% agent)' : ''}.`);
  L.push(`- Deaths of watched heroes: ${c.deaths.length}${c.deaths.length ? ' (' + c.deaths.map(d => d.h.name + ', ' + d.cause).join('; ') + ')' : ''}.`, '');
  return {lines: L, data: c};
}
