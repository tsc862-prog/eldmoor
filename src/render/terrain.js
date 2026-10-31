// Paints the whole map once into an offscreen canvas: a per-pixel procedural
// texture for every tile, then city buildings and the crypt mouth on top.
// Owned by world-builder (textures) together with render.
import {hash} from '../core/rng.js';
import {W,H,T,G,TREE,SWAMP,MUD,ROCK,PEAK,LAVA,ROAD,FLOOR,WALL,RIVER,BRIDGE,SGRASS,FLOWER,SNOW,ICE} from '../world/tiles.js';
import {tiles,zone,I,CITY} from '../world/map.js';
import {FAC} from '../data/factions.js';

const rgbC={};const rgb=s=>rgbC[s]||(rgbC[s]=[parseInt(s.slice(1,3),16),parseInt(s.slice(3,5),16),parseInt(s.slice(5,7),16)]);
const pk=(a,h)=>a[Math.floor(h*a.length)%a.length];
function grass(h){return h>.94?'#64b24e':pk(['#3f8a3a','#45923c','#3a8236','#41893a'],h)}

// Colour of pixel (px,py) inside tile (tx,ty) of type t.
export function texel(t,tx,ty,px,py){
  const h=hash(tx*8+px,ty*8+py,3);
  switch(t){
    case G:return grass(h);
    case FLOWER:return (px===3&&py===3)?(hash(tx,ty,9)>.5?'#f4e06a':'#f08ab0'):(px===3&&py===4)?'#2a6a28':grass(h);
    case TREE:{const dx=px-3.5,dy=py-3,r2=dx*dx+dy*dy*1.15;const zt=zone[I(tx,ty)],swamp=zt===1,frost=zt===3;
      if(frost){ // Hoarfell pine: dark blue-green spire under a snow cap, on snow
        const hw=.6+py*.55; if(py<=5&&Math.abs(dx)<hw){if(py<=1||(py<=3&&dx+py<-.8))return '#e4ecf4';return h>.85?'#2c5a4e':pk(['#1e3f3a','#24483f'],h)}
        if(py>=6&&(px===3||px===4))return '#3a2a20';
        return h>.9?'#c8d2de':pk(['#e2e8ee','#d8e0e8','#dde4ec'],h)}
      if(r2<10.5){if(dx+dy<-2.2)return swamp?'#5a7a3a':'#45a044';if(r2>7)return swamp?'#2a3a1e':'#174a1e';return h>.85?(swamp?'#4a6a30':'#2f7a33'):(swamp?'#3a5228':'#22612a')}
      if(py>=5&&(px===3||px===4))return '#5a3a20';
      return swamp?pk(['#46622f','#3d5729'],h):grass(h)}
    case SNOW:return h>.93?'#b8c2cc':h>.9?'#f0f4f8':pk(['#e2e8ee','#d8e0e8','#dde4ec'],h);
    case ICE:return ((px*2+py*3+tx*5+ty*7)%13===0)?'#8fb8c8':((px+py*2+tx)%11===0)?'#dff6fc':pk(['#b4dce8','#aad4e2','#bde2ec'],h);
    case SWAMP:return ((px+py*2+tx*3)%9===0)?'#5a8a6a':pk(['#2f5a4a','#2a5242','#335f4e'],h);
    case MUD:return h>.9?'#6e6a3e':pk(['#5b5a34','#545330','#4f4e2c'],h);
    case SGRASS:return (h>.86&&py<6)?'#7a9a46':pk(['#46622f','#3d5729','#42602c'],h);
    case ROCK:return h>.92?'#8a807a':pk(['#6e6460','#655c58','#5f5652'],h);
    case PEAK:{const top=1+Math.abs(px-3.5)*1.7;if(py>=top){if(py<top+1.3&&top<3.2)return '#e8e8f0';return px<3.5?'#9a908a':'#5a524e'}
      return pk(['#6e6460','#655c58'],h)}
    case LAVA:return h<.18?'#ffd04a':h<.55?'#f07a22':'#c8401a';
    case ROAD:return h>.9?'#c4a878':pk(['#a88c5c','#9f8455','#a68a58'],h);
    case FLOOR:return (px===0||py===0)?'#6a6a76':pk(['#8e8e9a','#86868f','#92929c'],h);
    case WALL:return (py%4===0||(px+(py>>2)*4)%8===0)?'#2e2a34':pk(['#5a5462','#544e5c'],h);
    case RIVER:return ((px*3+py+ty*5)%11===0)?'#8ab8f0':pk(['#2e5fb0','#3468b8','#3a70c4'],h);
    case BRIDGE:return (py===0||py===7)?'#4a2a14':(px%3===0)?'#6a4426':'#8a5a32';
  }return '#000'}

// Build and return the terrain canvas (W*T by H*T pixels).
export function buildTerrain(){
  const terrain=document.createElement('canvas');terrain.width=W*T;terrain.height=H*T;
  const tctx=terrain.getContext('2d');
  const img=tctx.createImageData(W*T,H*T),d=img.data;
  for(let ty=0;ty<H;ty++)for(let tx=0;tx<W;tx++){const t=tiles[I(tx,ty)];
    for(let py=0;py<T;py++)for(let px=0;px<T;px++){const c=rgb(texel(t,tx,ty,px,py)),o=((ty*T+py)*W*T+tx*T+px)*4;d[o]=c[0];d[o+1]=c[1];d[o+2]=c[2];d[o+3]=255}}
  tctx.putImageData(img,0,0);
  // city buildings: auction house (faction roof, gold sign) and quest hall, gate banners, graveyard stones
  for(const c of CITY){const f=FAC[c.fac],dy=c.dy*T;
    const bld=(x,y,roof,wall,sign)=>{tctx.fillStyle=roof;tctx.fillRect(x,y,24,7);tctx.fillStyle='#0008';tctx.fillRect(x,y+6,24,1);
      tctx.fillStyle=wall;tctx.fillRect(x+1,y+7,22,9);tctx.fillStyle='#3a2414';tctx.fillRect(x+10,y+10,4,6);
      tctx.fillStyle='#9ad0ff';tctx.fillRect(x+4,y+9,3,3);tctx.fillRect(x+17,y+9,3,3);
      if(sign){tctx.fillStyle=sign;tctx.fillRect(x+9,y+2,6,3)}};
    bld(32,24+dy,f.dark,'#c8b890','#f2c14e');bld(64,24+dy,'#6a4a3a','#b8a888');
    for(const gy of [5,8]){tctx.fillStyle='#3a2a1a';tctx.fillRect(12*T+3,gy*T+dy-6,1,10);tctx.fillStyle=f.color;tctx.fillRect(12*T+4,gy*T+dy-6,4,4)}
    tctx.fillStyle='#5a5a66';for(let i=0;i<3;i++)tctx.fillRect(4*T+i*6,8*T+dy+2,3,4);
  }
  // the Sunken Crypt mouth
  const x=43*T,y=41*T;tctx.fillStyle='#4a4652';tctx.fillRect(x+3,y+1,18,15);tctx.fillStyle='#78748a';tctx.fillRect(x+3,y+1,18,2);tctx.fillRect(x+3,y+1,2,15);tctx.fillRect(x+19,y+1,2,15);
  tctx.fillStyle='#0a0810';tctx.fillRect(x+8,y+6,8,10);tctx.fillStyle='#7ad0a0';tctx.fillRect(x+11,y+4,2,1);tctx.fillStyle='#e8e4d8';tctx.fillRect(x+6,y+14,2,2);tctx.fillRect(x+16,y+14,2,2);
  return terrain}
