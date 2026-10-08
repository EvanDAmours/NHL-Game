// Attribute model mirroring EA SPORTS NHL's rating categories. A player's
// overall (OVR) is a weighted average of the attributes that matter for their
// player type, the same way EA builds OVR from type-specific attributes. When a
// roster file gives an EA OVR, we generate a consistent attribute set whose
// computed OVR lands exactly on that number.
import { gauss, clamp, rand, pick } from "./rng.js";
import { isGoalie, isDefense } from "./constants.js";

export const SKATER_ATTRS = {
  skating: { acc: "Acceleration", agi: "Agility", bal: "Balance", end: "Endurance", spd: "Speed" },
  shooting: { sac: "Slap Shot Accuracy", spw: "Slap Shot Power", wac: "Wrist Shot Accuracy", wpw: "Wrist Shot Power" },
  hands: { dek: "Deking", hey: "Hand-Eye", pas: "Passing", puc: "Puck Control" },
  checking: { bch: "Body Checking", str: "Strength", agr: "Aggressiveness", dur: "Durability", fgt: "Fighting Skill" },
  defense: { daw: "Defensive Awareness", blk: "Shot Blocking", stk: "Stick Checking", fof: "Faceoffs", dsc: "Discipline" },
  senses: { oaw: "Offensive Awareness", poi: "Poise" },
};
export const GOALIE_ATTRS = {
  saves: { glh: "Glove High", gll: "Glove Low", sth: "Stick High", stl: "Stick Low", fiv: "Five Hole" },
  athleticism: { spd: "Speed", agi: "Agility", end: "Endurance", dur: "Durability" },
  mental: { pos: "Positioning", reb: "Rebound Control", brk: "Breakaway", vis: "Vision", poi: "Poise", pok: "Poke Check" },
};
export const SKATER_KEYS = Object.values(SKATER_ATTRS).flatMap((g) => Object.keys(g));
export const GOALIE_KEYS = Object.values(GOALIE_ATTRS).flatMap((g) => Object.keys(g));
export const ATTR_LABELS = Object.assign(
  {},
  ...Object.values(SKATER_ATTRS),
  ...Object.values(GOALIE_ATTRS)
);

// OVR weights per EA player type (only these attributes feed the overall).
const OVR_WEIGHTS = {
  SNP: { wac: 3, wpw: 2, sac: 1, spw: 1, oaw: 2, hey: 1, acc: 1, spd: 1, dek: 1, puc: 1, poi: 1 },
  PLY: { pas: 3, oaw: 2, puc: 2, dek: 2, hey: 1, agi: 1, acc: 1, spd: 1, wac: 1, poi: 1 },
  PWF: { str: 2, bch: 2, bal: 2, wpw: 1, wac: 1, hey: 1, puc: 1, oaw: 1, dur: 1, spd: 1 },
  TWF: { daw: 2, stk: 2, oaw: 1, pas: 1, wac: 1, puc: 1, spd: 1, acc: 1, fof: 1, poi: 1, end: 1 },
  GRN: { bch: 2, str: 2, daw: 2, stk: 1, blk: 1, end: 1, dur: 1, agr: 1, fof: 1, spd: 1 },
  ENF: { fgt: 3, str: 2, bch: 2, agr: 2, bal: 1, dur: 1, daw: 1 },
  OFD: { pas: 2, spw: 2, sac: 1, oaw: 2, puc: 2, spd: 1, acc: 1, agi: 1, daw: 1, poi: 1 },
  DFD: { daw: 3, stk: 2, blk: 2, str: 1, bch: 1, bal: 1, pas: 1, dsc: 1, poi: 1 },
  TWD: { daw: 2, stk: 2, pas: 2, spw: 1, blk: 1, oaw: 1, spd: 1, puc: 1, poi: 1 },
  END: { fgt: 2, str: 2, bch: 2, daw: 1, blk: 1, agr: 1, bal: 1, stk: 1 },
  HYB: { glh: 2, gll: 2, sth: 2, stl: 2, fiv: 2, pos: 2, reb: 2, agi: 1, spd: 1, vis: 1, poi: 1, brk: 1 },
  BFY: { glh: 2, gll: 2, sth: 1, stl: 3, fiv: 3, pos: 2, reb: 2, agi: 1, spd: 1, vis: 1, poi: 1, brk: 1 },
  STD: { glh: 3, gll: 2, sth: 3, stl: 1, fiv: 1, pos: 3, reb: 2, agi: 1, spd: 1, vis: 1, poi: 1, brk: 1 },
};

// Offsets (relative to OVR) used when generating the non-key attributes, so a
// sniper still has believable checking and defense numbers.
const GROUP_OFFSETS = {
  SNP: { skating: -2, shooting: 2, hands: 0, checking: -12, defense: -10, senses: 0 },
  PLY: { skating: -1, shooting: -4, hands: 2, checking: -12, defense: -8, senses: 1 },
  PWF: { skating: -4, shooting: -2, hands: -4, checking: 1, defense: -6, senses: -3 },
  TWF: { skating: -2, shooting: -5, hands: -3, checking: -6, defense: 1, senses: -2 },
  GRN: { skating: -5, shooting: -10, hands: -10, checking: 0, defense: -2, senses: -8 },
  ENF: { skating: -10, shooting: -14, hands: -15, checking: 2, defense: -8, senses: -14 },
  OFD: { skating: -2, shooting: -3, hands: -2, checking: -10, defense: -6, senses: 0 },
  DFD: { skating: -5, shooting: -12, hands: -10, checking: -2, defense: 1, senses: -6 },
  TWD: { skating: -3, shooting: -6, hands: -5, checking: -6, defense: -1, senses: -3 },
  END: { skating: -8, shooting: -14, hands: -14, checking: 1, defense: -5, senses: -10 },
};

export const defaultArchetype = (pos) => {
  if (isGoalie(pos)) return pick(["HYB", "HYB", "BFY", "BFY", "STD"]);
  if (isDefense(pos)) return pick(["OFD", "DFD", "TWD", "TWD", "DFD", "END"]);
  return pick(["SNP", "PLY", "PWF", "TWF", "TWF", "GRN", "SNP", "PLY", "ENF"]);
};

export function computeOvr(attrs, type) {
  const w = OVR_WEIGHTS[type] || OVR_WEIGHTS.TWF;
  let s = 0;
  let t = 0;
  for (const k in w) {
    s += (attrs[k] ?? 50) * w[k];
    t += w[k];
  }
  return Math.round(s / t);
}

function groupOf(key) {
  for (const g in SKATER_ATTRS) if (key in SKATER_ATTRS[g]) return g;
  return null;
}

// Generate an attribute set whose computed OVR equals `target` for `type`.
export function generateAttributes(target, type, pos) {
  const goalie = isGoalie(pos);
  const keys = goalie ? GOALIE_KEYS : SKATER_KEYS;
  const weights = OVR_WEIGHTS[type] || OVR_WEIGHTS[goalie ? "HYB" : "TWF"];
  const offsets = GROUP_OFFSETS[type] || {};
  const attrs = {};
  for (const k of keys) {
    let base;
    if (k in weights) base = target + gauss(0, 3);
    else if (goalie) base = target - 6 + gauss(0, 5);
    else base = target + (offsets[groupOf(k)] ?? -6) + gauss(0, 5);
    attrs[k] = base;
  }
  if (!goalie) {
    // Position quirks: centers take faceoffs, defensemen don't.
    if (pos === "C") attrs.fof = target - 2 + gauss(0, 5);
    else if (isDefense(pos)) attrs.fof = 30 + gauss(0, 8);
    else attrs.fof = target - 18 + gauss(0, 7);
    if (type !== "ENF" && type !== "END") attrs.fgt = 35 + rand() * 40;
    attrs.dur = Math.max(attrs.dur, 70 + rand() * 25);
    attrs.end = Math.max(attrs.end, 72 + rand() * 22);
  } else {
    attrs.end = Math.max(attrs.end, 75 + rand() * 20);
    attrs.dur = Math.max(attrs.dur, 75 + rand() * 20);
  }
  for (const k of keys) attrs[k] = clamp(attrs[k], 20, 99);
  // Shift the OVR-weighted attributes until the weighted mean hits target.
  for (let i = 0; i < 12; i++) {
    let s = 0;
    let t = 0;
    for (const k in weights) {
      s += attrs[k] * weights[k];
      t += weights[k];
    }
    const delta = target - s / t;
    if (Math.abs(delta) < 0.05) break;
    for (const k in weights) attrs[k] = clamp(attrs[k] + delta, 20, 99);
  }
  for (const k of keys) attrs[k] = Math.round(attrs[k]);
  // Rounding can leave us one point off; nudge the heaviest attribute(s).
  const ordered = Object.keys(weights).sort((a, b) => weights[b] - weights[a]);
  for (let guard = 0; guard < 40; guard++) {
    const cur = computeOvr(attrs, type);
    if (cur === target) break;
    const dir = cur < target ? 1 : -1;
    const k = ordered[guard % ordered.length];
    attrs[k] = clamp(attrs[k] + dir, 20, 99);
  }
  return attrs;
}

// Re-scale an existing player's attributes to a new OVR (roster edits/imports).
export function rescaleToOvr(player, newOvr) {
  const delta = newOvr - player.ovr;
  for (const k in player.attrs) {
    if (!isGoalie(player.pos) && (k === "fgt" || k === "fof")) continue;
    player.attrs[k] = clamp(Math.round(player.attrs[k] + delta), 20, 99);
  }
  player.ovr = computeOvr(player.attrs, player.type);
  const ordered = Object.keys(OVR_WEIGHTS[player.type] || {});
  for (let guard = 0; guard < 40 && player.ovr !== newOvr && ordered.length; guard++) {
    const dir = player.ovr < newOvr ? 1 : -1;
    const k = ordered[guard % ordered.length];
    player.attrs[k] = clamp(player.attrs[k] + dir, 20, 99);
    player.ovr = computeOvr(player.attrs, player.type);
  }
  if (player.pot < player.ovr) player.pot = player.ovr;
}

// Apply a progression delta (positive or negative) to attributes, with age
// shaping which categories move (vets lose skating first; kids gain hands/senses).
export function progressAttributes(player, delta) {
  const goalie = isGoalie(player.pos);
  const weights = OVR_WEIGHTS[player.type] || {};
  for (const k of Object.keys(player.attrs)) {
    if (!goalie && k === "fgt") continue;
    let d = delta + gauss(0, 0.8);
    // Non-OVR attributes move with age shape; OVR attributes move by delta so
    // the overall tracks the intended change.
    if (!(k in weights)) {
      if (!goalie) {
        const g = groupOf(k);
        if (delta < 0 && g === "skating") d *= 1.35;
        if (delta < 0 && (g === "senses" || k === "dsc")) d *= 0.5;
      } else if (delta < 0 && (k === "spd" || k === "agi")) d *= 1.3;
    }
    player.attrs[k] = clamp(Math.round(player.attrs[k] + d), 20, 99);
  }
  player.ovr = computeOvr(player.attrs, player.type);
}

const avg = (...xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Composite ratings used by the simulation (0-99 scale).
export function composites(p) {
  const a = p.attrs;
  if (isGoalie(p.pos)) {
    const save = avg(a.glh, a.gll, a.sth, a.stl, a.fiv);
    return { goalie: save * 0.55 + a.pos * 0.2 + a.reb * 0.1 + avg(a.spd, a.agi) * 0.1 + a.poi * 0.05, reb: a.reb, brk: a.brk };
  }
  const skate = avg(a.spd, a.acc, a.agi);
  const shoot = avg(a.wac, a.wpw, a.wac, (a.sac + a.spw) / 2);
  const hands = avg(a.dek, a.hey, a.puc);
  const pass = avg(a.pas, a.oaw, a.puc);
  const def = avg(a.daw, a.daw, a.stk, a.blk, (a.bch + a.str) / 2);
  return {
    skate,
    shoot,
    hands,
    pass,
    def,
    off: shoot * 0.3 + hands * 0.25 + a.oaw * 0.25 + skate * 0.2,
    ctrl: hands * 0.35 + pass * 0.3 + skate * 0.2 + a.poi * 0.15,
    phys: avg(a.bch, a.str, a.agr),
    blk: a.blk,
    dsc: a.dsc,
    fof: a.fof,
    dek: a.dek,
    agr: a.agr,
    fgt: a.fgt,
  };
}

// Simple rating-to-color helper for the UI.
export function ratingTier(v) {
  if (v >= 90) return "elite";
  if (v >= 85) return "great";
  if (v >= 80) return "good";
  if (v >= 75) return "avg";
  return "low";
}
