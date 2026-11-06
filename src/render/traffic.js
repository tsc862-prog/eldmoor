// Road traffic on the map (#856, sim/traffic.js #796): carts, travellers and road and bridge guards, drawn in the y-sorted
// entity list of draw.js. Render only: reads S.traffic, writes nothing to it. Style: the travellers and guards are the town
// NPC sprites (npcSprite, the same roles and faction colours as the townsfolk) and the cart is a procedural pixel-string
// sprite in the same outlined, PROC_SCALE look. When generated townsfolk sheets exist for these roles they can replace the
// figures here (sheetFigure below, #896). Skipped at far zoom by draw.js (`close`). No per-frame allocation:
// entities are the sim's own objects, every canvas is cached by [role][faction][frame] or [load][frame].
import {CITY} from '../world/map.js';
import {sprite,npcSprite,worldSprite,sheetFrame} from './sprites.js';
import {racesOf} from '../data/races.js';
import {U,ART} from './tile.js';

const TRAVEL_ROLE={pedlar:'peddler',pilgrim:'hermit',tinker:'peddler',drover:'drover','road courier':'sellsword','wandering minstrel':'minstrel'};
const LOAD={salt:'#e8e4da',grain:'#d8b050',ale:'#8a5a30',timber:'#a07848',wool:'#ece4d0',hide:'#7a5030',pelt:'#8a8a96',silk:'#a060c8',moss:'#5a8a48'};
const CART=[ // 15x10, facing right. L load, B bed, D bed shade, K wheel rim, W wheel, S spoke, P draught pole
  "...LLLLLLLL....",
  "..LLLLLLLLLL...",
  ".LLLLLLLLLLLL..",
  ".BBBBBBBBBBBBPP",
  ".BDDDDDDDDDDBPP",
  "..KKK....KKK...",
  ".KWSWK..KWSWK..",
  ".KSWSK..KSWSK..",
  ".KWSWK..KWSWK..",
  "..KKK....KKK...",
];
const STEP=[1,0,2,0],sp={kind:'npc',role:'',fac:0,race:''}; // STEP: sheet columns of a walk cycle (as draw.js)
const figs=new Map(),carts=new Map(),facOf=new Map(),probe={role:'',fac:0};

function townFac(name){let f=facOf.get(name);if(f===undefined){f=0;for(const c of CITY)if(c.name===name){f=c.fac||0;break}facOf.set(name,f)}return f}
function figure(role,fac,fr){let per=figs.get(role);if(!per)figs.set(role,per=[]);
  let a=per[fac];if(!a)a=per[fac]=[null,null];
  if(!a[fr]){probe.role=role;probe.fac=fac;a[fr]=worldSprite(npcSprite(probe,fr))}return a[fr]}
function cart(word,fr){let a=carts.get(word);if(!a)carts.set(word,a=[null,null]);
  if(!a[fr]){const rows=fr?CART.map((r,i)=>i>=6&&i<=8?r.replace(/S/g,'x').replace(/W/g,'S').replace(/x/g,'W'):r):CART;
    a[fr]=worldSprite(sprite('cart.'+word+fr,rows,{L:LOAD[word]||'#b89050',B:'#8a5a30',D:'#5a3a22',K:'#241c18',W:'#6a6a74',S:'#a8a8b4',P:'#6a4a2a'}))}
  return a[fr]}

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
