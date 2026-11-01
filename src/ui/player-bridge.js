// Agent player bridge, browser side (issue #75). When a hero is marked agent-played, the page
// connects to the relay's WebSocket (ws://127.0.0.1:8787/play; override with localStorage
// 'eldmoor.playUrl'), says which hero is played, and answers the tool calls the relay forwards
// from the MCP server by running them through sim/player.js in this page's world. The runner's
// narration arrives here too and is kept on the hero for the Agent tab.
// The world never waits on the bridge: a disconnected or silent agent just leaves the hero to
// its reflexes. Reconnects every few seconds while an agent-played hero is alive.
import {S,markPlayer,playerHero,playerSeat,playerNarrate,disableBrain} from '../sim/index.js';
import {hostCall} from '../sim/player-host.js';

const DEFAULT_URL='ws://127.0.0.1:8787/play';
let ws=null,status='off',timer=null,lastHello='';
export const bridgeUrl=()=>{try{return localStorage.getItem('eldmoor.playUrl')||DEFAULT_URL}catch(e){return DEFAULT_URL}};
export const bridgeStatus=()=>status; // off | connecting | connected | offline

// Make a the agent-played hero (one at a time) and connect.
export function agentOn(a){if(!a||a.state==='dead')return false;
  for(const id of (S.playerHeroes||[]).slice()){const b=S.agents.find(x=>x.id===id);if(b&&b!==a)markPlayer(b,false)}
  if(a.brain)disableBrain(a); // a hero has one mind at a time: the model brain or the agent
  if(!markPlayer(a,true))return false;connect();hello();return true}
export function agentOff(a){markPlayer(a,false);if(!playerSeat())disconnect();else hello()}

function send(o){if(ws&&ws.readyState===1)ws.send(JSON.stringify(o))}
function hello(){const a=playerSeat(),h=a?{id:a.id,name:a.name}:null,k=JSON.stringify(h);if(k===lastHello&&status==='connected')return;lastHello=k;send({type:'hello',hero:h})}
function connect(){if(ws||typeof WebSocket==='undefined')return;status='connecting';
  try{ws=new WebSocket(bridgeUrl())}catch(e){ws=null;status='offline';later();return}
  ws.onopen=()=>{status='connected';lastHello='';hello()};
  ws.onmessage=async e=>{let m;try{m=JSON.parse(e.data)}catch(_){return}
    if(m.type==='call'){const a=playerSeat();let r;
      try{r=a?await hostCall(a.id,String(m.tool),m.args||{}):{ok:false,error:'No agent-played hero in the game.'}}catch(err){r={ok:false,error:String(err&&err.message||err)}}
      send({type:'result',id:m.id,result:r})}
    else if(m.type==='narrate'){const a=playerHero();if(a)playerNarrate(a.id,String(m.text||''))}};
  ws.onclose=()=>{ws=null;lastHello='';status=playerHero()?'offline':'off';if(playerHero())later()};
  ws.onerror=()=>{}}
function later(){if(timer)return;timer=setTimeout(()=>{timer=null;if(playerHero())connect()},4000)}
function disconnect(){if(timer){clearTimeout(timer);timer=null}if(ws){const w=ws;ws=null;try{w.close()}catch(e){}}status='off';lastHello=''}

// On page load (a restored save may hold an agent-played hero) and every few seconds after,
// so the relay always knows which hero is played.
export function initBridge(){if(playerHero())connect();setInterval(()=>{if(playerHero()){if(!ws)connect();else hello()}},3000)}
