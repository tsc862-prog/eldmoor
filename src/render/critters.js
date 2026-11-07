// Critters (#795, slice 4 of the solid-world epic #791): animals that are not mobs, so the map has a pulse. In towns
// chickens, dogs, cats and goats wander the open ground inside the walls; in the wild deer, hares, crows and gulls
// graze, hop and perch by biome. Any hero within 2 tiles scatters them (ground animals run, birds take off and
// glide back later); they come home. Birds also roost in a few trees and burst out when a hero passes.
// Render only and purely cosmetic: no sim state, nothing in step(), placement comes from hashes of the map and the
// motion from life.js's private stream, so seeded play and the map hash cannot move. They stand only on open ground
// (solidAt) and never inside a building or on a wall; towns come from CITY, biomes from REGIONS (no names, no counts).
// Day and night, weather: chickens, goats, dogs and birds are out by day; cats and the wild grazers stay; rain, squalls
// and ash storms send chickens, cats and birds under cover.
// Art: sheets cut from LPC-compatible sets (epic #830, scripts/art/lpc-critters.mjs): sprite:critter-<kind>-<variant>, a bird's flight
// sprite:critter-<kind>-<variant>-fly, the variant being the index in K's pal. With no sheet the pixel sprites below draw, as before.
import {tiles,I,CITY,REGIONS,zone,LANDMARKS} from '../world/map.js';
import {W,H,G,TREE,MUD,SGRASS,FLOWER,SNOW,RIVER} from '../world/tiles.js';
import {solidAt} from '../world/passable.js';
import {hash} from '../core/rng.js';
import {sprite,worldSprite,idFrame} from './sprites.js';
import {U as T,PROC_SCALE,ART} from './tile.js';
import {F,inTiles,lrand,skyAt,WET,day} from './life.js';
import {MARK} from './palette.js';
import {onWorld} from '../sim/kept.js';

// ---- the kinds: pixel sprites facing right (stand, step), a palette per variant, speeds in tiles a second ----
const K={
  chicken:{rows:[['...R..','..WDY.','.WWWW.','WWWWW.','.WWWW.','..Y.Y.'],['...R..','..WDY.','.WWWW.','WWWWW.','.WWWW.','.Y..Y.']],
    pal:[{W:'#f0e8d8',R:'#d04a3a',Y:'#e8b038',D:'#2a2020'},{W:'#b87a4a',R:'#d04a3a',Y:'#e8b038',D:'#2a2020'},{W:'#3a2e2a',R:'#d04a3a',Y:'#e8b038',D:'#e8d8a0'}],
    walk:.7,run:3.4,flee:3,calm:5,roam:2.5,out:'day',wet:1},
  dog:{rows:[['......B..','B....BBDN','BBBBBBBB.','.BBBBBBL.','.B.B.B.B.','.D.D.D.D.'],['......B..','.B...BBDN','BBBBBBBB.','.BBBBBBL.','..B.B.B..','..D.D.D..']],
    pal:[{B:'#9a6a3a',L:'#c8a070',D:'#2a1c14',N:'#1a1414'},{B:'#4a4048',L:'#8a828c',D:'#1a1618',N:'#0a0a0a'},{B:'#c8a878',L:'#ecd8b0',D:'#3a2a1c',N:'#1a1414'}],
    walk:.9,run:3.2,flee:3,calm:4,roam:3,out:'day'},
  cat:{rows:[['....B.B','....BBB','.BBBBBN','BBBBBB.','.B.B.B.','.D.D.D.'],['....B.B','....BBB','.BBBBBN','BBBBBB.','..B.B..','..D.D..']],
    pal:[{B:'#d8923a',D:'#3a2410',N:'#e8a0a0'},{B:'#4a4650',D:'#1a1618',N:'#e8a0a0'},{B:'#e4e0d8',D:'#8a8478',N:'#e8a0a0'}],
    walk:.7,run:3.6,flee:3,calm:6,roam:3,out:'always',wet:1},
  goat:{rows:[['.....H.H.','......WWW','......WDN','WWWWWWWB.','WWWWWWWW.','WWWWWWWL.','.G.G.G.G.','.D.D.D.D.'],['.....H.H.','......WWW','......WDN','WWWWWWWB.','WWWWWWWW.','WWWWWWWL.','.G..G.G..','.D..D.D..']],
    pal:[{W:'#ece4d4',L:'#c8bca8',G:'#c8bca8',D:'#3a2a20',H:'#8a7a60',N:'#3a2a20',B:'#ece4d4'},{W:'#8a6a4a',L:'#6a4e34',G:'#6a4e34',D:'#2a1c14',H:'#5a4630',N:'#2a1c14',B:'#8a6a4a'}],
    walk:.5,run:2.6,flee:2.5,calm:6,roam:2,out:'day'},
  deer:{rows:[['........A.A.','.........AA.','........BBBB','........BBDN','.......BB...','TBBBBBBBB...','BBBBBBBBL...','BBBBBBBLL...','.B.B...B.B..','.B.B...B.B..','.D.D...D.D..'],['........A.A.','.........AA.','........BBBB','........BBDN','.......BB...','TBBBBBBBB...','BBBBBBBBL...','BBBBBBBLL...','..B.B..B.B..','..B..B.B..B.','..D..D.D..D.']],
    pal:[{A:'#c8b898',B:'#9a6a3e',L:'#c89a64',T:'#f0e4d0',D:'#2a1a10',N:'#2a1a10'}],
    walk:.7,run:4.6,flee:6,calm:9,roam:3,out:'always',side:1}, // side: its sheet has no front or back view
  hare:{rows:[['....E.E','....BBB','.BBBBDN','TBBBBB.','.LL.LL.'],['....E.E','....BBB','.BBBBDN','TBBBBB.','..LL.L.']],
    pal:[{E:'#a07a50',B:'#a8825a',L:'#80603c',T:'#f0e8d8',D:'#1a1410',N:'#e8a0a0'},{E:'#d8dce4',B:'#eceef4',L:'#c0c6d2',T:'#ffffff',D:'#1a1a24',N:'#e8a0a0'}],
    walk:.8,run:5.2,flee:5,calm:7,roam:2.5,out:'always'},
  crow:{rows:[['...KK.','GGKKKY','GGGGK.','.Y.Y..'],['...KK.','GGKKKY','GGGGK.','..Y.Y.']],
    pal:[{K:'#2e2e3c',G:'#1c1c26',Y:'#d8a030'}],walk:.45,roam:1.5,out:'day',wet:1,fly:1},
  gull:{rows:[['...KK.','GGKKKY','GGGGK.','.Y.Y..'],['...KK.','GGKKKY','GGGGK.','..Y.Y.']],
    pal:[{K:'#f4f4f8',G:'#a8aec0',Y:'#e8a030'}],walk:.4,roam:1.2,out:'day',wet:1,fly:1},
};
// Which kinds live where: weights by biome (a biome with no row takes meadow's). A gull sits by water in any biome but ash.
const BY_BIOME={meadow:[['deer',.35],['hare',.45],['crow',.2]],fen:[['crow',1]],ash:[['crow',1]],tundra:[['hare',.6],['crow',.4]],highland:[['deer',.5],['hare',.3],['crow',.2]]};
const WILD_DENSITY=.3,CELL=5;
// Town animals: [kind, count] a town.
const TOWN_SET=[['chicken',2],['dog',1],['cat',1],['goat',1]];

// ---- the animals ----
const POOL=[],ROOST=[];
function mk(kind,x,y,town,v){const k=K[kind];
  const sid='sprite:critter-'+kind+'-'+v,e={kind:'deco',ck:kind,K:k,x,y,hx:x,hy:y,tx:x,ty:y,st:0,t:1+lrand()*3,face:1,dir:2,ph:lrand()*9,z:0,al:1,town,v,fx:0,fy:0,sid,fid:sid+'-fly',paint:paintCritter};
  POOL.push(e);return e}
let ready=false,LAND=null;const TOWNOPEN=new Map();
onWorld(()=>{ready=false;LAND=null;TOWNOPEN.clear();POOL.length=0;ROOST.length=0}); // another map (#1013): its own animals, laid by the next frame
export const warmCritters=()=>{if(!ready)init()};
// The open interior tiles of a town (inside the walls, not solid: building footprints and the wall are out).
function townOpen(c){let o=TOWNOPEN.get(c);if(o)return o;const w=c.x1-c.x0+1,h=c.y1-c.y0+1,a=new Uint8Array(w*h);
  for(let y=c.y0+1;y<c.y1;y++)for(let x=c.x0+1;x<c.x1;x++)if(!solidAt(x,y))a[(y-c.y0)*w+(x-c.x0)]=1;
  for(const b of c.buildings||[])if(b.door)a[(b.door[1]-c.y0)*w+(b.door[0]-c.x0)]=0; // a doorway is the building's, not the yard's
  o={x0:c.x0,y0:c.y0,w,h,a};TOWNOPEN.set(c,o);return o}
const inTown=(o,x,y)=>{const tx=Math.floor(x)-o.x0,ty=Math.floor(y)-o.y0;return tx>=0&&ty>=0&&tx<o.w&&ty<o.h&&o.a[ty*o.w+tx]===1};
function init(){ready=true;
  LAND=new Uint8Array(W*H);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const t=tiles[I(x,y)];if((t===G||t===SGRASS||t===FLOWER||t===SNOW||t===MUD)&&!solidAt(x,y))LAND[I(x,y)]=1}
  for(const c of CITY)for(let y=c.y0-2;y<=c.y1+2;y++)for(let x=c.x0-2;x<=c.x1+2;x++)if(x>=0&&y>=0&&x<W&&y<H)LAND[I(x,y)]=0; // the wild keeps off the walls and gates
  for(const L of LANDMARKS)for(let y=Math.floor(L.y-8);y<=L.y+8;y++)for(let x=Math.floor(L.x-8);x<=L.x+8;x++)if(x>=0&&y>=0&&x<W&&y<H)LAND[I(x,y)]=0;
  CITY.forEach((c,ci)=>{const o=townOpen(c),open=[];
    for(let y=c.y0+1;y<c.y1;y++)for(let x=c.x0+1;x<c.x1;x++)if(inTown(o,x+.5,y+.5))open.push([x,y]);
    if(open.length<12)return;
    TOWN_SET.forEach(([kind,n],ki)=>{const cnt=n;
      for(let i=0;i<cnt;i++){const p=open[Math.floor(hash(ci*17+i,ki,31)*open.length)];
        mk(kind,p[0]+.5,p[1]+.5,ci,Math.floor(hash(ci,ki*5+i,3)*K[kind].pal.length))}})});
  for(let cy=0;cy<H;cy+=CELL)for(let cx=0;cx<W;cx+=CELL){
    if(hash(cx,cy,9101)>WILD_DENSITY)continue;
    let hx=-1,hy=-1;for(let k=0;k<8&&hx<0;k++){const x=cx+Math.floor(hash(cx,cy,k+1)*CELL),y=cy+Math.floor(hash(cx,cy,k+21)*CELL);if(x<W&&y<H&&LAND[I(x,y)]){hx=x;hy=y}}
    if(hx<0)continue;const bio=(REGIONS[zone[I(hx,hy)]]||{}).biome,tbl=BY_BIOME[bio]||BY_BIOME.meadow;
    let water=false;for(let dy=-2;dy<=2&&!water;dy++)for(let dx=-2;dx<=2;dx++){const x=hx+dx,y=hy+dy;if(x>=0&&y>=0&&x<W&&y<H&&tiles[I(x,y)]===RIVER){water=true;break}}
    let kind;if(water&&bio!=='ash'&&hash(cx,cy,5)<.6)kind='gull';
    else{let tot=0;for(const q of tbl)tot+=q[1];let r=hash(cx,cy,6)*tot;kind=tbl[tbl.length-1][0];for(const q of tbl){r-=q[1];if(r<=0){kind=q[0];break}}}
    mk(kind,hx+.5,hy+.5,-1,kind==='hare'&&bio==='tundra'?1:0)}
  for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(tiles[I(x,y)]===TREE&&hash(x,y,4411)<.04)ROOST.push({x:x+.5,y:y+.4,t:-1e9,dx:0,dy:1})}
const okAt=(e,x,y)=>{if(e.town>=0)return inTown(townOpen(CITY[e.town]),x,y);const tx=Math.floor(x),ty=Math.floor(y);return tx>=0&&ty>=0&&tx<W&&ty<H&&LAND[ty*W+tx]===1};
function clearLine(e,x0,y0,x1,y1){for(let i=1;i<=4;i++){const f=i/4;if(!okAt(e,x0+(x1-x0)*f,y0+(y1-y0)*f))return false}return true}
const ANG=[0,.785,1.571,2.356,3.142,3.927,4.712,5.498];
// Away from a hero at (hx,hy): the end of whichever of eight lines stays on open ground and ends farthest from them.
function fleeFrom(e,hx,hy,len){let best=-1,bx=0,by=0;
  for(let i=0;i<8;i++){const a=ANG[i]+lrand()*.5,x=e.x+Math.cos(a)*len,y=e.y+Math.sin(a)*len;if(!clearLine(e,e.x,e.y,x,y))continue;
    const d=(x-hx)*(x-hx)+(y-hy)*(y-hy);if(d>best){best=d;bx=x;by=y}}
  if(best<0)return false;e.tx=bx;e.ty=by;return true}
// The sheet row (0 down, 1 left, 2 right, 3 up) of a walk along dx, dy.
const dirTo=(dx,dy)=>Math.abs(dx)>=Math.abs(dy)?(dx<0?1:2):dy<0?3:0;
// One step toward the target; true on arrival or when the next step would leave open ground.
function stepTo(e,sp,dt){const dx=e.tx-e.x,dy=e.ty-e.y,d=Math.hypot(dx,dy);if(d<.08)return true;
  const s=Math.min(d,sp*dt),nx=e.x+dx/d*s,ny=e.y+dy/d*s;if(!okAt(e,nx,ny))return true;
  e.x=nx;e.y=ny;if(Math.abs(dx)>.02)e.face=dx>0?1:-1;e.dir=e.K.side?(e.face<0?1:2):dirTo(dx,dy);return d-s<.08}
function scaredBy(e){for(let i=0;i<F.n;i++){const dx=e.x-F.hx[i],dy=e.y-F.hy[i];if(dx*dx+dy*dy<4)return i}return -1}

// Out of doors now? Day animals by the hour, wet ones not in a downpour.
function outNow(e){const k=e.K;if(k.wet&&WET[skyAt(e.x,e.y)])return false;return k.out==='day'?day(F.hour)>0:true}
// st: 0 idle, 1 wander, 2 flee; birds: 3 rising, 4 away, 5 gliding in. Returns whether to draw.
function update(e,dt){
  const out=outNow(e);if(!out&&e.st<3){e.al=Math.max(0,e.al-dt*1.5);if(e.al<=0)return false}else if(e.al<1)e.al=Math.min(1,e.al+dt*1.5);
  if(e.K.fly)return updateBird(e,dt);
  if(e.st<2){const h=scaredBy(e);if(h>=0&&fleeFrom(e,F.hx[h],F.hy[h],e.K.flee)){e.st=2;e.ph=0}}
  if(e.st===0){e.t-=dt;if(e.t<=0){const far=Math.hypot(e.x-e.hx,e.y-e.hy)>e.K.roam*1.4;
      for(let i=0;i<4;i++){const ang=lrand()*6.283,d=.8+lrand()*e.K.roam,cx=far?e.hx:e.x,cy=far?e.hy:e.y,x=cx+Math.cos(ang)*d,y=cy+Math.sin(ang)*d;
        if(okAt(e,x,y)&&clearLine(e,e.x,e.y,x,y)){e.tx=x;e.ty=y;e.st=1;break}}
      if(e.st===0)e.t=1+lrand()*2}}
  else if(e.st===1){e.ph+=dt*4;if(stepTo(e,e.K.walk,dt)){e.st=0;e.t=1.5+lrand()*4}}
  else if(e.st===2){e.ph+=dt*9;if(stepTo(e,e.K.run,dt)){e.st=0;e.t=e.K.calm*(.7+lrand()*.6)}}
  return true}
function updateBird(e,dt){
  if(e.st<3){const h=scaredBy(e);if(h>=0){const dx=e.x-F.hx[h],dy=e.y-F.hy[h],d=Math.hypot(dx,dy)||1;e.fx=dx/d;e.fy=dy/d;e.dir=dirTo(dx,dy);e.st=3;e.t=0}}
  if(e.st===0){e.t-=dt;if(e.t<=0){const ang=lrand()*6.283,d=.5+lrand()*e.K.roam,x=e.x+Math.cos(ang)*d,y=e.y+Math.sin(ang)*d;
      if(Math.hypot(x-e.hx,y-e.hy)<e.K.roam&&okAt(e,x,y)){e.tx=x;e.ty=y;e.st=1}else e.t=1+lrand()*3}}
  else if(e.st===1){e.ph+=dt*6;if(stepTo(e,e.K.walk,dt)){e.st=0;e.t=2+lrand()*5}}
  else if(e.st===3){e.t+=dt;e.x+=e.fx*5*dt;e.y+=e.fy*5*dt;e.z=Math.min(14,e.t*16);if(e.t>1.7){e.st=4;e.t=14+lrand()*20}}
  else if(e.st===4){e.t-=dt;if(e.t<=0){e.st=5;e.t=0;e.x=e.hx-e.fx*8;e.y=e.hy-e.fy*8;e.z=14}}
  else if(e.st===5){e.t+=dt;const f=Math.min(1,e.t/1.8);e.x=e.hx-e.fx*8*(1-f);e.y=e.hy-e.fy*8*(1-f);e.z=14*(1-f);
    if(f>=1){e.st=0;e.x=e.hx;e.y=e.hy;e.z=0;e.t=3+lrand()*4}}
  return e.st!==4}

// ---- drawing ----
// A bird on the wing: a body and two wing strokes that flap.
function wing(ctx,px,py,t,col){ctx.fillStyle=col;ctx.fillRect(px-1,py-1,3,2);
  if(Math.floor(t*14)&1){ctx.fillRect(px-4,py-3,3,1);ctx.fillRect(px+2,py-3,3,1)}else{ctx.fillRect(px-4,py,3,1);ctx.fillRect(px+2,py,3,1)}}
const STEP=[1,0,2,0],FLAP=[0,1,2,1]; // sheet columns of a walk and of a wingbeat
// A critter's sheet frame at feet px, py, raised by z.
function drawFrame(ctx,G,px,py,z){const w=G.fw/ART,h=G.fh/ART;ctx.drawImage(G.img,G.sx,G.sy,G.fw,G.fh,px-w/2,py-h-z,w,h)}
function paintCritter(ctx,px,py,blink,e){const k=e.K,flying=e.st===3||e.st===5;
  if(e.al<1)ctx.globalAlpha=e.al;
  const G=flying?idFrame(e.fid,e.dir,FLAP[Math.floor((F.now+e.ph)*12)&3]):idFrame(e.sid,e.dir,e.st===1||e.st===2?STEP[Math.floor(e.ph)&3]:0);
  if(G){ctx.fillStyle=MARK.shadow;ctx.beginPath();ctx.ellipse(px,py,flying?4:Math.min(G.fw/ART*.36,10),1.4,0,0,7);ctx.fill();
    drawFrame(ctx,G,px,py,flying?Math.round(e.z):e.st===2&&e.ck==='hare'?Math.abs(Math.sin(e.ph))*3:0);ctx.globalAlpha=1;return}
  if(flying){ctx.fillStyle=MARK.shadow;ctx.beginPath();ctx.ellipse(px,py,4,1.2,0,0,7);ctx.fill();
    wing(ctx,px,py-Math.round(e.z)-4,F.now+e.ph,k.pal[0].G);ctx.globalAlpha=1;return}
  const moving=e.st===1||e.st===2,fr=moving?(Math.floor(e.ph)&1):0,s=sprite('cr_'+e.ck+e.v+fr,k.rows[fr],k.pal[e.v%k.pal.length]),o=worldSprite(s),sh=s.height*PROC_SCALE,ow=1/ART;
  ctx.fillStyle=MARK.shadow;ctx.beginPath();ctx.ellipse(px,py,s.width*PROC_SCALE*.4,1.4,0,0,7);ctx.fill();
  const hop=e.st===2&&e.ck==='hare'?Math.abs(Math.sin(e.ph))*3:0;
  ctx.save();ctx.translate(px,0);if(e.face<0)ctx.scale(-1,1);
  ctx.drawImage(o,-Math.floor(s.width/2)*PROC_SCALE-ow,py-sh-ow-hop,o.width/ART,o.height/ART);ctx.restore();ctx.globalAlpha=1}

// ---- the roosts: a few trees hold two birds that burst out when a hero walks by and settle again ----
const AWAY=45,FLY=2.6,BIRD='#22222e',CROW='sprite:critter-crow-0',CROW_FLY=CROW+'-fly';
export function drawRoostBirds(ctx){if(!ready)init();if(F.tpx<14)return;
  for(const r of ROOST){if(!inTiles(r.x,r.y))continue;
    if(r.t>-1e8&&F.now-r.t>AWAY+FLY)r.t=-1e9;
    if(r.t<-1e8){let h=-1;for(let i=0;i<F.n;i++){if(!F.hm[i])continue;const dx=r.x-F.hx[i],dy=r.y-F.hy[i];if(dx*dx+dy*dy<5){h=i;break}}
      if(h>=0){r.t=F.now;const dx=r.x-F.hx[h],dy=r.y-F.hy[h],d=Math.hypot(dx,dy)||1;r.dx=dx/d;r.dy=dy/d}}
    const a=r.t<-1e8?-1:F.now-r.t,px=Math.round(r.x*T),py=Math.round(r.y*T);
    if(a<0){let G=idFrame(CROW,1,0);if(G){drawFrame(ctx,G,px-4,py-10,0);G=idFrame(CROW,2,0);drawFrame(ctx,G,px+5,py-8,0);continue}
      ctx.fillStyle=BIRD;ctx.fillRect(px-4,py-14,3,2);ctx.fillRect(px+3,py-12,3,2);ctx.fillStyle='#d8a030';ctx.fillRect(px-1,py-14,1,1);ctx.fillRect(px+6,py-12,1,1)}
    else if(a<FLY||a>AWAY){const out=a<FLY,f=out?a/FLY:1-(a-AWAY)/FLY,reach=out?95:60;
      for(let b=0;b<2;b++){const sg=b?1:-1,x=px+(r.dx*sg*.6+(b?.7:-.7)*r.dy)*f*reach,y=py-14-f*30-(out?Math.sin(f*3)*10:0);
        ctx.globalAlpha=Math.min(1,(1-f)*2.2);const G=idFrame(CROW_FLY,r.dx<0?1:2,FLAP[Math.floor((F.now+b*.3)*12)&3]);
        if(G)drawFrame(ctx,G,Math.round(x),Math.round(y)+4,0);else wing(ctx,Math.round(x),Math.round(y),F.now+b*.3,BIRD);ctx.globalAlpha=1}}}}

// ---- the frame's hook: push the critters in view, updated, onto the y-sorted entity list ----
export function critterEnts(ents){if(!ready)init();if(F.tpx<9)return;
  for(const e of POOL){if(e.town<0&&F.tpx<20)continue;if(!inTiles(e.x,e.y,3)&&e.st<3)continue;
    if(!update(e,F.dt))continue;if(inTiles(e.x,e.y))ents.push(e)}}
export const critterCount=()=>POOL.length;
export const critterList=()=>POOL; // for staged shots
export const CRITTER_KINDS=K; // for artcheck
