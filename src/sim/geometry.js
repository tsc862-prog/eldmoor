// Rules from geometry (#745, slice 3 of #140's named positions): where people stand decides what a blow may do, so "flank" and
// "guard" mean one thing in every room. One resolver, pure over plain data: nothing here rolls a die, writes a position or knows
// what a crawl is; a scene builds a field and reads the answers (sim/crawl.js below ground, sim/patch.js on the open map, #746). The dice stay the
// caller's: these are the modifiers on them, the tiles people walk to and the room's consequences in words. No coordinates in words.
//   A field F: {G (a grid of sim/roomgrid.js: w, h, ok, spots), pos ({key: {x, y}}), mates [{id, name, down}], foes [{key, name, role,
//   fin (strikes the downed), boss (keeps its den)}], guards [hero ids drawing the foes this round]}. A key is a hero id or a foe's key.
//   adj, within, shoots, foeShoots             who touches whom, who fights at range
//   lineOf, reachOf, targetOf                  a clear line, a strike's reach and the foe it goes to
//   flankOf, guardOf, inCover, leaving         the modifiers: flank, a guard's cover, a cover spot, the foes a step leaves behind
//   wardOf, blastAt, bestBlast                 who a ward reaches, what a blast square holds, the best square for a reflex
//   blowsFrom, foeTile                         whom a foe can reach, where it goes (the scripted tactics)
//   tileFor, canBeside                         where a hero's reflex walks for an act
//   atStair, consequences                      the way out, and the room's rules for one member in short sentences
import {CLS} from '../data/classes.js';
import {ROLES} from '../data/bestiary.js';
import {POS,bfs,cheb,gridOn,spotAt} from './roomgrid.js';

export const GEO={
  ON:true,       // false: the scene plays as before #745 (positions kept, no rule reads them)
  RANGE:6,       // tiles a shot reaches along a clear line
  LINE_PEN:-2,   // a friend on the line of a shot
  FLANK:2,       // two on opposite sides of a foe, or three around it: on each of their strikes
  GUARD_PEN:-2,  // a foe's blow on a member beside a guard (not the guard itself)
  GUARD_CUT:.7,  // a blow on the guard lands at this share: with the tiles it takes every blow beside it, so it cuts less than CRAWL.GUARD_CUT
  COVER:2,       // Defense in cover against shots, and on trap saves
  FRIENDLY:.5,   // a friend inside a blast takes this share of a foe's blow
  BLAST_R:1,     // the square a blast hits: this many tiles round its centre
  WARD_R:2,      // tiles a ward reaches from whoever speaks it
  FREE:.5,       // a free blow on one who steps out of a foe's reach, as a share of its blow
  FOE_STEP:3,    // tiles a foe goes in a round
  STAIR_R:1,     // on the stair: this near its tile (it holds one, and they leave by it in turn)
  SHOT_MIN:2,    // a class or role with this reach or more fights at range (CLS range, ROLES reach)
  PATCH:[9,7],   // the tiles of world map an open-world scene freezes round its anchor (#746, sim/patch.js)
};

const P=(F,k)=>F.pos[k];
// Can a shot pass this tile? A wall or a pillar stops it; on the open map water and fire do not, though nobody stands on them (G.see, #746).
const seeOn=(G,x,y)=>G.see?x>=0&&y>=0&&x<G.w&&y<G.h&&!!G.see[y*G.w+x]:gridOn(G,x,y);
const standing=F=>F.mates.filter(b=>!b.down&&F.pos[b.id]);
const liveFoes=F=>F.foes.filter(f=>F.pos[f.key]);
export const adj=(p,q)=>!!p&&!!q&&cheb(p,q)===1;
export const within=(p,q,n)=>!!p&&!!q&&cheb(p,q)<=n;
export const shoots=cls=>!!CLS[cls]&&CLS[cls].range>=GEO.SHOT_MIN;
export const foeShoots=f=>!!(ROLES[f.role]&&ROLES[f.role].reach>=GEO.SHOT_MIN);

// ---- lines ----
// Every tile between two tiles, one a step along the longer axis.
function between(p,q){const n=cheb(p,q),o=[];for(let i=1;i<n;i++)o.push({x:Math.round(p.x+(q.x-p.x)*i/n),y:Math.round(p.y+(q.y-p.y)*i/n)});return o}
// {clear: no wall or pillar in the way, friend: the name of someone standing on it}. A friend stops no shot, it spoils it.
export function lineOf(F,p,q,me){let friend=null;for(const t of between(p,q)){if(!seeOn(F.G,t.x,t.y))return {clear:false,friend:null};
    if(!friend){const b=standing(F).find(x=>x.id!==me&&P(F,x.id).x===t.x&&P(F,x.id).y===t.y);if(b)friend=b.name}}
  return {clear:true,friend}}
// Can a strike from tile p reach tile q? {ok, pen (the line's), how: 'adjacent' | 'shot', friend?}.
export function reachOf(F,p,q,ranged,me){if(adj(p,q))return {ok:true,pen:0,how:'adjacent'};if(!ranged||cheb(p,q)>GEO.RANGE)return {ok:false,pen:0};
  const L=lineOf(F,p,q,me);if(!L.clear)return {ok:false,pen:0};return {ok:true,pen:L.friend?GEO.LINE_PEN:0,how:'shot',...(L.friend?{friend:L.friend}:{})}}

// ---- flank and guard ----
// A striker beside a foe flanks it with one who stands across from them, or as one of three around it. {bonus, with: [names]}.
export function flankOf(F,me,fk,at){const p=at||P(F,me),q=P(F,fk),none={bonus:0,with:[]};if(!adj(p,q))return none;
  const by=standing(F).filter(b=>b.id!==me&&adj(P(F,b.id),q)),dx=p.x-q.x,dy=p.y-q.y;
  const across=by.filter(b=>{const t=P(F,b.id);return dx*(t.x-q.x)+dy*(t.y-q.y)<0});
  if(across.length)return {bonus:GEO.FLANK,with:across.map(b=>b.name)};return by.length>=2?{bonus:GEO.FLANK,with:by.map(b=>b.name)}:none}
// Is a foe caught between two or among three, whoever they are? (A named boss leaves its den for that.)
function hemmed(F,fk){const q=P(F,fk),by=standing(F).filter(b=>adj(P(F,b.id),q));if(by.length>=3)return true;
  return by.some(a=>by.some(b=>{const s=P(F,a.id),t=P(F,b.id);return a!==b&&(s.x-q.x)*(t.x-q.x)+(s.y-q.y)*(t.y-q.y)<0}))}
// The guard beside a member (never the member itself): its cover against free blows and the foes' aim. Null: nobody.
export function guardOf(F,me,at){const p=at||P(F,me);for(const id of F.guards||[]){if(id==me)continue;const b=F.mates.find(x=>x.id==id);if(b&&!b.down&&adj(P(F,id),p))return b}return null}
export const inCover=(F,me)=>{const p=P(F,me);return !!p&&(F.G.cover?!!F.G.cover[p.y*F.G.w+p.x]:spotAt(F.G,p.x,p.y)==='cover')}; // on the open map every tree and rock is cover (#746)
// The foes a step from one tile to another walks out of: each has its free blow.
export const leaving=(F,from,to)=>liveFoes(F).filter(f=>adj(from,P(F,f.key))&&!adj(to,P(F,f.key)));

// ---- ward and blast ----
export const wardOf=(F,me)=>standing(F).filter(b=>within(P(F,me),P(F,b.id),GEO.WARD_R));
export function blastAt(F,c){const r=GEO.BLAST_R;return {foes:liveFoes(F).filter(f=>within(c,P(F,f.key),r)),friends:standing(F).filter(b=>within(c,P(F,b.id),r))}}
// The square that catches most foes and fewest friends from where a caster stands. {x, y, foes, friends} or null.
export function bestBlast(F,me){const G=F.G,p=P(F,me);let top=null,bs=0;
  for(let y=0;y<G.h;y++)for(let x=0;x<G.w;x++){const c={x,y};if(!gridOn(G,x,y)||cheb(c,p)>GEO.RANGE||!lineOf(F,p,c,me).clear)continue;const B=blastAt(F,c);if(!B.foes.length)continue;
    const s=B.foes.length*3-B.friends.length*4+1;if(s>bs){bs=s;top={x,y,...B}}}
  return top}

// ---- who a strike goes to ----
// The foe a strike from tile p falls on: one in reach, a flanked one first, else the nearest; {foe, reach, flank}. Null: no foe stands.
export function targetOf(F,me,ranged,at){const p=at||P(F,me);let b=null,bs=-1e9;
  for(const f of liveFoes(F)){const q=P(F,f.key),r=reachOf(F,p,q,ranged,me),k=flankOf(F,me,f.key,p),s=(r.ok?1000:0)+k.bonus*50+r.pen*10-cheb(p,q);if(s>bs){bs=s;b={foe:f,reach:r,flank:k}}}
  return b}

// ---- walking ----
const idx=(F,t)=>t.y*F.G.w+t.x;
function held(F,me){const taken=new Set(),foes=new Set();
  for(const b of F.mates){if(b.id==me||!P(F,b.id))continue;taken.add(idx(F,P(F,b.id)))}
  for(const f of liveFoes(F)){if(f.key===me)continue;const k=idx(F,P(F,f.key));taken.add(k);foes.add(k)}
  return {taken,foes}}
// The tiles one can stand on after a walk of n: a hero passes companions and no foe, a foe passes nobody.
function walks(F,me,n,isFoe){const p=P(F,me),h=held(F,me),D=bfs(F.G,p.x,p.y,isFoe?h.taken:h.foes),o=[];
  for(let k=0;k<D.length;k++){const d=D[k];if(d<0||d>n||h.taken.has(k))continue;const x=k%F.G.w;o.push({x,y:(k-x)/F.G.w,d})}return o}
// The best of them by score, the shortest walk on a tie, the lowest tile after that: no dice, so a seeded room repeats.
function top(L,score){let b=null,bs=-1e12;for(const t of L){const s=score(t)*100-t.d;if(s>bs){bs=s;b=t}}return b}
// Steps to a tile, as a score: nearer is higher.
const toward=(F,q,block)=>{const D=bfs(F.G,q.x,q.y,block);return t=>{const d=D[idx(F,t)];return d<0?-99:-d}};

// Where a reflex walks for an act. o: {ranged, to (the key it must reach), range (of a heal), spot}. Null: stay. Nobody walks out of
// a foe's reach for nothing: only a retreat or a companion on the ground is worth a free blow.
const LEAVE=-500;
export function tileFor(F,me,k,o={}){const p=P(F,me);if(!p)return null;const L=walks(F,me,POS.STEP,false),G=F.G,h=held(F,me),foes=liveFoes(F),left=t=>leaving(F,p,t).length;
  const near=t=>{let m=99;for(const f of foes)m=Math.min(m,cheb(t,P(F,f.key)));return m},tgt=o.to!=null?P(F,o.to):null;let s;
  switch(k){
    case 'strike':{if(!foes.length)return null;const way=toward(F,P(F,targetOf(F,me,o.ranged,p).foe.key),h.foes);
      s=t=>{const x=targetOf(F,me,o.ranged,t);return (x.reach.ok?100:way(t))+x.flank.bonus*10+x.reach.pen*2+(o.ranged&&near(t)===1?-20:0)+left(t)*LEAVE};break}
    case 'guard':case 'hold':{const front=toward(F,G.spots.front,h.foes);s=t=>(near(t)===1?30:0)+standing(F).filter(b=>b.id!=me&&adj(P(F,b.id),t)).length*10+left(t)*LEAVE+front(t);break}
    case 'ward':s=t=>standing(F).filter(b=>within(t,P(F,b.id),GEO.WARD_R)).length*10+(near(t)===1?-15:0)+left(t)*LEAVE;break;
    case 'heal':{if(!tgt)return null;const way=toward(F,tgt,h.foes);s=t=>(within(t,tgt,o.range)?100:way(t))+(near(t)===1?-15:0)+left(t)*LEAVE;break}
    case 'potion':case 'stabilize':{if(!tgt)return null;const way=toward(F,tgt,h.foes);s=t=>(adj(t,tgt)?100:way(t))-left(t)*30;break}
    case 'retreat':{const way=toward(F,G.spots.stair,h.foes);s=t=>way(t)*10-left(t);break}
    default:{const q=o.spot&&G.spots[o.spot];if(!q)return null;const way=toward(F,q,h.foes);s=t=>way(t)+left(t)*LEAVE}}
  const t=top(L,s);return t&&(t.x!==p.x||t.y!==p.y)?{x:t.x,y:t.y}:null}
// Could a walk this round bring one to another's side?
export function canBeside(F,me,to){const q=P(F,to);return adj(P(F,me),q)||walks(F,me,POS.STEP,false).some(t=>adj(t,q))}
export const atStair=(F,me)=>within(P(F,me),F.G.spots.stair,GEO.STAIR_R);

// ---- the foes ----
// Who a foe can strike from where it stands: those beside it, or along a clear line for one that shoots.
export function blowsFrom(F,f,L=standing(F)){const q=P(F,f.key),far=foeShoots(f);return L.filter(b=>{const p=P(F,b.id);return p&&(adj(p,q)||(f.reach&&cheb(p,q)<=f.reach)||(far&&cheb(p,q)<=GEO.RANGE&&lineOf(F,q,p,f.key).clear))})}
// Where a foe goes this round (scripted, no dice). to: a hero it was drawn to. Swarms spread over the party and take the far side of
// their prey; archers hold their range; what finishes goes for the downed; a named boss keeps its den until it is hemmed in, then
// breaks for someone who is not on it. Null: it stays.
export function foeTile(F,f,to){const q=P(F,f.key),up=standing(F);if(!q)return null;const L=walks(F,f.key,GEO.FOE_STEP,true),h=held(F,f.key);
  const nearestOf=A=>{let b=null,bd=1e9;for(const m of A){const d=cheb(P(F,m.id),q);if(d<bd){bd=d;b=m}}return b};
  const go=t=>!t||(t.x===q.x&&t.y===q.y)?null:{x:t.x,y:t.y};
  const beside=(m,more)=>{const p=P(F,m.id),w=toward(F,p,h.taken);return go(top(L,x=>(adj(x,p)?100:w(x))+(more?more(x,p):0)))};
  if(!up.length){const m=nearestOf(F.mates.filter(b=>b.down&&P(F,b.id)));return m&&!adj(q,P(F,m.id))?beside(m):null} // nobody stands: it goes to those who lie there (the open map; below ground that is the wipe)
  if(to!=null&&!foeShoots(f)){const m=up.find(b=>b.id==to);if(m)return adj(q,P(F,m.id))?null:beside(m)}
  if(f.boss){if(!hemmed(F,f.key))return null;const m=nearestOf(up.filter(b=>!adj(P(F,b.id),q)));return m?beside(m):null}
  if(f.fin){const m=nearestOf(F.mates.filter(b=>b.down&&P(F,b.id)));if(m)return adj(q,P(F,m.id))?null:beside(m)}
  if(foeShoots(f)){const m=nearestOf(up),w=toward(F,P(F,m.id),h.taken),shot=x=>up.some(b=>cheb(P(F,b.id),x)<=GEO.RANGE&&lineOf(F,x,P(F,b.id),f.key).clear);
    return go(top(L,x=>(shot(x)?100:w(x))+(up.some(b=>adj(P(F,b.id),x))?-30:0)))}
  if(f.role==='swarm'){const others=liveFoes(F).filter(o=>o!==f),on=m=>others.filter(o=>adj(P(F,o.key),P(F,m.id))).length;let m=null,bs=1e9;
    for(const b of up){const s=on(b)*20+cheb(P(F,b.id),q);if(s<bs){bs=s;m=b}}
    if(adj(q,P(F,m.id)))return null;return beside(m,(x,p)=>others.some(o=>{const t=P(F,o.key);return adj(t,p)&&(x.x-p.x)*(t.x-p.x)+(x.y-p.y)*(t.y-p.y)<0})?5:0)}
  if(up.some(b=>adj(P(F,b.id),q)))return null;return beside(nearestOf(up))}

// ---- the room's rules in words ----
const names=L=>L.length<2?L.join(''):L.slice(0,-1).join(', ')+' and '+L[L.length-1];
// A few short sentences for one member: what touching, flanking, cover and their own acts mean from this tile. o: {ranged, ward, down
// (a companion to tend: {id, name})}. Never a coordinate, a level or a health number.
export function consequences(F,me,o={}){const p=P(F,me);if(!p)return [];const out=[],foes=liveFoes(F),by=foes.filter(f=>adj(p,P(F,f.key))),T=foes.length?targetOf(F,me,o.ranged,p):null;
  if(by.length){const g=guardOf(F,me);out.push(names([...new Set(by.map(f=>f.name))])+(by.length>1?' are':' is')+' adjacent to you: '+(g?g.name+' guards you, so stepping away is safe.':'stepping away costs a free blow.'))}
  if(T&&T.flank.bonus)out.push(names(T.flank.with)+' and you flank it: +'+T.flank.bonus+'.');
  if(T&&!T.reach.ok)out.push(o.ranged?'No clear shot: a strike walks you toward '+T.foe.name+'.':'Out of reach: a strike walks you toward '+T.foe.name+' and lands only if you get there.');
  if(T&&T.reach.friend)out.push(T.reach.friend+' stands in your line: '+T.reach.pen+'.');
  if(inCover(F,me))out.push('Cover: +'+GEO.COVER+' against shots.');
  if(o.ward){const w=wardOf(F,me).filter(b=>b.id!=me);out.push(w.length?'Your ward reaches '+names(w.map(b=>b.name))+'.':'Your ward reaches only you.')}
  if(o.down&&!adj(p,P(F,o.down.id)))out.push(o.down.name+' lies out of reach: tending takes a walk to their side.');
  return out}
