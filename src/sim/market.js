// Auction-house prices: supply decays, prices follow. Every 12s the market
// ticks, notifies listeners (the UI redraws the table) and snapshots prices.
import {GOODS,price} from '../data/items.js';
import {S} from './state.js';

const listeners=[];
export function onMarketTick(f){listeners.push(f)}
export function updMarket(dt){for(const n in GOODS)GOODS[n].supply*=1-.025*dt;S.mktT-=dt;
  if(S.mktT<=0){S.mktT=12;for(const f of listeners)f();for(const n in GOODS)GOODS[n].prev=price(n)}}
