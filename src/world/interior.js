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
import {SETTINGS,FOOT} from '../data/settings.js';

export const IT={VOID:0,FLOOR:1,WALL:2,HALL:3,WATER:4,STAIR:5,DOOR:6,DAIS:7,RUG:8,BARS:9}; // RUG, BARS: scene settings (#431)
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

// ---- scene settings (#431, slice 1): one small room (or two) from a row of data/settings.js ----
// buildSetting(id, key) -> the same shape as buildInterior (w, h, seed, tiles, reg, rooms, props, entry) plus
//   {setting: id, name, theme, style:{floor, wall}, dark, spots:{cast:[{x, y}], party:{x, y}}, tall}
// key: any string naming the place and the scene (the view uses the town and the scene's id), so one scene always
// gets the same room and the next one in the same town another. Seeded by a hash of id and key with the local
// generator: no sim dice, nothing saved. Rooms are walled all round, with a two-tile back wall to hang things on.
export const settingSeed=(id,key)=>Math.floor(hash(strSeed(String(id))%1000003,strSeed(String(key||''))%1000003,431)*4294967296)>>>0;
const scache=new Map();
export function buildSetting(id,key=''){const sid=SETTINGS[id]?id:'house',S0=SETTINGS[sid],ck=sid+'|'+key;
  if(scache.has(ck))return scache.get(ck);
  const seed=settingSeed(sid,key),R=prng(seed),ri=(a,b)=>a+Math.floor(R()*(b-a+1)),pick=v=>Array.isArray(v)?ri(v[0],v[1]):v;
  const fw=pick(S0.w),fh=pick(S0.h),side=S0.side?pick(S0.side):0,ox=2,oy=3;
  const extra=S0.shape==='two'||S0.shape==='cell'?side+1:0,w=ox+fw+extra+2,h=oy+fh+2;
  const tiles=new Uint8Array(w*h),reg=new Int16Array(w*h).fill(-1),I=(x,y)=>y*w+x,inb=(x,y)=>x>=0&&y>=0&&x<w&&y<h;
  const set=(x,y,t)=>{if(inb(x,y)){tiles[I(x,y)]=t;reg[I(x,y)]=0}},get=(x,y)=>inb(x,y)?tiles[I(x,y)]:IT.VOID;
  // 1. the floor, by shape
  for(let j=0;j<fh;j++)for(let i=0;i<fw;i++){let on=true;
    if(S0.shape==='round'){const c=Math.round(Math.min(fw,fh)*.28);on=i+j>=c&&(fw-1-i)+j>=c&&i+(fh-1-j)>=c&&(fw-1-i)+(fh-1-j)>=c}
    else if(S0.shape==='hull'){const mid=(fh-1)/2,d=Math.abs(j-mid)/(mid+.5);on=i<=fw-1-Math.round(d*d*4.5)&&!(d>.8&&i===0)}
    if(on)set(ox+i,oy+j,IT.FLOOR)}
  const rx=ox+fw; // the partition (house) or the bars (cell), then the side room
  if(extra){for(let j=0;j<fh;j++){set(rx,oy+j,S0.shape==='cell'?IT.BARS:IT.WALL);for(let i=1;i<=side;i++)set(rx+i,oy+j,IT.FLOOR)}
    if(S0.shape==='two')set(rx,oy+fh-2,IT.DOOR)}
  const floorAt=(x,y)=>{const t=get(x,y);return t===IT.FLOOR||t===IT.RUG||t===IT.DAIS};
  // 2. rug and dais
  if(S0.rug){const [a,b,c,d]=S0.rug,x0=ox+Math.round(a*fw),y0=oy+Math.round(b*fh),x1=x0+Math.max(1,Math.round(c*fw)),y1=y0+Math.max(2,Math.round(d*fh));
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)if(get(x,y)===IT.FLOOR)set(x,y,IT.RUG)}
  if(S0.dais){const [a,b,c]=S0.dais,dw=Math.max(3,Math.round(b*fw)|1),dh=Math.max(2,Math.round(c*fh)),x0=ox+Math.round(a*(fw-1))-(dw>>1);
    for(let y=oy;y<oy+dh;y++)for(let x=x0;x<x0+dw;x++)if(floorAt(x,y))set(x,y,IT.DAIS)}
  // 3. walls all round, and a second course over every back-wall face
  const walk=t=>t!==IT.VOID&&t!==IT.WALL;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){if(get(x,y)!==IT.VOID)continue;let n=false;
    for(let dy=-1;dy<=1&&!n;dy++)for(let dx=-1;dx<=1;dx++)if(walk(get(x+dx,y+dy))){n=true;break}
    if(n)set(x,y,IT.WALL)}
  for(let y=1;y<h;y++)for(let x=0;x<w;x++)if(get(x,y)===IT.WALL&&walk(get(x,y+1))&&get(x,y-1)===IT.VOID)set(x,y-1,IT.WALL);
  for(let y=0;y<h;y++)for(let x=1;x<w-1;x++)if(get(x,y)===IT.VOID&&get(x-1,y)===IT.WALL&&get(x+1,y)===IT.WALL&&get(x,y+1)===IT.WALL)set(x,y,IT.WALL); // no notch over a partition
  // 4. the way in: a door in the front wall, a stair down through the back wall, or the hold's ladder
  let entry;
  if(S0.entry==='stair'){const ex=ox+Math.round(fw*.12);for(let y=0;y<oy;y++)for(let x=ex;x<ex+2;x++)set(x,y,IT.STAIR);entry={x:ex+1,y:oy}}
  else if(S0.entry==='ladder')entry={x:ox+2,y:oy+Math.floor(fh/2)};
  else{let ex=ox+Math.floor(fw/2);for(let k=1;k<fw&&!floorAt(ex,oy+fh-1);k++)ex+=k&1?k:-k;set(ex,oy+fh,IT.DOOR);entry={x:ex,y:oy+fh}}
  // 5. where the people stand: kept free of furniture
  const used=new Set(),K=(x,y)=>x+','+y,free=(x,y)=>floorAt(x,y)&&!used.has(K(x,y));
  const cast=(S0.cast||[{fx:.5,fy:.3}]).map(c=>({x:ox+c.fx*(fw-1)+.5,y:oy+c.fy*(fh-1)+.5}));
  const P=S0.party||{fx:.5,fy:.8},party={x:ox+P.fx*(fw-1)+.5,y:oy+P.fy*(fh-1)+.5};
  const keep=new Set();for(const c of cast)keep.add(K(Math.floor(c.x),Math.floor(c.y)));
  for(let k=-3;k<=3;k++)keep.add(K(Math.floor(party.x+k*1.15),Math.floor(party.y)));
  for(let k=-1;k<=1;k++){keep.add(K(entry.x+k,entry.y-1));keep.add(K(entry.x+k,entry.y))}
  // 6. furniture: fixed pieces at their shares of the room (nudged to the nearest free spot), rows of pews, then scatter
  const props=[],foot=k=>FOOT[k]||[1,1];
  const fits=(x,y,k)=>{const [a,b]=foot(k);for(let j=0;j<b;j++)for(let i=0;i<a;i++){if(!free(x+i,y+j)||keep.has(K(x+i,y+j)))return false}return true};
  const put=(x,y,kind,more)=>{const [a,b]=foot(kind);for(let j=0;j<b;j++)for(let i=0;i<a;i++)used.add(K(x+i,y+j));props.push({x,y,kind,...more})};
  const near=(x,y,kind)=>{for(let r=0;r<4;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){if(Math.max(Math.abs(dx),Math.abs(dy))!==r)continue;if(fits(x+dx,y+dy,kind))return [x+dx,y+dy]}return null};
  const wallFace=x=>{for(let y=1;y<h;y++)if(get(x,y)===IT.WALL&&walk(get(x,y+1)))return y;return -1};
  for(const p of S0.props||[]){if(p.scatter)continue;
    if(p.at==='wall'){const x=ox+Math.round(p.fx*(fw-1)),y=wallFace(x);if(y<0||get(x,y-1)===IT.STAIR||get(x+1,y-1)===IT.STAIR||props.some(q=>q.wall&&Math.abs(q.x-x)<2))continue;props.push({x,y,kind:p.kind,wall:true});continue}
    if(p.at==='cast'){const c=cast[0],x=Math.floor(c.x),y=Math.floor(c.y);if(floorAt(x,y))put(x,y,p.kind,{seat:true});continue} // the subject's own seat
    let x,y;if(p.at==='side'){if(!extra)continue;x=rx+1+Math.round(p.fx*(side-1));y=oy+Math.round(p.fy*(fh-1))}
    else{x=ox+Math.round(p.fx*(fw-1));y=oy+Math.round(p.fy*(fh-1))}
    x=Math.min(x,(p.at==='side'?rx+side:ox+fw-1)-foot(p.kind)[0]+1);const at=near(x,y,p.kind);if(at)put(at[0],at[1],p.kind)}
  if(S0.rows){const Rw=S0.rows,ax=ox+Math.floor(fw/2);for(let y=oy+Math.round(Rw.y0*(fh-1));y<=oy+Math.round(Rw.y1*(fh-1));y+=Rw.gap||2)
    for(const [x0,x1] of Rw.aisle?[[ox+1,ax-1],[ax+1,ox+fw-2]]:[[ox+1,ox+fw-2]]){let len=0;for(let x=x0;x<=x1;x++){if(free(x,y)&&!keep.has(K(x,y)))len++;else break}
      if(len>=2){for(let x=x0;x<x0+len;x++)used.add(K(x,y));props.push({x:x0,y,kind:Rw.kind,len})}}}
  const edge=(x,y)=>[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>{const t=get(x+dx,y+dy);return t===IT.WALL||t===IT.BARS});
  for(const p of S0.props||[]){if(!p.scatter)continue;const n=ri(p.scatter[0],p.scatter[1]);
    const cand=[];for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(get(x,y)===IT.FLOOR&&fits(x,y,p.kind)&&(p.where!=='edge'||edge(x,y)))cand.push([x,y]);
    for(let k=0;k<n&&cand.length;k++){const [x,y]=cand.splice(Math.floor(R()*cand.length),1)[0];if(fits(x,y,p.kind))put(x,y,p.kind,{v:ri(0,3)})}}
  if(S0.entry==='ladder')props.push({x:entry.x,y:entry.y-1,kind:'ladder'});
  props.sort((a,b)=>(a.wall?0:1)-(b.wall?0:1)||a.y-b.y||a.x-b.x); // wall pieces first, then back to front
  const out={w,h,seed,tiles,reg,rooms:[{id:sid,name:S0.name,boss:false,x:ox,y:oy,w:fw,h:fh,cx:ox+fw/2,cy:oy+fh/2,water:false,i:0}],props,entry,
    setting:sid,name:S0.name,theme:S0.theme||sid,style:{floor:S0.floor||'flag',wall:S0.wall||'brick'},dark:S0.dark||0,spots:{cast,party},tall:true};
  scache.set(ck,out);return out}
