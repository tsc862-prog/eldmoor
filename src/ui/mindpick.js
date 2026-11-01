// Per-member mind setting (Mixed minds, issue #97): Scripted / AI / Agent, and for AI the provider and
// model. Used by the Fellowship panel (ui/fellowship.js) on each member row; any panel can reuse it.
//   renderMindRow(node, a)   the row: three mode buttons, then provider and model pickers when AI
//   mindAct(button)          handles a click on the row; true when it was one of ours
//   mindChange(select)       handles a picker change; true when it was one of ours
//   mindRowSig(a)            what the row shows, for the caller's rebuild signature
// The provider list and the pulled Ollama models come from the relay's GET /health (polled at most every
// 15 s while a row is shown). The setting is a.brainCfg = {provider, model} (sim/brain.js setMind), saved
// with the world; the brain client sends it with each request for that hero.
import {CFG,enableBrain,disableBrain,setMind,mindCfg,MIND_PROVIDERS,PROVIDER_LABEL,LOCAL_PROVIDERS} from '../sim/brain.js';
import {agentOn,agentOff,agentLink,runnerTag,LINK_TEXT} from './player-bridge.js';
import {S} from '../sim/index.js';

const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
let health=null,fetchedAt=0,inFlight=false,ver=0;
const healthUrl=()=>CFG.url.replace(/\/decide$/,'/health');
function poll(){if(inFlight||Date.now()-fetchedAt<15000||typeof fetch!=='function')return;inFlight=true;fetchedAt=Date.now();
  fetch(healthUrl()).then(r=>r.json()).then(j=>{health=j&&typeof j==='object'?j:null}).catch(()=>{health=null})
    .finally(()=>{inFlight=false;ver++})}
const provs=()=>health&&health.providers||null;
const byHid=id=>S.agents.find(x=>x.id==id);
const modeOf=a=>a.player?'agent':a.brain?'ai':'scripted';

export const mindRowSig=a=>modeOf(a)+':'+JSON.stringify(a.brainCfg||null)+':'+ver+(a.player?':'+agentLink(a)+':'+runnerTag(a):'');

export function renderMindRow(node,a){if(!a||a.state==='dead')return;poll();
  const row=el('div','mindrow'),mode=modeOf(a);
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
    else if(!c.model)ms.append(new Option(st&&st.default?st.default+' (default)':'default',''));
    if(c.model&&!list.includes(c.model))list.unshift(c.model);
    for(const m of list){const o=new Option(m+(st&&st.ok&&c.provider!=='anthropic'&&!st.models.includes(m)?' (not pulled)':''),m);if(m===c.model)o.selected=true;ms.append(o)}
    row.append(ps,ms);
    const note=!P?'relay not answering':st&&!st.ok?String(st.error||'not available'):LOCAL_PROVIDERS[c.provider]?(list.length?'local · free':'no models pulled (ollama pull qwen2.5:14b)'):'';
    if(note)row.append(el('span','dm mnote',note))}
  // Agent: which runner holds the hero and which model it plays (from the runner's claim, issue #97)
  if(mode==='agent'){const k=agentLink(a),tag=runnerTag(a),n=el('span','dm mnote',tag?tag+' · '+(k==='connected'?'live':'idle'):LINK_TEXT[k]||k);
    n.title=tag?'Agent runner model: '+tag:'Start a runner: npm run agent -- --hero '+a.name+' (add --provider ollama --model <tag> for a local model)';row.append(n)}
  node.append(row)}

export function mindAct(t){if(!t||!t.dataset||!t.dataset.mmode)return false;
  const a=byHid(t.dataset.mhid);if(!a||a.state==='dead')return true;const k=t.dataset.mmode;
  if(k==='scripted'){if(a.player)agentOff(a);disableBrain(a);delete a.fellowBrain}
  else if(k==='ai'){if(a.player)agentOff(a);if(!a.brain)enableBrain(a)}
  else if(k==='agent'&&!a.player)agentOn(a);
  return true}

export function mindChange(s){if(!s||!s.dataset)return false;
  if(s.dataset.mprov){const a=byHid(s.dataset.mprov),st=provs()&&provs()[s.value]; // a provider switch drops the model (as the runner settings do)
    const pulled=st&&st.ok&&Array.isArray(st.models)?st.models:[],first=s.value!=='anthropic'&&pulled.length&&!pulled.includes(st.default)?pulled[0]:undefined; // default not pulled: take one that is
    if(a)setMind(a,{provider:s.value,model:first});fetchedAt=0;return true}
  if(s.dataset.mmodel){const a=byHid(s.dataset.mmodel);if(a){const c=mindCfg(a)||{provider:'anthropic'};setMind(a,{...c,model:s.value||undefined})}return true}
  return false}
