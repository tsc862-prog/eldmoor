#!/usr/bin/env node
// Review step of the daily art run (#177): keep or drop what waits in assets/incoming/<date>/.
//   npm run art:accept -- tile:grass tile:snow     move these into assets/ and assets/index.json (at the game's tier;
//                                                  name another tier as tile:grass@64)
//   npm run art:accept -- all                      every waiting asset
//   npm run art:accept -- tile:grass#alt1          an alternate replaces the asset it is an alternate of
//   npm run art:accept -- --reject tile:mud        drop it; tomorrow's run redraws it with a new seed
//   npm run art:accept -- --list                   what waits
// Accepted assets reach main only through a normal PR (pixel-artist), never by this script.
// Buildings and landmarks (#763) are taken only after an in-game look: npm run art:preview -- <key> stages the candidate in a
// town at 3440x1440, camera zoom 1, beside the procedural houses, and saves the shot next to the inbox entry; accept checks
// that shot belongs to this very image (its sha256), then runs the style gate (scripts/art/post-flat.mjs) on the PNG for
// entries on the building recipe, and records both in the index entry (check: {preview, view, town, at, gate}). A refused
// key stays waiting; the others are still accepted (exit 2 when any was refused).
import {readFileSync,writeFileSync,existsSync,mkdirSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {ASSETS,loadIndex,loadQueue,saveQueue,fileOf,sha256,splitKey,TILE,tierKey,loadManifest,MANIFEST,PREVIEW_KINDS} from './lib.mjs';
import {parseArgs,writeIndex} from './gen.mjs';
import {decodePng} from './png.mjs';
import {resolvePalette} from './post.mjs';
import {styleGate,gateOf} from './post-flat.mjs';
import {staleIncoming} from './review.mjs';

// The in-game look a building or landmark needs (#763): null when it has a valid one, else why not.
export const PREVIEW_VIEW={w:3440,h:1440,zoom:1};
export function previewProblem(meta,png,inc){const pv=meta&&meta.preview;
  if(!pv)return 'no in-game look yet';
  if(pv.sha256!==sha256(png))return 'the in-game look was of an earlier image (reprocessed since)';
  if(!pv.file||!existsSync(join(inc,pv.file)))return `the preview shot ${pv.file||'(none)'} is gone`;
  const v=pv.view||{};if(!(v.w>=PREVIEW_VIEW.w&&v.h>=PREVIEW_VIEW.h&&v.zoom===PREVIEW_VIEW.zoom))return `the preview was not at ${PREVIEW_VIEW.w}x${PREVIEW_VIEW.h}, zoom ${PREVIEW_VIEW.zoom}`;
  return null}

export async function main(argv=process.argv.slice(2)){
  const o=parseArgs(argv,['dir','manifest']),dir=o.dir||ASSETS,q=loadQueue(dir),stale=staleIncoming(q,loadIndex(dir)),waiting=Object.keys(q.incoming).filter(k=>!stale.includes(k)).sort(); // #712: ids already in assets/index.json do not wait
  const man=loadManifest(o.manifest||MANIFEST),byId=new Map(man.assets.map(e=>[e.id,e])),PAL=await import('../../src/render/palette.js');
  if(o.list||!o._.length){if(stale.length)console.log(`[art] ${stale.length} in assets/queue.json already in assets/index.json, skipped: ${stale.join(', ')}`);console.log(waiting.length?`[art] waiting for review (${waiting.length}):\n`+waiting.map(k=>`  ${k}  assets/incoming/${q.incoming[k].date}/${q.incoming[k].file}`+(PREVIEW_KINDS.includes(k.split(':')[0])&&!((loadIndex(join(dir,'incoming',q.incoming[k].date)).assets[k]||{}).preview)?'  (needs npm run art:preview first)':'')).join('\n'):'[art] nothing waits for review');
    if(!o._.length&&!o.list)console.log('[art] usage: npm run art:accept -- <ids>|all [--reject]');return 0}
  // a key without a tier means the game's tier: 'tile:grass' -> 'tile:grass@32', 'tile:grass#alt1' -> 'tile:grass@32#alt1'
  const keys=o._.includes('all')?waiting:o._.map(k=>/@\d+/.test(k)?k:k.replace(/^([^#]*)/,`$1@${TILE}`)),unknown=keys.filter(k=>!q.incoming[k]);
  if(unknown.length){console.error(`[art] not waiting for review: ${unknown.join(', ')} (npm run art:accept -- --list)`);return 2}
  const idx=loadIndex(dir),incIdx=new Map();let n=0,refused=0;
  for(const k of keys){const w=q.incoming[k],inc=join(dir,'incoming',w.date),src=join(inc,w.file),{id,tier,alt}=splitKey(k),base=tierKey(id,tier);
    let ii=incIdx.get(w.date);if(!ii){ii=loadIndex(inc);incIdx.set(w.date,ii)}
    if(o.reject){if(existsSync(src))rmSync(src);if(!alt)q.rejected[base]=(q.rejected[base]||0)+1;console.log(`[art] rejected ${k}${alt?'':' (redrawn with a new seed on the next run)'}`)}
    else{if(!existsSync(src)){console.error(`[art] ${k}: ${src} is gone; skipped`);continue}
      const png=readFileSync(src),file=fileOf(id,tier),dst=join(dir,file),meta=ii.assets[k]||{},e=byId.get(id),kind=(e&&e.kind)||id.split(':')[0];let check;
      if(PREVIEW_KINDS.includes(kind)){const why=previewProblem(meta,png,inc);
        if(why){console.error(`[art] ${k} refused: ${why}. Run npm run art:preview -- ${k} (it stages it in a town at 3440x1440, zoom 1, beside the procedural houses) and look at the shot first`);refused++;continue}
        let gate=null;if(e&&e.post&&e.post.flat){gate=styleGate(decodePng(png),resolvePalette(e.palette,PAL).colors,gateOf(e));
          if(!gate.ok){console.error(`[art] ${k} refused: off-style (${gate.why.join('; ')}); reject it (--reject) and let the next run redraw it`);refused++;continue}}
        const pv=meta.preview;check={preview:`incoming/${w.date}/${pv.file}`,view:pv.view,town:pv.town,at:pv.at,gate};}
      mkdirSync(dirname(dst),{recursive:true});writeFileSync(dst,png);rmSync(src);
      idx.assets[base]={...meta,id,tier,file,sha256:sha256(png),accepted:new Date().toISOString(),...(alt?{fromAlt:alt}:{}),...(check?{check}:{})};delete idx.assets[base].alt;delete idx.assets[base].preview;
      console.log(`[art] accepted ${k} -> assets/${file}`)}
    delete ii.assets[k];delete q.incoming[k];n++}
  for(const [date,ii] of incIdx)writeIndex(join(dir,'incoming',date),ii);
  if(!o.reject)writeIndex(dir,idx);saveQueue(dir,q);
  console.log(`[art] ${n} ${o.reject?'rejected':'accepted'}${refused?`, ${refused} refused`:''}; ${Object.keys(q.incoming).length} still waiting.`+(o.reject?'':' Commit assets/ through a PR; npm run artcheck checks it.'));
  return refused?2:0}

if(/accept\.mjs$/.test(process.argv[1]||''))main().then(c=>process.exit(c),e=>{console.error(e);process.exit(1)});
