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
// Scene settings (#431): interiorTexture also paints a setting from buildSetting (its theme, floor and wall styles, rug,
//   bars, a two-course back wall and the furniture of render/furniture.js); drawSetting(ctx, box, m, st, now, dpr) draws
//   one frame of it with the scene's people, the speaker's bubble and the turn chevron.
// Style (docs/ART-PLAN.md): light from the top left, ground in mid values, entities outlined and owning the extremes.
import {T} from '../world/tiles.js';
import {IT} from '../world/interior.js';
import {hash} from '../core/rng.js';
import {DUNGEON as D,DUNGEON,THEMES,TEXT,MARK} from './palette.js';
import {FURN} from './furniture.js';
import {sprite,outlined,heroSprite,npcSprite,SPR} from './sprites.js';
import {MOBS} from '../data/mobs.js';
import {S} from '../sim/state.js';
import {classColor,DISP,toneOf} from '../core/colors.js';
import {drawConditions} from './conditions.js';
import {drawFoes} from './dgfoes.js';
import {maxHp} from '../sim/heroes.js';

const PS={close:true,sc:1,dpr:1,offX:0,offY:0}; // the camera the condition glyphs read (a reused object, no per-frame allocation)
const mix=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
const walk=t=>t!==IT.VOID&&t!==IT.WALL;

// ---- the texture, once per interior ----
// A dungeon (no m.theme) keeps the crypt look exactly; a scene setting (#431) brings its theme (palette.js THEMES),
// its floor and wall styles and a two-course back wall (m.tall) to hang a hearth, shelves or a window on.
const texCache=new Map();
export function interiorTexture(m){const key=m.seed+':'+m.w+'x'+m.h+':'+(m.theme||'');let c=texCache.get(key);if(c)return c;
  c=document.createElement('canvas');c.width=m.w*T;c.height=m.h*T;const x=c.getContext('2d'),img=x.createImageData(c.width,c.height),d=img.data;
  const D=(m.theme&&THEMES[m.theme])||DUNGEON,FS=m.style?m.style.floor:'flag',WS=m.style?m.style.wall:'brick',tall=!!m.tall;
  const s=m.seed%9973,h=(a,b,k)=>hash(a,b,s+k),tile=(tx,ty)=>tx<0||ty<0||tx>=m.w||ty>=m.h?IT.VOID:m.tiles[ty*m.w+tx];
  // the floor's colour at a world pixel, by style
  const floor=(t,gx,gy,n)=>{let col;
    if(t!==IT.HALL&&(FS==='plank'||FS==='hull')){ // boards across the room, staggered ends; the hold's tarred deck with beams
      const bh=FS==='hull'?6:5,row=Math.floor(gy/bh),ly=gy%bh,len=FS==='hull'?64:24+Math.floor(h(row,0,11)*3)*8,off=Math.floor(h(row,1,12)*len),lx=(gx+off)%len,v=h(Math.floor((gx+off)/len),row,13),R=D.floor;
      if(ly===0||lx===0)col=D.mortar;else{col=mix(R[1],v<.5?R[2]:R[0],Math.abs(v-.5)*.7);if(ly===1)col=mix(col,R[0],.45);else if(ly===bh-1)col=mix(col,R[2],.5);
        if(h(gx>>2,row,14)<.12&&(gx&3)!==0)col=mix(col,R[2],.35);if((lx===2||lx===len-3)&&ly===2)col=mix(col,D.mortar,.6)} // grain, nails
      if(FS==='hull'){const rb=gx%48;if(rb<5){const B=D.beam;col=rb===0?B[0]:rb===4?B[2]:mix(B[1],B[0],.2);if(ly===0)col=mix(col,D.mortar,.4)}}
      return col}
    if(t!==IT.HALL&&FS==='dirt'){const v=h(gx>>2,gy>>2,15);col=mix(D.floor[1],v<.5?D.floor[2]:D.floor[0],Math.abs(v-.5)*.5);if(n<.03)col=D.floor[0];else if(n>.97)col=D.floor[2];return col}
    const R=t===IT.HALL?D.hall:D.floor,sz=t===IT.HALL||FS==='cobble'?5:8,row=Math.floor(gy/sz),off=(row&1)*(sz>>1),sx=Math.floor((gx+off)/sz),lx=(gx+off)%sz,ly=gy%sz,v=h(sx,row,1); // flagstones (chambers 8 px, corridors and setts 5)
    if(lx===0||ly===0)col=D.mortar;
    else{col=mix(R[1],v<.5?R[2]:R[0],Math.abs(v-.5)*.6);
      if(lx===1||ly===1)col=mix(col,R[0],.55);else if(lx===sz-1||ly===sz-1)col=mix(col,R[2],.6);
      if(n<.07)col=mix(col,R[2],.5);if(D.moss&&h(sx,row,3)<.22&&n<.16)col=mix(col,D.moss,.7)}
    return col};
  // a wall face pixel: fy down the face (0..FH-1), the cap on top and the foot in shadow
  const face=(gx,gy,fy,FH,n)=>{let col;const F=D.wallFace;
    if(fy<2)return fy===0?F[0]:mix(F[0],F[1],.5);
    if(WS==='timber'){const B=D.beam,bx=gx%40;col=mix(F[1],n<.5?F[2]:F[0],Math.abs(n-.5)*.25);if(h(gx>>3,fy>>3,16)<.08&&n<.3)col=mix(col,F[2],.5);
      if(fy<5)col=fy===2?B[0]:fy===4?B[2]:B[1];else if(fy>=FH-5)col=fy===FH-5?B[0]:B[fy>=FH-2?2:1];else if(bx<3)col=bx===0?B[0]:bx===1?B[1]:B[2]}
    else if(WS==='rock'){const bw=7,bh=5,row=Math.floor(fy/bh),off=Math.floor(h(row,gx>>6,17)*bw),lx=(gx+off)%bw,ly=fy%bh,v=h(Math.floor((gx+off)/bw),row,18);
      if(lx===0||ly===0)col=D.mortar;else{col=mix(F[1],v<.5?F[2]:F[0],Math.abs(v-.5)*.8);if(ly===1||lx===1)col=mix(col,F[0],.4);if(n<.06)col=mix(col,F[2],.5)}}
    else if(WS==='hull'){const ly=fy%4,rb=gx%48;col=ly===0?D.mortar:ly===1?mix(F[1],F[0],.5):ly===3?mix(F[1],F[2],.5):F[1];if(h(gx>>3,fy>>2,19)<.15&&ly===2)col=mix(col,F[2],.4);
      if(rb<5){const B=D.beam;col=rb===0?B[0]:rb===4?B[2]:B[1]}}
    else{const row=Math.floor(fy/4),off=(row&1)*4,lx=(gx+off)&7,ly=fy&3,v=h(Math.floor((gx+off)/8),gy>>2,4); // brick
      if(lx===0||ly===0)col=D.mortar;else{col=mix(F[1],v<.5?F[2]:F[0],Math.abs(v-.5)*.5);if(ly===1)col=mix(col,F[0],.4);if(ly===3)col=mix(col,F[2],.5)}}
    if(fy>=FH-3)col=mix(col,F[2],.35*(fy-(FH-4))); // the foot of the wall in shadow
    return col};
  for(let ty=0;ty<m.h;ty++)for(let tx=0;tx<m.w;tx++){const t=tile(tx,ty);if(t===IT.VOID)continue;
    const up=tile(tx,ty-1),dn=tile(tx,ty+1),lf=tile(tx-1,ty),rt=tile(tx+1,ty);
    const upper=tall&&t===IT.WALL&&dn===IT.WALL&&walk(tile(tx,ty+2)); // the upper course of a two-course back wall
    for(let py=0;py<T;py++)for(let px=0;px<T;px++){const gx=tx*T+px,gy=ty*T+py,n=h(gx,gy,2);let col;
      if(t===IT.FLOOR||t===IT.HALL||t===IT.DOOR||t===IT.BARS){col=floor(t===IT.BARS?IT.FLOOR:t===IT.DOOR?(m.theme?IT.FLOOR:IT.HALL):t,gx,gy,n);
        if(t===IT.DOOR&&tall&&!walk(dn)){const B=D.beam; // the way out: a plank door in the front wall, in its frame
          col=px<2||px>13?(px===0||px===15?D.wallTop[1]:B[1]):py===0?B[0]:(px&3)===2?D.wood[2]:(px&3)===3?D.wood[0]:D.wood[1];if(py>=13&&px>1&&px<14)col=mix(col,D.wood[2],.5);if(px===11&&(py===7||py===8))col=[200,170,80]}
        else if(t===IT.DOOR){const vert=walk(up)&&walk(dn);const a=vert?px:py; // an open door leaf folded against one side, a threshold across
          if(a<3)col=a===0?D.wood[2]:a===1?D.wood[0]:D.wood[1];else if((vert?py:px)===(walk(vert?dn:rt)?15:0))col=D.mortar}
        else if(t===IT.BARS){const k=px&3,B=D.bars;if(k===1)col=B[0];else if(k===2)col=B[1];else if(k===3)col=mix(col,[0,0,0],.35);
          if(py===2||py===13)col=B[1];else if(py===3||py===14)col=mix(col,[0,0,0],.3)}}
      else if(t===IT.RUG){const Rg=D.rug,eL=lf!==IT.RUG,eR=rt!==IT.RUG,eU=up!==IT.RUG,eD=dn!==IT.RUG; // a woven rug: border, a figure line, a diamond field
        const bx=Math.min(eL?px:99,eR?15-px:99),by=Math.min(eU?py:99,eD?15-py:99),b=Math.min(bx,by);
        if(b<2)col=b===0&&(eU||eL)?mix(Rg[1],[255,255,255],.12):Rg[1];else if(b===3)col=Rg[2];
        else{const dd=((gx+gy)&7)===0||((gx-gy)&7)===0;col=dd?mix(Rg[0],Rg[2],.45):Rg[0];if(n<.08)col=mix(col,Rg[1],.4)}
        if(eD&&py===15)col=mix(col,[0,0,0],.3)}
      else if(t===IT.WALL){
        if(walk(dn))col=face(gx,gy,tall?py+16:py,tall?32:16,n);
        else if(upper)col=face(gx,gy,py,32,n);
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
  for(const p of m.props)prop(x,p,D,m.theme);
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
function prop(x,p,th,tk){const F=FURN[p.kind];
  if(F){const rows=F.make?F.make(p.len?p.len*16-2:0):F.rows,s=outlined(sprite('sf-'+p.kind+'-'+(tk||'')+'-'+(p.len||0),rows,F.map(th)));x.drawImage(s,p.x*T+F.ox-1,p.y*T+F.oy-1);return}
  const P=PROPS[p.kind];if(!P)return;const s=outlined(sprite('dg-'+p.kind,P.rows,P.map));x.drawImage(s,p.x*T+P.ox-1,p.y*T+P.oy-1)}
const propOf=k=>FURN[k]||PROPS[k]; // a prop's art: setting furniture first, then the crypt's

// ---- light and fog ----
let glowC=null;
function glowSprite(){if(glowC)return glowC;glowC={};
  for(const [k,c] of [['warm',[255,170,70]],['crypt',D.ghost],['day',DAYGLOW]]){const cv=document.createElement('canvas');cv.width=cv.height=64;const x=cv.getContext('2d'),g=x.createRadialGradient(32,32,0,32,32,32);
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
  for(const p of m.props){const P=propOf(p.kind);if(!P||!P.light)continue;const r=m.reg[p.y*m.w+p.x];if(reached>=0&&r>2*reached)continue;
    const f=.75+.25*Math.sin(now*7+p.x*1.7+p.y),R=P.light==='crypt'?44:30;ctx.globalAlpha=f;ctx.drawImage(G[P.light],p.x*T+8-R,p.y*T+8-R,R*2,R*2)}
  if(st.party&&st.party.length){const pp=partySpot(m,st);ctx.globalAlpha=.7;ctx.drawImage(G.warm,pp.x*T-52,pp.y*T-52,104,104)} // the party's torches
  ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  if(reached>=0&&reached<m.rooms.length-1)ctx.drawImage(fogOf(m,reached),0,0,m.w*T,m.h*T);
  // chamber marks: the boss skull (always), cleared badges, the chamber in progress
  PS.sc=sc;PS.dpr=dpr;PS.offX=ox;PS.offY=oy;
  const px1=dpr/sc,pulse=.75+.25*Math.sin(now*4);
  for(const r of m.rooms){const seen=reached<0||r.i<=reached;
    if(st.cleared&&st.cleared[r.i]){ctx.fillStyle=MARK.edge;ctx.fillRect(r.x*T+r.w*T-11,r.y*T+2,10,9);ctx.fillStyle=D.clear; // a tick in a dark badge
      for(const [a,b] of [[1,4],[2,5],[3,6],[4,5],[5,4],[6,3],[7,2]])ctx.fillRect(r.x*T+r.w*T-11+a,r.y*T+2+b,2,1)}
    if(r.boss)skull(ctx,Math.round(r.cx*T)-4,Math.round(r.y*T-5-13*px1-12),1); // above the chamber's name, fog or not
    if(st.cur===r.i){ctx.save();ctx.strokeStyle=D.cur;ctx.globalAlpha=pulse;ctx.lineWidth=2*px1;ctx.strokeRect(r.x*T+px1,r.y*T+px1,r.w*T-2*px1,r.h*T-2*px1);ctx.restore()}} // the outline sits inside the floor, so the wall faces never hide it
  drawFoes(ctx,m,st,now,dpr,sc,PS); // the live crawl's foes with their HP bars (render/dgfoes.js)
  // the hand that rests on a chamber (hover or pinned), and a cross where a hero fell on the last run
  for(const r of m.rooms){const hot=st.hover===r.i||st.pin===r.i;if(hot){ctx.save();ctx.strokeStyle=st.pin===r.i?D.cur:'#ffffff';ctx.globalAlpha=st.pin===r.i?.9:.5;ctx.lineWidth=px1;ctx.setLineDash([3,3]);ctx.strokeRect(r.x*T+3*px1,r.y*T+3*px1,r.w*T-6*px1,r.h*T-6*px1);ctx.restore()}}
  if(st.falls)for(const q of st.falls){const r=m.rooms[q.room];if(!r)continue;const gx=r.x*T+4+q.k*8,gy=r.y*T+r.h*T-12;
    ctx.fillStyle=MARK.edge;ctx.fillRect(gx-1,gy-1,7,11);ctx.fillStyle='#b8b4c8';ctx.fillRect(gx+2,gy,1,8);ctx.fillRect(gx,gy+2,5,1);ctx.fillStyle='#e0584a';ctx.fillRect(gx+2,gy+8,1,1)}
  // the party, outlined hero sprites in a line facing the chamber; they step while a scene is playing
  if(st.party&&st.party.length){const pp=partySpot(m,st),n=st.party.length,fr=st.busy?Math.floor(now*2.2)&1:0;
    st.party.forEach((a,k)=>{const s=outlined(heroSprite(a,false,(fr+k)&1&&st.busy?1:0)),x=Math.round((pp.x+(k-(n-1)/2)*1.05)*T-s.width/2),y=Math.round(pp.y*T+(k&1?3:0)-s.height);
      ctx.fillStyle=MARK.shadow;ctx.beginPath();ctx.ellipse(x+s.width/2,y+s.height-1,5,1.5,0,0,7);ctx.fill();ctx.drawImage(s,x,y);
      if(st.foes){const mh=maxHp(a),f=mh>0?Math.max(0,Math.min(1,a.hp/mh)):1,bx=x+(s.width>>1)-5,by=y-2; // a small health bar while foes stand in the room
        ctx.fillStyle=MARK.edge;ctx.fillRect(bx-1,by-1,12,4);ctx.fillStyle='#142a1c';ctx.fillRect(bx,by,10,2);ctx.fillStyle=f<.35?'#e0584a':f<.65?'#e0b040':'#58c070';ctx.fillRect(bx,by,Math.max(1,Math.round(10*f)),2)}
      if(a.eff)drawConditions(ctx,null,PS,a,x+(s.width>>1),y+s.height,y+(st.foes?-3:0),now)})}
  // names at a constant CSS size, above each chamber; unreached ones are a question mark
  const compact=T*sc/dpr<10; // a phone-sized view: only the chamber in progress keeps its name, so labels never pile up
  for(const r of m.rooms){const seen=reached<0||r.i<=reached,cur=st.cur===r.i;if(compact&&!cur)continue;
    const name=seen?r.name.replace(/^the /i,''):'?',col=cur?D.cur:st.cleared&&st.cleared[r.i]?D.clear:r.boss?TEXT.elite:TEXT.crypt;
    text(ctx,name,r.cx*T,r.y*T-5,col,13,dpr,sc);
    if(cur&&st.round)text(ctx,st.round,r.cx*T,r.y*T+r.h*T+12,D.cur,12,dpr,sc);
    if(cur&&st.foeText)text(ctx,st.foeText,r.cx*T,r.y*T+r.h*T+12+13*dpr/sc,DISP.hostile.color,12,dpr,sc)}
  ctx.setTransform(1,0,0,1,0,0);return {sc,ox,oy}}

// Where the party stands: in its room, a little below the middle (clear of the boss dais), or on the stair.
function partySpot(m,st){const i=st.spot!=null?st.spot:st.cur,r=m.rooms[Math.max(0,Math.min(m.rooms.length-1,i<0?0:i))];
  if(st.at==='stair')return {x:m.entry.x+.5,y:m.rooms[0].y+.9};
  return {x:r.cx,y:r.cy+(r.boss?1.6:.9)}}
function skull(ctx,x,y,a){ctx.globalAlpha=a;ctx.fillStyle=MARK.edge;ctx.fillRect(x-1,y-1,10,10);ctx.fillStyle=D.boss;ctx.fillRect(x+1,y,6,1);ctx.fillRect(x,y+1,8,4);ctx.fillRect(x+1,y+5,6,2);
  ctx.fillStyle='#1a0a0a';ctx.fillRect(x+1,y+2,2,2);ctx.fillRect(x+5,y+2,2,2);ctx.fillRect(x+2,y+6,1,1);ctx.fillRect(x+5,y+6,1,1);ctx.globalAlpha=1}
function text(ctx,t,x,y,col,css,dpr,sc){const s=css*dpr/sc;ctx.font=s+'px VT323, monospace';ctx.textAlign='center';ctx.fillStyle='#000';ctx.fillText(t,x+s*.07,y+s*.07);ctx.fillStyle=col;ctx.fillText(t,x,y)}

// ---- a scene setting (#431): one frame of the room with the scene's people in it ----
// st (render/sceneview.js): {party:[hero], cast:[entity] (a townsperson, a foe or an enemy hero), speaker:{e, text}|null,
//   cur: the member whose turn it is or null, busy}. The party stands in a row at the room's party spot facing the cast,
//   the first of the cast at its spot (on its seat in a cell), the rest beside it. Read-only like the dungeon view.
const DAYGLOW=[190,215,255];
export function drawSetting(ctx,box,m,st,now,dpr=1){
  const tex=interiorTexture(m);let sc=Math.min(box.w/(m.w*T),box.h/(m.h*T));if(sc>=2)sc=Math.floor(sc);else if(sc>1)sc=Math.floor(sc*4)/4;
  const ox=Math.round(box.x+(box.w-m.w*T*sc)/2),oy=Math.round(box.y+(box.h-m.h*T*sc)/2),W=m.w*T,H=m.h*T;
  ctx.setTransform(1,0,0,1,0,0);ctx.imageSmoothingEnabled=false;ctx.drawImage(tex,0,0,tex.width,tex.height,ox,oy,Math.round(W*sc),Math.round(H*sc));
  ctx.setTransform(sc,0,0,sc,ox,oy);
  // the room's own dimness, then its fire, candles, lamps and daylight added back
  if(m.dark>0){ctx.fillStyle='rgba(8,8,22,'+m.dark+')';ctx.fillRect(0,0,W,H)}
  const G=glowSprite();ctx.save();ctx.beginPath();ctx.rect(T,T,W-2*T,H-2*T);ctx.clip();ctx.globalCompositeOperation='lighter'; // light stays inside the walls
  for(const p of m.props){const P=propOf(p.kind);if(!P||!P.light)continue;const R=P.light==='crypt'?44:P.light==='day'?36:p.kind==='hearth'?50:30;
    const f=P.light==='day'?.55:.72+.28*Math.sin(now*7+p.x*1.7+p.y)*Math.sin(now*3.1+p.x);
    const cx=p.x*T+P.ox+(P.rows?P.rows[0].length:16)/2,cy=p.y*T+P.oy+(P.light==='day'?12:6);
    ctx.globalAlpha=Math.max(0,f);ctx.drawImage(G[P.light],cx-R,cy-R,R*2,R*2)}
  ctx.restore();ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  // who stands where
  const ents=[],sp=m.spots,party=st.party||[],cast=st.cast||[],n=party.length,room=m.rooms[0];
  const per=Math.max(1,Math.min(n,Math.floor((room.w-.5)/1.2))),rows=Math.ceil(n/per);
  party.forEach((a,k)=>{const r=Math.floor(k/per),inRow=Math.min(per,n-r*per),i=k-r*per;
    ents.push({e:a,x:Math.max(room.x+.5,Math.min(room.x+room.w-.5,sp.party.x+(i-(inRow-1)/2)*1.2+(r&1)*.6)),y:Math.min(room.y+room.h-.15,sp.party.y+r*.95-(rows-1)*.45),hero:true})});
  cast.forEach((e,k)=>{const c=sp.cast[Math.min(k,sp.cast.length-1)],off=k<sp.cast.length?0:(k-sp.cast.length+1);
    ents.push({e,x:c.x+(off?(off&1?1:-1)*Math.ceil(off/2)*1.3:0),y:c.y+(off?.25:0),cast:true})});
  ents.sort((a,b)=>a.y-b.y);
  const fr=Math.floor(now*1.6)&1,pseudo={close:true,sc,dpr,offX:ox,offY:oy};
  for(const q of ents){const e=q.e,s=spriteOf(e,st.busy&&e===st.cur?fr:0);if(!s)continue;
    const px=Math.round(q.x*T),py=Math.round(q.y*T),o=outlined(s),top=py-s.height;q.px=px;q.top=top;
    ctx.fillStyle=MARK.shadow;ctx.beginPath();ctx.ellipse(px,py-1,s.width/2,1.6,0,0,7);ctx.fill();
    if(q.cast||q.hero){const col=q.hero?classColor(e.cls):castColor(e);ctx.strokeStyle=col;ctx.globalAlpha=.8;ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(px,py-.5,s.width/2+1.5,2.5,0,0,7);ctx.stroke();ctx.globalAlpha=1}
    ctx.save();ctx.translate(px,0);if(q.cast)ctx.scale(-1,1);ctx.drawImage(o,-Math.floor(s.width/2)-1,top-1);ctx.restore();
    if(e.eff)drawConditions(ctx,null,pseudo,e,px,py,top,now);}
  // the member whose turn it is: a gold chevron over the head
  for(const q of ents)if(q.e===st.cur&&q.top!=null){const y=q.top-7+Math.round(Math.sin(now*5));ctx.fillStyle=MARK.edge;ctx.fillRect(q.px-3,y-1,7,4);ctx.fillStyle=MARK.sel;ctx.fillRect(q.px-2,y,5,1);ctx.fillRect(q.px-1,y+1,3,1);ctx.fillRect(q.px,y+2,1,1)}
  // names at a constant CSS size under the feet, the room's name over its back wall
  const compact=T*sc/dpr<14;
  for(const q of ents){if(q.top==null)continue;const e=q.e,col=q.hero?classColor(e.cls):castColor(e);if(compact&&!q.cast&&e!==st.cur)continue;
    text(ctx,nameOf(e),q.x*T,q.y*T+11*dpr/sc,col,12,dpr,sc)}
  // the speaker's bubble (the latest line at this table), and any member's own bubble from the chat
  const said=new Set();
  if(st.speaker&&st.speaker.e){const q=ents.find(r=>r.e===st.speaker.e);if(q&&q.top!=null){bubble(ctx,q.px,q.top-3*dpr/sc,headOf(q.e),q.hero?classColor(q.e.cls):castColor(q.e),st.speaker.text,dpr,sc,1);said.add(q.e)}}
  for(const q of ents){const b=q.e.bubble;if(said.has(q.e)||q.top==null||!b||b.life<=0)continue;bubble(ctx,q.px,q.top-3*dpr/sc,headOf(q.e),q.hero?classColor(q.e.cls):castColor(q.e),b.text,dpr,sc,Math.min(1,b.life/.6))}
  ctx.setTransform(1,0,0,1,0,0);return {sc,ox,oy}}

// A scene entity's sprite: a hero, a townsperson (S.wanderers / S.npcs) or a creature.
function spriteOf(e,fr){if(!e)return null;
  if(e.kind==='hero')return heroSprite(e,e.state==='ghost',fr);
  if(e.kind==='mob'){const M=MOBS[e.type];return M&&SPR[M.spr]?sprite(e.type+fr,SPR[M.spr][fr],M.col):null}
  if(e.role)return npcSprite(e,fr);return null}
const nameOf=e=>e.kind==='mob'?(e.name||(MOBS[e.type]&&MOBS[e.type].name)||'foe'):e.name||'?';
const headOf=e=>e.kind==='hero'?e.name.toUpperCase():'['+nameOf(e)+']';
function castColor(e){if(e.kind==='mob'||e.kind==='boss')return DISP.hostile.color;if(e.kind==='hero')return DISP.hostile.color;
  const t=toneOf(e,S.fellowship,S.gameMin);return t.color||DISP.neutral.color}

// A speech bubble over (x, y) in the current transform (sc world-to-device, dpr): a dark rounded box with the speaker's
// name in its colour and up to three wrapped lines. Shared by the outdoor cut (render/sceneview.js).
const BL=22,BMAX=3;
function wrapLine(t){const out=[];let cur='';for(const w of String(t).split(' ')){if(cur&&(cur+' '+w).length>BL){out.push(cur);cur=w}else cur=cur?cur+' '+w:w}
  if(cur)out.push(cur);if(out.length>BMAX){out.length=BMAX;out[BMAX-1]=out[BMAX-1].slice(0,BL-1).trimEnd()+'…'}return out}
export function bubble(ctx,x,y,head,headCol,body,dpr,sc,alpha=1){const s=12*dpr/sc,lh=s*.8,pad=s*.3,lines=(head?[head]:[]).concat(wrapLine(body));
  ctx.font=s+'px VT323, monospace';let w=0;for(const l of lines)w=Math.max(w,ctx.measureText(l).width);
  const bw=w+pad*2,bh=lines.length*lh+pad*1.2,bottom=y-pad*.7,top=bottom-bh,x0=x-bw/2;
  ctx.globalAlpha=alpha;ctx.fillStyle='#0a0a16'; // opaque, edged in the speaker's colour (#471)
  if(ctx.roundRect){ctx.beginPath();ctx.roundRect(x0,top,bw,bh,pad);ctx.fill();if(headCol){ctx.strokeStyle=headCol;ctx.lineWidth=dpr/sc;ctx.stroke()}}else ctx.fillRect(x0,top,bw,bh);
  ctx.fillStyle='#0a0a16';
  ctx.beginPath();ctx.moveTo(x-pad*.6,bottom);ctx.lineTo(x+pad*.6,bottom);ctx.lineTo(x,bottom+pad*.7);ctx.fill();
  lines.forEach((l,i)=>text(ctx,l,x,top+pad*.6+lh*(i+.85),head&&i===0?headCol:TEXT.label,12,dpr,sc));ctx.globalAlpha=1}
