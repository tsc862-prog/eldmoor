// Table combat rounds (issue #276, part 1 of #140). DOM-free. Owned by ai-designer.
// In the combat kinds of Table mode (elite, ambush, boss, rescue) the foe takes a turn too: it joins the
// initiative order by the same Reflex rule as the members (ties by id), and every blow, a member's or a
// foe's, is a d20 attack roll against 10 + Defense (the crawl's convention: Defense x 20 for a hero,
// the creature's guard x 20 for a beast), shown in the scene beats and folded into the scene's one DM log
// entry (a sentence a round). A hit does its damage through the real-time path (heroes.js strike for a hero, mobs.js mobBlow
// for a creature, Kragmaw's own claw and breath), so the stat model is the same in rounds as in real time.
// A foe's act is scripted: strike the member who drew it (guard, a taunt), else the lowest-HP member in
// reach; a beast that runs from a fight runs here too, a duellist yields where it would in a duel, and
// Kragmaw keeps its scripted blows (one claw a round at a random raider, the breath on its own timer).
// table.js drives the rounds; this file only knows the dice and the foe's act. Rolls use the gameplay RNG
// in initiative order, so a seeded scene plays the same whatever order the answers come in.
import {ri,rnd,pickA} from '../core/rng.js';
import {dist} from '../world/map.js';
import {BOSSES} from '../data/bosses.js';
import {MOBS} from '../data/mobs.js';
import {tm} from '../data/traits.js';
import {S} from './state.js';
import {strike,maxHp,agentDie,goHome} from './heroes.js';
import {combatStats,dmgTaken} from './stats.js';
import {score,mod,check,socialSkill} from './abilities.js';
import {profBonus} from '../data/abilities.js';
import {CONDITIONS,FX_CONDS} from '../data/moves.js';
import {ABILITIES as TRICKS} from '../data/bestiary.js';
import {setCond,condOn,endCond} from './eff.js';
import {blk,mobBlow} from './mobs.js';
import {actHurt,actItem} from './actlog.js';
import {dmlog} from './dmlog.js';
import {USES} from '../data/items.js';
import {invOf,useItem,venomOn,take} from './inv.js';
import {isDown,downHit,finisher} from './downed.js'; // a foe and the downed (#654)

export const TR={
  ROUNDS:3,   // rounds of an honour duel (challenge.js) at most; a fight at the table plays until it is decided (#875)
  ROUNDS_MAX:12,       // hard cap on a combat scene's rounds, a guard against loops; then the fight goes on in the world (HP and cooldowns carry over)
  BOSS_ROUNDS_MAX:16,  // Kragmaw's own cap
  STALL:3,             // rounds in a row with no HP change on either side close the scene
  HIT:3,      // attack bonus: d20 + HIT + level/2 (crawl.js FOE_HIT) against 10 + Defense x 20
  REACH:9,    // tiles from the foe within which a member is in the fight (a strike from farther only closes in)
  YIELD:.3,   // a duellist yields below this share of its max HP, times its flee trait (pvp duel rule)
};
const name=f=>f.kind==='boss'?f.name:f.kind==='hero'?f.name:f.elite||f.named?f.name:MOBS[f.type]?MOBS[f.type].name:'the foe';
export const foeName=name;
const lvlOf=x=>x.kind==='boss'?(BOSSES[x.tpl||'kragmaw']||{}).lvl||x.lvl||20:x.lvl||1;

// ---- the dice ----
// Defense as a number to roll against: 10 + Defense x 20 (a hero's combatStats, a creature's guard; Kragmaw none).
export const acOf=t=>10+Math.round((t.kind==='hero'?combatStats(t).defense:t.kind==='mob'?(blk(t).guard||0):0)*20);
export const hitOf=x=>TR.HIT+Math.floor(lvlOf(x)/2);
// Initiative: a hero's Reflex score with gear; a creature's from its swing (quick biters early, brutes late); Kragmaw 10.
export function reflexOf(x){if(x.kind==='hero')return score(x,'reflex')||10;if(x.kind==='boss')return 10;
  return 10+Math.round((1.3-(blk(x).cd||1.3))*5)+(x.elite||x.named?1:0)}
// Where the foe stands in the order: the number of members (already in initiative order) who go before it.
export function foeSlot(L,f){if(!f)return L.length;const fr=reflexOf(f);let n=0;
  for(const a of L){const ar=score(a,'reflex')||10;if(ar>fr||(ar===fr&&a.id<f.id))n++}return n}
export function roll(att,t,adj=0){const d=ri(1,20),b=hitOf(att)+adj,ac=acOf(t);return {d,b,ac,hit:d===20||(d!==1&&d+b>=ac),crit:d===20}}
// The roll as data for the watcher's banner (#285): {die, mod, total, vs, hit, crit, dmg, target, down}; the beat's res text
// keeps the same roll in words for logs and agents.
export const rollData=(R,dmg,target,down)=>({die:R.d,mod:R.b,total:R.d+R.b,vs:R.ac,hit:R.hit,crit:R.crit,dmg:dmg||0,target,down:!!down});
export const rollText=R=>'d20 '+R.d+sg(R.b)+'='+(R.d+R.b)+' vs AC '+R.ac+(R.crit?' (a natural 20)':R.d===1?' (a natural 1)':'');
const sg=n=>(n<0?'':'+')+n;
// One line of the round's DM log entry.
function note(sc,by,at,R,dmg,extra){(sc.rl||(sc.rl=[])).push({rd:sc.rd||1,by,at,d20:R?R.d:null,bonus:R?R.b:null,ac:R?R.ac:null,hit:R?R.hit:true,dmg:dmg||0,...(extra?{note:extra}:{})})}
// Parley and condition saves (#296) keep their die as `die` (not d20, which is an attack roll against AC).
const lineOf=r=>r.kind==='death'?r.by+' fights for breath (death save d20 '+r.die+' vs DC '+r.dc+'): '+r.note:r.kind==='use'?r.by+' uses '+r.item+(r.at!==r.by?' on '+r.at:'')+(r.note?' ('+r.note+')':''):r.kind==='parley'?r.by+' parleys with '+r.at+' ('+r.skill+' d20 '+r.die+sg(r.mod)+' vs DC '+r.dc+'): '+r.note
  :r.kind==='save'?r.by+', '+r.note+' (save d20 '+r.die+sg(r.mod)+' vs DC '+r.dc+(r.pass?': it ends':': it holds')+')'
  :r.kind==='poison'?r.by+' takes '+r.dmg+' from the poison'+(r.note?' ('+r.note+')':''):r.by+(r.d20==null?' '+(r.note||'acts')+' on '+r.at:' at '+r.at+': d20 '+r.d20+'+'+r.bonus+' vs AC '+r.ac+(r.hit?', '+r.dmg+' damage':', miss'))+(r.d20!=null&&r.note?' ('+r.note+')':'');
// Fold the scene's rolls into one DM log entry, a sentence per round (kind 'table': not an adventure roll, so it opens no
// check scene; one entry a scene keeps the capped DM log readable).
export function flushRolls(sc){const L=sc.rl;if(!L||!L.length)return;sc.rl=[];const rs=[...new Set(L.map(r=>r.rd))];
  dmlog('table',null,[sc.title+': '+rs.map(n=>'round '+n+': '+L.filter(r=>r.rd===n).map(lineOf).join('; ')).join('. ')+'.'],{scene:sc.id,kind:sc.kind,rounds:sc.rd||1,...(sc.capped?{capped:sc.capped}:{}),sceneType:'fight',by:'scripted',rolls:L},{heroes:sc.ids.slice()})}

// ---- a member's strike, with its roll ----
// The structured roll waits on sc.rr until table.js take() puts it on the member's beat (beat.roll).
export function memberStrike(sc,a,f){const R=roll(a,f);
  if(!R.hit){note(sc,a.name,name(f),R,0);sc.rr=rollData(R,0,name(f));return rollText(R)+': missed'}
  const h=f.hp,o=R.crit?{crit:1}:undefined;strike(a,f,o);const dmg=Math.max(0,Math.round(h-f.hp)),down=f.kind==='boss'?!f.alive:f.kind==='hero'?f.state==='dead':!f.alive;
  note(sc,a.name,name(f),R,dmg,down?'down':null);sc.rr=rollData(R,dmg,name(f),down);return rollText(R)+': hit for '+dmg+(down?', and it falls':'')}

// ---- an item from the pack as the round's act (#360) ----
// A consumable (data/items USES, not craft, not a quest item) that does something right now: a potion when someone is hurt
// (yourself first, else the hurt companion the table names), an antidote when you are poisoned (a creature's venom or the
// round's poison condition), a warding scroll while no ward holds, a recall scroll when you can still get away (not rooted).
// Bandages, rations, torches and the pack do nothing in a fight, so they are never offered. The act goes through inv.js
// useItem (one unit taken, the action log's item line); no dice. Option keys are 'use:<item slug>'.
const RECALL_FROM=['fight','hunt','travel','follow','duel','assist']; // the states inv.js useItem reads a recall scroll in
export const useSlug=id=>String(id).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const hurt=b=>!!b&&b.state!=='dead'&&b.hp<maxHp(b);
// Whom the item would go to now (undefined: nothing to use it on). lo: the hurt companion the table would tend.
function useOn(sc,a,id,lo){const U=USES[id];if(!U||U.craft)return undefined;
  if(U.kind==='potion')return hurt(a)?a:hurt(lo)&&a.party&&lo.party===a.party?lo:undefined; // a companion only in the same party (inv.js useItem's rule)
  if(U.kind==='antidote')return venomOn(a)||condOn(a,'poison')?a:undefined;
  if(U.kind==='scroll'){if(U.effect==='recall')return RECALL_FROM.includes(a.state)&&!(sc.rd!=null&&condOn(a,'root'))?a:undefined;return a.wardT>0?undefined:a}
  return undefined}
const pctOf=b=>Math.round(b.hp/maxHp(b)*100);
function useText(a,id,on){const U=USES[id];
  if(U.kind==='potion')return 'Use '+id+' on '+(on===a?'yourself':on.name)+' ('+pctOf(on)+'%; heals '+Math.round(U.heal*100)+'%)';
  if(U.kind==='antidote')return 'Use '+id+': draw the poison out';
  if(U.effect==='recall')return 'Read '+id+': pulled home to your gate, out of the fight';
  return 'Read '+id+': blows land '+Math.round((U.ward||0)*100)+'% softer on you a while'}
// The legal 'use' options for a member, one per consumable it carries that would do something (pack order).
export function useOptions(sc,a,lo){const out=[],seen=new Set();if(!a||!a.inv)return out;
  for(const e of invOf(a).list){if(e.kind!=='use'||!(e.n>0)||seen.has(e.id))continue;seen.add(e.id);const on=useOn(sc,a,e.id,lo);if(!on)continue;
    out.push({k:'use:'+useSlug(e.id),text:useText(a,e.id,on)})}
  return out}
// The item an option key names, if the member still carries it.
export const useItemOf=(a,k)=>{if(!a||!a.inv||!String(k).startsWith('use:'))return null;const s=String(k).slice(4);
  for(const e of invOf(a).list)if(e.kind==='use'&&e.n>0&&useSlug(e.id)===s)return e.id;return null};
// The round's line in the DM log entry and the item as data on the beat (sc.ru until table.js take() moves it on).
export function useNote(sc,a,id,on,res){const txt=res.ok?res.text:res.error;sc.ru={item:id,on:on.name,ok:!!res.ok,effect:txt,...(res.healed?{healed:res.healed}:{})};
  if(sc.rd!=null&&res.ok)(sc.rl||(sc.rl=[])).push({rd:sc.rd||1,by:a.name,at:on.name,kind:'use',item:id,note:res.healed?'+'+res.healed+' health':USES[id].kind==='antidote'?'the poison drawn':USES[id].effect==='recall'?'pulled home':'warded'})}
// Use it: one unit from the pack. Returns the beat's result text.
export function useInRound(sc,a,k,lo){const id=useItemOf(a,k);if(!id)return 'nothing left to use';const on=useOn(sc,a,id,lo);if(!on)return 'no need for the '+id+' now';
  const U=USES[id];let res;
  if(U.kind==='antidote'&&!venomOn(a)){endCond(a,'poison');take(a,'use',id,1);actItem(a,id,a);res={ok:true,text:'Drew the poison out with '+id+'.'}} // the round's poison condition only: no venom on a creature to cure
  else{if(U.kind==='antidote'&&condOn(a,'poison'))endCond(a,'poison');res=useItem(a,id,on,{table:true});
    if(res.ok&&U.effect==='recall'&&sc.rd!=null)(sc.out||(sc.out=[])).push(a.id)} // read out of the fight: it leaves the rounds like a retreat
  useNote(sc,a,id,on,res);return res.ok?res.text:res.error}

// ---- the foe's turn ----
// fs: the foes acting (a staged pack acts together at its leader's place in the order); L: the members in the fight.
// Returns beats ({id:'foe', name, k, text, res, by:'foe', roll?}) and sets sc.end ('fled', 'yield') when the foe breaks off.
export function foeTurn(sc,fs,L){const out=[];
  for(const f of fs){if(!f)continue;const nm=name(f);
    if(condOn(f,'stun')){const b=stunCheck(sc,f,nm);out.push(b);if(b.k==='stunned')continue} // a stun is checked on its holder's turn (#296)
    if(f.kind==='hero'&&f.state!=='dead'&&f.hp<maxHp(f)*TR.YIELD*tm(f,'flee')){yieldHero(f,L);sc.end='yield';out.push(beat(nm,'yield','Yields and breaks off',null));note(sc,nm,'the fight',null,0,'yields');break}
    if(f.kind==='mob'&&fs.length===1&&!f.elite&&!f.fledOnce&&!condOn(f,'root')&&(blk(f).beh||{}).flee&&f.hp<f.maxhp*blk(f).beh.flee){f.fledOnce=true;f.fled=2.5;sc.end='fled';out.push(beat(nm,'flee','Breaks away and runs',null));note(sc,nm,'the fight',null,0,'flees');break} // a rooted beast cannot run
    const live=L.filter(b=>b.state!=='dead'&&b.hp>0);
    {const dt=downTarget(f,L,live);if(dt){out.push(downBlow(sc,f,dt,nm));continue}} // #654: a finisher, or nobody else standing
    if(!live.length)break;
    if(f.kind==='boss'){out.push(...bossTurn(sc,f,live));continue}
    const t=targetOf(f,live),rooted=condOn(f,'root'),R=roll(f,t,rooted?-COND.ROOT_HIT:0),wd=condOn(t,'ward')?' (warded)':'';let res,rd;
    if(!R.hit){res=rollText(R)+': missed'+(rooted?' (rooted)':'');note(sc,nm,t.name,R,0);rd=rollData(R,0,t.name)}
    else{const dmg=f.kind==='hero'?heroBlow(f,t,R.crit):mobBlow(f,t,R.crit?1.5:1);const down=t.state==='dead';
      res=rollText(R)+': hit for '+dmg+wd+(down?'; '+t.name+' falls':isDown(t)?'; '+t.name+' goes down':'');note(sc,nm,t.name,R,dmg,down?'down':wd?'warded':null);rd=rollData(R,dmg,t.name,down);if(down)(sc.fell||(sc.fell=[])).push(t.id)
      else{const c=trickCond(sc,f,t,dmg);if(c)res+='; '+c}}
    out.push(beat(nm,'attack','Strikes at '+t.name+(f.target===t?' (drawn)':''),res,rd))}
  return out}
// A creature and the downed (#654, sim/downed.js rules): it strikes one who lies down only when it finishes (beh.finishes) and its
// prey is down, or when nobody else in the fight stands. The roll is the usual one; a hit is a failed death save (a 20 two).
function downTarget(f,L,live){if(f.kind!=='mob')return null;if(isDown(f.target)&&L.includes(f.target)&&finisher(f))return f.target;
  if(live.length)return null;let t=null;for(const b of L)if(isDown(b)&&(!t||b.id<t.id))t=b;return t}
function downBlow(sc,f,t,nm){const R=roll(f,t);note(sc,nm,t.name,R,0,R.hit?'on the downed':null);
  if(R.hit)downHit(t,f,R.crit);const dead=t.state==='dead';if(dead)(sc.fell||(sc.fell=[])).push(t.id);
  return beat(nm,'attack','Strikes at '+t.name+' where they lie',rollText(R)+(R.hit?': '+(R.crit?'two failed saves':'a failed save')+(dead?'; '+t.name+' dies':''):': missed'),rollData(R,0,t.name,dead))}
const beat=(nm,k,text,res,roll)=>({id:'foe',name:nm,k,text,res,by:'foe',...(roll?{roll}:{})});

// ---- conditions (#296): stunned, rooted, poisoned, warded ----
// Laid by a member's control move (sim/moves.js, on a failed save) or by a creature's own trick when its blow lands
// (data/moves.js FX_CONDS over the bestiary's abilities: venom poisons, a web or a mire roots, a bellow or a gore
// stuns), at most once every COND.TRICK_GAP rounds per creature, with a save to shrug it off. Each is checked as a
// dice line: a stun on the holder's turn (fail: the turn is lost), a root and a poison at the end of every round
// (poison bites first; pass: it ends early), and every condition runs out with its rounds. Warded is the ward moves'
// round-counted 'taken' effect: no save, the banner badges it and a blow on it says so. table.js clears every
// condition when the scene ends, so none leaks into the real-time fight.
export const COND={
  ROOT_HIT:2,     // a rooted creature's attack roll is this much worse (it cannot step in)
  TRICK_GAP:2,    // rounds between one creature's condition tricks in a scene
  POISON:.35,     // a creature's poison bites for this share of the blow that laid it, each round (at most 20% of max HP)
};
const condName=id=>CONDITIONS[id].name.toLowerCase();
// Saves and parleys are checks, not attack rolls: their data rides on beat.check ({kind:'save'|'parley', die, mod, total, vs,
// hit (passed), crit, ...}), beat.roll stays the attack roll against AC (#285).
// A save: d20 + the holder's modifier (a hero: the condition's ability + training; a creature: a quarter of its level,
// +2 elite, +4 Kragmaw, as sim/moves.js foeSave) against the DC it was laid with. A 20 always saves, a 1 never.
const saveMod=(e,abil)=>e.kind==='hero'?mod(e,abil)+profBonus(e.lvl||1):Math.floor((e.lvl||1)/4)+(e.elite?2:0)+(e.kind==='boss'?4:0);
function condSave(e,id){const f=e.eff[id],d=ri(1,20),m=saveMod(e,CONDITIONS[id].save||'grit'),dc=f.dc||10;return {die:d,mod:m,total:d+m,dc,pass:d===20||(d!==1&&d+m>=dc),crit:d===20}}
const saveText=V=>'save d20 '+V.die+sg(V.mod)+'='+V.total+' vs DC '+V.dc;
const saveData=(V,id,who)=>({kind:'save',cond:id,die:V.die,mod:V.mod,total:V.total,vs:V.dc,hit:V.pass,crit:V.crit,dmg:0,target:who,down:false});
const saveNote=(sc,by,id,V,what)=>(sc.rl||(sc.rl=[])).push({rd:sc.rd||1,by,at:by,kind:'save',cond:id,die:V.die,mod:V.mod,dc:V.dc,pass:V.pass,note:what});
// The stunned one's turn: the save, then the stun is spent either way. Returns the beat ({k:'stunned'} = the turn is lost).
export function stunCheck(sc,e,nm){const V=condSave(e,'stun');endCond(e,'stun');const who=nm||e.name;
  saveNote(sc,who,'stun',V,V.pass?'shakes off the stun':'stunned, loses the turn');
  return {id:e.kind==='hero'?e.id:'foe',name:who,k:V.pass?'unstun':'stunned',text:V.pass?'Shakes off the stun':'Stunned: loses the turn',res:saveText(V)+(V.pass?': shaken off':': held'),by:e.kind==='hero'?'cond':'foe',check:saveData(V,'stun',who)}}
// A creature's trick when its blow lands: the first condition its abilities can leave, the target's save to shrug it off.
function trickCond(sc,f,t,dmg){if(f.kind!=='mob'||t.state==='dead')return null;const g=sc.cg||(sc.cg={});if(g[f.id]!=null&&sc.rd-g[f.id]<COND.TRICK_GAP)return null;
  let id=null,ab=null;for(const k of f.ab||[]){const A=TRICKS[k];if(A&&FX_CONDS[A.fx]&&!condOn(t,FX_CONDS[A.fx])){id=FX_CONDS[A.fx];ab=A;break}}if(!id)return null;g[f.id]=sc.rd;
  const dc=10+Math.floor((f.lvl||1)/2)+(f.elite||f.named?2:0);setCond(t,id,CONDITIONS[id].rounds,dc,id==='poison'?Math.max(1,Math.round(dmg*COND.POISON)):0,f.id);
  const V=condSave(t,id);saveNote(sc,t.name,id,V,ab.name+': '+(V.pass?'shrugs it off':condName(id)));
  if(V.pass){endCond(t,id);return t.name+' shrugs off its '+ab.name+' ('+saveText(V)+')'}
  return ab.txt+' '+t.name+': '+condName(id)+' ('+saveText(V)+')'}
// The end of a round: poison bites, then rooted and poisoned holders save to end it; what is left runs down a round.
// Returns beats (by 'cond': not a member's act). A hero the poison kills falls to whoever laid it.
export function roundEnd(sc,L,fs){const out=[];
  for(const e of [...L,...fs]){if(!e||(e.kind==='hero'?e.state==='dead'||isDown(e):!e.alive))continue;const nm=e.kind==='hero'?e.name:name(e),me=e.kind==='hero'?e.id:'foe';
    if(condOn(e,'poison')){const P=e.eff.poison,src=P.by!=null?(S.mobs.find(m=>m.id===P.by)||S.agents.find(x=>x.id===P.by)||null):null,mx=e.kind==='hero'?maxHp(e):e.maxhp||1;
      const d=Math.max(1,Math.min(P.v||1,Math.round(mx*.2)));e.hp-=d;if(e.hp<=0&&!src)e.hp=1;if(e.kind==='hero'&&src)actHurt(e,src,d,'venom');const down=e.hp<=0;
      if(down&&e.kind==='hero'){agentDie(e,src);if(e.state==='dead')(sc.fell||(sc.fell=[])).push(e.id)}
      (sc.rl||(sc.rl=[])).push({rd:sc.rd||1,by:nm,at:nm,kind:'poison',dmg:d,note:down?'down':null});
      out.push({id:me,name:nm,k:'poison',text:'The poison bites',res:d+' damage'+(down?'; '+nm+' falls':''),by:'cond'});if(down)continue}
    for(const id of ['poison','root']){if(!condOn(e,id))continue;const V=condSave(e,id);
      if(V.pass)endCond(e,id);else if(--e.eff[id].r<=0)endCond(e,id);
      saveNote(sc,nm,id,V,id==='root'?(V.pass?'breaks free of the roots':'still rooted'):(V.pass?'purges the poison':'still poisoned'));
      out.push({id:me,name:nm,k:id,text:id==='root'?(V.pass?'Breaks free':'Still rooted'):(V.pass?'Purges the poison':'Still poisoned'),res:saveText(V)+(V.pass?': it ends':': it holds')+(!V.pass&&!condOn(e,id)?', then wears off':''),by:'cond',check:saveData(V,id,nm)})}}
  return out}

// ---- parley (#296): talk an intelligent foe down ----
// Who talks back: an enemy hero, and the creature families with speech (data/bestiary.js FAMILIES). Kragmaw never.
const TALKERS=['bandit','brute-folk'];
export const canParley=f=>!!f&&(f.kind==='hero'?f.state!=='dead':f.kind==='mob'&&f.alive&&TALKERS.includes(blk(f).family));
// The foe's temper as a DC: 12, +3 an elite or named one (+1 a leader), +2 a bold enemy hero, + its level over the
// speaker's (at most 5); -3 below half its health, -6 below a quarter; -1 with three in the fight, -2 with four or more.
export function temperOf(f,a,n){const hf=f.hp/(f.kind==='hero'?maxHp(f):f.maxhp||1);let dc=12;
  if(f.kind==='hero')dc+=tm(f,'bold')>1?2:0;else dc+=(f.elite||f.named?3:0)+(blk(f).role==='leader'?1:0);
  dc+=Math.max(0,Math.min(5,lvlOf(f)-(a.lvl||1)));dc-=hf<.25?6:hf<.5?3:0;dc-=n>=4?2:n>=3?1:0;return dc}
// A say-check through the staged social path's skills (persuasion or intimidation, sim/abilities.js socialSkill) against
// the temper. Yield: a 20 or 5 over, or any pass on a rooted foe that cannot run (it stands down for good); flee: a pass
// (it breaks away and runs, and may come back); hold: a fail (it fights on, and turns on the one who spoke).
export function parley(sc,a,fs,L){const f=fs[0],nm=name(f),skill=socialSkill(a),dc=temperOf(f,a,L.length),R=check(a,skill,dc,{nat:true});
  (sc.pl||(sc.pl=[])).push(a.id);
  const out=R.nat===20||(R.pass&&(R.total-dc>=5||condOn(f,'root')))?'yield':R.pass?'flee':'hold';
  if(out==='yield'){for(const g of fs)standDown(g,L);sc.end='yield';sc.talk=a.name}
  else if(out==='flee'){for(const g of fs)runOff(g,L);sc.end='fled';sc.talk=a.name}
  else if(f.kind==='mob'){f.target=a;f.dest=null}
  const word=out==='yield'?'it yields':out==='flee'?'it breaks away and runs':'it will not hear it';
  (sc.rl||(sc.rl=[])).push({rd:sc.rd||1,by:a.name,at:nm,kind:'parley',skill,die:R.d20,mod:R.mod,dc,pass:R.pass,result:out,note:word});
  sc.rc={kind:'parley',skill,result:out,die:R.d20,mod:R.mod,total:R.total,vs:dc,hit:R.pass,crit:R.d20===20,dmg:0,target:nm,down:false};
  return skill+' d20 '+R.d20+sg(R.mod)+'='+R.total+' vs DC '+dc+(R.nat===20?' (a natural 20)':R.nat===1?' (a natural 1)':'')+': '+word}
// Stands down: a creature goes home and leaves the party be for two game hours (mobs.js and findMob skip it); a hero yields.
function standDown(g,L){if(g.kind==='hero'){yieldHero(g,L);return}
  g.target=null;g.pack=false;g.dest=g.home?{...g.home}:null;g.spared=S.gameMin+120;for(const b of L)if(b.target===g&&b.state==='fight'){b.state='hunt';b.target=null}}
function runOff(g,L){if(g.kind==='hero'){yieldHero(g,L);return}g.fledOnce=true;g.fled=5}
// The member it has drawn (guard, a taunt, the one it was already fighting), else the lowest share of HP in reach.
function targetOf(f,L){const d=f.target&&L.includes(f.target)?f.target:null;if(d)return d;
  let lo=null;for(const b of L)if(!lo||b.hp/maxHp(b)<lo.hp/maxHp(lo)||(b.hp/maxHp(b)===lo.hp/maxHp(lo)&&b.id<lo.id))lo=b;return lo}
function heroBlow(f,t,crit){const h=t.hp;strike(f,t,crit?{crit:1}:undefined);return Math.max(0,Math.round(h-Math.max(0,t.hp)))}
function yieldHero(f,L){for(const b of L)if(b.target===f&&['duel','assist'].includes(b.state)){b.state='hunt';b.target=null}if(f.state!=='dead')goHome(f)}
// Kragmaw: one claw a round at a random raider in the fight (the template's blow), and the breath on its own timer
// (seconds, run down by one claw's cooldown a round), on everyone in its radius with no roll, as in real time.
function bossTurn(sc,f,L){const T=BOSSES[f.tpl||'kragmaw'],out=[],A=T.abilities&&T.abilities[0];
  const t=pickA(L),R=roll(f,t);
  if(!R.hit){out.push(beat(f.name,'attack','Claws at '+t.name,rollText(R)+': missed',rollData(R,0,t.name)));note(sc,f.name,t.name,R,0)}
  else{let d=Math.round((T.attack.dmg[0]+rnd()*T.attack.dmg[1])*(R.crit?1.5:1)*dmgTaken(t));t.hp-=d;actHurt(t,f,d);let down=t.hp<=0;if(down){agentDie(t,f);down=t.state==='dead';if(down)(sc.fell||(sc.fell=[])).push(t.id)}
    out.push(beat(f.name,'attack','Claws at '+t.name,rollText(R)+': hit for '+d+(down?'; '+t.name+' falls':isDown(t)?'; '+t.name+' goes down':''),rollData(R,d,t.name,down)));note(sc,f.name,t.name,R,d,down?'down':null)}
  if(A){if(sc.br==null)sc.br=f.breath!=null?f.breath:A.cd;sc.br-=T.attack.cd;
    if(sc.br<=0){sc.br+=A.cd;const hit=[];
      for(const b of L){if(b.state==='dead'||dist(b,f)>A.radius)continue;const d=Math.round(A.dmg[0]+rnd()*A.dmg[1]);b.hp-=d;actHurt(b,f,d,'breath');hit.push(b.name+' '+d);if(b.hp<=0){agentDie(b,f);if(b.state==='dead')(sc.fell||(sc.fell=[])).push(b.id)}}
      out.push(beat(f.name,'breath',A.name||'Breath',hit.length?'no roll: '+hit.join(', '):'no one in reach'));note(sc,f.name,'everyone near',null,0,(A.name||'breath')+(hit.length?': '+hit.join(', '):''))}}
  return out}
