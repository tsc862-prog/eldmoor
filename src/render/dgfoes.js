// The foes of a dungeon chamber (#85, slice 2): who stands in the room being fought, as the watcher sees them.
//   foeKind(type)             {name, pl, role, family, base} from the bestiary (a site creature borrows a field species' sprite)
//   foeSpot(room, k, n)       where foe k of n stands in a chamber, in tiles ({x, y} are the feet)
//   drawFoes(ctx, m, st, now, dpr, sc, pseudo)  the live crawl's foes with HP bars (one pip per blow it takes), fallen ones faint
//   foeAt(m, st, tx, ty)      the foe whose sprite is under tile-space point (tx, ty), or null (for the hover detail)
// st.foes: [{type, name, hp, hits, lvl, boss, eff}] for the chamber st.foeRoom (render/dungeonview.js stateOf), read only.
import {U as T} from './tile.js'; // world units a tile (render/tile.js; art is drawn at TILE)
import {BESTIARY,VARIANTS,baseId} from '../data/bestiary.js';
import {MOBS} from '../data/mobs.js';
import {sprite,outlined,SPR} from './sprites.js';
import {DISP} from '../core/colors.js';
import {MARK} from './palette.js';
import {drawConditions} from './conditions.js';

export function foeKind(type){const v=VARIANTS[type],b=BESTIARY[baseId(type)],sp=v||b||{},base=v?v.base:baseId(type),M=MOBS[base]||MOBS[baseId(type)];
  return {name:sp.name||(M&&M.name)||'foe',pl:sp.pl||(M&&M.pl)||'foes',role:sp.role||'brute',family:sp.family||'',base,M}}
const sprOf=(type,fr)=>{const k=foeKind(type),M=k.M;return M&&SPR[M.spr]?sprite('dgf-'+k.base+fr,SPR[M.spr][fr&1],M.col):null};

// Foes stand in a row across the upper half of the chamber, the party below them.
export function foeSpot(r,k,n){const half=(r.w-1.4)/2,step=Math.min(1.35,n>1?half*2/(n-1):0),x=r.cx+(k-(n-1)/2)*step;
  return {x:Math.max(r.x+.8,Math.min(r.x+r.w-.8,x)),y:r.cy-(r.boss?.1:.25)+(k&1?.32:0)}}

export function drawFoes(ctx,m,st,now,dpr,sc,pseudo){const foes=st.foes;if(!foes||!foes.length||st.foeRoom==null)return;const r=m.rooms[st.foeRoom];if(!r)return;
  const n=foes.length,fr=Math.floor(now*1.8)&1,hostile=DISP.hostile.color;
  for(let k=0;k<n;k++){const f=foes[k],s=sprOf(f.type,k&1?fr^1:fr);if(!s)continue;const o=outlined(s),p=foeSpot(r,k,n),px=Math.round(p.x*T),py=Math.round(p.y*T),top=py-s.height,dead=f.hp<=0;
    ctx.globalAlpha=dead?.2:1;
    ctx.fillStyle=MARK.shadow;ctx.beginPath();ctx.ellipse(px,py-1,s.width/2,1.6,0,0,7);ctx.fill();
    ctx.save();ctx.translate(px,0);ctx.scale(-1,1);ctx.drawImage(o,-Math.floor(s.width/2)-1,top-1);ctx.restore();ctx.globalAlpha=1;
    if(dead)continue;
    if(f.eff)drawConditions(ctx,null,pseudo,f,px,py,top-4,now);
    // the HP bar: dark edge, red fill, a tick between each blow the foe still takes
    const hits=Math.max(1,f.hits||f.hp),w=f.boss?18:12,x0=px-(w>>1),y0=top-3;
    ctx.fillStyle=MARK.edge;ctx.fillRect(x0-1,y0-1,w+2,4);ctx.fillStyle='#3a1418';ctx.fillRect(x0,y0,w,2);
    ctx.fillStyle=f.hp<hits?'#e0584a':hostile;ctx.fillRect(x0,y0,Math.max(1,Math.round(w*Math.min(1,f.hp/hits))),2);
    if(hits>1){ctx.fillStyle=MARK.edge;for(let j=1;j<hits;j++)ctx.fillRect(x0+Math.round(w*j/hits)-1,y0,1,2)}}}

export function foeAt(m,st,tx,ty){const foes=st.foes;if(!foes||!foes.length||st.foeRoom==null)return null;const r=m.rooms[st.foeRoom];if(!r)return null;
  for(let k=foes.length-1;k>=0;k--){const s=sprOf(foes[k].type,0);if(!s)continue;const p=foeSpot(r,k,foes.length),px=p.x*T,py=p.y*T;
    if(tx>=px-s.width/2-1&&tx<=px+s.width/2+1&&ty>=py-s.height-4&&ty<=py+1)return foes[k]}
  return null}
