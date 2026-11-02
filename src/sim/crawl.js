// The dungeon crawl (issue #65). When the Fellowship goes down into a dungeon whose spec lists rooms
// (CRYPT.rooms, src/world/spec.js), the run is not one abstract roll: it goes room by room, each
// round of each room a Table scene (kind 'crawl', turns in initiative order) the DM frames, resolved by
// dice at the table. Background groups keep the single `pw` roll in dungeon.js, untouched.
//
// The model, small on purpose. A room has foes (bestiary species; `hits` blows to put one down, from its
// role unless the spec says), a foe level (party average + the room's offset) and `hit`, the share of a
// hero's max HP a foe's blow takes. A round: every member picks an act in turn (strike, draw the foes
// onto yourself, hold the line, the class's special, heal, give a potion, fall back); a strike is a d20
// plus skill against the foe's number, a 20 lands twice, a 1 leaves you open. Then the foes that still
// stand strike back, each one blow at a target by d20 against armour, the front-holder drawing most.
// Damage is real hit points; a hero at zero is dead for good (hardcore): deaths come from these dice at
// the table, not from a hidden wipe roll. A majority falling back withdraws the party (a rearguard blow
// as they go); a room not won in `rounds` drives them back. Clearing the last room pays what the abstract
// run pays. Plain data on CRYPT.group.crawl (numbers and ids only), so a save mid-crawl resumes.
import {rnd,ri,pickA} from '../core/rng.js';
import {CRYPT} from '../world/map.js';
import {BESTIARY,VARIANTS,ROLES,heroTag,baseId} from '../data/bestiary.js';
import {CLS} from '../data/classes.js';
import {S} from './state.js';
import {log} from './chronicle.js';
import {maxHp,goHome,fall} from './heroes.js';
import {combatStats} from './stats.js';
import {record,timeline,first} from './history.js';
import {bestUse,useItem} from './inv.js';
import {notify} from './notify.js';
import {setCrawlHook,payClear} from './dungeon.js';
import {tableOn,openScene,setSceneKind} from './table.js';

export const CRAWL={
  GAP:4,          // seconds (world time) between one room and the next
  BREATH:.12,     // share of max HP each survivor regains on a won room
  ROUNDS:4,       // rounds a room holds before the party is driven back, unless the room says
  RETREAT_HIT:.5, // the rearguard's blow as a party withdraws, as a share of the room's hit
  GUARD_DRAW:.7,  // chance a foe's blow goes to whoever drew the foes
  GUARD_CUT:.5,   // a drawn blow lands at this share; the holder's line cuts the rest by HOLD_CUT each
  HOLD_CUT:.25,
  DC:9,           // a strike beats d20 + skill against DC + foe level/2
  FOE_HIT:3,      // foes strike at d20 + FOE_HIT + level/2 against 10 + armour
};
const gd=t=>({t,c:'gd'});
const byId=id=>S.agents.find(x=>x.id==id)||null;
const living=a=>a&&a.kind==='hero'&&a.state!=='dead';

const roomsOf=()=>CRYPT.rooms||[];
// The crawl runs for a group the Fellowship is in, in a dungeon with rooms, while Table mode is on (Watch mode keeps the roll).
export const crawlFits=g=>!!(g&&g.mem.some(a=>a.fellow)&&roomsOf().length&&tableOn());
const lvlOf=g=>{const L=g.mem;return Math.max(1,Math.round(L.reduce((t,a)=>t+a.lvl,0)/Math.max(1,L.length)))};
// A crawl foe's species: a site creature (VARIANTS: shambler, graveward ...) or a field species.
export const species=type=>VARIANTS[type]||BESTIARY[baseId(type)]||null;
const hitsOf=f=>f.hits||Math.max(1,Math.round(((ROLES[(species(f.type)||{}).role]||ROLES.brute).hp)*2));
const foeName=f=>f.name||(species(f.type)?species(f.type).name||f.type:'the foe');
const liveFoes=cr=>cr.foes.filter(f=>f.hp>0);

// ---- the group enters ----
export function startCrawl(g){if(!crawlFits(g))return false;
  g.mem0=g.mem.length;
  g.crawl={i:0,rd:0,gap:0,foes:null,guard:[],back:[],shield:0,edge:0,end:null,lvl:lvlOf(g),stats:{rooms:0,rounds:0,blows:0}};
  log(gd(S.fellowship.name),' go room by room: ',gd(CRYPT.name),', ',String(roomsOf().length),' chambers.');return true}

// ---- opening a room's round ----
function buildFoes(room,lvl){const out=[];
  for(const f of room.foes)for(let k=0;k<f.n;k++){const h=hitsOf(f);out.push({type:f.type,name:foeName(f),hp:h,hits:h,atk:f.atk||1,lvl:Math.max(1,lvl+(room.lvl||0))})}
  return out}
const woundedWord=a=>a.hp<maxHp(a)*.35?' (badly hurt)':a.hp<maxHp(a)*.65?' (hurt)':'';
function frameOf(g,room){const cr=g.crawl,rem=liveFoes(cr),by={};for(const f of rem)by[f.name]=(by[f.name]||0)+1;
  const list=Object.keys(by).map(n=>by[n]>1?by[n]+' '+(species((rem.find(f=>f.name===n)||{}).type)||{}).pl||n+'s':n).join(' and ');
  const fresh=cr.rd===0,hurt=g.mem.filter(a=>living(a)&&a.hp<maxHp(a)*.65).map(a=>a.name+woundedWord(a));
  return [fresh?room.frame+' ':'The fight goes on. ',gd(list)+(fresh?' bar the way.':' still stand.'),hurt.length?' Hurt: '+hurt.join(', ')+'.':'',
    ' Room '+(cr.i+1)+' of '+roomsOf().length+', round '+(cr.rd+1)+'.']}

function openRound(g){const cr=g.crawl,room=roomsOf()[cr.i];
  if(!cr.foes){cr.foes=buildFoes(room,cr.lvl);cr.rd=0;cr.stats.rooms++}
  cr.guard=[];cr.back=[];cr.shield=0;cr.edge=Math.round(g.bonus||0); // the site scene's choices at the stair (sim/table.js g.bonus) tip every roll of the crawl
  return openScene('crawl',room.name+(cr.rd?' (round '+(cr.rd+1)+')':''),frameOf(g,room),{room:cr.i,rd:cr.rd})}

// ---- the scene kind ----
const SPECIAL={Warrior:['hold','Hold the line: the foes\' blows on the others fall short'],Priest:['ward','Ward the group with prayer: a little mending and a steadier hand for all'],
  Rogue:['scout','Look for the gap in their guard'],Hunter:['scout','Read their movements and call the gap'],Mage:['read','Read the old wards and turn them on the foes']};
const grp=()=>CRYPT.group&&CRYPT.group.crawl?CRYPT.group:null;
const members=g=>g.mem.filter(living);
const lowest=g=>{let lo=null;for(const b of members(g))if(!lo||b.hp/maxHp(b)<lo.hp/maxHp(lo))lo=b;return lo};
const pct=a=>Math.round(a.hp/maxHp(a)*100);
function options(sc,a){const g=grp();if(!g)return [];const cr=g.crawl,f=liveFoes(cr)[0],lo=lowest(g),o=[];
  o.push({k:'strike',text:'Strike '+(f?f.name:'the foe')});
  o.push({k:'guard',text:'Draw the foes onto yourself'});
  const s=SPECIAL[a.cls];if(s)o.push({k:s[0],text:s[1]});
  if(CLS[a.cls]&&CLS[a.cls].heal&&lo)o.push({k:'heal',text:'Heal '+(lo===a?'yourself':lo.name)+' ('+pct(lo)+'%)'});
  const pot=lo&&lo.hp<maxHp(lo)?bestUse(a,'potion'):null;if(pot)o.push({k:'potion',text:'Give a '+pot+' to '+(lo===a?'yourself':lo.name)+' ('+pct(lo)+'%)'});
  o.push({k:'retreat',text:'Fall back toward the stair (if most do, the party withdraws)'});return o}
function reflex(sc,a){const g=grp();if(!g)return 'strike';const cr=g.crawl,lo=lowest(g),mh=maxHp(a),healer=CLS[a.cls]&&CLS[a.cls].heal;
  if(lo&&lo.hp<maxHp(lo)*.35&&bestUse(a,'potion'))return 'potion';
  if(healer&&lo&&lo.hp<maxHp(lo)*.6)return 'heal';
  if(a.hp<mh*.2)return 'retreat';
  if(a.fellowRole==='tank'&&!cr.guard.length)return 'guard';
  if(cr.rd===0&&SPECIAL[a.cls]&&a.fellowRole!=='tank')return SPECIAL[a.cls][0];
  return 'strike'}
// A roll's skill: level and gear, halved, plus the round's edge (scouting, a ward, the site scene).
const skill=(a,cr,f)=>{const bz=(f&&species(f.type))||{},tag=heroTag(a.cls),w=(bz.weak||{})[tag]||1,rs=(bz.res||{})[tag]||1;
  return Math.round((a.lvl+a.gear*.3)/2)+cr.edge+(w>1.1?1:0)-(rs<.95?1:0)};
const heal=(b,amt)=>{const h=Math.min(maxHp(b)-b.hp,Math.round(amt));b.hp+=h;return h};
function apply(sc,a,act){const g=grp();if(!g)return null;const cr=g.crawl,k=act.k,f=liveFoes(cr)[0];
  switch(k){
  case 'strike':{if(!f)return 'the room is quiet';const d=ri(1,20),dc=CRAWL.DC+Math.floor(f.lvl/2),t=d+skill(a,cr,f);cr.stats.blows++;
    if(d===1){cr.open=(cr.open||[]);cr.open.push(a.id);return 'missed badly and left an opening'}
    if(t<dc&&d<20)return 'missed';
    const n=d===20?2:1;f.hp-=n;return f.hp<=0?'struck down '+f.name:d===20?'a crushing blow':'hit '+f.name}
  case 'guard':cr.guard.push(a.id);return 'drew the foes';
  case 'hold':cr.shield++;cr.guard.push(a.id);return 'held the line';
  case 'ward':{let n=0;for(const b of members(g))n+=heal(b,maxHp(b)*.08);cr.edge+=1;return n?'mended the group':'steadied the group'}
  case 'scout':case 'read':cr.edge+=2;return k==='scout'?'found a gap':'turned the wards';
  case 'heal':{const lo=lowest(g);if(!lo)return 'nobody to heal';return '+'+heal(lo,maxHp(lo)*.25)+' to '+lo.name}
  case 'potion':{const lo=lowest(g),id=bestUse(a,'potion');if(!lo||!id)return 'nothing to give';const r=useItem(a,id,lo,{table:true});return r.ok?'+'+r.healed+' to '+lo.name:r.error}
  case 'retreat':cr.back.push(a.id);return 'fell back'}
  return null}

// The foes' turn, and what the round settles. Returns the sentence the scene ends on.
function foeBlow(g,f,room,cr,rearguard){const L=members(g);if(!L.length)return null;
  const front=cr.guard.map(byId).filter(x=>living(x)&&L.includes(x)),open=(cr.open||[]).map(byId).filter(x=>living(x)&&L.includes(x));
  const rear=L.filter(x=>!cr.back.includes(x.id)),pool=rear.length?rear:L;
  let t=front.length&&rnd()<CRAWL.GUARD_DRAW?pickA(front):pickA(open.length&&rnd()<.5?open:pool),drawn=front.includes(t);
  const ac=10+Math.round(combatStats(t).defense*20),d=ri(1,20);
  if(d!==20&&(d===1||d+CRAWL.FOE_HIT+Math.floor(f.lvl/2)<ac))return {t,miss:true};
  let dmg=maxHp(t)*room.hit*(.7+rnd()*.6)*(f.atk||1)*(rearguard?CRAWL.RETREAT_HIT:1)*(d===20?1.5:1);
  if(drawn)dmg*=CRAWL.GUARD_CUT;else dmg*=1-Math.min(.5,cr.shield*CRAWL.HOLD_CUT);
  dmg=Math.max(1,Math.round(dmg));t.hp-=dmg;
  if(t.hp<=0){return {t,dmg,down:true}}return {t,dmg}}
function strikeBack(g,room,cr,rearguard){const out=[],foes=rearguard?[pickA(liveFoes(cr))]:liveFoes(cr),fell=[];
  for(const f of foes){if(!f)continue;const r=foeBlow(g,f,room,cr,rearguard);if(!r)break;
    if(r.down&&!fell.includes(r.t)){fell.push(r.t);const cause='felled by '+f.name+' in '+CRYPT.name;
      record(r.t,'Fell in ',gd(CRYPT.name),', slain by '+f.name+'.');fall(r.t,cause);log(r.t,' fell in ',gd(room.name),' to '+f.name+'.')}
    out.push(r)}
  return {fell,hits:out.filter(x=>!x.miss).length,misses:out.filter(x=>x.miss).length}}
function outcome(sc){const g=grp();if(!g)return '';const cr=g.crawl,room=roomsOf()[cr.i];cr.stats.rounds++;let tail;
  const foes=liveFoes(cr);
  if(!foes.length){tail='The last of them goes down.';for(const b of members(g))heal(b,maxHp(b)*CRAWL.BREATH);
    if(sc.beats.some(b=>b.k==='retreat'))tail+=' Those who fell back come forward again.';
    if(cr.i+1>=roomsOf().length){cr.end='clear';cr.foes=null}
    else{cr.i++;cr.foes=null;cr.rd=0;cr.gap=CRAWL.GAP;tail+=' The way on is open.'}
    return tail}
  const live=members(g);
  if(cr.back.filter(id=>live.some(x=>x.id===id)).length*2>=live.length){const r=strikeBack(g,room,cr,true);cr.end='retreat';
    tail='Most of the party falls back and the rest follow, up the stair'+(r.fell.length?'; the rearguard pays for it ('+r.fell.map(x=>x.name).join(', ')+' falls)':'')+'.';
    if(!members(g).length)cr.end='wiped';return tail}
  const r=strikeBack(g,room,cr,false);
  tail=foes.length+' of them stand'+(foes.length===1?'s':'')+'. '+(r.hits+r.misses?r.hits+(r.hits===1?' blow lands, ':' blows land, ')+r.misses+(r.misses===1?' misses.':' miss.'):'')+(r.fell.length?' '+r.fell.map(x=>x.name).join(' and ')+' falls.':'');
  if(!members(g).length){cr.end='wiped';return tail}
  cr.rd++;if(cr.rd>=(room.rounds||CRAWL.ROUNDS)){cr.end='retreat';cr.driven=true;tail+=' They cannot win this room; the party is driven back up the stair.'}
  return tail}

setSceneKind('crawl',{options,reflex,apply,outcome});

// ---- the driver, once per step while the group is inside (called from dungeon.js dungeonCheck) ----
function leave(g){for(const a of g.mem){a.hidden=false;a.x=CRYPT.x+(rnd()-.5)*1.5;a.y=CRYPT.y+.5+rnd()*.6}}
function finish(g){const cr=g.crawl,who={t:g.name||S.fellowship.name,c:'f'+g.fac},st=cr.stats;leave(g);
  if(cr.end==='clear'){log(who,' cleared ',gd(CRYPT.name),' room by room and destroyed ',gd(CRYPT.boss),'!');
    if(first('crypt:f'+g.fac))timeline('crypt',who,' cleared ',gd(CRYPT.name),' for the first time.');
    payClear(g)}
  else{const names=g.mem.filter(living);
    log(who,cr.driven?' were driven back from ':' withdrew from ',gd(CRYPT.name),' with the ',gd(roomsOf()[cr.i].name),' unbeaten.');
    for(const a of names){record(a,cr.driven?'Driven back from ':'Withdrew from ',gd(CRYPT.name),'.');goHome(a)}}
  tally(cr.end==='clear'?'clears':cr.driven?'driven':'withdrawn',g,cr);
  CRYPT.group=null;return st}
// Called when the group has no one left (everyone fell): the wipe, at the table's dice.
export function crawlLost(g){const who={t:g.name||S.fellowship.name,c:'f'+g.fac};
  log(who,' was lost in ',gd(CRYPT.name),'. No one came back up the stair.');timeline('death',who,' was lost in ',gd(CRYPT.name),' to the last man.');
  tally('wipes',g,g.crawl)}
// The Fellowship's crawl record (S.fellowship.crawl: runs, clears, driven back, withdrawn, wipes, deaths, rooms won), for the sim summary and the checks.
function tally(k,g,cr){const F=S.fellowship,C=F.crawl||(F.crawl={runs:0,clears:0,driven:0,withdrawn:0,wipes:0,deaths:0,rooms:0});
  C.runs++;C[k]++;C.rooms+=cr.end==='clear'?roomsOf().length:cr.i;C.deaths+=g.mem0-g.mem.filter(living).length}
function tick(g,dt){const cr=g.crawl;
  if(S.table)return;                                  // a scene (the stair, or a room) is open: the table runs it
  if(!g.tSite)return;                                 // the stair scene (sim/table.js tableTick) comes first
  if(cr.end==='wiped'){crawlLost(g);CRYPT.group=null;return}
  if(cr.end){finish(g);return}
  if(cr.gap>0){cr.gap-=dt;return}
  if(!members(g).length){crawlLost(g);CRYPT.group=null;return}
  const sc=openRound(g);if(!sc)return;
}
setCrawlHook({start:startCrawl,tick,lost:crawlLost});
