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
//   limitOf(key) / setLimit(key, field, v)  a runner's turn cap and budget, set in the Agents panel (ui/agents.js, #145):
//                              sent with the next start, and to a running runner live (lowering applies now)
//   sessionInfo() / setSessionBudget(v)  the budget across all paid runners and the spend so far (kept per viewer,
//                              re-sent when the relay restarts)
//   runnerSig(a)               what the controls show, for the callers' rebuild signatures
//   initRunners(after)         one delegated handler for every control on the page
// When the relay runs without --runners the controls say how to turn it on; the world never waits on any of this.
import {bridgeUrl} from './player-bridge.js';
import {S,playerSeats} from '../sim/index.js';

const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
let info=null,up=null,fetchedAt=0,inFlight=false,note={},picks={},onUpdate=()=>{},lastSig='';
// Limits set in the game (#145), kept per viewer: {key: {turns:'', budget:''}} ('' = the runner's default) and the session budget.
const LIM_KEY='eldmoor.agentLimits';let lims={},sessWant=null,limNote={};
try{const j=JSON.parse(localStorage.getItem(LIM_KEY)||'null');if(j&&typeof j==='object'){lims=j.runners&&typeof j.runners==='object'?j.runners:{};sessWant=typeof j.session==='number'?j.session:null}}catch(_){}
const saveLims=()=>{try{localStorage.setItem(LIM_KEY,JSON.stringify({runners:lims,session:sessWant}))}catch(_){}};
const base=()=>bridgeUrl().replace(/^ws(s?):/,'http$1:').replace(/\/play\/?$/,'')+'/play/runner';
const DONE={stopped:1,crashed:1};
export const RUN_TEXT={starting:'starting…',live:'live',waiting:'waiting',stopping:'stopping…',stopped:'stopped',crashed:'crashed'};
export const HOW_TEXT='Runners are off: start the relay with --runners (npm run relay -- --runners, or start-eldmoor.cmd).';

// want: poll even with no agent-played hero (the Fellowship panel); now: skip the wait (after a start or stop)
function poll(want,now){want=want||playerSeats().length>0;if(!want||inFlight||typeof fetch!=='function')return;
  const live=info&&info.runners&&info.runners.some(r=>!DONE[r.state]);if(!now&&Date.now()-fetchedAt<(live?2000:5000))return;
  inFlight=true;fetchedAt=Date.now();
  fetch(base()).then(r=>r.json()).then(j=>{info=j&&typeof j==='object'?j:null;up=!!info}).catch(()=>{info=null;up=false})
    .finally(()=>{inFlight=false;syncSession();const k=JSON.stringify([up,info]);if(k!==lastSig){lastSig=k;onUpdate()}})}
// A relay that restarted forgot the session budget: send the viewer's again.
let syncAt=0;function syncSession(){const s=info&&info.enabled&&info.session;if(!s||sessWant==null||s.budget===sessWant||Date.now()-syncAt<5000)return;syncAt=Date.now();send('/limits',{sessionBudget:sessWant})}
// Ollama busy (issue #136): a local-model runner whose latest pacing or log line says Ollama is busy or loading the model.
export function ollamaBusy(a){const r=runnerFor(a);if(!r||DONE[r.state]||r.provider!=='ollama')return false;
  const re=/ollama is busy|busy or loading|loading the model/i;return re.test(r.pace||'')||(r.lines||[]).slice(-2).some(l=>re.test(l))}
// The runner's own reason: "stopped after N turns (reason)", else the crash error, else a keyword in its last lines.
export function reasonOf(r,a){
  if(a&&a.state==='dead')return 'the hero died';
  const L=(r.lines||[]).slice(-6);
  const m=[...L].reverse().map(l=>l.match(/stopped after \d+ turns[^()]*\(([^)]+)\)/)).find(Boolean);
  if(r.state==='crashed'){const last=r.error||L[L.length-1]||(r.exit!=null?'exit '+r.exit:'');return 'crashed'+(last?': '+String(last).slice(0,160):'')}
  if(m)return m[1];
  const t=L.join(' ');
  if(/budget/i.test(t))return 'budget reached';
  if(/turn cap|max.?turns|reached .*turns/i.test(t))return 'turn cap reached';
  if(/empty|failed turns/i.test(t))return '5 empty or failed turns';
  if(/left agent play|not agent-played/i.test(t))return 'the hero left agent play';
  return 'the runner ended'+(r.exit!=null?' (exit '+r.exit+')':'')}

// For the runner-stop alert (ui/runalert.js).
const userStop={};
export const DONE_STATE=DONE;
export const allRunners=()=>info&&info.runners?info.runners:[];
export const userStopped=k=>!!userStop[k]&&Date.now()-userStop[k]<120000; // a Stop pressed here: not an alarm
export const watchRunners=()=>poll(true);
export const runnersEnabled=()=>!!(info&&info.enabled);
export const runnerByKey=k=>info&&info.runners?info.runners.find(r=>r.key===k)||null:null;
export function runnerFor(a){if(!a||!info||!info.runners)return null;const own=runnerByKey('hero:'+a.id);
  if(own&&!DONE[own.state])return own;const any=info.runners.find(r=>!DONE[r.state]&&Array.isArray(r.heroes)&&r.heroes.includes(a.id));return any||own}
export const runnerSig=a=>{poll();const k=a?'hero:'+a.id:'fellowship',r=a?runnerFor(a):runnerByKey('fellowship');return (r?r.key+':'+r.state+':'+r.turns+':'+(r.model||''):'-')+':'+(note[k]||'')+':'+up+':'+(info?info.enabled:'?')+':'+(picks[k]||'')};
export const relayUp=()=>up;
export const kindInfo=kind=>info&&info.kinds&&info.kinds[kind]||null;
export const pickOf=k=>picks[k]||'';
// ---- limits (#145) ----
export const limitOf=k=>({turns:'',budget:'',...(lims[k]||{})});
export const limitNote=k=>limNote[k]||'';
export async function setLimit(k,field,v){const L=lims[k]={...limitOf(k),[field]:v==null?'':String(v)};if(!L.turns&&!L.budget)delete lims[k];saveLims();limNote[k]='';
  const r=runnerByKey(k);if(r&&!DONE[r.state]){const body={key:k};body[field==='turns'?'maxTurns':'budget']=v===''||v==null?null:Number(v);
    const res=await send('/limits',body);limNote[k]=res.ok?(res.applies==='now'?'applies now':'applies on the next start'):res.error;poll(true,true)}
  else limNote[k]='used on the next start';onUpdate();return limNote[k]}
export const sessionInfo=()=>({want:sessWant,...(info&&info.session||{budget:null,spent:0,left:null})});
export async function setSessionBudget(v){sessWant=v===''||v==null?null:Number(v);saveLims();const res=await send('/limits',{sessionBudget:sessWant});poll(true,true);onUpdate();return res}

async function send(path,body){
  try{const r=await fetch(base()+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));
    return r.ok?{ok:true,runner:j.runner,applies:j.applies,session:j.session}:{ok:false,error:j.how||j.error||('HTTP '+r.status)}}
  catch(e){return {ok:false,error:'The relay is not reachable (start it: npm run relay -- --runners).'}}}
// pick: '' (the hero's saved mind), 'anthropic', 'ollama:<model>' or 'openai:<model>'
const pickBody=k=>{const p=picks[k]||'',L=limitOf(k),t={...(L.turns?{maxTurns:Number(L.turns)}:{}),...(L.budget&&!p.startsWith('ollama:')?{budget:Number(L.budget)}:{})};return {...(p==='anthropic'?{provider:'anthropic'}:p.startsWith('anthropic:')?{provider:'anthropic',model:p.slice(10)}:p.startsWith('ollama:')?{provider:'ollama',model:p.slice(7)}:p.startsWith('openai:')?{provider:'openai',model:p.slice(7)}:{}),...t}};
export async function startRunner(kind,hero){const k=kind==='hero'?'hero:'+hero:kind;note[k]='';delete userStop[k];
  const r=await send('/start',{kind,...(hero!=null?{hero}:{}),...pickBody(k)});if(!r.ok)note[k]=r.error;poll(true,true);return r}
export async function stopRunner(kind,hero){const k=kind==='hero'?'hero:'+hero:kind;note[k]='';userStop[k]=Date.now();
  const r=await send('/stop',{key:k});if(!r.ok)note[k]=r.error;poll(true,true);return r}
export async function stopAllFellows(){const ids=(S.fellowship&&S.fellowship.ids)||[];await stopRunner('fellowship');
  for(const id of ids){const r=runnerByKey('hero:'+id);if(r&&!DONE[r.state])await stopRunner('hero',id)}}

const mindTag=r=>r&&(r.model||r.provider)?(r.model||r.provider)+(r.provider==='ollama'?' · local':r.provider==='openai'?' · openai':''):'';
export function stateLine(r,k){if(note[k])return note[k];
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
  // turn caps and budgets live in one place, the Agents panel (ui/agents.js, #145)
  const w=el('span','runpick');w.append(s);return w}

export function initRunners(after){const done=after||(()=>{});
  const act=async t=>{const k=t.dataset.runkind,h=t.dataset.runhero!=null?+t.dataset.runhero:null,a=t.dataset.runact;
    if(a==='start')startRunner(k,h).then(done);else if(a==='stop')stopRunner(k,h).then(done);else if(a==='stopall')stopAllFellows().then(done);else if(a==='restart')stopRunner(k,h).then(()=>startRunner(k,h)).then(done);done()};
  // pointerdown as well as click: the hero card is rebuilt several times a second, which can swallow a click
  let downAt=0;
  document.addEventListener('pointerdown',e=>{if(e.button!==0)return;const t=e.target&&e.target.closest?e.target.closest('[data-runact]'):null;if(!t)return;e.preventDefault();e.stopPropagation();downAt=Date.now();act(t)},true);
  document.addEventListener('click',e=>{const t=e.target&&e.target.closest?e.target.closest('[data-runact]'):null;if(!t)return;e.stopPropagation();if(Date.now()-downAt<800)return;act(t)},true);
  document.addEventListener('change',e=>{const s=e.target;if(!s||!s.dataset)return;if(s.dataset.runpick!=null)picks[s.dataset.runpick]=s.value;else return;done()},true);
  onUpdate=done;setInterval(()=>poll(),1000)}
