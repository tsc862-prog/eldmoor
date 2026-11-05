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
// Damage is real hit points; a hero at zero is downed (#654, sim/downed.js): they lie in the room and roll a death
// save on their turn each round, the others may heal, give a potion or stabilize them, and the foes strike only those
// standing. Nobody left standing is the wipe, and the downed die with it. Deaths come from these dice at the table,
// not from a hidden wipe roll. A party that leaves with someone down carries them up the stair, still bleeding. A majority falling back withdraws the party (a rearguard blow
// as they go); a room not won in `rounds` drives them back. Clearing the last room pays what the abstract
// run pays. Plain data on CRYPT.group.crawl (numbers and ids only), so a save mid-crawl resumes.
// Positions (#744, sim/roomgrid.js): cr.pos keeps a tile of the room's own grid for every member and foe ({heroId: {x, y}, f0: ...},
// for room cr.posR). The party comes in at the stair in slot order, the foes stand at the den. An agent's act may carry a move (a spot,
// a relation or steps; it lands at once), guard, hold and retreat imply one, a reflex goes where its act goes.
// Geometry (#745, sim/geometry.js): the tiles decide. A strike needs reach (a walk first, and it lands only if the walk gets there), flank
// and a friend on the line tip its roll, a guard takes the blows beside it and covers those it stands by, foes walk and strike only what
// they reach, a step out of a foe's reach gives it a free blow (cr.free, settled with the foes' turn), a Mage's read is a blast on a square,
// a ward reaches those near, tending needs their side, and a withdrawal needs the stair. GEO.ON=false, or a room with no grid, plays as before.
import {rnd,ri,pickA} from '../core/rng.js';
import {CRYPT} from '../world/map.js';
import {standAt} from '../world/passable.js';
import {BESTIARY,VARIANTS,ROLES,heroTag,baseId} from '../data/bestiary.js';
import {CLS} from '../data/classes.js';
import {S} from './state.js';
import {log} from './chronicle.js';
import {maxHp,goHome,fall,gainXp} from './heroes.js';
import {combatStats} from './stats.js';
import {record,timeline,first} from './history.js';
import {bestUse,useItem} from './inv.js';
import {notify} from './notify.js';
import {setCrawlHook,payClear,clearXp} from './dungeon.js';
import {tableOn,openScene,setSceneKind,sceneFor} from './table.js';
import {moment,setReflectHold} from './reflect.js'; // no reflection while a crawl runs; one moment when it ends (#687)
import {companyOf,companyById,roleOf,slotKeyOf,slotted,slotHeroes} from './company.js';
import {buildInterior} from '../world/interior.js';
import {siteInterior} from '../world/siteinterior.js';
import {roomGrid,placeRoom,resolveMove,aimTile,roomWords,moveNames,spotFor,spotAt,spotWord,goSpot,goBeside} from './roomgrid.js'; // who stands where in the room (#744)
import {DOWN,isDown,crawlDown,downHit,leftBehind,toWorld,bleedOut,bleedingOf,stabText,stabilizeAt,reviveBonus} from './downed.js'; // the downed below ground (#654)
import {GEO,adj,within,shoots,foeShoots,targetOf,guardOf,inCover,leaving,wardOf,blastAt,bestBlast,blowsFrom,foeTile,tileFor,canBeside,atStair,consequences} from './geometry.js'; // the rules of the tiles (#745)
import {tendBy} from './tend.js'; // a heal landing on a wound takes a day off it (#656)

export const CRAWL={
  GAP:4,          // seconds (world time) between one room and the next
  BREATH:.12,     // share of max HP each survivor regains on a won room
  ROUNDS:2,       // rounds a room holds before the party is driven back, unless the room says
  ROOM_XP:1,      // XP per room won, in clear payouts divided by the rooms (so a full clear pays the same total)
  CLEAR_BONUS:.1, // the last clear then adds this share of the payout on top of the gold and goods
  RETREAT_HIT:.5, // the rearguard's blow as a party withdraws, as a share of the room's hit
  GUARD_DRAW:.7,  // chance a foe's blow goes to whoever drew the foes
  GUARD_CUT:.5,   // a drawn blow lands at this share; the holder's line cuts the rest by HOLD_CUT each
  HOLD_CUT:.25,
  SCOUT_MIN:6,    // reflex scouts in a room's first round only when the foes need this many blows (two rounds leave no time to spare)
  DC:9,           // a strike beats d20 + skill against DC + foe level/2
  FOE_HIT:3,      // foes strike at d20 + FOE_HIT + level/2 against 10 + armour
};
const gd=t=>({t,c:'gd'});
const byId=id=>S.agents.find(x=>x.id==id)||null;
const living=a=>a&&a.kind==='hero'&&a.state!=='dead';

// The dungeon a group is in: a DM-made site (sim/sites.js, #69; g.site its id, the site's rooms as data on S.sites) or the Sunken Crypt.
// Read straight from S so this module never imports sites.js (sites.js drives its groups through the exports below).
export const siteById=id=>id==null?null:((S.sites&&S.sites.list)||[]).find(s=>s.id===id)||null;
const dunOf=g=>g&&g.site!=null?siteById(g.site)||CRYPT:CRYPT;
const roomsOf=g=>dunOf(g).rooms||[];
var SITE_END=null;export function setSiteEnd(f){SITE_END=f} // sim/sites.js: pays a cleared site, marks a ruin
// The crawl runs for a group the Fellowship is in, in a dungeon with rooms, while Table mode is on (Watch mode keeps the roll).
// The company is the first group member who rides in one (a company in a group comes first, see council.js unitDraft); a solo is a company of one.
const coOf=g=>{for(const a of g.mem){const C=companyOf(a);if(C)return C}return null};
export const crawlFits=g=>!!(g&&coOf(g)&&roomsOf(g).length&&tableOn());
const lvlOf=g=>{const L=g.mem.filter(a=>crewOf(g).includes(a));return Math.max(1,Math.round(L.reduce((t,a)=>t+a.lvl,0)/Math.max(1,L.length)))};
// A crawl foe's species: a site creature (VARIANTS: shambler, graveward ...) or a field species.
export const species=type=>VARIANTS[type]||BESTIARY[baseId(type)]||null;
const hitsOf=f=>f.hits||Math.max(1,Math.round(((ROLES[(species(f.type)||{}).role]||ROLES.brute).hp)*2));
const foeName=f=>f.name||(species(f.type)?species(f.type).name||f.type:'the foe');
const liveFoes=cr=>cr.foes.filter(f=>f.hp>0);

// ---- the group enters ----
export function startCrawl(g){if(!crawlFits(g))return false;
  g.mem0=g.mem.length;
  const C=coOf(g);
  g.crawl={i:0,rd:0,gap:0,foes:null,guard:[],back:[],shield:0,edge:0,end:null,lvl:0,stats:{rooms:0,rounds:0,blows:0},co:C.id};
  g.crawl.lvl=lvlOf(g);g.crawl.crew=crewOf(g).length;
  log(gd(g.name||C.name),' go room by room: ',gd(dunOf(g).name),', ',String(roomsOf(g).length),' chambers.');return true}

// ---- opening a room's round ----
// Foe counts are written for five. A company of another size meets proportionally more or fewer (never fewer than one of a kind);
// the Fellowship's five-slot company meets the rooms as written.
const scaleN=(n,cr)=>{const C=companyById(cr.co);return !C||C.slots||!cr.crew?n:Math.max(1,Math.round(n*cr.crew/5))};
// A site's room (#69) names its foes' level outright (alvl, plus the site's growth); the Crypt's rooms are relative to the party.
function buildFoes(room,lvl,cr,D){const out=[],fl=room.alvl!=null?room.alvl+((D&&D.grow)||0):lvl+(room.lvl||0);
  for(const f of room.foes)for(let k=0;k<scaleN(f.n,cr);k++){const h=hitsOf(f);out.push({type:f.type,name:foeName(f),hp:h,hits:h,atk:f.atk||1,lvl:Math.max(1,fl)})}
  return out}
// A foe above the party hits harder in a site room (its level is its own); the Crypt's rooms keep their written hit.
const hitOf=(room,f,cr)=>{if(room.alvl==null)return room.hit;const d=f.lvl-cr.lvl;return room.hit*Math.max(.12,Math.min(1.8,d>=0?1+.08*d:1+.1*d))*(f.ph||1)}; // f.ph: a raid site boss's phase (sim/sites.js, #642)
const woundedWord=a=>isDown(a)?(a.down.stable?' (down, stable)':' (down, bleeding)'):a.hp<maxHp(a)*.35?' (badly hurt)':a.hp<maxHp(a)*.65?' (hurt)':'';
function frameOf(g,room){const cr=g.crawl,rem=liveFoes(cr),by={};for(const f of rem)by[f.name]=(by[f.name]||0)+1;
  const list=Object.keys(by).map(n=>by[n]>1?by[n]+' '+(species((rem.find(f=>f.name===n)||{}).type)||{}).pl||n+'s':n).join(' and ');
  const fresh=cr.rd===0,hurt=members(g).filter(a=>a.hp<maxHp(a)*.65).map(a=>a.name+woundedWord(a));
  return [fresh?room.frame+' ':'The fight goes on. ',gd(list),rem.length===1?(fresh?' bars the way.':' still stands.'):(fresh?' bar the way.':' still stand.'),hurt.length?' Hurt: '+hurt.join(', ')+'.':'',
    ' Room '+(cr.i+1)+' of '+roomsOf(g).length+', round '+(cr.rd+1)+'.']}

function openRound(g){const cr=g.crawl,room=roomsOf(g)[cr.i];
  if(!cr.foes){cr.foes=buildFoes(room,cr.lvl,cr,dunOf(g));cr.rd=0;cr.stats.rooms++;
    if(room.alvl!=null)cr.cap=Math.max(room.rounds||CRAWL.ROUNDS,Math.ceil(cr.foes.reduce((t,f)=>t+f.hp,0)/(Math.max(1,cr.crew||1)*.6))+1)} // a site room (#69): a small crew gets the rounds its blows need
  placed(g); // the party at the stair, the foes at the den (#744)
  cr.guard=[];cr.back=[];cr.shield=0;cr.free=[];cr.warded=[];cr.hid=[];cr.aim={};cr.edge=Math.round(g.bonus||0); // the site scene's choices at the stair (sim/table.js g.bonus) tip every roll of the crawl
  return openScene('crawl',room.name+(cr.rd?' (round '+(cr.rd+1)+')':''),frameOf(g,room),g.site!=null?{room:cr.i,rd:cr.rd,site:g.site}:{room:cr.i,rd:cr.rd},companyById(cr.co)||undefined)}

// ---- the scene kind ----
const SPECIAL={Warrior:['hold','Hold the line: the foes\' blows on the others fall short'],Priest:['ward','Ward the group with prayer: a little mending and a steadier hand for all'],
  Rogue:['scout','Look for the gap in their guard'],Hunter:['scout','Read their movements and call the gap'],Mage:['read','Read the old wards and turn them on the foes'],Wildspeaker:['ward','Ask the roots for a steadier hand for all'],Skald:['read','Sing a dirge that turns the old wards on the foes']};
// The group a crawl scene belongs to: the site its ctx names, else the Crypt's.
const grp=sc=>{const id=sc&&sc.ctx&&sc.ctx.site;if(id!=null){const D=siteById(id),g=D&&D.group;return g&&g.crawl?g:null}return CRYPT.group&&CRYPT.group.crawl?CRYPT.group:null};
// The crew is the company at the table (#441); background fill-ins ride along: they are paid and brought home, but do not act,
// take blows or count for the foes. A crawl saved before companies (no cr.co) treats the whole group as the crew.
const crewOf=g=>{const C=g.crawl&&g.crawl.co!=null?companyById(g.crawl.co):null;return C?g.mem.filter(a=>C.ids.includes(a.id)):g.mem};
const members=g=>crewOf(g).filter(living);
const standing=g=>members(g).filter(a=>!isDown(a)); // the crew on their feet (#654)
const healerCls=b=>!!(CLS[b.cls]&&CLS[b.cls].heal);
const hpOf=a=>isDown(a)?'down':pct(a)+'%';
const pct=a=>Math.round(a.hp/maxHp(a)*100);
// ---- who stands where (#744): the room as the sim keeps it and as one member reads it ----
const gridOf=g=>{const D=dunOf(g),i=g.crawl.i;return roomGrid(g.site!=null&&D!==CRYPT?siteInterior(D):buildInterior(D),i,roomsOf(g)[i])};
const inOrder=g=>{const C=companyById(g.crawl.co),L=members(g),H=C&&C.slots?slotHeroes(C).filter(a=>L.includes(a)):[];return [...H,...L.filter(a=>!H.includes(a))]};
// The room's tiles for everyone in it, set on the room's first round; a crawl saved before #744 gets them here. Null: no room to stand in.
function placed(g){const cr=g.crawl;if(!cr.foes)return null;const G=gridOf(g);if(!G)return null;placeRoom(G,cr,inOrder(g).map(a=>a.id),cr.foes.length);return G}
function seen(g,a){const G=placed(g);if(!G)return null;const cr=g.crawl,room=roomsOf(g)[cr.i];return {G,cr,pos:cr.pos,guards:cr.guard,me:a&&a.id,mates:members(g).map(b=>({id:b.id,name:b.name,down:isDown(b)})),
  foes:cr.foes.map((f,k)=>{const s=species(f.type)||{};return {key:'f'+k,name:f.name,hp:f.hp,role:s.role,fin:!!(s.beh&&s.beh.finishes),boss:!!room.boss&&f.name!==s.name}}).filter(f=>f.hp>0)}}
// The room as the rules read it (sim/geometry.js); null with the rules off or no room to stand in.
const field=(g,a)=>GEO.ON&&g.crawl.foes?seen(g,a):null;
const foeAt=(cr,key)=>cr.foes[+key.slice(1)];
const blaster=a=>a.cls==='Mage'; // the one whose read is a blast (the others' read stays a song on the old wards)
// A hero's tile changes: every foe it walks out of the reach of owes a free blow, settled with the foes' turn.
function walkTo(g,F,a,to){const cr=g.crawl,p=cr.pos[a.id];if(F)for(const f of leaving(F,p,to))(cr.free||(cr.free=[])).push({id:a.id,foe:f.key,x:p.x,y:p.y});cr.pos[a.id]={x:to.x,y:to.y}}
// An act that goes somewhere by itself: guard and hold to the front, a retreat toward the stair; a reflex, or a silent agent's,
// where the act goes (roomgrid.js spotFor: the same table the dungeon view drew from, #742). A move given with the act comes first.
const IMPLIED={guard:1,hold:1,retreat:1};
// With the rules on (#745) an act that needs reach walks by itself, agent or reflex; a reflex goes only where its act wants it.
function geoMove(g,F,a,act){const cr=g.crawl,k=act.k,lo=lowest(g),me=cr.pos[a.id],ag=act.by==='agent',ranged=shoots(a.cls);let o={},need=true;
  if(k==='strike'){o={ranged};if(ag){const T=targetOf(F,a.id,ranged);need=!!T&&!T.reach.ok}}
  else if(k==='heal'){o={to:lo&&lo.id,range:DOWN.HEAL_RANGE};if(ag)need=!!lo&&!within(me,cr.pos[lo.id],DOWN.HEAL_RANGE)}
  else if(k==='potion'){if(!lo||lo===a)return;o={to:lo.id};if(ag)need=!adj(me,cr.pos[lo.id])}
  else if(k==='stabilize'){const t=bleedingOf(members(g),a);if(!t)return;o={to:t.id};if(ag)need=!adj(me,cr.pos[t.id])}
  else if(ag&&!IMPLIED[k])return;
  else if(k==='scout')o={spot:'cover'};
  else if(k==='read'){if(blaster(a))return;o={spot:'back'}}
  if(!need)return;const to=tileFor(F,a.id,k,o);if(to)walkTo(g,F,a,to)}
function actMove(sc,g,a,act){if(act.moved||isDown(a))return;const F=field(g,a);if(F)return geoMove(g,F,a,act);if(act.by==='agent'&&!IMPLIED[act.k])return;const s=spotFor(act.k,sc.beats.filter(b=>b.k==='strike').length);if(!s)return;
  const R=seen(g,a);if(!R)return;const t=s==='downed'?bleedingOf(members(g),a):null,to=t?goBeside(R,t.id):goSpot(R,s);if(to)R.cr.pos[a.id]={x:to.x,y:to.y}}
// scene_act's move, read but not yet made: {x, y, word} or {error}. place makes it; view is the room in words for tableView and
// the pace brief; spotOf names where a member stands for the scene's so_far lines.
function moveOf(sc,a,text,k){const g=grp(sc),R=g&&seen(g,a);if(!R)return {error:'There is nowhere to move just now.'};
  if(GEO.ON&&k==='read'&&blaster(a)){const t=aimTile(R,text);return t.error?t:{...t,aim:true}} // a blast's move names the square, and the Mage stays (#745)
  return resolveMove(R,text)}
function placeMove(sc,a,mv){const g=grp(sc);if(!g||!g.crawl.pos)return;if(mv.aim){(g.crawl.aim||(g.crawl.aim={}))[a.id]={x:mv.x,y:mv.y};return}
  const F=field(g,a);if(F)walkTo(g,F,a,mv);else g.crawl.pos[a.id]={x:mv.x,y:mv.y}}
function view(sc,a){const g=grp(sc),R=g&&g.crawl.i===sc.ctx.room?seen(g,a):null;if(!R||!R.cr.pos[a.id])return {};const can=!sc.acts[a.id]&&!isDown(a)&&sc.phase!=='outcome';
  const F=GEO.ON?R:null,t=F&&bleedingOf(members(g),a),o=SPECIAL[a.cls],rules=F?consequences(F,a.id,{ranged:shoots(a.cls),ward:!!o&&o[0]==='ward',down:t?{id:t.id,name:t.name}:null}):[];
  return {room:[roomWords(R,can),...rules].join(' '),...(can?{moves:moveNames(R)}:{})}}
function spotOf(sc,a){const g=grp(sc),cr=g&&g.crawl,p=cr&&cr.posR===cr.i&&cr.pos&&cr.pos[a.id],G=p&&gridOf(g),s=G?spotAt(G,p.x,p.y):null;return s?spotWord(G,s):null}
const lowest=g=>{let lo=null;for(const b of members(g))if(!lo||b.hp/maxHp(b)<lo.hp/maxHp(lo))lo=b;return lo};
function strikeText(g,a){const F=field(g,a),T=F&&targetOf(F,a.id,shoots(a.cls));if(!T)return null;const r=T.reach;
  return 'Strike '+T.foe.name+(r.ok?(T.flank.bonus?' (flanked: +'+T.flank.bonus+')':r.pen?' (a friend in your line: '+r.pen+')':''):' (out of reach: you walk toward it)')}
function options(sc,a){const g=grp(sc);if(!g)return [];const cr=g.crawl,f=liveFoes(cr)[0],lo=lowest(g),o=[];
  o.push({k:'strike',text:strikeText(g,a)||'Strike '+(f?f.name:'the foe')});
  o.push({k:'guard',text:'Draw the foes onto yourself'});
  const s=SPECIAL[a.cls],F=field(g,a);if(s)o.push({k:s[0],text:F&&blaster(a)&&s[0]==='read'?'Blast a square three tiles wide; your move names its centre, friends inside take half':F&&s[0]==='ward'?s[1]+' (only those within '+GEO.WARD_R+' tiles of you)':s[1]});
  if(CLS[a.cls]&&CLS[a.cls].heal&&lo)o.push({k:'heal',text:'Heal '+(lo===a?'yourself':lo.name)+' ('+hpOf(lo)+')'});
  const pot=lo&&lo.hp<maxHp(lo)?bestUse(a,'potion'):null;if(pot)o.push({k:'potion',text:'Give a '+pot+' to '+(lo===a?'yourself':lo.name)+' ('+hpOf(lo)+')'});
  {const bt=bleedingOf(members(g),a);if(bt)o.push({k:'stabilize',text:stabText(a,bt)})} // a companion lies bleeding (#654)
  o.push({k:'retreat',text:F?'Fall back toward the stair (once most stand on it, the party withdraws)':'Fall back toward the stair (if most do, the party withdraws)'});return o}
function reflex(sc,a){const g=grp(sc);if(!g)return 'strike';const cr=g.crawl,lo=lowest(g),mh=maxHp(a),healer=CLS[a.cls]&&CLS[a.cls].heal,F=field(g,a);
  if(lo&&lo.hp<maxHp(lo)*.35&&bestUse(a,'potion')&&(!F||lo===a||canBeside(F,a.id,lo.id)))return 'potion'; // a potion needs their side (#745)
  if(healer&&lo&&lo.hp<maxHp(lo)*.6)return 'heal';
  if(!healer&&bleedingOf(members(g),a)&&!standing(g).some(b=>b!==a&&healerCls(b)))return 'stabilize'; // no healer stands: bind them (#654)
  if(a.hp<mh*.2)return 'retreat';
  if(roleOf(a.cls)==='tank'&&!cr.guard.length)return 'guard';
  if(F&&blaster(a)){const b=bestBlast(F,a.id);if(b&&b.foes.length>1&&!b.friends.length)return 'read'} // two caught and no friend: the square beats one strike
  if(cr.rd===0&&SPECIAL[a.cls]&&slotKeyOf(a)!=='tank'&&liveFoes(cr).reduce((t,f)=>t+f.hp,0)>=CRAWL.SCOUT_MIN)return SPECIAL[a.cls][0];
  return 'strike'}
// A roll's skill: level and gear, halved, plus the round's edge (scouting, a ward, the site scene).
const skill=(a,cr,f)=>{const bz=(f&&species(f.type))||{},tag=heroTag(a.cls),w=(bz.weak||{})[tag]||1,rs=(bz.res||{})[tag]||1;
  return Math.round((a.lvl+a.gear*.3)/2)+cr.edge+((cr.warded||[]).includes(a.id)?1:0)+(w>1.1?1:0)-(rs<.95?1:0)};
const heal=(b,amt)=>{const h=Math.min(maxHp(b)-b.hp,Math.round(amt));b.hp+=h;return h};
function apply(sc,a,act){const g=grp(sc);if(!g)return null;const cr=g.crawl,k=act.k,f=liveFoes(cr)[0];actMove(sc,g,a,act);
  const F=field(g,a);
  switch(k){
  case 'strike':{if(!f)return 'the room is quiet';let foe=f,mod=0;
    if(F){const T=targetOf(F,a.id,shoots(a.cls));cr.stats.strikes=(cr.stats.strikes||0)+1;
      if(!T.reach.ok){cr.stats.walks=(cr.stats.walks||0)+1;return 'out of reach: walked toward '+T.foe.name+', the strike must wait for next round'}
      foe=foeAt(cr,T.foe.key);mod=T.flank.bonus+T.reach.pen;if(T.flank.bonus)cr.stats.flanks=(cr.stats.flanks||0)+1}
    const d=ri(1,20),dc=CRAWL.DC+Math.floor(foe.lvl/2),t=d+skill(a,cr,foe)+mod;cr.stats.blows++;
    if(d===1){cr.open=(cr.open||[]);cr.open.push(a.id);return 'missed badly and left an opening'}
    if(t<dc&&d<20)return 'missed';
    const n=d===20?2:1;foe.hp-=n;return foe.hp<=0?'struck down '+foe.name:d===20?'a crushing blow':'hit '+foe.name}
  case 'guard':cr.guard.push(a.id);return 'drew the foes';
  case 'hold':cr.shield++;cr.guard.push(a.id);return 'held the line';
  case 'ward':{if(F){const L=wardOf(F,a.id),ids=L.map(b=>b.id);let n=0;for(const b of standing(g))if(ids.includes(b.id))n+=heal(b,maxHp(b)*.08);(cr.warded||(cr.warded=[])).push(...ids);return (n?'mended ':'steadied ')+(L.length>1?L.length+' within reach':'only themselves')}
    let n=0;for(const b of standing(g))n+=heal(b,maxHp(b)*.08);cr.edge+=1;return n?'mended the group':'steadied the group'}
  case 'scout':case 'read':{if(F&&k==='read'&&blaster(a))return blast(g,F,a);if(F&&k==='scout'&&inCover(F,a.id)&&F.G.coverWord==='reeds')(cr.hid||(cr.hid=[])).push(a.id); // the reeds hide a scout from the round's first blow
    cr.edge+=2;return k==='scout'?'found a gap':'turned the wards'}
  case 'heal':{const lo=lowest(g);if(!lo)return 'nobody to heal';if(F&&!within(cr.pos[a.id],cr.pos[lo.id],DOWN.HEAL_RANGE)){if(isDown(lo))cr.stats.tendWalks=(cr.stats.tendWalks||0)+1;return lo.name+' is out of range: walked toward them'}
    const h=heal(lo,maxHp(lo)*.25+reviveBonus(lo));tendBy(a,lo,'heal');return '+'+h+' to '+lo.name}
  case 'stabilize':{const t=bleedingOf(members(g),a);if(!t)return 'nobody is bleeding';if(F&&!adj(cr.pos[a.id],cr.pos[t.id])){cr.stats.tendWalks=(cr.stats.tendWalks||0)+1;return t.name+' is out of reach: walked toward them, tending must wait for next round'}return stabilizeAt(a,t).text}
  case 'potion':{const lo=lowest(g),id=bestUse(a,'potion');if(!lo||!id)return 'nothing to give';if(F&&lo!==a&&!adj(cr.pos[a.id],cr.pos[lo.id])){if(isDown(lo))cr.stats.tendWalks=(cr.stats.tendWalks||0)+1;return lo.name+' is out of reach: walked toward them, the potion must wait'}
    const r=useItem(a,id,lo,{table:true});return r.ok?'+'+r.healed+' to '+lo.name:r.error}
  case 'retreat':cr.back.push(a.id);return F&&!atStair(F,a.id)?'fell back, not yet on the stair':'fell back'}
  return null}

// A Mage's blast (#745): one strike's dice against the hardest foe in the square; every foe inside takes it, a friend inside half a foe's blow.
function blast(g,F,a){const cr=g.crawl,room=roomsOf(g)[cr.i],aim=cr.aim&&cr.aim[a.id],c=aim||bestBlast(F,a.id);if(!c)return 'no foe in reach of a blast: held it';
  const B=blastAt(F,c);if(!B.foes.length)return 'the blast caught no foe';const L=B.foes.map(x=>foeAt(cr,x.key)),f=L.reduce((m,x)=>x.lvl>m.lvl?x:m,L[0]),d=ri(1,20),t=d+skill(a,cr,f),dc=CRAWL.DC+Math.floor(f.lvl/2);cr.stats.blows++;cr.stats.blasts=(cr.stats.blasts||0)+1;
  let res;if(d===1){(cr.open||(cr.open=[])).push(a.id);res='the blast went wide and left an opening'}else if(t<dc&&d<20)res='the blast went wide';
  else{const n=d===20?2:1;for(const x of L)x.hp-=n;res='the blast hit '+L.length+(L.length===1?' foe':' foes')}
  const burnt=[];for(const m of B.friends){const b=byId(m.id);if(!b||isDown(b))continue;b.hp-=Math.max(1,Math.round(maxHp(b)*hitOf(room,f,cr)*GEO.FRIENDLY));burnt.push(b.name);if(b.hp<=0)settle(g,room,cr,{t:b,down:true},{name:a.name+"'s blast"},[],[])}
  return res+(burnt.length?', and caught '+burnt.join(' and '):'')}
// The foes' turn, and what the round settles. Returns the sentence the scene ends on.
// With the rules on, a foe walks first (a guard's pull chooses who for), then strikes only what it reaches: a guard beside it first. o: {t, mul} a free blow.
function geoBlow(g,f,k,room,cr,o={}){const F=field(g),L=standing(g);if(!F||!L.length)return null;const key='f'+k,me=F.foes.find(x=>x.key===key);if(!me)return null;
  const front=cr.guard.map(byId).filter(x=>living(x)&&L.includes(x));let t=o.t||null,drawn=false;
  if(!t){const want=front.length&&rnd()<CRAWL.GUARD_DRAW?pickA(front):null,to=foeTile(F,me,want&&want.id);if(to)cr.pos[key]=to;
    if(me.fin){const dn=members(g).find(b=>isDown(b)&&adj(cr.pos[b.id],cr.pos[key]));if(dn){const d=ri(1,20),ac=10+Math.round(combatStats(dn).defense*20);if(d===20||(d!==1&&d+CRAWL.FOE_HIT+Math.floor(f.lvl/2)>=ac)){downHit(dn,{name:f.name},d===20);return {t:dn,dmg:0,fin:true}}return {t:dn,miss:true}}}
    const hid=cr.hid||[],all=blowsFrom(F,me).map(b=>byId(b.id)),T=all.filter(b=>!hid.includes(b.id));cr.hid=[];if(!T.length)return {idle:true};
    const by=front.filter(b=>T.includes(b)&&adj(cr.pos[b.id],cr.pos[key])),open=(cr.open||[]).map(byId).filter(x=>x&&T.includes(x)),rear=T.filter(x=>!cr.back.includes(x.id)),pool=rear.length?rear:T;
    if(by.length)t=pickA(by);else if(want&&T.includes(want))t=want;else t=pickA(open.length&&rnd()<.5?open:pool);drawn=front.includes(t)}
  const shot=!adj(cr.pos[t.id],cr.pos[key]),pen=!drawn&&!o.t&&guardOf(F,t.id)?GEO.GUARD_PEN:0;
  const ac=10+Math.round(combatStats(t).defense*20)+(shot&&inCover(F,t.id)?GEO.COVER:0),d=ri(1,20);
  if(d!==20&&(d===1||d+CRAWL.FOE_HIT+Math.floor(f.lvl/2)+pen<ac))return {t,miss:true};
  let dmg=maxHp(t)*hitOf(room,f,cr)*(.7+rnd()*.6)*(f.atk||1)*(o.mul||1)*(d===20?1.5:1);
  if(drawn)dmg*=GEO.GUARD_CUT;else dmg*=1-Math.min(.5,cr.shield*CRAWL.HOLD_CUT);
  dmg=Math.max(1,Math.round(dmg));t.hp-=dmg;return t.hp<=0?{t,dmg,down:true}:{t,dmg}}
function foeBlow(g,f,room,cr,rearguard){const L=standing(g);if(!L.length)return null; // the foes strike those standing; with nobody left it is the wipe
  const front=cr.guard.map(byId).filter(x=>living(x)&&L.includes(x)),open=(cr.open||[]).map(byId).filter(x=>living(x)&&L.includes(x));
  const rear=L.filter(x=>!cr.back.includes(x.id)),pool=rear.length?rear:L;
  let t=front.length&&rnd()<CRAWL.GUARD_DRAW?pickA(front):pickA(open.length&&rnd()<.5?open:pool),drawn=front.includes(t);
  const ac=10+Math.round(combatStats(t).defense*20),d=ri(1,20);
  if(d!==20&&(d===1||d+CRAWL.FOE_HIT+Math.floor(f.lvl/2)<ac))return {t,miss:true};
  let dmg=maxHp(t)*hitOf(room,f,cr)*(.7+rnd()*.6)*(f.atk||1)*(rearguard?CRAWL.RETREAT_HIT:1)*(d===20?1.5:1);
  if(drawn)dmg*=CRAWL.GUARD_CUT;else dmg*=1-Math.min(.5,cr.shield*CRAWL.HOLD_CUT);
  dmg=Math.max(1,Math.round(dmg));t.hp-=dmg;
  if(t.hp<=0){return {t,dmg,down:true}}return {t,dmg}}
// A crew member at zero: downed below ground (#654); a blow past full health is the end at once.
function settle(g,room,cr,r,f,fell,dn){if(!r.down||fell.includes(r.t)||dn.includes(r.t))return;const cause='felled by '+f.name+' in '+dunOf(g).name,rec='Fell in '+dunOf(g).name+', slain by '+f.name+'.';
  if(crawlDown(r.t,f,cause,rec)){dn.push(r.t);cr.stats.downs=(cr.stats.downs||0)+1;log(r.t,' went down in ',gd(room.name),' to '+f.name+'.')}
  else{fell.push(r.t);record(r.t,'Fell in ',gd(dunOf(g).name),', slain by '+f.name+'.');fall(r.t,cause);log(r.t,' fell in ',gd(room.name),' to '+f.name+'.')}}
function strikeBack(g,room,cr,rearguard){const out=[],geo=!rearguard&&field(g),foes=rearguard?[pickA(liveFoes(cr))]:liveFoes(cr),fell=[],dn=[];
  for(const f of foes){if(!f)continue;const r=geo?geoBlow(g,f,cr.foes.indexOf(f),room,cr):foeBlow(g,f,room,cr,rearguard);if(!r)break;if(r.idle)continue;
    settle(g,room,cr,r,f,fell,dn);out.push(r)}
  return {fell,dn,hits:out.filter(x=>!x.miss).length,misses:out.filter(x=>x.miss).length}}
// Free blows (#745): each foe a member stepped away from strikes once at GEO.FREE, unless a guard stands by the tile left or the one reached.
function freeBlows(g,room,cr){const fell=[],dn=[],L=(cr.free||[]).splice(0),F=L.length?field(g):null;if(!F)return {fell,dn,n:0};let n=0;
  for(const e of L){const f=foeAt(cr,e.foe),t=byId(e.id);if(!f||f.hp<=0||!living(t)||isDown(t))continue;if(guardOf(F,t.id)||guardOf(F,t.id,{x:e.x,y:e.y}))continue;
    const r=geoBlow(g,f,+e.foe.slice(1),room,cr,{t,mul:GEO.FREE});if(!r)continue;n++;cr.stats.free=(cr.stats.free||0)+1;settle(g,room,cr,r,f,fell,dn)}
  return {fell,dn,n}}
const goneDown=r=>r.dn.length?' '+r.dn.map(x=>x.name).join(' and ')+(r.dn.length>1?' go':' goes')+' down.':'';
function outcome(sc){const g=grp(sc);if(!g)return '';const cr=g.crawl,room=roomsOf(g)[cr.i];cr.stats.rounds++;let tail;
  const foes=liveFoes(cr);
  if(!foes.length){tail='The last of them goes down.';for(const b of members(g)){if(!isDown(b))heal(b,maxHp(b)*CRAWL.BREATH);gainXp(b,Math.round(clearXp(b)*CRAWL.ROOM_XP/roomsOf(g).length))} // the downed lie where they fell: only a heal brings them up
    if(sc.beats.some(b=>b.k==='retreat'))tail+=' Those who fell back come forward again.';
    if(cr.i+1>=roomsOf(g).length){cr.end='clear';cr.foes=null}
    else{cr.i++;cr.foes=null;cr.rd=0;cr.gap=CRAWL.GAP;tail+=' The way on is open.'}
    return tail}
  const fb=freeBlows(g,room,cr),freed=fb.n?(fb.n===1?' A free blow falls on one who stepped away.':' '+fb.n+' free blows fall on those who stepped away.')+goneDown(fb):'';
  const live=standing(g),F=field(g),out=id=>live.some(x=>x.id===id)&&(!F||atStair(F,id)); // the party leaves by the stair (#745)
  if(!live.length){cr.end='wiped';return foes.length+' of them stand over the fallen. Nobody is left on their feet.'} // the last one standing fell to a save or the poison
  if(cr.back.filter(out).length*2>=live.length){const r=strikeBack(g,room,cr,true);cr.end='retreat';
    tail=freed.trim()+(freed?' ':'')+'Most of the party falls back and the rest follow, up the stair'+(r.fell.length?'; the rearguard pays for it ('+r.fell.map(x=>x.name).join(', ')+' falls)':'')+(r.dn.length?'; '+r.dn.map(x=>x.name).join(' and ')+' must be carried':'')+'.';
    if(members(g).some(isDown)&&standing(g).length)tail+=' They carry the downed with them.';
    if(!standing(g).length)cr.end='wiped';return tail}
  const r=strikeBack(g,room,cr,false);
  tail=foes.length+' of them stand'+(foes.length===1?'s':'')+'.'+freed+' '+(r.hits+r.misses?r.hits+(r.hits===1?' blow lands, ':' blows land, ')+r.misses+(r.misses===1?' misses.':' miss.'):'')+(r.fell.length?' '+r.fell.map(x=>x.name).join(' and ')+' falls.':'')+goneDown(r);
  if(!standing(g).length){cr.end='wiped';return tail}
  cr.rd++;if(cr.rd>=(room.alvl!=null&&cr.cap?cr.cap:room.rounds||CRAWL.ROUNDS)){cr.end='retreat';cr.driven=true;tail+=' They cannot win this room; the party is driven back up the stair.'}
  return tail}

setSceneKind('crawl',{options,reflex,apply,outcome,view,move:moveOf,place:placeMove,spotOf});

// ---- the driver, once per step while the group is inside (called from dungeon.js dungeonCheck) ----
function leave(g){const D=dunOf(g);for(const a of g.mem){a.hidden=false;Object.assign(a,standAt(D.x+(rnd()-.5)*1.5,D.y+.5+rnd()*.6))}}
const endGroup=g=>{if(g.site!=null){const D=siteById(g.site);if(D)D.group=null}else CRYPT.group=null};
const whoOf=g=>{const C=g.crawl&&companyById(g.crawl.co);return {t:g.name||(C?C.name:'The company'),c:'f'+g.fac}};
function finish(g){const cr=g.crawl,who=whoOf(g),st=cr.stats;leave(g);
  if(cr.end!=='clear')for(const a of crewOf(g))if(leftBehind(a))log(a,' could not be carried up the stair and died below.'); // driven back or withdrawing: the bleeding may be left (DOWN.CRAWL_LEFT, #269)
  if(g.site!=null){if(SITE_END)SITE_END(g,cr.end==='clear'?'clear':cr.driven?'driven':'withdrawn');for(const a of g.mem)toWorld(a);tally(cr.end==='clear'?'clears':cr.driven?'driven':'withdrawn',g,cr);endGroup(g);return st}
  if(cr.end==='clear'){log(who,' cleared ',gd(CRYPT.name),' room by room and destroyed ',gd(CRYPT.boss),'!');
    if(first('crypt:f'+g.fac))timeline('crypt',who,' cleared ',gd(CRYPT.name),' for the first time.');
    payClear(g,CRAWL.CLEAR_BONUS)}
  else{const names=g.mem.filter(living); // the fill-ins too
    log(who,cr.driven?' were driven back from ':' withdrew from ',gd(CRYPT.name),' with the ',gd(roomsOf(g)[cr.i].name),' unbeaten.');
    for(const a of names){record(a,cr.driven?'Driven back from ':'Withdrew from ',gd(CRYPT.name),'.');goHome(a)}}
  for(const a of g.mem)toWorld(a); // the downed come up the stair carried, still bleeding: the world's helpers take over (#654)
  tally(cr.end==='clear'?'clears':cr.driven?'driven':'withdrawn',g,cr);
  CRYPT.group=null;return st}
// Called when the group has no one left (everyone fell): the wipe, at the table's dice.
export function crawlLost(g){const who=whoOf(g),D=dunOf(g);
  for(const a of crewOf(g))bleedOut(a); // nobody stands to carry them: the downed die where they lie (#654)
  for(const a of g.mem)if(living(a)){a.hidden=false;Object.assign(a,standAt(D.x+(rnd()-.5)*1.5,D.y+.5+rnd()*.6));record(a,'Came up the stair alone from ',gd(D.name),'.');goHome(a)} // fill-ins who rode along with a crew that fell
  log(who,' was lost in ',gd(D.name),'. No one came back up the stair.');timeline('death',who,' was lost in ',gd(D.name),' to the last man.');
  if(g.site!=null&&SITE_END)SITE_END(g,'wiped');
  tally('wipes',g,g.crawl)}
// The Fellowship's crawl record (slotted().crawl: runs, clears, driven back, withdrawn, wipes, deaths, rooms won), for the sim summary and the checks.
// A hero of a company with a crawl running holds its reflection moments; the end of the run raises one combined moment per survivor.
setReflectHold(a=>{const gs=[CRYPT.group,...((S.sites&&S.sites.list)||[]).map(s=>s.group)];return gs.some(g=>g&&g.crawl&&g.mem&&g.mem.includes(a))});
function tally(k,g,cr){for(const a of crewOf(g))if(living(a))moment(a,'crawl',k==='clears'?'cleared':k==='driven'?'driven back':'withdrew');const F=companyById(cr.co)||slotted();if(!F)return;const C=F.crawl||(F.crawl={runs:0,clears:0,driven:0,withdrawn:0,wipes:0,deaths:0,rooms:0,scenes:0});
  C.runs++;C[k]++;C.scenes=(C.scenes||0)+cr.stats.rounds;C.downs=(C.downs||0)+(cr.stats.downs||0); /* downings below ground (#654) */for(const x of ['strikes','walks','flanks','free','blasts','tendWalks'])if(cr.stats[x])C[x]=(C[x]||0)+cr.stats[x]; /* what the tiles did (#745) */C.rooms+=cr.end==='clear'?roomsOf(g).length:cr.i;C.deaths+=(cr.crew!=null?cr.crew:g.mem0)-members(g).length}
export function crawlTick(g,dt){const cr=g.crawl;
  if(g.site!=null?sceneFor(companyById(cr.co)):S.table)return; // a scene (the stair, or a room) is open: the table runs it (a site: its company's scene)
  if(!g.tSite)return;                                 // the stair scene (sim/table.js tableTick) comes first
  if(cr.end==='wiped'){crawlLost(g);endGroup(g);return}
  if(cr.end){finish(g);return}
  if(cr.gap>0){cr.gap-=dt;return}
  if(!standing(g).length){crawlLost(g);endGroup(g);return}
  const sc=openRound(g);if(!sc)return;
}
setCrawlHook({start:startCrawl,tick:crawlTick,lost:crawlLost});
