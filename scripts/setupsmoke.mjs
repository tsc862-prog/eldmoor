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
  ok(JSON.stringify(opts('cls:tank'))==='["Warrior"]'&&JSON.stringify(opts('cls:healer'))==='["Priest"]','tank/healer classes fixed');
  ok(opts('cls:dps1').join()==='Mage,Hunter,Rogue','DPS classes: '+opts('cls:dps1'));
  ok(/Relay/.test(text(ids.get('setup'))),'relay line');
  ok(!all(ids.get('setup'),'button').some(b=>/All scripted/.test(b.textContent)),'no All scripted preset (#148: the Fellowship is always agent-played)');
  ok(all(ids.get('setup'),'.scard').every(c=>!all(c,'button').some(b=>b.dataset.a==='mode')),'no Scripted / AI buttons on a member card, only its model');
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
  click(ids.get('setup'),b=>b.dataset.a==='start');
  const pend=JSON.parse(localStorage.getItem(PENDING_KEY)||'null');
  ok(pend&&pend.world==='eldmoor'&&reloads===1&&pend.slots.tank.mind.mode==='agent','Start queues the setup and reloads');
  ok(sim.validateSetup(pend).length===0,'the queued setup validates');
  localStorage.removeItem(PENDING_KEY);reloads=0;
  click(ids.get('setup'),b=>b.dataset.a==='cancel');writeSave();ok(!!localStorage.getItem(SAVE_KEY),'a save exists');
  setup.openSetup({first:false});
  click(ids.get('setup'),b=>b.dataset.a==='start');
  ok(/Replace the saved/.test(text(ids.get('setup')))&&reloads===0&&!localStorage.getItem(PENDING_KEY),'with a save, Start asks before replacing');
  click(ids.get('setup'),b=>b.dataset.a==='back');
  ok(!/Replace the saved/.test(text(ids.get('setup')))&&reloads===0,'Back keeps everything');
  click(ids.get('setup'),b=>b.dataset.a==='start');
  click(ids.get('setup'),b=>b.dataset.a==='go');
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
  ok(reloads===1&&!localStorage.getItem(SAVE_KEY)&&!!localStorage.getItem(PENDING_KEY),'Start does not ask a second time: the save goes and the setup is queued');
  ok(title.titleWanted('')===false,'the reload into the queued setup skips the title');
  localStorage.removeItem(PENDING_KEY);
  // Continue
  save.holdSave(false);save.writeSave();played=[];title.showTitle(k=>played.push(k));t=ids.get('title');
  click(t,b=>b.dataset.a==='continue');ok(played.join()==='continue','Continue resumes the save');
}else{
  const s=sim.cleanSetup(sim.applyPreset('claude',sim.defaultSetup(777,'eldmoor',0)));
  localStorage.setItem(PENDING_KEY,JSON.stringify(s));
  boot(sim.init);
  ok(bootKind()==='setup'&&appliedSetup().seed===777,'boot applies the queued setup');
  const mem=sim.fellowshipMembers().map(m=>m.hero);
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
  ok(pend2&&pend2.slots.tank.profs.join()==='smithing'&&!pend2.slots.healer.profs,'Start queues the choice for that place only');
  localStorage.removeItem(PENDING_KEY)}
console.log(fail?fail+' FAILED':'smoke133 '+mode+' passed');process.exit(fail?1:0);
