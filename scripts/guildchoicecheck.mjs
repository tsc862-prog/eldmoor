// #954: with a host that reports links, company members and agent heroes are never enrolled by the guild script;
// guild_found / guild_join are their own choice.
import {init, step} from '../src/sim/index.js';
import {S} from '../src/sim/state.js';
import {setRunnerLinks} from '../src/sim/runlink.js';
import {guildsTick, guildJoinFor, guildFoundFor} from '../src/sim/guilds.js';
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
process.exit(bad ? 1 : 0);
