// Scene settings (#431, slice 1): the small indoor maps a Table scene can play out on. Pure data, no logic:
// src/world/interior.js buildSetting() turns a row into a tile map (deterministic from a seed), src/render/interior.js
// paints it with the row's theme (colours live in render/palette.js THEMES), and src/render/sceneview.js picks a row
// for a scene from its kind and place (slice 2 lets the DM name one with stage_scene `setting`).
//
// A row:
//   name     what the watcher reads on the scene bar
//   shape    'rect' one room; 'two' a main room and a side room behind a partition with a door; 'hull' a ship's hold
//            tapering to the bow; 'round' an octagon; 'cell' a room with a barred cell along its right side
//   w, h     the main room's floor in tiles, [min, max] (the seed picks)
//   side     ('two') the side room's width; ('cell') the barred cell's width
//   floor    'plank' boards, 'flag' flagstones, 'cobble' small setts, 'dirt' packed earth, 'hull' tarred deck planks with ribs
//   wall     'timber' plaster and beams, 'brick', 'rock' rough-cut stone, 'hull' the ship's side planks
//   theme    the palette row in render/palette.js THEMES
//   entry    'door' (a door in the front wall), 'stair' (a stair down from the back wall), 'ladder' (the hold's hatch)
//   dark     how dim the room is before its lights (0 lit, 1 black)
//   rug      [fx, fy, fw, fh] a rug as a share of the main room, or absent
//   dais     [fx, fw, fh] a raised floor at the back wall (chapel, shrine), or absent
//   props    furniture: {kind, at, fx, fy} placed in the main room ('floor': on the tile at the share fx, fy of the room;
//            'cast': the seat under the first cast spot; 'wall': hung on the back wall face at the share fx; 'side': in the side room or cell at fx, fy), or
//            {kind, scatter:[min, max], where:'edge'|'any'} dropped by the seed on free tiles
//   rows     pews or benches in rows: {kind, y0, y1, gap, aisle} (shares of the room, aisle down the middle)
//   cast     where the scene's people stand (the person the party meets first): [{fx, fy}]
//   party    the centre of the party's row: {fx, fy}
//   words    a scene whose title, frame or person matches these words is played here (render/sceneview.js)
export const SETTINGS={
  house:{name:'A house',shape:'two',w:[8,10],h:[6,7],side:[4,5],floor:'plank',wall:'timber',theme:'house',entry:'door',dark:.12,
    rug:[.25,.35,.5,.4],
    props:[{kind:'hearth',at:'wall',fx:.2},{kind:'shelf',at:'wall',fx:.75},{kind:'window',at:'wall',fx:.5},
      {kind:'table',at:'floor',fx:.5,fy:.45},{kind:'chair',at:'floor',fx:.2,fy:.45},{kind:'chest',at:'floor',fx:.95,fy:.1},
      {kind:'bed',at:'side',fx:.3,fy:.05},{kind:'chest',at:'side',fx:.5,fy:.95},{kind:'barrel',scatter:[1,2],where:'edge'}],
    cast:[{fx:.5,fy:.2}],party:{fx:.5,fy:.8},
    words:/\b(home|house|hall of|widow|family|kitchen|hearth|cottage|farm)/i},
  tavern:{name:'A tavern back room',shape:'rect',w:[10,12],h:[6,7],floor:'plank',wall:'timber',theme:'tavern',entry:'door',dark:.18,
    props:[{kind:'hearth',at:'wall',fx:.85},{kind:'lantern',at:'wall',fx:.35},{kind:'shelf',at:'wall',fx:.1},
      {kind:'longtable',at:'floor',fx:.45,fy:.45},{kind:'barrel',at:'floor',fx:0,fy:.2},{kind:'barrel',at:'floor',fx:0,fy:.55},
      {kind:'cask',at:'floor',fx:1,fy:.95},{kind:'stool',scatter:[2,3],where:'any'},{kind:'crate',scatter:[1,2],where:'edge'}],
    cast:[{fx:.45,fy:.15}],party:{fx:.45,fy:.8},
    words:/\b(tavern|inn|ale|mead|drink|rumou?r|bargain|deal|cards|dice|wager|sellsword|bard|minstrel)/i},
  chapel:{name:'A chapel',shape:'rect',w:[9,11],h:[8,9],floor:'flag',wall:'brick',theme:'chapel',entry:'door',dark:.15,
    rug:[.45,.25,.1,.75],dais:[.5,.5,.2],
    props:[{kind:'altar',at:'floor',fx:.5,fy:0},{kind:'window',at:'wall',fx:.2},{kind:'window',at:'wall',fx:.8},
      {kind:'candle',at:'floor',fx:.25,fy:0},{kind:'candle',at:'floor',fx:.75,fy:0},{kind:'urn',scatter:[1,2],where:'edge'}],
    rows:{kind:'pew',y0:.35,y1:.8,gap:2,aisle:true},
    cast:[{fx:.5,fy:.28}],party:{fx:.5,fy:.92},
    words:/\b(chapel|temple|priest|pray|saint|altar|bless|confess|vigil|funeral|rite)/i},
  cellar:{name:'A cellar',shape:'rect',w:[8,10],h:[6,7],floor:'flag',wall:'rock',theme:'cellar',entry:'stair',dark:.42,
    props:[{kind:'rack',at:'wall',fx:.2},{kind:'rack',at:'wall',fx:.8},{kind:'lantern',at:'floor',fx:.5,fy:.5},
      {kind:'barrel',at:'floor',fx:0,fy:.4},{kind:'barrel',at:'floor',fx:0,fy:.7},{kind:'cask',at:'floor',fx:1,fy:.5},
      {kind:'crate',scatter:[2,3],where:'edge'},{kind:'sack',scatter:[1,2],where:'edge'}],
    cast:[{fx:.5,fy:.3}],party:{fx:.5,fy:.8},
    words:/\b(cellar|smuggl|cask|wine|hidden|secret|stash|under the)/i},
  cell:{name:'An interrogation cell',shape:'cell',w:[7,8],h:[5,6],side:[2,2],floor:'cobble',wall:'brick',theme:'cell',entry:'door',dark:.45,
    props:[{kind:'table',at:'floor',fx:.5,fy:.5},{kind:'chair',at:'cast'},{kind:'chains',at:'wall',fx:.2},
      {kind:'torch',at:'wall',fx:.65},{kind:'straw',at:'side',fx:.5,fy:.5},{kind:'bucket',at:'side',fx:.5,fy:.95},{kind:'stool',at:'floor',fx:.1,fy:.9}],
    cast:[{fx:.5,fy:.25}],party:{fx:.5,fy:.85},
    words:/\b(cell|prison|interrog|question|captive|suspect|jail|gaol|chains|confession|cage)/i},
  shrine:{name:'A shrine',shape:'round',w:[9,10],h:[8,9],floor:'flag',wall:'rock',theme:'shrine',entry:'door',dark:.3,
    dais:[.5,.34,.34],
    props:[{kind:'idol',at:'floor',fx:.5,fy:.12},{kind:'brazier',at:'floor',fx:.22,fy:.2},{kind:'brazier',at:'floor',fx:.78,fy:.2},
      {kind:'basin',at:'floor',fx:.5,fy:.55},{kind:'candle',scatter:[2,3],where:'edge'},{kind:'offering',scatter:[1,2],where:'edge'}],
    cast:[{fx:.5,fy:.38}],party:{fx:.5,fy:.88},
    words:/\b(shrine|idol|offering|spirit|oracle|grove|old gods?|ward-?stone|pilgrim|hermit)/i},
  hold:{name:'A ship\'s hold',shape:'hull',w:[12,14],h:[6,7],floor:'hull',wall:'hull',theme:'hold',entry:'ladder',dark:.4,
    props:[{kind:'lantern',at:'floor',fx:.45,fy:.45},{kind:'hammock',at:'floor',fx:.1,fy:.15},{kind:'cask',at:'floor',fx:.1,fy:.9},
      {kind:'crate',scatter:[3,4],where:'edge'},{kind:'barrel',scatter:[2,3],where:'edge'},{kind:'rope',scatter:[1,1],where:'any'}],
    cast:[{fx:.6,fy:.4}],party:{fx:.4,fy:.75},
    words:/\b(ship|hold|dock|sail|harbou?r|cargo|deck|boat|barge|quay|wharf)/i},
  smithy:{name:'A smithy',shape:'rect',w:[9,11],h:[6,7],floor:'flag',wall:'brick',theme:'smithy',entry:'door',dark:.22,
    props:[{kind:'hearth',at:'wall',fx:.5},{kind:'rack',at:'wall',fx:.15},{kind:'rack',at:'wall',fx:.85},{kind:'window',at:'wall',fx:.75},
      {kind:'table',at:'floor',fx:.2,fy:.5},{kind:'barrel',at:'floor',fx:1,fy:.4},{kind:'bucket',at:'floor',fx:.82,fy:.3},
      {kind:'crate',scatter:[1,2],where:'edge'},{kind:'sack',scatter:[1,1],where:'edge'}],
    cast:[{fx:.5,fy:.3}],party:{fx:.5,fy:.82}},
  gate:{name:'A gatehouse',shape:'rect',w:[9,11],h:[6,7],floor:'flag',wall:'rock',theme:'gate',entry:'door',dark:.28,
    props:[{kind:'torch',at:'wall',fx:.2},{kind:'torch',at:'wall',fx:.8},{kind:'rack',at:'wall',fx:.5},
      {kind:'table',at:'floor',fx:.5,fy:.45},{kind:'chair',at:'cast'},{kind:'bench',at:'floor',fx:.1,fy:.8},
      {kind:'crate',scatter:[1,2],where:'edge'},{kind:'barrel',scatter:[1,1],where:'edge'}],
    cast:[{fx:.5,fy:.25}],party:{fx:.5,fy:.82}},
};
export const SETTING_IDS=Object.keys(SETTINGS);
// Floor footprint of a prop in tiles [w, h] (what the generator keeps free around it); a prop not listed takes one tile.
// 'pew' takes its own length (rows). Wall props (hearth, shelf, window, rack, chains, torch) hang on the wall face.
export const FOOT={table:[2,1],longtable:[4,1],bed:[1,2],altar:[2,1],idol:[1,1],hammock:[2,1],basin:[1,1],straw:[1,1]};

// Outdoor settings (#431, slice 3): a scene that breaks out where the company camps plays on the real ground round the
// fire, not in a generated room (owner: outdoor scenes match the landscape). render/sceneview.js frames a small cut of the
// overworld round the fire (the chunk terrain, the weather and the night as they are), and render/camp.js keeps the fire,
// the stone ring and the bedrolls drawn while the scene lasts, even when an ambush broke the camp. A row:
//   name     what the watcher reads on the scene bar ("A camp in <region>")
//   cut      [w, h] the smallest cut in tiles, centred on the fire (it grows to take in everyone in the scene)
//   kinds    the scene kinds that play here when they carry ctx.camp {x, y} (sim/camp.js, sim/fireside.js)
export const OUTDOOR_SETTINGS={
  camp:{name:'A camp',cut:[13,9],kinds:['fireside','ambush','interrogation']},
};
