#!/usr/bin/env node
// Art review summary (#712): `npm run art:review` says what waits in assets/incoming and how the art is doing.
// Per kind: in the game (accepted), waiting, rejected (and redrawn), flat or failed (with the reason), still missing from the manifest;
// spend (credits from logs/art.log) or ZeroGPU minutes; and which kinds need an in-game preview before they are accepted.
// Read-only. Options: --dir assets, --log logs/art.log, --manifest FILE, --tier N, --json.
import {readFileSync,existsSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT,ASSETS,MANIFEST,KINDS,TILE,loadManifest,loadIndex,loadQueue,tierKey,splitKey} from './lib.mjs';
import {parseArgs,today} from './gen.mjs';
import {spentOn,jobsFor} from './daily.mjs';
import {gpuWindow,windowEnd} from './space.mjs';

// Priority slices of the manifest (priorities[].n), by their short names.
export const SLICES=['terrain','towns','sprites','portraits','scene','props'];
export const sliceName=(man,n)=>{const p=(man.priorities||[]).find(x=>x.n===n);return SLICES[n-1]||(p?p.name.split(/[ :(]/)[0]:'slice '+n)};

// Owner rule (#712): these are judged in the game, not on the contact sheet.
export const IN_GAME_KINDS=['building','landmark','sprite'];

// Inbox keys whose asset is already in assets/index.json (an alternate is a real candidate: it replaces the asset, so it stays).
export function staleIncoming(q,idx){return Object.keys(q.incoming).filter(k=>{const {id,tier,alt}=splitKey(k);return !alt&&!!idx.assets[tierKey(id,tier)]}).sort()}
export function waitingKeys(q,idx){const s=new Set(staleIncoming(q,idx));return Object.keys(q.incoming).filter(k=>!s.has(k)).sort()}

const kindOf=k=>splitKey(k).id.split(':')[0];
export function summarize({man,idx,q,logText='',tier=TILE,now=new Date(),dir=null}){
  const kinds=[...new Set([...KINDS,...man.assets.map(e=>e.kind)])],rows={};
  const row=k=>rows[k]=rows[k]||{kind:k,manifest:0,accepted:0,waiting:[],alts:0,rejected:0,flat:0,failed:0,failedWhy:[],missing:[]};
  for(const k of kinds)row(k);
  const have=new Set(Object.values(idx.assets).filter(a=>a.tier===tier).map(a=>a.id));
  for(const e of man.assets){const r=row(e.kind);r.manifest++;if(have.has(e.id))r.accepted++}
  const stale=staleIncoming(q,idx),wait=waitingKeys(q,idx);
  for(const k of wait){const {tier:t,alt}=splitKey(k);if(t!==tier)continue;const r=row(kindOf(k));if(alt)r.alts++;else r.waiting.push(k)}
  for(const [k,n] of Object.entries(q.rejected)){if(splitKey(k).tier===tier)row(kindOf(k)).rejected+=n}
  for(const [k,v] of Object.entries(q.failed)){if(splitKey(k).tier!==tier)continue;const r=row(kindOf(k));r.failed++;r.failedWhy.push(`${k}: ${v.why||'?'} (${v.tries} ${v.tries===1?'try':'tries'})`)}
  for(const [k,s] of Object.entries(q.stats||{})){const r=row(k);r.flat=s.flat||0}
  const left=jobsFor(man,idx,q,{tier}).filter(j=>!j.alt),leftAll=jobsFor(man,idx,q,{tier,retryFailed:true}).filter(j=>!j.alt);
  for(const j of leftAll)row(j.e.kind).missing.push(j.e.id);
  const blocked=leftAll.filter(j=>!left.some(l=>l.key===j.key)).map(j=>j.key); // failed 3 times: not retried by the run
  const date=today(now),zg=(man.allowance&&man.allowance.zeroGpu)||{},gw=gpuWindow(q,now),end=windowEnd(gw);
  const spend={today:spentOn(logText,date),month:spentOn(logText,date.slice(0,7)),monthly:(man.allowance&&man.allowance.monthlyUsd)||0,
    gpuMin:+(gw.s/60).toFixed(1),gpuImages:gw.images||0,gpuQuotaMin:zg.dailyMinutes||40,gpuStopMin:zg.stopAtMinutes||36,gpuResets:end&&end>now?end.toISOString():null,usesSpace:!!(gw.s||gw.images)};
  const preview=Object.values(rows).filter(r=>IN_GAME_KINDS.includes(r.kind)&&(r.waiting.length||r.alts)).map(r=>({kind:r.kind,keys:wait.filter(k=>kindOf(k)===r.kind&&splitKey(k).tier===tier)}));
  const ns=[...new Set([...(man.priorities||[]).map(p=>p.n),...man.assets.map(e=>e.priority)])].sort((a,b)=>a-b),byId=new Map(man.assets.map(e=>[e.id,e])),sl={};
  for(const n of ns)sl[n]={n,name:sliceName(man,n),accepted:0,waiting:0,missing:0,total:0,kinds:{}};
  const sOf=id=>sl[(byId.get(id)||{}).priority];
  for(const e of man.assets){const x=sl[e.priority];x.total++;x.kinds[e.kind]=(x.kinds[e.kind]||0)+1;if(have.has(e.id))x.accepted++}
  for(const j of leftAll)sl[j.e.priority].missing++;
  for(const k of wait){const {id,tier:t,alt}=splitKey(k);if(t===tier&&!alt&&sOf(id))sOf(id).waiting++}
  const days={};
  for(const k of wait){const {id,tier:t,alt}=splitKey(k);if(t!==tier)continue;const date=q.incoming[k].date,d=days[date]=days[date]||{date,waiting:0,ready:[],preview:[],sheet:null,ageDays:Math.max(0,Math.round((Date.parse(today(now))-Date.parse(date))/864e5))};
    d.waiting++;(IN_GAME_KINDS.includes(kindOf(k))?d.preview:d.ready).push(k)}
  for(const d of Object.values(days)){d.ready.sort();d.preview.sort();d.accept=d.ready.length?'npm run art:accept -- '+d.ready.join(' '):null;
    if(dir){const f=join(dir,'incoming',d.date);try{const h=readdirSync(f).filter(n=>n.endsWith('.html')).map(n=>({n,t:statSync(join(f,n)).mtimeMs})).sort((a,b)=>b.t-a.t);if(h.length)d.sheet='assets/incoming/'+d.date+'/'+h[0].n}catch{}}}
  return {tier,slices:Object.values(sl),days:Object.values(days).sort((a,b)=>b.date.localeCompare(a.date)),rows:Object.values(rows).filter(r=>r.manifest||r.waiting.length||r.alts||r.rejected||r.failed||r.flat),stale,waiting:wait.length,spend,preview,blocked,next:q.next||[],lastRun:q.lastRun||null}}

export function render(s){
  const L=[],pad=(v,n)=>String(v).padStart(n);
  L.push(s.waiting?`[art] review at tier ${s.tier}: ${s.waiting} waiting, ${s.stale.length} stale in the inbox`:`[art] nothing waiting (tier ${s.tier}${s.stale.length?`, ${s.stale.length} stale in the inbox`:''})`);
  L.push('','  slice       accepted  waiting  missing  of    kinds','  '+'-'.repeat(68));
  for(const x of s.slices)L.push(`  ${x.name.padEnd(11)} ${pad(x.accepted,8)}  ${pad(x.waiting,7)}  ${pad(x.missing,7)}  ${pad(x.total,4)}  ${Object.entries(x.kinds).map(([k,n])=>k+' '+n).join(', ')}`);
  L.push('','  kind        in game   waiting  alts  rejected  flat  failed  missing','  '+'-'.repeat(68));
  for(const r of s.rows)L.push(`  ${r.kind.padEnd(11)} ${pad(r.accepted+'/'+r.manifest,7)}  ${pad(r.waiting.length,7)}  ${pad(r.alts,4)}  ${pad(r.rejected,8)}  ${pad(r.flat,4)}  ${pad(r.failed,6)}  ${pad(r.missing.length,7)}`);
  L.push('','  in game = accepted into assets/, of the manifest; rejected = by the owner, each redrawn with a new seed; flat = rejected by post-processing as too flat (raw kept for art:reprocess)');
  const why=s.rows.flatMap(r=>r.failedWhy);if(why.length){L.push('','Failed draws and why:');for(const w of why.slice(0,15))L.push('  '+w);if(why.length>15)L.push(`  ... ${why.length-15} more`)}
  if(s.blocked.length)L.push('',`Not retried by the run (3 failures; art:daily --retry-failed): ${s.blocked.join(', ')}`);
  const sp=s.spend;L.push('','Spend:');
  if(sp.usesSpace)L.push(`  ZeroGPU: ${sp.gpuMin} of ${sp.gpuQuotaMin} min this window (${sp.gpuImages} images, runs stop at ${sp.gpuStopMin})${sp.gpuResets?`, resets ${sp.gpuResets}`:''}; Space images cost $0`);
  L.push(`  Credits: ~$${sp.today.toFixed(3)} today, ~$${sp.month.toFixed(3)} this month of $${sp.monthly.toFixed(2)} (from logs/art.log, router runs only)`);
  const miss=s.rows.filter(r=>r.missing.length);L.push('','Still missing from the manifest:');
  if(!miss.length)L.push('  nothing: every asset exists or waits for review');
  for(const r of miss)L.push(`  ${r.kind} (${r.missing.length}): ${r.missing.slice(0,8).join(', ')}${r.missing.length>8?', ...':''}`);
  if(s.stale.length){L.push('','Already accepted into assets/index.json but still listed in assets/queue.json (local, gitignored; hidden from art:accept --list):');L.push('  '+s.stale.join(', '))}
  L.push('','Review:');
  for(const d of s.days){L.push(`  ${d.date} (${d.ageDays} d old): ${d.waiting} waiting`+(d.sheet?`, contact sheet ${d.sheet}`:', no contact sheet'));
    if(d.accept)L.push('    ready to accept: '+d.accept);
    if(d.preview.length)L.push('    needs an in-game preview first, NOT in the line above: '+d.preview.join(' '))}
  if(s.preview.length){L.push('  Buildings, landmarks and sprites are judged in the game, not on the contact sheet (owner rule).')}
  const sheet=s.rows.filter(r=>!IN_GAME_KINDS.includes(r.kind)&&(r.waiting.length||r.alts));
  if(sheet.length)L.push('  Fine on the contact sheet: '+sheet.map(r=>`${r.kind} (${r.waiting.length+r.alts})`).join(', '));
  if(!s.waiting)L.push('  nothing waiting');
  return L.join('\n')}

export function main(argv=process.argv.slice(2)){
  const o=parseArgs(argv,['dir','log','manifest','tier']),dir=o.dir||ASSETS,tier=Number(o.tier)||TILE,man=loadManifest(o.manifest||MANIFEST),
    logP=o.log||process.env.ART_LOG||join(ROOT,'logs','art.log'),s=summarize({dir,man,idx:loadIndex(dir),q:loadQueue(dir),logText:existsSync(logP)?readFileSync(logP,'utf8'):'',tier});
  console.log(o.json?JSON.stringify(s,null,1):render(s));return 0}
if(/review\.mjs$/.test(process.argv[1]||''))process.exit(main());
