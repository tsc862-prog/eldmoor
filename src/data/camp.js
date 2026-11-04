// Campfire talk for the Fellowship's camps (issue #64). Pure table, no logic.
// Placeholders: {other} a companion, {zone} the region the camp is in, {town} the speaker's home town.
// One short line each (max ~100 characters); sim/camp.js picks by topic and a hash of the game clock.
export const TOPICS=['story','song','worry','hope','memory','quarrel'];
export const CAMP_LINES={
  story:[
    'My grandmother swore the {zone} fires were lit by the dead. I never lit one alone.',
    'Back in {town}, they say a lantern left lit all night keeps the hungry things honest.',
    'Did I ever tell you about the ferryman who counted passengers and always came up one short?',
    'An old drover once told me the stars over {zone} move when you stop watching.',
    'They tell it that the first fire in Eldmoor was a mistake and the second was a promise.',
    'I heard a pit-fighter lost an ear on a wager and won it back on a sneeze.'],
  song:[
    'La, la, the lantern road runs long, and the kettle sings the other half.',
    '"Seven bells and a broken oar, who is waiting at the farther shore?"',
    '"Keep the fire, keep the faith, keep the dark a spear-length off."',
    '"Oh Thornvale rain, oh Thornvale rain, wash the boots and the blood the same."',
    '"We were nine at the river crossing, and the river did not count."',
    'Hush. That is the one my mother hummed over the bread.'],
  worry:[
    '{other} looks done in. Take the blanket, I will not need it.',
    'Whatever walks {zone} at night, I would like it to walk somewhere else.',
    'We are a long way from {town}. Let us not make it a longer way back.',
    'One more bad fight and I am not sure which of us pays for it.',
    'Every sound out there is a wolf until it is a branch.'],
  hope:[
    'Another few days like this and the road starts to feel like ours.',
    'When this is over I want a bed and a roof and no one watching me sleep.',
    'We are better than we were a month ago. I would not have said it then.',
    'Someone will sing about this one day. Let them get the names right.',
    'Dawn. Hot food. A good hit on something large. That is the whole plan.'],
  memory:[
    'I still think about the first night in {town}. Cold, wet and everything ahead of us.',
    'Do you remember the first thing you ever killed? I remember apologising.',
    '{other}, you saved my skin back there. I have not forgotten it.',
    'It is quiet now. It was not quiet at the last place we camped.'],
  quarrel:[
    '{other}, you snore like a collapsing barn and you know it.',
    'Who ate the last of the road bread? Do not all speak at once.',
    'I said left at the fork. I said left. Everyone heard me say left.',
    'Your plan got us here, {other}. Forgive me if I do not sing about it.',
    'Keep your boots out of my side of the fire.']};
export const QUARREL_REPLY=['Fine. Fine. Go to sleep.','Say that again in daylight.','Enough. We are all tired.','Aye, aye. I heard you the first time.'];
export const NTH=['first','second','third','fourth','fifth'];
// A scripted companion of an agent company (issue #764): what a camp line needs to have happened today, by 'topic:row'
// (rows not listed need nothing). fight: the company fought today; camp: it camped before this one. Rows stay in place.
export const CAMP_NEEDS={'memory:2':'fight','memory:3':'camp','worry:3':'fight','quarrel:3':'fight'};
// A scripted companion answering a hero who spoke to it (#764), when the DM's voice is slow or away. {other} the hero.
export const COMP_REPLY=[
  'Aye, {other}. I hear you.',
  'Hm. Let me think on that a while.',
  'If you say so. I will keep my eyes open.',
  'Ask me again when we have eaten.',
  'I have seen worse roads than this one.',
  'You lead, {other}. I follow.',
  'Fair words. Let us see what the day makes of them.',
  'I was paid to keep up, not to argue. But I am listening.',
  'Not now. Something out there is too quiet.',
  'True enough. I would not say it twice, though.',
  'Well. That is one way to look at it.',
  'Keep talking, {other}. It passes the miles.'];
