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
import {initMapLegend,renderMapLegend} from './maplegend.js'; // the whole-map view's side legend (#844)
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
import {initChatPanel,renderChatPanel} from './chatpanel.js'; // the Fellowship chat and the DM agent's actions (#169)
import {initPurpose,renderMapTip} from './purposeview.js'; // purpose line, map tooltip and the Icons switch (#534)
import {initSettings} from './settings.js'; // the Settings popover and the World menu (#145)
import {trackDowned} from './downview.js'; // each death save as it lands (#659)

export function initUI(renderer){
  initPanels();initControls(renderer);initSaveUI();initMinds();initFellowship(setView);initLegends();initMapLegend();initTable();initRunAlert();initRunGate((k,h)=>startRunner(k,h));
  initSheet();initFrames();applyLayout();
  const minds=()=>{renderHero();renderFrames();renderFellowship();renderMinds()};
  initMindCtl(minds);initRunners(()=>{minds();renderAgents()});initDmSeat(()=>renderMinds());initAgents();initChatPanel();initSettings(()=>renderHero());initPurpose()}

export function uiFast(){trackDowned();applyLayout();renderHero();renderClock();renderFellowship();renderFrames();renderSheet();renderChatPanel();renderMapTip();renderMapLegend()}
export function uiSlow(){renderTops();renderFacs();renderGuilds();renderFallen();renderMinds();renderTimeline();renderLegends();renderDmLog();renderDmSeat();renderAgents()}
