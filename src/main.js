// Eldmoor — an 8-bit hardcore MMO "ant farm".
// Browser entry point: wires the DOM-free simulation (src/sim) to the canvas
// renderer (src/render) and the side panels (src/ui). See CLAUDE.md for the
// module map and who owns what.
import {init,step,S} from './sim/index.js';
import {createRenderer} from './render/draw.js';
import {ranked} from './ui/panels.js';
import {select,ctl,setView} from './ui/controls.js';
import {boot,autoSaveTick,bootKind} from './ui/save.js';
import {initSetup,openSetup,afterBoot} from './ui/setup.js'; // the New World setup page (#133)
import {renderTable} from './ui/table.js';
import {checkRunAlerts,sync as syncRunAlert} from './ui/runalert.js'; // sound and notes when a Fellowship or DM runner stops
import {checkRunGate} from './ui/rungate.js'; // hold the world while an agent seat is not connected (#171)
import {initUI,uiFast,uiSlow} from './ui/app.js'; // every panel and its refresh cadence (shared with npm run uismoke)

boot(init); // restores the localStorage save when there is one, else init()
const renderer=createRenderer(document.getElementById('cv'),document.getElementById('screen')); // terrain is painted in chunks as the camera reaches them
initUI(renderer);
initSetup();if(bootKind()==='fresh')openSetup({first:true});else afterBoot(); // no save and no queued setup: the setup page opens over the default world; a setup boot starts its runners
select(S.pinned&&typeof S.pinned.x==='number'?S.pinned:ranked()[0]); // keep following the saved hero
if(S.fellowship)setView('fellow'); // the Fellowship is the story: frame it by default (#68)

let last=performance.now(),uiT=0;
function frame(now){const real=Math.min(.1,(now-last)/1000);last=now;
  checkRunGate();
  if(ctl.speed>0&&!ctl.held){let dt=real*ctl.speed;const n=Math.ceil(dt/.05);for(let i=0;i<n;i++)step(dt/n);autoSaveTick()}
  checkRunAlerts();syncRunAlert();
  renderTable(ctl.held?0:ctl.speed); // Table mode (#68): the sim pauses for Fellowship scenes only at 1x
  renderer.draw();uiT-=real;if(uiT<=0){uiT=.3;uiFast()}
  if(Math.floor(now/1000)!==Math.floor((now-real*1000)/1000))uiSlow();
  requestAnimationFrame(frame)}
requestAnimationFrame(frame);
