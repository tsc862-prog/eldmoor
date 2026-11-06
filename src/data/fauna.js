// Region-keyed fauna for worlds other than Eldmoor. A first pass by world-builder so the
// Stepping Lands (issue #36) have monsters at their level bands; creature-designer owns the
// real tables and should replace this with dedicated species and elites.
//
// The stock tables in mobs.js and items.js are indexed by Eldmoor's four zones. A world whose
// regions are listed here gets its own copies, rebuilt in place at world build time (map.js):
// every species below is cloned once per region as `<base>@<region index>` with its level range
// spread over the region's band, COUNTS and ELITES get one row per region, and EPICS[z] reuse
// the stock drop table of the region's `tier`. Eldmoor has no entry here, so nothing changes.
import {MOBS,COUNTS,ELITES,ECO} from './mobs.js';
import {EPICS,GOODS,price} from './items.js';

// species: stock MOBS keys. tier: the stock zone whose epics drop. elite: a stock elite (by name)
// re-levelled to the region, or a placeholder {name,title,base} for a new one. roadMinX: roads west of
// it never draw wandering mobs (keeps spill-over away from the home-town gates).
export const FAUNA={
  lowmark:   {tier:0,species:['wolf','boar','spider'],count:12,roadMinX:44,elite:'Hollowfang'},
  sedgewater:{tier:1,species:['bog','mudboar','lurker'],count:12,roadMinX:0,elite:'Old Mother Sedge'},
  cairnwold: {tier:1,species:['wolf','boar','shaghorn'],count:12,roadMinX:0,elite:{name:'Brask Ironhorn',title:'the Ram-King of the Cairnwold',base:'shaghorn'}},
  cinderreach:{tier:2,species:['golem','drake','spider'],count:14,roadMinX:0,elite:'Scoriath'},
  rimeholt:  {tier:3,species:['rimehound','shaghorn','wolf'],count:12,roadMinX:0,elite:{name:'Whitemaw',title:'the Snow-Hound of Rimeholt',base:'rimehound'}},
  palereach: {tier:3,species:['rimehound','shaghorn','wight'],count:11,roadMinX:0,elite:'Ulfryn Coldmarrow'},
  // The Wending Vale (epic #940, slice D): each region has its own creatures, levels, names and trade goods. Entries are objects
  // {sp: stock species (its sprite and stat block), name, pl, lv, loot, q}. Only species the LPC creature slice draws (wolf, boar,
  // mudboar, spider, lurker, bog, golem, wight, rimehound; PR #853) are used, so none falls back to the old look; the drake and the
  // shaghorn are left out on purpose. Levels sit inside the region's band (nothing near a home town above it; elites are the one
  // exception, as everywhere). Goods are Vale-only (VALE_GOODS), priced up the same ladder as Eldmoor's.
  wendmouth: {tier:0,count:12,roadMinX:999,elite:'Hollowfang',species:[
    {sp:'wolf',name:'Strand Wolf',pl:'Strand Wolves',lv:[1,3],loot:'Strandpelt',q:'Wolves on the Strand'},
    {sp:'boar',name:'Reed Boar',pl:'Reed Boars',lv:[2,4],loot:'Reed-Tusk',q:'Tusks from the Reeds'},
    {sp:'spider',name:'Dyke Weaver',pl:'Dyke Weavers',lv:[3,5],loot:'Dyke Silk',q:'Sweep the Dykes'}]},
  sallowfen: {tier:1,count:11,roadMinX:0,elite:'Old Mother Sedge',species:[
    {sp:'bog',name:'Sallow Bogling',pl:'Sallow Boglings',lv:[2,4],loot:'Sallow Moss',q:'Boglings in the Willows'},
    {sp:'mudboar',name:'Sallow Hog',pl:'Sallow Hogs',lv:[3,6],loot:'Willow Hide',q:'Hides from the Flats'},
    {sp:'lurker',name:'Eel Lurker',pl:'Eel Lurkers',lv:[5,8],loot:'Eel Venom',q:'Venom for the Stilt-Healers'}]},
  hawkwold:  {tier:1,count:11,roadMinX:0,elite:{name:'Greymane',title:'the Pack-Father of the Hawkwold',base:'wolf',fixLvl:9},species:[
    {sp:'wolf',name:'Heath Wolf',pl:'Heath Wolves',lv:[2,4],loot:'Heath Pelt',q:'Wolves on the Heath'},
    {sp:'boar',name:'Crag Boar',pl:'Crag Boars',lv:[3,5],loot:'Crag Tusk',q:'Tusks from the Crags'},
    {sp:'rimehound',name:'Windhound',pl:'Windhounds',lv:[4,7],loot:'Gale Sinew',q:'Windhounds on the Ridge'}]},
  greywood:  {tier:1,count:13,roadMinX:0,elite:{name:'Thornback',title:'the Boar-King of the Greywood',base:'mudboar'},species:[
    {sp:'spider',name:'Oak Weaver',pl:'Oak Weavers',lv:[6,8],loot:'Oak Silk',q:'Webs in the Old Wood'},
    {sp:'mudboar',name:'Thicket Boar',pl:'Thicket Boars',lv:[7,10],loot:'Thicket Hide',q:'Hides from the Thicket'},
    {sp:'wolf',name:'Grey Stalker',pl:'Grey Stalkers',lv:[9,11],loot:'Greywood Fur',q:'Stalkers of the Greywood'}]},
  ashenfold: {tier:2,count:13,roadMinX:0,elite:{name:'Grimbrand',title:'the Kiln-Golem of the Ashenfold',base:'golem'},species:[
    {sp:'spider',name:'Ash Weaver',pl:'Ash Weavers',lv:[10,12],loot:'Ash Silk',q:'Webs in the Ash'},
    {sp:'golem',name:'Slag Golem',pl:'Slag Golems',lv:[11,14],loot:'Slag Core',q:'Cores from the Slag'},
    {sp:'wolf',name:'Ember Hound',pl:'Ember Hounds',lv:[12,15],loot:'Ember Fur',q:'Hounds of the Old Kilns'}]},
  rimecrown: {tier:3,count:11,roadMinX:0,elite:'Ulfryn Coldmarrow',species:[
    {sp:'wolf',name:'Squall Wolf',pl:'Squall Wolves',lv:[14,16],loot:'Squall Pelt',q:'Wolves in the Squall'},
    {sp:'rimehound',name:'Crown Hound',pl:'Crown Hounds',lv:[15,18],loot:'Crown Rime',q:'Howls on the Crown'},
    {sp:'wight',name:'Crown Wight',pl:'Crown Wights',lv:[17,20],loot:'Crown Marrow',q:'What the Crown Keeps'}]},
};

// Trade goods only the Vale has: [name, base price]. Registered into GOODS when the world is built, never at import, so Eldmoor's
// and Stepping's markets (and the dice they draw at import) are untouched.
export const VALE_GOODS=[['Strandpelt',4],['Reed-Tusk',5],['Dyke Silk',7],['Sallow Moss',9],['Willow Hide',11],['Eel Venom',14],
  ['Heath Pelt',6],['Crag Tusk',8],['Gale Sinew',12],['Oak Silk',13],['Thicket Hide',15],['Greywood Fur',18],
  ['Ash Silk',20],['Slag Core',24],['Ember Fur',28],['Squall Pelt',30],['Crown Rime',34],['Crown Marrow',40]];

export function applyFauna(regions){
  if(!regions.some(r=>FAUNA[r.id]))return false;
  const stock={...MOBS},stockElites=ELITES.slice(),stockEpics=EPICS.slice();
  for(const k of Object.keys(MOBS))delete MOBS[k];
  for(const k of Object.keys(COUNTS))delete COUNTS[k];
  ELITES.length=0;EPICS.length=0;ECO.roadMinX=[];
  regions.forEach((r,z)=>{
    const F=FAUNA[r.id];if(!F)throw new Error('fauna: no entry for region '+r.id);
    const [a,b]=r.band,hi=Number.isFinite(b)?b:a+4,n=F.species.length;
    F.species.forEach((sp,i)=>{
      if(typeof sp==='object'){const key=sp.sp+'@'+z,{sp:_,...own}=sp;MOBS[key]={...stock[sp.sp],...own,z};COUNTS[key]=F.count;return}
      const lo=Math.round(a+i*(hi-a-2)/Math.max(1,n-1)),key=sp+'@'+z;
      MOBS[key]={...stock[sp],z,lv:[lo,Math.min(hi,lo+3)]};COUNTS[key]=F.count});
    const E=typeof F.elite==='string'?stockElites.find(e=>e.name===F.elite):F.elite;
    ELITES.push({...E,...(E.title?{title:E.title.replace(/ of (Thornvale|Mirefen|Cinderpass|Hoarfell)$/,' of '+r.name)}:{}),base:(E.base||'wolf')+'@'+z,lvl:E.fixLvl||Math.min(hi+2,24),scale:E.scale||2.2,hit:E.hit||1.5});
    EPICS.push(stockEpics[F.tier]);
    ECO.roadMinX.push(F.roadMinX||0)});
  if(regions.some(r=>FAUNA[r.id]&&FAUNA[r.id].species.some(x=>typeof x==='object')))for(const [n,base] of VALE_GOODS)if(!GOODS[n]){GOODS[n]={base,supply:8,prev:0};GOODS[n].prev=price(n)}
  return true}
