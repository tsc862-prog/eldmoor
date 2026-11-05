// Auction-house prices: supply decays, prices follow. Every 12s the market
// ticks, notifies listeners (the UI redraws the table) and snapshots prices.
import {GOODS,MATERIALS,USES,INV,price} from '../data/items.js';
import {RECIPES} from '../data/recipes.js';
import {hasProfession} from './professions.js';
import {S,noOthers} from './state.js';
import {SELL_VALUE} from './gear.js';
import {invOf,isGear,room,used,capOf,count,addGood,addUse,addGear,countKind,useItem} from './inv.js';
import {record} from './history.js';

// Gathered materials (#257) sell here too; their supply decays the same way but never below MAT_FLOOR, the stock the
// table starts with, so a material nobody gathers keeps its listed price (no RNG either way).
const MAT_FLOOR=6;
// A world with no others (#780): no background hero sells, so supply would decay to nothing and every good read as sold out at
// its dearest. It stops at the stock where price() gives the table's base; a price_shock in force still moves its good.
const GOOD_FLOOR=.5/.035;
function floorGoods(){const held=(S.levers&&S.levers.active||[]).filter(x=>x.name==='price_shock').map(x=>x.params.good);
  for(const n in GOODS)if(GOODS[n].supply<GOOD_FLOOR&&!held.includes(n))GOODS[n].supply=GOOD_FLOOR}
const listeners=[];
export function onMarketTick(f){listeners.push(f)}
export function updMarket(dt){for(const n in GOODS)GOODS[n].supply*=1-.025*dt;for(const n in MATERIALS)MATERIALS[n].supply=Math.max(MAT_FLOOR,MATERIALS[n].supply*(1-.025*dt));if(noOthers())floorGoods();S.mktT-=dt;
  if(S.mktT<=0){S.mktT=12;tradeTick();for(const f of listeners)f();for(const n in GOODS)GOODS[n].prev=price(n);for(const n in MATERIALS)MATERIALS[n].prev=price(n)}}

// ---- hero-to-hero trades (#14) ----
// An order book S.listings: [{id, seller, sname, kind:'gear'|'good', item|good, n, ask (gold per unit), at, until}]. A hero lists a
// spare piece or trade goods at its own price; any other hero in town buys it. The seller is paid the ask less TRADE.FEE (a gold
// sink); nobody trades with the house in between, so supply is untouched. A listing nobody takes lapses after TRADE.DAYS game days
// and comes back to the seller (gear sells to the house at its old price, goods go to the pack). Scripted heroes list the spares
// they no longer need at TRADE.GEAR_X x the house value and buy an upgrade or a recipe's materials when they can afford it
// beyond a reserve; agents use auction_list / auction_browse / auction_buy / auction_cancel. No RNG.
export const TRADE={FEE:.05,DAYS:3,GEAR_X:2,RESERVE:80,MAX_PER_HERO:4,MIN_X:.5,MAX_X:2.5,LOG:20};
const T=()=>S.tradeStats||(S.tradeStats={listed:0,sold:0,lapsed:0,gold:0,fees:0,gear:0,goods:0,use:0,craftedListed:0,craftedSold:0,craftedGold:0});
// Crafted goods (#719): a recipe's consumable result (a potion, meal, scroll, pack, map) lists as a 'use' stack at its shop price; crafted gear
// lists as gear and keeps it.maker/makerId (the item object travels whole). A use stack carries no maker, so its listing notes the seller's trade (l.maker).
const CRAFTED=new Set(RECIPES.filter(r=>r.out.kind==='use').map(r=>r.out.id)),PROF_OF=Object.fromEntries(RECIPES.filter(r=>r.out.kind==='use').map(r=>[r.out.id,r.prof]));
export const craftedUse=id=>CRAFTED.has(id)&&!!USES[id];
// Scrolls a scripted hero uses/crafts only from this level (restock buys them at the same levels).
export const SCROLL_LVL={'Scroll of Hearthward':8,'Scroll of the Steadfast Hour':10};
// Units of a crafted good on the book now (the market crafters read it to see whether supply is low).
export const listedUnits=id=>listings().reduce((n,l)=>n+(l.kind==='use'&&l.good===id?l.n:0),0);
const SURPLUS={potion:4,ration:2,pack:1,scroll:2,map:1};   // units a scripted hero keeps of its own before it lists the rest
const crafted=l=>!!(l.maker||(l.kind==='gear'&&l.item&&l.item.maker));
export const listings=()=>S.listings||(S.listings=[]);
export const gearRef=it=>SELL_VALUE(it)*TRADE.GEAR_X;           // the default ask for a piece of gear
export const goodRef=id=>price(id);
const heroById=id=>S.agents.find(h=>h.id===id);
const alive=h=>h&&h.state!=='dead'&&h.state!=='ghost';
const nameOf=l=>l.kind==='gear'?l.item.name:l.good;
function note(l,buyer,n,gold){const L=S.trades||(S.trades=[]);L.unshift({day:Math.floor(S.gameMin/1440)+1,seller:l.sname,buyer:buyer.name,what:nameOf(l),n,gold});if(L.length>TRADE.LOG)L.length=TRADE.LOG}
// List gear (item object already taken out of the pack) or n units of a good. Returns the listing.
export function listFor(a,spec,ask){const L=listings(),id=(S.listingId=(S.listingId||0)+1);
  const l={id,seller:a.id,sname:a.name,kind:spec.item?'gear':spec.use?'use':'good',n:spec.item?1:spec.n,ask:Math.max(1,Math.round(ask)),at:S.gameMin,until:S.gameMin+TRADE.DAYS*1440};
  if(spec.item)l.item=spec.item;else l.good=spec.use||spec.good;
  if(spec.use&&PROF_OF[spec.use]&&hasProfession(a,PROF_OF[spec.use]))l.maker=a.name;
  L.push(l);const t=T();t.listed++;if(crafted(l))t.craftedListed=(t.craftedListed||0)+1;
  record(a,'Listed ',{t:nameOf(l)+(l.n>1?' x'+l.n:''),c:'gd'},' at the auction house for '+l.ask+'g'+(l.n>1?' each':'')+'.');return l}
export const mine=a=>listings().filter(l=>l.seller===a.id);
export const gearUpgrade=(a,it)=>{if(!a.slots||!it||it.epic||(it.cls&&it.cls!==a.cls)||it.ilvl>a.lvl+INV.WEAR_OVER)return -1;
  const cur=a.slots[it.slot];if(cur&&cur.epic)return -1;return it.ilvl-(cur?cur.ilvl:0)};
// Buy (part of) a listing. Returns {ok, ...} or {ok:false, error}.
export function buyListing(a,l,n=1){const L=listings(),i=L.indexOf(l);if(i<0)return {ok:false,error:'That listing is gone.'};
  if(l.seller===a.id)return {ok:false,error:'That is your own listing (auction_cancel takes it back).'};
  n=l.kind==='gear'?1:Math.max(1,Math.min(Math.floor(n)||1,l.n));const cost=l.ask*n;
  if(a.gold<cost)return {ok:false,error:'That costs '+cost+'g; you have '+a.gold+'g.'};
  if(room(a)<=0&&!(l.kind!=='gear'&&invOf(a).list.some(e=>e.kind===l.kind&&e.id===l.good&&e.n<INV.STACK)))return {ok:false,error:'Your pack is full ('+used(a)+'/'+capOf(a)+').'};
  a.gold-=cost;const fee=Math.floor(cost*TRADE.FEE),s=heroById(l.seller);if(alive(s))s.gold+=cost-fee;
  if(l.kind==='gear')addGear(a,l.item);else if(l.kind==='use')addUse(a,l.good,n);else addGood(a,l.good,n)
  l.n-=n;if(l.kind==='gear'||l.n<=0)L.splice(i,1);
  const t=T();t.sold++;t.gold+=cost;t.fees+=fee;t[l.kind]=(t[l.kind]||0)+1;if(crafted(l)){t.craftedSold=(t.craftedSold||0)+1;t.craftedGold=(t.craftedGold||0)+cost}note(l,a,n,cost);
  record(a,'Bought ',{t:nameOf(l)+(n>1?' x'+n:''),c:'gd'},' from '+l.sname+' for '+cost+'g.');
  if(alive(s))record(s,'Sold ',{t:nameOf(l)+(n>1?' x'+n:''),c:'gd'},' to ',a,' for '+(cost-fee)+'g.');
  return {ok:true,what:nameOf(l),n,cost,seller:l.sname,gold:a.gold,item:l.kind==='gear'?l.item:null,maker:makerOf(l)}}
export const makerOf=l=>l.maker||(l.kind==='gear'&&l.item&&l.item.maker)||null;
// Take a listing off the book; the item goes back to the seller (or the house buys it).
function giveBack(l,why){const s=heroById(l.seller);if(!alive(s))return;
  if(l.kind==='gear'){if(s.player&&room(s)>0)invOf(s).list.push(l.item);else s.gold+=SELL_VALUE(l.item)}
  else{const k=l.kind==='use'?addUse(s,l.good,l.n):addGood(s,l.good,l.n);if(k<l.n){const m=GOODS[l.good]||MATERIALS[l.good];for(let i=k;i<l.n;i++){s.gold+=price(l.good);if(m)m.supply++}}}
  if(why)record(s,'Your listing of ',{t:nameOf(l),c:'gd'},' '+why+'.')}
export function cancelListing(a,l){const L=listings(),i=L.indexOf(l);if(i<0||l.seller!==a.id)return false;
  if(l.kind==='gear'&&room(a)<=0)return false;L.splice(i,1);
  if(l.kind==='gear')invOf(a).list.push(l.item);else{const k=l.kind==='use'?addUse(a,l.good,l.n):addGood(a,l.good,l.n);if(k<l.n){L.push({...l,n:l.n-k});return true}}return true}
export function tradeTick(){const L=listings();if(!L.length)return;
  for(let i=L.length-1;i>=0;i--){const l=L[i];if(l.until>S.gameMin)continue;L.splice(i,1);T().lapsed++;giveBack(l,'lapsed')}}
// Scripted seller (in town, before the house sale): list the spares it will not keep, up to MAX_PER_HERO listings.
export function scriptedList(a){if(a.player)return 0;const inv=invOf(a);let n=0;
  const keep=inv.list.filter(e=>isGear(e)&&e.ilvl>a.lvl+INV.WEAR_OVER&&(!e.cls||e.cls===a.cls)).sort((x,y)=>y.ilvl-x.ilvl).slice(0,INV.KEEP_SPARES);
  for(const e of inv.list.slice()){if(mine(a).length>=TRADE.MAX_PER_HERO)break;if(!isGear(e)||e.epic||keep.includes(e)||e.ilvl<4)continue;
    inv.list.splice(inv.list.indexOf(e),1);listFor(a,{item:e},gearRef(e));n++}
  for(const e of inv.list.slice()){if(mine(a).length>=TRADE.MAX_PER_HERO)break;if(e.kind!=='use'||!craftedUse(e.id))continue;
    const U=USES[e.id],keep=U.kind==='pack'&&!inv.pack?1:SURPLUS[U.kind]!=null?SURPLUS[U.kind]:99,have=count(a,e.id),k=Math.min(e.n,have-keep);
    if(k<1)continue;e.n-=k;if(e.n<=0)inv.list.splice(inv.list.indexOf(e),1);listFor(a,{use:e.id,n:k},goodRef(e.id));n++}
  return n}
// Scripted buyer (in town): the best gear upgrade it can afford beyond the reserve, then recipe materials it is short of.
export function scriptedBuy(a,need){if(a.player)return 0;const L=listings();if(!L.length)return 0;let bought=0;
  let best=null,bg=0;for(const l of L){if(l.kind!=='gear'||l.seller===a.id||l.ask>a.gold-TRADE.RESERVE)continue;const g=gearUpgrade(a,l.item);if(g>bg){bg=g;best=l}}
  if(best&&bg>=2&&buyListing(a,best).ok)bought++;
  if(need)for(const id in need){const short=need[id]-count(a,id);if(short<=0)continue;
    for(const l of L.slice().sort((x,y)=>x.ask-y.ask)){if(l.kind!=='good'||l.good!==id||l.seller===a.id||l.ask>goodRef(id)*1.1||a.gold-l.ask<TRADE.RESERVE)continue;
      const k=Math.min(short,l.n,Math.floor((a.gold-TRADE.RESERVE)/l.ask));if(k>0&&buyListing(a,l,k).ok){bought++;break}}}
  // crafted potions and packs it would otherwise buy at the shop (and, #783, a meal or a scroll): at most the shop price
  const want=Math.min(4,1+Math.floor(a.lvl/4));
  for(const l of L.slice().sort((x,y)=>x.ask-y.ask)){if(l.kind!=='use'||l.seller===a.id||!craftedUse(l.good)||l.ask>goodRef(l.good)||a.gold-l.ask<TRADE.RESERVE)continue;
    const U=USES[l.good];let k=0;
    if(U.kind==='potion'&&U.lvl<=a.lvl+2)k=Math.min(l.n,want-countKind(a,'potion'));
    else if(U.kind==='pack'&&!invOf(a).pack&&!count(a,l.good)&&a.lvl>=U.lvl+1)k=1;
    // a meal it has none of (eaten at once) and the scrolls it would buy at the shop (#783)
    else if(U.kind==='ration'&&U.buff&&!count(a,l.good)&&!(a.meal&&a.meal.until>S.gameMin))k=1;
    else if(U.kind==='scroll'&&a.lvl>=(SCROLL_LVL[l.good]||U.lvl)&&!count(a,l.good))k=1;
    k=Math.min(k,Math.floor((a.gold-TRADE.RESERVE)/l.ask));if(k>0&&buyListing(a,l,k).ok){bought++;if(U.kind==='pack'||U.kind==='ration')useItem(a,l.good)}}
  return bought}
