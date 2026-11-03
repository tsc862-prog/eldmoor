// The DM frame (owner request): the Dungeon Master's status beside the party frames, where the owner
// already looks. No seat yet (before a world is played): a small "DM: no seat yet" chip. Seat open (always, #520/#560): a frame with the
// link, the runner's mind and state, what it is doing now (the runner's pacing line), the day's
// narrations / levers / staged scenes against their limits, a pending staged scene, the share of its
// actions that touched the Fellowship, its notes, and Restart / Stop / Start DM, and a DM runner-stop alert line while the gate holds the world for it. A click on the frame (not on a
// button) opens the Dungeon Master panel. Built once; only changed text is written (ui/frames.js calls
// renderDmFrame each tick). Read-only from the sim.
import {S} from '../sim/index.js';
import {dmSeatOn,dmAgentView,DMA} from '../sim/dmagent.js';
import {focusStats} from '../sim/dmfocus.js';
import {stagedView} from '../sim/staged.js';
import {whenPending} from '../sim/dmwhen.js'; // the DM's pending whens and watches (#635)
import {prepView} from '../sim/prep.js'; // the DM's prep before the table opens (#437)
import {dmLink,dmRunnerTag,dmReadyWord,LINK_TEXT} from './player-bridge.js';
const READY_TEXT={claimed:'claimed',warming:'warming up',ready:'ready',failed:'warm-up failed'}; // the start gate (#222)
import {dmRunnerControl,dmRunnerSig,runnerByKey,DONE_STATE} from './runners.js';
import {openDmPanel} from './dmpanel.js';
import {gateMissing,whyMissing} from './rungate.js'; // the DM runner-stop alert (#560)

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
  if(!open&&!on)return {open:false,text:'DM: no seat yet'};
  const v=dmAgentView()||{day:{}},d=v.day||{},today=d.d===Math.floor(S.gameMin/1440)?d:{},sv=stagedView(),fs=focusStats(),D=S.dmAgent;
  const notes=D&&D.notes?Object.values(D.notes).reduce((n,a)=>n+(a?a.length:0),0):0;
  const link=dmLink();
  return {open:true,link,linkText:LINK[link]||LINK_TEXT[link]||link,mind:(dmRunnerTag()||'')+(prepView().state==='running'?(dmRunnerTag()?' · ':'')+'preparing':dmReadyWord()?(dmRunnerTag()?' · ':'')+READY_TEXT[dmReadyWord()]:''),ready:dmReadyWord(),prep:prepView().state==='running',now:nowLine(r),last:r&&r.lastTurnAgo!=null&&!DONE_STATE[r.state]?r.lastTurnAgo:null,
    turns:r?r.turns:0,cost:r?r.cost:0,
    narr:(today.narr||0)+'/'+DMA.NARRATE_PER_DAY,levers:(today.pulls||0)+'/'+DMA.PULLS_PER_DAY,scenes:sv.today,
    staged:sv.cur?sv.cur.title+' · '+sv.cur.kind+(sv.cur.hours_left!=null?' · '+sv.cur.hours_left+' h left':''):'',
    pending:whenPending(),
    share:fs.share==null?null:Math.round(fs.share*100),acts:fs.acts,notes}}

function build(){const f=el('div','dmf');f.tabIndex=0;f.setAttribute('role','button');f.setAttribute('aria-label','Dungeon Master status; open the Dungeon Master panel');
  const r={};
  r.chip=el('div','dmfchip');r.chipTxt=el('span','dm','DM: no seat yet');r.chip.append(r.chipTxt);
  r.full=el('div','dmffull');
  const top=el('div','dmftop');r.lbl=el('span','dmflbl','DM');r.link=el('span','mlink');r.mind=el('span','dmfmind');
  top.append(r.lbl,r.link,r.mind);
  r.alert=el('div','dmfalert');r.alert.setAttribute('role','alert');r.alert.hidden=true;r.now=el('div','dmfdo');r.act=el('div','dmfact');r.stg=el('div','dmfstg');r.when=el('div','dmfstg');r.fol=el('div','dmffol');
  const foot=el('div','dmffoot');r.notes=el('button','mini','Notes 0');r.notes.dataset.dmnotes='1';r.notes.title='Open the Dungeon Master panel on its Notes';r.run=el('span','dmfrun');foot.append(r.notes,r.run);
  r.full.append(top,r.alert,r.now,r.act,r.stg,r.when,r.fol,foot);f.append(r.chip,r.full);
  f.addEventListener('click',e=>{const t=e.target;if(t&&t.closest&&(t.closest('[data-runact]')||t.closest('select')))return;
    openDmPanel(t&&t.closest&&t.closest('[data-dmnotes]')?'notes':null)});
  f.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target===f){e.preventDefault();openDmPanel(null)}});
  refs=r;return f}

// Mount under the party frames (called once by ui/frames.js).
export function mountDmFrame(parent){node=build();parent.append(node);return node}

export function renderDmFrame(){if(!node)return;const x=dmFrameData(),r=refs;
  setCls(node,'dmf'+(x.open?'':' closed'));r.chip.hidden=x.open;r.full.hidden=!x.open;
  if(!x.open)return;
  {const gone=gateMissing().find(m=>m.kind==='dm');setText(r.alert,gone?'DM runner gone: the world is paused. '+whyMissing(gone)+'. Restart DM, or Start anyway in the bar over the map.':'');r.alert.hidden=!gone}
  setText(r.link,x.linkText);setCls(r.link,'mlink '+x.link);setText(r.mind,x.mind);
  const rr=runnerByKey('dm');
  setText(r.now,x.now?'» '+x.now:(rr&&!DONE_STATE[rr.state]?'':'No DM runner: press Start DM (the world waits for it)'));setTitle(r.now,x.now);
  setText(r.act,'Narrations '+x.narr+' · Levers '+x.levers+' · Scenes '+x.scenes+' today');
  setTitle(r.act,'The DM agent\'s narrations and lever pulls today against their daily limits, and staged scenes (3 a day)');
  setText(r.stg,x.staged?'Staged: '+x.staged:'');
  {const P=x.pending,nw=P.filter(e=>e.kind==='when').length,nv=P.length-nw;
    setText(r.when,P.length?'Pending: '+(nw?nw+' when'+(nw===1?'':'s'):'')+(nw&&nv?' · ':'')+(nv?nv+' watch'+(nv===1?'':'es'):'')+' · '+P.slice(0,2).map(e=>e.label).join('; ')+(P.length>2?' …':''):'');
    setTitle(r.when,P.map(e=>(e.kind==='when'?'When #'+e.id+': '+e.label+' → '+e.action:'Watch #'+e.id+': wake the DM when '+e.label)+' ('+e.hours_left+' h left)').join('\n'))}
  setText(r.fol,(x.share==null?'No DM actions yet':'Fellowship '+x.share+'% of '+x.acts+' DM actions')+(x.last!=null?' · last turn '+agoText(x.last)+' ago':'')+(x.turns?' · '+x.turns+' turn'+(x.turns===1?'':'s')+(x.cost?' · $'+x.cost.toFixed(3):''):''));
  setText(r.notes,'Notes '+x.notes);
  const k=dmRunnerSig();if(r.run._k!==k){r.run._k=k;r.run.replaceChildren(dmRunnerControl())}}
