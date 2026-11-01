// Agent player bridge, browser side (issues #75, #93). While any hero is agent-played, the page
// connects to the relay's WebSocket (ws://127.0.0.1:8787/play; override with localStorage
// 'eldmoor.playUrl'), says which heroes are played, and answers the tool calls the relay forwards
// from the MCP server, each for the hero it names, by running them through sim/player.js in this
// page's world. Several heroes can be agent-played at once, one agent runner each; the relay
// reports each runner's link state (connected / waiting / none) for the Agent tab and the Minds
// panel. The runner's narration arrives here too and is kept on its hero.
// The world never waits on the bridge: a disconnected or silent agent just leaves its hero to
// its reflexes. Reconnects every few seconds while an agent-played hero is alive.
import {markPlayer,playerHero,playerSeat,playerSeats,playerNarrate,disableBrain,S} from '../sim/index.js';
import {hostCall} from '../sim/player-host.js';

const DEFAULT_URL='ws://127.0.0.1:8787/play';
let ws=null,status='off',timer=null,lastHello='',links={},runners={};
export const bridgeUrl=()=>{try{return localStorage.getItem('eldmoor.playUrl')||DEFAULT_URL}catch(e){return DEFAULT_URL}};
export const bridgeStatus=()=>status; // off | connecting | connected | offline
// One hero's agent link: 'connected' (its runner is calling tools), 'waiting' (a runner holds
// it but is quiet), 'none' (no runner yet), or the bridge's own state when the page is not
// connected to the relay ('connecting', 'offline', 'off').
export const agentLink=a=>!a||!a.player?'off':status!=='connected'?status:links[a.id]||'none';
// The mind behind a hero's runner, as its claim reports it (issue #97): {provider, model} or null.
export const agentRunner=a=>a&&a.player&&status==='connected'&&runners[a.id]||null;
export const runnerTag=a=>{const r=agentRunner(a);return r?(r.model||r.provider)+(r.provider==='ollama'?' · local':''):null};
export const LINK_TEXT={connected:'agent connected',waiting:'agent waiting (runner idle)',none:'no runner',connecting:'connecting to the relay…',offline:'relay offline',off:'not connected'};

// Make a an agent-played hero (alongside any others) and connect.
export function agentOn(a){if(!a||a.state==='dead')return false;
  if(a.brain)disableBrain(a); // a hero has one mind at a time: the model brain or the agent
  if(!markPlayer(a,true))return false;connect();hello();return true}
export function agentOff(a){markPlayer(a,false);if(!playerSeats().length)disconnect();else hello()}

function send(o){if(ws&&ws.readyState===1)ws.send(JSON.stringify(o))}
function hello(){const hs=playerSeats().map(a=>({id:a.id,name:a.name,alive:a.state!=='dead',...(a.fellow?{fellow:true,role:a.fellowRole||null,lead:!!(a.party&&a.party.fellow&&a.party.leader===a),table:!!(S.table&&S.table.ids.includes(a.id))}:{})})),k=JSON.stringify(hs);
  if(k===lastHello&&status==='connected')return;lastHello=k;send({type:'hello',heroes:hs,hero:hs.find(h=>h.alive)||hs[hs.length-1]||null})}
const seat=id=>id!=null?playerSeat(id):playerSeat();
function connect(){if(ws||typeof WebSocket==='undefined')return;status='connecting';
  try{ws=new WebSocket(bridgeUrl())}catch(e){ws=null;status='offline';later();return}
  ws.onopen=()=>{status='connected';lastHello='';links={};runners={};hello()};
  ws.onmessage=async e=>{let m;try{m=JSON.parse(e.data)}catch(_){return}
    if(m.type==='call'){const a=seat(m.hero);let r;
      try{r=a?await hostCall(a.id,String(m.tool),m.args||{}):{ok:false,error:m.hero!=null?'Hero #'+m.hero+' is not agent-played in the game.':'No agent-played hero in the game.'}}catch(err){r={ok:false,error:String(err&&err.message||err)}}
      send({type:'result',id:m.id,result:r})}
    else if(m.type==='narrate'){const a=seat(m.hero);if(a)playerNarrate(a.id,String(m.text||''))}
    else if(m.type==='links'&&m.links&&typeof m.links==='object'){links=m.links;runners=m.runners&&typeof m.runners==='object'?m.runners:{}}};
  ws.onclose=()=>{ws=null;lastHello='';links={};runners={};status=playerHero()?'offline':'off';if(playerHero())later()};
  ws.onerror=()=>{}}
function later(){if(timer)return;timer=setTimeout(()=>{timer=null;if(playerHero())connect()},4000)}
function disconnect(){if(timer){clearTimeout(timer);timer=null}if(ws){const w=ws;ws=null;try{w.close()}catch(e){}}status='off';lastHello='';links={};runners={}}

// On page load (a restored save may hold agent-played heroes) and every few seconds after,
// so the relay always knows which heroes are played.
export function initBridge(){if(playerHero())connect();setInterval(()=>{if(playerHero()){if(!ws)connect();else hello()}},3000)}
