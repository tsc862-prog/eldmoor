// The interior of a DM-made dungeon site (#642; the sites are sim/sites.js, #69): the dungeon view's chamber map
// (world/interior.js buildInterior, the same plan the Sunken Crypt uses: chambers in their order down from the stair)
// dressed in the site's theme. Read-only and DOM-free; the art is render/siteprops.js and render/interior.js.
//
//   siteInterior(site) -> the interior of buildInterior plus {theme: 'site-<theme>' (render/palette.js THEMES),
//                         style: {floor, wall, hall}}, with its own tiles (cave walls for a mine or a den) and props
//   roomKind(site, i)  -> 'guard' | 'trap' | 'puzzle' | 'shrine' | 'treasure' | 'boss' (from the room's id, sim/sites.js)
//   SITE_LOOK          per theme: floor and wall styles, cave carving, and what each kind of chamber holds
//
// A theme's look: barrow (turf-brown stone, grave niches in the walls, bones, a sarcophagus), fortress (cobbles and brick,
// banners, weapon racks, barrels, a throne), temple (pale sandstone, pillars, candles, an altar between idols), mine
// (dirt and rock, rails down the corridors, shoring, ore carts and piles, a glowing seam), den (rounded caves of mossy
// earth, roots, nests and bones), ruin (burnt stone, rubble, broken columns, grass in the cracks, a ruined throne).
// Deterministic: dressed with a small generator seeded by the interior's seed and the theme, never the sim's dice,
// and cached per interior, so it costs nothing per frame and moves no seeded hash.
import {buildInterior,IT} from '../world/interior.js';

const KINDS=['guard','trap','puzzle','shrine','treasure','boss'];
export const roomKind=(site,i)=>{const r=site&&site.rooms&&site.rooms[i];if(!r)return 'guard';if(r.boss)return 'boss';
  const k=String(r.id||'').replace(/\d+$/,'');return KINDS.includes(k)?k:'guard'};

// wall: pieces hung on the wall face over the chamber's top row (every `gap` tiles); edge: pieces on the chamber's rim
// (top row first, then the sides and the bottom); boss: the piece on the dais and the pair either side of it.
export const SITE_LOOK={
  barrow:{floor:'flag',wall:'rock',
    room:{guard:{wall:['niche'],gap:2,edge:['bones','bones','urn']},trap:{wall:['niche'],gap:3,edge:['rubble','bones']},puzzle:{edge:['idol','candle','candle']},
      shrine:{edge:['candle','candle','offering','candle']},treasure:{edge:['chest','urn','urn','chest']}},
    boss:{mid:'sarcophagus',side:'brazier',wall:['niche'],gap:3,edge:['bones','bones']}},
  fortress:{floor:'cobble',wall:'brick',
    room:{guard:{wall:['banner','sconce'],gap:2,edge:['weapons','barrel','crate','barrel']},trap:{wall:['sconce'],gap:3,edge:['rubble','crate']},
      puzzle:{wall:['sconce'],gap:3,edge:['chains','crate']},shrine:{wall:['sconce'],gap:4,edge:['offering','candle','sack']},
      treasure:{wall:['sconce'],gap:4,edge:['chest','chest','crate','sack','barrel']}},
    boss:{mid:'throne',side:'sconce',sideWall:true,wall:['banner'],gap:2,edge:['weapons','barrel']}},
  temple:{floor:'flag',wall:'brick',
    room:{guard:{pillars:true,edge:['candle','urn']},trap:{edge:['rubble','candle']},puzzle:{edge:['idol','candle','candle']},
      shrine:{edge:['basin','candle','candle','offering']},treasure:{edge:['chest','urn','chest','urn']}},
    boss:{mid:'altar',side:'idol',edge:['candle','candle','candle','candle']}},
  mine:{floor:'dirt',wall:'rock',hall:'dirt',cave:1,rails:true,
    room:{guard:{wall:['shoring'],gap:3,edge:['cart','ore','lantern','ore']},trap:{wall:['shoring'],gap:2,edge:['rubble','ore']},
      puzzle:{wall:['shoring'],gap:3,edge:['chains','crate','lantern']},shrine:{wall:['shoring'],gap:4,edge:['offering','candle','lantern']},
      treasure:{wall:['shoring'],gap:4,edge:['ore','chest','ore','cart']}},
    boss:{mid:'crystal',side:'crystal',wall:['shoring'],gap:3,edge:['ore','ore']}},
  den:{floor:'dirt',wall:'rock',hall:'dirt',cave:2,
    room:{guard:{wall:['roots'],gap:3,edge:['bones','nest','bones']},trap:{wall:['roots'],gap:2,edge:['rubble','bones']},puzzle:{wall:['roots'],gap:2,edge:['rubble','rubble']},
      shrine:{wall:['roots'],gap:3,edge:['basin','grass','grass']},treasure:{wall:['roots'],gap:3,edge:['bones','chest','bones','bones']}},
    boss:{mid:'nest',side:'bones',wall:['roots'],gap:2,edge:['bones','bones','bones']}},
  ruin:{floor:'cobble',wall:'rock',grass:true,
    room:{guard:{edge:['stump','rubble','stump','rubble']},trap:{edge:['rubble','rubble','stump']},puzzle:{edge:['crate','rubble','candle']},
      shrine:{edge:['idol','candle','grass']},treasure:{edge:['chest','rubble','chest']}},
    boss:{mid:'throne',side:'candle',edge:['stump','rubble','stump']}},
};

const strSeed=s=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0};
function prng(seed){let s=seed>>>0;return()=>{s=(s+0x6D2B79F5)|0;let t=Math.imul(s^s>>>15,1|s);t=(t+Math.imul(t^t>>>7,61|t))^t;return((t^t>>>14)>>>0)/4294967296}}

const cache=new WeakMap(); // base interior -> {theme: dressed}
export function siteInterior(site){const base=buildInterior(site),th=SITE_LOOK[site.theme]?site.theme:'ruin';
  let per=cache.get(base);if(!per)cache.set(base,per={});if(per[th])return per[th];
  const L=SITE_LOOK[th],w=base.w,h=base.h,tiles=new Uint8Array(base.tiles),reg=base.reg,I=(x,y)=>y*w+x,R=prng(base.seed^strSeed(th));
  const at=(x,y)=>x<0||y<0||x>=w||y>=h?IT.VOID:tiles[I(x,y)];
  const way=t=>t===IT.DOOR||t===IT.HALL||t===IT.STAIR;
  const nearWay=(x,y)=>way(at(x,y))||way(at(x+1,y))||way(at(x-1,y))||way(at(x,y+1))||way(at(x,y-1));
  // 1. caves: a mine's chambers lose their corners, a den's its corners and a share of its top and bottom rows (never beside a way in)
  if(L.cave)for(const m of base.rooms){const x1=m.x+m.w-1,y1=m.y+m.h-1;
    const cut=(x,y)=>{if(at(x,y)===IT.FLOOR&&!nearWay(x,y))tiles[I(x,y)]=IT.WALL};
    cut(m.x,m.y);cut(x1,m.y);cut(m.x,y1);cut(x1,y1);
    if(L.cave>1&&m.w>=7){for(let x=m.x+1;x<x1;x++){if(R()<.3)cut(x,m.y);if(R()<.3)cut(x,y1)} // the sides stay whole: the party and the foes stand in rows across
      cut(m.x+1,m.y);cut(x1-1,y1)}}
  // 2. the props: rails down a mine's corridors, then each chamber's dressing by its kind
  const props=[],taken=new Set(),key=(x,y)=>x+','+y,put=(x,y,kind)=>{taken.add(key(x,y));props.push({x,y,kind})};
  if(L.rails)for(let y=0;y<h;y++)for(let x=0;x<w;x++){const t=at(x,y);if(t!==IT.HALL)continue;
    const hz=at(x-1,y)===IT.HALL||at(x+1,y)===IT.HALL||at(x-1,y)===IT.DOOR||at(x+1,y)===IT.DOOR,vt=at(x,y-1)===IT.HALL||at(x,y+1)===IT.HALL||at(x,y-1)===IT.DOOR||at(x,y+1)===IT.DOOR;
    props.push({x,y,kind:vt&&!hz?'railv':'railh'})}
  const free=(x,y)=>at(x,y)===IT.FLOOR&&!nearWay(x,y)&&!taken.has(key(x,y));
  const face=(x,y)=>at(x,y)===IT.WALL&&at(x,y+1)===IT.FLOOR&&!way(at(x-1,y))&&!way(at(x+1,y))&&!taken.has(key(x,y));
  for(const m of base.rooms){const kind=m.boss?'boss':roomKind(site,m.i),D=m.boss?L.boss:(L.room[kind]||L.room.guard),x1=m.x+m.w-1,y1=m.y+m.h-1;
    if(m.boss){const dx=Math.floor(m.cx),dy=m.y+1;put(dx,dy,D.mid);
      for(const sx of [dx-3,dx+3]){if(D.sideWall){if(face(sx,m.y-1))put(sx,m.y-1,D.side)}else if(at(sx,dy)===IT.FLOOR||at(sx,dy)===IT.DAIS)put(sx,dy,D.side)}}
    // wall pieces along the face over the top row, from a random start, every `gap` tiles
    if(D.wall){const g=D.gap||3;let j=0;for(let x=m.x+Math.floor(R()*g);x<=x1;x+=g){if(m.boss&&Math.abs(x-Math.floor(m.cx))<=1)continue;if(face(x,m.y-1)){put(x,m.y-1,D.wall[j%D.wall.length]);j++}}}
    // a temple's pillars: two rows inside the long walls
    if(D.pillars&&m.w>=6)for(let x=m.x+1;x<x1;x+=2)for(const y of [m.y+1,y1-1])if(free(x,y)&&at(x,y)===IT.FLOOR)put(x,y,'pillar');
    // the rim: the top-left corner first, then the sides, then the bottom; never the middle the party and foes use, nor the
    // top-right tile (the cleared badge)
    if(D.edge){const spots=[];const add=(x,y)=>{if(free(x,y)&&!(m.boss&&y<=m.y+2&&Math.abs(x-m.cx)<4))spots.push([x,y])};
      add(m.x,m.y);for(let y=m.y+1;y<y1;y++){add(m.x,y);add(x1,y)}add(m.x,y1);add(x1,y1);for(let x=m.x+1;x<x1;x++)add(x,y1);
      for(let k=spots.length-1;k>0;k--){const j=Math.floor(R()*(k+1));const t=spots[k];spots[k]=spots[j];spots[j]=t}
      spots.sort((a,b)=>(a[1]===m.y?0:a[1]===y1?2:1)-(b[1]===m.y?0:b[1]===y1?2:1)); // stable after the shuffle: the top row first
      const n=Math.min(D.edge.length,spots.length,Math.max(2,Math.floor((m.w+m.h)/3)));for(let k=0;k<n;k++){const [x,y]=spots[k];if(free(x,y))put(x,y,D.edge[k])}}
    // grass in a ruin's cracks
    if(L.grass){const k=1+Math.floor(R()*3);for(let j=0;j<k;j++){const x=m.x+Math.floor(R()*m.w),y=m.y+Math.floor(R()*m.h);if(free(x,y))props.push({x,y,kind:'grass'})}}}
  // flat pieces (rails, grass) under the rest
  props.sort((a,b)=>(FLAT.has(b.kind)?1:0)-(FLAT.has(a.kind)?1:0)||a.y-b.y);
  const out={...base,tiles,props,theme:'site-'+th,style:{floor:L.floor,wall:L.wall,hall:L.hall||null},site:th};
  per[th]=out;return out}
const FLAT=new Set(['railh','railv','grass']);
