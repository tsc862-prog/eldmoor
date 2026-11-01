// Agent player, stdio MCP entry (issues #75, #93): `npm run mcp` for MCP clients that prefer to
// launch a stdio server. It serves the same tools as /mcp and forwards every call to the
// running relay (npm run relay, the browser game) or headless host (npm run play-headless)
// at PLAY_URL (default http://127.0.0.1:8787) through POST /play/call. With several agent heroes,
// PLAY_HERO (a hero id) binds this server to one of them; without it calls go to the first
// living agent hero. A hero a runner has claimed answers only that runner (issue #123): PLAY_RUNNER
// names the runner id this server speaks for. stdout carries the MCP protocol only; logs go to stderr.
//
// Example client config:  {"command": "npm", "args": ["run", "-s", "mcp"], "cwd": "<repo>",
//                          "env": {"PLAY_URL": "http://127.0.0.1:8787", "PLAY_HERO": "12"}}
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {buildMcp, heroParam} from './relay-mcp.mjs';

const base = (process.env.PLAY_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const hero = heroParam(process.env.PLAY_HERO), runner = process.env.PLAY_RUNNER || null;
if (Number.isNaN(hero)) {console.error('[mcp] PLAY_HERO must be a numeric hero id'); process.exit(1)}
async function call(tool, args) {
  try {
    const r = await fetch(base + '/play/call', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({...(hero != null ? {hero} : {}), tool, args, ...(runner ? {runner} : {})}), signal: AbortSignal.timeout(90000)});
    return await r.json();
  } catch (e) {return {ok: false, offline: true, error: `Cannot reach the game at ${base} (${e.message}). Start npm run relay and open the game, or npm run play-headless.`}}
}
const server = buildMcp(call);
await server.connect(new StdioServerTransport());
console.error(`[mcp] eldmoor player tools on stdio -> ${base}${hero != null ? ' (hero #' + hero + ')' : ''}`);
