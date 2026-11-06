// The DM's own frame for every scene a member sees (#1017). Owned by brain-builder. DOM-free, no RNG.
// Live play: six scenes opened in 30 game hours and the DM's table voice was asked for one frame: only a few kinds brought a
// DM call of their own (the opening, an arrival, a fireside, a scene the DM staged), so a vote, a fight, an ambush at camp or a
// fork on a job opened on the game's one scripted line, with the DM's seat live and idle.
// Here every other kind gets one call as it opens, while the DM's table voice listens: the game's line stands as the ground
// truth (the foe, the question, the choice) and the DM's words follow it, heard by the table like any other narrator line. The
// members wait for it (the #682 hold) at most its budget, TABLE.frameMs from pickup. Nobody listening (npm run sim, the seeded
// checks, a runner gone), a scene that does not pause (a reflex-only scene at 3x/8x), or no agent at the table: no call at all,
// so nothing moves in a world without a DM runner. A miss leaves the game's own line; the fill is logged like any other.
import {clockStr} from './state.js';
import {ZONES,zoneAt} from '../world/map.js';
import {TABLE,setFrameHook,sceneFoeNames} from './table.js';
import {pushCall,resolveCall,voiceLive,voicedScene} from './arrival.js';

export const FRAME={ON:true};
const WHAT={decision:'They are about to vote on this',choice:'Their job forks here and they must choose',check:'The dice are about to decide this',elite:'A named foe stands before them',ambush:'They are attacked',boss:'The boss fight begins',
  rescue:'One of them is in danger of falling and the others can reach them',site:'They go down into a dungeon',room:'They reach its last door',crawl:'They enter this room of a dungeon',debrief:'A hard scene is just over and they catch their breath',talk:'A conversation has come to a decision',duel:'A duel of honour begins'};
const plain=ps=>(Array.isArray(ps)?ps:[ps]).map(p=>typeof p==='string'?p:p&&p.kind==='hero'?p.name:p&&p.t||'').join('');
const partOf=()=>{const h=+clockStr().slice(0,2);return h<6?'night':h<12?'morning':h<18?'afternoon':'evening'};
const clip=(s,n)=>{s=String(s||'').replace(/\s+/g,' ').trim();return s.length>n?s.slice(0,n-1)+'…':s};
const want=sc=>FRAME.ON&&!!sc.pause&&!(sc.kind==='crawl'&&sc.ctx&&sc.ctx.rd)&&voiceLive(sc); // a crawl's later rounds are dice: the room was framed once
function onFrame(sc,at,names,foes){const foeLine=foes.length?' Foes: '+foes.join(', ')+'.':'';if(foes.length)sc.castW=foes.slice();
  pushCall(sc,{kind:'voice',ms:TABLE.frameMs,who:'the narrator',about:(WHAT[sc.kind]||'A scene opens')+'. What the table already shows: '+clip(plain(sc.frame),300)+' At the table: '+names.join(', ')+'. In '+(ZONES[zoneAt(at.x,at.y)]||'the wilds')+', '+clockStr()+' ('+partOf()+').'+foeLine+
    ' Add what they see, hear and smell as it opens, in your own words: one to three sentences that do not repeat that line. Name no place, person or creature it does not give. Say nothing of how it will end; decide nothing for them, and speak for none of them.'})}
const fill=(sc,c)=>resolveCall(sc,c,{text:'',by:'scripted'}); // the game's own line stands
voicedScene(sc=>!!sc.gf&&!!(sc.calls&&sc.calls.some(c=>!c.done))); // only while its call waits, as a first delve's rooms (#922)
setFrameHook({want,onFrame,fill,live:voiceLive,foes:sceneFoeNames});
