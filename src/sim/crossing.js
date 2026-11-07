// The crossing (#1013 slice 3): a company takes a road off one map onto another, all or none, as a decision at the Table. Owned by
// ai-designer. DOM-free, no gameplay dice. sim/mappack.js moves the world; this file says when, who decides, what they leave behind.
//
//   the road   C.road (sim/atlas.js roadWord): the leader's own order or stated aim named the exit or a place beyond it. Nothing else
//              ever makes one, so a company hunting near the map's edge is never asked, and scripted heroes never walk to an exit.
//   the holds  when the leader reaches the road and something stands in the way, nothing opens: the words go to the leader, the members
//              (brief.crossing_waits) and the DM, and whoever is out of range is told to come (the opening's q.hold, #771). All or none:
//              there is no "leave them". The road waits as long as the order stands.
//   the scene  kind 'crossing', PLAY 'all', one round: go, wait, turn_back. Settled as a vote: go needs more voices than the rest, the
//              leader breaks a tie. The DM frames it (table_call); the scripted frame is the exit's name and what is known of the far side.
//              A reflex says go only when the owner resumed a gone runner; a live agent that ran out the clock says wait.
//   after it   wait or turn_back end the road: it is not asked again until the leader gives such an order anew.
//   cross()    one tick, at the head of a step (nothing has read the map yet, and the spatial index is rebuilt after it): the adventure
//              set aside, orders and aims of the old map dropped, place-bound whens parked with their map, switchMap, the company spread
//              at the entry exit.
//   farside    kind 'farside', PLAY 'all', one round, everyone present: the first view of the land, framed by the DM the way session zero
//              is; when the DM is slow the scripted line says it from the entry exit and the map's own words. A map never opens in silence.
//
// A host with runner links only (hasLinks) and only with exits on the map: npm run sim and the seeded hashes never get past the first line.
// One company at a time (v1): a road opens only when the crossing company is the last on the map. A company frozen on another map would
// hold the continuous gate with runners that have no world to play in; parked seats are a later design.
//
// homeOf on a map with no town of the hero's people (a.town keeps the old map's name; data/races.js falls to the people's town, then the
// first town of the faction, then CITY[0]). Who reads it, and what each does there:
//   rest      the town state and autopilot's rest and inn walk (heroes.js, player.js homeCmd): heals at that town's inn
//   sell      sellAndShop, autopilot sell_loot: walks to that town; the auction house is one market for the campaign
//   flee      flee and the reflex below 15%: runs for that gate
//   mend      a scripted hero's mend state, chapelVisit: that town's inn and priest
//   arrivals  a fallen member's recruit: townOf and place in arrival.js ask townNear, so it comes to the nearest town that takes the company
//   town-idle townGuard, boardFits, list_jobs: that town's board
// So a far map must have such a town. The rule for v1: every canon map holds a town each faction may rest in, and npm run worldcheck
// asserts it; in a world of lore sides (#1025) every town is home. With no such town (a fixture) these all read CITY[0], which still walks.
//
// State (plain data, saved with the company):
//   C.road {exit, by, at, aim?, walk?, phase?:'table'|'go', since?, hold?:{k, text, come?, since, away:[id]}}
import {S,dayNo,inCompany,ownTown} from './state.js';
import {MAP_ID,ZONES,CITY,zoneAt,dist} from '../world/map.js';
import {W,H} from '../world/tiles.js';
import {MAPS} from '../world/spec.js';
import {standAt} from '../world/passable.js';
import {hash} from '../core/rng.js';
import {homeOf} from '../data/races.js';
import {exitById,exitOpen,exitNamed,beyond,mapName,roadHolds,markOathMap,townNear,questAside,questBack,stampLore} from './atlas.js';
import {boundWords} from './farlands.js';
import {switchMap,crossers} from './mappack.js';
import {log} from './chronicle.js';
import {timeline,record} from './history.js';
import {dmlog} from './dmlog.js';
import {remember} from './memory.js';
import {notify} from './notify.js';
import {knowsPlace,learnPlace} from './lore.js';
import {hasLinks,reflexMay} from './runlink.js';
import {worldHeld} from './prep.js';
import {isDown} from './downed.js';
import {inRange} from './reach.js';
import {maxHp} from './heroes.js';
import {wounded} from './wounds.js';
import {holdAdventure} from './dm.js';
import {unstage} from './staged.js';
import {parkWhens,unparkWhens} from './dmwhen.js';
import {companies,companyOf,members,campaign,spreadAt,slotted,slotHeroes} from './company.js';
import {followLead,openProps} from './council.js';
import {PLAY,TABLE,openScene,setSceneKind,sceneFor,tableOn} from './table.js';
import {voicedKind,pushCall,resolveCall,voiceLive,openingLead} from './arrival.js';

export const CROSS={
  VOTE_MIN:240, // game minutes a go stands while something holds the company at the road; then it lapses and the leader must order it anew
  IN:2.5,       // tiles inside the map's edge the company comes to on an edge exit
  SPENT:4,      // tiles past a road's reach that still count as at it for an aim ended on arrival (INTENT.NEAR can end the walk short of the reach)
};
const BUSY={fight:'is fighting',duel:'is in a duel',assist:'is in a fight',raid:'rides in a raid',dungeon:'is below ground',aid:'is tending someone',ghost:'is gone'};
const gd=t=>({t,c:'gd'}),nar=t=>({t,c:'nar'});
const byId=id=>S.agents.find(x=>x.id==id)||null;
const living=a=>!!a&&a.kind==='hero'&&a.state!=='dead';
const memOf=C=>(C===slotted()?slotHeroes(C):members(C).filter(a=>!a.hire)).filter(living);
const names=L=>L.length<2?L.join(''):L.slice(0,-1).join(', ')+' and '+L[L.length-1];
const who=L=>names(L.map(a=>a.name))+(L.length>1?' are':' is');
const plain=ps=>(ps||[]).map(p=>typeof p==='string'?p:p&&p.kind==='hero'?p.name:p&&p.t||'').join('');
const cap=t=>t.charAt(0).toUpperCase()+t.slice(1);
const coName=(C,ld)=>C.name||(ld?ld.name+'\'s company':'The company');
const pickH=(seed,k,list)=>list[Math.floor(hash(seed|0,k,1013)*list.length)%list.length];
// The DM's plans that name a map, for its calls alone. Plans are campaign-wide, so this is where it prepares the next land (notes_write).
const plansFor=id=>{const P=S.dmAgent&&S.dmAgent.notes&&S.dmAgent.notes.plans||[],n=String(mapName(id)).toLowerCase();
  return P.filter(x=>[x.title,x.text,x.about,...(x.tags||[])].join(' ').toLowerCase().includes(n)).map(x=>x.text).join(' | ').slice(0,600)};
const DIR=['east','south-east','south','south-west','west','north-west','north','north-east'];
const dirOf=(a,b)=>DIR[(Math.round(Math.atan2(b.y-a.y,b.x-a.x)/(Math.PI/4))+8)%8];

// ---- the holds ----
// What keeps this company from the table at its road right now, or null. The words go to the hero: nothing of the DM's in them.
function holdOf(C,ld,e,L){const here=new Set(C.ids),say=t=>'The road waits: '+t;
  if(worldHeld())return {k:'held',text:say('the world is held.')};
  if(!tableOn())return {k:'off',text:say('a crossing is the whole company\'s to decide at the table, and the table is closed.')};
  const stray=S.agents.filter(a=>a.state!=='dead'&&inCompany(a)&&!here.has(a.id)&&!(a.party&&a.party.mem.includes(ld)));
  if(stray.length){const O=companyOf(stray[0]);return {k:'others',text:say((O&&O.name||stray[0].name)+' still rides this land, and a road between lands is taken only by the last company on it.')}}
  if(sceneFor(C))return {k:'table',text:say('your company is at the table.')};
  {const P=openProps(C)[0];if(P)return {k:'vote',text:say('the vote on "'+P.details+'" is still open.')}}
  const busy=L.filter(a=>BUSY[a.state]);if(busy.length)return {k:'fight',text:say(busy[0].name+' '+BUSY[busy[0].state]+'.')};
  const down=L.filter(isDown);if(down.length)return {k:'down',text:say(who(down)+' down. Nobody crosses and leaves them, and nobody carries them over.')};
  if(C.camp&&C.camp.phase)return {k:'camp',text:say('your company is camped. Break camp first.')};
  if(C.prologue||S.opening&&S.opening.queue&&S.opening.queue.some(q=>q.company===C.id))return {k:'opening',text:say('your company has not had its first table.')};
  const off=L.filter(a=>a.splitUntil);if(off.length)return {k:'split',away:off.map(a=>a.id),text:say(who(off)+' off on their own. All of you go, or none: gather first.'),come:'Your company waits for you at '+e.name+': it goes all together or not at all. Come back to it ('+'follow '+ld.name+').'};
  const far=L.filter(a=>a!==ld&&!inRange(ld,a));if(far.length)return {k:'far',away:far.map(a=>a.id),text:say(who(far)+' out of shouting range. All of you go, or none: gather first.'),come:'Your company waits for you at '+e.name+': it goes all together or not at all. Walk there now (follow '+ld.name+').'};
  if(S.rulings&&S.rulings.cur.some(r=>here.has(r.hero)))return {k:'ruling',text:say('something is still being tried.')};
  {const t=S.talks&&S.talks.cur.find(c=>c.state==='open'&&c.heroes.some(id=>here.has(id)));if(t)return {k:'talk',text:say('someone of yours is still talking with '+t.name+'.')}}
  return null}
// A hold is told once for each thing that holds them, and again for whoever is newly away.
function holdFor(C,R,ld,h){const was=R.hold,away=h.away||[],same=was&&was.k===h.k;
  const fresh=away.filter(id=>!(same&&(was.away||[]).includes(id)));
  R.hold={...h,away,since:same?was.since:Math.round(S.gameMin)};
  if(!same&&h.k!=='held')notify(ld,h.text,true,2);
  for(const id of fresh)notify(byId(id),h.come,true,2)}

// ---- the leaving ----
// What the company knows of the far side, from what they have walked or heard. Never the far map's words for those who have not.
function knownWords(e,L){const to=e.to.map,heard=beyond(e).filter(n=>L.some(a=>knowsPlace(a,n)));
  if(S.maps&&S.maps[to])return 'You have walked it before: it runs back to '+mapName(to)+'.';
  return heard.length?'They say it leads on toward '+names(heard.slice(0,2))+'.':'Nobody here has walked it, and what lies past the last milestone is anyone\'s guess.'}
function openCrossing(C,R,ld,e,L){const z=ZONES[zoneAt(ld.x,ld.y)]||'the wilds';
  const frame=[ld,' brings ',gd(coName(C,ld)),' to where ',gd(e.name),' leaves '+z+'. ',knownWords(e,L),' Past here you go all together or not at all.'];
  const sc=openScene('crossing',cap(e.name)+': the road out',frame,{crossing:1,exit:e.id,name:e.name,lead:ld.id,anchor:ld.id,setting:'field'},C);
  if(sc)R.phase='table';return sc}
const optsCross=sc=>[{k:'go',text:'Go on: take '+sc.ctx.name+' and leave this land'},{k:'wait',text:'Wait here; the road can keep'},{k:'turn_back',text:'Turn back'}];
// No reflex carries anyone over a border by itself: a live agent that ran out the clock waits. A gone runner the owner resumed plays on.
const reflexCross=(sc,a)=>reflexMay(a)&&a.hp>=maxHp(a)*.5&&!wounded(a)?'go':'wait';
const applyCross=(sc,a,act)=>act.k==='go'?'is for going on':act.k==='wait'?'would wait':act.k==='turn_back'?'would turn back':null;
const VOICES=['go','wait','turn_back'];
// The leader settles it as a vote does: more voices for going than against, or the leader's own on a tie.
function tally(sc,ld){const b=sc.beats.filter(x=>VOICES.includes(x.k)),n=k=>b.filter(x=>x.k===k).length,mine=(b.find(x=>ld&&x.id===ld.id)||{}).k;
  const rest=n('wait')+n('turn_back');if(n('go')>rest||n('go')===rest&&n('go')&&mine==='go')return {out:'go',n};
  return {out:n('turn_back')>n('wait')||n('turn_back')===n('wait')&&mine==='turn_back'?'turn_back':'wait',n}}
function endAim(ld,e,why){const I=ld&&ld.intent;if(I&&!I.done&&exitNamed(I.goal)===e)I.done={at:Math.round(S.gameMin),why}}
function settleCross(sc){const C=companies().find(x=>x.id===sc.company),R=C&&C.road;if(!C)return '';const ld=openingLead(C),e=exitById(sc.ctx.exit),{out,n}=tally(sc,ld),L=memOf(C);
  const vote=n('go')+' for going, '+(n('wait')+n('turn_back'))+' against';
  if(out==='go'&&R&&e){R.phase='go';R.since=Math.round(S.gameMin);delete R.hold;campaign(C,'council',gd(coName(C,ld)),' takes ',gd(e.name),' ('+vote+').');
    for(const a of L)remember(a,'council','We chose to take '+e.name+' and leave this land ('+vote+').');return 'They take the road ('+vote+').'}
  delete C.road;const back=out==='turn_back',why=back?'the company turned back from the road':'the company chose to wait at the road';if(e)endAim(ld,e,why);
  if(ld&&e)campaign(C,'council',gd(coName(C,ld)),back?' turns back from ':' stays at ',gd(e.name),' ('+vote+').');
  for(const a of L)remember(a,'council','We came to '+(e?e.name:'the road')+' and did not take it ('+vote+').');
  if(back&&ld)walkBack(ld);
  if(ld)notify(ld,'The road is not taken. It will not be put to the company again until you order it anew.',true);
  return (back?'They turn back':'They wait; the road stays where it is')+' ('+vote+').'}
function walkBack(ld){const c=homeOf(ld),g=c.gate;if(!g)return;ld.pq=[{kind:'move',legs:[{x:g.x,y:g.y,st:'return'}],last:'town',label:c.name}];if(ld.state==='follow')ld.state='hunt';ld.dest=null;followLead(ld,c.name)}
const DM_CROSS={
  onFrame(sc){const c=sc.ctx,e=exitById(c.exit),to=e&&e.to?e.to.map:null,M=MAPS[to]||{},walked=!!(S.maps&&S.maps[to]),n=plansFor(to);
    pushCall(sc,{kind:'frame',ms:TABLE.frameMs,who:'the narrator',about:'The leader has brought the company to '+c.name+', the road off this map, and they decide now whether to take it: all of them or none. What the table shows: '+plain(sc.frame)+' Beyond it (yours alone): '+mapName(to)+(M.blurb?', '+M.blurb:'')+(walked?'; they have walked it before.':'; none of them has been there.')+(n?' Your notes say: '+n:'')+' Write the road going out of sight: a few lines of what they see and hear from here, nothing they could not. Decide nothing for them.'})},
  onAll(){},
  live:voiceLive,
  fill(sc,c){resolveCall(sc,c,{text:'',by:'scripted'})}, // the scene's own frame stands: the exit's name and what is known
  done(){},
};
PLAY.crossing='all';
setSceneKind('crossing',{options:optsCross,reflex:reflexCross,apply:applyCross,outcome:settleCross,dm:DM_CROSS,noAttempt:true});
voicedKind('crossing',null);

// ---- the crossing itself ----
// A spot just inside the land from the far end of the road, so nobody stands off the edge of a map.
function entrySpot(e){const d=e.edge?{N:[0,1],S:[0,-1],E:[-1,0],W:[1,0]}[e.edge.side||e.edge]||[0,0]:[0,0];return {x:e.x+d[0]*CROSS.IN,y:e.y+d[1]*CROSS.IN}}
const onMap=q=>({x:Math.max(1.5,Math.min(W-2.5,q.x)),y:Math.max(1.5,Math.min(H-2.5,q.y))});
// What an order, an aim or a job of the old map means on the next: nothing. The adventure is set aside with its map (adv.held) and taken up
// within QL.NEAR on return; an aim's coordinates and a remembered ground are numbers of the old map, so the next turn asks a new aim.
function leaveBehind(C,go,ld){for(const a of [ld,...go])if(a&&a.adv)holdAdventure(a);
  for(const a of go){a.pq=[];delete a.playGround;delete a.heardAim;markOathMap(a);questAside(a);stampLore(a);for(const c of CITY)if(ownTown(c,a))learnPlace(a,c.name,'seen');const I=a.intent;if(I&&!I.done)I.done={at:Math.round(S.gameMin),why:'you left that land behind'}}
  delete C.road;delete C.wait;delete C.waitDun;delete C.accept;delete C.tableQ;
  for(const p of C.plans||[])if(p.status==='open')p.status='left'; // they crossed together: a meeting of the old land has nobody left to miss it
  const P=(S.parties||[]).find(p=>p.company===C.id);if(P)delete P.dest;
  if(S.staged&&S.staged.cur&&S.staged.cur.phase==='waiting')unstage();} // whatever was walking to meet them is left on that road, and the DM log says so
// All or none, in one tick. Everyone who rides with the company goes: its members, its hires, anyone in its party. Returns the far side's exit.
export function cross(C,e){const from=MAP_ID,to=e.to.map,first=!(S.maps&&S.maps[to]),go=[...crossers()],ld=openingLead(C),L0=memOf(C),bound=C.road&&C.road.bound||null;
  leaveBehind(C,go,ld);parkWhens(from);
  switchMap(to);
  const back=exitById(e.to.exit),at=back?entrySpot(back):homeOf(ld).gate,n=go.length;
  go.sort((x,y)=>(L0.indexOf(y)>=0)-(L0.indexOf(x)>=0)||L0.indexOf(x)-L0.indexOf(y)).forEach((a,i)=>{const q=spreadAt(at,i,n),p=standAt(onMap(q).x,onMap(q).y);a.x=p.x;a.y=p.y;a.zone=zoneAt(a.x,a.y);a.dest=null;a.moving=false;if(a.state==='town')a.state='hunt';questBack(a)});
  unparkWhens(to);
  const z=ZONES[zoneAt(at.x,at.y)]||null,c=nearest(at);
  for(const a of go){if(z)learnPlace(a,z,'seen');learnPlace(a,mapName(to),'seen');learnPlace(a,mapName(from),'seen');learnPlace(a,e.name,'seen');if(back)learnPlace(a,back.name,'seen');if(c)learnPlace(a,c.name,'seen');record(a,'Took ',gd(e.name),' out of ',gd(mapName(from)),' into ',gd(mapName(to)),'.')}
  log(gd(coName(C,ld)),' takes ',gd(e.name),' out of ',gd(mapName(from)),' and comes to ',gd(mapName(to)),'.');
  timeline('oath',gd(coName(C,ld)),first?' came for the first time to ':' came back to ',gd(mapName(to)),'.');
  campaign(C,'council',gd(coName(C,ld)),' crosses from ',gd(mapName(from)),' into ',gd(mapName(to)),'.');
  dmlog('agent',null,[(C.name||'A company')+' crossed from '+mapName(from)+' to '+mapName(to)+' by '+e.name+' on day '+dayNo()+'.'+(first?' A new land: it is yours to fill.':'')],{by:'scripted',crossing:true,from,to,company:C.id,first},{heroes:go.map(a=>a.id)});
  for(const a of L0)notify(a,'You have crossed into '+mapName(to)+', by '+e.name+'. What you knew of the road behind stays behind you.',true,1);
  openFarside(C,back||e,ld,first,bound);return back}
function nearest(p){let b=null,bd=1e9;for(const c of CITY){const d=dist(p,c.gate);if(d<bd){bd=d;b=c}}return b}

// ---- the far side ----
function farFrame(C,ld,e,first,at){const M=MAPS[MAP_ID]||{},z=ZONES[zoneAt(at.x,at.y)]||'open country',c=nearest(at);
  return [gd(coName(C,ld)),first?' comes down ':' comes back down ',gd(e.name),' into ',gd(z),M.name?', in '+M.name:'','. ',M.blurb?M.blurb+' ':'',c?'The nearest walls are '+c.name+', '+dirOf(at,c.gate)+' of here.':'No walls stand anywhere in sight.']}
function openFarside(C,e,ld,first,bound){const at=ld||{x:e.x,y:e.y},town=nearest(at),frame=farFrame(C,ld,e,first,at),L=memOf(C);
  const ctx={farside:1,map:MAP_ID,exit:e.name,first:first?1:0,town:town?town.name:null,anchor:ld?ld.id:null,lead:ld?ld.id:null,setting:'field',...(bound?{bound}:{})};
  const sc=tableOn()?openScene('farside',(first?'A new land: ':'Back in ')+mapName(MAP_ID),frame,ctx,C):null;
  if(!sc)settleFar(C,ctx,L.map(a=>a.id));return sc}
function settleFar(C,ctx,ids){const L=ids.map(byId).filter(living),ld=byId(ctx.lead);
  const line=(ctx.first?'We came down '+ctx.exit+' into '+mapName(ctx.map)+' for the first time.':'We came back to '+mapName(ctx.map)+' by '+ctx.exit+'.')+(ctx.town?' The nearest walls are '+ctx.town+'.':'');
  for(const a of L)remember(a,'table',line);
  if(ld)notify(ld,'The road is behind you. Where you go in '+mapName(ctx.map)+' is yours to say: name your aim, and look round before you lead on.'+boundWords(ld,ctx.bound),true,2);
  return line}
const DM_FAR={
  onFrame(sc){const c=sc.ctx,M=MAPS[c.map]||{},n=plansFor(c.map),L=sc.ids.map(byId).filter(living);
    pushCall(sc,{kind:'frame',ms:TABLE.frameMs,who:'the narrator',about:(c.first?'The company has come to '+mapName(c.map)+' for the first time: the first view of a new land, and the one the watcher waits for.':'The company is back in '+mapName(c.map)+'.')+' Here: '+names(L.map(a=>a.name+' ('+a.cls+')'))+'. What the table shows: '+plain(sc.frame)+(M.blurb?' The land: '+M.blurb:'')+(n?' Your notes say: '+n:'')+' Write what they see as the road comes out of the last hills: one or two short paragraphs. Hint at what you have planned through what can be seen, reveal none of your secrets, decide nothing for them.'})},
  onAll(){},
  live:voiceLive,
  fill(sc,c){resolveCall(sc,c,{text:pickH(sc.id,1,['The milestones end and the road goes on without them.','The wind changes as the road comes down, and it smells of other country.','Behind them the road bends out of sight; ahead the land opens.'])+' '+plain(sc.frame),by:'scripted'})},
  done(){},
};
PLAY.farside='all';
setSceneKind('farside',{options:()=>[{k:'look',text:'Take in the land ahead'},{k:'speak',text:'Say what you make of it'}],reflex:()=>'look',apply:(sc,a,act)=>act.k==='speak'?'says what they make of it':act.k==='look'?'takes in the land':null,
  outcome:sc=>settleFar(companies().find(x=>x.id===sc.company),sc.ctx,sc.ids),dm:DM_FAR});
voicedKind('farside',null);

// Away from the road, something must still be taking the leader there (#1048): an order's road lasts while its walk does (a camp, a fight
// order or a flight clears it, and the leader is then on no road), an aim's while the aim stands, which autopilot carries on.
const onTheWay=(R,ld,e)=>R.aim==null?(ld.pq||[]).some(c=>c.kind==='move'&&c.label===R.walk):!ld.intent.done||dist(ld,e)<=e.r+CROSS.SPENT;

// ---- once per step, ahead of everything that reads the map (sim/index.js) ----
export function crossingTick(){const CS=S.companies;if(!CS||!CS.some(C=>C.road)||!hasLinks())return;
  for(const C of companies()){const R=C.road;if(!R)continue;const ld=openingLead(C),e=exitById(R.exit),L=memOf(C);
    if(!ld||!e||!exitOpen(e)||R.phase!=='go'&&R.by!==ld.id||!R.phase&&!roadHolds(R,ld)){delete C.road;continue}
    if(R.phase==='table'){if(!sceneFor(C))delete R.phase;continue} // a scene closed with no outcome: the road is back as the leader left it
    if(!R.phase&&dist(ld,e)>e.r){delete R.hold;if(!onTheWay(R,ld,e))delete C.road;continue}
    if(R.phase==='go'&&sceneFor(C))continue; // the outcome is still on the table
    if(R.phase==='go'&&dist(ld,e)>e.r){delete C.road;notify(ld,'You walked away from '+e.name+', and the company\'s word to take it goes with you. Order it anew when you are ready.',true,2);continue}
    const h=holdOf(C,ld,e,L);
    if(h){holdFor(C,R,ld,h);if(R.phase==='go'&&S.gameMin-R.since>=CROSS.VOTE_MIN){delete C.road;endAim(ld,e,'the road was not taken in time');notify(ld,'The company\'s word to take '+e.name+' has lapsed: too much stood in the way. Order it anew when you are ready.',true,2)}continue}
    delete R.hold;
    if(R.phase==='go'){cross(C,e);return} // the world changed: nothing else this tick
    openCrossing(C,R,ld,e,L)}}
