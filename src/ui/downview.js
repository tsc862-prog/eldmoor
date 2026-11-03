// The downed, as the watcher sees them (#659, epic #626). One read of a downed hero for the party frames, the dossier
// header, the purpose line, the sheet and the Table banner: who lies at zero HP, their death-save tally (successes of 3,
// failures of 3, or 4 while a healer of theirs stands near), when the next save comes or when a stable hero wakes, who
// is coming to help, and the last change to the tally as it happened (SAVED, FAILED, STRUCK, STABLE, UP, DIED), held for
// a few real seconds so the owner sees each save land.
// The sim keeps only the tally (a.down: s, f, stable, next, wake, by; sim/downed.js); no die value is stored for a save
// in the world, so the flash names what changed. At a Table scene (#654) the saves are beats with their dice
// (check.kind 'death'); the banner shows those (ui/table.js). Reads only.
import {S} from '../sim/index.js';
import {MOBS} from '../data/mobs.js';
import {DOWN,isDown,failsOf} from '../sim/downed.js';
import {sceneOf} from '../sim/scenes.js';

const SAVE_KINDS={elite:1,ambush:1,boss:1,rescue:1,crawl:1};
// The scene rolls their saves a round at a time (#654): a combat scene in rounds, a crawl room, or the crawl's own flag.
const atTable=a=>{const d=a.down;if(d&&d.crawl)return true;const sc=sceneOf(a);return !!sc&&!!SAVE_KINDS[sc.kind]&&(sc.kind==='crawl'||sc.rd!=null)};
const byId=id=>S.agents.find(x=>x.id===id)||null;
const mins=m=>{m=Math.max(0,Math.ceil(m));return m<60?m+' min':Math.floor(m/60)+' h'+(m%60?' '+m%60+' min':'')};
// What put them down, in words.
export function downBy(a){const b=a&&a.down&&a.down.by;if(!b)return '';
  if(b.kind==='boss')return 'Kragmaw';if(b.kind==='hero')return b.name||'a hero';
  const M=b.type&&MOBS[b.type];return b.name||(M?'a '+M.name:'')}
// The one who came to help (sim/downed.js 'aid' state), or null.
export const helperOf=a=>a?S.agents.find(b=>b.aid===a.id&&b.state==='aid')||null:null;

// ---- the last change to each downed hero's tally (UI memory, never saved) ----
const FLASH_MS=4000;
const seen=new Map(); // id -> {s, f, stable, next, down, word, tone, at}
const nowMs=()=>Date.now();
// Called on every fast tick (ui/app.js uiFast, before the frames): compare each tally with the last one seen.
export function trackDowned(){const t=nowMs();
  for(const a of S.agents){const d=isDown(a)?a.down:null,p=seen.get(a.id);
    if(!d){if(p&&p.down){const dead=a.state==='dead';seen.set(a.id,{down:false,word:dead?'DIED':'UP',tone:dead?'bad':'good',at:t})}
      else if(p&&t-p.at>FLASH_MS)seen.delete(a.id);continue}
    if(!p||!p.down){seen.set(a.id,{s:d.s,f:d.f,stable:!!d.stable,next:d.next,down:true,word:'DOWN',tone:'bad',at:t});continue}
    let word=null,tone='';
    if(d.stable&&!p.stable){word='STABLE';tone='calm'}
    else if(!d.stable&&p.stable){word='STRUCK';tone='bad'}
    else if(d.f>p.f){const n=d.f-p.f,save=d.next!==p.next;word=(save?'FAILED':'STRUCK')+(n>1?' x'+n:'');tone='bad'} // a save moves the clock on; a blow on the downed does not
    else if(d.s>p.s){word='SAVED';tone='good'}
    if(word){p.word=word;p.tone=tone;p.at=t}
    p.s=d.s;p.f=d.f;p.stable=!!d.stable;p.next=d.next}}
// The flash for a hero, or null once it has faded: {word, tone}.
export function flashOf(a){const p=a&&seen.get(a.id);return p&&p.word&&nowMs()-p.at<=FLASH_MS?{word:p.word,tone:p.tone}:null}

// ---- the view ----
// null unless downed: {stable, s, of3, f, of, next, wake, table, timer, by, help, helpNear}
export function downView(a){if(!isDown(a))return null;const d=a.down||{s:0,f:0};
  const table=atTable(a),stable=!!d.stable,h=helperOf(a);
  const next=!stable&&!table&&d.next!=null?Math.max(0,d.next-S.gameMin):null,wake=stable&&!table&&d.wake?Math.max(0,d.wake-S.gameMin):null;
  const timer=table?(stable?'stable at the table':'saves each round'):stable?(wake!=null?'wakes in '+mins(wake):'stable'):next!=null?'save in '+mins(next):'';
  return {stable,s:d.s||0,of3:DOWN.SAVES,f:d.f||0,of:failsOf(a),next,wake,table,timer,by:downBy(a),
    help:h?h.name:'',helpNear:!!h&&Math.hypot(h.x-a.x,h.y-a.y)<=DOWN.HEAL_RANGE}}
// Filled and empty circles: pips(2,3) -> '●●○'.
export const pips=(n,of)=>'●'.repeat(Math.max(0,Math.min(n,of)))+'○'.repeat(Math.max(0,of-n));
// One line of plain text (the smoke, aria labels, tooltips).
export function downText(a){const v=downView(a);if(!v)return '';
  return (v.stable?'STABLE':'DOWNED')+' · saved '+v.s+'/'+v.of3+' · failed '+v.f+'/'+v.of+(v.timer?' · '+v.timer:'')}
export const downTitle=v=>v.stable?'Stable: the bleeding has stopped. They wake on 1 HP, or at once when healed; a blow starts the bleeding again.'
  :'Downed at zero HP. A death save every '+DOWN.TICK+' game minutes away from a table (each round at one): d20, '+DOWN.DC+'+ a success, a 1 two failures, a 20 up on 1 HP. '
  +v.of3+' successes: stable. '+v.of+' failures: dead'+(v.of>DOWN.SAVES?' (a healer of theirs stands near: one more)':'')+'. A blow while down is a failure.';

// The purpose line for the downed and for the one tending them (ui/purposeview.js): {kind, goal, target, why, line} or null.
export function downPurpose(a){if(!a)return null;
  if(isDown(a)){const v=downView(a),goal=v.stable?'Lying stable':'Bleeding out',why=v.help?(v.helpNear?v.help+' at their side':v.help+' is coming'):v.stable?'':'no one coming';
    return {kind:'down',goal,target:v.by?'downed by '+v.by:'',why,line:goal+(v.by?' → downed by '+v.by:'')+(why?' · '+why:''),to:null,path:[],tether:null,wait:null}}
  if(a.state==='aid'){const t=byId(a.aid);if(!t)return null;const goal='Tending '+t.name,why=t.down&&t.down.stable?'keeping watch until they wake':'who lies dying';
    return {kind:'aid',goal,target:'',why,line:goal+' · '+why,to:{x:t.x,y:t.y,label:t.name,mark:'person'},path:[],tether:null,wait:null}}
  return null}

// ---- the words in the logs (#659) ----
// A hero's Log line, a chronicle line or a timeline entry about the downed, by its words (sim/downed.js record and log):
// 'down' (went down, bled out), 'stable', 'up' (brought back, rose, woke), 'aid' (a helper's act), and, once PvP sparing
// lands (#657), 'mercy' and 'finish'. null for every other line.
const KINDS=[['down',/^Went down at level|^Bled out with no one near| is down, bleeding/],['stable',/^Was stabilized by/],
  ['up',/^Was brought back from the brink|^Rose from the brink|^Woke from the dark/],['aid',/ where they lay\.?$|, who lay dying\.?$/],
  ['mercy',/\bspared\b|\bmercy\b/i],['finish',/\bfinish(ed|es|ing)? (off|them|him|her)\b|\bfinishing blow\b/i]];
export function downKind(text){text=String(text||'');for(const [k,re] of KINDS)if(re.test(text))return k;return null}
export const DOWN_BADGE={down:'DOWN',stable:'STABLE',up:'UP',aid:'AID',mercy:'MERCY',finish:'FINISH'};
// The timeline's share (ui/timeline.js): the downed hero's own lines, for company members and heroes of level 10 and up
// (the chronicle's threshold), from each hero's Log. Entries keep their Log object for a stable row key.
const TL_KINDS={down:1,stable:1,up:1,mercy:1,finish:1};
const lc=s=>s.charAt(0).toLowerCase()+s.slice(1);
const cache=new WeakMap(); // hero -> {n, last, out}
export function downTimeline(){const out=[];
  for(const a of S.agents){if(!(a.company!=null||a.lvl>=10))continue;const h=a.history;if(!h||!h.length)continue;
    let c=cache.get(a);if(!c||c.n!==h.length||c.last!==h[h.length-1]){c={n:h.length,last:h[h.length-1],out:[]};
      // newest first, so lines of one game minute keep their order
      for(let i=h.length-1;i>=0;i--){const e=h[i],k=downKind(e.text);if(!k||!TL_KINDS[k]||/^Bled out/.test(e.text))continue; // bleeding out alone is the death line's
        const [hh,mm]=String(e.t||'0:0').split(':').map(Number),ps=(e.parts||[e.text]).slice();
        if(typeof ps[0]==='string')ps[0]=' '+lc(ps[0]);else ps.unshift(' ');
        c.out.push({src:e,t:e.t,gameMin:((e.d||1)-1)*1440+(hh||0)*60+(mm||0),kind:k,parts:[a,...ps]})}
      cache.set(a,c)}
    out.push(...c.out)}
  return out.sort((x,y)=>y.gameMin-x.gameMin)}
