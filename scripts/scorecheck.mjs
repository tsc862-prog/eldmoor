// Score growth chosen by agent heroes (issue #714): at levels 5/10/15/20 an agent-played hero with a runner
// places its point with raise_score; a scripted hero or a runner-less one grows by class priority at once;
// a silent agent gets the default after GROWTH.HOLD game hours; the choice survives a save and reaches the stats cache.
// Usage: npm run scorecheck
const SIM = await import('../src/sim/index.js');
const {init, step, S, snapshot, restore, maxHp} = SIM;
const P = await import('../src/sim/player.js');
const HE = await import('../src/sim/heroes.js');
const PC = await import('../src/sim/pace.js');
const RL = await import('../src/sim/runlink.js');
const {combatStats} = await import('../src/sim/stats.js');
const {baseScore} = await import('../src/sim/abilities.js');
const {GROWTH, SCORE_MAX} = await import('../src/data/abilities.js');
let fail = 0;
const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const run = s => {for (let i = 0; i < s * 60; i++) step(1 / 60)};
const call = (a, tool, args) => P.playerAct(a.id, tool, args);

console.log('\nEldmoor scorecheck: agent heroes choose their score growth\n');
init({fellowship: false}); run(1);
const pool = S.agents.filter(x => x.kind === 'hero' && x.state !== 'dead' && !x.player && !x.hidden);
const [a, b, c] = pool;
for (const h of [a, b, c]) {h.lvl = 4; h.xp = 0; h.hp = maxHp(h)}
// level a hero to exactly 5: give XP up to the threshold only
const levelTo5 = h => {h.lvl = 4; h.xp = Math.ceil(HE.xpNeed(4)); HE.gainXp(h, 0)};

// scripted hero: automatic, nothing pending
const before = {...b.abil}; levelTo5(b);
ok(b.lvl === 5 && !b.growPending, 'a scripted hero grows at once and has nothing pending');
ok(Object.keys(before).some(k => b.abil[k] !== before[k]), 'its class-priority growth was applied');

// agent hero with a runner: pending
P.markPlayer(a, true); RL.setRunnerLinks(x => 'connected');
const a0 = {...a.abil}; levelTo5(a);
ok(a.lvl === 5 && a.growPending && a.growPending.length === 1 && a.growPending[0].lvl === 5, 'an agent hero with a runner has a point waiting');
ok(JSON.stringify(a.abil) === JSON.stringify(a0), 'nothing grew yet');
const ev = (a.playEv || []).map(e => e.text).join(' | ');
ok(/raise_score/.test(ev), 'the level-up wake names raise_score');
ok(/raise_score/.test(PC.paceBrief(a.id).brief.growth || ''), 'the state header carries the pending choice');

// refusals
let r = call(a, 'raise_score', {score: 'luck', why: 'x'}); ok(r && r.ok === false || (r && r.error), 'unknown score refused: ' + JSON.stringify(r).slice(0, 80));
r = call(a, 'raise_score', {score: 'wits'}); ok(r && (r.ok === false || r.error), 'no reason refused');
a.abil.wits = SCORE_MAX;
r = call(a, 'raise_score', {score: 'wits', why: 'x'}); ok(r && (r.ok === false || r.error) && /cap/.test(JSON.stringify(r)), 'a score at the cap is refused');
ok(a.abil.wits === SCORE_MAX && a.growPending, 'a refusal changes nothing');
r = call(c, 'raise_score', {score: 'grit', why: 'x'}); ok(r && (r.ok === false || r.error), 'a scripted hero is refused');
a.abil.wits = 12;

// choice applied, and the stats cache sees it
a.abil.grit = 13; const s1 = combatStats(a).health;
r = call(a, 'raise_score', {score: 'Grit', why: 'to last longer'});
ok(r && r.ok !== false && !r.error, 'a choice is applied: ' + JSON.stringify(r).slice(0, 100));
ok(a.abil.grit === 14 && !a.growPending, 'the point went to Grit and nothing waits');
ok(combatStats(a).health > s1, 'the stats cache is rebuilt after a raise (' + s1 + ' -> ' + combatStats(a).health + ')');
r = call(a, 'raise_score', {score: 'grit', why: 'x'});
ok(r && (r.ok === false || r.error) && a.abil.grit === 14, 'a second call with nothing pending is refused');
ok((a.persona && a.persona.hist || []).some(e => /Grit/.test(e.after) && /to last longer/.test(e.why)), 'the choice is in the persona history');

// default after the grace period
P.markPlayer(c, true); levelTo5(c);
const c0 = {...c.abil}; ok(c.growPending, 'a second agent waits');
S.gameMin += GROWTH.HOLD * 60 - 120; run(1);
ok(c.growPending && JSON.stringify(c.abil) === JSON.stringify(c0), 'still waiting just before the hold ends');
S.gameMin += 180; run(1);
ok(!c.growPending && Object.keys(c0).some(x => c.abil[x] !== c0[x]), 'after the hold the class default is taken');
ok(c.persona.hist.some(e => /class default/.test(e.why)), 'the default is noted in the persona history');

// save / restore keeps a pending point
const e = pool[4]; P.markPlayer(e, true); levelTo5(e); const eid = e.id;
const snap = JSON.parse(JSON.stringify(snapshot())); restore(snap);
const back = S.agents.find(x => x.id === eid);
ok(back && back.growPending && back.growPending[0].lvl === 5, 'a waiting point survives a save');
const abilBack = {...back.abil}; RL.setRunnerLinks(x => 'connected');
r = P.playerAct(back.id, 'raise_score', {score: 'presence', why: 'after the save'});
ok(back.abil.presence === abilBack.presence + 1 || baseScore(back, 'presence') === SCORE_MAX, 'and can be spent after the restore');

// runner gone and the owner resumed: the default at once
RL.setRunnerLinks(null);
const f = pool[5]; P.markPlayer(f, true); levelTo5(f);
ok(!f.growPending, 'with no runner links the default is taken at once, like the scripted sim');

console.log(fail ? `\n${fail} check(s) failed` : '\nscorecheck: all checks passed');
process.exit(fail ? 1 : 0);
