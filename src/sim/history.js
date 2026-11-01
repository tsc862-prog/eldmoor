// Per-hero event log for the dossier Log tab (issue #19). record(a, ...parts) pushes
// {t, parts, text} onto a.history, newest last, capped at HIST_CAP. Parts follow the
// chronicle convention: strings, heroes (the UI renders them as clickable names) or
// {t, c} spans. Pure bookkeeping: it rolls no random numbers and changes no behaviour.
import {clockStr} from './state.js';

export const HIST_CAP=40;
export function record(a,...parts){if(!a)return;
  const text=parts.map(p=>typeof p==='string'?p:p.kind==='hero'?p.name:p.t).join('');
  (a.history||(a.history=[])).push({t:clockStr(),parts,text});
  if(a.history.length>HIST_CAP)a.history.shift()}
