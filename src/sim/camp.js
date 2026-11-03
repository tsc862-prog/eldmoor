// Rest and camp (issue #64, DM phase 2). DOM-free. The Fellowship, when it is out in the field at
// night or worn out, makes camp at a safe spot, rests, posts night watches in turn and talks round
// the fire. Background heroes do not camp.
//
//   trigger   night (21:00-03:00) or worn out (average HP < WORN_AVG or anyone < WORN_ONE) with at
//             least MIN_CAMP members out hunting/travelling/following, none on a DM adventure
//   spot      found through the world module (tileAt/WALKABLE/CITY/LAIR/CRYPT): open ground near the
//             leader, away from towns and the great lairs; never a fixed coordinate
//   phases    'gather' (walk to the fire) -> 'rest' (state 'camp': heal CAMP_HEAL of max HP per
//             second at 1x, watches, talk) -> break camp (night camps at dawn once healed; worn camps
//             when mended or after WORN_MAX minutes)
//   watches   WATCH_MIN game minutes each, members in slot order. Every ROLL_MIN a roll for a
//             visitor: an ambush mob (a summoned 'add' of the camp's region) or, when an enemy hero
//             is close, a duel. The watcher's Perception vs SPOT_DC decides whether the camp is
//             roused in time (spotted) or the foe gets in a free blow (caught). Either way the camp
//             wakes and the Table (sim/table.js) opens an 'ambush' scene
//   talk      every TALK_MIN a line in the party channel (sim/council.js partySay): scripted from
//             src/data/camp.js, or the brain 'say' kind for relay-minded members; quarrels cost a
//             bond point, shared talk grows bonds
//   status    campStatus(a) is the hero's `doing` line ("Asleep by the fire · camping until dawn (05:30) · 3 h 10 m
//             left", "On watch (until 01:00) ..."); campView(a) is the same as data for the agent's status and turn header
//   ending    a night camp breaks at dawn once mended; when everyone is mended before dawn each member gets a wake
//             event (break camp now or sleep till dawn?); any member may propose `break_camp` (sim/council.js, the vote
//             settles it) and the leader may `break_camp` outright; the leader's `rest {hours}` makes a camp for a set
//             time (why 'rest'). Every member gets a turn-starting event when camp breaks (not on an ambush: the alarm is one)
//   sleeping  a sleeper's agent gets no soft turns (sim/pace.js asleep()), only wake events; one woken by an ambush is groggy
//             for the first round (its swing cooldown is not ready). onCamp(fn) hears 'make','rest','mended','break',
//             'spotted','caught' for the reflection memories (#179)
//   logs      campaign log, chronicle, DM log (kind 'camp'), member memories
//   companies every company camps on its own (#439, epic #402): C.camp, so two companies light two fires. A camp needs
//             minCamp(C) = min(MIN_CAMP, the company's places) out in the field (the five-slot Fellowship counts its five
//             places, so it still needs 3). A solo makes a one-person camp: no one else keeps watch, so it sleeps every
//             other watch (an ambush then catches it unroused, the same Perception roll still made), and it heals at
//             SOLO_HEAL of CAMP_HEAL. A solo never camps by itself at night: only when its agent calls it (rest {hours}).
//             No dice are added on any path.
// State is plain data on C.camp (ids only), saved with the world.
import {rnd,ri,hash} from '../core/rng.js';
import {CITY,LAIR,CRYPT,ZONES,zoneAt,tileAt,dist} from '../world/map.js';
import {WALKABLE,ROCK,PEAK} from '../world/tiles.js';
import {MOBS} from '../data/mobs.js';
import {USES} from '../data/items.js';
import {campMeal,campLight} from './inv.js'; // rations and torches (sim/inv.js)
import {homeOf} from '../data/races.js';
import {CAMP_LINES,TOPICS,QUARREL_REPLY,NTH} from '../data/camp.js';
import {S} from './state.js';
import {log} from './chronicle.js';
import {dmlog} from './dmlog.js';
import {maxHp,moveTo} from './heroes.js';
import {spawnMob} from './mobs.js';
import {nearHeroes} from './spatial.js';
import {check} from './abilities.js';
import {bondEvent,bond} from './bonds.js';
import {remember,stanceEvent} from './memory.js';
import {notify} from './notify.js';
import {askRelay,snapshotFor,cleanLine} from './brain.js';
import {sayOk} from './throttle.js';
import {companyOf,companies,members as cMembers,campaign,slotted} from './company.js';
import {partySay,leaderOfC,setCampHook,openProps} from './council.js';
import {openScene} from './table.js';
import {sceneOf} from './scenes.js';
import {reflexMay} from './runlink.js';
import {advCampable} from './dm.js'; // a night camp may fall between an adventure's scenes (#325)

export const CAMP={
  MIN_CAMP:3,        // members that must be out in the field to make a camp
  NIGHT_FROM:21,NIGHT_TO:3,  // game hours when a night camp may be made
  DAWN:5.5,          // a night camp breaks at this hour once everyone is mended
  WORN_AVG:.6,WORN_ONE:.3,  // worn out: average HP below, or any one member below, this share
  WORN_MAX:300,      // game minutes a worn-out camp rests at most
  CAMP_HEAL:.05,     // share of max HP healed per second of rest at 1x (a camp mends in about 20 s)
  MENDED:.95,
  COOL:150,          // game minutes before another camp after one ends
  TOWN_MIN:11,       // tiles from any town rectangle
  LAIR_MIN:14,       // tiles from Kragmaw's lair and the Crypt door
  GATHER_MAX:40,     // game minutes to reach the fire before resting anyway
  WATCH_MIN:120,ROLL_MIN:60,TALK_MIN:50,
  AMBUSH_P:.08,      // base chance per roll, plus .02 per region index
  SPOT_DC:12,
  CAUGHT_HIT:.12,    // share of max HP a sleeper loses to a free blow (never lethal)
  RING:1.15,         // tiles from the fire to the bedrolls
  SOLO_HEAL:.6,      // a one-person camp heals at this share of CAMP_HEAL (no one keeps watch while it sleeps)
};
const nar=t=>({t,c:'nar'}),gd=t=>({t,c:'gd'});
const byId=id=>S.agents.find(x=>x.id==id)||null;
const hourNow=()=>(S.gameMin/60)%24;
const LOOSE=['hunt','travel','follow'];
const fill=(s,a,o,zone)=>String(s).replace(/\{(\w+)\}/g,(m,k)=>k==='other'?(o?o.name:'friend'):k==='zone'?zone:k==='town'?homeOf(a).name:m);
const listeners=[];
export const onCamp=f=>{if(typeof f==='function')listeners.push(f)}; // fn(kind, camp, detail), for reflection memories (#179)
const emit=(kind,g,d)=>{for(const f of listeners){try{f(kind,g,d||{})}catch(e){}}};
// campOf(): the Fellowship's camp; campOf(hero): its company's; campOf(company): that one's. Null when not camped.
const coOf=x=>x==null?slotted():x.kind==='hero'?companyOf(x):x;
export const campOf=x=>{const C=coOf(x);return C&&C.camp&&C.camp.phase?C.camp:null};
// The places a company has: its five slots for the Fellowship (empty ones too), else its heroes.
const places=C=>C.slots?Object.keys(C.slots).length:C.ids.length;
export const minCamp=C=>Math.min(CAMP.MIN_CAMP,places(C));
// Who the camp speaks of: the Fellowship keeps its old lines; another company by its name (a solo's is the hero's).
const the=C=>C.slots?'The Fellowship':C.name||'The company';
// A solo sleeps every other watch: nobody else keeps it.
const soloSleeps=g=>!!g.solo&&g.watchIdx>=0&&g.watchIdx%2===1;
export const isCamped=a=>!!(a&&a.state==='camp');

// ---- the safe spot: asked of the world module ----
const open=(x,y)=>{const t=tileAt(x,y);return WALKABLE.includes(t)&&t!==ROCK&&t!==PEAK};
function safe(x,y){if(!open(x,y))return false;
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]])if(!open(x+dx,y+dy))return false;
  for(const c of CITY)if(x>=c.x0-CAMP.TOWN_MIN&&x<=c.x1+CAMP.TOWN_MIN&&y>=c.y0-CAMP.TOWN_MIN&&y<=c.y1+CAMP.TOWN_MIN)return false;
  if(dist({x,y},LAIR)<CAMP.LAIR_MIN||dist({x,y},CRYPT)<CAMP.LAIR_MIN)return false;
  return true}
// Nearest safe open ground to (x,y), by rings; null if none within 10 tiles.
export function campSpot(x,y){for(let r=0;r<=10;r++)for(let k=0;k<Math.max(1,r*6);k++){const ang=k/Math.max(1,r*6)*Math.PI*2,px=Math.floor(x+Math.cos(ang)*r)+.5,py=Math.floor(y+Math.sin(ang)*r)+.5;if(safe(px,py))return {x:px,y:py}}return null}

// ---- who can camp ----
const eligible=a=>a&&a.state!=='dead'&&LOOSE.includes(a.state)&&advCampable(a)&&!a.hidden&&!(a.splitUntil&&a.splitUntil>S.gameMin)&&!a.raid;
function wantCamp(L){const h=hourNow();
  if(h>=CAMP.NIGHT_FROM||h<CAMP.NIGHT_TO)return 'night';
  const f=L.map(a=>a.hp/maxHp(a)),avg=f.reduce((s,x)=>s+x,0)/f.length;
  return avg<CAMP.WORN_AVG||Math.min(...f)<CAMP.WORN_ONE?'worn':null}

function say_(a,text,k){if(!a||a.state==='dead')return;partySay(a,text);remember(a,k||'camp',text.length>90?text.slice(0,88)+'..':text)}
const ev=(C,kind,parts,detail,ids)=>{campaign(C,'camp',...parts);dmlog('camp',null,parts,{camp:kind,...detail},{heroes:ids});if(kind!=='make'&&kind!=='break')emit(kind,C.camp,detail)};
const members=g=>g.ids.map(byId).filter(a=>a&&a.state==='camp');

// ---- status: how long the rest lasts, who sleeps and who watches ----
const pad=n=>String(n).padStart(2,'0');
const hhmm=m=>{const x=((Math.round(m)%1440)+1440)%1440;return pad(Math.floor(x/60))+':'+pad(x%60)};
const dur=m=>{m=Math.max(0,Math.round(m));const h=Math.floor(m/60);return h?h+' h '+(m%60)+' m':m+' m'};
// End of the current watch as hh:mm, or null when the camp has no watch times (a staged or hand-made camp): never NaN (#475).
const watchEnd=g=>Number.isFinite(g.restAt)&&Number.isFinite(g.watchIdx)?hhmm(g.restAt+(g.watchIdx+1)*CAMP.WATCH_MIN):null;
const untilTxt=t=>t?' (until '+t+')':'';
function endOf(g,L){const now=S.gameMin,low=Math.min(...L.map(a=>a.hp/maxHp(a))),pct=Math.round(low*100);
  if(g.why==='rest'&&g.hours&&Number.isFinite(g.restAt))return {text:'resting until '+hhmm(g.restAt+g.hours*60)+' · '+dur(g.restAt+g.hours*60-now)+' left',left:g.restAt+g.hours*60-now,mended:low>=CAMP.MENDED};
  if(g.why==='night'){const h=hourNow();
    if(h>=CAMP.DAWN&&h<12)return {text:'resting until mended · '+pct+'%',left:null,mended:low>=CAMP.MENDED};
    const left=((CAMP.DAWN-h+24)%24)*60;return {text:'camping until dawn ('+hhmm(CAMP.DAWN*60)+') · '+dur(left)+' left'+(low>=CAMP.MENDED?', all mended':''),left,mended:low>=CAMP.MENDED}}
  return {text:'resting until mended · '+pct+'%',left:Number.isFinite(g.restAt)?Math.max(0,g.restAt+CAMP.WORN_MAX-now):null,mended:low>=CAMP.MENDED}}
// Is this camper asleep (camp is resting and it is not the one on watch)?
export function asleep(a){const g=a&&campOf(a);return !!(g&&g.phase==='rest'&&a.state==='camp'&&(g.solo?soloSleeps(g):a.id!==g.watcher))}
export function campView(a){const g=a&&campOf(a);if(!g||a.state!=='camp')return null;const L=members(g);
  if(g.phase==='gather')return {phase:'gather',status:'Walking to the camp fire',asleep:false};
  const e=endOf(g,L),w=byId(g.watcher),wEnd=watchEnd(g),sl=asleep(a);
  return {phase:'rest',kind:g.why,status:(sl?'Asleep by the fire':'On watch'+untilTxt(wEnd))+' · '+e.text,asleep:sl,ends:e.text,left_min:e.left==null?null:Math.round(e.left),mended:e.mended,
    on_watch:w?w.name+untilTxt(wEnd):null,asleep_names:L.filter(x=>x.id!==g.watcher).map(x=>x.name),
    you_can:g.solo?'break_camp when you like; nothing else needs doing while you rest':'propose break_camp (the party votes)'+(leaderOfC(companyOf(a))===a?', or break_camp yourself as leader':'')+'; nothing else needs doing while you sleep'}}
// Why an order cannot go through at camp, and the legal way on (#400): the leader breaks camp, the others vote on it.
export function campBlock(a){const g=a&&campOf(a);if(!g||a.state!=='camp')return null;const C=companyOf(a),lead=leaderOfC(C),L=members(g);
  const e=g.phase==='rest'&&L.length?endOf(g,L).text:'making camp',O=openProps(C).find(P=>P.kind==='break_camp');
  if(g.solo)return 'You are camped alone ('+e+'). break_camp to move on now, or wait: the camp ends by itself.';
  const how=lead===a?'You lead: break_camp to move on now':O?'A break_camp proposal is open: vote('+O.id+', yes) to move on':"propose {kind:'break_camp'} to put moving on to the vote"+(lead?' (or ask '+lead.name+', who leads, to break_camp)':'');
  return the(C)+' is camped ('+e+'; leader: '+(lead?lead.name:'none')+'). '+how+', or wait: the camp ends by itself.'}
// One line for the Fellowship panel (rounded so the panel does not rebuild every minute): the end, who sleeps, who watches.
export function campSummary(C){const g=campOf(C);if(!g)return null;const L=members(g);if(!L.length)return null;
  if(g.phase==='gather')return 'Making camp: the company walks to the fire';
  const e=endOf(g,L),w=byId(g.watcher),r10=e.text.replace(/(\d+) h (\d+) m/,(m,h,mm)=>h+' h '+Math.floor(mm/10)*10+' m').replace(/ · (\d+) m left/,(m,mm)=>' · '+Math.ceil(mm/10)*10+' m left').replace(/(\d+)%/,(m,p)=>Math.floor(p/5)*5+'%');
  return 'Camp: '+r10+(w?' · on watch: '+w.name+untilTxt(watchEnd(g)):'')+' · asleep: '+L.filter(x=>x!==w).map(x=>x.name).join(', ')}
export const campStatus=a=>{const v=campView(a);return v?v.status:null};
const refreshDoing=L=>{for(const a of L)a.playDoing=campStatus(a)};

// ---- making and breaking camp ----
function makeCamp(F,L,why,hours){const ld=leaderOfC(F),lead=L.includes(ld)?ld:L[0],sp=campSpot(lead.x,lead.y);if(!sp)return;
  const zone=zoneAt(sp.x,sp.y),ids=L.map(a=>a.id);
  const g=F.camp={phase:'gather',why,hours:hours||0,x:sp.x,y:sp.y,zone,ids,start:Math.round(S.gameMin),restAt:0,nextRoll:0,nextTalk:0,nextBond:0,watchIdx:-1,
    cd:F.camp&&F.camp.cd||0,stats:F.camp&&F.camp.stats||{camps:0,watches:0,visitors:0,spotted:0,caught:0,talks:0,quarrels:0}};
  if(L.length===1)g.solo=1;g.stats.camps++;
  L.forEach((a,i)=>{a.state='camp';a.camp=i;a.dest=null;a.target=null;a.moving=false;if(a.pq)a.pq=[]});
  const zn=ZONES[zone]||'the wilds';
  ev(F,'make',[why==='night'?the(F)+' makes camp for the night in ':why==='rest'?the(F)+' makes camp to rest a while in ':the(F)+', worn thin, makes camp in ',gd(zn),'.'],{why,zone:zn,at:[Math.round(sp.x),Math.round(sp.y)],members:ids.length},ids);
  log(nar(''),gd(F.name),why==='night'?' makes camp for the night in ':why==='rest'?' makes camp to rest a while in ':', worn thin, makes camp in ',gd(zn),'.');
  emit('make',g,{why,zone:zn});
  if(g.solo){const a=L[0];if(a.player)notify(a,'You make camp alone in '+zn+(why==='rest'?' for '+g.hours+' hours':'')+'. Nobody keeps watch while you sleep, and you mend slower than a company would. break_camp to move on.',false);return}
  for(const a of L)if(a.player)notify(a,the(F)+' makes camp in '+zn+(why==='rest'?' for '+g.hours+' hours':'')+'. You may party_say round the fire; the watch will wake you if anything comes. Camp status shows who sleeps, who watches and when it ends; propose break_camp to move on early.',false)}

function spotOf(g,i,n){const ang=i/Math.max(1,n)*Math.PI*2+.6;return {x:g.x+Math.cos(ang)*CAMP.RING,y:g.y+Math.sin(ang)*CAMP.RING*.8}}

function breakCamp(F,why){const g=F.camp;if(!g||!g.phase)return;const L=members(g);
  for(const a of L){a.state='hunt';a.dest=null;a.camp=undefined;a.moving=false;a.playDoing=null}
  for(const id of g.ids){const a=byId(id);if(a&&a.state==='camp'){a.state='hunt';a.camp=undefined}}
  g.cd=Math.round(S.gameMin)+CAMP.COOL;g.phase=null;
  const ids=g.ids.slice();
  const T=the(F);
  if(why==='dawn'||why==='mended'||why==='rested'||why==='called'){ev(F,'break',[why==='dawn'?T+' breaks camp at first light and takes the road.':why==='rested'?T+' has rested '+(F.slots?'its':'their')+' time and breaks camp.':why==='called'?T+' breaks camp early, '+(g.solo?'by choice':'by agreement')+', and takes the road.':T+', mended, breaks camp and takes the road.'],{why,rested:Math.round(S.gameMin-g.start)},ids);
    log(nar(''),gd(F.name),' breaks camp and takes the road.');for(const a of L)remember(a,'camp','We broke camp '+(why==='called'?'early, by our own call,':'rested')+' and took the road.')}
  // every member gets a turn-starting event so the agents act instead of idling on autopilot; an ambush has its own alarm
  if(why!=='ambush')for(const a of L)notify(a,'Camp is broken ('+(why==='dawn'?'first light':why==='called'?(g.solo?'by your own call':'by the party\'s call'):why==='rested'?'the rest is done':why==='mended'?'everyone is mended':'the camp fell apart')+'). You are on your feet: decide what to do next.',true,2);
  emit('break',g,{why})
  g.ids=[]}

// ---- visitors: an ambush on the watch ----
function ambushMob(g,lvl){const all=Object.keys(MOBS).filter(t=>MOBS[t].z===g.zone&&MOBS[t].lv&&!MOBS[t].boss);if(!all.length)return null;
  let types=all.filter(t=>MOBS[t].lv[0]<=lvl+2); // never a foe far above the company: the weakest of the region if none fits
  if(!types.length)types=[all.reduce((b,t)=>MOBS[t].lv[0]<MOBS[b].lv[0]?t:b)];
  const t=types[ri(0,types.length-1)],M=MOBS[t];
  let p=null;for(let k=0;k<8&&!p;k++){const ang=rnd()*Math.PI*2,x=g.x+Math.cos(ang)*7,y=g.y+Math.sin(ang)*7;if(open(x,y))p={x,y}}
  if(!p)return null;
  const m=spawnMob(t,null,{lvl:Math.max(M.lv[0]-2,Math.min(M.lv[1]+1,lvl)),add:true});m.xpMul=.6;m.x=p.x;m.y=p.y;m.home={...p};m.spawn={...p};return m}
function visitor(F,g,w){const L=members(g);if(!L.length)return;g.stats.visitors++;
  const avg=Math.round(L.reduce((s,a)=>s+a.lvl,0)/L.length),spot=check(w,'perception',CAMP.SPOT_DC-(g.lit?USES['Pitch Torch'].watch:0)),victim=L[ri(0,L.length-1)];
  const pass=spot.pass&&!soloSleeps(g); // a solo asleep is caught unroused whatever its roll (the same roll is still made: no dice added)
  const foeHero=nearHeroes(g.x,g.y,16,b=>b.fac!==w.fac&&b.state!=='dead'&&!b.hidden&&(b.state==='hunt'||b.state==='travel')&&Math.abs(b.lvl-w.lvl)<=3)[0];
  const useHero=foeHero&&rnd()<.4;let m=null;
  if(!useHero){m=ambushMob(g,avg);if(!m)return}
  const foeName=useHero?foeHero.name:MOBS[m.type].name;
  // everyone wakes; the camp is over for tonight
  const wake=L.slice();for(const a of wake){a.camp=undefined;a.dest=null}
  g.stats[pass?'spotted':'caught']++;
  const ids=wake.map(a=>a.id);
  if(pass)ev(F,'spotted',[w,' hears something move at the edge of the firelight and rouses the camp: ',gd(foeName),' comes out of the dark.'],{watcher:w.name,roll:spot.total,dc:spot.dc,foe:foeName,hero:!!useHero},ids);
  else{const hit=Math.min(victim.hp-1,Math.round(maxHp(victim)*CAMP.CAUGHT_HIT));victim.hp-=Math.max(0,hit);
    ev(F,'caught',g.solo?[w,' sleeps alone by the fire. ',gd(foeName),' reaches it before ',w,' wakes ('+Math.max(0,hit)+' damage).']:[w,' nods off on watch. ',gd(foeName),' reaches the fire before anyone cries out and catches ',victim,' ('+Math.max(0,hit)+' damage).'],{watcher:w.name,roll:spot.total,dc:spot.dc,foe:foeName,hero:!!useHero},ids)}
  log(nar(''),gd(F.name),' is '+(pass?'roused':'caught asleep')+' by ',useHero?foeHero:gd(foeName),' at camp in ',gd(ZONES[g.zone]||'the wilds'),'.');
  for(const a of wake){remember(a,'camp',pass?w.name+' raised the alarm: '+foeName+' came out of the dark.':'We were caught at camp by '+foeName+'.');
    if(a.player)notify(a,'ALARM at camp: '+foeName+' is on us. '+(pass?(g.solo?'You woke in time.':w.name+' raised the alarm in time.'):g.solo?'It caught you asleep.':'The watch failed.'),2)}
  breakCamp(F,'ambush');
  for(const a of wake)if(a!==w)a.cd=Math.max(a.cd||0,2.4); // a sleeper woken by the alarm is groggy for the first round
  if(useHero){const b=foeHero;for(const a of wake)a.state='hunt';w.state='duel';w.target=b;b.state='duel';b.target=w;b.dest=null}
  else{m.target=pass?w:victim;for(const a of wake){a.state='fight';a.target=m;a.dest=null}
    openScene('ambush','Ambush at camp: '+MOBS[m.type].name,[gd(MOBS[m.type].name),' comes out of the dark at '+(F===slotted()?'the Fellowship\'s camp':g.solo?'a lone camp':(F.name||'the company')+'\'s camp')+' in '+(ZONES[g.zone]||'the wilds')+'.'],{mob:m.id},F)}} // any company's camp (#440)

// ---- campfire talk ----
function talk(F,g,L){if(L.length<2)return;
  // agents say only what their agents say (issue #126): with no scripted member at the fire, no scripted line is
  // voiced; the agents hear once that the fire is lit and talk if they like (they hear each other, sim/player.js)
  const pool=L.filter(a=>reflexMay(a)); // #148: a member's words are its agent's; only one whose runner is gone (owner's leave) talks by reflex
  if(!pool.length){if(!g.agentTalk){g.agentTalk=1;for(const a of L)notify(a,'The fire is lit and the night is quiet: talk round it if you like (party_say); your companions hear you.',false,1)}return}
  g.stats.talks++;
  const h=Math.floor(S.gameMin),sp=pool[Math.floor(hash(h,g.start,5)*pool.length)%pool.length];
  const others=L.filter(a=>a!==sp),other=others[Math.floor(hash(h,sp.id,6)*others.length)%others.length];
  const hurt=L.filter(a=>a.hp<maxHp(a)*.6).length;
  let topic=TOPICS[Math.floor(hash(h,sp.id,7)*TOPICS.length)%TOPICS.length];
  if(topic==='worry'&&!hurt&&hash(h,1,8)<.5)topic='hope';
  if(topic==='quarrel'&&bond(sp,other)>=6&&hash(h,2,9)<.6)topic='memory';
  const zn=ZONES[g.zone]||'the wilds',pool2=CAMP_LINES[topic],said=g.said||(g.said=[]);let ix=Math.floor(hash(h,sp.id,10)*pool2.length)%pool2.length;for(let k=0;k<pool2.length&&said.includes(topic+ix);k++)ix=(ix+1)%pool2.length; // no line twice in a camp while others remain
  said.push(topic+ix);if(said.length>8)said.shift();const text=fill(pool2[ix],sp,other,zn);
  const asked=sp.brain&&F.ai&&S.brainOn!==false&&sayOk(sp); // speed-aware chatter cap (#117)
  const say=t=>{partySay(sp,t);remember(sp,'camp','Round the fire I said: "'+t+'"');for(const b of others)if(reflexMay(b)&&hash(h,b.id,11)<.5)remember(b,'camp',sp.name+' said at the fire: "'+(t.length>70?t.slice(0,68)+'..':t)+'"')};
  const finish=()=>{
    if(topic==='quarrel'){g.stats.quarrels++;for(const [x,y] of [[sp,other],[other,sp]]){x.bonds=x.bonds||{};x.bonds[y.id]=Math.max(-10,bond(x,y)-1)}
      stanceEvent(sp,other,'Snapped at '+other.name+' round the fire.');stanceEvent(other,sp,'Was sharp with me round the fire.');
      const rp=QUARREL_REPLY[Math.floor(hash(h,other.id,12)*QUARREL_REPLY.length)%QUARREL_REPLY.length];if(reflexMay(other))partySay(other,rp)
      campaign(F,'camp',sp,' and ',other,' snap at each other over the fire, then let it lie.')}
    else if(topic==='song'||topic==='story')campaign(F,'camp',sp,topic==='song'?' leads a song round the fire.':' tells a story round the fire.')};
  if(asked){const gen=g.start;askRelay('say',snapshotFor(sp,'say',{trigger:'camp',ctx:{topic,place:zn,kind:g.why}}),4000).then(j=>{
      const t=j&&cleanLine(j.line),c=F.camp;if(!c||c.start!==gen||sp.state!=='camp')return;say(t||text)}).catch(()=>{});finish()}
  else{say(text);finish()}}

// ---- once per step: every company, in id order ----
export function campTick(dt){const Cs=companies(),live=new Set();
  for(const C of Cs){const g=C.camp;if(g&&g.phase)for(const id of g.ids)live.add(id)}
  for(const a of S.agents)if(a.state==='camp'&&!live.has(a.id)){a.state='hunt';a.camp=undefined;a.dest=null} // a camp that no longer exists (disbanded, restored) frees its sleepers
  for(const C of Cs)campOne(C,dt)}
function campOne(F,dt){const g=F.camp&&F.camp.phase?F.camp:null;
  if(!g){if(S.table||F.ids.length<2)return; // a solo camps only when its agent calls it (rest {hours}): no one shares the call
    const L=cMembers(F),min=minCamp(F);if(!L.length||L.length<min)return;
    if(F.camp&&F.camp.cd>S.gameMin)return;
    const E=L.filter(eligible);if(E.length<min||E.length<L.length-1)return; // the (near) whole company must be out on the road together
    const ld=leaderOfC(F),lead=E.includes(ld)?ld:E[0];
    if(E.some(a=>dist(a,lead)>14))return;
    const why=wantCamp(E);if(!why)return;
    makeCamp(F,E,why);return}
  // upkeep: dead, departed or re-tasked sleepers drop out
  g.ids=g.ids.filter(id=>{const a=byId(id);return a&&a.state==='camp'});
  const L=members(g);if(!L.length||(!g.solo&&L.length<2)){breakCamp(F,'thin');return}
  const now=S.gameMin;
  for(const a of L)if(a.pq&&a.pq.length)a.pq=[];
  if(g.phase==='gather'){let all=true;
    L.forEach((a,i)=>{const p=spotOf(g,i,L.length);if(!moveTo(a,p.x,p.y,dt,2.4))all=false;a.face=g.x>a.x?1:-1});
    if(all||now-g.start>CAMP.GATHER_MAX){g.phase='rest';g.restAt=Math.round(now);g.nextRoll=now+CAMP.ROLL_MIN;g.nextTalk=now+20;g.nextBond=now+180;g.watchIdx=-1;
      for(const a of L){a.moving=false;campMeal(a)}
      for(const a of L)if(!g.lit&&a.inv&&a.inv.list.length)campLight(a)
      emit('rest',g,{why:g.why})}
    refreshDoing(L);
    return}
  // rest: heal, watches, rolls, talk
  const heal=CAMP.CAMP_HEAL*(g.solo?CAMP.SOLO_HEAL:1);
  for(const a of L){const mh=maxHp(a);a.hp=Math.min(mh,a.hp+mh*heal*dt);a.face=g.x>a.x?1:-1}
  const wi=Math.floor((now-g.restAt)/CAMP.WATCH_MIN),w=L[wi%L.length];
  if(wi!==g.watchIdx){g.watchIdx=wi;g.watcher=w.id;g.stats.watches++;
    if(g.solo){const z=soloSleeps(g);campaign(F,'camp',w,z?' sleeps by the fire, with no one to keep watch.':' keeps watch alone.');w.bubble={text:z?'Zzz.':'Keeping watch.',life:3}}
    else{campaign(F,'camp',w,' takes the '+NTH[Math.min(NTH.length-1,wi)]+' watch.');
    w.bubble={text:'Taking the watch.',life:3}}}
  if(now>=g.nextTalk){g.nextTalk=now+CAMP.TALK_MIN;talk(F,g,L)}
  if(now>=g.nextBond){g.nextBond=now+180;if(L.length>1)bondEvent(L[0],'party',L)}
  if(now>=g.nextRoll){g.nextRoll=now+CAMP.ROLL_MIN;
    if(rnd()<CAMP.AMBUSH_P+.02*g.zone){visitor(F,g,byId(g.watcher)||w);return}}
  const full=L.every(a=>a.hp>=maxHp(a)*CAMP.MENDED),h=hourNow();
  refreshDoing(L);
  if(g.why==='night'&&full&&!g.mendedNote&&!(h>=CAMP.DAWN&&h<12)){g.mendedNote=1;emit('mended',g,{});
    for(const a of L)notify(a,g.solo?'You are rested. Break camp now (break_camp) or sleep till dawn ('+hhmm(CAMP.DAWN*60)+')?':'Everyone is rested. Break camp now (propose break_camp, or break_camp if you lead) or sleep till dawn ('+hhmm(CAMP.DAWN*60)+')? If nobody speaks up the camp holds till dawn.',true,2)}
  if(g.why==='rest'){if(now>=g.restAt+g.hours*60)breakCamp(F,'rested')}
  else if(g.why==='night'){if(full&&h>=CAMP.DAWN&&h<12)breakCamp(F,'dawn')}
  else if(full||now-g.restAt>CAMP.WORN_MAX)breakCamp(F,'mended')}

// ---- the party's call: break camp early, or rest for a set time ----
// breakCampNow(why, company): the Fellowship's camp when no company is named (old callers).
export function breakCampNow(why='called',C){const F=C||slotted(),g=F&&F.camp;if(!g||!g.phase)return false;breakCamp(F,why);return true}
setCampHook(breakCampNow);
// The leader's `break_camp` tool (a solo leads itself).
export function leaderBreak(a){const F=companyOf(a),g=F&&F.camp;if(!g||!g.phase)return 'There is no camp to break.';const ld=leaderOfC(F);if(ld!==a)return 'Only the leader ('+(ld?ld.name:'?')+') breaks camp outright; propose break_camp to put it to the vote.';
  campaign(F,'camp',a,g.solo?' breaks camp.':' calls the camp to break.');breakCamp(F,'called');return null}
// The leader's `rest {hours}`: make camp now for a set time (1-8 game hours) wherever the company is.
export function leaderRest(a,hours){const F=companyOf(a);if(!F||!a)return 'Only a member of a company makes camp.';
  if(F.camp&&F.camp.phase)return the(F)+' is already camped; '+(F.ids.length>1?'propose break_camp':'break_camp')+' to move on early.';
  const ld=leaderOfC(F);if(ld!==a)return 'Only the leader ('+(ld?ld.name:'?')+') calls a camp; ask them, or rest here yourself with rest {minutes}.';
  if(F.ids.some(id=>sceneOf({id})))return 'Not now: a scene is under way.'; // the company's own scene (#518)
  const L=cMembers(F),E=L.filter(eligible),min=minCamp(F);if(L.length<min||E.length<min||E.length<L.length-1)return F.ids.length>1?'The company is not all out on the road together (hunting, travelling or following); get them together first.':'You can make camp only out on the road (hunting, travelling or following).';
  if(E.some(x=>dist(x,a)>14))return 'The company is spread too far apart to make camp together.';
  const h=Math.min(8,Math.max(1,Math.round(Number(hours)||2)));makeCamp(F,E,'rest',h);return F.camp&&F.camp.phase?null:'No safe ground to camp near here.'}
