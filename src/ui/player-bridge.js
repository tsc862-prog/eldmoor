// Agent player bridge, browser side (issues #75, #93). While any hero is agent-played, the page
// connects to the relay's WebSocket (ws://127.0.0.1:8787/play; override with localStorage
// 'eldmoor.playUrl'), says which heroes are played, and answers the tool calls the relay forwards
// from the MCP server, each for the hero it names, by running them through sim/player.js in this
// page's world. Several heroes can be agent-played at once, one agent runner each; the relay
// reports each runner's link state (connected / waiting / none) for the Agent tab and the Minds
// panel. The runner's narration arrives here too and is kept on its hero.
// The world never waits on the bridge: a disconnected or silent agent just leaves its hero to
// its reflexes. Reconnects every few seconds while an agent-played hero is alive.
import {markPlayer,playerHero,playerSeat,playerSeats,playerNarrate,disableBrain,S,dmAct,dmSeatOn,setDmSeat,prepView} from '../sim/index.js';
import {hostCall,seatInfo} from '../sim/player-host.js'; // seatInfo: one seat for /play/health, company field (#460)
import {setAgentTag} from '../sim/chat.js';
import {makeWatch} from '../sim/behavior.js';
import {noteDmCall} from './dmturns.js'; // per-turn cards of the DM tab (#181)
import {companies} from '../sim/company.js';
import {WORLD_ID} from '../world/map.js';
import {mirrorDirty} from '../sim/notebook.js';
import {sleep as wsleep,every} from './ticker.js';

const DEFAULT_URL='ws://127.0.0.1:8787/play';
let ws=null,status='off',timer=null,lastHello='',links={},runners={},dmLinkInfo=null,readies={},linksIn=false; // linksIn: the relay's first links since connecting (#563)
// The bridge is wanted while a hero is agent-played or the DM seat is open (issue #66), or a Fellowship plays with
// relay minds (its behavior digests go to the relay's logs, issue #129).
const wanted=()=>!!playerHero()||dmSeatOn()||companies().length>0;
export const bridgeUrl=()=>{try{return localStorage.getItem('eldmoor.playUrl')||DEFAULT_URL}catch(e){return DEFAULT_URL}};
export const bridgeStatus=()=>status; // off | connecting | connected | offline
// One hero's agent link: 'connected' (its runner is calling tools), 'waiting' (a runner holds
// it but is quiet), 'none' (no runner yet), or the bridge's own state when the page is not
// connected to the relay ('connecting', 'offline', 'off').
export const agentLink=a=>!a||!a.player?'off':status!=='connected'?status:!linksIn?'connecting':links[a.id]||'none'; // before the first links message: connecting, never a false 'no runner'
// The mind behind a hero's runner, as its claim reports it (issue #97): {provider, model} or null.
export const agentRunner=a=>a&&a.player&&status==='connected'&&runners[a.id]||null;
// The start gate (issue #222): a seat's warm-up as the relay reports it ({state:'warming'|'ready'|'failed', model?, ms?, at, error?}), or null (claimed, not yet warming).
export const agentReady=a=>a&&a.player&&status==='connected'&&readies[a.id]||null;
export const dmReady=()=>dmSeatOn()&&status==='connected'&&dmLinkInfo&&dmLinkInfo.ready||null;
// One word for a seat's readiness: 'ready' | 'warming' | 'failed' | 'claimed' (a runner holds it, no warm-up yet) | null (no runner).
export const readyWord=(link,r)=>!(link==='connected'||link==='waiting')?null:r&&r.state?r.state:'claimed';
export const agentReadyWord=a=>readyWord(agentLink(a),agentReady(a));
export const dmReadyWord=()=>readyWord(dmLink(),dmReady());
export const runnerTag=a=>{const r=agentRunner(a);return r?(r.model||r.provider)+(r.provider==='ollama'?' · local':r.provider==='openai'?' · openai':r.provider==='huggingface'?' · huggingface':''):null};
setAgentTag(a=>runnerTag(a)); // agent chat lines carry the runner's model in the Chat tab (#126)
// The DM seat (issue #66): open it and the page answers the DM agent's tools (sim/dmagent.js) over the
// same WebSocket. dmLink(): 'connected' | 'waiting' | 'none' as for a hero, or the bridge's own state.
export function dmSeatSet(on){setDmSeat(on);if(on){connect();hello()}else{hello();if(!wanted())disconnect()}}
export const dmLink=()=>!dmSeatOn()?'off':status!=='connected'?status:!linksIn?'connecting':dmLinkInfo&&dmLinkInfo.link||'none';
export const dmRunnerTag=()=>{const r=dmSeatOn()&&status==='connected'&&dmLinkInfo&&dmLinkInfo.runner;return r?(r.model||r.provider)+(r.provider==='ollama'?' · local':r.provider==='openai'?' · openai':r.provider==='huggingface'?' · huggingface':''):null};
export const LINK_TEXT={connected:'agent connected',waiting:'agent waiting (runner idle)',none:'no runner',connecting:'connecting to the relay…',offline:'relay offline',off:'not connected'};

// Make a an agent-played hero (alongside any others) and connect.
export function agentOn(a){if(!a||a.state==='dead')return false;
  if(a.brain)disableBrain(a); // a hero has one mind at a time: the model brain or the agent
  if(!markPlayer(a,true))return false;connect();hello();return true}
export function agentOff(a){markPlayer(a,false);if(!wanted())disconnect();else hello()}

function send(o){if(ws&&ws.readyState===1)ws.send(JSON.stringify(o))}
function hello(){const hs=playerSeats().map(seatInfo),pv=prepView(),dm={seat:dmSeatOn(),...(pv.state!=='idle'?{prep:{state:pv.state,kind:pv.kind,calls:pv.calls,max_calls:pv.max_calls,...(pv.why?{why:pv.why}:{})}}:{})},k=JSON.stringify([hs,dm,WORLD_ID,S.worldId]); // succeeds: a recruit's fallen predecessor (#452); prep: the DM's prep (#437)
  if(k===lastHello&&status==='connected')return;lastHello=k;if(S.worldId!==sentWid){sentWid=S.worldId;sentMem.clear()}
  send({type:'hello',heroes:hs,dm,world:WORLD_ID,worldId:S.worldId||null,hero:hs.find(h=>h.alive)||hs[hs.length-1]||null})}
const seat=id=>id!=null?playerSeat(id):playerSeat();
function connect(){if(ws||typeof WebSocket==='undefined')return;status='connecting';
  try{ws=new WebSocket(bridgeUrl())}catch(e){ws=null;status='offline';later();return}
  ws.onopen=()=>{status='connected';lastHello='';links={};runners={};readies={};linksIn=false;sentMem.clear();hello()};
  ws.onmessage=async e=>{let m;try{m=JSON.parse(e.data)}catch(_){return}
    if(m.type==='call'){const a=seat(m.hero);let r;
      try{r=a?await hostCall(a.id,String(m.tool),m.args||{},{nap:wsleep}):{ok:false,error:m.hero!=null?'Hero #'+m.hero+' is not agent-played in the game.':'No agent-played hero in the game.'}}catch(err){r={ok:false,error:String(err&&err.message||err)}}
      send({type:'result',id:m.id,result:r})}
    else if(m.type==='narrate'){const a=seat(m.hero);if(a)playerNarrate(a.id,String(m.text||''))}
    else if(m.type==='dmcall'){let r;try{r=dmAct(String(m.tool),m.args||{})}catch(err){r={ok:false,error:String(err&&err.message||err)}}try{noteDmCall(String(m.tool),m.args||{},r)}catch(err){}send({type:'result',id:m.id,result:r})}
    else if(m.type==='links')takeLinks(m)};
  ws.onclose=()=>{ws=null;lastHello='';links={};runners={};readies={};dmLinkInfo=null;status=wanted()?'offline':'off';if(wanted())later()};
  ws.onerror=()=>{}}
function takeLinks(m){if(!m.links||typeof m.links!=='object')return;links=m.links;runners=m.runners&&typeof m.runners==='object'?m.runners:{};readies=m.ready&&typeof m.ready==='object'?m.ready:{};dmLinkInfo=m.dm&&typeof m.dm==='object'?m.dm:null;linksIn=true}
// Test seam (scripts/labelcheck.mjs, #563): feed the relay's links message as if the socket were connected; null: back to off.
export function bridgeFeed(m){if(m==null){status='off';linksIn=false;links={};runners={};readies={};dmLinkInfo=null;return}status='connected';takeLinks(m)}
// the reconnect timer runs on the worker clock so a hidden tab reconnects in seconds, not a minute
function later(){if(timer)return;timer=1;wsleep(4000).then(()=>{timer=null;if(wanted())connect()})}
function disconnect(){if(ws){const w=ws;ws=null;try{w.close()}catch(e){}}status='off';lastHello='';links={};runners={};readies={};dmLinkInfo=null}

// On page load (a restored save may hold agent-played heroes) and every few seconds after,
// so the relay always knows which heroes are played.
export function initBridge(){if(wanted())connect();every(3000,()=>{if(wanted()){if(!ws)connect();else hello()}});
  setInterval(behaviorTick,BEHAVIOR_MS);setInterval(mirrorTick,MIRROR_MS)}

// Behavior logs (issue #129): the world digest, game-side anomalies and settled Mind decisions (sim/behavior.js) go to
// the relay over this socket, which writes logs/behavior/<world>/ for the watcher. Read-only on the world; held
// (up to BEHAVIOR_HOLD records) while the socket is down, dropped beyond that. Never sent to any agent.
const BEHAVIOR_MS=500,BEHAVIOR_HOLD=200,watch=makeWatch({dmLink:()=>dmLink()}),held=[];
function behaviorTick(){let out;try{out=watch.tick()}catch(e){return}
  for(const o of out){held.push(o);if(held.length>BEHAVIOR_HOLD)held.shift()}
  if(!ws||ws.readyState!==1||status!=='connected')return;
  while(held.length){const o=held.shift();send({type:'behavior',kind:o.kind,rec:o.rec})}}

// Agent memories (issue #155): the notebooks that changed (sim/notebook.js mirrorDirty) go to the relay, which writes them as
// Markdown under logs/agents/<world>/ for the owner (scripts/memory-mirror.mjs). Only while connected; everything is sent
// again after a reconnect. The relay never sends any of it back, and no agent reads those files.
const MIRROR_MS=2000,sentMem=new Map();let sentWid=null;
function mirrorTick(){if(!ws||ws.readyState!==1||status!=='connected')return;let out;try{out=mirrorDirty(sentMem)}catch(e){return}
  if(!out.length)return;send({type:'mirror',seats:out.map(o=>o.seat)});for(const o of out)sentMem.set(o.key,o.sig)}
