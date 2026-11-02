// The page's UI wiring and refresh cadence, shared by src/main.js and the stubbed-DOM smoke
// (scripts/uismoke.mjs, issue #145), so the smoke ticks exactly what the browser ticks.
//   initUI(renderer)  build every panel once (renderer: the camera API from render/draw.js)
//   uiFast()          every 0.3 s: layout, hero card, clock, Fellowship panel, party frames, sheet
//   uiSlow()          every second: top heroes, factions, guilds, graveyard, minds, timeline, legends, DM log and seat
// Every panel patches itself in place (ui/stable.js): scroll positions, open rows, focus and pickers survive.
import {initPanels,renderHero,renderTops,renderFacs,renderGuilds,renderFallen,renderClock} from './panels.js';
import {initControls} from './controls.js';
import {initSaveUI} from './save.js';
import {initMinds,renderMinds} from './minds.js';
import {initLegends,renderLegends} from './legends.js';
import {initFellowship,renderFellowship} from './fellowship.js';
import {initTable} from './table.js';
import {initRunAlert} from './runalert.js';
import {initFrames,renderFrames} from './frames.js';
import {initSheet,renderSheet} from './sheet.js';
import {applyLayout} from './layout.js';
import {initMindCtl} from './mindctl.js';
import {initRunners,startRunner} from './runners.js';
import {initRunGate} from './rungate.js';
import {initDmSeat,renderDmSeat} from './dmseat.js';
import {renderTimeline} from './timeline.js';
import {renderDmLog} from './dmpanel.js';
import {setView} from './controls.js';
import {initAgents,renderAgents} from './agents.js'; // agent limits and spend (#145)
import {initSettings} from './settings.js'; // the Settings popover and the World menu (#145)

export function initUI(renderer){
  initPanels();initControls(renderer);initSaveUI();initMinds();initFellowship(setView);initLegends();initTable();initRunAlert();initRunGate(k=>startRunner(k));
  initSheet();initFrames();applyLayout();
  const minds=()=>{renderHero();renderFrames();renderFellowship();renderMinds()};
  initMindCtl(minds);initRunners(()=>{minds();renderAgents()});initDmSeat(()=>renderMinds());initAgents();initSettings(()=>renderHero())}

export function uiFast(){applyLayout();renderHero();renderClock();renderFellowship();renderFrames();renderSheet()}
export function uiSlow(){renderTops();renderFacs();renderGuilds();renderFallen();renderMinds();renderTimeline();renderLegends();renderDmLog();renderDmSeat();renderAgents()}
