// The hero card's Agent tab (issue #75): what the AI agent playing this hero is doing. The
// bridge state, the command it runs, a scene choice waiting for it, the agent's narration (sent
// by the runner, scripts/agent-player.mjs), its latest tool calls with their results, and the
// hero's journal. Everything is read from plain data on the hero (sim/player.js).
import {bridgeStatus,bridgeUrl,runnerTag} from './player-bridge.js';
import {mindLabel,linkOf} from './mindlabel.js'; // the one mind label (issue #136)
import {byDay,stampOf} from './daystamp.js'; // game day on times
import {S} from '../sim/index.js';
import {keyed} from './stable.js'; // lists keep their node (and scroll) when a line is added above them
import {runnerControl} from './runners.js'; // app runners: Start / Stop from the page
import {reflectView} from '../sim/reflect.js'; // reflection moments (#179)

const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
const STATUS={connected:'connected to the relay',connecting:'connecting to the relay…',offline:'relay not reachable (start npm run relay, then npm run agent)',off:'not connected'};

const LINK={connected:['live','a runner holds this hero (calling tools, thinking or between turns)'],waiting:['live','a runner holds this hero (calling tools, thinking or between turns)'],busy:['Ollama busy','the local model is busy or loading; the runner waits for it'],none:['no runner','start one: npm run agent -- --hero ']};

export const hasAgent=a=>!!(a&&(a.player||(a.playLog&&a.playLog.length)||(a.journal&&a.journal.length)));

export function tabAgent(b,a){
  if(a.player){const st=bridgeStatus();b.append(el('div','meta','Agent-played · bridge '+(STATUS[st]||st)+(st==='connected'?'':' · '+bridgeUrl())));
    // the runner bound to this hero (issue #93: one agent per hero, several side by side)
    if(st==='connected'){const k=linkOf(a),t=LINK[k]||[k,''],d=el('div','meta');d.append(el('span','mk-line',mindLabel(a).text),' · ',el('span','mlink '+(k==='waiting'?'connected':k),t[0]),' · '+t[1]+(k==='none'?a.name+', or press Start runner':''));b.append(d)}
    const rc=el('div','meta');rc.append('Runner: ',runnerControl(a));b.append(rc)}
  else b.append(el('div','meta','No longer agent-played. What the agent did and wrote:'));
  if(a.playDoing)b.append(el('div','doing',a.playDoing));
  // who acts (issue #126): the agent's orders, or autopilot carrying on while it is silent; never the scripted rules
  {const R=reflectView(a);if(a.player&&R){const l=R.last;b.append(el('div','meta','Reflections today: '+R.today+'/'+R.perDay+(l?' · last: '+l.why+' (day '+l.day+'), '+l.wrote+' memor'+(l.wrote===1?'y':'ies')+' written':'')+(R.due?' · due now: '+R.due.why:'')))}}
  if(a.player&&a.memories){const fresh=a.memories.notes.filter(n=>S.gameMin-(n.gm??-1e9)<=360).slice(-3);if(fresh.length)b.append(el('div','meta','New memories: '+fresh.map(n=>'#'+n.id+' '+n.title+(n.rf?' (reflection)':'')).join(' · ')))}
  if(a.player&&a.playActAt!=null){const m=Math.max(0,Math.round(S.gameMin-a.playActAt));b.append(el('div','meta','Last agent order: '+(m<60?m+' game min':Math.round(m/60)+' game h')+' ago'+(a.playIdle?' · autopilot is carrying on until the agent acts':'')))}
  const adv=a.adv&&S.adventures?S.adventures.find(v=>v.id===a.adv&&v.phase==='active'):null,p=adv&&adv.stage==='choose'&&adv.pick;
  if(p&&!p.chosen){const d=el('div','meta adv');d.append('Choice waiting: '+p.frame+' — a) '+p.opts.a+' · b) '+p.opts.b+' ('+Math.max(0,Math.round(p.until-S.gameMin))+' min left)');b.append(d)}
  const narr=(a.playNarr||[]).slice(0,5);
  if(narr.length){b.append(el('div','dm','Narration'));const ul=keyed(el('ul','log'),'agent-narr');byDay(ul,narr,n=>{const li=el('li');li.append(el('time',null,stampOf(n)),n.text);return li});b.append(ul)}
  const calls=(a.playLog||[]).slice(0,15);
  b.append(el('div','dm','Tool calls'));
  if(!calls.length)b.append(el('div','dm','None yet. Run npm run agent (or connect any MCP client to http://127.0.0.1:8787/mcp).'));
  else{const ul=keyed(el('ul','log agentlog'),'agentlog');byDay(ul,calls,c=>{const li=el('li');li.append(el('time',null,stampOf(c)),el('span',c.ok?'gd':'dm',c.tool+(c.args?' '+c.args:'')),' → '+(c.text||''));return li});b.append(ul)}
  const j=(a.journal||[]).slice().reverse().slice(0,10);
  b.append(el('div','dm','Journal'));
  if(!j.length)b.append(el('div','dm','No entries yet.'));
  else for(const e of j){const d=el('p','bio');d.append(el('span','dm',stampOf(e)+' · '),e.text);b.append(d)}}
