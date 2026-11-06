// The raid arena (#85, raid slice): Kragmaw's lair as its own small map while a raid is under way, in the dungeon view's frame.
//   isArena(site)            true for a lair landmark (render/dungeonview.js then shows the arena instead of chambers)
//   arenaOf(site)            the arena map (world/interior.js buildArena), cached per lair
//   raidState(site)          the live raid as plain data (DOM-free): the boss (HP, phase, its marks, breath, enrage), the raiders (where
//                            they stand in the arena, HP, fighting or on the way in), who is down, broke off or fell, adds, the status line
//   trackRaid()              called every frame: remembers each raid it saw (the sim keeps no record of a raid once it ends)
//   raidDetail(key, st)      the detail for the boss ('boss'), a raider (hero id) or an add ('m'+mob id), in the dungeon view's shape
//   raidHistory()            the raids seen this session, newest first: {title, outcome, lines}
//   raidRows(st)             the bar's list: one row per raider of the raid in progress (or the last one)
//   drawArena(ctx, box, m, st, now, dpr)  one frame; returns the fit {sc, ox, oy}
//   arenaHit(st, wx, wy)     the key of the boss, raider or add whose sprite is under arena pixel (wx, wy), or null
// The arena is the real lair drawn at ARENA_K tiles per world tile (world/interior.js), so the raiders stand where the sim has
// them round the wyrm and the breath's ring keeps its true radius; raiders still walking in queue on the causeway.
// A raider at zero HP leaves the raid (sim/downed.js clears a.raid) but not the lair: it lies where it dropped, its saves over it,
// until it dies, gets up or is carried off (#626). The floor is the same LPC nest the world draws (landmark:lair, #836), the procedural
// floor with no art; a slain wyrm's lava is cooled to black rock, as render/memorials.js shows it on the world map.
// Read-only on the sim: S.boss, S.raidOn, S.agents (a.raid, a.raidIdx, a.state, a.down), S.mobs, S.fx (the breath ring), BOSSES.
// Style: as the crypt (light from the top left, entities outlined); the lava's glow pulses, the breath's telegraph fills orange.
import {U as T} from './tile.js'; // world units a tile (render/tile.js; art is drawn at TILE)
import {buildArena} from '../world/interior.js';
import {LANDMARKS} from '../world/map.js';
import {S} from '../sim/state.js';
import {BOSSES,phaseOf} from '../data/bosses.js';
import {CLS} from '../data/classes.js';
import {MOBS} from '../data/mobs.js';
import {FAC} from '../data/factions.js';
import {maxHp} from '../sim/heroes.js';
import {failsOf} from '../sim/downed.js';
import {interiorTexture} from './interior.js';
import {asset} from './assets.js';
import {sprite,outlined,sceneFigure,sceneCreature,drawFigure,sheetFrame,SPR} from './sprites.js';
import {BOSS_PAL,RAID,MARK,TEXT,UI} from './palette.js';
import {classColor} from '../core/colors.js';
const WYRM={kind:'boss'};
import {drawConditions} from './conditions.js';

export const isArena=s=>!!s&&s.kind==='lair';
export const arenaOf=s=>buildArena(s);
const tplOf=B=>BOSSES[(B&&B.tpl)||'kragmaw']||BOSSES.kragmaw;
const ENGAGE=5; // sim/boss.js: a raider within 5 tiles of the boss is in the fight
const FIG_K=1.5; // figures in the arena: its floor is two tiles to the world's one, and a raider should read at a glance beside the wyrm
const LAIR_ROT={W:0,N:1,E:2,S:3}; // quarter turns of the nest's art for the way in (render/townart.js turns it the same on the world map)
const dayOf=min=>Math.floor((min||0)/1440)+1;
const pct=x=>Math.max(0,Math.round(x*100))+'%';
const facName=f=>(FAC[f]&&FAC[f].name)||'A';
const bossOf=s=>{const B=S.boss;return B&&(!s||Math.hypot(B.x-s.x,B.y-s.y)<(s.r||5)+1.5)?B:null};
const byId=id=>{for(const a of S.agents)if(a.id===id)return a;return null};

// ---- the raids this page has seen (session memory; the sim forgets a raid as it ends) ----
// {fac, day, t0, party:[{id,name,cls,lvl}], broke:[{id,name,cls,hp}], fell:[{id,name,cls,x,y}], down:[{id,name,cls,x,y}], rose:[{id,name,cls}],
//  phases:[name], low, end:null|'slain'|'defeat', mins}. down: at zero HP in the lair and not settled yet, even after the raid ended.
const raids=[],curs={},shut={},last={}; // last[id]: the raider's last arena spot (where a fall is marked)
function open(f){const party=S.agents.filter(a=>a.raid&&a.fac===f).sort((a,b)=>(a.raidIdx||0)-(b.raidIdx||0)).map(a=>({id:a.id,name:a.name,cls:a.cls,lvl:a.lvl}));
  const r={fac:f,day:dayOf(S.gameMin),t0:S.gameMin,party,broke:[],fell:[],down:[],rose:[],phases:[],low:1,end:null,mins:0};curs[f]=r;return r}
function close(r,end){r.end=end;r.mins=Math.max(0,Math.round(S.gameMin-r.t0));delete curs[r.fac];raids.push(r);if(raids.length>24)raids.shift()}
// A raider who went down: it dies (a fall, where it lay), gets up (out of the raid, alive) or still lies there.
function settleDown(r){for(let i=r.down.length-1;i>=0;i--){const q=r.down[i],a=byId(q.id);if(a&&a.state==='downed')continue;r.down.splice(i,1);
  if(!a||a.state==='dead')r.fell.push(q);else r.rose.push({id:q.id,name:q.name,cls:q.cls})}}
export function trackRaid(){const on=S.raidOn;if(!on)return;const B=S.boss,m=lairSite()&&arenaOf(lairSite());
  for(const r of raids)if(r.down.length)settleDown(r);
  for(let f=0;f<on.length;f++){let r=curs[f];
    if(!on[f]){shut[f]=false;if(r)close(r,B&&B.alive?'defeat':'slain');continue}
    if(shut[f])continue;if(!r)r=open(f);
    if(B&&B.maxhp)r.low=Math.min(r.low,B.alive?B.hp/B.maxhp:0);
    if(B&&B.alive&&B.maxhp){const ph=phaseOf(tplOf(B),B.hp/B.maxhp).name;if(r.phases[r.phases.length-1]!==ph)r.phases.push(ph)}
    if(B&&!B.alive){r.low=0;close(r,'slain');shut[f]=true;continue} // the kill sends every raider home in the same step: not "broke off"
    for(const a of S.agents)if(a.raid&&a.fac===f&&!r.party.some(p=>p.id===a.id))r.party.push({id:a.id,name:a.name,cls:a.cls,lvl:a.lvl});
    settleDown(r);
    for(const p of r.party){const a=byId(p.id),done=r.fell.some(q=>q.id===p.id)||r.broke.some(q=>q.id===p.id)||r.down.some(q=>q.id===p.id)||r.rose.some(q=>q.id===p.id);if(done)continue;
      if(!a||a.state==='dead'){const at=last[p.id]||(m?{x:m.arena.cx,y:m.arena.cy+2}:{x:0,y:0});r.fell.push({id:p.id,name:p.name,cls:p.cls,x:at.x,y:at.y});continue}
      if(a.state==='downed'){const at=last[p.id]||(m?{x:m.arena.cx,y:m.arena.cy+2}:{x:0,y:0});r.down.push({id:p.id,name:p.name,cls:p.cls,x:at.x,y:at.y});continue} // not "broke off": goDown clears a.raid
      if(!a.raid){r.broke.push({id:p.id,name:p.name,cls:p.cls,hp:maxHp(a)>0?a.hp/maxHp(a):0});continue}
      if(m){const s=spotOf(a,m,B);const q=last[p.id]||(last[p.id]={x:0,y:0});q.x=s.x;q.y=s.y}}}}
let lair0;const lairSite=()=>lair0!==undefined?lair0:(lair0=LANDMARKS.find(L=>L.kind==='lair')||null);
export const lairs=()=>LANDMARKS.filter(L=>L.kind==='lair');

// Where a raider stands in the arena: its true place round the boss, or, still walking in, in a queue on the causeway.
const SPOT={x:0,y:0};
function spotOf(a,m,B){const A=m.arena,k=A.k,d=A.dir,ox=a.x-A.wx,oy=a.y-A.wy,dd=Math.hypot(ox,oy);
  if(B&&Math.hypot(a.x-B.x,a.y-B.y)<ENGAGE&&dd<A.inner+.2){SPOT.x=A.cx+ox*k;SPOT.y=A.cy+oy*k;return SPOT}
  const i=a.raidIdx||0,along=Math.min(A.r+1.6,Math.max(A.inner+.4,dd))*k+(i>>1)*.9,side=(i&1?1:-1)*.7;
  SPOT.x=A.cx+d[0]*along+(d[0]?0:side);SPOT.y=A.cy+d[1]*along+(d[0]?side:0);return SPOT}

// ---- the live raid as data ----
export function raidState(s){const B=bossOf(s),m=arenaOf(s),Tp=tplOf(B),A=Tp.abilities&&Tp.abilities[0];
  const st={site:s,phase:'quiet',fac:-1,company:'',boss:null,raiders:[],gone:[],adds:[],falls:[],down:[],status:'',wave:-1,breathIn:-1,radius:A&&A.radius||0,engaged:0,approach:0};
  if(B){const share=B.maxhp?Math.max(0,B.hp/B.maxhp):0,ph=B.alive?phaseOf(Tp,share):null;
    st.boss={e:B,name:Tp.name,full:Tp.full,lvl:Tp.lvl,hp:Math.max(0,Math.round(B.hp)),maxhp:B.maxhp,share,alive:!!B.alive,phase:ph?ph.name:'',marks:Tp.phases.filter(q=>q.at<1).map(q=>q.at),ab:A,
      enraged:!!(Tp.enrage&&(B.t||0)>Tp.enrage.after),x:m.arena.cx+(B.x-m.arena.wx)*m.arena.k,y:m.arena.cy+(B.y-m.arena.wy)*m.arena.k}}
  const on=S.raidOn||[];for(let f=0;f<on.length;f++)if(on[f]&&st.fac<0)st.fac=f;
  for(const a of S.agents){if(!a.raid||a.state==='dead'||a.hidden)continue;const sp=spotOf(a,m,B),mh=maxHp(a),eng=!!B&&Math.hypot(a.x-B.x,a.y-B.y)<ENGAGE;
    st.raiders.push({a,id:a.id,x:sp.x,y:sp.y,eng,share:mh>0?Math.max(0,Math.min(1,a.hp/mh)):1});if(eng)st.engaged++;else st.approach++;if(st.fac<0)st.fac=a.fac}
  st.raiders.sort((p,q)=>(p.a.raidIdx||0)-(q.a.raidIdx||0));
  const run=st.fac>=0?curs[st.fac]:null,shown=run||raids[raids.length-1]||null;st.run=shown;
  if(run){for(const q of run.broke)st.gone.push({id:q.id,name:q.name,cls:q.cls,why:'broke'});for(const q of run.rose)st.gone.push({id:q.id,name:q.name,cls:q.cls,why:'rose'});for(const q of run.fell){st.gone.push({id:q.id,name:q.name,cls:q.cls,why:'fell'});st.falls.push(q)}}
  if(shown)for(const q of shown.down){const a=byId(q.id);if(!a||a.state!=='downed')continue;const ox=a.x-m.arena.wx,oy=a.y-m.arena.wy,here=Math.hypot(ox,oy)<=m.arena.r+1,d=a.down||{}; // carried out of the lair: still on the list, off the map
    st.down.push({a,dn:true,id:a.id,name:a.name,cls:a.cls,here,x:here?m.arena.cx+ox*m.arena.k:q.x,y:here?m.arena.cy+oy*m.arena.k:q.y,s:d.s||0,f:d.f||0,of:failsOf(a),stable:!!d.stable,reach:!!B&&B.alive&&!!A&&Math.hypot(a.x-B.x,a.y-B.y)<=A.radius})}
  for(const x of S.mobs){if(!x.alive||x.hidden)continue;const ox=x.x-m.arena.wx,oy=x.y-m.arena.wy;if(Math.hypot(ox,oy)>m.arena.r)continue;
    st.adds.push({e:x,id:'m'+x.id,x:m.arena.cx+ox*m.arena.k,y:m.arena.cy+oy*m.arena.k,share:x.maxhp?Math.max(0,x.hp/x.maxhp):1})}
  if(B&&B.alive&&A){if(st.engaged){st.breathIn=Math.max(0,B.breath)}
    for(const p of S.fx)if(p.type==='ring'&&Math.hypot(p.x-B.x,p.y-B.y+.5)<.8){st.wave=Math.max(0,Math.min(1,1-p.life/.6));break}}
  const bn=Tp.name;
  if(B&&!B.alive){st.phase='dead';const gh=Math.max(1,Math.round((B.respawn||0)*6/60));
    st.status='The lair is cold: '+bn+' lies slain on its hoard and wakes in about '+gh+(gh===1?' game hour.':' game hours.')}
  else if(st.raiders.length){st.phase='raid';st.company=facName(st.fac)+' raid';const b=st.boss;
    if(!st.engaged)st.status=facName(st.fac)+' raid: '+st.raiders.length+' heroes on the way in to '+bn+'.';
    else st.status=bn+' '+pct(b.share)+' · '+b.phase+(b.enraged?' · ENRAGED':'')+' · '+st.engaged+' fighting'+(st.approach?', '+st.approach+' on the way':'')+
      (st.gone.length||st.down.length?' · '+[st.down.length?st.down.length+' down':'',countWhy(st.gone,'broke'),countWhy(st.gone,'fell')].filter(Boolean).join(', '):'')+(st.breathIn>=0&&A?' · '+A.name+' in '+Math.ceil(st.breathIn)+' s':'')}
  else{const L=raids[raids.length-1];
    st.status='Quiet. '+bn+' sleeps on its hoard'+(B&&B.hp<B.maxhp?' ('+pct(st.boss.share)+', mending)':'')+'.'+(st.down.length?' '+st.down.length+' still down in the lair.':'')+(L?' Last raid (day '+L.day+'): '+facName(L.fac)+(L.end==='slain'?', '+bn+' slain.':', beaten off at '+pct(L.low)+(L.fell.length?'; '+L.fell.length+' fell.':'.')):'')}
  return st}
const countWhy=(g,w)=>{const n=g.filter(q=>q.why===w).length;if(!n)return '';return n+(w==='broke'?' broke off':' fell')};

// ---- what the watcher may read: details, the list, the history (DOM-free) ----
const WHY={broke:'Broke off, wounded, and fled the lair',fell:'Fell in the lair',rose:'Went down in the lair and lived, out of the raid'};
export function raidDetail(key,st){if(key==null||!st)return null;
  if(key==='boss'){const b=st.boss;if(!b)return null;const Tp=tplOf(b.e),A=b.ab,ph=b.alive?phaseOf(Tp,b.share):null;
    const d={title:b.full,kind:'World boss · level '+b.lvl,stateText:b.alive?'HP '+b.hp+'/'+b.maxhp+' ('+pct(b.share)+')':'Slain',frame:ph&&ph.say||'',foes:[],notes:[],foesHead:'How it fights',notesHead:'This raid'};
    if(b.alive)d.foes.push('Phase: '+b.phase+(Tp.phases.length>1?' ('+(Tp.phases.indexOf(ph)+1)+' of '+Tp.phases.length+')':''));
    d.foes.push('A blow of '+Tp.attack.dmg[0]+'-'+(Tp.attack.dmg[0]+Tp.attack.dmg[1])+' every '+Tp.attack.cd+' s on one raider');
    for(const ab of Tp.abilities)d.foes.push(ab.name+(ab.fx==='breath'?': '+ab.dmg[0]+'-'+(ab.dmg[0]+ab.dmg[1])+' on everyone within '+ab.radius+' tiles, every '+ab.cd+' s':' every '+ab.cd+' s'));
    if(st.breathIn>=0&&A)d.foes.push('Next '+A.name+' in '+Math.ceil(st.breathIn)+' s');
    d.foes.push(Tp.enrage?(b.enraged?'ENRAGED: blows x'+Tp.enrage.hit:'Enrages after '+Tp.enrage.after+' s'):'Never enrages');
    d.foes.push(st.adds.length?st.adds.length+(st.adds.length===1?' add in the lair':' adds in the lair'):'No adds');
    const dm=b.e.dmg||[],tot=dm.reduce((t,x)=>t+(x||0),0);if(tot>0)dm.forEach((x,f)=>{if(x)d.notes.push(facName(f)+' dealt '+pct(x/tot)+' of the damage')});
    if(st.run)d.notes.push(st.run.end?'Last raid: '+(st.run.end==='slain'?'slain':'beaten off at '+pct(st.run.low)):'Brought down to '+pct(st.run.low)+' so far');
    return d}
  if(typeof key==='string'&&key[0]==='m'){const ad=st.adds.find(q=>q.id===key);if(!ad)return null;const x=ad.e,M=MOBS[x.type]||{};
    return {title:x.name||M.name||'foe',kind:'Add'+(x.lvl?' · level '+x.lvl:''),stateText:'HP '+Math.max(0,Math.round(x.hp))+'/'+x.maxhp,frame:'',foes:[],notes:[]}}
  const dn=st.down.find(q=>q.id===key);
  if(dn){const C=CLS[dn.cls]||{},d={title:dn.name,kind:(C.name||dn.cls)+' · level '+dn.a.lvl,stateText:dn.stable?'Down and stable':'Down · '+dn.s+' of 3 saves made, '+dn.f+' of '+dn.of+' failed',frame:'',foes:[],notes:[],notesHead:'This raid'};
    if(dn.reach&&st.boss)d.notes.push('Within the reach of '+st.boss.ab.name+': each one strikes them where they lie');if(!dn.here)d.notes.push('Carried out of the lair');return d}
  const r=st.raiders.find(q=>q.id===key);
  if(r){const a=r.a,mh=maxHp(a),C=CLS[a.cls]||{};
    const d={title:a.name,kind:(C.name||a.cls)+' · level '+a.lvl+' · '+facName(a.fac)+(a.guild?' · <'+a.guild.tag+'>':''),stateText:(r.eng?'Fighting':'On the way in')+' · HP '+Math.max(0,Math.round(a.hp))+'/'+mh+' ('+pct(r.share)+')',frame:'',foes:[],notes:[],notesHead:'This raid'};
    if(r.share<.3)d.notes.push('Near breaking: a raider below 15% HP flees the lair');
    if(st.run)d.notes.push('Mustered on day '+st.run.day+' with '+(st.run.party.length-1)+' others');return d}
  const g=st.gone.find(q=>q.id===key);
  if(g){const C=CLS[g.cls]||{};return {title:g.name,kind:(C.name||g.cls),stateText:WHY[g.why],frame:'',foes:[],notes:[]}}
  return null}
// One row per raider of the raid in progress (fighting, on the way in, broke off, fell), else of the last raid.
export function raidRows(st){const rows=[];
  for(const r of st.raiders)rows.push({key:r.id,label:r.a.name+' '+pct(r.share),state:r.eng?'current':'room',cls:r.a.cls,title:r.a.name+' · '+(r.eng?'fighting':'on the way in')+' · HP '+pct(r.share)});
  for(const q of st.down)rows.push({key:q.id,label:q.name+(q.stable?' (stable)':' (down)'),state:'down',cls:q.cls,title:q.name+' · '+(q.stable?'down and stable':'down, '+q.s+' saves made, '+q.f+' failed')});
  for(const g of st.gone)rows.push({key:g.id,label:g.name+(g.why==='fell'?' ✝':g.why==='rose'?' (up)':' (fled)'),state:g.why==='fell'?'lost':'unexplored',cls:g.cls,title:g.name+' · '+WHY[g.why].toLowerCase()});
  if(!rows.length&&st.run)for(const p of st.run.party){const f=st.run.fell.some(q=>q.id===p.id),b=st.run.broke.some(q=>q.id===p.id),u=st.run.rose.some(q=>q.id===p.id);
    rows.push({key:p.id,label:p.name+(f?' ✝':b?' (fled)':u?' (up)':''),state:f?'lost':b||u?'unexplored':st.run.end==='slain'?'cleared':'room',cls:p.cls,title:p.name+' · last raid'})}
  for(const x of st.adds){const e=x.e,nm=e.name||(MOBS[e.type]||{}).name||'foe';rows.push({key:x.id,label:nm+' '+pct(x.share),state:'add',cls:'',title:nm+' · an add in the lair · HP '+pct(x.share)})}
  return rows}
export function raidHistory(){const all=raids.slice();for(const f in curs)all.push(curs[f]);
  return all.reverse().map(r=>{const bn=tplOf(S.boss).name,mins=r.end?r.mins:Math.max(0,Math.round(S.gameMin-r.t0));
    return {title:'Day '+r.day+' · '+facName(r.fac)+' raid ('+r.party.length+')',outcome:!r.end?'In progress':r.end==='slain'?bn+' slain':'Beaten off at '+pct(r.low),
      lines:['Mustered: '+(r.party.map(p=>p.name).join(', ')||'-'),'Broke off: '+(r.broke.length?r.broke.map(q=>q.name).join(', '):'no one'),
        'Fell: '+(r.fell.length?r.fell.map(q=>q.name).join(', '):'no one'),...(r.rose.length?['Went down and lived: '+r.rose.map(q=>q.name).join(', ')]:[]),...(r.down.length?['Still down: '+r.down.map(q=>q.name).join(', ')]:[]),
        ...(r.phases.length>1?['Phases: '+r.phases.join(', ')]:[]),bn+' brought to '+pct(r.low)+' · '+(mins>=60?Math.floor(mins/60)+' h '+(mins%60)+' min':mins+' min')+(r.end?'':' so far')]}})}

// ---- one frame ----
let glowFor=null,glowC=null;
function lavaGlow(m){if(glowFor===m)return glowC;glowFor=m;glowC=document.createElement('canvas');glowC.width=m.w;glowC.height=m.h; // one texel per tile, smoothed up
  const x=glowC.getContext('2d'),img=x.createImageData(m.w,m.h),d=img.data,W=4;
  for(let i=0;i<m.w*m.h;i++){if(m.tiles[i]!==4)continue;d[i*4]=255;d[i*4+1]=110;d[i*4+2]=30;d[i*4+3]=200}
  x.putImageData(img,0,0);return glowC}
// The slain wyrm's lava: black rock, one texel per tile as the floor's own tiles.
let coolFor=null,coolC=null;
function lavaCool(m){if(coolFor===m)return coolC;coolFor=m;coolC=document.createElement('canvas');coolC.width=m.w;coolC.height=m.h;
  const x=coolC.getContext('2d'),img=x.createImageData(m.w,m.h),d=img.data,C=RAID.cold;
  for(let i=0;i<m.w*m.h;i++){if(m.tiles[i]!==4)continue;d[i*4]=C[0];d[i*4+1]=C[1];d[i*4+2]=C[2];d[i*4+3]=C[3]}
  x.putImageData(img,0,0);return coolC}
// The nest over the arena's floor: the same image as the world map's, one art pixel to a unit (the floor is 2 x inner x k tiles of U).
function nest(ctx,A,site){const img=asset('landmark:lair');if(!img)return;const r=A.inner*A.k*T;
  ctx.save();ctx.translate(A.cx*T,A.cy*T);ctx.rotate((LAIR_ROT[site&&site.opening]||0)*Math.PI/2);ctx.drawImage(img,-r,-r,2*r,2*r);ctx.restore()}
// A raider down: on its side, its saves over it (made in green, failed in red), the bar and a name a watcher can find it by.
function drawDown(ctx,q,b,now,px1,roomy,dpr,sc){const a=q.a,s=sceneFigure(a,b&&b.x<q.x?-1:1,0,FIG_K),x=Math.round(q.x*T),y=Math.round(q.y*T);if(!s)return;
  ctx.fillStyle=MARK.shadow;ctx.beginPath();ctx.ellipse(x,y-1,s.h*.5,3,0,0,7);ctx.fill();
  ctx.save();ctx.translate(x,y);ctx.rotate(Math.PI/2);ctx.globalAlpha=.9;ctx.drawImage(s.img,s.sx,s.sy,s.sw,s.sh,-s.dw+2,-s.dh/2,s.dw,s.dh);ctx.restore();ctx.globalAlpha=1;
  const top=y-s.w*.9;
  if(q.stable){ctx.fillStyle=MARK.edge;ctx.fillRect(x-5,top-5,10,5);ctx.fillStyle=RAID.saved;ctx.fillRect(x-4,top-4,8,3)}
  else for(let j=0;j<2;j++)for(let i=0,n=j?q.of:3;i<n;i++){const px=x-9+i*6,py=top-9+j*5,on=j?i<q.f:i<q.s;ctx.fillStyle=MARK.edge;ctx.fillRect(px-1,py-1,6,5);ctx.fillStyle=on?(j?RAID.fell:RAID.saved):'#2a2430';ctx.fillRect(px,py,4,3)}
  if(q.reach&&!q.stable){ctx.strokeStyle=RAID.fell;ctx.globalAlpha=.55+.35*Math.sin(now*5);ctx.lineWidth=px1;ctx.beginPath();ctx.ellipse(x,y-1,s.h*.56,4.5,0,0,7);ctx.stroke();ctx.globalAlpha=1}
  hit(a.id,x-s.h/2,top-10,s.h,y-top+12);if(roomy)txt(ctx,q.name,x,y+(11*dpr/sc),classColor(q.cls),12,dpr,sc)}
const HITS=[];let hitN=0;
const hit=(key,x,y,w,h)=>{let o=HITS[hitN];if(!o)o=HITS[hitN]={key:null,x:0,y:0,w:0,h:0};o.key=key;o.x=x;o.y=y;o.w=w;o.h=h;hitN++};
export function arenaHit(st,wx,wy){for(let i=hitN-1;i>=0;i--){const o=HITS[i];if(wx>=o.x&&wx<=o.x+o.w&&wy>=o.y&&wy<=o.y+o.h)return o.key}return null}
const PS={close:true,sc:1,dpr:1,offX:0,offY:0};
const ORDER=[];
function txt(ctx,t,x,y,col,css,dpr,sc,al='center'){const s=css*dpr/sc;ctx.font=s+'px VT323, monospace';ctx.textAlign=al;ctx.fillStyle='#000';ctx.fillText(t,x+s*.07,y+s*.07);ctx.fillStyle=col;ctx.fillText(t,x,y)}
function bar(ctx,x,y,w,h,f,col,back){ctx.fillStyle=MARK.edge;ctx.fillRect(x-1,y-1,w+2,h+2);ctx.fillStyle=back;ctx.fillRect(x,y,w,h);ctx.fillStyle=col;ctx.fillRect(x,y,Math.max(f>0?1:0,Math.round(w*f)),h)}

export function drawArena(ctx,box,m,st,now,dpr=1){
  const tex=interiorTexture(m),A=m.arena;
  // a wide box (the owner's 3440x1440 gives about 3:1): frame the floor and the breath's reach, and let the walls above and below be cut
  const need=Math.min(m.h,2*((st.radius||A.inner)*A.k+1.6)),cut=need<m.h;let sc=Math.min(box.w/(m.w*T),box.h/(need*T));if(sc>=2)sc=Math.floor(sc*2)/2;else if(sc>1)sc=Math.floor(sc*4)/4;
  const ox=Math.round(box.x+(box.w-m.w*T*sc)/2),oy=Math.round(box.y+box.h/2-(cut?A.cy:m.h/2)*T*sc);
  ctx.setTransform(1,0,0,1,0,0);ctx.save();ctx.beginPath();ctx.rect(box.x,box.y,box.w,box.h);ctx.clip();
  ctx.imageSmoothingEnabled=false;ctx.drawImage(tex,0,0,tex.width,tex.height,ox,oy,Math.round(m.w*T*sc),Math.round(m.h*T*sc));
  ctx.setTransform(sc,0,0,sc,ox,oy);const px1=dpr/sc,b=st.boss,cold=!!b&&!b.alive;nest(ctx,A,st.site);
  // the lava breathes light over the floor's rim; a slain wyrm's has cooled to black rock
  if(cold)ctx.drawImage(lavaCool(m),0,0,m.w*T,m.h*T);
  else{ctx.globalCompositeOperation='lighter';ctx.imageSmoothingEnabled=true;ctx.globalAlpha=.13+.05*Math.sin(now*1.7);ctx.drawImage(lavaGlow(m),-T*.5,-T*.5,m.w*T+T,m.h*T+T);
    ctx.imageSmoothingEnabled=false;ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over'}
  hitN=0;PS.sc=sc;PS.dpr=dpr;PS.offX=ox;PS.offY=oy;
  // the breath: its reach while the fight is on, filling orange as it comes; the wave as it lands
  if(b&&b.alive&&st.radius){const bx=b.x*T,by=(b.y-.25)*T,R=st.radius*A.k*T,C=RAID.breath;
    if(st.breathIn>=0){const warn=st.breathIn<2.2?1-st.breathIn/2.2:0;
      if(warn>0){ctx.fillStyle='rgba('+C[0]+','+C[1]+','+C[2]+','+(.14+.3*warn*(.75+.25*Math.sin(now*14)))+')';ctx.beginPath();ctx.arc(bx,by,R,0,7);ctx.fill();
        ctx.fillStyle='rgba('+C[0]+','+C[1]+','+C[2]+','+(.25*warn)+')';ctx.beginPath();ctx.arc(bx,by,R*warn,0,7);ctx.fill()}
      const Wv=RAID.wave;ctx.save();ctx.beginPath();ctx.arc(bx,by,R,0,7);ctx.strokeStyle='rgba(20,8,6,'+(.5+.3*warn)+')';ctx.lineWidth=Math.max(3,5*px1);ctx.stroke();ctx.strokeStyle='rgba('+Wv[0]+','+Wv[1]+','+Wv[2]+','+(.45+.55*warn)+')';ctx.lineWidth=Math.max(1.5,2.5*px1);ctx.setLineDash([7,5]);ctx.lineDashOffset=-now*8;ctx.stroke();ctx.restore()}
    if(st.wave>=0){const W=RAID.wave,r=8+(R-8)*st.wave,a=1-st.wave;ctx.strokeStyle='rgba('+W[0]+','+W[1]+','+W[2]+','+a+')';ctx.lineWidth=6;ctx.beginPath();ctx.arc(bx,by,r,0,7);ctx.stroke();
      ctx.fillStyle='rgba('+C[0]+','+C[1]+','+C[2]+','+(a*.25)+')';ctx.beginPath();ctx.arc(bx,by,r,0,7);ctx.fill()}}
  // crosses where raiders fell this raid
  for(const q of st.falls){const gx=Math.round(q.x*T)-3,gy=Math.round(q.y*T)-9;ctx.fillStyle=MARK.edge;ctx.fillRect(gx-1,gy-1,7,11);ctx.fillStyle='#b8b4c8';ctx.fillRect(gx+2,gy,1,8);ctx.fillRect(gx,gy+2,5,1);ctx.fillStyle=RAID.fell;ctx.fillRect(gx+2,gy+8,1,1)}
  // the boss, the raiders, the downed and the adds, back to front
  ORDER.length=0;if(b&&b.alive)ORDER.push(b);for(const r of st.raiders)ORDER.push(r);for(const q of st.down)if(q.here)ORDER.push(q);for(const x of st.adds)ORDER.push(x);ORDER.sort((p,q)=>p.y-q.y);
  const fr=Math.floor(now*1.6)&1,roomy=T*sc/dpr>=18;
  for(const o of ORDER){
    if(o===b){const s=outlined(sprite('boss'+fr,SPR.boss[fr],BOSS_PAL)),k=A.k,w=s.width*k,h=s.height*k,x=Math.round(b.x*T),y=Math.round(b.y*T);
      ctx.fillStyle=MARK.shadow;ctx.beginPath();ctx.ellipse(x,y-2,w*.36,5,0,0,7);ctx.fill();
      const G=sheetFrame(WYRM,1,Math.floor(now*2.2)%3),gw=w*1.25,gh=G?gw*G.fh/G.fw:h; // the wyrm's sheet (scripts/art/draw-wyrm.mjs), else the procedural sprite
      ctx.save();ctx.translate(x,0);if((b.e.face||-1)>0)ctx.scale(-1,1);if(G)ctx.drawImage(G.img,G.sx,G.sy,G.fw,G.fh,-gw/2,y-gh,gw,gh);else ctx.drawImage(s,-w/2,y-h,w,h);ctx.restore();hit('boss',x-w/2,y-h,w,h);
      if(b.e.eff)drawConditions(ctx,null,PS,b.e,x,y,y-h,now);continue}
    if(o.dn){drawDown(ctx,o,b,now,px1,roomy,dpr,sc);continue}
    if(o.a){const a=o.a,s=sceneFigure(a,b&&b.x<o.x?-1:1,a.moving?1+(Math.floor(now*6+a.id)&1):0,FIG_K),x=Math.round(o.x*T),y=Math.round(o.y*T),cc=classColor(a.cls);
      ctx.fillStyle=MARK.shadow;ctx.beginPath();ctx.ellipse(x,y-1,s.w*.36,2.2,0,0,7);ctx.fill();
      ctx.strokeStyle=FAC[a.fac]?FAC[a.fac].color:cc;ctx.globalAlpha=.7;ctx.lineWidth=px1;ctx.beginPath();ctx.ellipse(x,y-1,s.w*.46,3.2,0,0,7);ctx.stroke();ctx.globalAlpha=1;
      drawFigure(ctx,s,x,y);
      const top=y-s.h;bar(ctx,x-8,top-4,16,2,o.share,o.share<.3?'#e0584a':o.share<.6?'#e0b040':'#58c070','#142a1c');hit(a.id,x-s.w/2-1,top-4,s.w+2,s.h+4);
      if(a.eff)drawConditions(ctx,null,PS,a,x,y,top-5,now);continue}
    {const e=o.e,G=sceneCreature(e.type,b&&b.x>o.x?1:-1,0),x=Math.round(o.x*T),y=Math.round(o.y*T); // a generated creature sheet when there is one (#862)
      if(G){ctx.fillStyle=MARK.shadow;ctx.beginPath();ctx.ellipse(x,y-1,G.w/2,1.6,0,0,7);ctx.fill();ctx.drawImage(G.img,G.sx,G.sy,G.sw,G.sh,x+G.ox,y+G.oy,G.dw,G.dh);
        bar(ctx,x-6,y-G.h-4,12,2,o.share,RAID.add,'#2a1012');hit(o.id,x-G.w/2,y-G.h-4,G.w,G.h+4);continue}}
    const e=o.e,M=MOBS[e.type];if(!M||!SPR[M.spr])continue;const s=sprite(e.type+fr,SPR[M.spr][fr],M.col),os=outlined(s),x=Math.round(o.x*T),y=Math.round(o.y*T);
    ctx.fillStyle=MARK.shadow;ctx.beginPath();ctx.ellipse(x,y-1,s.width/2,1.6,0,0,7);ctx.fill();ctx.drawImage(os,x-Math.floor(s.width/2)-1,y-s.height-1);
    bar(ctx,x-6,y-s.height-4,12,2,o.share,RAID.add,'#2a1012');hit(o.id,x-s.width/2,y-s.height-4,s.width,s.height+4)}
  // names under the raiders' feet, at a constant CSS size (only when tiles are big enough to hold them apart)
  if(roomy)for(const r of st.raiders)txt(ctx,r.a.name,r.x*T,r.y*T+11*dpr/sc,classColor(r.a.cls),12,dpr,sc);
  // the boss's frame across the top of the arena: name, phase and HP at a constant size
  ctx.setTransform(1,0,0,1,0,0);ctx.restore();
  if(b){const W=Math.round(Math.min(m.w*T*sc*.6,560*dpr)),H=Math.round(10*dpr),x=Math.round(ox+(m.w*T*sc-W)/2),y=Math.round(Math.max(oy,box.y)+26*dpr);
    ctx.fillStyle=RAID.plate;ctx.fillRect(x-10*dpr,y-20*dpr,W+20*dpr,H+(st.breathIn>=0&&b.alive?36:26)*dpr); // the frame sits over the lava: a plate keeps it legible
    ctx.font=Math.round(15*dpr)+'px VT323, monospace';ctx.textAlign='center';const head=b.full.toUpperCase()+(b.alive?' · '+b.phase.toUpperCase()+(b.enraged?' · ENRAGED':''):' · SLAIN');
    ctx.fillStyle='#000';ctx.fillText(head,x+W/2+1,y-6*dpr+1);ctx.fillStyle=b.alive?TEXT.elite:TEXT.dead;ctx.fillText(head,x+W/2,y-6*dpr);
    ctx.fillStyle=MARK.edge;ctx.fillRect(x-2*dpr,y-2*dpr,W+4*dpr,H+4*dpr);ctx.fillStyle=RAID.barBack;ctx.fillRect(x,y,W,H);
    const f=b.alive?b.share:0;ctx.fillStyle=RAID.bar;ctx.fillRect(x,y,Math.round(W*f),H);ctx.fillStyle=RAID.barHi;ctx.fillRect(x,y,Math.round(W*f),Math.max(1,Math.round(2*dpr)));
    if(b.alive)for(const at of b.marks){const tx=x+Math.round(W*at),past=b.share<=at;ctx.fillStyle=MARK.edge;ctx.fillRect(tx-dpr,y-3*dpr,3*dpr,H+6*dpr);ctx.fillStyle=past?UI.dim:RAID.phase;ctx.fillRect(tx,y-2*dpr,dpr,H+4*dpr)} // where the next phase begins
    if(b.alive){ctx.font=Math.round(13*dpr)+'px VT323, monospace';ctx.fillStyle='#fff';ctx.fillText(b.hp+' / '+b.maxhp+'  '+pct(b.share),x+W/2,y+H-1*dpr)}
    if(st.breathIn>=0&&b.ab&&b.alive){const bw=Math.round(W*.3),bh=Math.round(4*dpr),by=y+H+6*dpr,bx=x+W-bw,f2=Math.max(0,Math.min(1,1-st.breathIn/b.ab.cd));
      ctx.font=Math.round(13*dpr)+'px VT323, monospace';ctx.textAlign='right';ctx.fillStyle=st.breathIn<2.2?UI.amber:UI.dim;ctx.fillText(b.ab.name.toUpperCase()+' ',bx,by+bh+2*dpr);
      ctx.fillStyle=MARK.edge;ctx.fillRect(bx-dpr,by-dpr,bw+2*dpr,bh+2*dpr);ctx.fillStyle='#2a1a10';ctx.fillRect(bx,by,bw,bh);ctx.fillStyle=st.breathIn<2.2?UI.amber:'#a06030';ctx.fillRect(bx,by,Math.round(bw*f2),bh)}}
  return {sc,ox,oy}}
