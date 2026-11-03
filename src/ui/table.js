// Table mode banner and switch (issue #68, phase B). Reads sim/table.js only.
//   banner  over the map while the Fellowship is at a scene: the scene, the DM's framing (with
//           the dice when it is a check), initiative order with the current turn marked, whose
//           turn it is ("Pellora is thinking… (5 s)") and the last act, then the outcome; a scene where everyone
//           answers at once shows EVERYONE ANSWERS and "3/5 answered · waiting for Fena, Maelell"
//   combat  a combat scene with rounds (#277, part 2 of #140): ROUND n/3 in the title row, the initiative order as
//           chips (name, HP bar and %, conditions) with the foe at its place and the current actor marked, the rolls
//           of the round as it plays (d20, bonus, AC, hit/miss/crit, damage), and at the end why it ended
//   step    in a combat scene, a small button cycles the watcher's round pace (TABLE.step, #285): Step off (rounds
//           run on), Step: hold (the world waits after each round until Next round) and Step: auto (Next round, or on
//           its own after TABLE.stepS seconds); kept per viewer in localStorage. The rolls are the beats' roll data.
//   switch  the View group's "Table: Auto / Off" button (Off = Watch mode, never pauses); kept
//           per viewer in localStorage
import {TABLE,bannerOf,stepNext} from '../sim/table.js';
import {S} from '../sim/index.js';
import {TR} from '../sim/tableround.js';
import {maxHp} from '../sim/heroes.js';
import {effOn,condOn} from '../sim/eff.js';
import {CONDITIONS,MOVES} from '../data/moves.js';
import {patch} from './stable.js'; // update in place (#145)

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
function syncSnd(){const b=$('vSnd');if(!b)return;b.hidden=!S.fellowship;b.textContent='Sound: '+(snd?'on':'off');b.setAttribute('aria-pressed',String(snd))}

function syncBtn(){const b=$('vTab');if(!b)return;b.hidden=!S.fellowship;b.textContent='Table: '+(TABLE.mode==='off'?'Off':'Auto');b.setAttribute('aria-pressed',String(TABLE.mode!=='off'))}
export function initTable(){
  try{const v=localStorage.getItem(KEY);if(v==='off'||v==='auto')TABLE.mode=v}catch(_){}
  try{const v=localStorage.getItem(STEP);if(STEPS.includes(v))TABLE.step=v}catch(_){}
  const b=$('vTab');if(b)b.onclick=()=>{TABLE.mode=TABLE.mode==='off'?'auto':'off';try{localStorage.setItem(KEY,TABLE.mode)}catch(_){}syncBtn()};
  const s=$('vSnd');if(s)s.onclick=()=>{snd=!snd;try{localStorage.setItem(SND,snd?'on':'off')}catch(_){}if(snd)wake();syncSnd()};
  for(const ev of ['pointerdown','keydown'])document.addEventListener(ev,wake,{capture:true});
  syncBtn();syncSnd()}

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
  const mem=sc.ids.map(byId).filter(Boolean).map(a=>({name:a.name,hp:pct(a.hp,maxHp(a)),cond:condsOf(a,sc,f),cur:!foeNow&&a===cur,down:a.state==='dead'||(sc.out||[]).includes(a.id)}));
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
const STEP_TXT={off:'Step: off',hold:'Step: hold',auto:'Step: auto'};
function stepRow(box,c){const d=el('div','tstep'),m=el('button','tstb',STEP_TXT[c.step]||STEP_TXT.off);m.type='button';m.dataset.act='step';
  m.title='Round pace: off = rounds run on; hold = wait after each round for Next round; auto = Next round or '+TABLE.stepS+' s';m.setAttribute('aria-label','Round pace: '+c.step);d.append(m);
  if(c.hold){const n=el('button','tstb tnext','Next round ▶'+(c.hold.auto?' ('+c.hold.left+' s)':''));n.type='button';n.dataset.act='next';d.append(n)}
  box.append(d)}
function onBox(e){const t=e.target&&e.target.closest?e.target.closest('[data-act]'):null;if(!t)return;
  if(t.dataset.act==='step'){TABLE.step=STEPS[(STEPS.indexOf(TABLE.step)+1)%STEPS.length];try{localStorage.setItem(STEP,TABLE.step)}catch(_){}sig=''}
  else if(t.dataset.act==='next'){stepNext();sig=''}}
function endBlock(box,c){if(!c.ends||!c.ends.length)return;const d=el('div','tend');d.setAttribute('aria-label','How the fight ended');
  for(const [t,k] of c.ends)d.append(el('span','tendc'+(k?' '+k:''),t));box.append(d)}

// Called every frame with the host's speed: the sim pauses only at 1x.
export function renderTable(speed){TABLE.speed=speed>0?speed:1;syncBtn();syncSnd();
  if(S.table){if(S.table.id!==lastScene){lastScene=S.table.id;if(TABLE.speed<=1)chime(S.table.kind)}}else lastScene=null;
  const box=$('tbanner');if(!box)return;if(!box._tstep){box._tstep=1;box.addEventListener('click',onBox)}
  const b=bannerOf();if(!b){if(!box.hidden){box.hidden=true;sig=''}return}
  const c=combatView();
  const s=[b.title,b.phase,b.line,b.last,b.turn,b.paused,b.narr,b.cast&&b.cast.join(','),c?JSON.stringify(c):''].join('|');if(s===sig)return;sig=s;box.hidden=false;box.classList.toggle('tcombat',!!c);patch(box,box=>{
  const tt=el('div','tt','AT THE TABLE · '+b.title.toUpperCase());if(c)tt.append(el('span','tp tround','ROUND '+c.round+'/'+c.of));if(b.paused)tt.append(el('span','tp','WORLD PAUSED'));if(b.all)tt.append(el('span','tp','EVERYONE ANSWERS'));box.append(tt);
  if(S.table&&(S.table.kind==='crawl'||S.table.kind==='site')){const v=el('button','tstb tdg','View the crypt ▸');v.type='button';v.dataset.dungeon='';v.title='Open the dungeon view';tt.append(' ',v)} // #85
  box.append(el('div','tf',plain(b.frame)));
  if(b.narr)box.append(el('div','tf tnarr',b.narr)); // the DM's narrate line (issue #123)
  if(b.cast&&b.cast.length)box.append(el('div','to','Staged by the DM · '+b.cast.join(' · '))); // a staged scene's cast (issue #132)
  if(c){combatBlock(box,c);box.append(el('div','tl',b.line));if(!c.ends)stepRow(box,c);endBlock(box,c);return} // the roll lines take the last-act line's place
  const o=el('div','to');b.order.forEach((a,i)=>{if(i)o.append(' · ');o.append(i===b.turn?el('b',null,'▶ '+a.name):a.name)});box.append(o);
  box.append(el('div','tl',b.line));if(b.last&&b.phase!=='outcome')box.append(el('div','to',b.last))},{force:true})}
