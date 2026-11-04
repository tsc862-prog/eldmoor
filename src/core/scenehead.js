// A Table scene's short title (#471): the kind and a few of the scene's own words, for the pixel-font title of the Table
// banner (ui/table.js) and the scene view's bar (render/sceneview.js). The full title still shows as body text.
// Pure text, no DOM, no sim state.
const KIND={decision:'Vote',check:'Check',choice:'Choice',ambush:'Ambush',elite:'Elite',boss:'Boss',rescue:'Rescue',site:'Crypt',room:'Crypt',crawl:'Crypt',
  meeting:'Meeting',social:'Talk',trap:'Trap',mystery:'Mystery',vision:'Vision'};
const HEAD_MAX=24; // characters of the scene's own words in the pixel-font title
// {head, cut, full}: head = "Vote · make camp here…" (shown upper case), cut = the words did not all fit, full = the title without its kind prefix.
export function sceneHead(kind,title){const full=String(title||'').replace(/^(put to the party|ambush|vote)\s*:\s*/i,'').trim();
  let s='';for(const w of full.split(/\s+/).filter(Boolean)){if(s&&(s+' '+w).length>HEAD_MAX)break;s=s?s+' '+w:w}
  const pre=full.split(/: /)[0];if(pre!==full&&pre.length<=HEAD_MAX&&s.length>pre.length)s=pre; // "The Miller's Debt: a check" -> the part before the colon
  if(s.length>HEAD_MAX)s=s.slice(0,HEAD_MAX);const cut=s.length<full.length;
  if(cut)for(let k=0;k<3;k++)s=s.replace(/[\s:;,.·-]+$/,'').replace(/\s+(the|a|an|and|or|by|of|to|in|at|on|for|with|our|their|its)$/i,'');s=s.replace(/[\s:;,.·-]+$/,'');
  const k=KIND[kind]||(kind?kind[0].toUpperCase()+kind.slice(1):'Scene');return {head:k+(s?' · '+s+(cut?'…':''):''),cut,full}}
