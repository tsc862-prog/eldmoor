// Dynamic guilds (issue #56). The world starts with no guilds: heroes who keep company found
// one, others join, leaders rise and fall, quarrels split guilds and dwindling ones disband.
// Owned by character-builder (names, data) with ai-designer (the rules). DOM-free.
//
// S.GUILDS = [{id, name, tag, fac, founded, leaderId, clears, wipes, bosses, retired, disbanded?}]
// ids come from S.guildSeq and are never reused; retired guilds stay in the array so old
// chronicle lines, biographies and saves still resolve. a.guild is a guild object or null.
//
// Rules (guildsTick, every TICK real seconds):
//  1 Founding   3+ living unguilded same-faction heroes linked by party, bond >= FRIEND or the
//               same goal type, within NEAR_FOUND tiles (or all in town), found a guild; the
//               highest level leads. Up to MAX_FOUND heroes; one founding per faction per tick.
//  2 Joining    an unguilded hero joins the guild of their party leader, else of a close friend
//               (bond >= CLOSE); in town at level >= JOIN_LVL they may join the guild they know
//               best, else the largest guild of their faction under CAP.
//  3 Leadership the highest-level living member leads; the leader's death or a member out-levelling
//               them by 2+ passes the banner (logged).
//  4 Splits     a guild of 6+ with two or more blood-minded strangers to its leader (goals rival or
//               avengeHero, bond < FRIEND) has a 1-in-SPLIT_DAYS-per-day chance to lose them, with
//               their friends, to a new guild (at most a third of the members).
//  5 Disbanding fewer than 2 living members for DISBAND_DAYS game-days retires the guild.
import {rnd,pickA} from '../core/rng.js';
import {dist} from '../world/map.js';
import {FAC,genGuild} from '../data/factions.js';
import {S} from './state.js';
import {log} from './chronicle.js';
import {record} from './history.js';
import {bond,FRIEND,CLOSE} from './bonds.js';

export const CAP=12,MAX_FOUND=6,NEAR_FOUND=20,JOIN_LVL=3,SPLIT_DAYS=6,DISBAND_DAYS=7,TICK=5,JOIN_P=.2;
const DAY=1440;

const alive=a=>a&&a.state!=='dead';
const stats=()=>S.guildStats||(S.guildStats={founded:0,joined:0,succeeded:0,split:0,disbanded:0});
export const livingGuilds=()=>S.GUILDS.filter(g=>!g.retired);
export const membersOf=g=>S.agents.filter(a=>a.guild===g&&alive(a));
export const leaderOf=g=>S.agents.find(a=>a.id===g.leaderId&&a.guild===g&&alive(a))||null;
const tagTxt=g=>({t:'<'+g.tag+'> '+g.name,c:'f'+g.fac});
// "A, B and C" (first three named, the rest counted).
function names(list){const parts=[],n=Math.min(3,list.length);
  for(let i=0;i<n;i++){if(i>0)parts.push(i===n-1&&list.length===n?' and ':', ');parts.push(list[i])}
  if(list.length>n)parts.push(' and '+(list.length-n)+' others');return parts}

function newGuild(f,leader){
  const {name,tag}=genGuild(f,(nm,tg)=>S.GUILDS.some(g=>!g.retired&&(g.name===nm||g.tag===tg)));
  const g={id:S.guildSeq=(S.guildSeq||0)+1,name,tag,fac:f,founded:S.gameMin,leaderId:leader.id,clears:0,wipes:0,bosses:0,retired:false};
  S.GUILDS.push(g);return g}

function enroll(a,g,why){a.guild=g;record(a,why,tagTxt(g),'.')}

// ---- 1 founding ----
function linked(a,b){
  if(a.party&&a.party===b.party)return true;
  if(bond(a,b)<FRIEND&&!(a.goal&&b.goal&&a.goal.type===b.goal.type))return false;
  return (a.state==='town'&&b.state==='town')||dist(a,b)<=NEAR_FOUND}

function found(f){
  const un=S.agents.filter(a=>alive(a)&&a.fac===f&&!a.guild).sort((x,y)=>y.lvl-x.lvl);
  for(const root of un){
    const grp=[root],seen=new Set([root]);
    for(let i=0;i<grp.length&&grp.length<MAX_FOUND;i++)
      for(const b of un.slice().sort((x,y)=>bond(grp[i],y)-bond(grp[i],x))){
        if(grp.length>=MAX_FOUND)break;if(seen.has(b)||!linked(grp[i],b))continue;seen.add(b);grp.push(b)}
    if(grp.length<3)continue;
    const g=newGuild(f,root);for(const a of grp)enroll(a,g,'Raised a banner with comrades: ');
    stats().founded++;
    log(...names(grp),' raise a banner: ',tagTxt(g),'.');return true}
  return false}

// ---- 2 joining ----
function join(sizes){
  for(const a of S.agents){
    if(!alive(a)||a.guild)continue;
    let g=null,why='Joined ';
    const pl=a.party&&a.party.leader;
    if(pl&&pl!==a&&pl.guild&&pl.guild.fac===a.fac&&!pl.guild.retired&&(sizes.get(pl.guild)||0)<CAP){g=pl.guild;why='Followed a party leader into '}
    if(!g){let best=0;for(const b of S.agents){if(b===a||!alive(b)||!b.guild||b.guild.fac!==a.fac||(sizes.get(b.guild)||0)>=CAP)continue;
      const s=bond(a,b);if(s>=CLOSE&&s>best){best=s;g=b.guild;why='Joined a sworn companion in '}}}
    if(!g&&a.state==='town'&&a.lvl>=JOIN_LVL&&rnd()<JOIN_P){
      let best=0;const cand=livingGuilds().filter(x=>x.fac===a.fac&&(sizes.get(x)||0)<CAP);
      for(const x of cand){let s=0;for(const b of S.agents)if(b.guild===x&&alive(b))s+=bond(a,b);if(s>best){best=s;g=x}}
      if(!g&&cand.length){g=cand.slice().sort((x,y)=>(sizes.get(y)||0)-(sizes.get(x)||0))[0]}
      why='Signed the roll of '}
    if(!g)continue;
    enroll(a,g,why);sizes.set(g,(sizes.get(g)||0)+1);stats().joined++;
    if(rnd()<.4)log(a,' joins ',tagTxt(g),'.')}}

// ---- 3 leadership ----
function lead(g,mem){
  const cur=leaderOf(g),top=mem.slice().sort((x,y)=>y.lvl-x.lvl||x.id-y.id)[0];
  if(!top||top===cur)return;
  if(cur&&top.lvl<cur.lvl+2)return;
  g.leaderId=top.id;stats().succeeded++;record(top,'Took up the banner of ',tagTxt(g),'.');
  log(top,cur?' takes the banner of ':' leads ',tagTxt(g),cur?' from '+cur.name+'.':' now its leader has fallen.')}

// ---- 4 splits ----
function split(g,mem){
  if(mem.length<6||rnd()>1/(SPLIT_DAYS*DAY/(TICK*6)))return;
  const L=leaderOf(g);if(!L)return;
  const dissent=mem.filter(m=>m!==L&&m.goal&&!m.goal.done&&(m.goal.type==='rival'||m.goal.type==='avengeHero')&&bond(m,L)<FRIEND);
  if(dissent.length<2)return;
  const take=Math.max(2,Math.floor(mem.length/3)),out=dissent.slice(0,take);
  for(const f of mem.slice().sort((x,y)=>bond(dissent[0],y)-bond(dissent[0],x))){
    if(out.length>=take)break;if(f!==L&&!out.includes(f)&&bond(dissent[0],f)>=FRIEND)out.push(f)}
  if(out.length<2)return;
  const lead_=out.slice().sort((x,y)=>y.lvl-x.lvl)[0],ng=newGuild(g.fac,lead_);
  for(const a of out)enroll(a,ng,'Broke away from '+g.name+' to join ');
  stats().split++;
  log(...names(out),' break from ',tagTxt(g),' and raise ',tagTxt(ng),'.')}

// ---- 5 disbanding ----
function dwindle(g,mem){
  if(mem.length>=2){g.lowSince=undefined;return}
  if(g.lowSince===undefined){g.lowSince=S.gameMin;return}
  if(S.gameMin-g.lowSince<DISBAND_DAYS*DAY)return;
  g.retired=true;g.disbanded=S.gameMin;g.lowSince=undefined;stats().disbanded++;
  for(const a of mem){a.guild=null;record(a,tagTxt(g),' disbanded.')}
  log(tagTxt(g),' has dwindled and disbands',mem.length?'; '+mem[0].name+' carries on alone.':'.')}

export function guildsTick(dt){
  S.guildT=(S.guildT||0)+dt;if(S.guildT<TICK)return;S.guildT=0;
  for(let f=0;f<FAC.length;f++)found(f);
  const sizes=new Map();
  for(const a of S.agents)if(alive(a)&&a.guild){sizes.set(a.guild,(sizes.get(a.guild)||0)+1)}
  join(sizes);
  for(const g of livingGuilds()){const mem=membersOf(g);lead(g,mem);split(g,mem);dwindle(g,mem)}}

// Test hook for scripts: a random living guild of faction f, or null.
export const randomGuild=f=>{const l=livingGuilds().filter(g=>g.fac===f);return l.length?pickA(l):null};
