// Persona sheets and backstories for Fellowship members (issue #68). Owned by brain-builder.
// DOM-free and RNG-free: every pick is a hash of the hero id, so building a sheet never moves
// the world's random stream.
//
// buildPersona(a, mates)  facts from the sim (people, home hamlet and town, class, role, top
//                         scores and trained skills, origin and trade, traits, oath, notable
//                         history, bonds, nemesis) plus a scripted voice, wants, fears, quirk,
//                         a line they would never say and a stance toward each companion.
// buildBackstory(a, mates) six short paragraphs (family and home, how they came to arms, a
//                         defining event tied to the living world, a flaw or secret, wants and
//                         fears, why they joined) and one explicit link to a companion.
// Both are plain data stored on the hero (a.persona, a.backstory) and saved with the world:
//   a.persona   = {src:'scripted'|'model', edited, at, model?, facts:{...}, voice, wants, fears, quirk, never_says, stances:{id:line}}
//   a.backstory = {src, edited, at, model?, paras:{family,arms,defining,flaw,wants,joined,link}, summary, link:{id,name,kind}}
// The relay snapshots (personaSnapshot, backstorySnapshot) carry only what the hero could
// know; the answers are validated by applyPersona / applyBackstory before they replace the
// scripted text, and never over a sheet the user has edited.
// fellowCard(a) is the compact block every brain prompt and the agent's status get.
import {hash} from '../core/rng.js';
import {ZONES,LANDMARKS,zoneFor} from '../world/map.js';
import {CLS} from '../data/classes.js';
import {FAC} from '../data/factions.js';
import {raceOf,homeOf} from '../data/races.js';
import {TRAITS} from '../data/traits.js';
import {ELITES} from '../data/mobs.js';
import {TRADES} from '../data/origins.js';
import {cleanText,PERSONA_FIELDS,STANCE_MAX,BACKSTORY_FIELDS,LINK_KINDS} from '../data/prompts.js';
import {S} from './state.js';
import {bond,FRIEND,CLOSE} from './bonds.js';
import {topScores,SKILLS} from './abilities.js';
import {ARCHETYPES} from '../data/archetypes.js';

const pick=(a,salt,list)=>list[Math.floor(hash(a.id|0,salt,7)*list.length)%list.length];
const lc=t=>t?t.charAt(0).toLowerCase()+t.slice(1):'';
const alive=x=>x&&x.state!=='dead';
const byId=id=>S.agents.find(x=>x.id==id);
const W=f=>f===1; // Warband voice
export const ROLE_NAME={tank:'Tank',healer:'Healer',dps:'Damage'};
const roleOf=a=>a.fellowRole?String(a.fellowRole).replace(/\d+$/,''):a.cls==='Warrior'?'tank':(CLS[a.cls]&&CLS[a.cls].heal)?'healer':'dps';
const tradeOf=a=>a.trade||pick(a,11,TRADES[a.fac]||TRADES[0]);
const nemesisOf=a=>Object.keys(a.nemesis||{}).map(byId).filter(alive);
const goalTarget=a=>a.goal&&a.goal.target?a.goal.target:null;

// ---- facts: what the sim knows about this hero, compact ----
const NOTABLE=/^(Reached level (5|10|15|20)|Slew |Looted |Paid the blood debt|Avenged |Killed |Lost a |Now counts |Became friends|Saw through |Failed at |Cleared |Completed )/;
export function factsOf(a){const r=raceOf(a),c=homeOf(a);
  return {people:r.name,culture:r.culture,home:a.home||null,town:c.name,cls:a.cls,role:ROLE_NAME[roleOf(a)],lvl:a.lvl,
    scores:topScores(a,3).join(', '),skills:(a.prof||[]).map(k=>SKILLS[k]?SKILLS[k].name:k).join(', '),
    origin:a.origin||null,trade:tradeOf(a),traits:(a.traits||[]).map(t=>t+(TRAITS[t]?': '+TRAITS[t].desc:'')),
    oath:a.goal?a.goal.text+(a.goal.done?' (kept)':''):null,
    history:(a.history||[]).filter(h=>NOTABLE.test(h.text||'')).slice(-6).map(h=>h.text),
    nemesis:nemesisOf(a).slice(0,3).map(x=>x.name),
    kills:a.kills||0,eliteKills:a.eliteKills||0,honor:a.honor||0}}

// ---- scripted persona text ----
const VOICES=[
  ['Measured and dry; speaks in short, complete sentences and never raises their voice.','Precise to a fault; corrects small errors and lets large ones pass in silence.','Polite in the way a closed door is polite; warms only to people who have bled beside them.','Quiet, wry, fond of the word "regrettably".'],
  ['Blunt as a dropped axe; three words where others use ten.','Loud, cheerful and filthy; laughs at the worst moments.','Growls more than speaks; every sentence sounds like a dare.','Few words, all of them final.']];
const TRAIT_VOICE={Reckless:'Talks fast and finishes plans with "and then we hit it".',Cautious:'Thinks aloud about exits.',Greedy:'Prices everything, including compliments.',
  Loyal:'Says "we" far more than "I".',Loner:'Answers questions with shrugs until pressed.',Vengeful:'Remembers names, and says them slowly.',Pious:'Ends hard days with a short prayer.',Boastful:'Retells every fight a little bigger.'};
const WANTS={avenge:'To see {t} dead by their own hand.',avengeHero:'To settle the blood debt with {t}.',heirloom:'To hold the {t} and carry it home.',heirloomCrypt:'To bring the {t} up out of the Sunken Crypt.',
  heirloomBoss:'To tear the {t} from Kragmaw.',pilgrimFar:'To stand in the snows of Hoarfell before they die.',pilgrimCrypt:'To stand at the mouth of the Sunken Crypt and see what waits below.',
  ascend:'To grow strong enough that nobody has to bury them young.',rival:'To leave {t} behind and make sure they know it.',legend:'To be in the raid that finally kills Kragmaw.',
  hoard:'Enough gold that hunger never comes back.',delve:'To clear the Sunken Crypt and come out alive.'};
const FEARS={Warrior:['Being the wall that breaks first.','Living through the fight that kills the people behind them.'],Priest:['Running out of light with a friend still bleeding.','Choosing whom to heal, and choosing wrong.'],
  Mage:['The day the spell does not come.','Being caught in the open with nothing between them and the teeth.'],Hunter:['A trail that leads back to their own camp.','Missing the one shot that mattered.'],
  Rogue:['Being seen before they are ready.','Being trusted, and failing it.'],
  Skald:['The song that does not carry in the dark.','Being the last voice a friend hears, and the wrong one.'],
  Wildspeaker:['A grove burned for a road, and no one left who remembers its name.','Mending a friend only to send them back to the same wound.']};
const QUIRKS={Warrior:['Taps their shield twice before every fight.','Sharpens a blade that is already sharp.','Counts the party at every halt, out loud.'],
  Priest:['Keeps a pebble from every grave they have stood at.','Hums the same four bars when worried.','Thanks the food, the fire and the boots, in that order.'],
  Mage:['Writes the weather in a little book each morning.','Warms their hands on spent sparks.','Talks to their staff when nobody answers.'],
  Hunter:['Never sits with their back to open ground.','Names every animal they kill, after.','Chews a grass stem on the march.'],
  Rogue:['Flips a coin across their knuckles.','Always knows where the door is.','Pockets small things and returns them later, cleaned.'],
  Skald:['Hums the key of the next fight under their breath.','Gives every blade in the party a name and a verse.','Taps the rhythm of the march on whatever is nearest.'],
  Wildspeaker:['Carries a seed in each pocket and plants one at every grave.','Asks pardon of the ground before every camp.','Reads the weather from the moss on the north side of anything.']};
const NEVER=[['I am afraid.','Let them have it; it does not matter.','Run, and leave them.','Gold is gold, whoever paid in blood.'],
  ['I am sorry.','Let us talk this out.','Leave them; they are weak.','The pits were nothing.']];
const TRAIT_NEVER={Cautious:'Charge! No plan needed.',Reckless:'Perhaps we should wait.',Loyal:'Every one for themselves.',Greedy:'Keep it, I need nothing.',Pious:'There is nothing after this.',Vengeful:'All is forgiven.',Boastful:'It was mostly luck.',Loner:'I could not do this alone.'};

// How a hero sees a companion from what the sim knows: bonds, shared hamlet, nemesis, backstory link.
export function scriptedStance(a,b){const s=bond(a,b),same=a.home&&a.home===b.home,lk=a.backstory&&a.backstory.link&&a.backstory.link.id==b.id?a.backstory.link.kind:null;
  const base=s>=CLOSE?'Would die for '+b.name+', and knows '+b.name+' would do the same.':s>=FRIEND?'Trusts '+b.name+' at their back.':s>0?'Still taking the measure of '+b.name+'.':'A stranger in the same colours; '+b.name+' has yet to earn anything.';
  const tag=lk==='rivalry'?' An old rivalry still itches.':lk==='debt'?' There is a debt between them.':lk==='rescue'?' One of them owes the other a life.':lk==='kin'?' Blood ties them.':lk==='oath'?' They swore the same oath.':same?' They grew up in the same hamlet.':'';
  return (base+tag).slice(0,STANCE_MAX)}

export function buildPersona(a,mates=[]){const f=a.fac===1?1:0,g=a.goal,t=goalTarget(a)||'';
  const vt=(a.traits||[]).map(x=>TRAIT_VOICE[x]).filter(Boolean)[0];
  const neverT=(a.traits||[]).map(x=>TRAIT_NEVER[x]).filter(Boolean)[0];
  const stances={};for(const b of mates)if(b&&b!==a)stances[b.id]=scriptedStance(a,b);
  return {src:'scripted',edited:false,at:S.gameMin,facts:factsOf(a),
    voice:pick(a,1,VOICES[f])+(vt?' '+vt:''),
    wants:g&&WANTS[g.type]?WANTS[g.type].replace('{t}',t):'To come home with more than they left with.',
    fears:pick(a,2,FEARS[a.cls]||FEARS.Warrior),
    quirk:pick(a,3,QUIRKS[a.cls]||QUIRKS.Warrior),
    never_says:neverT||pick(a,4,NEVER[f]),stances}}

// ---- backstory ----
// One defining event tied to the living world: the hero's own sworn elite, else an elite of their
// band; a living rival (nemesis, else a strong living enemy hero); a real place.
function worldTies(a){
  const sworn=(a.goal&&a.goal.type==='avenge'?ELITES.find(e=>e.name===a.goal.target):null)||ELITES.find(e=>a.origin&&a.origin.includes(e.name)); // the elite their own story already names
  const band=ELITES.slice().sort((x,y)=>Math.abs(x.lvl-a.lvl-4)-Math.abs(y.lvl-a.lvl-4))[0];
  const E=sworn||band;
  const nem=nemesisOf(a)[0];
  const rival=nem||S.agents.filter(b=>alive(b)&&b.fac!==a.fac).sort((x,y)=>Math.abs(x.lvl-a.lvl)-Math.abs(y.lvl-a.lvl)||x.id-y.id)[0]||null;
  const z=zoneFor(Math.max(1,a.lvl),homeOf(a).gate),place=pick(a,9,[ZONES[z]||ZONES[0],...LANDMARKS.map(l=>l.name)]);
  return {elite:E?{name:E.name,title:E.title}:null,rival:rival?{name:rival.name,cls:rival.cls,fac:FAC[rival.fac].name,nemesis:!!nem}:null,place}}

// Pick the companion this hero is tied to and how. Shared hamlet first, then the strongest
// bond, then a shared nemesis, then a rival of close level; a pair tied one way is reused so
// the five end up in a web rather than five unrelated stories.
export function pickLink(a,mates){const ms=mates.filter(b=>b&&b!==a);if(!ms.length)return null;
  const back=ms.find(b=>b.backstory&&b.backstory.link&&b.backstory.link.id==a.id);if(back)return {id:back.id,name:back.name,kind:back.backstory.link.kind};
  const home=ms.find(b=>a.home&&b.home===a.home);if(home)return {id:home.id,name:home.name,kind:'hometown'};
  const bonded=ms.slice().sort((x,y)=>bond(a,y)-bond(a,x))[0];if(bond(a,bonded)>=FRIEND)return {id:bonded.id,name:bonded.name,kind:bond(a,bonded)>=CLOSE?'rescue':'debt'};
  const shared=ms.find(b=>Object.keys(a.nemesis||{}).some(id=>b.nemesis&&b.nemesis[id]));if(shared)return {id:shared.id,name:shared.name,kind:'oath'};
  const near=ms.slice().sort((x,y)=>Math.abs(x.lvl-a.lvl)-Math.abs(y.lvl-a.lvl)||x.id-y.id)[0];
  return {id:near.id,name:near.name,kind:near.cls===a.cls?'rivalry':pick(a,13,['debt','rivalry','rescue'])}}

const ARMS={
  Warrior:['took a shield from the {town} yard and learned to stand where the blows land','was put in the line at fourteen, because someone had to be'],
  Priest:['was taught the healing words by a tired chaplain in {town}','found the light on a night when a {trade} lay dying and nobody else knelt'],
  Mage:['taught themself the first spark from a borrowed book, and burned the book by accident','was apprenticed to a hedge-caster who died owing them a year of lessons'],
  Hunter:['learned the bow on the {trade} rounds, shooting what came for the stock','followed tracks out of {home} at twelve and never quite came back'],
  Rogue:['learned the knife collecting debts for a {trade} who was owed too much','got very good at not being seen, because being seen was expensive'],
  Wildspeaker:['learned the green words from the widow of a {trade} who kept the only garden in {town} through a bad winter','walked out of {home} after a blight, to learn why the hedgerows still sang'],
  Skald:['learned the first ballads from a {trade} who paid in songs, and found the songs paid better','sang the {town} market awake every morning until someone offered coin for silence, then for more singing']};
const FLAW={Reckless:'charges first and counts the cost after, and the cost has been rising',Cautious:'has left a friend behind once to save their own skin, and has not told anyone',
  Greedy:'keeps a purse nobody knows about and lies about it with a straight face',Loyal:'would follow a friend into a fire they started themselves',
  Loner:'trusts nobody fully and makes sure nobody notices',Vengeful:'keeps a list, and one name on it is a name they should not hate',
  Pious:'is no longer sure anyone is listening to the prayers',Boastful:'has told the story of their first kill so often that they no longer remember what really happened'};
const FAMILY=[
  ['{name} grew up in {home}, a hamlet of the {people} near {town}, the {child} of a {trade}. The family kept its accounts straight and its grudges straighter.','{name} is {people} from {home}, near {town}, raised in a {trade}’s house that smelled of work and smoke. Nobody there expected them to leave.'],
  ['{name} was whelped in {home} among the {people}, the {child} of a {trade}, and learned early that food goes to whoever reaches it first.','{name} is {people} out of {home}, near {town}, where the {trade} work is hard and the winters harder. The camp still owes them, or they still owe it.']];
const LINK={
  hometown:'{name} and {other} grew up in the same {home}; {other} remembers {name} before the armour, and {name} has never quite forgiven that.',
  debt:'{name} owes {other} a debt from a bad night on the road, and means to pay it in blood or gold, whichever comes first.',
  rescue:'{other} once dragged {name} out of a fight that should have ended them; neither of them talks about it, and both remember.',
  rivalry:'{name} and {other} have been measuring themselves against each other since their first quest; it has made both of them better and neither of them kinder.',
  kin:'{name} and {other} share a grandmother and very little else.',
  oath:'{name} and {other} swore the same oath over the same grave, and the Fellowship is how they mean to keep it.'};
const fill=(t,v)=>t.replace(/\{(\w+)\}/g,(m,k)=>v[k]!=null?String(v[k]):m);

export function buildBackstory(a,mates=[],fname='the Fellowship'){const f=a.fac===1?1:0,r=raceOf(a),c=homeOf(a),T=worldTies(a);
  const v={name:a.name,home:a.home||c.name,people:r.plural||r.name,town:c.name,trade:tradeOf(a),child:((a.origin||'').match(/\b(son|daughter)\b/)||[])[1]||pick(a,5,['eldest','youngest'])}; // never contradict the origin line
  const family=fill(pick(a,6,FAMILY[f]),v)+(a.origin?' '+a.origin:'');
  const arms=a.name+' '+fill(pick(a,7,ARMS[a.cls]||ARMS.Warrior),v)+'. Now a '+a.cls.toLowerCase()+' of the '+FAC[a.fac].name+', level '+a.lvl+'.';
  let defining;
  if(T.rival&&T.rival.nemesis)defining=a.name+' has a name that will not leave them alone: '+T.rival.name+', a '+T.rival.cls.toLowerCase()+' of the '+T.rival.fac+', who took someone from them'+(T.place?' near '+T.place:'')+'.';
  else if(T.elite)defining='The year '+T.elite.name+', '+T.elite.title+', came down on '+v.home+', '+a.name+' was the one who went looking'+(T.place?' as far as '+T.place:'')+' and came back with nothing but the tracks. '+(T.rival?'Later, '+T.rival.name+' of the '+T.rival.fac+' laughed at them over a kill they had both wanted.':'');
  else defining=a.name+' lost a good friend'+(T.place?' in '+T.place:'')+' and still walks that road the long way round.';
  const tr=(a.traits||[]).find(t=>FLAW[t]);
  const flaw=a.name+' '+(tr?FLAW[tr]:'keeps a secret about the night they left home, and it is not a flattering one')+'.';
  const p=buildPersona(a,[]);
  const wants=a.name+' wants '+lc(p.wants).replace(/\.$/,'')+'. What keeps them awake is '+lc(p.fears).replace(/\.$/,'')+'.';
  const role=ROLE_NAME[roleOf(a)];
  const joined=a.name+' joined '+fname+' as its '+(role==='Damage'?'blade':lc(role))+' because '+(a.goal&&!a.goal.done?'one sword alone will not '+lc(a.goal.text):'the roads are getting worse and five live longer than one')+'.';
  const link=pickLink(a,mates),ltext=link?fill(LINK[link.kind]||LINK.debt,{name:a.name,other:link.name,home:v.home===(byId(link.id)||{}).home?v.home:'quarter of '+c.name}):'';
  const summary=(a.originShort?a.name+', '+a.originShort+', ':a.name+', a '+r.name+' '+a.cls.toLowerCase()+', ')+'who wants '+lc(p.wants).replace(/\.$/,'')+'.';
  return {src:'scripted',edited:false,at:S.gameMin,paras:{family,arms,defining,flaw,wants,joined,link:ltext},summary:summary.slice(0,BACKSTORY_FIELDS.summary),link,world:T}}

export const BACKSTORY_ORDER=[['family','Family and home'],['arms','To arms'],['defining','The defining day'],['flaw','Flaw or secret'],['wants','Wants and fears'],['joined','Why they joined'],['link','Ties']];
export const PERSONA_ORDER=[['voice','Voice'],['wants','Wants'],['fears','Fears'],['quirk','Quirk'],['never_says','Would never say']];

// ---- relay snapshots and validated application ----
const compOf=(b,a)=>({id:b.id,name:b.name,cls:b.cls,people:raceOf(b).name,home:b.home||null,trade:b.trade||null,lvl:b.lvl,bond:bond(a,b),
  role:ROLE_NAME[roleOf(b)],origin:b.origin?String(b.origin).slice(0,160):null}); // never a companion's sheet, persona or memories (issue #123)
export function personaSnapshot(a,mates,fname){const P=a.persona||buildPersona(a,mates);
  return {name:a.name,fac:FAC[a.fac].name,fellowship:fname,facts:factsOf(a),backstory:a.backstory?a.backstory.summary:null,
    link:a.backstory&&a.backstory.link?a.backstory.link:null,companions:mates.filter(b=>b!==a).map(b=>compOf(b,a)),
    scripted:{voice:P.voice,wants:P.wants,fears:P.fears}}}
export function backstorySnapshot(a,mates,fname){const s=buildBackstory(a,mates,fname);
  return {name:a.name,fac:FAC[a.fac].name,fellowship:fname,facts:factsOf(a),world:s.world,
    suggest_link:s.link?s.link.name+' ('+s.link.kind+')':null,companions:mates.filter(b=>b!==a).map(b=>compOf(b,a))}}
// The relay already validated; the sim checks again (it never trusts the wire) and keeps only known companions.
export function applyPersona(a,j,mates,model){if(!j||typeof j!=='object')return false;const out={};
  for(const k in PERSONA_FIELDS){const v=cleanText(j[k],PERSONA_FIELDS[k]);if(!v)return false;out[k]=v}
  const old=a.persona||buildPersona(a,mates),st={...old.stances};
  for(const b of mates){if(b===a)continue;const v=cleanText(j.stances&&j.stances[String(b.id)],STANCE_MAX);if(v)st[b.id]=v}
  a.persona={...old,...out,stances:st,src:'model',model:model||null,at:S.gameMin,edited:false};return true}
export function applyBackstory(a,j,mates,model){if(!j||typeof j!=='object')return false;const paras={};
  for(const k of ['family','arms','defining','flaw','wants','joined','link']){const v=cleanText(j[k],BACKSTORY_FIELDS[k]);if(!v)return false;paras[k]=v}
  const summary=cleanText(j.summary,BACKSTORY_FIELDS.summary);if(!summary)return false;
  const b=mates.find(x=>x!==a&&(x.id==j.link_id||x.name===j.link_hero));
  const old=a.backstory||{};
  a.backstory={src:'model',model:model||null,edited:false,at:S.gameMin,paras,summary,
    link:b?{id:b.id,name:b.name,kind:LINK_KINDS.includes(j.link_kind)?j.link_kind:'oath'}:old.link||null,world:old.world||null};return true}

// ---- archetypes (issue #295) ----
// Writes only persona text: voice, wants, fears, quirk, never_says, the default stance and the
// archetype id. Facts, class, bonds, oath, home and history are never touched. Stances: each current
// companion (mates, else the living Fellowship) whose stance is missing, scripted (an unedited scripted persona, or
// the scripted line as it reads now) or the previous archetype's line gets the template with {other} filled; a model-written or hand-written stance is
// kept. No RNG; a second apply replaces the first. Returns false for an unknown id.
export const archetypeStance=(id,b)=>{const A=ARCHETYPES[id];return A&&b?A.stance.replace(/\{other\}/g,b.name).slice(0,STANCE_MAX):''};
export function applyArchetype(a,id,mates){const A=ARCHETYPES[id];if(!a||!A)return false;
  const old=a.persona||buildPersona(a,[]),F=S.fellowship;
  if(!mates)mates=a.fellow&&F?F.ids.filter(x=>x!=a.id).map(byId).filter(alive):[];
  const st={...(old.stances||{})},filler=old.src!=='model'&&!old.edited; // an unedited scripted persona's stances are all scripted lines (their bond reading drifts)
  for(const b of mates){if(!b||b===a)continue;const cur=st[b.id];
    if(!cur||filler||cur===scriptedStance(a,b)||(old.archetype&&cur===archetypeStance(old.archetype,b)))st[b.id]=archetypeStance(id,b)}
  a.persona={...old,voice:A.voice,wants:A.wants,fears:A.fears,quirk:A.quirk,never_says:A.never_says,stance:A.stance,stances:st,archetype:id};return true}

// ---- the compact block prompts and the agent player get ----
export function fellowCard(a){if(!a||!a.fellow)return null;const F=S.fellowship,P=a.persona,M=a.memory;
  const comp=(F?F.ids:[]).filter(id=>id!==a.id).map(byId).filter(alive).map(b=>{const st=(M&&M.stances&&M.stances[b.id])||(P&&P.stances&&P.stances[b.id])||'';
    return b.name+' ('+(ROLE_NAME[roleOf(b)]||b.cls)+', '+b.cls+' L'+b.lvl+')'+(st?': '+st:'')});
  const c={fellowship:F?F.name:null,role:ROLE_NAME[roleOf(a)]};
  if(P){c.voice=P.voice;c.wants=P.wants;c.fears=P.fears;c.quirk=P.quirk;c.never_says=P.never_says}
  if(a.backstory)c.backstory=a.backstory.summary;
  if(M){if(M.long)c.memory_long=String(M.long).slice(0,500);const r=(M.recent||[]).slice(-5).map(e=>e.text);if(r.length)c.memory_recent=r}
  if(comp.length)c.companions=comp;
  return c}
