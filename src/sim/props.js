// Scene props as sim data (issue #592). A Table scene carries `sc.props = [{id, name, item?, gone?}]`: the small objects its frame
// names (words in data/props.js, moved here from the renderer), set once when a staged scene opens (the DM may name the item the
// first one holds with cast.item) or derived on first need for any other scene. The renderer, examine and search read it; giving
// the item (give_item, #524) marks the prop gone. No RNG, nothing here touches the world's dice.
import {PROP_KINDS} from '../data/props.js';

const said=sc=>[sc.title,Array.isArray(sc.frame)?sc.frame.join(' '):sc.frame,sc.narr&&sc.narr.text].join(' ').replace(/<[^>]*>/g,' ');
// Derive without storing: every kind the scene's words name, the DM's item on the first.
export function deriveProps(sc,item){const t=said(sc),out=[];
  for(const k of PROP_KINDS)if(k.re.test(t))out.push({id:k.id,name:k.name});
  if(item&&out[0])out[0].item=String(item).slice(0,40);
  return out}
// The scene's props: stored ones, else derived (not stored, so a reader never mutates the scene).
export function propsOf(sc){if(!sc)return [];return Array.isArray(sc.props)?sc.props:deriveProps(sc)}
export function setProps(sc,item){if(sc&&!Array.isArray(sc.props))sc.props=deriveProps(sc,item);return sc?sc.props:[]}
export const liveProps=sc=>propsOf(sc).filter(p=>!p.gone);
export const propLook=p=>{const k=PROP_KINDS.find(x=>x.id===p.id);return k?k.look:'a small thing left where it can be seen'};
const lc=s=>String(s||'').toLowerCase();
// The prop matching a hero's words ("candle", "the stub", an item name), or the first live one when nothing is asked.
export function findProp(sc,what){const L=liveProps(sc),w=lc(what).replace(/^(the|a|an)\s+/,'').trim();
  if(!w)return L[0]||null;
  return L.find(p=>lc(p.name).includes(w)||w.includes(p.id)||(p.item&&(lc(p.item).includes(w)||w.includes(lc(p.item)))))||null}
// The item was handed over: the prop that held it (by name, else the kind its words name) is gone.
export function takeProp(sc,name){if(!sc)return;const n=lc(name);if(!Array.isArray(sc.props))sc.props=deriveProps(sc);
  for(const p of sc.props){if(p.gone)continue;const k=PROP_KINDS.find(x=>x.id===p.id);
    if((p.item&&lc(p.item)===n)||(!p.item&&k&&k.re.test(name))){p.gone=true;return p}}
  return null}
