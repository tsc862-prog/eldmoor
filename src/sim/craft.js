// Crafting (issue #258, epic #238): turning materials into goods. Owned by ai-designer. DOM-free.
// The recipe table is data/recipes.js (read only), the skill model sim/professions.js, the pack sim/inv.js.
//
// One craft (craftOne) for everyone: the recipe's materials leave the pack, its fee leaves the purse, the result goes into
// the pack through inv.js's add path, and the crafter's skill rises (more for a recipe at the top of its band). No dice:
// a crafter within the band always succeeds, so a craft is a choice, not a gamble. Gear is made for the crafter's class
// (or a companion's, agent tool `for`), named "<material> <slot noun>" like all gear and carries its maker
// (it.maker, src "Crafted by <name>"); every success names the maker in its text and the hero's Log.
//
// Where: in a friendly town every recipe (the town's workshops); at a camp fire that has settled to rest only cooking and
// alchemy (FIRE_PROFS: a meal over the coals, a draught in a pot), and not while the company's own Table scene (the fire's
// talk, a debrief) is under way. Nowhere else.
//
// Scripted heroes (townCraft, from the town visit in heroes.js sellAndShop, before selling): from CRAFT.LEARN_LVL a
// hero that holds a gathering trade takes up the crafting trade that uses it (PAIR), then crafts what it can afford
// and wants, buying the gathered materials it lacks at the auction house (never paying more than a quarter over what the
// shop asks for the same thing): potions up to CRAFT.WANT carried, a scroll from the level it would buy one, a meal eaten before taking
// the road (its buff), a pack, gear only when it beats what the hero wears. keepFor(a) tells the sale which materials to keep for the next visit.
// At camp (campCraft, sim/camp.js) a member whose agent is gone (reflexMay) cooks a meal and brews a draught at supper;
// agent members are told once, after the fire's talk, what they could make there (campCraftNote). Agents never craft by
// script or reflex (the always-agents rule): only the craft tool.
import {S} from './state.js';
import {RECIPES,RECIPE_BY_ID,recipesFor} from '../data/recipes.js';
import {PROF,MAX_PROF} from '../data/professions.js';
import {USES,CRAFT_GEAR,SLOT_NOUNS,INV,MATERIALS,price} from '../data/items.js';
import {CLS} from '../data/classes.js';
import {professionsOf,skillOf,hasProfession,learn,gainSkill,skillBand} from './professions.js';
import {invOf,room,count,take,addUse,addGood,addGear,isGear,useItem,countKind} from './inv.js';
import {makeItem} from './gear.js';
import {zoneFor} from '../world/map.js';
import {record} from './history.js';
import {log,gold} from './chronicle.js';
import {companyOf} from './company.js';
import {sceneOf} from './scenes.js';

export const CRAFT={
  LEARN_LVL:5,     // scripted: level at which a hero with a gathering trade takes up the crafting trade that uses it
  KEEP:20,         // scripted: gold a hero keeps after paying a fee
  WANT:2,          // scripted: potions and scrolls of one kind carried before it crafts more
  PER_VISIT:3,     // scripted: crafts in one town visit
  KEEP_X:3,        // scripted: units of a material kept for the next visit, as a multiple of a recipe's need
  OVER:1.25,       // scripted: a consumable is crafted only when its cost stays within this multiple of the shop price
  MAX_N:5,         // agent tool: crafts in one call
};
// The crafting trade that uses a gathering trade's materials (scripted choice; herbalists who read lean to scribing).
export const PAIR={herbalism:'alchemy',mining:'smithing',skinning:'leatherworking',fishing:'cooking'};
export const FIRE_PROFS=['cooking','alchemy'];
const BANDS=['Novice','Apprentice','Journeyman','Expert','Master'];
const floorOf=b=>b<=0?1:b>=4?100:b*25;
const stat=(k,n=1)=>{const s=S.craftStats||(S.craftStats={made:0,units:0,fees:0,learned:0,meals:0,camp:0,byProf:{}});s[k]=(s[k]||0)+n;return s};

// ---- recipes by name ----
const norm=s=>String(s==null?'':s).toLowerCase().replace(/[^a-z0-9]/g,'');
// A recipe by id ("meal-perch"), by what it makes ("Spit-Roast Perch") or by a part of either ("perch"). {r} or {why, list?}.
export function recipeKey(v){const s=norm(v);if(!s)return {why:'Which recipe? Give its id or what it makes (recipes lists yours).'};
  if(RECIPE_BY_ID[String(v).trim()])return {r:RECIPE_BY_ID[String(v).trim()]};
  const ex=RECIPES.find(r=>norm(r.id)===s||norm(r.out.id)===s);if(ex)return {r:ex};
  const L=RECIPES.filter(r=>norm(r.id).includes(s)||norm(r.out.id).includes(s));
  if(L.length===1)return {r:L[0]};
  if(L.length>1)return {why:'"'+String(v).slice(0,40)+'" fits several recipes: '+L.map(r=>r.id+' ('+r.out.id+')').join(', ')+'. Name one.'};
  return {why:'There is no recipe called "'+String(v).slice(0,40)+'". Recipes: '+RECIPES.map(r=>r.id+' ('+r.out.id+')').join(', ')+'.'}}

// ---- where a hero may craft ----
// 'town' (inTown: in a friendly town), 'camp' (at its company's fire, settled to rest) or null.
export function placeOf(a,inTown){if(inTown)return 'town';
  if(a&&a.state==='camp'){const C=companyOf(a),g=C&&C.camp;if(g&&g.phase==='rest'&&g.ids.includes(a.id))return 'camp'}
  return null}

// The class a piece of gear is made for: the crafter's, or a companion's (agent tool `for`: a companion's name or a class).
function classFor(a,v){if(v==null||String(v).trim()==='')return {cls:a.cls};const s=norm(v);
  const c=Object.keys(CLS).find(k=>norm(k)===s);if(c)return {cls:c};
  const C=companyOf(a),L=C?C.ids.map(id=>S.agents.find(x=>x.id===id)).filter(Boolean):[];
  const b=L.find(x=>norm(x.name)===s)||(a.party?a.party.mem.find(x=>norm(x.name)===s):null);
  return b?{cls:b.cls,who:b}:{why:'"'+String(v).slice(0,40)+'" is neither a companion of yours nor a class ('+Object.keys(CLS).join(', ')+').'}}

// Can this hero make this recipe here and now? {ok:true, d} or {ok:false, why, missing:[...]}: every lack named at once.
export function canCraft(a,r,{where,n=1}={}){if(!r)return {ok:false,why:'No such recipe.',missing:['recipe']};
  const P=PROF[r.prof],miss=[],why=[];
  if(!hasProfession(a,r.prof)){miss.push('profession');why.push(r.out.id+' is made with '+P.name+', which you do not know (learn_profession {id: "'+r.prof+'"} in town'+(professionsOf(a).length>=MAX_PROF?'; you hold two already, unlearn_profession one first':'')+')')}
  else{const sk=skillOf(a,r.prof),hb=skillBand(Math.max(1,sk));if(r.band>hb){miss.push('skill');why.push(r.out.id+' needs '+P.name+' '+floorOf(r.band)+' ('+BANDS[r.band]+'); you have '+sk)}}
  if(where==null){miss.push('place');why.push('You can craft only in a friendly town, or cook and brew at a camp fire')}
  else if(where==='camp'&&!FIRE_PROFS.includes(r.prof)){miss.push('place');why.push(P.name+' needs a workshop: craft '+r.out.id+' in a friendly town (at a camp fire you can only cook and brew)')}
  const lack=r.inputs.filter(i=>count(a,i.id)<i.n*n).map(i=>i.id+' x'+(i.n*n-count(a,i.id))+' (you carry '+count(a,i.id)+' of '+i.n*n+')');
  if(lack.length){miss.push('materials');why.push('Missing materials: '+lack.join(', '))}
  if((a.gold||0)<r.gold*n){miss.push('gold');why.push('The fee is '+r.gold*n+'g; you have '+(a.gold||0)+'g')}
  if(!lack.length&&!fitsOut(a,r)){miss.push('room');why.push('Your pack is full: sell or drop something to make room for '+r.out.id)}
  if(miss.length)return {ok:false,why:why.join('. ')+'.',missing:miss};
  return {ok:true,d:skillBand(Math.max(1,skillOf(a,r.prof)))-r.band}}
// The result fits: a free slot, a stack of it with room, or an input stack the craft empties.
function fitsOut(a,r){if(room(a)>0)return true;const L=invOf(a).list;
  if(r.out.kind==='use'&&L.some(e=>!isGear(e)&&e.kind==='use'&&e.id===r.out.id&&e.n+r.out.n<=INV.STACK))return true;
  return r.inputs.some(i=>L.some(e=>!isGear(e)&&e.kind==='good'&&e.id===i.id&&e.n<=i.n))}

// Gear from a pattern: the class noun of the slot, the pattern's material, its item level and quality; it names its maker.
function makeGear(a,r,cls){const P=CRAFT_GEAR[r.out.id],it=makeItem(cls,P.slot,P.ilvl,zoneFor(P.ilvl),{quality:P.quality,src:'Crafted by '+a.name});
  it.name=P.material+' '+(SLOT_NOUNS[cls]||SLOT_NOUNS.Warrior)[P.slot];it.maker=a.name;it.makerId=a.id;return it}

// One craft. Assumes canCraft passed. by: 'agent' | 'script' | 'camp'. Returns {ok, text, item?, made, skill, up}.
export function craftOne(a,r,{by='script',cls,where}={}){const P=PROF[r.prof],sk0=skillOf(a,r.prof),d=skillBand(Math.max(1,sk0))-r.band;
  for(const i of r.inputs)take(a,'good',i.id,i.n);
  a.gold-=r.gold;
  let item=null,made=r.out.id+(r.out.n>1?' x'+r.out.n:'');
  if(r.out.kind==='gear'){item=makeGear(a,r,cls||a.cls);addGear(a,item);made=item.name+(item.cls&&item.cls!==a.cls?' (for a '+item.cls+')':'')}
  else addUse(a,r.out.id,r.out.n);
  const g=gainSkill(a,r.prof,d<=0?2:d===1?1:.25),was=BANDS[skillBand(Math.max(1,sk0))],now=BANDS[skillBand(Math.max(1,g.skill))];
  const st=stat('made');st.units+=r.out.n;st.fees+=r.gold;st.byProf[r.prof]=(st.byProf[r.prof]||0)+1;if(by==='camp')st.camp++;
  record(a,'Made ',{t:made,c:'gd'},where==='camp'?' at the camp fire':'',' ('+P.name+' '+g.skill+').');
  let text=a.name+' made '+made+(where==='camp'?' at the camp fire':'')+' ('+P.name+' '+g.skill+(g.up?', up':'')+'; fee '+r.gold+'g).';
  if(now!==was){const an=/^[AEIOU]/.test(now)?'an ':'a ';text+=' '+a.name+' is now '+an+now+' in '+P.name+'.';record(a,'Became '+an+now+' in '+P.name+'.');
    if(now==='Master'||by==='agent')log(a,' is now ',gold(an+now+' in '+P.name),'.')}
  if(item&&item.quality==='rare')log(a,' crafts ',gold(item.name),'.');
  return {ok:true,text,item,made,skill:g.skill,up:g.up}}

// ---- meals ----
// A camp meal's buff: a.meal {id, stat, v, until (game minute)}; sim/stats.js reads it while it holds.
export const mealOn=a=>{const m=a&&a.meal;return m&&m.until>S.gameMin?m:null};

// ---- agent tool ----
// craft {recipe, count?, for?}: inTown tells whether the hero stands in a friendly town (sim/player.js knows).
export function craftTool(a,{recipe,count:n,for:forWho}={},{inTown}={}){const k=recipeKey(recipe);if(!k.r)return {ok:false,why:k.why};const r=k.r;
  const where=placeOf(a,inTown);
  if(where==='camp'&&sceneOf(a))return {ok:false,why:'Not while the company sits at the table (the fire\'s talk or a scene is under way): craft when it ends.'};
  n=Math.max(1,Math.min(CRAFT.MAX_N,Math.round(Number(n))||1));
  let cls=a.cls;if(r.out.kind==='gear'){const c=classFor(a,forWho);if(!c.cls)return {ok:false,why:c.why};cls=c.cls}
  const c=canCraft(a,r,{where,n});if(!c.ok)return {ok:false,why:c.why,missing:c.missing};
  const out=[];for(let i=0;i<n;i++){if(i&&!canCraft(a,r,{where}).ok)break;out.push(craftOne(a,r,{by:'agent',cls,where}))}
  const last=out[out.length-1],res={ok:true,result:out.length>1?a.name+' made '+out.length+' times: '+out.map(o=>o.made).join(', ')+' ('+PROF[r.prof].name+' '+last.skill+').':last.text,
    maker:a.name,skill:last.skill,gold:a.gold};
  if(r.out.kind==='gear')res.note='It is in your pack: equip it (inventory gives the index)'+(cls!==a.cls?', or give it to the companion it was made for':'')+'.';
  else if(USES[r.out.id]&&USES[r.out.id].buff)res.note='Eat it with use_item: it mends a little and gives +'+Math.round(USES[r.out.id].buff.v*100)+'% '+USES[r.out.id].buff.stat+' for '+USES[r.out.id].buff.mins+' game minutes.';
  return res}

// ---- scripted heroes ----
// A scripted hero with a gathering trade takes up the crafting trade that uses it; true when it learned. No RNG.
export function ensureCraft(a){if(a.player||a.lvl<CRAFT.LEARN_LVL)return false;const P=professionsOf(a);
  if(P.length>=MAX_PROF||P.some(p=>p.kind==='craft'))return false;const g=P.find(p=>p.kind==='gather');if(!g)return false;
  const id=g.id==='herbalism'&&(a.cls==='Mage'||a.cls==='Priest')&&a.id%2?'scribing':PAIR[g.id];
  if(!id||!learn(a,id).ok)return false;record(a,'Took up ',{t:PROF[id].name,c:'gd'},'.');stat('learned');return true}
const craftProfs=a=>professionsOf(a).filter(p=>p.kind==='craft');
// Scrolls a scripted crafter makes only from the level it would buy them (sim/inv.js restock), so crafting adds no early escapes.
const SCROLL_LVL={'Scroll of Hearthward':8,'Scroll of the Steadfast Hour':10};
// Would this scripted hero want one more of the recipe's result?
function wants(a,r){if(r.out.kind==='gear'){const P=CRAFT_GEAR[r.out.id],cur=a.slots&&a.slots[P.slot];
    return !!a.slots&&P.ilvl<=a.lvl+INV.WEAR_OVER&&!(cur&&(cur.epic||cur.ilvl>=P.ilvl))}
  const U=USES[r.out.id];if(!U)return false;
  if(U.kind==='ration')return !!U.buff&&!count(a,r.out.id)&&!mealOn(a);
  if(U.kind==='potion')return U.lvl<=a.lvl+2&&count(a,r.out.id)<CRAFT.WANT;
  if(U.kind==='scroll')return a.lvl>=(SCROLL_LVL[r.out.id]||U.lvl)&&!count(a,r.out.id);
  if(U.kind==='pack')return !invOf(a).pack&&!count(a,r.out.id);
  return false}
// What a craft costs a scripted hero in town: the fee plus the gathered materials it lacks, bought at the auction house
// (MATERIALS only; trade goods must be carried). null when a trade good is missing.
function costOf(a,r){let total=r.gold;const buy=[];
  for(const i of r.inputs){const lack=i.n-count(a,i.id);if(lack<=0)continue;if(!MATERIALS[i.id])return null;total+=lack*price(i.id);buy.push([i.id,lack])}
  return {total,buy}}
function buyMats(a,c){for(const [id,n] of c.buy){let got=0;for(let k=0;k<n;k++){const p=price(id);if(a.gold<p||!addGood(a,id,1))break;a.gold-=p;MATERIALS[id].supply=Math.max(0,MATERIALS[id].supply-1);got++;const st=stat('bought');st.boughtGold=(st.boughtGold||0)+p}
    if(got<n)return false}
  return true}
// In town, before the sale: craft what it wants and can afford (buying missing materials, never more than CRAFT.OVER times
// the shop price for the same thing), best band first; then eat a fresh meal and strap on a crafted pack.
export function townCraft(a){if(a.player)return 0;ensureCraft(a);let k=0;
  for(const p of craftProfs(a)){const L=recipesFor(p.id,skillBand(Math.max(1,p.skill))).slice().sort((x,y)=>y.band-x.band);
    for(const r of L){while(k<CRAFT.PER_VISIT&&wants(a,r)){const c=costOf(a,r);if(!c||a.gold-c.total<CRAFT.KEEP)break;
        if(r.out.kind==='use'&&c.total>USES[r.out.id].price*r.out.n*CRAFT.OVER)break;
        if(!buyMats(a,c)||!canCraft(a,r,{where:'town'}).ok)break;
        craftOne(a,r,{by:'script',where:'town'});k++}}}
  if(k){for(const id of Object.keys(USES))if(USES[id].buff&&count(a,id)&&!mealOn(a)&&useItem(a,id).ok)stat('meals');
    if(count(a,"Wayfarer's Pack")&&!invOf(a).pack)useItem(a,"Wayfarer's Pack")}
  return k}
// Materials a scripted crafter keeps from the sale: units per id (KEEP_X times what its recipes in band need).
export function keepFor(a){if(a.player)return null;const P=craftProfs(a);if(!P.length)return null;const o={};
  for(const p of P)for(const r of recipesFor(p.id,skillBand(Math.max(1,p.skill))))for(const i of r.inputs)o[i.id]=Math.max(o[i.id]||0,i.n*CRAFT.KEEP_X);
  return o}

// ---- at camp ----
// Supper (sim/camp.js, when the camp settles to rest): a member played by reflex cooks a meal and brews a draught if it can.
export function campCraft(a){if(!a||a.state!=='camp')return 0;let k=0;
  for(const p of craftProfs(a)){if(!FIRE_PROFS.includes(p.id))continue;
    const L=recipesFor(p.id,skillBand(Math.max(1,p.skill))).slice().sort((x,y)=>y.band-x.band);
    for(const r of L){const U=USES[r.out.id];if(!U)continue;const want=U.kind==='ration'?!count(a,r.out.id):U.kind==='potion'&&countKind(a,'potion')<CRAFT.WANT+1;
      if(want&&canCraft(a,r,{where:'camp'}).ok){craftOne(a,r,{by:'camp',where:'camp'});k++;break}}}
  return k}
// What an agent member could make at this fire now (recipe ids with what they make), for the one note a camp.
export function fireRecipes(a){const o=[];for(const p of craftProfs(a)){if(!FIRE_PROFS.includes(p.id))continue;
  for(const r of recipesFor(p.id,skillBand(Math.max(1,p.skill))))if(canCraft(a,r,{where:'camp'}).ok)o.push(r.id+' ('+r.out.id+')')}
  return o}
