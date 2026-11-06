// The hour's light (#979): one table of keys for the whole day, read by the cast shadows (shadows.js), the light map (lightmap.js)
// and the air (atmos.js). Pure numbers from the game clock and the sky at the camera: nothing here touches the sim, no dice.
//   amb    the ambient the world is multiplied by: warm and low at dawn and dusk, clear at noon, blue at night
//   wash   a thin veil of the low sun laid from the sun's side of the view
//   shade  the colour shadows take (cool by day, violet at sunset, ink at night)
// The sun does not cross the map as it would over a real one. It rises on the right, stands above the top of the map at noon and
// sets on the left, so shadows swing left, down, right: a shadow falling up the screen would hide behind what throws it, and the art
// is lit from above. At night the moon does the same, faintly.
const K=[ // hour, ambient rgb, wash rgb, wash strength, shade rgb
  [0,   74,92,172,  0,0,0,0,            8,10,34],
  [4.6, 74,92,172,  0,0,0,0,            8,10,34],
  [5.5, 128,116,172,120,80,130,.06,     14,12,44],
  [6.3, 238,178,162,255,146,104,.2,     44,20,62],
  [7.6, 255,226,196,255,190,130,.09,    30,28,70],
  [9.6, 255,246,232,255,226,180,.02,    20,30,62],
  [12,  255,255,252,0,0,0,0,            16,28,58],
  [16,  255,246,226,255,220,160,.02,    20,28,60],
  [18,  255,224,172,255,176,96,.12,     38,24,66],
  [19.2,255,186,120,255,136,66,.26,     52,18,66],
  [20,  204,130,146,214,88,92,.14,      30,12,54],
  [20.8,112,102,168,90,60,130,.04,      12,10,42],
  [21.6,74,92,172,  0,0,0,0,            8,10,34],
  [24,  74,92,172,  0,0,0,0,            8,10,34]];
const sm=t=>t*t*(3-2*t),mix=(a,b,t)=>a+(b-a)*t,clamp01=v=>v<0?0:v>1?1:v;
const RISE=5.8,SET=19.9;
// How the weather at the camera dims the sun: 0 clear, 1 no shadows at all.
export const CLOUD={clear:0,drizzle:.5,rain:.72,fog:.62,ashfall:.5,ashstorm:.85,snow:.5,squall:.9};
export const G={hour:12,dk:0,amb:[255,255,255],wash:[0,0,0],washA:0,shade:[16,28,58],sx:0,sy:1,sunA:.4,len:.6,cloud:0,up:true};
const SHADOW_A=.36,MOON_A=.14,LEN_MAX=2.6;
// The darkness 0 to .55 the older lights are scaled by: rising 18-21, falling 5-7.
const darkness=h=>h>=21||h<5?.55:h>=18?(h-18)/3*.55:h<7?(7-h)/2*.55:0;
// Fill G for the hour h (0..24) under cloud 0..1.
export function gradeAt(h,cloud){let i=0;while(i<K.length-2&&h>=K[i+1][0])i++;
  const a=K[i],b=K[i+1],t=sm(clamp01((h-a[0])/(b[0]-a[0]))),m=j=>mix(a[j],b[j],t);
  // An overcast sky scatters the low sun: the more the hour's colour is the sun's own (not the moon's blue), the more cloud turns it to a cool grey, so fog at dusk is not pink.
  const am=G.amb,hi=Math.max(m(1),m(2),m(3)),lo=Math.min(m(1),m(2),m(3)),grey=(m(1)+m(2)+m(3))/3,sunTint=clamp01((1-lo/hi)*3)*clamp01(1-(m(3)-m(1))/m(3)*2.5),veil=Math.min(1,cloud*(.75+.6*sunTint));
  for(let j=0;j<3;j++)am[j]=mix(m(1+j),grey*(.86+.06*j+.04*sunTint*(j-1)),veil)*(1-cloud*.2);
  for(let j=0;j<3;j++){G.wash[j]=m(4+j);G.shade[j]=m(8+j)}
  G.washA=m(7)*(1-cloud*.9);G.hour=h;G.dk=darkness(h);G.cloud=cloud;
  const day=h>=RISE&&h<=SET,u=day?(h-RISE)/(SET-RISE):((h+(h<RISE?24:0))-SET)/(24-SET+RISE),e=Math.sin(Math.PI*u);
  G.up=day;let sx=-Math.cos(Math.PI*u)+.22,sy=.26+.42*e;
  if(day){G.len=Math.min(LEN_MAX,.62/Math.max(.08,e));G.sunA=SHADOW_A*(1.38-.38*e)*sm(clamp01(e/.13))*(1-cloud*.92)}
  else{G.len=1.1;G.sunA=MOON_A*sm(clamp01(e/.3))*(1-cloud)}
  // a unit direction, the length apart: at dawn and dusk the shadow runs nearly along the row, at noon down the screen
  const n=Math.hypot(sx,sy);G.sx=sx/n;G.sy=sy/n;return G}
