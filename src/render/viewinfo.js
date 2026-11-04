// What the screen shows, in a few words, for the page watchdog's lines (#736, ui/pagewatch.js): the world (and its view),
// an indoor or outdoor scene map and its kind, or the dungeon view with the chamber in progress, plus the canvas size.
// Read only; called only when a frame ran long, so it may look things up.
import {S} from '../sim/state.js';
import {cam} from './draw.js';
import {dungeonSite,stateOf,isSite} from './dungeonview.js';
import {sceneMode} from './sceneview.js';

export function viewWhere(cv){
  const size=cv&&cv.width?' · '+cv.width+'x'+cv.height:'',dg=dungeonSite();
  if(dg){let room='';try{const st=stateOf(dg);if(st.cur>=0)room=' room '+(st.cur+1)+'/'+st.rooms.length+(st.round?' '+st.round:'');else room=' '+st.phase}catch(e){}
    const dc=document.querySelector&&document.querySelector('.dgcv');
    return 'dungeon '+(isSite(dg)?'site ':'')+(dg.name||'?')+room+(dc&&dc.width?' · '+dc.width+'x'+dc.height:size)}
  const m=sceneMode(),sc=S.table;
  if(m)return 'scene '+m+(sc&&sc.kind?' '+sc.kind:'')+size;
  return 'world '+(cam&&cam.view||'map')+(sc&&sc.kind?' (table: '+sc.kind+')':'')+size}
