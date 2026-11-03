// The scene view (#431, slice 1): a Table scene (sim/table.js S.table, read only) shown on its own scene map.
//   indoor   a staged meeting or social scene in a town plays in a generated room from data/settings.js (a house,
//            a tavern back room, a chapel, a cellar, an interrogation cell, a shrine, a ship's hold), drawn by
//            render/interior.js drawSetting over the world canvas, like the dungeon view (#85)
//   outdoor  everything else in the open (ambush, elite, rescue, a parley inside those fights, the boss, a DM trap or
//            mystery, checks, choices and votes) is a zoomed-in cut of the real overworld at the scene's spot: the
//            world renderer (render/draw.js) keeps drawing the chunk terrain, trees, road, river, snow, weather, night,
//            the members and foes where they stand, condition glyphs and spell effects, and only takes its camera
//            from sceneCut(); past the map's edge a generated biome arena fills in (arenaPattern)
//   dungeon  the Crypt's scenes (site, room, crawl) open the dungeon view as before (render/dungeonview.js)
// The view opens by itself when the followed Fellowship's scene opens (Settings: "Scene maps: auto", kept in this
// browser), returns to the world when the scene ends, and "Back to world" closes it for that scene. The Table banner's
// "Scene map" button (data-scene) opens it by hand. Everything here reads S; nothing writes it.
//
// Exports (DOM-free where it matters, so the stub-DOM smoke can drive them):
//   sceneSpec(sc)     {mode, kind, title, members, cast, anchor:{x,y}, town, setting, key, where} for a scene, or null
//   pickSetting(sc, town, people)   the settings row id an indoor scene plays in
//   sceneTick(cam)    once a frame (draw.js): auto open/close, the speaker, the dungeon hand-off
//   openSceneView(), closeSceneView(), sceneOpen(), sceneMode(), sceneAuto(), setSceneAuto(on)
//   sceneCut(aspect)  the outdoor cut {cx, cy, w, h, edge, members, foes, people, cur, speaker, top, bottom} or null
//   drawSceneView(now) one indoor frame; drawSceneRings / drawSceneMarks(ctx, cam, cut, now) the outdoor marks (draw.js)
import {S} from '../sim/state.js';
import {CITY,CRYPT,ZONES,zoneAt} from '../world/map.js';
import {W,H,T,G,SNOW,ROCK,SGRASS} from '../world/tiles.js';
import {SETTINGS,SETTING_IDS} from '../data/settings.js';
import {buildSetting} from '../world/interior.js';
import {drawSetting,bubble} from './interior.js';
import {texel} from './terrain.js';
import {openDungeon,closeDungeon,dungeonOpen} from './dungeonview.js';
import {biomeOfZone,SCENE,MARK,TEXT} from './palette.js';
import {classColor,DISP} from '../core/colors.js';
import {sceneHead} from '../core/scenehead.js';

const KEY='eldmoor.sceneMaps';
const DUNGEON_KINDS=new Set(['site','room','crawl']),INDOOR_KINDS=new Set(['meeting','social']);
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
  return sc&&sc.kind==='meeting'?'tavern':'house'}

export function sceneSpec(sc=S.table){if(!sc)return null;
  const members=sc.ids.map(byId).filter(Boolean),cast=castOf(sc),an=anchorOf(sc,members);
  if(DUNGEON_KINDS.has(sc.kind))return {mode:'dungeon',kind:sc.kind,title:sc.title,members,cast,anchor:an,town:null,where:CRYPT?CRYPT.name:'the Crypt'};
  const c=sc.ctx||{},town=(c.town&&CITY.find(t=>t.name===c.town))||(an?townAt(an.x,an.y):null),z=an?zoneAt(an.x,an.y):-1;
  // indoors: in a town, or wherever the DM named a room (stage_scene setting, #431 slice 2: a house by the road)
  if(INDOOR_KINDS.has(sc.kind)&&(town||SETTINGS[c.setting])){const people=cast.filter(e=>e.kind!=='hero'&&e.kind!=='mob'),setting=pickSetting(sc,town,people),place=town?town.name:(ZONES[z]||'the wilds');
    return {mode:'indoor',kind:sc.kind,title:sc.title,members,cast,anchor:an,town,setting,key:place+'|'+sc.id,where:SETTINGS[setting].name+' in '+place}}
  return {mode:'outdoor',kind:sc.kind,title:sc.title,members,cast,anchor:an,town,where:(town?'Outside '+town.name+', ':'')+(ZONES[z]||'the wilds')}}

// ---- state ----
let open=false,openId=null,spec=null,dismissed=null,seenId=null,autoDg=false,dgShut=false,speaker=null,lastBeats=0,lastNarr=null;
export const sceneOpen=()=>open;
export const sceneMode=()=>open&&spec?spec.mode:null;
export const sceneAuto=()=>auto;
export function setSceneAuto(on){auto=!!on;try{localStorage.setItem(KEY,auto?'auto':'off')}catch(_){}syncBtn()}

// Does the watcher follow this scene's Fellowship? (Follow Fellowship, or following one of the members.)
const follows=(cam,sc)=>!!cam&&(cam.view==='fellow'||(!!cam.sel&&(sc.ids.includes(cam.sel.id)||(cam.view==='follow'&&!!cam.sel.fellow))));

export function openSceneView(sc=S.table){const sp=sceneSpec(sc);if(!sp)return false;
  if(sp.mode==='dungeon'){autoDg=true;dgShut=false;return openDungeon(CRYPT)}
  if(!root&&!build())return false;
  open=true;openId=sc.id;spec=sp;sig='';root.hidden=false;root.classList.toggle('scout',sp.mode==='outdoor');root.dataset.mode=sp.mode;
  const scr=document.getElementById('screen');if(scr)scr.classList.add('scopen');
  speaker=null;lastBeats=Math.max(0,sc.beats.length-1);lastNarr=null;track(sc);refreshScene();return true}
export function closeSceneView(byUser){if(byUser&&openId!=null)dismissed=openId;open=false;openId=null;spec=null;
  if(root)root.hidden=true;const scr=document.getElementById('screen');if(scr)scr.classList.remove('scopen')}

// The latest line at the table: a member's line in a beat, or the DM voicing the scene's person (sc.narr).
function track(sc){const nb=sc.beats.length;
  for(let i=lastBeats;i<nb;i++){const b=sc.beats[i];if(b&&b.line){const a=byId(b.id);if(a)speaker={e:a,text:b.line,t:clock()}}}lastBeats=nb;
  const nt=sc.narr&&sc.narr.text;if(nt&&nt!==lastNarr){lastNarr=nt;const who=spec&&spec.cast.find(e=>e.name&&nt.startsWith(e.name+': '));
    speaker=who?{e:who,text:nt.slice(who.name.length+2),t:clock()}:{e:null,dm:true,text:nt,t:clock()}}}
const clock=()=>typeof performance!=='undefined'?performance.now()/1000:Date.now()/1000;

// Once a frame: open on a new scene of the followed Fellowship, close when it ends, keep the speaker.
export function sceneTick(cam){const sc=S.table;
  if(sc&&sc.id!==seenId){seenId=sc.id;if(auto&&follows(cam,sc)&&dismissed!==sc.id){const sp=sceneSpec(sc);
    if(sp&&sp.mode==='dungeon'){if(!dgShut&&!dungeonOpen()){autoDg=true;openDungeon(CRYPT)}}else if(sp)openSceneView(sc)}}
  if(!sc)seenId=null;
  if(open){if(!sc||sc.id!==openId)closeSceneView(false);else{spec=sceneSpec(sc);track(sc)}}
  if(autoDg){const g=CRYPT&&CRYPT.group,inside=!!(g&&g.mem&&g.mem.some(a=>a.fellow));
    if(!dungeonOpen()&&inside)dgShut=true; // Back to world during the crawl: not again until it is over
    if(!inside){if(dungeonOpen())closeDungeon();autoDg=false;dgShut=false}}
  if(speaker&&clock()-speaker.t>SPEAK_S)speaker=null}

// ---- the outdoor cut ----
// The members and the cast near the anchor, framed with a margin; the world renderer fits it below the banner.
export function sceneCut(aspect=1.6){if(!open||!spec||spec.mode!=='outdoor'||!spec.anchor)return null;const an=spec.anchor,tallView=aspect<1; // a phone held upright frames a narrower, taller cut
  const near=e=>live(e)&&Math.hypot(e.x-an.x,e.y-an.y)<=NEAR,mem=spec.members.filter(near),foes=spec.cast.filter(near);
  let x0=an.x,y0=an.y,x1=an.x,y1=an.y;for(const e of mem.concat(foes)){x0=Math.min(x0,e.x);y0=Math.min(y0,e.y);x1=Math.max(x1,e.x);y1=Math.max(y1,e.y)}
  const w=Math.max(tallView?11:18,x1-x0+(tallView?5:9)),h=Math.max(tallView?15:11,y1-y0+7),cx=(x0+x1)/2,cy=(y0+y1)/2-.4;
  const sc=S.table,cur=sc&&!sc.all&&sc.phase==='turn'?byId(sc.ids[sc.i]):null;
  const ban=document.getElementById('tbanner'),bar=root&&root.querySelector('.dgbar');
  return {cx,cy,w,h,edge:cx-w/2<0||cy-h/2<0||cx+w/2>W||cy+h/2>H,members:mem,foes,cur,speaker,
    top:ban&&!ban.hidden?ban.offsetHeight+10:6,bottom:bar?bar.offsetHeight+6:6,biome:biomeOfZone(zoneAt(Math.max(0,Math.min(W-1,an.x)),Math.max(0,Math.min(H-1,an.y))))}}

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
  for(const e of cut.members.concat(cut.foes)){const hero=e.kind==='hero'&&e.fellow,col=hero?classColor(e.cls):e.kind==='npc'||e.role?SCENE.person:SCENE.foe;
    ctx.strokeStyle=col;ctx.globalAlpha=.85;ctx.lineWidth=1.5*px1;ctx.beginPath();ctx.ellipse(e.x*T,e.y*T+.5,7,2.8,0,0,7);ctx.stroke()}
  ctx.globalAlpha=1}
export function drawSceneMarks(ctx,cam,cut,now){const sc=cam.sc;
  if(cut.cur&&live(cut.cur)){const px1=cam.dpr/sc,m=Math.max(3,5*px1),x=Math.round(cut.cur.x*T),y=Math.round(cut.cur.y*T-17-16*px1-2*m-px1-7+Math.sin(now*5));ctx.fillStyle=MARK.edge;ctx.fillRect(x-4,y-1,9,5);ctx.fillStyle=SCENE.turn;ctx.fillRect(x-3,y,7,1);ctx.fillRect(x-2,y+1,5,1);ctx.fillRect(x-1,y+2,3,1);ctx.fillRect(x,y+3,1,1)}
  const s=cut.speaker;if(s&&s.e&&live(s.e)&&!(s.e.bubble&&s.e.bubble.life>0)){const e=s.e,hero=e.kind==='hero';
    bubble(ctx,e.x*T,e.y*T-18,hero?e.name.toUpperCase():'['+(e.name||'?')+']',hero&&e.fellow?classColor(e.cls):e.kind==='mob'||hero?DISP.hostile.color:DISP.neutral.color,s.text,cam.dpr,sc,Math.min(1,(SPEAK_S-(clock()-s.t))/.6))}
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

// The bar: the scene's short title (core/scenehead.js; the banner has the whole question, #471), where it is, and who is there (members in class colour, the cast in theirs).
export function refreshScene(){if(!root||!open||!spec)return null;const sp=spec,people=sp.members.concat(sp.cast);
  const s=sp.title+'|'+sp.where+'|'+people.map(e=>e.id+(live(e)?'':'x')).join(',')+'|'+(speaker&&speaker.dm?speaker.text:'');if(s===sig)return sp;sig=s;
  nameEl.textContent=sceneHead(sp.kind,sp.title).head.toUpperCase();nameEl.title=sp.title||'';statEl.textContent=sp.where+(speaker&&speaker.dm?' · '+speaker.text:'');
  whoEl.textContent='';for(const e of people){const li=mk('li','scp'+(live(e)?'':' gone'),e.kind==='mob'?(e.name||'foe'):e.name||'?');
    li.style.color=e.kind==='hero'&&e.fellow?classColor(e.cls):e.kind==='mob'||e.kind==='boss'||e.kind==='hero'?DISP.hostile.color:DISP.neutral.color;whoEl.append(li)}
  return sp}

// One indoor frame (draw.js calls it instead of the world while an indoor scene is open).
export function drawSceneView(now){if(!open||!root||!spec||spec.mode!=='indoor'||!ctx)return false;refreshScene();
  const dpr=window.devicePixelRatio||1,r=root.getBoundingClientRect(),Wd=Math.max(1,Math.round(r.width*dpr)),Hd=Math.max(1,Math.round(r.height*dpr));
  if(cv.width!==Wd||cv.height!==Hd){cv.width=Wd;cv.height=Hd}
  const ban=document.getElementById('tbanner'),top=ban&&!ban.hidden?(ban.offsetHeight+12)*dpr:8*dpr,bar=root.querySelector('.dgbar'),bot=(bar?bar.offsetHeight:0)*dpr+8*dpr;
  ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='rgb(6,6,11)';ctx.fillRect(0,0,Wd,Hd);
  const m=buildSetting(spec.setting,spec.key),sc=S.table,cur=sc&&!sc.all&&sc.phase==='turn'?byId(sc.ids[sc.i]):null;
  drawSetting(ctx,{x:8*dpr,y:top,w:Wd-16*dpr,h:Math.max(40,Hd-top-bot)},m,{party:spec.members.filter(a=>a.state!=='dead'),cast:spec.cast.filter(live),speaker,cur,busy:!!sc&&sc.phase==='turn'},now,dpr);
  return true}
// Outdoor: the bar only (the world shows through); refreshed from draw.js each frame.
export function refreshOutdoor(){if(open&&spec&&spec.mode==='outdoor')refreshScene()}
