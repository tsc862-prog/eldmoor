// Hero chatter: what heroes say, by trigger and faction. Owned by ai-designer (triggers)
// and lore-keeper (voice). Every line is original to Eldmoor.
// Voice: Concord [0] is formal and dry; Warband [1] is blunt and boastful.
// Placeholders: {name} speaker, {target} other hero, {zone}, {mob}, {item}, {level}.
// BARKS[trigger] = [concordLines, warbandLines]. CLASS_BARKS[trigger][fac][cls] adds class flavour.
// The trigger list is documented in docs/LORE.md under "Voices"; sim/chat.js picks and cools down lines.
export const BARKS={
  // Quest turned in at the quest giver.
  quest:[
    ['Task concluded. The ledger balances.','Another writ fulfilled. Highgate will hardly notice.','Done, and done properly. Next.','I shall note it in the record. Modestly.','The {mob} are handled. For now.'],
    ['Done. Pay me.','Dead things for coin. Fair trade.','Told you I would finish it. I finish things.','That was the easy part. Give me a harder one.','Fewer {mob} now. Much fewer, by my count.']],
  // Leaving the city gate for the hunting grounds.
  depart:[
    ['To {zone}, then. Mind the road.','Off to {zone}. Back for supper, I expect.','Gate behind, {zone} ahead. Orderly.','One more trip to {zone}. One more entry.','Let it be noted that I left on time.'],
    ['{zone}! Something there owes me a fight.','Out the gate. Blood before breakfast.','Grimhold is too quiet. {zone} will fix that.','Walking to {zone}. Running is for the hunted.','Anyone who sees me coming had better be quick.']],
  // Engaging a monster above your own level, or a named elite.
  spot:[
    ['A level {level} {mob}. This is ill-advised.','A {mob}, above my station. Proceeding.','Caution noted. Caution set aside.','A {mob}, and a large one. Steady.','Should this go poorly, say I was thorough.'],
    ['Big {mob}. Good. Little ones bore me.','Level {level}? Numbers. Come here.','That one has teeth. So do I.','A {mob} worth the walk at last.','Hit it until it stops. Simple.']],
  // Breaking off a fight at low health.
  flee:[
    ['A tactical withdrawal. Entirely planned.','Retreating. The report will say "regrouping".','Discretion. Not fear. Discretion.','Live to be dull another day.','I decline to continue this engagement.'],
    ['This is not running. This is leaving fast.','Not yet, beast. Not by you.','I will be back with a bigger axe.','Ha! You wish I were dead. Keep wishing.','The blood is mine and I am keeping it.']],
  // Reaching a milestone level (every 5, or 15+).
  levelup:[
    ['Level {level}. Progress, duly recorded.','{level} now. The gear has yet to catch up.','Another level. The road stays long.','Level {level}. Mother would be quietly pleased.','Stronger. Marginally. It adds up.'],
    ['Level {level}! Hear that, Grimhold?','{level}. Stronger than I was this morning.','Level {level}. The beasts should start worrying.','Still breathing, still climbing. {level}!','Another notch. {level}, and not done.']],
  // Looting an epic item.
  epic:[
    ['{item}. Well. That is unexpected.','{item}. A fine piece. It will be cared for.','{item}. I shall try not to gloat. I shall fail.','{item}. Remarkable. Someone will want it back.','Logged: {item}. Value: do not ask.'],
    ['{item}! Mine! Look at it!','Hah! {item}. Try and take it.','Shiny. Deadly. {item}. Good day.','{item}. Even the spirits envy me now.','{item}. Every scar was worth it.']],
  // A duel begins against a hero of the other faction.
  duel:[
    ['{target}. Shall we settle this properly?','Steel, then. I had hoped for conversation.','Very well, {target}. Let us be quick about it.','This will be brief, {target}. My apologies in advance.','Blades out. Manners kept.'],
    ['{target}! Your head or mine. Mine stays.','Come on, {target}! Show me something!','{target} of the Concord. Soft. Let us see.','Finally! Someone worth bleeding!','{target}, you should have stayed home.']],
  // Rushing to a guildmate's duel.
  assist:[
    ['Hold on, {target}. Reinforcements, such as they are.','{target} is engaged. I am not one to watch.','Coming, {target}. Do try to still be alive.','Two on one is poor form. Fortunately I am on the two side.','For the guild. Mostly for {target}.'],
    ['{target}! Save some for me!','Nobody fights my guildmate alone. Nobody.','Hold them, {target}! I bring the hurt!','Two axes now, Concord. Still want this?','Hang on, {target}. I was bored anyway.']],
  // A guildmate or party member dies within sight.
  mourn:[
    ['{target}... rest now. We will remember.','No. Not {target}. Not like this.','A candle for {target} tonight. Then work.','{target} is gone. The record will say they were brave.','We carry on. {target} would insist on it.'],
    ['{target}! No! Spirits take you kindly.','{target} died fighting. Good death. Still hurts.','Someone pays for {target}. Someone pays.','Drink for {target} tonight. Blood for them tomorrow.','{target}, you fool. You brave fool.']],
  // Killing a hero of the other faction.
  kill:[
    ['{target} will trouble no one further.','Regrettable. Necessary. {target} is dealt with.','Rest, {target}. You fought adequately.','One fewer of the Warband. The ledger closes.','I take no joy in it. Only the honor.'],
    ['{target} is dirt! Who is next?','Ha! {target} squealed at the end.','One more Concord corpse. The crows feast.','Too slow, {target}. Far too slow.','{target} wanted a duel. {target} got a grave.']],
  // A party forms at the gate ({target} is the leader).
  party:[
    ['Company, then. {target} leads; I observe.','A party. Mind your footing, all of you.','To {zone}, together. Watch each other.','Good. Fewer deaths when someone counts.','Stay close. I dislike writing letters.'],
    ['Pack hunt! {zone} will not know what hit it.','We go together. We come back with more.','Hold the line and I will hold yours. Mostly.','Follow {target}. Argue later.','Three axes beat one. Even I can count that far.']],
  // Standing about in the city.
  idle:[
    ['The prices here are a quiet scandal.','Nothing to report. That is a report.','Highgate stone. Steady under the boots.','One day I shall sit down. Not this one.','Another market day. Another modest coin.'],
    ['Grimhold smells of smoke and victory.','Too much standing. Not enough hitting.','Sharpening. Always sharpening.','Who sells ale here? Nobody? Disgraceful.','Rest is for the dead. I rest a little.']],
  // Party small talk after a while in the field.
  banter:[
    ['If we survive this, lunch is on me.','Is anyone counting? I am counting.','Fine weather for killing things. Or dying.','Try to keep up. I say that kindly.','Everyone still breathing? Splendid.'],
    ['First to a hundred kills buys the ale.','Stop stepping on my shadow.','Keep up or get left! Joking. Mostly.','My axe is hungrier than I am.','Who told you that was a fighting stance?']],
};

// Optional class flavour, mixed into the pool for that trigger and faction.
export const CLASS_BARKS={
  spot:[{Mage:['Distance is my friend. Let us keep it so.'],Rogue:['It cannot hit what it cannot find.'],Hunter:['Range, then patience, then the shot.'],Skald:['A level {level} {mob}. I have a verse for exactly this.','Rally to the chorus. Here it comes.'],Wildspeaker:['The ground does not like that {mob}. I shall ask it to object.','Root and bramble, hold it for me.']},
        {Mage:['Burn first. Think second.'],Rogue:['From behind, quiet. That is how.'],Warrior:['Shield up. Teeth out.'],Skald:['Big {mob}! Good. A big foe wants a big song.','Sing it down, sing it down!'],Wildspeaker:['Green words, wake. This one needs holding.','The earth is on my side. It always is.']}],
  flee:[{Priest:['The healer cannot heal from the grave.'],Skald:['A change of key, nothing more.','The refrain can wait. I cannot.'],Wildspeaker:['The wood forgives a retreat. Come away.','I mend no one from the grave. Back, all of you.']},{Priest:['Spirits, carry me. Faster.'],Skald:['The song is not over. I am just singing it from farther away.','Run now, boast later. I have the verse ready.'],Wildspeaker:['Roots, hold it! I am not staying!','No seed grows on this ground today. Out!']}],
  levelup:[{Warrior:['The armor fits better each level.']},{Mage:['More power. Yes. More.']}],
  epic:[{Hunter:['A hunter notices such things. {item}. Noted.']},{Mage:['{item}. Finally, something that can keep up with me.']}],
  duel:[{Rogue:['You will not see the second blade.'],Skald:['{target}. Let us see whose verse is the better.','Hear me out, {target}. Briefly, and with steel.'],Wildspeaker:['{target}, the ground is listening. I would not trouble it.','Forgive me, {target}. The briars are not forgiving.']},{Warrior:['Shield to shield, then!'],Skald:['{target}! You will be in my next song! Briefly!','Sing, {target}! You are going to need the breath!'],Wildspeaker:['{target}, the brambles like you already.','Stand on that spot, {target}. Go on. Stand there.']}],
  idle:[{Priest:['Someone is always bleeding. I wait.'],Skald:['A quiet street is a poor audience. I wait.','The next verse will not write itself. Alas.'],Wildspeaker:['City stone. Not one root in it. I miss them.','Even here a seed finds a crack. I am taking notes.']},{Hunter:['Bow strung. Hands idle. Wrong.'],Skald:['Humming a war-song. Quietly. For once.','A hall like this wants a song. I am the song.'],Wildspeaker:['Too much smoke. I smell moss in my sleep.','Dry ground. Dry, burned ground. I do not like it.']}],
  mourn:[{Wildspeaker:['I will plant a seed where {target} lies. The grove always begins somewhere.'],Skald:['{target}. I will carry your verse.']},{Wildspeaker:['A seed for {target}. Something green will mark the place.'],Skald:['{target}! I will sing you a long one.']}],
  banter:[{Priest:['Do try to bleed less, all of you.']},{Priest:['Stand still so I can mend you!']}],
};
