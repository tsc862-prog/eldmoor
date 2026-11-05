// Whole-map overlay (#844): in the whole-map view each company gets a pulsing ring and a bold name tag, the followed one
// brightest, so the watcher finds them at a glance. UI overlay only; read-only over the sim, drawn in world coordinates
// by render/draw.js after the labels.
import {U as T} from './tile.js';
import {FAC} from '../data/factions.js';
import {MARK} from './palette.js';
import {companies,members,followed} from '../sim/company.js';

// The company's name for a tag: its own, else its members' names (a solo: the hero's name).
export function tagName(C,L){if(C.name)return C.name;const n=L.map(a=>a.name);return n.length>2?n[0]+' and '+(n.length-1)+' more':n.join(' and ')}

// Where each company stands: [{C, x, y (tiles), r (tiles), name, followed, fac}] for companies with someone on the map.
export function companySpots(){const F=followed(),out=[];
  for(const C of companies()){const L=members(C).filter(a=>!a.hidden);if(!L.length)continue;
    let sx=0,sy=0;for(const a of L){sx+=a.x;sy+=a.y}const x=sx/L.length,y=sy/L.length;
    let r=0;for(const a of L)r=Math.max(r,Math.hypot(a.x-x,a.y-y));
    out.push({C,x,y,r:Math.max(5,r+2.5),name:tagName(C,L),followed:C===F,fac:C.fac})}
  return out}

export function drawWholeMap(ctx,cam,blink){
  const spots=companySpots();if(!spots.length)return;
  const sc=cam.sc,px=cam.dpr/sc,pulse=(Math.sin(performance.now()/380)+1)/2;
  const put=[]; // tag boxes in world px, so two companies close together stack their tags
  spots.sort((a,b)=>(a.followed?1:0)-(b.followed?1:0)); // the followed one is drawn last, on top
  for(const s of spots){
    const col=s.followed?MARK.sel:(FAC[s.fac]?FAC[s.fac].color:'#e8e8f0'),cx=s.x*T,cy=s.y*T,base=s.r*T;
    ctx.save();
    for(const k of [0,1]){ // two rings, one a beat behind
      const ph=(pulse+k*.5)%1,rr=base+ph*base*.35;ctx.globalAlpha=(s.followed?.95:.7)*(1-ph*.7);
      ctx.strokeStyle=MARK.edge;ctx.lineWidth=(s.followed?5:4)*px;ctx.beginPath();ctx.arc(cx,cy,rr,0,7);ctx.stroke();
      ctx.strokeStyle=col;ctx.lineWidth=(s.followed?3:2)*px;ctx.beginPath();ctx.arc(cx,cy,rr,0,7);ctx.stroke()}
    ctx.globalAlpha=1;
    const css=s.followed?26:21,fs=css*px;ctx.font=fs+'px VT323, monospace';ctx.textAlign='center';
    const txt=(s.followed?'\u2605 ':'')+s.name,w=ctx.measureText(txt).width+10*px,h=fs*1.05;
    let ty=cy-base-8*px-h*.2,x0=cx-w/2;
    for(let n=0;n<4;n++){const hit=put.some(b=>b[0]<x0+w&&b[0]+b[2]>x0&&b[1]<ty+h*.2&&b[1]+b[3]>ty-h);if(!hit)break;ty-=h*1.15}
    put.push([x0,ty-h,w,h*1.2]);
    ctx.fillStyle='rgba(8,10,20,.88)';ctx.fillRect(x0,ty-h*.88,w,h);
    ctx.strokeStyle=col;ctx.lineWidth=1.5*px;ctx.strokeRect(x0,ty-h*.88,w,h);
    ctx.fillStyle=col; // bold: the face drawn twice, a hair apart
    ctx.fillText(txt,cx,ty-h*.1);ctx.fillText(txt,cx+.7*px,ty-h*.1);
    ctx.restore()}}
