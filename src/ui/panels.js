// Side panels: hero dossier (header + Stats/Log/Bio/Memory/Gear/Pack/Party/Chat/Mind tabs; Memory from ui/fellowship.js), factions,
// chronicle, graveyard, guilds, top heroes, auction house, clock. Reads sim state
// and the renderer's camera selection.
// Every hero name in the panels is a <span class="hn f0|f1" data-hid="id">; one
// delegated click handler (initPanels) looks the hero up in S.agents and hands it
// to the picker, which controls.js wires to select + follow.
import {worldFill} from '../world/words.js';
import {outpostCounts} from '../sim/outposts.js';
import {clamp} from '../core/rng.js';
import {chatVisible,worldChatter,setWorldChatter} from '../core/chatview.js';
import {CITY,CRYPT,LAIR,ZONES,OUTPOSTS,zoneFor} from '../world/map.js';
import {cryptOfHero,heroCryptName} from '../sim/crypts.js';
import {FAC} from '../data/factions.js';
import {CLS} from '../data/classes.js';
import {TRAITS} from '../data/traits.js';
import {raceOf,homeOf} from '../data/races.js';
import {MOBS} from '../data/mobs.js';
import {GOODS,MATERIALS,price,EPIC_ITEMS,PROPS,USES,QUEST_ITEMS,useLines} from '../data/items.js';
import {capOf,used as packUsed,isGear} from '../sim/inv.js'; // the pack (#124)
import {combatStats} from '../sim/stats.js';
import {gearScore} from '../sim/gear.js';
import {S,clockStr,maxHp,xpNeed,onLog,onMarketTick} from '../sim/index.js';
import {cam} from '../render/draw.js';
import {weatherName} from '../sim/weather.js';
import {friendsOf} from '../sim/bonds.js';
import {biography} from './biography.js';
import {initTimeline} from './timeline.js';
import {initDmLog,showAdventure} from './dmpanel.js';
import {livingGuilds,membersOf,leaderOf} from '../sim/guilds.js';
import {rivalsOf} from '../sim/rivals.js';
import {guildFocus,FOCUS_NAME} from '../sim/guildfocus.js';
import {enableBrain,disableBrain,brainStatus,mindUser,modelTag,mindTag} from '../sim/brain.js';
import {advLine} from '../sim/dm.js';
import {mod,score,baseScore,gearBonusOf,skillMod,skillParts,trained,ABILITIES,ABIL_IDS,SKILLS,SKILL_IDS} from '../sim/abilities.js';
import {abilityBlock} from './abilities.js'; // class abilities (issue #81)
import {professionBlock} from './professions.js'; // professions (issue #259)
import {tabAgent,hasAgent,gambitSummary} from './agent-tab.js'; // agent player (issue #75)
import {mindLabel,chatTag} from './mindlabel.js'; // the one mind label (issue #136)
import {byDay,stampOf,srcTag,dayOf,daySep} from './daystamp.js'; // game day on times, action sources (issue #136)
import {toneOf,DISP} from '../core/colors.js'; // class and disposition colours (one palette)
import {agentOn,agentOff,initBridge} from './player-bridge.js';
import {inRegion} from './region.js'; // region view (#430): the lists narrow to the picked region
import {tabMemory,renderBackstory,chronicleShows,setChronicleRefresh} from './fellowship.js'; // the Fellowship (#68)
import {showMindButtons,devMode} from './mindctl.js';
import {tabQuests} from './quests.js'; // the Quests tab
import {tabCombat} from './combat.js'; // the Combat tab
import {setPurpose,isOpen} from './purposeview.js'; // the purpose line in the header (#534)
import {companyOf,inSlots,slotted} from '../sim/company.js'; // the dock's short card is for heroes outside every company (#546)
import {patch,keepView,keyOf,initStable} from './stable.js'; // update in place, keep scroll (#145) // with a Fellowship, AI/Agent buttons only on members unless Developer is on (#94)
import {styled} from '../sim/epithet.js'; // a name given for a deed (bestow, #638)
import {downView,downText,downTitle,flashOf,pips,downKind,DOWN_BADGE} from './downview.js'; // the downed (#659)
import {siteById} from '../sim/sites.js'; // a DM-made site's record, for the activity line (#917)
import {threadText} from '../sim/oath.js'; // an unsworn thread, in words (#800)

const $=id=>document.getElementById(id);
let pick=()=>{};
// The controls module installs the handler used when a hero is clicked in a list.
export function setPicker(f){pick=f}

export const living=()=>S.agents.filter(a=>a.state!=='dead');
export const ranked=()=>living().filter(inRegion).sort((a,b)=>b.lvl-a.lvl||b.xp-a.xp||b.kills-a.kills);

// ---- small DOM helpers ----
const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
// Clickable hero name. Dead heroes stay clickable while their grave is still in S.agents.
export const hn=a=>{const s=el('span','hn f'+a.fac,styled(a));s.dataset.hid=a.id;return s};
const meter=(cls,frac)=>{const m=el('div','meter '+cls);const i=document.createElement('i');i.style.width=clamp(frac*100,0,100)+'%';m.append(i);return m};
// Render chronicle-style parts (strings, heroes, {t,c} spans) into a node.
const parts=(node,ps)=>{for(const p of ps){if(typeof p==='string')node.append(p);else if(p&&p.kind==='hero')node.append(hn(p));else if(p){const sp=el('span',p.c||'',p.t);if(p.dg){sp.dataset.dungeon=p.dg;sp.classList.add('dgname');sp.title='Open the dungeon view';sp.setAttribute('role','button');sp.tabIndex=0}node.append(sp)}}}; // p.dg: a DM-made site's name opens its dungeon view (#642)
// Zone index from a number or a zone name; -1 when unknown.
const zoneIdx=z=>typeof z==='number'?z:ZONES.indexOf(z);

// One line describing what a hero is doing right now.
export function doing(a){const c=homeOf(a).name,zn=ZONES[a.zone];
  if(a.state==='downed')return downText(a); // the body does nothing while down, whatever its last order was (#659)
  if(a.state==='aid'){const t=S.agents.find(x=>x.id===a.aid);return t?'Tending '+t.name+', who lies dying':'Tending the fallen'}
  if(a.player&&a.playDoing&&a.state!=='dead')return a.playDoing; // agent-played (sim/player.js)
  switch(a.state){
    case 'town':return a.townStep===0?`Selling loot at the ${c} auction house`:a.townStep===1?`Checking in with the ${c} quest giver`:`Leaving ${c} for ${ZONES[a.party?a.party.zone:zoneFor(a.lvl,homeOf(a).gate)]}`;
    case 'travel':return `Traveling to ${zn}`;
    case 'hunt':return a.quest?`Hunting ${MOBS[a.quest.type].pl} in ${zn}`:`Hunting in ${zn}`;
    case 'fight':return a.target?`Fighting a level ${a.target.lvl} ${MOBS[a.target.type].name}`:'Fighting';
    case 'return':return `Heading back to ${c}`;
    case 'mend':return `Mending from wounds in ${c}`;
    case 'duel':return a.target?`Fighting ${a.target.name} of the ${FAC[a.target.fac].name}`:'In a fight';
    case 'ghost':return `Dead. Running back to ${c} as a ghost`;
    case 'raid':return 'Raiding Kragmaw the Cinder Wyrm';
    case 'dead':return `Fell at level ${a.lvl}, ${a.cause}, at ${a.diedAt}. Gone forever.`;
    case 'assist':return a.target?`Helping a guildmate fight ${a.target.name}`:'Helping a guildmate';
    case 'follow':return a.party?`Following ${a.party.leader.name}'s party in ${zn}`:'Following the party';
    case 'camp':return a.playDoing||'Resting at camp';
    case 'regroup':return 'Pulling back after a skirmish';
    case 'dungeon':{const D=cryptOfHero(a)||CRYPT,s=a.siteIn!=null?siteById(a.siteIn):null; // a DM-made site names itself, never the Crypt (#917)
      if(a.siteIn!=null){const n=s?s.name:'a hidden place',t=s&&s.boss?(s.bossTitle?s.boss+', '+s.bossTitle:s.boss):'';if(s&&s.raid)return a.hidden?`Raiding ${n}${t?', fighting toward '+t:''}`:`Gathering a raid at ${n}`;return a.hidden?`Inside ${n}${t?', fighting toward '+t:''}`:`Gathering a group at ${n}`}
      if(!D)return 'Gathering a group';
      return a.hidden?`Inside ${D.name}, fighting toward ${D.boss}`:`Gathering a group at ${D.name}`}}return ''}

// ---- hero dossier ----
const TABS=[['stats','Stats'],['quests','Quests'],['log','Log'],['combat','Combat'],['bio','Bio'],['memory','Memory'],['gear','Gear'],['inv','Pack'],['party','Party'],['chat','Chat'],['mind','Mind'],['agent','Agent']];
// The tabs in three groups (#145): Character, Story, Mind. A tab added later without a group lands in Character.
const GROUPS=[['char','Character',['stats','gear','inv','party']],['story','Story',['quests','log','combat','bio','memory']],['mind','Mind',['chat','agent','mind']]];
const groupOf=t=>(GROUPS.find(g=>g[2].includes(t))||GROUPS[0])[0];
const lastIn={}; // the sub-tab last opened in each group
const SLOTS=[['head','Head'],['chest','Chest'],['hands','Hands'],['feet','Feet'],['main','Main hand'],['off','Off hand'],['trinket','Trinket']];
let tab='stats'; // persists across hero changes
export const activeTab=()=>tab;
export function setTab(t){if(TABS.some(([k])=>k===t)){tab=t;lastIn[groupOf(t)]=t}renderHero()}
// Open a group: its last-opened tab, else its first one this hero has.
export function setGroup(g){const G=GROUPS.find(x=>x[0]===g);if(!G)return;const a=cam.sel,ok_=k=>!a||tabShown(a,k);
  const inG=TABS.map(([k])=>k).filter(k=>groupOf(k)===g&&ok_(k));setTab(inG.includes(lastIn[g])?lastIn[g]:inG[0]||'stats')}

// Gear score: the gear module's own number, rounded to one decimal like the brain snapshot (#362).
const gearScoreOf=a=>Math.round(gearScore(a)*10)/10;

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
  if(a.goal&&!a.goal.aside){const th=a.goal.offered,g=el('div','goal');g.append(el('div',a.goal.done?'gd':'',th?'Unsworn: '+threadText(a):(a.goal.done?'Done: ':'Goal: ')+a.goal.text));
    if(a.goal.need&&!th){g.append(meter('gl',a.goal.done?1:(a.goal.progress||0)/a.goal.need));g.append(el('div','dm',`${a.goal.done?a.goal.need:a.goal.progress||0} / ${a.goal.need}`))}b.append(g)}
  {const fr=friendsOf(a).slice(0,6);if(fr.length){const d=el('div','meta');d.append('Friends: ');fr.forEach((f,i)=>{d.append(hn(f));if(i<fr.length-1)d.append(', ')});b.append(d)}}
  const nem=Object.entries(a.nemesis||{}).filter(([id])=>S.agents.some(x=>x.id==id&&x.state!=='dead')).pop();
  if(nem){const foe=S.agents.find(x=>x.id==nem[0]);const d=el('div','meta');d.append('Nemesis: ',hn(foe),` (killed guildmate ${nem[1]})`);b.append(d)}
  const q=a.quest?`${MOBS[a.quest.type].q}: ${a.quest.have}/${a.quest.need} ${MOBS[a.quest.type].pl}`:'No quest';
  b.append(el('div','meta','Quest: '+q));
  {const ad=advLine(a);if(ad){const d=el('div','meta adv');d.dataset.adv=a.adv;d.title='Open this adventure in the Dungeon Master log';parts(d,ad);b.append(d)}} // the DM's adventure and scene (sim/dm.js)
  b.append(el('div','meta',`Weather: ${weatherName(a.zone)} in ${ZONES[a.zone]}`))}

function tabStats(b,a){identity(b,a);if(a.abil)scoresRow(b,a);combatBlock(b,a);abilityBlock(b,a);if(a.player)b.append(el('div','meta gbsum','Gambits: '+gambitSummary(a)+' (Agent tab)'));professionBlock(b,a);skillsGrid(b,a);record_(b,a);story(b,a)}

function tabLog(b,a){const h=(a.history||[]).slice().reverse();
  if(!h.length){b.append(el('div','dm','Nothing worth recording yet.'));return}
  const ul=el('ul','log hist');byDay(ul,h,e=>{const li=el('li');li.append(el('time',null,stampOf(e)));const s=srcTag(e);if(s)li.append(s,' ');
    const dk=downKind(e.text);if(dk){li.className='dk-'+dk;li.append(el('span','badge b-'+dk,DOWN_BADGE[dk]))} // downed, stabilized, up again (#659)
    parts(li,e.parts||[e.text]);return li});b.append(ul)}
// The dossier header's downed row (#659): the same words as the party frame's, built fresh for the header's patch.
function downRow(a){const v=downView(a),fl=flashOf(a);if(!v)return null;const d=el('div','pfdown hdown'+(v.stable?' stable':''));d.title=downTitle(v);d.setAttribute('aria-label',downText(a));
  const s=el('span','pips ok',pips(v.s,v.of3)),f=el('span','pips bad',pips(v.f,v.of));s.title=v.s+' of '+v.of3+' death saves made';f.title=v.f+' of '+v.of+' failures';
  d.append(el('span','pfdl',v.stable?'STABLE':'DOWNED'),s,f,el('span','pfdt dm',v.timer),el('span','pfdx'+(fl?' t-'+fl.tone:''),fl?fl.word:''));return d}

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
  if(it.epic&&EPIC_ITEMS[it.name])d.append(el('div','if',worldFill(EPIC_ITEMS[it.name].flavour)));
  if(it.over){const o=it.over,ds=itemDelta(it,o);
    d.append(el('div','dm','Replaced '+o.name+' (ilvl '+o.ilvl+')'+(ds.length?': '+ds.join(', '):'')))}
  return d}
// Pack entries (issue #124): consumables, quest items and trade goods get a card in the same style as gear.
const invEntry=(a,i)=>a&&a.inv?a.inv.list[i]||null:null;
function supplyCard(e,cls){const d=el('div',cls||'itip');
  if(e.kind==='use'&&USES[e.id]){const U=USES[e.id];d.append(el('div','in qf',e.id),el('div','dm',U.kind.charAt(0).toUpperCase()+U.kind.slice(1)+' · x'+e.n));
    for(const [c,t] of useLines(e.id))d.append(el('div','is s-'+c,t));d.append(el('div','dm','Costs '+U.price+'g in town'),el('div','if',worldFill(U.flavour||'')))}
  else if(e.kind==='good'){d.append(el('div','in qp',e.id),el('div','dm',(MATERIALS[e.id]?'Material · ':'Trade good · ')+'x'+e.n));if(GOODS[e.id]||MATERIALS[e.id])d.append(el('div','is s-bn','Sells for about '+price(e.id)+'g each'))}
  else{const Q=QUEST_ITEMS[e.id];d.append(el('div','in gd',e.id),el('div','dm','Quest item'));
    d.append(el('div','if',Q?worldFill(Q.flavour):'Carried for a job; it is handed in when the job ends.'),el('div','dm','Cannot be sold, dropped or given.'))}
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
      else{v.append(el('span',qCls(it),it.name),' ',el('span','ilv','ilvl '+it.ilvl));if(it.maker)v.append(' ',el('span','dm mk','by '+it.maker));
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
  const groups=[['Potions and supplies',e=>e.kind==='use'],['Quest items',e=>e.kind==='quest'],['Spare gear',isGear],['Materials',e=>e.kind==='good'&&!!MATERIALS[e.id]],['Trade goods',e=>e.kind==='good'&&!MATERIALS[e.id]]];
  for(const [title,f] of groups){const rows=a.inv.list.map((e,i)=>[e,i]).filter(([e])=>f(e));if(!rows.length)continue;
    b.append(el('div','dm',title));const g=el('div','gear');
    for(const [e,i] of rows){const sel=pinned&&pinned.inv===i,gear=isGear(e);
      const kk=el('span','k',gear?slotLabel(e.slot):'x'+e.n),v=el('span','v');kk.dataset.inv=String(i);v.dataset.inv=String(i);if(sel){kk.classList.add('pin');v.classList.add('pin')}
      if(gear){v.append(el('span',qCls(e),e.name),' ',el('span','ilv','ilvl '+e.ilvl));if(e.cls&&e.cls!==a.cls&&!e.epic)v.append(' ',el('span','dm','for '+e.cls));if(e.maker)v.append(' ',el('span','dm mk','by '+e.maker))}
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

function tabChat(b,a){
  // a Fellowship member: its slice of the chat panel's stream (lines it said or heard, and its proposals and votes), newest first
  // a Fellowship member's chat is the Chat panel's stream (#845): one place for it, so this tab only points there
  if(slotted()&&inSlots(a)){const dk=typeof document!=='undefined'&&document.getElementById&&document.getElementById('dock-chat');
    b.append(el('div','meta',a.name+'’s lines, and what they heard, are in the Chat panel with the rest of the company’s talk.'));
    if(dk){const g=el('button','mini','Open the Chat tab');g.dataset.gochat='1';b.append(g)}return}
  const all=(a.chat||[]).slice(-20).reverse(),c=all.filter(e=>chatVisible(e,S));
  if(!c.length){b.append(el('div','dm',all.length?'Only background chatter so far (Settings, World chatter, shows it).':'Nothing said or heard yet.'));return}
  const ul=el('ul','log chat');chatByDay(ul,chatGroups(c));b.append(ul)}
// Chat lines with game-day stamps and a separator between days (#168), newest first like the other tabs.
export function chatByDay(ul,groups){let last=null;for(const g of groups){const d=dayOf(g.e);if(d!=null&&d!==last){ul.append(daySep(d));last=d}ul.append(chatLine(g.e,g.n))}}
// One compact line per message (#145, owner): "02:52 Nevith: text", the text wrapping under itself; a party shout reads "Nevith shouts: text (Kerin, Lorwyn)" (#182, no channel tag).
// No mind badge: the Mind and Agent tabs say who plays a hero; the model is in the name's hover title.
export function chatLine(e,n=1){const li=el('li','chl');li.setAttribute('data-k',keyOf(e));li.append(el('time',null,stampOf(e)));
  if(e.from&&e.from.kind==='dm')li.append(el('span','gd chn','Narrator'));else{const s=chatName(e.from),tg=chatTag(e);if(tg)s.title=(e.agent?'Agent-played':'AI-played')+(e.model?' · '+e.model.replace(/^Agent \((.*)\)$/,'$1'):'');li.append(s)}
  // a shout (party_say, #182) reads 'Kerin shouts: text', a courier 'Kerin sends word: text'; the dim suffix says who heard it. No channel tag (owner).
  const none=e.party&&!e.courier&&e.heard&&!e.heard.length;if(e.emote){li.append(el('em','chemote',' '+e.text));return li} // a wordless act in italics (#627)
  if(e.whisper)li.append(el('span','dm chwh',' whispers'+(e.toName?' to '+e.toName:'')));
  li.append(e.courier?' sends word: ':e.whisper?': ':none?' calls out, but no one is near: ':e.party?' shouts: ':': ',e.text);
  if(e.by==='scripted'&&e.trigger==='npc')li.append(el('span','dm chscr',' scripted'));
  if(e.comp)li.append(el('span','dm chscr',' DM voice'+(e.by==='scripted'?' · scripted':''))); // a companion of an agent company, voiced by the DM (#764); the watcher only // the scripted DM's townsfolk, not the DM agent's words (#540)
  if(e.opt!=null)li.append(el('span','dm chopt',' ('+(e.rfx?'reflex: ':'')+String(e.opt).replace(/^use:/,'use ')+')')); // the act this table line went with (#734)
  if(n>1)li.append(el('span','dm chx',' ×'+n));
  if(e.party&&!e.courier&&e.heard&&e.heard.length)li.append(el('span','dm chheard',' ('+e.heard.join(', ')+')'));return li}
// The same speaker saying the same thing on the same channel back to back shows once with a count.
export function chatGroups(lines){const out=[];for(const e of lines){const p=out[out.length-1];
  if(p&&p.e.from===e.from&&p.e.text===e.text&&!!p.e.party===!!e.party)p.n++;else out.push({e,n:1})}return out}
// A Fellowship member's name stands out in chat: bold, in its party-frame role colour (Tank blue, Healer green, DPS red).
// A name in chat: a Fellowship member in its class colour, bold; an NPC, foe or enemy hero in its disposition colour,
// muted and underlined (a shape as well as a colour), so it never reads as a class (owner, #169). One palette: core/colors.js.
export function liveOf(f){if(!f||f.kind!=='npc')return f;return (S.npcs||[]).find(p=>p.id===f.id)||(S.wanderers||[]).find(p=>p.id===f.id)||f}
export function chatName(h){const npc=h&&h.kind==='npc',t=toneOf(liveOf(h),slotted());let s;
  if(npc){s=el('span','hn',h.name)}else s=hn(h);
  s.classList.add('chn');
  if(t.kind==='class'){s.classList.add('fmn');s.style.color=t.color}
  else if(t.npc){s.classList.add('npcn','npc-'+t.kind);s.style.color=t.color;s.title=DISP[t.kind].label+' toward the Fellowship'}
  return s}

// ---- AI-played marking (sim/brain.js): toggle button next to the name, badge on the card and on model-written chat lines ----
const aiBadge=(t,title)=>{const s=el('span','ai-badge',t);if(title)s.title=title;return s};
function heroName(a){const d=el('div','nm f'+a.fac,styled(a)),st=brainStatus(a);
  {const ml=mindLabel(a),bd=aiBadge(ml.text,ml.title);bd.classList.add('mk-'+ml.kind);d.append(' ',bd)} // the one mind label (issue #136)
  if(!showMindButtons(a)||(inSlots(a)&&slotted()&&!devMode()))return d; // a member's mind is set in Members and minds (#145)
  const b=el('button','ai-toggle',st==='off'?'AI':'AI off');b.dataset.ai='1';b.title=st==='off'?'Let a language model play this hero (needs npm run relay)':'Return this hero to the scripted rules';d.append(' ',b);
  // Agent player (issue #75): an AI agent with its own session plays this hero through MCP tools.
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
  byDay(list,m,e=>{const isOpen=mindOpen&&mindOpen.hid===a.id&&mindOpen.id===e.id;
    const row=el('div','mrow'+(isOpen?' open':'')),h=el('div','mh');h.dataset.mind=e.id;
    mindRow(e).forEach((t,i)=>{if(i)h.append(el('span','dm',' \u00b7 '));h.append(el('span',i===0?'dm':i===3&&(e.reason||e.line)?'mq':null,t))});
    h.append(el('span','dm',' \u00b7 '),el('span','mo mo-'+e.outcome,e.outcome));
    row.append(h);if(isOpen)mindDetail(row,a,e);return row},'div');
  b.append(list)}
const BODY={quests:tabQuests,combat:tabCombat,stats:tabStats,log:tabLog,bio:tabBio,gear:tabGear,inv:tabInv,party:tabParty,chat:tabChat,mind:tabMind,agent:tabAgent,memory:tabMemory};

// The card skeleton (header, tab strip, body) is built once; renderHero refreshes the
// header and only the active tab's body, since it runs every 0.3s.
let skel=null;
function skeleton(root){root.replaceChildren();const hd=el('div','hd'),tabs=el('div','tabs'),tb=el('div','tb');
  const gr=el('div','tgroups'),sub=el('div','tsub');gr.setAttribute('role','tablist');gr.setAttribute('aria-label','Dossier');sub.setAttribute('role','tablist');
  for(const [g,label] of GROUPS){const b=el('button',null,label);b.dataset.tgroup=g;b.setAttribute('role','tab');gr.append(b)}
  for(const [k,label] of TABS){const b=el('button',null,label);b.dataset.tab=k;b.setAttribute('role','tab');sub.append(b)}
  tabs.append(gr,sub);
  // arrow keys move along a row of tabs
  tabs.addEventListener('keydown',e=>{if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft')return;const row=e.target.parentNode;if(!row||!tabs.contains(row))return;
    const bs=[...row.children].filter(b=>!b.hidden),i=bs.indexOf(e.target);if(i<0)return;const n=bs[(i+(e.key==='ArrowRight'?1:bs.length-1))%bs.length];e.preventDefault();n.click();n.focus()});
  wireGear(tb);root.append(hd,tabs,tb);skel={root,hd,tabs,tb,gr,sub};return skel}
// Which tabs a hero has: Mind only for an AI-played hero, Agent for an agent-played one, Memory for a Fellowship
// member; Party is hidden for members, whose party is the frames above the map.
function tabShown(a,k){if(k==='mind')return hasMind(a);if(k==='agent')return hasAgent(a);if(k==='memory')return !!a.memory||!!a.memories;if(k==='party')return !(inSlots(a)&&slotted());return true}

// The dock's short card (#546): with the dock open, a background hero (no company, not agent-played) shows its header and a
// Full sheet button; the tabs open on that click and stay open for that hero.
const fullFor=new Set();
export const briefCard=a=>!!a&&!!document.body&&document.body.classList.contains('docked')&&!inSlots(a)&&!a.player&&!companyOf(a)&&!fullFor.has(a.id);
export function renderHero(){const root=$('hero'),a=cam.sel;
  if(!a){root.innerHTML='<div class="meta">Tap a hero on the map, or pick one from Top heroes.</div>';skel=null;return}
  const k=skel&&skel.root===root&&root.contains(skel.hd)?skel:skeleton(root);
  const mh=maxHp(a),short=briefCard(a);
  // header and body are patched in place (#145): scroll, focus and open rows survive the 0.3 s tick
  patch(k.hd,h=>{h.append(heroName(a));
    h.append(el('div','meta',`Level ${a.lvl} ${a.cls} of the ${FAC[a.fac].name} · ${a.guild?'<'+a.guild.tag+'> '+a.guild.name:'Unguilded'}`));
    const dg=el('div','doing'),pu=el('div','purp');setPurpose(pu,a,'d');pu.tabIndex=0;pu.setAttribute('role','button');pu.setAttribute('aria-expanded',String(isOpen('d'+a.id)));dg.append(pu);if(a.state==='dungeon'&&a.hidden){const b=el('button','dglink','View inside ▸');b.type='button';b.dataset.dungeon=a.siteIn!=null?'site:'+a.siteIn:heroCryptName(a);b.title='Open the dungeon view';dg.append(' ',b)}if(LAIR&&(a.state==='raid'&&a.raid||a.state==='downed'&&Math.hypot(a.x-LAIR.x,a.y-LAIR.y)<=(LAIR.r||5)+1)){const b=el('button','dglink','View the raid ▸');b.type='button';b.dataset.dungeon=LAIR.name;b.title='Open the raid arena';dg.append(' ',b)}h.append(dg); // the dungeon view (#85, render/dungeonview.js)
    h.append(el('div','dm','HP'),meter('hp',a.hp/mh));{const dr=downRow(a);if(dr)h.append(dr)} // DOWNED, the tally and the timer (#659)
    h.append(el('div','dm','XP'),meter('xp',a.lvl>=20?1:a.xp/xpNeed(a.lvl)));
    if(short){const b=el('button','mini fullsheet','Full sheet ▸');b.type='button';b.dataset.fullsheet=a.id;b.title='Open '+a.name+'’s full sheet: stats, gear, story and mind';h.append(b)}});
  // the dock (#546): a hero outside every company shows this short card until its full sheet is asked for
  const sc=k.root.closest?k.root.closest('section'):null;
  if(k.tabs.hidden!==short){k.tabs.hidden=short;k.tb.hidden=short}
  if(sc&&sc._who!==a.id){sc._who=a.id;if(document.body.classList.contains('docked'))sc.scrollTop=0}
  if(short){hideTip();return}
  const cur=tabShown(a,tab)?tab:'stats',grp=groupOf(cur);
  for(const b of k.gr.children){const on=b.dataset.tgroup===grp;b.setAttribute('aria-pressed',String(on));b.setAttribute('aria-selected',String(on))}
  for(const b of k.sub.children){const on=b.dataset.tab===cur;b.setAttribute('aria-pressed',String(on));b.setAttribute('aria-selected',String(on));b.hidden=groupOf(b.dataset.tab)!==grp||!tabShown(a,b.dataset.tab)}
  if(pinned&&pinned.id!==a.id)pinned=null;
  // a new hero or tab starts at the top; the same hero and tab keep their place
  const who=a.id+':'+cur;if(k.tb.dataset.who!==who){k.tb.dataset.who=who;k.tb.replaceChildren();delete k.tb.dataset.sig}
  if(cur==='mind'){const sig=mindSig(a);if(k.tb.dataset.sig!==sig&&patch(k.tb,b=>tabMind(b,a)))k.tb.dataset.sig=sig}
  else patch(k.tb,b=>BODY[cur](b,a));
  k.tb.dataset.tab=cur;
  if(cur!=='gear')hideTip();else if(hov)showTip()}

// ---- other panels ----
export function renderTops(){patch($('tops'),ul=>ranked().slice(0,8).forEach((a,i)=>{const li=el('li');li.setAttribute('data-k','h'+a.id);const b=el('button');
  if(a===cam.sel)b.className='sel';const n=el('span','dm',i+1);const nm=el('span','f'+a.fac,a.name+' ');
  nm.append(el('span','dm',a.cls));const lv=el('span','lv','Lv '+a.lvl);
  b.append(n,nm,lv);b.onclick=()=>pick(a);li.append(b);ul.append(li)}),{anchor:false})}

export function renderFacs(){const rows=[['',...FAC.map((f,i)=>el('span','h f'+i,f.name.toUpperCase()))]];
  const s=f=>living().filter(a=>a.fac===f);
  rows.push(['Avg level',...[0,1].map(f=>(s(f).reduce((t,a)=>t+a.lvl,0)/Math.max(1,s(f).length)).toFixed(1))]);
  rows.push(['Fallen',...[0,1].map(f=>S.facStats[f].fallen)]);
  rows.push(['Honor',...[0,1].map(f=>S.facStats[f].honor)]);
  rows.push(['Boss kills',...[0,1].map(f=>S.facStats[f].bosses)]);
  if(OUTPOSTS.length)rows.push(['Outposts',...outpostCounts().map(n=>n+'/'+OUTPOSTS.length)]);
  rows.push(['Treasury',...[0,1].map(f=>s(f).reduce((t,a)=>t+a.gold,0)+'g')]);
  rows.push(['Epics',...[0,1].map(f=>s(f).reduce((t,a)=>t+a.epics.length,0))]);
  patch($('facs'),g=>{for(const r of rows){g.append(el('div','k',r[0]));for(const v of r.slice(1)){const d=el('div');d.append(typeof v==='object'?v:String(v));g.append(d)}}})}

// Graveyard entries carry no hero id, so match the grave still in S.agents by name,
// faction and time of death; recycled graves stay plain text.
export function renderFallen(){patch($('fallen'),el_=>{if(!S.fallen.length){el_.append(el('li','dm','No one has fallen yet.'));return}
  for(const f of S.fallen){const li=el('li');li.setAttribute('data-k',keyOf(f));li.append(el('time',null,f.t));
    const n=el('span','f'+f.fac,'† '+f.name);const a=S.agents.find(x=>x.state==='dead'&&x.name===f.name&&x.fac===f.fac&&x.diedAt===f.t);
    if(a){n.classList.add('hn');n.dataset.hid=a.id}
    li.append(n,` · Lv ${f.lvl} ${f.cls}, ${f.cause}`);el_.append(li)}})}

const FOCUS_WHY={crypt:'its leader will lead them down into the Crypt',raid:'its leader means to bring down the world boss',adventure:'its leader sends them after the jobs on the town boards',pvp:'its leader wants enemy blood on the roads'};
const focusWhy=(f,L)=>(L?L.name+': ':'')+(FOCUS_WHY[f]||'no focus chosen');
const gScore=g=>{const m=membersOf(g);return Math.round(m.reduce((t,a)=>t+a.lvl+a.honor*3+a.kills/25,0)+g.clears*25+g.bosses*40)};
// Living guilds by score with leader and head count, then a count of the retired.
export function renderGuilds(){const live=livingGuilds().map(g=>({g,m:membersOf(g),s:gScore(g)})).sort((x,y)=>y.s-x.s);
  const ret=S.GUILDS.length-live.length,wide=t=>{const td=el('td','dm',t);td.colSpan=3;const tr=el('tr');tr.append(td);return tr};
  patch($('guilds'),tb=>{if(!live.length)tb.append(wide('No guild has been founded yet.'));
    live.forEach(({g,m,s},i)=>{const L=leaderOf(g),tr=el('tr'),td=el('td');tr.setAttribute('data-k',keyOf(g));
      td.append(el('span','dm',String(i+1)),' ',el('span','f'+g.fac,'<'+g.tag+'> '+g.name),el('br'),el('span','dm',(L?'led by '+L.name+' · ':'')+m.length+' member'+(m.length===1?'':'s')));
      {const fo=guildFocus(g),fel=m.some(x=>inSlots(x)&&x.state!=='dead');
        if(fo!=='open'||fel){const w=el('span','gd',fel?'none (Fellowship member)':FOCUS_NAME[fo]);w.title=fel?'A guild with a living Fellowship member sets no focus.':focusWhy(fo,L);td.append(el('br'),el('span','dm','Focus: '),w)}} // the leader's focus and why (sim/guildfocus.js, #6, #327)
      const rv=rivalsOf(g);if(rv.length){td.append(el('br'),el('span','dm','Rivals: '));rv.forEach((h,j)=>{const ht=S.rivals&&S.rivals.heat[g.id<h.id?g.id+':'+h.id:h.id+':'+g.id]||0,sp=el('span','f'+h.fac,'<'+h.tag+'>');sp.title='Rivalry with <'+h.tag+'> '+h.name+': heat '+(Math.round(ht*10)/10)+' of 8';td.append(j?el('span','dm',', '):'',sp)})} // declared rivalries and their heat (sim/rivals.js, #6, #327)
      tr.append(td,el('td',null,g.clears+'/'+(g.clears+g.wipes)),el('td','gd',String(s)));tb.append(tr)});
    if(ret)tb.append(wide('Retired: '+ret))})}

export function renderAH(){patch($('ah'),tb=>{for(const n of Object.keys(GOODS)){const p=price(n),d=p-GOODS[n].prev,tr=el('tr');
  tr.append(el('td',null,n),el('td','gd',p+'g'),el('td',d>0?'up':d<0?'down':'dm',d>0?'▲'+d:d<0?'▼'+(-d):'–'));tb.append(tr)}})}

export function renderClock(){$('clock').textContent=`Day ${Math.floor(S.gameMin/1440)+1} · ${clockStr()}`}

// Chronicle: render what the sim already logged, then follow new entries.
function initChronicle(){const el_=$('log');
  const add=e=>{if(!chronicleShows(e))return;const li=document.createElement('li');if(e.parts[0]&&e.parts[0].c==='nar')li.className='nar';
    else{const dk=downKind(e.parts.map(p=>typeof p==='string'?p:p&&p.kind==='hero'?p.name:p&&p.t||'').join(''));if(dk)li.className='dk-'+dk} li.append(el('time',null,e.t));parts(li,e.parts); // the downed, a rescue, a mercy, a finish (#659)
    keepView(el_,()=>{el_.prepend(li);while(el_.children.length>90)el_.lastChild.remove()})}; // a new line on top keeps the line being read in view (#145)
  const all=()=>{el_.replaceChildren();for(let i=S.chronicle.length-1;i>=0;i--)add(S.chronicle[i])};all();
  setChronicleRefresh(all); // the Fellowship only filter toggles re-render from S.chronicle
  onLog(add)}

// One delegated click handler for every panel: hero names (.hn[data-hid]) pick that hero,
// tab buttons ([data-tab]) switch the dossier tab.
function initClicks(){const host=document.querySelector('.main')||document.body;
  host.addEventListener('click',e=>{const t=e.target;if(!t||!t.closest)return;
    if(t.closest('[data-gochat]')){const d=document.getElementById('dock-chat');if(d)d.click();return}
    const ag=t.closest('[data-agent]');if(ag){const a=cam.sel;if(a){if(a.player)agentOff(a);else if(agentOn(a))tab='agent';renderHero()}return}
    const ai=t.closest('[data-ai]');if(ai){const a=cam.sel;if(a){if(a.brain)disableBrain(a);else enableBrain(a);renderHero()}return}
    const mp=t.closest('[data-mprompt]');if(mp){if(mindOpen)mindOpen.prompt=!mindOpen.prompt;renderHero();return}
    const mr=t.closest('[data-mind]');if(mr){const a=cam.sel,id=Number(mr.dataset.mind);
      if(a)mindOpen=mindOpen&&mindOpen.hid===a.id&&mindOpen.id===id?null:{hid:a.id,id,prompt:false};renderHero();return}
    const dv=t.closest('[data-adv]');if(dv&&!t.closest('.hn[data-hid]')){showAdventure(dv.dataset.adv);return}
    const cs=t.closest('[data-cstat]');if(cs){statOpen=statOpen===cs.dataset.cstat?null:cs.dataset.cstat;renderHero();return}
    const fs=t.closest('[data-fullsheet]');if(fs){fullFor.add(Number(fs.dataset.fullsheet));renderHero();return}
    const tg=t.closest('[data-tgroup]');if(tg){setGroup(tg.dataset.tgroup);return}
    const tb=t.closest('[data-tab]');if(tb){setTab(tb.dataset.tab);return}
    const n=t.closest('.hn[data-hid]');if(!n)return;
    const a=S.agents.find(x=>x.id==n.dataset.hid);if(a){pick(a);if(a.state==='dead'&&n.closest('#fallen'))setTab('bio')}})}

export function initPanels(){initStable();initBridge();initChronicle();initTimeline();initDmLog();initClicks();onMarketTick(renderAH);renderFacs();renderAH();renderGuilds();renderFallen();renderClock()}
