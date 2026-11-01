// The DM log (issue #76): a readable record of every hook board refresh, hook pick, scene
// frame, roll, complication, branch, payoff and failure the DM produced, with the numbers
// and reasons behind each. S.dmLog is plain data, newest first, capped, and saved with the
// world. Entries carry optional prompt/reply strings that stay empty for the scripted DM;
// a model-backed DM calls dmNote(prompt, reply) just before the slot answer is used and the
// next entry picks them up. Logging rolls no random numbers and changes no behaviour.
//   entry: {id, t, gameMin, kind, town, advId, heroes:[ids], summary:[parts], detail:{}, prompt, reply}
//   kinds: hooks pick frame roll complication branch payoff fail abandon fallback lever camp agent
//   (agent: the DM agent's notes, plans and seat changes, issue #66; its lever pulls are kind lever with detail.by 'dm-agent')
import {S,clockStr} from './state.js';

export const DMLOG_CAP=200;
let pend=null;
export function dmNote(prompt,reply){pend={prompt:String(prompt||''),reply:String(reply||'')}}
// adv may be null (hook boards, fallbacks with no adventure). o.heroes: ids, default the adventure's party.
export function dmlog(kind,adv,summary,detail,o={}){
  const L=S.dmLog||(S.dmLog=[]);
  const e={id:S.dmLogSeq=(S.dmLogSeq||0)+1,t:clockStr(),gameMin:S.gameMin,kind,town:o.town||(adv?adv.town:null),advId:adv?adv.id:null,
    heroes:o.heroes||(adv?adv.mem.slice():[]),summary,detail:detail||{},prompt:pend?pend.prompt:'',reply:pend?pend.reply:''};
  pend=null;L.unshift(e);if(L.length>DMLOG_CAP)L.pop();return e}
