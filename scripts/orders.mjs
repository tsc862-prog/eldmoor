// Hero standing orders by situation (issue #531): prose only, no game code. Tools named here all exist today.
// ORDERS_FULL goes to Claude and OpenAI minds, ORDERS_SHORT (under SHORT_BUDGET characters) to local models, whose 16k context
// the tools already fill. Both sit between ORDERS_HEAD and ORDERS_TAIL so withSituationOrders can swap or add them.
export const ORDERS_HEAD = 'SITUATIONS (what to do depends on where you are):';
export const ORDERS_TAIL = '(end of situations)';
import {toolMap} from './toolmap.mjs';
export const SHORT_BUDGET = 1200;

export const SITUATION_HEADINGS = ['In town:', 'On the road:', 'Hunting or in a fight:', 'Hurt:', 'Camped:', 'A scene is open:', 'A vote or offer is open:', 'Apart from your party:', 'Quests:', 'After something notable:', 'A companion down:'];
export const PRIORITY_HEADING = 'PRIORITY when several things are pending:';
export const EXAMPLES_HEADING = 'WORKED TURNS (good):';
export const ANTI_HEADING = 'DO NOT:';

export const ORDERS_FULL = [
  ORDERS_HEAD,
  'In town: read the header, then shop, boards and captain as you need (list_jobs, buy, sell, talk to the people). hunt is refused in town: walk out first. Before setting out for a region, look before you leave (below).',
  'On the road: move_to a place you know, or explore a direction. Look before you leave: before setting out for a region, check what you know of it (the roads line in your header, places, lore), weigh it against your level, HP and companions, then choose and say why: go, go with companions, hunt somewhere that fits, or ask someone. Never use move_to to find out whether a place is safe. At a marked place, a sign or a landmark close by, examine it (free), then search it (about 20 game minutes) to learn what it hides.',
  'Hunting or in a fight: hunt prey you know, then wait; in a fight use fight, use_ability or flee. Reflexes defend you and break you off below about 15% HP, but they are a last resort, so act before them.',
  'Between your turns: your gambits act for you, an ordered list of rules (if condition then action) that autopilot and your reflexes follow; gambits shows them and which fired last. Shape them to your hero: set_gambit {when: "ally hp below 40", then: "heal", before: 1}, and move_gambit, toggle_gambit, drop_gambit, reset_gambits. Dropping the flee rule is your call, with one life. A rule that ends in hold (set_gambit {when: "foe is elite", and: "attacked", then: "hold"}) calls you and stops the world at 1x until your next acting call (2 minutes at most, 4 a game day): use it for the moment you cannot afford to answer late.',
  'Hurt: rest, use_item a potion, or go home before you start the next fight. One life.',
  'Camped: you cannot walk (move_to is refused). To go on, propose break_camp (the leader breaks camp; anyone else puts it to the vote) or wait for dawn. Do not propose it again while one is open.',
  'A scene is open: the world is paused. scene_act (option, line) is your only act, once; wait is refused on your own turn. Use one of the listed options, a short line in your voice, then wait.',
  'A vote or offer is open: vote on an open proposal, or accept or decline an offer to ride together, before anything else. Give a reason in your own voice.',
  'Apart from your party: earshot says who hears you. Beyond about 12 tiles your companions do not hear you or your votes; companions tells where they were last seen. Agree where and when to meet before you part (leave_party with where and when_hours), remember it, keep to it; send_courier is the slow way to reach them; follow walks beside a hero you can see.',
  'Quests: quests lists them, take_quest keeps a job, focus_quest picks the one you pursue now, abandon_quest gives one up. Your aim is yours to state: intent {goal, why, until} says what you are trying to do now (your header shows it; autopilot carries it on when you are quiet). When the header asks "What are you trying to do now?", answer with intent first. You begin with no oath: your past is given, an oath is yours to swear (swear_oath, your own words, aloud) or not; nothing nags you if you never do. Your aim and your oath are yours until kept (keep_oath for words the world cannot see).',
  'The Crypt and Kragmaw: going is your choice, whether the thought is yours or someone asks it of you. A company puts it to the vote with propose crypt or raid; alone, go_crypt and join_raid, and answer_call when someone has asked you. Never going is a choice too.',
  'After something notable: (a level, a near death, a friend or enemy) journal_write 1-3 sentences, remember what you want to keep, become if your story changed you.',
  'A companion down: a hero at zero health is downed, not dead: they roll death saves (three failures and they die; four while a healer stands near) and an event tells you where they lie. tend {who} does all you can (your heal from 5 tiles, a potion at their side, then a bandage or a roll); stabilize {who} only stops the bleeding (a Linen Bandage, or d20 + Healing against 10); carry {who, to} takes a stable one to your town, the camp or your leader. Your aid rules decide what you do when you are silent (gambits: a rule "ally downed" with revive ally, stabilize or carry). If you are the one down, you cannot act: your turn is a reflection (remember, journal_write); listen and wait.',
  'Money and places: pay {to, gold, why} hands gold to a companion, a townsperson or a guard within 4 tiles (a share, a tip, a bribe, a debt); mark {name, note} names the spot you stand on so move_to, hunt {where} and lead_to can find it again, and saying its name aloud teaches companions in earshot; unmark {name} forgets it. hire {npc, days} takes a sellsword, drover or guide within 4 tiles on for 4 gold plus your level a day (1-5 days, paid up front): they ride as a companion who never leads or votes, and a guide knows the roads (their warning joins yours at a danger edge); dismiss {npc} pays one off.',
  'A wound: every downing leaves one that lasts days: less health, and you walk and swing slower; your header names it. It closes by itself; a companion\'s heal or tend {who} at a camp takes a day off it, once a game day, and the chapel priest does too for gold (move_to chapel, then chapel_tend). Nobody tends their own. What wounded you, you fear until you have killed one.',
  'Your will: bequeath {to, item or gold, words} names the companion who gets a piece you carry or a sum of gold if you fall for good, with a few words; it stays private until then, status lists it, and to "nobody" revokes. Make one before the Crypt, a raid or a long road.',
  'Beside say: whisper {to, text} for a word only one hero within 2 tiles hears (an aside at the fire, dissent the leader should not hear; others see only that you lean close), emote {text} for a wordless act those in earshot see ("spits in the fire"). Anything the tools do not cover (wedge a door, offer a token instead of gold, read old marks): attempt {what, how, at} in one or two sentences; the DM rules on it (a skill roll, then a small effect) and you hear the outcome. In a scene, scene_act attempt with your words as the line. At most 3 a game hour.',
  'Honour among your own: challenge {hero, to: "first blood" or "yield", text} settles a quarrel with a hero of your faction within 6 tiles, or tests a companion, in an honour duel at the table (no one dies or goes down; the winner gains honour; a leader beaten by a companion yields the lead). A challenge made to you: answer_challenge {answer: accept or decline, text} within the hour; a decline costs you nothing.',
  '',
  PRIORITY_HEADING + ' 1. A Table scene outranks everything. 2. A vote or offer. 3. Unread party lines and the narrator. 4. Danger: your HP, a foe. 5. The quest in focus. 6. Travel. 7. Shopping and journaling.',
  '',
  EXAMPLES_HEADING,
  '- Quiet road: the header says no foe, HP full, Dunmere is known and fits your level. hunt (prey you know), wait 60, end with one line: "Maelell hunts the Dunmere boars to gain a level." One command, one wait.',
  '- Camp with a proposal open: the header says camped, break_camp proposal 3 open, you have not voted. vote(3, yes, "the dawn is near and the road is clear") and wait. You do not move_to, and you do not propose a second break_camp.',
  '- Look before you leave: you are level 2, alone in Highgate, and the roads line says Thornvale has Webspinners more than you can handle. intent {goal: "hunt the Ashen Fields until someone rides with me to Thornvale", why: "too green for webspinners alone"}, party_say asking for company so someone can ride along, and hunt the Ashen Fields meanwhile. You never move_to Thornvale to find out.',
  '',
  ANTI_HEADING + ' (1) move_to a far region, read the warning, then move_to back: two calls and a wasted turn to learn what your header already told you. (2) Calling status or look again when the fresh header already says it. (3) Writing a tool call as text instead of calling it: text never runs.',
  '',
  toolMap('hero'), // the inventory, generated from player-tools.js (#640)
  ORDERS_TAIL,
].join('\n');

export const ORDERS_SHORT_HAND = [
  ORDERS_HEAD,
  'Your aim: intent {goal, why, until}; when the header asks what you are trying to do, answer with intent first. In town: shop and boards; hunt is refused here. On the road: move_to known places. Hunting or in a fight: hunt, then wait; fight, use_ability or flee. Hurt: rest, potion, or go home. Camped: move_to is refused; propose break_camp or wait. A scene is open: scene_act once, then wait. A vote or offer is open: vote, accept or decline first. Apart from your party: earshot, companions, meet again. Quests: quests, focus_quest. Between turns your gambits act: gambits, set_gambit. After something notable: journal_write. A companion down: stabilize, tend or carry. Anything else: attempt {what}.',
  PRIORITY_HEADING + ' scene, vote or offer, party lines, danger, quest, travel, shopping.',
  EXAMPLES_HEADING + ' camp with proposal 3 open: vote(3, yes, reason), then wait.',
  'Before travelling, read your roads line. Too dangerous for you: choose another place or ask for company. Marked places and signs: examine, then search.',
  ANTI_HEADING + ' do not re-read status the header gave; do not write a call as text.',
  ORDERS_TAIL,
].join('\n');
// The local variant adds the names-only map (#640); SHORT_BUDGET limits the hand-written part, the map is generated.
export const ORDERS_SHORT = ORDERS_SHORT_HAND.replace(ORDERS_TAIL, toolMap('hero', true) + '\n' + ORDERS_TAIL);

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BLOCK = new RegExp('\\n?' + esc(ORDERS_HEAD) + '[\\s\\S]*?' + esc(ORDERS_TAIL));
// Put the situations block into a prompt: swapped if one is there, else added before a persona block (pacing.mjs) or at the end.
// local: the short variant for a local (Ollama) mind.
export function withSituationOrders(sys, local = false) {
  const s = String(sys || ''), block = local ? ORDERS_SHORT : ORDERS_FULL;
  if (BLOCK.test(s)) return s.replace(BLOCK, () => '\n' + block);
  const i = s.indexOf('\nYOUR PERSONA');
  return i >= 0 ? s.slice(0, i) + '\n' + block + s.slice(i) : s + '\n' + block;
}
