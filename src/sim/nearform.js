// The shapes a model writes for a place (issue #467): the DM tools take near/at as one string ("fellowship", a member,
// a town, a region, a landmark or "x,y"), but a local model sends {"x":30,"y":25} (often stringified by the runner),
// [30,25], "(30,25)", or "Highgate,20,-15" meaning a spot off the town. nearForm() turns each into what the resolvers
// read: a plain "x,y", or a base name with an offset; basePoint() finds the base and offsetPoint() places the offset off
// it. Read only, no dice. Used by placeOf/nearSpot (dmagent.js) and whereOf (staged.js).
import {W,H} from '../world/tiles.js';
import {S} from './state.js';
import {ZONES,CITY,ZPTS,LANDMARKS} from '../world/map.js';

const NUM='(-?\\d+(?:\\.\\d+)?)';
const PAIR=new RegExp('^[\\[(]?\\s*'+NUM+'\\s*[,; ]\\s*'+NUM+'\\s*[\\])]?$');
const isNum=v=>v!==''&&v!=null&&typeof v!=='boolean'&&Number.isFinite(Number(v));
const pt=(x,y)=>Number(x)+','+Number(y);

// v -> {s} (a string the resolvers read as before; "x,y" for any point shape) or {base, dx, dy, s} (a name with an offset).
export function nearForm(v){
  if(v&&typeof v==='object'){
    if(Array.isArray(v)&&v.length===2&&isNum(v[0])&&isNum(v[1]))return {s:pt(v[0],v[1])};
    if(!Array.isArray(v)&&isNum(v.x)&&isNum(v.y))return {s:pt(v.x,v.y)};
    if(!Array.isArray(v)&&typeof (v.name||v.place||v.near)==='string')return nearForm(v.name||v.place||v.near);
    return {s:''}}
  let s=String(v==null?'':v).replace(/\s+/g,' ').trim().replace(/^["'`]+|["'`]+$/g,'').trim();
  if(/^[{[]/.test(s)){try{const j=JSON.parse(s);if(j&&typeof j==='object')return nearForm(j)}catch(e){}}
  const m=PAIR.exec(s);if(m)return {s:pt(m[1],m[2])};
  // "Highgate,20,-15", "Highgate, 0,-5", "Highgate (20,-15)", "Highgate +20 -15", "Highgate {"x":20,"y":-15}"
  const o=new RegExp('^([^,(){}\\[\\]\\d+-][^,(){}\\[\\]]*?)\\s*(?:,|\\(|\\[|\\s)\\s*[+]?'+NUM+'\\s*[,; ]\\s*[+]?'+NUM+'\\s*[)\\]]?$').exec(s);
  if(o&&o[1].trim())return {s,base:o[1].trim(),dx:Number(o[2]),dy:Number(o[3])};
  const oj=/^([^{]+?)\s*,?\s*(\{.*\})$/.exec(s);
  if(oj){try{const j=JSON.parse(oj[2]);if(j&&isNum(j.x)&&isNum(j.y))return {s,base:oj[1].trim(),dx:Number(j.x),dy:Number(j.y)}}catch(e){}}
  return {s}}

const inMap=p=>p.x>=1&&p.y>=1&&p.x<W-1&&p.y<H-1;
// A base's point plus (dx,dy). Read as an offset first (a spot off the town, the usual meaning); when that falls off the
// map but the numbers are themselves a spot on the map close to the base, they were map coordinates near it. -> {x,y} or {err}.
export const OFFSET_MAX=30,ABS_NEAR=20;
export function offsetPoint(base,dx,dy,label){
  const off={x:Math.round((base.x+dx)*10)/10,y:Math.round((base.y+dy)*10)/10};
  const small=Math.abs(dx)<=OFFSET_MAX&&Math.abs(dy)<=OFFSET_MAX;
  if(small&&inMap(off))return off;
  const abs={x:dx,y:dy};
  if(inMap(abs)&&Math.hypot(abs.x-base.x,abs.y-base.y)<=ABS_NEAR)return abs;
  // a modest offset past the edge (live: "Highgate,20,-15" with Highgate's gate 7 tiles from the top): the spot on the
  // map nearest to what was meant, so the call lands instead of being refused
  if(small)return {x:Math.max(2,Math.min(W-3,off.x)),y:Math.max(2,Math.min(H-3,off.y)),clamped:true};
  return {err:'"'+label+','+dx+','+dy+'" is off the map as an offset from '+label+' (at '+Math.round(base.x)+','+Math.round(base.y)+'); the map runs 0-'+(W-1)+' by 0-'+(H-1)}}

// Map coordinates a model meant as an offset (both small or negative and off the map): a hint for the refusal.
export function pointHint(s){const m=PAIR.exec(String(s||''));if(!m)return '';const p={x:Number(m[1]),y:Number(m[2])};
  return inMap(p)?'':' ("x,y" is a spot on the map, 0-'+(W-1)+' by 0-'+(H-1)+'; for a spot off a town write "<town>,dx,dy")'}

// The point a base name stands for: a town's gate, a living hero, a DM place, a landmark or a region's centre. -> {x,y} or null.
export function basePoint(name){const s=String(name||'').trim(),lo=s.toLowerCase().replace(/^the /,'');if(!s)return null;
  const c=CITY.find(t=>t.name.toLowerCase()===lo);if(c)return {x:c.gate.x,y:c.gate.y};
  const h=S.agents.find(a=>a.state!=='dead'&&!a.hidden&&(String(a.id)===s||a.name.toLowerCase()===lo));if(h)return {x:h.x,y:h.y};
  const pl=(S.places||[]).find(p=>String(p.id)===s||(p.name||'').toLowerCase().replace(/^the /,'')===lo);if(pl)return {x:pl.x,y:pl.y};
  const lm=LANDMARKS.find(l=>l.name.toLowerCase().replace(/^the /,'')===lo);if(lm)return {x:lm.x,y:lm.y};
  const z=ZONES.findIndex(n=>n.toLowerCase()===lo);if(z>=0){const P=ZPTS[z]||[];if(!P.length)return null;let x=0,y=0;for(const p of P){x+=p.x;y+=p.y}return {x:x/P.length,y:y/P.length}}
  return null}
// near as one resolvable string: a point shape -> "x,y"; "Base,dx,dy" -> the spot as "x,y" ({err} when the base is
// unknown or the spot is off the map); anything else unchanged. -> {s} or {err}.
export function nearText(v){const f=nearForm(v);if(!f.base)return {s:f.s};
  const b=basePoint(f.base);if(!b)return {s:f.s,unknownBase:f.base};
  const p=offsetPoint(b,f.dx,f.dy,f.base);return p.err?{err:p.err}:{s:p.x+','+p.y,from:f.base+(p.clamped?' (kept on the map)':'')}}
