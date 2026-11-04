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
import {rulesOf,gambitRec,ruleText,noFlee,gambitDiff} from '../sim/gambits.js'; // the hero's own rules (#617) and how they differ from the preset (#679), read only

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
  if(a.player&&a.wishes&&a.wishes.length){const d=el('details','meta');d.append(el('summary',null,'Wishes for the builders: '+a.wishes.length));for(const w of a.wishes)d.append(el('div','dm','D'+w.day+' '+w.clock+' · '+w.tool+': '+w.what+' Why: '+w.why+' Moment: '+w.moment));b.append(d)}
  if(a.player)gambitBlock(b,a);
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

// Gambits (#617): the hero's ordered rules, the one that fired last highlighted, and the last edits. View only: the agent
// edits them through its tools; the owner's lever stays the persona pins.
// How the list differs from the class preset (#679, gambitDiff in sim/gambits.js): one summary line under the heading, a
// mark per rule (+ added, ~ changed, ^ / v moved, off turned off), the preset rules the agent dropped listed last struck
// through, the safety rules (flee, potion, defend) flagged when weakened or gone. Hover a marked rule: what changed, the
// preset's version and the edit's day and why.
const SAFE_WORD={flee:'flee',potion:'potion',defend:'defend'},SAFE_HOW={off:'turned off',gone:'gone',weakened:'weakened'};
const SAFE_WHY={flee:'nothing breaks this hero off a losing fight',potion:'it drinks no potion by itself in a fight',defend:'it does not strike back by itself'};
export const gambitSummary=a=>{const D=gambitDiff(a);return D.summary.charAt(0).toUpperCase()+D.summary.slice(1)};
const markOf=r=>(r.status==='added'?'+':r.status==='changed'?'~':r.status==='off'?'off':'')+(r.moved==='up'?'^':r.moved==='down'?'v':'');
function tipOf(r,D){const t=[];
  if(r.status==='added')t.push('Added by the agent (not in the '+D.cls+' preset).');
  if(r.status==='changed')t.push(r.preset&&r.preset.rule===r.rule?'Turned '+(r.on?'on':'off')+' (the preset has it '+(r.preset.on?'on':'off')+').':'Changed from the preset.');
  if(r.status==='off')t.push('Turned off (on in the preset).');
  if(r.moved)t.push('Moved '+r.moved+': place '+r.order+' here, '+r.preset.order+' in the preset.');
  if(r.preset&&(r.status==='changed'||r.status==='off'))t.push('Preset: #'+r.preset.id+' '+r.preset.rule+(r.preset.on?'':' (off)'));
  if(r.status==='dropped')t.push('In the '+D.cls+' preset; the agent dropped it.');
  if(r.safety&&r.status!=='same'&&r.status!=='added')t.push('A safety rule ('+r.safety+').');
  if(r.edit)t.push('Day '+r.edit.day+': '+r.edit.text+(r.edit.why?' · why: '+r.edit.why:' · no reason given'));
  return t.join('\n')}
function gambitBlock(b,a){const L=rulesOf(a),g=gambitRec(a),last=g&&g.last,D=gambitDiff(a),byId=new Map(D.rules.map(r=>[r.id,r]));
  const head=el('div','dm','Gambits'+(a.gambits?' (own list)':' (class preset)'));b.append(head);
  b.append(el('div','meta gbsum'+(D.unchanged?'':' gbdiff'),gambitSummary(a)));
  if(last){const r=L.find(x=>x.id===last.id);b.append(el('div','meta','Fired by gambit: '+(r?ruleText(r):last.when+' -> '+last.then)+(r&&byId.get(r.id)&&/^(added|changed)$/.test(byId.get(r.id).status)?' (its own rule)':'')+' · '+Math.max(0,Math.round(S.gameMin-last.at))+' game min ago'))}
  for(const k of Object.keys(D.safety))b.append(el('div','meta warn','The '+SAFE_WORD[k]+' rule is '+SAFE_HOW[D.safety[k]]+(D.safety[k]==='weakened'?'':': '+SAFE_WHY[k])+'.'));
  if(noFlee(a)&&!D.safety.flee)b.append(el('div','meta warn','No flee rule: nothing breaks this hero off a losing fight.'));
  const ol=el('ol','log gambits');
  for(const r of L){const d=byId.get(r.id)||{status:'same'},m=markOf(d),hold=S.gambitHold&&S.gambitHold.id===a.id&&S.gambitHold.rid===r.id;
    const li=el('li',['gb-'+d.status,d.moved?'gb-moved':'',r.on===false?'dm':'',last&&last.id===r.id?'gd':'',d.safety&&d.status!=='same'&&d.status!=='added'?'gbsafe':''].filter(Boolean).join(' '));
    li.setAttribute('data-k','g'+r.id);li.append(el('span','gbm',m),'#'+r.id+' '+ruleText(r)+(r.on===false?' (off)':'')+(hold?' (HOLDING THE WORLD)':''));
    if(m){li.title=tipOf(d,D);li.tabIndex=0}ol.append(li)}
  for(const r of D.dropped){const li=el('li','gb-dropped'+(r.safety?' gbsafe':''));li.setAttribute('data-k','gd'+r.id);
    li.append(el('span','gbm','-'),el('s',null,'#'+r.id+' '+r.rule+(r.on?'':' (off)')));li.title=tipOf(r,D);li.tabIndex=0;ol.append(li)}
  b.append(ol);
  const H=(a.gambitHist||[]).slice(-3).reverse();if(H.length)b.append(el('div','meta','Edits: '+H.map(h=>'day '+h.d+' '+h.text+(h.safety?' [safety]':'')+(h.why?' ('+h.why+')':'')).join(' · ')))}
