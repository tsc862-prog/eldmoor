// Hero standing orders by situation (#531): every heading, the priority list, the worked turns, the anti-patterns and the
// short local variant (under its size budget) are present; migration swaps and never duplicates; the persona block survives;
// every tool the orders name exists today. Prose only: no game, no network.
import {systemPrompt, withSituationOrders} from './agent-player.mjs';
import {fellowshipPrompt} from './fellowship.mjs';
import {withPersona} from './pacing.mjs';
import {ORDERS_FULL, ORDERS_SHORT, SHORT_BUDGET, SITUATION_HEADINGS, PRIORITY_HEADING, EXAMPLES_HEADING, ANTI_HEADING, ORDERS_HEAD, ORDERS_TAIL} from './orders.mjs';
import {TOOL_NAMES} from '../src/data/player-tools.js';

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

ok(ORDERS_SHORT.length <= SHORT_BUDGET, `the local variant is ${ORDERS_SHORT.length} characters (budget ${SHORT_BUDGET})`);
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

// the tools the orders name exist (intent does not exist yet)
const names = new Set(TOOL_NAMES);

