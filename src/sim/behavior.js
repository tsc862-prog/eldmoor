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
//             dmShare (issue #541): per kind of DM call, answered by the DM agent, answered late, filled by the scripted DM
//             (talk, table voice, slot; levers, board, branches, staged and voice are counted for context), and the DM seat's
//             minutes this hour as closed, no runner, live, waiting;
//             deaths and their causes; chat lines heard by those heroes, counted by channel; votes by agent
//             and by reflex; Mind decisions by outcome.
//             companies (issue #460): every company of agent heroes, {id, name, size (heroes), minds (agent members), deaths
//             this hour, fellowship (the five-place one)}, plus a company that ended this hour with a death in it ({ended});
//             each member line carries its company id and each death the company it rode in, for the death-rate watch.
//   anomaly   idle in one place over BW.IDLE_MIN outside camp; the same state with no progress over
//             BW.STUCK_MIN; reflex taking every agent turn of BW.SCENE_RUN scenes in a row; every agent
//             vote by reflex for BW.VOTE_RUN proposals in a row; DM levers refused often; a danger lever
//             pulled near a hurt member; an agent-played Fellowship member who wrote no memory for BW.NO_NOTES_MIN
//             (issue #179; the digest counts memories written per member, by name); scene-missed: a live member's
//             Table turn resolved by reflex after the wait (issue #515; the digest counts missed and queued waits).
//             dm-scripted (issue #541): the DM agent answered under BW.DM_SHARE of the answerable calls (talk, table voice, slot)
//             over BW.DM_WIN game minutes while the seat stayed held by a runner.
//             refused-talk: an agent hero whose lines the talk guard refused BW.REFUSED_TALK times in a digest hour (#870; the digest counts them per hero)
//             no-flee-rule: an agent hero whose gambits hold no flee rule (issue #617), again every BW.NO_FLEE_MIN
//             no-aim: an agent hero with no stated aim (issue #535, sim/intent.js) for BW.NO_AIM_MIN outside camp and town
//             rest (the digest counts aims stated per hero, by name).
//             errand-unacted (issue #727): an aim with town-errand words (ask, information, buy, sell, a trainer, the board) that
//             was held in town and ended (done, stale or replaced) with no talk, list_jobs, buy, sell or earshot in between.
//   decision  each hero's Mind entry (sim/brain.js) once it settles: kind, provider, model, options,
//             choice, outcome (applied, late, rejected, offline, superseded, overruled), latency, error.
// Read only: it never writes S or a hero, rolls no random number and is not part of step(), so a world
// with or without it plays the same (npm run sim never loads it). Counts and states only: no chat text,
// journal, note or narration leaves through here (issue #123).
import {S,clockStr} from './state.js';
import {ZONES,zoneAt,dist} from '../world/map.js';
import {maxHp} from './heroes.js';
import {companies,minds,inSlots,slotKeyOf,slotMembers,slotted} from './company.js'; // per-company digest (#460)
import {playerSeats} from './player.js';
import {focus,touches,countable} from './dmfocus.js';
import {INTENT,aimHeld,aimState} from './intent.js'; // the stated aim (#535)
import {gambitRec,noFlee} from './gambits.js';
import {takeWishes} from './wish.js'; // wishes for the builders (#663)
import {drainHolds} from './gambithold.js'; // finished gambit holds (#630) // the hero's own rules (#617)
import {missCause} from './scenewait.js'; // why a live member missed its scene (#687)

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
  DM_SHARE:.5,       // the DM agent's share of answerable calls below this over DM_WIN while its seat is held -> dm-scripted (#541)
  DM_WIN:120,        // game minutes of that window
  DM_MIN_CALLS:4,    // ... and at least this many answerable calls in it
  REFUSED_TALK:3, // lines refused by the talk guard in one digest hour -> refused-talk (#870)
  NO_NOTES_MIN:2*1440, // game minutes an agent-played Fellowship member goes without writing a memory -> no-memories (#179)
  NO_FLEE_MIN:720, // game minutes between two no-flee-rule lines for one hero (#617)
  TOWN_IDLE_MIN:720, // game minutes an agent hero earns nothing in town -> town-idle (#790; the same 12 hours as TP.IDLE_TOWN in sim/player.js)
  NO_AIM_MIN:INTENT.NO_AIM, // game minutes an agent hero goes with no stated aim outside camp and town rest -> no-aim (#535)
};

const day=()=>'Day '+(Math.floor(S.gameMin/1440)+1)+' '+clockStr();
const pct=a=>Math.max(0,Math.round(a.hp/maxHp(a)*100));
const place=a=>ZONES[zoneAt(a.x,a.y)]||null;
const heroRef=a=>({id:a.id,name:a.name});
const byId=id=>S.agents.find(x=>x.id===id)||null;
const mindOf=a=>a.player?(a.playIdle?'autopilot':'agent'):a.brain?'relay':'scripted';
const channelOf=e=>e.emote?'emote':e.whisper?'whisper':e.party?'party':e.from&&e.from.kind==='dm'?'dm':e.from&&e.from.kind==='npc'?'npc':e.trigger==='table'?'table':e.agent?'agent':e.ai?'mind':'scripted';
// The heroes the watch follows: Fellowship members and agent-played heroes, living.
function seats(){const out=new Map();for(const m of slotMembers(slotted()))if(m.hero&&m.hero.state!=='dead')out.set(m.hero.id,m.hero);
  for(const a of playerSeats())if(a.state!=='dead')out.set(a.id,a);return [...out.values()]}

// The DM's answerable calls, read from counters the game already keeps (S.talks.stats, S.staged.stats, S.dmStats): never written here.
const dmCounts=()=>{const t=(S.talks&&S.talks.stats)||{},g=S.staged&&S.staged.stats||{},d=S.dmStats||{};
  return {talk:[t.dm||0,t.late||0,t.scripted||0],table:[g.answered||0,g.late||0,g.filled||0],slot:[0,0,d.fallback||0]}};
const DM_KINDS=['talk','table','slot','levers','board','branch','staged','voice'];
export function makeWatch(opts={}){
  const dmLinkFn=typeof opts.dmLink==='function'?opts.dmLink:null;
  let dmC=null,dmWin=[],dmHeld=null,dmAnom=-1e9,base=false,lastGm=0,hour=0,dmSeen=0,scene=null,sceneRun=0,voteRun=0,refusals=[],pulls=[];
  const coSeen=new Map();let coDeaths={}; // hero id -> the company it was last seen in; deaths per company this hour (#460)
  const T=new Map(),seenChat=new WeakSet(),seenFallen=new WeakSet(),seenScene=new WeakSet(),seenProps=new Set(),emitted=new Map(),seq0=new Map(),iseq0=new Map();
  let H=null;const fresh=()=>({share:{agent:0,autopilot:0,relay:0,scripted:0},acts:0,table:{opened:0,resolved:0,agentTurns:0,reflexTurns:0,missed:0,queued:0},
    levers:{pulled:0,refused:0,by:{}},dmlog:{},dmShare:{kinds:Object.fromEntries(DM_KINDS.map(k=>[k,{agent:0,late:0,scripted:0}])),seat:{closed:0,norunner:0,live:0,waiting:0,unknown:0}},dmFocus:{acts:0,fellow:0},chat:{},deaths:[],votes:{agent:0,reflex:0},decisions:{},anomalies:0,memories:{},intents:{},talkRefused:{},gambits:{}});
  const tStats=()=>{const F=slotted(),t=F&&F.tableStats;return t?{scenes:t.scenes||0,agent:t.agent||0,reflex:t.reflex||0}:{scenes:0,agent:0,reflex:0}};
  let tLast=null;
  // Everything already in the world counts as seen: the logs start from now (a restored save, a reload).
  function baseline(){base=true;seenRuling.clear();for(const p of (S.rulings&&S.rulings.past)||[])seenRuling.add(p.id);lastGm=S.gameMin;hour=Math.floor(S.gameMin/BW.DIGEST_MIN);dmSeen=S.dmLogSeq||0;scene=S.table||null;sceneRun=voteRun=0;refusals=[];pulls=[];
    T.clear();seenProps.clear();emitted.clear();H=fresh();tLast=tStats();dmC=dmCounts();dmWin=[];dmHeld=null;
    seq0.clear();for(const a of seats())seq0.set(a.id,a.memories?a.memories.seq||0:0); // notes written before a seat is first tracked still count (#179)
    iseq0.clear();for(const a of seats())iseq0.set(a.id,a.intentSeq||0); // aims stated before a seat is first tracked still count (#535)
    for(const e of S.fallen||[])seenFallen.add(e);
    coSeen.clear();coDeaths={};for(const a of seats())if(a.company!=null)coSeen.set(a.id,a.company);
    for(const a of seats())for(const e of a.chat||[])seenChat.add(e);
    for(const P of (slotted()&&slotted().props)||[])if(P.status!=='open')seenProps.add(P.id);
    for(const a of S.agents)if(a.mind)emitted.set(a.id,new Set(a.mind.filter(e=>e.outcome!=='pending').map(e=>e.id)))}
  const anomaly=(out,kind,a,text,evidence,severity='warn')=>{H.anomalies++;out.push({kind:'anomaly',rec:{kind,seat:a?'hero:'+a.id:'world',hero:a?heroRef(a):null,gameMin:Math.round(S.gameMin),clock:day(),severity,text,evidence:evidence||{}}})};

  function track(out,a,dt){let t=T.get(a.id);const now=S.gameMin;
    if(!t){t={ax:a.x,ay:a.y,since:now,idleNext:BW.IDLE_MIN,state:a.state,stSince:now,kills:a.kills||0,lvl:a.lvl,stuck:false,act:a.playActAt,nseq:seq0.has(a.id)?seq0.get(a.id):a.memories?a.memories.seq||0:0,noteAt:now,iseq:iseq0.has(a.id)?iseq0.get(a.id):a.intentSeq||0,aimAt:now};T.set(a.id,t)}
    notes(out,a,t,now);refusedTalk(out,a,t);aims(out,a,t,now);errands(out,a,t,now);townIdle(out,a,t,now);rules(out,a,t,now);
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

  // refused talk (#870): lines sim/talk.js turned away (the same line again, a second introduction), counted per hero in the digest;
  // a hero with BW.REFUSED_TALK or more refused in one digest hour is flagged refused-talk, so the next loose rule is seen
  function refusedTalk(out,a,t){const R=a.talkNo;if(!R)return;const s0=t.tn?t.tn.same:0,i0=t.tn?t.tn.intro:0,ds=R.same-s0,di=R.intro-i0;t.tn={same:R.same,intro:R.intro};if(ds<=0&&di<=0)return;
    const C=H.talkRefused[a.name]||(H.talkRefused[a.name]={same:0,intro:0});C.same+=Math.max(0,ds);C.intro+=Math.max(0,di);
    if(C.same+C.intro>=BW.REFUSED_TALK)anomaly(out,'refused-talk',a,a.name+' had '+(C.same+C.intro)+' lines refused this hour ('+C.same+' repeats, '+C.intro+' introductions)',{same:C.same,intro:C.intro,mind:mindOf(a)})}
  // memories written (issue #179): counted per member each digest; a member with none for BW.NO_NOTES_MIN is flagged
  function notes(out,a,t,now){const seq=a.memories?a.memories.seq||0:0;
    if(seq>t.nseq){H.memories[a.name]=(H.memories[a.name]||0)+(seq-t.nseq);t.nseq=seq;t.noteAt=now}
    if(!a.player){t.noteAt=now;return}
    if(inSlots(a)&&now-t.noteAt>=BW.NO_NOTES_MIN){anomaly(out,'no-memories',a,a.name+' has written no memory for '+Math.round((now-t.noteAt)/1440*10)/10+' game days',{minutes:Math.round(now-t.noteAt),notes:a.memories?a.memories.notes.length:0,reflections:a.reflect?a.reflect.log.length:0,mind:mindOf(a)});t.noteAt=now}}
  // aims stated (issue #535): counted per hero each digest; an agent hero with none held for BW.NO_AIM_MIN outside camp and
  // town rest is flagged (again every BW.NO_AIM_MIN while it lasts)
  function aims(out,a,t,now){const seq=a.intentSeq||0;if(t.iseq==null)t.iseq=seq;if(t.aimAt==null)t.aimAt=now;
    if(seq>t.iseq){H.intents[a.name]=(H.intents[a.name]||0)+(seq-t.iseq);t.iseq=seq}
    const c=a.pq&&a.pq[0],resting=a.state==='town'&&(c&&c.kind==='rest'||a.hp<maxHp(a)*.6);
    if(!a.player||aimHeld(a)||a.state==='camp'||a.state==='dead'||a.state==='ghost'||resting){t.aimAt=now;return}
    if(now-t.aimAt>=BW.NO_AIM_MIN){const I=a.intent;anomaly(out,'no-aim',a,a.name+' has had no stated aim for '+Math.round((now-t.aimAt)/60*10)/10+' game hours ('+(I?'the last one is '+(I.done?'done':'stale'):'never stated')+')',
      {minutes:Math.round(now-t.aimAt),state:a.state,place:place(a),mind:mindOf(a),last:I?(I.done?'done':'stale'):'none',aims:a.intentSeq||0});t.aimAt=now}}
  // town errands (issue #727): an errand aim (not a rest) that was held in town is watched until it ends; ended with none of the
  // errand's tools used -> errand-unacted (once per aim). Only the errand word leaves the hero, never the aim's text.
  function errands(out,a,t,now){if(!a.player)return;const I=a.intent,W=t.errI;
    if(W&&(W!==I||W.done||(aimState(a)==='stale'&&!(W.order&&W.order.kind==='wait')))){ // a wait goes stale at 2 h but is still held (#790): it can yet be run, so judge it when it ends
     t.errI=null;t.errN=W.n;
      if(W.inTown&&!W.acted)anomaly(out,'errand-unacted',a,a.name+' held an aim to '+W.errand+' in town and let it go ('+(W!==I?'replaced':W.done?'done: '+W.done.why:'stale')+') without talk, list_jobs, buy, sell or earshot',
        {errand:W.errand,ended:W!==I?'replaced':W.done?'done':'stale',minutes:Math.round(now-W.set),place:place(a),mind:mindOf(a)})}
    if(I&&!I.done&&I.errand&&I.errand!=='rest'&&t.errI!==I&&t.errN!==I.n&&aimState(a)!=='stale')t.errI=I}
  // town-idle (issue #790): an agent hero in town with nothing earned for BW.TOWN_IDLE_MIN game minutes (sim/player.js townGuard woke it); again every BW.TOWN_IDLE_MIN
  function townIdle(out,a,t,now){const T=a.player&&a.state==='town'?a.townIdle:null;if(!T||now-T.at<BW.TOWN_IDLE_MIN){t.tiAt=null;return}
    if(t.tiAt==null||now-t.tiAt>=BW.TOWN_IDLE_MIN){t.tiAt=now;anomaly(out,'town-idle',a,a.name+' has earned nothing in town for '+Math.round((now-T.at)/60*10)/10+' game hours',{hours:Math.round((now-T.at)/60*10)/10,place:place(a),mind:mindOf(a),aim:a.intent&&!a.intent.done?a.intent.goal:null,level:a.lvl})}}
  // gambits (issue #617): rule-driven acts and edits per hero each digest; an agent hero whose list has no flee rule is
  // flagged no-flee-rule (once, and again every BW.NO_FLEE_MIN while it lasts)
  function rules(out,a,t,now){if(!a.player)return;const g=gambitRec(a),n=g?g.n:0,nf=noFlee(a);const en=a.gambitEdits||0;if(t.gn==null){t.gn=n;t.ge=en}
    const edits=Math.max(0,en-t.ge),acts=Math.max(0,n-t.gn);t.gn=n;t.ge=en;
    if(acts||edits||nf||a.gambits){const G=H.gambits[a.name]||(H.gambits[a.name]={acts:0,edits:0,noFlee:false,own:false,wrote:0,wroteAb:0});G.acts+=acts;G.edits+=edits;G.noFlee=nf;G.own=!!a.gambits;G.wrote=a.gambitWrote?a.gambitWrote.n:0;G.wroteAb=a.gambitWrote?a.gambitWrote.ab:0}
    if(!nf){t.nfAt=null;return}if(t.nfAt==null||now-t.nfAt>=BW.NO_FLEE_MIN){t.nfAt=now;
      anomaly(out,'no-flee-rule',a,a.name+' runs with no rule that breaks it off a losing fight (its gambits have no flee_home or retreat_to)',{rules:(a.gambits||[]).length,place:place(a),mind:mindOf(a),hp:pct(a)})}}
  // The log entries that tell who answered (issue #541): levers and posted hooks by caller, scripted board posts and branches,
  // staged scenes and the DM agent's voice.
  function shareOf(e){const K=H.dmShare.kinds,d=e.detail||{},ag=d.by==='dm-agent';
    if(e.kind==='lever'){if(d.result==='applied'){K[/hook/.test(String(d.lever))&&ag?'board':'levers'][ag?'agent':'scripted']++}}
    else if(e.kind==='hooks'){if(d.added&&d.added.length)K.board.scripted++}
    else if(e.kind==='branch')K.branch.scripted++;
    else if(e.kind==='agent'&&d.call&&d.scene&&d.staged==null)K.table[ag?'agent':'scripted']++; // session zero and an arrival at the table (#561; staged calls count from S.staged.stats)
    else if(e.kind==='agent'){if(d.voice)K.voice.agent++;else if(d.staged!=null&&!d.call&&!d.result)K.staged.agent++}}
  function dmSeat(out,dt){const on=!!(S.dmAgent&&S.dmAgent.seat),link=on&&dmLinkFn?String(dmLinkFn()||'none'):null;
    const st=!on?'closed':!dmLinkFn?'unknown':link==='connected'?'live':link==='waiting'?'waiting':'norunner';H.dmShare.seat[st]+=dt;
    const held=st==='live'||st==='waiting';if(!held){dmHeld=null;dmWin=[]}else if(dmHeld==null)dmHeld=S.gameMin;
    const c=dmCounts(),K=H.dmShare.kinds;let ag=0,sc=0;
    for(const k of ['talk','table','slot']){const p=dmC[k],n=c[k],da=Math.max(0,n[0]-p[0]),dl=Math.max(0,n[1]-p[1]),ds=Math.max(0,n[2]-p[2]);K[k].agent+=da;K[k].late+=dl;K[k].scripted+=ds;ag+=da;sc+=ds}
    dmC=c;if(!held)return;if(ag||sc)dmWin.push({t:S.gameMin,ag,sc});
    dmWin=dmWin.filter(w=>S.gameMin-w.t<=BW.DM_WIN);
    const A=dmWin.reduce((t,w)=>t+w.ag,0),B=dmWin.reduce((t,w)=>t+w.sc,0),N=A+B;
    if(S.gameMin-dmHeld>=BW.DM_WIN&&N>=BW.DM_MIN_CALLS&&A/N<BW.DM_SHARE&&S.gameMin-dmAnom>=BW.DM_WIN){dmAnom=S.gameMin;
      anomaly(out,'dm-scripted',null,'The DM agent answered '+A+' of '+N+' answerable calls ('+Math.round(100*A/N)+'%) over '+BW.DM_WIN/60+' game hours while its seat was held: the scripted DM filled '+B,{agent:A,scripted:B,share:Math.round(100*A/N)/100,windowMin:BW.DM_WIN,seat:st})}}
  function dmLog(out){const L=S.dmLog||[],seq=S.dmLogSeq||0;if(seq<=dmSeen)return;
    const fresh_=L.filter(e=>e.id>dmSeen).reverse();dmSeen=seq;const now=S.gameMin;
    const fo=focus();
    for(const e of fresh_){H.dmlog[e.kind]=(H.dmlog[e.kind]||0)+1;shareOf(e);if(fo&&countable(e)){H.dmFocus.acts++;if(touches(e,fo))H.dmFocus.fellow++}if(e.kind!=='lever')continue;const d=e.detail||{},by=String(d.by||'?');
      const ok=d.result==='applied';H.levers[ok?'pulled':'refused']++;const b=H.levers.by[by]||(H.levers.by[by]={pulled:0,refused:0});b[ok?'pulled':'refused']++;
      pulls.push(now);if(!ok)refusals.push(now);
      if(ok&&BW.DANGER.includes(d.lever)){const P=d.params||{},at=Number.isFinite(+P.x)&&Number.isFinite(+P.y)?{x:+P.x,y:+P.y}:null;
        for(const a of seats())if(inSlots(a)&&a.hp<maxHp(a)*BW.HURT&&a.state!=='town'&&((d.region&&place(a)===d.region)||(at&&dist(a,at)<=BW.NEAR))){
          anomaly(out,'lever-near-hurt',a,'Lever '+d.lever+' ('+by+') pulled '+(d.region?'in '+d.region:'near '+a.name)+' while '+a.name+' is at '+pct(a)+'% HP',{lever:d.lever,by,region:d.region||null,hp:pct(a),reason:String(d.reason||'').slice(0,120)},'bad');break}}}
    refusals=refusals.filter(t=>now-t<=BW.REFUSE_WIN);pulls=pulls.filter(t=>now-t<=BW.REFUSE_WIN);
    if(refusals.length>=BW.REFUSE_N&&refusals.length*2>=pulls.length){anomaly(out,'levers-refused',null,refusals.length+' of '+pulls.length+' lever pulls refused in '+Math.round(BW.REFUSE_WIN/60)+' game hours',
      {refused:refusals.length,pulls:pulls.length,last:(L.find(e=>e.kind==='lever'&&e.detail&&e.detail.result!=='applied')||{}).detail?.result||null});refusals=[];pulls=[]}}

  // gambit holds (#630): the digest counts holds and held seconds per hero; one that ran to HOLD_MAX_S unanswered is an anomaly
  function holds(out){for(const h of drainHolds()){const t=H.holds||(H.holds={n:0,heldS:0,expired:0,by:{}}),b=t.by[h.name]||(t.by[h.name]={n:0,s:0});t.n++;t.heldS+=h.s;b.n++;b.s+=h.s;
    if(h.how==='expired'){t.expired++;const a=byId(h.id);anomaly(out,'hold-expired',a||null,h.name+' held the world with "'+h.rule+'" and did not act in '+h.s+' s',{rule:h.rule,seconds:h.s},'warn')}}}
  function table(out){const t=tStats();H.table.opened+=Math.max(0,t.scenes-tLast.scenes);H.table.agentTurns+=Math.max(0,t.agent-tLast.agent);H.table.reflexTurns+=Math.max(0,t.reflex-tLast.reflex);tLast=t;
    const sc=S.table;
    if(scene&&(scene!==sc||scene.phase==='outcome')&&!seenScene.has(scene)){seenScene.add(scene);H.table.resolved++;
      const mine=scene.beats.filter(b=>{const a=byId(b.id);return a&&a.player});
      H.table.queued+=(scene.q||[]).length;
      for(const id of scene.miss||[]){const a=byId(id);if(!a)continue;H.table.missed++; // a live member's scene turn fell to its reflex after the table's wait (#515)
        {const cause=missCause(scene,id);anomaly(out,'scene-missed',a,a.name+' did not answer the Table scene "'+scene.title+'" in time ('+cause+'): its runner held it, the reflex acted',{scene:scene.title,kind:scene.kind,queued:!!(scene.q&&scene.q.includes(id)),cause,mind:mindOf(a)},'bad')}}
      if(mine.length){if(mine.every(b=>b.by==='reflex'))sceneRun++;else sceneRun=0;
        if(sceneRun>=BW.SCENE_RUN){anomaly(out,'reflex-scenes',null,'Reflex took every agent turn at the table for '+sceneRun+' scenes in a row (last: '+scene.title+')',{scenes:sceneRun,last:scene.title,kind:scene.kind,members:mine.map(b=>b.name)},'bad');sceneRun=0}}}
    scene=sc||null}

  function votes(out){const F=slotted();if(!F||!F.props)return;
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
    const was=S.agents.find(x=>x.name===e.name&&x.state==='dead'),co=was?coSeen.get(was.id):undefined;if(co!=null)coDeaths[co]=(coDeaths[co]||0)+1;
    H.deaths.push({name:e.name,lvl:e.lvl,cls:e.cls,cause:e.cause||null,...(co!=null?{company:co}:{}),...(was&&inSlots(was)?{fellow:true}:{}),...(was&&was.player?{agent:true}:{}),...(mine.has(e.name)?{watched:true}:{})})}}

  function digest(out){const F=slotted();
    out.push({kind:'world',rec:{gameMin:Math.round(S.gameMin),clock:day(),minutes:BW.DIGEST_MIN,
      fellowship:F?{name:F.name,minds:'agent'}:null, // always agent-played (#148)
      companies:companyDigest(),
      members:seats().map(a=>{const t=T.get(a.id);return {id:a.id,name:a.name,role:slotKeyOf(a)||null,fellow:!!inSlots(a),company:a.company??null,agent:!!a.player,mind:mindOf(a),state:a.state,doing:a.playDoing||null,place:place(a),hp:pct(a),lvl:a.lvl,idleMin:t?Math.round(S.gameMin-t.since):0}}),
      ...H,dmShare:{...H.dmShare,agentShare:(()=>{const K=H.dmShare.kinds;let a=0,b=0;for(const k of ['talk','table','slot']){a+=K[k].agent;b+=K[k].scripted}return a+b?Math.round(100*a/(a+b))/100:null})()},dmFocus:{...H.dmFocus,share:H.dmFocus.acts?Math.round(100*H.dmFocus.fellow/H.dmFocus.acts)/100:null},table:{...H.table,open:!!S.table}}});H=fresh();coDeaths={}}
  function companyDigest(){const L=companies().map(C=>({id:C.id,name:C.name||null,size:C.ids.length,minds:minds(C).length,deaths:coDeaths[C.id]||0,...(C.slots?{fellowship:true}:{})}));
    for(const id in coDeaths)if(!L.some(c=>c.id===+id))L.push({id:+id,name:null,size:0,minds:0,deaths:coDeaths[id],ended:true});return L}

  // wishes (#663) and the attempts the DM ruled on (S.rulings) go to the builders' wishes.jsonl; read-only on the world
  const seenRuling=new Set();
  function wishes(out){for(const w of takeWishes())out.push({kind:'wish',rec:w});
    const R=S.rulings;if(R)for(const p of R.past){if(seenRuling.has(p.id))continue;seenRuling.add(p.id);
      out.push({kind:'wish',rec:{type:'attempt',seat:'hero:'+p.hero,name:p.name||null,day:p.day||null,gameMin:Math.round(S.gameMin),what:String(p.what||'').slice(0,300),skill:p.skill||null,pass:p.pass==null?null:!!p.pass,by:p.by||null}})}}

  return {
    tick(){const out=[];
      if(!base||S.gameMin<lastGm||(S.dmLogSeq||0)<dmSeen){baseline();return out}
      const dt=S.gameMin-lastGm;lastGm=S.gameMin;
      // a paused world (a Table scene at 1x) keeps its clock: scenes, votes and levers are still read
      if(dt>0){dmSeat(out,dt);for(const a of seats())track(out,a,dt);for(const id of [...T.keys()]){const a=byId(id);if(!a||a.state==='dead')T.delete(id)}}
      dmLog(out);holds(out);table(out);votes(out);decisions(out);wishes(out);heard();deaths();for(const a of seats())if(a.company!=null)coSeen.set(a.id,a.company);
      const h=Math.floor(S.gameMin/BW.DIGEST_MIN);if(h>hour){hour=h;digest(out)}
      return out},
    reset(){base=false}};
}
