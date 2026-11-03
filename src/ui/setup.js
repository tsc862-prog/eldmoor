// New World setup page (issue #133): choose the world, the Fellowship (class, name, people and mind per
// place) and the DM, then build the world with those heroes already agent-played and start their runners.
//   initSetup()    binds the World bar's "New world" button to the page
//   openSetup({first})  show the page; first = the first visit with no save (Cancel plays the default world)
//   afterBoot()    called once the page is built: when this boot applied a setup, start its runners
// The rules (classes per role, names, minds, presets, which runners) are DOM-free in src/sim/setup.js; this
// file is the form, the relay status and the runner launch. Choices are remembered per viewer in localStorage
// (eldmoor.setup.last). Starting reloads the page into the new world (ui/save.js queueNewWorld), where
// init({setup}) builds it, so every panel starts from state as for any boot.
import {fellowshipMembers,defaultSetup,validateSetup,cleanSetup,applyPreset,suggestName,CLAUDE_MODELS,slotClasses,slotLabel,planRunners,ARCHETYPE_RANDOM,asV2} from '../sim/index.js';
import {companies} from '../sim/company.js';
import {S} from '../sim/state.js';
import {slotsOf,groupsOf,MAX_HEROES,CLASSIC,seatCap,seatNote} from '../sim/setup.js';
import {CLS} from '../data/classes.js';
import {CITY,REGIONS} from '../world/map.js';
import {ARCHETYPES,ARCHETYPE_IDS} from '../data/archetypes.js'; // persona archetypes (#295)
import {SLOT_KEYS} from '../sim/fellowship.js';
import {racesOf} from '../data/races.js';
import {PROF,PROF_IDS,MAX_PROF} from '../data/professions.js';
import {FAC} from '../data/factions.js';
import {CFG} from '../sim/brain.js';
import {WORLD_ID} from '../world/map.js';
import {WORLDS} from '../world/spec.js';
import {bridgeUrl,agentLink,dmLink} from './player-bridge.js';
import {runnerByKey} from './runners.js';
import {ctl} from './controls.js';
import {bootKind,appliedSetup,holdSave,setNewWorldHandler,saveSummary,queueNewWorld,exportSave,exportStored,isBooted} from './save.js';

const LAST_KEY='eldmoor.setup.last';
const WORLDS_INFO=Object.fromEntries(Object.keys(WORLDS).map(id=>[id,WORLDS[id].name||id]));
const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
const store=()=>{try{return window.localStorage}catch(e){return null}};
// The page edits a v2 setup (#453, #454): Together keeps the five places, Apart a list of 1-5 heroes. A stored v1 setup
// migrates through cleanSetup.
const readLast=()=>{try{const j=JSON.parse(store().getItem(LAST_KEY));return j&&(j.slots||j.heroes)?cleanSetup(j):null}catch(e){return null}};
const newSeed=()=>1+Math.floor(Math.random()*999999);
const ROLE_ORDER=SLOT_KEYS;
const MODE_TEXT={scripted:'Scripted',ai:'AI',agent:'Agent'};
const MODE_TITLE={scripted:'The scripted rules play this hero',ai:'A language model decides through the relay (scripted when it is silent)',agent:'An agent runner plays this hero through the game tools; shown as AGENT from the first minute'};

let root=null,st=null,pausedAt=null; // st: {setup, first, confirm, error, back, confirmed}
let relay={health:null,runner:null,at:0,busy:false};
const relayWatchers=new Set(); // the title screen listens for relay answers too

// ---- the relay: models and runners ----
const relayBase=()=>bridgeUrl().replace(/^ws(s?):/,'http$1:').replace(/\/play\/?$/,'');
const healthUrl=()=>CFG.url.replace(/\/decide$/,'/health');
export function pollRelay(force){if(relay.busy||typeof fetch!=='function')return;if(!force&&Date.now()-relay.at<4000)return;relay.busy=true;relay.at=Date.now();
  const get=u=>fetch(u).then(r=>r.json()).catch(()=>null);
  Promise.all([get(healthUrl()),get(relayBase()+'/play/runner')]).then(([h,r])=>{relay.health=h&&typeof h==='object'?h:null;relay.runner=r&&typeof r==='object'?r:null})
    .finally(()=>{relay.busy=false;if(root&&!root.hidden)syncModels();for(const f of relayWatchers)f()})}
export const watchRelay=f=>{relayWatchers.add(f);return ()=>relayWatchers.delete(f)};
export const pulledModels=()=>pulled();
const provs=()=>relay.health&&relay.health.providers||null;
const pulled=()=>{const o=provs()&&provs().ollama;return o&&o.ok&&Array.isArray(o.models)?o.models.slice():[]};
const hfList=()=>{const o=provs()&&provs().huggingface;return o&&o.ok&&Array.isArray(o.models)?o.models.slice():[]};
const openaiList=()=>{const o=provs()&&provs().openai;return o&&o.ok&&Array.isArray(o.models)?o.models.slice():[]};
// The one local model: what the relay reports loaded (a "loaded" list from Ollama's /api/ps, when exposed), else the first pulled.
export function localModel(){const o=provs()&&provs().ollama;if(!o||!o.ok)return '';const l=Array.isArray(o.loaded)&&o.loaded.length?o.loaded[0]:null;
  const name=l&&(typeof l==='string'?l:l.name||l.model);return name||(pulled()[0]||'')}
// 'ready' (relay up, runners on), 'norunners' (relay up, runners off), 'offline', 'checking'
export function relayState(){if(!relay.health&&!relay.runner)return relay.at?'offline':'checking';
  if(!relay.runner)return 'offline';return relay.runner.enabled?'ready':'norunners'}
export const modelOptions=()=>[['anthropic:'+CLAUDE_MODELS.haiku,'Claude Haiku'],['anthropic:'+CLAUDE_MODELS.sonnet,'Claude Sonnet']]
  .concat(pulled().map(m=>['ollama:'+m,m+' · local'])).concat(openaiList().map(m=>['openai:'+m,m+' · openai'])).concat(hfList().map(m=>['huggingface:'+m,m+' · huggingface']));
const split=v=>{const i=String(v).indexOf(':');return i<0?{provider:v,model:''}:{provider:v.slice(0,i),model:v.slice(i+1)}};
const joinMind=m=>m&&m.provider?m.provider+':'+(m.model||''):'';
const labelOf=m=>{const o=modelOptions().find(x=>x[0]===joinMind(m));return o?o[1]:m&&m.model?m.model+(m.provider==='ollama'?' · local':m.provider==='openai'?' · openai':m.provider==='huggingface'?' · huggingface':''):'no model'};

// ---- state ----
// Together rides the five places in slot order (card key = slot key, hero index = place); Apart lists heroes by index (card key "0".."4").
// Put a together setup's heroes in place order; one that is not the five becomes the classic five.
function norm(s){if(s.mode==='apart')return s;const map=slotsOf(s);
  if(map){s.heroes=SLOT_KEYS.map(k=>s.heroes[map[k]]);return s}
  return applyPreset('classic',s)||s}
function initialSetup(){const last=readLast(),seed=newSeed();
  if(last){last.seed=seed;last.world=last.world||WORLD_ID;return norm(last)}
  return defaultSetup(seed,WORLD_ID,Math.random()<.5?0:1)}
const together=()=>st.setup.mode!=='apart';
const keys=()=>together()?ROLE_ORDER.slice():st.setup.heroes.map((h,i)=>String(i));
const idx=k=>together()?ROLE_ORDER.indexOf(k):+k;
const heroAt=k=>st.setup.heroes[idx(k)];
const heroTitle=k=>together()?slotLabel(k)+(k.startsWith('dps')?' '+k.slice(3):''):'Hero '+(+k+1);
const facOfHero=h=>h.fac!=null?h.fac:st.setup.fac;
const mindOf=who=>who==='dm'?st.setup.dm:heroAt(who).mind;
function setMode(who,mode){const m=mindOf(who);if(who==='dm'){st.setup.dm=mode==='agent'?{mode,provider:'anthropic',model:CLAUDE_MODELS.sonnet}:{mode:'scripted'};return}
  const keep=m.provider?{provider:m.provider,model:m.model}:{provider:'anthropic',model:CLAUDE_MODELS.haiku};
  heroAt(who).mind=mode==='scripted'?{mode}:{mode,...keep}}
// Runners as the relay can start them today: it has no company kind yet (#402 slice 23), so a group sharing one mind starts one runner per hero.
const plan=s=>planRunners(s).flatMap(r=>r.kind==='company'?r.heroes.map(i=>({kind:'hero',index:i,provider:r.provider,model:r.model,label:s.heroes[i].name||s.heroes[i].cls})):[r]);
const sharesMind=s=>planRunners(s).some(r=>r.kind==='company');
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

// Apart: where a hero sets out (#454). 'home' = its people's home town; a town of its faction (the CITY rows, no names here);
// or a region, seasoned to the low end of its band.
const startValue=h=>{const st=h.start||{};return st.region?'region:'+st.region:st.town&&st.town!=='home'?'town:'+st.town:'home'};
const startOptions=h=>[['home','Home town of their people']].concat(CITY.filter(c=>c.fac===facOfHero(h)).map(c=>['town:'+c.name,'Town: '+c.name]))
  .concat(REGIONS.map(r=>['region:'+r.name,'Region: '+r.name+(r.band?' (L'+r.band[0]+'+)':'')]));
const groupOptions=n=>[['','Alone']].concat(Array.from({length:n},(x,i)=>[String(i+1),'Company '+(i+1)]));
function slotCard(k){const p=heroAt(k),card=el('div','scard'),top=el('div','stop'),T=heroTitle(k);
  top.append(el('span','srole',T));
  const klass=together()?slotClasses(k):Object.keys(CLS);
  top.append(select('cls:'+k,klass.map(c=>[c,c]),p.cls,'Class'));card.append(top);
  const nm=el('input','sinput');nm.type='text';nm.maxLength=24;nm.placeholder='name: any';nm.value=p.name||'';nm.dataset.f='name:'+k;nm.setAttribute('aria-label','Name for '+T);
  const row=el('div','snamerow');row.append(nm,btn('Reroll','nameroll',{slot:k},'sdice'));
  const rs=racesOf(facOfHero(p));
  const people=select('race:'+k,[['','any people']].concat(rs.map(r=>[r.id,r.name])),p.race||'','People');
  if(!together()){
    card.append(field('Faction',select('hfac:'+k,FAC.map((f,i)=>[String(i),f.name]),String(facOfHero(p)),'Faction of '+T)));
    card.append(field('Starts in',select('start:'+k,startOptions(p),startValue(p),'Where '+T+' sets out')));
    const n=st.setup.heroes.length;
    if(n>1)card.append(field('Group',select('group:'+k,groupOptions(n),p.group==null?'':String(p.group),'Heroes of one group ride as one company')));
  }
  card.append(field('Name',row));card.append(field('People',people));
  card.append(archControls(k,p));
  card.append(profControls(k,p));
  card.append(field('Mind',mindControls(k,p.mind)));
  return card}

// A persona archetype for a place (#295): None, one of the six, or Random (picked from the seed at founding).
export const archetypeOptions=()=>[['','None'],...ARCHETYPE_IDS.map(id=>[id,ARCHETYPES[id].name]),[ARCHETYPE_RANDOM,'Random']];
export const archetypeHint=v=>!v?'Their own voice, from the world.':v===ARCHETYPE_RANDOM?'One of the six, picked from the seed.':ARCHETYPES[v]?ARCHETYPES[v].voice:'';
const archControls=(k,p)=>field('Archetype',select('arch:'+k,archetypeOptions(),p.archetype||'','Persona archetype for '+heroTitle(k)),el('span','dm sarchnote',archetypeHint(p.archetype)));

// Up to MAX_PROF professions for a place, or none chosen = "let them choose" (the hero picks in play, #259).
function profControls(k,p){const d=el('div','sfield'),chosen=p.profs||[],row=el('div','sprofs');
  d.append(el('span','slbl','Professions'));
  for(const id of PROF_IDS){const on=chosen.includes(id),full=!on&&chosen.length>=MAX_PROF;
    const b=btn(PROF[id].name,'prof',{slot:k,id},full?'dis':'');b.title=PROF[id].kind+': '+PROF[id].blurb;b.setAttribute('aria-pressed',String(on));if(full)b.disabled=true;row.append(b)}
  d.append(row,el('div','dm sprofnote',chosen.length?chosen.map(id=>PROF[id].name).join(' and ')+' at skill 1.':'Let them choose (up to '+MAX_PROF+').'));
  return d}

function relayLine(){const s=relayState(),d=el('div','srelay '+s);
  const agentsWanted=plan(st.setup).length>0;
  const t={checking:'Checking the relay…',offline:'Relay offline (npm run relay -- --runners).',norunners:'Relay is up, but runners are off (npm run relay -- --runners).',ready:'Relay ready, runners on.'}[s];
  d.append(el('span','sdot'),el('span',null,t));
  if(s==='ready'||s==='norunners'){const lm=localModel();d.append(el('span','dm',lm?' Local model: '+lm+'.':pulled().length?'':' No local model pulled.'))}
  if(agentsWanted&&s!=='ready')d.append(el('div','dm','Agent minds can still start: the heroes play on reflexes and are shown as AGENT until you start their runners from the Minds panel or a terminal.'));
  return d}

function runnerSummary(){const pl=plan(st.setup);if(!pl.length)return 'No runners needed: every mind is scripted or AI.';
  const max=relay.runner&&relay.runner.max;
  return (sharesMind(st.setup)?'Heroes of one group sharing a mind start one runner each for now. ':'')+'On Start: '+pl.map(r=>r.kind==='fellowship'?'one Fellowship runner ('+labelOf(r)+')':r.kind==='dm'?'the DM runner ('+labelOf(r)+')':r.label+' runner ('+labelOf(r)+')').join(', ')+'. '+pl.length+(max?' of '+max+' runners allowed.':' runner'+(pl.length===1?'':'s')+'.')}

function render(){if(!root)return;const s=st.setup,page=el('div','spage');
  const head=el('div','shead');head.append(el('h2',null,'New World'),el('div','dm','Build the world, choose who plays whom, and the heroes are agent-played from the first minute. Nothing changes until you press Start.'));page.append(head);

  const sw=el('div','spresets sswitch');sw.setAttribute('role','group');sw.setAttribute('aria-label','How the heroes start');sw.append(el('span','slbl','Start'));
  for(const [m,t,why] of [['together','Together','One company of five in one hall: a Tank, a Healer and three DPS'],['apart','Apart','Heroes set out from their own start towns, alone or in groups']]){
    const b=btn(t,'smode',{mode:m});b.title=why;b.setAttribute('aria-pressed',String(together()?m==='together':m==='apart'));sw.append(b)}
  if(!together()){sw.append(el('span','slbl','Heroes'));
    for(let n=1;n<=MAX_HEROES;n++){const b=btn(String(n),'count',{n});b.setAttribute('aria-pressed',String(s.heroes.length===n));b.title=n+' hero'+(n===1?'':'es');if(n>seatCap(s)){b.classList.add('off');b.title=n+' heroes need every mind local (seats: 5 while any mind is paid, 10 when all are local)'}sw.append(b)}}
  page.append(sw);
  const shapes=el('div','spresets');shapes.append(el('span','slbl','Shapes'));
  for(const [l,n,w] of [['Classic five','classic','The five together in one hall'],['Five solos','five-solos','The five, each alone in its own home town'],['Pairs and a solo','pairs-and-solo','Warrior and Priest, Mage and Hunter, the Rogue alone'],['One hero','solo','A single hero']]){const b=btn(l,'preset',{name:n});b.title=w;shapes.append(b)}
  page.append(shapes);
  const pre=el('div','spresets');pre.append(el('span','slbl','Minds'));
  const lm=localModel(),last=readLast();
  const mk=(label,name,off,why)=>{const b=btn(label,'preset',{name});if(off){b.classList.add('off');b.title=why}return b};
  pre.append(mk('All agents (Haiku), DM scripted','haiku'),mk('All agents (Haiku), DM on Sonnet','claude'),mk('All local'+(lm?' ('+lm+')':''),'local',!lm,'The relay reports no local model: start Ollama and pull one'),mk('Last used','last',!last,'Nothing remembered yet'));
  page.append(pre);

  const wsec=el('section','ssec');wsec.append(el('h3',null,'World'));
  const wrow=el('div','sgrid');
  wrow.append(field('World',select('world',Object.keys(WORLDS_INFO).map(id=>[id,WORLDS_INFO[id]]),s.world)));
  const seed=el('input','sinput');seed.type='number';seed.min=0;seed.step=1;seed.value=String(s.seed);seed.dataset.f='seed';seed.setAttribute('aria-label','Seed');
  const sr=el('div','snamerow');sr.append(seed,btn('Reroll','seedroll',{},'sdice'));wrow.append(field('Seed',sr));
  if(together()){wrow.append(field('Faction',select('fac',FAC.map((f,i)=>[String(i),f.name]),String(s.fac))));
    const fn=el('input','sinput');fn.type='text';fn.maxLength=40;fn.placeholder='Fellowship name: chosen for you';fn.value=s.name||'';fn.dataset.f='fname';
    wrow.append(field('Fellowship name',fn))}
  wsec.append(wrow);page.append(wsec);

  const fsec=el('section','ssec');
  if(together())fsec.append(el('h3',null,'The Fellowship'),el('div','dm','Five places, level 1, in their hall. Roles are fixed; each place takes the classes of its role.'));
  else fsec.append(el('h3',null,'The heroes'),el('div','dm','Each hero sets out from its own start town: at level 1 in town, or seasoned to a region and out hunting there. Heroes of one group ride as one company; a hero with no group is alone. A company is of one faction.'));
  const cards=el('div','scards');for(const k of keys())cards.append(slotCard(k));fsec.append(cards);page.append(fsec);

  const dsec=el('section','ssec');dsec.append(el('h3',null,'The Dungeon Master'),mindControls('dm',s.dm),
    el('div','dm',s.dm.mode==='agent'?'The DM seat opens at once; a DM agent prepares the campaign and pulls levers.':'The scripted DM runs the world.'));page.append(dsec);

  const fin=el('section','ssec sfinal');fin.append(relayLine(),el('div','dm srun',runnerSummary()));
  const ps=problems();
  if(ps.length){const ul=el('ul','sprobs');for(const p of ps)ul.append(el('li',null,p));fin.append(ul)}
  {const note=seatNote(s);if(note)fin.append(el('div','dm sseatnote',note))}
  if(st.error)fin.append(el('div','sbad',st.error));
  if(st.confirm){const sum=saveSummary(s.world),c=el('div','sconfirm');
    c.append(el('div',null,'Replace the saved '+(WORLDS_INFO[s.world]||s.world)+' world'+(sum?' (day '+sum.day+', '+sum.kb+' KB)':'')+'? It cannot be brought back unless you export it first.'));
    const row=el('div','sbtns');if(s.world===WORLD_ID||!isBooted())row.append(btn('Export it first','export'));row.append(btn('Replace and start','go',{},'primary'),btn('Back','back'));c.append(row);fin.append(c)}
  else{const row=el('div','sbtns'),state=relayState(),agents=plan(s).length>0;
    const go=btn(agents&&state!=='ready'&&state!=='checking'?'Start; I will start the runners myself':'Start','start',{},'primary');
    if(ps.length){go.classList.add('off');go.disabled=true}
    row.append(go,btn(st.back?'Back':st.first?'Play the default world':'Cancel','cancel'));fin.append(row)}
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
  else if(f.startsWith('name:')){const h=heroAt(f.slice(5));if(t.value.trim())h.name=t.value;else delete h.name}
  else return;
  st.confirm=false;st.error='';refreshFinal()}
// Re-render only the bottom block after typing, so a focused field keeps its caret.
function refreshFinal(){const a=document.activeElement,tag=a&&a.dataset&&a.dataset.f,pos=a&&a.selectionStart;
  render();if(tag){const n=root.querySelector('[data-f="'+tag+'"]');if(n&&n.focus){n.focus();try{if(pos!=null)n.setSelectionRange(pos,pos)}catch(x){}}}}

function onChange(e){const t=e.target;if(!t||!t.dataset||!t.dataset.f)return;const f=t.dataset.f,v=t.value;st.confirm=false;st.error='';
  if(f==='world')st.setup.world=v;
  else if(f==='fac'){st.setup.fac=+v;for(const h of st.setup.heroes){h.fac=+v;delete h.race;delete h.name}}
  else if(f.startsWith('hfac:')){const k=f.slice(5),h=heroAt(k);h.fac=+v;delete h.race;delete h.name;h.start={town:'home'};if(idx(k)===0)st.setup.fac=+v}
  else if(f.startsWith('start:')){const h=heroAt(f.slice(6)),i=v.indexOf(':');h.start=v==='home'?{town:'home'}:{[v.slice(0,i)]:v.slice(i+1)}}
  else if(f.startsWith('group:')){const h=heroAt(f.slice(6));if(v)h.group=+v;else delete h.group}
  else if(f.startsWith('cls:'))heroAt(f.slice(4)).cls=v;
  else if(f.startsWith('arch:')){const h=heroAt(f.slice(5));if(v)h.archetype=v;else delete h.archetype}
  else if(f.startsWith('race:')){const h=heroAt(f.slice(5));if(v)h.race=v;else delete h.race}
  else if(f.startsWith('mind:'))setModel(f.slice(5),v);
  else return;
  render()}

function onClick(e){const t=e.target&&e.target.closest?e.target.closest('[data-a]'):null;if(!t||t.disabled)return;const a=t.dataset.a;st.error='';
  if(a==='preset'){const r=applyPreset(t.dataset.name,st.setup,{local:localModel(),last:readLast()});if(!r){st.error='That preset is not available right now.'}else{r.seed=st.setup.seed;r.world=st.setup.world;st.setup=norm(r)}st.confirm=false}
  else if(a==='smode'){switchMode(t.dataset.mode);st.confirm=false}
  else if(a==='count'){setCount(+t.dataset.n);st.confirm=false}
  else if(a==='prof'){const p=heroAt(t.dataset.slot),id=t.dataset.id,l=(p.profs||[]).slice(),i=l.indexOf(id);
    if(i>=0)l.splice(i,1);else if(l.length<MAX_PROF)l.push(id);
    if(l.length)p.profs=l;else delete p.profs;st.confirm=false}
  else if(a==='mode'){setMode(t.dataset.who,t.dataset.mode);st.confirm=false}
  else if(a==='seedroll'){st.setup.seed=newSeed();st.confirm=false}
  else if(a==='nameroll'){rollName(t.dataset.slot);st.confirm=false}
  else if(a==='start')return start();
  else if(a==='go')return go();
  else if(a==='back')st.confirm=false;
  else if(a==='export'){if(isBooted()&&st.setup.world===WORLD_ID)exportSave();else exportStored(st.setup.world)}
  else if(a==='cancel')return cancel();
  else return;
  render()}

// Together <-> Apart keeps the heroes: Apart sends each from its home town; Together asks for the classic five again.
function switchMode(m){const s=st.setup;if(m===(s.mode||'together'))return;
  if(m==='apart'){s.mode='apart';s.heroes.forEach(h=>{h.fac=h.fac!=null?h.fac:s.fac;h.start=h.start||{town:'home'}});return}
  const t=applyPreset('classic',s);if(t){t.seed=s.seed;t.world=s.world;st.setup=norm(t)}}
// A hero count for Apart (1-5): more heroes continue the classic classes, fewer drop the last.
function setCount(n){const s=st.setup;if(s.mode!=='apart'||n<1||n>MAX_HEROES)return;
  while(s.heroes.length>n)s.heroes.pop();
  while(s.heroes.length<n){const used=s.heroes.map(h=>h.cls),cls=CLASSIC.find(c=>!used.includes(c))||CLASSIC[s.heroes.length%CLASSIC.length],prev=s.heroes[s.heroes.length-1];
    s.heroes.push({cls,fac:prev?facOfHero(prev):s.fac,start:{town:'home'},mind:prev&&prev.mind?{...prev.mind}:{mode:'agent',provider:'anthropic',model:CLAUDE_MODELS.haiku}})}
  for(const h of s.heroes)if(h.group!=null&&+h.group>n)delete h.group}

function rollName(k){const p=heroAt(k),rs=racesOf(facOfHero(p));if(!rs.length)return;
  const taken=new Set(keys().filter(x=>x!==k).map(x=>(heroAt(x).name||'').toLowerCase()));
  for(let i=0;i<20;i++){const r=p.race||rs[Math.floor(Math.random()*rs.length)].id,n=suggestName(r,Math.random(),Math.random());if(!taken.has(n.toLowerCase())){p.name=n;return}}}

function start(){if(problems().length)return;
  if(!st.confirm&&st.confirmed!==st.setup.world&&saveSummary(st.setup.world)){st.confirm=true;render();return}
  go()}
function go(){if(problems().length)return;const s=cleanSetup(st.setup);
  try{store().setItem(LAST_KEY,JSON.stringify(s))}catch(e){}
  const err=queueNewWorld(s);if(err){st.error=err;st.confirm=false;render()}}

function cancel(){const back=st&&st.back;close();if(back)back()}
function close(){if(root)root.hidden=true;holdSave(false);if(pausedAt!=null){if(ctl.speed===0)ctl.speed=pausedAt;pausedAt=null}}

// back: opened from the title screen; Back (or Escape) closes the page and calls it. confirmed: the world whose save the
// owner already agreed to replace on the title screen, so Start does not ask again for it.
export function openSetup({first=false,back=null,confirmed=null}={}){if(!root)build();
  st={setup:initialSetup(),first:first&&!back,confirm:false,error:'',back,confirmed};if(back)st.setup.world=WORLD_ID; // the map chosen on the title
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
  const v2=asV2(setup),pl=plan(v2);if(!pl.length)return;
  // The hero a runner plays: together by its place, apart by its index (companies are founded in group order, members in group order).
  const mem=Object.fromEntries(fellowshipMembers().map(m=>[m.slot,m.hero])),byIdx={};
  if(v2.mode==='apart'){const flat=groupsOf(v2).flat(),ids=companies().flatMap(C=>C.ids);flat.forEach((i,n)=>{byIdx[i]=ids[n]!=null?S.agents.find(a=>a.id===ids[n]):null})}
  const heroOf=r=>r.slot?mem[r.slot]:byIdx[r.index]||null;
  const jobs=pl.map(r=>({...r,
    key:r.kind==='hero'?'hero:'+(heroOf(r)&&heroOf(r).id):r.kind,
    label:r.kind==='hero'?(heroOf(r)?heroOf(r).name:r.label):r.kind==='dm'?'DM':'Fellowship',
    link:()=>r.kind==='dm'?dmLink():r.kind==='fellowship'?worst(SLOT_KEYS.map(k=>mem[k])):agentLink(heroOf(r)),
    error:''}));
  launch={jobs,sent:false,headline:'Starting the runners…'};paintBar();
  if(ctl.speed===0)ctl.speed=1; // the run gate (ui/rungate.js) holds the world until every runner has claimed, then it plays on
  const timer=setInterval(paintBar,700);
  const claimed=()=>jobs.every(j=>j.error||j.link()==='connected'||j.link()==='waiting');
  let info=null;try{info=await (await fetch(relayBase()+'/play/runner')).json()}catch(e){}
  if(!info||!info.enabled){const why=!info?'The relay is not reachable: start it (npm run relay -- --runners).':(info.how||'Runners are off on the relay: start them yourself.');
    for(const j of jobs)j.error='no runner';launch.headline=why+' The world stays paused until they connect.';clearInterval(timer);paintBar();return}
  launch.sent=true;launch.headline='Runners are starting. The world is paused until they all claim their seats.';
  for(const j of jobs){const body={kind:j.kind,provider:j.provider,model:j.model,...(j.kind==='hero'?{hero:heroOf(j).id}:{})};
    let r;for(let i=0;i<10;i++){r=await post('/play/runner/start',body);if(r.ok||r.code!==404)break;await sleep(1000)} // the page tells the relay which heroes are agent-played a moment after loading
    if(!r.ok)j.error=r.error}
  const failed=jobs.filter(j=>j.error);
  launch.headline=failed.length?failed.length+' of '+jobs.length+' runners did not start. The world stays paused: start the rest from the bar over the map.':'All runners started; the world plays on when they have claimed.';
  paintBar();
  for(let i=0;i<20&&!claimed();i++)await sleep(500);
  if(claimed()&&!failed.length)launch.headline='All runners have claimed their seats; the world is running.';
  paintBar();setTimeout(()=>{clearInterval(timer)},60000)}
const worst=hs=>{const ls=hs.filter(Boolean).map(h=>agentLink(h));return ls.some(l=>l!=='connected'&&l!=='waiting')?'none':ls.includes('waiting')?'waiting':'connected'};
