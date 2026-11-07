// Learn the world (issue #188): what an agent-played hero knows of creatures and places, learned only in the game.
// A creature first seen is described, not numbered ("a lean, quick wolf-like beast"); a Lore or Perception read at
// first sight (d20 from a hash, no RNG drawn) may size it up. Fighting it, killing it, its tricks, a near death, a
// companion falling to it, a warning heard (a townsperson, a companion, the narrator, the town criers) teach more:
// its name, its threat to this hero in words, its tricks. Places: the hero knows its home region and friendly towns,
// and learns a region or landmark by going there or hearing of it; move_to goes only to known places, a direction
// or coordinates (sim/player.js). Exact levels and HP are never shown to the agent; the watcher still sees all.
//
// Only agent-played heroes (a.player) learn; every hook returns at once for anyone else, nothing here draws from the
// shared RNG, and nothing changes what a hero does except through the agent's own tools (hunt without prey skips
// the creatures this hero has learned to fear). So the scripted headless sim is unchanged.
//
//   a.lore = {c:{key:{seen, read, rl, name, told, fought, killed, hurt, fell, warned, tricks:[], z:[], lo, hi}},
//             p:{placeName:{how:'home'|'been'|'seen'|'told', at, hurt, fell, warned, dm}}}
//   dm: the id of a DM-marked place (S.places, #423), learned like a landmark; the entry fades with the marker.
//   key: a MOBS key, a VARIANTS key (site foes), or 'n:'+name for a named elite or an adventure's named foe.
import {S,ownTown} from './state.js';
import {farNames,spotHere} from './atlas.js';
import {hash} from '../core/rng.js';
import {ZONES,REGIONS,CITY,LANDMARKS,EXITS,zoneAt,dist} from '../world/map.js';
import {hasCrypt,cryptTitle,cryptIf,cryptBand} from './crypts.js';
import {homeOf} from '../data/races.js';
import {MOBS,ELITES} from '../data/mobs.js';
import {BESTIARY,VARIANTS,NAMED_KITS,ABILITIES,baseId} from '../data/bestiary.js';
import {bestFor} from './abilities.js';
import {ev} from './notify.js';
import {moment} from './reflect.js';
import {nearHeroes,nearMobs} from './spatial.js';
import {held} from './scenes.js';
import {sightFor} from './weather.js';
import {onWorld} from './kept.js';
import {clearLine} from './path.js';

export const LORE={
  DC:12,          // the first-sight read (d20 + the better of Lore and Perception)
  ELITE_DC:4,     // a named elite is harder to size up
  ELITE_RANK:4,   // levels an elite counts above its own for the threat words
  NEAR:.3,        // a fight that leaves the hero below this share of max HP is a near death (a lesson)
  WITNESS:12,     // tiles: a hero this close sees another fall
  FEAR:4,         // threat rank from which hunt without prey leaves a creature alone
  DIR:15,         // tiles one "explore <direction>" walks
  SNIP:110,       // characters of a warning kept
};
const RANKS=['beneath you','easy prey','an even match','dangerous for you','more than you can handle','certain death'];
export const rankOf=d=>d<=-5?0:d<=-2?1:d<=1?2:d<=3?3:d<=6?4:5;
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const learner=a=>!!(a&&a.kind==='hero'&&a.player&&a.state!=='dead');
const strHash=s=>{let h=0;for(let i=0;i<s.length;i++)h=(Math.imul(h,31)+s.charCodeAt(i))|0;return h};

// ---- creatures: keys, names, descriptions (words from the bestiary's own family and role) ----
const FAMILY={beast:'beast',vermin:'crawling thing',undead:'dead thing that walks',elemental:'thing of living rock','brute-folk':'swamp-dweller',bandit:'armed figure',wyrm:'wyrm'};
const ROLE={skirmisher:'lean, quick',brute:'heavy, thick-hided',caster:'strange',swarm:'small',guardian:'hulking',leader:'commanding'};
const SHAPE={wolf:'wolf-like',boar:'tusked',spider:'many-legged',bog:'squat, grey-green',golem:'stone-bodied',drake:'scaled, winged',shaghorn:'shaggy, horned',wight:'pale'};
export const keyOf=m=>m.elite||m.named?'n:'+m.name:m.v&&VARIANTS[m.v]?m.v:baseId(m.type);
export function realName(m){if(m.elite||m.named)return m.name+(m.title?', '+m.title:'');if(m.v&&VARIANTS[m.v])return VARIANTS[m.v].name;return MOBS[m.type]?MOBS[m.type].name:'monster'}
function describe(m){const V=m.v&&VARIANTS[m.v],B=V||BESTIARY[baseId(m.type)]||{},fam=B.family,role=m.role||B.role,spr=MOBS[m.type]&&MOBS[m.type].spr;
  const shape=fam==='bandit'?'':SHAPE[spr]||'';const w=[ROLE[role],shape,FAMILY[fam]||'creature'].filter(Boolean).join(' ');
  return m.elite||m.named?'a huge, scarred '+w+', bigger than any of its kind':'a '+w}

// Every creature name the world uses, for hearing: [{re, key}], singular and plural, and a last-word alias when it is
// unique ("the lurkers nearly had me"). Built once from the creature tables; never hard-coded.
let LEX=null;
onWorld(()=>{LEX=null},()=>{const L=lexicon(),far=new Set(farNames());return {loreCreatures:L.c.map(x=>x.n),lorePlaces:L.p.map(x=>x.n).filter(n=>!far.has(n))}}); // another map (#1013): its creatures and places
function lexicon(){if(LEX)return LEX;const names=[],add=(n,key)=>{if(n)names.push({n:String(n),key})};
  for(const k of Object.keys(MOBS)){add(MOBS[k].name,k);add(MOBS[k].pl,k)}
  for(const k of Object.keys(VARIANTS)){add(VARIANTS[k].name,k);add(VARIANTS[k].pl,k)}
  for(const E of ELITES)if(E&&E.name)add(E.name,'n:'+E.name);
  for(const n of Object.keys(NAMED_KITS))add(n.replace(/^the /i,''),'n:'+n);
  const last=new Map();for(const x of names){const w=x.n.split(' ').pop();if(w.length<5||w===x.n)continue;const o=last.get(w.toLowerCase());last.set(w.toLowerCase(),o&&o!==x.key?null:x.key)}
  for(const [w,key] of last)if(key)names.push({n:w,key});
  names.sort((x,y)=>y.n.length-x.n.length);
  const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  LEX={c:names.map(x=>({n:x.n,key:x.key,re:new RegExp('\\b'+esc(x.n)+'\\b','i')})),
    p:[...new Set([...placeNames(),...farNames()])].map(n=>({n,re:new RegExp('\\b'+esc(n)+'\\b','i')}))}; // other lands too (#1013): a name heard is a place heard of
  return LEX}
const placeNames=()=>[...ZONES,...LANDMARKS.map(l=>l.name),cryptTitle()].filter(Boolean).filter((n,i,A)=>A.indexOf(n)===i).sort((x,y)=>y.length-x.length);
const keyName=key=>key.startsWith('n:')?key.slice(2):VARIANTS[key]?VARIANTS[key].name:MOBS[key]?MOBS[key].name:key;
const keyPlural=key=>key.startsWith('n:')?key.slice(2):VARIANTS[key]?VARIANTS[key].pl:MOBS[key]?MOBS[key].pl:key;

// ---- the hero's lore ----
export function loreOf(a){if(a.lore)return a.lore;const L=a.lore={c:{},p:{}};
  const c=homeOf(a),hz=c&&c.gate?zoneAt(c.gate.x,c.gate.y):-1;if(ZONES[hz])L.p[ZONES[hz]]={how:'home',at:Math.round(S.gameMin)};
  const z=zoneAt(a.x,a.y);if(ZONES[z]&&!L.p[ZONES[z]])L.p[ZONES[z]]={how:'been',at:Math.round(S.gameMin)};
  for(const e of EXITS)L.p[e.name]={how:'told',from:'the gate captain',at:Math.round(S.gameMin)}; // everyone here knows the roads out by name; where they lead is the gate's word (#1013)
  return L}
function entry(a,key){const L=loreOf(a);return L.c[key]||(L.c[key]={tricks:[],z:[]})}
const seenLvl=(e,m)=>{if(m.lvl==null)return;e.last=m.lvl;e.lo=e.lo==null?m.lvl:Math.min(e.lo,m.lvl);e.hi=e.hi==null?m.lvl:Math.max(e.hi,m.lvl)};
const where=(e,m)=>{const z=MOBS[m.type]?MOBS[m.type].z:null;if(ZONES[z]&&!e.z.includes(ZONES[z]))e.z.push(ZONES[z])};
const effLvl=m=>(m.lvl||1)+(m.elite||m.named?LORE.ELITE_RANK:0);
// The first-sight read: d20 (from a hash of hero, creature and the hero's level, so a new level brings a new try) +
// the better of Lore and Perception vs DC. Draws nothing from the shared RNG.
function read(a,e,m,key){if(e.read||e.rl===a.lvl)return;e.rl=a.lvl;
  const d20=1+Math.floor(hash(a.id,strHash(key),a.lvl)*20),b=bestFor([a],['lore','perception']),dc=LORE.DC+(m.elite||m.named?LORE.ELITE_DC:0);
  if(d20+(b?b.mod:0)>=dc){e.read=1;if(b&&b.skill==='lore')e.name=1}}
// A creature in sight. Returns its entry. First sight: noted, and read.
export function sight(a,m){if(!learner(a)||!m||m.kind!=='mob')return null;const key=keyOf(m),e=entry(a,key),first=!e.seen;
  if(first)e.seen=Math.round(S.gameMin);read(a,e,m,key);seenLvl(e,m);where(e,m);if(first)e.fresh=1;return e}
// The threat rank this hero perceives for one creature, or null when it cannot tell.
export function perceived(a,m){const e=a.lore&&a.lore.c[keyOf(m)];if(!e)return null;
  if(e.fought||e.read)return rankOf(effLvl(m)-a.lvl);return null}
const knowsName=e=>!!(e&&(e.name||e.told||e.fought||e.killed||e.fell));
// What the hero calls it: its name once known, else what it looks like.
export function foeName(a,m){if(!m)return 'something';if(m.kind==='hero')return m.name;if(m.kind==='boss')return 'Kragmaw';if(m.kind!=='mob')return m.name||'something';
  if(!learner(a))return realName(m);const e=a.lore&&a.lore.c[keyOf(m)]||sight(a,m);return knowsName(e)?realName(m):describe(m)}
// The words for a creature's threat to this hero.
export function threatText(a,m){const r=perceived(a,m),e=a.lore&&a.lore.c[keyOf(m)];if(r!=null)return (e&&e.fought?'':'looks ')+RANKS[r];
  if(e&&e.warned)return 'you were warned of it';return 'hard to judge'}
// A creature as `look` shows it: no level, no HP numbers.
export function mobView(a,m){const e=sight(a,m),o={id:m.id,what:foeName(a,m),threat:threatText(a,m)};
  if(e&&e.fresh){o.new_to_you=true;delete e.fresh}
  if(m.elite||m.named)o.named=true;if(m.hp<m.maxhp)o.wounded=m.hp<m.maxhp*.5?'badly':'lightly';return o}
// Should hunt-without-prey leave this one alone? Only for what this hero has learned to fear.
export function feared(a,m){const e=a.lore&&a.lore.c[keyOf(m)];if(!e)return false;if(e.fear)return true;const r=perceived(a,m);
  if(r!=null)return r>=LORE.FEAR;return !!e.warned&&!e.killed}

// ---- learning from experience ----
// The hero closes with a creature (watch() in sim/player.js, once per foe): its name, a truer measure, the place.
export function engage(a,m){if(!learner(a)||!m||m.kind!=='mob')return;const e=sight(a,m);if(!e)return;if(a.loreFoe===m.id)return;a.loreFoe=m.id;
  const first=!e.fought;e.fought=(e.fought||0)+1;e.name=1;seenLvl(e,m);if(first){const r=rankOf(effLvl(m)-a.lvl);ev(a,'You learn what you face: '+realName(m)+' ('+RANKS[r]+').'+(r>=LORE.FEAR?' flee() breaks off now.':''),r>=LORE.FEAR?2:undefined)}} // beyond the hero: a turn at once, with the way out (#934)
export function slain(a,m){if(!learner(a)||!m)return;const e=entry(a,keyOf(m));e.killed=(e.killed||0)+1;e.name=1;seenLvl(e,m);where(e,m);if(e.fear)delete e.fear} // beaten since it wounded you: the fear is spent
// A trick the creature used on the hero (sim/mobs.js): id is an ABILITIES key, or 'pack' when it called its kin.
export function trick(a,m,id){if(!learner(a)||!m)return;const e=entry(a,keyOf(m));if(e.tricks.includes(id))return;e.tricks.push(id);
  ev(a,'You learn a trick of the '+foeName(a,m).replace(/^an? /,'')+': '+trickName(id)+'.')}
const trickName=id=>id==='pack'?'it calls its kin':ABILITIES[id]?ABILITIES[id].name+' (it '+ABILITIES[id].txt+')':id;
// A fight that left the hero below LORE.NEAR of its HP: a lesson, and a reflection moment (#179).
export function nearDeath(a,m){if(!learner(a)||!m||m.kind!=='mob'||a.loreNear===m.id)return;a.loreNear=m.id;const e=entry(a,keyOf(m));e.hurt=(e.hurt||0)+1;e.name=1;
  const z=ZONES[zoneAt(a.x,a.y)];if(z){const p=place(a,z,'been');p.hurt=(p.hurt||0)+1}
  const what=realName(m);ev(a,'A hard lesson: '+(m.elite||m.named?what:'a '+what)+' nearly killed you'+(z?' in '+z:'')+'.',true);
  moment(a,'lesson',what+' nearly killed you'+(z?' in '+z:''))}
// A creature left a lasting wound (sim/tend.js takeWound, #656): feared until the hero has killed one. foe: a mob, the boss, or a crawl foe {type, name}.
export function woundFear(a,foe){if(!learner(a)||!foe||foe.kind==='hero')return;
  const key=foe.kind==='boss'?'n:'+foe.name:foe.kind==='mob'||MOBS[foe.type]?keyOf(foe):foe.name?'n:'+foe.name:null;if(!key)return;
  const e=entry(a,key);e.fear=1;e.name=1;e.hurt=e.hurt||1;ev(a,'You will not forget what did this: '+keyName(key)+'. You fear it now, until you have killed one.')}
// A hero fell to a creature: every learner who saw it (in sight, or a companion) learns it, and where.
export function witness(dead,m){if(!dead||!m||m.kind!=='mob')return;const z=ZONES[zoneAt(dead.x,dead.y)];
  // Sight, not a list: a hero sees a fall within its own sight (never out of the Crypt, or from it); a companion of the fallen within shouting range knows too (#539).
  for(const x of nearHeroes(dead.x,dead.y,LORE.WITNESS)){if(x===dead||!learner(x)||x.hidden)continue;
    const mate=x.company!=null&&x.company===dead.company,seen=!dead.hidden&&dist(x,dead)<=LORE.WITNESS*sightFor(x,zoneAt(x.x,x.y));if(!seen&&!mate)continue;
    const e=entry(x,keyOf(m));e.fell=(e.fell||0)+1;e.name=1;seenLvl(e,m);where(e,m);if(!e.warned)e.warned='You saw '+dead.name+' fall to it';
    if(z){const p=place(x,z,'been');p.fell=(p.fell||0)+1}
    ev(x,'You saw '+dead.name+' fall to '+(m.elite||m.named?'':'a ')+realName(m)+'. You will not forget what it can do.',true);
    moment(x,'lesson',dead.name+' fell to '+realName(m)+(z?' in '+z:''))}}

// ---- places ----
function place(a,name,how){const L=loreOf(a),p=L.p[name];const order={told:0,seen:1,been:2,home:3};
  if(p){if((order[how]||0)>(order[p.how]||0))p.how=how;return p}return L.p[name]={how,at:Math.round(S.gameMin)}}
// What a hero found searching a marked place (sim/search.js, #525): kept in its place entry and told by lore.
export function found(a,name,text,dmId){if(!learner(a)||!name)return;const e=place(a,name,'seen');if(dmId!=null&&e.dm==null)e.dm=dmId;e.found=clean(text,LORE.SNIP*2)}
export function knowsPlace(a,name){if(!learner(a))return true;return !!loreOf(a).p[name]}
export function learnPlace(a,name,how='told'){if(!learner(a)||!name)return;const was=!!loreOf(a).p[name];place(a,name,how);return !was}
// A hero who starts seasoned (#930) has been on the road: the regions its level has worked, the landmarks standing in them (the
// Crypt and the wyrm's lair among them) and the creatures there are known as heard of, so a veteran solo can answer for its own
// level (go_crypt, hunt prey by name). Told, not seen: nothing is marked seen or fought. Agent heroes only; no RNG; idempotent.
export function careerLore(a){if(!learner(a)||!(a.lvl>1))return 0;let n=0;const ok=z=>{const b=REGIONS[z]&&REGIONS[z].band;return !!b&&b[0]<=a.lvl};
  for(let z=0;z<ZONES.length;z++)if(ok(z)&&learnPlace(a,ZONES[z],'told'))n++;
  for(const l of [...LANDMARKS,...(cryptIf(()=>true)&&!LANDMARKS.includes(cryptIf(()=>true))?[cryptIf(()=>true)]:[])])if(l&&l.name&&ok(zoneAt(l.x,l.y))&&learnPlace(a,l.name,'told'))n++;
  for(const k of Object.keys(MOBS)){const z=MOBS[k].z;if(!ZONES[z]||!ok(z))continue;const e=entry(a,k);if(!e.name){e.name=1;n++}if(!e.z.includes(ZONES[z]))e.z.push(ZONES[z])}
  return n}

// ---- DM-marked places (S.places: mark_place, create_site, a staged mystery; #423) ----
// Learned by the same rules as landmarks: seen within sight, heard named, told by a job. The entry keeps only the
// public name and the marker's id (never its lever, the DM's reason or notes); move_to finds it by name while the
// marker stands, and the name fades from the hero's lore when the marker is gone.
const dmPlaces=()=>S.places||[];
const bare=n=>String(n||'').replace(/^the\s+/i,'');
const reEsc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const RE_CACHE=new Map();
const placeRe=n=>{let r=RE_CACHE.get(n);if(!r){r=new RegExp('\\b'+reEsc(bare(n))+'\\b','i');if(RE_CACHE.size>200)RE_CACHE.clear();RE_CACHE.set(n,r)}return r};
// A marker named like a region, landmark or town is left to those (its entry must not fade with the marker).
const clash=n=>ZONES.includes(n)||placeNames().includes(n)||CITY.some(c=>c.name===n);
const markOk=p=>!!(p&&p.name&&p.id!=null&&bare(p.name).length>=3&&!clash(p.name));
function learnMark(a,p,how){const was=!!loreOf(a).p[p.name];const e=place(a,p.name,how);e.dm=p.id;return !was}
// The DM place this hero knows by name (any case, "the" optional), while its marker stands; or null.
export function knownMark(a,t){if(!a||!a.lore)return null;const s=bare(String(t||'').toLowerCase().trim());if(!s)return null;
  for(const n of Object.keys(a.lore.p)){const e=a.lore.p[n];if(e.dm==null||bare(n.toLowerCase())!==s)continue;const p=dmPlaces().find(x=>x.id===e.dm);if(p)return p}
  return null}
// A job the hero reads or holds tells it of its region and of the place it names (post_hook's target, or a landmark).
export function learnJob(a,h){if(!learner(a)||!h)return 0;let n=0;if(h.zone!=null&&ZONES[h.zone]&&learnPlace(a,ZONES[h.zone],'told'))n++;
  const d=h.data,nm=d&&d.place;if(!nm)return n;
  const p=dmPlaces().find(x=>x.name===nm&&(d.x==null||(x.x===d.x&&x.y===d.y)))||dmPlaces().find(x=>x.name===nm);
  if(markOk(p)){if(learnMark(a,p,'told'))n++;return n}
  const lm=LANDMARKS.find(l=>l.name===nm)||cryptIf(n=>n===nm);if(lm&&learnPlace(a,lm.name,'told'))n++;return n}
// The sign at a dungeon stair (#448): read on first sight; to a hero below the region's band it marks the place dangerous.
const green=a=>{const b=cryptBand();return !!b&&a.lvl<b[0]};
function readSign(a,l){if(!l.sign||!learner(a))return;ev(a,l.sign);const p=loreOf(a).p[l.name];if(p&&!p.warned&&green(a))p.warned=clean('a sign at the stair: "Those who went below were tried blades; you are not."',LORE.SNIP)}
// The gate captain's word to a green blade about the Crypt (sim/player.js talk), or null.
export function captainWarning(a){if(!learner(a)||!hasCrypt()||!green(a))return null;const l=LANDMARKS.find(x=>x.kind==='crypt');return l&&l.captain||null}
// Every step for an agent hero (watch() in sim/player.js): the region it stands in, landmarks in sight, its quest.
export function visit(a){if(!learner(a))return;const z=zoneAt(a.x,a.y);if(a.loreZ!==z){a.loreZ=z;if(ZONES[z]&&learnPlace(a,ZONES[z],'been'))ev(a,'You come into '+ZONES[z]+' for the first time.');else if(ZONES[z])place(a,ZONES[z],'been')}
  const R=12*sightFor(a,z);for(const l of LANDMARKS)if(dist(a,l)<=R+(l.r||1)&&learnPlace(a,l.name,'seen')){ev(a,'You see '+l.name+' with your own eyes.');readSign(a,l)}
  // DM places (#423): one in sight is seen; a known one whose marker is gone fades
  for(const e of EXITS)if(dist(a,e)<=R+e.r&&learnPlace(a,e.name,'seen'))ev(a,'You see '+e.name+' going out of this land.'); // a road off the map (#1013)
  const P=dmPlaces(),L=loreOf(a);for(const p of P)if(markOk(p)&&dist(a,p)<=R){const e=L.p[p.name];if(!e||e.dm!==p.id||e.how==='told'){if(learnMark(a,p,'seen'))ev(a,'You see '+p.name+' with your own eyes.')}}
  for(const n of Object.keys(L.p)){const e=L.p[n];if(e.dm!=null&&spotHere(e)&&!P.some(x=>x.id===e.dm))delete L.p[n]} // one on a land left behind stands there still
  // jobs it holds or was offered by name that point at a place (once per change of that set)
  const js=(S.adventures||[]).filter(h=>h.data&&h.data.place&&h.phase!=='done'&&(h.for===a.id||h.taker===a.id||a.adv===h.id||h.held===a.id||h.mem&&h.mem.includes(a.id)));
  const sig=js.map(h=>h.id).join(',');if(a.loreJ!==sig){a.loreJ=sig;for(const h of js)learnJob(a,h)}
  const q=a.quest;if(q&&a.loreQ!==q.type){a.loreQ=q.type;const M=MOBS[q.type];if(M){const e=entry(a,q.type);e.told=1;if(ZONES[M.z]){learnPlace(a,ZONES[M.z],'told');if(!e.z.includes(ZONES[M.z]))e.z.push(ZONES[M.z])}}}}

// ---- learning from words heard (chat, the criers, a job, a townsperson) ----
const WARN=/\b(beware|avoid|deadly|dangerous|danger|no place for|stay away|nearly|careful|too strong|too much for|buried|feared?|fear)\b/i;
const DIED=n=>new RegExp('\\b(slain|killed|torn|felled|fell|died|dead|lost)\\b[^.!?]{0,30}\\b(by|to|in|at)\\s+(an?\\s+|the\\s+)?'+n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','i');
// Scan one line the hero heard or read. who: who said it (for the warning kept). Returns how many things it learned.
export function hear(a,text,who){if(!learner(a))return 0;const t=String(text||'');if(t.length<4)return 0;const X=lexicon(),warn=WARN.test(t);let n=0;const done=new Set();
  const snip=clean((who?who+': ':'')+'"'+t+'"',LORE.SNIP);
  for(const x of X.c){if(done.has(x.key)||!x.re.test(t))continue;done.add(x.key);const e=entry(a,x.key);if(!e.told&&!knowsName(e))n++;e.told=1;
    if((warn||DIED(x.n).test(t))&&!e.warned){e.warned=snip;n++}
    if(!x.key.startsWith('n:')&&MOBS[x.key]&&ZONES[MOBS[x.key].z]&&X.p.some(p=>p.n===ZONES[MOBS[x.key].z]&&p.re.test(t))&&!e.z.includes(ZONES[MOBS[x.key].z]))e.z.push(ZONES[MOBS[x.key].z])}
  for(const p of X.p){if(!p.re.test(t))continue;if(learnPlace(a,p.n,'told'))n++;const q=loreOf(a).p[p.n];if((warn||DIED(p.n).test(t))&&!q.warned&&q.how!=='home'){q.warned=snip;n++}}
  // a DM place named (#423): its public name only
  for(const p of dmPlaces()){if(!markOk(p)||!placeRe(p.name).test(t))continue;if(learnMark(a,p,'told'))n++;const q=loreOf(a).p[p.name];if((warn||DIED(bare(p.name)).test(t))&&!q.warned){q.warned=snip;n++}}
  return n}

// ---- what the hero can say about it (the lore tool, status.places, move_to) ----
function creatureLine(a,key,e){const name=knowsName(e)?keyName(key):'unnamed: '+(e.desc||'a creature you glimpsed'),out={name};
  if(e.hi!=null&&(e.fought||e.read))out.threat=(e.fought?'':'looks ')+RANKS[rankOf(e.hi+(key.startsWith('n:')?LORE.ELITE_RANK:0)-a.lvl)];
  else if(e.warned)out.threat='you were warned of it';else out.threat=e.seen?'hard to judge':'only heard of';
  const k=[];if(e.fought)k.push('fought '+(e.fought===1?'once':e.fought+' times')+(e.killed?', killed '+(e.killed===1?'one':e.killed):''));else if(e.killed)k.push('killed '+(e.killed===1?'one':e.killed));
  if(e.hurt)k.push('it nearly killed you'+(e.hurt>1?' '+e.hurt+' times':''));if(e.fear)k.push('it left a wound on you: you fear it until you have killed one');if(e.fell)k.push('you know of '+(e.fell===1?'one':e.fell)+' who fell to it');
  if(e.tricks.length)k.push('tricks: '+e.tricks.map(trickName).join('; '));if(e.z.length)k.push('found in '+e.z.join(', '));
  if(e.warned)k.push('warned: '+e.warned);if(e.from&&!e.fought&&!e.killed)k.push('heard of it from '+e.from);if(k.length)out.known=k;return out}
// The worst creature the hero knows in a region, rated at a typical level (the last it met), not the highest ever seen (#539).
function worstIn(a,name){let worst=null;for(const key of Object.keys(loreOf(a).c)){const e=loreOf(a).c[key];if(!e.z.includes(name)||e.hi==null||!(e.fought||e.read))continue;const r=rankOf((e.last!=null?e.last:e.hi)-a.lvl);if(!worst||r>worst.r)worst={r,n:keyPlural(key)}}return worst}
// A few words of why a place is dangerous, or null.
function dangerWhy(a,name,p){if(!p)return null;const w=[];if(p.hurt)w.push('you nearly died there');if(p.fell)w.push((p.fell===1?'one':p.fell)+' fell there');
  const x=ZONES.includes(name)?worstIn(a,name):null;if(x&&x.r>=3)w.push(x.n+', '+RANKS[x.r]);if(p.warned&&!w.length)w.push('warned');return w.length?w.slice(0,2).join('; '):null}
function placeLine(a,name,p){const out={place:name,how:p.mk===1?'a place you marked':p.mk?'told by '+(p.src||'a companion'):p.how==='home'?'your home region':p.how==='been'?'you have been there':p.how==='seen'?'you have seen it':'you have heard of it'+(p.from?' from '+p.from:'')};
  const z=ZONES.indexOf(name),k=[];if(p.hurt)k.push('you nearly died there'+(p.hurt>1?' '+p.hurt+' times':''));if(p.fell)k.push('you know of '+(p.fell===1?'one':p.fell)+' who fell there');
  if(z>=0){const worst=worstIn(a,name);if(worst)k.push('the worst you know there: '+worst.n+' ('+RANKS[worst.r]+')')}
  if(p.note&&p.mk===1)k.push('your note: '+p.note);if(p.warned)k.push('warned: '+p.warned);if(p.found)k.push('you searched it and found: '+p.found);if(k.length)out.notes=k;return out}
export function loreView(a,about){const L=loreOf(a),q=clean(about,60).toLowerCase();
  // descriptions for unnamed entries: from a living one the hero can see, else a generic word
  for(const key of Object.keys(L.c)){const e=L.c[key];if(!knowsName(e)&&!e.desc){const m=S.mobs.find(x=>keyOf(x)===key);if(m)e.desc=describe(m)}}
  let cs=Object.keys(L.c).map(k=>creatureLine(a,k,L.c[k])),ps=Object.keys(L.p).map(n=>placeLine(a,n,L.p[n]));
  if(q){cs=cs.filter(x=>x.name.toLowerCase().includes(q)||(x.known||[]).some(s=>s.toLowerCase().includes(q)));ps=ps.filter(x=>x.place.toLowerCase().includes(q)||(x.notes||[]).some(s=>s.toLowerCase().includes(q)))}
  const hp=Object.keys(L.h||{}).map(n=>({person:n,how:'you have heard of them from '+L.h[n].from})).filter(x=>!q||x.person.toLowerCase().includes(q));
  return {creatures:cs,places:ps,towns:CITY.filter(c=>ownTown(c,a)).map(c=>c.name),...(hp.length?{people:hp}:{})}}
// status.places: where this hero can walk by name.
export function placesView(a){const L=loreOf(a);return Object.keys(L.p).map(n=>{const p=L.p[n],w=[];if(p.how==='home')w.push('home');else if(p.mk===1)w.push('yours');else if(p.mk)w.push('told by '+(p.src||'a companion'));else if(p.how==='told')w.push('heard of'+(p.from?' from '+p.from:''));{const y=dangerWhy(a,n,p);if(y)w.push('danger: '+y);else if(p.hurt||p.fell||p.warned)w.push('danger')}return w.length?n+' ('+w.join(', ')+')':n})}
// The hero's warning words for a known region (move_to/lead_to), or null.
export function placeWarn(a,name){const p=a.lore&&a.lore.p[name];if(!p)return null;const l=placeLine(a,name,p);return l.notes&&l.notes.length?name+': '+l.notes.join('; ')+'.':null}
// The same, as the hero's memory (move_to/lead_to reply, #539).
export function placeMemory(a,name){const w=placeWarn(a,name);return w?'You remember '+w:null}
// brief.roads (#539): what the hero knows of where it is, where it is going and the places it knows to fear; short, null when empty.
export function roadsLine(a){if(!learner(a)||!a.lore)return null;const P=a.lore.p,here=ZONES[zoneAt(a.x,a.y)],c=(a.pq||[])[0],out=[],seen=new Set();
  const add=(n,pre)=>{if(!n||seen.has(n)||!P[n]||out.length>=3)return;seen.add(n);const y=dangerWhy(a,n,P[n]);if(y)out.push((pre?pre+' ':'')+n+': '+y)};
  add(here,'Here,');const aim=c&&(c.kind==='move'?ZONES.find(z=>c.label&&c.label.includes(z)):c.ground!=null?ZONES[c.ground]:null);add(aim,'Bound for');
  for(const n of Object.keys(P).filter(n=>ZONES.includes(n)).sort((x,y)=>(P[y].fell||0)+(P[y].hurt||0)-(P[x].fell||0)-(P[x].hurt||0)))add(n);
  return out.length?out.join('. ').slice(0,260)+'.':null}
// A creature named by the agent (hunt prey): the key of a creature it knows by name, or null.
export function preyKey(a,name){const s=clean(name,60).toLowerCase().replace(/^(an?|the)\s+/,'');if(!s)return null;const L=loreOf(a);
  for(const key of Object.keys(L.c)){const e=L.c[key];if(!knowsName(e))continue;const n=keyName(key).toLowerCase(),p=keyPlural(key).toLowerCase();if(s===n||s===p||s===n.replace(/^the /,''))return key}
  return null}
// hunt: the nearest creature around that fits the order (a known kind, or anything this hero does not fear). Whatever is around means
// around on the ground the hero hunts (#934): a creature of that ground, standing on it, with nothing between them. From Thornvale's
// bank the snowfield is in plain sight, and a hero who took "the nearest thing" walked round by the bridge to a Tarn Wight. With no ground ordered it is the region the hero stands in (#822, #1023). Named prey
// is the agent's choice and may stand anywhere it can be reached in a line; a creature already on the hero is always taken.
const onGround=(m,gz)=>gz==null||zoneAt(m.x,m.y)===gz&&(!MOBS[m.type]||MOBS[m.type].z===gz);
export function pickPrey(a,cmd){const R=9*sightFor(a,zoneAt(a.x,a.y)),gz=cmd&&cmd.ground!=null?cmd.ground:zoneAt(a.x,a.y);let best=null,bs=1e9;
  for(const m of nearMobs(a.x,a.y,R)){if(!m.alive||m.gone||m.hidden||(m.target&&m.target!==a)||held(m))continue; // held in a scene (#518)
    const d=dist(a,m);if(d>R)continue;
    if(m.target!==a){if(!clearLine(a,m))continue;
      if(cmd&&cmd.prey){if(keyOf(m)!==cmd.prey)continue}else if(!onGround(m,gz)||feared(a,m))continue}
    else if(cmd&&cmd.prey&&keyOf(m)!==cmd.prey)continue;
    const s=d-(a.quest&&a.quest.type===m.type?4:0)-(m.target===a?6:0);if(s<bs){bs=s;best=m}}
  if(best)sight(a,best);return best}

// ---- what people say (a townsperson's advice, the gate's rumour of a job) ----
// The next region up from this hero's level, if it is beyond them: a townsperson's warning (sim/talk.js, sim/player.js).
export function npcWarning(a){if(!learner(a))return null;let z=-1;
  for(let i=0;i<ZONES.length;i++){const b=REGIONS[i]&&REGIONS[i].band;if(!b||b[0]<=a.lvl+1)continue;if(z<0||b[0]<REGIONS[z].band[0])z=i}
  if(z<0)return null;const p=a.lore&&a.lore.p[ZONES[z]];if(p&&p.warned)return null;
  const ks=Object.keys(MOBS).filter(k=>MOBS[k].z===z);const k=ks.length?ks[Math.abs(a.id)%ks.length]:null;
  return ZONES[z]+' is no place for green blades'+(k?': the '+MOBS[k].pl+' there have buried better than you':'')+'. Grow before you go.'}
// The rumour at the gate about a job's region, in words.
export function jobRumour(a,z){const b=REGIONS[z]&&REGIONS[z].band;if(!b)return 'nobody says much about it';
  if(b[0]>a.lvl+3)return 'the captain shakes his head: no work for green blades';if(b[0]>a.lvl+1)return 'they say it will test you';
  if(b[1]<a.lvl-3)return 'they call it easy coin';return 'they call it honest work'}

// A short, read-only digest of what an agent hero has learned in play, for the DM's views (#558): the creatures it has beaten
// or fears, and the places it knows by name, each capped. Reads a.lore as it stands (never creates it, never writes), no RNG.
export function loreSummary(a,cap=12){const L=a&&a.lore;if(!L)return {beaten:[],feared:[],places:[]};
  const beaten=[],feared=[];
  for(const key of Object.keys(L.c||{})){const e=L.c[key];if(!knowsName(e))continue;
    if(e.hurt||e.fell)feared.push(keyName(key));else if(e.killed)beaten.push(keyName(key))}
  const places=Object.keys(L.p||{});
  const cut=l=>l.slice(0,cap);
  return {beaten:cut(beaten),feared:cut(feared),places:cut(places),more:Math.max(0,beaten.length+feared.length+places.length-cut(beaten).length-cut(feared).length-cut(places).length)}}

// ---- word heard from a townsperson (a rumour, sim/rumours.js #637) ----
// about: {kind:'place'|'landmark'|'town'|'region'|'foe'|'creature'|'person', name, id?, key?, z?}; from: who said it, as the hero
// heard them ("Innkeeper Bree"). Puts it on the hero's lore as heard of, with the speaker as its source, so move_to takes a place.
// Never says who seeded it. Returns true when the hero learned something new. Agent heroes only, no RNG.
export function heardOf(a,about,from){if(!learner(a)||!about||!about.name)return false;const src=clean(from,60)||'someone in town';
  const k=about.kind;
  if(k==='place'){const p=dmPlaces().find(x=>x.id===about.id);if(!markOk(p))return false;const was=!!loreOf(a).p[p.name];learnMark(a,p,'told');const e=loreOf(a).p[p.name];if(e.how==='told'&&!e.from)e.from=src;return !was}
  if(k==='landmark'||k==='town'||k==='region'||k==='far'){const was=!!loreOf(a).p[about.name];const e=place(a,about.name,'told');if(e.how==='told'&&!e.from)e.from=src;return !was}
  if(k==='foe'||k==='creature'){const key=k==='foe'?'n:'+about.name:about.key;if(!key)return false;const e=entry(a,key),was=!!e.told||knowsName(e);e.told=1;if(!e.from)e.from=src;
    const zn=about.z!=null?ZONES[about.z]:null;if(zn){if(!e.z.includes(zn))e.z.push(zn);place(a,zn,'told')}return !was}
  if(k==='person'){const L=loreOf(a),H=L.h||(L.h={}),was=!!H[about.name];if(!was)H[about.name]={from:src,at:Math.round(S.gameMin)};return !was}
  return false}
