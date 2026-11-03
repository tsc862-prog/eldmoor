// Scripted heroes answering an invite to ride with a company (epic #402, issue #442). Pure data, no logic:
// sim/offers.js picks a line by a hash of the two hero ids and the game day (never the sim RNG).
// accept: the hero joins. decline: by the reason the hero has (loner, level gap, its own party or job, a grudge
// against someone in the company, or simply not today).
export const COMPANION_LINES={
  accept:[
    'Lead on, then. I could use the company.',
    'Aye. Two blades are better than one.',
    'I was hoping someone would ask.',
    'Fair enough. I ride with you.',
    'Lead and I will follow, while the road agrees with us.',
    'Done. Mind you keep up.',
  ],
  decline:{
    loner:['I walk alone. Always have.','No. I travel faster by myself.','Company slows me down. Good luck to you.'],
    gap:['You and I would not last a day together on the same road.','Our roads are too far apart, friend.','Find someone nearer your own measure.'],
    party:['I already ride with friends.','My party would not forgive me.','I have promised my blade elsewhere.'],
    job:['I have work of my own to finish first.','Not while my own job is undone.'],
    grudge:['Not with them riding beside you.','I know who rides with you. No.'],
    no:['Not today.','Thank you, but no.','Ask me another time.','I think not.','Another day, perhaps.'],
  },
};
