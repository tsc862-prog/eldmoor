// Eldmoor — an 8-bit hardcore MMO "ant farm".
// All game code lives in this module for now. See CLAUDE.md for the section map
// and the plan for splitting it into smaller modules.
// The headless harness (scripts/headless.mjs) imports this file with stubbed DOM,
// and reads simulation state from globalThis.__eldmoor.
const W=80,H=50,T=8;
const rnd=Math.random, ri=(a,b)=>a+Math.floor(rnd()*(b-a+1)), clamp=(v,a,b)=>v<a?a:v>b?b:v;
const pickA=a=>a[Math.floor(rnd()*a.length)];
function hash(x,y,s){let h=(x*374761393+y*668265263+s*982451653)|0;h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296}
function vnoise(x,y,s){const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi,u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
  const a=hash(xi,yi,s),b=hash(xi+1,yi,s),c=hash(xi,yi+1,s),d=hash(xi+1,yi+1,s);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v}
const fbm=(x,y,s)=>vnoise(x/6,y/6,s)*.6+vnoise(x/3,y/3,s+7)*.3+vnoise(x/1.5,y/1.5,s+13)*.1;

/* ---------- world ---------- */
const G=0,TREE=1,SWAMP=2,MUD=3,ROCK=4,PEAK=5,LAVA=6,ROAD=7,FLOOR=8,WALL=9,RIVER=10,BRIDGE=11,SGRASS=12,FLOWER=13,SNOW=14,ICE=15;
const SPEED=[1,.75,.5,.7,.9,.6,.6,1.3,1.1,1,.55,1.2,.9,1,.9,1.15];
const tiles=new Uint8Array(W*H), zone=new Uint8Array(W*H), I=(x,y)=>y*W+x;
const riverX=y=>26+Math.round(Math.sin(y/5)*1.6+Math.sin(y/2.3+1)*.7);
const z2X=y=>53+Math.round((vnoise(3.3,y/4,5)-.5)*7);
// Hoarfell: the frozen north, east of the river. Southern edge wanders between y=9 and y=15 (never past 16, so Kragmaw's lair stays in Cinderpass).
const hoarY=x=>12+Math.round((vnoise(x/4,2.7,17)-.5)*6);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const z=x<riverX(y)?0:y<hoarY(x)?3:x<z2X(y)?1:2; zone[I(x,y)]=z;
  const n=fbm(x,y,11),n2=fbm(x+50,y+20,23); let t;
  if(z===0)t=n>.58?TREE:(hash(x,y,5)>.95?FLOWER:G);
  else if(z===1)t=n>.6?SWAMP:n2>.63?TREE:(hash(x,y,6)>.5?SGRASS:MUD);
  else if(z===3)t=n>.68?PEAK:n2>.64?TREE:vnoise(x/2.5,y/2.5,31)>.74?ICE:hash(x,y,8)>.94?ROCK:SNOW;
  else t=n>.6?PEAK:n2>.66?LAVA:ROCK;
  if(x===riverX(y)||x===riverX(y)+1)t=RIVER;
  tiles[I(x,y)]=t;
}
const ZONES=['Thornvale','Mirefen','Cinderpass','Hoarfell'];
const FAC=[{name:'Concord',color:'#5b8ff2',dark:'#2a4fa0',skin:['#f0c8a0','#d8a878','#b88058']},
           {name:'Warband',color:'#e8544a',dark:'#8a2420',skin:['#8fb070','#a08c6c','#7a9a88']}];
function mkCity(name,fac,dy){return{name,fac,x0:2,x1:12,y0:2+dy,y1:10+dy,ah:{x:5.5,y:5.8+dy},qg:{x:9.5,y:5.8+dy},
  gate:{x:13.8,y:7+dy},grave:{x:10.5,y:8.2+dy},dy}}
const CITY=[mkCity('Highgate',0,0),mkCity('Grimhold',1,37)];
for(const c of CITY){
  for(let y=c.y0;y<=c.y1;y++)for(let x=c.x0;x<=c.x1;x++)
    tiles[I(x,y)]=(x===c.x0||x===c.x1||y===c.y0||y===c.y1)?WALL:FLOOR;
  tiles[I(12,6+c.dy)]=FLOOR;tiles[I(12,7+c.dy)]=FLOOR;
}
const LAIR={x:71.5,y:25.5};
for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const r=Math.hypot(x+.5-LAIR.x,y+.5-LAIR.y);
  if(r<=4)tiles[I(x,y)]=ROCK;
  else if(r<=5.4)tiles[I(x,y)]=(x<LAIR.x-3&&Math.abs(y+.5-LAIR.y)<1.6)?ROCK:LAVA;
}
function road(pts){for(let i=0;i<pts.length-1;i++){const[a,b]=[pts[i],pts[i+1]];const n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])*3);
  for(let k=0;k<=n;k++){const x=Math.round(a[0]+(b[0]-a[0])*k/n),y=Math.round(a[1]+(b[1]-a[1])*k/n),t=tiles[I(x,y)];
    if(t===RIVER)tiles[I(x,y)]=BRIDGE;else if(t!==FLOOR&&t!==WALL&&t!==BRIDGE)tiles[I(x,y)]=ROAD;}}}
road([[13,6.5],[20,9],[29,17],[40,25]]);road([[13,43.5],[20,41],[29,33],[40,25]]);road([[40,25],[50,23],[60,26],[67,25.4]]);
const CRYPT={name:'The Sunken Crypt',boss:'Lich-Warden Vesk',x:44.5,y:43.1,group:null,cd:25};
for(let y=41;y<=43;y++)for(let x=43;x<=45;x++)tiles[I(x,y)]=ROCK;
road([[40,25],[38,33],[44,43.4]]);
road([[40,25],[46,17],[52,8]]); // north road into Hoarfell

/* ---------- terrain render ---------- */
const terrain=document.createElement('canvas');terrain.width=W*T;terrain.height=H*T;
const tctx=terrain.getContext('2d');
const rgbC={};const rgb=s=>rgbC[s]||(rgbC[s]=[parseInt(s.slice(1,3),16),parseInt(s.slice(3,5),16),parseInt(s.slice(5,7),16)]);
const pk=(a,h)=>a[Math.floor(h*a.length)%a.length];
function grass(h){return h>.94?'#64b24e':pk(['#3f8a3a','#45923c','#3a8236','#41893a'],h)}
function texel(t,tx,ty,px,py){
  const h=hash(tx*8+px,ty*8+py,3);
  switch(t){
    case G:return grass(h);
    case FLOWER:return (px===3&&py===3)?(hash(tx,ty,9)>.5?'#f4e06a':'#f08ab0'):(px===3&&py===4)?'#2a6a28':grass(h);
    case TREE:{const dx=px-3.5,dy=py-3,r2=dx*dx+dy*dy*1.15;const zt=zone[I(tx,ty)],swamp=zt===1,frost=zt===3;
      if(frost){ // Hoarfell pine: dark blue-green spire under a snow cap, on snow
        const hw=.6+py*.55; if(py<=5&&Math.abs(dx)<hw){if(py<=1||(py<=3&&dx+py<-.8))return '#e4ecf4';return h>.85?'#2c5a4e':pk(['#1e3f3a','#24483f'],h)}
        if(py>=6&&(px===3||px===4))return '#3a2a20';
        return h>.9?'#c8d2de':pk(['#e2e8ee','#d8e0e8','#dde4ec'],h)}
      if(r2<10.5){if(dx+dy<-2.2)return swamp?'#5a7a3a':'#45a044';if(r2>7)return swamp?'#2a3a1e':'#174a1e';return h>.85?(swamp?'#4a6a30':'#2f7a33'):(swamp?'#3a5228':'#22612a')}
      if(py>=5&&(px===3||px===4))return '#5a3a20';
      return swamp?pk(['#46622f','#3d5729'],h):grass(h)}
    case SNOW:return h>.93?'#b8c2cc':h>.9?'#f0f4f8':pk(['#e2e8ee','#d8e0e8','#dde4ec'],h);
    case ICE:return ((px*2+py*3+tx*5+ty*7)%13===0)?'#8fb8c8':((px+py*2+tx)%11===0)?'#dff6fc':pk(['#b4dce8','#aad4e2','#bde2ec'],h);
    case SWAMP:return ((px+py*2+tx*3)%9===0)?'#5a8a6a':pk(['#2f5a4a','#2a5242','#335f4e'],h);
    case MUD:return h>.9?'#6e6a3e':pk(['#5b5a34','#545330','#4f4e2c'],h);
    case SGRASS:return (h>.86&&py<6)?'#7a9a46':pk(['#46622f','#3d5729','#42602c'],h);
    case ROCK:return h>.92?'#8a807a':pk(['#6e6460','#655c58','#5f5652'],h);
    case PEAK:{const top=1+Math.abs(px-3.5)*1.7;if(py>=top){if(py<top+1.3&&top<3.2)return '#e8e8f0';return px<3.5?'#9a908a':'#5a524e'}
      return pk(['#6e6460','#655c58'],h)}
    case LAVA:return h<.18?'#ffd04a':h<.55?'#f07a22':'#c8401a';
    case ROAD:return h>.9?'#c4a878':pk(['#a88c5c','#9f8455','#a68a58'],h);
    case FLOOR:return (px===0||py===0)?'#6a6a76':pk(['#8e8e9a','#86868f','#92929c'],h);
    case WALL:return (py%4===0||(px+(py>>2)*4)%8===0)?'#2e2a34':pk(['#5a5462','#544e5c'],h);
    case RIVER:return ((px*3+py+ty*5)%11===0)?'#8ab8f0':pk(['#2e5fb0','#3468b8','#3a70c4'],h);
    case BRIDGE:return (py===0||py===7)?'#4a2a14':(px%3===0)?'#6a4426':'#8a5a32';
  }return '#000'}
{const img=tctx.createImageData(W*T,H*T),d=img.data;
  for(let ty=0;ty<H;ty++)for(let tx=0;tx<W;tx++){const t=tiles[I(tx,ty)];
    for(let py=0;py<T;py++)for(let px=0;px<T;px++){const c=rgb(texel(t,tx,ty,px,py)),o=((ty*T+py)*W*T+tx*T+px)*4;d[o]=c[0];d[o+1]=c[1];d[o+2]=c[2];d[o+3]=255}}
  tctx.putImageData(img,0,0);
  for(const c of CITY){const f=FAC[c.fac],dy=c.dy*T;
    const bld=(x,y,roof,wall,sign)=>{tctx.fillStyle=roof;tctx.fillRect(x,y,24,7);tctx.fillStyle='#0008';tctx.fillRect(x,y+6,24,1);
      tctx.fillStyle=wall;tctx.fillRect(x+1,y+7,22,9);tctx.fillStyle='#3a2414';tctx.fillRect(x+10,y+10,4,6);
      tctx.fillStyle='#9ad0ff';tctx.fillRect(x+4,y+9,3,3);tctx.fillRect(x+17,y+9,3,3);
      if(sign){tctx.fillStyle=sign;tctx.fillRect(x+9,y+2,6,3)}};
    bld(32,24+dy,f.dark,'#c8b890','#f2c14e');bld(64,24+dy,'#6a4a3a','#b8a888');
    for(const gy of [5,8]){tctx.fillStyle='#3a2a1a';tctx.fillRect(12*T+3,gy*T+dy-6,1,10);tctx.fillStyle=f.color;tctx.fillRect(12*T+4,gy*T+dy-6,4,4)}
    tctx.fillStyle='#5a5a66';for(let i=0;i<3;i++)tctx.fillRect(4*T+i*6,8*T+dy+2,3,4);
  }
  const x=43*T,y=41*T;tctx.fillStyle='#4a4652';tctx.fillRect(x+3,y+1,18,15);tctx.fillStyle='#78748a';tctx.fillRect(x+3,y+1,18,2);tctx.fillRect(x+3,y+1,2,15);tctx.fillRect(x+19,y+1,2,15);
  tctx.fillStyle='#0a0810';tctx.fillRect(x+8,y+6,8,10);tctx.fillStyle='#7ad0a0';tctx.fillRect(x+11,y+4,2,1);tctx.fillStyle='#e8e4d8';tctx.fillRect(x+6,y+14,2,2);tctx.fillRect(x+16,y+14,2,2);
}

/* ---------- sprites ---------- */
const sprCache={};
function sprite(key,rows,map){if(sprCache[key])return sprCache[key];const w=Math.max(...rows.map(r=>r.length)),h=rows.length;
  const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');
  rows.forEach((r,j)=>[...r].forEach((ch,i)=>{if(ch!=='.'&&map[ch]){x.fillStyle=map[ch];x.fillRect(i,j,1,1)}}));return sprCache[key]=c}
const SPR={
  wolf:["....GG","GGGGGE","GGGGG.","G.G.G."],
  boar:[".BBBB.","BBBBBT","BBBBBB",".D..D."],
  spider:["L.LL.L",".KKKK.","LKEEKL","L.LL.L"],
  bog:[".GGG.","GEGEG","GGGGG","FGGGF",".G.G."],
  golem:[".RRRR.","RREERR","RRRRRR","R.RR.R","..RR..",".R..R."],
  drake:["W....WW","WW..WWE","RRRRRR.",".RRRR..",".R..R.."],
  shaghorn:["....H.H","BBBBBBB","BBBBBEB","SBBBBBS","S.S.S.S"],
  wight:[".WWW.",".EWE.","WWWWW",".WWW.","M.W.M","..M.."],
  boss:["W............W","WW..........WW","WWW..RRRR..WWW",".WWWRRRRRRWWW.","...RRERRERR...","..RRRRRRRRRR..","..RRTTTTTTRR..","...RR....RR...","..DD......DD.."],
  npc:[".HHH.",".SSS.","RRRRR",".RRR.",".RRR.",".R.R."]
};
const MOBS={
  wolf:{name:'Timber Wolf',pl:'Timber Wolves',z:0,lv:[1,3],spr:'wolf',col:{G:'#9a9aa8',E:'#e04040'},loot:'Wolf Pelt',q:'Wolves at the Gate'},
  boar:{name:'Bristleback Boar',pl:'Bristleback Boars',z:0,lv:[2,5],spr:'boar',col:{B:'#7a4a2a',T:'#f0ead0',D:'#3a2418'},loot:'Boar Tusk',q:'Tusks for the Tanner'},
  spider:{name:'Webspinner',pl:'Webspinners',z:0,lv:[3,6],spr:'spider',col:{K:'#4a3450',L:'#2a1a2a',E:'#e04040'},loot:'Silk Bundle',q:'Cut the Webs'},
  bog:{name:'Bogling',pl:'Boglings',z:1,lv:[6,9],spr:'bog',col:{G:'#5aa060',E:'#f0f0a0',F:'#2a6a40'},loot:'Fen Moss',q:'Trouble in the Fen'},
  mudboar:{name:'Mudback Boar',pl:'Mudback Boars',z:1,lv:[7,10],spr:'boar',col:{B:'#5e5a30',T:'#e8e0c0',D:'#2a2814'},loot:'Thick Hide',q:'Hides for Winter'},
  lurker:{name:'Fen Lurker',pl:'Fen Lurkers',z:1,lv:[8,11],spr:'spider',col:{K:'#2f6a42',L:'#1e3a26',E:'#f0e040'},loot:'Venom Sac',q:'Venom for the Apothecary'},
  golem:{name:'Cinder Golem',pl:'Cinder Golems',z:2,lv:[11,15],spr:'golem',col:{R:'#7a6a62',E:'#ff8a2a'},loot:'Ember Core',q:'Heart of the Mountain'},
  drake:{name:'Ash Drake',pl:'Ash Drakes',z:2,lv:[13,17],spr:'drake',col:{R:'#a83a2a',W:'#d86a3a',E:'#ffe060'},loot:'Cinder Scale',q:'Ash on the Wind'},
  rimehound:{name:'Rimehound',pl:'Rimehounds',z:3,lv:[15,18],spr:'wolf',col:{G:'#6e86a0',E:'#9af0ff'},loot:'Rime Pelt',q:'Howls on the Snowfield'},
  shaghorn:{name:'Tundra Shaghorn',pl:'Tundra Shaghorns',z:3,lv:[16,19],spr:'shaghorn',col:{B:'#5a4634',S:'#3a2c20',H:'#e8dcc0',E:'#ffd040'},loot:'Hoar Wool',q:'Wool for the Weavers'},
  wight:{name:'Tarn Wight',pl:'Tarn Wights',z:3,lv:[18,21],spr:'wight',col:{W:'#7d94ad',E:'#9af8ff',M:'#4a7a96'},loot:'Wight Marrow',q:'What the Tarn Keeps'},
};
const EPICS=[["Fang of the Old Wood","Thornheart Longbow","Bramblecrown"],["Mosswoven Cloak","Bogwalker Boots","Fenlight Lantern"],["Ember-Forged Greatsword","Cinderscale Mantle","Magma-Tempered Gauntlets"],["Rime-Etched Warpick","Shaghorn Greatcloak","Icevein Diadem"]];
const BOSS_EPICS=["Kragmaw's Molten Eye","Wyrmbone Crown","Cinder Wyrm Fang","Mantle of the Ashen King"];
const GOODS={};
[['Grave Dust',18],['Wolf Pelt',4],['Boar Tusk',5],['Silk Bundle',7],['Fen Moss',9],['Thick Hide',11],['Venom Sac',14],['Ember Core',22],['Cinder Scale',26],['Rime Pelt',30],['Hoar Wool',34],['Wight Marrow',40]]
  .forEach(([n,b])=>GOODS[n]={base:b,supply:ri(2,14),prev:0});
const price=n=>{const g=GOODS[n];return Math.max(1,Math.round(g.base*clamp(1.5-g.supply*.035,.35,1.8)))};
for(const n in GOODS)GOODS[n].prev=price(n);

const CLS={
  Warrior:{hp:62,atk:7,range:1.1,acc:'#c0c4d4',head:'#8a8e9c',wep:'#d8dce8',arm:.8},
  Mage:{hp:40,atk:10,range:3.2,acc:'#6fc3ff',head:'#3a5ab8',wep:'#8a5a32',orb:'#8ad8ff'},
  Hunter:{hp:48,atk:8,range:3.5,acc:'#7dbb4a',head:'#4e6e2c',wep:'#8a5a2a'},
  Priest:{hp:46,atk:6,range:2.6,acc:'#f0ecd8',head:'#e8e0c0',wep:'#f0e6b0',orb:'#ffe68a',heal:true},
  Rogue:{hp:50,atk:8,range:1.1,acc:'#e6d24a',head:'#2e2a30',wep:'#c8c8d0',crit:.25},
};
const CLSN=Object.keys(CLS);
function heroSprite(a,ghost){
  const key='h'+a.fac+a.cls+a.skin+(ghost?'g':'');if(sprCache[key])return sprCache[key];
  const rows=[".HHH..",".SSS..","ABBBA.","SBBBS.",".BBB..",".L.L.."].map(r=>r.split(''));
  const w={Warrior:[1,2,3,4],Mage:[1,2,3,4,5],Hunter:[1,2,3,4],Priest:[1,2,3,4,5],Rogue:[3,4]}[a.cls];
  w.forEach(r=>rows[r][5]='W');if(CLS[a.cls].orb)rows[0][5]='O';
  const c=CLS[a.cls],f=FAC[a.fac];
  const map=ghost?{H:'#d8ecff',S:'#d8ecff',A:'#b8d4f4',B:'#a8c8f0',L:'#88a8d0',W:'#c8e0ff',O:'#ffffff'}
    :{H:c.head,S:a.skin,A:c.acc,B:f.color,L:'#3a2f2a',W:c.wep,O:c.orb||c.wep};
  return sprite(key,rows.map(r=>r.join('')),map)}

/* ---------- entities ---------- */
const NAMES=[[['Al','Bren','Cor','Dar','El','Fen','Gal','Hal','Isa','Jor','Kae','Lor','Mir','Nor','Pell','Quin','Ros','Syl','Tor','Val','Wyn','Ari','Cae','Lys'],['a','en','ic','ion','ara','eth','wyn','dor','is','iel','ric','anne','ius','ora']],
  [['Gor','Thrak','Ur','Zug','Mog','Kar','Grim','Drak','Vor','Rok','Skar','Bru','Nar','Gash','Krul','Ozz','Rag','Vex'],['ash','gul','nok','rek','tusk','mar','dul','zar','osh','ga','ka','thar','rim','gash']]];
const used=new Set();
function genName(f){let n,k=0;do{n=pickA(NAMES[f][0])+pickA(NAMES[f][1]);if(++k>40)n+=' '+pickA(['II','III','IV','V','VI'])}while(used.has(n));used.add(n);return n}
const xpNeed=l=>Math.round(60*Math.pow(l,1.45));
const maxHp=a=>Math.round(CLS[a.cls].hp+a.lvl*14+a.gear*6+a.epics.length*10);
const atkOf=a=>CLS[a.cls].atk+a.lvl*2.4+a.gear*1.5+a.epics.length*3;
const zoneFor=l=>l<6?0:l<11?1:l<16?2:3;
const zoneAt=(x,y)=>zone[I(clamp(Math.floor(x),0,W-1),clamp(Math.floor(y),0,H-1))];
const tileAt=(x,y)=>tiles[I(clamp(Math.floor(x),0,W-1),clamp(Math.floor(y),0,H-1))];
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

const ZPTS=[[],[],[],[]];
for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const t=tiles[I(x,y)];
  if([G,TREE,FLOWER,SGRASS,MUD,ROCK,PEAK,ROAD,SNOW,ICE].indexOf(t)<0)continue;
  if(x<17&&(y<14||y>35))continue;
  if(Math.hypot(x+.5-LAIR.x,y+.5-LAIR.y)<7.5)continue;
  if(Math.hypot(x+.5-44.5,y+.5-42.5)<3.5)continue;
  ZPTS[zone[I(x,y)]].push({x:x+.5,y:y+.5})}
function zonePoint(z,near){const L=ZPTS[z];if(near){for(let i=0;i<14;i++){const p=pickA(L);if(Math.hypot(p.x-near.x,p.y-near.y)<7)return{...p}}}return{...pickA(L)}}

let uid=0;
const mobs=[];
function spawnMob(type){const M=MOBS[type],p=zonePoint(M.z);const lvl=ri(M.lv[0],M.lv[1]);
  const m={id:++uid,kind:'mob',type,lvl,x:p.x,y:p.y,home:{...p},maxhp:25+lvl*16,alive:true,respawn:0,target:null,cd:0,face:1,wait:rnd()*3,dest:null,scan:rnd()};
  m.hp=m.maxhp;mobs.push(m)}
const COUNTS={wolf:11,boar:10,spider:9,bog:10,mudboar:9,lurker:9,golem:11,drake:10,rimehound:9,shaghorn:8,wight:8};
for(const t in COUNTS)for(let i=0;i<COUNTS[t];i++)spawnMob(t);

const agents=[];
const GUILDS=[{name:'Silver Vow',tag:'SV',fac:0},{name:'Dawnriders',tag:'DR',fac:0},{name:'Bloodfang',tag:'BF',fac:1},{name:'Ashen Fist',tag:'AF',fac:1}]
  .map(g=>({...g,clears:0,wipes:0,bosses:0}));
const DG_EPICS=["Vesk's Phylactery Shard","Drowned King's Signet","Cryptbound Greaves","Staff of Still Water"];
function newQuest(a){const z=zoneFor(a.lvl);const opts=Object.keys(MOBS).filter(k=>MOBS[k].z===z&&MOBS[k].lv[0]<=a.lvl+2);
  const type=pickA(opts.length?opts:Object.keys(MOBS).filter(k=>MOBS[k].z===z));a.quest={type,need:ri(5,8),have:0}}
function makeHero(f,cls,guild,wait){
  const a={id:++uid,kind:'hero',name:genName(f),fac:f,cls,lvl:1,xp:0,gear:0,gold:ri(2,6),
    bag:[],kills:0,deaths:0,honor:0,epics:[],skin:pickA(FAC[f].skin),x:0,y:0,state:'town',townStep:1,
    wait,face:1,cd:0,healCd:0,scan:0,quest:null,target:null,dest:null,zone:0,moving:false,guild,nemesis:{},hidden:false,spotCd:0};
  newQuest(a);a.hp=maxHp(a);
  const c=CITY[f];a.x=c.x0+2+rnd()*7;a.y=c.y0+4+rnd()*3;
  agents.push(a);return a}
for(let f=0;f<2;f++)for(let i=0;i<14;i++)makeHero(f,CLSN[i%5],GUILDS[f*2+(i%2)],i*.6+rnd()*1.5);

const boss={kind:'boss',name:'Kragmaw',x:LAIR.x,y:LAIR.y+.6,lvl:18,maxhp:9000,hp:9000,alive:true,respawn:0,cd:0,breath:7,dmg:[0,0],face:-1};
const facStats=[{honor:0,bosses:0,fallen:0},{honor:0,bosses:0,fallen:0}];
const raidOn=[false,false];

/* ---------- chronicle ---------- */
let gameMin=15*60;
const clockStr=()=>{const m=Math.floor(gameMin)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')};
const logEl=document.getElementById('log');
function log(...parts){
  const li=document.createElement('li');const t=document.createElement('time');t.textContent=clockStr();li.append(t);
  for(const p of parts){if(typeof p==='string')li.append(p);else{const s=document.createElement('span');
    if(p.kind==='hero'){s.className='f'+p.fac;s.textContent=p.name}else{s.className=p.c||'';s.textContent=p.t}li.append(s)}}
  logEl.prepend(li);while(logEl.children.length>90)logEl.lastChild.remove()}
const gold=t=>({t,c:'gd'}),epic=t=>({t:'['+t+']',c:'ep'}),fac=f=>({t:'the '+FAC[f].name,c:'f'+f});

/* ---------- effects ---------- */
const fx=[];
const pop=(x,y,txt,col)=>fx.push({type:'txt',x:x+(rnd()-.5)*.4,y:y-1,txt,col,life:1});
const bolt=(a,b,col)=>fx.push({type:'bolt',x0:a.x,y0:a.y-.5,x1:b.x,y1:b.y-.4,col,life:.25});

/* ---------- simulation ---------- */
function moveTo(e,x,y,dt,sp){const dx=x-e.x,dy=y-e.y,d=Math.hypot(dx,dy);if(d<.12){e.moving=false;return true}
  const st=sp*SPEED[tileAt(e.x,e.y)]*dt;e.moving=true;if(Math.abs(dx)>.05)e.face=dx>0?1:-1;
  if(st>=d){e.x=x;e.y=y;e.moving=false;return true}e.x+=dx/d*st;e.y+=dy/d*st;return false}

function gainXp(a,x){if(a.lvl>=20)return;a.xp+=Math.round(x);
  while(a.lvl<20&&a.xp>=xpNeed(a.lvl)){a.xp-=xpNeed(a.lvl);a.lvl++;a.hp=maxHp(a);pop(a.x,a.y-.5,'LEVEL UP','#f2c14e');
    if(a.lvl%5===0||a.lvl>=15)log(a,' reached level ',gold(String(a.lvl)),a.lvl===20?'. The first steps of a legend.':'.');}
  if(a.lvl>=20)a.xp=0}

function getEpic(a,name,src){a.epics.push(name);pop(a.x,a.y,'EPIC!','#c58cff');log(a,' looted ',epic(name),' from ',src,'.')}

function killMob(a,m){m.alive=false;m.respawn=22+rnd()*20;m.target=null;a.kills++;
  const diff=m.lvl-a.lvl;gainXp(a,(8+m.lvl*6)*(diff<-4?.3:diff>2?1.3:1));
  const M=MOBS[m.type];if(rnd()<.72)a.bag.push(M.loot);a.gold+=Math.max(1,Math.round(m.lvl*.6*rnd()));
  if(rnd()<.006)getEpic(a,pickA(EPICS[M.z]),'a '+M.name);
  if(a.quest&&a.quest.type===m.type&&a.quest.have<a.quest.need)a.quest.have++;
  a.target=null;a.state='hunt'}

const fallen=[],recruits=[];
function fall(a,cause){
  a.deaths++;a.state='dead';a.cause=cause;a.diedAt=clockStr();a.hp=0;a.target=null;a.raid=false;a.moving=false;a.hidden=false;a.dest=null;
  for(const m of mobs)if(m.target===a)m.target=null;
  facStats[a.fac].fallen++;
  fallen.unshift({name:a.name,fac:a.fac,lvl:a.lvl,cls:a.cls,cause,t:a.diedAt});if(fallen.length>15)fallen.pop();
  recruits.push({fac:a.fac,guild:a.guild,cls:a.cls,t:8+rnd()*8});
  const graves=agents.filter(x=>x.state==='dead');
  if(graves.length>40){const old=graves.find(x=>x!==sel);agents.splice(agents.indexOf(old),1)}}
function agentDie(a,killer){
  const lv={t:'(level '+a.lvl+')',c:'dm'};
  if(killer.kind==='hero'){killer.honor++;facStats[killer.fac].honor++;const g=Math.floor(a.gold*.1);a.gold-=g;killer.gold+=g;
    killer.state=killer.raid?'raid':'hunt';killer.target=null;gainXp(killer,40+a.lvl*8);
    if(killer.nemesis[a.id]){log(killer,' avenged ',{t:killer.nemesis[a.id],c:'f'+killer.fac},' by slaying ',a,' ',lv,'.');delete killer.nemesis[a.id]}
    else log(killer,' killed ',a,' ',lv,' in ',ZONES[zoneAt(a.x,a.y)],'.');
    const mates=agents.filter(x=>x!==a&&x.state!=='dead'&&x.guild===a.guild);
    mates.forEach(x=>x.nemesis[killer.id]=a.name);
    if(mates.length&&a.lvl>=4)log({t:'<'+a.guild.tag+'> '+a.guild.name,c:'f'+a.fac},' swears vengeance on ',killer,'.');
    fall(a,'slain by '+killer.name);}
  else if(killer.kind==='boss'){log(a,' ',lv,' was incinerated by ',{t:'Kragmaw',c:'gd'},'.');fall(a,'incinerated by Kragmaw')}
  else{const n=MOBS[killer.type].name;log(a,' ',lv,' fell to a ',n,'.');fall(a,'slain by a '+n)}}

function strike(a,t){
  const c=CLS[a.cls];let d=atkOf(a)*(.8+rnd()*.4);const crit=rnd()<(c.crit||.08);if(crit)d*=1.8;
  if(t.kind==='hero')d*=.6*(CLS[t.cls].arm||1);
  d=Math.round(d);t.hp-=d;if(c.range>2)bolt(a,t,c.orb||c.acc);
  pop(t.x,t.y-.6,crit?d+'!':String(d),crit?'#ffe060':'#ffffff');
  if(t.kind==='boss'){boss.dmg[a.fac]+=d;return}
  if(t.hp<=0){if(t.kind==='mob')killMob(a,t);else agentDie(t,a)}}

function priestHeal(a,list){if(!CLS[a.cls].heal||a.healCd>0)return;let low=null;
  for(const b of list){if(b.state==='ghost'||dist(a,b)>4)continue;if(b.hp<maxHp(b)*.55&&(!low||b.hp/maxHp(b)<low.hp/maxHp(low)))low=b}
  if(low){const h=Math.round(20+a.lvl*5);low.hp=Math.min(maxHp(low),low.hp+h);pop(low.x,low.y-.6,'+'+h,'#7dce5a');a.healCd=3.5}}

function goHome(a){a.state='return';a.target=null;a.dest=null}

function sellAndShop(a){const c=CITY[a.fac];let tot=0,n=0;
  for(const it of a.bag){if(GOODS[it]){tot+=price(it);GOODS[it].supply++;n++}}a.bag=[];a.gold+=tot;
  if(n>=6&&rnd()<.35)log(a,' sold ',String(n),' goods at the ',c.name,' auction house for ',gold(tot+'g'),'.');
  const cost=Math.round(18*Math.pow(a.gear+1,1.55));
  if(a.gold>=cost&&a.gear<a.lvl+2){a.gold-=cost;a.gear++;a.hp=maxHp(a);if(a.gear%3===0)log(a,' bought new gear (gear score ',String(a.gear),') for ',gold(cost+'g'),'.')}}

function turnIn(a){if(a.quest&&a.quest.have>=a.quest.need){const M=MOBS[a.quest.type];gainXp(a,xpNeed(a.lvl)*.25);const g=4+a.lvl*3;a.gold+=g;
  if(rnd()<.4)log(a,' completed ',{t:'“'+M.q+'”',c:'gd'},' for ',gold(g+'g'),'.');a.quest=null}
  if(!a.quest||MOBS[a.quest.type].z!==zoneFor(a.lvl))newQuest(a)}

function findMob(a){let best=null,bs=1e9;
  for(const m of mobs){if(!m.alive||(m.target&&m.target!==a)||MOBS[m.type].z!==a.zone||m.lvl>a.lvl+1)continue;
    const d=dist(a,m);if(d>9)continue;const s=d-(a.quest&&a.quest.type===m.type?4:0);if(s<bs){bs=s;best=m}}return best}

function updAgent(a,dt){
  a.cd-=dt;a.healCd-=dt;const mh=maxHp(a),c=CITY[a.fac];
  switch(a.state){
  case 'town':{a.hp=Math.min(mh,a.hp+mh*.3*dt);const sp=[c.ah,c.qg,c.gate][a.townStep];
    if(moveTo(a,sp.x,sp.y,dt,2.2)){a.wait-=dt;if(a.wait>0)break;
      if(a.townStep===0){sellAndShop(a);a.townStep=1;a.wait=1+rnd()*1.5}
      else if(a.townStep===1){turnIn(a);a.townStep=2;a.wait=.2}
      else{a.zone=zoneFor(a.lvl);a.state='travel';a.dest=zonePoint(a.zone)}}break}
  case 'travel':
    if(zoneAt(a.x,a.y)===a.zone&&a.zone>0&&rnd()<dt*.5){a.state='hunt';a.dest=null;break}
    if(moveTo(a,a.dest.x,a.dest.y,dt,2.4)){a.state='hunt';a.dest=null}break;
  case 'hunt':{a.hp=Math.min(mh,a.hp+mh*.025*dt);
    if(a.hp<mh*.45||a.bag.length>=8||(a.quest&&a.quest.have>=a.quest.need)){goHome(a);break}
    a.scan-=dt;if(a.scan<=0){a.scan=.4+rnd()*.3;const m=findMob(a);if(m){a.target=m;a.state='fight';a.dest=null;break}}
    if(!a.dest)a.dest=zonePoint(a.zone,a);if(moveTo(a,a.dest.x,a.dest.y,dt,1.8))a.dest=null;break}
  case 'fight':{const m=a.target;if(!m||!m.alive){a.state='hunt';a.target=null;break}
    const r=CLS[a.cls].range,d=dist(a,m);a.face=m.x>a.x?1:-1;
    if(d>r){moveTo(a,m.x,m.y,dt,2.4);break}a.moving=false;
    if(!m.target)m.target=a;
    priestHeal(a,[a]);
    if(a.cd<=0){strike(a,m);a.cd=1.1}
    if(a.state==='fight'&&a.hp<mh*.22&&rnd()<dt*1.2){m.target=null;goHome(a);pop(a.x,a.y-.8,'FLEE','#ffb060')}
    break}
  case 'return':if(moveTo(a,c.gate.x,c.gate.y,dt,2.4)){a.state='town';a.townStep=0;a.wait=.5}break;
  case 'ghost':if(moveTo(a,c.grave.x,c.grave.y,dt,4)){a.state='town';a.hp=mh*.5;a.townStep=0;a.wait=2;pop(a.x,a.y-.6,'REVIVED','#9ad0ff')}break;
  case 'duel':{const b=a.target;if(!b||b.state!=='duel'||b.target!==a){a.state='hunt';a.target=null;break}
    const r=CLS[a.cls].range,d=dist(a,b);a.face=b.x>a.x?1:-1;
    if(d>r){moveTo(a,b.x,b.y,dt,2.4);break}a.moving=false;priestHeal(a,[a]);
    if(a.cd<=0){strike(a,b);a.cd=1.1}
    if(a.state==='duel'&&a.hp<mh*.2&&rnd()<dt*.5){b.state='hunt';b.target=null;goHome(a);
      if(rnd()<.5)log(a,' fled from ',b,' in ',ZONES[zoneAt(a.x,a.y)],'.')}
    break}
  case 'assist':{const b=a.target;if(!b||b.state!=='duel'){a.state='hunt';a.target=null;break}
    const r=CLS[a.cls].range,d=dist(a,b);a.face=b.x>a.x?1:-1;if(d>r){moveTo(a,b.x,b.y,dt,2.8);break}a.moving=false;
    if(a.cd<=0){strike(a,b);a.cd=1.1}break}
  case 'dungeon':{if(a.hidden)break;a.hp=Math.min(mh,a.hp+mh*.03*dt);const k=a.dgIdx;
    moveTo(a,CRYPT.x+(k%3-1)*.9,CRYPT.y+.6+Math.floor(k/3)*.7,dt,2.6);break}
  case 'raid':{if(!boss.alive){a.raid=false;goHome(a);break}
    const idx=a.raidIdx,ang=Math.PI*(.55+idx*.18),rr=Math.min(CLS[a.cls].range+.9,3.2);
    const px=boss.x+Math.cos(ang)*rr*-1,py=boss.y-.3+Math.sin(ang)*rr*(idx%2?1:-1)*.8;
    if(dist(a,boss)>rr+.6){moveTo(a,px,py,dt,2.4);break}a.moving=false;a.face=boss.x>a.x?1:-1;
    priestHeal(a,agents.filter(b=>b.raid&&b.fac===a.fac));
    if(a.cd<=0){strike(a,boss);a.cd=1.1}break}
  }}

function updMob(m,dt){
  if(!m.alive){m.respawn-=dt;if(m.respawn<=0){m.alive=true;m.hp=m.maxhp;m.x=m.home.x;m.y=m.home.y;m.target=null}return}
  m.cd-=dt;const t=m.target;
  if(t){const engaged=(t.state==='fight'&&t.target===m)||(t.state==='hunt'||t.state==='travel');
    if(t.state==='ghost'||!engaged||dist(m,m.home)>10){m.target=null;m.dest={...m.home};return}
    if(t.state!=='fight'){t.state='fight';t.target=m;t.dest=null}
    const d=dist(m,t);m.face=t.x>m.x?1:-1;
    if(d>1){moveTo(m,t.x,t.y,dt,2.1);return}m.moving=false;
    if(m.cd<=0){m.cd=1.3;const dm=Math.round((3+m.lvl*2)*(.8+rnd()*.4)*(CLS[t.cls].arm||1));t.hp-=dm;pop(t.x,t.y-.6,String(dm),'#ff6a5a');
      if(t.hp<=0)agentDie(t,m)}return}
  m.hp=Math.min(m.maxhp,m.hp+m.maxhp*.1*dt);
  if(m.dest){if(moveTo(m,m.dest.x,m.dest.y,dt,.9))m.dest=null}
  else{m.wait-=dt;if(m.wait<=0){m.wait=2+rnd()*5;m.dest={x:m.home.x+(rnd()-.5)*4,y:m.home.y+(rnd()-.5)*4}}}
  m.scan-=dt;if(m.scan<=0){m.scan=.6;
    for(const a of agents){if((a.state!=='travel'&&a.state!=='hunt')||m.lvl<a.lvl-3||zoneAt(a.x,a.y)!==MOBS[m.type].z)continue; // territorial: no ambushing travellers outside the mob's own zone
      if(dist(a,m)<1.3&&rnd()<.3){m.target=a;a.state='fight';a.target=m;a.dest=null;break}}}}

function updBoss(dt){
  if(!boss.alive){boss.respawn-=dt;if(boss.respawn<=0){boss.alive=true;boss.hp=boss.maxhp;boss.dmg=[0,0];log({t:'Kragmaw',c:'gd'},' stirs again in its Cinderpass lair.')}return}
  const eng=agents.filter(a=>a.state==='raid'&&dist(a,boss)<5);
  if(!eng.length){boss.hp=Math.min(boss.maxhp,boss.hp+boss.maxhp*.08*dt);if(boss.hp>=boss.maxhp)boss.dmg=[0,0];return}
  boss.cd-=dt;boss.breath-=dt;
  if(boss.cd<=0){boss.cd=1.6;const t=pickA(eng);boss.face=t.x>boss.x?1:-1;const d=Math.round(55+rnd()*30);t.hp-=d;pop(t.x,t.y-.6,String(d),'#ff6a5a');if(t.hp<=0)agentDie(t,boss)}
  if(boss.breath<=0){boss.breath=7;fx.push({type:'ring',x:boss.x,y:boss.y-.5,life:.6});
    for(const t of eng){if(t.state!=='raid'||dist(t,boss)>4.6)continue;const d=Math.round(22+rnd()*8);t.hp-=d;pop(t.x,t.y-.6,String(d),'#ffa040');if(t.hp<=0)agentDie(t,boss)}}
  if(boss.hp<=0){boss.alive=false;boss.respawn=300;const f=boss.dmg[0]>=boss.dmg[1]?0:1;facStats[f].bosses++;
    log(fac(f),' slew ',{t:'Kragmaw the Cinder Wyrm',c:'gd'},'!');
    const gs=new Set();for(const a of agents)if(a.raid&&a.fac===f&&a.state==='raid')gs.add(a.guild);gs.forEach(g=>g.bosses++);
    for(const a of agents)if(a.raid&&a.fac===f&&a.state==='raid'){gainXp(a,400);a.gold+=40;if(rnd()<.4)getEpic(a,pickA(BOSS_EPICS),'Kragmaw')}
    for(const a of agents)if(a.raid){a.raid=false;goHome(a)}}}

let raidT=40,pvpT=0,mktT=0;
function raidCheck(dt){
  for(let f=0;f<2;f++){if(raidOn[f]&&!agents.some(a=>a.raid&&a.fac===f)){raidOn[f]=false;if(boss.alive)log('The ',fac(f),' raid on Kragmaw ended in defeat.')}}
  raidT-=dt;if(raidT>0)return;raidT=45+rnd()*30;if(!boss.alive)return;
  const f=ri(0,1);if(raidOn[f])return;
  const cand=agents.filter(a=>a.fac===f&&a.lvl>=12&&['hunt','travel','town','return'].includes(a.state)).sort((x,y)=>y.lvl-x.lvl).slice(0,6);
  if(cand.length<4)return;raidOn[f]=true;
  cand.forEach((a,i)=>{a.raid=true;a.raidIdx=i;a.state='raid';a.target=null;a.dest=null;a.hp=Math.max(a.hp,maxHp(a)*.8)});
  log(fac(f),' musters ',String(cand.length),' heroes to raid Kragmaw’s lair.')}

function pvpCheck(dt){pvpT-=dt;if(pvpT>0)return;pvpT=.5;
  const free=agents.filter(a=>(a.state==='hunt'||a.state==='travel'||a.state==='return')&&zoneAt(a.x,a.y)>=1);
  const isFree=a=>free.includes(a)&&(a.state==='hunt'||a.state==='travel'||a.state==='return');
  for(const a of free){a.spotCd-=.5;if(!isFree(a)||a.spotCd>0)continue;
    for(const id in a.nemesis){const b=agents.find(x=>x.id==id);
      if(b&&isFree(b)&&dist(a,b)<8){a.state=b.state='duel';a.target=b;b.target=a;a.dest=b.dest=null;a.spotCd=20;
        log(a,' spots ',b,', who killed ',{t:a.nemesis[id],c:'f'+a.fac},', and charges.');break}}}
  for(const a of free)for(const b of free){if(a.fac!==0||b.fac!==1||a.state==='duel'||b.state==='duel')continue;
    if(dist(a,b)<3&&Math.abs(a.lvl-b.lvl)<=5&&rnd()<.25){a.state=b.state='duel';a.target=b;b.target=a;a.dest=b.dest=null}}
  for(const a of agents){if(a.state!=='duel'||!a.target||rnd()>.35)continue;const foe=a.target;
    for(const g of free){if(!isFree(g)||g.guild!==a.guild||dist(g,a)>8)continue;
      g.state='assist';g.target=foe;g.dest=null;if(rnd()<.6)log(g,' rushes to help guildmate ',a,' against ',foe,'.');break}}}

function dungeonCheck(dt){
  const g=CRYPT.group,tagOf=(gu,f)=>gu?{t:'<'+gu.tag+'> '+gu.name,c:'f'+f}:{t:'A '+FAC[f].name+' group',c:'f'+f};
  if(!g){CRYPT.cd-=dt;if(CRYPT.cd>0)return;CRYPT.cd=20+rnd()*25;
    const f=ri(0,1);const pool=agents.filter(a=>a.fac===f&&a.lvl>=7&&!a.raid&&['hunt','travel','town','return'].includes(a.state));
    const gu=pickA(GUILDS.filter(x=>x.fac===f));
    let mem=pool.filter(a=>a.guild===gu).sort((x,y)=>y.lvl-x.lvl).slice(0,5);
    if(mem.length<5)mem=mem.concat(pool.filter(a=>!mem.includes(a)).slice(0,5-mem.length));
    if(mem.length<4)return;
    mem.forEach((a,i)=>{a.state='dungeon';a.dgIdx=i;a.target=null;a.dest=null});
    const main=mem.filter(a=>a.guild===gu).length>=3?gu:null;
    CRYPT.group={fac:f,mem,guild:main,phase:'gather',t:30};
    log(tagOf(main,f),' formed a group for ',{t:CRYPT.name,c:'gd'},'.');return}
  g.mem=g.mem.filter(a=>a.state==='dungeon');
  if(!g.mem.length){CRYPT.group=null;return}
  g.t-=dt;
  if(g.phase==='gather'){const here=g.mem.filter(a=>dist(a,CRYPT)<2.4);
    if(here.length===g.mem.length||(g.t<=0&&here.length>=3)){g.mem.filter(a=>!here.includes(a)).forEach(a=>{a.state='hunt'});g.mem=here;
      here.forEach(a=>{a.hidden=true;a.x=CRYPT.x;a.y=CRYPT.y;a.moving=false});g.phase='inside';g.t=30+rnd()*20}
    else if(g.t<=0){g.mem.forEach(a=>a.state='hunt');CRYPT.group=null}return}
  if(g.t>0)return;
  const n=g.mem.length,avg=g.mem.reduce((t,a)=>t+a.lvl+a.gear*.3,0)/n;
  const pw=avg+(g.mem.some(a=>a.cls==='Priest')?2.5:0)+(g.mem.some(a=>a.cls==='Warrior')?1.5:0)+n*.6;
  const ok=rnd()<clamp((pw-8)/8,.15,.92),who=tagOf(g.guild,g.fac);
  for(const a of g.mem){a.hidden=false;a.x=CRYPT.x+(rnd()-.5)*1.5;a.y=CRYPT.y+.5+rnd()*.6}
  if(ok){if(g.guild)g.guild.clears++;log(who,' cleared ',{t:CRYPT.name,c:'gd'},' and destroyed ',{t:CRYPT.boss,c:'gd'},'!');
    for(const a of g.mem){gainXp(a,250+a.lvl*20);a.gold+=25+ri(0,20);a.kills+=ri(8,14);for(let k=0;k<3;k++)a.bag.push('Grave Dust');
      if(rnd()<.25)getEpic(a,pickA(DG_EPICS),CRYPT.boss);goHome(a)}}
  else{if(g.guild)g.guild.wipes++;const lost=[];
    for(const a of g.mem){if(rnd()<.6){lost.push(a);fall(a,'lost in '+CRYPT.name)}else goHome(a)}
    const parts=[who,' wiped in ',{t:CRYPT.name,c:'gd'},'.'];
    if(lost.length){parts.push(' Lost forever: ');lost.forEach((a,i)=>{parts.push(a);if(i<lost.length-1)parts.push(', ')});parts.push('.')}
    else parts.push(' Everyone escaped.');log(...parts)}
  CRYPT.group=null}

function updMarket(dt){for(const n in GOODS)GOODS[n].supply*=1-.025*dt;mktT-=dt;if(mktT<=0){mktT=12;renderAH();for(const n in GOODS)GOODS[n].prev=price(n)}}

function step(dt){gameMin+=dt*6;globalThis.__eldmoor={agents,mobs,boss,GUILDS,facStats,CRYPT,fallen,GOODS,get gameMin(){return gameMin}};
  for(let i=recruits.length-1;i>=0;i--){const r=recruits[i];r.t-=dt;if(r.t>0)continue;recruits.splice(i,1);
    const a=makeHero(r.fac,r.cls,r.guild,1);if(rnd()<.5)log('A new ',r.cls.toLowerCase(),', ',a,', joins ',{t:'<'+r.guild.tag+'> '+r.guild.name,c:'f'+r.fac},' in ',CITY[r.fac].name,'.')}
  for(const a of agents)updAgent(a,dt);for(const m of mobs)updMob(m,dt);
  updBoss(dt);raidCheck(dt);pvpCheck(dt);dungeonCheck(dt);updMarket(dt);
  for(let i=fx.length-1;i>=0;i--){const p=fx[i];p.life-=dt*(p.type==='txt'?.9:1);if(p.type==='txt')p.y-=dt*1.2;if(p.life<=0)fx.splice(i,1)}}

/* ---------- rendering ---------- */
const cv=document.getElementById('cv'),ctx=cv.getContext('2d'),screenEl=document.getElementById('screen');
let dpr=1,fit=1,view='map',sel=null,camX=W*T/2,camY=H*T/2,sc=1,offX=0,offY=0;
function resize(){const r=screenEl.getBoundingClientRect();dpr=window.devicePixelRatio||1;cv.width=Math.max(1,Math.round(r.width*dpr));cv.height=Math.max(1,Math.round(r.height*dpr));fit=cv.width/(W*T)}
new ResizeObserver(resize).observe(screenEl);resize();

function darkness(){const h=(gameMin/60)%24;if(h>=21||h<5)return .55;if(h>=18)return (h-18)/3*.55;if(h<7)return (7-h)/2*.55;return 0}
const LIGHTS=[];for(const c of CITY){LIGHTS.push({x:12.5,y:5.4+c.dy},{x:12.5,y:8.4+c.dy},{x:6,y:5+c.dy},{x:10,y:5+c.dy})}
LIGHTS.push({x:LAIR.x,y:LAIR.y,big:1});

function drawText(txt,x,y,col,css){const s=css*dpr/sc;ctx.font=s+'px VT323, monospace';ctx.textAlign='center';ctx.fillStyle='#000';ctx.fillText(txt,x+s*.07,y+s*.07);ctx.fillStyle=col;ctx.fillText(txt,x,y)}

let blink=0;
function draw(){
  blink+=1/60;
  ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#000';ctx.fillRect(0,0,cv.width,cv.height);
  const follow=view==='follow'&&sel;
  sc=follow?Math.max(fit*2.6,cv.width/230):fit;
  const vw=cv.width/sc,vh=cv.height/sc;
  if(follow){camX+=(sel.x*T-camX)*.12;camY+=(sel.y*T-camY)*.12}else{camX=W*T/2;camY=H*T/2}
  const cx=clamp(camX,vw/2,W*T-vw/2),cy=clamp(camY,vh/2,H*T-vh/2);
  offX=Math.round((vw/2-cx)*sc);offY=Math.round((vh/2-cy)*sc);
  ctx.setTransform(sc,0,0,sc,offX,offY);ctx.imageSmoothingEnabled=false;
  ctx.drawImage(terrain,0,0);
  // lava shimmer
  const tt=performance.now()/400;
  ctx.fillStyle='#ffe27a';for(let i=0;i<14;i++){const a=i*2.4+tt*.3;ctx.fillRect(Math.round(LAIR.x*T+Math.cos(a)*38),Math.round(LAIR.y*T+Math.sin(a)*38),1,1)}
  const close=sc>=fit*2;
  // NPCs
  for(const c of CITY){for(const [p,col] of [[c.qg,'#7a4ab8'],[c.ah,'#b8862a']]){const s=sprite('npc'+col,SPR.npc,{H:'#d8d0c0',S:'#f0c8a0',R:col});
    ctx.drawImage(s,Math.round(p.x*T-2.5),Math.round((p.y-.15)*T-6))}
    ctx.fillStyle='#ffe040';const by=Math.round(Math.sin(blink*4))*1;ctx.fillRect(Math.round(c.qg.x*T),Math.round((c.qg.y-.15)*T-11+by),1,3);ctx.fillRect(Math.round(c.qg.x*T),Math.round((c.qg.y-.15)*T-7+by),1,1);
    ctx.fillStyle='#f2c14e';ctx.fillRect(Math.round(c.ah.x*T)-1,Math.round((c.ah.y-.15)*T-10),3,3)}
  // entities sorted by y
  const ents=[];for(const m of mobs)if(m.alive)ents.push(m);for(const a of agents)ents.push(a);if(boss.alive)ents.push(boss);
  ents.sort((a,b)=>a.y-b.y);
  for(const e of ents){if(e.hidden)continue;
    let s;if(e.kind==='mob'){const M=MOBS[e.type];s=sprite(e.type,SPR[M.spr],M.col)}
    else if(e.kind==='boss')s=sprite('boss',SPR.boss,{R:'#7a2a3a',W:'#d04a2a',E:'#ffe060',T:'#f0ead0',D:'#3a1a20'});
    else if(e.state==='dead')s=sprite('grave'+e.fac,[".GGG.","GGFGG","GFFFG","GGFGG","GGGGG","BBBBB"],{G:'#8a8a96',F:'#3a3a46',B:FAC[e.fac].dark});
    else s=heroSprite(e,e.state==='ghost');
    const bob=e.moving&&(Math.floor(blink*8+e.id)%2)?-1:0;
    const px=Math.round(e.x*T),py=Math.round(e.y*T)+bob;
    if(e.kind==='hero'&&e.state==='ghost')ctx.globalAlpha=.6;
    // shadow
    ctx.fillStyle='rgba(0,0,0,.35)';ctx.fillRect(px-Math.floor(s.width/2),Math.round(e.y*T),s.width,1);
    ctx.save();ctx.translate(px,0);if(e.face<0&&e.kind!=='hero'||e.face<0&&e.kind==='hero')ctx.scale(-1,1);
    ctx.drawImage(s,-Math.floor(s.width/2),py-s.height);ctx.restore();ctx.globalAlpha=1;
    if(e===sel){ctx.fillStyle=Math.floor(blink*3)%2?'#f2c14e':'#fff2b0';ctx.fillRect(px-1,py-s.height-4,3,1);ctx.fillRect(px,py-s.height-3,1,1)}
    if(close&&e.hp<(e.kind==='hero'?maxHp(e):e.maxhp)&&e.state!=='ghost'){const mx=e.kind==='hero'?maxHp(e):e.maxhp,w=e.kind==='boss'?14:6;
      ctx.fillStyle='#000';ctx.fillRect(px-w/2,py-s.height-2,w,1);ctx.fillStyle=e.kind==='hero'?'#3fbf4a':'#e0483e';ctx.fillRect(px-w/2,py-s.height-2,Math.max(0,w*e.hp/mx),1)}
  }
  // effects
  for(const p of fx){if(p.type==='bolt'){ctx.fillStyle=p.col;const t=1-p.life/.25;const x=(p.x0+(p.x1-p.x0)*t)*T,y=(p.y0+(p.y1-p.y0)*t)*T;ctx.fillRect(Math.round(x),Math.round(y),2,1)}
    if(p.type==='ring'){ctx.strokeStyle='rgba(255,140,40,'+p.life+')';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x*T,p.y*T,(1-p.life/.6)*36+4,0,7);ctx.stroke()}}
  // night
  const dk=darkness();if(dk>0){ctx.fillStyle='rgba(8,10,40,'+dk+')';ctx.fillRect(0,0,W*T,H*T);
    ctx.globalCompositeOperation='lighter';
    for(const L of LIGHTS){const r=L.big?46:14;const g=ctx.createRadialGradient(L.x*T,L.y*T,0,L.x*T,L.y*T,r);g.addColorStop(0,'rgba(255,170,70,'+(dk*.7)+')');g.addColorStop(1,'rgba(255,170,70,0)');ctx.fillStyle=g;ctx.fillRect(L.x*T-r,L.y*T-r,r*2,r*2)}
    ctx.globalCompositeOperation='source-over'}
  // labels
  if(!follow){
    const lab=[['THORNVALE',14,24],['MIREFEN',38,19],['CINDERPASS',63,18],['HOARFELL',52,5],['HIGHGATE',7.5,1.4],['GRIMHOLD',7.5,49.2]];
    for(const[t,x,y]of lab)drawText(t,x*T,y*T,'#f4ecd0',13);
    if(boss.alive)drawText('KRAGMAW',LAIR.x*T,(LAIR.y-3)*T,'#ffb060',12);
    drawText(CRYPT.group&&CRYPT.group.phase==='inside'?'CRYPT · '+CRYPT.group.mem.length+' INSIDE':'SUNKEN CRYPT',CRYPT.x*T,40.4*T,'#9ae0b8',12)}
  else{
    if(CRYPT.group&&CRYPT.group.phase==='inside')drawText(CRYPT.group.mem.length+' inside · '+Math.ceil(CRYPT.group.t)+'s',CRYPT.x*T,41*T-2,'#9ae0b8',14);
    for(const a of agents){if(a.hidden)continue;if(Math.abs(a.x*T-camX)>vw/2+20||Math.abs(a.y*T-camY)>vh/2+20)continue;
      const dead=a.state==='dead';drawText((dead?'† ':'')+a.name,a.x*T,a.y*T-9.5,a===sel?'#f2c14e':dead?'#9a98ac':FAC[a.fac].color,14)}
    if(boss.alive)drawText('Kragmaw · '+Math.max(0,Math.round(boss.hp/boss.maxhp*100))+'%',boss.x*T,boss.y*T-12,'#ffb060',15);
    for(const p of fx)if(p.type==='txt'){ctx.globalAlpha=Math.min(1,p.life*1.5);drawText(p.txt,p.x*T,p.y*T,p.col,15);ctx.globalAlpha=1}}
}

/* ---------- UI ---------- */
const $=id=>document.getElementById(id);
let speed=1;
document.querySelectorAll('[data-sp]').forEach(b=>b.addEventListener('click',()=>{speed=+b.dataset.sp;document.querySelectorAll('[data-sp]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)))}));
function setView(v){view=v;$('vMap').setAttribute('aria-pressed',String(v==='map'));$('vFol').setAttribute('aria-pressed',String(v==='follow'));
  $('hint').textContent=v==='map'?'Tap a hero to follow':'Following '+(sel?sel.name:'')}
$('vMap').onclick=()=>setView('map');
$('vFol').onclick=()=>{if(!sel)select(ranked()[0]);setView('follow')};
$('vNext').onclick=()=>{const r=ranked();const i=sel?r.indexOf(sel):-1;select(r[(i+1)%r.length]);setView('follow')};
function select(a){sel=a;if(a){camX=a.x*T;camY=a.y*T}renderHero();renderTops();if(view==='follow')setView('follow')}
screenEl.addEventListener('click',e=>{const r=cv.getBoundingClientRect();const wx=((e.clientX-r.left)*dpr-offX)/sc/T,wy=((e.clientY-r.top)*dpr-offY)/sc/T;
  let best=null,bd=view==='map'?2.2:1.2;for(const a of agents){if(a.hidden||a.state==='dead')continue;const d=Math.hypot(a.x-wx,a.y-.4-wy);if(d<bd){bd=d;best=a}}
  if(best){select(best);setView('follow')}});

const living=()=>agents.filter(a=>a.state!=='dead');
const ranked=()=>living().sort((a,b)=>b.lvl-a.lvl||b.xp-a.xp||b.kills-a.kills);
function doing(a){const c=CITY[a.fac].name,zn=ZONES[a.zone];
  switch(a.state){
    case 'town':return a.townStep===0?`Selling loot at the ${c} auction house`:a.townStep===1?`Checking in with the ${c} quest giver`:`Leaving ${c} for ${ZONES[zoneFor(a.lvl)]}`;
    case 'travel':return `Traveling to ${zn}`;
    case 'hunt':return a.quest?`Hunting ${MOBS[a.quest.type].pl} in ${zn}`:`Hunting in ${zn}`;
    case 'fight':return a.target?`Fighting a level ${a.target.lvl} ${MOBS[a.target.type].name}`:'Fighting';
    case 'return':return `Heading back to ${c}`;
    case 'duel':return a.target?`Fighting ${a.target.name} of the ${FAC[a.target.fac].name}`:'In a fight';
    case 'ghost':return `Dead. Running back to ${c} as a ghost`;
    case 'raid':return 'Raiding Kragmaw the Cinder Wyrm';
    case 'dead':return `Fell at level ${a.lvl}, ${a.cause}, at ${a.diedAt}. Gone forever.`;
    case 'assist':return a.target?`Helping a guildmate fight ${a.target.name}`:'Helping a guildmate';
    case 'dungeon':return a.hidden?`Inside ${CRYPT.name}, fighting toward ${CRYPT.boss}`:`Gathering a group at ${CRYPT.name}`;}return ''}
function renderHero(){const el=$('hero'),a=sel;
  if(!a){el.innerHTML='<div class="meta">Tap a hero on the map, or pick one from Top heroes.</div>';return}
  const mh=maxHp(a),q=a.quest?`${MOBS[a.quest.type].q}: ${a.quest.have}/${a.quest.need} ${MOBS[a.quest.type].pl}`:'No quest';
  el.innerHTML='';
  const add=(cls,html)=>{const d=document.createElement('div');d.className=cls;if(html instanceof Node)d.append(html);else d.textContent=html;el.append(d);return d};
  const nm=add('nm f'+a.fac,a.name);
  add('meta',`Level ${a.lvl} ${a.cls} of the ${FAC[a.fac].name} · <${a.guild.tag}> ${a.guild.name}`);
  add('doing',doing(a));
  add('dm','HP');const hp=add('meter hp','');const i1=document.createElement('i');i1.style.width=clamp(a.hp/mh*100,0,100)+'%';hp.append(i1);
  add('dm','XP');const xp=add('meter xp','');const i2=document.createElement('i');i2.style.width=(a.lvl>=20?100:a.xp/xpNeed(a.lvl)*100)+'%';xp.append(i2);
  add('meta','Quest: '+q);
  const nem=Object.entries(a.nemesis).filter(([id])=>agents.some(x=>x.id==id&&x.state!=='dead')).pop();
  if(nem){const b=agents.find(x=>x.id==nem[0]);const d=add('meta','');d.append('Nemesis: ');const s=document.createElement('span');s.className='f'+b.fac;s.textContent=b.name;d.append(s,` (killed guildmate ${nem[1]})`)}
  const st=add('stats','');[['Gold',a.gold+'g'],['Gear',a.gear],['Kills',a.kills],['Honor',a.honor]].forEach(([k,v])=>{const d=document.createElement('div');const b=document.createElement('b');b.textContent=v;const s=document.createElement('span');s.textContent=k;d.append(b,s);st.append(d)});
  if(a.epics.length){const e=add('epics','');e.append('Epics: ');a.epics.forEach((n,i)=>{const s=document.createElement('span');s.className='ep';s.textContent='['+n+']';e.append(s);if(i<a.epics.length-1)e.append(' ')})}
  else add('epics dm','No epic items yet.')}
function renderTops(){const el=$('tops');el.innerHTML='';ranked().slice(0,8).forEach((a,i)=>{const li=document.createElement('li');const b=document.createElement('button');
  if(a===sel)b.className='sel';const n=document.createElement('span');n.className='dm';n.textContent=i+1;const nm=document.createElement('span');nm.className='f'+a.fac;nm.textContent=a.name+' ';
  const cl=document.createElement('span');cl.className='dm';cl.textContent=a.cls;nm.append(cl);const lv=document.createElement('span');lv.className='lv';lv.textContent='Lv '+a.lvl;
  b.append(n,nm,lv);b.onclick=()=>{select(a);setView('follow')};li.append(b);el.append(li)})}
function renderFacs(){const el=$('facs');const rows=[['',...FAC.map((f,i)=>`<span class="h f${i}">${f.name.toUpperCase()}</span>`)]];
  const s=f=>living().filter(a=>a.fac===f);
  rows.push(['Avg level',...[0,1].map(f=>(s(f).reduce((t,a)=>t+a.lvl,0)/Math.max(1,s(f).length)).toFixed(1))]);
  rows.push(['Fallen',...[0,1].map(f=>facStats[f].fallen)]);
  rows.push(['Honor',...[0,1].map(f=>facStats[f].honor)]);
  rows.push(['Boss kills',...[0,1].map(f=>facStats[f].bosses)]);
  rows.push(['Treasury',...[0,1].map(f=>s(f).reduce((t,a)=>t+a.gold,0)+'g')]);
  rows.push(['Epics',...[0,1].map(f=>s(f).reduce((t,a)=>t+a.epics.length,0))]);
  el.innerHTML=rows.map(r=>`<div class="k">${r[0]}</div><div>${r[1]}</div><div>${r[2]}</div>`).join('')}
function renderFallen(){const el=$('fallen');if(!fallen.length){el.innerHTML='<li class="dm">No one has fallen yet.</li>';return}
  el.innerHTML='';for(const f of fallen){const li=document.createElement('li');const t=document.createElement('time');t.textContent=f.t;
    const n=document.createElement('span');n.className='f'+f.fac;n.textContent='† '+f.name;li.append(t,n,` · Lv ${f.lvl} ${f.cls}, ${f.cause}`);el.append(li)}}
const gScore=g=>{const m=living().filter(a=>a.guild===g);return Math.round(m.reduce((t,a)=>t+a.lvl+a.honor*3+a.kills/25,0)+g.clears*25+g.bosses*40)};
function renderGuilds(){$('guilds').innerHTML=GUILDS.slice().sort((x,y)=>gScore(y)-gScore(x)).map((g,i)=>
  `<tr><td><span class="dm">${i+1}</span> <span class="f${g.fac}">&lt;${g.tag}&gt; ${g.name}</span></td><td>${g.clears}/${g.clears+g.wipes}</td><td class="gd">${gScore(g)}</td></tr>`).join('')}
function renderAH(){$('ah').innerHTML=Object.keys(GOODS).map(n=>{const p=price(n),d=p-GOODS[n].prev;
  return `<tr><td>${n}</td><td class="gd">${p}g</td><td class="${d>0?'up':d<0?'down':'dm'}">${d>0?'▲'+d:d<0?'▼'+(-d):'–'}</td></tr>`}).join('')}

log('Twenty-eight new heroes of ',fac(0),' and ',fac(1),' arrive in ',{t:'Eldmoor',c:'gd'},'. Every one of them is level 1.');
log({t:'Kragmaw the Cinder Wyrm',c:'gd'},' sleeps in its lair beyond Cinderpass.');
log('Four guilds compete for glory, and ',{t:'The Sunken Crypt',c:'gd'},' waits beneath Mirefen.');
log({t:'Hardcore rules:',c:'gd'},' every hero has one life. The fallen stay fallen.');
select(ranked()[0]);renderFacs();renderAH();renderGuilds();renderFallen();

let last=performance.now(),uiT=0;
function frame(now){const real=Math.min(.1,(now-last)/1000);last=now;
  if(speed>0){let dt=real*speed;const n=Math.ceil(dt/.05);for(let i=0;i<n;i++)step(dt/n)}
  draw();uiT-=real;if(uiT<=0){uiT=.3;renderHero();const d=Math.floor(gameMin/1440)+1;$('clock').textContent=`Day ${d} · ${clockStr()}`}
  if(Math.floor(now/1000)!==Math.floor((now-real*1000)/1000)){renderTops();renderFacs();renderGuilds();renderFallen()}
  requestAnimationFrame(frame)}
requestAnimationFrame(frame);
