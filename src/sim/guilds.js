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
import {S,noOthers,loreSides} from './state.js';
import {log} from './chronicle.js';
import {record} from './history.js';
import {bond,FRIEND,CLOSE} from './bonds.js';
import {hasLinks} from './runlink.js';

export const CAP=12,MAX_FOUND=6,NEAR_FOUND=20,JOIN_LVL=3,SPLIT_DAYS=6,DISBAND_DAYS=7,TICK=5,JOIN_P=.2;
const DAY=1440;

const alive=a=>a&&a.state!=='dead';
// A world with no others (#780) raises no banner around a company: its people and their companions stay out of the guilds. Heroes the DM summons found and join as ever.
// With a host that reports runner links (#954) a company member or agent-played hero never founds or joins a guild by script: that is the agent's own decision (guild_found, guild_join). Hostless worlds (npm run sim, the seeded checks) keep the script.
const open=a=>!(noOthers()&&(a.company!=null||a.companion!=null))&&!(hasLinks()&&(a.company!=null||a.player));
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
  const un=S.agents.filter(a=>alive(a)&&a.fac===f&&!a.guild&&open(a)).sort((x,y)=>y.lvl-x.lvl);
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
    if(!alive(a)||a.guild||!open(a))continue;
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


// ---- agent choice (#954): guild_join and guild_found, called from player.js at a town ----
export function guildJoinFor(a,name){
  if(a.guild)return {ok:false,why:'You already wear <'+a.guild.tag+'> '+a.guild.name+'. guild_leave lets you go, and you would carry the memory of it.'};
  if(a.lvl<JOIN_LVL)return {ok:false,why:'A guild roll is signed at level '+JOIN_LVL+' or above; you are level '+a.lvl+'.'};
  const sizes=new Map();for(const x of S.agents)if(x.guild&&alive(x))sizes.set(x.guild,(sizes.get(x.guild)||0)+1);
  const cand=livingGuilds().filter(x=>x.fac===a.fac&&(sizes.get(x)||0)<CAP);
  if(!cand.length)return {ok:false,why:'No guild of your '+(loreSides()?'people':'side')+' has a place open. guild_found raises one if two comrades stand with you.'};
  let g=null;const q=name!=null?String(name).trim().toLowerCase().replace(/^</,''):'';
  if(q){g=cand.find(x=>x.name.toLowerCase()===q||x.tag.toLowerCase()===q.replace(/>.*/,'')||x.name.toLowerCase().includes(q));
    if(!g)return {ok:false,why:'No open guild of your '+(loreSides()?'people':'side')+' matches "'+name+'". Open: '+cand.map(x=>'<'+x.tag+'> '+x.name+' ('+(sizes.get(x)||0)+')').join(', ')+'.'}}
  else return {ok:true,choose:cand.map(x=>({guild:x.name,tag:x.tag,members:sizes.get(x)||0,leader:(leaderOf(x)||{}).name||null})),how:'guild_join {guild: "<name or tag>"}'};
  enroll(a,g,'Signed the roll of ');stats().joined++;log(a,' joins ',tagTxt(g),'.');
  return {ok:true,joined:'<'+g.tag+'> '+g.name}}

export function guildFoundFor(a){
  if(a.guild)return {ok:false,why:'You already wear <'+a.guild.tag+'> '+a.guild.name+'.'};
  if(a.lvl<JOIN_LVL)return {ok:false,why:'A banner is raised at level '+JOIN_LVL+' or above; you are level '+a.lvl+'.'};
  // comrades: unguilded same-faction heroes the script may enrol (not company members or agent heroes, who choose for themselves) linked to the founder
  const mates=S.agents.filter(b=>b!==a&&alive(b)&&b.fac===a.fac&&!b.guild&&open(b)&&linked(a,b)).sort((x,y)=>bond(a,y)-bond(a,x)).slice(0,MAX_FOUND-1);
  if(mates.length<2)return {ok:false,why:'A banner needs three: you and two comrades of your '+(loreSides()?'people':'side')+', unguilded and close by or in town together. Only '+mates.length+' stand with you.'};
  const g=newGuild(a.fac,a);for(const m of [a,...mates])enroll(m,g,'Raised a banner with comrades: ');
  stats().founded++;log(a,' raises a banner with ',...names(mates.map(m=>m.name)),': ',tagTxt(g),'.');
  return {ok:true,founded:'<'+g.tag+'> '+g.name,with:mates.map(m=>m.name)}}

// ---- leaving (#954 follow-up): a choice is reversible. Words and the roll only; bonds and grudges stay as they are. ----
export function guildLeaveFor(a){
  const g=a.guild;if(!g)return {ok:false,why:'You wear no guild.'};
  a.guild=null;a.guildLeftAt=S.gameMin;record(a,'Struck my name from the roll of ',tagTxt(g),'.');
  log(a,' leaves ',tagTxt(g),'.');
  return {ok:true,left:'<'+g.tag+'> '+g.name,note:'Its Crypt parties and rivals are no longer yours; you may sign another roll or raise a banner.'}}

// ---- a word at the gate (#954 follow-up): hints that open guilds exist, for a level-3+ unguilded hero in town; words only, nothing is joined. ----
export const HINT_DAYS=3;
export function guildWord(a){
  if(a.guild||a.lvl<JOIN_LVL)return null;
  if(a.guildHintAt!=null&&S.gameMin-a.guildHintAt<HINT_DAYS*DAY)return null;
  const sizes=new Map();for(const x of S.agents)if(x.guild&&alive(x))sizes.set(x.guild,(sizes.get(x)||0)+1);
  const open=livingGuilds().filter(x=>x.fac===a.fac&&(sizes.get(x)||0)<CAP);
  if(!open.length)return null;
  a.guildHintAt=S.gameMin;
  const names=open.slice(0,3).map(x=>'<'+x.tag+'> '+x.name).join(', ');
  return 'The gate captain says banners of your side still take new names on their rolls: '+names+'. A blade of your standing could sign one (guild_join), or raise its own with two comrades (guild_found).'}
