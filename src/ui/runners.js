// App runners, page side: start and stop agent runners from the game instead of a terminal per hero.
// The relay (npm run relay -- --runners, or start-eldmoor.cmd) runs them as child processes
// (scripts/runners.mjs); this module polls GET /play/runner on the same relay the bridge uses and
// sends POST /play/runner/start|stop. Runners have a kind ('hero', 'fellowship'; later 'dm'), a key
// ('hero:12', 'fellowship') and a state: starting, live, waiting, stopping, stopped, crashed.
//   runnerFor(a)               the runner playing hero a (its own, or the Fellowship's), or null
//   runnerByKey(key)           a runner by key
//   runnerControl(a)           a small control: state, provider/model and a Start / Stop button
//   fellowshipRunnerControl()  "Start all five" / "Stop all" with the Fellowship runner's state
//   runnerPick(key, models, openai, hf, google)  a picker for the mind a runner is started with (saved, Claude, a local or OpenAI model)
//   limitOf(key) / setLimit(key, field, v)  a runner's turn cap and budget, set in the Agents panel (ui/agents.js, #145):
//                              sent with the next start, and to a running runner live (lowering applies now)
//   sessionInfo() / setSessionBudget(v)  the budget across all paid runners and the spend so far (kept per viewer,
//                              re-sent when the relay restarts)
//   runnerSig(a)               what the controls show, for the callers' rebuild signatures
//   initRunners(after)         one delegated handler for every control on the page
// When the relay runs without --runners the controls say how to turn it on; the world never waits on any of this.
import {bridgeUrl} from './player-bridge.js';
import {priceLabel} from './pricelabel.js';
import {S,playerSeats} from '../sim/index.js';
import {slotted} from '../sim/company.js'; // the slotted company (#588)

const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
let info=null,up=null,fetchedAt=0,inFlight=false,note={},picks={},onUpdate=()=>{},lastSig='';
// Limits set in the game (#145), kept per viewer: {key: {turns:'', budget:''}} ('' = the runner's default) and the session budget.
const LIM_KEY='eldmoor.agentLimits';let lims={},sessWant=null,limNote={};
try{const j=JSON.parse(localStorage.getItem(LIM_KEY)||'null');if(j&&typeof j==='object'){lims=j.runners&&typeof j.runners==='object'?j.runners:{};sessWant=typeof j.session==='number'?j.session:null}}catch(_){}
const saveLims=()=>{try{localStorage.setItem(LIM_KEY,JSON.stringify({runners:lims,session:sessWant}))}catch(_){}};
const base=()=>bridgeUrl().replace(/^ws(s?):/,'http$1:').replace(/\/play\/?$/,'')+'/play/runner';
const DONE={stopped:1,crashed:1};
// waiting reads 'live' too (#563): the runner is up and holds its seats whether a member calls tools, thinks or waits for a slot
export const RUN_TEXT={starting:'starting…',live:'live',waiting:'live',stopping:'stopping…',stopped:'stopped',crashed:'crashed'};
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
  if(own&&!DONE[own.state])return own;const any=info.runners.find(r=>!DONE[r.state]&&Array.isArray(r.heroes)&&r.heroes.includes(a.id));
  // a Fellowship runner that let this member go (#563: its turns or budget ran out while the others play on): shown as such, never as playing it
  return any||info.runners.find(r=>!DONE[r.state]&&leftOf(r,a))||own}
// {id, name, why} when runner r held hero a and let it go, else null (#563)
export const leftOf=(r,a)=>r&&a&&Array.isArray(r.left)&&r.left.find(x=>x.id===a.id)||null;
export const runnerSig=a=>{poll();const k=a?'hero:'+a.id:'fellowship',r=a?runnerFor(a):runnerByKey('fellowship'),lf=a&&leftOf(r,a);return (r?r.key+':'+r.state+':'+r.turns+':'+(r.model||'')+':'+r.cost+(lf?':left:'+lf.why:''):'-')+':'+(note[k]||'')+':'+up+':'+(info?info.enabled:'?')+':'+(picks[k]||'')};
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
const pickBody=(k,lk=k)=>{const p=picks[k]||'',L=limitOf(lk),t={...(L.budget&&!p.startsWith('ollama:')?{budget:Number(L.budget)}:{})};return {...(p==='anthropic'?{provider:'anthropic'}:p.startsWith('anthropic:')?{provider:'anthropic',model:p.slice(10)}:p.startsWith('ollama:')?{provider:'ollama',model:p.slice(7)}:p.startsWith('openai:')?{provider:'openai',model:p.slice(7)}:p.startsWith('huggingface:')?{provider:'huggingface',model:p.slice(12)}:p.startsWith('google:')?{provider:'google',model:p.slice(7)}:{}),...t}};
// kind 'company' (#460): `hero` is the company's id and the runner's key is 'company:<id>'
const keyOf=(kind,hero)=>kind==='hero'?'hero:'+hero:kind==='company'?'company:'+hero:kind;
export async function startRunner(kind,hero,pickKey){const k=keyOf(kind,hero);note[k]='';delete userStop[k];
  const lk=pickKey&&limitOf(pickKey).budget&&!limitOf(k).budget?pickKey:k;
  const r=await send('/start',{kind,...(hero!=null?(kind==='company'?{company:hero}:{hero}):{}),...pickBody(pickKey&&picks[pickKey]?pickKey:k,lk)});if(!r.ok)note[k]=r.error;poll(true,true);return r}
export async function stopRunner(kind,hero){const k=keyOf(kind,hero);note[k]='';userStop[k]=Date.now();
  const r=await send('/stop',{key:k});if(!r.ok)note[k]=r.error;poll(true,true);return r}
// A company that is not the five-place Fellowship (#457, #460): Start <company> starts one company runner for a company
// of two or more agent-played members when none of them has a runner yet (one process plays them all, each with its own
// session), else a hero runner for each member that has none (a solo, or a company whose members already run apart);
// Stop <company> stops its company runner and its members' hero runners. pick: the company's picker key, 'co:<id>'.
const coHeroes=C=>(C?C.ids:[]).map(id=>S.agents.find(a=>a.id===id)).filter(a=>a&&a.state!=='dead'&&a.player);
const liveKey=k=>{const x=runnerByKey(k);return !!x&&!DONE[x.state]};
export async function startCompany(C){const L=coHeroes(C);if(liveKey('company:'+C.id))return;
  if(L.length>1&&!L.some(a=>liveKey('hero:'+a.id))){await startRunner('company',C.id,'co:'+C.id);return}
  for(const a of L)if(!liveKey('hero:'+a.id))await startRunner('hero',a.id,'co:'+C.id)}
export async function stopCompany(C){if(liveKey('company:'+C.id))await stopRunner('company',C.id);for(const a of coHeroes(C))if(liveKey('hero:'+a.id))await stopRunner('hero',a.id)}
// A world reset (#691: New world, Load, Import, any start that is not Continue): ONE relay call stops every runner before the
// page replaces the world. -> the number stopped, or null when the relay is unreachable or runners are off (nothing to stop).
export async function stopAllForReset(timeoutMs=9000){
  try{const ctl=typeof AbortController!=='undefined'?new AbortController():null,t=ctl?setTimeout(()=>ctl.abort(),timeoutMs):0;
    const r=await fetch(base()+'/stop-all',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({why:'world reset'}),...(ctl?{signal:ctl.signal}:{})});
    if(t)clearTimeout(t);const j=await r.json().catch(()=>({}));return r.ok&&j&&typeof j.stopped==='number'?j.stopped:null}
  catch(e){return null}}
export async function stopAllFellows(){const ids=(slotted()&&slotted().ids)||[];await stopRunner('fellowship');
  for(const id of ids){const r=runnerByKey('hero:'+id);if(r&&!DONE[r.state])await stopRunner('hero',id)}}

const mindTag=r=>r&&(r.model||r.provider)?(r.model||r.provider)+(r.provider==='ollama'?' · local':r.provider&&r.provider!=='anthropic'?' · '+r.provider:''):'';
export function stateLine(r,k){if(note[k])return note[k];
  if(up===false)return 'relay offline';if(info&&!info.enabled)return HOW_TEXT;if(!r)return 'no runner';
  const bits=[RUN_TEXT[r.state]||r.state];const m=mindTag(r);if(m)bits.push(m);
  if(r.turns)bits.push(r.turns+' turn'+(r.turns===1?'':'s'));
  // spend against the budget (owner, #563: the dollar budget is the limit, not turns); a local mind is free
  const bud=r.capBudget!=null?r.capBudget:r.budget;if(bud!=null)bits.push('$'+(r.cost||0).toFixed(3)+' of $'+bud.toFixed(2));else if(r.cost)bits.push('$'+r.cost.toFixed(3));
  // pacing (issue #126): turns per minute, the last turn's age; a turn cap only when one was asked
  if(r.turns&&r.turnsPerMin!=null)bits.push(r.turnsPerMin+'/min');if(r.lastTurnAgo!=null&&!DONE[r.state])bits.push('last '+ago(r.lastTurnAgo));if(r.maxTurns!=null&&r.turnCap&&!DONE[r.state])bits.push(r.turnCap);
  const other=r.provider==='ollama'&&r.model&&!DONE[r.state]?mindsLocal().find(m=>m!==r.model):null; // #126: two local models evict each other on one GPU
  if(other)bits.push('minds use '+other+': on one GPU the two models evict each other, use one');
  if(r.numCtx&&!DONE[r.state])bits.push('ctx '+r.numCtx);if(r.ctxWarn&&!DONE[r.state])bits.push(r.ctxWarn); // #221: one num_ctx for every local call
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
  const r=runnerFor(a),k='hero:'+a.id,on=r&&!DONE[r.state],fel=on&&r.kind!=='hero',lf=fel&&leftOf(r,a);
  const rl=r&&r.kind==='company'?'Company runner':'Fellowship runner';
  if(lf){d.append(el('span','dm',rl));if(line){const s=el('span','dm runstate r-none',' done with '+a.name+' ('+lf.why+'): no runner; Restart the '+rl.toLowerCase()+' to play on');s.title=tip(r,4);d.append(s)}return d}
  if(fel)d.append(el('span','dm',rl));
  else if(on)d.append(button('Stop runner','stop','hero',a.id,'Stop this hero\'s agent runner (it lets go of the hero; reflexes play on)'));
  else{const b=button('Start runner','start','hero',a.id,info&&!info.enabled?HOW_TEXT:'Start an agent runner for '+a.name+' from the relay (no terminal needed)');if(info&&!info.enabled||up===false)b.classList.add('off');d.append(b)}
  if(line){const s=el('span','dm runstate r-'+(r&&!note[k]?r.state:'none'),' '+stateLine(r,k));s.title=tip(r,4);d.append(s)}
  return d}

export function fellowshipRunnerControl(name){poll(true);const d=el('div','runctl fbar');const r=runnerByKey('fellowship'),on=r&&!DONE[r.state];
  const others=((slotted()&&slotted().ids)||[]).some(id=>{const x=runnerByKey('hero:'+id);return x&&!DONE[x.state]});
  if(!on){const b=button('Start '+(name||'the Fellowship'),'start','fellowship',null,info&&!info.enabled?HOW_TEXT:'One runner plays every agent-played member (npm run fellowship, started by the relay)');if(info&&!info.enabled||up===false)b.classList.add('off');d.append(b)}
  if(on||others)d.append(button('Stop all','stopall','fellowship',null,'Stop the Fellowship runner and every member\'s own runner'));
  const s=el('span','dm runstate r-'+(r&&!note.fellowship?r.state:'none'),stateLine(r,'fellowship'));s.title=tip(r,6);d.append(s);
  return d}

// Start <company> / Stop <company> for a company with no Fellowship runner: hero runners for its agent-played members.
export function companyRunnerControl(C){poll(true);const d=el('div','runctl fbar'),L=coHeroes(C),name=C.name||(L.length===1?L[0].name:'the company');
  const cr=runnerByKey('company:'+C.id),con=!!cr&&!DONE[cr.state],live=L.filter(a=>con&&Array.isArray(cr.heroes)&&cr.heroes.includes(a.id)||liveKey('hero:'+a.id));
  if(!L.length){d.append(el('span','dm runstate','No agent-played hero here.'));return d}
  if(live.length<L.length){const b=button('Start '+name,'startco',null,null,info&&!info.enabled?HOW_TEXT:'Start a hero runner for each agent-played member of this company that has none');b.dataset.runco=String(C.id);if(info&&!info.enabled||up===false)b.classList.add('off');d.append(b)}
  if(live.length){const b=button('Stop '+name,'stopco',null,null,'Stop the hero runners of this company (reflexes play on)');b.dataset.runco=String(C.id);d.append(b)}
  if(con){const s=el('span','dm runstate r-'+cr.state,'company runner · '+stateLine(cr,'company:'+C.id)+' · ');s.title=tip(cr,6);d.append(s)}
  d.append(el('span','dm runstate r-'+(live.length?'live':'none'),live.length+' of '+L.length+' runners on'));return d}
export const companyRunnerSig=C=>{poll(true);const cr=runnerByKey('company:'+C.id);return (cr?cr.state+cr.turns+(cr.model||'')+(cr.heroes||[]).join('.'):'-')+'|'+coHeroes(C).map(a=>{const x=runnerByKey('hero:'+a.id);return a.id+(x?x.state+x.turns+(x.model||''):'-')}).join(',')+':'+up+':'+(info?info.enabled:'?')};

// The DM agent's runner (#66): Start DM / Stop DM and its state, for the DM panel and the Minds panel's
// DM row (src/ui/dmseat.js). It plays no hero, so it polls whether or not a hero is agent-played.
export function dmRunnerControl(){poll(true);const d=el('span','runctl');const r=runnerByKey('dm'),on=r&&!DONE[r.state];
  if(on){d.append(button('Restart DM','restart','dm',null,'Stop the DM runner and start it again (the world waits for the DM meanwhile)'));
    d.append(button('Stop DM','stop','dm',null,'Stop the DM agent: the world pauses until a DM runner is back (Start DM)'))}
  else{const b=button('Start DM','start','dm',null,info&&!info.enabled?HOW_TEXT:'Start the DM agent from the relay (npm run dm, no terminal needed)');if(info&&!info.enabled||up===false)b.classList.add('off');d.append(b)}
  const s=el('span','dm runstate r-'+(r&&!note.dm?r.state:'none'),' '+stateLine(r,'dm'));s.title=tip(r,6);d.append(s);
  return d}
export const dmRunnerSig=()=>{poll(true);const r=runnerByKey('dm');return (r?r.state+':'+r.turns+':'+(r.model||'')+':'+(r.error||''):'-')+':'+(note.dm||'')+':'+up+':'+(info?info.enabled:'?')+':'+(picks.dm||'')};

// The mind a runner starts with. models: pulled local models (from the relay's /health), may be empty.
export function runnerPick(k,models,openai,hf,gm){const s=el('select','msel');s.dataset.runpick=k;s.title='The mind the runner starts with (saved: what this hero used last, else Claude). Hugging Face models share the free allowance with the art pipeline.';
  // Claude by model (the owner pays per model): Haiku is also what a runner started here plays when nothing is saved
  const opts=[['','saved mind (new: Claude Haiku)'],['anthropic:claude-haiku-5-5','Claude Haiku'],['anthropic:claude-sonnet-5-5','Claude Sonnet']].concat((models||[]).map(m=>['ollama:'+m,m+' · local'])).concat((openai||[]).map(m=>['openai:'+m,m+' · openai'+(openai&&openai.prices?priceLabel(openai,m):'')])).concat((hf||[]).map(m=>['huggingface:'+m,m+' · huggingface'])).concat((gm||[]).map(m=>['google:'+m,m+' · google'+(gm&&gm.prices?priceLabel(gm,m):'')]));
  if(picks[k]&&!opts.some(o=>o[0]===picks[k]))opts.push([picks[k],picks[k].replace(/^(ollama|openai|huggingface|google|anthropic):/,'')+(picks[k].startsWith('openai:')?' · openai':picks[k].startsWith('huggingface:')?' · huggingface':picks[k].startsWith('google:')?' · google':picks[k].startsWith('anthropic')?'':' · local')]);
  for(const [v,t] of opts){const o=new Option(t,v);if(v===(picks[k]||''))o.selected=true;s.append(o)}
  // the budget the runner starts with (owner, #563: dollars are the limit, a runner plays until stopped); also in the Agents panel
  const w=el('span','runpick');w.append(s,budgetPick(k));return w}
const KIND_OF=k=>k==='dm'||k==='fellowship'?k:/^co(mpany)?:/.test(k)?'company':'hero';
export const BUDGETS=[.5,1,2,5,10];
export function budgetPick(k){const K=kindInfo(KIND_OF(k)),cap=K&&K.caps?K.caps.budget:5,def=K&&K.defaults?K.defaults.budget:(k==='fellowship'?2:1),L=limitOf(k);
  const b=el('select','msel');b.dataset.runbudget=k;b.title='The most this runner may spend (Claude, OpenAI); it plays until stopped or the budget is spent. Local models are free.';
  for(const [v,t] of [['','$'+def.toFixed(2)+' (default)']].concat(BUDGETS.filter(v=>v<=cap).map(v=>[String(v),'$'+v.toFixed(2)]))){const o=new Option(t,v);if(v===(L.budget||''))o.selected=true;b.append(o)}
  return b}

export function initRunners(after){const done=after||(()=>{});
  const act=async t=>{if(t.dataset.runco!=null){const C=(S.companies||[]).find(x=>x.id===+t.dataset.runco);if(C){if(t.dataset.runact==='startco')startCompany(C).then(done);else stopCompany(C).then(done)}done();return}
    const k=t.dataset.runkind,h=t.dataset.runhero!=null?+t.dataset.runhero:null,a=t.dataset.runact;
    if(a==='start')startRunner(k,h).then(done);else if(a==='stop')stopRunner(k,h).then(done);else if(a==='stopall')stopAllFellows().then(done);else if(a==='restart')stopRunner(k,h).then(()=>startRunner(k,h)).then(done);done()};
  // pointerdown as well as click: the hero card is rebuilt several times a second, which can swallow a click
  let downAt=0;
  document.addEventListener('pointerdown',e=>{if(e.button!==0)return;const t=e.target&&e.target.closest?e.target.closest('[data-runact]'):null;if(!t)return;e.preventDefault();e.stopPropagation();downAt=Date.now();act(t)},true);
  document.addEventListener('click',e=>{const t=e.target&&e.target.closest?e.target.closest('[data-runact]'):null;if(!t)return;e.stopPropagation();if(Date.now()-downAt<800)return;act(t)},true);
  document.addEventListener('change',e=>{const s=e.target;if(!s||!s.dataset)return;if(s.dataset.runpick!=null)picks[s.dataset.runpick]=s.value;else if(s.dataset.runbudget!=null){setLimit(s.dataset.runbudget,'budget',s.value).then(done);return}else return;done()},true);
  onUpdate=done;setInterval(()=>poll(),1000)}
