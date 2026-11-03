// What the DM sees of the companies' life (#558): the words said aloud in the world, what the heroes carry and know,
// the ground around a point and the world's standing. Owned by brain-builder. DOM-free, read-only (the only thing written
// is the DM seat's own listening ring, S.dmAgent.ear), no RNG, so a seeded world is unchanged.
//
// The rule that holds (CLAUDE.md "In-game channels"): the DM hears what is said aloud in the world, as a human DM hears the
// table. Never a hero's notebook, journal, memories, persona changes, narration or session. Lines come only from the chat
// buffers (a.chat) of agent-played heroes, i.e. say in earshot, party shouts, table lines; the DM's own narration, whispers
// and dreams (e.dm), NPC lines (npc_call has them) and scripted barks are not taken.
//
//   S.dmAgent.ear = {seq, lines:[{id, min, day, t, who, wid, cid, company, kind, where, text, h}], keys:[...]}  (oldest first, EAR.KEEP)
//     h: true once a `hear` returned it; keys: dedupe of lines seen through several hearers' buffers
import {S,clockStr,dayNo} from './state.js';
import {W,H,G,ROAD,BRIDGE,RIVER,WALKABLE,SGRASS,FLOWER,SNOW} from '../world/tiles.js';
import {tiles,I,ZONES,REGIONS,CITY,LANDMARKS,CRYPT,zoneAt,dist} from '../world/map.js';
import {spotErr,LK,activeOf} from './levers.js';
import {focuses} from './dmfocus.js';
import {countKind,questItems,invOf} from './inv.js';
import {gearScore} from './gear.js';
import {questLog} from './questlog.js';
import {loreSummary} from './lore.js';
import {metNames} from './talk.js';
import {FOCUS_NAME,guildFocus} from './guildfocus.js';
import {livingGuilds,membersOf,leaderOf} from './guilds.js';
import {rivalsOf} from './rivals.js';
import {GOODS,price} from '../data/items.js';

export const EAR={KEEP:200,GAP:3,SHOW:60};
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const alive=a=>a&&a.state!=='dead';
const nowMin=()=>dayNo()*1440+Math.floor(S.gameMin)%1440;
const R1=q=>Math.round(q*10)/10;
const clockMin=t=>{const m=/^(\d+):(\d+)$/.exec(String(t||''));return m?Number(m[1])*60+Number(m[2]):0};

// ---- hear: the spoken lines ----
export function earOf(D){return D.ear||(D.ear={seq:0,lines:[],keys:[]})}
const compOf=()=>{const m=new Map();for(const fo of focuses())for(const a of fo.members)m.set(a.id,{id:fo.company.id,name:fo.company.name||(fo.company.slots?'the Fellowship':null)});return m};
const whereNow=a=>a.state==='town'?(a.town||'town'):(ZONES[zoneAt(a.x,a.y)]||'the wilds');
// Take in what the agent heroes have said or heard since the last look (called from the step while the seat is open, and
// before every hear / dm_status). A line is kept once however many heroes heard it.
export function listen(D){const E=earOf(D),seen=new Set(E.keys),co=compOf();let added=0;
  for(const a of S.agents){if(!a.player||!a.chat||!a.chat.length)continue;
    for(const e of a.chat){const f=e&&e.from;if(!f||f.kind!=='hero'||!f.player||e.dm||e.npc||e.whisper||e.emote||typeof e.text!=='string'||!e.text)continue;
      const min=(e.d||0)*1440+clockMin(e.t),key=min+'|'+f.id+'|'+e.text.slice(0,60);if(seen.has(key))continue;seen.add(key);
      const c=co.get(f.id)||null;
      E.lines.push({id:++E.seq,min,day:e.d||null,t:e.t,who:f.name,wid:f.id,cid:c?c.id:null,company:c?c.name:null,kind:e.party?'shout':e.scene||e.trigger==='table'?'table':'say',
        where:whereNow(f),text:clean(e.text,400),h:false});
      E.keys.push(key);added++}}
  if(added){E.lines.sort((x,y)=>x.min-y.min||x.id-y.id);if(E.lines.length>EAR.KEEP)E.lines.splice(0,E.lines.length-EAR.KEEP);if(E.keys.length>EAR.KEEP*2)E.keys.splice(0,E.keys.length-EAR.KEEP*2)}
  return added}
// Lines not yet returned by hear, per company: [{company, id, lines}] (dm_status unheard).
export function unheard(D){listen(D);const E=earOf(D),by=new Map();
  for(const l of E.lines){if(l.h)continue;const k=l.cid==null?'none':l.cid,r=by.get(k)||{company:l.company||(l.cid==null?'no company':'company '+l.cid),id:l.cid,lines:0};r.lines++;by.set(k,r)}
  return [...by.values()]}
export const unheardTotal=D=>{listen(D);return earOf(D).lines.filter(l=>!l.h).length};
// hear {company?, hero?, since?, n?}: default the lines not yet heard; since (game minutes ago) or n (the last N) read back
// regardless. 200 lines at most. Everything returned is marked heard.
export function hear(D,a){a=a&&typeof a==='object'?a:{};listen(D);const E=earOf(D);
  const hv=clean(a.hero,40).toLowerCase(),cv=clean(a.company,40).toLowerCase();let hid=null,cid=null;
  if(hv){const h=S.agents.find(x=>String(x.id)===hv||x.name.toLowerCase()===hv);if(!h)return {ok:false,error:'No hero called "'+clean(a.hero,40)+'". hear takes hero (a name or id), company (an id or name), since (game minutes), n (1-200).'};hid=h.id}
  if(cv){const fo=focuses().find(f=>String(f.company.id)===cv||String(f.company.name||'').toLowerCase()===cv||(f.company.slots&&/^(the )?fellowship$/.test(cv)));
    if(!fo)return {ok:false,error:'No company "'+clean(a.company,40)+'". Companies: '+focuses().map(f=>f.company.id+' ('+(f.company.name||(f.company.slots?'the Fellowship':'a company of '+f.members.length))+')').join(', ')+'.'};cid=fo.company.id}
  const n=Math.max(1,Math.min(EAR.KEEP,Math.round(Number(a.n))||0)),since=Math.round(Number(a.since));
  const hasN=Number.isFinite(Number(a.n))&&Number(a.n)>0,hasSince=Number.isFinite(since)&&since>0;
  let L=E.lines.filter(l=>(hid==null||l.wid===hid)&&(cid==null||l.cid===cid));
  if(hasSince)L=L.filter(l=>nowMin()-l.min<=since);else if(!hasN)L=L.filter(l=>!l.h);
  L=L.slice(-(hasN?n:EAR.KEEP));
  for(const l of L)l.h=true;
  return {ok:true,lines:L.map(l=>({day:l.day,t:l.t,who:l.who,company:l.company,kind:l.kind,where:l.where,text:l.text})),count:L.length,
    unheard_after:unheardTotal(D),
    note:'Only what was said aloud in the world: say in earshot, party shouts and table lines. Never journals, memories or narration. NPC lines are in npc_call.'}}

// ---- what a hero carries, holds and knows (public-facing facts a DM at a table would have) ----
export function carriesOf(a){const inv=invOf(a),q={};for(const e of questItems(a))q[e.id]=(q[e.id]||0)+(e.n||1);
  return {gold:Math.round(a.gold||0),gear:R1(gearScore(a)),quest_items:Object.keys(q).slice(0,8).map(k=>q[k]>1?k+' x'+q[k]:k),potions:countKind(a,'potion'),scrolls:countKind(a,'scroll'),pack:inv.list.length}}
export function questsOf(a){const L=questLog(a);return L.active.slice(0,6).map(q=>({kind:q.kind,title:q.title,status:q.status,...(q.focus?{focus:true}:{})}))}
export function knowsOf(a){const s=loreSummary(a,12),met=(metNames(a)||[]).slice(0,12);return {fears:s.feared,beaten:s.beaten,places:s.places,met,...(s.more?{more:s.more}:{})}}
export const sightOf=a=>({carries:carriesOf(a),quests:questsOf(a),knows:knowsOf(a)});

// ---- survey: the ground around a point ----
const DIRS=['east','southeast','south','southwest','west','northwest','north','northeast']; // y grows downward
const bearing=(c,p)=>DIRS[((Math.round(Math.atan2(p.y-c.y,p.x-c.x)/(Math.PI/4))%8)+8)%8];
const OPEN=[G,SGRASS,FLOWER,SNOW];
function spotAt(p,gap){return !spotErr(p)&&!(S.places||[]).some(q=>dist(q,p)<gap)}
// c: {x,y,label}; r: radius in tiles. Legal spots are accepted by mark_place, place_person and stage_scene as "x,y".
export function survey(c,radius){const r=Math.max(4,Math.min(30,Math.round(Number(radius))||12)),cx=Math.floor(c.x),cy=Math.floor(c.y);
  const road={},water={},blocked={};let onRoad=false;
  for(let y=Math.max(1,cy-r);y<=Math.min(H-2,cy+r);y++)for(let x=Math.max(1,cx-r);x<=Math.min(W-2,cx+r);x++){
    const p={x:x+.5,y:y+.5},d=dist(c,p);if(d>r)continue;const t=tiles[I(x,y)],dir=bearing(c,p),note=(B)=>{const o=B[dir];if(!o||d<o.d)B[dir]={d:R1(d),at:x+','+y}};
    if(t===ROAD||t===BRIDGE){note(road);if(d<1.2)onRoad=true}else if(t===RIVER)note(water);else if(!WALKABLE.includes(t))note(blocked)}
  const fmt=B=>DIRS.filter(k=>B[k]).map(k=>({dir:k,nearest:B[k].at,tiles:B[k].d}));
  const nearby=[...CITY.map(t=>({kind:'town',name:t.name,x:t.gate.x,y:t.gate.y})),...LANDMARKS.map(l=>({kind:l.kind||'landmark',name:l.name,x:l.x,y:l.y}))]
    .map(o=>({...o,d:dist(c,o)})).filter(o=>o.d<=r*2.5).sort((x,y)=>x.d-y.d).slice(0,8).map(o=>({kind:o.kind,name:o.name,at:Math.round(o.x)+','+Math.round(o.y),tiles:R1(o.d),dir:bearing(c,o)}));
  const marked=(S.places||[]).map(p=>({p,d:dist(c,p)})).filter(o=>o.d<=r).sort((x,y)=>x.d-y.d).slice(0,10).map(o=>({id:o.p.id,kind:o.p.kind,name:o.p.name,at:Math.round(o.p.x)+','+Math.round(o.p.y),tiles:R1(o.d),dir:bearing(c,o.p)}));
  // legal open spots: rings outward from the point, the first ones that pass spotErr, keep PLACE_GAP from every place and from
  // each other; open ground (not road) first, spread around the compass
  const gap=Math.max(LK.PLACE_GAP,Math.round(r/4)),spots=[];
  const pick=(open)=>{for(let d=Math.max(2,Math.min(4,r/3));d<=r&&spots.length<6;d+=2)for(let k=0;k<16&&spots.length<6;k++){
    const ang=k*Math.PI/8+(Math.round(d/2)%2)*Math.PI/16,q={x:R1(c.x+Math.cos(ang)*d),y:R1(c.y+Math.sin(ang)*d)};
    if(!spotAt(q,LK.PLACE_GAP)||spots.some(s=>dist(s,q)<gap))continue;
    if(open&&!OPEN.includes(tiles[I(Math.floor(q.x),Math.floor(q.y))]))continue;spots.push(q)}};
  pick(true);if(spots.length<6)pick(false);
  const z=zoneAt(c.x,c.y),b=REGIONS[z]&&REGIONS[z].band;
  return {ok:true,near:c.label||null,at:R1(c.x)+','+R1(c.y),radius:r,region:ZONES[z]||null,levels:b?b[0]+'-'+(b[1]===Infinity?'+':b[1]):null,on_road:onRoad,
    roads:fmt(road),water:fmt(water),impassable:fmt(blocked),towns_and_landmarks:nearby,marked_places:marked,
    legal_spots:spots.map(s=>({at:s.x+','+s.y,tiles:R1(dist(c,s)),dir:bearing(c,s)})),
    note:'legal_spots are open ground, '+LK.PLACE_GAP+' or more tiles from other places and the towns: pass one as "x,y" to mark_place, place_person or stage_scene near. impassable lists mountains, lava and walls.'}}

// ---- world_standing: the "world second" read ----
const FOCUS_WHY={crypt:'its leader will lead them down into the Crypt',raid:'its leader means to bring down the wyrm',adventure:'its leader sends them after the jobs on the town boards',pvp:'its leader wants enemy blood on the roads',open:'no focus set'};
export function worldStanding(){
  const guilds=livingGuilds().map(g=>{const L=leaderOf(g),f=guildFocus(g);return {tag:g.tag,name:g.name,faction:g.fac===0||g.fac===1?['Concord','Warband'][g.fac]:'neutral',members:membersOf(g).length,leader:L?L.name:null,
    focus:FOCUS_NAME[f]||f,why:FOCUS_WHY[f]||null,rivals:rivalsOf(g).map(h=>'<'+h.tag+'> '+h.name),crypt_clears:g.clears||0,crypt_wipes:g.wipes||0,bosses:g.bosses||0}});
  const riv=[];if(S.rivals)for(const k in S.rivals.on){const [x,y]=k.split(':').map(Number),gx=S.GUILDS.find(g=>g.id===x),gy=S.GUILDS.find(g=>g.id===y);if(gx&&gy)riv.push({between:'<'+gx.tag+'> and <'+gy.tag+'>',since_day:Math.floor((S.rivals.on[k].since||0)/1440)+1,why:S.rivals.on[k].why||null})}
  const b=S.boss,fall=(S.timeline||[]).find(e=>e.kind==='boss'),cf=(S.timeline||[]).find(e=>e.kind==='crypt');
  const txt=ps=>(ps||[]).map(p=>typeof p==='string'?p:p&&(p.t!=null?p.t:p.name)||'').join('');
  const boss={name:b.name,alive:!!b.alive,hp:b.alive?Math.round(100*b.hp/Math.max(1,b.maxhp))+'%':null,respawns_in_min:b.alive?null:Math.max(0,Math.round(b.respawn||0)),raid_underway:!!(S.raidOn&&S.raidOn.some(Boolean)),
    last_fall:fall?{day:Math.floor((fall.gameMin||0)/1440)+1,text:txt(fall.parts)}:null,bosses_slain_by_faction:(S.facStats||[]).map(f=>f.bosses)};
  const grp=CRYPT&&CRYPT.group;
  const crypt={name:CRYPT?CRYPT.name:null,clears:guilds.reduce((t,g)=>t+g.crypt_clears,0),wipes:guilds.reduce((t,g)=>t+g.crypt_wipes,0),
    party_below:grp?{phase:grp.phase,members:(grp.mem||[]).map(a=>a.name)}:null,last_clear:cf?{day:Math.floor((cf.gameMin||0)/1440)+1,text:txt(cf.parts)}:null};
  const ps=Object.keys(GOODS).map(n=>({n,p:price(n),b:GOODS[n].base})).map(o=>({...o,dev:o.p/Math.max(1,o.b)-1})).sort((x,y)=>Math.abs(y.dev)-Math.abs(x.dev)).slice(0,5);
  const auction={notable:ps.map(o=>({good:o.n,price:o.p,base:o.b,vs_base:(o.dev>=0?'+':'')+Math.round(o.dev*100)+'%'})),shocks:activeOf('price_shock').map(x=>({good:x.params&&x.params.good,direction:x.params&&x.params.direction,hours_left:Math.max(0,Math.round((x.until-S.gameMin)/60))}))};
  const top=S.agents.filter(alive).sort((x,y)=>y.lvl-x.lvl||(y.xp||0)-(x.xp||0)||x.id-y.id).slice(0,5).map(a=>({name:a.name,lvl:a.lvl,cls:a.cls,faction:a.fac===0||a.fac===1?['Concord','Warband'][a.fac]:'neutral',guild:a.guild?a.guild.tag:null}));
  return {ok:true,day:Math.floor(S.gameMin/1440)+1,guilds,rivalries:riv,boss,crypt,auction,
    conditions:(S.conditions||[]).map(c=>({region:ZONES[c.z],kind:c.kind,hours_left:Math.max(0,Math.round((c.until-S.gameMin)/60))})),
    events:(S.levers&&S.levers.active||[]).filter(x=>x.name==='start_event').map(x=>({kind:x.params&&x.params.kind||null,region:x.region!=null?ZONES[x.region]:null,hours_left:Math.max(0,Math.round((x.until-S.gameMin)/60))})),
    top_heroes:top}}
