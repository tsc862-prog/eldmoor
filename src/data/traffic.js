// What walks the roads between towns (#796): pure tables, no logic. sim/traffic.js reads them.
// Append-only during a feature. Names and words are canon in docs/LORE.md, "Road traffic".
//
// CARGO: what a cart carries. `word` is how it reads ("a salt cart"); `good` is a row of GOODS, when the load is something the
// auction house trades: a cart of it that arrives adds to that good's supply. A load with no good is only words.
export const CARGO=[
  {word:'salt'},
  {word:'grain'},
  {word:'ale'},
  {word:'timber'},
  {word:'wool',good:'Hoar Wool'},
  {word:'hide',good:'Thick Hide'},
  {word:'pelt',good:'Wolf Pelt'},
  {word:'silk',good:'Silk Bundle'},
  {word:'moss',good:'Fen Moss'},
];
// TRAVELLERS: who walks on foot. They go where carts go, and to the outposts and landmarks at the ends of the roads.
export const TRAVELLERS=[
  {word:'pedlar'},
  {word:'pilgrim'},
  {word:'tinker'},
  {word:'drover'},
  {word:'road courier'},
  {word:'wandering minstrel'},
];
// How the people of the road read to a hero.
export const ROAD_WORDS={
  cart:'{a} {word} cart',
  heading:'heading for {to}',
  gate:'a guard of {town} walking the gate road',
  bridge:'a watchman of {town} pacing the bridge',
  beset:'at a standstill, set upon by {foe}',
};
