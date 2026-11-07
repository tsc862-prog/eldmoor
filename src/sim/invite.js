// Inviting the tools nothing else invites (#872 trades and gathering, #864 attempt; the same cause as the wishes of #829). Owned by
// ai-designer. DOM-free, no RNG, agent-played heroes only: words in `look` and in the turn header, nothing is learned, gathered or
// tried for anyone, and every decision stays the agent's.
//   look         lookInvites: the trainer (once a town visit), the materials selling best, the gathering spots in sight, can_attempt.
//   turn header  inviteBrief: at most ONE short line a turn (brief.invite {kind, text, node?}), and rarely, since a header line costs
//                on every turn it rides (#799):
//                  nodes_in_sight  a ready spot the hero can work, on a change of spot, INVITE.NODE_GAP apart
//                  trainer         in a friendly town with a trade slot free: once a visit, once a game day
//                  nodes_in_sight  spots seen by a hero with no gathering trade: every INVITE.SPOT_GAP (they are everywhere)
//                  attempt         after a narrator's line heard (a.dmSaid, #864): once a line, INVITE.TOLD_GAP apart. The one open-world
//                                  use in the logs came from such a line: the DM described a bow in the webs and the hero tried for it
//                  attempt         where one fits (attemptFit): once a game day
//                All but the first and the narrator's also keep INVITE.GAP between any two. Never in a fight, a scene, asleep or at a reflection.
// inviteBrief only reads. inviteSeen writes the marks (a.nudge, lazy, saved with the hero) on the brief a runner reads after its wake
// (sim/player-host.js), so the relay's after-turn brief for the behavior log spends nothing.
// Sight and lore: only what stands in the hero's sight or earshot; a staged trap, being hidden, is never named.
import {S,ownTown} from './state.js';
import {CITY,LANDMARKS,dist,tileAt} from '../world/map.js';
import {WALL,RIVER} from '../world/tiles.js';
import {PROF_IDS,PROF,MAX_PROF} from '../data/professions.js';
import {MATERIALS,price} from '../data/items.js';
import {homeOf} from '../data/races.js';
import {professionsOf} from './professions.js';
import {nodeNear,isReady} from './nodes.js';
import {canGather,PROF_OF,compass} from './gather.js';
import {sightRange} from './sighthero.js';
import {localsNear} from './locals.js';
import {HEAR} from './chat.js';
import {attemptsLeft} from './ruling.js';
import {reflectDue} from './reflect.js';
import {asleep} from './camp.js';

export const INVITE={
  ON:true,
  GAP:480,       // game minutes between two invitations of any kind but a spot the hero can work
  DAY:1440,      // game minutes between two invitations of one kind
  SPOT_GAP:4320, // game minutes between two telling a hero with no gathering trade of the spots it passes
  NODE_GAP:120,  // game minutes between two spots a hero with the trade is told of
  SPOTS:3,       // gathering spots named at most in look
  HEAD_SPOTS:2,  // and in the turn header
  REACH:3,       // tiles: a marked place or a landmark close enough to try something at
  EDGE:2,        // tiles: a river bank or a rock wall in the way
  TOLD:120,      // game minutes a narrator's line stays fresh enough to answer
  TOLD_GAP:240,  // game minutes between two invitations after a narrator's line
};
const NO_FIT=new Set(['fight','duel','assist','raid','dungeon','downed','aid','ghost','dead']); // nobody stops to think here

const inRect=(c,p,pad=0)=>p.x>=c.x0-pad&&p.x<=c.x1+1+pad&&p.y>=c.y0-pad&&p.y<=c.y1+1+pad;
const cityAt=a=>CITY.find(c=>inRect(c,a,.5))||null;
// The town whose trainers will teach this hero (learn_profession's own rule), or null.
function trainerTown(a){if(a.state==='town')return homeOf(a);const c=cityAt(a);return c&&ownTown(c,a)?c:null}
const since=(n,k)=>S.gameMin-(n&&n[k]!=null?n[k]:-1e9);

// ---- trades ----
function trainerDue(a){const c=trainerTown(a);if(!c||professionsOf(a).length>=MAX_PROF)return null;const n=a.nudge;
  return n&&n.town===c.name||since(n,'townAt')<INVITE.DAY?null:c}
function trainerLine(a){const held=professionsOf(a).map(p=>p.id);
  return 'Trainers here teach '+PROF_IDS.filter(id=>!held.includes(id)).join(', ')+' (learn_profession; recipes shows each).'}
function toldTown(a,c){const n=a.nudge||(a.nudge={});n.town=c.name;n.townAt=Math.round(S.gameMin);n.at=n.townAt}

// Ready spots in sight, nearest first. None inside a town: nothing is gathered within the walls.
const spotsOf=a=>cityAt(a)?[]:nodeNear(a.x,a.y,sightRange(a)).filter(isReady);
const article=s=>(/^(?:[aeiou]|herb)/.test(s)?'an ':'a ')+s;
function spotWords(a,n){const d=Math.round(dist(a,n)),w=compass(n.x-a.x,n.y-a.y);
  return article(n.name.toLowerCase())+' '+(w==='here'?'here':d+' tiles '+w)+' ('+PROF[PROF_OF[n.kind]].name.toLowerCase()+')'}
const gatherHeld=a=>professionsOf(a).some(p=>p.kind==='gather');
function spotsLine(a,L,max=INVITE.SPOTS){const any=L.some(n=>canGather(a,n).ok);
  return L.slice(0,max).map(n=>spotWords(a,n)).join(', ')+'; '+(any?'you can work '+(L.length>1?'those of your trade':'it')+' (gather)':gatherHeld(a)?'not within your trades yet':'you hold no gathering trade')}

// The two gathered materials the auction house pays most for now: a reason to hold a trade.
export function sellsBest(){return Object.keys(MATERIALS).sort((x,y)=>price(y)-price(x)||(x<y?-1:1)).slice(0,2).map(m=>m+' about '+price(m)+'g').join(', ')}

// ---- attempt ----
// What is close enough to try something at, in words, or null. Nearest kind of thing first; no secrets.
// A landmark is reached at its edge or its mouth, not only its middle: a lair's rock is wide, a crypt's door stands off its centre.
const edgeOf=(a,l)=>{const m=l.mouth,c=dist(a,l);return m?Math.min(c,dist(a,{x:(m.x0+m.x1+1)/2,y:(m.y0+m.y1+1)/2})):Math.max(0,c-(l.r||0))};
function attemptFit(a){const near=p=>dist(a,p)<=INVITE.REACH,off=p=>Math.max(1,Math.round(dist(a,p)));
  const pl=(S.places||[]).find(near);if(pl)return pl.name+', '+off(pl)+' tiles off';
  const lm=LANDMARKS.find(l=>edgeOf(a,l)<=INVITE.REACH);if(lm)return lm.name+', '+Math.max(1,Math.round(edgeOf(a,lm)))+' tiles off';
  const p=localsNear(a).find(x=>x.dist<=HEAR);if(p)return p.name+', in earshot';
  if(cityAt(a))return null;
  const e=INVITE.EDGE,tx=Math.floor(a.x),ty=Math.floor(a.y);
  for(let y=ty-e;y<=ty+e;y++)for(let x=tx-e;x<=tx+e;x++){const t=tileAt(x,y);if(t===RIVER)return 'the river bank';if(t===WALL)return 'the rock wall'}
  return null}

// ---- the turn header ----
export function inviteBrief(a,tv){if(!INVITE.ON||!a.player||NO_FIT.has(a.state)||tv||asleep(a)||reflectDue(a))return null;
  const n=a.nudge,L=spotsOf(a),mine=L.filter(x=>canGather(a,x).ok);
  if(mine.length&&(!n||n.node!==mine[0].id)&&since(n,'nodeAt')>=INVITE.NODE_GAP)return {kind:'nodes_in_sight',node:mine[0].id,text:'Gathering spots: '+spotsLine(a,mine,INVITE.HEAD_SPOTS)+'.'};
  if(a.dmSaid!=null&&S.gameMin-a.dmSaid<=INVITE.TOLD&&!(n&&n.said===a.dmSaid)&&since(n,'toldAt')>=INVITE.TOLD_GAP&&attemptsLeft(a)>0)
    return {kind:'attempt',said:a.dmSaid,text:'If what the narrator just told calls for something no tool names, try it (attempt {what}, in your own words).'};
  if(since(n,'at')<INVITE.GAP)return null;
  if(trainerDue(a))return {kind:'trainer',text:trainerLine(a)};
  if(L.length&&!gatherHeld(a)&&professionsOf(a).length<MAX_PROF&&since(n,'spotAt')>=INVITE.SPOT_GAP)return {kind:'nodes_in_sight',text:'Gathering spots: '+spotsLine(a,L,INVITE.HEAD_SPOTS)+'.'};
  if(since(n,'tryAt')>=INVITE.DAY&&attemptsLeft(a)>0){const f=attemptFit(a);if(f)return {kind:'attempt',text:'You could attempt something here (attempt {what}, in your own words): '+f+'.'}}
  return null}

// The runner read this brief after its wake: what it carried is told, and a town left behind ends the visit.
export function inviteSeen(a,b){let n=a.nudge;const t=trainerTown(a);if(n&&n.town&&(!t||t.name!==n.town))n.town=null;
  const v=b&&b.invite;if(!v)return;const gm=Math.round(S.gameMin);n=a.nudge||(a.nudge={});
  if(v.kind==='trainer')toldTown(a,t);
  else if(v.kind==='attempt'&&v.said!=null){n.said=v.said;n.toldAt=gm}
  else if(v.kind==='attempt'){n.tryAt=gm;n.at=gm}
  else if(v.node){n.node=v.node;n.nodeAt=gm}
  else{n.spotAt=gm;n.at=gm}}

// ---- look ----
// look is asked for, so it may say more than the header; only the trainer stays once a visit (the header's mark, either way round).
export function lookInvites(a,r){const c=trainerTown(a);
  if(c){if(trainerDue(a)){r.trainer=trainerLine(a);toldTown(a,c)}r.gathered_sells_best=sellsBest()}
  const L=spotsOf(a);if(L.length)r.nodes_in_sight=spotsLine(a,L);
  r.can_attempt=!NO_FIT.has(a.state)&&!a.hidden&&attemptsLeft(a)>0;r.attempts_left=attemptsLeft(a)}
