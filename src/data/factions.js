// Factions, guild roster and hero name generation. Owned by character-builder.
import {pickA} from '../core/rng.js';

export const FAC=[{name:'Concord',color:'#5b8ff2',dark:'#2a4fa0',skin:['#f0c8a0','#d8a878','#b88058']},
                  {name:'Warband',color:'#e8544a',dark:'#8a2420',skin:['#8fb070','#a08c6c','#7a9a88']}];
export const GUILD_DEFS=[{name:'Silver Vow',tag:'SV',fac:0},{name:'Dawnriders',tag:'DR',fac:0},{name:'Bloodfang',tag:'BF',fac:1},{name:'Ashen Fist',tag:'AF',fac:1}];

const NAMES=[[['Al','Bren','Cor','Dar','El','Fen','Gal','Hal','Isa','Jor','Kae','Lor','Mir','Nor','Pell','Quin','Ros','Syl','Tor','Val','Wyn','Ari','Cae','Lys'],['a','en','ic','ion','ara','eth','wyn','dor','is','iel','ric','anne','ius','ora']],
  [['Gor','Thrak','Ur','Zug','Mog','Kar','Grim','Drak','Vor','Rok','Skar','Bru','Nar','Gash','Krul','Ozz','Rag','Vex'],['ash','gul','nok','rek','tusk','mar','dul','zar','osh','ga','ka','thar','rim','gash']]];
const used=new Set();
export function genName(f){let n,k=0;do{n=pickA(NAMES[f][0])+pickA(NAMES[f][1]);if(++k>40)n+=' '+pickA(['II','III','IV','V','VI'])}while(used.has(n));used.add(n);return n}
