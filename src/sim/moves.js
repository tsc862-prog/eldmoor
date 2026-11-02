// Class abilities (issue #81): the one resolver for active moves, the scripted policy that picks them,
// and the views the UI and agents read. Owned by character-builder; the data is data/moves.js.
//
// Two ways to play the same move:
//   real-time   a cooldown in sim seconds (a.mcd[id] is the expiry, S.gameMin / 6, so it stops with the world)
//   Table       a cooldown in rounds (a.mcr[id] rounds left; tickRound(a) once per round) and effects counted in rounds
// useMove(a, id, target, {mode:'sec'|'round', mates, foe}) applies the effect either way. Using a move starts both
// cooldowns, so a Table use and a field use share one gate.
//
// Attack moves ("swing" in the data) take the place of a weapon blow; every other move is a free action.
// Agent-played heroes (a.player) choose their own moves (tool use_ability); the policy never fires for them.
import {rnd,ri} from '../core/rng.js';
import {WALKABLE} from '../world/tiles.js';
import {zoneAt,tileAt,dist} from '../world/map.js';
import {CLS} from '../data/classes.js';
import {MOVES,CLASS_MOVES,PASSIVES} from '../data/moves.js';
import {profBonus} from '../data/abilities.js';
import {S,clockStr} from './state.js';
import {pop} from './effects.js';
import {strike,maxHp} from './heroes.js';
import {mod} from './abilities.js';
import {bondEvent} from './bonds.js';
import {nearMobs} from './spatial.js';
import {setEff,effOn,effLeft,passivesOf,passiveMul,eachRound} from './eff.js';

const now=()=>S.gameMin/6;
const living=e=>e&&(e.kind==='hero'?e.state!=='dead'&&e.state!=='ghost':e.kind==='boss'?e.alive:e.alive&&!e.gone);
const full=e=>e.kind==='hero'?maxHp(e):e.maxhp;
const hpf=e=>e.hp/full(e);

// ---- what a hero has ----
export const movesOf=a=>(CLASS_MOVES[a.cls]||[]).filter(id=>MOVES[id].lvl<=(a.lvl||1));
export const cdLeft=(a,id)=>Math.max(0,Math.round((((a.mcd&&a.mcd[id])||0)-now())*10)/10);
export const roundsLeft=(a,id)=>Math.max(0,(a.mcr&&a.mcr[id])||0);
export const ready=(a,id,mode)=>mode==='round'?roundsLeft(a,id)<=0:cdLeft(a,id)<=0;
// A round at the Table: round cooldowns and round-counted effects run down.
export function tickRound(a){if(a.mcr)for(const id in a.mcr)if(a.mcr[id]>0)a.mcr[id]--;eachRound(a)}
const rangeOf=(a,M)=>M.range==='weapon'?CLS[a.cls].range+.4:M.range;

// ---- saves ----
// The foe rolls d20 + its modifier against 8 + your stat modifier + training. Monsters: a quarter of their level.
function foeSave(a,M,e){const S_=M.save;if(!S_)return false;
  const dc=8+mod(a,S_.stat)+profBonus(a.lvl||1);
  const m=e.kind==='hero'?mod(e,S_.abil)+profBonus(e.lvl||1):Math.floor((e.lvl||1)/4)+(e.elite?2:0)+(e.kind==='boss'?4:0);
  return ri(1,20)+m>=dc}

// ---- validity ----
// Returns an error string, or null when the move can be used now. t: the foe or ally (or null for self / area moves).
export function canUse(a,id,t,mode='sec'){const M=MOVES[id];
  if(!M||M.cls!==a.cls)return 'You have no such ability ('+id+').';
  if(M.lvl>(a.lvl||1))return M.name+' is learned at level '+M.lvl+'.';
  if(!living(a)||a.hidden)return 'You cannot use abilities now.';
  if(!ready(a,id,mode))return M.name+' is not ready ('+(mode==='round'?roundsLeft(a,id)+' more round(s)':cdLeft(a,id)+' s')+').';
  if(M.cost&&M.cost.hp&&a.hp<=maxHp(a)*M.cost.hp+1)return 'Too hurt to pay for '+M.name+'.';
  if(M.target==='foe'){if(!t||!living(t)||t===a)return M.name+' needs a living foe.';
    if(t.kind==='hero'&&t.fac===a.fac&&a.state!=='duel'&&a.state!=='assist')return M.name+' is for foes.';
    if(mode!=='round'&&dist(a,t)>rangeOf(a,M)+.01)return 'The foe is out of range ('+Math.round(dist(a,t)*10)/10+' tiles, '+M.name+' reaches '+Math.round(rangeOf(a,M)*10)/10+').'}
  if(M.target==='ally'){if(!t||t.kind!=='hero'||!living(t))return M.name+' needs a friend to aim at (or yourself).';
    if(mode!=='round'&&dist(a,t)>M.range)return 'They are out of range ('+M.range+' tiles).'}
  return null}

// ---- resolver ----
const NOTE={attack:'#ff8a5a',control:'#9ad0ff',defend:'#c8c8e0',heal:'#7dce5a',move:'#c58cff',buff:'#f2c14e'};
function engagedNear(a,r){return nearMobs(a.x,a.y,r,m=>m.alive&&!m.gone&&!!m.target)}
function blink(a,from,d){const dx=a.x-from.x,dy=a.y-from.y,n=Math.hypot(dx,dy)||1;
  for(let k=d;k>=1;k-=.5){const x=a.x+dx/n*k,y=a.y+dy/n*k;if(WALKABLE.includes(tileAt(x,y))&&zoneAt(x,y)===zoneAt(a.x,a.y)){a.x=x;a.y=y;return k}}return 0}
const slow=(e,sec)=>{if(!sec)return;e.cd=(e.cd||0)+(e.kind==='boss'?sec/2:sec)}

function onFoe(a,M,e,round,R){const fx=M.fx;if(!living(e))return;
  if(fx.dmg){const d=strike(a,e,{mul:fx.dmg,crit:fx.crit});R.dmg+=Math.round(d||0);if(!living(e)){R.kill=true;return}}
  let saved=false;if(M.save&&(fx.delay||fx.mark)){saved=foeSave(a,M,e);if(saved){R.saved++;pop(e.x,e.y-1,'RESISTED','#ffffff')}}
  if(fx.delay)slow(e,saved?fx.delay/2:fx.delay);
  if(fx.mark&&!saved){setEff(e,'mark',fx.mark,M.dur,M.durR,round);pop(e.x,e.y-1,'MARKED','#ffb060')}
  if(fx.taunt&&e.kind==='mob'&&e.target!==a){e.target=a;e.dest=null;R.taunt=true;
    if(['hunt','follow','travel','fight'].includes(a.state)){a.state='fight';a.target=e;a.dest=null}}}

// Use a move. t: the foe (target 'foe'), the friend ('ally'), or null. opt: {mode, mates, foe (the foe for a self move like
// Flicker Step)}. Returns {ok, text, ...} or {ok:false, error}.
export function useMove(a,id,t,opt={}){const mode=opt.mode||'sec',M=MOVES[id],round=mode==='round';
  if(M&&M.target==='ally'&&!t)t=a;
  const err=canUse(a,id,t,mode);if(err)return {ok:false,error:err};
  (a.mcd||(a.mcd={}))[id]=now()+M.cd;(a.mcr||(a.mcr={}))[id]=M.rounds;
  if(M.cost&&M.cost.hp)a.hp-=maxHp(a)*M.cost.hp;
  const R={dmg:0,kill:false,saved:0,healed:0,taunt:false,hit:0,text:''},fx=M.fx,mates=(opt.mates||[a]).filter(b=>living(b)&&b.fac===a.fac);
  pop(a.x,a.y-.9,M.name.toUpperCase(),NOTE[M.kind]||'#ffffff');
  switch(M.target){
  case 'foe':onFoe(a,M,t,round,R);R.hit=1;break;
  case 'foes':{S.fx.push({type:'ring',x:a.x,y:a.y-.5,life:.5});const list=engagedNear(a,M.range);if(t&&living(t)&&!list.includes(t)&&t.kind!=='hero')list.push(t);
    for(const e of list.slice(0,5)){onFoe(a,M,e,round,R);R.hit++}break}
  case 'self':if(fx.taken){setEff(a,'taken',fx.taken,M.dur,M.durR,round);pop(a.x,a.y-.5,'WARDED','#c8c8e0')}
    if(fx.shake)for(const m of engagedNear(a,6))if(m.target===a)slow(m,fx.shake);
    if(fx.blink){const f=opt.foe&&living(opt.foe)?opt.foe:engagedNear(a,6).find(m=>m.target===a);if(f){const k=blink(a,f,fx.blink);R.moved=k;if(fx.delay)slow(f,fx.delay)}}
    break;
  case 'ally':if(fx.taken){setEff(t,'taken',fx.taken,M.dur,M.durR,round);pop(t.x,t.y-.5,'WARDED','#c8c8e0')}break;
  case 'allies':if(fx.heal){const H=fx.heal;
    for(const b of mates){if(dist(a,b)>M.range)continue;const h=Math.round((H.base+H.lvl*(a.lvl||1)+H.hp*maxHp(b))*passiveMul(a,'healMul')),was=b.hp;
      b.hp=Math.min(maxHp(b),b.hp+h);const got=Math.round(b.hp-was);R.healed+=got;R.hit++;pop(b.x,b.y-.6,'+'+got,'#7dce5a');if(b!==a&&got>0)bondEvent(a,'heal',[b])}}break;
  }
  R.text=M.name+(t&&t!==a?' on '+(t.name||(t.kind==='boss'?'Kragmaw':'the foe')):'')+(R.dmg?' ('+R.dmg+' damage)':'')+(R.healed?' (healed '+R.healed+')':'')+(R.taunt?' (it turns on you)':'')+(R.saved?' ('+R.saved+' resisted)':'')+(R.kill?', and it falls':'');
  const st=S.moveStats||(S.moveStats={uses:{},dmg:0,healed:0});st.uses[id]=(st.uses[id]||0)+1;st.dmg+=R.dmg;st.healed+=R.healed;
  const lg=a.moveLog||(a.moveLog=[]);lg.push({t:clockStr(),id,text:R.text});if(lg.length>8)lg.shift();
  return {ok:true,text:R.text,swing:!!M.swing,...R}}

// ---- the scripted policy ----
// Each move names a `use` tag in the data; this is what the tag means. Returns the target (foe, friend, or the hero
// itself for self and area moves) or null. ctx: {foe, mates, swing, engaged, mh, f}
function wants(a,M,ctx){const {foe,mates,f}=ctx;
  switch(M.use){
  case 'taunt':{let best=null;for(const m of ctx.engaged){if(m.target===a||!m.target||m.target.kind!=='hero'||!mates.includes(m.target))continue;
      if(hpf(m.target)>.8||dist(a,m)>M.range)continue;if(!best||hpf(m.target)<hpf(best.target))best=m}return best}
  case 'selfhurt':return f<.55&&foe&&(foe.target===a||foe.kind==='hero')&&!effOn(a,'taken')?a:null;
  case 'wardally':{let best=null;for(const b of mates){if(dist(a,b)>M.range||hpf(b)>=.8||effOn(b,'taken'))continue;
      const hunted=b===a?(foe&&foe.target===a):ctx.engaged.some(m=>m.target===b);if(!hunted)continue;if(!best||hpf(b)<hpf(best))best=b}return best}
  case 'masshurt':{const hurt=mates.filter(b=>dist(a,b)<=M.range&&hpf(b)<.7);return hurt.length>=2||hurt.some(b=>hpf(b)<.4)?a:null}
  case 'burst':return foe&&foe.kind!=='hero'&&ctx.swing&&(foe.kind!=='mob'||hpf(foe)>.3)&&(!M.cost||f>.6)?foe:null;
  case 'opener':return foe&&foe.kind!=='hero'&&ctx.swing&&hpf(foe)>=.9?foe:null;
  case 'pressed':return foe&&foe.kind==='mob'&&f<.65&&foe.target===a&&dist(a,foe)<2.2?a:null;
  case 'crowd':return ctx.engaged.filter(m=>dist(a,m)<=M.range).length>=2||(foe&&foe.kind==='mob'&&dist(a,foe)<2.2&&f<.7)?a:null;
  case 'snare':return foe&&(foe.elite||foe.kind==='hero'||f<.75)&&hpf(foe)>.3?foe:null;
  case 'mark':return foe&&hpf(foe)>.5&&(foe.kind==='boss'||foe.elite||mates.length>1)?foe:null;
  default:return null}}

// The move the scripted hero reaches for, or null: free moves first, then a striking one when the swing is ready.
export function pickMove(a,foe,mates,swing,mode='sec'){
  const ids=movesOf(a).filter(id=>ready(a,id,mode));if(!ids.length)return null;
  const live=(mates||[a]).filter(b=>living(b)&&b.fac===a.fac);
  const engaged=engagedNear(a,6);if(foe&&foe.kind==='boss'&&!engaged.includes(foe))engaged.push(foe);
  const ctx={foe,mates:live.includes(a)?live:[a,...live],swing,engaged,mh:maxHp(a),f:hpf(a)};
  for(const pass of [false,true])for(const id of ids){const M=MOVES[id];if(!!M.swing!==pass||(M.swing&&!swing))continue;
    if(M.cost&&M.cost.hp&&a.hp<=maxHp(a)*M.cost.hp+1)continue;
    const w=wants(a,M,ctx);if(!w)continue;
    if(M.target==='foe'&&dist(a,w)>rangeOf(a,M)+.01&&mode!=='round')continue;
    return {id,target:w}}
  return null}

// Fight hook (sim/heroes.js): use at most one move this step. Returns 'swing' when it took the weapon blow's place,
// 'free' for any other move, null when nothing fired. Agent-played heroes decide for themselves.
export function fightMoves(a,foe,mates,swing){if(a.player||a.hidden||!(a.lvl>0))return null;
  if(!swing){if(now()<(a.mvAt||0))return null;a.mvAt=now()+.25} // free moves are looked at four times a second; a ready swing always is
  const p=pickMove(a,foe,mates,swing,'sec');if(!p)return null;
  const M=MOVES[p.id],t=M.target==='ally'||M.target==='foe'?p.target:null;
  const r=useMove(a,p.id,t,{mates,foe});return r.ok?(M.swing?'swing':'free'):null}

// ---- views ----
// For the dossier, the Fellowship sheet and the agent's status: one row per move and passive.
export function abilityView(a){const rows=[];
  for(const id of CLASS_MOVES[a.cls]||[]){const M=MOVES[id],learned=M.lvl<=(a.lvl||1);
    rows.push({id,type:'move',name:M.name,kind:M.kind,lvl:M.lvl,learned,cd:M.cd,rounds:M.rounds,left:learned?cdLeft(a,id):0,roundsLeft:learned?roundsLeft(a,id):0,
      target:M.target,range:M.range,cost:M.cost,desc:M.desc})}
  for(const id of Object.keys(PASSIVES).filter(k=>PASSIVES[k].cls===a.cls)){const P=PASSIVES[id];
    rows.push({id,type:'passive',name:P.name,kind:'passive',lvl:P.lvl,learned:P.lvl<=(a.lvl||1),desc:P.desc})}
  return rows}
// One-line card text shared by tooltips and agents.
export function abilityLine(r){if(r.type==='passive')return r.name+' (passive, level '+r.lvl+'): '+r.desc;
  return r.name+' ['+r.kind+', level '+r.lvl+', cooldown '+r.cd+' s / '+r.rounds+' rounds'+(r.cost?', costs '+Math.round(r.cost.hp*100)+'% health':'')+(r.learned?(r.left>0?', ready in '+r.left+' s':', READY'):', not yet learned')+']: '+r.desc}
export const passiveNames=a=>passivesOf(a).map(id=>PASSIVES[id].name);
