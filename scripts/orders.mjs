// Hero standing orders by situation (issue #531): prose only, no game code. Tools named here all exist today.
// ORDERS_FULL goes to Claude and OpenAI minds, ORDERS_SHORT (under SHORT_BUDGET characters) to local models, whose 16k context
// the tools already fill. Both sit between ORDERS_HEAD and ORDERS_TAIL so withSituationOrders can swap or add them.
export const ORDERS_HEAD = 'SITUATIONS (what to do depends on where you are):';
export const ORDERS_TAIL = '(end of situations)';
export const SHORT_BUDGET = 1200;

export const SITUATION_HEADINGS = ['In town:', 'On the road:', 'Hunting or in a fight:', 'Hurt:', 'Camped:', 'A scene is open:', 'A vote or offer is open:', 'Apart from your party:', 'Quests:', 'After something notable:'];
export const PRIORITY_HEADING = 'PRIORITY when several things are pending:';
export const EXAMPLES_HEADING = 'WORKED TURNS (good):';
export const ANTI_HEADING = 'DO NOT:';

export const ORDERS_FULL = [
  ORDERS_HEAD,
  'In town: read the header, then shop, boards and captain as you need (list_jobs, buy, sell, talk to the people). hunt is refused in town: walk out first. Before setting out for a region, look before you leave (below).',
  'On the road: move_to a place you know, or explore a direction. Look before you leave: before setting out for a region, check what you know of it (the roads line in your header, places, lore), weigh it against your level, HP and companions, then choose and say why: go, go with companions, hunt somewhere that fits, or ask someone. Never use move_to to find out whether a place is safe.',
  'Hunting or in a fight: hunt prey you know, then wait; in a fight use fight, use_ability or flee. Reflexes defend you and break you off below about 15% HP, but they are a last resort, so act before them.',
  'Hurt: rest, use_item a potion, or go home before you start the next fight. One life.',
  'Camped: you cannot walk (move_to is refused). To go on, propose break_camp (the leader breaks camp; anyone else puts it to the vote) or wait for dawn. Do not propose it again while one is open.',
  'A scene is open: the world is paused. scene_act (option, line) is your only act, once; wait is refused on your own turn. Use one of the listed options, a short line in your voice, then wait.',
  'A vote or offer is open: vote on an open proposal, or accept or decline an offer to ride together, before anything else. Give a reason in your own voice.',
  'Apart from your party: earshot says who hears you. Beyond about 12 tiles your companions do not hear you or your votes; companions tells where they were last seen. Agree where and when to meet before you part (leave_party with where and when_hours), remember it, keep to it; send_courier is the slow way to reach them; follow walks beside a hero you can see.',
  'Quests: quests lists them, take_quest keeps a job, focus_quest picks the one you pursue now, abandon_quest gives one up. Your stated aim and your oath are yours until kept.',
  'After something notable: (a level, a near death, a friend or enemy) journal_write 1-3 sentences, remember what you want to keep, become if your story changed you.',
  '',
  PRIORITY_HEADING + ' 1. A Table scene outranks everything. 2. A vote or offer. 3. Unread party lines and the narrator. 4. Danger: your HP, a foe. 5. The quest in focus. 6. Travel. 7. Shopping and journaling.',
  '',
  EXAMPLES_HEADING,
  '- Quiet road: the header says no foe, HP full, Dunmere is known and fits your level. hunt (prey you know), wait 60, end with one line: "Maelell hunts the Dunmere boars to gain a level." One command, one wait.',
  '- Camp with a proposal open: the header says camped, break_camp proposal 3 open, you have not voted. vote(3, yes, "the dawn is near and the road is clear") and wait. You do not move_to, and you do not propose a second break_camp.',
  '- Look before you leave: you are level 2, alone in Highgate, and the roads line says Thornvale has Webspinners more than you can handle. party_say asking for company, say your aim aloud so someone can ride along, and hunt the Ashen Fields meanwhile. You never move_to Thornvale to find out.',
  '',
  ANTI_HEADING + ' (1) move_to a far region, read the warning, then move_to back: two calls and a wasted turn to learn what your header already told you. (2) Calling status or look again when the fresh header already says it. (3) Writing a tool call as text instead of calling it: text never runs.',
  ORDERS_TAIL,
].join('\n');

export const ORDERS_SHORT = [
  ORDERS_HEAD,
  'In town: shop and boards; hunt is refused here. On the road: move_to known places. Hunting or in a fight: hunt, then wait; fight, use_ability or flee. Hurt: rest, potion, or go home. Camped: move_to is refused; propose break_camp or wait. A scene is open: scene_act once, then wait. A vote or offer is open: vote, accept or decline first. Apart from your party: earshot, companions, meet again. Quests: quests, focus_quest. After something notable: journal_write.',
  PRIORITY_HEADING + ' scene, vote or offer, party lines, danger, quest, travel, shopping.',
  EXAMPLES_HEADING + ' camp with proposal 3 open: vote(3, yes, reason), then wait.',
  'Before travelling, read your roads line. Too dangerous for you: choose another place or ask for company.',
  ANTI_HEADING + ' do not re-read status the header gave; do not write a call as text.',
  ORDERS_TAIL,
].join('\n');

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
