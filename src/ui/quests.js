// The dossier Quests tab (owner request): every quest a hero carries in three groups - Quests (the town board
// and the generic hunt), From the DM, Oaths - with the focused one pinned on top and finished ones folded below.
// Reads sim.questLog(a) when the sim exports it; until then derives a best-effort log from today's state
// (a.quest, a.goal, the DM hook the hero is on). The sim never imports this.
import * as sim from '../sim/index.js';
import {S} from '../sim/index.js';
import {MOBS} from '../data/mobs.js';
import {ADVENTURES} from '../data/adventures.js';
import {ZONES} from '../world/map.js';

const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
export const KINDS=[['board','Quests'],['dm','From the DM'],['oath','Oaths']];
const BADGE={board:'QUEST',dm:'DM',oath:'OATH'};
const STATUS={active:'Active',held:'On hold',done:'Done',failed:'Failed',abandoned:'Abandoned',expired:'Expired'};
const zname=z=>z!=null&&ZONES[z]?String(ZONES[z].name||ZONES[z]):'';

// ---- adapter: questLog when the sim has it, else today's state ----
function derive(a){const active=[];
  if(a.quest){const M=MOBS[a.quest.type]||{};
    active.push({id:'board-'+a.quest.type,kind:'board',title:M.q||'A hunt',giver:'Town board',where:zname(M.z),
      objective:'Slay '+a.quest.need+' '+(M.pl||'creatures'),progress:{have:a.quest.have||0,need:a.quest.need},reward:'Gold and experience',status:'active',focus:false,started:null,ends:null,from:'scripted'})}
  if(a.goal&&!a.goal.done&&!a.goal.offered)active.push({id:'oath-'+a.goal.type,kind:'oath',title:a.goal.text,giver:'Own oath',where:'',objective:'',
    progress:a.goal.need?{have:a.goal.progress||0,need:a.goal.need}:null,reward:'',status:'active',focus:false,started:null,ends:null,from:'self'});
  const adv=a.adv!=null&&S.adventures?S.adventures.find(h=>h.id===a.adv&&h.phase==='active'):null;
  if(adv){const T=ADVENTURES[adv.tpl]||{};
    active.push({id:'dm-'+adv.id,kind:'dm',title:(T.name||adv.tpl)+(adv.data&&adv.data.thing?': '+adv.data.thing:''),giver:adv.giver?adv.giver.name:adv.town||'',
      where:zname(adv.zone)||adv.town||'',objective:'',progress:null,reward:'Gold, experience and honor',
      status:'active',focus:false,started:adv.born==null?null:adv.born,ends:adv.until==null?null:adv.until,from:adv.by==='dm-agent'?'agent':'scripted'})}
  if(active.length)active[0].focus=true;
  return {active,done:[],focus:active.length?active[0].id:null}}
export function logOf(a){let L=null;try{const f=globalThis.__questLog||sim.questLog;if(typeof f==='function')L=f(a)}catch(e){L=null}
  if(!L)L=derive(a);
  return {active:(L.active||[]).filter(q=>q&&q.id!=null),done:(L.done||[]).slice(),focus:L.focus==null?null:L.focus}}

// "2d 4h left", "5h left", "time is up"
export function timeLeft(ends,now=S.gameMin){if(ends==null)return '';const m=ends-now;if(m<=0)return 'time is up';const d=Math.floor(m/1440),h=Math.floor(m%1440/60);
  return (d?d+'d':'')+(d&&h?' ':'')+(h||!d?h+'h':'')+' left'}
const fromText=f=>f==='agent'||f==='dm-agent'?'from the DM agent':f==='scripted'?'from the scripted DM':'';

function row(q,focus){const r=el('div','qrow q-'+q.kind+(focus?' qfocus':'')+(q.status&&q.status!=='active'?' q-'+q.status:''));r.setAttribute('data-k','q'+q.id);
  const top=el('div','qtop');if(focus)top.append(el('span','qplay','▶'));
  top.append(el('span','qbadge qb-'+q.kind,BADGE[q.kind]||q.kind),el('span','qtitle',q.title||'Untitled'));
  if(q.status&&q.status!=='active')top.append(el('span','qstat qs-'+q.status,STATUS[q.status]||q.status));
  r.append(top);
  const meta=[q.giver&&'Given by '+q.giver,q.where&&'At '+q.where].filter(Boolean).join(' · ');if(meta)r.append(el('div','qmeta',meta));
  if(q.objective&&q.objective!==q.title)r.append(el('div','qobj',q.objective));
  if(q.progress&&q.progress.need){const p=q.progress,f=Math.max(0,Math.min(1,p.have/p.need)),m=el('div','meter qm'),i=el('i');i.style.width=(f*100).toFixed(0)+'%';m.append(i);
    r.append(m,el('div','qmeta',p.have+' / '+p.need))}
  const foot=[q.reward&&'Reward: '+q.reward,!q.status||q.status==='active'?timeLeft(q.ends):'',q.kind==='dm'?fromText(q.from):''].filter(Boolean).join(' · ');
  if(foot)r.append(el('div','qmeta qfoot',foot));
  return r}

export function tabQuests(b,a){const L=logOf(a);b.classList.add('qlog');
  if(!L.active.length&&!L.done.length){b.append(el('div','meta','No quests yet.'));return}
  const foc=L.active.find(q=>q.focus||q.id===L.focus);
  if(foc){const g=el('div','qgroup');g.setAttribute('data-k','g-focus');g.append(el('div','qhead','Focus'),row(foc,true));b.append(g)}
  for(const [k,label] of KINDS){const qs=L.active.filter(q=>q.kind===k&&q!==foc);if(!qs.length)continue;
    const g=el('div','qgroup');g.setAttribute('data-k','g-'+k);g.append(el('div','qhead qh-'+k,label+' ('+qs.length+')'));for(const q of qs)g.append(row(q,false));b.append(g)}
  if(L.done.length){const d=el('details','qdone');d.setAttribute('data-k','g-done');d.append(el('summary',null,'Done ('+L.done.length+')'));for(const q of L.done)d.append(row(q,false));b.append(d)}}
