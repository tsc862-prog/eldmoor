// Hero tool: pay (#628). Gold moves from an agent hero to a hero within PAY.RANGE tiles (any faction) or to a townsperson or
// placed person within it: a companion's share, an innkeeper's tip, a guard's bribe, a debt. Agent heroes only (the tool is
// theirs); no RNG. Both sides record it; the payer keeps a memory tagged gold; a person paid warms by one attitude step per
// PAY.STEP gold (set_attitude, so the DM log sees it, at most PAY.DAY_STEPS steps a game day) and remembers it (p.hmem).
import {S} from './state.js';
import {dist} from '../world/map.js';
import {nearHeroes} from './spatial.js';
import {record} from './history.js';
import {ev} from './notify.js';
import {act as chatAct} from './chat.js';
import {bondEvent} from './bonds.js';
import {vowPaid} from './vows.js';
import {addHeroNote} from './notebook.js';
import {findPerson} from './talk.js';
import {pull,attitudeOf} from './levers.js';

const DAY=1440;
export const PAY={RANGE:4,STEP:10,DAY_STEPS:2,WHY_MAX:80,MAX:100000};
const ORDER=['hostile','wary','neutral','friendly'];
const full=p=>(p.title?p.title+' ':'')+p.name;
const nk=s=>String(s==null?'':s).toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();

// The hero a name or id points at, within range; any faction, living, in the open.
function heroNear(a,to){const k=nk(to);if(!k)return null;
  return nearHeroes(a.x,a.y,PAY.RANGE+1).filter(b=>b!==a&&b.state!=='dead'&&b.hidden!==true&&dist(a,b)<=PAY.RANGE)
    .find(b=>String(b.id)===k||nk(b.name)===k||nk(b.name).split(' ')[0]===k)||null}

// A tip warms a person: one step per PAY.STEP gold, at most PAY.DAY_STEPS a game day, through the set_attitude lever.
function warm(a,p,gold){const day=Math.floor(S.gameMin/DAY),W=p.paid||(p.paid={});if(W.day!==day){W.day=day;W.steps=0}
  const room=PAY.DAY_STEPS-(W.steps||0),want=Math.floor(gold/PAY.STEP);const n=Math.min(room,want);if(n<=0)return null;
  const was=attitudeOf(p,[a]),i=ORDER.indexOf(was),to=ORDER[Math.min(ORDER.length-1,i+n)];if(to===was){W.steps+=n;return null}
  const r=pull('set_attitude',{npc:p.id,to:'hero',id:a.id,attitude:to,hours:24},{by:'agent',reason:a.name+' paid '+full(p)+' '+gold+' gold'});
  if(r&&r.ok!==false){W.steps+=n;return to}return null}

// Returns {ok,...} or {error}. Checks that need the tool's words (English, a fight round) are the handler's.
export function pay(a,{to,gold,why}){
  const g=Math.round(Number(gold));
  if(!Number.isFinite(g)||g<=0)return {error:'Pay how much? gold must be a whole number above zero.'};
  if(g>PAY.MAX)return {error:'That is more than anyone carries. Pay a smaller sum.'};
  if(g>Math.floor(a.gold||0))return {error:'You hold '+Math.floor(a.gold||0)+' gold, not '+g+'.'};
  if(to==null||String(to).trim()==='')return {error:'Pay whom? to: a hero\'s name or id within '+PAY.RANGE+' tiles, or a townsperson by name or role.'};
  const w=String(why||'').replace(/\s+/g,' ').trim().slice(0,PAY.WHY_MAX),tail=w?' (for '+w.replace(/^for\s+/i,'')+')':'';
  const b=heroNear(a,to);
  if(b){a.gold-=g;b.gold=(b.gold||0)+g;
    const line='pays '+b.name+' '+g+' gold'+tail;chatAct(a,line,'pay');
    record(a,'Paid ',b,' '+g+' gold'+tail+'.');record(b,'Was paid '+g+' gold by ',a,tail+'.');
    ev(b,a.name+' pays you '+g+' gold'+tail+'.',true);
    if(a.company!=null&&a.company===b.company)bondEvent(a,'paid',[b]);
    vowPaid(a,b);
    note(a,b.name,g,w);return {ok:true,paid:b.name,gold:g,left:Math.floor(a.gold),note:b.name+' has it now.'}}
  const p=findPerson(a,to,PAY.RANGE);
  if(p&&p.far)return {error:full(p.far)+' is too far away ('+Math.round(p.d*10)/10+' tiles). Come within '+PAY.RANGE+' tiles.'};
  if(!p)return {error:'No one called "'+String(to).slice(0,40)+'" within '+PAY.RANGE+' tiles. Heroes and townspeople are paid by name; look or earshot shows who is near.'};
  a.gold-=g;const line='pays '+full(p)+' '+g+' gold'+tail;chatAct(a,line,'pay');
  record(a,'Paid '+full(p)+' '+g+' gold'+tail+'.');
  const H=p.hmem||(p.hmem={}),m=H[a.id]||(H[a.id]={n:0});m.paid=(m.paid||0)+g;m.payAt=Math.round(S.gameMin);m.payWhy=w||undefined;m.gm=m.gm??Math.round(S.gameMin);
  p.purse=(p.purse||0)+g;
  const to2=warm(a,p,g);note(a,full(p),g,w);
  return {ok:true,paid:full(p),gold:g,left:Math.floor(a.gold),note:to2?full(p)+' warms to you ('+to2+').':full(p)+' takes it and nods.'}}

function note(a,who,g,why){try{addHeroNote(a,{title:'Paid '+who+' '+g+' gold',text:'I paid '+who+' '+g+' gold'+(why?' for '+why:'')+' on day '+(Math.floor(S.gameMin/DAY)+1)+'.',tags:['gold'],about:who,pin:false})}catch(e){}}
