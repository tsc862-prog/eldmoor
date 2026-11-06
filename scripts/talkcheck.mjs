// The talk guard (#870, src/sim/talk.js): a second introduction is refused, a status line that merely has the speaker's name and an "I am"
// in it is not. Twelve real lines from the owner's runner logs (the logs cut a line at about 120 characters; the cut tails are finished
// with the plain "I am ..." / "I'm ..." words the guard tripped on), a real introduction, repeats, the refusal text naming what tripped
// it, and the counts the behavior digest reads. No model, no network, no RNG. Usage: npm run talkcheck.
import {init, S, step} from '../src/sim/index.js';
import {lineRefusal, introMatch, isIntro, noteSaid} from '../src/sim/talk.js';
import {makeWatch} from '../src/sim/behavior.js';
import {slotted, slotMembers} from '../src/sim/company.js';
let fail = 0; const ok = (c, m) => {if (c) console.log('  ok   ' + m); else {console.error('  FAIL ' + m); fail++}};
init({fellowship: false});
const [A, B] = S.agents.filter(a => a.kind === 'hero');
const speaker = name => {A.name = name; A.player = true; A.talkSaid = []; A.talkNo = undefined; return A};
const meet = () => {A.talkHeard = {[B.id]: 1}; B.talkHeard = {[A.id]: 1}; B.state = 'town'};
meet();

const REAL = [
  ['Ulfock', 'Back in Highgate, Ulfock here. My nerve broke at 43% and I ran from a boar at dawn, sorry for leaving you short. I am ready to hunt again.'],
  ['Brinin', 'Brinin here. I agree with Halius and Lunwen: home to Highgate, sharpen up, then the wolves. I am leaving Thornvale now.'],
  ['Brinin', 'Brinin is back with the company. I walked out to Thornvale alone on autopilot and I am sorry for it. I agree with the plan.'],
  ['Kerrach', 'Kerrach here. I walked off toward Highgate by mistake and I am sorry for it. I am coming back to the company now.'],
  ['Snaggekk', "Snaggekk's alone in the sump, a Mudback Boar four tiles off and I'm not picking that fight by myself. Where are you?"],
  ['Snaggekk', "Ooloss, Snaggekk here, I'm in Murkstead. I've had a go at the Lowmark boars alone and sold the loot."],
  ['Snaggekk', "Vorrim, Snaggekk here: I'm fighting a boar in Lowmark at 75 percent, then I'm heading to Murkstead to rest."],
  ['Ssilith', "Ssilith here. I'm in, Ragrek. I'm level 1 and I'd rather learn the webs on the easy ones first. I'll stay on your left."],
  ['Gashosh', "Gashosh is in Sedgewater with a Bogling on me, and it's dangerous for me. I'm breaking off toward the company."],
  ['Gashosh', "Gashosh is with the knot, full HP. Karga leads, Ssilul counts at the tree line. I'm at the back. Break at the fork."],
  ['Korrak', 'Ssilaal, it was me. A Timber Wolf called its kin and I broke at 45% and ran for Grimhold; that is on Korrak, no one else. I am back now.'],
  ['Lurkar', 'Lurkar back in Grimhold at full HP. My nerve broke at 34% on a wolf and I ran, my mistake. I am ready to walk to the thorn-brush.'],
];
console.log('A. the twelve refused status lines go through');
for (const [n, t] of REAL) {speaker(n); meet(); ok(lineRefusal(A, t) === null && !isIntro(A, t), n + ': ' + t.slice(0, 48) + '...')}

console.log('B. a real second introduction is still refused, and the refusal names it');
const INTROS = [
  ['Gwilett', "Hello Aelett! I am Gwilett from Wendell's Ford, a Tarrow Rogue, and my blade is yours."],
  ['Eyrett', 'Greetings, Mirion. I am Eyrett, and my blade is borrowed as well.'],
  ['Lurkar', "Hail all. I'm Lurkar, a Warband Tank."], ['Lurkar', 'I’m Lurkar, new to the company.'],
  ['Lurkar', 'My name is Lurkar and I hold the front.'], ['Lurkar', 'They call me Lurkar the Late.'], ['Lurkar', 'This is Lurkar, reporting in.'],
  ['Lurkar', 'Let me introduce myself to the company.'], ['Lurkar', 'Nice to meet you all.'], ['Lurkar', 'Well met, friends.'],
];
for (const [n, t] of INTROS) {speaker(n); meet(); const r = lineRefusal(A, t), w = introMatch(A, t);
  ok(r && w && r.includes('"' + w + '"') && !/^You /.test(r), n + ': ' + JSON.stringify(t.slice(0, 40)) + ' -> ' + JSON.stringify(w))}
speaker('Lurkar'); meet(); ok(lineRefusal(A, 'I am Lurkar.').includes('"I am Lurkar"'), 'the text quotes the words that tripped it');
ok(introMatch(A, 'That is on Lurkar\'s head. This is Lurkar\'s fault.') === null, "this is Lurkar's fault is not an introduction");

console.log('C. strangers may introduce themselves; a repeat is still refused');
speaker('Lurkar'); A.talkHeard = {}; ok(lineRefusal(A, 'I am Lurkar, a Tank.') === null, 'no one met yet: the first introduction goes through');
speaker('Lurkar'); meet(); noteSaid(A, 'Hold the bridge, I will take the left.', []); ok(lineRefusal(A, 'Hold the bridge, I will take the left!') !== null, 'the same line again is refused');
const R = A.talkNo; ok(R && R.same === 1 && R.intro === 0, 'one repeat counted');

console.log('D. the behavior digest counts refused talk and flags it');
init(); // the default Fellowship: its members are the watch's seats
const K = slotMembers(slotted())[0].hero, J = slotMembers(slotted())[1].hero; K.player = true; K.talkHeard = {[J.id]: 1}; J.talkHeard = {[K.id]: 1};
const W = makeWatch(); W.tick();
for (let i = 0; i < 4; i++) lineRefusal(K, 'I am ' + K.name.split(' ')[0] + ' again ' + i);
ok(K.talkNo && K.talkNo.intro === 4, 'four introductions counted on the hero');
const out = []; for (let i = 0; i < 70 * 60 && !out.some(x => x.kind === 'world'); i++) {step(1 / 60); out.push(...W.tick())}
const an = out.filter(x => x.kind === 'anomaly' && x.rec.kind === 'refused-talk' && x.rec.hero && x.rec.hero.id === K.id), wd = out.find(x => x.kind === 'world');
ok(an.length === 1, 'the watch flags refused-talk once (' + an.length + ')');
ok(wd && wd.rec.talkRefused && wd.rec.talkRefused[K.name] && wd.rec.talkRefused[K.name].intro === 4, 'the hourly digest counts it per hero (' + JSON.stringify(wd && wd.rec.talkRefused) + ')');
if (fail) {console.error(fail + ' failed'); process.exit(1)} console.log('talkcheck ok');
