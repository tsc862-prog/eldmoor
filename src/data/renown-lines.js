// What townsfolk say when they pass on word (seed_rumour, #637) and how a name given to a hero is proclaimed (bestow, #638).
// Pure data, no logic. {text} is the rumour as the DM seeded it; {name} the hero, {title} the name given, {who} the proclaimer.
// The line is picked by a hash of ids (no RNG). Lore-keeper checks the wording.
export const RUMOUR_LINES={
  innkeeper:['Heard it over the taps last night: {text}','Between you and the barrel: {text}','Every table in the house had the same tale tonight: {text}'],
  captain:['Word at the gate: {text}','The watch has talked of little else: {text}','Carters in off the road all say the same: {text}'],
  bard:['There is a verse going round the square: {text}','I had it from a drover, so it is half true at least: {text}','Sung or spoken, it is the news: {text}'],
  road:['Word from the last town, friend: {text}','They talk of nothing else back there: {text}','Mind how you go. They are saying: {text}'],
};
// What a person (or the narrator) says when the DM puts the Crypt or a raid to a company (call_to, #826) and the DM gave no words.
// {crypt} the dungeon's name, {fac} the company's people. A company votes on the line; a solo answers it aloud.
export const CALL_LINES={
  crypt:{company:['{crypt} has taken another band. Will your company go down?','Nobody who went into {crypt} this season came back the same. Will you go down and end it?'],
    solo:['{crypt} has taken another band. Will you go down, alone if you must?','Someone ought to go down into {crypt}. Will it be you?']},
  raid:{company:['The {fac} mean to rise against Kragmaw. Will your company ride?','Kragmaw has slept long enough on what it took. Will you ride against it with the {fac}?'],
    solo:['The {fac} are riding on Kragmaw. Will you fall in with them?','There is room in the muster against Kragmaw for one more blade. Will you ride?']},
};
export const PROCLAIM_LINES={
  person:['Hear me! From this day they are known as {name} {title}.','Mark it, all of you: {name}, {title}. That is how this town will speak of them.','Raise a cup to {name} {title}, and remember the name.'],
  narrator:['Those who saw it have a name for {name} now: {title}.','By nightfall the name has spread: {name} {title}.'],
};
