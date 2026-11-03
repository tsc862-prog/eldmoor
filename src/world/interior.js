// Dungeon interiors (#85, slice 1): a small tile map of a dungeon's chambers, built from its room list.
// Pure data, no DOM and no sim state: render/interior.js draws it, the dungeon view reads the live crawl over it.
//
// buildInterior(site) -> {w, h, seed, tiles (Uint8Array w*h, IT ids), reg (Int16Array: room i = 2i,
//   the corridor from room i to room i+1 = 2i+1, -1 none), rooms:[{id, name, boss, x, y, w, h, cx, cy, water}],
//   props:[{x, y, kind}], entry:{x, y}}
// site: a crypt landmark ({name, x, y, rooms}); a site with no rooms gets one plain chamber.
//
// Deterministic: seeded by a hash of the site's name and position (core/rng.js hash), with its own small
// generator, never the sim's rnd(). The same site always gives the same interior, so it need not be saved, and
// building one never moves the seeded world.
//
// Layout: the chambers go down from the stair in order on a coarse grid (each step down, left or right, never
// back onto a used cell), joined by one-tile corridors with a door where a corridor meets a chamber. The boss
// chamber is larger, with a dais. Rooms whose name or frame speaks of water get a pool; bones, pillars and
// candles come from the room's words too (a theme per crypt today; fortress, den, mine come with their sites).
import {hash} from '../core/rng.js';

export const IT={VOID:0,FLOOR:1,WALL:2,HALL:3,WATER:4,STAIR:5,DOOR:6,DAIS:7};
const CELL=13; // coarse grid cell in tiles (the boss chamber is at most 11x9, plus a wall each side)

const strSeed=s=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0};
// The site's seed: a hash of its name and position (tenths of a tile), as a 32-bit integer.
export const interiorSeed=site=>Math.floor(hash(Math.round((site.x||0)*10),Math.round((site.y||0)*10),strSeed(String(site.name||''))%1000003)*4294967296)>>>0;
// mulberry32: a local generator, so the sim's dice are never touched.
function prng(seed){let s=seed>>>0;return()=>{s=(s+0x6D2B79F5)|0;let t=Math.imul(s^s>>>15,1|s);t=(t+Math.imul(t^t>>>7,61|t))^t;return((t^t>>>14)>>>0)/4294967296}}

const WET=/water|drown|mere|pool|sump|flood|mirror/i,BONE=/bone|ossuar|skull/i,PILLAR=/galler|pillar|arrow|court|hall/i;
const words=r=>(r.name||'')+' '+(r.frame||'');

const cache=new Map();
export function buildInterior(site){const key=(site.name||'')+'|'+site.x+'|'+site.y+'|'+(site.rooms||[]).map(r=>r.id).join(',');
  if(cache.has(key))return cache.get(key);
  const list=(site.rooms&&site.rooms.length?site.rooms:[{id:'hall',name:site.name||'The Hall',boss:true}]),n=list.length;
  const seed=interiorSeed(site),R=prng(seed),ri=(a,b)=>a+Math.floor(R()*(b-a+1));
  // 1. a path of grid cells, one per chamber: down, left or right; a dead end tries again from the start
  // several candidate paths; keep the one whose shape best fits a wide screen (about 3 cells across for 2 down)
  let cells=null,best=1e9;
  for(let tries=0;tries<24;tries++){const out=[[0,0]],used=new Set(['0,0']);let last=null;
    for(let i=1;i<n;i++){const [x,y]=out[i-1],opts=[[0,1,2],[-1,0,2],[1,0,2]].filter(([dx,dy])=>!used.has((x+dx)+','+(y+dy))&&!(last&&dx&&dx===-last[0]));
      if(!opts.length)break;let tot=0;for(const o of opts)tot+=o[2];let r=R()*tot,pick=opts[0];for(const o of opts){r-=o[2];if(r<0){pick=o;break}}
      out.push([x+pick[0],y+pick[1]]);used.add((x+pick[0])+','+(y+pick[1]));last=pick}
    if(out.length<n)continue;
    const cw=Math.max(...out.map(c=>c[0]))-Math.min(...out.map(c=>c[0]))+1,ch=Math.max(...out.map(c=>c[1]))+1,score=Math.abs(cw/ch-1.5)+Math.max(cw,ch)*.15;
    if(score<best-1e-9){best=score;cells=out}}
  if(!cells)cells=list.map((_,i)=>[0,i]); // never in practice: a straight shaft down
  const minX=Math.min(...cells.map(c=>c[0])),maxX=Math.max(...cells.map(c=>c[0])),maxY=Math.max(...cells.map(c=>c[1]));
  const PAD=1,TOP=4; // TOP: room above the first chamber for the stair down from the world
  const w=(maxX-minX+1)*CELL+PAD*2,h=(maxY+1)*CELL+PAD*2+TOP;
  const tiles=new Uint8Array(w*h),reg=new Int16Array(w*h).fill(-1),I=(x,y)=>y*w+x;
  const set=(x,y,t,r)=>{if(x<0||y<0||x>=w||y>=h)return;tiles[I(x,y)]=t;reg[I(x,y)]=r};
  // 2. the chambers, centred in their cells with a little jitter
  const rooms=list.map((r,i)=>{const boss=!!r.boss||(i===n-1&&!list.some(q=>q.boss));
    const rw=boss?ri(9,11):ri(5,8),rh=boss?ri(7,9):ri(4,6),c=cells[i];
    const ox=PAD+(c[0]-minX)*CELL,oy=PAD+TOP+c[1]*CELL;
    const x=ox+Math.floor((CELL-rw)/2)+ri(-1,1),y=oy+Math.floor((CELL-rh)/2)+ri(-1,1);
    return {id:r.id,name:r.name||r.id,boss,x,y,w:rw,h:rh,cx:x+rw/2,cy:y+rh/2,water:WET.test(words(r)),i}});
  for(const m of rooms)for(let y=m.y;y<m.y+m.h;y++)for(let x=m.x;x<m.x+m.w;x++)set(x,y,IT.FLOOR,2*m.i);
  // 3. corridors: an L from one chamber's centre to the next's, along the step's axis first
  const hall=(x,y,r)=>{if(tiles[I(x,y)]===IT.VOID)set(x,y,IT.HALL,r)};
  for(let i=0;i+1<n;i++){const a=rooms[i],b=rooms[i+1],ax=Math.floor(a.cx),ay=Math.floor(a.cy),bx=Math.floor(b.cx),by=Math.floor(b.cy),r=2*i+1;
    const down=cells[i+1][1]>cells[i][1];
    if(down){const my=Math.floor((a.y+a.h+b.y)/2);for(let y=Math.min(ay,my);y<=Math.max(ay,my);y++)hall(ax,y,r);
      for(let x=Math.min(ax,bx);x<=Math.max(ax,bx);x++)hall(x,my,r);for(let y=Math.min(my,by);y<=Math.max(my,by);y++)hall(bx,y,r)}
    else{const mx=Math.floor(((a.x<b.x?a.x+a.w:b.x+b.w)+(a.x<b.x?b.x:a.x))/2);for(let x=Math.min(ax,mx);x<=Math.max(ax,mx);x++)hall(x,ay,r);
      for(let y=Math.min(ay,by);y<=Math.max(ay,by);y++)hall(mx,y,r);for(let x=Math.min(mx,bx);x<=Math.max(mx,bx);x++)hall(x,by,r)}}
  // 4. the stair down from the world, above the first chamber
  const e=rooms[0],ex=Math.floor(e.cx);
  const sy=Math.max(1,e.y-3);for(let y=sy;y<e.y;y++)for(let x=ex-1;x<=ex+1;x++)set(x,y,IT.STAIR,0);
  // 5. doors: a corridor tile touching a chamber's floor takes the chamber's region (it opens with the chamber)
  const isFloor=(x,y)=>x>=0&&y>=0&&x<w&&y<h&&tiles[I(x,y)]===IT.FLOOR;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(tiles[I(x,y)]===IT.HALL){const nb=[[1,0],[-1,0],[0,1],[0,-1]].find(([dx,dy])=>isFloor(x+dx,y+dy));
    if(nb){const r=reg[I(x+nb[0],y+nb[1])];tiles[I(x,y)]=IT.DOOR;reg[I(x,y)]=r}}
  // 6. features from the room's words: pools, the boss dais, bones, pillars, candles
  const props=[];
  for(const m of rooms){const r=list[m.i],t=words(r),inner=(x,y)=>x>m.x&&y>m.y&&x<m.x+m.w-1&&y<m.y+m.h-1;
    const doorNear=(x,y)=>[[1,0],[-1,0],[0,1],[0,-1],[0,0]].some(([dx,dy])=>{const k=I(x+dx,y+dy);return tiles[k]===IT.DOOR||tiles[k]===IT.HALL||tiles[k]===IT.STAIR});
    if(m.water){const rx=(m.w-2)/2,ry=(m.h-2)/2;for(let y=m.y;y<m.y+m.h;y++)for(let x=m.x;x<m.x+m.w;x++){const dx=(x+.5-m.cx)/rx,dy=(y+.5-m.cy)/ry;
      if(dx*dx+dy*dy<.8&&inner(x,y))tiles[I(x,y)]=IT.WATER}}
    if(m.boss){const dx=Math.floor(m.cx),dy=m.y+1;for(let y=dy;y<dy+2;y++)for(let x=dx-2;x<=dx+2;x++)if(!doorNear(x,y))tiles[I(x,y)]=IT.DAIS;
      props.push({x:dx,y:dy,kind:m.water?'throne':'sarcophagus'});
      props.push({x:dx-3,y:dy,kind:'brazier'},{x:dx+3,y:dy,kind:'brazier'})}
    if(BONE.test(t))for(let x=m.x;x<m.x+m.w;x+=2){if(!doorNear(x,m.y-1)&&!doorNear(x,m.y))props.push({x,y:m.y,kind:'bones'})}
    if(PILLAR.test(t)&&m.w>=6&&!m.boss)for(let x=m.x+1;x<m.x+m.w-1;x+=2)for(const y of [m.y+1,m.y+m.h-2])if(!doorNear(x,y)&&tiles[I(x,y)]===IT.FLOOR)props.push({x,y,kind:'pillar'});
    const k=ri(1,2);for(let j=0;j<k;j++){const x=R()<.5?m.x:m.x+m.w-1,y=m.y+ri(0,m.h-1);if(!doorNear(x,y)&&tiles[I(x,y)]===IT.FLOOR&&!props.some(p=>p.x===x&&p.y===y))props.push({x,y,kind:R()<.6?'candle':'urn'})}}
  // 7. walls: every empty tile beside a walkable one
  const walk=t=>t!==IT.VOID&&t!==IT.WALL;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){if(tiles[I(x,y)]!==IT.VOID)continue;let r=-1;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=w||Y>=h)continue;const k=I(X,Y);if(walk(tiles[k])&&(r<0||reg[k]<r))r=reg[k]}
    if(r>=0){tiles[I(x,y)]=IT.WALL;reg[I(x,y)]=r}}
  for(let x=ex-1;x<=ex+1;x++)set(x,sy-1,IT.STAIR,0); // the stair runs out at the top: the way up to the world
  // 8. crop to what was built, one empty tile all round
  let x0=w,y0=h,x1=0,y1=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(tiles[I(x,y)]!==IT.VOID){if(x<x0)x0=x;if(y<y0)y0=y;if(x>x1)x1=x;if(y>y1)y1=y}
  x0=Math.max(0,x0-1);y0=Math.max(0,y0-1);const W=Math.min(w,x1+2)-x0,H=Math.min(h,y1+2)-y0,T2=new Uint8Array(W*H),R2=new Int16Array(W*H);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){T2[y*W+x]=tiles[I(x+x0,y+y0)];R2[y*W+x]=reg[I(x+x0,y+y0)]}
  for(const m of rooms){m.x-=x0;m.y-=y0;m.cx-=x0;m.cy-=y0}for(const p of props){p.x-=x0;p.y-=y0}
  const out={w:W,h:H,seed,tiles:T2,reg:R2,rooms,props,entry:{x:ex-x0,y:sy-y0}};cache.set(key,out);return out}
