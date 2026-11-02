// One mind label for every view (issue #136): the header, the Minds panel, the party frames, the mind
// row and the Chat tags all say the same thing.
//   Scripted
//   AI (model)                 a model plays through the relay ("· quiet" while the relay is silent)
//   Agent (model · link)       an agent runner plays: link is live, waiting, no runner or Ollama busy
// An agent-played hero is never shown as scripted. mindLabel(a) -> {kind, text, title, link}.
import {mindTag,brainStatus} from '../sim/brain.js';
import {agentLink,runnerTag,LINK_TEXT} from './player-bridge.js';
import {ollamaBusy} from './runners.js';

// 'connected' | 'waiting' | 'none' | 'busy' (the local Ollama model is busy or loading) | the bridge's own state
export function linkOf(a){const k=agentLink(a);return (k==='connected'||k==='waiting'||k==='none')&&ollamaBusy(a)?'busy':k}
export const LINK_WORD={connected:'live',waiting:'waiting',none:'no runner',busy:'Ollama busy',connecting:'connecting',offline:'relay offline',off:'not connected'};
const LINK_LONG={...LINK_TEXT,busy:'the local Ollama model is busy or loading; the runner is waiting for it'};

export function mindLabel(a){
  if(!a)return {kind:'scripted',text:'Scripted',title:'The scripted rules play this hero.',link:null};
  if(a.player){const k=linkOf(a),rt=runnerTag(a),w=LINK_WORD[k]||k;
    return {kind:'agent',link:k,text:'Agent ('+(rt&&k!=='none'?rt+' · ':'')+w+')',
      title:'Agent-played: '+(LINK_LONG[k]||k)+(rt?'. Runner model: '+rt:'')+'. Runner: npm run agent -- --hero '+a.name+'. Reflexes keep the hero alive while the agent is silent.'}}
  if(a.brain){const q=brainStatus(a)==='offline';
    return {kind:q?'quiet':'ai',link:null,text:'AI ('+mindTag(a)+(q?' · quiet':'')+')',
      title:q?'AI-played, but the relay is not answering; the scripted rules play for now.':'A language model plays this hero through the relay (npm run relay); the scripted rules take over whenever it is silent.'}}
  return {kind:'scripted',link:null,text:'Scripted',title:'The scripted rules play this hero.'}}

// The text of a chat line's tag: "Agent (model)" or "AI (model)" (a line carries its model, not a live link).
export const chatTag=e=>!e?null:e.agent?e.model||'Agent':e.ai?'AI ('+(e.model||'Claude')+')':null;
