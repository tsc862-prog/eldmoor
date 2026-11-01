// Ability scores and skills: rolling at recruitment, modifiers, skill checks, and the small
// combat bonuses they feed. Owned by character-builder; data in data/abilities.js.
// A hero stores plain data only: a.abil {brawn..presence}, a.prof [skill ids], a.trade (optional).
// Heroes without scores (a dead stub, an unmigrated save) read as all-zero modifiers.
//
// Consumers: heroes.js (makeHero rolls, gainXp grows, maxHp/atkOf/strike use hpBonus/atkBonus/
// critBonus), dm.js (scene rolls), encounters.js (chest, ambush), narrator.js (scout, flee),
// brain.js (snapshot), ui/panels.js (Stats tab).
import {rnd,ri,pickA} from '../core/rng.js';
import {raceOf} from '../data/races.js';
import {
  ABILITIES,ABIL_IDS,CLASS_ABIL,SKILLS,SKILL_IDS,CLASS_SKILLS,TRADE_SKILL,TRAIT_SKILL,SOCIAL_LEAN,profBonus,GROWTH_LEVELS,SCORE_MAX,
} from '../data/abilities.js';

export const modOf=s=>Math.floor((s-10)/2);
const roll4=()=>{const d=[ri(1,6),ri(1,6),ri(1,6),ri(1,6)];return d[0]+d[1]+d[2]+d[3]-Math.min(...d)};

// Six rolls, best to the class primary, next to the secondary, the rest in random order; then
// the people's lean (+1). Class skills, trade skill. Safe to call on a plain snapshot object
// (the save migration does), where a.lvl may be above 1: growth is replayed up to that level.
export function rollScores(a){
  const rolls=Array.from({length:6},roll4).sort((x,y)=>y-x),ca=CLASS_ABIL[a.cls]||{primary:ABIL_IDS[0],secondary:ABIL_IDS[1]};
  const rest=ABIL_IDS.filter(k=>k!==ca.primary&&k!==ca.secondary).map(k=>[k,rnd()]).sort((x,y)=>x[1]-y[1]).map(x=>x[0]);
  const order=[ca.primary,ca.secondary,...rest],abil={};order.forEach((k,i)=>abil[k]=rolls[i]);
  const lean=raceOf(a).abil;if(lean&&abil[lean]!==undefined)abil[lean]=Math.min(18,abil[lean]+1);
  a.abil=abil;
  const prof=[...(CLASS_SKILLS[a.cls]||[])],t=a.trade&&TRADE_SKILL[a.trade];if(t&&!prof.includes(t))prof.push(t);
  a.prof=prof;
  for(const l of GROWTH_LEVELS)if(a.lvl>=l)growScores(a,l);
  return a}

// Level 5/10/15/20: +1 primary, and half the time +1 secondary.
export function growScores(a,lvl){
  if(!a.abil)return;const ca=CLASS_ABIL[a.cls];if(!ca)return;
  a.abil[ca.primary]=Math.min(SCORE_MAX,a.abil[ca.primary]+1);
  if(rnd()<.5)a.abil[ca.secondary]=Math.min(SCORE_MAX,a.abil[ca.secondary]+1)}

export const score=(a,k)=>a.abil&&a.abil[k]!==undefined?a.abil[k]:10;
export const mod=(a,k)=>modOf(score(a,k));

// ---- skills ----
// Parts: ability modifier, training (full proficiency, or half when untrained), trait nudges.
export function skillParts(a,skill){
  const S=SKILLS[skill],parts=[];if(!S)return parts;
  parts.push({k:ABILITIES[S.abil].name,v:mod(a,S.abil)});
  const pb=profBonus(a.lvl||1),trained=!!(a.prof&&a.prof.includes(skill));
  parts.push({k:trained?'trained':'untrained',v:trained?pb:Math.floor(pb/2)});
  for(const t of a.traits||[])if((TRAIT_SKILL[t]||[]).includes(skill))parts.push({k:t,v:1});
  return parts}
export const skillMod=(a,skill)=>skillParts(a,skill).reduce((s,p)=>s+p.v,0);
export const trained=(a,skill)=>!!(a.prof&&a.prof.includes(skill));

// d20 + skill modifier vs a DC. opt.nat applies the DM's rule (a 20 always passes, a 1 always fails).
export function check(a,skill,dc,opt){
  const d20=ri(1,20),parts=skillParts(a,skill),mod=parts.reduce((s,p)=>s+p.v,0),total=d20+mod,nat=d20===20?20:d20===1?1:null;
  const pass=opt&&opt.nat?(nat===20||(nat!==1&&total>=dc)):total>=dc;
  return {d20,mod,parts,total,dc,pass,nat,skill}}

// The best of `heroes` at a skill. `skills` is a skill id, an array of ids (each hero uses the
// better one), or a function hero -> id|array. Returns {hero, skill, mod, parts} or null.
export function bestFor(heroes,skills){
  let best=null;
  for(const h of heroes){
    const list=typeof skills==='function'?skills(h):skills,ids=Array.isArray(list)?list:[list];
    for(const s of ids){const m=skillMod(h,s);if(!best||m>best.mod)best={hero:h,skill:s,mod:m}}}
  if(best)best.parts=skillParts(best.hero,best.skill);return best}

// Which skill a hero argues with: temperament decides, else whichever they are better at.
export function socialSkill(a){
  const t=a.traits||[];
  for(const s of ['intimidation','persuasion'])if(SOCIAL_LEAN[s].some(x=>t.includes(x)))return s;
  return skillMod(a,'intimidation')>skillMod(a,'persuasion')?'intimidation':'persuasion'}

// ---- combat feeds (calibrated so the average hero equals the pre-ability formulas) ----
// Reference modifiers are the population means; see the PR for the measurement.
const HP_PER_LVL=1,HP_REF=.7,CRIT_PER=.008,CRIT_REF=1.5;
const atkRef=l=>2.6+.1*l; // mean primary modifier at level l (growth included)
export function hpBonus(a){return a.abil?Math.round(a.lvl*(mod(a,'grit')*HP_PER_LVL-HP_REF)):0}
export function atkBonus(a){if(!a.abil)return 0;const ca=CLASS_ABIL[a.cls];if(!ca)return 0;
  return (mod(a,ca.primary)-atkRef(a.lvl))*(.6+a.lvl*.1)}
export function critBonus(a){return a.abil?(mod(a,'reflex')-CRIT_REF)*CRIT_PER:0}

// Top two scores, "Reflex 15 (+2)".
export function topScores(a,n=2){return ABIL_IDS.slice().sort((x,y)=>score(a,y)-score(a,x)).slice(0,n).map(k=>ABILITIES[k].name+' '+score(a,k))}
export {SKILLS,SKILL_IDS,ABILITIES,ABIL_IDS};
