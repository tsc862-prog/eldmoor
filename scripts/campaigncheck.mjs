// Campaign seed check: the parser, the seed on a new world, once only, the caps, older saves, dm_status.
import {readFileSync} from 'node:fs';
import {init, S, snapshot, restore, dmAct, provideCampaigns, parseCampaign} from '../src/sim/index.js';
import {WORLD_ID} from '../src/world/map.js';
import {loadCampaigns} from './campaign-files.mjs';
import {NOTE_SECTIONS} from '../src/data/dm-tools.js';
let fail = 0; const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
const md = readFileSync(new URL('../docs/campaigns/_test.md', import.meta.url), 'utf8');
console.log('\nEldmoor campaigncheck\n');
const p = parseCampaign(md);
ok(p.threads.length === 2 && p.characters.length === 1 && p.secrets.length === 1 && p.plans.length === 2, 'sections parsed, unknown ignored');
ok(p.plans[0].pin && p.plans[0].title === 'The Test Premise' && p.plans[0].tags.join() === 'premise,test', 'premise first, pinned, tags read');
ok(p.threads[0].text.includes('continuation') && !/tags/.test(p.threads[0].text) && p.threads[0].tags.join() === 'thread,one', 'continuation line joined, tags cut from text');
const long = parseCampaign('## Plans\n- **' + 'T'.repeat(90) + '**: ' + 'x'.repeat(900) + '\n');
ok(long.plans[0].title.length === 60 && long.plans[0].text.length === 550, 'title cut at 60, text at 550');
ok(JSON.stringify(parseCampaign('')) === JSON.stringify({threads: [], characters: [], plans: [], secrets: []}) && parseCampaign('## Premise\nJust a paragraph.').plans[0].text === 'Just a paragraph.', 'empty and paragraph-premise input are tolerated');

provideCampaigns({});
init({fellowship: false});
ok(!S.dmAgent, 'no campaign for this world: no DM state, no error');
provideCampaigns({other: md}); init({fellowship: false}); ok(!S.dmAgent, 'a campaign for another world is not used');

provideCampaigns({[WORLD_ID]: md});
init({fellowship: false});
const D = S.dmAgent, all = NOTE_SECTIONS.flatMap(k => D.notes[k]);
ok(D && all.length === 6 && all.every(n => n.from === 'campaign'), 'a new world seeds the DM notes, marked from campaign');
ok(D.notes.plans[0].pin && D.notes.plans[0].title === 'The Test Premise', 'premise pinned in plans');
const seq = D.seq; dmAct('dm_status'); 
const st = dmAct('dm_status', {}); // seat closed: answers nothing
const {setDmSeat} = await import('../src/sim/index.js'); setDmSeat(true);
const s2 = dmAct('dm_status', {});
ok(s2.ok && s2.campaign.loaded && s2.campaign.sections.threads === 2 && s2.campaign.sections.secrets === 1, 'dm_status shows campaign {loaded, sections}');
ok(S.dmAgent.seq === seq, 'opening the seat does not seed again');
const snap = JSON.parse(JSON.stringify(snapshot())); restore(snap);
ok(NOTE_SECTIONS.flatMap(k => S.dmAgent.notes[k]).length === 6, 'a save round trip keeps the notes and does not seed twice');
// deleting every note does not bring the seed back
for (const k of NOTE_SECTIONS) S.dmAgent.notes[k].length = 0;
const s3 = JSON.parse(JSON.stringify(snapshot())); restore(s3);
ok(NOTE_SECTIONS.flatMap(k => S.dmAgent.notes[k]).length === 0, 'cleared notes stay cleared (seeded once)');
// an older save: no campaign flag, empty notes -> seeded on load; with notes -> left alone
const old = JSON.parse(JSON.stringify(snapshot())); delete old.dmAgent.campaign; restore(old);
ok(NOTE_SECTIONS.flatMap(k => S.dmAgent.notes[k]).length === 6, 'an older save with empty notes is seeded on load');
const old2 = JSON.parse(JSON.stringify(snapshot())); delete old2.dmAgent.campaign; old2.dmAgent.notes.threads = [old2.dmAgent.notes.threads[0]]; old2.dmAgent.notes.plans = []; old2.dmAgent.notes.characters = []; old2.dmAgent.notes.secrets = [];
restore(old2);
ok(NOTE_SECTIONS.flatMap(k => S.dmAgent.notes[k]).length === 1, 'an older save with notes is not seeded retroactively');
// caps
const big = '## Threads\n' + Array.from({length: 80}, (_, i) => `- **T${i}**: text ${i}`).join('\n') + '\n';
provideCampaigns({[WORLD_ID]: big}); delete S.dmAgent; init({fellowship: false});
ok(S.dmAgent.notes.threads.length === 50 && S.dmAgent.campaign.sections.threads === 50, 'a section is seeded up to its cap of 50');
// the real files, when present
const real = loadCampaigns();
for (const [w, t] of Object.entries(real)) {const c = parseCampaign(t); const n = Object.values(c).reduce((a, l) => a + l.length, 0); ok(n >= 5, `docs/campaigns/${w}.md parses (${n} notes)`)}
provideCampaigns({});
console.log(fail ? `\n${fail} check(s) FAILED` : '\nall campaign checks passed'); process.exit(fail ? 1 : 0);
