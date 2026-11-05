// What townsfolk say when they pass on word (seed_rumour, #637) and how a name given to a hero is proclaimed (bestow, #638).
// Pure data, no logic. {text} is the rumour as the DM seeded it; {name} the hero, {title} the name given, {who} the proclaimer.
// The line is picked by a hash of ids (no RNG). Lore-keeper checks the wording.
export const RUMOUR_LINES={
  innkeeper:['Heard it over the taps last night: {text}','Between you and the barrel: {text}','Every table in the house had the same tale tonight: {text}'],
  captain:['Word at the gate: {text}','The watch has talked of little else: {text}','Carters in off the road all say the same: {text}'],
  bard:['There is a verse going round the square: {text}','I had it from a drover, so it is half true at least: {text}','Sung or spoken, it is the news: {text}'],
  road:['Word from the last town, friend: {text}','They talk of nothing else back there: {text}','Mind how you go. They are saying: {text}'],
};
export const PROCLAIM_LINES={
  person:['Hear me! From this day they are known as {name} {title}.','Mark it, all of you: {name}, {title}. That is how this town will speak of them.','Raise a cup to {name} {title}, and remember the name.'],
  narrator:['Those who saw it have a name for {name} now: {title}.','By nightfall the name has spread: {name} {title}.'],
};
