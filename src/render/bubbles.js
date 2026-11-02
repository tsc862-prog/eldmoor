// Speech bubbles: a dark rounded box with a hero's latest line, drawn above the name
// label in follow view only. Lines come from sim/chat.js (a.bubble={text,life}); the
// bubble fades out over its last 0.6s. Text is word-wrapped to at most three short lines;
// anything longer is truncated with an ellipsis.
import {T} from '../world/tiles.js';
import {bubbleVisible} from '../core/chatview.js';
import {toneOf} from '../core/colors.js';

import {TEXT} from './palette.js';

const CSS=12,LINE=20,MAXL=3,FADE=.6;

function wrap(text){const out=[];let cur='';
  for(const w of text.split(' ')){if(cur&&(cur+' '+w).length>LINE){out.push(cur);cur=w}else cur=cur?cur+' '+w:w}
  if(cur)out.push(cur);
  if(out.length>MAXL){out.length=MAXL;out[MAXL-1]=out[MAXL-1].slice(0,LINE-1).trimEnd()+'…'}
  return out}

export function drawBubbles(ctx,S,cam,drawText){
  const cv=ctx.canvas,vw=cv.width/cam.sc,vh=cv.height/cam.sc;
  const s=CSS*cam.dpr/cam.sc,lh=s*.8,pad=s*.3;
  for(const a of S.agents.concat(S.npcs||[],S.wanderers||[])){const b=a.bubble;if(!b||b.life<=0||a.hidden||a.state==='dead'||!bubbleVisible(a,S))continue; // heroes and townsfolk (sim/npcs.js)
    const px=a.x*T,py=a.y*T;if(Math.abs(px-cam.camX)>vw/2+60||Math.abs(py-cam.camY)>vh/2+60)continue;
    const tone=toneOf(a,S.fellowship),head=tone.kind==='class'?a.name.toUpperCase():tone.npc?'['+a.name+']':null,lines=(head?[head]:[]).concat(wrap(b.text)); // a member's bubble leads with its name in class colour, an NPC's in [brackets] in its disposition colour
    ctx.font=s+'px VT323, monospace';let w=0;for(const l of lines)w=Math.max(w,ctx.measureText(l).width);
    const bw=w+pad*2,bh=lines.length*lh+pad*1.2,bottom=py-17-s*1.15,top=bottom-bh,x0=px-bw/2;
    ctx.globalAlpha=Math.min(1,b.life/FADE);
    ctx.fillStyle='rgba(10,10,22,.86)';
    if(ctx.roundRect){ctx.beginPath();ctx.roundRect(x0,top,bw,bh,pad);ctx.fill()}else ctx.fillRect(x0,top,bw,bh);
    ctx.beginPath();ctx.moveTo(px-pad*.6,bottom);ctx.lineTo(px+pad*.6,bottom);ctx.lineTo(px,bottom+pad*.7);ctx.fill();
    lines.forEach((l,i)=>drawText(l,px,top+pad*.6+lh*(i+.85),head&&i===0?tone.color:TEXT.label,CSS));
    ctx.globalAlpha=1}}
