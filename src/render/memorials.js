// Draws the persistent memorials (sim/memorials.js, issue #12): gravestones where heroes
// fell, statues of legends in their home town square, and Kragmaw's lair as cooled rock with a
// loot-cave marker while the boss is dead. All render-only: the terrain arrays never change.
// Called once from draw.js before the entity loop so heroes walk over the stones.
import {U as T} from './tile.js'; // world units a tile (render/tile.js; art is drawn at TILE)
import {tiles,I,LAIR,LANDMARKS} from '../world/map.js';
import {LAVA} from '../world/tiles.js';
import {FAC} from '../data/factions.js';

const STONE={G:'#8a8a96',F:'#4a4a58',M:'#5a7a4a'};
const STATUE={S:'#9a9aa6',L:'#c4c4cc',P:'#6a6a76'};
const COOL={C:'#3a3640',V:'#6a3a30',A:'#524e58'};
const CAVE={R:'#5a5660',D:'#0e0c12',G:'#f2c14e'};

export function drawMemorials(ctx,S,cam,o){const {sprite,SPR,inView,drawText,blink}=o,close=cam.close,boss=S.boss;
  // cooled lair: the lava ring turns to dark crust until the wyrm wakes again
  const lair=LANDMARKS.find(l=>l.kind==='lair');
  if(!boss.alive&&lair&&inView(LAIR.x*T,LAIR.y*T,lair.r*T+8)){
    const cs=sprite('cooled',SPR.cooled[0],COOL),r=Math.ceil(lair.r)+1;
    for(let y=Math.floor(LAIR.y)-r;y<=Math.floor(LAIR.y)+r;y++)for(let x=Math.floor(LAIR.x)-r;x<=Math.floor(LAIR.x)+r;x++)
      if(x>=0&&y>=0&&tiles[I(x,y)]===LAVA)ctx.drawImage(cs,x*T,y*T);
    const cv=sprite('cave',SPR.cave[0],CAVE),cx=Math.round(LAIR.x*T),cy=Math.round(LAIR.y*T);
    ctx.drawImage(cv,cx-6,cy-5);
    if(Math.floor(blink*2)%2){ctx.fillStyle='#fff2b0';ctx.fillRect(cx-1,cy+1,1,1)}
    if(close)drawText('Kragmaw’s hoard · wakes in '+Math.max(1,Math.round(boss.respawn/10))+'h',LAIR.x*T,LAIR.y*T-12,'#c8b890',13)}
  // gravestones: only for the fallen whose own grave sprite has been recycled out of S.agents
  const graves=S.graves;
  if(graves&&graves.length){const lying=new Set();for(const a of S.agents)if(a.state==='dead')lying.add(a.id);
    for(const g of graves){if(lying.has(g.id)||!inView(g.x*T,g.y*T,40))continue;
      const s=sprite('stone'+(g.id%3)+g.fac,SPR.stone[g.id%3],{...STONE,F:FAC[g.fac].dark});
      ctx.fillStyle='rgba(0,0,0,.3)';ctx.fillRect(Math.round(g.x*T)-4,Math.round(g.y*T)-1,8,2);
      ctx.drawImage(s,Math.round(g.x*T)-3,Math.round(g.y*T)-s.height);
      if(close)drawText('† '+g.name+' '+g.lvl,g.x*T,g.y*T-s.height-3,'#9a98ac',12)}}
  // statues in the town squares; the plaque shows at close zoom
  for(const s of S.statues||[]){if(!inView(s.x*T,s.y*T,40))continue;
    const sp=sprite('statue'+s.fac,SPR.statue[0],{...STATUE,F:FAC[s.fac].color}),px=Math.round(s.x*T),py=Math.round(s.y*T);
    ctx.fillStyle='rgba(0,0,0,.3)';ctx.fillRect(px-5,py-1,10,2);ctx.drawImage(sp,px-4,py-sp.height);
    if(close)drawText(s.name+' · '+s.lvl,s.x*T,py+9,'#d8c890',12)}}
