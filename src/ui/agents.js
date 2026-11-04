// The Agents panel (issue #145): every agent limit in one place, opened from the "Agents" button in the
// header (it shows the session's spend). A popover with:
//   - the session budget: one cap across every paid runner the relay started (Claude, OpenAI), with the
//     spend so far live; when it runs out the relay stops the paid runners and refuses new paid starts;
//   - one row per runner the game can start (the Fellowship runner, each agent-played hero, the DM):
//     its state and, for paid minds, a budget (no turn cap: every runner plays until stopped, #563).
//     A limit is used on the next start; on a running runner a lower one applies now, a higher one on
//     its next start (the row says which).
// Limits are kept per viewer (localStorage, ui/runners.js). The relay enforces them (scripts/runners.mjs).
import {S,playerSeats,dmSeatOn} from '../sim/index.js';
import {runnerByKey,allRunners,runnersEnabled,relayUp,kindInfo,pickOf,limitOf,limitNote,setLimit,sessionInfo,setSessionBudget,stateLine,watchRunners,HOW_TEXT,DONE_STATE,BUDGETS,NO_SESSION,noSessionBudget} from './runners.js';
import {patch} from './stable.js';
import {inSlots,slotted,mindsOf} from '../sim/company.js'; // the slotted company (#588)

const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
const usd=v=>'$'+(+v||0).toFixed(2);
const SESSION_OPTS=[1,2,5,10,20,50,100];
let btn=null,pop=null,body=null,isOpen=false;

// The runners the game can start or has running: [{key, kind, name, hero}]
export function agentRows(){const out=[],seen=new Set(),add=(key,kind,name,hero)=>{if(seen.has(key))return;seen.add(key);out.push({key,kind,name,hero})};
  const F=slotted();if(F&&(mindsOf(F)==='agent'||runnerByKey('fellowship')))add('fellowship','fellowship','The Fellowship (all five)');
  for(const a of playerSeats())if(a.state!=='dead')add('hero:'+a.id,'hero',a.name+(inSlots(a)?' ★':''),a.id);
  if(dmSeatOn()||runnerByKey('dm'))add('dm','dm','Dungeon Master');
  for(const r of allRunners())if(!DONE_STATE[r.state])add(r.key,r.kind,r.name||r.key,r.hero);
  return out}
// Local (free) or paid: the running runner's own budget says; else the mind picked for its start.
const isLocal=k=>{const r=runnerByKey(k);if(r&&!DONE_STATE[r.state])return r.budget==null;return pickOf(k).startsWith('ollama:')};

function sel(opts,val,data,title){const s=el('select','msel');for(const [v,t] of opts){const o=new Option(t,v);if(String(v)===String(val))o.selected=true;s.append(o)}
  for(const [k,v] of Object.entries(data))s.dataset[k]=v;s.title=title;return s}

function sessionBox(n){const s=sessionInfo(),box=el('div','agsess');
  const row=el('div','agrow');row.append(el('span','slbl','Session budget'));
  const opts=[['','no limit']].concat(SESSION_OPTS.map(v=>[String(v),usd(v)]));if(s.want!=null&&!SESSION_OPTS.includes(s.want))opts.push([String(s.want),usd(s.want)]);
  row.append(sel(opts,s.want==null?'':s.want,{agsess:'1'},'One budget across every paid runner the relay starts (Claude, OpenAI). Local models are free.'));
  box.append(row);
  const spent=el('div','agspent');spent.append(el('span',null,'Spent '+usd(s.spent)+(s.budget!=null?' of '+usd(s.budget):'')));
  if(s.budget!=null){const m=el('div','meter agm');const i=document.createElement('i');i.style.width=Math.min(100,s.spent/s.budget*100).toFixed(1)+'%';m.append(i);spent.append(m);
    if(s.left!=null&&s.left<=0)spent.append(el('span','sbad','Reached: paid runners are stopped until you raise it.'))}
  box.append(spent);if(noSessionBudget())box.append(el('div','dm agnote',NO_SESSION));n.append(box)} // #807: shown, never defaulted

function runnerRow(n,x){const r=runnerByKey(x.key),on=r&&!DONE_STATE[r.state],L=limitOf(x.key),K=kindInfo(x.kind),loc=isLocal(x.key);
  const row=el('div','agr');row.setAttribute('data-k',x.key);
  const top=el('div','agrow');top.append(el('span','agname',x.name),el('span','dm runstate r-'+(r?r.state:'none'),stateLine(r,x.key)));row.append(top);
  const caps=K&&K.caps||{budget:5},defs=K&&K.defaults||{budget:1};
  const lim=el('div','agrow');
  // owner, #563: no turn cap; a runner plays until stopped, a paid one until its budget is spent (--max-turns stays for terminals and checks)
  if(loc)lim.append(el('span','dm','local · free · until stopped'));
  else{const bOpts=[['','default ('+usd(defs.budget)+')']].concat(BUDGETS.filter(v=>v<=caps.budget).map(v=>[String(v),usd(v)]));
    lim.append(el('span','dm','Budget'),sel(bOpts,L.budget,{aglim:x.key,agf:'budget'},'The most this runner may spend; it plays until stopped or this is spent (paid models only). It also stops when its hero dies or after 5 empty turns.'))}
  row.append(lim);
  const note=limitNote(x.key);if(note)row.append(el('div','dm agnote',note));
  else if(on)row.append(el('div','dm agnote','Running: a lower limit applies now, a higher one on its next start.'));
  n.append(row)}

function build(n){
  if(relayUp()===false){n.append(el('div','dm','The relay is not reachable. Start it with runners on: npm run relay -- --runners.'));return}
  if(relayUp()&&!runnersEnabled()){n.append(el('div','dm',HOW_TEXT));return}
  sessionBox(n);
  const rows=agentRows();
  if(!rows.length){n.append(el('div','dm','No agent-played hero yet. Set the Fellowship’s Minds to agents, or press Agent on a hero.'));return}
  n.append(el('div','slbl agsub','Runners'));for(const x of rows)runnerRow(n,x)}

function btnText(){const s=sessionInfo();return 'Agents'+(s.spent?' · '+usd(s.spent)+(s.budget!=null?' / '+usd(s.budget):''):'')}
export function renderAgents(){if(!btn)return;const t=btnText();if(btn.textContent!==t)btn.textContent=t;
  btn.hidden=!(slotted()||playerSeats().length||dmSeatOn()||allRunners().length);if(btn.hidden&&isOpen)closeAgents();
  if(isOpen){watchRunners();patch(body,build)}}
export function openAgents(){if(!pop)return;isOpen=true;pop.hidden=false;btn.setAttribute('aria-expanded','true');renderAgents();const f=pop.querySelector('button,select');if(f&&f.focus)f.focus()}
export function closeAgents(){if(!pop)return;isOpen=false;pop.hidden=true;btn.setAttribute('aria-expanded','false')}
export const agentsOpen=()=>isOpen;

export function initAgents(){btn=$('agentsBtn');pop=$('agentsPop');if(!btn||!pop)return;
  const hd=el('div','aghead');const cl=el('button','mini','Close');cl.dataset.agclose='1';hd.append(el('span','fname','Agents'),cl);
  body=el('div','agbody');pop.append(hd,body,el('div','dm agfoot','Budgets are kept in this browser and sent to the relay. They apply to the next start; on a running runner a lower one applies now.'));
  btn.addEventListener('click',()=>isOpen?closeAgents():openAgents());
  pop.addEventListener('click',e=>{if(e.target.closest&&e.target.closest('[data-agclose]')){closeAgents();btn.focus()}});
  pop.addEventListener('change',e=>{const s=e.target;if(!s||!s.dataset)return;
    if(s.dataset.agsess)setSessionBudget(s.value===''?null:Number(s.value)).then(renderAgents);
    else if(s.dataset.aglim)setLimit(s.dataset.aglim,s.dataset.agf,s.value).then(renderAgents);
    renderAgents()});
  document.addEventListener('keydown',e=>{if(isOpen&&e.key==='Escape'){closeAgents();btn.focus()}});
  renderAgents()}
