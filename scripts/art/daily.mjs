#!/usr/bin/env node
// The daily art run (#177, owner request 2026-11-03): use the account's monthly Hugging Face credits evenly, every day.
//
//   npm run art:daily                  run once today (a second run the same day does nothing unless the first failed early)
//   npm run art:daily -- --now         run now, even if today's run already happened
//   npm run art:daily -- --now --max 5 at most 5 images
//   npm run art:daily -- --dry-run     the plan: what is next, which model; no call
//   npm run art:daily -- --tier 64     make the 64 px tier (default: src/render/tile.js TILE, the tier the game draws).
//                                      Same manifest, prompts and seeds; sizes and generation settings of that tier.
//   scripts\art\schedule.cmd [HH:MM]   register the Windows task that runs it daily (default 09:00)
//
// It walks scripts/art/manifest.json in priority order (terrain tileset, towns and landmarks, sprites, the portrait
// library, scene tiles, props), generating the next missing asset until the day's share of the credits is spent (see
// Credits below) or the API refuses (HTTP 402, a 429 or 403 that speaks of quota or credit, rate headers at 0), then
// stops cleanly. Once every asset
// is made it draws alternates (alternatesWhenComplete per asset, new seeds); when those are made too it makes no call.
// Loop (#661, npm run art:loop = --loop; the launcher starts it): repeats this run by itself, never needing --max. A pass
// ends at the first of: the day's share spent, the month's credits spent, the provider's refusal; the log line says when to
// check again ("check again <date time> (why)"). Then it sleeps (ART_RETRY_HOURS, default 4, or --retry-hours; the provider's
// retry-after if later; a spent share never past local midnight, when the new day's share opens and a pass runs at once; a spent
// month until the 1st) and runs again. The share carries: manifest allowance.carry spreads monthlyUsd over the month so a day
// that made nothing adds its share to the following days (never past monthlyUsd; --no-carry or ART_CARRY=0 for a flat share per
// day). With nothing left to make it sleeps until tomorrow or until the manifest changes. State for the launcher's `s`:
// logs/art-loop.json (--state, ART_STATE). Stops on "stop" on stdin, SIGINT or SIGTERM, after the image in hand.
// Caps: --max N images, ART_MAX_CALLS (or --max-calls) HTTP attempts a run (default 100).
// Model: the manifest's pinnedModel, else the one that answered before (assets/queue.json), else the candidates in
// order: a model or route that is refused (400/404/422, no supported provider) is recorded and the next is tried.
// Output: assets/incoming/<date>/<kind>/<tier>/<name>.png (+ index.json and sheet.html there) for review; npm run art:accept
// moves what you keep into assets/ and assets/index.json. State: assets/queue.json (gitignored). One line a run is
// appended to logs/art.log (date, made, calls, cost, model, stop reason, next), which the launcher's `s` shows.
// Provider (#703): by default the images are made on the owner's private ZeroGPU Space (scripts/art/space.mjs): $0, the PRO
// account's daily GPU quota (40 min, resets 24 h after its first use). A run counts GPU seconds in that window (assets/queue.json
// gpu) and stops at manifest allowance.zeroGpu.stopAtMinutes (ART_GPU_MINUTES overrides) before the quota could run into paid
// overage, or at the Space's quota refusal ("try again in H:MM:SS"): the loop then sleeps until exactly that reset. The credit
// share and ART_DAILY_BUDGET apply only to --provider router (Inference Providers, billed), which is never an automatic fallback.
// No paid option is ever sent (no bill-to header, no provider key); the token is HF_TOKEN from .env, never printed.
// Credits: Hugging Face gives free accounts no Inference Providers credits and PRO $2.00 a month (docs, 2026-11-03);
// a run spends at most the day's share of manifest allowance.monthlyUsd and stops for the month at the full amount.
// The provider's image is kept as it came under assets/incoming/<date>/raw/ before post-processing; an output with too
// few colours is rejected (logged, not written) and can be re-made offline with npm run art:reprocess.
import {writeFileSync,existsSync,mkdirSync,readFileSync,appendFileSync,statSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT,MANIFEST,ASSETS,loadManifest,loadIndex,sha256,validateManifest,loadQueue,saveQueue,keyFile,splitKey,TILE,TIERS,tierKey,nextCheck,WAIT_WHY} from './lib.mjs';
import {resolvePalette} from './post.mjs';
import {parseArgs,fetchRaw,saveRaw,processRaw,writeIndex,providerOf,PROVIDERS,routeOf,tokenFor} from './gen.mjs';
import {spaceOf,spaceDuration,ensureAwake,gpuWindow,windowEnd} from './space.mjs';

const VALUED=['max','max-calls','manifest','dir','log','date','timeout','budget','tier','retry-hours','state','provider'];
const pad=n=>String(n).padStart(2,'0');
const today=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const stamp=(d,date=today(d))=>`${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
// A day counts as done once a run ended for a reason that will not change before tomorrow.
const DONE=/stop: (allowance used|rate headers|ART_MAX_CALLS|manifest complete|daily share|monthly credits|ZeroGPU quota|GPU cap)/;
// Estimated credits spent on the given day (YYYY-MM-DD) or month (YYYY-MM), read back from art.log lines.
export function spentOn(text,prefix){let t=0;for(const l of String(text).split(/\r?\n/))if(l.startsWith(prefix)){const m=/(?:est\.|estimated|billed|mixed) \$([\d.]+)/.exec(l)||/~\$([\d.]+) of the free allowance/.exec(l);if(m)t+=Number(m[1])}return t}

// The work list at a tier: missing assets by priority, then alternates once everything exists. Keys are tier keys
// ('tile:grass@32', 'tile:grass@32#alt1'), so the 32 and 64 sets are made and reviewed apart.
export function jobsFor(man,idx,q,{retryFailed=false,tier=TILE}={}){
  const order=man.assets.map((e,i)=>[e,i]).sort((a,b)=>a[0].priority-b[0].priority||a[1]-b[1]).map(([e])=>e);
  const tooOften=k=>!retryFailed&&((q.failed[k]&&q.failed[k].tries)||0)>=3;
  // a failed or flat draw is not repeated with the same seed (the same seed gives the same image)
  const retry=k=>((q.failed[k]&&q.failed[k].tries)||0)*104729;
  const K=e=>tierKey(e.id,tier);
  const miss=order.filter(e=>!idx.assets[K(e)]&&!q.incoming[K(e)]&&!tooOften(K(e))).map(e=>({e,key:K(e),tier,seed:e.seed+(q.rejected[K(e)]||0)*7919+retry(K(e))}));
  if(miss.length)return miss;
  const N=man.alternatesWhenComplete||0,alts=[];
  for(let k=1;k<=N;k++)for(const e of order){if(!idx.assets[K(e)]&&!q.incoming[K(e)])continue;if((q.alts[K(e)]||0)>=k)continue;
    const key=tierKey(e.id,tier,k);if(q.incoming[key]||tooOften(key))continue;alts.push({e,key,tier,seed:e.seed+1000*k+retry(key),alt:k})}
  return alts}

export async function main(argv=process.argv.slice(2),env=process.env,ctx={}){
  const o=parseArgs(argv,VALUED),tier=o.tier?Number(o.tier):TILE;
  if(!TIERS.includes(tier)){console.error(`--tier: ${o.tier} is not one of ${TIERS.join(', ')}`);return 2}
  const mode=providerOf(o);if(!mode){console.error(`--provider: ${o.provider} is not one of ${PROVIDERS.join(', ')}`);return 2}
  const dir=o.dir||env.ART_ASSETS||ASSETS,logPath=o.log||env.ART_LOG||join(ROOT,'logs','art.log'),now=ctx.now?ctx.now():new Date(),date=o.date||today(now);
  const retryHours=Number(o['retry-hours']??env.ART_RETRY_HOURS)||4;let chk='';
  const man=loadManifest(o.manifest||MANIFEST),PAL=await import('../../src/render/palette.js');
  const log=line=>{mkdirSync(dirname(logPath),{recursive:true});appendFileSync(logPath,line+'\n');console.log('[art] '+line)};
  if(!o.now&&!o['dry-run']&&existsSync(logPath)){const last=readFileSync(logPath,'utf8').trim().split(/\r?\n/).filter(l=>l.startsWith(date)).pop();
    if(last&&DONE.test(last)){console.log(`[art] already ran today: ${last}\n[art] (--now runs again)`);return 0}}
  const bad=validateManifest(man,PAL,resolvePalette);if(bad.length){console.error('manifest problems:\n  '+bad.join('\n  '));return 2}
  const idx=loadIndex(dir),q=loadQueue(dir),jobs=jobsFor(man,idx,q,{retryFailed:!!o['retry-failed'],tier});
  const max=o.max!==undefined?Math.max(0,parseInt(o.max,10)||0):Infinity,maxCalls=Math.max(1,parseInt(o['max-calls']??env.ART_MAX_CALLS??'100',10)||100);
  const space=mode==='space',onSpace=k=>!!(man.models[k]&&spaceOf(man.models[k],env));q.spaceTried=q.spaceTried||{};
  const candidates=space?[...new Set([man.pinnedModel,...man.candidates].filter(k=>k&&onSpace(k)&&!(q.spaceTried[k]&&q.spaceTried[k].ok===false)))]
    :man.pinnedModel?[man.pinnedModel]:q.model.pinned?[q.model.pinned]:man.candidates.filter(k=>!(q.model.tried[k]&&q.model.tried[k].ok===false));
  // the ZeroGPU window (space): GPU seconds counted since the quota's last reset, and where this run stops
  const zg=(man.allowance&&man.allowance.zeroGpu)||{},quotaMin=zg.dailyMinutes||40,capMin=Number(env.ART_GPU_MINUTES)||zg.stopAtMinutes||36;let gw=gpuWindow(q,now),gpu=0;
  // Credits: the account's monthly Inference Providers credits (manifest allowance.monthlyUsd, $2.00 on PRO) are spread
  // over the month: a run stops at today's share (ART_DAILY_BUDGET or --budget overrides) and once the month's estimated
  // spend reaches the monthly amount, before the provider ever has to refuse (or bill) a call.
  const logText=existsSync(logPath)?readFileSync(logPath,'utf8'):'',monthly=(man.allowance&&man.allowance.monthlyUsd)||0;
  const dim=new Date(Number(date.slice(0,4)),Number(date.slice(5,7)),0).getDate(),spentToday=spentOn(logText,date),spentMonth=spentOn(logText,date.slice(0,7));
  const explicit=o.budget??(env.ART_DAILY_BUDGET||undefined),carry=!o['no-carry']&&env.ART_CARRY!=='0'&&!!(man.allowance&&man.allowance.carry)&&monthly>0;
  // carry: what the month has earned by the end of today (monthly x day / days) less what it spent before today
  const budget=Number(explicit??(carry?Math.max(0,monthly*Number(date.slice(8,10))/dim-(spentMonth-spentToday)):monthly/dim));
  let billedN=0,estN=0,billedUsd=0,lastCost=null;const basis=()=>billedN&&!estN?'billed':billedN?'mixed':'estimated',next$=m=>lastCost??m.costPerImage;
  const line=(made,rej,calls,cost,model,stop,next)=>space?`${stamp(now,date)} | made ${made} | rejected ${rej} | calls ${calls} | quota: ${gpu.toFixed(1)} s of GPU (${(gw.s/60).toFixed(1)} of ${quotaMin} min this window, stop at ${capMin}) | est. $0.000 | model ${model||'-'} · space | stop: ${stop} | next: ${next||'-'}${chk}`
    :`${stamp(now,date)} | made ${made} | rejected ${rej} | calls ${calls} | ${calls?basis():'estimated'} $${cost.toFixed(3)}${billedN&&estN?` (billed $${billedUsd.toFixed(3)})`:''} (month $${(spentMonth+cost).toFixed(3)} of $${monthly.toFixed(2)} credits) | model ${model||'-'} | stop: ${stop} | next: ${next||'-'}${chk}`;
  // when to look again: on the log line, and in ctx.result for the loop
  const setNext=(kind,stop,made=0,cost=0,retryAfter=0)=>{const n=nextCheck(kind,now,{retryHours,retryAfter,resetAt:kind==='gpu'?windowEnd(gw):null});chk=` | check again ${stamp(n,today(n))} (${WAIT_WHY[kind]||kind})`;
    ctx.result={kind,next:n,made,stop,spentToday:spentToday+cost,spentMonth:spentMonth+cost,monthly,budget,budgetFrom:explicit!==undefined?'ART_DAILY_BUDGET or --budget':carry?'the month\'s share, carried':'the month\'s share',at:now.toISOString(),...(space?{provider:'space',monthly:0,gpuMin:+(gw.s/60).toFixed(1),quotaMin,capMin,images:gw.images}:{})}};
  if(!jobs.length){setNext('complete','manifest complete');log(line(0,0,0,0,q.model.pinned||man.pinnedModel,'manifest complete, alternates too: no call',''));q.next=[];saveQueue(dir,q);return 0}
  console.log(`[art] tier ${tier}: ${jobs.length} to make (${jobs.filter(j=>j.alt).length?'alternates':'missing assets'}), first ${jobs.slice(0,5).map(j=>j.key).join(', ')}; caps: ${max===Infinity?'no --max':'--max '+max}, ${maxCalls} calls`);
  if(space)console.log(`[art] provider: the ZeroGPU Space (cost $0); GPU this window ${(gw.s/60).toFixed(1)} of ${quotaMin} min, this run stops at ${capMin} min${gw.start?' (window opened '+stamp(new Date(gw.start))+')':''}`);
  else console.log(`[art] credits: today's share $${budget.toFixed(3)}${carry&&explicit===undefined?' (carried forward)':''} (spent today ~$${spentToday.toFixed(3)}), month ~$${spentMonth.toFixed(3)} of $${monthly.toFixed(2)}`);
  console.log(`[art] model: ${man.pinnedModel?man.pinnedModel+' (pinned in the manifest)':q.model.pinned?q.model.pinned+' (answered before)':'try '+candidates.join(', ')}`);
  if(o['dry-run'])return 0;
  if(!candidates.length){setNext('error','no candidate model');log(line(0,0,0,0,null,'no candidate model left (every one was refused; edit the manifest or reset assets/queue.json model.tried)',jobs[0].key));return 2}
  const token=tokenFor(mode,env);if(!token){setNext('error','no HF_TOKEN');log(line(0,0,0,0,null,'no HF_TOKEN in .env',jobs[0].key));return 2}
  const inc=join(dir,'incoming',date),incIdx=loadIndex(inc),maps=new Map(),timeout=(Number(o.timeout)||120)*1000;
  let made=0,rej=0,calls=0,cost=0,stop='',kind='cap',ra=0,ci=0,inRow=0,i=0;const count=()=>calls++;
  for(;i<jobs.length;i++){const job=jobs[i],e=job.e;
    if(ctx.stopped&&ctx.stopped()){stop='stopped';kind='stop';break}
    if(made>=max){stop=`--max ${max} reached`;kind='error';break}
    if(calls>=maxCalls){stop=`ART_MAX_CALLS ${maxCalls} reached`;kind='cap';break}
    if(space){const m0=man.models[e.model||candidates[ci]||candidates[0]],need=spaceDuration(m0);
      if(gw.s+need>capMin*60){stop=`GPU cap reached (${(gw.s/60).toFixed(1)} of ${capMin} min counted; the quota resets ${stamp(windowEnd(gw)||now)})`;kind='gpu';break}}
    else{const next=next$(man.models[e.model||candidates[ci]||candidates[0]]);
      if(monthly&&spentMonth+cost+next>monthly+1e-9){stop=`monthly credits used ($${(spentMonth+cost).toFixed(3)} of $${monthly.toFixed(2)}, ${basis()})`;kind='month';break}
      if(spentToday+cost+next>budget+1e-9){stop=`daily share $${budget.toFixed(3)} used (${basis()}; spent today $${(spentToday+cost).toFixed(3)})`;kind='share';break}}
    let k,res=null;
    for(;;){k=e.model||candidates[ci];if(!k){stop='no candidate model answered';kind='error';break}
      const m=man.models[k];
      try{let mp=maps.get(k);if(!mp){mp=await routeOf(m,mode);maps.set(k,mp)}
        const first=mp.provider==='space'&&!maps.get('#awake');if(first){await ensureAwake(mp.space,token,{env});maps.set('#awake',true)} // a sleeping Space loads SDXL: 1-3 minutes
        const got=await fetchRaw({man,m,mp,e,token,seed:job.seed,timeout:first?Math.max(timeout,300000):timeout,count,tier,now:()=>now});
        if(mp.provider==='space'){gpu+=got.gpuS||0;gw={...gw,start:gw.start||now.toISOString(),s:gw.s+(got.gpuS||0),images:gw.images+1};q.gpu=gw;saveQueue(dir,q)} // the Space: $0, GPU seconds of the window
        else{const c=got.cost!=null?got.cost:m.costPerImage;cost+=c;lastCost=got.cost!=null?got.cost:null;if(got.cost!=null){billedN++;billedUsd+=c}else estN++; // refused calls draw nothing; the answer's own cost wins over the manifest guess
        if(!q.costProbe){q.costProbe={at:now.toISOString(),billed:got.cost!=null,from:got.costFrom||'',...got.probe};console.log(`[art] what the provider's answer says about cost: ${got.cost!=null?'$'+got.cost+' ('+got.costFrom+')':'nothing usable, so the manifest estimate is used'}; headers ${JSON.stringify(got.probe.headers)}, body keys ${got.probe.bodyKeys.join(',')||'-'}`)}}
        // keep the provider's image before anything else, so post-processing can be re-run offline (art:reprocess)
        saveRaw(inc,job.key,got.bytes,{id:e.id,tier,kind:e.kind,model:k,repo:m.repo,provider:mp.provider,seed:job.seed,...(job.alt?{alt:job.alt}:{})});
        try{res={...processRaw(got.bytes,e,PAL,m,tier,man),last:got.last,mp}}catch(err){res={err,last:got.last}}break}
      catch(err){
        if(space&&err.kind==='model'&&!e.model){q.spaceTried[k]={ok:false,why:err.message.slice(0,160),at:now.toISOString()};console.log(`[art] the Space refused ${k}: ${err.message.slice(0,160)}; trying the next`);ci++;saveQueue(dir,q);continue}
        if(err.kind==='model'&&!e.model&&!man.pinnedModel&&!q.model.pinned){q.model.tried[k]={ok:false,why:err.message.slice(0,160),at:now.toISOString()};console.log(`[art] model ${k} refused: ${err.message.slice(0,160)}; trying the next`);ci++;saveQueue(dir,q);continue}
        res={err};break}}
    if(stop)break;
    if(res.err){const err=res.err;
      if(err.kind==='gpu'){stop=err.message.slice(0,200);kind='gpu';gw={...gw,start:gw.start||now.toISOString(),resetAt:(err.resetAt||new Date(now.getTime()+24*3600e3)).toISOString()};q.gpu=gw;saveQueue(dir,q);break}
      if(err.kind==='space'){stop=err.message.slice(0,240);kind='error';break}
      if(['quota','auth','rate'].includes(err.kind)){stop=err.message.slice(0,200);kind=err.kind==='auth'?'error':'provider';ra=err.retryAfter||0;break}
      const f=q.failed[job.key]||{tries:0};q.failed[job.key]={tries:f.tries+1,why:err.message.slice(0,200),at:now.toISOString()};saveQueue(dir,q);
      {const st=q.stats[e.kind]=q.stats[e.kind]||{made:0,flat:0,failed:0};st[err.kind==='flat'?'flat':'failed']++}
      if(err.kind==='flat')rej++;console.log(`[art] ${job.key} ${err.kind==='flat'?'rejected':'failed'}: ${err.message.slice(0,200)}${err.notes?' (grid '+err.notes.grid+', native '+err.notes.native+')':''}${err.kind==='flat'?'; raw kept for npm run art:reprocess':''}`);
      if(res.last){stop='rate headers: allowance used';kind='provider';i++;break}
      if(++inRow>=3){stop=`3 failures in a row (${err.message.slice(0,120)})`;kind='error';break}continue}
    inRow=0;
    if(space){if(!q.spaceTried[k]||!q.spaceTried[k].ok){q.spaceTried[k]={ok:true,at:now.toISOString()};saveQueue(dir,q)}}
    else if(!e.model&&!q.model.pinned&&!man.pinnedModel){q.model.pinned=k;q.model.tried[k]={ok:true,at:now.toISOString()};console.log(`[art] model ${k} (${man.models[k].repo}) answered: pinned in assets/queue.json (copy it to the manifest's pinnedModel)`)}
    const file=keyFile(job.key),p=join(inc,file);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,res.png);
    incIdx.assets[job.key]={id:e.id,tier,kind:e.kind,file,w:res.img.w,h:res.img.h,colors:res.img.notes.colors,grid:res.img.notes.grid,sha256:sha256(res.png),model:k,repo:man.models[k].repo,provider:res.mp.provider,seed:job.seed,at:new Date().toISOString(),...(job.alt?{alt:job.alt}:{})};
    writeIndex(inc,incIdx);q.incoming[job.key]={date,file};if(job.alt){const b=tierKey(e.id,tier);q.alts[b]=Math.max(q.alts[b]||0,job.alt)}delete q.failed[job.key];saveQueue(dir,q);
    {const st=q.stats[e.kind]=q.stats[e.kind]||{made:0,flat:0,failed:0};st.made++}
    made++;console.log(`[art] ${job.key} -> assets/incoming/${date}/${file} (${res.img.notes.colors} colours, grid ${res.img.notes.grid}, native ${res.img.notes.native})`);
    if(res.last){stop='rate headers: allowance used';kind='provider';i++;break}}
  if(!stop)stop=i>=jobs.length?'all done for now':'stopped';
  setNext(kind,stop,made,cost,ra);
  const left=jobsFor(man,loadIndex(dir),q,{tier});q.next=left.slice(0,10).map(j=>j.key);q.lastRun={date,made,calls,stop};saveQueue(dir,q);
  if(made||rej){const r=spawnSync(process.execPath,[join(ROOT,'scripts','art','sheet.mjs'),'--assets',inc,'--out',join(inc,'sheet.html'),'--generated','--tier',String(tier)],{encoding:'utf8'});
    if(r.status===0)console.log(`[art] review: ${join(inc,'sheet.html')}\n[art] keep: npm run art:accept -- <ids> (or all); drop: npm run art:accept -- --reject <ids>`);else console.log('[art] sheet failed: '+(r.stderr||'').slice(0,200))}
  log(line(made,rej,calls,cost,space?candidates[ci]||candidates[0]:q.model.pinned||man.pinnedModel||candidates[ci],stop,q.next[0]));
  return /HTTP 401|HTTP 403 token|no candidate|cannot (read|use) the Space/.test(stop)?2:0}

// The loop (#661). Injected clock, sleep and stop flag let artcheck run days in a moment.
export async function runLoop(argv,env=process.env,{now=()=>new Date(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),stopped=()=>false,maxPasses=Infinity}={}){
  const o=parseArgs(argv,VALUED),rest=argv.filter(a=>a!=='--loop'),statePath=o.state||env.ART_STATE||join(ROOT,'logs','art-loop.json'),manifest=o.manifest||MANIFEST;
  const retryMs=(Number(o['retry-hours']??env.ART_RETRY_HOURS)||4)*3600e3,mtime=()=>{try{return statSync(manifest).mtimeMs}catch{return 0}};
  let last=null,passes=0,said='';
  const save=s=>{try{mkdirSync(dirname(statePath),{recursive:true});writeFileSync(statePath,JSON.stringify({pid:process.pid,...s},null,1)+'\n')}catch{}};
  console.log(`[art] loop: runs until the day's share, the month's credits or the provider's limit, waits, checks again by itself (stop: q in the launcher, Ctrl+C)`);
  while(!stopped()&&passes<maxPasses){
    passes++;save({state:'running',since:now().toISOString(),last});
    const ctx={now,stopped};
    try{await main([...rest,'--now','--date',today(now())],env,ctx)}catch(e){console.log('[art] pass failed: '+(e&&e.message||e))}
    const r=ctx.result||{kind:'error',next:new Date(now().getTime()+retryMs),stop:'the pass failed'};
    last={at:r.at||now().toISOString(),made:r.made||0,stop:r.stop||'',spentToday:r.spentToday,spentMonth:r.spentMonth,monthly:r.monthly,budget:r.budget,budgetFrom:r.budgetFrom,...(r.provider==='space'?{provider:'space',gpuMin:r.gpuMin,quotaMin:r.quotaMin,capMin:r.capMin,images:r.images}:{})};
    if(r.kind==='stop')break;
    const m0=mtime();
    if(r.kind==='complete'&&said!=='complete')console.log('[art] nothing left to make: sleeping until the manifest changes or tomorrow');
    said=r.kind;
    save({state:'waiting',next:r.next.toISOString(),nextAt:stamp(r.next),why:WAIT_WHY[r.kind]||r.kind,last});
    while(!stopped()&&now()<r.next){await sleep(Math.min(30000,r.next-now()));if(r.kind==='complete'&&mtime()!==m0){console.log('[art] the manifest changed: running again');break}}
  }
  save({state:'stopped',last});console.log('[art] loop stopped');return 0}

if(/daily\.mjs$/.test(process.argv[1]||'')){
  const argv=process.argv.slice(2);
  if(argv.includes('--loop')){let stop=false,wake=()=>{};const halt=()=>{stop=true;wake()};
    process.on('SIGINT',halt);process.on('SIGTERM',halt);
    process.stdin.setEncoding('utf8');process.stdin.on('data',d=>{if(/stop|quit/i.test(String(d)))halt()});process.stdin.on('error',()=>{});process.stdin.resume();
    runLoop(argv,process.env,{stopped:()=>stop,sleep:ms=>new Promise(r=>{const t=setTimeout(r,ms);wake=()=>{clearTimeout(t);r()}})}).then(c=>process.exit(c),e=>{console.error(e);process.exit(1)})}
  else main().then(c=>process.exit(c),e=>{console.error(e);process.exit(1)})}
