// App runners, page side: start and stop agent runners from the game instead of a terminal per hero.
// The relay (npm run relay -- --runners, or start-eldmoor.cmd) runs them as child processes
// (scripts/runners.mjs); this module polls GET /play/runner on the same relay the bridge uses and
// sends POST /play/runner/start|stop. Runners have a kind ('hero', 'fellowship'; later 'dm'), a key
// ('hero:12', 'fellowship') and a state: starting, live, waiting, stopping, stopped, crashed.
//   runnerFor(a)               the runner playing hero a (its own, or the Fellowship's), or null
//   runnerByKey(key)           a runner by key
//   runnerControl(a)           a small control: state, provider/model and a Start / Stop button
//   fellowshipRunnerControl()  "Start all five" / "Stop all" with the Fellowship runner's state
//   runnerPick(key, models, openai)  a picker for the mind a runner is started with (saved, Claude, a local or OpenAI model)
//                              and its turn cap (local minds run until stopped unless a cap is set, issue #126)
//   runnerSig(a)               what the controls show, for the callers' rebuild signatures
//   initRunners(after)         one delegated handler for every control on the page
// When the relay runs without --runners the controls say how to turn it on; the world never waits on any of this.
import {bridgeUrl} from './player-bridge.js';
import {S,playerSeats} from '../sim/index.js';

const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
let info=null,up=null,fetchedAt=0,inFlight=false,note={},picks={},turnPicks={},onUpdate=()=>{},lastSig='';
const base=()=>bridgeUrl().replace(/^ws(s?):/,'http$1:').replace(/\/play\/?$/,'')+'/play/runner';
const DONE={stopped:1,crashed:1};
export const RUN_TEXT={starting:'starting…',live:'live',waiting:'waiting',stopping:'stopping…',stopped:'stopped',crashed:'crashed'};
export const HOW_TEXT='Runners are off: start the relay with --runners (npm run relay -- --runners, or start-eldmoor.cmd).';

// want: poll even with no agent-played hero (the Fellowship panel); now: skip the wait (after a start or stop)
function poll(want,now){want=want||playerSeats().length>0;if(!want||inFlight||typeof fetch!=='function')return;
  const live=info&&info.runners&&info.runners.some(r=>!DONE[r.state]);if(!now&&Date.now()-fetchedAt<(live?2000:5000))return;
  inFlight=true;fetchedAt=Date.now();
  fetch(base()).then(r=>r.json()).then(j=>{info=j&&typeof j==='object'?j:null;up=!!info}).catch(()=>{info=null;up=false})
    .finally(()=>{inFlight=false;const k=JSON.stringify([up,info]);if(k!==lastSig){lastSig=k;onUpdate()}})}
export const runnersEnabled=()=>!!(info&&info.enabled);
export const runnerByKey=k=>info&&info.runners?info.runners.find(r=>r.key===k)||null:null;
export function runnerFor(a){if(!a||!info||!info.runners)return null;const own=runnerByKey('hero:'+a.id);
  if(own&&!DONE[own.state])return own;const any=info.runners.find(r=>!DONE[r.state]&&Array.isArray(r.heroes)&&r.heroes.includes(a.id));return any||own}
export const runnerSig=a=>{poll();const k=a?'hero:'+a.id:'fellowship',r=a?runnerFor(a):runnerByKey('fellowship');return (r?r.key+':'+r.state+':'+r.turns+':'+(r.model||''):'-')+':'+(note[k]||'')+':'+up+':'+(info?info.enabled:'?')+':'+(picks[k]||'')+':'+(turnPicks[k]||'')};

async function send(path,body){
  try{const r=await fetch(base()+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));
    return r.ok?{ok:true,runner:j.runner}:{ok:false,error:j.how||j.error||('HTTP '+r.status)}}
  catch(e){return {ok:false,error:'The relay is not reachable (start it: npm run relay -- --runners).'}}}
// pick: '' (the hero's saved mind), 'anthropic', 'ollama:<model>' or 'openai:<model>'
const pickBody=k=>{const p=picks[k]||'',t=turnPicks[k]?{maxTurns:Number(turnPicks[k])}:{};return {...(p==='anthropic'?{provider:'anthropic'}:p.startsWith('anthropic:')?{provider:'anthropic',model:p.slice(10)}:p.startsWith('ollama:')?{provider:'ollama',model:p.slice(7)}:p.startsWith('openai:')?{provider:'openai',model:p.slice(7)}:{}),...t}};
export async function startRunner(kind,hero){const k=kind==='hero'?'hero:'+hero:kind;note[k]='';
  const r=await send('/start',{kind,...(hero!=null?{hero}:{}),...pickBody(k)});if(!r.ok)note[k]=r.error;poll(true,true);return r}
export async function stopRunner(kind,hero){const k=kind==='hero'?'hero:'+hero:kind;note[k]='';
  const r=await send('/stop',{key:k});if(!r.ok)note[k]=r.error;poll(true,true);return r}
export async function stopAllFellows(){const ids=(S.fellowship&&S.fellowship.ids)||[];await stopRunner('fellowship');
  for(const id of ids){const r=runnerByKey('hero:'+id);if(r&&!DONE[r.state])await stopRunner('hero',id)}}

const mindTag=r=>r&&(r.model||r.provider)?(r.model||r.provider)+(r.provider==='ollama'?' · local':r.provider==='openai'?' · openai':''):'';
function stateLine(r,k){if(note[k])return note[k];
  if(up===false)return 'relay offline';if(info&&!info.enabled)return HOW_TEXT;if(!r)return 'no runner';
  const bits=[RUN_TEXT[r.state]||r.state];const m=mindTag(r);if(m)bits.push(m);
  if(r.turns)bits.push(r.turns+' turn'+(r.turns===1?'':'s'));if(r.cost)bits.push('$'+r.cost.toFixed(3));
  // pacing (issue #126): turns per minute, the last turn's age, the cap
  if(r.turns&&r.turnsPerMin!=null)bits.push(r.turnsPerMin+'/min');if(r.lastTurnAgo!=null&&!DONE[r.state])bits.push('last '+ago(r.lastTurnAgo));if(r.turnCap&&!DONE[r.state])bits.push(r.turnCap);
  const other=r.provider==='ollama'&&r.model&&!DONE[r.state]?mindsLocal().find(m=>m!==r.model):null; // #126: two local models evict each other on one GPU
  if(other)bits.push('minds use '+other+': on one GPU the two models evict each other, use one');
  if(r.state==='crashed'&&r.error)bits.push(r.error);return bits.join(' · ')}
// The local models the relay's minds (AI-played heroes) use, refreshed every few seconds.
let mlAt=0,ml=[];
function mindsLocal(){if(Date.now()-mlAt<3000)return ml;mlAt=Date.now();const set=new Set();
  for(const a of S.brainHeroes||[]){const h=S.agents.find(x=>x.id===a);const c=h&&h.brain&&h.state!=='dead'&&h.brainCfg;if(c&&c.provider==='ollama'&&c.model)set.add(c.model)}
  return ml=[...set]}
const ago=s=>s<60?s+' s ago':s<3600?Math.round(s/60)+' min ago':Math.round(s/3600)+' h ago';
// the tooltip: what the runner's pacing waits for, then its last lines
const tip=(r,n)=>r?[r.pace?'pacing: '+r.pace:''].concat(r.lines?r.lines.slice(-n):[]).filter(Boolean).join('\n'):'';
function button(label,act,kind,hero,title){const b=el('button','mini runbtn',label);b.dataset.runact=act;b.dataset.runkind=kind;if(hero!=null)b.dataset.runhero=hero;if(title)b.title=title;return b}

// The control for one hero: Start / Stop and the runner's state. A hero played by the Fellowship
// runner shows that runner and stops it from the Fellowship panel.
export function runnerControl(a,{line=true}={}){poll();const d=el('span','runctl');if(!a||a.state==='dead'||!a.player)return d;
  const r=runnerFor(a),k='hero:'+a.id,on=r&&!DONE[r.state],fel=on&&r.kind!=='hero';
  if(fel)d.append(el('span','dm','Fellowship runner'));
  else if(on)d.append(button('Stop runner','stop','hero',a.id,'Stop this hero\'s agent runner (it lets go of the hero; reflexes play on)'));
  else{const b=button('Start runner','start','hero',a.id,info&&!info.enabled?HOW_TEXT:'Start an agent runner for '+a.name+' from the relay (no terminal needed)');if(info&&!info.enabled||up===false)b.classList.add('off');d.append(b)}
  if(line){const s=el('span','dm runstate r-'+(r&&!note[k]?r.state:'none'),' '+stateLine(r,k));s.title=tip(r,4);d.append(s)}
  return d}

export function fellowshipRunnerControl(){poll(true);const d=el('div','runctl fbar');const r=runnerByKey('fellowship'),on=r&&!DONE[r.state];
  const others=((S.fellowship&&S.fellowship.ids)||[]).some(id=>{const x=runnerByKey('hero:'+id);return x&&!DONE[x.state]});
  if(!on){const b=button('Start all five','start','fellowship',null,info&&!info.enabled?HOW_TEXT:'One runner plays every agent-played member (npm run fellowship, started by the relay)');if(info&&!info.enabled||up===false)b.classList.add('off');d.append(b)}
  if(on||others)d.append(button('Stop all','stopall','fellowship',null,'Stop the Fellowship runner and every member\'s own runner'));
  const s=el('span','dm runstate r-'+(r&&!note.fellowship?r.state:'none'),stateLine(r,'fellowship'));s.title=tip(r,6);d.append(s);
  return d}

// The DM agent's runner (#66): Start DM / Stop DM and its state, for the DM panel and the Minds panel's
// DM row (src/ui/dmseat.js). It plays no hero, so it polls whether or not a hero is agent-played.
export function dmRunnerControl(){poll(true);const d=el('span','runctl');const r=runnerByKey('dm'),on=r&&!DONE[r.state];
  if(on)d.append(button('Stop DM','stop','dm',null,'Stop the DM agent (it lets go of the seat; the scripted DM runs on)'));
  else{const b=button('Start DM','start','dm',null,info&&!info.enabled?HOW_TEXT:'Start the DM agent from the relay (npm run dm, no terminal needed)');if(info&&!info.enabled||up===false)b.classList.add('off');d.append(b)}
  const s=el('span','dm runstate r-'+(r&&!note.dm?r.state:'none'),' '+stateLine(r,'dm'));s.title=tip(r,6);d.append(s);
  return d}
export const dmRunnerSig=()=>{poll(true);const r=runnerByKey('dm');return (r?r.state+':'+r.turns+':'+(r.model||'')+':'+(r.error||''):'-')+':'+(note.dm||'')+':'+up+':'+(info?info.enabled:'?')+':'+(picks.dm||'')};

// The mind a runner starts with. models: pulled local models (from the relay's /health), may be empty.
export function runnerPick(k,models,openai){const s=el('select','msel');s.dataset.runpick=k;s.title='The mind the runner starts with (saved: what this hero used last, else Claude)';
  // Claude by model (the owner pays per model): Haiku is also what a runner started here plays when nothing is saved
  const opts=[['','saved mind (new: Claude Haiku)'],['anthropic:claude-haiku-5-5','Claude Haiku'],['anthropic:claude-sonnet-5-5','Claude Sonnet']].concat((models||[]).map(m=>['ollama:'+m,m+' · local'])).concat((openai||[]).map(m=>['openai:'+m,m+' · openai']));
  if(picks[k]&&!opts.some(o=>o[0]===picks[k]))opts.push([picks[k],picks[k].replace(/^(ollama|openai|anthropic):/,'')+(picks[k].startsWith('openai:')?' · openai':picks[k].startsWith('anthropic')?'':' · local')]);
  for(const [v,t] of opts){const o=new Option(t,v);if(v===(picks[k]||''))o.selected=true;s.append(o)}
  // the turn cap: by default a local mind plays until stopped, Claude and OpenAI stop at their default count (and budget)
  const c=el('select','msel');c.dataset.runturns=k;c.title='How many turns the runner plays before it stops (it also stops when the hero dies or after 5 empty turns in a row)';
  const loc=(picks[k]||'').startsWith('ollama:');
  for(const [v,t] of [['',loc?'until stopped':'default turns']].concat([5,10,20,50,100,200].map(n=>[String(n),n+' turns']))){const o=new Option(t,v);if(v===(turnPicks[k]||''))o.selected=true;c.append(o)}
  const w=el('span','runpick');w.append(s,' ',c);return w}

export function initRunners(after){const done=after||(()=>{});
  const act=async t=>{const k=t.dataset.runkind,h=t.dataset.runhero!=null?+t.dataset.runhero:null,a=t.dataset.runact;
    if(a==='start')startRunner(k,h).then(done);else if(a==='stop')stopRunner(k,h).then(done);else if(a==='stopall')stopAllFellows().then(done);done()};
  // pointerdown as well as click: the hero card is rebuilt several times a second, which can swallow a click
  let downAt=0;
  document.addEventListener('pointerdown',e=>{if(e.button!==0)return;const t=e.target&&e.target.closest?e.target.closest('[data-runact]'):null;if(!t)return;e.preventDefault();e.stopPropagation();downAt=Date.now();act(t)},true);
  document.addEventListener('click',e=>{const t=e.target&&e.target.closest?e.target.closest('[data-runact]'):null;if(!t)return;e.stopPropagation();if(Date.now()-downAt<800)return;act(t)},true);
  document.addEventListener('change',e=>{const s=e.target;if(!s||!s.dataset)return;if(s.dataset.runpick!=null)picks[s.dataset.runpick]=s.value;else if(s.dataset.runturns!=null)turnPicks[s.dataset.runturns]=s.value;else return;done()},true);
  onUpdate=done;setInterval(()=>poll(),1000)}
