// Situations for toolfuzz (infra): the states a tool needs before its success path can run (a fight, an offer, an auction
// listing, a hire, a duel challenge, a downed companion, a meeting plan, an open vote, a raid muster, a camp, a downed enemy,
// a DM call waiting) and the calls that go with them. Imported by the child process of scripts/toolfuzz.mjs after
// ELDMOOR_WORLD is set; `env` hands over the helpers the fuzzer built (build, mark, secs, placeInField, ...).
//
//   states   extra STATES entries ({name, make, direct?, after?}); `make` builds the situation through the game's own tools
//            where it can and returns the hero the tools are called as.
//   hero(c)  {tool: () => [call]}  live recipes for the hero tools, read from the state at the moment of the call
//   dm(c)    the same for the DM tools
// A call is an argument object, or {pre: [[tool, args], ...], args: object | (results) => object}: pre calls run first (a
// hero tool as the caller, or "dm:name" as the DM), `as` names another hero to call as. Recipes only choose arguments; every
// call still goes through playerAct / dmAct, so the game's own refusals are what answers.

export async function makeCases(env) {
  const {RL, DR, SIM, SLT, INV, PROF, MAP, T, mark, build, secs, run, placeInField, NONE, fell, MATERIALS} = env;
  const {S, playerAct, dmAct, maxHp} = SIM;
  const MK = await import('../src/sim/market.js');
  const OFF = await import('../src/sim/offers.js');
  const CAMP = await import('../src/sim/camp.js');
  const {makeItem} = await import('../src/sim/gear.js');
  const {ABIL_IDS} = await import('../src/sim/abilities.js');
  const LORE = await import('../src/sim/lore.js');
  const SP = await import('../src/sim/spatial.js'); // positions set by hand are not in the index until it is rebuilt

  const members = () => SLT.slotHeroes(SLT.slotted());
  const heroesOf = () => S.agents.filter(a => a.kind === 'hero' && a.state !== 'dead');
  const alive = h => S.agents.find(a => a.id === h.id) || h;
  const hall = h => MAP.CITY.find(c => c.fac === h.fac) || MAP.CITY[0];
  const toTown = (list, h) => {const c = hall(h); list.forEach((x, i) => {x.x = c.gate.x + i * .4; x.y = c.gate.y; x.state = 'town'; x.dest = null; x.pq = []; x.hidden = false})};
  const others = h => heroesOf().filter(x => x.id !== h.id);
  const nearest = h => others(h).sort((a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y))[0];
  const call = (h, t, a) => { try {return playerAct(h.id, t, a || {}) || {}} catch {return {}} };
  const dm = (t, a) => { try {return dmAct(t, a || {}) || {}} catch {return {}} };
  const callId = r => { const v = r && r.call; return v && typeof v === 'object' ? (v.call != null ? v.call : v.id) : v }; // table_call / ruling_call / companion_call answer {call: {call: n, ...}}
  const first = (L, f) => (L || []).find(f);
  const why = 'Fuzz: a reason in one sentence.';
  const gear = (h, slot = 'head') => { try {return makeItem(h.cls, slot, Math.max(1, h.lvl), 0, {})} catch {return null} };
  const poolOther = (h, n = 1) => { // background heroes of h's faction, made agent-played, brought next to h
    const L = S.agents.filter(a => a.kind === 'hero' && a.state !== 'dead' && a.id !== h.id && a.fac === h.fac && !SLT.inSlots(a)).slice(0, n);
    L.forEach((x, i) => {mark(x); x.x = h.x + .6 + i * .3; x.y = h.y; x.state = h.state === 'camp' ? 'hunt' : (h.state === 'town' ? 'town' : 'hunt'); x.dest = null; x.pq = []; x.hidden = false; x.target = null; if (x.party) {/* leave any party */}});
    return L;
  };

  const withBlade = h => { // a sellsword placed and the company walked over to stand beside them
    const r = dm('place_person', {role: 'sellsword', near: h.name, name: 'Fuzzblade', want: 'coin', reason: why}), at = r.at || (r.effect && r.effect.at);
    if (at) members().forEach((x, i) => {x.x = at.x + .5 + i * .2; x.y = at.y + .5; x.dest = null; x.pq = []});
    return r;
  };
  // ------------------------------------------------------------ states
  const states = [
    {name: 'fight', make: () => { // a live fight: a creature engaged, nothing paused
      const h = build(); secs(10); const p = placeInField(h);
      const m = S.mobs.find(x => x.alive && !x.gone && !x.elite);
      if (m) {m.x = p.x + 1; m.y = p.y; m.target = h; h.target = m; h.state = 'fight'; m.hp = Math.max(m.hp, 40)}
      return h}},
    {name: 'offer', make: () => { // a solo hero holds a company invitation from another agent hero
      const h = build(); secs(20); const A = S.agents.find(a => a.kind === 'hero' && !a.player && a.state !== 'dead' && a.fac === h.fac && a !== h);
      const B = S.agents.find(a => a.kind === 'hero' && !a.player && a.state !== 'dead' && a.fac === h.fac && a !== h && a !== A);
      mark(A); mark(B); toTown([A, B], h); B.x = A.x + 1; A.target = B.target = null; // two idle heroes at the gate: nobody is in a fight
      SP.rebuild(); const r = call(B, 'invite', {hero_id: A.id, text: 'Ride with us, friend.'}); if (!OFF.offersTo(A).length) throw new Error('fuzz setup: no offer made: ' + r.error); return A}},
    {name: 'listing', only: ('auction_list auction_buy auction_cancel auction_browse sell give equip send_courier bequeath inventory').split(' '), make: () => { // in town with goods and gear, own listing and another hero's on the auction house
      const h = build(); secs(20); h.lvl = 12; h.gold = 3000; toTown(members(), h);
      for (const id of Object.keys(MATERIALS || {}).slice(0, 3)) INV.addGood(h, id, 4);
      const g = gear(h, 'chest'); if (g) INV.addGear(h, g); INV.addUse(h, 'Linen Bandage', 2); INV.addUse(h, 'Redroot Draught', 2);
      const inv = call(h, 'inventory').items || [], gi = inv.find(x => x.kind === 'good');
      if (gi) call(h, 'auction_list', {index: gi.index, n: 2, price: 3});
      const o = members()[1], mat = Object.keys(MATERIALS || {})[0];
      if (o && mat) try {MK.listFor(o, {good: mat, n: 3}, 2)} catch {}
      return h}},
    {name: 'hire', only: ('hire dismiss talk npcs npc_offer').split(' '), make: () => { // a sellsword at the hero's elbow, coin in the purse
      const h = build(); secs(20); h.gold = 500; toTown(members(), h);
      withBlade(h); return h}},
    {name: 'hired', make: () => {
      const h = build(); secs(20); h.gold = 500; toTown(members(), h);
      withBlade(h); call(h, 'hire', {npc: 'Fuzzblade', days: 2}); return h}},
    {name: 'duel', make: () => { // an honour duel offered to the hero by a neighbour of its faction
      const h = build(); secs(20); const A = S.agents.find(a => a.kind === 'hero' && !a.player && a.state !== 'dead' && a.fac === h.fac && a !== h && !SLT.inSlots(a));
      const B = S.agents.find(a => a.kind === 'hero' && !a.player && a.state !== 'dead' && a.fac === h.fac && a !== h && a !== A && !SLT.inSlots(a));
      mark(A); mark(B); for (const x of [A, B]) {x.lvl = 6; x.hp = maxHp(x); x.state = 'hunt'; x.dest = null; x.pq = []; x.hidden = false; x.target = null}
      B.x = A.x + 1.5; B.y = A.y; for (const m of S.mobs) if (Math.hypot(m.x - A.x, m.y - A.y) < 14) {m.x += 30; m.target = null} SP.rebuild(); const r = call(B, 'challenge', {hero: A.name, to: 'first blood', text: 'Meet me, then.'}); if (!r.ok) throw new Error('fuzz setup: no challenge: ' + r.error); return A}},
    {name: 'friend-down', make: () => { // a companion at zero HP, the caller healthy beside them, potions in the pack
      const h = build(); secs(10); const M = members(), o = M[1];
      INV.addUse(h, 'Redroot Draught', 2); INV.addUse(h, 'Linen Bandage', 2); o.x = h.x + .6; o.y = h.y; fell(o); SP.rebuild(); return h}},
    {name: 'enemy-down', only: ('finish spare fight stabilize tend challenge').split(' '), make: () => { // an enemy-faction hero lying downed in reach
      const h = build(); secs(10); placeInField(h);
      const e = S.agents.find(a => a.kind === 'hero' && !a.player && a.state !== 'dead' && a.fac !== h.fac);
      if (e) {e.x = h.x + 1; e.y = h.y; fell(e)} SP.rebuild(); return h}},
    {name: 'meeting', only: ('leave_party follow send_courier lead_to propose companions').split(' '), make: () => { // a member left the company with a meeting plan; the others hold it
      const h = build(); secs(10); placeInField(h); const M = members();
      call(M[2], 'leave_party', {where: MAP.CITY[0].name, when_hours: 4}); return M[1]}},
    {name: 'vote', only: ('vote propose party_say').split(' '), make: () => { // the leader put a decision to the company: this member votes
      const h = build(); secs(10); placeInField(h); const M = members(); T.TABLE.mode = 'off'; RL.setRunnerLinks(() => 'connected'); // Watch mode, and every member has a live runner: the vote stays open for the others
      call(M[0], 'propose', {kind: 'other', details: 'Fuzz: rest here a while?'}); return M[1]}},
    {name: 'camp', make: () => { // the company camped (the leader calls break_camp)
      const h = build(); secs(10); placeInField(h); const M = members();
      const e = CAMP.leaderRest(M[0], 4); if (e) throw new Error('fuzz setup: camp: ' + e); secs(4); return M[0]}},
    {name: 'muster', only: ('go_crypt join_raid propose').split(' '), make: () => { // a solo hero of level 14 with a raid out for Kragmaw
      const h = build(); secs(20); const o = S.agents.find(a => a.kind === 'hero' && !a.player && a.state !== 'dead' && a.fac === h.fac && !SLT.inSlots(a)); mark(o); LORE.learnPlace(o, MAP.CRYPT.name || 'The Sunken Crypt', 'told');
      o.lvl = 14; o.hp = maxHp(o); o.state = 'hunt'; o.dest = null; o.pq = []; S.boss.alive = true; S.raidOn[o.fac] = true; return o}},
    {name: 'gatherer', only: ('gather learn_profession unlearn_profession nodes recipes craft').split(' '), make: () => { // out in the field with two trades
      const h = build(); secs(10); placeInField(h); try {PROF.learn(h, 'herbalism'); PROF.learn(h, 'mining')} catch {} secs(1); return h}},
    {name: 'craftsman', only: ('craft smith equip raise_score choose_specialisation turn_in update_memory forget pin set_gambit move_gambit auction_list sell buy recall remember recipes').split(' '), make: () => { // in town with a craft, its materials, worn gear and a finished bounty
      const h = build(); secs(20); h.lvl = 12; h.gold = 3000; h.hp = maxHp(h); toTown(members(), h);
      try {PROF.learn(h, 'alchemy'); PROF.learn(h, 'smithing'); PROF.gainSkill(h, 'alchemy', 20)} catch {}
      for (const id of Object.keys(MATERIALS || {})) INV.addGood(h, id, 6);
      for (const s of ['main', 'head']) {const g = gear(h, s); if (g) INV.addGear(h, g)}
      for (let i = 0; i < 3; i++) call(h, 'equip', {index: (call(h, 'inventory').items || []).findIndex(x => x.kind === 'gear')});
      const g2 = gear(h, 'feet'); if (g2) INV.addGear(h, g2);
      if (h.quest) h.quest.have = h.quest.need; h.growPending = [{lvl: 10, at: S.gameMin}]; try {INV.addQuest(h, 'Rookscar Toll-Token', null)} catch {}
      call(h, 'remember', {title: 'First note', text: 'Something kept.', tags: ['a']}); call(h, 'remember', {title: 'Second note', text: 'Something else.', tags: ['b']});
      return h}},
    {name: 'staged-pending', only: ('unstage stage_scene dm_status narrate').split(' '), make: () => { // a staged meeting waiting for its cast to reach the company: the DM may still take it back
      const h = build(); secs(10); placeInField(h); DR.setDmAlive(() => true);
      const r = dm('stage_scene', {kind: 'meeting', near: 'fellowship', frame: 'A stranger waits at the road.', cast: {name: 'Fuzz Stranger', role: 'stranger', want: 'a word with the company'}, reason: why}); if (r.ok === false) throw new Error('fuzz setup: stage_scene: ' + r.error); return members()[1]}},
    {name: 'staged-open', also: ['scene_act', 'table_call'], make: () => { // the staged meeting at the table, the DM listening and every member's runner live
      const h = build(); secs(10); placeInField(h); DR.setDmAlive(() => true); RL.setRunnerLinks(() => 'connected');
      const r = dm('stage_scene', {kind: 'meeting', near: 'fellowship', frame: 'A stranger waits at the road.', cast: {name: 'Fuzz Stranger', role: 'stranger', want: 'a word with the company'}, reason: why}); if (r.ok === false) throw new Error('fuzz setup: stage_scene: ' + r.error);
      for (let i = 0; i < 40 && !(S.table && S.table.kind); i++) secs(1); if (!(S.table && S.table.kind)) throw new Error('fuzz setup: the staged scene never opened'); secs(2); return members()[1]}},
    {name: 'ruling', only: ('ruling_answer ruling_call attempt').split(' '), make: () => { // a free action waiting for the DM's ruling
      const h = build(); secs(10); placeInField(h); DR.setDmAlive(() => true); call(h, 'attempt', {what: 'I read the carved door.', how: 'carefully'}); return h}},
    {name: 'companion', only: ('companion_say companion_call').split(' '), make: () => { // a hired companion waiting for the DM's voice
      const h = build(); secs(20); h.gold = 500; toTown(members(), h); DR.setDmAlive(() => true); withBlade(h); call(h, 'hire', {npc: 'Fuzzblade', days: 2});
      for (let i = 0; i < 240 && !callId(dm('companion_call', {})); i++) secs(1); // the companion speaks up at a camp, a fight or an arrival
      return h}}, // (a seed where the companion stays quiet just leaves companion_say to the other seeds)
    {name: 'hurt', only: ('use_item use_ability tend give stabilize').split(' '), make: () => { // the company in the field, everyone at 40% with potions in the pack
      const h = build(); secs(10); placeInField(h); for (const x of members()) x.hp = Math.max(1, Math.round(maxHp(x) * .4));
      INV.addUse(h, 'Redroot Draught', 2); INV.addUse(h, 'Linen Bandage', 2); return h}},
    {name: 'apart', only: ('send_courier party_say lead_to').split(' '), make: () => { // the leader at the home gate, a companion a long way off: a courier is how word reaches them
      const h = build(); secs(20); const M = members(), far = MAP.CITY.find(c => c.fac !== h.fac) || MAP.CITY[MAP.CITY.length - 1];
      toTown([M[0]], h); M[2].x = far.gate.x; M[2].y = far.gate.y; M[2].state = 'hunt'; M[2].dest = null; M[2].pq = []; h.gold = 200; return h}},
    {name: 'solo-town', only: ('take_adventure choose take_quest go_crypt join_raid list_jobs quests focus_quest abandon_quest').split(' '), make: () => { // a lone agent hero at its town gate with the board's jobs posted
      const h = build(); secs(20); const o = S.agents.find(a => a.kind === 'hero' && !a.player && a.state !== 'dead' && a.fac === h.fac && !SLT.inSlots(a)); mark(o);
      o.lvl = 5; o.hp = maxHp(o); o.gold = 100; toTown([o], o); secs(2); return o}},
    {name: 'chapel', only: ('chapel_tend tend').split(' '), make: () => { // a wounded hero at the chapel with gold for the priest
      const h = build(); secs(20); h.gold = 500; const c = hall(h), sp = c.spots && c.spots.chapel; toTown(members(), h);
      if (sp) members().forEach((x, i) => {x.x = sp.x + i * .2; x.y = sp.y + .5});
      h.wounds = [{cause: 'a wolf', day: 1, days: 3, at: S.gameMin}]; return h}},
    {name: 'oathbound', only: ('keep_oath renounce_oath swear_oath quests focus_quest abandon_quest take_quest').split(' '), make: () => { // a hero that swore an oath and took a town job
      const h = build(); secs(20); toTown(members(), h); call(h, 'swear_oath', {text: 'I will keep the road safe.', kind: 'vow'}); call(h, 'swear_oath', {text: 'I will hold the line for the company.'}); return h}},
    {name: 'dm-calls', only: ('take_item give_item retire_person nudge_relation undo dismiss npc_say npc_offer unwhen unwatch start_event create_site when watch').split(' '), make: () => { // the DM has a ruling and a table call waiting, and some people and places of its own
      const h = build(); secs(10); placeInField(h);
      const pp = dm('place_person', {role: 'hermit', near: 'fellowship', name: 'Old Fuzz', want: 'a word', reason: why}); // one a region an hour: the recipes lean on this one
      if (pp.at) members().forEach((x, i) => {x.x = pp.at.x + .5 + i * .2; x.y = pp.at.y + .5; x.dest = null; x.pq = []});
      DR.setDmAlive(() => true); call(h, 'talk', {who: 'Old Fuzz', text: 'Well met, old one. Have you news?'}); return h}},
  ];

  // ------------------------------------------------------------ hero recipes
  const hero = c => {
    const h = alive(c.h), o = () => heroesOf().find(x => x.id !== h.id && x.state === 'downed') || nearest(h), on = () => (o() || {name: 'nobody', id: 0}), pack = () => call(h, 'inventory').items || [];
    const jobs = () => { const j = call(h, 'list_jobs'); return [...(j.jobs || []), ...(j.bounties || []), ...(j.posted || [])] };
    const idOf = x => x && (x.id != null ? x.id : x.job_id);
    const quests = () => { const q = call(h, 'quests'); return [...(q.active || []), ...(q.offered || []), ...(q.held || [])] };
    return {
      use_item: () => pack().flatMap(x => [{index: x.index}, {index: x.index, target_id: on().id}, {index: x.index, target: on().name}]),
      use_ability: () => { const ab = (call(h, 'status').abilities || []).map(s => String(s).split(' [')[0]), m = S.mobs.find(x => x.alive && !x.gone);
        return ab.flatMap(n => [{ability: n}, {ability: n, target_id: on().id}, ...(m ? [{ability: n, target_id: m.id}] : [])])},
      stabilize: () => [{who: on().name}, {hero_id: on().id}, {}],
      tend: () => [{who: on().name}, {hero_id: on().id}, {}],
      chapel_tend: () => [{who: on().name}, {}],
      carry: () => [{who: on().name, to: 'town'}, {hero_id: on().id, to: 'camp'}, {who: on().name, to: 'leader'}],
      raise_score: () => ABIL_IDS.map(s => ({score: s, why: 'Fuzz: it fits how I fight.'})),
      choose_specialisation: () => [{pre: [['choose_specialisation', {path: 'zzz'}]], args: r => {const m = /Yours: ([^.]+)\./.exec(JSON.stringify((r[0] || {}).error || '')); return {path: m ? m[1].split(',')[0].trim() : 'x'}}}],
      give: () => pack().filter(x => x.kind !== 'quest').slice(0, 4).flatMap(x => [{index: x.index, hero_id: on().id, count: 1}, {item: String(x.item).replace(/ x\d+.*$/, '').replace(/ \(.*$/, ''), to: on().name, count: 1}]).concat([{index: 0, to: on().name}]),
      invite: () => [{hero_id: on().id, text: 'Ride with us.'}, {name: on().name}, {hero_id: on().id}],
      accept: () => OFF.offersTo(h).map(x => ({offer_id: x.id})),
      decline: () => OFF.offersTo(h).map(x => ({offer_id: x.id, text: 'Not today.'})),
      leave_party: () => [{where: MAP.CITY[0].name, when_hours: 3}, {}, {for_good: true}],
      follow: () => [{hero_id: on().id, hours: 1}, {name: on().name}, {hero_id: on().id}],
      take_adventure: () => jobs().map(j => ({job_id: idOf(j)})).filter(x => x.job_id != null),
      choose: () => [{option: 'a'}, {option: 'b'}], // a pick waits only mid-adventure, a long walk from any state here
      bequeath: () => [{to: on().name, gold: 1, words: 'Take it and remember me.'}, {to: on().name, item: String((pack()[0] || {}).item || '').replace(/ x\d+.*$/, '') || 'potion'}],
      hire: () => [{pre: [['dm:place_person', {role: 'sellsword', near: h.name, name: 'Fuzzblade', want: 'coin', reason: why}]], args: {npc: 'Fuzzblade', days: 2}}, {npc: 'Fuzzblade', days: 1}],
      dismiss: () => [{npc: 'Fuzzblade'}, {}],
      answer_challenge: () => [{answer: 'accept', text: 'Gladly.'}, {answer: 'decline', text: 'Not today.'}],
      mark: () => [{name: 'Fuzz Cairn', note: 'a cairn of three stones'}],
      unmark: () => [{pre: [['mark', {name: 'Fuzz Cairn', note: 'stones'}]], args: {name: 'Fuzz Cairn'}}],
      search: () => [{}, {what: 'ground'}, ...((call(h, 'look').markers || []).slice(0, 2).map(m => ({what: m.name || m.id})))],
      flee: () => [{}],
      sell: () => pack().map(x => ({index: x.index})),
      auction_list: () => pack().flatMap(x => [{index: x.index, n: 1, price: 4}, {index: x.index}]),
      auction_buy: () => MK.listings().filter(l => l.seller !== h.id).map(l => ({id: l.id, n: 1})),
      auction_cancel: () => MK.listings().filter(l => l.seller === h.id).map(l => ({id: l.id})),
      equip: () => pack().filter(x => x.kind === 'gear').map(x => ({index: x.index})),
      learn_profession: () => ['mining', 'herbalism', 'fishing', 'skinning', 'alchemy', 'smithing', 'cooking'].map(id => ({id})),
      unlearn_profession: () => (call(h, 'recipes').professions || []).map(p => ({id: p.id || p.name})).concat([{id: 'mining'}]),
      gather: () => (call(h, 'nodes').nodes || []).filter(n => n.state === 'ready').slice(0, 4).map(n => ({node: n.node})).concat([{}]),
      smith: () => ['main', 'head', 'chest', 'feet'].flatMap(s => [{item: s, do: 'repair'}, {item: s, do: 'upgrade'}]),
      craft: () => (call(h, 'recipes').recipes || []).flatMap(g => g.recipes || [g]).slice(0, 8).map(r => ({recipe: r.id, count: 1})),
      take_quest: () => quests().map(q => ({id: String(q.id)})).concat(jobs().map(j => ({id: String(idOf(j))}))),
      focus_quest: () => quests().map(q => ({id: String(q.id)})),
      abandon_quest: () => quests().map(q => ({id: String(q.id), reason: 'Fuzz: changed my mind.'})),
      keep_oath: () => [{how: 'I stood by it when it cost me.'}],
      renounce_oath: () => [{reason: 'Fuzz: it no longer fits.'}, {id: 'oath', why: 'Fuzz: it no longer fits.'}],
      turn_in: () => [{}],
      update_memory: () => (call(h, 'recall', {}).memories || call(h, 'recall', {}).notes || []).slice(0, 2).map(m => ({id: m.id, text: 'Changed my mind about it.'})),
      forget: () => (call(h, 'recall', {}).memories || call(h, 'recall', {}).notes || []).slice(0, 1).map(m => ({id: m.id})),
      pin: () => (call(h, 'recall', {}).memories || call(h, 'recall', {}).notes || []).slice(0, 2).map(m => ({id: m.id, on: 'yes'})),
      set_gambit: () => [{when: 'always', then: 'drink_potion'}, {when: 'self_hp_below {pct: 40}', then: 'flee_home', why: 'Fuzz: safer.'}, {when: 'in_town', and: 'night', then: 'follow_order'}],
      move_gambit: () => (call(h, 'gambits').rules || []).slice(0, 3).map(r => ({id: r.id, after: '1'})),
      vote: () => { const C = SLT.companyOf ? SLT.companyOf(h) : null; return ((C && C.props) || (S.props || [])).map(p => ({proposal_id: p.id, vote: 'yes', reason: 'Fuzz: agreed.'})).concat([{proposal_id: 1, vote: 'no'}])},
      break_camp: () => [{}],
      go_crypt: () => [{}, {join: 'yes'}, {force: 'yes'}],
      join_raid: () => [{}],
      enter_site: () => [{pre: [['dm:create_site', {theme: 'den', near: h.name, name: 'The Fuzz Den', reason: why}]], args: {site: 'The Fuzz Den'}}, {}],
      send_courier: () => [{to: on().name, text: 'Come to the gate at dusk.'}],
      finish: () => heroesOf().filter(x => x.state === 'downed').map(x => ({hero: x.name})),
      spare: () => heroesOf().filter(x => x.state === 'downed').map(x => ({hero: x.name})),
      scene_act: () => { // the DM frames the scene first (its voice call), then the member acts
        const id = callId(dm('table_call', {})), v = (T.tableView && T.tableView(h)) || {}, pre = id != null ? [['dm:table_answer', {call: Number(id), text: 'The stranger lifts a hand.'}], ['step', 1]] : null;
        return (v.options || v.legal || []).map(x => ({pre, args: {option: String(x.k || x.key || x.option || x).split(' ')[0], line: 'Fuzz: I hold the line.'}})).concat([{pre, args: {option: 'wait'}}])},
    };
  };

  // ------------------------------------------------------------ DM recipes (calls that need something to exist)
  const dmRecipes = c => {
    const h = alive(c.h), hn = h.name, m1 = (members()[1] || h).name, rem = () => (dm('recall', {}).memories || dm('recall', {}).notes || dm('recall', {}).hits || []);
    return {
      update_memory: () => [{pre: [['dm:remember', {title: 'A DM note', text: 'Something worth keeping.', tags: ['a']}]], args: r => ({id: Number((r[0] || {}).id || (r[0] || {}).memory || 1), text: 'Revised.'})}],
      forget: () => [{pre: [['dm:remember', {title: 'A DM note', text: 'Something.', tags: ['a']}]], args: r => ({id: Number((r[0] || {}).id || (r[0] || {}).memory || 1)})}],
      pin: () => [{pre: [['dm:remember', {title: 'A DM note', text: 'Something.', tags: ['a']}]], args: r => ({id: Number((r[0] || {}).id || (r[0] || {}).memory || 1), on: 'yes'})}],
      take_item: () => [{pre: [['dm:give_item', {hero: hn, item: 'Rookscar Toll-Token', reason: why}]], args: {hero: hn, item: 'Rookscar Toll-Token', reason: why}}],
      retire_person: () => [{pre: [['dm:place_person', {role: 'hermit', near: hn, name: 'Old Fuzz', reason: why}]], args: {npc: 'Old Fuzz', reason: why}}],
      nudge_relation: () => [{a: hn, b: m1, delta: 1, reason: why}, {a: hn, b: m1, delta: -1, reason: why}],
      undo: () => [{pre: [['dm:mark_place', {kind: 'camp', near: hn, name: 'Fuzz Camp', hours: 4, reason: why}]], args: {reason: why}}],
      dismiss: () => [{pre: [['dm:mark_place', {kind: 'camp', near: hn, name: 'Fuzz Camp', hours: 4, reason: why}]], args: {place: 'Fuzz Camp', reason: why}}],
      unstage: () => [{pre: [['dm:stage_scene', {kind: 'meeting', near: 'fellowship', frame: 'A stranger waits at the road.', reason: why}]], args: {reason: why}}],
      npc_say: () => [{pre: [['dm:place_person', {role: 'hermit', near: hn, name: 'Old Fuzz', reason: why}]], args: {npc: 'Old Fuzz', text: 'Mind the road, friends.'}}],
      npc_offer: () => [{npc: 'Fuzzblade', kind: 'hire', price: 6, text: 'Coin and a road.'}].concat(['rumour', 'trade', 'blessing', 'leave'].map(kind => ({pre: [['dm:place_person', {role: 'hermit', near: hn, name: 'Old Fuzz', reason: why}]], args: {npc: 'Old Fuzz', kind, text: 'They say the ford is haunted.'}}))),
      start_event: () => ['festival', 'plague', 'migration', 'invasion'].map((kind, i) => ({kind, region: String(MAP.ZONES[i % MAP.ZONES.length]), scale: 1, reason: why})),
      create_site: () => [{theme: 'barrow', near: hn, name: 'The Fuzz Barrow', rooms: 2, reason: why}, {theme: 'den', near: hn, reason: why}],
      ruling_answer: () => { const rc = dm('ruling_call', {}); const id = callId(rc); return id == null ? [] : [{call: Number(id), skill: 'lore', dc: 'fair', effects: ['reveal:fact:The carved door opens inward.'], text: 'You read it plainly.', note: 'Fuzz'}]},
      table_answer: () => { const tc = dm('table_call', {}); const id = callId(tc); return id == null ? [] : [{call: Number(id), text: 'The foe growls.'}, {call: Number(id), text: 'It begins.', rounds: 3}]},
      companion_say: () => { const cc = dm('companion_call', {}); const id = callId(cc); return id == null ? [] : [{call: Number(id), text: 'Right then, lead on.'}]},
      unwhen: () => [{pre: [['dm:when', {trigger: 'night_falls', action: 'narrate', args: {text: 'Dark comes.', near: hn}, reason: why}]], args: r => ({id: Number((r[0] || {}).id || 1)})}],
      unwatch: () => [{pre: [['dm:watch', {trigger: 'night_falls'}]], args: r => ({id: Number((r[0] || {}).id || 1)})}],
    };
  };

  return {states, hero, dm: dmRecipes};
}
