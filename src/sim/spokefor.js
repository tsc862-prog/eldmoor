// The DM never speaks for a member (issue #750; the one-mind rule #148 and the in-game channels rule #123). Owned by ai-designer.
// DOM-free, no RNG, no state: a pure text guard that sim/dmagent.js runs on every DM-voiced text before it reaches anyone (table_answer:
// the table frame, voice, outcome and complication lines of every voiced scene; narrate; npc_say incl. conversation answers; whisper;
// dream; ruling_answer's texts), whether the DM agent calls the tool now or a when fires it later.
//
// spokeFor(text, {names, allow}) -> {text, cut:[names]}
//   names  the living agent-played heroes (only their own agents may give them words)
//   allow  name -> the member's own recent lines: a quote that repeats what the member really said (a scene line, a say) stays
// A sentence is cut when a quotation in it is attributed to one of them: "<Name> speaks quietly: '...'", "<Name>: '...'",
// "'...,' says <Name>", "'...,' <Name> mutters", "<Name>'s voice is low: '...'". Narration around it stays, and so does a sentence that
// names them without quoting them ("Ulgug turns his symbol over", "the hermit tells Ulgug: '...'", "Ulgug listens as the hermit says '...'").
const VERB='(?:says?|said|speaks?|spoke|asks?|asked|repl(?:y|ies|ied)|answers?|answered|whispers?|whispered|murmurs?|murmured|mutters?|muttered|calls?(?: out)?|called|shouts?|shouted|cr(?:y|ies|ied)|growls?|growled|adds?|added|continues?|continued|laughs?|laughed|sighs?|sighed|snaps?|snapped|hiss(?:es)?|hissed|rumbles?|rumbled|declares?|declared|insists?|insisted|tells?|told|begins?|began|demands?|demanded|warns?|warned|breathes?|breathed|admits?|admitted|offers?|offered|observes?|observed|grunts?|grunted|chuckles?|chuckled|counters?|countered|agrees?|agreed|announces?|announced|pleads?|pleaded|swears?|swore|vows?|vowed|blurts?(?: out)?|blurted|intones?|intoned)';
const STOP='(?:as|while|when|whilst|the|a|an|his|her|their|its|to|at|for|who|whom|that|which|hears?|heard|listens?|listened|watches|watched|lets?|until|before|after|because|if|than)';
const esc=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const OPEN={'"':'"','\u201c':'\u201d','\u2018':'\u2019',"'":"'"};
const isWord=c=>!!c&&/[A-Za-z0-9\u00c0-\u024f]/.test(c);
// Quoted spans [start, end] (end = the closing mark). A straight or curly single quote opens only after a space or a mark and closes
// only before a non-letter, so "Ulgug's" and "heroes'" are no quotes.
function quotes(t){const out=[];let i=0;
  while(i<t.length){const c=t[i],close=OPEN[c],prev=t[i-1];
    if(close&&(i===0||/[\s:;,(\[\u2014\u2013-]/.test(prev))&&t[i+1]&&!/\s/.test(t[i+1])){
      let j=i+1;for(;j<t.length;j++){if(t[j]!==close)continue;if(close==='"'||close==='\u201d')break;if(!isWord(t[j+1])&&!/\s/.test(t[j-1]))break}
      if(j<t.length){out.push([i,j]);i=j+1;continue}}
    i++}
  return out}
export function spokeFor(text,{names=[],allow={}}={}){const t=String(text==null?'':text);
  const N=[...new Set(names.filter(n=>n&&String(n).trim().length>1))].sort((a,b)=>b.length-a.length);if(!N.length||!t)return {text:t,cut:[]};
  const Q=quotes(t);if(!Q.length)return {text:t,cut:[]};
  const NM='('+N.map(esc).join('|')+')';
  const lead1=new RegExp('\\b'+NM+"(?:['\u2019]s voice\\b[^\"\u201c\u2018']{0,60}|(?:\\s*,[^,\"\u201c\u2018]{0,60},)?(?:\\s+(?!"+STOP+'\\b)[A-Za-z\'-]+){0,3}?\\s+'+VERB+'\\b[^"\u201c\u2018\u201d\u2019.!?]{0,80})\\s*[:,\u2014-]?\\s*$','i');
  const lead2=new RegExp('^\\s*'+NM+'\\s*[:\u2014-]\\s*$','i');
  const tail1=new RegExp('^\\s*[,.!?\u2014-]?\\s*'+VERB+'\\s+'+NM+'\\b','i');
  const tail2=new RegExp('^\\s*[,.!?\u2014-]?\\s*'+NM+'(?:\\s+\\w+ly)?\\s+'+VERB+'\\b','i');
  const inQ=new Uint8Array(t.length);for(const [a,b] of Q)for(let k=a;k<=b;k++)inQ[k]=1;
  const ends=[];for(let k=0;k<t.length;k++)if(!inQ[k]&&/[.!?]/.test(t[k])&&(k+1>=t.length||/\s/.test(t[k+1])))ends.push(k);
  const canon=n=>N.find(x=>x.toLowerCase()===String(n).toLowerCase())||n;
  const own=(n,q)=>{const s=norm(q);if(s.length<8)return false;return (allow[n]||[]).some(l=>{const L=norm(l);return L.length>=8&&(L.includes(s)||s.includes(L))})};
  const cuts=[],who=[];
  Q.forEach(([a,b],i)=>{const prevEnd=i?Q[i-1][1]+1:0,nextStart=i+1<Q.length?Q[i+1][0]:t.length;
    let s=prevEnd;for(const e of ends)if(e<a&&e+1>s)s=e+1;
    let e2=nextStart;for(const e of ends)if(e>b&&e<nextStart){e2=e+1;break}
    const lead=t.slice(s,a),tail=t.slice(b+1,e2),ml=lead.match(lead1)||lead.match(lead2),m=ml||tail.match(tail1)||tail.match(tail2);
    if(!m)return;const n=canon(m[1]);if(own(n,t.slice(a+1,b)))return;
    if(ml&&/[.!?]/.test(t[b-1]||''))e2=b+1; // "Ulgug says: 'Go.' The fire cracks." keeps the fire
    cuts.push([s,e2]);if(!who.includes(n))who.push(n)});
  if(!cuts.length)return {text:t,cut:[]};
  let out='',k=0;for(const [s,e] of cuts){if(s<k)continue;out+=t.slice(k,s);k=e}out+=t.slice(k);
  return {text:out.replace(/[ \t]{2,}/g,' ').replace(/\s+([,.!?])/g,'$1').replace(/^\s+|\s+$/g,''),cut:who}}
// The tools whose text the heroes hear, and which of their fields.
export const VOICE_FIELDS={table_answer:['text'],narrate:['text'],npc_say:['text'],whisper:['text'],dream:['text'],ruling_answer:['text','fail_text']};
export const spokeNote=L=>'You spoke for '+L.join(' and ')+'; that line was cut: members speak for themselves. Describe what they do, never what they say.';
