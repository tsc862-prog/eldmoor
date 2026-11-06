// Wounds and tending (#656, epic #626 owner answer 4). Owned by ai-designer; the numbers are WOUND in sim/wounds.js.
// Every downing leaves a wound on any hero, scripted or agent: less max HP and less speed for WOUND.DAYS game days (sim/stats.js
// applies both, moveTo the walk). A wound closes by itself; it comes a day sooner, once a game day, when someone else tends it:
// a heal-class ability landing on the hero (healOne, the class's heal moves, the Table and crawl heal) or the tend action at a
// company camp. The chapel priest takes a day off for gold, once a game day, on top of that. No dice in here: the shared rng is
// untouched. Nothing here touches life: a wound dies with the hero (fall), and no tending lifts a hero or undoes a death.
// Background heroes act on it through scripted rules: heroes.js (the chapel on a town visit, state 'mend' at WOUND.MEND_AT
// wounds, smaller prey), dungeon.js (no Crypt). Agent heroes hear of it in words and decide for themselves; autopilot and the
// gambit presets know nothing of wounds. On an agent hero the creature that did it is learned as feared (lore.js woundFear),
// the record line below is the landmark (tiers.js RX) and the reflection moment is kind 'wound'.
import {S,dayNo,ownTown,sameSide,loreSides} from './state.js';
import {CITY,dist} from '../world/map.js';
import {record} from './history.js';
import {log} from './chronicle.js';
import {pop} from './effects.js';
import {notify} from './notify.js';
import {moment} from './reflect.js';
import {woundFear} from './lore.js';
import {combatStats} from './stats.js';
import {reflexMay} from './runlink.js';
import {homeOf} from '../data/races.js';
import {WOUND,wounded,woundEnd} from './wounds.js';

const W=WOUND;
const stats=()=>S.woundStats||(S.woundStats={taken:0,closed:0,tended:0,priest:0,gold:0});
export const woundStats=()=>stats();
const left=w=>Math.max(0,woundEnd(w)-S.gameMin);
const daysWord=m=>{const d=m/W.MIN_DAY;return d>=1.5?'about '+Math.round(d)+' days':d>=.75?'about a day':'less than a day'};

// ---- taking one (sim/downed.js goDown, crawlDown) ----
// cause: the words for who or what did it ("a Bristleback Boar", "Kragmaw", a hero's name). foe: the blow's source, for lore.
export function takeWound(a,cause,foe){const L=a.wounds||(a.wounds=[]),c=String(cause||'a foe');
  L.push({cause:c,day:dayNo(),days:W.DAYS,at:Math.round(S.gameMin)});stats().taken++;
  a.hp=Math.min(a.hp,combatStats(a).health); // never above the lower max; a downing is at zero anyway
  record(a,'Took a lasting wound from '+c+'.'); // the landmark (sim/tiers.js RX)
  notify(a,'The blow from '+c+' leaves a wound that will not close for days: while it lasts you have less health and you walk and swing slower.',1);
  woundFear(a,foe);
  moment(a,'wound','from '+c)}

// ---- closing by itself (sim/index.js, every step) ----
export function woundTick(){for(const a of S.agents){if(!wounded(a)||a.state==='dead')continue;
  for(let i=a.wounds.length-1;i>=0;i--)if(left(a.wounds[i])<=0)closeWound(a,i)}}
function closeWound(a,i){const w=a.wounds.splice(i,1)[0];stats().closed++;
  record(a,'The wound from '+w.cause+' closed.');notify(a,'The wound from '+w.cause+' has closed.',1)}

// ---- a day off ----
// The wound nearest to closing goes first: it gives the hero back the most, soonest.
function dayOff(t){let k=0;for(let i=1;i<t.wounds.length;i++)if(woundEnd(t.wounds[i])<woundEnd(t.wounds[k]))k=i;
  const w=t.wounds[k];w.days--;if(left(w)<=0)closeWound(t,k);return w}
// Why by may not tend t now, or null. Nobody tends their own wound; the downed need saving first; one tending a game day.
export function tendBlock(by,t){if(!wounded(t))return t.name+' carries no wound.';if(by===t)return 'You cannot dress your own wound: a companion must, or the chapel priest in town (chapel_tend).';
  if(t.state==='dead'||t.state==='downed')return t.name+' is past tending now.';if(!sameSide(t,by))return t.name+' is no friend of yours.';
  if(t.tendDay===dayNo())return t.name+'\'s wound has been tended today; the next can come tomorrow.';return null}
// how: 'heal' (a heal-class ability landed on t) or 'camp' (the tend action at a camp). Returns true when a day came off.
export function tendBy(by,t,how){if(tendBlock(by,t))return false;t.tendDay=dayNo();stats().tended++;const w=dayOff(t);
  pop(t.x,t.y-.8,'TENDED','#9ad0ff');
  record(t,'Had the wound from '+w.cause+' tended by ',by,how==='camp'?' at the fire.':'.');
  notify(t,by.name+' tends the wound from '+w.cause+': it will close a day sooner.',1);
  if(t.company!=null)log(by,' tended the wound of ',t,how==='camp'?' at the fire.':'.');
  return true}
// A wounded companion a scripted healer may spend a heal on while nothing presses (heroes.js priestHeal), or null.
export function woundedMate(a,list){for(const b of list)if(b!==a&&dist(a,b)<=4&&!tendBlock(a,b))return b;return null}
// Supper at a company camp (sim/camp.js): a member played by reflex tends whoever it can. An agent decides for itself, so it is told.
export function campTend(L){for(const a of L){if(reflexMay(a)){for(const t of L)tendBy(a,t,'camp');continue}
  const w=L.filter(t=>!tendBlock(a,t));if(w.length)notify(a,w.map(t=>t.name).join(' and ')+(w.length>1?' carry':' carries')+' a wound that wants tending: tend {who} here at the fire takes a day off it.',1)}}

// ---- the chapel priest ----
export const priestFee=a=>W.FEE+W.FEE_LVL*a.lvl;
const priestOf=c=>(S.npcs||[]).find(p=>p.role==='priest'&&p.town===c.name)||null;
function paid(payer,t,c,p){const fee=priestFee(t);payer.gold-=fee;t.chapelDay=dayNo();const st=stats();st.priest++;st.gold+=fee;const w=dayOff(t);
  record(t,'Paid the '+p.title.toLowerCase()+' of '+c.name+' to dress the wound from '+w.cause+'.');
  if(t.company!=null)log(t,' had a wound dressed at the ',c.name,' chapel.');return {fee,w}}
// A scripted hero on its town visit (heroes.js sellAndShop): the home town's priest, if it has the gold. An agent decides for itself.
export function chapelVisit(a){if(!wounded(a)||!reflexMay(a)||a.chapelDay===dayNo()||a.gold<priestFee(a))return;
  const c=homeOf(a),p=c&&priestOf(c);if(p)paid(a,a,c,p)}
// The chapel_tend tool (sim/player.js): payer stands at a chapel of their side and pays for t. -> {ok, ...} or {error}.
export function chapelTend(payer,t){const c=CITY.find(x=>ownTown(x,payer)&&x.spots&&x.spots.chapel&&dist(payer,x.spots.chapel)<=W.CHAPEL_R),p=c&&priestOf(c);
  if(!p)return {error:'The priest is at the chapel of a town'+(loreSides()?'':' of your side')+': walk there first (move_to chapel).'};
  if(!wounded(t))return {error:(t===payer?'You carry':t.name+' carries')+' no wound.'};
  if(t!==payer&&dist(payer,t)>W.NEAR)return {error:t.name+' must stand with you at the chapel.'};
  if(t.chapelDay===dayNo())return {error:p.title+' '+p.name+' has dressed that wound today; come back tomorrow.'};
  const fee=priestFee(t);if(payer.gold<fee)return {error:p.title+' '+p.name+' asks '+fee+' gold; you have '+payer.gold+'.'};
  const r=paid(payer,t,c,p);
  return {ok:true,paid:r.fee,gold:payer.gold,result:p.title+' '+p.name+' dresses the wound from '+r.w.cause+': it will close a day sooner.',wounds:woundsView(t)}}

// ---- in words ----
export const woundsView=a=>wounded(a)?a.wounds.map(w=>({from:w.cause,closes_in:daysWord(left(w))})):[];
// The turn header's line (sim/pace.js brief.wounds), null when whole.
export function woundLine(a){if(!wounded(a))return null;const L=woundsView(a);
  return 'You carry '+(L.length>1?L.length+' wounds':'a wound')+' ('+L.map(w=>'from '+w.from+', closes in '+w.closes_in).join('; ')+'): less health, and you walk and swing slower. A companion\'s heal, tend at a camp, or the chapel priest (chapel_tend) takes a day off'}
// What anyone who looks at the hero sees.
export const woundLook=a=>wounded(a)?(a.wounds.length>1?'moving stiffly, badly wounded':'favouring a wound'):null;
// The DM's member views: how long until the hero is whole.
export const woundSpanWord=a=>wounded(a)?daysWord(Math.max(...a.wounds.map(left))):null;
// A loaded hero: a.wounds is always a clean list (an old save has none, #656).
export function normalizeWounds(a){if(!Array.isArray(a.wounds)){a.wounds=[];return}
  a.wounds=a.wounds.filter(w=>w&&typeof w==='object'&&Number.isFinite(w.days)&&Number.isFinite(w.at)).map(w=>({cause:String(w.cause||'a foe'),day:Number(w.day)||1,days:w.days,at:w.at}))}
