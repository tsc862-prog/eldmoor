// Road traffic on the map (#856, sim/traffic.js #796): carts, travellers and road and bridge guards, drawn in the y-sorted
// entity list of draw.js. Render only: reads S.traffic, writes nothing to it. Style: the travellers and guards are the town
// NPC sprites (npcSprite, the same roles and faction colours as the townsfolk) and the cart is drawn here at the art's
// resolution, a figure's scale. When generated townsfolk sheets exist for these roles they can replace the
// figures here (sheetFigure below, #896). Skipped at far zoom by draw.js (`close`). No per-frame allocation:
// entities are the sim's own objects, every canvas is cached by [role][faction][frame] or [load][frame].
import {CITY} from '../world/map.js';
import {npcSprite,worldSprite,sheetFrame} from './sprites.js';
import {racesOf} from '../data/races.js';
import {U,ART} from './tile.js';
import {onWorld} from '../sim/kept.js';

const TRAVEL_ROLE={pedlar:'peddler',pilgrim:'hermit',tinker:'peddler',drover:'drover','road courier':'sellsword','wandering minstrel':'minstrel'};
const LOAD={salt:'#e8e4da',grain:'#d8b050',ale:'#8a5a30',timber:'#a07848',wool:'#ece4d0',hide:'#7a5030',pelt:'#8a8a96',silk:'#a060c8',moss:'#5a8a48'};
const STEP=[1,0,2,0],sp={kind:'npc',role:'',fac:0,race:''}; // STEP: sheet columns of a walk cycle (as draw.js)
const figs=new Map(),carts=new Map(),facOf=new Map(),probe={role:'',fac:0};
onWorld(()=>facOf.clear()); // another map (#1013): other towns

function townFac(name){let f=facOf.get(name);if(f===undefined){f=0;for(const c of CITY)if(c.name===name){f=c.fac||0;break}facOf.set(name,f)}return f}
function figure(role,fac,fr){let per=figs.get(role);if(!per)figs.set(role,per=[]);
  let a=per[fac];if(!a)a=per[fac]=[null,null];
  if(!a[fr]){probe.role=role;probe.fac=fac;a[fr]=worldSprite(npcSprite(probe,fr))}return a[fr]}
// A cart at the art's own resolution (a figure's scale, facing right): a sheeted load, a plank bed on two spoked wheels, the draught pole. Drawn once per load and wheel turn.
const CW=62,CH_=44,RIM='#241c18',hexRgb=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
function drawCart(word,fr){const px=new Array(CW*CH_).fill(null),put=(x,y,c)=>{x|=0;y|=0;if(x>=0&&y>=0&&x<CW&&y<CH_)px[y*CW+x]=c},L=hexRgb(LOAD[word]||'#b89050'),tone=k=>'rgb('+L.map(v=>Math.max(0,Math.min(255,Math.round(v*k)))).join(',')+')';
  // the load: three heaped sacks or bales under a rope, lit from the top left
  for(const [cx,cy,rx,ry] of [[17,12,12,9],[43,12,12,9],[30,9,14,8]])for(let y=-ry;y<=ry;y++)for(let x=-rx;x<=rx;x++){const d=Math.hypot(x/rx,y/ry);if(d>1)continue;put(cx+x,cy+y,tone(1.12-(x/rx+y/ry)*.22-(d>.86?.2:0)))}
  for(let x=6;x<56;x++)put(x,14+((x>>3)&1),tone(.55));for(const x of [14,30,46])for(let y=4;y<22;y++)put(x+((y>>2)&1),y,tone(.6));
  // the bed: planks, a dark underside, stakes at the corners
  for(let y=19;y<31;y++)for(let x=3;x<57;x++)put(x,y,y===19?'#c09058':(y-19)%4===3?'#5a3a22':x>50?'#70482a':(((x*7+((y-19)>>2)*13)%29)<2?'#6e4828':'#94643a'));
  for(let x=3;x<57;x++){put(x,31,'#3a2616');put(x,32,'#3a2616')}
  for(const x of [5,29,53])for(let y=15;y<31;y++){put(x,y,'#7a5230');put(x+1,y,'#5a3a22')}
  for(let x=56;x<CW;x++){put(x,24,'#8a6036');put(x,25,'#5a3a22')}
  // the wheels, turned a little between frames
  for(const cx of [15,44]){const cy=33,R=10;for(let y=-R;y<=R;y++)for(let x=-R;x<=R;x++){const d=Math.hypot(x,y);if(d>R+.2)continue;if(d>8.6)put(cx+x,cy+y,x+y<0?'#9a7a52':'#6e5236');else if(d<2.2)put(cx+x,cy+y,d<1.1?'#2a2018':'#9a7a52')}
    for(let k=0;k<6;k++){const a=k*Math.PI/3+fr*Math.PI/6;for(let r=2;r<9;r+=.5)put(cx+Math.cos(a)*r,cy+Math.sin(a)*r,'#8a6a46')}}
  const cv=document.createElement('canvas');cv.width=CW+2;cv.height=CH_+2;const x=cv.getContext('2d');
  for(let j=0;j<CH_;j++)for(let i=0;i<CW;i++){if(!px[j*CW+i])continue;x.fillStyle=RIM;x.fillRect(i,j+1,3,1);x.fillRect(i+1,j,1,3)}
  for(let j=0;j<CH_;j++)for(let i=0;i<CW;i++){const c=px[j*CW+i];if(!c)continue;x.fillStyle=c;x.fillRect(i+1,j+1,1,1)}
  return cv}
function cart(word,fr){let a=carts.get(word);if(!a)carts.set(word,a=[null,null]);if(!a[fr])a[fr]=drawCart(word,fr);return a[fr]}

// The townsfolk sheet of a role (LPC, #854) when the index has one for this people, drawn like draw.js draws a townsperson:
// returns true when it drew. A walker has no people of its own, so it takes one of its faction's by its number (or its town's faction).
function sheetFigure(ctx,role,fac,n,e,px,py,blink){
  const rs=racesOf(fac);sp.role=role;sp.fac=fac;sp.race=rs.length?rs[n%rs.length].id:'';
  const dir=e.moving?(e.face<0?1:2):0,G=sheetFrame(sp,dir,e.moving?STEP[Math.floor(blink*6+n)%4]:0);if(!G)return false;
  const sw=G.fw/ART,sh=G.fh/ART;ctx.drawImage(G.img,G.sx,G.sy,G.fw,G.fh,px-sw/2,py-sh,sw,sh);return true}

// Push the traffic in view onto the y-sorted list (the walker objects themselves; no wrapper is made).
export function trafficEnts(S,inView,margin,out){const T=S.traffic;if(!T)return;
  for(const w of T.list)if(inView(w.x*U,w.y*U,margin))out.push(w);
  for(const g of T.guards)if(g.on&&inView(g.x*U,g.y*U,margin))out.push(g)}

export const isTraffic=e=>e.kind==='cart'||e.kind==='traveller'||e.kind==='guard';

// Add its shadow to draw.js's shadow path (#729): shadows lie under every sprite, or a walker's would fall across the boots
// of a hero standing just behind it. A cart casts two, its own and the drover's.
const oval=(ctx,x,y,w)=>{ctx.moveTo(x+w/2,y);ctx.ellipse(x,y,w/2,1.5,0,0,7)};
export function trafficShadow(ctx,e,px,py){
  if(e.kind==='cart'){const bw=cart(e.word||'salt',0).width/ART;oval(ctx,px,py,bw);oval(ctx,px+(e.face<0?-1:1)*bw*.5,py,figure('drover',0,0).width/ART);return}
  oval(ctx,px,py,(e.kind==='guard'?figure('captain',townFac(e.town),0):figure(TRAVEL_ROLE[e.word]||'stranger',e.n%2,0)).width/ART)}

// Draw one at px,py (world units, feet). Returns nothing.
export function drawTrafficEnt(ctx,e,px,py,blink){
  const fr=e.moving?Math.floor(blink*(e.kind==='cart'?3:5)+(e.n||0))%2:0,flip=e.face<0;
  let o,bw;
  if(e.kind==='cart'){o=cart(e.word||'salt',fr);bw=o.width/ART;
    ctx.save();ctx.translate(px,0);if(flip)ctx.scale(-1,1);
    ctx.drawImage(o,-bw*.45,py-o.height/ART,bw,o.height/ART);ctx.restore();
    // the drover walking at the cart's head
    if(sheetFigure(ctx,'drover',0,e.n||0,e,Math.round(px+(flip?-1:1)*bw*.5),py,blink))return;
    const d=figure('drover',0,fr),dw=d.width/ART,dx=px+(flip?-1:1)*bw*.5;
    ctx.save();ctx.translate(dx,0);if(flip)ctx.scale(-1,1);ctx.drawImage(d,-dw/2,py-d.height/ART,dw,d.height/ART);ctx.restore();return}
  if(e.kind==='guard'){if(sheetFigure(ctx,'captain',townFac(e.town),+e.id.slice(1)||0,e,px,py,blink))return}
  else if(sheetFigure(ctx,TRAVEL_ROLE[e.word]||'stranger',e.n%2,e.n,e,px,py,blink))return;
  if(e.kind==='guard')o=figure('captain',townFac(e.town),fr);
  else o=figure(TRAVEL_ROLE[e.word]||'stranger',e.n%2,fr);
  bw=o.width/ART;ctx.save();ctx.translate(px,0);if(flip)ctx.scale(-1,1);
  ctx.drawImage(o,-bw/2,py-o.height/ART,bw,o.height/ART);ctx.restore()}
