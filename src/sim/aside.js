// Whisper and emote (issue #627, owner's second tools review): two talk verbs beside say.
//   whisperTo(a,{to,text})  a line only one hero within ASIDE.WHISPER tiles hears ("(whispered) Kerin: ..."); everyone else
//                           in say-range sees only that the speaker leans close (a chat line with no words).
//   emoteAct(a,{text})      a wordless act ("spits in the fire") shown in italics to heroes in say-range and as a bubble;
//                           a chat line of kind emote, never speech (no escalation, no repeat refusal against say).
// Hearers come from the same helper say uses (sayHearers in chat.js). In-game channels only (#123): the words reach the
// target's own chat buffer, nothing else; the watcher's Chat tab shows them (the owner sees everything). Agent heroes only
// (the tools are the agent's); no RNG, no state in the scripted sim, so seeded worlds are unchanged.
import {WORDS} from '../world/words.js';
import {S,clockStr,dayNo} from './state.js';
import {dist} from '../world/map.js';
import {nearHeroes} from './spatial.js';
import {sayHearers,agentLine,HEAR,CAP as CHAT_CAP,BUBBLE} from './chat.js';
import {spokenLine} from './council.js';
import {MSG_SAME} from './talk.js';
import {notEnglish} from './lang.js';
import {inSlots,slotted} from './company.js';
import {sceneOf} from './scenes.js';

export const ASIDE={WHISPER:2,WHISPER_LEN:200,WHISPER_PER_HOUR:6,EMOTE_LEN:120,EMOTE_PER_HOUR:10,SAME:.8};
const MSG_EMOTE_SAME='You already did that. Do something else, speak, or wait.';
const ENGLISH='Not said: speak in English. Everyone in '+WORDS.world+' speaks English; say it again in English.';
const r1=v=>Math.round(v*10)/10;
const push=(b,e)=>{(b.chat||(b.chat=[])).push(e);if(b.chat.length>CHAT_CAP)b.chat.shift()};
const first=n=>String(n||'').split(' ')[0];
// Roll an hourly allowance on the hero: refused with when it frees up.
function allow(a,key,max,what){const st=a[key]||(a[key]=[]);while(st.length&&st[0]<S.gameMin-60)st.shift();
  if(st.length>=max)return 'Enough '+what+' for one game hour ('+max+'); try again in about '+Math.ceil(st[0]+60-S.gameMin)+' game minutes.';
  return null}
const stampE=(a,text,extra)=>agentLine(a,{t:clockStr(),d:dayNo(),from:a,text,trigger:'agent',...extra});
const tagAgent=(a,e)=>e;
function fhOf(a,hs){return !!(slotted()&&(inSlots(a)||hs.some(b=>inSlots(b))))}

export function whisperTo(a,{to,text,target,name,who,hero_id}){
  const fail=error=>({ok:false,error});
  if(a.state==='ghost')return fail('Ghosts do not whisper.');
  const L=spokenLine(a,text,ASIDE.WHISPER_LEN);if(L.error)return fail(L.error==='Say what?'?'Whisper what? whisper takes to (a hero near you) and text.':L.error);
  if(notEnglish(L.text))return fail(ENGLISH);
  const q=String(to!=null&&to!==''?to:target!=null&&target!==''?target:name!=null&&name!==''?name:who!=null&&who!==''?who:hero_id!=null?hero_id:'').trim().toLowerCase();
  if(!q)return fail('Whisper to whom? Heroes within '+ASIDE.WHISPER+' tiles: '+(close(a).map(b=>b.name).join(', ')||'none')+'.');
  const all=nearHeroes(a.x,a.y,HEAR*2).filter(b=>b!==a&&b.state!=='dead'&&!b.hidden);
  const b=all.find(x=>String(x.id)===q||x.name.toLowerCase()===q)||all.find(x=>first(x.name).toLowerCase()===q)||all.find(x=>x.name.toLowerCase().startsWith(q))||null;
  if(!b)return fail('Nobody called "'+q+'" is near. Heroes within '+ASIDE.WHISPER+' tiles: '+(close(a).map(x=>x.name).join(', ')||'none')+'.');
  if(dist(a,b)>ASIDE.WHISPER)return fail(b.name+' is '+r1(dist(a,b))+' tiles away: a whisper reaches '+ASIDE.WHISPER+'. Walk closer (move_to), or say it aloud.');
  const no=(a.talkSaid||[]).some(s=>sameLine(s,L.text))?MSG_SAME:null;if(no)return fail(no);
  const lim=allow(a,'whispAt',ASIDE.WHISPER_PER_HOUR,'whispers');if(lim)return fail(lim);
  a.whispAt.push(S.gameMin);
  const hs=sayHearers(a).filter(x=>x!==b),fh=fhOf(a,[b,...hs]);
  const e=tagAgent(a,stampE(a,L.text,{whisper:true,to:b.id,toName:b.name}));if(S.table&&S.table.ctx)e.scene=true;if(fh)e.fh=true;
  push(a,e);push(b,e);
  const L2=a.talkSaid||(a.talkSaid=[]);L2.push(L.text.slice(0,200));if(L2.length>5)L2.shift();
  (b.talkHeard||(b.talkHeard={}))[a.id]=1;
  // everyone else in sight sees only that the speaker leans close (no words)
  const v=tagAgent(a,stampE(a,'leans close to '+b.name,{emote:true,veil:true,to:b.id}));if(S.table&&S.table.ctx)v.scene=true;if(fh)v.fh=true;
  for(const x of hs)push(x,v);
  const sc=sceneOf(a);if(sc&&sc.ids.includes(b.id))sc.narr={t:v.t,text:a.name+' leans close to '+b.name+'.'}; // the Table banner and tableView: the fact of it, never the words (#646)
  return {ok:true,whispered_to:b.name,text:L.text,seen_by:hs.map(x=>x.name),note:'Only '+b.name+' heard the words; '+(hs.length?hs.map(x=>x.name).join(', ')+' saw you lean close.':'nobody else is near.')}}

const close=a=>nearHeroes(a.x,a.y,ASIDE.WHISPER).filter(b=>b!==a&&b.state!=='dead'&&!b.hidden&&dist(a,b)<=ASIDE.WHISPER);
export const whisperHearers=close;
function sameLine(x,y){const W=s=>new Set(String(s).toLowerCase().match(/[a-z']+/g)||[]);const A=W(x),B=W(y);if(!A.size||!B.size)return false;let n=0;for(const w of A)if(B.has(w))n++;return n/Math.max(A.size,B.size)>=ASIDE.SAME}

export function emoteAct(a,{text}){
  const fail=error=>({ok:false,error});
  if(a.state==='ghost')return fail('Ghosts leave no sign.');
  let t=String(text==null?'':text).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/["\u201c\u201d*]/g,'').replace(/\s+/g,' ').trim();
  const nm=String(a.name).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),re=new RegExp('^'+nm+'\\s+','i');t=t.replace(re,'').trim(); // a leading own name is dropped (the line is shown as "<you> <line>"); the escapes were unescaped before and never matched
  if(!t)return fail('Emote what? emote takes text: a short act, like "spits in the fire".');
  if(t.length>ASIDE.EMOTE_LEN)return fail('Too long: keep an emote under '+ASIDE.EMOTE_LEN+' characters (this was '+t.length+').');
  if(notEnglish(t))return fail(ENGLISH);
  const R=a.emoteSaid||(a.emoteSaid=[]); // the same repeat rule as say (#801): one of the last 5 emotes or lines, or 80% alike
  if(R.some(s=>sameLine(s,t))||(a.talkSaid||[]).some(s=>sameLine(s,t)))return fail(MSG_EMOTE_SAME);
  const lim=allow(a,'emoteAt',ASIDE.EMOTE_PER_HOUR,'gestures');if(lim)return fail(lim);
  a.emoteAt.push(S.gameMin);R.push(t);if(R.length>5)R.shift();
  const hs=sayHearers(a),fh=fhOf(a,hs);
  const e=tagAgent(a,stampE(a,t,{emote:true}));if(S.table&&S.table.ctx)e.scene=true;if(fh)e.fh=true;
  push(a,e);for(const b of hs)push(b,e);
  a.bubble={text:'*'+t+'*',life:BUBBLE*2,...(fh?{fh:true}:{})};
  if(!hs.length)return {ok:true,emoted:t,seen_by:[],act:false,note:'no one is near to see it'}; // an unseen act changes nothing in the world (#801)
  return {ok:true,emoted:t,seen_by:hs.map(x=>x.name)}}

// Earshot's whisper line: who is close enough to whisper to.
export function whisperLine(a){const c=close(a).sort((x,y)=>dist(a,x)-dist(a,y)||x.id-y.id);return c.length?c.map(b=>b.name):[]}
