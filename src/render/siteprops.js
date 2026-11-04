// Props for DM-made dungeon sites (#642, the dungeon view of a generated site): pixel strings baked into a site's
// interior texture by render/interior.js, beside the crypt's own (bones, pillars, candles, urns) and the scene
// furniture (render/furniture.js: chests, barrels, crates, altars, idols). Drawn by hand in the Eldmoor style: light
// from the top left (highlight up and left, shade down and right); the caller adds the dark outline unless `flat`.
//
// SITEP[kind] = {rows | make(), map(theme) -> palette, ox, oy, light?, flat?}
//   ox, oy  pixel offset of the sprite's top left from its tile's top left. Wall pieces (banner, sconce, niche, shoring,
//           roots) sit on the wall face tile, the row above a chamber's floor.
//   light   'warm' (fire), 'crypt' (spirit fire), 'cold' (ore glow); flat: no outline (rails lie in the floor)
// Colours that belong to a site's look (cloth, wood, stone) come from its theme (render/palette.js THEMES site-*).
const hex=c=>'#'+c.map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
const wood=th=>({L:hex(th.wood[0]),M:hex(th.wood[1]),S:hex(th.wood[2]),D:hex(th.wood[2].map(v=>v*.6))});
const IRON={I:'#a8a8b4',i:'#5a5a66',K:'#2e2e36'};
const stone=th=>({H:hex(th.wallFace[0].map(v=>v*1.15+8)),L:hex(th.wallFace[0]),M:hex(th.wallFace[1]),S:hex(th.wallFace[2]),D:hex(th.wallTop[1])});

// rails along a mine corridor: two iron rails on wooden ties, one tile long
const rail=v=>()=>{const out=[];for(let y=0;y<16;y++){let r='';for(let x=0;x<16;x++){const a=v?y:x,b=v?x:y,tie=(a&3)===1;
  r+=b===4||b===10?'I':b===5||b===11?'i':tie&&b>=3&&b<=12?(b===3?'L':b===12?'S':'M'):'.'}out.push(r)}return out};

export const SITEP={
  // ---- fortress ----
  banner:{rows:[
    'KKKKKKKKKKKK',
    '.LMMMMMMMMS.',
    '.LMMMMMMMMS.',
    '.LMMMYYMMMS.',
    '.LMMYYYYMMS.',
    '.LMMMYYMMMS.',
    '.LMMMYYMMMS.',
    '.LMMMMMMMMS.',
    '.LMMMMMMMMS.',
    '.LMMMSSMMMS.',
    '.LMMS..LMMS.',
    '.LMS....LMS.',
    '.LS......SS.'],map:th=>({K:'#2a2228',L:hex(th.rug[0].map(v=>v*1.25+12)),M:hex(th.rug[0]),S:hex(th.rug[1]),Y:hex(th.rug[2])}),ox:2,oy:2},
  weapons:{rows:[
    '..W....W....W...',
    '.WIW..WIW..WIW..',
    '..I....I....I...',
    '..I....I....I...',
    'LLLLLLLLLLLLLLLS',
    '..I....I....I...',
    '..I....I....I...',
    '..M....M....M...',
    '..M....M....M...',
    'LLLLLLLLLLLLLLLS',
    '.D............D.',
    '.D............D.'],map:th=>({...wood(th),W:'#e8ecf4',I:'#a8a8b4'}),ox:0,oy:-2},
  sconce:{rows:[
    '..F..',
    '.FYF.',
    '.YWY.',
    '..Y..',
    'KKKKK',
    '.KLK.',
    '..L..',
    '..S..'],map:()=>({F:'#ff8a3a',Y:'#ffd866',W:'#fff6d0',K:'#3a3a44',L:'#8a6040',S:'#5a3a20'}),ox:5,oy:5,light:'warm'},
  // ---- barrow ----
  niche:{rows:[
    '...SSSSSS...',
    '..SKKKKKKL..',
    '.SKKKKKKKKL.',
    '.SKKWWWKKKL.',
    '.SKWDWDWKKL.',
    '.SKKWWWKKKL.',
    '.SKKKWKKKKL.',
    '.SKKKKKKKKL.',
    '.SBBBBBBBBL.',
    '.LLLLLLLLLL.'],map:th=>({...stone(th),K:'#14121a',W:'#e8e4d8',D:'#14121a',B:'#8a8678'}),ox:2,oy:4},
  // ---- mine ----
  railh:{make:rail(false),map:th=>({...wood(th),...IRON}),ox:0,oy:0,flat:true},
  railv:{make:rail(true),map:th=>({...wood(th),...IRON}),ox:0,oy:0,flat:true},
  cart:{rows:[
    '...OoO.OOo....',
    '.OOoOOOoOOoO..',
    'IIIIIIIIIIIIIi',
    'IMMMMMMMMMMMMi',
    'IMMMiMMMMiMMMi',
    'IMMMMMMMMMMMMi',
    'iiiiiiiiiiiiii',
    '.KK.......KK..',
    'KiiK.....KiiK.',
    '.KK.......KK..'],map:()=>({...IRON,M:'#7a6a5a',O:'#c08a50',o:'#e8c070'}),ox:1,oy:5},
  shoring:{rows:[
    'LLLLLLLLLLLLLLLS',
    'LMMMMMMMMMMMMMMS',
    'SSSSSSSSSSSSSSSS',
    '.LMS.......LMS..',
    '.LMS.......LMS..',
    '.LMS.......LMS..',
    '.LMS.......LMS..',
    '.LMS.......LMS..',
    '.LMS.......LMS..',
    '.LMS.......LMS..',
    '.LMS.......LMS..',
    '.LMS.......LMS..',
    '.LMS.......LMS..',
    '.SSS.......SSS..'],map:wood,ox:0,oy:2},
  ore:{rows:[
    '.....HL.....',
    '...HLMMLo...',
    '..LMoMMMSL..',
    '.LMMMMOMMSS.',
    'LMOMMMMMoMMS',
    'SSSSSSSSSSSS'],map:th=>({...stone(th),O:'#e0b060',o:'#7ad0e0'}),ox:2,oy:9},
  crystal:{rows:[
    '......W.......',
    '.....WCc......',
    '.....CCc...W..',
    '..W..CCc..WCc.',
    '.WCc.CCcc.CCc.',
    '.CCc.CCcc.CCc.',
    '.CCcCCCCccCCc.',
    'LCCcCCCCccCCcS',
    'LMMMMMMMMMMMMS',
    'SSSSSSSSSSSSSS'],map:th=>({...stone(th),W:'#f0f4ff',C:'#8ab0ff',c:'#4a5ac8'}),ox:1,oy:2,light:'cold'},
  // ---- den ----
  nest:{rows:[
    '....LMLMLMLML.....',
    '..LMSMSLMSMSMSL...',
    '.LMSWWWDDDDDDMSL..',
    'LMSDDDDDWEWDDDMSL.',
    'LMSDDWEWDDDDDDDMS.',
    'LMSDDDDDDDDWWDDMS.',
    '.SMSDDDDDDDDDDMSS.',
    '..SSMSMSMSMSMSS...',
    '....SSSSSSSSS.....'],map:()=>({L:'#a88a5a',M:'#7a6040',S:'#4a3820',D:'#2a2018',W:'#e8e4d8',E:'#c8c0a8'}),ox:-1,oy:5},
  roots:{rows:[
    'MMMMMMMMMMMMMMMM',
    '.MS.MMS..MS.MS..',
    '.MS..MS..M..MS..',
    '..S..M...MS..S..',
    '..S..MS...S..S..',
    '.....S....S.....',
    '.....S.....S....',
    '...........S....'],map:()=>({M:'#6a5034',S:'#3e2c1c'}),ox:0,oy:2},
  // ---- ruin ----
  rubble:{rows:[
    '....LMS.......',
    '..LMMMMS..LS..',
    '.LMMMSSS.LMMS.',
    'LMMSS.LMMMMMMS',
    'SSS..LMMMSSSSS',
    '.....SSSS.....'],map:stone,ox:1,oy:9},
  stump:{rows:[
    '.H.HH..H..',
    'HLLLLLHLLS',
    '.LLMMMMMS.',
    '.LMMMMMMS.',
    '.LMMMMMMS.',
    '.LMMMMMMS.',
    '.LMMMMMMS.',
    '.LMMMMMMS.',
    'HLLLLLLLLS',
    'SSSSSSSSSS'],map:stone,ox:3,oy:5},
  grass:{rows:[
    '.G..g.',
    '.Gg.gG',
    'GgGgG.',
    '.gGg..'],map:th=>({G:hex(th.moss||[90,130,70]),g:hex((th.moss||[90,130,70]).map(v=>v*.7))}),ox:5,oy:10,flat:true},
};
