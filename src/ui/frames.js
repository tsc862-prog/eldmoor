// Party frames (issue #94): five compact frames above the map, one per Fellowship place in role
// order (Tank, Healer, DPS x3). Each shows a sprite portrait, name, role and class, level, health
// with numbers, what the member is doing, their target, conditions and blessings, who plays them
// (scripted / AI / agent with its link state) with a control to switch it, and the dead or
// replaced state of the place. Click a frame: select that member and centre the camera on them.
// Hover a frame: the five combat totals and the top skills.
//
// Cheap rendering: a frame's skeleton is built when the hero in its place changes; every 0.3 s
// tick (renderFrames, from main.js) writes only the text, widths and classes that changed.
// frameRows() returns the same content as plain text for the headless smoke check.
import {classColor} from '../core/colors.js'; // a member's name and top edge in its class colour
import {FAC} from '../data/factions.js';
import {ZONES} from '../world/map.js';
import {MOBS} from '../data/mobs.js';
import {S,maxHp} from '../sim/index.js';
import {fellowshipMembers,fellowParty,offerReplacement} from '../sim/fellowship.js';
import {conditionAt,CONDITIONS} from '../sim/levers.js';
import {SKILLS,SKILL_IDS,skillMod,trained} from '../sim/abilities.js';
import {heroSprite} from '../render/sprites.js';
import {cam} from '../render/draw.js';
import {doing,combatRows} from './panels.js';
import {select,setView} from './controls.js';
import {mindOf,mindText,mindTitle} from './mindctl.js'; // the frame shows the mind; it is set in Members and minds (#145)
import {openSheet} from './sheet.js';
import {runnerControl,runnerSig} from './runners.js'; // app runners: Start / Stop on an agent-played member
import {mountDmFrame,renderDmFrame} from './dmframe.js'; // the DM beside the party (owner request)
import {countKind} from '../sim/inv.js'; // potion count on the frame (#124)
import {agentReadyWord} from './player-bridge.js'; // the start gate (#222): claimed / warming / ready / failed
const READY_TEXT={claimed:'claimed',warming:'warming up',ready:'ready',failed:'warm-up failed'};
const mindLine=a=>{const w=a&&a.player&&a.state!=='dead'?agentReadyWord(a):null;return mindText(a)+(w?' · '+READY_TEXT[w]:'')};

const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
const sg=m=>(m>=0?'+':'')+m;
const byId=id=>S.agents.find(x=>x.id==id);
// Write only what changed.
const setText=(n,v)=>{v=v==null?'':String(v);if(n._v!==v){n._v=v;n.textContent=v}};
const setAttr=(n,k,v)=>{if(n['_'+k]!==v){n['_'+k]=v;if(v==null)n.removeAttribute(k);else n.setAttribute(k,v)}};
const setCls=(n,c)=>{if(n._c!==c){n._c=c;n.className=c}};

// ---- what a frame says (plain data, shared by the DOM and the smoke check) ----
export function targetOf(a){const t=a&&a.target;if(!t||a.state==='dead')return '';
  if(t.kind==='hero')return t.name+' · Lv '+t.lvl+' '+t.cls+' of the '+FAC[t.fac].name+(t.state==='dead'?' (fallen)':' · '+Math.max(0,Math.round(t.hp/maxHp(t)*100))+'%');
  if(t.kind==='boss')return 'Kragmaw · '+Math.max(0,Math.round(t.hp/t.maxhp*100))+'%';
  if(t.kind==='mob'){const M=MOBS[t.type];return (t.elite&&t.name?t.name:(M?M.name:'monster'))+' · Lv '+t.lvl+(t.alive===false?' (slain)':' · '+Math.max(0,Math.round(t.hp/t.maxhp*100))+'%')}
  return ''}
// Conditions and blessings: [{t, c (css), title}].
export function chipsOf(a){const out=[];if(!a)return out;
  if(a.state==='dead')return [{t:'FALLEN',c:'bad',title:'Hardcore: gone for good.'}];
  if(a.state==='ghost')out.push({t:'GHOST',c:'dim',title:'Running back as a ghost.'});
  if(a.blessed)out.push({t:'BLESSED',c:'good',title:'The next strike lands at +20% (a wayside shrine or a crypt blessing).'});
  const mh=maxHp(a);if(a.state!=='ghost'&&a.hp<mh*.35)out.push({t:'WOUNDED',c:'bad',title:'Below a third of their health.'});
  if(a.hidden&&a.state==='dungeon')out.push({t:'IN CRYPT',c:'crypt',title:'Inside the Sunken Crypt.'});
  const c=conditionAt(a.zone);if(c&&CONDITIONS[c.kind])out.push({t:CONDITIONS[c.kind].label.toUpperCase(),c:'cond',title:CONDITIONS[c.kind].about+' (over '+ZONES[c.z]+')',col:CONDITIONS[c.kind].col});
  const owed=Object.keys(a.nemesis||{}).filter(id=>{const n=byId(id);return n&&n.state!=='dead'}).length;if(owed)out.push({t:'BLOOD OWED',c:'warn',title:'Sworn to avenge a guildmate.'});
  if(a.goal&&!a.goal.done&&a.goal.need)out.push({t:'OATH '+(a.goal.progress||0)+'/'+a.goal.need,c:'oath',title:a.goal.text});
  return out}
export function topSkills(a,n=3){return SKILL_IDS.slice().sort((x,y)=>skillMod(a,y)-skillMod(a,x)||trained(a,y)-trained(a,x)).slice(0,n).map(k=>(trained(a,k)?'* ':'')+SKILLS[k].name+' '+sg(skillMod(a,k)))}
// The member who held this place before, when the place has turned over (the DM's replacement).
function before(slot){const F=S.fellowship;if(!F)return null;for(let i=F.past.length-1;i>=0;i--)if(F.past[i].slot===slot)return F.past[i];return null}
const today=()=>Math.floor(S.gameMin/1440)+1;
// Potions carried, as frame text: "3 potions" (empty when none).
export const potText=a=>{const n=a&&a.inv?countKind(a,'potion'):0;return n?n+(n===1?' potion':' potions'):''};
export function replacedLine(slot){const p=before(slot);return p&&p.day>=today()-1?'Took the place of † '+p.name+' ('+p.cause+')':''}

// The whole strip as text: one entry per place.
export function frameRows(){return fellowshipMembers().map(m=>{const a=m.hero;
  if(!a){const p=before(m.slot);return {role:m.label,empty:true,text:m.label+' · place empty'+(p?' · † '+p.name+', '+p.cause:'')}}
  const mh=maxHp(a);
  return {role:m.label,name:a.name,cls:a.cls,lvl:a.lvl,hp:Math.max(0,Math.round(a.hp))+' / '+mh,status:doing(a),target:targetOf(a),
    chips:chipsOf(a).map(c=>c.t),pots:potText(a),mind:mindLine(a),replaced:replacedLine(m.slot),lead:!!(fellowParty()&&fellowParty().leader===a),
    hover:combatRows(a).map(r=>r[1]+' '+r[2]).concat(['Skills: '+topSkills(a).join(', ')])}})}

// ---- DOM ----
let root=null,list=null,tip=null,tipFor=null,tipXY=[0,0];
const frames={}; // slot -> {node, hid, refs}

function build(m){const a=m.hero,f=el('div','pf r-'+m.role);f.dataset.pf=m.slot;if(a)f.style.borderTopColor=classColor(a.cls);
  const r={};
  if(!a){f.classList.add('empty');f.append(el('span','frole r-'+m.role,m.label));r.empty=el('div','pfempty','Place empty');r.past=el('div','dm pfpast');
    const b=el('button','mini','Fill');b.dataset.pffill=m.slot;b.title='The DM offers the place to the most-bonded hero of this class, or a recruit';f.append(r.empty,r.past,b);return {node:f,hid:null,r}}
  f.tabIndex=0;f.setAttribute('role','button');f.dataset.hid=a.id;
  const top=el('div','pftop');r.port=el('canvas','pfport');r.port.width=10;r.port.height=12;
  const id=el('div','pfid');r.name=el('div','pfname f'+a.fac);r.star=el('span','gd','★ ');r.nm=el('span',null,a.name);r.nm.style.color=classColor(a.cls);r.name.append(r.star,r.nm);
  const sub=el('div','pfsub');sub.append(el('span','frole r-'+m.role,m.label),' ');r.sub=el('span','dm');sub.append(r.sub);id.append(r.name,sub);
  top.append(r.port,id);
  const hp=el('div','meter hp pfhp');r.hpi=document.createElement('i');r.hpt=el('span','pfhpt');hp.append(r.hpi,r.hpt);
  r.doing=el('div','pfdo');r.tgt=el('div','pftg');r.chips=el('div','pfchips');
  const foot=el('div','pffoot');r.pot=el('span','pfpot');r.mind=el('span','pfmind');r.btn=el('span','pfbtn');foot.append(r.pot,r.mind,r.btn);r.run=el('div','pfrun');
  r.rep=el('div','dm pfrep');
  f.append(top,hp,r.doing,r.tgt,r.chips,r.rep,foot,r.run);
  return {node:f,hid:a.id,r}}

function update(fr,m){const a=m.hero,r=fr.r;
  if(!a){const p=before(m.slot);setText(r.past,p?'† '+p.name+', Lv '+p.lvl+' '+p.cls+', '+p.cause:'');return}
  const dead=a.state==='dead',mh=maxHp(a),P=fellowParty();
  setCls(fr.node,'pf r-'+m.role+(cam.sel===a?' sel':'')+(dead?' dead':a.state==='ghost'?' ghost':'')+(a.hp<mh*.35&&!dead?' low':''));
  // portrait: redraw only when the sprite itself changes (ghost, a new hero)
  const s=heroSprite(a,a.state==='ghost',0);if(r.port._s!==s){r.port._s=s;r.port.width=s.width;r.port.height=s.height;const c=r.port.getContext&&r.port.getContext('2d');if(c){c.clearRect(0,0,s.width,s.height);c.drawImage(s,0,0)}}
  r.star.hidden=!(P&&P.leader===a);
  setText(r.sub,'Lv '+a.lvl+' '+a.cls);
  const w=dead?0:Math.max(0,Math.min(100,a.hp/mh*100));if(r.hpi._w!==w){r.hpi._w=w;r.hpi.style.width=w.toFixed(1)+'%'}
  setText(r.hpt,dead?'fallen':Math.max(0,Math.round(a.hp))+' / '+mh);
  setText(r.doing,doing(a));const t=targetOf(a);setText(r.tgt,t?'» '+t:'');
  const ch=chipsOf(a),ck=ch.map(c=>c.t).join('|');if(r.chips._k!==ck){r.chips._k=ck;r.chips.replaceChildren();for(const c of ch){const s=el('span','chip c-'+c.c,c.t);s.title=c.title||'';if(c.col)s.style.color=c.col;r.chips.append(s)}}
  setText(r.rep,replacedLine(m.slot));setText(r.pot,dead?'':potText(a));
  setText(r.mind,mindLine(a));setCls(r.mind,'pfmind m-'+mindOf(a));setAttr(r.mind,'title',mindTitle(a));
  const rk=dead||!a.player?'':runnerSig(a);if(r.run._k!==rk){r.run._k=rk;r.run.replaceChildren();if(rk)r.run.append(runnerControl(a))}}

// ---- hover: combat totals and top skills ----
function tipBody(a){const d=[];d.push(el('div','in f'+a.fac,a.name+' · Lv '+a.lvl+' '+a.cls));
  for(const [,label,v] of combatRows(a)){const row=el('div','pftr');row.append(el('span','dm',label),el('span',null,v));d.push(row)}
  d.push(el('div','dm','Top skills'));for(const s of topSkills(a))d.push(el('div',s.startsWith('*')?'gd':null,s));return d}
function placeTip(){if(!tip)return;const pad=14,w=tip.offsetWidth,h=tip.offsetHeight,vw=window.innerWidth,vh=window.innerHeight;
  let x=tipXY[0]+pad,y=tipXY[1]+pad;if(x+w>vw-4)x=Math.max(4,tipXY[0]-w-pad);if(y+h>vh-4)y=Math.max(4,vh-h-4);tip.style.left=x+'px';tip.style.top=y+'px'}
function showTip(a){if(!tip){tip=el('div','itip floating pftip');tip.setAttribute('role','tooltip');document.body.append(tip)}
  tipFor=a;const k=a.id+'|'+combatRows(a).map(r=>r[2]).join('|')+'|'+topSkills(a).join('|');if(tip._k!==k){tip._k=k;tip.replaceChildren(...tipBody(a))}tip.style.display='block';placeTip()}
function hideTip(){tipFor=null;if(tip)tip.style.display='none'}

export function initFrames(){root=$('frames');if(!root)return;
  const head=el('div','frhead');const ttl=el('span','frttl');root._ttl=ttl;
  const cmp=el('button','mini','Compare the five');cmp.dataset.pfsheet='1';cmp.title='Side by side: scores, combat, skills, gear, oaths and bonds';
  head.append(ttl,cmp);list=el('div','frlist');root.append(head,list);mountDmFrame(root);
  root.addEventListener('click',e=>{const t=e.target;if(!t||!t.closest)return;
    if(t.closest('[data-pfsheet]')){openSheet();return}
    const fill=t.closest('[data-pffill]');if(fill){offerReplacement(fill.dataset.pffill);renderFrames();return}
    if(t.closest('button'))return;
    const f=t.closest('.pf[data-hid]');if(!f)return;const a=byId(f.dataset.hid);if(a){hideTip();select(a);setView('follow')}});
  root.addEventListener('keydown',e=>{if(e.key!=='Enter'&&e.key!==' ')return;const f=e.target&&e.target.closest&&e.target.closest('.pf[data-hid]');if(!f||e.target!==f)return;e.preventDefault();const a=byId(f.dataset.hid);if(a){select(a);setView('follow')}});
  list.addEventListener('pointermove',e=>{if(e.pointerType&&e.pointerType!=='mouse')return;tipXY=[e.clientX,e.clientY];
    const f=e.target&&e.target.closest?e.target.closest('.pf[data-hid]'):null,a=f?byId(f.dataset.hid):null;if(!a||a.state==='dead'){if(tipFor)hideTip();return}
    if(tipFor!==a)showTip(a);else placeTip()});
  list.addEventListener('pointerleave',hideTip);
  renderFrames()}

export function renderFrames(){if(!root)return;const F=S.fellowship;
  if(!F){if(!root.hidden){root.hidden=true;list.replaceChildren();for(const k in frames)delete frames[k];hideTip()}return}
  root.hidden=false;setText(root._ttl,F.name);renderDmFrame();
  const ms=fellowshipMembers();
  ms.forEach((m,i)=>{const hid=m.hero?m.hero.id:null;let fr=frames[m.slot];
    if(!fr||fr.hid!==hid){const nf=build(m);if(fr&&fr.node.parentNode===list)list.replaceChild(nf.node,fr.node);fr=frames[m.slot]=nf}
    if(list.children[i]!==fr.node)list.insertBefore(fr.node,list.children[i]||null);
    update(fr,m)});
  if(tipFor)showTip(tipFor)}
