// Offseason flow: contract expiry and re-signing, free agency, and the
// rollover into a new season (aging, development, retirements, new schedule).
import { clamp, chance, shuffle, randInt, gauss } from "./rng.js";
import { contractAsk, developPlayer, retirementChance, blankStats, marketValue, generatePlayer, isRFA, round2 } from "./players.js";
import { capForYear, minSalaryForYear, maxSalaryForYear, DIFFICULTY, FA_DAYS, SCOUT_POINTS_PER_SEASON, isGoalie, isDefense, isForward, MAX_ROSTER } from "./constants.js";
import { payroll, capSpace, counts, signPlayer, releasePlayer, callUp, sendDown, canSendDown, logTx, ensureMinimums, hasRoomFor } from "./roster.js";
import { teamRatings, autoLines, syncLines } from "./lines.js";
import { generateSchedule } from "./schedule.js";
import { generateDraftClass, createDraftPicks, releaseProspect } from "./draft.js";
import { blankRecord } from "./sim.js";

const diff = (league) => DIFFICULTY[league.settings.difficulty] || DIFFICULTY.normal;

function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

export function playerMood(league, p) {
  const t = league.teams[p.tid];
  if (!t) return 0.5;
  const pct = t.rec.gp ? t.rec.pts / (2 * t.rec.gp) : 0.5;
  const mates = t.roster.map((id) => league.players[id]).filter((x) => x && (isGoalie(x.pos) === isGoalie(p.pos)) && (isDefense(x.pos) === isDefense(p.pos)));
  const rank = mates.filter((x) => x.ovr > p.ovr).length;
  const roleCut = isGoalie(p.pos) ? 1 : isDefense(p.pos) ? 4 : 6;
  let m = 0.42 + (pct - 0.5) * 1.3 + (rank < roleCut ? 0.12 : -0.08) + (p.age >= 32 ? 0.1 : 0) + (hash01(p.id + league.year) - 0.5) * 0.35;
  return clamp(m, 0, 1);
}

export function resignAsk(league, p, yrs) {
  const year = league.year + 1;
  const base = contractAsk(p, year, { mood: p.mood ?? 0.5, mult: diff(league).faAskMult });
  const term = yrs ?? base.yrs;
  const aav = round2(clamp(base.aav * (1 + 0.025 * Math.abs(term - base.yrs)), minSalaryForYear(year), maxSalaryForYear(year)));
  return { aav, yrs: term, prefYrs: base.yrs };
}

export function expiringPlayers(league, team) {
  return [...team.roster, ...team.prospects].map((id) => league.players[id]).filter((p) => p && p.signed !== false && p.yrs === 0);
}

export function startResign(league) {
  for (const id in league.players) {
    const p = league.players[id];
    if (p.tid >= 0 && p.signed !== false && p.yrs > 0) {
      p.yrs--;
      if (p.yrs === 0) {
        p.prevCap = p.cap;
        p.cap = 0;
      }
    }
  }
  for (const t of league.teams) {
    t.deadCap = t.deadCap.map((d) => ({ ...d, yrs: d.yrs - 1 })).filter((d) => d.yrs > 0);
    for (const p of expiringPlayers(league, t)) {
      p.mood = playerMood(league, p);
      p.willing = isRFA(p) || p.mood >= 0.2;
    }
  }
  league.phase = "resign";
}

export function resignPlayer(league, pid, yrs) {
  const p = league.players[pid];
  const team = league.teams[p.tid];
  if (!p.willing) return { ok: false, msg: `${p.name} wants to test free agency.` };
  const ask = resignAsk(league, p, yrs);
  if (ask.aav > capSpace(league, team)) return { ok: false, msg: `Not enough cap space for ${p.name} ($${ask.aav.toFixed(2)}M).` };
  p.cap = ask.aav;
  p.yrs = ask.yrs;
  logTx(league, `${team.abbr} re-sign ${p.name} — ${ask.yrs} yr${ask.yrs > 1 ? "s" : ""}, $${ask.aav.toFixed(2)}M AAV`, [team.id]);
  return { ok: true };
}

export function letWalk(league, pid) {
  const p = league.players[pid];
  const team = league.teams[p.tid];
  if (!team) return;
  team.roster = team.roster.filter((x) => x !== pid);
  team.prospects = team.prospects.filter((x) => x !== pid);
  syncLines(league, team);
  p.tid = -1;
  p.yrs = 0;
  p.cap = 0;
  if (!league.freeAgents.includes(pid)) league.freeAgents.push(pid);
}

export function endResign(league) {
  for (const t of league.teams) {
    const expiring = expiringPlayers(league, t);
    for (const p of expiring) {
      if (t.id === league.userTid) {
        letWalk(league, p.id);
        continue;
      }
      let keep = p.ovr >= 86 ? 0.9 : p.ovr >= 82 ? 0.7 : p.ovr >= 78 ? 0.45 : 0.15;
      if (isRFA(p)) keep += 0.2;
      if (p.age >= 35) keep *= 0.5;
      const ask = resignAsk(league, p);
      if (chance(keep) && ask.aav <= capSpace(league, t) - 1) {
        p.cap = ask.aav;
        p.yrs = ask.yrs;
      } else {
        letWalk(league, p.id);
      }
    }
  }
  league.phase = "freeagency";
  league.fa = { day: 0 };
  for (const id of league.freeAgents) {
    const p = league.players[id];
    if (p) p.mood = clamp(0.35 + gauss(0, 0.2), 0, 1);
  }
  // Top up a thin market with journeymen.
  while (league.freeAgents.length < 110) {
    const pos = ["C", "LW", "RW", "LD", "RD", "G", "C", "LD"][randInt(0, 7)];
    const p = generatePlayer(pos, randInt(68, 78), randInt(24, 33), league.year);
    p.tid = -1;
    p.signed = true;
    league.players[p.id] = p;
    league.freeAgents.push(p.id);
  }
}

// What a free agent wants right now (asks fall as the summer drags on).
export function faAsk(league, p, yrs) {
  const offseason = league.phase === "freeagency" || league.phase === "resign";
  const year = offseason ? league.year + 1 : league.year;
  const base = contractAsk(p, year, { mood: p.mood ?? 0.5, mult: diff(league).faAskMult });
  const day = offseason ? league.fa?.day || 0 : FA_DAYS + 10;
  const decay = Math.pow(0.986, day);
  const term = yrs ?? base.yrs;
  const aav = round2(clamp(base.aav * decay * (1 + 0.025 * Math.abs(term - base.yrs)), minSalaryForYear(year), maxSalaryForYear(year)));
  return { aav, yrs: term, prefYrs: base.yrs };
}

function teamAppeal(league, team) {
  const all = league.teams.map((t) => teamRatings(league, t).ovr).sort((a, b) => a - b);
  const mine = teamRatings(league, team).ovr;
  return all.indexOf(mine) / Math.max(1, all.length - 1);
}

export function offerContract(league, pid, aav, yrs) {
  const p = league.players[pid];
  const team = league.teams[league.userTid];
  if (!p || p.tid !== -1) return { ok: false, msg: "That player isn't a free agent." };
  if (!hasRoomFor(league, team)) return { ok: false, msg: `Roster is full (${MAX_ROSTER}). Send a player down or release someone first.` };
  if (aav > capSpace(league, team)) return { ok: false, msg: "That offer would put you over the cap." };
  const ask = faAsk(league, p, yrs);
  const appeal = teamAppeal(league, team);
  const needed = round2(ask.aav * (1.04 - 0.08 * appeal));
  if (aav + 1e-6 < needed) return { ok: false, msg: `${p.name} wants at least $${needed.toFixed(2)}M per year on a ${yrs}-year deal.` };
  signPlayer(league, team, p, aav, yrs);
  return { ok: true, msg: `${p.name} signs with the ${team.name}!` };
}

const TARGET = { F: 13, D: 7, G: 2 };

export function simFADay(league) {
  league.fa.day++;
  const order = shuffle(league.teams.filter((t) => t.id !== league.userTid));
  const pool = () => league.freeAgents.map((id) => league.players[id]).filter(Boolean).sort((a, b) => b.ovr - a.ovr);
  for (const t of order) {
    const c = counts(league, t);
    const short = c.G < TARGET.G ? "G" : c.D < TARGET.D ? "D" : c.F < TARGET.F ? "F" : null;
    const space = capSpace(league, t);
    if (short) {
      if (!chance(0.55)) continue;
      const fits = (p) => (short === "G" ? isGoalie(p.pos) : short === "D" ? isDefense(p.pos) : isForward(p.pos));
      const target = pool().find((p) => fits(p) && faAsk(league, p).aav <= space - 0.5);
      if (target) {
        const ask = faAsk(league, target);
        signPlayer(league, t, target, ask.aav, ask.yrs);
      }
      continue;
    }
    // Teams with room under the cap chase upgrades over their weakest regular.
    if (space < 4 || !chance(0.2)) continue;
    const grp = (p) => (isGoalie(p.pos) ? "G" : isDefense(p.pos) ? "D" : "F");
    const roster = t.roster.map((id) => league.players[id]).filter(Boolean);
    const upgrade = pool().find((p) => {
      if (faAsk(league, p).aav > space - 1.5) return false;
      const worst = roster.filter((x) => grp(x) === grp(p)).sort((a, b) => a.ovr - b.ovr)[0];
      return worst && p.ovr >= worst.ovr + 3 && (grp(p) !== "G" || p.ovr > roster.filter((x) => grp(x) === "G").sort((a, b) => b.ovr - a.ovr)[1]?.ovr + 2);
    });
    if (upgrade) {
      const worst = roster.filter((x) => grp(x) === grp(upgrade)).sort((a, b) => a.ovr - b.ovr)[0];
      if (!hasRoomFor(league, t)) {
        if (canSendDown(worst)) sendDown(league, t, worst.id);
        else releasePlayer(league, t, worst.id);
      }
      const ask = faAsk(league, upgrade);
      signPlayer(league, t, upgrade, ask.aav, ask.yrs);
    }
  }
  return league.fa.day >= FA_DAYS;
}

// Mean OVR of the league's top 600 rostered players; used to keep the rating
// scale anchored to EA's NHL 27 distribution across many seasons.
export function ratingLevel(league) {
  const ovrs = [];
  for (const t of league.teams) for (const id of t.roster) if (league.players[id]) ovrs.push(league.players[id].ovr);
  ovrs.sort((a, b) => b - a);
  const top = ovrs.slice(0, 600);
  return top.reduce((a, b) => a + b, 0) / Math.max(1, top.length);
}

export function startNewSeason(league) {
  const bonus = diff(league).progressionBonus;
  league.ratingAnchor ??= ratingLevel(league);
  const correction = clamp(-0.6 * (ratingLevel(league) - league.ratingAnchor), -1.5, 1.5);
  // Archive stats.
  for (const id in league.players) {
    const p = league.players[id];
    if ((p.stats.gp || p.pstats.gp) && p.tid >= -1) {
      const abbr = league.teams[p.tid]?.abbr || "FA";
      p.career.push({ y: league.year, t: abbr, o: p.ovr, s: compactStats(p.pos, p.stats), ps: p.pstats.gp ? compactStats(p.pos, p.pstats) : null });
    }
  }
  league.year++;
  const retiredNow = [];
  for (const id of Object.keys(league.players)) {
    const p = league.players[id];
    if (p.tid === -2) continue;
    p.age++;
    const before = p.ovr;
    developPlayer(p, correction + (p.tid === league.userTid ? bonus : 0));
    p.lastChange = p.ovr - before;
    p.injury = 0;
    p.stats = blankStats(p.pos);
    p.pstats = blankStats(p.pos);
    const nhlGp = p.career.reduce((s, c) => s + (c.s?.gp || 0), 0);
    p.rookie = nhlGp < 25 && p.age <= 25;
    const inMinors = p.tid >= 0 && league.teams[p.tid].prospects.includes(p.id);
    if (!inMinors && chance(retirementChance(p))) retiredNow.push(p);
  }
  for (const p of retiredNow) retire(league, p);

  // Free-agent pool cleanup: unsigned depth players head to Europe or retire.
  const fas = league.freeAgents.map((id) => league.players[id]).filter(Boolean).sort((a, b) => b.ovr - a.ovr);
  fas.forEach((p, i) => {
    if (p.ovr < 68 || p.age >= 37 || i >= 150) retire(league, p, true);
    else p.mood = clamp(0.5 + gauss(0, 0.15), 0, 1);
  });

  for (const t of league.teams) {
    t.rec = blankRecord();
    t.scoutPts = SCOUT_POINTS_PER_SEASON;
    t.playoffResult = null;
    // Unsigned draft rights lapse at 23.
    for (const id of [...t.prospects]) {
      const p = league.players[id];
      if (!p) continue;
      if (!p.signed && p.age >= 23) {
        if (t.id === league.userTid) league.inbox.push({ year: league.year, day: 0, text: `Draft rights to ${p.name} expired — he is now a free agent.` });
        t.prospects = t.prospects.filter((x) => x !== id);
        p.tid = -1;
        p.signed = true;
        league.freeAgents.push(id);
      } else if (t.id !== league.userTid && ((p.age >= 24 && p.ovr < 74) || (p.age >= 22 && p.pot < 74))) {
        releaseProspect(league, id);
      }
    }
    if (t.id !== league.userTid) aiManageRoster(league, t);
    // AI coaches start fresh each fall; the user's combinations carry over.
    t.nhlLines = null;
    if (t.id === league.userTid) syncLines(league, t);
    else autoLines(league, t);
  }
  league.schedule = generateSchedule(league.teams);
  league.day = 0;
  league.phase = "preseason";
  league.playoffs = null;
  league.awards = null;
  league.draft = null;
  league.fa = null;
  generateDraftClass(league, league.year + 1);
  createDraftPicks(league, league.year + 3);
  league.inbox.push({ year: league.year, day: 0, text: `Welcome to the ${league.year}-${String(league.year + 1).slice(2)} season. Set your lines and start the season when ready.` });
}

function compactStats(pos, st) {
  if (isGoalie(pos)) return { gp: st.gp, w: st.w, l: st.l, otl: st.otl, sa: st.sa, ga: st.ga, so: st.so, toi: st.toi };
  return { gp: st.gp, g: st.g, a: st.a, pts: st.pts, pm: st.pm, pim: st.pim, sog: st.sog, ppg: st.ppg };
}

function retire(league, p, quiet = false) {
  const t = league.teams[p.tid];
  if (t) {
    t.roster = t.roster.filter((x) => x !== p.id);
    t.prospects = t.prospects.filter((x) => x !== p.id);
    if (t.id === league.userTid && !quiet) league.inbox.push({ year: league.year, day: 0, text: `${p.name} has announced his retirement at age ${p.age}.` });
  }
  league.freeAgents = league.freeAgents.filter((x) => x !== p.id);
  const tot = p.career.reduce((a, c) => {
    if (!c.s) return a;
    a.gp += c.s.gp || 0;
    a.g += c.s.g || 0;
    a.a += c.s.a || 0;
    a.w += c.s.w || 0;
    return a;
  }, { gp: 0, g: 0, a: 0, w: 0 });
  if (!quiet && (tot.gp >= 300 || p.ovr >= 85)) {
    league.retired.unshift({ name: p.name, pos: p.pos, age: p.age, year: league.year, ...tot, peak: p.peak || p.ovr });
    if (league.retired.length > 250) league.retired.length = 250;
    logTx(league, `${p.name} retires (${tot.gp} GP${isGoalie(p.pos) ? `, ${tot.w} W` : `, ${tot.g + tot.a} PTS`})`, t ? [t.id] : []);
  }
  delete league.players[p.id];
}

// AI: promote ready prospects, fill holes, stay under 23 and under the cap.
// In-season calls skip cap shedding (emergency call-ups ride like LTIR).
export function aiManageRoster(league, t, { inSeason = false } = {}) {
  const grp = (p) => (isGoalie(p.pos) ? "G" : isDefense(p.pos) ? "D" : "F");
  const rosterOf = () => t.roster.map((id) => league.players[id]).filter(Boolean);
  const ready = t.prospects.map((id) => league.players[id]).filter((p) => p && p.ovr >= 74 && p.age >= 19).sort((a, b) => b.ovr - a.ovr);
  for (const p of ready) {
    const same = rosterOf().filter((x) => grp(x) === grp(p)).sort((a, b) => a.ovr - b.ovr);
    const worst = same[0];
    if (hasRoomFor(league, t) || (worst && p.ovr > worst.ovr + 1)) {
      if (!hasRoomFor(league, t) && worst) {
        if (canSendDown(worst)) sendDown(league, t, worst.id);
        else releasePlayer(league, t, worst.id);
      }
      callUp(league, t, p.id);
    }
  }
  // Fill positional holes from free agency at a sensible price.
  for (const need of ["G", "D", "F"]) {
    let guard = 0;
    while (rosterOf().filter((p) => grp(p) === need).length < TARGET[need] && guard++ < 4 && hasRoomFor(league, t)) {
      const fa = league.freeAgents.map((id) => league.players[id]).filter((p) => p && grp(p) === need).sort((a, b) => b.ovr - a.ovr).find((p) => marketValue(p, league.year) <= capSpace(league, t) - 0.3);
      if (!fa) break;
      signPlayer(league, t, fa, Math.max(minSalaryForYear(league.year), round2(marketValue(fa, league.year) * 0.9)), randInt(1, 3));
    }
  }
  ensureMinimums(league, t);
  // Too many bodies: send down or release the lowest-rated extras.
  let guard = 0;
  while (counts(league, t).active > MAX_ROSTER && guard++ < 10) {
    const c = counts(league, t);
    const extras = rosterOf().filter((p) => (grp(p) === "G" ? c.G > 2 : grp(p) === "D" ? c.D > 7 : c.F > 13)).sort((a, b) => a.ovr - b.ovr);
    const cut = extras[0] || rosterOf().sort((a, b) => a.ovr - b.ovr)[0];
    if (canSendDown(cut)) sendDown(league, t, cut.id);
    else releasePlayer(league, t, cut.id);
  }
  if (inSeason) return;
  // Over the cap: bury cheap extras first, then buy out the most overpaid
  // depth contract. The core (top six by OVR) is never cut.
  guard = 0;
  while (capSpace(league, t) < 0 && guard++ < 8) {
    const core = new Set(rosterOf().sort((a, b) => b.ovr - a.ovr).slice(0, 6).map((p) => p.id));
    const c = counts(league, t);
    const extra = rosterOf()
      .filter((p) => !core.has(p.id) && canSendDown(p) && (grp(p) === "G" ? c.G > 2 : grp(p) === "D" ? c.D > 6 : c.F > 12))
      .sort((a, b) => b.cap - a.cap)[0];
    if (extra && extra.cap > 0.9) {
      sendDown(league, t, extra.id);
      continue;
    }
    const overpaid = rosterOf()
      .filter((p) => !core.has(p.id) && p.cap > 1)
      .sort((a, b) => b.cap - marketValue(b, league.year) - (a.cap - marketValue(a, league.year)))[0];
    if (!overpaid) break;
    releasePlayer(league, t, overpaid.id);
    ensureMinimums(league, t);
  }
}

export { payroll, capForYear };
