// Search words (issue #155, shared with #153): no imports, so any memory module can use it without import cycles.
// Words of a text: lower case, letters and digits, 3+ characters, minus the commonest words.
const STOP=new Set('the and for with that this from have has had was were are you your our their them they his her him she its not but all any can will would into onto out about who what when where why how than then there here one two some more most very just also over under after before again'.split(' '));
export const words=s=>String(s||'').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>=3&&!STOP.has(w));
