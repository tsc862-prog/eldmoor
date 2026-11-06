// Where each scenery piece sits in the sheet `prop:scenery` (assets/prop/32/scenery.png). Pure data: the cutter
// (scripts/art/packcut-scenery.mjs) lays the sheet out from it and src/render/scenery.js reads the pieces back.
// [name, w, h] in art pixels at the 32 tier; shelves are filled left to right, tallest pieces first.
const SIZES=[
  ['pebTan',32,32],['pebGrey',32,32],['pebDark',32,32],['pebWhite',32,32],['pebTanS',32,24],['pebGreyS',32,24],['pebDarkS',32,24],['pebWhiteS',32,24],
  ['tuftG',32,32],['tuftL',32,32],['tuftD',32,32],['tuftB',32,32],['tuftGS',16,16],['tuftLS',16,16],['tuftDS',16,16],['tuftBS',16,16],
  ['blades',32,32],['flRed',48,32],['flGold',48,32],['flWhite',48,32],['flBlue',48,32],
  ['pool',32,32],['tarPool',32,32],
  ['deck',32,32],['deckStone',32,32],['deckChar',32,32],['rail',6,32],['railStone',6,32],['railChar',6,32],['post',8,20],['postStone',10,16],['postChar',8,20],
  ['torch',16,60],['hay',44,30],['barrel',24,32],['crate',28,28],['stump',20,10],['stumpChar',20,10],
  ['skull',11,10],['ribs',48,28],['femur',16,6],['stake',12,26],['cairn',28,26],['stone1',14,26],['stone2',16,30],['stone3',18,20],
  ['wheat',32,32],['cabbage',32,32],['plough',32,32],['scarecrow',20,32],
  ['brick',40,26],['flag',32,32],['stepA',16,12],['stepB',20,12],['lily',10,8],['floe',20,12]];
export const SHEET_W=256;
export const ATLAS={};
let x=0,y=0,rowH=0;
for(const [n,w,h] of [...SIZES].sort((a,b)=>b[2]-a[2]||(a[0]<b[0]?-1:1))){if(x+w>SHEET_W){x=0;y+=rowH;rowH=0}ATLAS[n]=[x,y,w,h];x+=w;rowH=Math.max(rowH,h)}
export const SHEET_H=y+rowH;
