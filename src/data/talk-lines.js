// NPC conversations (issue #170): what the scripted DM says for a world character when a Fellowship
// member talks to them and the DM agent is absent or silent. Pure data. Lines by brain-builder for
// lore-keeper's review; every line is original to Eldmoor. Placeholders: {target} the member spoken
// to, {name} the speaker, {town} the speaker's town, {lead} a rumour's text, {stock} what they sell.
//
// ROLE_TALK[role]: {want: what this person wants (shown to the DM), offer: the follow-up the scripted DM
// picks on the first exchange (trade, rumour, job, blessing, or none)}. Roles not listed use DEFAULT_TALK.
export const ROLE_TALK={
  innkeeper:{want:'paying guests, a quiet night and news worth repeating',offer:'rumour'},
  smith:{want:'good iron, honest work and customers who come back alive',offer:'trade'},
  quartermaster:{want:'fair weights, a full table and coin that rings true',offer:'trade'},
  priest:{want:'the living kept living and the dead laid properly to rest',offer:'blessing'},
  bard:{want:'a song nobody has sung yet',offer:'rumour'},
  captain:{want:'a quiet gate and the roads kept clear',offer:'job'},
  peddler:{want:'a sale before the next town',offer:'trade'},
  hermit:{want:'to be left in peace, and to be asked the right question',offer:'blessing'},
  drover:{want:'the herd home whole and the road free of teeth',offer:'rumour'},
  sellsword:{want:'paid work and a captain who pays on time',offer:'job'},
  minstrel:{want:'an audience and a better ending for an old tune',offer:'rumour'},
  stranger:{want:'something they will not name yet',offer:'rumour'},
};
export const DEFAULT_TALK={want:'to get through the day',offer:'rumour'};

// Default job templates (data/adventures.js) a role posts when the follow-up is a job.
export const ROLE_JOB={innkeeper:'rescue',smith:'relic',quartermaster:'deliver',priest:'investigate',bard:'relic',captain:'clear',
  peddler:'escort',hermit:'investigate',drover:'rescue',sellsword:'hunt',minstrel:'relic',stranger:'negotiate'};

// What a role sells when it opens its stock: 'gear' (a piece for the member's level, as the town smiths sell)
// and/or consumables by name (data/items.js USES). Every trader also buys trade goods and spare gear.
export const ROLE_STOCK={
  smith:['gear'],
  quartermaster:['Redroot Draught','Linen Bandage','Trail Ration','Pitch Torch','Bogroot Antidote',"Wayfarer's Pack"],
  innkeeper:['Trail Ration','Pitch Torch','Redroot Draught'],
  priest:['Redroot Draught','Marrowmend Tonic','Linen Bandage','Bogroot Antidote','Scroll of Hearthward','Scroll of the Steadfast Hour'],
  peddler:['Redroot Draught','Linen Bandage','Trail Ration','Pitch Torch','Bogroot Antidote','Scroll of Hearthward'],
  hermit:['Linen Bandage','Bogroot Antidote','Marrowmend Tonic'],
  drover:['Trail Ration','Pitch Torch'],
  sellsword:['gear'],
};
export const DEFAULT_STOCK=['Redroot Draught','Linen Bandage','Trail Ration'];

// Lines the scripted DM speaks for the person, by situation.
export const TALK_LINES={
  // the first answer, before the follow-up
  open:{
    friendly:['{target}! Good to see a face I trust. What do you need?','Ah, {target}. Sit a moment; you look like you have walked far.','For you, {target}, I have time. Ask.'],
    neutral:['Yes? Speak plainly, {target}; the day is short.','You have my ear, {target}, for now.','Well met. What brings you to me?'],
    hostile:['You have a nerve, {target}, coming to me after all that.','Say your piece quickly and go.','I know your kind. Make it short.']},
  // later answers
  reply:{
    friendly:['I will remember that, {target}.','That is fair. More than fair.','You have a good head on you. Keep it on your shoulders.'],
    neutral:['Hm. Perhaps.','I have heard stranger things this week.','If you say so.'],
    hostile:['Words are cheap. Yours cheaper.','I am not listening any more.','Enough.']},
  // the last answer of a conversation
  bye:['That is all I have for you. Go carefully.','Off you go, then. Mind the road.','We are done for today, {target}.'],
  // the follow-ups
  trade:['Have a look at what I carry: {stock}. And I will take what you found out there, at a fair weight.','Coin for goods, goods for coin. I have {stock}.'],
  rumour:['A word you did not hear from me: {lead}','Here is something worth knowing. {lead}','People talk, and I listen. {lead}'],
  rumourNone:['Nothing worth the telling, I am afraid. The roads have been quiet.','I hear only the usual grumbling. Keep your eyes open all the same.'],
  job:['There is work, if you want it. I have put it on the board at {town} in your name.','I need someone with a steady hand. Ask at the {town} gate: the job is yours if you take it.'],
  blessing:['Kneel a moment. There: go with a steadier arm.','Hold still. May your first blow land true.'],
  threat:['Walk away, {target}, while you still can.','One more word and you will regret it.'],
  leave:['I have nothing more to say to you.','We are finished here.'],
  snub:['{name} turns away and will not speak with you today.'],
};
