// Scale check for the spatial index (issue #33): ten times the monsters (COUNTS x10, about
// 1000 base spawns plus the ecology's extras) and 200 heroes spread over levels 1-12, stepped
// for 60 game minutes. Prints wall time, deaths and the index counters, once with the grid
// and once with every query falling back to a brute-force scan (USE_INDEX off), so the two
// can be compared. Target: the indexed run finishes in under 3 minutes of wall time.
// Usage: node scripts/scalecheck.mjs [minutes] [heroes] [mobMul]
//        SCALE_MODE=index|brute node scripts/scalecheck.mjs ...   (one mode only)
import {execFileSync} from 'node:child_process';

const minutes = Number(process.argv[2] || 60), heroes = Number(process.argv[3] || 200), mobMul = Number(process.argv[4] || 10);
const mode = process.env.SCALE_MODE;

if (!mode) {
  for (const m of ['index', 'brute']) {
    process.stdout.write(execFileSync(process.execPath, [process.argv[1], String(minutes), String(heroes), String(mobMul)], {env: {...process.env, SCALE_MODE: m}, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']}));
  }
} else {
  // COUNTS must be scaled before sim/mobs.js is imported: it derives per-zone targets at load time.
  const {COUNTS} = await import('../src/data/mobs.js');
  for (const k in COUNTS) COUNTS[k] = Math.round(COUNTS[k] * mobMul);
  const {init, step, S, spatialStats, maxHp} = await import('../src/sim/index.js');
  const {makeHero} = await import('../src/sim/heroes.js');
  const {setIndex} = await import('../src/sim/spatial.js');
  const {CLSN} = await import('../src/data/classes.js');
  const {rnd, ri, pickA} = await import('../src/core/rng.js');
  setIndex(mode === 'index');
  init();
  while (S.agents.length < heroes) {
    const f = ri(0, 1), a = makeHero(f, pickA(CLSN), null, rnd() * 3);
    a.lvl = ri(1, 12); a.hp = maxHp(a);
  }
  const nMobs = S.mobs.length, t0 = Date.now(), frames = minutes * 60 * 60;
  for (let i = 0; i < frames; i++) step(1 / 60);
  const wall = (Date.now() - t0) / 1000, fallen = S.facStats[0].fallen + S.facStats[1].fallen;
  console.log(`[${mode.padEnd(5)}] ${heroes} heroes, ${nMobs} mobs (${S.mobs.length} at end), ${minutes} game min: wall ${wall.toFixed(1)} s | ${(frames / wall).toFixed(0)} steps/s | fallen ${fallen} | boss kills ${S.facStats[0].bosses + S.facStats[1].bosses}`);
  console.log(`        index: ${spatialStats.cells} cells, ${spatialStats.heroes} heroes + ${spatialStats.mobs} mobs indexed at the last step, ${(spatialStats.queries / frames).toFixed(1)} queries/step, ${(spatialStats.candidates / Math.max(1, spatialStats.queries)).toFixed(1)} candidates/query`);
}
