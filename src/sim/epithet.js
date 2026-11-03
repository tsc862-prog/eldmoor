// A name given to a hero after a deed (issue #638): "Fena Wightbane", "Orren of the Ford", "Kas the Twice-Fallen". Flavour
// only, no numbers: the DM agent's bestow tool pulls the lever below (same caps, Fellowship reserve and DM log as every lever).
// A townsperson or a placed person within BESTOW.EAR tiles proclaims it aloud (by), else the narrator; the hero hears it, it goes
// to the chronicle and the timeline, the hero's own log (a landmark, sim/tiers.js) and a reflection moment. One at a time: a new
// one replaces the old, which stays in a.epithet.hist. Shown wherever the hero's name is (styled): look, inspect, the hero card,
// the party frame, chronicle and timeline lines, the Table banner and the DM's member views.
// The hero may refuse it in its own words: a line said aloud (say, party_say, attempt, a table line) that names the title and
// refuses it marks it refused; it is no longer shown, and bestow refuses any further name for that hero. The why is the lever's
// reason: the DM log only, never a hero.
//
// State on the hero (saved with it; created by a bestowal only, so a world without one is unchanged):
//   a.epithet {t, day, gm, by (who proclaimed it, as heard), refused?:{day, text}, hist:[{t, day, by, refused?}]}
// DOM-free, no RNG. Owned by brain-builder.
import {S,dayNo,clockStr} from './state.js';
import {dist} from '../world/map.js';
import {PROCLAIM_LINES} from '../data/renown-lines.js';
import {register,LEVERS} from './levers.js';
import {log} from './chronicle.js';
import {timeline,record} from './history.js';
import {notify} from './notify.js';
import {moment} from './reflect.js';
import {dmlog} from './dmlog.js';
import {notEnglish} from './lang.js';
import {ensureNpcs} from './npcs.js';
import {HEAR,CAP as CHAT_CAP,BUBBLE} from './chat.js';

export const BESTOW={
  PER_DAY:2,    // names given a game day
  GAP_DAYS:3,   // game days before the DM may name the same hero again
  MIN:2, MAX:24,// characters of a name
  EAR:7,        // tiles: the proclaimer stands this close to the hero
  HIST:8,       // older names kept
};
const DAY=1440;
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const full=p=>(p.title&&!p.wander?p.title+' ':'')+p.name;
const hashN=s=>{let h=0;s=String(s);for(let i=0;i<s.length;i++)h=(Math.imul(h,31)+s.charCodeAt(i))|0;return Math.abs(h)};
const NARRATOR={kind:'dm',name:'The Narrator'};
const living=a=>a&&a.kind==='hero'&&a.state!=='dead';
const heroBy=id=>S.agents.find(x=>x.id===id)||null;
const personBy=id=>{ensureNpcs();return (S.npcs||[]).find(x=>x.id===id)||(S.wanderers||[]).find(x=>x.id===id)||null};

// The name as the world says it: "Fena Wightbane" (a refused name is not shown).
export const titleOf=a=>a&&a.epithet&&!a.epithet.refused?a.epithet.t:null;
export const styled=a=>{if(!a)return '';const t=titleOf(a);return t?a.name+' '+t:a.name};

// Words a name may not hold: a number or a level word (flavour only, no numbers).
const NUMW=/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|thousand|first|second|third|fourth|fifth|tenth)\b/i;
const LVLW=/\b(levels?|lvl|lv|xp|exp|experience|ranks?|ranked|tiers?|max(ed)?|stats?|hp|gear\s*score|ilvl)\b/i;
export function titleRefusal(t){if(t.length<BESTOW.MIN||t.length>BESTOW.MAX)return 'title must be '+BESTOW.MIN+'-'+BESTOW.MAX+' characters (it is '+t.length+')';
  if(notEnglish(t))return 'title must be in English';
  if(/\d/.test(t)||NUMW.test(t)||/\b[IVXLC]{2,}\b/.test(t))return 'title must not be a number';
  if(LVLW.test(t))return 'title must not be a level word: a name for a deed, not a number';
  if(!/[a-z]/i.test(t))return 'title must be words';
  return null}

// Registered by installBestowLever (sim/index.js, after every module has loaded: the sim's imports are one big cycle).
const BESTOW_LEVER={name:'bestow',about:'Give a hero a name for a deed ("Wightbane", "of the Ford", "the Twice-Fallen"; '+BESTOW.MIN+'-'+BESTOW.MAX+' characters, flavour only): by, a person within '+BESTOW.EAR+' tiles, proclaims it aloud, else the narrator. One at a time (a new one replaces the old); not again for '+BESTOW.GAP_DAYS+' game days; never to a hero who refused one.',
  params:{hero:{type:'id'},title:{type:'str',max:60},by:{type:'id',opt:true}},limits:{perDay:BESTOW.PER_DAY},cooldown:0,
  check(p){const a=heroBy(p.hero);if(!living(a))return 'no such living hero';const t=clean(p.title,60);const e=titleRefusal(t);if(e)return e;
    const E=a.epithet;if(E&&E.refused)return a.name+' refused the name '+E.t+' in their own words: bestow nothing further on them';
    if(E&&S.gameMin-E.gm<BESTOW.GAP_DAYS*DAY)return a.name+' was named '+E.t+' '+Math.max(1,Math.round((S.gameMin-E.gm)/60))+' game hours ago; a new name only after '+BESTOW.GAP_DAYS+' game days';
    if(E&&E.t.toLowerCase()===t.toLowerCase())return a.name+' already bears that name';
    if(p.by!=null){const q=personBy(p.by);if(!q)return 'no such person (by)';if(!Number.isFinite(q.x)||dist(q,a)>BESTOW.EAR)return (q.name||'they')+' is not within '+BESTOW.EAR+' tiles of '+a.name+' (earshot)'}
    return null},
  apply(p){const a=heroBy(p.hero),t=clean(p.title,BESTOW.MAX),q=p.by!=null?personBy(p.by):null,who=q?full(q):'the narrator',E=a.epithet;
    const hist=E?[{t:E.t,day:E.day,by:E.by,...(E.refused?{refused:1}:{})},...(E.hist||[])].slice(0,BESTOW.HIST):[];
    a.epithet={t,day:dayNo(),gm:Math.round(S.gameMin),by:who,hist};
    // proclaimed aloud: the person to those in earshot of them (and the hero), else the narrator to those near the hero
    const L=PROCLAIM_LINES[q?'person':'narrator'],line=L[hashN(a.id+':'+t)%L.length].replace('{name}',a.name).replace('{title}',t);
    const e={t:clockStr(),d:dayNo(),from:q?{kind:'npc',id:q.id,name:q.name,fac:q.fac}:NARRATOR,text:line,trigger:q?'npc':'dm',dm:true};
    const at=q||a,hs=S.agents.filter(b=>living(b)&&!b.hidden&&(b===a||dist(b,at)<=HEAR));
    for(const b of hs){(b.chat||(b.chat=[])).push(e);if(b.chat.length>CHAT_CAP)b.chat.shift()}
    if(q){q.bubble={text:line,life:BUBBLE};q.chatCd=Math.max(q.chatCd||0,10)}
    notify(a,(q?who+' proclaims':'The narrator says')+': "'+line+'"',1,2);
    record(a,'Named '+t+' by '+who+'.');
    log(a,' is named ',{t,c:'gd'},' by '+who+'.');timeline('title',a,' is named ',{t,c:'gd'},' by '+who+'.');
    moment(a,'title',t+', from '+who);
    return {ok:true,effect:{hero:a.name,title:t,known_as:a.name+' '+t,by:who,heard_by:hs.length,...(E?{replaces:E.t}:{})}}},
  describe:p=>'a name for hero #'+p.hero};
export function installBestowLever(){if(!LEVERS.bestow)register(BESTOW_LEVER)}

// A line the hero said aloud: one that names its title and refuses it marks it refused (sim/talk.js noteSaid, sim/ruling.js attempt).
const NO=/\b(refuse|reject|decline|disown|spurn|not my name|no name of mine|don'?t call me|do not call me|never call me|won'?t (?:bear|carry|answer to|take)|will not (?:bear|carry|answer to|take)|call me (?:simply|just|only)|i am no |i'?m no |not (?:a |the )?\w+bane)\b/i;
export function spokenAbout(a,text){const E=a&&a.epithet;if(!E||E.refused||!a.player)return false;const t=String(text||'');
  const core=E.t.toLowerCase().replace(/^(the|of the|of)\s+/,'');if(!core||!t.toLowerCase().includes(core)||!NO.test(t))return false;
  E.refused={day:dayNo(),text:clean(t,160)};record(a,'Refused the name '+E.t+'.');
  dmlog('agent',null,[a.name+' refused the name '+E.t+' aloud.'],{hero:a.id,title:E.t,refused:true,by:'scripted'},{heroes:[]});
  return true}

// For the DM's member views and the watcher: the name now, and how it came.
export const epithetView=a=>a&&a.epithet?{title:a.epithet.t,known_as:a.name+' '+a.epithet.t,day:a.epithet.day,by:a.epithet.by,...(a.epithet.refused?{refused:'refused in their own words: '+a.epithet.refused.text}:{})}:null;
