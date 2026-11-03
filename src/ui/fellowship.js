// The Companies panel (issue #68, #457; was the Fellowship panel) at the top of the side column, the hero card's
// Memory tab, the backstory view the Bio tab shows, and the Chronicle's "Companies only" filter.
// A tab per company plus All (no tab bar while there is one company); each tab: header, open threads, hall board, members
// and minds with Start <company>, and the campaign log in the Story panel follows the tab.
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
import {portrait} from '../render/sprites.js'; // face portraits (#367)
import {FAC} from '../data/factions.js';
import {renderNotebook} from './notebook.js'; // agent memories (#155)
import {S} from '../sim/index.js';
import {cam} from '../render/draw.js';
import {rpm,totals as reqTotals,recentFailures} from '../sim/throttle.js';
import {campSummary} from '../sim/camp.js';
// The sim's camp line, with a watch end it could not compute (NaN) left out rather than shown as "until NaN:NaN" (#475).
export const campLine=()=>{const s=campSummary();return s?s.replace(/ \(until [^)]*NaN[^)]*\)/g,''):s};
import {hallBoard} from '../sim/dmfocus.js'; // the hall board's jobs for a company (#334, #457), read-only
import {companies,members,openThreads as companyThreads,mates as companyMates,leaderOf} from '../sim/company.js'; // companies (#402)
import {followCompany,followedCompany,companyLabel,companyCols} from './companyview.js';
import {MINDS,mindsOf,setMinds,SLOTS,fits,fellowshipMembers,fellows,fellowParty,join,leave,offerReplacement,disbandFellowship,openThreads,editSheet,enriching,chronicleFocus,campaign} from '../sim/fellowship.js';
import {PERSONA_ORDER,BACKSTORY_ORDER,ROLE_NAME,applyArchetype,authoredStance,scriptedStance,personaValue,pinField,pinned} from '../sim/persona.js';
import {STANCE_MAX} from '../data/prompts.js'; // the stance cap the model gets (#305)
import {ARCHETYPES,ARCHETYPE_IDS} from '../data/archetypes.js'; // persona archetypes (#295)
import {enableBrain,disableBrain} from '../sim/brain.js';
import {abilityBlock} from './abilities.js'; // class abilities (issue #81)
import {renderMindRow,mindAct,mindChange,mindRowSig,pulledModels,openaiModels} from './mindpick.js'; // per-member mind (Mixed minds, #97)
import {fellowshipRunnerControl,companyRunnerControl,companyRunnerSig,runnerPick,runnerSig} from './runners.js'; // app runners: Start <company> / Stop
import {devMode} from './mindctl.js'; // request stats are a developer surface (#145)
import {regionLine} from './region.js'; // region view (#430)
import {patch,held,keyOf} from './stable.js'; // update in place, keep scroll (#145)

const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
const hn=a=>{const s=el('span','hn f'+a.fac,a.name);s.dataset.hid=a.id;return s};
const parts=(node,ps)=>{for(const p of ps||[]){if(typeof p==='string')node.append(p);else if(p&&p.kind==='hero')node.append(hn(p));else if(p)node.append(el('span',p.c||'',p.t))}};
const meter=(frac)=>{const m=el('div','meter hp');const i=document.createElement('i');i.style.width=Math.max(0,Math.min(100,frac*100))+'%';m.append(i);return m};
const byId=id=>S.agents.find(x=>x.id==id);
const alive=a=>a&&a.state!=='dead';

// ---- exported helpers ----
// The member's face (#379): the same portrait and mode strings as the party frames; empty places keep a blank slot.
function rosterFace(a){const c=el('canvas','fport');c.width=15;c.height=18;if(!a)return c;
  const s=portrait(a,a.state==='dead'?'dead':a.state==='ghost'?'ghost':'');c.width=s.width;c.height=s.height;
  const g=c.getContext&&c.getContext('2d');if(g)g.drawImage(s,0,0);return c}
export function renderSettings(node,C){C=C||S.fellowship;if(C&&!C.slots)return renderRoster(node,C);
  const P=fellowParty(),ul=el('div','felroster');
  for(const m of fellowshipMembers()){const row=el('div','fm'),a=m.hero;
    row.append(rosterFace(a));row.append(el('span','frole r-'+m.role,m.label));
    if(!a){const e=el('span','dm fn','empty place');row.append(e);const tools=el('span','ftools');const b=el('button','mini','Fill');b.dataset.ffill=m.slot;b.title='The DM offers the place to the most-bonded hero of this class, or a recruit';tools.append(b);
      const s=cam.sel;if(s&&alive(s)&&!s.fellow&&S.fellowship&&s.fac===S.fellowship.fac&&fits(m.slot,s)){const c=el('button','mini','Add '+s.name);c.dataset.fadd=m.slot;tools.append(c)}
      row.append(tools);ul.append(row);continue}
    const nm=el('span','fn');if(P&&P.leader===a)nm.append(el('span','gd','★ '));nm.append(hn(a));if(enriching(a))nm.append(el('span','dm',' · writing…'));row.append(nm);
    const tools=el('span','ftools');const sh=el('button','mini','Sheet');sh.dataset.fsheet=a.id;const rm=el('button','mini','Remove');rm.dataset.fremove=a.id;tools.append(sh,rm);row.append(tools);
    if(a.state!=='dead'){const mr=el('div','fmind');renderMindRow(mr,a);row.append(mr)}
    ul.append(row)}
  node.append(ul)}
// A company without the five places: its heroes in join order, name, Sheet, mind row (#457).
function renderRoster(node,C){const ul=el('div','felroster'),lead=leaderOf(C);
  for(const m of companyCols(C)){const a=m.hero,row=el('div','fm');row.append(rosterFace(a),el('span','frole r-'+m.role,m.label));
    const nm=el('span','fn');if(lead===a)nm.append(el('span','gd','★ '));nm.append(hn(a));row.append(nm);
    const tools=el('span','ftools'),sh=el('button','mini','Sheet');sh.dataset.fsheet=a.id;tools.append(sh);row.append(tools);
    if(a.state!=='dead'){const mr=el('div','fmind');renderMindRow(mr,a);row.append(mr)}ul.append(row)}
  node.append(ul)}
export function renderBackstory(node,a){const B=a&&a.backstory;if(!B){node.append(el('div','dm','No backstory yet.'));return}
  for(const [k,label] of BACKSTORY_ORDER){const t=B.paras&&B.paras[k];if(!t)continue;const p=el('p','bio');p.append(el('span','gd',label+'. '),t);node.append(p)}
  node.append(el('div','dm',(B.src==='model'?'Written by the model'+(B.model?' ('+B.model+')':''):'Scripted from the world')+(B.edited?', edited by you':'')+'.'))}
export function renderPersona(node,a){const P=a&&a.persona;if(!P){node.append(el('div','dm','No persona yet.'));return}
  const kv=el('div','kv');for(const [k,label] of PERSONA_ORDER)kv.append(el('span','k',label),el('span','v',personaValue(P,k)));node.append(kv)}
const KIND_LABEL={council:'COUNCIL',table:'TABLE',camp:'CAMP',found:'FOUND',join:'JOIN',recruit:'RECRUIT',leave:'LEAVE',adventure:'JOB',scene:'SCENE',roll:'ROLL',branch:'CHOICE',complication:'TWIST',outcome:'END',npc:'MET',fight:'FIGHT',level:'LVL',kill:'KILL',death:'DEATH',session:'DAY',note:'NOTE'};
// o.C: one company's log (default the Fellowship); o.all: every company's log merged, newest first, each line named (#457).
export function renderCampaignLog(node,o={}){const all=!!o.all,C=o.C||S.fellowship;
  if(!all&&!C){node.append(el('div','dm','No company.'));return}
  let L;if(all){L=[];for(const D of companies())for(const e of D.log||[])L.push({e,D});L.sort((x,y)=>y.e.gameMin-x.e.gameMin||y.e.id-x.e.id);L=L.slice(0,300)}
  else L=(C.log||[]).map(e=>({e,D:C}));
  const days=[];for(const {e,D} of L){let d=days[days.length-1];if(!d||d.day!==e.day){d={day:e.day,list:[]};days.push(d)}d.list.push({e,D})}
  if(!days.length){node.append(el('div','dm','Nothing yet. The log fills as the company takes jobs, rolls dice and bleeds.'));return}
  days.slice(0,o.days||8).forEach((d,i)=>{const box=el('details','felday');box.setAttribute('data-k','day'+d.day);if(i===0)box.open=true;
    const n=k=>d.list.filter(x=>x.e.kind===k).length;
    box.append(el('summary',null,'Day '+d.day+' · '+d.list.length+' entries'+(n('death')?' · '+n('death')+' fallen':'')+(n('adventure')?' · '+n('adventure')+' job'+(n('adventure')>1?'s':''):'')));
    const ul=el('ul','tlist');for(const {e,D} of d.list){const li=el('li');li.setAttribute('data-k',keyOf(e));li.append(el('time',null,e.t),el('span','badge k-'+e.kind,KIND_LABEL[e.kind]||e.kind),' ');
      if(all&&companies().length>1)li.append(el('span','dm fcoTag',companyLabel(D)+': '));parts(li,e.parts);ul.append(li)}
    box.append(ul);node.append(box)})}
export function renderThreads(node,C){const th=companyThreads(C||S.fellowship);if(!th.length){node.append(el('div','dm','No open threads.'));return}
  const ul=el('ul','tlist');for(const t of th){const li=el('li');parts(li,t.parts);ul.append(li)}node.append(ul)}
export function tabMemory(b,a){const M=a.memory;
  if(!M){if(a.memories)renderNotebook(b,a);else b.append(el('div','dm','Only Fellowship members keep a memory.'));return} // an agent hero's own notes (#155)
  if(a.backstory&&a.backstory.summary)b.append(el('div','meta',a.backstory.summary));
  b.append(el('div','dm','Long-term'),el('p','bio',M.long||'Nothing has faded into the long memory yet.'));
  const st=Object.entries(M.stances||{});if(st.length){b.append(el('div','dm','Companions'));const ul=el('ul','log hist');
    for(const [id,line] of st){const c=byId(id);const li=el('li');li.setAttribute('data-k','c'+id);if(c)li.append(hn(c),': ');li.append(line);ul.append(li)}b.append(ul)}
  b.append(el('div','dm','Recent ('+(M.recent||[]).length+' of '+(M.n||0)+' remembered)'));
  const ul=el('ul','log hist');for(const e of (M.recent||[]).slice().reverse()){const li=el('li');li.setAttribute('data-k',keyOf(e));li.append(el('time',null,e.t),e.text+(e.c>1?' (x'+e.c+')':''));ul.append(li)}b.append(ul);
  renderNotebook(b,a)} // the agent's own searchable notes (#155)

// ---- the Chronicle filter ----
// "Companies only" (#457): the world's major events and every line that names a hero of a company with an agent
// in it (or one that fell from it); the Fellowship's own filter (guilds, rivals, its region) still applies.
let focus=true;
let coCache={at:-1,n:-1,ids:null};
function companyIds(){const L=companies(),at=Math.floor(S.gameMin);if(coCache.at===at&&coCache.n===L.length&&coCache.ids)return coCache.ids;
  const ids=new Set();for(const C of L){if(!C.slots&&!members(C).some(a=>a.player))continue;for(const id of C.ids)ids.add(id);for(const p of C.past||[])ids.add(p.id)}
  coCache={at,n:L.length,ids};return ids}
function companyFocus(e){if(S.fellowship&&chronicleFocus(e))return true;const ids=companyIds();
  for(const p of e.parts||[])if(p&&typeof p==='object'&&p.kind==='hero'&&ids.has(p.id))return true;
  return !S.fellowship&&!(e.parts||[]).some(p=>p&&typeof p==='object'&&p.kind==='hero')}
export const chronicleShows=e=>regionLine(e)&&(!focus||!companies().length||companyFocus(e)); // the region picker (#430) narrows it further
let onFilter=()=>{};
export function setChronicleRefresh(f){onFilter=f}
export const refreshChronicle=()=>onFilter();
// The Story panel (#145): the Chronicle, and with a company its Campaign log as a second tab.
let story='chron';
function syncChronBtn(){const F=!!S.fellowship||companies().length>0,camp=F&&story==='camp',b=$('chronFel'),t=$('storyTabs'),tt=$('storyTtl'),lg=$('log'),cp=$('campaign');
  if(b){b.hidden=!F||camp;b.setAttribute('aria-pressed',String(focus))}
  if(t){t.hidden=!F;for(const x of t.children)x.setAttribute('aria-pressed',String(x.dataset.story===(camp?'camp':'chron')))}
  if(tt&&tt.textContent!==(F?'Story':'Chronicle'))tt.textContent=F?'Story':'Chronicle';
  if(lg)lg.hidden=camp;if(cp)cp.hidden=!camp}

// ---- the panel ----
// tabSel: null (the followed company), 'all', or a company id. With one company there is no tab bar.
let msg='',sheetOpen=null,confirmDisband=false,drawer=null,menuOpen=false,moreThreads=false,tabSel=null;
let sigTop='',sigLog='',root=null,top=null,sheet=null,logBox=null;

function tabNow(){const L=companies();if(!L.length)return {C:null};if(L.length<2)return {C:L[0]};
  if(tabSel==='all')return {all:true};return {C:L.find(x=>x.id===tabSel)||followedCompany()||L[0]}}
const tabKey=t=>t.all?'all':'c'+(t.C?t.C.id:'-');
const plainOf=ps=>(ps||[]).map(p=>typeof p==='string'?p:p&&p.kind==='hero'?p.name:p&&p.t||'').join('');
const THREADS=4; // open threads shown before "+N more"
const cname=C=>companyLabel(C)||'Company';
// The tab bar: one button per company, then All. Not built while there is one company.
function tabsView(node,t){const L=companies();if(L.length<2)return;
  const bar=el('div','tfilter fcotabs');bar.setAttribute('role','tablist');bar.setAttribute('aria-label','Companies');bar.setAttribute('data-k','cotabs');
  for(const C of L){const b=el('button',null,cname(C));b.dataset.fact='tab:'+C.id;b.setAttribute('role','tab');b.title=cname(C)+' · '+C.ids.length+' '+(C.ids.length===1?'hero':'heroes');
    b.setAttribute('aria-pressed',String(!t.all&&t.C===C));bar.append(b)}
  const al=el('button',null,'All');al.dataset.fact='tab:all';al.setAttribute('role','tab');al.setAttribute('aria-pressed',String(!!t.all));bar.append(al);node.append(bar)}
// The header is one line; threads lead, and Members and Fallen open in a drawer under it.
// Disband sits behind the ... menu (the Fellowship only).
function topView(node,C){const fel=!!C.slots&&S.fellowship===C;
  const h=el('div','fhline');
  const nm=el('span','fname f'+C.fac,cname(C));nm.title=cname(C);
  const live=members(C).length,place=C.hall?C.hall+' · ':'';
  h.append(nm,el('span','fbadge f'+C.fac,FAC[C.fac].name),el('span','fmeta dm',place+live+(fel?'/5':'')+' standing'+((C.past||[]).length?' · '+C.past.length+' fallen':'')+' · day '+(Math.floor((C.founded||0)/1440)+1)));
  const tools=el('span','ftools2');
  const ib=(fact,txt,label,pressed)=>{const b=el('button','ficon',txt);b.dataset.fact=fact;b.title=label;b.setAttribute('aria-label',label);if(pressed!=null)b.setAttribute('aria-pressed',String(pressed));return b};
  tools.append(ib('follow','◎','Follow '+(fel?'the Fellowship':cname(C)),cam.view==='fellow'&&followedCompany()===C),ib('drawer:members','☰','Members and minds',drawer==='members'));
  if((C.past||[]).length)tools.append(ib('drawer:fallen','†','Fallen ('+C.past.length+')',drawer==='fallen'));
  if(fel)tools.append(ib('menu','⋯','More',menuOpen));
  h.append(tools);node.append(h);
  if(fel&&menuOpen){const m=el('div','felmenu');
    if(!confirmDisband){const d=el('button',null,'Disband the Fellowship...');d.dataset.fact='disband';m.append(d)}
    else{m.append(el('span','dm','Disband for good? The five go their own ways.'));const y=el('button','danger','Yes, disband');y.dataset.fact='disband';const c=el('button',null,'Cancel');c.dataset.fact='menu';m.append(y,c)}
    node.append(m)}
  if(fel){const cs=campLine();if(cs)node.append(el('div','gd fcamp',cs))} // camp: how long, who sleeps, who watches (#178)
  if(msg)node.append(el('div','fmsg',msg));
  // Open threads lead (oaths, meeting plans, unfinished jobs, blood owed): live one-liners
  const th=companyThreads(C),box=el('div','felthreads');box.setAttribute('data-k','threads');
  box.append(el('div','fth-h dm','Open threads'+(th.length?' ('+th.length+')':'')));
  if(!th.length)box.append(el('div','dm','No open threads. Oaths, meeting plans and jobs show here.'));
  else{const ul=el('ul','tlist fthreads');th.slice(0,moreThreads?th.length:THREADS).forEach((t,i)=>{const li=el('li','th-'+t.kind);li.setAttribute('data-k','th'+i);parts(li,t.parts);ul.append(li)});box.append(ul);
    if(th.length>THREADS){const mb=el('button','mini',moreThreads?'Show fewer':'+'+(th.length-THREADS)+' more');mb.dataset.fact='more';box.append(mb)}}
  node.append(box);
  hallView(node,C);
  if(drawer==='members'){const mm=el('div','feldrawer felmem');mm.setAttribute('data-k','members');mm.append(el('div','fth-h dm','Members and minds'));
    if(fel){const md=mindsOf(C); // always agents (#148): the choice is the model, on the runners below
      if(md==='agent'){const rc=fellowshipRunnerControl(cname(C));if(!rc.querySelector('[data-runact="stopall"]'))rc.insertBefore(runnerPick('fellowship',pulledModels(),openaiModels()),rc.firstChild);mm.append(rc)}}
    else mm.append(coRunners(C));
    renderSettings(mm,C);node.append(mm)}
  if(drawer==='fallen'&&(C.past||[]).length){const fa=el('div','feldrawer');fa.setAttribute('data-k','fallen');fa.append(el('div','fth-h dm','Fallen ('+C.past.length+')'));const ul=el('ul','tlist');
    for(const p of C.past.slice().reverse()){const li=el('li'),a=byId(p.id);li.append('† ',a?hn(a):p.name,' · '+(p.slot?(ROLE_NAME[String(p.slot).replace(/\d+$/,'')]||p.slot)+', ':'')+'Lv '+p.lvl+' '+p.cls+(p.cause?', '+p.cause:'')+', day '+p.day);ul.append(li)}fa.append(ul);node.append(fa)}
  if(fel&&devMode()&&C.enrich&&C.enrich.calls)node.append(el('div','dm','Relay writing: '+C.enrich.ok+' sheets written, '+C.enrich.fail+' kept scripted, $'+C.enrich.usd.toFixed(4)+(C.enrich.ms?' · last '+(C.enrich.ms/1000).toFixed(1)+' s':'')));
  if(devMode()&&(reqTotals.sent||reqTotals.denied)){const fl=recentFailures(),r=el('div','dm','Model requests: '+rpm()+'/min · '+reqTotals.sent+' sent, '+reqTotals.failed+' failed, '+reqTotals.denied+' held back');
    if(fl.length)r.title='Recent failures: '+fl.map(f=>f.kind+(f.hero?' '+f.hero:'')+': '+f.why).join(' | ');node.append(r);
    if(fl.length)node.append(el('div','dm','Last failure: '+fl[0].kind+(fl[0].hero?' ('+fl[0].hero+')':'')+', '+fl[0].why+'. Writing backs off, scripted text stands in.'))}}
// Start <company> / Stop for a company without a Fellowship runner, with the mind it starts with.
function coRunners(C){const rc=companyRunnerControl(C);if(!rc.querySelector('[data-runact="stopco"]'))rc.insertBefore(runnerPick('co:'+C.id,pulledModels(),openaiModels()),rc.firstChild);return rc}

// The All tab: one row per company (open it, follow it, its runner) with its thread and hall-job counts.
function allView(node){const L=companies(),F=followedCompany();
  node.append(el('div','fth-h dm','All companies ('+L.length+')'));
  const ul=el('div','felall');
  for(const C of L){const row=el('div','fm fco'),fel=!!C.slots&&S.fellowship===C;row.setAttribute('data-k','co'+C.id);
    const open=el('button','fconame f'+C.fac,cname(C));open.dataset.fact='tab:'+C.id;open.title='Open this company';
    const live=members(C),th=companyThreads(C).length,hb=hallBoard(C).length;
    row.append(open,el('span','fmeta dm',(C.hall?C.hall+' · ':'')+live.length+(fel?'/5':'')+' standing · '+th+' thread'+(th===1?'':'s')+' · '+hb+' on the board'+(C===F?' · followed':'')));
    const tools=el('span','ftools'),fb=el('button','mini',C===F&&cam.view==='fellow'?'Following':'Follow');fb.dataset.fact='follow:'+C.id;tools.append(fb);row.append(tools);
    row.append(fel?fellowshipRunnerControl(cname(C)):companyRunnerControl(C));
    ul.append(row)}
  node.append(ul)}

// The hall board (#334): the posted jobs that concern a company, one row each: the title, then region, level
// band, the day it was posted, whose oath or which elite it is, and who posted it (the watcher may see that; the
// heroes' brief never says it).
const hallMeta=r=>[r.region,r.band?'Lv '+r.band[0]+'-'+r.band[1]:null,'posted day '+r.day,
  r.oath?r.oath.name+'’s oath':null,r.elite?'elite '+r.elite.name+(r.elite.lvl!=null?' (Lv '+r.elite.lvl+')':'')+(r.elite.alive?'':', slain'):null,
  'by '+r.by].filter(Boolean).join(' · ');
const hallSig=C=>hallBoard(C).map(r=>r.id+':'+r.title+':'+hallMeta(r)).join('~');
function hallView(node,C){const L=hallBoard(C),box=el('div','felhall');box.setAttribute('data-k','hall');
  box.append(el('div','fth-h dm','Hall board'+(L.length?' ('+L.length+')':'')));
  if(!L.length){box.append(el('div','dm','No job for '+(C.slots?'the Fellowship':'this company')+' on the hall board.'));node.append(box);return}
  const ul=el('ul','tlist fhall');for(const r of L){const li=el('li');li.setAttribute('data-k','hj'+r.id);
    li.append(el('span','fhtitle',r.title),el('span','dm fhmeta',hallMeta(r)));if(r.giver)li.title='Posted for '+r.giver;ul.append(li)}
  box.append(ul);node.append(box)}

// The sheet editor is rebuilt only when it is opened, saved or closed, never on the tick, so typing is safe.
function sheetView(node,a){node.replaceChildren();if(!a)return;
  const box=el('div','fsheet');box.append(el('div','fname',a.name+'’s sheet'));
  box.append(el('div','dm fsrc',srcLine(a)));
  abilityBlock(box,a);
  const ta=(which,k,label,v,rows)=>{const l=el('label','fta');l.append(el('span','dm',label));const t=el('textarea');t.rows=rows||2;t.value=v||'';t.dataset.fw=which;t.dataset.fk=k;l.append(t);box.append(l)};
  archRow(box,a);
  for(const [k,label] of PERSONA_ORDER){ta('persona',k,label,personaValue(a.persona,k),2);pinBox(box.lastChild,a,k)}
  stanceBlock(box,a);
  ta('backstory','summary','Backstory summary',a.backstory&&a.backstory.summary,2);
  for(const [k,label] of BACKSTORY_ORDER)ta('backstory',k,label,a.backstory&&a.backstory.paras&&a.backstory.paras[k],3);
  const bar=el('div','fbar');const sv=el('button','go','Save sheet');sv.dataset.fact='save';const cl=el('button',null,'Close');cl.dataset.fact='close';bar.append(sv,cl);box.append(bar);
  node.append(box)}

const srcLine=a=>'Persona: '+(a.persona&&a.persona.src==='model'?'written by the model':'scripted')+(a.persona&&a.persona.edited?', edited':'')+'. Backstory: '+(a.backstory&&a.backstory.src==='model'?'written by the model':'scripted')+(a.backstory&&a.backstory.edited?', edited':'')+'.'+(enriching(a)?' The relay is still writing; saving now keeps your text.':'');

// Owner pins (#409): a field pinned here is fixed; the hero's agent cannot change it with become (it is told so).
function pinBox(host,a,k){if(!host)return;const l=el('span','fpin dm');const c=el('input');c.type='checkbox';c.dataset.fpin=k;c.checked=pinned(a,k);
  c.title='Pin: the hero’s agent cannot change this with become';c.setAttribute('aria-label','Pin '+k.replace('_',' ')+' for '+a.name);l.append(c,' pin');host.append(l)}

// Stances toward each companion (#316, the UI for #305): one box per living companion holding the line the
// persona itself holds (the owner's, the archetype's or the model's); an empty box lets the bond reading speak,
// shown as the placeholder. Save writes only the boxes that changed, so an archetype or model line is never
// turned into the owner's by saving something else. Rows are filled in place after Save, Reset and an
// archetype pick, never rebuilt, so scroll and focus stay where they are.
const stanceHint=a=>a.persona&&a.persona.archetype?'Empty = the archetype line, else the bond decides.':'Empty = the bond decides.';
function stanceSrc(a,b){const P=a.persona;if(!P||!authoredStance(a,b))return '';
  if(P.stanceBy&&P.stanceBy[b.id]==='owner')return 'owner';
  return P.src==='model'&&P.stances&&P.stances[b.id]?'model':P.archetype?'archetype':''}
function stanceBlock(box,a){const mates=companyMates(a).filter(b=>b!==a);if(!mates.length)return;
  const w=el('div','fstances');w.setAttribute('data-k','stances');const sh=el('div','dm fsth','Stance toward each companion');pinBox(sh,a,'stance');w.append(sh);
  for(const b of mates){const r=el('div','fstance');r.dataset.fst=b.id;
    const h=el('div','fsthead'),id='fst'+a.id+'_'+b.id,lb=el('label','fstname',b.name);lb.htmlFor=id;
    const tag=el('span','badge fsttag'),cnt=el('span','dm fstcount');
    const rs=el('button','mini','Reset');rs.dataset.fstreset=b.id;rs.title='Drop your line: the bond reading (or the archetype line) speaks again';rs.setAttribute('aria-label','Reset '+a.name+'’s stance toward '+b.name);
    h.append(lb,el('span','dm fstcls',b.cls),tag,cnt,rs);
    const t=el('textarea');t.id=id;t.rows=2;t.setAttribute('maxlength',String(STANCE_MAX));t.dataset.fw='stance';t.dataset.fk=String(b.id);
    r.append(h,t);w.append(r);fillStance(r,a,b)}
  w.append(el('div','dm fsthint',stanceHint(a)));
  box.append(w)}
function fillStance(r,a,b){const t=r.querySelector('textarea'),v=authoredStance(a,b),src=stanceSrc(a,b);
  t.value=v;t.dataset.orig=v;t.placeholder=scriptedStance(a,b);
  const tag=r.querySelector('.fsttag');tag.textContent=src;tag.hidden=!src;tag.className='badge fsttag'+(src?' st-'+src:'');
  r.querySelector('[data-fstreset]').hidden=src!=='owner';stanceCount(t)}
function stanceCount(t){const r=t.closest('.fstance'),c=r&&r.querySelector('.fstcount');if(c)c.textContent=t.value.length+'/'+STANCE_MAX}
// After Save, Reset or an archetype pick: the rows and the source line patched in place (with keep, a box
// holding typed but unsaved text is left alone).
function refreshSheet(a,keep){if(!sheet)return;const s=sheet.querySelector('.fsrc');if(s)s.textContent=srcLine(a);
  for(const r of sheet.querySelectorAll('.fstance')){const b=byId(r.dataset.fst),t=r.querySelector('textarea');if(!b||!t)continue;if(keep&&t.value!==t.dataset.orig)continue;fillStance(r,a,b)}
  const h=sheet.querySelector('.fsthint');if(h)h.textContent=stanceHint(a)}

// Archetype (#295): picking one rewrites the persona text through applyArchetype and fills the five persona
// boxes in place (the backstory boxes keep whatever is typed there). The hint is the archetype's voice.
const archHint=id=>ARCHETYPES[id]?ARCHETYPES[id].blurb+' '+ARCHETYPES[id].voice:'No archetype: the persona below is the hero’s own.';
function archRow(box,a){const cur=a.persona&&a.persona.archetype,l=el('label','fta farch');l.append(el('span','dm','Archetype'));
  const s=el('select','msel');s.dataset.farch=a.id;s.title='Rewrites voice, wants, fears, quirk and never says; fills stances toward companions that have none of their own';
  if(!ARCHETYPES[cur])s.append(new Option('None (choose one)',''));
  for(const id of ARCHETYPE_IDS)s.append(new Option(ARCHETYPES[id].name,id));s.value=ARCHETYPES[cur]?cur:'';
  l.append(s,el('span','dm farchhint',archHint(cur)));box.append(l)}
function pickArchetype(s){const a=byId(s.dataset.farch),id=s.value;if(!a||!ARCHETYPES[id]||!applyArchetype(a,id))return false;
  editSheet(a,'persona','voice',a.persona.voice); // marks the persona as the owner's, so relay writing never replaces it
  for(const t of sheet.querySelectorAll('textarea[data-fw="persona"]'))t.value=personaValue(a.persona,t.dataset.fk);
  const h=s.parentNode&&s.parentNode.querySelector('.farchhint');if(h)h.textContent=archHint(id);
  for(const o of [...s.children])if(o.value==='')o.remove();
  refreshSheet(a,true);
  msg=ARCHETYPES[id].name+' applied to '+a.name+'. Edit the boxes and Save to change the words.';return true}

function act(t){msg='';
  if(mindAct(t))return;
  if(t.dataset.ffill){offerReplacement(t.dataset.ffill);return}
  if(t.dataset.fadd){const s=cam.sel;if(s&&join(s,t.dataset.fadd,'chosen by the watcher'))msg=s.name+' joins.';return}
  if(t.dataset.fstreset!=null){const a=byId(sheetOpen),b=byId(t.dataset.fstreset),r=t.closest('.fstance');if(!a||!b||!r)return;
    editSheet(a,'stance',b.id,'');fillStance(r,a,b);refreshSheet(a,true);r.querySelector('textarea').focus();msg=a.name+'’s stance toward '+b.name+' is reset.';return}
  if(t.dataset.fsheet){sheetOpen=+t.dataset.fsheet;sheetView(sheet,byId(sheetOpen));return}
  if(t.dataset.fremove){const a=byId(t.dataset.fremove);if(a){leave(a,'sent away by the watcher');msg=a.name+' leaves. Fill the empty place, or add a hero.'}return}
  const k=t.dataset.fact;
  if(k&&k.startsWith('tab:')){const w=k.slice(4);tabSel=w==='all'?'all':+w;drawer=null;menuOpen=false;confirmDisband=false;moreThreads=false;sigLog='';return}
  const cur=tabNow().C,F=S.fellowship;
  if(k&&k.startsWith('follow:')){const C=companies().find(x=>x.id===+k.slice(7));if(C){if(followedCompany()===C&&cam.view==='fellow')setViewHook('map');else{followCompany(C);setViewHook('fellow')}}return}
  if(k==='follow'){if(!cur)return;if(followedCompany()===cur&&cam.view==='fellow')setViewHook('map');else{followCompany(cur);setViewHook('fellow')}return}
  if(k==='menu'){menuOpen=!menuOpen;confirmDisband=false;return}
  if(k==='more'){moreThreads=!moreThreads;return}
  if(k&&k.startsWith('drawer:')){const w=k.slice(7);drawer=drawer===w?null:w;return}
  if(k==='disband'){if(!F)return;if(!confirmDisband){confirmDisband=true;return}confirmDisband=false;menuOpen=false;drawer=null;disbandFellowship();sheetOpen=null;sheetView(sheet,null);onFilter();setViewHook('map');return}
  if(k==='save'){const a=byId(sheetOpen);if(a){for(const ta of sheet.querySelectorAll('textarea[data-fw]')){if(ta.dataset.fw==='stance'&&ta.value===ta.dataset.orig)continue;editSheet(a,ta.dataset.fw,ta.dataset.fk,ta.value)}
    refreshSheet(a,false)}msg='Sheet saved.';return} // in place: scroll, focus and the boxes stay
  if(k==='close'){sheetOpen=null;sheetView(sheet,null)}}

let setViewHook=()=>{};
export function initFellowship(setView){setViewHook=setView||(()=>{});root=$('felbody');if(!root)return;
  top=el('div');sheet=el('div');
  // the campaign log is a tab of the Story panel (#145); an older page without it keeps it here
  const cp=$('campaign');if(cp){logBox=cp;logBox._b=cp;root.append(top,sheet)}
  else{logBox=el('details','tlbox felLog');logBox.open=true;logBox.append(el('summary',null,'Campaign log'));const lb=el('div');logBox.append(lb);logBox._b=lb;root.append(top,sheet,logBox)}
  const st=$('storyTabs');if(st)st.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-story]');if(!b)return;story=b.dataset.story;syncChronBtn()});
  root.addEventListener('click',e=>{const t=e.target&&e.target.closest?e.target.closest('button'):null;if(!t||!root.contains(t))return;
    if(t.closest('.hn')||t.dataset.runact)return;act(t);sigTop='';renderFellowship()});
  root.addEventListener('input',e=>{const t=e.target;if(t&&t.dataset&&t.dataset.fw==='stance')stanceCount(t)});
  root.addEventListener('keydown',e=>{if(e.key==='Escape'&&(menuOpen||drawer)){menuOpen=false;confirmDisband=false;drawer=null;sigTop='';renderFellowship()}});
  root.addEventListener('change',e=>{const s=e.target;if(mindChange(s)){sigTop='';renderFellowship();return}
    if(s&&s.dataset&&s.dataset.fpin!=null){const a=byId(sheetOpen);if(a&&pinField(a,s.dataset.fpin,s.checked))msg=a.name+(s.checked?': '+s.dataset.fpin.replace('_',' ')+' is pinned; the agent cannot change it.':': '+s.dataset.fpin.replace('_',' ')+' is free again for the agent to change.');sigTop='';renderFellowship();return}
    if(s&&s.dataset&&s.dataset.farch!=null){if(pickArchetype(s)){sigTop='';renderFellowship()}return}});
  const cb=$('chronFel');if(cb)cb.addEventListener('click',()=>{focus=!focus;syncChronBtn();onFilter()});
  renderFellowship()}

// The signature of what the visible tab shows; the panel is patched in place only when it changes (and never under a press or a picker).
function companySig(C){const fel=!!C.slots&&S.fellowship===C,fo=followedCompany();
  return 'C'+C.id+'|'+cname(C)+'|'+msg+'|'+confirmDisband+'|'+menuOpen+'|'+drawer+'|'+moreThreads+'|'+companyThreads(C).map(t=>plainOf(t.parts)).join('~')+'|'+
  (fel?mindsOf(C)+'|'+(mindsOf(C)==='agent'?runnerSig(null):''):companyRunnerSig(C))+'|'+cam.view+'|'+(fo?fo.id:'')+'|'+(cam.sel?cam.sel.id:'')+'|'+
  companyCols(C).map(m=>m.hero?m.hero.id+':'+m.hero.name+':'+(m.hero.state==='dead')+':'+enriching(m.hero)+':'+mindRowSig(m.hero):'-').join(',')+'|'+
  (fel&&fellowParty()?fellowParty().leader.id:'')+'|'+(fel?campLine()||'':'')+'|'+hallSig(C)+'|'+(C.past||[]).length+'|'+(fel&&C.enrich?C.enrich.calls:0)+'|'+reqTotals.sent+'|'+reqTotals.failed+'|'+devMode()}
function allSig(){const fo=followedCompany();
  return 'all|'+(fo?fo.id:'')+'|'+cam.view+'|'+companies().map(C=>C.id+':'+cname(C)+':'+members(C).length+':'+companyThreads(C).length+':'+hallBoard(C).length+':'+(C.slots?runnerSig(null):companyRunnerSig(C))).join(',')}

export function renderFellowship(){if(!root)return;syncChronBtn();
  const t=tabNow(),L=companies();
  if(!L.length){if(logBox!==$('campaign'))logBox.hidden=true;
    const sig='none|'+msg;
    if(sig!==sigTop&&patch(top,n=>{n.append(el('div','dm','No company yet. Start a New world to found one on its setup page.'))}))sigTop=sig;return}
  if(logBox!==$('campaign'))logBox.hidden=false;
  const sig='t|'+L.map(C=>C.id+':'+cname(C)).join(',')+'|'+tabKey(t)+'|'+(t.all?allSig():companySig(t.C));
  if(sig!==sigTop&&patch(top,n=>{tabsView(n,t);if(t.all)allView(n);else topView(n,t.C)}))sigTop=sig;
  const ls=tabKey(t)+':'+(t.all?L.map(C=>C.id+'.'+(C.seq||0)).join(','):t.C.id+':'+(t.C.seq||0));
  if(ls!==sigLog&&patch(logBox._b,n=>renderCampaignLog(n,t.all?{all:true}:{C:t.C})))sigLog=ls}
