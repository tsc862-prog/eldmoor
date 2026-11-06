// World preview (title screen and setup page): what a world is, read from its spec and its built map, for every entry
// of WORLDS, so a new world needs no UI edit. Interface only: nothing here is read by the sim.
//   worldFacts(id)            {name, blurb, size, regions, levels, towns: [{fac, n}], dungeons, line1, line2}
//   worldTowns(id, fac)       [{name, region, people, label}] for the Hall select (label: "Aldermere · Wendmouth · Hallowan")
//   worldPreview(id, cls)     a canvas; paints at once when the map is cached, else on the next tick
// The active world is read from world/map.js; any other is built once from its spec (buildWorld, about 20-60 ms) and
// only its small preview image is kept.
import {WORLDS,WORLD_ID} from '../world/spec.js';
import {buildWorld} from '../world/gen.js';
import {tiles as ATILES,zone as AZONE,CITY as ACITY,REGIONS as AREGIONS,LANDMARKS as ALAND} from '../world/map.js';
import {TREE,SWAMP,MUD,ROCK,PEAK,LAVA,ROAD,FLOOR,WALL,RIVER,BRIDGE,SGRASS,SNOW,ICE} from '../world/tiles.js';
import {BIOME,TILE_FLAT,MARK} from './palette.js';
import {FAC} from '../data/factions.js';
import {RACES} from '../data/races.js';

const BOX_W=320,BOX_H=200; // the preview's largest size in CSS px; the scale is a whole number so tiles stay square
const BY_TILE=[];
BY_TILE[SWAMP]=BY_TILE[MUD]=BY_TILE[SGRASS]=TILE_FLAT.swamp;BY_TILE[ROCK]=BY_TILE[PEAK]=TILE_FLAT.rock;BY_TILE[LAVA]=TILE_FLAT.lava;
BY_TILE[SNOW]=BY_TILE[ICE]=TILE_FLAT.snow;BY_TILE[RIVER]=TILE_FLAT.water;BY_TILE[ROAD]=BY_TILE[BRIDGE]=BY_TILE[FLOOR]=TILE_FLAT.road;BY_TILE[WALL]=TILE_FLAT.wall;
const rgbC={};const rgb=s=>rgbC[s]||(rgbC[s]=[parseInt(s.slice(1,3),16),parseInt(s.slice(3,5),16),parseInt(s.slice(5,7),16)]);

const specOf=id=>WORLDS[id]||null;
const modelC={}; // id -> {w,h,tiles,zone,CITY,REGIONS,LANDMARKS}
function model(id){if(modelC[id])return modelC[id];const spec=specOf(id);if(!spec)return null;
  if(id===WORLD_ID)return modelC[id]={w:spec.size.w,h:spec.size.h,tiles:ATILES,zone:AZONE,CITY:ACITY,REGIONS:AREGIONS,LANDMARKS:ALAND};
  const m=buildWorld(spec);return modelC[id]={w:m.w,h:m.h,tiles:m.tiles,zone:m.zone,CITY:m.CITY,REGIONS:m.REGIONS,LANDMARKS:m.LANDMARKS}}

const raceName=id=>{const r=RACES.find(x=>x.id===id);return r?r.name:''};
const facName=f=>(FAC[f]&&FAC[f].name)||('Faction '+(f+1));
const plural=(n,one,many)=>n+' '+(n===1?one:many||one+'s');

export function worldFacts(id){const sp=specOf(id);if(!sp)return null;
  const regs=sp.regions||[],towns=sp.towns||[],lands=sp.landmarks||[];
  const lows=regs.map(r=>r.band&&r.band[0]).filter(Number.isFinite),highs=regs.map(r=>r.band&&r.band[1]);
  const lo=lows.length?Math.min(...lows):1,open=highs.some(h=>h===Infinity||h==null),fin=highs.filter(Number.isFinite),hi=fin.length?Math.max(...fin):lo;
  const levels='levels '+lo+(open?' and up':' to '+hi);
  const byFac=[];for(const t of towns){const e=byFac.find(x=>x.fac===t.fac);if(e)e.n++;else byFac.push({fac:t.fac,n:1})}
  byFac.sort((a,b)=>a.fac-b.fac);
  const dungeons=lands.filter(l=>l.kind==='crypt').length;
  const sizeTxt=sp.size.w+' x '+sp.size.h+' tiles';
  const townTxt=plural(towns.length,'home town')+(byFac.length>1?' ('+byFac.map(x=>x.n+' '+facName(x.fac)).join(', ')+')':'');
  // A spec may carry its own `blurb`; else the line is read from its regions (first to last) and towns.
  const first=regs[0]&&regs[0].name,last=regs.length>1&&regs[regs.length-1].name;
  const blurb=sp.blurb||(regs.length?plural(regs.length,'region')+(last?' from '+first+' to '+last:' ('+first+')')+', '+plural(towns.length,'home town')+(dungeons?' and '+plural(dungeons,'dungeon'):'')+'.':'');
  return {id,name:sp.name||id,blurb,size:sizeTxt,regions:plural(regs.length,'region'),levels,towns:byFac,
    dungeons,line1:[sizeTxt,plural(regs.length,'region'),levels].join(' · '),line2:[townTxt,dungeons?plural(dungeons,'dungeon'):''].filter(Boolean).join(' · ')}}

// The towns of one faction in a world, for the Hall select: where each stands (its region) and whose it is.
export function worldTowns(id,fac){const sp=specOf(id);if(!sp)return [];const m=model(id);
  return (sp.towns||[]).filter(t=>fac==null||t.fac===fac).map(t=>{
    let region='';if(m){const c=m.CITY.find(x=>x.name===t.name),x=Math.floor(c?(c.x0+c.x1)/2:t.x0+t.w/2),y=Math.floor(c?(c.y0+c.y1)/2:t.y0+t.h/2),r=m.REGIONS[m.zone[y*m.w+x]];region=r?r.name:''}
    const people=raceName(t.race);
    return {name:t.name,region,people,label:[t.name,region,people].filter(Boolean).join(' · ')}})}

// Where an apart hero may set out in a world: its towns of one faction (fac null: all of them, #1025) and its regions with their low level, from the spec.
export function worldStarts(id,fac){const sp=specOf(id);if(!sp)return {towns:[],regions:[]};
  return {towns:(sp.towns||[]).filter(t=>fac==null||t.fac===fac).map(t=>t.name),regions:(sp.regions||[]).map(r=>({name:r.name,low:r.band?r.band[0]:null}))}}

// ---- the picture ----
const imgC={}; // id -> {cv, s} painted once
function paint(id){if(imgC[id])return imgC[id];const m=model(id);if(!m)return null;
  const s=Math.max(1,Math.min(Math.floor(BOX_W/m.w),Math.floor(BOX_H/m.h),6)),W=m.w*s,H=m.h*s;
  const cv=document.createElement('canvas');cv.width=W;cv.height=H;const c=cv.getContext('2d');if(!c)return imgC[id]={cv,s};
  const img=c.createImageData(W,H),d=img.data,DIM=.86;
  for(let y=0;y<m.h;y++)for(let x=0;x<m.w;x++){const k=y*m.w+x,t=m.tiles[k],r=m.REGIONS[m.zone[k]],b=BIOME[(r&&r.biome)||'meadow']||BIOME.meadow;
    const col=rgb(t===TREE?b.forest:(BY_TILE[t]||b.ground)),mul=t===RIVER||t===ROAD||t===BRIDGE?1:DIM;
    for(let dy=0;dy<s;dy++)for(let dx=0;dx<s;dx++){const o=((y*s+dy)*W+x*s+dx)*4;d[o]=col[0]*mul;d[o+1]=col[1]*mul;d[o+2]=col[2]*mul;d[o+3]=255}}
  c.putImageData(img,0,0);
  const edge=MARK.edge;
  for(const l of m.LANDMARKS||[]){ // dungeons and the lair: small dark squares with a pale core
    const x=Math.round(l.x*s),y=Math.round(l.y*s),q=Math.max(3,s+1);c.fillStyle=edge;c.fillRect(x-q,y-q,q*2,q*2);c.fillStyle=l.kind==='lair'?'#ff6a5a':'#d8c8f0';c.fillRect(x-q+1,y-q+1,q*2-2,q*2-2)}
  for(const t of m.CITY){ // home towns in their faction's colour, inside a dark edge, never smaller than a legible block
    const fc=FAC[t.fac]||FAC[0],w=Math.max(5,(t.x1-t.x0+1)*s),h=Math.max(5,(t.y1-t.y0+1)*s),x=Math.round((t.x0+t.x1+1)/2*s-w/2),y=Math.round((t.y0+t.y1+1)/2*s-h/2);
    c.fillStyle=edge;c.fillRect(x-1,y-1,w+2,h+2);c.fillStyle=fc.color;c.fillRect(x,y,w,h)}
  return imgC[id]={cv,s}}

// A canvas for `id`: sized now (so the layout never jumps), painted at once when the map is cheap to reach, else next tick.
export function worldPreview(id,cls){const c=document.createElement('canvas');if(cls)c.className=cls;c.setAttribute('role','img');
  const f=worldFacts(id);c.setAttribute('aria-label',f?'Map of '+f.name:'World map');
  const sp=specOf(id);if(!sp){return c}
  const s=Math.max(1,Math.min(Math.floor(BOX_W/sp.size.w),Math.floor(BOX_H/sp.size.h),6));c.width=sp.size.w*s;c.height=sp.size.h*s;
  const go=()=>{try{const p=paint(id);if(!p)return;const x=c.getContext('2d');if(x){x.imageSmoothingEnabled=false;x.drawImage(p.cv,0,0)}}catch(e){}};
  if(imgC[id]||id===WORLD_ID)go();else if(typeof setTimeout==='function')setTimeout(go,0);else go();
  return c}
