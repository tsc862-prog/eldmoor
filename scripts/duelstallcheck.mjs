// #1062: two healers in a duel end it; a returning leader near a foe does not swing back and forth.
import {init,S} from '../src/sim/index.js';
import {updAgent,DUEL_MAX} from '../src/sim/heroes.js';
import {steerClear,STEER_MAX} from '../src/sim/party.js';
import {rebuild} from '../src/sim/spatial.js';
let fail=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)fail++};
init({fellowship:false});
const heal=cls=>S.agents.find(h=>h.cls===cls&&h.company==null&&!h.party);
const A=S.agents[0],B=S.agents[1];
for(const [x,y,f] of [[A,40,1],[B,41,2]]){x.cls='Wildspeaker';x.lvl=12;x.fac=f;x.x=y;x.y=25;x.path=null;x.party=null;x.company=null}
S.agents.forEach(h=>{if(h!==A&&h!==B){h.state='dead';h.hidden=true}});
A.hp=B.hp=1e5;A.state=B.state='duel';A.target=B;B.target=A;
// make every blow trivial so each outheals the other
let ended=-1;for(let i=0;i<60*600;i++){S.gameMin+=1/10;A.hp=Math.min(A.hp,1e9);updAgent(A,1/60);updAgent(B,1/60);
  A.hp=Math.max(A.hp,1);B.hp=Math.max(B.hp,1);if(A.state!=='duel'){ended=i/60;break}}
ok(ended>0&&ended<DUEL_MAX+5,'a duel the healers cannot decide ends as a draw ('+ended.toFixed(1)+' s, cap '+DUEL_MAX+')');
ok(A.state!=='duel'&&B.state!=='duel'&&!A.target&&!B.target,'both are free');
// steerClear: a leader with a foe parked 3 tiles away stops detouring
const L=S.agents[2];L.state='dead';L.hidden=false;L.state='return';L.hp=L.hp||100;L.x=30;L.y=25;L.fac=1;L.party={leader:L,mem:[L]};
const F=A;F.fac=2;F.state='hunt';F.x=33;F.y=25;F.hidden=false;rebuild();let steered=0,last=false;
for(let i=0;i<60*40;i++){const r=steerClear(L,1/60,()=>false);if(r)steered++;last=r}
ok(steered<=(STEER_MAX+1)*60&&!last,'a leader detours at most '+STEER_MAX+' s round a foe that stays ('+(steered/60).toFixed(1)+' s)');
process.exit(fail?1:0);
