// The room grid (#744, slice 2 of #140's named positions): tiles underneath, names on top. A crawl room has a small grid of its
// own, the chamber's box in the dungeon's interior (world/interior.js, world/siteinterior.js); everyone in the room stands on one
// tile of it. Agents speak in spots and relations ("hold the doorway", "beside Kerin", "toward the stair"), the game turns that
// into a tile, and they read the room back in words. The rules that read a position live in sim/geometry.js (#745): nothing here
// rolls a die or touches the sim's RNG, and it is all pure over plain data.
//   roomSpots(m, i, spec?)   the named spots of chamber i of interior m in world tiles (feet): {stair, back, front, flankL, flankR,
//                            cover, den} each {id, x, y, u, v}, own (a room's own spots), {ax, ay} (the unit step from the way in
//                            toward the den), {px, py} (across it, toward flankR), half, len, coverName, coverWord. Cached.
//   roomGrid(m, i, spec?)    the same chamber as a grid, room-local tiles: {w, h, ok, wet, ox, oy, fw, sd, ax, ay, px, py, spots
//                            {id: {x, y}}, names (the spots one may move to)}. Cached.
//   placeRoom(G, cr, ids, n) the party in order at the stair and n foes at the den, in cr.pos ({heroId: {x, y}, f0: {x, y}, ...},
//                            for room cr.posR); a second call only fills in whoever has no tile yet.
//   resolveMove(R, text)     a spot, a relation or steps -> one free tile {x, y, word} or {error} naming the legal spots.
//   goSpot, goBeside         the same for an act that implies a move (spotFor, the reflexes).
//   roomWords(R, canMove)    the room in a few short sentences, no coordinates; moveNames(R) the spots one may name.
//   spotAt(G, x, y), spotWord(G, id)   the spot a tile belongs to, and its name in the agents' words.
//   aimTile(R, text)         a spot, a companion or a foe by name -> its tile {x, y, word} or {error}: where a blast is aimed (#745).
// R is the room as one member sees it: {G, cr, me (hero id), mates: [{id, name, down}], foes: [{key, name}]}, the living only.
import {IT} from '../world/interior.js';

export const POS={STEP:3}; // tiles a hero may go in a round
export const SPOT_IDS=['stair','back','front','flankL','flankR','cover','den'];
// Where each spot lies on the room's axis (u: 0 the way in, 1 the far wall) and across it (v: -1 left, 1 right, facing the den).
const SPOT_UV={stair:[0,0],back:[.16,0],front:[.5,0],flankL:[.74,-.9],flankR:[.74,.9],cover:[.38,-.96],den:[.86,0]};
// Acts to spots: guard and hold to the front; strike beside the foe (first striker left, second right, the rest front); ward, heal,
// read, potion and an item to the back; scout to cover; retreat to the stair; stabilize beside the companion who lies bleeding.
export const ACT_SPOT={guard:'front',hold:'front',strike:'strike',ward:'back',heal:'back',read:'back',potion:'back',scout:'cover',retreat:'stair',stabilize:'downed'};
export const spotFor=(k,j=0)=>{const s=ACT_SPOT[k]||(k&&k.startsWith('use:')?'back':null);return s==='strike'?(j===0?'flankL':j===1?'flankR':'front'):s};

// ---- the spots of a chamber ----
const walkable=t=>t===IT.FLOOR||t===IT.WATER||t===IT.DAIS||t===IT.RUG||t===IT.DOOR;
const SOLID={pillar:1,sitepillar:1}; // nobody stands on a pillar
const spotCache=new Map();
// The way in to chamber i: the door whose far side is the corridor from the chamber before it (the stair for the first).
function wayIn(m,i){const r=m.rooms[i];if(i===0&&m.entry)return {x:m.entry.x+.5,y:m.entry.y+.5};const want=2*i-1;
  for(let y=Math.max(0,r.y-2);y<Math.min(m.h,r.y+r.h+2);y++)for(let x=Math.max(0,r.x-2);x<Math.min(m.w,r.x+r.w+2);x++){const k=y*m.w+x;
    if(m.tiles[k]!==IT.DOOR||m.reg[k]!==2*i)continue;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=m.w||Y>=m.h)continue;const q=Y*m.w+X;if(m.reg[q]===want&&m.tiles[q]===IT.HALL)return {x:x+.5,y:y+.5}}}
  return {x:r.cx,y:r.y+.5}}
// The tile at (x, y) if it can be stood on inside the room, else the nearest one that can (a cave cut into a site's chamber).
function onFloor(m,r,x,y){const ok=(X,Y)=>X>=r.x&&Y>=r.y&&X<r.x+r.w&&Y<r.y+r.h&&walkable(m.tiles[Y*m.w+X]);
  const tx=Math.floor(x),ty=Math.floor(y-.3);if(ok(tx,ty))return null;
  for(let d=1;d<6;d++)for(let j=-d;j<=d;j++)for(let i=-d;i<=d;i++){if(Math.max(Math.abs(i),Math.abs(j))!==d)continue;if(ok(tx+i,ty+j))return {x:tx+i+.5,y:ty+j+.8}}
  return null}
export function roomSpots(m,i,spec){const key=m.seed+':'+(m.theme||'')+':'+m.w+'x'+m.h+':'+i+(spec&&spec.spots?':'+JSON.stringify(spec.spots):'');let o=spotCache.get(key);if(o)return o;
  const r=m.rooms[i];if(!r)return null;const E0=wayIn(m,i);
  // the way in, pulled just inside the room; the far side: the dais in a boss chamber, else across the room from the way in
  const cl=(x,y)=>({x:Math.max(r.x+.6,Math.min(r.x+r.w-.6,x)),y:Math.max(r.y+.9,Math.min(r.y+r.h-.15,y))});
  const E=cl(E0.x,E0.y),C={x:r.cx,y:r.cy+.4},F=r.boss?{x:r.cx,y:r.y+2.6}:cl(2*C.x-E.x,2*C.y-E.y);
  const A=r.boss?cl(r.cx,r.y+r.h-.15):E; // the boss chamber is squared up to its dais: the party forms below it, whichever door they came in by
  let ax=F.x-A.x,ay=F.y-A.y,L=Math.hypot(ax,ay);if(L<.5){ax=0;ay=1;L=Math.max(1,r.h-1.2)}else{ax/=L;ay/=L}
  const px=-ay,py=ax,half=Math.max(.6,Math.abs(px)*(r.w/2-.7)+Math.abs(py)*(r.h/2-.6)); // across: toward flankR (the den's right, seen from the way in)
  const sp=spec&&spec.spots||{};o={ax,ay,px,py,half,len:L,wet:!!r.water,room:i,coverName:r.water?'reeds':'cover',coverWord:r.water?'reeds':'cover',own:{}};
  const at=(id,u,v,own)=>{let p=id==='stair'&&!own?{x:E.x,y:E.y}:cl(A.x+ax*L*u+px*half*v,A.y+ay*L*u+py*half*v);const f=onFloor(m,r,p.x,p.y);if(f)p=f;return {id,x:p.x,y:p.y,u,v}};
  for(const id of SPOT_IDS){const own=sp[id];o[id]=at(id,own&&own.u!=null?own.u:SPOT_UV[id][0],own&&own.v!=null?own.v:SPOT_UV[id][1],own)}
  for(const id in sp)if(!SPOT_IDS.includes(id)&&sp[id]&&sp[id].u!=null)o.own[id]=at(id,sp[id].u,sp[id].v||0,sp[id]); // a room's own spots (`spots: {altar: {u, v}}`)
  if(!r.water&&!sp.cover){const c=o.cover;let pil=null,bd=3; // beside a pillar on the cover's side of the room, if one stands near
    for(const q of m.props){if(!SOLID[q.kind]||q.x<r.x||q.x>=r.x+r.w||q.y<r.y||q.y>=r.y+r.h)continue;if(((q.x+.5-r.cx)*px+(q.y+.5-r.cy)*py)*c.v<=0)continue;
      const d=Math.hypot(q.x+.5-c.x,q.y+.5-c.y);if(d<bd){bd=d;pil=q}}
    if(pil){const f=onFloor(m,r,pil.x+.5,pil.y+1.75);o.cover={id:'cover',x:f?f.x:pil.x+.5,y:f?f.y:Math.min(r.y+r.h-.15,pil.y+1.75),u:c.u,v:c.v};o.coverWord='pillar'}}
  spotCache.set(key,o);return o}

// ---- the chamber as a grid ----
const gridCache=new WeakMap(); // interior -> {room key: grid}
const I=(G,x,y)=>y*G.w+x;
const on=(G,x,y)=>x>=0&&y>=0&&x<G.w&&y<G.h&&!!G.ok[I(G,x,y)];
export const gridOn=on;
const d2=(x,y,X,Y)=>(x-X)*(x-X)+(y-Y)*(y-Y);
// The free tile nearest (x, y), lowest index on a tie; (x, y) itself when the room is full.
export function nearFree(G,used,x,y){let b=-1,bd=1e9;for(let k=0;k<G.w*G.h;k++){if(!G.ok[k]||used.has(k))continue;const X=k%G.w,Y=(k-X)/G.w,d=d2(X,Y,x,y);if(d<bd){bd=d;b=k}}
  return b<0?{x,y}:{x:b%G.w,y:Math.floor(b/G.w)}}
export function roomGrid(m,i,spec){let per=gridCache.get(m);if(!per)gridCache.set(m,per={});const key=i+(spec&&spec.spots?JSON.stringify(spec.spots):'');if(per[key])return per[key];
  const r=m.rooms[i],s=roomSpots(m,i,spec);if(!r||!s)return null;const w=r.w,h=r.h,ok=new Uint8Array(w*h),wet=new Uint8Array(w*h);
  const solid=new Set();for(const q of m.props||[])if(SOLID[q.kind])solid.add(q.x+','+q.y);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const t=m.tiles[(r.y+y)*m.w+r.x+x];if(walkable(t)&&!solid.has((r.x+x)+','+(r.y+y)))ok[y*w+x]=1;if(t===IT.WATER)wet[y*w+x]=1}
  const G={w,h,ok,wet,ox:r.x,oy:r.y,ax:s.ax,ay:s.ay,px:s.px,py:s.py,fw:[Math.round(s.ax),Math.round(s.ay)],sd:[Math.round(s.px),Math.round(s.py)],coverWord:s.coverWord,spots:{},own:Object.keys(s.own),alias:{}};
  // every spot a tile of its own while the room has tiles to spare
  const used=new Set(),all=[...SPOT_IDS.map(id=>s[id]),...G.own.map(id=>s.own[id])];
  for(const p of all){const c=nearFree(G,used,Math.floor(p.x)-r.x,Math.floor(p.y-.3)-r.y);G.spots[p.id]=c;used.add(I(G,c.x,c.y))}
  G.names=['front','flankL','flankR','back','cover','stair',...G.own];aliasSpots(G);
  return per[key]=G}
// The words a grid's spots answer to: the usual ones, its cover, its own spots and any name it gave a spot (sim/patch.js, #746).
export function aliasSpots(G){Object.assign(G.alias,ALIAS);G.alias[norm(G.coverWord)]='cover';for(const id of G.own)G.alias[norm(id)]=id;for(const id in G.word||{})G.alias[norm(G.word[id])]=id}
export const spotWord=(G,id)=>G.word&&G.word[id]||(id==='flankL'?'flank-left':id==='flankR'?'flank-right':id==='cover'?G.coverWord:id);
const theWord=(G,id)=>id==='flankL'||id==='flankR'||(id==='cover'&&G.coverWord==='cover')?spotWord(G,id):'the '+spotWord(G,id);
const atWord=(G,id)=>(id==='cover'&&G.coverWord!=='pillar'?'in ':'at ')+theWord(G,id);

// ---- who stands where ----
export function placeRoom(G,cr,ids,nFoes){if(cr.posR!==cr.i||!cr.pos){cr.pos={};cr.posR=cr.i}const P=cr.pos,used=new Set();
  for(const k in P)used.add(I(G,P[k].x,P[k].y));
  const put=(key,t)=>{if(P[key])return;const c=nearFree(G,used,t.x,t.y);P[key]={x:c.x,y:c.y};used.add(I(G,c.x,c.y))};
  for(const id of ids)put(id,G.spots.stair);for(let k=0;k<nFoes;k++)put('f'+k,G.spots.den)}
// Tiles held by someone else, and those a hero cannot pass (foes; companions may be walked past).
function occ(R){const taken=new Set(),block=new Set(),P=R.cr.pos,G=R.G;
  for(const b of R.mates)if(b.id!==R.me&&P[b.id])taken.add(I(G,P[b.id].x,P[b.id].y));
  for(const f of R.foes)if(P[f.key]){const k=I(G,P[f.key].x,P[f.key].y);taken.add(k);block.add(k)}
  return {taken,block}}
const N8=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
export function bfs(G,x,y,block){const D=new Int16Array(G.w*G.h).fill(-1);if(x<0||y<0||x>=G.w||y>=G.h)return D;const q=[[x,y]];D[I(G,x,y)]=0;
  if(G.cost){for(let h=0;h<q.length;h++){const [X,Y]=q[h],d=D[I(G,X,Y)];for(const [dx,dy] of N8){const a=X+dx,b=Y+dy;if(!on(G,a,b))continue;const k=I(G,a,b);if(block.has(k))continue;const n=d+(G.cost[k]||1);if(D[k]>=0&&D[k]<=n)continue;D[k]=n;q.push([a,b])}}return D} // the open ground (#746): a slow tile costs more, so a tile may be reached again by a cheaper way
  for(let h=0;h<q.length;h++){const [X,Y]=q[h],d=D[I(G,X,Y)];for(const [dx,dy] of N8){const a=X+dx,b=Y+dy;if(!on(G,a,b))continue;const k=I(G,a,b);if(D[k]>=0||block.has(k))continue;D[k]=d+1;q.push([a,b])}}
  return D}
// As near (tx, ty) as the round allows: the free tile within POS.STEP steps that is fewest steps from it. short: too far, or held.
function reach(R,tx,ty){const G=R.G,p=R.cr.pos[R.me],{taken,block}=occ(R),from=bfs(G,p.x,p.y,block),to=bfs(G,tx,ty,block);let b=-1,bs=1e9;
  for(let k=0;k<G.w*G.h;k++){const d=from[k];if(d<0||d>POS.STEP||taken.has(k))continue;const X=k%G.w,Y=(k-X)/G.w,s=(to[k]<0?99:to[k])*1e4+d2(X,Y,tx,ty)*10+d;if(s<bs){bs=s;b=k}}
  const x=b<0?p.x:b%G.w,y=b<0?p.y:Math.floor(b/G.w);return {x,y,short:x!==tx||y!==ty}}
// The free tile beside what stands at (x, y) that is nearest the mover; (x, y) when none is free.
function besideTile(R,x,y){const G=R.G,p=R.cr.pos[R.me];if(cheb(p,{x,y})===1)return {x:p.x,y:p.y};const {taken,block}=occ(R),from=bfs(G,p.x,p.y,block);let b=null,bs=1e9;
  for(const [dx,dy] of N8){const X=x+dx,Y=y+dy;if(!on(G,X,Y)||taken.has(I(G,X,Y)))continue;const f=from[I(G,X,Y)],s=(f<0?999:f)*100+d2(X,Y,p.x,p.y);if(s<bs){bs=s;b={x:X,y:Y}}}
  return b||{x,y}}
export const goSpot=(R,id)=>{const t=R.G.spots[id];return t?reach(R,t.x,t.y):null};
export function goBeside(R,key){const e=R.cr.pos[key];if(!e)return null;const t=besideTile(R,e.x,e.y);return reach(R,t.x,t.y)}
// The spot a tile belongs to: its own, else the nearest within a tile (front and the rest are places, not points), else null.
export function spotAt(G,x,y){let b=null,bd=3;for(const id of [...G.names,'den']){const t=G.spots[id];if(!t||cheb(t,{x,y})>1)continue;const d=d2(t.x,t.y,x,y);if(d<bd){bd=d;b=id}}return b}

// ---- spots and relations, in words ----
function norm(s){return String(s==null?'':s).toLowerCase().replace(/[^a-z0-9' ]+/g,' ').replace(/\s+/g,' ').trim()}
const ALIAS={stair:'stair',stairs:'stair',staircase:'stair',exit:'stair',door:'stair',doorway:'stair',entrance:'stair','way in':'stair','way out':'stair','way back':'stair',
  back:'back',rear:'back','back line':'back','back rank':'back',front:'front','front line':'front',frontline:'front',line:'front',middle:'front',centre:'front',center:'front',
  'flank left':'flankL','left flank':'flankL','flank right':'flankR','right flank':'flankR',cover:'cover'};
const LEAD=/^(?:(?:i|we) )?(?:(?:go|move|step|walk|run|head|get|hold|stand|take|keep|fall back)(?: (?:up|over|back))? )?/,ART=/^(?:(?:to|at|on|by|into|in|onto) )?(?:(?:the|a|an|my|our) )?/;
const NUM={a:1,one:1,two:2,three:3,four:4,five:5};
const DIR=(G,w)=>{const f=G.fw,s=G.sd,b=[-f[0],-f[1]];return {north:[0,-1],south:[0,1],east:[1,0],west:[-1,0],ahead:f,forward:f,forwards:f,back:b,backward:b,backwards:b,left:[-s[0],-s[1]],right:s}[w]};
const STEPS=/^(\d+|a|one|two|three|four|five)? ?(?:tiles?|steps?|squares?|paces?)? ?(?:to the |to my )?(north|south|east|west|ahead|forwards?|backwards?|back|left|right)$/;
const FOEWORD=/^(?:foes?|enem(?:y|ies)|them|it|monsters?|creatures?)$/;
const nearest=(R,L)=>{const p=R.cr.pos[R.me];let b=null,bd=1e9;for(const f of L){const t=R.cr.pos[f.key];if(!t)continue;const d=d2(t.x,t.y,p.x,p.y);if(d<bd){bd=d;b=f}}return b};
// What a name stands for: a spot {spot}, a companion or a foe {key, foe}; null when it is nobody here.
function entity(R,w0){const w=norm(w0).replace(ART,'').trim();if(!w)return null;const G=R.G,id=G.alias[w];if(id)return {spot:id};
  if(w==='flank'){const p=R.cr.pos[R.me],l=G.spots.flankL,r=G.spots.flankR;return {spot:d2(l.x,l.y,p.x,p.y)<=d2(r.x,r.y,p.x,p.y)?'flankL':'flankR'}}
  const b=R.mates.find(x=>x.id!==R.me&&(norm(x.name)===w||norm(x.name).split(' ')[0]===w));if(b)return {key:b.id};
  const sing=w.replace(/s$/,''),F=FOEWORD.test(w)?R.foes:R.foes.filter(f=>{const n=norm(f.name);return n===w||(sing.length>2&&n.includes(sing))}),f=nearest(R,F);
  return f?{key:f.key,foe:true}:null}
const moved=(R,g,how)=>{const G=R.G,s=spotAt(G,g.x,g.y),at=s?theWord(G,s):'open ground';return {x:g.x,y:g.y,word:(g.short?'You get as far as ':how||'You move to ')+at+'.'}};
const refuse=(R,t)=>({error:'Cannot read the move "'+t+'". You may move to: '+moveNames(R).join(', ')+'; or say beside or behind a companion, toward or away from a foe, or steps such as "2 ahead". Up to '+POS.STEP+' tiles a round.'});
const tileOf=(R,e)=>e&&(e.spot?R.G.spots[e.spot]:R.cr.pos[e.key]);
// A spot name, a relation or steps -> one tile. Nothing moves here; the caller writes it to cr.pos.
export function resolveMove(R,text){const t=String(text==null?'':text).trim().slice(0,80),G=R.G,p=R.cr.pos[R.me];if(!p)return {error:'You have no place in this room.'};
  const w=norm(t).replace(LEAD,'')||norm(t);
  if(/^(?:stay|here|stay here|still|my ground|ground|my position|position|where i am)$/.test(w))return {x:p.x,y:p.y,word:'You stay where you are.'};
  let m=/^(?:away from|back from|clear of|far from) (.+)$/.exec(w);
  if(m){const at=tileOf(R,entity(R,m[1]));if(!at)return refuse(R,t);const {taken,block}=occ(R),from=bfs(G,p.x,p.y,block);let b=-1,bs=-1e9;
    for(let k=0;k<G.w*G.h;k++){const d=from[k];if(d<0||d>POS.STEP||taken.has(k))continue;const X=k%G.w,Y=(k-X)/G.w,s=d2(X,Y,at.x,at.y)*10-d;if(s>bs){bs=s;b=k}}
    return moved(R,{x:b<0?p.x:b%G.w,y:b<0?p.y:Math.floor(b/G.w)},'You back away to ')}
  m=/^(behind|in front of|ahead of|before) (.+)$/.exec(w);
  if(m){const e=entity(R,m[2]),at=tileOf(R,e);if(!at)return refuse(R,t);const s=(m[1]==='behind')===!e.foe?-1:1;return moved(R,reach(R,at.x+G.fw[0]*s,at.y+G.fw[1]*s))} // behind a companion is on the stair's side of them, behind a foe beyond it
  m=/^(?:beside|next to|alongside|by|with|near|at|to|toward|towards|up to|closer to|close to) (.+)$/.exec(w);
  const e=entity(R,m?m[1]:w);
  if(e){const g=e.spot?goSpot(R,e.spot):goBeside(R,e.key);return g?moved(R,g):refuse(R,t)}
  m=STEPS.exec(w);if(!m)return refuse(R,t);
  const n=Math.min(POS.STEP,/^\d/.test(m[1]||'')?+m[1]:NUM[m[1]]||1),dir=DIR(G,m[2]),{taken,block}=occ(R);if(n<1)return refuse(R,t);let x=p.x,y=p.y,bx=x,by=y,left=POS.STEP;
  for(let k=0;k<n;k++){const X=x+dir[0],Y=y+dir[1];if(!on(G,X,Y)||block.has(I(G,X,Y)))break;left-=G.cost&&G.cost[I(G,X,Y)]||1;if(left<0)break;x=X;y=Y;if(!taken.has(I(G,x,y))){bx=x;by=y}}
  if(bx===p.x&&by===p.y)return {error:'The way '+m[2]+' is blocked. You may move to: '+moveNames(R).join(', ')+'.'};
  return moved(R,{x:bx,y:by})}

// Where a blast lands: what the words name, with no walk at all.
export function aimTile(R,text){const t=String(text==null?'':text).trim().slice(0,80),e=entity(R,norm(t).replace(LEAD,'')),at=tileOf(R,e);
  return at?{x:at.x,y:at.y,word:'You aim at '+(e.spot?theWord(R.G,e.spot):t)+'.'}:{error:'Cannot aim at "'+t+'". Name a spot, a companion or a foe.'}}

// ---- the room in words ----
const tiles=n=>n===1?'1 tile':n+' tiles';
export function cheb(a,b){return Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y))}
// The direction from one tile to another, facing the den.
function dirWord(G,a,b){const dx=b.x-a.x,dy=b.y-a.y,f=dx*G.ax+dy*G.ay,s=dx*G.px+dy*G.py,F=Math.abs(f),T=Math.abs(s);
  return T<F*.5?(f>0?'ahead':'behind you'):F<T*.5?(s>0?'to your right':'to your left'):(f>0?'ahead':'behind you')+' to the '+(s>0?'right':'left')}
const list=L=>L.length<2?L.join(''):L.slice(0,-1).join(', ')+' and '+L[L.length-1];
export const moveNames=R=>{const G=R.G,p=R.cr.pos[R.me],here=p?spotAt(G,p.x,p.y):null;return G.names.filter(id=>id!==here).map(id=>spotWord(G,id))};
export function roomWords(R,canMove){const {G,cr}=R,P=cr.pos,p=P[R.me];if(!p)return null;const here=spotAt(G,p.x,p.y),L=[],named=b=>b.name+(b.down?' (down)':'');
  const mates=R.mates.filter(b=>b.id!==R.me&&P[b.id]),by=mates.filter(b=>cheb(P[b.id],p)<=1),far=mates.filter(b=>cheb(P[b.id],p)>1);
  L.push('You stand '+(here?atWord(G,here):'in the open')+(by.length?' beside '+list(by.map(named)):'')+'.');
  if(far.length)L.push(list(far.map(b=>{const s=spotAt(G,P[b.id].x,P[b.id].y);return named(b)+' '+(s?atWord(G,s):tiles(cheb(P[b.id],p))+' '+dirWord(G,p,P[b.id]))}))+'.');
  const F=R.foes.filter(f=>P[f.key]).map(f=>({f,t:P[f.key],d:cheb(P[f.key],p)})).sort((a,b)=>a.d-b.d||(a.f.key<b.f.key?-1:1));
  if(F.length)L.push('Foes: '+F.slice(0,4).map(({f,t,d})=>f.name+' '+tiles(d)+' '+dirWord(G,p,t)+(G.wet[I(G,t.x,t.y)]?', in the water':'')).join('; ')+(F.length>4?'; '+(F.length-4)+' more':'')+'.');
  const st=G.spots.stair;if(here!=='stair')L.push('The '+spotWord(G,'stair')+' is '+tiles(Math.max(1,cheb(st,p)))+' '+dirWord(G,p,st)+'.');
  const cv=G.spots.cover;if(cv&&here!=='cover')L.push('Cover: '+(G.coverWord==='cover'?'':'the '+G.coverWord+' ')+tiles(Math.max(1,cheb(cv,p)))+' '+dirWord(G,p,cv)+'.');
  if(canMove){const {block}=occ(R),from=bfs(G,p.x,p.y,block),now=[],then=[];for(const id of G.names){if(id===here)continue;const t=G.spots[id],d=from[I(G,t.x,t.y)];if(d>=0&&d<=POS.STEP)now.push(spotWord(G,id));else then.push(id)}
    L.push('You may move to: '+[...now,...then.map(id=>'toward '+theWord(G,id))].join(', ')+' ('+POS.STEP+' tiles a round).')}
  return L.join(' ')}
