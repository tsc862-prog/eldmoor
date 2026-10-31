// Map renderer: camera (whole map or follow), entities sorted by y, effects,
// day/night overlay with torch light, labels at constant CSS size.
// `cam` is shared with the UI (selection and view mode live here).
import {clamp} from '../core/rng.js';
import {W,H,T} from '../world/tiles.js';
import {CITY,LAIR,CRYPT,LIGHTS,LABELS} from '../world/map.js';
import {FAC} from '../data/factions.js';
import {MOBS} from '../data/mobs.js';
import {S,maxHp} from '../sim/index.js';
import {sprite,SPR,heroSprite} from './sprites.js';

export const cam={view:'map',sel:null,camX:W*T/2,camY:H*T/2,sc:1,offX:0,offY:0,dpr:1,fit:1};

export function createRenderer(cv,screenEl,terrain){
  const ctx=cv.getContext('2d');
  function resize(){const r=screenEl.getBoundingClientRect();cam.dpr=window.devicePixelRatio||1;cv.width=Math.max(1,Math.round(r.width*cam.dpr));cv.height=Math.max(1,Math.round(r.height*cam.dpr));cam.fit=cv.width/(W*T)}
  new ResizeObserver(resize).observe(screenEl);resize();

  function darkness(){const h=(S.gameMin/60)%24;if(h>=21||h<5)return .55;if(h>=18)return (h-18)/3*.55;if(h<7)return (7-h)/2*.55;return 0}
  function drawText(txt,x,y,col,css){const s=css*cam.dpr/cam.sc;ctx.font=s+'px VT323, monospace';ctx.textAlign='center';ctx.fillStyle='#000';ctx.fillText(txt,x+s*.07,y+s*.07);ctx.fillStyle=col;ctx.fillText(txt,x,y)}

  let blink=0;
  function draw(){
    blink+=1/60;const {agents,mobs,boss,fx}=S;
    ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#000';ctx.fillRect(0,0,cv.width,cv.height);
    const sel=cam.sel,follow=cam.view==='follow'&&sel;
    cam.sc=follow?Math.max(cam.fit*2.6,cv.width/230):cam.fit;const sc=cam.sc;
    const vw=cv.width/sc,vh=cv.height/sc;
    if(follow){cam.camX+=(sel.x*T-cam.camX)*.12;cam.camY+=(sel.y*T-cam.camY)*.12}else{cam.camX=W*T/2;cam.camY=H*T/2}
    const cx=clamp(cam.camX,vw/2,W*T-vw/2),cy=clamp(cam.camY,vh/2,H*T-vh/2);
    cam.offX=Math.round((vw/2-cx)*sc);cam.offY=Math.round((vh/2-cy)*sc);
    ctx.setTransform(sc,0,0,sc,cam.offX,cam.offY);ctx.imageSmoothingEnabled=false;
    ctx.drawImage(terrain,0,0);
    // lava shimmer
    const tt=performance.now()/400;
    ctx.fillStyle='#ffe27a';for(let i=0;i<14;i++){const a=i*2.4+tt*.3;ctx.fillRect(Math.round(LAIR.x*T+Math.cos(a)*38),Math.round(LAIR.y*T+Math.sin(a)*38),1,1)}
    const close=sc>=cam.fit*2;
    // NPCs
    for(const c of CITY){for(const [p,col] of [[c.qg,'#7a4ab8'],[c.ah,'#b8862a']]){const s=sprite('npc'+col,SPR.npc,{H:'#d8d0c0',S:'#f0c8a0',R:col});
      ctx.drawImage(s,Math.round(p.x*T-2.5),Math.round((p.y-.15)*T-6))}
      ctx.fillStyle='#ffe040';const by=Math.round(Math.sin(blink*4))*1;ctx.fillRect(Math.round(c.qg.x*T),Math.round((c.qg.y-.15)*T-11+by),1,3);ctx.fillRect(Math.round(c.qg.x*T),Math.round((c.qg.y-.15)*T-7+by),1,1);
      ctx.fillStyle='#f2c14e';ctx.fillRect(Math.round(c.ah.x*T)-1,Math.round((c.ah.y-.15)*T-10),3,3)}
    // entities sorted by y
    const ents=[];for(const m of mobs)if(m.alive)ents.push(m);for(const a of agents)ents.push(a);if(boss.alive)ents.push(boss);
    ents.sort((a,b)=>a.y-b.y);
    for(const e of ents){if(e.hidden)continue;
      let s;if(e.kind==='mob'){const M=MOBS[e.type];s=sprite(e.type,SPR[M.spr],M.col)}
      else if(e.kind==='boss')s=sprite('boss',SPR.boss,{R:'#7a2a3a',W:'#d04a2a',E:'#ffe060',T:'#f0ead0',D:'#3a1a20'});
      else if(e.state==='dead')s=sprite('grave'+e.fac,SPR.grave,{G:'#8a8a96',F:'#3a3a46',B:FAC[e.fac].dark});
      else s=heroSprite(e,e.state==='ghost');
      const bob=e.moving&&(Math.floor(blink*8+e.id)%2)?-1:0;
      const px=Math.round(e.x*T),py=Math.round(e.y*T)+bob;
      if(e.kind==='hero'&&e.state==='ghost')ctx.globalAlpha=.6;
      // shadow
      ctx.fillStyle='rgba(0,0,0,.35)';ctx.fillRect(px-Math.floor(s.width/2),Math.round(e.y*T),s.width,1);
      ctx.save();ctx.translate(px,0);if(e.face<0)ctx.scale(-1,1);
      ctx.drawImage(s,-Math.floor(s.width/2),py-s.height);ctx.restore();ctx.globalAlpha=1;
      if(e===sel){ctx.fillStyle=Math.floor(blink*3)%2?'#f2c14e':'#fff2b0';ctx.fillRect(px-1,py-s.height-4,3,1);ctx.fillRect(px,py-s.height-3,1,1)}
      if(close&&e.hp<(e.kind==='hero'?maxHp(e):e.maxhp)&&e.state!=='ghost'){const mx=e.kind==='hero'?maxHp(e):e.maxhp,w=e.kind==='boss'?14:6;
        ctx.fillStyle='#000';ctx.fillRect(px-w/2,py-s.height-2,w,1);ctx.fillStyle=e.kind==='hero'?'#3fbf4a':'#e0483e';ctx.fillRect(px-w/2,py-s.height-2,Math.max(0,w*e.hp/mx),1)}
    }
    // effects
    for(const p of fx){if(p.type==='bolt'){ctx.fillStyle=p.col;const t=1-p.life/.25;const x=(p.x0+(p.x1-p.x0)*t)*T,y=(p.y0+(p.y1-p.y0)*t)*T;ctx.fillRect(Math.round(x),Math.round(y),2,1)}
      if(p.type==='ring'){ctx.strokeStyle='rgba(255,140,40,'+p.life+')';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x*T,p.y*T,(1-p.life/.6)*36+4,0,7);ctx.stroke()}}
    // night
    const dk=darkness();if(dk>0){ctx.fillStyle='rgba(8,10,40,'+dk+')';ctx.fillRect(0,0,W*T,H*T);
      ctx.globalCompositeOperation='lighter';
      for(const L of LIGHTS){const r=L.big?46:14;const g=ctx.createRadialGradient(L.x*T,L.y*T,0,L.x*T,L.y*T,r);g.addColorStop(0,'rgba(255,170,70,'+(dk*.7)+')');g.addColorStop(1,'rgba(255,170,70,0)');ctx.fillStyle=g;ctx.fillRect(L.x*T-r,L.y*T-r,r*2,r*2)}
      ctx.globalCompositeOperation='source-over'}
    // labels
    if(!follow){
      for(const[t,x,y]of LABELS)drawText(t,x*T,y*T,'#f4ecd0',13);
      if(boss.alive)drawText('KRAGMAW',LAIR.x*T,(LAIR.y-3)*T,'#ffb060',12);
      drawText(CRYPT.group&&CRYPT.group.phase==='inside'?'CRYPT · '+CRYPT.group.mem.length+' INSIDE':'SUNKEN CRYPT',CRYPT.x*T,40.4*T,'#9ae0b8',12)}
    else{
      if(CRYPT.group&&CRYPT.group.phase==='inside')drawText(CRYPT.group.mem.length+' inside · '+Math.ceil(CRYPT.group.t)+'s',CRYPT.x*T,41*T-2,'#9ae0b8',14);
      for(const a of agents){if(a.hidden)continue;if(Math.abs(a.x*T-cam.camX)>vw/2+20||Math.abs(a.y*T-cam.camY)>vh/2+20)continue;
        const dead=a.state==='dead';drawText((dead?'† ':'')+a.name,a.x*T,a.y*T-9.5,a===sel?'#f2c14e':dead?'#9a98ac':FAC[a.fac].color,14)}
      for(const m of mobs){if(!m.elite||!m.alive||Math.abs(m.x*T-cam.camX)>vw/2+20||Math.abs(m.y*T-cam.camY)>vh/2+20)continue;drawText(m.name,m.x*T,m.y*T-9.5,'#ffb060',14)} // named elite nameplate
      if(boss.alive)drawText('Kragmaw · '+Math.max(0,Math.round(boss.hp/boss.maxhp*100))+'%',boss.x*T,boss.y*T-12,'#ffb060',15);
      for(const p of fx)if(p.type==='txt'){ctx.globalAlpha=Math.min(1,p.life*1.5);drawText(p.txt,p.x*T,p.y*T,p.col,15);ctx.globalAlpha=1}}
  }

  // Convert a pointer position to tile coordinates.
  function screenToWorld(clientX,clientY){const r=cv.getBoundingClientRect();
    return {x:((clientX-r.left)*cam.dpr-cam.offX)/cam.sc/T,y:((clientY-r.top)*cam.dpr-cam.offY)/cam.sc/T}}

  return {draw,resize,screenToWorld};
}
