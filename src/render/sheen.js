// Water stays water (#979): multiplying blue water by a warm hour gives grey mud, and any warm tint reads as a dirt road, so at a low sun the water is pushed the other way, to a strong blue the warm light brings down to slate. The gold on it is the glints' (water.js). One soft mask of the map's water,
// tinted to the hour (a few times a game hour, not every frame), laid on the ground before anyone stands on it, off whatever crowns overhang the water: at dawn and dusk, a cold moon sheen at night, nothing at noon. It changes the water's colour and keeps its light and dark. Reads tiles only.
import {W,H,RIVER,SWAMP,BRIDGE} from '../world/tiles.js';
import {tiles,I} from '../world/map.js';
import {U as T} from './tile.js';
import {G} from './grade.js';
import {FX} from './quality.js';
import {castCover} from './shadows.js';
import {quayLip} from './harbour.js';

const K=4; // mask pixels a tile
let mask=null,tint=null,key=-1;
const mk=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c};
function build(){const r=mk(W*K,H*K),x=r.getContext('2d');let any=false;x.fillStyle='#fff';
  for(let ty=0;ty<H;ty++)for(let tx=0;tx<W;tx++){const t=tiles[I(tx,ty)];if(t===RIVER){x.fillRect(tx*K,ty*K,K,K);any=true}else if(t===SWAMP){x.globalAlpha=.5;x.fillRect(tx*K,ty*K,K,K);x.globalAlpha=1;any=true}}
  const m=mk(W*K,H*K),o=m.getContext('2d');o.filter='blur(1.2px)';o.drawImage(r,0,0);o.filter='none';
  for(let ty=0;ty<H;ty++)for(let tx=0;tx<W;tx++)if(tiles[I(tx,ty)]===BRIDGE)o.clearRect(tx*K-1,ty*K-1,K+2,K+2); // the blur spilled the water's blue over the deck
  for(const [x,y,h] of quayLip())o.clearRect(x*K,y*K-1,K,h*K+1);
  mask=any?m:false;tint=mk(W*K,H*K)}
// The tint at this hour: the low sun's colour, else the moon's. Strength in the alpha.
export function drawSheen(ctx,gameMin){if(!FX.full)return;if(mask===null)build();if(!mask)return;
  const sun=G.washA,moon=G.dk>.3?.1*(1-G.cloud):0;if(sun<.015&&moon<.015)return;
  const k=Math.floor(gameMin/4);if(k!==key){key=k;const c=tint.getContext('2d');c.globalCompositeOperation='copy';c.drawImage(mask,0,0);c.globalCompositeOperation='source-in';
    c.fillStyle=sun>moon?'rgb(64,112,255)':'rgb(120,150,220)';c.fillRect(0,0,W*K,H*K);c.globalCompositeOperation='destination-out';const v=castCover();if(v)c.drawImage(v,0,0,W*K,H*K)}
  ctx.globalCompositeOperation='color';ctx.globalAlpha=Math.min(.75,sun>moon?sun*3.4:moon*2.4);ctx.imageSmoothingEnabled=true;
  ctx.drawImage(tint,0,0,W*K,H*K,0,0,W*T,H*T);ctx.imageSmoothingEnabled=false;ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over'}
