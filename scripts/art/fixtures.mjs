// Fixture art for the terrain assets (#177 slice 2): small images drawn here in code, so the autotile rules can be
// developed, checked and looked at before (or without) any Hugging Face generation. Never written under assets/:
// artcheck encodes them to PNGs in a temp folder, and a browser preview can install them for one page:
//   const F=await import('/scripts/art/fixtures.mjs'), A=await import('/src/render/assets.js');
//   for(const [id,p] of Object.entries(F.fixtures(await (await fetch('/scripts/art/manifest.json')).json())))
//     A.setAssetPixels(id,A.pixelsOf(p.w,p.h,p.data));
// Pure ESM with no Node or DOM imports, deterministic (its own integer hash, never Math.random).
// fixtures(manifest, tier=32) -> {id: {w, h, data: Uint8Array RGBA}} for every tile, autotile, prop, sprite sheet, building and landmark entry
// it knows, at that tier's size (manifest sizes[tier]; #177 tiers).

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
  mud:{ramp:['#5e4c2c','#645230','#6c5834','#7e6a3e'],acc:['#3e3c22','#7a7650'],odds:.04},
  ash:{ramp:['#585050','#5f5652','#655c58','#6e6460','#746a64'],acc:['#4a423e','#8a807a','#7e8a52'],odds:.04},
  snow:{ramp:['#d8e0e8','#dde4ec','#e2e8ee','#e6ecf2'],acc:['#c4ced8','#ffffff'],odds:.03},
  ice:{ramp:['#aad4e2','#b4dce8','#bde2ec'],acc:['#e4f8fc','#6a98b0'],odds:.03},
  road:{ramp:['#9f8455','#a68a58','#a88c5c','#b09460'],acc:['#c8b088','#8a7048'],odds:.05},
  lava:{ramp:['#c8401a','#f07a22','#ff9a30','#ffd04a'],acc:['#3a1c16','#fff4a0'],odds:.05},
  water:{ramp:['#2e5fb0','#3264b4','#3468b8','#3a70c4'],acc:['#6a9ce0','#8ab8f0'],odds:.04}};
const TILE_GROUND={'tile:grass':'grass','tile:meadow':'meadow','tile:fen-grass':'fen','tile:swamp':'swamp','tile:mud':'mud','tile:ash-rock':'ash','tile:snow':'snow','tile:ice':'ice','tile:road':'road','tile:water':'water','tile:lava':'lava'};
// Transition pairs: A side, B side and a seam colour drawn on the A side of the border (foam, a worn rim, dying grass).
const PAIR={'grass-road':['grass','road','#2f6a2c'],'bank-water':['grass','water','#dce8f8'],'meadow-fen':['grass','fen','#3f5a30'],
  'fen-ash':['fen','ash','#6a6640'],'ash-snow':['ash','snow','#a8b0b8'],
  'fen-river':['fen','water','#dce8f8'],'snow-river':['snow','water','#e8f0f8'],'mud-swamp':['mud','swamp','#3e3c22'],
  'mud-fen':['mud','fen','#3f5a30'],'fen-swamp':['fen','swamp','#3e3c22'],'snow-ice':['ice','snow','#c4ced8'],'meadow-ash':['grass','ash','#4a423e'],'mud-ash':['mud','ash','#4a423e'],
  'ash-lava':['ash','lava','#2a2422'],'road-fen':['fen','road','#3f5a30'],'road-mud':['mud','road','#3e3c22'],'road-ash':['ash','road','#4a423e'],'road-snow':['snow','road','#c4ced8'],
  'road-swamp':['swamp','road','#3e3c22'],'fen-snow':['fen','snow','#c4ced8'],'swamp-snow':['swamp','snow','#c4ced8'],'mud-snow':['mud','snow','#c4ced8'],'ice-ash':['ice','ash','#4a423e'],'meadow-snow':['grass','snow','#c4ced8']};

// Colour of ground g at pixel (x,y) of a texture repeating every p pixels.
function ground(g,x,y,p,s){const G=GROUND[g],n=pnoise(x,y,p,8,s)*.75+pnoise(x,y,p,4,s+9)*.25,h=hh(x,y,s+3);
  if(h<G.odds)return G.acc[Math.floor(hh(x,y,s+5)*G.acc.length)];
  if(g==='road'&&(y%16===5||y%16===10)&&hh(x,y,s+7)>.35)return '#8e7448';            // two wheel ruts, left to right
  if(g==='water'&&((y+Math.round(Math.sin(x/3)*1.2))%8===0)&&h>.4)return G.acc[0];  // ripple crests
  return G.ramp[Math.min(G.ramp.length-1,Math.floor(n*G.ramp.length))]}

function canvas(w,h){return {w,h,data:new Uint8Array(w*h*4)}}
const put=(im,x,y,c)=>{if(x<0||y<0||x>=im.w||y>=im.h||!c)return;const o=(y*im.w+x)*4,[r,g,b]=rgb(c);im.data[o]=r;im.data[o+1]=g;im.data[o+2]=b;im.data[o+3]=255};

function baseTile(id,[w,h],s){const g=TILE_GROUND[id],im=canvas(w,h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)put(im,x,y,ground(g,x,y,w,s));return im}

// Transition piece of N x N (a tile at the tier), centred on a tile corner: v < border = A, else B; the border wobbles
// but meets the middle at the piece's sides so consecutive pieces along a seam join. corner: B inside a quarter disc at
// the bottom right; inner: A inside a quarter disc at the top left (radius half the piece, so they meet the edge
// pieces at their sides too). The shape is laid out on a 16 grid and scaled, so every tier draws the same seam.
function piece(pair,shape,s,N=16){const [ga,gb,seam]=PAIR[pair],im=canvas(N,N),k=N/16;
  const wob=x=>Math.sin(x/16*Math.PI*2)*1.4+Math.sin(x/16*Math.PI*4+1)*.6;
  for(let Y=0;Y<N;Y++)for(let X=0;X<N;X++){const x=(X+.5)/k-.5,y=(Y+.5)/k-.5;let d; // d > 0 on the B side, in 16-grid pixels from the border
    if(shape==='edge')d=y-7.5-wob(x);
    else if(shape==='corner')d=8.2+wob((x+y)/2)*.5-Math.hypot(15.5-x,15.5-y);
    else d=Math.hypot(x+.5,y+.5)-8.2-wob((x+y)/2)*.5;
    const c=d>0?ground(gb,X,Y,N,s+1):(d>-1.2&&hh(X,Y,s)>.25)?seam:ground(ga,X,Y,N,s);put(im,X,Y,c)}
  return im}
// A 16x16 drawing scaled to N x N, nearest neighbour (trees and rocks at a tier).
function upscale(im,N){if(im.w===N)return im;const o=canvas(N,N),k=im.w/N;
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){const si=(Math.floor(y*k)*im.w+Math.floor(x*k))*4,di=(y*N+x)*4;for(let c=0;c<4;c++)o.data[di+c]=im.data[si+c]}
  return o}

// A sprite sheet: cols frames (stand, step, other step) by rows directions (down, left, right, up), a figure in each
// frame lit from the top left with a one-pixel outline. Heroes wear the key tabard (src/render/palette.js SPRITE.key, the
// first faction's colour and dark), which the renderer recolours per faction; creatures take their first palette colour.
const KEY=['#5b8ff2','#2a4fa0'],SKIN='#f0c8a0',OUT='#100c16';
function sheet(e,[w,h]){const {cols,rows}=e.frames,fw=w/cols,fh=h/rows,im=canvas(w,h),hero=/^sprite:hero-/.test(e.id);
  const body=hero?KEY:[((e.palette||{}).extra||[])[0]||'#9a9aa8',((e.palette||{}).extra||[])[1]||'#3a3a46'];
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const ox=c*fw,oy=r*fh,bw=Math.round(fw*.5),bh=Math.round(fh*(hero?.45:.5)),bx=ox+Math.round((fw-bw)/2),by=oy+fh-bh-Math.round(fh*.12);
    const fill=(x0,y0,x1,y1,col)=>{for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)put(im,x,y,col)};
    fill(bx-1,by-1,bx+bw+1,by+bh+1,OUT);fill(bx,by,bx+bw,by+bh,body[0]);fill(bx+Math.round(bw*.6),by,bx+bw,by+bh,body[1]); // body, shaded right
    const lg=Math.max(2,Math.round(fh*.12)),step=c===0?0:c===1?-1:1,lw=Math.max(1,Math.round(bw*.25)); // legs: the step columns stride
    fill(bx+1+Math.max(0,step)*2,by+bh,bx+1+lw+Math.max(0,step)*2,by+bh+lg,OUT);fill(bx+bw-1-lw-Math.max(0,-step)*2,by+bh,bx+bw-1-Math.max(0,-step)*2,by+bh+lg,OUT);
    if(hero){const hs=Math.round(fw*.34),hx=ox+Math.round((fw-hs)/2),hy=by-hs;fill(hx-1,hy-1,hx+hs+1,hy+hs+1,OUT);fill(hx,hy,hx+hs,hy+hs,r===3?'#2a2020':SKIN); // a head: hair from behind
      if(r!==3){const ex=r===1?hx+1:r===2?hx+hs-2:hx+Math.round(hs/2)-1;fill(ex,hy+Math.round(hs*.45),ex+1,hy+Math.round(hs*.45)+1,OUT)}}
    else{const ex=r===1?bx+1:r===2?bx+bw-2:bx+Math.round(bw/2);if(r!==3)fill(ex,by+1,ex+1,by+2,'#ffe060')}} // an eye on the side it faces
  return im}

// What a model answers for a sprite sheet (#711), to test post-sheet.mjs: the entry's fixture sheet's figures set in a
// cols x rows grid on a plain white size x size image (not the sheet's aspect, not on its frame grid), each sprite pixel a
// block of 'block' px with slightly darker block edges, and each figure nudged by a few px. rows/cols override the layout
// (a bad answer: 3 rows instead of 4); key:false paints the tabard grey (a hero that would not take the faction colour).
export function sheetArt(e,{tier=32,size=1024,block=4,rows,cols,key=true}={}){const z=(e.sizes&&e.sizes[tier])||e.size,src=sheet(e,z),{cols:C,rows:R}=e.frames,fw=z[0]/C,fh=z[1]/R;
  const nr=rows||R,nc=cols||C,cw=size/nc,ch=size/nr,im=canvas(size,size),grey={'91,143,242':[150,150,160],'42,79,160':[90,90,100]};
  im.data.fill(255);
  for(let r=0;r<nr;r++)for(let c=0;c<nc;c++){const sr=r%R,sc=c%C,dx=Math.round((hh(r,c,e.seed)-.5)*12),dy=Math.round((hh(c,r,e.seed+1)-.5)*12);
    const ox=Math.round(c*cw+(cw-fw*block)/2)+dx,oy=Math.round(r*ch+(ch-fh*block)/2)+dy;
    for(let y=0;y<fh;y++)for(let x=0;x<fw;x++){const so=((sr*fh+y)*z[0]+sc*fw+x)*4;if(!src.data[so+3])continue;
      let px=[src.data[so],src.data[so+1],src.data[so+2]];if(!key&&grey[px.join(',')])px=grey[px.join(',')];
      for(let by=0;by<block;by++)for(let bx=0;bx<block;bx++){const X=ox+x*block+bx,Y=oy+y*block+by;if(X<0||Y<0||X>=size||Y>=size)continue;
        const edge=bx===0||by===0?.9:1,o=(Y*size+X)*4;im.data[o]=px[0]*edge;im.data[o+1]=px[1]*edge;im.data[o+2]=px[2]*edge}}}
  return im}

// What a model answers to an init image (#763, the mock Space and the checks): the canvas it was given with texture added, as a
// low strength does: every block of 8 px nudged by a shade that grows with the strength, block edges a little darker. A bad answer:
// spill paints a thing on the empty canvas round the subject, redraw ignores the init (a scene of its own, as at strength 1).
export function img2imgArt(im,{strength=.4,seed=1,block=8,spill=false,redraw=false}={}){const {w,h}=im,d=new Uint8Array(im.data);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const o=(y*w+x)*4,bx=Math.floor(x/block),by=Math.floor(y/block);
    if(redraw){const v=hh(bx>>2,by>>2,seed)*200+30;d[o]=v;d[o+1]=v*.8;d[o+2]=255-v;continue}
    const white=d[o]===255&&d[o+1]===255&&d[o+2]===255;if(white){if(spill&&(bx+by)%3)d[o]=d[o+1]=d[o+2]=40;continue}
    const n=(hh(bx,by,seed)-.5)*strength*50,e=x%block&&y%block?1:.97;for(let k=0;k<3;k++)d[o+k]=Math.max(0,Math.min(255,Math.round((d[o+k]+n)*e)))}
  return {w,h,data:d}}

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


// Towns and landmarks (#177 slice 3): one building per piece in each style, the wall, its corner, the gate, the crypt
// mouth and the lair's nest, drawn at the entry's size (k art pixels a tile) with light from the top left. The colours
// copy src/render/palette.js TOWN and LANDMARK (this module imports nothing).
const STYLE={
  stone:{roof:['#8a9ab8','#5e6e8e','#3e4a66'],wall:['#ece4cc','#d0c4a4','#a89a7c'],trim:['#6a5a44','#3a2e22'],
    stone:['#b4acb8','#8a8292','#5a5462','#2e2a34'],glass:['#9ad0ff','#4a7ab0'],door:['#5a3a1c','#3a2414'],gold:['#f2c14e','#a87a1a']},
  timber:{roof:['#b0583c','#8a3a28','#5a2418'],wall:['#7a5a3e','#5a3e2a','#3a281c'],trim:['#2a2420','#141012'],
    stone:['#6a6266','#4a4448','#332e32','#1a1618'],glass:['#ffb060','#c8601a'],door:['#3a2414','#1e140c'],gold:['#c8c4bc','#7a7672']}};
const TILES_WIDE={auction:3,hall:3,inn:3,gate:4};
function building(style,piece,[w,h],s){const im=canvas(w,h),P=STYLE[style],k=Math.round(w/(TILES_WIDE[piece]||1));
  const box=(x0,y0,x1,y1,c)=>{for(let y=Math.max(0,Math.round(y0));y<Math.min(h,Math.round(y1));y++)for(let x=Math.max(0,Math.round(x0));x<Math.min(w,Math.round(x1));x++)put(im,x,y,typeof c==='function'?c(x,y):c)};
  const out=(x0,y0,x1,y1)=>box(x0-1,y0-1,x1+1,y1+1,'#100c16');
  const bricks=(x,y,ramp,bw=8,bh=4)=>{bw=Math.max(2,Math.round(bw));bh=Math.max(2,Math.round(bh));const row=Math.floor(y/bh),off=row&1?bw>>1:0;
    if(y%bh===0||(x+off)%bw===0)return ramp[ramp.length-1];return ramp[hh(Math.floor((x+off)/bw),row,s)>.5?1:0]};
  const wallTex=(x,y)=>style==='stone'?bricks(x,y,P.wall):(x%Math.max(4,k>>2)===0?P.trim[0]:P.wall[hh(x>>1,y>>3,s)>.5?1:0]);
  const roofTex=(x,y,y0)=>{const st=Math.max(2,k>>3),r=Math.floor((y-y0)/st);return (y-y0)%st===0?P.roof[2]:P.roof[(r+(x>>2))&1?0:1]};
  const house=(x0,x1,roofH,sign)=>{const top=Math.round(h*.06),ry=top+roofH;out(x0,top,x1,h-1);
    box(x0,top,x1,ry,(x,y)=>y<top+2?P.roof[0]:roofTex(x,y,top));box(x0,ry-1,x1,ry,P.trim[1]);
    box(x0+k*.08,ry,x1-k*.08,h-1,wallTex);box(x0+k*.08,h-2,x1-k*.08,h-1,P.trim[1]);
    const dw=Math.max(4,Math.round(k*.32)),dh=Math.round(k*.42),dx=Math.round((x0+x1)/2-dw/2);
    box(dx-1,h-2-dh,dx+dw+1,h-1,P.trim[1]);box(dx,h-1-dh,dx+dw,h-1,(x)=>x<dx+dw/2?P.door[0]:P.door[1]);
    const ww=Math.max(3,Math.round(k*.22)),win=wx=>{const wy=ry+Math.round((h-ry)*.25);box(wx-1,wy-1,wx+ww+1,wy+ww+1,P.trim[1]);box(wx,wy,wx+ww,wy+ww,(x,y)=>x+y<wx+wy+ww*.8?P.glass[0]:P.glass[1])};
    if(x1-x0>k*1.5){win(x0+Math.round(k*.35));win(x1-Math.round(k*.35)-ww)}
    if(sign){const sw=Math.round(k*.4),sx=Math.round((x0+x1)/2-sw/2),sy=Math.round(top+roofH*.35);box(sx-1,sy-1,sx+sw+1,sy+Math.round(sw*.6)+1,P.trim[1]);box(sx,sy,sx+sw,sy+Math.round(sw*.6),sign)}};
  if(piece==='auction'||piece==='hall'||piece==='inn'){house(1,w-1,Math.round(h*.42),piece==='auction'?P.gold[0]:piece==='inn'?P.glass[0]:null);
    if(piece==='hall'){const px=w-Math.round(k*.3);box(px,2,px+2,Math.round(h*.6),P.trim[1]);box(px-Math.round(k*.3),3,px,3+Math.round(k*.25),P.roof[1])}}
  else if(piece==='smithy'){house(1,w-1,Math.round(h*.3),null);const cx=Math.round(w*.15),cw=Math.round(w*.35);out(cx,0,cx+cw,Math.round(h*.45));box(cx,0,cx+cw,Math.round(h*.45),(x,y)=>bricks(x,y,P.stone,4,3));
    box(cx+1,Math.round(h*.3),cx+cw-1,Math.round(h*.42),(x,y)=>hh(x,y,s)>.4?'#ffb040':'#c8401a')}
  else if(piece==='chapel'){const sp=Math.round(h*.38),cx=w/2;house(1,w-1,Math.round(h*.18),null); // the nave, then the spire over its roof
    for(let y=0;y<sp;y++){const hw=Math.max(1,Math.round((y+1)/sp*w*.45));box(cx-hw-1,y,cx+hw+1,y+1,'#100c16');box(cx-hw,y,cx+hw,y+1,(x)=>x<cx?P.roof[0]:P.roof[1])}
box(cx-1,0,cx+1,3,P.gold[0]);
    const r=Math.max(2,Math.round(k*.18)),cy=sp+Math.round(h*.24);box(cx-r,cy-r,cx+r,cy+r,(x,y)=>Math.hypot(x+.5-cx,y+.5-cy)<r?P.glass[(x+y)&1]:null)}
  else if(piece==='board'){const L=Math.round(w*.15),Rr=Math.round(w*.85);box(L,Math.round(h*.3),L+2,h-1,P.trim[0]);box(Rr-2,Math.round(h*.3),Rr,h-1,P.trim[0]);
    out(Math.round(w*.08),Math.round(h*.22),Math.round(w*.92),Math.round(h*.75));box(Math.round(w*.08),Math.round(h*.22),Math.round(w*.92),Math.round(h*.75),P.door[0]);
    for(let i=0;i<3;i++){const nx=Math.round(w*(.15+i*.25)),ny=Math.round(h*(.3+(i&1)*.12));box(nx,ny,nx+Math.round(w*.18),ny+Math.round(h*.25),'#ece6d2')}
    box(Math.round(w*.04),Math.round(h*.1),Math.round(w*.96),Math.round(h*.22),P.roof[1])}
  else if(piece==='wall'){ // merlons along the outer (top) edge, the wall walk, then the face
    box(0,0,w,h,(x,y)=>y<h*.3?((Math.floor(x/(k/4))&1)?bricks(x,y,P.stone,k/4,k/8):(y<h*.14?P.stone[3]:P.stone[2])):y<h*.36?P.stone[3]:y>h*.82?P.stone[2]:bricks(x,y,P.stone,k/4,k/8))}
  else if(piece==='wall-corner'){box(0,0,w,h,(x,y)=>{const m=Math.min(x,y);return m<k*.12?((Math.floor((x+y)/(k/4))&1)?P.stone[0]:P.stone[2]):m<k*.18?P.stone[3]:bricks(x,y,P.stone,k/4,k/8)})}
  else if(piece==='gate'){for(const tx of [0,3]){const x0=tx*k;out(x0+1,1,x0+k-1,h-1);box(x0+1,1,x0+k-1,h-1,(x,y)=>(x-x0<3||y<3)?P.stone[0]:bricks(x,y,P.stone,k/4,k/8));
      box(x0+k*.3,h*.3,x0+k*.7,h*.7,P.stone[3])}
    box(k,0,3*k,Math.max(2,Math.round(h*.12)),(x)=>x%4<2?P.trim[1]:P.stone[2])} // a portcullis line over the passage
  return im}
function landmark(kind,[w,h],s){const im=canvas(w,h),cx=w/2,cy=h/2;
  if(kind==='crypt-mouth'){const S=['#78748a','#5a5668','#4a4652','#2e2a34'];
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const ax=Math.abs(x+.5-cx);if(!(ax<w*.38&&y>h*.08&&y<h*.92))continue;
      if(ax<w*.17&&y>h*.3){put(im,x,y,(y-Math.round(h*.3))%Math.max(3,Math.round(h*.1))<2?'#2e2a34':'#0a0810');continue} // the stair going down
      put(im,x,y,(y<h*.16||ax>w*.32)?S[0]:(x+y)%7===0?S[3]:hh(x>>2,y>>2,s)>.85?'#5a8a44':S[hh(x>>3,y>>3,s)>.5?1:2])}
    const sk=Math.max(3,Math.round(w*.08));
    for(const sx of [cx-w*.3,cx+w*.22])for(let y=0;y<sk;y++)for(let x=0;x<sk;x++)put(im,Math.round(sx+x),Math.round(h*.8+y),y===Math.round(sk*.4)&&(x===1||x===sk-2)?'#0a0810':'#e8e4d8');
    for(let y=0;y<4;y++)for(let x=0;x<6;x++)put(im,Math.round(cx-3+x),Math.round(h*.2+y),y<2?'#7ad0a0':'#c8ffd8');
    return im}
  const R=w/2-1; // the nest, its path out to the left (west) edge
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const dx=x+.5-cx,dy=y+.5-cy,d=Math.hypot(dx,dy),path=dx<0&&Math.abs(dy)<h*.08;
    if(d>R&&!path)continue;const n=hh(x>>3,y>>3,s),crack=Math.abs(Math.sin(x*.21+Math.cos(y*.17)*2))<.06&&d<R*.85;
    put(im,x,y,d<R*.18?(hh(x>>1,y>>1,s)>.6?'#ffd04a':'#c8a040'):crack?(hh(x,y,s)>.5?'#f07a22':'#c8401a'):d>R-2&&!path?'#2a2422':hh(x>>2,y>>2,s+3)>.97?'#e8e0c8':path?'#4a423e':n>.66?'#655c58':n>.33?'#4a423e':'#3a1c16')}
  return im}

// A whole tree for the canopy table (#834): an ellipse crown over a trunk, root on the 9/10 row, a translucent shadow.
function canopy(b,i,[w,h]){const im=canvas(w,h),root=Math.round(h*.9),cx=w/2,col={meadow:'#4a9a40',fen:'#6e7e34',ash:'#4a423e',tundra:'#2e6a58'}[b];
  for(let y=root-4;y<root+Math.round(h*.07);y++)for(let x=Math.round(cx-w*.3);x<cx+w*.3;x++)if(((x-cx)/(w*.3))**2+((y-root)/(h*.07))**2<1)put(im,x,y,'#2a3a22');
  for(let y=Math.round(h*.35);y<=root;y++)for(let x=Math.round(cx-w*.07);x<=cx+w*.07;x++)put(im,x,y,'#5a3a20');
  for(let y=0;y<h*.7;y++)for(let x=0;x<w;x++){const dx=(x-cx)/(w*.48),dy=(y-h*.35)/(h*.35);if(dx*dx+dy*dy<1)put(im,x,y,dx*dx+dy*dy>.8?'#1e4a24':col)}
  void i;return im}
export function fixtures(man,tier=32){const out={};
  for(const e of man.assets||[]){let m,im=null;const size=(e.sizes&&e.sizes[tier])||e.size;if(!size)continue;
    if(TILE_GROUND[e.id])im=baseTile(e.id,size,e.seed);
    else if((m=/^autotile:([a-z]+-[a-z]+)(-corner|-inner)?$/.exec(e.id))&&PAIR[m[1]])im=piece(m[1],m[2]?m[2].slice(1):'edge',e.seed,size[0]);
    else if((m=/^prop:(tree|rock)-([a-z]+)-(\d)$/.exec(e.id)))im=upscale((m[1]==='tree'?tree:rock)(m[2],+m[3]),size[0]);
    else if((m=/^prop:canopy-([a-z]+)-(\d)$/.exec(e.id)))im=canopy(m[1],+m[2],size);
    else if(e.kind==='sprite'&&e.frames)im=sheet(e,size);
    else if((m=/^(?:building|tile):([a-z]+)-([a-z-]+)$/.exec(e.id))&&STYLE[m[1]])im=building(m[1],m[2],size,e.seed);
    else if((m=/^landmark:([a-z-]+)$/.exec(e.id)))im=landmark(m[1],size,e.seed);
    if(im&&im.w===size[0]&&im.h===size[1])out[e.id]=im}
  return out}

// Portrait library fixtures (#710): a head-and-shoulders face per id (portrait:<race>-<cls>-<sex>-<nn>), size x size on a
// transparent ground, lit from the top left with a one-pixel outline. Skin, hair and garment come from the id's hash, so
// different ids look different and a check can tell which face was picked. Never written under assets/.
// portraitFixtures(ids, size=64) -> {id: {w, h, data}}.
const PSKIN=['#f0c8a0','#d8a878','#b07a50','#8a9a7a','#a8b0b8','#c89a7a'],PHAIR=['#2a2020','#6a4a2a','#c8a050','#e8e4d8','#4a5a7a','#8a2a1a'],
  PCLOTH=['#5b8ff2','#c84a3a','#4a9a40','#8a5ac8','#c8a040','#3a7a8a'];
const strHash=s=>{let h=7;for(let i=0;i<s.length;i++)h=(Math.imul(h,33)+s.charCodeAt(i))|0;return h};
function face(id,N){const im=canvas(N,N),s=strHash(id),k=N/64,pk=(arr,salt)=>arr[Math.floor(hh(s,salt,11)*arr.length)];
  const skin=pk(PSKIN,1),hair=pk(PHAIR,2),cloth=pk(PCLOTH,3),shade=c=>{const [r,g,b]=rgb(c);return '#'+[r,g,b].map(v=>Math.round(v*.7).toString(16).padStart(2,'0')).join('')};
  const inHead=(x,y)=>((x-32)/14)**2+((y-28)/17)**2<1,inBody=(x,y)=>y>=46&&Math.abs(x-32)<10+(y-46)*1.6,inHair=(x,y)=>inHead(x,y+3)&&y<20+hh(s,x>>2,5)*4;
  const at=(X,Y)=>{const x=(X+.5)/k,y=(Y+.5)/k;
    if(inHair(x,y))return x<30?hair:shade(hair);
    if(inHead(x,y)){if(Math.abs(y-28)<1.5&&(Math.abs(x-26)<1.5||Math.abs(x-38)<1.5))return '#1a1218';if(Math.abs(y-37)<1&&Math.abs(x-32)<4)return shade(shade(skin));return x+y<58?skin:shade(skin)}
    if(y>=43&&y<46&&Math.abs(x-32)<5)return shade(skin);
    if(inBody(x,y))return x<32?cloth:shade(cloth);return null};
  for(let Y=0;Y<N;Y++)for(let X=0;X<N;X++)put(im,X,Y,at(X,Y));
  const op=new Uint8Array(im.data);for(let Y=0;Y<N;Y++)for(let X=0;X<N;X++){if(op[(Y*N+X)*4+3])continue; // outline every empty pixel next to the figure
    if([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>{const x=X+dx,y=Y+dy;return x>=0&&y>=0&&x<N&&y<N&&op[(y*N+x)*4+3]}))put(im,X,Y,'#100c16')}
  return im}
export function portraitFixtures(ids,size=64){const out={};for(const id of ids)out[id]=face(id,size);return out}

// A fixture inbox for art:review (#712): pure data, the artcheck writes it to a temp folder.
// -> {queue: assets/queue.json, files: [relative path under the assets folder], accepted: [keys already in the index]}
// Two days of waiting art: the older day a prop and a tile that main already has (stale), the newer day a tile, a building and a
// sprite (the last two need an in-game preview), plus one rejected redraw and one failed draw with its reason.
export function reviewFixture(){
  const old='2026-10-30',cur='2026-11-02',inc=(date,file)=>({date,file});
  return {accepted:['tile:grass@32'],
    files:[`incoming/${old}/sheet.html`,`incoming/${cur}/sheet.html`,`incoming/${cur}/sheet-2.html`],
    queue:{version:1,model:{pinned:null,tried:{}},incoming:{
      'tile:grass@32':inc(old,'tile/32/grass.png'),'prop:tree-meadow-1@32':inc(old,'prop/32/tree-meadow-1.png'),
      'tile:snow@32':inc(cur,'tile/32/snow.png'),'building:stone-inn@32':inc(cur,'building/32/stone-inn.png'),'sprite:hero-mage@32':inc(cur,'sprite/32/hero-mage.png')},
      failed:{'prop:rock-meadow-1@32':{tries:1,why:'HTTP 500',at:'2026-11-02T10:00:00Z'}},rejected:{'tile:mud@32':1},alts:{},
      stats:{tile:{made:3,flat:1,failed:0},prop:{made:1,flat:0,failed:1}},costProbe:null,next:[],lastRun:null}}}
