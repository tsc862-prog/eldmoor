// Per-world check helpers (epic #940 slice B). A world is chosen once, at import (ELDMOOR_WORLD), so a check that must
// cover every map runs itself again in a child process per world. Everything loops over WORLDS in src/world/spec.js:
// a new world in that table is covered by every check that uses these, with no edit to the checks.
//   WORLD_IDS            every world id, the base world first
//   BASE_WORLD           'eldmoor', the world a check runs in itself
//   OTHER_WORLDS         the rest, in table order
//   inWorldChild(name)   true inside a child started by runWorlds(name)
//   runWorld(script, world, {args, env, capture})  one child run of a script in one world -> spawnSync result
//   runWorlds(name, {script, worlds, args, env, capture, shallow})  child runs over the other worlds; prints the time of each;
//        returns the number that failed. `shallow` = {world id: [args]} gives those worlds a lighter pass (the arguments replace args).
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {WORLDS} from '../src/world/spec.js';

export const BASE_WORLD = 'eldmoor';
export const WORLD_IDS = [BASE_WORLD, ...Object.keys(WORLDS).filter(id => id !== BASE_WORLD)];
export const OTHER_WORLDS = WORLD_IDS.filter(id => id !== BASE_WORLD);
const CHILD = 'WORLDS_CHILD';
export const inWorldChild = name => process.env[CHILD] === name;

export function runWorld(script, world, {args = [], env = {}, capture = false} = {}) {
  const file = script.startsWith('file:') ? fileURLToPath(script) : script;
  return spawnSync(process.execPath, [file, ...args], {env: {...process.env, ...env, ELDMOOR_WORLD: world}, stdio: capture ? undefined : 'inherit', encoding: capture ? 'utf8' : undefined, maxBuffer: 1 << 28});
}

export function runWorlds(name, {script = process.argv[1], worlds = OTHER_WORLDS, args = [], env = {}, shallow = {}} = {}) {
  let fails = 0;
  for (const w of worlds) {
    const t = Date.now(), a = shallow[w] || args;
    console.log(`\n-- ${name}: ${w}${shallow[w] ? ' (shallow)' : ''}`);
    const r = runWorld(script, w, {args: a, env: {...env, [CHILD]: name}});
    console.log(`-- ${name}: ${w} ${r.status ? 'FAILED' : 'ok'} in ${((Date.now() - t) / 1000).toFixed(1)}s`);
    if (r.status) fails++;
  }
  return fails;
}
