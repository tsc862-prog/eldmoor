// The Fellowship's campfire (issue #64): stone ring, logs, flickering flame, drifting sparks, bedrolls
// at each camper's spot, and a warm pool of light at night. Procedural, no image assets. Reads
// every company's camp (C.camp, sim/camp.js; two companies light two fires, #439); draws nothing when there is none.
import {U as T} from './tile.js'; // world units a tile (render/tile.js)
// A scene that broke out at a camp (#431 slice 3: the fireside, an ambush on the watch, questions at the fire) keeps its fire
// drawn while it lasts, even when the ambush broke the camp: the bedrolls lie where they were left.
const atScene=S=>{const out=[];for(const sc of [S.table,...Object.values(S.tables||{})]){const p=sc&&sc.ctx&&sc.ctx.camp;if(p&&!(S.companies||[]).some(C=>C.camp&&C.camp.phase&&Math.abs(C.camp.x-p.x)<.01&&Math.abs(C.camp.y-p.y)<.01))out.push({x:p.x,y:p.y,ids:sc.ids,phase:'scene',left:true})}return out};
const camps=S=>(S.companies||[]).map(C=>C.camp).filter(g=>g&&g.phase).concat(atScene(S));

export function drawCamp(ctx,S,cam,o){for(const g of camps(S))drawOne(ctx,S,cam,o,g)}
function drawOne(ctx,S,cam,o,g){const {inView,blink,drawText}=o;
  const cx=Math.round(g.x*T),cy=Math.round(g.y*T);if(!inView(cx,cy,40))return;
  // bedrolls
  const ids=g.ids||[];ids.forEach((id,i)=>{const a=S.agents.find(x=>x.id===id);if(!a||(a.state!=='camp'&&!g.left))return;
    const ang=i/Math.max(1,ids.length)*Math.PI*2+.6,bx=Math.round(g.x*T+Math.cos(ang)*T*1.15)-5,by=Math.round(g.y*T+Math.sin(ang)*T*.92)+3;
    ctx.fillStyle='#2a2430';ctx.fillRect(bx-1,by-1,12,6);ctx.fillStyle=id===g.watcher?'#6a5a40':'#7a4a3a';ctx.fillRect(bx,by,10,4);ctx.fillStyle='#d8c8a0';ctx.fillRect(bx,by,3,4);
    if(id!==g.watcher&&g.phase==='rest'){const t=(blink*.8+i*.31)%1,zx=bx+8+Math.round(t*3),zy=by-4-Math.round(t*7); // a small z drifts up from each sleeper (#178)
      ctx.fillStyle='rgba(200,215,255,'+(1-t*.8).toFixed(2)+')';ctx.fillRect(zx,zy,3,1);ctx.fillRect(zx+1,zy+1,1,1);ctx.fillRect(zx,zy+2,3,1)}});
  // stone ring and logs
  ctx.fillStyle='#4a4650';for(let k=0;k<8;k++){const a=k/8*Math.PI*2;ctx.fillRect(Math.round(cx+Math.cos(a)*6)-1,Math.round(cy+Math.sin(a)*4.5)-1,3,2)}
  ctx.fillStyle='#3a2616';ctx.fillRect(cx-4,cy+1,8,2);ctx.fillStyle='#5a3a20';ctx.fillRect(cx-3,cy,6,2);
  // flame: three layers that flicker
  const f=Math.floor(blink*9),h=3+(f%3);
  ctx.fillStyle='#c8381c';ctx.fillRect(cx-3,cy-h+1,6,h);
  ctx.fillStyle='#f08a2a';ctx.fillRect(cx-2,cy-h-1+(f&1),4,h);
  ctx.fillStyle='#ffe27a';ctx.fillRect(cx-1,cy-h+1,2,Math.max(2,h-2));
  // sparks
  for(let k=0;k<3;k++){const t=(blink*1.6+k*.37)%1;ctx.fillStyle=t<.6?'#ffd060':'#c8803a';ctx.fillRect(Math.round(cx-3+k*3+Math.sin(t*6+k)*2),Math.round(cy-6-t*14),1,1)}
  if(cam.close&&!S.table){const w=ids.map(id=>S.agents.find(x=>x.id===id)).find(a=>a&&a.id===g.watcher);
    drawText('CAMP'+(w?' · '+w.name+' on watch':''),cx,cy-26,'#f4c070',13)}}

// Warm light at night (render/lightmap.js): each fire is one light, breathing slowly.
const FIRE_LIGHT=[255,170,70];
export function drawCampLight(glow,S,dk,inView,now){for(const g of camps(S)){const x=g.x*T,y=g.y*T,r=78;if(!inView(x,y,r))continue;
  glow(x,y-3,r,FIRE_LIGHT,dk*1.7*(.86+.09*Math.sin(now*2.3+g.x)+.05*Math.sin(now*5.1+g.y)))}}
