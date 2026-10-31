// Shared random helpers plus deterministic hashing and value noise.
// Pure functions only: no DOM, no game state.
export const rnd=Math.random, ri=(a,b)=>a+Math.floor(rnd()*(b-a+1)), clamp=(v,a,b)=>v<a?a:v>b?b:v;
export const pickA=a=>a[Math.floor(rnd()*a.length)];
export function hash(x,y,s){let h=(x*374761393+y*668265263+s*982451653)|0;h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296}
export function vnoise(x,y,s){const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi,u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
  const a=hash(xi,yi,s),b=hash(xi+1,yi,s),c=hash(xi,yi+1,s),d=hash(xi+1,yi+1,s);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v}
export const fbm=(x,y,s)=>vnoise(x/6,y/6,s)*.6+vnoise(x/3,y/3,s+7)*.3+vnoise(x/1.5,y/1.5,s+13)*.1;
