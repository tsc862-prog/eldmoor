// Behavior watch, game side (issue #129): what the world did, for the behavior logs the playtest reviewer
// reads (logs/behavior/<world>/, written by scripts/behavior-log.mjs). The host samples it a few times a
// real second: the page (src/ui/player-bridge.js) sends the records over the play bridge, the headless world
// (scripts/play-headless.mjs) hands them to its logger directly.
//
// makeWatch().tick() -> [{kind:'world'|'anomaly'|'decision', rec}]
//   world     a digest every game hour: each Fellowship member's and agent hero's state, place, HP, level and
//             time idle; the share of game time each mind ran them (agent order, autopilot, relay mind,
//             scripted); Table scenes opened and resolved; DM lever pulls and refusals, DM log entries by kind;
//             dmFocus: DM actions (board posts, applied levers, staged scenes) this hour and how many touched the Fellowship, with the share (issue #165);
//             deaths and their causes; chat lines heard by those heroes, counted by channel; votes by agent
//             and by reflex; Mind decisions by outcome.
//   anomaly   idle in one place over BW.IDLE_MIN outside camp; the same state with no progress over
//             BW.STUCK_MIN; reflex taking every agent turn of BW.SCENE_RUN scenes in a row; every agent
//             vote by reflex for BW.VOTE_RUN proposals in a row; DM levers refused often; a danger lever
//             pulled near a hurt member.
//   decision  each hero's Mind entry (sim/brain.js) once it settles: kind, provider, model, options,
//             choice, outcome (applied, late, rejected, offline, superseded, overruled), latency, error.
// Read only: it never writes S or a hero, rolls no random number and is not part of step(), so a world
// with or without it plays the same (npm run sim never loads it). Counts and states only: no chat text,
// journal, note or narration leaves through here (issue #123).
import {S,clockStr} from './state.js';
import {ZONES,zoneAt,dist} from '../world/map.js';
import {maxHp} from './heroes.js';
import {fellowshipMembers,mindsOf} from './fellowship.js';
import {playerSeats} from './player.js';
import {focus,touches,countable} from './dmfocus.js';

export const BW={
  DIGEST_MIN:60,     // game minutes between world digests
  IDLE_MIN:120,      // game minutes within IDLE_TILES of one spot (outside camp) -> idle
  IDLE_TILES:2,
  IDLE_AGAIN:240,    // ... and again every this many more
  STUCK_MIN:360,     // game minutes in one state with no kill, level or move of state -> stuck-state
  SCENE_RUN:2,       // Table scenes in a row in which reflex took every agent member's turn -> reflex-scenes
  VOTE_RUN:2,        // proposals in a row in which every agent member's vote was by reflex -> reflex-votes
  REFUSE_N:3,        // lever refusals within REFUSE_WIN game minutes (and at least half the pulls) -> levers-refused
  REFUSE_WIN:120,
  HURT:.35,          // a member below this share of HP is hurt ...
  NEAR:14,           // ... and a danger lever within this many tiles or in its region piles on -> lever-near-hurt
  DANGER:['mark_dangerous','named_foe','custom_foe','set_condition'],
  NO_IDLE:['camp','dead','ghost'],
};

const day=()=>'Day '+(Math.floor(S.gameMin/1440)+1)+' '+clockStr();
const pct=a=>Math.max(0,Math.round(a.hp/maxHp(a)*100));
const place=a=>ZONES[zoneAt(a.x,a.y)]||null;
const heroRef=a=>({id:a.id,name:a.name});
const byId=id=>S.agents.find(x=>x.id===id)||null;
const mindOf=a=>a.player?(a.playIdle?'autopilot':'agent'):a.brain?'relay':'scripted';
const channelOf=e=>e.party?'party':e.from&&e.from.kind==='dm'?'dm':e.from&&e.from.kind==='npc'?'npc':e.trigger==='table'?'table':e.agent?'agent':e.ai?'mind':'scripted';
// The heroes the watch follows: Fellowship members and agent-played heroes, living.
function seats(){const out=new Map();for(const m of fellowshipMembers())if(m.hero&&m.hero.state!=='dead')out.set(m.hero.id,m.hero);
  for(const a of playerSeats())if(a.state!=='dead')out.set(a.id,a);return [...out.values()]}

export function makeWatch(){
  let base=false,lastGm=0,hour=0,dmSeen=0,scene=null,sceneRun=0,voteRun=0,refusals=[],pulls=[];
  const T=new Map(),seenChat=new WeakSet(),seenFallen=new WeakSet(),seenScene=new WeakSet(),seenProps=new Set(),emitted=new Map();
  let H=null;const fresh=()=>({share:{agent:0,autopilot:0,relay:0,scripted:0},acts:0,table:{opened:0,resolved:0,agentTurns:0,reflexTurns:0},
    levers:{pulled:0,refused:0,by:{}},dmlog:{},dmFocus:{acts:0,fellow:0},chat:{},deaths:[],votes:{agent:0,reflex:0},decisions:{},anomalies:0});
  const tStats=()=>{const F=S.fellowship,t=F&&F.tableStats;return t?{scenes:t.scenes||0,agent:t.agent||0,reflex:t.reflex||0}:{scenes:0,agent:0,reflex:0}};
  let tLast=null;
  // Everything already in the world counts as seen: the logs start from now (a restored save, a reload).
  function baseline(){base=true;lastGm=S.gameMin;hour=Math.floor(S.gameMin/BW.DIGEST_MIN);dmSeen=S.dmLogSeq||0;scene=S.table||null;sceneRun=voteRun=0;refusals=[];pulls=[];
    T.clear();seenProps.clear();emitted.clear();H=fresh();tLast=tStats();
    for(const e of S.fallen||[])seenFallen.add(e);
    for(const a of seats())for(const e of a.chat||[])seenChat.add(e);
    for(const P of (S.fellowship&&S.fellowship.props)||[])if(P.status!=='open')seenProps.add(P.id);
    for(const a of S.agents)if(a.mind)emitted.set(a.id,new Set(a.mind.filter(e=>e.outcome!=='pending').map(e=>e.id)))}
  const anomaly=(out,kind,a,text,evidence,severity='warn')=>{H.anomalies++;out.push({kind:'anomaly',rec:{kind,seat:a?'hero:'+a.id:'world',hero:a?heroRef(a):null,gameMin:Math.round(S.gameMin),clock:day(),severity,text,evidence:evidence||{}}})};

  function track(out,a,dt){let t=T.get(a.id);const now=S.gameMin;
    if(!t){t={ax:a.x,ay:a.y,since:now,idleNext:BW.IDLE_MIN,state:a.state,stSince:now,kills:a.kills||0,lvl:a.lvl,stuck:false,act:a.playActAt};T.set(a.id,t)}
    H.share[mindOf(a)]+=dt;
    if(a.player&&a.playActAt!==t.act){t.act=a.playActAt;H.acts++}
    // idle in one place (outside camp)
    if(BW.NO_IDLE.includes(a.state)||a.hidden||dist(a,{x:t.ax,y:t.ay})>BW.IDLE_TILES){t.ax=a.x;t.ay=a.y;t.since=now;t.idleNext=BW.IDLE_MIN}
    else if(now-t.since>=t.idleNext){anomaly(out,'idle',a,a.name+' has stayed in one place ('+(place(a)||'?')+', '+a.state+') for '+Math.round((now-t.since)/60*10)/10+' game hours',
      {minutes:Math.round(now-t.since),state:a.state,place:place(a),mind:mindOf(a),hp:pct(a)});t.idleNext+=BW.IDLE_AGAIN}
    // stuck: one state, no kill, no level
    if(a.state!==t.state||(a.kills||0)!==t.kills||a.lvl!==t.lvl||a.state==='camp'){t.state=a.state;t.kills=a.kills||0;t.lvl=a.lvl;t.stSince=now;t.stuck=false}
    else if(!t.stuck&&now-t.stSince>=BW.STUCK_MIN){t.stuck=true;anomaly(out,'stuck-state',a,a.name+' has been in state '+a.state+' for '+Math.round((now-t.stSince)/60)+' game hours with no kill or level',
      {minutes:Math.round(now-t.stSince),state:a.state,place:place(a),mind:mindOf(a),doing:a.playDoing||null})}}

  function dmLog(out){const L=S.dmLog||[],seq=S.dmLogSeq||0;if(seq<=dmSeen)return;
    const fresh_=L.filter(e=>e.id>dmSeen).reverse();dmSeen=seq;const now=S.gameMin;
    const fo=focus();
    for(const e of fresh_){H.dmlog[e.kind]=(H.dmlog[e.kind]||0)+1;if(fo&&countable(e)){H.dmFocus.acts++;if(touches(e,fo))H.dmFocus.fellow++}if(e.kind!=='lever')continue;const d=e.detail||{},by=String(d.by||'?');
      const ok=d.result==='applied';H.levers[ok?'pulled':'refused']++;const b=H.levers.by[by]||(H.levers.by[by]={pulled:0,refused:0});b[ok?'pulled':'refused']++;
      pulls.push(now);if(!ok)refusals.push(now);
      if(ok&&BW.DANGER.includes(d.lever)){const P=d.params||{},at=Number.isFinite(+P.x)&&Number.isFinite(+P.y)?{x:+P.x,y:+P.y}:null;
        for(const a of seats())if(a.fellow&&a.hp<maxHp(a)*BW.HURT&&a.state!=='town'&&((d.region&&place(a)===d.region)||(at&&dist(a,at)<=BW.NEAR))){
          anomaly(out,'lever-near-hurt',a,'Lever '+d.lever+' ('+by+') pulled '+(d.region?'in '+d.region:'near '+a.name)+' while '+a.name+' is at '+pct(a)+'% HP',{lever:d.lever,by,region:d.region||null,hp:pct(a),reason:String(d.reason||'').slice(0,120)},'bad');break}}}
    refusals=refusals.filter(t=>now-t<=BW.REFUSE_WIN);pulls=pulls.filter(t=>now-t<=BW.REFUSE_WIN);
    if(refusals.length>=BW.REFUSE_N&&refusals.length*2>=pulls.length){anomaly(out,'levers-refused',null,refusals.length+' of '+pulls.length+' lever pulls refused in '+Math.round(BW.REFUSE_WIN/60)+' game hours',
      {refused:refusals.length,pulls:pulls.length,last:(L.find(e=>e.kind==='lever'&&e.detail&&e.detail.result!=='applied')||{}).detail?.result||null});refusals=[];pulls=[]}}

  function table(out){const t=tStats();H.table.opened+=Math.max(0,t.scenes-tLast.scenes);H.table.agentTurns+=Math.max(0,t.agent-tLast.agent);H.table.reflexTurns+=Math.max(0,t.reflex-tLast.reflex);tLast=t;
    const sc=S.table;
    if(scene&&(scene!==sc||scene.phase==='outcome')&&!seenScene.has(scene)){seenScene.add(scene);H.table.resolved++;
      const mine=scene.beats.filter(b=>{const a=byId(b.id);return a&&a.player});
      if(mine.length){if(mine.every(b=>b.by==='reflex'))sceneRun++;else sceneRun=0;
        if(sceneRun>=BW.SCENE_RUN){anomaly(out,'reflex-scenes',null,'Reflex took every agent turn at the table for '+sceneRun+' scenes in a row (last: '+scene.title+')',{scenes:sceneRun,last:scene.title,kind:scene.kind,members:mine.map(b=>b.name)},'bad');sceneRun=0}}}
    scene=sc||null}

  function votes(out){const F=S.fellowship;if(!F||!F.props)return;
    for(const P of F.props.slice().reverse()){if(P.status==='open'||seenProps.has(P.id))continue;seenProps.add(P.id);
      const mine=Object.entries(P.votes||{}).filter(([id])=>{const a=byId(Number(id));return a&&a.player});
      for(const [,v] of mine)H.votes[v.by==='reflex'?'reflex':'agent']++;
      if(!mine.length)continue;if(mine.every(([,v])=>v.by==='reflex'))voteRun++;else voteRun=0;
      if(voteRun>=BW.VOTE_RUN){anomaly(out,'reflex-votes',null,'Every agent vote was cast by reflex for '+voteRun+' proposals in a row (last: '+P.kind+')',{proposals:voteRun,last:P.kind,result:P.result||P.status},'warn');voteRun=0}}}

  function decisions(out){for(const a of S.agents){if(!a.mind||!a.mind.length)continue;let E=emitted.get(a.id);if(!E)emitted.set(a.id,E=new Set());
    for(const e of a.mind){if(e.outcome==='pending'||E.has(e.id))continue;E.add(e.id);H.decisions[e.outcome]=(H.decisions[e.outcome]||0)+1;
      out.push({kind:'decision',rec:{hero:heroRef(a),kind:e.kind,provider:e.provider||'anthropic',model:e.model||null,options:e.options||null,choice:e.choice??null,outcome:e.outcome,ms:e.ms,error:e.error||null,scripted:e.scripted||null,gameMin:e.gameMin}})}
    if(E.size>200){const keep=new Set(a.mind.map(e=>e.id));for(const id of E)if(!keep.has(id))E.delete(id)}}}

  function heard(){for(const a of seats())for(const e of a.chat||[]){if(seenChat.has(e))continue;seenChat.add(e);const c=channelOf(e);H.chat[c]=(H.chat[c]||0)+1}}
  function deaths(){const mine=new Map(seats().map(a=>[a.name,a]));for(const e of S.fallen||[]){if(seenFallen.has(e))continue;seenFallen.add(e);
    const was=S.agents.find(x=>x.name===e.name&&x.state==='dead');H.deaths.push({name:e.name,lvl:e.lvl,cls:e.cls,cause:e.cause||null,...(was&&was.fellow?{fellow:true}:{}),...(was&&was.player?{agent:true}:{}),...(mine.has(e.name)?{watched:true}:{})})}}

  function digest(out){const F=S.fellowship;
    out.push({kind:'world',rec:{gameMin:Math.round(S.gameMin),clock:day(),minutes:BW.DIGEST_MIN,
      fellowship:F?{name:F.name,minds:mindsOf(F)}:null,
      members:seats().map(a=>{const t=T.get(a.id);return {id:a.id,name:a.name,role:a.fellowRole||null,fellow:!!a.fellow,agent:!!a.player,mind:mindOf(a),state:a.state,doing:a.playDoing||null,place:place(a),hp:pct(a),lvl:a.lvl,idleMin:t?Math.round(S.gameMin-t.since):0}}),
      ...H,dmFocus:{...H.dmFocus,share:H.dmFocus.acts?Math.round(100*H.dmFocus.fellow/H.dmFocus.acts)/100:null},table:{...H.table,open:!!S.table}}});H=fresh()}

  return {
    tick(){const out=[];
      if(!base||S.gameMin<lastGm||(S.dmLogSeq||0)<dmSeen){baseline();return out}
      const dt=S.gameMin-lastGm;lastGm=S.gameMin;
      // a paused world (a Table scene at 1x) keeps its clock: scenes, votes and levers are still read
      if(dt>0){for(const a of seats())track(out,a,dt);for(const id of [...T.keys()]){const a=byId(id);if(!a||a.state==='dead')T.delete(id)}}
      dmLog(out);table(out);votes(out);decisions(out);heard();deaths();
      const h=Math.floor(S.gameMin/BW.DIGEST_MIN);if(h>hour){hour=h;digest(out)}
      return out},
    reset(){base=false}};
}
