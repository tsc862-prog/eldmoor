// Professions on the dossier Stats tab (issue #259, epic #238): each held profession with its kind (gather or
// craft), skill 1-100 as a bar and the band name. Read-only DOM from sim/professions.js; the panel rebuilds on
// its own timer, so nothing here keeps state. Second half: under each trade a line of what it works or makes (what it takes,
// what is in sight, which recipes are ready from the pack, the next step), the last craft and the supper meal on its way out.
import {worldFill} from '../world/words.js';
import {professionsOf,skillBand} from '../sim/professions.js';
import {PROF,SKILL_MAX} from '../data/professions.js';
import {MATERIALS,USES} from '../data/items.js';
import {RECIPES} from '../data/recipes.js';
import {S} from '../sim/state.js';
import {KIND_OF,bandFloor} from '../sim/gather.js';
import {canCraft,mealOn} from '../sim/craft.js';
import {nodeNear,nodeById,isReady} from '../sim/nodes.js';

const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
export const BAND_NAME=['Novice','Apprentice','Journeyman','Expert','Master'];
// skillBand: 0 = 1-24, 1 = 25-49, 2 = 50-74, 3 = 75-99, 4 = 100.
export const bandName=skill=>BAND_NAME[skillBand(skill)];
export const KIND_TEXT={gather:'gathering',craft:'crafting'};

const WORK={herb:'herb patches',ore:'ore veins',hide:'game trails',fish:'fishing spots'};
const SIGHT=10; // tiles: about what a hero sees on foot
const matsOf=kind=>Object.keys(MATERIALS).filter(n=>MATERIALS[n].kind===kind).sort((x,y)=>MATERIALS[x].band-MATERIALS[y].band);
const chip=(t,cls,tip)=>{const c=el('span','pchip'+(cls?' '+cls:''),t);if(tip)c.title=tip;return c};
export function mealLeft(m){const n=Math.max(1,Math.round((m.until-S.gameMin)/10)*10);return n>=60?Math.floor(n/60)+' h'+(n%60?' '+n%60+' min':''):n+' min'}
// What a gathering trade works: the materials it can take now, one it can only stretch for, the next step, and nodes in sight.
function gatherLine(a,p){const d=el('div','profd'),k=KIND_OF[p.id],hb=skillBand(Math.max(1,p.skill)),L=matsOf(k);
  d.append(el('span','dm','Works '+(WORK[k]||k)+'. Takes '));
  const own=L.filter(m=>MATERIALS[m].band<=hb),str=L.find(m=>MATERIALS[m].band===hb+1),nxt=L.find(m=>MATERIALS[m].band>hb+1);
  own.forEach((m,i)=>{if(i)d.append(', ');d.append(chip(m,'ok','Sells for about '+Math.round(MATERIALS[m].base)+'g'))});
  if(str)d.append(own.length?'; ':'',chip(str,'str','A stretch: about 45% a try'));
  if(nxt)d.append(el('span','dm',' · '+nxt+' at skill '+bandFloor(MATERIALS[nxt].band-1)));
  const N=nodeNear(a.x,a.y,SIGHT,k),rdy=N.filter(isReady).length;
  d.append(el('span','dm',' · '+(N.length?rdy+' ready, '+(N.length-rdy)+' spent in sight':'none in sight')));
  const g=a.gathering&&nodeById(a.gathering.node);if(g&&g.kind===k)d.append(' ',chip('working a '+g.name.toLowerCase(),'now'));
  return d}
// What a crafting trade makes: recipes in band (green when the pack has the materials and gold now), then the next one.
function craftLine(a,p){const d=el('div','profd'),hb=skillBand(Math.max(1,p.skill)),L=RECIPES.filter(r=>r.prof===p.id).sort((x,y)=>x.band-y.band);
  d.append(el('span','dm','Makes '));
  const own=L.filter(r=>r.band<=hb);
  own.forEach((r,i)=>{if(i)d.append(', ');const c=canCraft(a,r,{where:'town'}),tip=r.inputs.map(x=>x.id+' x'+x.n).join(', ')+' + '+r.gold+'g'+(c.ok?'':' · '+c.why);
    d.append(chip(r.out.id,c.ok?'ok':'',tip))});
  const nx=L.find(r=>r.band>hb);if(nx)d.append(el('span','dm',(own.length?' · ':'')+nx.out.id+' at skill '+bandFloor(nx.band)));
  const last=(a.history||[]).slice().reverse().find(h=>/^Made /.test(h.text));
  if(last)d.append(el('div','dm profl','Last: '+last.text.replace(/\s*\([A-Za-z]+ \d+\)\.?$/,'')+' · '+last.t));
  return d}
export function professionBlock(node,a,{title=true}={}){
  if(title)node.append(el('div','sec','Professions'));
  const ml=mealOn(a);
  if(ml){const U=USES[ml.id],m=el('div','profmeal');m.append(el('span','dm','Supper: '),el('span','qf',ml.id||'a meal'),' +'+Math.round(ml.v*100)+'% '+ml.stat,el('span','dm',' · '+mealLeft(ml)+' left'));
    if(U)m.title=worldFill(U.flavour||'');node.append(m)}
  const rows=professionsOf(a);
  if(!rows.length){node.append(el('div','dm profnone','No professions yet'));return null}
  const box=el('div','profs');
  for(const r of rows){const row=el('div','prof '+r.kind),p=PROF[r.id];
    row.title=(p?p.blurb+' ':'')+'Skill '+r.skill+' of '+SKILL_MAX+'.';
    const bar=el('span','profbar');const i=document.createElement('i');i.style.width=Math.max(1,Math.round(100*r.skill/SKILL_MAX))+'%';bar.append(i);
    row.append(el('span','profn',r.name),el('span','profk dm',KIND_TEXT[r.kind]||r.kind),bar,el('span','profs-n',r.skill+' · '+bandName(r.skill)));
    box.append(row,r.kind==='gather'?gatherLine(a,r):craftLine(a,r))}
  node.append(box);return box}
