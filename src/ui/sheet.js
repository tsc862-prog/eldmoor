// The Fellowship sheet (issue #94): an overlay comparing the five side by side, one column per
// member in role order. Rows: the six scores, the five combat totals, trained skills, gear by slot
// with item levels and the gear score, gold, oath and progress, the last memory line, and each
// member's bond toward every companion. Click a row's label to sort the columns by it (again to
// flip, a third time back to role order). Names are .hn spans: clicking one follows that member
// (panels.js owns the delegated click) and closes the sheet. The table scrolls sideways inside its
// own frame on phones. While open it refreshes at the 0.3 s cadence, only when a value changed.
// sheetRows() returns the same table as plain data for the headless smoke check.
// Each column header shows the member's face (#376), the same portrait and modes as the party frame
// (dead when fallen, ghost); one canvas per hero is kept across rebuilds and redrawn only when its face changes.
import {CLS} from '../data/classes.js';
import {SLOTS as GEAR_SLOTS} from '../data/items.js';
import {S} from '../sim/index.js';
import {fellowshipMembers} from '../sim/fellowship.js';
import {combatStats} from '../sim/stats.js';
import {bond} from '../sim/bonds.js';
import {ABILITIES,ABIL_IDS,SKILLS,SKILL_IDS,score,mod,trained} from '../sim/abilities.js';
import {gearScore} from '../sim/gear.js';
import {capOf,used,countKind} from '../sim/inv.js';
import {fmtPct,setTab} from './panels.js';
import * as sim from '../sim/index.js';
import {span} from './combat.js';
import {portrait} from '../render/sprites.js'; // generated face portraits (#367, #372)

const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
const sg=m=>(m>=0?'+':'')+m;
const SLOT_NAME={head:'Head',chest:'Chest',hands:'Hands',feet:'Feet',main:'Main hand',off:'Off hand',trinket:'Trinket'};
const sumN=o=>Object.values(o||{}).reduce((s,n)=>s+(+n||0),0);
// the last fight as one line: foe, result, dealt, taken, healed, abilities and potions (fightSummary, src/sim/actlog.js)
function lastFight(a){const g=globalThis.__actionLog,f=g&&g.fightSummary?g.fightSummary:sim.fightSummary;
  let s=null;try{s=typeof f==='function'?f(a):null}catch(e){s=null}
  if(!s)return {t:'no fights yet',n:null,c:'dm'};
  const r=Math.round,pots=sumN(s.items),abs=sumN(s.abilities);
  return {t:(s.foe||'?')+' · '+(s.result||'?')+' · dealt '+r(s.dealt||0)+', taken '+r(s.taken||0)+', healed '+r(s.healed||0)+' · '+abs+' abilit'+(abs===1?'y':'ies')+', '+pots+' potion'+(pots===1?'':'s')+(s.end!=null&&s.start!=null?' · '+span(s.end-s.start):''),
    n:s.start==null?0:s.start,c:s.result==='ongoing'?'hi':'',fight:a.id}}
const qCls=it=>it.epic?'ep':it.quality==='rare'?'qr':it.quality==='fine'?'qf':'qp';

// ---- the table as data: cols (members) and rows {key, group, label, cells:[{t, n (sort value), c (css)}]} ----
export function sheetRows(){const ms=fellowshipMembers(),cols=ms.map(m=>({slot:m.slot,role:m.role,label:m.label,hero:m.hero}));
  const rows=[],row=(key,group,label,f)=>rows.push({key,group,label,cells:cols.map(c=>c.hero?f(c.hero):{t:'',n:null})});
  row('lvl','Identity','Level',a=>({t:String(a.lvl),n:a.lvl}));
  for(const k of ABIL_IDS)row('ab_'+k,'Scores',ABILITIES[k].name,a=>{const s=score(a,k),m=mod(a,k);return {t:s+' ('+sg(m)+')',n:s,c:m>=2?'hi':m<0?'lo':''}});
  const cs=a=>combatStats(a);
  row('health','Combat','Health',a=>({t:Math.max(0,Math.round(a.hp))+' / '+cs(a).health,n:cs(a).health}));
  row('attack','Combat','Attack',a=>({t:Math.round(cs(a).attack)+' '+(CLS[a.cls].range>2?'ranged':'melee'),n:cs(a).attack}));
  row('defense','Combat','Defense',a=>({t:fmtPct(cs(a).defense),n:cs(a).defense}));
  row('crit','Combat','Crit',a=>({t:fmtPct(cs(a).crit),n:cs(a).crit}));
  row('speed','Combat','Speed',a=>({t:cs(a).aps.toFixed(2)+'/s',n:cs(a).aps}));
  row('skills','Skills','Trained',a=>{const t=SKILL_IDS.filter(k=>trained(a,k)).map(k=>SKILLS[k].name);return {t:t.join(', ')||'none',n:t.length}});
  for(const k of GEAR_SLOTS)row('g_'+k,'Gear',SLOT_NAME[k]||k,a=>{const it=a.slots&&a.slots[k];return it?{t:it.name+' · '+it.ilvl,n:it.ilvl,c:qCls(it)}:{t:'empty',n:0,c:'dm'}});
  row('gs','Gear','Gear score',a=>{const g=Math.round(gearScore(a)*10)/10;return {t:String(g),n:g}});
  row('pack','Pack','Pack',a=>{const n=a.inv?used(a):0;return {t:a.inv?n+'/'+capOf(a)+' slots':'none',n}});
  row('pots','Pack','Potions',a=>{const p=a.inv?countKind(a,'potion'):0;return {t:String(p),n:p,c:p?'':'dm'}});
  row('supplies','Pack','Supplies',a=>{const L=a.inv?a.inv.list.filter(e=>e.kind==='use'&&e.id):[];const t=L.map(e=>e.id+(e.n>1?' x'+e.n:'')).join(', ');return {t:t||'none',n:L.reduce((s,e)=>s+e.n,0),c:t?'':'dm'}});
  row('quest','Pack','Quest items',a=>{const L=a.inv?a.inv.list.filter(e=>e.kind==='quest'):[];return {t:L.map(e=>e.id).join(', ')||'none',n:L.length,c:L.length?'gd':'dm'}});
  row('fight','Record','Last fight',lastFight);
  row('gold','Record','Gold',a=>({t:a.gold+'g',n:a.gold}));
  row('kills','Record','Kills',a=>({t:String(a.kills),n:a.kills}));
  row('oath','Story','Oath',a=>{const g=a.goal;if(!g)return {t:'none',n:-1,c:'dm'};const f=g.done?1:g.need?(g.progress||0)/g.need:0;
    return {t:(g.done?'Done: ':'')+g.text+(g.need?' ('+(g.done?g.need:g.progress||0)+'/'+g.need+')':''),n:f,c:g.done?'gd':''}});
  row('mem','Story','Last memory',a=>{const r=a.memory&&a.memory.recent;const e=r&&r.length?r[r.length-1]:null;return e?{t:e.t+' · '+e.text,n:a.memory.n||0}:{t:'nothing yet',n:0,c:'dm'}});
  for(const c of cols){if(!c.hero)continue;const b=c.hero;
    row('bond_'+b.id,'Bonds','Toward '+b.name,a=>a===b?{t:'-',n:null,c:'dm'}:{t:String(Math.round(bond(a,b)*10)/10),n:bond(a,b),c:bond(a,b)>=15?'hi':bond(a,b)>=6?'':'dm'})}
  return {cols,rows}}

// ---- faces: one canvas per hero, kept across table rebuilds, redrawn only when the face changes ----
const faceMode=a=>a.state==='dead'?'dead':a.state==='ghost'?'ghost':'';
const faces=new Map();
function face(a){let cv=faces.get(a.id);if(!cv){cv=el('canvas','shport');cv.setAttribute('aria-hidden','true');faces.set(a.id,cv)}
  const s=portrait(a,faceMode(a));if(cv._s!==s){cv._s=s;cv.width=s.width;cv.height=s.height;const c=cv.getContext&&cv.getContext('2d');if(c){c.clearRect(0,0,s.width,s.height);c.drawImage(s,0,0)}}
  return cv}

// ---- DOM ----
let ov=null,box=null,body=null,open=false,sort=null,dir=-1,sig='';
export const sheetOpen=()=>open;
export function openSheet(){if(!ov||!S.fellowship)return;open=true;ov.hidden=false;sig='';renderSheet();const c=ov.querySelector('.shclose');if(c&&c.focus)c.focus()}
export function closeSheet(){if(!ov)return;open=false;ov.hidden=true}

function order(T){const idx=T.cols.map((_,i)=>i);if(!sort)return idx;const r=T.rows.find(x=>x.key===sort);if(!r)return idx;
  return idx.sort((i,j)=>{const a=r.cells[i].n,b=r.cells[j].n;if(a==null&&b==null)return i-j;if(a==null)return 1;if(b==null)return -1;return (a-b)*dir||i-j})}

function build(T){const tbl=el('table','shtbl'),ord=order(T);
  const thead=el('thead'),hr=el('tr');hr.append(el('th','shcorner',sort?'sorted by '+(T.rows.find(r=>r.key===sort)||{label:'?'}).label.toLowerCase():'role order'));
  for(const i of ord){const c=T.cols[i],th=el('th','shcol');
    if(c.hero){const n=el('span','hn f'+c.hero.fac,c.hero.name);n.dataset.hid=c.hero.id;const tx=el('span','shcoltx');tx.append(el('span','frole r-'+c.role,c.label),el('br'),n,el('br'),el('span','dm',c.hero.cls+(c.hero.state==='dead'?' · fallen':'')));
      const hd=el('div','shcolhd');hd.append(face(c.hero),tx);th.append(hd)}
    else th.append(el('span','frole r-'+c.role,c.label),el('br'),el('span','dm','place empty'));hr.append(th)}
  thead.append(hr);tbl.append(thead);
  const tb=el('tbody');let grp='';
  for(const r of T.rows){if(r.group!==grp){grp=r.group;const gr=el('tr','shgrp'),td=el('td',null,grp);td.colSpan=T.cols.length+1;gr.append(td);tb.append(gr)}
    const tr=el('tr'),th=el('th','shrow'),b=el('button','shsort'+(sort===r.key?' on':''),r.label+(sort===r.key?(dir<0?' ▼':' ▲'):''));b.dataset.ssort=r.key;b.title='Sort the columns by '+r.label.toLowerCase();th.append(b);tr.append(th);
    for(const i of ord){const c=r.cells[i],td=el('td',c.c||null);
      if(c.fight!=null){const b=el('button','hn shfight',c.t);b.dataset.hid=c.fight;b.title='Open the Combat tab';td.append(b)}else td.textContent=c.t;tr.append(td)}tb.append(tr)}
  tbl.append(tb);return tbl}

export function renderSheet(){if(!ov)return;if(!S.fellowship){if(open)closeSheet();return}if(!open)return;
  const T=sheetRows(),k=sort+'|'+dir+'|'+T.cols.map(c=>c.hero?c.hero.id+faceMode(c.hero):'-').join(',')+'|'+T.rows.map(r=>r.cells.map(c=>c.t).join('¦')).join('§');
  if(k===sig)return;sig=k;const ids=new Set(T.cols.map(c=>c.hero&&c.hero.id));for(const id of faces.keys())if(!ids.has(id))faces.delete(id);const x=body.scrollLeft,y=body.scrollTop;body.replaceChildren(build(T));body.scrollLeft=x;body.scrollTop=y;
  box.querySelector('.shttl').textContent=S.fellowship.name+' · side by side'}

export function initSheet(){ov=$('sheetov');if(!ov)return;
  box=el('div','shbox');box.setAttribute('role','dialog');box.setAttribute('aria-label','Fellowship sheet');
  const hd=el('div','shhead');const cl=el('button','mini shclose','Close');cl.dataset.sclose='1';hd.append(el('span','shttl','Fellowship'),cl);
  body=el('div','shbody');box.append(hd,body,el('div','dm shkey','Click a row name to sort the five by it. Click a name to follow that member.'));ov.append(box);
  ov.addEventListener('click',e=>{const t=e.target;if(t===ov||(t.closest&&t.closest('[data-sclose]'))){closeSheet();return}
    const s=t.closest&&t.closest('[data-ssort]');if(s){const k=s.dataset.ssort;if(sort!==k){sort=k;dir=-1}else if(dir<0)dir=1;else sort=null;sig='';renderSheet();return}
    if(t.closest&&t.closest('.shfight')){setTab('combat')}
    if(t.closest&&t.closest('.hn[data-hid]'))closeSheet()}); // the click bubbles on to panels.js, which follows the hero
  document.addEventListener('keydown',e=>{if(open&&e.key==='Escape')closeSheet()})}
