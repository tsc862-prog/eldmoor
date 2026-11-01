// "Minds at play" panel: every hero currently played by a language model (the AI
// toggle, a.brain) or by an agent (a.player), with status and their latest decision.
// Names are clickable .hn spans; panels.js owns the delegated click that follows them.
// Rebuilds only when the set of minds or a shown value changes.
import {S} from '../sim/index.js';
import {brainStatus} from '../sim/brain.js';

const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
let list=null,count=null,lastKey='';

export const isMind=a=>!!a&&a.state!=='dead'&&(a.brain||a.player);
const OUT={applied:'ok',rejected:'bad',late:'dim',offline:'dim',superseded:'dim',overruled:'warn',pending:'dim'};
const KIND={townPlan:'Town plan',fightOrFlee:'Fight or flee',say:'Says',cryptCall:'Crypt call'};

function latest(a){
  if(a.player&&a.playLog&&a.playLog.length){const c=a.playLog[0];return {t:c.t,kind:'Agent',what:c.tool+(c.args?' '+c.args:''),outcome:c.pending?'pending':c.ok?'applied':'rejected'}} // agent player: its latest tool call (sim/player.js)
  const m=a.mind&&a.mind[0];if(!m)return null;
  const what=m.kind==='say'?(m.line?'“'+m.line+'”':'a line'):(m.choice?'chose '+m.choice:(m.outcome==='pending'?'thinking…':m.outcome));
  return {t:m.t,kind:KIND[m.kind]||m.kind,what,outcome:m.outcome}}

export function renderMinds(){if(!list)return;
  const minds=S.agents.filter(isMind).sort((x,y)=>y.lvl-x.lvl||x.id-y.id);
  const rows=minds.map(a=>{const st=a.player?'agent':brainStatus(a),l=latest(a);
    return {a,st,l,key:[a.id,a.lvl,st,a.state,l&&l.t,l&&l.outcome,l&&l.what].join('|')}});
  const key=rows.map(r=>r.key).join(';');
  if(key===lastKey)return;lastKey=key;
  count.textContent=String(minds.length);
  list.replaceChildren();
  if(!minds.length){list.append(el('li','mempty','No hero is AI-played right now. Select a hero of level 7 or higher and click the AI button by their name.'));return}
  for(const {a,st,l} of rows){
    const li=el('li','mind');
    const top=el('div','mtop');
    const n=el('span','hn f'+a.fac,a.name);n.dataset.hid=a.id;
    const tag=el('span','mtag '+st,st==='agent'?'AGENT':st==='offline'?'QUIET':'AI');
    if(st==='offline')tag.title='The relay is not answering; scripted rules are playing this hero for now.';
    top.append(n,el('span','mlvl','Lv '+a.lvl+' '+a.cls),tag);
    li.append(top);
    if(l){const d=el('div','mlast');d.append(el('span','mt',l.t+' · '+l.kind+' · '),el('span','mo '+(OUT[l.outcome]||'dim'),l.what));li.append(d)}
    else li.append(el('div','mlast','No decisions asked yet.'));
    list.append(li)}
}

export function initMinds(){list=document.getElementById('minds');count=document.getElementById('mindsCount');renderMinds()}
