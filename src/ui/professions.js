// Professions on the dossier Stats tab (issue #259, epic #238): each held profession with its kind (gather or
// craft), skill 1-100 as a bar and the band name. Read-only DOM from sim/professions.js; the panel rebuilds on
// its own timer, so nothing here keeps state. Crafted items, recipes and gathering come with #257/#258.
import {professionsOf,skillBand} from '../sim/professions.js';
import {PROF,SKILL_MAX} from '../data/professions.js';

const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
export const BAND_NAME=['Novice','Apprentice','Journeyman','Expert','Master'];
// skillBand: 0 = 1-24, 1 = 25-49, 2 = 50-74, 3 = 75-99, 4 = 100.
export const bandName=skill=>BAND_NAME[skillBand(skill)];
export const KIND_TEXT={gather:'gathering',craft:'crafting'};

export function professionBlock(node,a,{title=true}={}){
  if(title)node.append(el('div','sec','Professions'));
  const rows=professionsOf(a);
  if(!rows.length){node.append(el('div','dm profnone','No professions yet'));return null}
  const box=el('div','profs');
  for(const r of rows){const row=el('div','prof '+r.kind),p=PROF[r.id];
    row.title=(p?p.blurb+' ':'')+'Skill '+r.skill+' of '+SKILL_MAX+'.';
    const bar=el('span','profbar');const i=document.createElement('i');i.style.width=Math.max(1,Math.round(100*r.skill/SKILL_MAX))+'%';bar.append(i);
    row.append(el('span','profn',r.name),el('span','profk dm',KIND_TEXT[r.kind]||r.kind),bar,el('span','profs-n',r.skill+' · '+bandName(r.skill)));
    box.append(row)}
  node.append(box);return box}
