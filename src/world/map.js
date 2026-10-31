// The map: tile and zone arrays, zone boundaries, cities, roads, the river,
// the Sunken Crypt entrance, Kragmaw's lair, spawn points, lights and labels.
// Pure data built once at import time. Owned by world-builder.
import {hash,vnoise,fbm,clamp,pickA} from '../core/rng.js';
import {W,H,G,TREE,SWAMP,MUD,ROCK,PEAK,LAVA,ROAD,FLOOR,WALL,RIVER,BRIDGE,SGRASS,FLOWER,SNOW,ICE,WALKABLE} from './tiles.js';

export const tiles=new Uint8Array(W*H), zone=new Uint8Array(W*H), I=(x,y)=>y*W+x;
export const riverX=y=>26+Math.round(Math.sin(y/5)*1.6+Math.sin(y/2.3+1)*.7);
export const z2X=y=>53+Math.round((vnoise(3.3,y/4,5)-.5)*7);
// Hoarfell: the frozen north, east of the river. Southern edge wanders between y=9 and y=15 (never past 16, so Kragmaw's lair stays in Cinderpass).
export const hoarY=x=>12+Math.round((vnoise(x/4,2.7,17)-.5)*6);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const z=x<riverX(y)?0:y<hoarY(x)?3:x<z2X(y)?1:2; zone[I(x,y)]=z;
  const n=fbm(x,y,11),n2=fbm(x+50,y+20,23); let t;
  if(z===0)t=n>.58?TREE:(hash(x,y,5)>.95?FLOWER:G);
  else if(z===1)t=n>.6?SWAMP:n2>.63?TREE:(hash(x,y,6)>.5?SGRASS:MUD);
  else if(z===3)t=n>.68?PEAK:n2>.64?TREE:vnoise(x/2.5,y/2.5,31)>.74?ICE:hash(x,y,8)>.94?ROCK:SNOW;
  else t=n>.6?PEAK:n2>.66?LAVA:ROCK;
  if(x===riverX(y)||x===riverX(y)+1)t=RIVER;
  tiles[I(x,y)]=t;
}
export const ZONES=['Thornvale','Mirefen','Cinderpass','Hoarfell'];

function mkCity(name,fac,dy){return{name,fac,x0:2,x1:12,y0:2+dy,y1:10+dy,ah:{x:5.5,y:5.8+dy},qg:{x:9.5,y:5.8+dy},
  gate:{x:13.8,y:7+dy},grave:{x:10.5,y:8.2+dy},dy}}
export const CITY=[mkCity('Highgate',0,0),mkCity('Grimhold',1,37)];
for(const c of CITY){
  for(let y=c.y0;y<=c.y1;y++)for(let x=c.x0;x<=c.x1;x++)
    tiles[I(x,y)]=(x===c.x0||x===c.x1||y===c.y0||y===c.y1)?WALL:FLOOR;
  tiles[I(12,6+c.dy)]=FLOOR;tiles[I(12,7+c.dy)]=FLOOR;
}
export const LAIR={x:71.5,y:25.5};
for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const r=Math.hypot(x+.5-LAIR.x,y+.5-LAIR.y);
  if(r<=4)tiles[I(x,y)]=ROCK;
  else if(r<=5.4)tiles[I(x,y)]=(x<LAIR.x-3&&Math.abs(y+.5-LAIR.y)<1.6)?ROCK:LAVA;
}
export function road(pts){for(let i=0;i<pts.length-1;i++){const[a,b]=[pts[i],pts[i+1]];const n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])*3);
  for(let k=0;k<=n;k++){const x=Math.round(a[0]+(b[0]-a[0])*k/n),y=Math.round(a[1]+(b[1]-a[1])*k/n),t=tiles[I(x,y)];
    if(t===RIVER)tiles[I(x,y)]=BRIDGE;else if(t!==FLOOR&&t!==WALL&&t!==BRIDGE)tiles[I(x,y)]=ROAD;}}}
road([[13,6.5],[20,9],[29,17],[40,25]]);road([[13,43.5],[20,41],[29,33],[40,25]]);road([[40,25],[50,23],[60,26],[67,25.4]]);
export const CRYPT={name:'The Sunken Crypt',boss:'Lich-Warden Vesk',x:44.5,y:43.1,group:null,cd:25};
for(let y=41;y<=43;y++)for(let x=43;x<=45;x++)tiles[I(x,y)]=ROCK;
road([[40,25],[38,33],[44,43.4]]);
road([[40,25],[46,17],[52,8]]); // north road into Hoarfell

// Level ladder: which zone a hero of a given level hunts in.
export const zoneFor=l=>l<6?0:l<11?1:l<16?2:3;
export const zoneAt=(x,y)=>zone[I(clamp(Math.floor(x),0,W-1),clamp(Math.floor(y),0,H-1))];
export const tileAt=(x,y)=>tiles[I(clamp(Math.floor(x),0,W-1),clamp(Math.floor(y),0,H-1))];
export const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

// Spawn and hunting points per zone, away from cities, the lair and the crypt mouth.
export const ZPTS=[[],[],[],[]];
for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const t=tiles[I(x,y)];
  if(WALKABLE.indexOf(t)<0)continue;
  if(x<17&&(y<14||y>35))continue;
  if(Math.hypot(x+.5-LAIR.x,y+.5-LAIR.y)<7.5)continue;
  if(Math.hypot(x+.5-44.5,y+.5-42.5)<3.5)continue;
  ZPTS[zone[I(x,y)]].push({x:x+.5,y:y+.5})}
export function zonePoint(z,near){const L=ZPTS[z];if(near){for(let i=0;i<14;i++){const p=pickA(L);if(Math.hypot(p.x-near.x,p.y-near.y)<7)return{...p}}}return{...pickA(L)}}

// Night-time light sources (city torches and the lair glow) and whole-map labels.
export const LIGHTS=[];for(const c of CITY){LIGHTS.push({x:12.5,y:5.4+c.dy},{x:12.5,y:8.4+c.dy},{x:6,y:5+c.dy},{x:10,y:5+c.dy})}
LIGHTS.push({x:LAIR.x,y:LAIR.y,big:1});
export const LABELS=[['THORNVALE',14,24],['MIREFEN',38,19],['CINDERPASS',63,18],['HOARFELL',52,5],['HIGHGATE',7.5,1.4],['GRIMHOLD',7.5,49.2]];
