// Professions: the skill model (issue #254, epic #238). DOM-free; table in src/data/professions.js.
// A hero's professions live on `a.profs` (not `a.prof`, which already holds trained ability skills, abilities.js), an array of {id, skill} (at most MAX_PROF, skill 1..SKILL_MAX).
// The field is optional: heroes made before this existed, and every hero until #257 wires learning,
// simply have none, and every function here reads that as []. Nothing here draws from the RNG or is
// called by the existing sim, so seeded worlds are unchanged.
// API (later children build on it):
//   professionsOf(a)        -> [{id, name, kind, skill}] in the order learned ([] if none)
//   skillOf(a, id)          -> whole skill 0..100 (0 = does not have it)
//   hasProfession(a, id)    -> boolean
//   canLearn(a, id)         -> {ok:true} | {ok:false, why}
//   learn(a, id)            -> {ok:true, skill:1} | {ok:false, why}   (refuses unknown, duplicate, third)
//   gainSkill(a, id, amount)-> {ok:true, skill, gained, up} | {ok:false, why}; capped at SKILL_MAX, amount > 0 only
//   skillBand(skill)        -> 0..4 (1-24, 25-49, 50-74, 75-99, 100 as 4) for recipe/node bands
import {PROF, MAX_PROF, SKILL_MAX} from '../data/professions.js';

const list = a => (a && Array.isArray(a.profs)) ? a.profs : [];
const find = (a, id) => list(a).find(p => p.id === id);
const round = x => Math.round(x * 1000) / 1000; // stored skill keeps three decimals, so repeated small gains add up exactly

export const professionsOf = a => list(a).map(p => ({id: p.id, name: PROF[p.id] ? PROF[p.id].name : p.id, kind: PROF[p.id] ? PROF[p.id].kind : '', skill: Math.floor(p.skill)}));
export const skillOf = (a, id) => { const p = find(a, id); return p ? Math.floor(p.skill) : 0 };
export const hasProfession = (a, id) => !!find(a, id);
export const skillBand = skill => skill >= SKILL_MAX ? 4 : Math.min(3, Math.floor(Math.max(1, skill) / 25));

export function canLearn(a, id) {
  if (!a || a.kind !== 'hero') return {ok: false, why: 'only heroes learn professions'};
  if (!PROF[id]) return {ok: false, why: 'unknown profession: ' + id};
  if (find(a, id)) return {ok: false, why: 'already knows ' + PROF[id].name};
  if (list(a).length >= MAX_PROF) return {ok: false, why: 'already holds ' + MAX_PROF + ' professions'};
  return {ok: true};
}
export function learn(a, id) {
  const c = canLearn(a, id); if (!c.ok) return c;
  if (!Array.isArray(a.profs)) a.profs = [];
  a.profs.push({id, skill: 1});
  return {ok: true, skill: 1};
}
// amount is in skill points (fractions allowed); the result is a pure function of the amount.
export function gainSkill(a, id, amount) {
  const p = find(a, id);
  if (!p) return {ok: false, why: 'does not know ' + (PROF[id] ? PROF[id].name : id)};
  if (!(amount > 0) || !Number.isFinite(amount)) return {ok: false, why: 'amount must be above 0'};
  const was = p.skill;
  p.skill = round(Math.min(SKILL_MAX, p.skill + amount));
  const skill = Math.floor(p.skill);
  return {ok: true, skill, gained: round(p.skill - was), up: skill > Math.floor(was)};
}

// Restore hook (save.js): keep a loaded a.profs legal. Absent stays absent (reads as []); a bad shape becomes [],
// unknown or duplicate ids drop, skill is clamped to 1..SKILL_MAX, and at most MAX_PROF are kept.
export function normalizeProfs(a) {
  if (!Array.isArray(a.profs)) { a.profs = []; return a }
  const seen = new Set(), out = [];
  for (const p of a.profs) {
    if (!p || !PROF[p.id] || seen.has(p.id) || out.length >= MAX_PROF) continue;
    seen.add(p.id); out.push({id: p.id, skill: Math.min(SKILL_MAX, Math.max(1, Number(p.skill) || 1))});
  }
  a.profs = out; return a;
}
