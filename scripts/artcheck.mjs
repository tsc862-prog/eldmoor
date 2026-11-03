#!/usr/bin/env node
// npm run artcheck (#177): the art pipeline without a network or a token.
//  1. the manifest is valid and every id has a procedural fallback hook in its renderer (and every hook id is in the manifest);
//  2. the real assets/ folder (absent is fine) matches assets/index.json: files exist, sizes and sha256 right, no strays;
//  3. the PNG codec and the post-processing (palette only, transparency, outline, deterministic);
//  4. scripts/art/gen.mjs and daily.mjs end to end against a mock Hugging Face server: dry runs, --max, the provider
//     lookup, a refused model and the next candidate pinned, a 402 and a quota 429 stop and the next day's resume,
//     ART_MAX_CALLS, rate headers, art:accept/--reject, alternates, no call once complete, a refused token; the temp
//     assets folder then passes the index check (assets present);
//  5. the terrain renders the same with no assets, uses a tile asset when one is there, and goes back when it is removed;
//  6. the autotile rules (slice 2) on headless Eldmoor and Stepping Lands maps with fixture PNGs (scripts/art/fixtures.mjs,
//     drawn in code, written to a temp folder, never assets/) on, one piece removed, and off: same map, pieces and
//     variants placed by tile hash, fallback per tile, the procedural render back exactly;
//  7. tiers (#177, src/render/tile.js): index keys and files per tier, the loader keeps only the renderer's tier (a 64
//     asset under TILE 32 is absent, so the procedural art is drawn), the procedural texel scaled to TILE where an
//     asset is missing, generation settings per tier (LoRA scale, pixel grid, palette widening) in the requests and
//     outputs of gen/daily --tier 64, a queue and index from before tiers read as the 32 tier, and sprite sheets.
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {ROOT,ASSETS,loadManifest,loadIndex,validateManifest,checkHooks,checkIndex,fileOf,sizeOf,tierKey,normKey,splitKey,keyFile,loadQueue,tierCfg,TILE,TIERS} from './art/lib.mjs';
import {decodePng,encodePng,pngSize} from './art/png.mjs';
import {resolvePalette,hexToRgb,downscale} from './art/post.mjs';
import {postProcess,detectGrid,expandPalette,colorCount} from './art/post-texture.mjs';

let fails=0;const ok=(c,m)=>{if(c)console.log('  ok  '+m);else{fails++;console.log('  FAIL '+m)}};
const man=loadManifest();
const PAL=await import('../src/render/palette.js');
// Child mode for part 6: one world per process (the world modules pick ELDMOOR_WORLD when they load).
if(process.argv[2]==='--autotile'){await autotileProbe();process.exit(fails?1:0)}

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
const propArt=()=>{const a=pixelArt(1024,8,{seed:13});for(let y=0;y<1024;y++)for(let x=0;x<1024;x++)if((x-512)**2+(y-560)**2>360**2){const o=(y*1024+x)*4;a.data[o]=a.data[o+1]=a.data[o+2]=255}return a};
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
{const e={kind:'sprite',size:[16,16],post:{transparent:true,outline:true}},pal=['#3f8a3a','#2a6e2c','#45923c'];
  const a=postProcess(synth(256,256),e,pal,PAL.MARK.outline),b=postProcess(synth(256,256),e,pal,PAL.MARK.outline);
  ok(a.w===16&&a.h===16,'a sprite is scaled to 16x16');ok(Buffer.from(a.data).equals(Buffer.from(b.data)),'deterministic');
  const allowed=new Set([...expandPalette(pal,6),PAL.MARK.outline].map(c=>hexToRgb(c).join(',')));let bad=0,clear=0,line=0;
  for(let i=0;i<256;i++){const o=i*4;if(a.data[o+3]===0){clear++;continue}if(!allowed.has([a.data[o],a.data[o+1],a.data[o+2]].join(',')))bad++;if([a.data[o],a.data[o+1],a.data[o+2]].join(',')===hexToRgb(PAL.MARK.outline).join(','))line++}
  ok(!bad,'only palette colours (and the outline)');ok(clear>40,`background cleared (${clear} clear pixels)`);ok(line>8,`1px outline drawn (${line} pixels)`);
  const t=postProcess(pixelArt(),{kind:'tile',size:[32,32],post:{}},pal);let opaque=0;for(let i=0;i<32*32;i++)if(t.data[i*4+3]===255)opaque++;ok(opaque===1024,'a tile stays opaque')}

console.log('gen.mjs and daily.mjs against a mock Hugging Face server');
const tmp=mkdtempSync(join(tmpdir(),'eldmoor-art-'));
try{
  // The mock: the Hub's provider mapping (as seen on 2026-11-02) and fal-ai image routes, with switches for refusals.
  const MOCK_TOKEN='hf_mockArtcheckToken123',MAPS={
    'nerijs/pixel-art-xl':{'fal-ai':{status:'live',providerId:'fal-ai/fast-sdxl',task:'text-to-image',adapter:'lora',adapterWeightsPath:'pixel-art-xl.safetensors'}},
    'artificialguybr/PixelArtRedmond':{'fal-ai':{status:'live',providerId:'fal-ai/fast-sdxl',task:'text-to-image',adapter:'lora',adapterWeightsPath:'PixelArtRedmond-Lite64.safetensors'}},
    'UmeAiRT/FLUX.1-dev-LoRA-Modern_Pixel_art':{'fal-ai':{status:'live',providerId:'fal-ai/flux-lora',task:'text-to-image',adapter:'lora',adapterWeightsPath:'ume_modern_pixelart.safetensors'}},
    'tarn59/pixel_art_style_lora_z_image_turbo':{'fal-ai':{status:'live',providerId:'fal-ai/z-image/turbo/lora',task:'text-to-image',adapter:'lora',adapterWeightsPath:'pixel_art_style_z_image_turbo.safetensors'}},
    'black-forest-labs/FLUX.1-schnell':{'fal-ai':{status:'live',providerId:'fal-ai/flux/schnell',task:'text-to-image'}}};
  const S={posts:[],ok:0,lookups:0,deny:false,refuse:null,quota402:Infinity,quota429:Infinity,zeroLeft:false,flat:false,headers:[]};
  const img=encodePng(pixelArt()),flatImg=encodePng(pixelArt(1024,8,{flat:true}));
  // what a prompt asks for: a transition (two grounds, top and bottom) or a prop on a plain white background
  const MOCK={tile:img,two:encodePng(twoGrounds()),prop:encodePng(propArt())},mockKind=pr=>/plain white background/.test(pr)?'prop':/transition tile/.test(pr)?'two':'tile';
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
      if(S.ok>=S.quota429){res.statusCode=429;res.setHeader('retry-after','3600');return res.end('{"error":"You have reached your daily usage limit. Subscribe to PRO to get more credits."}')}
      S.ok++;res.setHeader('content-type','application/json');if(S.zeroLeft)res.setHeader('x-ratelimit-remaining','0');
      // alternate the two answer shapes fal gives: a data: URL and a URL to fetch
      const k=mockKind(j.prompt||''),im=S.flat?flatImg:MOCK[k];return res.end(JSON.stringify({images:[{url:S.ok%2?'data:image/png;base64,'+im.toString('base64'):`http://127.0.0.1:${srv.address().port}/img/out.png?k=${k}`}]}))}
    res.statusCode=404;res.end('no')})});
  await new Promise(f=>srv.listen(0,'127.0.0.1',f));const base=`http://127.0.0.1:${srv.address().port}`;
  const env={...process.env,HF_TOKEN:MOCK_TOKEN,HF_ROUTER_URL:base,HF_HUB_URL:base,ART_DAILY_BUDGET:'100'};delete env.ART_MAX_CALLS;
  const node=(script,a,extra={})=>new Promise(f=>{const c=spawn(process.execPath,[join(ROOT,'scripts','art',script),...a],{env:{...env,...extra},stdio:['ignore','pipe','pipe']});
    let s='';c.stdout.on('data',d=>s+=d);c.stderr.on('data',d=>s+=d);c.on('close',code=>f({code,s}))});
  const N=man.assets.length;

  // --- gen.mjs: the direct tool, straight into an assets folder
  {const out=join(tmp,'gen-assets'),run=(...a)=>node('gen.mjs',['--out',out,...a]);
    let r=await run('--dry-run');ok(r.code===0&&/estimated cost: \$/.test(r.s)&&/dry run: first request POST .*\/fal-ai\/fal-ai\/fast-sdxl/.test(r.s)&&!S.posts.length&&!existsSync(out),'gen --dry-run: plan, cost and the first request; no image call, no files');
    ok(/"loras"/.test(r.s)&&/pixel-art-xl\.safetensors/.test(r.s)&&/"seed": 1771/.test(r.s),'the request carries the LoRA from the Hub lookup and the seed');
    r=await run();ok(r.code===0&&/add --yes/.test(r.s)&&!S.posts.length,'gen without --yes: plan only');
    r=await run('--yes','--max','1');ok(r.code===0&&S.posts.length===1&&/stopping at --max 1/.test(r.s),'gen --max 1 makes one image');
    ok(checkIndex(man,out).count===1&&!checkIndex(man,out).errs.length,'index valid after one');
    r=await run('--yes');ok(r.code===0&&S.posts.length===N,`gen makes the rest (${S.posts.length}/${N} calls)`);
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
    ok(/made 4 \| rejected 0 \| calls 6 \| est\. \$0\.040 \(month \$0\.040 of \$2\.00 credits\)/.test(lastLog())&&/stop: allowance used: HTTP 402/.test(lastLog())&&/next: tile:mud/.test(lastLog()),'art.log: made, calls, estimated credits, the 402 stop and what is next: '+lastLog());
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
    r=await node('accept.mjs',['--dir',dir,'--reject','tile:mud']);q=Q();ok(r.code===0&&q.rejected['tile:mud@32']===1&&!q.incoming['tile:mud@32'],'a rejected asset leaves the queue for a redraw');
    r=await node('accept.mjs',['--dir',dir,'tile:nope']);ok(r.code===2,'accepting an unknown id is refused');
    const p5=P0();r=await daily(['--now','--date',days[d]]);q=Q();
    ok(S.posts.slice(p5).some(p=>p.seed===1775+7919),'the rejected asset is redrawn with a new seed');
    ok(Object.keys(q.incoming).length+checkIndex(man,dir).count===N,`--now finishes the manifest (${Object.keys(q.incoming).length} waiting + ${checkIndex(man,dir).count} accepted)`);
    r=await node('accept.mjs',['--dir',dir,'all']);ok(r.code===0&&checkIndex(man,dir).count===N&&!checkIndex(man,dir).errs.length&&!Object.keys(Q().incoming).length,'accept all: every asset in assets/, index valid');
    {const sh=await node('sheet.mjs',['--assets',dir,'--out',join(tmp,'sheet.html')]);const html=existsSync(join(tmp,'sheet.html'))?readFileSync(join(tmp,'sheet.html'),'utf8'):'';
      const TN=man.assets.filter(e=>e.hook.module==='src/render/terrain.js').length; // terrain fallbacks are painted in Node; sprite fallbacks need a canvas
      ok(sh.code===0&&(html.match(/<img /g)||[]).length>=N*3+TN*3,`contact sheet: ${N} assets at 1x/2x/4x and the ${TN} terrain fallbacks`+(sh.code?' '+sh.s.slice(0,300):' ('+(html.match(/<img /g)||[]).length+' images)'))}
    // alternates once the manifest is complete; an accepted alternate replaces its asset
    d++;const p6=P0();r=await daily(['--date',days[d],'--max','3']);q=Q();
    ok(P0()-p6===3&&Object.keys(q.incoming).every(k=>/#alt1$/.test(k))&&S.posts.slice(p6).every(p=>p.seed>=2771),'complete manifest: alternates with new seeds (--max 3)');
    const altKey=Object.keys(q.incoming)[0],before=checkIndex(man,dir);r=await node('accept.mjs',['--dir',dir,altKey]);
    {const ix=loadIndex(dir),id=altKey.split('#')[0];ok(r.code===0&&ix.assets[id].fromAlt===1&&before.count===N&&!checkIndex(man,dir).errs.length,'an accepted alternate replaces its asset')}
    d++;r=await daily(['--date','2026-12-10'],{ART_MAX_CALLS:'400'});r=await node('accept.mjs',['--dir',dir,'all']); // all the alternates in one run (2 per asset exceeds the default 100 calls as the manifest grows), in a new month: November's $2.00 is spent by now
    d++;const p7=P0();r=await daily(['--date','2026-12-11']);ok(P0()===p7&&/manifest complete, alternates too: no call/.test(lastLog()),'everything made: no call at all');
    ok(readFileSync(logP,'utf8').trim().split('\n').every(l=>/^\d{4}-\d\d-\d\d \d\d:\d\d \| made \d+ \| rejected \d+ \| calls \d+ \| est\. \$[\d.]+ \(month \$[\d.]+ of \$2\.00 credits\)/.test(l)),'every art.log line has date, made, rejected, calls and the estimated credits');
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
    r=await node('daily.mjs',['--dir',dir4,'--log',log4,'--date','2026-12-05'],{ART_DAILY_BUDGET:''});
    ok(S.posts.length-p2===6&&/stop: daily share used \(est\. \$0\.060 of \$0\.065\)/.test(last(log4)),'a run stops at the day\'s share of the monthly credits: '+last(log4));
    r=await node('daily.mjs',['--dir',dir4,'--log',log4,'--date','2026-12-05'],{ART_DAILY_BUDGET:''});ok(S.posts.length-p2===6&&/already ran today/.test(r.s),'and does not run again that day');
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
  const old=mkdtempSync(join(tmpdir(),'eldmoor-oldq-'));
  try{writeFileSync(join(old,'queue.json'),JSON.stringify({version:1,incoming:{'tile:grass':{date:'2026-11-03',file:'tile/grass.png'}},rejected:{'tile:mud':1},alts:{},failed:{},next:['tile:swamp']}));
    writeFileSync(join(old,'index.json'),JSON.stringify({version:1,assets:{'tile:grass':{id:'tile:grass',file:'tile/grass.png',w:32,h:32}}}));
    const q=loadQueue(old),ix=loadIndex(old);
    ok(q.incoming['tile:grass@32']&&q.incoming['tile:grass@32'].file==='tile/grass.png'&&q.rejected['tile:mud@32']===1&&q.next[0]==='tile:swamp@32'&&ix.assets['tile:grass@32'].tier===32,'the owner\'s queue and incoming index from before tiers (2026-11-03) carry over as the 32 tier')}
  finally{rmSync(old,{recursive:true,force:true})}}

console.log('autotile rules with fixture PNGs (slice 2)');
for(const world of ['eldmoor','stepping']){
  const r=await new Promise(f=>{const c=spawn(process.execPath,[join(ROOT,'scripts','artcheck.mjs'),'--autotile'],{env:{...process.env,ELDMOOR_WORLD:world},stdio:['ignore','pipe','pipe']});
    let s='';c.stdout.on('data',d=>s+=d);c.stderr.on('data',d=>s+=d);c.on('close',code=>f({code,s}))});
  process.stdout.write(r.s.split('\n').filter(Boolean).map(l=>l.replace(/^ {2}(ok |FAIL)/,`  $1 [${world}]`)).join('\n')+'\n');
  if(r.code!==0){fails++;if(!/FAIL/.test(r.s))console.log(`  FAIL [${world}] the autotile probe exited ${r.code}`)}}

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
  const fx=fixtures(man,RT),dir=mkdtempSync(join(tmpdir(),'eldmoor-fixtures-')),{mkdirSync}=await import('node:fs'),{sha256}=await import('./art/lib.mjs'),{dirname}=await import('node:path');
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
