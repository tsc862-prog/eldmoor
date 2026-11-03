// Draws what the DM's levers put on the map (sim/levers.js): place markers (ruin, camp,
// shrine, cairn door, watchtower) as small pixel props, danger and cleared areas as faint
// dashed rings, region conditions as a soft tint over the region's tiles at close zoom and a
// line under the region label when zoomed out, and DM-placed people (S.wanderers) with the
// townsfolk sprites. Names show in follow and close zoom. Called once from draw.js before the
// entity loop, so heroes walk over the markers. Owned by ai-designer.
import {W,H} from '../world/tiles.js';
import {U as T,PROC_SCALE,ART,HEAD} from './tile.js';
import {zone,I,ZONES,LABELS,CITY} from '../world/map.js';
import {CONDITIONS} from '../sim/levers.js';
import {TEXT} from './palette.js';
import {bannerSprite,buntingSprite,worldSprite} from './sprites.js';
import {hash} from '../core/rng.js';
import {toneOf,toneName} from '../core/colors.js';
import {slotted} from '../sim/company.js'; // the slotted company (#588)

// Each prop: rectangles [x, y, w, h, colour] in world px relative to the foot point.
const PROPS={
  ruin:[[-6,-9,3,9,'#8a8a96'],[3,-6,3,6,'#7a7a86'],[-2,-3,4,3,'#6a6a76'],[-6,-10,3,1,'#a8a8b4'],[-7,-1,14,1,'#4a4a56']],
  camp:[[-7,-7,8,7,'#9a7a4a'],[-6,-8,6,1,'#b8986a'],[-3,-4,2,4,'#3a2a1a'],[3,-2,4,2,'#5a3a20']],
  shrine:[[-2,-9,4,9,'#8a8a96'],[-3,-10,6,2,'#a8a8b4'],[-1,-7,2,2,'#f2c14e'],[-4,-1,8,1,'#4a4a56']],
  cairn_door:[[-6,-8,12,8,'#6a6a72'],[-5,-9,10,1,'#8a8a92'],[-2,-6,4,6,'#1a1a22'],[-7,-1,14,1,'#3a3a42']],
  watchtower:[[-3,-16,6,16,'#7a5a3a'],[-5,-18,10,3,'#5a3a20'],[-1,-12,2,2,'#1a1a22'],[-4,-1,8,1,'#3a2a1a']],
};
const FIRE=['#ffb040','#ff7020'];

// World events (#354, sim/events.js): festival and plague are region conditions with their own look at
// close zoom; far zoom keeps the generic line under the region label like every other condition.
// Plague: the ground drained of colour and washed a sickly grey-green, with dark mould blotches on some
// tiles (fixed per tile by hash, so they never crawl) and a slow pale miasma pulse. The region's tiles in
// view go into one path, filled once per layer (no seams, nothing allocated per tile).
const PLAGUE={grey:'#7a7a72',wash:'#5e7a48',mould:'#2e3a22',mist:'#b8c8a0'};
function plague(ctx,z,x0,x1,y0,y1,blink){
  ctx.beginPath();for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(zone[I(x,y)]===z)ctx.rect(x*T,y*T,T,T);
  ctx.save();ctx.globalCompositeOperation='saturation';ctx.globalAlpha=.6;ctx.fillStyle=PLAGUE.grey;ctx.fill();
  ctx.globalCompositeOperation='source-over';ctx.globalAlpha=.2;ctx.fillStyle=PLAGUE.wash;ctx.fill();
  ctx.globalAlpha=.04+.03*Math.sin(blink*.8);ctx.fillStyle=PLAGUE.mist;ctx.fill();
  ctx.globalAlpha=.5;ctx.fillStyle=PLAGUE.mould;
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){if(zone[I(x,y)]!==z)continue;const h=hash(x,y,355);if(h>.22)continue;
    const bx=x*T+2+((h*97)|0)%10,by=y*T+2+((h*331)|0)%10;ctx.fillRect(bx,by,4,2);ctx.fillRect(bx+1,by-1,2,1);ctx.fillRect(bx+1,by+2,2,1);if(h<.08)ctx.fillRect(bx+5,by+3,2,2)}
  ctx.restore()}
// Festival: a banner on each corner of the wall and bunting strung along the top and bottom walls, in
// the town's faction colours (the gate keeps its own standards from terrain.js). Towns come from CITY;
// a town belongs to the region its middle tile lies in.
const TC=(t,k)=>k?Math.floor((t.y0+t.y1)/2):Math.floor((t.x0+t.x1)/2);
function banner(ctx,fac,fx,fy,flip,f,outlined){const s=outlined(bannerSprite(fac,f));
  if(flip){ctx.save();ctx.translate(fx,0);ctx.scale(-1,1);ctx.drawImage(s,-1,fy-s.height+1);ctx.restore()}
  else ctx.drawImage(s,fx-1,fy-s.height+1)}
function festive(ctx,t,blink,outlined){const f=Math.floor(blink*2+t.x0)%2;
  const lx=t.x0*T+3,rx=(t.x1+1)*T-4,b=buntingSprite(rx-lx,f);
  for(const fy of [(t.y0+1)*T-2,(t.y1+1)*T-2]){ctx.drawImage(b,lx+1,fy-13);
    banner(ctx,t.fac,lx,fy,false,f,outlined);banner(ctx,t.fac,rx,fy,true,f,outlined)}}
export function drawPlaces(ctx,S,cam,o){const {blink,drawText,inView,npcSprite,outlined,dispoRing}=o,close=cam.close;
  // region conditions: a faint wash over the region's tiles in view (close), a line under its label (far)
  for(const c of S.conditions||[]){const C=CONDITIONS[c.kind];if(!C)continue;
    if(close){const x0=Math.max(0,Math.floor((cam.camX-cam.vw/2)/T)),x1=Math.min(W-1,Math.ceil((cam.camX+cam.vw/2)/T)),
        y0=Math.max(0,Math.floor((cam.camY-cam.vh/2)/T)),y1=Math.min(H-1,Math.ceil((cam.camY+cam.vh/2)/T));
      if(c.kind==='plague')plague(ctx,c.z,x0,x1,y0,y1,blink);
      else{ctx.globalAlpha=.07;ctx.fillStyle=C.col;for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(zone[I(x,y)]===c.z)ctx.fillRect(x*T,y*T,T,T);ctx.globalAlpha=1}
      if(c.kind==='festival')for(const t of CITY)if(zone[I(TC(t,0),TC(t,1))]===c.z&&inView((t.x0+t.x1+1)/2*T,(t.y0+t.y1+1)/2*T,(t.w+t.h)*T))festive(ctx,t,blink,outlined)}
    else{const L=LABELS.find(l=>l[0].toLowerCase()===String(ZONES[c.z]).toLowerCase());if(L&&inView(L[1]*T,L[2]*T,200))drawText('· '+C.label.toUpperCase()+' ·',L[1]*T,L[2]*T+18*cam.dpr/cam.sc,C.col,11)}}
  // danger and cleared areas: dashed rings, close zoom only
  if(close)for(const m of S.marks||[]){if(!inView(m.x*T,m.y*T,m.r*T+8))continue;
    ctx.save();ctx.setLineDash([4,4]);ctx.lineWidth=1;ctx.strokeStyle=m.kind==='danger'?'rgba(230,80,60,.55)':'rgba(120,210,140,.5)';
    ctx.beginPath();ctx.arc(m.x*T,m.y*T,m.r*T,0,7);ctx.stroke();ctx.restore()}
  // places
  for(const p of S.places||[]){const px=Math.round(p.x*T),py=Math.round(p.y*T);if(!inView(px,py,32))continue;
    for(const [x,y,w,h,c] of PROPS[p.kind]||PROPS.ruin){ctx.fillStyle=c;ctx.fillRect(px+x,py+y,w,h)}
    if(p.kind==='camp'){ctx.fillStyle=FIRE[Math.floor(blink*4)%2];ctx.fillRect(px+4,py-4,2,2)}
    if(close)drawText(p.name,px,py-(p.kind==='watchtower'?22:14),TEXT.person,12)}
  // DM-placed people
  for(const w of S.wanderers||[]){if(!inView(w.x*T,w.y*T,32))continue;
    const fr=w.moving?Math.floor(blink*6+w.id)%2:Math.floor(blink*1.5)%2,s=npcSprite(w,fr),px=Math.round(w.x*T),py=Math.round(w.y*T);
    const sw=s.width*PROC_SCALE,sh=s.height*PROC_SCALE,o=worldSprite(s); // scaled to the 32x48 entity size (render/tile.js)
    ctx.fillStyle='rgba(0,0,0,.35)';ctx.beginPath();ctx.ellipse(px,py,sw/2,1.5,0,0,7);ctx.fill();
    const t=toneOf(w,slotted(),S.gameMin);if(close)dispoRing(px,py,sw,t.kind);
    ctx.save();ctx.translate(px,0);if(w.face<0)ctx.scale(-1,1);ctx.drawImage(o,-Math.floor(s.width/2)*PROC_SCALE-1/ART,py-sh-1/ART,o.width/ART,o.height/ART);ctx.restore();
    if(close)drawText(toneName(w,t),px,py-HEAD,t.color||TEXT.person,12)}}
