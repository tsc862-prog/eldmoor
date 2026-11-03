// Tool map (#640): the inventory of a seat's tools in its standing orders, generated from the tool tables
// (src/data/player-tools.js, src/data/dm-tools.js) so a new tool is never forgotten. The hand-written orders keep the
// judgement (scripts/orders.mjs, dm-agent.mjs); the map keeps the names, grouped by situation, one short use each (the
// first sentence of the tool's own description). A tool no group lists goes under "More tools", so it still appears.
// Pure text, no game, no network. Public tool names and descriptions only: nothing private to another seat.
import {PLAYER_TOOLS} from '../src/data/player-tools.js';
import {DM_TOOLS} from '../src/data/dm-tools.js';

export const MAP_HEAD = 'TOOL MAP (every tool you have, by situation; the situations above say when):';
export const MAP_TAIL = '(end of tool map)';
export const MAP_BUDGET_CHARS = 7000; // about 1.7k tokens; room for a dozen more tools

// group title -> tool names. Names that do not exist are caught by orderscheck; tools not listed land in "More tools".
export const HERO_GROUPS = {
  'Look and learn': ['look', 'status', 'inventory', 'combat_log', 'places', 'lore', 'inspect', 'examine', 'search', 'companions', 'earshot', 'outposts', 'mark', 'unmark', 'read_chronicle'],
  'Move and fight': ['move_to', 'follow', 'hunt', 'fight', 'flee', 'rest', 'use_ability', 'use_item', 'choose_specialisation', 'gambits', 'set_gambit', 'move_gambit', 'toggle_gambit', 'drop_gambit', 'reset_gambits'],
  'Town, trade and craft': ['shop', 'buy', 'sell', 'equip', 'auction_browse', 'auction_list', 'auction_buy', 'auction_cancel', 'give', 'pay', 'drop', 'recipes', 'learn_profession', 'unlearn_profession', 'nodes', 'gather', 'smith', 'craft'],
  'Jobs and quests': ['list_jobs', 'take_adventure', 'choose', 'quests', 'take_quest', 'focus_quest', 'abandon_quest', 'swear_oath', 'renounce_oath', 'turn_in', 'post_notice', 'intent', 'enter_site'],
  'Talk and company': ['say', 'whisper', 'emote', 'talk', 'party_say', 'chat_read', 'party_read', 'invite', 'join_party', 'accept', 'decline', 'leave_party', 'propose', 'vote', 'challenge', 'answer_challenge', 'break_camp', 'lead_to', 'send_courier'],
  'Memory and self': ['journal_read', 'journal_write', 'journal_search', 'remember', 'recall', 'update_memory', 'forget', 'pin', 'self', 'become'],
  'The table and the unforeseen': ['scene_act', 'attempt', 'wait'],
};
export const DM_GROUPS = {
  'Read the world': ['dm_status', 'read_timeline', 'read_chronicle', 'read_dm_log', 'regions', 'npcs', 'hooks', 'levers', 'survey', 'world_standing'],
  'Read the companies': ['fellowship_view', 'companies_view', 'heroes_near', 'hear'],
  'Your notes': ['notes_read', 'notes_write', 'remember', 'recall', 'update_memory', 'forget', 'pin', 'log_intent'],
  'Shape the world': ['pull_lever', 'post_hook', 'place_person', 'mark_place', 'give_item', 'take_item', 'stage_scene', 'create_site', 'retire_person', 'withdraw_hook', 'set_attitude', 'set_condition', 'price_shock', 'mark_danger', 'start_event', 'nudge_relation', 'custom_foe', 'seed_rumour', 'bestow'],
  'Take back and plan ahead': ['undo', 'dismiss', 'unstage', 'when', 'whens', 'unwhen', 'watch', 'watches', 'unwatch'],
  'Speak in the game': ['narrate', 'npc_say', 'whisper', 'dream', 'npc_call', 'npc_offer'],
  'At the table': ['table_call', 'table_answer', 'ruling_call', 'ruling_answer', 'prep_done'],
};

const TABLES = {hero: {tools: PLAYER_TOOLS, groups: HERO_GROUPS}, dm: {tools: DM_TOOLS, groups: DM_GROUPS}};
export const toolNames = role => TABLES[role].tools.map(t => t.name);

// One short use: the tool's first sentence (a "Name: " lead-in dropped), cut at a word near n characters.
export function oneLine(t, n = 58) {
  let s = String(t.desc || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[A-Z][A-Za-z ]{0,20}: (?=[A-Z])/, '');
  const m = s.match(/^.*?[.;:](?=\s|$)/); if (m && m[0].length > 16) s = m[0];
  s = s.replace(/[.;:]$/, '');
  if (s.length > n) {s = s.slice(0, n); s = s.slice(0, Math.max(s.lastIndexOf(' '), 20)).replace(/[,;:(\-]+$/, '') + '...'}
  return s;
}

// The groups as rows of {title, names}: the listed tools that exist, then every unlisted one under "More tools".
export function groupsOf(role) {
  const {tools, groups} = TABLES[role], have = new Set(tools.map(t => t.name)), seen = new Set(), out = [];
  for (const [title, names] of Object.entries(groups)) {
    const list = names.filter(n => have.has(n) && !seen.has(n)); list.forEach(n => seen.add(n));
    if (list.length) out.push({title, names: list});
  }
  const rest = tools.map(t => t.name).filter(n => !seen.has(n));
  if (rest.length) out.push({title: 'More tools', names: rest});
  return out;
}
export const ungrouped = role => { const g = groupsOf(role).find(x => x.title === 'More tools'); return g ? g.names : []; };

// short: names only, for a local model whose context the tool list already fills.
export function toolMap(role, short = false) {
  const by = new Map(TABLES[role].tools.map(t => [t.name, t]));
  const rows = groupsOf(role).map(g => short ? `${g.title}: ${g.names.join(', ')}.` : `${g.title}:\n` + g.names.map(n => `- ${n}: ${oneLine(by.get(n))}`).join('\n'));
  return [MAP_HEAD, ...rows, MAP_TAIL].join('\n');
}

// Put the map into a prompt: swapped if one is there, else added at the end (regenerated at each runner start).
export function withToolMap(sys, role, local = false) {
  const s = String(sys || ''), block = toolMap(role, local), a = s.indexOf(MAP_HEAD), b = a < 0 ? -1 : s.indexOf(MAP_TAIL, a);
  if (a >= 0 && b > a) return s.slice(0, a).trimEnd() + '\n' + block + s.slice(b + MAP_TAIL.length);
  return s + '\n' + block;
}
