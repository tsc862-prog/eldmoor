// #954: with a host that reports links, company members and agent heroes are never enrolled by the guild script;
// guild_found / guild_join are their own choice.
import {init, step} from '../src/sim/index.js';
import {S} from '../src/sim/state.js';
import {setRunnerLinks} from '../src/sim/runlink.js';
import {guildsTick, guildJoinFor, guildFoundFor, guildLeaveFor, guildWord} from '../src/sim/guilds.js';
let bad = 0;
const ok = (c, m) => {console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++};
init();
setRunnerLinks(() => 'connected');
const mine = S.agents.filter(a => a.company != null || a.player);
ok(mine.length > 0, 'company members exist: ' + mine.length);
for (let i = 0; i < 4000; i++) step(1);
ok(mine.every(a => !a.guild), 'no company member or agent hero was enrolled by script');
ok(S.agents.some(a => a.guild), 'background heroes still form guilds');
const a = mine[0]; a.lvl = Math.max(a.lvl, 3);
const f = guildFoundFor(a);
ok(f.ok || /needs three/.test(f.why), 'guild_found answers: ' + (f.ok ? f.founded : f.why));
if (!a.guild) {const j = guildJoinFor(a); ok(j.ok && (j.choose || j.joined) || /No guild/.test(j.why), 'guild_join lists or refuses: ' + JSON.stringify(j).slice(0, 120))}
// hint and leave
a.guild = null; a.lvl = 3; a.guildHintAt = undefined;
const w = guildWord(a);
ok(w === null || /guild_join/.test(w), 'guild word is words only: ' + String(w).slice(0, 80));
ok(!a.guild, 'the hint joined nothing');
if (w) ok(guildWord(a) === null, 'hint not repeated within days');
a.lvl = 2; a.guildHintAt = undefined; ok(guildWord(a) === null, 'no hint below level 3');
a.lvl = 3; const j2 = guildJoinFor(a, S.GUILDS.find(g => !g.retired && g.fac === a.fac)?.tag);
if (j2.joined) {ok(a.guild, 'joined'); const l = guildLeaveFor(a); ok(l.ok && !a.guild, 'guild_leave: ' + l.left); ok(!guildLeaveFor(a).ok, 'leave with no guild refused')}
process.exit(bad ? 1 : 0);
