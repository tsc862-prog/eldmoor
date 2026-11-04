// Town pieces and landmarks as plain drawing (#763), with no canvas and no world: every function draws through R(x, y, w, h,
// colour) in world units (one unit = one procedural pixel, a tile is 16), so the same code paints the terrain chunks
// (townart.js) and the init image of the art pipeline in Node (scripts/art/init.mjs: buildings, landmarks and sprites are made
// image to image from the game's own art, so view, silhouette and footprint come from here and the model adds texture only).
//   drawHouse, drawCryptMouth: the procedural auction house, hall and crypt arch, drawn in the game when no asset is loaded.
//   sketchPiece: the pieces the game has no procedural building for (smithy, chapel, inn, notice board, wall corner, gate,
//   the lair's nest). They exist to start the model from the game's view; the game itself still draws nothing extra for them.
// Roles c: {roof: [light, mid, dark], wall: [light, shade], line, door} (palette.js FLAT), plus stone (the masonry ramp,
// light to dark, palette.js TOWN.<style>.stone) for walls and gates. Light from the top left, like everything else.

// The procedural house, 48 x 32 units: a roof of 14 over a wall of 18. sign: the gold sign's colour, or none.
export function drawHouse(R,x,y,roof,wall,sign){
  R(x,y,48,14,roof);R(x,y,48,2,'#fff3');R(x+1,y+1,46,1,'#fff2');for(let r=4;r<14;r+=3)R(x,y+r,48,1,'#0004');R(x,y+13,48,1,'#0008');
  R(x+2,y+14,44,18,wall);R(x+2,y+30,44,2,'#0006');R(x+2,y+14,44,1,'#fff2');
  R(x+19,y+19,10,13,'#5a3a1c');R(x+20,y+20,8,12,'#3a2414');R(x+26,y+26,1,1,'#f2c14e');
  for(const wx of [x+7,x+35]){R(wx-1,wx===x+7?y+17:y+17,8,8,'#2a1c10');R(wx,y+18,6,6,'#9ad0ff');R(wx+3,y+18,1,6,'#2a1c10');R(wx,y+21,6,1,'#2a1c10');R(wx-1,y+24,8,1,'#d8d0c0')}
  if(sign){R(x+17,y+3,14,7,'#3a2414');R(x+18,y+4,12,5,sign);R(x+20,y+6,8,1,'#8a6a1a')}}

// The procedural crypt arch over its 48 x 48 rock patch (mouth tiles): a squat arch, a green glow, two skulls at its feet.
export function drawCryptMouth(R,x,y){
  R(x+6,y+2,36,30,'#4a4652');R(x+6,y+2,36,4,'#78748a');R(x+6,y+2,4,30,'#78748a');R(x+38,y+2,4,30,'#78748a');
  R(x+10,y+6,28,1,'#2e2a34');R(x+16,y+12,16,20,'#0a0810');R(x+15,y+11,18,1,'#2e2a34');R(x+22,y+8,4,2,'#7ad0a0');R(x+23,y+9,2,1,'#c8ffd8');
  R(x+12,y+28,4,4,'#e8e4d8');R(x+32,y+28,4,4,'#e8e4d8');R(x+13,y+29,1,1,'#0a0810');R(x+15,y+29,1,1,'#0a0810');R(x+33,y+29,1,1,'#0a0810');R(x+35,y+29,1,1,'#0a0810')}

// A roof seen from above: lit at the top, shaded on the right, shingle rows, a dark eave.
function roofTop(R,x,y,w,h,c){R(x,y,w,h,c.roof[1]);R(x,y,w,2,c.roof[0]);R(x+w-Math.ceil(w/4),y+2,Math.ceil(w/4),h-2,c.roof[2]);
  for(let r=5;r<h-1;r+=4)R(x,y+r,w,1,c.roof[2]);R(x,y+h-1,w,1,c.line)}
// The short front wall under it, shaded on the right.
function frontWall(R,x,y,w,h,c){R(x,y,w,h,c.wall[0]);R(x+w-Math.ceil(w/5),y,Math.ceil(w/5),h,c.wall[1])}
function smithy(R,c){roofTop(R,0,5,16,15,c);
  R(9,0,6,12,c.line);R(10,1,4,10,c.wall[1]);R(10,1,4,3,c.door); // the chimney, its mouth glowing
  frontWall(R,1,20,14,12,c);R(3,23,6,9,c.line);R(4,24,4,8,c.door);R(11,26,3,2,c.line);R(12,28,1,3,c.line)} // the shed's door and the anvil
function chapel(R,c){for(let i=0;i<9;i++){const w=2+i;R(8-Math.ceil(w/2),i,w,1,i<3?c.roof[0]:c.roof[1]);R(8,i,Math.floor(w/2),1,c.roof[2])} // the spire over the nave
  R(7,0,2,1,c.door);roofTop(R,1,9,14,19,c);frontWall(R,1,28,14,12,c);
  R(6,29,4,3,c.line);R(7,30,2,1,c.door);R(5,33,6,7,c.line);R(6,34,4,6,c.door)} // the rose window and the arched door
function inn(R,c){drawHouse(R,0,0,c.roof[1],c.wall[0],0);R(35,0,6,7,c.line);R(36,1,4,5,c.wall[1]); // the chimney
  for(const wx of [7,35])R(wx,18,6,6,c.door); // lit windows
  R(30,15,1,6,c.line);R(29,15,8,1,c.line);R(32,16,4,5,c.line);R(33,17,2,3,c.door)} // the hanging sign
function board(R,c){R(2,5,2,10,c.line);R(12,5,2,10,c.line);R(1,1,14,4,c.roof[1]);R(1,1,14,1,c.roof[0]);R(11,2,4,3,c.roof[2]);R(1,4,14,1,c.line);
  R(2,5,12,7,c.wall[1]);R(3,6,4,5,c.wall[0]);R(8,6,4,3,c.wall[0]);R(8,10,3,1,c.line);R(4,7,2,1,c.line)}
const block=(R,x,y,w,h,s)=>{R(x,y,w,h,s[1]);R(x,y,w,2,s[0]);R(x,y,2,h,s[0]);R(x+w-2,y+2,2,h-2,s[2]);R(x,y+h-2,w,2,s[2])};
function wallCorner(R,c){const s=c.stone;block(R,0,0,16,16,s);R(4,4,8,8,s[2]);R(5,5,6,6,s[1]);for(const [x,y] of [[0,0],[6,0],[12,0],[0,6],[0,12]])R(x,y,4,2,s[3])}
function gate(R,c){const s=c.stone;block(R,0,0,64,16,s);for(let x=2;x<64;x+=8)R(x,0,4,2,s[3]);
  R(16,3,32,13,s[3]);R(18,5,28,11,c.door);for(let x=22;x<46;x+=6)R(x,5,1,11,s[3]);block(R,0,0,16,16,s);block(R,48,0,16,16,s);R(5,5,6,6,s[2]);R(53,5,6,6,s[2])}
// The lair's nest, 128 x 128, opening west: a rough ring of rock round a scorched basin, cracks of fire, a clutch of eggs.
function lair(R,c){const m=64,rough=[0,3,1,4,2,5,1,3,0,2,4,1,3,5,2,1];
  for(let y=0;y<128;y++){const dy=y+.5-m,ro=62-rough[(y>>3)&15],ri=44-rough[(y>>2)&15]/2;if(Math.abs(dy)>ro)continue;
    const xo=Math.floor(Math.sqrt(ro*ro-dy*dy));R(m-xo,y,2*xo,1,dy<0?c.roof[0]:c.roof[1]);R(m+Math.floor(xo/2),y,xo-Math.floor(xo/2),1,c.roof[2]);
    if(Math.abs(dy)<ri){const xi=Math.floor(Math.sqrt(ri*ri-dy*dy));R(m-xi,y,2*xi,1,c.line)}
    if(Math.abs(dy)<12)R(m-xo,y,xo,1,c.line)} // the way in, from the west
  for(const [x,y,w,h] of [[40,44,22,2],[60,44,2,18],[60,60,20,2],[78,60,2,16],[44,78,26,2],[44,64,2,16],[30,63,14,2]])R(x,y,w,h,c.wall[0]);
  for(const [x,y] of [[52,52],[68,50],[70,70],[54,68]]){R(x,y,8,10,c.wall[1]);R(x+1,y+1,6,8,c.door);R(x+1,y+1,3,3,c.roof[0])}}

const SKETCH={smithy,chapel,inn,board,'wall-corner':wallCorner,gate,lair};
// A piece the game has no procedural building for. Returns false for one it does not know.
export function sketchPiece(R,piece,c){const f=SKETCH[piece];if(!f)return false;f(R,c);return true}
