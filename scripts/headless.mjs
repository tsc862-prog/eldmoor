// Headless balance harness: runs the real game code in Node with a stubbed DOM,
// fast-forwards N in-game minutes of real time at 1x, and prints a summary.
// Usage: npm run sim            (60 minutes)
//        npm run sim -- 120     (120 minutes)
const minutes = Number(process.argv[2] || 60);

// ---- minimal browser stubs (drawing calls become no-ops) ----
const noop = new Proxy(function () {}, {
  get: (t, k) =>
    k === 'createImageData' ? (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })
    : k === 'createRadialGradient' ? () => ({ addColorStop() {} })
    : noop,
  set: () => true,
  apply: () => noop,
});
function el() {
  return {
    children: [], style: {}, dataset: {}, classList: { add() {} },
    append() {}, prepend(c) { this.children.unshift(c); },
    get lastChild() { const s = this; return { remove() { s.children.pop(); } }; },
    setAttribute() {}, addEventListener() {},
    getBoundingClientRect: () => ({ width: 800, height: 500, left: 0, top: 0 }),
    getContext: () => noop, set innerHTML(v) {}, set textContent(v) {}, width: 0, height: 0,
  };
}
let now = 0, raf = null;
globalThis.Node = class {};
globalThis.document = { createElement: el, getElementById: el, querySelectorAll: () => [] };
globalThis.window = { devicePixelRatio: 1 };
globalThis.ResizeObserver = class { observe() {} };
globalThis.requestAnimationFrame = (f) => { raf = f; };
Object.defineProperty(globalThis, 'performance', { value: { now: () => now }, configurable: true });

await import('../src/main.js');

const frames = minutes * 60 * 60;
for (let i = 0; i < frames; i++) { now += 1000 / 60; raf(now); }

// ---- report ----
const S = globalThis.__eldmoor;
const alive = S.agents.filter((a) => a.state !== 'dead');
const lv = alive.map((a) => a.lvl).sort((a, b) => b - a);
console.log(`\nEldmoor headless run: ${minutes} min at 1x\n`);
console.log('Living heroes:', alive.length, '| levels:', lv.join(' '));
console.log('Fallen:', S.facStats.map((f) => f.fallen).join(' / '), '(Concord / Warband)');
console.log('Honor:', S.facStats.map((f) => f.honor).join(' / '), '| Boss kills:', S.facStats.map((f) => f.bosses).join(' / '));
console.log('Guilds (clears/wipes/bosses):', S.GUILDS.map((g) => `${g.tag} ${g.clears}/${g.wipes}/${g.bosses}`).join('  '));
console.log('Kragmaw alive:', S.boss.alive, '| hp', Math.round(S.boss.hp));
console.log('Top 5:', alive.sort((a, b) => b.lvl - a.lvl).slice(0, 5).map((a) => `${a.name} L${a.lvl} ${a.cls}`).join(', '));
console.log('Recent deaths:', S.fallen.slice(0, 8).map((f) => `${f.name} L${f.lvl} (${f.cause})`).join('; '));
