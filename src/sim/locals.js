// Townsfolk in the agents' turns (owner request): who is about, arrival news, and hails.
// The people already answer a member who speaks to them (sim/talk.js, #170), but agents rarely did. This module
//   localsNear(a)  up to 4 people the hero can see (in earshot, or in the town square it stands in), each with a short
//                  hook from what the game shows anyone: a role's trade and the person's public stance. No wants, no
//                  secrets, no notes (the in-game channels rule, #123; a want is learnt by listening, sim/talk.js).
//   localsTick(dt) about once a game second from step(): for each agent-played Fellowship member in a town, one soft
//                  arrival news line per visit, and at most one hail per visit: a person with something relevant to the
//                  member (a job on the board for their level, news of an oath, the elite on their road, goods they lack)
//                  calls to them and opens a conversation (talk.js), which the member answers with say or talk.
// Deterministic: no RNG at all (a hash of ids and the arrival time picks which visits get a hail), agent-played Fellowship
// members only, so a world with no Fellowship is untouched and a seeded run is identical. DOM-free. Owned by ai-designer.
import {S} from './state.js';
import {CITY,ZONES,dist} from '../world/map.js';
import {ELITES} from '../data/mobs.js';
import {ADVENTURES} from '../data/adventures.js';
import {ROLE_STOCK} from '../data/talk-lines.js';
import {hash} from '../core/rng.js';
import {notify} from './notify.js';
import {HEAR} from './chat.js';
import {ensureNpcs} from './npcs.js';
import {attitudeOf} from './levers.js';
import {huntZone} from './heroes.js';
import {weakestSlot,slotLevel} from './gear.js';
import {talkState,talkFromScene,convWith,speakAsHail,CONV} from './talk.js';
import {inSlots,slotted} from './company.js'; // the slotted company (#588)

export const LOC={MAX:4,HAIL_R:4,SETTLE:10,CHANCE:.6,EVERY:1}; // list size; tiles a hailer calls from; game minutes after arrival before a hail; share of visits with a hail; seconds between looks
const inRect=(c,p,pad=0)=>p.x>=c.x0-pad&&p.x<=c.x1+1+pad&&p.y>=c.y0-pad&&p.y<=c.y1+1+pad;
const cityAt=p=>CITY.find(c=>inRect(c,p,.5))||null;
const full=p=>(p.title?p.title+' ':'')+p.name;
const living=a=>a&&a.state!=='dead'&&!a.hidden;
const people=()=>{ensureNpcs();return [...(S.npcs||[]),...(S.wanderers||[])].filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))};

// What anyone can tell a role is for.
const ROLE_HOOK={innkeeper:'news, rooms',smith:'repairs, sells blades',quartermaster:'supplies, sells packs',priest:'blessings',bard:'songs, tales',
  captain:'the gate, work for blades',peddler:'sells odds and ends',hermit:'keeps to himself',drover:'the roads, the herds',sellsword:'hires out',
  minstrel:'songs, tales',stranger:'a stranger'};
const hookOf=p=>ROLE_HOOK[p.role]||'';
const stance=(p,a)=>{const t=attitudeOf(p,[a]);return t&&t!=='neutral'?t:''};

// Up to LOC.MAX people the hero can see, nearest first, each {name, role, hook, dist}. In town the whole square counts.
export function localsNear(a){if(!a||!living(a))return [];const here=a.state==='town'?cityAt(a):null,out=[];
  for(const p of people()){const d=dist(a,p);if(d>HEAR&&!(here&&p.town===here.name&&inRect(here,p,1)))continue;
    out.push({p,d})}
  out.sort((x,y)=>x.d-y.d||x.p.id-y.p.id);
  return out.slice(0,LOC.MAX).map(({p,d})=>{const bits=[stance(p,a),hookOf(p)].filter(Boolean);
    return {name:full(p),role:p.role,hook:full(p)+(bits.length?' ('+bits.join(', ')+')':''),dist:Math.round(d*10)/10}})}

// ---- the arrival line ----
const roleWord=p=>p.role==='stranger'?'a stranger':'the '+p.role;
function arrivalLine(c){const P=people().filter(p=>p.town===c.name&&inRect(c,p,1));
  const words=[];for(const p of P){const w=roleWord(p);if(!words.includes(w))words.push(w)}
  if(!words.length)return null;const w=words.slice(0,4),more=words.length>w.length;
  return 'In '+c.name+': '+(more?w.join(', ')+' and others':w.length>1?w.slice(0,-1).join(', ')+' and '+w[w.length-1]:w[0])+(words.length>1?' are':' is')+' about.'}

// ---- what a person has for this member ----
// Returns {topic, text} or null. Priority: a job for them, an oath, the elite on their road, goods they lack.
function reason(p,a,c){const role=p.role;
  if(['innkeeper','captain','quartermaster','smith','priest','bard'].includes(role)&&a.lvl>=4){
    const h=(S.adventures||[]).find(x=>x.phase==='open'&&x.town===c.name&&(x.for==null||x.for===a.id)&&ADVENTURES[x.tpl]&&a.lvl>=(ADVENTURES[x.tpl].lvl||0)&&(role==='captain'||role==='innkeeper'||!x.giver||x.giver.role===role));
    if(h)return {topic:'job',text:'There is work posted at the gate that might suit you: '+(ADVENTURES[h.tpl].name||h.tpl)+'. Come, I will tell you what I know.'}}
  const g=a.goal;
  if(g&&!g.done&&g.type==='avenge'&&g.target&&['innkeeper','bard','drover','captain'].includes(role))
    return {topic:'oath',text:'You have the look of one who hunts '+g.target+'. I have heard talk of it; come and ask me.'};
  const z=huntZone(a),E=ELITES[z];
  if(E&&E.name&&['innkeeper','bard','drover','hermit'].includes(role))
    return {topic:'rumour',text:'Hold a moment, traveller. They say '+E.name+' prowls '+ZONES[z]+'. Few who meet it come home whole.'};
  if((ROLE_STOCK[role]||[]).includes('gear')&&a.slots){const k=weakestSlot(a);if(k&&slotLevel(a,k)<a.lvl-1)return {topic:'goods',text:'That '+k+' of yours has seen better days. I have gear that would suit your level; come and look.'}}
  if(role==='peddler'||role==='quartermaster')return {topic:'goods',text:'Supplies for the road? I have what a traveller needs, and fair prices for the Fellowship.'};
  return null}

// ---- once per step (sim/index.js) ----
let acc=0;export const resetLocals=()=>{acc=0}; // a new world starts the timer over (#674)
export function localsTick(dt){if(!slotted())return;acc+=dt;if(acc<LOC.EVERY)return;acc=0;
  const T=talkState();
  for(const a of S.agents){if(!inSlots(a)||!a.player||!living(a)||a.kind!=='hero')continue;
    const c=a.state==='town'?cityAt(a):null;
    if(!c){if(a.visit)a.visit=null;continue}
    let v=a.visit;
    if(!v||v.town!==c.name){v=a.visit={town:c.name,at:Math.round(S.gameMin),news:0,hail:0};
      const line=arrivalLine(c);if(line){notify(a,line,true,1);v.news=1}continue}
    if(v.hail||S.gameMin-v.at<LOC.SETTLE)continue;
    if(hash(a.id,v.at,3)>=LOC.CHANCE){v.hail=-1;continue} // this visit has no hail
    if(T.cur.filter(x=>x.state==='open').length>=CONV.OPEN_MAX)continue;
    if(T.cur.some(x=>x.state==='open'&&x.heroes.includes(a.id)))continue;
    let best=null,bd=1e9;
    for(const p of people()){if(p.hostile||convWith(p)||(p.snub&&p.snub[a.id]>S.gameMin))continue;
      if(p.town&&p.town!==c.name)continue;
      const d=dist(a,p);if(d>LOC.HAIL_R||d>=bd)continue;
      const w=reason(p,a,c);if(w){best={p,w};bd=d}}
    if(best)v.hail=hail(a,best.p,best.w)?1:-1}}

function hail(a,p,w){const c=talkFromScene(p,[a.id],null);if(!c)return false;
  c.hail=w.topic;const spoke=speakAsHail(p,c,w.text); // a live DM agent voices the opening itself: then the line arrives as chat
  notify(a,spoke?full(p)+' calls to you: "'+w.text+'" (answer with say, or talk to '+p.name+')':full(p)+' calls to you and waits for a word (say, or talk to '+p.name+')',true,1);return true}
