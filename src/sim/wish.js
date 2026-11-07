// wish (issue #663): the DM and the heroes leave a note for the people who build the game about a tool they wished
// they had to tell their story. It goes to the watcher and the builders only (never to the game's other seats: the
// in-game channels rule of #123 holds), like the DM log's log_intent line. Nobody answers it in play and nothing changes.
//
//   wish {tool, what, why, moment}   tool: the name the agent would give it (2-32 characters, free text accepted);
//                                    what: what it would have done (300); why: why this moment needed it (200);
//                                    moment: the moment itself, a sentence of story (200). English only.
//   WISH.PER_DAY a game day per seat, so the agent picks the ones that mattered. act:false on both seats.
//
// State: the hero keeps its last WISH.KEEP in a.wishes (+ a.wishDay), the DM in S.dmAgent.wishes (+ wishDay), saved with
// the world for the Agent tab and the DM panel. The host appends each wish to logs/behavior/<world>/wishes.jsonl through the
// behavior watch (sim/behavior.js drains the outbox below); the outbox is a plain module queue that holds no world state
// and rolls no dice, so a seeded world is unchanged. No tool reads a wish back.
import {WORDS} from '../world/words.js';
import {notEnglish} from './lang.js';
import {dayNo,clockStr,S} from './state.js';

export const WISH={PER_DAY:3,TOOL_MIN:2,TOOL_MAX:32,WHAT:300,WHY:200,MOMENT:200,KEEP:20,OUT:200};
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const ENGLISH='Not filed: write it in English, as everyone in '+WORDS.world+' speaks.';
const out=[];
// Records for the builders' file (the watch takes them; a host with no watch lets the queue stay short).
export function takeWishes(){return out.splice(0,out.length)}
export function queueWish(rec){out.push(rec);while(out.length>WISH.OUT)out.shift()}

// holder: the hero or S.dmAgent; who: {seat:'dm'|'hero:<id>', name, place, summary}.
export function fileWish(holder,who,args){
  const a=args&&typeof args==='object'?args:{};
  const tool=clean(a.tool,WISH.TOOL_MAX+40).replace(/\s+/g,'_'),what=clean(a.what,WISH.WHAT+1),why=clean(a.why,WISH.WHY+1),moment=clean(a.moment,WISH.MOMENT+1);
  if(tool.length<WISH.TOOL_MIN||tool.length>WISH.TOOL_MAX)return {ok:false,error:'tool: the name you would give it, '+WISH.TOOL_MIN+'-'+WISH.TOOL_MAX+' characters (snake_case suggested).'};
  if(!what)return {ok:false,error:'what: say what it would have done.'};
  if(what.length>WISH.WHAT)return {ok:false,error:'what is too long (max '+WISH.WHAT+' characters).'};
  if(!why)return {ok:false,error:'why: say why this moment needed it.'};
  if(why.length>WISH.WHY)return {ok:false,error:'why is too long (max '+WISH.WHY+' characters).'};
  if(!moment)return {ok:false,error:'moment: the moment itself, a sentence of story.'};
  if(moment.length>WISH.MOMENT)return {ok:false,error:'moment is too long (max '+WISH.MOMENT+' characters).'};
  for(const t of [tool,what,why,moment])if(notEnglish(t))return {ok:false,error:ENGLISH};
  const d=dayNo(),wd=holder.wishDay&&holder.wishDay.d===d?holder.wishDay:(holder.wishDay={d,n:0});
  if(wd.n>=WISH.PER_DAY)return {ok:false,error:'Enough wishes for one game day ('+WISH.PER_DAY+'): save the rest for tomorrow, and pick the ones that mattered.'};
  wd.n++;
  const w={id:(holder.wishSeq=(holder.wishSeq||0)+1),day:d,clock:clockStr(),gameMin:Math.round(S.gameMin),place:who.place||null,tool,what,why,moment};
  (holder.wishes||(holder.wishes=[])).unshift(w);if(holder.wishes.length>WISH.KEEP)holder.wishes.length=WISH.KEEP;
  queueWish({type:'wish',seat:who.seat,name:who.name||null,day:d,clock:w.clock,gameMin:w.gameMin,place:w.place,tool,what,why,moment,summary:clean(who.summary,200)});
  return {ok:true,filed:tool,left_today:WISH.PER_DAY-wd.n,note:'Noted for the people who build the game. It is read later and never answered in play; nothing changes this session.'};
}
// The invitation (#829): one sentence at the end of a refusal whose cause is a missing capability, at most once a game day per
// holder (the hero, or S.dmAgent). It costs no call and no turn; holder.wishInv is a day number, saved with the holder.
export const WISH_INVITE='If you wished you had this, say so with wish {tool, what, why, moment} (read later by the builders; nothing changes now).';
export function wishInvite(holder){const d=dayNo();if(!holder||holder.wishInv===d)return '';holder.wishInv=d;return ' '+WISH_INVITE}
export const wishesOf=holder=>holder&&holder.wishes?holder.wishes.slice():[];
