// Pixel-string sprites rendered once into cached canvases. Monster shapes
// are owned by creature-designer, the hero sprite by character-builder.
// Rows are strings; '.' is transparent, any other char indexes the palette map.
import {CLS} from '../data/classes.js';
import {FAC} from '../data/factions.js';

const sprCache={};
export function sprite(key,rows,map){if(sprCache[key])return sprCache[key];const w=Math.max(...rows.map(r=>r.length)),h=rows.length;
  const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');
  rows.forEach((r,j)=>[...r].forEach((ch,i)=>{if(ch!=='.'&&map[ch]){x.fillStyle=map[ch];x.fillRect(i,j,1,1)}}));return sprCache[key]=c}

export const SPR={
  wolf:["....GG","GGGGGE","GGGGG.","G.G.G."],
  boar:[".BBBB.","BBBBBT","BBBBBB",".D..D."],
  spider:["L.LL.L",".KKKK.","LKEEKL","L.LL.L"],
  bog:[".GGG.","GEGEG","GGGGG","FGGGF",".G.G."],
  golem:[".RRRR.","RREERR","RRRRRR","R.RR.R","..RR..",".R..R."],
  drake:["W....WW","WW..WWE","RRRRRR.",".RRRR..",".R..R.."],
  shaghorn:["....H.H","BBBBBBB","BBBBBEB","SBBBBBS","S.S.S.S"],
  wight:[".WWW.",".EWE.","WWWWW",".WWW.","M.W.M","..M.."],
  boss:["W............W","WW..........WW","WWW..RRRR..WWW",".WWWRRRRRRWWW.","...RRERRERR...","..RRRRRRRRRR..","..RRTTTTTTRR..","...RR....RR...","..DD......DD.."],
  npc:[".HHH.",".SSS.","RRRRR",".RRR.",".RRR.",".R.R."],
  grave:[".GGG.","GGFGG","GFFFG","GGFGG","GGGGG","BBBBB"],
};

// Hero: faction-coloured tabard, class weapon on the right, class headgear, skin tone.
export function heroSprite(a,ghost){
  const key='h'+a.fac+a.cls+a.skin+(ghost?'g':'');if(sprCache[key])return sprCache[key];
  const rows=[".HHH..",".SSS..","ABBBA.","SBBBS.",".BBB..",".L.L.."].map(r=>r.split(''));
  const w={Warrior:[1,2,3,4],Mage:[1,2,3,4,5],Hunter:[1,2,3,4],Priest:[1,2,3,4,5],Rogue:[3,4]}[a.cls];
  w.forEach(r=>rows[r][5]='W');if(CLS[a.cls].orb)rows[0][5]='O';
  const c=CLS[a.cls],f=FAC[a.fac];
  const map=ghost?{H:'#d8ecff',S:'#d8ecff',A:'#b8d4f4',B:'#a8c8f0',L:'#88a8d0',W:'#c8e0ff',O:'#ffffff'}
    :{H:c.head,S:a.skin,A:c.acc,B:f.color,L:'#3a2f2a',W:c.wep,O:c.orb||c.wep};
  return sprite(key,rows.map(r=>r.join('')),map)}
