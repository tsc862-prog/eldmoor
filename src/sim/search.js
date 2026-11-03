// Search and examine (issue #525): how an agent hero interacts with the marked places, signs and landmarks it stands near.
//   searchAct(a, {what}, R)   the `search` tool: about SR.MIN game minutes. One Lore/Perception d20 (a hash of hero, spot and
//                             attempt, so no RNG is drawn: the seeded world is untouched) against the spot's difficulty.
//                             A success tells what the spot holds into the hero's lore (a marker's `reveal`, a landmark's
//                             sign, the tracks of creatures near) and hands over a `cache` the DM hid there (gold or an item,
//                             through the give_item path in levers.js); a failure says what it looked like and the spot is
//                             "searched" for SR.COOL game minutes. Nothing numeric reaches the hero (the roll goes to the DM log).
//   examineView(a, {what}, R) the `examine` tool, read only: a closer description of a marker, landmark or sign in sight.
// A marker's reveal and cache are set by the DM's mark_place (flat tool args `reveal`, `cache`), kept on the marker in S.places.
// Agent-played heroes only. Companions in earshot get a line ("Isaara searches the shrine"); the DM log gets the result.
import {S} from './state.js';
import {hash} from '../core/rng.js';
import {LANDMARKS,CRYPT,CITY,dist} from '../world/map.js';
import {bestFor} from './abilities.js';
import {nearMobs} from './spatial.js';
import {sayHearers} from './chat.js';
import {notify} from './notify.js';
import {record} from './history.js';
import {dmlog} from './dmlog.js';
import {foundItem} from './levers.js';
import {found as loreFound,hear as loreHear,sight as loreSight,foeName,learnPlace} from './lore.js';
import {noticesAt} from './sightings.js';

export const SR={
  MIN:20,       // game minutes a search takes
  COOL:360,     // game minutes a spot stays "searched" after a search
  REACH:6,      // tiles from a marker or landmark to search it (examine needs only sight)
  TRACK:10,     // tiles: creatures whose tracks a ground search can read
  GOLD_MAX:60,  // a cache of gold never holds more
  DC:{shrine:11,ruin:12,camp:10,cairn_door:14,watchtower:12,crypt:8,lair:12,ground:11},
};
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const strHash=s=>{let h=0;for(let i=0;i<s.length;i++)h=(Math.imul(h,31)+s.charCodeAt(i))|0;return h};
const norm=s=>String(s==null?'':s).toLowerCase().replace(/_/g,' ').replace(/^(the|a|an)\s+/,'').replace(/[^a-z0-9' ]+/g,' ').replace(/\s+/g,' ').trim();
const KIND_TEXT={shrine:'a small shrine of fieldstone, its offering bowl worn smooth',ruin:'a roofless ruin, its walls tumbled and grown over',
  camp:'the remains of a camp: a ring of blackened stones and trampled grass',cairn_door:'a low door of fitted stone set into a mound, shut fast',
  watchtower:'a leaning watchtower with half its stair gone'};
const KIND_NOTHING={shrine:'Only old offerings and moss.',ruin:'Fallen stone and weeds; nothing waits here for you.',camp:'Cold ash, and the marks of those who sat here.',
  cairn_door:'The stone keeps its own counsel.',watchtower:'Birds’ nests and rotten boards.'};
const dirName=(dx,dy)=>{const v=dy<-.4*Math.abs(dx)?'north':dy>.4*Math.abs(dx)?'south':'',h=dx>.4*Math.abs(dy)?'east':dx<-.4*Math.abs(dy)?'west':'';return (v+h)||'close by'};

// What is here to search or examine: markers (S.places) and landmarks within r of the hero.
function things(a,r){const out=[];
  for(const p of S.places||[])if(p&&p.name&&Number.isFinite(p.x)&&dist(a,p)<=r)out.push({t:'mark',o:p,name:p.name,kind:p.kind,d:dist(a,p),key:'m:'+p.id});
  for(const l of [...LANDMARKS,...(CRYPT&&!LANDMARKS.includes(CRYPT)?[CRYPT]:[])])if(l&&l.name&&dist(a,l)<=r)out.push({t:'land',o:l,name:l.name,kind:l.kind,d:dist(a,l),key:'l:'+l.name});
  return out.sort((x,y)=>x.d-y.d)}
function pick(L,what){const w=norm(what);if(!w)return L[0]||null;
  return L.find(t=>norm(t.name)===w||norm(t.kind)===w)||L.find(t=>norm(t.name).includes(w)||w.includes(norm(t.name)))||
    (/\b(sign|stair|door|mouth|entrance|gate)\b/.test(w)?L.find(t=>t.t==='land'&&(t.o.sign||t.kind==='crypt')):null)||null}
const townHere=a=>CITY.find(c=>a.x>=c.x0-.5&&a.x<=c.x1+1.5&&a.y>=c.y0-.5&&a.y<=c.y1+1.5)||null;
const listText=L=>L.length?L.slice(0,5).map(t=>t.name).join(', '):'nothing marked';

// ---- examine ----
export function examineView(a,{what}={},R=12){const L=things(a,R),w=norm(what),town=townHere(a);
  if(town&&(/\b(board|notice|notices)\b/.test(w)||(!w&&!L.length))){const n=noticesAt(a,town.name);
    return {ok:true,examined:'the notice board in '+town.name,text:n.length?'Pinned up: '+n.map(x=>x.from+': "'+x.notice+'"').join(' | '):'Nothing is pinned up that concerns you.'}}
  if(!w&&!L.length)return {ok:false,error:'Nothing marked is in sight. examine takes a marked place, a landmark or its sign (look and places tell what is about); inspect covers people, creatures and items.'};
  const th=pick(L,what);
  if(!th)return {ok:false,error:'Nothing called "'+clean(what,40)+'" is in sight to examine. In sight: '+listText(L)+'.'};
  const o=th.o,rec=(a.srch||{})[th.key];
  if(th.t==='mark')return {ok:true,examined:th.name,text:'You look closely at '+th.name+': '+(KIND_TEXT[o.kind]||'a place the land keeps')+'.',
    found_before:rec&&rec.ok&&rec.text?rec.text:undefined,hint:rec&&rec.ok?undefined:'A search of it, close by, might turn up more.',tiles:Math.round(th.d)};
  if(o.sign){loreHear(a,o.sign,'the sign');learnPlace(a,o.name,'told')}
  return {ok:true,examined:th.name,tiles:Math.round(th.d),
    text:(o.kind==='crypt'?'The mouth of '+o.name+': stone steps going down into the dark.':o.kind==='lair'?'The lair '+o.name+' is said to hold: bones, and a wide scraped floor.':'You look closely at '+o.name+'.')+(o.sign?' A sign reads: "'+clean(o.sign,300)+'"':''),
    hint:rec&&rec.ok?undefined:th.d<=SR.REACH?'A search might turn up more.':undefined}}

// ---- search ----
function tracksOf(a){const seen=new Set(),out=[];
  for(const m of nearMobs(a.x,a.y,SR.TRACK)){if(!m||m.hidden||m.gone||!(m.hp>0))continue;const k=m.type+'|'+(m.v||'')+(m.elite||m.named?m.name:'');if(seen.has(k))continue;seen.add(k);out.push(m);if(out.length>=2)break}
  return out}
// A cache the DM hid at a marker: gold, or an item through the give_item path. One finder takes it.
function cacheTo(a,o){const t=clean(o.cache,60),m=/^(\d+)\s*(?:g|gold)?$/i.exec(t);
  if(m){const g=Math.min(SR.GOLD_MAX,Number(m[1]));if(g>0){a.gold=(a.gold||0)+g;o.cacheBy=a.id;return 'Tucked away: '+g+' gold.'}return null}
  const r=foundItem(a,t);if(r.err)return null;o.cacheBy=a.id;return 'Tucked away: '+r.name+'.'}
export function searchAct(a,{what}={},R=12){
  const w=norm(what);let th=null;
  if(w){th=pick(things(a,R),what);
    if(!th){const far=things(a,80).find(t=>norm(t.name)===w||norm(t.name).includes(w));
      if(far)return {ok:false,error:far.name+' is '+Math.round(far.d)+' tiles away and out of sight. move_to it first.'};
      return {ok:false,error:'Nothing called "'+clean(what,40)+'" is in sight to search. In sight: '+listText(things(a,R))+'. search with no target works the ground where you stand.'}}
    if(th.d>SR.REACH)return {ok:false,error:th.name+' is '+Math.round(th.d)+' tiles off; walk up to it first (move_to "'+th.name+'"), then search.'}}
  else th=things(a,SR.REACH)[0]||null;
  const key=th?th.key:'g:'+Math.round(a.x/4)+','+Math.round(a.y/4),thing=th?th.name:'the ground here',dc=th?(SR.DC[th.kind]||12):SR.DC.ground;
  const book=a.srch||(a.srch={}),rec=book[key]||(book[key]={n:0,at:-1e9,ok:false});
  if(rec.ok&&th&&rec.text)return {ok:true,searched:thing,result:'already searched',found:rec.text,note:'You have been over it; nothing new.'};
  if(S.gameMin<rec.at+SR.COOL)return {ok:false,error:'You searched '+thing+' '+Math.round(S.gameMin-rec.at)+' game minutes ago'+(rec.ok?' and found what there was':' and found nothing')+'; come back in about '+Math.ceil(rec.at+SR.COOL-S.gameMin)+' minutes, or try elsewhere.'};
  const b=bestFor([a],['lore','perception']),mod=b?b.mod:0,d20=1+Math.floor(hash(a.id,strHash(key),rec.n)*20),pass=d20+mod>=dc;
  rec.n++;rec.at=Math.round(S.gameMin);rec.ok=pass;
  const res={ok:true,searched:thing,took_min:SR.MIN};
  for(const h of sayHearers(a))notify(h,a.name+' searches '+thing+'.',0);
  let text=null;
  if(pass){
    if(!th){const t=tracksOf(a);
      if(t.length){text='Tracks and signs of '+t.map(m=>{loreSight(a,m);return foeName(a,m)+', '+dirName(m.x-a.x,m.y-a.y)}).join('; ')+'. You read them well enough to know what passed.';res.result='found'}
      else res.result='nothing'}
    else{const o=th.o,parts=[];
      if(th.t==='mark'){if(o.reveal)parts.push(clean(o.reveal,240));
        if(o.cache&&!o.cacheBy){const c=cacheTo(a,o);if(c)parts.push(c)}
        else if(o.cache)parts.push(o.cacheBy===a.id?'The hollow where you found it is empty now.':'Someone has been here before you: the hiding place is empty.');
        res.result=parts.length?'found':'nothing';if(!parts.length)parts.push(KIND_NOTHING[o.kind]||'Nothing hidden here.')}
      else{if(o.sign){parts.push('You read the sign in full: "'+clean(o.sign,300)+'"');loreHear(a,o.sign,'the sign')}else parts.push('Nothing more than what you see.');
        learnPlace(a,o.name,'told');res.result=o.sign?'found':'nothing'}
      text=parts.join(' ');
      if(res.result==='found'&&th.t==='mark')loreFound(a,o.name,clean(o.reveal||text,200),o.id)}}
  else res.result='nothing';
  if(res.result==='nothing'&&!pass){res.looked=th&&th.t==='mark'?'You look over '+thing+': '+(KIND_TEXT[th.kind]||'a quiet spot')+'. Nothing you can make sense of.':'You go over '+thing+' and find nothing you can use.';
    res.note='Searched: it gives you nothing more for about '+Math.round(SR.COOL/60)+' game hours.'}
  if(text){res.found=text;if(res.result==='found')rec.text=clean(text,300)}
  record(a,'Searched: ',thing+(res.result==='found'?' (found something)':' (nothing)'));
  dmlog('search',null,[a.name+' searches '+thing+(res.result==='found'?' and finds something':' and finds nothing')],
    {hero:a.id,spot:thing,d20,mod,dc,pass,result:res.result,reveal:th&&th.o.reveal?clean(th.o.reveal,160):undefined},{heroes:[a.id]});
  return res}
