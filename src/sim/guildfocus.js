// Guild focus (issue #6, second slice). Owned by ai-designer. DOM-free, no RNG.
//
// Each living guild's leader sets a focus that steers what its members do:
//   open       no focus (the neutral setting): every roll and pick is exactly as without this module.
//   crypt      Delve: the guild is GF.CRYPT_W times as likely to be the one called up for a Crypt group.
//   raid       Wyrmhunt: its members muster first for the world boss, and a core of GF.RAID_CORE of them
//              can raid without the average-gear check a short raid normally needs.
//   adventure  Wayfaring: its leaders take a fitting DM hook at the gate GF.TAKE of the time (K.TAKE otherwise).
//   pvp        Warpath: chance duels involving a member roll at GF.DUEL odds, guildmates assist at GF.ASSIST.
// Every effect multiplies or reorders an existing roll (one dice call either way), so a world in which
// no guild has a focus, or GF.ON is false, rolls exactly as before.
//
// The leader chooses from the guild's state (no dice): who is strong enough for the Crypt (CRYPT_LVL) or
// the boss (RAID_LVL), the leader's and members' oaths (cryptPull, raidPull, blood oaths), declared
// rivalries, the guild's record and the leader's temper. A focus is weighed every GF.EVERY game minutes
// and when the banner passes; a sitting focus is kept unless another beats it by GF.STICK (a new leader
// may change it freely). Changes go to the chronicle and the timeline (kind 'guild').
//
// The Fellowship stays out, as with rivalries: a guild with a living Fellowship member has no focus, and
// no Fellowship hero's odds ever change.
//
// State: g.focus ('open' when absent), g.focusAt (game minute weighed), g.focusLead (leader id then);
// S.focusStats = {set, changed, by:{focus:n}, duels, assists, crypt, raids, hooks}.
import {S} from './state.js';
import {log} from './chronicle.js';
import {timeline,record} from './history.js';
import {tm} from '../data/traits.js';
import {CRYPT} from '../world/map.js';
import {BOSSES} from '../data/bosses.js';
import {livingGuilds,membersOf,leaderOf} from './guilds.js';
import {cryptPull,raidPull} from './goals.js';
import {rivalsOf} from './rivals.js';
import {CRYPT_LVL} from './dungeon.js';
import {RAID_LVL} from './boss.js';

export const GF={ON:true,EVERY:1440,STICK:.75,CRYPT_W:3,RAID_CORE:3,TAKE:.98,DUEL:1.3,ASSIST:1.3,TICK:30};
export const FOCI=['open','crypt','raid','adventure','pvp'];
export const FOCUS_NAME={open:'No focus',crypt:'Delve',raid:'Wyrmhunt',adventure:'Wayfaring',pvp:'Warpath'};

const stats=()=>S.focusStats||(S.focusStats={set:0,changed:0,by:{},duels:0,assists:0,crypt:0,raids:0,hooks:0});
const tagTxt=g=>({t:'<'+g.tag+'> '+g.name,c:'f'+g.fac});
const hasFellow=g=>S.agents.some(a=>a.guild===g&&a.fellow&&a.state!=='dead');
const blood=a=>!!(a.goal&&!a.goal.done&&(a.goal.type==='rival'||a.goal.type==='avengeHero'));
const bossName=()=>(BOSSES[(S.boss&&S.boss.tpl)||'kragmaw']||{name:'the wyrm'}).name;

// The focus steering hero a (or 'open': unguilded, the Fellowship, focus off).
export function focusOf(a){if(!GF.ON||!a||a.fellow||!a.guild||a.guild.retired)return 'open';return a.guild.focus||'open'}
export const guildFocus=g=>!GF.ON||!g||g.retired?'open':g.focus||'open';
export const isFocus=(a,f)=>focusOf(a)===f;
export function focusCount(kind){stats()[kind]++}

// How much each focus suits guild g under leader L right now (null = not open to them).
export function focusScores(g,L,mem){
  const deep=mem.filter(a=>a.lvl>=RAID_LVL).length,crypt=mem.filter(a=>a.lvl>=CRYPT_LVL).length;
  const sum=f=>mem.reduce((t,a)=>t+f(a),0),bold=tm(L,'bold')>1.1,careful=tm(L,'retreat')>1;
  const out={adventure:1.25+(careful?.5:0)};
  if(crypt>=3)out.crypt=1.5+cryptPull(L)*2+sum(cryptPull)*.25+Math.min(1,g.clears*.2)-(g.wipes>g.clears+1?.75:0);
  if(deep>=4)out.raid=2+raidPull(L)*2+sum(raidPull)*.25+(g.bosses?.5:0)+(bold?.25:0);
  const rv=rivalsOf(g).length,bl=sum(a=>blood(a)?1:0);
  if(blood(L)||rv)out.pvp=.5+(blood(L)?1.5:0)+bl*.3+(rv?1:0)+(bold?.5:0)-(careful?.5:0);
  return out}

function why(f,g,L){switch(f){
  case 'crypt':return [' turns its banner to the ',{t:FOCUS_NAME.crypt,c:'gd'},': ',L,' will lead them down into ',{t:CRYPT.name,c:'gd'},'.'];
  case 'raid':return [' takes up the ',{t:FOCUS_NAME.raid,c:'gd'},': ',L,' means to bring down ',{t:bossName(),c:'gd'},'.'];
  case 'adventure':return [' goes ',{t:FOCUS_NAME.adventure,c:'gd'},': ',L,' sends them after the jobs on the town boards.'];
  case 'pvp':return [' is on the ',{t:FOCUS_NAME.pvp,c:'gd'},': ',L,' wants enemy blood on the roads.']}
  return [' lets its focus lapse.']}

function weigh(g,mem){
  const L=leaderOf(g);if(!L)return;
  const cur=g.focus||'open',newLead=g.focusLead!==L.id;g.focusAt=S.gameMin;g.focusLead=L.id;
  const sc=focusScores(g,L,mem);let best=null,bv=-Infinity;
  for(const f of FOCI)if(sc[f]!=null&&sc[f]>bv){best=f;bv=sc[f]}
  if(!best||best===cur)return;
  if(!newLead&&sc[cur]!=null&&bv<sc[cur]+GF.STICK)return;
  g.focus=best;const st=stats();st.by[best]=(st.by[best]||0)+1;if(cur==='open')st.set++;else st.changed++;
  for(const a of mem)record(a,tagTxt(g),' turned to ',{t:FOCUS_NAME[best],c:'gd'},' under ',L,'.');
  const parts=[tagTxt(g),...why(best,g,L)];log(...parts);timeline('guild',...parts)}

// Weigh each living guild every GF.EVERY game minutes, or at once when its banner has passed (from index.js).
export function focusTick(){
  if(!GF.ON)return;if(S.focusT!=null&&S.gameMin-S.focusT<GF.TICK)return;S.focusT=S.gameMin;
  for(const g of livingGuilds()){
    if(hasFellow(g)){if(g.focus&&g.focus!=='open')g.focus='open';continue}
    const L=leaderOf(g);if(!L)continue;
    if(g.focusAt!=null&&g.focusLead===L.id&&S.gameMin-g.focusAt<GF.EVERY)continue;
    weigh(g,membersOf(g))}}

// ---- the hooks the other systems read (each returns the neutral value when no focus applies) ----
// dungeonCheck: the weight of guild g when one is picked for a Crypt group.
export const cryptWeight=g=>guildFocus(g)==='crypt'&&!hasFellow(g)?GF.CRYPT_W:1;
// raidCheck: 1 to sort a Wyrmhunt member ahead of others with the same oath pull, else 0.
export const raidFirst=a=>focusOf(a)==='raid'?1:0;
// raidCheck: true when cand holds a Wyrmhunt core that may go without the gear check.
export function raidCore(cand){if(!GF.ON)return false;const n=new Map();
  for(const a of cand)if(focusOf(a)==='raid')n.set(a.guild,(n.get(a.guild)||0)+1);
  for(const v of n.values())if(v>=GF.RAID_CORE)return true;return false}
// dm.js dmDepart: the chance this leader takes a fitting hook (base: the DM's K.TAKE).
export const takeChance=(a,base)=>focusOf(a)==='adventure'?Math.max(base,GF.TAKE):base;
// pvp.js: the chance-duel multiplier for a and b (a Warpath member on either side), and the assist multiplier for guildmate g.
export const duelFocus=(a,b)=>a.fellow||b.fellow?1:focusOf(a)==='pvp'||focusOf(b)==='pvp'?GF.DUEL:1;
export const assistFocus=(g,foe)=>foe&&foe.fellow?1:focusOf(g)==='pvp'?GF.ASSIST:1;
