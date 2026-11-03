// Speech bubbles: an opaque dark box edged in the speaker's colour with a hero's latest line, drawn above
// the name label in follow view only. Lines come from sim/chat.js (a.bubble={text,life}); the
// bubble fades out over its last 0.6s. Text is word-wrapped to at most three short lines;
// anything longer is truncated with an ellipsis. bubbleBoxes() gives the same boxes so the label
// pass can keep names clear of them in a Table scene (#471).
import {T} from '../world/tiles.js';
import {bubbleVisible} from '../core/chatview.js';
import {toneOf} from '../core/colors.js';

import {TEXT} from './palette.js';

const CSS=12,LINE=20,MAXL=3,FADE=.6,FILL='#0a0a16';

function wrap(text){const out=[];let cur='';
  for(const w of text.split(' ')){if(cur&&(cur+' '+w).length>LINE){out.push(cur);cur=w}else cur=cur?cur+' '+w:w}
  if(cur)out.push(cur);
  if(out.length>MAXL){out.length=MAXL;out[MAXL-1]=out[MAXL-1].slice(0,LINE-1).trimEnd()+'…'}
  return out}

// Every bubble in view, laid out in world px: {b, tone, head, lines, px, top, bottom, x0, bw, bh, lh, pad}.
function layout(ctx,S,cam){const out=[],cv=ctx.canvas,vw=cv.width/cam.sc,vh=cv.height/cam.sc;
  const s=CSS*cam.dpr/cam.sc,lh=s*.8,pad=s*.3;ctx.font=s+'px VT323, monospace';
  for(const a of S.agents.concat(S.npcs||[],S.wanderers||[])){const b=a.bubble;if(!b||b.life<=0||a.hidden||a.state==='dead'||!bubbleVisible(a,S))continue; // heroes and townsfolk (sim/npcs.js)
    const px=a.x*T,py=a.y*T;if(Math.abs(px-cam.camX)>vw/2+60||Math.abs(py-cam.camY)>vh/2+60)continue;
    const tone=toneOf(a,S.fellowship,S.gameMin),head=tone.kind==='class'?a.name.toUpperCase():tone.npc?'['+a.name+']':null,lines=(head?[head]:[]).concat(wrap(b.text)); // a member's bubble leads with its name in class colour, an NPC's in [brackets] in its disposition colour
    let w=0;for(const l of lines)w=Math.max(w,ctx.measureText(l).width);
    const bw=w+pad*2,bh=lines.length*lh+pad*1.2,bottom=py-17-s*1.15,top=bottom-bh,x0=px-bw/2;
    out.push({b,tone,head,lines,px,top,bottom,x0,bw,bh,lh,pad})}
  return out}
// The bubbles' boxes in world px, [x0, y0, x1, y1] each (the tail included).
export function bubbleBoxes(ctx,S,cam){return layout(ctx,S,cam).map(o=>[o.x0,o.top,o.x0+o.bw,o.bottom+o.pad*.7])}

export function drawBubbles(ctx,S,cam,drawText){
  for(const o of layout(ctx,S,cam)){const {b,tone,head,lines,px,top,bottom,x0,bw,bh,lh,pad}=o;
    ctx.globalAlpha=Math.min(1,b.life/FADE);
    ctx.fillStyle=FILL;
    if(ctx.roundRect){ctx.beginPath();ctx.roundRect(x0,top,bw,bh,pad);ctx.fill();if(head&&tone.color){ctx.strokeStyle=tone.color;ctx.lineWidth=cam.dpr/cam.sc;ctx.stroke()}}else ctx.fillRect(x0,top,bw,bh);
    ctx.fillStyle=FILL;ctx.beginPath();ctx.moveTo(px-pad*.6,bottom);ctx.lineTo(px+pad*.6,bottom);ctx.lineTo(px,bottom+pad*.7);ctx.fill();
    lines.forEach((l,i)=>drawText(l,px,top+pad*.6+lh*(i+.85),head&&i===0?tone.color:TEXT.label,CSS));
    ctx.globalAlpha=1}}
