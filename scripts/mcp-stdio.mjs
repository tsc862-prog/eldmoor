// Agent player, stdio MCP entry (issue #75): `npm run mcp` for MCP clients that prefer to
// launch a stdio server. It serves the same tools as /mcp and forwards every call to the
// running relay (npm run relay, the browser game) or headless host (npm run play-headless)
// at PLAY_URL (default http://127.0.0.1:8787) through POST /play/call. stdout carries the
// MCP protocol only; logs go to stderr.
//
// Example client config:  {"command": "npm", "args": ["run", "-s", "mcp"], "cwd": "<repo>",
//                          "env": {"PLAY_URL": "http://127.0.0.1:8787"}}
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {buildMcp} from './relay-mcp.mjs';

const base = (process.env.PLAY_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
async function call(tool, args) {
  try {
    const r = await fetch(base + '/play/call', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({tool, args}), signal: AbortSignal.timeout(90000)});
    return await r.json();
  } catch (e) {return {ok: false, offline: true, error: `Cannot reach the game at ${base} (${e.message}). Start npm run relay and open the game, or npm run play-headless.`}}
}
const server = buildMcp(call);
await server.connect(new StdioServerTransport());
console.error(`[mcp] eldmoor player tools on stdio -> ${base}`);
