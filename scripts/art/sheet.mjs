#!/usr/bin/env node
// Contact sheet of the generated art (#177): every manifest asset next to its procedural fallback at 1x, 2x
// and 4x, nearest-neighbour, on a dark and a light ground, for review before committing assets/.
//   npm run art:sheet [-- --out logs/art/sheet.html] [--assets DIR] [--tier 32|64]  (default: the game's tier, TILE)
// Tile fallbacks are painted with the real terrain texels (src/render/terrain.js) from the first tile of that type
// on the Eldmoor map; kinds without a Node fallback painter say so. Node only, no network.
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {join,dirname,relative,sep} from 'node:path';
import {ROOT,ASSETS,loadManifest,loadIndex,TILE,sizeOf} from './lib.mjs';
import {encodePng,decodePng} from './png.mjs';
import {resolvePalette} from './post.mjs';

const o={};{const a=process.argv.slice(2);for(let i=0;i<a.length;i++)if(a[i].startsWith('--'))o[a[i].slice(2)]=a[i+1]&&!a[i+1].startsWith('--')?a[++i]:true}
const out=o.out||join(ROOT,'logs','art','sheet.html'),dir=o.assets||ASSETS,tier=o.tier?Number(o.tier):TILE;
const man=loadManifest(),idx=loadIndex(dir);
const PAL=await import('../../src/render/palette.js');
const {FAC}=await import('../../src/data/factions.js');
const {texel,ASSET_TILES,ASSET_ROAD,ASSET_EDGES,ASSET_PROPS,ASSET_CANOPY}=await import('../../src/render/terrain.js');
const {tiles}=await import('../../src/world/map.js');
const {W,H}=await import('../../src/world/tiles.js');

const uri=b=>'data:image/png;base64,'+Buffer.from(b).toString('base64');
// The procedural version of a tile asset at the tier: w x h art pixels (tier pixels a tile, the 16x16 procedural texel scaled
// up) starting at the first tile of that type.
// A transition piece ([A,B]) shows A on its top half and B below, each from a tile of that type; a tree or rock
// variant shows the procedural tile it stands on (a tree, or plain ground: rocks have no procedural version).
function tileFallback(id,[w,h]){const v=ASSET_TILES[id]??ASSET_ROAD[id]??ASSET_EDGES[id]??ASSET_PROPS[id]??ASSET_CANOPY[id];if(v===undefined)return null;
  const pair=Array.isArray(v)?v:[v,v],first=t=>{for(let i=0;i<W*H;i++)if(tiles[i]===t)return i;return 0};
  const at=pair.map(first),data=new Uint8Array(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const k=y<h/2?0:1,t=pair[k],tx=at[k]%W+Math.floor(x/tier),ty=Math.floor(at[k]/W)+Math.floor(y/tier);
    const c=texel(t,tx,ty,Math.floor((x%tier)*16/tier),Math.floor((y%tier)*16/tier)),o=(y*w+x)*4; // painted as that tile type even where the map changes
    data[o]=parseInt(c.slice(1,3),16);data[o+1]=parseInt(c.slice(3,5),16);data[o+2]=parseInt(c.slice(5,7),16);data[o+3]=255}
  return uri(encodePng({w,h,data}))}

// A hero sheet (palette from SPRITE.key) as the second faction sees it (#711): the review shows that the tabard takes the
// faction colour (palette.js recolour, the renderer's own swap), so a sheet that would not is caught before art:accept.
function recoloured(bytes,fac=1){const im=decodePng(bytes),sw=PAL.recolour(fac),d=im.data;
  for(let i=0;i<im.w*im.h;i++){const o=i*4;if(!d[o+3])continue;const c=sw['#'+[d[o],d[o+1],d[o+2]].map(v=>v.toString(16).padStart(2,'0')).join('')];
    if(c){d[o]=parseInt(c.slice(1,3),16);d[o+1]=parseInt(c.slice(3,5),16);d[o+2]=parseInt(c.slice(5,7),16)}}
  return uri(encodePng(im))}
const keyed=e=>e.kind==='sprite'&&((e.palette&&e.palette.from)||[]).includes('SPRITE.key');

const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
const scales=[1,2,4];
const cell=(src,[w,h])=>src?scales.map(k=>`<img src="${src}" width="${w*k}" height="${h*k}" alt="">`).join(''):'<span class="none">none</span>';
// One row per generated key (an alternate is 'id#altK'), or per manifest entry; --generated lists only what is generated.
// The provider's own image, when the run kept it (incoming/<date>/raw/), linked relative to the sheet, not inlined.
const raw=loadIndex(join(dir,'raw')).assets;
const rawCell=k=>{const r=raw[k];if(!r||!existsSync(join(dir,'raw',r.file)))return '<span class="none">-</span>';
  return `<a href="${relative(dirname(out),join(dir,'raw',r.file)).split(sep).join('/')}"><img class="raw" src="${relative(dirname(out),join(dir,'raw',r.file)).split(sep).join('/')}" width="128" height="128" alt=""></a>`};
// keys are '<id>@<tier>[#altK]'; the sheet shows one tier
let made=0;const keys=man.assets.flatMap(e=>{const me=e.id+'@'+tier,ks=[...new Set([...Object.keys(idx.assets),...Object.keys(raw)])].filter(k=>k===me||k.startsWith(me+'#'));return (ks.length||o.generated?ks:[me]).map(k=>[k,e])});
const rows=keys.map(([k,e])=>{const a=idx.assets[k],p=a&&join(dir,a.file);const has=p&&existsSync(p);if(has)made++;
  const pal=resolvePalette(e.palette,PAL).colors,r=raw[k],size=sizeOf(e,tier);
  return `<tr><td><b>${esc(k)}</b><br>${size.join('x')} · ${esc(e.kind)} · priority ${e.priority}<br><small>${a?esc(a.model+' · '+a.repo+' · seed '+a.seed)+'<br>'+esc(a.at||''):r?esc(r.model+' · seed '+r.seed):'seed '+e.seed}${a&&a.colors?'<br>'+a.colors+' colours · grid '+esc(a.grid||'?'):''}</small>
<div class="pal">${pal.map(c=>`<i style="background:${c}" title="${c}"></i>`).join('')}</div></td>
<td>${rawCell(k)}</td>
<td class="g">${has?cell(uri(readFileSync(p)),size)+(keyed(e)?`<br><small>as ${esc(FAC[1].name)}:</small><br>`+cell(recoloured(readFileSync(p)),size):''):`<span class="none">${r?'rejected (flat, or a sheet without its frames or tabard); raw kept':'not generated'}</span>`}</td>
<td class="g">${cell(tileFallback(e.id,size),size)}</td>
<td><small>${esc(e.prompt)}</small></td></tr>`}).join('\n');

const html=`<!doctype html><meta charset="utf-8"><title>Eldmoor art sheet</title>
<style>body{background:#0d0e19;color:#ece6d2;font:14px/1.4 system-ui,sans-serif;margin:16px}table{border-collapse:collapse;width:100%}
td,th{border-bottom:1px solid #2e2a34;padding:8px;vertical-align:top;text-align:left}img{image-rendering:pixelated;margin-right:8px;vertical-align:bottom}img.raw{image-rendering:auto}
.g{background:#1a1a26;white-space:nowrap}.g:hover{background:#d8d0c0}.none{color:#8f8ca8}.pal i{display:inline-block;width:10px;height:10px;margin:1px}small{color:#8f8ca8}</style>
<h1>Eldmoor art, ${tier} px tier: ${made} generated (${man.assets.length} in the manifest)</h1><p>Generated asset and its procedural fallback at 1x, 2x and 4x (hover a cell for a light ground).</p>
<table><tr><th>asset</th><th>model image</th><th>generated</th><th>procedural fallback</th><th>prompt</th></tr>
${rows}</table>`;
mkdirSync(dirname(out),{recursive:true});writeFileSync(out,html);
console.log(`[art] sheet: ${out} (${made} generated, ${man.assets.length} in the manifest)`);
