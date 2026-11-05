// Stubbed-DOM smoke of the New World setup page (issue #133). Usage: npm run setupsmoke  (node scripts/setupsmoke.mjs <repo> <a|b>)
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const repo=process.argv[2];const imp=p=>import(pathToFileURL(path.join(repo,p)).href);

// ---- a tiny DOM ----
const ids=new Map();
class Text{constructor(t){this.data=String(t);this.parentNode=null}get textContent(){return this.data}}
function parseSel(s){s=s.trim();let scope=false;if(s.startsWith(':scope >')){scope=true;s=s.slice(8).trim()}
  const m={tag:null,cls:[],attrs:[],scope};const re=/^([a-zA-Z][\w-]*)|\.([\w-]+)|\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g;let x;
  while((x=re.exec(s))){if(x[1])m.tag=x[1].toUpperCase();else if(x[2])m.cls.push(x[2]);else m.attrs.push([x[3],x[4]])}return m}
function matches(e,s){if(!(e instanceof El))return false;const m=typeof s==='string'?parseSel(s):s;
  if(m.tag&&e.tagName!==m.tag)return false;for(const c of m.cls)if(!e.classList.contains(c))return false;
  for(const [k,v] of m.attrs){const a=e.getAttribute(k);if(a==null)return false;if(v!=null&&a!==v)return false}return true}
class El{
  constructor(tag){this.tagName=tag.toUpperCase();this.childNodes=[];this.parentNode=null;this._attrs={};this.dataset=new Proxy({}, {set:(o,k,v)=>{o[k]=String(v);return true}});this.style={};this.hidden=false;this._ls={};this._id='';
    const self=this;this.classList={add:(...c)=>{const s=new Set(self.className.split(' ').filter(Boolean));c.forEach(x=>s.add(x));self.className=[...s].join(' ')},
      remove:(...c)=>{self.className=self.className.split(' ').filter(x=>x&&!c.includes(x)).join(' ')},
      contains:c=>self.className.split(' ').includes(c),toggle:(c,f)=>{const has=self.classList.contains(c);const on=f===undefined?!has:f;if(on)self.classList.add(c);else self.classList.remove(c);return on}};
    this.className='';this.width=0;this.height=0;this.value='';this.offsetWidth=200;this.offsetHeight=100;this.scrollLeft=0;this.scrollTop=0}
  set id(v){this._id=v;ids.set(v,this)}get id(){return this._id}
  get children(){return this.childNodes.filter(n=>n instanceof El)}
  get firstChild(){return this.childNodes[0]||null}get lastChild(){return this.childNodes[this.childNodes.length-1]||null}
  get textContent(){return this.childNodes.map(n=>n.textContent).join('')}
  set textContent(v){this.childNodes.forEach(n=>n.parentNode=null);this.childNodes=v===''||v==null?[]:[new Text(v)];this.childNodes.forEach(n=>n.parentNode=this)}
  set innerHTML(v){this.textContent=String(v).replace(/<[^>]+>/g,' ')}
  _adopt(n){if(typeof n==='string'||typeof n==='number')n=new Text(n);if(n.parentNode)n.parentNode.removeChild(n);n.parentNode=this;return n}
  append(...ns){for(const n of ns)this.childNodes.push(this._adopt(n))}
  appendChild(n){this.append(n);return n}
  prepend(...ns){this.childNodes.unshift(...ns.map(n=>this._adopt(n)))}
  removeChild(n){const i=this.childNodes.indexOf(n);if(i>=0){this.childNodes.splice(i,1);n.parentNode=null}return n}
  remove(){if(this.parentNode)this.parentNode.removeChild(this)}
  replaceChildren(...ns){this.childNodes.forEach(n=>n.parentNode=null);this.childNodes=[];this.append(...ns)}
  replaceChild(nw,old){const i=this.childNodes.indexOf(old);nw=this._adopt(nw);const j=this.childNodes.indexOf(old);this.childNodes[j]=nw;old.parentNode=null;return old}
  insertBefore(n,ref){n=this._adopt(n);if(!ref){this.childNodes.push(n);return n}const i=this.childNodes.indexOf(ref);this.childNodes.splice(i,0,n);return n}
  contains(n){while(n){if(n===this)return true;n=n.parentNode}return false}
  setAttribute(k,v){this._attrs[k]=String(v);if(k==='id')this.id=v}
  getAttribute(k){if(k.startsWith('data-')){const c=k.slice(5).replace(/-(\w)/g,(_,x)=>x.toUpperCase());return this.dataset[c]!=null?this.dataset[c]:null}return this._attrs[k]!=null?this._attrs[k]:null}
  removeAttribute(k){delete this._attrs[k]}
  closest(s){let e=this;const m=parseSel(s);while(e instanceof El){if(matches(e,m))return e;e=e.parentNode}return null}
  _all(m,out,depth){for(const c of this.children){if(matches(c,m))out.push(c);if(!m.scope)c._all(m,out)}return out}
  querySelectorAll(s){return this._all(parseSel(s),[])}
  querySelector(s){return this.querySelectorAll(s)[0]||null}
  addEventListener(t,f){(this._ls[t]||(this._ls[t]=[])).push(f)}
  dispatch(t,ev){let e=this;ev.target=ev.target||this;ev.stopPropagation=()=>{ev._stop=true};ev.preventDefault=()=>{};while(e&&!ev._stop){for(const f of (e._ls&&e._ls[t])||[])f(ev);e=e.parentNode}}
  focus(){}
  getContext(){return new Proxy({},{get:(o,k)=>k in o?o[k]:()=>({addColorStop(){}}),set:(o,k,v)=>{o[k]=v;return true}})}
  getBoundingClientRect(){return {left:0,top:0,width:960,height:600}}
}
const body=new El('body');
globalThis.document={createElement:t=>new El(t),getElementById:id=>ids.get(id)||null,body,addEventListener(){},querySelector:s=>body.querySelector(s),querySelectorAll:s=>body.querySelectorAll(s)};
globalThis.window={innerWidth:1280,innerHeight:800,devicePixelRatio:1,addEventListener(){}};
globalThis.localStorage={_d:{},getItem(k){return this._d[k]??null},setItem(k,v){this._d[k]=String(v)},removeItem(k){delete this._d[k]}};
globalThis.ResizeObserver=class{observe(){}};
globalThis.Option=class{constructor(t,v){this.text=t;this.value=v}};
// ---- smoke for issue #133: the New World setup page. Usage: node smoke133.mjs <repo> <a|b> ----
const mode=process.argv[3]||'a';
window.localStorage=globalThis.localStorage;
let reloads=0,navs=[];
globalThis.location={reload(){reloads++}};
Object.defineProperty(globalThis.location,'href',{get(){return 'http://localhost:5173/'},set(v){navs.push(v)}});
Object.defineProperty(globalThis.location,'search',{get(){return ''}});
document.activeElement=null;
const posts=[];let health={ok:true,providers:{anthropic:{ok:true,models:[]},ollama:{ok:true,models:['qwen2.5:14b','llama3:8b'],loaded:['llama3:8b']}}};
let runnerInfo={ok:true,enabled:true,max:5,runners:[]};
globalThis.fetch=async(url,opt)=>{url=String(url);
  const j=o=>({ok:true,status:200,json:async()=>o});
  if(opt&&opt.method==='POST'){posts.push({url,body:JSON.parse(opt.body)});return j({ok:true,runner:{}})}
  if(url.endsWith('/health'))return j(health);
  if(url.endsWith('/play/runner'))return j(runnerInfo);
  throw new Error('no route '+url)};
let fail=0;const ok=(c,m)=>{if(c)console.log('  ok   '+m);else{console.error('  FAIL '+m);fail++}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const {boot,bootKind,appliedSetup,PENDING_KEY,SAVE_KEY,writeSave}=await imp('src/ui/save.js');
const sim=await imp('src/sim/index.js');
const SLT=await imp('src/sim/company.js'); // the slotted company (#588)
const {ctl}=await imp('src/ui/controls.js');
const setup=await imp('src/ui/setup.js');
const all=(root,sel)=>root.querySelectorAll(sel);
const click=(root,pred)=>{const b=all(root,'button').find(pred);if(!b)throw new Error('no button');b.dispatch('click',{target:b});return b};
const text=root=>root.textContent;

if(mode==='a'){
  boot(sim.init);
  ok(bootKind()==='fresh','no save, no pending: fresh');
  setup.initSetup();setup.openSetup({first:true});
  await sleep(50);
  const root=ids.get('setup');
  ok(root&&!root.hidden,'setup page is open on first visit');
  ok(ctl.speed===0,'the world is paused while choosing');
  ok(all(root,'.scard').length===5,'five place cards');
  ok(/Tank/.test(text(root))&&/Healer/.test(text(root))&&/DPS/.test(text(root)),'roles shown');
  ok(/Play the default world/.test(text(root)),'first visit offers the default world');
  const sels=(r,f)=>all(r,'select').find(s=>s.dataset.f===f);
  const opts=f=>sels(ids.get('setup'),f).childNodes.map(o=>o.value);
  ok(JSON.stringify(opts('cls:tank'))==='["Warrior"]'&&JSON.stringify(opts('cls:healer'))==='["Priest","Wildspeaker"]','tank class fixed, healer Priest or Wildspeaker');
  ok(opts('cls:dps1').join()==='Mage,Hunter,Rogue,Skald','DPS classes: '+opts('cls:dps1'));
  ok(/Relay/.test(text(ids.get('setup'))),'relay line');
  ok(!all(ids.get('setup'),'button').some(b=>/All scripted/.test(b.textContent)),'no All scripted preset (#148: the Fellowship is always agent-played)');
  ok(all(ids.get('setup'),'.scard').every(c=>!all(c,'button').some(b=>b.dataset.a==='mode')),'no Scripted / AI buttons on a member card, only its model');
  // the DM is always an agent (#520, #559): no Scripted button, a required model, a DM runner in every plan
  ok(!all(ids.get('setup'),'button').some(b=>b.dataset.a==='mode'||/^Scripted$/.test(b.textContent)),'no Scripted DM button (#559: the DM is always an agent)');
  ok(!!sels(ids.get('setup'),'mind:dm')&&/DM is always an agent/.test(text(ids.get('setup'))),'the DM section asks only for its model: '+(sels(ids.get('setup'),'mind:dm')||{}).value);
  ok(/DM runner/.test(text(ids.get('setup'))),'the default plan starts a DM runner: '+text(ids.get('setup')).match(/On Start:[^.]*\./));
  click(ids.get('setup'),b=>/All on Haiku/.test(b.textContent));
  ok(sels(ids.get('setup'),'mind:dm').value==='anthropic:claude-haiku-5-5'&&/DM runner/.test(text(ids.get('setup'))),'All on Haiku seats the DM on Haiku too');
  click(ids.get('setup'),b=>/DM on Sonnet/.test(b.textContent));
  let r2=ids.get('setup');
  ok(all(r2,'.scard').every(c=>/Agent/.test(c.textContent)),'All agents preset: every card Agent');
  ok(/Fellowship runner/.test(text(r2))&&/DM runner/.test(text(r2)),'plan: one Fellowship runner + DM runner: '+text(r2).match(/On Start:[^.]*\./));
  const ms=sels(r2,'mind:dps1');ms.value='anthropic:claude-sonnet-5-5';ms.dispatch('change',{target:ms});
  r2=ids.get('setup');
  ok(/runner \(/.test(text(r2))&&!/Fellowship runner/.test(text(r2)),'different minds -> hero runners: '+text(r2).match(/On Start:[^.]*\./));
  await sleep(50);
  click(ids.get('setup'),b=>/All local/.test(b.textContent));
  const r3=ids.get('setup');
  const models=all(r3,'select').filter(s=>/^mind:/.test(s.dataset.f||'')).map(s=>s.value);
  ok(models.length===6&&new Set(models).size===1&&models[0]==='ollama:llama3:8b','All local: exactly one model, the loaded one -> '+[...new Set(models)]);
  const seed=all(r3,'input').find(i=>i.dataset.f==='seed');seed.value='';seed.dispatch('input',{target:seed});
  const st=all(ids.get('setup'),'button').find(b=>b.dataset.a==='start');
  ok(st&&st.disabled,'Start is disabled with an invalid seed');
  click(ids.get('setup'),b=>b.dataset.a==='seedroll');
  for(const k of ['tank','healer']){const n=all(ids.get('setup'),'input').find(i=>i.dataset.f==='name:'+k);n.value='Dup';n.dispatch('input',{target:n})}
  ok(/used twice/.test(text(ids.get('setup'))),'duplicate names are flagged');
  const n2=all(ids.get('setup'),'input').find(i=>i.dataset.f==='name:healer');n2.value='';n2.dispatch('input',{target:n2});
  click(ids.get('setup'),b=>b.dataset.a==='nameroll'&&b.dataset.slot==='dps1');
  ok(all(ids.get('setup'),'input').find(i=>i.dataset.f==='name:dps1').value.length>=3,'name reroll fills a name');
  {const o=sels(ids.get('setup'),'others');ok(o&&o.value==='full'&&o.childNodes.map(x=>x.value).join()==='full,none','Other heroes (#780): the usual roster by default, or none');
   o.value='none';o.dispatch('change',{target:o});ok(sels(ids.get('setup'),'others').value==='none','the choice stays on the page')}
  click(ids.get('setup'),b=>b.dataset.a==='start');
  for(let i=0;i<100&&reloads<1;i++)await new Promise(r=>setTimeout(r,20)); // the reload follows the runners' stop call (#691)
  const pend=JSON.parse(localStorage.getItem(PENDING_KEY)||'null');
  ok(pend&&pend.world==='eldmoor'&&reloads===1&&pend.v===2&&pend.mode==='together'&&pend.heroes.length===5&&pend.heroes[0].cls==='Warrior'&&pend.heroes[0].mind.mode==='agent','Start queues the setup (v2 together, #453) and reloads');
  ok(sim.validateSetup(pend).length===0,'the queued setup validates');
  ok(pend.others==='none','the queued setup carries Other heroes: none');
  {const last=JSON.parse(localStorage.getItem('eldmoor.setup.last')||'null');setup.openSetup({first:false});
   const nm=all(ids.get('setup'),'input').find(i=>i.dataset.f==='name:dps1');
   ok(last&&last.v===2&&all(ids.get('setup'),'.scard').length===5&&nm&&nm.value===pend.heroes[2].name,'a stored v2 last setup opens on the page as its five places (#453)')}
  localStorage.removeItem(PENDING_KEY);reloads=0;
  click(ids.get('setup'),b=>b.dataset.a==='cancel');writeSave();ok(!!localStorage.getItem(SAVE_KEY),'a save exists');
  setup.openSetup({first:false});
  click(ids.get('setup'),b=>b.dataset.a==='start');
  ok(/Replace the saved/.test(text(ids.get('setup')))&&reloads===0&&!localStorage.getItem(PENDING_KEY),'with a save, Start asks before replacing');
  click(ids.get('setup'),b=>b.dataset.a==='back');
  ok(!/Replace the saved/.test(text(ids.get('setup')))&&reloads===0,'Back keeps everything');
  click(ids.get('setup'),b=>b.dataset.a==='start');
  click(ids.get('setup'),b=>b.dataset.a==='go');
  for(let i=0;i<100&&reloads<1;i++)await new Promise(r=>setTimeout(r,20));
  ok(reloads===1&&!localStorage.getItem(SAVE_KEY)&&!!localStorage.getItem(PENDING_KEY),'Replace erases the save and queues the setup');
  localStorage.setItem(SAVE_KEY,'x');
  setup.openSetup({first:false});click(ids.get('setup'),b=>b.dataset.a==='cancel');
  ok(ids.get('setup').hidden&&localStorage.getItem(SAVE_KEY)==='x','Cancel closes the page and keeps the save');
}else if(mode==='c'){
  // the title screen: shown before any world exists; Continue only with a save; New world asks before replacing one
  const title=await imp('src/ui/title.js');const save=await imp('src/ui/save.js');
  ok(title.titleWanted('')===true,'the title is wanted on a plain page load');
  ok(title.titleWanted('?continue=1')===false&&title.titleWanted('?skip-title=1')===false&&title.titleWanted('?title=0')===false,'?continue=1, ?skip-title=1 and ?title=0 go straight in');
  setup.initSetup();
  let played=[];title.showTitle(k=>played.push(k));
  let t=ids.get('title');
  ok(t&&!t.hidden&&title.titleOpen(),'the title shows on load');
  ok(!save.isBooted()&&sim.S.agents.length===0,'no world is built or restored behind it');
  ok(!all(t,'button').some(b=>b.dataset.a==='continue'),'no Continue without a save');
  ok(all(t,'button').some(b=>b.dataset.a==='new'&&b.classList.contains('primary')),'New world is the first choice without a save');
  ok(all(t,'button').some(b=>b.dataset.a==='load')&&all(t,'button').some(b=>b.dataset.a==='default'),'Load from file and the default world are offered');
  ok(all(t,'button').filter(b=>b.dataset.a==='map').map(b=>b.textContent).join('|').includes('Stepping Lands'),'the map choice lists Eldmoor and the Stepping Lands');
  click(t,b=>b.dataset.a==='new');
  let sp=ids.get('setup');
  ok(sp&&!sp.hidden&&t.hidden,'New world (no save) opens the setup page at once');
  ok(all(sp,'button').some(b=>b.dataset.a==='cancel'&&b.textContent==='Back'),'the setup page offers Back to the title');
  click(sp,b=>b.dataset.a==='cancel');
  ok(sp.hidden&&!t.hidden&&played.length===0,'Back returns to the title, still no world');
  click(t,b=>b.dataset.a==='default');
  for(let i=0;i<100&&played.length<1;i++)await new Promise(r=>setTimeout(r,20)); // after the runners' stop call (#691)
  ok(played.join()==='default'&&!ids.get('title').parentNode,'the default world plays and the title goes away');
  // a saved world
  sim.init();save.writeSave();
  const sum=save.saveSummary('eldmoor');
  ok(sum&&sum.fellowship&&sum.fellowship.members.length===5&&sum.at,'saveSummary reads the day, the Fellowship and the time it was saved');
  played=[];title.showTitle(k=>played.push(k));t=ids.get('title');
  const cont=all(t,'button').find(b=>b.dataset.a==='continue');
  ok(cont&&cont.classList.contains('primary'),'Continue shows with a save, first');
  const line=t.querySelector('.tsave').textContent;
  ok(/^Eldmoor · Day \d+, \d\d:\d\d · /.test(line)&&sum.fellowship.members.every(m=>line.includes(m.name+' '+m.lvl))&&/saved just now/.test(line),'the save line: '+line);
  ok(!all(t,'button').some(b=>b.dataset.a==='default'),'no default world when a save exists');
  click(t,b=>b.dataset.a==='new');
  ok(/replaces the saved Eldmoor world/.test(t.textContent)&&ids.get('setup').hidden&&!localStorage.getItem(PENDING_KEY),'New world asks before replacing the save');
  ok(all(t,'button').some(b=>b.dataset.a==='export'),'and offers to export it first');
  click(t,b=>b.dataset.a==='back');
  ok(!/replaces the saved/.test(t.textContent)&&!!localStorage.getItem(SAVE_KEY),'Back keeps the save');
  click(t,b=>b.dataset.a==='new');click(t,b=>b.dataset.a==='replace');
  sp=ids.get('setup');ok(!sp.hidden&&t.hidden,'Set up a new world opens the setup page');
  reloads=0;click(sp,b=>b.dataset.a==='start');
  for(let i=0;i<100&&reloads<1;i++)await new Promise(r=>setTimeout(r,20)); // after the runners' stop call (#691)
  ok(reloads===1&&!localStorage.getItem(SAVE_KEY)&&!!localStorage.getItem(PENDING_KEY),'Start does not ask a second time: the save goes and the setup is queued');
  ok(title.titleWanted('')===false,'the reload into the queued setup skips the title');
  localStorage.removeItem(PENDING_KEY);
  // Continue
  save.holdSave(false);save.writeSave();played=[];title.showTitle(k=>played.push(k));t=ids.get('title');
  click(t,b=>b.dataset.a==='continue');ok(played.join()==='continue','Continue resumes the save');
}else if(mode==='b'){
  const s0=sim.applyPreset('claude',sim.defaultSetup(777,'eldmoor',0));s0.heroes[0].archetype='veteran';const s=sim.cleanSetup(s0);
  localStorage.setItem(PENDING_KEY,JSON.stringify(s));
  boot(sim.init);
  ok(bootKind()==='setup'&&appliedSetup().seed===777,'boot applies the queued setup');
  const mem=SLT.slotMembers(SLT.slotted()).map(m=>m.hero);
  ok(mem.length===5&&mem.every(h=>h.player),'all five are agent-played the moment the world exists');
  ok(!localStorage.getItem(PENDING_KEY),'the pending setup is consumed');
  setup.initSetup();
  const t0=Date.now();ctl.speed=1;
  const p=setup.afterBoot();
  await sleep(20);ok(ctl.speed===1,'the owner\'s speed is kept (no 6 s wait): the run gate holds the world instead');
  const gate=await imp('src/ui/rungate.js');gate.checkRunGate(Date.now());
  ok(ctl.held&&gate.gateMissing().length===6,'the world is held until all five members and the DM claim: '+gate.gateMissing().length+' missing');
  await p;
  gate.checkRunGate(Date.now()+1500);
  ok(ctl.held&&ctl.speed===1,'still held after the runners were started but have not claimed ('+(Date.now()-t0)+' ms)');
  const kinds=posts.map(x=>x.body.kind);
  ok(kinds.join()==='fellowship,dm','one Fellowship runner and one DM runner: '+kinds);
  ok(posts[0].body.model==='claude-haiku-5-5'&&posts[1].body.model==='claude-sonnet-5-5','models: Haiku for the five, Sonnet for the DM');
  const bar=body.querySelector('.nwbar');
  ok(bar&&/Fellowship/.test(bar.textContent)&&/DM/.test(bar.textContent),'the progress bar lists the runners: '+(bar&&bar.textContent.slice(0,160)));
  ok(!/scripted/i.test(bar.textContent),'never described as scripted');
}
// Professions pickers on the place cards (#259)
if(mode==='a'){setup.openSetup({first:true});await sleep(30);
  const card=()=>all(ids.get('setup'),'.scard')[0],pb=id=>all(card(),'button').find(b=>b.dataset.a==='prof'&&b.dataset.id===id);
  ok(/Let them choose/.test(card().textContent),'cards: "let them choose" until something is picked');
  click(ids.get('setup'),b=>b.dataset.a==='prof'&&b.dataset.slot==='tank'&&b.dataset.id==='mining');
  click(ids.get('setup'),b=>b.dataset.a==='prof'&&b.dataset.slot==='tank'&&b.dataset.id==='smithing');
  ok(/Mining and Smithing at skill 1/.test(card().textContent),'cards: two picks are named');
  ok(pb('fishing').disabled,'cards: a third is disabled');
  click(ids.get('setup'),b=>b.dataset.a==='prof'&&b.dataset.slot==='tank'&&b.dataset.id==='mining');
  ok(!pb('fishing').disabled&&/Smithing at skill 1/.test(card().textContent),'cards: un-picking frees a place');
  click(ids.get('setup'),b=>b.dataset.a==='start');
  const pend2=JSON.parse(localStorage.getItem(PENDING_KEY)||'null');
  ok(pend2&&pend2.heroes[0].profs.join()==='smithing'&&!pend2.heroes[1].profs,'Start queues the choice for that place only');
  localStorage.removeItem(PENDING_KEY)}
// Archetype picker on the place cards (#295 follow-up): None, the six, Random; the hint follows the pick
if(mode==='a'){setup.openSetup({first:true});await sleep(30);
  const {ARCHETYPES,ARCHETYPE_IDS}=await imp('src/data/archetypes.js');
  const asel=k=>all(ids.get('setup'),'select').find(s=>s.dataset.f==='arch:'+k);
  ok(all(ids.get('setup'),'.scard').every(c=>all(c,'select').some(s=>/^arch:/.test(s.dataset.f||''))),'archetype: one select per place card');
  const ov=asel('tank').childNodes.map(o=>o.value);
  ok(ov[0]===''&&ov[ov.length-1]==='random'&&ARCHETYPE_IDS.every(id=>ov.includes(id))&&ov.length===ARCHETYPE_IDS.length+2,'archetype: None, the six, Random -> '+ov.join());
  ok(asel('tank').value===''&&/own voice/.test(all(ids.get('setup'),'.scard')[0].textContent),'archetype: None by default, with its hint');
  let s1=asel('tank');s1.value='zealot';s1.dispatch('change',{target:s1});
  ok(asel('tank').value==='zealot'&&all(ids.get('setup'),'.scard')[0].textContent.includes(ARCHETYPES.zealot.voice),'archetype: the hint shows the voice of the pick');
  s1=asel('dps2');s1.value='random';s1.dispatch('change',{target:s1});
  ok(/picked from the seed/.test(all(ids.get('setup'),'.scard')[3].textContent),'archetype: Random explains itself');
  s1=asel('tank');s1.value='';s1.dispatch('change',{target:s1});s1=asel('tank');s1.value='veteran';s1.dispatch('change',{target:s1});
  ok(!/unknown archetype/.test(text(ids.get('setup'))),'archetype: no problem flagged for a legal pick');
  click(ids.get('setup'),b=>b.dataset.a==='start');
  const pend3=JSON.parse(localStorage.getItem(PENDING_KEY)||'null');
  ok(pend3&&pend3.heroes[0].archetype==='veteran'&&pend3.heroes[3].archetype==='random'&&!pend3.heroes[1].archetype,'archetype: Start queues the picks per place');
  localStorage.removeItem(PENDING_KEY)}
// Together / Apart, the hero count, start towns, groups and the shape presets (#454)
if(mode==='a'){setup.openSetup({first:true});await sleep(30);
  const R=()=>ids.get('setup'),pressed=(a,k,v)=>{const b=all(R(),'button').find(x=>x.dataset.a===a&&x.dataset[k]===v);return b&&b.getAttribute('aria-pressed')==='true'};
  const sel=f=>all(R(),'select').find(s=>s.dataset.f===f);
  ok(pressed('smode','mode','together')&&!pressed('smode','mode','apart'),'switch: Together is on by default');
  ok(!all(R(),'button').some(b=>b.dataset.a==='count')&&!sel('start:0'),'together: no hero count, no start towns');
  // the hall picker (#771): only where the faction has a choice of towns; a pick lasts until another faction or map
  {const change=(f,v)=>{const s=sel(f);s.value=v;s.dispatch('change',{target:s})},w0=sel('world').value,f0=sel('fac').value;
   change('world','eldmoor');ok(!sel('hall'),'hall: no picker with one town to choose');
   change('world','stepping');const o=sel('hall').childNodes.map(x=>x.value);ok(o[0]===''&&o.length===4,'hall: the default and the three towns of the faction: '+o);
   change('hall',o[2]);ok(sel('hall').value===o[2],'hall: the pick stands');
   change('fac',f0==='0'?'1':'0');ok(sel('hall').value==='','hall: another faction goes back to the default');
   change('fac',f0);change('world',w0)}
  click(R(),b=>b.dataset.a==='smode'&&b.dataset.mode==='apart');
  ok(pressed('smode','mode','apart')&&all(R(),'.scard').length===5,'Apart keeps the five heroes as cards');
  ok(all(R(),'button').filter(b=>b.dataset.a==='count').length===10&&pressed('count','n','5'),'Apart: hero count 1-10 (6-10 need local minds), five chosen');
  const so=sel('start:0').childNodes.map(o=>o.value),{CITY}=await imp('src/world/map.js');
  const fac0=+sel('hfac:0').value;
  ok(so[0]==='home'&&CITY.filter(c=>c.fac===fac0).every(c=>so.includes('town:'+c.name))&&!CITY.filter(c=>c.fac!==fac0).some(c=>so.includes('town:'+c.name)),'start towns are the CITY rows of the hero faction: '+so.slice(0,4));
  ok(so.some(v=>/^region:/.test(v)),'regions are offered too');
  click(R(),b=>b.dataset.a==='count'&&b.dataset.n==='3');
  ok(all(R(),'.scard').length===3&&pressed('count','n','3'),'hero count 3 -> three cards');
  click(R(),b=>b.dataset.a==='count'&&b.dataset.n==='1');
  ok(all(R(),'.scard').length===1&&!sel('group:0'),'one hero: no group picker');
  click(R(),b=>b.dataset.a==='count'&&b.dataset.n==='2');
  let g=sel('group:0');g.value='1';g.dispatch('change',{target:g});g=sel('group:1');g.value='1';g.dispatch('change',{target:g});
  const hs=sel('hfac:1');hs.value=String(1-fac0);hs.dispatch('change',{target:hs});
  ok(/one faction/.test(text(R())),'validation from validateSetup: a group of two factions is flagged');
  ok(all(R(),'button').find(b=>b.dataset.a==='start').disabled,'Start is disabled while it is');
  const hs2=sel('hfac:1');hs2.value=String(fac0);hs2.dispatch('change',{target:hs2});
  const town=CITY.filter(c=>c.fac===fac0)[0].name;let ss=sel('start:0');ss.value='town:'+town;ss.dispatch('change',{target:ss});
  ok(/one runner for the company of /.test(text(R())),'a group sharing a mind starts one company runner (#460)');
  click(R(),b=>b.dataset.a==='start');
  const pa=JSON.parse(localStorage.getItem(PENDING_KEY)||'null');
  ok(pa&&pa.v===2&&pa.mode==='apart'&&pa.heroes.length===2&&pa.heroes[0].start.town===town&&pa.heroes[0].group===1&&pa.heroes[1].group===1&&sim.validateSetup(pa).length===0,'Start queues the v2 apart setup');
  localStorage.removeItem(PENDING_KEY);
  setup.openSetup({first:false});
  ok(pressed('smode','mode','apart')&&all(R(),'.scard').length===2&&sel('start:0').value==='town:'+town,'a stored apart setup reopens as apart');
  click(R(),b=>b.dataset.a==='preset'&&b.dataset.name==='five-solos');
  ok(all(R(),'.scard').length===5&&sel('start:0').value==='home'&&!sel('group:0').value,'preset Five solos');
  click(R(),b=>b.dataset.a==='preset'&&b.dataset.name==='pairs-and-solo');
  ok(sel('group:0').value==='1'&&sel('group:1').value==='1'&&sel('group:2').value==='2'&&sel('group:4').value==='','preset Pairs and a solo groups the pairs');
  click(R(),b=>b.dataset.a==='preset'&&b.dataset.name==='solo');
  ok(all(R(),'.scard').length===1&&pressed('count','n','1'),'preset One hero');
  click(R(),b=>b.dataset.a==='smode'&&b.dataset.mode==='together');
  ok(all(R(),'.scard').length===5&&sel('cls:tank')&&pressed('smode','mode','together'),'back to Together: the classic five');
  click(R(),b=>b.dataset.a==='preset'&&b.dataset.name==='five-solos');
  click(R(),b=>b.dataset.a==='preset'&&b.dataset.name==='classic');
  ok(all(R(),'.scard').length===5&&sel('cls:tank'),'preset Classic five is Together');
  // phone width: one column of cards (CSS) and nothing in the switch row that is wider than the screen
  const css=(await import('node:fs')).readFileSync(path.join(repo,'src/style.css'),'utf8');
  ok(/@media \(max-width:520px\)\{[^}]*\.scards[^}]*minmax\(0,1fr\)/.test(css)&&/\.sswitch/.test(css),'phone: single column cards and a wrapping switch row')}
if(mode==='b'){const t=SLT.slotMembers(SLT.slotted()).find(m=>m.slot==='tank').hero;
  ok(t.persona&&t.persona.archetype==='veteran','archetype: the queued pick is applied at founding')}
if(mode==='d'){
  // an apart setup boots and starts one company runner per pair sharing a mind and a hero runner for the solo (#460)
  const s0=sim.applyPreset('pairs-and-solo',sim.defaultSetup(4242,'eldmoor',0));s0.dm={mode:'scripted'};const s=sim.cleanSetup(s0);
  localStorage.setItem(PENDING_KEY,JSON.stringify(s));
  boot(sim.init);
  ok(bootKind()==='setup'&&appliedSetup().mode==='apart','boot applies the queued apart setup');
  setup.initSetup();ctl.speed=1;
  await setup.afterBoot();
  const hp=posts.filter(x=>x.body.kind==='hero'),cp=posts.filter(x=>x.body.kind==='company');
  ok(hp.length===1&&cp.length===2,'two company runners (the pairs) and one hero runner (the solo): '+posts.map(x=>x.body.kind));
  const co=sim.S.companies||[];
  ok(new Set(cp.map(x=>x.body.company)).size===2&&cp.every(x=>{const C=co.find(c=>c.id===x.body.company);return C&&C.ids.length===2&&C.ids.every(id=>sim.S.agents.find(a=>a.id===id&&a.player))}),'each company runner names its own company of two agent-played heroes');
  ok(hp.every(x=>{const a=sim.S.agents.find(a=>a.id===x.body.hero&&a.player);const C=a&&co.find(c=>c.id===a.company);return C&&C.ids.length===1}),'the hero runner names the agent-played solo');
}
console.log(fail?fail+' FAILED':'smoke133 '+mode+' passed');process.exit(fail?1:0);
