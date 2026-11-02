// The DM's campaign seed (owner request): a starting point written per world in docs/campaigns/<world>.md,
// turned into the DM's notes once, when a world's DM state is created (or on load, if the notes are empty).
// The sim stays fs-free: the host hands the text over (provideCampaigns), the browser from a Vite ?raw import
// (src/main.js), Node hosts from disk (scripts/campaign-files.mjs). No RNG, so a seed is deterministic.
// The file: H2 sections Premise, Threads, Characters, Plans, Secrets, each with bullets "- **Title**: text"
// (title <= 60, text <= 550, optionally ending in "tags: a, b"). Premise becomes pinned notes in plans.
import {WORLD_ID} from '../world/spec.js';

export const CAMP={TITLE:60,TEXT:550,SECTIONS:['threads','characters','plans','secrets']};
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,n);

function bullets(lines){const out=[];let cur=null;
  for(const raw of lines){const ln=raw.replace(/\s+$/,'');
    const m=/^\s*[-*]\s+\*\*(.+?)\*\*\s*[:–—-]?\s*(.*)$/.exec(ln);
    if(m){cur={title:m[1],text:m[2]};out.push(cur)}
    else if(/^\s*[-*]\s+/.test(ln)){cur=null}
    else if(cur&&ln.trim()&&/^\s+\S/.test(ln))cur.text+=' '+ln.trim()
    else if(!ln.trim())cur=cur&&null}
  return out}
function note(b){let text=String(b.text||''),tags=[];
  const t=/(?:^|\s)tags:\s*([^\n]*?)\s*$/i.exec(text);
  if(t){tags=t[1].split(/[,;]/).map(x=>clean(x,24)).filter(Boolean).slice(0,6);text=text.slice(0,t.index)}
  text=clean(text,CAMP.TEXT);const title=clean(b.title,CAMP.TITLE);
  return text&&title?{title,text,tags}:null}

// parseCampaign(md) -> {threads, characters, plans, secrets}: lists of {title, text, tags[], pin?}. Pure and tolerant:
// unknown sections and stray lines are ignored, long text is cut.
export function parseCampaign(md){
  const out={threads:[],characters:[],plans:[],secrets:[]},prem=[];
  const secs={};let cur=null;
  for(const ln of String(md||'').replace(/\r/g,'').split('\n')){
    const h=/^##\s+(.+?)\s*#*\s*$/.exec(ln);
    if(h){cur=h[1].trim().toLowerCase();(secs[cur]=secs[cur]||[]);continue}
    if(/^#\s/.test(ln)){cur=null;continue}
    if(cur)secs[cur].push(ln)}
  for(const k of ['premise',...CAMP.SECTIONS]){const L=secs[k];if(!L)continue;
    let bs=bullets(L);
    if(!bs.length&&k==='premise'){const p=L.join(' ').replace(/\s+/g,' ').trim();if(p)bs=[{title:'Premise',text:p}]}
    for(const b of bs){const n=note(b);if(!n)continue;if(k==='premise')prem.push({...n,pin:true});else out[k].push(n)}}
  out.plans=[...prem,...out.plans];
  return out}

// ---- the text a host provides, by world id ----
let TEXTS={};
export function provideCampaigns(map){TEXTS={...(map||{})}}
export const campaignText=(world=WORLD_ID)=>{const t=TEXTS[world];return typeof t==='string'&&t.trim()?t:''};
// 'docs/campaigns/eldmoor.md' -> 'eldmoor' (for Vite's import.meta.glob keys)
export const campaignIdOf=p=>String(p).replace(/^.*[\/]/,'').replace(/\.md$/i,'');
