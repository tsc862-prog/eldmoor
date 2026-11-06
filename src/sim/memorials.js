// Persistent memorials (issue #12). Plain data on S, no hooks into hero code: memorialsTick
// scans the roster twice a game-hour-ish and records what it finds.
//   S.graves   stones where heroes fell: {id,name,fac,cls,lvl,cause,t,gameMin,x,y,keep}. Capped at
//              GRAVE_CAP, oldest first removed; Fellowship members and statued legends are never pruned.
//              Deaths inside a town wall leave no stone (the town graveyard sprite covers those).
//   S.statues  one per legend in the home town square: a hero who reaches level 20, or who falls at
//              level 15+. At most STATUE_CAP per town; a new one replaces the weakest if it outscores it.
//   Kragmaw's cooled lair is not stored: render/memorials.js reads S.boss.alive.
import {CITY} from '../world/map.js';
import {keep} from './kept.js';
import {homeOf} from '../data/races.js';
import {S} from './state.js';
import {log,fac} from './chronicle.js';
import {timeline} from './history.js';
import {inSlots} from './company.js'; // the slotted company (#588)

export const GRAVE_CAP=60,STATUE_CAP=3,STATUE_LVL=20,STATUE_FALL_LVL=15;
const SLOTS=[[-1.7,-.5],[1.7,-.5],[0,1.3]]; // offsets from the square spot, one per statue
let acc=0;export const resetMemorials=()=>{acc=0}; // a new world starts the timer over (#674)
keep('memorials',()=>acc,v=>{acc=v});

// The Legends hall's score when the hero is recorded there (sim/legends.js), else a quick estimate.
export const legendScore=a=>{const e=((S.legends&&S.legends.list)||[]).find(x=>x.id===a.id);return e?e.score:a.lvl*10+(a.eliteKills||0)*3+(a.honor||0)*2+(a.gear||0)};
const inTown=(x,y)=>CITY.some(c=>x>=c.x0-.5&&x<=c.x1+1.5&&y>=c.y0-.5&&y<=c.y1+1.5);
const protectedGrave=g=>g.keep||(S.statues||[]).some(s=>s.id===g.id);

function addGrave(a){
  if(inTown(a.x,a.y))return;
  const G=S.graves||(S.graves=[]);
  G.push({id:a.id,name:a.name,fac:a.fac,cls:a.cls,lvl:a.lvl,cause:a.cause||'fell',t:a.diedAt||'',gameMin:S.gameMin,x:+a.x.toFixed(1),y:+a.y.toFixed(1),keep:!!inSlots(a)});
  while(G.length>GRAVE_CAP){const i=G.findIndex(g=>!protectedGrave(g));if(i<0)break;G.splice(i,1)}}

function raise(a,why){
  const St=S.statues||(S.statues=[]);if(St.some(s=>s.id===a.id))return;
  const town=homeOf(a),mine=St.filter(s=>s.town===town.name),sc=legendScore(a);
  let slot;
  if(mine.length>=STATUE_CAP){const weak=mine.reduce((m,s)=>s.score<m.score?s:m);
    if(weak.score>=sc)return;slot=weak.slot;St.splice(St.indexOf(weak),1)}
  else slot=SLOTS.findIndex((_,i)=>!mine.some(s=>s.slot===i));
  const sq=town.spots.square||{x:(town.x0+town.x1)/2,y:(town.y0+town.y1)/2},o=SLOTS[slot];
  St.push({id:a.id,name:a.name,fac:a.fac,cls:a.cls,race:a.race,lvl:a.lvl,score:sc,town:town.name,slot,x:sq.x+o[0],y:sq.y+o[1],why,t:S.gameMin});
  log(fac(a.fac),' raise a statue of ',a,' in the square of ',{t:town.name,c:'gd'},' ('+why+').');
  timeline('level',fac(a.fac),' raised a statue of ',a,' in ',town.name,'.')}

export function memorialsTick(dt){
  acc+=dt;if(acc<2)return;acc=0;
  for(const a of S.agents){
    if(a.state==='dead'){if(!a.memo){a.memo=1;addGrave(a);if(a.lvl>=STATUE_FALL_LVL&&!a.statued){a.statued=1;raise(a,'level '+a.lvl+', fallen')}}}
    else if(a.lvl>=STATUE_LVL&&!a.statued){a.statued=1;raise(a,'reached level '+a.lvl)}}}
