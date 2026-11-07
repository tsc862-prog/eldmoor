// The world map screen's layout (#1013 slice 6, drawn by src/ui/worldmap.js): where each map of a campaign lies, as a table.
// Keyed by campaign (WORLD_ID, the starter map's id). A world with no row and no exits has nothing to show and the screen stays away.
//   lands  {id, x, y, w?, h?}: id a key of MAPS, or the id a planned chapter will have. x, y place its top left corner, in tiles of the
//          picture (one tile a pixel before the screen scales it). A built map's size comes from its spec; a planned one's from w, h.
//          A planned land has no name here on purpose: until it is built and heard of, the screen draws its outline and nothing else.
//   roads  {from, to, exit?}: a road between two lands. exit: the exit on `from` it leaves by, while that exit's far side is not built.
//          Roads between built maps need no row: the screen reads them from the specs' exits.
//   pad    tiles of sea and land round the picture (default 30).
export const ATLAS={
  // The chapters of #1013's slice 7b concept. Hollin in the south-west, Wendmouth north of it by the sea, Hawkwold east of it,
  // the Weirgate east of both, the Wend's Head at the far east.
  hollin:{
    lands:[
      {id:'wendmouth',x:40,y:30,w:150,h:68},
      {id:'hollin',x:56,y:190},
      {id:'hawkwold',x:258,y:190,w:150,h:66},
      {id:'weirgate',x:300,y:20,w:160,h:72},
      {id:'wendshead',x:510,y:80,w:160,h:76},
    ],
    roads:[
      {from:'wendmouth',exit:'east',to:'weirgate'},
      {from:'hawkwold',exit:'east',to:'weirgate'},
      {from:'weirgate',to:'wendshead'},
    ],
  },
  // Test fixture: the two linked maps of scripts/crossingcheck.mjs, for looking at a company past a crossing.
  testlinka:{pad:16,lands:[{id:'testlinka',x:0,y:0},{id:'testlinkb',x:60,y:0}]},
};
