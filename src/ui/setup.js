// New World setup page (issue #133): choose the world, the Fellowship (class, name, people and mind per
// place) and the DM, then build the world with those heroes already agent-played and start their runners.
//   initSetup()    binds the World bar's "New world" button to the page
//   openSetup({first})  show the page; first = the first visit with no save (Cancel plays the default world)
//   afterBoot()    called once the page is built: when this boot applied a setup, start its runners
// The rules (classes per role, names, minds, presets, which runners) are DOM-free in src/sim/setup.js; this
// file is the form, the relay status and the runner launch. Choices are remembered per viewer in localStorage
// (eldmoor.setup.last). Starting reloads the page into the new world (ui/save.js queueNewWorld), where
// init({setup}) builds it, so every panel starts from state as for any boot.
import {fellowshipMembers,defaultSetup,validateSetup,cleanSetup,applyPreset,suggestName,CLAUDE_MODELS,slotClasses,slotLabel,planRunners} from '../sim/index.js';
import {SLOT_KEYS} from '../sim/fellowship.js';
import {racesOf} from '../data/races.js';
import {FAC} from '../data/factions.js';
import {CFG} from '../sim/brain.js';
import {WORLD_ID} from '../world/map.js';
import {WORLDS} from '../world/spec.js';
import {bridgeUrl,agentLink,dmLink} from './player-bridge.js';
import {runnerByKey} from './runners.js';
import {ctl} from './controls.js';
import {bootKind,appliedSetup,holdSave,setNewWorldHandler,saveSummary,queueNewWorld,exportSave} from './save.js';

const LAST_KEY='eldmoor.setup.last';
const WORLDS_INFO=Object.fromEntries(Object.keys(WORLDS).map(id=>[id,WORLDS[id].name||id]));
const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
const store=()=>{try{return window.localStorage}catch(e){return null}};
const readLast=()=>{try{const j=JSON.parse(store().getItem(LAST_KEY));return j&&j.slots?cleanSetup(j):null}catch(e){return null}};
const newSeed=()=>1+Math.floor(Math.random()*999999);
const ROLE_ORDER=SLOT_KEYS;
const MODE_TEXT={scripted:'Scripted',ai:'AI',agent:'Agent'};
const MODE_TITLE={scripted:'The scripted rules play this hero',ai:'A language model decides through the relay (scripted when it is silent)',agent:'An agent runner plays this hero through the game tools; shown as AGENT from the first minute'};

let root=null,st=null,pausedAt=null; // st: {setup, first, confirm, error, relay}
let relay={health:null,runner:null,at:0,busy:false};

// ---- the relay: models and runners ----
const relayBase=()=>bridgeUrl().replace(/^ws(s?):/,'http$1:').replace(/\/play\/?$/,'');
const healthUrl=()=>CFG.url.replace(/\/decide$/,'/health');
function pollRelay(force){if(relay.busy||typeof fetch!=='function')return;if(!force&&Date.now()-relay.at<4000)return;relay.busy=true;relay.at=Date.now();
  const get=u=>fetch(u).then(r=>r.json()).catch(()=>null);
  Promise.all([get(healthUrl()),get(relayBase()+'/play/runner')]).then(([h,r])=>{relay.health=h&&typeof h==='object'?h:null;relay.runner=r&&typeof r==='object'?r:null})
    .finally(()=>{relay.busy=false;if(root&&!root.hidden)syncModels()})}
const provs=()=>relay.health&&relay.health.providers||null;
const pulled=()=>{const o=provs()&&provs().ollama;return o&&o.ok&&Array.isArray(o.models)?o.models.slice():[]};
const openaiList=()=>{const o=provs()&&provs().openai;return o&&o.ok&&Array.isArray(o.models)?o.models.slice():[]};
// The one local model: what the relay reports loaded (a "loaded" list from Ollama's /api/ps, when exposed), else the first pulled.
export function localModel(){const o=provs()&&provs().ollama;if(!o||!o.ok)return '';const l=Array.isArray(o.loaded)&&o.loaded.length?o.loaded[0]:null;
  const name=l&&(typeof l==='string'?l:l.name||l.model);return name||(pulled()[0]||'')}
// 'ready' (relay up, runners on), 'norunners' (relay up, runners off), 'offline', 'checking'
export function relayState(){if(!relay.health&&!relay.runner)return relay.at?'offline':'checking';
  if(!relay.runner)return 'offline';return relay.runner.enabled?'ready':'norunners'}
export const modelOptions=()=>[['anthropic:'+CLAUDE_MODELS.haiku,'Claude Haiku'],['anthropic:'+CLAUDE_MODELS.sonnet,'Claude Sonnet']]
  .concat(pulled().map(m=>['ollama:'+m,m+' · local'])).concat(openaiList().map(m=>['openai:'+m,m+' · openai']));
const split=v=>{const i=String(v).indexOf(':');return i<0?{provider:v,model:''}:{provider:v.slice(0,i),model:v.slice(i+1)}};
const joinMind=m=>m&&m.provider?m.provider+':'+(m.model||''):'';
const labelOf=m=>{const o=modelOptions().find(x=>x[0]===joinMind(m));return o?o[1]:m&&m.model?m.model+(m.provider==='ollama'?' · local':m.provider==='openai'?' · openai':''):'no model'};

// ---- state ----
function initialSetup(){const last=readLast(),seed=newSeed();
  if(last){last.seed=seed;last.world=last.world||WORLD_ID;return last}
  return defaultSetup(seed,WORLD_ID,Math.random()<.5?0:1)}
const mindOf=who=>who==='dm'?st.setup.dm:st.setup.slots[who].mind;
function setMode(who,mode){const m=mindOf(who);if(who==='dm'){st.setup.dm=mode==='agent'?{mode,provider:'anthropic',model:CLAUDE_MODELS.sonnet}:{mode:'scripted'};return}
  const keep=m.provider?{provider:m.provider,model:m.model}:{provider:'anthropic',model:CLAUDE_MODELS.haiku};
  st.setup.slots[who].mind=mode==='scripted'?{mode}:{mode,...keep}}
function setModel(who,v){const m=mindOf(who),p=split(v);Object.assign(m,p)}
function problems(){const out=validateSetup(st.setup);return out}

// ---- building the page ----
function build(){root=el('div','setup');root.id='setup';root.hidden=true;root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','New World setup');
  document.body.append(root);
  root.addEventListener('click',onClick);root.addEventListener('change',onChange);root.addEventListener('input',onInput);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&root&&!root.hidden&&!st.first)cancel()})}
const btn=(label,a,extra={},cls='')=>{const b=el('button','mini'+(cls?' '+cls:''),label);b.dataset.a=a;for(const k in extra)b.dataset[k]=extra[k];return b};
function select(f,opts,value,title){const s=el('select','msel');s.dataset.f=f;if(title)s.title=title;
  for(const [v,t] of opts){const o=new Option(t,v);if(v===value)o.selected=true;s.append(o)}s.value=value;return s}
function field(label,...kids){const d=el('label','sfield');d.append(el('span','slbl',label),...kids);return d}

// A member's mind is always an agent (#148): only its model is chosen. The DM may be scripted or an agent.
function mindControls(who,m){const d=el('div','smind'),seg=el('span','mseg');
  const modes=who==='dm'?['scripted','agent']:[];
  if(who!=='dm')seg.append(el('span','dm','Agent'));
  for(const k of modes){const b=btn(who==='dm'&&k==='agent'?'DM agent':MODE_TEXT[k],'mode',{who,mode:k});b.title=MODE_TITLE[k];b.setAttribute('aria-pressed',String(m.mode===k));seg.append(b)}
  d.append(seg);
  if(m.mode!=='scripted'){const opts=modelOptions();if(m.model&&!opts.some(o=>o[0]===joinMind(m)))opts.push([joinMind(m),labelOf(m)+' (not reported by the relay)']);
    d.append(select('mind:'+who,opts,joinMind(m),'Which model plays '+(who==='dm'?'the DM':'this hero')))}
  return d}

function slotCard(k){const p=st.setup.slots[k],card=el('div','scard'),top=el('div','stop');
  top.append(el('span','srole',slotLabel(k)+(k.startsWith('dps')?' '+k.slice(3):'')));
  const klass=slotClasses(k);
  top.append(select('cls:'+k,klass.map(c=>[c,c]),p.cls,'Class'));card.append(top);
  const nm=el('input','sinput');nm.type='text';nm.maxLength=24;nm.placeholder='name: any';nm.value=p.name||'';nm.dataset.f='name:'+k;nm.setAttribute('aria-label','Name for the '+slotLabel(k));
  const row=el('div','snamerow');row.append(nm,btn('Reroll','nameroll',{slot:k},'sdice'));
  const rs=racesOf(st.setup.fac);
  const people=select('race:'+k,[['','any people']].concat(rs.map(r=>[r.id,r.name])),p.race||'','People');
  card.append(field('Name',row));card.append(field('People',people));
  card.append(field('Mind',mindControls(k,p.mind)));
  return card}

function relayLine(){const s=relayState(),d=el('div','srelay '+s);
  const agentsWanted=planRunners(st.setup).length>0;
  const t={checking:'Checking the relay…',offline:'Relay offline (npm run relay -- --runners).',norunners:'Relay is up, but runners are off (npm run relay -- --runners).',ready:'Relay ready, runners on.'}[s];
  d.append(el('span','sdot'),el('span',null,t));
  if(s==='ready'||s==='norunners'){const lm=localModel();d.append(el('span','dm',lm?' Local model: '+lm+'.':pulled().length?'':' No local model pulled.'))}
  if(agentsWanted&&s!=='ready')d.append(el('div','dm','Agent minds can still start: the heroes play on reflexes and are shown as AGENT until you start their runners from the Minds panel or a terminal.'));
  return d}

function runnerSummary(){const plan=planRunners(st.setup);if(!plan.length)return 'No runners needed: every mind is scripted or AI.';
  const max=relay.runner&&relay.runner.max;
  return 'On Start: '+plan.map(r=>r.kind==='fellowship'?'one Fellowship runner ('+labelOf(r)+')':r.kind==='dm'?'the DM runner ('+labelOf(r)+')':r.label+' runner ('+labelOf(r)+')').join(', ')+'. '+plan.length+(max?' of '+max+' runners allowed.':' runner'+(plan.length===1?'':'s')+'.')}

function render(){if(!root)return;const s=st.setup,page=el('div','spage');
  const head=el('div','shead');head.append(el('h2',null,'New World'),el('div','dm','Build the world, choose who plays whom, and the heroes are agent-played from the first minute. Nothing changes until you press Start.'));page.append(head);

  const pre=el('div','spresets');pre.append(el('span','slbl','Presets'));
  const lm=localModel(),last=readLast();
  const mk=(label,name,off,why)=>{const b=btn(label,'preset',{name});if(off){b.classList.add('off');b.title=why}return b};
  pre.append(mk('All agents (Haiku), DM scripted','haiku'),mk('All agents (Haiku), DM on Sonnet','claude'),mk('All local'+(lm?' ('+lm+')':''),'local',!lm,'The relay reports no local model: start Ollama and pull one'),mk('Last used','last',!last,'Nothing remembered yet'));
  page.append(pre);

  const wsec=el('section','ssec');wsec.append(el('h3',null,'World'));
  const wrow=el('div','sgrid');
  wrow.append(field('World',select('world',Object.keys(WORLDS_INFO).map(id=>[id,WORLDS_INFO[id]]),s.world)));
  const seed=el('input','sinput');seed.type='number';seed.min=0;seed.step=1;seed.value=String(s.seed);seed.dataset.f='seed';seed.setAttribute('aria-label','Seed');
  const sr=el('div','snamerow');sr.append(seed,btn('Reroll','seedroll',{},'sdice'));wrow.append(field('Seed',sr));
  wrow.append(field('Faction',select('fac',FAC.map((f,i)=>[String(i),f.name]),String(s.fac))));
  const fn=el('input','sinput');fn.type='text';fn.maxLength=40;fn.placeholder='Fellowship name: chosen for you';fn.value=s.name||'';fn.dataset.f='fname';
  wrow.append(field('Fellowship name',fn));
  wsec.append(wrow);page.append(wsec);

  const fsec=el('section','ssec');fsec.append(el('h3',null,'The Fellowship'),el('div','dm','Five places, level 1, in their hall. Roles are fixed; each place takes the classes of its role.'));
  const cards=el('div','scards');for(const k of ROLE_ORDER)cards.append(slotCard(k));fsec.append(cards);page.append(fsec);

  const dsec=el('section','ssec');dsec.append(el('h3',null,'The Dungeon Master'),mindControls('dm',s.dm),
    el('div','dm',s.dm.mode==='agent'?'The DM seat opens at once; a DM agent prepares the campaign and pulls levers.':'The scripted DM runs the world.'));page.append(dsec);

  const fin=el('section','ssec sfinal');fin.append(relayLine(),el('div','dm srun',runnerSummary()));
  const ps=problems();
  if(ps.length){const ul=el('ul','sprobs');for(const p of ps)ul.append(el('li',null,p));fin.append(ul)}
  if(st.error)fin.append(el('div','sbad',st.error));
  if(st.confirm){const sum=saveSummary(s.world),c=el('div','sconfirm');
    c.append(el('div',null,'Replace the saved '+(WORLDS_INFO[s.world]||s.world)+' world'+(sum?' (day '+sum.day+', '+sum.kb+' KB)':'')+'? It cannot be brought back unless you export it first.'));
    const row=el('div','sbtns');if(s.world===WORLD_ID)row.append(btn('Export it first','export'));row.append(btn('Replace and start','go',{},'primary'),btn('Back','back'));c.append(row);fin.append(c)}
  else{const row=el('div','sbtns'),state=relayState(),agents=planRunners(s).length>0;
    const go=btn(agents&&state!=='ready'&&state!=='checking'?'Start; I will start the runners myself':'Start','start',{},'primary');
    if(ps.length){go.classList.add('off');go.disabled=true}
    row.append(go,btn(st.first?'Play the default world':'Cancel','cancel'));fin.append(row)}
  page.append(fin);
  root.replaceChildren(page)}

// Update only the model lists when the relay's answer changes (never under a focused field).
let lastModelSig='';
function syncModels(){if(!st)return;const sig=JSON.stringify([modelOptions(),relayState(),localModel(),relay.runner&&relay.runner.max]);if(sig===lastModelSig)return;lastModelSig=sig;
  const a=document.activeElement;if(a&&a.tagName==='INPUT')return;render()}

// ---- events ----
function onInput(e){const t=e.target;if(!t||!t.dataset||!t.dataset.f)return;const f=t.dataset.f;
  if(f==='seed'){st.setup.seed=t.value===''?NaN:Math.floor(+t.value)}
  else if(f==='fname'){st.setup.name=t.value}
  else if(f.startsWith('name:')){const k=f.slice(5);if(t.value.trim())st.setup.slots[k].name=t.value;else delete st.setup.slots[k].name}
  else return;
  st.confirm=false;st.error='';refreshFinal()}
// Re-render only the bottom block after typing, so a focused field keeps its caret.
function refreshFinal(){const a=document.activeElement,tag=a&&a.dataset&&a.dataset.f,pos=a&&a.selectionStart;
  render();if(tag){const n=root.querySelector('[data-f="'+tag+'"]');if(n&&n.focus){n.focus();try{if(pos!=null)n.setSelectionRange(pos,pos)}catch(x){}}}}

function onChange(e){const t=e.target;if(!t||!t.dataset||!t.dataset.f)return;const f=t.dataset.f,v=t.value;st.confirm=false;st.error='';
  if(f==='world')st.setup.world=v;
  else if(f==='fac'){st.setup.fac=+v;for(const k of ROLE_ORDER){delete st.setup.slots[k].race;delete st.setup.slots[k].name}}
  else if(f.startsWith('cls:'))st.setup.slots[f.slice(4)].cls=v;
  else if(f.startsWith('race:')){const k=f.slice(5);if(v)st.setup.slots[k].race=v;else delete st.setup.slots[k].race}
  else if(f.startsWith('mind:'))setModel(f.slice(5),v);
  else return;
  render()}

function onClick(e){const t=e.target&&e.target.closest?e.target.closest('[data-a]'):null;if(!t||t.disabled)return;const a=t.dataset.a;st.error='';
  if(a==='preset'){const r=applyPreset(t.dataset.name,st.setup,{local:localModel(),last:readLast()});if(!r){st.error='That preset is not available right now.'}else{r.seed=st.setup.seed;r.world=st.setup.world;st.setup=r}st.confirm=false}
  else if(a==='mode'){setMode(t.dataset.who,t.dataset.mode);st.confirm=false}
  else if(a==='seedroll'){st.setup.seed=newSeed();st.confirm=false}
  else if(a==='nameroll'){rollName(t.dataset.slot);st.confirm=false}
  else if(a==='start')return start();
  else if(a==='go')return go();
  else if(a==='back')st.confirm=false;
  else if(a==='export')exportSave();
  else if(a==='cancel')return cancel();
  else return;
  render()}

function rollName(k){const p=st.setup.slots[k],rs=racesOf(st.setup.fac);if(!rs.length)return;
  const taken=new Set(ROLE_ORDER.filter(x=>x!==k).map(x=>(st.setup.slots[x].name||'').toLowerCase()));
  for(let i=0;i<20;i++){const r=p.race||rs[Math.floor(Math.random()*rs.length)].id,n=suggestName(r,Math.random(),Math.random());if(!taken.has(n.toLowerCase())){p.name=n;return}}}

function start(){if(problems().length)return;
  if(!st.confirm&&saveSummary(st.setup.world)){st.confirm=true;render();return}
  go()}
function go(){if(problems().length)return;const s=cleanSetup(st.setup);
  try{store().setItem(LAST_KEY,JSON.stringify(s))}catch(e){}
  const err=queueNewWorld(s);if(err){st.error=err;st.confirm=false;render()}}

function cancel(){close()}
function close(){if(root)root.hidden=true;holdSave(false);if(pausedAt!=null){if(ctl.speed===0)ctl.speed=pausedAt;pausedAt=null}}

export function openSetup({first=false}={}){if(!root)build();
  st={setup:initialSetup(),first,confirm:false,error:''};
  if(pausedAt==null){pausedAt=ctl.speed||1;ctl.speed=0} // the world waits while you choose
  holdSave(true);lastModelSig='';pollRelay(true);render();root.hidden=false;
  const f=root.querySelector('button');if(f&&f.focus)f.focus()}

export function initSetup(){setNewWorldHandler(()=>openSetup({first:false}));setInterval(()=>{if(root&&!root.hidden)pollRelay()},1500)}

// ---- after a setup boot: start the runners ----
let bar=null,launch=null;
function barEl(){if(bar)return bar;bar=el('div','nwbar');bar.setAttribute('role','status');document.body.prepend(bar);return bar}
function paintBar(){if(!launch)return;const b=barEl(),L=launch;b.hidden=false;
  const row=el('div','nwrow');row.append(el('span','nwt','New World'),el('span',null,L.headline));
  const items=el('div','nwitems');
  for(const j of L.jobs){const link=j.link(),r=j.key?runnerByKey(j.key):null;
    const word=j.error?'not started: '+j.error:link==='connected'?'live':link==='waiting'?'claimed':r&&r.state==='starting'?'starting…':r?r.state:L.sent?'starting…':'waiting';
    const c=el('span','nwitem '+(j.error?'bad':link==='connected'||link==='waiting'?'ok':''),j.label+': '+word);items.append(c)}
  row.append(btn('Dismiss','nwclose'));
  b.replaceChildren(row,items)}
document.addEventListener('click',e=>{const t=e.target&&e.target.closest?e.target.closest('[data-a="nwclose"]'):null;if(t&&bar){bar.hidden=true;launch=null}});

async function post(path,body){try{const r=await fetch(relayBase()+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));
    return {ok:r.ok,code:r.status,error:j.how||j.error||('HTTP '+r.status)}}catch(e){return {ok:false,code:0,error:'The relay is not reachable'}}}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

export async function afterBoot(){const setup=appliedSetup();if(!setup||bootKind()!=='setup')return;
  const plan=planRunners(setup);if(!plan.length)return;
  const mem=Object.fromEntries(fellowshipMembers().map(m=>[m.slot,m.hero]));
  const jobs=plan.map(r=>({...r,
    key:r.kind==='hero'?'hero:'+(mem[r.slot]&&mem[r.slot].id):r.kind,
    label:r.kind==='hero'?(mem[r.slot]?mem[r.slot].name:r.label):r.kind==='dm'?'DM':'Fellowship',
    link:()=>r.kind==='dm'?dmLink():r.kind==='fellowship'?worst(SLOT_KEYS.map(k=>mem[k])):agentLink(mem[r.slot]||null),
    error:''}));
  launch={jobs,sent:false,headline:'Starting the runners…'};paintBar();
  if(ctl.speed===0)ctl.speed=1; // the run gate (ui/rungate.js) holds the world until every runner has claimed, then it plays on
  const timer=setInterval(paintBar,700);
  const claimed=()=>jobs.every(j=>j.error||j.link()==='connected'||j.link()==='waiting');
  let info=null;try{info=await (await fetch(relayBase()+'/play/runner')).json()}catch(e){}
  if(!info||!info.enabled){const why=!info?'The relay is not reachable: start it (npm run relay -- --runners).':(info.how||'Runners are off on the relay: start them yourself.');
    for(const j of jobs)j.error='no runner';launch.headline=why+' The world stays paused until they connect.';clearInterval(timer);paintBar();return}
  launch.sent=true;launch.headline='Runners are starting. The world is paused until they all claim their seats.';
  for(const j of jobs){const body={kind:j.kind,provider:j.provider,model:j.model,...(j.kind==='hero'?{hero:mem[j.slot].id}:{})};
    let r;for(let i=0;i<10;i++){r=await post('/play/runner/start',body);if(r.ok||r.code!==404)break;await sleep(1000)} // the page tells the relay which heroes are agent-played a moment after loading
    if(!r.ok)j.error=r.error}
  const failed=jobs.filter(j=>j.error);
  launch.headline=failed.length?failed.length+' of '+jobs.length+' runners did not start. The world stays paused: start the rest from the bar over the map.':'All runners started; the world plays on when they have claimed.';
  paintBar();
  for(let i=0;i<20&&!claimed();i++)await sleep(500);
  if(claimed()&&!failed.length)launch.headline='All runners have claimed their seats; the world is running.';
  paintBar();setTimeout(()=>{clearInterval(timer)},60000)}
const worst=hs=>{const ls=hs.filter(Boolean).map(h=>agentLink(h));return ls.some(l=>l!=='connected'&&l!=='waiting')?'none':ls.includes('waiting')?'waiting':'connected'};
