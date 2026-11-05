// The recipe table (issue #256, epic #238; also the smith of #13). Pure data, no logic. ONE table for all five
// crafting professions; #13 adds only prices and the gold sink on top, never a second table. Append-only.
// A recipe: {id, prof (data/professions.js, kind 'craft'), band (the skill band needed, professions.js skillBand 0-4),
// inputs [{id, n}] (a GOODS or MATERIALS id), gold (the fee, a sink), out {kind:'use'|'gear', id, n}}.
// out.kind 'use' resolves in USES (consumables, camp meals, scrolls, maps), 'gear' in CRAFT_GEAR (items.js).
// Materials come from creature drops (bestiary MAT_DROPS, trade goods) and gathering nodes by kind
// (herb, ore, hide, fish: MATERIALS[id].kind), never by position. Crafting runs in sim/craft.js (#258).
const R=(id,prof,band,inputs,gold,out)=>({id,prof,band,inputs:inputs.map(([id,n])=>({id,n})),gold,out:{kind:out[0],id:out[1],n:out[2]||1}});
export const RECIPES=[
  // Alchemy: potions
  R('draught-redroot',   'alchemy',0,[['Redroot Leaf',2]],1,['use','Redroot Draught']),
  R('tonic-marrowmend',  'alchemy',2,[['Hearthbloom',1],['Fen Moss',1]],4,['use','Marrowmend Tonic']),
  R('elixir-rimeblood',  'alchemy',3,[['Rimebloom',1],['Hearthbloom',1]],8,['use','Rimeblood Elixir']),
  // Smithing: weapons and armour (the smith of #13)
  R('forge-tinforged',   'smithing',0,[['Tin Ore',3],['Wolf Sinew',1]],30,['gear','Tinforged Weapon']),
  R('forge-bogiron',     'smithing',2,[['Bogiron Ore',3],['Thick Hide',1]],60,['gear','Bogiron Handguard']),
  R('forge-ashsteel',    'smithing',3,[['Cinderite',3],['Icevein Ore',1],['Ember Core',2]],140,['gear','Ashsteel Cuirass']),
  // Leatherworking: armour and packs
  R('cure-wolfhide',     'leatherworking',0,[['Wolf Pelt',2],['Wolf Sinew',2]],20,['gear','Wolfhide Cowl']),
  R('stitch-pack',       'leatherworking',2,[['Thick Hide',2],['Mudback Bristle',2]],12,['use',"Wayfarer's Pack"]),
  R('cure-hoarfrost',    'leatherworking',3,[['Rime Pelt',3],['Hoar Wool',2],['Shaghorn Horn',1]],150,['gear','Hoarfrost Greatcoat']),
  // Cooking: camp meals with a short buff
  R('meal-perch',        'cooking',0,[['River Perch',2]],1,['use','Spit-Roast Perch']),
  R('meal-eel-stew',     'cooking',2,[['Mere Eel',1],['Fen Moss',1]],1,['use','Fenmire Eel Stew']),
  R('meal-chowder',      'cooking',3,[['Tarn Whitefish',1],['Redroot Leaf',1]],2,['use','Tarn Whitefish Chowder']),
  // Scribing: scrolls and maps
  R('scroll-hearthward', 'scribing',0,[['Rushpulp',2],['Redroot Leaf',1]],6,['use','Scroll of Hearthward']),
  R('scroll-steadfast',  'scribing',2,[['Rushpulp',1],['Venom Sac',1]],2,['use','Scroll of the Steadfast Hour']),
  R('chart-hoarfell',    'scribing',3,[['Rushpulp',3],['Venom Sac',1]],8,['use','Hoarfell Survey Chart']),
  // Bands 1 and 4 (issue #718): the gaps at skill 25-49 and at 100. Appended, so the rows above keep their place.
  R('salve-fenwater',    'alchemy',1,[['Redroot Leaf',2],['Fen Moss',1]],2,['use','Fenwater Salve']),
  R('philtre-wightbone', 'alchemy',4,[['Rimebloom',1],['Wight Marrow',1],['Hearthbloom',1]],10,['use','Wightbone Philtre']),
  R('forge-mireforged',  'smithing',1,[['Tin Ore',2],['Bogiron Ore',2]],40,['gear','Mireforged Greaves']),
  R('forge-rimesteel',   'smithing',4,[['Icevein Ore',3],['Cinder Scale',2],['Ember Core',2]],150,['gear','Rimesteel Greatblade']),
  R('cure-boarhide',     'leatherworking',1,[['Wolf Pelt',2],['Mudback Bristle',2]],35,['gear','Boarhide Buckler']),
  R('cure-shagmane',     'leatherworking',4,[['Hoar Wool',3],['Shaghorn Horn',2],['Cinder Scale',1]],140,['gear','Shagmane Hood']),
  R('meal-bloom-pie',    'cooking',1,[['River Perch',2],['Hearthbloom',1]],1,['use','Hearthbloom Fish Pie']),
  R('meal-hunters-feast','cooking',4,[['Tarn Whitefish',2],['Hearthbloom',1],['Mere Eel',1]],4,['use',"Tarn Hunter's Feast"]),
  R('scroll-brief-ward', 'scribing',1,[['Rushpulp',2],['Fen Moss',1]],1,['use','Scroll of the Brief Ward']),
  R('scroll-unbroken',   'scribing',4,[['Rushpulp',3],['Grave Dust',1],['Venom Sac',1]],6,['use','Scroll of the Unbroken Line'])];
export const RECIPE_BY_ID=Object.fromEntries(RECIPES.map(r=>[r.id,r]));
export const recipesOf=prof=>RECIPES.filter(r=>r.prof===prof);
// Recipes a crafter of this skill band can make (band is skillBand(skill)).
export const recipesFor=(prof,band)=>RECIPES.filter(r=>r.prof===prof&&r.band<=band);
