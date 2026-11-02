// Specialisations (issue #82): the choice at level SPEC_LVL, for scripted and agent heroes. Owned by
// character-builder; the paths are data/classes.js SPECS, their abilities and passives rows of data/moves.js
// carrying spec:<id>. A hero stores plain data only: a.spec (the path id) and a.prof gains the path's skill.
// Scripted heroes choose the first time they fight at level 10 (sim/moves.js fightMoves), by trait leanings and
// by what their party lacks; an agent-played hero chooses with the choose_specialisation tool.
import {SPECS,CLASS_SPECS,SPEC_LVL} from '../data/classes.js';
import {log,gold} from './chronicle.js';
import {record} from './history.js';

export const specOf=a=>a&&a.spec&&SPECS[a.spec]&&SPECS[a.spec].cls===a.cls?SPECS[a.spec]:null;
export const specChoices=a=>(CLASS_SPECS[a.cls]||[]).map(id=>({id,...SPECS[id]}));
// Null when the hero may choose now, else the reason.
export function specBlock(a){if(!a||a.kind!=='hero'||!(a.lvl>0))return 'No such hero.';
  if(specOf(a))return 'You have already taken the path of the '+specOf(a).name+'.';
  if(a.lvl<SPEC_LVL)return 'Paths open at level '+SPEC_LVL+' (you are level '+a.lvl+').';
  if(a.state==='dead'||a.state==='ghost')return 'The dead choose no paths.';
  return null}

// Scripted choice: trait leanings, +1.5 for a role nobody in the party covers yet, ties by hero id.
export function pickSpec(a,mates=[]){
  const have=new Set();for(const b of mates)if(b!==a){const s=specOf(b);if(s)have.add(s.fills)}
  let best=null,bs=-1;
  for(const id of CLASS_SPECS[a.cls]||[]){const s=SPECS[id];let v=0;for(const t of a.traits||[])v+=s.lean[t]||0;
    if(!have.has(s.fills))v+=1.5;v+=((a.id||0)+id.length)%2*.1;
    if(v>bs){bs=v;best=id}}
  return best}

export function chooseSpec(a,id,{by}={}){const err=specBlock(a);if(err)return {ok:false,error:err};
  const s=SPECS[id];if(!s||s.cls!==a.cls)return {ok:false,error:'Not a path for a '+a.cls+'. Yours: '+specChoices(a).map(x=>x.name).join(', ')+'.'};
  a.spec=id;a.specAt=a.lvl;if(!a.prof)a.prof=[];if(!a.prof.includes(s.skill))a.prof.push(s.skill);
  record(a,'Took the path of the '+s.name+'.');
  log(a,' takes the path of the ',gold(s.name),by==='agent'?', by their own choice.':'.');
  return {ok:true,spec:s.name,text:'You take the path of the '+s.name+': '+s.desc}}

// Scripted heroes only: choose for a level-10 hero who has not. Returns true when it chose.
export function ensureSpec(a,mates){if(a.player||specBlock(a))return false;const id=pickSpec(a,mates);return !!id&&chooseSpec(a,id,{by:'script'}).ok}
