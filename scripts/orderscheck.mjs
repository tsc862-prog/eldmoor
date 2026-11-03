// Hero standing orders by situation (#531): every heading, the priority list, the worked turns, the anti-patterns and the
// short local variant (under its size budget) are present; migration swaps and never duplicates; the persona block survives;
// every tool the orders name exists today. Prose only: no game, no network.
import {systemPrompt, withSituationOrders} from './agent-player.mjs';
import {fellowshipPrompt} from './fellowship.mjs';
import {withPersona} from './pacing.mjs';
import {ORDERS_FULL, ORDERS_SHORT, ORDERS_SHORT_HAND, SHORT_BUDGET, SITUATION_HEADINGS, PRIORITY_HEADING, EXAMPLES_HEADING, ANTI_HEADING, ORDERS_HEAD, ORDERS_TAIL} from './orders.mjs';
import {TOOL_NAMES} from '../src/data/player-tools.js';
import {DM_TOOL_NAMES} from '../src/data/dm-tools.js';
import {toolMap, withToolMap, groupsOf, ungrouped, HERO_GROUPS, DM_GROUPS, MAP_HEAD, MAP_TAIL, MAP_BUDGET_CHARS} from './toolmap.mjs';
import {dmSystemPrompt} from './dm-agent.mjs';

let bad = 0;
const ok = (c, m) => {console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++};
const st = {name: 'Maelell', level: 2, people: 'human', cls: 'Ranger', faction: 'Concord', home: 'Highgate', traits: ['wary'], oath: 'guard the road', origin: 'a farm boy', fellowship: {role: 'DPS', fellowship: 'The Ember Road'}};
const count = (s, x) => s.split(x).length - 1;

const sys = systemPrompt(st) + '\n' + fellowshipPrompt(st);
ok(SITUATION_HEADINGS.every(h => sys.includes('\n' + h)), 'every situation heading is in the full orders: ' + SITUATION_HEADINGS.length);
ok(sys.includes(PRIORITY_HEADING) && /Table scene outranks everything.*vote or offer.*party lines.*Danger.*quest in focus.*Travel.*Shopping/.test(sys), 'the priority list runs scene, vote, party lines, danger, quest, travel, shopping');
ok(sys.includes(EXAMPLES_HEADING) && /Quiet road:/.test(sys) && /Camp with a proposal open:/.test(sys) && /Look before you leave: you are level 2, alone in Highgate.*Thornvale/.test(sys), 'three worked turns, with the Thornvale look-before-you-leave one');
ok(sys.includes(ANTI_HEADING) && /move_to a far region, read the warning, then move_to back/.test(sys) && /Writing a tool call as text/.test(sys), 'anti-patterns named: move_to and back, text calls');
ok(/Never use move_to to find out whether a place is safe/.test(sys) && /roads line/.test(sys), 'look before you leave under On the road');
ok(/^- Trust the fresh header/m.test(sys.split('How to play:\n')[1]), 'the header rule is the first line of How to play');
ok(/HARDCORE/.test(sys) && /journal_write/.test(sys) && /Keep memories/.test(sys) && /Who you are is yours to grow/.test(sys) && /only in English/.test(sys) && /DISTANCE CUTS YOU OFF/.test(sys) && /TABLE MODE/.test(sys), 'older rules kept: hardcore, journal, memory, persona, English, distance, table mode');
ok(/wait is refused on your own turn/.test(sys) && /scene_act/.test(sys), 'scene-first rules kept (#515/#533)');

ok(ORDERS_SHORT_HAND.length <= SHORT_BUDGET, `the local variant is ${ORDERS_SHORT_HAND.length} characters (budget ${SHORT_BUDGET})`);
ok(SITUATION_HEADINGS.every(h => ORDERS_SHORT.toLowerCase().includes(h.replace(/:$/, '').toLowerCase())), 'the local variant covers every situation');
ok(ORDERS_SHORT.includes(PRIORITY_HEADING) && ORDERS_SHORT.includes(EXAMPLES_HEADING) && ORDERS_SHORT.includes(ANTI_HEADING) && count(ORDERS_SHORT, 'proposal 3') === 1 && /Before travelling, read your roads line/.test(ORDERS_SHORT), 'the local variant has the priority, one example, the anti-patterns and the roads line');
ok(ORDERS_FULL.length > ORDERS_SHORT.length * 2, 'the full orders are the longer ones');

// migration: an older prompt gets the block once; switching swaps it; a persona block stays last
const old = 'You are Old.\nHow to play:\n- x';
const a = withSituationOrders(old), b = withSituationOrders(a);
ok(a.includes(ORDERS_FULL) && a === b && count(a, ORDERS_HEAD) === 1, 'an older prompt gets the situations once');
const c = withSituationOrders(a, true);
ok(c.includes(ORDERS_SHORT) && !c.includes(ORDERS_FULL) && count(c, ORDERS_HEAD) === 1 && withSituationOrders(c, false) === a, 'the short and full variants swap in place');
const p = withPersona(a, 'YOUR PERSONA\nvoice: dry\n(end of your persona)'), p2 = withSituationOrders(p, true), p3 = withPersona(p2, 'YOUR PERSONA\nvoice: sharp\n(end of your persona)');
ok(p2.indexOf(ORDERS_TAIL) < p2.indexOf('YOUR PERSONA') && p3.split('YOUR PERSONA').length === 2 && p3.includes('voice: sharp') && !p3.includes('voice: dry'), 'the persona block markers still work around the situations');
const q = withSituationOrders('base\nYOUR PERSONA\nv\n(end of your persona)');
ok(q.indexOf(ORDERS_HEAD) < q.indexOf('YOUR PERSONA'), 'a new block goes before an existing persona block');

// the tools the orders name exist; the aim is the intent tool now (#535), not "your stated aim"
const names = new Set(TOOL_NAMES);
ok(names.has('intent') && /intent \{goal, why, until\}/.test(ORDERS_FULL) && /intent \{goal, why, until\}/.test(ORDERS_SHORT) && !/stated aim/.test(ORDERS_FULL) && !/say your aim aloud/.test(ORDERS_FULL), 'the orders name the intent tool for the aim (#535), in both variants');
ok(/What are you trying to do now\?/.test(ORDERS_FULL), 'the full orders say to answer the stale-aim question with intent first');
const strip = s => { const a = s.indexOf(MAP_HEAD), b = s.indexOf(MAP_TAIL); return a < 0 ? s : s.slice(0, a) + s.slice(b + MAP_TAIL.length) };
const named = new Set([...(strip(ORDERS_FULL) + ' ' + strip(ORDERS_SHORT)).matchAll(/\b([a-z]+(?:_[a-z]+)+|intent|hunt|wait|vote|look|status|rest|say|earshot|companions|follow|lore|places|buy|sell|talk|become|remember)\b/g)].map(m => m[1]));
const missing = [...named].filter(n => n.includes('_') && !names.has(n) && !/^(when_hours|job_id|offer_id|meet_at|hero_id)$/.test(n));
ok(!missing.length, 'every snake_case tool the orders name exists' + (missing.length ? ': missing ' + missing.join(', ') : ''));

// the tool map (#640): generated from the tool tables, every row of both tables appears in its seat's prompt
const mapOf = (s, role) => s.slice(s.indexOf(MAP_HEAD), s.indexOf(MAP_TAIL));
const inMap = (map, n) => new RegExp('(^|\n)(- )?' + n + '[:,.]|[ ,]' + n + '[,.]', '').test(map);
const heroFull = mapOf(ORDERS_FULL), heroShort = mapOf(ORDERS_SHORT);
const lostH = TOOL_NAMES.filter(n => !heroFull.includes('- ' + n + ': ')), lostHs = TOOL_NAMES.filter(n => !inMap(heroShort, n));
ok(!lostH.length, 'every hero tool (' + TOOL_NAMES.length + ') is in the full hero tool map' + (lostH.length ? ': missing ' + lostH.join(', ') : ''));
ok(!lostHs.length, 'every hero tool is in the local (names only) map' + (lostHs.length ? ': missing ' + lostHs.join(', ') : ''));
const dmSys = withToolMap(dmSystemPrompt({}), 'dm'), dmMap = mapOf(dmSys), lostD = DM_TOOL_NAMES.filter(n => !dmMap.includes('- ' + n + ': '));
ok(!lostD.length, 'every DM tool (' + DM_TOOL_NAMES.length + ') is in the DM tool map' + (lostD.length ? ': missing ' + lostD.join(', ') : ''));
ok(withToolMap(dmSys, 'dm') === dmSys && withToolMap(dmSys, 'dm', true).includes(MAP_HEAD) && withToolMap(dmSys, 'dm', true).split(MAP_HEAD).length === 2, 'the DM map swaps in place and never duplicates');
const stale = [...Object.values(HERO_GROUPS).flat().filter(n => !TOOL_NAMES.includes(n)), ...Object.values(DM_GROUPS).flat().filter(n => !DM_TOOL_NAMES.includes(n))];
ok(!stale.length, 'every name in the map groups is a real tool' + (stale.length ? ': ' + stale.join(', ') : ''));
const dups = a => a.filter((n, i) => a.indexOf(n) !== i);
ok(!dups(Object.values(HERO_GROUPS).flat()).length && !dups(Object.values(DM_GROUPS).flat()).length, 'no tool is listed in two groups');
ok(heroFull.length <= MAP_BUDGET_CHARS && dmMap.length <= MAP_BUDGET_CHARS, 'the maps stay inside the budget: hero ' + heroFull.length + ', DM ' + dmMap.length + ' of ' + MAP_BUDGET_CHARS + ' characters');
console.log('     (tools not yet in a group, listed under More tools: hero [' + ungrouped('hero').join(', ') + '], DM [' + ungrouped('dm').join(', ') + '])');
if (bad) {console.log(`\norderscheck: ${bad} failed`); process.exit(1)} else console.log('\norderscheck: all ok');

