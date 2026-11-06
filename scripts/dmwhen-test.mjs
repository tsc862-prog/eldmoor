// The DM's when and watch (issue #635), run as a child by scripts/dmcheck.mjs (or alone: node scripts/dmwhen-test.mjs).
// Set, list, cancel; every trigger kind tripping once (as a watch, and the edge rule); a when firing its action through the
// same tool (narrate heard, a lever pulled with its DM log line naming the when); expiry; a refusal at fire time logged and
// dropped; the caps (pending, per day) and the Fellowship reserve applying to a deferred pull exactly as to a direct one; a
// staged scene previewed when set; once:no at most once a game day; save/restore; a quiet seat writing nothing; and the
// runner's side (eventDue waking on a watch, the turn prompt naming it). No RNG of its own; seeded Math.random. Prints WHEN OK.
let seed = 0x2545f491;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};
const sim = await import('../src/sim/index.js');
const {init, step, S, snapshot, restore, dmAct, setDmSeat} = sim;
const W = await import('../src/sim/dmwhen.js');
const {DMA} = await import('../src/sim/dmagent.js');
const {LEVERS, validate} = await import('../src/sim/levers.js');
const {ZONES, CITY, zoneAt, zonePoint, dist} = await import('../src/world/map.js');
const {maxHp} = await import('../src/sim/heroes.js');
const SLT = await import('../src/sim/company.js');
const {eventDue, whenNote, newWatches, withDmWhenOrders, dmSystemPrompt, EVENT_GAP} = await import('./dm-agent.mjs');
const {DM_TOOLS} = await import('../src/data/dm-tools.js');

let fails = 0;
const ok = (c, msg, extra) => {if (c) console.log('  ok   ' + msg); else {fails++; console.log('  FAIL ' + msg + (extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 400) : ''))}};
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};
const tick = (min = W.WHEN.EVERY) => {S.gameMin += min; W.whenTick()};

init({fac: 0}); run(20);
// a quiet seat: ticks write nothing
setDmSeat(true); for (let i = 0; i < 20; i++) tick();
ok(!S.dmAgent.when, 'a seat with nothing set keeps no when state (the tick returns at once)');
setDmSeat(false);
ok(dmAct('when', {trigger: 'night_falls', action: 'narrate', args: {text: 'x', near: 'table'}, reason: 'r'}).offline, 'a closed seat refuses when');
setDmSeat(true);

const F = SLT.slotted(), mem = SLT.slotHeroes(F).filter(a => a.state !== 'dead');
ok(mem.length >= 2 && mem.every(a => a.player), 'the Fellowship members are agent-played', mem.map(a => [a.name, a.player]));
const M = mem[0], M2 = mem[1];
for (const a of S.agents) if (!SLT.inSlots(a)) a.player = false; // only the five trip "any agent hero" triggers here
const park = (a, z) => {const p = zonePoint(z, null, null); a.x = p.x; a.y = p.y; a.state = 'hunt'; a.hp = maxHp(a); a.town = null; a.pq = []; return p};
const zA = zoneAt(M.x, M.y) >= 0 ? zoneAt(M.x, M.y) : 0, zB = ZONES.findIndex((n, i) => i !== zA && i > 0);
for (const a of mem) park(a, zA);

// ---- refusals at set time ----
const refused = (args, re, msg) => {const r = dmAct('when', args); ok(!r.ok && re.test(r.error || ''), msg, r)};
refused({trigger: 'moon_rises', action: 'narrate', args: {text: 'x', near: 'table'}, reason: 'r'}, /trigger must be one of/, 'an unknown trigger is refused with the list');
refused({trigger: 'night_falls', action: 'narrate', args: {text: 'x', near: 'table'}}, /reason is required/, 'a when without a reason is refused');
refused({trigger: 'night_falls', action: 'fight', args: {}, reason: 'r'}, /cannot be deferred/, 'an action that is not a deferrable tool or lever is refused');
refused({trigger: 'night_falls', action: 'narrate', args: {near: 'table'}, reason: 'r'}, /needs text/, 'an action missing a required argument is refused');
refused({trigger: 'night_falls', action: 'narrate', args: {text: 'x', near: '{who}'}, reason: 'r'}, /needs a trigger that names a hero/, '{who} with a trigger that names nobody is refused');
refused({trigger: 'enter_region', on: {region: 'Nowhereland'}, action: 'narrate', args: {text: 'x', near: 'table'}, reason: 'r'}, /needs region/, 'an unknown region is refused');
refused({trigger: 'foe_dies', on: {name: 'Nobody At All'}, action: 'narrate', args: {text: 'x', near: 'table'}, reason: 'r'}, /no named foe/, 'a foe that is not alive is refused');
refused({trigger: 'night_falls', action: 'narrate', args: {text: 'x', near: 'Atlantis'}, reason: 'r'}, /unknown place/, 'a narrate near an unknown place is refused when set');
refused({trigger: 'night_falls', action: 'set_condition', args: {region: ZONES[zB], kind: 'no-such-kind'}, reason: 'r'}, /the lever set_condition/, 'a lever with bad params is refused when set (validated like the lever)');
refused({trigger: 'night_falls', action: 'narrate', args: {text: 'x', near: 'table'}, hours: 100, reason: 'r'}, /hours is 1-72/, 'hours out of range is refused');

// ---- a when fires its action through the same tool ----
park(M, zB); park(M2, zB);
let r = dmAct('when', {trigger: 'enter_region', on: {region: ZONES[zA], hero: M.name}, action: 'narrate', args: {text: 'FOG-LINE rolls off the water.', near: '{who}', radius: 4}, reason: 'the bog announces itself'});
ok(r.ok && r.when, 'when enter_region -> narrate is set', r);
const wid = r.when;
let L = dmAct('whens');
ok(L.ok && L.whens.length === 1 && L.whens[0].id === wid && /enters/.test(L.whens[0].when) && L.triggers.length === W.TRIGGER_NAMES.length && L.actions.includes('narrate'), 'whens lists it, the triggers and the actions', L);
tick(); ok(!(M.chat || []).some(e => /FOG-LINE/.test(e.text)), 'nothing fires while the hero is elsewhere');
park(M, zA); tick();
ok((M.chat || []).some(e => /FOG-LINE/.test(e.text) && e.dm), 'the hero who entered hears the narration ({who} is that hero)');
ok(!dmAct('whens').whens.length, 'a once when is gone after it fired');
let st = dmAct('dm_status');
ok(st.fired && st.fired.some(f => f.id === wid && f.status === 'fired' && f.who === M.name && f.tool === 'narrate'), 'dm_status fired names it', st.fired);
ok((S.dmLog || []).some(e => e.detail && e.detail.when === wid && e.detail.voice === 'narrate'), 'the narration\'s own DM log line carries when');
ok((S.dmLog || []).some(e => e.detail && e.detail.when === wid && /fired/.test(String(e.summary.join ? e.summary.join('') : e.summary))), 'a DM log line says the when fired');

// edge rule: already true at set time does not fire until it happens again
r = dmAct('when', {trigger: 'enter_region', on: {region: ZONES[zA], hero: M.name}, action: 'narrate', args: {text: 'EDGE-LINE', near: '{who}'}, reason: 'edge'});
tick(); ok(!(M.chat || []).some(e => /EDGE-LINE/.test(e.text)), 'a condition already true when set does not fire');
park(M, zB); tick(); park(M, zA); tick();
ok((M.chat || []).some(e => /EDGE-LINE/.test(e.text)), 'it fires once it turns false and true again');

// ---- a lever when: applied, counted, logged with its when ----
S.conditions = S.conditions.filter(c => c.z !== zB); S.levers.cd = {};
const pulls0 = S.dmAgent.day.d === Math.floor(S.gameMin / 1440) ? S.dmAgent.day.pulls : 0;
r = dmAct('when', {trigger: 'after_hours', on: {h: 1}, action: 'set_condition', args: {region: ZONES[zB], kind: LEVERS.set_condition.params.kind.values[0]}, reason: 'the weather turns as planned'});
ok(r.ok, 'when after_hours -> set_condition (a lever name) is set', r);
const lid = r.when; tick(30); ok(!S.conditions.some(c => c.z === zB), 'not before its hour');
tick(32);
ok(S.conditions.some(c => c.z === zB), 'the lever was pulled when the hours passed');
ok((S.dmLog || []).some(e => e.kind === 'lever' && e.detail && e.detail.when === lid && e.detail.by === 'dm-agent' && e.detail.result === 'applied'), 'its lever log line is by dm-agent and names the when');
ok(S.dmAgent.day.pulls === pulls0 + 1, 'it counts toward the DM agent\'s pulls of the day');

// ---- refused at fire time: logged and dropped, never retried ----
S.dmAgent.day.pulls = DMA.PULLS_PER_DAY;
const zC = ZONES.findIndex((n, i) => i !== zA && i !== zB && i > 0);
S.conditions = S.conditions.filter(c => c.z !== zC);
r = dmAct('when', {trigger: 'after_hours', on: {h: 1}, action: 'pull_lever', args: {lever: 'set_condition', params: {region: ZONES[zC], kind: LEVERS.set_condition.params.kind.values[0]}}, reason: 'too many pulls today'});
const rid = r.when; tick(62);
st = dmAct('whens');
ok(st.fired.some(f => f.id === rid && f.status === 'refused' && /levers today/.test(f.why)), 'a when refused at fire time is logged with why', st.fired);
ok(!st.whens.some(w => w.id === rid), 'and dropped (not retried)');
ok(!S.conditions.some(c => c.z === zC), 'nothing was applied');
S.dmAgent.day.pulls = 0;

// ---- the Fellowship reserve: a deferred world pull is refused exactly like a direct one ----
{const def = LEVERS.set_condition, D = S.levers.day; S.levers.cd = {};
  const far = ZONES.map((n, i) => i).filter(i => i > 0 && !mem.some(a => zoneAt(a.x, a.y) === i) && !S.conditions.some(c => c.z === i));
  const zR = far[far.length - 1]; D.n.set_condition = 1; D.nf.set_condition = 1; // the world's share used, the reserve left
  const direct = dmAct('pull_lever', {lever: 'set_condition', params: {region: ZONES[zR], kind: def.params.kind.values[0]}, reason: 'direct'});
  r = dmAct('when', {trigger: 'after_hours', on: {h: 1}, action: 'set_condition', args: {region: ZONES[zR], kind: def.params.kind.values[0]}, reason: 'deferred'});
  const qid = r.when; tick(62); const f = dmAct('whens').fired.find(x => x.id === qid);
  ok(!direct.ok && /kept for/.test(direct.error) && f && f.status === 'refused' && /kept for/.test(f.why), 'a deferred world pull hits the Fellowship reserve like a direct one', {direct: direct.error, f});
  D.n.set_condition = 0; D.nf.set_condition = 0}

// ---- every trigger kind trips once (as a watch) ----
const hits = () => dmAct('whens').watches_fired;
const watchOnce = (trigger, on, induce, msg) => {const w = dmAct('watch', {trigger, on, note: 'note-' + trigger});
  if (!w.ok) {ok(false, msg + ' (set)', w); return}
  tick(); const before = hits().filter(h => h.watch === w.watch).length; induce(); tick();
  const after = hits().filter(h => h.watch === w.watch);
  ok(before === 0 && after.length === 1 && after[0].note === 'note-' + trigger, msg, {before, after, hits: hits().slice(0, 3)})};
park(M, zB);
watchOnce('enter_region', {region: ZONES[zA], company: 'fellowship'}, () => park(M, zA), 'enter_region (company) trips');
const town = CITY[0];
watchOnce('enter_town', {town: town.name, hero: M.name}, () => {M.state = 'town'; M.town = town.name; M.x = town.gate.x; M.y = town.gate.y}, 'enter_town trips');
park(M, zA);
const pt = {x: Math.round(M.x + 8), y: Math.round(M.y)};
watchOnce('near_place', {place: pt.x + ',' + pt.y, radius: 3, hero: M.name}, () => {M.x = pt.x; M.y = pt.y}, 'near_place trips');
sim.ensureNpcs && sim.ensureNpcs();
const npcs = (await import('../src/sim/npcs.js')); npcs.ensureNpcs();
const P = S.npcs.find(p => Number.isFinite(p.x));
park(M, zA);
watchOnce('near_person', {npc: String(P.id), radius: 3}, () => {M.x = P.x; M.y = P.y}, 'near_person trips');
{const T = (await import('../src/sim/talk.js')).talkState();
  watchOnce('talks_to', {npc: P.name}, () => {T.past.push({id: ++T.seq, npc: P.id, heroes: [M.id], lines: [], state: 'closed'})}, 'talks_to trips');
  T.past.pop()}
park(M, zA);
watchOnce('member_hp_below', {pct: 30, company: 'fellowship'}, () => {M.hp = Math.floor(maxHp(M) * .1)}, 'member_hp_below trips');
M.hp = maxHp(M);
{const m = S.mobs.find(x => x.hp > 0); m.name = 'Gravemaw the Test';
  watchOnce('foe_dies', {name: 'gravemaw'}, () => {m.hp = 0}, 'foe_dies trips')}
{const adv = {id: ++S.uid, phase: 'open', title: 'The Test Road', tpl: 'escort', town: town.name, lead: M.id, mem: [M.id], idx: 0, scenes: [{}, {}, {}]}; S.adventures.push(adv);
  watchOnce('quest_scene', {quest: adv.id, scene: 2}, () => {adv.phase = 'active'; adv.idx = 1}, 'quest_scene trips');
  S.adventures.splice(S.adventures.indexOf(adv), 1)}
watchOnce('camp_made', {hero: M.name}, () => {M.state = 'camp'}, 'camp_made trips');
park(M, zA);
const toHour = hh => {const m = (S.gameMin % 1440); return ((hh * 60 - m) + 1440) % 1440 || 1440};
watchOnce('night_falls', {}, () => {S.gameMin += toHour(20) - W.WHEN.EVERY + 1}, 'night_falls trips');
watchOnce('day_breaks', {}, () => {S.gameMin += toHour(6) - W.WHEN.EVERY + 1}, 'day_breaks trips');
watchOnce('at_time', {hh: 14}, () => {S.gameMin += toHour(14) - W.WHEN.EVERY + 1}, 'at_time trips');
watchOnce('after_hours', {h: 2}, () => {S.gameMin += 120}, 'after_hours trips');
watchOnce('hero_levels', {hero: M.name}, () => {M.lvl++}, 'hero_levels trips');
M.goal = {text: 'Slay ten marsh wolves', done: false, need: 10, progress: 3};
watchOnce('oath_kept', {company: 'fellowship'}, () => {M.goal.done = true}, 'oath_kept trips');
M.goal = {text: 'A thread nobody swore', done: false, need: 1, progress: 0, offered: true};
{const n = hits().length; watchOnce('oath_kept', {company: 'fellowship'}, () => {M.oathKept = {text: 'I will never be cold', at: Math.round(S.gameMin)}; M.goal = {text: 'Rolled', done: false, need: 1, progress: 0, offered: true, aside: true}}, 'an oath in the hero\'s own words trips it after the goal has moved on (#800)'); ok(hits().length > n, 'once')}
M.goal = null; delete M.oathKept;
ok(new Set(hits().map(h => h.id)).size === hits().length, 'each hit has its own id');

// once:no -> at most once a game day
{S.gameMin = Math.floor(S.gameMin / 1440) * 1440 + 600; park(M, zA);
  const w = dmAct('watch', {trigger: 'camp_made', on: {hero: M.name}, once: 'no', hours: 72});
  const n = () => (dmAct('whens').watches.find(x => x.id === w.watch) || {}).fired || 0; // its own count (the day-old hit leaves the 24 h list)
  M.state = 'camp'; tick(); park(M, zA); tick(); M.state = 'camp'; tick();
  ok(n() === 1, 'a repeating watch trips at most once a game day', n());
  park(M, zA); S.gameMin += 1440; tick(); M.state = 'camp'; tick();
  ok(n() === 2, 'and again the next day', n());
  ok(dmAct('unwatch', {id: w.watch}).ok && !dmAct('whens').watches.some(x => x.id === w.watch), 'unwatch drops it');
  park(M, zA)}

// ---- caps ----
{for (const e of dmAct('whens').whens) dmAct('unwhen', {id: e.id}); for (const e of dmAct('whens').watches) dmAct('unwatch', {id: e.id});
  S.dmAgent.when.day.when = 0; S.dmAgent.when.day.watch = 0;
  const one = i => dmAct('when', {trigger: 'after_hours', on: {h: 10 + i}, action: 'narrate', args: {text: 'cap ' + i, near: 'table'}, reason: 'cap'});
  const got = []; for (let i = 0; i < W.WHEN.MAX; i++) got.push(one(i).ok);
  const over = one(99);
  ok(got.every(Boolean) && !over.ok && /pending already/.test(over.error), 'at most ' + W.WHEN.MAX + ' whens pending', over);
  const c = dmAct('unwhen', {id: dmAct('whens').whens[0].id});
  ok(c.ok && c.whens === W.WHEN.MAX - 1, 'unwhen cancels one', c);
  ok(!dmAct('unwhen', {id: 99999}).ok, 'unwhen of an unknown id is refused');
  for (const e of dmAct('whens').whens) dmAct('unwhen', {id: e.id});
  S.dmAgent.when.day.when = W.WHEN.PER_DAY; const d = one(1);
  ok(!d.ok && /set today/.test(d.error), 'at most ' + W.WHEN.PER_DAY + ' whens set a game day', d);
  S.dmAgent.when.day.when = 0;
  const ws = []; for (let i = 0; i < W.WATCH.MAX; i++) ws.push(dmAct('watch', {trigger: 'after_hours', on: {h: 20 + i}}).ok);
  const wo = dmAct('watch', {trigger: 'after_hours', on: {h: 30}});
  ok(ws.every(Boolean) && !wo.ok && /watches are set/.test(wo.error), 'at most ' + W.WATCH.MAX + ' watches', wo);
  for (const e of dmAct('whens').watches) dmAct('unwatch', {id: e.id})}

// ---- expiry ----
{const e = dmAct('when', {trigger: 'enter_town', on: {town: town.name, hero: M2.name}, action: 'narrate', args: {text: 'never', near: '{who}'}, hours: 1, reason: 'expire'});
  tick(62); const f = dmAct('whens');
  ok(!f.whens.some(x => x.id === e.when) && f.fired.some(x => x.id === e.when && x.status === 'expired'), 'a when that never tripped expires after its hours', f.fired)}

// ---- a staged scene is previewed when set ----
{park(M, zA); for (const a of mem) park(a, zA);
  const e = dmAct('when', {trigger: 'night_falls', action: 'stage_scene', args: {kind: 'ambush', near: 'fellowship', frame: 'Wolves slink out of the reeds, ears flat.'}, reason: 'a night ambush'});
  ok(e.ok && e.preview && (e.preview.cast || e.preview.creatures || e.preview.now), 'a deferred stage_scene comes back with its preview', e);
  if (e.ok) dmAct('unwhen', {id: e.when})}

// ---- save and restore ----
{const e = dmAct('when', {trigger: 'enter_region', on: {region: ZONES[zB], hero: M.name}, action: 'narrate', args: {text: 'SAVED-LINE', near: '{who}'}, reason: 'saved'});
  const w = dmAct('watch', {trigger: 'hero_levels', on: {hero: M2.name}, note: 'kept'});
  const json = JSON.stringify(snapshot()); restore(JSON.parse(json));
  const v = dmAct('whens');
  ok(v.whens.some(x => x.id === e.when) && v.watches.some(x => x.id === w.watch), 'whens and watches survive save and restore', v);
  const H = S.agents.find(a => a.id === M.id); park(H, zB); tick();
  ok((H.chat || []).some(x => /SAVED-LINE/.test(x.text)), 'and fire after it')}

// ---- the runner's side: a watch wakes it, the prompt names it ----
{const st0 = {ok: true, day: 3, gameMin: 5000, fellowship_change: 'sig-a', watches_fired: [{id: 4, watch: 2, what: 'Kerin enters Mirefen', day: 3, t: '14:00', note: 'the witch'}], fired: [{seq: 7, id: 3, trigger: 'night falls', tool: 'narrate', status: 'fired'}]};
  const last = {sig: 'sig-a', gm: 5000 - EVENT_GAP, watch: 3};
  ok(eventDue(st0, last, {day: -1, n: 0}), 'eventDue: a new watch hit wakes the runner (signature unchanged)');
  ok(!eventDue(st0, {...last, watch: 4}, {day: -1, n: 0}), 'eventDue: a hit already seen does not');
  ok(!eventDue(st0, {...last, gm: 5000 - 10}, {day: -1, n: 0}), 'eventDue: still within EVENT_GAP');
  ok(!eventDue(st0, last, {day: 3, n: EVENT_MAX}), 'eventDue: still within EVENT_MAX a day');
  ok(eventDue({...st0, watches_fired: []}, {...last, sig: 'sig-b'}, {day: -1, n: 0}), 'eventDue: the fellowship_change floor still wakes it');
  const n = whenNote(st0, {watch: 3, fired: 6});
  ok(/Your watch fired: Kerin enters Mirefen/.test(n) && /the witch/.test(n) && /when 3 \(night falls\): narrate fired/.test(n), 'the turn prompt names the watch and the when', n);
  ok(whenNote(st0, {watch: 4, fired: 7}) === '', 'and nothing once seen');
  const sys = dmSystemPrompt({fellowship: null});
  ok(/when \{trigger: "enter_region"/.test(sys) && /watch \{trigger: "talks_to"/.test(sys) && withDmWhenOrders(sys) === sys && /when and watch/.test(withDmWhenOrders('old prompt')), 'the standing orders explain when and watch with one example each');
  ok(['when', 'whens', 'unwhen', 'watch', 'watches', 'unwatch'].every(n => DM_TOOLS.some(t => t.name === n)), 'the six tools are DM tools')}

console.log(fails ? 'WHEN FAIL ' + fails : 'WHEN OK');
process.exit(fails ? 1 : 0);
