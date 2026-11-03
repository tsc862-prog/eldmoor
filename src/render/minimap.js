// Minimap: a small canvas in the corner of the screen element showing the whole
// world. The base image (one colour per tile from a small palette) is painted once
// from `tiles`/`zone`; every frame draws hero dots coloured by faction, elite and
// boss markers and the camera's view rectangle on top. Clicking recentres the camera.
import {W,H,T,TREE,SWAMP,MUD,ROCK,PEAK,LAVA,ROAD,FLOOR,WALL,RIVER,BRIDGE,SGRASS,SNOW,ICE} from '../world/tiles.js';
import {tiles,zone,I,CITY,LANDMARKS} from '../world/map.js';
import {FAC} from '../data/factions.js';
import {BIOME,TILE_FLAT,MARK,TEXT,biomeOfZone} from './palette.js';
import {classColor,toneOf} from '../core/colors.js';

// Largest CSS size; the canvas keeps the map's aspect inside this box.
const BOX_W=160,BOX_H=100;
// Colours come from the shared palette: flat tile families, and ground and forest by the
// region's biome (never by zone index), so a new region only needs a biome.
const BY_TILE=[];
BY_TILE[SWAMP]=BY_TILE[MUD]=BY_TILE[SGRASS]=TILE_FLAT.swamp;BY_TILE[ROCK]=BY_TILE[PEAK]=TILE_FLAT.rock;BY_TILE[LAVA]=TILE_FLAT.lava;
BY_TILE[SNOW]=BY_TILE[ICE]=TILE_FLAT.snow;BY_TILE[RIVER]=TILE_FLAT.water;BY_TILE[ROAD]=BY_TILE[BRIDGE]=BY_TILE[FLOOR]=TILE_FLAT.road;BY_TILE[WALL]=TILE_FLAT.wall;
const colourFor=(t,z)=>{const b=BIOME[biomeOfZone(z)]||BIOME.meadow;return t===TREE?b.forest:(BY_TILE[t]||b.ground)};
const rgbC={};const rgb=s=>rgbC[s]||(rgbC[s]=[parseInt(s.slice(1,3),16),parseInt(s.slice(3,5),16),parseInt(s.slice(5,7),16)]);

const BOSS_COL='#ff6a5a',ELITE_COL=TEXT.elite,SEL_COL=MARK.sel,GHOST_ALPHA=.45;

// Paint the W x H base image once. The ground is dimmed a little (DIM) so the dots and marks own
// the bright values; towns are painted in their faction's colour inside a dark wall, so home towns
// read on the map at a glance (CITY, any number of them).
const DIM=.82;
function buildBase(){const cv=document.createElement('canvas');cv.width=W;cv.height=H;const c=cv.getContext('2d');
  const img=c.createImageData(W,H),d=img.data;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const k=I(x,y),t=tiles[k],col=rgb(colourFor(t,zone[k])),o=k*4,m=t===RIVER||t===ROAD||t===BRIDGE?1:DIM;
    d[o]=col[0]*m;d[o+1]=col[1]*m;d[o+2]=col[2]*m;d[o+3]=255}
  for(const ct of CITY){const f=rgb(FAC[ct.fac].dark),e=rgb(MARK.edge);
    for(let y=ct.y0;y<=ct.y1;y++)for(let x=ct.x0;x<=ct.x1;x++){const o=I(x,y)*4,edge=x===ct.x0||x===ct.x1||y===ct.y0||y===ct.y1,col=edge?e:f;d[o]=col[0];d[o+1]=col[1];d[o+2]=col[2]}}
  c.putImageData(img,0,0);return cv}

// canvas: the #minimap element. cam: the shared camera (camX/camY in world px, vw/vh the
// view size in world px). onCenter(wx,wy) is called with a world-pixel point on click.
const MIND_COL=MARK.mind;
// A W x H overlay: dark over every tile outside region z, a bright edge on the tiles that border it.
function buildShade(z){const cv=document.createElement('canvas');cv.width=W;cv.height=H;const c=cv.getContext('2d'),img=c.createImageData(W,H),d=img.data;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const k=I(x,y),o=k*4;
    if(zone[k]!==z){d[o+3]=150;continue}
    const edge=x===0||y===0||x===W-1||y===H-1||zone[I(x-1,y)]!==z||zone[I(x+1,y)]!==z||zone[I(x,y-1)]!==z||zone[I(x,y+1)]!==z;
    if(edge){d[o]=d[o+1]=d[o+2]=255;d[o+3]=200}}
  c.putImageData(img,0,0);return cv}
export function createMinimap(canvas,cam,onCenter){
  const ctx=canvas.getContext('2d');let base=null,k=1,shade=null,shadeFor=null;
  function resize(){const dpr=window.devicePixelRatio||1,s=Math.min(BOX_W/W,BOX_H/H),cw=Math.round(W*s),ch=Math.round(H*s);
    canvas.style.width=cw+'px';canvas.style.height=ch+'px';canvas.width=Math.max(1,Math.round(cw*dpr));canvas.height=Math.max(1,Math.round(ch*dpr));k=canvas.width/W}
  resize();
  canvas.addEventListener('pointerdown',e=>e.stopPropagation()); // never starts a map drag
  canvas.addEventListener('click',e=>{e.stopPropagation();const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return;
    onCenter((e.clientX-r.left)/r.width*W*T,(e.clientY-r.top)/r.height*H*T)});

  function dot(x,y,size,col){ctx.fillStyle=col;ctx.fillRect(Math.round(x*k-size/2),Math.round(y*k-size/2),size,size)}
  // a dot with a one-pixel dark edge, so it reads on river, lava and snow alike
  function edot(x,y,size,col){dot(x,y,size+2,MARK.edge);dot(x,y,size,col)}
  function draw(S){
    if(!base)base=buildBase();
    ctx.setTransform(1,0,0,1,0,0);ctx.imageSmoothingEnabled=false;
    ctx.drawImage(base,0,0,W,H,0,0,canvas.width,canvas.height);
    if(cam.region!=null){ // the picked region (#430): everything else dims, the region keeps its colour
      if(shadeFor!==cam.region){shade=buildShade(cam.region);shadeFor=cam.region}ctx.drawImage(shade,0,0,W,H,0,0,canvas.width,canvas.height)}
    const d=Math.max(2,Math.round(k)),big=d+2;
    // landmarks: crypt mouths in crypt green, Kragmaw's lair as a ring (the boss dot sits inside while it lives)
    for(const L of LANDMARKS){if(L.kind==='crypt'&&L.mouth)edot((L.mouth.x0+L.mouth.x1+1)/2,(L.mouth.y0+L.mouth.y1+1)/2,big,TEXT.crypt);
      else if(L.kind==='lair'){ctx.strokeStyle=S.boss.alive?BOSS_COL:TEXT.dead;ctx.lineWidth=Math.max(1,Math.round(k/2));ctx.beginPath();ctx.arc(L.x*k,L.y*k,(L.r||5)*k,0,7);ctx.stroke()}}
    for(const m of S.mobs){if(m.elite&&m.alive)edot(m.x,m.y,big,ELITE_COL)}
    if(S.boss.alive){dot(S.boss.x,S.boss.y,big+2,'#3a1a20');dot(S.boss.x,S.boss.y,big,BOSS_COL)}
    for(const a of S.agents){if(a.hidden||a.state==='dead')continue;
      if(a.state==='ghost')ctx.globalAlpha=GHOST_ALPHA;
      edot(a.x,a.y,d,FAC[a.fac].color);ctx.globalAlpha=1}
    for(const a of S.agents){if(a.hidden||a.state==='dead'||!(a.brain||a.player))continue; // AI- or agent-played heroes get a ring
      ctx.strokeStyle=MIND_COL;ctx.lineWidth=Math.max(1,Math.round(k/2));const r=big+2;ctx.strokeRect(Math.round(a.x*k-r/2)+.5,Math.round(a.y*k-r/2)+.5,r,r)}
    // Fellowship members (#94): bright class-coloured dots with a dark edge, on top of everyone else
    if(S.fellowship)for(const k in S.fellowship.slots){const a=S.agents.find(x=>x.id==S.fellowship.slots[k]);if(!a||a.hidden||a.state==='dead')continue;
      edot(a.x,a.y,big,classColor(a.cls))}
    // townsfolk, placed people and foes of a scene: a small dot in the disposition colour (hollow, so never a class dot)
    for(const p of (S.npcs||[]).concat(S.wanderers||[])){if(p.hidden)continue;const t=toneOf(p,S.fellowship,S.gameMin);if(!t.color)continue;
      ctx.strokeStyle=t.color;ctx.lineWidth=1;ctx.strokeRect(Math.round(p.x*k-d/2)+.5,Math.round(p.y*k-d/2)+.5,d,d)}
    const sel=cam.sel;if(sel&&!sel.hidden&&sel.state!=='dead'){dot(sel.x,sel.y,big+1,'#000');dot(sel.x,sel.y,d+1,SEL_COL)}
    // view rectangle, kept inside the canvas
    const lw=Math.max(1,Math.round(k/2)),x0=Math.max(0,(cam.camX-cam.vw/2)/T*k),y0=Math.max(0,(cam.camY-cam.vh/2)/T*k);
    const x1=Math.min(canvas.width,(cam.camX+cam.vw/2)/T*k),y1=Math.min(canvas.height,(cam.camY+cam.vh/2)/T*k);
    ctx.strokeStyle='rgba(255,255,255,.9)';ctx.lineWidth=lw;ctx.strokeRect(Math.round(x0)+lw/2,Math.round(y0)+lw/2,Math.max(lw,Math.round(x1-x0)-lw),Math.max(lw,Math.round(y1-y0)-lw))}

  return {draw,resize};
}
