// The country round a town (chapter maps, after #1059): what a town's people leave about its fields, its strand and its river, by the town's
// own entry in data/townart.js TOWN_PROPS (render may not name towns).
//   farm     a fence of posts and rails along the open side of each of its fields, a rick of hay by the ploughland, a hay cart on the verge
//   fishing  fish drying on racks, nets spread on the grass, a stack of creels and a boat hauled out keel up, on the bank beside its quay
//   mill     a watermill fallen roofless on the bank by the nearest crossing of the river, its wheel still standing in the water
// Everything is placed from the tiles (open ground, roads, water, the scenery note's fields) and hashes of tile coordinates, never a stored
// position; drawn pixel by pixel in the LPC ramps (palette.js COUNTRY, light from the top left), cached once, and stood on the y-sorted list like
// the harbour's boats (townlife.js), so people pass in front of and behind them. Nothing is solid and nothing is told to the sim: no hash moves.
import {hash} from '../core/rng.js';
import {TILE,ART} from './tile.js';
import {G,SGRASS,FLOWER,MUD,ROAD,RIVER,BRIDGE,W,H} from '../world/tiles.js';
import {tiles,I,CITY,MAP_ID} from '../world/map.js';
import {MAPS} from '../world/spec.js';
import {solidAt} from '../world/passable.js';
import {onWorld} from '../sim/kept.js';
import {TOWN_PROPS} from '../data/townart.js';
import {COUNTRY as K,HARBOUR,MOUTH} from './palette.js';
import {pix,finish,mixHex} from './mouths.js';
import {farmAt} from './scenery.js';
import {quayOver} from './harbour.js';
import {F} from './life.js';

const tt=(x,y)=>x>=0&&y>=0&&x<W&&y<H?tiles[I(x,y)]:-1;
const OPEN=new Set([G,SGRASS,FLOWER,MUD]);
const free=(x,y)=>OPEN.has(tt(x,y))&&!solidAt(x+.5,y+.5)&&!farmAt(x,y)&&!CITY.some(c=>x>=c.x0-1&&x<=c.x1+1&&y>=c.y0-1&&y<=c.y1+1);
const near=(x,y,r,t)=>{for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++)if(tt(x+dx,y+dy)===t)return true;return false};

// ---- the pieces, each a raster whose bottom row stands on the ground ----
const C=new Map();
const made=(key,w,h,draw)=>{let im=C.get(key);if(im)return im;const P=pix(w,h);draw(P);P.outline(MOUTH.joint);im=finish(P);C.set(key,im);return im};
// A run of fence n tiles long: a post every half tile, two rails between, the wood lit on top.
const fence=n=>made('fence'+n,n*TILE+4,16,P=>{const w=n*TILE+4;for(const ry of [4,9]){P.rect(1,ry,w-2,2,K.wood[2]);P.rect(1,ry,w-2,1,K.wood[3])}
  for(let x=1;x<w;x+=TILE/2){P.rect(x,1,3,15,K.wood[1]);P.rect(x,1,1,15,K.wood[3]);P.rect(x+1,1,1,1,K.wood[3]);P.set(x+2,14,K.wood[0])}});
// A rick: a dome of hay on a dark foot, two bands of rope round it, a thatched cap.
const rick=()=>made('rick',40,40,P=>{const cx=20;for(let y=0;y<40;y++)for(let x=0;x<40;x++){const u=(x+.5-cx)/18,v=(y+.5-38)/36;if(u*u+v*v>1)continue;
  const l=-.8*u-.7*v-.3+(hash(x,y>>1,601)-.5)*.5;let c=l>.4?K.hay[3]:l>.05?K.hay[2]:l>-.35?K.hay[1]:K.hay[0];if((x+(y>>1))%5===0&&hash(x,y,603)>.4)c=K.hay[0];
  if(y===20||y===29)c=K.rope;if(y>36)c=K.hay[0];P.set(x,y,c)}
  for(let y=1;y<9;y++)for(let x=cx-6+y;x<cx+6-y+(y>>1)+1;x++)P.set(x,y,y<3?K.thatch[1]:K.thatch[0])});
// A hay cart seen side on: a bed of boards on two spoked wheels, the shafts down on the grass ahead, a load of hay heaped on it.
const cart=()=>made('cart',62,40,P=>{const by=24;
  for(let y=6;y<by;y++)for(let x=8;x<50;x++){const u=(x+.5-29)/22,v=(y+.5-by)/18;if(u*u+v*v>1)continue;const l=-.8*u-.8*v-.3+(hash(x,y,611)-.5)*.5;P.set(x,y,l>.35?K.hay[3]:l>0?K.hay[2]:l>-.4?K.hay[1]:K.hay[0])}
  P.rect(6,by,46,5,K.wood[0]);P.rect(7,by+1,44,3,K.wood[2]);P.rect(7,by+1,44,1,K.wood[3]);for(let x=12;x<50;x+=8)P.set(x,by+2,K.wood[1]);
  for(let i=0;i<14;i++)P.set(51+i*.72,by+3+i*.62,K.wood[2]); // the shafts, resting on the grass
  for(const wx of [16,40]){for(let y=-8;y<=8;y++)for(let x=-8;x<=8;x++){const r=Math.hypot(x,y);if(r>8.4)continue;
    if(r>6.6)P.set(wx+x,by+8+y,r>7.6?K.wood[0]:K.wood[2]);else if(Math.abs(x)<1||Math.abs(y)<1||Math.abs(Math.abs(x)-Math.abs(y))<1)P.set(wx+x,by+8+y,K.wood[1])}
    P.rect(wx-1,by+7,3,3,K.iron)}});
// A rack of split fish drying: two crossed legs at each end, a pole, a row of fish hanging silver from it.
const rack=()=>made('rack',52,34,P=>{for(const lx of [4,46]){for(let i=0;i<30;i++){P.set(lx-6+i*.4,33-i,K.wood[1]);P.set(lx+6-i*.4,33-i,K.wood[2])}}
  P.rect(0,4,52,2,K.wood[2]);P.rect(0,4,52,1,K.wood[3]);
  for(let x=8;x<46;x+=5){const L=9+((hash(x,1,621)*5)|0);P.set(x+1,6,K.rope);for(let y=0;y<L;y++){const c=y<2?K.fish[2]:y>L-3?K.fish[0]:y<L*.5?K.fish[2]:K.fish[1];P.set(x,7+y,c);P.set(x+1,7+y,y<L-2?K.fish[1]:K.fish[0]);if(y>L-3)P.set(x+2,7+y,K.fish[0])}}});
// A net spread on the grass to dry: a loose diamond mesh in a ragged patch, floats along one edge.
const net=()=>made('net',58,24,P=>{for(let y=0;y<24;y++)for(let x=0;x<58;x++){const u=(x+.5-29)/28,v=(y+.5-12)/11,q=u*u+v*v+(hash(x>>2,y>>2,631)-.5)*.35;if(q>1)continue;
  if((x+y*2)%6===0||(x-y*2+120)%6===0)P.set(x,y,(x+y)&1?HARBOUR.net[0]:HARBOUR.net[1])}
  for(let x=6;x<52;x+=6)P.rect(x,2+Math.round(Math.abs(x-29)*.12),2,2,K.float)});
// Creels: wicker pots in a stack, three below and two on top.
const creels=()=>made('creels',40,26,P=>{const pot=(x0,y0)=>{for(let y=0;y<11;y++)for(let x=0;x<12;x++){const u=(x+.5-6)/6,v=(y+.5-11)/11;if(u*u+v*v>1)continue;
    P.set(x0+x,y0+y,(x+y)%3===0?K.wicker[0]:(x-y+30)%3===0?K.wicker[1]:u<0&&v<-.4?K.wicker[3]:K.wicker[2])}P.rect(x0+4,y0+1,4,2,K.wicker[0])};
  pot(1,15);pot(14,15);pot(27,15);pot(7,5);pot(20,5)});
// A boat hauled out keel up: the long hull seen from the side and above, planks lapped along it, a dark gap under its edge.
const hauled=()=>made('hauled',76,24,P=>{const cx=38;for(let y=0;y<24;y++)for(let x=0;x<76;x++){const u=(x+.5-cx)/36,v=(y+.5-13)/10;if(Math.pow(Math.abs(u),2.4)+v*v>1)continue;
  const band=Math.floor((y+Math.abs(u)*3)/3.2);let c=HARBOUR.hull[band%2?2:3];if(v<-.6)c=HARBOUR.rim[1];else if(v>.6)c=HARBOUR.hull[0];else if(u>.6)c=mixHex(c,MOUTH.lo,.3);P.set(x,y,c)}
  P.rect(4,21,68,2,K.under)});
// A watermill fallen roofless: two walls of coursed stone and the stump of a gable, a gap where its door was, its wheel standing on the water side.
// side: 1 when the wheel is east of the house. The raster's bottom row is the water line the wheel dips to.
const mill=side=>made('mill'+side,124,72,P=>{const hx=side>0?2:56,hw=66,top=14,base=52;
  for(let x=hx;x<hx+hw;x++){const gable=Math.abs(x-(hx+hw/2))<16&&x<hx+hw/2+4,t=gable?top-Math.round(16-Math.abs(x-(hx+hw/2))):top+Math.round(hash(x>>2,3,641)*12);
    for(let y=t;y<base;y++){const row=(y-base)>>2,c=MOUTH.stones[(hash((x+(row&1)*4)>>3,row,643)*MOUTH.stones.length)|0],j=((y-base)&3)===3||((x+(row&1)*4)&7)===0;
      P.set(x,y,y<t+2?mixHex(c,MOUTH.hi,.3):j?MOUTH.joint:x<hx+2?mixHex(c,MOUTH.hi,.15):x>hx+hw-3?mixHex(c,MOUTH.lo,.3):c)}}
  P.rect(hx+hw/2-6,base-18,12,18,MOUTH.dark[2]);P.rect(hx+hw/2-6,base-18,12,2,MOUTH.dark[0]); // the doorway
  P.rect(hx+12,top+16,6,7,MOUTH.dark[2]);P.rect(hx+hw-18,top+16,6,7,MOUTH.dark[2]); // two windows
  P.rect(hx-1,base,hw+2,3,MOUTH.joint);
  // the wheel: rim, spokes and paddles, dipping into the water below the bank
  const wx=side>0?hx+hw+24:hx-24,wy=54,R=25;for(let y=-R;y<=R;y++)for(let x=-R;x<=R;x++){const r=Math.hypot(x,y),a=Math.atan2(y,x),py=wy+y;if(r>R+.4||py>=72)continue;
    if(r>R-3)P.set(wx+x,py,r>R-1?K.wood[0]:K.wood[2]);else if(r<3)P.set(wx+x,py,K.iron);else if(Math.abs(Math.sin(a*4))<.12)P.set(wx+x,py,K.wood[1]);
    if(r>R-1.5&&(Math.round(a*16/Math.PI)&1))P.set(wx+x,py,K.wood[3])}
  {const a0=side>0?hx+hw:wx,a1=side>0?wx:hx;P.rect(a0,wy-2,a1-a0,3,K.wood[1])} // its axle into the wall
  for(let x=wx-R-2;x<=wx+R+2;x++)if(hash(x,1,645)>.4)P.set(x,69,K.foam)});

// ---- where they go ----
const stand=(x,y,im,shadow)=>({kind:'deco',flat:true,x,y,paint:(ctx,px,py)=>{const w=im.width/ART,h=im.height/ART;
  if(shadow){ctx.fillStyle='rgba(20,16,28,.22)';ctx.fillRect(px-w/2+2,py-2,w,3)}ctx.drawImage(im,px-w/2,py-h,w,h)}});
let plans=null;onWorld(()=>{plans=null;C.clear()});
const fieldsOf=()=>((MAPS[MAP_ID].scenery||{}).fields)||[];
const nearestTown=(x,y)=>{let b=null,bd=1e9;for(const c of CITY){const d=Math.hypot((c.x0+c.x1)/2-x,(c.y0+c.y1)/2-y);if(d<bd){bd=d;b=c}}return b};
const has=(c,k)=>!!c&&(TOWN_PROPS[c.name]||[]).includes(k);
function farm(out){let carts=0;const fl=fieldsOf();fl.forEach(([fx,fy,fw,fh,kind],n)=>{if(!has(nearestTown(fx+fw/2,fy+fh/2),'farm'))return;
    // the fence: the row under the field, in runs of open grass
    const y=fy+fh;let run=[];const flush=()=>{if(run.length>=2)out.push(stand(run[0]+run.length/2,y+.75,fence(run.length),true));run=[]};
    for(let x=fx-1;x<=fx+fw;x++){if(free(x,y)&&tt(x,y)!==MUD)run.push(x);else flush()}flush();
    // a rick at a corner of the ploughland, or every other field's
    if(kind==='plough'||n%2===0)for(const [x,yy] of [[fx+fw,fy],[fx-1,fy],[fx+fw,fy+fh-1],[fx-1,fy+fh-1]])if(free(x,yy)&&free(x,yy-1)){out.push(stand(x+.5,yy+.9,rick(),true));break}
    // a cart on the verge of the road nearest the field, at most two a town
    if(carts<2)for(let r=1;r<=4&&carts<2;r++){let hit=null;for(let x=fx-r;x<=fx+fw+r-1&&!hit;x++)for(const yy of [fy-r,fy+fh+r-1])if(free(x,yy)&&free(x+1,yy)&&near(x,yy,1,ROAD)&&hash(x,yy,651)<.7)hit=[x,yy];
      if(hit){out.push(stand(hit[0]+1,hit[1]+.9,cart(),true));carts++;break}}})}
function fishing(out){for(const c of CITY){if(!has(c,'fishing'))continue;const cand=[];
    for(let y=c.y1-2;y<=c.y1+9;y++)for(let x=c.x0-14;x<=c.x1+14;x++)if(free(x,y)&&near(x,y,2,RIVER)&&!quayOver(x,y)&&!near(x,y,1,ROAD)&&!near(x,y,1,BRIDGE))cand.push([x,y,Math.abs(x+.5-(c.x0+c.x1)/2)+hash(x,y,661)*4]);
    cand.sort((a,b)=>a[2]-b[2]);const kinds=['rack','net','creels','hauled','rack','net','creels'],put=[];
    for(const [x,y] of cand){if(put.length>=kinds.length)break;if(put.some(p=>Math.abs(p[0]-x)<3&&Math.abs(p[1]-y)<2))continue;const k=kinds[put.length];
      if((k==='hauled'||k==='net'||k==='rack')&&!free(x+1,y))continue;put.push([x,y]);
      out.push(stand(x+(k==='creels'?.5:1),y+.85,k==='rack'?rack():k==='net'?net():k==='creels'?creels():hauled(),k!=='net'))}}}
function millOf(out){for(const c of CITY){if(!has(c,'mill'))continue;const g=c.gate||{x:(c.x0+c.x1)/2,y:(c.y0+c.y1)/2};let X=null,bd=1e9;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){const t=tt(x,y);if(t!==BRIDGE&&!(t===RIVER&&!solidAt(x+.5,y+.5)))continue;const d=Math.hypot(x-g.x,y-g.y);if(d<bd&&d<48){bd=d;X=[x,y]}}
    if(!X)continue;let best=null;
    // a bank tile with the river below it and room for the house beside it; the wheel stands over the water on the side away from the crossing
    for(let r=2;r<=9&&!best;r++)for(const dx of [r,-r])for(let dy=-6;dy<=6&&!best;dy++){const x=X[0]+dx,y=X[1]+dy,side=dx>0?1:-1;
      if(tt(x,y+1)!==RIVER||tt(x+side,y+1)!==RIVER||tt(x+side*2,y+1)!==RIVER)continue;if(![-1,0,1].every(k=>free(x-side+k,y)))continue;if(near(x,y,1,ROAD))continue;best=[x,y,side]}
    if(best){const [x,y,side]=best;out.push(stand(x+.5+side*.88,y+1.625,mill(side),false))}}}
function plan(){if(plans)return plans;plans=[];if(!CITY.some(c=>TOWN_PROPS[c.name]))return plans;farm(plans);fishing(plans);millOf(plans);return plans}
// What stands in the country in view, onto the y-sorted list (townlife.js lifeEnts).
export function countryEnts(ents){if(typeof document==='undefined')return;for(const e of plan())if(e.x>F.x0-3&&e.x<F.x1+3&&e.y>F.y0-2&&e.y<F.y1+3)ents.push(e)}
export const countryPlan=()=>plan().map(e=>[e.x,e.y]);
