// The dossier Combat tab (owner request): the last fights as compact cards (newest on top, the newest open) with a
// line-by-line log inside, filter chips and totals. Reads sim.actionLog / fightSummary / fights when the sim exports
// them (ai/action-log); until then it says the log arrives with the next update. The sim never imports this.
// A stub can override the API: globalThis.__actionLog = {actionLog, fights, fightSummary} (or just an actionLog function).
import * as sim from '../sim/index.js';
import {S} from '../sim/index.js';
import {classColor} from '../core/colors.js';
import {patch} from './stable.js';

const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
export const FILTERS=[['all','All'],['dmg','Damage'],['abil','Abilities'],['item','Items'],['heal','Heals']];
const KINDSET={
  all:null,
  dmg:new Set(['hit','hurt','miss','dodge','block','kill','death']),
  abil:new Set(['ability','passive']),
  item:new Set(['item']),
  heal:new Set(['heal','healed'])};
const SHOWN=8,MAXLINES=60;
let filter='all',cur=null;

function api(){const g=globalThis.__actionLog;
  if(g)return typeof g==='function'?{actionLog:g}:g;
  return typeof sim.actionLog==='function'?{actionLog:sim.actionLog,fights:sim.fights,fightSummary:sim.fightSummary}:null}

const num=v=>Math.round(+v||0);
export const stamp=m=>{if(m==null)return '';const d=Math.floor(m/1440)+1,h=Math.floor(m%1440/60),mi=Math.floor(m%60);return 'D'+d+' '+String(h).padStart(2,'0')+':'+String(mi).padStart(2,'0')};
// the game minutes a fight lasted, as "1m 20s" / "45s"
export function span(min){const s=Math.max(0,Math.round((+min||0)*60));return s<60?s+'s':Math.floor(s/60)+'m'+(s%60?' '+s%60+'s':'')}
const counts=o=>Object.entries(o||{}).map(([k,n])=>k+' ×'+n).join(', ');

// Fights from the API, newest first; else derived from the event stream's fight ids.
function fightList(A,a,events){let L=[];
  try{if(typeof A.fights==='function')L=(A.fights(a,SHOWN)||[]).slice()}catch(e){L=[]}
  if(!L.length){const ids=[];for(const e of events)if(e.fight!=null&&!ids.includes(e.fight))ids.push(e.fight);
    L=ids.slice(-SHOWN).map(id=>{try{return typeof A.fightSummary==='function'?A.fightSummary(a,id):null}catch(e){return null}}).filter(Boolean)}
  return L.filter(f=>f&&f.id!=null).sort((x,y)=>(y.start||0)-(x.start||0)).slice(0,SHOWN)}

// One text line for an event.
function text(e){const n=e.name,t=e.target,w=e.who,x=num(e.amount),c=e.crit?' (crit)':'';
  switch(e.kind){
    case 'hit':return (n||'Hit')+(t?' on '+t:'')+': '+x+c;
    case 'hurt':return (w||'Something')+(n?' ('+n+')':'')+' hits you: '+x+c;
    case 'heal':return 'Heal'+(n?' ('+n+')':'')+(t?' on '+t:'')+': +'+x+c;
    case 'healed':return (w||'Someone')+(n?' ('+n+')':'')+' heals you: +'+x;
    case 'ability':return 'Ability: '+(n||'?')+(t?' on '+t:'')+(x?' ('+x+')':'');
    case 'passive':return 'Passive: '+(n||'?')+(x?' ('+x+')':'');
    case 'item':return 'Item: '+(n||'?')+(x?' ('+x+')':'');
    case 'miss':return 'Missed'+(t?' '+t:'');
    case 'dodge':return 'Dodged '+(w||'an attack');
    case 'block':return 'Blocked '+(w||'an attack');
    case 'kill':return 'Slew '+(t||n||'a foe');
    case 'death':return 'Fell'+(w?' to '+w:'');
    case 'flee':return 'Fled the fight';
    case 'xp':return '+'+x+' xp';
    case 'loot':return 'Loot: '+(n||'?');
    case 'level':return 'Reached level '+(n||x||'?');
    default:return (e.kind||'?')+(n?' '+n:'')}}
// Fold runs of the same plain hit, miss or hurt into one "×N" line.
function fold(list){const out=[];
  for(const e of list){const p=out[out.length-1];
    if(p&&!e.crit&&!p.e.crit&&(e.kind==='hit'||e.kind==='hurt'||e.kind==='miss')&&p.e.kind===e.kind&&p.e.name===e.name&&p.e.target===e.target&&p.e.who===e.who){p.n++;p.sum+=num(e.amount);p.last=e;continue}
    out.push({e,n:1,sum:num(e.amount),last:e})}
  return out}

function line(g,fid,i,color){const e=g.e,r=el('div','cbl cb-'+e.kind+(e.crit?' cb-crit':''));r.setAttribute('data-k','l'+fid+'-'+i);
  r.append(el('span','cbt',stamp(e.t).slice(-5)));
  let s=g.n>1?text({...e,amount:g.sum}).replace(/: (\+?)\d+$/,': $1'+g.sum)+' ×'+g.n:text(e);
  const m=el('span','cbx',s);if(e.kind==='ability'||e.kind==='passive')m.style.color=color;r.append(m);
  if(e.note)r.title=e.note;return r}

function card(f,evs,shownKinds,color,open){const d=el('details','cbcard cbres-'+String(f.result||'').toLowerCase().replace(/\W+/g,'-'));d.setAttribute('data-k','f'+f.id);if(open)d.setAttribute('open','');
  const s=el('summary');
  s.append(el('span','cbfoe','vs '+(f.foe||'?')),el('span','cbres',f.result||''),el('span','cbdim',span((f.end==null?f.start:f.end)-f.start)));
  const st=el('span','cbstats');
  st.append(el('span','cb-hit','dealt '+num(f.dealt)),el('span','cb-hurt','taken '+num(f.taken)));
  if(num(f.healed))st.append(el('span','cb-heal','healed '+num(f.healed)));
  s.append(st);
  const ab=counts(f.abilities),it=counts(f.items);
  if(ab||it||f.crits){const x=el('div','cbuse');
    if(ab){const q=el('span','cb-ability',ab);q.style.color=color;x.append(q)}
    if(it)x.append(el('span','cb-item',it));
    if(f.crits)x.append(el('b','cb-crit',f.crits+' crit'+(f.crits>1?'s':'')));s.append(x)}
  d.append(s);
  const list=evs.filter(e=>!shownKinds||shownKinds.has(e.kind));
  const rows=fold(list),lines=el('div','cblines');
  if(!rows.length)lines.append(el('div','cbdim','Nothing of this kind in this fight.'));
  const keep=rows.length>MAXLINES;
  rows.map((g,i)=>[g,i]).reverse().slice(0,MAXLINES).forEach(([g,i])=>lines.append(line(g,f.id,i,color)));
  if(keep)lines.append(el('div','cbdim','Older lines not shown.'));
  d.append(lines);return d}

function totals(evs,k){const T={dealt:0,taken:0,healed:0,abil:0,item:0,crits:0};
  for(const e of evs){const x=num(e.amount);
    if(e.kind==='hit')T.dealt+=x;else if(e.kind==='hurt')T.taken+=x;else if(e.kind==='heal'||e.kind==='healed')T.healed+=x;
    else if(e.kind==='ability'||e.kind==='passive')T.abil++;else if(e.kind==='item')T.item++;
    if(e.crit)T.crits++}
  const P={all:[['dealt',T.dealt],['taken',T.taken],['healed',T.healed],['abilities',T.abil],['items',T.item]],
    dmg:[['dealt',T.dealt],['taken',T.taken],['crits',T.crits]],abil:[['abilities used',T.abil]],item:[['items used',T.item]],heal:[['healed',T.healed]]};
  return P[k].map(([n,v])=>n+' '+v).join(' · ')}

function refresh(){const tb=document.getElementById('hero')&&document.getElementById('hero').querySelector('.tb');
  if(tb&&cur)patch(tb,b=>tabCombat(b,cur))}

export function tabCombat(b,a){cur=a;b.classList.add('cblog');
  const A=api();
  if(!A){b.append(el('div','meta','Combat log arrives with the next update.'));return}
  let events=[];try{events=(A.actionLog(a,{n:600})||[]).slice()}catch(e){events=[]}
  const fl=fightList(A,a,events);
  if(!fl.length){b.append(el('div','meta','No fights yet. Hits, abilities and items will be listed here.'));return}
  const bar=el('div','cbbar');bar.setAttribute('data-k','bar');bar.setAttribute('role','group');bar.setAttribute('aria-label','Filter the combat log');
  for(const [k,label] of FILTERS){const c=el('button','cbchip',label);c.type='button';c.setAttribute('data-k','c'+k);c.setAttribute('aria-pressed',String(filter===k));
    c.onclick=()=>{filter=k;refresh()};bar.append(c)}
  b.append(bar);
  const ids=new Set(fl.map(f=>f.id)),mine=events.filter(e=>ids.has(e.fight));
  const set=KINDSET[filter],tot=el('div','cbtot',totals(mine.filter(e=>!set||set.has(e.kind)),filter)+'  (last '+fl.length+' fight'+(fl.length>1?'s':'')+')');
  tot.setAttribute('data-k','tot');b.append(tot);
  const color=classColor(a.cls);
  fl.forEach((f,i)=>b.append(card(f,events.filter(e=>e.fight===f.id),set,color,i===0)))}
