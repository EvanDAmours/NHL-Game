// Entry draft: prospect classes, the two-draw lottery, and AI picks. Scouting lives in
// scouting.js.
import { gauss, clamp, rand, randInt, chance, weighted } from "./rng.js";
import { generatePlayer } from "./players.js";
import { DRAFT_ROUNDS, isGoalie, isDefense, isForward, MAX_PROSPECTS } from "./constants.js";
import { compareTeams } from "./standings.js";
import { defaultArchetype } from "./ratings.js";
import { rollDev } from "./players.js";
import { rankClass, csRank, csScore, pickGrade, openDraftFloor } from "./scouting.js";

const CLASS_SIZE = 170; // 4 rounds x 32 picks, plus some left undrafted
const POS_MIX = [["C", 25], ["LW", 17], ["RW", 17], ["LD", 14], ["RD", 14], ["G", 8]];
const LOTTERY_ODDS = [18.5, 13.5, 11.5, 9.5, 8.5, 7.5, 6.5, 6.0, 5.0, 3.5, 3.0, 2.5, 2.0, 1.5, 0.5, 0.5];

function randomPos() {
  return weighted(POS_MIX, (x) => x[1])[0];
}

export function generateDraftClass(league, draftYear) {
  const ids = [];
  for (let i = 0; i < CLASS_SIZE; i++) {
    const pos = randomPos();
    const tier = i / CLASS_SIZE;
    let pot = Math.round(clamp(93 - 21 * Math.sqrt(tier) + gauss(0, 2.5), 60, 97));
    if (i === 0 && chance(0.35)) pot = Math.max(pot, 95);
    const age = chance(0.8) ? 18 : 19;
    const gap = i < 6 ? randInt(9, 15) : randInt(13, 24);
    const ovr = clamp(pot - gap + (age - 18) * 2, 45, 82);
    const p = generatePlayer(pos, ovr, age, league.year, { type: defaultArchetype(pos), src: "draft" });
    p.pot = Math.max(pot, p.ovr);
    p.tid = -2;
    p.signed = false;
    p.rookie = true;
    p.consensus = gauss(0, 3);
    p.dev = rollDev(p.id, p.pot);
    // The public, consensus read used wherever a prospect you never scouted shows up later.
    p.scout = { lvl: 0, base: estimate(p, 4, 5) };
    league.players[p.id] = p;
    ids.push(p.id);
  }
  league.draftClass = ids;
  league.draftClassYear = draftYear;
  rankClass(league, ids);
  return ids;
}

// A noisy read on a prospect: never wildly off, and the ceiling it reports is never
// below how good the player is today.
function estimate(p, sdOvr, sdPot) {
  const eOvr = Math.round(p.ovr + clamp(gauss(0, sdOvr), -1.8 * sdOvr, 1.8 * sdOvr));
  const ePot = Math.max(eOvr + 1, Math.round(p.pot + clamp(gauss(0, sdPot), -1.8 * sdPot, 1.8 * sdPot)));
  return { eOvr, ePot };
}

// Ratings the user sees for a prospect someone else owns (or hasn't drafted yet): your
// latest scouting report if there is one, otherwise the consensus read.
export function shownRatings(p) {
  const s = p.scout;
  if (!s) return { ovr: p.ovr, pot: p.pot, exact: true };
  if (s.lvl > 0 && s.eOvr != null) return { ovr: s.eOvr, pot: s.ePot, exact: !!s.exact };
  const b = s.base || s;
  return { ovr: b.eOvr ?? p.ovr, pot: b.ePot ?? p.pot, exact: false };
}

export function createDraftPicks(league, year) {
  for (const t of league.teams) {
    for (let r = 1; r <= DRAFT_ROUNDS; r++) {
      league.draftPicks.push({ id: `${year}-${r}-${t.id}`, year, round: r, orig: t.id, owner: t.id });
    }
  }
}

export function pickLabel(league, pk) {
  const orig = league.teams[pk.orig];
  return `${pk.year} R${pk.round}${pk.owner !== pk.orig ? ` (${orig.abbr})` : ""}`;
}

// Non-playoff teams by fewest points, lottery-adjusted; then playoff teams by
// how far they went (Cup winner picks last).
export function draftOrder(league) {
  const po = league.playoffs;
  const playoffIds = new Set();
  if (po) for (const s of po.rounds[0]) { playoffIds.add(s.top); playoffIds.add(s.bot); }
  const nonPlayoff = league.teams.filter((t) => !playoffIds.has(t.id)).sort((a, b) => -compareTeams(a, b));
  const lottery = runLottery(nonPlayoff.map((t) => t.id));
  const exitRound = (tid) => {
    if (po.champion === tid) return 5;
    for (let r = po.rounds.length - 1; r >= 0; r--) {
      for (const s of po.rounds[r]) if ((s.top === tid || s.bot === tid) && s.winner != null) return s.winner === tid ? r + 1 : r;
    }
    return 0;
  };
  const playoff = league.teams
    .filter((t) => playoffIds.has(t.id))
    .sort((a, b) => exitRound(a.id) - exitRound(b.id) || -compareTeams(a, b));
  return { order: [...lottery.order, ...playoff.map((t) => t.id)], lottery };
}

function runLottery(ids) {
  const order = [...ids];
  const odds = LOTTERY_ODDS.slice(0, ids.length);
  const winners = [];
  const draws = [];
  for (let draw = 0; draw < 2 && order.length > 1; draw++) {
    const eligible = ids.map((id, i) => ({ id, w: odds[i] ?? 0 })).filter((x) => !winners.includes(x.id));
    const won = weighted(eligible, (x) => x.w).id;
    winners.push(won);
    const from = order.indexOf(won);
    const to = Math.max(draw, from - 10);
    order.splice(from, 1);
    order.splice(to, 0, won);
    draws.push({ id: won, from: ids.indexOf(won) + 1, to: to + 1 });
  }
  return { order, draws, preLottery: ids };
}

export function startDraft(league) {
  const year = league.year + 1;
  const { order, lottery } = draftOrder(league);
  const slots = [];
  let overall = 1;
  for (let r = 1; r <= DRAFT_ROUNDS; r++) {
    for (const tid of order) {
      const pk = league.draftPicks.find((p) => p.year === year && p.round === r && p.orig === tid);
      slots.push({ round: r, overall: overall++, orig: tid, owner: pk ? pk.owner : tid, pid: null });
    }
  }
  league.draft = { year, slots, idx: 0, lottery };
  return league.draft;
}

function teamNeeds(league, tid) {
  const t = league.teams[tid];
  const all = [...t.roster, ...t.prospects].map((id) => league.players[id]).filter(Boolean);
  const g = all.filter((p) => isGoalie(p.pos)).length;
  const d = all.filter((p) => isDefense(p.pos)).length;
  const f = all.filter((p) => isForward(p.pos)).length;
  return { G: g < 4 ? 1.04 : 0.93, D: d < 12 ? 1.03 : 1, F: f < 20 ? 1.02 : 1 };
}

// AI teams blend their own scouts' (noisy) read with Central Scouting's rankings, so they
// mostly follow the board and the sleepers your scouts find can still be there.
const DEV_EYE = { superstar: 1.2, star: 0.6, late: -0.3 };
export function aiChoose(league, tid) {
  const avail = league.draftClass.filter((id) => league.players[id]?.tid === -2);
  const need = teamNeeds(league, tid);
  let best = null;
  let bestScore = -Infinity;
  for (const id of avail) {
    const p = league.players[id];
    const grp = isGoalie(p.pos) ? "G" : isDefense(p.pos) ? "D" : "F";
    const own = (p.pot + (p.consensus || 0)) * 0.78 + p.ovr * 0.22 + (DEV_EYE[p.dev] || 0);
    const score = (own * 0.5 + csScore(p) * 0.5 + gauss(0, 1.2)) * need[grp];
    if (score > bestScore) { bestScore = score; best = id; }
  }
  return best;
}

export function makePick(league, pid) {
  const d = league.draft;
  const slot = d.slots[d.idx];
  const p = league.players[pid];
  if (!slot || !p || p.tid !== -2) return false;
  openDraftFloor(league);
  slot.pid = pid;
  slot.csr = csRank(p);
  slot.grade = pickGrade(slot.overall, slot.csr);
  p.tid = slot.owner;
  p.draft = { year: d.year, round: slot.round, pick: slot.overall, tid: slot.owner };
  p.yrs = 0;
  p.cap = 0;
  p.signed = false;
  const team = league.teams[slot.owner];
  team.prospects.push(pid);
  league.draftPicks = league.draftPicks.filter((pk) => !(pk.year === d.year && pk.round === slot.round && pk.orig === slot.orig));
  d.idx++;
  return true;
}

export function draftDone(league) {
  return !league.draft || league.draft.idx >= league.draft.slots.length;
}

export function currentSlot(league) {
  return league.draft?.slots[league.draft.idx] || null;
}

// AI picks until it's the user's turn (or the draft ends).
export function simDraftToUser(league, { all = false } = {}) {
  openDraftFloor(league);
  while (!draftDone(league)) {
    const slot = currentSlot(league);
    if (!all && slot.owner === league.userTid) return;
    makePick(league, aiChoose(league, slot.owner));
  }
}

export function finishDraft(league) {
  // Undrafted prospects leave the league; trim oversized prospect pools.
  for (const id of league.draftClass) {
    const p = league.players[id];
    if (p && p.tid === -2) delete league.players[id];
  }
  league.draftClass = [];
  for (const t of league.teams) {
    if (t.prospects.length > MAX_PROSPECTS) {
      const sorted = t.prospects.map((id) => league.players[id]).sort((a, b) => a.pot - b.pot);
      const cut = sorted.slice(0, t.prospects.length - MAX_PROSPECTS);
      for (const p of cut) releaseProspect(league, p.id);
    }
  }
}

export function releaseProspect(league, pid) {
  const p = league.players[pid];
  if (!p) return;
  const t = league.teams[p.tid];
  if (t) t.prospects = t.prospects.filter((x) => x !== pid);
  delete league.players[pid];
}

export function randomRoundSeed() {
  return rand();
}
