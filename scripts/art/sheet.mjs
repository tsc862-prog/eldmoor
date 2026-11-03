#!/usr/bin/env node
// Contact sheet of the generated art (#177): every manifest asset next to its procedural fallback at 1x, 2x
// and 4x, nearest-neighbour, on a dark and a light ground, for review before committing assets/.
//   npm run art:sheet [-- --out logs/art/sheet.html] [--assets DIR]
// Tile fallbacks are painted with the real terrain texels (src/render/terrain.js) from the first tile of that type
// on the Eldmoor map; kinds without a Node fallback painter say so. Node only, no network.
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {ROOT,ASSETS,loadManifest,loadIndex} from './lib.mjs';
import {encodePng} from './png.mjs';
import {resolvePalette} from './post.mjs';

const o={};{const a=process.argv.slice(2);for(let i=0;i<a.length;i++)if(a[i].startsWith('--'))o[a[i].slice(2)]=a[i+1]&&!a[i+1].startsWith('--')?a[++i]:true}
const out=o.out||join(ROOT,'logs','art','sheet.html'),dir=o.assets||ASSETS;
const man=loadManifest(),idx=loadIndex(dir);
const PAL=await import('../../src/render/palette.js');
const {texel,ASSET_TILES,ASSET_LATER}=await import('../../src/render/terrain.js');
const {tiles}=await import('../../src/world/map.js');
const {W,H}=await import('../../src/world/tiles.js');

const uri=b=>'data:image/png;base64,'+Buffer.from(b).toString('base64');
// The procedural version of a tile asset: w x h world pixels starting at the first tile of that type.
// A transition piece ([A,B]) shows A on its top half and B below, each from a tile of that type.
function tileFallback(id,[w,h]){const v=ASSET_TILES[id]??ASSET_LATER[id];if(v===undefined)return null;
  const pair=Array.isArray(v)?v:[v,v],first=t=>{for(let i=0;i<W*H;i++)if(tiles[i]===t)return i;return 0};
  const at=pair.map(first),data=new Uint8Array(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const k=y<h/2?0:1,t=pair[k],tx=at[k]%W+Math.floor(x/16),ty=Math.floor(at[k]/W)+Math.floor(y/16);
    const c=texel(t,tx,ty,x%16,y%16),o=(y*w+x)*4; // painted as that tile type even where the map changes
    data[o]=parseInt(c.slice(1,3),16);data[o+1]=parseInt(c.slice(3,5),16);data[o+2]=parseInt(c.slice(5,7),16);data[o+3]=255}
  return uri(encodePng({w,h,data}))}

const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
const scales=[1,2,4];
const cell=(src,[w,h])=>src?scales.map(k=>`<img src="${src}" width="${w*k}" height="${h*k}" alt="">`).join(''):'<span class="none">none</span>';
// One row per generated key (an alternate is 'id#altK'), or per manifest entry; --generated lists only what is generated.
let made=0;const keys=man.assets.flatMap(e=>{const ks=Object.keys(idx.assets).filter(k=>k===e.id||k.startsWith(e.id+'#'));return (ks.length||o.generated?ks:[e.id]).map(k=>[k,e])});
const rows=keys.map(([k,e])=>{const a=idx.assets[k],p=a&&join(dir,a.file);const has=p&&existsSync(p);if(has)made++;
  const pal=resolvePalette(e.palette,PAL).colors;
  return `<tr><td><b>${esc(k)}</b><br>${e.size.join('x')} · ${esc(e.kind)} · priority ${e.priority}<br><small>${a?esc(a.model+' · '+a.repo+' · seed '+a.seed)+'<br>'+esc(a.at||''):'seed '+e.seed}</small>
<div class="pal">${pal.map(c=>`<i style="background:${c}" title="${c}"></i>`).join('')}</div></td>
<td class="g">${has?cell(uri(readFileSync(p)),e.size):'<span class="none">not generated</span>'}</td>
<td class="g">${cell(tileFallback(e.id,e.size),e.size)}</td>
<td><small>${esc(e.prompt)}</small></td></tr>`}).join('\n');

const html=`<!doctype html><meta charset="utf-8"><title>Eldmoor art sheet</title>
<style>body{background:#0d0e19;color:#ece6d2;font:14px/1.4 system-ui,sans-serif;margin:16px}table{border-collapse:collapse;width:100%}
td,th{border-bottom:1px solid #2e2a34;padding:8px;vertical-align:top;text-align:left}img{image-rendering:pixelated;margin-right:8px;vertical-align:bottom}
.g{background:#1a1a26;white-space:nowrap}.g:hover{background:#d8d0c0}.none{color:#8f8ca8}.pal i{display:inline-block;width:10px;height:10px;margin:1px}small{color:#8f8ca8}</style>
<h1>Eldmoor art: ${made} generated (${man.assets.length} in the manifest)</h1><p>Generated asset and its procedural fallback at 1x, 2x and 4x (hover a cell for a light ground).</p>
<table><tr><th>asset</th><th>generated</th><th>procedural fallback</th><th>prompt</th></tr>
${rows}</table>`;
mkdirSync(dirname(out),{recursive:true});writeFileSync(out,html);
console.log(`[art] sheet: ${out} (${made} generated, ${man.assets.length} in the manifest)`);
