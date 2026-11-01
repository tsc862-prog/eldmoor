// Agent player (issue #75): the tools an AI agent uses to play one hero. Pure data, shared by
// the MCP server (scripts/relay-mcp.mjs), the headless host and the docs. Each tool:
//   {name, desc, act, args:{argName:{type:'string'|'integer'|'number', desc, optional?, enum?}}}
// act: true for tools that change the world (rate limited per game hour), false for reads.
// The game side is src/sim/player.js; every call only ever touches the agent's own hero.
export const PLAYER_TOOLS=[
  {name:'look',act:false,desc:'Look around: the place, time, weather, and the heroes, townsfolk and monsters you can see (about 12 tiles, less in fog or storms; the whole town square when in town). Also returns what happened since your last call.',args:{}},
  {name:'status',act:false,desc:'Your hero: level, HP, XP, gold, what you are doing, your command queue, quest, oath, origin, traits, party, adventure and any scene choice waiting for you, plus the places you can travel to.',args:{}},
  {name:'inventory',act:false,desc:'Your seven equipment slots and your bag (loot to sell and spare gear you can equip by index).',args:{}},
  {name:'move_to',act:true,desc:'Walk somewhere. Target: a town spot (auction house, quest giver, gate, inn, smith, chapel, square, graveyard), a townsperson by name or role, "home", a region name (a random hunting spot there), "crypt", a friendly town, or map coordinates "x,y". Replaces your current command.',args:{target:{type:'string',desc:'Where to go'}}},
  {name:'talk',act:true,desc:'Speak to a townsperson (by name or role, within 4 tiles; they answer in their own words) or to a hero of your own faction nearby (by name or id).',args:{target:{type:'string',desc:'Name, role or hero id'}}},
  {name:'say',act:true,desc:'Say a line out loud (max 120 characters). Heroes within earshot hear it; it shows as a speech bubble.',args:{text:{type:'string',desc:'What you say'}}},
  {name:'join_party',act:true,desc:'Join (or form a party with) a hero of your faction within sight and within 3 levels of you. Loners refuse. A party of 3 is full.',args:{hero_id:{type:'integer',desc:'The other hero\'s id from look'}}},
  {name:'leave_party',act:true,desc:'Leave your party.',args:{}},
  {name:'list_jobs',act:false,desc:'In your home town: the adventures posted at the gate (and your own adventure if you have one to resume), with whether each fits you.',args:{}},
  {name:'take_adventure',act:true,desc:'In your home town: take a posted job (or resume your own adventure) by its id. The adventure then leads you scene by scene; choice scenes wait for choose().',args:{job_id:{type:'integer',desc:'Job id from list_jobs'}}},
  {name:'choose',act:true,desc:'Pick a branch at your adventure\'s current choice scene: "a" (the bold road) or "b" (the careful one). Unanswered choices fall to your instincts after a while.',args:{option:{type:'string',enum:['a','b'],desc:'a or b'}}},
  {name:'fight',act:true,desc:'Attack a monster (or an enemy-faction hero outside Thornvale) you can see, by id from look. You break off and run home below flee_below percent HP (default 15).',args:{target_id:{type:'integer',desc:'Monster or hero id'},flee_below:{type:'integer',desc:'Flee below this % HP (5-60)',optional:true}}},
  {name:'hunt',act:true,desc:'Hunt monsters of your level in the region you stand in until you have killed count of them, or your HP drops below 45%.',args:{count:{type:'integer',desc:'Kills to make (1-10, default 3)',optional:true},flee_below:{type:'integer',desc:'Flee a fight below this % HP (5-60)',optional:true}}},
  {name:'flee',act:true,desc:'Break off the current fight or duel and run for home. A monster may land one parting blow.',args:{}},
  {name:'rest',act:true,desc:'Sit and recover HP where you stand for some game minutes (default 60). Any attack interrupts.',args:{minutes:{type:'integer',desc:'Game minutes (10-240)',optional:true}}},
  {name:'buy',act:true,desc:'In your home town: buy a piece of gear at your level for one slot (default: your weakest). Costs 6 gold per item level; only upgrades are sold to you.',args:{slot:{type:'string',enum:['head','chest','hands','feet','main','off','trinket'],desc:'Slot',optional:true}}},
  {name:'sell',act:true,desc:'In your home town: sell your loot and spare gear at the auction house. index sells one bag entry; without it everything goes.',args:{index:{type:'integer',desc:'Bag index from inventory',optional:true}}},
  {name:'equip',act:true,desc:'Wear a piece of gear from your bag (by bag index); what it replaces goes into the bag. Not during a fight.',args:{index:{type:'integer',desc:'Bag index from inventory'}}},
  {name:'turn_in',act:true,desc:'In your home town: hand in your finished kill quest for XP and gold, and get a new one.',args:{}},
  {name:'read_chronicle',act:false,desc:'The latest news of the world as the town criers tell it (newest first).',args:{n:{type:'integer',desc:'How many lines (1-20, default 8)',optional:true}}},
  {name:'journal_read',act:false,desc:'Read your own journal (newest last).',args:{n:{type:'integer',desc:'How many entries (1-50, default 10)',optional:true}}},
  {name:'journal_write',act:false,desc:'Write a short journal entry in your hero\'s voice (max 600 characters). It is saved with the world.',args:{text:{type:'string',desc:'The entry'}}},
  {name:'wait',act:false,desc:'Let game time pass (10-240 game minutes; 1 real second is 6 game minutes) while your command runs. Returns early when something urgent happens: an attack, a choice, low HP, a finished command. Use it between actions instead of polling.',args:{minutes:{type:'integer',desc:'Game minutes (10-240, default 60)',optional:true}}},
];
export const TOOL_NAMES=PLAYER_TOOLS.map(t=>t.name);
