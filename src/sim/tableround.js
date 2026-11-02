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
import {score} from './abilities.js';
import {blk,mobBlow} from './mobs.js';
import {actHurt} from './actlog.js';
import {dmlog} from './dmlog.js';

export const TR={
  ROUNDS:3,   // rounds a combat scene plays at most; then the fight goes on in the world (HP and cooldowns carry over)
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
export function roll(att,t){const d=ri(1,20),b=hitOf(att),ac=acOf(t);return {d,b,ac,hit:d===20||(d!==1&&d+b>=ac),crit:d===20}}
// The roll as data for the watcher's banner (#285): {die, mod, total, vs, hit, crit, dmg, target, down}; the beat's res text
// keeps the same roll in words for logs and agents.
export const rollData=(R,dmg,target,down)=>({die:R.d,mod:R.b,total:R.d+R.b,vs:R.ac,hit:R.hit,crit:R.crit,dmg:dmg||0,target,down:!!down});
export const rollText=R=>'d20 '+R.d+'+'+R.b+'='+(R.d+R.b)+' vs AC '+R.ac+(R.crit?' (a natural 20)':R.d===1?' (a natural 1)':'');
// One line of the round's DM log entry.
function note(sc,by,at,R,dmg,extra){(sc.rl||(sc.rl=[])).push({rd:sc.rd||1,by,at,d20:R?R.d:null,bonus:R?R.b:null,ac:R?R.ac:null,hit:R?R.hit:true,dmg:dmg||0,...(extra?{note:extra}:{})})}
const lineOf=r=>r.by+(r.d20==null?' '+(r.note||'acts')+' on '+r.at:' at '+r.at+': d20 '+r.d20+'+'+r.bonus+' vs AC '+r.ac+(r.hit?', '+r.dmg+' damage':', miss'))+(r.d20!=null&&r.note?' ('+r.note+')':'');
// Fold the scene's rolls into one DM log entry, a sentence per round (kind 'table': not an adventure roll, so it opens no
// check scene; one entry a scene keeps the capped DM log readable).
export function flushRolls(sc){const L=sc.rl;if(!L||!L.length)return;sc.rl=[];const rs=[...new Set(L.map(r=>r.rd))];
  dmlog('table',null,[sc.title+': '+rs.map(n=>'round '+n+': '+L.filter(r=>r.rd===n).map(lineOf).join('; ')).join('. ')+'.'],{scene:sc.id,kind:sc.kind,rounds:sc.rd||1,sceneType:'fight',by:'scripted',rolls:L},{heroes:sc.ids.slice()})}

// ---- a member's strike, with its roll ----
// The structured roll waits on sc.rr until table.js take() puts it on the member's beat (beat.roll).
export function memberStrike(sc,a,f){const R=roll(a,f);
  if(!R.hit){note(sc,a.name,name(f),R,0);sc.rr=rollData(R,0,name(f));return rollText(R)+': missed'}
  const h=f.hp,o=R.crit?{crit:1}:undefined;strike(a,f,o);const dmg=Math.max(0,Math.round(h-f.hp)),down=f.kind==='boss'?!f.alive:f.kind==='hero'?f.state==='dead':!f.alive;
  note(sc,a.name,name(f),R,dmg,down?'down':null);sc.rr=rollData(R,dmg,name(f),down);return rollText(R)+': hit for '+dmg+(down?', and it falls':'')}

// ---- the foe's turn ----
// fs: the foes acting (a staged pack acts together at its leader's place in the order); L: the members in the fight.
// Returns beats ({id:'foe', name, k, text, res, by:'foe', roll?}) and sets sc.end ('fled', 'yield') when the foe breaks off.
export function foeTurn(sc,fs,L){const out=[];
  for(const f of fs){if(!f)continue;const nm=name(f);
    if(f.kind==='hero'&&f.state!=='dead'&&f.hp<maxHp(f)*TR.YIELD*tm(f,'flee')){yieldHero(f,L);sc.end='yield';out.push(beat(nm,'yield','Yields and breaks off',null));note(sc,nm,'the fight',null,0,'yields');break}
    if(f.kind==='mob'&&fs.length===1&&!f.elite&&!f.fledOnce&&(blk(f).beh||{}).flee&&f.hp<f.maxhp*blk(f).beh.flee){f.fledOnce=true;f.fled=2.5;sc.end='fled';out.push(beat(nm,'flee','Breaks away and runs',null));note(sc,nm,'the fight',null,0,'flees');break}
    const live=L.filter(b=>b.state!=='dead'&&b.hp>0);if(!live.length)break;
    if(f.kind==='boss'){out.push(...bossTurn(sc,f,live));continue}
    const t=targetOf(f,live),R=roll(f,t);let res,rd;
    if(!R.hit){res=rollText(R)+': missed';note(sc,nm,t.name,R,0);rd=rollData(R,0,t.name)}
    else{const dmg=f.kind==='hero'?heroBlow(f,t,R.crit):mobBlow(f,t,R.crit?1.5:1);const down=t.state==='dead';
      res=rollText(R)+': hit for '+dmg+(down?'; '+t.name+' falls':'');note(sc,nm,t.name,R,dmg,down?'down':null);rd=rollData(R,dmg,t.name,down);if(down)(sc.fell||(sc.fell=[])).push(t.id)}
    out.push(beat(nm,'attack','Strikes at '+t.name+(f.target===t?' (drawn)':''),res,rd))}
  return out}
const beat=(nm,k,text,res,roll)=>({id:'foe',name:nm,k,text,res,by:'foe',...(roll?{roll}:{})});
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
  else{let d=Math.round((T.attack.dmg[0]+rnd()*T.attack.dmg[1])*(R.crit?1.5:1)*dmgTaken(t));t.hp-=d;actHurt(t,f,d);const down=t.hp<=0;if(down){agentDie(t,f);(sc.fell||(sc.fell=[])).push(t.id)}
    out.push(beat(f.name,'attack','Claws at '+t.name,rollText(R)+': hit for '+d+(down?'; '+t.name+' falls':''),rollData(R,d,t.name,down)));note(sc,f.name,t.name,R,d,down?'down':null)}
  if(A){if(sc.br==null)sc.br=f.breath!=null?f.breath:A.cd;sc.br-=T.attack.cd;
    if(sc.br<=0){sc.br+=A.cd;const hit=[];
      for(const b of L){if(b.state==='dead'||dist(b,f)>A.radius)continue;const d=Math.round(A.dmg[0]+rnd()*A.dmg[1]);b.hp-=d;actHurt(b,f,d,'breath');hit.push(b.name+' '+d);if(b.hp<=0){agentDie(b,f);(sc.fell||(sc.fell=[])).push(b.id)}}
      out.push(beat(f.name,'breath',A.name||'Breath',hit.length?'no roll: '+hit.join(', '):'no one in reach'));note(sc,f.name,'everyone near',null,0,(A.name||'breath')+(hit.length?': '+hit.join(', '):''))}}
  return out}
