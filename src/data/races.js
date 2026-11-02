// The peoples of Eldmoor: every hero belongs to a race within their faction.
// Owned by character-builder. Cultures and names are recorded in docs/LORE.md
// ("Peoples of Eldmoor").
//
// Each race: {id, name (also the adjective: "an Ashfolk warrior"), plural, fac,
//   home (the town name of their home town; falls back to the faction's first town
//   until the spec has it), skin and hair palettes, names [prefixes, suffixes],
//   abil (the ability score this people leans +1 toward, data/abilities.js),
//   culture (one line), lean {cls: weight} (which classes this people tends to
//   field; default weight 1)}.
//
// This file is mostly data, but it also owns the two lookups that every module
// uses to go from a hero to their people and their home town: assignRace(a) and
// homeOf(a). Nothing here hard-codes the number of races, factions or towns.
import {rnd,pickA} from '../core/rng.js';
import {CITY} from '../world/map.js';

export const RACES=[
  // ---- The Concord ----
  {id:'hallowan',abil:'presence',name:'Hallowan',plural:'Hallowans',fac:0,home:'Highgate',
    skin:['#f0c8a0','#d8a878','#b88058','#e8b890'],hair:['#5a3a22','#c89a4a','#8a4a2a','#2a2020'],
    names:[['Al','Bren','Cor','Dar','Em','Fen','Gar','Hal','Isa','Jor','Kae','Lor','Mir','Nor','Pell','Quin','Ros','Syl','Tor','Val','Wyn','Ari','Cae','Lys'],
           ['a','en','ic','ion','ara','eth','wyn','dor','is','iel','ric','anne','ius','ora']],
    culture:'River-valley farmers, millers and ledger-keepers of the hedged lowlands around Highgate; swear by the harvest and bury their dead facing the water.',
    lean:{Warrior:1.3,Priest:1.3}},
  {id:'tarrow',abil:'insight',name:'Tarrow',plural:'Tarrows',fac:0,home:'Cairnmoot',
    skin:['#d9a07c','#c08a62','#a8724e','#e6b494'],hair:['#7a3a1e','#1e1a1c','#c8b890','#4a2a1a'],
    names:[['Bran','Cael','Dun','Eyr','Gwil','Hest','Ivo','Kerr','Mael','Nev','Osw','Rhos','Tam','Ulf','Wick','Ael','Dov','Garr'],
           ['ach','wen','ith','ys','an','on','od','ock','rhi','agh','ett','ow','as','ell']],
    culture:'Highland herders and hedge-wardens of the thorn ridges; taciturn, long-memoried, and the Concord’s best bowmen.',
    lean:{Hunter:1.8,Warrior:1.1}},
  {id:'skerrin',abil:'wits',name:'Skerrin',plural:'Skerrins',fac:0,home:'Brinereach',
    skin:['#f2d6c0','#e0bfa8','#c9a58e','#f6e0d0'],hair:['#1c1a20','#6a2a24','#9aa0a8','#3a2e3c'],
    names:[['Mar','Osk','Hael','Tev','Brin','Sael','Ker','Lun','Ald','Fin','Wren','Thess','Ebb','Gull','Nell','Pike','Sorr','Vey'],
           ['a','ir','wen','is','ric','ald','ley','ora','in','eth','mund','wy','ane','ish']],
    culture:'Fisherfolk and net-menders of the salt reaches; read weather in gull-flight, pay their debts to the tide and to each other, and favour the staff and the knife over the sword.',
    lean:{Mage:1.5,Rogue:1.3}},
  // ---- The Warband ----
  {id:'ashfolk',abil:'brawn',name:'Ashfolk',plural:'Ashfolk',fac:1,home:'Grimhold',
    skin:['#8fb070','#a08c6c','#7a9a88','#6e8a5a'],hair:['#1a1616','#4a4a50','#7a3a24','#2c2420'],
    names:[['Gor','Thrak','Ur','Zug','Mog','Kar','Grim','Drak','Vor','Rok','Skar','Bru','Norr','Gash','Krul','Ozz','Rag','Vex'],
           ['ash','gul','nok','rek','tusk','mar','dul','zar','osh','ga','ka','tharn','rim','gash']],
    culture:'Crag-dwellers of the ridges above Grimhold; raised in the fighting pits, measure worth in scars, and stand as the Warband’s shield wall.',
    lean:{Warrior:1.8,Rogue:.8}},
  {id:'mirekin',abil:'reflex',name:'Mirekin',plural:'Mirekin',fac:1,home:'Murkstead',
    skin:['#5f8e6e','#6fa08a','#4e7a66','#7fae8e'],hair:['#101c18','#2e5a40','#d8d8c8','#1e3028'],
    names:[['Ssath','Vull','Mur','Ool','Quag','Nesh','Ith','Zhal','Bog','Hrul','Mire','Ssil','Ulg','Vosh','Lurk','Nagg','Yss','Thul'],
           ['ith','esh','ul','oss','ar','aque','im','en','oth','aal','isk','ug','ael','ott']],
    culture:'Marsh-born trappers and salt-boilers of the fen margins; patient, poisonous, keep their dead in the water and their grudges longer.',
    lean:{Priest:1.6,Rogue:1.4,Mage:1.2}},
  {id:'thornhide',abil:'grit',name:'Thornhide',plural:'Thornhides',fac:1,home:'Thornteeth',
    skin:['#a8784a','#8e6238','#b88a5c','#7a5230'],hair:['#2a1c14','#5a3c24','#8a7a60','#161210'],
    names:[['Hrak','Dur','Mogg','Orv','Sketh','Varn','Yurr','Kez','Bral','Tusk','Garn','Hodd','Rhuk','Snagg','Ulv','Wrack','Zeb','Korr'],
           ['ak','orn','ug','ar','ish','ekk','ol','un','agh','ir','ott','ask','ur','eng']],
    culture:'Ridge-walkers and bone-carvers of the Thornteeth; trade skins for steel and will track a foe across three zones for the story of it.',
    lean:{Hunter:1.8,Rogue:1.1}},
];

const byId={};for(const r of RACES)byId[r.id]=r;
export const raceOf=a=>byId[a.race]||RACES.find(r=>r.fac===a.fac)||RACES[0];
export const racesOf=f=>RACES.filter(r=>r.fac===f);

// Names: one shared pool so no two heroes, living or dead, ever share a name.
const used=new Set();
// Restored worlds: put every saved name (living or fallen) back in the pool, and give a living
// hero who shares a name with another a numeral, so no two in one group are ever alike.
export function reserveNames(heroes,fallen=[]){used.clear();for(const f of fallen)if(f&&f.name)used.add(f.name);
  const seen=new Set();for(const a of heroes){if(!a||!a.name)continue;let n=a.name;if(seen.has(n)){let k=2;while(seen.has(n+' '+['','','II','III','IV','V','VI','VII'][k])&&k<7)k++;n=n+' '+['','','II','III','IV','V','VI','VII'][k];a.name=n}seen.add(n);used.add(n)}}
export function raceName(r){let n,k=0;do{n=pickA(r.names[0])+pickA(r.names[1]);if(++k>40)n+=' '+pickA(['II','III','IV','V','VI'])}while(used.has(n));used.add(n);return n}

// Pick a people for a new hero: the faction's races weighted to keep the living roster
// (the heroes passed in, normally S.agents) roughly even, nudged by the class lean
// (a Tarrow hunter is likelier than a Tarrow mage).
export function assignRace(a,roster=[]){
  const rs=racesOf(a.fac);if(!rs.length)return a;
  const live={};for(const b of roster)if(b.fac===a.fac&&b.state!=='dead'&&b.race)live[b.race]=(live[b.race]||0)+1;
  const w=rs.map(r=>(r.lean&&r.lean[a.cls]||1)/(1+(live[r.id]||0)));
  let t=rnd()*w.reduce((s,x)=>s+x,0),r=rs[rs.length-1];for(let i=0;i<rs.length;i++){t-=w[i];if(t<0){r=rs[i];break}}
  a.race=r.id;a.skin=pickA(r.skin);a.hair=pickA(r.hair);a.name=raceName(r);a.town=homeOf(a).name;return a}

// A hero's home town: the town they are recorded in (a.town), else their people's home
// town if the spec has it, else the first town of their faction. The gate, graveyard,
// auction house and quest giver all come from here; never from CITY[a.fac].
const townCache={};
export function homeOf(a){
  const r=raceOf(a),k=(a.town||'')+'|'+r.id+'|'+a.fac;if(townCache[k])return townCache[k];
  const t=(a.town&&CITY.find(c=>c.name===a.town))||CITY.find(c=>c.race===r.id)||CITY.find(c=>c.name===r.home)||CITY.find(c=>c.fac===a.fac)||CITY[0];
  return townCache[k]=t}
