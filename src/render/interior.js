// Dungeon interiors (#85, slice 1): the art of a dungeon's own small map (src/world/interior.js) and its live marks.
//   interiorTexture(m)  the whole interior painted once per texel into an offscreen canvas (cached per interior):
//                       flagstone chambers, rough corridors, brick wall faces under dark wall tops, a pool where a
//                       room speaks of water, the stair up to the world, door leaves, the boss dais, and the props
//                       (bones, pillars, candles, urns, braziers, a sarcophagus or a drowned throne) baked on top.
//   drawInterior(ctx, box, m, st, now, dpr)  one frame: the texture fitted into box (device px), candle and brazier
//                       light, fog over chambers not yet reached, cleared badges, the chamber in progress outlined
//                       with its round, the boss chamber's skull, chamber names at a constant CSS size, the party.
// st (render/dungeonview.js stateOf): {fog: index of the last room reached or -1 for none, cleared:[bool], cur, round,
//   party:[hero], at: 'stair'|null, spot: the room the party stands in when it is not cur}. Read-only: nothing here touches the sim.
// Style (docs/ART-PLAN.md): light from the top left, ground in mid values, entities outlined and owning the extremes.
import {T} from '../world/tiles.js';
import {IT} from '../world/interior.js';
import {hash} from '../core/rng.js';
import {DUNGEON as D,TEXT,MARK} from './palette.js';
import {sprite,outlined,heroSprite} from './sprites.js';

const mix=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
const walk=t=>t!==IT.VOID&&t!==IT.WALL;

// ---- the texture, once per interior ----
const texCache=new Map();
export function interiorTexture(m){const key=m.seed+':'+m.w+'x'+m.h;let c=texCache.get(key);if(c)return c;
  c=document.createElement('canvas');c.width=m.w*T;c.height=m.h*T;const x=c.getContext('2d'),img=x.createImageData(c.width,c.height),d=img.data;
  const s=m.seed%9973,h=(a,b,k)=>hash(a,b,s+k),tile=(tx,ty)=>tx<0||ty<0||tx>=m.w||ty>=m.h?IT.VOID:m.tiles[ty*m.w+tx];
  for(let ty=0;ty<m.h;ty++)for(let tx=0;tx<m.w;tx++){const t=tile(tx,ty);if(t===IT.VOID)continue;
    const up=tile(tx,ty-1),dn=tile(tx,ty+1),lf=tile(tx-1,ty),rt=tile(tx+1,ty);
    for(let py=0;py<T;py++)for(let px=0;px<T;px++){const gx=tx*T+px,gy=ty*T+py,n=h(gx,gy,2);let col;
      if(t===IT.FLOOR||t===IT.HALL||t===IT.DOOR){ // flagstones (chambers 8 px, corridors rougher 4-6 px)
        const R=t===IT.FLOOR?D.floor:D.hall,sz=t===IT.FLOOR?8:5,row=Math.floor(gy/sz),off=(row&1)*(sz>>1),sx=Math.floor((gx+off)/sz),lx=(gx+off)%sz,ly=gy%sz,v=h(sx,row,1);
        if(lx===0||ly===0)col=D.mortar;
        else{col=mix(R[1],v<.5?R[2]:R[0],Math.abs(v-.5)*.6);
          if(lx===1||ly===1)col=mix(col,R[0],.55);else if(lx===sz-1||ly===sz-1)col=mix(col,R[2],.6);
          if(n<.07)col=mix(col,R[2],.5);if(h(sx,row,3)<.22&&n<.16)col=mix(col,D.moss,.7)}
        if(t===IT.DOOR){const vert=walk(up)&&walk(dn);const a=vert?px:py; // an open door leaf folded against one side, a threshold across
          if(a<3)col=a===0?D.wood[2]:a===1?D.wood[0]:D.wood[1];else if((vert?py:px)===(walk(vert?dn:rt)?15:0))col=D.mortar}}
      else if(t===IT.WALL){
        if(walk(dn)){ // a brick face lit from above, its cap on top
          const row=Math.floor(py/4),off=(row&1)*4,lx=(gx+off)&7,ly=py&3,v=h(Math.floor((gx+off)/8),gy>>2,4);
          if(py<2)col=py===0?D.wallFace[0]:mix(D.wallFace[0],D.wallFace[1],.5);
          else if(lx===0||ly===0)col=D.mortar;else{col=mix(D.wallFace[1],v<.5?D.wallFace[2]:D.wallFace[0],Math.abs(v-.5)*.5);if(ly===1)col=mix(col,D.wallFace[0],.4);if(ly===3)col=mix(col,D.wallFace[2],.5)}
          if(py>=13)col=mix(col,D.wallFace[2],.35*(py-12))} // the foot of the wall in shadow
        else{col=mix(D.wallTop[1],D.wallTop[2],n*.6); // the wall's top, with a lit rim toward the open side
          if((walk(up)&&py<2)||(walk(lf)&&px<2)||(walk(rt)&&px>13))col=D.wallTop[0];if(n>.97)col=D.wallFace[2]}}
      else if(t===IT.WATER){col=D.water[1];
        if(up!==IT.WATER&&py<3)col=mix(D.water[2],D.water[1],py/3); // the rim's shadow on the water
        else if(lf!==IT.WATER&&px<2)col=D.water[2];
        else{const r=Math.floor(gy/3);if((gx+r*2)%9===0&&h(Math.floor(gx/9),r,5)<.45)col=mix(D.water[1],D.water[0],.45);if(n<.006)col=D.water[0]}}
      else if(t===IT.STAIR){const ly=py&3;col=ly===0?D.stair[0]:ly===3?D.stair[2]:D.stair[1];
        if((lf!==IT.STAIR&&px<2)||(rt!==IT.STAIR&&px>13))col=mix(col,D.stair[2],.6);if(n<.05)col=mix(col,D.stair[2],.4);
        col=mix(col,[200,210,190],Math.max(0,.35-ty*.08))} // daylight on the top steps
      else if(t===IT.DAIS){col=D.dais[1];
        if((up!==IT.DAIS&&py===0)||(lf!==IT.DAIS&&px===0))col=D.dais[0];else if((dn!==IT.DAIS&&py>=14)||(rt!==IT.DAIS&&px>=15))col=D.dais[2];
        else{const cx=Math.abs(px-7.5),cy=Math.abs(py-7.5);if(Math.round(cx+cy)===5&&h(tx,ty,7)<.7)col=mix(D.dais[1],D.rune,.5);else if(n<.08)col=mix(col,D.dais[2],.4)}}
      else col=D.void;
      const o=(gy*c.width+gx)*4;d[o]=col[0];d[o+1]=col[1];d[o+2]=col[2];d[o+3]=255}}
  x.putImageData(img,0,0);
  for(const p of m.props)prop(x,p);
  texCache.set(key,c);return c}

// ---- props: pixel strings (sprites.js cache) baked into the texture ----
const BONES=["....WWWW......","...WWWWWW.W..W","...WDWWDW.WWWW","W..WWWWWW.W..W","WWWWWDDWWWWWW.","WDDDWWWWDDDDW."];
const PILLAR=["HHHHHHHHHH","SLLLLLLLLS",".LLMMMMMS.",".LMMMMMMS.",".LMMMMMMS.",".LMMMMMMS.",".LMMMMMMS.",".LMMMMMMS.",".LMMMMMMS.",".LMMMMMMS.",".LMMMMMMS.",".LMMMMMMS.",".LMMMMMMS.",".LMMMMMMS.","HLLLLLLLLS","SSSSSSSSSS"];
const CANDLE=["..F..",".FYF.","..Y..",".WWW.",".WWW.",".WWD.",".WWD.","DDDDD"];
const URN=["..DDDD..","...LL...","..LMMS..",".LMMMMS.",".LMMMMS.",".LMMMMS.","..MMMS..","..SSSS..",".DDDDDD."];
const BRAZIER=["...G....","..GgG...",".GgWgG..","..GgG...","BBBBBBBB",".BMMMMB.","..BMMB..","...BB...","..B..B..",".B....B."];
const SARC=[
  "..LLLLLLLLLLLLLLLLLLLLLL..",
  ".LMMMMMMMMMMMMMMMMMMMMMMS.",
  "LMMMMMMMMMMMMMMMMMMMMMMMMS",
  "LMMMHHMMMMMMMMMMMMMMMMMMMS",
  "LMMHHHHMMMMMMMMMMMMMMMMMMS",
  "LMMHGGHHHHHHHHHHHHHHHMMMMS",
  "LMMHHHHMMMMMMMMMMMMMMMMMMS",
  "LMMMHHMMMMMMMMMMMMMMMMMMMS",
  "LMMMMMMMMMMMMMMMMMMMMMMMMS",
  "SSSSSSSSSSSSSSSSSSSSSSSSSS",
  "SDDDDDDDDDDDDDDDDDDDDDDDDS",
  "SDDDGDDDDDDDDDDDDDDDDGDDDS",
  "SDDDDDDDDDDDDDDDDDDDDDDDDS",
  "SSSSSSSSSSSSSSSSSSSSSSSSSS"];
const THRONE=["..L........S..",".LMS......LMS.",".LMS......LMS.",".LMSLLLLLLLMS.",".LMMMMMMMMMMS.",".LMMMGMMGMMMS.",".LMMMMMMMMMMS.",".LMMMMMMMMMMS.","LLLLLLLLLLLLLS","SMMMMMMMMMMMMS","SDDDDDDDDDDDDS",".SD........DS.",".SD........DS."];
const STONE={L:'#a8a4ba',M:'#7c7890',S:'#4a4658',H:'#c8c4d8',D:'#34303e',G:'#7ad0a0'};
const PROPS={
  bones:  {rows:BONES,map:{W:'#e8e4d8',D:'#8a8678'},ox:1,oy:9},
  pillar: {rows:PILLAR,map:{H:'#b8b4c8',L:'#9894aa',M:'#76728a',S:'#4a4658'},ox:3,oy:-2},
  candle: {rows:CANDLE,map:{F:'#ff8a3a',Y:'#ffd866',W:'#e8e0c8',D:'#6a6070'},ox:5,oy:6,light:'warm'},
  urn:    {rows:URN,map:{L:'#b07a4a',M:'#8a5a32',S:'#5a3a20',D:'#2a1a10'},ox:4,oy:6},
  brazier:{rows:BRAZIER,map:{G:'#3fae7a',g:'#7ad0a0',W:'#c8ffd8',B:'#2a2630',M:'#5a5666'},ox:4,oy:4,light:'crypt'},
  sarcophagus:{rows:SARC,map:STONE,ox:-5,oy:4},
  throne: {rows:THRONE,map:STONE,ox:1,oy:2},
};
function prop(x,p){const P=PROPS[p.kind];if(!P)return;const s=outlined(sprite('dg-'+p.kind,P.rows,P.map));x.drawImage(s,p.x*T+P.ox-1,p.y*T+P.oy-1)}

// ---- light and fog ----
let glowC=null;
function glowSprite(){if(glowC)return glowC;glowC={};
  for(const [k,c] of [['warm',[255,170,70]],['crypt',D.ghost]]){const cv=document.createElement('canvas');cv.width=cv.height=64;const x=cv.getContext('2d'),g=x.createRadialGradient(32,32,0,32,32,32);
    g.addColorStop(0,'rgba('+c.join(',')+',.55)');g.addColorStop(1,'rgba('+c.join(',')+',0)');x.fillStyle=g;x.fillRect(0,0,64,64);glowC[k]=cv}
  return glowC}
// One texel per tile: dark over everything past the last room reached (rooms and the corridors that lead to them).
const fogCache=new Map();
function fogOf(m,reached){const key=m.seed+':'+reached;let c=fogCache.get(key);if(c)return c;
  c=document.createElement('canvas');c.width=m.w;c.height=m.h;const x=c.getContext('2d'),img=x.createImageData(m.w,m.h),d=img.data;
  for(let i=0;i<m.w*m.h;i++){const r=m.reg[i];if(r<0||r<=2*reached)continue;d[i*4]=D.void[0];d[i*4+1]=D.void[1];d[i*4+2]=D.void[2];d[i*4+3]=D.fogA}
  x.putImageData(img,0,0);fogCache.set(key,c);return c}

// ---- one frame ----
// box: {x, y, w, h} in device px. Returns the fit {sc, ox, oy} so the caller can map pointer positions later.
export function drawInterior(ctx,box,m,st,now,dpr=1){
  const tex=interiorTexture(m);let sc=Math.min(box.w/(m.w*T),box.h/(m.h*T));if(sc>=2)sc=Math.floor(sc);else if(sc>1)sc=Math.floor(sc*4)/4;
  const ox=Math.round(box.x+(box.w-m.w*T*sc)/2),oy=Math.round(box.y+(box.h-m.h*T*sc)/2);
  ctx.setTransform(1,0,0,1,0,0);ctx.imageSmoothingEnabled=false;ctx.drawImage(tex,0,0,tex.width,tex.height,ox,oy,Math.round(m.w*T*sc),Math.round(m.h*T*sc));
  ctx.setTransform(sc,0,0,sc,ox,oy);
  // flickering light from candles and braziers in rooms the party can see
  const G=glowSprite(),reached=st.fog;ctx.globalCompositeOperation='lighter';
  for(const p of m.props){const P=PROPS[p.kind];if(!P||!P.light)continue;const r=m.reg[p.y*m.w+p.x];if(reached>=0&&r>2*reached)continue;
    const f=.75+.25*Math.sin(now*7+p.x*1.7+p.y),R=P.light==='crypt'?44:30;ctx.globalAlpha=f;ctx.drawImage(G[P.light],p.x*T+8-R,p.y*T+8-R,R*2,R*2)}
  if(st.party&&st.party.length){const pp=partySpot(m,st);ctx.globalAlpha=.7;ctx.drawImage(G.warm,pp.x*T-52,pp.y*T-52,104,104)} // the party's torches
  ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  if(reached>=0&&reached<m.rooms.length-1)ctx.drawImage(fogOf(m,reached),0,0,m.w*T,m.h*T);
  // chamber marks: the boss skull (always), cleared badges, the chamber in progress
  const px1=dpr/sc,pulse=.75+.25*Math.sin(now*4);
  for(const r of m.rooms){const seen=reached<0||r.i<=reached;
    if(st.cleared&&st.cleared[r.i]){ctx.fillStyle=MARK.edge;ctx.fillRect(r.x*T+r.w*T-11,r.y*T+2,10,9);ctx.fillStyle=D.clear; // a tick in a dark badge
      for(const [a,b] of [[1,4],[2,5],[3,6],[4,5],[5,4],[6,3],[7,2]])ctx.fillRect(r.x*T+r.w*T-11+a,r.y*T+2+b,2,1)}
    if(r.boss)skull(ctx,Math.round(r.cx*T)-4,Math.round(r.y*T-5-13*px1-12),1); // above the chamber's name, fog or not
    if(st.cur===r.i){ctx.save();ctx.strokeStyle=D.cur;ctx.globalAlpha=pulse;ctx.lineWidth=2*px1;ctx.strokeRect(r.x*T+px1,r.y*T+px1,r.w*T-2*px1,r.h*T-2*px1);ctx.restore()}} // the outline sits inside the floor, so the wall faces never hide it
  // the party, outlined hero sprites in a line facing the chamber; they step while a scene is playing
  if(st.party&&st.party.length){const pp=partySpot(m,st),n=st.party.length,fr=st.busy?Math.floor(now*2.2)&1:0;
    st.party.forEach((a,k)=>{const s=outlined(heroSprite(a,false,(fr+k)&1&&st.busy?1:0)),x=Math.round((pp.x+(k-(n-1)/2)*1.05)*T-s.width/2),y=Math.round(pp.y*T+(k&1?3:0)-s.height);
      ctx.fillStyle=MARK.shadow;ctx.beginPath();ctx.ellipse(x+s.width/2,y+s.height-1,5,1.5,0,0,7);ctx.fill();ctx.drawImage(s,x,y)})}
  // names at a constant CSS size, above each chamber; unreached ones are a question mark
  const compact=T*sc/dpr<10; // a phone-sized view: only the chamber in progress keeps its name, so labels never pile up
  for(const r of m.rooms){const seen=reached<0||r.i<=reached,cur=st.cur===r.i;if(compact&&!cur)continue;
    const name=seen?r.name.replace(/^the /i,''):'?',col=cur?D.cur:st.cleared&&st.cleared[r.i]?D.clear:r.boss?TEXT.elite:TEXT.crypt;
    text(ctx,name,r.cx*T,r.y*T-5,col,13,dpr,sc);
    if(cur&&st.round)text(ctx,st.round,r.cx*T,r.y*T+r.h*T+12,D.cur,12,dpr,sc)}
  ctx.setTransform(1,0,0,1,0,0);return {sc,ox,oy}}

// Where the party stands: in its room, a little below the middle (clear of the boss dais), or on the stair.
function partySpot(m,st){const i=st.spot!=null?st.spot:st.cur,r=m.rooms[Math.max(0,Math.min(m.rooms.length-1,i<0?0:i))];
  if(st.at==='stair')return {x:m.entry.x+.5,y:m.rooms[0].y+.9};
  return {x:r.cx,y:r.cy+(r.boss?1.6:.9)}}
function skull(ctx,x,y,a){ctx.globalAlpha=a;ctx.fillStyle=MARK.edge;ctx.fillRect(x-1,y-1,10,10);ctx.fillStyle=D.boss;ctx.fillRect(x+1,y,6,1);ctx.fillRect(x,y+1,8,4);ctx.fillRect(x+1,y+5,6,2);
  ctx.fillStyle='#1a0a0a';ctx.fillRect(x+1,y+2,2,2);ctx.fillRect(x+5,y+2,2,2);ctx.fillRect(x+2,y+6,1,1);ctx.fillRect(x+5,y+6,1,1);ctx.globalAlpha=1}
function text(ctx,t,x,y,col,css,dpr,sc){const s=css*dpr/sc;ctx.font=s+'px VT323, monospace';ctx.textAlign='center';ctx.fillStyle='#000';ctx.fillText(t,x+s*.07,y+s*.07);ctx.fillStyle=col;ctx.fillText(t,x,y)}
