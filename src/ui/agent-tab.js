// The hero card's Agent tab (issue #75): what the AI agent playing this hero is doing. The
// bridge state, the command it runs, a scene choice waiting for it, the agent's narration (sent
// by the runner, scripts/agent-player.mjs), its latest tool calls with their results, and the
// hero's journal. Everything is read from plain data on the hero (sim/player.js).
import {bridgeStatus,bridgeUrl} from './player-bridge.js';
import {S} from '../sim/index.js';

const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
const STATUS={connected:'connected to the relay',connecting:'connecting to the relay…',offline:'relay not reachable (start npm run relay, then npm run agent)',off:'not connected'};

export const hasAgent=a=>!!(a&&(a.player||(a.playLog&&a.playLog.length)||(a.journal&&a.journal.length)));

export function tabAgent(b,a){
  if(a.player){const st=bridgeStatus();b.append(el('div','meta','Agent-played · bridge '+(STATUS[st]||st)+(st==='connected'?'':' · '+bridgeUrl())))}
  else b.append(el('div','meta','No longer agent-played. What the agent did and wrote:'));
  if(a.playDoing)b.append(el('div','doing',a.playDoing));
  const adv=a.adv&&S.adventures?S.adventures.find(v=>v.id===a.adv&&v.phase==='active'):null,p=adv&&adv.stage==='choose'&&adv.pick;
  if(p&&!p.chosen){const d=el('div','meta adv');d.append('Choice waiting: '+p.frame+' — a) '+p.opts.a+' · b) '+p.opts.b+' ('+Math.max(0,Math.round(p.until-S.gameMin))+' min left)');b.append(d)}
  const narr=(a.playNarr||[]).slice(0,5);
  if(narr.length){b.append(el('div','dm','Narration'));const ul=el('ul','log');for(const n of narr){const li=el('li');li.append(el('time',null,n.t),n.text);ul.append(li)}b.append(ul)}
  const calls=(a.playLog||[]).slice(0,15);
  b.append(el('div','dm','Tool calls'));
  if(!calls.length)b.append(el('div','dm','None yet. Run npm run agent (or connect any MCP client to http://127.0.0.1:8787/mcp).'));
  else{const ul=el('ul','log agentlog');for(const c of calls){const li=el('li');li.append(el('time',null,c.t),el('span',c.ok?'gd':'dm',c.tool+(c.args?' '+c.args:'')),' → '+(c.text||''));ul.append(li)}b.append(ul)}
  const j=(a.journal||[]).slice().reverse().slice(0,10);
  b.append(el('div','dm','Journal'));
  if(!j.length)b.append(el('div','dm','No entries yet.'));
  else for(const e of j){const d=el('p','bio');d.append(el('span','dm',e.t+' · '),e.text);b.append(d)}}
