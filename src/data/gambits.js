// Gambits (issue #617): a hero's own ordered rules, "if <condition> then <action>", in the style of Final Fantasy XII.
// Pure data (append-only: add conditions, actions and preset rows at the end; never rename or reorder existing keys).
// The engine is src/sim/gambits.js; the tools are in data/player-tools.js and sim/player.js.
//
// How the rules run (agent-played heroes only; scripted heroes keep their hard-coded rules):
//   - fight: every moment of a fight, top to bottom, every rule with a fight action whose condition holds acts in its
//     turn (a heal, a blow, a potion); a rule that moves you (flee_home, retreat_to) or holds you (hold_position) ends it.
//   - between turns (autopilot): the first rule whose condition holds and whose action can run right now acts; an action
//     that cannot run here (a town action out in the field) falls through to the next rule.
//   - the pack reflex: idle out in the field with no order, before autopilot starts, only sell_loot rules run.
// A rule: {id, when, w?:{args}, and?, w2?:{args}, then, t?:{args}, on}. `and` is an optional second condition.
export const GAMBIT={
  MAX:24,        // rules a hero keeps (the class presets use up to 19: today's autopilot and reflexes written out)
  PER_DAY:20,    // edits (set, move, toggle, drop, reset) a game day
  SHOUT_GAP:60,  // game minutes between two shouts of one rule
  WAKE_GAP:30,   // game minutes between two wake_me calls of one rule
  LOG:12,        // fired rules kept per hero (for the Agent tab)
  HIST:30,       // edits kept per hero
  HOLD_MAX_S:120,// real seconds a hold waits for the agent's next acting call (#630)
  HOLD_PER_DAY:4,// holds a game day per hero
  HOLD_GAP:60,   // game minutes between two holds of one rule
};

// Conditions. args: name -> description (all numbers are whole). fight: true when it reads the foe of the fight.
export const CONDS={
  always:{desc:'Always holds.'},
  self_hp_below:{args:{pct:'your HP below this share (1-99)',scale:'optional "retreat" or "flee": your nature moves the mark (a Cautious hero sooner, a Reckless one later)'},desc:'You are hurt below pct% of your HP.'},
  ally_hp_below:{args:{pct:'a companion below this share (1-99)',who:'optional companion name'},desc:'A companion in sight (or the one named) is below pct% HP; the weakest is the target of heal or guard.'},
  leader_hp_below:{args:{pct:'your leader below this share (1-99)'},desc:'Your company or party leader, in sight, is below pct% HP.'},
  foe_is:{args:{what:'elite | named | above_my_level | known_dangerous'},desc:'The foe you are fighting is of that sort.'},
  foes_more_than:{args:{n:'number of creatures (1-9)'},desc:'More than n creatures are on you.'},
  in_fight:{desc:'You are in a fight.'},
  attacked:{desc:'A creature is attacking you.'},
  no_potions:{desc:'You carry no healing potion.'},
  pack_full:{args:{n:'optional: pack entries (default 8)'},desc:'Your pack holds n entries of loot or more.'},
  in_town:{desc:'You are inside a friendly town.'},
  at_camp:{desc:'Your company is camped and you are at the fire.'},
  night:{desc:'It is night (21:00 to 05:00).'},
  storm_or_fog:{desc:'A storm or fog lies over the region you are in.'},
  apart_from_leader:{args:{tiles:'distance in tiles (2-40)'},desc:'Your leader is farther than tiles away (or out of sight).'},
  leader_moving:{desc:'Your leader is on the move.'},
  no_quest_in_focus:{desc:'No quest is in focus in your quest log.'},
  quest_target_in_sight:{desc:'A creature your kill quest wants is in sight.'},
  node_ready:{args:{kind:'optional: herb, ore, game or fish'},desc:'A gathering spot you can work is ready in sight.'},
  level_below_region:{desc:'The region you are in is above your level (its lowest level is higher than yours).'},
  gold_above:{args:{n:'gold'},desc:'You carry more than n gold.'},
  storm:{desc:'A storm lies over the region you are in (fog does not count).'},
  potions_below:{args:{n:'potions (1-9)'},desc:'You carry fewer than n healing potions.'},
  vote_open:{desc:'Your company is voting on a proposal.'},
  past_flee_mark:{fight:true,desc:'Below your flee mark in a fight: 15% HP (or the flee_below of your hunt order); on autopilot 22%, or 50% against a foe above you, elite or named, moved by your nature.'},
  // the downed (#626, #658): a companion at zero HP, bleeding or stable; the count of your own downings
  ally_downed:{args:{who:'optional companion name'},desc:'A companion within 12 tiles (or the one named) is down at zero health, bleeding or stable; the nearest is the one revive_ally, stabilize and carry go to.'},
  no_healer:{desc:'No other healer of the downed companion (a class that casts heals) is free to come to them.'},
  self_downed_count:{args:{n:'downings (1-9)',days:'optional: only those of the last days game days (1-30)'},desc:'You have gone down n times or more (in your life, or in the last days game days).'},
};

// Actions. phase: fight (in a fight), idle (between turns), both. safety: the reflex it stands for (dropping or weakening
// a rule with it is logged and counted). args: name -> description.
export const ACTS={
  defend:{phase:'fight',safety:'defend',desc:'Strike back at the foe you are fighting (a blow whenever your weapon is ready).'},
  flee_home:{phase:'fight',safety:'flee',desc:'Break off the fight and run for your home town (one parting blow is rolled).'},
  retreat_to:{phase:'fight',safety:'flee',args:{to:'leader | camp | town'},desc:'Break off the fight and run to your leader, your company camp or your town.'},
  drink_potion:{phase:'fight',safety:'potion',desc:'With "always": your own judgement (a potion below about 40% HP, sooner if cautious; an antidote for venom; a ward against an elite). With another condition: drink your best potion as soon as it holds.'},
  use_ability:{phase:'fight',args:{id:'an ability id (status.abilities)',target:'self | leader | weakest_ally | foe'},desc:'Use one of your class abilities when it is ready.'},
  guard:{phase:'fight',args:{who:'optional: leader | weakest_ally | a companion name'},desc:'Draw the creature attacking a companion onto yourself.'},
  heal:{phase:'fight',args:{who:'optional: self | leader | weakest_ally'},desc:'Your class heal. With "always": your own judgement (the weakest companion near you below about 55%; while the spell recovers, a potion handed to one nearly down). With an HP condition: the hero it names.'},
  follow_leader:{phase:'idle',desc:'Keep to your leader: out in the field stay with them; in town wait for them a while (4 game hours) before going out alone.'},
  hold_position:{phase:'both',desc:'Do nothing new: stand where you are (in a fight: stop reading the rules below for this moment).'},
  rest:{phase:'idle',args:{minutes:'optional: 10-240 (default 60)',inn:'optional "yes": in town, walk to the inn first'},desc:'Rest: in town where you are or at the inn; in the field where you stand, or walk home to heal if a creature is close.'},
  make_camp:{phase:'idle',args:{hours:'optional 1-8 (default 2)'},desc:'As your company\'s leader out on the road: make camp.'},
  hunt_here:{phase:'idle',desc:'Hunt where you are, if this region suits your strength (wary: prey you can take).'},
  hunt_region:{phase:'idle',args:{region:'optional: a region you know'},desc:'Walk to the region (default: your last hunting ground or the known region that fits you best) and hunt there.'},
  go_home:{phase:'idle',desc:'Walk home to your town (out in the field only).'},
  sell_loot:{phase:'idle',desc:'Sell your loot: in town at once; out in the field walk home to the auction house.'},
  buy_potions:{phase:'idle',args:{n:'potions to carry (1-6, default 2)'},desc:'In town: buy healing potions up to n (if you can afford n of them).'},
  gather:{phase:'idle',args:{kind:'optional: herb, ore, game or fish'},desc:'Work a gathering spot in sight that your trade can work.'},
  shout:{phase:'both',args:{text:'one line (up to 120 characters)'},desc:'Shout a line to your companions in range (at most once an hour per rule).'},
  wake_me:{phase:'both',desc:'Call your own mind: your next turn starts now (at most once every 30 game minutes per rule).'},
  follow_order:{phase:'idle',desc:'Fall in behind the hero your standing follow order names (only when not too hurt to travel).'},
  hunt_again:{phase:'idle',desc:'Out in the field: carry on your last hunt order on the ground you stand on (if it still suits you).'},
  pursue_aim:{phase:'idle',desc:'Carry on your stated aim (intent): walk on to its place, hunt its ground, follow, or wait.'},
  hold:{phase:'both',desc:'Call your own mind AND stop the world at 1x until your next acting call (or 120 real seconds, or your runner is gone): for the moment you cannot afford to be late to. At most 4 a game day, one an hour per rule; no effect at a Table scene (it already waits).'},
  // when a companion goes down (#626, #658): phase 'aid' rules are read the moment a companion within 12 tiles is downed
  // (sim/downed.js callHelp): every one that holds adds what you will do for them; with none you do not come.
  revive_ally:{phase:'aid',desc:'Bring a downed companion back up: your class heal from 5 tiles (it lands 15% of their health higher), else a healing potion at their side (a party mate).'},
  stabilize:{phase:'aid',desc:'Stop the bleeding of a downed companion at their side: a Linen Bandage (sure), else a stabilize roll (d20 + Healing against 10, every 10 game minutes). They stay down but stop rolling death saves.'},
  carry:{phase:'aid',args:{to:'town | camp | leader (default town)'},desc:'Once a downed companion is stable, carry them (at 60% of your pace) to your town, the company camp or your leader, and lay them down to wake.'},
};

// Presets: today's autopilot and reflexes written out as rules, in the order the hard-coded policy checked them, so an
// untouched hero plays exactly as before (issue #617). `common` is every class's list; `heal` is inserted at the top of
// the fight rules for a class that casts heals, `guard` (off) for a tank class.
const R=(when,then,o={})=>({when,then,...o});
export const PRESET_IDLE=[
  R('always','follow_order'),
  R('in_town','hold_position',{and:'vote_open'}),
  R('self_hp_below','go_home',{w:{pct:45,scale:'retreat'}}),
  R('self_hp_below','rest',{w:{pct:60},t:{minutes:60,inn:'yes'}}),
  R('in_town','rest',{and:'self_hp_below',w2:{pct:90},t:{minutes:30}}),
  R('storm','go_home'),
  R('in_town','sell_loot',{and:'pack_full',w2:{n:4}}),
  R('potions_below','buy_potions',{w:{n:2},t:{n:2}}),
  R('always','pursue_aim'),
  R('always','hunt_again'),
  R('always','follow_leader'),
  R('pack_full','sell_loot',{w:{n:8}}),
  R('always','hunt_here'),
  R('always','hunt_region'),
  R('always','go_home'),
];
export const PRESET_FIGHT=[
  R('in_fight','defend'),
  R('always','drink_potion'),
  R('past_flee_mark','flee_home'),
];
export const PRESET_HEAL=R('always','heal');
export const PRESET_GUARD=R('ally_hp_below','guard',{w:{pct:50},on:false}); // a tank's suggestion, off by default (no such reflex today)
export const TANK_CLASSES=['Warrior']; // classes whose preset carries the guard suggestion
// When a companion goes down (#658): a healer brings them up, the others bring them up with a potion when no healer can
// come and stabilize them; every class has the stabilize rule (a lone healer whose heal is not ready binds or rolls too).
// The three together are what agent heroes did as a reflex before #658 (sim/downed.js aid), so presets play as before.
export const PRESET_DOWN_HEAL=R('ally_downed','revive_ally');                   // a healer's: above its heal rule
export const PRESET_DOWN_POTION=R('ally_downed','revive_ally',{and:'no_healer'});// everyone else's: a potion when no healer comes
export const PRESET_DOWN_STAB=R('ally_downed','stabilize',{and:'no_healer'});     // everyone's
export const PRESETS=['class','cautious','empty']; // reset_gambits presets: the class list, it with a flee rule at 35% first, or no rules at all
