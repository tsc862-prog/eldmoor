// Town life (#795, slice 4 of the solid-world epic #791): what makes a walled town look lived in, all of it drawn from
// the town plan (CITY[i].buildings, gateTiles, gateSide) and the hour, never from sim state, never a named town.
//   chimney smoke    the smithy's forge by working hours, the inn's hearth at breakfast and from the afternoon, drifting
//                    with the sky's wind; none in the small hours.
//   stalls           in the open ground of the plaza, awnings up and a keeper at them in market hours; shut (a covered
//                    table) at night and in the rain.
//   guards           two at the gate on the wall tiles either side and one walking the wall opposite it. Render only:
//                    no patrol or gate logic here (slice 5, #796 owns the roads).
//   doors            lamps lit at dusk, the forge glowing; the night pass gives them their light.
//   flags            a pennant in the faction colour on the hall, waving with the wind.
// Plus the critters (critters.js) and footprints (footprints.js). Everything keeps its own state, a handful of numbers
// a town, and the frame hooks below are the only thing draw.js calls. Frame cost: only towns in view are touched and
// nothing allocates per frame (the entity list takes pooled objects).
import {CITY} from '../world/map.js';
import {solidAt} from '../world/passable.js';
import {FAC} from '../data/factions.js';
import {npcRole} from '../data/npcs.js';
import {U as T,PROC_SCALE,ART} from './tile.js';
import {npcSprite,worldSprite,sprite} from './sprites.js';
import {MARK} from './palette.js';
import {hash} from '../core/rng.js';
import {F,frame,inTiles,skyAt,WET,WIND,ramp,lamps} from './life.js';
import {critterEnts,drawRoostBirds} from './critters.js';
import {trackSteps,drawFootprints} from './footprints.js';

const OPPOSITE={E:'W',W:'E',N:'S',S:'N'};
const KEEPERS=['peddler','drover','quartermaster','innkeeper']; // townsfolk roles whose look a stallkeeper borrows
const GOODS=[['#c8402a','#e8b038','#7a9a3a'],['#4a7ab0','#e8e0c8','#a04a8a'],['#b8863a','#7a5a3a','#d8c890']]; // what lies on the table

// ---- the plan of a town, built once (the tiles do not change) ----
const LAY=new Map();
function layout(c,ci){let L=LAY.get(c);if(L)return L;
  L={c,ci,chim:[],doors:[],stalls:[],guards:[],flag:null};
  const open=(x,y)=>x>c.x0&&x<c.x1&&y>c.y0&&y<c.y1&&!solidAt(x,y);
  const doorSet=c.buildings.map(b=>b.door);
  for(const b of c.buildings){const [dx,dy]=b.door,[bx,by]=b.draw||b.box;
    if(b.piece==='smithy')L.chim.push({x:bx*T+12,y:by*T+1,kind:'forge',hours:(npcRole('smith')||{}).hours||[6,21]});
    else if(b.piece==='inn')L.chim.push({x:bx*T+38,y:by*T+1,kind:'hearth'});
    if(b.piece==='hall')L.flag={x:(bx+(b.draw?b.draw[2]:b.box[2])/2)*T,y:by*T+3};
    if(b.piece!=='board')L.doors.push({x:(dx+.5)*T+(b.piece==='smithy'?-2:0),y:(dy+1)*T,forge:b.piece==='smithy',w:b.box[2]})}
  // stalls: two tiles wide, with the rows above and below clear, away from doors and the gate lane
  const gate=c.gateTiles,gx=gate[0][0],gy=gate[0][1],cand=[];
  for(let y=c.y0+3;y<c.y1;y++)for(let x=c.x0+1;x<c.x1;x++){
    let ok=true;for(let yy=y-2;yy<=y+1&&ok;yy++)for(let xx=x;xx<=x+1;xx++)if(!open(xx,yy)){ok=false;break}
    if(!ok)continue;
    let near=false;for(const [dx,dy] of doorSet)if(Math.abs(dx-x-.5)<2.2&&Math.abs(dy-y)<3)near=true;
    if(near)continue;
    const g=Math.hypot(x+1-gx,y-gy);if(g<5)continue;cand.push({x,y,s:g+hash(x,y,c.x0*7+c.y0)*2.5})}
  cand.sort((a,b)=>b.s-a.s);
  for(const q of cand){if(L.stalls.length>=2)break;if(L.stalls.every(s=>Math.abs(s.sx-q.x)>=3||Math.abs(s.sy-q.y)>=3)){
    const i=L.stalls.length,k=KEEPERS[Math.floor(hash(q.x,q.y,5)*KEEPERS.length)];
    L.stalls.push({sx:q.x,sy:q.y,x:q.x+1,y:q.y+.95,kind:'deco',cx:q.x+1,goods:GOODS[Math.floor(hash(q.x,q.y,9)*GOODS.length)],
      kp:{role:k,fac:c.fac,id:ci*10+i},paint:paintStall,town:L,open:0})}}
  // guards: a pair on the wall tiles flanking the gate, one walking the wall opposite
  const side=c.gateSide,along=side==='E'||side==='W',gxs=gate.map(g=>g[0]),gys=gate.map(g=>g[1]);
  const flank=along?[[gxs[0],Math.min(...gys)-1],[gxs[0],Math.max(...gys)+1]]:[[Math.min(...gxs)-1,gys[0]],[Math.max(...gxs)+1,gys[0]]];
  flank.forEach(([x,y],i)=>L.guards.push({kind:'deco',x:x+.5,y:y+(along?.8:.85),post:true,face:along?(side==='E'?-1:1):(i?-1:1),fr:0,kp:{role:'captain',fac:c.fac,id:ci*10+3+i},paint:paintGuard,town:L,torch:true}));
  const opp=OPPOSITE[side],horiz=opp==='N'||opp==='S',len=(horiz?c.x1-c.x0:c.y1-c.y0)-2;
  L.walk={opp,horiz,len,x0:c.x0+1,y0:c.y0+1,x1:c.x1,y1:c.y1,off:hash(ci,3,8)*40};
  L.walker={kind:'deco',x:0,y:0,face:1,fr:0,walk:true,kp:{role:'captain',fac:c.fac,id:ci*10+5},paint:paintGuard,town:L,torch:true};
  LAY.set(c,L);return L}

// Where the wall-walker is at time t: back and forth along the wall, pausing at each end (a triangle with plateaus).
function placeWalker(L,t){const w=L.walk,sp=.55,pause=3,leg=w.len/sp,cyc=2*(leg+pause),u=(t+w.off)%cyc;let s,dir;
  if(u<leg){s=u*sp;dir=1}else if(u<leg+pause){s=w.len;dir=0}else if(u<2*leg+pause){s=w.len-(u-leg-pause)*sp;dir=-1}else{s=0;dir=0}
  const g=L.walker;g.moving=dir!==0;if(dir)g.face=dir;
  // the wall tiles run from a corner; stand a little inside the middle of the wall tile, feet at its lower edge
  if(w.horiz){g.x=w.x0+.5+s;g.y=(w.opp==='N'?L.c.y0:L.c.y1)+.78}else{g.x=(w.opp==='W'?L.c.x0:L.c.x1)+.5;g.y=w.y0+s+.9;g.face=g.face||1}
  g.fr=g.moving?Math.floor(F.now*5)&1:0}

// ---- painting the pieces that stand on the ground (y-sorted with everyone) ----
function person(ctx,px,py,kp,fr,face,alpha){const s=npcSprite(kp,fr),o=worldSprite(s),sw=s.width*PROC_SCALE,sh=s.height*PROC_SCALE,ow=1/ART;
  if(alpha<1)ctx.globalAlpha=alpha;
  ctx.fillStyle=MARK.shadow;ctx.beginPath();ctx.ellipse(px,py,sw/2,1.5,0,0,7);ctx.fill();
  ctx.save();ctx.translate(px,0);if(face<0)ctx.scale(-1,1);ctx.drawImage(o,-Math.floor(s.width/2)*PROC_SCALE-ow,py-sh-ow,o.width/ART,o.height/ART);ctx.restore();ctx.globalAlpha=1}
// A town guard: steel cap and shoulders, a tabard in the town's faction colours, a spear. Two frames, stand and step.
const GUARD=[['...SSS..T','..SSSSS.P','..SFFFS.P','..SFFFS.P','...FFF..P','.SBBBBBSP','.SBBABBSP','.SBBBBBSP','..BBBBB.P','..DDDDD.P','..DD.DD.P','..KK.KK..'],
  ['...SSS..T','..SSSSS.P','..SFFFS.P','..SFFFS.P','...FFF..P','.SBBBBBSP','.SBBABBSP','.SBBBBBSP','..BBBBB.P','..DDDDD.P','...DDD..P','...KKK...']];
function guardSprite(fac,fr){const f=FAC[fac]||FAC[0];return sprite('guard'+fac+fr,GUARD[fr],{S:'#b8c0d0',F:f.skin[0],B:f.color,A:f.dark,D:'#3a3430',K:'#1a1614',P:'#7a5a3a',T:'#e8ecf4'})}
function paintGuard(ctx,px,py,blink,e){const s=guardSprite(e.town.c.fac,e.fr||0),o=worldSprite(s),sh=s.height*PROC_SCALE,ow=1/ART;
  ctx.fillStyle=MARK.shadow;ctx.beginPath();ctx.ellipse(px,py,s.width*PROC_SCALE*.4,1.5,0,0,7);ctx.fill();
  ctx.save();ctx.translate(px,0);if(e.face<0)ctx.scale(-1,1);ctx.drawImage(o,-Math.floor(s.width/2)*PROC_SCALE-ow,py-sh-ow,o.width/ART,o.height/ART);ctx.restore()}
// A stall: posts, a striped awning in the faction colour, a table with goods; closed it is a covered table.
function paintStall(ctx,px,py,blink,e){const f=FAC[e.town.c.fac],o=e.open,R=(x,y,w,h,c)=>{ctx.fillStyle=c;ctx.fillRect(px+x,py+y,w,h)};
  if(o>0){ // keeper behind the table, drawn first so the table and awning cover his lower body
    person(ctx,px,py-7,e.kp,Math.floor(F.now*1.4+e.sx)&1,1,1)}
  R(-12,-9,24,9,'#6a4a2a');R(-12,-9,24,2,'#8a6a44');R(-12,-1,24,1,'#3a2a1c'); // the table, front
  if(o>0){
    for(let i=0;i<6;i++){R(-11+i*4,-10,3,1,e.goods[i%3])} // goods along its top
    R(-12,-30,2,22,'#4a3420');R(10,-30,2,22,'#4a3420'); // posts
    for(let i=0;i<8;i++){R(-12+i*3,-34,3,6,i&1?'#ece4cc':f.color);R(-12+i*3,-28,3,1,i&1?'#b8b09c':f.dark)} // the striped awning
    R(-12,-35,24,1,f.dark);for(let i=0;i<8;i++)if(i&1)R(-12+i*3,-27,3,1,'#0003')}
  else{R(-13,-14,26,6,'#8a7a5a');R(-13,-14,26,1,'#a8987a');R(-13,-9,26,1,'#4a3e2a');R(-6,-14,1,6,'#5a4e36');R(5,-14,1,6,'#5a4e36')}} // closed: a tarp over the table

// ---- the frame's hooks ----
const near=(c)=>inTiles((c.x0+c.x1)/2,(c.y0+c.y1)/2,Math.max(c.x1-c.x0,c.y1-c.y0));
export const lifeStats={ms:0,acc:0}; // a moving average of the ms a frame these hooks take (read by the frame-time probe and tests)
// Once a frame: the facts, then footprints noted.
export function lifeBegin(S,cam,now){frame(S,cam,T,now);trackSteps(S.agents)}
// Ground pass: footprints, under everything.
export function lifeGround(ctx){drawFootprints(ctx)}
// Entities: critters, stalls and guards onto the y-sorted list.
export function lifeEnts(ents){
  critterEnts(ents);
  if(F.tpx<9)return;
  for(let ci=0;ci<CITY.length;ci++){const c=CITY[ci];if(!near(c))continue;const L=layout(c,ci),h=F.hour;
    const shut=!!WET[skyAt(c.x0,c.y0)],mk=shut?0:ramp(h,7,8,17,18);
    for(const s of L.stalls){s.open=mk;ents.push(s)}
    for(const g of L.guards)ents.push(g);
    placeWalker(L,F.now);ents.push(L.walker)}}
// Air pass, over the entities and under the night: smoke, flags, door lamps, birds off the trees.
export function lifeAir(ctx,blink){drawRoostBirds(ctx);if(F.tpx<9)return;
  for(let ci=0;ci<CITY.length;ci++){const c=CITY[ci];if(!near(c))continue;const L=layout(c,ci),h=F.hour,wind=(WIND[skyAt(c.x0,c.y0)]||.3);
    for(const ch of L.chim){const k=ch.kind==='forge'?ramp(h,ch.hours[0]-.5,ch.hours[0]+.5,ch.hours[1]-1,ch.hours[1]):Math.max(ramp(h,5.5,6.5,9.5,10.5)*.7,h>=10.5&&h<14.5?.3:0,ramp(h,14.5,16,23,24));
      if(k>.02)smoke(ctx,ch.x,ch.y,k,wind,L.ci*3+Math.round(ch.x))}
    if(L.flag)flag(ctx,L.flag.x,L.flag.y,FAC[c.fac],wind);
    const lp=lamps(h);if(lp>0)for(const d of L.doors){ctx.fillStyle='rgba(255,196,96,'+(.9*lp).toFixed(2)+')';ctx.fillRect(Math.round(d.x)+9,Math.round(d.y)-15,2,3);ctx.fillStyle='rgba(255,230,160,'+(.9*lp).toFixed(2)+')';ctx.fillRect(Math.round(d.x)+9,Math.round(d.y)-15,2,1)}}}
// Puffs rise from the chimney, grow, thin and drift downwind. Stateless: each puff's place is a function of time.
function smoke(ctx,x,y,k,wind,seed){const n=Math.max(3,Math.ceil(6*k)),rise=34,dur=3.6;
  for(let i=0;i<n;i++){const p=((F.now/dur+i/n+seed*.137)%1),px=x+Math.sin(p*6+i*1.7+seed)*1.6+wind*p*14,py=y-p*rise,s=1+Math.floor(p*4);
    ctx.fillStyle='rgba(232,228,224,'+(1*k*(1-p)*(p<.1?p/.1:1)).toFixed(3)+')';const q=s+2;ctx.fillRect(Math.round(px)-(q>>1),Math.round(py)-(q>>1),q,q)}}
// A pennant on a pole: eleven columns that wave harder in the wind.
function flag(ctx,x,y,f,wind){const px=Math.round(x),py=Math.round(y),amp=.8+wind*2.4;
  ctx.fillStyle='#3a2a1a';ctx.fillRect(px,py-16,1,16);ctx.fillStyle='#f2c14e';ctx.fillRect(px,py-17,1,1);
  for(let i=0;i<11;i++){const w=Math.sin(F.now*(3+wind*3)-i*.8)*amp*(i/10),taper=i>7?(i-7):0;
    ctx.fillStyle=f.color;ctx.fillRect(px+1+i,Math.round(py-16+w),1,6-taper);ctx.fillStyle=f.dark;ctx.fillRect(px+1+i,Math.round(py-16+w+4-taper),1,1)}}
// Night pass (additive light): lit doors, the forge's glow while it works, guards' torches.
export function lifeLight(ctx,glow,dk,LIGHT){if(F.tpx<9)return;
  for(let ci=0;ci<CITY.length;ci++){const c=CITY[ci];if(!near(c))continue;const L=layout(c,ci),lp=lamps(F.hour);
    for(const d of L.doors){if(lp>0&&inTiles(d.x/T,d.y/T,1))glow(d.x,d.y-6,d.w>1?20:15,LIGHT.torch,dk*.55*lp);
      if(d.forge){const w=ramp(F.hour,5.5,6.5,19,21);if(w>0)glow(d.x,d.y-6,22,[255,120,40],dk*.6*w*(.85+.15*Math.sin(F.now*9)))}}
    for(const g of L.guards)glow(g.x*T+(g.face>0?5:-5),g.y*T-14,13,LIGHT.torch,dk*.5);
    glow(L.walker.x*T+(L.walker.face>0?5:-5),L.walker.y*T-14,13,LIGHT.torch,dk*.5)}}
