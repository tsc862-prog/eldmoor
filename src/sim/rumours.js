// Rumours the DM seeds (issue #637): what townsfolk say while the DM sleeps. The DM agent's seed_rumour tool pulls the
// lever below (same caps, Fellowship reserve and DM log as every lever); for 1-5 game days the innkeeper, the gate captain
// and the bard of the town (or of the towns bordering a region; `who` narrows it to one role) pass the word on in their own
// words: when a hero talks to them (sim/talk.js for a company member, sim/player.js talk for anyone else) and at the gate's
// board (list_jobs). With the DM agent's voice listening, the conversation call carries the word so it can weave it in; the
// game adds it after the answer unless the answer already said it. `about` (a place, region, creature or person) goes on the
// hero's lore as heard of, with the speaker as its source (sim/lore.js heardOf), so move_to accepts the place.
//
// Rules: RUMOUR.MAX live rumours, RUMOUR.PER_TOWN per town; a hero hears each rumour once a game day; a rumour lapses when its
// days run out, its foe dies, its place fades or its person is gone. Heroes never learn who seeded it: the words are the
// townsperson's, the DM log keeps the seeding (the lever entry) and each telling as a count, never the words again.
//
// State (plain JSON on S, saved with the world; created by the first seeding only, so a world without one is unchanged):
//   S.rumours {seq, list:[{id, text, about:{kind,name,id?,key?,z?}|null, towns:[name], who:role|null, born, until, heard:{heroId:day}, told, lever}],
//              stats:{seeded, told, lapsed}}
// DOM-free, no RNG (the wording is picked by a hash of ids). Owned by brain-builder.
import {S,dayNo} from './state.js';
import {ZONES,ZPTS,CITY,LANDMARKS,CRYPT,zoneAt,dist} from '../world/map.js';
import {MOBS} from '../data/mobs.js';
import {RUMOUR_LINES} from '../data/renown-lines.js';
import {register,LEVERS} from './levers.js';
import {dmlog} from './dmlog.js';
import {notEnglish} from './lang.js';
import {heardOf,hear} from './lore.js';
import {remember} from './memory.js';
import {ensureNpcs} from './npcs.js';

export const RUMOUR={
  MAX:6,        // live rumours in the world
  PER_TOWN:3,   // live rumours one town's folk carry
  LEN:160,      // characters of a rumour
  DAYS:2,       // game days a rumour lives when days is not given (1-5)
  PER_DAY:4,    // seedings a game day (a share kept for the companies, levers.js reserveOf)
  NEAR:25,      // tiles from a region's spawn points to a town gate that borders it
};
export const TELLERS=['innkeeper','captain','bard'];
const DAY=1440;
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const full=p=>(p.title?p.title+' ':'')+p.name;
const people=()=>{ensureNpcs();return [...(S.npcs||[]),...(S.wanderers||[])]};
const hashN=s=>{let h=0;s=String(s);for(let i=0;i<s.length;i++)h=(Math.imul(h,31)+s.charCodeAt(i))|0;return Math.abs(h)};

export const rumourState=()=>S.rumours||(S.rumours={seq:0,list:[],stats:{seeded:0,told:0,lapsed:0}});

// ---- what a rumour is about ----
// text -> {kind, name, id?, key?, z?} or {err}. Places first (a DM marker, a landmark, a town, a region), then a living named foe,
// a kind of creature, a person.
export function aboutOf(text){const s=clean(text,60),lo=s.toLowerCase(),bare=lo.replace(/^the\s+/,'');if(!s)return null;
  const eq=n=>{const x=String(n||'').toLowerCase();return x===lo||x.replace(/^the\s+/,'')===bare};
  const pl=(S.places||[]).find(p=>eq(p.name)||String(p.id)===s);if(pl)return {kind:'place',name:pl.name,id:pl.id,z:pl.z};
  const lm=LANDMARKS.find(l=>eq(l.name))||(CRYPT&&eq(CRYPT.name)?CRYPT:null);if(lm)return {kind:'landmark',name:lm.name,z:zoneAt(lm.x,lm.y)};
  const c=CITY.find(x=>eq(x.name));if(c)return {kind:'town',name:c.name};
  const z=ZONES.findIndex(n=>eq(n));if(z>=0)return {kind:'region',name:ZONES[z],z};
  const m=(S.mobs||[]).find(x=>x.alive&&!x.gone&&(x.elite||x.named)&&x.name&&(eq(x.name)||eq(x.name+' '+(x.title||''))));
  if(m)return {kind:'foe',name:m.name,id:m.id,z:zoneAt(m.x,m.y)};
  const k=Object.keys(MOBS).find(x=>eq(MOBS[x].name)||eq(MOBS[x].pl));if(k)return {kind:'creature',name:MOBS[k].name,key:k,z:MOBS[k].z};
  const q=people().find(p=>eq(p.name)||eq(full(p))||String(p.id)===s);if(q)return {kind:'person',name:full(q),id:q.id};
  return {err:'about: no place, region, creature or person called "'+s+'" (a marked place, a landmark, a town, a region, a named foe alive now, a kind of creature, or a person from npcs)'}}

// The towns that carry a rumour: the town, or the towns whose gate lies in the region, else those whose gate is within
// RUMOUR.NEAR tiles of it, else the nearest one.
export function townsFor(town,region){if(town)return [town];if(region==null)return [];
  const inZ=CITY.filter(c=>zoneAt(c.gate.x,c.gate.y)===region);if(inZ.length)return inZ.map(c=>c.name);
  const P=ZPTS[region]||[],d=c=>P.reduce((b,q)=>Math.min(b,dist(q,c.gate)),1e9);
  const near=CITY.filter(c=>d(c)<=RUMOUR.NEAR);if(near.length)return near.map(c=>c.name);
  const best=CITY.slice().sort((x,y)=>d(x)-d(y))[0];return best?[best.name]:[]}
const tellersIn=(town,who)=>people().filter(p=>p.town===town&&TELLERS.includes(p.role)&&(!who||p.role===who));

// ---- lapse ----
function lapsedWhy(r){if(S.gameMin>=r.until)return 'its days ran out';const A=r.about;if(!A)return null;
  if(A.kind==='foe'&&!(S.mobs||[]).some(m=>m.id===A.id&&m.alive&&!m.gone))return A.name+' is dead';
  if(A.kind==='place'&&!(S.places||[]).some(p=>p.id===A.id))return A.name+' has faded';
  if(A.kind==='person'&&!people().some(p=>p.id===A.id))return A.name+' is gone';
  return null}
// The live rumours; lapsed ones leave (a DM log line each). Reads nothing and writes nothing when no rumour was ever seeded.
export function liveRumours(){const R=S.rumours;if(!R||!R.list.length)return [];
  for(const r of R.list.slice()){const why=lapsedWhy(r);if(!why)continue;R.list.splice(R.list.indexOf(r),1);R.stats.lapsed++;
    dmlog('talk',null,['Rumour #'+r.id+' lapses: '+why+' (told '+r.told+' time'+(r.told===1?'':'s')+').'],{rumour:r.id,lapsed:why,told:r.told,by:'scripted'},{heroes:[]})}
  return R.list}

// ---- the lever (seed_rumour) ----
// Registered by installRumourLever (sim/index.js, after every module has loaded: the sim's imports are one big cycle).
const SEED_RUMOUR={name:'seed_rumour',about:'Give the townsfolk word to pass on for 1-5 game days: the innkeeper, the gate captain and the bard of a town (or of the towns bordering a region; who narrows it to one role) tell it in their own words to heroes who talk to them or read the gate board. about: a place, region, creature or person it concerns (the hero learns of it). '+RUMOUR.MAX+' live at most, '+RUMOUR.PER_TOWN+' a town.',
  params:{town:{type:'town',opt:true},region:{type:'region',opt:true},text:{type:'str',max:400},about:{type:'str',max:60,opt:true},days:{type:'int',min:1,max:5,def:RUMOUR.DAYS},who:{type:'enum',values:TELLERS,opt:true}},
  limits:{perDay:RUMOUR.PER_DAY},cooldown:0,
  check(p){if((p.town==null)===(p.region==null))return 'give town or region (one of them)';
    const t=clean(p.text,1000);if(t.length<8)return 'text is too short: write the word as a townsperson would pass it on';
    if(t.length>RUMOUR.LEN)return 'text is '+t.length+' characters; '+RUMOUR.LEN+' at most';
    if(notEnglish(t))return 'text must be in English';
    if(p.about!=null){const A=aboutOf(p.about);if(A&&A.err)return A.err}
    const towns=townsFor(p.town,p.region);if(!towns.length)return 'no town carries word for '+ZONES[p.region];
    const L=liveRumours();if(L.length>=RUMOUR.MAX)return 'limit: '+RUMOUR.MAX+' rumours already live; let one lapse first (hooks lists them)';
    const full1=towns.find(n=>L.filter(r=>r.towns.includes(n)).length>=RUMOUR.PER_TOWN);if(full1)return 'limit: '+full1+' already carries '+RUMOUR.PER_TOWN+' rumours';
    if(!towns.some(n=>tellersIn(n,p.who).length))return 'nobody in '+towns.join(', ')+' tells rumours'+(p.who?' as '+p.who:'');
    return null},
  apply(p,ctx){const R=rumourState(),A=p.about!=null?aboutOf(p.about):null,towns=townsFor(p.town,p.region);
    const r={id:++R.seq,text:clean(p.text,RUMOUR.LEN),about:A,towns,who:p.who||null,born:Math.round(S.gameMin),until:Math.round(S.gameMin+p.days*DAY),heard:{},told:0,lever:ctx.id};
    R.list.push(r);R.stats.seeded++;
    const tellers=towns.flatMap(n=>tellersIn(n,r.who).map(full));
    return {ok:true,effect:{rumour:r.id,towns,tellers:tellers.slice(0,9),about:A?A.name:null,days:p.days},ret:r}},
  describe:p=>'a rumour '+(p.town?'in '+p.town:'around '+ZONES[p.region])+(p.about?' about '+p.about:'')+(p.who?' (the '+p.who+')':'')};
export function installRumourLever(){if(!LEVERS.seed_rumour)register(SEED_RUMOUR)}

// ---- telling ----
// The rumours person p would pass on to hero a now: p is a teller of a town that carries it, and a has not heard it today.
export function rumoursFor(p,a){if(!p||!a||!S.rumours||!TELLERS.includes(p.role)||!p.town||p.hostile)return [];const d=dayNo();
  return liveRumours().filter(r=>r.towns.includes(p.town)&&(!r.who||r.who===p.role)&&r.heard[a.id]!==d)}
// The words in the teller's own voice.
export function wordOf(r,p,a){const L=RUMOUR_LINES[p.role]||RUMOUR_LINES.innkeeper;return L[hashN(r.id+':'+a.id)%L.length].replace('{text}',r.text)}
// Hero a hears rumour r from p: marked heard today, the lore hook, a memory for an agent hero, a counted DM log line (no words).
// Returns the line in the teller's words.
export function tell(r,p,a,how='talk'){const R=rumourState(),line=wordOf(r,p,a);r.heard[a.id]=dayNo();r.told++;R.stats.told++;
  const who=full(p);if(r.about)heardOf(a,r.about,who);hear(a,r.text,who);
  if(a.player)remember(a,'talk',who+' told me: '+r.text);
  dmlog('talk',null,['Rumour #'+r.id+' told to '+a.name+' by '+who+' ('+how+'; told '+r.told+' time'+(r.told===1?'':'s')+').'],{rumour:r.id,told:r.told,hero:a.id,npc:p.id,how,by:'scripted'},{heroes:[]});
  return line}
// Does a line someone said already carry rumour r (the DM's voice wove it in)? Its about named, or most of its words.
const words=s=>new Set(String(s||'').toLowerCase().replace(/[^a-z0-9 ]+/g,' ').split(' ').filter(x=>x.length>3));
export function carries(line,r){const t=String(line||'').toLowerCase();if(r.about&&r.about.name&&t.includes(r.about.name.toLowerCase().replace(/^the\s+/,'')))return true;
  const A=words(r.text),B=words(line);if(!A.size)return false;let n=0;for(const w of A)if(B.has(w))n++;return n/A.size>=.6}
// talk to a townsperson (not a company member's conversation): the lines p passes on to a now.
export function passOnTo(p,a){return rumoursFor(p,a).map(r=>tell(r,p,a))}
// list_jobs at a town gate: the captain's word, told once a day each. Returns the lines (empty without rumours).
export function gateWord(a,town){if(!S.rumours)return [];const cap=people().find(p=>p.town===town&&p.role==='captain');if(!cap)return [];
  return rumoursFor(cap,a).map(r=>full(cap)+': "'+tell(r,cap,a,'board')+'"')}
// For the DM: the live rumours (hooks), never the hero-side view.
export function rumoursView(){return liveRumours().map(r=>({id:r.id,text:r.text,about:r.about?r.about.name+' ('+r.about.kind+')':null,towns:r.towns,who:r.who||'innkeeper, captain and bard',
  hours_left:Math.max(0,Math.round((r.until-S.gameMin)/60)),told:r.told}))}
