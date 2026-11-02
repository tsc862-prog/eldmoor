// World events (#10, part 1): the DM lever start_event runs a festival or a plague over a region.
// An event is the existing region condition (levers.js CONDITIONS) held for a fixed time, so the
// lever's limits, cooldown and DM log all apply and the effects stay what those hooks already do:
// quieter road encounters, merchants or pilgrims, townsfolk talk more or keep indoors. Nothing here
// touches HP, level or life, and nothing starts by itself: only a lever pull runs an event.
import {S} from './state.js';
import {ZONES} from '../world/map.js';
import {log} from './chronicle.js';
import {provide} from './levers.js';

export const EVENT_DAYS=3,EVENT_MAX_SCALE=3; // days at scale 1; scale 1-3 multiplies it
export const EVENTS={
  festival:{start:z=>'A festival fills the market towns of '+ZONES[z]+'.'},
  plague:{start:z=>'A plague creeps through '+ZONES[z]+'; townsfolk keep indoors.'},
};

export function startEvent(p,ctx){
  const def=EVENTS[p.kind];if(!def)return {ok:false,effect:'unknown event kind '+p.kind+' (festival or plague)'};
  if(!S.conditions)S.conditions=[];
  if(S.conditions.some(c=>c.z===p.region))return {ok:false,effect:ZONES[p.region]+' already has a condition'};
  const scale=Math.max(1,Math.min(EVENT_MAX_SCALE,p.scale|0||1)),until=S.gameMin+EVENT_DAYS*scale*1440;
  const c={id:++S.uid,kind:p.kind,z:p.region,str:scale,until,lever:ctx.id};S.conditions.push(c);
  log(def.start(p.region));
  return {ok:true,effect:{condition:c.id,kind:p.kind,zone:ZONES[p.region],scale,days:EVENT_DAYS*scale},until}}

provide('startEvent',startEvent);
