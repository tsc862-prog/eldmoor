// Scene props (issue #592): the small objects a scene's frame can name. Pure data. Order matters: the first kind whose words
// appear wins the drawing; `look` is what examine says of it (the item, if the DM put one in it, is found with search).
export const PROP_KINDS=[
  {id:'candle',name:'the candle stub',re:/\bcandle(s|[- ]stub)?|taper|wax\b/i,look:'a stub of tallow candle, its wick black and its wax run in drips'},
  {id:'letter',name:'the letter',re:/\b(letter|note|missive|parchment|scroll|deed|writ)\b/i,look:'a folded sheet gone soft at the creases, the seal broken once and pressed shut again'},
  {id:'key',name:'the key',re:/\bkeys?\b/i,look:'an iron key worn bright where fingers hold it'},
  {id:'ring',name:'the ring',re:/\b(ring|signet|locket|amulet|pendant)\b/i,look:'a small piece of worn metalwork on a thread of cord'},
  {id:'pouch',name:'the pouch',re:/\b(pouch|purse|coin(s)?|gold)\b/i,look:'a drawstring pouch, lighter than it looks'},
  {id:'book',name:'the book',re:/\b(book|tome|ledger|journal|diary)\b/i,look:'a thumbed book with a cracked spine and a ribbon mark'},
  {id:'vial',name:'the vial',re:/\b(vial|phial|potion|bottle|flask)\b/i,look:'a stoppered glass vial, its contents slow to settle'},
  {id:'dagger',name:'the dagger',re:/\b(dagger|knife|blade)\b/i,look:'a plain dagger, the edge kept well and the hilt wrapped in old leather'},
  {id:'map',name:'the map',re:/\bmap\b/i,look:'a hand-drawn map, inked over scratchings-out'},
  {id:'lantern',name:'the lantern',re:/\blantern\b/i,look:'a horn lantern with a low, steady flame'},
];
