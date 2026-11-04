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
//   one frame of it with the scene's people, the speaker's bubble and the turn chevron; #536 adds the arc staging, the
//   answer marks (answerMark), name plates, light from the frame and time of day, the scene's item and bubbles kept off props.
// Style (docs/ART-PLAN.md): light from the top left, ground in mid values, entities outlined and owning the extremes.
import {U as T} from './tile.js'; // world units a tile (render/tile.js; art is drawn at TILE)
import {IT} from '../world/interior.js';
import {hash} from '../core/rng.js';
import {DUNGEON as D,DUNGEON,THEMES,TEXT,MARK} from './palette.js';
import {FURN} from './furniture.js';
import {SITEP} from './siteprops.js';
import {sprite,outlined,heroSprite,npcSprite,SPR} from './sprites.js';
import {MOBS} from '../data/mobs.js';
import {S} from '../sim/state.js';
import {classColor,DISP,toneOf} from '../core/colors.js';
import {drawConditions} from './conditions.js';
import {drawFoes} from './dgfoes.js';
import {maxHp} from '../sim/heroes.js';
import {spokenOf,unrole} from '../core/spoken.js';
import {slotted} from '../sim/company.js'; // the slotted company (#588)

const PS={close:true,sc:1,dpr:1,offX:0,offY:0}; // the camera the condition glyphs read (a reused object, no per-frame allocation)
const mix=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
const walk=t=>t!==IT.VOID&&t!==IT.WALL;

// ---- the texture, once per interior ----
// A dungeon (no m.theme) keeps the crypt look exactly; a scene setting (#431) brings its theme (palette.js THEMES),
// its floor and wall styles and a two-course back wall (m.tall) to hang a hearth, shelves or a window on.
const texCache=new Map();
export function interiorTexture(m){const key=m.seed+':'+m.w+'x'+m.h+':'+(m.theme||'');let c=texCache.get(key);if(c)return c;
  c=document.createElement('canvas');c.width=m.w*T;c.height=m.h*T;const x=c.getContext('2d'),img=x.createImageData(c.width,c.height),d=img.data;
  const D=(m.theme&&THEMES[m.theme])||DUNGEON,FS=m.style?m.style.floor:'flag',WS=m.style?m.style.wall:'brick',HS=m.style&&m.style.hall,tall=!!m.tall;
  const s=m.seed%9973,h=(a,b,k)=>hash(a,b,s+k),tile=(tx,ty)=>tx<0||ty<0||tx>=m.w||ty>=m.h?IT.VOID:m.tiles[ty*m.w+tx];
  // the floor's colour at a world pixel, by style
  const floor=(t,gx,gy,n)=>{let col;
    if(t!==IT.HALL&&(FS==='plank'||FS==='hull')){ // boards across the room, staggered ends; the hold's tarred deck with beams
      const bh=FS==='hull'?6:5,row=Math.floor(gy/bh),ly=gy%bh,len=FS==='hull'?64:24+Math.floor(h(row,0,11)*3)*8,off=Math.floor(h(row,1,12)*len),lx=(gx+off)%len,v=h(Math.floor((gx+off)/len),row,13),R=D.floor;
      if(ly===0||lx===0)col=D.mortar;else{col=mix(R[1],v<.5?R[2]:R[0],Math.abs(v-.5)*.7);if(ly===1)col=mix(col,R[0],.45);else if(ly===bh-1)col=mix(col,R[2],.5);
        if(h(gx>>2,row,14)<.12&&(gx&3)!==0)col=mix(col,R[2],.35);if((lx===2||lx===len-3)&&ly===2)col=mix(col,D.mortar,.6)} // grain, nails
      if(FS==='hull'){const rb=gx%48;if(rb<5){const B=D.beam;col=rb===0?B[0]:rb===4?B[2]:mix(B[1],B[0],.2);if(ly===0)col=mix(col,D.mortar,.4)}}
      return col}
    if(t!==IT.HALL&&FS==='ash'){ // a lair's floor (#85 raid arena): basalt plates split by cracks, a few still holding embers
      const cs=7,qx=Math.floor(gx/cs),qy=Math.floor(gy/cs);let d1=99,d2=99,id=0;
      for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){const X=qx+i,Y=qy+j,px=(X+.15+h(X,Y,22)*.7)*cs,py=(Y+.15+h(X,Y,23)*.7)*cs,dd=Math.hypot(gx-px,gy-py);
        if(dd<d1){d2=d1;d1=dd;id=h(X,Y,24)}else if(dd<d2)d2=dd}
      const e=d2-d1;if(e<1.1)return id<.12&&D.ember?mix(D.mortar,D.ember,.7):D.mortar;
      col=mix(D.floor[1],id<.5?D.floor[2]:D.floor[0],Math.abs(id-.5)*.7);if(e<2.2)col=mix(col,D.floor[0],.35);else if(d1>4.5)col=mix(col,D.floor[2],.25);if(n<.04)col=mix(col,D.floor[2],.5);return col}
    if(FS==='dirt'&&(t!==IT.HALL||HS==='dirt')){const R=t===IT.HALL?D.hall:D.floor,v=h(gx>>2,gy>>2,15);col=mix(R[1],v<.5?R[2]:R[0],Math.abs(v-.5)*.5);if(n<.03)col=R[0];else if(n>.97)col=R[2];return col} // a site's cave (#642) keeps dirt in its corridors too
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
      else if(t===IT.WATER&&D.crust){ // lava (#85 raid arena): dark crust plates on a bright melt, glowing seams, the shore's lip cooled
        const L=D.water,cs=6,qx=Math.floor(gx/cs),qy=Math.floor(gy/cs);let d1=99,d2=99,id=0;
        for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){const X=qx+i,Y=qy+j,px2=(X+.2+h(X,Y,27)*.6)*cs,py2=(Y+.2+h(X,Y,28)*.6)*cs,dd=Math.hypot(gx-px2,gy-py2);
          if(dd<d1){d2=d1;d1=dd;id=h(X,Y,29)}else if(dd<d2)d2=dd}
        const e=d2-d1;
        if(id<.62&&e>1.2)col=mix(D.crust[1],D.crust[0],e<2.2?.75:Math.min(.5,d1/8)); // a plate, its rim still warm
        else col=e<.8?L[0]:mix(L[1],L[0],Math.max(0,.6-e*.15));
        if(n<.012)col=L[0];
        if((up!==IT.WATER&&walk(up)&&py<3)||(lf!==IT.WATER&&walk(lf)&&px<2))col=mix(D.crust[1],L[2],.35)}
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
// the raid arena's lair (#85): a gold hoard with a sword in it, a basalt crag (lit from the top left)
const HOARD=["..........S.....","..........S.....","......Y...S.....",".....YWY..S.....","....YGGGY.H..Y..","...YGWGGGHHHYGY.","..YGGGGOGGGGGGOY",".YGGOGGGGGOGGGGO","YGGGGGOGGGGGOGGO","DOOODDOOOODOOODD"];
const CRAG=["....H.....","...HLM....","...HLMS...","..HLLMS...","..HLMMS...","..LLMMSS..",".HLMMMMS..",".LLMMMMSS.",".LMMMMMMS.","HLMMMMMMSS","LLMMMMMMMS","SSSSSSSSSS"];
const STONE={L:'#a8a4ba',M:'#7c7890',S:'#4a4658',H:'#c8c4d8',D:'#34303e',G:'#7ad0a0'};
const PROPS={
  bones:  {rows:BONES,map:{W:'#e8e4d8',D:'#8a8678'},ox:1,oy:9},
  pillar: {rows:PILLAR,map:{H:'#b8b4c8',L:'#9894aa',M:'#76728a',S:'#4a4658'},ox:3,oy:-2},
  candle: {rows:CANDLE,map:{F:'#ff8a3a',Y:'#ffd866',W:'#e8e0c8',D:'#6a6070'},ox:5,oy:6,light:'warm'},
  urn:    {rows:URN,map:{L:'#b07a4a',M:'#8a5a32',S:'#5a3a20',D:'#2a1a10'},ox:4,oy:6},
  brazier:{rows:BRAZIER,map:{G:'#3fae7a',g:'#7ad0a0',W:'#c8ffd8',B:'#2a2630',M:'#5a5666'},ox:4,oy:4,light:'crypt'},
  sarcophagus:{rows:SARC,map:STONE,ox:-5,oy:4},
  throne: {rows:THRONE,map:STONE,ox:1,oy:2},
  hoard:  {rows:HOARD,map:{W:'#fff6c0',Y:'#ffd866',G:'#e0a838',O:'#a86a20',D:'#5a3410',S:'#d8dce8',H:'#7a3a2a'},ox:0,oy:6},
  crag:   {rows:CRAG,map:{H:'#9a8a88',L:'#76686a',M:'#584c50',S:'#363036'},ox:3,oy:4},
};
function prop(x,p,th,tk){const F=FURN[p.kind]||SITEP[p.kind]; // setting furniture, then a DM-made site's pieces (render/siteprops.js, #642)
  if(F){const rows=F.make?F.make(p.len?p.len*16-2:0):F.rows,raw=sprite('sf-'+p.kind+'-'+(tk||'')+'-'+(p.len||0),rows,F.map(th));
    if(F.flat){x.drawImage(raw,p.x*T+F.ox,p.y*T+F.oy);return}x.drawImage(outlined(raw),p.x*T+F.ox-1,p.y*T+F.oy-1);return}
  const P=PROPS[p.kind];if(!P)return;const s=outlined(sprite('dg-'+p.kind,P.rows,P.map));x.drawImage(s,p.x*T+P.ox-1,p.y*T+P.oy-1)}
const propOf=k=>FURN[k]||SITEP[k]||PROPS[k]; // a prop's art: setting furniture first, then a site's, then the crypt's

// ---- light and fog ----
let glowC=null;
function glowSprite(){if(glowC)return glowC;glowC={};
  for(const [k,c] of [['warm',[255,170,70]],['crypt',D.ghost],['day',DAYGLOW],['cold',[130,160,255]]]){const cv=document.createElement('canvas');cv.width=cv.height=64;const x=cv.getContext('2d'),g=x.createRadialGradient(32,32,0,32,32,32);
    g.addColorStop(0,'rgba('+c.join(',')+',.55)');g.addColorStop(1,'rgba('+c.join(',')+',0)');x.fillStyle=g;x.fillRect(0,0,64,64);glowC[k]=cv}
  return glowC}
// One texel per tile: dark over everything past the last room reached (rooms and the corridors that lead to them).
const fogCache=new Map();
function fogOf(m,reached){const key=m.seed+':'+reached;let c=fogCache.get(key);if(c)return c;
  c=document.createElement('canvas');c.width=m.w;c.height=m.h;const x=c.getContext('2d'),img=x.createImageData(m.w,m.h),d=img.data;
  for(let i=0;i<m.w*m.h;i++){const r=m.reg[i];if(r<0||r<=2*reached)continue;d[i*4]=D.void[0];d[i*4+1]=D.void[1];d[i*4+2]=D.void[2];d[i*4+3]=D.fogA}
  x.putImageData(img,0,0);fogCache.set(key,c);return c}

// The outline of a chamber in progress follows its floor: an edge is drawn only where a floor tile meets cave wall or the
// chamber's rim, so tiles a cave cut into wall are left out (#678). Sits just inside the floor, caps cover the corners.
function roomEdge(ctx,m,r,px1){const ok=(x,y)=>x>=r.x&&x<r.x+r.w&&y>=r.y&&y<r.y+r.h&&m.tiles[y*m.w+x]!==IT.WALL&&m.tiles[y*m.w+x]!==IT.VOID,i=px1;
  ctx.lineCap='square';ctx.beginPath();
  for(let y=r.y;y<r.y+r.h;y++)for(let x=r.x;x<r.x+r.w;x++){if(!ok(x,y))continue;const l=x*T,t=y*T,rr=l+T,b=t+T;
    if(!ok(x,y-1)){ctx.moveTo(l,t+i);ctx.lineTo(rr,t+i)}if(!ok(x,y+1)){ctx.moveTo(l,b-i);ctx.lineTo(rr,b-i)}
    if(!ok(x-1,y)){ctx.moveTo(l+i,t);ctx.lineTo(l+i,b)}if(!ok(x+1,y)){ctx.moveTo(rr-i,t);ctx.lineTo(rr-i,b)}}
  ctx.stroke()}

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
    const f=.75+.25*Math.sin(now*7+p.x*1.7+p.y),R=P.light==='crypt'||P.light==='cold'?44:30,wall=m.tiles[p.y*m.w+p.x]===IT.WALL;ctx.globalAlpha=f;
    if(wall){ctx.save();ctx.beginPath();ctx.rect(0,p.y*T,m.w*T,m.h*T);ctx.clip()} // a wall torch lights the room, not the dark above its wall
    ctx.drawImage(G[P.light],p.x*T+8-R,p.y*T+8-R,R*2,R*2);if(wall)ctx.restore()}
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
    if(st.cur===r.i){ctx.save();ctx.strokeStyle=D.cur;ctx.globalAlpha=pulse;ctx.lineWidth=2*px1;roomEdge(ctx,m,r,px1);ctx.restore()}} // the outline sits inside the floor, so the wall faces never hide it
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
//   cur: the member whose turn it is or null, busy, marks:{id:'think'|'done'|'turn'}, dark: the room's dimness (night and
//   the frame, #536), item: a kind of ITEM_ART the frame names, people:[{title,name}] (role titles to drop from lines)}.
// Staging (#536): the first of the cast on its spot (the step, the chair), the rest beside it; the party in a loose arc in
// front of it, each member turned toward it. Read-only like the dungeon view.
const DAYGLOW=[190,215,255];
// Where the members stand: an arc below the speaker's spot (radius about 2.4 tiles, squashed for the top-down view),
// spread wider for a bigger party, kept on the room's floor.
export function arcSpots(n,c,room){const out=[];if(!n)return out;const R=Math.max(2.2,Math.min(3.2,.62*(n-1)+1.6)),span=Math.min(Math.PI*2/3,(n-1)*Math.max(.6,1.8/R)); // neighbours at least ~1.6 tiles apart, so their names never touch
  for(let k=0;k<n;k++){const t=Math.PI/2-(n>1?(k/(n-1)-.5)*span:0),x=c.x+Math.cos(t)*R,y=c.y+Math.sin(t)*R*.9+.2;
    out.push({x:Math.max(room.x+.5,Math.min(room.x+room.w-.5,x)),y:Math.max(c.y+1.4,Math.min(room.y+room.h-.15,y))})}
  return out}
// The rectangles (world px) of a setting's props, cached per setting: what a speech bubble keeps clear of.
const rectCache=new WeakMap();
function propRects(m){let r=rectCache.get(m);if(r)return r;r=[];
  for(const p of m.props){if(p.kind==='pew'||p.kind==='bench')continue; // the floor the people stand among
    const P=propOf(p.kind);if(!P)continue;const rows=P.make?P.make(p.len?p.len*16-2:0):P.rows;if(!rows||!rows.length)continue;
    r.push({x:p.x*T+P.ox,y:p.y*T+P.oy,w:rows[0].length,h:rows.length,k:FOCUS[p.kind]||(P.light?.5:1)})}
  rectCache.set(m,r);return r}
const FOCUS={altar:4,idol:4,hearth:3,table:2,longtable:2,basin:2,throne:4,sarcophagus:4}; // what a line must never hide
const over=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
// A small item the scene names (#536), drawn lit on the floor beside the speaker.
export const ITEM_ART={
  candle:{rows:['.F.','FYF','.Y.','WWW','WWD','DDD'],map:{F:'#ff8a3a',Y:'#ffd866',W:'#e8e0c8',D:'#6a6070'}},
  letter:{rows:['LLLLLLL','LMMMMML','LSSSSML','LMRRMML','LLLLLLL'],map:{L:'#f0e6c8',M:'#d8ccaa',S:'#8a7a5a',R:'#b03030'}},
  key:{rows:['.YY....','Y..Y...','.YYYYYY','....Y.Y'],map:{Y:'#e0c050'}},
  ring:{rows:['.G.','GWG','Y.Y','.Y.'],map:{G:'#7ad0ff',W:'#ffffff',Y:'#e0c050'}},
  pouch:{rows:['.SS.','LMML','MMMS','MMMS','.SS.'],map:{L:'#b08050',M:'#8a5a32',S:'#5a3a20'}},
  book:{rows:['RRRRRR','RWWWWS','RWWWWS','RRRRRS'],map:{R:'#7a2a3a',W:'#e8e0c8',S:'#3a1a20'}},
  vial:{rows:['.D.','.W.','GGG','GgG','.G.'],map:{D:'#6a4a30',W:'#d8e0e8',G:'#40b070',g:'#a0f0c0'}},
  dagger:{rows:['W......','.W.....','..W....','...WW..','....YD.','.....DD'],map:{W:'#d8dce8',Y:'#e0c050',D:'#5a3a20'}},
  map:{rows:['LLLLLLL','LMRMMML','LMMMGML','LMGMMRL','LLLLLLL'],map:{L:'#e8d8a8',M:'#c8b888',R:'#b03030',G:'#4a8a4a'}},
  lantern:{rows:['.D.','DDD','DYD','DYD','DDD'],map:{D:'#3a3440',Y:'#ffd866'}},
};
// The part of a setting worth showing (world px): the walls and floor, without the empty margin round them.
const cropCache=new WeakMap();
export function settingCrop(m){let c=cropCache.get(m);if(c)return c;let x0=m.w,y0=m.h,x1=-1,y1=-1;
  for(let y=0;y<m.h;y++)for(let x=0;x<m.w;x++)if(m.tiles[y*m.w+x]!==IT.VOID){if(x<x0)x0=x;if(y<y0)y0=y;if(x>x1)x1=x;if(y>y1)y1=y}
  if(x1<0){x0=0;y0=0;x1=m.w-1;y1=m.h-1}
  c={x:x0*T,y:y0*T,w:(x1-x0+1)*T,h:(y1-y0+1)*T};cropCache.set(m,c);return c}
// The scale a setting is drawn at in box (device px): whole numbers, so every texel is the same size (#536); below 1 only
// when the box is tiny.
export function settingScale(box,m){const c=settingCrop(m),f=Math.min(box.w/c.w,box.h/c.h);return f>=1?Math.floor(f):Math.max(.25,Math.floor(f*4)/4)}
export function drawSetting(ctx,box,m,st,now,dpr=1){
  const tex=interiorTexture(m),cr=settingCrop(m),sc=settingScale(box,m); // the room fills the box at a whole-number scale, crisp (#536)
  const ox=Math.round(box.x+(box.w-cr.w*sc)/2-cr.x*sc),oy=Math.round(box.y+(box.h-cr.h*sc)/2-cr.y*sc),W=m.w*T,H=m.h*T;
  ctx.setTransform(1,0,0,1,0,0);ctx.imageSmoothingEnabled=false;ctx.drawImage(tex,cr.x,cr.y,cr.w,cr.h,ox+cr.x*sc,oy+cr.y*sc,cr.w*sc,cr.h*sc);
  ctx.setTransform(sc,0,0,sc,ox,oy);
  // the room's own dimness (deeper at night and when the frame says so), then its fire, candles, lamps and daylight added back
  const dark=st.dark!=null?st.dark:m.dark||0,night=Math.max(0,dark-(m.dark||0));
  if(dark>0){ctx.fillStyle='rgba(14,16,34,'+dark+')';ctx.fillRect(cr.x,cr.y,cr.w,cr.h)}
  const G=glowSprite();ctx.save();ctx.beginPath();ctx.rect(T,T,W-2*T,H-2*T);ctx.clip();ctx.globalCompositeOperation='lighter'; // light stays inside the walls
  for(const p of m.props){const P=propOf(p.kind);if(!P||!P.light)continue;if(P.light==='day'&&night>.2)continue; // no daylight through the windows at night
    const R=(P.light==='crypt'?44:P.light==='day'?36:p.kind==='hearth'?50:30)*(1+night*.8);
    const f=P.light==='day'?.55:.72+.28*Math.sin(now*7+p.x*1.7+p.y)*Math.sin(now*3.1+p.x);
    const cx=p.x*T+P.ox+(P.rows?P.rows[0].length:16)/2,cy=p.y*T+P.oy+(P.light==='day'?12:6);
    ctx.globalAlpha=Math.max(0,f);ctx.drawImage(G[P.light],cx-R,cy-R,R*2,R*2)}
  ctx.restore();ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  // who stands where: the speaker on its spot, the party in an arc before it, turned toward it
  const ents=[],sp=m.spots,party=st.party||[],cast=st.cast||[],room=m.rooms[0],c0=sp.cast[0]||{x:room.x+room.w/2,y:room.y+1};
  const arc=arcSpots(party.length,c0,room);
  party.forEach((a,k)=>ents.push({e:a,x:arc[k].x,y:arc[k].y,hero:true,flip:arc[k].x>c0.x+.2}));
  cast.forEach((e,k)=>{const c=sp.cast[Math.min(k,sp.cast.length-1)],off=k<sp.cast.length?0:(k-sp.cast.length+1);
    ents.push({e,x:c.x+(off?(off&1?1:-1)*Math.ceil(off/2)*1.3:0),y:c.y+(off?.25:0),cast:true,flip:true})});
  ents.sort((a,b)=>a.y-b.y);
  const fr=Math.floor(now*1.6)&1,pseudo={close:true,sc,dpr,offX:ox,offY:oy};
  // the item, on the floor beside the speaker, softly lit and outlined in gold (drawn before the people)
  const art=st.item&&ITEM_ART[st.item];if(art){const s=outlined(sprite('it-'+st.item,art.rows,art.map)),ix=Math.round(c0.x*T+10),iy=Math.round(c0.y*T),pulse=.55+.3*Math.sin(now*3);
    ctx.globalCompositeOperation='lighter';ctx.globalAlpha=pulse;ctx.drawImage(G.warm,ix+s.width/2-14,iy-s.height/2-14,28,28);ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;
    ctx.drawImage(s,ix,iy-s.height);ctx.strokeStyle=MARK.sel;ctx.globalAlpha=pulse;ctx.lineWidth=dpr/sc;ctx.strokeRect(ix-1.5,iy-s.height-1.5,s.width+3,s.height+3);ctx.globalAlpha=1}
  for(const q of ents){const e=q.e,s=spriteOf(e,st.busy&&e===st.cur?fr:0);if(!s)continue;
    const px=Math.round(q.x*T),py=Math.round(q.y*T),o=outlined(s),top=py-s.height;q.px=px;q.top=top;
    if(dark>.15){ctx.globalCompositeOperation='lighter';ctx.globalAlpha=Math.min(.5,dark*.8);ctx.drawImage(G.warm,px-17,py-s.height*.75-6,34,34);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over'} // ambient pool: people always read in a dim room
    ctx.fillStyle=MARK.shadow;ctx.beginPath();ctx.ellipse(px,py-1,s.width/2,1.6,0,0,7);ctx.fill();
    if(q.cast||q.hero){const col=q.hero?classColor(e.cls):castColor(e);ctx.strokeStyle=col;ctx.globalAlpha=.8;ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(px,py-.5,s.width/2+1.5,2.5,0,0,7);ctx.stroke();ctx.globalAlpha=1}
    ctx.save();ctx.translate(px,0);if(q.flip)ctx.scale(-1,1);ctx.drawImage(o,-Math.floor(s.width/2)-1,top-1);ctx.restore();
    if(e.eff)drawConditions(ctx,null,pseudo,e,px,py,top,now);}
  // over the heads: the gold chevron for the one acting, "..." for a member still thinking, a tick once answered
  const marks=st.marks||{};
  for(const q of ents){if(q.top==null)continue;const k=q.e===st.cur?'turn':q.hero?marks[q.e.id]:null;if(k)answerMark(ctx,q.px,q.top-2,k,now)}
  // names in one place, under the feet on a dark plate, at a constant CSS size
  const compact=T*sc/dpr<14,big=T*sc/dpr>=32,fs=big?14:12; // a room seen at 2x and up reads at 14 px
  for(const q of ents){if(q.top==null)continue;const e=q.e,col=q.hero?classColor(e.cls):castColor(e);if(compact&&!q.cast&&e!==st.cur)continue;
    plate(ctx,nameOf(e),q.x*T,q.y*T+2*dpr/sc,col,fs,dpr,sc)}
  // the speaker's bubble (only words said out loud, core/spoken.js), and any member's own bubble from the chat; each
  // takes the first place over the head that keeps the room's furniture clear (above, then beside it right or left)
  const said=new Set(),rects=propRects(m);
  const place=(q,head,col,text,alpha)=>{const sz=bubbleSize(ctx,head,text,dpr,sc,fs),y=q.top-8,bottom=y-sz.pad*.7,gap=sz.pad*2;let best=0,bo=1e9;
    for(const dx of [0,sz.bw/2+gap,-(sz.bw/2+gap),sz.bw/2,-sz.bw/2]){const r={x:q.px+dx-sz.bw/2,y:bottom-sz.bh,w:sz.bw,h:sz.bh};let o=0;for(const p of rects)o+=over(r,p)*p.k;
      if(r.x<cr.x-T||r.x+r.w>cr.x+cr.w+T)o+=1e6;if(o<bo){bo=o;best=dx}if(!o)break}
    bubble(ctx,q.px,y,head,col,text,dpr,sc,alpha,best,fs)};
  if(st.speaker&&st.speaker.e){const q=ents.find(r=>r.e===st.speaker.e);if(q&&q.top!=null){place(q,headOf(q.e),q.hero?classColor(q.e.cls):castColor(q.e),st.speaker.text,1);said.add(q.e)}}
  for(const q of ents){const b=q.e.bubble;if(said.has(q.e)||q.top==null||!b||b.life<=0)continue;const t=spokenOf(unrole(b.text,st.people),nameOf(q.e));if(!t)continue;
    place(q,headOf(q.e),q.hero?classColor(q.e.cls):castColor(q.e),t,Math.min(1,b.life/.6))}
  ctx.setTransform(1,0,0,1,0,0);return {sc,ox,oy}}

// A mark over a head (current transform; x the head's centre, y just above it): 'turn' the gold chevron, 'think' three
// dots that take turns, 'done' a green tick, each on a dark plate. Shared with the outdoor cut (render/sceneview.js).
export function answerMark(ctx,x,y,k,now){x=Math.round(x);
  if(k==='turn'){y=Math.round(y-4+Math.sin(now*5));ctx.fillStyle=MARK.edge;ctx.fillRect(x-3,y-1,7,4);ctx.fillStyle=MARK.sel;ctx.fillRect(x-2,y,5,1);ctx.fillRect(x-1,y+1,3,1);ctx.fillRect(x,y+2,1,1);return}
  y=Math.round(y-6);ctx.fillStyle=MARK.edge;ctx.fillRect(x-5,y-1,11,7);
  if(k==='think'){const i=Math.floor(now*3)%3;for(let d=0;d<3;d++){ctx.fillStyle=d===i?'#ffffff':'#8a90b0';ctx.fillRect(x-4+d*3,y+2,2,2)}return}
  if(k==='done'){ctx.fillStyle='#7fe08a';for(const [a,b] of [[-3,2],[-2,3],[-1,4],[0,3],[1,2],[2,1],[3,0]])ctx.fillRect(x+a,y+b,1,1)}}
// A name on a dark plate (#536: one spot under the feet, readable at any scale), centred on x with its top at y.
function plate(ctx,t,x,y,col,css,dpr,sc){const s=css*dpr/sc;ctx.font=s+'px VT323, monospace';const w=ctx.measureText(t).width,p=s*.2;
  ctx.fillStyle='rgba(6,6,14,.8)';ctx.fillRect(x-w/2-p,y,w+2*p,s*.86);ctx.textAlign='center';ctx.fillStyle=col;ctx.fillText(t,x,y+s*.68)}

// A scene entity's sprite: a hero, a townsperson (S.wanderers / S.npcs) or a creature.
function spriteOf(e,fr){if(!e)return null;
  if(e.kind==='hero')return heroSprite(e,e.state==='ghost',fr);
  if(e.kind==='mob'){const M=MOBS[e.type];return M&&SPR[M.spr]?sprite(e.type+fr,SPR[M.spr][fr],M.col):null}
  if(e.role)return npcSprite(e,fr);return null}
const nameOf=e=>e.kind==='mob'?(e.name||(MOBS[e.type]&&MOBS[e.type].name)||'foe'):e.name||'?';
const headOf=e=>e.kind==='hero'?e.name.toUpperCase():'['+nameOf(e)+']';
function castColor(e){if(e.kind==='mob'||e.kind==='boss')return DISP.hostile.color;if(e.kind==='hero')return DISP.hostile.color;
  const t=toneOf(e,slotted(),S.gameMin);return t.color||DISP.neutral.color}

// A speech bubble over (x, y) in the current transform (sc world-to-device, dpr): a dark rounded box with the speaker's
// name in its colour and up to three wrapped lines. Shared by the outdoor cut (render/sceneview.js).
const BL=22,BMAX=3;
function wrapLine(t,bl=BL,bmax=BMAX){const out=[];let cur='';for(const w of String(t).split(' ')){if(cur&&(cur+' '+w).length>bl){out.push(cur);cur=w}else cur=cur?cur+' '+w:w}
  if(cur)out.push(cur);if(out.length>bmax){out.length=bmax;out[bmax-1]=out[bmax-1].slice(0,bl-1).trimEnd()+'…'}return out}
// css: the text size in CSS px (12 on the world map; a scene room seen at 2x and up uses 14 with longer lines, #536).
export function bubbleSize(ctx,head,body,dpr,sc,css=12){const s=css*dpr/sc,lh=s*.8,pad=s*.3,lines=(head?[head]:[]).concat(css>12?wrapLine(body,28,4):wrapLine(body));
  ctx.font=s+'px VT323, monospace';let w=0;for(const l of lines)w=Math.max(w,ctx.measureText(l).width);return {bw:w+pad*2,bh:lines.length*lh+pad*1.2,pad,lines,s,lh}}
// dx (#536) moves the box sideways off the head (the tail still points at x), so a line never covers the altar.
export function bubble(ctx,x,y,head,headCol,body,dpr,sc,alpha=1,dx=0,css=12){const {bw,bh,pad,lines,lh}=bubbleSize(ctx,head,body,dpr,sc,css);
  const bottom=y-pad*.7,top=bottom-bh,x0=x+dx-bw/2,tx=Math.max(x0+pad*1.2,Math.min(x0+bw-pad*1.2,x));
  ctx.globalAlpha=alpha;ctx.fillStyle='#0a0a16'; // opaque, edged in the speaker's colour (#471)
  if(ctx.roundRect){ctx.beginPath();ctx.roundRect(x0,top,bw,bh,pad);ctx.fill();if(headCol){ctx.strokeStyle=headCol;ctx.lineWidth=dpr/sc;ctx.stroke()}}else ctx.fillRect(x0,top,bw,bh);
  ctx.fillStyle='#0a0a16';
  ctx.beginPath();ctx.moveTo(tx-pad*.6,bottom);ctx.lineTo(tx+pad*.6,bottom);ctx.lineTo(x,bottom+pad*.7);ctx.fill();
  lines.forEach((l,i)=>text(ctx,l,x0+bw/2,top+pad*.6+lh*(i+.85),head&&i===0?headCol:TEXT.label,css,dpr,sc));ctx.globalAlpha=1}
