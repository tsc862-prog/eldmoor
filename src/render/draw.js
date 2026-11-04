// Map renderer: camera (free camera with zoom steps and panning, or follow), terrain
// chunks that intersect the view, entities sorted by y and culled to the view,
// effects, day/night overlay with torch light, labels at constant CSS size, minimap.
// `cam` is shared with the UI (selection and view mode live here).
// All world positions are in world units: tiles times T (render/tile.js U, 16 a tile). Art is drawn at TILE (32) pixels
// a tile: terrain chunks and generated sheets are scaled down to world units, procedural sprites scaled up (#177).
//
// Camera model: cam.fit is the scale at which the whole map fits the canvas.
//   free camera ('map'): sc = fit * zoom, zoom one of ZOOMS; camX/camY is the view
//     centre in world px, clamped so the view never leaves the map (at zoom 1 that
//     pins it to the map centre, exactly the old whole-map view).
//   follow: sc = max(fit*2.6, canvas/(followTiles(canvas)*T), art-snapped) and the centre eases to the hero.
//   A wheel, drag or minimap click in follow mode drops to the free camera at the
//   same scale, so nothing jumps.
import {clamp} from '../core/rng.js';
import {W,H,LAVA} from '../world/tiles.js';
import {U as T,ART,PROC_SCALE,HEAD,followTiles} from './tile.js';
import {OUTPOSTS} from '../world/map.js';
import {outpostsView} from '../sim/outposts.js';
import {LAIR,CRYPT,CRYPTS,LANDMARKS,LIGHTS,LABELS,tiles,I} from '../world/map.js';
import {cryptNamed} from '../sim/crypts.js';
import {FAC} from '../data/factions.js';
import {MOBS} from '../data/mobs.js';
import {S,maxHp} from '../sim/index.js';
import {sprite,SPR,heroSprite,npcSprite,outlined,worldSprite,sheetFrame} from './sprites.js';
import {classColor,toneOf,toneName,DISP} from '../core/colors.js';
import {drawBubbles,bubbleBoxes} from './bubbles.js';
import {bubbleVisible} from '../core/chatview.js';
import {drawWeather} from './weather.js';
import {drawEncounters} from './encounters.js';
import {drawPlaces} from './places.js';
import {drawCamp,drawCampLight} from './camp.js';
import {trafficEnts,isTraffic,drawTrafficEnt} from './traffic.js'; // carts, travellers and road guards (#856)
import {drawMemorials} from './memorials.js';
import {drawConditions,condLift} from './conditions.js';
import {getChunk,CH,CHUNKS_X,CHUNKS_Y} from './terrain.js';
import {createMinimap} from './minimap.js';
import {syncSpells,drawSpells} from './spellfx.js';
import {TEXT,MARK,LIGHT,BOSS_PAL} from './palette.js';
import {initDungeonView,dungeonOpen,drawDungeon,trackCrawl} from './dungeonview.js'; // the dungeon view over the world (#85)
import {trackRaid} from './raidview.js'; // the raid arena's record of each raid it saw (#85)
import {initSceneView,sceneTick,sceneCut,drawSceneView,drawSceneRings,drawSceneMarks,arenaPattern,refreshOutdoor} from './sceneview.js'; // scene maps (#431)
import {CITY} from '../world/map.js';
import {drawPurposeGround,drawIntentIcon} from './purposefx.js'; // what a hero is trying to do (#534): path, tether, wait line, intent icons
import {inSlots,slotted} from '../sim/company.js'; // the slotted company (#588)
const SCENE_LIGHT=[255,232,196]; // the light under a Table scene's people at night (#471)
const TOWNS=new Set(CITY.map(c=>c.name.toUpperCase())); // town labels are places (gold), the rest regions

export const ZOOMS=[1,1.6,2.6,4];
export const cam={view:'map',sel:null,camX:W*T/2,camY:H*T/2,sc:1,offX:0,offY:0,dpr:1,fit:1,zoom:1,vw:W*T,vh:H*T,close:false,region:null,hover:null,icons:true}; // hover, icons: the hovered hero and the Intent icons switch in Settings (#534, render/purposefx.js)
const BOSS_HEAD=SPR.boss[0].length*PROC_SCALE+6; // Kragmaw's nameplate height over its feet
// The facing of each entity for a generated sheet (0 down, 1 left, 2 right, 3 up), from how it last moved.
const FACE=new WeakMap();
function dirOf(e){let f=FACE.get(e);if(!f){f={x:e.x,y:e.y,d:e.face<0?1:2};FACE.set(e,f)}
  const dx=e.x-f.x,dy=e.y-f.y;if(dx*dx+dy*dy>1e-4){f.d=Math.abs(dx)>=Math.abs(dy)?(dx<0?1:2):(dy<0?3:0);f.x=e.x;f.y=e.y}return f.d}
const STEP=[1,0,2,0]; // sheet columns of a walk cycle
// Entities and labels this many world px outside the view are not drawn.
const MARGIN=48;
// BOSS_PAL lives in palette.js (#85: the raid arena draws Kragmaw too)

// ---- camera control (module level so the UI and tools can drive it) ----
let cvRef=null;const listeners=[];
export function onCamChange(fn){listeners.push(fn)}
const changed=()=>{for(const f of listeners)f(cam)};
// Whole art pixels where it costs under a quarter step, so the generated art stays sharp (art px per unit is ART).
const snapArt=sc=>{const a=sc*ART,r=Math.round(a);return Math.abs(a-r)<.3&&r>=1?r/ART:sc};
const followScale=()=>cvRef?Math.max(cam.fit*2.6,snapArt(cvRef.width/(followTiles(cvRef.width)*T))):cam.fit*2.6;
// 'fellow' view (#68): cam.frame() (set by ui/controls.js) returns {x,y,w,h} in tiles framing the Fellowship, or null.
const framed=()=>cam.view==='fellow'&&typeof cam.frame==='function'?cam.frame():cam.view==='region'&&typeof cam.regionFrame==='function'?cam.regionFrame():null; // 'region' view (#430): cam.regionFrame() frames the picked region
const frameScale=f=>cvRef?clamp(Math.min(cvRef.width/((f.w+8)*T),cvRef.height/((f.h+6)*T)),cam.fit,followScale()):cam.fit*2.6;
const following=()=>(cam.view==='follow'&&!!cam.sel)||!!framed();
// The zoom the camera is effectively at right now (follow mode included).
export const currentZoom=()=>{const f=framed();return f?frameScale(f)/cam.fit:following()?followScale()/cam.fit:cam.zoom};
export function stepZoom(z,dir){if(dir>0){for(const s of ZOOMS)if(s>z+1e-6)return s;return ZOOMS[ZOOMS.length-1]}
  let r=ZOOMS[0];for(const s of ZOOMS)if(s<z-1e-6)r=s;return r}
function clampCam(){const vw=cvRef?cvRef.width/cam.sc:cam.vw,vh=cvRef?cvRef.height/cam.sc:cam.vh;cam.vw=vw;cam.vh=vh;
  cam.camX=vw>=W*T?W*T/2:clamp(cam.camX,vw/2,W*T-vw/2);cam.camY=vh>=H*T?H*T/2:clamp(cam.camY,vh/2,H*T-vh/2)}
// Leave follow mode (if on) for the free camera at zoom z, keeping the centre.
function freeCam(z){cam.view='map';cam.zoom=z;cam.sc=cam.fit*z;clampCam()}
export function setZoom(z){freeCam(z);changed()}
// Zoom one step in (dir>0) or out around the pointer position (client px), keeping the world point under it fixed.
export function zoomAt(clientX,clientY,dir){const nz=stepZoom(currentZoom(),dir);if(nz===currentZoom()&&!following())return;
  const r=cvRef.getBoundingClientRect(),px=(clientX-r.left)*cam.dpr,py=(clientY-r.top)*cam.dpr;
  const wx=(px-cam.offX)/cam.sc,wy=(py-cam.offY)/cam.sc,nsc=cam.fit*nz;
  freeCam(nz);cam.camX=wx-(px-cvRef.width/2)/nsc;cam.camY=wy-(py-cvRef.height/2)/nsc;clampCam();changed()}
// Pan by a pointer delta in CSS px (dragging right moves the world right).
export function panBy(dx,dy){freeCam(currentZoom());cam.camX-=dx*cam.dpr/cam.sc;cam.camY-=dy*cam.dpr/cam.sc;clampCam();changed()}
// Centre the free camera on a world-pixel point; from the whole-map view this also zooms in to the local step.
export function centerOn(wx,wy){const z=currentZoom();freeCam(z<ZOOMS[1]?2.6:z);cam.camX=wx;cam.camY=wy;clampCam();changed()}
// Convert a pointer position (client px) to tile coordinates.
export function screenToWorld(clientX,clientY){const r=cvRef.getBoundingClientRect();
  return {x:((clientX-r.left)*cam.dpr-cam.offX)/cam.sc/T,y:((clientY-r.top)*cam.dpr-cam.offY)/cam.sc/T}}

// Lava light for the night pass: one pixel per tile, each tile's share of lava in a 5x5 window,
// scaled up with smoothing so whole lava fields glow softly. Built once (two variants: with and
// without Kragmaw's ring, which cools while the wyrm is dead). Any world size, any number of fields.
const glowC={};
function lavaGlow(cooled){const k=cooled?1:0;if(glowC[k])return glowC[k];
  const lair=LANDMARKS.find(l=>l.kind==='lair'),c=document.createElement('canvas');c.width=W;c.height=H;const x=c.getContext('2d'),img=x.createImageData(W,H),d=img.data;
  const lava=(tx,ty)=>tx>=0&&ty>=0&&tx<W&&ty<H&&tiles[I(tx,ty)]===LAVA&&!(cooled&&lair&&Math.hypot(tx+.5-lair.x,ty+.5-lair.y)<=lair.r+1)?1:0;
  const C=LIGHT.lava;
  for(let ty=0;ty<H;ty++)for(let tx=0;tx<W;tx++){let n=0;for(let j=-2;j<=2;j++)for(let i=-2;i<=2;i++)n+=lava(tx+i,ty+j)*(i||j?1:3);
    if(!n)continue;const o=(ty*W+tx)*4;d[o]=C[0];d[o+1]=C[1];d[o+2]=C[2];d[o+3]=Math.min(255,n*16)}
  x.putImageData(img,0,0);return glowC[k]=c}

export function createRenderer(cv,screenEl){
  const ctx=cv.getContext('2d');cvRef=cv;
  const miniEl=document.getElementById('minimap');
  const mini=miniEl&&miniEl.getContext?createMinimap(miniEl,cam,centerOn):null;
  function resize(){const r=screenEl.getBoundingClientRect();cam.dpr=window.devicePixelRatio||1;cv.width=Math.max(1,Math.round(r.width*cam.dpr));cv.height=Math.max(1,Math.round(r.height*cam.dpr));
    cam.fit=Math.min(cv.width/(W*T),cv.height/(H*T));if(mini)mini.resize()}
  new ResizeObserver(resize).observe(screenEl);resize();initDungeonView();initSceneView();

  function darkness(){const h=(S.gameMin/60)%24;if(h>=21||h<5)return .55;if(h>=18)return (h-18)/3*.55;if(h<7)return (7-h)/2*.55;return 0}
  function drawText(txt,x,y,col,css){const s=css*cam.dpr/cam.sc;ctx.font=s+'px VT323, monospace';ctx.textAlign='center';ctx.fillStyle='#000';ctx.fillText(txt,x+s*.07,y+s*.07);ctx.fillStyle=col;ctx.fillText(txt,x,y)}
  // A thin disposition ellipse at the feet (close zoom only), the same colours as the UI.
  function dispoRing(x,y,w,d){ctx.strokeStyle=(DISP[d]||DISP.neutral).color;ctx.globalAlpha=.75;ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(x,y+.5,w/2+1.5,2.5,0,0,7);ctx.stroke();ctx.globalAlpha=1}
  // Label queue: lab() records, flushLabels() places by priority with overlap rejection in screen px.
  // The queue and box arrays are reused across frames.
  // A label may carry other heights to try before it is dropped (alt, world y) and a dark plate behind it (pl): a Table
  // scene's people stack instead of vanishing and stay readable at night (#471). RES: screen boxes kept clear (bubbles).
  const LQ=[],POOL=[],BOX=[],RES=[];
  function lab(t,x,y,col,css,pri,alt,pl,up){const n=LQ.length,L=POOL[n]||(POOL[n]={});L.t=t;L.x=x;L.y=y;L.col=col;L.css=css;L.pri=pri;L.i=n;L.alt=alt||null;L.pl=!!pl;L.up=up||0;LQ.push(L)}
  function flushLabels(sc){LQ.sort((a,b)=>b.pri-a.pri||a.i-b.i);BOX.length=0;for(const v of RES)BOX.push(v);RES.length=0;
    for(const L of LQ){const s=L.css*cam.dpr;ctx.font=s+'px VT323, monospace';const w=ctx.measureText(L.t).width,sx=L.x*sc+cam.offX;
      // a bunched crowd stacks upward in whole plate heights (L.up tries) instead of piling; scene labels try their alt heights (#842)
      for(let j=-1;j<(L.alt?L.alt.length:L.up);j++){const y=j<0?L.y:L.alt?L.alt[j]:L.y-(j+1)*(s*1.02/sc),sy=y*sc+cam.offY;
        const x0=sx-w/2-2,y0=sy-s*.75,x1=sx+w/2+2,y1=sy+s*.12+(L.up?1:0);let hit=false;
        for(let k=0;k<BOX.length;k+=4)if(BOX[k]<x1&&BOX[k+2]>x0&&BOX[k+1]<y1&&BOX[k+3]>y0){hit=true;break}
        if(hit)continue;BOX.push(x0,y0,x1,y1);
        if(L.pl){ctx.fillStyle='rgba(8,10,20,.82)';ctx.fillRect((x0-cam.offX)/sc,(y0-1-cam.offY)/sc,(x1-x0)/sc,(y1-y0+3)/sc)}
        drawText(L.t,L.x,y,L.col,L.css);break}}}
  // A radial light of colour c=[r,g,b] and strength a at world (x,y), radius r (lighter pass).
  function glow(x,y,r,c,a){const g=ctx.createRadialGradient(x,y,0,x,y,r),k=c[0]+','+c[1]+','+c[2];g.addColorStop(0,'rgba('+k+','+a+')');g.addColorStop(1,'rgba('+k+',0)');ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2)}
  function shadow(x,y,w){ctx.fillStyle=MARK.shadow;ctx.beginPath();ctx.ellipse(x,y,w/2,1.5,0,0,7);ctx.fill()}

  // Draw the terrain chunks that intersect the canvas, each snapped to integer device
  // pixels so neighbouring chunks never show a seam at fractional scales.
  function drawTerrain(sc){ctx.setTransform(1,0,0,1,0,0);ctx.imageSmoothingEnabled=false;const cs=CH*T;
    const i0=Math.max(0,Math.floor(-cam.offX/sc/cs)),i1=Math.min(CHUNKS_X-1,Math.floor((cv.width-cam.offX)/sc/cs));
    const j0=Math.max(0,Math.floor(-cam.offY/sc/cs)),j1=Math.min(CHUNKS_Y-1,Math.floor((cv.height-cam.offY)/sc/cs));
    for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const c=getChunk(i,j);
      const x0=Math.round(cam.offX+i*cs*sc),y0=Math.round(cam.offY+j*cs*sc),x1=Math.round(cam.offX+(i*cs+c.uw)*sc),y1=Math.round(cam.offY+(j*cs+c.uh)*sc); // c.uw/uh: the chunk in world units, whatever its resolution
      ctx.drawImage(c,0,0,c.width,c.height,x0,y0,x1-x0,y1-y0)}}

  let blink=0;
  function draw(){
    trackCrawl();trackRaid();sceneTick(cam);if(dungeonOpen()){drawDungeon(performance.now()/1000);if(mini)mini.draw(S);return} // the dungeon view covers the world; skip drawing it
    if(drawSceneView(performance.now()/1000))return; // an indoor scene map covers the world too (#431)
    blink+=1/60;const {agents,mobs,boss,fx}=S;
    ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#000';ctx.fillRect(0,0,cv.width,cv.height);
    const sel=cam.sel,fr=framed(),follow=following(),cut=sceneCut(cv.width/Math.max(1,cv.height));
    if(cut){ // an outdoor scene (#431): the camera frames the scene's cut of the world below the banner and above the bar
      const top=cut.top*cam.dpr,bot=cut.bottom*cam.dpr,rt=(cut.right||0)*cam.dpr,want=Math.max(cam.fit*2,Math.min(Math.max(40,cv.width-rt)/(cut.w*T),Math.max(40,cv.height-top-bot)/(cut.h*T)));
      const first=!cam.cut;cam.cut=true;cam.sc=first?want:cam.sc+(want-cam.sc)*.15;
      const tx=cut.cx*T+rt/2/cam.sc,ty=cut.cy*T-(top-bot)/2/cam.sc; /* the banner docked on the right (#546): the cut fills the room left of it */if(first){cam.camX=tx;cam.camY=ty}else{cam.camX+=(tx-cam.camX)*.15;cam.camY+=(ty-cam.camY)*.15}
      cam.vw=cv.width/cam.sc;cam.vh=cv.height/cam.sc}
    else{cam.cut=false;
    cam.sc=fr?cam.sc+(frameScale(fr)-cam.sc)*.08:follow?followScale():cam.fit*cam.zoom;
    if(fr){cam.camX+=(fr.x*T-cam.camX)*.1;cam.camY+=(fr.y*T-cam.camY)*.1}
    else if(follow){cam.camX+=(sel.x*T-cam.camX)*.12;cam.camY+=(sel.y*T-cam.camY)*.12}
    clampCam()}
    const sc=cam.sc,vw=cam.vw,vh=cam.vh;
    cam.offX=Math.round((vw/2-cam.camX)*sc);cam.offY=Math.round((vh/2-cam.camY)*sc);
    const vx0=cam.camX-vw/2,vy0=cam.camY-vh/2,vx1=vx0+vw,vy1=vy0+vh;
    const inView=(x,y,m)=>x>vx0-m&&x<vx1+m&&y>vy0-m&&y<vy1+m;
    if(cut&&cut.edge){ctx.setTransform(sc,0,0,sc,cam.offX,cam.offY);ctx.imageSmoothingEnabled=false;ctx.fillStyle=arenaPattern(ctx,cut.biome);ctx.fillRect(vx0,vy0,vw,vh)} // past the map's edge: a generated arena of the biome's ground
    drawTerrain(sc);
    ctx.setTransform(sc,0,0,sc,cam.offX,cam.offY);ctx.imageSmoothingEnabled=false;
    // lava shimmer: embers drifting around the lair ring
    const tt=performance.now()/400;
    if(S.boss.alive&&inView(LAIR.x*T,LAIR.y*T,96)){ctx.fillStyle=MARK.ember;for(let i=0;i<14;i++){const a=i*2.4+tt*.3;ctx.fillRect(Math.round(LAIR.x*T+Math.cos(a)*76),Math.round(LAIR.y*T+Math.sin(a)*76),2,2)}}
    if(OUTPOSTS.length){ // contested outposts (#11): a banner pole in the holder's colour (grey when unclaimed) and a capture bar
      for(const o of outpostsView()){const px=Math.round(o.x*T),py=Math.round(o.y*T);if(!inView(px,py,40))continue;
        const col=o.holder>=0?FAC[o.holder].color:'#8a8a96',dk=o.holder>=0?FAC[o.holder].dark:'#4a4a56';
        ctx.fillStyle='#3a2f28';ctx.fillRect(px-1,py-14,2,16);ctx.fillStyle=col;ctx.fillRect(px+1,py-14,9,6);ctx.fillStyle=dk;ctx.fillRect(px+1,py-9,9,1);
        const f=Math.abs(o.ctl)/100;ctx.fillStyle='#14141c';ctx.fillRect(px-11,py+5,22,3);
        if(f>0){ctx.fillStyle=o.ctl>0?FAC[0].color:FAC[1].color;ctx.fillRect(px-10,py+6,Math.round(20*f),1)}
        if(o.contested){ctx.fillStyle=MARK.ember;ctx.fillRect(px-10,py+9,20,1)}}}
    const close=cam.close=sc>=cam.fit*2;
    drawEncounters(ctx,S,cam,sprite,SPR,blink,drawText); // road encounters under the entities
    drawMemorials(ctx,S,cam,{sprite,SPR,inView,drawText,blink}); // gravestones, statues, cooled lair (sim/memorials.js)
    drawPlaces(ctx,S,cam,{blink,drawText,inView,npcSprite,outlined,dispoRing}); // DM lever markers, conditions and DM-placed people (sim/levers.js)
    drawCamp(ctx,S,cam,{inView,blink,drawText}); // the Fellowship's campfire and bedrolls (sim/camp.js)
    if(!cut)drawPurposeGround(ctx,S,cam,{drawText,blink}); // the followed or hovered hero's road, tether or wait line, under the entities
    if(cut)drawSceneRings(ctx,cam,cut); // who is in the scene: a ring at their feet (#431)
    const fxNow=performance.now()/1000;syncSpells(fx,fxNow,inView);drawSpells(ctx,0,close,inView,fxNow); // spell effects on the ground: rings, roots, briars (#374)
    // entities in view, sorted by y: mobs, heroes, townsfolk (sim/npcs.js) and the boss
    const ents=[];
    for(const m of mobs)if(m.alive&&!m.hidden&&inView(m.x*T,m.y*T,MARGIN))ents.push(m);
    for(const a of agents)if(!a.hidden&&inView(a.x*T,a.y*T,MARGIN))ents.push(a);
    for(const p of S.npcs||[])if(inView(p.x*T,p.y*T,MARGIN))ents.push(p);
    if(boss.alive&&inView(boss.x*T,boss.y*T,MARGIN))ents.push(boss);
    if(close&&!cut)trafficEnts(S,inView,MARGIN,ents); // road traffic, skipped at whole-map zoom
    ents.sort((a,b)=>a.y-b.y);
    for(const e of ents){
      if(isTraffic(e)){drawTrafficEnt(ctx,e,Math.round(e.x*T),Math.round(e.y*T),blink,shadow);continue}
      const fr=e.moving?Math.floor(blink*6+e.id)%2:0;
      let s;if(e.kind==='mob'){const M=MOBS[e.type];s=sprite(e.type+fr,SPR[M.spr][fr],M.col)}
      else if(e.kind==='boss'){const bf=Math.floor(blink*1.6)%2;s=sprite('boss'+bf,SPR.boss[bf],BOSS_PAL)}
      else if(e.kind==='npc')s=npcSprite(e,e.moving?fr:Math.floor(blink*1.5)%2); // idle townsfolk work their hands
      else if(e.state==='dead')s=sprite('grave'+e.fac,SPR.grave[0],{G:'#8a8a96',F:'#3a3a46',B:FAC[e.fac].dark});
      else s=heroSprite(e,e.state==='ghost',fr);
      const px=Math.round((e.x+(e.kind==='npc'&&e.state==='home'&&!e.moving?((e.id%3)-1)*.6:0))*T),py=Math.round(e.y*T),live=e.state!=='dead'; // townsfolk at home stand on one wall column a tile apart (sim homeAt): stagger them over three lanes so the sprites do not stack (#701)
      // a generated sheet (#177) for a living hero or creature, else the procedural sprite scaled to the same height
      const G=live&&e.state!=='ghost'&&(e.kind==='hero'||e.kind==='mob')?sheetFrame(e,dirOf(e),e.moving?STEP[Math.floor(blink*6+e.id)%4]:0):null;
      const sw=G?G.fw/ART:s.width*PROC_SCALE,sh=G?G.fh/ART:s.height*PROC_SCALE;
      if(e.kind==='hero'&&e.state==='ghost')ctx.globalAlpha=.6;
      if(live)shadow(px,py,sw);
      if(close&&e.kind==='npc')dispoRing(px,py,sw,toneOf(e,slotted(),S.gameMin).kind); // townsfolk: friendly green, wary amber, hostile red
      if(G)ctx.drawImage(G.img,G.sx,G.sy,G.fw,G.fh,px-sw/2,py-sh,sw,sh);
      else{const o=worldSprite(s,live),ow=live?1/ART:0; // living entities get the dark outline, one art pixel wide
        ctx.save();ctx.translate(px,0);if(e.face<0)ctx.scale(-1,1);
        ctx.drawImage(o,-Math.floor(s.width/2)*PROC_SCALE-ow,py-sh-ow,o.width/ART,o.height/ART);ctx.restore()}
      ctx.globalAlpha=1;
      const top=py-sh;
      // role markers at the post: the gate captain's quest mark, the quartermaster's auction sign
      if(e.kind==='npc'&&e.state==='post'){if(e.role==='captain'){const by=Math.round(Math.sin(blink*4));ctx.fillStyle=MARK.quest;ctx.fillRect(px-1,top-11+by,2,6);ctx.fillRect(px-1,top-4+by,2,2)}
        else if(e.role==='quartermaster'){ctx.fillStyle='#f2c14e';ctx.fillRect(px-2,top-8,4,4);ctx.fillStyle='#8a6a1a';ctx.fillRect(px-1,top-6,2,1)}}
      if(e===sel){ctx.fillStyle=Math.floor(blink*3)%2?MARK.sel:MARK.selHi;ctx.fillRect(px-2,top-7,5,2);ctx.fillRect(px-1,top-5,3,1);ctx.fillRect(px,top-4,1,1)}
      if(close&&e.hp<(e.kind==='hero'?maxHp(e):e.maxhp)&&e.state!=='ghost'&&e.state!=='dead'){const mx=e.kind==='hero'?maxHp(e):e.maxhp,w=(e.kind==='boss'?21:8)*PROC_SCALE;
        ctx.fillStyle=MARK.hpBack;ctx.fillRect(px-w/2-1,top-4,w+2,4);ctx.fillStyle=e.kind==='hero'?MARK.hpHero:MARK.hpFoe;ctx.fillRect(px-w/2,top-3,Math.max(0,w*e.hp/mx),2)}
      if(e.kind==='hero'&&!cut)drawIntentIcon(ctx,S,cam,e,px,top,sw,close); // the intent icon at the right shoulder (#534)
      if(close&&e.eff)drawConditions(ctx,S,cam,e,px,py,top,blink); // Table conditions over the head (#307)
    }
    // effects: bolts leave a short fading trail; the boss's breath ring
    for(const p of fx){if(p.type==='bolt'){const t=1-p.life/.25;if(!inView(p.x0*T,p.y0*T,96))continue;ctx.fillStyle=p.col;
        for(let k=2;k>=0;k--){const tk=Math.max(0,t-k*.12),x=(p.x0+(p.x1-p.x0)*tk)*T,y=(p.y0+(p.y1-p.y0)*tk)*T;ctx.globalAlpha=k?.25*(3-k):1;ctx.fillRect(Math.round(x),Math.round(y),k?2:3,2)}
        ctx.globalAlpha=1}
      if(p.type==='ring'){if(!inView(p.x*T,p.y*T,96))continue;ctx.strokeStyle='rgba(255,140,40,'+p.life+')';ctx.lineWidth=3;ctx.beginPath();ctx.arc(p.x*T,p.y*T,(1-p.life/.6)*72+8,0,7);ctx.stroke()}}
    // weather sits on the ground, so it goes under the night: fog no longer brightens midnight
    drawWeather(ctx,S,cam,blink);
    // night: a blue wash, then light added back (lighter): lava fields glow, torches flicker,
    // crypt mouths breathe a faint green, the camp fire (camp.js)
    const dk=darkness();if(dk>0){const N=LIGHT.night;ctx.fillStyle='rgba('+N[0]+','+N[1]+','+N[2]+','+dk+')';if(cut&&cut.edge)ctx.fillRect(vx0,vy0,vw,vh);else ctx.fillRect(0,0,W*T,H*T); // an outdoor scene's arena past the edge darkens too
      ctx.globalCompositeOperation='lighter';
      const lg=lavaGlow(!S.boss.alive);ctx.globalAlpha=dk*.65;ctx.imageSmoothingEnabled=true;ctx.drawImage(lg,0,0,W,H,0,0,W*T,H*T);ctx.imageSmoothingEnabled=false;ctx.globalAlpha=1;
      const now=performance.now()/1000;
      for(const L of LIGHTS){const r=L.big?92:28;if(!inView(L.x*T,L.y*T,r))continue;const fl=L.big?1:.86+.14*Math.sin(now*7.3+L.x*3.1)*Math.sin(now*3.1+L.y);
        glow(L.x*T,L.y*T,r*(L.big?1:.94+.06*fl),LIGHT.torch,dk*.7*fl)}
      for(const L of LANDMARKS)if(L.kind==='crypt'&&L.mouth){const x=(L.mouth.x0+L.mouth.x1+1)/2*T,y=(L.mouth.y0+1)*T;if(inView(x,y,40))glow(x,y,26,LIGHT.crypt,dk*(.35+.1*Math.sin(now*1.3)))}
      drawCampLight(ctx,S,dk,inView);
      if(cut)for(const e of cut.members.concat(cut.foes))glow(e.x*T,e.y*T-HEAD/2,22*PROC_SCALE*.75,SCENE_LIGHT,dk*.6); // a Table scene's people keep a pool of light at night (#471)
      ctx.globalCompositeOperation='source-over'}
    drawSpells(ctx,1,close,inView,fxNow); // spell effects in the air, over the night wash: they carry their own light (#374)
    // Labels by zoom (#176). Every label is queued with a priority, then placed highest first; one
    // that would overlap a placed label is dropped, so a crowd shows its most important names.
    //   far (zoom < 2): regions (pale, larger), towns and landmarks (gold), Fellowship names.
    //   close: the selected hero, Fellowship, Kragmaw, elites, wary or hostile folk, then other heroes;
    //   townsfolk and friendly strangers only when near (zoom 4 or a follow camera).
    const LM=MARGIN*4,near=close&&(following()||sc>=cam.fit*3.5),inMap=(y,css)=>{const s=css*cam.dpr/sc;return clamp(y,s*.9,H*T-s*.25)};
    const LS=Math.max(22,Math.min(28,Math.round(cv.height/cam.dpr/36))); // hero name size follows the pane, never under about 11 px of capitals (#842)
    LQ.length=0;
    if(!close){
      for(const[t,x,y]of LABELS)if(inView(x*T,y*T,LM)){const town=TOWNS.has(t);lab(t,x*T,inMap(y*T,town?13:15),town?TEXT.place:TEXT.region,town?13:15,town?6:3)}
      if(sel&&!sel.hidden&&sel.state!=='dead'&&inView(sel.x*T,sel.y*T,40))lab(sel.name,sel.x*T,sel.y*T-HEAD,MARK.sel,16,10,null,true); // the followed hero is named at any zoom
      if(boss.alive&&inView(LAIR.x*T,LAIR.y*T,LM))lab('KRAGMAW',LAIR.x*T,(LAIR.y-3)*T,TEXT.elite,12,5);
      for(const L of LANDMARKS){if(L.kind!=='crypt'||!L.mouth||!inView(L.x*T,L.y*T,LM))continue; // every crypt, labelled just above its mouth
        const D=cryptNamed(L.name),g=D&&D.group&&D.group.phase==='inside'?D.group:null,word=L.name.replace(/^the /i,'').toUpperCase();
        lab(g?(D===CRYPT?'CRYPT':word)+' · '+g.mem.length+' INSIDE':word,(L.mouth.x0+L.mouth.x1+1)/2*T,(L.mouth.y0-.6)*T,TEXT.crypt,12,5)}}
    else{
      for(const D of CRYPTS)if(D.group&&D.group.phase==='inside'&&inView(D.x*T,D.y*T,LM))lab(D.group.mem.length+' inside · '+Math.ceil(D.group.t)+'s',D.x*T,D.mouth.y0*T-4,TEXT.crypt,14,7);
      const lh=14*cam.dpr/sc;
      if(cut)for(const r of bubbleBoxes(ctx,S,cam))RES.push(r[0]*sc+cam.offX,r[1]*sc+cam.offY,r[2]*sc+cam.offX,r[3]*sc+cam.offY); // a Table scene: names keep clear of the bubbles (#471)
      for(const a of agents){if(a.hidden||!inView(a.x*T,a.y*T,40))continue;
        const dead=a.state==='dead';if(dead&&!near&&a!==sel)continue;
        const inCut=cut&&!dead&&(cut.members.includes(a)||cut.foes.includes(a)),y=a.y*T-HEAD-condLift(a,cam);
        if(inCut&&a.bubble&&a.bubble.life>0&&bubbleVisible(a,S))continue; // its bubble names it already: one label per member
        if(inCut){lab(a.name,a.x*T,y,inSlots(a)?classColor(a.cls):FAC[a.fac].color,14,inSlots(a)?9:8,[y-lh*1.05,a.y*T+4+lh*.8,y-lh*2.1],true);continue} // class colour, a plate, and other heights before it is dropped
        const mate=!dead&&inSlots(a); // a company member is always named: big, class colour, a plate, stacked when bunched (#842)
        lab((dead?'† ':'')+a.name,a.x*T,y,a===sel?MARK.sel:mate?classColor(a.cls):dead?TEXT.dead:FAC[a.fac].color,mate||a===sel?LS:LS-4,a===sel?10:mate?8:dead?1:4,null,mate||a===sel,mate?6:0)}
      for(const p of S.npcs||[])if(inView(p.x*T,p.y*T,40)){const t=toneOf(p,slotted(),S.gameMin);if(t.kind==='friendly'&&!near)continue; // townsfolk nameplates: [name] in the disposition colour; a wary or hostile one at any close zoom
        lab(toneName(p,t),p.x*T,p.y*T-HEAD-condLift(p,cam),t.color||TEXT.person,12,t.kind==='friendly'?2:5)}
      for(const m of mobs){if(!m.elite||!m.alive||!inView(m.x*T,m.y*T,40))continue;lab(m.name,m.x*T,m.y*T-HEAD-condLift(m,cam),TEXT.elite,14,6)} // named elite nameplate
      if(boss.alive&&inView(boss.x*T,boss.y*T,LM))lab('Kragmaw · '+Math.max(0,Math.round(boss.hp/boss.maxhp*100))+'%',boss.x*T,boss.y*T-BOSS_HEAD-condLift(boss,cam),TEXT.elite,15,9)}
    // The Fellowship (#94): a role marker over each member and their name at any zoom (close views
    // queue the names above), plus a dashed ring around the party in Follow Fellowship.
    if(slotted()){const px1=cam.dpr/sc,F=slotted(),mem=[];for(const k in F.slots){const a=agents.find(x=>x.id==F.slots[k]);if(a&&!a.hidden&&a.state!=='dead')mem.push(a)}
      if(cam.view==='fellow'&&mem.length>1){let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const a of mem){x0=Math.min(x0,a.x);y0=Math.min(y0,a.y);x1=Math.max(x1,a.x);y1=Math.max(y1,a.y)}
        ctx.save();ctx.strokeStyle=MARK.party;ctx.lineWidth=2*px1;ctx.setLineDash([6*px1,4*px1]);ctx.beginPath();ctx.ellipse((x0+x1)/2*T,((y0+y1)/2-.4)*T,((x1-x0)/2+1.6)*T,((y1-y0)/2+1.6)*T,0,0,7);ctx.stroke();ctx.restore()}
      for(const a of mem){if(!inView(a.x*T,a.y*T,40)||(cut&&cut.members.includes(a)))continue;const col=classColor(a.cls); // in a Table scene the ring and the class-coloured name mark them (#471) // a member's marker: its class colour (one palette, core/colors.js)
        if(close)continue; // up close the plate is in the class colour: no diamond to pile (#842)
        const m=Math.max(3,5*px1),cx=Math.round(a.x*T),cy=a.y*T-HEAD-15*px1-m-condLift(a,cam);
        ctx.fillStyle=MARK.edge;ctx.beginPath();ctx.moveTo(cx,cy-m-px1);ctx.lineTo(cx+m+px1,cy);ctx.lineTo(cx,cy+m+px1);ctx.lineTo(cx-m-px1,cy);ctx.fill();
        ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(cx,cy-m);ctx.lineTo(cx+m,cy);ctx.lineTo(cx,cy+m);ctx.lineTo(cx-m,cy);ctx.fill();
        lab(a.name,a.x*T,a.y*T-HEAD,a===sel?MARK.sel:col,16,a===sel?10:7,null,true,3)}}
    flushLabels(sc);
    if(close){drawBubbles(ctx,S,cam,drawText);
      for(const p of fx)if(p.type==='txt'&&inView(p.x*T,p.y*T,LM)){ctx.globalAlpha=Math.min(1,p.life*1.5);drawText(p.txt,p.x*T,p.y*T,p.col,15);ctx.globalAlpha=1}}
    if(cut){drawSceneMarks(ctx,cam,cut,performance.now()/1000);refreshOutdoor()} // the scene's rings, turn, speaker and frame (#431)
    if(mini)mini.draw(S);
  }

  return {draw,resize,screenToWorld,setZoom,zoomAt,panBy,centerOn,stepZoom,currentZoom,onCamChange};
}
