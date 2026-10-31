// Pixel-string sprites rendered once into cached canvases. Monster shapes
// are owned by creature-designer, the hero sprite by character-builder.
// Rows are strings; '.' is transparent, any other char indexes the palette map.
// Every SPR entry is a two-frame array [frame0, frame1]: frame 0 is the idle
// pose, frame 1 the step (or wing beat); draw.js alternates them while moving.
import {CLS} from '../data/classes.js';
import {FAC} from '../data/factions.js';

const sprCache={};
export function sprite(key,rows,map){if(sprCache[key])return sprCache[key];const w=Math.max(...rows.map(r=>r.length)),h=rows.length;
  const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');
  rows.forEach((r,j)=>[...r].forEach((ch,i)=>{if(ch!=='.'&&map[ch]){x.fillStyle=map[ch];x.fillRect(i,j,1,1)}}));return sprCache[key]=c}

export const SPR={
  // wolf / rimehound 12x8: G fur, E eye. Head right, tail left.
  wolf:[[
    "........GG.G",
    "G.......GGGG",
    "GG.GGGGGGGEG",
    ".GGGGGGGGGGG",
    ".GGGGGGGGGG.",
    "..GG...GG...",
    "..GG...GG...",
    "..G.....G..."],[
    "........GG.G",
    ".G......GGGG",
    "GG.GGGGGGGEG",
    ".GGGGGGGGGGG",
    ".GGGGGGGGGG.",
    ".GG.....GG..",
    ".G.......GG.",
    "G.........G."]],
  // boar 12x8: B hide, T tusk, D snout, hooves and eye.
  boar:[[
    "...BBBBBB...",
    "..BBBBBBBBB.",
    ".BBBBBBBBBBB",
    "BBBBBBBBBBDB",
    ".BBBBBBBBBBT",
    "..BBBBBBBBBD",
    "..DD...DD...",
    "..DD...DD..."],[
    "...BBBBBB...",
    "..BBBBBBBBB.",
    ".BBBBBBBBBBB",
    "BBBBBBBBBBDB",
    ".BBBBBBBBBBT",
    "..BBBBBBBBBD",
    ".DD.....DD..",
    "DD.......DD."]],
  // spider / fen lurker 12x8: K body, L legs, E eyes.
  spider:[[
    "L..........L",
    ".L..KKKK..L.",
    "..LKKKKKEEL.",
    "LLLKKKKKKLLL",
    "..LKKKKKKL..",
    ".L..KKKK..L.",
    "L...L..L...L",
    "....L..L...."],[
    ".L........L.",
    "L...KKKK...L",
    "..LKKKKKEEL.",
    "LLLKKKKKKLLL",
    "..LKKKKKKL..",
    "L...KKKK...L",
    ".L..L..L..L.",
    "....L..L...."]],
  // bogling 10x10: G moss hide, E eyes, F mouth and feet.
  bog:[[
    "...GGGG...",
    "..GGGGGG..",
    ".GGEGGEGG.",
    ".GGGGGGGG.",
    ".GGGFFGGG.",
    "GGGGGGGGGG",
    "GGGGGGGGGG",
    ".GGGGGGGG.",
    ".FF.GG.FF.",
    "FF......FF"],[
    "...GGGG...",
    "..GGGGGG..",
    ".GGEGGEGG.",
    ".GGGGGGGG.",
    ".GGGFFGGG.",
    "GGGGGGGGGG",
    "GGGGGGGGGG",
    ".GGGGGGGG.",
    "..FFGGFF..",
    "..FF..FF.."]],
  // cinder golem 12x14: R stone, E ember eyes.
  golem:[[
    "...RRRRRR...",
    "..RRRRRRRR..",
    "..RERRRRER..",
    "..RRRRRRRR..",
    "RRRRRRRRRRRR",
    "RRRRRRRRRRRR",
    "RR.RRRRRR.RR",
    "RR.RRRRRR.RR",
    "RR..RRRR..RR",
    "....RRRR....",
    "...RRRRRR...",
    "...RRR.RRR..",
    "..RRR...RRR.",
    "..RRR...RRR."],[
    "...RRRRRR...",
    "..RRRRRRRR..",
    "..RERRRRER..",
    "..RRRRRRRR..",
    "RRRRRRRRRRRR",
    "RRRRRRRRRRRR",
    "RRRRRRRRR.RR",
    "RR.RRRRRR.RR",
    "RR..RRRR..RR",
    "RR..RRRR....",
    "...RRRRRR...",
    "...RRR.RRR..",
    "..RRR....RRR",
    ".RRR.....RRR"]],
  // ash drake 16x12: R scales, W wings, E eye. Wings up / wings down.
  drake:[[
    "WW...........WW.",
    ".WWW.......WWW..",
    "..WWWW...WWWW...",
    "...WWWWWWWWW....",
    "....RRRRRRR.RRR.",
    "..RRRRRRRRRRRERR",
    ".RRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRR...",
    "RR..RRRRRRR.....",
    ".....RR..RR.....",
    "....RR....RR....",
    "....RR....RR...."],[
    "................",
    "................",
    "................",
    "...WWWWWWWWW....",
    "..WWRRRRRRRWRRR.",
    ".WWRRRRRRRRRRERR",
    "WWRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRR...",
    "RR..RRRRRRR.....",
    ".....RR..RR.....",
    "....RR....RR....",
    "....RR....RR...."]],
  // tundra shaghorn 16x12: B shag coat, S dark legs and skirt, H horns, E eye.
  shaghorn:[[
    "..........H...H.",
    "..........HH.HH.",
    "...........BBB..",
    ".BBBBBBBBBBBBEB.",
    "BBBBBBBBBBBBBBB.",
    "BBBBBBBBBBBBBBB.",
    "SBSBBBBBSBBBBSB.",
    "SBSBBBBBSBBBBS..",
    ".SSSSSSSSSSSS...",
    ".SS..SS..SS..SS.",
    ".SS..SS..SS..SS.",
    ".SS..SS..SS..SS."],[
    "..........H...H.",
    "..........HH.HH.",
    "...........BBB..",
    ".BBBBBBBBBBBBEB.",
    "BBBBBBBBBBBBBBB.",
    "BBBBBBBBBBBBBBB.",
    "SBSBBBBBSBBBBSB.",
    "SBSBBBBBSBBBBS..",
    ".SSSSSSSSSSSS...",
    "SS...SS..SS...SS",
    "SS...SS..SS...SS",
    "SS...SS..SS...SS"]],
  // tarn wight 10x14: W shroud, E eyes, M mist tatters.
  wight:[[
    "...WWWW...",
    "..WWWWWW..",
    "..WEWWEW..",
    "..WWWWWW..",
    "...WWWW...",
    ".WWWWWWWW.",
    "WWWWWWWWWW",
    "W.WWWWWW.W",
    "..WWWWWW..",
    "..WWWWWW..",
    ".MWWWWWWM.",
    ".M.WWWW.M.",
    "...M.WM...",
    "..M...M..."],[
    "...WWWW...",
    "..WWWWWW..",
    "..WEWWEW..",
    "..WWWWWW..",
    "...WWWW...",
    ".WWWWWWWW.",
    "WWWWWWWWWW",
    "W.WWWWWW.W",
    "..WWWWWW..",
    "..WWWWWW..",
    ".MWWWWWWM.",
    "..MWWWWM..",
    "..M.WM.M..",
    "...M..M..."]],
  // Kragmaw 32x22: R hide, W wing membranes, E eyes, T teeth, D claws. Wings up / wings down.
  boss:[[
    "W..............................W",
    "WW............................WW",
    "WWW..........................WWW",
    "WWWW........................WWWW",
    ".WWWWW....................WWWWW.",
    ".WWWWWW..................WWWWWW.",
    "..WWWWWWW..............WWWWWWW..",
    "..WWWWWWWWW..RRRRRR..WWWWWWWWW..",
    "...WWWWWWWWRRRRRRRRRRWWWWWWWW...",
    "....WWWWWRRRRRRRRRRRRRRWWWWW....",
    ".....WWRRRRRRERRRRERRRRRRWW.....",
    ".....RRRRRRRRRRRRRRRRRRRRRR.....",
    "....RRRRRRRRRRRRRRRRRRRRRRRR....",
    "...RRRRRRRTTTTTTTTTTTTRRRRRRR...",
    "...RRRRRRRRRRRRRRRRRRRRRRRRRR...",
    "....RRRRRRRRRRRRRRRRRRRRRRRR....",
    ".....RRRRRRRRRRRRRRRRRRRRRR.....",
    "......RRRR..RRRRRRRR..RRRR......",
    ".......RRR...RRRRRR...RRR.......",
    "......DDDD...RRRRRR...DDDD......",
    ".....DD.DD...DRRRRD...DD.DD.....",
    "....D...D.....DDDD.....D...D...."],[
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "WW............................WW",
    "WWWW........................WWWW",
    "WWWWWW.......RRRRRR.......WWWWWW",
    ".WWWWWWWW..RRRRRRRRRR..WWWWWWWW.",
    "..WWWWWWWWRRRRRRRRRRRRWWWWWWWW..",
    "...WWWWWWRRRRRERRRRERRRRWWWWWW..",
    "....WWWWRRRRRRRRRRRRRRRRWWWW....",
    "....RRRRRRRRRRRRRRRRRRRRRRRR....",
    "...RRRRRRRTTTTTTTTTTTTRRRRRRR...",
    "...RRRRRRRRRRRRRRRRRRRRRRRRRR...",
    "....RRRRRRRRRRRRRRRRRRRRRRRR....",
    ".....RRRRRRRRRRRRRRRRRRRRRR.....",
    "......RRRR..RRRRRRRR..RRRR......",
    ".......RRR...RRRRRR...RRR.......",
    "......DDDD...RRRRRR...DDDD......",
    ".....DD.DD...DRRRRD...DD.DD.....",
    "....D...D.....DDDD.....D...D...."]],
  // town NPC 10x12: H hair, S skin, R robe. Frame 1 is a small idle sway of the hands.
  npc:[[
    "...HHHH...",
    "..HHHHHH..",
    "..HSSSSH..",
    "..SSSSSS..",
    "...SSSS...",
    "..RRRRRR..",
    ".RRRRRRRR.",
    "SRRRRRRRRS",
    ".RRRRRRRR.",
    "..RRRRRR..",
    "..RRRRRR..",
    "..RR..RR.."],[
    "...HHHH...",
    "..HHHHHH..",
    "..HSSSSH..",
    "..SSSSSS..",
    "...SSSS...",
    "..RRRRRR..",
    ".RRRRRRRR.",
    ".RRRRRRRR.",
    "SRRRRRRRRS",
    "..RRRRRR..",
    "..RRRRRR..",
    "..RR..RR.."]],
  // gravestone 10x12: G stone, F carving, B faction-dark plinth.
  grave:[[
    "...GGGG...",
    "..GGGGGG..",
    ".GGGFFGGG.",
    ".GGFFFFGG.",
    ".GGGFFGGG.",
    ".GGGFFGGG.",
    ".GGGGGGGG.",
    ".GGFGFGGG.",
    ".GGGGGGGG.",
    ".GGGGGGGG.",
    "BBBBBBBBBB",
    "BBBBBBBBBB"],[
    "...GGGG...",
    "..GGGGGG..",
    ".GGGFFGGG.",
    ".GGFFFFGG.",
    ".GGGFFGGG.",
    ".GGGFFGGG.",
    ".GGGGGGGG.",
    ".GGFGFGGG.",
    ".GGGGGGGG.",
    ".GGGGGGGG.",
    "BBBBBBBBBB",
    "BBBBBBBBBB"]],
};

// Hero body 10x12: hair/helm (H), skin (S) with eye (E), class accent pauldrons
// and chest emblem (A), faction tabard (B) with darker trim (D), legs (L), boots (K).
// Columns 8-9 are free for the weapon drawn by heroSprite.
const HERO_BODY=[
  "..HHHH....",
  ".HHHHHH...",
  ".HSSSSH...",
  ".SSESES...",
  "..SSSS....",
  ".ADDDDA...",
  "SDBBBBDS..",
  ".DBABBD...",
  ".DBBBBD...",
  "..DDDD....",
  "...LLLL...",
  "...KKKK..."];
const HERO_LEGS1=["..LL..LL..",".KK....KK."];
// Class weapons as [col,row,char] pixels; the whole arm shifts up one pixel in frame 1.
const WEAPON={
  Warrior:[[8,1,'W'],[8,2,'W'],[8,3,'W'],[8,4,'W'],[8,5,'W'],[8,6,'W'],[7,7,'A'],[8,7,'A'],[9,7,'A'],[8,8,'L']],
  Mage:[[8,0,'O'],[9,0,'O'],[8,1,'O'],[9,1,'O'],[8,2,'W'],[8,3,'W'],[8,4,'W'],[8,5,'W'],[8,6,'W'],[8,7,'W'],[8,8,'W'],[8,9,'W'],[8,10,'W']],
  Hunter:[[8,2,'W'],[9,3,'W'],[9,4,'W'],[9,5,'W'],[9,6,'W'],[9,7,'W'],[8,8,'W'],[8,3,'A'],[8,7,'A']],
  Priest:[[8,0,'O'],[9,0,'O'],[8,1,'O'],[9,1,'O'],[8,2,'W'],[8,3,'W'],[8,4,'W'],[8,5,'W'],[8,6,'W'],[8,7,'W'],[8,8,'W'],[8,9,'W'],[8,10,'W']],
  Rogue:[[8,4,'W'],[8,5,'W'],[8,6,'W'],[8,7,'A'],[0,4,'W'],[0,5,'W'],[0,6,'W'],[0,7,'A']],
};

// Hero: faction-coloured tabard, class weapon on the right, class headgear, skin tone.
// frame 0 is the idle pose; frame 1 steps the legs apart and lifts the weapon arm.
export function heroSprite(a,ghost,frame=0){
  frame=frame?1:0;const key='h'+a.fac+a.cls+a.skin+(ghost?'g':'')+frame;if(sprCache[key])return sprCache[key];
  const rows=HERO_BODY.map(r=>r.split(''));
  if(frame){rows[10]=HERO_LEGS1[0].split('');rows[11]=HERO_LEGS1[1].split('')}
  for(const [x,y,ch] of WEAPON[a.cls]||[]){const yy=y-frame;if(yy>=0&&yy<12)rows[yy][x]=ch}
  const c=CLS[a.cls],f=FAC[a.fac];
  const map=ghost?{H:'#d8ecff',S:'#d8ecff',E:'#b8d4f4',A:'#b8d4f4',B:'#a8c8f0',D:'#98b8e0',L:'#88a8d0',K:'#7898c0',W:'#c8e0ff',O:'#ffffff'}
    :{H:c.head,S:a.skin,E:'#1a1218',A:c.acc,B:f.color,D:f.dark,L:'#3a2f2a',K:'#241c18',W:c.wep,O:c.orb||c.wep};
  return sprite(key,rows.map(r=>r.join('')),map)}
