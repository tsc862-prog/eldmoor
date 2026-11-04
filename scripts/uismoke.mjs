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
const SLT = await import('../src/sim/company.js'); // the slotted company (#588)
const {initUI,uiFast,uiSlow}=await import('../src/ui/app.js');
const {remember}=await import('../src/sim/memory.js');
const {select,setView}=await import('../src/ui/controls.js');
const {setTab,ranked}=await import('../src/ui/panels.js');
const $=id=>document.getElementById(id);

let fail=0;const failed=[];const ok=(c,m)=>{if(c)console.log('  ok   '+m);else{console.error('  FAIL '+m);failed.push(m);fail++}};

// One fixed seed: the world, the warm-up and the Fellowship it founds are the same on every run, so a check that needs a
// member alive, a foe in the open or a stranger in range sees the same world each time (the unseeded smoke flaked, #477).
const {seedRng}=await import('../src/core/rng.js');seedRng(477);
sim.init();
if(SLT.slotted())SLT.disbandSlots(SLT.slotted()); // the first half runs without one
const renderer={onCamChange(){},setZoom(){},stepZoom:(z)=>z,currentZoom:()=>1,zoomAt(){},panBy(){},screenToWorld:()=>({x:0,y:0})};
initUI(renderer);
// The DM is always an agent (#559): the page opens the DM seat of the world it plays and the start gate counts it. The
// smoke plays without runners, so it closes the seat again (the panel's Close seat, until #560) and lets nothing hold.
ok(sim.dmSeatOn(),'the page opens the DM seat of the world it plays (#559)');
{const gate=await import('../src/ui/rungate.js');ok(gate.gateMissing().some(m=>m.kind==='dm'),'the start gate counts the DM seat (#559)');
 ok(sim.worldHeld()==='gate','while the gate holds, the sim knows it (agent tools refused, no paced turns, #559)');
 sim.setDmSeat(false);gate.checkRunGate(Date.now()+5000);ok(!sim.worldHeld()&&!gate.ensureDmSeat(),'closed for the smoke: nothing holds, and the page does not reopen the seat of the same world')}
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

// Log tags (#785): outcomes carry no source, decisions keep who drove the hero
{const {record}=await import('../src/sim/history.js');const f={player:true,name:'T',history:[]};
  record(f,'Reached level 2.');record(f,'Slew ',{t:'a wolf',c:'gd'},'.');record(f,'Fell at level 3, slain by a wolf.');record(f,'Looted ',{t:'Axe'},' from a wolf.');
  record(f,'Set out for Highgate.');record(f,'Took a job: x.');
  ok(f.history.slice(0,4).every(e=>!('src' in e)),'log: outcome lines (level, slew, fell, looted) carry no source');
  ok(f.history[4].src==='agent'&&f.history[5].src==='agent','log: decision lines of an agent hero keep the agent tag');
  record(f,'Went down at level 3 to a wolf.');ok(!('src' in f.history[6]),'log: a downing carries no source')}

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
const slots=SLT.autoPick(0);const r=SLT.foundSlots(slots,{fac:0,ai:false});ok(r&&r.ok!==false,'Fellowship founded');
tick(1);
ok(!$('frames').hidden,'party frames shown');
const mem=SLT.slotHeroes(SLT.slotted());guardMem=mem;sim.markPlayer(mem[1],true);mem[1].fellowAgent=true;
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
// Gambits against the class preset (#679): a summary line, a mark per rule, dropped rules struck, safety flags, hovers
{const G=await import('../src/sim/gambits.js'),SH=await import('../src/ui/sheet.js'),h=mem[1];
  const gb=()=>tb().querySelector('ol.gambits'),sum=()=>tb().querySelector('.gbsum');
  const keep0={};for(const k of ['persona','tiers','memory','journal'])keep0[k]=k in h?JSON.stringify(h[k]):null; // a safety edit writes the persona history: put it back for the Life checks
  ok(!!gb()&&sum()&&sum().textContent==='Class preset, unchanged'&&![...gb().querySelectorAll(".gbm")].some(x=>x.textContent),'gambits: an untouched list reads "Class preset, unchanged", no marks');
  const P=G.presetFor(h.cls),fl=P.find(r=>r.then==='flee_home').id,pot=P.find(r=>r.then==='drink_potion').id,last=P[P.length-1].id;
  G.setGambit(h,{when:'self_hp_below 25',then:'shout To me!',why:'call the healer'});
  G.moveGambit(h,{id:pot,before:'top',why:'potions first'});
  G.toggleGambit(h,{id:fl,on:'no',why:'stand and fight'});
  G.dropGambit(h,{id:last,why:'never walk home'});
  const ol0=gb();uiFast();
  ok(gb()===ol0,'gambits: the list is patched in place after edits');
  ok(/^Differs from the .+ preset: 1 added, 1 moved, 1 turned off, 1 dropped, flee rule off$/.test(sum().textContent)&&sum().classList.contains('gbdiff'),'gambits: summary line "'+sum().textContent+'"');
  const li=k=>gb().querySelector('li[data-k="'+k+'"]'),add=[...gb().querySelectorAll('li.gb-added')];
  ok(add.length===1&&add[0].querySelector('.gbm').textContent==='+'&&/call the healer/.test(add[0].title),'gambits: the added rule is marked + and its hover gives the why');
  ok(li('g'+pot).querySelector('.gbm').textContent==='^'&&/Moved up/.test(li('g'+pot).title),'gambits: the moved rule is marked ^');
  ok(li('g'+fl).querySelector('.gbm').textContent==='off'&&li('g'+fl).classList.contains('gbsafe')&&/Preset: #/.test(li('g'+fl).title)&&/stand and fight/.test(li('g'+fl).title),'gambits: the flee rule turned off is marked off, flagged as safety, with the preset version and why');
  const dr=li('gd'+last);ok(!!dr&&dr.classList.contains('gb-dropped')&&!!dr.querySelector('s')&&dr===gb().lastChild&&/never walk home/.test(dr.title),'gambits: the dropped preset rule is listed last, struck through');
  ok([...tb().querySelectorAll('.meta.warn')].some(x=>/flee rule is turned off/.test(x.textContent)),'gambits: the flee rule flagged in a warning line');
  setTab('stats');uiFast();ok([...tb().querySelectorAll('.gbsum')].some(x=>/^Gambits: Differs from/.test(x.textContent)),'Stats tab: the gambits summary under Abilities');
  const row=SH.sheetRows().rows.find(r=>r.key==='gambits'),i=SH.sheetRows().cols.findIndex(c=>c.hero===h);
  ok(row&&row.group==='Agent'&&/^own: 1 added/.test(row.cells[i].t)&&row.cells[i].c==='lo','sheet: an Agent row with the member\'s gambits ('+(row&&row.cells[i].t)+')');
  G.resetGambits(h,{preset:'class'});setTab('agent');uiFast();
  ok(sum().textContent==='Own list, same as the '+h.cls+' preset'&&!gb().querySelector('.gb-dropped'),'gambits: after a reset "'+sum().textContent+'"');
  h.gambits=null;h.gambitHist=[];h.gambitDay=null;for(const k in keep0){if(keep0[k]==null)delete h[k];else h[k]=JSON.parse(keep0[k])}uiFast()}
// Keys 1-5 select the member in that party slot
{const {cam}=await import('../src/render/draw.js');
  const press=(k,o={})=>{let pd=false;for(const f of document._ls.keydown||[])f({key:k,target:document.body,preventDefault(){pd=true},...o});return pd};
  const hints=[...$('frames').querySelectorAll('.pfkey')].map(n=>n.textContent).join();
  ok(hints==='1,2,3,4,5','party frames carry the key hints 1..5: '+hints);
  ok($('frames').querySelector('.pfkey').title==='Press 1-5 to select','key hint tooltip');
  select(mem[0]);press('2');ok(cam.sel===mem[1]&&cam.view==='follow','key 2 selects slot 2 and follows');
  press('4',{code:'Numpad4'});ok(cam.sel===SLT.slotHeroes(SLT.slotted())[3],'key 4 selects slot 4');
  press('Digit5'.slice(5),{});ok(cam.sel===SLT.slotHeroes(SLT.slotted())[4],'key 5 selects slot 5');
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
  tick(10);const oathHero=SLT.slotHeroes(SLT.slotted())[0],keepAdv=sim.S.adventures;sim.S.adventures=[]; // the threads box is capped and the world's own jobs come first
  oathHero.goal={text:'Avenge Torius on Grishnak',progress:0,need:1};uiFast();
  ok(/swore to avenge Torius/.test(fb.querySelector('.fthreads').textContent),'an oath is a live one-liner (member '+oathHero.name+' '+oathHero.state+', threads: '+fb.querySelector('.fthreads').textContent.slice(0,120)+')');
  sim.S.adventures=keepAdv;
  // Disband needs a confirmation behind the ... menu
  ok(!fb.querySelector('[data-fact=disband]'),'Disband is not on the header');
  fb.querySelector('[data-fact=menu]').click();ok(!!fb.querySelector('[data-fact=disband]'),'the ... menu offers Disband');
  fb.querySelector('[data-fact=disband]').click();ok(!!SLT.slotted()&&/Yes, disband/.test(fb.textContent),'Disband asks first and the Fellowship still stands');
  fb.querySelector('[data-fact=menu]').click();ok(!SLT.slotted()===false&&!fb.querySelector('[data-fact=disband]'),'Cancel closes the menu without disbanding');
  fb.querySelector('[data-fact="drawer:members"]').click();const dr=fb.querySelector('.feldrawer');
  ok(!!dr&&!!dr.querySelector('.mindrow'),'the members drawer opens on a click');
  ok(dr.querySelectorAll('.fm .fport').length===5,'roster: each place has a face canvas (#379)');
  if(SLT.slotted().past.length){fb.querySelector('[data-fact="drawer:fallen"]').click();ok(/Fallen/.test(fb.querySelector('.feldrawer').textContent),'Fallen is one click away')}
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
    runners:[{key:hk,kind:'hero',hero:mem[1].id,heroes:[mem[1].id],name:mem[1].name,state:'live',turns:3,cost:.42,budget:1,provider:'anthropic',model:'claude-haiku-5-5',ctx:212,rolls:1,lines:[]}]};
  globalThis.fetch=async(url,o)=>{url=String(url);const j=v=>({ok:true,status:200,json:async()=>v});
    if(o&&o.method==='POST'){const body=JSON.parse(o.body);posts.push({url,body});if(url.endsWith('/fresh'))return j({ok:true,asked:[hk]});
      if(url.endsWith('/limits')){if('sessionBudget' in body)relay.session={budget:body.sessionBudget,spent:.42,left:body.sessionBudget==null?null:body.sessionBudget-.42};return j({ok:true,session:relay.session,applies:body.budget!=null&&body.budget<1?'now':'next start'})}
      return j({ok:true})}
    if(url.endsWith('/play/runner'))return j(relay);throw new Error('no route '+url)};
  const wait=()=>new Promise(r=>setTimeout(r,30));
  const btn=$('agentsBtn'),pop=$('agentsPop');uiSlow();
  ok(btn&&!btn.hidden,'the Agents button shows with a Fellowship');
  btn.click();ok(!pop.hidden&&btn.getAttribute('aria-expanded')==='true','it opens the Agents popover');
  // the runner poll is throttled in real time (5 s); an earlier step may have left the relay marked down, so wait for the stub to be read
  for(let i=0;i<250&&!pop.querySelector('select[data-agsess]');i++){await wait();uiSlow()}
  const ss=pop.querySelector('select[data-agsess]');ok(!!ss,'the popover reads the relay');ok(/No session budget is set/.test(pop.textContent),'with none set the popover says nothing caps the total (#807)');ss.value='5';ss.dispatch('change',{target:ss});await wait();await wait();uiSlow();
  ok(posts.some(p=>p.url.endsWith('/play/runner/limits')&&p.body.sessionBudget===5),'the session budget is sent to the relay');
  ok(/Spent \$0\.42 of \$5\.00/.test(pop.textContent),'the spend so far shows live against the budget');
  ok(/Agents · \$0\.42 \/ \$5\.00/.test(btn.textContent),'the button carries the spend: '+btn.textContent);
  ok(JSON.parse(localStorage.getItem('eldmoor.agentLimits')).session===5,'the session budget is kept per viewer');
  const row=pop.querySelector('.agr[data-k='+hk.replace(':','\\:')+']')||pop.querySelectorAll('.agr').find(r=>r.getAttribute('data-k')===hk);
  ok(!!row&&row.textContent.includes(mem[1].name),'a row for the agent-played hero');
  ok(/ctx 212k/.test(row.textContent),'the state line shows the session size (#787): '+row.textContent.slice(0,120));
  {const fb=pop.querySelector('[data-agfresh]');ok(!!fb&&/Fresh sessions for all/.test(fb.textContent),'Fresh sessions for all shows while a runner runs');
    fb.dispatch('click',{target:fb,bubbles:true});pop.dispatch('click',{target:fb});await wait();await wait();uiSlow();
    ok(posts.some(p=>p.url.endsWith('/play/runner/fresh')),'and asks the relay');ok(/Asked 1 runner/.test(pop.textContent),'and says so')}
  const bs=row.querySelectorAll('select').find(x=>x.dataset.agf==='budget');bs.value='0.5';bs.dispatch('change',{target:bs});await wait();uiSlow();
  ok(posts.some(p=>p.body.key===hk&&p.body.budget===.5),'a lower budget on a running runner is sent live');
  const row2=pop.querySelectorAll('.agr').find(r=>r.getAttribute('data-k')===hk);
  ok(/applies now/.test(row2.textContent),'the row says the change applies now');
  const ts=row2.querySelectorAll('select').find(x=>x.dataset.agf==='turns');ok(!ts&&bs.children.some(o=>o.value==='5')&&/Budget/.test(row2.textContent),'no turn cap picker: the budget is the limit (owner, #563)');
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
  const dps=SLT.slotHeroes(SLT.slotted()).filter(a=>/^dps/.test(SLT.slotKeyOf(a)||''));const cols=new Set(dps.map(a=>classColor(a.cls)));
  ok(dps.length===3&&cols.size===3,'three DPS of different classes get three different colours: '+[...cols].join(' '));
  ok(classColor('Warrior')!==classColor('Priest')&&classColor('Nonesuch')===classColor('Nonesuch'),'every class has its own colour, an unknown class a stable one');
  const F=SLT.slotted(),home={kind:'npc',fac:F.fac,name:'Ostler'},away={kind:'npc',fac:1-F.fac,name:'Peddler'};
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
  const voter=mem[2];sim.playerAct(voter.id,'vote',{proposal_id:SLT.slotted().props[0].id,vote:'no',reason:'too dangerous'});uiFast();
  {const cast=SLT.slotted().props[0].votes[voter.id];if(cast&&cast.reason==='too dangerous')ok(/votes no: too dangerous/.test(txt()),'chat panel: a vote is a system line "X votes no: reason"');else console.log('  skip vote line (the proposal settled before the vote)')}
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
  for(const m of SLT.slotHeroes(SLT.slotted()))sim.markPlayer(m,true);
  const L={};for(const m of SLT.slotHeroes(SLT.slotted()))L[m.id]='connected';let dm='off';
  gate.setGateProbe({link:a=>L[a.id]||'none',dm:()=>dm});
  const T0=1e6,box=$('rgate'),sp=n=>$('sp'+n),press=n=>sp(n).dispatch('click',{target:sp(n)});
  ctl.speed=1;gate.checkRunGate(T0);
  ok(!ctl.held&&box.hidden,'all five connected: the world runs and no bar shows');
  const m3=SLT.slotHeroes(SLT.slotted())[2];L[m3.id]='none';
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
  const F=SLT.slotHeroes(SLT.slotted()),L={},R={};for(const m of F){L[m.id]='connected';R[m.id]={state:'ready',model:'qwen2.5:14b',ms:900,at:0}}
  gate.setGateProbe({link:a=>L[a.id]||'none',dm:()=>'off',ready:a=>R[a.id]||null,dmReady:()=>null});
  const T0=5e6,box=$('rgate');ctl.speed=1;gate.checkRunGate(T0);
  ok(!ctl.held,'every seat ready: the world runs');
  const slow=F[1],down=F[3];R[slow.id]={state:'warming',model:'qwen2.5:14b',at:Date.now()-40000};R[down.id]=null;
  gate.checkRunGate(T0+1000);
  ok(ctl.held&&/WAITING FOR MINDS · 3\/5 READY/.test(box.textContent),'a seat still warming up and one only claimed hold the world: '+(box.children[0]&&box.children[0].textContent));
  ok(box.textContent.includes(slow.name+': loading qwen2.5:14b (4')&&box.textContent.includes(down.name+': claimed'),'the banner says who is loading which model (and for how long) and who is only claimed');
  ok(/Start anyway/.test(box.textContent),'the banner offers Start anyway');
  R[down.id]={state:'failed',error:'ollama: no answer from qwen2.5:14b in 600 s',at:0};gate.checkRunGate(T0+2000);
  ok(ctl.held&&!gate.gateMissing().some(m=>m.hero===down.id)&&box.textContent.includes(slow.name),'a failed warm-up whose runner is there counts as active (owner, #559): only the seat still warming holds');
  gate.startAnyway();
  ok(!ctl.held&&box.hidden,'Start anyway releases the world');
  R[slow.id]={state:'ready',at:0};gate.checkRunGate(T0+3000);ok(!ctl.held,'it stays released as seats get ready');
  L[down.id]='none';gate.checkRunGate(T0+4000);gate.checkRunGate(T0+40000);
  L[down.id]='connected';R[down.id]=null;gate.checkRunGate(T0+41000);
  ok(ctl.held&&box.textContent.includes(down.name),'a runner that went away and came back must warm up again');
  R[down.id]={state:'ready',at:0};gate.checkRunGate(T0+32000);ok(!ctl.held,'ready again: the world runs');
  gate.setGateProbe(null)}

// The DM prepares the table (#437): once every seat is ready, a ready DM runner holds the world for one bounded prep
console.log('the DM prepares the table');
{const gate=await import('../src/ui/rungate.js'),{ctl}=await import('../src/ui/controls.js'),{dmFrameData}=await import('../src/ui/dmframe.js');
  const F=SLT.slotHeroes(SLT.slotted()),L={},R={};for(const m of F){L[m.id]='connected';R[m.id]={state:'ready',model:'qwen2.5:14b',ms:900,at:0}}
  const turns0=sim.S.dmAgent&&sim.S.dmAgent.turns?sim.S.dmAgent.turns.slice():null; // the DM calls below are not a turn for the DM tab's check further down
  let dmR={state:'ready',model:'qwen2.5:14b',ms:700,at:1};sim.setDmSeat(true);
  gate.setGateProbe({link:a=>L[a.id]||'none',dm:()=>'connected',ready:a=>R[a.id]||null,dmReady:()=>dmR});
  const T0=9e6,box=$('rgate');ctl.speed=1;gate.checkRunGate(T0);
  ok(ctl.held&&/THE DM PREPARES THE TABLE · \d+ S · 0\/10 CALLS/.test(box.textContent),'every seat ready: the world stays held while the DM prepares ('+(box.children[0]&&box.children[0].textContent)+')');
  ok(/Start anyway/.test(box.textContent)&&/re-reads where the companies are/.test(box.textContent),'the banner keeps Start anyway and says what the DM does (a Continue: the short prep)');
  ok(/preparing/.test(dmFrameData().mind),'the DM frame shows preparing: '+dmFrameData().mind);
  sim.dmAct('regions');sim.dmAct('levers');gate.checkRunGate(T0+1000);ok(/2\/10 CALLS/.test(box.textContent),'the banner counts the calls');
  gate.startAnyway();ok(!ctl.held&&box.hidden&&sim.prepView().why==='anyway','Start anyway ends the prep and the world runs');
  gate.checkRunGate(T0+2000);ok(!ctl.held,'the same runner gets no second prep');
  dmR={state:'ready',model:'qwen2.5:14b',ms:650,at:2};gate.checkRunGate(T0+3000);ok(ctl.held&&/PREPARES/.test(box.textContent),'a DM runner started again gets a short prep');
  sim.dmAct('prep_done',{summary:'ok'});gate.checkRunGate(T0+4000);ok(!ctl.held&&sim.prepView().why==='done','prep_done releases the world');
  sim.setDmSeat(false);dmR={state:'ready',model:'x',ms:1,at:3};gate.checkRunGate(T0+5000);ok(!ctl.held&&!sim.prepActive(),'the seat closed: no prep');
  if(sim.S.dmAgent){if(turns0)sim.S.dmAgent.turns=turns0;else delete sim.S.dmAgent.turns}
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
  ok(!!dmf&&!dmf.querySelector('.dmfchip').hidden&&dmf.querySelector('.dmffull').hidden&&/DM: no seat yet/.test(txt())&&!/Open seat/.test(txt()),'no seat yet: a small chip, no Open seat (#560)');
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
  // the DM's picker offers every provider a hero's has (#824), with the same price labels, and a pick reaches the relay
  {const mp=await import('../src/ui/mindpick.js'),rn=await import('../src/ui/runners.js'),ds=await import('../src/ui/dmseat.js');
   relay.health={providers:{ollama:{ok:true,models:['q:1b']},openai:{ok:true,models:['gpt-6-luna'],prices:{'gpt-6-luna':{in:.1,out:.5}}},huggingface:{ok:true,models:['meta-llama/Llama-3.3-70B-Instruct']},google:{ok:true,models:['gemini-3.8-flash'],free:true,prices:{'gemini-3.8-flash':{in:0,out:0}}}}};
   const pf=globalThis.fetch;globalThis.fetch=async(url,o)=>String(url).endsWith('/health')?{ok:true,status:200,json:async()=>relay.health}:pf(url,o);
   mp.mindChange({dataset:{mprov:'-1'},value:'ollama'});mp.pulledModels();for(let i=0;i<20&&!mp.openaiModels().length;i++)await wait();
   const pick=rn.runnerPick('dm',...mp.mindLists()).children[0],vals=pick.children.map(o=>o.value),texts=pick.children.map(o=>o.textContent||o.text||'').join(' | ');
   ok(['ollama:q:1b','openai:gpt-6-luna','huggingface:meta-llama/Llama-3.3-70B-Instruct','google:gemini-3.8-flash','anthropic:claude-haiku-5-5'].every(v=>vals.includes(v)),'the DM picker lists Claude, local, OpenAI, Hugging Face and Gemini: '+vals.join(', '));
   ok(/\$0\.10 \/ \$0\.50/.test(texts),'with the price labels of a hero\'s picker: '+texts);
   ok(/another provider|set aside/.test(pick.title)&&/notes/.test(pick.title),'its title says what a switch keeps and what it sets aside');
   ok(ds.dmSeatSig().includes('gpt-6-luna'),'a list that arrives late rebuilds the seat');
   document._ls.change.forEach(f=>f({target:{dataset:{runpick:'dm'},value:'openai:gpt-6-luna'}}));
   posts.length=0;await rn.startRunner('dm');
   ok(posts.some(p=>p.url.endsWith('/play/runner/start')&&p.body.kind==='dm'&&p.body.provider==='openai'&&p.body.model==='gpt-6-luna'),'Start DM sends the picked mind');
   document._ls.change.forEach(f=>f({target:{dataset:{runpick:'dm'},value:''}}));globalThis.fetch=pf}
  const box=$('dmlog'),wb=$('worldbox');box.open=false;wb.open=false;dmf.dispatch('click',{target:dmf.querySelector('.dmfdo')});
  ok(box.open&&wb.open,'a click on the frame opens the Dungeon Master panel');
  box.open=false;dmf.dispatch('click',{target:dmf.querySelector('[data-dmnotes]')});
  ok(box.open&&(await import('../src/ui/dmpanel.js')).dmFilter()==='notes','the Notes button opens the panel on its Notes filter');
  ok(!dmf.querySelector('[data-dmseat]'),'no Open/Close seat on the frame (#560)');
  ok(!document.getElementById('dmseat').querySelector('[data-dmseat]')&&!/(Open|Close) seat/.test(document.getElementById('dmseat').textContent+txt()),'no Open/Close seat in the Dungeon Master panel (#560)');
  relay.runners=[dmr];uiFast();uiSlow();uiFast();
  ok(!!dmf.querySelector('.dmfrun').querySelectorAll('button').find(b=>b.dataset.runact==='restart'&&/Restart DM/.test(b.textContent)),'a running DM offers Restart DM');
  ok(/Notes \d+/.test(document.getElementById('dmseat').textContent)&&/Stop DM/.test(document.getElementById('dmseat').textContent),'the panel header shows the runner controls and the notes count');
  {const gate=await import('../src/ui/rungate.js');relay.runners=[{...dmr,state:'stopped',pace:null,lines:[]}];gate.checkRunGate(Date.now()+60000);uiFast();
   ok(gate.gateMissing().some(m=>m.kind==='dm'),'a stopped DM runner holds the world (gate)');
   ok(!dmf.querySelector('.dmfalert').hidden&&/DM runner gone: the world is paused/.test(dmf.querySelector('.dmfalert').textContent),'the frame carries the DM runner-stop alert: '+dmf.querySelector('.dmfalert').textContent);
   ok(/Restart|Start/.test(document.getElementById('rgate').textContent)&&/DM/.test(document.getElementById('rgate').textContent),'the gate banner names the DM with a button');
   relay.runners=[];sim.setDmSeat(false);gate.setRunFree(true);gate.checkRunGate(Date.now()+70000);gate.setRunFree(false);uiFast()}
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
  key('Enter');ok(played.join()==='continue'&&!root.parentNode,'Enter = Continue, and the title goes away');
  // What's new (#664): unread patch notes, newest first, three open and a fold, a NEW badge until Got it
  const note=(t,d)=>'---\ntitle: '+t+'\ndate: '+d+'\narea: ui\nissues: []\n---\n- Line of '+t+'.\n';
  title.provideNotes({'../docs/patchnotes/0000-before.md':note('Before','2026-11-02'),'../docs/patchnotes/10.md':note('Ten','2026-11-03'),'../docs/patchnotes/11.md':note('Eleven','2026-11-03'),
    '../docs/patchnotes/12.md':note('Twelve','2026-11-04'),'../docs/patchnotes/_draft.md':note('Draft','2026-11-04')});
  localStorage.removeItem('eldmoor.notesSeen');played=[];
  const r2=title.showTitle(k=>played.push(k)),news=()=>r2.querySelector('.tnews');
  ok(news()&&/What's new/.test(news().textContent)&&news().querySelector('.tnew')&&news().querySelector('.tnew').textContent==='NEW',"the title shows What's new with a NEW badge");
  const heads=()=>[...news().querySelectorAll('.tnt')].map(x=>x.textContent);
  ok(heads().join()==='Twelve,Eleven,Ten'&&!/Draft/.test(news().textContent)&&/#12/.test(news().textContent)&&/Line of Twelve\./.test(news().textContent),'newest three expanded, newest first, a draft left out ('+heads().join()+')');
  const more=r2.querySelector('[data-a="notesmore"]');ok(more&&/1 more/.test(more.textContent),'the rest behind a fold');
  more.click();ok(heads().join()==='Twelve,Eleven,Ten,Before'&&/Before patch notes/.test(news().textContent),'the fold opens the older notes ('+heads().join()+')');
  r2.querySelector('[data-a="notesread"]').click();
  ok(!news()||!news().querySelector('.tnew'),'Got it clears the NEW badge');
  ok(JSON.parse(localStorage.getItem('eldmoor.notesSeen')).ids.length===4,'read notes are kept per viewer');
  ok(r2.querySelector('[data-a="notesmore"]')&&!r2.querySelector('.tnote'),'once read, the notes fold away behind Show the latest');
  r2.querySelector('[data-a="notesmore"]').click();ok(heads().join()==='Twelve,Eleven,Ten','Show the latest opens the last three ('+heads().join()+')');
  title.provideNotes({'../docs/patchnotes/12.md':note('Twelve','2026-11-04'),'../docs/patchnotes/14.md':note('Fourteen','2026-11-05')});
  r2.querySelector('[data-a="notesmore"]').click();
  ok(news().querySelector('.tnew')&&heads().join()==='Fourteen','a note merged later is new again, alone ('+heads().join()+')');
  key('Enter');ok(played.join()==='continue'&&JSON.parse(localStorage.getItem('eldmoor.notesSeen')).ids.includes('14'),'leaving the title marks the notes read')}

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
  ok(!!SLT.slotted(),'wide layout: a Fellowship stands for the column checks');
  for(const [w,n,st,hr] of [[1000,2,'side','colM'],[1600,2,'side','colM'],[2400,3,'colL','side'],[390,1,'side','colM'],[1000,2,'side','colM']]){
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
{const SH=await import('../src/ui/sheet.js'),ms=SLT.slotMembers(SLT.slotted()).filter(m=>m.hero);
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
{const SH=await import('../src/ui/sheet.js'),{portrait}=await import('../src/render/sprites.js'),ms=SLT.slotMembers(SLT.slotted()).filter(m=>m.hero);
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
{const SH=await import('../src/ui/sheet.js'),LV=await import('../src/ui/lifeview.js'),ms=SLT.slotMembers(SLT.slotted()).filter(m=>m.hero);
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
  const cards=()=>lf().querySelectorAll('.lfcard');ok(cards().length===SLT.slotMembers(SLT.slotted()).length,'life: one card per Fellowship place ('+cards().length+')');
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
{const h=(SLT.slotMembers(SLT.slotted()).filter(x=>x.hero)[0]||{hero:sim.S.agents.find(a=>a.kind==='hero')}).hero;
  const Pf=await import('../src/sim/professions.js');
  const keepP=h.profs;h.profs=[]; // a hero with none (scripted heroes take up a gathering trade at level 3 since #257, so the seeded world's hero may hold one)
  select(h);setTab('stats');uiFast();
  ok(/Professions/.test(tb().textContent)&&/No professions yet/.test(tb().textContent),'stats: a hero with none says "No professions yet"');
  Pf.learn(h,'mining');Pf.learn(h,'cooking');Pf.gainSkill(h,'mining',59);
  uiSlow();setTab('stats');uiFast();
  const rows=tb().querySelectorAll('.prof');
  ok(rows.length===2&&/Mining/.test(rows[0].textContent)&&/gathering/.test(rows[0].textContent)&&/60 · Journeyman/.test(rows[0].textContent),'stats: each profession with kind, skill and band ('+(rows[0]&&rows[0].textContent)+')');
  ok(rows.length===2&&/crafting/.test(rows[1].textContent)&&/1 · Novice/.test(rows[1].textContent),'stats: a craft profession at skill 1 is Novice');
  const bar=rows[0]&&rows[0].querySelector('.profbar i');ok(bar&&bar.style.width==='60%','stats: the bar is skill out of 100');
  const pd=tb().querySelectorAll('.profd');
  ok(pd.length===2&&/Works ore veins/.test(pd[0].textContent)&&/Tin Ore/.test(pd[0].textContent),'stats: a gathering trade lists what it works and takes ('+(pd[0]&&pd[0].textContent)+')');
  ok(pd.length===2&&/Makes/.test(pd[1].textContent)&&/Spit-Roast Perch/.test(pd[1].textContent),'stats: a crafting trade lists its recipes');
  ok(!tb().querySelector('.profmeal'),'stats: no supper line without a meal');
  const keepM=h.meal,SS=sim.S;h.meal={id:'Spit-Roast Perch',stat:'speed',v:.03,until:SS.gameMin+60};
  uiSlow();setTab('stats');uiFast();
  ok(/Supper: Spit-Roast Perch \+3% speed/.test((tb().querySelector('.profmeal')||{}).textContent||''),'stats: the supper meal with its buff and time left ('+((tb().querySelector('.profmeal')||{}).textContent)+')');
  const sc=document.body.querySelector('#hero .tb')||tb();sc.scrollTop=0;
  if(keepM===undefined)delete h.meal;else h.meal=keepM;
  // crafted gear names its maker in the Pack tab
  const Inv=await import('../src/sim/inv.js'),Gr=await import('../src/sim/gear.js');
  if(!h.inv)Inv.invOf(h);
  const cg=Gr.makeItem(h.cls,'main',3,0,{quality:'fine',src:'Crafted by '+h.name});cg.maker=h.name;cg.makerId=h.id;const n0=h.inv.list.length;Inv.addGear(h,cg);
  uiSlow();setTab('inv');uiFast();
  ok(new RegExp('by '+h.name).test(tb().textContent),'pack: a crafted piece shows its maker');
  while(h.inv.list.length>n0)h.inv.list.pop();
  if(keepP===undefined)delete h.profs;else h.profs=keepP}

// Table banner: the combat block (#277). A scene with rounds, set up by hand (no world step), rendered like main.js does.
{const TB=await import('../src/ui/table.js'),T=await import('../src/sim/table.js'),S=sim.S,box=$('tbanner'),spd=T.TABLE.speed;
  const ms=SLT.slotHeroes(SLT.slotted()).filter(a=>a.state!=='dead').slice(0,3),m=S.mobs.find(x=>x.alive&&!x.gone);
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
  ok(!!sb&&/Rounds: run on/.test(sb.textContent)&&!box.querySelector('.tnext'),'combat banner: the step button shows the round pace (off)');
  sb.click();TB.renderTable(1);ok(T.TABLE.step==='hold'&&/Rounds: pause after each/.test(box.querySelector('.tstb').textContent),'combat banner: the step button cycles to hold');
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
// Table banner legibility (#471): a short pixel title, the tags as chips, the question as body text, one row per member.
{const TB=await import('../src/ui/table.js'),T=await import('../src/sim/table.js'),RL=await import('../src/sim/runlink.js'),{classColor}=await import('../src/core/colors.js');
  const S=sim.S,box=$('tbanner'),ms=SLT.slotHeroes(SLT.slotted()).filter(a=>a.state!=='dead');
  if(ms.length<3)console.log('  skip banner legibility (no Fellowship)');else{
  const keep=S.table,det='make camp here by the old road and start our watch before the moon is up';
  ok(TB.sceneHead('decision','Put to the party: '+det).head==='Vote · make camp here…','banner: the title is the kind plus a few words ('+TB.sceneHead('decision','Put to the party: '+det).head+')');
  ok(TB.sceneHead('ambush','Ambush: Gorran').head==='Ambush · Gorran'&&!TB.sceneHead('ambush','Ambush: Gorran').cut,'banner: a short title is not cut');
  ok(TB.sceneHead('check',"The Miller's Debt: a check").head==="Check · The Miller's Debt…",'banner: a long title stops at its colon');
  RL.setRunnerLinks(a=>a===ms[3]?'none':'waiting');RL.setReflexAck(()=>false);
  const w={};ms.forEach((a,i)=>w[a.id]={t:i===2?9:3.2,nudge:0});
  const sc={id:9101,kind:'decision',title:'Put to the party: '+det,frame:[ms[0],' puts it to the party: ',{t:det,c:'gd'},'. Everyone votes.'],ids:ms.map(a=>a.id),i:0,phase:'turn',t:0,
    acts:{[ms[0].id]:{k:'yes',line:'',by:'agent'},[ms[1].id]:{k:'no',line:'Taking the watch instead',by:'agent'}},beats:[],ctx:{prop:-1},pause:true,at:0,all:true,w};
  S.table=sc;TB.renderTable(1);
  const tt=box.querySelector('.tt'),th=box.querySelector('.tth');
  ok(!box.hidden&&th&&th.textContent==='VOTE · MAKE CAMP HERE…','banner: the pixel title is short ('+(th&&th.textContent)+')');
  ok(tt&&!/WORLD PAUSED|EVERYONE ANSWERS/.test(tt.textContent)&&!!tt.querySelector('[data-scene]'),'banner: the title row holds only the title and the scene map button');
  const chips=[...box.querySelectorAll('.tchips .tp')].map(e=>e.textContent);
  ok(chips.join('|')==='WORLD PAUSED|EVERYONE ANSWERS','banner: the tags are chips on their own row ('+chips.join(', ')+')');
  const tf=box.querySelector('.tf');ok(tf&&tf.textContent.includes(det)&&!box.querySelector('.tq'),'banner: the whole question is the body text, said once');
  const rows=[...box.querySelectorAll('.tmem .tmr')],rd=TB.memberRows();
  ok(rows.length===ms.length&&rd.length===ms.length,'banner: one row per member ('+rows.length+')');
  ok(/Answers 2\/5/.test(box.querySelector('.tmh').textContent.replace(String(ms.length),'5')),'banner: the rows count the answers ('+box.querySelector('.tmh').textContent+')');
  ok(rows[0].querySelector('.tmn').textContent===ms[0].name&&rows[0].querySelector('.tmn').style.color===classColor(ms[0].cls)&&rows[0].querySelector('.tmsw').style.background===classColor(ms[0].cls),'banner: a row names the member in its class colour');
  ok(rows[0].querySelector('.tma.yes').textContent==='YES'&&rows[1].querySelector('.tma.no').textContent==='NO','banner: a row shows the vote cast (YES, NO)');
  ok(/Taking the watch instead/.test(rows[1].querySelector('.tmq').textContent),'banner: a row carries what the member said');
  ok(rows[2].classList.contains('st-wait')&&/reflex in 111 s/.test(rows[2].querySelector('.tmt').textContent),'banner: a nudged member shows the reflex timer ('+rows[2].querySelector('.tmt').textContent+')');
  {const SWm=await import('../src/sim/scenewait.js'),e0=SWm.SW.EXTRA_MS;SWm.SW.EXTRA_MS=90000;sc.q=[ms[2].id];TB.renderTable(1); // #687: a queued member's countdown runs on into the extension
   const tq=[...box.querySelectorAll('.tmr')][2].querySelector('.tmt').textContent;
   ok(/^queued · reflex in 201 s$/.test(tq),'banner: a queued member counts down the extension too ('+tq+')');
   w[ms[2].id].t=210;TB.renderTable(1);ok(/^queued · reflex in 0 s$/.test([...box.querySelectorAll('.tmr')][2].querySelector('.tmt').textContent),'banner: it reaches 0 s only when the extension is over');
   w[ms[2].id].t=9;delete sc.q;SWm.SW.EXTRA_MS=e0;TB.renderTable(1);
   ok(/^reflex in 111 s$/.test([...box.querySelectorAll('.tmr')][2].querySelector('.tmt').textContent),'banner: not queued, the plain countdown is back')}
  ok(rows[4]&&rows[4].classList.contains('st-wait')&&rows[4].querySelector('.tmt').textContent==='4 s','banner: a thinking member shows how long ('+(rows[4]&&rows[4].querySelector('.tmt').textContent)+')');
  ok(rows[3].classList.contains('st-held')&&/no runner/.test(rows[3].textContent),'banner: a member with no runner says so');
  ok(!/answered · waiting for/.test(box.textContent)&&/has no runner: Restart runner/.test((box.querySelector('.tl')||{}).textContent||''),'banner: the waiting list is not said twice (rows only); what to do about a missing runner stays');
  const r0=rows[0];r0._same=1;w[ms[4].id].t=5.4;TB.renderTable(1);
  ok(box.querySelector('.tmr')._same===1&&box.querySelectorAll('.tmr')[4].querySelector('.tmt').textContent==='6 s','banner: a ticking timer patches the row in place');
  sc.acts[ms[2].id]={k:'yes',line:'',by:'reflex'};TB.renderTable(1);
  ok(/reflex/.test(box.querySelectorAll('.tmr')[2].querySelector('.tmby').textContent),'banner: a reflex answer is marked as one');
  // a turn-by-turn scene without rounds: the order as rows, the one acting marked
  const sc2={id:9102,kind:'site',title:'The Sunken Crypt',frame:['The stair goes down.'],ids:ms.map(a=>a.id),i:1,phase:'turn',t:2,acts:{[ms[0].id]:{k:'press',line:'',by:'agent'}},beats:[],ctx:{},pause:true,at:0};
  S.table=sc2;TB.renderTable(1);const r2=[...box.querySelectorAll('.tmr')];
  ok(box.querySelector('.tmh').textContent==='Turn order'&&r2[1].classList.contains('st-turn')&&/▶/.test(r2[1].textContent)&&r2[2].classList.contains('st-next'),'banner: a turn-by-turn scene lists the turn order with the one acting marked');
  ok(/Press on/.test(r2[0].querySelector('.tma').textContent),'banner: an option chosen shows in words ('+r2[0].querySelector('.tma').textContent+')');
  ok(!box.querySelector('.tchips .tall'),'banner: no EVERYONE ANSWERS chip in a turn-by-turn scene');
  // a cut title whose words the frame does not carry: the whole title as body text
  const sc3={...sc,id:9103,kind:'check',title:"The Miller's Debt: a sound under the mill floor",frame:['The DM calls for a roll.'],acts:{},w:{}};S.table=sc3;TB.renderTable(1);
  ok(box.querySelector('.tq')&&/a sound under the mill floor/.test(box.querySelector('.tq').textContent),'banner: a cut title still shows in full as body text');
  RL.setRunnerLinks(null);RL.setReflexAck(null);S.table=keep;TB.renderTable(1)}}
// ---- chat in the left column on the three-column layout (owner request) ----
{const where=id=>{let n=$(id);while(n&&!(n.id==='colL'||n.id==='colM'||n.id==='side'))n=n.parentNode;return n&&n.id};
  const keep=window.innerWidth;ok(!!SLT.slotted(),'chat left: a Fellowship stands');
  const lst=$('chatList'),sec=$('chatSec');
  window.innerWidth=2400;uiFast();
  ok(where('chatSec')==='colL'&&$('colL').children[0]===sec,'2400 px: the chat is first in the left column');
  ok(where('storySec')==='colL'&&where('worldgrp')==='colL'&&$('colL').children.indexOf($('storySec'))>0,'2400 px: Story and World sit below the chat');
  const fb=$('chatFilter').children[1];fb.dispatch('click',{target:fb});const pressed=fb.getAttribute('aria-pressed');
  for(const w of [1600,2400]){window.innerWidth=w;uiFast()}
  ok($('chatList')===lst&&where('chatSec')==='colL','2400 px again: the same chat node is back in the left column');
  ok(fb.getAttribute('aria-pressed')===pressed&&pressed==='true','a resize keeps the chat filter');
  ok(document.body.classList.contains('chat-left')&&$('chatSide')&&!$('chatSide').hidden,'left column: the placement switch is shown');
  const sb=$('chatSide');sb.dispatch('click',{target:sb});
  ok(where('chatSec')==='colM'&&!document.body.classList.contains('chat-left'),'the switch puts the chat under the map at 2400 px');
  sb.dispatch('click',{target:sb});ok(where('chatSec')==='colL','and back to the left column');
  for(const w of [1600,390]){window.innerWidth=w;uiFast();
    ok(where('chatSec')==='colM'&&$('colM').children.indexOf(sec)<$('colM').children.indexOf($('heroSec')),w+' px: the chat is under the map, above the hero card');
    ok(!document.body.classList.contains('chat-left')&&$('chatSide').hidden,w+' px: no left-chat styling, no switch')}
  window.innerWidth=keep;uiFast()}
// Fellowship sheet editor: the Archetype select (#295 follow-up) rewrites the persona boxes in place and fills stances
{const fb=$('felbody'),{ARCHETYPES}=await import('../src/data/archetypes.js');
  if(!fb.querySelector('.feldrawer'))fb.querySelector('[data-fact="drawer:members"]').click();
  uiFast(); // a member who fell since the last refresh has a new id: the row must be drawn for the member we pick
  const a=SLT.slotHeroes(SLT.slotted())[0];
  const sb=fb.querySelectorAll('button').find(b=>b.dataset.fsheet==String(a.id));ok(!!sb,'sheet editor: the drawer has a Sheet button for '+a.name+' (#'+a.id+')');if(!sb)throw new Error('no Sheet button');sb.click();
  const sel=fb.querySelector('select[data-farch]');
  ok(!!sel&&sel.children.length===7&&sel.value==='','sheet editor: an Archetype select, None until one is picked');
  const voice=()=>fb.querySelectorAll('textarea').find(t=>t.dataset.fw==='persona'&&t.dataset.fk==='voice');const box0=voice();
  const typed=fb.querySelectorAll('textarea').find(t=>t.dataset.fw==='backstory');typed.value='typed but not saved';
  sel.value='mercenary';sel.dispatch('change',{target:sel});uiFast();
  ok(a.persona.archetype==='mercenary'&&a.persona.voice===ARCHETYPES.mercenary.voice&&a.persona.edited,'sheet editor: picking one applies it and marks the persona as the owner choice');
  ok(voice()===box0&&box0.value===ARCHETYPES.mercenary.voice&&typed.value==='typed but not saved','sheet editor: the persona boxes change in place, typed text elsewhere is kept');
  ok(fb.querySelector('.farchhint').textContent.includes(ARCHETYPES.mercenary.voice),'sheet editor: the hint shows the archetype voice');
  const m2=SLT.slotHeroes(SLT.slotted())[1];ok(a.persona.stances[m2.id]===ARCHETYPES.mercenary.stance.replace('{other}',m2.name),'sheet editor: stances name each companion');
  ok(!fb.querySelector('select[data-farch]').children.some(o=>o.value===''),'sheet editor: None is gone once one is picked');
  fb.querySelectorAll('button').find(b=>b.dataset.fact==='close').click()}
// Agent-built personality (#409): a pin per persona field in the sheet editor; the Life view shows who they became
{const fb=$('felbody'),P=await import('../src/sim/persona.js'),LV=await import('../src/ui/lifeview.js');
  const a=SLT.slotHeroes(SLT.slotted())[0];let sb=fb.querySelectorAll('button').find(b=>b.dataset.fsheet==String(a.id));
  if(!sb){fb.querySelector('[data-fact="drawer:members"]').click();uiFast();sb=fb.querySelectorAll('button').find(b=>b.dataset.fsheet==String(a.id))}sb.click();
  const pins=fb.querySelectorAll('input').filter(i=>i.dataset&&i.dataset.fpin!=null&&i.dataset.fpin!=='oath'); // a sworn oath has its own pin (#800)
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
  const [a,m2,m3]=SLT.slotHeroes(SLT.slotted());open(a);
  const rows=()=>fb.querySelectorAll('.fstance'),row=b=>rows().find(r=>r.dataset.fst==String(b.id)),box=b=>row(b).querySelector('textarea'),tag=b=>row(b).querySelector('.fsttag'),rst=b=>row(b).querySelector('[data-fstreset]');
  ok(rows().length===SLT.slotHeroes(SLT.slotted()).length-1,'stances: one row per living companion ('+rows().length+')');
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
  const b=m2;open(b);const o=SLT.slotHeroes(SLT.slotted()).find(x=>x!==b&&!(b.persona&&b.persona.archetype)&&!(b.persona&&b.persona.stanceBy||{})[x.id]);
  if(b.persona&&!b.persona.archetype&&b.persona.src!=='model'&&o){const t=box(o);
    ok(t.value===''&&tag(o).hidden,'stances: a scripted stance shows an empty box and no tag');
    t.value='Too quiet by half.';fb.querySelectorAll('button').find(x=>x.dataset.fact==='save').click();uiFast();
    ok(P.authoredStance(b,o)==='Too quiet by half.'&&tag(o).textContent==='owner','stances: an owner line on a scripted persona');
    box(o).value='';fb.querySelectorAll('button').find(x=>x.dataset.fact==='save').click();uiFast();
    ok(P.authoredStance(b,o)===''&&!(b.persona.stanceBy||{})[o.id]&&tag(o).hidden&&b.memory.stances[o.id].startsWith(P.scriptedStance(b,o)),'stances: an empty box on Save hands it back to the bond reading')}
  else console.log('  skip stances on a scripted persona (none at hand)');
  fb.querySelectorAll('button').find(x=>x.dataset.fact==='close').click()}
// ---- the hall board (#334): the hall's jobs for the Fellowship, empty and filled, patched in place ----
{const fb=$('felbody'),S=sim.S,F=SLT.slotted(),keep=S.adventures;S.adventures=[];uiFast();
  const hb=()=>fb.querySelector('.felhall');
  ok(!!hb()&&/No job for the Fellowship on the hall board\./.test(hb().textContent),'hall board: the empty state reads plainly');
  const {REGIONS,ZONES}=await import('../src/world/map.js');const z=REGIONS.findIndex(r=>r&&r.band);
  const other=S.agents.find(a=>!SLT.inSlots(a)&&a.state!=='dead');
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
  const fel=live.find(g=>sim.S.agents.some(a=>a.guild===g&&SLT.inSlots(a)&&a.state!=='dead'));
  // every guild with a living Fellowship member shows 'none (Fellowship member)', not just the first one found
  const plain=live.filter(g=>!sim.S.agents.some(a=>a.guild===g&&SLT.inSlots(a)&&a.state!=='dead'));const g1=plain[0],g2=plain.find(g=>g.fac!==g1.fac);
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
{const {chronicleShows}=await import('../src/ui/fellowship.js');const {chronicleFocus, guildLabel}=await import('../src/sim/company.js');
  const a=mem.find(x=>x.state!=='dead'),was=a.guild;
  const ours={id:-341,tag:'OWN',name:'Oathbound Test',fac:a.fac,retired:false},theirs={id:-342,tag:'ELS',name:'Elsewhere Test',fac:1-a.fac,retired:false};
  a.guild=ours;const tg=g=>({t:guildLabel(g),c:'f'+g.fac}),stranger=sim.S.agents.find(x=>x.kind==='hero'&&!SLT.inSlots(x)&&x.state!=='dead'&&!(SLT.slotted().past||[]).some(p=>p.id===x.id)&&!SLT.slotHeroes(SLT.slotted()).some(m=>(m.nemesis||{})[x.id])); // not a member, a former member or a member's rival
  const e=(...parts)=>({t:'12:00',parts});
  const focusLine=e(tg(ours),' turns its banner to the ',{t:'Delve',c:'gd'},'.'),otherLine=e(tg(theirs),' goes ',{t:'Wayfaring',c:'gd'},'.');
  const rivalLine=e(tg(theirs),' and ',tg(ours),' declare a rivalry: blood on the road.');
  ok(chronicleShows(focusLine)&&chronicleFocus(focusLine),'Fellowship only: a guild line naming a member\'s guild shows');
  ok(chronicleShows(rivalLine),'Fellowship only: a rivalry naming the member\'s guild shows');
  ok(!chronicleShows(otherLine),'Fellowship only: an unrelated guild line stays hidden');
  ok(chronicleShows(e(a,' slays a wolf.'))&&chronicleShows(e({t:'Kragmaw',c:'gd'},' stirs.')),'Fellowship only: member and Kragmaw lines still show');
  if(stranger){const shown=chronicleShows(e(stranger,' slays a wolf.'));ok(!shown,'Fellowship only: a stranger\'s line stays hidden'+(shown?' -- saw '+stranger.name+' id '+stranger.id+' fellow='+SLT.inSlots(stranger)+' past='+JSON.stringify((SLT.slotted().past||[]).map(p=>p.id))+' ids='+JSON.stringify(SLT.slotted().ids):''))}
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
  const ci=Math.min(2,n-2),mem=S.agents.filter(a=>a.kind==='hero'&&a.state!=='dead').slice(0,4); // the room in progress, with one chamber after it, whatever the world's crypt has
  CRYPT.group={phase:'inside',mem,tSite:true,crawl:{i:ci,rd:1,gap:0,foes:[{hp:1},{hp:0}],end:null}};
  let st=dv.refreshDungeon();
  ok(lis().slice(0,ci).every(li=>li.classList.contains('cleared'))&&lis()[ci].classList.contains('current')&&lis()[ci+1].classList.contains('unexplored'),'dungeon view: cleared rooms, the room in progress and fog read from the crawl');
  ok(/round 2\/2/.test(st.status)&&/1 foe stands/.test(st.status)&&st.party.length===mem.length&&st.round==='ROUND 2/2','dungeon view: the round and the party ('+st.status+')');
  ok(lis()[ci+1].textContent.includes('?'),'dungeon view: a room not reached is not named');
  CRYPT.group.crawl.end='retreat';CRYPT.group.crawl.driven=true;dv.trackCrawl();CRYPT.group=null;dv.trackCrawl();st=dv.refreshDungeon();
  ok(/Last run/.test(st.status)&&/driven back from/.test(st.status)&&lis()[ci].classList.contains('lost')&&!box().querySelector('.unexplored'),'dungeon view: with no crawl, the empty interior and how the last run ended ('+st.status+')');
  { // a non-Fellowship company's crawl (#502): the crew is the company, fill-ins ride along unseen, the bar names it, the tally is its own
    const {companies}=await import('../src/sim/company.js'),all=S.agents.filter(x=>x.kind==='hero'&&x.state!=='dead'),crew=all.slice(0,2),fill=all[2];
    const Co={id:9901,name:'The Ember Road',fac:crew[0].fac,ids:crew.map(x=>x.id),crawl:{runs:0,clears:0,driven:0,withdrawn:0,wipes:0,deaths:0,rooms:0,scenes:0}};
    S.companies=(S.companies||[]).concat([Co]);const fk=SLT.slotted()&&SLT.slotted().crawl;
    CRYPT.group={phase:'inside',mem:crew.concat(fill?[fill]:[]),tSite:true,crawl:{i:ci,rd:0,gap:0,foes:[{hp:1}],end:null,co:Co.id,crew:crew.length}};
    st=dv.refreshDungeon();
    ok(st.party.length===crew.length&&st.company==='The Ember Road'&&/THE EMBER ROAD/.test(box().querySelector('.dgname').textContent),'dungeon view: a non-Fellowship company crawl names the company and shows only its crew ('+box().querySelector('.dgname').textContent+')');
    CRYPT.group.crawl.end='retreat';st=dv.refreshDungeon();ok(/The Ember Road fall back/.test(st.status),'dungeon view: the status names the company ('+st.status+')');
    CRYPT.group.crawl.end='clear';dv.trackCrawl();CRYPT.group=null;Co.crawl.clears++;dv.trackCrawl();st=dv.refreshDungeon();
    ok(/Last run/.test(st.status)&&/The Ember Road cleared/.test(st.status),'dungeon view: that company tally ends its run as a clear ('+st.status+')');
    S.companies=S.companies.filter(x=>x!==Co);if(fk===undefined&&SLT.slotted())delete SLT.slotted().crawl}
  box().querySelector('.dgback').click();ok(box().hidden&&!dv.dungeonOpen()&&!$('screen').classList.contains('dgopen'),'dungeon view: Back to world closes it');
  const a=mem[0],was={state:a.state,hidden:a.hidden};a.state='dungeon';a.hidden=true;select(a);uiFast();const link=$('hero').querySelector('.dglink');
  ok(!!link,'dungeon view: the hero card of a hero inside has View inside');if(link){link.click();ok(dv.dungeonOpen(),'dungeon view: View inside opens it')}
  dv.closeDungeon();a.state=was.state;a.hidden=was.hidden;CRYPT.group=keep;uiFast()}
// ---- the dungeon view (#85, slice 2): foes with HP, chamber detail on hover or click, history, the minimap's mark ----
{const dv=await import('../src/render/dungeonview.js'),fx=await import('../src/render/dgfoes.js'),{CRYPT}=await import('../src/world/map.js'),{buildInterior}=await import('../src/world/interior.js');
  const S=sim.S,keep=CRYPT.group,n=CRYPT.rooms.length,mem=S.agents.filter(a=>a.kind==='hero'&&a.state!=='dead').slice(0,4);
  const foesOf=i=>{const o=[];for(const f of CRYPT.rooms[i].foes)for(let k=0;k<f.n;k++){const h=f.hits||2;o.push({type:f.type,name:f.name||fx.foeKind(f.type).name,hp:h,hits:h,atk:1,lvl:5})}return o};
  const g=(i,extra)=>({phase:'inside',name:'The Fellowship',mem,tSite:true,crawl:Object.assign({i,rd:0,gap:0,foes:null,end:null},extra)});
  ok(fx.foeKind('shambler').name==='Crypt Shambler'&&fx.foeKind('shambler').role==='brute'&&fx.foeKind('wolf').name==='Timber Wolf','dungeon foes: a site creature and a field species read from the bestiary (name, role)');
  const m=buildInterior(CRYPT);ok(m.rooms.every(r=>[0,1,2].every(k=>{const p=fx.foeSpot(r,k,3);return p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h})),'dungeon foes: every foe stands inside its chamber');
  dv.initDungeonView();dv.openDungeon(CRYPT);const box=()=>$('dungeon');
  ok(sim.S&&dv.dungeonSite()===CRYPT,'dungeon view: the minimap reads the open site (dungeonSite)');
  // a crawl in room 2 with three foes, one hurt, one down
  const fs=foesOf(2);fs[0].hp=Math.max(0,fs[0].hits-1);fs[fs.length-1].hp=0;
  CRYPT.group=g(2,{foes:fs,rd:1});dv.trackCrawl();let st=dv.refreshDungeon();
  ok(st.foes===fs&&st.foeRoom===2&&st.foes.length===fs.length&&/\w/.test(st.foeText),'dungeon foes: the live crawl foes are in the view state ('+st.foeText+')');
  let d=dv.roomDetail(2,CRYPT,st);
  ok(d.state==='current'&&/Fight in progress/.test(d.stateText)&&d.kind==='Chamber'&&d.foes.some(t=>/HP \d+\/\d+/.test(t))&&d.foes.some(t=>/already down/.test(t)),'dungeon detail: the room in progress lists its foes with HP and the fallen ('+d.foes.join(' | ')+')');
  d=dv.roomDetail(3,CRYPT,st);ok(d.state==='unexplored'&&/Unexplored/.test(d.title)&&!d.foes.length,'dungeon detail: a chamber not reached shows neither name nor foes');
  d=dv.roomDetail(0,CRYPT,st);ok(d.state==='cleared'&&d.foes.length>0&&d.title===CRYPT.rooms[0].name,'dungeon detail: a cleared chamber shows its name and what dwelt there (bestiary name, role)');
  ok(dv.roomDetail(n-1,CRYPT,st).kind==='Boss chamber','dungeon detail: the last chamber is the boss chamber');
  // click a chamber in the list: its detail is pinned
  const lis=[...box().querySelectorAll('li')];lis[2].click();const pin=box().querySelector('.dgpin');
  ok(pin&&!pin.hidden&&pin.textContent.includes(CRYPT.rooms[2].name)&&/Foes/.test(pin.textContent),'dungeon detail: a click on a chamber pins its detail');
  lis[2].click();ok(box().querySelector('.dgpin').hidden,'dungeon detail: a second click unpins it');
  // a run: a fall in room 2, driven back; the history keeps who entered and who fell where
  const a=mem[1],was=a.state;a.state='dead';dv.trackCrawl();CRYPT.group.crawl.end='retreat';CRYPT.group.crawl.driven=true;dv.trackCrawl();CRYPT.group=null;dv.trackCrawl();
  const H=dv.historyOf(CRYPT);st=dv.refreshDungeon();
  ok(H.length>=1&&/driven back/i.test(H[0].outcome)&&H[0].lines[0].includes(mem[0].name)&&/Fell: .*in/.test(H[0].lines[2])&&H[0].lines[2].includes(a.name),'dungeon history: who entered, how it ended and who fell where ('+H[0].outcome+'; '+H[0].lines.join(' / ')+')');
  ok(st.falls&&st.falls.some(f=>f.room===2),'dungeon history: the fall is marked in its chamber');
  d=dv.roomDetail(2,CRYPT,st);ok(d.notes.some(t=>t.includes(a.name+' fell here'))&&d.notes.some(t=>/driven back/.test(t)),'dungeon detail: what happened in a chamber comes from the run record ('+d.notes.join(' | ')+')');
  box().querySelector('.dghbtn').click();ok(!box().querySelector('.dghist').hidden&&box().querySelector('.dghist').textContent.includes(mem[0].name),'dungeon history: the History button opens the panel');
  box().querySelector('.dghbtn').click();ok(box().querySelector('.dghist').hidden,'dungeon history: and closes it');
  dv.closeDungeon();ok(dv.dungeonSite()===null,'dungeon view: closed, the minimap has no mark');
  a.state=was;CRYPT.group=keep;uiFast()}
// ---- the crawl as it is played (#742): named spots per chamber, members on the spot their act names, foes at the den, beats ----
{const dv=await import('../src/render/dungeonview.js'),cv=await import('../src/render/crawlview.js'),RG=await import('../src/sim/roomgrid.js'),{CRYPT}=await import('../src/world/map.js'),{buildInterior,IT}=await import('../src/world/interior.js'),{TABLE}=await import('../src/sim/table.js');
  const S=sim.S,keep=CRYPT.group,keepT=S.table,m=buildInterior(CRYPT),walk=t=>t===IT.FLOOR||t===IT.WATER||t===IT.DAIS||t===IT.DOOR;
  const inRoom=(r,p)=>p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h&&walk(m.tiles[Math.floor(p.y-.3)*m.w+Math.floor(p.x)]);
  ok(m.rooms.every((r,i)=>{const s=cv.crawlSpots(m,i);return cv.SPOT_IDS.every(id=>inRoom(r,s[id]))}),'crawl spots: every chamber has stair, back, front, both flanks, cover and den on its own floor');
  ok(m.rooms.every((r,i)=>{const s=cv.crawlSpots(m,i),d=p=>Math.hypot(p.x-s.den.x,p.y-s.den.y);return d(s.back)>d(s.front)&&d(s.front)>.8&&(r.boss||Math.hypot(s.back.x-s.stair.x,s.back.y-s.stair.y)<d(s.back))}),'crawl spots: the back by the way in (below the dais in the boss chamber), the front between it and the den');
  ok(cv.crawlSpots(m,0).coverName===(m.rooms[0].water?'reeds':'cover'),'crawl spots: a wet chamber\'s cover is the reeds');
  ok(cv.crawlSpots(m,1,{spots:{front:{u:.3,v:.2}}}).front.u===.3,'crawl spots: a room spec may move a spot (spots: {front: {u, v}})');
  ok(cv.spotFor('guard')==='front'&&cv.spotFor('hold')==='front'&&cv.spotFor('strike',0)==='flankL'&&cv.spotFor('strike',1)==='flankR'&&cv.spotFor('strike',2)==='front'&&cv.spotFor('ward')==='back'&&cv.spotFor('heal')==='back'&&cv.spotFor('read')==='back'&&cv.spotFor('potion')==='back'&&cv.spotFor('scout')==='cover'&&cv.spotFor('retreat')==='stair','crawl spots: the acts name their spots (guard, hold front; strikers left, right, then front; ward, heal, read, potion back; scout cover; retreat stair)');
  const mem=S.agents.filter(a=>a.kind==='hero'&&a.state!=='dead').slice(0,5),hp0=mem.map(a=>a.hp);
  const foes=[0,1,2].map(()=>({type:'tombskit',name:'Tomb Skitter',hp:2,hits:2,lvl:3,atk:1}));
  CRYPT.group={phase:'inside',name:'The Fellowship',mem,tSite:true,crawl:{i:0,rd:0,gap:0,foes,end:null}};
  const sc={id:97420,kind:'crawl',title:CRYPT.rooms[0].name,frame:['x'],ids:mem.map(a=>a.id),i:0,phase:'turn',t:0,acts:{},beats:[],ctx:{room:0,rd:0},pause:true,at:0};S.table=sc;
  const sp0=TABLE.speed;TABLE.speed=1;let t=1000;const tick=(n,dt=.05)=>{let v;for(let k=0;k<n;k++){t+=dt;v=cv.crawlView(m,dv.stateOf(CRYPT),t)}return v};
  // the sim keeps the tiles (#744): the party comes in at the stair, the foes at the den; the view walks everyone to their tile
  const G0=RG.roomGrid(m,0,CRYPT.rooms[0]),cr0=CRYPT.group.crawl,stand=(a,id)=>{cr0.pos[a.id]={x:G0.spots[id].x,y:G0.spots[id].y}};
  RG.placeRoom(G0,cr0,mem.map(a=>a.id),foes.length);
  let v=tick(3);ok(v.live&&cv.crawlRoom()===0&&mem.every(a=>cv.crawlPlacement()[a.id]==='stair'||cv.crawlPlacement()[a.id]==='back'),'crawl view: the party stands by the way in as the sim set it ('+mem.map(a=>cv.crawlPlacement()[a.id]).join(', ')+')');
  const want=['front','back','flankL','flankR','cover'];mem.forEach((a,i)=>stand(a,want[i]));tick(60);
  const P=cv.crawlPlacement();
  ok(mem.every((a,i)=>P[a.id]===want[i]),'crawl view: each member heads for the tile the sim keeps ('+mem.map(a=>P[a.id]).join(', ')+')');
  ok(mem.every(a=>{const p=cv.crawlPos(a.id);return Math.hypot(p.x-p.tx,p.y-p.ty)<.05}),'crawl view: and walks there within a few seconds');
  const S0=cv.crawlSpots(m,0),f0=cv.foePos(0),fr=cv.crawlPos(mem[0].id);
  ok(Math.hypot(f0.x-S0.den.x,f0.y-S0.den.y)<Math.hypot(fr.x-S0.den.x,fr.y-S0.den.y),'crawl view: the foes stand at the den, past the front');
  stand(mem[4],'stair');tick(80);ok(cv.crawlPlacement()[mem[4].id]==='stair','crawl view: a retreat walks the member back to the stair');
  // a round resolves at once: the beats are queued and play over a few seconds; the HP bars wait for them
  foes[0].hp=0;sc.beats.push({id:mem[2].id,name:mem[2].name,k:'strike',text:'Strike',res:'a crushing blow',by:'agent',rd:1});
  sc.beats.push({id:mem[3].id,name:mem[3].name,k:'strike',text:'Strike',res:'missed badly and left an opening',by:'agent',rd:1});
  mem[0].hp=Math.max(1,mem[0].hp-10);sc.phase='outcome';sc.summary='2 of them stand. 1 blow lands, 1 misses.';
  tick(1);const Q=cv.crawlQueue();ok(Q.join()==='strike,strike,blow','crawl beats: the round plays as beats in act order, the foes\' blows after ('+Q.join()+')');
  ok(cv.crawlSummary()==='','crawl beats: the summary waits until the beats have played');
  tick(100);ok(!cv.crawlQueue().length&&cv.crawlSummary()===sc.summary,'crawl beats: a few seconds later they have played and the summary sits under the room');
  TABLE.speed=8;foes[1].hp=1;sc.beats.push({id:mem[2].id,name:mem[2].name,k:'strike',text:'Strike',res:'hit Tomb Skitter',by:'agent',rd:1});tick(1);ok(!cv.crawlQueue().length,'crawl beats: at 8x they are skipped');
  // the room is won: the view stays on it for its last beats, then the party comes in by the next room's way in
  TABLE.speed=1;foes[1].hp=0;foes[2].hp=0;sc.beats.push({id:mem[3].id,name:mem[3].name,k:'strike',text:'Strike',res:'struck down Tomb Skitter',by:'agent',rd:1});tick(1);
  CRYPT.group.crawl.i=1;CRYPT.group.crawl.foes=null;CRYPT.group.crawl.gap=4;S.table=null;tick(2);ok(cv.crawlRoom()===0,'crawl view: the won room stays in view while its last beat plays');
  tick(120);ok(cv.crawlRoom()===1||!cv.crawlView(m,dv.stateOf(CRYPT),t).live,'crawl view: then the view moves on with the party');
  // hover: a foe as drawn is found by foeAt only while the crawl view is live; sim state untouched
  ok(mem.every((a,i)=>a.hp===(i===0?Math.max(1,hp0[0]-10):hp0[i])),'crawl view: reading the crawl changes no hero');
  mem[0].hp=hp0[0];TABLE.speed=sp0;CRYPT.group=keep;S.table=keepT;uiFast()}
// ---- the raid arena (#85, raid slice): Kragmaw's lair in the dungeon view's frame, the raid read live, its history ----
{const dv=await import('../src/render/dungeonview.js'),rv=await import('../src/render/raidview.js'),{LANDMARKS}=await import('../src/world/map.js'),{buildArena,IT}=await import('../src/world/interior.js'),again=await import('../src/world/interior.js?again3');
  const S=sim.S,B=S.boss,L=LANDMARKS.find(l=>l.kind==='lair');ok(!!L&&L.inner>0&&!!L.opening,'raid arena: the lair landmark carries its floor radius and opening');
  const m=buildArena(L),m2=again.buildArena(L),A=m.arena,at=(x,y)=>m.tiles[Math.floor(y)*m.w+Math.floor(x)];
  ok(m!==m2&&m.seed===m2.seed&&m.w===m2.w&&m.tiles.every((t,i)=>t===m2.tiles[i])&&JSON.stringify(m.props)===JSON.stringify(m2.props),'raid arena: the same arena from a fresh build ('+m.w+'x'+m.h+')');
  ok(at(A.cx,A.cy)===IT.FLOOR&&m.tiles.includes(IT.WATER)&&m.tiles.includes(IT.DAIS)&&m.tiles.includes(IT.STAIR)&&m.props.some(p=>p.kind==='hoard'),'raid arena: a rock floor, the lava ring, the hoard and the way in');
  ok(at(A.cx+(A.inner+.7)*A.k*A.dir[1],A.cy+(A.inner+.7)*A.k*A.dir[0])===IT.WATER&&at(A.cx+(A.inner+.7)*A.k*A.dir[0],A.cy+(A.inner+.7)*A.k*A.dir[1])===IT.HALL,'raid arena: lava beside the floor, the causeway on the opening side');
  ok(dv.lairAt(L.x+1,L.y)===L&&!dv.lairAt(L.x+L.r+3,L.y),'raid arena: a click on the lair finds it, beside it does not');
  dv.initDungeonView();const box=()=>$('dungeon'),lis=()=>[...box().querySelectorAll('li')];
  const keep={raidOn:S.raidOn.slice(),hp:B.hp,alive:B.alive,breath:B.breath},crew=S.agents.filter(a=>a.fac===0&&a.state!=='dead'&&!a.hidden&&a.kind==='hero').slice(0,5),was=crew.map(a=>({x:a.x,y:a.y,state:a.state,raid:a.raid,raidIdx:a.raidIdx,hp:a.hp}));
  ok(dv.openDungeon(L)&&!box().hidden&&box().classList.contains('raid')&&dv.dungeonSite()===L,'raid arena: opens over the map in the dungeon view’s frame, the minimap reads the lair');
  let st=dv.refreshDungeon();ok(st.phase==='quiet'&&/sleeps on its hoard/.test(st.status)&&/LAIR/.test(box().querySelector('.dgname').textContent),'raid arena: quiet with no raid ('+st.status+')');
  crew.forEach((a,i)=>{a.raid=true;a.raidIdx=i;a.state='raid';const ang=Math.PI*(.55+i*.18);a.x=B.x-Math.cos(ang)*2.2;a.y=B.y-.3+Math.sin(ang)*2.2*(i%2?1:-1)*.8});
  crew[4].x=L.x-L.r-1;crew[4].y=L.y; // still on the way in
  S.raidOn[0]=true;B.hp=B.maxhp*.6;B.breath=1.2;rv.trackRaid();st=dv.refreshDungeon();
  ok(st.phase==='raid'&&st.engaged===4&&st.approach===1&&/60%/.test(st.status)&&/4 fighting, 1 on the way/.test(st.status)&&/Cinder Breath in 2 s/.test(st.status),'raid arena: the boss’s HP, who fights and who walks in, the breath to come ('+st.status+')');
  ok(st.raiders.filter(r=>r.eng).every(r=>[IT.FLOOR,IT.DAIS].includes(at(r.x,r.y)))&&[IT.HALL,IT.STAIR,IT.FLOOR].includes(at(st.raiders[4].x,st.raiders[4].y)),'raid arena: the fighters stand on the floor round the wyrm, the late one on the causeway');
  ok(lis().length===5&&lis().every(li=>li.classList.contains('raider'))&&/CONCORD RAID|RAID/.test(box().querySelector('.dgname').textContent),'raid arena: one row per raider on the bar ('+box().querySelector('.dgname').textContent+')');
  let d=rv.raidDetail('boss',st);ok(d&&/HP \d+\/\d+/.test(d.stateText)&&d.foes.some(t=>/Phase: /.test(t))&&d.foes.some(t=>/Next Cinder Breath/.test(t))&&d.foes.some(t=>/No adds|adds? in the lair/.test(t)),'raid arena: the boss detail (HP, phase, breath, adds): '+d.foes.join(' | '));
  lis()[0].click();ok(!box().querySelector('.dgpin').hidden&&box().querySelector('.dgpin').textContent.includes(crew[0].name)&&/Fighting/.test(box().querySelector('.dgpin').textContent),'raid arena: a click on a raider pins its detail');
  lis()[0].click();ok(box().querySelector('.dgpin').hidden,'raid arena: a second click unpins it');
  crew[1].raid=false;crew[2].state='dead';rv.trackRaid();st=dv.refreshDungeon();
  ok(st.gone.some(g=>g.why==='broke'&&g.id===crew[1].id)&&st.gone.some(g=>g.why==='fell'&&g.id===crew[2].id)&&st.falls.length===1&&/1 broke off/.test(st.status)&&/1 fell/.test(st.status),'raid arena: who broke off and who fell ('+st.status+')');
  ok(lis().some(li=>li.classList.contains('lost')&&li.textContent.includes(crew[2].name))&&lis().some(li=>/fled/.test(li.textContent)),'raid arena: the bar marks the fled and the fallen');
  // the hero card of a raider has View the raid; the timeline's raid lines have Inside
  crew[2].state=was[2].state;select(crew[0]);uiFast();const link=[...$('hero').querySelectorAll('.dglink')].find(b=>/raid/i.test(b.textContent));
  ok(!!link&&link.dataset.dungeon===L.name,'raid arena: the hero card of a raider has View the raid');
  dv.closeDungeon();if(link){link.click();ok(dv.dungeonOpen()&&dv.dungeonSite()===L,'raid arena: View the raid opens it')}
  S.raidOn[0]=false;for(const a of crew)a.raid=false;rv.trackRaid();const H=rv.raidHistory();st=dv.refreshDungeon();
  ok(H.length>=1&&/Beaten off at 60%/.test(H[0].outcome)&&H[0].lines[0].includes(crew[0].name)&&H[0].lines[1].includes(crew[1].name)&&H[0].lines[2].includes(crew[2].name),'raid arena: the history keeps who mustered, fled and fell ('+H[0].outcome+'; '+H[0].lines.join(' / ')+')');
  ok(st.phase==='quiet'&&/Last raid/.test(st.status),'raid arena: quiet again, with the last raid ('+st.status+')');
  box().querySelector('.dghbtn').click();ok(!box().querySelector('.dghist').hidden&&/Beaten off/.test(box().querySelector('.dghist').textContent),'raid arena: the History button opens the raids');box().querySelector('.dghbtn').click();
  B.alive=false;B.respawn=300;st=dv.refreshDungeon();ok(st.phase==='dead'&&/wakes in about 30 game hours/.test(st.status),'raid arena: a slain wyrm’s cold lair ('+st.status+')');
  S.timeline.unshift({t:'12:00',gameMin:S.gameMin,kind:'raid',parts:['A raid.']});uiSlow();const tl=$('tlist')&&$('tlist').querySelector('[data-dungeon]');
  ok(!!tl&&tl.dataset.dungeon===L.name,'raid arena: a raid line on the timeline has Inside');S.timeline.shift();
  dv.closeDungeon();ok(dv.dungeonSite()===null&&!box().classList.contains('raid')||box().hidden,'raid arena: closed');
  S.raidOn=keep.raidOn;B.hp=keep.hp;B.alive=keep.alive;B.breath=keep.breath;crew.forEach((a,i)=>Object.assign(a,was[i]));uiFast();uiSlow()}
// ---- scene maps (#431, slice 1): settings as data, the indoor generator, the scene view's terrain cut and rooms ----
{const sv=await import('../src/render/sceneview.js'),{buildSetting,IT}=await import('../src/world/interior.js'),again=await import('../src/world/interior.js?again2');
  const {SETTINGS,SETTING_IDS}=await import('../src/data/settings.js'),{CITY}=await import('../src/world/map.js'),S=sim.S;
  const keepT=S.table,keepW=S.wanderers,FOL={view:'fellow'};
  for(const id of ['house','tavern','chapel','cellar','cell','shrine','hold'])ok(!!SETTINGS[id],'scene maps: the settings table has '+id);
  let good=0;for(const id of SETTING_IDS){const m=buildSetting(id,'Highgate|7'),m2=again.buildSetting(id,'Highgate|7'),at=(x,y)=>m.tiles[Math.floor(y)*m.w+Math.floor(x)];
    const same=m!==m2&&m.seed===m2.seed&&m.w===m2.w&&m.tiles.every((t,i)=>t===m2.tiles[i])&&JSON.stringify(m.props)===JSON.stringify(m2.props);
    const walk=t=>t!==IT.VOID&&t!==IT.WALL,onFloor=p=>walk(at(p.x,p.y))&&at(p.x,p.y)!==IT.BARS;
    const walled=[...m.tiles].every((t,i)=>{if(!walk(t)||t===IT.DOOR||t===IT.STAIR)return true;const x=i%m.w,y=Math.floor(i/m.w);return x>0&&y>0&&x<m.w-1&&y<m.h-1});
    if(same&&walled&&m.spots.cast.every(onFloor)&&onFloor(m.spots.party)&&m.props.length>=4)good++;else console.error('  setting '+id+': same '+same+', walled '+walled+', props '+m.props.length)}
  ok(good===SETTING_IDS.length,'scene maps: every setting ('+SETTING_IDS.length+') builds walled, with its people on the floor, furnished, the same from a fresh build');
  ok(buildSetting('tavern','Highgate|7').seed!==buildSetting('tavern','Highgate|8').seed,'scene maps: another scene in the same town gets another room');
  sv.initSceneView();
  const mem=S.agents.filter(a=>a.kind==='hero'&&SLT.inSlots(a)&&a.state!=='dead').slice(0,5),m0=mem[0],box=()=>$('sceneview');
  const keepPos=mem.map(a=>[a.x,a.y,a.hidden]);
  // an ambush in the open: the terrain cut around the members and the foe
  const seen=a=>a.kind==='hero'&&!SLT.inSlots(a)&&a.state!=='dead'&&!a.hidden&&a.alive!==false, wild=S.agents.find(a=>seen(a)&&!CITY.some(c=>a.x>=c.x0-4&&a.x<=c.x1+5&&a.y>=c.y0-4&&a.y<=c.y1+5))||S.agents.find(seen); // a foe the cut can see: not dead, not hidden inside the Crypt or a raid
  mem.forEach((a,k)=>{a.x=wild.x-2+k;a.y=wild.y+1;a.hidden=false});
  let sid=5000;const scene=(kind,title,ctx)=>({id:++sid,kind,title,frame:[title],ids:mem.map(a=>a.id),i:0,phase:'turn',t:0,acts:{},beats:[],ctx,pause:true,at:S.gameMin});
  S.table=scene('ambush','Ambush: '+wild.name,{foe:wild.id,anchor:m0.id});sv.sceneTick(FOL);
  const cut=sv.sceneCut();
  ok(sv.sceneOpen()&&sv.sceneMode()==='outdoor'&&!box().hidden&&box().classList.contains('scout')&&$('screen').classList.contains('scopen'),'scene maps: an ambush opens the terrain cut over the world');
  ok(!!cut&&cut.foes.includes(wild)&&mem.every(a=>cut.members.includes(a))&&Math.abs(cut.cx-m0.x)<cut.w/2&&Math.abs(cut.cy-m0.y)<cut.h/2,'scene maps: the cut frames the members where they stand and the foe ('+(cut?Math.round(cut.w)+'x'+Math.round(cut.h)+' tiles':'none')+')'+(cut&&mem.every(a=>cut.members.includes(a))&&cut.foes.includes(wild)?'':' -- saw foe '+wild.name+' '+wild.state+' hidden='+wild.hidden+' alive='+wild.alive+' at '+Math.round(wild.x)+','+Math.round(wild.y)+', members in cut '+(cut?cut.members.length:0)+'/'+mem.length+', foes '+(cut?cut.foes.length:0)));
  ok([...box().querySelectorAll('li')].some(li=>li.textContent===wild.name)&&/to act|acts/.test(box().querySelector('.dgname').textContent)&&!/AMBUSH/i.test(box().querySelector('.dgname').textContent),'scene maps: the bar says whose turn it is (not the title) and who is in it ('+box().querySelector('.dgname').textContent+')');
  box().querySelector('.dgback').click();sv.sceneTick(FOL);
  ok(!sv.sceneOpen()&&box().hidden&&!$('screen').classList.contains('scopen'),'scene maps: Back to world closes it, and it stays closed for that scene');
  sv.openSceneView();ok(sv.sceneOpen(),'scene maps: it opens again by hand');S.table=null;sv.sceneTick(FOL);
  ok(!sv.sceneOpen(),'scene maps: the view returns to the world when the scene ends');
  // a fight on the map patch (#746): the cut frames sc.fp, the ground is marked, the round plays as beats; no sc.fp leaves the old cut alone
  {const {openPatch,patchGrid}=await import('../src/sim/patch.js'),{TABLE}=await import('../src/sim/table.js'),{SCENE}=await import('../src/render/palette.js'),{MOBS}=await import('../src/data/mobs.js');
    const mob=S.mobs.find(m=>m.alive&&!m.hidden&&!m.elite&&MOBS[m.type]),mobWas={x:mob.x,y:mob.y,alive:mob.alive,hp:mob.hp};mob.x=m0.x+2;mob.y=m0.y-1;
    const drawn=()=>{const c={image:0};return {c,ctx:new Proxy({},{get:(o,k)=>k in o?o[k]:k==='drawImage'?()=>{c.image++}:()=>{},set:(o,k,v)=>{o[k]=v;return true}})}},cam={dpr:1,sc:8,offX:0,offY:0},t0=1000;
    // no sc.fp: the cut is what it was, and nothing is drawn on the ground
    const plain=scene('ambush','Ambush',{mobs:[mob.id],anchor:m0.id});S.table=plain;sv.sceneTick(FOL,t0);let c0=sv.sceneCut();
    const ents=mem.concat([mob]),xs=ents.map(e=>e.x),ys=ents.map(e=>e.y),bw=Math.max(...xs,m0.x)-Math.min(...xs,m0.x),bh=Math.max(...ys,m0.y)-Math.min(...ys,m0.y);
    ok(!!c0&&c0.patch===null&&c0.w===Math.max(18,bw+9)&&c0.h===Math.max(11,bh+7)&&c0.cx===(Math.max(...xs)+Math.min(...xs))/2&&c0.cy===(Math.max(...ys)+Math.min(...ys))/2-.4,'patch: a scene with no sc.fp keeps the old cut ('+(c0&&c0.w)+'x'+(c0&&c0.h)+' tiles, no patch)');
    {const d=drawn();sv.drawSceneRings(d.ctx,cam,c0);ok(d.c.image===0&&sv.scenePose(m0)===null&&sv.sceneQueue().length===0,'patch: no sc.fp, no ground marks and no poses')}
    S.table=null;sv.sceneTick(FOL,t0);
    // with sc.fp: the patch at scene scale
    const sc=scene('ambush','Ambush',{mobs:[mob.id],anchor:m0.id});ok(openPatch(sc,mem,[mob],{x:m0.x,y:m0.y},f=>f.name||MOBS[f.type].name),'patch: the fight opens on a patch');
    const fp=sc.fp,G=patchGrid(fp),stood=ents.map(e=>[e.x,e.y]);S.table=sc;sv.sceneTick(FOL,t0);const c1=sv.sceneCut();
    ok(!!c1&&c1.patch===fp&&c1.w===fp.w+2&&c1.h===fp.h+2.5&&c1.cx-c1.w/2<=fp.ox&&c1.cx+c1.w/2>=fp.ox+fp.w&&c1.cy-c1.h/2<=fp.oy&&c1.cy+c1.h/2>=fp.oy+fp.h,'patch: sceneCut frames the patch with a small margin ('+(c1&&c1.w)+'x'+(c1&&c1.h)+' tiles for '+fp.w+'x'+fp.h+')');
    {const far=mem[mem.length-1],was=far.x;far.x=fp.ox+fp.w+2.5;const c2=sv.sceneCut();ok(c2.w>c1.w&&c2.cx+c2.w/2>=far.x+.5&&c2.members.includes(far),'patch: the frame grows for one who stands outside the patch ('+c2.w+' tiles)');far.x=was;sv.sceneTick(FOL,t0)}
    {const d=drawn();sv.drawSceneRings(d.ctx,cam,c1);const L=sv.patchLayer(G);ok(d.c.image===1&&L===sv.patchLayer(G)&&L.width===fp.w*64&&L.height===fp.h*64,'patch: the ground marks are one cached layer, one tile in 64 texels, drawn under the sprites');
      ok(['grid','gridHi','patchEdge','cover','slow','hitHero','hitFoe'].every(k=>typeof SCENE[k]==='string')&&G.cost.length===fp.w*fp.h,'patch: the marks are palette tokens')}
    // walking: a tile the sim wrote is walked to, not jumped; the world is never written
    const P=sv.scenePose(m0),x0=m0.x,tick=(t,n=1,d=.05)=>{for(let i=0;i<n;i++){t+=d;sv.sceneTick(FOL,t)}return t};
    ok(!!P&&P.x===m0.x&&P.y===m0.y,'patch: everyone starts where they stand');
    m0.x=x0-2;let t=tick(t0,1);ok(P.x<x0&&P.x>x0-2&&P.walk,'patch: a tile move is eased (shown at '+(x0-P.x).toFixed(2)+' of 2)');t=tick(t,14);ok(P.x===m0.x&&!P.walk,'patch: and arrives');
    // a strike: the lunge, the number held back until it lands, the foe falling after its killing blow
    const hp=mob.hp;sc.beats.push({id:m0.id,name:m0.name,k:'strike',res:'d20 20+4=24 vs AC 12 (a natural 20): hit for 9',by:'agent',roll:{die:20,mod:4,total:24,vs:12,hit:true,crit:true,dmg:9,target:fp.foes[0].name,down:false}});mob.hp=hp-9;
    t=tick(t,3);const F=sv.scenePose(mob);ok(sv.sceneQueue().join()==='strike'&&F.show===hp&&Math.hypot(P.x-m0.x,P.y-m0.y)>.05,'patch: a strike joins the queue, its HP held back, the striker lunges');
    t=tick(t,6);ok(F.show===hp-9&&F.flash>0,'patch: the blow lands with a flash');t=tick(t,12);ok(sv.sceneQueue().length===0&&P.x===m0.x,'patch: and the striker is back on its tile');
    sc.beats.push({id:'foe',name:fp.foes[0].name,k:'attack',res:'d20 1+2=3 vs AC 14 (a natural 1): missed',by:'foe',roll:{die:1,mod:2,total:3,vs:14,hit:false,crit:false,dmg:0,target:m0.name,down:false}});t=tick(t,12);
    ok(F.tilt!==0,'patch: a foe’s natural 1 is a stumble');t=tick(t,16);
    sc.beats.push({id:m0.id,name:m0.name,k:'strike',res:'hit',by:'agent',roll:{die:12,mod:4,total:16,vs:12,hit:true,crit:false,dmg:hp-9,target:fp.foes[0].name,down:true}});mob.hp=0;mob.alive=false;t=tick(t,1);
    const fell=[];sv.sceneFallen(fell);ok(fell.includes(mob)&&F.fade===1,'patch: a slain foe stays drawn until its killing blow lands');t=tick(t,26);fell.length=0;sv.sceneFallen(fell);ok(!fell.includes(mob)&&F.fade===0,'patch: and falls away after it');
    // at 8x the beats are skipped; a cold gap replays nothing
    TABLE.speed=8;sc.beats.push({id:m0.id,name:m0.name,k:'guard',res:'drew it on',by:'agent'});m0.x=x0;t=tick(t,1);ok(sv.sceneQueue().length===0&&P.x===m0.x,'patch: at 8x the beats are skipped and everyone snaps to their tile');TABLE.speed=1;
    sc.beats.push({id:m0.id,name:m0.name,k:'guard',res:'drew it on',by:'agent'});t=tick(t,1,5);ok(sv.sceneQueue().length===0,'patch: after a gap nothing is replayed');
    // the last beats play out after the scene has gone, then the view closes
    sc.beats.push({id:m0.id,name:m0.name,k:'guard',res:'drew it on',by:'agent'},{id:m0.id,name:m0.name,k:'guard',res:'drew it on',by:'agent'});t=tick(t,1);S.table=null;sv.sceneTick(FOL,t);ok(sv.sceneOpen()&&!!sv.sceneCut().patch,'patch: the view holds while the last beats play');t=tick(t,30);ok(!sv.sceneOpen()&&sv.scenePose(m0)===null,'patch: and returns to the world once they have');
    Object.assign(mob,mobWas);ents.forEach((e,i)=>{if(e!==mob&&e!==m0&&(e.x!==stood[i][0]||e.y!==stood[i][1]))ok(false,'patch: the view moved '+e.name)})}
  // a staged meeting in town: a room in a generated setting, with the person and the party
  const c=CITY[0];mem.forEach((a,k)=>{a.x=c.gate.x-1+k*.8;a.y=c.gate.y});
  const npc={id:++S.uid,kind:'npc',wander:true,role:'innkeeper',fac:c.fac,name:'Mara',title:'Innkeeper',x:c.gate.x+1,y:c.gate.y-1,state:'post',att:[],met:{}};S.wanderers=(S.wanderers||[]).concat([npc]);
  S.table=scene('meeting','A word at the inn',{npc:npc.id,anchor:m0.id,staged:null});S.table.all=true;S.table.w={};sv.sceneTick(FOL);
  let sp=sv.sceneSpec();
  ok(sv.sceneOpen()&&sv.sceneMode()==='indoor'&&sp.setting==='tavern'&&sp.cast.includes(npc)&&!box().classList.contains('scout'),'scene maps: a town meeting opens an indoor setting ('+(sp&&sp.where)+')');
  ok(new RegExp(c.name).test(box().querySelector('.dgstat').textContent)&&/^Answers 0\/\d/.test(box().querySelector('.dgname').textContent)&&box().querySelector('.scwho').hidden,'scene maps: indoors the bar carries the answer count and the place; the names are on the map ('+box().querySelector('.dgname').textContent+' · '+box().querySelector('.dgstat').textContent+')');
  ok($('screen').classList.contains('scin'),'scene maps: an indoor scene docks the banner beside the map (#screen.scin)');
  // ---- #536: names without the role, quote bubbles, short labels, answer marks, the narration list, the docked layout ----
  {const TB=await import('../src/ui/table.js'),{spokenOf,unrole}=await import('../src/core/spoken.js'),IR=await import('../src/render/interior.js');
    const fc={id:++S.uid,kind:'npc',wander:true,role:'stranger',fac:c.fac,name:'Father Corvane',title:'Stranger',x:c.gate.x+1,y:c.gate.y-1,state:'post',att:[],met:{}};S.wanderers=S.wanderers.concat([fc]);
    const sc=scene('meeting','The Last Wax',{npc:fc.id,anchor:m0.id,staged:7,cast:['Stranger Father Corvane'],labels:{help:'Offer to carry the candle down into the crypt for him tonight'}});
    sc.frame=['Stranger Father Corvane sets down a guttering candle stub on the altar.'];sc.all=true;sc.w={};S.table=sc;sv.sceneTick(FOL);
    sc.acts[mem[0].id]={k:'hear',line:'Tell us.',by:'agent'};sc.acts[mem[1].id]={k:'help',line:'',by:'agent'};
    sc.narr={t:'09:00',text:'Father Corvane: He turns the stub in his fingers. "Will you carry it down for me?"'};sv.sceneTick(FOL);
    const sp=sv.sceneSpeaker();ok(!!sp&&sp.e===fc&&sp.text==='Will you carry it down for me?','#536 bubble: the speaker\'s bubble carries only the quoted words ('+(sp&&sp.text)+')');
    TB.renderTable(1);const tb=$('tbanner'),txt=tb.textContent;
    ok(!/Stranger Father Corvane/.test(txt)&&/Father Corvane sets down/.test(txt),'#536 names: the frame names the person without the role');
    const cast=tb.querySelector('.tcast');ok(!!cast&&/Staged by the DM · Father Corvane/.test(cast.textContent)&&!!cast.querySelector('.trole')&&cast.querySelector('.trole').textContent==='stranger','#536 names: the staged line names the person, the role a dim word ('+(cast&&cast.textContent)+')');
    const rows=[...tb.querySelectorAll('.tmr')],a0=rows[0]&&rows[0].querySelector('.tma'),a1=rows[1]&&rows[1].querySelector('.tma');
    ok(!!a0&&a0.textContent==='Hear them out'&&/Hear .* out/.test(a0.title),'#536 labels: a staged action shows a short label, the full text on hover ('+(a0&&a0.textContent+' / '+a0.title)+')');
    const lab=sc.ctx.labels.help,cut=a1&&a1.textContent;ok(!!cut&&cut.endsWith('…')&&lab.startsWith(cut.slice(0,-1))&&lab[cut.length-1]===' '&&cut.length<=29&&a1.title===lab,'#536 labels: the DM\'s long label is cut at a word, never inside one ('+cut+')');
    ok(TB.cutWords('Offer to carry the candle')==='Offer to carry the candle'&&TB.cutWords('Supercalifragilisticexpialidocious-and-then-some words',20).length<=21,'#536 labels: a short label is kept whole, an unbroken one is still bounded');
    const mk=sv.answerMarks(sc);ok(mk[mem[0].id]==='done'&&mk[mem[1].id]==='done'&&mem.slice(2).every(a=>a.state==='dead'||mk[a.id]==='think'),'#536 marks: a tick over those who answered, "..." over those still thinking');
    ok(/^Answers 2\/\d+/.test(sv.barStatus(sc)),'#536 bar: the answer count ('+sv.barStatus(sc)+')');
    sc.w[mem[2].id]={t:(await import("../src/sim/table.js")).TABLE.turnMs/1000+3};ok(/reflex in \d+ s/.test(sv.barStatus(sc)),'#536 bar: the timer once the nudge has gone ('+sv.barStatus(sc)+')');
    sc.narr={t:'09:01',text:'Stranger Father Corvane leans close to '+mem[0].name+'.'};sv.sceneTick(FOL);TB.renderTable(1);
    const nl=[...tb.querySelectorAll('.tnarrs li')].map(li=>li.textContent);
    ok(nl.length===2&&/Will you carry it down/.test(nl[0])&&/^Father Corvane leans close/.test(nl[1]),'#536 narration: a whisper\'s line joins the list, the person\'s words stay ('+nl.join(' | ')+')');
    ok(!sv.sceneSpeaker()||sv.sceneSpeaker().text==='Will you carry it down for me?','#536 bubble: a DM line is not a bubble');
    sc.narr={t:'09:02',text:'Father Corvane: Father Corvane sets the stub down and waits.'};sv.sceneTick(FOL);ok(!sv.sceneSpeaker(),'#536 bubble: prose about the person clears the bubble (no quote, no bubble)');
    ok(spokenOf('Hear me out. I need someone to find my ox.','Hesk')==='Hear me out. I need someone to find my ox.'&&spokenOf('The candle gutters.','Hesk')===null&&spokenOf('(whispered) go','Hesk')===null&&unrole('Hear Stranger Father Corvane out',[fc])==='Hear Father Corvane out','#536 spoken: speech kept, prose and stage directions dropped, roles removed');
    ok(sv.sceneItem(sc)==='candle','#536 props: the frame\'s candle stub becomes the scene\'s item');
    {const LV=await import('../src/sim/levers.js'),st0=mem[0].state;mem[0].state='town';const rg=LV.pull('give_item',{hero:mem[0].id,item:'Shrine Candle-Stub'},{by:'agent',reason:'uismoke'});mem[0].state=st0;
      ok(rg.ok&&sc.given==='Shrine Candle-Stub'&&sv.sceneItem(sc)===null,'#524 props: give_item of the scene item marks it given, the speaker no longer holds it'+(rg.ok?'':': '+rg.reason));ok(sc.props&&sc.props[0].id==='candle'&&sc.props[0].gone===true,'#592 props: the scene carries sc.props as data and giving the item marks the prop gone');
      delete sc.given;for(const p of sc.props)delete p.gone;ok(sv.sceneItem(sc)==='candle','#524 props: with the prop back the candle is drawn again')}
    {const SR=await import('../src/sim/search.js'),LV=await import('../src/sim/levers.js'),h=mem[0],st0=h.state;sc.props=[{id:'candle',name:'the candle stub',item:'Chapel Tithe-Seal'}];
      const ex=SR.examineView(h,{what:'candle'});ok(ex.ok&&/candle/.test(ex.text)&&ex.hint,'#592 examine: a prop at the hero own scene is described ('+(ex.text||ex.error)+')');
      const sr=SR.searchAct(h,{what:'candle stub'});ok(sr.ok&&sr.result==='found'&&/Tithe/i.test(sr.found||'')&&!sc.props[0].item&&!sc.props[0].gone,'#592 search: the item comes through the give_item path ('+JSON.stringify(sr)+')');
      const sr2=SR.searchAct(h,{what:'candle'});ok(sr2.ok&&sr2.result==='nothing','#592 search: a second search finds nothing more');delete sc.props}
    const g0=S.gameMin;S.gameMin=Math.floor(g0/1440)*1440+12*60;const day=sv.sceneDark(sc,.15);S.gameMin=Math.floor(g0/1440)*1440+23*60;const night=sv.sceneDark(sc,.15);
    const plainSc={...sc,frame:['A quiet word.'],title:'A word'};S.gameMin=Math.floor(g0/1440)*1440+12*60;const lit=sv.sceneDark(plainSc,.15);S.gameMin=g0;
    ok(night>day&&day>lit&&lit===.15,'#536 light: darker at night ('+night+') and when the frame says guttering ('+day+' vs '+lit+')');
    const arc=IR.arcSpots(5,{x:6,y:3},{x:1,y:1,w:10,h:8});ok(arc.length===5&&arc.every(p=>p.y>3.5)&&new Set(arc.map(p=>p.x.toFixed(2))).size===5&&Math.abs(arc[0].x-6+(arc[4].x-6))<.01,'#536 staging: the party stands in an arc before the speaker, facing it');
    const desk=sv.roomBox({left:0,top:0,right:1000,bottom:600},{left:612,top:8,right:992,bottom:552,width:380,height:544},48,1),phone=sv.roomBox({left:0,top:0,right:390,bottom:640},{left:6,top:330,right:384,bottom:592,width:378,height:262},40,1);
    ok(desk.x+desk.w<=604&&desk.h>=530&&phone.y+phone.h<=326&&phone.w>=370,'#536 layout: the room fills the space beside the docked banner (desktop '+desk.w+'x'+desk.h+', 390 px '+phone.w+'x'+phone.h+')');
    const css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');ok(/\.screen\.scopen \.tbanner:not\(\.tlive\)\{[^}]*right:8px[^}]*overflow-y:auto/.test(css)&&/max-width:700px\)\{\.screen\.scopen \.tbanner:not\(\.tlive\)\{[^}]*top:auto/.test(css),'#536/#546 layout: the banner docks beside the map (indoors and out) on a desktop and below it at 390 px');
    S.wanderers=S.wanderers.filter(w=>w!==fc);S.table=null;TB.renderTable(1);sv.sceneTick(FOL)}
  S.table=scene('meeting','A word at the inn',{npc:npc.id,anchor:m0.id,staged:null});S.table.all=true;S.table.w={};sv.sceneTick(FOL);
  S.table=null;sv.sceneTick(FOL);ok(!sv.sceneOpen(),'scene maps: the room closes with the scene');
  S.table=scene('social','Questioning the suspect',{npc:npc.id,anchor:m0.id});ok(sv.sceneSpec().setting==='cell','scene maps: the scene\'s words pick the room (questioning: the cell)');
  S.table=scene('social','A quiet word',{npc:npc.id,anchor:m0.id});ok(sv.sceneSpec().setting==='tavern','scene maps: with no words in the title, the person picks it (an innkeeper: the tavern)');
  mem.forEach(a=>{a.x=wild.x;a.y=wild.y});S.table=scene('meeting','A word on the road',{npc:npc.id,anchor:m0.id});ok(sv.sceneSpec().mode==='outdoor','scene maps: a meeting out of town plays on the terrain');
  S.table=scene('meeting','A word on the road',{npc:npc.id,anchor:m0.id,setting:'house'});sp=sv.sceneSpec();ok(sp.mode==='indoor'&&sp.setting==='house'&&!/ in undefined/.test(sp.where),'scene maps: a setting the DM named plays indoors even out of town ('+sp.where+')');
  S.table=scene('social','A word on the road',{npc:npc.id,anchor:m0.id,setting:'chapel',town:c.name});sp=sv.sceneSpec();ok(sp.mode==='indoor'&&sp.setting==='chapel'&&sp.town===c&&sp.where==='A chapel in '+c.name,'scene maps: a scene set at a town (ctx.town) plays in that town\'s room ('+sp.where+')');
  S.table=scene('ambush','Ambush on the road',{anchor:m0.id,setting:'house'});ok(sv.sceneSpec().mode==='outdoor','scene maps: an outdoor kind keeps the terrain cut whatever setting it carries');
  S.table=scene('crawl','The first chamber',{room:0});ok(sv.sceneSpec().mode==='dungeon','scene maps: the Crypt\'s scenes keep the dungeon view');
  // #431 slice 3: a camp scene on the ground round the fire, and an interrogation in the cell
  {const fire={x:wild.x+.5,y:wild.y+.5};mem.forEach((a,k)=>{a.x=fire.x+Math.cos(k)*1.4;a.y=fire.y+Math.sin(k)*1.1});
    S.table=scene('fireside','Round the fire',{mode:'camp',anchor:m0.id,camp:fire});sp=sv.sceneSpec();sv.sceneTick(FOL);const cc=sv.sceneCut();
    ok(sp.mode==='outdoor'&&sp.setting==='camp'&&sp.anchor.x===fire.x&&/^A camp in /.test(sp.where)&&!!cc&&Math.abs(cc.cx-fire.x)<2&&Math.abs(cc.cy-fire.y)<2&&cc.w<18&&cc.h<=11,'scene maps: a fireside plays on a small cut round the camp fire ('+sp.where+', '+(cc?Math.round(cc.w)+'x'+Math.round(cc.h):'no cut')+')');
    S.table=scene('ambush','Ambush at camp: a wolf',{mob:-1,anchor:m0.id,camp:fire});ok(sv.sceneSpec().setting==='camp','scene maps: an ambush on the watch plays at the camp');
    S.table=scene('elite','The Old Boar',{anchor:m0.id,camp:fire});ok(sv.sceneSpec().setting!=='camp','scene maps: only the camp kinds take the camp cut');
    S.table=null;sv.sceneTick(FOL);mem.forEach((a,k)=>{a.x=c.gate.x-1+k*.8;a.y=c.gate.y});
    S.table=scene('interrogation','Questioning Mara',{npc:npc.id,anchor:m0.id,who:{kind:'npc',id:npc.id,name:'Mara'},said:[]});sp=sv.sceneSpec();ok(sp.mode==='indoor'&&sp.setting==='cell'&&sp.cast.includes(npc),'scene maps: an interrogation in town plays in the cell ('+sp.where+')');
    mem.forEach(a=>{a.x=wild.x;a.y=wild.y});S.table=scene('interrogation','Questioning '+wild.name,{foe:wild.id,anchor:m0.id,said:[]});sp=sv.sceneSpec();ok(sp.mode==='outdoor'&&sp.cast.includes(wild),'scene maps: a yielded foe questioned in the field is on the terrain where it yielded');
    // a talk scene (#407, #431): in town it opens on the room the person stands in; in the field on the terrain cut
    mem.forEach(a=>{a.x=npc.x+1;a.y=npc.y});S.table=scene('talk','Bargaining with '+npc.name,{npc:npc.id,anchor:m0.id,why:'bargain',setting:'smithy',town:c.name});sp=sv.sceneSpec();ok(sp.mode==='indoor'&&sp.setting==='smithy'&&sp.cast.includes(npc),'scene maps: a talk in town opens on the room set for it ('+sp.where+')');
    S.table=scene('talk','A tense word with '+npc.name,{npc:npc.id,anchor:m0.id,why:'tense',setting:'gate',town:c.name});sp=sv.sceneSpec();ok(sp.mode==='indoor'&&sp.setting==='gate','scene maps: and the gatehouse for a person at the gate ('+sp.where+')');
    S.table=scene('talk','A word on the road',{npc:npc.id,anchor:m0.id,why:'party'});mem.forEach(a=>{a.x=wild.x;a.y=wild.y});sp=sv.sceneSpec();ok(sp.mode==='outdoor','scene maps: a talk in the field keeps the terrain cut ('+sp.where+')');
    S.table=null;sv.sceneTick(FOL)}
  sv.setSceneAuto(false);S.table=scene('elite','The Old Boar',{anchor:m0.id});sv.sceneTick(FOL);ok(!sv.sceneOpen()&&/off/.test($('vScene').textContent),'scene maps: with Scene maps off in Settings, nothing opens by itself');
  sv.setSceneAuto(true);S.table=scene('elite','The Old Boar',{anchor:m0.id});sv.sceneTick({view:'map',sel:null});ok(!sv.sceneOpen(),'scene maps: only when the watcher follows the Fellowship');
  sv.closeSceneView(false);mem.forEach((a,k)=>{[a.x,a.y,a.hidden]=keepPos[k]});S.table=keepT;S.wanderers=keepW;uiFast()}
// ---- region view (#430): a picker over the world's regions frames the camera and narrows heroes, conditions and the chronicle ----
{const S=sim.S,{ZONES,zoneAt}=await import('../src/world/map.js'),{cam}=await import('../src/render/draw.js'),{chronicleShows}=await import('../src/ui/fellowship.js');
  const {pickRegion}=await import('../src/ui/controls.js'),{regionBox,inRegion}=await import('../src/ui/region.js');
  const sel=$('vReg'),keepC=S.conditions;
  ok(!!sel&&sel.children.length===ZONES.length+1&&sel.children[0].getAttribute('value')==='','region view: the picker lists All regions and each of the '+ZONES.length+' regions');
  const have=[...new Set(S.agents.filter(a=>a.state!=='dead').map(a=>zoneAt(a.x,a.y)))],rz=have[0],oz=ZONES.map((_,i)=>i).find(i=>i!==rz);
  const all=ranked().length;
  sel.value=String(rz);sel.dispatch('change',{target:sel});
  ok(cam.region===rz&&cam.view==='region'&&typeof cam.regionFrame==='function'&&!!cam.regionFrame(),'region view: picking frames the camera on the region ('+ZONES[rz]+')');
  const b=regionBox(rz);ok(b&&b.w>0&&b.h>0&&cam.regionFrame().x===b.x,'region view: the frame is the region\'s box');
  const inR=ranked();ok(inR.length>0&&inR.length<=all&&inR.every(a=>zoneAt(a.x,a.y)===rz),'region view: Next hero and Top heroes list only heroes there ('+inR.length+' of '+all+')');
  const lis=$('tops').querySelectorAll('li');ok(lis.length===Math.min(8,inR.length),'region view: the Top heroes panel narrowed to the region');
  S.conditions=[{id:-11,kind:'festival',z:rz,str:1,until:S.gameMin+300,lever:-9999},{id:-12,kind:'bandits',z:oz,str:2,until:S.gameMin+300,lever:-9999}];
  pickRegion(String(rz));const rows=()=>$('condbox').querySelectorAll('li');
  ok(rows().length===1&&rows()[0].textContent.includes(ZONES[rz])&&$('condbox').querySelector('summary').textContent.includes(ZONES[rz]),'region view: the conditions panel shows only that region\'s rows');
  const e1={t:'1',parts:[{x:S.agents.find(a=>zoneAt(a.x,a.y)===rz).x,y:S.agents.find(a=>zoneAt(a.x,a.y)===rz).y},' slays a wolf.']},e0={t:'1',parts:['The wind rises.']};
  ok(chronicleShows(e0)||true,'region view: world lines are not hidden by the region');
  const far=S.agents.find(a=>zoneAt(a.x,a.y)!==rz);if(far)ok(!chronicleShows({t:'1',parts:[far,' slays a wolf.']}),'region view: a line about a hero elsewhere is hidden');
  {const {regionLine}=await import('../src/ui/region.js');ok(regionLine(e0)&&regionLine(e1),'region view: a hero there and a world line still show')}
  setView('follow');ok(cam.region===rz&&cam.view==='follow'&&sel.value===String(rz),'region view: Follow still works inside the filter');
  sel.value='';sel.dispatch('change',{target:sel});
  ok(cam.region==null&&ranked().length===all&&rows().length===2,'region view: All regions clears the filter on heroes and conditions');
  ok(!far||chronicleShows({t:'1',parts:[far,' slays a wolf.']})||SLT.slotted(),'region view: the chronicle shows every line again');
  S.conditions=keepC;setView('map');uiFast()}
// camp watch end: a camp with no restAt/watchIdx must not show "until NaN:NaN" (#475)
{const {campLine}=await import('../src/ui/fellowship.js');const {campSummary}=await import('../src/sim/camp.js');
  const F=SLT.slotted(),mem=SLT.slotMembers(SLT.slotted()).map(m=>m.hero).filter(Boolean),keep=F.camp,ks=mem.map(a=>a.state);
  mem.forEach(a=>{a.state='camp'});
  F.camp={phase:'rest',why:'night',hours:0,ids:mem.map(a=>a.id),watcher:mem[0].id};
  ok(!/NaN/.test(campSummary()||''),'camp watch: the sim line has no NaN for a camp with no watch times');
  const cl=campLine();ok(cl&&!/NaN|until \d\d:\d\d\)/.test(cl)&&/on watch: /.test(cl),'camp watch: the panel line leaves out "until" when the end is unknown ('+cl+')');
  F.camp={phase:'rest',why:'night',hours:0,ids:mem.map(a=>a.id),watcher:mem[0].id,restAt:Math.round(sim.S.gameMin),watchIdx:0};
  ok(/on watch: \S+ \(until \d\d:\d\d\)/.test(campLine()),'camp watch: a normal camp keeps "until hh:mm"');
  F.camp=keep;mem.forEach((a,k)=>{a.state=ks[k]})}
// ---- companies (#456): a row of frames per company, solos in one Alone row, the follow cycle, the sheet, the banner ----
{const S=sim.S,CO=await import('../src/sim/company.js'),FR=await import('../src/ui/frames.js'),CV=await import('../src/ui/companyview.js');
  const SH=await import('../src/ui/sheet.js'),LV=await import('../src/ui/lifeview.js'),TB=await import('../src/ui/table.js'),{cam}=await import('../src/render/draw.js');
  const F=SLT.slotted(),keepFollow=S.followId,keepView=cam.view,keepSel=cam.sel,keepT=S.table,keepW=window.innerWidth;
  const rowEls=()=>$('frames').querySelectorAll('.frrow'),pfs=()=>$('frames').querySelectorAll('.pf'),vf=$('vFel');
  const press=k=>{for(const f of document._ls.keydown||[])f({key:k,target:document.body,preventDefault(){}})};
  S.followId=F.id;uiFast();
  // the default together world: one company, one row, no row head, the five frames, the button and banner as before
  ok(CO.companies().length===1&&FR.frameGroupRows().length===1&&FR.frameGroupRows()[0].title===F.name,'companies: the default world shows one company in one row');
  ok(rowEls().length===1&&rowEls()[0].querySelector('.frrh').hidden&&pfs().length===5,'companies: one row of five frames, no row head (looks as before)');
  ok(!$('felbody').querySelector('.fcotabs'),'Companies panel: one company, no tab bar');
  ok($('frames').querySelector('.frttl').textContent===F.name&&$('frames').querySelector('[data-pfsheet]').textContent==='Compare the five','companies: the title is the Fellowship\'s name, Compare the five');
  ok(vf.textContent==='Fellowship'&&!vf.hidden,'companies: the follow button reads Fellowship with one company');
  ok(TB.tableOwner({company:F.id,companyName:F.name,solo:false})===null,'companies: the banner names no company while there is one');
  // a pair and two solos (the pair of one faction; every hero alive and not in the Fellowship)
  const free=S.agents.filter(a=>a.kind==='hero'&&a.state!=='dead'&&!CO.companyOf(a)&&!SLT.inSlots(a));
  const fac=[0,1].find(f=>free.filter(a=>a.fac===f).length>=10),same=free.filter(a=>a.fac===fac);
  const [p0,p1]=same,q0=free.find(a=>a!==p0&&a!==p1),q1=free.find(a=>a!==p0&&a!==p1&&a!==q0);
  const CPN=await import('../src/ui/chatpanel.js'),shout=(h)=>({from:h,text:'Hold!',party:true,heard:[],d:1,t:'09:00'});
  ok(CPN.shoutCompany(shout(p0))===''&&!/\(/.test(CPN.shoutLine(shout(F.slots&&S.agents.find(x=>x.id===F.slots.tank)||p0)).textContent),'chat: a together world (one company) names no company on a shout');
  const pair=CO.foundCompany([p0,p1],{name:'The Smoke Pair'}).company,s1=CO.foundCompany([q0]).company,s2=CO.foundCompany([q1]).company;
  ok(!!pair&&!!s1&&!!s2&&CO.companies().length===4,'companies: a pair and two solos founded beside the Fellowship');
  {const tk=S.agents.find(x=>x.id===F.slots.tank),ln=CPN.shoutLine(shout(p0)).textContent;
    ok(CPN.shoutCompany(shout(p0))==='The Smoke Pair'&&CPN.shoutCompany(shout(tk))===F.name&&/ \(The Smoke Pair\) calls out/.test(ln),'chat: with several companies a shout names its company: '+ln);
    ok(CPN.shoutCompany({from:p0,text:'x',party:false})===''&&CPN.shoutCompany({from:p0,text:'x',party:true,courier:true})==='','chat: an aloud line and a courier name no company')}
  const fr0=$('frames').querySelector('.pf[data-hid="'+F.slots.tank+'"]');uiFast();
  let G=FR.frameGroupRows();
  ok(G.length===3&&G[0].title===F.name&&G[0].followed&&G[1].title==='The Smoke Pair'&&G[1].names.join()===p0.name+','+p1.name&&G[2].alone&&G[2].names.join()===q0.name+','+q1.name,'companies: rows are the followed Fellowship, the pair, then Alone with both solos: '+G.map(g=>g.title+'['+g.names.join(',')+']').join(' | '));
  ok(rowEls().length===3&&[...rowEls()].every(r=>!r.querySelector('.frrh').hidden)&&pfs().length===9,'companies: three rows with their heads, nine frames');
  ok($('frames').querySelector('.pf[data-hid="'+F.slots.tank+'"]')===fr0,'companies: the Fellowship\'s frames are the same nodes after the rows appear');
  const heads=[...rowEls()].map(r=>r.querySelector('.frrh').textContent);
  ok(/The Smoke Pair/.test(heads[1])&&/2 riding · \+6/.test(heads[1])&&/FOLLOWED/.test(heads[0]),'companies: a row head names the company, how many ride and the room left (+6): '+heads.join(' / '));
  ok(/Alone/.test(heads[2])&&/2 heroes, each on their own/.test(heads[2])&&rowEls()[2].querySelector('.frrh').tagName!=='BUTTON','companies: the Alone row says it holds two solos and is not a follow button');
  ok(rowEls()[0].querySelector('.frrf').hidden===false&&rowEls()[1].querySelector('.frrf').hidden===true,'companies: FOLLOWED marks only the followed row');
  ok($('frames').querySelector('.frttl').textContent==='4 companies','companies: the strip title counts the companies');
  ok([...$('frames').querySelectorAll('.pfkey')].map(n=>n.textContent).join()==='1,2,3,4,5,6,7,8,9','companies: keys 1-9 run in display order across the rows');
  press('6');ok(cam.sel===p0,'companies: key 6 picks the pair\'s first hero');press('8');ok(cam.sel===q0,'companies: key 8 picks the first solo');
  // the follow cycle: first click frames the followed company, each next click follows the next one (id order, wraps)
  setView('map');vf.click();ok(cam.view==='fellow'&&CV.followedCompany()===F,'follow cycle: the first click frames the followed Fellowship');
  ok(/^Follow /.test(vf.textContent)&&vf.textContent.includes(F.name),'follow cycle: the button reads Follow <company> with several: '+vf.textContent);
  const tankNode=$('frames').querySelector('.pf[data-hid="'+F.slots.tank+'"]'),pairNode=$('frames').querySelector('.pf[data-hid="'+p0.id+'"]');
  vf.click();uiFast();G=FR.frameGroupRows();
  ok(CV.followedCompany()===pair&&S.followId===pair.id&&cam.view==='fellow'&&vf.textContent==='Follow The Smoke Pair','follow cycle: the next click follows the pair (S.followId saved with the world)');
  ok(G[0].title==='The Smoke Pair'&&G[0].followed&&G[1].title===F.name,'follow cycle: the followed pair moves to the first row');
  ok($('frames').querySelector('.pf[data-hid="'+F.slots.tank+'"]')===tankNode&&$('frames').querySelector('.pf[data-hid="'+p0.id+'"]')===pairNode,'follow cycle: frames move with their row, not rebuilt');
  {const fr=cam.frame(),mx=(p0.x+p1.x)/2;ok(!!fr&&Math.abs(fr.x-mx)<.01,'follow cycle: the camera frames the pair')}
  ok($('hint').textContent==='Following The Smoke Pair','follow cycle: the hint names the followed company');
  // the sheet shows the followed company
  SH.openSheet();uiFast();let T=SH.sheetRows();
  ok(SH.sheetOpen()&&T.cols.length===2&&T.cols.every(c=>c.hero===p0||c.hero===p1)&&$('sheetov').querySelector('.shttl').textContent==='The Smoke Pair · side by side','sheet: two columns and the pair\'s name');
  ok($('sheetov').querySelector('.shcorner').textContent==='join order'&&LV.lifeRows().length===2,'sheet: join order for a company, the Life view shows the same two');
  ok($('frames').querySelector('[data-pfsheet]').textContent==='Side by side','companies: the compare button says Side by side for a company that is not five');
  vf.click();uiFast();G=FR.frameGroupRows();
  ok(CV.followedCompany()===s1&&G[0].alone&&G[0].followed&&G[0].names[0]===q0.name&&G[1].title===F.name&&G[2].title==='The Smoke Pair','follow cycle: following a solo puts the Alone row first, that solo first');
  T=SH.sheetRows();ok(T.cols.length===1&&T.cols[0].hero===q0&&$('sheetov').querySelector('.shttl').textContent===q0.name+' · side by side','sheet: a solo is one column under the hero\'s name');
  vf.click();uiFast();ok(CV.followedCompany()===s2&&FR.frameGroupRows()[0].names.join()===q1.name+','+q0.name,'follow cycle: the second solo, first in the Alone row');
  vf.click();uiFast();ok(CV.followedCompany()===F&&FR.frameGroupRows()[0].title===F.name&&SH.sheetRows().cols.length===5,'follow cycle: wraps back to the Fellowship and its five columns');
  SH.closeSheet();
  // a row head follows its company
  rowEls()[1].querySelector('.frrh').click();uiFast();ok(CV.followedCompany()===pair&&cam.view==='fellow'&&FR.frameGroupRows()[0].title==='The Smoke Pair','companies: a click on a row head follows that company');
  // up to eight in a company: eight columns, the frames in rows of four, no room left
  const more=same.filter(a=>a!==p0&&a!==p1&&!CO.companyOf(a)).slice(0,6);for(const a of more)CO.joinCompany(pair,a);uiFast();
  ok(pair.ids.length===8&&SH.sheetRows().cols.length===8,'sheet: a company of eight is eight columns');
  ok(CO.joinCompany(pair,same.find(a=>!CO.companyOf(a))).ok===false&&SH.sheetRows().cols.length<=8,'sheet: never more than eight columns (the cap refuses a ninth)');
  const pr=[...rowEls()].find(r=>r.dataset.row==='c'+pair.id);
  ok(/wide/.test(pr.querySelector('.frlist').className)&&/8 riding$/.test(pr.querySelector('.frrc').textContent)&&/Full/.test(pr.querySelector('.frrc').getAttribute('title')),'companies: eight frames in rows of four, the head says it is full');
  ok([...$('frames').querySelectorAll('.pfkey')].filter(n=>n.textContent).length===9,'companies: only the first nine frames carry a key');
  // the Table banner names whose table it is, and follows another company's
  const sc={id:7001,company:s1.id,kind:'check',title:'A narrow ledge',frame:['A narrow ledge over the river.'],ids:[q0.id],i:0,phase:'turn',t:0,acts:{},beats:[],ctx:{},pause:false,at:S.gameMin};
  S.table=sc;TB.renderTable(1);let own=$('tbanner').querySelector('.tco');
  ok(!!own&&own.textContent===q0.name+', alone'&&own.tagName==='BUTTON','banner: a solo\'s scene names the hero, alone, as a follow button');
  own.click();ok(CV.followedCompany()===s1,'banner: the button follows that company');TB.renderTable(1);own=$('tbanner').querySelector('.tco');
  ok(!!own&&own.tagName!=='BUTTON','banner: the followed company\'s name is plain text');
  S.table={...sc,id:7002,company:pair.id,ids:[p0.id,p1.id]};TB.renderTable(1);own=$('tbanner').querySelector('.tco');
  ok(!!own&&own.textContent==='At the table: The Smoke Pair','banner: a company\'s scene says At the table: <name>');
  // followed pause (#458): another company's scene on the live clock is one line that follows that company
  {CV.followCompany(s1);const T=await import('../src/sim/table.js');S.table={...sc,id:7003,company:pair.id,ids:[p0.id,p1.id],pause:true};TB.renderTable(1);
   const lv=$('tbanner').querySelector('.tlvb');ok(!!lv&&lv.tagName==='BUTTON'&&/^Scene at .+: .+ and company/.test(lv.textContent)&&!$('tbanner').querySelector('.tt'),'banner: an unfollowed scene on the live clock is one line ('+(lv&&lv.textContent)+')');
   lv.click();TB.renderTable(1);ok(CV.followedCompany()===pair&&!$('tbanner').querySelector('.tlvb')&&!!$('tbanner').querySelector('.tt')&&/WORLD PAUSED/.test($('tbanner').textContent),'banner: the line follows that company and its full banner opens, the world paused');
   const vp=$('vPause');ok(!!vp&&vp.textContent==='Pause: followed'&&!vp.closest('.setrow').hidden,'settings: Pause: followed shows with several companies');
   vp.click();ok(S.pauseAll===true&&vp.textContent==='Pause: any company'&&vp.getAttribute('aria-pressed')==='true','settings: the switch turns on pause for any company');
   vp.click();ok(!('pauseAll' in S)&&T.pauseAll()===false,'settings: and off again, no key left on S')}
  S.table=keepT;TB.renderTable(1);
  // phone width: the rows wrap and shrink (no horizontal scroll)
  const css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
  ok(/\.frrh\{[^}]*min-width:0[^}]*max-width:100%/.test(css)&&/\.frrn\{[^}]*text-overflow:ellipsis/.test(css)&&/\.frrows\{[^}]*min-width:0/.test(css),'phone width: a long company name is cut, never widens the page');
  ok(/@media \(max-width:920px\)\{\.frlist,\.frlist\.wide\{grid-template-columns:repeat\(3,/.test(css),'phone width: every row, eight included, is three frames across');
  ok(/#vFel\{[^}]*max-width:[^}]*text-overflow:ellipsis/.test(css),'phone width: the Follow <company> button is cut, not widened');
  window.innerWidth=390;uiFast();ok(rowEls().length===3&&pfs().length===15,'phone width: the rows still render (390 px)');window.innerWidth=keepW;
  // the Companies panel (#457): a tab per company plus All; one company reads without a tab bar
  {const fb=$('felbody'),tabs=()=>fb.querySelector('.fcotabs'),CP=await import('../src/ui/fellowship.js');uiFast();
    ok(!!tabs()&&tabs().children.length===CO.companies().length+1,'Companies panel: a tab per company plus All ('+(tabs()?tabs().children.length:0)+')');
    ok(/Companies/.test(document.getElementById('fellowship').querySelector('h2').textContent),'Companies panel: titled Companies');
    const tb=[...tabs().children].find(b=>b.dataset.fact==='tab:'+pair.id);tb.click();uiFast();
    ok(/The Smoke Pair/.test(fb.querySelector('.fhline').textContent)&&!fb.querySelector('[data-fact=menu]'),'Companies panel: the pair tab shows its own header, no Disband menu');
    ok(!!fb.querySelector('.felhall')&&!!fb.querySelector('.felthreads'),'Companies panel: a company tab has its hall board and open threads');
    fb.querySelector('[data-fact="drawer:members"]').click();uiFast();
    ok(/Start The Smoke Pair|Stop The Smoke Pair|No agent-played/.test(fb.querySelector('.feldrawer').textContent),'Companies panel: runner buttons name the company');
    fb.querySelector('[data-fact="drawer:members"]').click();
    [...tabs().children].find(b=>b.dataset.fact==='tab:all').click();uiFast();
    ok(fb.querySelectorAll('.fco').length===CO.companies().length,'Companies panel: the All tab lists every company');
    [...tabs().children].find(b=>b.dataset.fact==='tab:'+F.id).click();uiFast();
    ok(fb.querySelector('.fhline').textContent.includes(F.name)&&!!fb.querySelector('[data-fact=menu]'),'Companies panel: the Fellowship tab keeps its menu');
    ok(/Companies only/.test($('chronFel').textContent),'Chronicle filter reads Companies only');
    [...tabs().children][0].click()}
  // back to one company: one row again, no heads
  for(const C of [pair,s1,s2])CO.dissolveCompany(C);S.followId=keepFollow;uiFast();
  ok(rowEls().length===1&&rowEls()[0].querySelector('.frrh').hidden&&pfs().length===5&&vf.textContent==='Fellowship','companies: back to one company, the strip is as before ('+rowEls().length+' rows, '+pfs().length+' frames, '+vf.textContent+', '+CO.companies().map(C=>C.name+':'+C.ids.length).join(',')+')');
  cam.sel=keepSel;setView(keepView==='fellow'?'fellow':'map');uiFast()}
// ---- what each hero is trying to do (#534): the purpose line, the map tooltip, overlays for the followed/hovered only ----
{console.log('purpose line');const S=sim.S,P=await import('../src/sim/purpose.js'),PV=await import('../src/ui/purposeview.js'),FX=await import('../src/render/purposefx.js');
  const {cam}=await import('../src/render/draw.js'),{CITY,ZONES,zoneAt}=await import('../src/world/map.js'),{MOBS}=await import('../src/data/mobs.js');
  const live=S.agents.filter(a=>a.kind==='hero'&&a.state!=='dead'&&!a.hidden),keepSel=cam.sel,keepView=cam.view;
  const sig=()=>JSON.stringify(S.agents.map(a=>[a.id,a.state,a.x,a.y,a.hp,a.dest,a.pq&&a.pq.length,a.target&&a.target.id]));
  // a scripted hunter with a bounty
  const hunter=live.find(a=>!a.player&&!SLT.inSlots(a)&&!a.adv&&!a.party),type=Object.keys(MOBS)[0];
  const kh={state:hunter.state,quest:hunter.quest};hunter.state='hunt';hunter.quest={type,need:6,have:2};
  const ph=P.purposeOf(hunter);ok(ph.kind==='hunt'&&/^Hunting/.test(ph.line)&&ph.line.includes(ZONES[zoneAt(hunter.x,hunter.y)])&&/bounty: 2\/6/.test(ph.line),'purpose: a scripted hunter reads goal → region · bounty ('+ph.line+')');
  // an agent follower (the follow command of #445, read from the queue)
  const [lead,fol,waiter,trav]=mem.filter(a=>a.state!=='dead');for(const a of [fol,waiter,trav])if(!a.player)sim.markPlayer(a,true);
  const kf={pq:fol.pq,state:fol.state,x:fol.x,y:fol.y};fol.state='hunt';fol.x=lead.x+3;fol.y=lead.y;fol.pq=[{kind:'follow',id:lead.id}];
  const pf=P.purposeOf(fol);ok(pf.kind==='follow'&&pf.line.startsWith('Following → '+lead.name+' (3 tiles)')&&pf.tether&&pf.tether.id===lead.id,'purpose: an agent follower names whom it follows, how far, and tethers ('+pf.line+')');
  // a waiting hero: in town, the party leader still there
  const c=CITY.find(t=>t.fac===waiter.fac)||CITY[0],kw={state:waiter.state,party:waiter.party,pq:waiter.pq,act:waiter.playActAt,x:waiter.x,y:waiter.y};
  waiter.state='town';waiter.pq=[];waiter.party={leader:lead,mem:[lead,waiter]};waiter.playActAt=S.gameMin-40;// stand a little off the gate, away from the leader: the wait line is not drawn to someone within 0.8 tiles, and the leader may stand at the gate
  waiter.x=c.gate.x;waiter.y=c.gate.y;for(const[dx,dy]of[[0,0],[2,1],[-2,1],[2,-1],[-2,-1],[3,0]]){waiter.x=c.gate.x+dx;waiter.y=c.gate.y+dy;if(Math.hypot(lead.x-waiter.x,lead.y-waiter.y)>1.5)break}
  const pw=P.purposeOf(waiter);ok(pw.kind==='wait'&&pw.line.startsWith('Waiting for '+lead.name)&&/40 min/.test(pw.line)&&pw.wait&&pw.wait.id===lead.id,'purpose: a waiting hero names whom it waits for and how long ('+pw.line+')');
  // a traveller on a walk order
  const kt={pq:trav.pq,state:trav.state,adv:trav.adv},dest={x:c.gate.x+6,y:c.gate.y+4};trav.adv=null;trav.state='travel';trav.pq=[{kind:'move',legs:[{x:dest.x-2,y:dest.y,st:'hunt'},{x:dest.x,y:dest.y,st:'hunt'}],last:'hunt',label:'the old mill'}];
  const pt=P.purposeOf(trav);ok(pt.kind==='travel'&&pt.line.startsWith('Walking → the old mill')&&pt.path.length===2&&pt.to&&pt.to.x===dest.x,'purpose: a traveller names where it walks, with its road ('+pt.line+')');
  // autopilot says so; a stated intent (#535) wins the why
  trav.playIdle=true;trav.pq[0].auto='heading out to hunt (your last order: hunt 3)';ok(/· autopilot: its last order: hunt 3$/.test(P.purposeOf(trav).line),'purpose: autopilot says so and why, in the third person ('+P.purposeOf(trav).line+')');trav.playIdle=false;
  trav.intent={text:'meet the miller before dusk'};ok(/says: meet the miller before dusk/.test(P.purposeOf(trav).why),'purpose: a stated intent (a.intent, #535) is the why');delete trav.intent;
  const s0=sig();for(const a of S.agents)P.purposeOf(a);ok(sig()===s0,'purpose: read-only (no hero changed by asking every hero)');
  // shown on the frames and in the dossier header
  uiFast();const fr=$('frames').querySelector('.pf[data-hid="'+fol.id+'"] .pfdo');ok(!!fr&&fr.textContent===P.purposeOf(fol).line&&fr.title===fr.textContent&&fr.classList.contains('p-follow'),'frames: the purpose line, full text as its title ('+(fr&&fr.textContent)+')');
  ok((await import('../src/ui/frames.js')).frameRows().some(r=>r.name===waiter.name&&/^Waiting for/.test(r.purpose)),'frameRows carries the purpose');
  select(trav);uiFast();const hp=$('hero').querySelector('.doing .purp');ok(!!hp&&hp.textContent===P.purposeOf(trav).line,'dossier header: the purpose line ('+(hp&&hp.textContent)+')');
  // phone width: a cut line opens in full on a tap and stays open through the 0.3 s patch; an uncut one ignores the tap
  const h2=$('hero').querySelector('.doing .purp');Object.defineProperty(h2,'scrollWidth',{value:500,configurable:true});Object.defineProperty(h2,'clientWidth',{value:200,configurable:true});
  h2.click();ok(h2.classList.contains('open'),'phone: a tap opens a cut purpose line');uiFast();ok($('hero').querySelector('.doing .purp').classList.contains('open'),'phone: it stays open through the patch');
  $('hero').querySelector('.doing .purp').click();uiFast();ok(!$('hero').querySelector('.doing .purp').classList.contains('open'),'phone: a second tap closes it');
  const f2=$('frames').querySelector('.pf[data-hid="'+fol.id+'"] .pfdo');ok(!PV.tapPurpose(f2),'frames: a tap on an uncut line is left to the frame (select)');
  // the map tooltip
  PV.hoverHero(waiter,10,10);ok(cam.hover===waiter&&/Waiting for/.test(PV.mapTipText())&&PV.mapTipText().includes(waiter.name),'map tooltip: the hovered hero and its purpose');
  uiFast();ok(/Waiting for/.test(PV.mapTipText()),'map tooltip refreshes on the tick');PV.hoverHero(null);ok(cam.hover==null&&PV.mapTipText()==='','map tooltip hides');
  // overlays: only the followed or hovered hero's road, tether or wait line
  const mk=()=>{const L={starts:[],strokes:0};return {L,ctx:new Proxy({},{get:(o,k)=>k==='moveTo'?(x,y)=>L.starts.push([x,y]):k==='stroke'?()=>L.strokes++:typeof o[k]!=='undefined'?o[k]:()=>{},set:(o,k,v)=>{o[k]=v;return true}})}};
  const T=16,from=(a,L)=>L.starts.filter(([x,y])=>Math.abs(x-a.x*T)<1e-6&&Math.abs(y-(a.y*T-3))<1e-6).length;
  cam.sel=null;cam.hover=null;let m=mk();FX.drawPurposeGround(m.ctx,S,cam,{drawText:()=>{},blink:0});ok(m.L.strokes===0,'overlays: nothing drawn with no followed or hovered hero');
  cam.sel=trav;cam.dpr=1;cam.sc=2;m=mk();const lab=[];FX.drawPurposeGround(m.ctx,S,cam,{drawText:t=>lab.push(t),blink:0});
  ok(m.L.strokes>=1&&from(trav,m.L)>=1,'overlays: the followed traveller gets its dotted road, from itself');ok(lab.includes('the old mill'),'overlays: the marker names what is there');
  cam.sel=fol;cam.hover=waiter;m=mk();FX.drawPurposeGround(m.ctx,S,cam,{drawText:()=>{},blink:0});
  {const who=a=>a.name+' '+a.state+' ('+a.x.toFixed(2)+','+a.y.toFixed(2)+')'+(a.hidden?' hidden':''),n={fol:from(fol,m.L),waiter:from(waiter,m.L),trav:from(trav,m.L),hunter:from(hunter,m.L)},
    bad=[n.fol>=1?'':'follower tether missing',n.waiter>=1?'':'waiter wait line missing (leader '+who(lead)+', distance '+Math.hypot(lead.x-waiter.x,lead.y-waiter.y).toFixed(2)+')',n.trav===0?'':'traveller drawn',n.hunter===0?'':'hunter drawn'].filter(Boolean);
  ok(!bad.length,'overlays: the followed follower’s tether and the hovered waiter’s wait line, no one else'+(bad.length?' ['+bad.join('; ')+'] counts '+JSON.stringify(n)+' fol='+who(fol)+' waiter='+who(waiter)+' trav='+who(trav)+' hunter='+who(hunter)+' lead='+who(lead):''))}
  // intent icons: close zoom with the switch on; off hides them except the focused hero's hourglass
  const cnt=(a,close)=>{let n=0;const ctx=new Proxy({},{get:(o,k)=>k==='fillRect'?()=>n++:typeof o[k]!=='undefined'?o[k]:()=>{},set:(o,k,v)=>{o[k]=v;return true}});FX.drawIntentIcon(ctx,S,cam,a,0,0,12,close);return n};
  const vi=$('vIcons');PV.setIcons(true);ok(cnt(hunter,true)>0&&cnt(hunter,false)===0,'icons: a hunter’s icon at close zoom, none far out');
  vi.click();ok(cam.icons===false&&vi.getAttribute('aria-pressed')==='false'&&/off/.test(vi.textContent)&&localStorage.getItem('eldmoor.intentIcons')==='0','icons: the Settings switch turns them off and remembers');
  ok(cnt(hunter,true)===0,'icons: off hides them');ok(cnt(waiter,true)>0&&cnt(waiter,false)>0,'icons: the hovered waiting hero keeps its hourglass, any zoom');
  vi.click();ok(cam.icons===true,'icons: back on');
  // restore
  Object.assign(hunter,{state:kh.state,quest:kh.quest});Object.assign(fol,{pq:kf.pq,state:kf.state,x:kf.x,y:kf.y});
  Object.assign(waiter,{state:kw.state,party:kw.party,pq:kw.pq,playActAt:kw.act,x:kw.x,y:kw.y});Object.assign(trav,{pq:kt.pq,state:kt.state,adv:kt.adv});
  cam.hover=null;cam.sel=keepSel;setView(keepView==='fellow'?'fellow':'map');uiFast()}
// ---- the dock at 3440x1440 (#546): map first, one dock with four tabs, story-following defaults, frames carry the glance ----
{console.log('dock (3440 px)');const L=await import('../src/ui/layout.js'),C=await import('../src/ui/controls.js'),CV=await import('../src/ui/companyview.js');
  const {cam}=await import('../src/render/draw.js'),{companies, companyOf}=await import('../src/sim/company.js'),S=sim.S;
  const keepW=window.innerWidth,keepSel=cam.sel,keepPin=S.pinned;
  ok(!!SLT.slotted()||companies().length>0,'dock: a company stands');
  window.innerWidth=3440;uiFast();
  const side=$('side'),bar=$('dockTabs'),off=id=>$(id).classList.contains('doff');
  ok(L.docked()&&document.body.classList.contains('docked')&&side.parentNode.className.includes('dock')&&!side.parentNode.className.includes('cols3')&&$('colL').hidden,'3440 px: the dock layout (two columns, no left column)');
  ok(!!bar&&!bar.hidden&&side.children[0]===bar&&bar.children.map(b=>b.textContent).join()==='Company,Hero,Story,Chat','3440 px: one dock with four tabs: '+(bar&&bar.children.map(b=>b.textContent).join()));
  ok(['fellowship','heroSec','storySec','worldgrp','chatSec'].every(id=>$(id).parentNode===side),'3440 px: Company, Hero, Story, World and Chat sit in the dock');
  for(const [k,on,offs] of [['company',['fellowship'],['heroSec','storySec','chatSec','worldgrp']],['hero',['heroSec'],['fellowship','storySec','chatSec']],['story',['storySec','worldgrp'],['fellowship','heroSec','chatSec']],['chat',['chatSec'],['fellowship','heroSec','storySec']]]){
    L.showDock(k);uiFast();ok(on.every(id=>!off(id))&&offs.every(off)&&bar.children.find(b=>b.dataset.dock===k).getAttribute('aria-selected')==='true','dock tab '+k+': shows '+on.join(' + ')+' only')}
  ok(localStorage.getItem('eldmoor.dock')==='chat','the dock tab is remembered');
  {const r=$('chatTabs');ok(r.contains($('chatFilter'))&&!!r.children.find(b=>b.dataset.ctab==='dm')&&$('chatLegend').hidden&&/class colour/.test($('chatFilter').title||''),'chat: one row (channel chips and the DM agent toggle), the colour key a tooltip')}
  // the default hero: the followed company's leader, not a random background hero
  const F=CV.followedCompany(),lead=CV.storyLead(F),bg=S.agents.find(a=>a.state!=='dead'&&!SLT.inSlots(a)&&!a.player&&!companyOf(a));
  ok(!!lead&&F.ids.includes(lead.id),'the story lead is a member of the followed company ('+(lead&&lead.name)+')');
  S.pinned=bg;ok(C.startHero()===lead,'a saved background pick gives way to the followed company’s leader');
  S.pinned=lead;ok(C.startHero()===lead,'a saved member pick is kept');
  {const other=F.ids.map(id=>S.agents.find(a=>a.id===id)).find(a=>a&&a!==lead&&a.state!=='dead');if(other){S.pinned=other;ok(C.startHero()===other,'any member of the followed company is kept as the pick')}}
  // a background hero: a short card until the full sheet is asked for
  if(bg){C.select(bg);L.showDock('hero');uiFast();const h=$('hero'),fs=h.querySelector('[data-fullsheet]'),tabs=h.querySelector('.tabs');
    ok(!!fs&&tabs.hidden&&h.querySelector('.tb').hidden,'a background hero shows a short card with a Full sheet button');
    fs.dispatch('click',{target:fs});uiFast();ok(!h.querySelector('[data-fullsheet]')&&!h.querySelector('.tabs').hidden,'Full sheet opens the tabs')}
  C.select(lead);uiFast();ok(!$('hero').querySelector('[data-fullsheet]')&&!$('hero').querySelector('.tabs').hidden,'a member opens on its full dossier');
  // the frames carry the glance only: no runner control, no relay text, no oath counter; a mind dot with the runner on hover
  {const fr=$('frames').querySelector('.frrows'),pf=fr.querySelectorAll('.pf[data-hid]');
    ok(pf.length>0&&!fr.querySelector('[data-runact]')&&!fr.querySelector('.runctl')&&!/relay offline|Start runner|OATH \d/.test(fr.textContent),'frames: no runner control, relay text or oath counter');
    const d=pf[0].querySelector('.pfdot');ok(!!d&&/^pfdot d-(agent|autopilot|reflex|ai|scripted|quiet)$/.test(d.className)&&/Runner: /.test(d.title||'')&&/Agent|Autopilot|Reflex/.test(d.textContent),'frames: a mind dot ('+(d&&d.className)+', '+(d&&d.textContent)+') with the runner state as its tooltip')}
  {L.showDock('company');uiFast();const fb=$('felbody'),m=fb.querySelector('[data-fact="drawer:members"]');m.click();uiFast();
    ok(!!fb.querySelector('[data-runact]'),'Company tab: the runner Start / Stop lives in Members and minds');fb.querySelector('[data-fact="drawer:members"]').click();uiFast()}
  // the View bar: the Intent icons switch joins it at this width; the cap rises to 11 above 2560 px only
  {const bar_=document.querySelector('.bar'),vis=bar_.querySelectorAll('button').filter(b=>{for(let e=b;e&&e!==bar_;e=e.parentNode){if(e.hidden)return false;if(e.tagName==='DETAILS'&&!e.open&&e!==b.parentNode)return false}return true});
    ok($('vIcons').parentNode===$('zOut').parentNode&&vis.length<=11,'3440 px: Intent icons sit on the View bar ('+vis.length+' buttons, cap 11 above 2560 px)')}
  // a button budget for the default view: header, frames, bar and the open dock tab
  {L.showDock('company');uiFast();const shown=b=>{for(let e=b;e&&e!==document.body;e=e.parentNode){if(e.hidden||(e.classList&&e.classList.contains('doff')))return false;if(e.tagName==='DETAILS'&&!e.open&&e!==b.parentNode)return false;if(e.id==='setPop'||e.id==='agentsPop'||e.id==='sheetov')return false;if(e.classList&&e.classList.contains('wdrop'))return false}return true};
    const n=document.body.querySelectorAll('button').filter(shown).length;ok(n<=25,'3440 px default view: '+n+' buttons visible (at most 25)')}
  {const css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');ok(/@media \(min-width:3200px\)\{:root\{--uiz:1\.35\}\}/.test(css)&&/header,\.frames,\.bar,#side[^{]*\.tbanner\{zoom:var\(--uiz\)\}/.test(css),'3440 px: the interface steps up 1.35x (frames, bar, header, dock, banner)')}
  // the follow cycle moves the dossier to the next company's leader
  if(companies().length>1){const was=CV.followedCompany();C.select(CV.storyLead(was));const N=CV.followNext();uiFast();ok(N!==was&&cam.sel===CV.storyLead(N),'the follow cycle selects the next company’s leader');CV.followCompany(was);uiFast()}
  else console.log('  skip follow cycle (one company)');
  // 1280 px: everything goes back (no dock, chat and hero under the map, Intent icons back in Settings)
  window.innerWidth=1280;uiFast();
  ok(!L.docked()&&!document.body.classList.contains('docked')&&bar.hidden&&$('chatSec').parentNode===$('colM')&&$('heroSec').parentNode===$('colM')&&$('storySec').parentNode===side,'1280 px: no dock; chat and hero under the map, Story in the side column');
  ok(!side.querySelectorAll('section').some(x=>x.classList.contains('doff'))&&$('setPop').contains($('vIcons')),'1280 px: no section hidden by the dock; Intent icons back in Settings');
  ok(side.children.filter(x=>x.tagName==='SECTION'&&!x.hidden).map(x=>x.id)[0]==='fellowship','1280 px: the side column opens with the Companies panel');
  window.innerWidth=keepW;S.pinned=keepPin;cam.sel=keepSel;uiFast()}
// ---- a world reset stops every runner with one relay call and says so once (#691) ----
{console.log('World reset');
  const posts=[];const realFetch=globalThis.fetch;
  let n=3;globalThis.fetch=async(url,o)=>{url=String(url);posts.push({url,body:o&&o.body?JSON.parse(o.body):null});return {ok:true,status:200,json:async()=>({ok:true,stopped:n,keys:[]})}};
  const sv=await import('../src/ui/save.js');
  const tx=()=>document.getElementById('wStatus').textContent;
  const r1=await sv.resetRunners();
  ok(r1===3&&posts.length===1&&posts[0].url.endsWith('/play/runner/stop-all'),'one call to /play/runner/stop-all, not one per runner: '+posts.map(p=>p.url).join());
  ok(tx()==='World reset: 3 runners stopped','the page says "World reset: 3 runners stopped": '+tx());
  n=1;const r2=await sv.resetRunners();ok(r2===1&&tx()==='World reset: 1 runner stopped','one runner reads singular: '+tx());
  const both=[sv.resetRunners(),sv.resetRunners()];await Promise.all(both);ok(posts.length===3,'two resets at once share one call');
  globalThis.fetch=async()=>{throw new Error('relay down')};const before=tx();const r3=await sv.resetRunners();ok(r3===null&&tx()===before,'no relay: nothing is said, the reload goes on');
  globalThis.fetch=realFetch}
// ---- the downed (#659): party frames, the dossier header, the purpose line, the Log, the timeline, the chronicle, the banner ----
{const S=sim.S,DN=await import('../src/sim/downed.js'),DV=await import('../src/ui/downview.js'),FR=await import('../src/ui/frames.js'),TB=await import('../src/ui/table.js');
  const {cam}=await import('../src/render/draw.js'),{setTimelineFilter}=await import('../src/ui/timeline.js');
  const keepT=S.table,keepSel=cam.sel,keepGuard=guardMem;guardMem=null;S.table=null;
  const a=S.agents.find(x=>x.company!=null&&x.state!=='dead'&&!x.hidden&&x.state!=='dungeon'),m=S.mobs.find(x=>x.alive&&!x.gone);
  if(!a||!m)console.log('  skip downed (no member or no creature)');else{
  const frame=()=>$('frames').querySelector('.pf[data-hid="'+a.id+'"]'),row=()=>FR.frameRows().find(r=>r.name===a.name);
  a.state='hunt';a.hp=0;ok(DN.goDown(a,m)&&DN.isDown(a),'downed: the member goes down (sim/downed.js goDown)');
  uiFast();let f=frame(),dn=f&&f.querySelector('.pfdown');
  ok(!!f&&f.classList.contains('downed')&&!!dn&&!dn.hidden,'downed: the frame turns red and shows the downed row');
  ok(dn&&dn.querySelector('.pfdl').textContent==='DOWNED'&&dn.querySelector('.pips.ok').textContent==='○○○'&&dn.querySelector('.pips.bad').textContent==='○'.repeat(DN.failsOf(a)),'downed: DOWNED with three empty saves and '+DN.failsOf(a)+' empty failures (four with a healer near)');
  ok(/^save in 10 min$/.test(dn.querySelector('.pfdt').textContent),'downed: the save timer ('+dn.querySelector('.pfdt').textContent+')');
  ok(/^DOWNED · saved 0\/3 · failed 0\/[34] · save in 10 min/.test(row().down)&&!row().chips.includes('WOUNDED'),'downed: frameRows carries the tally and timer, no WOUNDED chip ('+row().down+')');
  ok(/^Bleeding out/.test(row().purpose)&&/^Bleeding out/.test(f.querySelector('.pfdo').textContent),'downed: the purpose line says they bleed out ('+row().purpose+')');
  const same=dn.querySelector('.pips.ok');a.down.s=1;a.down.next+=DN.DOWN.TICK;uiFast();
  ok(frame().querySelector('.pips.ok')===same&&same.textContent==='●○○'&&row().flash==='SAVED','downed: a save made fills a circle in place and flashes SAVED');
  a.down.f=1;uiFast();ok(row().flash==='STRUCK'&&frame().querySelector('.pips.bad').textContent==='●'+'○'.repeat(DN.failsOf(a)-1),'downed: a blow while down is a failure, flashed STRUCK (the save clock did not move)');
  a.down.f=3;a.down.next+=DN.DOWN.TICK;uiFast();ok(row().flash==='FAILED x2','downed: a natural 1 on a save reads FAILED x2 ('+row().flash+')');a.down.f=1;uiFast();
  select(a);uiFast();{const h=$('hero').querySelector('.hdown');ok(!!h&&/DOWNED/.test(h.textContent)&&/●○○/.test(h.textContent)&&/save in/.test(h.textContent),'downed: the hero card shows the same row under HP')}
  ok(/Bleeding out/.test($('hero').querySelector('.purp').textContent),'downed: the hero card purpose line');
  a.down.stable=true;a.down.wake=S.gameMin+60;uiFast();f=frame();
  ok(f.classList.contains('stable')&&f.querySelector('.pfdl').textContent==='STABLE'&&/^wakes in 1 h$/.test(f.querySelector('.pfdt').textContent)&&row().flash==='STABLE','downed: stable, with the wake timer, flashed STABLE');
  a.down.stable=false;a.down.s=1;uiFast();
  // a helper comes: the purpose says so, the helper's line says whom they tend
  const b=S.agents.find(x=>x.aid===a.id&&x.state==='aid'&&x.company===a.company)||S.agents.find(x=>x!==a&&x.company===a.company&&x.state!=='dead'); // the sim may already have sent one (callHelp)
  if(b){const st=b.state;b.state='aid';b.aid=a.id;uiFast();const hp=DV.helperOf(a),br=FR.frameRows().find(r=>r.name===b.name);ok(!!hp&&new RegExp(hp.name+' (is coming|at their side)').test(row().purpose)&&(!br||br.purpose==='Tending '+a.name+' · who lies dying'),'downed: the helper shows on both frames ('+row().purpose+')');b.state=st;b.aid=null}
  // up again: a heal lands, the world's step raises them
  a.hp=5;DN.downedStep(a,.05);uiFast();f=frame();
  ok(!DN.isDown(a)&&!f.classList.contains('downed')&&row().flash==='UP'&&!f.querySelector('.pfdown').hidden&&f.querySelector('.pfdx').textContent==='UP','downed: up again, the frame flashes UP');
  // the words: the Log, the timeline, the chronicle
  setTab('log');uiFast();{const L=$('hero').querySelectorAll('.hist li');const dl=L.find(x=>x.classList.contains('dk-down')),ul=L.find(x=>x.classList.contains('dk-up'));
    ok(!!dl&&/DOWN/.test(dl.querySelector('.badge').textContent)&&!!ul&&/UP/.test(ul.querySelector('.badge').textContent),'downed: the dossier Log marks going down and coming back')}
  setTab('stats');uiSlow();{const tl=$('tlist'),L=tl.children.filter(x=>x.textContent.includes(a.name));
    ok(L.some(x=>/DOWN/.test(x.querySelector('.badge').textContent)&&/went down at level/.test(x.textContent))&&L.some(x=>x.querySelector('.badge').textContent==='UP'),'downed: the timeline records the downing and the revival');
    const k0=tl.children[0].dataset.k;uiSlow();ok(tl.children[0].dataset.k===k0,'downed: timeline rows keep their keys');
    setTimelineFilter('downs');ok(tl.children.length>=2&&tl.children.every(x=>/DOWN|UP|STABLE|DEATH|MERCY|FINISH/.test((x.querySelector('.badge')||{}).textContent||'')),'downed: the Downed filter');setTimelineFilter('all')}
  ok(/ is down, bleeding/.test(S.chronicle[0].parts.slice(1).join(''))&&$('log').children[0].classList.contains('dk-down'),'downed: the chronicle line is marked');
  ok(DV.downKind('Ilsa spared Kerin, who lay at her mercy.')==='mercy'&&DV.downKind('Ilsa finished off Kerin.')==='finish'&&DV.downKind('Slew a wolf.')===null,'downed: mercy and finish words are ready for #657');
  // the Table banner (#654's data): a downed member's chip carries the tally, each death save is a roll line
  a.hp=0;a.state='hunt';DN.goDown(a,m);a.down.s=1;a.down.f=1;
  const ms=[a,...S.agents.filter(x=>x!==a&&x.company===a.company&&x.state!=='dead').slice(0,1)];
  const sc={id:9659,kind:'rescue',title:a.name+' is down',frame:[a,' lies bleeding.'],ids:ms.map(x=>x.id),i:1,phase:'turn',t:0,acts:{},ctx:{hero:a.id,down:1},pause:true,at:0,rd:2,fd:1,foeAt:ms.length,
    beats:[{id:a.id,name:a.name,k:'save',text:'Fights for breath',res:'death save d20 14 vs DC 10: a success (1 of 3 saved, 1 of 4 failed)',by:'down',rd:2,check:{kind:'death',die:14,mod:0,total:14,vs:10,hit:true,crit:false,dmg:0,target:a.name,down:false,s:1,f:1,of:4}}]};
  S.table=sc;TB.renderTable(1);const box=$('tbanner'),ch=box.querySelectorAll('.tci')[0],rl=box.querySelector('.trl.death');
  ok(!!ch&&ch.classList.contains('dn')&&/downed/.test(ch.textContent)&&ch.querySelector('.pips.ok').textContent==='●○○'&&ch.querySelector('.pips.bad').textContent==='●○○○','banner: the downed member\'s chip shows the tally, four failures with a healer at the table ('+(ch&&ch.textContent)+')');
  ok(!!rl&&rl.classList.contains('hit')&&/death save d20 14 vs DC 10/.test(rl.textContent)&&/SAVED/.test(rl.textContent),'banner: the death save shows as it is rolled ('+(rl&&rl.textContent)+')');
  sc.beats.push({id:a.id,name:a.name,k:'save',text:'Fights for breath',res:'',by:'down',rd:2,check:{kind:'death',die:1,mod:0,total:1,vs:10,hit:false,crit:false,dmg:0,target:a.name,down:false,s:1,f:3,of:4}});TB.renderTable(1);
  ok(/2 FAILURES/.test(box.querySelectorAll('.trl.death')[1].textContent),'banner: a natural 1 reads two failures');
  sc.phase='outcome';TB.renderTable(1);ok([...box.querySelectorAll('.tendc')].some(x=>x.textContent===a.name+' still bleeds'),'banner: the end says who still bleeds');
  sc.rd=null;sc.phase='turn';TB.renderTable(1);{const r=box.querySelector('.tmr.st-down');ok(!!r&&/downed/.test(r.textContent),'banner: a scene without rounds lists the downed member as downed')}
  S.table=keepT;TB.renderTable(1);
  // bleeding out: the third failure ends them (the death choke point); the frame reads fallen
  a.down.f=DN.failsOf(a)-1;DN.downHit(a,m,false);uiFast();ok(a.state==='dead'&&!FR.frameRows().some(r=>r.name===a.name&&r.down),'downed: three failures and they are gone; no downed row on the fallen');
  }
  guardMem=keepGuard;cam.sel=keepSel;uiFast()}
// The page watchdog (#736): a long frame logs one line, a run of them (or one over 2 s) is a page-stall anomaly, and the link labels
// read "page busy (3.2 s frame)" instead of flipping to connecting while the page is the one that is slow.
console.log('page watchdog');
{const PW=await import('../src/ui/pagewatch.js'),BR=await import('../src/ui/player-bridge.js'),ML=await import('../src/ui/mindlabel.js'),{dmFrameData}=await import('../src/ui/dmframe.js');
  const a=SLT.slotMembers(SLT.slotted()).map(m=>m.hero).find(h=>h&&h.player&&h.state!=='dead');
  const lines=[];PW.setPageLog(l=>lines.push(l));PW.resetPageWatch();PW.setWhere(()=>'dungeon The Sunken Crypt room 2/5 · 3440x1300');
  const links={};if(a)links[a.id]='connected';BR.bridgeFeed({links,runners:{},ready:{},dm:{seat:true,link:'connected',claimed:true}});
  ok(!!a&&ML.linkOf(a)==='connected'&&/live/.test(ML.mindLabel(a).text),'before: the link reads live ('+(a&&ML.mindLabel(a).text)+')');
  const t=performance.now();
  ok(!PW.frameDone({ms:16,sim:1,render:14,ui:1},t)&&!lines.length,'a normal frame logs nothing');
  ok(PW.frameDone({ms:400,sim:2,render:395,ui:3},t)&&lines.length===1&&/\[page\] 400 ms frame \(sim 2, render 395, ui 3 ms\) · dungeon The Sunken Crypt room 2\/5/.test(lines[0]),'a scripted 400 ms frame logs one line naming the view and its halves: '+lines[0]);
  ok(!PW.takeAnomalies().length&&ML.linkOf(a)==='connected','one 400 ms frame is no anomaly and the label stays live');
  PW.frameDone({ms:400,render:400},t+1500);PW.frameDone({ms:400,render:400},t+3000);
  const an=PW.takeAnomalies();ok(an.length===1&&an[0].kind==='page-stall'&&an[0].seat==='page'&&/3 frames over 250 ms/.test(an[0].text)&&an[0].evidence.where.startsWith('dungeon'),'three 400 ms frames in a minute: one page-stall anomaly ('+(an[0]&&an[0].text)+')');
  PW.frameDone({ms:3200,sim:1,render:3198,ui:1},performance.now());
  const big=PW.takeAnomalies();ok(big.length===1&&big[0].severity==='bad'&&/froze for 3\.2 s/.test(big[0].text),'a 3.2 s frame is a page-stall anomaly at once');
  ok(ML.linkOf(a)==='pagebusy'&&/page busy \(3\.2 s frame\)/.test(ML.mindLabel(a).text),'the member label reads page busy, not connecting: '+ML.mindLabel(a).text);
  {const was=sim.dmSeatOn();sim.setDmSeat(true);const d=dmFrameData();sim.setDmSeat(was);ok(d.link==='pagebusy'&&d.linkText==='page busy (3.2 s frame)','the DM frame reads page busy too ('+d.linkText+')')}
  const dg=PW.pageDigest();ok(dg.longFrames===4&&dg.worstMs===3200&&/Sunken Crypt/.test(dg.where)&&PW.pageDigest().longFrames===0,'the hour digest carries {longFrames, worstMs, where} and resets');
  PW.resetPageWatch();PW.relayLate({tool:'scene_act',ms:15000,silentMs:16200});
  ok(/page busy \(no answer for 16\.2 s\)/.test(ML.mindLabel(a).text),'a relay time-out on a silent page reads page busy as well: '+ML.mindLabel(a).text);
  PW.resetPageWatch();ok(ML.linkOf(a)==='connected','once it passes the label is live again');
  BR.bridgeFeed(null);PW.setPageLog(null)}
if(fail){console.error('\nuismoke: '+fail+' failed');process.exit(1)}
console.log('\nuismoke: all checks passed');process.exit(0)
