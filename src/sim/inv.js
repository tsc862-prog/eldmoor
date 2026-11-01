// Hero inventory (issue #124): the pack a hero carries, a.inv = {cap?, pack?, list:[entry]}. DOM-free.
// Replaces the old trade-goods `bag`. Gold stays on the hero. An entry is one slot:
//   gear    an item object (it has a slot): spares, upgrades for a companion, pieces too high to wear yet
//   stack   {kind:'good'|'use'|'quest', id, n, adv?}: trade goods (data/items GOODS), consumables
//           (data/items USES) and quest items (never sold, never given; an adventure's carried object)
// Everything a consumable does comes from the USES table in data/items.js, which the tooltips print.
// Heroes use their own consumables by rule (drink in a fight before fleeing, bind wounds after, eat at
// camp, read a scroll when desperate), buy supplies in town, and pass spare gear to a party member it
// suits. Agent tools and Table mode go through useItem / giveItem / equipSpare below.
// Owned by creature-designer.
import {rnd} from '../core/rng.js';
import {INV,USES,GOODS,price} from '../data/items.js';
import {tm} from '../data/traits.js';
import {S} from './state.js';
import {pop} from './effects.js';
import {combatStats} from './stats.js';
import {nearMobs} from './spatial.js';
import {dist} from '../world/map.js';
import {partyMates} from './party.js';
import {SELL_VALUE,equip} from './gear.js';
import {record} from './history.js';

export const GIVE_RANGE=4;     // tiles between giver and receiver
const FIGHT=['fight','duel','assist','raid'];
const stat=k=>{const s=S.invStats||(S.invStats={drunk:0,bound:0,ate:0,lit:0,cured:0,read:0,bought:0,found:0,passed:0,given:0,equipped:0});s[k]=(s[k]||0)+1};
const maxHp=a=>combatStats(a).health;

// ---- the pack ----
export const newInv=()=>({list:[]});
export const invOf=a=>a.inv||(a.inv=newInv());
export const isGear=e=>!!(e&&typeof e==='object'&&e.slot);
export const kindOf=e=>isGear(e)?'gear':e.kind;
export const capOf=a=>INV.BASE+(a.inv&&a.inv.pack?USES["Wayfarer's Pack"].slots:0);
export const used=a=>invOf(a).list.length;
export const room=a=>capOf(a)-used(a);
// Trade goods and spare gear carried, counted per unit: the figure the old bag-full rule read.
export const load=a=>{let n=0;for(const e of invOf(a).list)n+=isGear(e)?1:e.kind==='good'?e.n:0;return n};
export const count=(a,id)=>{let n=0;for(const e of invOf(a).list)if(!isGear(e)&&e.id===id)n+=e.n;return n};
export const has=(a,id)=>count(a,id)>0;
export const spares=a=>invOf(a).list.filter(isGear);
// Consumable units of a kind ('potion', 'bandage', ...) carried.
export const countKind=(a,kind)=>{let n=0;for(const e of invOf(a).list)if(e.kind==='use'&&USES[e.id]&&USES[e.id].kind===kind)n+=e.n;return n};
export const bestUse=(a,kind)=>{let best=null;for(const e of invOf(a).list)if(e.kind==='use'&&e.n>0&&USES[e.id]&&USES[e.id].kind===kind&&(!best||(USES[e.id].heal||0)>(USES[best].heal||0)))best=e.id;return best};

function stackAdd(a,kind,id,n,extra){const L=invOf(a).list;let left=n;
  for(const e of L)if(e.kind===kind&&e.id===id&&(!extra||e.adv===extra.adv)&&e.n<INV.STACK){const t=Math.min(left,INV.STACK-e.n);e.n+=t;left-=t;if(!left)return n}
  while(left>0&&(room(a)>0||kind==='quest')){const t=Math.min(left,INV.STACK);L.push({kind,id,n:t,...extra});left-=t}
  return n-left}
// Each returns how many units fit. Quest items always fit.
export const addGood=(a,id,n=1)=>stackAdd(a,'good',id,n);
export const addUse=(a,id,n=1)=>stackAdd(a,'use',id,n);
export const addQuest=(a,id,adv=null)=>stackAdd(a,'quest',id,1,{adv});
// A piece of gear into a free slot; a full pack sells it on the spot (true when it was kept).
export function addGear(a,it){if(room(a)>0){invOf(a).list.push(it);return true}a.gold+=SELL_VALUE(it);return false}
export function take(a,kind,id,n=1){const L=invOf(a).list;let left=n;
  for(let i=L.length-1;i>=0&&left>0;i--){const e=L[i];if(isGear(e)||e.kind!==kind||e.id!==id)continue;const t=Math.min(left,e.n);e.n-=t;left-=t;if(e.n<=0)L.splice(i,1)}
  return n-left}
export const questItems=a=>invOf(a).list.filter(e=>e.kind==='quest');
export const hasQuestFor=(a,adv)=>invOf(a).list.some(e=>e.kind==='quest'&&e.adv===adv);
export const dropQuest=(a,adv)=>{const L=invOf(a).list;for(let i=L.length-1;i>=0;i--)if(L[i].kind==='quest'&&L[i].adv===adv)L.splice(i,1)};

// Save migration (v5 -> v6): the old bag held trade-good names and gear objects.
export function convertBag(a){const inv=newInv();
  for(const it of a.bag||[]){if(isGear(it)){if(!it.cls&&!it.epic)it.cls=a.cls;inv.list.push(it)}
    else if(typeof it==='string'){const e=inv.list.find(x=>x.kind==='good'&&x.id===it&&x.n<INV.STACK);if(e)e.n++;else inv.list.push({kind:'good',id:it,n:1})}}
  a.inv=inv;delete a.bag;return inv}

// ---- selling ----
// Town: sell trade goods and every spare piece except up to KEEP_SPARES that are still too high to wear.
// Returns {gold, goods, n} and removes what was sold. Consumables and quest items stay.
export function sellLoot(a){const inv=invOf(a);let gold=0,goods=0,n=0;
  const keep=inv.list.filter(e=>isGear(e)&&e.ilvl>a.lvl+INV.WEAR_OVER&&(!e.cls||e.cls===a.cls)).sort((x,y)=>y.ilvl-x.ilvl).slice(0,INV.KEEP_SPARES);
  inv.list=inv.list.filter(e=>{
    if(isGear(e)){if(keep.includes(e))return true;gold+=SELL_VALUE(e);n++;return false}
    if(e.kind==='good'&&GOODS[e.id]){for(let i=0;i<e.n;i++){gold+=price(e.id);GOODS[e.id].supply++}goods+=e.n;n+=e.n;return false}
    return true});
  return {gold,goods,n}}
// One entry by index (agent tool): returns gold, or -1 when it cannot be sold.
export function sellEntry(a,i){const L=invOf(a).list,e=L[i];if(!e)return -1;
  if(isGear(e)){L.splice(i,1);return SELL_VALUE(e)}
  if(e.kind==='good'&&GOODS[e.id]){let g=0;for(let k=0;k<e.n;k++){g+=price(e.id);GOODS[e.id].supply++}L.splice(i,1);return g}
  return -1}

// ---- wearing spares ----
export const wearable=(a,it)=>isGear(it)&&(!it.cls||it.cls===a.cls||it.epic)&&it.ilvl<=a.lvl+INV.WEAR_OVER;
// Wear a spare (by entry); what it replaces goes back into the pack. Returns the replaced piece or false.
export function equipSpare(a,it){const L=invOf(a).list,i=L.indexOf(it);if(i<0)return false;
  L.splice(i,1);const old=equip(a,it);if(old)addGear(a,old);stat('equipped');return old||null}
// Town: wear any spare that beats the worn piece (an epic is never displaced).
export function autoEquip(a){if(!a.slots)return;
  for(const it of spares(a).slice()){if(!wearable(a,it)||it.epic)continue;const cur=a.slots[it.slot];
    if(!cur||(!cur.epic&&cur.ilvl<it.ilvl))equipSpare(a,it)}}

// ---- passing gear within the party ----
// Town: a spare that suits a party member of the same class (better than what they wear) goes to them and
// is worn. Only within the party, only in reach.
export function passSpares(a){if(!a.party)return;
  for(const it of spares(a).slice()){if(!it.cls)continue;
    for(const b of partyMates(a)){if(b.state==='dead'||b.state==='ghost'||b.cls!==it.cls||dist(a,b)>GIVE_RANGE*2||!b.slots)continue;
      const cur=b.slots[it.slot];if(it.ilvl>b.lvl+INV.WEAR_OVER||(cur&&(cur.epic||cur.ilvl>=it.ilvl)))continue;
      if(room(b)<=0)continue;
      const L=invOf(a).list;L.splice(L.indexOf(it),1);const old=equip(b,it);if(old)addGear(b,old);
      stat('passed');record(a,'Passed ',{t:it.name,c:'gd'},' to ',b,'.');record(b,'Was given ',{t:it.name,c:'gd'},' by ',a,'.');break}}}

// ---- using things ----
const err=text=>({ok:false,error:text});
const okay=(text,extra)=>({ok:true,text,...extra});
export function venomOn(a){for(const m of nearMobs(a.x,a.y,14))if(m.dots&&m.dots.some(d=>d.h===a))return true;return false}
function cureVenom(a){let n=0;for(const m of nearMobs(a.x,a.y,14))if(m.dots&&m.dots.length){const k=m.dots.length;m.dots=m.dots.filter(d=>d.h!==a);n+=k-m.dots.length}return n}
const inFight=a=>FIGHT.includes(a.state);
// Use one unit of consumable `id` on `on` (default the user). Healing may go to a party member in reach.
export function useItem(a,id,on,o={}){const U=USES[id];on=on||a;
  if(!U)return err('That cannot be used.');if(count(a,id)<1)return err('You do not carry any '+id+'.');
  if(a.state==='dead'||a.state==='ghost')return err('Not as a ghost.');
  if(on!==a){if(!a.party||on.party!==a.party)return err('Only a party member can be tended.');if(on.state==='dead'||on.state==='ghost')return err(on.name+' is beyond healing.');if(!o.table&&dist(a,on)>GIVE_RANGE)return err(on.name+' is too far away ('+Math.round(dist(a,on))+' tiles; '+GIVE_RANGE+' at most).')}
  const mh=maxHp(on),heal=()=>{const h=Math.min(Math.round(mh*U.heal),Math.ceil(mh-on.hp));on.hp=Math.min(mh,on.hp+mh*U.heal);pop(on.x,on.y-.6,'+'+h,'#7dce5a');return h};
  let res;
  switch(U.kind){
  case 'potion':{if(on.hp>=mh)return err((on===a?'You are':on.name+' is')+' not hurt.');a.potCd=INV.POT_CD;const h=heal();stat('drunk');res=okay((on===a?'Drank ':'Gave ')+id+(on===a?'':' to '+on.name)+': +'+h+' health.',{healed:h})}break;
  case 'bandage':case 'ration':{if(on.hp>=mh)return err((on===a?'You are':on.name+' is')+' not hurt.');
    if(inFight(on)||inFight(a))return err('Not in the middle of a fight.');
    const h=heal();stat(U.kind==='ration'?'ate':'bound');res=okay((U.kind==='ration'?'Ate a ':'Bound wounds with a ')+id+(on===a?'':' for '+on.name)+': +'+h+' health.',{healed:h})}break;
  case 'torch':{const F=S.fellowship,g=F&&F.camp&&F.camp.phase?F.camp:null;if(!g||a.state!=='camp')return err('A torch is lit at a camp.');if(g.lit)return err('The camp is already lit.');g.lit=true;stat('lit');res=okay('Lit a pitch torch at the camp: the watch sees farther.')}break;
  case 'antidote':{if(!venomOn(a))return err('You are not poisoned.');cureVenom(a);stat('cured');res=okay('Drew the venom out with '+id+'.')}break;
  case 'scroll':
    if(U.effect==='recall'){if(!['fight','hunt','travel','follow','duel','assist'].includes(a.state))return err('You cannot read that now ('+a.state+').');
      for(const m of nearMobs(a.x,a.y,12))if(m.target===a)m.target=null;
      a.state='return';a.target=null;a.dest=null;a.raid=false;if(a.pq&&a.pq.length)a.pq=[];stat('read');pop(a.x,a.y-.8,'HEARTHWARD','#9ad0ff');res=okay('Read '+id+': you are pulled toward your home gate.')}
    else{if(a.wardT>0)return err('A ward already holds.');a.wardT=INV.WARD_SECS;stat('read');pop(a.x,a.y-.8,'WARDED','#9ad0ff');res=okay('Read '+id+': blows land '+Math.round(U.ward*100)+'% softer for '+INV.WARD_SECS+' s.')}
    break;
  case 'pack':{const inv=invOf(a);if(inv.pack)return err('You already carry a Wayfarer\'s Pack.');inv.pack=1;res=okay('Strapped on the pack: '+capOf(a)+' slots.')}break;
  default:return err('That cannot be used.')}
  take(a,'use',id,1);return res}



// ---- scripted use ----
// In a fight (and before the flee roll): drink the best potion below the threshold, cure venom, read a ward
// against a named foe, or read Hearthward when nearly gone. Returns true when something was used.
export function fightAid(a,foe,potions=true){const inv=a.inv;if(!inv||!inv.list.length)return false;
  const mh=maxHp(a),f=a.hp/mh;
  if(foe&&foe.elite&&!(a.wardT>0)&&f>.5&&has(a,'Scroll of the Steadfast Hour')&&a.lvl>=USES['Scroll of the Steadfast Hour'].lvl)return useItem(a,'Scroll of the Steadfast Hour').ok;
  if(a.potCd>0)return false;
  if(f<.6&&has(a,'Bogroot Antidote')&&venomOn(a))return useItem(a,'Bogroot Antidote').ok;
  const thr=Math.min(.55,INV.POT_AT*tm(a,'flee'));
  if(potions&&f<thr){const id=bestUse(a,'potion');if(id)return useItem(a,id).ok}
  if(f<.17*tm(a,'flee')&&a.state==='fight'&&has(a,'Scroll of Hearthward')&&a.lvl>=USES['Scroll of Hearthward'].lvl)return useItem(a,'Scroll of Hearthward').ok;
  return false}
// Out of a fight: bind wounds before the walk home.
export function idleTend(a){const inv=a.inv;if(!inv||!inv.list.length||a.potCd>0)return false;
  if(a.hp>=maxHp(a)*INV.BANDAGE_AT||!has(a,'Linen Bandage'))return false;return useItem(a,'Linen Bandage').ok}
// The Healer's other hand: when the spell is on cooldown and a party member in reach is nearly down, a potion goes to them.
export function tendAlly(a,list){const inv=a.inv;if(!inv||!inv.list.length||a.potCd>0)return false;const id=bestUse(a,'potion');if(!id)return false;let low=null;
  for(const b of list){if(b===a||b.state==='ghost'||b.state==='dead'||dist(a,b)>GIVE_RANGE)continue;if(b.hp<maxHp(b)*.35&&(!low||b.hp/maxHp(b)<low.hp/maxHp(low)))low=b}
  return low?useItem(a,id,low).ok:false}
// At camp: supper for the hurt, and a torch lit for the watch.
export function campMeal(a){const inv=a.inv;if(!inv||!inv.list.length)return;
  if(a.hp<maxHp(a)*.85&&has(a,'Trail Ration'))useItem(a,'Trail Ration')}
export function campLight(a){const inv=a.inv;if(inv&&has(a,'Pitch Torch'))useItem(a,'Pitch Torch')}

// ---- town: supplies ----
const buyUse=(a,id,n)=>{let b=0;const p=USES[id].price;while(b<n&&a.gold>=p&&room(a)>0&&stackAdd(a,'use',id,1)){a.gold-=p;b++;stat('bought')}return b};
const tierId=(kind,lvl)=>{let best=null;for(const id in USES){const U=USES[id];if(U.kind===kind&&U.lvl<=lvl&&(!best||(U.tier||0)>(USES[best].tier||0)))best=id}return best};
// Stock up with what gold allows after gear: potions first, then bandages, antidote, scrolls, a pack.
export function restock(a){const L=a.lvl;
  const want=Math.min(4,1+Math.floor(L/4)),pid=tierId('potion',L);
  if(pid){const have=countKind(a,'potion');if(have<want)buyUse(a,pid,want-have)}
  if(L>=2&&countKind(a,'bandage')<2)buyUse(a,'Linen Bandage',2-countKind(a,'bandage'));
  if(L>=USES['Bogroot Antidote'].lvl+1&&a.gold>=40&&!has(a,'Bogroot Antidote'))buyUse(a,'Bogroot Antidote',1);
  if(a.fellow){if(countKind(a,'ration')<3)buyUse(a,'Trail Ration',3-countKind(a,'ration'));if(!countKind(a,'torch'))buyUse(a,'Pitch Torch',1)}
  if(L>=8&&a.gold>=120&&!has(a,'Scroll of Hearthward'))buyUse(a,'Scroll of Hearthward',1);
  if(L>=10&&a.gold>=150&&!has(a,'Scroll of the Steadfast Hour'))buyUse(a,'Scroll of the Steadfast Hour',1);
  if(L>=USES["Wayfarer's Pack"].lvl+1&&a.gold>=100&&!invOf(a).pack&&a.gold>=USES["Wayfarer's Pack"].price){a.gold-=USES["Wayfarer's Pack"].price;invOf(a).pack=1;stat('bought')}}

// ---- loot ----
// A kill's chance of a consumable (INV.DROP_RATE), weighted by each row's `drop`; the better tonic only
// from level 10 mobs on, scrolls only for heroes who can use them. A named elite always leaves a potion.
export function lootSupply(a,m){if(m.add)return;
  if(m.elite){const id=tierId('potion',m.lvl);if(id&&addUse(a,id,1))stat('found');return}
  if(rnd()>=INV.DROP_RATE)return;
  const pool=Object.keys(USES).filter(id=>USES[id].drop>0&&USES[id].lvl<=m.lvl&&(USES[id].kind!=='potion'||USES[id].tier===USES[tierId('potion',m.lvl)].tier));
  let tot=0;for(const id of pool)tot+=USES[id].drop;let r=rnd()*tot,pick=pool[pool.length-1];
  for(const id of pool){r-=USES[id].drop;if(r<=0){pick=id;break}}
  if(addUse(a,pick,1))stat('found')}

// ---- giving (agent tool give, party only) ----
export function giveItem(a,b,i,n=1){const L=invOf(a).list,e=L[i];
  if(!e)return err('No pack entry '+i+'.');if(!b||b===a||b.kind!=='hero'||b.state==='dead'||b.state==='ghost')return err('No such hero to give to.');
  if(!a.party||b.party!==a.party)return err('You can only give to a member of your party.');
  if(dist(a,b)>GIVE_RANGE)return err(b.name+' is too far away ('+Math.round(dist(a,b))+' tiles; '+GIVE_RANGE+' at most).');
  if(isGear(e)){if(e.cls&&e.cls!==b.cls&&!e.epic)return err(e.name+' is made for a '+e.cls+'.');if(room(b)<=0)return err(b.name+"'s pack is full.");
    L.splice(i,1);addGear(b,e);stat('given');return okay('Gave '+e.name+' to '+b.name+'.')}
  if(e.kind==='quest')return err('A quest item is bound to its bearer.');
  n=Math.max(1,Math.min(e.n,Math.round(n)||1));const got=stackAdd(b,e.kind,e.id,n);if(!got)return err(b.name+"'s pack is full.");
  take(a,e.kind,e.id,got);stat('given');return okay('Gave '+got+' '+e.id+' to '+b.name+'.',{count:got})}
export function dropEntry(a,i,n){const L=invOf(a).list,e=L[i];if(!e)return err('No pack entry '+i+'.');
  if(!isGear(e)&&e.kind==='quest')return err('A quest item cannot be dropped.');
  if(isGear(e)){L.splice(i,1);return okay('Dropped '+e.name+'.')}
  n=Math.max(1,Math.min(e.n,Math.round(n)||e.n));e.n-=n;if(e.n<=0)L.splice(i,1);return okay('Dropped '+n+' '+e.id+'.',{count:n})}

// The Crypt run is worked out as one roll (sim/dungeon.js): each member drinks up to two potions on the way
// down, which the roll counts. Returns how many were drunk.
export function cryptDraughts(mem){let k=0;for(const a of mem){for(let i=0;i<2;i++){const id=bestUse(a,'potion');if(!id)break;take(a,'use',id,1);k++;stat('drunk')}}return k}
