// Update in place (issue #145). Panels rebuild their content on a timer; rebuilding by
// replaceChildren threw away scroll containers, open <details>, focus and text selection, so lists
// snapped back to the top while the owner read them. Instead a panel builds its new content into a
// detached node and patch() morphs the live node into it:
//   - nodes are reused (matched by data-k key when the builder sets one, else by position, tag and
//     class), so scroll containers keep their scrollTop and buttons keep focus;
//   - an open <details> stays open (the viewer's choice wins over the builder's default);
//   - a form control the viewer is using is never replaced;
//   - when rows are inserted above what the viewer is reading, the scroller is moved by the same
//     amount, so the row in view stays in view (newest-first lists);
//   - nothing changes at all while the viewer is scrolling it, pressing in it, selecting text in it
//     or has a picker open in it (held()); the caller simply tries again on the next tick.
// keyOf(obj) gives a stable key for a sim entry object (a log line, a chat line) for data-k.
// DOM-only: the sim never imports this.

const now=()=>Date.now();
const SCROLL_HOLD=450,PRESS_HOLD=3000;
let scrollAt=0,scrollEl=null,downAt=0,downEl=null,inited=false;
const changed=new WeakSet(); // selects changed since they took focus: a closed picker, safe to update

export function initStable(){if(inited||typeof document==='undefined'||!document.addEventListener)return;inited=true;
  document.addEventListener('scroll',e=>{scrollAt=now();scrollEl=e.target},true);
  document.addEventListener('wheel',e=>{scrollAt=now();scrollEl=e.target},{capture:true,passive:true});
  document.addEventListener('pointerdown',e=>{downAt=now();downEl=e.target},true);
  const up=()=>{downEl=null};document.addEventListener('pointerup',up,true);document.addEventListener('pointercancel',up,true);
  document.addEventListener('focusin',e=>{if(e.target)changed.delete(e.target)},true);
  document.addEventListener('change',e=>{if(e.target&&e.target.tagName==='SELECT')changed.add(e.target)},true)}

const inside=(node,x)=>!!(x&&node&&x!==document&&typeof node.contains==='function'&&node.contains(x));
// True while the viewer is busy inside node: do not touch it this tick.
export function held(node){if(!node||typeof document==='undefined')return false;
  const ae=document.activeElement;
  if(ae&&inside(node,ae)){const t=ae.tagName;if(t==='INPUT'||t==='TEXTAREA'||(t==='SELECT'&&!changed.has(ae)))return true}
  if(downEl&&now()-downAt<PRESS_HOLD&&inside(node,downEl))return true;
  if(scrollEl&&now()-scrollAt<SCROLL_HOLD&&(inside(node,scrollEl)||scrollEl===node))return true;
  const sel=typeof window!=='undefined'&&window.getSelection?window.getSelection():null;
  if(sel&&!sel.isCollapsed&&sel.rangeCount&&(inside(node,sel.anchorNode)||inside(node,sel.focusNode)))return true;
  return false}

// ---- stable keys for sim entries ----
const ids=new WeakMap();let next=1;
export function keyOf(o){if(o==null||typeof o!=='object')return String(o);let k=ids.get(o);if(!k){k='e'+(next++);ids.set(o,k)}return k}
// Set a row's key; returns the node.
export const keyed=(node,k)=>{node.setAttribute('data-k',String(k));return node};

// ---- morph ----
const kOf=n=>n&&n.nodeType===1?n.getAttribute('data-k'):null;
const FORM={SELECT:1,INPUT:1,TEXTAREA:1};
const PROPS=['onclick','onchange','oninput','onkeydown'];
function attrList(n){const out=[];const as=n.attributes;if(!as)return out;for(let i=0;i<as.length;i++)out.push([as[i].name,as[i].value]);return out}
function sameKind(o,n){if(o.nodeType!==n.nodeType)return false;if(o.nodeType!==1)return true;
  return o.tagName===n.tagName&&kOf(o)===kOf(n)&&o.tagName!=='CANVAS'}
// A form control is reused only when it says the same; one in use is never touched.
function formSig(n){let s=attrList(n).map(a=>a.join('=')).join('&')+'|'+(n.value==null?'':n.value);
  for(const c of n.childNodes||[])if(c.nodeType===1)s+='|'+(c.value==null?'':c.value)+':'+c.textContent+':'+(c.selected?1:0)+':'+(c.disabled?1:0);return s}
function syncAttrs(o,n){const keep=o.tagName==='DETAILS'?'open':null,want=attrList(n);const has=new Set();
  for(const [k,v] of want){has.add(k);if(k===keep)continue;if(o.getAttribute(k)!==v)o.setAttribute(k,v)}
  for(const [k] of attrList(o))if(!has.has(k)&&k!==keep)o.removeAttribute(k);
  for(const p of PROPS)if(o[p]!==n[p]&&(o[p]||n[p]))o[p]=n[p]||null}
function update(o,n){
  if(o.nodeType!==1){const v=n.nodeValue!=null?n.nodeValue:n.data;if((o.nodeValue!=null?o.nodeValue:o.data)!==v){if('nodeValue' in o)o.nodeValue=v;else o.data=v}return o}
  if(FORM[o.tagName]){if(typeof document!=='undefined'&&document.activeElement===o)return o;if(formSig(o)===formSig(n))return o;o.parentNode.replaceChild(n,o);return n}
  syncAttrs(o,n);morphChildren(o,n);return o}
export function morphChildren(op,np){const want=Array.from(np.childNodes);
  const byKey=new Map();for(const c of Array.from(op.childNodes)){const k=kOf(c);if(k!=null&&!byKey.has(k))byKey.set(k,c)}
  let i=0;
  for(const n of want){const k=kOf(n);let o=null;
    if(k!=null){o=byKey.get(k)||null;if(o)byKey.delete(k)}
    else{const c=op.childNodes[i];if(c&&kOf(c)==null&&sameKind(c,n))o=c}
    if(o){if(op.childNodes[i]!==o)op.insertBefore(o,op.childNodes[i]||null);update(o,n)}
    else op.insertBefore(n,op.childNodes[i]||null);
    i++}
  while(op.childNodes.length>i)op.removeChild(op.childNodes[op.childNodes.length-1])}

// ---- scroll anchoring ----
function scrolled(root,out){if(root.nodeType!==1)return out;if(root.scrollTop>0)out.push(root);for(const c of root.children||[])scrolled(c,out);return out}
function anchorOf(sc){const top=sc.scrollTop;for(const c of sc.children||[]){const t=c.offsetTop||0,h=c.offsetHeight||0;if(t+h>top)return {sc,node:c,t,top}}return {sc,node:null,top}}
function restore(a){const sc=a.sc;if(!a.node||!sc.contains(a.node))return;const d=(a.node.offsetTop||0)-a.t;if(d)sc.scrollTop=a.top+d}
// Run fn (which changes the content of scroller) and keep the row the viewer is reading where it was.
export function keepView(scroller,fn){if(!scroller||!(scroller.scrollTop>0))return fn();const a=anchorOf(scroller);const r=fn();restore(a);return r}

// Morph target's children into what build(node) produces. Returns false when held (try again later).
// anchor:false for ranked lists (rows move by rank, so the view stays where it is rather than following a row).
export function patch(target,build,{force=false,anchor=true}={}){if(!target)return false;if(!force&&held(target))return false;
  const tmp=document.createElement(target.tagName||'div');build(tmp);
  const as=anchor?scrolled(target,[]).map(anchorOf):[];
  morphChildren(target,tmp);
  for(const a of as)restore(a);
  return true}
