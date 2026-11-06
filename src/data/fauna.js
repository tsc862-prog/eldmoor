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
import {EPICS} from './items.js';

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
  // The Wending Vale (epic #940, slice A): a first pass from the stock bestiary, one row a region; creature-designer refines it in slice D.
  wendmouth: {tier:0,species:['wolf','boar','spider'],count:12,roadMinX:30,elite:'Hollowfang'},
  sallowfen: {tier:1,species:['bog','mudboar','lurker'],count:11,roadMinX:0,elite:'Old Mother Sedge'},
  hawkwold:  {tier:1,species:['wolf','boar','shaghorn'],count:11,roadMinX:0,elite:{name:'Greymane',title:'the Pack-Father of the Hawkwold',base:'wolf'}},
  greywood:  {tier:1,species:['wolf','spider','mudboar'],count:13,roadMinX:0,elite:{name:'Thornback',title:'the Boar-King of the Greywood',base:'mudboar'}},
  ashenfold: {tier:2,species:['golem','drake','spider'],count:13,roadMinX:0,elite:'Scoriath'},
  rimecrown: {tier:3,species:['rimehound','shaghorn','wight'],count:11,roadMinX:0,elite:'Ulfryn Coldmarrow'},
};

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
      const lo=Math.round(a+i*(hi-a-2)/Math.max(1,n-1)),key=sp+'@'+z;
      MOBS[key]={...stock[sp],z,lv:[lo,Math.min(hi,lo+3)]};COUNTS[key]=F.count});
    const E=typeof F.elite==='string'?stockElites.find(e=>e.name===F.elite):F.elite;
    ELITES.push({...E,base:(E.base||'wolf')+'@'+z,lvl:Math.min(hi+2,24),scale:E.scale||2.2,hit:E.hit||1.5});
    EPICS.push(stockEpics[F.tier]);
    ECO.roadMinX.push(F.roadMinX||0)});
  return true}
