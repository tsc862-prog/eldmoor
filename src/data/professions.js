// The profession table (issue #254, epic #238). Pure data, no logic; the skill model is src/sim/professions.js.
// A hero holds at most MAX_PROF professions, each with a skill from 1 to SKILL_MAX that rises with use.
// Gathering professions take materials from the world; crafting professions turn them into goods.
// Append-only: later children add recipes (#256) and nodes (#255) keyed by these ids; never rename or reorder.
export const MAX_PROF = 2, SKILL_MAX = 100;
export const PROF = {
  herbalism:    {id:'herbalism',    name:'Herbalism',    kind:'gather', blurb:'Picks herbs, moss and flowers from the wild places.'},
  mining:       {id:'mining',       name:'Mining',       kind:'gather', blurb:'Breaks ore and stone out of veins and rock faces.'},
  skinning:     {id:'skinning',     name:'Skinning',     kind:'gather', blurb:'Takes hide, sinew and bone from what the hero has felled.'},
  fishing:      {id:'fishing',      name:'Fishing',      kind:'gather', blurb:'Draws fish from river, mere and sea with line and patience.'},
  alchemy:      {id:'alchemy',      name:'Alchemy',      kind:'craft',  blurb:'Brews potions, cures and tinctures.'},
  smithing:     {id:'smithing',     name:'Smithing',     kind:'craft',  blurb:'Forges and mends weapons and armor.'},
  leatherworking:{id:'leatherworking',name:'Leatherworking',kind:'craft',blurb:'Cures hide into armor, straps and packs.'},
  cooking:      {id:'cooking',      name:'Cooking',      kind:'craft',  blurb:'Makes camp meals that hearten the company.'},
  scribing:     {id:'scribing',     name:'Scribing',     kind:'craft',  blurb:'Writes scrolls and draws maps.'},
};
export const PROF_IDS = Object.keys(PROF);
