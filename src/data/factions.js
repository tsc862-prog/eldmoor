// Factions, guild naming and hero names. Owned by character-builder. Peoples, skin and hair
// palettes and name syllables live in races.js; genName(f) stays as a wrapper.
// Guilds are not listed here: heroes found them (sim/guilds.js) and genGuild names them.
import {pickA,rnd,ri} from '../core/rng.js';
import {RACES,racesOf,raceName} from './races.js';

export const FAC=[{name:'Concord',color:'#5b8ff2',dark:'#2a4fa0'},
                  {name:'Warband',color:'#e8544a',dark:'#8a2420'}];
// Legacy palette: every skin tone of the faction's peoples (makeHero's first roll, before assignRace).
FAC.forEach((f,i)=>{f.skin=racesOf(i).flatMap(r=>r.skin)});

// The four guilds the world once began with. No longer seeded; retired canon names that may reappear.
export const OLD_GUILDS=['Silver Vow','Dawnriders','Bloodfang','Ashen Fist'];

// Guild naming vocabulary, in faction voice (indexed by faction, wraps round for new factions).
// Concord is formal and civic, Warband blunt and ugly. A name is a compound (stem + tail, 'The Fenwatch')
// or 'Adj Noun' ('Hearth Accord', 'Gutter Pact'), with 'The ' in front of the second form `the` of the time.
export const GUILD_VOICE=[
  {the:.8,compound:.4,
   stems:['Fen','Hearth','Reed','Lantern','Marsh','Ember','Tide','Oath','Stone','Dawn','Gate','Ford','Thorn','Bell','Heron'],
   tails:['watch','wardens','keepers','wrights','bearers','guard','banner','wake'],
   adjs:['Hearth','Amber','Silver','Quiet','Steadfast','Open','Hallowed','Gilded','Lantern','Evenfall','Green','Sworn'],
   nouns:['Accord','Covenant','Vigil','Compact','Circle','Assembly','Lantern','Fellowship','Charter','Oath']},
  {the:.4,compound:.15,
   stems:['Gut','Bone','Rust','Scab','Ash','Grim','Slag','Sour'],
   tails:['fang','gnash','maw','hide','rot','claw'],
   adjs:['Gutter','Bone','Rust','Black','Ash','Red','Grim','Sour','Iron','Broken','Cinder','Gore','Scab','Hollow'],
   nouns:['Pact','Tide','Fang','Hounds','Knives','Maw','Cleavers','Brood','Mob','Pit','Fist','Wolves']}];

// genGuild(f, taken): a fresh {name,tag} for faction f. taken(name,tag) says whether a living guild
// already wears either, so names and tags are unique among living guilds. Tags are 2-3 letters.
export function genGuild(f,taken=()=>false){const v=GUILD_VOICE[f%GUILD_VOICE.length];
  for(let n=0;n<80;n++){let a,b,name;
    if(rnd()<v.compound){a=pickA(v.stems);b=pickA(v.tails);name='The '+a+b}
    else{a=pickA(v.adjs);b=pickA(v.nouns);name=(rnd()<v.the?'The ':'')+a+' '+b}
    const t2=(a[0]+b[0]).toUpperCase();
    for(const tag of [t2,t2+b[b.length-1].toUpperCase(),t2+a[1].toUpperCase()])if(!taken(name,tag))return{name,tag}}
  return{name:'The Company of '+ri(100,999),tag:'X'+ri(10,99)}}

// A name for a hero of faction f from a random people of that faction. assignRace(a)
// re-rolls it from the hero's own people; this stays for callers that only know the faction.
export function genName(f){const rs=racesOf(f);return raceName(rs.length?pickA(rs):RACES[0])}
