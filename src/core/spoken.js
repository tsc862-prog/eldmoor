// What a person says out loud in a line of scene text (#536), for speech bubbles: the scene map shows the quoted words,
// never the action prose around them. Pure, DOM-free; used by render/sceneview.js and render/interior.js.
//   spokenOf(text, name)  the quoted words ("..." or “...”), joined when there are several; else the whole line unless it reads
//                         as prose (about the speaker by name or as he/she/they, or "The ..." with no I/you/we in it,
//                         or a (stage direction)); prose gives null (no bubble: "Father Corvane sets down the candle stub.")
//   unrole(text, people)  the text with "Stranger Father Corvane" written "Father Corvane": a placed person's role title is
//                         not part of their name (people: [{title, name}]); for lines written before the sim fix
const QUOTE=/[“"]([^”"]{2,}?)[”"]/g;
const FIRST=/\b(I|I'm|I've|I'll|me|my|mine|you|your|yours|we|us|our)\b/;
const esc=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function spokenOf(text,name){const t=String(text==null?'':text).trim();if(!t)return null;
  const q=[];let m;QUOTE.lastIndex=0;while((m=QUOTE.exec(t)))q.push(m[1].trim());
  if(q.length)return q.join(' ');
  if(/^\(/.test(t))return null; // (whispered) and stage directions
  const nm=String(name||'').trim();
  if(nm){const first=nm.split(/\s+/)[0];if(new RegExp('^(the\\s+)?('+esc(nm)+'|'+esc(first)+')\\b','i').test(t))return null} // prose about the speaker
  if(/^(he|she|they|it|his|her|their)\b/i.test(t))return null;
  if(FIRST.test(t)||/[?!]["”]?$/.test(t))return t;
  if(/^(the|a|an)\s/i.test(t))return null; // "The candle gutters." is the room, not a voice
  return t}
export function unrole(text,people){let s=String(text==null?'':text);
  for(const p of people||[])if(p&&p.title&&p.name)s=s.split(p.title+' '+p.name).join(p.name);
  return s}
