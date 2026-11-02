// Townsfolk in the agents' turns (owner request): who is about, arrival news, hails. No model is called.
//   the pace brief lists nearby people with hooks; the arrival news fires once per visit; a hail opens a conversation and
//   wakes the member; no hail for a scripted hero; a world with and without a Fellowship is deterministic (a seeded hash).
// Usage: npm run localscheck   (node scripts/localscheck.mjs --hash [--nofellowship] prints one world hash and exits)
import {execFileSync} from 'node:child_process';

const HASH = process.argv.includes('--hash'), NOFELLOW = process.argv.includes('--nofellowship');
let seed = 0x9e3779b9 ^ 231;
Math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296};

const {init, step, S} = await import('../src/sim/index.js');
const {paceBrief, paceCheck} = await import('../src/sim/pace.js');
const {localsNear, localsTick, LOC} = await import('../src/sim/locals.js');
const {hash} = await import('../src/core/rng.js');
const {CITY} = await import('../src/world/map.js');

const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};

if (HASH) {
  init(NOFELLOW ? {fellowship: false} : {}); run(240);
  let h = 2166136261;
  const mix = s => {for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0};
  mix(String(Math.round(S.gameMin))); for (const a of S.agents) mix(a.id + a.state + a.lvl + Math.round(a.x * 10) + ',' + Math.round(a.y * 10) + a.hp);
  mix(JSON.stringify(S.talks || null)); mix(String(S.agents.reduce((n, a) => n + (a.playEv ? a.playEv.length : 0), 0)));
  console.log('HASH ' + h); process.exit(0);
}

let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
console.log('\nEldmoor localscheck: townsfolk in the agents\' turns\n');
init({}); run(2);
const mem = S.agents.find(a => a.fellow && a.player);
ok(!!mem, 'a Fellowship member is agent-played: ' + (mem && mem.name));
const home = CITY.find(c => c.fac === mem.fac) || CITY[0];
const place = (a, c, dx = 0) => {a.state = 'town'; a.dest = null; a.x = c.spots.square.x + dx; a.y = c.spots.square.y; a.hp = 1e9; a.visit = null};
const events = a => (a.playEv || []).filter(e => /^In .+: .* about\.$/.test(e.text));

// ---- arrival news: once per visit ----
mem.playEv = []; place(mem, home); mem.lvl = 8;
const before = events(mem).length;
localsTick(LOC.EVERY + .1);
ok(events(mem).length === before + 1, 'arrival news fires on reaching ' + home.name + ': ' + (events(mem).slice(-1)[0] || {}).text);
for (let i = 0; i < 5; i++) localsTick(LOC.EVERY + .1);
ok(events(mem).length === before + 1, 'and not again during the same visit');
const arrival = events(mem).slice(-1)[0];
ok(arrival && arrival.u === 1 && arrival.w === 1, 'it is a soft wake (urgent, w=1)');
mem.state = 'hunt'; localsTick(LOC.EVERY + .1); ok(!mem.visit, 'leaving town ends the visit');
place(mem, home); localsTick(LOC.EVERY + .1);
ok(events(mem).length === before + 2, 'a new visit gets its own news');

// ---- the header ----
const b = paceBrief(mem.id).brief;
ok(Array.isArray(b.nearby) && b.nearby.length > 0 && b.nearby.length <= LOC.MAX, 'the state header lists ' + b.nearby.length + ' people about');
ok(b.nearby.every(x => /\(.+\)$/.test(x) || !/\(/.test(x)), 'with short hooks: ' + b.nearby.join(' | '));
ok(!JSON.stringify(b.nearby).match(/want|secret|note|mood|warmth/i), 'and no wants, notes or secrets');
const far = S.agents.find(a => !a.fellow && !a.player && a.state === 'hunt' && !CITY.some(c => Math.hypot(a.x - c.x0, a.y - c.y0) < 20));
if (far) {const keep = {x: far.x, y: far.y}; far.player = true; const nb = paceBrief(far.id).brief.nearby; far.player = false; ok(nb.length === 0, 'nobody listed for a hero far from any person'); far.x = keep.x}

// ---- a hail ----
const talks0 = (S.talks && S.talks.stats.opened) || 0;
const innkeeper = S.npcs.find(p => p.town === home.name && p.role === 'innkeeper') || S.npcs.find(p => p.town === home.name);
S.adventures.push({id: ++S.uid, phase: 'open', town: home.name, fac: home.fac, tpl: Object.keys((await import('../src/data/adventures.js')).ADVENTURES).find(k => k !== 'fallen'), src: 'request', giver: null, zone: null, for: null, data: {}, born: S.gameMin, until: S.gameMin + 600});
// choose an arrival time whose hash yields a hail, then stand beside the innkeeper
let at = Math.round(S.gameMin) - 60; while (hash(mem.id, at, 3) >= LOC.CHANCE) at--;
innkeeper.x = mem.x + 1; innkeeper.y = mem.y; innkeeper.home = {x: innkeeper.x, y: innkeeper.y}; innkeeper.post = {x: innkeeper.x, y: innkeeper.y};
mem.visit = {town: home.name, at, news: 1, hail: 0}; mem.playEv = []; mem.playEvSeen = mem.playEvN || 0;
localsTick(LOC.EVERY + .1);
const hailEv = (mem.playEv || []).find(e => /calls to you/.test(e.text));
ok(!!hailEv, 'a townsperson hails the member: ' + (hailEv && hailEv.text));
ok(hailEv && hailEv.u === 1 && hailEv.w === 1, 'as a soft wake');
ok(S.talks && S.talks.cur.some(c => c.npc === innkeeper.id && c.heroes.includes(mem.id) && c.hail), 'a conversation is open with the hailer');
ok((mem.chat || []).some(e => e.from && e.from.id === innkeeper.id), 'the line reached the member as chat');
const w = paceCheck(mem.id, {since: S.gameMin, wake: 'all'});
ok(w && w.wake === 'soft' && /calls to you/.test(w.why), 'the member\'s runner wakes: ' + (w && w.wake));
for (let i = 0; i < 5; i++) localsTick(LOC.EVERY + .1);
ok((mem.playEv || []).filter(e => /calls to you/.test(e.text)).length === 1, 'at most one hail per visit');
const { talkTo } = await import('../src/sim/talk.js');
const rep = talkTo(mem, innkeeper, 'Good day. What news?');
ok(rep && !rep.error, 'the member can answer with talk: ' + JSON.stringify(rep).slice(0, 90));

// ---- no hail for a scripted hero ----
const scripted = S.agents.find(a => !a.fellow && !a.player && a.state !== 'dead' && a.fac === home.fac);
const opened = S.talks.stats.opened;
place(scripted, home); scripted.x = innkeeper.x; scripted.y = innkeeper.y + .5; scripted.lvl = 8; innkeeper.x = scripted.x; innkeeper.y = scripted.y - 1;
for (let i = 0; i < 4; i++) localsTick(LOC.EVERY + .1);
ok(!scripted.visit && S.talks.stats.opened === opened && !(scripted.playEv && scripted.playEv.length), 'a scripted hero is not hailed and gets no news');

// ---- determinism ----
const hashOf = args => execFileSync(process.execPath, ['scripts/localscheck.mjs', '--hash', ...args], {encoding: 'utf8'}).match(/HASH (\d+)/)[1];
const f1 = hashOf([]), f2 = hashOf([]), n1 = hashOf(['--nofellowship']), n2 = hashOf(['--nofellowship']);
ok(f1 === f2, 'a seeded Fellowship world is deterministic (' + f1 + ')');
ok(n1 === n2, 'a seeded world without a Fellowship is deterministic (' + n1 + ')');

console.log(fail ? `\n${fail} check(s) FAILED\n` : '\nAll localscheck checks passed.\n');
process.exit(fail ? 1 : 0);
