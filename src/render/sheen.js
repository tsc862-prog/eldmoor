// Water stays water (#979): multiplying blue water by a warm hour gives grey mud, and any warm tint reads as a dirt road, so at a low sun the water is pushed the other way, to a strong blue the warm light brings down to slate. The gold on it is the glints' (water.js). One soft mask of the map's water,
// tinted to the hour (a few times a game hour, not every frame), laid on the ground before anyone stands on it, off whatever crowns overhang the water: at dawn and dusk, a cold moon sheen at night, nothing at noon. It changes the water's colour and keeps its light and dark. Reads tiles only.
// Once the sun has gone the push has nothing to fight: the ambient is violet, a strong blue survives it and the water outshines the land. So the blue follows the ambient's warmth down to a slate,
// and as the ambient dims the same tint is multiplied in, so the water falls with the land instead of staying a lit stripe through it.
import {W,H,RIVER,SWAMP,BRIDGE,ROAD} from '../world/tiles.js';
import {tiles,I} from '../world/map.js';
import {U as T} from './tile.js';
import {G} from './grade.js';
import {FX} from './quality.js';
import {castCover} from './shadows.js';
import {sceneryOn,waterLevel,bridgeDecks} from './scenery.js';
import {quayLip} from './harbour.js';
import {onWorld} from '../sim/kept.js';

const K=4; // mask pixels a tile
const SLATE=[92,108,158]; // the water's colour with no sun left to fight
let mask=null,tint=null,key=-1;
onWorld(()=>{mask=tint=null;key=-1}); // another map (#1013)
export const warmSheen=()=>{if(mask===null)build()};
const mk=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c};
function build(){const r=mk(W*K,H*K),x=r.getContext('2d');let any=false;x.fillStyle='#fff';
  for(let ty=0;ty<H;ty++)for(let tx=0;tx<W;tx++){const t=tiles[I(tx,ty)];if(t===RIVER||(t===BRIDGE&&sceneryOn)){x.fillRect(tx*K,ty*K,K,K);any=true}else if(t===SWAMP){x.globalAlpha=.5;x.fillRect(tx*K,ty*K,K,K);x.globalAlpha=1;any=true}}
  // in a scenery world the painted bank is a curve, not the tiles: left out of the mask, a warm hour turned that water green beside every bridge
  if(sceneryOn)for(let ty=0;ty<H;ty++)for(let tx=0;tx<W;tx++){const t=tiles[I(tx,ty)];if(t===BRIDGE||t===ROAD||t===RIVER)continue;let near=false;for(let j=-1;j<=1&&!near;j++)for(let i=-1;i<=1;i++){const u=tx+i,v=ty+j;if(u>=0&&v>=0&&u<W&&v<H&&tiles[I(u,v)]===RIVER){near=true;break}}if(!near)continue;
    for(let j=0;j<K;j++)for(let i=0;i<K;i++)if(waterLevel(tx+(i+.5)/K,ty+(j+.5)/K)>.6){x.fillRect(tx*K+i,ty*K+j,1,1);any=true}}
  const m=mk(W*K,H*K),o=m.getContext('2d');o.filter='blur(1.2px)';o.drawImage(r,0,0);o.filter='none';
  for(let ty=0;ty<H;ty++)for(let tx=0;tx<W;tx++)if(!sceneryOn&&tiles[I(tx,ty)]===BRIDGE)o.clearRect(tx*K-1,ty*K-1,K+2,K+2); // the blur spilled the water's blue over the deck
  for(const [x,y,w,h] of bridgeDecks())o.clearRect(x*K,y*K,w*K,h*K);
  for(const [x,y,h] of quayLip())o.clearRect(x*K,y*K-1,K,h*K+1);
  mask=any?m:false;tint=mk(W*K,H*K)}
// The tint at this hour: the low sun's colour, else the moon's. Strength in the alpha.
export function drawSheen(ctx,gameMin){if(!FX.full)return;if(mask===null)build();if(!mask)return;
  const sun=G.washA,moon=G.dk>.3?.1*(1-G.cloud):0;if(sun<.015&&moon<.015)return;
  const A=G.amb,warm=Math.max(0,Math.min(1,(A[0]-A[2])/115)),dim=Math.max(0,Math.min(1,(.86-(A[0]+A[1]+A[2])/765)/.34)),colour=sun>moon?.6*warm+.4*warm*warm:0;
  const k=Math.floor(gameMin/4);if(k!==key){key=k;const c=tint.getContext('2d'),m=(a,b)=>a+(b-a)*colour|0;c.globalCompositeOperation='copy';c.drawImage(mask,0,0);c.globalCompositeOperation='source-in';
    c.fillStyle=`rgb(${m(SLATE[0],64)},${m(SLATE[1],112)},${m(SLATE[2],255)})`;c.fillRect(0,0,W*K,H*K);c.globalCompositeOperation='destination-out';const v=castCover();if(v)c.drawImage(v,0,0,W*K,H*K)}
  ctx.imageSmoothingEnabled=true;ctx.globalCompositeOperation='color';ctx.globalAlpha=Math.min(.75,Math.max(sun*3.4,moon*4.4));ctx.drawImage(tint,0,0,W*K,H*K,0,0,W*T,H*T);
  if(dim>.02){ctx.globalCompositeOperation='multiply';ctx.globalAlpha=dim*.72;ctx.drawImage(tint,0,0,W*K,H*K,0,0,W*T,H*T)}
  ctx.imageSmoothingEnabled=false;ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over'}
