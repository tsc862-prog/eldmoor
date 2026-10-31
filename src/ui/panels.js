// Side panels: hero card, factions, chronicle, graveyard, guilds, top heroes,
// auction house, clock. Reads sim state and the renderer's camera selection.
import {clamp} from '../core/rng.js';
import {CITY,CRYPT,ZONES,zoneFor} from '../world/map.js';
import {FAC} from '../data/factions.js';
import {MOBS} from '../data/mobs.js';
import {GOODS,price} from '../data/items.js';
import {S,clockStr,maxHp,xpNeed,onLog,onMarketTick} from '../sim/index.js';
import {cam} from '../render/draw.js';
import {weatherName} from '../sim/weather.js';

const $=id=>document.getElementById(id);
let pick=()=>{};
// The controls module installs the handler used when a hero is clicked in a list.
export function setPicker(f){pick=f}

export const living=()=>S.agents.filter(a=>a.state!=='dead');
export const ranked=()=>living().sort((a,b)=>b.lvl-a.lvl||b.xp-a.xp||b.kills-a.kills);

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

export function renderHero(){const el=$('hero'),a=cam.sel;
  if(!a){el.innerHTML='<div class="meta">Tap a hero on the map, or pick one from Top heroes.</div>';return}
  const mh=maxHp(a),q=a.quest?`${MOBS[a.quest.type].q}: ${a.quest.have}/${a.quest.need} ${MOBS[a.quest.type].pl}`:'No quest';
  el.innerHTML='';
  const add=(cls,html)=>{const d=document.createElement('div');d.className=cls;if(html instanceof Node)d.append(html);else d.textContent=html;el.append(d);return d};
  add('nm f'+a.fac,a.name);
  add('meta',`Level ${a.lvl} ${a.cls} of the ${FAC[a.fac].name} · <${a.guild.tag}> ${a.guild.name}`);
  add('meta','Traits: '+(a.traits||[]).join(', '));
  add('doing',doing(a));
  add('dm','HP');const hp=add('meter hp','');const i1=document.createElement('i');i1.style.width=clamp(a.hp/mh*100,0,100)+'%';hp.append(i1);
  add('dm','XP');const xp=add('meter xp','');const i2=document.createElement('i');i2.style.width=(a.lvl>=20?100:a.xp/xpNeed(a.lvl)*100)+'%';xp.append(i2);
  add('meta','Quest: '+q);
  add('meta','Weather: '+weatherName(a.zone)+' in '+ZONES[a.zone]);
  if(a.party){const d=add('meta','');d.append('Party: ');a.party.mem.forEach((b,i)=>{const s=document.createElement('span');s.className='f'+b.fac;s.textContent=b.name+(b===a.party.leader?' (leader)':'');d.append(s);if(i<a.party.mem.length-1)d.append(', ')})}
  const nem=Object.entries(a.nemesis).filter(([id])=>S.agents.some(x=>x.id==id&&x.state!=='dead')).pop();
  if(nem){const b=S.agents.find(x=>x.id==nem[0]);const d=add('meta','');d.append('Nemesis: ');const s=document.createElement('span');s.className='f'+b.fac;s.textContent=b.name;d.append(s,` (killed guildmate ${nem[1]})`)}
  const st=add('stats','');[['Gold',a.gold+'g'],['Gear',a.gear],['Kills',a.kills],['Honor',a.honor]].forEach(([k,v])=>{const d=document.createElement('div');const b=document.createElement('b');b.textContent=v;const s=document.createElement('span');s.textContent=k;d.append(b,s);st.append(d)});
  if(a.epics.length){const e=add('epics','');e.append('Epics: ');a.epics.forEach((n,i)=>{const s=document.createElement('span');s.className='ep';s.textContent='['+n+']';e.append(s);if(i<a.epics.length-1)e.append(' ')})}
  else add('epics dm','No epic items yet.')}

export function renderTops(){const el=$('tops');el.innerHTML='';ranked().slice(0,8).forEach((a,i)=>{const li=document.createElement('li');const b=document.createElement('button');
  if(a===cam.sel)b.className='sel';const n=document.createElement('span');n.className='dm';n.textContent=i+1;const nm=document.createElement('span');nm.className='f'+a.fac;nm.textContent=a.name+' ';
  const cl=document.createElement('span');cl.className='dm';cl.textContent=a.cls;nm.append(cl);const lv=document.createElement('span');lv.className='lv';lv.textContent='Lv '+a.lvl;
  b.append(n,nm,lv);b.onclick=()=>pick(a);li.append(b);el.append(li)})}

export function renderFacs(){const el=$('facs');const rows=[['',...FAC.map((f,i)=>`<span class="h f${i}">${f.name.toUpperCase()}</span>`)]];
  const s=f=>living().filter(a=>a.fac===f);
  rows.push(['Avg level',...[0,1].map(f=>(s(f).reduce((t,a)=>t+a.lvl,0)/Math.max(1,s(f).length)).toFixed(1))]);
  rows.push(['Fallen',...[0,1].map(f=>S.facStats[f].fallen)]);
  rows.push(['Honor',...[0,1].map(f=>S.facStats[f].honor)]);
  rows.push(['Boss kills',...[0,1].map(f=>S.facStats[f].bosses)]);
  rows.push(['Treasury',...[0,1].map(f=>s(f).reduce((t,a)=>t+a.gold,0)+'g')]);
  rows.push(['Epics',...[0,1].map(f=>s(f).reduce((t,a)=>t+a.epics.length,0))]);
  el.innerHTML=rows.map(r=>`<div class="k">${r[0]}</div><div>${r[1]}</div><div>${r[2]}</div>`).join('')}

export function renderFallen(){const el=$('fallen');if(!S.fallen.length){el.innerHTML='<li class="dm">No one has fallen yet.</li>';return}
  el.innerHTML='';for(const f of S.fallen){const li=document.createElement('li');const t=document.createElement('time');t.textContent=f.t;
    const n=document.createElement('span');n.className='f'+f.fac;n.textContent='† '+f.name;li.append(t,n,` · Lv ${f.lvl} ${f.cls}, ${f.cause}`);el.append(li)}}

const gScore=g=>{const m=living().filter(a=>a.guild===g);return Math.round(m.reduce((t,a)=>t+a.lvl+a.honor*3+a.kills/25,0)+g.clears*25+g.bosses*40)};
export function renderGuilds(){$('guilds').innerHTML=S.GUILDS.slice().sort((x,y)=>gScore(y)-gScore(x)).map((g,i)=>
  `<tr><td><span class="dm">${i+1}</span> <span class="f${g.fac}">&lt;${g.tag}&gt; ${g.name}</span></td><td>${g.clears}/${g.clears+g.wipes}</td><td class="gd">${gScore(g)}</td></tr>`).join('')}

export function renderAH(){$('ah').innerHTML=Object.keys(GOODS).map(n=>{const p=price(n),d=p-GOODS[n].prev;
  return `<tr><td>${n}</td><td class="gd">${p}g</td><td class="${d>0?'up':d<0?'down':'dm'}">${d>0?'▲'+d:d<0?'▼'+(-d):'–'}</td></tr>`}).join('')}

export function renderClock(){$('clock').textContent=`Day ${Math.floor(S.gameMin/1440)+1} · ${clockStr()}`}

// Chronicle: render what the sim already logged, then follow new entries.
function initChronicle(){const el=$('log');
  const add=e=>{const li=document.createElement('li');const t=document.createElement('time');t.textContent=e.t;li.append(t);
    for(const p of e.parts){if(typeof p==='string')li.append(p);else{const s=document.createElement('span');
      if(p.kind==='hero'){s.className='f'+p.fac;s.textContent=p.name}else{s.className=p.c||'';s.textContent=p.t}li.append(s)}}
    el.prepend(li);while(el.children.length>90)el.lastChild.remove()};
  for(let i=S.chronicle.length-1;i>=0;i--)add(S.chronicle[i]);
  onLog(add)}

export function initPanels(){initChronicle();onMarketTick(renderAH);renderFacs();renderAH();renderGuilds();renderFallen();renderClock()}
