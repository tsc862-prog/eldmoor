// Region view (#430): the overworld is seamless and watched region by region. The picker (ui/controls.js) sets
// cam.region (a region index, or null for all); the camera frames the region's box (render/draw.js, view 'region'),
// the panels filter to who and what is there, and the minimap dims the rest. Read-only over the world tables; the
// regions are looped over, never named here.
import {cam} from '../render/draw.js';
import {W,H} from '../world/tiles.js';
import {zone,I,ZONES,zoneAt} from '../world/map.js';

const boxes=[];
// Bounding box of a region in tiles {x,y,w,h} (centre x,y), from the zone grid; computed once per region.
export function regionBox(i){if(boxes[i])return boxes[i];let x0=W,y0=H,x1=-1,y1=-1;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(zone[I(x,y)]===i){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}
  return boxes[i]=x1<0?null:{x:(x0+x1+1)/2,y:(y0+y1+1)/2,w:x1-x0+1,h:y1-y0+1}}
export const regionList=()=>ZONES.map((name,i)=>({i,name}));
export const getRegion=()=>cam.region==null?null:cam.region;
export const regionName=()=>cam.region==null?'All regions':ZONES[cam.region]||'region '+cam.region;
const subs=[];export const onRegion=f=>subs.push(f);
export function setRegion(i){cam.region=i==null||!ZONES[i]?null:i;for(const f of subs)f(cam.region)}
// Is this thing (anything with x, y in tiles) in the picked region? Everything is, with none picked.
export const inRegion=o=>cam.region==null||(!!o&&zoneAt(o.x,o.y)===cam.region);
// A chronicle line: kept when no region is picked, when a hero it names is in it, when it names it, or when it names no hero (the world's).
export function regionLine(e){if(cam.region==null)return true;let named=false;
  for(const p of e.parts||[]){if(p&&typeof p==='object'&&typeof p.x==='number'&&typeof p.y==='number'){named=true;if(zoneAt(p.x,p.y)===cam.region)return true}
    else if(typeof p==='string'&&ZONES[cam.region]&&p.includes(ZONES[cam.region]))return true}
  return !named}
