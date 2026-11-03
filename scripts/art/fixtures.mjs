// Fixture art for the terrain assets (#177 slice 2): small images drawn here in code, so the autotile rules can be
// developed, checked and looked at before (or without) any Hugging Face generation. Never written under assets/:
// artcheck encodes them to PNGs in a temp folder, and a browser preview can install them for one page:
//   const F=await import('/scripts/art/fixtures.mjs'), A=await import('/src/render/assets.js');
//   for(const [id,p] of Object.entries(F.fixtures(await (await fetch('/scripts/art/manifest.json')).json())))
//     A.setAssetPixels(id,A.pixelsOf(p.w,p.h,p.data));
// Pure ESM with no Node or DOM imports, deterministic (its own integer hash, never Math.random).
// fixtures(manifest) -> {id: {w, h, data: Uint8Array RGBA}} for every tile, autotile and prop entry it knows.

const hh=(x,y,s)=>{let h=(Math.imul(x|0,374761393)+Math.imul(y|0,668265263)+Math.imul(s|0,2147483647))|0;h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296};
const rgb=c=>[parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16)];
// Periodic value noise (period p in pixels, lattice step k): tiles seamlessly over p.
function pnoise(x,y,p,k,s){const n=p/k,gx=x/k,gy=y/k,x0=Math.floor(gx),y0=Math.floor(gy),fx=gx-x0,fy=gy-y0,
  v=(i,j)=>hh(((i%n)+n)%n,((j%n)+n)%n,s),sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
  return (v(x0,y0)*(1-sx)+v(x0+1,y0)*sx)*(1-sy)+(v(x0,y0+1)*(1-sx)+v(x0+1,y0+1)*sx)*sy}

// Ground ramps (dark to light) and sparse accents, from the procedural texels' own colours.
const GROUND={
  grass:{ramp:['#34782f','#3a8236','#3f8a3a','#45923c','#4a9a40'],acc:['#6cc050','#8ad060'],odds:.03},
  meadow:{ramp:['#34782f','#3a8236','#3f8a3a','#45923c','#4a9a40'],acc:['#f4e06a','#f08ab0','#f4f4f8','#6cc050'],odds:.05},
  fen:{ramp:['#3d5729','#42602c','#46622f','#4a6632'],acc:['#7a9a46','#9ab060'],odds:.05},
  swamp:{ramp:['#2a5242','#2c5646','#2f5a4a','#335f4e'],acc:['#5a8a6a','#8aa050'],odds:.04},
  mud:{ramp:['#4f4e2c','#545330','#5b5a34','#6e6a3e'],acc:['#3e3c22','#7a7650'],odds:.04},
  ash:{ramp:['#585050','#5f5652','#655c58','#6e6460','#746a64'],acc:['#4a423e','#8a807a','#7e8a52'],odds:.04},
  snow:{ramp:['#d8e0e8','#dde4ec','#e2e8ee','#e6ecf2'],acc:['#c4ced8','#ffffff'],odds:.03},
  ice:{ramp:['#aad4e2','#b4dce8','#bde2ec'],acc:['#e4f8fc','#6a98b0'],odds:.03},
  road:{ramp:['#9f8455','#a68a58','#a88c5c','#b09460'],acc:['#c8b088','#8a7048'],odds:.05},
  water:{ramp:['#2e5fb0','#3264b4','#3468b8','#3a70c4'],acc:['#6a9ce0','#8ab8f0'],odds:.04}};
const TILE_GROUND={'tile:grass':'grass','tile:meadow':'meadow','tile:fen-grass':'fen','tile:swamp':'swamp','tile:mud':'mud','tile:ash-rock':'ash','tile:snow':'snow','tile:ice':'ice','tile:road':'road','tile:water':'water'};
// Transition pairs: A side, B side and a seam colour drawn on the A side of the border (foam, a worn rim, dying grass).
const PAIR={'grass-road':['grass','road','#2f6a2c'],'bank-water':['grass','water','#dce8f8'],'meadow-fen':['grass','fen','#3f5a30'],
  'fen-ash':['fen','ash','#6a6640'],'ash-snow':['ash','snow','#a8b0b8'],
  'fen-river':['fen','water','#dce8f8'],'snow-river':['snow','water','#e8f0f8'],'mud-swamp':['mud','swamp','#3e3c22']};

// Colour of ground g at pixel (x,y) of a texture repeating every p pixels.
function ground(g,x,y,p,s){const G=GROUND[g],n=pnoise(x,y,p,8,s)*.75+pnoise(x,y,p,4,s+9)*.25,h=hh(x,y,s+3);
  if(h<G.odds)return G.acc[Math.floor(hh(x,y,s+5)*G.acc.length)];
  if(g==='road'&&(y%16===5||y%16===10)&&hh(x,y,s+7)>.35)return '#8e7448';            // two wheel ruts, left to right
  if(g==='water'&&((y+Math.round(Math.sin(x/3)*1.2))%8===0)&&h>.4)return G.acc[0];  // ripple crests
  return G.ramp[Math.min(G.ramp.length-1,Math.floor(n*G.ramp.length))]}

function canvas(w,h){return {w,h,data:new Uint8Array(w*h*4)}}
const put=(im,x,y,c)=>{if(x<0||y<0||x>=im.w||y>=im.h||!c)return;const o=(y*im.w+x)*4,[r,g,b]=rgb(c);im.data[o]=r;im.data[o+1]=g;im.data[o+2]=b;im.data[o+3]=255};

function baseTile(id,[w,h],s){const g=TILE_GROUND[id],im=canvas(w,h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)put(im,x,y,ground(g,x,y,w,s));return im}

// Transition piece, centred on a tile corner: v < border = A, else B; the border wobbles but meets 8 at the piece's
// sides so consecutive pieces along a seam join. corner: B inside a quarter disc at the bottom right; inner: A inside
// a quarter disc at the top left (radius 8, so they meet the edge pieces at their sides too).
function piece(pair,shape,s){const [ga,gb,seam]=PAIR[pair],im=canvas(16,16);
  const wob=x=>Math.sin(x/16*Math.PI*2)*1.4+Math.sin(x/16*Math.PI*4+1)*.6;
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){let d; // d > 0 on the B side, in pixels from the border
    if(shape==='edge')d=y-7.5-wob(x);
    else if(shape==='corner')d=8.2+wob((x+y)/2)*.5-Math.hypot(15.5-x,15.5-y);
    else d=Math.hypot(x+.5,y+.5)-8.2-wob((x+y)/2)*.5;
    const c=d>0?ground(gb,x,y,16,s+1):(d>-1.2&&hh(x,y,s)>.25)?seam:ground(ga,x,y,16,s);put(im,x,y,c)}
  return im}

// Trees, 16x16 on transparent ground: three shapes per biome.
function tree(b,i){const im=canvas(16,16),P={
  meadow:{lit:'#5cb84e',mid:['#2f8a36','#338f3a','#2a7e31'],dark:'#1e6a28',rim:'#1a5a22',bark:['#5a3a20','#3a2414']},
  fen:{lit:'#7a9a44',mid:['#4e6e2e','#4a6a2c','#46642a'],dark:'#34502a',rim:'#2a3a1e',bark:['#4a3a28','#2e2418'],moss:'#5a7a34'},
  ash:{lit:'#8a807a',mid:['#4a423e','#3a3432'],dark:'#2a2422',rim:'#1e1a1a',bark:['#3a302c','#221c1a'],ember:'#c8401a'},
  tundra:{lit:'#3a7a66',mid:['#1e4f44','#24584a'],dark:'#163a30',rim:'#10302a',bark:['#3a2a20','#241810'],snow:'#eef2f8'}}[b];
  const trunk=(x0,top,w=2)=>{for(let y=top;y<16;y++)for(let k=0;k<w;k++)put(im,x0+k,y,P.bark[k?1:0])};
  if(b==='tundra'){const cx=[7.5,6.5,8.5][i-1],tall=[11,9,12][i-1],wide=[.6,.75,.5][i-1];trunk(Math.round(cx)-1,tall+1);
    for(let y=0;y<=tall;y++){const hw=.6+y*wide,tier=y%4;for(let x=0;x<16;x++){const dx=x-cx;if(Math.abs(dx)>=hw)continue;
      put(im,x,y,y<=2?P.snow:tier===0&&dx<0?'#dde6ee':tier===3&&Math.abs(dx)>hw-2?P.rim:dx<-1?P.lit:dx>1?P.dark:P.mid[(x+y)&1])}}
    return im}
  if(b==='ash'){const x0=[7,6,8][i-1];trunk(x0,[4,6,3][i-1]);
    const br=[[[x0-1,7],[x0-2,6],[x0-3,5]],[[x0+2,8],[x0+3,7],[x0+4,6],[x0+4,5]],[[x0-1,5],[x0-2,4]],[[x0+2,5],[x0+3,4]]];
    for(const arm of br.slice(0,i+1))for(const [x,y] of arm)put(im,x,y,P.bark[0]);
    if(i===2)put(im,x0,15,P.ember);
    return im}
  const [cx,cy,rx,ry]=[[7.5,6,6.5,5.5],[7.5,5.5,7.4,5],[7,7,5,6.5]][i-1];trunk(7,Math.round(cy+ry-2));
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){const dx=x-cx,dy=y-cy,r=(dx*dx)/(rx*rx)+(dy*dy)/(ry*ry)+(i===2?Math.sin(x*1.3)*.08:0);
    if(r>=1)continue;put(im,x,y,r>.74?P.rim:dx+dy*1.1<-rx*.5?P.lit:dx+dy>rx*.45?P.dark:P.mid[Math.floor(hh(x,y,i)*P.mid.length)])}
  if(b==='fen')for(const x of [3,6,10,12])if(hh(x,i,4)>.3)for(let y=Math.round(cy+2);y<=Math.round(cy+ry+2-(x&1));y++)put(im,x,y,P.moss);
  return im}

// Rocks: a boulder (or two) at the bottom of a transparent 16x16, lit from the top left.
function rock(b,i){const im=canvas(16,16),P={
  meadow:{lit:'#b0a898',mid:'#9a9080',dark:'#6a6058',rim:'#3a3430',top:'#6cc050'},
  fen:{lit:'#8a8a70',mid:'#6a6a54',dark:'#4a4a3a',rim:'#2a2a20',top:'#7a9a46'},
  ash:{lit:'#7a706a',mid:'#4a423e',dark:'#2e2826',rim:'#1a1616',top:'#c8401a'},
  tundra:{lit:'#a8b0b8',mid:'#7a8490',dark:'#545c68',rim:'#30363e',top:'#f8fafc'}}[b];
  const stones=[[[8,11,4.5,3.2]],[[6,11,3.5,2.8],[10.5,12,2.5,2]],[[8,10.5,5.5,4]]][i-1];
  for(const [cx,cy,rx,ry] of stones)for(let y=0;y<16;y++)for(let x=0;x<16;x++){const dx=x+.5-cx,dy=y+.5-cy,r=(dx*dx)/(rx*rx)+(dy*dy)/(ry*ry);
    if(r>=1)continue;const top=dy<-ry*.45&&hh(x,y,b.length+i)>.35&&(b==='tundra'||b==='meadow'||b==='fen');
    put(im,x,y,r>.7?P.rim:top?P.top:dx+dy<-1.6?P.lit:dx+dy>1.4?P.dark:P.mid)}
  return im}

export function fixtures(man){const out={};
  for(const e of man.assets||[]){let m,im=null;
    if(TILE_GROUND[e.id])im=baseTile(e.id,e.size,e.seed);
    else if((m=/^autotile:([a-z]+-[a-z]+)(-corner|-inner)?$/.exec(e.id))&&PAIR[m[1]])im=piece(m[1],m[2]?m[2].slice(1):'edge',e.seed);
    else if((m=/^prop:(tree|rock)-([a-z]+)-(\d)$/.exec(e.id)))im=(m[1]==='tree'?tree:rock)(m[2],+m[3]);
    if(im&&im.w===e.size[0]&&im.h===e.size[1])out[e.id]=im}
  return out}
