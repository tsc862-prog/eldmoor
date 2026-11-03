// Eldmoor — an 8-bit hardcore MMO "ant farm".
// Browser entry point: wires the DOM-free simulation (src/sim) to the canvas
// renderer (src/render) and the side panels (src/ui). See CLAUDE.md for the
// module map and who owns what.
import {init,step,S,provideCampaigns,campaignIdOf} from './sim/index.js';
import {createRenderer} from './render/draw.js';
import {provideAssets} from './render/assets.js';
import {select,ctl,setView,startHero} from './ui/controls.js';
import {boot,autoSaveTick,bootKind} from './ui/save.js';
import {initSetup,openSetup,afterBoot} from './ui/setup.js'; // the New World setup page (#133)
import {renderTable} from './ui/table.js';
import {renderHold} from './ui/holdbar.js'; // gambit hold bar (#630)
import {checkRunAlerts,sync as syncRunAlert} from './ui/runalert.js'; // sound and notes when a Fellowship or DM runner stops
import {every} from './ui/ticker.js'; // timers that a hidden tab does not throttle
import {checkRunGate} from './ui/rungate.js'; // hold the world while an agent seat is not connected (#171)
import {initUI,uiFast,uiSlow} from './ui/app.js'; // every panel and its refresh cadence (shared with npm run uismoke)
import {titleWanted,showTitle,provideNotes} from './ui/title.js'; // Continue, New world, Load: nothing runs until a choice
import {slotted} from './sim/company.js'; // the slotted company (#588)

// The world is built only when the owner picks Continue (or the default world) on the title screen, or at once with
// ?continue=1 / ?skip-title=1, a queued New World setup, or a Load/Import reload. New world goes to the setup page
// from the title and reloads into the new world, which skips the title.
// The DM's campaign seeds (docs/campaigns/<world>.md, bundled at build time; none is fine). The sim reads the one for the world id.
provideCampaigns(Object.fromEntries(Object.entries(import.meta.glob('../docs/campaigns/*.md',{query:'?raw',import:'default',eager:true})).filter(([p])=>!/\/_/.test(p)).map(([p,t])=>[campaignIdOf(p),t])));
// Patch notes (#664): docs/patchnotes/*.md for the title screen's What's new, bundled the same way.
provideNotes(import.meta.glob('../docs/patchnotes/*.md',{query:'?raw',import:'default',eager:true}));
// Generated art (#177): assets/index.json and the PNG URLs under assets/ (served as static files; an absent folder is an
// empty index and every renderer draws procedurally). The PNGs themselves load lazily, on first use (render/assets.js).
provideAssets(Object.values(import.meta.glob('../assets/index.json',{import:'default',eager:true}))[0]||null,
  Object.fromEntries(Object.entries(import.meta.glob(['../assets/*/*.png','../assets/*/*/*.png','!../assets/incoming/**'],{query:'?url',import:'default',eager:true})).map(([p,u])=>[p.replace('../assets/',''),u])));
initSetup();
let renderer=null;
function start(kind){
  boot(init); // restores the localStorage save when there is one, else init()
  renderer=createRenderer(document.getElementById('cv'),document.getElementById('screen')); // terrain is painted in chunks as the camera reaches them
  initUI(renderer);
  if(bootKind()==='fresh'&&kind!=='default')openSetup({first:true});else afterBoot(); // no save and no queued setup: the setup page opens over the default world; a setup boot starts its runners
  select(startHero()); // the saved hero when it rides with the followed company, else that company's leader (#546)
  if(slotted())setView('fellow'); // the Fellowship is the story: frame it by default (#68)
  last=performance.now();requestAnimationFrame(frame)}

let last=performance.now(),uiT=0;
// The sim half of a frame. Also run from a worker clock while the tab is hidden (rAF stops there): the world, the run
// gate and the agents' `wait` calls keep going, so a background tab does not look like a dead game to the runners.
function advance(real){
  checkRunGate();
  if(ctl.speed>0&&!ctl.held){let dt=real*ctl.speed;const n=Math.ceil(dt/.05);for(let i=0;i<n;i++)step(dt/n);autoSaveTick()}
  checkRunAlerts();syncRunAlert();
  renderTable(ctl.held?0:ctl.speed);renderHold()} // Table mode (#68): the sim pauses for Fellowship scenes only at 1x
function frame(now){const real=Math.min(.1,(now-last)/1000);last=now;
  advance(real);
  renderer.draw();uiT-=real;if(uiT<=0){uiT=.3;uiFast()}
  if(Math.floor(now/1000)!==Math.floor((now-real*1000)/1000))uiSlow();
  requestAnimationFrame(frame)}
every(250,()=>{if(!renderer||typeof document==='undefined'||!document.hidden)return;
  const now=performance.now(),real=Math.min(.5,(now-last)/1000);last=now;advance(real)});
if(titleWanted())showTitle(start);else start('direct');
