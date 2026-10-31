// Transient visual effects produced by the sim and consumed by the renderer.
import {rnd} from '../core/rng.js';
import {S} from './state.js';

export const pop=(x,y,txt,col)=>S.fx.push({type:'txt',x:x+(rnd()-.5)*.4,y:y-1,txt,col,life:1});
export const bolt=(a,b,col)=>S.fx.push({type:'bolt',x0:a.x,y0:a.y-.5,x1:b.x,y1:b.y-.4,col,life:.25});
export function updFx(dt){for(let i=S.fx.length-1;i>=0;i--){const p=S.fx[i];p.life-=dt*(p.type==='txt'?.9:1);if(p.type==='txt')p.y-=dt*1.2;if(p.life<=0)S.fx.splice(i,1)}}
