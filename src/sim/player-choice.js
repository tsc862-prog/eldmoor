// Agent player (issue #75): the one place the DM (sim/dm.js) asks an agent-played leader
// for a scene choice. Kept apart from sim/player.js so dm.js does not import the player
// module (no import cycle). Plain data on the adventure: adv.pick = {k, until, opts, chosen}.
//
// playerBranch(adv, sc, a, spec) is called by dm.js when a choice scene is reached:
//   - not an agent-played hero: null (the DM's own resolveBranch decides, as before)
//   - the agent has chosen 'a' or 'b': that branch
//   - the wait ran out (CHOICE_MIN game minutes): null, so the scripted DM decides
//   - still waiting: 'wait'; dm.js returns and the hero stands at the scene with
//     adv.stage='choose' until sim/player.js sees a choice or the timeout and re-arms it.
// The world never waits on the agent: the timeout is in game minutes, and a silent or
// disconnected agent simply gets the scripted branch.
import {S} from './state.js';
import {notify} from './notify.js';
import {reflexMay,ownerHeld} from './runlink.js';
import {inSlots} from './company.js'; // the slotted company (#588)

export const CHOICE_MIN=180; // game minutes a choice waits (30 real seconds at 1x)
// #148: a Fellowship member's choice waits for its agent: CHOICE_HOLD more game minutes (with a nudge) while its
// runner holds it, and as long as it takes while its runner is gone and the owner has not answered the alert.
export const CHOICE_HOLD=600;

// Fellowship (#68 phase B): a choice on the Fellowship's adventure goes to the whole table
// (sim/table.js registers the hook; it answers undefined when Table mode cannot run, e.g. at 3x).
var fellowChoice; // hoisted: registered while the import cycle loads
export function setFellowChoice(f){fellowChoice=f}

export function playerBranch(adv,sc,a,spec){
  if(a&&inSlots(a)&&fellowChoice){const t=fellowChoice(adv,sc,a,spec);if(t!==undefined)return t}
  if(!a||!a.player)return null;
  let p=adv.pick;
  // A stale wait (the hero went home mid-choice and came back) starts over; sim/player.js sets
  // rearm when it re-arms the scene after a choice or a timeout.
  if(!p||p.k!==adv.idx||(!p.rearm&&!p.chosen&&S.gameMin>=p.until)){
    const d=adv.data||{},frame=String(spec&&spec.frame||'').replace(/\{(\w+)\}/g,(m,k)=>{const v=d[k]!=null?d[k]:d[k.toLowerCase()];return typeof v==='string'?v:k==='who'?a.name:'the '+k.toLowerCase()});
    p=adv.pick={k:adv.idx,until:S.gameMin+CHOICE_MIN,chosen:null,title:adv.title||'',frame,
      opts:{a:spec&&spec.a?String(spec.a.label||'the bold road'):'the bold road',b:spec&&spec.b?String(spec.b.label||'the careful road'):'the careful road'}};
    a.playChoiceNew=true; // sim/player.js turns this into an urgent event
  }
  if(p.chosen==='a'||p.chosen==='b'){const c=p.chosen;adv.pick=null;return c}
  if(S.gameMin>=p.until&&inSlots(a)&&!reflexMay(a)&&(ownerHeld(a)||!p.held)){const held=ownerHeld(a);p.until=S.gameMin+(held?10:CHOICE_HOLD);
    if(!held&&!p.held){p.held=1;notify(a,'The choice on '+(p.title||'your adventure')+' still waits for you: '+p.opts.a+' (a) or '+p.opts.b+' (b).',3)}
    adv.stage='choose';return 'wait'}
  if(S.gameMin>=p.until){adv.pick=null;adv.pickTimedOut=(adv.pickTimedOut||0)+1;return null}
  adv.stage='choose';return 'wait'}
