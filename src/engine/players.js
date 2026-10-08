// Player creation, contracts, progression, aging and valuation.
import { uid, gauss, clamp, rand, randInt, chance, pick } from "./rng.js";
import { generateAttributes, defaultArchetype, progressAttributes, computeOvr } from "./ratings.js";
import { isGoalie, isDefense, capForYear, minSalaryForYear, maxSalaryForYear } from "./constants.js";
import { randomName } from "./names.js";

export const blankSkaterStats = () => ({ gp: 0, g: 0, a: 0, pts: 0, pm: 0, pim: 0, sog: 0, hit: 0, blk: 0, toi: 0, ppg: 0, ppp: 0, shg: 0, gwg: 0, fow: 0, fol: 0 });
export const blankGoalieStats = () => ({ gp: 0, gs: 0, w: 0, l: 0, otl: 0, sa: 0, ga: 0, so: 0, toi: 0 });
export const blankStats = (pos) => (isGoalie(pos) ? blankGoalieStats() : blankSkaterStats());

export function estimatePotential(ovr, age) {
  let bump = 0;
  if (age <= 19) bump = 9;
  else if (age <= 20) bump = 7;
  else if (age <= 21) bump = 5.5;
  else if (age <= 22) bump = 4;
  else if (age <= 23) bump = 2.5;
  else if (age <= 24) bump = 1.5;
  else if (age <= 25) bump = 0.7;
  return clamp(Math.round(ovr + bump + gauss(0, bump * 0.3)), ovr, 99);
}

export function createPlayer(opts, year) {
  const pos = opts.pos;
  const type = opts.type || defaultArchetype(pos);
  const ovrTarget = clamp(Math.round(opts.ovr), 40, 99);
  const age = opts.age ?? (opts.born ? year - opts.born : 25);
  const attrs = opts.attrs || generateAttributes(ovrTarget, type, pos);
  const p = {
    id: opts.id || uid("p"),
    name: opts.name,
    nat: opts.nat || "",
    pos,
    type,
    age,
    shoots: opts.shoots || (pos === "RD" || pos === "RW" ? (chance(0.7) ? "R" : "L") : chance(0.75) ? "L" : "R"),
    attrs,
    ovr: computeOvr(attrs, type),
    pot: 0,
    cap: opts.cap ?? 0,
    yrs: opts.yrs ?? 0,
    src: opts.src || "gen",
    tid: opts.tid ?? -1,
    injury: 0,
    stats: blankStats(pos),
    pstats: blankStats(pos),
    career: [],
    draft: opts.draft || null,
    rookie: opts.rookie ?? age <= 21,
  };
  p.pot = opts.pot ? Math.max(opts.pot, p.ovr) : estimatePotential(p.ovr, age);
  return p;
}

// Fictional player at a given talent level (depth fill, random leagues, FA filler).
export function generatePlayer(pos, ovr, age, year, extra = {}) {
  const { name, nat } = randomName();
  return createPlayer({ name, nat, pos, ovr, age, src: "gen", ...extra }, year);
}

// Market AAV ($M) for a player of a given OVR at age, scaled to the cap.
const VALUE_TABLE = [
  [60, 0.85], [72, 0.85], [75, 1.0], [78, 1.5], [80, 2.0], [82, 3.0], [84, 4.25], [86, 5.5],
  [88, 7.0], [90, 8.5], [92, 10.0], [94, 11.5], [96, 13.0], [98, 14.5], [99, 15.5],
];
export function marketValue(p, year) {
  const ovr = p.ovr;
  let v = VALUE_TABLE[0][1];
  for (let i = 1; i < VALUE_TABLE.length; i++) {
    const [o1, v1] = VALUE_TABLE[i - 1];
    const [o2, v2] = VALUE_TABLE[i];
    if (ovr <= o2) {
      v = v1 + ((Math.max(ovr, o1) - o1) / (o2 - o1)) * (v2 - v1);
      break;
    }
    v = v2;
  }
  v *= capForYear(year) / 104;
  if (p.age >= 31) v *= Math.max(0.45, 1 - 0.07 * (p.age - 30));
  if (p.age <= 22 && p.pot > p.ovr) v *= 1 + Math.min(0.25, (p.pot - p.ovr) * 0.03);
  if (isGoalie(p.pos)) v *= 0.85;
  return round2(clamp(v, minSalaryForYear(year), maxSalaryForYear(year)));
}

export const round2 = (x) => Math.round(x * 100) / 100;

export function isRFA(p) {
  return p.age <= 25;
}

// What a player asks for in a new deal. `mood` 0..1 (higher = happier = cheaper).
export function contractAsk(p, year, { mood = 0.5, mult = 1 } = {}) {
  let aav = marketValue(p, year) * mult;
  if (isRFA(p)) aav *= 0.85;
  aav *= 1.08 - 0.16 * mood;
  aav = round2(clamp(aav, minSalaryForYear(year), maxSalaryForYear(year)));
  let yrs;
  if (p.age <= 24) yrs = p.ovr >= 84 ? randIntSeeded(p, 5, 8) : randIntSeeded(p, 2, 4);
  else if (p.age <= 28) yrs = randIntSeeded(p, 3, 7);
  else if (p.age <= 31) yrs = randIntSeeded(p, 2, 5);
  else if (p.age <= 34) yrs = randIntSeeded(p, 1, 3);
  else yrs = 1;
  return { aav, yrs };
}

// Deterministic per-player "random" so the ask doesn't change every render.
function randIntSeeded(p, a, b) {
  let h = 0;
  for (let i = 0; i < p.id.length; i++) h = (h * 31 + p.id.charCodeAt(i)) >>> 0;
  h = (h + p.age * 7919) >>> 0;
  return a + (h % (b - a + 1));
}

// Yearly development. Returns the OVR change.
export function developPlayer(p, bonus = 0) {
  const before = p.ovr;
  const age = isGoalie(p.pos) ? p.age - 2 : p.age;
  let mean;
  let sd;
  if (age <= 19) [mean, sd] = [3, 2.2];
  else if (age <= 21) [mean, sd] = [2.2, 2];
  else if (age <= 23) [mean, sd] = [1.4, 1.8];
  else if (age <= 25) [mean, sd] = [0.6, 1.5];
  else if (age <= 27) [mean, sd] = [0, 1.3];
  else if (age <= 29) [mean, sd] = [-0.6, 1.3];
  else if (age <= 31) [mean, sd] = [-1.3, 1.5];
  else if (age <= 33) [mean, sd] = [-2.2, 1.7];
  else [mean, sd] = [-3.2, 2.2];
  if (p.age <= 25) {
    const gap = p.pot - p.ovr;
    mean += gap > 0 ? Math.min(1.5, gap * 0.12) : gap * 0.3;
  }
  // The air is thin at the top: elite ratings are hard to climb further.
  if (before >= 90) mean -= (before - 88) * 0.25;
  mean += bonus;
  let delta = gauss(mean, sd);
  if (before + delta > 99) delta = 99 - before;
  progressAttributes(p, delta);
  // Attribute noise can drift OVR; pull it back toward the intended change.
  const drift = p.ovr - (before + delta);
  if (Math.abs(drift) >= 1) progressAttributes(p, -drift);
  if (p.age <= 25) p.pot = clamp(Math.round(Math.max(p.ovr, p.pot + gauss(-0.3, 1.2))), p.ovr, 99);
  else p.pot = p.ovr;
  p.peak = Math.max(p.peak || 0, p.ovr);
  return p.ovr - before;
}

export function retirementChance(p) {
  if (p.age >= 41) return 0.95;
  let c = 0;
  if (p.age >= 34) c = 0.1 + 0.12 * (p.age - 34);
  if (p.ovr < 78 && p.age >= 32) c += 0.2;
  if (p.tid < 0 && p.age >= 30 && p.ovr < 76) c += 0.35;
  if (p.ovr >= 90) c *= 0.5;
  return clamp(c, 0, 0.95);
}

// Asset value for trade logic (roughly exponential in OVR).
export function tradeValue(p, year, { contending = false } = {}) {
  let v = Math.exp((p.ovr - 70) / 6.2);
  if (p.age <= 23) v *= 1 + Math.max(0, p.pot - p.ovr) * 0.05;
  else if (p.age >= 35) v *= 0.35;
  else if (p.age >= 32) v *= 0.6;
  else if (p.age >= 29) v *= 0.85;
  if (p.yrs > 0) {
    const surplus = marketValue(p, year) - p.cap;
    v *= clamp(1 + surplus * 0.07, 0.45, 1.5);
  }
  if (isGoalie(p.pos)) v *= 0.9;
  if (contending && p.age >= 28) v *= 1.15;
  if (!contending && p.age <= 23) v *= 1.15;
  if (p.injury > 20) v *= 0.7;
  return v;
}

export function prospectValue(p, { contending = false } = {}) {
  let v = Math.exp((p.pot - 74) / 6.5) * 0.9 + Math.exp((p.ovr - 70) / 6.2) * 0.3;
  if (!contending) v *= 1.15;
  return v;
}

export function fmtMoney(m) {
  if (m == null) return "-";
  if (m >= 1) return "$" + m.toFixed(m >= 10 ? 1 : 2) + "M";
  return "$" + Math.round(m * 1000) + "K";
}

export const fullPosName = (pos) => ({ C: "Center", LW: "Left Wing", RW: "Right Wing", LD: "Left Defense", RD: "Right Defense", G: "Goalie" })[pos] || pos;

export function seasonLine(p, year, abbr) {
  return { year, team: abbr, ...p.stats };
}

export function pointsShare(p) {
  return p.stats.gp ? (p.stats.pts / p.stats.gp).toFixed(2) : "0.00";
}

export function savePct(s) {
  return s.sa ? (1 - s.ga / s.sa) : 0;
}
export function gaa(s) {
  return s.toi ? (s.ga * 3600) / s.toi : 0;
}

export function randomAgeForDepth() {
  return pick([22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]);
}

export function chanceInjury(p) {
  const dur = p.attrs.dur ?? 80;
  return 0.0022 * (1 + (85 - dur) / 40);
}

export function injuryLength() {
  const r = rand();
  if (r < 0.55) return randInt(1, 4);
  if (r < 0.85) return randInt(5, 15);
  if (r < 0.97) return randInt(16, 35);
  return randInt(36, 70);
}

export { isDefense };
