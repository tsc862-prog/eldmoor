// Hero tool challenge (issue #633, owner request): an honour duel between two heroes of one faction, played at the table.
// Owned by ai-designer. DOM-free.
//
//   challenge   an agent hero says it aloud to a hero of its own faction within DUEL.RANGE tiles (a companion or not):
//               "to first blood" (the first hit ends it) or "to yield" (a duellist at or below DUEL.YIELD of max HP yields,
//               the pvp.js duel rule). In the lowest region (Thornvale, where pvp.js starts no duel) only first blood.
//   the answer  a scripted hero answers at once, by boldness and honour (a hash of the pair and the day, never the
//               gameplay RNG); an agent hero in its own time with answer_challenge, within DUEL.ANSWER_MIN game minutes,
//               else the challenge lapses. A decline is said aloud and heard by all in earshot; it costs the challenger
//               nothing and leaves a note in the challenger's stance toward the decliner (memory.js stanceEvent).
//   the duel    a Table scene of kind 'duel' (plays in turns; table.js plays an unlisted kind in turns) with the two duellists
//               as its only actors (ctx.ids) in initiative order, on the challenger's company's table; the company present
//               is told and may speak (say). DUEL.ROUNDS rounds: strike (d20 + level/2 against 10 + Defense x 20, the
//               tableround.js dice), a ready class ability as a harder blow, guard, or yield. HP lost is real, but a blow
//               never takes a duellist below DUEL.FLOOR of max HP, so an honour duel never downs anyone (#626): the
//               yield comes first. Rounds run out: decided on points (the larger share of health left), or a draw.
//               With no table for it (Watch mode, or no agent of the company has the say) it is fought at once by reflexes.
//   after       honour +1 to the winner (as a chance duel), a bond event between the two (bonds.js 'duelled'), wins and
//               losses in each one's stance toward the other, a landmark for both (tiers.js 'duel'), a chronicle line.
//               A leader beaten by a companion of the same walking party yields the head of it to the winner (the way
//               session zero lets a leader yield the lead).
//   limits      DUEL.PER_DAY challenges a hero a game day; not in a fight, the Crypt, a raid, a scene or at camp (either
//               side); never toward a hero below DUEL.MIN_HP; the same pair not again within DUEL.PAIR_MIN game minutes.
//
// Determinism: only agent heroes issue a challenge (the tool), so a seeded world with no challenge never reaches this file's
// dice; challengeTick is a no-op while S.challenges is absent.
//
// State (plain data, saved with the world): S.challenges [{id, by, to, mode, at, text}] (absent while empty), S.challengeSeq;
// a.duelDay {d, n}, a.duelLast {[heroId]: gameMin}, a.duelRec {[heroId]: {w, l, d}}; the scene's ctx (below).
import {S,dayNo} from './state.js';
import {dist,zoneAt,ZONES} from '../world/map.js';
import {cryptOfHero} from './crypts.js';
import {hash,rnd} from '../core/rng.js';
import {tm} from '../data/traits.js';
import {MOVES} from '../data/moves.js';
import {maxHp,atkOf} from './heroes.js';
import {dmgTaken} from './stats.js';
import {log} from './chronicle.js';
import {record} from './history.js';
import {speak,agentLine} from './chat.js';
import {notify} from './notify.js';
import {remember,stanceEvent} from './memory.js';
import {mark} from './tiers.js';
import {bondEvent,bond,FRIEND} from './bonds.js';
import {nearHeroes} from './spatial.js';
import {sceneOf} from './scenes.js';
import {score} from './abilities.js';
import {companyOf,soloFor,members,campaign} from './company.js';
import {leaderOfC} from './council.js';
import {inRange} from './reach.js';
import {movesOf} from './moves.js';
import {openScene,setSceneKind,sceneFor,tableOn} from './table.js';
import {roll,rollData,rollText,TR} from './tableround.js';

export const DUEL={
  PER_DAY:2,       // challenges a hero may issue in one game day
  RANGE:6,         // tiles: a challenge is said to a hero this close
  ANSWER_MIN:60,   // game minutes an agent has to answer before the challenge lapses
  PAIR_MIN:720,    // game minutes before the same two may challenge each other again
  MIN_HP:.5,       // a hero below this share of max HP is not challenged
  YIELD:TR.YIELD,  // a duellist at or below this share yields (the pvp.js duel rule)
  FLOOR:.1,        // a blow never takes a duellist below this share of max HP: an honour duel never downs (#626)
  ROUNDS:TR.ROUNDS,// rounds at most, as a Table fight; then it is decided on points
  POINTS:.05,      // shares of health closer than this after the last round: a draw
  GUARD:4,         // a guard takes this off the other's next strike
  MOVE_HIT:2,MOVE_MUL:1.4, // a class ability as a harder blow: to hit, and damage
  HIT:1.5,         // damage of a duel blow, before Defense (fought hard: a few clean hits make a duellist yield)
};
const MODE_WORDS={yield:'until one of them yields','first blood':'to first blood'},MODE_SAY={yield:'until one of us yields','first blood':'to first blood'};
const FIGHTING=['fight','duel','assist','raid','dungeon','downed','aid'];
const alive=x=>!!x&&x.kind==='hero'&&x.state!=='dead';
const hero=id=>S.agents.find(x=>x.id===id)||null;
const no=error=>({ok:false,error});
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const nk=s=>String(s==null?'':s).toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const share=x=>x.hp/maxHp(x);
const regionOf=x=>ZONES[zoneAt(x.x,x.y)]||'the wilds';
const vale=x=>zoneAt(x.x,x.y)<1; // the lowest region: pvp.js starts no duel there, so only first blood is drawn
const pickH=(seed,k,L)=>L[Math.floor(hash(seed|0,k,633)*L.length)%L.length];

// ---- reading ----
const list=()=>S.challenges||[];
export const challengeFor=a=>!a?null:list().find(c=>c.to===a.id)||null;   // the challenge waiting on this hero's answer
const pendingOf=a=>list().find(c=>c.by===a.id||c.to===a.id)||null;
// Why this hero cannot duel right now, or null.
function busy(x){if(!alive(x))return 'is not alive';if(x.state==='ghost')return 'is a ghost';if(x.hidden)return 'is out of sight';
  if(FIGHTING.includes(x.state)||x.raid)return x.raid||x.state==='raid'?'is in a raid':'is in a fight';
  {const D=cryptOfHero(x);if(D)return 'is down in '+D.name}
  if(x.state==='camp')return 'is camped for the night';
  if(sceneOf(x)||sceneFor(companyOf(x)))return 'is at the table in a scene';return null}
const usedToday=a=>a.duelDay&&a.duelDay.d===dayNo()?a.duelDay.n:0;
const recOf=(a,b)=>{const R=a.duelRec||(a.duelRec={});return R[b.id]||(R[b.id]={w:0,l:0,d:0})};
const tally=(a,b)=>{const r=recOf(a,b);return r.w+'-'+r.l+(r.d?'-'+r.d:'')};
function findHero(a,who){const n=nk(who),i=Number(who);
  if(Number.isInteger(i)&&String(who).trim()!==''){const b=hero(i);return b&&b.kind==='hero'?b:null}
  if(!n)return null;if(nk(a.name)===n)return a;const L=nearHeroes(a.x,a.y,12).filter(b=>b!==a&&alive(b)&&!b.hidden).sort((p,q)=>dist(a,p)-dist(a,q)||p.id-q.id);
  return L.find(b=>nk(b.name)===n)||L.find(b=>nk(b.name).split(' ')[0]===n)||L.find(b=>nk(b.name).startsWith(n))||null}
const nearList=a=>nearHeroes(a.x,a.y,DUEL.RANGE).filter(b=>b!==a&&alive(b)&&!b.hidden&&b.fac===a.fac&&dist(a,b)<=DUEL.RANGE).map(b=>b.name+' (id '+b.id+')').slice(0,5).join(', ')||'none';
function modeOf(to){if(to==null||String(to).trim()==='')return 'first blood';const t=nk(to);
  if(/yield|surrender|submit/.test(t))return 'yield';if(/blood|first|hit|touch/.test(t))return 'first blood';return null}

// ---- the challenge ----
// An agent hero challenges b. args {hero, to, text}; text already checked for English by player.js.
export function issue(a,{hero:who,to,text}={}){
  if(!a||!a.player)return no('Only an agent hero issues a challenge.');
  if(who==null||String(who).trim()==='')return no('Challenge whom? hero: the name or id of a hero of your faction within '+DUEL.RANGE+' tiles ('+nearList(a)+').');
  const b=findHero(a,who);if(!b||!alive(b))return no('No hero called "'+clean(who,40)+'" in sight. Heroes of your faction within '+DUEL.RANGE+' tiles: '+nearList(a)+'.');
  if(b===a)return no('You cannot challenge yourself.');
  if(b.fac!==a.fac)return no(b.name+' is not of your faction: an honour duel is fought among your own (fight is for foes).');
  let mode=modeOf(to);if(!mode)return no('to is "first blood" (the first hit ends it) or "yield" (until one yields).');
  {const w=busy(a);if(w)return no('You '+w.replace(/^is /,'are ')+': no duel now.')}
  {const w=busy(b);if(w)return no(b.name+' '+w+': no duel now.')}
  const d=dist(a,b);if(d>DUEL.RANGE)return no(b.name+' is '+Math.round(d)+' tiles away; a challenge is said within '+DUEL.RANGE+' tiles.');
  if(share(b)<DUEL.MIN_HP)return no(b.name+' is hurt, below half their strength: there is no honour in that. Let them heal first.');
  if(pendingOf(a)||pendingOf(b))return no('A challenge already stands '+(pendingOf(a)?'with you':'with '+b.name)+'; let it be answered first.');
  if(usedToday(a)>=DUEL.PER_DAY)return no('You have issued '+DUEL.PER_DAY+' challenges today; enough for one day.');
  const last=a.duelLast&&a.duelLast[b.id];if(last!=null&&S.gameMin-last<DUEL.PAIR_MIN)return no('You and '+b.name+' crossed blades or words '+Math.round((S.gameMin-last)/60)+' game hours ago; let it rest '+Math.ceil((DUEL.PAIR_MIN-(S.gameMin-last))/60)+' more.');
  let note=null;if(mode==='yield'&&(vale(a)||vale(b))){mode='first blood';note='In '+regionOf(a)+' blood is drawn only to first blood: the challenge is to first blood.'}
  const line=clean(text,200)||b.name+', I challenge you to an honour duel, '+MODE_SAY[mode]+'.';
  agentLine(a,speak(a,line,'agent'));
  a.duelDay={d:dayNo(),n:usedToday(a)+1};const gm=Math.round(S.gameMin);(a.duelLast||(a.duelLast={}))[b.id]=gm;(b.duelLast||(b.duelLast={}))[a.id]=gm;
  const ch={id:S.challengeSeq=(S.challengeSeq||0)+1,by:a.id,to:b.id,mode,at:gm,text:line};(S.challenges||(S.challenges=[])).push(ch);
  record(a,'Challenged ',b,' to an honour duel, '+MODE_WORDS[mode]+'.');
  const out={ok:true,said:line,to:b.name,mode,...(note?{note}:{})};
  if(b.player){notify(b,a.name+' challenges you to an honour duel, '+MODE_SAY[mode].replace('us','you')+': "'+line+'". Answer with answer_challenge {answer: accept or decline, text} within an hour; a decline is heard by all.',true,2);
    return {...out,answer:'waiting',result:b.name+' has an hour to answer.'}}
  const r=scriptedAnswer(ch,a,b);return {...out,answer:r.answer,result:r.result}}

// A scripted hero answers at once: boldness and honour, and a friend is readier; much weaker, it declines. No gameplay RNG.
function scriptedAnswer(ch,a,b){const p=Math.max(.1,Math.min(.85,.3*tm(b,'bold')+Math.min(.25,(b.honor||0)/200)+(bond(a,b)>=FRIEND?.1:0)));
  const yes=b.lvl>=a.lvl-3&&hash(ch.by,ch.to,dayNo()*7+ch.id)<p;
  return yes?accept(ch,b,pickH(ch.id,1,['So be it. Draw.','Gladly. Mind your footing.','Then let us see it.']),'reflex'):decline(ch,b,pickH(ch.id,2,['Not today.','Keep your blade sheathed; I have no quarrel with you.','No. Save it for the enemy.']),'reflex')}

// The answer tool (answer_challenge) for an agent hero.
export function answer(b,{answer:ans,text}={}){const ch=challengeFor(b);if(!ch)return no('No challenge waits on your answer.');
  const a=hero(ch.by),t=nk(ans);
  if(!t)return no(a?a.name+' challenged you, '+MODE_WORDS[ch.mode]+': "'+ch.text+'". answer: accept or decline.':'Answer: accept or decline.');
  const yes=/^(accept|yes|aye|y|agree|take)/.test(t),nay=/^(decline|no|refuse|n|nay)/.test(t);
  if(!yes&&!nay)return no('answer is accept or decline.');
  const line=clean(text,200);return nay?decline(ch,b,line||'I decline.','agent'):accept(ch,b,line||'I accept. Draw.','agent')}
const drop=ch=>{const L=list(),i=L.indexOf(ch);if(i>=0)L.splice(i,1);if(S.challenges&&!S.challenges.length)delete S.challenges};
function say2(x,line,by){const e=speak(x,line,by==='agent'?'agent':'say');if(by==='agent')agentLine(x,e)}
function decline(ch,b,line,by){drop(ch);const a=hero(ch.by);say2(b,line,by);
  if(alive(a)){stanceEvent(a,b,'turned down my challenge');notify(a,b.name+' declines your challenge: "'+line+'"',false,1);remember(a,'duel',b.name+' declined my challenge.')}
  return {ok:true,answer:'declined',result:b.name+' declined: "'+line+'"'}}
function accept(ch,b,line,by){const a=hero(ch.by);drop(ch);
  const w=!alive(a)?'the challenger is gone':busy(a)?a.name+' '+busy(a):busy(b)?'you '+busy(b).replace(/^is /,'are '):dist(a,b)>DUEL.RANGE+2?a.name+' is too far away now':share(b)<DUEL.MIN_HP?'you are too hurt now':share(a)<DUEL.MIN_HP?a.name+' is too hurt now':null;
  if(w)return no('The challenge can no longer be met: '+w+'.');
  say2(b,line,by);const r=start(a,b,ch.mode);return {ok:true,answer:'accepted',result:b.name+' accepts. '+r}}

// ---- the duel ----
const other=(c,x)=>hero(x.id===c.a?c.b:c.a);
const rdOf=sc=>sc.rd||1;
const cdKey=(a,id)=>a.id+':'+id;
const moveReady=(sc,a,id)=>!((sc.ctx.cd||{})[cdKey(a,id)]>rdOf(sc));
const duelMoves=(sc,a)=>movesOf(a).filter(id=>MOVES[id].target==='foe'&&moveReady(sc,a,id));
function start(a,b,mode){const ids=[a,b].sort((x,y)=>(score(y,'reflex')||10)-(score(x,'reflex')||10)||x.id-y.id).map(x=>x.id);
  const C=companyOf(a)||soloFor(a)||companyOf(b),zone=regionOf(a);
  const ctx={duel:1,a:a.id,b:b.id,mode,ids,anchor:a.id,zone,cd:{},g:{},hp0:{[a.id]:Math.round(a.hp),[b.id]:Math.round(b.hp)},...(C?{company:C.id}:{})};
  for(const x of [...(C?members(C):[]),...(companyOf(b)&&companyOf(b)!==C?members(companyOf(b)):[])])
    if(x!==a&&x!==b&&(inRange(a,x)||inRange(b,x)))notify(x,a.name+' and '+b.name+' fight an honour duel, '+MODE_WORDS[mode]+'. Watch, and speak (say) if you like.',false,1);
  const title=a.name+' and '+b.name+': an honour duel',frame=[a,' and ',b,' step apart in '+zone+' and draw, '+MODE_WORDS[mode]+'. Those near give them room.'];
  const sc=C&&tableOn()?openScene('duel',title,frame,ctx,C):null;
  if(sc){if(sc.phase!=='outcome'&&sc.phase!=='done'&&!ctx.done)sc.rd=sc.rd||1;return ctx.done?ctx.line:'The duel is at the table.'}
  return fightOff(ctx)}
// One blow: real damage, never below DUEL.FLOOR of max HP (no downing, #626).
function blow(a,o,crit,mul){let d=atkOf(a)*(.8+rnd()*.4)*mul*DUEL.HIT*dmgTaken(o);if(crit)d*=1.8;
  const floor=Math.ceil(maxHp(o)*DUEL.FLOOR),h=o.hp;o.hp=Math.max(Math.min(h,floor),h-Math.max(1,Math.round(d)));return Math.round(h-o.hp)}
function end(sc,w,l,how){const c=sc.ctx;c.end=how;c.win=w.id;c.lose=l.id;if(sc.ids)sc.i=sc.ids.length-1} // the other's turn this round is not played (take() moves the pointer on)
function options(sc,a){const c=sc.ctx,o=other(c,a);if(c.end||!alive(o))return [{k:'salute',text:'Lower your blade: the duel is over'}];
  const L=[{k:'strike',text:'Strike '+o.name+' ('+(c.mode==='yield'?'until one yields':'first blood ends it')+')'}];
  for(const id of duelMoves(sc,a)){const M=MOVES[id];L.push({k:id,text:'Ability, '+M.name+': a harder blow (+'+DUEL.MOVE_HIT+' to hit), ready again in '+(M.rounds||1)+' rounds'})}
  L.push({k:'guard',text:'Guard: blade up, '+o.name+'\'s next strike at -'+DUEL.GUARD},{k:'yield',text:'Yield: lower your blade and concede'});return L}
// A duellist nobody plays (or a silent agent): a ready ability, else guard when hurt, else strike. No dice.
function reflex(sc,a){const c=sc.ctx;if(c.end)return 'salute';const mv=duelMoves(sc,a)[0];if(mv)return mv;
  if(share(a)<.5&&!c.g[a.id])return 'guard';return 'strike'}
function apply(sc,a,act){const c=sc.ctx,k=act.k,o=other(c,a);if(c.end||!alive(o))return 'the duel is over';delete c.g[a.id]; // a guard lasts until one's own next act
  if(k==='salute')return 'lowers the blade';
  if(k==='yield'){end(sc,o,a,'yield');return 'yields'}
  if(k==='guard'){c.g[a.id]=1;return 'raises a guard'}
  const mv=MOVES[k]?k:null;if(k!=='strike'&&!mv)return null;
  if(mv)c.cd[cdKey(a,mv)]=rdOf(sc)+(MOVES[mv].rounds||1);
  const R=roll(a,o,(mv?DUEL.MOVE_HIT:0)-(c.g[o.id]?DUEL.GUARD:0));delete c.g[o.id];const by=mv?MOVES[mv].name+', ':'';
  if(!R.hit){sc.rr=rollData(R,0,o.name);return by+rollText(R)+': missed'}
  const d=blow(a,o,R.crit,mv?DUEL.MOVE_MUL:1);sc.rr=rollData(R,d,o.name);
  if(c.mode==='first blood'){end(sc,a,o,'blood');return by+rollText(R)+': first blood, '+d}
  if(share(o)<=DUEL.YIELD+1e-9){end(sc,a,o,'yield');return by+rollText(R)+': hit for '+d+', and '+o.name+' yields'}
  return by+rollText(R)+': hit for '+d}
function next(sc){const c=sc.ctx;if(c.end)return false;const rd=rdOf(sc);if(rd>=DUEL.ROUNDS)return false;
  if(!alive(hero(c.a))||!alive(hero(c.b)))return false;sc.rd=rd+1;return true}
// No table for it: fought at once, both by reflex (the same options and dice).
function fightOff(c){const sc={ctx:c,ids:c.ids.slice(),rd:1,i:0,beats:[]};
  for(let guard=0;guard<20;guard++){for(let i=0;i<sc.ids.length&&!c.end;i++){sc.i=i;const a=hero(sc.ids[i]);if(!alive(a))continue;const k=reflex(sc,a);sc.beats.push({id:a.id,name:a.name,k,res:apply(sc,a,{k}),rd:sc.rd})}
    if(!next(sc))break}
  return settle(c)}
// The outcome: who won and how, honour, bonds, stances, landmarks, the chronicle, the lead. Returns the line.
function settle(c){if(c.done)return c.line||'';c.done=1;const A=hero(c.a),B=hero(c.b);
  if(!alive(A)||!alive(B)){c.line='The duel broke off.';return c.line}
  if(!c.end){const d=share(A)-share(B);if(Math.abs(d)<DUEL.POINTS)c.end='draw';else{c.end='points';c.win=d>0?A.id:B.id;c.lose=d>0?B.id:A.id}}
  const how={blood:'drew first blood on',yield:'made',points:'had the better of'}[c.end];
  if(c.end==='draw'){for(const [x,y] of [[A,B],[B,A]]){recOf(x,y).d++;stanceEvent(x,y,'we fought an honour duel to a standstill ('+tally(x,y)+')');
      mark(x,'duel','Fought '+y.name+' to a standstill in an honour duel in '+c.zone+'.');record(x,'Fought ',y,' to a standstill in an honour duel.');remember(x,'duel','My honour duel with '+y.name+' ended even.')}
    bondEvent(A,'duelled',[B]);log(A,' and ',B,' fight an honour duel in '+c.zone+'; neither yields, and they part even.');
    c.line=A.name+' and '+B.name+' fought '+DUEL.ROUNDS+' rounds and neither yielded: a draw.'}
  else{const W=hero(c.win),L=hero(c.lose);W.honor=(W.honor||0)+1;S.facStats[W.fac].honor+=1;recOf(W,L).w++;recOf(L,W).l++;
    stanceEvent(W,L,'I beat them in an honour duel ('+tally(W,L)+')');stanceEvent(L,W,'beat me in an honour duel ('+tally(L,W)+')');
    bondEvent(W,'duelled',[L]);
    mark(W,'duel','Won an honour duel against '+L.name+' in '+c.zone+'.');mark(L,'duel','Lost an honour duel to '+W.name+' in '+c.zone+'.');
    record(W,'Won an honour duel against ',L,'.');record(L,'Lost an honour duel to ',W,'.');
    const yl=c.end==='yield'?' yield':'';remember(W,'duel','I '+how+' '+L.name+yl+' in an honour duel.');remember(L,'duel',W.name+' '+how+' me'+yl+' in an honour duel.');
    log(W,' '+how+' ',L,c.end==='yield'?' yield':'',' in an honour duel in '+c.zone+(c.end==='points'?' on points':'')+'.');
    c.line=W.name+' '+how+' '+L.name+(c.end==='yield'?' yield':'')+(c.end==='points'?' on points after '+DUEL.ROUNDS+' rounds':'')+'.';
    notify(L,'You lost the honour duel to '+W.name+'. Rest before your next fight.',false,1);
    const lead=leadSwap(W,L);if(lead)c.line+=' '+lead}
  for(const x of [A,B])notify(x,'The honour duel is over: '+c.line,false,1);
  return c.line}
// A leader beaten by a companion of the same walking party yields the head of it to the winner.
function leadSwap(W,L){const C=companyOf(L);if(!C||companyOf(W)!==C||leaderOfC(C)!==L)return null;const P=(S.parties||[]).find(p=>p.company===C.id);
  if(!P||!P.mem.includes(W)||!P.mem.includes(L))return null;P.leader=W;
  campaign(C,'lead',W,' beat ',L,' in an honour duel and takes the lead.');log(L,' yields the lead of ',{t:C.name||'the company',c:'gd'},' to ',W,'.');
  for(const x of members(C))notify(x,W.name+' beat '+L.name+' in an honour duel and now leads the company.',false,1);
  return L.name+' yields the lead to '+W.name+'.'}
function view(sc,a){const c=sc.ctx,o=other(c,a);if(!o)return {};const w=f=>f>=.95?'unhurt':f>=.6?'hurt':f>=.35?'badly hurt':'close to yielding';
  return {duel:MODE_WORDS[c.mode],opponent:o.name,opponent_looks:w(share(o)),you:w(share(a)),duel_round:rdOf(sc)+' of up to '+DUEL.ROUNDS,how:'Strike, use an ability, guard or yield; a duellist at '+Math.round(DUEL.YIELD*100)+'% health yields'+(c.mode==='first blood'?'; the first hit ends it':'')+'. No one dies in an honour duel.'}}
setSceneKind('duel',{options,reflex,apply,next,view,outcome:sc=>settle(sc.ctx)});

// ---- once per step (sim/index.js) ----
// An unanswered challenge lapses after DUEL.ANSWER_MIN; one whose heroes are gone is dropped.
export function challengeTick(){const L=S.challenges;if(!L||!L.length)return;
  for(const ch of L.slice()){const a=hero(ch.by),b=hero(ch.to);
    if(!alive(a)||!alive(b)){drop(ch);continue}
    if(S.gameMin-ch.at<DUEL.ANSWER_MIN)continue;drop(ch);stanceEvent(a,b,'let my challenge go unanswered');
    notify(a,b.name+' let your challenge pass unanswered.',false,1);notify(b,'You let '+a.name+'\'s challenge pass.',false)}}
// For status: the challenge this hero waits to answer, or has issued.
export function challengeView(a){const ch=pendingOf(a);if(!ch)return null;const by=hero(ch.by),to=hero(ch.to);
  return ch.to===a.id?{from:by?by.name:'?',to:MODE_WORDS[ch.mode],said:ch.text,answer_by:'answer_challenge within '+Math.max(0,Math.ceil(DUEL.ANSWER_MIN-(S.gameMin-ch.at)))+' game min'}
    :{to_hero:to?to.name:'?',duel:MODE_WORDS[ch.mode],waiting:'for their answer'}}
