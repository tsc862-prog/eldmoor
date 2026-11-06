// The scene view (#431, slice 1): a Table scene (sim/table.js S.table, read only) shown on its own scene map.
//   indoor   a staged meeting or social scene in a town plays in a generated room from data/settings.js (a house,
//            a tavern back room, a chapel, a cellar, an interrogation cell, a shrine, a ship's hold), drawn by
//            render/interior.js drawSetting over the world canvas, like the dungeon view (#85)
//   outdoor  everything else in the open (ambush, elite, rescue, a parley inside those fights, the boss, a DM trap or
//            mystery, checks, choices and votes) is a zoomed-in cut of the real overworld at the scene's spot: the
//            world renderer (render/draw.js) keeps drawing the chunk terrain, trees, road, river, snow, weather, night,
//            the members and foes where they stand, condition glyphs and spell effects, and only takes its camera
//            from sceneCut(); past the map's edge a generated biome arena fills in (arenaPattern)
//   dungeon  the Crypt's scenes (site, room, crawl) open the dungeon view as before (render/dungeonview.js); a DM-made site's
//            crawl (ctx.site, #642) opens it on the site's own interior
//   camp     (#431 slice 3) a scene that breaks out at a camp (ctx.camp: the fireside, an ambush on the watch, a yielded foe
//            questioned by the fire) is an outdoor cut centred on the fire, smaller (data/settings.js OUTDOOR_SETTINGS.camp),
//            the fire and the bedrolls kept drawn while it lasts (render/camp.js); an interrogation in a town plays in the cell
// The view opens by itself when the followed Fellowship's scene opens (Settings: "Scene maps: auto", kept in this
// browser), returns to the world when the scene ends, and "Back to world" closes it for that scene. The Table banner's
// "Scene map" button (data-scene) opens it by hand. Everything here reads S; nothing writes it.
//
// A fight on the map patch (#746, slice 4 of #140): a Table fight with an agent deciding carries sc.fp (sim/patch.js), the frozen tiles
// it plays on. Only then: the cut frames the patch at scene scale (cut.patch), a faint grid and the cover and slow marks lie under the
// sprites (patchLayer), and the round plays back as the dungeon view's does (render/crawlview.js): the sim writes each tile to the entity
// at once, and scenePose() gives draw.js where to show it instead, walking there, with the lunge, the hit flash, the shake on a 20, the
// stumble on a 1 and the words floating up. The beats are the scene's own (a foe's carry by:'foe' and its roll); HP that fell with no
// beat to explain it (a spell, a poison) shows at once. At 8x it is all skipped. The clock is the page's, so no hash can move.
//
// Polish (#536): the speaker's bubble carries only the quoted words (core/spoken.js), never action prose; an indoor scene
// docks the Table banner beside the map (below it on a phone, #screen.scin) and the room fills the rest at a whole-number
// scale; the members stand in an arc facing the person (render/interior.js); each member's answer state shows over the
// head ("..." thinking, a tick once answered: answerMarks); the room is darker at night and when the frame says so
// (sceneDark); an item the frame names is a small lit prop (sceneItem); the bar carries the answer count, the timer and
// the place (barStatus), not the title.
//
// Exports (DOM-free where it matters, so the stub-DOM smoke can drive them):
//   sceneSpeaker()    the line the speaker's bubble carries {e, text} or null
//   barStatus(sc), answerMarks(sc), sceneDark(sc, base), sceneItem(sc)   the bar's status line, {id: 'think'|'done'|'turn'},
//                     the room's dimness 0..0.8, the item kind the frame names or null
//   sceneSpec(sc)     {mode, kind, title, members, cast, anchor:{x,y}, town, setting, key, where} for a scene, or null
//   pickSetting(sc, town, people)   the settings row id an indoor scene plays in
//   sceneTick(cam)    once a frame (draw.js): auto open/close, the speaker, the dungeon hand-off
//   openSceneView(), closeSceneView(), sceneOpen(), sceneMode(), sceneAuto(), setSceneAuto(on)
//   sceneCut(aspect)  the outdoor cut {cx, cy, w, h, edge, members, foes, people, cur, speaker, top, bottom} or null
//   drawSceneView(now) one indoor frame; drawSceneRings / drawSceneMarks(ctx, cam, cut, now) the outdoor marks (draw.js)
//   scenePose(e)      where a fight on a patch shows e this frame {x, y, walk, face, dir, show (its HP), tilt, flash, col, fade}, or null
//   sceneFallen(list) adds the foes whose last blow is still to play, or who are falling; sceneTint(img, col) a sprite in one colour
//   patchLayer(G)     the ground marks of a patch's grid, painted once; sceneQueue() the kinds of the beats still to play (for the checks)
import {S} from '../sim/state.js';
import {CITY,CRYPT,ZONES,zoneAt} from '../world/map.js';
import {W,H,G,SNOW,ROCK,SGRASS} from '../world/tiles.js';
import {U as T,HEAD,PROC_SCALE} from './tile.js';
import {SETTINGS,SETTING_IDS,OUTDOOR_SETTINGS} from '../data/settings.js';
import {buildSetting} from '../world/interior.js';
import {drawSetting,bubble,answerMark} from './interior.js';
import {texel} from './terrain.js';
import {openDungeon,closeDungeon,dungeonOpen,dungeonOf,dungeonGroup,isSite} from './dungeonview.js';
import {isArena,lairs} from './raidview.js';
import {biomeOfZone,SCENE,MARK,TEXT} from './palette.js';
import {classColor,DISP} from '../core/colors.js';
import {sceneHead} from '../core/scenehead.js';
import {TABLE} from '../sim/table.js';
import {liveProps} from '../sim/props.js';
import {patchGrid} from '../sim/patch.js';
import {spokenOf,unrole} from '../core/spoken.js';
import {inSlots} from '../sim/company.js'; // the slotted company (#588)

const KEY='eldmoor.sceneMaps';
const DUNGEON_KINDS=new Set(['site','room','crawl']),INDOOR_KINDS=new Set(['meeting','social','interrogation','talk']); // interrogation (#431 slice 3): the cell in a town
const ROOM_KINDS=new Set(['opening','arrival']); // session zero and an arrival in a town (#701): arrival.js names the tavern in ctx.setting; at a camp they keep the camp cut
const TOWN_PAD=3,NEAR=14,SPEAK_S=9;
let auto=true;try{if(typeof localStorage!=='undefined'&&localStorage.getItem(KEY)==='off')auto=false}catch(_){}

const byId=id=>S.agents.find(a=>a.id==id)||null;
const live=e=>!!e&&e.state!=='dead'&&e.alive!==false&&!e.hidden;
const townAt=(x,y)=>CITY.find(c=>x>=c.x0-TOWN_PAD&&x<=c.x1+1+TOWN_PAD&&y>=c.y0-TOWN_PAD&&y<=c.y1+1+TOWN_PAD)||null;
const plain=ps=>(ps||[]).map(p=>typeof p==='string'?p:p&&p.kind==='hero'?p.name:p&&p.t||'').join('');

// The people of a scene besides the members: foes (a creature, a pack, an enemy hero, the boss) and a DM-placed person.
function castOf(sc){const c=sc.ctx||{},out=[],add=e=>{if(e&&!out.includes(e))out.push(e)};
  if(sc.kind==='boss'&&S.boss&&S.boss.alive)add(S.boss);
  for(const id of c.mobs||[])add(S.mobs.find(m=>m.id===id&&m.alive));
  if(c.mob!=null)add(S.mobs.find(m=>m.id===c.mob&&m.alive));
  if(c.foe!=null)add(byId(c.foe));
  if(c.npc!=null)add((S.wanderers||[]).find(w=>w.id===c.npc)||(S.npcs||[]).find(w=>w.id===c.npc));
  return out}
// Where the scene happens: the member it happened to, else the staged cast's spot, else the first member present.
function anchorOf(sc,members){const c=sc.ctx||{},a=byId(c.anchor!=null?c.anchor:c.hero);if(a&&live(a))return {x:a.x,y:a.y};
  const rec=c.staged!=null&&S.staged&&S.staged.cur&&S.staged.cur.id===c.staged?S.staged.cur:null;if(rec&&rec.at)return {x:rec.at.x,y:rec.at.y};
  const m=members.find(live);return m?{x:m.x,y:m.y}:null}

// The room for an indoor scene: the first settings row whose words match the scene's title or frame, else its person's
// role; else a tavern back room for a meeting and a house for a social call. Slice 2 lets the DM name the setting instead.
export function pickSetting(sc,town,people=[]){const want=sc&&sc.ctx&&sc.ctx.setting;if(want&&SETTINGS[want])return want;
  const said=[sc&&sc.title,plain(sc&&sc.frame)].join(' '),who=people.map(p=>(p.role||'')+' '+(p.title||'')).join(' '); // the scene's own words first, then who is in it
  for(const w of [said,who])for(const id of SETTING_IDS)if(SETTINGS[id].words&&SETTINGS[id].words.test(w))return id;
  return sc&&sc.kind==='interrogation'?'cell':sc&&sc.kind==='meeting'?'tavern':'house'}

export function sceneSpec(sc=S.table){if(!sc)return null;
  const members=sc.ids.map(byId).filter(Boolean),cast=castOf(sc),an=anchorOf(sc,members);
  if(sc.ctx&&sc.ctx.site!=null){const D=dungeonOf(sc); // a DM-made site's crawl (#642): the dungeon view with the site's own interior
    return D?{mode:'dungeon',kind:sc.kind,title:sc.title,members,cast,anchor:an,town:null,where:D.name,dungeon:D}:null}
  if(sc.kind==='boss'){const L=lairs()[0];if(L)return {mode:'dungeon',kind:sc.kind,title:sc.title,members,cast,anchor:an,town:null,where:L.name,dungeon:L}} // the raid arena (#85)
  if(DUNGEON_KINDS.has(sc.kind)){const D=dungeonOf(sc);return {mode:'dungeon',kind:sc.kind,title:sc.title,members,cast,anchor:an,town:null,where:D?D.name:'the Crypt',dungeon:D}}
  const c=sc.ctx||{},town=(c.town&&CITY.find(t=>t.name===c.town))||(an?townAt(an.x,an.y):null),z=an?zoneAt(an.x,an.y):-1;
  // indoors: in a town, or wherever the DM named a room (stage_scene setting, #431 slice 2: a house by the road)
  if((INDOOR_KINDS.has(sc.kind)||ROOM_KINDS.has(sc.kind))&&(sc.kind==='talk'||ROOM_KINDS.has(sc.kind)?SETTINGS[c.setting]:(town||SETTINGS[c.setting]))){ // a talk (#407) plays indoors only when talkscene.js set its room (the person stands in a town); in the field it keeps the cut
    const people=cast.filter(e=>e.kind!=='hero'&&e.kind!=='mob'),setting=pickSetting(sc,town,people),place=town?town.name:(ZONES[z]||'the wilds');
    return {mode:'indoor',kind:sc.kind,title:sc.title,members,cast,anchor:an,town,setting,key:place+'|'+sc.id,where:SETTINGS[setting].name+' in '+place}}
  // at a camp (#431 slice 3): the fireside, an ambush on the watch or questions by the fire play on the real ground round the fire
  const CS=OUTDOOR_SETTINGS.camp,fire=c.camp&&CS.kinds.includes(sc.kind)?{x:c.camp.x,y:c.camp.y}:null;
  if(fire){const zc=zoneAt(Math.max(0,Math.min(W-1,fire.x)),Math.max(0,Math.min(H-1,fire.y)));return {mode:'outdoor',kind:sc.kind,title:sc.title,members,cast,anchor:fire,camp:fire,town,setting:'camp',where:CS.name+' in '+(ZONES[zc]||'the wilds')}}
  return {mode:'outdoor',kind:sc.kind,title:sc.title,members,cast,anchor:an,town,where:(town?'Outside '+town.name+', ':'')+(ZONES[z]||'the wilds')}}

// ---- state ----
let open=false,openId=null,spec=null,dismissed=null,seenId=null,autoDg=false,dgShut=false,dgAt=null,speaker=null,lastBeats=0,lastNarr=null;
export const sceneOpen=()=>open;
export const sceneSpeaker=()=>speaker; // {e, text} the bubble shows, or null (#536)
export const sceneMode=()=>open&&spec?spec.mode:null;
export const sceneAuto=()=>auto;
export function setSceneAuto(on){auto=!!on;try{localStorage.setItem(KEY,auto?'auto':'off')}catch(_){}syncBtn()}

// Does the watcher follow this scene's Fellowship? (Follow Fellowship, or following one of the members.)
const follows=(cam,sc)=>!!cam&&(cam.view==='fellow'||cam.view==='cinema'||(!!cam.sel&&(sc.ids.includes(cam.sel.id)||(cam.view==='follow'&&inSlots(cam.sel)))));

export function openSceneView(sc=S.table){const sp=sceneSpec(sc);if(!sp)return false;
  if(sp.mode==='dungeon'){autoDg=true;dgShut=false;dgAt=sp.dungeon||CRYPT;return openDungeon(dgAt)}
  if(!root&&!build())return false;
  open=true;openId=sc.id;spec=sp;sig='';root.hidden=false;root.classList.toggle('scout',sp.mode==='outdoor');root.dataset.mode=sp.mode;
  const scr=document.getElementById('screen');if(scr){scr.classList.add('scopen');scr.classList.toggle('scin',sp.mode==='indoor')}
  speaker=null;lastBeats=Math.max(0,sc.beats.length-1);lastNarr=null;track(sc);playReset();refreshScene();return true}
export function closeSceneView(byUser){if(byUser&&openId!=null)dismissed=openId;open=false;openId=null;spec=null;playReset();
  if(root)root.hidden=true;const scr=document.getElementById('screen');if(scr){scr.classList.remove('scopen');scr.classList.remove('scin')}}

// The latest line at the table: a member's line in a beat, or the scene's person speaking through the DM (sc.narr,
// "Name: text"). Only the quoted words become a bubble (#536); prose about the person ("Father Corvane sets down the
// candle stub.") clears it, and the DM's own narration stays in the banner's list, not on the map.
const peopleOf=sp=>(sp?sp.cast:[]).filter(e=>e&&e.title&&e.name);
function track(sc){const nb=sc.beats.length;
  for(let i=lastBeats;i<nb;i++){const b=sc.beats[i];if(b&&b.line){const a=byId(b.id),t=a&&spokenOf(b.line,a.name);if(t)speaker={e:a,text:t,t:clock()}}}lastBeats=nb;
  const nt=sc.narr&&sc.narr.text;if(nt&&nt!==lastNarr){lastNarr=nt;const u=unrole(nt,peopleOf(spec)),who=spec&&spec.cast.find(e=>e.name&&u.startsWith(e.name+': '));
    if(who){const t=spokenOf(u.slice(who.name.length+2),who.name);speaker=t?{e:who,text:t,t:clock()}:speaker&&speaker.e===who?null:speaker}}}
const clock=()=>typeof performance!=='undefined'?performance.now()/1000:Date.now()/1000;

// Once a frame: open on a new scene of the followed Fellowship, close when it ends, keep the speaker.
export function sceneTick(cam,now=clock()){const sc=S.table;
  if(sc&&sc.id!==seenId){seenId=sc.id;if(auto&&follows(cam,sc)&&dismissed!==sc.id){const sp=sceneSpec(sc);
    if(sp&&sp.mode==='dungeon'){if(!dgShut&&!dungeonOpen()){autoDg=true;dgAt=sp.dungeon||CRYPT;openDungeon(dgAt)}}else if(sp)openSceneView(sc)}}
  if(!sc)seenId=null;
  if(open){if(!sc||sc.id!==openId){if(!playHolds(now))closeSceneView(false)}else{spec=sceneSpec(sc);track(sc);const scr=document.getElementById('screen');if(scr&&spec)scr.classList.toggle('scin',spec.mode==='indoor')}} // a fight's last beats play out first (#746)
  if(open&&spec&&spec.mode==='outdoor')playTick(sc,now);
  if(autoDg){const site=isSite(dgAt),ar=isArena(dgAt),g=ar?null:dungeonGroup(dgAt||CRYPT),inside=ar?!!(sc&&sc.kind==='boss')||S.raidOn.some(Boolean):!!(g&&g.mem&&(site?g.mem.length:g.mem.some(a=>inSlots(a)))); // a site: while its group is inside; the arena: while the raid lasts
    if(!dungeonOpen()&&inside)dgShut=true; // Back to world during the crawl: not again until it is over
    if(!inside){if(dungeonOpen())closeDungeon();autoDg=false;dgShut=false;dgAt=null}}
  if(speaker&&clock()-speaker.t>SPEAK_S)speaker=null}

// ---- the outdoor cut ----
// The members and the cast near the anchor, framed with a margin; the world renderer fits it below the banner.
export function sceneCut(aspect=1.6){if(!open||!spec||spec.mode!=='outdoor'||!spec.anchor)return null;const sc=S.table,fp=(sc&&sc.id===openId&&sc.fp)||PL.fp,an=fp?{x:fp.ox+fp.w/2,y:fp.oy+fp.h/2}:spec.anchor,tallView=aspect<1; // a phone held upright frames a narrower, taller cut
  const near=e=>live(e)&&Math.hypot(e.x-an.x,e.y-an.y)<=NEAR,mem=spec.members.filter(near),foes=spec.cast.filter(near);
  let x0=an.x,y0=an.y,x1=an.x,y1=an.y,w,h,cx,cy;
  if(fp){x0=fp.ox;y0=fp.oy;x1=fp.ox+fp.w;y1=fp.oy+fp.h;for(const e of mem.concat(foes)){x0=Math.min(x0,e.x-.5);y0=Math.min(y0,e.y-.5);x1=Math.max(x1,e.x+.5);y1=Math.max(y1,e.y+.5)} // a fight on the patch (#746): its box, grown for anyone who stands outside it
    w=x1-x0+2*PATCH_PAD;h=y1-y0+2*PATCH_PAD+PATCH_HEAD;cx=(x0+x1)/2;cy=(y0+y1)/2-PATCH_HEAD/2}
  else{for(const e of mem.concat(foes)){x0=Math.min(x0,e.x);y0=Math.min(y0,e.y);x1=Math.max(x1,e.x);y1=Math.max(y1,e.y)}
    const [mw,mh]=spec.camp?OUTDOOR_SETTINGS.camp.cut:[18,11]; // a camp's cut is small: the fire and the ring round it (#431 slice 3)
    w=Math.max(tallView?Math.min(11,mh+2):mw,x1-x0+(tallView?5:spec.camp?6:9));h=Math.max(tallView?Math.max(15,mw):mh,y1-y0+(spec.camp?5:7));cx=(x0+x1)/2;cy=(y0+y1)/2-.4}
  const cur=sc&&!sc.all&&sc.phase==='turn'?byId(sc.ids[sc.i]):null;
  const ban=document.getElementById('tbanner'),bar=root&&root.querySelector('.dgbar'),ins=banInset(ban),bot=bar?bar.offsetHeight+6:6;
  return {cx,cy,w,h,edge:cx-w/2<0||cy-h/2<0||cx+w/2>W||cy+h/2>H,members:mem,foes,cur,speaker,patch:fp||null,
    top:ins?6:ban&&!ban.hidden?ban.offsetHeight+10:6,right:ins&&ins.right||0,bottom:ins&&ins.bottom?Math.max(bot,ins.bottom):bot,biome:biomeOfZone(zoneAt(Math.max(0,Math.min(W-1,an.x)),Math.max(0,Math.min(H-1,an.y))))}}

// Where the banner sits when it is docked beside the map (#546: outdoors too, the banner is a column on the right, or
// below the map on a phone): {right} or {bottom} in CSS px to keep the cut clear of, or null while it floats over the top.
function banInset(ban){if(!ban||ban.hidden||(ban.classList&&ban.classList.contains('tlive')))return null;const scr=document.getElementById('screen');
  if(!scr||!scr.classList||!scr.classList.contains('scopen')||!ban.getBoundingClientRect)return null;
  const b=ban.getBoundingClientRect(),r=scr.getBoundingClientRect();if(!(b.width>0&&r.width>0))return null;
  if(b.left-r.left>r.width*.3)return {right:Math.max(0,r.right-b.left)+6};
  if(b.top-r.top>r.height*.3)return {bottom:Math.max(0,r.bottom-b.top)+6};return null}

// ---- a fight on the map patch (#746): the ground marks ----
const PATCH_PAD=1,PATCH_HEAD=.5; // tiles of margin round the patch, and a little more above for the heads on its top row
const LK=4,LT=T*LK,DOT=3; // the layer's texels a world unit and a tile; the texels of a glyph's dot
const SHIELD=['XXXXXXX','XoooooX','XoooooX','XoooooX','.XoooX.','..XoX..','...X...'],WAVE=['.oo...oo...','o..o.o..o.o','....o....o.'];
function glyph(x,rows,gx,gy,col){const rim=SCENE.markRim; // o the colour, X the rim; a glyph with no X gets a dark copy a dot lower
  if(!rows.some(r=>r.includes('X'))){x.fillStyle=rim;rows.forEach((r,j)=>[...r].forEach((c,i)=>{if(c==='o')x.fillRect(gx+i*DOT,gy+(j+1)*DOT,DOT,DOT)}))}
  rows.forEach((r,j)=>[...r].forEach((c,i)=>{if(c==='.')return;x.fillStyle=c==='X'?rim:col;x.fillRect(gx+i*DOT,gy+j*DOT,DOT,DOT)}))}
// The marks of one grid, painted once: a line round every tile one can stand on (solid ground stays clear, so the ground reads by its
// grid), cover and slow tiles washed and marked in opposite corners, the patch's edge. G comes from patchGrid, which caches it.
// Cover and slow ground are the sim's own and stay so (patch.js), but a patch on a stone floor, a lair or a field of snow can be nearly all of one,
// and a glyph on every tile says nothing. A few tiles are all marked; many, only a handful spread over the ground, the named one first.
const MANY=.2,FEW=4,SLOW_FEW=6;
function marks(G,test,few,spot){const n=G.w*G.h,out=new Uint8Array(n),all=[];let ok=0;for(let k=0;k<n;k++){if(G.ok[k])ok++;if(G.ok[k]&&test(k))all.push(k)}
  if(all.length<=Math.max(few,Math.floor(ok*MANY))){for(const k of all)out[k]=1;return out}
  const xy=k=>[k%G.w,Math.floor(k/G.w)],f=spot?spot.y*G.w+spot.x:-1,pick=[f>=0&&all.includes(f)?f:all[0]];
  while(pick.length<few){let b=-1,bd=-1;for(const k of all){if(pick.includes(k))continue;const [x,y]=xy(k);let d=1e9;for(const q of pick){const [qx,qy]=xy(q);d=Math.min(d,Math.max(Math.abs(x-qx),Math.abs(y-qy)))}if(d>bd){bd=d;b=k}}if(b<0)break;pick.push(b)}
  for(const k of pick)out[k]=1;return out}
export const coverMarks=G=>marks(G,k=>G.cover[k],FEW,G.spots&&G.spots.cover);
export const slowMarks=G=>marks(G,k=>G.cost[k]>1,SLOW_FEW,null); // the wash stays on every slow tile; this is the glyph
const layers=new WeakMap();
export function patchLayer(G){let c=layers.get(G);if(c)return c;c=document.createElement('canvas');c.width=G.w*LT;c.height=G.h*LT;const x=c.getContext('2d'),ok=(i,j)=>i>=0&&j>=0&&i<G.w&&j<G.h&&!!G.ok[j*G.w+i],cv=coverMarks(G),sm=slowMarks(G);
  for(let j=0;j<G.h;j++)for(let i=0;i<G.w;i++){const k=j*G.w+i,px=i*LT,py=j*LT;if(!G.ok[k])continue;
    if(G.cost[k]>1){x.fillStyle=SCENE.slowWash;x.fillRect(px,py,LT,LT)}if(cv[k]){x.fillStyle=SCENE.coverWash;x.fillRect(px,py,LT,LT)}}
  for(let j=0;j<=G.h;j++)for(let i=0;i<=G.w;i++){const px=i*LT,py=j*LT; // each line once: the top and left of every tile, and of the row and column past the end
    if(i<G.w&&(ok(i,j)||ok(i,j-1))){x.fillStyle=SCENE.grid;x.fillRect(px,py-1,LT,2);x.fillStyle=SCENE.gridHi;x.fillRect(px,py+1,LT,1)}
    if(j<G.h&&(ok(i,j)||ok(i-1,j))){x.fillStyle=SCENE.grid;x.fillRect(px-1,py,2,LT);x.fillStyle=SCENE.gridHi;x.fillRect(px+1,py,1,LT)}}
  for(let j=0;j<G.h;j++)for(let i=0;i<G.w;i++){const k=j*G.w+i,px=i*LT,py=j*LT;if(!G.ok[k])continue;
    if(cv[k])glyph(x,SHIELD,px+5,py+5,SCENE.cover);if(sm[k])glyph(x,WAVE,px+LT-WAVE[0].length*DOT-5,py+LT-(WAVE.length+1)*DOT-5,SCENE.slow)}
  x.fillStyle=SCENE.patchEdge;x.fillRect(0,0,c.width,3);x.fillRect(0,c.height-3,c.width,3);x.fillRect(0,0,3,c.height);x.fillRect(c.width-3,0,3,c.height);
  layers.set(G,c);return c}
function drawPatch(ctx,fp){const c=patchLayer(patchGrid(fp));ctx.drawImage(c,0,0,c.width,c.height,fp.ox*T,fp.oy*T,fp.w*T,fp.h*T)}

// ---- a fight on the map patch (#746): the beats ----
// As render/crawlview.js plays a crawl room, with the same timings, words and motions; its helpers are private to it, so the few small
// tables are repeated here. A pose is what one member or foe shows: bx/by the place it has reached, x/y that plus the beat's motion.
const SPEED=3.4,FOE_PACE=.8,SNAP=7;  // tiles a second a member walks; a foe's share of that; further than this is no walk (a blink)
const BEAT={strike:.8,blow:.7,save:.6,ring:.6,other:.45},COLD=.75,WALK_WAIT=1.2,HOLD_S=3,FALL_S=1.3,STUMBLE_S=1.1,LIE=.5,POP_S=1.1;
const pace=()=>TABLE.speed>=8?0:TABLE.speed>=3?.4:1; // at 3x the beats play fast; at 8x they are skipped
const WORD={guard:'on me',hold:'hold!',ward:'ward',retreat:'fall back',stabilize:'bound',stunned:'stunned',attempt:'tries',yield:'yields',flee:'runs',breath:'breath!'};
const GREY=new Set(['retreat','stunned','attempt','yield','flee']);
const PL={fp:null,seen:0,last:-1,play:null,hold:-1,foes:[]},poses=new Map(),Q=[],pops=[];for(let k=0;k<24;k++)pops.push({on:false,x:0,y:0,txt:'',col:'',t0:0});
const at=e=>poses.get(e)||e; // where to show e: its pose in a fight on a patch, else where it stands
export const scenePose=e=>poses.get(e)||null;
export const sceneQueue=()=>Q.map(q=>q.k);
function playReset(){PL.fp=null;PL.seen=0;PL.last=-1;PL.play=null;PL.hold=-1;PL.foes=[];poses.clear();Q.length=0;for(const p of pops)p.on=false}
const playHolds=now=>{if(!PL.fp||!Q.length||!pace())return false;if(PL.hold<0)PL.hold=now;return now-PL.hold<HOLD_S};
function pop(x,y,txt,col,now){let p=pops[0];for(const q of pops){if(!q.on){p=q;break}if(q.t0<p.t0)p=q}p.on=true;p.x=x;p.y=y;p.txt=txt;p.col=col;p.t0=now}
const poseFor=(e,foe)=>{let p=poses.get(e);if(!p){p={e,foe,bx:e.x,by:e.y,x:e.x,y:e.y,hp:Math.max(0,e.hp),show:e.hp,pend:0,fresh:0,walk:false,face:e.face<0?-1:1,dir:0,tilt:0,flash:0,col:'',fade:1,flashAt:-9,shakeAt:-9,stumbleAt:-9,claim:0,fellAt:-1};poses.set(e,p)}return p};
const entOf=r=>r.kind==='boss'?S.boss:r.kind==='hero'?byId(r.id):S.mobs.find(m=>m.id===r.id)||null;
const gone=e=>(e.kind==='mob'||e.kind==='boss')&&!e.alive; // a fallen hero foe is a grave in the world already
const popAt=(p,txt,col,now,up=0)=>pop(p.bx,p.by-(p.e.kind==='boss'?3.4:HEAD/T+.5)-up,txt,col,now); // starts above the nameplate (HEAD), not on it
// A new patch, or the view back after a gap: everyone where they stand, nothing replayed.
function playBegin(sc,fp){playReset();PL.fp=fp;PL.seen=sc.beats.length;PL.foes=fp.foes.map(r=>({name:r.name,e:entOf(r)})).filter(f=>f.e);
  for(const id of sc.ids){const a=byId(id);if(a)poseFor(a,false)}for(const f of PL.foes)poseFor(f.e,true)}
// The foe a beat means: by name, the nearest to who it was aimed from (a pack shares a name); a killing blow means one just fallen.
function foeNamed(name,from,dead){let b=null,bd=1e9;for(const f of PL.foes){if(f.name!==name)continue;const p=poses.get(f.e);
    const wrong=dead?!gone(f.e)||p.claim>0||p.fellAt>=0:gone(f.e),d=(from?Math.hypot(p.bx-from.bx,p.by-from.by):0)+(wrong?99:0);if(d<bd){bd=d;b=p}}
  return b||(PL.foes.length===1?poses.get(PL.foes[0].e):null)}
const heroNamed=name=>{for(const p of poses.values())if(!p.foe&&p.e.name===name)return p;return null};
// One beat of the scene, queued with what the view needs to show it.
function enqueue(b,now){const r=b.roll,foeSide=b.by==='foe',k=String(b.k),res=String(b.res||''),q={k,res,src:null,tgt:null,dmg:0,hit:false,crit:false,fumble:false,kill:false,blow:!!r,dur:BEAT.other,t0:-1,p:0,made:now,popped:false,settled:false};
  if(foeSide){q.src=foeNamed(b.name,r?heroNamed(r.target):null,false);if(r)q.tgt=heroNamed(r.target)}
  else{const a=byId(b.id);q.src=a?poses.get(a)||null:null;if(r)q.tgt=foeNamed(r.target,q.src,!!r.down)}
  if(r){q.dur=foeSide?BEAT.blow:BEAT.strike;q.hit=!!r.hit;q.crit=!!r.crit;q.fumble=r.die===1&&!r.hit;q.kill=!!r.down;q.dmg=r.dmg||0;
    if(q.tgt){q.tgt.pend+=q.dmg;q.tgt.fresh+=q.dmg;if(q.kill)q.tgt.claim++}}
  else if(k==='save')q.dur=BEAT.save;
  else if(SCENE.ring[k]){q.dur=BEAT.ring;const m=/^\+(\d+) to (.+?)(?: \(|$)/.exec(res);if(m){q.dmg=+m[1];q.tgt=heroNamed(m[2])}}
  Q.push(q)}
function settle(q){if(q.settled)return;q.settled=true;if(q.blow&&q.tgt){q.tgt.pend=Math.max(0,q.tgt.pend-q.dmg);if(q.kill)q.tgt.claim=Math.max(0,q.tgt.claim-1)}}
// The moment a beat lands: the flash, the shake on a 20, the stumble on a 1, and its words floating up.
function land(q,now){q.popped=true;settle(q);const s=q.src,t=q.tgt,W=SCENE.word;
  if(q.blow){if(!t)return;
    if(q.hit){t.flashAt=now;t.col=t.foe?SCENE.hitFoe:SCENE.hitHero;if(q.crit)t.shakeAt=now;popAt(t,'-'+q.dmg+(q.crit?'!':''),t.foe?W.hit:W.hurt,now);if(q.kill){popAt(t,'down',W.fell,now,.6);if(gone(t.e)&&t.fellAt<0)t.fellAt=now}}
    else{popAt(t,'miss',W.miss,now);if(q.fumble&&s){s.stumbleAt=now;popAt(s,'a 1!',W.fumble,now,.4)}}return}
  if(!s)return;
  if(q.k==='strike'&&/^out of reach|^rooted/.test(q.res)){popAt(s,'out of reach',W.miss,now);return}
  if(q.k==='save'){const d=/d20 (\d+) vs DC (\d+)/.exec(q.res);if(d)popAt(s,'save '+d[1],+d[1]>=+d[2]?W.heal:W.fail,now);return}
  if(q.k==='heal'&&q.dmg){popAt(t||s,'+'+q.dmg,W.heal,now);return} // a potion's number is the sim's own pop, left alone
  const w=WORD[q.k];if(w)popAt(s,w,GREY.has(q.k)?W.miss:SCENE.ring[q.k]||W.plain,now)}
function playQueue(now){const f=pace();if(!f){while(Q.length)settle(Q.shift());PL.play=null;return}
  const speed=Q.length>6?Q.length/6:1; // a backlog (a reflex round resolved at once) plays faster
  while(Q.length){const q=Q[0];
    if(q.t0<0){if(q.src&&q.src.walk&&now-q.made<WALK_WAIT){PL.play=null;return}q.t0=now} // the one acting gets there first
    q.p=Math.min(1,(now-q.t0)/(q.dur*f/speed));if(!q.popped&&(q.p>=.45||!q.blow))land(q,now);
    if(q.p<1){PL.play=q;return}if(!q.popped)land(q,now);settle(q);Q.shift()}
  PL.play=null}
// How far the beat's mover is off its place, toward what it strikes (crawlview.js lungeOf).
const lungeOf=(q,p)=>{if(!q||!q.blow||q.src!==p||!q.tgt)return 0;return Math.sin(Math.min(1,q.p/.8)*Math.PI)*Math.min(.65,Math.max(0,Math.hypot(q.tgt.bx-p.bx,q.tgt.by-p.by)-.75))};
function facing(p,dx,dy){if(Math.abs(dx)>.05)p.face=dx>0?1:-1;p.dir=Math.abs(dx)>=Math.abs(dy)?(dx<0?1:2):(dy<0?3:0)}
function nearestOther(p){let b=null,bd=1e9;for(const o of poses.values()){if(o.foe===p.foe||gone(o.e))continue;const d=Math.hypot(o.bx-p.bx,o.by-p.by);if(d<bd){bd=d;b=o}}return b}
// Once a frame: new beats join the queue, everyone walks toward where the sim has them, the queue plays, the poses are set.
function playTick(sc,now){const fp=sc&&sc.id===openId&&sc.fp||null;if(!fp&&!PL.fp)return;
  const gap=PL.last<0?99:now-PL.last;if(fp&&(fp!==PL.fp||gap>COLD))playBegin(sc,fp);
  const dt=Math.min(.1,Math.max(0,gap)),f=pace();PL.last=now;
  if(fp)for(;PL.seen<sc.beats.length;PL.seen++)enqueue(sc.beats[PL.seen],now);
  for(const p of poses.values()){const e=p.e,hp=Math.max(0,e.hp),un=p.hp-hp-p.fresh;
    if(un>1&&f){p.flashAt=now;p.col=p.foe?SCENE.hitFoe:SCENE.hitHero;popAt(p,'-'+Math.round(un),p.foe?SCENE.word.hit:SCENE.word.hurt,now)} // nothing in the beats explains it: a spell, a poison
    p.hp=hp;p.fresh=0;if(gone(e)&&p.fellAt<0&&!p.claim)p.fellAt=now;
    const dx=e.x-p.bx,dy=e.y-p.by,d=Math.hypot(dx,dy),s=SPEED*(p.foe?FOE_PACE:1)*dt;p.walk=false;
    if(d>.02&&!gone(e)){if(!f||d>SNAP||d<=s){p.bx=e.x;p.by=e.y}else{p.bx+=dx/d*s;p.by+=dy/d*s;p.walk=true}facing(p,dx,dy)}}
  playQueue(now);const q=PL.play;
  for(const p of poses.values()){let x=p.bx,y=p.by;if(!p.walk){const o=nearestOther(p);if(o)facing(p,o.bx-p.bx,o.by-p.by)}
    const lg=lungeOf(q,p);if(lg){const t=q.tgt,d=Math.hypot(t.bx-p.bx,t.by-p.by)||1;x+=(t.bx-p.bx)/d*lg;y+=(t.by-p.by)/d*lg}
    const sk=now-p.shakeAt,st=now-p.stumbleAt,fl=now-p.flashAt,fa=p.fellAt<0?0:(now-p.fellAt)/FALL_S,ease=Math.min(1,fa/.4);
    if(sk<.45)x+=Math.round(Math.sin(sk*70)*1.5)/T;
    p.tilt=st<STUMBLE_S?Math.sin(st/STUMBLE_S*Math.PI)*.75*p.face:fa>0?(1-(1-ease)*(1-ease))*Math.PI/2*p.face:0; // a fall: over to the ground in the first 40%, lying, then fading in the last (it used to fade as it turned)
    p.flash=fl<.3?.8*(1-fl/.3):0;p.fade=fa>LIE?Math.max(0,1-(fa-LIE)/(1-LIE)):1;p.x=x;p.y=y;p.show=p.e.hp+p.pend}}
// The foes the world no longer draws but the fight still shows: their last blow is yet to land, or they are falling.
export function sceneFallen(list){for(const p of poses.values())if(gone(p.e)&&p.fade>0)list.push(p.e)}
// A sprite (or a whole sheet) filled with one colour, cached per source: the hit flash, as crawlview.js tints its own.
const tints=new WeakMap();
export function sceneTint(c,col){let m=tints.get(c);if(!m){m={};tints.set(c,m)}if(m[col])return m[col];
  const o=document.createElement('canvas');o.width=c.width;o.height=c.height;const x=o.getContext('2d');x.drawImage(c,0,0);x.globalCompositeOperation='source-in';x.fillStyle=col;x.fillRect(0,0,o.width,o.height);return m[col]=o}
// A guard, a ward or a heal spreads a ring under the feet as it plays.
function drawBeatRing(ctx,px1){const q=PL.play;if(!q||!q.src||!SCENE.ring[q.k])return;const p=q.tgt||q.src,r=q.k==='ward'?.6+q.p*2.6:.5+q.p*.5;
  ctx.strokeStyle=SCENE.ring[q.k];ctx.globalAlpha=Math.max(0,1-q.p)*.9;ctx.lineWidth=2*px1;ctx.beginPath();ctx.ellipse(p.x*T,p.y*T,r*T,r*T*.45,0,0,7);ctx.stroke();ctx.globalAlpha=1}
// Over the night wash: a shot from afar as a short streak, and the words floating up.
function drawPops(ctx,cam,now){const q=PL.play,s=20*cam.dpr/cam.sc;
  if(q&&q.blow&&q.src&&q.tgt&&q.p<.6){const a=q.src,b=q.tgt;if(Math.hypot(b.bx-a.bx,b.by-a.by)>1.6){const t=q.p/.6;ctx.fillStyle=SCENE.shot;for(let k=0;k<3;k++){const u=Math.max(0,t-k*.07);ctx.globalAlpha=1-k*.3;ctx.fillRect(Math.round((a.bx+(b.bx-a.bx)*u)*T),Math.round((a.by+(b.by-a.by)*u-.7)*T),2,2)}ctx.globalAlpha=1}}
  ctx.font=s+'px VT323, monospace';ctx.textAlign='center';
  for(const p of pops){if(!p.on)continue;const t=now-p.t0;if(t>POP_S){p.on=false;continue}const x=p.x*T,y=(p.y-t*.8)*T;ctx.globalAlpha=Math.min(1,(POP_S-t)*2.2);ctx.fillStyle=SCENE.markRim;ctx.fillText(p.txt,x+s*.08,y+s*.08);ctx.fillStyle=p.col;ctx.fillText(p.txt,x,y)}
  ctx.globalAlpha=1}

// A generated ground for past the map's edge: four by four tiles of the biome's ground, from the terrain's own texels.
const arenaC={};
export function arenaPattern(ctx,biome){if(arenaC[biome])return arenaC[biome];const t=biome==='tundra'?SNOW:biome==='ash'?ROCK:biome==='fen'?SGRASS:G;
  const c=document.createElement('canvas');c.width=c.height=4*T;const x=c.getContext('2d');
  for(let ty=0;ty<4;ty++)for(let tx=0;tx<4;tx++)for(let py=0;py<T;py++)for(let px=0;px<T;px++){x.fillStyle=texel(t,9000+tx,9000+ty,px,py);x.fillRect(tx*T+px,ty*T+py,1,1)}
  return arenaC[biome]=ctx.createPattern(c,'repeat')}

// The outdoor marks (ctx in world transform sc/offX/offY): a ring at the feet of everyone in the scene, before the
// sprites (drawSceneRings); after the world is drawn, the turn chevron, the speaker's bubble, the cut's frame and the
// dim past it (drawSceneMarks).
export function drawSceneRings(ctx,cam,cut){const px1=cam.dpr/cam.sc; // under the sprites
  if(cut.patch)drawPatch(ctx,cut.patch);
  for(const e of cut.members.concat(cut.foes)){const hero=e.kind==='hero'&&inSlots(e),col=hero?classColor(e.cls):e.kind==='npc'||e.role?SCENE.person:SCENE.foe,p=at(e);
    ctx.strokeStyle=col;ctx.globalAlpha=.85;ctx.lineWidth=1.5*px1;ctx.beginPath();ctx.ellipse(p.x*T,p.y*T+.5,7*PROC_SCALE*.75,2.8,0,0,7);ctx.stroke()}
  ctx.globalAlpha=1;if(cut.patch)drawBeatRing(ctx,px1)}
export function drawSceneMarks(ctx,cam,cut,now){const sc=cam.sc;
  if(cut.cur&&live(cut.cur)){const px1=cam.dpr/sc,m=Math.max(3,5*px1),p=at(cut.cur),x=Math.round(p.x*T),y=Math.round(p.y*T-HEAD-16*px1-2*m-px1-7+Math.sin(now*5));ctx.fillStyle=MARK.edge;ctx.fillRect(x-4,y-1,9,5);ctx.fillStyle=SCENE.turn;ctx.fillRect(x-3,y,7,1);ctx.fillRect(x-2,y+1,5,1);ctx.fillRect(x-1,y+2,3,1);ctx.fillRect(x,y+3,1,1)}
  {const mk=answerMarks(S.table),px1=cam.dpr/sc,m=Math.max(3,5*px1); // "..." while a member thinks, a tick once answered (#536)
    for(const e of cut.members){const k=mk[e.id];if(!live(e)||(k!=='think'&&k!=='done')||e===cut.cur)continue;const p=at(e);answerMark(ctx,p.x*T,Math.round(p.y*T-HEAD-16*px1-2*m-px1-1),k,now)}}
  const s=cut.speaker;if(s&&s.e&&live(s.e)&&!(s.e.bubble&&s.e.bubble.life>0)){const e=s.e,hero=e.kind==='hero',p=at(e);
    bubble(ctx,p.x*T,p.y*T-HEAD-1,hero?e.name.toUpperCase():'['+(e.name||'?')+']',hero&&inSlots(e)?classColor(e.cls):e.kind==='mob'||hero?DISP.hostile.color:DISP.neutral.color,s.text,cam.dpr,sc,Math.min(1,(SPEAK_S-(clock()-s.t))/.6))}
  if(cut.patch)drawPops(ctx,cam,now); // last of the world marks: a word-pop floats over the chips and bubbles, never under them
  if(cam.director)return; // the cinema view shows the whole picture (#979)
  // screen space: dim outside the cut, a thin gold frame with corner brackets
  ctx.setTransform(1,0,0,1,0,0);const cv=ctx.canvas,x0=Math.round((cut.cx-cut.w/2)*T*sc+cam.offX),y0=Math.round((cut.cy-cut.h/2)*T*sc+cam.offY),x1=Math.round((cut.cx+cut.w/2)*T*sc+cam.offX),y1=Math.round((cut.cy+cut.h/2)*T*sc+cam.offY);
  ctx.fillStyle=SCENE.dim;if(y0>0)ctx.fillRect(0,0,cv.width,y0);if(y1<cv.height)ctx.fillRect(0,y1,cv.width,cv.height-y1);if(x0>0)ctx.fillRect(0,Math.max(0,y0),x0,Math.min(cv.height,y1)-Math.max(0,y0));if(x1<cv.width)ctx.fillRect(x1,Math.max(0,y0),cv.width-x1,Math.min(cv.height,y1)-Math.max(0,y0));
  const d=cam.dpr,L=14*d;ctx.fillStyle=SCENE.frame;ctx.globalAlpha=.9;
  for(const [x,y,sx,sy] of [[x0,y0,1,1],[x1,y0,-1,1],[x0,y1,1,-1],[x1,y1,-1,-1]]){ctx.fillRect(sx>0?x:x-L,sy>0?y:y-2*d,L,2*d);ctx.fillRect(sx>0?x:x-2*d,sy>0?y:y-L,2*d,L)}
  ctx.globalAlpha=1;ctx.setTransform(sc,0,0,sc,cam.offX,cam.offY)}

// ---- the overlay: the bar (and, indoors, its own canvas) inside #screen after the world canvas ----
let root=null,cv=null,ctx=null,nameEl=null,statEl=null,whoEl=null,sig='',inited=false;
const mk=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
function build(){const scr=document.getElementById('screen');if(!scr)return false;
  root=mk('div','dgview scview');root.id='sceneview';root.hidden=true;root.setAttribute('role','region');root.setAttribute('aria-label','Scene view');
  cv=mk('canvas','dgcv');cv.setAttribute('aria-label','Map of the scene');ctx=cv.getContext?cv.getContext('2d'):null;
  const bar=mk('div','dgbar'),back=mk('button','dgback','◀ Back to world');back.type='button';back.onclick=e=>{e.stopPropagation();closeSceneView(true)};
  const txt=mk('div','dgtxt');nameEl=mk('b','dgname');statEl=mk('span','dgstat');txt.append(nameEl,' ',statEl);
  whoEl=mk('ul','dgrooms scwho');whoEl.setAttribute('aria-label','Who is in the scene');bar.append(back,txt,whoEl);root.append(cv,bar);
  for(const ev of ['click','pointerdown','pointermove','wheel'])root.addEventListener(ev,e=>e.stopPropagation(),ev==='wheel'?{passive:true}:undefined);
  const after=document.getElementById('cv');if(after&&after.nextSibling)scr.insertBefore(root,after.nextSibling);else scr.append(root);return true}
function syncBtn(){const b=typeof document!=='undefined'&&document.getElementById('vScene');if(!b)return;b.textContent='Scene maps: '+(auto?'auto':'off');b.setAttribute('aria-pressed',String(auto))}
export function initSceneView(){if(inited||typeof document==='undefined')return;inited=true;
  document.addEventListener('click',e=>{const t=e.target&&e.target.closest?e.target.closest('[data-scene]'):null;if(!t)return;if(open)closeSceneView(true);else openSceneView()});
  document.addEventListener('keydown',e=>{if(open&&e.key==='Escape')closeSceneView(true)});
  const b=document.getElementById('vScene');if(b)b.onclick=()=>setSceneAuto(!auto);syncBtn()}

// ---- what the map and the bar show besides the room (#536) ----
const secs=n=>Math.max(0,Math.ceil(n))+' s';
// The waiting timer of a scene: seconds waited, or the time left before reflexes once the nudge has gone out.
function timerOf(sc){if(!sc||sc.phase!=='turn')return '';let t=0;
  if(sc.all){for(const id of sc.ids)if(!(sc.acts&&sc.acts[id])){const w=sc.w&&sc.w[id];t=Math.max(t,(w&&w.t)||0)}}else t=sc.t||0;
  return t*1000>=TABLE.turnMs?'reflex in '+secs(TABLE.liveMs/1000-t):t>=1?secs(t):''}
// The bar's status: the answer count (everyone at once) or whose turn it is, and the timer.
export function barStatus(sc=S.table){if(!sc)return '';const alive=sc.ids.map(byId).filter(a=>a&&a.state!=='dead'),n=alive.filter(a=>sc.acts&&sc.acts[a.id]).length,tm=timerOf(sc);
  if(sc.phase==='frame')return 'Setting the scene';
  if(sc.phase==='outcome'||sc.resolved)return 'Scene ends';
  if(sc.all)return 'Answers '+n+'/'+alive.length+(tm?' · '+tm:'');
  const cur=byId(sc.ids[sc.i]);return (cur?cur.name+(sc.acts&&sc.acts[cur.id]?' acts':' to act'):'Turn '+(sc.i+1))+(tm?' · '+tm:'')}
// Over each member's head: 'done' once answered, 'think' while an agent's answer is awaited (everyone at once), 'turn'
// for the one acting in a turn-by-turn scene (the gold chevron).
export function answerMarks(sc=S.table){const o={};if(!sc||sc.phase==='outcome')return o;
  sc.ids.forEach((id,i)=>{const a=byId(id);if(!a||a.state==='dead')return;if(sc.acts&&sc.acts[id])o[id]='done';else if(sc.phase==='turn'||sc.phase==='frame'){if(sc.all)o[id]='think';else if(i===sc.i)o[id]='turn'}});
  return o}
// How dim the room is: the setting's own dimness, deeper at night and dusk, and as the frame tells it.
const DARKW=/\b(dark|darkness|gloom|gloomy|shadow(s|ed|y)?|gutter(s|ing|ed)?|dim(ly|ming)?|unlit|pitch|black|midnight|night|moonless|guttering)\b/i,BRIGHTW=/\b(sunlit|sunlight|bright|blazing|lamplit|well[- ]lit|noon|daylight)\b/i;
export const DARK_CAP=.55; // owner request: a room never goes near-black, whatever the hour and the frame (setting dark + night + gloom, capped)
export function sceneDark(sc=S.table,base=0){const h=(((S.gameMin||0)%1440)+1440)%1440/60,said=(sc?[sc.title,plain(sc.frame)].join(' '):'');
  let d=base+(h<5||h>=21?.3:h<7||h>=19?.15:0);if(DARKW.test(said))d+=.2;if(BRIGHTW.test(said))d-=.15;
  return Math.max(0,Math.min(DARK_CAP,Math.round(d*100)/100))}
// The one item the frame or the person's words name, drawn as a small lit prop in front of the speaker. Order matters:
// the first kind whose words appear wins.
export function sceneItem(sc=S.table){const p=liveProps(sc)[0];return p?p.id:null} // from sc.props (sim/props.js, #592); a prop whose item was handed to a hero (give_item, #524) is gone

// The bar: the answer count and the timer, then where it is; outdoors also who is there (members in class colour, the
// cast in theirs). The scene's title lives in the banner (#536: one place per fact).
export function refreshScene(){if(!root||!open||!spec)return null;const sp=spec,people=sp.members.concat(sp.cast),stat=barStatus(S.table)||'Scene ends',indoor=sp.mode==='indoor'; // no scene left: a fight's last beats are still playing (#746)
  const s=stat+'|'+sp.where+'|'+sp.mode+'|'+people.map(e=>e.id+(live(e)?'':'x')).join(',');if(s===sig)return sp;sig=s;
  nameEl.textContent=stat;nameEl.title=sp.title||'';statEl.textContent=sp.where;whoEl.hidden=indoor;
  if(!indoor){whoEl.textContent='';for(const e of people){const li=mk('li','scp'+(live(e)?'':' gone'),e.kind==='mob'?(e.name||'foe'):e.name||'?');
    li.style.color=e.kind==='hero'&&inSlots(e)?classColor(e.cls):e.kind==='mob'||e.kind==='boss'||e.kind==='hero'?DISP.hostile.color:DISP.neutral.color;whoEl.append(li)}}
  else whoEl.textContent='';
  const bar=root.querySelector('.dgbar'),scr=document.getElementById('screen');if(bar&&scr&&scr.style&&scr.style.setProperty)scr.style.setProperty('--scbar',(bar.offsetHeight+8)+'px');
  return sp}

// The room's box inside the view (device px): the view less the bar and, when the banner is docked beside or below the
// map (#536), less the banner: the larger of the area left of it and the area above it.
export function roomBox(r,ban,barH,dpr){const pad=r.right-r.left<600?4:8; /* a phone keeps every pixel for a whole-number scale */let x0=r.left+pad,y0=r.top+pad,x1=r.right-pad,y1=r.bottom-barH-pad;
  if(ban&&ban.width>0&&ban.height>0){const left=Math.max(0,ban.left-pad-x0)*(y1-y0),above=Math.max(0,ban.top-pad-y0)*(x1-x0);
    if(left>=above&&left>0)x1=Math.min(x1,ban.left-pad);else if(above>0)y1=Math.min(y1,ban.top-pad);else y0=Math.max(y0,ban.bottom+pad)}
  return {x:Math.round((x0-r.left)*dpr),y:Math.round((y0-r.top)*dpr),w:Math.max(1,Math.round((x1-x0)*dpr)),h:Math.max(1,Math.round((y1-y0)*dpr))}}

// One indoor frame (draw.js calls it instead of the world while an indoor scene is open).
export function drawSceneView(now){if(!open||!root||!spec||spec.mode!=='indoor'||!ctx)return false;refreshScene();
  const dpr=window.devicePixelRatio||1,r=root.getBoundingClientRect(),Wd=Math.max(1,Math.round(r.width*dpr)),Hd=Math.max(1,Math.round(r.height*dpr));
  if(cv.width!==Wd||cv.height!==Hd){cv.width=Wd;cv.height=Hd}
  const ban=document.getElementById('tbanner'),bar=root.querySelector('.dgbar'),box=roomBox(r,ban&&!ban.hidden?ban.getBoundingClientRect():null,bar?bar.offsetHeight:0,dpr);
  ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='rgb(6,6,11)';ctx.fillRect(0,0,Wd,Hd);
  const m=buildSetting(spec.setting,spec.key),sc=S.table,cur=sc&&!sc.all&&sc.phase==='turn'?byId(sc.ids[sc.i]):null;
  drawSetting(ctx,box,m,{party:spec.members.filter(a=>a.state!=='dead'),cast:spec.cast.filter(live),speaker,cur,busy:!!sc&&sc.phase==='turn',
    marks:answerMarks(sc),dark:sceneDark(sc,m.dark||0),item:sceneItem(sc),people:peopleOf(spec)},now,dpr);
  return true}
// Outdoor: the bar only (the world shows through); refreshed from draw.js each frame.
export function refreshOutdoor(){if(open&&spec&&spec.mode==='outdoor')refreshScene()}
