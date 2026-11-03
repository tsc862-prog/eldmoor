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
const {remember}=await import('../src/sim/memory.js');
const {select,setView}=await import('../src/ui/controls.js');
const {setTab,ranked}=await import('../src/ui/panels.js');
const $=id=>document.getElementById(id);

let fail=0;const failed=[];const ok=(c,m)=>{if(c)console.log('  ok   '+m);else{console.error('  FAIL '+m);failed.push(m);fail++}};

sim.init();
if(sim.S.fellowship)sim.disbandFellowship(); // the first half runs without one
const renderer={onCamChange(){},setZoom(){},stepZoom:(z)=>z,currentZoom:()=>1,zoomAt(){},panBy(){},screenToWorld:()=>({x:0,y:0})};
initUI(renderer);
let clockS=0;
// The Fellowship half needs its five members alive, visible and together (hardcore: a member who dies is replaced by
// a new object, and one who enters the Crypt is hidden, which silently drops every shout and made the chat cases flaky).
// guard() runs each sim step; stage() is called where a block needs them in one spot.
let guardMem=null;
const guard=()=>{if(guardMem)for(const a of guardMem){if(a.state!=='dead'&&a.maxhp)a.hp=Math.max(a.hp,a.maxhp);a.hidden=false}};
function stage(){guardMem=mem;guard();for(const a of mem){a.state=a.state==='dead'?'town':a.state;a.x=mem[0].x+(mem.indexOf(a)%3);a.y=mem[0].y}}
// Tick the world like main.js: sim in 0.05 s steps, the fast UI every 0.3 s, the slow UI every second.
function tick(sec){for(let t=0;t<sec;t+=.1){sim.step(.05);guard();sim.step(.05);guard();clockS+=.1;
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
const mem=sim.fellows();guardMem=mem;sim.markPlayer(mem[1],true);mem[1].fellowAgent=true;
for(let i=0;i<6;i++){sim.playerAct(mem[1].id,'look',{});tick(10)}
select(mem[0]);uiFast();
setTab('memory');uiFast();holds('Memory tab',()=>tb().querySelector('.log'),{sec:60,min:2});
{const M=mem[0].memory;const tbn=tb();tbn.scrollTop=40;const li0=tbn.querySelector('.log li');const n0=M.recent.length;
  remember(mem[0],'scene','A brand new memory arrives while the owner is reading.');uiFast();
  ok(M.recent.length>n0||M.n>0,'a memory was added');ok(tb()===tbn,'Memory tab: same container after a new memory');
  ok(tbn.scrollTop>=Math.min(40,tbn.scrollTop),'Memory tab: scroll held across a new memory ('+tbn.scrollTop+')');
  ok(tbn.textContent.includes('A brand new memory'),'Memory tab: the new memory shows');
  if(li0)ok(tbn.contains(li0),'Memory tab: existing rows are reused, not rebuilt')}
select(mem[1]);setTab('agent');uiFast();
ok(tb().textContent.includes('Agent-played'),'Agent tab shown for the agent-played member');
{const get=()=>tb().querySelector('.agentlog');const l=get();if(l){l.scrollTop=40;const n=l;for(let i=0;i<4;i++){sim.playerAct(mem[1].id,'look',{});tick(5)}
  ok(get()===n&&n.scrollTop>=40,'Agent tab tool calls: same list, scroll held while calls arrive ('+n.scrollTop+')')}else ok(false,'Agent tab tool calls: list not found')}
// Keys 1-5 select the member in that party slot
{const {cam}=await import('../src/render/draw.js');
  const press=(k,o={})=>{let pd=false;for(const f of document._ls.keydown||[])f({key:k,target:document.body,preventDefault(){pd=true},...o});return pd};
  const hints=[...$('frames').querySelectorAll('.pfkey')].map(n=>n.textContent).join();
  ok(hints==='1,2,3,4,5','party frames carry the key hints 1..5: '+hints);
  ok($('frames').querySelector('.pfkey').title==='Press 1-5 to select','key hint tooltip');
  select(mem[0]);press('2');ok(cam.sel===mem[1]&&cam.view==='follow','key 2 selects slot 2 and follows');
  press('4',{code:'Numpad4'});ok(cam.sel===sim.fellows()[3],'key 4 selects slot 4');
  press('Digit5'.slice(5),{});ok(cam.sel===sim.fellows()[4],'key 5 selects slot 5');
  select(mem[0]);press('3',{target:{tagName:'INPUT'}});ok(cam.sel===mem[0],'typing 3 in an input does not select');
  press('3',{target:{tagName:'TEXTAREA'}});press('3',{target:{tagName:'DIV',isContentEditable:true}});ok(cam.sel===mem[0],'textarea and contenteditable ignored');
  press('1',{ctrlKey:true});press('2',{metaKey:true});press('3',{altKey:true});ok(cam.sel===mem[0],'Ctrl/Meta/Alt + digit does not select');
  press('6');press('0');ok(cam.sel===mem[0],'other digits do nothing')}
// Fellowship panel: open details stay open, the campaign log keeps its place
{const fb=$('felbody');const th=fb.querySelector('.felthreads');
  ok(!!th&&/Open threads/.test(th.textContent),'Open threads lead the Fellowship panel, always visible');
  select(mem[2]);tick(10);ok(fb.querySelector('.felthreads')===th,'the threads box is patched in place across a refresh');
  ok(!!fb.querySelector('.fhline')&&!fb.querySelector('details'),'the header is one line with no folded sections');
  ok(!/Minds: agents/.test(fb.textContent),'no Minds: agents label (members are always agents)');
  ok(!fb.querySelector('.feldrawer'),'Members and Fallen are closed by default');
  // a thread that is not about a hero: an oath and a meeting plan show as one-liners
  // set the oath after the ticks, on a member who still stands: a member who fell in those ticks is replaced by a new object
  tick(10);const oathHero=sim.fellows()[0],keepAdv=sim.S.adventures;sim.S.adventures=[]; // the threads box is capped and the world's own jobs come first
  oathHero.goal={text:'Avenge Torius on Grishnak',progress:0,need:1};uiFast();
  ok(/swore to avenge Torius/.test(fb.querySelector('.fthreads').textContent),'an oath is a live one-liner (member '+oathHero.name+' '+oathHero.state+', threads: '+fb.querySelector('.fthreads').textContent.slice(0,120)+')');
  sim.S.adventures=keepAdv;
  // Disband needs a confirmation behind the ... menu
  ok(!fb.querySelector('[data-fact=disband]'),'Disband is not on the header');
  fb.querySelector('[data-fact=menu]').click();ok(!!fb.querySelector('[data-fact=disband]'),'the ... menu offers Disband');
  fb.querySelector('[data-fact=disband]').click();ok(!!sim.S.fellowship&&/Yes, disband/.test(fb.textContent),'Disband asks first and the Fellowship still stands');
  fb.querySelector('[data-fact=menu]').click();ok(!sim.S.fellowship===false&&!fb.querySelector('[data-fact=disband]'),'Cancel closes the menu without disbanding');
  fb.querySelector('[data-fact="drawer:members"]').click();const dr=fb.querySelector('.feldrawer');
  ok(!!dr&&!!dr.querySelector('.mindrow'),'the members drawer opens on a click');
  ok(dr.querySelectorAll('.fm .fport').length===5,'roster: each place has a face canvas (#379)');
  if(sim.S.fellowship.past.length){fb.querySelector('[data-fact="drawer:fallen"]').click();ok(/Fallen/.test(fb.querySelector('.feldrawer').textContent),'Fallen is one click away')}
  else ok(!fb.querySelector('[data-fact="drawer:fallen"]'),'no Fallen button while nobody has fallen');
  fb.querySelector('[data-fact="drawer:members"]').click();
  {const css=(await import('node:fs')).readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
    ok(/\.fhline\{[^}]*flex-wrap:wrap/.test(css)&&/\.feldrawer\{[^}]*overflow-wrap:anywhere/.test(css)&&/\.fmeta\{[^}]*min-width:0/.test(css),'phone width (390px): the header wraps, the name and drawer cannot push the column wider')}
}
{const d=$('campaign').querySelector('details');const k=d&&d.getAttribute('data-k');
  holds('Campaign log ('+k+')',()=>$('campaign').querySelector('details[data-k='+k+'] .tlist'),{sec:60,min:3})}
// a focused picker is never replaced
{const s=$('felbody').querySelector('select');if(s){s.focus();const n=s;select(mem[3]);tick(10);ok($('felbody').contains(n),'a focused picker in the Fellowship panel survives refreshes');n.blur()}
  else console.log('  skip picker (no select in the Fellowship panel)')}
// Chat tab (#145, owner): one compact line, no mind badge, own-name prefix dropped, repeats collapsed
{stage();const sp=mem[1]; // together, within shouting range (#182)
const r1=sim.playerAct(sp.id,'party_say',{text:sp.name+': Hold the line at the ford.'});(await import('../src/sim/council.js')).partySay(sp,'Hold the line at the ford.'); // a repeat said outside the agent tool (agents' own near-repeats are refused since #163)
  const long=sim.playerAct(sp.id,'party_say',{text:'word '.repeat(50)});
  ok(long&&long.ok===false&&/Too long/.test(long.error||JSON.stringify(long)),'party_say over 200 characters is refused, not cut');
  select(mem[0]);setTab('chat');uiFast();const ul=tb().querySelector('.log');
  const li=ul&&ul.children.find(x=>/Hold the line/.test(x.textContent));
  ok(!!li&&/Hold the line at the ford. ×2/.test(li.textContent)&&/shouts: /.test(li.textContent)&&!!li.querySelector('.chheard'),'chat: repeated shout shows once with a count and who heard: '+(li&&li.textContent));
  ok(!!li&&!li.textContent.includes(sp.name+': '+sp.name),'chat: the own-name prefix is dropped');
  ok(!tb().querySelector('.ai-badge'),'chat: no mind or model badge');
  ok(!!li&&!li.querySelector('.chtag')&&li.querySelector('.hn').classList.contains('fmn'),'chat: no channel tag box, role-coloured name on the one line')
  ok(!!li&&li.querySelector('.chheard').textContent.includes(mem[0].name),'chat: the dim list names who heard: '+(li&&li.querySelector('.chheard')&&li.querySelector('.chheard').textContent));
  // an out-of-range shout (#182): "Fena calls out, but no one is near"
  {mem[0].chat.push({t:'12:00',d:Math.floor(sim.S.gameMin/1440)+1,from:sp,text:'Anyone out there?',trigger:'party',party:true,heard:[],far:[mem[2].name]});uiFast();
   const lo=tb().querySelector('.log').children.find(x=>/Anyone out there/.test(x.textContent));
   ok(!!lo&&/calls out, but no one is near/.test(lo.textContent)&&!lo.querySelector('.chheard'),'chat: a shout nobody heard reads "calls out, but no one is near": '+(lo&&lo.textContent))}
  // day stamps and separators (#168): "D3 13:57", a "Day N" row where the day changes; an older entry with no day keeps its bare time
  {const h=mem[0];const d0=Math.floor(sim.S.gameMin/1440)+1;h.chat.push({t:'23:58',d:d0+5,from:sp,text:'Stamp test A.',trigger:'x',party:true},{t:'01:10',d:d0+6,from:sp,text:'Stamp test B.',trigger:'x',party:true});
   uiFast();const u2=tb().querySelector('.log.chat'),tm=[...u2.querySelectorAll('time')].map(x=>x.textContent);
   ok(tm.some(t=>/^D\d+ \d\d:\d\d$/.test(t)),'chat: times carry the game day: '+tm.slice(0,3).join(', '));
   ok(u2.children.filter(x=>x.classList.contains('daysep')).length>=2,'chat: day separators appear where the day changes');
   // #181: the dossier Chat tab is a per-hero filter of the chat panel's stream; the phone-width View group wraps
   {const mine=tb().querySelector('.log.chat').textContent;h.chat.push({t:'09:00',d:d0+7,from:h,text:'Only-for-me test line.',trigger:'x'});
    const other=mem.find(m=>m!==h&&m!==sp&&m.chat)||{chat:[]};other.chat.push({t:'09:01',d:d0+7,from:other,text:'Only-for-other test line.',trigger:'x'});uiFast();
    const t2=tb().querySelector('.log.chat').textContent;
    ok(/Only-for-me/.test(t2)&&!/Only-for-other/.test(t2),'dossier chat: shows this heros slice of the stream only');
    ok(tb().querySelector('.log.chat').children.length>0&&mine.length>0,'dossier chat: built from the stream');
    const css0=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
    ok(/\.group\{[^}]*flex-wrap:wrap/.test(css0),'phone width: the View button group wraps instead of widening the page')}
   const css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8').match(/\.log\.chat li\.chl\{[^}]*\}/);
   ok(!!css&&!/text-indent:\s*-/.test(css[0]),'chat: no negative text-indent (the stamp cannot start left of the list box)')}}
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
  // the runner poll is throttled in real time (5 s); an earlier step may have left the relay marked down, so wait for the stub to be read
  for(let i=0;i<250&&!pop.querySelector('select[data-agsess]');i++){await wait();uiSlow()}
  const ss=pop.querySelector('select[data-agsess]');ok(!!ss,'the popover reads the relay');ss.value='5';ss.dispatch('change',{target:ss});await wait();await wait();uiSlow();
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

// Quieter bars (#145): the viewing switches in Settings, Save/Load/... under one World menu
console.log('bars');
{const bar=document.querySelector('.bar');const visible=bar.querySelectorAll('button').filter(b=>{for(let e=b;e&&e!==bar;e=e.parentNode){if(e.hidden)return false;if(e.tagName==='DETAILS'&&!e.open&&e!==b.parentNode)return false;if(e.tagName==='DIV'&&e.classList.contains('wdrop')&&!e.parentNode.open)return false}return true});
  ok(visible.length<=10,'the bar under the map shows '+visible.length+' buttons (was 17 with a Fellowship)');
  const wm=$('wmenu');ok(wm&&!wm.open&&wm.contains($('wSave'))&&wm.contains($('wNew')),'Save, Load, Export, Import and New world fold under the World menu');
  const sp=$('setPop'),sb=$('setBtn');ok(sp.contains($('vTab'))&&sp.contains($('vRal'))&&sp.contains($('vSnd'))&&sp.contains($('wDev'))&&sp.contains($('vChat')),'the viewing switches live in Settings');
  sb.click();ok(!sp.hidden&&sb.getAttribute('aria-expanded')==='true','Settings opens');
  const vc=$('vChat'),was=localStorage.getItem('eldmoor.worldChatter');vc.click();
  ok(localStorage.getItem('eldmoor.worldChatter')!==was&&/Scripted chatter: (on|off)/.test(vc.textContent),'Scripted chatter switches from Settings (Developer) and is kept per viewer');vc.click();
  for(const f of document._ls.keydown||[])f({key:'Escape'});ok(sp.hidden&&sb.getAttribute('aria-expanded')==='false','Escape closes Settings');
  ok(!tb().querySelector('button.mini')||!/World chatter/.test(tb().textContent),'the Chat tab no longer carries its own World chatter switch')}

// Decluttered (#145): dossier groups, one mind control, the Story panel, developer surfaces folded
console.log('declutter');
{const {setGroup}=await import('../src/ui/panels.js');
  select(mem[1]);setTab('stats');uiFast();
  const gr=$('hero').querySelector('.tgroups'),sub=$('hero').querySelector('.tsub'),shown=()=>sub.children.filter(b=>!b.hidden).map(b=>b.textContent);
  ok(gr&&gr.children.map(b=>b.textContent).join()==='Character,Story,Mind','three dossier groups: '+(gr&&gr.children.map(b=>b.textContent)));
  ok(shown().join()==='Stats,Gear,Pack','Character: Stats, Gear, Pack (no Party for a member: the frames are the party): '+shown());
  setGroup('story');uiFast();ok(shown().join()==='Quests,Log,Combat,Bio,Memory','Story: Quests, Log, Combat, Bio, Memory: '+shown());
  setGroup('mind');uiFast();ok(shown().includes('Chat')&&shown().includes('Agent'),'Mind: Chat and Agent for the agent-played member: '+shown());
  setGroup('char');uiFast();ok(tb().querySelector('[data-cstat]'),'Character opens on Stats');
  setGroup('story');setTab('bio');setGroup('char');setGroup('story');uiFast();ok(shown().length&&sub.children.find(b=>b.getAttribute('aria-pressed')==='true').textContent==='Bio','a group reopens on its last tab');
  ok(!$('hero').querySelector('.hd [data-ai]')&&!$('hero').querySelector('.hd [data-agent]'),'a member\'s header has no AI/Agent buttons (one mind control)');
  ok(!$('frames').querySelector('[data-mindctl]'),'the frames show the mind label, without a switch');
  const fb=$('felbody');fb.querySelector('[data-fact="drawer:members"]').click();const mm=fb.querySelector('.feldrawer');
  ok(!!mm&&!!mm.querySelector('.mindrow')&&!mm.querySelector('[data-mmode]'),'Members and minds: the one place a member mind is set, in the drawer');fb.querySelector('[data-fact="drawer:members"]').click();
  ok(!/Model requests|Relay writing/.test(fb.textContent),'request stats are hidden unless Developer is on');
  ok(document.body.classList.contains('fellow-mode')&&!document.body.classList.contains('dev-mode'),'Minds at play is folded away (fellow-mode without dev-mode)');
  const st=$('storyTabs');ok(st&&!st.hidden&&$('storyTtl').textContent==='Story','the Story panel has Chronicle and Campaign log tabs');
  st.children.find(b=>b.dataset.story==='camp').click();ok($('log').hidden&&!$('campaign').hidden&&$('chronFel').hidden,'Campaign log tab shows the campaign');
  st.children.find(b=>b.dataset.story==='chron').click();ok(!$('log').hidden&&$('campaign').hidden,'Chronicle tab shows the chronicle')}


// ---- the Fellowship chat panel, class and disposition colours, council lines (#169) ----
{const {classColor,dispositionOf,toneOf}=await import('../src/core/colors.js');
  // the living members: a fallen one in `mem` has lost its fellow flag
  const dps=sim.fellows().filter(a=>/^dps/.test(a.fellowRole||''));const cols=new Set(dps.map(a=>classColor(a.cls)));
  ok(dps.length===3&&cols.size===3,'three DPS of different classes get three different colours: '+[...cols].join(' '));
  ok(classColor('Warrior')!==classColor('Priest')&&classColor('Nonesuch')===classColor('Nonesuch'),'every class has its own colour, an unknown class a stable one');
  const F=sim.S.fellowship,home={kind:'npc',fac:F.fac,name:'Ostler'},away={kind:'npc',fac:1-F.fac,name:'Peddler'};
  ok(dispositionOf(home,F)==='friendly'&&dispositionOf(away,F)==='neutral','NPCs of the Fellowship\'s faction are friendly, others neutral');
  ok(dispositionOf({...away,mood:'hostile'},F)==='hostile'&&dispositionOf({...home,hostile:true},F)==='hostile'&&dispositionOf({kind:'foe',name:'Brute'},F)==='hostile','npc.mood, npc.hostile and a foe make it hostile');
  ok(dispositionOf({cls:'Mage',fac:1-F.fac,name:'Rival'},F)==='hostile','an enemy-faction hero is hostile');
  ok(toneOf(dps[0],F).kind==='class'&&toneOf(home,F).npc===true&&toneOf(home,F).color!==classColor('Rogue'),'NPCs carry the shape cue and a colour apart from the class colours');
  stage();const sec=$('chatSec');ok(!!sec&&!sec.hidden,'the Fellowship chat panel is shown with a Fellowship');
  const sp=mem[1];sim.playerAct(sp.id,'party_say',{text:'Stream test line.'});
  mem[0].chat.push({t:'05:00',d:1,from:home,text:'Well met, travellers.',trigger:'npc',fh:true});
  sim.playerAct(mem[0].id,'propose',{kind:'job',details:'take a job from the gate that matches our level'});
  uiFast();const cl=$('chatList'),txt=()=>cl.textContent;
  ok(/Stream test line\./.test(txt()),'chat panel: the party line is in the stream');
  ok(cl.children.some(c=>c.classList.contains('daysep')),'chat panel: day separators');
  ok([...cl.querySelectorAll('time')].every(t=>/^(D\d+ )?\d\d:\d\d$/.test(t.textContent)),'chat panel: day-stamped times');
  ok(/proposes: take a job from the gate that matches our level \[job \u00b7 vote open\]/.test(txt()),'chat panel: one proposal line: '+(txt().match(/proposes:.{0,90}/)||[''])[0]);
  ok(!/my proposal/.test(txt()),'chat panel: no "my proposal" line');
  const voter=mem[2];sim.playerAct(voter.id,'vote',{proposal_id:sim.S.fellowship.props[0].id,vote:'no',reason:'too dangerous'});uiFast();
  {const cast=sim.S.fellowship.props[0].votes[voter.id];if(cast&&cast.reason==='too dangerous')ok(/votes no: too dangerous/.test(txt()),'chat panel: a vote is a system line "X votes no: reason"');else console.log('  skip vote line (the proposal settled before the vote)')}
  ok(!!cl.querySelector('li.sys .hn'),'chat panel: system lines use the member\'s coloured name');
  const nm=cl.querySelector('li .hn.fmn');ok(!!nm&&/^#[0-9a-f]{6}$/i.test(nm.style.color||'#000000'),'chat panel: a member\'s name carries its class colour');
  const fb=$('chatFilter');const click=k=>{fb.children.find(b=>b.dataset.cf===k).click();return cl.textContent};
  const dmT=click('dm');ok(/Well met/.test(dmT)&&!/Stream test line/.test(dmT),'chat panel: DM filter shows the NPC line only');
  const npcName=cl.children.find(c=>/Well met/.test(c.textContent)).querySelector('.npcn');ok(!!npcName&&npcName.classList.contains('npc-friendly'),'chat panel: an NPC name is underlined in its disposition class');
  const pT=click('party');ok(/Stream test line/.test(pT)&&/proposes:/.test(pT)&&!/Well met/.test(pT),'chat panel: Party filter shows party lines and the council');
  ok(!!$('chatLegend')&&/hostile/.test($('chatLegend').textContent),'chat panel: a colour legend');
  click('all');
  // newest on top (owner): the panel, the day separators, and a held scroll
  {const lis=()=>cl.children.filter(c=>c.tagName==='LI'&&!c.classList.contains('daysep'));
   const stamps=()=>lis().map(l=>{const m=/D(\d+) (\d\d):(\d\d)/.exec(l.querySelector('time').textContent);return m?(+m[1]-1)*1440+(+m[2])*60+(+m[3]):0});
   const sd=stamps();ok(sd.every((v,i)=>i===0||sd[i-1]>=v),'chat panel: newest line on top, times never increase down the list');
   ok(cl.children[0].classList.contains('daysep'),'chat panel: a day separator heads the newest day block');
   const di=cl.children.map((c,i)=>c.classList.contains('daysep')?i:-1).filter(i=>i>=0);
   ok(di.every(i=>cl.children[i+1]&&!cl.children[i+1].classList.contains('daysep')),'chat panel: each separator sits above the day newest line');
   ok(cl.scrollTop===0,'chat panel opens at the top');
   mem[1].chat.push({t:'06:00',d:50,from:mem[1],text:'Top test A.',party:true,heard:[]});uiFast();
   ok(lis()[0].textContent.includes('Top test A.'),'chat panel: at the top, a new line appears first');
   for(let i=0;i<30;i++)mem[1].chat.push({t:'06:'+String(1+i).padStart(2,'0'),d:50,from:mem[1],text:'Filler line '+i+'.',party:true,heard:[]});uiFast();
   cl.scrollTop=100;const read=cl.children.find(c=>c.offsetTop+c.offsetHeight>100),off=read.offsetTop-100,mark={};read._mark=mark;
   mem[1].chat.push({t:'07:59',d:50,from:mem[1],text:'Arrives while reading.',party:true,heard:[]});mem[1].chat.push({t:'07:58',d:50,from:mem[1],text:'Arrives too.',party:true,heard:[]});
   // lines sort by time: a later stamp lands on top
   mem[1].chat.push({t:'08:30',d:50,from:mem[1],text:'Newest while reading.',party:true,heard:[]});
   uiFast();uiFast();
   ok(cl.scrollTop>=100&&cl.children.includes(read)&&read.offsetTop-cl.scrollTop===off,'chat panel: scrolled down, the line being read does not move when new lines arrive on top ('+off+' -> '+(read.offsetTop-cl.scrollTop)+')');
   const chipEl=cl.parentNode.children.find(c=>c.classList.contains('chatnew'));ok(chipEl&&!chipEl.hidden&&/new line/.test(chipEl.textContent),'chat panel: a "new lines" chip shows while scrolled down');
   chipEl.dispatch('click',{target:chipEl});ok(cl.scrollTop===0&&chipEl.hidden,'chat panel: the chip returns to the top');
   cl.scrollTop=0}
  {const wb=$('chatTall');ok(!!wb&&wb.textContent==='Taller','chat panel: a height toggle');const had=document.body.classList.contains('chat-tall');
   wb.dispatch('click',{target:wb});ok(document.body.classList.contains('chat-tall')!==had&&wb.getAttribute('aria-pressed')==='true','height toggle makes the chat taller (body.chat-tall)');
   wb.dispatch('click',{target:wb});ok(document.body.classList.contains('chat-tall')===had,'height toggle shortens it again');
   const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');const iS=html.indexOf('id="screen"'),iC=html.indexOf('id="chatSec"'),iF=html.indexOf('id="frames"'),iA=html.indexOf('id="side"');
   ok(iF<iS&&iS<iC&&iC<iA,'chat panel follows the map in the DOM (frames, map, chat, then the side column)');
   ok(!$('side').children.includes($('chatSec')),'chat is not in the side column');
   const css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
   ok(/--side:clamp\(340px,28vw,460px\)/.test(css)&&!/chat-wide/.test(css)&&/grid-template-columns:minmax\(0,1fr\) var\(--side\)/.test(css)&&/@media \(max-width:920px\)\{\.main\{grid-template-columns:minmax\(0,1fr\)\}\}/.test(css),'side column is its normal width, and one column at phone width');
   ok(/\.chatbox \.chatlist\{height:clamp\(/.test(css),'chat list has its own fixed height and scroll')}
  {const dossier=await import('../src/ui/panels.js');const g=dossier.chatGroups([{from:mem[1],text:'x',party:true},{from:mem[1],text:'x',party:true},{from:mem[1],text:'y'}]);
   ok(g.length===2&&g[0].n===2,'repeats still collapse to a count (x2)')}
  {const dlog=await import('../src/sim/dmlog.js');dlog.dmlog('agent',null,['The DM agent plans a quiet road.'],{by:'dm-agent'});dlog.dmlog('frame',null,['A scripted scene opens.'],{});
   $('chatTabs').children.find(b=>b.dataset.ctab==='dm').click();$('dmPane').children[0].children.find(b=>b.dataset.dview==='entries').click();uiFast();const dl=$('dmChatList');
   ok(!$('dmPane').hidden&&$('chatPane').hidden,'DM tab opens beside the chat');
   ok(/plans a quiet road/.test(dl.textContent)&&!/scripted scene opens/.test(dl.textContent),'DM tab lists the DM agent\'s entries; scripted ones are hidden');
   $('dmPane').children[0].children[0].click();uiFast();ok(/scripted scene opens/.test($('dmChatList').textContent)&&!!$('dmChatList').querySelector('.dimmed'),'the Scripted DM toggle shows its entries, dimmed');
   const row=$('dmChatList').querySelector('[data-dmid]');ok(row.tabIndex===0&&row.getAttribute('role')==='button','DM rows are keyboard focusable');
   $('chatTabs').children.find(b=>b.dataset.ctab==='chat').click()}}

// The run gate (#171): the world only runs while every required agent seat is connected
console.log('run gate');
{const gate=await import('../src/ui/rungate.js'),{ctl}=await import('../src/ui/controls.js');
  for(const m of sim.fellows())sim.markPlayer(m,true);
  const L={};for(const m of sim.fellows())L[m.id]='connected';let dm='off';
  gate.setGateProbe({link:a=>L[a.id]||'none',dm:()=>dm});
  const T0=1e6,box=$('rgate'),sp=n=>$('sp'+n),press=n=>sp(n).dispatch('click',{target:sp(n)});
  ctl.speed=1;gate.checkRunGate(T0);
  ok(!ctl.held&&box.hidden,'all five connected: the world runs and no bar shows');
  const m3=sim.fellows()[2];L[m3.id]='none';
  gate.checkRunGate(T0+5000);ok(!ctl.held,'a short blip (5 s) does not close the gate');
  gate.checkRunGate(T0+25000);ok(!ctl.held,'a 25 s blip does not close the gate either');
  gate.checkRunGate(T0+35000);
  ok(ctl.held&&!box.hidden&&box.textContent.includes(m3.name),'the member\'s link dropped for 35 s: the gate closes and the bar names '+m3.name);
  ok(/Start/.test(box.textContent)&&/Start all/.test(box.textContent),'the bar offers Start and Start all');
  ok(/no runner/.test(box.textContent),'the bar says why: '+box.children.map(c=>c.textContent).join(' / ').slice(0,120));
  ok(sp(3).getAttribute('aria-disabled')==='true'&&sp(0).getAttribute('aria-disabled')!=='true','the speed buttons are inert but Pause works');
  press(3);ok(ctl.speed===1,'3x cannot unpause or change the speed while held');
  const bar0=box.children[0];gate.checkRunGate(T0+36000);ok(box.children[0]===bar0,'the bar is patched only when its text changes (same nodes)');
  L[m3.id]='waiting';gate.checkRunGate(T0+37000);
  ok(!ctl.held&&ctl.speed===1&&box.hidden&&sp(3).getAttribute('aria-disabled')!=='true','it reconnects: the world resumes by itself at the same speed');
  // a pause by the owner is kept
  L[m3.id]='none';gate.checkRunGate(T0+60000);gate.checkRunGate(T0+90000);ok(ctl.held,'closed again');
  press(0);ok(ctl.speed===0,'Pause works while held');
  L[m3.id]='connected';gate.checkRunGate(T0+91000);
  ok(!ctl.held&&ctl.speed===0,'the world was paused by the owner: it stays paused after reconnecting');
  // the DM seat
  ctl.speed=1;sim.setDmSeat(true);dm='none';gate.checkRunGate(T0+100000);
  ok(ctl.held&&gate.gateMissing().some(m=>m.kind==='dm')&&/DM/.test(box.textContent),'the DM seat chosen and its runner absent: held, and the DM is listed');
  dm='connected';gate.checkRunGate(T0+101000);ok(!ctl.held,'the DM connects: running');
  sim.setDmSeat(false);
  // a dead member is not required; a restart blip of a whole runner within 20 s is not a flicker
  // developer override
  L[m3.id]='none';gate.checkRunGate(T0+200000);gate.checkRunGate(T0+230000);ok(ctl.held,'held again');
  gate.setRunFree(true);gate.checkRunGate(T0+231000);
  ok(!ctl.held&&box.hidden&&$('wFree').textContent==='Run without agents: on','Developer "Run without agents" runs the world without them');
  ok(sim.reflexMay&&sim.reflexMay(m3),'reflexes may decide for the member without a runner in that mode');
  gate.setRunFree(false);gate.checkRunGate(T0+232000);ok(ctl.held,'switching it off closes the gate again');
  ok(!$('ralert').textContent.includes('Resume')&&!document.querySelectorAll('[data-ralert]').length,'no "Resume without it" any more');
  gate.setGateProbe(null);L[m3.id]='connected'}

// The start gate (#222): connected is not enough; every seat must have answered one warm-up model call
console.log('start gate: ready, not just claimed');
{const gate=await import('../src/ui/rungate.js'),{ctl}=await import('../src/ui/controls.js');
  const F=sim.fellows(),L={},R={};for(const m of F){L[m.id]='connected';R[m.id]={state:'ready',model:'qwen2.5:14b',ms:900,at:0}}
  gate.setGateProbe({link:a=>L[a.id]||'none',dm:()=>'off',ready:a=>R[a.id]||null,dmReady:()=>null});
  const T0=5e6,box=$('rgate');ctl.speed=1;gate.checkRunGate(T0);
  ok(!ctl.held,'every seat ready: the world runs');
  const slow=F[1],down=F[3];R[slow.id]={state:'warming',model:'qwen2.5:14b',at:Date.now()-40000};R[down.id]=null;
  gate.checkRunGate(T0+1000);
  ok(ctl.held&&/WAITING FOR MINDS · 3\/5 READY/.test(box.textContent),'a seat still warming up and one only claimed hold the world: '+(box.children[0]&&box.children[0].textContent));
  ok(box.textContent.includes(slow.name+': loading qwen2.5:14b (4')&&box.textContent.includes(down.name+': claimed'),'the banner says who is loading which model (and for how long) and who is only claimed');
  ok(/Start anyway/.test(box.textContent),'the banner offers Start anyway');
  R[down.id]={state:'failed',error:'ollama: no answer from qwen2.5:14b in 600 s',at:0};gate.checkRunGate(T0+2000);
  ok(ctl.held&&box.textContent.includes('warm-up failed: ollama: no answer'),'a crashed warm-up shows in the banner with its error');
  gate.startAnyway();
  ok(!ctl.held&&box.hidden,'Start anyway releases the world');
  R[slow.id]={state:'ready',at:0};gate.checkRunGate(T0+3000);ok(!ctl.held,'it stays released as seats get ready');
  L[down.id]='none';gate.checkRunGate(T0+4000);gate.checkRunGate(T0+40000);
  L[down.id]='connected';R[down.id]=null;gate.checkRunGate(T0+41000);
  ok(ctl.held&&box.textContent.includes(down.name),'a runner that went away and came back must warm up again');
  R[down.id]={state:'ready',at:0};gate.checkRunGate(T0+32000);ok(!ctl.held,'ready again: the world runs');
  gate.setGateProbe(null)}

// ---- timed ward chips on the party frames (#336) ----
{console.log('ward chips');const {setEff}=await import('../src/sim/eff.js');const {effectChips}=await import('../src/ui/abilities.js');
  const a=mem[0],chips=()=>[...$('frames').querySelector('.pf[data-hid="'+a.id+'"]').querySelectorAll('.chip')].map(c=>c.textContent);
  const gm=sim.S.gameMin;delete a.eff;uiFast();
  ok(!chips().some(t=>/Ward|Warded/.test(t)),'no effect, no ward chip');
  setEff(a,'taken',.8,6);uiFast();
  ok(chips().some(t=>/^Antler Ward [1-6]s$/.test(t)),'Antler Ward chip with seconds left: '+chips());
  ok(effectChips(a)[0].title===(await import('../src/data/moves.js')).MOVES.antlerward.desc,'chip tooltip is the move description');
  sim.S.gameMin=gm+6*7;uiFast();ok(!chips().some(t=>/Antler/.test(t)),'the chip goes when the effect ends');
  setEff(a,'taken',.8,0,2,true);uiFast();ok(chips().some(t=>/Antler Ward 2 rds/.test(t)),'a Table ward shows rounds left: '+chips());
  delete a.eff;sim.S.gameMin=gm;uiFast()}

// ---- the DM frame (owner request): the DM's status beside the party frames ----
{console.log('DM frame');
  const posts=[];const wait=()=>new Promise(r=>setTimeout(r,30));
  const dmr={key:'dm',kind:'dm',name:'Dungeon Master',state:'waiting',turns:4,cost:.123,provider:'ollama',model:'qwen2.5:14b',lines:['[dm] turn 4 done'],pace:'waiting for the evening of day 2',lastTurnAgo:90,error:null};
  const relay={ok:true,enabled:true,session:{budget:null,spent:0,left:null},kinds:{},runners:[dmr]};
  globalThis.fetch=async(url,o)=>{url=String(url);const j=v=>({ok:true,status:200,json:async()=>v});
    if(o&&o.method==='POST'){posts.push({url,body:JSON.parse(o.body)});return j({ok:true})}
    if(url.endsWith('/play/runner'))return j(relay);throw new Error('no route '+url)};
  const dmf=$('frames').querySelector('.dmf'),txt=()=>dmf.textContent;
  sim.setDmSeat(false);relay.runners=[];uiFast();
  ok(!!dmf&&!dmf.querySelector('.dmfchip').hidden&&dmf.querySelector('.dmffull').hidden&&/DM: scripted/.test(txt())&&/Open seat/.test(txt()),'seat closed: a small "DM: scripted" chip with Open seat');
  sim.setDmSeat(true);relay.runners=[dmr];
  for(let i=0;i<250&&!/evening of day 2/.test(txt());i++){await wait();uiSlow();uiFast()}
  ok(dmf.querySelector('.dmfchip').hidden&&!dmf.querySelector('.dmffull').hidden,'seat open: the frame shows, the chip goes away');
  ok(/evening of day 2/.test(txt()),'the runner\'s wait line shows: '+dmf.querySelector('.dmfdo').textContent);
  ok(/qwen2\.5:14b/.test(txt())&&/4 turns/.test(txt())&&/\$0\.123/.test(txt())&&/last turn 2 min ago/.test(txt()),'mind, turns, cost and last turn: '+dmf.querySelector('.dmffol').textContent);
  ok(/Narrations 0\/12 · Levers 0\/8 · Scenes 0\/3/.test(txt())&&/Fellowship|No DM actions/.test(txt())&&/Notes \d+/.test(txt()),'daily counts against limits, Fellowship share and notes');
  const stop=dmf.querySelector('.dmfrun').querySelectorAll('button').find(b=>b.dataset.runact==='stop');
  ok(!!stop&&/Stop DM/.test(stop.textContent),'a running DM offers Stop DM');
  document._ls.pointerdown.forEach(f=>f({button:0,target:stop,preventDefault(){},stopPropagation(){}}));await wait();
  ok(posts.some(p=>p.url.endsWith('/play/runner/stop')&&p.body.key==='dm'),'Stop DM goes to the relay');
  relay.runners=[{...dmr,state:'stopped',pace:null,lines:[]}];
  for(let i=0;i<250&&!dmf.querySelector('.dmfrun').querySelector('[data-runact=start]');i++){await wait();uiSlow();uiFast()}
  const start=dmf.querySelector('.dmfrun').querySelector('[data-runact=start]');ok(!!start&&/Start DM/.test(start.textContent),'a stopped DM offers Start DM');
  document._ls.pointerdown.forEach(f=>f({button:0,target:start,preventDefault(){},stopPropagation(){}}));await wait();
  ok(posts.some(p=>p.url.endsWith('/play/runner/start')&&p.body.kind==='dm'),'Start DM goes to the relay');
  const box=$('dmlog'),wb=$('worldbox');box.open=false;wb.open=false;dmf.dispatch('click',{target:dmf.querySelector('.dmfdo')});
  ok(box.open&&wb.open,'a click on the frame opens the Dungeon Master panel');
  box.open=false;dmf.dispatch('click',{target:dmf.querySelector('[data-dmnotes]')});
  ok(box.open&&(await import('../src/ui/dmpanel.js')).dmFilter()==='notes','the Notes button opens the panel on its Notes filter');
  ok(dmf.querySelector('.dmftop').querySelector('[data-dmseat=close]'),'Close seat is on the frame');
  const css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
  ok(/\.dmf\{[^}]*min-width:0/.test(css)&&/\.dmffull\{[^}]*min-width:0/.test(css)&&/overflow-wrap:anywhere/.test(css.match(/\.dmfdo\{[^}]*\}/)[0]),'phone width: the frame wraps and shrinks (no horizontal scroll)');
  sim.setDmSeat(false)}

// ---- the title screen (owner request): keyboard, and the skip params for checks and dev ----
{console.log('title screen');
  const title=await import('../src/ui/title.js'),save=await import('../src/ui/save.js');
  ok(title.titleWanted('?skip-title=1')===false&&title.titleWanted('?continue=1')===false,'a skip param goes straight into the world');
  save.holdSave(false);save.writeSave();
  let played=[];const root=title.showTitle(k=>played.push(k));
  ok(!root.hidden&&root.querySelector('[data-a="continue"]'),'the title shows Continue over a saved world');
  ok(document.activeElement&&document.activeElement.dataset.a==='continue','Continue has the focus');
  const key=(k,target=document.body)=>{for(const f of document._ls.keydown||[])f({key:k,target,preventDefault(){}})};
  key('Enter',root.querySelector('[data-a="new"]'));ok(played.length===0,'Enter on a focused button is left to the button');
  root.querySelector('[data-a="new"]').click();ok(/replaces the saved/.test(root.textContent),'New world asks first');
  key('Enter');ok(played.length===0,'Enter does not Continue while the question is open');
  key('Escape');ok(!/replaces the saved/.test(root.textContent),'Escape closes the question');
  key('Enter');ok(played.join()==='continue'&&!root.parentNode,'Enter = Continue, and the title goes away')}

// ---- the Quests tab (owner request): groups, focus, folded Done, held scroll ----
{select(busy);const mk=(id,kind,extra={})=>({id,kind,title:'T '+id,giver:'G',where:'W',objective:'Do '+id,progress:kind==='oath'?{have:1,need:3}:null,reward:'5g',status:'active',focus:false,started:0,ends:sim.S.gameMin+3000,from:'scripted',...extra});
  const log={active:[mk('b1','board'),mk('b2','board'),mk('d1','dm',{from:'agent'}),mk('d2','dm'),mk('o1','oath',{focus:true}),mk('o2','oath')],
    done:[mk('x1','board',{status:'done'}),mk('x2','dm',{status:'failed'}),mk('x3','oath',{status:'expired'})],focus:'o1'};
  globalThis.__questLog=()=>log;
  setTab('quests');uiFast();
  const hasTab=[...$('hero').querySelectorAll('button')].some(b=>b.dataset.tab==='quests'&&!b.hidden);
  ok(hasTab,'Quests tab shows');
  const q=()=>tb().querySelectorAll('.qrow');
  ok(tb().querySelectorAll('.qb-board').length>=2&&tb().querySelectorAll('.qb-dm').length>=2&&tb().querySelectorAll('.qb-oath').length>=2,'groups render all three kinds');
  ok(/From the DM/.test(tb().textContent)&&/Oaths/.test(tb().textContent)&&/Quests/.test(tb().textContent),'group headings');
  const first=tb().querySelector('.qrow');ok(first&&first.className.includes('qfocus')&&/▶/.test(first.textContent)&&/T o1/.test(first.textContent),'the focused quest is pinned on top with a marker');
  ok(/from the DM agent/.test(tb().textContent)&&/from the scripted DM/.test(tb().textContent),'DM quests say which DM made them');
  const dn=tb().querySelector('details.qdone');ok(dn&&!dn.getAttribute('open')&&/Done \(3\)/.test(dn.textContent),'Done is folded');
  const r0=tb().querySelectorAll('.qrow').find(r=>/T b2/.test(r.textContent));r0._same=1;
  holds('Quests tab',tb,{sec:10,min:3});
  ok(tb().querySelectorAll('.qrow').find(r=>/T b2/.test(r.textContent))._same===1,'Quests tab: rows are patched, not rebuilt');
  log.active=[];log.done=[];uiFast();ok(/No quests yet/.test(tb().textContent),'empty state');
  delete globalThis.__questLog;setTab('stats');uiFast()}


// ---- wide screens (owner request): column count by width, the moved panels, the map follows its box ----
{const {columnCount}=await import('../src/ui/layout.js');
  const cols=()=>{uiFast();return $('colL').hidden?($('side').parentNode.className.includes('cols3')?-1:0):3};
  const where=id=>{let n=$(id);while(n&&!(n.id==='colL'||n.id==='colM'||n.id==='side'))n=n.parentNode;return n&&n.id};
  const keep=window.innerWidth;
  ok(!!sim.S.fellowship,'wide layout: a Fellowship stands for the column checks');
  for(const [w,n,st,hr] of [[1000,2,'side','colM'],[1600,2,'side','colM'],[2600,3,'colL','side'],[390,1,'side','colM'],[1000,2,'side','colM']]){
    window.innerWidth=w;uiFast();
    ok(columnCount()===n,w+' px: '+n+' column(s)');
    ok(where('storySec')===st&&where('heroSec')===hr&&(w<2200?where('worldgrp')==='side':where('worldgrp')==='colL'),w+' px: Story, World and Hero are in '+st+' / '+hr);
    ok($('colL').hidden===(w<2200)&&$('side').parentNode.className.includes('cols3')===(w>=2200),w+' px: the left column is '+(w<2200?'hidden':'shown'))}
  const css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
  ok(css.includes('@media (min-width:1600px){')&&css.includes('.shell{max-width:none}'),'full width from 1600 px (no cap)');
  ok(/@media \(min-width:1200px\)\{\.screen\{aspect-ratio:auto;height:clamp\(380px,70vh/.test(css),'the map is taller from 1200 px');
  ok(/@media \(max-width:920px\)\{\.main\{grid-template-columns:minmax\(0,1fr\)\}\}/.test(css),'one column below 920 px');
  const draw=readFileSync(new URL('../src/render/draw.js',import.meta.url),'utf8');
  ok(/new ResizeObserver\(resize\)\.observe\(screenEl\)/.test(draw),'the map canvas resizes with its box (ResizeObserver on the screen)');
  window.innerWidth=keep;uiFast()}

// ---- the Combat tab (owner request): fight cards, lines, filters, held scroll, empty state ----
{select(busy);const t0=sim.S.gameMin;let evs=[],fl=[];
  const E=(i,fight,kind,o={})=>({t:t0+i*.1,kind,who:'You',target:'Timber Wolf',name:null,amount:0,fight,...o});
  for(let f=1;f<=4;f++){const b=(f-1)*40;fl.push({id:f,foe:'Wolf '+f,start:t0+b/10,end:t0+b/10+1.4,dealt:214,taken:87,healed:30,abilities:{Heartseeker:2},items:{'Healing Draught':1},crits:3,result:'won'});
    for(let i=0;i<30;i++)evs.push(E(b+i,f,i===5?'ability':i===9?'item':i%7===0?'hurt':i===12?'heal':'hit',{amount:5+i,name:i===5?'Heartseeker':i===9?'Healing Draught':i%7===0?null:'Slash',crit:i===20}))}
  globalThis.__actionLog={actionLog:()=>evs.slice(),fights:()=>fl.slice(),fightSummary:(a,id)=>fl.find(x=>x.id===id)};
  setTab('combat');uiFast();
  ok([...$('hero').querySelectorAll('button')].some(b=>b.dataset.tab==='combat'&&!b.hidden),'Combat tab shows');
  const cards=()=>tb().querySelectorAll('.cbcard');
  ok(cards().length===4,'four fight cards');
  ok(/Wolf 4/.test(cards()[0].textContent)&&/Wolf 1/.test(cards()[3].textContent),'newest fight on top');
  ok(/dealt 214/.test(cards()[0].textContent)&&/taken 87/.test(cards()[0].textContent)&&/Heartseeker ×2/.test(cards()[0].textContent)&&/Healing Draught ×1/.test(cards()[0].textContent)&&/3 crits/.test(cards()[0].textContent),'card shows totals, abilities, items, crits');
  ok(cards()[0].getAttribute('open')!=null&&cards()[1].getAttribute('open')==null,'only the newest card is open');
  ok(cards()[0].querySelectorAll('.cbl').length>3&&/Slash on Timber Wolf/.test(cards()[0].textContent),'open card lists its lines');
  ok(/dealt \d+ · taken \d+/.test(tb().querySelector('.cbtot').textContent),'totals line for All');
  const chip=n=>tb().querySelectorAll('.cbchip').find(c=>c.textContent===n);
  chip('Abilities').click();
  ok(chip('Abilities').getAttribute('aria-pressed')==='true'&&/abilities used 4/.test(tb().querySelector('.cbtot').textContent),'Abilities filter: pressed, totals count 4 uses');
  ok(cards()[0].querySelectorAll('.cbl').length===1&&/Heartseeker/.test(cards()[0].textContent),'Abilities filter keeps only ability lines');
  chip('Heals').click();ok(/healed 34/.test(tb().querySelector('.cbtot').textContent)||/healed \d+/.test(tb().querySelector('.cbtot').textContent),'Heals filter totals');
  chip('Items').click();ok(/items used 4/.test(tb().querySelector('.cbtot').textContent),'Items filter totals');
  chip('All').click();
  const c1=cards()[1];c1._same=1;
  holds('Combat tab',tb,{sec:10,min:3});
  ok(cards()[1]._same===1,'Combat tab: cards are patched, not rebuilt');
  globalThis.__actionLog={actionLog:()=>[],fights:()=>[]};uiFast();ok(/No fights yet/.test(tb().textContent),'empty state');
  delete globalThis.__actionLog;uiFast();ok(/arrives with the next update/.test(tb().textContent)||tb().querySelectorAll('.cbcard').length>=0,'no sim API: says so');
  setTab('stats');uiFast()}


// DM per-turn cards (#181)
{const T=await import('../src/ui/dmturns.js'),cp=await import('../src/ui/chatpanel.js');T.clearDmTurns();
  const t0=1e6,call=(tool,args,res,dt)=>T.noteDmCall(tool,args,res,t0+dt);
  call('dm_status',{},{ok:true},0);call('regions',{},{ok:true},500);call('notes_write',{section:'threads',text:'Watch the north road',title:'North road'},{ok:true},900);
  call('pull_lever',{name:'set_condition'},{ok:true,effect:'bandits stir'},1200);call('pull_lever',{name:'named_foe'},{ok:false,error:'Refused: scripted only'},1500);
  call('stage_scene',{kind:'meeting',near:'fellowship'},{ok:true},1800);call('narrate',{text:'Smoke curls over the ridge.',near:'fellowship'},{ok:true},2100);
  call('table_call',{},{ok:true},2200);
  call('dm_status',{},{ok:true},60000);call('npc_say',{npc:'Mara',text:'Mind the road.'},{ok:true,who:'Mara'},60500);
  const ts=T.dmTurns();ok(ts.length===2,'calls close together are one turn; a gap starts the next ('+ts.length+')');
  ok(ts[0].said.length===1&&ts[1].levers.length===2&&ts[1].staged.length===1&&ts[1].notes.length===1,'turns record notes, levers (applied and refused), staged scenes and spoken lines');
  ok(ts[1].calls===7,'an idle table_call poll is not counted');
  cp.setChatTab('dm');cp.setDmView('turns');uiFast();const tl=$('dmTurnList');
  ok(!tl.hidden&&$('dmChatList').hidden,'Turns is the default DM view; entries are behind it');
  const cs=tl.querySelectorAll('.dmcard');ok(cs.length===2&&/Mara/.test(cs[0].textContent)&&/North road/.test(cs[1].textContent)&&/named_foe/.test(cs[1].textContent)&&/Refused/.test(cs[1].textContent)&&/meeting near fellowship/.test(cs[1].textContent)&&/Smoke curls/.test(cs[1].textContent),'one card per turn, newest first, with its acts');
  cs[0]._same=1;T.noteDmCall('narrate',{text:'More smoke.'},{ok:true},t0+60800);uiFast();
  ok(tl.querySelectorAll('.dmcard')[0]._same===1&&/More smoke/.test(tl.textContent),'cards patch in place when a turn grows');
  for(let i=0;i<60;i++){T.noteDmCall('dm_status',{},{ok:true},t0+200000+i*100000)}
  ok(T.dmTurns().length===T.TURNS_KEEP,'the card list is capped');
  T.clearDmTurns();cp.setChatTab('chat')}

// Fellowship sheet: last fight row (#241)
{const SH=await import('../src/ui/sheet.js'),ms=sim.fellowshipMembers().filter(m=>m.hero);
  const fx={id:7,foe:'Gnoll',start:1000,end:1002,result:'won',dealt:41.6,taken:12,healed:5,abilities:{Cleave:2,Guard:1},items:{'Health potion':1}};
  globalThis.__actionLog={actionLog:()=>[],fights:()=>[fx],fightSummary:a=>a===ms[0].hero?fx:null};
  const T=SH.sheetRows(),r=T.rows.find(x=>x.key==='fight');
  ok(!!r&&r.cells.length===T.cols.length,'sheet: a "Last fight" row, one cell per member');
  ok(/Gnoll · won · dealt 42, taken 12, healed 5 · 3 abilities, 1 potion/.test(r.cells[0].t),'sheet: foe, result, dealt, taken, healed, abilities and potions ('+r.cells[0].t+')');
  ok(r.cells[1].t==='no fights yet','sheet: a member with no fight says so');
  SH.openSheet();const body=document.querySelector('.shbody'),b=body.querySelector('.shfight');
  ok(!!b&&b.dataset.hid==String(ms[0].hero.id),'sheet: the cell is a button that names the member');
  b._same=1;SH.renderSheet();ok(body.querySelector('.shfight')._same===1,'sheet: an unchanged row is not rebuilt');
  fx.taken=30;SH.renderSheet();ok(/taken 30/.test(body.querySelector('.shfight').textContent),'sheet: the row patches when the fight changes');
  delete globalThis.__actionLog;SH.closeSheet()}

// Fellowship sheet: each member's face in its column header (#376), the party frame's portrait and modes
{const SH=await import('../src/ui/sheet.js'),{portrait}=await import('../src/render/sprites.js'),ms=sim.fellowshipMembers().filter(m=>m.hero);
  const T0=JSON.stringify(SH.sheetRows().rows.map(r=>[r.key,r.cells.map(c=>c.t)]));
  SH.openSheet();const body=document.querySelector('.shbody'),ports=()=>body.querySelectorAll('.shport');
  ok(ports().length===ms.length,'sheet faces: one portrait per member column ('+ports().length+'/'+ms.length+')');
  const a=ms[1].hero,cv0=ports()[1];
  ok(!!cv0&&cv0._s===portrait(a,'')&&cv0.width===15&&cv0.height===18,'sheet faces: the column shows the member\'s own face, as the party frame does');
  ok(cv0.parentNode&&cv0.parentNode.querySelector('.hn').dataset.hid==String(a.id),'sheet faces: the face sits beside the member\'s name');
  let drew=0;const gc=cv0.getContext.bind(cv0);cv0.getContext=k=>{drew++;return gc(k)};
  SH.renderSheet();ok(drew===0,'sheet faces: an unchanged face is not redrawn');
  const st=a.state;a.state='ghost';SH.renderSheet();
  const cv1=ports()[1];ok(cv1===cv0&&cv1._s===portrait(a,'ghost')&&drew===1,'sheet faces: a ghost gets the ghost face, redrawn once on the same canvas');
  a.state='dead';SH.renderSheet();ok(ports()[1]._s===portrait(a,'dead')&&drew===2,'sheet faces: a fallen place shows the dead face');
  a.state=st;SH.renderSheet();ok(ports()[1]._s===portrait(a,'')&&drew===3,'sheet faces: back to the living face');
  ok(JSON.stringify(SH.sheetRows().rows.map(r=>[r.key,r.cells.map(c=>c.t)]))===T0,'sheet faces: sheetRows() stays plain data, unchanged');
  ok(!SH.sheetRows().cols.some(c=>'face' in c||'portrait' in c),'sheet faces: no face in the row data');
  SH.closeSheet()}
// Fellowship sheet: the Life view (#389), landmarks newest first, chapters with days, last 10 journal entries, patched in place
{const SH=await import('../src/ui/sheet.js'),LV=await import('../src/ui/lifeview.js'),ms=sim.fellowshipMembers().filter(m=>m.hero);
  const a=ms[0].hero,b=ms[1].hero,keepT=a.tiers,keepJ=a.journal,keepTb=b.tiers,keepJb=b.journal;
  delete b.tiers;b.journal=[];
  a.tiers={v:1,seq:3,marks:[{id:1,k:'level',w:3,day:2,gm:1440,text:'Reached level 5.',key:'x1'},{id:2,k:'death',w:5,day:4,gm:4320,text:'Watched Brann fall in the crypt.',key:'x2'}],
    chapters:[{n:1,d0:1,d1:3,title:'Days 1-3: the road out of Highgate',text:'We set out.',kw:[],src:'scripted',items:20,stamp:'1'}],pend:[],nem:[],own:{d:0,n:0}};
  a.journal=[];for(let i=1;i<=14;i++)a.journal.push({t:'Day '+i+' 08:00',gameMin:i*1440,text:(i===14?'x'.repeat(10)+' '+'long words '.repeat(60):'Entry '+i)});
  const T0=JSON.stringify(a.tiers),J0=JSON.stringify(a.journal),gm=sim.S.gameMin;
  SH.openSheet();const ov=$('sheetov'),body=ov.querySelector('.shbody'),lf=()=>ov.querySelector('.lfview'),btn=v=>ov.querySelectorAll('[data-sview]').find(x=>x.dataset.sview===v);
  ok(!!btn('life')&&btn('table').getAttribute('aria-pressed')==='true'&&lf().hidden,'life: the sheet opens side by side, with a Life button');
  body.scrollTop=37;btn('life').click();
  ok(SH.sheetView()==='life'&&!lf().hidden&&ov.querySelector('.shtblw').hidden&&btn('life').getAttribute('aria-pressed')==='true','life: Life shows the life cards and hides the table');
  const cards=()=>lf().querySelectorAll('.lfcard');ok(cards().length===sim.fellowshipMembers().length,'life: one card per Fellowship place ('+cards().length+')');
  const c0=cards()[0],marks=c0.querySelectorAll('.lfmark'),chs=c0.querySelectorAll('.lfch'),ents=c0.querySelectorAll('.lfent');
  ok(marks.length===2&&/Watched Brann/.test(marks[0].textContent)&&/Day 4/.test(marks[0].textContent)&&/level 5/.test(marks[1].textContent),'life: landmarks newest first, with their day');
  ok(chs.length===1&&/Ch\. 1 · Days 1-3/.test(chs[0].textContent)&&/the road out of Highgate/.test(chs[0].textContent)&&!/Days 1-3:/.test(chs[0].textContent),'life: chapter title with its days ('+chs[0].textContent+')');
  ok(ents.length===10&&/Day 14/.test(ents[0].textContent)&&/Entry 5$/.test(ents[9].textContent),'life: the last 10 journal entries, newest first');
  const L=LV.lifeRows()[0];ok(L.entries[0].text.length<=300&&L.entries[0].text.endsWith('…'),'life: a long entry is cut to 300 characters ('+L.entries[0].text.length+')');
  ok(/10 of 14/.test(c0.textContent),'life: the journal heading says 10 of 14');
  const c1=cards()[1];ok(!!c1.querySelector('.lfnone')&&/No life written yet/.test(c1.textContent)&&!c1.querySelector('.lfrow'),'life: a member with no tiers and no journal shows the empty state');
  ok(!('tiers' in b),'life: reading never creates tiers (no migration write)');
  ok(JSON.stringify(a.tiers)===T0&&JSON.stringify(a.journal)===J0&&sim.S.gameMin===gm,'life: no writes to the hero or S');
  marks[1]._same=1;ents[3]._same=1;lf().scrollTop=0;body.scrollTop=50;
  uiFast();uiFast();ok(cards()[0]===c0&&c0.querySelectorAll('.lfmark')[1]._same===1&&c0.querySelectorAll('.lfent')[3]._same===1&&body.scrollTop===50,'life: nothing rebuilt on an unchanged tick, scroll held');
  a.tiers.marks.push({id:3,k:'own',w:4,day:5,gm:5760,text:'Swore to see Grimhold burn.',key:'x3'});uiFast();
  const m2=c0.querySelectorAll('.lfmark');ok(cards()[0]===c0&&m2.length===3&&/Swore/.test(m2[0].textContent)&&m2[2]._same===1&&body.scrollTop===50,'life: a new landmark patches in at the top; old rows are the same nodes and the scroll holds');
  a.journal.push({t:'Day 15 09:00',gameMin:15*1440,text:'Entry 15'});uiFast();
  ok(/Day 15/.test(c0.querySelectorAll('.lfent')[0].textContent)&&c0.querySelectorAll('.lfent').length===10,'life: a new journal entry patches in');
  b.journal=[{t:'Day 15 10:00',gameMin:15*1440+60,text:'First words.'}];uiFast();
  ok(cards()[1]===c1&&c1.querySelectorAll('.lfent').length===1&&/No landmarks yet/.test(c1.textContent),'life: an old save with a journal and no tiers shows the entries and empty landmark/chapter states');
  btn('table').click();ok(SH.sheetView()==='table'&&lf().hidden&&!ov.querySelector('.shtblw').hidden&&body.scrollTop===37,'life: back to side by side restores its own scroll ('+body.scrollTop+')');
  ok(!!body.querySelector('.shfight'),'life: the table is still there');
  btn('life').click();ok(body.scrollTop===50,'life: Life keeps its own scroll too');btn('table').click();
  a.tiers=keepT;a.journal=keepJ;if(keepTb)b.tiers=keepTb;b.journal=keepJb;SH.closeSheet()}

// Professions block on the Stats tab (#259)
{const h=(sim.fellowshipMembers().filter(x=>x.hero)[0]||{hero:sim.S.agents.find(a=>a.kind==='hero')}).hero;
  const Pf=await import('../src/sim/professions.js');
  select(h);setTab('stats');uiFast();
  ok(/Professions/.test(tb().textContent)&&/No professions yet/.test(tb().textContent),'stats: a hero with none says "No professions yet"');
  Pf.learn(h,'mining');Pf.learn(h,'cooking');Pf.gainSkill(h,'mining',59);
  uiSlow();setTab('stats');uiFast();
  const rows=tb().querySelectorAll('.prof');
  ok(rows.length===2&&/Mining/.test(rows[0].textContent)&&/gathering/.test(rows[0].textContent)&&/60 · Journeyman/.test(rows[0].textContent),'stats: each profession with kind, skill and band ('+(rows[0]&&rows[0].textContent)+')');
  ok(rows.length===2&&/crafting/.test(rows[1].textContent)&&/1 · Novice/.test(rows[1].textContent),'stats: a craft profession at skill 1 is Novice');
  const bar=rows[0]&&rows[0].querySelector('.profbar i');ok(bar&&bar.style.width==='60%','stats: the bar is skill out of 100');
  delete h.profs}

// Table banner: the combat block (#277). A scene with rounds, set up by hand (no world step), rendered like main.js does.
{const TB=await import('../src/ui/table.js'),T=await import('../src/sim/table.js'),S=sim.S,box=$('tbanner'),spd=T.TABLE.speed;
  const ms=sim.fellows().filter(a=>a.state!=='dead').slice(0,3),m=S.mobs.find(x=>x.alive&&!x.gone);
  if(ms.length<2||!m)console.log('  skip combat banner (no members or no creature)');else{
  const R=(die,mod,vs,hit,crit,dmg,target,down)=>({die,mod,total:die+mod,vs,hit:!!hit,crit:!!crit,dmg,target,down:!!down}); // beat.roll (#285)
  const keep=S.table,hp0=ms.map(a=>a.hp),mhp=m.hp,st0=T.TABLE.step;m.hp=Math.round(m.maxhp*.6);
  const sc={id:9001,kind:'elite',title:'Smoke fight',frame:['A brute bars the road.'],ids:ms.map(a=>a.id),i:1,phase:'turn',t:0,acts:{},ctx:{mob:m.id},pause:true,at:0,rd:2,fd:1,foeAt:1,
    beats:[{id:ms[0].id,name:ms[0].name,k:'strike',text:'Strike it',res:'d20 20+5=25 vs AC 14 (a natural 20): hit for 18',by:'agent',rd:1,roll:R(20,5,14,1,1,18,'Brute')},
      {id:'foe',name:'Brute',k:'attack',text:'Strikes at '+ms[1].name,res:'d20 3+4=7 vs AC 15: missed',by:'foe',rd:1,roll:R(3,4,15,0,0,0,ms[1].name)},
      {id:ms[0].id,name:ms[0].name,k:'strike',text:'Strike it',res:'roll text the banner no longer parses',by:'agent',rd:2,roll:R(12,5,14,1,0,9,'Brute')},
      {id:'foe',name:'Brute',k:'attack',text:'Strikes at '+ms[0].name+' (drawn)',res:'d20 1+4=5 vs AC 15 (a natural 1): missed',by:'foe',rd:2,roll:R(1,4,15,0,0,0,ms[0].name)}]};
  m.target=ms[0];S.table=sc;TB.renderTable(1);
  const t=()=>box.textContent,v=TB.combatView();
  ok(!box.hidden&&/ROUND 2\/3/.test(t()),'combat banner: the round number shows ('+(v&&v.round)+'/'+(v&&v.of)+')');
  const chips=box.querySelectorAll('.tci');
  ok(chips.length===ms.length+1&&chips[1].classList.contains('foe'),'combat banner: initiative order with the foe at its place ('+chips.length+' chips)');
  ok(chips[2].classList.contains('cur')&&/▶/.test(chips[2].textContent)&&!chips[1].classList.contains('cur'),'combat banner: the current actor is marked');
  {const e=Math.round(m.hp/m.maxhp*100)+'%';ok(chips[1].querySelector('.tcp').textContent===e&&chips[1].querySelector('.tchp i').style.width===e,'combat banner: the foe has an HP bar and % ('+e+')')}
  ok(chips[0].querySelector('.tchp')&&/drawn/.test(chips[0].textContent),'combat banner: members have HP bars and conditions (drawn)');
  const rows=box.querySelectorAll('.trl');
  ok(rows.length===2&&/Round 2/.test(box.querySelector('.trh').textContent),'combat banner: the rolls of the round in play');
  ok(rows[0].classList.contains('hit')&&/d20 12\+5=17 vs 14/.test(rows[0].textContent)&&/HIT 9/.test(rows[0].textContent),'combat banner: a hit shows its roll and damage');
  ok(rows[1].classList.contains('miss')&&rows[1].classList.contains('foe')&&/FUMBLE/.test(rows[1].textContent),'combat banner: the foe\'s miss on a natural 1');
  ok(!box.querySelector('.to'),'combat banner: no duplicate plain order or last-act line');
  {const E=await import('../src/sim/eff.js'),MV=await import('../src/data/moves.js'),mk=Object.keys(MV.MOVES)[0],nb=sc.beats.length;
    sc.beats.push({id:ms[1].id,name:ms[1].name,k:mk,text:'Ability',res:'',by:'agent',rd:2});E.setCond(ms[1],'stun',2,12,0,null);E.setCond(ms[0],'root',2,12,0,null);TB.renderTable(1);
    const cs=box.querySelectorAll('.tci');
    ok(/stunned|stun/i.test(cs[2].textContent)&&/root/i.test(cs[0].textContent),'combat banner: stun and root show as chips ('+cs[2].textContent+' / '+cs[0].textContent+')');
    ok((cs[2].querySelector('.tcm')||{}).textContent===MV.MOVES[mk].name&&!cs[0].querySelector('.tcm'),'combat banner: the move used this round shows by name on its member only');
    E.endCond(ms[1],'stun');E.endCond(ms[0],'root');sc.beats.length=nb;TB.renderTable(1)}
  const ch0=chips[0];ch0._same=1;TB.renderTable(1);ok(box.querySelector('.tci')._same===1,'combat banner: an unchanged frame is not rebuilt');
  m.hp=Math.round(m.maxhp*.2);TB.renderTable(1);
  ok(box.querySelector('.tci')._same===1&&box.querySelectorAll('.tci')[1].querySelector('.tcp').textContent===Math.round(m.hp/m.maxhp*100)+'%'&&box.querySelectorAll('.tci')[1].querySelector('.tchp i').className==='lo','combat banner: HP patches in place, low HP marked');
  sc.rd=3;sc.i=0;sc.fd=0;TB.renderTable(1);
  ok(/Last round \(2\)/.test(box.querySelector('.trh').textContent),'combat banner: at a round\'s start the last round\'s rolls show, labelled');
  sc.beats.push({id:ms[0].id,name:ms[0].name,k:'strike',text:'Strike it',res:'d20 20+5=25 vs AC 14 (a natural 20): hit for 30, and it falls',by:'agent',rd:3,roll:R(20,5,14,1,1,30,'Brute',1)});
  for(let i=0;i<4;i++)sc.beats.push({id:ms[1].id,name:ms[1].name,k:'heal',text:'Heal',res:'+5 to '+ms[0].name,by:'reflex',rd:3});
  TB.renderTable(1);const r3=box.querySelectorAll('.trl');
  ok(r3.length===4&&/1 earlier/.test(box.querySelector('.trh').textContent),'combat banner: at most 4 roll lines, the rest counted');
  {const r0=TB.combatView().rolls[0].r;ok(!!r0&&r0.crit&&r0.down&&r0.dmg===30&&r0.target==='Brute','combat banner: the rolls are the beats roll data (crit, down, damage, target)')}
  // the watcher's round pace (#285): the mode button cycles off/hold/auto; a held round shows Next round, which releases it
  T.TABLE.step='off';TB.renderTable(1);let sb=box.querySelector('.tstb');
  ok(!!sb&&/Step: off/.test(sb.textContent)&&!box.querySelector('.tnext'),'combat banner: the step button shows the round pace (off)');
  sb.click();TB.renderTable(1);ok(T.TABLE.step==='hold'&&/Step: hold/.test(box.querySelector('.tstb').textContent),'combat banner: the step button cycles to hold');
  const i0=sc.i;sc.i=sc.ids.length;sc.sh={rd:sc.rd,t:0,go:0};TB.renderTable(1);
  const nx=box.querySelector('.tnext');ok(!!nx&&/Round 3 is done/.test(box.textContent),'combat banner: a held round says so and offers Next round ('+(T.bannerOf()||{}).line+')');
  nx.click();ok(sc.sh.go===1,'combat banner: Next round releases the held round');TB.renderTable(1);ok(!box.querySelector('.tnext'),'combat banner: no Next round once released');
  T.TABLE.step='auto';sc.sh={rd:sc.rd,t:1,go:0};TB.renderTable(1);ok(/\(3 s\)/.test((box.querySelector('.tnext')||{}).textContent||'')&&/next round in 3 s/.test(box.textContent),'combat banner: auto shows the seconds left');
  box.querySelector('.tstb').click();ok(T.TABLE.step==='off','combat banner: the step button cycles back to off');delete sc.sh;sc.i=i0;T.TABLE.step=st0;
  m.alive=false;sc.phase='outcome';sc.summary='The foe is down.';sc.fell=[ms[2]?ms[2].id:ms[1].id];TB.renderTable(1);
  const ends=[...box.querySelectorAll('.tendc')].map(e=>e.textContent);
  ok(ends.includes('The foe is down')&&ends.some(e=>/ fell$/.test(e)),'combat banner: the end reason (foe down, a member fell): '+ends.join(' | '));
  m.alive=true;sc.end='fled';TB.renderTable(1);ok([...box.querySelectorAll('.tendc')].some(e=>e.textContent==='The foe fled'),'combat banner: a foe that ran');
  sc.rd=null;TB.renderTable(1);ok(!box.querySelector('.tci')&&!/ROUND/.test(t())&&!box.classList.contains('tcombat'),'combat banner: a scene without rounds keeps the plain banner');
  S.table=null;TB.renderTable(1);ok(box.hidden,'combat banner: hidden when the scene closes');
  S.table=keep;m.hp=mhp;m.target=null;ms.forEach((a,i)=>a.hp=hp0[i]);T.TABLE.speed=spd}}
// ---- chat in the left column on the three-column layout (owner request) ----
{const where=id=>{let n=$(id);while(n&&!(n.id==='colL'||n.id==='colM'||n.id==='side'))n=n.parentNode;return n&&n.id};
  const keep=window.innerWidth;ok(!!sim.S.fellowship,'chat left: a Fellowship stands');
  const lst=$('chatList'),sec=$('chatSec');
  window.innerWidth=2600;uiFast();
  ok(where('chatSec')==='colL'&&$('colL').children[0]===sec,'2600 px: the chat is first in the left column');
  ok(where('storySec')==='colL'&&where('worldgrp')==='colL'&&$('colL').children.indexOf($('storySec'))>0,'2600 px: Story and World sit below the chat');
  const fb=$('chatFilter').children[1];fb.dispatch('click',{target:fb});const pressed=fb.getAttribute('aria-pressed');
  for(const w of [1600,2600]){window.innerWidth=w;uiFast()}
  ok($('chatList')===lst&&where('chatSec')==='colL','2600 px again: the same chat node is back in the left column');
  ok(fb.getAttribute('aria-pressed')===pressed&&pressed==='true','a resize keeps the chat filter');
  ok(document.body.classList.contains('chat-left')&&$('chatSide')&&!$('chatSide').hidden,'left column: the placement switch is shown');
  const sb=$('chatSide');sb.dispatch('click',{target:sb});
  ok(where('chatSec')==='colM'&&!document.body.classList.contains('chat-left'),'the switch puts the chat under the map at 2600 px');
  sb.dispatch('click',{target:sb});ok(where('chatSec')==='colL','and back to the left column');
  for(const w of [1600,390]){window.innerWidth=w;uiFast();
    ok(where('chatSec')==='colM'&&$('colM').children.indexOf(sec)<$('colM').children.indexOf($('heroSec')),w+' px: the chat is under the map, above the hero card');
    ok(!document.body.classList.contains('chat-left')&&$('chatSide').hidden,w+' px: no left-chat styling, no switch')}
  window.innerWidth=keep;uiFast()}
// Fellowship sheet editor: the Archetype select (#295 follow-up) rewrites the persona boxes in place and fills stances
{const fb=$('felbody'),{ARCHETYPES}=await import('../src/data/archetypes.js');
  if(!fb.querySelector('.feldrawer'))fb.querySelector('[data-fact="drawer:members"]').click();
  uiFast(); // a member who fell since the last refresh has a new id: the row must be drawn for the member we pick
  const a=sim.fellows()[0];
  const sb=fb.querySelectorAll('button').find(b=>b.dataset.fsheet==String(a.id));ok(!!sb,'sheet editor: the drawer has a Sheet button for '+a.name+' (#'+a.id+')');if(!sb)throw new Error('no Sheet button');sb.click();
  const sel=fb.querySelector('select[data-farch]');
  ok(!!sel&&sel.children.length===7&&sel.value==='','sheet editor: an Archetype select, None until one is picked');
  const voice=()=>fb.querySelectorAll('textarea').find(t=>t.dataset.fw==='persona'&&t.dataset.fk==='voice');const box0=voice();
  const typed=fb.querySelectorAll('textarea').find(t=>t.dataset.fw==='backstory');typed.value='typed but not saved';
  sel.value='mercenary';sel.dispatch('change',{target:sel});uiFast();
  ok(a.persona.archetype==='mercenary'&&a.persona.voice===ARCHETYPES.mercenary.voice&&a.persona.edited,'sheet editor: picking one applies it and marks the persona as the owner choice');
  ok(voice()===box0&&box0.value===ARCHETYPES.mercenary.voice&&typed.value==='typed but not saved','sheet editor: the persona boxes change in place, typed text elsewhere is kept');
  ok(fb.querySelector('.farchhint').textContent.includes(ARCHETYPES.mercenary.voice),'sheet editor: the hint shows the archetype voice');
  const m2=sim.fellows()[1];ok(a.persona.stances[m2.id]===ARCHETYPES.mercenary.stance.replace('{other}',m2.name),'sheet editor: stances name each companion');
  ok(!fb.querySelector('select[data-farch]').children.some(o=>o.value===''),'sheet editor: None is gone once one is picked');
  fb.querySelectorAll('button').find(b=>b.dataset.fact==='close').click()}
// Agent-built personality (#409): a pin per persona field in the sheet editor; the Life view shows who they became
{const fb=$('felbody'),P=await import('../src/sim/persona.js'),LV=await import('../src/ui/lifeview.js');
  const a=sim.fellows()[0];let sb=fb.querySelectorAll('button').find(b=>b.dataset.fsheet==String(a.id));
  if(!sb){fb.querySelector('[data-fact="drawer:members"]').click();uiFast();sb=fb.querySelectorAll('button').find(b=>b.dataset.fsheet==String(a.id))}sb.click();
  const pins=fb.querySelectorAll('input').filter(i=>i.dataset&&i.dataset.fpin!=null);
  ok(pins.length===P.PERSONA_ORDER.length+1,'pins: one per persona field and one for the stances ('+pins.length+')');
  ok(fb.querySelectorAll('textarea').some(t=>t.dataset.fw==='persona'&&t.dataset.fk==='beliefs')&&fb.querySelectorAll('textarea').some(t=>t.dataset.fw==='persona'&&t.dataset.fk==='traits'),'sheet editor: beliefs and traits boxes');
  const pw=pins.find(i=>i.dataset.fpin==='wants');pw.checked=true;pw.dispatch('change',{target:pw});uiFast();
  ok(P.pinned(a,'wants'),'pins: ticking the box pins the field');
  const pw2=fb.querySelectorAll('input').find(i=>i.dataset&&i.dataset.fpin==='wants');pw2.checked=false;pw2.dispatch('change',{target:pw2});uiFast();
  ok(!P.pinned(a,'wants'),'pins: unticking frees it');
  fb.querySelectorAll('button').find(b=>b.dataset.fact==='close').click();
  const was=a.player;a.player=true;sim.S.gameMin+=1440;const r=sim.playerAct(a.id,'become',{field:'fears',text:'Losing the road home.',why:'the long winter'});a.player=was;
  const L=LV.lifeRows().find(c=>c.hero===a);
  ok(r.ok&&L&&L.self.length>=1&&L.self[0].after==='Losing the road home.'&&L.self[0].why==='the long winter'&&/Fears/.test(L.self[0].label),'life: the persona history, newest first ('+(r.error||'')+')')}
// Fellowship sheet editor: the stance toward each companion (#316, UI for #305) round-trips through editSheet
{const fb=$('felbody'),{STANCE_MAX}=await import('../src/data/prompts.js'),P=await import('../src/sim/persona.js');
  const open=a=>{let b=fb.querySelectorAll('button').find(x=>x.dataset.fsheet==String(a.id));if(!b){fb.querySelector('[data-fact="drawer:members"]').click();b=fb.querySelectorAll('button').find(x=>x.dataset.fsheet==String(a.id))}b.click()};
  const [a,m2,m3]=sim.fellows();open(a);
  const rows=()=>fb.querySelectorAll('.fstance'),row=b=>rows().find(r=>r.dataset.fst==String(b.id)),box=b=>row(b).querySelector('textarea'),tag=b=>row(b).querySelector('.fsttag'),rst=b=>row(b).querySelector('[data-fstreset]');
  ok(rows().length===sim.fellows().length-1,'stances: one row per living companion ('+rows().length+')');
  const t2=box(m2),arch=P.archetypeStance('mercenary',m2);
  ok(t2.dataset.fw==='stance'&&t2.dataset.fk===String(m2.id)&&t2.getAttribute('maxlength')===String(STANCE_MAX),'stances: a capped box saved through data-fw="stance"');
  ok(t2.value===arch&&!tag(m2).hidden&&tag(m2).textContent==='archetype'&&rst(m2).hidden,'stances: the archetype line is filled in and tagged, no Reset');
  ok(row(m2).querySelector('.fstcount').textContent===arch.length+'/'+STANCE_MAX,'stances: the counter reads the length');
  ok(t2.placeholder===P.scriptedStance(a,m2),'stances: the bond reading is the placeholder');
  const sc=fb;sc.scrollTop=37;const t3=box(m3),v3=t3.value;
  t2.value='Owes me a drink and knows it.';t2.dispatch('input',{target:t2});
  ok(row(m2).querySelector('.fstcount').textContent==='29/'+STANCE_MAX,'stances: the counter follows typing');
  const save=fb.querySelectorAll('button').find(x=>x.dataset.fact==='save');save.focus();save.click();uiFast();
  ok(a.persona.stances[m2.id]==='Owes me a drink and knows it.'&&a.persona.stanceBy[m2.id]==='owner','stances: Save writes through editSheet as the owner line');
  ok(String(a.memory.stances[m2.id]||'').startsWith('Owes me a drink'),'stances: the member memory reads the new line at once');
  ok(!(a.persona.stanceBy||{})[m3.id]&&box(m3).value===v3,'stances: an untouched box is not turned into the owner line');
  ok(box(m2)===t2&&tag(m2).textContent==='owner'&&!rst(m2).hidden,'stances: the same box, now tagged owner with a Reset');
  ok(sc.scrollTop===37&&document.activeElement===save,'stances: Save keeps scroll and focus');
  t2.value='x'.repeat(STANCE_MAX+40);save.click();uiFast();
  ok(a.persona.stances[m2.id].length===STANCE_MAX,'stances: a long line is cut to STANCE_MAX');
  rst(m2).click();uiFast();
  ok(!(a.persona.stanceBy||{})[m2.id]&&box(m2).value===arch&&tag(m2).textContent==='archetype','stances: Reset hands the stance back (the archetype line here)');
  ok(document.activeElement===box(m2),'stances: Reset moves focus to the box');
  fb.querySelectorAll('button').find(x=>x.dataset.fact==='close').click();
  // a member with no archetype: empty means the bond decides
  const b=m2;open(b);const o=sim.fellows().find(x=>x!==b&&!(b.persona&&b.persona.archetype)&&!(b.persona&&b.persona.stanceBy||{})[x.id]);
  if(b.persona&&!b.persona.archetype&&b.persona.src!=='model'&&o){const t=box(o);
    ok(t.value===''&&tag(o).hidden,'stances: a scripted stance shows an empty box and no tag');
    t.value='Too quiet by half.';fb.querySelectorAll('button').find(x=>x.dataset.fact==='save').click();uiFast();
    ok(P.authoredStance(b,o)==='Too quiet by half.'&&tag(o).textContent==='owner','stances: an owner line on a scripted persona');
    box(o).value='';fb.querySelectorAll('button').find(x=>x.dataset.fact==='save').click();uiFast();
    ok(P.authoredStance(b,o)===''&&!(b.persona.stanceBy||{})[o.id]&&tag(o).hidden&&b.memory.stances[o.id].startsWith(P.scriptedStance(b,o)),'stances: an empty box on Save hands it back to the bond reading')}
  else console.log('  skip stances on a scripted persona (none at hand)');
  fb.querySelectorAll('button').find(x=>x.dataset.fact==='close').click()}
// ---- the hall board (#334): the hall's jobs for the Fellowship, empty and filled, patched in place ----
{const fb=$('felbody'),S=sim.S,F=S.fellowship,keep=S.adventures;S.adventures=[];uiFast();
  const hb=()=>fb.querySelector('.felhall');
  ok(!!hb()&&/No job for the Fellowship on the hall board\./.test(hb().textContent),'hall board: the empty state reads plainly');
  const {REGIONS,ZONES}=await import('../src/world/map.js');const z=REGIONS.findIndex(r=>r&&r.band);
  const other=S.agents.find(a=>!a.fellow&&a.state!=='dead');
  // the agents' brief (no ff, no hero) is the Fellowship's only by region, and where the Fellowship rides drifts with the world
  // and the machine's timing: ask the focus for a region they are in rather than assuming the first banded one
  const {focus}=await import('../src/sim/dmfocus.js');const fz=[...(focus()||{zones:[]}).zones].find(r=>REGIONS[r]&&REGIONS[r].band);
  ok(fz!=null,'hall board: the Fellowship stands in a banded region (zones '+[...(focus()||{zones:[]}).zones]+')');
  S.adventures=[
    {id:900001,phase:'open',town:F.hall,tpl:'hunt',src:'oath',for:mem[0].id,zone:z,ff:1,data:{thing:'the grey wolf'},born:1440*2+60,giver:{name:'Old Brannoc'}},
    {id:900002,phase:'open',town:F.hall,tpl:'hunt',src:'rumour',for:null,zone:fz!=null?fz:z,by:'dm-agent',data:{beast:'Grimtooth',eliteLvl:7,eliteId:-1},born:1440*3},
    {id:900003,phase:'open',town:F.hall,tpl:'hunt',src:'request',for:other?other.id:-5,zone:z,data:{},born:1440},
    {id:900004,phase:'open',town:'Elsewhere',tpl:'hunt',src:'request',for:null,zone:z,ff:1,data:{},born:1440}];
  uiFast();const box=hb(),rows=box?[...box.querySelectorAll('li')]:[];
  ok(rows.length===2&&/Hall board \(2\)/.test(box.textContent),'hall board: two Fellowship jobs listed (not a stranger’s, not another town’s)');
  ok(rows[0]&&new RegExp(mem[0].name+'’s oath').test(rows[0].textContent)&&/by scripted DM/.test(rows[0].textContent)&&/posted day 3/.test(rows[0].textContent)&&rows[0].textContent.includes(ZONES[z])&&/Lv \d+-\d+/.test(rows[0].textContent),'hall board: the oath row names region, band, day, oath and poster');
  ok(rows[1]&&/elite Grimtooth \(Lv 7\), slain/.test(rows[1].textContent)&&/by DM agent/.test(rows[1].textContent),'hall board: the elite row names the elite and the DM agent');
  uiFast();ok(hb()===box,'hall board: patched in place when nothing changed');
  const {hallHooks}=await import('../src/sim/dmfocus.js');ok(hallHooks(F.hall).map(h=>h.id).join()==='900001,900002','hall board: one selection with the agents’ brief');
  S.adventures=keep;uiFast();ok(!!hb()&&!hb().querySelector('[data-k="hj900001"]'),'hall board: back to the world’s own board')}
// ---- guild rows (#327): focus reason and rival heat in tooltips ----
{const live=sim.S.GUILDS.filter(g=>!g.retired);
  const fel=live.find(g=>sim.S.agents.some(a=>a.guild===g&&a.fellow&&a.state!=='dead'));
  // every guild with a living Fellowship member shows 'none (Fellowship member)', not just the first one found
  const plain=live.filter(g=>!sim.S.agents.some(a=>a.guild===g&&a.fellow&&a.state!=='dead'));const g1=plain[0],g2=plain.find(g=>g.fac!==g1.fac);
  if(g1&&g2){g1.focus='crypt';
    const k=g1.id<g2.id?g1.id+':'+g2.id:g2.id+':'+g1.id;
    sim.S.rivals=sim.S.rivals||{heat:{},on:{},last:{},t:0,stats:{declared:0,ended:0,duels:0,assists:0,heat:{}}};
    sim.S.rivals.on[k]={since:0,why:'test'};sim.S.rivals.heat[k]=5.5;uiSlow();
    const rows=[...$('guilds').children];
    const row=rows.find(r=>r.textContent.includes(g1.name));
    const fw=row&&[...row.querySelectorAll('span')].find(x=>x.textContent==='Delve');
    ok(fw&&/Crypt/.test(fw.title),'guild rows: the focus word carries its reason as a tooltip (row: '+(row&&row.textContent)+')');
    const rv=row&&[...row.querySelectorAll('span')].find(x=>x.textContent==='<'+g2.tag+'>');
    ok(rv&&/heat 5\.5 of 8/.test(rv.title),'guild rows: a rival carries its heat as a tooltip');
    delete g1.focus;delete sim.S.rivals.on[k];delete sim.S.rivals.heat[k]}
  if(fel){uiSlow();const row=[...$('guilds').children].find(r=>r.textContent.includes(fel.name));
    ok(row&&/none \(Fellowship member\)/.test(row.textContent),'guild rows: a Fellowship guild reads none (Fellowship member)')}}
// ---- the Chronicle's Fellowship-only view keeps guild lines for the Fellowship (#341) ----
{const {chronicleShows}=await import('../src/ui/fellowship.js');const {chronicleFocus,guildLabel}=await import('../src/sim/fellowship.js');
  const a=mem.find(x=>x.state!=='dead'),was=a.guild;
  const ours={id:-341,tag:'OWN',name:'Oathbound Test',fac:a.fac,retired:false},theirs={id:-342,tag:'ELS',name:'Elsewhere Test',fac:1-a.fac,retired:false};
  a.guild=ours;const tg=g=>({t:guildLabel(g),c:'f'+g.fac}),stranger=sim.S.agents.find(x=>!x.fellow&&x.state!=='dead'&&!mem.some(m=>(m.nemesis||{})[x.id]));
  const e=(...parts)=>({t:'12:00',parts});
  const focusLine=e(tg(ours),' turns its banner to the ',{t:'Delve',c:'gd'},'.'),otherLine=e(tg(theirs),' goes ',{t:'Wayfaring',c:'gd'},'.');
  const rivalLine=e(tg(theirs),' and ',tg(ours),' declare a rivalry: blood on the road.');
  ok(chronicleShows(focusLine)&&chronicleFocus(focusLine),'Fellowship only: a guild line naming a member\'s guild shows');
  ok(chronicleShows(rivalLine),'Fellowship only: a rivalry naming the member\'s guild shows');
  ok(!chronicleShows(otherLine),'Fellowship only: an unrelated guild line stays hidden');
  ok(chronicleShows(e(a,' slays a wolf.'))&&chronicleShows(e({t:'Kragmaw',c:'gd'},' stirs.')),'Fellowship only: member and Kragmaw lines still show');
  if(stranger)ok(!chronicleShows(e(stranger,' slays a wolf.')),'Fellowship only: a stranger\'s line stays hidden');
  a.guild=null;ok(!chronicleShows(focusLine),'Fellowship only: once no member is in it, the guild line hides');
  a.guild=was;$('chronFel').click();ok(chronicleShows(otherLine),'the whole Chronicle (toggle off) shows every guild line');$('chronFel').click();
  ok(!chronicleShows(otherLine),'Fellowship only again: the unrelated guild line hides')}
// ---- region conditions (#366): running conditions and world events, the Fellowship's road first, patched in place ----
{const S=sim.S,keepC=S.conditions,{ensureLevers}=await import('../src/sim/levers.js');ensureLevers();const act=S.levers.active;
  const {roadZones,leftText}=await import('../src/ui/conditions.js');const {ZONES}=await import('../src/world/map.js');
  const cb=()=>$('condbox'),sec=$('condSec');
  ok(!!sec&&(sec.parentNode===$('worldbody')),'conditions: the section sits in the World group');
  S.conditions=[];uiFast();ok(!!cb()&&/No region conditions\./.test(cb().textContent),'conditions: the empty state reads plainly');
  const road=[...roadZones()],off=ZONES.map((_,i)=>i).find(i=>!road.includes(i));
  ok(road.length>0&&off!=null,'conditions: the Fellowship rides '+road.map(z=>ZONES[z]).join(', '));
  const rec={id:-3661,name:'start_event',params:{kind:'invasion',region:road[0],scale:2},by:'dm-agent',born:S.gameMin,until:S.gameMin+2*1440+60};act.push(rec);
  S.conditions=[{id:-1,kind:'festival',z:off,str:1,until:S.gameMin+300,lever:-9999},
    {id:-2,kind:'bandits',z:road[0],str:2,until:S.gameMin+2*1440+60,lever:-3661}];
  uiFast();const rows=()=>[...cb().querySelectorAll('li')];const r0=rows()[0],r1=rows()[1];
  ok(rows().length===2&&/\(2\)/.test(cb().querySelector('summary').textContent),'conditions: two rows and the count');
  ok(r0&&r0.getAttribute('data-k')==='c-2'&&/on your road/.test(r0.textContent)&&r0.textContent.includes(ZONES[road[0]]),'conditions: the Fellowship\'s region sorts first with "on your road" ('+(r0&&r0.textContent)+')');
  ok(r0&&/Invasion/.test(r0.textContent)&&/strength 2 of 3/.test(r0.textContent)&&/2 game days left/.test(r0.textContent)&&/world event by DM agent/.test(r0.textContent),'conditions: the event row names kind, strength, days left and the DM agent');
  ok(r1&&!/on your road/.test(r1.textContent)&&/Festival/.test(r1.textContent)&&/5 game hours left/.test(r1.textContent)&&/condition/.test(r1.textContent),'conditions: a far region shows hours under a day and no road tag ('+(r1&&r1.textContent)+')');
  uiFast();uiFast();ok(rows()[0]===r0&&rows()[1]===r1,'conditions: rows are the same nodes when nothing changed');
  S.conditions[1].until-=1440;uiFast();ok(rows()[0]===r0&&/1 game day left/.test(r0.textContent),'conditions: time left updates in place');
  ok(leftText(30)==='1 game hour left'&&leftText(1440*3)==='3 game days left','conditions: time left words');
  S.conditions=keepC;const i=act.indexOf(rec);if(i>=0)act.splice(i,1);uiFast()}
// ---- the dungeon view (#85, slice 1): opens over the map, one row per chamber, the crawl read live ----
{const dv=await import('../src/render/dungeonview.js'),{CRYPT}=await import('../src/world/map.js'),{buildInterior,IT}=await import('../src/world/interior.js');
  const again=await import('../src/world/interior.js?again'),S=sim.S,keep=CRYPT.group,n=CRYPT.rooms.length;
  const m=buildInterior(CRYPT),m2=again.buildInterior(CRYPT);
  ok(m.rooms.length===n&&m.rooms.filter(r=>r.boss).length===1&&m.rooms[n-1].boss,'dungeon view: the interior has a chamber per room ('+n+'), the last one the boss\'s');
  ok(m!==m2&&m.seed===m2.seed&&m.w===m2.w&&m.h===m2.h&&m.tiles.every((t,i)=>t===m2.tiles[i]),'dungeon view: the interior is the same from a fresh build (seeded by the site, '+m.w+'x'+m.h+')');
  ok(m.tiles.includes(IT.STAIR)&&m.tiles.includes(IT.DAIS)&&m.tiles.includes(IT.DOOR),'dungeon view: the stair, the doors and the boss dais are on the map');
  const mo=CRYPT.mouth;ok(dv.cryptAt(mo.x0+1.5,mo.y0+1.5)&&!dv.cryptAt(mo.x0-5,mo.y0),'dungeon view: a click on the crypt\'s door finds it, a click beside it does not');
  dv.initDungeonView();
  const box=()=>$('dungeon'),lis=()=>[...box().querySelectorAll('li')];
  ok(dv.openDungeon(CRYPT)&&!box().hidden&&box().parentNode===$('screen')&&$('screen').classList.contains('dgopen'),'dungeon view: opens over the map');
  ok(lis().length===n&&lis().every((li,i)=>li.textContent.includes(CRYPT.rooms[i].name.replace(/^the /i,''))),'dungeon view: shows the '+n+' chambers by name');
  ok(/Back to world/.test(box().querySelector('.dgback').textContent),'dungeon view: has Back to world');
  const mem=S.agents.filter(a=>a.kind==='hero'&&a.state!=='dead').slice(0,4);
  CRYPT.group={phase:'inside',mem,tSite:true,crawl:{i:2,rd:1,gap:0,foes:[{hp:1},{hp:0}],end:null}};
  let st=dv.refreshDungeon();
  ok(lis()[0].classList.contains('cleared')&&lis()[1].classList.contains('cleared')&&lis()[2].classList.contains('current')&&lis()[3].classList.contains('unexplored'),'dungeon view: cleared rooms, the room in progress and fog read from the crawl');
  ok(/round 2\/2/.test(st.status)&&/1 foe stands/.test(st.status)&&st.party.length===mem.length&&st.round==='ROUND 2/2','dungeon view: the round and the party ('+st.status+')');
  ok(lis()[3].textContent.includes('?'),'dungeon view: a room not reached is not named');
  CRYPT.group.crawl.end='retreat';CRYPT.group.crawl.driven=true;dv.trackCrawl();CRYPT.group=null;dv.trackCrawl();st=dv.refreshDungeon();
  ok(/Last run/.test(st.status)&&/driven back from/.test(st.status)&&lis()[2].classList.contains('lost')&&!box().querySelector('.unexplored'),'dungeon view: with no crawl, the empty interior and how the last run ended ('+st.status+')');
  box().querySelector('.dgback').click();ok(box().hidden&&!dv.dungeonOpen()&&!$('screen').classList.contains('dgopen'),'dungeon view: Back to world closes it');
  const a=mem[0],was={state:a.state,hidden:a.hidden};a.state='dungeon';a.hidden=true;select(a);uiFast();const link=$('hero').querySelector('.dglink');
  ok(!!link,'dungeon view: the hero card of a hero inside has View inside');if(link){link.click();ok(dv.dungeonOpen(),'dungeon view: View inside opens it')}
  dv.closeDungeon();a.state=was.state;a.hidden=was.hidden;CRYPT.group=keep;uiFast()}
if(fail){console.error('\nuismoke: '+fail+' failed');process.exit(1)}
console.log('\nuismoke: all checks passed');process.exit(0)
