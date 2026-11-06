// Hero biographies (issue #16). biography(hero, agents) is a pure function: it reads a hero
// and returns an array of paragraphs, each an array of parts in the chronicle convention
// (strings, heroes, {t, c} spans), so the panel can keep every name clickable. No DOM here.
// Voice: the Chronicler, third person, dry and grounded (docs/LORE.md, "The Chronicler").
// Facts come from the hero's own data (origin, traits, goal, bonds, nemesis, history). The
// history list is capped at 40 lines, so the prose leans on the lasting counters first
// (kills, honor, eliteKills, epics, deaths) and uses history for what it can still show.
import {loreSides} from '../sim/state.js'; // sides as lore (#1025)
import {WORDS} from '../world/words.js';
import {FAC} from '../data/factions.js';
import {raceOf} from '../data/races.js';

const lc=t=>t?t.charAt(0).toLowerCase()+t.slice(1):'';
const an=w=>/^[aeiou]/i.test(w)?'an':'a';
const plural=(n,one,many)=>n+' '+(n===1?one:many||one+'s');
const gold=t=>({t,c:'gd'});
const alive=x=>x&&x.state!=='dead';
// "a, b and c" over parts; the result is a flat array of parts and joiners.
const list=items=>{const out=[];items.forEach((x,i)=>{if(i>0)out.push(i===items.length-1?' and ':', ');out.push(x)});return out};
// Merge adjacent strings, drop empties.
const flat=ps=>{const out=[];for(const p of ps){if(p==null||p==='')continue;
  if(typeof p==='string'&&typeof out[out.length-1]==='string')out[out.length-1]+=p;else out.push(p)}return out};

// Count history lines by what they say. Only what the capped list still holds.
function digest(a){const d={elites:[],crypt:0,wipes:0,duels:0,avenged:0,fellFoes:0,lostFriends:0,boss:false,mustered:0};
  for(const h of a.history||[]){const t=h.text||'';let m;
    if(/^Slew Kragmaw/.test(t))d.boss=true;
    else if((m=/^Slew (.+?), .+ in /.exec(t)))d.elites.push(m[1]);
    else if(/^Cleared /.test(t))d.crypt++;
    else if(/^The group wiped/.test(t))d.wipes++;
    else if(/^Dueled /.test(t))d.duels++;
    else if(/^Avenged .* by slaying|^Paid the blood debt/.test(t))d.avenged++;
    else if(/^Killed /.test(t))d.fellFoes++;
    else if(/^Lost a /.test(t))d.lostFriends++;
    else if(/^Mustered /.test(t))d.mustered++}
  return d}

// agents: S.agents (to resolve friends and nemeses by id).
export function biography(a,agents=[]){
  const fac=FAC[a.fac],race=raceOf(a),cls=a.cls.toLowerCase(),dead=a.state==='dead';
  const byId=id=>agents.find(x=>x.id==id);
  const d=digest(a),paras=[],tr=(a.traits||[]).map(lc);

  // 1. Where they came from.
  paras.push([a.origin||(a.home?`${a.name} came up from ${a.home}.`:`${a.name} arrived at the gate with a name and little else.`)]);

  // 2. Who they are: character, people, trade, banner.
  const kind=(tr.length?tr.join(', ')+' ':'')+race.name+' '+cls;
  const p2=[`${a.name} is ${an(kind)} ${kind} of the `,{t:fac.name,c:'f'+a.fac}];
  if(a.guild&&a.guild.name)p2.push(', sworn to ',{t:'<'+(a.guild.tag||'')+'> '+a.guild.name,c:'f'+a.fac});
  p2.push('.');
  if(a.lvl>=15)p2.push(' By any measure of the roll, a veteran.');
  paras.push(p2);

  // 3. Deeds: level, kills, elites, epics, crypt, raids.
  const tally=[];
  if(a.kills)tally.push(plural(a.kills,'kill'));
  if(a.honor&&!loreSides())tally.push(plural(a.honor,'point')+' of honor');
  const p3=[(dead?`${a.name} reached level ${a.lvl}`:`${a.name} stands at level ${a.lvl}`)+(tally.length?', with '+tally.join(' and ')+' to show for it':'')+'.'];
  if(a.eliteKills){
    if(d.elites.length===a.eliteKills&&a.eliteKills<=2)p3.push(' They slew ',...list(d.elites.map(gold)),'.');
    else p3.push(` They have slain ${plural(a.eliteKills,'named elite')}.`)}
  const ep=a.epics||[];
  if(ep.length)p3.push(' Their bag holds ',...list(ep.slice(0,3).map(n=>({t:'['+n+']',c:'ep'}))),ep.length>3?` and ${ep.length-3} more.`:'.');
  if(d.crypt)p3.push(' They helped clear ',gold(WORDS.crypt),d.crypt>1?` ${d.crypt} times.`:'.');
  if(d.wipes)p3.push(' They walked out of one wipe in the dark.');
  if(d.boss)p3.push(' They were there when ',gold('Kragmaw'),' fell.');
  else if(d.mustered)p3.push(' They have mustered against ',gold('Kragmaw'),'.');
  paras.push(p3);

  // 4. Blood: duels, debts paid.
  if(d.duels||d.avenged||d.fellFoes){const p=[];
    if(d.duels)p.push(plural(d.duels,'duel'));
    if(d.avenged)p.push(d.avenged>1?`${d.avenged} blood debts paid`:'a blood debt paid');
    else if(d.fellFoes)p.push(plural(d.fellFoes,'enemy hero')+' laid low');
    paras.push(['The record shows '+p.join(' and ')+'. The Chronicler notes that none of it was asked for.']);}

  // 5. Oath.
  const g=a.goal;
  if(g&&g.text&&!g.offered){const oath=lc(g.text.replace(/\.$/,''));
    paras.push(dead?[`The oath on the books at the end: ${oath}. It stays unkept.`]
      :[`${a.name} has sworn to ${oath}.`+(g.tier>=1?' It is not their first oath.':'')])}

  // 6. Company: friends and nemeses, by clickable name.
  const friends=Object.keys(a.bonds||{}).map(byId).filter(x=>x&&x!==a&&a.bonds[x.id]>=6).sort((x,y)=>a.bonds[y.id]-a.bonds[x.id]).slice(0,3);
  const foes=Object.keys(a.nemesis||{}).map(byId).filter(x=>x&&x!==a).slice(0,3);
  const co=[];
  if(friends.length)co.push(a.name+' counts ',...list(friends),friends.length>1?' as friends.':' a friend.');
  if(foes.length)co.push(co.length?' ':'',foes.length>1?'Their grudges run to ':'Their grudge runs against ',...list(foes),
    foes.some(alive)&&!dead?', and the Chronicler would not wager on the peace.':'.');
  else if(d.lostFriends)co.push(co.length?' ':'','They have buried a friend and said little about it.');
  if(co.length)paras.push(co);

  // 7. The end.
  if(dead){const end=[`${a.name} fell at ${a.diedAt||'an unrecorded hour'}, at level ${a.lvl}: ${a.cause||'cause unrecorded'}.`];
    if(a.lvl>=15)end.push(' The roll holds fewer names of this weight.');
    else if(a.lvl<=3)end.push(' It was early, and the ground was unkind.');
    end.push(' Every hero keeps one life, and this was theirs.');
    paras.push(end)}
  return paras.map(flat)}
