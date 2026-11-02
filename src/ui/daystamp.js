// Game day on log times (issue #136): "D4 03:12" and a separator between days. Entries carry `d`
// (the 1-based game day) from the sim, or a `gameMin` (mind and journal entries); an older save's
// entry with neither shows its bare time and gets no separator.
const el=(tag,cls,text)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(text!=null)d.textContent=text;return d};

export const dayOf=e=>!e?null:e.d!=null?e.d:e.gameMin!=null?Math.floor(e.gameMin/1440)+1:null;
// "D4 03:12" from an entry; its t may be "03:12", "D4 03:12" or "Day 4 03:12" (the time is its last five characters).
export function stampOf(e){const d=dayOf(e),t=String((e&&e.t)||'');const clock=/\d\d:\d\d$/.test(t)?t.slice(-5):t;return d!=null?'D'+d+' '+clock:clock}
// A day-separator element ("Day 4").
export const daySep=(d,tag='li')=>el(tag,'daysep','Day '+d);
// Append `entries` (in display order) to `parent`, built by build(e), with a separator whenever the day changes.
export function byDay(parent,entries,build,tag='li'){let last=null;
  for(const e of entries){const d=dayOf(e);if(d!=null&&d!==last){parent.append(daySep(d,tag));last=d}parent.append(build(e))}}
// Source of a Log line (issue #136), as shown: who caused the action.
export const SRC_TEXT={agent:'agent order',autopilot:'autopilot',reflex:'reflex',ai:'AI',scripted:'scripted'};
export const SRC_TITLE={agent:'The agent ordered this',autopilot:'Autopilot carried out the last order while the agent was silent',reflex:'The hero\'s own reflex (it breaks off, drinks, goes home) while the agent thinks',
  ai:'A language model chose this',scripted:'The scripted rules chose this'};
export function srcTag(e){const s=e&&e.src;if(!s||!SRC_TEXT[s])return null;const x=el('span','src s-'+s,SRC_TEXT[s]);x.title=SRC_TITLE[s];return x}
