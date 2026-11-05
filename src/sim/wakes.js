// More turn triggers for agent-played heroes: XP, level ups, loot, quest progress. One module, one
// helper (`pend`) for the wake logic. Soft news (w=1) wakes after the runner's minimum gap; level ups,
// rare/epic drops and finished quests wake at once (w=2). No RNG and nothing for scripted heroes, so the
// scripted sim stays identical. Pending news (XP, loot, quest) is one event per hero, updated in place until
// the agent has read it.
import {MOVES,PASSIVES} from '../data/moves.js';
import {SPEC_LVL} from '../data/classes.js';
import {notify} from './notify.js';
import {growthWaiting} from './abilities.js';
import {GROWTH} from '../data/abilities.js';
import {foeName} from './lore.js'; // a creature is named only as the hero knows it (#188)

// Update the unread event stored under `key`, else post a new one.
function pend(a,key,text,wake){const P=a.playPend||(a.playPend={}),seen=a.playEvSeen||0,n=P[key];
  if(n>seen){const e=(a.playEv||[]).find(x=>x.n===n);if(e){e.text=String(text).slice(0,240);if(wake&&(e.w||0)<wake)e.w=wake;return}}
  notify(a,text,0,wake||1);const L=a.playEv;P[key]=L[L.length-1].n}

const list=o=>Object.entries(o).map(([k,v])=>v>1?k+' x'+v:k).join(', ');

// A kill is about to pay XP: remember its name for the bundled line.
const bundle=a=>{const X=a.playXp||(a.playXp={xp:0,kills:0,names:{}});
  if(X.n!=null&&X.n<=(a.playEvSeen||0)){X.xp=0;X.kills=0;X.names={};X.n=null} // the last one was read: start a new bundle
  return X};
export function wakeKill(a,m){if(!a.player)return;const X=bundle(a),nm=foeName(a,m).replace(/^an? /,'');X.kills++;X.names[nm]=(X.names[nm]||0)+1;
  if(m.elite)pend(a,'elite','You slew '+foeName(a,m)+'.',1)}

// XP gained: one bundled line since the hero's last read.
export function wakeXp(a,x,need){if(!a.player)return;const X=bundle(a);
  X.xp+=Math.round(x);
  const from=X.kills?' from '+X.kills+' kill'+(X.kills>1?'s':'')+' ('+list(X.names)+')':'';
  pend(a,'xp','+'+X.xp+' XP'+from+(a.lvl<20?'; '+Math.max(0,need-a.xp)+' XP to advance':''),1);
  X.n=a.playPend.xp}

// What a level opens: abilities, passives, the specialisation choice.
export function wakeLevelUp(a,maxhp){if(!a.player)return;const L=a.lvl,un=[];
  for(const m of Object.values(MOVES))if(m.cls===a.cls&&!m.spec&&m.lvl===L)un.push('ability '+m.name);
  for(const p of Object.values(PASSIVES))if(p.cls===a.cls&&!p.spec&&p.lvl===L)un.push('passive '+p.name);
  if(L===SPEC_LVL)un.push('a specialisation path is open: choose one with choose_specialisation');
  const g=growthWaiting(a);if(g&&g.lvl===L)un.push('a score point to place: raise_score {score, why} (brawn, reflex, grit, wits, insight or presence; the class default follows if you wait '+GROWTH.HOLD+' game hours)');
  notify(a,'LEVEL UP: you are level '+L+', HP '+maxhp+(un.length?'. Unlocked: '+un.join('; '):''),0,2)}

export function wakeQuest(a,done){if(!a.player||!a.quest)return;pend(a,'quest','Quest progress: '+a.quest.have+' of '+a.quest.need+' '+(a.quest.type||'')+(done?' - ready to turn in':''),1)}
export function wakeQuestDone(a,name,gold){notify(a,'Quest completed: '+name+(gold?' ('+gold+'g)':''),0,2)} // an oath or a scene pays no gold

// Loot: gear and goods bundled; a rare or epic wakes at once.
export function wakeLoot(a,name,quality){if(!a.player)return;
  if(quality==='rare'||quality==='epic'){notify(a,'Rare loot: '+name+' ('+quality+')',0,2);return}
  const K=a.playLoot&&a.playLoot.n>(a.playEvSeen||0)?a.playLoot:(a.playLoot={n:0,items:{}});
  K.items[name]=(K.items[name]||0)+1;pend(a,'loot','Picked up: '+list(K.items),1);K.n=a.playPend.loot}
