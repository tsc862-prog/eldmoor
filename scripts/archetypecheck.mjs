// Fellowship archetypes check (#295): each archetype applies, fills every persona field within
// its length cap, changes no sim facts, a second apply replaces the first cleanly, results are
// deterministic and the world's random stream is not touched.
// Usage: npm run archetypecheck
import {init, S} from '../src/sim/index.js';
import {applyArchetype, buildPersona, factsOf} from '../src/sim/persona.js';
import {ARCHETYPES, ARCHETYPE_IDS} from '../src/data/archetypes.js';
import {PERSONA_FIELDS, STANCE_MAX} from '../src/data/prompts.js';

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
init({fellowship: false});
const mk = () => S.agents.find(a => a.state !== 'dead');
const hero = mk();
const FIELDS = Object.keys(PERSONA_FIELDS);
const sim = a => JSON.stringify({id: a.id, name: a.name, cls: a.cls, lvl: a.lvl, fac: a.fac, home: a.home, goal: a.goal, bonds: a.bonds, history: a.history, traits: a.traits, origin: a.origin, nemesis: a.nemesis, facts: factsOf(a)});

ok(ARCHETYPE_IDS.length >= 6, 'at least six archetypes');
const before = sim(hero), snapRng = JSON.stringify(S.rng ?? null);
for (const id of ARCHETYPE_IDS) {
  const A = ARCHETYPES[id];
  ok(A.name && A.blurb, id + ': name and blurb');
  for (const k of FIELDS) ok(typeof A[k] === 'string' && A[k].length > 0 && A[k].length <= PERSONA_FIELDS[k], id + ': ' + k + ' filled within ' + PERSONA_FIELDS[k]);
  ok(A.stance && A.stance.includes('{other}') && A.stance.length <= STANCE_MAX, id + ': default stance');
  ok(applyArchetype(hero, id) === true, id + ': applies');
  ok(FIELDS.every(k => hero.persona[k] === A[k]) && hero.persona.archetype === id, id + ': persona text written');
  ok(sim(hero) === before, id + ': sim facts unchanged');
}
// second apply replaces the first
applyArchetype(hero, 'veteran'); applyArchetype(hero, 'zealot');
ok(hero.persona.archetype === 'zealot' && hero.persona.voice === ARCHETYPES.zealot.voice && !JSON.stringify(hero.persona).includes(ARCHETYPES.veteran.quirk), 'second apply replaces the first');
// existing stances survive
const b = buildPersona(hero, []); b.stances = {99: 'kept'}; hero.persona = b; applyArchetype(hero, 'schemer');
ok(hero.persona.stances[99] === 'kept', 'stances toward companions kept');
// deterministic
const h2 = {...hero, persona: undefined}; applyArchetype(h2, 'mercenary'); const h3 = {...hero, persona: undefined}; applyArchetype(h3, 'mercenary');
ok(JSON.stringify(h2.persona) === JSON.stringify(h3.persona), 'deterministic');
// stance fill (#295 follow-up): {other} becomes each companion's name, only where no stance of their own stands
{const mates = S.agents.filter(a => a !== hero && a.state !== 'dead').slice(0, 3);
 const h = {...hero, persona: undefined}; applyArchetype(h, 'coward', mates);
 ok(mates.every(b => h.persona.stances[b.id] === ARCHETYPES.coward.stance.replace('{other}', b.name)), 'stance template filled with each companion name');
 ok(mates.every(b => h.persona.stances[b.id].length <= STANCE_MAX && !h.persona.stances[b.id].includes('{other}')), 'filled stances within the cap, no placeholder left');
 h.persona.stances[mates[0].id] = 'Owes them a horse.'; h.persona.src = 'model'; // a model-written stance
 applyArchetype(h, 'idealist', mates);
 ok(h.persona.stances[mates[0].id] === 'Owes them a horse.', 'a model-written stance of their own is kept');
 ok(h.persona.stances[mates[1].id] === ARCHETYPES.idealist.stance.replace('{other}', mates[1].name), 'the previous archetype stance is replaced by the new one');
 const sc = buildPersona(h, mates); h.persona = sc; applyArchetype(h, 'veteran', mates);
 ok(mates.every(b => h.persona.stances[b.id] === ARCHETYPES.veteran.stance.replace('{other}', b.name)), 'scripted default stances give way to the archetype');
 ok(sim(hero) === before, 'stance fill changes no sim facts')}
ok(applyArchetype(hero, 'nope') === false, 'unknown id refused');
ok(JSON.stringify(S.rng ?? null) === snapRng, 'random stream untouched');
if (fail) {console.error(fail + ' failure(s)'); process.exit(1)}
console.log('archetypecheck ok');
