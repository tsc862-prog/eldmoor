// Side panels: hero dossier (header + Stats/Log/Gear/Party/Chat tabs), factions,
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
import {GOODS,price} from '../data/items.js';
import {S,clockStr,maxHp,xpNeed,atkOf,onLog,onMarketTick} from '../sim/index.js';
import {cam} from '../render/draw.js';
import {weatherName} from '../sim/weather.js';
import {friendsOf} from '../sim/bonds.js';

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
export function doing(a){const c=CITY[a.fac].name,zn=ZONES[a.zone];
  switch(a.state){
    case 'town':return a.townStep===0?`Selling loot at the ${c} auction house`:a.townStep===1?`Checking in with the ${c} quest giver`:`Leaving ${c} for ${ZONES[zoneFor(a.lvl)]}`;
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
const TABS=[['stats','Stats'],['log','Log'],['gear','Gear'],['party','Party'],['chat','Chat']];
const SLOTS=[['head','Head'],['chest','Chest'],['hands','Hands'],['feet','Feet'],['main','Main hand'],['off','Off hand'],['trinket','Trinket']];
let tab='stats'; // persists across hero changes
export const activeTab=()=>tab;
export function setTab(t){if(TABS.some(([k])=>k===t))tab=t;renderHero()}

// Gear score: the gear module's own number when it has merged (a.gearScore), else the
// mean item level of the seven slots, else the legacy a.gear counter.
// TODO(#20): swap in gearScore(a) from sim/gear.js once that module is on main.
const gearScoreOf=a=>typeof a.gearScore==='number'?a.gearScore:a.slots?Math.round(SLOTS.reduce((t,[k])=>t+(a.slots[k]?a.slots[k].ilvl||0:0),0)/SLOTS.length):a.gear;

function tabStats(b,a){const c=CLS[a.cls],mh=maxHp(a);
  const rows=[['Level',a.lvl],['Class',a.cls],['Faction',FAC[a.fac].name],['Guild',`<${a.guild.tag}> ${a.guild.name}`],
    ['HP',`${Math.max(0,Math.round(a.hp))} / ${mh}`],['Attack',Math.round(atkOf(a))],['Armour',Math.round((1-(c.arm||1))*100)+'%'],
    ['Crit',Math.round((c.crit||.08)*100)+'%'],['Range',c.range>2?`${c.range} (ranged)`:`${c.range} (melee)`],
    ['XP to next',a.lvl>=20?'Max level':`${Math.max(0,xpNeed(a.lvl)-Math.round(a.xp))} xp`],
    ['Gold',a.gold+'g'],['Kills',a.kills],['Honor',a.honor],['Elite kills',a.eliteKills||0]];
  if(a.avenged!=null)rows.push(['Avenged',a.avenged]);
  const kv=el('div','kv');for(const [k,v] of rows)kv.append(el('span','k',k),el('span','v',String(v)));b.append(kv);
  const tr=el('div','meta');tr.append('Traits: ');const ts=a.traits||[];if(!ts.length)tr.append('none');
  ts.forEach((t,i)=>{const s=el('span','gd',t);if(TRAITS[t])s.title=TRAITS[t].desc;tr.append(s);if(i<ts.length-1)tr.append(', ')});b.append(tr);
  if(a.race){const rc=el('div','meta');rc.append('People: ');const rs=el('span','gd',raceOf(a).name);rs.title=raceOf(a).culture;rc.append(rs,' of '+homeOf(a).name);b.append(rc)}
  if(a.origin)b.append(el('div','meta',a.origin));
  if(a.goal){const g=el('div','goal');g.append(el('div',a.goal.done?'gd':'',(a.goal.done?'Done: ':'Goal: ')+a.goal.text));
    if(a.goal.need){g.append(meter('gl',a.goal.done?1:(a.goal.progress||0)/a.goal.need));g.append(el('div','dm',`${a.goal.done?a.goal.need:a.goal.progress||0} / ${a.goal.need}`))}b.append(g)}
  const q=a.quest?`${MOBS[a.quest.type].q}: ${a.quest.have}/${a.quest.need} ${MOBS[a.quest.type].pl}`:'No quest';
  b.append(el('div','meta','Quest: '+q));
  const nem=Object.entries(a.nemesis||{}).filter(([id])=>S.agents.some(x=>x.id==id&&x.state!=='dead')).pop();
  if(nem){const foe=S.agents.find(x=>x.id==nem[0]);const d=el('div','meta');d.append('Nemesis: ',hn(foe),` (killed guildmate ${nem[1]})`);b.append(d)}
  {const fr=friendsOf(a).slice(0,6);if(fr.length){const d=el('div','meta');d.append('Friends: ');fr.forEach((f,i)=>{d.append(hn(f));if(i<fr.length-1)d.append(', ')});b.append(d)}}
  b.append(el('div','meta',`Weather: ${weatherName(a.zone)} in ${ZONES[a.zone]}`))}

function tabLog(b,a){const h=(a.history||[]).slice().reverse();
  if(!h.length){b.append(el('div','dm','Nothing worth recording yet.'));return}
  const ul=el('ul','log hist');for(const e of h){const li=el('li');li.append(el('time',null,e.t));parts(li,e.parts||[e.text]);ul.append(li)}b.append(ul)}

function tabGear(b,a){
  if(a.slots){const g=el('div','gear');
    for(const [k,label] of SLOTS){const it=a.slots[k];g.append(el('span','k',label));const v=el('span','v');
      if(!it)v.append(el('span','dm','Empty'));
      else{v.append(el('span',it.epic?'ep':'',it.name),' ',el('span','ilv','ilvl '+it.ilvl));
        const z=zoneIdx(it.zone);if(z>=0)v.append(' ',el('span','ztag z'+z,ZONES[z]));else if(it.zone)v.append(' ',el('span','ztag',String(it.zone)))}
      g.append(v)}
    b.append(g,el('div','meta','Gear score '+gearScoreOf(a)));return}
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
  const ul=el('ul','log chat');for(const e of c){const li=el('li');li.append(el('time',null,e.t),hn(e.from),': '+e.text);ul.append(li)}b.append(ul)}

const BODY={stats:tabStats,log:tabLog,gear:tabGear,party:tabParty,chat:tabChat};

// The card skeleton (header, tab strip, body) is built once; renderHero refreshes the
// header and only the active tab's body, since it runs every 0.3s.
let skel=null;
function skeleton(root){root.replaceChildren();const hd=el('div','hd'),tabs=el('div','tabs'),tb=el('div','tb');
  for(const [k,label] of TABS){const b=el('button',null,label);b.dataset.tab=k;tabs.append(b)}
  root.append(hd,tabs,tb);skel={root,hd,tabs,tb};return skel}

export function renderHero(){const root=$('hero'),a=cam.sel;
  if(!a){root.innerHTML='<div class="meta">Tap a hero on the map, or pick one from Top heroes.</div>';skel=null;return}
  const k=skel&&skel.root===root&&root.contains(skel.hd)?skel:skeleton(root);
  const mh=maxHp(a),h=k.hd;h.replaceChildren();
  h.append(el('div','nm f'+a.fac,a.name));
  h.append(el('div','meta',`Level ${a.lvl} ${a.cls} of the ${FAC[a.fac].name} · <${a.guild.tag}> ${a.guild.name}`));
  h.append(el('div','doing',doing(a)));
  h.append(el('div','dm','HP'),meter('hp',a.hp/mh));
  h.append(el('div','dm','XP'),meter('xp',a.lvl>=20?1:a.xp/xpNeed(a.lvl)));
  for(const b of k.tabs.children)b.setAttribute('aria-pressed',String(b.dataset.tab===tab));
  k.tb.replaceChildren();k.tb.dataset.tab=tab;BODY[tab](k.tb,a)}

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

const gScore=g=>{const m=living().filter(a=>a.guild===g);return Math.round(m.reduce((t,a)=>t+a.lvl+a.honor*3+a.kills/25,0)+g.clears*25+g.bosses*40)};
export function renderGuilds(){$('guilds').innerHTML=S.GUILDS.slice().sort((x,y)=>gScore(y)-gScore(x)).map((g,i)=>
  `<tr><td><span class="dm">${i+1}</span> <span class="f${g.fac}">&lt;${g.tag}&gt; ${g.name}</span></td><td>${g.clears}/${g.clears+g.wipes}</td><td class="gd">${gScore(g)}</td></tr>`).join('')}

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
    const tb=t.closest('[data-tab]');if(tb){setTab(tb.dataset.tab);return}
    const n=t.closest('.hn[data-hid]');if(!n)return;
    const a=S.agents.find(x=>x.id==n.dataset.hid);if(a)pick(a)})}

export function initPanels(){initChronicle();initClicks();onMarketTick(renderAH);renderFacs();renderAH();renderGuilds();renderFallen();renderClock()}
