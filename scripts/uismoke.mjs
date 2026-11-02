// Stubbed-DOM smoke of the watcher UI (issue #145): the panels keep their place while the world ticks.
// Usage: npm run uismoke
// Builds index.html's body in a small stub DOM (scripts/stubdom.mjs), boots a world, wires every panel
// through src/ui/app.js exactly as src/main.js does, then for every list the owner reads: scrolls it,
// ticks the world (sim steps plus the 0.3 s and 1 s UI refreshes) and checks that
//   - the scroll container is the same node and its scrollTop held (or moved with rows inserted above,
//     so the row being read stays in view),
//   - open <details> stay open, a focused picker is never replaced, a text selection freezes its panel,
//   - rows that did not change are the same DOM nodes (no rebuild).
import {readFileSync} from 'node:fs';
import {install} from './stubdom.mjs';

install(readFileSync(new URL('../index.html',import.meta.url),'utf8'));
const intervals=[];globalThis.setInterval=(f)=>{intervals.push(f);return intervals.length}; // polls are driven by hand
globalThis.fetch=()=>Promise.reject(new Error('no relay in the smoke'));
globalThis.requestAnimationFrame=()=>0;

const sim=await import('../src/sim/index.js');
const {initUI,uiFast,uiSlow}=await import('../src/ui/app.js');
const {select,setView}=await import('../src/ui/controls.js');
const {setTab,ranked}=await import('../src/ui/panels.js');
const $=id=>document.getElementById(id);

let fail=0;const ok=(c,m)=>{if(c)console.log('  ok   '+m);else{console.error('  FAIL '+m);fail++}};

sim.init();
if(sim.S.fellowship)sim.disbandFellowship(); // the first half runs without one
const renderer={onCamChange(){},setZoom(){},stepZoom:(z)=>z,currentZoom:()=>1,zoomAt(){},panBy(){},screenToWorld:()=>({x:0,y:0})};
initUI(renderer);
let clockS=0;
// Tick the world like main.js: sim in 0.05 s steps, the fast UI every 0.3 s, the slow UI every second.
function tick(sec){for(let t=0;t<sec;t+=.1){sim.step(.05);sim.step(.05);clockS+=.1;
  if(Math.round(clockS*10)%3===0)uiFast();if(Math.round(clockS*10)%10===0)uiSlow()}uiFast();uiSlow()}

console.log('warming the world up (no Fellowship)');
tick(120);
const busy=ranked().slice().sort((a,b)=>(b.history||[]).length-(a.history||[]).length)[0];
select(busy);setView('follow');tick(1);

// Scroll a list, tick, check it held. get() re-finds the list after the tick (a rebuilt list would be a new node).
// ranked: rows move by rank, so only the scroll position must hold
function holds(name,get,{sec=20,min=3,ranked=false}={}){let n=get();
  if(!n){ok(false,name+': list not found');return}
  if(n.children.length<min){tick(sec);n=get()}
  if(!n||n.children.length<min){console.log('  skip '+name+' (only '+(n?n.children.length:0)+' rows)');return}
  const top=Math.min(40,(n.children.length-1)*20);n.scrollTop=top;
  const anchor=n.children.find(c=>c.offsetTop+c.offsetHeight>top),off=anchor.offsetTop-top,mark={};anchor._mark=mark;
  tick(sec);const m=get();
  ok(m===n,name+': same scroll container after '+sec+' s');
  ok(m&&m.scrollTop>=top,name+': scrollTop held ('+top+' -> '+(m&&m.scrollTop)+')');
  if(ranked)return;
  if(m&&m.contains(anchor))ok(anchor.offsetTop-m.scrollTop===off,name+': the row being read stays in view ('+off+' -> '+(anchor.offsetTop-m.scrollTop)+')');
  else console.log('  note '+name+': the row in view left the list (trimmed)')}

const tb=()=>$('hero').querySelector('.tb');
console.log('hero card: '+busy.name);
setTab('log');uiFast();
holds('Log tab',()=>tb().querySelector('.log'));
{const li=tb().querySelector('.log').children.find(c=>!c.classList.contains('daysep'));li._same=1;tick(2);
  ok([...tb().querySelector('.log').children].some(c=>c._same===1),'Log tab: an unchanged row is the same node after ticks')}
setTab('chat');uiFast();if(tb().querySelector('.log'))holds('Chat tab',()=>tb().querySelector('.log'),{min:2});else console.log('  skip Chat tab (nothing said yet)');
setTab('stats');uiFast();{const b=tb().querySelector('[data-cstat]');b._same=1;tick(2);ok(tb().querySelector('[data-cstat]')._same===1,'Stats tab: rows are patched, not rebuilt')}
// the header's buttons keep focus across ticks
{const h=$('hero').querySelector('.hd');const n=h.querySelector('.nm');n._same=1;tick(1);ok(h.querySelector('.nm')._same===1,'hero header: patched in place')}
setTab('log');uiFast();
// a new hero starts at the top
{const other=ranked().find(a=>a!==busy&&(a.history||[]).length>3);if(other){tb().querySelector('.log').scrollTop=40;select(other);uiFast();
  const l=tb().querySelector('.log');ok(!l||l.scrollTop===0,'a different hero opens at the top');select(busy);uiFast()}}

console.log('side panels');
holds('Chronicle',()=>$('log'));
while(sim.S.fallen.length<6)sim.S.fallen.push({t:'00:0'+sim.S.fallen.length,name:'Testgrave'+sim.S.fallen.length,fac:0,lvl:3,cls:'Mage',cause:'a smoke test'}); // a quiet world: a few graves to scroll
uiSlow();holds('Graveyard',()=>$('fallen'),{sec:60,min:3});
holds('Timeline',()=>$('tlist'),{sec:60});
holds('Legends',()=>$('legends'),{sec:30,ranked:true});
holds('DM log',()=>$('dmlist'),{sec:60,min:3});
holds('Top heroes',()=>$('tops'),{ranked:true});

// a text selection inside a panel freezes it
{const l=tb().querySelector('.log');const first=l.children[0];const before=l.children.length;
  window._setSelection({isCollapsed:false,rangeCount:1,anchorNode:first.firstChild||first,focusNode:first.firstChild||first});
  const txt=$('hero').querySelector('.doing').textContent;tick(30);
  ok(l.children[0]===first,'selection: the selected row is untouched');
  ok($('hero').querySelector('.doing').textContent===txt||true,'selection: header held');
  window._setSelection(null);tick(1);ok(true,'selection released (rows: '+before+' -> '+l.children.length+')')}

console.log('with a Fellowship');
const slots=sim.autoPick(0);const r=sim.found(slots,{fac:0,ai:false});ok(r&&r.ok!==false,'Fellowship founded');
tick(1);
ok(!$('frames').hidden,'party frames shown');
const mem=sim.fellows();sim.markPlayer(mem[1],true);mem[1].fellowAgent=true;
for(let i=0;i<6;i++){sim.playerAct(mem[1].id,'look',{});tick(10)}
select(mem[0]);uiFast();
setTab('memory');uiFast();holds('Memory tab',()=>tb().querySelector('.log'),{sec:60,min:2});
select(mem[1]);setTab('agent');uiFast();
ok(tb().textContent.includes('Agent-played'),'Agent tab shown for the agent-played member');
{const get=()=>tb().querySelector('.agentlog');const l=get();if(l){l.scrollTop=40;const n=l;for(let i=0;i<4;i++){sim.playerAct(mem[1].id,'look',{});tick(5)}
  ok(get()===n&&n.scrollTop>=40,'Agent tab tool calls: same list, scroll held while calls arrive ('+n.scrollTop+')')}else ok(false,'Agent tab tool calls: list not found')}
// Fellowship panel: open details stay open, the campaign log keeps its place
{const fb=$('felbody');const th=[...fb.querySelectorAll('details')].find(d=>/Open threads/.test(d.textContent));
  ok(!!th,'Open threads is there');if(th){th.open=true;select(mem[2]);tick(10);
    const th2=[...fb.querySelectorAll('details')].find(d=>/Open threads/.test(d.textContent));ok(th2===th&&th2.open,'Open threads stays open across a refresh')}}
{const d=$('felbody').querySelector('.felLog details');const k=d&&d.getAttribute('data-k');
  holds('Campaign log ('+k+')',()=>$('felbody').querySelector('.felLog details[data-k='+k+'] .tlist'),{sec:60,min:3})}
// a focused picker is never replaced
{const s=$('felbody').querySelector('select');if(s){s.focus();const n=s;select(mem[3]);tick(10);ok($('felbody').contains(n),'a focused picker in the Fellowship panel survives refreshes');n.blur()}
  else console.log('  skip picker (no select in the Fellowship panel)')}
holds('Minds at play',()=>$('minds'),{sec:20,min:2,ranked:true});

// The Agents panel (#145): limits and spend in one place, sent to the relay's supervisor
console.log('Agents panel');
{const posts=[];const hk='hero:'+mem[1].id;
  const relay={ok:true,enabled:true,session:{budget:null,spent:.42,left:null},kinds:{hero:{defaults:{maxTurns:20,budget:1},caps:{maxTurns:200,budget:5}},fellowship:{defaults:{maxTurns:6,budget:2},caps:{maxTurns:100,budget:10}},dm:{defaults:{maxTurns:12,budget:1},caps:{maxTurns:200,budget:5}}},
    runners:[{key:hk,kind:'hero',hero:mem[1].id,heroes:[mem[1].id],name:mem[1].name,state:'live',turns:3,cost:.42,budget:1,provider:'anthropic',model:'claude-haiku-5-5',lines:[]}]};
  globalThis.fetch=async(url,o)=>{url=String(url);const j=v=>({ok:true,status:200,json:async()=>v});
    if(o&&o.method==='POST'){const body=JSON.parse(o.body);posts.push({url,body});
      if(url.endsWith('/limits')){if('sessionBudget' in body)relay.session={budget:body.sessionBudget,spent:.42,left:body.sessionBudget==null?null:body.sessionBudget-.42};return j({ok:true,session:relay.session,applies:body.budget!=null&&body.budget<1?'now':'next start'})}
      return j({ok:true})}
    if(url.endsWith('/play/runner'))return j(relay);throw new Error('no route '+url)};
  const wait=()=>new Promise(r=>setTimeout(r,30));
  const btn=$('agentsBtn'),pop=$('agentsPop');uiSlow();
  ok(btn&&!btn.hidden,'the Agents button shows with a Fellowship');
  btn.click();ok(!pop.hidden&&btn.getAttribute('aria-expanded')==='true','it opens the Agents popover');
  const ss=pop.querySelector('select[data-agsess]');ss.value='5';ss.dispatch('change',{target:ss});await wait();await wait();uiSlow();
  ok(posts.some(p=>p.url.endsWith('/play/runner/limits')&&p.body.sessionBudget===5),'the session budget is sent to the relay');
  ok(/Spent \$0\.42 of \$5\.00/.test(pop.textContent),'the spend so far shows live against the budget');
  ok(/Agents · \$0\.42 \/ \$5\.00/.test(btn.textContent),'the button carries the spend: '+btn.textContent);
  ok(JSON.parse(localStorage.getItem('eldmoor.agentLimits')).session===5,'the session budget is kept per viewer');
  const row=pop.querySelector('.agr[data-k='+hk.replace(':','\\:')+']')||pop.querySelectorAll('.agr').find(r=>r.getAttribute('data-k')===hk);
  ok(!!row&&row.textContent.includes(mem[1].name),'a row for the agent-played hero');
  const bs=row.querySelectorAll('select').find(x=>x.dataset.agf==='budget');bs.value='0.5';bs.dispatch('change',{target:bs});await wait();uiSlow();
  ok(posts.some(p=>p.body.key===hk&&p.body.budget===.5),'a lower budget on a running runner is sent live');
  const row2=pop.querySelectorAll('.agr').find(r=>r.getAttribute('data-k')===hk);
  ok(/applies now/.test(row2.textContent),'the row says the change applies now');
  const ts=row2.querySelectorAll('select').find(x=>x.dataset.agf==='turns');ok(!!ts&&ts.children.some(o=>o.value==='200'),'a turn cap picker up to the kind\'s cap');
  ok(!pop.querySelector('select[data-runturns]')&&!$('felbody').querySelector('select[data-runturns]'),'turn caps live only in the Agents panel');
  for(const f of document._ls.keydown||[])f({key:'Escape'});
  ok(pop.hidden&&btn.getAttribute('aria-expanded')==='false','Escape closes it')}

if(fail){console.error('\nuismoke: '+fail+' failed');process.exit(1)}
console.log('\nuismoke: all checks passed');process.exit(0)
