// Class abilities on the dossier Stats tab and the Fellowship sheet (issue #81). Read-only DOM built from
// sim/moves.js abilityView: a chip per active ability (kind-coloured, cooldown shown while it recharges,
// greyed until learned) and the passives, each with a tooltip like the items'. The panel rebuilds on a
// timer, so nothing here keeps state.
import {abilityView,abilityLine} from '../sim/moves.js';
import {KIND_COLOR,MOVES} from '../data/moves.js';
import {effOn,effLeft} from '../sim/eff.js';

const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
const GLYPH={attack:'A',heal:'H',buff:'B',control:'C',defend:'D',move:'M',passive:'P'};

// node: where to append. a: the hero. Returns the grid element (or null for a class without abilities).
export function abilityBlock(node,a,{title=true}={}){const rows=abilityView(a);if(!rows.length)return null;
  const box=el('div','abils');if(title)node.append(el('div','sec','Abilities'));
  for(const r of rows){const on=r.learned,row=el('div','ab'+(on?'':' off')+(r.type==='passive'?' pas':''));
    row.title=abilityLine(r);
    const g=el('span','abi',GLYPH[r.kind]||'?');g.style.background=KIND_COLOR[r.kind]||'#8a8e9c';
    const left=r.type==='move'&&on?r.left:0;
    row.append(g,el('span','abn',r.name),el('span','abr dm',r.type==='passive'?(on?'passive':'L'+r.lvl):!on?'L'+r.lvl:left>0?left.toFixed(0)+'s':'ready'));
    if(left>0){const m=el('span','abcd');const i=document.createElement('i');i.style.width=Math.round(100*left/r.cd)+'%';m.append(i);row.append(m)}
    box.append(row)}
  node.append(box);
  const last=(a.moveLog||[]).slice(-1)[0];if(last)node.append(el('div','dm',last.t+' '+last.text));
  return box}

// Timed ward on a member (frames, #336): the 'taken' effect set by a ward move, named by the move whose fx.taken is its
// value (Antler Ward 4s; a Table ward counts rounds: "Antler Ward 2 rds"). Passives such as Barkskin never expire, so no chip.
export function effectChips(a){const out=[];if(!a||!a.eff||!effOn(a,'taken')||!(a.eff.taken.v<1))return out;
  const f=a.eff.taken,m=Object.values(MOVES).find(x=>x.fx&&x.fx.taken===f.v&&x.kind==='defend');
  const left=effLeft(a,'taken'),t=(m?m.name:'Warded')+' '+(left>0?Math.ceil(left)+'s':f.r+(f.r===1?' rd':' rds'));
  out.push({t,c:'good',title:m?m.desc:'Blows on them land lighter.'});return out}
