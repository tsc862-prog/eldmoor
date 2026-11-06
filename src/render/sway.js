// Wind you can see (#979): one gust field over the map, read by the crowns and the grass. A gust is a slow wave rolling downwind with a faster one riding on it, stronger
// under the sky's wind (life.js WIND). Crowns are painted into the terrain chunks, so what sways is a copy of the crown laid over them, sheared from where the crown meets
// the trunk: a few dozen cheap blits at close views, none far out. Grass is a scatter of blades on grass tiles (a hash per tile, the list built once) that lean with
// the gust and catch the light on its crest, so a wind walks across a meadow. With no canopy art there is nothing to shear and the blades still move.
import {W,H,G as GRASS,FLOWER,SGRASS} from '../world/tiles.js';
import {tiles,I,zone} from '../world/map.js';
import {hash} from '../core/rng.js';
import {U as T,ART} from './tile.js';
import {treeAnchor,chunkGen} from './terrain.js';
import {F,skyAt,WIND} from './life.js';
import {biomeOfZone} from './palette.js';
import {ACTIVE_SPEC} from '../world/spec.js';
import {solid} from '../world/map.js';

export const gust=(x,y,t)=>.55*Math.sin(x*.31+y*.17-t*1.15)+.3*Math.sin(x*.83-y*.29-t*2.3)+.15*Math.sin(x*.13+t*.4);
const CROWN=.72; // the share of a tree's image, from the top, that sways
let rows=null,gen=-1,blades=null;
function buildTrees(){rows=Array.from({length:H},()=>[]);for(let y=0;y<H;y++)for(let x=0;x<W;x++){const a=treeAnchor(x,y);if(a)rows[y].push(a)}gen=chunkGen}
function buildBlades(){blades=Array.from({length:H},()=>[]);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const t=tiles[I(x,y)];if(t!==GRASS&&t!==FLOWER&&t!==SGRASS)continue;const b=biomeOfZone(zone[I(x,y)]),fen=t===SGRASS||b==='fen';
    if(hash(x,y,811)>.3)continue;const n=1+(hash(x,y,813)*3|0);for(let k=0;k<n;k++)blades[y].push((x+hash(x,y*3+k,817))*T,(y+hash(x,y*3+k,819))*T,2+hash(x+k,y,823)*2.5,fen?1:0)}}
let wind=.3,lean=1;
// The sheared crown of one tree over what is there. tf is the world transform.
function crown(ctx,tf,a,t){const g=gust(a.x,a.y,t),s=(.25+g*.75)*lean/ (a.h*CROWN),ih=a.im.naturalHeight*CROWN,base=a.ay+a.h*CROWN;
  ctx.setTransform(tf.a,0,-s*tf.a,tf.d,tf.e+s*base*tf.a,tf.f);ctx.drawImage(a.im,0,0,a.im.naturalWidth,ih,a.ax,a.ay,a.w,a.h*CROWN)}
export function drawSway(ctx,tf){if(F.tpx<30)return;if(!rows||gen!==chunkGen)buildTrees();const t=F.now;wind+=((WIND[skyAt((F.x0+F.x1)/2,(F.y0+F.y1)/2)]||.3)-wind)*.02;lean=.9+wind*2.2;
  const y0=Math.max(0,F.y0|0),y1=Math.min(H-1,Math.ceil(F.y1+3));
  for(let y=y0;y<=y1;y++){const R=rows[y];for(let i=0;i<R.length;i++){const a=R[i];if(a.x<F.x0||a.x>F.x1)continue;crown(ctx,tf,a,t)}}
  ctx.setTransform(tf)}
// A tree drawn again in front of someone sways with the rest.
export function swayTree(ctx,tf,a){if(F.tpx<30)return;crown(ctx,tf,a,F.now);ctx.setTransform(tf)}
// Wheat: stalks over a field's own art that only show on a gust's crest, so the ripple walks across it. From the spec's scenery note; a world with no fields has none.
let wheat=null;
function buildWheat(){wheat=Array.from({length:H},()=>[]);const S=ACTIVE_SPEC.scenery;for(const [fx,fy,fw,fh,kind] of (S&&S.fields)||[]){if(kind!=='wheat')continue;
  for(let y=fy;y<fy+fh&&y<H;y++)for(let x=fx;x<fx+fw&&x<W;x++){if(tiles[I(x,y)]!==GRASS&&tiles[I(x,y)]!==FLOWER||solid[I(x,y)])continue;for(let k=0;k<16;k++)wheat[y].push((x+hash(x,y*16+k,831))*T,(y+hash(x,y*16+k,833))*T)}}}
export function drawWheat(ctx){if(F.tpx<30)return;if(!wheat)buildWheat();const t=F.now,y0=Math.max(0,F.y0|0),y1=Math.min(H-1,Math.ceil(F.y1)),X0=F.x0*T,X1=F.x1*T;
  for(let p=0;p<2;p++){ctx.fillStyle=p?'#f6e08a':'#d8b84e';for(let y=y0;y<=y1;y++){const B=wheat[y];for(let i=0;i<B.length;i+=2){const x=B[i];if(x<X0||x>X1)continue;const g=gust(x/T,B[i+1]/T,t*1.4);
    if(g<.15||(g>.55)!==!!p)continue;const px=Math.round(x+g*lean),py=Math.round(B[i+1]);ctx.fillRect(px,py-3,1,3);ctx.fillRect(px+1,py-4,1,1)}}}}
const COL=['#4f9a42','#7a9650'],HI=['#86c262','#aebc6a'];
export function drawGrass(ctx){if(F.tpx<30)return;if(!blades)buildBlades();const t=F.now,y0=Math.max(0,F.y0|0),y1=Math.min(H-1,Math.ceil(F.y1)),X0=F.x0*T,X1=F.x1*T;
  for(let p=0;p<4;p++){ctx.fillStyle=p<2?COL[p]:HI[p-2];const fen=p&1,hi=p>=2;
    for(let y=y0;y<=y1;y++){const B=blades[y];for(let i=0;i<B.length;i+=4){if(B[i+3]!==fen)continue;const x=B[i];if(x<X0||x>X1)continue;const py=B[i+1],g=gust(x/T,py/T,t);if((g>.5)!==hi)continue;
      const l=Math.round((.3+g)*lean*.9),h=B[i+2],px=Math.round(x),yy=Math.round(py);ctx.fillRect(px,yy-1,1,1);ctx.fillRect(px+(l>>1),yy-(h>>1)-1,1,h>>1||1);ctx.fillRect(px+l,yy-h,1,1)}}}}
