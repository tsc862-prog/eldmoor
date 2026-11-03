// What a hero is trying to do, for the watcher (issue #534): one purpose per hero, goal -> target -> why.
// Read-only and DOM-free: it reads S and the hero, never writes, never rolls, and step() never calls it, so the seeded
// world is unchanged. The UI (frames, dossier header, map tooltip) shows `line`; the map overlays (src/render/purposefx.js)
// draw `path`, `tether` and `wait`, and the intent icons read `kind`.
//
//   purposeOf(a) -> {kind, goal, target, why, line, to:{x,y,label,mark}|null, path:[{x,y}], tether:{id,name}|null,
//                    wait:{id?,name?,x,y,min?}|null}
//   kind: hunt | job | wait | follow | rest | home | flee | fight | travel | town | delve | raid | ghost | dead
//   mark: what is at `to` (job, foe, person, town, place)
//
// Scripted heroes read from the state machine (state, dest, target, quest, adventure, party leader). Agent heroes read
// first their stated intent (a.intent, issue #535, when it exists), then the command they carry out (a.pq[0], incl. the
// follow command of #445), the adventure they are on, autopilot (a.playIdle, the command's `auto` words) and the last order.
import {S} from './state.js';
import {MOBS} from '../data/mobs.js';
import {ZONES,CRYPT,LAIR,zoneAt,dist} from '../world/map.js';
import {homeOf} from '../data/races.js';
import {maxHp} from './heroes.js';
import {lookingFor} from './sighthero.js';
import {gambitRec,firedFor,ownRule} from './gambits.js'; // the rule autopilot fired (#617)

const byId=id=>S.agents.find(b=>b.id===id)||null;
const zn=p=>ZONES[zoneAt(p.x,p.y)]||'the wilds';
const tiles=d=>{const n=Math.max(0,Math.round(d));return n+(n===1?' tile':' tiles')};
const mins=m=>{m=Math.max(0,Math.round(m));return m<60?m+' min':Math.floor(m/60)+' h'+(m%60?' '+m%60+' min':'')};
const third=s=>String(s||'').replace(/\byour\b/g,'its').replace(/\byou\b/g,'it'); // the command's words address the agent
// autopilot's words name the act and its reason in brackets (sim/player.js): the purpose line already has the act, so the reason
const autoWhy=t=>{const m=/\(([^()]*)\)\s*$/.exec(String(t));return third(m?m[1]:t)};
const alive=b=>!!b&&b.state!=='dead';
function foeName(t){if(!t)return '';if(t.kind==='hero')return t.name;if(t.kind==='boss')return 'Kragmaw';
  const M=MOBS[t.type];return (t.elite&&t.name?t.name:M?M.name:'a creature')+(t.lvl!=null?' (Lv '+t.lvl+')':'')}
const advOf=a=>a.adv&&S.adventures?S.adventures.find(v=>v.id===a.adv&&v.phase==='active')||null:null;
function advWhy(adv){const g=adv.data&&adv.data.giver||adv.giver&&adv.giver.name;return '“'+adv.title+'”'+(g?' for '+g:'')}
// Where the adventure's next scene is (or the elite it hunts), with a label.
function advTo(adv){const sc=adv.scenes&&adv.scenes[adv.idx];if(!sc)return null;
  const E=adv.data&&adv.data.eliteId!=null?S.mobs.find(m=>m.id===adv.data.eliteId&&m.alive&&!m.gone):null;
  if(E&&sc.type==='fight')return {x:E.x,y:E.y,label:E.name||foeName(E),mark:'foe'};
  if(!sc.at)return null;const place=adv.data&&adv.data.place&&adv.data.dest&&dist(adv.data.dest,sc.at)<1?adv.data.place:zn(sc.at);
  return {x:sc.at.x,y:sc.at.y,label:place,mark:sc.type==='fight'?'foe':sc.type==='social'||sc.type==='meet'?'person':'job'}}
const bounty=a=>a.quest&&MOBS[a.quest.type]?'bounty: '+(a.quest.have||0)+'/'+a.quest.need+' '+MOBS[a.quest.type].pl:'';
const lvlWhy=a=>'suits level '+a.lvl;
const town=a=>homeOf(a);
const pt=p=>p?{x:p.x,y:p.y}:null;

function make(o){const p={kind:o.kind||'town',goal:o.goal||'',target:o.target||'',why:o.why||'',to:o.to||null,path:o.path||[],tether:o.tether||null,wait:o.wait||null};
  if(p.to&&!p.path.length)p.path=[pt(p.to)];
  p.line=p.goal+(p.target?' → '+p.target:'')+(p.why?' · '+p.why:'');return p}

// ---- agent-played heroes ----
function agentPurpose(a){const cmd=a.pq&&a.pq.length?a.pq[0]:null,auto=a.playIdle,adv=advOf(a);
  const g=auto&&firedFor(a,cmd)&&gambitRec(a),gl=g?(ownRule(a,g.last.id)?' (by its own rule #':' (gambit #')+g.last.id+')':''; // which of its rules autopilot is following (#617)
  const why=w=>auto?'autopilot'+(cmd&&cmd.auto?': '+autoWhy(cmd.auto):w?': '+w:'')+gl:w||(cmd?'its agent’s order':'');
  if(a.state==='fight'&&a.target)return fightP(a,auto?'autopilot: fighting back':a.target.target===a?'attacked':'its agent’s call');
  if(cmd&&cmd.kind==='follow'){const b=byId(cmd.id);if(b)return followP(a,b,auto?'autopilot':'its agent’s order')}
  if(cmd&&cmd.kind==='move'){const legs=(cmd.legs||[]).map(pt),end=legs[legs.length-1]||null,c=town(a);
    const home=cmd.last==='town'&&String(cmd.label||'').includes(c.name);
    return make({kind:cmd.flee?'flee':home?'home':adv?'job':'travel',goal:cmd.flee?'Fleeing':home?'Heading home':'Walking',target:cmd.label||(end?zn(end):''),
      why:why(adv?advWhy(adv):''),to:end?{x:end.x,y:end.y,label:cmd.label||zn(end),mark:home?'town':adv?'job':'place'}:null,path:legs})}
  if(cmd&&cmd.kind==='hunt'){const z=cmd.ground!=null?ZONES[cmd.ground]:zn(a),left=Math.max(0,cmd.n-(cmd.k0==null?0:a.kills-cmd.k0));
    const prey=cmd.prey&&MOBS[cmd.prey]?MOBS[cmd.prey].pl:'';
    return make({kind:'hunt',goal:'Hunting'+(prey?' '+prey:''),target:z+' · '+left+' to go',why:why(bounty(a))})}
  if(cmd&&cmd.kind==='rest')return make({kind:'rest',goal:'Resting',target:cmd.until!=null?mins(cmd.until-S.gameMin)+' more':'',why:why(a.hp<maxHp(a)?'hurt':'')});
  if(cmd&&cmd.kind==='gather')return make({kind:'job',goal:'Gathering',target:String(cmd.label||'a node').toLowerCase(),why:why('')});
  if(cmd&&(cmd.kind==='sell'||cmd.kind==='buy'))return make({kind:'town',goal:cmd.kind==='sell'?'Selling loot':'Buying supplies',target:town(a).name,why:why('')});
  if(cmd&&cmd.kind==='fight'){const t=S.mobs.find(m=>m.id===cmd.id);return make({kind:'fight',goal:'Closing on a foe',target:t?foeName(t):'',why:why(''),to:t?{x:t.x,y:t.y,label:foeName(t),mark:'foe'}:null})}
  if(a.state==='town'){const w=scriptedPurpose(a,true);if(w)return w} // waiting in town for the leader comes before the job it waits to start
  if(adv)return advP(a,adv);
  const p=scriptedPurpose(a,true);if(p)return p;
  return make({kind:'wait',goal:'Waiting in '+(a.state==='town'?town(a).name:zn(a)),why:a.playActAt!=null?'no order for '+mins(S.gameMin-a.playActAt):'for its agent'})}

// ---- the state machine (scripted heroes, and agent heroes between orders) ----
function fightP(a,why){const t=a.target;return make({kind:'fight',goal:t.kind==='hero'?'Duelling':'Fighting',target:foeName(t),why})}
function followP(a,L,why){const d=dist(a,L);return make({kind:'follow',goal:'Following',target:L.name+' ('+tiles(d)+')',why,tether:{id:L.id,name:L.name}})}
function advP(a,adv){const to=advTo(adv),why=advWhy(adv),sc=adv.scenes&&adv.scenes[adv.idx];
  const L=a.party&&a.party.leader!==a&&alive(a.party.leader)?a.party.leader:null;
  if(L&&a.state==='follow')return followP(a,L,why);
  if(adv.stage==='wait'){const k=adv.waitKind;const left=adv.wait>0?mins(adv.wait*6)+' left':'';
    return make({kind:k==='camp'||k==='rest'?'rest':'wait',goal:k==='camp'?'Camping':k==='rest'?'Resting the night':k==='late'?'Waiting':'Waiting',target:left,why,wait:k==='late'&&to?{x:to.x,y:to.y,label:to.label}:null})}
  if(adv.stage==='fight')return a.target?fightP(a,why):make({kind:'fight',goal:'In a fight',target:to?to.label:'',why});
  if(adv.stage==='choose')return make({kind:'job',goal:'Weighing a choice',target:to?to.label:'',why});
  return make({kind:'job',goal:sc&&sc.type==='fight'?'Hunting down':'On the way',target:to?to.label:'',why,to})}

function scriptedPurpose(a,agent){const c=town(a),adv=advOf(a);
  switch(a.state){
  case 'dead':return make({kind:'dead',goal:'Fallen',target:a.cause||'',why:'gone forever'});
  case 'ghost':return make({kind:'ghost',goal:'Running back as a ghost',target:c.name,why:'to rise again',to:{x:c.grave.x,y:c.grave.y,label:c.name+' graveyard',mark:'town'}});
  case 'fight':if(a.target)return fightP(a,adv?advWhy(adv):a.quest&&a.target.type===a.quest.type?bounty(a):a.target.target===a?'attacked':'hunting');break;
  case 'duel':if(a.target)return make({kind:'fight',goal:'Duelling',target:a.target.name,why:a.nemesis&&a.nemesis[a.target.id]?'a blood debt':'a chance meeting on the road'});break;
  case 'assist':return make({kind:'fight',goal:'Rushing to help',target:a.target?a.target.name:'a guildmate',why:'a guildmate under attack',to:a.target?{x:a.target.x,y:a.target.y,label:a.target.name,mark:'foe'}:null});
  case 'raid':return make({kind:'raid',goal:'Raiding',target:'Kragmaw',why:'the wyrm’s hoard',to:LAIR?{x:LAIR.x,y:LAIR.y,label:'Kragmaw’s lair',mark:'foe'}:null});
  case 'dungeon':{const st=a.siteIn!=null&&S.sites?S.sites.list.find(x=>x.id===a.siteIn):null;if(st&&a.hidden)return make({kind:'delve',goal:'Delving',target:st.name,why:'toward '+st.boss})} // a DM-made site (#69)
    return a.hidden?make({kind:'delve',goal:'Delving',target:CRYPT.name,why:'toward '+CRYPT.boss})
    :make({kind:'wait',goal:'Waiting for a group',target:CRYPT.name,why:'a Crypt run',wait:{x:CRYPT.x,y:CRYPT.y,label:CRYPT.name},to:{x:CRYPT.x,y:CRYPT.y,label:CRYPT.name,mark:'place'}});
  case 'camp':return make({kind:'rest',goal:'Resting at camp',target:zn(a),why:a.playDoing&&!a.player?a.playDoing:'the company camps'});
  case 'regroup':return make({kind:'flee',goal:'Pulling back',target:a.dest?zn(a.dest):'',why:'after a skirmish',to:a.dest?{x:a.dest.x,y:a.dest.y,label:'regroup',mark:'place'}:null});
  case 'return':{const hurt=a.hp<maxHp(a)*.5;return make({kind:'home',goal:'Heading home',target:c.name,why:hurt?'hurt':'to sell and rest',to:{x:c.gate.x,y:c.gate.y,label:c.name,mark:'town'}})}
  case 'follow':{const L=a.party&&alive(a.party.leader)&&a.party.leader!==a?a.party.leader:null;if(L)return followP(a,L,adv?advWhy(adv):'the party'+(a.party.mem?' of '+a.party.mem.length:''));break}}
  if(adv&&!(agent&&a.state==='town'))return advP(a,adv);
  if(a.state==='town'){
    const L=a.party&&a.party.leader!==a&&alive(a.party.leader)?a.party.leader:null;
    if(agent){if(L)return make({kind:'wait',goal:'Waiting for '+L.name+' in '+c.name,why:a.playActAt!=null?mins(S.gameMin-a.playActAt)+' · until '+L.name+' sets out':'until '+L.name+' sets out',wait:{id:L.id,name:L.name,x:L.x,y:L.y,min:a.playActAt!=null?S.gameMin-a.playActAt:null}});
      return null}
    if(a.townStep===0)return make({kind:'town',goal:'Selling loot',target:c.name+' auction house',why:'between hunts',to:{x:c.ah.x,y:c.ah.y,label:'auction house',mark:'town'}});
    if(a.townStep===1)return make({kind:'town',goal:'Checking the quest board',target:c.name,why:'looking for work',to:c.qg?{x:c.qg.x,y:c.qg.y,label:'quest giver',mark:'person'}:null});
    const z=a.party?a.party.zone:a.zone;return make({kind:'travel',goal:'Setting out',target:ZONES[z]||'',why:a.party&&a.party.leader!==a?'with '+a.party.leader.name:lvlWhy(a),to:{x:c.gate.x,y:c.gate.y,label:'the gate',mark:'town'}})}
  if(a.state==='travel'){if(agent&&!a.dest)return null;const d=a.dest;return make({kind:'travel',goal:'Travelling',target:ZONES[a.zone]||(d?zn(d):''),why:bounty(a)||lvlWhy(a),to:d?{x:d.x,y:d.y,label:ZONES[a.zone]||zn(d),mark:'place'}:null})}
  if(a.state==='hunt'){if(agent)return make({kind:'wait',goal:'Standing watch in '+zn(a),why:a.playActAt!=null?'no order for '+mins(S.gameMin-a.playActAt):'for its agent'});
    return make({kind:'hunt',goal:'Hunting'+(a.quest&&MOBS[a.quest.type]?' '+MOBS[a.quest.type].pl:''),target:zn(a),why:bounty(a)||lvlWhy(a)})}
  return null}

// The purpose of a hero (any hero, any mind). Never throws on a half-built hero: the UI calls it every tick.
export function purposeOf(a){if(!a)return make({kind:'town',goal:''});
  try{let p=a.state==='dead'||a.state==='ghost'?scriptedPurpose(a,false):a.player?agentPurpose(a):scriptedPurpose(a,false)||make({kind:'town',goal:a.state?a.state[0].toUpperCase()+a.state.slice(1):''});
    const I=a.player&&a.intent&&!a.intent.done?a.intent:null; // a stated intent (#535, sim/intent.js: {goal, why, order, done}): the agent's own words win the why
    if(I&&a.state!=='dead'){const t=typeof I==='string'?I:I.text||(I.goal?I.goal+(I.why?' ('+I.why+')':''):I.why)||'';if(t){p.why='says: '+String(t).slice(0,140);p.line=p.goal+(p.target?' → '+p.target:'')+' · '+p.why}
      const at=typeof I==='object'?I.at||(I.order&&I.order.kind==='move'?I.order.to:null):null,lab=I.target||(I.order&&I.order.label)||'';
      if(at&&!p.to&&at.x!=null){p.to={x:at.x,y:at.y,label:lab,mark:'place'};p.path=[pt(at)]}}
    const sk=I&&a.state!=='dead'?lookingFor(a):null;if(sk){p.goal='Looking for';p.target=sk.name;p.kind=p.kind==='wait'?'travel':p.kind;p.line=p.goal+' '+p.target+(p.why?' · '+p.why:'')} // the aim seeks a hero (#570)
    return p}
  catch(e){return make({kind:'town',goal:a.state||''})}}
// The small icon over a hero's head: the purpose's kind, grouped into the seven the View toggle shows.
export const ICON_OF={hunt:'hunt',job:'job',wait:'wait',follow:'follow',rest:'rest',home:'home',flee:'flee',fight:'fight',travel:'travel',delve:'job',raid:'fight',town:null,ghost:'home',dead:null};
