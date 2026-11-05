#!/usr/bin/env node
// npm run artcheck (#177): the art pipeline without a network or a token.
//  1. the manifest is valid and every id has a procedural fallback hook in its renderer (and every hook id is in the manifest);
//  2. the real assets/ folder (absent is fine) matches assets/index.json: files exist, sizes and sha256 right, no strays;
//  3. the PNG codec and the post-processing (palette only, transparency, outline, deterministic);
//  4. scripts/art/gen.mjs and daily.mjs end to end against a mock Hugging Face server: dry runs, --max, the provider
//     lookup, a refused model and the next candidate pinned, a 402 and a quota 429 stop and the next day's resume,
//     ART_MAX_CALLS, rate headers, art:accept/--reject, alternates, no call once complete, a refused token; the temp
//     assets folder then passes the index check (assets present);
//     The loop (#661, daily.mjs --loop, run in-process on a fake clock): a pass to the day's share and the retry time on its log
//     line, the retries that spend nothing, midnight opening a new share, the carried share after idle days, the month's cap
//     (and the 1st reopening), a 402 and a quota 429 with a long retry-after setting the retry time, nothing left to make
//     (told once, woken by a manifest change);
//     The ZeroGPU Space (#703, the default provider; the router tests above pass --provider router): the Gradio call protocol
//     (POST then the event stream, the image FileData downloaded with the token), a sleeping Space woken, the GPU seconds
//     counted per window and the cap, the quota 429 and the quota error event with their reset time (the loop sleeps until
//     exactly then), a missing or errored Space reported with its page and no router fallback, a refused LoRA, the manifest's
//     space models, and npm run art:space (a read-only token named, create, one commit, ZeroGPU hardware);
//  5. the terrain renders the same with no assets, uses a tile asset when one is there, and goes back when it is removed;
//  6. the autotile rules (slice 2) on headless Eldmoor and Stepping Lands maps with fixture PNGs (scripts/art/fixtures.mjs,
//     drawn in code, written to a temp folder, never assets/) on, one piece removed, and off: same map, pieces and
//     variants placed by tile hash, fallback per tile, the procedural render back exactly;
//  7. tiers (#177, src/render/tile.js): index keys and files per tier, the loader keeps only the renderer's tier (a 64
//     asset under TILE 32 is absent, so the procedural art is drawn), the procedural texel scaled to TILE where an
//     asset is missing, generation settings per tier (LoRA scale, pixel grid, palette widening) in the requests and
//     outputs of gen/daily --tier 64, a queue and index from before tiers read as the 32 tier, and sprite sheets;
//  8. towns and landmarks (slice 3, src/render/townart.js) on headless Eldmoor and Stepping Lands maps, drawn through a
//     small raster of its own (no canvas in Node): each town in its faction's style with every piece placed, no assets =
//     the procedural drawing, fixture PNGs on (only inside the pieces' boxes), one piece removed, and off again exactly.
//  9. the building recipe (#763, scripts/art/post-flat.mjs): standing buildings and landmarks on the flat palette and the game's
//     view, sizes = their footprint boxes, a clean flat building passing and a painterly facade (and the old recipe's output)
//     refused by the style gate, art:accept refusing a building without an art:preview shot of this very image at 3440x1440
//     zoom 1 or one that fails the gate, the check recorded on accept, the kindModel trial switch, and the renderer's base strip.
// 10. sprite sheets (slice 4, #711, scripts/art/post-sheet.mjs): a model answer drawn from each sheet's fixture (figures in a
//     3x4 grid on white, not on the frame grid) comes out one figure a frame, feet on the frame floor, clear ground, palette
//     and outline only, deterministic; a hero keeps its tabard in the recolourable key; 3 rows, 2 columns or a hero with
//     no tabard are rejected (raw kept); the 64 tier; the mock answers sprite prompts with such sheets in the runs above.
//     Image to image (#763, scripts/art/init.mjs, post-init.mjs, inside the mock Space part of 4): every building, landmark and
//     sprite has procedural art at both tiers that survives its own recipe, tiles and props stay text only; the procedural pixels
//     reach the mock Space's img2img API with the manifest's strength; the answer keeps the silhouette and passes the gates, a
//     redrawn or spilt answer is refused with its raw kept; raws and art:reprocess keep working; the router leaves these kinds
//     out; a Space from before img2img stops the run with the word to push; the router runs of part 4 use the manifest without
//     kindInit, which also proves the text recipe on these kinds still works for raws made before.
import {mkTmp} from './tmp.mjs';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync,readdirSync,utimesSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {deflateSync} from 'node:zlib';
import {sha256,ROOT,ASSETS,loadManifest,loadIndex,validateManifest,checkHooks,checkIndex,fileOf,sizeOf,tierKey,normKey,splitKey,keyFile,loadQueue,tierCfg,TILE,TIERS,nextCheck} from './art/lib.mjs';
import {runLoop} from './art/daily.mjs';
import {summarize,render,staleIncoming,IN_GAME_KINDS} from './art/review.mjs';
import {reviewFixture} from './art/fixtures.mjs';
import {decodePng,encodePng,pngSize} from './art/png.mjs';
import {resolvePalette,hexToRgb,downscale} from './art/post.mjs';
import {postProcess,detectGrid,expandPalette,colorCount,pieceStats,pieceOf} from './art/post-texture.mjs';

let fails=0;const ok=(c,m)=>{if(c)console.log('  ok  '+m);else{fails++;console.log('  FAIL '+m)}};
const man=loadManifest();
const PAL=await import('../src/render/palette.js');
// Child mode for part 6: one world per process (the world modules pick ELDMOOR_WORLD when they load).
if(process.argv[2]==='--autotile'){await autotileProbe();process.exit(fails?1:0)}
if(process.argv[2]==='--towns'){await townProbe();process.exit(fails?1:0)}

console.log('manifest and hooks');
{const e=validateManifest(man,PAL,resolvePalette);ok(!e.length,'manifest valid'+(e.length?': '+e.join('; '):` (${man.assets.length} assets, models ${Object.keys(man.models).join(', ')})`));
  const h=await checkHooks(man);ok(!h.length,'every manifest id has a procedural fallback hook'+(h.length?': '+h.join('; '):''));
  const {ASSET_TILES,ASSET_ROAD,ASSET_EDGES,ASSET_PROPS}=await import('../src/render/terrain.js');const ids=new Set(man.assets.map(a=>a.id));
  const orphan=[ASSET_TILES,ASSET_ROAD,ASSET_EDGES,ASSET_PROPS].flatMap(Object.keys).filter(id=>!ids.has(id));ok(!orphan.length,'every terrain hook id is in the manifest'+(orphan.length?': '+orphan:''));
  let bad=man.assets.filter(a=>fileOf(a.id,32)!==`${a.kind}/32/${a.id.split(':')[1]}.png`||fileOf(a.id,64)!==`${a.kind}/64/${a.id.split(':')[1]}.png`);
  ok(!bad.length,`every id has a file per tier, e.g. ${man.assets[0].id} -> assets/${fileOf(man.assets[0].id,32)} and assets/${fileOf(man.assets[0].id,64)}`+(bad.length?': '+bad.map(a=>a.id):''));
  bad=man.assets.filter(a=>!TIERS.every(t=>sizeOf(a,t))||sizeOf(a,64)[0]!==2*sizeOf(a,32)[0]||sizeOf(a,64)[1]!==2*sizeOf(a,32)[1]);
  ok(!bad.length,`every asset has a size per tier, the 64 tier twice the 32 (${TIERS.join(', ')})`+(bad.length?': '+bad.map(a=>a.id):''));
  bad=man.assets.filter(a=>(a.kind==='tile'||a.kind==='autotile'||a.kind==='prop')&&(sizeOf(a,TILE)[0]!==TILE||sizeOf(a,TILE)[1]!==TILE));
  ok(!bad.length,`terrain tiles, transitions and props are one tile (${TILE}x${TILE}) at the game's tier`+(bad.length?': '+bad.map(a=>a.id):''));
  const {ASSET_SPRITES}=await import('../src/render/sprites.js'),sp=man.assets.filter(a=>a.kind==='sprite');
  ok(sp.length&&sp.every(a=>ASSET_SPRITES[a.id]&&a.frames.cols===3&&a.frames.rows===4),`sprite sheets: 3 frames by 4 directions (${sp.length})`);
  const hero=sp.filter(a=>/^sprite:hero-/.test(a.id));ok(hero.length&&hero.every(a=>sizeOf(a,32)[0]/3===32&&sizeOf(a,32)[1]/4===48&&sizeOf(a,64)[0]/3===64&&sizeOf(a,64)[1]/4===96),`hero frames 32x48 at the 32 tier, 64x96 at 64 (${hero.length} classes)`);
  const {CLS}=await import('../src/data/classes.js');ok(Object.keys(CLS).every(c=>hero.some(a=>ASSET_SPRITES[a.id].cls===c)),'a hero sheet for every class');
  const t32=tierCfg(man,man.models['pixel-xl'],32),t64=tierCfg(man,man.models['pixel-xl'],64);
  ok(t32.loraScale===.55&&t32.grid===4&&t64.loraScale===.2&&t64.grid===2,`tier settings: 32 at LoRA ${t32.loraScale} grid ${t32.grid}, 64 at LoRA ${t64.loraScale} grid ${t64.grid} (the owner's comparison)`);
  ok(PAL.SPRITE.key[0]===(await import('../src/data/factions.js')).FAC[0].color,'the sprite key colour is the first faction (fixtures and recolour agree)')}

console.log('assets/ in the repo');
{const {errs,count}=checkIndex(man,ASSETS);ok(!errs.length,`${existsSync(ASSETS)?'assets/ present':'assets/ absent'}: ${count} indexed`+(errs.length?': '+errs.join('; '):''))}

console.log('PNG codec and post-processing');
const synth=(w,h)=>{const d=new Uint8Array(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const o=(y*w+x)*4,inBlob=(x-w/2)**2+(y-h/2)**2<(w/3)**2;
  if(inBlob){d[o]=40+((x*7+y*3)%40);d[o+1]=130+((x*5)%50);d[o+2]=50}else{d[o]=255;d[o+1]=0;d[o+2]=255}d[o+3]=255}return {w,h,data:d}};
// A stand-in for a pixel-art model image: a native texture of 'cells' greens drawn as blocks of 'block' px (fractional
// allowed) from offset 'off', with soft block edges and noise, like pixel-art-xl's 1024 px output. 'flat' = one colour.
const pixelArt=(size=1024,block=8,{off=3,seed=7,flat=false}={})=>{let r=seed>>>0;const rnd=()=>((r=(r*1664525+1013904223)>>>0)/4294967296);
  const n=Math.ceil(size/block)+1,cells=[];for(let i=0;i<n*n;i++){const t=rnd(),tuft=rnd()<.12;cells.push(flat?[60,120,58]:tuft?[110+t*30,190+t*30,90]:[40+t*30,105+t*45,40+t*20])}
  const d=new Uint8Array(size*size*4);for(let y=0;y<size;y++)for(let x=0;x<size;x++){const cx=Math.floor((x-off)/block)+1,cy=Math.floor((y-off)/block)+1,c=cells[Math.max(0,cy)*n+Math.max(0,cx)];
    const fx=((x-off)/block)%1,fy=((y-off)/block)%1,edge=(fx<.08||fx>.92||fy<.08||fy>.92)?.85:1,o=(y*size+x)*4,nz=flat?0:(rnd()-.5)*6;
    d[o]=Math.max(0,Math.min(255,c[0]*edge+nz));d[o+1]=Math.max(0,Math.min(255,c[1]*edge+nz));d[o+2]=Math.max(0,Math.min(255,c[2]*edge+nz));d[o+3]=255}
  return {w:size,h:size,data:d}};
// A transition answer: pixel-art green ground above, grey-brown stone below. A prop answer: a textured blob on white.
const twoGrounds=()=>{const a=pixelArt(),b=pixelArt(1024,8,{seed:11});for(let y=512;y<1024;y++)for(let x=0;x<1024;x++){const o=(y*1024+x)*4;a.data[o]=b.data[o+1];a.data[o+1]=b.data[o+1]*.85;a.data[o+2]=b.data[o+1]*.75}return a};
// Corner and inner answers: B (stone) fills a quarter disc at the bottom right (corner), or everything but a quarter disc at the top left (inner).
const discGrounds=inner=>{const a=pixelArt(),b=pixelArt(1024,8,{seed:11});for(let y=0;y<1024;y++)for(let x=0;x<1024;x++){const inDisc=inner?x*x+y*y>=520*520:(1023-x)**2+(1023-y)**2<520*520;
  if(inDisc){const o=(y*1024+x)*4;a.data[o]=b.data[o+1];a.data[o+1]=b.data[o+1]*.85;a.data[o+2]=b.data[o+1]*.75}}return a};
const propArt=()=>{const a=pixelArt(1024,8,{seed:13});for(let y=0;y<1024;y++)for(let x=0;x<1024;x++)if((x-512)**2+(y-560)**2>360**2){const o=(y*1024+x)*4;a.data[o]=a.data[o+1]=a.data[o+2]=255}return a};
// A structured answer (2026-11-03 ice, mud, snow, swamp): 8 px cells of mild noise with a dark mortar cell every mx-th column
// and my-th row, the cell after it a half shade, so the lines sit on every 3rd cell and a multiple of the real period (24)
// scores as high as the period itself.
const wallArt=(size=1024,block=8,{off=3,mx=3,my=3,seed=5}={})=>{let r=seed>>>0;const rnd=()=>((r=(r*1664525+1013904223)>>>0)/4294967296);
  const n=Math.ceil(size/block)+1,d=new Uint8Array(size*size*4),cells=[];for(let i=0;i<n*n;i++)cells.push(rnd());
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){const cx=Math.floor((x-off)/block)+1,cy=Math.floor((y-off)/block)+1,t=cells[Math.max(0,cy)*n+Math.max(0,cx)],o=(y*size+x)*4,
    k=((cx%mx===0)?.4:(cx%mx===1)?.8:1)*((cy%my===0)?.4:(cy%my===1)?.8:1)*(.93+t*.07);d[o]=170*k;d[o+1]=150*k;d[o+2]=120*k;d[o+3]=255}
  return {w:size,h:size,data:d}};
// Town answers (slice 3): a wall or gate is grey stone blocks with mortar; a building a roof band over a wall with a door, on white.
const stoneArt=()=>{const a=pixelArt(1024,8,{seed:17});for(let y=0;y<1024;y++)for(let x=0;x<1024;x++){const o=(y*1024+x)*4,g=a.data[o+1],m=(y%64<8)||((x+((y>>6)&1)*64)%128<8),v=m?50:90+g*.6;a.data[o]=v;a.data[o+1]=v*.95;a.data[o+2]=v*1.05}return a};
const houseArt=()=>{const a=stoneArt();for(let y=0;y<1024;y++)for(let x=0;x<1024;x++){const o=(y*1024+x)*4;if(x<160||x>864||y<160||y>900){a.data[o]=a.data[o+1]=a.data[o+2]=255;continue}
  if(y<480){a.data[o]*=.6;a.data[o+1]*=.7;a.data[o+2]=Math.min(255,a.data[o+2]*1.1)}else if(x>440&&x<584&&y>700){a.data[o]=70;a.data[o+1]=45;a.data[o+2]=25}}return a};
{const im=synth(37,23),b=encodePng(im),back=decodePng(b);ok(back.w===37&&back.h===23&&Buffer.from(back.data).equals(Buffer.from(im.data)),'RGBA round trip');
  ok(pngSize(b).w===37&&pngSize(b).h===23,'size from the header');
  // a 2x2 palette PNG with tRNS and a Paeth-filtered 2x1 RGB PNG, built by hand
  const crcT=new Int32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crcT[n]=c}
  const crc=b=>{let c=-1;for(const v of b)c=crcT[(c^v)&255]^(c>>>8);return (c^-1)>>>0};
  const ch=(t,d)=>{const b=Buffer.alloc(12+d.length);b.writeUInt32BE(d.length);b.write(t,4,'latin1');Buffer.from(d).copy(b,8);b.writeUInt32BE(crc(b.subarray(4,8+d.length)),8+d.length);return b};
  const png=(w,h,ct,extra,raw)=>{const i=Buffer.alloc(13);i.writeUInt32BE(w);i.writeUInt32BE(h,4);i[8]=8;i[9]=ct;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',i),...extra,ch('IDAT',deflateSync(Buffer.from(raw))),ch('IEND',Buffer.alloc(0))])};
  const p=decodePng(png(2,2,3,[ch('PLTE',Buffer.from([255,0,0,0,0,255])),ch('tRNS',Buffer.from([0]))],[0,0,1,0,1,0]));
  ok(p.data[3]===0&&p.data[4+2]===255&&p.data[4+3]===255&&p.data[8+2]===255,'palette PNG with transparency');
  const q=decodePng(png(2,1,2,[],[4,10,20,30,5,5,5]));ok(q.data[4]===15&&q.data[5]===25&&q.data[6]===35,'Paeth filter');
  let jpegErr='';try{decodePng(Buffer.from([0xff,0xd8,0xff,0xe0,0,0,0,0,0,0]))}catch(e){jpegErr=e.message}ok(/JPEG/.test(jpegErr),'a JPEG answer is named, not misread')}
{const grass=man.assets.find(a=>a.id==='tile:grass'),gpal=resolvePalette(grass.palette,PAL).colors,src=pixelArt();
  const g=detectGrid(src);ok(g.found&&Math.abs(g.x.s-8)<=.25&&Math.abs(g.y.s-8)<=.25,`the model's pixel grid is found (${g.x.s}x${g.y.s}, offset ${g.x.o})`);
  const g2=detectGrid(pixelArt(1024,8.5,{off:0,seed:9}));ok(g2.found&&Math.abs(g2.x.s-8.5)<=.25,`a fractional grid too (${g2.x.s})`);
  // the 2026-11-03 stripes: a structured image's lines sit on multiples of the real period, the pick used to land on 24 and the tile was cut from a 43 px native image scaled up
  {const wall=wallArt(),was=detectGrid(wall,4,false),now=detectGrid(wall,4);
    ok(was.x.s>8&&was.y.s>8,`regression fixture: the first period found on a wall is a multiple of the real one (${was.x.s}x${was.y.s})`);
    ok(now.x.s===8&&now.y.s===8,`the real pixel size is found under the multiples (${now.x.s}x${now.y.s})`);
    const wt=postProcess(wall,{...grass,post:{...grass.post,minColors:2}},gpal,PAL.MARK.outline);ok(/^12[78]x12[78]$/.test(wt.notes.native)&&wt.notes.grid==='8x8',`the wall tile is cut from the 128 px native image, no scaled-up stripes (${wt.notes.native})`);
    const was2=postProcess(wall,{...grass,post:{...grass.post,minColors:2,fundamental:false}},gpal,PAL.MARK.outline);ok(!/^12[78]x12[78]$/.test(was2.notes.native),'post.fundamental false keeps the old pick (so an accepted tile can stay as it was)');
    const g16=detectGrid(pixelArt(1024,16,{seed:3}));ok(g16.x.s===16&&g16.y.s===16,`a true 16 px grid stays 16 (${g16.x.s}x${g16.y.s})`);
    const holes=pixelArt(1024,8,{seed:3});for(let y=0;y<1024;y++)for(let x=0;x<1024;x++){if((x-3+64)%64<8&&y>40){const o=(y*1024+x)*4;holes.data[o]=holes.data[o+1]=holes.data[o+2]=20}}
    const gh=detectGrid(holes);ok(gh.x.s===8&&gh.y.s===8,`a few strong lines do not move the grid (${gh.x.s}x${gh.y.s})`)}
  // the first real run's failure: the whole image voted down to 16 px came out 1-2 colours
  const old=downscale(src,16,16,gpal,'mode');ok(colorCount(old)<=2,`regression fixture: the old area vote gives ${colorCount(old)} colour(s)`);
  const t=postProcess(src,grass,gpal,PAL.MARK.outline),t2=postProcess(src,grass,gpal,PAL.MARK.outline);
  const pset=new Set(expandPalette(gpal,6).map(c=>hexToRgb(c).join(',')));let off=0;for(let i=0;i<t.w*t.h;i++){const o=i*4;if(!pset.has([t.data[o],t.data[o+1],t.data[o+2]].join(',')))off++}
  ok(t.w===32&&t.h===32&&t.notes.colors>=6&&!off,`grass tile keeps its texture: 32x32, ${t.notes.colors} palette colours, grid ${t.notes.grid}, native ${t.notes.native}, seam ${t.notes.seam}`);
  ok(Buffer.from(t.data).equals(Buffer.from(t2.data)),'deterministic');
  const dith=postProcess(src,{...grass,post:{...grass.post,dither:24}},gpal,PAL.MARK.outline);ok(!Buffer.from(dith.data).equals(Buffer.from(t.data))&&dith.notes.colors>=4,'ordered dither changes the result and stays in the palette');
  let flatErr=null;try{postProcess(pixelArt(1024,8,{flat:true}),grass,gpal,PAL.MARK.outline)}catch(e){flatErr=e}
  ok(flatErr&&flatErr.kind==='flat'&&/flat: 1 colour/.test(flatErr.message),'a flat output is rejected, not written: '+(flatErr&&flatErr.message));
  ok(expandPalette(['#3f8a3a','#2a6e2c'],6).length===6,'a short palette is widened with shades');
  {const w=expandPalette(['#3f8a3a','#2a6e2c'],PAL.TIER_SHADES[32].minPalette,PAL.TIER_SHADES[32].factors),w64=expandPalette(['#3f8a3a','#2a6e2c'],PAL.TIER_SHADES[64].minPalette,PAL.TIER_SHADES[64].factors);
    ok(w.length===PAL.TIER_SHADES[32].minPalette&&w64.length>w.length&&w.slice(2).every(c=>PAL.shadesOf('#3f8a3a').includes(c)||PAL.shadesOf('#2a6e2c').includes(c)),`the tiers widen a palette with the palette module's shades (${w.length} at 32, ${w64.length} at 64)`)}
  {const t64=postProcess(src,grass,gpal,PAL.MARK.outline,{tier:64,hint:8});ok(t64.w===64&&t64.h===64,`the 64 tier crops ${t64.w}x${t64.h} from the same model image`)}}
// Transition pieces (2026-11-03: four of five autotiles were a scene or a wall, the fifth random blotches; all came out as noise).
// The dual grid wants A on top and B below (edge), B in the bottom-right quarter (corner), A in the top-left quarter (inner).
{const {fixtures}=await import('./art/fixtures.mjs'),F=fixtures(man,32),bad=[];let n=0;
  for(const [id,im] of Object.entries(F))if(id.startsWith('autotile:')){n++;const st=pieceStats(im,pieceOf(id));if(!st.ok)bad.push(`${id} ${JSON.stringify(st)}`)}
  ok(n>=20&&!bad.length,`every drawn fixture piece (${n}: edges, corners, inner corners) passes the piece check`+(bad.length?': '+bad.join('; '):''));
  const edge=man.assets.find(a=>a.id==='autotile:grass-road'),epal=resolvePalette(edge.palette,PAL).colors;
  const rej=(img,e=edge)=>{try{postProcess(img,e,epal,PAL.MARK.outline);return null}catch(err){return err}};
  const a=rej(pixelArt()),b=rej(propArt()),c=rej(stoneArt());
  ok(a&&a.kind==='flat'&&/not an edge piece/.test(a.message),'one ground all over is not an edge piece: '+(a&&a.message));
  ok(b&&b.kind==='flat'&&c&&c.kind==='flat','a blob on white and a stone wall are not edge pieces either (rejected like a flat one: raw kept, redrawn later)');
  ok(!rej(twoGrounds()),'a real two-ground answer (green above, stone below) passes');
  const cor=man.assets.find(a=>a.id==='autotile:grass-road-corner'),mid=twoGrounds();
  ok(rej(mid,cor)&&rej(mid,cor).kind==='flat','the same top-and-bottom answer is not a corner piece (B must be in the bottom-right quarter only)');
  ok(!rej(pixelArt(),{...edge,post:{...edge.post,shape:false}}),'post.shape false skips the piece check');
  ok(pieceOf('autotile:fen-ash')==='edge'&&pieceOf('autotile:fen-ash-corner')==='corner'&&pieceOf('autotile:fen-ash-inner')==='inner','piece kind comes from the id')}
{const e={kind:'sprite',size:[16,16],post:{transparent:true,outline:true}},pal=['#3f8a3a','#2a6e2c','#45923c'];
  const a=postProcess(synth(256,256),e,pal,PAL.MARK.outline),b=postProcess(synth(256,256),e,pal,PAL.MARK.outline);
  ok(a.w===16&&a.h===16,'a sprite is scaled to 16x16');ok(Buffer.from(a.data).equals(Buffer.from(b.data)),'deterministic');
  const allowed=new Set([...expandPalette(pal,6),PAL.MARK.outline].map(c=>hexToRgb(c).join(',')));let bad=0,clear=0,line=0;
  for(let i=0;i<256;i++){const o=i*4;if(a.data[o+3]===0){clear++;continue}if(!allowed.has([a.data[o],a.data[o+1],a.data[o+2]].join(',')))bad++;if([a.data[o],a.data[o+1],a.data[o+2]].join(',')===hexToRgb(PAL.MARK.outline).join(','))line++}
  ok(!bad,'only palette colours (and the outline)');ok(clear>40,`background cleared (${clear} clear pixels)`);ok(line>8,`1px outline drawn (${line} pixels)`);
  const t=postProcess(pixelArt(),{kind:'tile',size:[32,32],post:{}},pal);let opaque=0;for(let i=0;i<32*32;i++)if(t.data[i*4+3]===255)opaque++;ok(opaque===1024,'a tile stays opaque')}

console.log('the building recipe and its gates (#763)');
{const FB=await import('./art/fixtures-buildings.mjs'),PF=await import('./art/post-flat.mjs'),{TOWN_PIECES}=await import('../src/data/townart.js'),{withKindModel,QUEUE0,saveQueue}=await import('./art/lib.mjs');
  const standing=man.assets.filter(e=>e.post&&e.post.flat),byId=new Map(man.assets.map(e=>[e.id,e])),styles=Object.keys(PAL.TOWN);
  const want=[...styles.flatMap(s=>TOWN_PIECES.map(p=>`building:${s}-${p.piece}`)),'landmark:crypt-mouth','landmark:lair'];
  ok(want.every(id=>byId.get(id)&&byId.get(id).post.flat)&&standing.length===want.length,`every standing building and landmark is on the flat recipe (${standing.length}); walls, corners and gates keep the masonry recipe`);
  ok(standing.every(e=>{const c=resolvePalette(e.palette,PAL).colors;return c.length>=5&&c.length<=PF.GATE.maxColors&&/^FLAT\./.test(e.palette.from[0])}),`their palettes are the procedural building's flat colours, ${PF.GATE.maxColors} at most (FLAT.<style>)`);
  ok(standing.every(e=>/thick black outline/.test(e.prompt)&&/flat shading/.test(e.prompt)&&!/front facing/.test(e.prompt))&&standing.filter(e=>e.kind==='building').every(e=>/top-down three-quarter view, the roof fills the top two thirds/.test(e.prompt)),"their prompts ask for the game's view: top-down three-quarter, roof two thirds, flat shading, thick outline; no front elevation");
  {const bad=[];for(const s of styles)for(const p of TOWN_PIECES){const e=byId.get(`building:${s}-${p.piece}`);for(const t of TIERS){const z=sizeOf(e,t);if(z[0]!==Math.round(p.box[2]*t)||z[1]!==Math.round(p.box[3]*t))bad.push(`${e.id}@${t} ${z} vs box ${p.box[2]}x${p.box[3]}`)}}
    ok(!bad.length,'each building is generated at its footprint: its manifest size is its town layout box in tiles times the tier'+(bad.length?': '+bad.join('; '):''))}
  const pal=s=>resolvePalette({from:['FLAT.'+s]},PAL).colors,luma=c=>{const [r,g,b]=hexToRgb(c);return r*.299+g*.587+b*.114};
  const run=(e,raw,tier=32)=>{try{return postProcess(raw,e,resolvePalette(e.palette,PAL).colors,PAL.MARK.outline,{hint:tierCfg(man,man.models['pixel-xl'],tier).grid,tier})}catch(x){return x}};
  for(const id of ['building:stone-hall','building:timber-chapel','building:stone-board','landmark:crypt-mouth']){const e=byId.get(id),z=sizeOf(e,32),st=id==='landmark:crypt-mouth'?'crypt':id.split(':')[1].split('-')[0];
    const good=run(e,FB.flatBuilding(PAL.FLAT[st],z,e.seed)),again=run(e,FB.flatBuilding(PAL.FLAT[st],z,e.seed)),bad=run(e,FB.painterlyFacade(z,e.seed));
    const P=new Set(pal(st).map(c=>hexToRgb(c).join(','))),base=e.post.base||0,line=hexToRgb(pal(st).slice().sort((a,b)=>luma(a)-luma(b))[0]).join(',');let off=0,baseLit=0,rim=0;
    if(!(good instanceof Error)){for(let i=0;i<good.w*good.h;i++){const o=i*4;if(!good.data[o+3])continue;if(!P.has([good.data[o],good.data[o+1],good.data[o+2]].join(',')))off++;if(Math.floor(i/good.w)>=good.h-base)baseLit++}
      for(let x=0;x<good.w;x++)for(let y=0;y<good.h;y++){const o=(y*good.w+x)*4;if(good.data[o+3]){if([good.data[o],good.data[o+1],good.data[o+2]].join(',')===line)rim++;break}}}
    ok(!(good instanceof Error)&&good.w===z[0]&&good.h===z[1]&&good.notes.colors<=PF.GATE.maxColors&&!off&&!baseLit&&rim>=z[0]*.5&&Buffer.from(good.data).equals(Buffer.from(again.data)),
      `${id}: a clean flat-colour building passes: ${z.join('x')}, ${good.notes&&good.notes.colors} palette colours, outline on the rim, ${base} base rows clear, deterministic`+(good instanceof Error?': '+good.message:''));
    ok(bad instanceof Error&&bad.kind==='flat'&&bad.why==='off-style',`${id}: the painterly facade (front elevation, close greys, downscaled) is refused: ${bad.message}`)}
  // the #761 failure as it was: the facade through the old recipe (TOWN.stone widened, texture post) comes out speckled, and the gate says so
  const oldRecipe=e=>({...e,palette:{from:['TOWN.stone']},post:{fit:'scale',downscale:'mode',transparent:true,outline:true,minColors:4}});
  const oldOut=e=>postProcess(FB.painterlyFacade(sizeOf(e,32)),oldRecipe(e),resolvePalette({from:['TOWN.stone']},PAL).colors,PAL.MARK.outline,{hint:4,minPalette:10,factors:PAL.TIER_SHADES[32].factors});
  {const e=byId.get('building:stone-hall'),g=PF.styleGate(oldOut(e),pal('stone'),PF.gateOf(e));
    ok(!g.ok&&g.colors>PF.GATE.maxColors&&g.speckle>PF.GATE.maxSpeckle,`regression fixture: the old recipe gives ${g.colors} colours and ${Math.round(g.speckle*100)}% lone pixels; the gate refuses it (${g.why.join('; ')})`)}
  // art:accept: the in-game look and the style gate
  {const dir=mkTmp('eldmoor-accept-'),date='2026-11-04',{writeIndex}=await import('./art/gen.mjs'),{recordPreview}=await import('./art/preview.mjs');
    try{const q=QUEUE0(),ii={version:1,assets:{}},inc=join(dir,'incoming',date),put=(id,png)=>{const key=tierKey(id,32),file=fileOf(id,32),p=join(inc,file);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,png);q.incoming[key]={date,file};const sz=pngSize(png);ii.assets[key]={id,tier:32,kind:id.split(':')[0],file,w:sz.w,h:sz.h}};
      const hall=byId.get('building:stone-hall'),inn=byId.get('building:stone-inn'),auction=byId.get('building:stone-auction');
      const good=run(hall,FB.flatBuilding(PAL.FLAT.stone,sizeOf(hall,32))),gi=run(inn,FB.flatBuilding(PAL.FLAT.stone,sizeOf(inn,32)));
      put('building:stone-hall',encodePng(good));put('building:stone-auction',encodePng(oldOut(auction)));put('building:stone-inn',encodePng(gi));writeIndex(inc,ii);saveQueue(dir,q);
      const acc=a=>new Promise(f=>{const c=spawn(process.execPath,[join(ROOT,'scripts','art','accept.mjs'),'--dir',dir,...a],{stdio:['ignore','pipe','pipe']});let s='';c.stdout.on('data',d=>s+=d);c.stderr.on('data',d=>s+=d);c.on('close',code=>f({code,s}))});
      let r=await acc(['--list']);ok(/stone-hall@32 .*needs npm run art:preview first/.test(r.s),'art:accept --list marks buildings that still need their in-game look');
      r=await acc(['building:stone-hall']);ok(r.code===2&&/refused: no in-game look yet/.test(r.s)&&!existsSync(join(dir,'building')),'a building without an art:preview shot is refused');
      const shot=encodePng(synth(8,8));for(const k of ['building:stone-hall@32','building:stone-auction@32'])recordPreview(dir,k,{shot,town:'fixture town'});
      recordPreview(dir,'building:stone-inn@32',{shot,town:'fixture town',view:{w:1280,h:800,zoom:1}});
      r=await acc(['building:stone-auction']);ok(r.code===2&&/refused: off-style \(\d+ colours/.test(r.s)&&!existsSync(join(dir,fileOf('building:stone-auction',32))),'a speckled building is refused by the style gate even with its preview: '+((r.s.match(/off-style \([^)]*\)/)||[''])[0]));
      r=await acc(['building:stone-inn']);ok(r.code===2&&/not at 3440x1440, zoom 1/.test(r.s),'a preview shot at another size is not the in-game check');
      const hp=join(inc,fileOf('building:stone-hall',32)),tweak=decodePng(readFileSync(hp));tweak.data[3]=tweak.data[3]?0:255;writeFileSync(hp,encodePng(tweak));
      r=await acc(['building:stone-hall']);ok(r.code===2&&/an earlier image/.test(r.s),'a preview of an earlier image (reprocessed since) does not count');
      writeFileSync(hp,encodePng(good));r=await acc(['building:stone-hall']);const a=loadIndex(dir).assets['building:stone-hall@32'];
      ok(r.code===0&&a&&a.check&&a.check.preview===`incoming/${date}/building/32/stone-hall.preview.png`&&a.check.view.zoom===1&&a.check.gate.ok&&a.check.town==='fixture town'&&!a.preview&&!checkIndex(man,dir).errs.length,'with its in-game look and a clean gate it is accepted, and the index records the check')}
    finally{rmSync(dir,{recursive:true,force:true})}}
  // the trial switch for a view-following model
  {const m2=JSON.parse(JSON.stringify(man));ok(m2.kindModel&&m2.kindModel.on===false&&m2.kindModel.model==='ume-flux'&&man.assets.every(e=>e.model===undefined),'kindModel: ume-flux prepared for buildings and landmarks, switched off');
    m2.kindModel.on=true;withKindModel(m2);ok(m2.assets.every(e=>(e.kind==='building'||e.kind==='landmark')===(e.model==='ume-flux')),'switched on, every building and landmark asks ume-flux and nothing else changes');
    const m3=JSON.parse(JSON.stringify(man));m3.kindModel.model='nope';ok(validateManifest(m3,PAL,resolvePalette).some(x=>/kindModel: unknown model nope/.test(x)),'an unknown kindModel model is a manifest error')}}
console.log('sprite sheets (#711, scripts/art/post-sheet.mjs)');
{const F=await import('./art/fixtures.mjs'),{processRaw}=await import('./art/gen.mjs'),A=id=>man.assets.find(a=>a.id===id),pm=man.models['pixel-xl'];
  const keySet=new Set(Object.keys(PAL.recolour(1))),hex=(d,o)=>'#'+[d[o],d[o+1],d[o+2]].map(v=>v.toString(16).padStart(2,'0')).join('');
  const run=(e,v={},tier=32)=>{try{return processRaw(encodePng(F.sheetArt(e,{tier,...v})),e,PAL,pm,tier,man).img}catch(err){return {err}}};
  let bad=[];
  for(const e of man.assets.filter(a=>a.kind==='sprite')){const im=run(e);if(im.err){bad.push(`${e.id}: ${im.err.message}`);continue}
    const [W,H]=sizeOf(e,32),{cols,rows}=e.frames,fw=W/cols,fh=H/rows,pal=new Set([...expandPalette(resolvePalette(e.palette,PAL).colors,PAL.TIER_SHADES[32].minPalette,PAL.TIER_SHADES[32].factors),PAL.MARK.outline]);
    if(im.w!==W||im.h!==H){bad.push(`${e.id}: ${im.w}x${im.h}`);continue}
    const floors=new Set();let empty=0,corner=0,off=0;
    for(let r=0;r<rows;r++)for(let k=0;k<cols;k++){let n=0,low=-1;
      for(let y=r*fh;y<(r+1)*fh;y++)for(let x=k*fw;x<(k+1)*fw;x++){const o=(y*W+x)*4;if(!im.data[o+3])continue;n++;low=Math.max(low,y-r*fh);if(!pal.has(hex(im.data,o)))off++}
      if(!n)empty++;floors.add(low);for(const [x,y] of [[0,0],[fw-1,0]]){if(im.data[((r*fh+y)*W+k*fw+x)*4+3])corner++}}
    if(empty||corner||off||floors.size!==1||[...floors][0]!==fh-1)bad.push(`${e.id}: ${empty} empty frames, ${corner} filled top corners, ${off} pixels off the palette, feet at ${[...floors]}`)}
  ok(!bad.length,`every sheet (${man.assets.filter(a=>a.kind==='sprite').length}): the model's 3x4 figures found and laid on the frame grid, one per frame, feet on the frame floor, clear background, palette and outline only`+(bad.length?': '+bad.join('; '):''));
  const w=A('sprite:hero-warrior'),a=run(w),b=run(w);ok(!a.err&&Buffer.from(a.data).equals(Buffer.from(b.data)),'deterministic');
  ok(!a.err&&a.notes.key==='12/12'&&a.notes.grid==='figures',`a hero sheet keeps its tabard in the faction key (${a.notes&&a.notes.key} frames)`);
  {let key=0,stray=0;const ramp=new Set([...PAL.SPRITE.key,...PAL.SPRITE.keyRamp]);for(let i=0;i<a.w*a.h;i++){const o=i*4;if(!a.data[o+3])continue;const h=hex(a.data,o);if(keySet.has(h))key++;if(ramp.has(h)&&!keySet.has(h))stray++}
    ok(key>100&&!stray&&PAL.SPRITE.keyRamp.every(c=>keySet.has(c)),`every tabard pixel takes the faction recolour (${key} pixels; the key ramp is in palette.js recolour)`)}
  const r3=run(w,{rows:3});ok(r3.err&&r3.err.kind==='flat'&&/layout: 3 rows of figures \(needs 4\)/.test(r3.err.message),'a sheet with 3 rows of figures is rejected (raw kept): '+(r3.err&&r3.err.message));
  const c2=run(w,{cols:2});ok(c2.err&&c2.err.kind==='flat'&&/layout: 2 columns/.test(c2.err.message),'a sheet with 2 columns is rejected: '+(c2.err&&c2.err.message));
  const nk=run(w,{key:false});ok(nk.err&&nk.err.kind==='flat'&&/no faction key/.test(nk.err.message),'a hero whose tabard is not the key colour is rejected: '+(nk.err&&nk.err.message));
  const wolf=run(A('sprite:mob-wolf'),{key:false});ok(!wolf.err&&!wolf.notes.key,'a creature sheet needs no faction key');
  const t64=run(w,{block:2},64);ok(!t64.err&&t64.w===192&&t64.h===384,`the 64 tier lays out the same figures at ${t64.w}x${t64.h}`+(t64.err?": "+t64.err.message:""));
  ok(/sprite sheet/.test(man.kindStyle.sprite)&&!/seamless/.test(man.kindStyle.sprite),'sprite prompts carry their own style (a sheet on plain ground, not a seamless tile)')}

console.log('gen.mjs and daily.mjs against a mock Hugging Face server');
const tmp=mkTmp('eldmoor-art-');
try{
  // The mock: the Hub's provider mapping (as seen on 2026-11-02) and fal-ai image routes, with switches for refusals.
  const MOCK_TOKEN='hf_mockArtcheckToken123',MAPS={
    'nerijs/pixel-art-xl':{'fal-ai':{status:'live',providerId:'fal-ai/fast-sdxl',task:'text-to-image',adapter:'lora',adapterWeightsPath:'pixel-art-xl.safetensors'}},
    'artificialguybr/PixelArtRedmond':{'fal-ai':{status:'live',providerId:'fal-ai/fast-sdxl',task:'text-to-image',adapter:'lora',adapterWeightsPath:'PixelArtRedmond-Lite64.safetensors'}},
    'UmeAiRT/FLUX.1-dev-LoRA-Modern_Pixel_art':{'fal-ai':{status:'live',providerId:'fal-ai/flux-lora',task:'text-to-image',adapter:'lora',adapterWeightsPath:'ume_modern_pixelart.safetensors'}},
    'tarn59/pixel_art_style_lora_z_image_turbo':{'fal-ai':{status:'live',providerId:'fal-ai/z-image/turbo/lora',task:'text-to-image',adapter:'lora',adapterWeightsPath:'pixel_art_style_z_image_turbo.safetensors'}},
    'black-forest-labs/FLUX.1-schnell':{'fal-ai':{status:'live',providerId:'fal-ai/flux/schnell',task:'text-to-image'}}};
  const SPACE={stages:[],posts:[],missing:new Set()};
  const S={costMode:null,costVal:0,posts:[],ok:0,lookups:0,deny:false,refuse:null,quota402:Infinity,quota429:Infinity,zeroLeft:false,flat:false,headers:[]};
  const img=encodePng(pixelArt()),flatImg=encodePng(pixelArt(1024,8,{flat:true}));
  // what a prompt asks for: a transition (two grounds, top and bottom) or a prop on a plain white background
  // the building recipe (#763): a prompt that asks for the flat look gets a flat top-down house in its style's flat palette
  const FB=await import('./art/fixtures-buildings.mjs'),flatOf=s=>encodePng(FB.flatBuilding(PAL.FLAT[s],[96,64]));
  const FX=await import('./art/fixtures.mjs'),sheetOf=id=>encodePng(FX.sheetArt(man.assets.find(a=>a.id===id)));
  const MOCK={tile:img,two:encodePng(twoGrounds()),corner:encodePng(discGrounds(false)),inner:encodePng(discGrounds(true)),prop:encodePng(propArt()),stone:encodePng(stoneArt()),house:encodePng(houseArt()),hero:sheetOf('sprite:hero-warrior'),beast:sheetOf('sprite:mob-wolf'),
    'flat-stone':flatOf('stone'),'flat-timber':flatOf('timber'),'flat-crypt':flatOf('crypt'),'flat-lair':flatOf('lair')},
    flatKind=pr=>/limestone/.test(pr)?'flat-stone':/tarred timber/.test(pr)?'flat-timber':/crypt/.test(pr)?'flat-crypt':/dragon's nest/.test(pr)?'flat-lair':null,
    mockKind=pr=>/character sprite sheet/.test(pr)?'hero':/creature sprite sheet/.test(pr)?'beast':/town wall|town gate/.test(pr)?'stone':/thick black outline/.test(pr)&&flatKind(pr)?flatKind(pr):/one building alone/.test(pr)?'house':/plain white background/.test(pr)?'prop':/rounded quarter circle/.test(pr)?(/in the top-left corner/.test(pr)?'inner':'corner'):/transition tile|upper half is/.test(pr)?'two':'tile';
  const srv=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    const u=new URL(req.url,'http://x');S.headers.push(req.headers);
    if(req.method==='GET'&&u.pathname.startsWith('/api/models/')){S.lookups++;const id=u.pathname.slice(12);res.setHeader('content-type','application/json');
      return res.end(JSON.stringify({id,inferenceProviderMapping:MAPS[id]||{}}))}
    if(req.method==='GET'&&u.pathname==='/img/out.png'){res.setHeader('content-type','image/png');return res.end(S.flat?flatImg:MOCK[u.searchParams.get('k')]||img)}
    if(req.method==='POST'&&u.pathname.startsWith('/fal-ai/')){
      if(S.deny||req.headers.authorization!==`Bearer ${MOCK_TOKEN}`){res.statusCode=401;return res.end('{"error":"Invalid credentials"}')}
      const j=JSON.parse(body);j.route=u.pathname;S.posts.push(j);
      if(S.refuse&&j.loras&&j.loras[0].path.includes(S.refuse)){res.statusCode=404;return res.end('{"error":"Model not found"}')}
      if(S.ok>=S.quota402){res.statusCode=402;return res.end('{"error":"You have exceeded your monthly included credits for Inference Providers."}')}
      if(S.ok>=S.quota429){res.statusCode=429;res.setHeader('retry-after',String(S.retryAfter||3600));return res.end('{"error":"You have reached your daily usage limit. Subscribe to PRO to get more credits."}')}
      S.ok++;res.setHeader('content-type','application/json');if(S.zeroLeft)res.setHeader('x-ratelimit-remaining','0');if(S.costMode==='header')res.setHeader('x-inference-cost',String(S.costVal));
      // alternate the two answer shapes fal gives: a data: URL and a URL to fetch
      const k=mockKind(j.prompt||''),im=S.flat?flatImg:MOCK[k];return res.end(JSON.stringify({...(S.costMode==='body'?{usage:{estimated_cost:S.costVal}}:{}),images:[{url:S.ok%2?'data:image/png;base64,'+im.toString('base64'):`http://127.0.0.1:${srv.address().port}/img/out.png?k=${k}`}]}))}
    // the mock Space (#703): the Hub's whoami, create, commit, hardware and status, then the Space's Gradio call protocol
    {const SP=SPACE,auth=req.headers.authorization||'';let m;
      if(req.method==='GET'&&u.pathname==='/api/whoami-v2'){res.setHeader('content-type','application/json');
        const fg=perms=>JSON.stringify({name:'tsc862',auth:{accessToken:{role:'fineGrained',fineGrained:{scoped:[{entity:{type:'user',name:'tsc862'},permissions:perms}]}}}});
        if(auth==='Bearer hf_readOnlyMock999')return res.end(JSON.stringify({name:'tsc862',auth:{accessToken:{role:'read'}}}));
        if(auth==='Bearer hf_fineNoWrite777')return res.end(fg(['repo.content.read']));
        if(auth===`Bearer ${MOCK_TOKEN}`)return res.end(fg(['repo.content.read','repo.write']));
        res.statusCode=401;return res.end('{"error":"Invalid credentials"}')}
      if(req.method==='POST'&&u.pathname==='/api/repos/create'){const j=JSON.parse(body);if(auth!==`Bearer ${MOCK_TOKEN}`){res.statusCode=403;return res.end('{}')}
        if(SP.exists){res.statusCode=409;return res.end('{"error":"You already created this space repo"}')}
        SP.exists=true;SP.creates++;SP.private=j.private;SP.created=j;res.setHeader('content-type','application/json');return res.end('{"url":"https://huggingface.co/spaces/tsc862/eldmoor-art"}')}
      if(req.method==='POST'&&(m=/^\/api\/spaces\/([^/]+\/[^/]+)\/commit\/main$/.exec(u.pathname))){if(auth!==`Bearer ${MOCK_TOKEN}`){res.statusCode=403;return res.end('{}')}
        const ls=body.trim().split('\n').map(l=>JSON.parse(l));SP.commits.push({ct:req.headers['content-type'],private:SP.private,header:ls[0],files:ls.slice(1).map(l=>({path:l.value.path,text:Buffer.from(l.value.content,'base64').toString('utf8')}))});
        res.setHeader('content-type','application/json');return res.end('{"commitOid":"abc123def4567890"}')}
      if(req.method==='POST'&&(m=/^\/api\/spaces\/([^/]+\/[^/]+)\/hardware$/.exec(u.pathname))){SP.hardware.push(JSON.parse(body).flavor);res.setHeader('content-type','application/json');return res.end('{}')}
      if(req.method==='GET'&&(m=/^\/api\/spaces\/([^/]+\/[^/]+)$/.exec(u.pathname))){SP.statusCalls++;const id=m[1];res.setHeader('content-type','application/json');
        if(SP.missing.has(id)){res.statusCode=404;return res.end('{"error":"Repository not found"}')}
        const stage=SP.broken?'RUNTIME_ERROR':SP.stages.length?SP.stages.shift():'RUNNING';
        return res.end(JSON.stringify({id,private:true,runtime:{stage,hardware:{current:stage==='RUNNING'?'zero-a10g':null,requested:'zero-a10g'}}}))}
      if(req.method==='GET'&&u.pathname==='/space/'){SP.wakes++;return res.end('<html></html>')}
      if(req.method==='GET'&&u.pathname==='/space/gradio_api/info'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({named_endpoints:{'/generate':{},...(SP.oldSpace?{}:{'/img2img':{}})}}))}
      if(req.method==='POST'&&/^\/space\/gradio_api\/call\/(generate|img2img)$/.test(u.pathname)){const api=u.pathname.split('/').pop();
        if(api==='img2img'&&SP.oldSpace){res.statusCode=500;return res.end('Internal Server Error')} // what Gradio answers for an API it does not have
        if(auth!==`Bearer ${MOCK_TOKEN}`){res.statusCode=401;return res.end('{"error":"Invalid credentials"}')}
        if(SP.ok>=SP.quota429){res.statusCode=429;res.setHeader('content-type','application/json');return res.end(JSON.stringify({error:'You have exceeded your GPU quota (25s requested vs. 12s left). Try again in 2:31:05'}))}
        const j=JSON.parse(body),id='ev'+(SP.posts.length+1);SP.posts.push({data:j.data,id,auth,api});res.setHeader('content-type','application/json');return res.end(JSON.stringify({event_id:id}))}
      if(req.method==='GET'&&(m=/^\/space\/gradio_api\/call\/(?:generate|img2img)\/(ev\d+)$/.exec(u.pathname))){const p=SP.posts.find(x=>x.id===m[1]);
        if(!p||auth!==`Bearer ${MOCK_TOKEN}`){res.statusCode=404;return res.end()}
        res.setHeader('content-type','text/event-stream');
        if(SP.sseQuota)return res.end('event: heartbeat\ndata: null\n\nevent: error\ndata: "You have exceeded your Pro GPU quota (25s requested vs. 3s left). Try again in 0:45:00"\n\n');
        if(SP.refuse&&p.data[8]===SP.refuse)return res.end(`event: error\ndata: ${JSON.stringify(`unknown LoRA '${p.data[8]}': not in the Space`)}\n\n`);
        SP.ok++;const k=p.api==='img2img'?'i2i-'+m[1]:mockKind(p.data[0]),file={path:`/tmp/gradio/${m[1]}.png`,url:`${base}/space/gradio_api/file=/tmp/gradio/${m[1]}.png?k=${k}`,orig_name:'image.png',meta:{_type:'gradio.FileData'}};
        return res.end(`event: heartbeat\ndata: null\n\nevent: complete\ndata: ${JSON.stringify([file,SP.gpuS])}\n\n`)}
      if(req.method==='GET'&&u.pathname.startsWith('/space/gradio_api/file=')){if(auth!==`Bearer ${MOCK_TOKEN}`){res.statusCode=403;return res.end()}
        const kk=u.searchParams.get('k'),ip=/^i2i-/.test(kk||'')&&SP.posts.find(x=>x.id===kk.slice(4));res.setHeader('content-type','image/png');
        if(ip)return res.end(encodePng(FX.img2imgArt(decodePng(Buffer.from(ip.data[5],'base64')),{strength:ip.data[6],seed:ip.data[2],...(SP.i2i||{})})));
        return res.end(MOCK[kk]||img)}}
    res.statusCode=404;res.end('no')})});
  await new Promise(f=>srv.listen(0,'127.0.0.1',f));const base=`http://127.0.0.1:${srv.address().port}`;
  const env={...process.env,HF_TOKEN:MOCK_TOKEN,HF_ROUTER_URL:base,HF_HUB_URL:base,ART_DAILY_BUDGET:'100'};delete env.ART_MAX_CALLS;for(const k of ['HF_ART_SPACE','HF_SPACE_URL','ART_GPU_MINUTES','ART_SPACE_POLL_MS'])delete env[k];env.HF_SPACE_TOKEN='';
  // gen.mjs and daily.mjs default to the Space (#703); the router tests ask for the router explicitly unless a test names a provider
  // the router has no image to image (#763): its runs take the manifest without kindInit, the text recipe on every kind
  const textMan=join(tmp,'manifest-text.json');{const j=JSON.parse(readFileSync(join(ROOT,'scripts','art','manifest.json'),'utf8'));delete j.kindInit;writeFileSync(textMan,JSON.stringify(j))}
  const node=(script,a,extra={})=>new Promise(f=>{const router=/^(gen|daily)\.mjs$/.test(script)&&!a.includes('--provider')&&!extra.HF_SPACE_URL;
    const c=spawn(process.execPath,[join(ROOT,'scripts','art',script),...(router?['--provider','router',...(a.includes('--manifest')?[]:['--manifest',textMan])]:[]),...a],{env:{...env,...extra},stdio:['ignore','pipe','pipe']});
    let s='';c.stdout.on('data',d=>s+=d);c.stderr.on('data',d=>s+=d);c.on('close',code=>f({code,s}))});
  const N=man.assets.length;
  // what art:preview writes (#763), without a browser: a stand-in shot recorded for every waiting building and landmark
  const {recordPreview}=await import('./art/preview.mjs');
  const previewAll=async dir=>{const q=loadQueue(dir);for(const k of Object.keys(q.incoming))if(/^(building|landmark):/.test(k))recordPreview(dir,k,{shot:encodePng(synth(8,8)),town:'fixture town'})};

  // --- gen.mjs: the direct tool, straight into an assets folder
  {const out=join(tmp,'gen-assets'),run=(...a)=>node('gen.mjs',['--out',out,...a]);
    let r=await run('--dry-run');ok(r.code===0&&/estimated cost: \$/.test(r.s)&&/dry run: first request POST .*\/fal-ai\/fal-ai\/fast-sdxl/.test(r.s)&&!S.posts.length&&!existsSync(out),'gen --dry-run: plan, cost and the first request; no image call, no files');
    ok(/"loras"/.test(r.s)&&/pixel-art-xl\.safetensors/.test(r.s)&&/"seed": 1771/.test(r.s),'the request carries the LoRA from the Hub lookup and the seed');
    r=await run();ok(r.code===0&&/add --yes/.test(r.s)&&!S.posts.length,'gen without --yes: plan only');
    r=await run('--yes','--max','1');ok(r.code===0&&S.posts.length===1&&/stopping at --max 1/.test(r.s),'gen --max 1 makes one image');
    ok(checkIndex(man,out).count===1&&!checkIndex(man,out).errs.length,'index valid after one');
    r=await run('--yes');ok(r.code===0&&S.posts.length===N,`gen makes the rest (${S.posts.length}/${N} calls)`+(r.code?': '+r.s.split('\n').filter(l=>/failed/.test(l)).join('; '):''));
    {const {errs,count}=checkIndex(man,out);ok(count===N&&!errs.length,'assets present: index matches files, sizes and sha256'+(errs.length?': '+errs.join('; '):''))}
    ok(S.posts.every(p=>p.prompt.startsWith('pixel art, ')&&p.negative_prompt&&p.image_size.width===1024),'prompts carry the trigger, style and negative');
    ok(S.headers.every(h=>!Object.keys(h).some(k=>/bill|x-fal|provider-key/i.test(k))),'no billing or provider-key header is ever sent');
    for(const e of man.assets){const im=decodePng(readFileSync(join(out,fileOf(e.id)))),sh=PAL.TIER_SHADES[TILE],pal=new Set(expandPalette(resolvePalette(e.palette,PAL).colors,(e.post&&e.post.minPalette)??sh.minPalette,sh.factors).map(c=>hexToRgb(c).join(',')));
      if(e.post&&e.post.outline)pal.add(hexToRgb(e.post.outlineColor||PAL.MARK.outline).join(',')); // a prop's 1px outline
      let bad=0;for(let i=0;i<im.w*im.h;i++){const o=i*4;if(im.data[o+3]&&!pal.has([im.data[o],im.data[o+1],im.data[o+2]].join(',')))bad++}
      if(bad||im.w!==sizeOf(e)[0]||im.h!==sizeOf(e)[1])ok(false,`${e.id}: ${im.w}x${im.h}, ${bad} pixels off the palette`)}
    ok(true,`every generated asset has its size and palette colours only (${N})`);
    {const ix=loadIndex(out);ok(Object.entries(ix.assets).every(([k,a])=>a.tier===TILE&&k===tierKey(a.id,TILE)&&a.file===fileOf(a.id,TILE)),`index entries carry their tier: '${tierKey('tile:grass')}' -> ${fileOf('tile:grass')}`)}
    ok(S.posts.every(p=>!p.loras||p.loras[0].scale===tierCfg(man,man.models['pixel-xl'],TILE).loraScale),`every request at the ${TILE} tier asks LoRA scale ${tierCfg(man,man.models['pixel-xl'],TILE).loraScale}`);
    ok(S.lookups>=1,'provider mapping looked up on the Hub');
    r=await run('--yes');ok(r.code===0&&/nothing to do/.test(r.s)&&S.posts.length===N,'a second run has nothing to do');
    S.deny=true;r=await run('--yes','--force','--only',man.assets[0].id);S.deny=false;ok(r.code!==0&&/401 bad or missing HF_TOKEN/.test(r.s)&&!r.s.includes(MOCK_TOKEN),'a refused token is reported, never printed');
    ok(!checkIndex(man,out).errs.length,'a failed run leaves the index intact');
    r=await run('--yes','--only','tile:nope');ok(r.code===2&&/not in the manifest/.test(r.s),'--only refuses an unknown id');
    writeFileSync(join(out,'tile','stray.png'),encodePng(synth(16,16)));
    writeFileSync(join(out,fileOf(man.assets[0].id)),encodePng(synth(8,8)));
    const {errs}=checkIndex(man,out);ok(errs.some(x=>/stray\.png is not in/.test(x))&&errs.some(x=>/8x8, manifest says/.test(x))&&errs.some(x=>/sha256 differs/.test(x)),'stray file, wrong size and changed file are caught')}

  // --- free sets (#789): the index takes source and license, the cutter builds our dual-grid pieces, a pack-covered id is not generated
  {const {pieces}=await import('./art/packcut.mjs'),{licenceOk}=await import('./art/lpc-heroes.mjs'),{jobsFor}=await import('./art/daily.mjs'),{PACKS,SETS}=await import('./art/packs.mjs');
    const solid=(c,w=32,h=32)=>{const d=new Uint8Array(w*h*4);for(let i=0;i<w*h;i++){d[i*4]=c[0];d[i*4+1]=c[1];d[i*4+2]=c[2];d[i*4+3]=255}return {w,h,data:d}};
    // an island like LPC's: 3x3 tiles, opaque from 8 px in, transparent around; a hole sheet: 2x2 tiles, a transparent 16 px hole
    const island=(()=>{const im=solid([200,0,0],96,96);for(let y=0;y<96;y++)for(let x=0;x<96;x++)if(x<8||y<8||x>=88||y>=88)im.data[(y*96+x)*4+3]=0;return im})();
    const hole=(()=>{const im=solid([200,0,0],64,64);for(let y=24;y<40;y++)for(let x=24;x<40;x++)im.data[(y*64+x)*4+3]=0;return im})();
    const ps=pieces(solid([0,200,0]),island,{im:hole,b:solid([0,200,0])}),at=(im,x,y)=>im.data[(y*im.w+x)*4];
    ok(Object.values(ps).every(p=>p.w===32&&p.h===32),'the cutter makes 32x32 edge, corner and inner pieces');
    ok(at(ps.edge,16,2)===0&&at(ps.edge,16,29)===200,'edge: the ground on top and the island below (boundary through the middle)');
    ok(at(ps.corner,2,2)===0&&at(ps.corner,29,29)===200,'corner: the island only in the bottom-right quarter');
    ok(licenceOk('CC-BY-SA 3.0, GPL 3.0')&&licenceOk('OGA-BY 3.0')&&licenceOk('OGA-BY 3.0+, GPL 3.0, CC-BY 4.0')&&licenceOk('CC0')&&!licenceOk('GPL 3.0')&&!licenceOk('CC-BY-NC 4.0')&&!licenceOk(''),'the hero cutter takes a layer only when CC-BY-SA 3.0, OGA-BY 3.0 or CC0 is offered');
    const dir=join(tmp,'pack-assets');mkdirSync(join(dir,'tile','32'),{recursive:true});const g=man.assets.find(e=>e.id==='tile:grass'),png=encodePng(synth(...sizeOf(g)));writeFileSync(join(dir,'tile','32','grass.png'),png);
    const entry={id:'tile:grass',kind:'tile',file:'tile/32/grass.png',w:sizeOf(g)[0],h:sizeOf(g)[1],sha256:sha256(png),tier:32,source:'lpc-base',license:'CC-BY-SA 3.0'};
    writeFileSync(join(dir,'index.json'),JSON.stringify({version:1,assets:{'tile:grass@32':entry}}));
    mkdirSync(join(dir,'packs','lpc-base'),{recursive:true});writeFileSync(join(dir,'packs','lpc-base','stray.png'),png); // the packs folder is never an asset
    ok(!checkIndex(man,dir).errs.length,'an index entry with source and license passes, and assets/packs is not walked for strays');
    writeFileSync(join(dir,'index.json'),JSON.stringify({version:1,assets:{'tile:grass@32':{...entry,license:undefined}}}));
    ok(checkIndex(man,dir).errs.some(x=>/names no license/.test(x)),'an entry from a set with no license is refused');
    writeFileSync(join(dir,'index.json'),JSON.stringify({version:1,assets:{'tile:grass@32':entry}}));
    ok(!jobsFor(man,loadIndex(dir),loadQueue(dir)).some(j=>j.e.id==='tile:grass'),'an id a pack covers is skipped by the generator');
    ok(Object.values(SETS).every(x=>x.licence&&x.link&&x.author)&&PACKS.endsWith('packs'),'every set names its licence, author and link');
    // a sheet of a people (#789): an index-only entry with no manifest row passes its own checks; the renderer picks people, then class, then nothing
    {const sd=join(tmp,'people-assets');mkdirSync(join(sd,'sprite','32'),{recursive:true});const sp=encodePng(synth(96,192));writeFileSync(join(sd,'sprite','32','hero-warrior-ashfolk.png'),sp);
      const ent={id:'sprite:hero-warrior-ashfolk',kind:'sprite',file:'sprite/32/hero-warrior-ashfolk.png',w:96,h:192,sha256:sha256(sp),tier:32,source:'lpc-generator',license:'CC-BY-SA 3.0'};
      writeFileSync(join(sd,'index.json'),JSON.stringify({version:1,assets:{'sprite:hero-warrior-ashfolk@32':ent}}));
      ok(!checkIndex(man,sd).errs.length,'an index-only people sheet (no manifest row) passes when it names its source and license');
      writeFileSync(join(sd,'index.json'),JSON.stringify({version:1,assets:{'sprite:hero-warrior-ashfolk@32':{...ent,license:undefined}}}));
      ok(checkIndex(man,sd).errs.some(x=>/names no license/.test(x)),'and is refused without a license');
      const SPR=await import('../src/render/sprites.js'),AS=await import('../src/render/assets.js'),px=AS.pixelsOf(96,192,new Uint8Array(96*192*4));
      AS.setAssetPixels('sprite:hero-warrior',px);AS.setAssetPixels('sprite:hero-warrior-ashfolk',px);
      ok(SPR.heroSheetId('Warrior','ashfolk')==='sprite:hero-warrior-ashfolk'&&SPR.heroSheetId('Warrior','tarrow')==='sprite:hero-warrior'&&SPR.heroSheetId('Warrior')==='sprite:hero-warrior'&&SPR.heroSheetId('Mage','ashfolk')==='sprite:hero-mage'&&SPR.heroSheetId('Nobody','ashfolk')===null,'the renderer takes the people sheet of a hero, else the class sheet, else the procedural sprite');
      AS.setAssetPixels('sprite:hero-warrior',null);AS.setAssetPixels('sprite:hero-warrior-ashfolk',null);ok(SPR.heroSheetId('Warrior','ashfolk')==='sprite:hero-warrior','and falls back when the sheets leave (ids are re-read when assets change)')}}

  // --- daily.mjs: quota-driven, resumable, into incoming/<date>/ for review
  {const dir=join(tmp,'assets'),logP=join(tmp,'art.log'),days=['2026-11-03','2026-11-04','2026-11-05','2026-11-06','2026-11-07','2026-11-08','2026-11-09','2026-11-10'];let d=0;
    const daily=(a=[],extra)=>node('daily.mjs',['--dir',dir,'--log',logP,...a],extra),Q=()=>JSON.parse(readFileSync(join(dir,'queue.json'),'utf8'));
    const lastLog=()=>readFileSync(logP,'utf8').trim().split('\n').pop(),P0=()=>S.posts.length;
    S.posts=[];S.ok=0;
    let r=await daily(['--dry-run','--date',days[d]]);ok(r.code===0&&!S.posts.length&&new RegExp(`${N} to make \\(missing assets\\), first tile:grass`).test(r.s)&&/try pixel-xl, pixel-redmond/.test(r.s),'daily --dry-run: the plan in priority order, no call');
    // day 1: the first candidate is refused, the second answers and is pinned; the allowance runs out after 4 (HTTP 402)
    S.refuse='nerijs';S.quota402=4;r=await daily(['--date',days[d]]);
    let q=Q();ok(r.code===0&&q.model.pinned==='pixel-redmond'&&q.model.tried['pixel-xl']&&q.model.tried['pixel-xl'].ok===false,'a refused model is recorded and the next candidate answers and is pinned');
    ok(Object.keys(q.incoming).length===4&&readdirSync(join(dir,'incoming',days[d],'tile','32')).length===4,'4 made into assets/incoming/<date>/ before the allowance ran out');
    ok(/made 4 \| rejected 0 \| calls 6 \| estimated \$0\.040 \(month \$0\.040 of \$2\.00 credits\)/.test(lastLog())&&/stop: allowance used: HTTP 402/.test(lastLog())&&/next: tile:mud/.test(lastLog()),'art.log: made, calls, estimated credits, the 402 stop and what is next: '+lastLog());
    ok(existsSync(join(dir,'incoming',days[d],'sheet.html'))&&existsSync(join(dir,'incoming',days[d],'index.json')),'contact sheet and index written beside the incoming assets');
    ok(!existsSync(join(dir,'index.json')),'nothing lands in assets/ before review');
    {const ri=loadIndex(join(dir,'incoming',days[d],'raw'));const ks=Object.keys(ri.assets);
      ok(ks.length===4&&ks.every(k=>{const f=join(dir,'incoming',days[d],'raw',ri.assets[k].file);return existsSync(f)&&pngSize(readFileSync(f)).w===1024&&ri.assets[k].seed&&ri.assets[k].model==='pixel-redmond'}),'the provider image is kept raw (1024 px) with its seed and model')}
    const p1=P0();r=await daily(['--date',days[d]]);ok(/already ran today/.test(r.s)&&P0()===p1,'a second run the same day makes no call');
    // day 2: resumes where it stopped; a 429 that speaks of a daily limit stops it
    d++;S.refuse=null;S.quota402=Infinity;S.ok=0;S.quota429=3;const seen=new Set(S.posts.map(p=>p.seed));r=await daily(['--date',days[d]]);
    q=Q();const fresh=S.posts.slice(p1);ok(r.code===0&&Object.keys(q.incoming).length===7&&fresh.filter(p=>p.seed&&!seen.has(p.seed)).length===3,'resumes with the next assets, nothing redrawn');
    ok(/stop: allowance used: HTTP 429/.test(lastLog())&&fresh.every(p=>p.loras&&/PixelArtRedmond/.test(p.loras[0].path)),'a quota 429 stops it; the pinned model stays');
    // day 3: ART_MAX_CALLS caps the run
    d++;S.quota429=Infinity;S.ok=0;const p3=P0();r=await daily(['--date',days[d]],{ART_MAX_CALLS:'2'});ok(P0()-p3===2&&/stop: ART_MAX_CALLS 2 reached/.test(lastLog()),'ART_MAX_CALLS caps the calls');
    // day 4: rate headers at zero stop after the call that said so
    d++;S.zeroLeft=true;const p4=P0();r=await daily(['--date',days[d]]);S.zeroLeft=false;ok(P0()-p4===1&&/stop: rate headers/.test(lastLog())&&Object.keys(Q().incoming).length===10,'rate headers at 0 stop the run');
    // review: accept some, reject one; --now on the same day runs again and redraws the rejected one with a new seed
    r=await node('accept.mjs',['--dir',dir,'--list']);ok(/waiting for review \(10\)/.test(r.s),'art:accept --list shows what waits');
    r=await node('accept.mjs',['--dir',dir,'tile:grass','tile:snow']);ok(r.code===0&&checkIndex(man,dir).count===2&&!checkIndex(man,dir).errs.length,'accepted assets move into assets/ and the index (artcheck passes)');
    // art:review (#712): per kind counts, spend, what is missing, stale inbox entries hidden, in-game kinds flagged for a preview
    {const q0=Q(),w0=Object.keys(q0.incoming).length,rv=await node('review.mjs',['--dir',dir,'--log',logP,'--json']);let js=null;try{js=JSON.parse(rv.s)}catch{}
      ok(rv.code===0&&js&&js.waiting===w0&&js.stale.length===0&&js.rows.find(x=>x.kind==='tile').accepted===2,'art:review counts what waits and what is accepted per kind');
      ok(js&&js.rows.every(x=>x.missing.length===x.manifest-x.accepted-x.waiting.length)&&/Spend:/.test((await node('review.mjs',['--dir',dir,'--log',logP])).s),'art:review: missing = manifest - accepted - waiting; prints spend');
      const qs=JSON.parse(JSON.stringify(q0));qs.incoming['tile:grass@32']={date:Object.values(q0.incoming)[0].date,file:'tile/32/grass.png'};
      qs.incoming['building:stone-inn@32']={date:'2026-01-01',file:'building/32/stone-inn.png'};qs.rejected['sprite:hero-mage@32']=2;qs.failed['prop:rock-meadow-1@32']={tries:1,why:'HTTP 500',at:'x'};qs.stats={sprite:{made:3,flat:1,failed:0}};
      const sm=summarize({man,idx:loadIndex(dir),q:qs,logText:'',tier:32}),txt=render(sm);
      ok(staleIncoming(qs,loadIndex(dir)).join()==='tile:grass@32'&&sm.waiting===w0+1,'art:review skips inbox ids already in assets/index.json');
      ok(sm.preview.some(x=>x.kind==='building'&&x.keys.includes('building:stone-inn@32'))&&IN_GAME_KINDS.join()==='building,landmark,sprite'&&/needs an in-game preview first/.test(txt)&&/rejected/.test(txt)&&/prop:rock-meadow-1@32: HTTP 500/.test(txt)&&sm.rows.find(x=>x.kind==='sprite').rejected===2&&sm.rows.find(x=>x.kind==='sprite').flat===1,'art:review flags buildings, landmarks and sprites for an in-game preview and shows rejects and failures with why');
      const w=JSON.parse(JSON.stringify(q0));w.incoming['tile:grass@32']=qs.incoming['tile:grass@32'];writeFileSync(join(dir,'queue.json'),JSON.stringify(w));
      r=await node('accept.mjs',['--dir',dir,'--list']);ok(r.s.includes('waiting for review ('+w0+')')&&r.s.includes('already in assets/index.json, skipped: tile:grass@32'),'art:accept --list skips ids already in the index');
      writeFileSync(join(dir,'queue.json'),JSON.stringify(q0))}
    // art:review on a fixture inbox (#712): slices, days, sheet per day, accept line without in-game kinds, --json; and an empty tree
    {const RF=reviewFixture(),rd=join(tmp,'review-assets'),w=(f,t)=>{mkdirSync(dirname(join(rd,f)),{recursive:true});writeFileSync(join(rd,f),t)};
      const base=loadIndex(dir);base.assets={'tile:grass@32':base.assets['tile:grass@32']||{id:'tile:grass',tier:32}};w('index.json',JSON.stringify(base));
      for(const f of RF.files)w(f,'<html></html>');utimesSync(join(rd,'incoming/2026-11-02/sheet.html'),new Date(1e12),new Date(1e12));utimesSync(join(rd,'incoming/2026-11-02/sheet-2.html'),new Date(2e12),new Date(2e12));
      w('queue.json',JSON.stringify(RF.queue));
      const rj=await node('review.mjs',['--dir',rd,'--log',join(tmp,'none.log'),'--json']);let j=null;try{j=JSON.parse(rj.s)}catch{}
      const sl=n=>j&&j.slices.find(x=>x.name===n),dnew=j&&j.days.find(x=>x.date==='2026-11-02'),dold=j&&j.days.find(x=>x.date==='2026-10-30');
      ok(j&&j.slices.map(x=>x.name).join()==='terrain,towns,sprites,portraits,scene,props'&&sl('terrain').waiting===2&&sl('towns').waiting===1&&sl('sprites').waiting===1&&sl('props').waiting===0&&sl('terrain').accepted===1,'art:review --json: counts per priority slice (terrain, towns, sprites, portraits, scene, props)');
      ok(dnew&&dnew.sheet==='assets/incoming/2026-11-02/sheet-2.html'&&dold&&dold.sheet==='assets/incoming/2026-10-30/sheet.html'&&j.days[0].date==='2026-11-02','art:review: the newest contact sheet per day, newest day first');
      ok(dnew.accept==='npm run art:accept -- tile:snow@32'&&dnew.preview.join()==='building:stone-inn@32,sprite:hero-mage@32'&&dold.accept==='npm run art:accept -- prop:tree-meadow-1@32'&&j.stale.join()==='tile:grass@32','art:review: the accept line keeps buildings, landmarks and sprites out (listed as needing an in-game preview); stale ids skipped');
      const rt=await node('review.mjs',['--dir',rd,'--log',join(tmp,'none.log')]);ok(/ready to accept: npm run art:accept -- tile:snow@32/.test(rt.s)&&/needs an in-game preview first, NOT in the line above (.*art:preview.*): building:stone-inn@32 sprite:hero-mage@32/.test(rt.s)&&/prop:rock-meadow-1@32: HTTP 500/.test(rt.s),'art:review text: ready line, preview warning, failures with why');
      const re=await node('review.mjs',['--dir',join(tmp,'no-such-assets'),'--log',join(tmp,'none.log')]);ok(re.code===0&&/nothing waiting/.test(re.s),'art:review with no assets/incoming and no queue prints "nothing waiting"')}
    r=await node('accept.mjs',['--dir',dir,'--reject','tile:mud']);q=Q();ok(r.code===0&&q.rejected['tile:mud@32']===1&&!q.incoming['tile:mud@32'],'a rejected asset leaves the queue for a redraw');
    r=await node('accept.mjs',['--dir',dir,'tile:nope']);ok(r.code===2,'accepting an unknown id is refused');
    const p5=P0();r=await daily(['--now','--date',days[d]]);q=Q();
    ok(S.posts.slice(p5).some(p=>p.seed===1775+7919),'the rejected asset is redrawn with a new seed');
    ok(Object.keys(q.incoming).length+checkIndex(man,dir).count===N,`--now finishes the manifest (${Object.keys(q.incoming).length} waiting + ${checkIndex(man,dir).count} accepted)`);
    // buildings and landmarks (#763) wait for an in-game look: refused without an art:preview record, taken with one
    {const gatedN=man.assets.filter(e=>e.kind==='building'||e.kind==='landmark').length;
      r=await node('accept.mjs',['--dir',dir,'all']);const left=Object.keys(Q().incoming);
      ok(r.code===2&&/refused: no in-game look yet\. Run npm run art:preview/.test(r.s)&&left.length===gatedN&&left.every(k=>/^(building|landmark):/.test(k))&&checkIndex(man,dir).count===N-gatedN,`accept all without a preview: the ${gatedN} buildings and landmarks are refused and stay waiting, the rest are accepted`);
      await previewAll(dir)}
    r=await node('accept.mjs',['--dir',dir,'all']);ok(r.code===0&&checkIndex(man,dir).count===N&&!checkIndex(man,dir).errs.length&&!Object.keys(Q().incoming).length,'accept all: every asset in assets/, index valid'+(r.code?': '+r.s.slice(0,400):''));
    {const ix=loadIndex(dir),b=Object.values(ix.assets).filter(a=>/^(building|landmark):/.test(a.id));
      ok(b.length&&b.every(a=>a.check&&a.check.view.w===3440&&a.check.view.zoom===1&&/\.preview\.png$/.test(a.check.preview)&&!a.preview)&&b.filter(a=>a.check.gate).every(a=>a.check.gate.ok&&a.check.gate.colors<=8),`accepted buildings and landmarks record the in-game check (shot, 3440x1440, zoom 1) and the style gate (${b.length})`)}
    {const sh=await node('sheet.mjs',['--assets',dir,'--out',join(tmp,'sheet.html')]);const html=existsSync(join(tmp,'sheet.html'))?readFileSync(join(tmp,'sheet.html'),'utf8'):'';
      const TN=man.assets.filter(e=>e.hook.module==='src/render/terrain.js').length; // terrain fallbacks are painted in Node; sprite fallbacks need a canvas
      ok(sh.code===0&&(html.match(/<img /g)||[]).length>=N*3+TN*3,`contact sheet: ${N} assets at 1x/2x/4x and the ${TN} terrain fallbacks`+(sh.code?' '+sh.s.slice(0,300):' ('+(html.match(/<img /g)||[]).length+' images)'))}
    // alternates once the manifest is complete; an accepted alternate replaces its asset
    d++;const p6=P0();r=await daily(['--date',days[d],'--max','3']);q=Q();
    ok(P0()-p6===3&&Object.keys(q.incoming).every(k=>/#alt1$/.test(k))&&S.posts.slice(p6).every(p=>p.seed>=2771),'complete manifest: alternates with new seeds (--max 3)');
    await previewAll(dir);const altKey=Object.keys(q.incoming)[0],before=checkIndex(man,dir);r=await node('accept.mjs',['--dir',dir,altKey]);
    {const ix=loadIndex(dir),id=altKey.split('#')[0];ok(r.code===0&&ix.assets[id].fromAlt===1&&before.count===N&&!checkIndex(man,dir).errs.length,'an accepted alternate replaces its asset')}
    d++;r=await daily(['--date','2026-12-10'],{ART_MAX_CALLS:'400'});await previewAll(dir);r=await node('accept.mjs',['--dir',dir,'all']); // all the alternates in one run (2 per asset exceeds the default 100 calls as the manifest grows), in a new month: November's $2.00 is spent by now
    d++;const p7=P0();r=await daily(['--date','2026-12-11']);ok(P0()===p7&&/manifest complete, alternates too: no call/.test(lastLog()),'everything made: no call at all');
    ok(readFileSync(logP,'utf8').trim().split('\n').every(l=>/^\d{4}-\d\d-\d\d \d\d:\d\d \| made \d+ \| rejected \d+ \| calls \d+ \| (?:estimated|billed|mixed) \$[\d.]+(?: \(billed \$[\d.]+\))? \(month \$[\d.]+ of \$2\.00 credits\)/.test(l)),'every art.log line has date, made, rejected, calls and the estimated credits');
    S.deny=true;r=await daily(['--now','--date',days[d],'--dir',join(tmp,'assets2')]);S.deny=false;ok(r.code===2&&/HTTP 401/.test(lastLog())&&!readFileSync(logP,'utf8').includes(MOCK_TOKEN),'a refused token stops the run and is never logged')}

  // --- flat outputs are rejected but kept raw; art:reprocess re-makes them offline; the credit budget
  {const dir=join(tmp,'assets3'),logP=join(tmp,'art3.log'),Q=()=>JSON.parse(readFileSync(join(dir,'queue.json'),'utf8')),last=f=>readFileSync(f,'utf8').trim().split('\n').pop();
    S.flat=true;S.ok=0;S.quota402=Infinity;S.quota429=Infinity;S.refuse=null;const p0=S.posts.length;
    let r=await node('daily.mjs',['--dir',dir,'--log',logP,'--date','2026-12-01','--max','5']);S.flat=false;let q=Q();
    ok(S.posts.length-p0===3&&/made 0 \| rejected 3 \| calls 3/.test(last(logP))&&/stop: 3 failures in a row \(flat/.test(last(logP)),'flat outputs are rejected (3 in a row stop the run): '+last(logP));
    const inc=join(dir,'incoming','2026-12-01');
    ok(Object.keys(loadIndex(join(inc,'raw')).assets).length===3&&!existsSync(join(inc,'tile'))&&Object.values(q.failed).every(f=>/flat/.test(f.why))&&!Object.keys(q.incoming).length,'nothing flat is written for review; the raw images and the reason are kept');
    {const r2=await node('daily.mjs',['--dir',dir,'--log',logP,'--date','2026-12-01','--dry-run']);ok(/first tile:grass/.test(r2.s),'a flat draw is retried on a later run');}
    const m2=JSON.parse(readFileSync(join(ROOT,'scripts','art','manifest.json'),'utf8'));for(const a of m2.assets)a.post={...a.post,minColors:1};const mp=join(tmp,'manifest-lenient.json');writeFileSync(mp,JSON.stringify(m2));
    const p1=S.posts.length;r=await node('reprocess.mjs',['2026-12-01','--dir',dir,'--manifest',mp]);q=Q();
    ok(r.code===0&&S.posts.length===p1&&/reprocessed 3, rejected 0/.test(r.s)&&Object.keys(q.incoming).length===3&&!Object.keys(q.failed).length,'art:reprocess re-makes them from the raw images with no call');
    ok(existsSync(join(inc,'sheet.html'))&&/model image/.test(readFileSync(join(inc,'sheet.html'),'utf8'))&&/raw\/tile\/32\/grass\.png/.test(readFileSync(join(inc,'sheet.html'),'utf8')),'the review sheet shows the model image beside the result');
    r=await node('reprocess.mjs',['2026-12-01','tile:grass','--dir',dir]);ok(r.code===0&&/tile:grass@32: rejected, flat/.test(r.s)&&!Q().incoming['tile:grass@32'],'reprocessing with the strict manifest rejects a flat one again');
    r=await node('reprocess.mjs',['2026-11-30','--dir',dir]);ok(r.code===0&&/no raw images kept/.test(r.s),'a day without raw images says so');
    // daily share of the monthly credits: $2.00 / 31 days = $0.0645, so 6 images at $0.01
    const dir4=join(tmp,'assets4'),log4=join(tmp,'art4.log'),p2=S.posts.length;
    r=await node('daily.mjs',['--dir',dir4,'--log',log4,'--date','2026-12-05','--no-carry'],{ART_DAILY_BUDGET:''});
    ok(S.posts.length-p2===6&&/stop: daily share \$0\.065 used \(estimated; spent today \$0\.060\)/.test(last(log4)),'a run stops at the day\'s share of the monthly credits: '+last(log4));
    r=await node('daily.mjs',['--dir',dir4,'--log',log4,'--date','2026-12-05','--no-carry'],{ART_DAILY_BUDGET:''});ok(S.posts.length-p2===6&&/already ran today/.test(r.s),'and does not run again that day');
    // the month's credits: a month already at $1.995 makes no call
    const log5=join(tmp,'art5.log');writeFileSync(log5,'2026-12-01 09:00 | made 199 | rejected 0 | calls 199 | est. $1.995 (month $1.995 of $2.00 credits) | model pixel-xl | stop: x | next: -\n');
    const p3=S.posts.length;r=await node('daily.mjs',['--dir',join(tmp,'assets5'),'--log',log5,'--date','2026-12-02']);
    ok(S.posts.length===p3&&/stop: monthly credits used/.test(last(log5)),'the month\'s credits used: no call')}

  // --- the 64 tier: same manifest, prompt and seed; the tier's LoRA scale, pixel grid, sizes and keys
  {const out=join(tmp,'tier64'),p0=S.posts.length;S.ok=0;S.quota402=Infinity;S.quota429=Infinity;S.refuse=null;S.flat=false;S.zeroLeft=false;
    let r=await node('gen.mjs',['--out',out,'--tier','64','--only','tile:grass,prop:tree-meadow-1','--yes']);const posts=S.posts.slice(p0),ix=loadIndex(out);
    ok(r.code===0&&posts.length===2&&posts.every(p=>p.loras&&p.loras[0].scale===.2)&&posts[0].seed===man.assets.find(a=>a.id==='tile:grass').seed,'gen --tier 64: LoRA scale 0.2, the same seed as the 32 tier'+(r.code?' '+r.s.slice(0,300):''));
    const g=ix.assets['tile:grass@64'],im=g&&decodePng(readFileSync(join(out,g.file)));
    ok(g&&g.tier===64&&g.file==='tile/64/grass.png'&&im.w===64&&im.h===64&&!checkIndex(man,out).errs.length,'its assets land as <kind>/64/<name>.png under keys @64 at the 64 size; the index check passes'+(checkIndex(man,out).errs.join('; ')));
    r=await node('gen.mjs',['--out',out,'--tier','16']);ok(r.code===2&&/not one of 32, 64/.test(r.s),'an unknown tier is refused');
    const dir6=join(tmp,'assets6'),log6=join(tmp,'art6.log');r=await node('daily.mjs',['--dir',dir6,'--log',log6,'--date','2026-12-07','--tier','64','--max','1']);
    const q6=existsSync(join(dir6,'queue.json'))?JSON.parse(readFileSync(join(dir6,'queue.json'),'utf8')):{incoming:{}};
    ok(r.code===0&&/tier 64: /.test(r.s)&&Object.keys(q6.incoming).join()==='tile:grass@64'&&existsSync(join(dir6,'incoming','2026-12-07','tile','64','grass.png')),'daily --tier 64 makes the 64 set into its own keys and folders for review'+(r.code?' '+r.s.slice(0,300):''))}

  // --- real cost (#661): the answer's own cost wins over the manifest guess; both are labelled; the month cap holds against the real spend
  {const dir=join(tmp,'cost-assets'),logP=join(tmp,'cost.log'),last=()=>readFileSync(logP,'utf8').trim().split('\n').pop(),Q=()=>JSON.parse(readFileSync(join(dir,'queue.json'),'utf8'));
    S.ok=0;S.quota402=Infinity;S.quota429=Infinity;S.refuse=null;S.flat=false;S.zeroLeft=false;S.costMode='header';S.costVal=0.02;let p0=S.posts.length;
    let r=await node('daily.mjs',['--dir',dir,'--log',logP,'--date','2026-12-05','--no-carry'],{ART_DAILY_BUDGET:''});
    ok(S.posts.length-p0===3&&/calls 3 \| billed \$0\.060 \(month \$0\.060 of \$2\.00 credits\).*stop: daily share \$0\.065 used \(billed; spent today \$0\.060\)/.test(last()),'a cost header on the answer is the spend (3 x $0.02, not the manifest\'s $0.01), labelled billed, and the daily share stops on it: '+last().slice(0,230));
    ok(Q().costProbe&&Q().costProbe.billed&&/x-inference-cost/.test(JSON.stringify(Q().costProbe.headers))&&/what the provider's answer says about cost: \$0\.02 \(header x-inference-cost\)/.test(r.s),'the first answer\'s cost-looking headers and body keys are recorded and printed once');
    S.costMode='body';S.costVal=0.015;p0=S.posts.length;r=await node('daily.mjs',['--dir',dir,'--log',logP,'--date','2026-12-06','--no-carry'],{ART_DAILY_BUDGET:''});
    ok(S.posts.length-p0===4&&/billed \$0\.060 /.test(last())&&/\(billed; spent today/.test(last()),'usage.estimated_cost in the body counts too (4 x $0.015)');
    S.costMode=null;p0=S.posts.length;r=await node('daily.mjs',['--dir',dir,'--log',logP,'--date','2026-12-07','--no-carry'],{ART_DAILY_BUDGET:''});
    ok(S.posts.length-p0===6&&/ estimated \$0\.060 /.test(last())&&/\(estimated; spent today/.test(last()),'no cost on the answer: the manifest guess, labelled estimated');
    S.costMode='header';S.costVal=0.02;p0=S.posts.length;
    {const l2=join(tmp,'cost2.log'),d2=join(tmp,'cost2-assets');writeFileSync(l2,'2026-12-01 09:00 | made 99 | rejected 0 | calls 99 | billed $1.970 (month $1.970 of $2.00 credits) | model pixel-xl | stop: x | next: -\n');
      r=await node('daily.mjs',['--dir',d2,'--log',l2,'--date','2026-12-31','--budget','100']);const ln=readFileSync(l2,'utf8').trim().split('\n').pop();
      ok(S.posts.length-p0===1&&/billed \$0\.020 \(month \$1\.990 of \$2\.00/.test(ln)&&/stop: monthly credits used/.test(ln),'the month cap is a hard stop against the billed spend: $1.97 + one $0.02 image, then the next $0.02 would pass $2.00 and no call is made: '+ln.slice(0,200))}
    S.costMode=null}

  // --- the loop (#661): fake clock and sleep, the real passes against the mock server
  {const dir=join(tmp,'loop-assets'),logP=join(tmp,'loop.log'),stP=join(tmp,'loop-state.json');
    S.ok=0;S.quota402=Infinity;S.quota429=Infinity;S.refuse=null;S.flat=false;S.zeroLeft=false;S.retryAfter=0;
    const logLines=f=>existsSync(f)?readFileSync(f,'utf8').trim().split('\n').filter(Boolean):[];
    const at=(y,m,d,h=0,mi=0)=>new Date(y,m-1,d,h,mi);
    const loop=async({start,until,dir:dr=dir,log=logP,state=stP,args=[],maxPasses=Infinity,onSleep,manifest,envx={}})=>{
      let t=start.getTime();const out=[],orig=console.log;console.log=(...a)=>out.push(a.join(' '));
      const keep=[process.env.HF_ROUTER_URL,process.env.HF_HUB_URL];process.env.HF_ROUTER_URL=base;process.env.HF_HUB_URL=base;
      try{await runLoop(['--loop','--provider','router','--dir',dr,'--log',log,'--state',state,...(manifest?['--manifest',manifest]:[]),...args],{...env,ART_DAILY_BUDGET:'',...envx},
        {now:()=>new Date(t),sleep:async ms=>{t+=ms;if(onSleep)onSleep(new Date(t))},stopped:()=>t>=until.getTime(),maxPasses})}
      finally{console.log=orig;if(keep[0]===undefined)delete process.env.HF_ROUTER_URL;else process.env.HF_ROUTER_URL=keep[0];if(keep[1]===undefined)delete process.env.HF_HUB_URL;else process.env.HF_HUB_URL=keep[1]}
      return out};
    // 1. a pass runs to the day's share ($2.00 / 31 days: 6 images), the retries spend nothing, midnight opens the next share
    let p0=S.posts.length,states=[];
    await loop({start:at(2026,12,1,8),until:at(2026,12,2,6),onSleep:()=>{try{const j=JSON.parse(readFileSync(stP,'utf8'));if(!states.length||states[states.length-1].next!==j.next)states.push(j)}catch{}}});
    let L=logLines(logP);
    ok(/^2026-12-01 08:00 .*made 6 .*stop: daily share \$0\.0\d+ used.*check again 2026-12-01 12:00 \(day's share spent\)/.test(L[0]||''),'loop: the first pass runs to the day\'s share and says when it checks again: '+L[0]);
    ok(L.length===6&&L.slice(1,4).every(l=>/made 0 \| rejected 0 \| calls 0/.test(l))&&/check again 2026-12-02 00:00/.test(L[3]),'loop: it checks again every 4 hours (12:00, 16:00, 20:00) with no call, the last wait ending at midnight');
    ok(/^2026-12-02 00:00 .*made 6 /.test(L[4]||'')&&S.posts.length-p0===12,'loop: at midnight the new day\'s share opens and a pass runs at once (6 more): '+(L[4]||'').slice(0,60));
    ok(states.some(j=>j.state==='waiting'&&/day's share/.test(j.why)&&j.last&&j.last.made===6&&j.last.monthly===2)&&JSON.parse(readFileSync(stP,'utf8')).state==='stopped','loop: the state file for the launcher: waiting with the next check and the last run, then stopped');
    // 2. carry: nothing made on the 3rd and 4th (the loop was not running); the 5th gets their share too, never past the month's total
    p0=S.posts.length;await loop({start:at(2026,12,5,8),until:at(2026,12,5,9),maxPasses:1});L=logLines(logP);
    ok(S.posts.length-p0===20&&/^2026-12-05 08:00 .*made 20 .*month \$0\.320 of \$2\.00/.test(L[L.length-1]),'loop: idle days carry their share: 20 images on the 5th ($0.2026 = 5 x $0.0645 less the $0.12 spent): '+L[L.length-1].slice(0,120));
    // 3. the month's cap is hard: $1.95 spent, the 31st has the whole month earned, only $0.05 is left; then the 1st reopens
    {const d3=join(tmp,'loop3'),l3=join(tmp,'loop3.log'),s3=join(tmp,'loop3-state.json');writeFileSync(l3,'2026-12-01 09:00 | made 195 | rejected 0 | calls 195 | est. $1.950 (month $1.950 of $2.00 credits) | model pixel-xl | stop: x | next: -\n');
      p0=S.posts.length;await loop({start:at(2026,12,31,8),until:at(2027,1,1,1),dir:d3,log:l3,state:s3});const L3=logLines(l3);
      ok(/^2026-12-31 08:00 .*made 5 .*month \$2\.000 of \$2\.00.*stop: monthly credits used.*check again 2027-01-01 00:00 \(month's credits spent\)/.test(L3[1]||'')&&L3.length===3,'loop: the month\'s credits are a hard stop (5 images, $2.000 of $2.00) and the next check is the 1st: '+(L3[1]||'').slice(0,200));
      ok(/^2027-01-01 00:00 .*made 6 /.test(L3[2]||'')&&S.posts.length-p0===11,'loop: on the 1st the new month\'s share opens (6 more)')}
    // 4. the provider refuses: a 402 sets the retry (4 h), a quota 429 whose retry-after is longer sets that
    {const d4=join(tmp,'loop4'),l4=join(tmp,'loop4.log');S.ok=0;S.quota402=2;p0=S.posts.length;
      await loop({start:at(2026,12,1,8),until:at(2026,12,1,9),dir:d4,log:l4,args:['--budget','100'],maxPasses:1});const L4=logLines(l4);
      ok(S.posts.length-p0===3&&/made 2 .*stop: allowance used: HTTP 402.*check again 2026-12-01 12:00 \(the provider refused\)/.test(L4[0]||''),'loop: a 402 ends the pass and sets the retry 4 hours on: '+(L4[0]||'').slice(0,200));
      const d5=join(tmp,'loop5'),l5=join(tmp,'loop5.log');S.ok=0;S.quota402=Infinity;S.quota429=0;S.retryAfter=21600;
      await loop({start:at(2026,12,1,8),until:at(2026,12,1,9),dir:d5,log:l5,args:['--budget','100'],maxPasses:1});const L5=logLines(l5);
      ok(/made 0 .*stop: allowance used: HTTP 429.*check again 2026-12-01 14:00 \(the provider refused\)/.test(L5[0]||''),'loop: a quota 429 with a 6 hour retry-after waits that long (later than the 4 hours): '+(L5[0]||'').slice(0,200));
      await loop({start:at(2026,12,1,8),until:at(2026,12,1,9),dir:d5,log:l5,args:['--budget','100','--retry-hours','9'],maxPasses:1});
      ok(/check again 2026-12-01 17:00 /.test(logLines(l5).pop()),'loop: --retry-hours changes the wait (9 hours)');
      S.quota429=Infinity;S.retryAfter=0}
    // 5. nothing left to make: told once, a pass at midnight, and a changed manifest wakes it
    {const d6=join(tmp,'loop6'),l6=join(tmp,'loop6.log'),mf=join(tmp,'manifest-tiny.json'),m3=JSON.parse(readFileSync(join(ROOT,'scripts','art','manifest.json'),'utf8')),all=m3.assets;
      m3.assets=all.slice(0,2);m3.alternatesWhenComplete=0;writeFileSync(mf,JSON.stringify(m3));let grown=false;p0=S.posts.length;S.ok=0;
      const out=await loop({start:at(2026,12,10,8),until:at(2026,12,12,6),dir:d6,log:l6,manifest:mf,args:['--budget','100'],onSleep:d=>{if(!grown&&d>=at(2026,12,10,12)){grown=true;m3.assets=all.slice(0,3);writeFileSync(mf,JSON.stringify(m3));utimesSync(mf,new Date(),new Date(Date.now()+60000))}}});
      const L6=logLines(l6);
      ok(S.posts.length-p0===3&&L6.filter(l=>/manifest complete/.test(l)).length>=3&&/check again 2026-12-11 00:00 \(nothing left to make\)/.test(L6.find(l=>/manifest complete/.test(l))),'loop: with nothing left it makes no call and sleeps until tomorrow ('+(S.posts.length-p0)+' made in all)');
      ok(out.filter(l=>/nothing left to make: sleeping/.test(l)).length===2&&out.filter(l=>/the manifest changed/.test(l)).length===1,'loop: it says so once, a changed manifest wakes it for the new asset, and it says so again after')}
    // the rule in one table
    {const n=nextCheck,t=new Date(2026,11,31,22,30),f=d=>d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate()+' '+d.getHours()+':'+d.getMinutes();
      ok(f(n('share',t))==='2027-1-1 0:0'&&f(n('share',new Date(2026,11,1,8)))==='2026-12-1 12:0'&&f(n('provider',t,{retryAfter:8*3600}))==='2027-1-1 6:30'&&f(n('provider',t,{retryAfter:60}))==='2027-1-1 2:30'&&f(n('month',new Date(2026,10,15)))==='2026-12-1 0:0'&&f(n('complete',t))==='2027-1-1 0:0'&&f(n('error',t,{retryHours:2}))==='2027-1-1 0:30','nextCheck: a share waits at most to midnight, the provider the later of the retry hours and retry-after, the month to the 1st')}
  }

  // --- the ZeroGPU Space (#703): the default provider, against a mock Space (Gradio call protocol, cold start, quota) and Hub
  {const SP=SPACE;Object.assign(SP,{stages:[],posts:[],files:0,wakes:0,quota429:Infinity,sseQuota:false,ok:0,refuse:null,gpuS:12.4,creates:0,commits:[],hardware:[],exists:false,missing:new Set(),broken:false,statusCalls:0});
    const SPENV={HF_SPACE_URL:base+'/space',ART_SPACE_POLL_MS:'5'},routerBefore=()=>S.posts.length;
    const sNode=(script,a,extra={})=>node(script,a,{...SPENV,...extra});
    const lines=f=>existsSync(f)?readFileSync(f,'utf8').trim().split('\n').filter(Boolean):[];
    // gen --dry-run: the Space request, the same prompt, seed, steps, guidance, size and tier LoRA scale; no call
    let r=await sNode('gen.mjs',['--out',join(tmp,'sp-gen'),'--dry-run']);const sent=SP.posts.length;
    ok(r.code===0&&/on the Space tsc862\/eldmoor-art: \$0/.test(r.s)&&/dry run: first request POST .*\/space\/gradio_api\/call\/generate/.test(r.s)&&/"data": \[\s*"pixel art, meadow grass/.test(r.s)&&/1771,\s*25,\s*7,\s*1024,\s*1024,\s*0\.55,\s*"nerijs\/pixel-art-xl"/.test(r.s)&&!sent,'space: the default provider; gen --dry-run shows the Gradio call with the manifest prompt, seed 1771, 25 steps, guidance 7, 1024 px, LoRA 0.55 and the LoRA repo; no call');
    r=await sNode('gen.mjs',['--out',join(tmp,'sp-gen'),'--provider','fal']);ok(r.code===2&&/not one of space, router/.test(r.s),'an unknown --provider is refused');
    // a cold start: the Space sleeps, is woken, loads; then three images and the GPU cap (1 min: 3 x 12.4 s + the next 25 s reserve > 60 s)
    {const dir=join(tmp,'sp1'),logP=join(tmp,'sp1.log'),r0=routerBefore();SP.stages=['SLEEPING','APP_STARTING','APP_STARTING','RUNNING'];
      r=await sNode('daily.mjs',['--dir',dir,'--log',logP,'--date','2026-12-01'],{ART_GPU_MINUTES:'1',ART_DAILY_BUDGET:''});const L=lines(logP),q=JSON.parse(readFileSync(join(dir,'queue.json'),'utf8'));
      ok(r.code===0&&SP.wakes===1&&/waking the Space tsc862\/eldmoor-art \(sleeping/.test(r.s)&&/the Space is awake \(\d+ s\)/.test(r.s),'space: a sleeping Space is woken and waited for ("waking the Space ...")'+(r.code?' '+r.s.slice(-400):''));
      ok(SP.ok===3&&S.posts.length===r0&&Object.keys(q.incoming).length===3&&existsSync(join(dir,'incoming','2026-12-01','tile','32','grass.png')),'space: images land in incoming/<date>/ for review; the router is never called');
      ok(/made 3 \| rejected 0 \| calls 3 \| quota: 37\.2 s of GPU \(0\.6 of 40 min this window, stop at 1\) \| est\. \$0\.000 \| model pixel-xl · space \| stop: GPU cap reached/.test(L[0]||''),'space: the log counts GPU seconds, $0.000, and stops at the GPU cap: '+(L[0]||''));
      ok(/check again \d{4}-\d\d-\d\d \d\d:\d\d \(ZeroGPU quota resets\)/.test(L[0]||'')&&Math.abs(new Date(q.gpu.start).getTime()+864e5-Date.now()-864e5)<6e5&&Math.abs(q.gpu.s-37.2)<1e-6&&q.gpu.images===3,'space: the GPU window (queue.json gpu) holds 37.2 s and 3 images; the next check is 24 h after the window opened');
      {const ri=loadIndex(join(dir,'incoming','2026-12-01','raw')),a=ri.assets['tile:grass@32'];ok(a&&a.provider==='space'&&a.seed===1771&&a.model==='pixel-xl','space: the raw image is kept with provider space, model and seed')}
      ok(SP.posts.every(p=>p.data.length===9&&p.data[7]===.55&&/^pixel art, /.test(p.data[0])&&p.auth===`Bearer ${MOCK_TOKEN}`),'space: every call is the 9-value generate call with the bearer token');
      r=await sNode('daily.mjs',['--dir',dir,'--log',logP,'--date','2026-12-01','--now'],{ART_GPU_MINUTES:'1'});ok(SP.ok===3&&/stop: GPU cap reached/.test(lines(logP).pop()),'space: a second run in the same window makes no call (the cap holds across runs)');
      r=await sNode('daily.mjs',['--dir',dir,'--log',logP,'--date','2026-12-01','--now','--provider','router'],{ART_DAILY_BUDGET:'100','ART_MAX_CALLS':'1'});ok(S.posts.length===r0+1&&/ (estimated|billed) \$0\.0\d\d /.test(lines(logP).pop()),'the router runs only with --provider router (billed, estimated $)')}
    // the quota refusal: an HTTP 429 "Try again in 2:31:05" ends the pass; the loop sleeps until exactly then, not until tomorrow
    {const dir=join(tmp,'sp2'),logP=join(tmp,'sp2.log'),st=join(tmp,'sp2-state.json');SP.stages=[];SP.ok=0;SP.quota429=2;
      let t=new Date(2026,11,1,8,0).getTime(),states=[];const out=[],orig=console.log;console.log=(...a)=>out.push(a.join(' '));
      const keep={...process.env};Object.assign(process.env,{HF_ROUTER_URL:base,HF_HUB_URL:base,...SPENV});
      try{await runLoop(['--loop','--dir',dir,'--log',logP,'--state',st],{...env,...SPENV,ART_DAILY_BUDGET:''},{now:()=>new Date(t),
        sleep:async ms=>{t+=ms;try{const j=JSON.parse(readFileSync(st,'utf8'));if(j.state==='waiting'&&!states.some(s=>s.next===j.next))states.push(j)}catch{}if(t>=new Date(2026,11,1,10,31).getTime())SP.quota429=Infinity},
        stopped:()=>t>=new Date(2026,11,1,10,40).getTime(),maxPasses:2})}
      finally{console.log=orig;for(const k of Object.keys(process.env))if(!(k in keep))delete process.env[k];Object.assign(process.env,keep)}
      const L=lines(logP);
      ok(/^2026-12-01 08:00 \| made 2 .*stop: ZeroGPU quota used \(resets 10:31\).*check again 2026-12-01 10:31 \(ZeroGPU quota resets\)/.test(L[0]||''),'space: the quota 429 stops the pass with its reset time, and the next check is that time: '+(L[0]||'').slice(0,240));
      ok(/^2026-12-01 10:31 \| made [1-9]/.test(L[1]||''),'space: the loop wakes at the reset and makes images again: '+(L[1]||'').slice(0,80));
      ok(states.some(j=>/ZeroGPU quota resets/.test(j.why)&&j.last&&j.last.provider==='space'&&j.last.images===2&&typeof j.last.gpuMin==='number'),'space: the loop state for the launcher carries images and GPU minutes of the window')}
    // the same refusal as a Gradio error event (ZeroGPU raises it inside the call); and a 429 with no time waits up to 24 h
    {const dir=join(tmp,'sp3'),logP=join(tmp,'sp3.log');SP.ok=0;SP.quota429=Infinity;SP.sseQuota=true;
      r=await sNode('daily.mjs',['--dir',dir,'--log',logP,'--date','2026-12-02']);SP.sseQuota=false;const L=lines(logP);
      ok(/made 0 .*stop: ZeroGPU quota used \(resets \d\d:\d\d\): You have exceeded your Pro GPU quota/.test(L[0]||'')&&/ZeroGPU quota resets/.test(L[0]||''),'space: a quota error event in the stream is the same stop: '+(L[0]||'').slice(0,200))}
    // no fallback: a missing or broken Space stops the run with its page; the router is not tried
    {const r0=routerBefore(),dir=join(tmp,'sp4'),logP=join(tmp,'sp4.log');SP.missing.add('tsc862/nope');
      r=await sNode('daily.mjs',['--dir',dir,'--log',logP,'--date','2026-12-03'],{HF_ART_SPACE:'tsc862/nope'});
      ok(/does not exist yet: run npm run art:space -- --push \(https:\/\/huggingface\.co\/spaces\/tsc862\/nope\)/.test(lines(logP).pop())&&S.posts.length===r0,'space: a missing Space says to push it, and nothing falls back to the paid router');
      SP.broken=true;r=await sNode('daily.mjs',['--dir',dir,'--log',logP,'--date','2026-12-03','--now']);SP.broken=false;
      ok(/the Space tsc862\/eldmoor-art is RUNTIME_ERROR: see https:\/\/huggingface\.co\/spaces\/tsc862\/eldmoor-art/.test(lines(logP).pop())&&S.posts.length===r0,'space: an errored Space is reported with its status page, not a bare timeout')}
    // a LoRA the Space does not carry: the next Space model; router-only models are never tried on the Space
    {const dir=join(tmp,'sp5'),logP=join(tmp,'sp5.log');SP.ok=0;SP.refuse='nerijs/pixel-art-xl';const p0=SP.posts.length;
      r=await sNode('daily.mjs',['--dir',dir,'--log',logP,'--date','2026-12-04','--max','2']);SP.refuse=null;const q=JSON.parse(readFileSync(join(dir,'queue.json'),'utf8'));
      ok(SP.ok===2&&q.spaceTried['pixel-xl'].ok===false&&q.spaceTried['pixel-redmond'].ok===true&&SP.posts.slice(p0).every(p=>['nerijs/pixel-art-xl','artificialguybr/PixelArtRedmond'].includes(p.data[8])),'space: a refused LoRA moves to the next Space model (pixel-redmond); FLUX and Z-Image stay router-only')}
    // image to image (#763): the game's own art goes in, its silhouette comes out
    {const I=await import('./art/init.mjs'),{processRaw}=await import('./art/gen.mjs'),pm=man.models['pixel-xl'],byId=id=>man.assets.find(a=>a.id===id),chain=man.assets.filter(e=>e.init);
      ok(chain.length===man.assets.filter(e=>['building','landmark','sprite'].includes(e.kind)).length&&chain.every(e=>e.init==='procedural'&&e.strength>=.3&&e.strength<=.45)&&man.assets.filter(e=>!['building','landmark','sprite'].includes(e.kind)).every(e=>!e.init),`img2img: every building, landmark and sprite (${chain.length}) starts from the procedural art at a low strength per kind (${['building','landmark','sprite'].map(k=>k+' '+man.kindInit[k].strength).join(', ')}); tiles and props stay text only`);
      {const bad=[];for(const e of chain)for(const t of TIERS){const a=I.initArt(e,t,PAL,pm,man),z=sizeOf(e,t);if(!a||a.w!==z[0]||a.h!==z[1]){bad.push(e.id+'@'+t+' no art');continue}
          const L=I.initLayout(a.w,a.h,pm.width,pm.height),raw=I.initCanvas(a,L);
          try{const o=processRaw(encodePng(raw),e,PAL,pm,t,man,{small:a,...L,strength:e.strength}).img;if(o.notes.drift>12||!Buffer.from(o.data).equals(Buffer.from(a.data)))bad.push(`${e.id}@${t} not a fixed point (drift ${o.notes.drift})`)}catch(x){bad.push(`${e.id}@${t}: ${x.message}`)}
          if(e.frames){const {cols,rows}=e.frames,fw=a.w/cols,fh=a.h/rows;for(let f=0;f<cols*rows;f++){let n=0,floor=0;for(let y=0;y<fh;y++)for(let x=0;x<fw;x++)if(a.data[(((Math.floor(f/cols)*fh+y)*a.w)+(f%cols)*fw+x)*4+3]){n++;if(y===fh-1)floor++}if(n<fw*fh*.1||!floor)bad.push(`${e.id}@${t} frame ${f}: ${n} px, floor ${floor}`)}}}
        ok(!bad.length,`img2img: all ${chain.length} have procedural art at both tiers, sized to the manifest, every sheet frame filled and on its floor, and the art through its own recipe and gates comes back unchanged`+(bad.length?': '+bad.slice(0,6).join('; '):''))}
      {const e=byId('sprite:hero-warrior'),a=I.initArt(e,32,PAL,pm,man),keys=new Set(Object.keys(PAL.recolour(1)).map(c=>hexToRgb(c).join()));let n=0;for(let i=0;i<a.w*a.h;i++)if(a.data[i*4+3]&&keys.has([a.data[i*4],a.data[i*4+1],a.data[i*4+2]].join()))n++;
        const fr=(c,r)=>{const b=[];for(let y=0;y<48;y++)b.push(Buffer.from(a.data.subarray(((r*48+y)*a.w+c*32)*4,((r*48+y)*a.w+(c+1)*32)*4)).toString('hex'));return b.join('')};
        ok(n>500&&fr(0,0)!==fr(0,3)&&fr(0,0)!==fr(1,0)&&fr(1,0)!==fr(2,0)&&fr(0,1)!==fr(0,2),`img2img: a hero's init sheet has the tabard in the recolourable key (${n} px), and stand, step and other step, front, side and back differ`)}
      const tiny=(ids,f)=>{const j=JSON.parse(readFileSync(join(ROOT,'scripts','art','manifest.json'),'utf8'));j.assets=j.assets.filter(a=>ids.includes(a.id));writeFileSync(f,JSON.stringify(j));return f};
      const ids=['tile:grass','building:stone-hall','landmark:crypt-mouth','sprite:hero-warrior','sprite:mob-wolf'],mf=tiny(ids,join(tmp,'manifest-i2i.json')),dir=join(tmp,'sp6'),logP=join(tmp,'sp6.log'),date='2026-12-05',p0=SP.posts.length;SP.ok=0;
      r=await sNode('gen.mjs',['--out',join(tmp,'sp6-dry'),'--manifest',mf,'--only','building:stone-hall','--dry-run']);ok(r.code===0&&/gradio_api\/call\/img2img/.test(r.s)&&/<init PNG 1024x1024, the art x10, \d+ base64 characters>/.test(r.s)&&SP.posts.length===p0,'img2img: gen --dry-run shows the img2img call with the init summed up, and calls nothing');
      r=await sNode('daily.mjs',['--dir',dir,'--log',logP,'--date',date,'--manifest',mf]);
      const posts=SP.posts.slice(p0),i2=posts.filter(p=>p.api==='img2img'),q=loadQueue(dir),inc=join(dir,'incoming',date),ri=loadIndex(join(inc,'raw'));
      ok(r.code===0&&posts.length===5&&i2.length===4&&posts.find(p=>p.api==='generate').data.length===9&&Object.keys(q.incoming).length===5,`img2img: one run makes the tile by text and the other four from their art (${Object.keys(q.incoming).length} waiting)`+(r.code?': '+r.s.slice(-300):''));
      {const bad=[];for(const p of i2){const e=chain.find(c=>p.data[0].includes(c.prompt)),a=I.initArt(e,32,PAL,pm,man),L=I.initLayout(a.w,a.h,1024,1024),im=decodePng(Buffer.from(p.data[5],'base64'));
          if(im.w!==1024||im.h!==1024||p.data.length!==9||p.data[6]!==e.strength||p.data[7]!==.55||p.data[8]!==pm.repo||p.data[3]!==pm.steps)bad.push(e.id+' request');
          for(let y=0;y<a.h;y++)for(let x=0;x<a.w;x++){const s=(y*a.w+x)*4;for(const [dx,dy] of [[0,0],[L.k-1,L.k-1]]){const o=((L.oy+y*L.k+dy)*1024+L.ox+x*L.k+dx)*4,want=a.data[s+3]?[a.data[s],a.data[s+1],a.data[s+2]]:I.BACKGROUND;if(im.data[o]!==want[0]||im.data[o+1]!==want[1]||im.data[o+2]!==want[2])bad.push(`${e.id} ${x},${y}`)}}}
        ok(!bad.length,`img2img: every procedural pixel reaches the mock Space on its nearest-neighbour cell of the 1024 canvas, with the manifest's strength, the tier's LoRA scale and the model's steps`+(bad.length?': '+bad.slice(0,5).join('; '):''))}
      {const bad=[];for(const id of ids.slice(1)){const e=byId(id),o=decodePng(readFileSync(join(inc,keyFile(tierKey(id,32))))),a=I.initArt(e,32,PAL,pm,man),m=ri.assets[tierKey(id,32)];
          for(let i=0;i<a.w*a.h;i++)if(!!a.data[i*4+3]!==!!o.data[i*4+3]){bad.push(id+' silhouette');break}
          if(!m.init||m.init.strength!==e.strength||!existsSync(join(inc,'raw',m.init.file)))bad.push(id+' init kept')}
        const flatOut=decodePng(readFileSync(join(inc,keyFile('building:stone-hall@32')))),a=I.initArt(byId('building:stone-hall'),32,PAL,pm,man);let same=0,n=0;for(let i=0;i<a.w*a.h;i++)if(a.data[i*4+3]){n++;if(a.data[i*4]===flatOut.data[i*4]&&a.data[i*4+1]===flatOut.data[i*4+1]&&a.data[i*4+2]===flatOut.data[i*4+2])same++}
        ok(!bad.length&&same/n>.7,`img2img: the answers keep the procedural silhouette exactly (${Math.round(same/n*100)}% of the hall's pixels keep their colour), pass their recipe's gates, and raw/ keeps each init with its layout`+(bad.length?': '+bad.join('; '):''))}
      {const before=readFileSync(join(inc,keyFile('sprite:hero-warrior@32')));r=await sNode('reprocess.mjs',[date,'--dir',dir,'--manifest',mf]);ok(r.code===0&&/reprocessed 5, rejected 0/.test(r.s)&&Buffer.from(readFileSync(join(inc,keyFile('sprite:hero-warrior@32')))).equals(before),'img2img: art:reprocess re-reads the raws through their kept init with no call, to the same pixels')}
      // bad answers: refused with the raw kept
      {const e=byId('building:stone-hall'),a=I.initArt(e,32,PAL,pm,man),L=I.initLayout(a.w,a.h,1024,1024),cv=I.initCanvas(a,L),run=(v,en=e,s=a,l=L,c=cv)=>{try{return processRaw(encodePng(FX.img2imgArt(c,v)),en,PAL,pm,32,man,{small:s,...l,strength:.4})}catch(x){return x}};
        const rd=run({redraw:true}),sp=run({spill:true}),w=byId('sprite:mob-wolf'),wa=I.initArt(w,32,PAL,pm,man),wl=I.initLayout(wa.w,wa.h,1024,1024),wr=run({redraw:true},w,wa,wl,I.initCanvas(wa,wl));
        ok(rd.kind==='flat'&&/redrawn: drift/.test(rd.message)&&wr.kind==='flat'&&/redrawn/.test(wr.message),'img2img: an answer that ignored the init is refused as redrawn: '+rd.message);
        const ch=byId('building:stone-chapel'),ca=I.initArt(ch,32,PAL,pm,man),cl=I.initLayout(ca.w,ca.h,1024,1024),sc=run({spill:true},ch,ca,cl,I.initCanvas(ca,cl));
        ok(sc.kind==='flat'&&/drew outside the silhouette/.test(sc.message),'img2img: an answer that painted round the subject is refused: '+sc.message);
        const he=byId('sprite:hero-warrior'),ha=I.initArt(he,32,PAL,pm,man),hl=I.initLayout(ha.w,ha.h,1024,1024),hc=I.initCanvas(ha,hl);for(let i=0;i<hc.w*hc.h;i++){const o=i*4;if(hc.data[o+2]>hc.data[o]+30&&hc.data[o+2]>hc.data[o+1]+10){hc.data[o]=150;hc.data[o+1]=150;hc.data[o+2]=160}}
        const nk=run({},he,ha,hl,hc);ok(nk.kind==='flat'&&/no faction key/.test(nk.message),'img2img: a hero whose tabard the model repainted is refused by the sheet check: '+nk.message)}
      // the router has no init route; a Space from before this is told to push
      {const rd=join(tmp,'sp6-router'),rp=S.posts.length;r=await node('gen.mjs',['--out',rd,'--manifest',mf,'--provider','router','--yes']);ok(/made image to image on the Space only/.test(r.s)&&S.posts.length===rp+1&&existsSync(join(rd,'tile','32','grass.png'))&&!existsSync(join(rd,'building')),'img2img: a router run leaves these kinds out and says so')
        const od=join(tmp,'sp7'),ol=join(tmp,'sp7.log'),p1=SP.posts.length,mo=tiny(['building:stone-hall'],join(tmp,'manifest-old.json'));SP.oldSpace=true;r=await sNode('daily.mjs',['--dir',od,'--log',ol,'--date',date,'--manifest',mo]);SP.oldSpace=false;
        ok(/has no img2img API: run npm run art:space -- --push/.test(lines(ol).pop())&&SP.posts.length===p1&&!existsSync(join(od,'incoming',date,'raw','index.json')),'img2img: a Space from before this (Gradio answers 500) stops the run with the word to push: '+lines(ol).pop().slice(40,170))}
      {const {spaceDuration}=await import('./art/space.mjs'),py=readFileSync(join(ROOT,'scripts','art','space','app.py'),'utf8');
        ok(spaceDuration(pm,.4)===16&&/api_name="img2img"/.test(py)&&/AutoPipelineForImage2Image\.from_pipe\(pipe\)/.test(py)&&/@spaces\.GPU\(duration=gpu_duration_i2i\)/.test(py)&&/strength=float\(strength\)/.test(py),'img2img: the Space app shares the loaded weights through from_pipe, exposes the img2img API with a strength and reserves GPU time by strength (16 s at .4)')}}
    // the rules in small: reset parsing and the 24 h window
    {const {quotaReset,gpuWindow,spaceDuration,parseSse}=await import('./art/space.mjs'),t0=new Date(2026,11,1,8,0);
      ok(quotaReset('Try again in 2:31:05',t0).getTime()-t0.getTime()===9065e3&&quotaReset('try again in 45:00',t0).getTime()-t0.getTime()===2700e3&&quotaReset('no time',t0,600).getTime()-t0.getTime()===600e3&&quotaReset('nothing',t0)===null,'quota reset: "Try again in H:MM:SS", "MM:SS", else retry-after');
      const q={gpu:{start:new Date(2026,11,1,8).toISOString(),s:600,images:20}};ok(gpuWindow(q,new Date(2026,11,2,7,59)).s===600&&gpuWindow(q,new Date(2026,11,2,8,0)).s===0,'the GPU window closes 24 h after it opened');
      ok(spaceDuration(man.models['pixel-xl'])===25&&parseSse('event: heartbeat\ndata: null\n\nevent: complete\ndata: [1,2]\n\n').map(e=>e.event).join()==='heartbeat,complete','reserved GPU seconds (25 for 25 steps at 1024) and the event-stream parser')}
    // npm run art:space: the plan, a read-only token named and nothing sent, then create + one commit + ZeroGPU hardware
    {const {checkReadme}=await import('./art/space-push.mjs');const {readFileSync:rf}=await import('node:fs');
      const ours=checkReadme(rf(new URL('./art/space/README.md',import.meta.url),'utf8')),fm=t=>'---\ntitle: T\nsdk: gradio\nsdk_version: 6.30.0\n'+t+'---\n';
      ok(ours.length===0,'space: our README front matter passes the Hub limits: '+ours.join('; '));
      ok(/short_description is 61/.test(checkReadme(fm('short_description: '+'x'.repeat(61)+'\n')).join())&&checkReadme(fm('short_description: '+'x'.repeat(60)+'\n')).length===0,'space: a short_description over 60 is caught before any call, 60 passes');
      ok(/sdk_version is missing/.test(checkReadme('---\ntitle: T\nsdk: gradio\n---\n').join()),'space: a missing sdk_version is caught')}
    {const push=(a,extra)=>sNode('space-push.mjs',a,{...extra});
      r=await push([]);ok(r.code===0&&/files: app\.py, requirements\.txt, README\.md, loras\.json \(pixel-xl = nerijs\/pixel-art-xl\/pixel-art-xl\.safetensors; pixel-redmond = /.test(r.s)&&!SP.creates&&!SP.commits.length,'art:space without --push: the plan only');
      r=await push(['--push'],{HF_TOKEN:'hf_readOnlyMock999'});ok(r.code===2&&/read-only for tsc862\/eldmoor-art \(a read-only token\)/.test(r.s)&&/Nothing was sent/.test(r.s)&&!SP.creates&&!SP.commits.length&&!r.s.includes('hf_readOnlyMock999'),'art:space --push with a read-only token says so plainly and sends nothing');
      r=await push(['--push'],{HF_TOKEN:'hf_fineNoWrite777'});ok(r.code===2&&/fine-grained token without write access/.test(r.s)&&!SP.creates,'a fine-grained token without write on the repo is refused the same way');
      r=await push(['--push']);const c=SP.commits[0]||{};
      ok(r.code===0&&SP.creates===1&&c.files&&c.files.map(f=>f.path).sort().join()==='README.md,app.py,loras.json,requirements.txt'&&c.private!==false&&SP.hardware.includes('zero-a10g'),'art:space --push creates the Space (private, gradio), uploads the four files in one commit and asks for ZeroGPU'+(r.code?' '+r.s.slice(-300):''));
      {const app=c.files&&c.files.find(f=>f.path==='app.py'),lj=c.files&&JSON.parse(c.files.find(f=>f.path==='loras.json').text),rd=c.files&&c.files.find(f=>f.path==='README.md').text;
        ok(app&&app.text===readFileSync(join(ROOT,'scripts','art','space','app.py'),'utf8')&&lj.loras.map(l=>l.key).join()==='pixel-xl,pixel-redmond'&&/sdk: gradio/.test(rd)&&/zero-a10g/.test(rd),'the commit carries app.py as written, loras.json from the manifest (pixel-xl, pixel-redmond) and the README with the Gradio SDK and ZeroGPU')}
      r=await push(['--push']);ok(r.code===0&&/exists: updating it/.test(r.s)&&SP.commits.length===2,'a second push updates the existing Space');
      ok(!r.s.includes(MOCK_TOKEN),'the token is never printed');
      {const py=readFileSync(join(ROOT,'scripts','art','space','app.py'),'utf8'),req=readFileSync(join(ROOT,'scripts','art','space','requirements.txt'),'utf8');
        ok(/@spaces\.GPU\(duration=gpu_duration\)/.test(py)&&/api_name="generate"/.test(py)&&/show_error=True/.test(py)&&/^spaces==[\d.]+$/m.test(req)&&/^torch==2\.(8|9|10|11|12|13)\.\d+$/m.test(req),'the Space app: @spaces.GPU with a dynamic duration, the generate API, errors shown, pinned spaces and a ZeroGPU-supported torch')}}
  }
  srv.close();
}finally{rmSync(tmp,{recursive:true,force:true})}

console.log('renderer with assets off, on and off again');
{const A=await import('../src/render/assets.js'),Tr=await import('../src/render/terrain.js'),{tiles,I}=await import('../src/world/map.js'),{W,H,G}=await import('../src/world/tiles.js');
  const {TILE:RT,U,ART}=await import('../src/render/tile.js');
  A.provideAssets(null,{});ok(A.asset('tile:grass')===null&&A.assetPixels('tile:grass')===null,'no index, no DOM: asset() is null, no throw');
  A.provideAssets({assets:{'tile:grass@32':{id:'tile:grass',tier:32,file:'tile/32/grass.png',w:32,h:32}}},{'tile/32/grass.png':'/assets/tile/32/grass.png'});ok(A.asset('tile:grass')===null,'indexed but no Image (Node): null, procedural');
  ok(!Tr.terrainArt(),'no terrain asset loaded: chunks are painted at the procedural grid (U) and scaled');
  // art pixels: the corners and the middle of each sampled tile at the renderer's TILE
  const P=[[0,0],[RT/2-1,RT/2+3],[RT-1,RT-1]];
  const sample=()=>{const out=[];for(let ty=0;ty<H;ty+=3)for(let tx=0;tx<W;tx+=3){const t=tiles[I(tx,ty)];for(const [ax,ay] of P)out.push([t,Tr.artTexel(t,tx,ty,ax,ay)])}return out};
  const off=sample(),grassN=off.filter(([t])=>t===G).length;
  {let k=0,bad=0;for(let ty=0;ty<H;ty+=3)for(let tx=0;tx<W;tx+=3){const t=tiles[I(tx,ty)];for(const [ax,ay] of P){if(off[k++][1]!==Tr.texel(t,tx,ty,(ax/ART)|0,(ay/ART)|0))bad++}}
    ok(RT===U*ART&&!bad,`no asset: every ${RT} px art texel is the ${U} px procedural texel scaled ${ART}x`)}
  const im={w:RT,h:RT,data:new Uint8Array(RT*RT*4)};for(let i=0;i<RT*RT;i++){const c=((i/RT|0)+i)%2?[0x12,0x34,0x56]:[0x65,0x43,0x21];im.data.set([...c,255],i*4)}A.setAssetPixels('tile:grass',A.pixelsOf(im.w,im.h,im.data));
  const on=sample();let same=0,changed=0,other=0;
  for(let i=0;i<off.length;i++){if(off[i][0]===G){if(on[i][1]==='#123456'||on[i][1]==='#654321')changed++}else if(on[i][1]===off[i][1])same++;else other++}
  ok(grassN>0&&changed===grassN,`grass texels come from the asset at art resolution (${changed}/${grassN})`);ok(!other,`other tiles unchanged (${same})`);
  ok(Tr.terrainArt(),'a terrain asset loaded: chunks are painted at TILE');
  A.setAssetPixels('tile:grass',null);const back=sample();ok(back.every((v,i)=>v[1]===off[i][1]),'asset removed: the procedural terrain is back exactly');ok(!Tr.terrainArt(),'and chunks go back to the procedural grid')}

console.log('tiers: index, loader, fallback, generation settings');
{const A=await import('../src/render/assets.js'),{TILE:RT}=await import('../src/render/tile.js');
  const other=TIERS.find(t=>t!==RT);
  const idx={assets:{'tile:grass@64':{id:'tile:grass',tier:64,file:'tile/64/grass.png',w:64,h:64},'tile:snow@32':{id:'tile:snow',tier:32,file:'tile/32/snow.png',w:32,h:32},'tile:mud':{file:'tile/mud.png',w:32,h:32}}};
  A.provideAssets(idx,{});
  ok(A.hasAsset('tile:snow')===(RT===32)&&A.hasAsset('tile:grass')===(RT===64)&&A.assetEntry(RT===32?'tile:snow':'tile:grass').tier===RT,`the loader keeps the renderer's tier (${RT}) only; the ${other} tier is absent, so its renderer draws procedurally`);
  ok(A.hasAsset('tile:mud')===(RT===32)&&A.tierOf('tile:mud',{})===32,'an index entry from before tiers counts as the 32 tier');
  const e32=A.entriesFor(idx.assets,32),e64=A.entriesFor(idx.assets,64);ok(Object.keys(e32).sort().join()==='tile:mud,tile:snow'&&Object.keys(e64).join()==='tile:grass','entries split by tier, keyed by id');
  A.provideAssets(null,{});
  ok(normKey('tile:grass')==='tile:grass@32'&&normKey('tile:grass#alt2')==='tile:grass@32#alt2'&&normKey('tile:grass@64#alt1')==='tile:grass@64#alt1','queue keys from before tiers read as the 32 tier');
  {const k=splitKey('tile:grass@64#alt3');ok(k.id==='tile:grass'&&k.tier===64&&k.alt===3&&keyFile('tile:grass@64#alt3')==='tile/64/grass.alt3.png','a tier key splits into id, tier and alternate; its file is <kind>/<tier>/<name>.altK.png')}
  // an old queue and index (keys without a tier) are read as the 32 tier
  const old=mkTmp('eldmoor-oldq-');
  try{writeFileSync(join(old,'queue.json'),JSON.stringify({version:1,incoming:{'tile:grass':{date:'2026-11-03',file:'tile/grass.png'}},rejected:{'tile:mud':1},alts:{},failed:{},next:['tile:swamp']}));
    writeFileSync(join(old,'index.json'),JSON.stringify({version:1,assets:{'tile:grass':{id:'tile:grass',file:'tile/grass.png',w:32,h:32}}}));
    const q=loadQueue(old),ix=loadIndex(old);
    ok(q.incoming['tile:grass@32']&&q.incoming['tile:grass@32'].file==='tile/grass.png'&&q.rejected['tile:mud@32']===1&&q.next[0]==='tile:swamp@32'&&ix.assets['tile:grass@32'].tier===32,'the owner\'s queue and incoming index from before tiers (2026-11-03) carry over as the 32 tier')}
  finally{rmSync(old,{recursive:true,force:true})}}

for(const [mode,title] of [['--autotile','autotile rules with fixture PNGs (slice 2)'],['--towns','towns and landmarks with fixture PNGs (slice 3)']]){console.log(title);
for(const world of ['eldmoor','stepping']){
  const r=await new Promise(f=>{const c=spawn(process.execPath,[join(ROOT,'scripts','artcheck.mjs'),mode],{env:{...process.env,ELDMOOR_WORLD:world},stdio:['ignore','pipe','pipe']});
    let s='';c.stdout.on('data',d=>s+=d);c.stderr.on('data',d=>s+=d);c.on('close',code=>f({code,s}))});
  process.stdout.write(r.s.split('\n').filter(Boolean).map(l=>l.replace(/^ {2}(ok |FAIL)/,`  $1 [${world}]`)).join('\n')+'\n');
  if(r.code!==0){fails++;if(!/FAIL/.test(r.s))console.log(`  FAIL [${world}] the ${mode.slice(2)} probe exited ${r.code}`)}}}

console.log(fails?`artcheck: ${fails} FAILED`:'artcheck: all ok');process.exit(fails?1:0);

// Part 6, run in a child per world: the full map rendered pixel by pixel (terrain.js pixel(), as paintChunk does) with
// no assets, with every fixture asset (PNG files in a temp folder, decoded back), with pieces removed, and with none.
async function autotileProbe(){
  const A=await import('../src/render/assets.js'),T=await import('../src/render/terrain.js'),{tiles,zone,I}=await import('../src/world/map.js');
  const {W,H,TREE,ROAD}=await import('../src/world/tiles.js'),{fixtures}=await import('./art/fixtures.mjs'),{ACTIVE_SPEC}=await import('../src/world/spec.js');
  const {TILE:RT,U,ART}=await import('../src/render/tile.js'),RR=RT*RT; // the map is rendered at art resolution (TILE a tile)
  const fnv=a=>{let h=0x811c9dc5;for(let i=0;i<a.length;i++){h^=a[i]&255;h=Math.imul(h,16777619)>>>0}return h.toString(16).padStart(8,'0')};
  const mapHash=()=>fnv(tiles)+fnv(zone);
  const render=()=>{const out=new Uint32Array(W*H*RR);let i=0;
    for(let ty=0;ty<H;ty++)for(let tx=0;tx<W;tx++){const t=tiles[I(tx,ty)];for(let py=0;py<RT;py++)for(let px=0;px<RT;px++)out[i++]=parseInt(T.pixel(t,tx,ty,px,py).slice(1),16)}
    return out};
  const same=(a,b)=>{for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true};
  const diff=(a,b)=>{let n=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])n++;return n};
  // the corner point whose quadrant holds pixel i of the render
  const pointOf=i=>{const tile=Math.floor(i/RR),px=i%RT,py=Math.floor((i%RR)/RT);return [tile%W+(px>=RT/2?1:0),Math.floor(tile/W)+(py>=RT/2?1:0)]};
  A.provideAssets(null,{});
  const m0=mapHash(),off=render();
  console.log(`  ok  ${ACTIVE_SPEC.id||'world'} ${W}x${H}: procedural render ${fnv(new Uint8Array(off.buffer))} (no assets, ${RT} px tiles)`);
  {let bad=0,i=0;for(let ty=0;ty<H;ty++)for(let tx=0;tx<W;tx++){const t=tiles[I(tx,ty)];for(let py=0;py<RT;py++)for(let px=0;px<RT;px++){if(off[i++]!==parseInt(T.procPixel(t,tx,ty,(px/ART)|0,(py/ART)|0).slice(1),16))bad++}}
    ok(!bad,`no assets: the ${RT} px render is the ${U} px procedural map scaled ${ART}x, pixel for pixel`)}
  // fixtures -> PNG files and an index in a temp assets folder -> decoded -> installed
  const fx=fixtures(man,RT),dir=mkTmp('eldmoor-fixtures-'),{mkdirSync}=await import('node:fs'),{sha256}=await import('./art/lib.mjs'),{dirname}=await import('node:path');
  try{const index={version:1,assets:{}};
    for(const [id,im] of Object.entries(fx)){const f=fileOf(id,RT),b=encodePng(im);mkdirSync(dirname(join(dir,f)),{recursive:true});writeFileSync(join(dir,f),b);
      index.assets[tierKey(id,RT)]={id,tier:RT,file:f,w:im.w,h:im.h,sha256:sha256(b),model:'fixture',seed:0}}
    writeFileSync(join(dir,'index.json'),JSON.stringify(index));
    const terrainIds=man.assets.filter(e=>e.hook&&e.hook.module==='src/render/terrain.js').map(e=>e.id),missing=terrainIds.filter(id=>!fx[id]);
    ok(!missing.length,`a fixture for every terrain asset (${Object.keys(fx).length})`+(missing.length?': missing '+missing:''));
    {const {errs,count}=checkIndex(man,dir);ok(!errs.length&&count===Object.keys(fx).length,`fixture PNGs pass the index check (${count})`+(errs.length?': '+errs.slice(0,3).join('; '):''))}
    for(const a of Object.values(index.assets)){const im=decodePng(readFileSync(join(dir,a.file)));A.setAssetPixels(a.id,A.pixelsOf(im.w,im.h,im.data))}
  }finally{rmSync(dir,{recursive:true,force:true})}
  const on=render();
  ok(mapHash()===m0,'fixtures on: the map (tiles and zones) is unchanged');
  ok(diff(on,off)>0,`fixtures on: ${diff(on,off)} of ${on.length} pixels drawn from assets`);
  ok(same(render(),on),'fixtures on: deterministic (a second render is identical)');
  // where the pieces and variants went
  const want={},got={};for(let vy=0;vy<=H;vy++)for(let vx=0;vx<=W;vx++){const w=T.autotileAt(vx,vy,false);if(!w)continue;want[w.id]=(want[w.id]||0)+1;if(T.autotileAt(vx,vy))got[w.id]=(got[w.id]||0)+1}
  ok(Object.keys(want).length&&Object.keys(want).every(id=>got[id]===want[id]),'every transition point draws its piece: '+Object.entries(want).map(([k,v])=>`${k.slice(9)} ${v}`).join(', '));
  ok(want['autotile:grass-road']>0&&want['autotile:bank-water']>0,'roads and river banks get transition pieces');
  const trees={},rocks={};let treeN=0,vroad=0;
  for(let ty=0;ty<H;ty++)for(let tx=0;tx<W;tx++){const t=tiles[I(tx,ty)],p=T.propAt(tx,ty);if(t===TREE){treeN++;if(p)trees[p.id]=(trees[p.id]||0)+1}else if(p)rocks[p.id]=(rocks[p.id]||0)+1;
    if(t===ROAD&&T.roadVerticalAt(tx,ty))vroad++}
  ok(Object.values(trees).reduce((a,b)=>a+b,0)===treeN&&treeN>0,`every tree tile draws a variant (${treeN})`);
  const perBiome={};for(const [id,n] of Object.entries(trees)){const b=id.split('-')[1];(perBiome[b]=perBiome[b]||{kinds:0,n:0}).kinds++;perBiome[b].n+=n}
  ok(Object.values(perBiome).every(v=>v.n<12||v.kinds===3),'tree variants mixed (every biome with 12+ trees uses all three): '+Object.entries(trees).map(([k,v])=>`${k.slice(10)} ${v}`).join(', '));
  ok(Object.keys(rocks).length>0,'rocks scattered on ground tiles: '+Object.entries(rocks).map(([k,v])=>`${k.slice(10)} ${v}`).join(', '));
  ok(vroad>0,`north-south roads turn the road patch (${vroad} tiles)`);
  // one piece missing: only its own quadrants fall back, to the edge blend (over the base tiles, which stay)
  A.setAssetPixels('autotile:grass-road-corner',null);const part=render();
  const edgeIds=Object.keys(fx).filter(id=>id.startsWith('autotile:')),edgePx={};for(const id of edgeIds){edgePx[id]=A.assetPixels(id);A.setAssetPixels(id,null)}
  const blend=render();for(const id of edgeIds)if(edgePx[id])A.setAssetPixels(id,edgePx[id]);
  let stray=0,back=0;
  for(let i=0;i<on.length;i++)if(part[i]!==on[i]){back++;const [vx,vy]=pointOf(i),w=T.autotileAt(vx,vy,false);if(!w||w.id!=='autotile:grass-road-corner'||part[i]!==blend[i])stray++}
  ok(back>0&&!stray,`grass-road-corner removed: ${back} pixels fall back, all on its own corners and all to the edge blend`);
  // one tree variant missing: its trees take the next variant, none goes procedural
  A.setAssetPixels('prop:tree-meadow-1',null);let lost=0,moved=0;
  for(let ty=0;ty<H;ty++)for(let tx=0;tx<W;tx++)if(tiles[I(tx,ty)]===TREE){const w=T.propAt(tx,ty,false),p=T.propAt(tx,ty);if(!p)lost++;else if(w&&w.id!==p.id)moved++}
  ok(!lost,`prop:tree-meadow-1 removed: ${moved} trees take another variant, ${lost} lose theirs`);
  // everything removed: the procedural render, exactly
  for(const id of Object.keys(fx))A.setAssetPixels(id,null);
  ok(same(render(),off),'fixtures removed: the procedural render is back, pixel for pixel');
  ok(mapHash()===m0,'the map hash never moved')}

// A tiny 2D context for Node (part 8): fillRect with '#rgb[a]' / '#rrggbb[aa]' colours (alpha blended), drawImage of
// decoded pixels ({w, h, hex}), and translate / scale / quarter-turn rotate / save / restore. Enough for townart.js.
function rasterClass(){return class Raster{ // a function, so the child mode at the top can use it before this line runs
  constructor(w,h){this.w=w;this.h=h;this.px=new Uint32Array(w*h);this.m=[1,0,0,1,0,0];this.st=[];this.fillStyle='#000';this.imageSmoothingEnabled=true}
  save(){this.st.push(this.m.slice())}restore(){this.m=this.st.pop()||[1,0,0,1,0,0]}
  mul(a,b,c,d,e,f){const [A,B,C,D,E,F]=this.m;this.m=[A*a+C*b,B*a+D*b,A*c+C*d,B*c+D*d,A*e+C*f+E,B*e+D*f+F]}
  translate(x,y){this.mul(1,0,0,1,x,y)}scale(x,y){this.mul(x,0,0,y,0,0)}
  rotate(t){const c=Math.round(Math.cos(t)),s=Math.round(Math.sin(t));this.mul(c,s,-s,c,0,0)}
  dev(x,y){const [a,b,c,d,e,f]=this.m;return [a*x+c*y+e,b*x+d*y+f]}
  rect(x,y,w,h){const p=this.dev(x,y),q=this.dev(x+w,y+h);return [Math.round(Math.min(p[0],q[0])),Math.round(Math.min(p[1],q[1])),Math.round(Math.max(p[0],q[0])),Math.round(Math.max(p[1],q[1]))]}
  fillRect(x,y,w,h){let s=String(this.fillStyle).slice(1);if(s.length<=4)s=[...s].map(c=>c+c).join('');
    const r=parseInt(s.slice(0,2),16),g=parseInt(s.slice(2,4),16),b=parseInt(s.slice(4,6),16),al=s.length>6?parseInt(s.slice(6,8),16)/255:1;
    const [x0,y0,x1,y1]=this.rect(x,y,w,h);
    for(let Y=Math.max(0,y0);Y<Math.min(this.h,y1);Y++)for(let X=Math.max(0,x0);X<Math.min(this.w,x1);X++){const i=Y*this.w+X,o=this.px[i];
      const or=(o>>16)&255,og=(o>>8)&255,ob=o&255,oa=o>>>24?1:0,k=oa?al:1;
      this.px[i]=(0xff000000|(Math.round(r*k+or*(1-k)*oa)<<16)|(Math.round(g*k+og*(1-k)*oa)<<8)|Math.round(b*k+ob*(1-k)*oa))>>>0}}
  drawImage(img,dx,dy,dw,dh){const [x0,y0,x1,y1]=this.rect(dx,dy,dw,dh),[a,b,c,d,e,f]=this.m,det=a*d-b*c;
    for(let Y=Math.max(0,y0);Y<Math.min(this.h,y1);Y++)for(let X=Math.max(0,x0);X<Math.min(this.w,x1);X++){
      const px=X+.5-e,py=Y+.5-f,ux=(d*px-c*py)/det,uy=(-b*px+a*py)/det; // back to the image's user space
      const sx=Math.floor((ux-dx)/dw*img.w),sy=Math.floor((uy-dy)/dh*img.h);if(sx<0||sy<0||sx>=img.w||sy>=img.h)continue;
      const hx=img.hex[sy*img.w+sx];if(hx)this.px[Y*this.w+X]=(0xff000000|parseInt(hx.slice(1),16))>>>0}}}}

// Part 8, run in a child per world: every town and landmark drawn into rasters at art resolution (TILE a tile).
async function townProbe(){
  const A=await import('../src/render/assets.js'),TA=await import('../src/render/townart.js'),Tr=await import('../src/render/terrain.js');
  const {CITY,LANDMARKS,tiles,zone}=await import('../src/world/map.js'),{fixtures}=await import('./art/fixtures.mjs'),{ACTIVE_SPEC}=await import('../src/world/spec.js');
  const D=await import('../src/data/townart.js'),{FAC}=await import('../src/data/factions.js'),{TILE:RT,U,ART}=await import('../src/render/tile.js');
  const fnv=a=>{let h=0x811c9dc5;for(let i=0;i<a.length;i++){h^=a[i]&255;h=Math.imul(h,16777619)>>>0}return h.toString(16).padStart(8,'0')};
  const mapHash=()=>fnv(tiles)+fnv(zone);
  A.provideAssets(null,{});const m0=mapHash();
  // the hook table and the manifest agree both ways
  {const ids=new Set(man.assets.filter(e=>e.hook&&e.hook.module==='src/render/townart.js').map(e=>e.id)),keys=Object.keys(TA.ASSET_TOWNS);
    ok(keys.length===ids.size&&keys.every(k=>ids.has(k)),`every town and landmark hook id is in the manifest and back (${keys.length})`)}
  // styles and plans
  const styles=new Set(),bad=[];
  for(const c of CITY){const st=D.townStyle(c),P=TA.townPlan(c);styles.add(st);
    if(st!==D.FAC_STYLE[c.fac%D.FAC_STYLE.length])bad.push(c.name+': style '+st);
    for(const p of D.TOWN_PIECES){const n=P.filter(q=>q.id===TA.pieceId(st,p.piece)).length;if(n!==1)bad.push(`${c.name}: ${p.piece} x${n}`)}
    const walls=P.filter(q=>/-wall(-corner)?$/.test(q.id)).length,want=2*(c.w+c.h)-4-c.gateTiles.length;if(walls!==want)bad.push(`${c.name}: ${walls} wall pieces, want ${want}`);
    const g=P.find(q=>q.id.endsWith('-gate'));if(!g||!c.gateTiles.every(([x,y])=>x>=g.box[0]&&x<g.box[0]+g.box[2]&&y>=g.box[1]&&y<g.box[1]+g.box[3]))bad.push(c.name+': the gate piece misses the gate');
    for(const q of P)if(!TA.ASSET_TOWNS[q.id])bad.push(q.id+' not in ASSET_TOWNS');
    for(const q of P.filter(q=>!/-(wall|wall-corner|gate)$/.test(q.id)))if(q.box[0]<c.x0||q.box[0]+q.box[2]>c.x1+1||q.box[1]<c.y0-1||q.box[1]+q.box[3]>c.y1+1)bad.push(`${c.name}: ${q.id} outside the town`)}
  ok(!bad.length,`${CITY.length} towns, each in its faction's style (${[...styles].join(', ')}) with every piece placed once, walls on the rim, the gate over its gap`+(bad.length?': '+bad.slice(0,4).join('; '):''));
  ok(FAC.every((f,i)=>!CITY.some(c=>c.fac===i)||styles.has(D.FAC_STYLE[i%D.FAC_STYLE.length])),'every faction\'s towns draw that faction\'s style');
  const LP=TA.landmarkPlan();
  ok(LP.filter(p=>p.id==='landmark:crypt-mouth').length===LANDMARKS.filter(l=>l.kind==='crypt'&&l.mouth).length&&LP.filter(p=>p.id==='landmark:lair').length===LANDMARKS.filter(l=>l.kind==='lair').length,
    `a set piece for every crypt mouth and lair (${LP.length})`);
  // rasters: every town (padded) and every landmark box, in world units scaled to art pixels like a terrain chunk
  const regions=[...CITY.map(c=>[c.x0-2,c.y0-2,c.x1+3,c.y1+3]),...LP.map(p=>[Math.floor(p.box[0])-1,Math.floor(p.box[1])-1,Math.ceil(p.box[0]+p.box[2])+1,Math.ceil(p.box[1]+p.box[3])+1])];
  const boxes=[...CITY.flatMap(c=>TA.townPlan(c)),...LP];
  const render=()=>regions.map(([x0,y0,x1,y1])=>{const r=new (rasterClass())((x1-x0)*RT,(y1-y0)*RT);r.scale(ART,ART);r.translate(-x0*U,-y0*U);TA.drawPlaces(r,x0,y0,x1,y1);return r.px});
  const same=(a,b)=>a.every((p,i)=>p.length===b[i].length&&p.every((v,j)=>v===b[i][j]));
  // pixels that differ between two renders; out counts those outside fn's tiles (world tile coordinates)
  const diffs=(a,b,fn)=>{let n=0,out=0;a.forEach((p,k)=>{const [x0,y0,x1]=regions[k],w=(x1-x0)*RT;for(let j=0;j<p.length;j++)if(p[j]!==b[k][j]){n++;const tx=x0+(j%w+.5)/RT,ty=y0+(Math.floor(j/w)+.5)/RT;if(!fn(tx,ty))out++}});return {n,out}};
  const inside=list=>(x,y)=>list.some(p=>x>=p.box[0]&&x<p.box[0]+p.box[2]&&y>=p.box[1]&&y<p.box[1]+p.box[3]);
  const off=render(),offN=off.reduce((n,p)=>n+p.filter(v=>v).length,0);
  ok(offN>0&&same(render(),off),`no assets: the procedural towns and crypt mouths are drawn (${offN} art pixels), deterministically`);
  ok(!Tr.terrainArt(),'no assets: chunks stay on the procedural grid');
  // fixtures -> PNGs -> decoded -> installed
  const fx=fixtures(man,RT),mine=Object.keys(TA.ASSET_TOWNS),install=id=>{const im=decodePng(encodePng(fx[id]));A.setAssetPixels(id,A.pixelsOf(im.w,im.h,im.data))};
  ok(mine.every(id=>fx[id]&&fx[id].w===sizeOf(man.assets.find(e=>e.id===id),RT)[0]&&fx[id].h===sizeOf(man.assets.find(e=>e.id===id),RT)[1]),`a fixture for every town and landmark piece at the ${RT} tier (${mine.length})`);
  for(const id of mine)install(id);
  ok(Tr.terrainArt(),'a town piece loaded: chunks are painted at TILE');
  const on=render(),d1=diffs(on,off,inside(boxes));
  ok(d1.n>0&&!d1.out,`fixtures on: ${d1.n} art pixels from assets, all inside the pieces' boxes`+(d1.out?` (${d1.out} outside)`:''));
  ok(same(render(),on),'fixtures on: deterministic');ok(mapHash()===m0,'fixtures on: the map (tiles and zones) is unchanged');
  // one piece removed: only its own boxes change (the procedural hall comes back there)
  const st=D.townStyle(CITY[0]),hall=TA.pieceId(st,'hall'),hallBoxes=boxes.filter(p=>p.id===hall);
  A.setAssetPixels(hall,null);const part=render(),d2=diffs(part,on,inside(hallBoxes));
  ok(d2.n>0&&!d2.out,`${hall} removed: ${d2.n} pixels fall back, all inside its ${hallBoxes.length} hall box(es)`+(d2.out?` (${d2.out} outside)`:''));
  install(hall);ok(same(render(),on),'and back when it returns');
  // the base strip (#763): a generated building stands on a dark strip over the bottom 2 world units of its box, which the
  // building recipe leaves clear (post.base); here the hall's bottom rows are cut away so the strip shows
  {const f=fx[hall],cut={w:f.w,h:f.h,data:new Uint8Array(f.data)},rows=Math.round(2*ART);for(let y=f.h-rows;y<f.h;y++)for(let x=0;x<f.w;x++)cut.data[(y*f.w+x)*4+3]=0;
    A.setAssetPixels(hall,A.pixelsOf(cut.w,cut.h,cut.data));const px=render();let tot=0,dark=0;
    px.forEach((p,k)=>{const [x0,y0,x1]=regions[k],w=(x1-x0)*RT;for(let j=0;j<p.length;j++){const tx=x0+(j%w+.5)/RT,ty=y0+(Math.floor(j/w)+.5)/RT;
      for(const q of hallBoxes){const b=q.box;if(tx>=b[0]+1/U&&tx<b[0]+b[2]-1/U&&ty>=b[1]+b[3]-2/U&&ty<b[1]+b[3]){tot++;if(p[j]===0xff000000)dark++}}}});
    ok(tot>0&&dark===tot&&!diffs(px,on,inside(hallBoxes)).out,`the base strip lies under a generated building, inside its box (${dark}/${tot} art pixels)`);install(hall)}
  {const L=LP.find(p=>p.id==='landmark:lair');if(L)ok(L.rot===({W:0,N:1,E:2,S:3}[L.L.opening]||0),`the lair's nest faces its mouth (${L.L.opening}, ${L.rot} quarter turns)`)}
  for(const id of mine)A.setAssetPixels(id,null);
  ok(same(render(),off),'fixtures removed: the procedural towns and landmarks are back, pixel for pixel');
  ok(!Tr.terrainArt()&&mapHash()===m0,`${process.env.ELDMOOR_WORLD||'eldmoor'}: chunks back on the procedural grid, the map hash never moved`)}
