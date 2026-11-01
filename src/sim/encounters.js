// Road encounters: small dice-driven events that appear on road tiles away from the
// city gates and are resolved by heroes travelling out or walking home. Five kinds:
// a travelling merchant (cheap gear), a wayside lanternstone shrine (blessing), a
// trap-sprung strongbox (gold or a wound), a lost pilgrim (escort to the gate for honor)
// and a Rookscar ambush (XP and coin, or a wound and a flight). Every resolution logs
// one Chronicle line with the roll shown. Owned by world-builder (table, spawning,
// resolution, dice); heroes.js only calls checkEncounter() from travel and return.
// Bandits are not real mobs: an ambush is a single roll, so it wounds but never kills.
// DOM-free; render/encounters.js draws S.encounters.
import {rnd,ri,pickA} from '../core/rng.js';
import {W,H,ROAD} from '../world/tiles.js';
import {tiles,zone,I,ZONES,CITY,LAIR,zoneFor,zoneAt,dist} from '../world/map.js';
import {S} from './state.js';
import {log,gold} from './chronicle.js';
import {pop} from './effects.js';
import {maxHp,gainXp,moveTo,goHome} from './heroes.js';
import {partyMates} from './party.js';
import {isStorm} from './weather.js';
import {record} from './history.js';

// ---- knobs ----
const MAX_ALIVE=3;            // encounters on the roads at once
const SPAWN_MIN=60,SPAWN_MAX=120; // game minutes between new encounters
const LIFE=1440;              // game minutes an ignored encounter lasts (one game day)
const GATE_CLEAR=12;          // tiles from any city gate a road tile must be
const NOTICE=4;               // tiles at which a traveller notices an encounter
const MIN_HP=.4;              // no detours below this share of max HP
const ESCORT_MAX=180;         // game minutes before a pilgrim gives up on an escort
const dm=t=>({t,c:'dm'});

// The table. Weights pick the kind; label is the follow-view nameplate.
export const ENC={
  merchant:{label:'Merchant',w:2},
  shrine:  {label:'Shrine',  w:2},
  chest:   {label:'Chest',   w:3},
  pilgrim: {label:'Pilgrim', w:2},
  ambush:  {label:'Ambush',  w:3},
};
const KINDS=Object.keys(ENC);
const pickKind=()=>{let tot=0;for(const k of KINDS)tot+=ENC[k].w;let r=rnd()*tot;for(const k of KINDS){r-=ENC[k].w;if(r<=0)return k}return KINDS[KINDS.length-1]};

// Road tiles far enough from every gate (and clear of the lair ring) where encounters may appear.
const SPOTS=[];
for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){if(tiles[I(x,y)]!==ROAD)continue;
  const p={x:x+.5,y:y+.5};if(CITY.some(c=>dist(p,c.gate)<GATE_CLEAR)||dist(p,LAIR)<7)continue;SPOTS.push(p)}
// Zone level for XP and loot: the lowest level the ladder sends to that zone, plus two.
const ZLVL=ZONES.map((_,z)=>{for(let l=1;l<=40;l++)if(zoneFor(l)===z)return l+2;return 1});

const d20=()=>ri(1,20);
export const encStats=()=>S.encStats;
const alive=()=>S.encounters;
const bump=(tab,k)=>{tab[k]=(tab[k]||0)+1};

function ensure(){if(S.encounters)return;S.encounters=[];S.encNext=S.gameMin+SPAWN_MIN+rnd()*(SPAWN_MAX-SPAWN_MIN);
  S.encStats={spawned:{},resolved:{},success:{},escorts:{},expired:0,abandoned:0}}

function spawn(){if(!SPOTS.length)return;let p=null;
  for(let i=0;i<20&&!p;i++){const q=pickA(SPOTS);if(!alive().some(e=>dist(e,q)<6))p=q}
  if(!p)return;const kind=pickKind();
  const e={id:++S.uid,kind:'enc',type:kind,x:p.x,y:p.y,home:{...p},z:zone[I(Math.floor(p.x),Math.floor(p.y))],born:S.gameMin,until:S.gameMin+LIFE,
    used:{},face:1,moving:false,escort:null,escortT:0,n:kind==='ambush'?ri(2,3):0};
  alive().push(e);bump(S.encStats.spawned,kind);return e}

function remove(e){const L=alive(),i=L.indexOf(e);if(i>=0)L.splice(i,1);if(e.escort){e.escort.pilgrim=null;e.escort=null}}
const road=e=>'the '+ZONES[e.z]+' road';

// Can this hero make use of this encounter right now? (Also keeps a hero from re-using a merchant or shrine.)
function wants(a,e){if(e.used[a.id])return false;
  switch(e.type){
  case 'merchant':return a.gold>=4*a.lvl&&a.gear<a.lvl+2; // same gear ceiling as the city shop
  case 'shrine':return !a.blessed;
  case 'pilgrim':return a.state==='return'&&!e.escort&&!a.pilgrim;
  default:return true}}

// ---- resolution: one roll, one line ----
function resolve(a,e){const mh=maxHp(a),st=S.encStats;bump(e.type==='pilgrim'?st.escorts:st.resolved,e.type); // a pilgrim counts as resolved on arrival
  switch(e.type){
  case 'merchant':{const r=d20(),cheap=r>=11,cost=(cheap?3:4)*a.lvl;a.gold-=cost;a.gear++;a.hp=Math.min(maxHp(a),a.hp+6);e.used[a.id]=1;if(cheap)bump(st.success,e.type);
    record(a,'Bought gear from a road merchant in '+ZONES[e.z]+' for '+cost+'g (rolled '+r+').');
    log(a,' haggles with a wagon merchant on ',road(e),'... ',dm('rolls '+r),'. ',cheap?'A bargain: new gear for ':'New gear for ',gold(cost+'g'),'.');break}
  case 'shrine':{const r=d20(),deep=r>=16;a.blessed=1;e.used[a.id]=1;pop(a.x,a.y-.6,'BLESSED','#9ad0ff');if(deep)bump(st.success,e.type);
    record(a,'Blessed at a lanternstone shrine in '+ZONES[e.z]+' (rolled '+r+').');
    if(deep){const h=Math.round(mh*.3);a.hp=Math.min(mh,a.hp+h);log(a,' kneels at a lanternstone on ',road(e),'... ',dm('rolls '+r),'. The lantern burns bright: blessed and mended for ',String(h),'.')}
    else log(a,' kneels at a lanternstone on ',road(e),'... ',dm('rolls '+r),'. Blessed: the next blow lands harder.');break}
  case 'chest':{const r=d20(),dc=10+e.z*2;remove(e);record(a,(r>=dc?'Opened':'Sprung')+' a trapped strongbox in '+ZONES[e.z]+' (rolled '+r+' vs '+dc+').');
    if(r>=dc){const g=a.lvl*5;a.gold+=g;bump(st.success,e.type);pop(a.x,a.y-.6,'+'+g+'g','#f2c14e');log(a,' pries at a strongbox on ',road(e),'... ',dm('rolls '+r+' vs '+dc),'. Gold: ',gold(g+'g'),'.')}
    else{const w=Math.round(mh*.25);a.hp=Math.max(1,a.hp-w);pop(a.x,a.y-.6,String(w),'#ff6a5a');log(a,' pries at a strongbox on ',road(e),'... ',dm('rolls '+r+' vs '+dc),'. A needle in the lock: ',String(w),' damage.')}break}
  case 'pilgrim':{e.escort=a;e.escortT=S.gameMin;a.pilgrim=e;record(a,'Took a lost pilgrim under escort in '+ZONES[e.z]+'.');
    log(a,' finds a lost pilgrim on ',road(e),' and takes them along to ',CITY[a.fac].name,'.');break}
  case 'ambush':{const mates=partyMates(a).filter(b=>dist(a,b)<=8),mod=Math.max(Math.floor(a.lvl/2),...mates.map(b=>Math.floor(b.lvl/2))),r=d20(),dc=12+e.z*2;remove(e);
    const who=e.n+' Rookscar bandits';record(a,(r+mod>=dc?'Drove off ':'Robbed by ')+who+' in '+ZONES[e.z]+' (rolled '+r+'+'+mod+' vs '+dc+').');
    if(r+mod>=dc){const zl=ZLVL[e.z],diff=zl-a.lvl,xp=(8+zl*6)*(diff<-4?.3:diff>2?1.3:1),g=zl*2+ri(0,zl);bump(st.success,e.type);
      gainXp(a,xp);for(const b of mates)gainXp(b,xp*.6);a.gold+=g;pop(a.x,a.y-.6,'+'+g+'g','#f2c14e');
      log(a,mates.length?' and party are':' is',' ambushed by ',who,' on ',road(e),'... ',dm('rolls '+r+'+'+mod+' vs '+dc),'. The bandits break and run; ',gold(g+'g'),' in their purses.')}
    else{const w=Math.round(mh*.35);a.hp=Math.max(1,a.hp-w);pop(a.x,a.y-.8,'FLEE','#ffb060');goHome(a);
      log(a,mates.length?' and party are':' is',' ambushed by ',who,' on ',road(e),'... ',dm('rolls '+r+'+'+mod+' vs '+dc),'. Cut for ',String(w),' and driven off.')}break}
  }}

// ---- hero hook, called from the travel and return cases of updAgent ----
// Returns true when the hero spent this tick walking to or resolving an encounter.
export function checkEncounter(a,dt){ensure();
  let e=a.enc;
  if(e){if(!alive().includes(e)||dist(a,e)>NOTICE*2.5||!wants(a,e)){a.enc=null;a.dest=null;return false}
    if(moveTo(a,e.x,e.y,dt,2.4)){a.enc=null;a.dest=null;resolve(a,e)}return true}
  a.encScan=(a.encScan||0)-dt;if(a.encScan>0)return false;a.encScan=.5+rnd()*.3;
  if(a.hp<maxHp(a)*MIN_HP||(a.party&&a.party.leader!==a)||isStorm(zoneAt(a.x,a.y)))return false;
  let best=null,bd=NOTICE;for(const x of alive()){if(x.escort)continue;const d=dist(a,x);if(d<bd&&wants(a,x)){bd=d;best=x}}
  if(!best)return false;a.enc=best;a.dest=null;return true}

const afield=b=>b.state==='travel'||b.state==='return'||b.state==='hunt'||b.state==='fight'||b.state==='duel'||b.state==='assist'||b.state==='regroup'||b.state==='follow';

// Once per step: spawn, expire, walk escorted pilgrims and settle their arrival.
export function encountersTick(dt){ensure();const L=alive();
  if(S.gameMin>=S.encNext){S.encNext=S.gameMin+SPAWN_MIN+rnd()*(SPAWN_MAX-SPAWN_MIN);if(L.length<MAX_ALIVE)spawn()}
  for(let i=L.length-1;i>=0;i--){const e=L[i];
    if(e.escort){const a=e.escort;
      if(a.state==='town'){bump(S.encStats.resolved,'pilgrim');const r=d20(),gift=r>=12?a.lvl*2+3:0;a.honor+=3;S.facStats[a.fac].honor+=3;if(gift){a.gold+=gift;bump(S.encStats.success,'pilgrim')}
        record(a,'Brought a pilgrim safe to '+CITY[a.fac].name+' for 3 honor'+(gift?' and '+gift+'g':'')+'.');
        log(a,' brings the pilgrim safe to the gate of ',CITY[a.fac].name,'. ',dm('rolls '+r),'. +3 honor',gift?' and a gift of ':'.',gift?gold(gift+'g'):'',gift?'.':'');remove(e);continue}
      if(!afield(a)||a.hidden||S.gameMin-e.escortT>ESCORT_MAX){S.encStats.abandoned++;if(a.state!=='dead')log('The pilgrim loses sight of ',a,' on ',road(e),' and waits by the roadside.');
        a.pilgrim=null;e.escort=null;e.until=Math.max(e.until,S.gameMin+240);e.z=zoneAt(e.x,e.y);continue}
      if(dist(e,a)>1.2)moveTo(e,a.x-a.face*.9,a.y+.2,dt,2.8);else e.moving=false;continue}
    if(S.gameMin>=e.until){S.encStats.expired++;L.splice(i,1)}}}
