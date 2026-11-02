// Map renderer: camera (free camera with zoom steps and panning, or follow), terrain
// chunks that intersect the view, entities sorted by y and culled to the view,
// effects, day/night overlay with torch light, labels at constant CSS size, minimap.
// `cam` is shared with the UI (selection and view mode live here).
// All world positions are in tile units times T (16px); sprites are two-frame.
//
// Camera model: cam.fit is the scale at which the whole map fits the canvas.
//   free camera ('map'): sc = fit * zoom, zoom one of ZOOMS; camX/camY is the view
//     centre in world px, clamped so the view never leaves the map (at zoom 1 that
//     pins it to the map centre, exactly the old whole-map view).
//   follow: sc = max(fit*2.6, canvas/FOLLOW_VIEW) and the centre eases to the hero.
//   A wheel, drag or minimap click in follow mode drops to the free camera at the
//   same scale, so nothing jumps.
import {clamp} from '../core/rng.js';
import {W,H,T} from '../world/tiles.js';
import {LAIR,CRYPT,LANDMARKS,LIGHTS,LABELS} from '../world/map.js';
import {FAC} from '../data/factions.js';
import {MOBS} from '../data/mobs.js';
import {S,maxHp} from '../sim/index.js';
import {sprite,SPR,heroSprite,npcSprite,outlined} from './sprites.js';
import {drawBubbles} from './bubbles.js';
import {drawWeather} from './weather.js';
import {drawEncounters} from './encounters.js';
import {drawPlaces} from './places.js';
import {drawCamp,drawCampLight} from './camp.js';
import {drawMemorials} from './memorials.js';
import {getChunk,CH,CHUNKS_X,CHUNKS_Y} from './terrain.js';
import {createMinimap} from './minimap.js';
import {ROLE,TEXT,MARK,DISPO,roleOf,dispoOf} from './palette.js';

export const ZOOMS=[1,1.6,2.6,4];
export const cam={view:'map',sel:null,camX:W*T/2,camY:H*T/2,sc:1,offX:0,offY:0,dpr:1,fit:1,zoom:1,vw:W*T,vh:H*T,close:false};
// Follow view shows about 460 world pixels (29 tiles) across the screen.
const FOLLOW_VIEW=460;
// Entities and labels this many world px outside the view are not drawn.
const MARGIN=48;
export const ROLE_COL=ROLE; // Fellowship role colours, as the .frole badges (palette.js)
const BOSS_PAL={R:'#7a2a3a',W:'#d04a2a',E:'#ffe060',T:'#f0ead0',D:'#3a1a20'};

// ---- camera control (module level so the UI and tools can drive it) ----
let cvRef=null;const listeners=[];
export function onCamChange(fn){listeners.push(fn)}
const changed=()=>{for(const f of listeners)f(cam)};
const followScale=()=>cvRef?Math.max(cam.fit*2.6,cvRef.width/FOLLOW_VIEW):cam.fit*2.6;
// 'fellow' view (#68): cam.frame() (set by ui/controls.js) returns {x,y,w,h} in tiles framing the Fellowship, or null.
const framed=()=>cam.view==='fellow'&&typeof cam.frame==='function'?cam.frame():null;
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
  new ResizeObserver(resize).observe(screenEl);resize();

  function darkness(){const h=(S.gameMin/60)%24;if(h>=21||h<5)return .55;if(h>=18)return (h-18)/3*.55;if(h<7)return (7-h)/2*.55;return 0}
  function drawText(txt,x,y,col,css){const s=css*cam.dpr/cam.sc;ctx.font=s+'px VT323, monospace';ctx.textAlign='center';ctx.fillStyle='#000';ctx.fillText(txt,x+s*.07,y+s*.07);ctx.fillStyle=col;ctx.fillText(txt,x,y)}
  // A thin disposition ellipse at the feet (close zoom only), the same colours as the UI.
  function dispoRing(x,y,w,d){ctx.strokeStyle=DISPO[d]||DISPO.neutral;ctx.globalAlpha=.75;ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(x,y+.5,w/2+1.5,2.5,0,0,7);ctx.stroke();ctx.globalAlpha=1}
  function shadow(x,y,w){ctx.fillStyle=MARK.shadow;ctx.beginPath();ctx.ellipse(x,y,w/2,1.5,0,0,7);ctx.fill()}

  // Draw the terrain chunks that intersect the canvas, each snapped to integer device
  // pixels so neighbouring chunks never show a seam at fractional scales.
  function drawTerrain(sc){ctx.setTransform(1,0,0,1,0,0);ctx.imageSmoothingEnabled=false;const cs=CH*T;
    const i0=Math.max(0,Math.floor(-cam.offX/sc/cs)),i1=Math.min(CHUNKS_X-1,Math.floor((cv.width-cam.offX)/sc/cs));
    const j0=Math.max(0,Math.floor(-cam.offY/sc/cs)),j1=Math.min(CHUNKS_Y-1,Math.floor((cv.height-cam.offY)/sc/cs));
    for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const c=getChunk(i,j);
      const x0=Math.round(cam.offX+i*cs*sc),y0=Math.round(cam.offY+j*cs*sc),x1=Math.round(cam.offX+(i*cs+c.width)*sc),y1=Math.round(cam.offY+(j*cs+c.height)*sc);
      ctx.drawImage(c,0,0,c.width,c.height,x0,y0,x1-x0,y1-y0)}}

  let blink=0;
  function draw(){
    blink+=1/60;const {agents,mobs,boss,fx}=S;
    ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#000';ctx.fillRect(0,0,cv.width,cv.height);
    const sel=cam.sel,fr=framed(),follow=following();
    cam.sc=fr?cam.sc+(frameScale(fr)-cam.sc)*.08:follow?followScale():cam.fit*cam.zoom;const sc=cam.sc;
    if(fr){cam.camX+=(fr.x*T-cam.camX)*.1;cam.camY+=(fr.y*T-cam.camY)*.1}
    else if(follow){cam.camX+=(sel.x*T-cam.camX)*.12;cam.camY+=(sel.y*T-cam.camY)*.12}
    clampCam();const vw=cam.vw,vh=cam.vh;
    cam.offX=Math.round((vw/2-cam.camX)*sc);cam.offY=Math.round((vh/2-cam.camY)*sc);
    const vx0=cam.camX-vw/2,vy0=cam.camY-vh/2,vx1=vx0+vw,vy1=vy0+vh;
    const inView=(x,y,m)=>x>vx0-m&&x<vx1+m&&y>vy0-m&&y<vy1+m;
    drawTerrain(sc);
    ctx.setTransform(sc,0,0,sc,cam.offX,cam.offY);ctx.imageSmoothingEnabled=false;
    // lava shimmer: embers drifting around the lair ring
    const tt=performance.now()/400;
    if(S.boss.alive&&inView(LAIR.x*T,LAIR.y*T,96)){ctx.fillStyle=MARK.ember;for(let i=0;i<14;i++){const a=i*2.4+tt*.3;ctx.fillRect(Math.round(LAIR.x*T+Math.cos(a)*76),Math.round(LAIR.y*T+Math.sin(a)*76),2,2)}}
    const close=cam.close=sc>=cam.fit*2;
    drawEncounters(ctx,S,cam,sprite,SPR,blink,drawText); // road encounters under the entities
    drawMemorials(ctx,S,cam,{sprite,SPR,inView,drawText,blink}); // gravestones, statues, cooled lair (sim/memorials.js)
    drawPlaces(ctx,S,cam,{blink,drawText,inView,npcSprite,outlined,dispoRing}); // DM lever markers, conditions and DM-placed people (sim/levers.js)
    drawCamp(ctx,S,cam,{inView,blink,drawText}); // the Fellowship's campfire and bedrolls (sim/camp.js)
    // entities in view, sorted by y: mobs, heroes, townsfolk (sim/npcs.js) and the boss
    const ents=[];
    for(const m of mobs)if(m.alive&&!m.hidden&&inView(m.x*T,m.y*T,MARGIN))ents.push(m);
    for(const a of agents)if(!a.hidden&&inView(a.x*T,a.y*T,MARGIN))ents.push(a);
    for(const p of S.npcs||[])if(inView(p.x*T,p.y*T,MARGIN))ents.push(p);
    if(boss.alive&&inView(boss.x*T,boss.y*T,MARGIN))ents.push(boss);
    ents.sort((a,b)=>a.y-b.y);
    for(const e of ents){
      const fr=e.moving?Math.floor(blink*6+e.id)%2:0;
      let s;if(e.kind==='mob'){const M=MOBS[e.type];s=sprite(e.type+fr,SPR[M.spr][fr],M.col)}
      else if(e.kind==='boss'){const bf=Math.floor(blink*1.6)%2;s=sprite('boss'+bf,SPR.boss[bf],BOSS_PAL)}
      else if(e.kind==='npc')s=npcSprite(e,e.moving?fr:Math.floor(blink*1.5)%2); // idle townsfolk work their hands
      else if(e.state==='dead')s=sprite('grave'+e.fac,SPR.grave[0],{G:'#8a8a96',F:'#3a3a46',B:FAC[e.fac].dark});
      else s=heroSprite(e,e.state==='ghost',fr);
      const px=Math.round(e.x*T),py=Math.round(e.y*T),live=e.state!=='dead';
      if(e.kind==='hero'&&e.state==='ghost')ctx.globalAlpha=.6;
      if(live)shadow(px,py,s.width);
      if(close&&e.kind==='npc')dispoRing(px,py,s.width,dispoOf(e,S.gameMin)); // townsfolk: friendly green, wary amber, hostile red
      const o=live?outlined(s):s,ow=live?1:0; // living entities get the dark outline
      ctx.save();ctx.translate(px,0);if(e.face<0)ctx.scale(-1,1);
      ctx.drawImage(o,-Math.floor(s.width/2)-ow,py-s.height-ow);ctx.restore();ctx.globalAlpha=1;
      const top=py-s.height;
      // role markers at the post: the gate captain's quest mark, the quartermaster's auction sign
      if(e.kind==='npc'&&e.state==='post'){if(e.role==='captain'){const by=Math.round(Math.sin(blink*4));ctx.fillStyle=MARK.quest;ctx.fillRect(px-1,top-11+by,2,6);ctx.fillRect(px-1,top-4+by,2,2)}
        else if(e.role==='quartermaster'){ctx.fillStyle='#f2c14e';ctx.fillRect(px-2,top-8,4,4);ctx.fillStyle='#8a6a1a';ctx.fillRect(px-1,top-6,2,1)}}
      if(e===sel){ctx.fillStyle=Math.floor(blink*3)%2?MARK.sel:MARK.selHi;ctx.fillRect(px-2,top-7,5,2);ctx.fillRect(px-1,top-5,3,1);ctx.fillRect(px,top-4,1,1)}
      if(close&&e.hp<(e.kind==='hero'?maxHp(e):e.maxhp)&&e.state!=='ghost'&&e.state!=='dead'){const mx=e.kind==='hero'?maxHp(e):e.maxhp,w=e.kind==='boss'?28:12;
        ctx.fillStyle=MARK.hpBack;ctx.fillRect(px-w/2-1,top-4,w+2,4);ctx.fillStyle=e.kind==='hero'?MARK.hpHero:MARK.hpFoe;ctx.fillRect(px-w/2,top-3,Math.max(0,w*e.hp/mx),2)}
    }
    // effects
    for(const p of fx){if(p.type==='bolt'){const t=1-p.life/.25;const x=(p.x0+(p.x1-p.x0)*t)*T,y=(p.y0+(p.y1-p.y0)*t)*T;if(!inView(x,y,8))continue;ctx.fillStyle=p.col;ctx.fillRect(Math.round(x),Math.round(y),3,2)}
      if(p.type==='ring'){if(!inView(p.x*T,p.y*T,96))continue;ctx.strokeStyle='rgba(255,140,40,'+p.life+')';ctx.lineWidth=3;ctx.beginPath();ctx.arc(p.x*T,p.y*T,(1-p.life/.6)*72+8,0,7);ctx.stroke()}}
    // night
    const dk=darkness();if(dk>0){ctx.fillStyle='rgba(8,10,40,'+dk+')';ctx.fillRect(0,0,W*T,H*T);
      ctx.globalCompositeOperation='lighter';
      for(const L of LIGHTS){const r=L.big?92:28;if(!inView(L.x*T,L.y*T,r))continue;const g=ctx.createRadialGradient(L.x*T,L.y*T,0,L.x*T,L.y*T,r);g.addColorStop(0,'rgba(255,170,70,'+(dk*.7)+')');g.addColorStop(1,'rgba(255,170,70,0)');ctx.fillStyle=g;ctx.fillRect(L.x*T-r,L.y*T-r,r*2,r*2)}
      drawCampLight(ctx,S,dk,inView);
      ctx.globalCompositeOperation='source-over'}
    drawWeather(ctx,S,cam,blink);
    // labels: region names when zoomed out, nameplates when close
    const LM=MARGIN*4,inMap=(y,css)=>{const s=css*cam.dpr/sc;return clamp(y,s*.9,H*T-s*.25)}; // keep labels at the map's edge inside it
    if(!close){
      for(const[t,x,y]of LABELS)if(inView(x*T,y*T,LM))drawText(t,x*T,inMap(y*T,13),TEXT.label,13);
      if(boss.alive&&inView(LAIR.x*T,LAIR.y*T,LM))drawText('KRAGMAW',LAIR.x*T,(LAIR.y-3)*T,TEXT.elite,12);
      for(const L of LANDMARKS){if(L.kind!=='crypt'||!L.mouth||!inView(L.x*T,L.y*T,LM))continue; // every crypt, labelled just above its mouth
        const g=CRYPT&&L.name===CRYPT.name&&CRYPT.group&&CRYPT.group.phase==='inside'?CRYPT.group:null;
        drawText(g?'CRYPT · '+g.mem.length+' INSIDE':L.name.replace(/^the /i,'').toUpperCase(),(L.mouth.x0+L.mouth.x1+1)/2*T,(L.mouth.y0-.6)*T,TEXT.crypt,12)}}
    else{
      if(CRYPT&&CRYPT.group&&CRYPT.group.phase==='inside'&&inView(CRYPT.x*T,CRYPT.y*T,LM))drawText(CRYPT.group.mem.length+' inside · '+Math.ceil(CRYPT.group.t)+'s',CRYPT.x*T,CRYPT.mouth.y0*T-4,TEXT.crypt,14);
      for(const a of agents){if(a.hidden||!inView(a.x*T,a.y*T,40))continue;
        const dead=a.state==='dead';drawText((dead?'† ':'')+a.name,a.x*T,a.y*T-17,a===sel?MARK.sel:dead?TEXT.dead:FAC[a.fac].color,14)}
      for(const p of S.npcs||[])if(inView(p.x*T,p.y*T,40)){const d=dispoOf(p,S.gameMin);drawText(p.name,p.x*T,p.y*T-17,d==='friendly'?TEXT.person:DISPO[d],12)} // townsfolk nameplates; a wary or hostile one in its colour
      drawBubbles(ctx,S,cam,drawText);
      for(const m of mobs){if(!m.elite||!m.alive||!inView(m.x*T,m.y*T,40))continue;drawText(m.name,m.x*T,m.y*T-17,TEXT.elite,14)} // named elite nameplate
      if(boss.alive&&inView(boss.x*T,boss.y*T,LM))drawText('Kragmaw · '+Math.max(0,Math.round(boss.hp/boss.maxhp*100))+'%',boss.x*T,boss.y*T-28,TEXT.elite,15);
      for(const p of fx)if(p.type==='txt'&&inView(p.x*T,p.y*T,LM)){ctx.globalAlpha=Math.min(1,p.life*1.5);drawText(p.txt,p.x*T,p.y*T,p.col,15);ctx.globalAlpha=1}}
    // The Fellowship (#94): a role marker over each member and their name at any zoom (close views already
    // name everyone), plus a dashed ring around the party in Follow Fellowship.
    if(S.fellowship){const px1=cam.dpr/sc,F=S.fellowship,mem=[];for(const k in F.slots){const a=agents.find(x=>x.id==F.slots[k]);if(a&&!a.hidden&&a.state!=='dead')mem.push(a)}
      if(cam.view==='fellow'&&mem.length>1){let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const a of mem){x0=Math.min(x0,a.x);y0=Math.min(y0,a.y);x1=Math.max(x1,a.x);y1=Math.max(y1,a.y)}
        ctx.save();ctx.strokeStyle=MARK.party;ctx.lineWidth=2*px1;ctx.setLineDash([6*px1,4*px1]);ctx.beginPath();ctx.ellipse((x0+x1)/2*T,((y0+y1)/2-.4)*T,((x1-x0)/2+1.6)*T,((y1-y0)/2+1.6)*T,0,0,7);ctx.stroke();ctx.restore()}
      for(const a of mem){if(!inView(a.x*T,a.y*T,40))continue;const col=ROLE[roleOf(a)]||ROLE.dps;
        const m=Math.max(3,5*px1),cx=Math.round(a.x*T),cy=a.y*T-(close?17:14)-(close?16:15)*px1-m;
        ctx.fillStyle=MARK.edge;ctx.beginPath();ctx.moveTo(cx,cy-m-px1);ctx.lineTo(cx+m+px1,cy);ctx.lineTo(cx,cy+m+px1);ctx.lineTo(cx-m-px1,cy);ctx.fill();
        ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(cx,cy-m);ctx.lineTo(cx+m,cy);ctx.lineTo(cx,cy+m);ctx.lineTo(cx-m,cy);ctx.fill();
        if(!close)drawText(a.name,a.x*T,a.y*T-14,a===sel?MARK.sel:TEXT.hero,13)}}
    if(mini)mini.draw(S);
  }

  return {draw,resize,screenToWorld,setZoom,zoomAt,panBy,centerOn,stepZoom,currentZoom,onCamChange};
}
