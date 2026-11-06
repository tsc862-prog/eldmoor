// Whole-map level of detail (#729). Below LOD_SC device pixels a world unit a 32x48 sprite is shrunk past its own art
// pixels (nearest neighbour drops every other one) and is about 15 px tall on the Stepping Lands: it costs a full sprite
// (a sheet lookup, a shadow, a scaled blit, a place in the y sort) to show mush, and that cost grows with the world. There
// the entity pass draws most of the world as marks instead: tiny pixel art at one device pixel a pixel, so it stays crisp
// at any fit scale, one unscaled blit a mark, batched by look, in no y order. A hero is an upright pawn in the faction
// colour of the UI and the minimap, so the two sides read at a glance across the map; a creature is its own small sprite
// (a wolf stays a wolf); townsfolk are small parchment figures. Marks go over the night wash, dimmed, so they do not sink.
// Full sprites stay for whoever the watcher is looking at: the selected and hovered heroes, the followed company and the
// Fellowship, agent-played heroes, elites and Kragmaw. Eldmoor's whole map (about 30 px sprites) never reaches the
// threshold. Render only: reads S and writes nothing to it. No per-frame allocation: the buckets are reused.
import {MOBS} from '../data/mobs.js';
import {FAC} from '../data/factions.js';
import {SPR,sprite,outlined,sheetFrame} from './sprites.js';
import {LOD,MARK} from './palette.js';
import {U} from './tile.js';
import {followed,slotted} from '../sim/company.js';

export const LOD_SC=1;
export const farMarks=(sc,cut)=>sc<LOD_SC&&!cut; // an outdoor scene frames a close cut whatever the scale

// townsfolk at home stand on one wall column a tile apart (sim homeAt): staggered over three lanes so they do not stack (#701)
export const homeLane=e=>e.kind==='npc'&&e.state==='home'&&!e.moving?((e.id%3)-1)*.6:0;

// E edge, S skin, B body, L its lit shoulder (light from the top left)
const PAWN=["..EEE..",".ESSSE.",".ESSSE.","ELLBBBE","EBBBBBE","EBBBBBE","EBBBBBE",".EEEEE."];
const FOLK=[".EEE.","EBBBE","EBBBE","EBBBE","EBBBE",".EEE."];
const look=(key,rows,body,lit)=>sprite('lod.'+key,rows,{E:MARK.edge,S:LOD.skin,B:body,L:lit||body});

// A bucket is one look {img, n, xy}: every mark of it is one run of blits from one source. Painted beasts, then people,
// then heroes, so a hero's mark is never cut by a creature. Looked up once per kind, never built per entity.
const bucket=img=>({img,n:0,xy:[]}),BEASTS=[],PEOPLE=[],HEROES=[],LAYERS=[BEASTS,PEOPLE,HEROES];
const put=(b,x,y)=>{const xy=b.xy;xy[b.n++]=x;xy[b.n++]=y};
let FACS=null,GHOST,PERSON,GRAVE;
function looks(){FACS=FAC.map((f,i)=>bucket(look('h'+i,PAWN,f.color,LOD.lit[i%LOD.lit.length])));GHOST=bucket(look('ghost',PAWN,LOD.ghost));
  PERSON=bucket(look('folk',FOLK,LOD.person));GRAVE=bucket(look('grave',FOLK,LOD.grave));HEROES.push(...FACS,GHOST);PEOPLE.push(PERSON,GRAVE)}
// A creature's mark is its procedural sprite, outlined: about the size the full sprite would have here. It looks one way,
// mirrored once for those that look the other.
function mirrored(c){const o=document.createElement('canvas');o.width=c.width;o.height=c.height;const x=o.getContext('2d');x.translate(c.width,0);x.scale(-1,1);x.drawImage(c,0,0);return o}
const beastOf={};
function beast(m){const p=beastOf[m.type]||(beastOf[m.type]=[null,null]),i=m.face<0?1:0;if(p[i])return p[i];
  const M=MOBS[m.type],c=outlined(sprite(m.type+'0',SPR[M.spr][0],M.col)),b=p[i]=bucket(i?mirrored(c):c);BEASTS.push(b);return b}

// Marks never ask for a sprite sheet, and a sheet only starts loading when asked for: one hero, one creature and one townsperson a frame
// asks here, so the sheets are in by the time the watcher zooms in.
let warmAt=0;
function warm(S){warmAt++;const a=S.agents,m=S.mobs,p=S.npcs;if(a.length)sheetFrame(a[warmAt%a.length],0,0);if(m.length)sheetFrame(m[warmAt%m.length],0,0);if(p&&p.length)sheetFrame(p[warmAt%p.length],0,0)}

// Queue the world's marks and push the entities that keep a full sprite onto out (draw.js's y-sorted list).
export function gatherFar(S,cam,inView,margin,out){if(!FACS)looks();warm(S);
  for(const L of LAYERS)for(const b of L)b.n=0;
  const sc=cam.sc*U,ox=cam.offX,oy=cam.offY,sel=cam.sel,hov=cam.hover,f=followed(),s=slotted(),fid=f?f.id:null,sid=s?s.id:null;
  for(const m of S.mobs){if(!m.alive||m.hidden||!inView(m.x*U,m.y*U,margin))continue;
    if(m.elite)out.push(m);else put(beast(m),Math.round(m.x*sc+ox),Math.round(m.y*sc+oy))}
  for(const p of S.npcs||[])if(inView(p.x*U,p.y*U,margin))put(PERSON,Math.round((p.x+homeLane(p))*sc+ox),Math.round(p.y*sc+oy));
  for(const a of S.agents){if(a.hidden||!inView(a.x*U,a.y*U,margin))continue;
    if(a===sel||a===hov||a.player||(a.company!=null&&(a.company===fid||a.company===sid))){out.push(a);continue}
    put(a.state==='dead'?GRAVE:a.state==='ghost'?GHOST:FACS[a.fac],Math.round(a.x*sc+ox),Math.round(a.y*sc+oy))}
  if(S.boss.alive&&inView(S.boss.x*U,S.boss.y*U,margin))out.push(S.boss)}

// Paint the queued marks in device pixels, each standing on its feet point, dimmed by the dark dk (0 to .55) so they still
// belong to the hour. The caller restores its camera transform.
export function drawMarks(ctx,dpr,dk){const k=Math.max(1,Math.round(dpr));ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1-dk*LOD.night;
  for(const L of LAYERS)for(const b of L){if(!b.n)continue;const I=b.img,w=I.width*k,h=I.height*k,x0=-(w>>1),xy=b.xy;
    for(let i=0;i<b.n;i+=2)ctx.drawImage(I,xy[i]+x0,xy[i+1]-h,w,h)}
  ctx.globalAlpha=1}
