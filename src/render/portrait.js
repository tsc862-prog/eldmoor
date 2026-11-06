// Fellowship face portraits (#367): a 15x18 head-and-shoulders pixel face per hero, generated in code.
// Shown in the party frames at 2x (30x36 CSS px).
//
// Deterministic: a pure function of the hero's id, name, people (a.race), class, faction, Fellowship
// slot and the skin and hair heroSprite already uses (a.skin, a.hair). The variety (hair style, beard,
// eyes, brow, mouth, small marks) comes from core/rng hash() of the id and name, never from rnd(), so
// drawing a face draws no dice and the seeded sim is unchanged. The name is part of the seed because a
// New World reuses hero ids.
//
// Light from the top left (lit left cheek and shoulder, shaded right), a 1px dark outline around the
// figure, a faint faction-tinted backdrop so the outline reads. Marks: the Tank always wears a nasal
// helm; other classes show their class by collar colour (CLS[cls].acc) and a small head mark (Mage hood,
// Priest circlet, Hunter hood or feather, Rogue mask or scarf, Skald feathered cap, Wildspeaker sprigs).
// Peoples: Ashfolk tusks, Thornhide horn nubs and heavy brow, Mirekin ear fins and pale eyes, Skerrin
// pointed ears, Tarrow freckles. Mode 'dead' is greyscale, 'ghost' the pale blue of heroSprite's ghost.
//
// portraitPixels(a, mode) returns the pixels as an array of '#rrggbb' or null (no DOM; Node can check
// it), portrait(a, mode) a cached canvas.
//
// The portrait library (#710, epic #177): when assets/index.json lists faces of kind portrait (ids
// portrait:<race>-<cls>-<sex>-<nn>, render/assets.js portraitAssets), portrait() draws one of them instead. The face is
// picked among those of the hero's people and class, else of its people, else none (the code face above); which one is
// libraryFace(a), a pure function of the hero's id and name (the same seed as the code face, core/rng hash, never rnd()),
// so it never changes while the library is unchanged and a New World that reuses ids still differs. No sim state, no
// save field. Until the PNG has loaded (and if it fails) the code face is drawn; onAssets repaints when it arrives.
// A library face is shown in the same 5:6 frame as the code face: bottom-aligned, the faction backdrop above it and in
// its transparent pixels, the same dead and ghost tints, resampled by area to the frame's size in device pixels
// (libraryPixels, Node-checkable).
import {CLS} from '../data/classes.js';
import {FAC} from '../data/factions.js';
import {hash} from '../core/rng.js';
import {slotKeyOf} from '../sim/company.js'; // the slotted company (#588)
import {portraitAssets,assetPixels,onAssets} from './assets.js';

export const PORTRAIT_W=15,PORTRAIT_H=18;
// Library faces the manifest makes (scripts/art/manifest.json hook table, #710/#722): every one has the code face as its fallback.
export const ASSET_PORTRAITS={};for(const id of ['ashfolk-warrior-m','hallowan-warrior-m','mirekin-warrior-m','mirekin-warrior-f','skerrin-warrior-f','skerrin-warrior-m','tarrow-warrior-m','thornhide-warrior-m'])ASSET_PORTRAITS[`portrait:${id}-01`]='code face';
const W=PORTRAIT_W,H=PORTRAIT_H;

// ---- colour helpers ----
const rgb=h=>{h=String(h||'#808080').replace('#','');if(h.length===3)h=h.split('').map(c=>c+c).join('');const n=parseInt(h,16)||0;return [n>>16&255,n>>8&255,n&255]};
const hex=(r,g,b)=>'#'+[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
const mul=(h,k)=>{const [r,g,b]=rgb(h);return hex(r*k,g*k,b*k)};
const mix=(h1,h2,t)=>{const a=rgb(h1),b=rgb(h2);return hex(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t)};
const lum=h=>{const [r,g,b]=rgb(h);return (r*.299+g*.587+b*.114)/255};
const GREY=h=>{const l=lum(h);const v=40+l*150;return hex(v,v,v+6)};
const GHOST=h=>{const l=lum(h);return mix('#6888b8','#e8f4ff',Math.min(1,l*1.3))};

const OUTLINE='#100c16',BG='#0a0b14',EYE='#1a1218',WHITE='#f0ead0',BONE='#d8cfb0';

// Seeded variety: one hash per trait so traits do not move together.
function seedOf(a){let s=(a.id|0)*31+7;const n=String(a.name||'');for(let i=0;i<n.length;i++)s=(Math.imul(s,33)+n.charCodeAt(i))|0;return s}
const pick=(s,salt,n)=>Math.floor(hash(s,salt,4049)*n)%n;
const roll=(s,salt)=>hash(s,salt,8111);

// The pixels, row by row. mode: '' (alive), 'dead' (grey), 'ghost' (pale blue).
export function portraitPixels(a,mode=''){
  const P=new Array(W*H).fill(null);
  const set=(x,y,c)=>{if(c&&x>=0&&x<W&&y>=0&&y<H)P[y*W+x]=c};
  const row=(y,x0,x1,c)=>{for(let x=x0;x<=x1;x++)set(x,y,c)};
  const get=(x,y)=>x>=0&&x<W&&y>=0&&y<H?P[y*W+x]:null;
  const s=seedOf(a),c=CLS[a.cls]||CLS.Warrior,f=FAC[a.fac]||FAC[0];
  const race=a.race||'',skin=a.skin||(f.skin&&f.skin[0])||'#d8a878',hair=a.hair||'#2a2020';
  const skL=mix(skin,'#fff4e0',.22),skD=mul(skin,.78),skDD=mul(skin,.6);
  const hrL=mix(hair,'#ffffff',.18),hrD=mul(hair,.7);
  const tank=slotKeyOf(a)==='tank';
  const helm=tank||(a.cls==='Warrior'&&roll(s,1)<.5);
  const heavy=race==='ashfolk'||race==='thornhide';

  // shoulders and chest (rows 13-17): class garment at the sides, faction tabard in the middle, class collar
  const garment=a.cls==='Warrior'?c.head:a.cls==='Priest'?mix(c.acc,'#b8b098',.35):a.cls==='Hunter'?'#6a4a2a':c.head;
  const gL=mix(garment,'#ffffff',.18),gD=mul(garment,.7);
  row(13,3,11,garment);for(let y=14;y<H;y++)row(y,1,13,garment);row(13,2,2,garment);row(13,12,12,gD);
  for(let y=14;y<H;y++){set(1,y,gL);set(2,y,gL);set(12,y,gD);set(13,y,gD)}
  for(let y=14;y<H;y++)row(y,5,9,f.color);for(let y=15;y<H;y++){set(9,y,f.dark)}
  set(5,14,mix(f.color,'#ffffff',.2));
  row(13,5,9,c.acc);set(5,14,c.acc);set(9,14,mul(c.acc,.75));set(7,14,f.color); // V collar in class colour
  if(a.cls==='Warrior'){ // steel pauldrons
    const st=c.acc,stD=mul(c.acc,.68);row(13,1,4,st);row(14,0,4,st);row(15,0,3,stD);row(13,10,13,stD);row(14,10,14,stD);row(15,11,14,mul(stD,.8));set(1,13,mix(st,'#ffffff',.5));
    set(7,16,mix(c.wep,'#ffffff',.2)); // a buckle
  }else if(a.cls==='Hunter'){for(let i=0;i<5;i++)set(3+i*2>>0,13+i,'#3a2a18');set(11,13,'#8a5a2a');set(12,12,'#c8b890')} // strap, quiver tip
  else if(a.cls==='Mage'||a.cls==='Priest'){set(7,16,c.orb||c.acc)} // a clasp
  else if(a.cls==='Wildspeaker'){set(3,14,c.orb);set(11,15,c.orb)} // leaves on the mantle
  else if(a.cls==='Skald'){set(4,15,c.acc);set(10,15,c.acc)}

  // neck and face
  row(12,6,8,skD);set(6,12,skin);
  row(4,5,9,skin);for(let y=5;y<=9;y++)row(y,4,10,skin);
  const jaw=heavy||roll(s,2)<.3;
  if(jaw){row(10,4,10,skin);row(11,5,9,skin)}else{row(10,5,9,skin);row(11,6,8,skin)}
  // light from the top left: lit left cheek and brow, shaded right side and under the jaw
  for(let y=5;y<=9;y++){set(10,y,skD);set(4,y,y<8?skL:skin)}set(5,5,skL);
  if(jaw){set(10,10,skDD);set(9,11,skD)}else{set(9,10,skD);set(8,11,skD)}
  // ears
  const ear=(x,dx)=>{set(x,7,skin);set(x,8,dx>0?skDD:skD)};ear(3,-1);ear(11,1);
  if(race==='skerrin'){set(2,6,skin);set(12,6,skD);set(3,6,skin);set(11,6,skD)}
  if(race==='mirekin'){const fin=mix(hair,skin,.35),finD=mul(fin,.75);set(2,6,fin);set(2,7,fin);set(3,6,fin);set(12,6,finD);set(12,7,finD);set(11,6,finD);set(2,8,finD);set(12,8,finD)}

  // eyes, brows, nose, mouth
  const eyeCol=race==='mirekin'?'#c8d850':race==='ashfolk'&&roll(s,3)<.4?'#b84a2a':EYE;
  const ey=7;set(5,ey,eyeCol);set(9,ey,eyeCol);
  if(race==='mirekin'){set(5,ey,'#c8d850');set(9,ey,'#c8d850');set(6,ey,EYE);set(8,ey,EYE)} // wide pale eyes, dark slit inside
  const brow=race==='thornhide'?skDD:hrD,bs=pick(s,4,3);
  if(race==='thornhide'||bs===0){row(6,5,6,brow);row(6,8,9,brow)}else if(bs===1){set(5,6,brow);set(9,6,brow)}else{set(6,6,brow);set(8,6,brow);set(5,6,brow);set(9,6,brow)}
  set(7,8,skD);if(roll(s,5)<.5)set(7,7,skL); // nose
  const lip=mix(skDD,'#7a2a2a',.35),ms=pick(s,6,3);
  if(ms===0)row(9,6,8,lip);else if(ms===1)set(7,9,lip);else{set(6,9,lip);set(7,9,lip)}
  if(race==='ashfolk'){set(6,9,WHITE);set(8,9,WHITE);set(7,9,lip);set(6,8,mix(WHITE,skin,.3))} // tusks
  if(race==='tarrow'&&roll(s,7)<.7){set(5,8,skD);set(9,8,skD);set(6,8,skD)} // freckles
  if(race==='hallowan'&&roll(s,8)<.4){set(5,8,mix(skin,'#e07a6a',.35));set(9,8,mix(skin,'#e07a6a',.35))} // ruddy cheeks
  if(roll(s,9)<.12)set(9,9,skDD); // a scar or mole

  // beard (some peoples more than others; never on a masked rogue, drawn before the mask)
  const beardChance=race==='hallowan'||race==='tarrow'?.4:race==='ashfolk'||race==='thornhide'?.35:race==='skerrin'?.25:.1;
  const beard=roll(s,10)<beardChance,bs2=pick(s,11,3);
  if(beard){
    if(bs2===0){row(10,jaw?4:5,jaw?10:9,hair);row(11,jaw?5:6,jaw?9:8,hair);row(12,6,8,hrD);set(7,9,lip);set(6,9,hair);set(8,9,hair)} // full
    else if(bs2===1){set(7,10,hair);set(7,11,hair);row(11,6,8,hair);set(7,12,hrD)} // goatee
    else{set(6,9,hair);set(8,9,hair);set(5,9,hrD);set(9,9,hrD)} // moustache
    if(race==='ashfolk'){set(6,9,WHITE);set(8,9,WHITE)}
  }

  // hair styles (0 short, 1 parted, 2 long, 3 topknot, 4 shaved, 5 crest, 6 braids, 7 wild)
  let st=pick(s,12,8);
  if(race==='mirekin'&&st===2)st=4; // fins, not long hair
  const cap=()=>{row(2,5,9,hair);row(3,4,10,hair);row(4,4,10,hair);set(4,5,hair);set(10,5,hrD);set(4,6,hair);set(10,6,hrD);row(2,5,7,hrL);set(4,3,hrL)};
  if(st===0){cap()}
  else if(st===1){cap();row(4,7,9,skin);set(10,4,hair);set(9,4,skL)}
  else if(st===2){cap();for(let y=4;y<=13;y++){set(3,y,y>9?hrD:hair);set(11,y,hrD)}set(4,10,hair);set(10,10,hrD);set(2,12,hrD);set(12,12,hrD);set(3,7,hair);set(11,7,hrD);set(3,8,hair);set(11,8,hrD)}
  else if(st===3){cap();row(1,6,8,hair);set(7,0,hrD);set(6,1,hrL)}
  else if(st===4){row(3,5,9,skin);set(5,3,skL);row(4,4,10,skin);set(10,4,skD);row(3,6,8,mix(skin,hair,.25))} // shaved, a shadow of stubble
  else if(st===5){row(3,5,9,skin);row(4,4,10,skin);set(10,4,skD);for(let y=0;y<=4;y++){set(6,y,y<2?null:hair);set(7,y,hair);set(8,y,y<1?null:hrD)}set(6,4,skin)}
  else if(st===6){cap();for(let y=5;y<=13;y++){set(3,y,y%2?hair:hrD);set(11,y,y%2?hrD:mul(hair,.55))}set(3,14,c.acc);set(11,14,c.acc)}
  else{cap();row(1,5,9,null);set(5,1,hair);set(7,1,hrL);set(9,1,hair);for(let y=3;y<=7;y++){set(3,y,hair);set(11,y,hrD)}set(2,4,hair);set(12,4,hrD);set(4,4,hrL)}

  if(race==='thornhide'){set(4,2,BONE);set(4,1,mix(BONE,'#ffffff',.3));set(10,2,mul(BONE,.75));set(10,1,BONE)} // horn nubs

  // class headgear and marks
  if(helm){
    const sL=mix(c.acc,'#ffffff',.45),sM=c.acc,sD=mul(c.acc,.62);
    row(1,5,9,sM);row(2,4,10,sM);row(3,3,11,sM);row(4,3,11,sM);row(5,3,11,sD); // dome and brow band
    set(5,1,sL);set(4,2,sL);set(5,2,sL);set(3,3,sL);set(9,1,sD);set(10,2,sD);set(11,3,sD);set(11,4,sD);
    row(5,3,11,mul(sM,.82));set(3,5,sM);
    for(let y=6;y<=9;y++){set(3,y,y<8?sM:sD);set(11,y,sD)} // cheek guards
    set(4,9,sM);set(10,9,sD);
    set(7,6,sM);set(7,7,sM);set(7,8,sD); // nasal
    set(7,0,tank?c.wep:null); // the tank's crest
    if(tank){set(7,0,f.color);set(6,0,f.color);set(8,0,f.dark)}
    if(race==='thornhide'){set(2,2,BONE);set(12,2,mul(BONE,.75))}
  }else if(a.cls==='Mage'){
    const hd=c.head,hL=mix(hd,'#ffffff',.2),hD=mul(hd,.65);
    row(0,6,8,hd);row(1,5,9,hd);row(2,4,10,hd);row(3,3,11,hd);set(5,1,hL);set(4,2,hL);set(3,3,hL);set(9,1,hD);set(10,2,hD);set(11,3,hD);
    for(let y=4;y<=12;y++){set(3,y,y<6?hL:hd);set(11,y,hD)}set(2,12,hd);set(12,12,hD);set(2,11,hd);set(12,11,hD);
    row(4,4,10,hair);set(4,5,hair);set(10,5,hrD);if(st===1)row(4,7,9,skin);
    set(7,3,c.orb); // a gem at the brow of the hood
  }else if(a.cls==='Priest'){
    const g=c.wep,gD=mul(c.wep,.7);if(st===4||st===5){row(4,4,10,skin);set(10,4,skD)}
    row(4,4,10,g);set(10,4,gD);set(7,4,c.orb);set(7,3,mix(c.orb,'#ffffff',.5));
  }else if(a.cls==='Hunter'){
    if(roll(s,13)<.5){const hd=c.head,hL=mix(hd,'#ffffff',.2),hD=mul(hd,.65);
      row(1,5,9,hd);row(2,4,10,hd);row(3,3,11,hd);set(5,1,hL);set(4,2,hL);set(10,2,hD);set(11,3,hD);
      for(let y=4;y<=11;y++){set(3,y,hd);set(11,y,hD)}set(3,4,hL);row(4,4,10,hair);set(4,5,hair);set(10,5,hrD);if(st===1)row(4,7,9,skin)}
    else{set(11,1,c.acc);set(11,2,c.acc);set(12,0,mix(c.acc,'#ffffff',.3));set(10,3,'#8a5a2a')} // a feather in the hair
  }else if(a.cls==='Rogue'){
    if(roll(s,14)<.5){row(7,4,10,c.head);row(6,4,10,mul(c.head,1.4));set(5,7,'#e8e0d0');set(9,7,'#e8e0d0');set(3,7,c.head);set(11,7,c.head);set(2,8,c.head)} // eye mask, tails at the side
    else{row(9,4,10,c.head);row(10,4,10,c.head);row(11,5,9,c.head);row(12,6,8,mul(c.head,.8));set(4,9,mul(c.head,1.5))} // scarf over the mouth
  }else if(a.cls==='Skald'){
    const hd=c.head,hD=mul(hd,.7);row(2,5,9,hd);row(3,4,10,hd);set(4,3,mix(hd,'#ffffff',.25));set(10,3,hD);row(4,3,11,hD);set(3,4,hd);
    set(10,1,c.acc);set(11,0,c.acc);set(11,1,mix(c.acc,'#ffffff',.3));set(9,2,c.orb);
  }else if(a.cls==='Wildspeaker'){
    const lf=c.orb,lD=c.acc;set(4,2,lf);set(4,1,lD);set(7,1,lf);set(7,0,lD);set(6,1,lD);set(10,2,lD);set(10,1,lf);set(8,1,lf);
  }

  // outline: every empty pixel touching the figure; then the backdrop behind it
  const O=P.slice();
  for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(!P[y*W+x]&&(get(x-1,y)||get(x+1,y)||get(x,y-1)||get(x,y+1)))O[y*W+x]=OUTLINE;
  const back=mix(BG,f.dark,.22),back2=mix(BG,f.dark,.12);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(!O[y*W+x])O[y*W+x]=y<H/2?back:back2;
  if(mode==='dead')return O.map(GREY);
  if(mode==='ghost')return O.map(v=>v===OUTLINE?'#203048':GHOST(v));
  return O}

// ---- the portrait library (#710) ----
// The library face for hero a (an asset id), or null: its people and class first, then its people, then none.
export function libraryFace(a){const race=a&&a.race;if(!race)return null;
  let pool=portraitAssets(race,a.cls);if(!pool.length)pool=portraitAssets(race);if(!pool.length)return null;
  return pool[Math.floor(hash(seedOf(a),710,6151)*pool.length)%pool.length]}
// The face frame on screen (CSS px): every place that shows a face uses this box (frames, sheet, roster).
export const FRAME_W=PORTRAIT_W*2,FRAME_H=PORTRAIT_H*2;
// A library face as tw x th pixels ('#rrggbb', never null): the image in a 5:6 frame (as wide as the image, bottom-aligned),
// the faction backdrop of the code face behind it, the mode's tint, then an area resample to tw x th. p: assetPixels().
export function libraryPixels(a,p,mode='',tw=FRAME_W,th=FRAME_H){
  const f=FAC[a.fac]||FAC[0],back=mix(BG,f.dark,.22),back2=mix(BG,f.dark,.12);
  const sw=p.w,sh=Math.max(p.h,Math.round(p.w*th/tw)),top=sh-p.h,tint=mode==='dead'?GREY:mode==='ghost'?GHOST:null;
  const src=new Array(sw*sh);
  for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){const v=y>=top?p.hex[(y-top)*p.w+x]:null;src[y*sw+x]=v||(y<sh/2?back:back2)}
  const R=new Float64Array(3),out=new Array(tw*th),kx=sw/tw,ky=sh/th;
  for(let ty=0;ty<th;ty++)for(let tx=0;tx<tw;tx++){ // area average: each source pixel weighted by how much of it the target pixel covers
    const x0=tx*kx,x1=x0+kx,y0=ty*ky,y1=y0+ky;let wsum=0;R[0]=R[1]=R[2]=0;
    for(let y=Math.floor(y0);y<Math.ceil(y1)&&y<sh;y++){const wy=Math.min(y1,y+1)-Math.max(y0,y);
      for(let x=Math.floor(x0);x<Math.ceil(x1)&&x<sw;x++){const w=wy*(Math.min(x1,x+1)-Math.max(x0,x));if(w<=0)continue;
        const [r,g,b]=rgb(src[y*sw+x]);R[0]+=r*w;R[1]+=g*w;R[2]+=b*w;wsum+=w}}
    const c=hex(R[0]/wsum,R[1]/wsum,R[2]/wsum);out[ty*tw+tx]=tint?tint(c):c}
  return out}

// A cached canvas per look (the key carries everything the pixels depend on). Browser only.
const cache=new Map();
onAssets(id=>{if(id==null||/^portrait:/.test(id))cache.clear()}); // a library face arrived (or the index changed)
// The head of a generated hero sheet (#862): sprites.js registers a function that gives the hero's front, standing frame
// ({img, sx, sy, fw, fh}) or null while no sheet is loaded; a living face then crops from it, else it is the pixel face
// below. (A hook, not an import, so Node can still read portraitPixels without the sprite module.)
let headSrc=null;
export function setHeadSource(fn){headSrc=fn}
export function portraitKey(a,mode=''){return [a.id,a.name,a.race||'',a.cls,a.fac,a.skin||'',a.hair||'',slotKeyOf(a)==='tank'?'T':'',mode].join('|')}
// Device pixels per CSS pixel for library faces (1 on the owner's screen; 2 or 3 on a dense one), whole.
const dpr=()=>Math.max(1,Math.min(3,Math.round((typeof devicePixelRatio==='number'&&devicePixelRatio)||1)));
// A W x H crop of the frame's head and shoulders at one art pixel per face pixel (the frames then show at 2x like the
// pixel faces), centred on the frame and starting a pixel above the crown, over the faction-tinted backdrop.
function headCrop(a,G){const c=document.createElement('canvas');c.width=W;c.height=H;const x=c.getContext('2d');
  const f=FAC[a.fac]||FAC[0];x.fillStyle=mix(BG,f.color,.16);x.fillRect(0,0,W,H);
  const t=document.createElement('canvas');t.width=G.fw;t.height=G.fh;const tx=t.getContext('2d');tx.drawImage(G.img,G.sx,G.sy,G.fw,G.fh,0,0,G.fw,G.fh);
  const d=tx.getImageData(0,0,G.fw,G.fh).data;let top=0;for(;top<G.fh;top++){let hit=false;for(let i=0;i<G.fw;i++)if(d[(top*G.fw+i)*4+3]>8){hit=true;break}if(hit)break}
  x.imageSmoothingEnabled=false;x.drawImage(t,Math.floor((G.fw-W)/2),Math.max(0,top-1),W,H,0,0,W,H);return c}
// A library face (a generated face for this hero) wins; else the head of the hero's generated sheet (#862); else the pixel face.
export function portrait(a,mode=''){const lib=libraryFace(a),p=lib&&assetPixels(lib),k=dpr(),G=!p&&!mode&&headSrc?headSrc(a):null,key=portraitKey(a,mode)+(p?'|'+lib+'|'+k:G?'|sheet':'');
  let c=cache.get(key);if(c)return c;
  if(G){c=headCrop(a,G);c._lib=null}
  else{const w=p?FRAME_W*k:W,h=p?FRAME_H*k:H,px=p?libraryPixels(a,p,mode,w,h):portraitPixels(a,mode);
    c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d'),img=x.createImageData(w,h);
    for(let i=0;i<px.length;i++){const v=px[i];if(!v)continue;const o=i*4;img.data[o]=parseInt(v.slice(1,3),16);img.data[o+1]=parseInt(v.slice(3,5),16);img.data[o+2]=parseInt(v.slice(5,7),16);img.data[o+3]=255}
    x.putImageData(img,0,0);c._lib=p?lib:null}
  if(cache.size>200)cache.clear();cache.set(key,c);return c}
