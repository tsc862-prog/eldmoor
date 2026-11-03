// Agent-built personality check (issue #409): the `self` and `become` tools, the daily limits, owner pins, the persona
// history, relay writing never overwriting the hero's own words, save and restore (and an old save without history),
// the one-line persona in every turn header and the full text for the Claude standing orders, a reflection that
// changes who the hero is, privacy between companions, and no RNG.
// Usage: npm run personacheck
import {init, S, snapshot, restore, markPlayer, playerAct} from '../src/sim/index.js';
import * as SLT from '../src/sim/company.js'; // the slotted company (#588)
import * as PE from '../src/sim/persona.js';
import {editSheet} from '../src/sim/company.js';
import {paceBrief} from '../src/sim/pace.js';
import {briefText, claudeBrief, personaNote, withPersona, refreshPersona, reflectPrompt} from './pacing.mjs';
import {reflectSchema, reflectBecome, reflectTurn} from './local-agent.mjs';
import {systemPrompt, withMemoryOrders, SELF_ORDERS} from './agent-player.mjs';
import {PLAYER_TOOLS} from '../src/data/player-tools.js';

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const act = (a, tool, args) => playerAct(a.id, tool, args || {});
const nextDay = () => {S.gameMin = (Math.floor(S.gameMin / 1440) + 1) * 1440 + 8 * 60};

init();
const rng0 = JSON.stringify(S.rng ?? null);
const [A, B, C] = SLT.slotHeroes(SLT.slotted());
ok(A && B && C, 'a founded Fellowship');
for (const h of [A, B]) markPlayer(h, true);

console.log('tools');
ok(['self', 'become'].every(n => PLAYER_TOOLS.some(t => t.name === n)), 'self and become are hero tools');
ok(PLAYER_TOOLS.find(t => t.name === 'become').args.why && !PLAYER_TOOLS.find(t => t.name === 'become').args.why.optional, 'become takes a why (required)');
let r = act(A, 'self');
ok(r.ok && r.voice === A.persona.voice && r.wants && r.fears && r.quirk && r.never_says && typeof r.who_you_are === 'string' && r.who_you_are.length <= PE.SELF.LINE, 'self: the persona in the hero\'s own words, with a one-line summary');
ok(Array.isArray(r.stances) && r.stances.some(s => s.who === B.name && s.line), 'self: how it sees each companion');
ok(r.changes_today === '0 of 3' && r.can_change_now.includes('beliefs') && /become/.test(r.how), 'self: what it may change today and how');
ok(Array.isArray(A.persona.hist) && A.persona.hist.length === 0, 'an old persona migrates: an empty history');
// a hero outside the Fellowship gets a persona too
const solo = S.agents.find(h => h.kind === 'hero' && !SLT.inSlots(h) && h.state !== 'dead'); markPlayer(solo, true); delete solo.persona;
r = act(solo, 'self'); ok(r.ok && solo.persona && r.voice && r.stances.length === 0, 'a solo agent hero: a persona built on first self');

console.log('become');
const fear0 = A.persona.fears;
r = act(A, 'become', {field: 'fears', text: 'That Fena will fall while I am out of reach.', why: 'Fena nearly died at the river ford'});
ok(r.ok && A.persona.fears === 'That Fena will fall while I am out of reach.' && r.before === fear0 && r.changes_left_today === 2, 'become changes one field: ' + (r.change || r.error));
const h0 = A.persona.hist[A.persona.hist.length - 1];
ok(h0 && h0.f === 'fears' && h0.before === fear0 && h0.after === A.persona.fears && h0.why === 'Fena nearly died at the river ford' && h0.d === Math.floor(S.gameMin / 1440) + 1, 'the history keeps day, field, before -> after and why');
ok(A.persona.by.fears === 'self' && A.persona.selfN === 1, 'marked as the hero\'s own words');
r = act(A, 'become', {field: 'fears', text: 'Something else.', why: 'again'});
ok(!r.ok && /already changed your fears today/.test(r.error) && /Still open today/.test(r.error), 'one change per field a day, with what is still open: ' + r.error);
r = act(A, 'become', {field: 'courage', text: 'x', why: 'y'}); ok(!r.ok && /voice, wants/.test(r.error) && r.fields, 'an unknown field names the fields');
r = act(A, 'become', {field: 'wants', text: 'To see the Crypt cleared.'}); ok(!r.ok && /why/.test(r.error), 'no why: refused, asking for one');
r = act(A, 'become', {field: 'wants', why: 'x'}); ok(!r.ok && /in text/.test(r.error), 'no text: refused with the cap');
r = act(A, 'become', {field: 'belief', text: 'The dead keep watch over the living. '.repeat(12), why: 'a long night at the graves'});
ok(r.ok && r.field === 'beliefs' && A.persona.beliefs.length <= PE.SELF.BELIEFS && /cut to/.test(r.note), 'aliases (belief -> beliefs); long text cut with a note');
ok(act(A, 'become', {field: 'quirk', text: 'Counts the stars before sleep.', why: 'a habit from the watch'}).ok, 'a third change the same day');
r = act(A, 'become', {field: 'traits', text: 'stubborn', why: 'I would not turn back'});
ok(!r.ok && /changed 3 things/.test(r.error) && r.retry_after_min > 0, 'at most 3 changes a game day, with when: ' + r.error);
// the stance toward a companion, through become, before the day ends? the cap holds: next day
nextDay();
r = act(A, 'become', {field: 'stance', about: B.name, text: 'Owes me a life, and pays it back in jokes.', why: B.name + ' pulled me from the water'});
ok(r.ok && A.persona.stances[B.id] === 'Owes me a life, and pays it back in jokes.' && A.persona.stanceBy[B.id] === 'self', 'a stance toward a companion: ' + (r.change || r.error));
ok(PE.authoredStance(A, B) === A.persona.stances[B.id] && A.memory.stances[B.id].startsWith('Owes me a life'), 'the hero\'s own stance counts as authored and reaches its memory');
ok((PE.fellowCard(A).companions || []).some(l => l.startsWith(B.name + ' ') && l.includes('Owes me a life')), 'and the fellowCard every prompt reads');
r = act(A, 'become', {field: 'stance', about: C.name, text: 'Too quiet to trust yet.', why: C.name + ' says nothing at camp'});
ok(r.ok, 'a stance per person a day (a second companion the same day)');
r = act(A, 'become', {field: 'stance', about: 'Old Merel the innkeeper', text: 'Waters the ale and tells the truth.', why: 'she warned us of the fog'});
ok(r.ok && A.persona.views['old merel the innkeeper'].line === 'Waters the ale and tells the truth.', 'a stance toward a person who is no hero');
ok(act(A, 'self').people.some(p => p.who === 'Old Merel the innkeeper'), 'self lists the people it has a view of');
nextDay();
r = act(A, 'become', {field: 'stance', about: A.name, text: 'x', why: 'y'}); ok(!r.ok && /That is you/.test(r.error), 'no stance toward oneself');
r = act(A, 'become', {field: 'stance', text: 'x', why: 'y'}); ok(!r.ok && /about/.test(r.error), 'a stance needs about');
r = act(A, 'become', {field: 'traits', text: 'stubborn, wry, hungry', why: 'a week on the road'});
ok(r.ok && PE.traitsOf(A.persona).join(',') === 'stubborn,wry,hungry', 'traits: a comma list sets them');
nextDay(); r = act(A, 'become', {field: 'traits', text: 'patient', why: 'I waited out the storm'});
ok(r.ok && PE.traitsOf(A.persona).includes('patient') && PE.traitsOf(A.persona).length === 4, 'traits: one trait is added');
nextDay(); r = act(A, 'become', {field: 'traits', op: 'drop', text: 'hungry', why: 'we eat well now'});
ok(r.ok && !PE.traitsOf(A.persona).includes('hungry'), 'traits: op drop removes one');
nextDay(); r = act(A, 'become', {field: 'traits', op: 'drop', text: 'brave', why: 'x'}); ok(!r.ok && /no trait "brave"/.test(r.error), 'dropping a trait you lack names the ones you hold');
r = act(A, 'become', {field: 'traits', text: 'a,b,c,d,e,f,g', why: 'many'}); ok(r.ok && PE.traitsOf(A.persona).length === PE.SELF.TRAITS && /fades/.test(r.note), 'traits capped at ' + PE.SELF.TRAITS + ' (the oldest fades)');
r = act(A, 'become', {field: 'beliefs', op: 'add', text: 'Debts are paid in full.', why: 'the ferryman'}); ok(r.ok && /Debts are paid in full\.$/.test(A.persona.beliefs), 'beliefs: op add appends');
r = act(A, 'become', {field: 'voice', text: A.persona.voice, why: 'same'}); ok(!r.ok && /already/.test(r.error), 'the same words: refused as already so');
r = act(A, 'become', {field: 'voice', text: 'Говорю тихо и только по делу.', why: 'x'}); ok(!r.ok && /English/.test(r.error), 'not English: refused');

console.log('owner pins');
nextDay();
ok(PE.pinField(A, 'wants', true) && PE.pinned(A, 'wants'), 'the owner pins wants');
r = act(A, 'become', {field: 'wants', text: 'Gold.', why: 'greed'}); ok(!r.ok && r.fixed && /fixed/.test(r.error) && /You can still change/.test(r.error) && A.persona.wants !== 'Gold.', 'a pinned field is refused, with what is still free: ' + r.error);
ok((act(A, 'self').fixed || []).includes('Wants') && !act(A, 'self').can_change_now.includes('wants'), 'self says it is fixed');
PE.pinField(A, 'stance', true); r = act(A, 'become', {field: 'stance', about: B.name, text: 'x', why: 'y'}); ok(!r.ok && r.fixed, 'a pinned stance covers every stance');
PE.pinField(A, 'stance', false); PE.pinField(A, 'wants', false);
r = act(A, 'become', {field: 'wants', text: 'To bring all five home.', why: 'the river'}); ok(r.ok, 'unpinned: free again');
ok(PE.pinField(A, 'nonsense', true) === false, 'an unknown pin is refused');

console.log('history');
const n0 = A.persona.hist.length;
ok(n0 >= 10 && A.persona.hist.every(h => h.d && h.f && 'before' in h && h.after != null && h.why), n0 + ' changes in the history');
for (let i = 0; i < PE.SELF.HIST + 5; i++) {nextDay(); act(A, 'become', {field: 'quirk', text: 'Quirk number ' + i, why: 'day ' + i})}
ok(A.persona.hist.length === PE.SELF.HIST && A.persona.hist[A.persona.hist.length - 1].after === 'Quirk number ' + (PE.SELF.HIST + 4), 'capped at ' + PE.SELF.HIST + ', newest kept');
ok(act(A, 'self').recent_changes.length === PE.SELF.SHOW && /^Day \d+: quirk:/.test(act(A, 'self').recent_changes[0]), 'self shows the latest changes');

console.log('relay writing and sheets keep it');
const mine = A.persona.fears, model = {voice: 'Model voice.', wants: 'Model wants.', fears: 'Model fears.', quirk: 'Model quirk.', never_says: 'Model line.', stances: {[B.id]: 'Model stance.', [C.id]: 'Model stance C.'}};
ok(PE.applyPersona(A, model, SLT.slotHeroes(SLT.slotted()), 'test-model') && A.persona.fears === mine && A.persona.stances[B.id].startsWith('Owes me a life') && A.persona.hist.length === PE.SELF.HIST, 'applyPersona never overwrites the hero\'s own fields, stances or history');
ok(A.persona.voice === 'Model voice.', 'fields the hero never touched still take relay writing');
{const before = JSON.stringify({f: A.persona.fears, h: A.persona.hist, t: A.persona.traits, b: A.persona.beliefs});
 A.persona.edited = false; const fresh = PE.keepSelf(A.persona, PE.buildPersona(A, SLT.slotHeroes(SLT.slotted())));
 ok(JSON.stringify({f: fresh.fears, h: fresh.hist, t: fresh.traits, b: fresh.beliefs}) === before && fresh.stances[B.id].startsWith('Owes me a life'), 'a rebuilt sheet keeps the hero\'s own words, history and pins')}
ok(SLT.editSheet(A, 'persona', 'traits', 'calm, kind') && PE.traitsOf(A.persona).join(',') === 'calm,kind', 'the owner edits traits as a list');

console.log('the header and the standing orders');
{const b = paceBrief(A.id).brief, full = paceBrief(A.id, {self: true}).brief;
 ok(typeof b.persona === 'string' && b.persona.length > 20 && b.persona.length <= PE.SELF.LINE && b.personaV && !('self' in b), 'the brief carries one persona line and a signature');
 ok(briefText(b).includes('\nWho you are: ' + b.persona) && claudeBrief(b).includes('Who you are: '), 'every turn header (local and Claude) shows it: ' + personaNote(b).trim().slice(0, 120));
 ok(typeof full.self === 'string' && full.self.startsWith(PE.PERSONA_HEAD) && full.self.includes(A.persona.fears) && full.self.endsWith(PE.PERSONA_TAIL), 'on request, the whole persona as standing-order text');
 const st = act(A, 'status'), sys0 = withMemoryOrders(systemPrompt(st));
 ok(sys0.includes(SELF_ORDERS) && withMemoryOrders(sys0) === sys0, 'the standing orders explain self and become (once)');
 const sys1 = withPersona(sys0, full.self), sys2 = withPersona(sys1, full.self.replace(A.persona.fears, 'NEW FEAR'));
 ok(sys1.split(PE.PERSONA_HEAD).length === 2 && sys2.split(PE.PERSONA_HEAD).length === 2 && sys2.includes('NEW FEAR') && !sys2.includes(A.persona.fears) && sys2.startsWith(sys0), 'the persona block is replaced in place, never doubled');
 const sess = {system: sys0}, calls = [];
 const pacer = {brief: async o => {calls.push(o); return paceBrief(A.id, o).brief}};
 ok(await refreshPersona(pacer, sess, b) && sess.system.includes(A.persona.fears) && sess.personaV === b.personaV, 'a Claude runner writes the persona into its orders');
 ok(!(await refreshPersona(pacer, sess, b)) && calls.length === 1, 'unchanged: no refresh');
 nextDay(); act(A, 'become', {field: 'fears', text: 'Growing old before the Crypt is cleared.', why: 'grey in my beard'});
 const b2 = paceBrief(A.id).brief; ok(b2.personaV !== b.personaV && await refreshPersona(pacer, sess, b2) && sess.system.includes('Growing old before') && sess.system.split(PE.PERSONA_HEAD).length === 2, 'changed: refreshed on the next turn')}

console.log('reflection');
{ok(/has this changed who you are/i.test(reflectPrompt({why: 'camp'})) && /become/.test(reflectPrompt({why: 'camp'})), 'the reflection asks whether the moment changed who the hero is');
 ok(/"become"/.test(reflectPrompt({why: 'camp'}, {tools: false})), 'the forced answer prompt names the become object');
 const st = reflectSchema({strict: true}), lo = reflectSchema();
 ok(st.required.includes('become') && st.properties.become.properties.field.enum.includes('none') && !lo.required.includes('become'), 'the schema: become required in strict mode (field none), optional otherwise');
 ok(reflectBecome('{"notes":[],"become":{"field":"none","text":"","why":"","about":""}}') === null && reflectBecome('{"notes":[]}') === null, 'field none or no become: no change');
 nextDay(); const sent = [];
 const ask = async () => ({text: JSON.stringify({notes: [{title: 'The ford', text: 'We crossed.', tags: ['road'], about: ''}], become: {field: 'beliefs', text: 'Rivers remember.', why: 'the ford', about: ''}}), usage: {in: 10, out: 10}});
 const t = await reflectTurn({ask, call: async (tool, args) => {sent.push(tool); return act(B, tool, args)}, sess: {system: 's'}, moment: {id: 'm1', kind: 'camp', why: 'camp'}, prompt: 'p'});
 ok(sent.join(',') === 'remember,become' && t.became === 'beliefs' && B.persona.beliefs === 'Rivers remember.' && /changed/.test(t.narration), 'a reflection answer with become changes the persona: ' + t.narration)}

console.log('privacy');
{nextDay(); const secret = 'QZXsecret' + Date.now().toString(36);
 ok(act(B, 'become', {field: 'fears', text: 'B fears ' + secret, why: 'B hides ' + secret}).ok, 'B changes its own fears');
 act(B, 'become', {field: 'stance', about: A.name, text: 'A is a fool ' + secret, why: secret});
 const seen = JSON.stringify([act(A, 'self'), act(A, 'status'), act(A, 'look'), paceBrief(A.id, {self: true}), act(A, 'party_read', {n: 20}), act(A, 'chat_read', {n: 20})]);
 ok(!seen.includes(secret), 'A never reads B\'s persona, its changes or why');
 ok(JSON.stringify(act(B, 'self')).includes(secret), 'B reads its own')}

console.log('save and restore');
{const hist = JSON.stringify(A.persona.hist), pins = (PE.pinField(A, 'voice', true), JSON.stringify(A.persona.pins));
 const snap = JSON.parse(JSON.stringify(snapshot())); A.persona.hist = []; restore(snap);
 const A2 = S.agents.find(x => x.id === A.id);
 ok(JSON.stringify(A2.persona.hist) === hist && JSON.stringify(A2.persona.pins) === pins && A2.persona.beliefs === A.persona.beliefs, 'history, pins, beliefs and traits survive a save round trip');
 const old = JSON.parse(JSON.stringify(snapshot())), o = old.agents.find(x => x.id === A.id);
 for (const k of ['hist', 'pins', 'by', 'views', 'selfDay', 'selfN', 'selfAt', 'beliefs', 'traits']) delete o.persona[k];
 restore(old); const A3 = S.agents.find(x => x.id === A.id);
 r = act(A3, 'self'); ok(r.ok && A3.persona.hist.length === 0 && r.beliefs === '(none named yet)', 'an old save migrates (no history)');
 nextDay(); ok(act(A3, 'become', {field: 'wants', text: 'A fresh start.', why: 'the old save'}).ok && A3.persona.hist.length === 1, 'and grows from there')}

console.log('hardcore');
{const D = S.agents.find(x => x.id === B.id); D.state = 'dead'; D.cause = 'a test';
 r = act(D, 'become', {field: 'wants', text: 'x', why: 'y'}); ok(!r.ok && r.dead, 'a dead hero changes nothing (it dies with the hero)');
 r = act(D, 'self'); ok(!r.ok && r.dead, 'and has no self to read')}

ok(JSON.stringify(S.rng ?? null) === rng0, 'no random stream touched');
if (fail) {console.error(fail + ' failure(s)'); process.exit(1)}
console.log('personacheck ok');
