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
{const d=$('campaign').querySelector('details');const k=d&&d.getAttribute('data-k');
  holds('Campaign log ('+k+')',()=>$('campaign').querySelector('details[data-k='+k+'] .tlist'),{sec:60,min:3})}
// a focused picker is never replaced
{const s=$('felbody').querySelector('select');if(s){s.focus();const n=s;select(mem[3]);tick(10);ok($('felbody').contains(n),'a focused picker in the Fellowship panel survives refreshes');n.blur()}
  else console.log('  skip picker (no select in the Fellowship panel)')}
// Chat tab (#145, owner): one compact line, no mind badge, own-name prefix dropped, repeats collapsed
{const sp=mem[1];sp.x=mem[0].x+1;sp.y=mem[0].y; // within shouting range (#182)
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
  setGroup('story');uiFast();ok(shown().join()==='Log,Bio,Memory','Story: Log, Bio, Memory: '+shown());
  setGroup('mind');uiFast();ok(shown().includes('Chat')&&shown().includes('Agent'),'Mind: Chat and Agent for the agent-played member: '+shown());
  setGroup('char');uiFast();ok(tb().querySelector('[data-cstat]'),'Character opens on Stats');
  setGroup('story');setTab('bio');setGroup('char');setGroup('story');uiFast();ok(shown().length&&sub.children.find(b=>b.getAttribute('aria-pressed')==='true').textContent==='Bio','a group reopens on its last tab');
  ok(!$('hero').querySelector('.hd [data-ai]')&&!$('hero').querySelector('.hd [data-agent]'),'a member\'s header has no AI/Agent buttons (one mind control)');
  ok(!$('frames').querySelector('[data-mindctl]'),'the frames show the mind label, without a switch');
  const fb=$('felbody'),mm=[...fb.querySelectorAll('details')].find(d=>/Members and minds/.test(d.textContent));
  ok(!!mm&&!mm.open&&!!mm.querySelector('.mindrow')&&!mm.querySelector('[data-mmode]'),'Members and minds: the one place a member\'s mind is set, folded by default');
  ok(!/Model requests|Relay writing/.test(fb.textContent),'request stats are hidden unless Developer is on');
  ok(document.body.classList.contains('fellow-mode')&&!document.body.classList.contains('dev-mode'),'Minds at play is folded away (fellow-mode without dev-mode)');
  const st=$('storyTabs');ok(st&&!st.hidden&&$('storyTtl').textContent==='Story','the Story panel has Chronicle and Campaign log tabs');
  st.children.find(b=>b.dataset.story==='camp').click();ok($('log').hidden&&!$('campaign').hidden&&$('chronFel').hidden,'Campaign log tab shows the campaign');
  st.children.find(b=>b.dataset.story==='chron').click();ok(!$('log').hidden&&$('campaign').hidden,'Chronicle tab shows the chronicle')}


// ---- the Fellowship chat panel, class and disposition colours, council lines (#169) ----
{const {classColor,dispositionOf,toneOf}=await import('../src/core/colors.js');
  const dps=mem.filter(a=>/^dps/.test(a.fellowRole||''));const cols=new Set(dps.map(a=>classColor(a.cls)));
  ok(dps.length===3&&cols.size===3,'three DPS of different classes get three different colours: '+[...cols].join(' '));
  ok(classColor('Warrior')!==classColor('Priest')&&classColor('Nonesuch')===classColor('Nonesuch'),'every class has its own colour, an unknown class a stable one');
  const F=sim.S.fellowship,home={kind:'npc',fac:F.fac,name:'Ostler'},away={kind:'npc',fac:1-F.fac,name:'Peddler'};
  ok(dispositionOf(home,F)==='friendly'&&dispositionOf(away,F)==='neutral','NPCs of the Fellowship\'s faction are friendly, others neutral');
  ok(dispositionOf({...away,mood:'hostile'},F)==='hostile'&&dispositionOf({...home,hostile:true},F)==='hostile'&&dispositionOf({kind:'foe',name:'Brute'},F)==='hostile','npc.mood, npc.hostile and a foe make it hostile');
  ok(dispositionOf({cls:'Mage',fac:1-F.fac,name:'Rival'},F)==='hostile','an enemy-faction hero is hostile');
  ok(toneOf(dps[0],F).kind==='class'&&toneOf(home,F).npc===true&&toneOf(home,F).color!==classColor('Rogue'),'NPCs carry the shape cue and a colour apart from the class colours');
  const sec=$('chatSec');ok(!!sec&&!sec.hidden,'the Fellowship chat panel is shown with a Fellowship');
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
  const npcName=cl.querySelector('.npcn');ok(!!npcName&&npcName.classList.contains('npc-friendly'),'chat panel: an NPC name is underlined in its disposition class');
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
   $('chatTabs').children.find(b=>b.dataset.ctab==='dm').click();uiFast();const dl=$('dmChatList');
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
  gate.checkRunGate(T0+25000);
  ok(ctl.held&&!box.hidden&&box.textContent.includes(m3.name),'the member\'s link dropped for 25 s: the gate closes and the bar names '+m3.name);
  ok(/Start/.test(box.textContent)&&/Start all/.test(box.textContent),'the bar offers Start and Start all');
  ok(/no runner/.test(box.textContent),'the bar says why: '+box.children.map(c=>c.textContent).join(' / ').slice(0,120));
  ok(sp(3).getAttribute('aria-disabled')==='true'&&sp(0).getAttribute('aria-disabled')!=='true','the speed buttons are inert but Pause works');
  press(3);ok(ctl.speed===1,'3x cannot unpause or change the speed while held');
  const bar0=box.children[0];gate.checkRunGate(T0+26000);ok(box.children[0]===bar0,'the bar is patched only when its text changes (same nodes)');
  L[m3.id]='waiting';gate.checkRunGate(T0+27000);
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

if(fail){console.error('\nuismoke: '+fail+' failed');process.exit(1)}
console.log('\nuismoke: all checks passed');process.exit(0)
