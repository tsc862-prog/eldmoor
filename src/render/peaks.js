// Mountains as ranges (#989, after the LPC cliffs of #895): a height field over the mountain tiles, seen from the game's 3/4 view. No tile, stamp or
// atlas piece decides a shape, so no two peaks repeat and no line of the tile grid survives:
//   footprint  the signed distance to the mountain tiles, wandering with noise: the foot of a massif is a shape, not steps
//   summits    irregular pyramids scattered over the footprint, each with its own sides, size and lean and one ridge turned to the viewer. Their
//              flat faces meet in real ridgelines; the highest of them at a point is the ground there, so saddles and gullies come for free
//   raster     raster() walks a tile's columns from the south up, each height lifting the ground up the screen: what stands in front hides what
//              stands behind and the silhouette is the height's own. A tile needs only what lies a peak's height south of it, so a chunk can
//              still be painted a row of tiles at a time (terrain.js paintRows, #990): nothing here is done for the whole map at once
//   colour     rock by slope from a ramp of palette.js PEAKS, ridges lit and gullies dark, strata and cracks on the faces, scree on the lower slopes
//              and rubble over the foot. Snow is a matter of height: the snowline falls with the cold of the country and rises with the ash, read
//              from biomes blurred across the massif, so a seam of two regions over a mountain is a slow change of rock and snowline, with no edge
//   sun        the chunks keep the art lit from the top left, as all art is. Which way a slope faces is noted at FACE pixels a tile as it is
//              painted, and shadows.js lays the sun's side on it (peakFaces): by the hour the east or west faces go into shade
// The three LPC atlases stay the switch: with none of this tier peakArt() is false and terrain.js paints the procedural mountain as before. Private
// noise from hashes of the place, no dice; reads the map's tiles only, so nothing here reaches the sim or the map hash. The peaks may rise a little
// over the tile north of a massif and rubble lies on the tiles round it; a walker on those tiles stands in front of them, as it should.
import {hash,vnoise} from '../core/rng.js';
import {TILE} from './tile.js';
import {W,H,PEAK} from '../world/tiles.js';
import {tiles,zone,I} from '../world/map.js';
import {biomeOfZone,PEAKS} from './palette.js';
import {assetPixels,onAssets} from './assets.js';

export const ASSET_PEAKS={};for(const s of ['stone','ash','snow'])ASSET_PEAKS['autotile:peak-'+s]=PEAK;
let on=null;
export function peakArt(){if(on===null)on=Object.keys(ASSET_PEAKS).every(id=>assetPixels(id));return on}
onAssets(()=>{on=null});

const Z=TILE/32,C=4*Z,CPT=TILE/C,GW=W*CPT+1,GH=H*CPT+1,MX=W*TILE-1,MY=H*TILE-1; // C: art pixels a cell of the height grid
const LC=2,LW=Math.ceil(W/LC)+1,LH=Math.ceil(H/LC)+1; // the lattice of summits, in tiles
const SPACING=1.8,FOOTHILL=1.1,TALLEST=5,SPILL=.8,APRON=.62,MAXR=TALLEST+1; // tiles; SPILL: how far a summit may rise past the tiles north of it
export const FACE=10;const FW=W*FACE,FH=H*FACE;
const TALL=1.5*TILE; // art pixels: what stands this high casts the long shadow
const clamp=(v,a,b)=>v<a?a:v>b?b:v,clampX=x=>clamp(x,0,W-1),clampY=y=>clamp(y,0,H-1);
let sd=null,cold=null,ashen=null,near=null,top=null,done=null,lat=null,hg=null,dg=null,rg=null,sg=null,east=null,west=null,mask=null,tall=null;
let dirty=null;

// Nearest-tile distance of every tile from where seed is true, in tiles (a chamfer, two passes). The map's rim is no seed: mountains run off the map.
function chamfer(seed){const a=new Float32Array(W*H).fill(1e4),D=Math.SQRT2;for(let i=0;i<W*H;i++)if(seed(i))a[i]=0;
  const pass=(y0,y1,s)=>{for(let y=y0;y!==y1;y+=s)for(let x=s>0?0:W-1;x>=0&&x<W;x+=s){const i=I(x,y);let v=a[i];
    if(x-s>=0&&x-s<W)v=Math.min(v,a[I(x-s,y)]+1);if(y-s>=0&&y-s<H){v=Math.min(v,a[I(x,y-s)]+1);if(x-s>=0&&x-s<W)v=Math.min(v,a[I(x-s,y-s)]+D);if(x+s>=0&&x+s<W)v=Math.min(v,a[I(x+s,y-s)]+D)}a[i]=v}};
  pass(0,H,1);pass(H-1,-1,-1);return a}
// A tile-grid field read between tile centres.
function at(a,x,y){const u=clamp(x-.5,0,W-1.001),v=clamp(y-.5,0,H-1.001),i=u|0,j=v|0,f=u-i,g=v-j,o=j*W+i;
  return (a[o]*(1-f)+a[o+1]*f)*(1-g)+(a[o+W]*(1-f)+a[o+W+1]*f)*g}
// The biome's share of the country round each tile.
function blurred(flag,r){const a=new Float32Array(W*H),b=new Float32Array(W*H);for(let i=0;i<W*H;i++)a[i]=flag(i)?1:0;const n=2*r+1;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){let s=0;for(let k=-r;k<=r;k++)s+=a[I(clampX(x+k),y)];b[I(x,y)]=s/n}
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){let s=0;for(let k=-r;k<=r;k++)s+=b[I(x,clampY(y+k))];a[I(x,y)]=s/n}return a}

function build(){
  const isPeak=i=>tiles[i]===PEAK,din=chamfer(i=>!isPeak(i)),dout=chamfer(isPeak);
  sd=new Float32Array(W*H);near=new Uint8Array(W*H);top=new Float32Array(W*H);done=new Uint8Array(W*H);
  for(let i=0;i<W*H;i++){sd[i]=isPeak(i)?din[i]-.5:.5-dout[i];if(dout[i]<1.5)near[i]=1;if(isPeak(i))top[i]=1.7*TILE}
  cold=blurred(i=>biomeOfZone(zone[i])==='tundra',4);ashen=blurred(i=>biomeOfZone(zone[i])==='ash',4);
  hg=new Float32Array(GW*GH);dg=new Float32Array(GW*GH).fill(-9);rg=new Uint8Array(GW*GH);sg=new Float32Array(GW*GH);
  lat=new Array(LW*LH).fill(null);
  const lift=(x,y)=>{let n=0,ty=Math.floor(y)-1;while(ty>=0&&tiles[I(clampX(Math.floor(x)),ty)]===PEAK){n++;ty--}return n+(y-Math.floor(y))+(ty<0?TALLEST:0)}; // how far the mountain tiles run north of a point
  const summit=(i,j,sp,small)=>{const x=(i+hash(i,j,751+small))*sp,y=(j+hash(i,j,753+small))*sp;
    if(x>=W||y>=H)return;const s=at(sd,x,y);if(s<(small?-.1:.1))return;
    const big=hash(i,j,755+small),R=small?.42+.42*big:Math.min(TALLEST,.62+s*(.3+.35*big)+big*big*big*1.3),h=Math.min(TALLEST,R*(1.5+.9*hash(i,j,757+small)),2.1*Math.max(s,.1)+.7,lift(x,y)+SPILL),
      n=3+Math.floor(hash(i,j,759+small)*3),ridge=Math.PI/2+(hash(i,j,761)-.5)*1.3,sides=[];
    for(let k=0;k<n;k++){const a=ridge+(k+.5)*2*Math.PI/n+(hash(i+k,j,763)-.5)*.5;sides.push(Math.cos(a),Math.sin(a),1/(R*(.72+.56*hash(i,j+k,765))))}
    const q={x,y,h,sides:new Float32Array(sides)},B=R*1.5+.6;
    for(let b=Math.max(0,Math.floor((y-B)/LC));b<=Math.min(LH-1,Math.floor((y+B)/LC));b++)for(let a=Math.max(0,Math.floor((x-B)/LC));a<=Math.min(LW-1,Math.floor((x+B)/LC));a++)(lat[b*LW+a]||(lat[b*LW+a]=[])).push(q);
    for(let b=Math.max(0,Math.floor(y-B));b<=Math.min(H-1,Math.floor(y+B));b++)for(let a=Math.max(0,Math.floor(x-B));a<=Math.min(W-1,Math.floor(x+B));a++)top[I(a,b)]=Math.max(top[I(a,b)],h*1.2*TILE)};
  for(let j=0;j*SPACING<H+SPACING;j++)for(let i=0;i*SPACING<W+SPACING;i++)summit(i,j,SPACING,0);
  for(let j=0;j*FOOTHILL<H+FOOTHILL;j++)for(let i=0;i*FOOTHILL<W+FOOTHILL;i++)summit(i,j,FOOTHILL,1000);
  east=new Uint8Array(FW*FH);west=new Uint8Array(FW*FH);mask=new Uint8Array(FW*FH);tall=new Uint8Array(FW*FH)}

// The heights of one tile's cells, once.
function fill(tx,ty){const n=I(tx,ty);if(done[n])return;done[n]=1;if(!near[n])return;
  for(let j=0;j<CPT;j++)for(let i=0;i<CPT;i++){const cx=tx*CPT+i,cy=ty*CPT+j,x=cx*C/TILE,y=cy*C/TILE,o=cy*GW+cx;
    const d=at(sd,x+(vnoise(x*.7,y*.7,771)-.5)*.7,y+(vnoise(x*.7,y*.7,773)-.5)*.7)+(vnoise(x*.42,y*.42,775)-.5)*.85+(vnoise(x*1.4,y*1.4,777)-.5)*.42+(vnoise(x*3.6,y*3.6,779)-.5)*.18+.14;
    dg[o]=d;if(d<-APRON)continue;
    const n=(vnoise(x*.8,y*.8,793)-.5)*.16,cl=at(cold,x,y),as=at(ashen,x,y);rg[o]=Math.round(clamp(as+n,0,1)*BLEND)*(BLEND+1)+Math.round(clamp(cl-n,0,1)*BLEND);sg[o]=(2.1-1.55*cl+4*as)*TILE;if(d<=0)continue;
    const jx=x+(vnoise(x*.9,y*.9,781)-.5)*.6+(vnoise(x*3,y*3,783)-.5)*.1,jy=y+(vnoise(x*.9,y*.9,785)-.5)*.6+(vnoise(x*3,y*3,787)-.5)*.1,L=lat[Math.floor(y/LC)*LW+Math.floor(x/LC)];
    let h=0;if(L)for(const q of L){const dx=jx-q.x,dy=jy-q.y,s=q.sides;let r=0;for(let k=0;k<s.length;k+=3){const v=(dx*s[k]+dy*s[k+1])*s[k+2];if(v>r)r=v}if(r<1){const v=q.h*(1-r);if(v>h)h=v}}
    const base=Math.min(d,1.3)*.34*(.6+.8*vnoise(x*1.1,y*1.1,789));if(base>h)h=base;
    const rid=1-Math.abs(2*vnoise(x*1.9,y*1.9,791)-1),rim=1-Math.exp(-d*1.7); // a mountain rises from its foot, it does not stand on it like a table, and a product keeps the tips sharp
    hg[o]=h*rim*(.97+.06*rid)*TILE}}
const hAt=(X,Y)=>{const u=clamp(X,0,MX)/C,v=clamp(Y,0,MY)/C,i=u|0,j=v|0,f=u-i,g=v-j,o=j*GW+i;return (hg[o]*(1-f)+hg[o+1]*f)*(1-g)+(hg[o+GW]*(1-f)+hg[o+GW+1]*f)*g};
const dAt=(X,Y)=>{const u=clamp(X,0,MX)/C,v=clamp(Y,0,MY)/C,i=u|0,j=v|0,f=u-i,g=v-j,o=j*GW+i;return (dg[o]*(1-f)+dg[o+1]*f)*(1-g)+(dg[o+GW]*(1-f)+dg[o+GW+1]*f)*g};

const P=TILE+2,seen=new Int32Array(P*P),buf=new Array(TILE*TILE).fill(null); // seen: the ground row + 1 each pixel of the tile and its rim shows, 0 the bare ground
const STONE=4*Z,DEPTH=9*Z; // a step in ground rows past this is one ridge standing in front of another: an outline
let full=false; // this tile drew something
// The rock of a country, by its share of ash and of cold: the ramps of palette.js mixed in BLEND steps, so a seam across a massif is a change of colour, never an edge.
const BLEND=6,hexOf=c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)),toHex=v=>'#'+v.map(n=>Math.round(n).toString(16).padStart(2,'0')).join('');
const ROCK=[];for(let a=0;a<=BLEND;a++)for(let c=0;c<=BLEND;c++){const wa=a/BLEND,wc=(1-wa)*c/BLEND,ws=1-wa-wc;
  ROCK.push(PEAKS.stone.map((s,i)=>{const p=hexOf(s),q=hexOf(PEAKS.ash[i]),r=hexOf(PEAKS.frost[i]);return toHex(p.map((v,k)=>v*ws+q[k]*wa+r[k]*wc))}))}
const cellOf=(X,Y)=>((clamp(Y,0,MY)/C)|0)*GW+((clamp(X,0,MX)/C)|0);
const ramp=(r,t)=>r[clamp((t*r.length)|0,0,r.length-1)];
function raster(tx,ty){const X0=tx*TILE,Y0=ty*TILE;full=false;
  let rs=0;for(let r=1;r<=MAXR&&ty+r<H;r++)for(let c=-1;c<=1;c++){const x=tx+c;if(x>=0&&x<W&&top[I(x,ty+r)]>(r-1)*TILE)rs=r}
  for(let y=Math.max(0,ty-1);y<=Math.min(H-1,ty+rs+1);y++)for(let x=Math.max(0,tx-1);x<=Math.min(W-1,tx+2);x++)fill(x,y);
  seen.fill(0);
  for(let c=0;c<P;c++){const X=X0+c-1;let cur=Y0+TILE+1;
    for(let g=Y0+(rs+1)*TILE;g>=Y0-1;g--){const h=hAt(X,g);
      if(h>.5){const t=Math.ceil(g-h);if(t<cur){for(let y=Math.max(t,Y0-1);y<cur;y++)seen[(y-Y0+1)*P+c]=g+1;cur=t}}
      else if(g<cur)cur=g;
      if(cur<=Y0-1)break}}
  for(let r=0;r<TILE;r++)for(let c=0;c<TILE;c++){const X=X0+c,Y=Y0+r,s=(r+1)*P+c+1,v=seen[s];let col=null;
    if(v===0){const d=dAt(X,Y);if(d>-APRON&&d<=.2){const e=1+Math.min(d,0)/APRON,k=Math.floor(X/STONE),m=Math.floor(Y/STONE),u=((X-k*STONE)/Z)|0,w=((Y-m*STONE)/Z)|0,clump=vnoise(X/(14*Z),Y/(14*Z),809); // a stone: three pixels square in a cell of four, its top corners off
      if(u<3&&w<3&&!(w===0&&u!==1)&&hash(k,m,795)<e*e*(.08+.7*clump*clump)){const n=cellOf(X,Y);col=ramp(ROCK[rg[n]],.38+hash(k,m,797)*.3+(w===0?.2:w===2?-.16:0)+(sg[n]<TILE?.22:0))}}}
    else{const g=v-1,h0=hAt(X,g),hl=hAt(X-C,g),hr=hAt(X+C,g),hu=hAt(X,g-C),hd=hAt(X,g+C),hx=(hr-hl)/(2*C),hy=(hd-hu)/(2*C),cur=(hl+hr+hu+hd-4*h0)/C,s2=hx*hx+hy*hy;
      const up=seen[s-P],dn=seen[s+P],lf=seen[s-1],rt=seen[s+1],edge=up===0||lf===0||rt===0||v-up>DEPTH||v-lf>DEPTH||v-rt>DEPTH;
      if(edge)col=PEAKS.line;else{
        const lit=(hx*.5+hy*.18+.8)/Math.sqrt(1+s2);
        let t=.06+lit*.86-clamp(cur,-1.4,.9)*.15+Math.min(h0/(3*TILE),1)*.1+(vnoise(X/(60*Z),h0/(3*Z),799)-.5)*.1+(vnoise(X/(5*Z),g/(9*Z),801)-.5)*.08+(hash(X,g,803)-.5)*.05;
        const low=h0<.3*TILE?1-h0/(.3*TILE):0;if(low>0)t+=(hash(X>>1,g>>1,805)-.5)*.5*low;
        if(dn===0)t-=.25;
        const n=cellOf(X,g),line=sg[n],sn=h0+(cur>0?cur*5*Z:0)-(s2>7?(s2-7)*5*Z:0); // the streaks of the snow's edge are worth their noise only near the line
        col=sn>line-.43*TILE&&sn+(vnoise(X/(9*Z),g/(26*Z),807)-.5)*.85*TILE>line?ramp(PEAKS.snow,t*1.15+.12):ramp(ROCK[rg[n]],t)}
      const f=Math.floor(Y*FACE/TILE)*FW+Math.floor(X*FACE/TILE);mask[f]=255;tall[f]=h0>TALL?255:tall[f];const q=clamp(hx*.8,-1,1)*255;east[f]=q<0?-q:0;west[f]=q>0?q:0}
    buf[r*TILE+c]=col;if(col)full=true}
  // the part of the sun's masks this tile wrote
  const a=Math.floor(X0*FACE/TILE),b=Math.floor(Y0*FACE/TILE);
  if(!dirty)dirty=[a,b,a+FACE,b+FACE];else{dirty[0]=Math.min(dirty[0],a);dirty[1]=Math.min(dirty[1],b);dirty[2]=Math.max(dirty[2],a+FACE);dirty[3]=Math.max(dirty[3],b+FACE)}}

let pk=-1;
// The colour of art pixel (ax,ay) of tile (tx,ty) from the mountains, or null where they leave the ground showing.
export function peakPixel(tx,ty,ax,ay){const k=ty*W+tx;
  if(!sd)build();
  if(k!==pk){pk=k;if(near[I(tx,ty)]||top[I(tx,clampY(ty+1))]>0)raster(tx,ty);else full=false}
  return full?buf[ay*TILE+ax]:null}
// What shadows.js needs of the mountains painted so far: the masks at FACE pixels a tile, and the box they changed in since it last asked (null: none).
export function peakFaces(){if(!sd)build();return {east,west,mask,tall}}
export function peakDirty(){const d=dirty;dirty=null;return d}
