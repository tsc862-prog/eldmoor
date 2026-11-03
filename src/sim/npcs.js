// Townsfolk: the named residents of every town (issue #28). One NPC per role in
// data/npcs.js, named once from the town's people and kept on S.npcs as plain JSON
// so save/load can carry them. They keep a daily routine by the game clock (walk to
// the post at opening time, home to the back wall at closing; the bard strolls the
// square, the gate captain never leaves the gate), greet heroes who come within two
// tiles of the post through the chat layer, and react to the world: the bard sings
// of the latest named-elite or Kragmaw kill, the priest or shaman blesses a Crypt
// party forming in town. NPCs never fight and roll their lines on a private RNG, so
// the gameplay stream is untouched except for the names and looks drawn at init.
// Owned by world-builder (routines and reactions); names and sprites by
// character-builder; lines by lore-keeper. Canon: docs/LORE.md, "Townsfolk".
import {pickA} from '../core/rng.js';
import {CITY,CRYPT,ZONES,dist} from '../world/map.js';
import {FAC} from '../data/factions.js';
import {RACES,racesOf,raceName} from '../data/races.js';
import {ELITES} from '../data/mobs.js';
import {NPC_ROLES,npcRole} from '../data/npcs.js';
import {S,clockStr,dayNo} from './state.js';
import {pop} from './effects.js';
import {moveTo} from './heroes.js';
import {attitudeOf,presence} from './levers.js';
import {within,LOD} from './spatial.js';
import {inSlots,slotted} from './company.js'; // the slotted company (#588)

// Tuning. Speeds in tiles/s at 1x; GREET_R tiles from the post that count as a visit;
// BLESS_R the priest's reach; HEAR who hears a line (same as chat.js); COOL real seconds
// between lines of one NPC (URGENT: a blessing may cut in that much early); REGREET game
// minutes before the same hero gets another greeting roll from the same NPC (a game week:
// heroes pass three posts on every town visit, and the chat layer should not drown in
// small talk; with GREET_P this lands at 30-50 heard lines per real hour across both
// towns); SONG_GAP real seconds between songs; NEWS_TTL game minutes before news is too
// old to sing.
export const WALK=1.6,STROLL=1.1,GREET_R=2,BLESS_R=3,HEAR=7,COOL=30,URGENT=3,BUBBLE=3,CAP=20,
  REGREET=10080,GREET_P=.12,SONG_GAP=90,NEWS_TTL=2880;

// Private LCG: choosing lines, stroll points and pauses never perturbs the gameplay RNG.
const SEED0=0x3c6ef372;let seed=SEED0;export const resetNpcSeed=()=>{seed=SEED0}; // init() puts the private stream back (#674)
const r=()=>{seed=(Math.imul(seed,1103515245)+12345)&0x7fffffff;return seed/0x80000000};

const fill=(s,p,ctx)=>s.replace(/\{(\w+)\}/g,(_,k)=>k==='name'?p.name:k==='town'?p.town:ctx[k]!=null?String(ctx[k]):k)
  .replace(/\b([Aa]) (?=[AEIOUaeiou])/g,'$1n ');
const hour=()=>(S.gameMin/60)%24;
const atWork=R=>{if(!R.hours)return true;const h=hour(),[o,c]=R.hours;return c>o?h>=o&&h<c:h>=o||h<c};

const cityCache={};
const cityOf=p=>cityCache[p.town]||(cityCache[p.town]=CITY.find(c=>c.name===p.town)||CITY[0]);
export const townNpc=(c,role)=>(S.npcs||[]).find(p=>p.town===c.name&&p.role===role)||null;

// Homes: a row along the back wall (opposite the gate), spread over the interior.
function homeAt(c,i,n){const f=(i+.5)/n,g=c.gateSide;
  if(g==='E')return{x:c.x0+1.5,y:c.y0+1.5+f*(c.h-3)};
  if(g==='W')return{x:c.x1-1.5,y:c.y0+1.5+f*(c.h-3)};
  if(g==='S')return{x:c.x0+1.5+f*(c.w-3),y:c.y0+1.5};
  return{x:c.x0+1.5+f*(c.w-3),y:c.y1-1.5}}
// Just inside the gate: where the priest hurries to bless a departing Crypt party.
function gateIn(c){const [[ax,ay],[bx,by]]=c.gateTiles,g=c.gateSide,x=(ax+bx)/2+.5,y=(ay+by)/2+.5;
  return g==='E'?{x:x-1.3,y}:g==='W'?{x:x+1.3,y}:g==='S'?{x,y:y-1.3}:{x,y:y+1.3}}
// A stroll point for the bard: within 1.3 tiles of the square, inside the walls.
function strollPt(p,c){const a=r()*6.283,d=.4+r()*.9;
  return{x:Math.min(c.x1-.3,Math.max(c.x0+1.3,p.post.x+Math.cos(a)*d)),y:Math.min(c.y1-.3,Math.max(c.y0+1.3,p.post.y+Math.sin(a)*d))}}

// Build the roster once: every town staffs its roles (or all roles) with people of
// its own race. Names come from the shared race pool, so no hero ever shares one.
export function ensureNpcs(){if(S.npcs)return;
  S.npcs=[];
  S.npcNews={eliteKills:S.eco?S.eco.stats.eliteKills:0,heroElite:{},bosses:S.facStats.map(f=>f.bosses),items:[],
    stats:{lines:0,heard:0,greets:0,songs:0,blessings:0}};
  for(const a of S.agents)S.npcNews.heroElite[a.id]=a.eliteKills||0;
  for(const c of CITY){
    const roles=(c.npcs||NPC_ROLES.map(x=>x.id)).map(npcRole).filter(Boolean);
    const race=RACES.find(x=>x.id===c.race)||racesOf(c.fac)[0]||RACES[0];
    roles.forEach((R,i)=>{const post=c.spots[R.post]||c.spots.square||c.ah,home=homeAt(c,i,roles.length);
      S.npcs.push({id:++S.uid,kind:'npc',role:R.id,title:R.title[c.fac]||R.title[0],name:raceName(race),race:race.id,fac:c.fac,town:c.name,
        skin:pickA(race.skin),hair:pickA(race.hair),x:home.x,y:home.y,home,post:{x:post.x,y:post.y},
        state:'home',shift:null,face:1,moving:false,chatCd:0,bubble:null,met:{},wait:0,stroll:null,errand:null,songCd:0,lastBark:''})})}}

// Speak: a role line for the trigger, filled in, pushed onto the chat buffer of every
// living hero within earshot and shown as a bubble. Returns whether a line was said.
// #164: a townsperson says no scripted line of their own while the DM voices the world. Only when a Fellowship
// member is in earshot (a meeting, a greeting, a blessing: a world character interacting with them) the
// scripted DM speaks it for them, attributed to the NPC, with a bubble; opts.dm forces it (an agent's talk).
// Lines are picked and the cooldown set either way, so the private RNG and the routine stay identical.
export function npcSay(p,trigger,ctx={},opts={}){
  const R=npcRole(p.role),L=R&&R.lines[trigger];if(!L)return false;
  const pool=L[p.fac]||L[0];let line=pool[Math.floor(r()*pool.length)];
  if(pool.length>1&&line===p.lastBark)line=pool[(pool.indexOf(line)+1)%pool.length];p.lastBark=line;
  // `from` is a small stub, not the live NPC: the chat tab only needs name and faction, and
  // the save walker (sim/save.js) would otherwise copy the whole NPC into every hero's buffer.
  const dmVoice=opts.dm||S.worldVoice!=='dm'||S.agents.some(a=>inSlots(a)&&a.state!=='dead'&&!a.hidden&&within(a,p,HEAR));
  if(!dmVoice){p.chatCd=COOL;return false}
  const text=fill(line,p,ctx),e={t:clockStr(),d:dayNo(),from:{kind:'npc',id:p.id,name:p.name,fac:p.fac},text,trigger:'npc'};if(S.worldVoice==='dm')e.dm=true;let heard=0;
  for(const a of S.agents){if(a.state==='dead'||a.hidden||!within(a,p,HEAR))continue;if(slotted()&&inSlots(a))e.fh=true;(a.chat||(a.chat=[])).push(e);if(a.chat.length>CAP)a.chat.shift();heard++}
  p.bubble={text,life:BUBBLE};if(e.fh)p.bubble.fh=true;p.chatCd=COOL;
  const st=S.npcNews.stats;st.lines++;if(heard)st.heard++;return true}

// Daily routine: walk to the post in working hours, home outside them; open and close
// lines on arrival once per shift. The bard strolls around the square between pauses.
function routine(p,c,dt){
  const R=npcRole(p.role),work=atWork(R);let tgt=work?p.post:p.home,sp=WALK;
  if(!work)p.stroll=null;
  if(p.errand)tgt=p.errand;
  else if(work&&p.role==='bard'){
    if(p.state==='post'){p.wait-=dt;if(p.wait<=0){p.stroll=strollPt(p,c);p.state='walk'}}
    if(p.stroll)tgt=p.stroll;sp=STROLL}
  if(!moveTo(p,tgt.x,tgt.y,dt,sp)){p.state='walk';return}
  if(p.state!=='walk')return;
  if(p.errand){p.state='post';return}
  // Opening and closing words only when someone is there to hear them, one time in four:
  // twelve residents calling out at every dawn and dusk would drown the chat tabs.
  const shift=work?'day':'night',said=p.shift!==shift&&nearHero(p,GREET_R+1)&&r()<.25;p.shift=shift;
  if(work){p.state='post';p.wait=3+r()*5;if(said)npcSay(p,'open')}
  else{p.state='home';if(said)npcSay(p,'close')}}
const nearHero=(p,rad)=>S.agents.some(a=>a.state!=='dead'&&a.state!=='ghost'&&!a.hidden&&within(a,p,rad));

// Greeting: the first unmet (or long unseen) living hero within GREET_R of an NPC at post.
function greet(p,work){
  if(p.chatCd>0||!(p.state==='post'||(p.role==='bard'&&work)))return;
  for(const a of S.agents){if(a.state==='dead'||a.state==='ghost'||a.hidden||!within(a,p,GREET_R))continue;
    const last=p.met[a.id];if(last!=null&&S.gameMin-last<REGREET)continue;
    // DM levers: a hostile resident turns away; a friendly one, a festival or a plague changes the odds
    p.met[a.id]=S.gameMin;const att=attitudeOf(p,[a]);if(att==='hostile'||r()>=GREET_P*presence(p.town)*(att==='friendly'?2:1))continue;
    p.face=a.x>p.x?1:-1;if(npcSay(p,'greet',{target:a.name}))S.npcNews.stats.greets++;return}
  if(Object.keys(p.met).length>120)for(const k in p.met)if(S.gameMin-p.met[k]>REGREET)delete p.met[k]}

// News: a named elite slain (S.eco.stats.eliteKills moved; the hero whose eliteKills
// rose names the killer, and the zone's ELITES entry names the beast) or Kragmaw slain
// (facStats bosses moved; the highest hero of that faction still at the lair gets the
// credit: boss.js has already sent the raid home by the time this tick runs).
function newsTick(){const n=S.npcNews,st=S.eco&&S.eco.stats;
  if(st&&st.eliteKills!==n.eliteKills){n.eliteKills=st.eliteKills;
    for(const a of S.agents){const k=a.eliteKills||0;if(k<=(n.heroElite[a.id]||0))continue;n.heroElite[a.id]=k;
      const E=ELITES[a.zone];n.items.push({kind:'elite',t:S.gameMin,hero:a.name,fac:a.fac,elite:E?E.name:'the beast',zone:ZONES[a.zone]||'the wilds',sung:{}})}}
  for(let f=0;f<S.facStats.length;f++){if(S.facStats[f].bosses===n.bosses[f])continue;n.bosses[f]=S.facStats[f].bosses;
    const lead=S.agents.filter(a=>a.fac===f&&a.state!=='dead'&&dist(a,S.boss)<9).sort((x,y)=>y.lvl-x.lvl)[0];
    n.items.push({kind:'boss',t:S.gameMin,hero:lead?lead.name:FAC[f].name+' raiders',fac:f,elite:S.boss.name,zone:ZONES[ZONES.length-1],sung:{}})}
  while(n.items.length&&(n.items.length>6||S.gameMin-n.items[0].t>NEWS_TTL))n.items.shift();
  if(Object.keys(n.heroElite).length>400){const live=new Set(S.agents.map(a=>a.id));for(const k in n.heroElite)if(!live.has(+k))delete n.heroElite[k]}}

// The bard sings the oldest news this town has not heard, once someone is near enough to hear it.
function sing(p,dt){if(p.songCd>0){p.songCd-=dt;return}if(p.chatCd>0)return;
  const item=S.npcNews.items.find(it=>!it.sung[p.town]);if(!item)return;
  if(!S.agents.some(a=>a.state!=='dead'&&!a.hidden&&within(a,p,HEAR)))return;
  item.sung[p.town]=1;const own=item.fac===p.fac;
  npcSay(p,item.kind==='boss'?(own?'boss':'bossFoe'):(own?'song':'songFoe'),{hero:item.hero,elite:item.elite,zone:item.zone});
  p.songCd=SONG_GAP;S.npcNews.stats.songs++}

// The priest or shaman blesses a Crypt party of their faction gathering in town: one
// strike at +20% (a.blessed, as the wayside shrines grant), hurrying to the gate while
// unblessed members are still inside the walls.
function bless(p,c){const g=CRYPT&&CRYPT.group;
  if(!g||g.phase!=='gather'||g.fac!==p.fac){p.errand=null;return}
  const need=g.mem.filter(a=>!a.blessed&&a.state==='dungeon');
  p.errand=need.some(a=>a.x>=c.x0-2&&a.x<=c.x1+3&&a.y>=c.y0-2&&a.y<=c.y1+2)?gateIn(c):null;
  for(const a of need){if(dist(a,p)>BLESS_R)continue;a.blessed=1;pop(a.x,a.y-.6,'BLESSED','#9ad0ff');S.npcNews.stats.blessings++;
    if(p.chatCd<=COOL-URGENT){p.face=a.x>p.x?1:-1;npcSay(p,'bless',{target:a.name})}}}

// Once per step from sim/index.js.
export function npcsTick(dt){ensureNpcs();newsTick();
  for(const p of S.npcs){const c=cityOf(p),work=atWork(npcRole(p.role));
    if(p.chatCd>0)p.chatCd-=dt;
    if(p.bubble){p.bubble.life-=dt;if(p.bubble.life<=0)p.bubble=null}
    if(p.role==='priest')bless(p,c);
    routine(p,c,dt);
    if(!LOD.on||(LOD.tick+p.id)%LOD.GREET_EVERY===0)greet(p,work); // #433 LOD (off by default): staggered
    if(p.role==='bard')sing(p,dt)}}
