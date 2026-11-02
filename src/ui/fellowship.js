// The Fellowship panel (issue #68, phase A) at the top of the side column, the hero card's
// Memory tab, the backstory view the Bio tab shows, and the Chronicle's "Fellowship only" filter.
// Reads S.fellowship through sim/fellowship.js; writes only through its functions (found, join,
// leave, offerReplacement, disbandFellowship, editSheet).
//
// Small render helpers are exported for other UI modules (party frames and the side-by-side sheet
// in #94 build on them):
//   renderSettings(node)          members in slot order: role, leader star, name, Sheet/Remove, mind row
//                                 (live level/HP/status live only in the party frames, #114)
//   renderBackstory(node, a)      the hero's backstory paragraphs and summary (read-only)
//   renderPersona(node, a)        the persona sheet (read-only)
//   renderCampaignLog(node, opt)  sessions by game-day, newest first ({days} limits how many)
//   renderThreads(node)           open threads
//   tabMemory(node, a)            the Memory tab body
// Hero names are .hn[data-hid] spans; panels.js owns the delegated click that follows them.
import {FAC} from '../data/factions.js';
import {S} from '../sim/index.js';
import {cam} from '../render/draw.js';
import {rpm,totals as reqTotals,recentFailures} from '../sim/throttle.js';
import {MINDS,mindsOf,setMinds,SLOTS,fits,fellowshipMembers,fellows,fellowParty,autoPick,found,join,leave,offerReplacement,disbandFellowship,openThreads,editSheet,enriching,chronicleFocus,campaign} from '../sim/fellowship.js';
import {PERSONA_ORDER,BACKSTORY_ORDER,ROLE_NAME} from '../sim/persona.js';
import {enableBrain,disableBrain} from '../sim/brain.js';
import {abilityBlock} from './abilities.js'; // class abilities (issue #81)
import {renderMindRow,mindAct,mindChange,mindRowSig,pulledModels,openaiModels} from './mindpick.js'; // per-member mind (Mixed minds, #97)
import {fellowshipRunnerControl,runnerPick,runnerSig} from './runners.js'; // app runners: Start all five / Stop all

const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
const hn=a=>{const s=el('span','hn f'+a.fac,a.name);s.dataset.hid=a.id;return s};
const parts=(node,ps)=>{for(const p of ps||[]){if(typeof p==='string')node.append(p);else if(p&&p.kind==='hero')node.append(hn(p));else if(p)node.append(el('span',p.c||'',p.t))}};
const meter=(frac)=>{const m=el('div','meter hp');const i=document.createElement('i');i.style.width=Math.max(0,Math.min(100,frac*100))+'%';m.append(i);return m};
const byId=id=>S.agents.find(x=>x.id==id);
const alive=a=>a&&a.state!=='dead';

// ---- exported helpers ----
export function renderSettings(node){const P=fellowParty(),ul=el('div','felroster');
  for(const m of fellowshipMembers()){const row=el('div','fm'),a=m.hero;
    row.append(el('span','frole r-'+m.role,m.label));
    if(!a){const e=el('span','dm fn','empty place');row.append(e);const tools=el('span','ftools');const b=el('button','mini','Fill');b.dataset.ffill=m.slot;b.title='The DM offers the place to the most-bonded hero of this class, or a recruit';tools.append(b);
      const s=cam.sel;if(s&&alive(s)&&!s.fellow&&S.fellowship&&s.fac===S.fellowship.fac&&fits(m.slot,s)){const c=el('button','mini','Add '+s.name);c.dataset.fadd=m.slot;tools.append(c)}
      row.append(tools);ul.append(row);continue}
    const nm=el('span','fn');if(P&&P.leader===a)nm.append(el('span','gd','★ '));nm.append(hn(a));if(enriching(a))nm.append(el('span','dm',' · writing…'));row.append(nm);
    const tools=el('span','ftools');const sh=el('button','mini','Sheet');sh.dataset.fsheet=a.id;const rm=el('button','mini','Remove');rm.dataset.fremove=a.id;tools.append(sh,rm);row.append(tools);
    if(a.state!=='dead'){const mr=el('div','fmind');renderMindRow(mr,a);row.append(mr)}
    ul.append(row)}
  node.append(ul)}
export function renderBackstory(node,a){const B=a&&a.backstory;if(!B){node.append(el('div','dm','No backstory yet.'));return}
  for(const [k,label] of BACKSTORY_ORDER){const t=B.paras&&B.paras[k];if(!t)continue;const p=el('p','bio');p.append(el('span','gd',label+'. '),t);node.append(p)}
  node.append(el('div','dm',(B.src==='model'?'Written by the model'+(B.model?' ('+B.model+')':''):'Scripted from the world')+(B.edited?', edited by you':'')+'.'))}
export function renderPersona(node,a){const P=a&&a.persona;if(!P){node.append(el('div','dm','No persona yet.'));return}
  const kv=el('div','kv');for(const [k,label] of PERSONA_ORDER)kv.append(el('span','k',label),el('span','v',P[k]||''));node.append(kv)}
const KIND_LABEL={council:'COUNCIL',table:'TABLE',camp:'CAMP',found:'FOUND',join:'JOIN',recruit:'RECRUIT',leave:'LEAVE',adventure:'JOB',scene:'SCENE',roll:'ROLL',branch:'CHOICE',complication:'TWIST',outcome:'END',npc:'MET',fight:'FIGHT',level:'LVL',kill:'KILL',death:'DEATH',session:'DAY',note:'NOTE'};
export function renderCampaignLog(node,o={}){const F=S.fellowship;if(!F){node.append(el('div','dm','No Fellowship.'));return}
  const days=[];for(const e of F.log){let d=days[days.length-1];if(!d||d.day!==e.day){d={day:e.day,list:[]};days.push(d)}d.list.push(e)}
  if(!days.length){node.append(el('div','dm','Nothing yet. The log fills as the five take jobs, roll dice and bleed.'));return}
  days.slice(0,o.days||8).forEach((d,i)=>{const box=el('details','felday');if(i===0)box.open=true;
    const n=k=>d.list.filter(e=>e.kind===k).length;
    box.append(el('summary',null,'Day '+d.day+' · '+d.list.length+' entries'+(n('death')?' · '+n('death')+' fallen':'')+(n('adventure')?' · '+n('adventure')+' job'+(n('adventure')>1?'s':''):'')));
    const ul=el('ul','tlist');for(const e of d.list){const li=el('li');li.append(el('time',null,e.t),el('span','badge k-'+e.kind,KIND_LABEL[e.kind]||e.kind),' ');parts(li,e.parts);ul.append(li)}
    box.append(ul);node.append(box)})}
export function renderThreads(node){const th=openThreads();if(!th.length){node.append(el('div','dm','No open threads.'));return}
  const ul=el('ul','tlist');for(const t of th){const li=el('li');parts(li,t.parts);ul.append(li)}node.append(ul)}
export function tabMemory(b,a){const M=a.memory;
  if(!M){b.append(el('div','dm','Only Fellowship members keep a memory.'));return}
  if(a.backstory&&a.backstory.summary)b.append(el('div','meta',a.backstory.summary));
  b.append(el('div','dm','Long-term'),el('p','bio',M.long||'Nothing has faded into the long memory yet.'));
  const st=Object.entries(M.stances||{});if(st.length){b.append(el('div','dm','Companions'));const ul=el('ul','log hist');
    for(const [id,line] of st){const c=byId(id);const li=el('li');if(c)li.append(hn(c),': ');li.append(line);ul.append(li)}b.append(ul)}
  b.append(el('div','dm','Recent ('+(M.recent||[]).length+' of '+(M.n||0)+' remembered)'));
  const ul=el('ul','log hist');for(const e of (M.recent||[]).slice().reverse()){const li=el('li');li.append(el('time',null,e.t),e.text+(e.c>1?' (x'+e.c+')':''));ul.append(li)}b.append(ul)}

// ---- the Chronicle filter ----
let focus=true;
export const chronicleShows=e=>!focus||!S.fellowship||chronicleFocus(e);
let onFilter=()=>{};
export function setChronicleRefresh(f){onFilter=f}
function syncChronBtn(){const b=$('chronFel');if(!b)return;b.hidden=!S.fellowship;b.setAttribute('aria-pressed',String(focus))}

// ---- the panel ----
let draft={fac:0,slots:{tank:null,healer:null,dps1:null,dps2:null,dps3:null}},msg='',sheetOpen=null,confirmDisband=false;
let sigTop='',sigLog='',sigForm='',root=null,top=null,sheet=null,logBox=null;

function eligibleFor(slot,fac){return S.agents.filter(a=>alive(a)&&a.fac===fac&&!a.fellow&&!a.player&&fits(slot,a)).sort((x,y)=>y.lvl-x.lvl||x.id-y.id)}
function formView(node){const f=draft.fac;
  const facs=el('div','tfilter');FAC.forEach((F,i)=>{const b=el('button',null,F.name);b.dataset.ffac=i;b.setAttribute('aria-pressed',String(i===f));facs.append(b)});node.append(facs);
  node.append(el('div','dm','Five places, fixed roles: one Tank (Warrior), one Healer (Priest), three DPS (Mage, Hunter, Rogue). An empty place is filled by a fresh recruit.'));
  const g=el('div','felform');
  for(const s of SLOTS){const lab=el('label','fslot');lab.append(el('span','frole r-'+s.role,s.label));const sel=el('select');sel.dataset.fslot=s.key;
    sel.append(new Option('(a fresh recruit)',''));
    for(const a of eligibleFor(s.key,f)){const used=Object.entries(draft.slots).some(([k,id])=>k!==s.key&&id===a.id);if(used)continue;
      const o=new Option(a.name+' · Lv '+a.lvl+' '+a.cls,String(a.id));if(draft.slots[s.key]===a.id)o.selected=true;sel.append(o)}
    lab.append(sel);g.append(lab)}
  node.append(g);
  const bar=el('div','fbar');
  const add=el('button',null,'Add selected hero');add.dataset.fact='addsel';add.title='Put the hero you are following into the fitting empty place';
  const auto=el('button',null,'Form one for me');auto.dataset.fact='auto';auto.title='The best-bonded five of this faction, close in level';
  const go=el('button','go','Found the Fellowship');go.dataset.fact='found';
  bar.append(add,auto,go);node.append(bar);if(msg)node.append(el('div','fmsg',msg))}

function topView(node){const F=S.fellowship;
  const h=el('div','fhead');h.append(el('div','fname f'+F.fac,F.name));
  const alive_=fellows().length;h.append(el('div','dm','The '+FAC[F.fac].name+' · lodged in '+F.hall+' · founded day '+(Math.floor(F.founded/1440)+1)+' · '+alive_+' of 5 standing'+(F.past.length?' · '+F.past.length+' fallen':'')));
  node.append(h);
  const bar=el('div','fbar');
  const fol=el('button',null,'Follow');fol.dataset.fact='follow';fol.setAttribute('aria-pressed',String(cam.view==='fellow'));
  const md=mindsOf(F),ai=el('button',null,'Minds: '+(md==='relay'&&fellows().some(a=>a.player)?'mixed':({off:'scripted',relay:'relay',agent:'agents'})[md]));ai.dataset.fact='ai';
  ai.title=md==='off'?'Scripted rules only. Click: the relay plays the members (npm run relay).':md==='relay'?'The relay plays the members and writes their sheets (scripted when it is down). Click: one AI agent per member (npm run fellowship).':'Each member is agent-played: run npm run fellowship to start their agents (reflexes act while they are silent). Click: back to scripted.';
  const db=el('button',null,confirmDisband?'Really disband?':'Disband');db.dataset.fact='disband';
  bar.append(fol,ai,db);node.append(bar);
  // Minds: agents -> the members' runners can be started from here (the relay runs them; --runners)
  if(md==='agent'){const rc=fellowshipRunnerControl();if(!rc.querySelector('[data-runact="stopall"]'))rc.insertBefore(runnerPick('fellowship',pulledModels(),openaiModels()),rc.firstChild);node.append(rc)}
  renderSettings(node);
  if(msg)node.append(el('div','fmsg',msg));
  if(F.enrich&&F.enrich.calls)node.append(el('div','dm','Relay writing: '+F.enrich.ok+' sheets written, '+F.enrich.fail+' kept scripted, $'+F.enrich.usd.toFixed(4)+(F.enrich.ms?' · last '+(F.enrich.ms/1000).toFixed(1)+' s':'')));
  if(reqTotals.sent||reqTotals.denied){const fl=recentFailures(),r=el('div','dm','Model requests: '+rpm()+'/min · '+reqTotals.sent+' sent, '+reqTotals.failed+' failed, '+reqTotals.denied+' held back');
    if(fl.length)r.title='Recent failures: '+fl.map(f=>f.kind+(f.hero?' '+f.hero:'')+': '+f.why).join(' | ');node.append(r);
    if(fl.length)node.append(el('div','dm','Last failure: '+fl[0].kind+(fl[0].hero?' ('+fl[0].hero+')':'')+', '+fl[0].why+'. Writing backs off, scripted text stands in.'))}
  const th=el('details','tlbox');th.append(el('summary',null,'Open threads'));renderThreads(th);node.append(th);
  if(F.past.length){const fa=el('details','tlbox');fa.append(el('summary',null,'Fallen ('+F.past.length+')'));const ul=el('ul','tlist');
    for(const p of F.past.slice().reverse()){const li=el('li'),a=byId(p.id);li.append('† ',a?hn(a):p.name,' · '+(ROLE_NAME[String(p.slot).replace(/\d+$/,'')]||p.slot)+', Lv '+p.lvl+' '+p.cls+', '+p.cause+', day '+p.day);ul.append(li)}fa.append(ul);node.append(fa)}}

// The sheet editor is rebuilt only when it is opened, saved or closed, never on the tick, so typing is safe.
function sheetView(node,a){node.replaceChildren();if(!a)return;
  const box=el('div','fsheet');box.append(el('div','fname',a.name+'’s sheet'));
  box.append(el('div','dm','Persona: '+(a.persona&&a.persona.src==='model'?'written by the model':'scripted')+(a.persona&&a.persona.edited?', edited':'')+'. Backstory: '+(a.backstory&&a.backstory.src==='model'?'written by the model':'scripted')+(a.backstory&&a.backstory.edited?', edited':'')+'.'+(enriching(a)?' The relay is still writing; saving now keeps your text.':'')));
  abilityBlock(box,a);
  const ta=(which,k,label,v,rows)=>{const l=el('label','fta');l.append(el('span','dm',label));const t=el('textarea');t.rows=rows||2;t.value=v||'';t.dataset.fw=which;t.dataset.fk=k;l.append(t);box.append(l)};
  for(const [k,label] of PERSONA_ORDER)ta('persona',k,label,a.persona&&a.persona[k],2);
  ta('backstory','summary','Backstory summary',a.backstory&&a.backstory.summary,2);
  for(const [k,label] of BACKSTORY_ORDER)ta('backstory',k,label,a.backstory&&a.backstory.paras&&a.backstory.paras[k],3);
  const bar=el('div','fbar');const sv=el('button','go','Save sheet');sv.dataset.fact='save';const cl=el('button',null,'Close');cl.dataset.fact='close';bar.append(sv,cl);box.append(bar);
  node.append(box)}

function act(t){const F=S.fellowship;msg='';
  if(mindAct(t))return;
  if(t.dataset.ffac!=null){draft.fac=+t.dataset.ffac;draft.slots={tank:null,healer:null,dps1:null,dps2:null,dps3:null};sigForm='';return}
  if(t.dataset.ffill){offerReplacement(t.dataset.ffill);return}
  if(t.dataset.fadd){const s=cam.sel;if(s&&join(s,t.dataset.fadd,'chosen by the watcher'))msg=s.name+' joins.';return}
  if(t.dataset.fsheet){sheetOpen=+t.dataset.fsheet;sheetView(sheet,byId(sheetOpen));return}
  if(t.dataset.fremove){const a=byId(t.dataset.fremove);if(a){leave(a,'sent away by the watcher');msg=a.name+' leaves. Fill the empty place, or add a hero.'}return}
  const k=t.dataset.fact;
  if(k==='addsel'){const s=cam.sel;if(!s||!alive(s)){msg='Select a living hero first.';return}
    if(s.fac!==draft.fac){draft.fac=s.fac;draft.slots={tank:null,healer:null,dps1:null,dps2:null,dps3:null}}
    const slot=SLOTS.find(x=>fits(x.key,s)&&draft.slots[x.key]==null&&!Object.values(draft.slots).includes(s.id));
    if(!slot){msg=Object.values(draft.slots).includes(s.id)?s.name+' already has a place.':'No empty place for a '+s.cls+'.';return}
    draft.slots[slot.key]=s.id;sigForm='';return}
  if(k==='auto'){draft.slots=autoPick(draft.fac);sigForm='';const miss=SLOTS.filter(s=>draft.slots[s.key]==null).map(s=>s.label);msg=miss.length?'No hero alive for: '+miss.join(', ')+'. A recruit will take that place.':'';return}
  if(k==='found'){const r=found(draft.slots,{fac:draft.fac,ai:true});if(!r.ok){msg=r.error;return}
    draft.slots={tank:null,healer:null,dps1:null,dps2:null,dps3:null};focus=true;onFilter();setViewHook('fellow');return}
  if(!F)return;
  if(k==='follow'){setViewHook(cam.view==='fellow'?'map':'fellow');return}
  if(k==='ai'){const nx=MINDS[(MINDS.indexOf(mindsOf(F))+1)%MINDS.length];setMinds(nx);campaign('note','The watcher set the members’ minds to '+({off:'the scripted rules',relay:'the relay',agent:'their own agents'})[nx]+'.');return}
  if(k==='disband'){if(!confirmDisband){confirmDisband=true;return}confirmDisband=false;disbandFellowship();sheetOpen=null;sheetView(sheet,null);onFilter();setViewHook('map');return}
  if(k==='save'){const a=byId(sheetOpen);if(a)for(const ta of sheet.querySelectorAll('textarea[data-fw]'))editSheet(a,ta.dataset.fw,ta.dataset.fk,ta.value);msg='Sheet saved.';sheetView(sheet,a);return}
  if(k==='close'){sheetOpen=null;sheetView(sheet,null)}}

let setViewHook=()=>{};
export function initFellowship(setView){setViewHook=setView||(()=>{});root=$('felbody');if(!root)return;
  top=el('div');sheet=el('div');logBox=el('details','tlbox felLog');logBox.open=true;logBox.append(el('summary',null,'Campaign log'));const lb=el('div');logBox.append(lb);logBox._b=lb;
  root.append(top,sheet,logBox);
  root.addEventListener('click',e=>{const t=e.target&&e.target.closest?e.target.closest('button'):null;if(!t||!root.contains(t))return;
    if(t.closest('.hn'))return;act(t);sigTop='';sigForm='';renderFellowship()});
  root.addEventListener('change',e=>{const s=e.target;if(mindChange(s)){sigTop='';renderFellowship();return}
    if(s&&s.dataset&&s.dataset.fslot){const v=s.value;draft.slots[s.dataset.fslot]=v?+v:null;sigForm='';renderFellowship()}});
  const cb=$('chronFel');if(cb)cb.addEventListener('click',()=>{focus=!focus;syncChronBtn();onFilter()});
  renderFellowship()}

export function renderFellowship(){if(!root)return;const F=S.fellowship;syncChronBtn();
  if(!F){logBox.hidden=true;
    const sig='f|'+draft.fac+'|'+JSON.stringify(draft.slots)+'|'+msg+'|'+S.agents.filter(a=>alive(a)&&a.fac===draft.fac).map(a=>a.id+':'+a.lvl).join(',');
    if(sig!==sigForm){sigForm=sig;sigTop='';top.replaceChildren();formView(top)}return}
  logBox.hidden=false;
  const sig='t|'+F.id+'|'+msg+'|'+confirmDisband+'|'+mindsOf(F)+'|'+(mindsOf(F)==='agent'?runnerSig(null):'')+'|'+cam.view+'|'+(cam.sel?cam.sel.id:'')+'|'+fellowshipMembers().map(m=>m.hero?m.hero.id+':'+m.hero.name+':'+(m.hero.state==='dead')+':'+enriching(m.hero)+':'+mindRowSig(m.hero):'-').join(',')+'|'+(fellowParty()?fellowParty().leader.id:'')+'|'+F.past.length+'|'+(F.enrich?F.enrich.calls:0)+'|'+reqTotals.sent+'|'+reqTotals.failed;
  const picking=typeof document!=='undefined'&&document.activeElement&&document.activeElement.tagName==='SELECT'&&top.contains(document.activeElement); // never rebuild under an open picker
  if(sig!==sigTop&&!picking){sigTop=sig;sigForm='';top.replaceChildren();topView(top)}
  const ls=F.id+':'+(F.seq||0);if(ls!==sigLog){sigLog=ls;logBox._b.replaceChildren();renderCampaignLog(logBox._b)}}
