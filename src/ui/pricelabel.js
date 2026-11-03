// The price beside a model in the pickers (#677): "gpt-6-luna · $0.10 / $0.50 per 1M" from the relay's providers.<name>.prices,
// "price unknown" where the provider reports prices and the model has no row, nothing for a provider without prices (local, HF).
const money=n=>'$'+(n>=1?String(+n.toFixed(2)):n.toFixed(2));
export function priceLabel(st,m){const P=st&&st.prices;if(!P||typeof P!=='object')return '';const p=P[m];return p?' · '+money(p.in)+' / '+money(p.out)+' per 1M':' · price unknown'}
