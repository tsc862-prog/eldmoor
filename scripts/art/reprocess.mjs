#!/usr/bin/env node
// Re-run post-processing on the provider images a daily run kept (#177): no network, no credits.
//   npm run art:reprocess -- 2026-11-03               every raw image of that day
//   npm run art:reprocess -- 2026-11-03 tile:grass    only these keys (an alternate is tile:grass#alt1; another tier tile:grass@64)
//   npm run art:reprocess -- all                      every day under assets/incoming/
// Reads assets/incoming/<date>/raw/index.json and the raw files, applies the current manifest entry and
// post-processing (scripts/art/post-texture.mjs), and rewrites assets/incoming/<date>/<kind>/<name>.png, that day's
// index.json and sheet.html. An output that is still flat is removed from review (logged), its raw image kept. An image made from
// an init image (#763) is read back through the init kept beside it; a raw from before image to image keeps the text recipe.
// Accept the results as usual with npm run art:accept.
import {readFileSync,existsSync,writeFileSync,mkdirSync,rmSync,readdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT,MANIFEST,ASSETS,loadManifest,loadIndex,loadQueue,saveQueue,keyFile,splitKey,sha256,normKey,TILE} from './lib.mjs';
import {parseArgs,processRaw,writeIndex} from './gen.mjs';
import {loadInit} from './init.mjs';

export async function main(argv=process.argv.slice(2)){
  const o=parseArgs(argv,['dir','manifest']),dir=o.dir||ASSETS,man=loadManifest(o.manifest||MANIFEST),PAL=await import('../../src/render/palette.js');
  const [day,...keys]=o._,only=keys.map(k=>normKey(k,TILE));if(!day){console.error('[art] usage: npm run art:reprocess -- <date>|all [keys...]');return 2}
  const root=join(dir,'incoming'),days=day==='all'?(existsSync(root)?readdirSync(root).filter(d=>/^\d{4}-\d\d-\d\d$/.test(d)):[]):[day];
  const q=loadQueue(dir),byId=new Map(man.assets.map(e=>[e.id,e]));let ok=0,flat=0,skipped=0;
  for(const d of days){const inc=join(root,d),ri=loadIndex(join(inc,'raw'));
    if(!Object.keys(ri.assets).length){console.log(`[art] ${d}: no raw images kept (runs before this change kept none)`);continue}
    const ii=loadIndex(inc);
    for(const [key,r] of Object.entries(ri.assets)){if(only.length&&!only.includes(key))continue;
      const {id,tier}=splitKey(key),e=byId.get(id);if(!e){console.log(`[art] ${key}: no longer in the manifest; skipped`);skipped++;continue}
      if(q.incoming[key]===undefined&&ii.assets[key]===undefined&&q.failed[key]===undefined&&!only.includes(key)){skipped++;continue} // accepted or rejected since
      const file=keyFile(key),out=join(inc,file);
      try{const {img,png}=processRaw(readFileSync(join(inc,'raw',r.file)),e,PAL,man.models[r.model],tier,man,r.init?loadInit(inc,r.init):null);
        mkdirSync(dirname(out),{recursive:true});writeFileSync(out,png);
        ii.assets[key]={id,tier,kind:e.kind,file,w:img.w,h:img.h,colors:img.notes.colors,grid:img.notes.grid,sha256:sha256(png),model:r.model,repo:r.repo,provider:r.provider,seed:r.seed,at:r.at,reprocessed:new Date().toISOString(),...(r.alt?{alt:r.alt}:{})};
        q.incoming[key]={date:d,file};delete q.failed[key];ok++;
        console.log(`[art] ${key}: ${img.w}x${img.h}, ${img.notes.colors} colours, grid ${img.notes.grid}, native ${img.notes.native}, seam ${img.notes.seam??'-'}`)}
      catch(err){if(err.kind!=='flat')throw err;flat++;if(existsSync(out))rmSync(out);delete ii.assets[key];delete q.incoming[key];
        q.failed[key]={tries:(q.failed[key]&&q.failed[key].tries)||1,why:err.message,at:new Date().toISOString()};
        console.log(`[art] ${key}: rejected, ${err.message}${err.notes?` (grid ${err.notes.grid}, native ${err.notes.native})`:''}`)}}
    writeIndex(inc,ii);
    const sh=spawnSync(process.execPath,[join(ROOT,'scripts','art','sheet.mjs'),'--assets',inc,'--out',join(inc,'sheet.html'),'--generated'],{encoding:'utf8'});
    if(sh.status===0)console.log(`[art] review: ${join(inc,'sheet.html')}`)}
  saveQueue(dir,q);
  console.log(`[art] reprocessed ${ok}, rejected ${flat}, skipped ${skipped}; no call was made`);
  return 0}

if(/reprocess\.mjs$/.test(process.argv[1]||''))main().then(c=>process.exit(c),e=>{console.error(e);process.exit(1)});
