// Seedable random number helpers. The whole engine draws from one stream so a
// seeded league (tests, shared seeds) replays identically.

let state = (Date.now() ^ 0x9e3779b9) >>> 0;

export function seed(n) {
  state = (n >>> 0) || 1;
}

// mulberry32
export function rand() {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const randInt = (a, b) => Math.floor(rand() * (b - a + 1)) + a;
export const randFloat = (a, b) => rand() * (b - a) + a;
export const chance = (p) => rand() < p;
export const pick = (arr) => arr[Math.floor(rand() * arr.length)];
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function gauss(mean = 0, sd = 1) {
  let u = 0;
  let v = 0;
  while (!u) u = rand();
  while (!v) v = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Pick an item from `items` with probability proportional to weightFn(item).
export function weighted(items, weightFn) {
  let total = 0;
  const ws = items.map((it) => {
    const w = Math.max(0, weightFn(it));
    total += w;
    return w;
  });
  if (total <= 0) return items[Math.floor(rand() * items.length)];
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= ws[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

let idCounter = 0;
export function uid(prefix = "p") {
  idCounter = (idCounter + 1) % 1e6;
  return prefix + Math.floor(rand() * 2 ** 31).toString(36) + idCounter.toString(36);
}

// A separate, repeatable stream keyed by a string (a player id, a season...). Used for
// flavour that must not disturb the main stream, and for reads that must not change
// between renders.
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
export function stream(key) {
  let st = hashStr(String(key)) || 1;
  const next = () => {
    st = (st + 0x6d2b79f5) >>> 0;
    let t = st;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    int: (a, b) => Math.floor(next() * (b - a + 1)) + a,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    gauss: (mean = 0, sd = 1) => {
      let u = 0;
      let v = 0;
      while (!u) u = next();
      while (!v) v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    weighted: (items, w) => {
      const total = items.reduce((s, it) => s + Math.max(0, w(it)), 0);
      let x = next() * total;
      for (const it of items) {
        x -= Math.max(0, w(it));
        if (x <= 0) return it;
      }
      return items[items.length - 1];
    },
  };
  return r;
}
