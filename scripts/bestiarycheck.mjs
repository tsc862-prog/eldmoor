// Bestiary check: calibration of role scaling against the old flat formula, ELITES vs template,
// encounter builder determinism and budgets, customFoe caps, and sample output.
// Usage: npm run bestiarycheck
import {MOBS, COUNTS, ELITES} from '../src/data/mobs.js';
import {blockOf, ROLES, ELITE_TEMPLATE, BESTIARY, ABILITIES} from '../src/data/bestiary.js';

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};

// ---- calibration: COUNTS-weighted mean multipliers per zone and overall ----
const Z = {}, T = {hp: 0, dps: 0, xp: 0, gear: 0, n: 0};
for (const k in COUNTS) {
  const b = blockOf(k), n = COUNTS[k], z = MOBS[k].z, R = ROLES[b.role];
  const q = Z[z] || (Z[z] = {hp: 0, dps: 0, xp: 0, gear: 0, n: 0});
  for (const o of [q, T]) {o.hp += b.hp * n; o.dps += (b.hit * 1.3 / b.cd + b.abilities.reduce((t, id) => t + ABILITIES[id].dmg / ABILITIES[id].cd * 1.3, 0)) * n; o.xp += b.xp * n; o.gear += b.loot.gear * n; o.n += n}
}
console.log('Role scaling, COUNTS-weighted mean multipliers (1.000 = the old flat formula)');
console.log('  zone   hp     dps    xp     gear/kill');
for (const z in Z) console.log(`  ${z}      ${(Z[z].hp / Z[z].n).toFixed(3)}  ${(Z[z].dps / Z[z].n).toFixed(3)}  ${(Z[z].xp / Z[z].n).toFixed(3)}  ${(Z[z].gear / Z[z].n).toFixed(3)}`);
console.log(`  all    ${(T.hp / T.n).toFixed(3)}  ${(T.dps / T.n).toFixed(3)}  ${(T.xp / T.n).toFixed(3)}  ${(T.gear / T.n).toFixed(3)}`);
ok(Math.abs(T.hp / T.n - 1) < .03, 'overall hp within 3% of the formula');
ok(Math.abs(T.dps / T.n - 1) < .03, 'overall dps within 3% of the formula');
ok(Math.abs(T.xp / T.n - 1) < .04, 'overall xp within 4%');
for (const z in Z) ok(Math.abs(Z[z].hp / Z[z].n - 1) < .08 && Math.abs(Z[z].dps / Z[z].n - 1) < .08, 'zone ' + z + ' within 8%');
for (const k in MOBS) ok(!!BESTIARY[k.split('@')[0]], 'stat block for ' + k);
for (const E of ELITES) ok(E.scale === ELITE_TEMPLATE.hp && E.hit === ELITE_TEMPLATE.dmg, 'elite ' + E.name + ' matches the template');

const {runBuilderChecks} = await import('./bestiarycheck-builder.mjs');
await runBuilderChecks(ok);
if (fail) {console.error(fail + ' failed'); process.exit(1)}
console.log('bestiarycheck passed');
