// Pixel-string sprites rendered once into cached canvases. Monster shapes
// are owned by creature-designer, the hero sprite by character-builder.
// Rows are strings; '.' is transparent, any other char indexes the palette map.
// Every SPR entry is a two-frame array [frame0, frame1]: frame 0 is the idle
// pose, frame 1 the step (or wing beat); draw.js alternates them while moving.
import {CLS} from '../data/classes.js';
import {FAC} from '../data/factions.js';
import {npcRole} from '../data/npcs.js';
import {MOBS} from '../data/mobs.js';
import {PROC_SCALE,ART,SHEET} from './tile.js';
import {assetPixels,onAssets,hasAsset} from './assets.js';
import {recolour} from './palette.js';

const sprCache={};
export function sprite(key,rows,map){if(sprCache[key])return sprCache[key];const w=Math.max(...rows.map(r=>r.length)),h=rows.length;
  const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');
  rows.forEach((r,j)=>[...r].forEach((ch,i)=>{if(ch!=='.'&&map[ch]){x.fillStyle=map[ch];x.fillRect(i,j,1,1)}}));return sprCache[key]=c}

// A sprite with a one-pixel dark outline around its opaque pixels (2 px wider and taller), cached
// per source canvas. Entities (heroes, monsters, townsfolk, the boss) are drawn outlined so they
// read on any ground: pale wights on snow, boars on mud (docs/ART-PLAN.md).
const outCache=new WeakMap();
export function outlined(c,col='#100c16'){let o=outCache.get(c);if(o)return o;
  const w=c.width+2,h=c.height+2;o=document.createElement('canvas');o.width=w;o.height=h;const x=o.getContext('2d');
  const m=document.createElement('canvas');m.width=w;m.height=h;const mx=m.getContext('2d');
  for(const [dx,dy] of [[0,1],[2,1],[1,0],[1,2]])mx.drawImage(c,dx,dy);
  mx.globalCompositeOperation='source-in';mx.fillStyle=col;mx.fillRect(0,0,w,h);
  x.globalAlpha=.85;x.drawImage(m,0,0);x.globalAlpha=1;x.drawImage(c,1,1);outCache.set(c,o);return o}

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
  // ---- townsfolk 10x12 (data/npcs.js roles; drawn by npcSprite). Shared palette:
  // H hair (or hood/cap where it covers the hair), S skin, R body, A accent (apron, trim,
  // shield), M metal (helmet, hammer head, strings), W tool (tankard, haft, staff, lute),
  // D boots. Frame 0 idle; frame 1 steps the legs apart and works the hands.
  // innkeeper: apron over the tunic, tankard in the right hand.
  innkeeper:[[
    "...HHHH...",
    "..HHHHHH..",
    "..HSSSSH..",
    "..SSSSSS..",
    "...SSSS...",
    "..RRRRRR..",
    ".RRAAAARR.",
    "SRRAAAARRW",
    ".RRAAAARRW",
    "..RAAAAR..",
    "..RAAAAR..",
    "..DD..DD.."],[
    "...HHHH...",
    "..HHHHHH..",
    "..HSSSSH..",
    "..SSSSSS..",
    "...SSSS...",
    "..RRRRRR.W",
    ".RRAAAARRW",
    "SRRAAAARRS",
    ".RRAAAARR.",
    "..RAAAAR..",
    "..RAAAAR..",
    ".DD....DD."]],
  // smith: short hair, bare arms, leather apron, hammer (W haft, M head) at the right.
  smith:[[
    "...HHHH...",
    "..HSSSSH..",
    "..SSSSSS..",
    "..SSSSSS..",
    "...SSSS...",
    ".SRRRRRRS.",
    ".SRAAAARSM",
    "SSRAAAARSW",
    ".RRAAAARRW",
    "..RAAAAR.W",
    "..RAAAAR..",
    "..DD..DD.."],[
    "...HHHH..M",
    "..HSSSSH.W",
    "..SSSSSS.W",
    "..SSSSSS.W",
    "...SSSS.SW",
    ".SRRRRRRS.",
    ".SRAAAARS.",
    "SSRAAAARS.",
    ".RRAAAARR.",
    "..RAAAAR..",
    "..RAAAAR..",
    ".DD....DD."]],
  // quartermaster: flat cap (H), sash (A) across the coat, coin pouch (W) in hand.
  quartermaster:[[
    "..HHHHHH..",
    ".HHHHHHHH.",
    "..SSSSSS..",
    "..SSSSSS..",
    "...SSSS...",
    "..RRRRRR..",
    ".RRRARRRR.",
    "SRRRARRRRS",
    ".RRRARRRRW",
    "..RRARRR.W",
    "..RRRRRR..",
    "..DD..DD.."],[
    "..HHHHHH..",
    ".HHHHHHHH.",
    "..SSSSSS..",
    "..SSSSSS..",
    "...SSSS...",
    "..RRRRRR.W",
    ".RRRARRRRW",
    "SRRRARRRRS",
    ".RRRARRRR.",
    "..RRARRR..",
    "..RRRRRR..",
    ".DD....DD."]],
  // priest or shaman: hood (H) framing the face, stole (A), staff (W) with a charm (M).
  priest:[[
    "...HHHH..M",
    "..HHHHHH.W",
    "..HSSSSH.W",
    "..HSSSSH.W",
    "...SSSS..W",
    "..RRRRRR.W",
    ".RRRAARRRW",
    "SRRRAARRSW",
    ".RRRAARRR.",
    "..RRAARR..",
    "..RRAARR..",
    "..RRRRRR.."],[
    "...HHHH..M",
    "..HHHHHH.W",
    "..HSSSSH.W",
    "..HSSSSH.W",
    "...SSSS..W",
    "..RRRRRR.W",
    ".RRRAARRSW",
    ".RRRAARRR.",
    "SRRRAARRR.",
    "..RRAARR..",
    "..RRAARR..",
    ".RRR..RRR."]],
  // bard: feathered cap (H cap, A feather), lute (W body, M strings) held across the chest.
  bard:[[
    "....A.....",
    "..HHHHHH..",
    "..HSSSSH..",
    "..SSSSSS..",
    "...SSSS...",
    "..RRRRRR..",
    ".RRRRWWWW.",
    "SRRWWMMWRS",
    ".RRWWMMWR.",
    "..RRWWWR..",
    "..RRRRRR..",
    "..DD..DD.."],[
    "...A......",
    "..HHHHHH..",
    "..HSSSSH..",
    "..SSSSSS..",
    "...SSSS...",
    "..RRRRRR..",
    ".RRRRWWWW.",
    ".RRWWMMWSR",
    "SRRWWMMWR.",
    "..RRWWWR..",
    "..RRRRRR..",
    ".DD....DD."]],
  // gate captain: helmet (M), faction tabard (R), shield (A) on the left, spear (W, M tip).
  captain:[[
    "..MMMMMM.M",
    ".MMMMMMM.W",
    ".MMSSSSM.W",
    "..SSSSSS.W",
    "...SSSS..W",
    "..RRRRRR.W",
    "AARRRRRR.W",
    "AARRRRRRSW",
    "AARRRRRR.W",
    ".ARRRRRR.W",
    "..RRRRRR..",
    "..DD..DD.."],[
    "..MMMMMM.M",
    ".MMMMMMM.W",
    ".MMSSSSM.W",
    "..SSSSSS.W",
    "...SSSS..W",
    "..RRRRRR.W",
    ".AARRRRRSW",
    ".AARRRRR.W",
    ".AARRRRR.W",
    "..ARRRRR.W",
    "..RRRRRR..",
    ".DD....DD."]],
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
  // ---- road encounters (world-builder): all two-frame ----
  // merchant wagon 12x10: C canvas, W wood, K wheels, G lantern. Frame 1 turns the wheels.
  wagon:[[
    "...CCCCCCC..",
    "..CCCCCCCCC.",
    "..CCCCCCCCC.",
    "..WWWWWWWWW.",
    "..WWGWWWWWW.",
    "..WWWWWWWWWW",
    ".WWWWWWWWWW.",
    "..KK....KK..",
    ".KKKK..KKKK.",
    "..KK....KK.."],[
    "...CCCCCCC..",
    "..CCCCCCCCC.",
    "..CCCCCCCCC.",
    "..WWWWWWWWW.",
    "..WWGWWWWWW.",
    "..WWWWWWWWWW",
    ".WWWWWWWWWW.",
    "..KK....KK..",
    ".KK.K..K.KK.",
    "..KK....KK.."]],
  // lanternstone shrine 10x10: S stone, L lantern flame, D niche. Frame 1 flickers.
  shrine:[[
    "....LL....",
    "...LLLL...",
    "...LLLL...",
    "....SS....",
    "...SSSS...",
    "...SSSS...",
    "..SSDDSS..",
    "..SSDDSS..",
    ".SSSSSSSS.",
    "SSSSSSSSSS"],[
    "...L..L...",
    "...LLLL...",
    "....LL....",
    "....SS....",
    "...SSSS...",
    "...SSSS...",
    "..SSDDSS..",
    "..SSDDSS..",
    ".SSSSSSSS.",
    "SSSSSSSSSS"]],
  // strongbox 10x8: B wood, M brass bands, L lock. Frame 1 adds a glint.
  chest:[[
    "..BBBBBB..",
    ".BBBBBBBB.",
    ".MBBBBBBM.",
    ".MMMMMMMM.",
    ".BBBMMBBB.",
    ".BBBMLBBB.",
    ".BBBBBBBB.",
    ".MMMMMMMM."],[
    "..BBBBBB..",
    ".BBBBBBBG.",
    ".MBBBBBBM.",
    ".MMMMMMMM.",
    ".BBBMMBBB.",
    ".BBBMLBBB.",
    ".BBBBBBBB.",
    ".MMMMMMMM."]],
  // pilgrim 10x12: H hood, S face, R robe, P pack, T staff. Frame 1 steps and lifts the staff.
  pilgrim:[[
    "...HHHH...",
    "..HHHHHH.T",
    "..HSSSSH.T",
    "..HSSSSH.T",
    "...SSSS..T",
    "..RRRRRR.T",
    ".RRRRRRRRT",
    "PRRRRRRRRT",
    "PRRRRRRRRT",
    "..RRRRRR.T",
    "..RRRRRR.T",
    "..RR..RR.T"],[
    "...HHHH..T",
    "..HHHHHH.T",
    "..HSSSSH.T",
    "..HSSSSH.T",
    "...SSSS..T",
    "..RRRRRR.T",
    ".RRRRRRRRT",
    "PRRRRRRRRT",
    "PRRRRRRRRT",
    "..RRRRRR.T",
    ".RRR..RRR.",
    ".RR....RR."]],
  // Rookscar bandit 10x12: H hood, S skin, R leather, B blade. Frame 1 steps and raises the blade.
  bandit:[[
    "...HHHH...",
    "..HHHHHH..",
    "..HHSSHH..",
    "..HSSSSH..",
    "...SSSS...",
    "..RRRRRR..",
    ".RRRRRRRRB",
    "SRRRRRRRRB",
    ".RRRRRRR.B",
    "..RRRRRR..",
    "..RRRRRR..",
    "..RR..RR.."],[
    "...HHHH...",
    "..HHHHHH..",
    "..HHSSHH..",
    "..HSSSSH.B",
    "...SSSS..B",
    "..RRRRRR.B",
    ".RRRRRRRRB",
    "SRRRRRRRR.",
    ".RRRRRRRR.",
    "..RRRRRR..",
    ".RRR..RRR.",
    ".RR....RR."]],
  // memorials (issue #12, render/memorials.js): wayside stones 7x9 (G stone, F carving, M moss), a statue 9x16 (S stone, L light face, P plinth, F faction cloth), cooled lava 16x16 (C crust, V vein, A ash)
  stone:[[
    "..GGGG.",
    ".GGGGGG",
    "GGGFFGG",
    "GGGFFGG",
    "GGGGGGG",
    "GGFGFGG",
    "GGGGGGG",
    "MGGGGGM"],[
    "...G...",
    "...G...",
    "GGGGGGG",
    "...G...",
    "..GGG..",
    "..GGG..",
    "..GGG..",
    ".MGGGM."],[
    ".GGGGG.",
    "GGGGGGG",
    "GGFFFGG",
    "GGGGGGG",
    "GGFFGGG",
    "GGGGGGG",
    "GGGGGGG",
    "MMGGGMM"]],
  statue:[[
    "...SSS...",
    "..SLLLS..",
    "..SLLLS..",
    "...SSS...",
    "..SSSSS..",
    ".SSFFFSS.",
    ".SSFFFSS.",
    ".S.FFF.S.",
    "...FFF...",
    "...SSS...",
    "...S.S...",
    "..PPPPP..",
    ".PPPPPPP.",
    ".PPPPPPP.",
    "PPPPPPPPP",
    "PPPPPPPPP"]],
  cooled:[[
    "CCCACCCCCCACCCCC",
    "CCCCCCCVCCCCCCCC",
    "CACCCCCCCCCCACCC",
    "CCCCCACCCVCCCCCC",
    "CCCCCCCCCCCCCACC",
    "CVCCCCCCCCCCCCCC",
    "CCCCACCCCCACCCCC",
    "CCCCCCCCCCCCCCVC",
    "CCACCCCCVCCCCCCC",
    "CCCCCCCCCCCACCCC",
    "CCCCVCCCCCCCCCCC",
    "ACCCCCCCACCCCCCC",
    "CCCCCCCCCCCCVCCC",
    "CCVCCCCCCCCCCACC",
    "CCCCCCACCCCCCCCC",
    "CCCCCCCCCACCCCCC"]],
  // loot cave marker 12x9 (R rock, D dark mouth, G gold glint)
  cave:[[
    "...RRRRRR...",
    "..RRRRRRRR..",
    ".RRRRRRRRRR.",
    "RRRRDDDDRRRR",
    "RRRDDDDDDRRR",
    "RRRDDGDDDRRR",
    "RRRDDDDDDRRR",
    "RRRDDDDDDRRR",
    "RRRRRRRRRRRR"]],
};

// Hero body 10x12: class helm or hood (H) with the people's hair (R) showing at its
// rim and over the ears, skin (S) with eye (E), class accent (A, CLS.acc, the UI's class
// colour) on the pauldrons, chest emblem and belt, faction tabard (B) with darker trim (D),
// legs (L), boots (K). Class reads from the accent and weapon, faction from the tabard.
// Columns 8-9 are free for the weapon drawn by heroSprite.
const HERO_BODY=[
  "..HHHH....",
  ".RHHHHR...",
  ".RSSSSR...",
  ".SSESES...",
  "..SSSS....",
  ".ADDDDA...",
  "SDBBBBDS..",
  ".DBABBD...",
  ".DBBBBD...",
  "..AAAA....",
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
  // Skald: a round-bellied lute held out to the right, a gold rose sound-hole and a long neck up past the shoulder.
  Skald:[[9,1,'W'],[9,2,'W'],[8,3,'W'],[8,4,'O'],[9,4,'O'],[8,5,'O'],[9,5,'W'],[8,6,'O'],[9,6,'O'],[8,7,'W']],
  // Wildspeaker: a crooked staff, the head curling over like a fern, with two green sprouts on the shaft.
  Wildspeaker:[[8,1,'W'],[9,1,'W'],[9,2,'W'],[8,2,'W'],[8,3,'W'],[8,4,'W'],[8,5,'W'],[8,6,'W'],[8,7,'W'],[8,8,'W'],[8,9,'W'],[7,3,'O'],[9,5,'O']],
};

// Hero: faction-coloured tabard, class weapon on the right, class headgear, and the
// skin and hair of the hero's people (a.skin, a.hair from data/races.js; a hero made
// without a race falls back to the faction's first skin tone and dark hair).
// frame 0 is the idle pose; frame 1 steps the legs apart and lifts the weapon arm.
// Per hero, the four canvases (ghost x frame) last returned, kept while its look (faction, class, race, skin, hair) holds:
// the renderer asks for every hero in view each frame, and this skips building the cache key string (#716).
const HSC=new WeakMap();
export function heroSprite(a,ghost,frame=0){
  let m=HSC.get(a);if(!m||m.fac!==a.fac||m.cls!==a.cls||m.race!==a.race||m.skin!==a.skin||m.hair!==a.hair){m={fac:a.fac,cls:a.cls,race:a.race,skin:a.skin,hair:a.hair,c:[null,null,null,null]};HSC.set(a,m)}
  const i=(ghost?2:0)+(frame?1:0);return m.c[i]||(m.c[i]=heroSpriteOf(a,ghost,frame))}
function heroSpriteOf(a,ghost,frame){
  frame=frame?1:0;const skin=a.skin||FAC[a.fac].skin[0],hair=a.hair||'#2a2020';
  const key='h'+a.fac+a.cls+(a.race||'')+skin+hair+(ghost?'g':'')+frame;if(sprCache[key])return sprCache[key];
  const {rows,map}=heroArt(a,ghost,frame);return sprite(key,rows,map)}
// The hero's pixel strings and colour map, with no canvas (the art pipeline's init sheets read them in Node, #763).
export function heroArt(a,ghost,frame=0){
  frame=frame?1:0;const skin=a.skin||FAC[a.fac].skin[0],hair=a.hair||'#2a2020';
  const rows=HERO_BODY.map(r=>r.split(''));
  if(frame){rows[10]=HERO_LEGS1[0].split('');rows[11]=HERO_LEGS1[1].split('')}
  for(const [x,y,ch] of WEAPON[a.cls]||[]){const yy=y-frame;if(yy>=0&&yy<12)rows[yy][x]=ch}
  const c=CLS[a.cls],f=FAC[a.fac];
  const map=ghost?{H:'#d8ecff',R:'#c8e0f8',S:'#d8ecff',E:'#b8d4f4',A:'#b8d4f4',B:'#a8c8f0',D:'#98b8e0',L:'#88a8d0',K:'#7898c0',W:'#c8e0ff',O:'#ffffff'}
    :{H:c.head,R:hair,S:skin,E:'#1a1218',A:c.acc,B:f.color,D:f.dark,L:'#3a2f2a',K:'#241c18',W:c.wep,O:c.orb||c.wep};
  return {rows:rows.map(r=>r.join('')),map}}

// Townsfolk (data/npcs.js roles, sim/npcs.js entities): the role's shape in the people's
// skin and hair with the role's faction palette; a hood or cap colour (pal.H) replaces the hair.
export function npcSprite(p,frame=0){
  frame=frame?1:0;const R=npcRole(p.role),rows=SPR[R&&R.spr]||SPR.npc,pal=(R&&(R.pal[p.fac]||R.pal[0]))||{R:'#7a4ab8',A:'#5a3a88',M:'#c8ccd4',W:'#8a6a3a'};
  const key='n'+p.role+p.fac+(p.skin||'')+(p.hair||'')+frame;if(sprCache[key])return sprCache[key];
  return sprite(key,rows[frame],{H:pal.H||p.hair||'#2a2020',S:p.skin||FAC[p.fac].skin[0],R:pal.R,A:pal.A,M:pal.M,W:pal.W,D:'#241c18'})}

// World events (#354, sim/events.js): a festival hangs banners and bunting on every town in its region
// (drawn by places.js at close zoom). The banner is a pole with a swallowtail flag in the town's faction
// colour (B body, L lit edge, D shaded edge; light from the top left) with a gold band and boss; frame 1
// is the breeze. Pole 'P' wood, 'Y' gold finial, 'K' the foot. The flag points right; mirror for the left.
export const BANNER=[[
  'Y.......',
  'PLLLBBB.',
  'PLGGGGD.',
  'PLBBBBD.',
  'PBBGBBD.',
  'PBBBBBD.',
  'PBBD.BD.',
  'PBD...D.',
  'P.......',
  'P.......',
  'P.......',
  'P.......',
  'P.......',
  'P.......',
  'K.......'],[
  'Y.......',
  'PLLLB...',
  'PLGGGBB.',
  'PLBBBGGD',
  'PBBGBBBD',
  'PBBBBBBD',
  'PBBD.BBD',
  'PBD...BD',
  'P.......',
  'P.......',
  'P.......',
  'P.......',
  'P.......',
  'P.......',
  'K.......']];
export function bannerSprite(fac,frame=0){const f=FAC[fac]||FAC[0];
  return sprite('banner'+fac+(frame?1:0),BANNER[frame?1:0],{Y:'#ffe27a',P:'#8a6a3a',K:'#4a3420',B:f.color,D:f.dark,L:'#cfe0ff',G:'#f2c14e'})}
// Bunting: a sagging cord (wpx world px long, sag 4 px) with four-pixel pennants every 7 px in
// alternating festival colours; frame 1 flicks every other pennant's tip. Generated as pixel strings,
// cached per length and frame.
const BUNT_COLS='rgby';
export function buntingSprite(wpx,frame=0){frame=frame?1:0;const key='bunt'+wpx+'.'+frame;if(sprCache[key])return sprCache[key];
  const h=8,rows=Array.from({length:h},()=>Array(wpx).fill('.'));
  const sagAt=i=>Math.round(4*(1-((2*i/(wpx-1))-1)**2));
  for(let i=0;i<wpx;i++)rows[sagAt(i)][i]='S';
  for(let i=4,n=0;i+3<wpx-3;i+=7,n++){const y=sagAt(i+1)+1,c=BUNT_COLS[n%4];if(y+2>=h)continue;
    for(let k=0;k<4;k++)rows[y][i+k]=c;rows[y+1][i+1]=rows[y+1][i+2]=c;rows[y+2][frame&&n%2?i+2:i+1]=c}
  return sprite(key,rows.map(r=>r.join('')),{S:'#3a2a1a',r:'#e8544a',g:'#7dce5a',b:'#5b8ff2',y:'#f2c14e'})}

// Fellowship face portraits (#367): generated head-and-shoulders faces, see portrait.js.
export {portrait,portraitPixels,PORTRAIT_W,PORTRAIT_H} from './portrait.js';
import {setHeadSource} from './portrait.js';

// ---- the 32 px tier on the world map (#177, render/tile.js) ----
// A procedural sprite drawn on the world map: scaled up by PROC_SCALE to stand as tall as a generated 32x48 frame and
// painted at art resolution (PROC_SCALE*ART art pixels per sprite pixel) with a one-art-pixel outline, so it sits beside
// generated art with the same line weight. Cached per source canvas. Draw it at its size / ART world units.
const bigCache=new WeakMap(),bigOut=new WeakMap();
export function worldSprite(c,outline=true){const m=outline?bigOut:bigCache;let o=m.get(c);if(o)return o;
  const k=PROC_SCALE*ART,b=document.createElement('canvas');b.width=c.width*k;b.height=c.height*k;const x=b.getContext('2d');
  x.imageSmoothingEnabled=false;x.drawImage(c,0,0,b.width,b.height);o=outline?outlined(b):b;m.set(c,o);return o}

// Generated sprite sheets (#177 slice 4, scripts/art/manifest.json kind 'sprite'): one sheet per hero class and per
// creature, SHEET.cols frames (stand, step, other step) by SHEET.rows directions (down, left, right, up), each frame
// SPRITE_TILES tiles at the current tier (32x48 at 32). The procedural sprite above is the fallback for any id with no
// sheet loaded. Hero sheets are drawn in the first faction's colours and recoloured per faction (palette.js SPRITE).
const slug=s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-');
export const ASSET_SPRITES={};
for(const cls of Object.keys(CLS))ASSET_SPRITES['sprite:hero-'+slug(cls)]={kind:'hero',cls};
for(const key of Object.keys(MOBS))ASSET_SPRITES['sprite:mob-'+slug(key)]={kind:'mob',type:key};
const HERO_ID={},MOB_ID={};for(const [id,v] of Object.entries(ASSET_SPRITES))(v.kind==='hero'?HERO_ID:MOB_ID)[v.kind==='hero'?v.cls:v.type]=id;
// Per id, the sheet canvas per faction (a hero sheet recoloured; a creature's under 0); undefined = not built yet.
const sheetC=new Map();
// The sheet canvas for id in faction fac's colours, or null while it is missing or loading. No allocation once built.
function sheetOf(id,fac){let per=sheetC.get(id);if(per&&per[fac])return per[fac];
  const A=assetPixels(id);if(!A)return null; // not cached: it may still arrive
  const swap=recolour(fac),c=document.createElement('canvas');c.width=A.w;c.height=A.h;const x=c.getContext('2d'),img=x.createImageData(A.w,A.h);
  for(let i=0;i<A.w*A.h;i++){const h=A.hex[i];if(!h)continue;const s=swap[h]||h,o=i*4;img.data[o]=parseInt(s.slice(1,3),16);img.data[o+1]=parseInt(s.slice(3,5),16);img.data[o+2]=parseInt(s.slice(5,7),16);img.data[o+3]=255}
  x.putImageData(img,0,0);if(!per)sheetC.set(id,per=[]);per[fac]=c;return c}
onAssets(()=>sheetC.clear());
// One frame of the entity's generated sheet: {img, sx, sy, fw, fh} in art pixels, or null (draw the procedural sprite).
// dir: 0 down, 1 left, 2 right, 3 up; col: 0 stand, 1 step, 2 other step.
const FR={img:null,sx:0,sy:0,fw:0,fh:0};
// A hero's sheet by class and people (#789): 'sprite:hero-<class>-<race>' (race ids from data/races.js) when such a sheet is in
// the index, else the class sheet 'sprite:hero-<class>', else null (the procedural sprite). Sheets of a people are index-only
// entries (made from the LPC generator, never generated), so they are not in ASSET_SPRITES or the manifest. Cached per hero.
const peopleId={}; // class -> race -> sheet id (or null), no allocation per call
export function heroSheetId(cls,race){const per=peopleId[cls]||(peopleId[cls]={}),k=race||"";let id=per[k];if(id!==undefined)return id;
  const base=HERO_ID[cls],byPeople=race&&base?base+"-"+race:null;
  return per[k]=byPeople&&hasAsset(byPeople)?byPeople:base||null}
onAssets(()=>{for(const c of Object.keys(peopleId))delete peopleId[c]});
// A townsperson's sheet by role and people (#832): 'sprite:npc-<role>-<race>' (roles from data/npcs.js, made by scripts/art/lpc-townsfolk.mjs from the
// LPC generator, index-only like the people sheets), else 'sprite:npc-<role>' (a role sheet for every people), else null (the procedural figure).
// Anything with kind 'npc' and a role is looked up, so another module's townsfolk (the town guards of #795: role 'guard') get a sheet by adding
// 'sprite:npc-guard-<race>' to the index, with no change here. Cached per role and people, no allocation per call.
const npcId={}; // role -> race -> sheet id (or null)
export function npcSheetId(role,race){const per=npcId[role]||(npcId[role]={}),k=race||'';let id=per[k];if(id!==undefined)return id;
  const base='sprite:npc-'+role,byPeople=race?base+'-'+race:null;
  return per[k]=byPeople&&hasAsset(byPeople)?byPeople:hasAsset(base)?base:null}
onAssets(()=>{for(const c of Object.keys(npcId))delete npcId[c]});
export function sheetFrame(e,dir,col){
  const id=e.kind==='hero'?heroSheetId(e.cls,e.race):e.kind==='mob'?MOB_ID[e.type]:e.kind==='npc'&&e.role?npcSheetId(e.role,e.race):null;if(!id)return null;
  const c=sheetOf(id,e.kind==='hero'||e.kind==='npc'?e.fac:0);if(!c)return null;
  FR.img=c;FR.fw=Math.floor(c.width/SHEET.cols);FR.fh=Math.floor(c.height/SHEET.rows);FR.sx=col*FR.fw;FR.sy=dir*FR.fh;return FR}

// ---- scene figures (#862) ----
// One helper for every room view (interior.js, crawlview.js, raidview.js): the entity's current sheet frame when its
// sheet is loaded (a hero by class and people with the faction tabard, a creature, and townsfolk once their sheets land,
// all through sheetFrame), else the outlined procedural sprite. The rooms draw at one unit a procedural pixel, so a sheet
// frame (32x48 art px = 16x24 units) is drawn K units per unit to stand a little taller than the old 12 px figure.
// Returns ONE shared object, valid until the next call (no allocation per frame):
//   img, sx, sy, sw, sh  the source rectangle to drawImage
//   dw, dh               its size in room units, including the 1 px outline of a procedural canvas
//   ox, oy               the destination offset from the feet's centre (px, py): drawImage(img,sx,sy,sw,sh,px+ox,py+oy,dw,dh)
//   w, h                 the figure's own width and height without outline: shadows, rings, name plates, bars (top = py - h)
//   mirror               true when the caller must flip it to face left (a procedural sprite faces right; a sheet has a left view)
//   sheet                true when it is a generated frame
export const SCENE_K=.75;
const SF={img:null,sx:0,sy:0,sw:0,sh:0,dw:0,dh:0,ox:0,oy:0,w:0,h:0,mirror:false,sheet:false};
// face: 1 faces right, -1 left (down/up are not used by rooms). col: 0 stand, 1 or 2 a step. ghost: the pale procedural figure.
export function sceneFigure(e,face,col,k=SCENE_K,ghost=false){
  const G=ghost?null:sheetFigure(e,face,col,k);if(G)return G;
  const s=proceduralOf(e,col?1:0,ghost);if(!s)return null;
  const o=outlined(s);SF.img=o;SF.sx=0;SF.sy=0;SF.sw=SF.dw=o.width;SF.sh=SF.dh=o.height;SF.w=s.width;SF.h=s.height;SF.ox=-Math.floor(s.width/2)-1;SF.oy=-s.height-1;SF.mirror=face<0;SF.sheet=false;return SF}
function sheetFigure(e,face,col,k){const G=sheetFrame(e,face<0?1:2,col);if(!G)return null;
  SF.img=G.img;SF.sx=G.sx;SF.sy=G.sy;SF.sw=G.fw;SF.sh=G.fh;SF.w=SF.dw=G.fw/ART*k;SF.h=SF.dh=G.fh/ART*k;SF.ox=-SF.dw/2;SF.oy=-SF.dh;SF.mirror=false;SF.sheet=true;return SF}
// A creature of a bestiary type by its generated sheet only (null while it has none: the view keeps its own procedural art,
// the dungeon's rimmed foes and site creatures that are not in MOBS). No allocation: one key object per type.
const MOB_KEY=new Map();
export function sceneCreature(type,face,col,k=SCENE_K){let e=MOB_KEY.get(type);if(!e)MOB_KEY.set(type,e={kind:'mob',type});return sheetFigure(e,face,col,k)}
function proceduralOf(e,fr,ghost){
  if(e.kind==='mob'){const M=MOBS[e.type];return M&&SPR[M.spr]?sprite(e.type+fr,SPR[M.spr][fr],M.col):null}
  if(e.role&&e.kind!=='hero')return npcSprite(e,fr);
  if(e.cls)return heroSprite(e,ghost,fr);return null}
// Draws it with its feet at (px, py), mirrored when it faces left and has no left view.
export function drawFigure(ctx,F,px,py){
  if(F.mirror){ctx.save();ctx.translate(px,0);ctx.scale(-1,1);ctx.drawImage(F.img,F.sx,F.sy,F.sw,F.sh,F.ox,py+F.oy,F.dw,F.dh);ctx.restore()}
  else ctx.drawImage(F.img,F.sx,F.sy,F.sw,F.sh,px+F.ox,py+F.oy,F.dw,F.dh)}

// Party-frame and sheet faces crop from the hero's front frame (#862); the procedural face while no sheet is loaded.
setHeadSource(a=>a.kind==='hero'?sheetFrame(a,0,0):null);
