// Draws what the DM's levers put on the map (sim/levers.js): place markers (ruin, camp,
// shrine, cairn door, watchtower) as small pixel props, danger and cleared areas as faint
// dashed rings, region conditions as a soft tint over the region's tiles at close zoom and a
// line under the region label when zoomed out, and DM-placed people (S.wanderers) with the
// townsfolk sprites. Names show in follow and close zoom. Called once from draw.js before the
// entity loop, so heroes walk over the markers. Owned by ai-designer.
import {T,W,H} from '../world/tiles.js';
import {zone,I,ZONES,LABELS} from '../world/map.js';
import {CONDITIONS} from '../sim/levers.js';
import {DISPO,TEXT,dispoOf} from './palette.js';

// Each prop: rectangles [x, y, w, h, colour] in world px relative to the foot point.
const PROPS={
  ruin:[[-6,-9,3,9,'#8a8a96'],[3,-6,3,6,'#7a7a86'],[-2,-3,4,3,'#6a6a76'],[-6,-10,3,1,'#a8a8b4'],[-7,-1,14,1,'#4a4a56']],
  camp:[[-7,-7,8,7,'#9a7a4a'],[-6,-8,6,1,'#b8986a'],[-3,-4,2,4,'#3a2a1a'],[3,-2,4,2,'#5a3a20']],
  shrine:[[-2,-9,4,9,'#8a8a96'],[-3,-10,6,2,'#a8a8b4'],[-1,-7,2,2,'#f2c14e'],[-4,-1,8,1,'#4a4a56']],
  cairn_door:[[-6,-8,12,8,'#6a6a72'],[-5,-9,10,1,'#8a8a92'],[-2,-6,4,6,'#1a1a22'],[-7,-1,14,1,'#3a3a42']],
  watchtower:[[-3,-16,6,16,'#7a5a3a'],[-5,-18,10,3,'#5a3a20'],[-1,-12,2,2,'#1a1a22'],[-4,-1,8,1,'#3a2a1a']],
};
const FIRE=['#ffb040','#ff7020'];

export function drawPlaces(ctx,S,cam,o){const {blink,drawText,inView,npcSprite,outlined,dispoRing}=o,close=cam.close;
  // region conditions: a faint wash over the region's tiles in view (close), a line under its label (far)
  for(const c of S.conditions||[]){const C=CONDITIONS[c.kind];if(!C)continue;
    if(close){const x0=Math.max(0,Math.floor((cam.camX-cam.vw/2)/T)),x1=Math.min(W-1,Math.ceil((cam.camX+cam.vw/2)/T)),
        y0=Math.max(0,Math.floor((cam.camY-cam.vh/2)/T)),y1=Math.min(H-1,Math.ceil((cam.camY+cam.vh/2)/T));
      ctx.globalAlpha=.07;ctx.fillStyle=C.col;for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(zone[I(x,y)]===c.z)ctx.fillRect(x*T,y*T,T,T);ctx.globalAlpha=1}
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
    ctx.fillStyle='rgba(0,0,0,.35)';ctx.beginPath();ctx.ellipse(px,py,s.width/2,1.5,0,0,7);ctx.fill();
    const d=dispoOf(w,S.gameMin,'neutral');if(close)dispoRing(px,py,s.width,d);
    ctx.save();ctx.translate(px,0);if(w.face<0)ctx.scale(-1,1);ctx.drawImage(outlined(s),-Math.floor(s.width/2)-1,py-s.height-1);ctx.restore();
    if(close)drawText(w.name,px,py-17,DISPO[d],12)}}
