// The event feed. log(...parts) stores an entry on S.chronicle and notifies
// listeners (the UI subscribes with onLog). Parts are strings, heroes
// (coloured by faction) or {t, c} spans with a CSS class.
import {S,clockStr} from './state.js';
import {FAC} from '../data/factions.js';

const listeners=[];
export function onLog(f){listeners.push(f)}
export function log(...parts){const e={t:clockStr(),parts};S.chronicle.unshift(e);if(S.chronicle.length>90)S.chronicle.pop();for(const f of listeners)f(e)}
export const gold=t=>({t,c:'gd'}),epic=t=>({t:'['+t+']',c:'ep'}),fac=f=>({t:'the '+FAC[f].name,c:'f'+f});
