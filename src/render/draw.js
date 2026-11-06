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
import {W,H} from '../world/tiles.js';
import {U as T,ART,PROC_SCALE,HEAD,followTiles} from './tile.js';
import {OUTPOSTS} from '../world/map.js';
import {outpostsView} from '../sim/outposts.js';
import {LAIR,CRYPT,CRYPTS,LANDMARKS,LABELS} from '../world/map.js';
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
import {drawCamp} from './camp.js';
import {trafficEnts,isTraffic,trafficShadow,drawTrafficEnt} from './traffic.js'; // carts, travellers and road guards (#856)
import {farMarks,gatherFar,drawMarks,homeLane} from './lod.js'; // the whole map's marks (#729)
import {drawMemorials} from './memorials.js';
import {drawConditions,condLift} from './conditions.js';
import {getChunk,CH,CHUNKS_X,CHUNKS_Y,chunkGen,treesNear,drawTree} from './terrain.js';
import {createMinimap} from './minimap.js';
import {drawWholeMap} from './wholemap.js'; // company rings and name tags in the whole-map view (#844)
import {syncSpells,drawSpells} from './spellfx.js';
import {TEXT,MARK,BOSS_PAL} from './palette.js';
import {initDungeonView,dungeonOpen,drawDungeon,trackCrawl} from './dungeonview.js'; // the dungeon view over the world (#85)
import {trackRaid} from './raidview.js'; // the raid arena's record of each raid it saw (#85)
import {initSceneView,sceneTick,sceneCut,drawSceneView,drawSceneRings,drawSceneMarks,arenaPattern,refreshOutdoor,scenePose,sceneFallen,sceneTint} from './sceneview.js'; // scene maps (#431)
import {CITY} from '../world/map.js';
import {lifeBegin,lifeGround,lifeEnts,lifeAir,lifeStats} from './townlife.js'; // critters, smoke, stalls, guards, flags, footprints (#795)
import {drawPurposeGround,drawIntentIcon} from './purposefx.js'; // what a hero is trying to do (#534): path, tether, wait line, intent icons
import {inSlots,slotted} from '../sim/company.js'; // the slotted company (#588)
import {G,gradeAt,CLOUD} from './grade.js'; // the hour's light (#979)
import {drawCast,castFigure,castBlob} from './shadows.js';
import {lightPass} from './lightmap.js';
import {drawAir} from './atmos.js';
import {drawWater} from './water.js';
import {drawSway,swayTree,drawGrass,drawWheat} from './sway.js';
import {drawMotes} from './motes.js';
import {drawSheen} from './sheen.js';
import {FX} from './quality.js';
import {skyAt} from './life.js';
const HIT_NUM=/^\d+!?$/; // a blow's number from the sim; a fight on a patch shows it as its beat lands instead (#746)
const EPZ=[],EPY=[]; // per entity this frame: its pose on a patch (#746), its feet row
const TOWNS=new Set(CITY.map(c=>c.name.toUpperCase())); // town labels are places (gold), the rest regions

export const ZOOMS=[1,1.6,2.6,4];
export const cam={view:'map',sel:null,camX:W*T/2,camY:H*T/2,sc:1,offX:0,offY:0,dpr:1,fit:1,zoom:1,vw:W*T,vh:H*T,close:false,region:null,hover:null,icons:true}; // hover, icons: the hovered hero and the Intent icons switch in Settings (#534, render/purposefx.js)
const BOSS_HEAD=82; // Kragmaw's nameplate height over its feet: the sheet stands 76 units, the procedural sprite less
// The facing of each entity for a generated sheet (0 down, 1 left, 2 right, 3 up), from how it last moved.
const FACE=new WeakMap();
function dirOf(e){let f=FACE.get(e);if(!f){f={x:e.x,y:e.y,d:e.face<0?1:2};FACE.set(e,f)}
  const dx=e.x-f.x,dy=e.y-f.y;if(dx*dx+dy*dy>1e-4){f.d=Math.abs(dx)>=Math.abs(dy)?(dx<0?1:2):(dy<0?3:0);f.x=e.x;f.y=e.y}return f.d}
const STEP=[1,0,2,0]; // sheet columns of a walk cycle
// Entities and labels this many world px outside the view are not drawn.
const MARGIN=48;
const ENTS=[],ESPR=[],EG=[],EGF=[],ESW=[],ESH=[],EPX=[],byY=(a,b)=>a.y-b.y; // the entity pass's arrays, reused across frames (#716)
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

export function createRenderer(cv,screenEl){
  const ctx=cv.getContext('2d');cvRef=cv;
  const miniEl=document.getElementById('minimap');
  const mini=miniEl&&miniEl.getContext?createMinimap(miniEl,cam,centerOn):null;
  function resize(){const r=screenEl.getBoundingClientRect();cam.dpr=window.devicePixelRatio||1;cv.width=Math.max(1,Math.round(r.width*cam.dpr));cv.height=Math.max(1,Math.round(r.height*cam.dpr));
    cam.fit=Math.min(cv.width/(W*T),cv.height/(H*T));if(mini)mini.resize()}
  new ResizeObserver(resize).observe(screenEl);resize();initDungeonView();initSceneView();

  // The sky over the camera, eased so the light turns as weather comes on rather than jumping (#979).
  let cloud=0;const skyNow=()=>{const c=CLOUD[skyAt(cam.camX/T,cam.camY/T)]||0;cloud+=(c-cloud)*.02;return cloud};
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
        if(L.pl){ctx.fillStyle='rgba(8,10,20,.3)';ctx.fillRect((x0-cam.offX)/sc,(y0-1-cam.offY)/sc,(x1-x0)/sc,(y1-y0+3)/sc)}
        drawText(L.t,L.x,y,L.col,L.css);break}}}
  // Draw the terrain chunks that intersect the canvas, each snapped to integer device
  // pixels so neighbouring chunks never show a seam at fractional scales.
  // A still camera (the whole map, a region view, a parked free camera) draws the terrain from one canvas at the
  // screen's resolution (#716): the chunks are copied into it once the view has held for a frame, and it is redrawn
  // when the view, the canvas size or the chunks change. A moving camera draws the chunks directly, as before.
  let tKey='',tPrev='',tCache=null,tReady=false;
  function drawTerrain(sc){ctx.setTransform(1,0,0,1,0,0);ctx.imageSmoothingEnabled=false;
    const key=cv.width+'|'+cv.height+'|'+sc+'|'+cam.offX+'|'+cam.offY+'|'+chunkGen;
    if(key===tKey&&tReady){ctx.drawImage(tCache,0,0);return}
    if(key!==tPrev){tPrev=key;tReady=false;paintChunks(ctx,sc);return} // the view moved: draw directly and see if it holds
    if(!tCache||tCache.width!==cv.width||tCache.height!==cv.height){tCache=document.createElement('canvas');tCache.width=cv.width;tCache.height=cv.height}
    const tc=tCache.getContext('2d');tc.setTransform(1,0,0,1,0,0);tc.clearRect(0,0,tCache.width,tCache.height);tc.imageSmoothingEnabled=false;
    paintChunks(tc,sc);tKey=key;tReady=true;ctx.drawImage(tCache,0,0)}
  function paintChunks(ctx,sc){const cs=CH*T;
    const i0=Math.max(0,Math.floor(-cam.offX/sc/cs)),i1=Math.min(CHUNKS_X-1,Math.floor((cv.width-cam.offX)/sc/cs));
    const j0=Math.max(0,Math.floor(-cam.offY/sc/cs)),j1=Math.min(CHUNKS_Y-1,Math.floor((cv.height-cam.offY)/sc/cs));
    for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const c=getChunk(i,j);
      const x0=Math.round(cam.offX+i*cs*sc),y0=Math.round(cam.offY+j*cs*sc),x1=Math.round(cam.offX+(i*cs+c.uw)*sc),y1=Math.round(cam.offY+(j*cs+c.uh)*sc); // c.uw/uh: the chunk in world units, whatever its resolution
      ctx.drawImage(c,0,0,c.width,c.height,x0,y0,x1-x0,y1-y0)}}

  // Frame phases for scripts/perfprobe.mjs (#716): off (one null check a phase) unless the probe sets
  // globalThis.__drawPhases={on:true,ms:Float64Array(8),n:0}; then each phase's milliseconds add up in ms[i].
  // 0 camera+terrain, 1 ground layers (encounters, places, camp, spells), 2 entities (gather, sort, draw), 3 bolts and
  // weather, 4 night, lights and spells in the air, 5 labels and Fellowship markers, 6 bubbles, floating text and the minimap.
  let PH=null;const ph=i=>{if(PH){const t=performance.now();PH.ms[i]+=t-PH.t;PH.t=t}};
  let blink=0,frameNo=1;
  function draw(){PH=globalThis.__drawPhases&&globalThis.__drawPhases.on?globalThis.__drawPhases:null;if(PH){PH.t=performance.now();PH.n++}
    trackCrawl();trackRaid();sceneTick(cam);if(dungeonOpen()){cam.whole=false;if(screenEl.classList)screenEl.classList.remove('wholemap');drawDungeon(performance.now()/1000);if(mini)mini.draw(S);return} // the dungeon view covers the world; skip drawing it
    if(drawSceneView(performance.now()/1000)){cam.whole=false;if(screenEl.classList)screenEl.classList.remove('wholemap');return} // an indoor scene map covers the world too (#431)
    blink+=1/60;const {agents,mobs,boss,fx}=S;
    ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#000';ctx.fillRect(0,0,cv.width,cv.height);
    const sel=cam.sel,fr=framed(),follow=following(),cut=sceneCut(cv.width/Math.max(1,cv.height)),cin=cam.director,onPatch=!!(cut&&cut.patch),seen=e=>onPatch&&scenePose(e)||e; // cin: the cinema view's director (#979), null in every other view
    if(cut){ // an outdoor scene (#431): the camera frames the scene's cut of the world below the banner and above the bar
      const top=cut.top*cam.dpr,bot=cut.bottom*cam.dpr,rt=(cut.right||0)*cam.dpr,want=Math.max(cam.fit*2,Math.min(Math.max(40,cv.width-rt)/(cut.w*T),Math.max(40,cv.height-top-bot)/(cut.h*T)));
      if(cin){cam.cut=true;cin.step(cam,cv.width,cv.height,{x:cut.cx*T,y:cut.cy*T,sc:want,dx:rt/2,dy:-(top-bot)/2})} // the cinema view eases into the cut (#979)
      else{const first=!cam.cut;cam.cut=true;cam.sc=first?want:cam.sc+(want-cam.sc)*.15;
      const tx=cut.cx*T+rt/2/cam.sc,ty=cut.cy*T-(top-bot)/2/cam.sc; /* the banner docked on the right (#546): the cut fills the room left of it */if(first){cam.camX=tx;cam.camY=ty}else{cam.camX+=(tx-cam.camX)*.15;cam.camY+=(ty-cam.camY)*.15}}
      cam.vw=cv.width/cam.sc;cam.vh=cv.height/cam.sc}
    else{cam.cut=false;
    if(cin)cin.step(cam,cv.width,cv.height,null);else{ // the director camera (#979, render/director.js)
    cam.sc=fr?cam.sc+(frameScale(fr)-cam.sc)*.08:follow?followScale():cam.fit*cam.zoom;
    if(fr){cam.camX+=(fr.x*T-cam.camX)*.1;cam.camY+=(fr.y*T-cam.camY)*.1}
    else if(follow){cam.camX+=(sel.x*T-cam.camX)*.12;cam.camY+=(sel.y*T-cam.camY)*.12}}
    clampCam()}
    const sc=cam.sc,vw=cam.vw,vh=cam.vh;
    cam.offX=Math.round((vw/2-cam.camX)*sc);cam.offY=Math.round((vh/2-cam.camY)*sc);
    const vx0=cam.camX-vw/2,vy0=cam.camY-vh/2,vx1=vx0+vw,vy1=vy0+vh;
    const inView=(x,y,m)=>x>vx0-m&&x<vx1+m&&y>vy0-m&&y<vy1+m;
    if(cut&&cut.edge){ctx.setTransform(sc,0,0,sc,cam.offX,cam.offY);ctx.imageSmoothingEnabled=false;ctx.fillStyle=arenaPattern(ctx,cut.biome);ctx.fillRect(vx0,vy0,vw,vh)} // past the map's edge: a generated arena of the biome's ground
    drawTerrain(sc);ph(0);
    ctx.setTransform(sc,0,0,sc,cam.offX,cam.offY);ctx.imageSmoothingEnabled=false;
    gradeAt((S.gameMin/60)%24,skyNow());drawCast(ctx,S.gameMin);drawSheen(ctx,S.gameMin); // the hour's light, then what stands still throws its shadow on the ground (#979)
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
    const close=cam.close=sc>=cam.fit*2||!!cin;
    drawEncounters(ctx,S,cam,sprite,SPR,blink,drawText); // road encounters under the entities
    drawMemorials(ctx,S,cam,{sprite,SPR,inView,drawText,blink}); // gravestones, statues, cooled lair (sim/memorials.js)
    drawPlaces(ctx,S,cam,{blink,drawText,inView,npcSprite,outlined,dispoRing}); // DM lever markers, conditions and DM-placed people (sim/levers.js)
    drawCamp(ctx,S,cam,{inView,blink,drawText}); // the Fellowship's campfire and bedrolls (sim/camp.js)
    let lt=performance.now();if(!cut){lifeBegin(S,cam,lt/1000);lifeGround(ctx);if(FX.full){drawWater(ctx);drawGrass(ctx);drawWheat(ctx);drawSway(ctx,ctx.getTransform())}} // the ambient life of the map (#795), and the water and wind (#979): render only
    lifeStats.acc=performance.now()-lt;
    if(!cut&&!cin)drawPurposeGround(ctx,S,cam,{drawText,blink}); // the followed or hovered hero's road, tether or wait line, under the entities
    if(cut)drawSceneRings(ctx,cam,cut); // who is in the scene: a ring at their feet (#431)
    const fxNow=performance.now()/1000;syncSpells(fx,fxNow,inView);drawSpells(ctx,0,close,inView,fxNow);ph(1); // spell effects on the ground: rings, roots, briars (#374)
    // entities in view, sorted by y: mobs, heroes, townsfolk (sim/npcs.js) and the boss
    // Far out (#729) most of the world is marks and only those the watcher is looking at go on as sprites.
    ENTS.length=0;
    const far=farMarks(sc,cut);
    if(far)gatherFar(S,cam,inView,MARGIN,ENTS);
    else{
      for(const m of mobs)if(m.alive&&!m.hidden&&inView(m.x*T,m.y*T,MARGIN))ENTS.push(m);
      for(const a of agents)if(!a.hidden&&inView(a.x*T,a.y*T,MARGIN))ENTS.push(a);
      for(const p of S.npcs||[])if(inView(p.x*T,p.y*T,MARGIN))ENTS.push(p);
      if(boss.alive&&inView(boss.x*T,boss.y*T,MARGIN))ENTS.push(boss);
      lt=performance.now();if(!cut)lifeEnts(ENTS);lifeStats.acc+=performance.now()-lt;
      if(close&&!cut)trafficEnts(S,inView,MARGIN,ENTS)} // road traffic, skipped at whole-map zoom (#856)
    if(onPatch)sceneFallen(ENTS); // a foe whose last blow is still to play, or who is falling
    // whole trees (#834) are painted into the terrain chunk, under everything; one that stands in front of an entity (rooted below its feet)
    // is sorted in among the entities and drawn again over it, with the trees near it, so a hero walks behind a trunk and not over a crown
    if(close&&!far){const n=ENTS.length;for(let i=0;i<n;i++)treesNear(ENTS[i].x,ENTS[i].y,ENTS,frameNo)}
    frameNo++;
    ENTS.sort(byY);
    // Pass 1 (#716): each entity's sprite (or generated sheet frame), size and x, and the shadows in one path a frame (the
    // living at full alpha, ghosts in a second path at theirs) instead of one fill per entity. Shadows now all sit under
    // every sprite, which is where they belong anyway.
    const nE=ENTS.length,sunny=close&&G.sunA>.01&&FX.full; // up close what moves throws its own shape along the sun, under the contact shadow
    ctx.fillStyle=MARK.shadow;ctx.beginPath();
    for(let i=0;i<nE;i++){const e=ENTS[i];EPZ[i]=null;
      if(e.kind==='deco'||e.tree){ESPR[i]=null;if(sunny&&!e.tree)castBlob(ctx,Math.round(e.x*T),Math.round(e.y*T),e.kp?5:3,e.kp?24:9);continue} // drawn whole in pass 2, with its own shadow
      if(isTraffic(e)){trafficShadow(ctx,e,Math.round(e.x*T),Math.round(e.y*T));if(sunny)castBlob(ctx,Math.round(e.x*T),Math.round(e.y*T),6,22);continue} // its shadow joins the path; the sprite is drawn whole in pass 2
      const ghost=e.kind==='hero'&&e.state==='ghost',live=e.state!=='dead',pz=onPatch?scenePose(e):null,mv=pz?pz.walk:e.moving,fr=mv?Math.floor(blink*6+e.id)%2:0;EPZ[i]=pz;
      let s;if(e.kind==='mob'){const M=MOBS[e.type];s=sprite(e.type+fr,SPR[M.spr][fr],M.col)}
      else if(e.kind==='boss'){const bf=Math.floor(blink*1.6)%2;s=sprite('boss'+bf,SPR.boss[bf],BOSS_PAL)}
      else if(e.kind==='npc')s=npcSprite(e,mv?fr:Math.floor(blink*1.5)%2); // idle townsfolk work their hands
      else if(e.state==='dead')s=sprite('grave'+e.fac,SPR.grave[0],{G:'#8a8a96',F:'#3a3a46',B:FAC[e.fac].dark});
      else s=heroSprite(e,ghost,fr);
      // a generated sheet (#177) for a living hero or creature, else the procedural sprite scaled to the same height
      const G=live&&!ghost&&(e.kind==='hero'||e.kind==='mob'||e.kind==='npc'||e.kind==='boss')?sheetFrame(e,e.kind==='npc'&&!mv?0:e.kind==='boss'?1:pz?pz.dir:dirOf(e),e.kind==='boss'?STEP[Math.floor(blink*2.2)%4]:mv?STEP[Math.floor(blink*6+e.id)%4]:0):null;
      let F=null;if(G){F=EGF[i]||(EGF[i]={img:null,sx:0,sy:0,fw:0,fh:0});F.img=G.img;F.sx=G.sx;F.sy=G.sy;F.fw=G.fw;F.fh=G.fh} // sheetFrame hands back one shared object
      ESPR[i]=s;EG[i]=F;ESW[i]=G?G.fw/ART:s.width*PROC_SCALE;ESH[i]=G?G.fh/ART:s.height*PROC_SCALE;
      const px=EPX[i]=Math.round((pz?pz.x:e.x+homeLane(e))*T),py=EPY[i]=Math.round((pz?pz.y:e.y)*T);
      if(live&&!ghost&&!(pz&&pz.fade<1)){const w=ESW[i]/2;ctx.moveTo(px+w,py);ctx.ellipse(px,py,w,1.5,0,0,7)}}
    ctx.fill();
    let ghosts=false;ctx.beginPath();
    for(let i=0;i<nE;i++){const e=ENTS[i];if(e.kind!=='hero'||e.state!=='ghost')continue;const px=EPX[i],py=EPY[i],w=ESW[i]/2;ctx.moveTo(px+w,py);ctx.ellipse(px,py,w,1.5,0,0,7);ghosts=true}
    if(ghosts){ctx.globalAlpha=.6;ctx.fill();ctx.globalAlpha=1}
    const tf=ctx.getTransform();
    if(sunny){ctx.globalAlpha=G.sunA*.9;
      for(let i=0;i<nE;i++){const e=ENTS[i],s=ESPR[i];if(!s||e.state==='dead'||e.state==='ghost')continue;const pz=EPZ[i];if(pz&&pz.fade<1)continue;const F=EG[i],px=EPX[i],py=EPY[i]; // a figure posed in a scene casts from where it stands (#746)
        if(F)castFigure(ctx,tf,F.img,F.sx,F.sy,F.fw,F.fh,px,py,ESW[i],ESH[i],false);else{const o=worldSprite(s,true);castFigure(ctx,tf,o,0,0,o.width,o.height,px,py,ESW[i],ESH[i],(pz?pz.face:e.face)<0)}}
      ctx.setTransform(tf);ctx.globalAlpha=1}
    // Pass 2: the sprites in y order, and what rides on each. A mirrored sprite sets the transform once instead of
    // save/translate/scale/restore.
    let ghostA=1; // 1, or the see-through strength of a member drawn again over the tree that stands in front of it
    const drawEnt=i=>{const e=ENTS[i],s=ESPR[i],G=EG[i],sw=ESW[i],sh=ESH[i],px=EPX[i],py=EPY[i],pz=EPZ[i],live=e.state!=='dead';
      if(e.kind==='deco'){e.paint(ctx,Math.round(e.x*T),Math.round(e.y*T),blink,e);return} // critters, stalls and guards (townlife.js)
      if(isTraffic(e)){drawTrafficEnt(ctx,e,Math.round(e.x*T),Math.round(e.y*T),blink);return}
      if(e.kind==='hero'&&e.state==='ghost')ctx.globalAlpha=.6*ghostA;
      if(close&&!cin&&e.kind==='npc')dispoRing(px,py,sw,toneOf(e,slotted(),S.gameMin).kind); // townsfolk: friendly green, wary amber, hostile red
      const tilt=pz&&pz.tilt;if(pz&&pz.fade<1)ctx.globalAlpha=pz.fade;if(tilt){ctx.save();ctx.translate(px,py);ctx.rotate(tilt);ctx.translate(-px,-py)} // a stumble on a 1, a foe falling
      if(G){ctx.drawImage(G.img,G.sx,G.sy,G.fw,G.fh,px-sw/2,py-sh,sw,sh);if(pz&&pz.flash>0){ctx.globalAlpha=pz.flash;ctx.drawImage(sceneTint(G.img,pz.col),G.sx,G.sy,G.fw,G.fh,px-sw/2,py-sh,sw,sh)}}
      else{const o=worldSprite(s,live),ow=live?1/ART:0,x0=-Math.floor(s.width/2)*PROC_SCALE-ow; // living entities get the dark outline, one art pixel wide
        const fl=pz&&pz.flash>0?sceneTint(o,pz.col):null; // the hit flash
        if((pz?pz.face:e.face)<0){ctx.setTransform(-tf.a,0,0,tf.d,tf.e+px*tf.a,tf.f);ctx.drawImage(o,x0,py-sh-ow,o.width/ART,o.height/ART);if(fl){ctx.globalAlpha=pz.flash;ctx.drawImage(fl,x0,py-sh-ow,o.width/ART,o.height/ART)}ctx.setTransform(tf)} // mirrored about px
        else{ctx.drawImage(o,px+x0,py-sh-ow,o.width/ART,o.height/ART);if(fl){ctx.globalAlpha=pz.flash;ctx.drawImage(fl,px+x0,py-sh-ow,o.width/ART,o.height/ART)}}}
      if(tilt)ctx.restore();ctx.globalAlpha=ghostA;
      const top=py-sh;
      // role markers at the post: the gate captain's quest mark, the quartermaster's auction sign
      if(e.kind==='npc'&&e.state==='post'){if(e.role==='captain'){const by=Math.round(Math.sin(blink*4));ctx.fillStyle=MARK.quest;ctx.fillRect(px-1,top-11+by,2,6);ctx.fillRect(px-1,top-4+by,2,2)}
        else if(e.role==='quartermaster'){ctx.fillStyle='#f2c14e';ctx.fillRect(px-2,top-8,4,4);ctx.fillStyle='#8a6a1a';ctx.fillRect(px-1,top-6,2,1)}}
      if(e===sel&&!cin){ctx.fillStyle=Math.floor(blink*3)%2?MARK.sel:MARK.selHi;ctx.fillRect(px-2,top-7,5,2);ctx.fillRect(px-1,top-5,3,1);ctx.fillRect(px,top-4,1,1)}
      const hp=pz?pz.show:e.hp; // a blow's HP falls as its beat lands (#746)
      if(close&&hp<(e.kind==='hero'?maxHp(e):e.maxhp)&&!(pz&&(hp<=0||pz.fade<1))&&e.state!=='ghost'&&e.state!=='dead'){const mx=e.kind==='hero'?maxHp(e):e.maxhp,w=(e.kind==='boss'?21:8)*PROC_SCALE;
        ctx.fillStyle=MARK.hpBack;ctx.fillRect(px-w/2-1,top-4,w+2,4);ctx.fillStyle=e.kind==='hero'?MARK.hpHero:MARK.hpFoe;ctx.fillRect(px-w/2,top-3,Math.max(0,w*hp/mx),2)}
      if(close&&e.eff)drawConditions(ctx,S,cam,e,px,py,top,blink); // Table conditions over the head (#307)
    };
    for(let i=0;i<nE;i++){const e=ENTS[i];
      if(e.tree){drawTree(ctx,e);if(FX.full)swayTree(ctx,tf,e); // a crown in front of entities hides them, as a hero walking behind a tree would be; the followed hero and the company stay readable as a see-through figure
        for(let j=0;j<i;j++){const o=ENTS[j];if(o.tree||Math.abs(o.x-e.x)>2.4||o.y>=e.y||o.y<e.y-5||!(o===sel||(o.kind==='hero'&&inSlots(o))))continue;ghostA=.45;ctx.globalAlpha=.45;drawEnt(j);ghostA=1;ctx.globalAlpha=1}
        continue}
      drawEnt(i)}
    ph(2);
    // effects: bolts leave a short fading trail; the boss's breath ring
    for(const p of fx){if(p.type==='bolt'){const t=1-p.life/.25;if(!inView(p.x0*T,p.y0*T,96))continue;ctx.fillStyle=p.col;
        for(let k=2;k>=0;k--){const tk=Math.max(0,t-k*.12),x=(p.x0+(p.x1-p.x0)*tk)*T,y=(p.y0+(p.y1-p.y0)*tk)*T;ctx.globalAlpha=k?.25*(3-k):1;ctx.fillRect(Math.round(x),Math.round(y),k?2:3,2)}
        ctx.globalAlpha=1}
      if(p.type==='ring'){if(!inView(p.x*T,p.y*T,96))continue;ctx.strokeStyle='rgba(255,140,40,'+p.life+')';ctx.lineWidth=3;ctx.beginPath();ctx.arc(p.x*T,p.y*T,(1-p.life/.6)*72+8,0,7);ctx.stroke()}}
    // weather sits on the ground, so it goes under the night: fog no longer brightens midnight
    lt=performance.now();if(!cut)lifeAir(ctx,blink);lifeStats.acc+=performance.now()-lt;
    if(!cut&&FX.full)drawMotes(ctx,0);drawWeather(ctx,S,cam,blink);drawAir(ctx,cv,cam,sc,performance.now()/1000);ph(3);
    // the light: the hour's ambient, soft dark, flames and lava, in one multiply and a thin add (lightmap.js, #979)
    const dk=G.dk;lt=performance.now();lightPass(ctx,cv,cam,{S,sel,sc,inView,cut,seen});if(!cut&&FX.full)drawMotes(ctx,1);lifeStats.acc+=performance.now()-lt;
    ph(4);if(far){drawMarks(ctx,cam.dpr,dk);ctx.setTransform(sc,0,0,sc,cam.offX,cam.offY);ph(2)} // the marks, timed with the entities
    drawSpells(ctx,1,close,inView,fxNow);ph(4); // spell effects in the air, over the night wash: they carry their own light (#374)
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
      if(!cin)for(const D of CRYPTS)if(D.group&&D.group.phase==='inside'&&inView(D.x*T,D.y*T,LM))lab(D.group.mem.length+' inside · '+Math.ceil(D.group.t)+'s',D.x*T,D.mouth.y0*T-4,TEXT.crypt,14,7);
      const lh=14*cam.dpr/sc;
      if(cut)for(const r of bubbleBoxes(ctx,S,cam))RES.push(r[0]*sc+cam.offX,r[1]*sc+cam.offY,r[2]*sc+cam.offX,r[3]*sc+cam.offY); // a Table scene: names keep clear of the bubbles (#471)
      for(const a of agents){if(a.hidden||!inView(a.x*T,a.y*T,40))continue;
        if(cin&&!cut&&!cin.named(a,cam))continue; // the cinema view names only the hovered hero and the selected company, with no plate (#979)
        const dead=a.state==='dead';if(dead&&!near&&a!==sel)continue;
        const inCut=cut&&!dead&&(cut.members.includes(a)||cut.foes.includes(a)),ap=seen(a),y=ap.y*T-HEAD-condLift(a,cam);
        if(inCut&&a.bubble&&a.bubble.life>0&&bubbleVisible(a,S))continue; // its bubble names it already: one label per member
        if(inCut){lab(a.name,ap.x*T,y,inSlots(a)?classColor(a.cls):FAC[a.fac].color,cin?LS-6:14,inSlots(a)?9:8,[y-lh*1.05,ap.y*T+4+lh*.8,y-lh*2.1],true);continue} // class colour, a plate, and other heights before it is dropped
        const mate=!dead&&inSlots(a); // a company member is always named: big, class colour, a plate, stacked when bunched (#842)
        lab((dead?'† ':'')+a.name,a.x*T,y,a===sel?MARK.sel:mate?classColor(a.cls):dead?TEXT.dead:FAC[a.fac].color,cin?LS-6:mate||a===sel?LS:LS-4,a===sel?10:mate?8:dead?1:4,null,!cin&&(mate||a===sel),mate?6:0)}
      if(!cin)for(const p of S.npcs||[])if(inView(p.x*T,p.y*T,40)){const t=toneOf(p,slotted(),S.gameMin);if(t.kind==='friendly'&&!near)continue; // townsfolk nameplates: [name] in the disposition colour; a wary or hostile one at any close zoom
        lab(toneName(p,t),p.x*T,p.y*T-HEAD-condLift(p,cam),t.color||TEXT.person,12,t.kind==='friendly'?2:5)}
      if(!cin)for(const m of mobs){if(!m.elite||!m.alive||!inView(m.x*T,m.y*T,40))continue;const p=seen(m);lab(m.name,p.x*T,p.y*T-HEAD-condLift(m,cam),TEXT.elite,14,6)} // named elite nameplate
      if(!cin&&boss.alive&&inView(boss.x*T,boss.y*T,LM))lab('Kragmaw · '+Math.max(0,Math.round(boss.hp/boss.maxhp*100))+'%',boss.x*T,boss.y*T-BOSS_HEAD-condLift(boss,cam),TEXT.elite,15,9)}
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
    flushLabels(sc);lifeStats.ms+=(lifeStats.acc-lifeStats.ms)*.05;ph(5);
    const whole=!cut&&!follow&&sc<=cam.fit*1.001;cam.whole=whole;if(screenEl.classList)screenEl.classList.toggle('wholemap',whole); // the whole map: rings and tags, the corner minimap would only repeat it (#844)
    if(whole)drawWholeMap(ctx,cam,blink);
    if(close){drawBubbles(ctx,S,cam,drawText);
      for(const p of fx)if(p.type==='txt'&&inView(p.x*T,p.y*T,LM)&&!(onPatch&&HIT_NUM.test(p.txt))){ctx.globalAlpha=Math.min(1,p.life*1.5);drawText(p.txt,p.x*T,p.y*T,p.col,15);ctx.globalAlpha=1}}
    if(cut){drawSceneMarks(ctx,cam,cut,performance.now()/1000);refreshOutdoor()} // the scene's rings, turn, speaker and frame (#431)
    if(mini&&!cin)mini.draw(S);if(cin)cin.paint(ctx,cv.width,cv.height);ph(6);
  }

  return {draw,resize,screenToWorld,setZoom,zoomAt,panBy,centerOn,stepZoom,currentZoom,onCamChange};
}
