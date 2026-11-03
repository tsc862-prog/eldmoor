// Vows (#526): an agent-played hero binds itself on purpose. One sworn vow at a time, besides the oath the sim gave it
// (a.goal, sim/goals.js). a.vow = {id, kind, text, about, at, ends, days, witnesses:[ids]}. Kinds:
//   slay      kill the named foe (an elite, a kind of creature, or an enemy hero)   (goalEvent 'kill' / 'slay')
//   recover   loot the named epic                                                  (goalEvent 'epic')
//   reach     set foot in a region, town or landmark                               (vowTick)
//   protect   keep a companion alive until the term ends                           (vowTick; their death breaks it)
//   vow       free words, held until the term ends
// Slay, recover and reach lapse (expired, not broken) when the term runs out; protect and a free vow are kept by
// reaching the end of it. Renouncing costs (a landmark, a Chronicle line, bonds). No RNG: a world with no vow is unchanged.
import {CITY,LANDMARKS,ZONES,zoneAt,dist} from '../world/map.js';
import {MOBS} from '../data/mobs.js';
import {S} from './state.js';
import {log} from './chronicle.js';
import {record} from './history.js';
import {mark} from './tiers.js';
import {moment} from './reflect.js';
import {ev} from './notify.js';
import {vowDone} from './questlog.js';

export const VOW={TEXT:200,DAYS:10,MAX_DAYS:30,PROTECT_DAYS:5,BROKEN_DAYS:3,KINDS:['slay','recover','reach','protect','vow'],BOND_LOSS:4,WITNESS_LOSS:1};
const DAY=1440;
const alive=x=>x&&x.state!=='dead';
const byId=id=>S.agents.find(x=>x.id==id);
const lc=t=>t.charAt(0).toLowerCase()+t.slice(1);
export const norm=s=>String(s||'').toLowerCase().replace(/^(the|a|an)\s+/,'').replace(/[^a-z0-9 ]/g,'').trim();
const seq=()=>S.vowSeq=(S.vowSeq||0)+1;

// Where a reach vow points: a region, a town or a landmark by name -> {name, x, y, zone, r}.
export function placeNamed(name){const n=norm(name);if(!n)return null;
  const zi=ZONES.findIndex(z=>norm(z)===n);if(zi>=0)return {name:ZONES[zi],zone:zi};
  const c=CITY.find(c=>norm(c.name)===n);if(c)return {name:c.name,x:(c.x0+c.x1)/2,y:(c.y0+c.y1)/2,zone:null,r:6};
  const l=LANDMARKS.find(l=>norm(l.name)===n);return l?{name:l.name,x:l.x,y:l.y,zone:null,r:Math.max(3,(l.r||0)+1.5)}:null}
export const placeList=()=>[...ZONES,...CITY.map(c=>c.name),...LANDMARKS.map(l=>l.name)];

// The wording a vow is told in ("I will slay Gorrek.") when the hero gave none.
export function vowText(kind,about,text){const t=String(text||'').trim();
  if(t)return t;const w=about&&about.name?about.name:'';
  return kind==='slay'?'I will slay '+w+'.':kind==='recover'?'I will recover '+w+'.':kind==='reach'?'I will reach '+w+'.':kind==='protect'?'I will keep '+w+' alive.':''}

export function canSwear(a){if(a.vow)return 'Keep or renounce your standing vow first: '+a.vow.text+' (renounce_oath).';
  if(a.state==='ghost'||a.state==='dead')return 'The dead swear nothing.';return null}

// kind/about are resolved and checked by the tool; here the vow is made and told.
export function swear(a,{kind,about,text,days,hearers}){
  const d=Math.max(1,Math.min(VOW.MAX_DAYS,Math.round(Number(days)||(kind==='protect'?VOW.PROTECT_DAYS:VOW.DAYS))));
  const H=hearers||[];
  const v={id:'vow:'+seq(),kind,text,about:about||null,at:Math.round(S.gameMin),ends:Math.round(S.gameMin)+d*DAY,days:d,witnesses:H.map(b=>b.id)};
  a.vow=v;record(a,'Swore, aloud: ',{t:text,c:'gd'});
  mark(a,'vow','Swore a vow: '+text+(H.length?' ('+H.map(b=>b.name).join(', ')+' heard).':'.'));
  for(const b of H)if(b.player)ev(b,a.name+' swears: '+text);
  return v}

function end(a,st,line){const v=a.vow;if(!v)return;a.vow=null;vowDone(a,v,st);
  if(st==='done'){log(a,' kept a vow: ',{t:lc(v.text),c:'dm'});record(a,'Kept the vow: ',{t:v.text,c:'gd'});mark(a,'vow','Kept the vow: '+v.text);moment(a,'oath',v.text);ev(a,'You kept your vow: '+v.text,true)}
  else if(st==='expired'){record(a,'The term of the vow ran out: ',{t:v.text,c:'gd'});ev(a,'The term of your vow ran out unkept: '+v.text)}
  else if(st==='failed'){log(a,' failed a vow: ',{t:lc(v.text),c:'dm'});record(a,'The vow failed: ',{t:v.text,c:'gd'});mark(a,'vow','A vow failed: '+v.text+(line?' '+line:''));
    ev(a,'Your vow failed: '+v.text+(line?' '+line:''),true);a.vowBroke={text:v.text,at:Math.round(S.gameMin),how:'failed'}}}

// Giving a vow up on purpose. Costs: a landmark, a Chronicle line, bonds with the companion it concerned and a little
// with those who heard it, and the witnesses are told.
export function renounce(a,reason){const v=a.vow;if(!v)return null;const why=String(reason||'').trim();
  const cooled=[];
  const hit=(b,n)=>{if(!b||b===a)return;const B=a.bonds||(a.bonds={}),was=B[b.id]||0;if(was<=0)return;
    const now=Math.max(0,was-n);if(now>0)B[b.id]=now;else delete B[b.id];
    if(b.bonds&&b.bonds[a.id]!=null){const m=Math.max(0,b.bonds[a.id]-n);if(m>0)b.bonds[a.id]=m;else delete b.bonds[a.id]}cooled.push(b.name)};
  const concerned=v.kind==='protect'&&v.about&&v.about.id!=null?byId(v.about.id):null;
  if(concerned)hit(concerned,VOW.BOND_LOSS);
  for(const id of v.witnesses||[]){const b=byId(id);if(b!==concerned&&alive(b))hit(b,VOW.WITNESS_LOSS)}
  a.vow=null;vowDone(a,v,'abandoned',why);
  log(a,' broke their word: ',{t:lc(v.text),c:'dm'},why?' ('+why+')':'');record(a,'Broke the vow: ',{t:v.text,c:'gd'},why?' ('+why+')':'');
  mark(a,'vow','Broke their word: '+v.text+(why?' ('+why+')':''));
  a.vowBroke={text:v.text,at:Math.round(S.gameMin),how:'renounced',why:why||null};
  for(const id of v.witnesses||[]){const b=byId(id);if(alive(b)&&b.player)ev(b,a.name+' has broken the vow they swore in your hearing: '+v.text)}
  return {vow:v,bonds_cooled:cooled}}

// ---- detection ----
export function vowEvent(a,kind,x){const v=a.vow;if(!v||!alive(a))return;const w=v.about&&norm(v.about.name);
  if(v.kind==='slay'&&(kind==='kill'||kind==='slay')&&x&&w){
    const creature=kind==='kill'&&!x.elite&&!x.named&&MOBS[x.type]?norm(MOBS[x.type].name):null;
    if(norm(x.name)===w||creature===w)end(a,'done')}
  else if(v.kind==='recover'&&kind==='epic'&&w&&norm(String(x))===w)end(a,'done')}

// A debt or promise of gold settled (#628, pay): a vow that names the payee and talks of paying, owing or gold is kept.
export function vowPaid(a,b){const v=a&&a.vow;if(!v||!b||!alive(a)||v.kind!=='vow'||!/\b(pay|paid|debt|owe|owed|repay|gold)\b/i.test(v.text||''))return;
  const w=v.about&&(v.about.id===b.id||norm(v.about.name)===norm(b.name));if(w)end(a,'done')}

// Once per goal tick (twice a real second), only for heroes holding a vow.
export function vowTick(a){const v=a.vow;if(!v)return;if(a.state==='dead'){a.vow=null;return}
  if(v.kind==='protect'){const b=byId(v.about&&v.about.id);if(!alive(b)){end(a,'failed','They fell.');return}}
  if(v.kind==='reach'&&a.state!=='ghost'){const p=v.about,arrived=p&&(p.zone!=null?zoneAt(a.x,a.y)===p.zone:dist(a,p)<=(p.r||4));if(arrived){end(a,'done');return}}
  if(S.gameMin>=v.ends)end(a,v.kind==='protect'||v.kind==='vow'?'done':'expired')}

// Broken or failed lately (the DM reads it as a thread for a few game days).
export const brokenLately=a=>a.vowBroke&&S.gameMin-a.vowBroke.at<VOW.BROKEN_DAYS*DAY?a.vowBroke:null;
export const vowLeft=a=>a.vow?Math.max(0,Math.ceil((a.vow.ends-S.gameMin)/DAY)):0;
