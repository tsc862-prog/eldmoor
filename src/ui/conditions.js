// Region conditions (issue #366): the running region conditions and world events (S.conditions) in the World
// panels, one row each: kind, region, strength, game time left and who started it (the watcher may see that).
// Conditions in a region the Fellowship rides (dmfocus.js focus(): the regions it is in or has a job in, plus each
// living member's own region) sort first and carry "on your road" (Fellowship first). Read-only over S; built once,
// then patched in place (stable.js), and only when the rows' text changes.
import {S} from '../sim/index.js';
import {CONDITIONS} from '../sim/levers.js';
import {focus} from '../sim/dmfocus.js';
import {ZONES,zoneAt} from '../world/map.js';
import {patch} from './stable.js';

const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
const DAY=1440;
const BY={scripted:'scripted DM','dm-agent':'DM agent',model:'DM model',agent:'an agent'};
const cap=s=>s?s[0].toUpperCase()+s.slice(1):s;

// The regions the Fellowship rides: focus() zones and region, else (all in town) each living member's region.
export function roadZones(){const f=focus(),out=new Set();if(!f)return out;
  for(const z of f.zones)out.add(z);if(f.zone!=null)out.add(f.zone);
  for(const a of f.members||[]){const z=zoneAt(a.x,a.y);if(z>=0)out.add(z)}
  return out}

export const leftText=m=>{m=Math.max(0,m);if(m>=DAY){const d=Math.floor(m/DAY);return d+' game day'+(d===1?'':'s')+' left'}
  const h=Math.max(1,Math.ceil(m/60));return h+' game hour'+(h===1?'':'s')+' left'};

// Rows for the watcher: {id, kind, label, col, about, region, str, left, road, event, by}, the Fellowship's road first.
export function conditionRows(){const road=roadZones(),act=S.levers&&S.levers.active||[];
  const rows=(S.conditions||[]).map(c=>{const def=CONDITIONS[c.kind]||{},rec=act.find(r=>r.id===c.lever)||null;
    const event=!!(rec&&rec.name==='start_event'),ek=event&&rec.params&&rec.params.kind;
    return {id:c.id,kind:c.kind,label:event&&ek?cap(String(ek)):def.label||cap(String(c.kind)),col:def.col||'#9aa8b8',about:def.about||'',
      region:ZONES[c.z]!=null?ZONES[c.z]:'region '+c.z,str:c.str|0,left:(c.until||0)-S.gameMin,road:road.has(c.z),event,
      by:rec?BY[rec.by]||String(rec.by||'unknown'):null}});
  return rows.sort((x,y)=>(y.road?1:0)-(x.road?1:0)||x.left-y.left||x.id-y.id)}

const meta=r=>['strength '+r.str+' of 3',leftText(r.left),(r.event?'world event':'condition')+(r.by?' by '+r.by:'')].join(' · ');

// The section lives in the side column like every world panel (data-o for the plain layout, data-world for the
// World group); built once, before the layout first sorts the panels.
let sec=null,box=null,seen=null;
export function mountConditions(){if(sec||typeof document==='undefined')return sec;const side=$('side');if(!side)return null;
  sec=el('section','panel condsec');sec.id='condSec';sec.setAttribute('data-o','2.5');sec.setAttribute('data-world','1.5');
  box=el('details','tlbox');box.id='condbox';box.open=true;box.append(el('summary',null,'Region conditions'));
  sec.append(box);const g=$('worldgrp');side.insertBefore(sec,g&&g.parentNode===side?g:null);
  const ws=document.querySelector('#worldgrp .wsub');if(ws&&!/conditions/.test(ws.textContent))ws.textContent=ws.textContent.replace(/^Factions, /,'Factions, region conditions, ');
  return sec}

export function renderConditions(){if(!mountConditions())return;const L=conditionRows();
  const sig=L.map(r=>r.id+':'+r.label+':'+r.region+':'+r.road+':'+meta(r)).join('~');if(sig===seen)return;
  const ok=patch(box,n=>{n.append(el('summary',null,'Region conditions'+(L.length?' ('+L.length+')':'')));
    if(!L.length){n.append(el('div','dm condnone','No region conditions.'));return}
    const ul=el('ul','tlist condlist');
    for(const r of L){const li=el('li',r.road?'condrow road':'condrow');li.setAttribute('data-k','c'+r.id);if(r.about)li.title=r.label+': '+r.about;
      const top=el('div','condtop'),sw=el('span','condsw');sw.style.background=r.col;sw.setAttribute('aria-hidden','true');
      top.append(sw,el('span','condkind',r.label),el('span','condreg',r.region));if(r.road)top.append(el('span','condroad','on your road'));
      li.append(top,el('div','dm condmeta',meta(r)));ul.append(li)}
    n.append(ul)});
  if(ok!==false)seen=sig}
