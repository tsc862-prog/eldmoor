// Eldmoor — an 8-bit hardcore MMO "ant farm".
// Browser entry point: wires the DOM-free simulation (src/sim) to the canvas
// renderer (src/render) and the side panels (src/ui). See CLAUDE.md for the
// module map and who owns what.
import {init,step,S} from './sim/index.js';
import {createRenderer} from './render/draw.js';
import {initPanels,renderHero,renderTops,renderFacs,renderGuilds,renderFallen,renderClock,ranked} from './ui/panels.js';
import {initControls,select,ctl} from './ui/controls.js';
import {boot,initSaveUI,autoSaveTick} from './ui/save.js';
import {initMinds,renderMinds} from './ui/minds.js';

boot(init); // restores the localStorage save when there is one, else init()
const renderer=createRenderer(document.getElementById('cv'),document.getElementById('screen')); // terrain is painted in chunks as the camera reaches them
initPanels();initControls(renderer);initSaveUI();initMinds();
select(S.pinned&&typeof S.pinned.x==='number'?S.pinned:ranked()[0]); // keep following the saved hero

let last=performance.now(),uiT=0;
function frame(now){const real=Math.min(.1,(now-last)/1000);last=now;
  if(ctl.speed>0){let dt=real*ctl.speed;const n=Math.ceil(dt/.05);for(let i=0;i<n;i++)step(dt/n);autoSaveTick()}
  renderer.draw();uiT-=real;if(uiT<=0){uiT=.3;renderHero();renderClock()}
  if(Math.floor(now/1000)!==Math.floor((now-real*1000)/1000)){renderTops();renderFacs();renderGuilds();renderFallen();renderMinds()}
  requestAnimationFrame(frame)}
requestAnimationFrame(frame);
