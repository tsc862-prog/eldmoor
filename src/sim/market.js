// Auction-house prices: supply decays, prices follow. Every 12s the market
// ticks, notifies listeners (the UI redraws the table) and snapshots prices.
import {GOODS,MATERIALS,price} from '../data/items.js';
import {S} from './state.js';

// Gathered materials (#257) sell here too; their supply decays the same way but never below MAT_FLOOR, the stock the
// table starts with, so a material nobody gathers keeps its listed price (no RNG either way).
const MAT_FLOOR=6;
const listeners=[];
export function onMarketTick(f){listeners.push(f)}
export function updMarket(dt){for(const n in GOODS)GOODS[n].supply*=1-.025*dt;for(const n in MATERIALS)MATERIALS[n].supply=Math.max(MAT_FLOOR,MATERIALS[n].supply*(1-.025*dt));S.mktT-=dt;
  if(S.mktT<=0){S.mktT=12;for(const f of listeners)f();for(const n in GOODS)GOODS[n].prev=price(n);for(const n in MATERIALS)MATERIALS[n].prev=price(n)}}
