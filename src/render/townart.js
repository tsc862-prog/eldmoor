// Towns and landmarks as places (#177 slice 3): walls, the gate, the auction house, hall, smithy, chapel, inn and notice
// board of every town in its faction's building style (src/data/townart.js), the crypt mouths and Kragmaw's lair as set
// pieces. Painted into the terrain chunks (terrain.js decorate) in world units: each piece draws its generated asset
// (scripts/art/manifest.json kinds 'building' and 'landmark') when one is loaded at the renderer's tier, and its
// procedural fallback when not: the auction house, the hall, the gate standards, the graves and the crypt mouth as they
// were drawn before this slice; the smithy, chapel, inn, board, walls (the WALL tile texel) and the lair (the ROCK texel)
// had no procedural building and draw nothing extra. With no asset the drawing is exactly the old one.
// Reads the world module only (CITY, LANDMARKS); never the sim, never the map's tiles, so the map hash cannot move.
import {U} from './tile.js';
import {CITY,LANDMARKS} from '../world/map.js';
import {FAC} from '../data/factions.js';
import {TOWN_STYLES,TOWN_PIECES,TOWN_REF,WALL_PIECES,townStyle} from '../data/townart.js';
import {assetPixels,onAssets} from './assets.js';

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

// ---- the plan: every piece with its box in tiles ----
// Turns: 0 as drawn (a north wall, outside up), 1 a quarter turn clockwise (east), 2 south, 3 west.
const SIDE_ROT={N:0,E:1,S:2,W:3};
// A layout box's centre in the town (TOWN_REF, gate east) mapped through the town's gate side and size like the world's
// spots (world/gen.js spotAt); the box keeps its size and the image stays upright.
function placeBox(c,[bx,by,bw,bh]){const fx=(bx+bw/2)/(TOWN_REF[0]-1),fy=(by+bh/2)/(TOWN_REF[1]-1),w=c.w-1,h=c.h-1,g=c.gateSide||'E';
  const p=g==='E'?[c.x0+fx*w,c.y0+fy*h]:g==='W'?[c.x0+(1-fx)*w,c.y0+fy*h]:g==='S'?[c.x0+fy*w,c.y0+fx*h]:[c.x0+fy*w,c.y0+(1-fx)*h];
  return [p[0]-bw/2,p[1]-bh/2,bw,bh]}
// The pieces of town c in drawing order: walls, gate, buildings (back to front). Each {id, box:[x,y,w,h] tiles, rot}.
const planC=new Map();
export function townPlan(c){let P=planC.get(c);if(P)return P;P=[];const st=townStyle(c),id=p=>pieceId(st,p);
  const gate=new Set(c.gateTiles.map(([x,y])=>x+','+y));
  for(let y=c.y0;y<=c.y1;y++)for(let x=c.x0;x<=c.x1;x++){
    const l=x===c.x0,r=x===c.x1,t=y===c.y0,b=y===c.y1;if(!(l||r||t||b)||gate.has(x+','+y))continue;
    if((l||r)&&(t||b))P.push({id:id('wall-corner'),box:[x,y,1,1],rot:t?(l?0:1):(r?2:3)});
    else P.push({id:id('wall'),box:[x,y,1,1],rot:t?0:r?1:b?2:3})}
  {const g=c.gateTiles,xs=g.map(v=>v[0]),ys=g.map(v=>v[1]),side=c.gateSide||'E',along=side==='E'||side==='W';
    const gx=Math.min(...xs),gy=Math.min(...ys);
    P.push({id:id('gate'),box:along?[gx,gy-1,1,g.length+2]:[gx-1,gy,g.length+2,1],rot:SIDE_ROT[side]})}
  const bs=TOWN_PIECES.map(p=>({id:id(p.piece),piece:p.piece,box:placeBox(c,p.box),rot:0}));
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
// Whether a piece of town c draws from its asset (for the procedural fallbacks below).
const drawn=(c,piece)=>!!pieceImage(pieceId(townStyle(c),piece));

// Towns and landmarks whose boxes touch tiles [x0,x1)x[y0,y1), onto ctx in world units (the chunk context is scaled to
// its resolution and translated to the chunk). Called by terrain.js for every chunk it paints.
export function drawPlaces(ctx,x0,y0,x1,y1){
  const T=U,R=(x,y,w,h,c)=>{ctx.fillStyle=c;ctx.fillRect(x,y,w,h)};
  ctx.imageSmoothingEnabled=false;
  for(const c of CITY){
    if(!hits(Math.min(c.x0-2,c.x0-1),c.y0-2,Math.max(c.x0+13,c.x1+2),Math.max(c.y0+9,c.y1+2),x0,y0,x1,y1))continue;
    // generated pieces first (walls, gate, buildings), each where its asset is loaded
    for(const p of townPlan(c)){if(!boxHits(p.box,x0,y0,x1,y1))continue;const img=pieceImage(p.id);if(img)put(ctx,img,p.box,p.rot)}
    // procedural: auction house (faction roof, gold sign) and the hall where no asset drew them, then the gate banners
    // and graveyard stones; drawn relative to the town's top-left corner exactly as before slice 3
    const f=FAC[c.fac],ox=(c.x0-2)*T,dy=(c.y0-2)*T;
    if(!hits(c.x0-2,c.y0-2,c.x0+13,c.y0+9,x0,y0,x1,y1))continue; // layout spans tiles x0+2..x0+12, y0+1..y0+7
    const bld=(x,y,roof,wall,sign)=>{x+=ox;
      R(x,y,48,14,roof);R(x,y,48,2,'#fff3');R(x+1,y+1,46,1,'#fff2');for(let r=4;r<14;r+=3)R(x,y+r,48,1,'#0004');R(x,y+13,48,1,'#0008');
      R(x+2,y+14,44,18,wall);R(x+2,y+30,44,2,'#0006');R(x+2,y+14,44,1,'#fff2');
      R(x+19,y+19,10,13,'#5a3a1c');R(x+20,y+20,8,12,'#3a2414');R(x+26,y+26,1,1,'#f2c14e');
      for(const wx of [x+7,x+35]){R(wx-1,wx===x+7?y+17:y+17,8,8,'#2a1c10');R(wx,y+18,6,6,'#9ad0ff');R(wx+3,y+18,1,6,'#2a1c10');R(wx,y+21,6,1,'#2a1c10');R(wx-1,y+24,8,1,'#d8d0c0')}
      if(sign){R(x+17,y+3,14,7,'#3a2414');R(x+18,y+4,12,5,sign);R(x+20,y+6,8,1,'#8a6a1a')}};
    if(!drawn(c,'auction'))bld(4*T,3*T+dy,f.dark,'#c8b890','#f2c14e');
    if(!drawn(c,'hall'))bld(8*T,3*T+dy,'#6a4a3a','#b8a888');
    for(const gy of [5,8]){const gx=12*T+6+ox,gyy=gy*T+dy-12;R(gx,gyy,2,20,'#3a2a1a');R(gx+2,gyy,8,6,f.color);R(gx+2,gyy+6,3,3,f.color);R(gx+7,gyy+6,3,3,f.color);R(gx+2,gyy+1,8,1,f.dark);R(gx+5,gyy+2,2,2,f.dark)}
    for(let i=0;i<3;i++){const gx=4*T+i*12+ox,gyy=8*T+dy+4;R(gx+1,gyy,4,1,'#5a5a66');R(gx,gyy+1,6,7,'#5a5a66');R(gx+1,gyy+1,4,1,'#6e6e7a');R(gx+2,gyy+3,2,2,'#3a3a46');R(gx-1,gyy+8,8,1,'#3a3a46')}
  }
  // landmarks: the lair's nest (asset only), crypt mouths (asset, else the procedural arch over the 3x3 rock patch)
  for(const p of landmarkPlan()){if(!boxHits(p.box,x0,y0,x1,y1))continue;const img=pieceImage(p.id);
    if(img){put(ctx,img,p.box,p.rot);continue}
    if(p.L.kind!=='crypt')continue;
    const mo=p.L.mouth,x=mo.x0*T,y=mo.y0*T;R(x+6,y+2,36,30,'#4a4652');R(x+6,y+2,36,4,'#78748a');R(x+6,y+2,4,30,'#78748a');R(x+38,y+2,4,30,'#78748a');
    R(x+10,y+6,28,1,'#2e2a34');R(x+16,y+12,16,20,'#0a0810');R(x+15,y+11,18,1,'#2e2a34');R(x+22,y+8,4,2,'#7ad0a0');R(x+23,y+9,2,1,'#c8ffd8');
    R(x+12,y+28,4,4,'#e8e4d8');R(x+32,y+28,4,4,'#e8e4d8');R(x+13,y+29,1,1,'#0a0810');R(x+15,y+29,1,1,'#0a0810');R(x+33,y+29,1,1,'#0a0810');R(x+35,y+29,1,1,'#0a0810')}
}
