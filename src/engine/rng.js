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
