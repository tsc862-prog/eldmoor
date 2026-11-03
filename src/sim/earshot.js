// Earshot (issue #395, owner request): who the hero can reach with its voice right now, before it speaks.
//   earshot(a)      the tool's answer: who would hear say (heroes and townsfolk within HEAR), who would hear a party
//                   shout (companions within shoutRange, with today's range and why it is shorter), who is close
//                   enough to talk to (townsfolk within EAR.TALK), and the companions out of shouting range (names
//                   only, with the courier hint).
//   earshotLine(a)  the same in one short line for the turn state header (sim/pace.js brief.earshot); null when
//                   nobody is near.
// It reads the same helpers the speaking paths use (sayHearers in chat.js, shoutHearers in council.js, shoutRange in
// reach.js), so the answer always matches who actually hears. Only what the hero perceives (in-game channels, #123):
// names, class or role and distance of those near; a companion out of range is a name, never a place, HP or mind.
// Reads only, no dice: the scripted world is unchanged.
import {S} from './state.js';
import {CITY,dist,zoneAt} from '../world/map.js';
import {HEAR,sayHearers} from './chat.js';
import {shoutHearers} from './council.js';
import {shoutRange,REACH} from './reach.js';
import {weatherName,weatherKind} from './weather.js';
import {sightLever} from './levers.js';
import {ensureNpcs} from './npcs.js';
import {inSlots} from './company.js';
import {ASIDE,whisperLine} from './aside.js'; // whisper reach (#627) // the slotted company (#588)

export const EAR={TALK:4,LINE_MAX:4}; // TALK: tiles to a townsperson for talk (keep equal to player.js PK.TALK; not imported there: an import cycle through fellowship.js)

const inRect=(c,p,pad=0)=>p.x>=c.x0-pad&&p.x<=c.x1+1+pad&&p.y>=c.y0-pad&&p.y<=c.y1+1+pad;
const cityAt=p=>CITY.find(c=>inRect(c,p,.5))||null; // as the talk tool finds the town it stands in (player.js)
const r1=v=>Math.round(v*10)/10,tiles=d=>{const v=r1(d);return v+(v===1?' tile':' tiles')};
const full=p=>(p.title?p.title+' ':'')+p.name;
const people=()=>{ensureNpcs();return [...(S.npcs||[]),...(S.wanderers||[])].filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))};
const byDist=a=>(x,y)=>dist(a,x)-dist(a,y)||(x.id||0)-(y.id||0);

// Townsfolk within r. A Fellowship member can talk to anyone placed in the world (sim/talk.js findPerson); any other
// hero only to the townsfolk of the town it stands in (the talk tool's own lookup).
function folkWithin(a,r,talkable){const here=talkable&&!inSlots(a)?cityAt(a):null;
  const L=talkable&&!inSlots(a)?(S.npcs||[]).filter(p=>Number.isFinite(p.x)&&(!here||p.town===here.name)):people();
  return L.filter(p=>dist(a,p)<=r).sort(byDist(a))}

// Why today's shout is shorter than REACH.SHOUT, in words ('' when it is not).
function shoutWhy(a,range){if(range>=REACH.SHOUT)return '';const z=zoneAt(a.x,a.y),k=weatherKind(z),bits=[];
  if(k!=='clear'&&k!=='drizzle')bits.push(weatherName(z).toLowerCase()+' swallows your voice');
  if(sightLever(z)<1)bits.push('the land lies fog-bound');
  return bits.join(' and ')||'the weather closes in'}

export function earshot(a){
  if(!a||a.state==='dead')return {ok:false,error:'The dead hear nothing.'};
  if(a.state==='ghost')return {ok:true,ghost:true,text:'You are a ghost: nobody hears you.'};
  const sayH=sayHearers(a).sort(byDist(a)),sayF=folkWithin(a,HEAR,false),talk=folkWithin(a,EAR.TALK,true);
  const say=[...sayH.map(b=>({name:b.name,who:b.cls+(inSlots(b)&&inSlots(a)?', companion':b.fac!==a.fac?', of the other side':''),tiles:tiles(dist(a,b))})),
    ...sayF.map(p=>({name:full(p),who:p.role||'townsperson',tiles:tiles(dist(a,p))}))];
  const range=shoutRange(a),why=shoutWhy(a,range),{mates,near,far}=shoutHearers(a);
  const shout=mates.length?{range,usual:REACH.SHOUT,...(why?{shorter:why}:{}),
    hear:near.sort(byDist(a)).map(b=>b.name+' ('+b.cls+')'),out_of_range:far.map(b=>b.name)}:null;
  const r={ok:true,
    say:say.length?say.map(x=>x.name+' ('+x.who+', '+x.tiles+')'):[],
    say_range:HEAR,
    shout,
    talk:talk.map(p=>full(p)+' ('+(p.role||'townsperson')+', '+tiles(dist(a,p))+')'),
    talk_range:EAR.TALK,
    whisper:whisperLine(a),whisper_range:ASIDE.WHISPER};
  const lines=[];
  lines.push(say.length?'say (within '+HEAR+' tiles) reaches: '+r.say.join(', ')+'.':'Nobody is within '+HEAR+' tiles to hear you say anything.');
  if(shout){lines.push('A party shout carries '+range+' tiles today'+(why?' (usually '+REACH.SHOUT+'; '+why+')':'')+': '+
    (shout.hear.length?shout.hear.join(', ')+' would hear it':'no companion would hear it')+'.');
    if(far.length)lines.push('Out of shouting range: '+far.map(b=>b.name).join(', ')+'. Walk closer, or hire a courier at a town gate (send_courier)'+(inSlots(a)?'':' (Fellowship only)')+'.')}
  else lines.push('You have no party to shout to.');
  lines.push(talk.length?'Close enough to talk to (within '+EAR.TALK+' tiles): '+talk.map(full).join(', ')+'.':'Nobody is close enough to talk to (within '+EAR.TALK+' tiles).');
  if(r.whisper.length)lines.push('Close enough to whisper to (within '+ASIDE.WHISPER+' tiles): '+r.whisper.join(', ')+'.');
  r.text=lines.join(' ');return r}

// One short line for the state header: who hears a say, which companions a shout reaches, who to talk to, who is
// out of range. null when nobody is near (nobody hears a say or a shout, nobody to talk to).
export function earshotLine(a){if(!a||a.state==='dead'||a.state==='ghost')return null;
  const cut=L=>L.length>EAR.LINE_MAX?L.slice(0,EAR.LINE_MAX).join(', ')+' and '+(L.length-EAR.LINE_MAX)+' more':L.join(', ');
  const sayH=sayHearers(a).sort(byDist(a)).map(b=>b.name),folk=folkWithin(a,HEAR,false).length; // townsfolk as a count: talk names the close ones
  const talk=folkWithin(a,EAR.TALK,true).map(full),{mates,near,far}=shoutHearers(a);
  if(!sayH.length&&!folk&&!near.length&&!talk.length)return null;
  const bits=[];if(sayH.length||folk)bits.push('say reaches '+[sayH.length?cut(sayH):'',folk?folk+(folk>1?' townsfolk':' townsperson'):''].filter(Boolean).join(' and '));
  if(mates.length)bits.push('a shout ('+shoutRange(a)+' tiles) reaches '+(near.length?cut(near.sort(byDist(a)).map(b=>b.name)):'no companion'));
  if(talk.length)bits.push('talk to '+cut(talk));
  if(far.length)bits.push('too far for a shout: '+cut(far.map(b=>b.name))+(inSlots(a)?' (send_courier)':''));
  return bits.join('; ')}
