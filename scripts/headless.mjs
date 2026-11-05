// Headless balance harness: runs the real simulation core in Node (no DOM),
// fast-forwards N in-game minutes of real time at 1x, and prints a summary.
// Usage: npm run sim            (60 minutes)
//        npm run sim -- 120     (120 minutes)
import {init, step, S, spatialStats} from '../src/sim/index.js';
import {outpostsView} from '../src/sim/outposts.js';
import {pathStats} from '../src/sim/path.js';
import * as SLT from '../src/sim/company.js'; // the slotted company (#588)

const minutes = Number(process.argv[2] || 60);
init();
const frames = minutes * 60 * 60;
for (let i = 0; i < frames; i++) step(1 / 60);

// ---- report ----
const alive = S.agents.filter((a) => a.state !== 'dead');
const lv = alive.map((a) => a.lvl).sort((a, b) => b - a);
console.log(`\nEldmoor headless run: ${minutes} min at 1x\n`);
console.log('Living heroes:', alive.length, '| levels:', lv.join(' '));
console.log('Fallen:', S.facStats.map((f) => f.fallen).join(' / '), '(Concord / Warband)');
{const D=S.downStats||{downed:0,stable:0,revived:0,rose:0,woke:0,stabilized:0,died:0,why:{}};const w=D.why||{};console.log('Downed (#626): '+D.downed+' downings | up again '+(D.revived+D.rose+D.woke)+' (revived '+D.revived+', rose on a 20 '+D.rose+', woke stable '+D.woke+') | stabilized by a friend '+D.stabilized+', stable '+D.stable+' | died while down '+D.died+' (failed saves '+(w.fails||0)+', alone '+(w.alone||0)+') | slain outright: past full health '+(w.massive||0));const Mc=S.mercyStats||{};console.log('PvP mercy (#657): finished '+(Mc.finished||0)+' | spared '+(Mc.spared||0)+' | bled out '+(Mc.bled||0)+' | life-debts repaid '+(Mc.repaid||0)+' | blows held by a debt '+(Mc.held||0))}
{const W=S.woundStats||{};console.log('Wounds (#656): '+(W.taken||0)+' taken | closed by the days '+(W.closed||0)+' | tended by a companion '+(W.tended||0)+' | chapel priest '+(W.priest||0)+' for '+(W.gold||0)+'g')}
console.log('Honor:', S.facStats.map((f) => f.honor).join(' / '), '| Boss kills:', S.facStats.map((f) => f.bosses).join(' / '));
console.log('Guilds (clears/wipes/bosses):', S.GUILDS.filter((g) => !g.retired).map((g) => `${g.tag} ${g.clears}/${g.wipes}/${g.bosses}`).join('  '), '| retired', S.GUILDS.filter((g) => g.retired).length, '| unguilded alive', alive.filter((a) => !a.guild).length, '| events', JSON.stringify(S.guildStats || {}));
console.log('Rivalries:', JSON.stringify(S.rivals ? S.rivals.stats : {}), '| active', S.rivals ? Object.keys(S.rivals.on).map((k) => k.split(':').map((id) => (S.GUILDS.find((g) => g.id === Number(id)) || {}).tag).join(' vs ')).join(', ') || 'none' : 'none');
console.log('Guild focus:', JSON.stringify(S.focusStats || {}), '| now', S.GUILDS.filter((g) => !g.retired).map((g) => `${g.tag} ${g.focus || 'open'}`).join(', ') || 'none');
{const F=SLT.slotted();console.log('Fellowship:', F ? `${F.name} (${['Concord','Warband'][F.fac]}) | members ${F.ids.map((id) => S.agents.find((a) => a.id === id)).filter(Boolean).map((a) => `${a.name} L${a.lvl} ${a.cls}`).join(', ')} | fallen ${F.past.length}` : 'none')}
{const L=(S.companies||[]).map((c)=>c.crawl).filter(Boolean),C=L.length?L.reduce((t,x)=>{for(const k of ['runs','clears','driven','withdrawn','wipes','deaths','rooms','scenes','downs'])t[k]=(t[k]||0)+(x[k]||0);return t},{}):null;if(C)console.log(`Fellowship Crypt crawl (room by room): ${C.runs} runs | ${C.clears} cleared, ${C.driven} driven back, ${C.withdrawn} withdrew, ${C.wipes} wiped | ${C.deaths} fell, ${C.downs||0} downed | rooms won ${C.rooms} | scenes ${C.scenes||0}${L.length>1?` | across ${L.length} companies`:''}`)}
console.log('Outposts:',outpostsView().map(o=>o.name+' '+(o.held_by||'unheld')+' ('+o.control+', flipped '+o.flips+')').join(' | '),'| flips total',(S.outposts&&S.outposts.flips)||0);
{const t=S.traffic;if(t){const s=t.stats;console.log(`Road traffic: ${s.departed} set out, ${s.arrived} arrived, ${t.list.length} on the road | beset ${s.beset} (rescued ${s.rescued}, went on ${s.freed}, lost ${s.lost}, staged ${s.staged}) | goods to market ${s.goods} | guards ${t.guards.filter(g=>g.on).length}/${t.guards.length} on watch`)}}
console.log('Kragmaw alive:', S.boss.alive, '| hp', Math.round(S.boss.hp));
console.log('Top 5:', alive.sort((a, b) => b.lvl - a.lvl).slice(0, 5).map((a) => `${a.name} L${a.lvl} ${a.cls}`).join(', '));
console.log('Recent deaths:', S.fallen.slice(0, 8).map((f) => `${f.name} L${f.lvl} (${f.cause})`).join('; '));
{const d=S.dmStats;if(d){const by=Object.keys(d.started).map((k)=>`${k} ${d.started[k]}/${d.done[k]||0}`).join(' ');console.log(`Adventures (started/done): ${by} | outcomes ${d.outcome.success}/${d.outcome.partial}/${d.outcome.failure} (success/partial/failure) | hooks ${JSON.stringify(d.hooks)} | told ${d.told}, ${d.lines} lines`);console.log(`Bounties (gate captain, #67): posted ${d.bounties||0}, taken ${d.bountiesTaken||0}, turned in ${d.bountiesDone||0} | departures ${JSON.stringify(d.depart)}`)}}
{const L=S.levers;if(L){const pl=Object.entries(L.stats.pulled).map(([k,n])=>k+' '+n).join(', '),rj=Object.entries(L.stats.rejected).map(([k,n])=>k+' '+n).join(', ');console.log(`DM levers pulled: ${pl||'none'} | rejected: ${rj||'none'} | now: ${L.active.length} active, ${(S.places||[]).length} places, ${(S.wanderers||[]).length} wanderers, ${(S.marks||[]).length} marks, ${(S.conditions||[]).length} conditions`)}}
{const v=S.invStats,L=alive.filter((a)=>a.inv),n=(a,k)=>a.inv.list.reduce((t,e)=>t+(e.kind==='use'&&/Draught|Tonic/.test(e.id)?e.n:0),0);if(v)console.log(`Packs: ${L.length} heroes, ${(L.reduce((t,a)=>t+n(a),0)/Math.max(1,L.length)).toFixed(1)} potions each on average, ${(L.reduce((t,a)=>t+a.inv.list.length,0)/Math.max(1,L.length)).toFixed(1)} slots used | ${Object.entries(v).map(([k,x])=>k+' '+x).join(', ')}`)}
{const g=S.gatherStats,c=S.craftStats;if(g||c)console.log(`Professions: gathered ${g?g.got+'/'+g.tries+' tries, '+g.units+' units':'none'} | crafted ${c?c.made+' ('+Object.entries(c.byProf).map(([k,x])=>k+' '+x).join(', ')+'), fees '+c.fees+'g, crafters learned '+c.learned+', meals eaten '+c.meals+', at camp '+c.camp:'none'}`)}
{const t=S.tradeStats;if(t){const av=S.agents.filter(h=>h.state!=="dead"),g=av.reduce((s,h)=>s+h.gold,0)/Math.max(1,av.length);console.log(`Trades (#14): listed ${t.listed}, sold ${t.sold} (gear ${t.gear}, goods ${t.goods}), lapsed ${t.lapsed}, ${t.gold}g traded, fees ${t.fees}g | open ${(S.listings||[]).length} | avg gold ${Math.round(g)}`)}}
console.log(`Paths (#794): ${pathStats.plans} plans, ${(pathStats.plans / (frames / 60)).toFixed(1)} a second | ${(pathStats.nodes / Math.max(1, pathStats.plans)).toFixed(0)} nodes a plan, worst ${pathStats.peak} | ${(pathStats.us / Math.max(1, pathStats.plans)).toFixed(0)} us a plan | waited a tick ${pathStats.held} | no way ${pathStats.none}`);
console.log(`Spatial index: ${spatialStats.cells} cells | indexed ${spatialStats.heroes} heroes, ${spatialStats.mobs} mobs | ${(spatialStats.queries / frames).toFixed(1)} queries/step, ${(spatialStats.candidates / Math.max(1, spatialStats.queries)).toFixed(1)} candidates/query`);
