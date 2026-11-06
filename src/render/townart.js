// Towns and landmarks as places (#177 slice 3): walls, the gate, the auction house, hall, smithy, chapel, inn and notice
// board of every town in its faction's building style (src/data/townart.js), the crypt mouths and Kragmaw's lair as set
// pieces. Painted into the terrain chunks (terrain.js decorate) in world units: each piece draws its generated asset
// (scripts/art/manifest.json kinds 'building' and 'landmark') when one is loaded at the renderer's tier, and its
// procedural fallback when not: the auction house, the hall, the gate standards, the graves and the crypt mouth as they
// were drawn before this slice; the smithy, chapel, inn, board, walls (the WALL tile texel) and the lair (the ROCK texel)
// had no procedural building and draw nothing extra. With no asset the drawing is exactly the old one.
// Reads the world module only (CITY, LANDMARKS); never the sim, never the map's tiles, so the map hash cannot move.
import {U,TILE,ART} from './tile.js';
import {CITY,LANDMARKS} from '../world/map.js';
import {FAC} from '../data/factions.js';
import {TOWN_STYLES,TOWN_PIECES,WALL_PIECES,townStyle} from '../data/townart.js';
import {assetPixels,assetEntry,onAssets} from './assets.js';
import {drawHouse,drawCryptMouth,sketchPiece} from './pieceart.js';
import {FLAT,TOWN,TOWN_GROUND} from './palette.js';

// Hook table (artcheck: every id here is in the manifest and every manifest entry hooked to this module is here). A piece
// is 'building:<style>-<piece>', but the straight wall is a seamless patch generated like a ground tile ('tile:<style>-wall').
export const pieceId=(style,piece)=>piece==='wall'?`tile:${style}-wall`:`building:${style}-${piece}`;
export const ASSET_TOWNS={};
for(const style of Object.keys(TOWN_STYLES))for(const piece of [...TOWN_PIECES.map(p=>p.piece),...WALL_PIECES])ASSET_TOWNS[pieceId(style,piece)]={style,piece};
ASSET_TOWNS['landmark:crypt-mouth']={landmark:'crypt'};
ASSET_TOWNS['landmark:lair']={landmark:'lair'};

// ---- images ----
// A loaded asset as something drawImage takes: a canvas in the browser, the decoded pixels ({w, h, hex}) with no DOM
// (Node checks draw through a small raster of their own). Cached until the assets change.
const imgC=new Map();
onAssets(()=>imgC.clear());
export function pieceImage(id){if(imgC.has(id))return imgC.get(id);
  const A=assetPixels(id);if(!A)return null; // not cached: it may still arrive
  if(typeof document==='undefined'){imgC.set(id,A);return A}
  const c=document.createElement('canvas');c.width=A.w;c.height=A.h;const x=c.getContext('2d'),img=x.createImageData(A.w,A.h);
  for(let i=0;i<A.w*A.h;i++){const h=A.hex[i];if(!h)continue;const o=i*4;img.data[o]=parseInt(h.slice(1,3),16);img.data[o+1]=parseInt(h.slice(3,5),16);img.data[o+2]=parseInt(h.slice(5,7),16);img.data[o+3]=255}
  x.putImageData(img,0,0);imgC.set(id,c);return c}

// ---- buildings cut from the LPC kits (#833, scripts/art/packcut-buildings.mjs) ----
// One image per style and piece, made for a footprint and a door: the index entry says which (foot, door), so a building of
// another shape in some town's plan keeps its procedural form instead of a stretched image. These stand in front of the
// generated pieces, have no manifest row and are not in ASSET_TOWNS (nothing generates them). An image may be taller than its
// footprint (its roof over the town wall behind): it stands on the footprint's bottom edge, so its box is worked out here.
const lpcId=(c,piece)=>`building:lpc-${townStyle(c)}-${piece}`;
function lpcFits(c,b){const e=assetEntry(lpcId(c,b.piece));if(!e||!e.foot||!e.door)return false;
  return e.foot[0]===b.box[2]&&e.foot[1]===b.box[3]&&e.door[0]===b.door[0]-b.box[0]&&e.door[1]===b.door[1]-b.box[1]}
const lpcImage=(c,b)=>lpcFits(c,b)?pieceImage(lpcId(c,b.piece)):null;
// Ask for every cut building at once: each one that arrives repaints the chunks, so they all come with the first paint and
// never as a hitch when the camera first reaches another town.
let lpcAsked=false;onAssets(id=>{if(id===null)lpcAsked=false});
function lpcAsk(){if(lpcAsked)return;lpcAsked=true;for(const c of CITY){for(const b of c.buildings||[])lpcImage(c,b);for(const k of WALL_KEYS)pieceImage(wallId(c,k))}}
const imgH=img=>(img.h||img.height)/TILE;
const standBox=(b,img)=>{const h=imgH(img);return [b.box[0],b.box[1]+b.box[3]-h,b.box[2],h]};
// Where a cut building's chimney or flag stands, in world units, or null (no such image loaded): the town life puts its smoke
// and pennant there instead of on the procedural form.
export function pieceSpot(c,b,name){const img=lpcImage(c,b),s=img&&(assetEntry(lpcId(c,b.piece)).spots||{})[name];if(!s)return null;
  const q=standBox(b,img);return [q[0]*U+s[0]*U/TILE,q[1]*U+s[1]*U/TILE]}

// ---- walls, towers, gate and plaza cut from the LPC kits (#830, scripts/art/packcut-walls.mjs) ----
// A set per style, drawn only when all of it is loaded (else the WALL and FLOOR tiles as ever). Nothing here is turned: each side of
// the wall is its own cut, because a top-down tile turned by quarter turns puts its face on the wrong side and its light behind it.
// Everything stands inside the wall ring, so no art rises over ground anybody walks: a tower is two ring tiles, a corner's
// base on the lower one; the tall pier stands on the ring above the gate. These have no manifest row and no ASSET_TOWNS entry.
const WALL_KEYS=['plaza','wall-n','wall-e','wall-s','wall-w','tower','pier','pier-tall'];
const wallId=(c,k)=>`${k==='plaza'||k.startsWith('wall')?'tile':'building'}:lpc-${townStyle(c)}-${k}`;
function wallSet(c){const o={};for(const k of WALL_KEYS){const i=pieceImage(wallId(c,k));if(!i)return null;o[k]=i}return o}
const SIDES='nesw';
const iw=i=>i.w||i.width,ih=i=>i.h||i.height;
// One tile of a patch, sampled by the tile's place in the world, so a patch runs on across tiles and chunks.
function tileOf(ctx,img,tx,ty){const sx=(tx*TILE)%iw(img),sy=(ty*TILE)%ih(img);ctx.drawImage(img,sx,sy,TILE,TILE,tx*U,ty*U,U,U)}
// Towers and piers of town c: {key, box} in tiles, in drawing order (north first, so the nearer one stands in front).
function townPosts(c){const g=c.gateTiles,xs=g.map(v=>v[0]),ys=g.map(v=>v[1]),side=c.gateSide||'E',P=[];
  for(const x of [c.x0,c.x1]){P.push({key:'tower',box:[x,c.y0,1,2]},{key:'tower',box:[x,c.y1-1,1,2]})}
  if(side==='E'||side==='W'){const x=xs[0],a=Math.min(...ys),b=Math.max(...ys);P.push({key:'pier-tall',box:[x,a-2,1,2]},{key:'pier',box:[x,b+1,1,1]})}
  else{const y=ys[0];P.push({key:'pier',box:[Math.min(...xs)-1,y,1,1]},{key:'pier',box:[Math.max(...xs)+1,y,1,1]})}
  return P.sort((p,q)=>(p.box[1]+p.box[3])-(q.box[1]+q.box[3]))}
// What stands on the ground throws a shadow to the lower right. A town's shadows are one mask in art pixels, every box swept along
// the light, so neighbours merge instead of doubling; kept as row runs in world units, made once a town.
const SHADOW='#14101c50',SWEEP={wall:6,post:9,building:8,low:3};
const shadowC=new Map();
function townShadow(c){let R=shadowC.get(c);if(R)return R;
  const x0=c.x0-1,y0=c.y0-1,W=(c.x1-c.x0+4)*TILE,H=(c.y1-c.y0+4)*TILE,m=new Uint8Array(W*H),gate=new Set(c.gateTiles.map(([x,y])=>x+','+y));
  const sweep=([bx,by,bw,bh],n)=>{const X=(bx-x0)*TILE,Y=(by-y0)*TILE,w=bw*TILE,h=bh*TILE;
    for(let d=1;d<=n;d++)for(let y=Y+d;y<Y+h+d;y++)if(y>=0&&y<H)for(let x=X+d;x<X+w+d;x++)if(x>=0&&x<W)m[y*W+x]=1};
  for(let y=c.y0;y<=c.y1;y++)for(let x=c.x0;x<=c.x1;x++)if((x===c.x0||x===c.x1||y===c.y0||y===c.y1)&&!gate.has(x+','+y))sweep([x,y,1,1],SWEEP.wall);
  for(const p of townPosts(c))sweep(p.box,SWEEP.post);
  for(const b of c.buildings||[])sweep(b.box,b.piece==='board'?SWEEP.low:SWEEP.building);
  R=[];const k=U/TILE;for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(!m[y*W+x])continue;let e=x;while(e<W&&m[y*W+e])e++;R.push([x0*U+x*k,y0*U+y*k,(e-x)*k,k]);x=e}
  shadowC.set(c,R);return R}
// A stone sill across the gate where the road meets the paving, on the wall's outer edge and its inner one.
function sill(ctx,c){const g=c.gateTiles,side=c.gateSide||'E',P=TOWN_GROUND[townStyle(c)],a=U/TILE,along=side==='E'||side==='W';
  const x=Math.min(...g.map(v=>v[0]))*U,y=Math.min(...g.map(v=>v[1]))*U,n=g.length*U;
  const bar=(at,w,col)=>{ctx.fillStyle=col;if(along)ctx.fillRect(x+at,y,w,n);else ctx.fillRect(x,y+at,n,w)};
  const far=side==='E'||side==='S'?U-5*a:0,near=side==='E'||side==='S'?0:U-2*a;
  bar(far,5*a,P.plaza[3]);bar(far,a,P.plaza[0]);bar(far+4*a,a,P.plaza[0]);bar(far+2*a,a,P.plaza[1]);bar(near,2*a,P.plaza[0])}
// The town's ground and ring for the tiles [x0,x1)x[y0,y1): plaza, shadows, walls, then towers and piers.
function cutGround(ctx,c,set,x0,y0,x1,y1){
  for(let y=Math.max(c.y0+1,y0);y<Math.min(c.y1,y1);y++)for(let x=Math.max(c.x0+1,x0);x<Math.min(c.x1,x1);x++)tileOf(ctx,set.plaza,x,y);
  for(const [x,y] of c.gateTiles)if(x>=x0&&x<x1&&y>=y0&&y<y1)tileOf(ctx,set.plaza,x,y);
  sill(ctx,c);
  ctx.fillStyle=SHADOW;for(const [x,y,w,h] of townShadow(c))if(x<x1*U&&x+w>x0*U&&y<y1*U&&y+h>y0*U)ctx.fillRect(x,y,w,h);
  const ring=(x,y,s)=>{if(x>=x0&&x<x1&&y>=y0&&y<y1)tileOf(ctx,set['wall-'+s],x,y)};
  for(const p of townPlan(c)){if(p.side)ring(p.box[0],p.box[1],p.side);else if(p.corner)ring(p.box[0],p.box[1],p.corner)}
  for(const p of townPosts(c))if(boxHits(p.box,x0,y0,x1,y1))put(ctx,set[p.key],p.box,0)}
// The gate's standards where the cut piers stand: a pole and a cloth in the faction's colours, in art pixels.
function cutBanners(ctx,c,x0,y0,x1,y1,R){const f=FAC[c.fac],a=1/ART;
  for(const p of townPosts(c)){if(p.key==='tower'||!boxHits(p.box,x0,y0,x1,y1))continue;const px=p.box[0]*U+13,py=p.box[1]*U-2;
    R(px-a,py,a*3,18,'#14101c');R(px,py,a,18,'#a8804a');R(px-a,py-a,a*3,a*2,'#f2c14e');
    R(px+a*2,py+a,9,7,'#14101c');R(px+a*2,py+a*2,9-a,6,f.color);R(px+a*2,py+a*2,9-a,a,f.dark);R(px+a*4,py+a*5,a*2,6-a*3,f.dark);R(px+9-a*2,py+a*2,a,6,f.dark);
    for(let i=0;i<4;i++)R(px+a*2+i*a*4,py+8-((i&1)?a*3:0)+a,a*3,a,'#14101c')}}

// ---- the plan: every piece with its box in tiles ----
// Turns: 0 as drawn (a north wall, outside up), 1 a quarter turn clockwise (east), 2 south, 3 west.
const SIDE_ROT={N:0,E:1,S:2,W:3};
// The pieces of town c in drawing order: walls, gate, buildings (back to front). Each {id, box:[x,y,w,h] tiles, rot}.
const planC=new Map();
export function townPlan(c){let P=planC.get(c);if(P)return P;P=[];const st=townStyle(c),id=p=>pieceId(st,p);
  const gate=new Set(c.gateTiles.map(([x,y])=>x+','+y));
  for(let y=c.y0;y<=c.y1;y++)for(let x=c.x0;x<=c.x1;x++){
    const l=x===c.x0,r=x===c.x1,t=y===c.y0,b=y===c.y1;if(!(l||r||t||b)||gate.has(x+','+y))continue;
    if((l||r)&&(t||b))P.push({id:id('wall-corner'),box:[x,y,1,1],rot:t?(l?0:1):(r?2:3),corner:t?'n':'s'});
    else P.push({id:id('wall'),box:[x,y,1,1],rot:t?0:r?1:b?2:3,side:SIDES[t?0:r?1:b?2:3]})}
  {const g=c.gateTiles,xs=g.map(v=>v[0]),ys=g.map(v=>v[1]),side=c.gateSide||'E',along=side==='E'||side==='W';
    const gx=Math.min(...xs),gy=Math.min(...ys);
    P.push({id:id('gate'),box:along?[gx,gy-1,1,g.length+2]:[gx-1,gy,g.length+2,1],rot:SIDE_ROT[side]})}
  const bs=(c.buildings||[]).map(b=>({id:id(b.piece),piece:b.piece,box:b.draw||b.box,rot:0,b})); // the plan is world data (c.buildings, gen.js planBuildings, #793)
  bs.sort((a,b)=>(a.box[1]+a.box[3])-(b.box[1]+b.box[3])||a.box[0]-b.box[0]);
  P.push(...bs);planC.set(c,P);return P}
// Landmark pieces: every crypt mouth over its rock patch, and every lair's nest over its inner disc, turned so its
// opening faces the lair's mouth (drawn opening west).
const LAIR_ROT={W:0,N:1,E:2,S:3};
export function landmarkPlan(){const P=[];
  for(const L of LANDMARKS){
    if(L.kind==='crypt'&&L.mouth){const m=L.mouth;P.push({id:'landmark:crypt-mouth',L,box:[m.x0,m.y0,m.x1-m.x0+1,m.y1-m.y0+1],rot:0})}
    else if(L.kind==='lair'){const r=L.inner||4;P.push({id:'landmark:lair',L,box:[L.x-r,L.y-r,2*r,2*r],rot:LAIR_ROT[L.opening]||0})}}
  return P}

// ---- drawing ----
const hits=(ax0,ay0,ax1,ay1,x0,y0,x1,y1)=>ax0<x1&&ax1>x0&&ay0<y1&&ay1>y0;
const boxHits=(b,x0,y0,x1,y1)=>hits(b[0],b[1],b[0]+b[2],b[1]+b[3],x0,y0,x1,y1);
// Draw img over the tile box, turned rot quarter turns clockwise (the source is the box's size before turning).
function put(ctx,img,[bx,by,bw,bh],rot){const x=bx*U,y=by*U,w=bw*U,h=bh*U;
  if(!rot){ctx.drawImage(img,x,y,w,h);return}
  const dw=rot&1?h:w,dh=rot&1?w:h;ctx.save();ctx.translate(x+w/2,y+h/2);ctx.rotate(rot*Math.PI/2);ctx.drawImage(img,-dw/2,-dh/2,dw,dh);ctx.restore()}
// The base strip under a generated building (#763): the procedural house stands on a darker ground strip, so a generated
// one does too, over the bottom BASE world units of its box (the building recipe leaves those art rows clear, post.base),
// where the eye reads it as the footing instead of a sticker on the plaza. Inside the box, so the chunk tests hold.
const BASE=2;
function base(ctx,[bx,by,bw,bh]){const x=bx*U,y=(by+bh)*U;ctx.fillStyle='#0006';ctx.fillRect(x+1,y-BASE,bw*U-2,BASE);ctx.fillStyle='#0003';ctx.fillRect(x,y-BASE,1,BASE);ctx.fillRect(x+bw*U-1,y-BASE,1,BASE)}
// Whether a piece of town c draws from its asset (for the procedural fallbacks below).
const drawn=(c,b)=>!!b&&(!!lpcImage(c,b)||!!pieceImage(pieceId(townStyle(c),b.piece)));
const building=(c,piece)=>(c.buildings||[]).find(b=>b.piece===piece);

// Towns and landmarks whose boxes touch tiles [x0,x1)x[y0,y1), onto ctx in world units (the chunk context is scaled to
// its resolution and translated to the chunk). Called by terrain.js for every chunk it paints.
export function drawPlaces(ctx,x0,y0,x1,y1){
  const T=U,R=(x,y,w,h,c)=>{ctx.fillStyle=c;ctx.fillRect(x,y,w,h)};
  ctx.imageSmoothingEnabled=false;lpcAsk();
  for(const c of CITY){
    if(!hits(Math.min(c.x0-2,c.x0-1),c.y0-2,Math.max(c.x0+13,c.x1+2),Math.max(c.y0+9,c.y1+2),x0,y0,x1,y1))continue;
    // the town's ground and ring cut from the LPC kit stand in front of any generated wall
    const walls=wallSet(c);if(walls)cutGround(ctx,c,walls,x0,y0,x1,y1);
    // generated pieces first (walls, gate, buildings), each where its asset is loaded
    for(const p of townPlan(c)){if(walls&&!p.piece)continue;const cut=p.b&&lpcImage(c,p.b);if(cut){const q=standBox(p.b,cut);if(boxHits(q,x0,y0,x1,y1))put(ctx,cut,q,0);continue}
      if(!boxHits(p.box,x0,y0,x1,y1))continue;const img=pieceImage(p.id);if(!img)continue;if(p.piece)base(ctx,p.box);put(ctx,img,p.box,p.rot)}
    // the smithy, chapel, inn and notice board where no asset drew them (#795): the pieces are solid ground now, so they
    // stand as the sketch the art pipeline starts from, in the town style's flat palette, and the town's smoke and lamps have a home
    {const st=townStyle(c),col={...FLAT[st],stone:TOWN[st].stone};
     for(const b of c.buildings||[]){if(b.piece==='auction'||b.piece==='hall'||drawn(c,b))continue;const d=b.draw||b.box,bx=d[0]*T,by=d[1]*T;
       if(!boxHits(d,x0,y0,x1,y1))continue;sketchPiece((x,y,w,h,k)=>{ctx.fillStyle=k;ctx.fillRect(bx+x,by+y,w,h)},b.piece,col)}}
    // procedural: auction house (faction roof, gold sign) and the hall where no asset drew them, then the gate banners
    // and graveyard stones; drawn relative to the town's top-left corner exactly as before slice 3
    const f=FAC[c.fac],ox=(c.x0-2)*T,dy=(c.y0-2)*T;
    if(!hits(c.x0-2,c.y0-2,c.x0+13,c.y0+9,x0,y0,x1,y1))continue; // layout spans tiles x0+2..x0+12, y0+1..y0+7
    const bld=(x,y,roof,wall,sign)=>drawHouse(R,x+ox,y,roof,wall,sign);
    if(!drawn(c,building(c,'auction')))bld(4*T,3*T+dy,f.dark,'#c8b890','#f2c14e');
    if(!drawn(c,building(c,'hall')))bld(8*T,3*T+dy,'#6a4a3a','#b8a888');
    if(walls)cutBanners(ctx,c,x0,y0,x1,y1,R);else for(const gy of [5,8]){const gx=12*T+6+ox,gyy=gy*T+dy-12;R(gx,gyy,2,20,'#3a2a1a');R(gx+2,gyy,8,6,f.color);R(gx+2,gyy+6,3,3,f.color);R(gx+7,gyy+6,3,3,f.color);R(gx+2,gyy+1,8,1,f.dark);R(gx+5,gyy+2,2,2,f.dark)}
    for(let i=0;i<3;i++){const gx=4*T+i*12+ox,gyy=8*T+dy+4;R(gx+1,gyy,4,1,'#5a5a66');R(gx,gyy+1,6,7,'#5a5a66');R(gx+1,gyy+1,4,1,'#6e6e7a');R(gx+2,gyy+3,2,2,'#3a3a46');R(gx-1,gyy+8,8,1,'#3a3a46')}
  }
  // landmarks: the lair's nest (asset only), crypt mouths (asset, else the procedural arch over the 3x3 rock patch)
  for(const p of landmarkPlan()){if(!boxHits(p.box,x0,y0,x1,y1))continue;const img=pieceImage(p.id);
    if(img){put(ctx,img,p.box,p.rot);continue}
    if(p.L.kind!=='crypt')continue;
    drawCryptMouth(R,p.L.mouth.x0*T,p.L.mouth.y0*T)}
}
