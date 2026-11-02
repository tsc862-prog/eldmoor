// Agent player (issue #75): an AI agent plays one hero end to end through tools (the list is
// data/player-tools.js). This module is the game side and is DOM-free:
//   playerAct(id, tool, args)  one tool call for hero `id`; returns a plain result object
//   playerUpd(a, dt)           the reduced state machine for an a.player hero (sim/index.js
//                              calls it before updAgent; false hands the step to updAgent)
//   markPlayer(a, on)          make a hero agent-played or give it back to the scripted rules
//   waitOver / finishWait      the `wait` tool: the host polls these (sim/player-host.js)
//
// Rules an agent hero keeps (the same world, the same dice):
//   - Hardcore: one life. A dead hero's tools all answer "dead"; nothing respawns it.
//   - Sight: look reports what is within SIGHT tiles (scaled by weather), or the hero's town
//     when inside it. Other heroes' HP is never reported, only "wounded" when visibly so;
//     party members' HP only within sight.
//   - Hearing, not telepathy (issue #123): what others say reaches the hero only in the game, as
//     lines it hears (say within earshot, the party channel, townsfolk, the DM's narrate) in its
//     chat buffer; never the DM's notes or log, nor another hero's journal, memories, mind or prompt.
//   - Commands queue on a.pq and run through the ordinary movement and combat code
//     (moveTo, strike, findMob, priestHeal from heroes.js). Reflexes keep the hero alive
//     when the agent is slow or silent: defend when attacked (mobs pull the hero into a
//     fight as they do anyone), flee below FLEE HP, go home when the bag is full and idle.
//   - Crypt groups and raid musters do not draft an agent hero (it goes where it is told);
//     scripted heroes pulling it into their party are turned down unless it asked to join.
//   - Adventures are only taken through take_adventure (never auto-picked at the gate);
//     while one runs, the DM (sim/dm.js) leads the hero between scenes and asks for scene
//     choices through sim/player-choice.js, with a timeout so the world never waits.
//   - World-changing tools are rate limited (RATE per game hour).
// Everything on the hero is plain data and saves with the world: a.player, a.pq, a.journal, a.memories (#155),
// a.playLog (recent tool calls), a.playEv (events), a.playNarr (the runner's narration).
import {W,H} from '../world/tiles.js';
import {CITY,ZONES,REGIONS,LANDMARKS,CRYPT,zoneAt,zoneFor,zonePoint,dist} from '../world/map.js';
import {homeOf,raceOf} from '../data/races.js';
import {FAC} from '../data/factions.js';
import {CLS} from '../data/classes.js';
import {MOBS} from '../data/mobs.js';
import {TRAITS,tm} from '../data/traits.js';
import {GOODS,price,SLOTS,USES,INV,useLines} from '../data/items.js';
import * as D from '../data/adventures.js';
import {PLAYER_TOOLS} from '../data/player-tools.js';
import {S,clockStr,dayNo} from './state.js';
import {pop} from './effects.js';
import {maxHp,xpNeed,atkOf,moveTo,strike,priestHeal,findMob,turnIn,huntZone} from './heroes.js';
import {partyMates,leaderOf,leaveParty} from './party.js';
import {speak,say,agentLine} from './chat.js';
import {npcSay,ensureNpcs} from './npcs.js';
import {equip,makeItem,SHOP_COST,SELL_VALUE,slotLevel,weakestSlot,itemStats,gearScore,refreshEpics} from './gear.js';
import {weatherName,sightMul,isStorm} from './weather.js';
import {record,asSrc} from './history.js';
import {fleeCheck} from './narrator.js';
import {nearHeroes,nearMobs} from './spatial.js';
import {dmDepart,advLine,K as DMK} from './dm.js';
import {CHOICE_MIN} from './player-choice.js';
import {fellowCard} from './persona.js'; // Fellowship (#68)
import {ev} from './notify.js';
import {heroMemory} from './notebook.js'; // agent memories (#155)
import {reflexMay} from './runlink.js';
import {notEnglish} from './lang.js';
const ENGLISH='Not said: speak in English. Everyone in Eldmoor speaks English; say it again in English.'; // #126
import {spokenLine,partySay,partyRead,propose,castVote,propById,openProps,splitOff,followLead} from './council.js';
import {sceneAct,tableView} from './table.js';
import {MOVES} from '../data/moves.js';
import {movesOf,useMove,abilityView,abilityLine} from './moves.js'; // class abilities (#81)
import {invOf,used,capOf,isGear,kindOf,load,addGear,addUse,sellLoot,sellEntry,equipSpare,useItem,giveItem,dropEntry,fightAid} from './inv.js'; // the pack (#124)

// ---- knobs ----
export const PK={
  SIGHT:12,          // tiles a hero can see in clear weather
  TALK:4,            // tiles to a townsperson or hero to talk
  JOIN:6,            // tiles to a hero to join their party
  FLEE:.15,          // reflex: break off a fight below this share of max HP (no command says otherwise)
  RETREAT:.45,       // hunt command ends below this share of max HP (scaled by the retreat trait)
  BAG:8,             // reflex: idle in the field with this many bag entries -> go home
  REST_REGEN:.06,    // share of max HP per real second while resting (the DM's camp rate)
  RATE:12,           // world-changing tool calls per game hour
  HEAR_WAKE:15,      // game minutes: an agent's line heard starts the listener's turn at most this often (#126)
  IDLE:120,          // game minutes without a command or an action before autopilot carries on for the agent (#126)
  WAIT:[10,240],     // game minutes a wait may span
  WAIT_REAL_MS:45000,// a wait never holds the agent longer than this in real time (paused world, hidden tab)
  JOURNAL:100,JOURNAL_LEN:600,LOG:40,EV:40,EV_OUT:15,NARR:20,SAY_LEN:200, // EV_OUT: events handed back per tool result
};

// ---- helpers ----
const hero=id=>S.agents.find(x=>x.id===id)||null;
const pct=(h,m)=>Math.max(0,Math.round(h/m*100));
const r1=v=>Math.round(v*10)/10;
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const plain=parts=>(parts||[]).map(p=>typeof p==='string'?p:p&&p.kind==='hero'?p.name:p&&p.t||'').join('');
const day=()=>'Day '+(Math.floor(S.gameMin/1440)+1)+' '+clockStr();
const dayPart=()=>{const h=(S.gameMin/60)%24;return h<5||h>=21?'night':h<8?'dawn':h<18?'day':'dusk'};
const advOf=a=>a.adv&&S.adventures?S.adventures.find(v=>v.id===a.adv&&v.phase==='active')||null:null;
const mobName=m=>m.elite||m.named?m.name+(m.title?', '+m.title:''):MOBS[m.type]?MOBS[m.type].name:'monster';
const sightOf=a=>PK.SIGHT*sightMul(zoneAt(a.x,a.y));
const inRect=(c,p,pad=0)=>p.x>=c.x0-pad&&p.x<=c.x1+1+pad&&p.y>=c.y0-pad&&p.y<=c.y1+1+pad;
const cityAt=p=>CITY.find(c=>inRect(c,p,.5))||null;
const inTown=a=>a.state==='town';
const cmdOf=a=>a.pq&&a.pq.length?a.pq[0]:null;
const legal=['town','hunt','travel','return','fight','follow','regroup','duel','assist'];

// Events: what happened to the hero, handed to the agent with the next tool result.
function takeEvents(a){const seen=a.playEvSeen||0,out=(a.playEv||[]).filter(e=>e.n>seen).map(e=>e.t+' '+e.text);a.playEvSeen=a.playEvN||0;
  return out.length>PK.EV_OUT?['('+(out.length-PK.EV_OUT)+' earlier events not shown)',...out.slice(-PK.EV_OUT)]:out}
function done(a,text,urgent=true){if(a.pq&&a.pq.length)a.pq.shift();if(text)ev(a,text,urgent)}
const key=e=>e?e.t+'|'+e.text:'';
// Entries of list that came after the one whose key is k (all of them when k is not found).
function since(list,k){if(!list||!list.length)return [];if(!k)return list.slice(-3);for(let i=list.length-1;i>=0;i--)if(key(list[i])===k)return list.slice(i+1);return list.slice(-3)}

// Autopilot's next command (issue #126): what the hero's own reflexes and last order call for. In the field:
// rest when hurt, else hunt again when the last order was a hunt; in town it heals and waits; a Fellowship
// member follows its leader (the 'follow' state); a full bag already sends it home (field()).
function autopilot(a){const mh=maxHp(a),field=(a.state==='hunt'||a.state==='travel')&&!cityAt(a);
  if(!field)return null;
  if(a.hp<mh*.6)return {kind:'rest',until:S.gameMin+60,auto:'resting while hurt',label:'rest'};
  const o=a.playOrder;if(o&&o.kind==='hunt')return {kind:'hunt',n:o.n,k0:a.kills,flee:o.flee,auto:'hunting again (your last order: hunt '+o.n+')',label:'hunt'};
  return null}

// ---- marking ----
export function markPlayer(a,on){if(!a||a.kind!=='hero')return false;
  if(on){if(a.state==='dead')return false;a.player=true;a.playActAt=S.gameMin;a.playIdle=false;a.pq=a.pq||[];a.journal=a.journal||[];a.playLog=a.playLog||[];a.playEv=a.playEv||[];
    a.playW={hp:a.hp,lvl:a.lvl,state:a.state,kills:a.kills,hist:key((a.history||[]).slice(-1)[0]),chat:key((a.chat||[]).slice(-1)[0])};
    if(!S.playerHeroes)S.playerHeroes=[];if(!S.playerHeroes.includes(a.id))S.playerHeroes.push(a.id);
    ev(a,a.name+' wakes with a will of their own.');record(a,'Began to choose their own road.');return true}
  if(a.fellow&&a.state!=='dead')return false; // the Fellowship is always agent-played (#148): a member is handed back only by leaving
  a.player=false;a.pq=[];a.partyOk=false;a.playDoing=null;if(S.playerHeroes)S.playerHeroes=S.playerHeroes.filter(id=>id!==a.id);return true}
export const isPlayer=a=>!!(a&&a.player);

// ---- the reduced state machine ----
// Returns true when it handled the step; false hands it to updAgent (duels, assists, regroups,
// ghosts, a consented crypt or raid, following a party leader, and the DM-led legs of an adventure).
export function playerUpd(a,dt){if(!a.player||a.state==='dead')return false;
  watch(a);
  // A Fellowship member whose runner is gone, once the owner said go on (or with no host at all: the headless sim,
  // play-headless before a runner claims it): its reflexes play it whole, the scripted rules, until a runner holds
  // it again (#148). While a runner holds it, or the owner has not answered yet, autopilot below carries on.
  if(a.fellow&&reflexMay(a)){a.playIdle=false;a.playDoing='reflexes (no runner)';return false}
  // Drafts the agent did not ask for: a crypt group or a raid muster. Step back out.
  if(a.state==='dungeon'&&!a.hidden&&!a.cryptOk){a.state=cityAt(a)?'town':'hunt';a.dest=null;ev(a,'Turned down a call to '+CRYPT.name+' (you go only where you choose).')}
  if(a.state==='raid'&&a.raid&&!a.raidOk){a.raid=false;a.target=null;a.state=cityAt(a)?'town':'hunt';a.dest=null;ev(a,'Turned down a raid muster on Kragmaw.')}
  if(a.party&&!a.partyOk&&!a.party.fellow){leaveParty(a);ev(a,'Turned down a party (use join_party to join one).')} // the Fellowship's own party is always theirs
  const adv=advOf(a);
  // Autopilot (issue #126): no command and no action for PK.IDLE game minutes, outside an adventure or a scene.
  // The agent stays the hero's mind; until it acts again the hero carries on its last order and does what a
  // reflex would (rest when hurt, follow the party, fight back, go home when hurt or full), never the scripted rules.
  const lastAct=a.playActAt??(a.playActAt=S.gameMin);
  if(!cmdOf(a)&&!adv&&!tableView(a)&&S.gameMin-lastAct>=PK.IDLE){if(!a.playIdle){a.playIdle=true;ev(a,'No order from you for a while: autopilot carries on (your last order, rest when hurt, follow the party). Any command takes over.')}
    const ap=autopilot(a);if(ap){a.pq=[ap];a.playAuto=ap.label}}
  else if(a.playIdle&&S.gameMin-lastAct<PK.IDLE){a.playIdle=false;a.playAuto=null}
  const cmd=cmdOf(a);
  // A choice scene answered (or timed out): send the hero back to the scene point so the DM
  // reaches the choice again and takes the pick (sim/player-choice.js).
  if(adv&&adv.stage==='choose'&&adv.pick&&(adv.pick.chosen||S.gameMin>=adv.pick.until)){adv.pick.rearm=true;adv.stage='go';if(a.state==='hunt'||a.state==='travel'){a.state='travel';a.dest=null}}
  const driving=adv&&adv.lead===a.id&&(!a.party||a.party.leader===a);
  a.playDoing=doingText(a,adv,cmd);if(a.playIdle)a.playDoing='autopilot: '+(cmd&&cmd.auto?cmd.auto:a.playDoing||'standing watch');
  switch(a.state){
  case 'town':return town(a,dt,cmd);
  case 'follow':if(!cmd)return false;a.state='hunt';a.dest=null;return cmd.kind==='move'?travel(a,dt,cmd):field(a,dt,cmd);
  case 'fight':return fight(a,dt,cmd);
  case 'return':if(cmd)return travel(a,dt,cmd);a.cd-=dt;return homeward(a,dt);
  case 'travel':case 'hunt':
    if(cmd)return a.state==='travel'||cmd.kind==='move'?travel(a,dt,cmd):field(a,dt,cmd);
    if(driving)return false; // the DM leads the adventure's legs (dmTravel / dmHunt)
    if((a.partyOk||(a.party&&a.party.fellow))&&leaderOf(a)){a.state='follow';a.dest=null;return false}
    if(a.state==='travel'){a.state='hunt';a.dest=null}
    return field(a,dt,null);
  default:return false}}

// A line the hero heard (sim/chat.js, council.js party chat, an NPC, the DM's narrate), as the agent reads it.
const heardText=e=>e.from&&e.from.kind==='dm'?'The narrator: '+e.text:(e.party?'[party] ':'')+(e.from&&e.from.name||'Someone')+' says: "'+e.text+'"';
// Hearing (issue #126): a line from an agent-played hero (aloud in earshot, or on the party channel) starts the
// listener's turn promptly (2), at most once per PK.HEAR_WAKE game minutes per listener so two agents cannot
// talk each other into turns forever; the narrator, an NPC or a scripted companion's party line wake after the gap (1).
function hearWake(a,e){const f=e.from;
  if(f&&f.kind==='hero'&&f.player){if(S.gameMin-(a.playHeardAt??-1e9)>=PK.HEAR_WAKE){a.playHeardAt=S.gameMin;return 2}return 0}
  return e.party||f&&(f.kind==='dm'||f.kind==='npc')?1:0}
// Notice what changed since the last step and turn it into events.
function watch(a){const w=a.playW||(a.playW={hp:a.hp,lvl:a.lvl,state:a.state,kills:a.kills});const mh=maxHp(a);
  if(a.lvl>w.lvl)ev(a,'Reached level '+a.lvl+'.',true);
  if(a.kills>w.kills&&a.target==null&&a.state!=='fight')ev(a,'Made a kill ('+a.kills+' in all).');
  if(a.state!==w.state){
    if(a.state==='fight'&&a.target&&a.target.kind==='mob'&&a.target.target===a&&!(cmdOf(a)&&cmdOf(a).kind!=='move'))ev(a,'Attacked by '+(a.target.elite?'':'a level '+a.target.lvl+' ')+mobName(a.target)+'!',2);
    if(a.state==='duel'&&a.target)ev(a,'In a duel with '+a.target.name+' ('+FAC[a.target.fac].name+' '+a.target.cls+', level '+a.target.lvl+')!',2);
    if(a.state==='assist'&&a.target)ev(a,'Rushing to help against '+a.target.name+'.',2)}
  if(a.hp<mh*.3&&w.hp>=mh*.3)ev(a,'Badly hurt: '+pct(a.hp,mh)+'% HP.',2);
  if(a.playChoiceNew){a.playChoiceNew=false;const adv=advOf(a),p=adv&&adv.pick;
    if(p)ev(a,'A choice on '+(p.title||'your adventure')+': '+p.frame+'. a) '+p.opts.a+'  b) '+p.opts.b+'. choose() within '+Math.max(0,Math.round(p.until-S.gameMin))+' game minutes.',3)}
  const hs=since(a.history,w.hist);for(const e of hs)if(!/^Began to choose/.test(e.text))ev(a,e.text);if(a.history&&a.history.length)w.hist=key(a.history[a.history.length-1]);
  const cs=since(a.chat,w.chat);for(const e of cs)if(e.from!==a&&!(e.from&&e.from.kind!=='npc'&&e.from.id===a.id))ev(a,heardText(e),false,hearWake(a,e));if(a.chat&&a.chat.length)w.chat=key(a.chat[a.chat.length-1]);
  w.hp=a.hp;w.lvl=a.lvl;w.state=a.state;w.kills=a.kills}

function town(a,dt,cmd){const mh=maxHp(a);a.cd-=dt;a.hp=Math.min(mh,a.hp+mh*.3*dt);
  // Fellowship (#68): with nothing else to do, a member follows the leader out of town (leave_party to stay)
  if(!cmd&&a.party&&a.party.fellow&&a.party.leader!==a&&leaderOf(a)&&!a.splitUntil){const c=homeOf(a);
    cmd={kind:'move',legs:[{x:c.gate.x,y:c.gate.y,st:'town'}],last:'hunt',label:'the gate, following '+a.party.leader.name};a.pq=[cmd];ev(a,'The party is out with '+a.party.leader.name+'; you follow them out of '+c.name+'.')}
  if(cmd&&cmd.kind==='move')return travel(a,dt,cmd);
  if(cmd&&cmd.kind==='rest'){if(S.gameMin>=cmd.until||a.hp>=mh)done(a,'Rested. HP '+pct(a.hp,mh)+'%.');a.moving=false;return true}
  if(cmd)done(a,'Cannot '+cmd.kind+' inside the town walls.');
  a.moving=false;return true}

// Walk the legs of a move command. Each leg says which state the hero is in while walking it:
// 'town' inside the walls, 'return' heading for the home gate (monsters let it go), 'travel' out in the world.
function travel(a,dt,cmd){a.cd-=dt;const leg=cmd.legs&&cmd.legs[0];
  if(!leg){finishMove(a,cmd);return true}
  if(a.state!=='fight')a.state=leg.st;a.dest=null;const mh=maxHp(a);
  if(leg.st==='town')a.hp=Math.min(mh,a.hp+mh*.3*dt);else a.hp=Math.min(mh,a.hp+mh*.015*dt);
  if(moveTo(a,leg.x,leg.y,dt,leg.st==='town'?2.2:2.4)){cmd.legs.shift();if(!cmd.legs.length)finishMove(a,cmd)}
  return true}
function finishMove(a,cmd){a.moving=false;const last=cmd.last||'hunt';a.state=last;a.zone=zoneAt(a.x,a.y);
  done(a,cmd.flee?'Made it back to '+homeOf(a).name+'.':'Arrived: '+cmd.label+'.')}
// No command and heading home (fled, a party turning back, an adventure ended): walk to the gate.
function homeward(a,dt){const c=homeOf(a);if(moveTo(a,c.gate.x,c.gate.y,dt,2.4)){a.state='town';a.moving=false;ev(a,'Back in '+c.name+'.')}return true}

// Out in the world, not walking: hunt, rest, or stand and keep watch.
function field(a,dt,cmd){const mh=maxHp(a);a.cd-=dt;a.zone=zoneAt(a.x,a.y);
  if(a.state!=='hunt')a.state='hunt';
  if(cmd&&cmd.kind==='rest'){a.moving=false;a.hp=Math.min(mh,a.hp+mh*PK.REST_REGEN*dt);if(S.gameMin>=cmd.until||a.hp>=mh)done(a,'Rested. HP '+pct(a.hp,mh)+'%.');return true}
  a.hp=Math.min(mh,a.hp+mh*.025*dt);
  if(cmd&&cmd.kind==='fight'){const t=findTarget(cmd.id);
    if(!t||!alive(t)){done(a,t&&t.kind==='mob'&&!t.alive?'Slew '+(t.elite?t.name:'the '+mobName(t))+'.':'Your target is gone.');return true}
    if(t.kind==='mob'){a.target=t;a.state='fight';a.dest=null;return true}
    done(a,'Your foe is out of reach.');return true}
  if(cmd&&cmd.kind==='hunt'){const left=cmd.n-(a.kills-cmd.k0);
    if(left<=0){done(a,'Hunt done: '+cmd.n+' kill'+(cmd.n>1?'s':'')+'. HP '+pct(a.hp,mh)+'%.');return true}
    if(a.hp<mh*PK.RETREAT*tm(a,'retreat')){done(a,'Too hurt to keep hunting ('+pct(a.hp,mh)+'% HP).');return true}
    if(isStorm(a.zone)&&!cmd.stormSaid){cmd.stormSaid=true;ev(a,'A storm rolls over '+ZONES[a.zone]+'.',true)}
    a.scan-=dt;if(a.scan<=0){a.scan=.5;const m=findMob(a);if(m){a.target=m;a.state='fight';a.dest=null;return true}}
    if(!a.dest)a.dest=zonePoint(a.zone,a);if(moveTo(a,a.dest.x,a.dest.y,dt,1.8))a.dest=null;return true}
  if(cmd){done(a,'Cannot '+cmd.kind+' here.');return true}
  // idle reflex: a full bag goes home to be sold
  a.moving=false;
  if(load(a)>=PK.BAG){const c=homeOf(a);a.pq=[{kind:'move',legs:[{x:c.gate.x,y:c.gate.y,st:'return'},{x:c.ah.x,y:c.ah.y,st:'town'}],last:'town',label:'the '+c.name+' auction house (pack full)'}];ev(a,'Your pack is full of loot; heading home to sell.',true)}
  return true}

function fight(a,dt,cmd){const m=a.target,mh=maxHp(a);a.cd-=dt;
  if(!m||m.kind!=='mob'||!m.alive||m.gone){a.target=null;a.state=cmd&&cmd.kind==='move'?cmd.legs[0]?cmd.legs[0].st:'hunt':'hunt';
    if(cmd&&cmd.kind==='fight'){done(a,m&&!m.alive?'Slew '+(m.elite?m.name:'the '+mobName(m))+'.':'The fight is over.')}
    return true}
  const r=CLS[a.cls].range,d=dist(a,m);a.face=m.x>a.x?1:-1;
  if(d>r){moveTo(a,m.x,m.y,dt,2.4);return true}a.moving=false;
  if(!m.target)m.target=a;
  priestHeal(a,a.party?a.party.mem:[a]);
  if(a.cd<=0){strike(a,m);a.cd=1.1}
  asSrc('reflex',()=>fightAid(a,m)); // reflex: a potion or ward from the pack keeps the hero up while the agent thinks (sim/inv.js)
  if(a.state==='fight'){const fb=cmd&&cmd.flee!=null?cmd.flee:PK.FLEE;if(a.hp<mh*fb)asSrc('reflex',()=>flee(a,true))}
  return true}

// Break off: a monster lets go (one parting blow is rolled), a duel ends in a pull-back.
function flee(a,reflex){const t=a.target,c=homeOf(a);
  a.pq=[{kind:'move',legs:[{x:c.gate.x,y:c.gate.y,st:'return'}],last:'town',label:c.name,flee:true}];
  if(t&&t.kind==='hero'&&(a.state==='duel'||a.state==='assist')){if(t.target===a&&t.state==='duel'){t.state='hunt';t.target=null}a.target=null;a.state='return'}
  else{if(t&&t.target===a)t.target=null;a.target=null;a.state='return';if(t&&t.kind==='mob')fleeCheck(a,t)}
  pop(a.x,a.y-.8,'FLEE','#ffb060');ev(a,(reflex?'Your nerve breaks at '+pct(a.hp,maxHp(a))+'% HP: ':'')+'Fled toward '+c.name+'.',true);
  say(a,'flee',{mob:t&&t.kind==='mob'?mobName(t):'them'})}

const alive=t=>t&&(t.kind==='mob'?t.alive&&!t.gone:t.state!=='dead');
function findTarget(id){return S.mobs.find(m=>m.id===id)||S.agents.find(b=>b.id===id)||null}

// ---- what the hero is doing, for the card and the tools ----
function doingText(a,adv,cmd){
  if(a.state==='fight'&&a.target)return 'Fighting '+(a.target.elite?a.target.name:'a level '+a.target.lvl+' '+mobName(a.target));
  if(cmd){if(cmd.kind==='move')return (cmd.flee?'Fleeing to ':'Walking to ')+cmd.label;
    if(cmd.kind==='hunt')return 'Hunting in '+ZONES[zoneAt(a.x,a.y)]+' ('+Math.max(0,cmd.n-(a.kills-cmd.k0))+' to go)';
    if(cmd.kind==='rest')return 'Resting';
    if(cmd.kind==='fight')return 'Closing on a foe'}
  if(adv){if(adv.stage==='choose')return 'Weighing a choice on '+adv.title;return 'On an adventure: '+adv.title}
  if(a.state==='town')return 'Waiting in '+homeOf(a).name;
  if(a.state==='hunt')return 'Standing watch in '+ZONES[zoneAt(a.x,a.y)];
  if(a.state==='return')return 'Heading back to '+homeOf(a).name;
  return null}

// ---- places ----
const SPOT_ALIASES={'auction house':'ah','ah':'ah','market':'ah','quest giver':'qg','questgiver':'qg','quests':'qg','gate':'gate','graveyard':'grave','grave':'grave'};
function townSpot(c,name){const k=SPOT_ALIASES[name];if(k&&c[k])return {x:c[k].x,y:c[k].y,label:name};
  if(c.spots&&c.spots[name])return {x:c.spots[name].x,y:c.spots[name].y,label:'the '+name};
  ensureNpcs();const p=(S.npcs||[]).find(p=>p.town===c.name&&(p.name.toLowerCase()===name||p.role===name||p.title.toLowerCase()===name||(p.title+' '+p.name).toLowerCase()===name));
  if(p)return {x:p.x,y:p.y+.6,label:p.title+' '+p.name};return null}
const enemyNear=(a,p,r=12)=>CITY.some(c=>c.fac!==a.fac&&(dist(p,c.gate)<r||inRect(c,p,2)));
// Resolve a move_to target into legs, or {error}.
function plan(a,target){const t=clean(target,60).toLowerCase(),c=homeOf(a),here=inTown(a);
  if(!t)return {error:'Say where to go.'};
  const toTown=(p,label)=>({legs:here?[{x:p.x,y:p.y,st:'town'}]:[{x:c.gate.x,y:c.gate.y,st:'return'},{x:p.x,y:p.y,st:'town'}],last:'town',label});
  const toField=(p,label)=>({legs:here?[{x:c.gate.x,y:c.gate.y,st:'town'},{x:p.x,y:p.y,st:'travel'}]:[{x:p.x,y:p.y,st:'travel'}],last:'hunt',label});
  if(t==='home'||t==='town'||t===c.name.toLowerCase()){const p=c.spots&&c.spots.square||c.ah;return toTown(p,c.name)}
  const sp=townSpot(c,t);if(sp)return toTown(sp,sp.label+' in '+c.name);
  const z=ZONES.findIndex(n=>n.toLowerCase()===t);
  if(z>=0){const p=zonePoint(z,null,c.gate);if(enemyNear(a,p))return {error:'That part of '+ZONES[z]+' is under an enemy town wall.'};
    const band=REGIONS[z]&&REGIONS[z].band;const r=toField(p,ZONES[z]);if(band&&a.lvl<band[0]-2)r.warn=ZONES[z]+' is for levels '+band[0]+'-'+band[1]+'; you are level '+a.lvl+'.';return r}
  if(t==='crypt'||t===CRYPT.name.toLowerCase()||t==='the crypt')return toField({x:CRYPT.x,y:CRYPT.y+1.4},CRYPT.name+' (the entrance)');
  const lm=LANDMARKS.find(l=>l.name.toLowerCase()===t||l.kind===t);
  if(lm){const r=toField({x:lm.x,y:lm.y+(lm.r||1)+1},lm.name);if(lm.kind==='lair')r.warn='That is the lair of Kragmaw the Cinder Wyrm, level 20.';return r}
  const town=CITY.find(x=>x.name.toLowerCase()===t);
  if(town){if(town.fac!==a.fac)return {error:town.name+' is an enemy town. You would not leave it alive.'};return toField({x:town.gate.x,y:town.gate.y},'the gate of '+town.name)}
  const m=/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(t);
  if(m){const p={x:+m[1],y:+m[2]};if(!(p.x>=1&&p.y>=1&&p.x<W-1&&p.y<H-1))return {error:'That is off the map (0-'+W+', 0-'+H+').'};
    if(enemyNear(a,p))return {error:'That is under an enemy town wall.'};
    const ct=cityAt(p);if(ct&&ct===c)return toTown(p,'('+p.x+', '+p.y+') in '+c.name);
    return toField(p,'('+p.x+', '+p.y+') in '+(ZONES[zoneAt(p.x,p.y)]||'the wilds'))}
  return {error:'Unknown place "'+target+'". Try a town spot (auction house, quest giver, gate, inn, smith, chapel, square), "home", a region ('+ZONES.join(', ')+'), "crypt", or "x,y".'}}

// ---- the tools ----
const need=(cond,msg)=>{if(!cond)throw new Rule(msg)};
class Rule extends Error{}
const fieldState=a=>['hunt','travel','follow','return'].includes(a.state);

function seen(a){const R=sightOf(a),here=inTown(a)?homeOf(a):null,out={heroes:[],monsters:[],townsfolk:[]};
  const vis=p=>dist(a,p)<=R||(here&&inRect(here,p,1));
  const qr=here?Math.max(R,Math.hypot(here.w,here.h)):R;
  for(const b of nearHeroes(a.x,a.y,qr)){if(b===a||b.hidden||b.state==='dead'||!vis(b))continue;
    const mate=a.party&&b.party===a.party,o={id:b.id,name:b.name,fac:FAC[b.fac].name,cls:b.cls,lvl:b.lvl,dist:r1(dist(a,b)),doing:b.state};
    if(mate)o.party=true,o.hp=pct(b.hp,maxHp(b))+'%';else if(b.hp<maxHp(b)*.5)o.wounded=true;
    if(b.guild)o.guild=b.guild.tag;out.heroes.push(o);if(out.heroes.length>=10)break}
  for(const m of nearMobs(a.x,a.y,R)){if(!m.alive||m.gone)continue;
    const o={id:m.id,name:mobName(m),lvl:m.lvl,dist:r1(dist(a,m))};if(m.elite||m.named)o.named=true;if(m.target===a)o.onYou=true;else if(m.target)o.busy=true;
    if(m.hp<m.maxhp)o.hurt=pct(m.hp,m.maxhp)+'%';out.monsters.push(o)}
  out.monsters.sort((x,y)=>x.dist-y.dist);out.monsters=out.monsters.slice(0,10);
  if(here){ensureNpcs();for(const p of S.npcs||[])if(p.town===here.name)out.townsfolk.push({name:p.title+' '+p.name,role:p.role,dist:r1(dist(a,p))})}
  if(!out.townsfolk.length)delete out.townsfolk;
  return out}

function choiceInfo(a){const adv=advOf(a),p=adv&&adv.pick;if(!p||p.chosen||adv.stage!=='choose')return null;
  return {adventure:adv.title,scene:p.frame,options:{a:p.opts.a,b:p.opts.b},minutes_left:Math.max(0,Math.round(p.until-S.gameMin))}}

const T={
  look(a){const z=zoneAt(a.x,a.y),here=inTown(a)?homeOf(a):null,s=seen(a);
    const r={ok:true,time:day()+' ('+dayPart()+')',where:here?'inside '+here.name+' ('+FAC[here.fac].name+')':(ZONES[z]||'the wilds'),pos:[r1(a.x),r1(a.y)],
      weather:weatherName(z),you:{hp:pct(a.hp,maxHp(a))+'%',state:a.state,doing:a.playDoing||null},sight:here?'the whole town':Math.round(sightOf(a))+' tiles',...s};
    const ch=choiceInfo(a);if(ch)r.choice=ch;const tv=tableView(a);if(tv)r.table=tv;
    const near=LANDMARKS.filter(l=>dist(a,l)<20).map(l=>l.name+' ('+r1(dist(a,l))+' tiles)');if(near.length)r.landmarks=near;
    return r},
  status(a){const mh=maxHp(a),q=a.quest,adv=advOf(a),c=homeOf(a);
    const r={ok:true,name:a.name,people:raceOf(a).name,cls:a.cls,faction:FAC[a.fac].name,home:c.name,level:a.lvl,
      xp:a.lvl>=20?'max':Math.round(a.xp)+'/'+xpNeed(a.lvl),hp:Math.round(a.hp)+'/'+mh,attack:Math.round(atkOf(a)),gear_score:r1(gearScore(a)),gold:a.gold,
      state:a.state,doing:a.playDoing||null,queue:(a.pq||[]).map(cmdText),
      traits:(a.traits||[]).map(t=>t+(TRAITS[t]?' ('+TRAITS[t].desc+')':'')),origin:a.origin||null,
      oath:a.goal?a.goal.text+(a.goal.done?' (kept)':' ('+(a.goal.progress||0)+'/'+a.goal.need+')'):null,
      quest:q?(MOBS[q.type].q||q.type)+': kill '+q.need+' '+MOBS[q.type].pl+' in '+ZONES[MOBS[q.type].z]+' ('+q.have+'/'+q.need+')'+(q.have>=q.need?' - done, turn it in at home':''):null,
      abilities:abilityView(a).filter(r=>r.learned).map(abilityLine),hunting_ground:ZONES[huntZone(a)],guild:a.guild?'<'+a.guild.tag+'> '+a.guild.name:null,kills:a.kills,honor:a.honor};
    if(a.party)r.party=a.party.mem.filter(b=>b!==a).map(b=>b.name+' (id '+b.id+', '+b.cls+' L'+b.lvl+(dist(a,b)<=sightOf(a)?', '+pct(b.hp,maxHp(b))+'% HP':', out of sight')+')'+(a.party.leader===b?' leads':''));
    if(a.party&&a.party.leader===a)r.party_lead=true;
    if(adv)r.adventure=plain(advLine(a));const ch=choiceInfo(a);if(ch)r.choice=ch;
    if(a.fellow){const fc=fellowCard(a);if(fc)r.fellowship=fc;const P=a.party&&a.party.fellow?a.party:null;if(P){r.party_leader=P.leader.name;if(P.dest)r.party_heading=P.dest.label}
      const op=openProps().map(propText);if(op.length)r.proposals=op;const tv=tableView(a);if(tv)r.table=tv} // Fellowship (#68): persona, memory, companions, council, table
    const nm=Object.keys(a.nemesis||{}).map(id=>hero(+id)).filter(x=>x&&x.state!=='dead').map(x=>x.name);if(nm.length)r.nemesis=nm;
    r.places=['home','auction house','quest giver','gate','inn','smith','chapel','square',...ZONES.map((n,i)=>n+(REGIONS[i]&&REGIONS[i].band?' (L'+REGIONS[i].band[0]+'-'+REGIONS[i].band[1]+')':'')),'crypt',...CITY.filter(x=>x.fac===a.fac&&x!==c).map(x=>x.name)];
    return r},
  inventory(a){const slots={};for(const k of SLOTS){const it=a.slots&&a.slots[k];slots[k]=it?itemText(it):null}
    // Only this hero's own pack (inventory, #124): stacks, spare gear, consumables and quest items, by index.
    return {ok:true,gold:a.gold,slots,capacity:{used:used(a),max:capOf(a)},items:invOf(a).list.map((e,i)=>({index:i,kind:kindOf(e),item:entryText(e)}))}},
  use_item(a,{index,target_id}){const i=Number(index),e=invOf(a).list[i];need(e&&!isGear(e)&&e.kind==='use','No usable item at pack index '+index+'.');
    let on=a;if(target_id!=null&&Number(target_id)!==a.id){on=hero(Number(target_id));need(on&&on.kind==='hero'&&on.state!=='dead','No such party member.')}
    const r=useItem(a,e.id,on);need(r.ok,r.error);return {ok:true,result:r.text,hp:pct(a.hp,maxHp(a))+'%',pack:invOf(a).list.length+'/'+capOf(a)}},
  use_ability(a,{ability,target_id}){const key=String(ability==null?'':ability).toLowerCase().replace(/[^a-z]/g,'');
    const id=movesOf(a).find(i=>i===key||MOVES[i].name.toLowerCase().replace(/[^a-z]/g,'')===key);
    need(id,'You have no ability "'+ability+'". Yours: '+(movesOf(a).map(i=>MOVES[i].name).join(', ')||'none yet')+'.');
    const M=MOVES[id];let t=null;
    if(M.target==='foe'){t=target_id!=null?findTarget(Number(target_id)):a.target;need(t&&alive(t)&&!t.hidden,'Name a living foe in sight (target_id from look), or be in a fight with one.')}
    else if(M.target==='ally'){t=target_id!=null&&Number(target_id)!==a.id?hero(Number(target_id)):a;need(t&&t.kind==='hero'&&t.state!=='dead','No such friend.')}
    const r=useMove(a,id,t,{mates:a.party?a.party.mem:[a],foe:a.target&&a.target.kind!=='hero'?a.target:null});need(r.ok,r.error);
    if(M.swing)a.cd=Math.max(a.cd,0)+1.1; // an attack ability takes the place of a weapon blow
    if(t&&t.kind==='mob'&&M.target==='foe'){if(!t.target)t.target=a;if(a.state==='hunt'||a.state==='travel'){a.state='fight';a.target=t;a.dest=null}}
    return {ok:true,result:r.text,hp:pct(a.hp,maxHp(a))+'%',cooldown_s:M.cd}},
  drop(a,{index,count}){const r=dropEntry(a,Number(index),count);need(r.ok,r.error);return {ok:true,result:r.text}},
  give(a,{index,hero_id,count}){const b=hero(Number(hero_id));need(b&&b!==a&&b.state!=='dead','No such hero.');const r=giveItem(a,b,Number(index),count);need(r.ok,r.error);return {ok:true,result:r.text}},
  move_to(a,{target}){need(legal.includes(a.state),'You cannot walk away right now ('+a.state+').');
    need(a.state!=='fight'&&a.state!=='duel'&&a.state!=='assist','You are in a fight. flee() first.');
    const p=plan(a,target);if(p.error)throw new Rule(p.error);
    a.pq=[{kind:'move',legs:p.legs,last:p.last,label:p.label}];if(a.state==='follow')a.state='hunt';a.dest=null;
    const r={ok:true,going:p.label,distance:r1(p.legs.reduce((t,l,i)=>t+dist(i?p.legs[i-1]:a,l),0))};if(p.warn)r.warning=p.warn;return r},
  talk(a,{target}){const t=clean(target,60).toLowerCase();need(t,'Talk to whom?');
    ensureNpcs();const here=cityAt(a);
    const p=(S.npcs||[]).find(p=>(!here||p.town===here.name)&&(p.name.toLowerCase()===t||p.role===t||p.title.toLowerCase()===t||(p.title+' '+p.name).toLowerCase()===t));
    if(p){need(dist(a,p)<=PK.TALK,p.title+' '+p.name+' is too far away ('+r1(dist(a,p))+' tiles). move_to("'+p.role+'") first.');
      if(p.fac!==a.fac)return {ok:true,who:p.title+' '+p.name,answer:'('+p.name+' looks at you with open contempt and says nothing.)'};
      const before=p.lastBark;npcSay(p,'greet',{target:a.name},{dm:true});const line=p.bubble&&p.lastBark!==before?p.bubble.text:p.bubble?p.bubble.text:null;
      return {ok:true,who:p.title+' '+p.name,answer:line||'('+p.name+' nods.)'}}
    const id=Number(target),b=S.agents.find(x=>x!==a&&x.state!=='dead'&&(x.id===id||x.name.toLowerCase()===t));
    need(b,'Nobody called "'+target+'" is here.');need(dist(a,b)<=PK.TALK*1.5,b.name+' is too far away to talk to.');
    if(b.fac!==a.fac)return {ok:true,who:b.name,answer:'('+b.name+' of the '+FAC[b.fac].name+' answers with a hand on their weapon.)'};
    const n=(b.chat||[]).length;say(b,'idle',{});const e=(b.chat||[])[(b.chat||[]).length-1];
    return {ok:true,who:b.name,answer:(b.chat||[]).length>n&&e&&e.from===b?e.text:'('+b.name+' is busy and does not answer.)'}},
  say(a,{text}){const L=spokenLine(a,text,PK.SAY_LEN);need(!L.error,L.error);const t=L.text;need(!notEnglish(t),ENGLISH);need(a.state!=='ghost','Ghosts do not speak.');
    agentLine(a,speak(a,t,'agent'));const heard=nearHeroes(a.x,a.y,7).filter(b=>b!==a&&b.state!=='dead'&&!b.hidden).length;return {ok:true,said:t,heard_by:heard}},
  join_party(a,{hero_id}){const b=hero(Number(hero_id));need(b&&b!==a&&b.state!=='dead','No such hero.');
    if(a.fellow&&b.fellow){delete a.splitUntil;a.partyOk=true;return {ok:true,note:'You will fall in with the Fellowship again the next time you meet them in town or on the road.'}}
    need(b.fac===a.fac,b.name+' is of the '+FAC[b.fac].name+'.');need(dist(a,b)<=PK.JOIN,b.name+' is too far away (within '+PK.JOIN+' tiles).');
    need(Math.abs(b.lvl-a.lvl)<=3,'Too far apart in level (more than 3).');need(!['dungeon','raid','duel','ghost'].includes(b.state),b.name+' is busy.');
    need(tm(b,'social')||b.player,b.name+' is a loner and will not travel with anyone.');
    if(a.party&&a.party===b.party)return {ok:true,party:a.party.mem.map(x=>x.name),note:'Already together.'};
    if(a.party)leaveParty(a);
    let p=b.party;
    if(p){need(p.mem.length<3,b.name+'\'s party is full.');p.mem.push(a)}
    else{p={id:++S.uid,fac:a.fac,leader:b.lvl>a.lvl?b:a,mem:[b,a],zone:zoneAt(b.x,b.y)>0?zoneAt(b.x,b.y):huntZone(b.lvl<a.lvl?b:a),home:false};b.party=p;S.parties.push(p)}
    a.party=p;a.partyOk=true;for(const m of p.mem)if(m.lvl>p.leader.lvl)p.leader=m;
    record(a,'Joined ',b,' on the road.');record(b,a.name+' joined them.');
    return {ok:true,party:p.mem.map(x=>x.name),leader:p.leader.name}},
  leave_party(a){if(a.fellow){need(!a.splitUntil,'You have already gone your own way.');splitOff(a,false);a.partyOk=false;
      return {ok:true,note:'You go your own way for a while ('+Math.round((a.splitUntil-S.gameMin)/60)+' game hours); your companions think less of you for it. join_party with a companion to come back sooner.'}}
    need(a.party,'You are not in a party.');leaveParty(a);a.partyOk=false;return {ok:true}},
  list_jobs(a){need(inTown(a),'Jobs are posted at your town gate. Go home first.');const c=homeOf(a),mem=[a,...partyMates(a)];
    const mine=advOf(a);const out=[];
    if(mine)out.push({id:mine.id,title:mine.title,yours:true,resume:true,scene:plain(advLine(a))});
    for(const h of (S.adventures||[]))if(h.phase==='open'&&h.town===c.name){const w=jobFit(a,h,mem);
      out.push({id:h.id,job:jobText(h),giver:h.giver?h.giver.name:'the gate captain',where:h.zone!=null?ZONES[h.zone]:'near your hunting ground',for_you:h.for!=null?h.for===a.id:undefined,fits:!w,why_not:w||undefined,
        expires_in_min:Math.max(0,Math.round(h.until-S.gameMin))})}
    return {ok:true,jobs:out,note:out.length?undefined:'Nothing posted right now; jobs refill every few game hours.'}},
  take_adventure(a,{job_id}){need(inTown(a),'Take jobs at your town gate. Go home first.');const id=Number(job_id),c=homeOf(a),mem=[a,...partyMates(a)];
    need(!(a.party&&a.party.leader!==a),'Your party leader decides which job the party takes.');
    const mine=advOf(a);
    if(mine){need(mine.id===id,'You already have an adventure ('+mine.title+', id '+mine.id+'). Resume it with that id.');
      a.pq=[];const ok=dmDepart(a,c);need(ok,'The adventure could not resume.');return {ok:true,resumed:mine.title,scene:plain(advLine(a))}}
    const h=(S.adventures||[]).find(x=>x.id===id&&x.phase==='open'&&x.town===c.name);need(h,'No open job '+id+' at '+c.name+'.');
    const w=jobFit(a,h,mem);need(!w,w);
    // Offer only this job to the DM: the others are held back for the moment and the job is
    // marked as personal to this hero, so the scripted DM's pickHook takes it without a roll.
    const held=(S.adventures||[]).filter(x=>x!==h&&x.phase==='open'&&x.town===c.name);for(const x of held)x.phase='held';
    const forWas=h.for;h.for=a.id;a.pq=[];let ok=false;
    try{ok=dmDepart(a,c)}finally{for(const x of held)if(x.phase==='held')x.phase='open';if(h.phase==='open'||forWas==null)h.for=forWas}
    need(ok&&a.adv===h.id,'The job-giver turned you away.');
    const adv=advOf(a);return {ok:true,adventure:adv.title,scenes:adv.scenes.length,scene:plain(advLine(a)),note:'The adventure now leads you. Scene choices wait for choose(); fights are real.'}},
  choose(a,{option}){const o=clean(option,4).toLowerCase();need(o==='a'||o==='b','Choose "a" or "b".');const adv=advOf(a),p=adv&&adv.pick;
    need(p&&adv.stage==='choose'&&!p.chosen,'No choice is waiting for you.');need(S.gameMin<p.until,'Too late: the moment passed.');
    p.chosen=o;return {ok:true,chose:o+') '+p.opts[o]}},
  fight(a,{target_id,flee_below}){need(fieldState(a)||a.state==='fight','You can only pick a fight out in the world.');
    const t=findTarget(Number(target_id));need(t&&alive(t)&&!t.hidden,'No such target.');need(dist(a,t)<=sightOf(a),'You cannot see that from here.');
    const fb=flee_below==null?PK.FLEE:Math.min(.6,Math.max(.05,Number(flee_below)/100));
    if(t.kind==='mob'){need(!(t.target&&t.target!==a&&t.target.state!=='dead'),'Someone else is already fighting it.');
      a.pq=[{kind:'fight',id:t.id,flee:fb}];a.target=t;a.state='fight';a.dest=null;
      return {ok:true,target:mobName(t)+' L'+t.lvl,warning:t.lvl>a.lvl+2?'It is '+(t.lvl-a.lvl)+' levels above you.':undefined}}
    need(t.kind==='hero'&&t!==a,'No such target.');need(t.fac!==a.fac,'You will not raise a hand against your own faction.');
    need(zoneAt(a.x,a.y)>=1&&zoneAt(t.x,t.y)>=1,'Thornvale is the peaceful vale: no duels there.');
    need(['hunt','travel','return','follow'].includes(t.state),t.name+' is not free to be challenged right now.');
    a.pq=[];a.state=t.state='duel';a.target=t;t.target=a;a.dest=t.dest=null;record(a,'Challenged ',t,'.');
    return {ok:true,duel:t.name+' ('+t.cls+' L'+t.lvl+')',note:'A duel runs until one falls or breaks off; you break off on your own at low HP, or flee().'}},
  hunt(a,{count,flee_below}){need(fieldState(a)&&!inTown(a),'Hunt out in the world, not in town: move_to a region first.');need(a.state!=='return','You are heading home.');
    const n=Math.min(10,Math.max(1,Math.round(Number(count)||3)));
    a.pq=[{kind:'hunt',n,k0:a.kills,flee:flee_below==null?PK.FLEE:Math.min(.6,Math.max(.05,Number(flee_below)/100))}];a.state='hunt';a.dest=null;
    return {ok:true,hunting:n+' kill'+(n>1?'s':'')+' in '+ZONES[zoneAt(a.x,a.y)]}},
  flee(a){need(['fight','duel','assist'].includes(a.state),'You are not in a fight.');flee(a,false);return {ok:true,fleeing_to:homeOf(a).name,hp:pct(a.hp,maxHp(a))+'%'}},
  rest(a,{minutes}){need(a.state==='hunt'||a.state==='town'||a.state==='travel'||a.state==='follow','You cannot rest now ('+(a.state==='return'?'you are heading home; rest in town':a.state)+').');
    if(a.state==='travel'||a.state==='follow')a.state='hunt'; // stop walking and sit down where you are
    const m=Math.min(240,Math.max(10,Math.round(Number(minutes)||60)));a.pq=[{kind:'rest',until:S.gameMin+m}];a.dest=null;return {ok:true,resting_min:m}},
  buy(a,{slot,item,count}){need(inTown(a),'The smiths are in town.');
    if(item!=null&&item!==''){const id=Object.keys(USES).find(x=>x.toLowerCase()===String(item).toLowerCase());
      need(id,'Not sold here. For sale: '+Object.keys(USES).filter(x=>USES[x].lvl<=a.lvl).map(x=>x+' ('+USES[x].price+'g)').join(', ')+'.');
      const U=USES[id];need(U.lvl<=a.lvl,id+' is sold from level '+U.lvl+'.');const n=Math.min(10,Math.max(1,Math.round(Number(count)||1)));
      need(a.gold>=U.price,'That costs '+U.price+'g each; you have '+a.gold+'g.');
      if(U.kind==='pack'){need(!invOf(a).pack,'You already carry a Wayfarer\'s Pack.');a.gold-=U.price;invOf(a).pack=1;return {ok:true,bought:id,cost:U.price,gold:a.gold,capacity:capOf(a)}}
      let got=0;while(got<n&&a.gold>=U.price&&addUse(a,id,1)){a.gold-=U.price;got++}need(got,'Your pack is full ('+used(a)+'/'+capOf(a)+').');
      return {ok:true,bought:id+' x'+got,cost:got*U.price,gold:a.gold}}
    const k=slot?String(slot):weakestSlot(a);need(k&&SLOTS.includes(k),'No slot to fill.');
    const cur=a.slots[k];need(!(cur&&cur.epic),'An epic holds that slot.');need(slotLevel(a,k)<a.lvl,'Nothing better than your '+(cur?cur.name:'gear')+' (item level '+slotLevel(a,k)+') is for sale at your level.');
    const cost=SHOP_COST(a.lvl);need(a.gold>=cost,'That costs '+cost+'g; you have '+a.gold+'g.');
    refreshEpics(a);a.gold-=cost;const it=makeItem(a.cls,k,a.lvl,zoneFor(a.lvl),{src:'Bought in '+homeOf(a).name,rare:0});
    const old=equip(a,it);if(old)addGear(a,old);a.hp=Math.min(a.hp,maxHp(a));
    return {ok:true,bought:itemText(it),cost,gold:a.gold,replaced:old?itemText(old)+' (now in your pack)':null}},
  sell(a,{index}){need(inTown(a),'The auction house is in town.');let tot=0,n=0;
    if(index!=null){const i=Number(index);need(i>=0&&i<used(a),'No pack entry '+index+'.');tot=sellEntry(a,i);need(tot>=0,'That cannot be sold (consumables and quest items are kept).');n=1}
    else{const s=sellLoot(a);tot=s.gold;n=s.n}
    need(n,'Nothing to sell.');a.gold+=tot;return {ok:true,sold:n,gold_gained:tot,gold:a.gold}},
  equip(a,{index}){need(!['fight','duel','assist'].includes(a.state),'Not in the middle of a fight.');const i=Number(index);
    const it=invOf(a).list[i];need(isGear(it),'No gear at pack index '+index+'.');need(!it.cls||it.cls===a.cls||it.epic,'That is made for a '+it.cls+'.');need(it.ilvl<=a.lvl+INV.WEAR_OVER,'Too far above your level to wear.');
    const old=equipSpare(a,it);a.hp=Math.min(a.hp,maxHp(a));return {ok:true,wearing:itemText(it),replaced:old?itemText(old)+' (now in your pack)':null}},
  turn_in(a){need(inTown(a),'The quest giver is in town.');const q=a.quest,doneQ=q&&q.have>=q.need,g=a.gold,x=a.xp,l=a.lvl;turnIn(a);
    const nq=a.quest?(MOBS[a.quest.type].q)+': '+a.quest.need+' '+MOBS[a.quest.type].pl+' in '+ZONES[MOBS[a.quest.type].z]:null;
    return doneQ?{ok:true,reward_gold:a.gold-g,leveled:a.lvl>l||undefined,new_quest:nq}:{ok:false,error:'Your quest is not done ('+(q?q.have+'/'+q.need:'none')+').',quest:nq}},
  read_chronicle(a,{n}){const k=Math.min(20,Math.max(1,Math.round(Number(n)||8)));return {ok:true,news:S.chronicle.slice(0,k).map(e=>e.t+' '+plain(e.parts))}},
  journal_read(a,{n}){const k=Math.min(50,Math.max(1,Math.round(Number(n)||10)));return {ok:true,entries:(a.journal||[]).slice(-k).map(e=>e.t+': '+e.text),total:(a.journal||[]).length}},
  journal_write(a,{text}){const t=clean(text,PK.JOURNAL_LEN);need(t,'Write what?');const j=a.journal||(a.journal=[]);j.push({t:day(),gameMin:Math.round(S.gameMin),text:t});if(j.length>PK.JOURNAL)j.shift();return {ok:true,entries:j.length}},
  // memories (issue #155, sim/notebook.js): the hero's own notebook only
  remember:(a,x)=>heroMemory(a,'remember',x),recall:(a,x)=>heroMemory(a,'recall',x),update_memory:(a,x)=>heroMemory(a,'update_memory',x),forget:(a,x)=>heroMemory(a,'forget',x),pin:(a,x)=>heroMemory(a,'pin',x),
  party_say(a,{text}){need(a.state!=='ghost','Ghosts do not speak.');need(!notEnglish(text),ENGLISH);const n=partySay(a,text);if(typeof n==='string')throw new Rule(n);const e=a.chat&&a.chat[a.chat.length-1];agentLine(a,e);return {ok:true,said:e?e.text:'',heard_by:n}},
  party_read(a,{n}){return {ok:true,lines:partyRead(a,Math.round(Number(n)||10))}},
  chat_read(a,{n}){const k=Math.min(20,Math.max(1,Math.round(Number(n)||10)));return {ok:true,lines:(a.chat||[]).slice(-k).map(e=>e.t+' '+(e.from===a||e.from&&e.from.kind!=='npc'&&e.from.id===a.id?'(you) '+e.text:heardText(e)))}},
  propose(a,{kind,details,job_id}){need(a.fellow,'Only a Fellowship member can put something to the party.');const P=propose(a,String(kind||'').toLowerCase(),details,{job:job_id});
    if(typeof P==='string')throw new Rule(P);return {ok:true,proposal:propText(P),status:P.status,note:P.status==='open'?'The others vote; the leader settles it when all have voted or in '+Math.round(P.until-S.gameMin)+' game minutes.':P.result}},
  vote(a,{proposal_id,vote,reason}){need(a.fellow,'Only Fellowship members vote.');const P=propById(proposal_id);need(P,'No proposal '+proposal_id+'.');
    const sc=tableView(a);if(sc&&sc.kind==='decision'&&!sc.acted&&S.table&&S.table.ctx.prop===P.id){const x=sceneAct(a,vote,reason);if(typeof x==='string')throw new Rule(x);return {ok:true,voted:x.k,note:'Counted at the table on your turn.'}}
    const x=castVote(a,P.id,vote,reason,'agent');if(typeof x==='string')throw new Rule(x);return {ok:true,voted:String(vote).toLowerCase(),proposal:propText(P)}},
  lead_to(a,{target}){need(a.fellow&&a.party&&a.party.fellow,'You are not with the Fellowship.');need(a.party.leader===a,'Only the leader ('+a.party.leader.name+') leads the party.');
    need(legal.includes(a.state),'You cannot lead from here ('+a.state+').');need(a.state!=='fight'&&a.state!=='duel'&&a.state!=='assist','You are in a fight. flee() first.');
    const p=plan(a,target);if(p.error)throw new Rule(p.error);a.pq=[{kind:'move',legs:p.legs,last:p.last,label:p.label}];if(a.state==='follow')a.state='hunt';a.dest=null;
    const n=followLead(a,p.label);const r={ok:true,leading:p.label,followers:n};if(p.warn)r.warning=p.warn;return r},
  scene_act(a,{option,line}){const x=sceneAct(a,option,line);if(typeof x==='string')throw new Rule(x);const v=tableView(a);
    return {ok:true,chose:x.k,said:x.line||undefined,note:v&&v.your_turn?'Done; it happens now.':'Locked in; it happens on your turn.'}},
  wait(a,{minutes}){const m=Math.min(PK.WAIT[1],Math.max(PK.WAIT[0],Math.round(Number(minutes)||60)));
    return {ok:true,pending:{hero:a.id,from:S.gameMin,until:S.gameMin+m,mark:a.playEvN||0,realMs:PK.WAIT_REAL_MS}}},
};
function propText(P){const v=Object.keys(P.votes||{}).length;return '#'+P.id+' '+P.kind+': '+P.details+' (by '+P.byName+', '+v+' vote'+(v===1?'':'s')+(P.status!=='open'?', '+P.result:'')+')'}
function cmdText(c){if(c.kind==='move')return (c.flee?'flee to ':'walk to ')+c.label;if(c.kind==='hunt')return 'hunt ('+c.n+' kills)';if(c.kind==='rest')return 'rest until '+Math.round(c.until)+' game-min';if(c.kind==='fight')return 'fight #'+c.id;return c.kind}
function entryText(e){if(isGear(e))return itemText(e)+(e.cls&&!e.epic?' ['+e.cls+' gear]':'')+', sells '+SELL_VALUE(e)+'g';
  if(e.kind==='good')return e.id+' x'+e.n+(GOODS[e.id]?' (sells for about '+price(e.id)+'g each)':'');
  if(e.kind==='use')return e.id+' x'+e.n+' ('+useLines(e.id).map(l=>l[1]).join('; ')+')';
  return e.id+' (quest item: cannot be sold, dropped or given)'}
function itemText(it){if(!it)return null;const st=itemStats(it);return it.name+' (ilvl '+it.ilvl+(it.epic?', epic':it.quality&&it.quality!=='plain'?', '+it.quality:'')+(it.slot?', '+it.slot:'')+': '+Object.keys(st).map(k=>'+'+st[k]+' '+k).join(' ')+(it.property?' '+it.property:'')+')'}
function jobText(h){const T=D.ADVENTURES[h.tpl];const thing=h.data&&h.data.thing;return (T&&T.name?T.name:h.tpl)+(thing?': '+thing:'')+(h.data&&h.data.beast?' ('+h.data.beast+')':'')}
// Why a job does not suit this hero (and party), or null. The DM's own fits() decides in the end.
function jobFit(a,h,mem){const T=D.ADVENTURES[h.tpl];if(!T)return 'unknown job';const lo=Math.min(...mem.map(b=>b.lvl));
  if(h.for!=null&&!mem.some(b=>b.id===h.for))return 'it is meant for someone else';
  if(lo<Math.max(DMK.MIN_LVL,T.lvl||0))return 'needs level '+Math.max(DMK.MIN_LVL,T.lvl||0);
  if(mem.length<T.size[0])return 'needs a party of '+T.size[0]+'+';if(mem.length>T.size[1])return 'for at most '+T.size[1];
  if(h.data&&h.data.eliteId!=null&&mem.length<2)return 'a hunt for a named beast needs a party';
  return null}

// ---- the entry point ----
const TOOL_META=Object.fromEntries(PLAYER_TOOLS.map(t=>[t.name,t]));
export function playerAct(id,tool,args={}){const a=hero(Number(id));
  if(!a)return {ok:false,error:'No such hero.'};
  if(!a.player)return {ok:false,error:a.name+' is not agent-played.'};
  if(a.state==='dead'){const r={ok:false,dead:true,error:a.name+' is dead ('+(a.cause||'fallen')+', at '+(a.diedAt||'?')+'). Hardcore: one life. Their story is over.'};logCall(a,tool,args,r);return r}
  const meta=TOOL_META[tool],fn=T[tool];if(!meta||!fn)return {ok:false,error:'Unknown tool '+tool+'.'};
  if(meta.act){const st=a.playRate||(a.playRate=[]);while(st.length&&st[0]<S.gameMin-60)st.shift();
    if(st.length>=PK.RATE){const r={ok:false,error:'Slow down: at most '+PK.RATE+' actions per game hour. Try wait().',retry_after_min:Math.ceil(st[0]+60-S.gameMin)};logCall(a,tool,args,r);return r}
    st.push(S.gameMin)}
  let r;try{r=asSrc('agent',()=>fn(a,args&&typeof args==='object'?args:{}))}catch(e){r=e instanceof Rule?{ok:false,error:e.message}:{ok:false,error:'The world did not understand that ('+String(e&&e.message||e).slice(0,120)+').'}}
  if(meta.act&&r&&r.ok!==false){a.playActAt=S.gameMin;a.playIdle=false;a.playAuto=null;if(tool==='hunt'&&a.pq&&a.pq[0])a.playOrder={kind:'hunt',n:a.pq[0].n,flee:a.pq[0].flee}} // the agent's last action that went through (autopilot, #126)
  if(!r.pending){const evs=takeEvents(a);if(evs.length)r.events=evs}
  logCall(a,tool,args,r);return r}

// The wait tool: the host polls waitOver and then calls finishWait (sim/player-host.js).
export function waitOver(p){const a=hero(p.hero);if(!a||a.state==='dead'||!a.player)return true;if(S.gameMin>=p.until)return true;
  return (a.playEv||[]).some(e=>e.n>p.mark&&e.u)}
export function finishWait(p,realOut){const a=hero(p.hero);if(!a)return {ok:false,error:'No such hero.'};
  const r={ok:true,waited_min:Math.round(S.gameMin-p.from)};
  if(a.state==='dead')Object.assign(r,{ok:false,dead:true,error:a.name+' died ('+(a.cause||'fallen')+'). Hardcore: one life.'});
  else{r.why=S.gameMin>=p.until?'time passed':realOut&&tableView(a)?'the world is paused for a scene at the table':realOut?'the world is paused or slow; nothing much happened':'something needs you';
    r.hp=pct(a.hp,maxHp(a))+'%';r.state=a.state;r.doing=a.playDoing||null;const ch=choiceInfo(a);if(ch)r.choice=ch;const tv=tableView(a);if(tv)r.table=tv}
  const evs=takeEvents(a);if(evs.length)r.events=evs;
  const e=(a.playLog||[])[0];if(e&&e.tool==='wait'&&e.pending){e.pending=false;e.text=summarize(r)}
  return r}

// Recent tool calls for the Agent tab: newest first, short text.
function logCall(a,tool,args,r){const L=a.playLog||(a.playLog=[]);
  L.unshift({t:clockStr(),d:dayNo(),tool,args:argText(args),ok:r.ok!==false,pending:!!r.pending||undefined,text:r.pending?'waiting...':summarize(r)});if(L.length>PK.LOG)L.pop()}
const argText=x=>{if(!x||typeof x!=='object')return '';const k=Object.keys(x);return k.length?clean(k.map(j=>j+'='+(typeof x[j]==='string'?'"'+x[j]+'"':x[j])).join(' '),120):''};
function summarize(r){if(r.ok===false)return 'x '+clean(r.error,160);const skip={ok:1,events:1,pending:1};
  return clean(Object.keys(r).filter(k=>!skip[k]).map(k=>{const v=r[k];return k+': '+(typeof v==='string'||typeof v==='number'?v:Array.isArray(v)?v.length+' item'+(v.length===1?'':'s'):v&&typeof v==='object'?'{...}':String(v))}).join(' · '),200)}

// The runner's narration (the agent's own text between tool calls), for the Agent tab.
export function playerNarrate(id,text){const a=hero(Number(id));if(!a||!a.player)return false;const t=clean(text,600);if(!t)return false;
  const N=a.playNarr||(a.playNarr=[]);N.unshift({t:clockStr(),d:dayNo(),text:t});if(N.length>PK.NARR)N.pop();return true}

// Agent-played heroes (issue #93: several at once, one agent each). With an id, these answer
// for that hero only (null when it is not agent-played); without one, the old single-hero path:
// playerHero() the first living agent-played hero, playerSeat() that hero or, when every agent
// hero has died, the last of them (its tools then answer "dead").
const seatOf=id=>{const a=hero(Number(id));return a&&a.player?a:null};
export const playerHero=id=>{if(id!=null){const a=seatOf(id);return a&&a.state!=='dead'?a:null}
  return (S.playerHeroes||[]).map(hero).find(a=>a&&a.player&&a.state!=='dead')||null};
export const playerSeat=id=>id!=null?seatOf(id):playerHero()||(S.playerHeroes||[]).map(hero).filter(a=>a&&a.player).pop()||null;
// Every agent-played hero, living or dead, in the order they were marked.
export const playerSeats=()=>(S.playerHeroes||[]).map(hero).filter(a=>a&&a.player);
export {CHOICE_MIN};
