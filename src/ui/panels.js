// Side panels: hero dossier (header + Stats/Log/Bio/Gear/Party/Chat/Mind tabs), factions,
// chronicle, graveyard, guilds, top heroes, auction house, clock. Reads sim state
// and the renderer's camera selection.
// Every hero name in the panels is a <span class="hn f0|f1" data-hid="id">; one
// delegated click handler (initPanels) looks the hero up in S.agents and hands it
// to the picker, which controls.js wires to select + follow.
import {clamp} from '../core/rng.js';
import {CITY,CRYPT,ZONES,zoneFor} from '../world/map.js';
import {FAC} from '../data/factions.js';
import {CLS} from '../data/classes.js';
import {TRAITS} from '../data/traits.js';
import {raceOf,homeOf} from '../data/races.js';
import {MOBS} from '../data/mobs.js';
import {GOODS,price,STAT_KEYS,STAT_NAMES,EPIC_STATS} from '../data/items.js';
import {itemStats,gearStat,gearBonus} from '../sim/gear.js';
import {S,clockStr,maxHp,xpNeed,atkOf,onLog,onMarketTick} from '../sim/index.js';
import {cam} from '../render/draw.js';
import {weatherName} from '../sim/weather.js';
import {friendsOf} from '../sim/bonds.js';
import {biography} from './biography.js';
import {initTimeline} from './timeline.js';
import {livingGuilds,membersOf,leaderOf} from '../sim/guilds.js';
import {enableBrain,disableBrain,brainStatus,mindUser} from '../sim/brain.js';
import {advLine} from '../sim/dm.js';

const $=id=>document.getElementById(id);
let pick=()=>{};
// The controls module installs the handler used when a hero is clicked in a list.
export function setPicker(f){pick=f}

export const living=()=>S.agents.filter(a=>a.state!=='dead');
export const ranked=()=>living().sort((a,b)=>b.lvl-a.lvl||b.xp-a.xp||b.kills-a.kills);

// ---- small DOM helpers ----
const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
// Clickable hero name. Dead heroes stay clickable while their grave is still in S.agents.
export const hn=a=>{const s=el('span','hn f'+a.fac,a.name);s.dataset.hid=a.id;return s};
const meter=(cls,frac)=>{const m=el('div','meter '+cls);const i=document.createElement('i');i.style.width=clamp(frac*100,0,100)+'%';m.append(i);return m};
// Render chronicle-style parts (strings, heroes, {t,c} spans) into a node.
const parts=(node,ps)=>{for(const p of ps){if(typeof p==='string')node.append(p);else if(p&&p.kind==='hero')node.append(hn(p));else if(p)node.append(el('span',p.c||'',p.t))}};
// Zone index from a number or a zone name; -1 when unknown.
const zoneIdx=z=>typeof z==='number'?z:ZONES.indexOf(z);

// One line describing what a hero is doing right now.
export function doing(a){const c=homeOf(a).name,zn=ZONES[a.zone];
  switch(a.state){
    case 'town':return a.townStep===0?`Selling loot at the ${c} auction house`:a.townStep===1?`Checking in with the ${c} quest giver`:`Leaving ${c} for ${ZONES[a.party?a.party.zone:zoneFor(a.lvl,homeOf(a).gate)]}`;
    case 'travel':return `Traveling to ${zn}`;
    case 'hunt':return a.quest?`Hunting ${MOBS[a.quest.type].pl} in ${zn}`:`Hunting in ${zn}`;
    case 'fight':return a.target?`Fighting a level ${a.target.lvl} ${MOBS[a.target.type].name}`:'Fighting';
    case 'return':return `Heading back to ${c}`;
    case 'duel':return a.target?`Fighting ${a.target.name} of the ${FAC[a.target.fac].name}`:'In a fight';
    case 'ghost':return `Dead. Running back to ${c} as a ghost`;
    case 'raid':return 'Raiding Kragmaw the Cinder Wyrm';
    case 'dead':return `Fell at level ${a.lvl}, ${a.cause}, at ${a.diedAt}. Gone forever.`;
    case 'assist':return a.target?`Helping a guildmate fight ${a.target.name}`:'Helping a guildmate';
    case 'follow':return a.party?`Following ${a.party.leader.name}'s party in ${zn}`:'Following the party';
    case 'regroup':return 'Pulling back after a skirmish';
    case 'dungeon':return a.hidden?`Inside ${CRYPT.name}, fighting toward ${CRYPT.boss}`:`Gathering a group at ${CRYPT.name}`;}return ''}

// ---- hero dossier ----
const TABS=[['stats','Stats'],['log','Log'],['bio','Bio'],['gear','Gear'],['party','Party'],['chat','Chat'],['mind','Mind']];
const SLOTS=[['head','Head'],['chest','Chest'],['hands','Hands'],['feet','Feet'],['main','Main hand'],['off','Off hand'],['trinket','Trinket']];
let tab='stats'; // persists across hero changes
export const activeTab=()=>tab;
export function setTab(t){if(TABS.some(([k])=>k===t))tab=t;renderHero()}

// Gear score: the gear module's own number when it has merged (a.gearScore), else the
// mean item level of the seven slots, else the legacy a.gear counter.
// TODO(#20): swap in gearScore(a) from sim/gear.js once that module is on main.
const gearScoreOf=a=>typeof a.gearScore==='number'?a.gearScore:a.slots?Math.round(SLOTS.reduce((t,[k])=>t+(a.slots[k]?a.slots[k].ilvl||0:0),0)/SLOTS.length):a.gear;

function tabStats(b,a){const c=CLS[a.cls],mh=maxHp(a);
  const rows=[['Level',a.lvl],['Class',a.cls],['Faction',FAC[a.fac].name],['Guild',a.guild?`<${a.guild.tag}> ${a.guild.name}`:'Unguilded'],
    ['HP',`${Math.max(0,Math.round(a.hp))} / ${mh}`],['Attack',Math.round(atkOf(a))],['Armour',Math.round((1-(c.arm||1))*100)+'%'],
    ['Crit',Math.round((c.crit||.08)*100)+'%'],['Range',c.range>2?`${c.range} (ranged)`:`${c.range} (melee)`],
    ['XP to next',a.lvl>=20?'Max level':`${Math.max(0,xpNeed(a.lvl)-Math.round(a.xp))} xp`],
    ['Gold',a.gold+'g'],['Kills',a.kills],['Honor',a.honor],['Elite kills',a.eliteKills||0]];
  if(a.avenged!=null)rows.push(['Avenged',a.avenged]);
  const kv=el('div','kv');for(const [k,v] of rows)kv.append(el('span','k',k),el('span','v',String(v)));b.append(kv);
  if(a.slots){const f=el('div','meta gearline');f.append('From gear: ');
    const pct=k=>Math.round(gearBonus(a,k)*10)/10,parts=[`${gearStat(a,'vigor')} Vigor (+${Math.round(gearBonus(a,'vigor'))} HP)`,`${gearStat(a,'might')} Might (+${Math.round(gearBonus(a,'might'))} atk)`,
      `${gearStat(a,'guard')} Guard (-${pct('guard')}% dmg)`,`${gearStat(a,'precision')} Precision (+${pct('precision')}% crit)`,`${gearStat(a,'haste')} Haste (${pct('haste')}% faster)`];
    parts.forEach((t,i)=>{const s=el('span','s-'+STAT_KEYS[i],t);f.append(s);if(i<parts.length-1)f.append(' · ')});b.append(f)}
  const tr=el('div','meta');tr.append('Traits: ');const ts=a.traits||[];if(!ts.length)tr.append('none');
  ts.forEach((t,i)=>{const s=el('span','gd',t);if(TRAITS[t])s.title=TRAITS[t].desc;tr.append(s);if(i<ts.length-1)tr.append(', ')});b.append(tr);
  if(a.race){const rc=el('div','meta');rc.append('People: ');const rs=el('span','gd',raceOf(a).name);rs.title=raceOf(a).culture;rc.append(rs,' of '+homeOf(a).name);b.append(rc)}
  if(a.origin)b.append(el('div','meta',a.origin));
  if(a.goal){const g=el('div','goal');g.append(el('div',a.goal.done?'gd':'',(a.goal.done?'Done: ':'Goal: ')+a.goal.text));
    if(a.goal.need){g.append(meter('gl',a.goal.done?1:(a.goal.progress||0)/a.goal.need));g.append(el('div','dm',`${a.goal.done?a.goal.need:a.goal.progress||0} / ${a.goal.need}`))}b.append(g)}
  const q=a.quest?`${MOBS[a.quest.type].q}: ${a.quest.have}/${a.quest.need} ${MOBS[a.quest.type].pl}`:'No quest';
  b.append(el('div','meta','Quest: '+q));
  {const ad=advLine(a);if(ad){const d=el('div','meta adv');parts(d,ad);b.append(d)}} // the DM's adventure and scene (sim/dm.js)
  const nem=Object.entries(a.nemesis||{}).filter(([id])=>S.agents.some(x=>x.id==id&&x.state!=='dead')).pop();
  if(nem){const foe=S.agents.find(x=>x.id==nem[0]);const d=el('div','meta');d.append('Nemesis: ',hn(foe),` (killed guildmate ${nem[1]})`);b.append(d)}
  {const fr=friendsOf(a).slice(0,6);if(fr.length){const d=el('div','meta');d.append('Friends: ');fr.forEach((f,i)=>{d.append(hn(f));if(i<fr.length-1)d.append(', ')});b.append(d)}}
  b.append(el('div','meta',`Weather: ${weatherName(a.zone)} in ${ZONES[a.zone]}`))}

function tabLog(b,a){const h=(a.history||[]).slice().reverse();
  if(!h.length){b.append(el('div','dm','Nothing worth recording yet.'));return}
  const ul=el('ul','log hist');for(const e of h){const li=el('li');li.append(el('time',null,e.t));parts(li,e.parts||[e.text]);ul.append(li)}b.append(ul)}

// ---- item tooltip and pinned detail (issue #52) ----
// One tooltip div is reused for every hover; it lives on <body>, so the 0.3s tab rebuilds never
// destroy it. The hovered and pinned slots are remembered as keys (hero id + slot) and the item
// is looked up fresh from the hero each time, so the text follows upgrades and epic growth.
let tipEl=null,hov=null,pinned=null,tipXY=[0,0];
const qCls=it=>it.epic?'ep':it.quality==='rare'?'qr':it.quality==='fine'?'qf':'qp';
const qLabel=it=>it.epic?'Epic':it.quality==='rare'?'Rare':it.quality==='fine'?'Fine':'Plain';
const slotLabel=k=>(SLOTS.find(s=>s[0]===k)||[k,k])[1];
const fmtStat=(k,v)=>'+'+v+' '+STAT_NAMES[k];
function itemCard(it,cls){const d=el('div',cls||'itip');
  d.append(el('div','in '+qCls(it),it.name));
  d.append(el('div','dm',`${qLabel(it)} · ilvl ${it.ilvl} ${slotLabel(it.slot)}`));
  const st=itemStats(it);for(const k of STAT_KEYS)if(st[k])d.append(el('div','is s-'+k,fmtStat(k,st[k])));
  for(const f of it.affixes||[])d.append(el('div','ia',f));
  const z=zoneIdx(it.zone);if(z>=0)d.append(el('div','dm','Found in '+ZONES[z]));
  if(it.src)d.append(el('div','dm',it.src));
  if(it.epic&&EPIC_STATS[it.name])d.append(el('div','if',EPIC_STATS[it.name].flavour));
  if(it.over){const o=it.over,ds=[];for(const k of STAT_KEYS){const x=(st[k]||0)-((o.stats||{})[k]||0);if(x)ds.push((x>0?'+':'')+x+' '+STAT_NAMES[k])}
    d.append(el('div','dm','Replaced '+o.name+' (ilvl '+o.ilvl+')'+(ds.length?': '+ds.join(', '):'')))}
  return d}
const hoverItem=()=>{const a=cam.sel;return hov&&a&&a.id===hov.id&&a.slots?a.slots[hov.slot]:null};
function placeTip(){if(!tipEl)return;const pad=14,w=tipEl.offsetWidth,h=tipEl.offsetHeight,vw=window.innerWidth,vh=window.innerHeight;
  let x=tipXY[0]+pad,y=tipXY[1]+pad;if(x+w>vw-4)x=Math.max(4,tipXY[0]-w-pad);if(y+h>vh-4)y=Math.max(4,vh-h-4);
  tipEl.style.left=x+'px';tipEl.style.top=y+'px'}
function showTip(){const it=hoverItem();if(!it){hideTip();return}
  if(!tipEl){tipEl=el('div','itip floating');tipEl.setAttribute('role','tooltip');document.body.append(tipEl)}
  tipEl.replaceChildren(...itemCard(it).childNodes);tipEl.style.display='block';placeTip()}
function hideTip(){hov=null;if(tipEl)tipEl.style.display='none'}
// Delegated listeners on the persistent tab body: rows are rebuilt, the listeners are not.
function wireGear(tb){
  const slotOf=e=>{const r=e.target&&e.target.closest?e.target.closest('[data-slot]'):null;return r?r.dataset.slot:null};
  tb.addEventListener('pointermove',e=>{if(e.pointerType&&e.pointerType!=='mouse')return;tipXY=[e.clientX,e.clientY];const s=slotOf(e),a=cam.sel;
    if(!s||!a){if(hov)hideTip();return}
    if(!hov||hov.slot!==s||hov.id!==a.id){hov={id:a.id,slot:s};showTip()}else placeTip()});
  tb.addEventListener('pointerleave',hideTip);
  tb.addEventListener('click',e=>{const s=slotOf(e),a=cam.sel;if(!s||!a||!a.slots||!a.slots[s])return;
    pinned=pinned&&pinned.id===a.id&&pinned.slot===s?null:{id:a.id,slot:s};hideTip();renderHero()})}

function tabGear(b,a){
  if(pinned&&pinned.id!==a.id)pinned=null; // the pin belongs to one hero
  if(a.slots){const g=el('div','gear');
    for(const [k,label] of SLOTS){const it=a.slots[k],sel=pinned&&pinned.slot===k;
      const kk=el('span','k',label),v=el('span','v');kk.dataset.slot=k;v.dataset.slot=k;if(sel){kk.classList.add('pin');v.classList.add('pin')}
      g.append(kk);
      if(!it)v.append(el('span','dm','Empty'));
      else{v.append(el('span',qCls(it),it.name),' ',el('span','ilv','ilvl '+it.ilvl));
        const z=zoneIdx(it.zone);if(z>=0)v.append(' ',el('span','ztag z'+z,ZONES[z]));else if(it.zone)v.append(' ',el('span','ztag',String(it.zone)))}
      g.append(v)}
    b.append(g,el('div','meta','Gear score '+gearScoreOf(a)+' · hover or tap a slot'));
    const pit=pinned&&a.slots[pinned.slot];if(pit)b.append(itemCard(pit,'itip pinned'));return}
  b.append(el('div','meta','Gear score '+gearScoreOf(a)+' · bought piece by piece in town'));
  if(a.epics.length){const e=el('div','epics');e.append('Epics: ');a.epics.forEach((n,i)=>{e.append(el('span','ep','['+n+']'));if(i<a.epics.length-1)e.append(' ')});b.append(e)}
  else b.append(el('div','dm','No epic items yet.'))}

function tabParty(b,a){const p=a.party;
  if(!p||!p.mem.length){b.append(el('div','dm','Travelling alone.'));return}
  const g=el('div','party');
  for(const m of p.mem){const row=el('div','pm'+(m===p.leader?' lead':''));const nm=el('div','pn');
    if(m===p.leader)nm.append(el('span','gd crown','★ '));nm.append(hn(m),el('span','dm',` Lv ${m.lvl} ${m.cls}`));
    row.append(nm,meter('hp',m.hp/maxHp(m)));g.append(row)}
  b.append(g,el('div','meta',`★ leader · bound for ${ZONES[p.zone]}${p.home?' · heading home':''}`))}

function tabChat(b,a){const c=(a.chat||[]).slice(-20).reverse();
  if(!c.length){b.append(el('div','dm','Nothing said or heard yet.'));return}
  const ul=el('ul','log chat');for(const e of c){const li=el('li');li.append(el('time',null,e.t),hn(e.from));if(e.ai)li.append(' ',aiBadge('AI'));li.append(': '+e.text);ul.append(li)}b.append(ul)}

// ---- AI-played marking (sim/brain.js): toggle button next to the name, badge on the card and on model-written chat lines ----
const aiBadge=(t,title)=>{const s=el('span','ai-badge',t);if(title)s.title=title;return s};
function heroName(a){const d=el('div','nm f'+a.fac,a.name),st=brainStatus(a);
  if(st!=='off')d.append(' ',aiBadge('AI-played'+(st==='offline'?' (quiet)':''),'This hero\'s choices come from a language model via the local relay; the scripted rules take over whenever it is silent.'));
  const b=el('button','ai-toggle',st==='off'?'AI':'AI off');b.dataset.ai='1';b.title=st==='off'?'Let a language model play this hero (needs npm run relay)':'Return this hero to the scripted rules';d.append(' ',b);return d}
function tabBio(b,a){for(const p of biography(a,S.agents)){const d=el('p','bio');parts(d,p);b.append(d)}}

// ---- Mind tab (issue #61): the AI-played hero's decision log, a.mind from sim/brain.js ----
// Shown only for a hero with a brain or a non-empty log. Newest first; a row expands to the
// options, reason, scripted choice and, on request, the exact prompt the model saw. The body is
// rebuilt only when the log's entries, their outcomes or the open row change (mindSig).
const hasMind=a=>!!(a.brain||(a.mind&&a.mind.length));
const MIND_KIND={townPlan:'Town plan',fightOrFlee:'Fight or flee',say:'Says'};
let mindOpen=null; // {hid, id, prompt}
const mindSig=a=>a.id+'|'+(a.mind||[]).map(e=>e.id+':'+e.outcome+':'+(e.ms==null?'':e.ms)).join(',')+'|'+(mindOpen&&mindOpen.hid===a.id?mindOpen.id+(mindOpen.prompt?'p':''):'');
function mindRow(e){const bits=[e.t,MIND_KIND[e.kind]||e.kind];
  if(e.kind==='say')bits.push(e.trigger?'on '+e.trigger:'line');
  else if(e.choice){const over=(e.options||[]).filter(o=>o!==e.choice);bits.push('chose '+e.choice+(over.length?' (over '+over.join(', ')+')':''))}
  else bits.push(e.outcome==='pending'?'waiting':'no answer');
  const q=e.reason||e.line;if(q)bits.push('\u2018'+q+'\u2019');
  bits.push(e.ms==null?'\u2026':e.ms+' ms');
  return bits}
function mindDetail(d,a,e){const box=el('div','mdet');
  const kv=el('div','kv mkv'),add=(k,v)=>{if(v==null||v==='')return;kv.append(el('span','k',k),el('span','v',String(v)))};
  add('Options',(e.options||[]).join(' · ')||(e.kind==='say'?'free line':''));
  if(e.choice)add('Choice',e.choice+(e.kind==='townPlan'&&e.crypt!=null?' · crypt call: '+(e.crypt?'answer':'decline'):''));
  add('Reason',e.kind==='say'?null:e.reason||'none given');
  add('Line',e.line);
  if(e.scripted)add(e.outcome==='applied'?'Scripted':'Scripted acted',e.outcome==='applied'?e.scripted+' (overridden)':e.scripted);
  add('Outcome',e.outcome+(e.error?' \u2014 '+e.error:''));
  if(e.usage)add('Tokens',e.usage.in+' in / '+e.usage.out+' out');
  box.append(kv);
  const open=mindOpen&&mindOpen.prompt;
  const btn=el('button','mbtn',open?'hide prompt':'show prompt');btn.dataset.mprompt='1';box.append(btn);
  if(open){
    if(e.sent){box.append(el('div','dm','System ('+(e.sent.id||e.kind)+')'),el('pre','mpre',e.sent.system||''))}
    else box.append(el('div','dm',e.outcome==='offline'||e.ms==null?'Never reached the model ('+(e.error||e.outcome)+'). This is what the relay would have been sent:'
      :'The relay did not echo its prompt (an older relay); the user content it builds is exactly this snapshot:'));
    box.append(el('div','dm','User'),el('pre','mpre',mindUser(e)))}
  d.append(box)}
function tabMind(b,a){const m=a.mind||[];
  b.append(el('div','meta',a.brain?'Choices asked of the model, newest first. Tap a row for details.':'No longer AI-played; the last choices it made:'));
  if(!m.length){b.append(el('div','dm','No decisions yet. The hero asks at the town gate, in hard fights and when it has something to say.'));return}
  const list=el('div','mind');
  for(const e of m){const isOpen=mindOpen&&mindOpen.hid===a.id&&mindOpen.id===e.id;
    const row=el('div','mrow'+(isOpen?' open':'')),h=el('div','mh');h.dataset.mind=e.id;
    mindRow(e).forEach((t,i)=>{if(i)h.append(el('span','dm',' \u00b7 '));h.append(el('span',i===0?'dm':i===3&&(e.reason||e.line)?'mq':null,t))});
    h.append(el('span','dm',' \u00b7 '),el('span','mo mo-'+e.outcome,e.outcome));
    row.append(h);if(isOpen)mindDetail(row,a,e);list.append(row)}
  b.append(list)}
const BODY={stats:tabStats,log:tabLog,bio:tabBio,gear:tabGear,party:tabParty,chat:tabChat,mind:tabMind};

// The card skeleton (header, tab strip, body) is built once; renderHero refreshes the
// header and only the active tab's body, since it runs every 0.3s.
let skel=null;
function skeleton(root){root.replaceChildren();const hd=el('div','hd'),tabs=el('div','tabs'),tb=el('div','tb');
  for(const [k,label] of TABS){const b=el('button',null,label);b.dataset.tab=k;tabs.append(b)}
  wireGear(tb);root.append(hd,tabs,tb);skel={root,hd,tabs,tb};return skel}

export function renderHero(){const root=$('hero'),a=cam.sel;
  if(!a){root.innerHTML='<div class="meta">Tap a hero on the map, or pick one from Top heroes.</div>';skel=null;return}
  const k=skel&&skel.root===root&&root.contains(skel.hd)?skel:skeleton(root);
  const mh=maxHp(a),h=k.hd;h.replaceChildren();
  h.append(heroName(a));
  h.append(el('div','meta',`Level ${a.lvl} ${a.cls} of the ${FAC[a.fac].name} · ${a.guild?'<'+a.guild.tag+'> '+a.guild.name:'Unguilded'}`));
  h.append(el('div','doing',doing(a)));
  h.append(el('div','dm','HP'),meter('hp',a.hp/mh));
  h.append(el('div','dm','XP'),meter('xp',a.lvl>=20?1:a.xp/xpNeed(a.lvl)));
  const mindable=hasMind(a),cur=tab==='mind'&&!mindable?'stats':tab; // the Mind tab exists only for AI-played heroes
  for(const b of k.tabs.children){b.setAttribute('aria-pressed',String(b.dataset.tab===cur));if(b.dataset.tab==='mind')b.hidden=!mindable}
  if(pinned&&pinned.id!==a.id)pinned=null;
  if(cur==='mind'){const sig=mindSig(a);if(k.tb.dataset.tab!=='mind'||k.tb.dataset.sig!==sig){k.tb.replaceChildren();k.tb.dataset.tab='mind';k.tb.dataset.sig=sig;tabMind(k.tb,a)}}
  else{k.tb.replaceChildren();k.tb.dataset.tab=cur;delete k.tb.dataset.sig;BODY[cur](k.tb,a)}
  if(cur!=='gear')hideTip();else if(hov)showTip()}

// ---- other panels ----
export function renderTops(){const el_=$('tops');el_.innerHTML='';ranked().slice(0,8).forEach((a,i)=>{const li=document.createElement('li');const b=document.createElement('button');
  if(a===cam.sel)b.className='sel';const n=el('span','dm',i+1);const nm=el('span','f'+a.fac,a.name+' ');
  nm.append(el('span','dm',a.cls));const lv=el('span','lv','Lv '+a.lvl);
  b.append(n,nm,lv);b.onclick=()=>pick(a);li.append(b);el_.append(li)})}

export function renderFacs(){const el_=$('facs');const rows=[['',...FAC.map((f,i)=>`<span class="h f${i}">${f.name.toUpperCase()}</span>`)]];
  const s=f=>living().filter(a=>a.fac===f);
  rows.push(['Avg level',...[0,1].map(f=>(s(f).reduce((t,a)=>t+a.lvl,0)/Math.max(1,s(f).length)).toFixed(1))]);
  rows.push(['Fallen',...[0,1].map(f=>S.facStats[f].fallen)]);
  rows.push(['Honor',...[0,1].map(f=>S.facStats[f].honor)]);
  rows.push(['Boss kills',...[0,1].map(f=>S.facStats[f].bosses)]);
  rows.push(['Treasury',...[0,1].map(f=>s(f).reduce((t,a)=>t+a.gold,0)+'g')]);
  rows.push(['Epics',...[0,1].map(f=>s(f).reduce((t,a)=>t+a.epics.length,0))]);
  el_.innerHTML=rows.map(r=>`<div class="k">${r[0]}</div><div>${r[1]}</div><div>${r[2]}</div>`).join('')}

// Graveyard entries carry no hero id, so match the grave still in S.agents by name,
// faction and time of death; recycled graves stay plain text.
export function renderFallen(){const el_=$('fallen');if(!S.fallen.length){el_.innerHTML='<li class="dm">No one has fallen yet.</li>';return}
  el_.innerHTML='';for(const f of S.fallen){const li=document.createElement('li');li.append(el('time',null,f.t));
    const n=el('span','f'+f.fac,'† '+f.name);const a=S.agents.find(x=>x.state==='dead'&&x.name===f.name&&x.fac===f.fac&&x.diedAt===f.t);
    if(a){n.classList.add('hn');n.dataset.hid=a.id}
    li.append(n,` · Lv ${f.lvl} ${f.cls}, ${f.cause}`);el_.append(li)}}

const gScore=g=>{const m=membersOf(g);return Math.round(m.reduce((t,a)=>t+a.lvl+a.honor*3+a.kills/25,0)+g.clears*25+g.bosses*40)};
// Living guilds by score with leader and head count, then a count of the retired.
export function renderGuilds(){const live=livingGuilds().map(g=>({g,m:membersOf(g),s:gScore(g)})).sort((x,y)=>y.s-x.s);
  const ret=S.GUILDS.length-live.length;
  $('guilds').innerHTML=(live.length?live.map(({g,m,s},i)=>{const L=leaderOf(g);
    return `<tr><td><span class="dm">${i+1}</span> <span class="f${g.fac}">&lt;${g.tag}&gt; ${g.name}</span><br><span class="dm">${L?'led by '+L.name+' · ':''}${m.length} member${m.length===1?'':'s'}</span></td><td>${g.clears}/${g.clears+g.wipes}</td><td class="gd">${s}</td></tr>`}).join('')
    :'<tr><td class="dm" colspan="3">No guild has been founded yet.</td></tr>')
    +(ret?`<tr><td class="dm" colspan="3">Retired: ${ret}</td></tr>`:'')}

export function renderAH(){$('ah').innerHTML=Object.keys(GOODS).map(n=>{const p=price(n),d=p-GOODS[n].prev;
  return `<tr><td>${n}</td><td class="gd">${p}g</td><td class="${d>0?'up':d<0?'down':'dm'}">${d>0?'▲'+d:d<0?'▼'+(-d):'–'}</td></tr>`}).join('')}

export function renderClock(){$('clock').textContent=`Day ${Math.floor(S.gameMin/1440)+1} · ${clockStr()}`}

// Chronicle: render what the sim already logged, then follow new entries.
function initChronicle(){const el_=$('log');
  const add=e=>{const li=document.createElement('li');if(e.parts[0]&&e.parts[0].c==='nar')li.className='nar';li.append(el('time',null,e.t));parts(li,e.parts);
    el_.prepend(li);while(el_.children.length>90)el_.lastChild.remove()};
  for(let i=S.chronicle.length-1;i>=0;i--)add(S.chronicle[i]);
  onLog(add)}

// One delegated click handler for every panel: hero names (.hn[data-hid]) pick that hero,
// tab buttons ([data-tab]) switch the dossier tab.
function initClicks(){const host=document.querySelector('.main')||document.body;
  host.addEventListener('click',e=>{const t=e.target;if(!t||!t.closest)return;
    const ai=t.closest('[data-ai]');if(ai){const a=cam.sel;if(a){if(a.brain)disableBrain(a);else enableBrain(a);renderHero()}return}
    const mp=t.closest('[data-mprompt]');if(mp){if(mindOpen)mindOpen.prompt=!mindOpen.prompt;renderHero();return}
    const mr=t.closest('[data-mind]');if(mr){const a=cam.sel,id=Number(mr.dataset.mind);
      if(a)mindOpen=mindOpen&&mindOpen.hid===a.id&&mindOpen.id===id?null:{hid:a.id,id,prompt:false};renderHero();return}
    const tb=t.closest('[data-tab]');if(tb){setTab(tb.dataset.tab);return}
    const n=t.closest('.hn[data-hid]');if(!n)return;
    const a=S.agents.find(x=>x.id==n.dataset.hid);if(a){pick(a);if(a.state==='dead'&&n.closest('#fallen'))setTab('bio')}})}

export function initPanels(){initChronicle();initTimeline();initClicks();onMarketTick(renderAH);renderFacs();renderAH();renderGuilds();renderFallen();renderClock()}
