// Tiered long-term memory check (issue #153): landmarks, journal chapters, journal_search and the overview.
//   - a long run overflows the journal and the notebook: every landmark stays, chapters form, and journal_search
//     still finds a day-1 entry and a day-1 note whose own copies are gone
//   - bounded: the overview (journal_read with no arguments) stays the same size however long the run
//   - landmarks past their cap fold lightest-first into chapters (their words stay searchable); chapters past
//     their cap merge, oldest first
//   - the relay's chapter rewrite applies only to an unchanged chapter; the relay validates the kind
//   - old saves migrate: an existing journal becomes chapter 1, unlabeled, its entries kept
//   - snapshot -> restore keeps the tiers; hardcore: they die with the hero, the replacement starts empty
//   - seats apart: another hero's journal_search never finds them
// No model, no network. Usage: npm run tiercheck
let seed = 0x7135eed ^ (Number(process.env.TIERCHECK_SEED) || 153);
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};

const SIM = await import('../src/sim/index.js');
const SLT = await import('../src/sim/company.js'); // the slotted company (#588)
const {init, step, S, maxHp} = SIM;
const P = await import('../src/sim/player.js');
const F_ = await import('../src/sim/company.js');
const NB = await import('../src/sim/notebook.js');
const TI = await import('../src/sim/tiers.js');
const HE = await import('../src/sim/heroes.js');
const {checkWriting} = await import('./relay.mjs');
const {schemaFor, KINDS, WRITE_KINDS} = await import('../src/data/prompts.js');
const {PLAYER_TOOLS} = await import('../src/data/player-tools.js');
const {lifeMarkdown} = await import('./memory-mirror.mjs');

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};
const act = (a, tool, args) => P.playerAct(a.id, tool, args || {});
const day = () => Math.floor(S.gameMin / 1440) + 1;
const asked = []; TI.setChapterWriter((a, snap, stamp) => asked.push({id: a.id, snap, stamp})); // the relay, mocked

console.log('\nEldmoor tiercheck: landmarks, chapters, journal_search\n');
init(); run(5);
SLT.setSlotMinds(SLT.slotted(), 'agent');
const M = SLT.slotMembers(SLT.slotted()).map(m => m.hero), [A, B] = M;
ok(M.length === 5 && M.every(x => x.player), `the Fellowship, agent-played; A = ${A.name}`);
NB.NB.WRITES_PER_DAY = 1e6;

console.log('landmarks from the world');
const T = TI.tiersOf(A);
ok(T.marks.some(m => m.k === 'fellowship' && m.day === 1 && /Swore into/.test(m.text)), 'founding the Fellowship is a day-1 landmark (from the memory line)');
ok(PLAYER_TOOLS.some(t => t.name === 'journal_search') && PLAYER_TOOLS.find(t => t.name === 'journal_write').args.landmark, 'tools: journal_search, journal_write {landmark}');
const {record} = await import('../src/sim/history.js');
record(A, 'Reached level 10.'); record(A, 'Reached level 11.'); record(A, 'Cleared ', {t: 'The Sunken Crypt', c: 'gd'}, ' and destroyed ', {t: 'the Drowned King', c: 'gd'}, '.');
ok(T.marks.some(m => m.k === 'level' && /level 10/.test(m.text)) && !T.marks.some(m => /level 11/.test(m.text)) && T.marks.some(m => m.k === 'crypt'), 'record hook: level bands (10, not 11) and a Crypt clear');
const other = S.agents.find(x => x.kind === 'hero' && !SLT.inSlots(x) && !x.player && x.state !== 'dead');
record(other, 'Reached level 10.'); ok(!other.tiers, 'a scripted background hero keeps no tiers');
A.nemesis = A.nemesis || {}; A.nemesis[other.id] = 'Old Bren'; record(A, 'Looted a thing.');
ok(T.marks.some(m => m.k === 'vow' && m.text.includes(other.name)), 'a new nemesis is a vow landmark');

console.log('a long run: the journal and the notebook overflow');
ok(act(A, 'journal_write', {text: 'The ferryman Olwick Harrow rowed us over the Greyrun for a copper and a song.'}).ok, 'day 1: an entry about a ferryman');
const lm = act(A, 'journal_write', {text: 'I swore on the river stones to bring every one of us home.', landmark: 'yes'});
ok(lm.ok && lm.landmark > 0, 'journal_write {landmark: yes} marks the agent\'s own landmark');
ok(act(A, 'remember', {title: 'The well at Copperhollow', text: 'Sweet water behind the mill; the miller owes me a favour.', tags: ['place']}).ok, 'day 1: a note about a well');
const allMarks = new Set(T.marks.map(m => m.id)); let ov0 = null;
for (let i = 0; i < 300; i++) {
  if (A.state === 'dead') break;
  A.hp = maxHp(A); S.gameMin += 50; if (i % 25 === 0) {run(3); A.hp = maxHp(A)}
  act(A, 'journal_write', {text: `Entry ${i}: hunted along the road with ${B.name}, sold pelts, ate badly, day ${day()}.`, ...(i % 70 === 69 ? {landmark: 'yes'} : {})});
  act(A, 'remember', {title: 'Road note ' + i, text: 'Ordinary road note number ' + i + '.', tags: ['road']});
  for (const m of T.marks) allMarks.add(m.id);
  if (i === 120) ov0 = JSON.stringify(act(A, 'journal_read', {}));
}
ok(A.state !== 'dead', `A lived through ${day()} game days`);
ok(A.journal.length <= 100 && A.journal.length >= 80, `the journal keeps its cap (${A.journal.length} entries)`);
ok(T.chapters.length >= 5 && T.chapters.every(c => c.text.length <= TI.TIER.CH_LEN && (!c.title || c.title.length <= TI.TIER.TITLE)), `chapters formed (${T.chapters.length}), each within its caps`);
ok(T.chapters.some(c => c.src === 'scripted' && /^Days? \d/.test(c.text)), 'a chapter has a scripted digest at once: ' + JSON.stringify(T.chapters[0].title));
ok(T.marks.length <= TI.TIER.MARKS && [...allMarks].every(id => T.marks.some(m => m.id === id)), `every landmark is kept (${T.marks.length} of cap ${TI.TIER.MARKS})`);
ok(!NB.recallNotes ? true : !A.memories.notes.concat(A.memories.arch).some(n => /Copperhollow/.test(n.title)), 'the day-1 note has left the notebook and its archive');
let r = act(A, 'journal_search', {query: 'ferryman Olwick'});
ok(r.ok && r.results.length && r.results[0].kind === 'chapter' && /^1(-|$)/.test(String(r.results[0].day)), 'journal_search finds the day-1 ferryman in a chapter: ' + JSON.stringify(r.results[0]));
r = act(A, 'journal_search', {query: 'Copperhollow well'});
ok(r.ok && r.results.some(x => x.kind === 'chapter'), 'journal_search finds the day-1 note in a chapter');
r = act(A, 'journal_search', {query: 'river stones'});
ok(r.ok && r.results[0].kind === 'landmark', 'journal_search finds the agent\'s own landmark');
r = act(A, 'journal_search', {day: 1, n: 10});
ok(r.ok && r.results.length >= 2 && r.results.every(x => String(x.day).split('-')[0] <= 1), 'journal_search {day: 1}: what happened on day 1');
ok(!act(A, 'journal_search', {}).ok, 'journal_search with nothing to look for is refused');
const ov = act(A, 'journal_read', {});
ok(ov.ok && ov.landmarks.length === T.marks.length && ov.chapters.length === T.chapters.length && ov.entries.length === TI.TIER.OVERVIEW, `journal_read with no arguments: ${ov.landmarks.length} landmarks, ${ov.chapters.length} chapters, the last ${ov.entries.length} entries`);
ok(act(A, 'journal_read', {n: 3}).entries.length === 3 && !act(A, 'journal_read', {n: 3}).landmarks, 'journal_read {n} still returns entries only');
const ovLen = JSON.stringify(ov).length;
const ovMax = TI.TIER.MARKS * (TI.TIER.OV_MARK + 16) + TI.TIER.CHAPTERS * (TI.TIER.TITLE + 28) + TI.TIER.OVERVIEW * (TI.TIER.OV_ENTRY + 24) + 400; // the caps, whatever the length of the run
ok(ovLen <= ovMax && ov0.length <= ovMax, `the overview is bounded by its caps (${ov0.length} chars at entry 120, ${ovLen} at the end, at most ${ovMax}, about ${Math.round(ovMax / 4)} tokens)`);
ok(asked.length >= T.chapters.length && asked.every(x => x.id === A.id && x.snap.items.length <= TI.TIER.BLOCK && JSON.stringify(x.snap).length < 6000), `a chapter rewrite is asked of the relay per chapter (${asked.length}), with a small snapshot`);
ok(lifeMarkdown({name: A.name, tiers: TI.tiersView(A)}).includes('## Chapters (' + T.chapters.length + ')'), 'the Markdown mirror lists landmarks and chapters (LIFE.md)');

console.log('caps: landmarks fold, chapters merge');
{const C = M[2], TC = TI.tiersOf(C), heavy = TI.mark(C, 'death', 'Our healer Mira fell to the Rimehound on day one.', 1);
  for (let i = 0; i < 40; i++) TI.mark(C, i % 2 ? 'level' : 'elite', `Milestone ${i} at Brackwater ${i}`, 2 + i);
  ok(TC.marks.length === TI.TIER.MARKS && TC.marks.includes(heavy), 'past the cap the lightest landmarks fold; the heaviest stays');
  ok(!TC.marks.some(m => m.k === 'elite' && m.day < 30) || TC.marks.filter(m => m.k === 'elite').length < 20, 'the lighter elite marks went first');
  const r2 = act(C, 'journal_search', {query: 'Milestone 0'}); ok(r2.ok && r2.found > 0, 'a folded landmark is still found (in the lines waiting for a chapter, or a chapter)');
  const keep = TI.TIER.CHAPTERS; TI.TIER.CHAPTERS = 4;
  for (let i = 0; i < 200; i++) TI.spill(C, {day: 1 + Math.floor(i / 10), gm: i * 144, text: `Line ${i} of the long road past Fennick Hollow.`});
  ok(TC.chapters.length === 4 && TC.chapters[0].d0 === 1 && TC.chapters.reduce((t, c) => t + (c.items || 0), 0) >= 200, `past the cap the oldest chapters merge (${TC.chapters.length} kept, days ${TC.chapters[0].d0}-${TC.chapters[TC.chapters.length - 1].d1})`);
  TI.TIER.CHAPTERS = keep;
  const c0 = TC.chapters[TC.chapters.length - 1], st = c0.stamp;
  ok(TI.applyChapter(C, st, {title: 'The Long Road', text: 'We walked and walked past Fennick Hollow.'}) && c0.src === 'model' && c0.title === 'The Long Road', 'the relay\'s rewrite applies to an unchanged chapter');
  ok(!TI.applyChapter(C, 'gone:0:0', {title: 'x', text: 'y'}) && !TI.applyChapter(C, st, {title: 'x'}), 'a stale or empty rewrite is dropped');}
ok(KINDS.includes('chapter') && WRITE_KINDS.includes('chapter') && schemaFor('chapter').required.join() === 'title,text', 'the relay kind "chapter" (writing, title + text)');
{let e = null; try {checkWriting('chapter', {title: 'x'})} catch (x) {e = x.message} ok(/missing text/.test(e || ''), 'the relay refuses a chapter with no text');
  const v = checkWriting('chapter', {title: 'T'.repeat(200), text: 'w '.repeat(400)}); ok(v.title.length <= 60 && v.text.length <= 320, 'the relay cuts a long chapter to its caps')}

console.log('old saves migrate; snapshot -> restore');
{const D = M[3]; delete D.tiers; D.journal = [1, 2, 3, 4, 5].map(i => ({t: 'Day ' + (i < 3 ? 1 : 2) + ' 08:00', gameMin: i * 300, text: `Old entry ${i}: the bridge at Saltmere ${i === 1 ? 'and the toll-keeper Ysolde' : ''}.`}));
  const o = act(D, 'journal_read', {}), TD = D.tiers;
  ok(o.ok && TD.chapters.length === 1 && TD.chapters[0].title === null && TD.chapters[0].src === 'migrated' && o.chapters[0] === 'Ch. 1 (Days 1-2)', 'an old journal becomes chapter 1, unlabeled: ' + o.chapters[0]);
  ok(D.journal.length === 5 && D.journal.every(e => e.ch === 1) && o.entries.length === 5, 'its entries stay readable');
  ok(act(D, 'journal_search', {query: 'Ysolde toll'}).results.some(x => x.kind === 'chapter') && act(D, 'journal_search', {query: 'Ysolde toll'}).results.some(x => x.kind === 'entry'), 'journal_search finds an old entry in the entry and in chapter 1');
  for (let i = 0; i < 100; i++) act(D, 'journal_write', {text: 'New entry ' + i + '.'});
  ok(TD.pend.length === 0 && TD.chapters.length === 1 && TD.chapters[0].kw.includes('ysolde'), 'migrated entries fold into chapter 1 when they leave, not into a new one')}
{const before = JSON.stringify(A.tiers); SIM.restore(JSON.parse(JSON.stringify(SIM.snapshot())));
  const A2 = S.agents.find(x => x.id === A.id); ok(A2 && JSON.stringify(A2.tiers) === before, 'snapshot -> restore keeps the tiers');
  const snap = JSON.parse(JSON.stringify(SIM.snapshot())); for (const a of snap.agents || []) delete a.tiers; SIM.restore(snap);
  const A3 = S.agents.find(x => x.id === A.id); const o3 = act(A3, 'journal_read', {});
  ok(o3.ok && A3.tiers && A3.tiers.chapters.length === 1 && A3.tiers.chapters[0].src === 'migrated', 'a save from before #153 (no tiers) migrates on first touch')}

console.log('seats apart; hardcore');
{const A4 = S.agents.find(x => x.id === A.id), B4 = S.agents.find(x => x.id === B.id), mine = act(A4, 'journal_write', {text: 'Only I know of Quillowmere.', landmark: 'yes'});
  ok(mine.ok, 'A writes a private landmark');
  const rb = act(B4, 'journal_search', {query: 'Quillowmere ferryman Olwick Copperhollow'}); ok(rb.ok && !JSON.stringify(rb).match(/Quillowmere|Olwick|Copperhollow/), 'B\'s journal_search never finds A\'s entries, landmarks or chapters');
  ok(!JSON.stringify(act(B4, 'journal_read', {})).match(/Quillowmere|Olwick/), 'nor B\'s overview');
  HE.fall(A4, 'a test of the hardcore rule'); run(2);
  ok(act(A4, 'journal_search', {query: 'ferryman'}).ok === false, 'the fallen hero\'s tools answer no more');
  const heir = SLT.slotMembers(SLT.slotted()).map(m => m.hero).find(h => h && h.id !== A4.id && !M.some(x => x.id === h.id));
  ok(heir ? !JSON.stringify(act(heir, 'journal_search', {query: 'ferryman Olwick Quillowmere'})).match(/Olwick|Quillowmere/) && !(heir.tiers && heir.tiers.marks.some(m => /river stones/.test(m.text))) : true, heir ? `the replacement ${heir.name} starts without them` : 'no replacement yet (skipped)')}

console.log(fail ? `\ntiercheck: ${fail} check(s) failed\n` : '\ntiercheck: all checks passed\n');
process.exit(fail ? 1 : 0);
