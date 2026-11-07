// What a hero keeps across a session roll (issue #808, under #799). A roll (scripts/session-roll.mjs) starts a fresh SDK session, so the
// hero loses the last hours of talk: its journal, notes and persona stay, but what was said and promised lately does not. This keeps a
// small ring on the session object and puts it in the first prompt of the fresh session. No model call, no slot, no time: the runner
// only copies what this hero's own session already saw, in the words it saw them:
//   lines  what the hero's own state headers carried as "Said lately" (brief.heard, its own lines marked "(you)"; sim/talk.js heardLines)
//   did    the hero's own closing narration of its last turns, and its own forced scene answers, which never enter the SDK session at all
// Takes one session and that hero's own brief: nothing here can read another seat (npm run channelcheck). Lines in the header of the
// same prompt are left out, so nothing is said twice. It rides in that one prompt, so it stays in the session until the next roll:
// about 500 tokens at RECAP.MAX. Measured on the real CLI and a mock API (#808): +0.6% to +1.3% a turn; /compact between turns cost
// +6% to +8% for the same turns, and takes a model call and a Claude slot, and paraphrases.
// SESSION_RECAP=0 turns it off. Plain Node, no imports.
export const RECAP = {LINES: 24, DID: 5, NARR: 180, MAX: 1800};

export const recapOn = (env = {}) => env.SESSION_RECAP !== '0';
const flat = (s, n) => {s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s};
// After every Claude turn: what the header showed and how the turn closed. brief: this hero's state header. narration: its own words.
export function noteTurn(sess, brief, narration) {
  const r = sess.recap || (sess.recap = {lines: [], did: []});
  for (const l of Array.isArray(brief && brief.heard) ? brief.heard : []) if (typeof l === 'string' && l && !r.lines.includes(l)) r.lines.push(l);
  r.lines.splice(0, Math.max(0, r.lines.length - RECAP.LINES));
  const text = flat(narration, RECAP.NARR);
  if (text && !r.did.some(d => d.text === text)) r.did.push({t: brief && typeof brief.clock === 'string' ? brief.clock : '', text});
  r.did.splice(0, Math.max(0, r.did.length - RECAP.DID));
}
// The text for the first prompt of a fresh session, '' when there is nothing to carry. brief: the header going into the same prompt.
// Oldest lines go first when it runs over RECAP.MAX: the newest talk is what a fresh session misses most.
export function recapNote(sess, brief) {
  const r = sess && sess.recap; if (!r) return '';
  const shown = new Set(Array.isArray(brief && brief.heard) ? brief.heard : []);
  const did = (r.did || []).map(d => (d.t ? d.t + ': ' : '') + d.text), lines = (r.lines || []).filter(l => !shown.has(l));
  const head = '\n\nWhat you recall from just before (your own memory, oldest first; it is past, not news):', said = '\nSaid: ', you = '\nYou: ';
  while (did.length > 1 && did.join(' / ').length > RECAP.MAX / 2) did.shift();
  const room = RECAP.MAX - head.length - said.length - you.length - did.join(' / ').length;
  while (lines.length && lines.join(' / ').length > room) lines.shift();
  if (!lines.length && !did.length) return '';
  return head + (lines.length ? said + lines.join(' / ') : '') + (did.length ? you + did.join(' / ') : '');
}
