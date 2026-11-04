// Goods jobs (issue #720, epic #238): board and DM jobs that ask for a crafted or gathered good ("Three Redroot Draughts for
// the chapel"). Owned by creature-designer. DOM-free. The templates are data/adventures.js SUPPLY.
//
// Not an adventure: no scenes, no party, no dice. A job is plain data on S.supply (saved with the world):
//   {id, tpl, phase: 'open'|'taken', town, fac, giver: {name, role}, want: {kind, id, n}, gold, honor, bonus, hint, src,
//    born, until, taker?, takenAt?, for?, by?, ff?, cid?, data: {}}
// open = on the board; taken = a hero holds it in its quest log (QL.MAX counts it, it goes cold SUP.TAKEN_DAYS game days after
// the take); a filled or cold job leaves S.supply (the quest log keeps the record). The hero turns the goods in at the town
// that posted it (agents: turn_in, which fills a job it holds or any open one the pack satisfies; scripted heroes: supplyVisit
// from the town visit). The pay is gold (SUP.MULT times the goods' worth), a line of honor and sometimes a material.
// Posted by the scripted DM (supplyPlan, called from sim/dm.js refill) for a hero who holds the trade, a Fellowship or company
// member first (ff, reserved to that company), else a hero of the town; and by the DM agent through post_hook with a template
// name as `tpl` (levers.js). The hero's view never says who posted it. No RNG: the pick is a function of the day and the ids.
import {S} from './state.js';
import {SUPPLY,SUPPLY_KEYS} from '../data/adventures.js';
import {RECIPES} from '../data/recipes.js';
import {USES,GOODS,MATERIALS,CRAFT_GEAR,price} from '../data/items.js';
import {homeOf} from '../data/races.js';
import {PROF} from '../data/professions.js';
import {professionsOf,skillBand} from './professions.js';
import {invOf,count,take,addGood,isGear,room} from './inv.js';
import {canCraft,craftOne} from './craft.js';
import {companyOf} from './company.js';
import {record} from './history.js';
import {log,gold} from './chronicle.js';

export const SUP={
  LIFE:[1440,2880],   // game minutes a job stays on the board (one to two game days; the id picks)
  TAKEN_DAYS:3,       // game days a taken job waits before it goes cold
  BOARD_MAX:2,        // open goods jobs a board holds
  GAP:1440,           // game minutes between two scripted postings on one board (a company's hall: after the last one is done)
  MULT:1.25,          // the pay, times what the goods are worth (materials at market; a craft at its materials plus fee, or the shop price if more)
  FLAT:2,             // gold on top
  HONOR:1,            // honor for a filled job
  BONUS:.5,           // the share of templates with a bonus that pays it (by job id, no dice)
  CRAFT_PER_VISIT:3,  // scripted: units crafted in one town visit toward a job
  REWARD:{small:.8,fair:1,generous:1.25},
};
const list=()=>S.supply||(S.supply=[]);
const alive=x=>x&&x.state!=='dead';
const hero=id=>S.agents.find(x=>x.id===id)||null;
const WORDS=['no','one','two','three','four','five','six','seven','eight'];
const cap=s=>s?s[0].toUpperCase()+s.slice(1):s;
const stats=()=>S.supplyStats||(S.supplyStats={posted:{},taken:0,filled:0,expired:0,gold:0,crafted:0,byBoard:0,viaScript:0});
const bump=(k,n=1)=>{const s=stats();s[k]=(s[k]||0)+n};

// ---- the good: what it is, how many a hero carries, what it is worth ----
const recipeOf=id=>RECIPES.find(r=>r.out.id===id)||null;
export const isGearGood=id=>!!CRAFT_GEAR[id];
export function have(a,w){if(isGearGood(w.id))return invOf(a).list.filter(e=>isGear(e)&&e.craft===w.id).length;return count(a,w.id)}
function takeGoods(a,w){if(isGearGood(w.id)){const L=invOf(a).list;let left=w.n;for(let i=L.length-1;i>=0&&left>0;i--)if(isGear(L[i])&&L[i].craft===w.id){L.splice(i,1);left--}return w.n-left}
  return take(a,USES[w.id]?'use':'good',w.id,w.n)}
// What one unit is worth: a gathered material at its market price, a crafted good at its materials plus its fee.
export function unitValue(w){if(w.kind==='gather')return price(w.id);
  const r=recipeOf(w.id);if(!r)return USES[w.id]?USES[w.id].price:10;
  const cost=r.inputs.reduce((s,i)=>s+i.n*(GOODS[i.id]||MATERIALS[i.id]?price(i.id):4),0)+r.gold;
  return Math.max(cost,USES[w.id]?USES[w.id].price*r.out.n:0)}
// The skill band a hero needs to make it (recipe band, or the material's band), and the trade.
export function bandOf(w){if(w.kind==='gather')return MATERIALS[w.id]?MATERIALS[w.id].band:0;const r=recipeOf(w.id);return r?r.band:0}

export function textOf(j){const T=SUPPLY[j.tpl]||{},n=j.want.n,item=n===1?j.want.id:(T.want&&T.want.pl)||j.want.id+'s';
  return String(T.title||'{N} {item}').replace('{N}',n===1?'A':cap(WORDS[n]||String(n))).replace('{item}',item)}
export const wantText=j=>'bring '+j.want.n+' '+j.want.id+(j.want.kind==='craft'?' (made with '+(PROF[SUPPLY[j.tpl]&&SUPPLY[j.tpl].prof]||{name:'a craft'}).name+')':'')+' to '+j.town;
export const rewardText=j=>j.gold+'g'+(j.honor?', '+j.honor+' honor':'')+(j.bonus?', and '+j.bonus.n+' '+j.bonus.id:'');

// ---- reading ----
export const supplyJobs=()=>list();
export const supplyById=id=>{if(id==null)return null;const t=String(id).replace(/^supply:/,'').trim();if(!/^[0-9]+$/.test(t))return null;return list().find(j=>j.id===Number(t))||null};
export const supplyOf=a=>list().filter(j=>j.phase==='taken'&&j.taker===a.id);
export const openAt=c=>list().filter(j=>j.phase==='open'&&j.town===c.name);
export const supplyId=j=>'supply:'+j.id;
// A company's hall job (ff) is the company's own: its members, whoever it was written for.
export function mayHave(a,j){if(j.for!=null&&j.for!==a.id)return false;
  if(j.ff&&j.cid!=null){const C=companyOf(a);if(!C||C.id!==j.cid)return false}return true}
const forHero=(a,j)=>j.phase==='taken'?j.taker===a.id:mayHave(a,j);

// ---- posting ----
const giverOf=(c,roles)=>{const ps=(S.npcs||[]).filter(p=>p.town===c.name&&roles.includes(p.role));
  const p=ps.length?ps[(c.name.length+Math.floor(S.gameMin/1440))%ps.length]:null;return p?{name:p.title+' '+p.name,role:p.role}:{name:'the gate captain',role:'captain'}};
// Post a goods job. o: {giver?, roles?, for?, by?, ff?, cid?, reward? (small|fair|generous), src?}. Deterministic: the amount and the
// life come from the job id, not the dice. Returns the job.
export function postSupply(c,tpl,o={}){const T=SUPPLY[tpl];if(!T)return null;const id=++S.uid,[lo,hi]=T.want.n,n=lo+(hi>lo?id%(hi-lo+1):0);
  const want={kind:T.want.kind,id:T.want.id,n};
  const mul=SUP.REWARD[o.reward]||1,g=o.giver||giverOf(c,o.roles||T.givers);
  const j={id,phase:'open',tpl,town:c.name,fac:c.fac,giver:g,want,
    gold:Math.max(2,Math.round((unitValue(want)*n*SUP.MULT+SUP.FLAT)*mul)),honor:SUP.HONOR,
    bonus:T.bonus&&(id%2===0)?{id:T.bonus[0],n:T.bonus[1]}:null,hint:T.hint||null,src:o.src||'request',
    born:S.gameMin,until:S.gameMin+SUP.LIFE[0]+(SUP.LIFE[1]-SUP.LIFE[0])*((id%5)/4),data:{}};
  if(o.for!=null)j.for=o.for;if(o.by&&o.by!=='scripted')j.by=o.by;if(o.ff){j.ff=1;if(o.cid!=null)j.cid=o.cid}
  list().push(j);const s=stats();s.posted[tpl]=(s.posted[tpl]||0)+1;return j}
export function withdrawSupply(id){const L=list(),i=L.findIndex(j=>j.id===id&&j.phase==='open');return i<0?null:L.splice(i,1)[0]}

// The scripted DM's pick for a board (sim/dm.js refill posts it through post_hook). fo: the company whose hall this is, or null.
// A hero who holds the trade at a skill that can make the good; the Fellowship or company member first. Null when the board is
// full, the last job is too recent, or no one fits. No RNG.
export function supplyPlan(c,fo){const open=openAt(c);if(open.length>=SUP.BOARD_MAX)return null;
  const cands=fo&&!list().some(j=>j.ff&&j.cid===fo.cid)?fo.members.filter(alive):[];
  const ff=cands.length>0;
  if(!ff){const last=(S.supplyAt||{})[c.name];if(last!=null&&S.gameMin-last<SUP.GAP)return null;
    cands.push(...S.agents.filter(a=>a.kind==='hero'&&alive(a)&&!a.player&&a.fac===c.fac&&homeOf(a)===c&&a.state==='town'))}
  const day=Math.floor(S.gameMin/1440);
  for(let k=0;k<cands.length;k++){const a=cands[(day+k)%cands.length],P=professionsOf(a);if(!P.length)continue;
    const fit=SUPPLY_KEYS.filter(t=>{const T=SUPPLY[t],p=P.find(x=>x.id===T.prof);return p&&skillBand(Math.max(1,p.skill))>=bandOf(T.want)&&!open.some(j=>j.tpl===t)});
    if(!fit.length)continue;const tpl=fit[(day+a.id)%fit.length],T=SUPPLY[tpl];
    return {tpl,o:{giver:giverOf(c,T.givers),...(ff?{ff:1,cid:fo.cid}:{}),...(ff?{for:a.id}:{}),src:T.givers[0]==='captain'?'writ':'request'},ff,
      reason:ff?'a '+PROF[T.prof].name.toLowerCase()+' on their road can fill it':'a hero of the town holds the trade'}}
  return null}
export function notePosted(c,j){(S.supplyAt||(S.supplyAt={}))[c.name]=S.gameMin}

// ---- taking, abandoning, filling ----
export function takeSupply(a,j,max){const bad=j.phase!=='open'?'Someone else has that job.':j.town!==homeOf(a).name?'That job is posted in '+j.town+', not your town.':!mayHave(a,j)?'That job is not for you.':null;
  if(bad)return {ok:false,error:bad};
  if(max!=null&&supplyOf(a).length>=max)return {ok:false,error:'too many'};
  j.phase='taken';j.taker=a.id;j.takenAt=Math.round(S.gameMin);j.until=S.gameMin+SUP.TAKEN_DAYS*1440;bump('taken');
  record(a,'Took a job: ',{t:textOf(j),c:'gd'},' ('+(j.giver?j.giver.name:'the board')+').');return {ok:true,job:j}}
export function dropSupply(a,j){if(j.phase!=='taken'||j.taker!==a.id)return false;j.phase='open';j.taker=null;j.takenAt=null;j.until=Math.max(j.until,S.gameMin+720);return true}

// Hand the goods in: the first job (held ones first, then the oldest open) at the hero's town whose goods the pack holds.
// Returns {ok, job, gold, honor, bonus} or null when nothing matches. done(a,j) is called after payment (the quest log).
let onDone=null;export const setSupplyDone=f=>{onDone=f};
export function fillSupply(a,{by='agent'}={}){const c=homeOf(a);
  const L=list().filter(j=>j.town===c.name&&forHero(a,j)&&have(a,j.want)>=j.want.n).sort((p,q)=>(q.phase==='taken')-(p.phase==='taken')||p.born-q.born||p.id-q.id);
  const j=L[0];if(!j)return null;
  if(takeGoods(a,j.want)<j.want.n)return null; // cannot happen after have(); the pack is not half-spent
  list().splice(list().indexOf(j),1);
  a.gold+=j.gold;a.honor=(a.honor||0)+j.honor;let bonus=null;
  if(j.bonus&&room(a)>0&&addGood(a,j.bonus.id,j.bonus.n))bonus=j.bonus;
  const s=stats();s.filled++;s.gold+=j.gold;if(by!=='agent')s.viaScript++;
  record(a,'Filled a job: ',{t:textOf(j),c:'gd'},' for '+j.gold+'g.');
  if(j.ff)log(a,' fills ',gold(textOf(j)),' at '+j.town+'.');
  if(onDone)onDone(a,j,'done',j.gold);
  return {ok:true,job:j,gold:j.gold,honor:j.honor,bonus}}

// ---- once per step (sim/questlog.js questTick): jobs go cold; no dice ----
export function supplyTick(){const L=S.supply;if(!L||!L.length)return;
  for(let i=L.length-1;i>=0;i--){const j=L[i];
    if(j.phase==='open'){const gone=S.gameMin>j.until||(j.for!=null&&!alive(hero(j.for)));if(gone){L.splice(i,1);bump('expired')}}
    else if(j.phase==='taken'){const t=hero(j.taker);if(alive(t)&&S.gameMin<=j.until)continue;L.splice(i,1);bump('expired');
      if(alive(t)&&onDone)onDone(t,j,'expired',0)}}}

// ---- scripted heroes (heroes.js sellAndShop, before the sale; no RNG) ----
// A scripted hero in town fills an open job of its town's board from what it carries, and, holding the trade, crafts toward
// one from the materials it has (never buying for it). Gathered goods it was about to sell go to the job first.
export function supplyVisit(a){if(a.player||!list().length)return 0;const c=homeOf(a);let n=0;
  for(let k=0;k<3;k++){const r=fillSupply(a,{by:'script'});if(!r)break;n++}
  for(const j of list()){if(j.phase!=='open'||j.town!==c.name||j.want.kind!=='craft'||!mayHave(a,j))continue;
    const r=recipeOf(j.want.id);if(!r||!professionsOf(a).some(p=>p.id===r.prof))continue;
    let made=0;while(have(a,j.want)<j.want.n&&made<SUP.CRAFT_PER_VISIT&&canCraft(a,r,{where:'town'}).ok){const o=craftOne(a,r,{by:'script',where:'town'});if(!o.ok)break;made++;stats().crafted++}
    if(made&&have(a,j.want)>=j.want.n&&fillSupply(a,{by:'script'}))n++}
  return n}

export {SUPPLY,SUPPLY_KEYS};
