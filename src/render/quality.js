// The effects switch (#979): full, or lean for a slow machine. Lean keeps the hour's colour, the cast shadows and the lights (one small map and two blits) and drops
// what is drawn on top of them: the air, the figures' own shadows, the sky on the water and whatever motion joins them. ?fx=lean in the address, or Settings; kept in this browser.
const KEY='eldmoor.fx';
const read=()=>{try{const q=new URLSearchParams(location.search).get('fx');return (q||localStorage.getItem(KEY))==='lean'?false:true}catch(_){return true}};
export const FX={full:read()};
export function setFx(full){FX.full=!!full;try{localStorage.setItem(KEY,full?'full':'lean')}catch(_){}}
