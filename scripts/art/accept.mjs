#!/usr/bin/env node
// Review step of the daily art run (#177): keep or drop what waits in assets/incoming/<date>/.
//   npm run art:accept -- tile:grass tile:snow     move these into assets/ and assets/index.json (at the game's tier;
//                                                  name another tier as tile:grass@64)
//   npm run art:accept -- all                      every waiting asset
//   npm run art:accept -- tile:grass#alt1          an alternate replaces the asset it is an alternate of
//   npm run art:accept -- --reject tile:mud        drop it; tomorrow's run redraws it with a new seed
//   npm run art:accept -- --list                   what waits
// Accepted assets reach main only through a normal PR (pixel-artist), never by this script.
import {readFileSync,writeFileSync,existsSync,mkdirSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {ASSETS,loadIndex,loadQueue,saveQueue,fileOf,sha256,splitKey,TILE,tierKey} from './lib.mjs';
import {parseArgs,writeIndex} from './gen.mjs';

export function main(argv=process.argv.slice(2)){
  const o=parseArgs(argv,['dir']),dir=o.dir||ASSETS,q=loadQueue(dir),waiting=Object.keys(q.incoming).sort();
  if(o.list||!o._.length){console.log(waiting.length?`[art] waiting for review (${waiting.length}):\n`+waiting.map(k=>`  ${k}  assets/incoming/${q.incoming[k].date}/${q.incoming[k].file}`).join('\n'):'[art] nothing waits for review');
    if(!o._.length&&!o.list)console.log('[art] usage: npm run art:accept -- <ids>|all [--reject]');return 0}
  // a key without a tier means the game's tier: 'tile:grass' -> 'tile:grass@32', 'tile:grass#alt1' -> 'tile:grass@32#alt1'
  const keys=o._.includes('all')?waiting:o._.map(k=>/@\d+/.test(k)?k:k.replace(/^([^#]*)/,`$1@${TILE}`)),unknown=keys.filter(k=>!q.incoming[k]);
  if(unknown.length){console.error(`[art] not waiting for review: ${unknown.join(', ')} (npm run art:accept -- --list)`);return 2}
  const idx=loadIndex(dir),incIdx=new Map();let n=0;
  for(const k of keys){const w=q.incoming[k],inc=join(dir,'incoming',w.date),src=join(inc,w.file),{id,tier,alt}=splitKey(k),base=tierKey(id,tier);
    let ii=incIdx.get(w.date);if(!ii){ii=loadIndex(inc);incIdx.set(w.date,ii)}
    if(o.reject){if(existsSync(src))rmSync(src);if(!alt)q.rejected[base]=(q.rejected[base]||0)+1;console.log(`[art] rejected ${k}${alt?'':' (redrawn with a new seed on the next run)'}`)}
    else{if(!existsSync(src)){console.error(`[art] ${k}: ${src} is gone; skipped`);continue}
      const png=readFileSync(src),file=fileOf(id,tier),dst=join(dir,file),meta=ii.assets[k]||{};
      mkdirSync(dirname(dst),{recursive:true});writeFileSync(dst,png);rmSync(src);
      idx.assets[base]={...meta,id,tier,file,sha256:sha256(png),accepted:new Date().toISOString(),...(alt?{fromAlt:alt}:{})};delete idx.assets[base].alt;
      console.log(`[art] accepted ${k} -> assets/${file}`)}
    delete ii.assets[k];delete q.incoming[k];n++}
  for(const [date,ii] of incIdx)writeIndex(join(dir,'incoming',date),ii);
  if(!o.reject)writeIndex(dir,idx);saveQueue(dir,q);
  console.log(`[art] ${n} ${o.reject?'rejected':'accepted'}; ${Object.keys(q.incoming).length} still waiting.`+(o.reject?'':' Commit assets/ through a PR; npm run artcheck checks it.'));
  return 0}

if(/accept\.mjs$/.test(process.argv[1]||''))process.exit(main());
