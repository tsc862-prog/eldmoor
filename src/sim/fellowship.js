// The Fellowship (issue #68): a compatibility shim since #588. The five-slot model (Tank/Healer/DPS places, muster,
// replacement recruit, sheet writing, the record hook, the chronicle filter) lives in sim/company.js as the `slots`
// option of a company; the Fellowship is the company that carries it (S.fellowship, an accessor over S.companies).
// The names below keep their old meaning (no argument: that company) so readers can move to company reads module by
// module; this file goes once nothing imports it (#588).
import {S} from './state.js';
import {slotted,slotMembers,slotHeroes,slotParty,slotLabel,inSlots,wasSlotted,campaign as companyCampaign,campaignBy as companyCampaignBy,
  openThreads as companyThreads,foundSlots,joinSlot,leaveSlot,setSlotMinds,enforceAgents as companyAgents,disbandSlots,
  offerReplacement as companyReplacement,seatRecruit as companySeat,enrich as companyEnrich,slotsTick,companyName} from './company.js';

export {DPS,HEALERS,LOG_CAP,setWitness,SLOTS,SLOT_KEYS,HOLD_MAX,TIMEOUT,fits,autoPick,checkSlots,MINDS,mindsOf,setArrivalHook,
  lcRoleOf,enriching,editSheet,chronicleFocus,guildLabel} from './company.js';

export const fellowship=()=>S.fellowship||null;
export const fellowshipMembers=()=>slotMembers(slotted());
export const fellows=()=>slotHeroes(slotted());
export const isFellow=a=>!!(a&&slotted()&&inSlots(a));
export const wasFellow=a=>wasSlotted(a);
export const fellowParty=()=>slotParty(slotted());
export const roleName=a=>slotLabel(a);
export const campaign=(kind,...parts)=>companyCampaign(slotted(),kind,...parts);
export const campaignBy=(kind,a,...tail)=>companyCampaignBy(slotted(),kind,a,...tail);
export const openThreads=()=>companyThreads(slotted());
export const fellowshipName=companyName;
export const found=(slots,o)=>foundSlots(slots,o);
export const join=(a,key,why,quiet)=>joinSlot(slotted(),a,key,why,quiet);
export const leave=(a,why)=>leaveSlot(slotted(),a,why);
export const setMinds=mode=>setSlotMinds(slotted(),mode);
export const enforceAgents=()=>companyAgents(slotted());
export const disbandFellowship=()=>disbandSlots(slotted());
export const offerReplacement=key=>companyReplacement(slotted(),key);
export const seatRecruit=q=>companySeat(slotted(),q);
export const enrich=a=>companyEnrich(slotted(),a);
export const fellowshipTick=dt=>slotsTick(dt);
