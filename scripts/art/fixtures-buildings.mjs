// Stand-ins for what a model answers to a building prompt (#763), drawn in code at the model's 1024 px with its ~8 px pixel
// grid, for artcheck, the mock Hugging Face server and art:preview trials. Never written under assets/.
//   flatBuilding(flat, aspect): what the building recipe asks for: a top-down three-quarter house, the roof the biggest
//     shape (two thirds), a short front wall with one door, flat shading in the flat palette (src/render/palette.js FLAT,
//     passed in: this module imports nothing), a thick dark outline, on white. It passes the style gate.
//   painterlyFacade(aspect): the first batch's failure: a front elevation (a facade seen from the street) in a dozen close
//     greys with stone courses, mullioned windows and soft shading, no outline. Sampled down it is speckle, and the gate
//     refuses it.
// aspect = [w, h] of the footprint (the manifest's size at a tier). Deterministic (an integer hash, never Math.random).
const hh=(x,y,s)=>{let h=(Math.imul(x|0,374761393)+Math.imul(y|0,668265263)+Math.imul(s|0,2147483647))|0;h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296};
const rgb=c=>[parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16)];
const SIZE=1024,BLOCK=8;
// The subject's box inside the 1024 px image: the aspect's shape, 80% of the image on its long side, centred.
function frame([w,h]){const k=SIZE*.8/Math.max(w,h),W=Math.round(w*k/BLOCK)*BLOCK,H=Math.round(h*k/BLOCK)*BLOCK;return {x0:Math.round((SIZE-W)/2/BLOCK)*BLOCK,y0:Math.round((SIZE-H)/2/BLOCK)*BLOCK,W,H}} // on the model's grid
// Paint cell colours (one per 8 px block, null = background) into the image with soft block edges and a little noise.
function paint(cell,cols,rows,{x0,y0},seed){const d=new Uint8Array(SIZE*SIZE*4).fill(255);
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){const cx=Math.floor((x-x0)/BLOCK),cy=Math.floor((y-y0)/BLOCK);
    if(cx<0||cy<0||cx>=cols||cy>=rows)continue;const c=cell(cx,cy);if(!c)continue;
    const fx=(x-x0)%BLOCK,fy=(y-y0)%BLOCK,edge=(fx===0||fy===0)?.94:1,n=(hh(x,y,seed)-.5)*6,o=(y*SIZE+x)*4;
    for(let k=0;k<3;k++)d[o+k]=Math.max(0,Math.min(255,Math.round(c[k]*edge+n)))}
  return {w:SIZE,h:SIZE,data:d}}

export function flatBuilding(flat,aspect=[96,64],seed=1){const f=frame(aspect),cols=f.W/BLOCK,rows=f.H/BLOCK;
  const R=flat.roof.map(rgb),Wl=flat.wall.map(rgb),L=rgb(flat.line),D=rgb(flat.door);
  const roofH=Math.round(rows*.66),ridge=Math.round(roofH*.45),door=[Math.floor(cols/2)-1,Math.floor(cols/2)+1];
  return paint((x,y)=>{if(x===0||y===0||x===cols-1||y===rows-1)return L; // the thick outline (one model pixel)
    if(y<roofH){if(y===roofH-1)return R[2];if(y===ridge)return R[2];return y<ridge?(x<cols*.55?R[0]:R[1]):(x<cols*.55?R[1]:R[2])} // two roof faces, lit top left
    if(y===roofH)return L;if(x>=door[0]&&x<door[1]&&y>rows-1-Math.max(2,Math.round(rows*.16)))return D;
    const wy=roofH+2;if(y===wy&&(x===Math.round(cols*.2)||x===Math.round(cols*.8)))return L; // two small windows
    return x>cols*.78?Wl[1]:Wl[0]},cols,rows,f,seed)}

export function painterlyFacade(aspect=[96,64],seed=1){const f=frame(aspect),cols=f.W/BLOCK,rows=f.H/BLOCK;
  return paint((x,y)=>{const sp=Math.round(rows*.35),mid=cols/2;
    if(y<sp&&Math.abs(x+.5-mid)>(y+1)/sp*cols*.18)return null; // a spire straight on, not a roof from above
    const course=y%2===0,win=y>sp+1&&y<rows-2&&(x%4===1||x%4===2)&&y%3!==0,shade=.55+.45*(1-y/rows)*(1-Math.abs(x-mid)/cols);
    const g=(course?150:175)*shade+(hh(x,y,seed)-.5)*70,b=g+(hh(x,y,seed+1)-.5)*30;
    if(win)return [g*.45,g*.5,b*.7];return [g,g*.98,b]},cols,rows,f,seed)}
