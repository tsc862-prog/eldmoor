// Draws S.encounters (see sim/encounters.js): the wagon, lanternstone, strongbox,
// pilgrim and the bandit figures of an ambush, at the encounter tile, plus a small
// nameplate in follow view. Called from draw.js just before the entity loop so
// heroes render over them. Owned by world-builder.
import {U as T,PROC_SCALE,ART,HEAD} from './tile.js';
import {worldSprite} from './sprites.js'; // world units a tile (render/tile.js; art is drawn at TILE)
import {ENC} from '../sim/encounters.js';

const PAL={
  wagon:{C:'#c8b890',W:'#7a5230',K:'#3a2c20',G:'#f2c14e'},
  shrine:{S:'#8a8a96',L:'#f2c14e',D:'#3a3a46'},
  chest:{B:'#7a5230',M:'#b8862a',L:'#2a1a10',G:'#fff2b0'},
  pilgrim:{H:'#6a5a4a',S:'#e8c8a0',R:'#9a8a6a',P:'#4a3a2a',T:'#5a3a20'},
  // Rookscar bandits: dark hoods, grey-green skin, old leather and a dull blade.
  bandit:{H:'#3a3a46',S:'#8a9a6a',R:'#5a3a2a',B:'#b0b8c0'},
};
const LABEL_COL={merchant:'#f2c14e',shrine:'#9ad0ff',chest:'#f2c14e',pilgrim:'#e8dcc0',ambush:'#ff6a5a'};
// Where the 2-3 bandits stand around the ambush tile.
const BANDIT_OFF=[[-.9,.1],[.9,-.2],[.1,.7]];

export function drawEncounters(ctx,S,cam,sprite,SPR,blink,drawText){const L=S.encounters;if(!L||!L.length)return;
  const follow=cam.view==='follow'&&cam.sel,vw=ctx.canvas.width/cam.sc,vh=ctx.canvas.height/cam.sc;
  const slow=Math.floor(blink*1.5)%2;
  for(const e of L){
    const px=Math.round(e.x*T),py=Math.round(e.y*T);
    if(e.type==='ambush'){for(let i=0;i<e.n;i++){const [ox,oy]=BANDIT_OFF[i],f=Math.floor(blink*1.5+i)%2,s=sprite('bandit'+f,SPR.bandit[f],PAL.bandit);
        const bx=px+Math.round(ox*T),by=py+Math.round(oy*T);const o=worldSprite(s,false);ctx.save();ctx.translate(bx,0);if(ox>0)ctx.scale(-1,1);ctx.drawImage(o,-5*PROC_SCALE,by-s.height*PROC_SCALE,o.width/ART,o.height/ART);ctx.restore()}}
    else{const key=e.type==='merchant'?'wagon':e.type,fr=e.type==='pilgrim'?(e.moving?Math.floor(blink*6)%2:0):slow,s=sprite('enc'+key+fr,SPR[key][fr],PAL[key]);
      const o=worldSprite(s,false);ctx.save();ctx.translate(px,0);if(e.face<0)ctx.scale(-1,1);ctx.drawImage(o,-Math.floor(s.width/2)*PROC_SCALE,py-s.height*PROC_SCALE,o.width/ART,o.height/ART);ctx.restore()}
    if(follow&&Math.abs(e.x*T-cam.camX)<=vw/2+40&&Math.abs(e.y*T-cam.camY)<=vh/2+40)drawText(ENC[e.type].label,px,py-HEAD+1,LABEL_COL[e.type],13)}}
