// A hero's will (issue #631, owner request): bequeath {to, item?|gold?, words?} names, for one companion of the hero's
// company, an item carried or worn or a sum of gold, with up to WILL.WORDS characters of words. Several bequests, one
// per item (and one sum of gold per companion); to "nobody" revokes. The will is private (a.will, read by the hero's own
// status and self, the watcher's Life view) until it executes.
// It executes on the final death only: fall() in heroes.js calls the hook (never goDown, so a downed hero who is
// brought back keeps it unread). Each bequest goes to the named companion if they still live and ride in the same
// company: at once when within WILL.NEAR tiles (an urgent event with the words, a landmark "Received ... from ..."),
// else it waits in C.estate until they next rest (in a town or at a camp's rest), when it arrives as a letter. Gear made
// for another class is sold for them; a stack that does not fit is sold too. A dead heir, one who left the company or
// a thing no longer carried lets the bequest lapse. Nothing goes outside the company or to a replacement recruit
// (letters cover that). Agent heroes only (the tool is theirs); scripted heroes make no will, so a seeded world is
// unchanged. No RNG.
import {S} from './state.js';
import {CITY,dist} from '../world/map.js';
import {SLOTS,USES,GOODS,MATERIALS,price} from '../data/items.js';
import {SELL_VALUE} from './gear.js';
import {invOf,isGear,addGear,addGood,addUse,take} from './inv.js';
import {companyOf} from './company.js';
import {record} from './history.js';
import {log} from './chronicle.js';
import {notify} from './notify.js';
import {mark} from './tiers.js';
import {notEnglish} from './lang.js';

export const WILL={WORDS:120,MAX:8,NEAR:7,PER_DAY:12,RECEIVED:20};
const DAY=1440;
const NOBODY=['nobody','none','no one','noone','revoke','-'];
const nk=s=>String(s==null?'':s).toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const clean=s=>String(s==null?'':s).replace(/\s+/g,' ').trim();
const byId=id=>S.agents.find(x=>x.id===id)||null;
const alive=b=>!!b&&b.state!=='dead';
const day=()=>Math.floor(S.gameMin/DAY)+1;
const err=e=>({ok:false,error:e});

// ---- the companions a will may name ----
function mates(a){const C=companyOf(a);if(!C)return [];return C.ids.map(byId).filter(b=>b&&b!==a&&alive(b))}
function mateBy(a,to){const k=nk(to);if(!k)return null;
  return mates(a).find(b=>String(b.id)===k||nk(b.name)===k)||mates(a).find(b=>nk(b.name).split(' ')[0]===k)||null}

// ---- the things a will may name: worn pieces and pack entries ----
// Returns {name, kind: 'gear'|'good'|'use'} or {error}.
function thingOf(a,item){const raw=clean(item);if(!raw)return {error:'Bequeath what? item: a piece you wear or carry (by name or pack index), or gold.'};
  const L=invOf(a).list;
  if(/^\d+$/.test(raw)){const e=L[Number(raw)];if(!e)return {error:'No pack entry '+raw+'. '+listing(a)};return entryThing(e)}
  const k=nk(raw),c=[];
  for(const s of SLOTS){const it=a.slots&&a.slots[s];if(it&&(s===k||nk(it.name)===k))return {name:it.name,kind:'gear'};if(it&&nk(it.name).includes(k))c.push({name:it.name,kind:'gear'})}
  for(const e of L){const t=entryThing(e);if(t.error){if(nk(e.id)===k)return t;continue}if(nk(t.name)===k)return t;if(nk(t.name).includes(k))c.push(t)}
  const u=[...new Map(c.map(t=>[t.name,t])).values()];
  if(u.length===1)return u[0];
  if(u.length>1)return {error:'"'+raw.slice(0,40)+'" fits several things: '+u.map(t=>t.name).join(', ')+'. Name one.'};
  return {error:'You carry nothing called "'+raw.slice(0,40)+'". '+listing(a)}}
function entryThing(e){if(isGear(e))return {name:e.name,kind:'gear'};
  if(e.kind==='quest')return {error:'A quest item is bound to its bearer and cannot be left to anyone.'};
  return {name:e.id,kind:e.kind}}
function listing(a){const w=SLOTS.map(s=>a.slots&&a.slots[s]).filter(Boolean).map(it=>it.name),p=invOf(a).list.map((e,i)=>i+': '+(isGear(e)?e.name:e.id)).slice(0,12);
  return 'You wear: '+(w.join(', ')||'nothing')+'. Your pack: '+(p.join(', ')||'empty')+'.'}

// ---- reading ----
export const willOf=a=>Array.isArray(a&&a.will)?a.will:[];
const whatOf=b=>b.gold!=null?b.gold+' gold':b.item;
// The hero's own view of its will (status, self). Nothing of it reaches anyone else until it executes.
export function willView(a){const W=willOf(a);if(!W.length)return null;
  return W.map(b=>({to:b.toName,what:whatOf(b),...(b.words?{words:b.words}:{}),day:b.day}))}

// ---- the tool ----
export function bequeath(a,{to,item,gold,words}={}){
  if(!a||a.state==='dead')return err('The dead leave no new wills.');
  if(a.state==='ghost')return err('A ghost owns nothing to leave.');
  const D=a.willDay||(a.willDay={d:0,n:0});if(D.d!==day()){D.d=day();D.n=0}
  if(D.n>=WILL.PER_DAY)return err('You have changed your will '+WILL.PER_DAY+' times today. Let it rest until tomorrow.');
  const hasItem=item!=null&&clean(item)!=='',hasGold=gold!=null&&String(gold).trim()!=='';
  if(hasItem&&hasGold)return err('One bequest at a time: an item or gold, not both.');
  const W=willOf(a).slice();
  // revoke
  if(to!=null&&NOBODY.includes(nk(to))){
    if(!W.length)return err('You have made no will to revoke.');
    let left;
    if(hasItem){const k=nk(item);left=W.filter(b=>!(b.item&&(nk(b.item)===k||nk(b.item).includes(k))));if(left.length===W.length)return err('Your will leaves no "'+clean(item).slice(0,40)+'" to anyone. '+summary(W))}
    else if(hasGold){left=W.filter(b=>b.gold==null);if(left.length===W.length)return err('Your will leaves no gold to anyone.')}
    else left=[];
    D.n++;a.will=left.length?left:null;
    return {ok:true,revoked:W.length-left.length,will:willView(a)||[],note:left.length?'Struck from your will.':'Your will is torn up: nothing is left to anyone.'}}
  if(to==null||clean(to)==='')return err('Bequeath to whom? to: a companion of your company by name, or "nobody" to revoke. '+mateLine(a));
  if(!companyOf(a)||!mates(a).length)return err('You ride with no companion: a will names a companion of your company. Letters, not wills, reach those who come after.');
  if(nk(to)===nk(a.name)||String(a.id)===nk(to)||['me','myself','self'].includes(nk(to)))return err('A will leaves things to others: name a companion, not yourself.');
  const b=mateBy(a,to);
  if(!b)return err('"'+clean(to).slice(0,40)+'" is not a living companion of your company. '+mateLine(a));
  let w=clean(words);
  if(w.length>WILL.WORDS)return err('Your words run to '+w.length+' characters; a will holds '+WILL.WORDS+'. Say it shorter.');
  if(w&&notEnglish(w))return err('Not written: write it in English, as everyone in Eldmoor speaks.');
  let row;
  if(hasGold){const g=Math.round(Number(gold));
    if(!Number.isFinite(g)||g<=0)return err('Leave how much? gold must be a whole number above zero.');
    const other=W.filter(x=>x.gold!=null&&x.to!==b.id).reduce((s,x)=>s+x.gold,0),held=Math.floor(a.gold||0);
    if(other+g>held)return err('You hold '+held+' gold'+(other?' and have already left '+other+' to others':'')+'; you cannot leave '+g+' more.');
    row={to:b.id,toName:b.name,gold:g};
    const i=W.findIndex(x=>x.gold!=null&&x.to===b.id);if(i>=0)W.splice(i,1)}
  else{if(!hasItem)return err('Bequeath what? item (a piece you wear or carry, by name or pack index) or gold.');
    const t=thingOf(a,item);if(t.error)return err(t.error);
    row={to:b.id,toName:b.name,item:t.name,kind:t.kind};
    const i=W.findIndex(x=>x.item===t.name);if(i>=0)W.splice(i,1)}
  if(W.length>=WILL.MAX)return err('Your will already holds '+WILL.MAX+' bequests. Revoke one first (to "nobody").');
  if(w)row.words=w;row.day=day();row.gm=Math.round(S.gameMin);
  W.push(row);a.will=W;D.n++;
  return {ok:true,bequeathed:whatOf(row),to:b.name,will:willView(a),note:'Written in your will. No one knows of it until you fall; '+b.name+' receives it then if they still ride with you.'}}
const summary=W=>'Your will: '+W.map(b=>whatOf(b)+' to '+b.toName).join('; ')+'.';
function mateLine(a){const L=mates(a);return L.length?'Your companions: '+L.map(b=>b.name).join(', ')+'.':''}

// ---- executing it (fall in heroes.js) ----
// Takes the thing out of the fallen hero's hands: {gear} | {stack:{kind,id,n}} | {gold} | null when it is gone.
function takeThing(a,b){
  if(b.gold!=null){const g=Math.min(b.gold,Math.max(0,Math.floor(a.gold||0)));if(g<=0)return null;a.gold-=g;return {gold:g}}
  if(b.kind==='gear'){for(const s of SLOTS){const it=a.slots&&a.slots[s];if(it&&it.name===b.item){a.slots[s]=null;return {gear:it}}}
    const L=invOf(a).list,i=L.findIndex(e=>isGear(e)&&e.name===b.item);if(i>=0)return {gear:L.splice(i,1)[0]};return null}
  let n=0;for(const e of invOf(a).list)if(!isGear(e)&&e.kind===b.kind&&e.id===b.item)n+=e.n;
  if(!n)return null;take(a,b.kind,b.item,n);return {stack:{kind:b.kind,id:b.item,n}}}
const thingName=t=>t.gold!=null?t.gold+' gold':t.gear?t.gear.name:(t.stack.n>1?t.stack.n+' ':'')+t.stack.id;

export function executeWill(a){const W=willOf(a);if(!W.length)return;
  const C=companyOf(a),done=[];a.will=null;
  for(const b of W){const h=byId(b.to),what=whatOf(b);
    if(!alive(h)){done.push({to:b.toName,what,how:'lapsed',why:'fallen before them'});continue}
    if(!C||companyOf(h)!==C){done.push({to:b.toName,what,how:'lapsed',why:'no longer of the company'});continue}
    const t=takeThing(a,b);if(!t){done.push({to:b.toName,what,how:'lapsed',why:'no longer carried'});continue}
    if(dist(a,h)<=WILL.NEAR&&!!a.hidden===!!h.hidden){const got=deliver(h,a,t,b.words,'near');done.push({to:h.name,what:got,how:'given'})}
    else{(C.estate||(C.estate=[])).push({to:h.id,toName:h.name,from:a.id,fromName:a.name,fac:a.fac,thing:t,...(b.words?{words:b.words}:{}),at:Math.round(S.gameMin)});
      done.push({to:h.name,what:thingName(t),how:'held'})}}
  a.willDone=done}

// Into the heir's hands: returns the line of what they got.
function deliver(h,from,t,words,how){let got,sold=0;
  const name=from&&from.name||'a fallen companion';
  if(t.gold!=null){h.gold=(h.gold||0)+t.gold;got=t.gold+' gold'}
  else if(t.gear){const it=t.gear;
    if(it.cls&&it.cls!==h.cls&&!it.epic){sold=SELL_VALUE(it);h.gold=(h.gold||0)+sold;got=it.name+' (made for a '+it.cls+'; sold for you: '+sold+' gold)'}
    else if(addGear(h,it))got=it.name;
    else{got=it.name+' (your pack was full; sold for you: '+SELL_VALUE(it)+' gold)'}}
  else{const s=t.stack,n=s.kind==='good'?addGood(h,s.id,s.n):addUse(h,s.id,s.n),left=s.n-n;
    if(left>0){const each=s.kind==='good'&&(GOODS[s.id]||MATERIALS[s.id])?price(s.id):Math.max(1,Math.floor(((USES[s.id]&&USES[s.id].price)||2)/2));sold=each*left;h.gold=(h.gold||0)+sold}
    got=(s.n>1?s.n+' ':'')+s.id+(left>0?' ('+left+' did not fit; sold for you: '+sold+' gold)':'')}
  const said=words?': "'+words+'"':'.';
  notify(h,how==='near'?name+'\'s will names you: you receive '+got+said:'A letter from '+name+', held since they fell, comes with '+got+said,2);
  record(h,'Received '+got+' from the will of ',from&&from.kind==='hero'?from:name,'.');
  if(h.player)mark(h,'will','Received '+got+' from '+name+'.');
  const R=h.received||(h.received=[]);R.push({from:name,fromId:from&&from.id!=null?from.id:null,what:got,...(words?{words}:{}),day:day(),how});if(R.length>WILL.RECEIVED)R.shift();
  log(h,' receives ',got,' from the will of ',from&&from.kind==='hero'?from:name,'.');
  return got}

// ---- the estate: bequests waiting for a far heir to rest ----
const inTown=h=>CITY.some(c=>h.x>=c.x0-.5&&h.x<=c.x1+1.5&&h.y>=c.y0-.5&&h.y<=c.y1+1.5);
export const resting=(h,C)=>h.state==='town'||inTown(h)||(h.state==='camp'&&!!C.camp&&C.camp.phase==='rest');
export function estateTick(){const L=S.companies;if(!L||!L.length)return;
  for(const C of L){if(!C.estate||!C.estate.length)continue;
    C.estate=C.estate.filter(e=>{const h=byId(e.to);
      if(!alive(h)||companyOf(h)!==C)return false; // the heir fell or left: the bequest lapses
      if(!resting(h,C))return true;
      const from=byId(e.from)||{name:e.fromName,id:e.from,fac:e.fac};deliver(h,from,e.thing,e.words,'letter');return false});
    if(!C.estate.length)delete C.estate}}

