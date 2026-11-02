// Side panels: hero dossier (header + Stats/Log/Bio/Memory/Gear/Pack/Party/Chat/Mind tabs; Memory from ui/fellowship.js), factions,
// chronicle, graveyard, guilds, top heroes, auction house, clock. Reads sim state
// and the renderer's camera selection.
// Every hero name in the panels is a <span class="hn f0|f1" data-hid="id">; one
// delegated click handler (initPanels) looks the hero up in S.agents and hands it
// to the picker, which controls.js wires to select + follow.
import {clamp} from '../core/rng.js';
import {chatVisible,worldChatter,setWorldChatter} from '../core/chatview.js';
import {CITY,CRYPT,ZONES,zoneFor} from '../world/map.js';
import {FAC} from '../data/factions.js';
import {CLS} from '../data/classes.js';
import {TRAITS} from '../data/traits.js';
import {raceOf,homeOf} from '../data/races.js';
import {MOBS} from '../data/mobs.js';
import {GOODS,price,EPIC_ITEMS,PROPS,USES,QUEST_ITEMS,useLines} from '../data/items.js';
import {capOf,used as packUsed,isGear} from '../sim/inv.js'; // the pack (#124)
import {combatStats} from '../sim/stats.js';
import {S,clockStr,maxHp,xpNeed,onLog,onMarketTick} from '../sim/index.js';
import {cam} from '../render/draw.js';
import {weatherName} from '../sim/weather.js';
import {friendsOf} from '../sim/bonds.js';
import {biography} from './biography.js';
import {initTimeline} from './timeline.js';
import {initDmLog,showAdventure} from './dmpanel.js';
import {livingGuilds,membersOf,leaderOf} from '../sim/guilds.js';
import {enableBrain,disableBrain,brainStatus,mindUser,modelTag,mindTag} from '../sim/brain.js';
import {advLine} from '../sim/dm.js';
import {mod,score,baseScore,gearBonusOf,skillMod,skillParts,trained,ABILITIES,ABIL_IDS,SKILLS,SKILL_IDS} from '../sim/abilities.js';
import {abilityBlock} from './abilities.js'; // class abilities (issue #81)
import {tabAgent,hasAgent} from './agent-tab.js'; // agent player (issue #75)
import {agentOn,agentOff,initBridge} from './player-bridge.js';
import {tabMemory,renderBackstory,chronicleShows,setChronicleRefresh} from './fellowship.js'; // the Fellowship (#68)
import {showMindButtons} from './mindctl.js'; // with a Fellowship, AI/Agent buttons only on members unless Developer is on (#94)

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
  if(a.player&&a.playDoing&&a.state!=='dead')return a.playDoing; // agent-played (sim/player.js)
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
const TABS=[['stats','Stats'],['log','Log'],['bio','Bio'],['memory','Memory'],['gear','Gear'],['inv','Pack'],['party','Party'],['chat','Chat'],['mind','Mind'],['agent','Agent']];
const SLOTS=[['head','Head'],['chest','Chest'],['hands','Hands'],['feet','Feet'],['main','Main hand'],['off','Off hand'],['trinket','Trinket']];
let tab='stats'; // persists across hero changes
export const activeTab=()=>tab;
export function setTab(t){if(TABS.some(([k])=>k===t))tab=t;renderHero()}

// Gear score: the gear module's own number when it has merged (a.gearScore), else the
// mean item level of the seven slots, else the legacy a.gear counter.
// TODO(#20): swap in gearScore(a) from sim/gear.js once that module is on main.
const gearScoreOf=a=>typeof a.gearScore==='number'?a.gearScore:a.slots?Math.round(SLOTS.reduce((t,[k])=>t+(a.slots[k]?a.slots[k].ilvl||0:0),0)/SLOTS.length):a.gear;

// ---- Stats tab (issue #88) ----
// Six sections, top to bottom: Identity, Scores, Combat, Skills, Record, Story. The six scores are the
// only attributes; the five combat totals come from sim/stats.js with a breakdown each (hover a row for
// the breakdown as a tooltip, click it to keep it open under the row).
const sg=m=>(m>=0?'+':'')+m;
const sec=(b,t)=>b.append(el('div','sec',t));
let statOpen=null; // the combat row held open: 'health' | 'attack' | ...
export const fmtPct=v=>{const p=Math.round(v*1000)/10;return (Number.isInteger(p)?p:p.toFixed(1))+'%'};
const speedWord=s=>s>=1.12?'fast':s<=.92?'slow':'normal';
// One breakdown line's value, in the unit of its stat.
const bdVal=(k,v)=>k==='health'?sg(Math.round(v)):k==='attack'?sg(Math.round(v*10)/10):k==='speed'?(v>=1?'x'+v.toFixed(2):sg(Math.round(v*100))+'%'):(v>=0?'+':'-')+fmtPct(Math.abs(v));
// The five rows: [key, label, value text].
export function combatRows(a){const c=combatStats(a),cl=CLS[a.cls];
  return [['health','Health',`${Math.max(0,Math.round(a.hp))} / ${c.health}`],
    ['attack','Attack',`${Math.round(c.attack)} ${cl.range>2?'ranged':'melee'}`],
    ['defense','Defense',fmtPct(c.defense)],
    ['crit','Crit',fmtPct(c.crit)],
    ['speed','Speed',`${c.aps.toFixed(2)}/s ${speedWord(c.speed)}`]]}
export const breakdownText=(a,k)=>{const l=combatStats(a).bd[k];return l.length?l.map(p=>p.label+' '+bdVal(k,p.value)):['no armor, no training']};

function identity(b,a){sec(b,'Identity');const kv=el('div','kv');
  const row=(k,v)=>{kv.append(el('span','k',k));const s=el('span','v');if(typeof v==='string')s.textContent=v;else s.append(v);kv.append(s)};
  row('Level',String(a.lvl));row('Class',a.cls);
  if(a.race){const s=el('span','gd',raceOf(a).name);s.title=raceOf(a).culture;const w=el('span');w.append(s,' of '+homeOf(a).name);row('People',w)}
  row('Faction',FAC[a.fac].name);row('Guild',a.guild?`<${a.guild.tag}> ${a.guild.name}`:'Unguilded');b.append(kv);
  const need=xpNeed(a.lvl),xp=el('div','xprow');
  if(a.lvl>=20)xp.append(el('span','dm','Max level'));
  else{xp.append(meter('xp xpb',Math.max(0,a.xp)/need),el('span','dm',`${Math.round(a.xp)} / ${need} xp to level ${a.lvl+1}`))}
  b.append(xp)}

function scoresRow(b,a){sec(b,'Scores');const g=el('div','scores');
  for(const k of ABIL_IDS){const A=ABILITIES[k],m=mod(a,k),gb=gearBonusOf(a,k),c=el('span','sc'+(m>=2?' hi':m<0?' lo':''));
    c.title=`${A.name}: ${A.desc} Base ${baseScore(a,k)}${gb?', '+sg(gb)+' from gear':''}, modifier ${sg(m)}.`;
    c.append(el('span','an',A.short),' ',el('span','as',String(score(a,k))));if(gb)c.append(' ',el('span','ab',`(${sg(gb)})`));c.append(' ',el('span','am',sg(m)));g.append(c)}
  b.append(g)}

function combatBlock(b,a){sec(b,'Combat');const g=el('div','cstats');
  for(const [k,label,v] of combatRows(a)){const open=statOpen===k,r=el('div','cs'+(open?' open':''));r.dataset.cstat=k;
    r.title=breakdownText(a,k).join('\n');r.append(el('span','k',label),el('span','v',v),el('span','dm caret',open?'-':'+'));g.append(r);
    if(open){const ul=el('ul','bd');for(const t of breakdownText(a,k))ul.append(el('li',null,t));g.append(ul)}}
  b.append(g)}

function skillsGrid(b,a){if(!a.abil)return;sec(b,'Skills');const g=el('div','skgrid');
  SKILL_IDS.slice().sort((x,y)=>skillMod(a,y)-skillMod(a,x)).forEach(k=>{const t=trained(a,k),m=skillMod(a,k),s=el('span','sk'+(t?' tr':''));
    s.title=SKILLS[k].desc+' ('+skillParts(a,k).map(p=>p.k+' '+sg(p.v)).join(', ')+')'+(t?' Trained.':'');
    s.append(el('span','sn',(t?'* ':'')+SKILLS[k].name),el('span','sv',sg(m)));g.append(s)});
  b.append(g,el('div','dm skey','* trained'))}

function record_(b,a){sec(b,'Record');const kv=el('div','kv');
  const rows=[['Gold',a.gold+'g'],['Honor',a.honor],['Kills',a.kills],['Elite kills',a.eliteKills||0]];if(a.avenged!=null)rows.push(['Avenged',a.avenged]);
  for(const [k,v] of rows)kv.append(el('span','k',k),el('span','v',String(v)));b.append(kv)}

function story(b,a){sec(b,'Story');
  const tr=el('div','meta');tr.append('Traits: ');const ts=a.traits||[];if(!ts.length)tr.append('none');
  ts.forEach((t,i)=>{const s=el('span','gd',t);if(TRAITS[t])s.title=TRAITS[t].desc;tr.append(s);if(i<ts.length-1)tr.append(', ')});b.append(tr);
  if(a.origin)b.append(el('div','meta',a.origin));
  if(a.goal){const g=el('div','goal');g.append(el('div',a.goal.done?'gd':'',(a.goal.done?'Done: ':'Goal: ')+a.goal.text));
    if(a.goal.need){g.append(meter('gl',a.goal.done?1:(a.goal.progress||0)/a.goal.need));g.append(el('div','dm',`${a.goal.done?a.goal.need:a.goal.progress||0} / ${a.goal.need}`))}b.append(g)}
  {const fr=friendsOf(a).slice(0,6);if(fr.length){const d=el('div','meta');d.append('Friends: ');fr.forEach((f,i)=>{d.append(hn(f));if(i<fr.length-1)d.append(', ')});b.append(d)}}
  const nem=Object.entries(a.nemesis||{}).filter(([id])=>S.agents.some(x=>x.id==id&&x.state!=='dead')).pop();
  if(nem){const foe=S.agents.find(x=>x.id==nem[0]);const d=el('div','meta');d.append('Nemesis: ',hn(foe),` (killed guildmate ${nem[1]})`);b.append(d)}
  const q=a.quest?`${MOBS[a.quest.type].q}: ${a.quest.have}/${a.quest.need} ${MOBS[a.quest.type].pl}`:'No quest';
  b.append(el('div','meta','Quest: '+q));
  {const ad=advLine(a);if(ad){const d=el('div','meta adv');d.dataset.adv=a.adv;d.title='Open this adventure in the Dungeon Master log';parts(d,ad);b.append(d)}} // the DM's adventure and scene (sim/dm.js)
  b.append(el('div','meta',`Weather: ${weatherName(a.zone)} in ${ZONES[a.zone]}`))}

function tabStats(b,a){identity(b,a);if(a.abil)scoresRow(b,a);combatBlock(b,a);abilityBlock(b,a);skillsGrid(b,a);record_(b,a);story(b,a)}

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
// Item lines in the Stats tab's vocabulary: "+12 armor", "+5 damage", "+2 Brawn", "swift (+8% attack speed)".
export function itemLines(it){const out=[];if(!it)return out;
  if(it.armor)out.push(['ar','+'+it.armor+' armor']);if(it.damage)out.push(['dg','+'+it.damage+' damage']);
  for(const k of ABIL_IDS)if(it.bonus&&it.bonus[k])out.push(['bn',sg(it.bonus[k])+' '+ABILITIES[k].name]);
  if(it.property&&PROPS[it.property])out.push(['pr',it.property+' ('+PROPS[it.property].desc+')']);
  return out}
// What changed against the replaced piece: "+3 armor, +1 Grit, -swift".
function itemDelta(it,o){const ds=[],d=(n,lbl)=>{if(n)ds.push(sg(n)+' '+lbl)};
  d((it.armor||0)-(o.armor||0),'armor');d((it.damage||0)-(o.damage||0),'damage');
  for(const k of ABIL_IDS)d(((it.bonus||{})[k]||0)-((o.bonus||{})[k]||0),ABILITIES[k].name);
  if(it.property!==o.property){if(it.property)ds.push(it.property);if(o.property)ds.push('-'+o.property)}
  return ds}
function itemCard(it,cls){const d=el('div',cls||'itip');
  d.append(el('div','in '+qCls(it),it.name));
  d.append(el('div','dm',`${qLabel(it)} · ilvl ${it.ilvl} ${slotLabel(it.slot)}`));
  for(const [c,t] of itemLines(it))d.append(el('div','is s-'+c,t));
  for(const f of it.affixes||[])d.append(el('div','ia',f));
  const z=zoneIdx(it.zone);if(z>=0)d.append(el('div','dm','Found in '+ZONES[z]));
  if(it.src)d.append(el('div','dm',it.src));
  if(it.epic&&EPIC_ITEMS[it.name])d.append(el('div','if',EPIC_ITEMS[it.name].flavour));
  if(it.over){const o=it.over,ds=itemDelta(it,o);
    d.append(el('div','dm','Replaced '+o.name+' (ilvl '+o.ilvl+')'+(ds.length?': '+ds.join(', '):'')))}
  return d}
// Pack entries (issue #124): consumables, quest items and trade goods get a card in the same style as gear.
const invEntry=(a,i)=>a&&a.inv?a.inv.list[i]||null:null;
function supplyCard(e,cls){const d=el('div',cls||'itip');
  if(e.kind==='use'&&USES[e.id]){const U=USES[e.id];d.append(el('div','in qf',e.id),el('div','dm',U.kind.charAt(0).toUpperCase()+U.kind.slice(1)+' · x'+e.n));
    for(const [c,t] of useLines(e.id))d.append(el('div','is s-'+c,t));d.append(el('div','dm','Costs '+U.price+'g in town'),el('div','if',U.flavour))}
  else if(e.kind==='good'){d.append(el('div','in qp',e.id),el('div','dm','Trade good · x'+e.n));if(GOODS[e.id])d.append(el('div','is s-bn','Sells for about '+price(e.id)+'g each'))}
  else{const Q=QUEST_ITEMS[e.id];d.append(el('div','in gd',e.id),el('div','dm','Quest item'));
    d.append(el('div','if',Q?Q.flavour:'Carried for a job; it is handed in when the job ends.'),el('div','dm','Cannot be sold, dropped or given.'))}
  return d}
const cardOf=(it,cls)=>isGear(it)?itemCard(it,cls):supplyCard(it,cls);
const hoverItem=()=>{const a=cam.sel;if(!hov||!a||a.id!==hov.id)return null;return hov.inv!=null?invEntry(a,hov.inv):a.slots?a.slots[hov.slot]:null};
function placeTip(){if(!tipEl)return;const pad=14,w=tipEl.offsetWidth,h=tipEl.offsetHeight,vw=window.innerWidth,vh=window.innerHeight;
  let x=tipXY[0]+pad,y=tipXY[1]+pad;if(x+w>vw-4)x=Math.max(4,tipXY[0]-w-pad);if(y+h>vh-4)y=Math.max(4,vh-h-4);
  tipEl.style.left=x+'px';tipEl.style.top=y+'px'}
function showTip(){const it=hoverItem();if(!it){hideTip();return}
  if(!tipEl){tipEl=el('div','itip floating');tipEl.setAttribute('role','tooltip');document.body.append(tipEl)}
  tipEl.replaceChildren(...cardOf(it).childNodes);tipEl.style.display='block';placeTip()}
function hideTip(){hov=null;if(tipEl)tipEl.style.display='none'}
// Delegated listeners on the persistent tab body: rows are rebuilt, the listeners are not.
function wireGear(tb){
  const keyOf=e=>{const r=e.target&&e.target.closest?e.target.closest('[data-slot],[data-inv]'):null;return r?(r.dataset.inv!=null?{inv:+r.dataset.inv}:{slot:r.dataset.slot}):null};
  const same=(h,k,a)=>!!(h&&k&&h.id===a.id&&h.slot===k.slot&&h.inv===k.inv);
  tb.addEventListener('pointermove',e=>{if(e.pointerType&&e.pointerType!=='mouse')return;tipXY=[e.clientX,e.clientY];const k=keyOf(e),a=cam.sel;
    if(!k||!a){if(hov)hideTip();return}
    if(!same(hov,k,a)){hov={id:a.id,...k};showTip()}else placeTip()});
  tb.addEventListener('pointerleave',hideTip);
  tb.addEventListener('click',e=>{const k=keyOf(e),a=cam.sel;if(!k||!a)return;
    if(k.inv!=null?!invEntry(a,k.inv):!(a.slots&&a.slots[k.slot]))return;
    pinned=same(pinned,k,a)?null:{id:a.id,...k};hideTip();renderHero()})}

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

// ---- Pack tab (issue #124): consumables, quest items, spare gear and trade goods; hover or tap for a card ----
function tabInv(b,a){
  if(pinned&&pinned.id!==a.id)pinned=null;
  if(!a.inv||!a.inv.list.length){b.append(el('div','meta','Pack 0/'+(a.inv?capOf(a):'?')+' slots · '+a.gold+'g'),el('div','dm','Nothing carried.'));return}
  b.append(el('div','meta','Pack '+packUsed(a)+'/'+capOf(a)+' slots · '+a.gold+'g · hover or tap an item'));
  const groups=[['Potions and supplies',e=>e.kind==='use'],['Quest items',e=>e.kind==='quest'],['Spare gear',isGear],['Trade goods',e=>e.kind==='good']];
  for(const [title,f] of groups){const rows=a.inv.list.map((e,i)=>[e,i]).filter(([e])=>f(e));if(!rows.length)continue;
    b.append(el('div','dm',title));const g=el('div','gear');
    for(const [e,i] of rows){const sel=pinned&&pinned.inv===i,gear=isGear(e);
      const kk=el('span','k',gear?slotLabel(e.slot):'x'+e.n),v=el('span','v');kk.dataset.inv=String(i);v.dataset.inv=String(i);if(sel){kk.classList.add('pin');v.classList.add('pin')}
      if(gear){v.append(el('span',qCls(e),e.name),' ',el('span','ilv','ilvl '+e.ilvl));if(e.cls&&e.cls!==a.cls&&!e.epic)v.append(' ',el('span','dm','for '+e.cls))}
      else v.append(el('span',e.kind==='quest'?'gd':e.kind==='use'?'qf':'qp',e.id));
      g.append(kk,v)}
    b.append(g)}
  const pe=pinned&&pinned.inv!=null?invEntry(a,pinned.inv):null;if(pe)b.append(cardOf(pe,'itip pinned'))}

function tabParty(b,a){const p=a.party;
  if(!p||!p.mem.length){b.append(el('div','dm','Travelling alone.'));return}
  const g=el('div','party');
  for(const m of p.mem){const row=el('div','pm'+(m===p.leader?' lead':''));const nm=el('div','pn');
    if(m===p.leader)nm.append(el('span','gd crown','★ '));nm.append(hn(m),el('span','dm',` Lv ${m.lvl} ${m.cls}`));
    row.append(nm,meter('hp',m.hp/maxHp(m)));g.append(row)}
  b.append(g,el('div','meta',`★ leader · bound for ${ZONES[p.zone]}${p.home?' · heading home':''}`))}

function tabChat(b,a){const all=(a.chat||[]).slice(-20).reverse(),c=all.filter(e=>chatVisible(e,S));
  if(S.fellowship){const on=worldChatter(),t=el('button','mini','World chatter: '+(on?'on':'off'));t.title='Show what background heroes say to each other (kept per viewer).';
    t.onclick=()=>{setWorldChatter(!on);renderHero()};b.append(t)}
  if(!c.length){b.append(el('div','dm',all.length?'Only background chatter so far. Turn World chatter on to see it.':'Nothing said or heard yet.'));return}
  const ul=el('ul','log chat');for(const e of c){const li=el('li');li.append(el('time',null,e.t));if(e.party)li.append(el('span','gd','[Party] '));if(e.from&&e.from.kind==='dm')li.append(el('span','gd','[Narrator]'));else li.append(hn(e.from));if(e.ai)li.append(' ',aiBadge('AI',e.model?'Written by '+e.model:null));li.append(': '+e.text);if(e.model)li.append(' ',el('span','mmodel',e.model));ul.append(li)}b.append(ul)}

// ---- AI-played marking (sim/brain.js): toggle button next to the name, badge on the card and on model-written chat lines ----
const aiBadge=(t,title)=>{const s=el('span','ai-badge',t);if(title)s.title=title;return s};
function heroName(a){const d=el('div','nm f'+a.fac,a.name),st=brainStatus(a);
  if(st!=='off'&&!a.player)d.append(' ',aiBadge('AI-played'+(st==='offline'?' (quiet)':''),'This hero\'s choices come from a language model via the local relay; the scripted rules take over whenever it is silent.'));
  if(!showMindButtons(a)){if(a.player)d.append(' ',aiBadge('Agent','An AI agent plays this hero through the relay.'));return d}
  const b=el('button','ai-toggle',st==='off'?'AI':'AI off');b.dataset.ai='1';b.title=st==='off'?'Let a language model play this hero (needs npm run relay)':'Return this hero to the scripted rules';d.append(' ',b);
  // Agent player (issue #75): an AI agent with its own session plays this hero through MCP tools.
  if(a.player)d.append(' ',aiBadge('Agent','An AI agent plays this hero through the relay (npm run agent); reflexes keep it alive while the agent is silent.'));
  if(a.state!=='dead'){const g=el('button','ai-toggle',a.player?'Agent off':'Agent');g.dataset.agent='1';g.title=a.player?'Return this hero to the scripted rules':'Let an AI agent play this hero (npm run relay, then npm run agent)';d.append(' ',g)}
  return d}
function tabBio(b,a){if(a.backstory){renderBackstory(b,a);b.append(el('div','dm','The record'))} // a Fellowship member's backstory first (#68)
  for(const p of biography(a,S.agents)){const d=el('p','bio');parts(d,p);b.append(d)}}

// ---- Mind tab (issue #61): the AI-played hero's decision log, a.mind from sim/brain.js ----
// Shown only for a hero with a brain or a non-empty log. Newest first; a row expands to the
// options, reason, scripted choice and, on request, the exact prompt the model saw. The body is
// rebuilt only when the log's entries, their outcomes or the open row change (mindSig).
const hasMind=a=>!!(a.brain||(a.mind&&a.mind.length));
const MIND_KIND={townPlan:'Town plan',cryptCall:'Crypt call',follow:'Follows',fightOrFlee:'Fight or flee',say:'Says'};
let mindOpen=null; // {hid, id, prompt}
const mindSig=a=>a.id+'|'+(a.mind||[]).map(e=>e.id+':'+e.outcome+':'+(e.ms==null?'':e.ms)).join(',')+'|'+(mindOpen&&mindOpen.hid===a.id?mindOpen.id+(mindOpen.prompt?'p':''):'');
function mindRow(e){const bits=[e.t,MIND_KIND[e.kind]||e.kind];
  if(e.kind==='say')bits.push(e.trigger?'on '+e.trigger:'line');
  else if(e.kind==='follow')bits.push(e.leader?e.leader+' leads':'party');
  else if(e.choice){const over=(e.options||[]).filter(o=>o!==e.choice);bits.push('chose '+e.choice+(over.length?' (over '+over.join(', ')+')':''))}
  else bits.push(e.outcome==='pending'?'waiting':'no answer');
  const q=e.reason||e.line;if(q)bits.push('\u2018'+q+'\u2019');
  bits.push(e.kind==='follow'?'no call':e.ms==null?'\u2026':e.ms+' ms');
  const mt=modelTag(e);if(mt&&e.kind!=='follow')bits.push(mt); // Mixed minds (#97): which model answered
  return bits}
function mindDetail(d,a,e){const box=el('div','mdet');
  const kv=el('div','kv mkv'),add=(k,v)=>{if(v==null||v==='')return;kv.append(el('span','k',k),el('span','v',String(v)))};
  add('Options',(e.options||[]).join(' · ')||(e.kind==='say'?'free line':''));
  if(e.choice)add(e.kind==='follow'?'Zone':'Choice',e.choice+(e.kind==='townPlan'&&e.crypt!=null?' · crypt call: '+(e.crypt?'answer':'decline'):''));
  add('Reason',e.kind==='say'?null:e.reason||'none given');
  add('Line',e.line);
  if(e.scripted)add(e.outcome==='applied'?'Scripted':'Scripted acted',e.outcome==='applied'?e.scripted+' (overridden)':e.scripted);
  add('Outcome',e.outcome+(e.error?' \u2014 '+e.error:''));
  add('Model',modelTag(e));
  if(e.usage)add('Tokens',e.usage.in+' in / '+e.usage.out+' out'+(e.usage.cost!=null?' · $'+(+e.usage.cost).toFixed(6):''));
  box.append(kv);
  const open=mindOpen&&mindOpen.prompt;
  if(!e.snapshot){d.append(box);return} // a note (follow): nothing was sent
  const btn=el('button','mbtn',open?'hide prompt':'show prompt');btn.dataset.mprompt='1';box.append(btn);
  if(open){
    if(e.sent){box.append(el('div','dm','System ('+(e.sent.id||e.kind)+')'),el('pre','mpre',e.sent.system||''))}
    else box.append(el('div','dm',e.outcome==='offline'||e.ms==null?'Never reached the model ('+(e.error||e.outcome)+'). This is what the relay would have been sent:'
      :'The relay did not echo its prompt (an older relay); the user content it builds is exactly this snapshot:'));
    box.append(el('div','dm','User'),el('pre','mpre',mindUser(e)))}
  d.append(box)}
function tabMind(b,a){const m=a.mind||[];
  b.append(el('div','meta',a.brain?'Choices asked of the model ('+mindTag(a)+'), newest first. Tap a row for details.':'No longer AI-played; the last choices it made:'));
  if(!m.length){b.append(el('div','dm','No decisions yet. The hero asks at the town gate, in hard fights and when it has something to say.'));return}
  const list=el('div','mind');
  for(const e of m){const isOpen=mindOpen&&mindOpen.hid===a.id&&mindOpen.id===e.id;
    const row=el('div','mrow'+(isOpen?' open':'')),h=el('div','mh');h.dataset.mind=e.id;
    mindRow(e).forEach((t,i)=>{if(i)h.append(el('span','dm',' \u00b7 '));h.append(el('span',i===0?'dm':i===3&&(e.reason||e.line)?'mq':null,t))});
    h.append(el('span','dm',' \u00b7 '),el('span','mo mo-'+e.outcome,e.outcome));
    row.append(h);if(isOpen)mindDetail(row,a,e);list.append(row)}
  b.append(list)}
const BODY={stats:tabStats,log:tabLog,bio:tabBio,gear:tabGear,inv:tabInv,party:tabParty,chat:tabChat,mind:tabMind,agent:tabAgent,memory:tabMemory};

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
  const mindable=hasMind(a),agentable=hasAgent(a),memable=!!a.memory,cur=tab==='mind'&&!mindable||tab==='agent'&&!agentable||tab==='memory'&&!memable?'stats':tab; // the Mind tab exists only for AI-played heroes, the Agent tab for agent-played ones
  for(const b of k.tabs.children){b.setAttribute('aria-pressed',String(b.dataset.tab===cur));if(b.dataset.tab==='mind')b.hidden=!mindable;if(b.dataset.tab==='agent')b.hidden=!agentable;if(b.dataset.tab==='memory')b.hidden=!memable}
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
  const add=e=>{if(!chronicleShows(e))return;const li=document.createElement('li');if(e.parts[0]&&e.parts[0].c==='nar')li.className='nar';li.append(el('time',null,e.t));parts(li,e.parts);
    el_.prepend(li);while(el_.children.length>90)el_.lastChild.remove()};
  const all=()=>{el_.replaceChildren();for(let i=S.chronicle.length-1;i>=0;i--)add(S.chronicle[i])};all();
  setChronicleRefresh(all); // the Fellowship only filter toggles re-render from S.chronicle
  onLog(add)}

// One delegated click handler for every panel: hero names (.hn[data-hid]) pick that hero,
// tab buttons ([data-tab]) switch the dossier tab.
function initClicks(){const host=document.querySelector('.main')||document.body;
  host.addEventListener('click',e=>{const t=e.target;if(!t||!t.closest)return;
    const ag=t.closest('[data-agent]');if(ag){const a=cam.sel;if(a){if(a.player)agentOff(a);else if(agentOn(a))tab='agent';renderHero()}return}
    const ai=t.closest('[data-ai]');if(ai){const a=cam.sel;if(a){if(a.brain)disableBrain(a);else enableBrain(a);renderHero()}return}
    const mp=t.closest('[data-mprompt]');if(mp){if(mindOpen)mindOpen.prompt=!mindOpen.prompt;renderHero();return}
    const mr=t.closest('[data-mind]');if(mr){const a=cam.sel,id=Number(mr.dataset.mind);
      if(a)mindOpen=mindOpen&&mindOpen.hid===a.id&&mindOpen.id===id?null:{hid:a.id,id,prompt:false};renderHero();return}
    const dv=t.closest('[data-adv]');if(dv&&!t.closest('.hn[data-hid]')){showAdventure(dv.dataset.adv);return}
    const cs=t.closest('[data-cstat]');if(cs){statOpen=statOpen===cs.dataset.cstat?null:cs.dataset.cstat;renderHero();return}
    const tb=t.closest('[data-tab]');if(tb){setTab(tb.dataset.tab);return}
    const n=t.closest('.hn[data-hid]');if(!n)return;
    const a=S.agents.find(x=>x.id==n.dataset.hid);if(a){pick(a);if(a.state==='dead'&&n.closest('#fallen'))setTab('bio')}})}

export function initPanels(){initBridge();initChronicle();initTimeline();initDmLog();initClicks();onMarketTick(renderAH);renderFacs();renderAH();renderGuilds();renderFallen();renderClock()}
