// Gathering nodes (issue #255, epic #238): herb patches, ore veins, game trails to skin and fishing spots,
// placed from spec data per region. Pure and deterministic (cell hashes only, never the sim RNG), and an overlay:
// nodes are a list beside the map, never tiles, so the map hash is untouched. Owned by world-builder.
//
// Spec shape (spec.nodes, both worlds):
//   {respawn:{herb:min, ore:min, hide:min, fish:min},          game minutes until a harvested node is ready again
//    regions:{<region id>:{herb:n, ore:n, hide:n, fish:n}}}    how many of each kind the region holds
// A region with no entry holds none. The skill band of a node (0..3, matching professions.js skillBand and the
// MATERIALS bands of data/items.js) comes from the region's level band: see bandOf.
// Fish nodes stand on the shore (a walkable tile with river water 4-adjacent) and keep `water`, the tile they
// fish; nobody stands in the river. Never on a road, bridge, town pad or landmark exclusion.
import {hash} from '../core/rng.js';
import {G,TREE,MUD,ROCK,PEAK,ROAD,RIVER,BRIDGE,SGRASS,FLOWER,SNOW,ICE,WALKABLE} from './tiles.js';

export const NODE_KINDS=['herb','ore','hide','fish']; // fixed order: placement and ids never depend on object key order
export const NODE_NAMES={herb:'Herb patch',ore:'Ore vein',hide:'Game trail',fish:'Fishing spot'};
// Tiles each kind prefers (tried first); a region without enough of them falls back to any other walkable tile.
const PREFER={herb:[FLOWER,G,SGRASS,MUD,SNOW],ore:[ROCK,PEAK],hide:[G,SGRASS,MUD,SNOW,ROCK,TREE,ICE]};
const SPACE={herb:3,ore:3,hide:4,fish:4}; // minimum tiles between two nodes of the same kind
const SPACE_ANY=2;                         // ...and between any two nodes

// Skill band of a node from its region's level band: the middle of the band on a ladder of five levels a step,
// capped at 3 (the open-ended top region counts as lo+4). Eldmoor: Thornvale 0, Mirefen 1, Cinderpass 2, Hoarfell 3.
export function bandOf(band){const lo=band[0],hi=Number.isFinite(band[1])?band[1]:lo+4;
  return Math.max(0,Math.min(3,Math.floor(((lo+hi)/2-1)/5)))}

export function placeNodes(world,spec){
  const cfg=spec.nodes;if(!cfg||!cfg.regions)return[];
  const {tiles,zone,w,h,I,REGIONS,CITY,LANDMARKS}=world;
  const pad=(spec.spawn&&spec.spawn.townPad)||[4,3];
  const excl=LANDMARKS.filter(l=>l.exclude>0).map(l=>l.mouth?{x:(l.mouth.x0+l.mouth.x1+1)/2,y:(l.mouth.y0+l.mouth.y1+1)/2,r:l.exclude}:{x:l.x,y:l.y,r:l.exclude});
  const walk=new Set(WALKABLE);
  const free=(x,y)=>{const t=tiles[I(x,y)];if(!walk.has(t)||t===ROAD||t===BRIDGE)return false;
    for(const c of CITY)if(x>=c.x0-pad[0]&&x<=c.x1+pad[0]&&y>=c.y0-pad[1]&&y<=c.y1+pad[1])return false;
    for(const e of excl)if(Math.hypot(x+.5-e.x,y+.5-e.y)<e.r)return false;return true};
  const waterOf=(x,y)=>{for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;
    if(nx>=0&&ny>=0&&nx<w&&ny<h&&tiles[I(nx,ny)]===RIVER)return{x:nx,y:ny}}return null};
  const out=[];
  const apart=(x,y,kind)=>{for(const n of out){const d=Math.hypot(n.tx-x,n.ty-y);if(d<SPACE_ANY||(n.kind===kind&&d<SPACE[kind]))return false}return true};
  REGIONS.forEach((r,zi)=>{const want=cfg.regions[r.id];if(!want)return;
    const band=bandOf(r.band||[1,Infinity]);
    const cand=[];for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++)if(zone[I(x,y)]===zi&&free(x,y))cand.push({x,y,t:tiles[I(x,y)]});
    NODE_KINDS.forEach((kind,ki)=>{const n=want[kind]|0;if(n<=0)return;
      const pool=kind==='fish'?cand.filter(c=>waterOf(c.x,c.y)):cand;
      const sorted=pool.map(c=>({c,k:hash(c.x,c.y,977+ki*13+zi)})).sort((a,b)=>a.k-b.k||a.c.y-b.c.y||a.c.x-b.c.x).map(o=>o.c);
      let tier=[sorted];
      if(PREFER[kind]){const pf=new Set(PREFER[kind]);tier=[sorted.filter(c=>pf.has(c.t)),sorted.filter(c=>!pf.has(c.t)&&c.t!==PEAK)]}
      let placed=0;
      for(const list of tier)for(const c of list){if(placed>=n)break;
        if(!apart(c.x,c.y,kind))continue;
        const node={id:r.id+':'+kind+':'+placed,kind,name:NODE_NAMES[kind],x:c.x+.5,y:c.y+.5,tx:c.x,ty:c.y,z:zi,region:r.id,band,
          respawn:(cfg.respawn&&cfg.respawn[kind])||240};
        if(kind==='fish')node.water=waterOf(c.x,c.y);
        out.push(node);placed++}
    })});
  return out}

// Lookups over a node list (a coarse grid, so a 20x bigger world stays cheap). map.js builds the active world's.
export function indexNodes(list,w,h){
  const CELL=8,cw=Math.ceil(w/CELL)+1,cells=new Map();
  const cx=x=>Math.max(0,Math.floor(x/CELL)),key=(i,j)=>j*cw+i;
  for(const n of list){const k=key(cx(n.x),cx(n.y));if(!cells.has(k))cells.set(k,[]);cells.get(k).push(n)}
  const byId=new Map(list.map(n=>[n.id,n]));
  return{
    nodeById:id=>byId.get(id)||null,
    // all nodes of a region (zone index), in id order; optionally one kind
    nodesIn:(zone,kind)=>list.filter(n=>n.z===zone&&(!kind||n.kind===kind)),
    // nodes within r tiles of (x,y), nearest first; optionally one kind
    nodeNear:(x,y,r,kind)=>{const out=[];
      for(let j=cx(y-r);j<=cx(y+r);j++)for(let i=cx(x-r);i<=cx(x+r);i++)for(const n of cells.get(key(i,j))||[]){
        const d=Math.hypot(n.x-x,n.y-y);if(d<=r&&(!kind||n.kind===kind))out.push([d,n])}
      return out.sort((a,b)=>a[0]-b[0]||(a[1].id<b[1].id?-1:1)).map(o=>o[1])}}}
