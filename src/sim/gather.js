// Gathering (issue #257, epic #238): learning a profession, what each one gathers and makes, and working a node.
// DOM-free. The skill model is sim/professions.js, the node registry sim/nodes.js (#255), materials are
// data/items.js MATERIALS (#256), recipes data/recipes.js (read only here; crafting is #258).
//
// One attempt (attempt) for everyone: a d100 skill check against the material's band, a material into the pack
// as a trade-good stack (it sells at the auction house like GOODS, feeding MATERIALS supply), the node spent until
// it grows back, and a little skill. Gathering is a short action: GATHER.MIN game minutes at the node.
//
// Scripted heroes (gatherTick, called from the hunt state in heroes.js): from level GATHER.LEARN_LVL a hero takes up
// one gathering trade chosen by class and traits (as specialisations are, sim/spec.js), and while hunting, at most
// once per GATHER.GAP game minutes, walks to a ready node of its trade within GATHER.SPOT tiles and works it. The
// hero stays in the 'hunt' state while it gathers (a.gathering), on purpose: mob aggro, duels, party pulls and
// every state list treat a hunter as out in the field, so a gatherer is exactly as exposed as a hunter.
// Agent heroes never gather or learn by script (every decision is the agent's): their tools are recipes,
// learn_profession, unlearn_profession, nodes and gather (sim/player.js), and the queued 'gather' command runs
// through gatherCmd.
import {S} from './state.js';
import {rnd} from '../core/rng.js';
import {PROF,PROF_IDS,MAX_PROF,SKILL_MAX} from '../data/professions.js';
import {MATERIALS,INV,price} from '../data/items.js';
import {RECIPES} from '../data/recipes.js';
import {professionsOf,skillOf,hasProfession,canLearn,learn,gainSkill,skillBand} from './professions.js';
import {nodeById,nodeNear,isReady,readyAt,harvest} from './nodes.js';
import {invOf,room,addGood,isGear,count} from './inv.js';
import {record} from './history.js';
import {log,gold} from './chronicle.js';
import {dist} from '../world/map.js';

export const GATHER={
  MIN:20,          // game minutes at the node per attempt
  REACH:1.2,       // tiles from the node's centre to work it
  SPOT:10,         // scripted: a ready node within this many tiles while hunting
  GAP:300,         // scripted: game minutes between two attempts (at most about four a game day)
  SCAN:20,         // scripted: game minutes between two looks for a node
  EXP:90,          // scripted: a walk to a node is given up after this many game minutes
  LEARN_LVL:3,     // scripted: level at which a hero takes up a gathering trade
  STRETCH:.45,     // chance at a material one band above the hero's
};
// Which node kind each gathering profession works (node kinds: world/nodes.js NODE_KINDS).
export const KIND_OF={herbalism:'herb',mining:'ore',skinning:'hide',fishing:'fish'};
export const PROF_OF=Object.fromEntries(Object.entries(KIND_OF).map(([p,k])=>[k,p]));
export const BAND_NAMES=['Novice','Apprentice','Journeyman','Expert','Master'];
const VERB={herb:'picked',ore:'mined',hide:'took',fish:'caught'};
const NOUN={herb:'herbalist',ore:'miner',hide:'skinner',fish:'fisher'};
// Scripted choice of a trade: leanings by class and trait (unlisted weigh 0), ties by hero id. Data for ai behaviour only.
const LEAN={
  herbalism:{Priest:2,Mage:1.5,Pious:1.5,Cautious:1},
  mining:{Warrior:2,Greedy:1.5,Boastful:.5},
  skinning:{Hunter:2,Rogue:1.5,Reckless:1,Loner:.5},
  fishing:{Loner:1.5,Cautious:.5,Mage:.5},
};

export const bandName=skill=>BAND_NAMES[skillBand(Math.max(1,skill))];
// The lowest skill of a band (band 0 from 1).
export const bandFloor=b=>b<=0?1:b>=4?SKILL_MAX:b*25;
const gatherProfs=a=>professionsOf(a).filter(p=>p.kind==='gather');
const matsOf=kind=>Object.keys(MATERIALS).filter(n=>MATERIALS[n].kind===kind).sort((x,y)=>MATERIALS[x].band-MATERIALS[y].band);
// What a node yields: the best material of its kind at or below the node's band.
export function yieldOf(node){const L=matsOf(node.kind).filter(n=>MATERIALS[n].band<=node.band);return L.length?L[L.length-1]:null}
// A unit of this material fits in the pack (a free slot, or a stack of it with room).
export const fits=(a,id)=>room(a)>0||invOf(a).list.some(e=>!isGear(e)&&e.kind==='good'&&e.id===id&&e.n<INV.STACK);

// Can this hero work this node now? {ok:true, prof, mat, chance} or {ok:false, why}. Distance is not checked here.
export function canGather(a,node){
  if(!node)return {ok:false,why:'There is no such gathering spot.'};
  const prof=PROF_OF[node.kind];
  if(!hasProfession(a,prof))return {ok:false,why:'Working a '+node.name.toLowerCase()+' takes '+PROF[prof].name+', which you do not know.',need:prof};
  const t=readyAt(node);if(t)return {ok:false,why:'This '+node.name.toLowerCase()+' is spent; it grows back in about '+Math.max(1,Math.round(t-S.gameMin))+' game minutes.',readyIn:Math.round(t-S.gameMin)};
  const skill=skillOf(a,prof),hb=skillBand(skill);
  if(node.band>hb+1)return {ok:false,why:'Too hard for you yet: this '+node.name.toLowerCase()+' needs '+PROF[prof].name+' '+bandFloor(node.band-1)+' (you have '+skill+').'};
  const mat=yieldOf(node);if(!mat)return {ok:false,why:'Nothing here you can take.'};
  if(!fits(a,mat))return {ok:false,why:'Your pack is full: sell or drop something to make room for '+mat+'.'};
  const mb=MATERIALS[mat].band,chance=mb>hb?GATHER.STRETCH:Math.min(.95,.75+.1*(hb-mb));
  return {ok:true,prof,mat,chance,skill};
}

// One attempt at a node the hero stands at. Returns {ok, text, got?, n?, skill, up?}. Draws from the RNG.
export function attempt(a,node,{by}={}){const c=canGather(a,node);if(!c.ok)return {ok:false,text:c.why};
  const hb=skillBand(c.skill),d=hb-node.band,was=bandName(c.skill),ok=rnd()<c.chance;
  const gain=ok?(d<0?2:d===0?1:d===1?.4:.1):.3;
  const g=gainSkill(a,c.prof,gain),now=bandName(g.skill);
  const S0=S.gatherStats||(S.gatherStats={tries:0,got:0,units:0,learned:0,byKind:{}});S0.tries++;
  if(!ok){const verb={herb:'The plants crumble in your hands',ore:'The vein will not give',hide:'The trail runs cold',fish:'Nothing bites'}[node.kind];
    return {ok:true,got:null,text:verb+' this time ('+PROF[c.prof].name+' '+g.skill+'). The spot is still there to try again.',skill:g.skill}}
  harvest(node);
  const n=1+(rnd()<.25+.1*Math.max(0,hb-MATERIALS[c.mat].band)?1:0),got=addGood(a,c.mat,n);
  S0.got++;S0.units+=got;S0.byKind[node.kind]=(S0.byKind[node.kind]||0)+got;
  let text='You '+VERB[node.kind]+' '+c.mat+' x'+got+' ('+PROF[c.prof].name+' '+g.skill+(g.up?', up':'')+').';
  if(now!==was){text+=' You are now '+(now==='Apprentice'||now==='Expert'?'an ':'a ')+now+' '+NOUN[node.kind]+'.';
    record(a,'Became '+(now==='Apprentice'||now==='Expert'?'an ':'a ')+now.toLowerCase()+' '+NOUN[node.kind]+'.');
    if(now==='Master'||(by!=='script'&&now!=='Apprentice'))log(a,' is now ',gold((now==='Apprentice'||now==='Expert'?'an ':'a ')+now+' '+NOUN[node.kind]),'.')}
  return {ok:true,got:c.mat,n:got,text,skill:g.skill,up:g.up}}

// A new world opens with every material at the table's stock (init, sim/index.js).
export function resetMats(){for(const n in MATERIALS){MATERIALS[n].supply=6;MATERIALS[n].prev=price(n)}}

// ---- scripted heroes ----
// Pick a gathering trade by class and trait leanings (spec.js pattern). Deterministic, no RNG.
export function pickTrade(a){let best=null,bs=-1;
  for(const id of PROF_IDS){if(PROF[id].kind!=='gather'||hasProfession(a,id))continue;const L=LEAN[id]||{};
    let v=(L[a.cls]||0);for(const t of a.traits||[])v+=L[t]||0;v+=(((a.id||0)*7+id.length)%5)*.05;
    if(v>bs){bs=v;best=id}}
  return best}
// A scripted hero takes up a trade once it is ready for one; true when it learned.
export function ensureTrade(a){if(a.player||a.lvl<GATHER.LEARN_LVL||gatherProfs(a).length||professionsOf(a).length>=MAX_PROF)return false;
  const id=pickTrade(a);if(!id||!learn(a,id).ok)return false;
  record(a,'Took up ',{t:PROF[id].name,c:'gd'},'.');const st=S.gatherStats||(S.gatherStats={tries:0,got:0,units:0,learned:0,byKind:{}});st.learned++;return true}

// Called from the hunt state (heroes.js). True while the hero is busy gathering (the state does nothing else).
// moveTo is passed in (as steerClear takes it) so this module does not import heroes.js.
export function gatherTick(a,dt,moveTo){if(a.player)return false; // agents decide for themselves (#148)
  const g=a.gathering;
  if(g){const n=nodeById(g.node);
    if(!n||S.gameMin>g.exp||!isReady(n)){a.gathering=null;return false}
    if(dist(a,n)>GATHER.REACH){moveTo(a,n.x,n.y,dt,1.8);return true}
    a.moving=false;if(g.until==null)g.until=S.gameMin+GATHER.MIN;
    if(S.gameMin<g.until)return true;
    a.gathering=null;attempt(a,n,{by:'script'});return true}
  if(S.gameMin<(a.gatherNext||0))return false;
  a.gatherNext=S.gameMin+GATHER.SCAN;
  if(a.party&&a.party.leader!==a)return false;
  ensureTrade(a);
  for(const p of gatherProfs(a)){const hb=skillBand(p.skill);
    const n=nodeNear(a.x,a.y,GATHER.SPOT,KIND_OF[p.id]).find(x=>x.band<=hb+1&&isReady(x)&&x.band>=hb-1&&canGather(a,x).ok);
    if(n){a.gathering={node:n.id,exp:S.gameMin+GATHER.EXP};a.gatherNext=S.gameMin+GATHER.GAP;a.dest=null;return true}}
  return false}

// ---- agent heroes (sim/player.js tools) ----
// A queued gather command {kind:'gather', node, until?}: walk to the node, work it GATHER.MIN game minutes, then try.
// Returns the text to finish the command with, or null while it runs.
export function gatherCmd(a,dt,cmd,moveTo){const n=nodeById(cmd.node);
  if(!n)return 'That gathering spot is gone.';
  if(!isReady(n))return 'The '+n.name.toLowerCase()+' was worked by someone before you got to it; it grows back in about '+Math.max(1,Math.round(readyAt(n)-S.gameMin))+' game minutes.';
  if(dist(a,n)>GATHER.REACH){cmd.until=null;moveTo(a,n.x,n.y,dt,1.8);return null}
  a.moving=false;if(cmd.until==null)cmd.until=S.gameMin+GATHER.MIN;
  if(S.gameMin<cmd.until)return null;
  return attempt(a,n,{by:'agent'}).text}

// The professions a hero holds, in words, with what each does at its skill now.
export function profLines(a){return professionsOf(a).map(p=>{const o={id:p.id,name:p.name,kind:p.kind,skill:p.skill,rank:bandName(p.skill)};
  if(p.kind==='gather'){const k=KIND_OF[p.id],hb=skillBand(p.skill);o.works=nodeWord(k);
    o.can_gather=matsOf(k).filter(m=>MATERIALS[m].band<=hb+1).map(m=>m+(MATERIALS[m].band>hb?' (a stretch)':''));
    const next=matsOf(k).find(m=>MATERIALS[m].band>hb+1);if(next)o.next=next+' at skill '+bandFloor(MATERIALS[next].band-1)}
  else{const hb=skillBand(p.skill);o.can_make=RECIPES.filter(r=>r.prof===p.id&&r.band<=hb).map(r=>r.out.id);
    const next=RECIPES.filter(r=>r.prof===p.id&&r.band>hb).sort((x,y)=>x.band-y.band)[0];if(next)o.next=next.out.id+' at skill '+bandFloor(next.band)}
  return o})}
const nodeWord=k=>({herb:'herb patches',ore:'ore veins',hide:'game trails',fish:'fishing spots'})[k];

// The recipes tool: the caller's professions and skill, the recipes and materials of each (or of `prof`), and what is
// still learnable. Only the caller's own hero.
export function recipesView(a,prof){const held=professionsOf(a);
  const out={ok:true,professions:profLines(a),slots:held.length+'/'+MAX_PROF};
  const ids=prof?[prof]:held.map(p=>p.id);
  const one=id=>{const P=PROF[id],skill=skillOf(a,id),hb=skillBand(Math.max(1,skill)),have=hasProfession(a,id);
    if(P.kind==='gather'){const k=KIND_OF[id];return {profession:P.name,kind:'gathering',works:nodeWord(k),
      materials:matsOf(k).map(m=>({material:m,skill:bandFloor(MATERIALS[m].band)===1?'any':bandFloor(MATERIALS[m].band)+'+',
        you:have?(MATERIALS[m].band<=hb?'yes':MATERIALS[m].band===hb+1?'a stretch (about '+Math.round(GATHER.STRETCH*100)+'% a try)':'not yet'):'learn it first',
        sells_about:Math.round(MATERIALS[m].base)+'g',used_in:RECIPES.filter(r=>r.inputs.some(i=>i.id===m)).map(r=>r.out.id)}))}}
    return {profession:P.name,kind:'crafting',note:'craft {recipe} makes one in a friendly town (cooking and alchemy also at a camp fire).',
      recipes:RECIPES.filter(r=>r.prof===id).map(r=>({id:r.id,makes:r.out.id+(r.out.n>1?' x'+r.out.n:''),skill:bandFloor(r.band)===1?'any':bandFloor(r.band)+'+',
        needs:r.inputs.map(i=>i.id+' x'+i.n+' (you carry '+count(a,i.id)+')').join(', '),fee:r.gold+'g',
        you:have?(r.band<=hb?'within your skill':'needs skill '+bandFloor(r.band)):'learn it first'}))}};
  out.recipes=ids.map(one);
  const free=PROF_IDS.filter(id=>!hasProfession(a,id));
  if(held.length<MAX_PROF)out.learnable=free.map(id=>PROF[id].name+' ('+PROF[id].kind+'): '+PROF[id].blurb);
  else out.learnable='You hold '+MAX_PROF+' professions, the most anyone can. unlearn_profession one first to take up another (its skill is lost).';
  if(!held.length)out.hint='You hold no profession yet. learn_profession {id} at home in a friendly town: a gathering trade (herbalism, mining, skinning, fishing) works nodes out in the world with gather; a crafting trade turns materials into goods.';
  return out}

// Resolve a profession by id or name ("Herbalism", "herb", "mining"). null when nothing fits.
export function profKey(v){const s=String(v==null?'':v).toLowerCase().replace(/[^a-z]/g,'');if(!s)return null;
  if(PROF[s])return s;const byName=PROF_IDS.find(id=>PROF[id].name.toLowerCase().replace(/[^a-z]/g,'')===s);if(byName)return byName;
  if(PROF_OF[s])return PROF_OF[s];
  const alias={herbs:'herbalism',herbalist:'herbalism',miner:'mining',ore:'mining',skinner:'skinning',hide:'skinning',hides:'skinning',fish:'fishing',fisher:'fishing',angling:'fishing',
    alchemist:'alchemy',smith:'smithing',blacksmith:'smithing',blacksmithing:'smithing',leather:'leatherworking',cook:'cooking',scribe:'scribing',scroll:'scribing'};
  if(alias[s])return alias[s];
  return PROF_IDS.find(id=>id.startsWith(s)&&s.length>=4)||null}

// learn_profession, game side. inTown: whether the hero stands in a friendly town (a trainer is there).
export function learnProfession(a,v,{inTown}={}){const id=profKey(v);
  if(!id)return {ok:false,why:'There is no profession called "'+String(v==null?'':v).slice(0,40)+'". Professions: '+PROF_IDS.map(i=>PROF[i].name+' ('+i+', '+PROF[i].kind+')').join(', ')+'.'};
  const c=canLearn(a,id);
  if(!c.ok){if(hasProfession(a,id))return {ok:false,why:'You already know '+PROF[id].name+' (skill '+skillOf(a,id)+'). It rises as you use it.'};
    const held=professionsOf(a);
    if(held.length>=MAX_PROF)return {ok:false,why:'You already hold '+MAX_PROF+' professions ('+held.map(p=>p.name+' '+p.skill).join(', ')+'); nobody holds more. To take up '+PROF[id].name+', unlearn_profession one of them first (its skill is lost for good).'};
    return {ok:false,why:c.why}}
  if(!inTown)return {ok:false,why:'Trainers teach in town: go home (move_to "home") or to a friendly town and learn '+PROF[id].name+' there.'};
  learn(a,id);record(a,'Took up ',{t:PROF[id].name,c:'gd'},'.');
  const P=PROF[id];
  return {ok:true,learned:P.name,skill:1,slots:professionsOf(a).length+'/'+MAX_PROF,
    next:P.kind==='gather'?'Out in the world, nodes lists the '+nodeWord(KIND_OF[id])+' in sight; gather {node} works one. Your skill rises with each try.':'recipes shows what '+P.name+' makes and the materials it needs.'}}

export function unlearnProfession(a,v){const id=profKey(v);
  const held=professionsOf(a);
  if(!id||!hasProfession(a,id))return {ok:false,why:held.length?'You do not know '+(id?PROF[id].name:'"'+String(v==null?'':v).slice(0,40)+'"')+'. You hold: '+held.map(p=>p.name+' ('+p.id+')').join(', ')+'.':'You hold no profession.'};
  const sk=skillOf(a,id);a.profs=a.profs.filter(p=>p.id!==id);if(a.gathering)a.gathering=null;
  record(a,'Gave up ',{t:PROF[id].name,c:'gd'},' (skill '+sk+').');
  return {ok:true,unlearned:PROF[id].name,lost_skill:sk,slots:professionsOf(a).length+'/'+MAX_PROF}}

// Nodes in sight (r tiles), nearest first, as the hero sees them. kind filters (herb, ore, hide, fish).
export function nodesView(a,r,kind){const L=nodeNear(a.x,a.y,r,kind);
  return L.slice(0,12).map(n=>{const c=canGather(a,n),t=readyAt(n),o={node:n.id,what:n.name,tiles:Math.round(dist(a,n)*10)/10,dir:compass(n.x-a.x,n.y-a.y)};
    o.state=t?'spent (grows back in about '+Math.max(1,Math.round(t-S.gameMin))+' game min)':'ready';
    const prof=PROF_OF[n.kind];
    o.you=c.ok?'you can work it ('+c.mat+', '+(c.chance>=.7?'a sure hand':c.chance>=.5?'likely':'a stretch')+')':!hasProfession(a,prof)?'needs '+PROF[prof].name:t?'wait for it':c.why;
    return o})}
const COMPASS=['east','southeast','south','southwest','west','northwest','north','northeast'];
const compass=(dx,dy)=>Math.hypot(dx,dy)<1.5?'here':COMPASS[((Math.round(Math.atan2(dy,dx)/(Math.PI/4))%8)+8)%8];

// Which node a gather order means: a node id, a kind or name ("herb", "ore vein", "fishing spot"), or nothing (the
// nearest one the hero can work). r is the hero's sight. {node} or {why}.
export function pickNode(a,v,r){const s=String(v==null?'':v).trim().toLowerCase();
  const inView=nodeNear(a.x,a.y,r);
  if(s){const byId=nodeById(s)||nodeById(String(v).trim());
    if(byId){if(dist(a,byId)>r)return {why:'That gathering spot is out of sight ('+Math.round(dist(a,byId))+' tiles off, you see about '+Math.round(r)+'). Walk toward it first, or nodes lists what is in sight.'};return {node:byId}}
    const k=['herb','ore','hide','fish'].find(k=>s.includes(k)||s.includes(({herb:'patch',ore:'vein',hide:'trail',fish:'fishing'})[k])||PROF_OF[k]===profKey(s));
    if(!k)return {why:'"'+String(v).slice(0,40)+'" is not a gathering spot. Give a node id from nodes, or a kind: herb, ore, hide or fish.'};
    const L=inView.filter(n=>n.kind===k);
    if(!L.length)return {why:'No '+nodeWord(k)+' in sight (about '+Math.round(r)+' tiles).'+nearHint(a,inView)};
    return {node:L.find(n=>canGather(a,n).ok)||L[0]}}
  const mine=inView.filter(n=>canGather(a,n).ok);
  if(mine.length)return {node:mine[0]};
  if(!gatherProfs(a).length)return {why:'You know no gathering trade (herbalism, mining, skinning, fishing). learn_profession one in town first.'};
  return {why:'No spot in sight that you can work now.'+nearHint(a,inView)}}
const nearHint=(a,L)=>{if(!L.length)return ' No gathering spot of any kind is in sight; walk on and look again (nodes).';
  return ' In sight: '+L.slice(0,4).map(n=>n.name+' '+n.id+' ('+Math.round(dist(a,n))+' tiles, '+(isReady(n)?'ready':'spent')+')').join(', ')+'.'}
