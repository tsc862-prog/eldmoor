// The names on the map (#1017): what the DM may name, and the nearest real names when it names something that is not there.
// Owned by brain-builder. DOM-free, read-only, no RNG. Live play: 6 of 17 lever pulls were refused for names out of the DM's own
// notes ("the Cold Forge", "Greymane"), and it went on telling the story as if they stood. One reader of a marked place by name
// (with or without "the", any case) for every tool that takes one, one list of the names near the companies for dm_status, and
// one hint for every refusal of a name:
//   markNamed(v)       a marked place (S.places) by id or name, or null
//   mapNames(n)        up to n names on the map, nearest the companies first (marked places, landmarks, towns, regions)
//   nameHints(s, n)    the names closest to s: shared words first, then spelling, then nearest the companies
//   nameHint(s, o)     the sentence a refusal ends with; o.mark also says how to put the place on the map
import {S} from './state.js';
import {ZONES,CITY,LANDMARKS,dist} from '../world/map.js';
import {focuses} from './dmfocus.js';
import {farHint} from './atlas.js';

export const NAMES={NEAR:10,HINT:5,LETTERS:.34};
export const bareName=s=>String(s==null?'':s).trim().toLowerCase().replace(/^the\s+/,'');
export const markNamed=v=>{const s=String(v==null?'':v).trim(),b=bareName(s);if(!s)return null;return (S.places||[]).find(p=>String(p.id)===s||p.name&&bareName(p.name)===b)||null};
function all(){const out=[],seen=new Set(),add=(name,at,z)=>{const k=bareName(name);if(name&&!seen.has(k)){seen.add(k);out.push({name,at,z})}};
  for(const p of S.places||[])add(p.name,p,p.z);
  for(const l of LANDMARKS)add(l.name,l,null);
  for(const c of CITY)add(c.name,c.gate||c,null);
  ZONES.forEach((n,z)=>add(n,null,z));
  return out}
// Nearest first; a region a company stands in counts as beside it, any other region comes after every place with a position.
function nearFirst(L){const fs=focuses(),here=new Set(fs.flatMap(f=>[...f.zones])),far=1e9,d=o=>o.at&&fs.length?fs.reduce((m,f)=>Math.min(m,dist(f,o.at)),far):here.has(o.z)?0:far;
  return L.map(o=>({o,d:d(o)})).sort((a,b)=>a.d-b.d).map(x=>x.o)}
export const mapNames=(n=NAMES.NEAR)=>nearFirst(all()).slice(0,n).map(o=>o.name);
const words=s=>bareName(s).split(/[^a-z0-9]+/).filter(w=>w.length>2);
function edits(a,b){let p=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const q=[i];for(let j=1;j<=b.length;j++)q[j]=Math.min(p[j]+1,q[j-1]+1,p[j-1]+(a[i-1]===b[j-1]?0:1));p=q}return p[b.length]}
export function nameHints(s,n=NAMES.HINT){const b=bareName(s),W=new Set(words(s)),L=nearFirst(all());
  const close=L.map((o,i)=>{const nm=bareName(o.name),sh=words(o.name).filter(w=>W.has(w)).length,e=edits(b,nm)/Math.max(b.length,nm.length,1);return {o,sh,e,i}}).filter(x=>x.sh>0||x.e<=NAMES.LETTERS).sort((x,y)=>y.sh-x.sh||x.e-y.e||x.i-y.i);
  const out=close.map(x=>x.o.name);for(const o of L)if(out.length<n&&!out.includes(o.name))out.push(o.name);return out.slice(0,n)}
export function nameHint(s,o={}){const t=String(s==null?'':s).trim().slice(0,40),far=farHint(t);if(far)return far;return ' Real names near the companies: '+nameHints(t).join(', ')+'.'+(o.mark?' "'+t+'" is not on the map yet: mark_place {kind, near, name: "'+t+'", reason} puts it there, then use that name.':'')}
