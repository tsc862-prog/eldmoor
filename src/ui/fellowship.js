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
import {portrait} from '../render/sprites.js'; // face portraits (#367)
import {FAC} from '../data/factions.js';
import {renderNotebook} from './notebook.js'; // agent memories (#155)
import {S} from '../sim/index.js';
import {cam} from '../render/draw.js';
import {rpm,totals as reqTotals,recentFailures} from '../sim/throttle.js';
import {campSummary} from '../sim/camp.js';
// The sim's camp line, with a watch end it could not compute (NaN) left out rather than shown as "until NaN:NaN" (#475).
export const campLine=()=>{const s=campSummary();return s?s.replace(/ \(until [^)]*NaN[^)]*\)/g,''):s};
import {hallBoard} from '../sim/dmfocus.js'; // the hall board's jobs for the Fellowship (#334), read-only
import {MINDS,mindsOf,setMinds,SLOTS,fits,fellowshipMembers,fellows,fellowParty,autoPick,found,join,leave,offerReplacement,disbandFellowship,openThreads,editSheet,enriching,chronicleFocus,campaign} from '../sim/fellowship.js';
import {PERSONA_ORDER,BACKSTORY_ORDER,ROLE_NAME,applyArchetype,authoredStance,scriptedStance,personaValue,pinField,pinned} from '../sim/persona.js';
import {STANCE_MAX} from '../data/prompts.js'; // the stance cap the model gets (#305)
import {ARCHETYPES,ARCHETYPE_IDS} from '../data/archetypes.js'; // persona archetypes (#295)
import {enableBrain,disableBrain} from '../sim/brain.js';
import {abilityBlock} from './abilities.js'; // class abilities (issue #81)
import {renderMindRow,mindAct,mindChange,mindRowSig,pulledModels,openaiModels} from './mindpick.js'; // per-member mind (Mixed minds, #97)
import {fellowshipRunnerControl,runnerPick,runnerSig} from './runners.js'; // app runners: Start all five / Stop all
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
export function renderSettings(node){const P=fellowParty(),ul=el('div','felroster');
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
export function renderBackstory(node,a){const B=a&&a.backstory;if(!B){node.append(el('div','dm','No backstory yet.'));return}
  for(const [k,label] of BACKSTORY_ORDER){const t=B.paras&&B.paras[k];if(!t)continue;const p=el('p','bio');p.append(el('span','gd',label+'. '),t);node.append(p)}
  node.append(el('div','dm',(B.src==='model'?'Written by the model'+(B.model?' ('+B.model+')':''):'Scripted from the world')+(B.edited?', edited by you':'')+'.'))}
export function renderPersona(node,a){const P=a&&a.persona;if(!P){node.append(el('div','dm','No persona yet.'));return}
  const kv=el('div','kv');for(const [k,label] of PERSONA_ORDER)kv.append(el('span','k',label),el('span','v',personaValue(P,k)));node.append(kv)}
const KIND_LABEL={council:'COUNCIL',table:'TABLE',camp:'CAMP',found:'FOUND',join:'JOIN',recruit:'RECRUIT',leave:'LEAVE',adventure:'JOB',scene:'SCENE',roll:'ROLL',branch:'CHOICE',complication:'TWIST',outcome:'END',npc:'MET',fight:'FIGHT',level:'LVL',kill:'KILL',death:'DEATH',session:'DAY',note:'NOTE'};
export function renderCampaignLog(node,o={}){const F=S.fellowship;if(!F){node.append(el('div','dm','No Fellowship.'));return}
  const days=[];for(const e of F.log){let d=days[days.length-1];if(!d||d.day!==e.day){d={day:e.day,list:[]};days.push(d)}d.list.push(e)}
  if(!days.length){node.append(el('div','dm','Nothing yet. The log fills as the five take jobs, roll dice and bleed.'));return}
  days.slice(0,o.days||8).forEach((d,i)=>{const box=el('details','felday');box.setAttribute('data-k','day'+d.day);if(i===0)box.open=true;
    const n=k=>d.list.filter(e=>e.kind===k).length;
    box.append(el('summary',null,'Day '+d.day+' · '+d.list.length+' entries'+(n('death')?' · '+n('death')+' fallen':'')+(n('adventure')?' · '+n('adventure')+' job'+(n('adventure')>1?'s':''):'')));
    const ul=el('ul','tlist');for(const e of d.list){const li=el('li');li.setAttribute('data-k',keyOf(e));li.append(el('time',null,e.t),el('span','badge k-'+e.kind,KIND_LABEL[e.kind]||e.kind),' ');parts(li,e.parts);ul.append(li)}
    box.append(ul);node.append(box)})}
export function renderThreads(node){const th=openThreads();if(!th.length){node.append(el('div','dm','No open threads.'));return}
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
let focus=true;
export const chronicleShows=e=>regionLine(e)&&(!focus||!S.fellowship||chronicleFocus(e)); // the region picker (#430) narrows it further
let onFilter=()=>{};
export function setChronicleRefresh(f){onFilter=f}
export const refreshChronicle=()=>onFilter();
// The Story panel (#145): the Chronicle, and with a Fellowship its Campaign log as a second tab.
let story='chron';
function syncChronBtn(){const F=!!S.fellowship,camp=F&&story==='camp',b=$('chronFel'),t=$('storyTabs'),tt=$('storyTtl'),lg=$('log'),cp=$('campaign');
  if(b){b.hidden=!F||camp;b.setAttribute('aria-pressed',String(focus))}
  if(t){t.hidden=!F;for(const x of t.children)x.setAttribute('aria-pressed',String(x.dataset.story===(camp?'camp':'chron')))}
  if(tt&&tt.textContent!==(F?'Story':'Chronicle'))tt.textContent=F?'Story':'Chronicle';
  if(lg)lg.hidden=camp;if(cp)cp.hidden=!camp}

// ---- the panel ----
let draft={fac:0,slots:{tank:null,healer:null,dps1:null,dps2:null,dps3:null}},msg='',sheetOpen=null,confirmDisband=false,drawer=null,menuOpen=false,moreThreads=false;
let sigTop='',sigLog='',sigForm='',root=null,top=null,sheet=null,logBox=null;

function eligibleFor(slot,fac){return S.agents.filter(a=>alive(a)&&a.fac===fac&&!a.fellow&&!a.player&&fits(slot,a)).sort((x,y)=>y.lvl-x.lvl||x.id-y.id)}
function formView(node){const f=draft.fac;
  const facs=el('div','tfilter');FAC.forEach((F,i)=>{const b=el('button',null,F.name);b.dataset.ffac=i;b.setAttribute('aria-pressed',String(i===f));facs.append(b)});node.append(facs);
  node.append(el('div','dm','Five places, fixed roles: one Tank (Warrior), one Healer (Priest or Wildspeaker), three DPS (Mage, Hunter, Rogue or Skald). An empty place is filled by a fresh recruit.'));
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

const plainOf=ps=>(ps||[]).map(p=>typeof p==='string'?p:p&&p.kind==='hero'?p.name:p&&p.t||'').join('');
const THREADS=4; // open threads shown before "+N more"
// The header is one line (the owner found the old panel took the top of the column for little);
// threads lead, and Members and Fallen open in a drawer under it. Disband sits behind the ... menu.
function topView(node){const F=S.fellowship;
  const h=el('div','fhline');
  const nm=el('span','fname f'+F.fac,F.name);nm.title=F.name;
  const n=fellows().length;
  h.append(nm,el('span','fbadge f'+F.fac,FAC[F.fac].name),el('span','fmeta dm',F.hall+' · '+n+'/5 standing'+(F.past.length?' · '+F.past.length+' fallen':'')+' · day '+(Math.floor(F.founded/1440)+1)));
  const tools=el('span','ftools2');
  const ib=(fact,txt,label,pressed)=>{const b=el('button','ficon',txt);b.dataset.fact=fact;b.title=label;b.setAttribute('aria-label',label);if(pressed!=null)b.setAttribute('aria-pressed',String(pressed));return b};
  tools.append(ib('follow','◎','Follow the Fellowship',cam.view==='fellow'),ib('drawer:members','☰','Members and minds',drawer==='members'));
  if(F.past.length)tools.append(ib('drawer:fallen','†','Fallen ('+F.past.length+')',drawer==='fallen'));
  tools.append(ib('menu','⋯','More',menuOpen));
  h.append(tools);node.append(h);
  if(menuOpen){const m=el('div','felmenu');
    if(!confirmDisband){const d=el('button',null,'Disband the Fellowship...');d.dataset.fact='disband';m.append(d)}
    else{m.append(el('span','dm','Disband for good? The five go their own ways.'));const y=el('button','danger','Yes, disband');y.dataset.fact='disband';const c=el('button',null,'Cancel');c.dataset.fact='menu';m.append(y,c)}
    node.append(m)}
  const cs=campLine();if(cs)node.append(el('div','gd fcamp',cs)); // camp: how long, who sleeps, who watches (#178)
  if(msg)node.append(el('div','fmsg',msg));
  // Open threads lead (oaths, meeting plans, unfinished jobs, blood owed): live one-liners
  const th=openThreads(),box=el('div','felthreads');box.setAttribute('data-k','threads');
  box.append(el('div','fth-h dm','Open threads'+(th.length?' ('+th.length+')':'')));
  if(!th.length)box.append(el('div','dm','No open threads. Oaths, meeting plans and jobs show here.'));
  else{const ul=el('ul','tlist fthreads');th.slice(0,moreThreads?th.length:THREADS).forEach((t,i)=>{const li=el('li','th-'+t.kind);li.setAttribute('data-k','th'+i);parts(li,t.parts);ul.append(li)});box.append(ul);
    if(th.length>THREADS){const mb=el('button','mini',moreThreads?'Show fewer':'+'+(th.length-THREADS)+' more');mb.dataset.fact='more';box.append(mb)}}
  node.append(box);
  hallView(node);
  if(drawer==='members'){const mm=el('div','feldrawer felmem');mm.setAttribute('data-k','members');mm.append(el('div','fth-h dm','Members and minds'));
    const md=mindsOf(F); // always agents (#148): the choice is the model, on the runners below
    if(md==='agent'){const rc=fellowshipRunnerControl();if(!rc.querySelector('[data-runact="stopall"]'))rc.insertBefore(runnerPick('fellowship',pulledModels(),openaiModels()),rc.firstChild);mm.append(rc)}
    renderSettings(mm);node.append(mm)}
  if(drawer==='fallen'&&F.past.length){const fa=el('div','feldrawer');fa.setAttribute('data-k','fallen');fa.append(el('div','fth-h dm','Fallen ('+F.past.length+')'));const ul=el('ul','tlist');
    for(const p of F.past.slice().reverse()){const li=el('li'),a=byId(p.id);li.append('† ',a?hn(a):p.name,' · '+(ROLE_NAME[String(p.slot).replace(/\d+$/,'')]||p.slot)+', Lv '+p.lvl+' '+p.cls+', '+p.cause+', day '+p.day);ul.append(li)}fa.append(ul);node.append(fa)}
  if(devMode()&&F.enrich&&F.enrich.calls)node.append(el('div','dm','Relay writing: '+F.enrich.ok+' sheets written, '+F.enrich.fail+' kept scripted, $'+F.enrich.usd.toFixed(4)+(F.enrich.ms?' · last '+(F.enrich.ms/1000).toFixed(1)+' s':'')));
  if(devMode()&&(reqTotals.sent||reqTotals.denied)){const fl=recentFailures(),r=el('div','dm','Model requests: '+rpm()+'/min · '+reqTotals.sent+' sent, '+reqTotals.failed+' failed, '+reqTotals.denied+' held back');
    if(fl.length)r.title='Recent failures: '+fl.map(f=>f.kind+(f.hero?' '+f.hero:'')+': '+f.why).join(' | ');node.append(r);
    if(fl.length)node.append(el('div','dm','Last failure: '+fl[0].kind+(fl[0].hero?' ('+fl[0].hero+')':'')+', '+fl[0].why+'. Writing backs off, scripted text stands in.'))}}

// The hall board (#334): the posted jobs that concern the Fellowship, one row each: the title, then region, level
// band, the day it was posted, whose oath or which elite it is, and who posted it (the watcher may see that; the
// heroes' brief never says it).
const hallMeta=r=>[r.region,r.band?'Lv '+r.band[0]+'-'+r.band[1]:null,'posted day '+r.day,
  r.oath?r.oath.name+'’s oath':null,r.elite?'elite '+r.elite.name+(r.elite.lvl!=null?' (Lv '+r.elite.lvl+')':'')+(r.elite.alive?'':', slain'):null,
  'by '+r.by].filter(Boolean).join(' · ');
const hallSig=()=>hallBoard().map(r=>r.id+':'+r.title+':'+hallMeta(r)).join('~');
function hallView(node){const L=hallBoard(),box=el('div','felhall');box.setAttribute('data-k','hall');
  box.append(el('div','fth-h dm','Hall board'+(L.length?' ('+L.length+')':'')));
  if(!L.length){box.append(el('div','dm','No job for the Fellowship on the hall board.'));node.append(box);return}
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
function stanceBlock(box,a){const mates=fellows().filter(b=>b!==a&&alive(b));if(!mates.length)return;
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

function act(t){const F=S.fellowship;msg='';
  if(mindAct(t))return;
  if(t.dataset.ffac!=null){draft.fac=+t.dataset.ffac;draft.slots={tank:null,healer:null,dps1:null,dps2:null,dps3:null};sigForm='';return}
  if(t.dataset.ffill){offerReplacement(t.dataset.ffill);return}
  if(t.dataset.fadd){const s=cam.sel;if(s&&join(s,t.dataset.fadd,'chosen by the watcher'))msg=s.name+' joins.';return}
  if(t.dataset.fstreset!=null){const a=byId(sheetOpen),b=byId(t.dataset.fstreset),r=t.closest('.fstance');if(!a||!b||!r)return;
    editSheet(a,'stance',b.id,'');fillStance(r,a,b);refreshSheet(a,true);r.querySelector('textarea').focus();msg=a.name+'’s stance toward '+b.name+' is reset.';return}
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
  if(k==='menu'){menuOpen=!menuOpen;confirmDisband=false;return}
  if(k==='more'){moreThreads=!moreThreads;return}
  if(k&&k.startsWith('drawer:')){const w=k.slice(7);drawer=drawer===w?null:w;return}
  if(k==='disband'){if(!confirmDisband){confirmDisband=true;return}confirmDisband=false;menuOpen=false;drawer=null;disbandFellowship();sheetOpen=null;sheetView(sheet,null);onFilter();setViewHook('map');return}
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
    if(t.closest('.hn'))return;act(t);sigTop='';sigForm='';renderFellowship()});
  root.addEventListener('input',e=>{const t=e.target;if(t&&t.dataset&&t.dataset.fw==='stance')stanceCount(t)});
  root.addEventListener('keydown',e=>{if(e.key==='Escape'&&(menuOpen||drawer)){menuOpen=false;confirmDisband=false;drawer=null;sigTop='';renderFellowship()}});
  root.addEventListener('change',e=>{const s=e.target;if(mindChange(s)){sigTop='';renderFellowship();return}
    if(s&&s.dataset&&s.dataset.fpin!=null){const a=byId(sheetOpen);if(a&&pinField(a,s.dataset.fpin,s.checked))msg=a.name+(s.checked?': '+s.dataset.fpin.replace('_',' ')+' is pinned; the agent cannot change it.':': '+s.dataset.fpin.replace('_',' ')+' is free again for the agent to change.');sigTop='';renderFellowship();return}
    if(s&&s.dataset&&s.dataset.farch!=null){if(pickArchetype(s)){sigTop='';renderFellowship()}return}
    if(s&&s.dataset&&s.dataset.fslot){const v=s.value;draft.slots[s.dataset.fslot]=v?+v:null;sigForm='';renderFellowship()}});
  const cb=$('chronFel');if(cb)cb.addEventListener('click',()=>{focus=!focus;syncChronBtn();onFilter()});
  renderFellowship()}

export function renderFellowship(){if(!root)return;const F=S.fellowship;syncChronBtn();
  if(!F){if(logBox!==$('campaign'))logBox.hidden=true;
    const sig='f|'+draft.fac+'|'+JSON.stringify(draft.slots)+'|'+msg+'|'+S.agents.filter(a=>alive(a)&&a.fac===draft.fac).map(a=>a.id+':'+a.lvl).join(',');
    if(sig!==sigForm&&patch(top,n=>formView(n))){sigForm=sig;sigTop=''}return}
  if(logBox!==$('campaign'))logBox.hidden=false;
  const sig='t|'+F.id+'|'+msg+'|'+confirmDisband+'|'+menuOpen+'|'+drawer+'|'+moreThreads+'|'+openThreads().map(t=>plainOf(t.parts)).join('~')+'|'+mindsOf(F)+'|'+(mindsOf(F)==='agent'?runnerSig(null):'')+'|'+cam.view+'|'+(cam.sel?cam.sel.id:'')+'|'+fellowshipMembers().map(m=>m.hero?m.hero.id+':'+m.hero.name+':'+(m.hero.state==='dead')+':'+enriching(m.hero)+':'+mindRowSig(m.hero):'-').join(',')+'|'+(fellowParty()?fellowParty().leader.id:'')+'|'+(campLine()||'')+'|'+hallSig()+'|'+F.past.length+'|'+(F.enrich?F.enrich.calls:0)+'|'+reqTotals.sent+'|'+reqTotals.failed+'|'+devMode();
  // patched in place (#145): never under an open picker, a press or a scroll; open threads and days stay open
  if(sig!==sigTop&&patch(top,n=>topView(n))){sigTop=sig;sigForm=''}
  const ls=F.id+':'+(F.seq||0);if(ls!==sigLog&&patch(logBox._b,n=>renderCampaignLog(n)))sigLog=ls}
