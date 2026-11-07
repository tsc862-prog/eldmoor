// Open-world positions (#746, slice 4 of #140's named positions): a fight in the open plays on the real map. When an elite, an ambush, a
// rescue with a foe in it or Kragmaw opens a scene, the patch of map round the anchor is frozen (GEO.PATCH tiles, clamped to the map) and
// made into the same grid a crawl room has (sim/roomgrid.js), so the same words, moves and rules (sim/geometry.js) play on it.
// Tiles under names: the agent says "the road back", "the trees", "beside Kerin"; nobody needs a coordinate.
//
// The ground counts. Solid ground (passable.js) is what nobody stands on; a wall, a rock or a stand of forest also stops a shot, while the
// river and lava do not. Swamp and snow are slow tiles (a step costs FIELD.SLOW), the river's open tiles cost FIELD.BANK, the whole
// round's walk, so nobody crosses the bank in a round. Trees and rocks are cover, tile by tile. A road or a bridge is a line: the way
// back follows it and it gets a name of its own.
//
// Everyone stands where the sim had them, on the nearest free tile; a foe the DM brought in from an edge (stage_scene edge) stands there.
// A tile is always written to the entity's own x, y, so the scene view (the world renderer, render/sceneview.js) shows it as it happens and
// the world simply goes on from there when the scene ends: a hero who retreated is a few tiles down the road. Kragmaw alone keeps its
// place in the world; its tile is only where it reaches from.
//
// A fight with no agent deciding is untouched (patchFits): no patch, the old rounds, so npm run sim and the seeded hashes do not move.
// FIELD.ALL plays those on a patch too, for balance runs (ELDMOOR_PATCH=all in scripts/headless.mjs). All of this is plain data on
// sc.fp, so a save mid-scene resumes; the grid is rebuilt from it. Nothing here rolls a die: the dice stay in sim/tableround.js.
import {W,H,TREE,ROCK,SWAMP,RIVER,SNOW,ROAD,BRIDGE} from '../world/tiles.js';
import {tiles,I} from '../world/map.js';
import {solidWhy} from '../world/passable.js';
import {CLS} from '../data/classes.js';
import {MOVES} from '../data/moves.js';
import {S} from './state.js';
import {onWorld} from './kept.js';
import {rebuild} from './spatial.js';
import {blk} from './mobs.js';
import {condOn} from './eff.js';
import {DOWN,isDown,finisher} from './downed.js';
import {POS,aliasSpots,bfs,cheb,moveNames,nearFree,resolveMove,roomWords,spotAt,spotWord} from './roomgrid.js';
import {GEO,adj,blowsFrom,canBeside,consequences,foeTile,guardOf,inCover,leaving,shoots,targetOf,tileFor,within} from './geometry.js';

export const FIELD={
  ON:true,       // false: every open-world scene plays as before #746
  ALL:false,     // true: a fight with no agent deciding plays on a patch too (balance runs only)
  SLOW:2,        // what a step on swamp or snow costs of a round's walk
  BANK:3,        // ... on an open river tile: the whole walk, so nobody crosses the bank in a round
  BOSS_REACH:2,  // tiles Kragmaw's claw reaches from where it lies
};
const EDGES=['north','south','east','west','road'];
export const edgeOf=v=>{const s=String(v==null?'':v).trim().toLowerCase();return EDGES.includes(s)?s:null};
export const EDGE_NAMES=EDGES;
const NONE=new Set();
const N4=[[1,0],[-1,0],[0,1],[0,-1]];
const cl=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const byId=id=>S.agents.find(x=>x.id==id)||null;

// ---- the ground ----
// One tile of the map, read for a fight: {ok, see, cost, wet, cover, road (1 a road, 2 a bridge), river (water that bounds it)}.
function ground(X,Y){const t=tiles[I(X,Y)],why=solidWhy(X,Y),open=!why,hard=(x,y)=>{const w=solidWhy(x,y);return w==='forest'||w==='rock'};
  return {ok:open,see:open||why==='river'||why==='lava',cost:!open?1:t===RIVER?FIELD.BANK:t===SWAMP||t===SNOW?FIELD.SLOW:1,wet:open&&(t===RIVER||t===SWAMP),river:why==='river'||t===RIVER,
    cover:open&&(t===TREE||t===ROCK||N4.some(([dx,dy])=>hard(X+dx,Y+dy))),tree:t===TREE,road:!open?0:t===BRIDGE?2:t===ROAD?1:0}}
// Is this world point in cover? (A trap's save, and anything else that asks without a patch.)
export const coverAt=(x,y)=>ground(Math.floor(x),Math.floor(y)).cover;

function build({ox,oy,w,h,pt,dn}){const n=w*h,ok=new Uint8Array(n),see=new Uint8Array(n),cost=new Uint8Array(n),wet=new Uint8Array(n),cover=new Uint8Array(n),road=new Uint8Array(n),water=new Uint8Array(n);
  let trees=0,rocks=0,slow=false;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const k=y*w+x,g=ground(ox+x,oy+y);ok[k]=g.ok?1:0;see[k]=g.see?1:0;cost[k]=g.cost;wet[k]=g.wet?1:0;road[k]=g.road;water[k]=g.river?1:0;
    if(g.cover){cover[k]=1;if(g.tree)trees++;else rocks++}if(g.ok&&g.cost===FIELD.SLOW)slow=true}
  const G={w,h,ok,wet,see,cost,cover,ox,oy,spots:{},own:[],alias:{},word:{},coverWord:trees>=rocks?'trees':'rocks',fw:[1,0],sd:[0,1],ax:1,ay:0,px:0,py:1},at=k=>({x:k%w,y:Math.floor(k/w)});
  // the party's side of the ground: only what they can walk to is named for them
  const from=ok[pt.y*w+pt.x]?pt:nearFree({w,h,ok},NONE,pt.x,pt.y),D=bfs(G,from.x,from.y,NONE),mine=new Uint8Array(n);for(let k=0;k<n;k++)if(ok[k]&&D[k]>=0)mine[k]=1;
  const used=new Set(),take=(id,t)=>{G.spots[id]={x:t.x,y:t.y};used.add(t.y*w+t.x)},free=(x,y)=>nearFree({w,h,ok:mine},used,x,y);
  take('den',nearFree({w,h,ok},used,dn.x,dn.y));const den=G.spots.den;
  // the way back: the far end of their side from the foes, by the road if one runs here, at the patch's edge if it can be
  let back=-1,bs=-1e9;for(let k=0;k<n;k++){if(!mine[k]||used.has(k))continue;const t=at(k),s=cheb(t,den)*2+(road[k]?3:0)+(t.x===0||t.y===0||t.x===w-1||t.y===h-1?2:0);if(s>bs){bs=s;back=k}}
  const A=back<0?from:at(back);take('stair',A);G.word.stair=back>=0&&road[back]?'road back':'way back';
  let ax=den.x-A.x,ay=den.y-A.y,L=Math.hypot(ax,ay);if(L<.5){ax=1;ay=0;L=1}else{ax/=L;ay/=L}
  const px=-ay,py=ax,half=Math.min(3,Math.max(1.5,Math.abs(px)*(w/2-.5)+Math.abs(py)*(h/2-.5)));Object.assign(G,{ax,ay,px,py,fw:[Math.round(ax),Math.round(ay)],sd:[Math.round(px),Math.round(py)]});
  for(const [id,u,v] of [['front',.5,0],['back',.16,0],['flankL',.74,-.9],['flankR',.74,.9]])take(id,free(Math.round(A.x+ax*L*u+px*half*v),Math.round(A.y+ay*L*u+py*half*v)));
  // the named things of this ground: the nearest cover, the road, the bridge, the bank
  const nearest=test=>{let b=-1,bd=1e9;for(let k=0;k<n;k++){if(!mine[k]||used.has(k)||!test(k))continue;const d=cheb(at(k),from)+(cheb(at(k),den)<2?3:0);if(d<bd){bd=d;b=k}}return b<0?null:at(b)};
  {const t=nearest(k=>cover[k]);if(t)take('cover',t)}
  const beside=k=>{const t=at(k);return N4.some(([dx,dy])=>{const x=t.x+dx,y=t.y+dy;return x>=0&&y>=0&&x<w&&y<h&&water[y*w+x]&&!ok[y*w+x]})};
  for(const [id,test] of [['road',k=>road[k]===1],['bridge',k=>road[k]===2],['bank',beside]]){const t=nearest(test);if(t){take(id,t);G.own.push(id)}}
  G.names=['front','flankL','flankR','back',...(G.spots.cover?['cover']:[]),'stair',...G.own];aliasSpots(G);G.alias.tree=G.alias.trees=G.alias.rock=G.alias.rocks=G.alias.boulder=G.alias.boulders='cover';
  // what the ground means, said once
  const note=[];if(water.some(x=>x))note.push('The river bounds this ground: nobody crosses its bank in a round, though a shot does.');if(slow)note.push('Swamp and snow are slow: a step there costs '+FIELD.SLOW+' of your '+POS.STEP+'.');G.note=note.join(' ');
  return G}
const cache=new Map();
onWorld(()=>{cache.clear()},()=>({patchGrids:cache.size})); // another map (#1013): the same numbers on other ground
// The grid of a frozen patch: a pure function of the numbers on sc.fp, so a restored scene gets the same one back.
export function patchGrid(P){const key=[P.ox,P.oy,P.w,P.h,P.pt.x,P.pt.y,P.dn.x,P.dn.y].join();let G=cache.get(key);if(G)return G;G=build(P);if(cache.size>=16)cache.delete(cache.keys().next().value);cache.set(key,G);return G}

// ---- who stands where ----
const foeEnt=r=>r.kind==='boss'?S.boss:r.kind==='hero'?byId(r.id):S.mobs.find(m=>m.id===r.id)||null;
const up=e=>!!e&&(e.kind==='hero'?e.state!=='dead':e.alive!==false&&!e.gone);
const keyOf=(P,f)=>{const r=P.foes.find(x=>foeEnt(x)===f);return r?r.key:null};
// A tile written to the world: the entity stands there now (Kragmaw never moves in the world).
function put(P,e,t){if(e.kind==='boss')return;e.x=P.ox+t.x+.5;e.y=P.oy+t.y+.5;rebuild()}
const centre=(L,P)=>{let x=0,y=0;for(const e of L){x+=e.x;y+=e.y}return {x:cl(Math.floor(x/L.length)-P.ox,0,P.w-1),y:cl(Math.floor(y/L.length)-P.oy,0,P.h-1)}};
// The tile a foe coming from an edge starts on. road: the road's end farthest from the party, the party's far side when none runs here.
function edgeTile(P,edge){const {w,h}=P;if(edge==='north')return {x:w>>1,y:0};if(edge==='south')return {x:w>>1,y:h-1};if(edge==='west')return {x:0,y:h>>1};if(edge==='east')return {x:w-1,y:h>>1};
  let b=null,bd=-1;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const g=ground(P.ox+x,P.oy+y),d=cheb({x,y},P.pt);if(g.road&&d>bd){bd=d;b={x,y}}}return b||{x:w-1-P.pt.x,y:h-1-P.pt.y}}

// Does this fight play on a patch? Only with an agent deciding, or for a balance run (FIELD.ALL).
export const patchFits=decide=>FIELD.ON&&GEO.ON&&(FIELD.ALL||decide);
// Freeze the ground and stand everyone on it. L: the members in the fight, in order; foes: the entities; an: the anchor {x, y}; nameOf: a foe's name.
export function openPatch(sc,L,foes,an,nameOf){if(!foes.length||!L.length||!an)return false;const [w,h]=GEO.PATCH,ox=cl(Math.floor(an.x)-(w>>1),0,W-w),oy=cl(Math.floor(an.y)-(h>>1),0,H-h),edge=edgeOf(sc.ctx&&sc.ctx.edge);
  const P={ox,oy,w,h,pt:null,dn:null,pos:{},guard:[],free:[],foes:foes.map(f=>({key:'f'+(f.id!=null?f.id:'boss'),kind:f.kind==='boss'?'boss':f.kind==='hero'?'hero':'mob',id:f.id,name:nameOf(f)})),st:{strikes:0,walks:0,flanks:0,free:0,closes:0}};
  P.pt=centre(L,P);P.dn=edge?edgeTile(P,edge):centre(foes,P);const G=patchGrid(P),used=new Set(),seat=(key,x,y)=>{const t=nearFree(G,used,x,y);P.pos[key]={x:t.x,y:t.y};used.add(t.y*w+t.x);return t};
  const local=e=>({x:cl(Math.floor(e.x)-ox,0,w-1),y:cl(Math.floor(e.y)-oy,0,h-1)});
  for(const a of L){const t=local(a);put(P,a,seat(a.id,t.x,t.y))}
  P.foes.forEach((r,i)=>{const f=foes[i],t=edge?P.dn:local(f);put(P,f,seat(r.key,t.x,t.y))});
  sc.fp=P;if(S.patchStats)S.patchStats.scenes++;else S.patchStats={scenes:1,strikes:0,walks:0,flanks:0,free:0,closes:0};return true}
// The ground as the rules read it (sim/geometry.js) and as a member reads it (sim/roomgrid.js R): one object does both.
export function fieldOf(sc,a){const P=sc.fp,out=sc.out||[],me=a&&a.id;
  const mates=sc.ids.map(byId).filter(b=>b&&b.state!=='dead'&&P.pos[b.id]&&!out.includes(b.id)).map(b=>({id:b.id,name:b.name,down:isDown(b)}));
  const foes=[];for(const r of P.foes){const e=foeEnt(r);if(!up(e)||!P.pos[r.key])continue;
    foes.push({key:r.key,name:r.name,role:r.kind==='mob'?blk(e).role:r.kind==='hero'?(shoots(e.cls)?'caster':'skirmisher'):'guardian',fin:finisher(e),boss:r.kind==='boss',...(r.kind==='boss'?{reach:FIELD.BOSS_REACH}:{})})}
  return {G:patchGrid(P),cr:P,pos:P.pos,guards:P.guard,me,mates,foes}}
export const onPatch=(sc,a)=>!!(sc&&sc.fp&&sc.fp.pos[a.id]);
// A hero's tile changes: each foe it walks out of the reach of owes a free blow, struck before its next act lands (tableround.js freeBlows).
function walk(sc,a,to){const P=sc.fp,F=fieldOf(sc,a),p=P.pos[a.id];for(const f of leaving(F,p,to))P.free.push({id:a.id,foe:f.key,x:p.x,y:p.y,tx:to.x,ty:to.y});P.pos[a.id]={x:to.x,y:to.y};put(P,a,to)}
// An ability that moved its user in the world (a blink): the tile follows when it can stand there, else the hero is put back.
export function patchSync(sc,a){const P=sc.fp,p=P&&P.pos[a.id];if(!p||a.state==='dead'||(sc.out||[]).includes(a.id))return;const x=Math.floor(a.x)-P.ox,y=Math.floor(a.y)-P.oy;if(x===p.x&&y===p.y)return;
  const G=patchGrid(P),free=x>=0&&y>=0&&x<P.w&&y<P.h&&G.ok[y*P.w+x]&&!Object.values(P.pos).some(q=>q.x===x&&q.y===y);if(free)P.pos[a.id]={x,y};put(P,a,P.pos[a.id])}
export function closePatch(sc){const P=sc.fp;if(!P)return;P.free=[];const T=S.patchStats;if(T)for(const k in P.st)T[k]=(T[k]||0)+P.st[k]}

// ---- a member's act ----
const moveRanged=(a,M)=>M&&typeof M.range==='number'?M.range>=GEO.SHOT_MIN:shoots(a.cls);
// What the tiles make of an act, before the table plays it: {stop: the beat's result, when it cannot land} or {foe, mod} for one aimed at a foe.
// o: {lo (the companion a heal or a potion goes to), bleed (the one to stabilize), on (who an item from the pack goes to)}. With a move given,
// or rooted, nobody walks; an agent otherwise walks only when the act needs it, a reflex goes where its act wants it (as in the crawl).
export function patchAct(sc,a,act,o={}){const P=sc.fp,k=act.k,M=MOVES[k],pos=P.pos,rooted=condOn(a,'root'),walks=!act.moved&&!rooted,ag=act.by==='agent';if(!pos[a.id])return {};
  P.guard=P.guard.filter(id=>id!==a.id); // a guard holds until its holder's next act
  const go=(kk,opt)=>{if(!walks)return;const to=tileFor(fieldOf(sc,a),a.id,kk,opt);if(to)walk(sc,a,to)};
  if(k==='strike'||(M&&M.target==='foe')){const ranged=moveRanged(a,M);let T=targetOf(fieldOf(sc,a),a.id,ranged);if(!T)return {stop:'no foe stands'};
    if(!ag||!T.reach.ok)go('strike',{ranged});T=targetOf(fieldOf(sc,a),a.id,ranged);P.st.strikes++;
    if(!T.reach.ok){P.st.walks++;return {stop:(rooted?'rooted: ':'')+'out of reach of '+T.foe.name+(rooted?'':': walked toward it')}}
    if(T.flank.bonus)P.st.flanks++;return {foe:foeEnt(P.foes.find(r=>r.key===T.foe.key)),mod:T.flank.bonus+T.reach.pen}}
  const reachTo=(t,kk,range)=>{if(!t||t===a||!pos[t.id])return null;const near=()=>range?within(pos[a.id],pos[t.id],range):adj(pos[a.id],pos[t.id]);if(!near())go(kk,{to:t.id,range});return near()?null:{stop:t.name+' is out of reach'+(rooted?'':': walked toward them')}};
  if(k==='heal'||(M&&M.target==='ally'))return reachTo(o.lo,'heal',M?M.range:DOWN.HEAL_RANGE)||{};
  if(k==='potion')return reachTo(o.lo,'potion')||{};
  if(k==='stabilize')return reachTo(o.bleed,'stabilize')||{};
  if(k.startsWith('use:'))return reachTo(o.on,'potion')||{};
  if(k==='guard'){go('guard',{});P.guard.push(a.id);return {}}
  if(k==='retreat')go('retreat',{});
  return {}}

// ---- a foe's turn ----
// It walks first (toward whoever it was drawn to, else by its kind's tactics), then strikes only what it reaches.
export function foeStep(sc,f){const P=sc.fp,key=keyOf(P,f);if(!key||condOn(f,'root'))return;const F=fieldOf(sc),me=F.foes.find(x=>x.key===key);if(!me)return;
  const to=foeTile(F,me,f.target&&f.target.kind==='hero'&&P.pos[f.target.id]?f.target.id:null);if(to){P.pos[key]=to;put(P,f,to)}}
export function foeReaches(sc,f,t){const P=sc.fp,key=keyOf(P,f);return !!key&&adj(P.pos[key],P.pos[t.id])}
// Whom a foe can strike: a guard beside it first, else everyone it reaches.
export function foeTargets(sc,f,L){const P=sc.fp,key=keyOf(P,f),F=fieldOf(sc),me=F.foes.find(x=>x.key===key);if(!me)return [];const ids=blowsFrom(F,me).map(b=>b.id),T=L.filter(b=>ids.includes(b.id));
  const g=T.filter(b=>P.guard.includes(b.id)&&adj(P.pos[b.id],P.pos[key]));return g.length?g:T}
// What the ground does to a blow: {adj: on the roll, mul: on the damage}. A shot at one in cover, one who stands by a guard, a guard taking it.
export function blowMods(sc,f,t){const P=sc.fp,key=keyOf(P,f),F=fieldOf(sc),shot=!adj(P.pos[key],P.pos[t.id]),guard=P.guard.includes(t.id);
  return {adj:(shot&&inCover(F,t.id)?-GEO.COVER:0)+(!guard&&guardOf(F,t.id)?GEO.GUARD_PEN:0),mul:guard?GEO.GUARD_CUT:1}}
export const closed=sc=>{sc.fp.st.closes++};
// The free blows owed: [{f, t}], those a guard covers (by the tile left or the tile reached) let off.
export function freeOwed(sc){const P=sc.fp,L=P.free.splice(0);if(!L.length)return [];const F=fieldOf(sc),out=[];
  for(const e of L){const r=P.foes.find(x=>x.key===e.foe),f=r&&foeEnt(r),t=byId(e.id);if(!up(f)||!t||t.state==='dead'||isDown(t))continue;if(guardOf(F,t.id,{x:e.x,y:e.y})||guardOf(F,t.id,{x:e.tx,y:e.ty}))continue;P.st.free++;out.push({f,t})}
  return out}

// ---- what a member reads ----
export const strikeWords=(sc,a)=>{const T=targetOf(fieldOf(sc,a),a.id,shoots(a.cls));if(!T)return null;const r=T.reach;return 'Strike '+T.foe.name+(r.ok?(T.flank.bonus?' (flanked: +'+T.flank.bonus+')':r.pen?' (a friend in your line: '+r.pen+')':''):' (out of reach: you walk toward it)')};
export const retreatWords=sc=>'Fall back along the '+spotWord(patchGrid(sc.fp),'stair');
export const canTend=(sc,a,t)=>!onPatch(sc,a)||!onPatch(sc,t)||t===a||canBeside(fieldOf(sc,a),a.id,t.id);
// The hooks scene_act and tableView read (table.js kindOf): the same four a crawl gives.
export const PATCH_KIND={
  move(sc,a,text){if(!onPatch(sc,a))return {error:'You have no place on this ground.'};if(condOn(a,'root'))return {error:'You are rooted and cannot move.'};return resolveMove(fieldOf(sc,a),text)},
  place(sc,a,mv){walk(sc,a,mv)},
  view(sc,a){if(!onPatch(sc,a)||(sc.out||[]).includes(a.id))return {};const F=fieldOf(sc,a),can=!sc.acts[a.id]&&!isDown(a)&&sc.phase!=='outcome'&&!condOn(a,'root'),bl=F.mates.find(b=>b.down&&b.id!==a.id&&!byId(b.id).down.stable),
      rules=consequences(F,a.id,{ranged:shoots(a.cls),down:bl?{id:bl.id,name:bl.name}:null});
    return {room:[roomWords(F,can),F.G.note,...rules].filter(Boolean).join(' '),...(can?{moves:moveNames(F)}:{})}},
  spotOf(sc,a){const P=sc.fp,p=P.pos[a.id];if(!p)return null;const G=patchGrid(P),s=spotAt(G,p.x,p.y);return s?spotWord(G,s):null},
};
