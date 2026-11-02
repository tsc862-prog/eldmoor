// Per-member mind setting (Mixed minds, issue #97): Scripted / AI / Agent, and for AI the provider and
// model. Used by the Fellowship panel (ui/fellowship.js) on each member row; any panel can reuse it.
// A Fellowship member is always agent-played (#148): its row has no mode buttons, only the model its
// runner plays with (Claude Haiku, Claude Sonnet, a local or an OpenAI model) and the runner's Start / Stop.
//   renderMindRow(node, a)   the row: three mode buttons, then provider and model pickers when AI
//   mindAct(button)          handles a click on the row; true when it was one of ours
//   mindChange(select)       handles a picker change; true when it was one of ours
//   mindRowSig(a)            what the row shows, for the caller's rebuild signature
// The provider list and the pulled Ollama models come from the relay's GET /health (polled at most every
// 15 s while a row is shown). The setting is a.brainCfg = {provider, model} (sim/brain.js setMind), saved
// with the world; the brain client sends it with each request for that hero.
import {CFG,enableBrain,disableBrain,setMind,mindCfg,MIND_PROVIDERS,PROVIDER_LABEL,LOCAL_PROVIDERS} from '../sim/brain.js';
import {agentOn,agentOff,agentLink,runnerTag} from './player-bridge.js';
import {mindLabel,linkOf} from './mindlabel.js'; // the one mind label (issue #136)
import {S} from '../sim/index.js';
import {runnerControl,runnerPick,runnerSig} from './runners.js'; // app runners: Start / Stop from the page

const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
let health=null,fetchedAt=0,inFlight=false,ver=0;
const healthUrl=()=>CFG.url.replace(/\/decide$/,'/health');
function poll(){if(inFlight||Date.now()-fetchedAt<15000||typeof fetch!=='function')return;inFlight=true;fetchedAt=Date.now();
  fetch(healthUrl()).then(r=>r.json()).then(j=>{health=j&&typeof j==='object'?j:null}).catch(()=>{health=null})
    .finally(()=>{inFlight=false;ver++})}
const provs=()=>health&&health.providers||null;
// Local models pulled in Ollama, from the relay's /health (empty when unknown).
export const pulledModels=()=>{poll();const o=provs()&&provs().ollama;return o&&o.ok&&Array.isArray(o.models)?o.models.slice():[]};
// Chat models the OpenAI key can use, from the relay's /health (empty until the relay reports OpenAI configured).
export const openaiModels=()=>{poll();const o=provs()&&provs().openai;return o&&o.ok&&Array.isArray(o.models)?o.models.slice():[]};
const byHid=id=>S.agents.find(x=>x.id==id);
const modeOf=a=>a.player?'agent':a.brain?'ai':'scripted';

export const mindRowSig=a=>modeOf(a)+':'+JSON.stringify(a.brainCfg||null)+':'+ver+(a.player?':'+linkOf(a)+':'+runnerTag(a)+':'+runnerSig(a):'');

export function renderMindRow(node,a){if(!a||a.state==='dead')return;poll();
  const row=el('div','mindrow'),mode=modeOf(a);
  if(a.fellow){const ml=mindLabel(a),n=el('span','dm mnote',ml.text);n.title=ml.title+' A Fellowship member is always played by its agent; choose the model its runner plays with.';row.append(n);
    const r=runnerControl(a,{line:true});if(!r.querySelector('[data-runact="stop"]')&&!r.textContent.startsWith('Fellowship'))row.append(runnerPick('hero:'+a.id,pulledModels(),openaiModels()));row.append(r);
    node.append(row);return}
  const seg=el('span','mseg');
  for(const [k,label,title] of [['scripted','Scripted','The scripted rules play this hero'],['ai','AI','A language model makes the decisions through the relay (scripted when it is silent)'],['agent','Agent','An agent runner plays this hero through the game tools (npm run agent)']]){
    const b=el('button','mini',label);b.dataset.mmode=k;b.dataset.mhid=a.id;b.title=title;b.setAttribute('aria-pressed',String(mode===k));seg.append(b)}
  row.append(seg);
  if(mode==='ai'){const c=mindCfg(a)||{provider:'anthropic'},P=provs();
    const ps=el('select','msel');ps.dataset.mprov=a.id;ps.title='Who plays this hero';
    for(const p of MIND_PROVIDERS){const st=P&&P[p],o=new Option(PROVIDER_LABEL[p]+(st&&!st.ok?' (off)':''),p);if(p===c.provider)o.selected=true;
      if(st&&!st.ok&&p!==c.provider&&p!=='ollama')o.disabled=true;ps.append(o)}
    const ms=el('select','msel');ms.dataset.mmodel=a.id;ms.title='Which model';
    const st=P&&P[c.provider],list=st&&Array.isArray(st.models)?st.models.slice():[];
    if(c.provider==='anthropic')ms.append(new Option('default',''));
    else if(!c.model)ms.append(new Option(st&&st.default?st.default+' (default)':c.provider==='openai'?'pick a model':'default',''));
    if(c.model&&!list.includes(c.model))list.unshift(c.model);
    for(const m of list){const o=new Option(m+(st&&st.ok&&c.provider!=='anthropic'&&!st.models.includes(m)?c.provider==='openai'?' (not in list)':' (not pulled)':''),m);if(m===c.model)o.selected=true;ms.append(o)}
    row.append(ps,ms);
    const note=!P?'relay not answering':st&&!st.ok?String(st.error||'not available'):LOCAL_PROVIDERS[c.provider]?(list.length?'local · free':'no models pulled (ollama pull qwen2.5:14b)'):c.provider==='openai'?(c.model||st&&st.default?'billed by OpenAI':'pick a model (billed by OpenAI)'):'';
    if(note)row.append(el('span','dm mnote',note))}
  // Agent: which runner holds the hero and which model it plays (from the runner's claim, issue #97)
  if(mode==='agent'){const ml=mindLabel(a),n=el('span','dm mnote',ml.text);
    n.title=ml.title;row.append(n);
    // app runners: start or stop this hero's runner from the page, with the mind it starts with
    const r=runnerControl(a,{line:true});if(!r.querySelector('[data-runact="stop"]')&&!r.textContent.startsWith('Fellowship'))row.append(runnerPick('hero:'+a.id,pulledModels(),openaiModels()));row.append(r)}
  node.append(row)}

export function mindAct(t){if(!t||!t.dataset||!t.dataset.mmode)return false;
  const a=byHid(t.dataset.mhid);if(!a||a.state==='dead'||a.fellow)return true;const k=t.dataset.mmode; // a member stays an agent (#148)
  if(k==='scripted'){if(a.player)agentOff(a);disableBrain(a);delete a.fellowBrain;delete a.fellowAgent}
  else if(k==='ai'){if(a.player)agentOff(a);delete a.fellowAgent;if(!a.brain&&enableBrain(a)&&a.fellow)a.fellowBrain=true}
  else if(k==='agent'&&!a.player){if(a.brain){disableBrain(a);delete a.fellowBrain}if(agentOn(a)&&a.fellow)a.fellowAgent=true}
  return true}

export function mindChange(s){if(!s||!s.dataset)return false;
  if(s.dataset.mprov){const a=byHid(s.dataset.mprov),st=provs()&&provs()[s.value]; // a provider switch drops the model (as the runner settings do)
    const pulled=st&&st.ok&&Array.isArray(st.models)?st.models:[],first=s.value!=='anthropic'&&s.value!=='openai'&&pulled.length&&!pulled.includes(st.default)?pulled[0]:undefined; // default not pulled: take one that is
    if(a)setMind(a,{provider:s.value,model:first});fetchedAt=0;return true}
  if(s.dataset.mmodel){const a=byHid(s.dataset.mmodel);if(a){const c=mindCfg(a)||{provider:'anthropic'};setMind(a,{...c,model:s.value||undefined})}return true}
  return false}
