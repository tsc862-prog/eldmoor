// The crawl as it is played (#742, the render slice of #140's named positions): in the dungeon view's room in progress,
// each member and foe stands on the tile the sim gives it (#744), and every round plays back as beats.
//   crawlSpots(m, i, spec?)  the named spots of chamber i of interior m (sim/roomgrid.js roomSpots, #744)
//   crawlView(m, st, now)    once a frame: who stands where (walking toward their spot), the beats queued and playing,
//                            the damage pops; returns the frame's view
//   crawlLight(ctx, G, v)    the lit pool on the party and a dimmer one on the den, a flare where a blow lands (additive)
//   drawCrawl(ctx, m, v, now, dpr, sc, PS)  the foes at hero size with nameplates and HP bars, the party on its spots with
//                            names, the beats (lunge, hit flash, shake on a 20, a stumble on a 1, rings), the pops
//   crawlSummary(v)          the last round's summary line, for under the room once its beats have played
//   foeAt(m, st, wx, wy)     the foe under world-unit point (wx, wy) as the last frame drew it (the hover detail)
// Where everyone stands is the sim's (#744): cr.pos holds a tile of the room's grid per member and foe (sim/crawl.js), set on
//   entering the room and moved by the acts; the view walks each one to its tile. The spots, their names and which act goes
//   where live in sim/roomgrid.js.
// Read-only on the sim: st.party, st.crawl (the live crawl: foes, i), st.scene (its Table scene: ids, acts, beats, phase,
//   summary). Foe blows are not beats in a crawl (sim/crawl.js strikeBack), so they are read from the members' HP falling.
//   Nothing here touches the sim or its dice; the clock is the page's (`now`, seconds), so seeded hashes cannot move.
import {U as T} from './tile.js';
import {IT} from '../world/interior.js';
import {roomSpots,roomGrid,spotAt} from '../sim/roomgrid.js';
import {TABLE} from '../sim/table.js';
import {maxHp} from '../sim/heroes.js';
import {isDown} from '../sim/downed.js';
import {heroSprite,outlined} from './sprites.js';
import {foeSprite,foeKind} from './dgfoes.js';
import {classColor,DISP} from '../core/colors.js';
import {MARK,DUNGEON as D} from './palette.js';
import {drawConditions} from './conditions.js';

export {SPOT_IDS,ACT_SPOT,spotFor,roomSpots as crawlSpots} from '../sim/roomgrid.js'; // the spots moved to the sim with #744

// ---- the live view: positions, beats, pops (state kept here, reset when the crawl or the room changes) ----
const SPEED=3.4;          // tiles a second a member walks to its spot
const BEAT={strike:.8,blow:.7,save:.6,ring:.6,other:.45}; // seconds a beat plays at 1x
const HOLD_S=2.2;         // seconds the last round's summary stays on a room the party has just left
const POPS=24,pops=[];for(let k=0;k<POPS;k++)pops.push({on:false,x:0,y:0,txt:'',col:'',t0:0});
const heroes=new Map();   // id -> {x, y, tx, ty, hp, pend, moved, face, seen, placed, spot, down, flash, stumble}
const foes=[];            // per foe index: {x, y, tx, ty, hp, pend, drop, flash, shake, alive, placed}
const queue=[];           // beats to play: {k, id, res, n, foe, dmg, dur, t0, p, hit, crit, fumble, kill, tgt, popped}
const V={live:false,crawl:null,foes:null,scene:null,seen:0,room:-1,dkey:'',last:-1,summary:'',sumSc:null,sumAt:-1,spots:null,play:null,party:[],cold:true,enter:false};
const drawn=[]; // the foes' boxes as the last frame drew them, world units {f, x0, y0, x1, y1}
function pop(x,y,txt,col,now){let p=pops[0];for(const q of pops){if(!q.on){p=q;break}if(q.t0<p.t0)p=q}p.on=true;p.x=x;p.y=y;p.txt=txt;p.col=col;p.t0=now}
function reset(){heroes.clear();foes.length=0;queue.length=0;V.seen=0;V.summary='';V.sumSc=null;V.sumAt=-1;V.foes=null;V.scene=null;V.play=null;for(const p of pops)p.on=false}
const hero=a=>{let h=heroes.get(a.id);if(!h){h={x:0,y:0,tx:0,ty:0,hp:a.hp,pend:0,moved:-9,face:1,seen:false,placed:false,spot:null,down:false,flash:0,stumble:0};heroes.set(a.id,h)}return h};
const nameOf=f=>f.name||foeKind(f.type).name;
// The first foe standing (counting the blows still to be shown), as the sim strikes it (sim/crawl.js liveFoes(cr)[0]).
function frontFoe(){for(let k=0;k<foes.length;k++)if(foes[k].alive)return k;return -1}
const RING={ward:'#bfe8a8',heal:'#8ee0a0',potion:'#e07a9a',guard:'#e8c860',hold:'#e8c860'};
const beat=(k,id,dur)=>({k,id,res:'',n:0,foe:-1,dmg:0,dur,t0:-1,p:0,hit:false,crit:false,fumble:false,kill:false,tgt:null,popped:false});
// One beat from the scene (b: a beat of sc.beats), queued with what the view needs to show it.
function enqueue(b,party){const k=b.k,res=String(b.res||''),q=beat(k,b.id,BEAT.other);q.res=res;
  if(k==='strike'){q.dur=BEAT.strike;q.hit=/^(hit|struck down|a crushing blow)/.test(res);q.crit=/crushing/.test(res);q.fumble=/missed badly/.test(res);q.kill=/^struck down/.test(res)}
  else if(k==='save')q.dur=BEAT.save;
  else if(RING[k]){q.dur=BEAT.ring;const mt=/^\+(\d+) to (.+?)(?: \(|$)/.exec(res);if(mt){q.dmg=+mt[1];q.tgt=party.find(a=>a.name===mt[2])||null}}
  queue.push(q)}
// Foe HP that fell this frame goes to this frame's landed strikes, in order (a 20 takes two); what no strike explains is not held back.
function settleFoeHits(from){for(let i=from;i<queue.length;i++){const q=queue[i];if(q.k!=='strike'||!q.hit)continue;let want=q.crit?2:1;
    for(let k=0;k<foes.length&&want>0;k++){const F=foes[k];if(F.drop>0){const d=Math.min(F.drop,want);F.drop-=d;want-=d;q.n+=d;if(q.foe<0)q.foe=k}}
    if(q.foe<0)q.foe=frontFoe();if(!q.n)q.n=q.crit?2:1}
  for(const F of foes){if(F.drop>0)F.pend=Math.max(0,F.pend-F.drop);F.drop=0;if(F.hp<=0&&F.pend<=0)F.alive=false}
  for(let i=from;i<queue.length;i++){const q=queue[i];if(q.k==='strike'&&!q.hit&&q.foe<0)q.foe=frontFoe()}}
const pending=now=>queue.length>0||!!V.summary&&(V.sumAt<0||now-V.sumAt<HOLD_S);

// The frame's view of the live crawl. st: render/dungeonview.js stateOf (party, crawl, scene, cur, phase, dkey, roomSpec).
export function crawlView(m,st,now){const cr=st.crawl,on=!!(cr&&st.phase==='crawl'&&st.cur>=0&&st.party&&st.party.length&&m.rooms[st.cur]),gap=V.last<0?99:now-V.last;
  // the party has just left the room (won, fell back, or the run ended): stay on it until its last beats and summary have played
  const hold=V.live&&V.room>=0&&gap<.75&&st.dkey===V.dkey&&pending(now)&&(!on||st.cur!==V.room&&cr===V.crawl);
  if(!on&&!hold){V.live=false;V.last=now;return V}
  V.live=true;
  if(!hold&&(V.crawl!==cr||st.cur!==V.room||st.dkey!==V.dkey||gap>.75)){V.cold=gap>.75;V.enter=!V.cold;reset();V.crawl=cr;V.room=st.cur;V.dkey=st.dkey}
  const room=V.room,dt=Math.min(.1,Math.max(0,gap));V.last=now;
  const spots=V.spots=roomSpots(m,room,st.roomSpec);if(!spots){V.live=false;return V}
  if(!hold)V.party=st.party;const party=V.party,from=queue.length;
  if(!hold){
    // foes: a new set (a new room) starts at the den; HP that fell is held back for the strike that caused it
    const fl=cr.foes||null;
    if(fl&&fl!==V.foes){foes.length=0;V.foes=fl;for(let k=0;k<fl.length;k++)foes.push({x:0,y:0,tx:0,ty:0,hp:fl[k].hp,pend:0,drop:0,flash:0,shake:0,alive:fl[k].hp>0,placed:false})}
    if(fl)for(let k=0;k<fl.length&&k<foes.length;k++){const F=foes[k],hp=fl[k].hp;if(hp<F.hp&&!V.cold){F.drop+=F.hp-hp;F.pend+=F.hp-hp}F.hp=hp;if(hp>0)F.alive=true}
    // the scene: new beats join the queue (a view opened mid-scene, or after a gap, shows what stands without replaying it)
    const sc=st.scene&&st.scene.kind==='crawl'?st.scene:null;
    if(sc!==V.scene){V.scene=sc;V.seen=0}
    if(sc){if(V.cold)V.seen=sc.beats.length;for(;V.seen<sc.beats.length;V.seen++)enqueue(sc.beats[V.seen],party)}
    // the members' HP: a fall is a foe's blow (queued after this frame's acts), shown when it plays
    for(const a of party){const h=hero(a);if(V.cold||!h.seen){h.hp=a.hp;h.seen=true;continue}
      if(a.hp<h.hp-.5){const q=beat('blow',a.id,BEAT.blow);q.dmg=Math.round(h.hp-a.hp);q.hit=true;q.foe=frontFoe();queue.push(q);h.pend+=q.dmg}
      h.hp=a.hp}
    settleFoeHits(from);
    // the round's summary, shown once its beats have played
    if(sc&&sc.phase==='outcome'&&sc.summary&&V.sumSc!==sc){V.summary=sc.summary;V.sumSc=sc;V.sumAt=-1}
  }
  if(V.sumAt<0&&!queue.length&&V.summary)V.sumAt=now;
  // who stands where: the sim's tiles (a room just entered has none yet: the party at its way in, the foes at the den)
  const G=roomGrid(m,room,st.roomSpec),C=V.crawl,P=C&&C.pos&&C.posR===room?C.pos:null,feet=(p,o)=>{o.tx=G.ox+p.x+.5;o.ty=G.oy+p.y+.8};
  for(let k=0;k<foes.length;k++){const F=foes[k],p=P&&P['f'+k];if(p)feet(p,F);else{F.tx=spots.den.x;F.ty=spots.den.y}}
  for(const a of party){const h=hero(a),p=P&&P[a.id];h.down=isDown(a)&&!h.pend;if(p){feet(p,h);h.spot=spotAt(G,p.x,p.y)||'open'}else if(!h.placed){h.tx=spots.stair.x;h.ty=spots.stair.y;h.spot='stair'}}
  // walk: a view that has just opened puts everyone in place at once; a new room has the party come in by its way in
  for(const a of party){const h=hero(a);
    if(!h.placed){h.placed=true;if(V.enter){h.x=spots.stair.x;h.y=spots.stair.y}else{h.x=h.tx;h.y=h.ty}}
    if(h.down)continue;const dx=h.tx-h.x,dy=h.ty-h.y,d=Math.hypot(dx,dy),s=SPEED*dt;
    if(d>.02){if(d<=s){h.x=h.tx;h.y=h.ty}else{h.x+=dx/d*s;h.y+=dy/d*s}h.moved=now;if(Math.abs(dx)>.05)h.face=dx>0?1:-1}}
  for(const F of foes){if(!F.placed){F.placed=true;F.x=F.tx;F.y=F.ty}const dx=F.tx-F.x,dy=F.ty-F.y,d=Math.hypot(dx,dy),s=SPEED*.6*dt;if(d>.02){if(d<=s){F.x=F.tx;F.y=F.ty}else{F.x+=dx/d*s;F.y+=dy/d*s}}}
  V.cold=false;
  play(now,party);return V}

// ---- playing the beats ----
const pace=()=>TABLE.speed>=8?0:TABLE.speed>=3?.4:1; // at 3x the beats play fast; at 8x they are skipped
const WORD={guard:'on me',hold:'hold!',ward:'ward',scout:'a gap!',read:'wards turn',retreat:'fall back',stabilize:'bound',stunned:'stunned',attempt:'tries'};
const whoAt=(party,id)=>{for(const a of party)if(a.id===id)return a;return null};
// A beat's lasting part, once it lands (or is skipped): the HP bars show the blow.
function settle(q,party){if(q.settled)return;q.settled=true;
  if(q.k==='strike'&&q.foe>=0&&foes[q.foe]){const F=foes[q.foe];F.pend=Math.max(0,F.pend-q.n);if(F.hp<=0&&F.pend<=0)F.alive=false}
  if(q.k==='blow'){const a=whoAt(party,q.id);if(a){const h=hero(a);h.pend=Math.max(0,h.pend-q.dmg)}}}
function finish(q,party,now,show){if(show&&!q.popped)land(q,party,now);settle(q,party)}
function play(now,party){const f=pace();
  if(f===0){while(queue.length)finish(queue.shift(),party,now,false);V.play=null;return}
  const speed=queue.length>6?queue.length/6:1; // a backlog (a reflex round resolved at once) plays faster
  while(queue.length){const q=queue[0];if(q.t0<0)q.t0=now;
    q.p=Math.min(1,(now-q.t0)/(q.dur*f/speed));
    if(!q.popped&&(q.p>=.45||!(q.k==='strike'||q.k==='blow')))land(q,party,now);
    if(q.p<1){V.play=q;return}
    finish(q,party,now,true);queue.shift()}
  V.play=null}
// The moment a beat lands: the flash, the shake on a 20, the stumble on a 1, and its words floating up.
function land(q,party,now){q.popped=true;settle(q,party);const a=whoAt(party,q.id),h=a&&heroes.get(a.id);
  if(q.k==='strike'){const F=foes[q.foe];if(!F)return;
    if(q.hit){F.flash=now;if(q.crit)F.shake=now;pop(F.x,F.y-1.45,q.crit?'-'+q.n+'!':'-'+q.n,DISP.hostile.color,now);if(q.kill)pop(F.x+.1,F.y-2.05,'down','#e8e0c8',now)}
    else{pop(F.x,F.y-1.45,'miss','#b8b4c8',now);if(q.fumble&&h){h.stumble=now;pop(h.x,h.y-1.35,'a 1!','#e0b040',now)}}return}
  if(!h)return;
  if(q.k==='blow'){h.flash=now;pop(h.x,h.y-1.35,'-'+q.dmg,'#ff6a5a',now);return}
  if(q.k==='save'){const d=/d20 (\d+) vs DC (\d+)/.exec(q.res);if(d)pop(h.x,h.y-1.1,'save '+d[1],+d[1]>=+d[2]?'#8ee0a0':'#e0584a',now);return}
  if((q.k==='heal'||q.k==='potion')&&q.dmg){const t=q.tgt&&heroes.get(q.tgt.id);pop(t?t.x:h.x,(t?t.y:h.y)-1.35,'+'+q.dmg,'#8ee0a0',now);return}
  const t=WORD[q.k];if(t)pop(h.x,h.y-1.35,t,q.k==='retreat'||q.k==='stunned'||q.k==='attempt'?'#b8b4c8':RING[q.k]||'#9ad8f0',now)}

// ---- light ----
export function crawlLight(ctx,G,v=V){if(!v.live||!v.spots)return;let n=0,x=0,y=0;for(const h of heroes.values())if(h.placed){x+=h.x;y+=h.y;n++}
  if(n){x/=n;y/=n;ctx.globalAlpha=.8;ctx.drawImage(G.warm,x*T-64,(y-.4)*T-64,128,128)} // the party's torches go where they stand
  if(foes.length){const d=v.spots.den;ctx.globalAlpha=.55;ctx.drawImage(G.warm,d.x*T-44,(d.y-.4)*T-44,88,88)} // enough on the den to read the foes
  const q=v.play;if(q&&q.k==='strike'&&q.hit&&foes[q.foe]){const F=foes[q.foe],e=Math.max(0,1-Math.abs(q.p-.5)*4);if(e>0){ctx.globalAlpha=e*.8;ctx.drawImage(G.warm,F.x*T-26,(F.y-.5)*T-26,52,52)}}
  ctx.globalAlpha=1}

// ---- drawing ----
// A sprite filled with one colour (the hit flash), and one with a coloured outline (a foe's rim): cached per source canvas.
const tintCache=new WeakMap(),rimCache=new WeakMap();
function tinted(c,col){let m=tintCache.get(c);if(!m){m={};tintCache.set(c,m)}if(m[col])return m[col];
  const o=document.createElement('canvas');o.width=c.width;o.height=c.height;const x=o.getContext('2d');x.drawImage(c,0,0);x.globalCompositeOperation='source-in';x.fillStyle=col;x.fillRect(0,0,o.width,o.height);return m[col]=o}
function rimmed(c,col){let m=rimCache.get(c);if(!m){m={};rimCache.set(c,m)}if(m[col])return m[col];
  const w=c.width+2,h=c.height+2,o=document.createElement('canvas');o.width=w;o.height=h;const x=o.getContext('2d'),t=tinted(c,col);
  for(const [dx,dy] of [[0,1],[2,1],[1,0],[1,2]])x.drawImage(t,dx,dy);x.drawImage(c,1,1);return m[col]=o}
function label(ctx,t,x,y,col,css,dpr,sc){const s=css*dpr/sc;ctx.font=s+'px VT323, monospace';ctx.textAlign='center';ctx.fillStyle='#000';ctx.fillText(t,x+s*.08,y+s*.08);ctx.fillStyle=col;ctx.fillText(t,x,y)}
function bar(ctx,x,y,w,f,foe){ctx.fillStyle=MARK.edge;ctx.fillRect(x-1,y-1,w+2,4);ctx.fillStyle=foe?'#3a1418':'#142a1c';ctx.fillRect(x,y,w,2);
  ctx.fillStyle=foe?(f<1?'#e0584a':DISP.hostile.color):f<.35?'#e0584a':f<.65?'#e0b040':'#58c070';ctx.fillRect(x,y,f>0?Math.max(1,Math.round(w*f)):0,2)}
const FOE_RIM='#b0463c'; // a foe's outline: a dark red, so a dark creature reads on dark water and on dark stone
const ENT=[];for(let k=0;k<16;k++)ENT.push({y:0,a:null,k:-1});
const BAR_W=12; // a member's and a foe's HP bar, the same width (a boss's is wider)
export function drawCrawl(ctx,m,v,now,dpr,sc,PS){if(!v.live||!v.spots)return false;const party=v.party,fl=v.foes||[],q=v.play,close=T*sc/dpr>=10;
  let n=0;
  for(const a of party){const h=heroes.get(a.id);if(!h||!h.placed)continue;if(n<ENT.length){const e=ENT[n++];e.y=h.y-(h.down?.3:0);e.a=a;e.k=-1}}
  for(let k=0;k<foes.length&&k<fl.length;k++){if(n<ENT.length){const e=ENT[n++];e.y=foes[k].y-(fl[k].hp<=0&&foes[k].pend<=0?.5:0);e.a=null;e.k=k}}
  for(let i=1;i<n;i++){const e=ENT[i];let j=i;while(j>0&&ENT[j-1].y>e.y){ENT[j]=ENT[j-1];j--}ENT[j]=e} // back to front (insertion sort, no allocation)
  drawn.length=0;
  for(let i=0;i<n;i++){const e=ENT[i];if(e.a)drawHero(ctx,e.a,heroes.get(e.a.id),q,now,dpr,sc,PS,close,fl.length>0);else drawFoe(ctx,m,fl[e.k],foes[e.k],e.k,q,now,dpr,sc,PS,close,party)}
  for(const p of pops){if(!p.on)continue;const t=now-p.t0;if(t>1.1){p.on=false;continue}ctx.globalAlpha=Math.min(1,(1.1-t)*2.2);label(ctx,p.txt,p.x*T,(p.y-t*.8)*T,p.col,16,dpr,sc);ctx.globalAlpha=1}
  return true}
function lungeOf(q,id,h){if(!q||q.id!==id||q.k!=='strike'||!foes[q.foe])return 0;const F=foes[q.foe],e=Math.sin(Math.min(1,q.p/.8)*Math.PI);return e*Math.min(.65,Math.max(0,Math.hypot(F.x-h.x,F.y-h.y)-.75))}
function drawHero(ctx,a,h,q,now,dpr,sc,PS,close,fight){const down=h.down,walking=now-h.moved<.15,fr=walking?Math.floor(now*6)&1:0;
  const s=outlined(heroSprite(a,false,fr));let x=h.x,y=h.y;
  const lg=lungeOf(q,a.id,h);if(lg){const F=foes[q.foe],d=Math.hypot(F.x-h.x,F.y-h.y)||1;x+=(F.x-h.x)/d*lg;y+=(F.y-h.y)/d*lg}
  if(!walking&&foes.length&&V.spots)h.face=V.spots.den.x>=h.x-.05?1:-1;const face=h.face;
  const px=Math.round(x*T),py=Math.round(y*T),sw=Math.floor(s.width/2);
  ctx.fillStyle=MARK.shadow;ctx.beginPath();ctx.ellipse(px,py-1,down?8:6,1.8,0,0,7);ctx.fill();
  const stb=h.stumble&&now-h.stumble<.9?Math.sin(Math.min(1,(now-h.stumble)/.9)*Math.PI):0,fl=!down&&h.flash&&now-h.flash<.35;
  ctx.save();ctx.translate(px,py);
  if(down){ctx.rotate(-Math.PI/2*face);ctx.globalAlpha=.85;ctx.drawImage(s,-s.width+2,-sw)}
  else{if(stb)ctx.rotate(stb*.5*face);ctx.scale(face,1);ctx.drawImage(s,-sw,-s.height+Math.round(stb*2));
    if(fl){ctx.globalAlpha=.8*(1-(now-h.flash)/.35);ctx.drawImage(tinted(s,'#ff5a48'),-sw,-s.height)}}
  ctx.restore();ctx.globalAlpha=1;
  // a ring under the feet as a guard, a hold, a ward or a heal plays (the ward's spreads over the party)
  if(q&&q.id===a.id&&RING[q.k]){const p=q.p,rr=q.k==='ward'?.6+p*2.6:.5+p*.5;ring(ctx,px,py,rr,RING[q.k],1-p)}
  if(q&&q.tgt===a&&q.id!==a.id&&(q.k==='heal'||q.k==='potion'))ring(ctx,px,py,.5+q.p*.4,RING.heal,1-q.p);
  const top=down?py-9:py-s.height;
  if(fight){const mh=maxHp(a),f=mh>0?Math.max(0,Math.min(1,(a.hp+h.pend)/mh)):1;bar(ctx,px-BAR_W/2,top-2,BAR_W,f,false)}
  if(close)label(ctx,a.name+(down?' (down)':''),px,top-5,classColor(a.cls),13,dpr,sc);
  if(a.eff)drawConditions(ctx,null,PS,a,px,py,top-(close?17*dpr/sc:4),now)}
function ring(ctx,px,py,r,col,a){ctx.strokeStyle=col;ctx.globalAlpha=Math.max(0,a)*.9;ctx.lineWidth=1.2;ctx.beginPath();ctx.ellipse(px,py-1,r*T,r*T*.45,0,0,7);ctx.stroke();ctx.globalAlpha=1}
function drawFoe(ctx,m,f,F,k,q,now,dpr,sc,PS,close,party){if(!f)return;const dead=f.hp<=0&&F.pend<=0&&!(F.flash&&now-F.flash<.3),s0=foeSprite(f.type,(Math.floor(now*1.8)+k)&1);if(!s0)return;
  const scl=s0.height<11?1.5:1,o=dead?outlined(s0):rimmed(s0,FOE_RIM),w=o.width*scl,hgt=o.height*scl; // small creatures drawn half again as large: hero size
  let x=F.x,y=F.y;
  if(q&&q.k==='blow'&&q.foe===k){const a=whoAt(party,q.id),h=a&&heroes.get(a.id);if(h){const e=Math.sin(Math.min(1,q.p/.8)*Math.PI)*.55,d=Math.hypot(h.x-x,h.y-y)||1;x+=(h.x-x)/d*e;y+=(h.y-y)/d*e}}
  const sh=F.shake&&now-F.shake<.45?Math.round(Math.sin((now-F.shake)*70)*1.5):0;
  const px=Math.round(x*T)+sh,py=Math.round(y*T),ty=Math.floor(y-.3),tx=Math.floor(x),wet=tx>=0&&ty>=0&&tx<m.w&&ty<m.h&&m.tiles[ty*m.w+tx]===IT.WATER;
  if(!dead){ // a ring of hostile red on the ground, and ripples where it stands in water, so it is found at a glance
    ctx.strokeStyle=DISP.hostile.color;ctx.globalAlpha=.6;ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(px,py-1,w*.46,2.8,0,0,7);ctx.stroke();
    if(wet){ctx.strokeStyle='rgb('+D.water[0][0]+','+D.water[0][1]+','+D.water[0][2]+')';for(let r=0;r<2;r++){const t=(now*.7+r*.5)%1;ctx.globalAlpha=(1-t)*.7;ctx.beginPath();ctx.ellipse(px,py-1,w*.4+t*9,2+t*2.6,0,0,7);ctx.stroke()}}
    ctx.globalAlpha=1}
  ctx.fillStyle=MARK.shadow;ctx.beginPath();ctx.ellipse(px,py-1,w*.42,2,0,0,7);ctx.fill();
  const face=V.spots&&V.spots.stair.x<x-.05?1:-1; // foes face the way in, where the party comes from
  ctx.save();ctx.translate(px,py);ctx.scale(-face*scl,scl);
  if(dead){ctx.globalAlpha=.5;ctx.rotate(Math.PI/2);ctx.drawImage(o,-o.width*.5-1,-o.height*.5)} // a body for the room
  else{const lift=-o.height+(wet?1:0);ctx.drawImage(o,-Math.floor(o.width/2),lift);
    if(F.flash&&now-F.flash<.3){ctx.globalAlpha=1-(now-F.flash)/.3;ctx.drawImage(tinted(o,'#ffffff'),-Math.floor(o.width/2),lift)}}
  ctx.restore();ctx.globalAlpha=1;
  drawn.push({f,x0:px-w/2,y0:py-hgt-6,x1:px+w/2,y1:py+2});if(dead)return;
  const hits=Math.max(1,f.hits||f.hp),shown=Math.max(0,f.hp+F.pend),top=py-hgt,bw=f.boss?18:BAR_W;
  bar(ctx,px-bw/2,top-2,bw,Math.min(1,shown/hits),true);
  if(close)label(ctx,nameOf(f)+' · '+Math.min(hits,shown)+'/'+hits,px,top-5-(k&1?13*dpr/sc:0),DISP.hostile.color,12,dpr,sc);
  if(f.eff)drawConditions(ctx,null,PS,f,px,py,top-4,now)}

export function crawlSummary(v=V){return v.live&&v.summary&&v.sumAt>=0?v.summary:''}
export function foeAt(m,st,wx,wy){if(!V.live)return null;for(let k=drawn.length-1;k>=0;k--){const b=drawn[k];if(b.f.hp>0&&wx>=b.x0&&wx<=b.x1&&wy>=b.y0&&wy<=b.y1)return b.f}return null}
// For the checks: the spot each member is headed for ({id: spot}), the beats still to play, positions.
export function crawlPlacement(){const o={};for(const [id,h] of heroes)o[id]=h.spot;return o}
export const crawlQueue=()=>queue.map(q=>q.k);
export const crawlPos=id=>{const h=heroes.get(id);return h?{x:h.x,y:h.y,tx:h.tx,ty:h.ty}:null};
export const foePos=k=>foes[k]?{x:foes[k].x,y:foes[k].y,tx:foes[k].tx,ty:foes[k].ty}:null;
export const crawlRoom=()=>V.live?V.room:-1;
