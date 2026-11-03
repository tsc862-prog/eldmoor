// Table mode banner and switch (issue #68, phase B). Reads sim/table.js only.
//   banner  over the map while the Fellowship is at a scene: the scene, the DM's framing (with
//           the dice when it is a check), initiative order with the current turn marked, whose
//           turn it is ("Pellora is thinking… (5 s)") and the last act, then the outcome; a scene where everyone
//           answers at once shows EVERYONE ANSWERS and "3/5 answered · waiting for Fena, Maelell"
//   combat  a combat scene with rounds (#277, part 2 of #140): ROUND n/3 in the title row, the initiative order as
//           chips (name, HP bar and %, conditions) with the foe at its place and the current actor marked, the rolls
//           of the round as it plays (d20, bonus, AC, hit/miss/crit, damage), and at the end why it ended
//   step    in a combat scene, a small button cycles the watcher's round pace (TABLE.step, #285): "Rounds: run on",
//           "Rounds: pause after each" (the world waits after each round until Next round) and "Rounds: pause N s" (Next
//           round, or on its own after TABLE.stepS seconds; worded for the owner in #546); kept per viewer in localStorage. The rolls are the beats' roll data.
//   switch  the View group's "Table: Auto / Off" button (Off = Watch mode, never pauses); kept
//           per viewer in localStorage
// Companies (#456): with more than one company the chip row starts with whose table it is ("At the table: Dovas and
// Ilsa", "Ketter, alone"); a scene of a company the watcher does not follow makes it a button that follows that company.
// One company (the default world) shows no name, as before.
// Followed pause (#458): a scene of a company the watcher does not follow plays on the live clock (the world does not
// pause), so the banner is one line, "Scene at Mirefen: Dovas and company", a button that follows that company (its scene
// then pauses the world and the full banner opens). The Settings row "Pause: followed / any company" (S.pauseAll, saved
// with the world) shows with two or more companies.
// Legibility (#471): a short pixel-font title (the kind and a few words, sceneHead), the status tags as a chip row of their
// own, the full question as wrapping body text, and outside combat one row per member (memberRows): name in class colour,
// answered or waiting, the vote or option chosen, and the nudge or reflex timer. Combat keeps its initiative chips.
// Scene map polish (#536): a placed person is named without their role ("Father Corvane", the role "stranger" a dim word
// after the name on the staged line; unrole cleans lines written before); an option shows as a short label (shortLabel:
// the DM's own label, else a few words per action, never cut mid-word) with the full text on hover; the DM's lines at the
// table are a short list (narrLines: the last NARR_KEEP of the scene, so a whisper's "leans close" no longer replaces the
// person's words). With the indoor scene map open the banner docks beside the map (below it on a phone; style.css
// .screen.scin).
// Several scenes (#518): every other company's open scene is one more line under the banner ("Scene at Mirefen: Dovas and
// company", a button that follows that company), so the watcher sees every live table at once.
import {TABLE,bannerOf,stepNext,optionsFor,pauseAll,setPauseAll,openScenes} from '../sim/table.js';
import {reflexMay,ownerHeld} from '../sim/runlink.js';
import {classColor} from '../core/colors.js';
import {sceneHead} from '../core/scenehead.js';
export {sceneHead};
import {unrole} from '../core/spoken.js';
import {S} from '../sim/index.js';
import {TR} from '../sim/tableround.js';
import {maxHp} from '../sim/heroes.js';
import {effOn,condOn} from '../sim/eff.js';
import {CONDITIONS,MOVES} from '../data/moves.js';
import {patch} from './stable.js'; // update in place (#145)
import {companies,companyById,members,leaderOf,slotted} from '../sim/company.js';
import {followedCompany,followCompany} from './companyview.js'; // whose table it is (#456)
import {setView} from './controls.js';
import {styled} from '../sim/epithet.js'; // a name given for a deed (bestow, #638)

const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
const plain=ps=>(ps||[]).map(p=>typeof p==='string'?p:p&&p.kind==='hero'?p.name:p&&p.t||'').join('');
const KEY='eldmoor.tableMode',STEP='eldmoor.tableStep',STEPS=['off','hold','auto'];
let sig='';

// A short 8-bit cue when a scene opens (Web Audio, no files). Talk scenes rise on a triangle wave, combat scenes
// (elite, ambush, boss, rescue) are a sharper square triple. Silent until the page has had a click or key press.
const SND='eldmoor.tableSound',COMBAT={elite:1,ambush:1,boss:1,rescue:1};
let snd=true,ctx=null,gesture=false,lastScene=null;
try{if(localStorage.getItem(SND)==='off')snd=false}catch(_){}
function wake(){gesture=true;try{const AC=window.AudioContext||window.webkitAudioContext;if(!ctx&&AC)ctx=new AC();if(ctx&&ctx.state==='suspended')ctx.resume()}catch(_){}}
function chime(kind){if(!snd||!gesture||!ctx||ctx.state!=='running')return;
  try{const fight=!!COMBAT[kind],t0=ctx.currentTime+.02,notes=fight?[[392,0],[523.25,.12],[659.25,.24]]:[[523.25,0],[783.99,.18]];
    for(const [f,dt] of notes){const o=ctx.createOscillator(),g=ctx.createGain();o.type=fight?'square':'triangle';o.frequency.value=f;
      g.gain.setValueAtTime(0,t0+dt);g.gain.linearRampToValueAtTime(fight?.05:.08,t0+dt+.02);g.gain.exponentialRampToValueAtTime(.0008,t0+dt+(fight?.14:.22));
      o.connect(g).connect(ctx.destination);o.start(t0+dt);o.stop(t0+dt+.25)}}catch(_){}}
// A distinct falling cue for the runner-stop alert (ui/runalert.js); respects the Sound switch.
export function alertCue(){if(!snd||!gesture||!ctx||ctx.state!=='running')return;
  try{const t0=ctx.currentTime+.02;[[440,0],[349.23,.14],[261.63,.28]].forEach(([f,dt])=>{const o=ctx.createOscillator(),g=ctx.createGain();o.type='sawtooth';o.frequency.value=f;
    g.gain.setValueAtTime(0,t0+dt);g.gain.linearRampToValueAtTime(.05,t0+dt+.02);g.gain.exponentialRampToValueAtTime(.0008,t0+dt+.16);o.connect(g).connect(ctx.destination);o.start(t0+dt);o.stop(t0+dt+.2)})}catch(_){}}
function syncSnd(){const b=$('vSnd');if(!b)return;b.hidden=!slotted();b.textContent='Sound: '+(snd?'on':'off');b.setAttribute('aria-pressed',String(snd))}

function syncPause(){const b=$('vPause'),r=b&&b.closest?b.closest('.setrow'):null;if(!b)return;const on=pauseAll(),show=companies().length>1;
  if(r&&r.hidden===show)r.hidden=!show;const t='Pause: '+(on?'any company':'followed');if(b.textContent!==t){b.textContent=t;b.setAttribute('aria-pressed',String(on))}}
function syncBtn(){const b=$('vTab');if(!b)return;b.hidden=!slotted();b.textContent='Table: '+(TABLE.mode==='off'?'Off':'Auto');b.setAttribute('aria-pressed',String(TABLE.mode!=='off'))}
export function initTable(){
  try{const v=localStorage.getItem(KEY);if(v==='off'||v==='auto')TABLE.mode=v}catch(_){}
  try{const v=localStorage.getItem(STEP);if(STEPS.includes(v))TABLE.step=v}catch(_){}
  const b=$('vTab');if(b)b.onclick=()=>{TABLE.mode=TABLE.mode==='off'?'auto':'off';try{localStorage.setItem(KEY,TABLE.mode)}catch(_){}syncBtn()};
  const p=$('vPause');if(p)p.onclick=()=>{setPauseAll(!pauseAll());syncPause();sig=''};
  const s=$('vSnd');if(s)s.onclick=()=>{snd=!snd;try{localStorage.setItem(SND,snd?'on':'off')}catch(_){}if(snd)wake();syncSnd()};
  for(const ev of ['pointerdown','keydown'])document.addEventListener(ev,wake,{capture:true});
  syncBtn();syncSnd();syncPause()}

// ---- the combat block (#277) ----
const byId=id=>S.agents.find(x=>x.id==id)||null;
const pct=(hp,mx)=>mx>0?Math.max(0,Math.min(100,Math.round(hp/mx*100))):0;
// Conditions worth a glance: timed effects (sim/eff.js), who the foe has drawn, who fell or fell back.
function condsOf(a,sc,f){const c=[];if(a.state==='dead')return ['fallen'];if((sc.out||[]).includes(a.id))c.push('fell back');
  if(effOn(a,'taken'))c.push(a.eff.taken.v<1?'warded':'exposed');if(effOn(a,'mark'))c.push('marked');
  for(const id of ['stun','root','poison'])if(condOn(a,id))c.push(CONDITIONS[id].name.toLowerCase()); // Table conditions (#296)
  if(f&&f.target===a.id)c.push('drawn');return c}
// The block as plain data (also the change signature): null outside a combat scene with rounds.
// The foe (bannerOf().foe: name, hp, maxhp, target id, pack) and each roll (beat.roll) come from the sim as data (#285).
export function combatView(){const sc=S.table;if(!sc||sc.rd==null)return null;const b=bannerOf(),f=b&&b.foe,cur=b&&b.who;
  const foeNow=sc.phase==='turn'&&!sc.fd&&sc.i>=sc.foeAt&&!!f;
  const mem=sc.ids.map(byId).filter(Boolean).map(a=>({name:styled(a),hp:pct(a.hp,maxHp(a)),cond:condsOf(a,sc,f),cur:!foeNow&&a===cur,down:a.state==='dead'||(sc.out||[]).includes(a.id)}));
  const foe=f?{name:f.name,foe:true,hp:pct(f.hp,f.maxhp),cond:[...(f.pack>1?['pack of '+f.pack]:[]),...(f.conds||[]).map(id=>CONDITIONS[id].name.toLowerCase())],cur:foeNow,down:false}:null;
  // the round in play (or the last one at a round's start): the class move each member used, by name (#390)
  let rd0=sc.rd;if(rd0>1&&!sc.beats.some(x=>(x.rd||1)===rd0))rd0--;
  for(const x of mem)x.mv='';
  sc.beats.forEach(x=>{if((x.rd||1)!==rd0||x.by==='foe'||x.by==='cond'||!MOVES[x.k])return;const i=sc.ids.map(byId).filter(Boolean).findIndex(a=>a.id===x.id);if(i>=0)mem[i].mv=MOVES[x.k].name});
  const order=mem.slice();if(foe)order.splice(Math.min(sc.foeAt,order.length),0,foe);
  // the rolls of the round in play; at a round's start (nothing rolled yet) the last round's, marked as such
  let rd=sc.rd;if(rd>1&&!sc.beats.some(x=>(x.rd||1)===rd))rd--;
  const rolls=sc.beats.filter(x=>(x.rd||1)===rd).map(x=>({by:x.name,foe:x.by==='foe',text:x.text,res:x.res||'',r:x.roll||null,c:x.check||null}));
  let ends=null;if(sc.phase==='outcome'){ends=[];const fell=(sc.fell||[]).map(byId).filter(Boolean).map(a=>a.name),back=sc.beats.filter(x=>x.k==='retreat').map(x=>x.name);
    if(sc.end==='yield')ends.push(['The foe yields','win']);else if(sc.end==='fled')ends.push(['The foe fled','win']);else if(!f)ends.push(['The foe is down','win']);
    for(const n of fell)ends.push([n+' fell','loss']);for(const n of back)ends.push([n+' fell back','']);
    if(f&&!sc.end)ends.push([sc.rd>=TR.ROUNDS?TR.ROUNDS+' rounds: the fight goes on':'The foe still stands',''])}
  return {round:sc.rd,of:TR.ROUNDS,order,rolls,rolled:rd,prev:rd!==sc.rd,ends,step:TABLE.step,hold:b.hold||null}}
const SHOW=4; // roll lines in view (the phone shows the last 3)
function combatBlock(box,c){
  const o=el('div','tcinit');o.setAttribute('role','list');o.setAttribute('aria-label','Initiative order');
  for(const x of c.order){const ch=el('span','tci'+(x.foe?' foe':'')+(x.cur?' cur':'')+(x.down?' down':''));ch.setAttribute('role','listitem');
    ch.append(el('span','tcn',(x.cur?'▶ ':'')+x.name));const bar=el('span','tchp'),i=el('i');i.style.width=x.hp+'%';if(x.hp<25)i.className='lo';bar.append(i);
    ch.setAttribute('aria-label',x.name+(x.foe?' (foe)':'')+', '+x.hp+'% health'+(x.cond.length?', '+x.cond.join(', '):'')+(x.mv?', used '+x.mv:'')+(x.cur?', acting now':''));
    ch.append(bar,el('span','tcp',x.hp+'%'));for(const k of x.cond)ch.append(el('span','tcc',k));if(x.mv)ch.append(el('span','tcm',x.mv));o.append(ch)}
  box.append(o);
  if(!c.rolls.length)return;const L=el('div','trolls'),hid=Math.max(0,c.rolls.length-SHOW);
  L.append(el('div','trh',(c.prev?'Last round ('+c.rolled+')':'Round '+c.rolled)+(hid?' · '+hid+' earlier':'')));
  for(const x of c.rolls.slice(-SHOW)){const r=x.r,row=el('div','trl'+(x.foe?' foe':'')+(r?r.crit?' crit':r.hit?' hit':' miss':x.c?x.c.hit?' hit':' miss':''));
    row.append(el('b',null,x.by),' '+x.text+' ');
    if(r){row.append(el('span','trd','d20 '+r.die+'+'+r.mod+'='+r.total+' vs '+r.vs),' ',el('span','trr',r.crit?'CRIT '+r.dmg:r.hit?'HIT '+r.dmg:r.die===1?'FUMBLE':'MISS'));
      if(r.down)row.append(' ',el('span','trr fall','FALLS'))}
    else if(x.c){const k=x.c,w=k.kind==='parley'?{yield:'YIELDS',flee:'RUNS',hold:'HOLDS'}[k.result]:k.hit?'SAVED':'HELD'; // a parley or a save (#296)
      row.append(el('span','trd',(k.kind==='parley'?k.skill+' ':'save ')+'d20 '+k.die+(k.mod<0?'':'+')+k.mod+'='+k.total+' vs DC '+k.vs),' ',el('span','trr',w))}
    else if(x.res)row.append(el('span','trd',x.res));
    L.append(row)}
  box.append(L)}
// The watcher's round pace (#285): the mode button, and Next round while a round is held.
// #546: the button says what it does in words ("Rounds: run on / pause after each / pause N s"), with a small label.
const STEP_TXT={off:'Rounds: run on',hold:'Rounds: pause after each',auto:'Rounds: pause '+TABLE.stepS+' s'};
const STEP_TIP={off:'The rounds play on without a stop. Click: pause after each round until you press Next round',hold:'The fight stops after each round until you press Next round. Click: pause '+TABLE.stepS+' s after each round, then go on',auto:'After each round the fight waits '+TABLE.stepS+' s (or Next round), then goes on. Click: let the rounds run on'};
function stepRow(box,c){const d=el('div','tstep'),k=STEP_TXT[c.step]?c.step:'off',m=el('button','tstb',STEP_TXT[k]);m.type='button';m.dataset.act='step';
  m.title=STEP_TIP[k];m.setAttribute('aria-label','Round pace: '+STEP_TXT[k].replace(/^Rounds: /,'')+'. Click to change');d.append(el('span','tsth','ROUND PACE'),m);
  if(c.hold){const n=el('button','tstb tnext','Next round ▶'+(c.hold.auto?' ('+c.hold.left+' s)':''));n.type='button';n.dataset.act='next';d.append(n)}
  box.append(d)}
function onBox(e){const t=e.target&&e.target.closest?e.target.closest('[data-act]'):null;if(!t)return;
  if(t.dataset.act==='step'){TABLE.step=STEPS[(STEPS.indexOf(TABLE.step)+1)%STEPS.length];try{localStorage.setItem(STEP,TABLE.step)}catch(_){}sig=''}
  else if(t.dataset.act==='next'){stepNext();sig=''}
  else if(t.dataset.act==='follow'||t.dataset.act==='live'){followCompany(companyById(+t.dataset.co));setView('fellow');sig=''}}
// Whose table it is, or null with one company (#456): {text, id, followed}.
// The one-line banner of a scene on the live clock (#458), or null: {text, id}.
// Every other company's open scene as a line (#518): the same words as a live scene's line.
export function otherLines(){const out=[];for(const sc of openScenes().slice(1)){const x=liveLine({...bannerOf(sc),live:true});if(x)out.push(x)}return out}
function liveBtn(box,x){const o=el('button','tlvb',x.text+' ▸');o.type='button';o.dataset.act='live';o.dataset.co=x.id;o.title='Follow this company: its scene then pauses the world and opens here';box.append(o)}
export function liveLine(b){if(!b||!b.live||b.company==null)return null;const C=companyById(b.company),L=C?members(C):[],lead=C?leaderOf(C)||L[0]:null;
  const who=lead?(L.length>1?lead.name+' and company':lead.name+', alone'):(b.companyName||'A company');
  return {text:'Scene at '+(b.where||'the road')+': '+who,id:b.company}}
export function tableOwner(b){if(!b||b.company==null||companies().length<2)return null;const name=b.companyName||'A company',F=followedCompany();
  return {text:b.solo?name+', alone':'At the table: '+name,id:b.company,followed:!!F&&F.id===b.company}}
function endBlock(box,c){if(!c.ends||!c.ends.length)return;const d=el('div','tend');d.setAttribute('aria-label','How the fight ended');
  for(const [t,k] of c.ends)d.append(el('span','tendc'+(k?' '+k:''),t));box.append(d)}

// ---- the chips and the member rows (#471); the short title is core/scenehead.js ----
// The status tags as data: [{t, k}] (k: round | paused | all).
export function sceneChips(b,c){const o=[];if(c)o.push({t:'Round '+c.round+'/'+c.of,k:'round'});if(b.paused)o.push({t:'World paused',k:'paused'});if(b.all)o.push({t:'Everyone answers',k:'all'});return o}
const shortOpt=t=>String(t||'').split(/ \(|: /)[0].replace(/^Ability, /,'');
// Cut at a word, never inside one (#536).
export const cutWords=(t,n=28)=>{t=String(t==null?'':t).trim();if(t.length<=n)return t;const i=t.lastIndexOf(' ',n);return (i>=n/3?t.slice(0,i):t.slice(0,n)).replace(/[,;:.\s]+$/,'')+'…'};
// A staged scene's actions in a few words (the sim's text names the person in full: "Offer Father Corvane your help").
const SHORT={hear:'Hear them out',help:'Offer help',pass:'Ride on',leave:'Leave',parley:'Talk them round',press:'Lean on them',spot:'Look for the trigger',disarm:'Work it loose',round:'Lead the others round',study:'Study the marks',search:'Search the place'};
export function shortLabel(sc,k,text){const c=sc&&sc.ctx,L=c&&c.labels;if(L&&L[k])return cutWords(L[k]);
  if(c&&c.staged!=null&&SHORT[k])return k==='leave'&&sc.kind==='social'?'Walk away':SHORT[k];
  return cutWords(shortOpt(text))}
// Placed people at the scene (#536): their role titles are not part of their names.
function peopleAt(sc){const id=sc&&sc.ctx&&sc.ctx.npc;if(id==null)return [];const w=(S.wanderers||[]).find(x=>x.id===id);return w&&w.title&&w.name?[{title:w.title,name:w.name,role:w.title}]:[]}
function answerOf(sc,a,act){if(sc.kind==='decision'&&(act.k==='yes'||act.k==='no'))return {ans:act.k.toUpperCase(),tone:act.k};
  if(act.k==='stunned')return {ans:'Stunned',tone:'no'};
  let o=null;try{o=optionsFor(sc,a).find(x=>x.k===act.k)}catch(_){}
  const full=o?unrole(o.text,peopleAt(sc)):'';
  return {ans:o?shortLabel(sc,act.k,full):String(act.k||'').replace(/^use:/,'use '),tone:'opt',full}}
// The DM's lines at this table, oldest first (#536): sc.narr holds only the latest, so the banner keeps the last few per
// scene; the frame itself (said as the first line) is not repeated.
const NARR_KEEP=4;let narrLog={id:null,lines:[],last:null};
export function narrLines(sc=S.table){if(!sc){narrLog={id:null,lines:[],last:null};return []}
  if(narrLog.id!==sc.id)narrLog={id:sc.id,lines:[],last:null};
  const n=sc.narr,key=n?n.t+'|'+n.text:null;
  if(n&&n.text&&key!==narrLog.last){narrLog.last=key;const t=unrole(n.text,peopleAt(sc)),fr=plain(sc.frame).trim();
    if(t.trim()!==fr&&narrLog.lines[narrLog.lines.length-1]!==t){narrLog.lines.push(t);if(narrLog.lines.length>NARR_KEEP)narrLog.lines.shift()}}
  return narrLog.lines.slice()}
const secs=n=>Math.max(0,Math.ceil(n))+' s';
// One row per member at a scene without combat rounds: {id, name, color, st, ans, tone, line, by, timer}, in the scene's order.
// st: done (answered or acted), wait (an agent is thinking), held (no runner: the owner decides), reflex (plays by reflex),
// turn (acting now in a turn-by-turn scene), next (still to act), fallen, out (the scene ended without an answer).
export function memberRows(){const sc=S.table;if(!sc||sc.rd!=null)return null;const out=[],live=sc.phase==='turn'||sc.phase==='frame';
  sc.ids.forEach((id,i)=>{const a=byId(id);if(!a)return;const act=sc.acts&&sc.acts[id],r={id,name:styled(a),cls:a.cls,color:classColor(a.cls),st:'',ans:'',tone:'',full:'',line:'',by:'',timer:''};
    if(a.state==='dead')r.st='fallen';
    else if(act){Object.assign(r,answerOf(sc,a,act));r.st='done';r.line=act.line||'';r.by=act.by||''}
    else if(!live||sc.resolved)r.st='out';
    else if(sc.all||sc.ids[sc.i]===id){const t=sc.all?((sc.w&&sc.w[id]&&sc.w[id].t)||0):sc.t||0;
      if(sc.phase==='frame')r.st=sc.all?'wait':'turn';
      else if(ownerHeld(a))r.st='held';else if(reflexMay(a))r.st=sc.all?'reflex':'turn';
      else{r.st=sc.all?'wait':'turn';r.timer=t*1000>=TABLE.turnMs?'reflex in '+secs(TABLE.liveMs/1000-t):t>=1?secs(t):''}}
    else r.st=i<sc.i?'out':'next';
    out.push(r)});
  return out}
const ST_TXT={wait:'thinking',held:'no runner',reflex:'reflex',turn:'acting',next:'to act',fallen:'fallen',out:'no answer'};
function rowsBlock(box,rows,b){const all=!!b.all,n=rows.filter(r=>r.st==='done').length,of=rows.filter(r=>r.st!=='fallen').length;
  const L=el('div','tmem');L.setAttribute('role','list');L.setAttribute('aria-label',all?'Answers':'Turn order');
  L.append(el('div','tmh',all?'Answers '+n+'/'+of:'Turn order'));
  for(const r of rows){const d=el('div','tmr st-'+r.st);d.dataset.k='m'+r.id;d.setAttribute('role','listitem');
    const sw=el('i','tmsw');sw.style.background=r.color;const nm=el('span','tmn',(r.st==='turn'?'▶ ':'')+r.name);nm.style.color=r.color;d.append(sw,nm);
    if(r.st==='done'){const a=el('span','tma '+r.tone,r.ans);if(r.full)a.title=r.full;d.append(a);if(r.by==='reflex')d.append(el('span','tmby','reflex'))}
    else d.append(el('span','tms',ST_TXT[r.st]||r.st));
    const q=el('span','tmq',r.line?'“'+r.line+'”':'');if(r.line)q.title=r.line;d.append(q);
    d.append(el('span','tmt',r.timer));
    d.setAttribute('aria-label',r.name+': '+(r.st==='done'?r.ans+(r.by==='reflex'?' (reflex)':''):ST_TXT[r.st]||r.st)+(r.timer?', '+r.timer:'')+(r.line?', says '+r.line:''));
    L.append(d)}
  box.append(L)}
// The status line repeats what the rows show while members are being waited on: drop it then (one place per fact).
const rowsSay=(b,rows)=>!!rows&&b.phase==='turn'&&(b.all?/^\d+\/\d+ answered/.test(b.line)&&!/no runner/.test(b.line):/is thinking/.test(b.line||''));

// Called every frame with the host's speed: the sim pauses only at 1x.
export function renderTable(speed){TABLE.speed=speed>0?speed:1;syncBtn();syncSnd();syncPause();
  const box=$('tbanner');if(!box)return;if(!box._tstep){box._tstep=1;box.addEventListener('click',onBox)}
  const b=bannerOf();if(!b){lastScene=null;if(!box.hidden){box.hidden=true;sig=''}return}
  if(S.table.id!==lastScene&&!b.live){lastScene=S.table.id;if(TABLE.speed<=1)chime(S.table.kind)} // chime when the scene stops the world, also on following into it
  const ll=liveLine(b),more=otherLines(),ms=more.map(x=>x.text+'/'+x.id).join('|');box.classList.toggle('tlive',!!ll);
  if(ll){const s='live|'+ll.text+'|'+ll.id+'|'+ms;if(s===sig)return;sig=s;box.hidden=false;box.classList.remove('tcombat');patch(box,box=>{
    for(const x of [ll,...more])liveBtn(box,x)},{force:true});return}
  const c=combatView(),rows=c?null:memberRows(),hd=sceneHead(b.kind,b.title),chips=sceneChips(b,c),own=tableOwner(b),ppl=peopleAt(S.table),narrs=narrLines(S.table);
  const s=[b.title,b.phase,b.line,b.last,b.turn,b.paused,ms,narrs.join('¦'),b.cast&&b.cast.join(','),c?JSON.stringify(c):'',rows?JSON.stringify(rows):'',own?own.text+own.followed:''].join('|');if(s===sig)return;sig=s;box.hidden=false;box.classList.toggle('tcombat',!!c);patch(box,box=>{
  const tt=el('div','tt'),th=el('span','tth',hd.head.toUpperCase());th.title=b.title;tt.append(th);box.append(tt);
  if(S.table&&(S.table.kind==='crawl'||S.table.kind==='site')){const sid=S.table.ctx&&S.table.ctx.site,v=el('button','tstb tdg',sid!=null?'View the dungeon ▸':'View the crypt ▸');v.type='button';v.dataset.dungeon=sid!=null?'site:'+sid:'';v.title='Open the dungeon view';tt.append(v)} // #85; a DM-made site's crawl opens the site (#642)
  else if(S.table){const v=el('button','tscn','Scene map ▸');v.type='button';v.dataset.scene='';v.title='Show the scene on its own map, or back to the world';tt.append(v)} // scene maps (#431)
  if(chips.length||own){const ch=el('div','tchips');
    if(own){const o=el(own.followed?'span':'button','tco'+(own.followed?'':' tcob'),own.text);if(!own.followed){o.type='button';o.dataset.act='follow';o.dataset.co=own.id;o.title='Follow this company: the camera, the frames and the sheet turn to it'}ch.append(o)}
    for(const x of chips)ch.append(el('span','tp t'+x.k,x.t.toUpperCase()));box.append(ch)}
  const fr=unrole(plain(b.frame),ppl);if(hd.cut&&!fr.toLowerCase().includes(hd.full.toLowerCase()))box.append(el('div','tq',hd.full)); // the whole title when the pixel title cut it and the frame does not say it
  box.append(el('div','tf',fr));
  if(narrs.length){const L=el('ul','tnarrs');L.setAttribute('aria-label','At the table');narrs.forEach((t,i)=>{const li=el('li','tf tnarr'+(i<narrs.length-1?' old':''),t);li.dataset.k='n'+i;L.append(li)});box.append(L)} // the DM's lines at the table (#123), the last few (#536)
  if(b.cast&&b.cast.length){const o=el('div','to tcast','Staged by the DM');for(const x of b.cast){const u=unrole(x,ppl),p=ppl.find(q=>u===q.name||u.startsWith(q.name+' ('));o.append(' · ',u);if(p)o.append(' ',el('span','trole',p.role.toLowerCase()))}box.append(o)} // a staged scene's cast (#132), the role a dim word (#536)
  if(c){combatBlock(box,c);box.append(el('div','tl',b.line));if(!c.ends)stepRow(box,c);endBlock(box,c);for(const x of more)liveBtn(box,x);return} // the roll lines take the last-act line's place
  if(rows&&rows.length)rowsBlock(box,rows,b);
  const hint=rows&&b.all&&b.phase==='turn'&&/^\d+\/\d+ answered/.test(b.line)?(b.line.match(/\(([^()]*no runner[^()]*)\)$/)||[])[1]:null; // the rows say who waits; keep only what to do
  if(hint)box.append(el('div','tl',hint));else if(!rowsSay(b,rows))box.append(el('div','tl',b.line));if(b.last&&b.phase!=='outcome'&&!b.all)box.append(el('div','to',unrole(b.last,ppl)));
  for(const x of more)liveBtn(box,x)},{force:true})} // other companies' scenes, a line each (#518)
