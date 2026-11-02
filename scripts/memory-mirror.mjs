// Agent memories, mirrored as Markdown for the owner (issue #155). The game state is the source of truth
// (a.memories and S.dmAgent.notes, saved with the world, src/sim/notebook.js); these files are a read-only copy
// for a person to browse. Nothing ever reads them back: no prompt, tool or runner opens them.
//
//   logs/agents/<world>/<heroId>-<name>/memory/MEMORY.md          the index (pinned, notes, archived)
//   logs/agents/<world>/<heroId>-<name>/memory/<id>-<slug>.md     one note, with front matter
//   logs/agents/<world>/dm/memory/...                             the DM's notes (front matter carries the section)
//
// Written by the hosts, never by the sim: the relay (scripts/relay.mjs, from the game page's {type:'mirror'}
// messages over the play socket, src/ui/player-bridge.js) and the headless world (scripts/play-headless.mjs, from
// mirrorDirty() every few seconds). <world> is the world the game page names (eldmoor, stepping) or
// <world>-headless, as for the behavior logs. A note forgotten in the game loses its file; a fallen hero's folder
// stays, its index saying so (the notes died with the hero; no seat reads them again).
//
// memoryMirror({root, world, log}) -> {setWorld(w), write(seats), dir(), stats}
//   seats: [{key, sig, seat}] from mirrorDirty(), or bare seat payloads. Never throws.
import {mkdirSync, writeFileSync, readdirSync, unlinkSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MIRROR_ROOT = () => process.env.AGENT_LOGS || join(ROOT, 'logs', 'agents');
const MAX_NOTES = 400, LEN = 600;
export const slug = (s, n = 40) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, n).replace(/-+$/, '') || 'x';
const str = (v, n = LEN) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').slice(0, n);
const q = v => JSON.stringify(str(v, 200)); // a YAML double-quoted scalar
const intOr = (v, d = null) => Number.isInteger(v) ? v : d;
const FILE_RE = /^\d+-[a-z0-9-]*\.md$/;

export function noteFile(n) {return `${intOr(n.id, 0)}-${slug(n.title, 40)}.md`}
export function noteMarkdown(n, section = null) {
  const fm = ['---', `id: ${intOr(n.id, 0)}`, `title: ${q(n.title)}`, `tags: [${(Array.isArray(n.tags) ? n.tags : []).slice(0, 12).map(t => q(t)).join(', ')}]`,
    `about: ${n.about ? q(n.about) : 'null'}`, `day: ${intOr(n.day, 0)}`, ...(n.updated_day ? [`updated_day: ${intOr(n.updated_day, 0)}`] : []),
    ...(section ? [`section: ${slug(section, 20)}`] : []), `pinned: ${!!n.pinned}`, `archived: ${!!n.archived}`, '---', ''];
  return fm.join('\n') + `# ${str(n.title, 120)}\n\n${str(n.text)}\n`;
}
function indexMarkdown(seat, rows) {
  const who = seat.kind === 'dm' ? 'The Dungeon Master' : `${str(seat.name, 40)} (hero ${intOr(seat.id, '?')}, level ${intOr(seat.lvl, '?')} ${str(seat.cls, 20)})`;
  const line = r => `- [${str(r.n.title, 120).replace(/[[\]]/g, '')}](${r.file}) — day ${intOr(r.n.day, '?')}${r.sec ? ', ' + r.sec : ''}${r.n.tags && r.n.tags.length ? ', tags: ' + r.n.tags.join(', ') : ''}${r.n.about ? ', about ' + str(r.n.about, 60) : ''}`;
  const pinned = rows.filter(r => r.n.pinned && !r.n.archived), live = rows.filter(r => !r.n.pinned && !r.n.archived), arch = rows.filter(r => r.n.archived);
  return [`# ${who}: memories`, '',
    '> A read-only mirror of the notes saved with the world. The game never reads this folder back; edits here change nothing.',
    ...(seat.dead ? ['', `**Fallen${seat.died ? ' at ' + str(seat.died, 30) : ''}${seat.cause ? ' (' + str(seat.cause, 60) + ')' : ''}.** Hardcore: these memories died with them; no one in the game reads them again.`] : []),
    '', `## Pinned (${pinned.length})`, ...(pinned.length ? pinned.map(line) : ['- none']),
    '', `## Notes (${live.length})`, ...(live.length ? live.map(line) : ['- none']),
    '', `## Archived (${arch.length})`, ...(arch.length ? arch.map(line) : ['- none']), ''].join('\n');
}

// Tiered memory (issue #153): the hero's landmarks and the chapters its older journal entries and notes became.
export function lifeMarkdown(seat) {
  const T = seat.tiers, marks = Array.isArray(T.marks) ? T.marks.slice(0, 60) : [], chs = Array.isArray(T.chapters) ? T.chapters.slice(0, 60) : [];
  return [`# ${str(seat.name, 40)}: landmarks and chapters`, '', '> A read-only mirror; the game never reads it back.', '',
    `## Landmarks (${marks.length})`, ...(marks.length ? marks.map(m => `- day ${intOr(m.day, '?')} (${str(m.k, 16)}): ${str(m.text, 240)}`) : ['- none']), '',
    `## Chapters (${chs.length})`, ...(chs.length ? chs.flatMap(c => [`### ${intOr(c.n, '?')}. ${str(c.title || 'Untitled', 80)} (days ${intOr(c.d0, '?')}-${intOr(c.d1, '?')}, ${str(c.src, 12)})`, '', str(c.text, 400), '']) : ['- none', '']),
    `Lines waiting for the next chapter: ${intOr(T.pend, 0)}`, ''].join('\n');
}

export function memoryMirror({root = MIRROR_ROOT(), world = 'eldmoor', log = () => {}} = {}) {
  let w = slug(world, 40); const cache = new Map(), stats = {writes: 0, removed: 0, seats: 0, errors: 0};
  const put = (file, text) => {if (cache.get(file) === text) return; writeFileSync(file, text); cache.set(file, text); stats.writes++};
  function seatDir(seat) {
    if (seat.kind === 'dm') return join(root, w, 'dm', 'memory');
    if (!Number.isInteger(seat.id)) return null;
    return join(root, w, `${seat.id}-${slug(seat.name, 30)}`, 'memory');
  }
  function writeSeat(seat) {
    const dir = seatDir(seat); if (!dir) return;
    mkdirSync(dir, {recursive: true});
    const rows = [];
    if (seat.kind === 'dm') {for (const [k, list] of Object.entries(seat.sections || {})) for (const n of (Array.isArray(list) ? list : [])) rows.push({n, sec: k})}
    else for (const n of (Array.isArray(seat.notes) ? seat.notes : [])) rows.push({n, sec: null});
    for (const n of (Array.isArray(seat.arch) ? seat.arch : [])) rows.push({n: {...n, archived: true}, sec: seat.kind === 'dm' ? n.section || null : null});
    const keep = new Set(['MEMORY.md']);
    for (const r of rows.slice(0, MAX_NOTES)) {if (!r.n || typeof r.n !== 'object') continue; r.file = noteFile(r.n); keep.add(r.file); put(join(dir, r.file), noteMarkdown(r.n, r.sec))}
    put(join(dir, 'MEMORY.md'), indexMarkdown(seat, rows.filter(r => r.file)));
    for (const f of readdirSync(dir)) if (FILE_RE.test(f) && !keep.has(f)) {try {unlinkSync(join(dir, f)); cache.delete(join(dir, f)); stats.removed++} catch {}}
    if (seat.kind === 'hero' && seat.tiers && typeof seat.tiers === 'object') put(join(dir, 'LIFE.md'), lifeMarkdown(seat));
    stats.seats++;
  }
  return {
    setWorld(x) {const s = slug(x, 40); if (s && s !== w) {w = s; cache.clear()}},
    dir: () => join(root, w),
    stats,
    write(seats) {
      for (const s of (Array.isArray(seats) ? seats : []).slice(0, 64)) {
        const seat = s && s.seat ? s.seat : s;
        if (!seat || (seat.kind !== 'hero' && seat.kind !== 'dm')) continue;
        try {writeSeat(seat)} catch (e) {stats.errors++; log('[mirror] ' + e.message)}
      }
      return true;
    },
  };
}
