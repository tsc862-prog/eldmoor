// World names in text check (#1003): on a world other than Eldmoor, what heroes and the DM read names that world's own places.
// Runs the Wending Vale (the third world) with a founded Fellowship and the DM seat open for a few game days, gathers every text a
// hero or the DM can read (the Chronicle, the chat heroes hear, each Fellowship member's tool results, brief and runner prompts, the tool
// descriptions, the DM's reads) and fails on any town, region, landmark or dungeon name that belongs only to another world's spec (Eldmoor's
// and the Stepping Lands'), and on the game's own "Eldmoor" where it means the world. Exempt, with the reason below: item names that
// carry a place (Hoarfell Survey Chart, a catalogue id shared by every world) and the peoples' homeland names (a people's own past).
// Usage: npm run worldtextcheck
globalThis.ELDMOOR_WORLD = 'vale';
let seed = 0x1003a ^ (Number(process.env.WORLDTEXT_SEED) || 7);
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
process.env.AGENT_LOGS = (await import('./tmp.mjs')).mkTmp('eldmoor-worldtext-');

const SIM = await import('../src/sim/index.js');
const SLT = await import('../src/sim/company.js');
const {init, step, S, maxHp} = SIM;
const P = await import('../src/sim/player.js');
const DMA = await import('../src/sim/dmagent.js');
const PC = await import('../src/sim/pace.js');
const PE = await import('../src/sim/persona.js');
const {WORLDS, WORLD_ID} = await import('../src/world/spec.js');
const {PLAYER_TOOLS} = await import('../src/data/player-tools.js');
const {DM_TOOLS} = await import('../src/data/dm-tools.js');
const PR = await import('../src/data/prompts.js');
const {systemPrompt} = await import('./agent-player.mjs');
const {fellowshipPrompt} = await import('./fellowship.mjs');

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};
const act = (a, tool, args) => P.playerAct(a.id, tool, args || {});
console.log('\nEldmoor worldtextcheck: text in ' + WORLDS[WORLD_ID].name + ' names its own places (#1003)\n');
ok(WORLD_ID === 'vale', 'the Vale is the world under test');

// ---- the names that belong to other worlds only
const namesOf = sp => {const o = new Set(), add = n => {if (typeof n === 'string' && n.length > 3) o.add(n)};
  for (const r of sp.regions || []) add(r.name); for (const t of sp.towns || []) add(t.name); for (const l of sp.landmarks || []) add(l.name);
  for (const l of sp.outposts || []) add(l.name); return o};
const own = namesOf(WORLDS.vale), foreign = new Set();
for (const [id, sp] of Object.entries(WORLDS)) if (id !== 'vale') for (const n of namesOf(sp)) if (!own.has(n)) foreign.add(n);
foreign.delete('Kragmaw'); // the wyrm is every world's (the lair is the Vale's too)
foreign.delete('Kilnmark'); // the Wend's Head's town is the Vale's outpost Kilnmark Cross grown up (docs/LORE.md); the word is shared on purpose
const words = [...foreign, 'Eldmoor'].map(n => n.replace(/^The /, ''));
// Exempt: item names that carry an Eldmoor region (ids shared by every world and kept in saved packs), and the homeland and hamlet names of the
// peoples (a people's own past, canon in docs/LORE.md, not a place on this map).
const EXEMPT = [/Hoarfell Survey Chart/g, /chart-hoarfell/g, /Thornteeth/g, /Brinereach/g, /X-Eldmoor-/g];
const re = new RegExp('\\b(' + words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'i');
const heard = [];
const keep = (what, v) => {heard.push({what, text: typeof v === 'string' ? v : JSON.stringify(v)}); return v};
const flat = parts => (parts || []).map(p => p == null ? '' : typeof p === 'string' ? p : p.t != null ? p.t : p.name || '').join('');

// ---- found a Fellowship in the Vale, open the DM seat, play a few game days
init({fellowship: false}); keep('opening chronicle', S.chronicle.map(e => flat(e.parts))); run(30);
for (const a of S.agents) if (a.fac === 0) {a.lvl = 6; a.hp = maxHp(a)}
const r0 = SLT.foundSlots(SLT.autoPick(0), {fac: 0, ai: false});
ok(r0.ok, 'a Fellowship founded in the Vale');
SLT.setSlotMinds(SLT.slotted(), 'agent');
const M = SLT.slotMembers(SLT.slotted()).map(m => m.hero);
DMA.setDmSeat(true);
for (let d = 0; d < 4; d++) {run(240); for (const m of M) {act(m, 'status'); act(m, 'chat_read', {n: 30})}}
keep('chronicle', S.chronicle.map(e => flat(e.parts)));
for (const a of S.agents) keep('chat heard by ' + a.name, (a.chat || []).map(c => c.text));
ok(S.chronicle.length > 5, 'the Chronicle has lines (' + S.chronicle.length + ')');
keep('read_chronicle', DMA.dmAct('read_chronicle', {n: 90}));

// ---- each member's hero tools, brief and prompts
const TOOLS = ['status', 'self', 'look', 'lore', 'list_jobs', 'quests', 'recipes', 'nodes', 'journal_read', 'chat_read', 'party_read', 'earshot', 'events', 'inventory', 'regions', 'places'];
for (const m of M) {
  for (const t of TOOLS) keep(m.name + ' ' + t, act(m, t, t === 'chat_read' || t === 'party_read' ? {n: 40} : {}));
  keep(m.name + ' brief', PC.paceBrief(m.id)); keep(m.name + ' self brief', PC.paceBrief(m.id, {self: true}));
  keep(m.name + ' oath and origin', m.goal ? [m.goal.text, m.origin, m.originShort] : '');
  const st = act(m, 'status'); if (!st || st.ok === false || !st.name) continue; /* a member who fell in the days above has no status to read; the prompts are built from one */ keep(m.name + ' system prompt', systemPrompt(st)); keep(m.name + ' fellowship prompt', fellowshipPrompt(st));
  keep(m.name + ' persona facts', PE.factsOf(m));
}
const A = M[0];
// refusals that used to name Eldmoor's places
for (const [tool, args] of [['move_to', {target: 'The Sunken Crypt'}], ['move_to', {target: 'Highgate'}], ['go_crypt', {}], ['join_raid', {}], ['hunt', {where: 'Thornvale'}], ['enter_site', {}], ['intent', {goal: 'hunt', why: 'x'}], ['attempt', {what: 'ласка'}]]) {let r = JSON.stringify(act(A, tool, args)); for (const v of Object.values(args)) if (typeof v === 'string') r = r.split(v).join('<probe>'); keep(A.name + ' ' + tool, r)} // the refusal quotes the tester's own words back; what the game adds must not name another world
// the tool descriptions and the standing prompts every agent reads
keep('player tool descriptions', PLAYER_TOOLS); keep('DM tool descriptions', DM_TOOLS); keep('prompts', PR);
// the templates behind them, every row (a goal type no Vale hero happened to roll still must not name Eldmoor)
{const O = await import('../src/data/origins.js'), CP = await import('../src/data/camp.js'), BK = await import('../src/data/barks.js'), BS = await import('../src/data/bosses.js'), RC = await import('../src/data/races.js'), IT = await import('../src/data/items.js'), NR = await import('../src/data/narration.js'), {worldFill} = await import('../src/world/words.js');
  keep('goal, done and thread templates', [O.GOAL_TEXT, O.GOAL_DONE, O.THREAD_TEXT, O.ORIGINS]); keep('persona wants', PE.WANTS); keep('camp lines', CP.CAMP_LINES || CP); keep('barks', [BK.BARKS, BK.CLASS_BARKS]);
  keep('boss wake lines', Object.values(BS.BOSSES).map(b => b.wake)); keep('peoples', RC.RACES.map(r => r.culture)); keep('dawn openers', NR.DAWN_OPEN);
  keep('item flavours', [IT.EPIC_ITEMS, IT.USES, IT.QUEST_ITEMS].map(t => Object.values(t).map(x => x && x.flavour ? worldFill(x.flavour) : '')))}
// the DM's reads
for (const t of ['dm_status', 'fellowship_view', 'regions', 'hooks', 'levers', 'world_standing', 'read_timeline', 'read_dm_log', 'heroes_near', 'npcs', 'companies_view', 'fellowship_needs']) keep('DM ' + t, DMA.dmAct(t, t === 'heroes_near' ? {near: A.name} : {}));
keep('DM survey', DMA.dmAct('survey', {near: A.name}));

// ---- the check
const hits = [];
for (const h of heard) {
  let t = h.text; for (const x of EXEMPT) t = t.replace(x, '');
  const g = new RegExp(re.source, 'gi'); let m;
  while ((m = g.exec(t))) {hits.push(h.what + ' [' + m[1] + ']: "' + t.slice(Math.max(0, m.index - 50), m.index + 60).replace(/\s+/g, ' ') + '"'); if (hits.length > 400) break}
}
console.log('  gathered ' + heard.length + ' texts, ' + heard.reduce((n, h) => n + h.text.length, 0) + ' characters');
for (const h of hits.slice(0, 40)) console.error('       ' + h);
ok(hits.length === 0, 'no text names a place of another world (' + hits.length + ' hits)');
ok([...own].filter(n => n !== 'Kragmaw').some(n => heard.some(h => h.text.includes(n))), 'the texts do name the Vale\'s own places (the check is not vacuous)');
ok(heard.some(h => h.what === 'opening chronicle' && h.text.includes('The Drowned Weir')), 'the Chronicle names the Vale\'s first dungeon, The Drowned Weir');

console.log(fail ? '\n' + fail + ' check(s) failed' : '\nall checks passed');
process.exit(fail ? 1 : 0);
