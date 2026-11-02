// The DM frame (owner request): the Dungeon Master's status beside the party frames, where the owner
// already looks. Seat closed: a small "DM: scripted" chip with Open seat. Seat open: a frame with the
// link, the runner's mind and state, what it is doing now (the runner's pacing line), the day's
// narrations / levers / staged scenes against their limits, a pending staged scene, the share of its
// actions that touched the Fellowship, its notes, and Start DM / Stop DM. A click on the frame (not on a
// button) opens the Dungeon Master panel. Built once; only changed text is written (ui/frames.js calls
// renderDmFrame each tick). Read-only from the sim.
import {S} from '../sim/index.js';
import {dmSeatOn,dmAgentView,DMA} from '../sim/dmagent.js';
import {focusStats} from '../sim/dmfocus.js';
import {stagedView} from '../sim/staged.js';
import {dmLink,dmRunnerTag,dmReadyWord,LINK_TEXT} from './player-bridge.js';
const READY_TEXT={claimed:'claimed',warming:'warming up',ready:'ready',failed:'warm-up failed'}; // the start gate (#222)
import {dmRunnerControl,dmRunnerSig,runnerByKey,DONE_STATE} from './runners.js';
import {openDmPanel} from './dmpanel.js';

const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};
const setText=(n,v)=>{v=v==null?'':String(v);if(n._v!==v){n._v=v;n.textContent=v}};
const setCls=(n,c)=>{if(n._c!==c){n._c=c;n.className=c}};
const setTitle=(n,v)=>{v=v||'';if(n._t!==v){n._t=v;if(v)n.setAttribute('title',v);else n.removeAttribute('title')}};
let node=null,refs=null;

const LINK={connected:'agent connected',waiting:'agent waiting',none:'no DM runner'};
// The runner's own words for what it waits on, else its last output line.
function nowLine(r){if(!r||DONE_STATE[r.state])return '';
  const t=r.pace||(r.lines&&r.lines.length?r.lines[r.lines.length-1]:'');
  return String(t||'').replace(/^\[[^\]]*\]\s*/,'').trim()}
const agoText=s=>s<60?s+' s':s<3600?Math.round(s/60)+' min':Math.round(s/3600)+' h';

// Plain data for the DOM and the smoke check.
export function dmFrameData(){const open=dmSeatOn(),r=runnerByKey('dm'),on=!!(r&&!DONE_STATE[r.state]);
  if(!open&&!on)return {open:false,text:'DM: scripted'};
  const v=dmAgentView()||{day:{}},d=v.day||{},today=d.d===Math.floor(S.gameMin/1440)?d:{},sv=stagedView(),fs=focusStats(),D=S.dmAgent;
  const notes=D&&D.notes?Object.values(D.notes).reduce((n,a)=>n+(a?a.length:0),0):0;
  const link=dmLink();
  return {open:true,link,linkText:LINK[link]||LINK_TEXT[link]||link,mind:(dmRunnerTag()||'')+(dmReadyWord()?(dmRunnerTag()?' · ':'')+READY_TEXT[dmReadyWord()]:''),ready:dmReadyWord(),now:nowLine(r),last:r&&r.lastTurnAgo!=null&&!DONE_STATE[r.state]?r.lastTurnAgo:null,
    turns:r?r.turns:0,cost:r?r.cost:0,
    narr:(today.narr||0)+'/'+DMA.NARRATE_PER_DAY,levers:(today.pulls||0)+'/'+DMA.PULLS_PER_DAY,scenes:sv.today,
    staged:sv.cur?sv.cur.title+' · '+sv.cur.kind+(sv.cur.hours_left!=null?' · '+sv.cur.hours_left+' h left':''):'',
    share:fs.share==null?null:Math.round(fs.share*100),acts:fs.acts,notes}}

function build(){const f=el('div','dmf');f.tabIndex=0;f.setAttribute('role','button');f.setAttribute('aria-label','Dungeon Master status; open the Dungeon Master panel');
  const r={};
  r.chip=el('div','dmfchip');r.chipTxt=el('span','dm','DM: scripted');r.openBtn=el('button','mini','Open seat');r.openBtn.dataset.dmseat='open';r.openBtn.title='Open the DM seat so an agent DM can sit in';r.chip.append(r.chipTxt,r.openBtn);
  r.full=el('div','dmffull');
  const top=el('div','dmftop');r.lbl=el('span','dmflbl','DM');r.link=el('span','mlink');r.mind=el('span','dmfmind');r.seatBtn=el('button','mini','Close seat');r.seatBtn.dataset.dmseat='close';r.seatBtn.title='Close the DM seat: the scripted DM runs alone (notes are kept)';
  top.append(r.lbl,r.link,r.mind,r.seatBtn);
  r.now=el('div','dmfdo');r.act=el('div','dmfact');r.stg=el('div','dmfstg');r.fol=el('div','dmffol');
  const foot=el('div','dmffoot');r.notes=el('button','mini','Notes 0');r.notes.dataset.dmnotes='1';r.notes.title='Open the Dungeon Master panel on its Notes';r.run=el('span','dmfrun');foot.append(r.notes,r.run);
  r.full.append(top,r.now,r.act,r.stg,r.fol,foot);f.append(r.chip,r.full);
  f.addEventListener('click',e=>{const t=e.target;if(t&&t.closest&&(t.closest('[data-dmseat]')||t.closest('[data-runact]')||t.closest('select')))return;
    openDmPanel(t&&t.closest&&t.closest('[data-dmnotes]')?'notes':null)});
  f.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target===f){e.preventDefault();openDmPanel(null)}});
  refs=r;return f}

// Mount under the party frames (called once by ui/frames.js).
export function mountDmFrame(parent){node=build();parent.append(node);return node}

export function renderDmFrame(){if(!node)return;const x=dmFrameData(),r=refs;
  setCls(node,'dmf'+(x.open?'':' closed'));r.chip.hidden=x.open;r.full.hidden=!x.open;
  if(!x.open)return;
  setText(r.link,x.linkText);setCls(r.link,'mlink '+x.link);setText(r.mind,x.mind);
  const rr=runnerByKey('dm');
  setText(r.now,x.now?'» '+x.now:(rr&&!DONE_STATE[rr.state]?'':'No DM runner yet: press Start DM'));setTitle(r.now,x.now);
  setText(r.act,'Narrations '+x.narr+' · Levers '+x.levers+' · Scenes '+x.scenes+' today');
  setTitle(r.act,'The DM agent\'s narrations and lever pulls today against their daily limits, and staged scenes (3 a day)');
  setText(r.stg,x.staged?'Staged: '+x.staged:'');
  setText(r.fol,(x.share==null?'No DM actions yet':'Fellowship '+x.share+'% of '+x.acts+' DM actions')+(x.last!=null?' · last turn '+agoText(x.last)+' ago':'')+(x.turns?' · '+x.turns+' turn'+(x.turns===1?'':'s')+(x.cost?' · $'+x.cost.toFixed(3):''):''));
  setText(r.notes,'Notes '+x.notes);
  const k=dmRunnerSig();if(r.run._k!==k){r.run._k=k;r.run.replaceChildren(dmRunnerControl())}}
