// Swearing an oath, the writing side (#800). Owned by ai-designer. No RNG. sim/oath.js says what the states mean.
// One road in (takeOath: the first table's swear, or swear_oath), three out: the game sees it kept (goals.js complete, or
// keepOath for what it cannot see), it fails (a protected companion falls), or the hero renounces it, at a cost.
// What can be tracked is matched from the words: a named elite, a named epic, an enemy hero, Kragmaw, clearing the Crypt, a place,
// a companion, a kind of creature. Anything else is kept as words: the game never calls it kept; the hero says so with keep_oath.
import {S} from './state.js';
import {CRYPT,zoneAt,dist} from '../world/map.js';
import {ELITES,MOBS} from '../data/mobs.js';
import {EPICS,DG_EPICS,BOSS_EPICS} from '../data/items.js';
import {BOSSES} from '../data/bosses.js';
import {log} from './chronicle.js';
import {record,timeline} from './history.js';
import {mark} from './tiers.js';
import {moment} from './reflect.js';
import {ev} from './notify.js';
import {oathDone} from './questlog.js';
import {VOW,norm,placeNamed,placeList,coolBonds} from './vows.js';
import {addHeroNote} from './notebook.js';
import {notEnglish} from './lang.js';
import {campaign,companyOf} from './company.js';
import {swornOf,threadOf,threadText} from './oath.js';

const SLAY=/\b(slay|slain|kill|end|hunt|destroy|avenge|fell|bring down|cut down|put down|death|head)\b/i,
  GUARD=/\b(protect|guard|shield|defend|keep|safe|alive|watch over)\b/i,CLEAR=/\b(clear|cleanse|purge|empty)\b/i;
const gd=t=>({t,c:'gd'}),clean=(s,n)=>String(s==null?'':s).replace(/\s+/g,' ').trim().slice(0,n);
const alive=x=>x&&x.state!=='dead',byId=id=>S.agents.find(x=>x.id==id);
const names=(t,n)=>{const w=norm(n);return !!w&&(' '+norm(t)+' ').includes(' '+w+' ')};
const longest=L=>L.slice().sort((p,q)=>String(q.name||q).length-String(p.name||p).length);

export const swearWord=raw=>{const w=clean(raw,VOW.TEXT+1),l=w.toLowerCase().replace(/[.!]+$/,'');return l==='yes'?'yes':l==='no'?'no':w};
// Can a hero answer this way now? -> a refusal, or null.
export function swearBlock(a,raw){const w=swearWord(raw);if(!a||a.state==='dead'||a.state==='ghost')return 'The dead swear nothing.';
  if(w==='yes'||w==='no')return threadOf(a)?null:'There is no thread from your past to '+(w==='yes'?'take up':'set aside')+'.';
  if(swornOf(a))return 'You already hold an oath: '+swornOf(a).text+'. swear_oath with days binds a vow beside it; renounce_oath gives it up, at a cost.';
  if(!w)return 'Say the words you swear.';if(w.length>VOW.TEXT)return 'An oath is at most '+VOW.TEXT+' characters.';
  return notEnglish(w)?'Swear in English.':null}

// What the words can be held to. kind/about: a swear_oath that said so outright (about already resolved).
export function matchWords(a,text,kind,about){
  if(kind==='vow')return {type:'own',kind:'vow',about:null};
  if(kind)return (kind==='slay'&&slayGoal(a,about.name))||(kind==='recover'&&knownEpic(about.name))||{type:'own',kind,about};
  const boss=Object.values(BOSSES).find(b=>names(text,b.name));if(boss&&SLAY.test(text))return {type:'legend'};
  if(names(text,CRYPT.name)&&CLEAR.test(text))return {type:'delve'};
  const E=longest(ELITES).find(e=>names(text,e.name));if(E)return {type:'avenge',target:E.name};
  const ep=longest(allEpics()).find(n=>names(text,n));if(ep)return epicGoal(ep);
  if(SLAY.test(text)){const h=S.agents.find(x=>x.kind==='hero'&&x.fac!==a.fac&&alive(x)&&names(text,x.name));if(h)return slayGoal(a,h.name)}
  if(GUARD.test(text)){const C=companyOf(a),b=(C?C.ids.map(byId):[]).find(x=>x&&x!==a&&alive(x)&&names(text,x.name));if(b)return {type:'own',kind:'protect',about:{name:b.name,id:b.id}}}
  const place=longest(placeList()).find(n=>names(text,n));if(place){const p=placeNamed(place);if(p)return {type:'own',kind:'reach',about:{name:p.name,zone:p.zone,x:p.x,y:p.y,r:p.r}}}
  if(SLAY.test(text)){const m=longest(Object.values(MOBS).map(m=>m.name).filter(Boolean)).find(n=>names(text,n));if(m)return {type:'own',kind:'slay',about:{name:m}}}
  return {type:'own',kind:'vow',about:null}}
const allEpics=()=>[...EPICS.flat(),...DG_EPICS,...BOSS_EPICS];
const epicGoal=n=>({type:DG_EPICS.includes(n)?'heirloomCrypt':BOSS_EPICS.includes(n)?'heirloomBoss':'heirloom',target:n});
const knownEpic=w=>{const n=allEpics().find(x=>norm(x)===norm(w));return n?epicGoal(n):null};
function slayGoal(a,w){const E=ELITES.find(e=>norm(e.name)===norm(w));if(E)return {type:'avenge',target:E.name};
  const h=S.agents.find(x=>x.kind==='hero'&&x.fac!==a.fac&&alive(x)&&norm(x.name)===norm(w));return h?{type:'avengeHero',target:h.name,targetId:h.id,targetFac:h.fac,victim:null}:null}
// Is this oath one only the hero can call kept?
export const wordsOnly=g=>!!(g&&g.type==='own'&&(g.kind==='vow'||g.kind==='protect'));

function told(a,g,H){const text=g.text;record(a,'Swore, aloud: ',{t:text,c:'gd'});mark(a,'vow','Swore an oath: '+text+(H.length?' ('+H.map(b=>b.name).join(', ')+' heard).':'.'));
  log(a,' swears: ',{t:text,c:'dm'});timeline('swore',a,' swears: ',gd(text));
  const C=companyOf(a);if(C&&C.ids.length>1)campaign(C,'oath',a,' swore: ',gd(text));
  for(const b of H)if(b.player)ev(b,a.name+' swears: '+text)}

// The hero swears. raw: 'yes' (the thread as it stands) or its own words. o: {by, hearers, kind?, about?}. -> the oath, sworn.
export function takeOath(a,raw,o={}){const w=swearWord(raw),H=o.hearers||[],at=Math.round(S.gameMin),rec={at,by:o.by||'tool',heard:H.map(b=>b.id)};
  if(w==='yes'){const g=a.goal;delete g.offered;delete g.offeredAt;delete g.quiet;delete g.aside;g.at=at;g.sworn={...rec,words:false};told(a,g,H);return g}
  const was=threadOf(a),m=matchWords(a,w,o.kind,o.about);
  if(was)keepPast(a,was);
  const g={tier:0,need:1,progress:0,done:false,...m,text:w,at,sworn:{...rec,words:true}};a.goal=g;told(a,g,H);return g}
// A thread not taken stays a memory of the hero's own: no cost, nobody told.
function keepPast(a,g){const t=threadText(a,g);if(t)addHeroNote(a,{title:'From my past',text:t,tags:['past']})}
export function setAside(a){const g=threadOf(a);if(!g)return null;keepPast(a,g);g.aside=true;return g}

// An oath ended well. The caller has already marked it done or taken it off the hero.
export function oathKept(a,g){const t=g.text;a.oathKept={text:t,at:Math.round(S.gameMin)};
  if(!(g.sworn&&g.sworn.words))return;
  log(a,' kept the oath: ',{t,c:'dm'});timeline('oath',a,' kept the oath: ',gd(t));record(a,'Kept the oath: ',{t,c:'gd'});mark(a,'vow','Kept the oath: '+t);
  ev(a,'You kept your oath: '+t,true);for(const id of g.sworn.heard||[]){const b=byId(id);if(alive(b)&&b.player)ev(b,a.name+' has kept the oath they swore in your hearing: '+t)}}
// The tracked kinds: did this event keep it?
export function ownHit(a,kind,x){const g=a.goal;if(!g||g.type!=='own'||g.done||g.offered||!g.about)return false;const w=norm(g.about.name);
  if(g.kind==='slay'&&(kind==='kill'||kind==='slay')&&x){const c=kind==='kill'&&!x.elite&&!x.named&&MOBS[x.type]?norm(MOBS[x.type].name):null;return norm(x.name)===w||c===w}
  return g.kind==='recover'&&kind==='epic'&&norm(String(x))===w}
// Twice a real second, for a hero holding an 'own' oath: 'kept', 'failed' or null.
export function ownTick(a,g){if(g.kind==='reach'&&a.state!=='ghost'){const p=g.about,here=p&&(p.zone!=null?zoneAt(a.x,a.y)===p.zone:dist(a,p)<=(p.r||4));return here?'kept':null}
  if(g.kind==='protect'&&!alive(byId(g.about&&g.about.id)))return 'failed';return null}
// The one it swore to keep alive fell.
export function oathFailed(a,why){const g=a.goal;if(!g)return;oathDone(a,g,'failed');a.goal=null;log(a,' failed an oath: ',{t:g.text,c:'dm'});record(a,'The oath failed: ',{t:g.text,c:'gd'});mark(a,'vow','An oath failed: '+g.text+' '+why);
  ev(a,'Your oath failed: '+g.text+' '+why,true);a.vowBroke={text:g.text,at:Math.round(S.gameMin),how:'failed'}}
// The hero says it is done: the game cannot see words, so it takes the hero at its word. No reward hangs on it, only the story.
export function keepOath(a){const g=swornOf(a);a.goal=null;oathDone(a,g,'done');oathKept(a,g);moment(a,'oath',g.text);return g}
// Given up on purpose. The same costs as a vow's (sim/vows.js). -> {oath, bonds_cooled}.
export function renounceOath(a,why){const g=swornOf(a),w=clean(why,120);
  const b=g.type==='own'&&g.kind==='protect'&&g.about?byId(g.about.id):null,heard=(g.sworn&&g.sworn.heard)||[],cooled=coolBonds(a,b,heard);
  a.goal=null;oathDone(a,g,'abandoned');log(a,' broke their word: ',{t:g.text,c:'dm'},w?' ('+w+')':'');record(a,'Broke the oath: ',{t:g.text,c:'gd'},w?' ('+w+')':'');
  mark(a,'vow','Broke their word: '+g.text+(w?' ('+w+')':''));a.vowBroke={text:g.text,at:Math.round(S.gameMin),how:'renounced',why:w||null};
  for(const id of heard){const x=byId(id);if(alive(x)&&x.player)ev(x,a.name+' has broken the oath they swore in your hearing: '+g.text)}
  return {oath:g,bonds_cooled:cooled}}
