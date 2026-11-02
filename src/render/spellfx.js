// Spell effects (#374): every class move in src/data/moves.js gets its own short animation, drawn in code
// (pixel glyphs and rects, no image files). The sim pushes one S.fx entry per use (sim/moves.js useMove):
//   {type:'spell', id, kind, x,y: the caster at the cast, ex,ey: the caster after it (Flicker Step moves),
//    r: the move's radius in tiles, pts: [x,y, ...] every one it touched (the foe, the friend, the foes or friends hit)}
// This module copies each new entry into its own pool and plays it in real time, so an effect reads the same at 1x,
// at 8x and in a paused Table round. A move with no effect of its own falls back to one for its kind.
// Two layers: ground (rings, roots, briars, shockwaves: under the entities, drawn before them) and air (projectiles,
// motes, glyphs: over the entities, after the night wash, so a spell carries its own light). Far zoom draws one
// cheap ring or dot per effect. No allocation per frame: the pool, the glyph canvases and the points are reused.
import {SPELL as P} from './palette.js';
import {sprite,outlined} from './sprites.js';

const T=16,MAX=48,NP=8,CH=6; // CH: chest height in world px above the feet
const TAU=Math.PI*2;
const POOL=[];
for(let i=0;i<MAX;i++)POOL.push({on:false,st:null,kind:'',x:0,y:0,ex:0,ey:0,tx:0,ty:0,r:0,pts:new Float32Array(NP*2),n:0,t0:0,dur:1,seed:0,dx:1,dy:0});
const seen=new WeakSet();
// freeze: a number in [0,1) holds every effect at that point of its life (screenshots); hold: keep finished effects.
export const spellDebug={freeze:null};
let c=null,PX=0,PY=0; // the context while drawing; at() writes a point here

// ---- drawing helpers (world px; the caller's transform scales them) ----
const rect=(x,y,w,h)=>c.fillRect(Math.round(x),Math.round(y),w,h);
const fill=col=>{c.fillStyle=col};
const alpha=a=>{c.globalAlpha=a<0?0:a>1?1:a};
const hash=(i,s)=>{const v=Math.sin(i*127.1+s*311.7)*43758.5453;return v-Math.floor(v)};
const ease=t=>{t=t<0?0:t>1?1:t;return 1-(1-t)*(1-t)};
const clip=t=>t<0?0:t>1?1:t;
const fade=(t,a=.7)=>t<a?1:1-(t-a)/(1-a);
// a point u of the way from the caster's chest to the target's, lifted by `arc` px at the middle
function at(e,u,arc){u=clip(u);PX=e.ex+(e.tx-e.ex)*u;PY=e.ey-CH+(e.ty-e.ey)*u-Math.sin(u*Math.PI)*arc}
// a projectile's fading trail: n older positions behind the head
function trail(e,u,arc,col,n,gap){for(let k=n;k>=1;k--){at(e,u-k*gap,arc);alpha(.75-k*.5/n);fill(col[k>n/2?2:1]);rect(PX-1,PY-1,2,2)}alpha(1)}
// sparks flying out of (x,y): n of them, v in [0,1] of the way, len px
function burst(x,y,col,v,n,len,seed){alpha(1-v);const r=2+ease(v)*len;
  for(let i=0;i<n;i++){const a=seed+i*TAU/n,cs=Math.cos(a),sn=Math.sin(a);fill(col[i&1]);rect(x+cs*r-1,y+sn*r-1,2,2);fill(col[0]);rect(x+cs*r*.55,y+sn*r*.55,1,1)}alpha(1)}
// a ring of n dots of size sz, squashed vertically by sq (ground rings lie flat)
function ring(x,y,r,n,sz,ph,sq){for(let i=0;i<n;i++){const a=ph+i*TAU/n;rect(x+Math.cos(a)*r-sz/2,y+Math.sin(a)*r*sq-sz/2,sz,sz)}}
// part of a ring from angle a0 to a1 (s of the way), thick: outer body and an inner highlight
function arc(x,y,r,a0,a1,s,col){const n=Math.max(4,Math.round(Math.abs(a1-a0)*r/1.5));
  for(let k=0;k<=n*s;k++){const a=a0+(a1-a0)*k/n,cs=Math.cos(a),sn=Math.sin(a);fill(col[1]);rect(x+cs*r-1,y+sn*r-1,2,2);fill(col[0]);rect(x+cs*(r-2),y+sn*(r-2),1,1)}}
function disc(x,y,r){r=Math.round(r);for(let j=-r;j<=r;j++){const w=Math.round(Math.sqrt(r*r-j*j));rect(x-w,y+j,w*2+1,1)}}
function line(x0,y0,x1,y1,sz){const n=Math.max(1,Math.ceil(Math.hypot(x1-x0,y1-y0)/sz));for(let i=0;i<=n;i++){const u=i/n;rect(x0+(x1-x0)*u-sz/2,y0+(y1-y0)*u-sz/2,sz,sz)}}
// a soft round glow behind a projectile head: two translucent squares
function halo(x,y,r,col){const a=c.globalAlpha;c.globalAlpha=a*.22;fill(col[1]);disc(x,y,r);c.globalAlpha=a*.3;disc(x,y,r-2);c.globalAlpha=a}
// a four-point twinkle of size s (1-3)
function twinkle(x,y,s,col){fill(col[1]);rect(x-s,y,s*2+1,1);rect(x,y-s,1,s*2+1);fill(col[0]);rect(x,y,1,1)}

// ---- glyphs: pixel strings, rendered once into cached canvases (outlined unless raw) ----
let gid=0;const G=(rows,pal,raw)=>({rows,pal,raw:!!raw,key:'sfx'+(gid++),cv:null});
function glyph(g,x,y,a=1){const s=g.cv||(g.cv=g.raw?sprite(g.key,g.rows,g.pal):outlined(sprite(g.key,g.rows,g.pal)));
  alpha(a);c.drawImage(s,Math.round(x-s.width/2),Math.round(y-s.height/2));alpha(1)}
const LEAF=G(["...lL","..lLL",".lLL.","LLd..","d...."],{l:P.leaf[0],L:P.leaf[1],d:P.leaf[2]});
const LEAF2=G(["Ll...","LLl..",".LLl.","..dLL","....d"],{l:P.leaf[0],L:P.leaf[1],d:P.leaf[2]});
const NOTE_ROWS=["..N..","..NN.","..N.N","..N..","NNN..","NN..."];
const NOTE=G(NOTE_ROWS,{N:P.song[1]}),NOTE_D=G(NOTE_ROWS,{N:P.dirge[1]}),NOTE_H=G(NOTE_ROWS,{N:P.hearth[1]});
const NOTE2=G(["..NNNN","..N..N","..N..N","NNN.NN","NN.NNN"],{N:P.song[1]});
const PLUS=G(["..L..","..L..","LLlLL","..L..","..L.."],{L:P.leaf[1],l:P.leaf[0]});
const CROSS=G([".W.","WHW",".H.",".H."],{W:P.holy[0],H:P.holy[1]});
const SHIELD=G([".SSSSS.","SHHWHHS","SHWWWHS","SHHWHHS","SHHHHHS",".SHHHS.","..SHS..","...S..."],{S:P.ward[2],H:P.ward[1],W:P.ward[0]});
const RUNE=G(["...W...","..WCW..",".WCDCW.","WCD.DCW",".WCDCW.","..WCW..","...W..."],{W:P.rune[0],C:P.rune[1],D:P.rune[2]},true);
const ANTLER=G(["A.A.....A.A",".A..A.A..A.",".AA.A.A.AA.","..AAA.AAA..","....AlA...."],{A:P.leaf[1],l:P.leaf[0]});
const HAMMER=G(["...W...","...W...","...W...","HhhhhhH","HhhhhhH","HHHHHHH"],{H:P.holy[1],h:P.holy[0],W:P.bark[1]});
const STAR=G(["..Y..","YYWYY",".YYY.",".Y.Y."],{Y:P.song[1],W:P.song[0]});
const BANG=G(["RR","RR","RR","RR","..","RR"],{R:P.shout[1]});

// ---- shared pieces ----
function each(e,f,t){for(let i=0;i<e.n;i++)f(e,e.pts[i*2],e.pts[i*2+1],t,i)}
function arrow(e,u,head,fl){at(e,u,1);const ux=e.dx,uy=e.dy;fill(P.bark[1]);line(PX-ux*8,PY-uy*8,PX-ux*2,PY-uy*2,1);
  fill(head);rect(PX-1,PY-1,2,2);fill(fl);rect(PX-ux*8-1,PY-uy*8-1,2,1)}
function sparkCloud(x,y,col,v,n,spread,seed,out){ // a cloud of motes gathering in (out=false) or flying apart
  alpha(1-v);for(let i=0;i<n;i++){const a=hash(i,seed)*TAU,d=(out?.3+v:1-v*.8)*spread*(.4+hash(i+9,seed)*.6);
    const px=x+Math.cos(a)*d,py=y+Math.sin(a)*d*.8-(out?v*4:0);if(i%5===0)twinkle(px,py,1,col);else{fill(col[i%3]);rect(px,py,i&1?1:2,i&1?1:2)}}alpha(1)}
function bolt(e,t,t1,col,arc){if(t<t1){const u=t/t1;trail(e,u,arc,col,4,.07);at(e,u,arc);halo(PX,PY,4,col);fill(col[0]);rect(PX-1.5,PY-1.5,3,3)}
  else burst(e.tx,e.ty-CH,col,(t-t1)/(1-t1),8,11,e.seed)}
// motes rising either side of the body (never over the face), swaying, fading as they climb
function rising(e,x,y,t,i,g,g2,n,h){for(let k=0;k<n;k++){const p=(t*1.1-k*.18-hash(k,e.seed+i)*.1);if(p<0||p>1)continue;
  const hs=hash(k,e.seed+i*3),sx=x+(k&1?1:-1)*(5+hs*5)+Math.sin(p*7+k)*2,sy=y-7-hs*4-p*h;glyph(k&1&&g2?g2:g,sx,sy,1-p*p)}}
function dome(x,y,t,col,r){alpha(.85*fade(t,.6));fill(col[1]);for(let i=0;i<14;i++){const a=Math.PI+i*Math.PI/13+Math.sin(t*9)*.05;if(((i+Math.floor(t*14))&3)===0)fill(col[0]);else fill(col[1]);rect(x+Math.cos(a)*r,y-CH+Math.sin(a)*r*1.1,1,1)}
  fill(col[2]);ring(x,y,r,14,1,t*2,.35);alpha(1)}
function stars(x,y,t,n){const a=fade(t,.75);for(let k=0;k<n;k++){const ang=t*7+k*TAU/n;glyph(STAR,x+Math.cos(ang)*7,y+Math.sin(ang)*2.5,a)}}
function notesAt(e,t,arcH,g,n){for(let k=0;k<n;k++){const u=(t/.55)-k*.14;if(u<0||u>1)continue;at(e,u,arcH+k*4);glyph(g,PX,PY+Math.sin(u*14)*1.5,1)}}
function spike(x,y,h,col){if(h<1)return;fill(col[2]);rect(x-1,y-h,3,h);fill(col[1]);rect(x,y-h-1,1,h);fill(col[0]);rect(x,y-h-2,1,1)}

// Per-target pieces (named, so a frame allocates no closures): (e, x, y feet in world px, t, index)
function chorusAt(e,x,y,t,i){rising(e,x,y,t,i,CROSS,PLUS,4,20)}
function cleaveAt(e,x,y,t){burst(x,y-CH,P.steel,(t-.25)/.75,6,8,e.seed)}
function frostAt(e,x,y,t){alpha(fade(t,.5));for(let k=0;k<5;k++){if((Math.floor(t*12)+k)%3)continue;twinkle(x-5+hash(k,e.seed)*10,y-12+hash(k+4,e.seed)*10,1,P.frost)}alpha(1)}
function cordAt(e,x,y,t){const s=ease(t/.35);fill(P.bark[1]);line(e.ex,e.ey,e.ex+(x-e.ex)*s,e.ey+(y-e.ey)*s,1);
  if(t>.3)for(let k=0;k<5;k++){const ang=k*TAU/5;spike(x+Math.cos(ang)*5,y+Math.sin(ang)*2,3*ease((t-.3)/.2),P.bark)}fill(P.song[1]);rect(x-1,y-1,2,2)}
function rallyAt(e,x,y,t,i){rising(e,x,y,t,i,NOTE,NOTE2,4,22)}
function lullAt(e,x,y,t,i){rising(e,x,y,t*.9,i,NOTE_H,null,3,18);if((Math.floor(t*8)+i)&1)twinkle(x+5,y-13-t*6,1,P.hearth)}
function mendAt(e,x,y,t,i){rising(e,x,y,t,i,LEAF,LEAF2,6,22);for(let k=0;k<4;k++){const p=(t*1.3-k*.2)%1;if(p<0)continue;alpha(1-p);fill(P.leaf[0]);rect(x-6+hash(k,e.seed)*12,y-2-p*16,1,1)}alpha(1)}
function antlerAt(e,x,y,t,i){const a=fade(t,.65)*(.75+.25*Math.sin(t*20+i));glyph(ANTLER,x,y-14-ease(t/.3)*2,a);dome(x,y,t,P.leaf,8)}
function healAt(e,x,y,t,i){rising(e,x,y,t,i,PLUS,null,4,18)}
function stunAt(e,x,y,t){stars(x,y-15,t,3)}
function wardAt(e,x,y,t){dome(x,y,t,P.ward,9)}
function buffAt(e,x,y,t,i){for(let k=0;k<5;k++)if((Math.floor(t*12)+k+i)&1)twinkle(x-6+hash(k,e.seed)*12,y-4-hash(k+5,e.seed)*12-t*6,1,P.song)}
// Ice shards round the foe (Winter's Hold), split into behind (ground layer) and in front (air layer).
function shards(e,t,back){const h=ease(t/.35)*(t>.8?(1-t)/.2:1);alpha(fade(t,.8));
  for(let k=0;k<6;k++){const ang=k*TAU/6+.3;if((Math.sin(ang)<0)!==back)continue;spike(e.tx+Math.cos(ang)*6,e.ty+Math.sin(ang)*2.5,(5+hash(k,e.seed)*6)*h,P.frost)}alpha(1)}

// ---- one effect per move id: {d: seconds, g(e,t): ground layer, a(e,t): air layer}; t runs 0..1 ----
const FX={
  // Warrior
  challenge:{d:.9,a(e,t){const ang=Math.atan2(e.ty-e.ey,e.tx-e.ex);fill(P.shout[1]);
      for(let k=0;k<3;k++){const p=(t*2+k/3)%1,r=4+p*18;alpha((1-p)*fade(t,.6));arc(e.ex,e.ey-CH,r,ang-.6,ang+.6,1,P.shout)}
      alpha(1);if(t>.15)glyph(BANG,e.tx,e.ty-18-Math.abs(Math.sin(t*12))*2,fade(t,.7))}},
  bastion:{d:1,g(e,t){alpha(1-t);fill(P.steel[2]);ring(e.ex,e.ey,4+ease(t*1.6)*12,16,2,0,.5);alpha(1)},
    a(e,t){const drop=(1-ease(t/.2))*10,x=e.ex+e.dx*5,y=e.ey-CH-drop;glyph(SHIELD,x,y,fade(t,.65));
      if(t>.2&&t<.7){const k=Math.floor(t*20)&3;twinkle(x-3+k*2,y-3+k,1,P.ward)}}},
  recklessblow:{d:.6,a(e,t){const x=e.tx,y=e.ty-CH;alpha(fade(t,.4));arc(x,y,9,-2.4,.7,ease(t/.25),P.shout);alpha(1);
      if(t>.2)burst(x,y,P.shout,(t-.2)/.8,10,13,e.seed)}},
  wardencover:{d:1.1,a(e,t){if(t<.35){at(e,t/.35,8);glyph(SHIELD,PX,PY,1)}else{dome(e.tx,e.ty,(t-.35)/.65,P.ward,9);glyph(SHIELD,e.tx+5,e.ty-CH,fade(t,.6)*.9)}}},
  reavercleave:{d:.7,a(e,t){const x=e.ex,y=e.ey-CH+1,s=ease(t/.35);alpha(fade(t,.45));arc(x,y,13,-Math.PI*1.05,Math.PI*.55,s,P.steel);arc(x,y,10,-Math.PI*.9,Math.PI*.4,s,P.steel);alpha(1);
      if(t>.25)each(e,cleaveAt,t)}},
  // Mage
  runelance:{d:.75,a(e,t){if(t<.4){const u=t/.4;trail(e,u,4,P.rune,5,.06);at(e,u,4);halo(PX,PY,6,P.rune);glyph(RUNE,PX,PY)}
      else{const v=(t-.4)/.6;burst(e.tx,e.ty-CH,P.rune,v,8,12,e.seed);glyph(RUNE,e.tx,e.ty-CH-v*6,1-v)}}},
  twinlance:{d:.8,a(e,t){if(t<.42){const u=t/.42;trail(e,u,9,P.rune,4,.06);trail(e,u,-5,P.arcane,4,.06);at(e,u,9);halo(PX,PY,5,P.rune);glyph(RUNE,PX,PY);at(e,u,-5);halo(PX,PY,5,P.arcane);glyph(RUNE,PX,PY)}
      else{const v=(t-.42)/.58;burst(e.tx,e.ty-CH,P.rune,v,10,14,e.seed);burst(e.tx,e.ty-CH,P.arcane,v,6,8,e.seed+.3)}}},
  rimering:{d:1,g(e,t){const R=Math.min(e.r*T,56)*ease(t/.45),a=fade(t,.5);alpha(a*.5);fill(P.frost[1]);ring(e.ex,e.ey,R,28,1,0,.55);alpha(a);
      for(let i=0;i<18;i++){const ang=i*TAU/18+e.seed;spike(e.ex+Math.cos(ang)*R,e.ey+Math.sin(ang)*R*.55,(2+hash(i,e.seed)*4)*(t<.45?t/.45:1),P.frost)}alpha(1)},
    a(e,t){each(e,frostAt,t)}},
  winterhold:{d:1.3,g(e,t){alpha(.45*fade(t,.7));fill(P.frost[1]);ring(e.tx,e.ty,7,16,2,0,.4);alpha(1);shards(e,t,true)},
    a(e,t){shards(e,t,false);alpha(fade(t,.8));
      if(t>.3)for(let k=0;k<6;k++)if((Math.floor(t*10)+k)&1)twinkle(e.tx-7+hash(k,e.seed+1)*14,e.ty-14+hash(k,e.seed+2)*10,1,P.frost);alpha(1)}},
  flicker:{d:.9,a(e,t){sparkCloud(e.x,e.y-CH,P.arcane,clip(t/.6),14,10,e.seed,false);if(t>.1)sparkCloud(e.ex,e.ey-CH,P.arcane,clip((t-.1)/.8),14,12,e.seed+1,true);
      if(t<.4){alpha(.35*(1-t/.4));fill(P.arcane[1]);line(e.x,e.y-CH,e.ex,e.ey-CH,1);alpha(1)}}},
  // Hunter
  deadeye:{d:.6,a(e,t){if(t<.15)twinkle(e.ex+e.dx*4,e.ey-CH-1,1+Math.round(t/.05)%3,P.steel);
      if(t>=.1&&t<.35)arrow(e,(t-.1)/.25,P.steel[0],P.steel[1]);if(t>=.33)burst(e.tx,e.ty-CH,P.steel,(t-.33)/.67,6,8,e.seed)}},
  heartseeker:{d:.75,a(e,t){if(t<.15)twinkle(e.ex+e.dx*4,e.ey-CH-1,2,P.blood);
      if(t>=.1&&t<.35){const u=(t-.1)/.25;trail(e,u,1,P.blood,5,.05);arrow(e,u,P.blood[0],P.blood[1])}
      if(t>=.33){const v=(t-.33)/.67;burst(e.tx,e.ty-CH,P.blood,v,10,13,e.seed);alpha(1-v);fill(P.blood[1]);ring(e.tx,e.ty-CH,3+v*8,12,1,0,1);alpha(1)}}},
  snare:{d:1.1,g(e,t){const r=12-ease(t/.4)*7,a=fade(t,.75);alpha(a);fill(P.bark[1]);ring(e.tx,e.ty,r,18,2,t*2,.45);fill(P.song[1]);ring(e.tx,e.ty,r,6,2,t*2+.2,.45);
      if(t>.35){fill(P.leaf[2]);for(let k=0;k<6;k++){const ang=k*TAU/6+t*2;rect(e.tx+Math.cos(ang)*r,e.ty+Math.sin(ang)*r*.45-2,1,2)}}alpha(1)}},
  quarrymark:{d:1.1,a(e,t){const d=14-ease(t/.4)*7,x=e.tx,y=e.ty-CH,a=fade(t,.7);alpha(a);fill(P.mark[1]);
      for(let sx=-1;sx<=1;sx+=2)for(let sy=-1;sy<=1;sy+=2){rect(x+sx*d-(sx<0?0:2),y+sy*d-(sy<0?0:1),3,1);rect(x+sx*d-(sx<0?0:0),y+sy*d-(sy<0?0:2),1,3)}
      if(t>.35&&(Math.floor(t*12)&1)){fill(P.mark[0]);rect(x-1,y-1,2,2)}alpha(1)}},
  thornfield:{g(e,t){const a=fade(t,.65);alpha(a*.6);fill(P.bark[2]);ring(e.ex,e.ey,Math.min(e.r*T,56)*ease(t/.4),24,1,0,.55);alpha(a);
      each(e,cordAt,t);alpha(1)},d:1.1},
  // Priest
  dawnward:{d:1.1,g(e,t){alpha(fade(t,.6)*.9);fill(P.holy[1]);ring(e.tx,e.ty,7+Math.sin(t*12),16,1,t,.4);alpha(1)},
    a(e,t){const len=ease(t/.3)*44,top=e.ty-46,a=fade(t,.5);alpha(a*.45);fill(P.holy[1]);rect(e.tx-3,top,7,len);alpha(a*.9);fill(P.holy[0]);rect(e.tx-1,top,3,len);alpha(1);
      if(t>.3)for(let k=0;k<4;k++)if((Math.floor(t*12)+k)&1)twinkle(e.tx-6+k*4,e.ty-4-hash(k,e.seed)*12,1,P.holy)}},
  searingword:{d:.7,a(e,t){if(t<.22){const u=t/.22;trail(e,u,2,P.holy,4,.08);at(e,u,2);halo(PX,PY,4,P.holy);fill(P.holy[0]);rect(PX-1,PY-1,3,3);return}
      const v=(t-.22)/.78,x=e.tx,y=e.ty-CH;alpha(1-v);fill(P.holy[1]);for(let k=0;k<8;k++){const a=k*TAU/8,r0=3+v*4,r1=r0+4+v*6;line(x+Math.cos(a)*r0,y+Math.sin(a)*r0,x+Math.cos(a)*r1,y+Math.sin(a)*r1,1)}
      fill(P.holy[0]);disc(x,y,Math.max(0,3-v*3));alpha(1)}},
  chorus:{d:1.3,g(e,t){alpha(fade(t,.5)*.7);fill(P.holy[1]);ring(e.ex,e.ey,Math.min(e.r*T,64)*ease(t/.5),32,1,0,.55);alpha(1)},
    a(e,t){each(e,chorusAt,t)}},
  dawnbrand:{d:.9,g(e,t){if(t<.3)return;const v=(t-.3)/.7;alpha(1-v);fill(P.holy[1]);ring(e.tx,e.ty,3+ease(v)*16,20,2,0,.5);fill(P.holy[0]);ring(e.tx,e.ty,2+ease(v)*10,14,1,.2,.5);alpha(1)},
    a(e,t){if(t<.3){glyph(HAMMER,e.tx,e.ty-30+ease(t/.3)*14,1)}else{const v=(t-.3)/.7;glyph(HAMMER,e.tx,e.ty-16,1-v*2);burst(e.tx,e.ty-CH,P.holy,v,10,12,e.seed)}}},
  mendingtouch:{d:1.2,a(e,t){if(t<.25){alpha(1-t/.25);fill(P.holy[1]);const u=t/.25;at(e,u,4);rect(PX-1,PY-1,2,2);alpha(1)}
      const x=e.tx,y=e.ty;for(let k=0;k<9;k++){const ph=(t*1.4-hash(k,e.seed)*.5);if(ph<0||ph>1)continue;const s=ph<.5?1+Math.round(ph*4):3-Math.round((ph-.5)*4);
        alpha(1-ph*.6);twinkle(x-8+hash(k+3,e.seed)*16,y-2-hash(k+7,e.seed)*12-ph*8,Math.max(1,s),P.holy)}alpha(1)}},
  // Rogue
  ambush:{d:.7,a(e,t){const x=e.tx,y=e.ty-CH,a=fade(t,.55);alpha(a);const s1=ease(t/.15),s2=ease((t-.12)/.15);
      fill(P.shadow[2]);line(x-7,y-7,x-7+14*s1,y-7+14*s1,2);if(s2>0)line(x+7,y-7,x+7-14*s2,y-7+14*s2,2);
      fill(P.shadow[0]);line(x-6,y-7,x-6+12*s1,y-7+12*s1,1);if(s2>0)line(x+6,y-7,x+6-12*s2,y-7+12*s2,1);alpha(1);
      if(t>.25)burst(x,y,P.shadow,(t-.25)/.75,8,11,e.seed)}},
  sinewcut:{d:.8,a(e,t){const x=e.tx,y=e.ty-2,s=ease(t/.18);alpha(fade(t,.4));fill(P.steel[0]);line(x-7,y-1,x-7+14*s,y+1*s,1);alpha(1);
      if(t>.15){fill(P.blood[1]);for(let k=0;k<4;k++){const v=t-.15-k*.05;if(v<0)continue;alpha(1-v);rect(x-4+k*3,y+v*6,1,2)}alpha(1)}}},
  smokeveil:{d:1.3,a(e,t){for(let k=0;k<8;k++){const ang=hash(k,e.seed)*TAU,v=clip(t*1.2-hash(k+5,e.seed)*.2),d=3+v*9,r=2+v*4;
      const x=e.ex+Math.cos(ang)*d,y=e.ey-4+Math.sin(ang)*d*.5-v*6;alpha((1-v)*.8);fill(P.smoke[2]);disc(x,y+1,r);fill(P.smoke[k&1]);disc(x,y,r-1)}alpha(1)}},
  backstab:{d:.6,a(e,t){const x=e.tx,y=e.ty-CH,s=ease(t/.12);alpha(fade(t,.35));fill(P.steel[0]);line(x+6,y-8,x+6-12*s,y-8+14*s,1);fill(P.steel[1]);line(x+7,y-8,x+7-12*s,y-8+14*s,1);alpha(1);
      if(t<.2)twinkle(x+6-12*s,y-8+14*s,2,P.steel);if(t>.12)burst(x,y,P.blood,(t-.12)/.88,7,10,e.seed)}},
  dirtytrick:{d:1.1,a(e,t){if(t<.45){for(let k=0;k<14;k++){const sp=.7+hash(k,e.seed)*.5,u=t/.4*sp;if(u>1)continue;at(e,u,2);
        const j=(hash(k+20,e.seed)-.5)*8*u;alpha(1-u*.5);fill(P.sand[k%3]);rect(PX-e.dy*j,PY+e.dx*j,1,1)}alpha(1)}
      if(t>.3)stars(e.tx,e.ty-15,(t-.3)/.7,3)}},
  // Skald
  bitingverse:{d:.85,a(e,t){notesAt(e,t,8,NOTE,3);if(t>.5){const v=(t-.5)/.5;burst(e.tx,e.ty-CH,P.song,v,8,10,e.seed);alpha(1-v);fill(P.song[1]);
      for(let k=0;k<4;k++){const a=k*TAU/4+.4;rect(e.tx+Math.cos(a)*(4+v*6),e.ty-CH+Math.sin(a)*(4+v*6),3,1)}alpha(1)}}},
  rallyverse:{d:1.3,g(e,t){alpha(fade(t,.5)*.8);fill(P.song[1]);ring(e.ex,e.ey,Math.min(e.r*T,64)*ease(t/.5),28,2,0,.55);alpha(1)},
    a(e,t){each(e,rallyAt,t)}},
  dirge:{d:1.4,a(e,t){const x=e.tx,y=e.ty;for(let k=0;k<4;k++){const ang=t*3+k*TAU/4,r=11*(1-t*.5);glyph(NOTE_D,x+Math.cos(ang)*r,y-24+t*14+Math.sin(ang)*3,fade(t,.7)*(Math.sin(ang)<-.2?.6:1))}
      alpha(.5*fade(t,.6));fill(P.dirge[2]);ring(x,y,6+Math.sin(t*6),14,1,t,.4);alpha(1)}},
  roaringchant:{d:1.1,g(e,t){const R=Math.min(e.r*T,52);for(let k=0;k<3;k++){const v=clip(t*1.5-k*.2);if(v<=0||v>=1)continue;alpha(1-v);fill(P.song[k?1:0]);ring(e.ex,e.ey,4+v*R,24+k*4,2,k*.3,.55)}alpha(1)},
    a(e,t){for(let k=0;k<6;k++){const ang=k*TAU/6+e.seed,v=clip(t*1.3);glyph(k&1?NOTE2:NOTE,e.ex+Math.cos(ang)*(4+v*22),e.ey-CH-2+Math.sin(ang)*(4+v*22)*.6-v*4,1-v)}}},
  lullaby:{d:1.5,g(e,t){alpha(fade(t,.5)*.6);fill(P.hearth[1]);ring(e.ex,e.ey,Math.min(e.r*T,64)*ease(t/.6),28,1,t,.55);alpha(1)},
    a(e,t){each(e,lullAt,t)}},
  // Wildspeaker
  briarlash:{d:.85,a(e,t){const s=t<.3?ease(t/.3):t<.55?1:1-ease((t-.55)/.3);if(s>0){const n=Math.ceil(Math.hypot(e.tx-e.ex,e.ty-e.ey)/2)+1;
      for(let k=0;k<=n*s;k++){const u=k/n,w=Math.sin(u*12+t*20)*2.5*Math.sin(u*Math.PI);at(e,u,3);const x=PX-e.dy*w,y=PY+e.dx*w;fill(P.leaf[1]);rect(x-1,y-1,2,2);
        if(k%4===2){fill(P.bark[2]);rect(x-e.dy*2,y+e.dx*2-1,1,2);rect(x+e.dy*2,y-e.dx*2,1,2)}}}
      if(t>.28&&t<.8)burst(e.tx,e.ty-CH,P.leaf,(t-.28)/.52,7,9,e.seed)}},
  greenmend:{d:1.3,a(e,t){each(e,mendAt,t)}},
  rootbind:{d:1.4,g(e,t){roots(e,t,true)},a(e,t){roots(e,t,false)}},
  thornring:{d:1.1,g(e,t){const R=Math.min(e.r*T,52)*ease(t/.3),hm=t<.3?t/.3:t>.75?(1-t)/.25:1;alpha(fade(t,.8));fill(P.bark[2]);ring(e.ex,e.ey,R,32,1,0,.55);
      for(let i=0;i<20;i++){const ang=i*TAU/20+e.seed;spike(e.ex+Math.cos(ang)*R,e.ey+Math.sin(ang)*R*.55,(3+hash(i,e.seed)*5)*hm,i%3?P.bark:P.leaf)}alpha(1)}},
  antlerward:{d:1.4,g(e,t){alpha(fade(t,.5)*.7);fill(P.leaf[1]);ring(e.ex,e.ey,Math.min(e.r*T,64)*ease(t/.5),28,1,0,.55);alpha(1)},
    a(e,t){each(e,antlerAt,t)}},
};
// Roots rising round the foe's feet and curling in; the ones behind it are drawn on the ground layer, the ones in front over it.
function roots(e,t,back){const h=ease(t/.4)*(t>.8?(1-t)/.2:1)*12,a=fade(t,.85);alpha(a);
  for(let k=0;k<6;k++){const ang=k*TAU/6+.4,behind=Math.sin(ang)<0;if(behind!==back)continue;const bx=e.tx+Math.cos(ang)*8,by=e.ty+Math.sin(ang)*3,hk=h*(.7+hash(k,e.seed)*.4);
    for(let v=0;v<hk;v+=1){const q=v/12;fill(v>hk-2?P.leaf[1]:P.bark[q<.5?2:1]);rect(bx-Math.cos(ang)*q*q*7,by-v,2,1)}}
  if(!back&&t>.35){fill(P.bark[2]);ring(e.tx,e.ty,8,10,2,.4,.38)}alpha(1)}

// Kind fallbacks for a move with no entry above (a new row in moves.js shows something at once).
const KIND={
  attack:{d:.7,a(e,t){bolt(e,t,.35,P.shout,4)}},
  heal:{d:1.2,a(e,t){each(e,healAt,t)}},
  control:{d:1.1,a(e,t){each(e,stunAt,t)}},
  defend:{d:1.1,a(e,t){each(e,wardAt,t)}},
  move:FX.flicker,
  buff:{d:1.1,a(e,t){each(e,buffAt,t)}},
};
const FAR={attack:P.shout,heal:P.leaf,control:P.rune,defend:P.ward,move:P.arcane,buff:P.song};
// The style used for a move id (its own, else its kind's, else the attack one). Exported for checks.
export const spellStyle=(id,kind)=>FX[id]||KIND[kind]||KIND.attack;
export const SPELL_IDS=Object.keys(FX);

// Copy new S.fx spell entries into the pool (real-time clock `now`, seconds); one cast out of view is skipped for good.
export function syncSpells(fx,now,inView){for(let i=0;i<fx.length;i++){const p=fx[i];if(p.type!=='spell'||seen.has(p))continue;seen.add(p);
  if(inView&&!inView(p.ex*T,p.ey*T,160))continue;
  let e=null;for(let k=0;k<MAX;k++)if(!POOL[k].on){e=POOL[k];break}if(!e)return;
  const st=spellStyle(p.id,p.kind);e.on=true;e.st=st;e.kind=p.kind;e.t0=now;e.dur=st.d||1;
  e.x=p.x*T;e.y=p.y*T;e.ex=p.ex*T;e.ey=p.ey*T;e.r=p.r||0;const pts=p.pts||[];e.n=Math.min(NP,pts.length>>1);
  for(let k=0;k<e.n*2;k++)e.pts[k]=pts[k]*T;
  e.tx=e.n?e.pts[0]:e.ex;e.ty=e.n?e.pts[1]:e.ey;const dx=e.tx-e.ex,dy=e.ty-e.ey,L=Math.hypot(dx,dy);e.dx=L?dx/L:1;e.dy=L?dy/L:0;
  e.seed=((p.x*7.31+p.y*3.17)%1+1)%1*TAU}}

// Draw one layer (0 ground, 1 air) of every live effect. close: the camera is close enough for detail.
export function drawSpells(ctx,layer,close,inView,now){c=ctx;
  for(let i=0;i<MAX;i++){const e=POOL[i];if(!e.on)continue;let t=(now-e.t0)/e.dur;if(spellDebug.freeze!=null)t=spellDebug.freeze;else if(t>=1){e.on=false;continue}
    if(!inView(e.ex,e.ey,120)&&!inView(e.tx,e.ty,120))continue;
    if(!close){if(layer!==1)continue; // far: one ring, or a dot in flight
      const col=FAR[e.kind]||P.shout;alpha(1-t);fill(col[1]);
      if(e.kind==='attack'&&e.n&&t<.4){at(e,t/.4,0);rect(PX-2,PY-2,4,4)}else ring(e.tx,e.ty-CH,4+t*14,10,3,0,1);alpha(1);continue}
    const f=layer?e.st.a:e.st.g;if(f)f(e,t)}
  ctx.globalAlpha=1;c=null}
