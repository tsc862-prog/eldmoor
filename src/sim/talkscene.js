// Talk escalates to a Table scene (issue #407, part of #402). Owned by ai-designer. DOM-free.
//
// Everyday talk stays in the world (sim/talk.js: the person answers, nobody pauses). A conversation becomes a short
// social Table scene (kind 'talk', played everyone-at-once, PLAY 'all') only when it turns into a real decision:
//   offer    the person offers a job: it needs an answer
//   bargain  the hero asks to bargain or negotiate
//   party    companions stand in earshot and the matter concerns the company (they get a say)
//   tense    the talk turns tense: a hostile person, or a threat in the hero's words
// Small talk, greetings and hails, buying and selling (trade), rumours and blessings never open a scene.
// All the rules are here: ESC (the words and limits) and escalation() (the one decision). sim/talk.js only asks.
//
// The scene runs for the company present: the speaker's company (sim/company.js, #402), its members within shouting
// range of the speaker (sim/table.js present()), on that company's table (#440). Options for everyone: accept,
// decline, bargain (a d20 social check, persuasion or intimidation by temperament) and leave. The choice is the
// majority (a won bargain counts for accept, a lost one against); a tie goes to the one who spoke. Then the person
// answers: the DM agent voices it through the conversation's waiting call (npc_call / npc_say) when it is listening,
// else the scripted line below. Nothing here runs unless a member talks to someone (agent tools only), so the seeded
// world (npm run sim, the checks' hashes) is unchanged.
import {S} from './state.js';
import {dist} from '../world/map.js';
import {HEAR} from './chat.js';
import {companyOf,members} from './company.js';
import {openScene,setSceneKind,tableOn,sceneFor} from './table.js';
import {setTalkEscalation,warm,sceneReply,endTalk,convById} from './talk.js';
import {check,socialSkill,trained} from './abilities.js';
import {maxHp} from './heroes.js';
import {dmlog} from './dmlog.js';
import {remember} from './memory.js';
import {playerAct} from './player.js';
import {ADVENTURES} from '../data/adventures.js';

export const ESC={
  PER_DAY:6,          // talk scenes a company may have in a game day
  DC:12,              // a bargain's check (+3 against a hostile person, -2 a friendly one, +1 for each bargain already lost)
  PAY_UP:1.25,        // a won bargain over a job raises its pay by this much ...
  PAY_MAX:1.6,        // ... up to this
  // the words
  BARGAIN:/\b(bargain\w*|barter\w*|haggl\w*|negotiat\w*|better (price|terms|deal|offer|pay)|lower (the |your )?price|discount|cheaper|(strike|make|cut) a deal|your terms|name your price)\b/i,
  PARTY:/\b(we|us|our|ours|party|company|fellowship|together|companions?|all of us)\b/i,
  MATTER:/\b(join\w*|hire\w*|help|swear|oath|vow|pay|payment|reward|fee|escort|guide|work|job|task|quest|offer|alliance|ally|share|bargain)\b/i,
  TENSE:/\b(threat\w*|or else|draw (steel|your|my)|blades? out|i will kill|kill you|you will die|liar|traitor|surrender|yield|hand (it|them) over|back off|stand aside|last warning)\b/i,
};
export const TALK_OPTS=['accept','decline','bargain','leave'];
const DAY=1440;
const gd=t=>({t,c:'gd'});
const full=p=>(p.title?p.title+' ':'')+p.name;
const byId=id=>S.agents.find(x=>x.id===id)||null;
const living=a=>a&&a.kind==='hero'&&a.state!=='dead';
const npcById=id=>(S.npcs||[]).find(x=>x.id===id)||(S.wanderers||[]).find(x=>x.id===id)||null;
const hookOf=id=>(S.adventures||[]).find(h=>h.id===id)||null;
const LOG=(summary,detail)=>dmlog('talk',null,summary,{by:'scripted',...detail},{heroes:[]}); // heroes [] as in talk.js: no DM bookkeeping in the campaign log

// ---- the rule ----
// c: the conversation, p: the person, a: the member who spoke (or was offered), o: {line} for a member's words, or
// {offer, hook} for the person's follow-up. Returns {why, mates} when the talk is a decision, else null.
export function escalation(c,p,a,o={}){
  if(!c||!p||!living(a)||c.state!=='open'||!tableOn())return null;
  const C=companyOf(a);if(!C||sceneFor(C))return null; // the company's own scene is open (#518: one per company)
  const E=c.esc||{};
  const mates=members(C).filter(b=>b!==a&&!b.hidden&&dist(b,p)<=HEAR);
  let why=null;
  if(o.offer)why=o.offer==='job'&&o.hook!=null?'offer':null; // trade, rumours, blessings, leaving: no answer needed
  else{const t=String(o.line||'').trim();if(!t)return null; // a greeting
    if(p.mood==='hostile'||ESC.TENSE.test(t))why='tense';
    else if(ESC.BARGAIN.test(t))why='bargain';
    else if(mates.length&&ESC.PARTY.test(t)&&ESC.MATTER.test(t))why='party'}
  if(!why||E[why])return null; // once per conversation and reason
  const d=Math.floor(S.gameMin/DAY),N=C.talkScenes&&C.talkScenes.d===d?C.talkScenes:{d,n:0};if(N.n>=ESC.PER_DAY)return null;
  return {why,mates}}

// ---- opening ----
const FRAME={
  offer:(n,o)=>[n+' offers ',gd(o.job),' and waits for an answer.'],
  bargain:(n,o)=>[o.who+' wants better terms from '+n+'. ',gd(n),' folds their arms and waits.'],
  party:(n,o)=>[o.who+' puts it to '+n+': "'+o.line+'". It concerns the whole company; ',gd(n),' looks from one face to the next.'],
  tense:(n,o)=>[gd(n),o.hostile?' has no love for them, and the air turns cold.':' bristles at '+o.who+'\'s words.',' A wrong word now and it ends badly.']};
const TITLE={offer:n=>n+'\'s offer',bargain:n=>'Bargaining with '+n,party:n=>'A word with '+n,tense:n=>'A tense word with '+n};
function maybe(c,p,a,o){const E=escalation(c,p,a,o);if(!E)return null;const C=companyOf(a),n=full(p);
  const h=E.why==='offer'?hookOf(o.hook):null,job=h?'a job: '+((ADVENTURES[h.tpl]&&ADVENTURES[h.tpl].name)||h.tpl):'work';
  const wordCut=(t,n)=>{t=t.trim();if(t.length<=n)return t;const x=t.slice(0,n-1),i=x.lastIndexOf(' ');return (i>n*.6?x.slice(0,i):x).trimEnd()+'…'}; // a quoted line is cut at a word, never mid-word (#571)
  const sc=openScene('talk',TITLE[E.why](n),FRAME[E.why](n,{who:a.name,line:wordCut(String(o.line||''),120),job,hostile:p.mood==='hostile'}),
    {anchor:a.id,conv:c.id,npc:p.id,why:E.why,...(h?{hook:h.id}:{}),line:String(o.line||'').slice(0,200),tally:{}},C);
  if(!sc)return null;
  (c.esc||(c.esc={}))[E.why]=1;const d=Math.floor(S.gameMin/DAY);C.talkScenes=C.talkScenes&&C.talkScenes.d===d?C.talkScenes:{d,n:0};C.talkScenes.n++;
  LOG(['The talk with '+n+' becomes a decision at the table ('+E.why+'): '+sc.ids.map(byId).filter(Boolean).map(b=>b.name).join(', ')+' answer.'],{conv:c.id,npc:p.id,hero:a.id,table:E.why,scene:sc.id});
  return {note:'This needs an answer from the company: a scene at the table ('+sc.title+'). Answer with scene_act: '+TALK_OPTS.join(', ')+'.'}}
setTalkEscalation(maybe);

// ---- at the table ----
const nameOf=sc=>{const p=npcById(sc.ctx.npc);return p?full(p):'them'};
const TEXT={
  offer:{accept:()=>'Take the job',decline:()=>'Turn it down',bargain:(n,s)=>'Bargain for better pay ('+s+')',leave:n=>'Walk away from '+n},
  bargain:{accept:n=>'Take '+n+'\'s terms as they stand',decline:()=>'Refuse the deal',bargain:(n,s)=>'Haggle with '+n+' ('+s+')',leave:n=>'Walk away from '+n},
  party:{accept:()=>'Agree to it',decline:()=>'Say no',bargain:(n,s)=>'Ask '+n+' for better terms ('+s+')',leave:n=>'Walk away from '+n},
  tense:{accept:n=>'Give ground: let '+n+' have their way',decline:()=>'Stand firm',bargain:(n,s)=>'Talk '+n+' down ('+s+')',leave:n=>'Walk away from '+n}};
const options=(sc,a)=>{const n=nameOf(sc),T=TEXT[sc.ctx.why]||TEXT.party,s=socialSkill(a);return TALK_OPTS.map(k=>({k,text:T[k](n,s)}))};
function dcOf(sc){const p=npcById(sc.ctx.npc),T=sc.ctx.tally;return ESC.DC+({hostile:3,friendly:-2}[p&&p.mood]||0)+((T.bargain&&T.bargain.lost)||0)}
function apply(sc,a,act){const k=act.k,T=sc.ctx.tally,t=T[k]||(T[k]={n:0,who:[],won:0,lost:0});t.n++;t.who.push(a.id);
  if(k!=='bargain')return null;
  const R=check(a,socialSkill(a),dcOf(sc),{nat:true});if(R.pass)t.won++;else t.lost++;
  LOG([a.name+' bargains with '+nameOf(sc)+': '+R.skill+' '+R.d20+(R.mod>=0?'+':'')+R.mod+' = '+R.total+' vs DC '+R.dc+(R.pass?': success':': failure')+'.'],{conv:sc.ctx.conv,npc:sc.ctx.npc,hero:a.id,skill:R.skill,d20:R.d20,total:R.total,dc:R.dc,pass:R.pass,table:'bargain'});
  return (R.pass?'success':'failure')+', '+R.total+' vs '+R.dc}
// A member nobody plays (no runner, or a silent agent past its wait): cautious when hurt, a trained tongue bargains.
function reflex(sc,a){const why=sc.ctx.why,p=npcById(sc.ctx.npc),hurt=a.hp<maxHp(a)*.4,tongue=trained(a,socialSkill(a));
  if(why==='tense')return hurt?'leave':tongue?'bargain':p&&p.mood==='hostile'?'leave':'decline';
  if(why==='offer')return hurt?'decline':tongue?'bargain':'accept';
  if(why==='bargain')return tongue?'bargain':'accept';
  return 'accept'}

// ---- the outcome ----
// The person's scripted answer per reason and result (the DM agent's words replace it when it is listening).
const SAY={
  offer:{yes:'Good. I knew I had the right people.',won:'More coin, then. You drive a hard bargain; do not make me regret it.',no:'A pity. Ask again if you change your minds.',gone:'Suit yourselves.'},
  bargain:{yes:'Then we are agreed.',won:'Fine, fine. For you, a kinder price.',no:'Then we have nothing more to say about it.',gone:'Off with you, then.'},
  party:{yes:'Then it is settled between us.',won:'All right. On your terms, then.',no:'As you wish. I will not ask twice.',gone:'Go on, then.'},
  tense:{yes:'Wise. Very wise.',won:'...Fine. No one needs to bleed today.',no:'Then we are done here. Watch your backs.',gone:'Run along.'}};
function outcome(sc){const x=sc.ctx,T=x.tally,p=npcById(x.npc),c=convById(x.conv),a=byId(x.anchor)||sc.ids.map(byId).find(living),n=nameOf(sc);
  const cnt=k=>T[k]?T[k].n:0,won=T.bargain?T.bargain.won:0,lost=T.bargain?T.bargain.lost:0;
  const yes=cnt('accept')+won,no=cnt('decline')+lost,gone=cnt('leave');
  let r=yes>no&&yes>gone?'yes':no>yes&&no>gone?'no':gone>yes&&gone>no?'gone':null;
  if(!r){const mine=sc.acts[x.anchor];const k=mine?mine.k:'decline';r=k==='accept'?'yes':k==='leave'?'gone':k==='bargain'?(won?'yes':'no'):'no'}
  const say=SAY[x.why]||SAY.party,mem=sc.ids.map(byId).filter(living);let tail,line=say[r==='yes'&&won?'won':r];
  if(!p){x.result=r;return 'The person is gone.'}
  if(x.why==='offer'){const h=hookOf(x.hook);
    if(r==='yes'){if(h&&won){h.data=h.data||{};h.data.payMul=Math.min(ESC.PAY_MAX,Math.round((h.data.payMul||1)*ESC.PAY_UP*100)/100)}
      const tk=a&&h&&h.phase==='open'?playerAct(a.id,'take_quest',{id:'job:'+h.id}):null;
      tail='They take '+n+'\'s job'+(won?' at better pay':'')+(tk&&tk.ok?' ('+a.name+' holds it: '+tk.id+')':h&&h.phase==='open'?' (it waits on the board: take_quest job:'+h.id+')':'')+'.';
      warm(p,1,'the company took the job')}
    else if(r==='no'){warm(p,-1,'the company turned the job down');tail='They turn '+n+'\'s job down.'}
    else tail='They walk away from '+n+'\'s offer.'}
  else if(x.why==='bargain'){
    if(r==='yes'){if(won)warm(p,2,'a bargain struck');tail=won?n+' gives them a kinder price.':'They take '+n+'\'s terms.'}
    else if(r==='no'){warm(p,-1,'a bargain refused');tail='No deal with '+n+'.'}
    else tail='They walk away from '+n+'.'}
  else if(x.why==='party'){
    if(r==='yes'){warm(p,1,'the company agreed');for(const b of mem)remember(b,'talk','We agreed with '+n+(x.line?': '+x.line:'')+'.');tail='The company agrees with '+n+(won?', on better terms':'')+'.'}
    else if(r==='no'){warm(p,-1,'the company said no');tail='The company says no to '+n+'.'}
    else tail='They walk away from '+n+'.'}
  else{ // tense
    if(r==='yes'){if(won){delete p.hostile;if((p.warmth||0)<0)p.warmth=0;warm(p,1,'talked down');tail=n+' is talked down.'}else{warm(p,2,'they gave ground');tail='They give ground to '+n+'.'}}
    else if(r==='no'){warm(p,-2,'they stood firm');tail='They stand firm against '+n+'.'}
    else tail='They walk away from '+n+' before it turns ugly.'}
  x.result=r;
  if(c){const what=n+' hears the company\'s answer: '+tail+' ('+sc.beats.map(b=>b.name+' '+b.k+(b.res?' ('+b.res+')':'')).join('; ')+')';
    sceneReply(c,p,a,what,line);
    if(r==='gone'||(x.why==='tense'&&r==='no'&&p.mood==='hostile'))endTalk(c,r==='gone'?'the company walked away':'it ended cold')}
  LOG(['Talk scene with '+n+': '+tail],{conv:x.conv,npc:x.npc,table:x.why,result:r});
  return tail}
setSceneKind('talk',{options,reflex,apply,outcome});
