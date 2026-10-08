// League orchestration: creation from the NHL 27 roster file (or a random
// league), daily simulation, phase transitions and save/load.
import rosterFile from "../data/nhl27-rosters.json" with { type: "json" };
import LZString from "lz-string";
import { TEAMS } from "./teams.js";
import { seed as seedRng, randInt, pick, chance, gauss, clamp } from "./rng.js";
import { createPlayer, generatePlayer, marketValue } from "./players.js";
import { FIRST_SEASON, SCOUT_POINTS_PER_SEASON, SAVE_KEY, SAVE_VERSION, MAX_ROSTER, isGoalie, isDefense, minSalaryForYear } from "./constants.js";
import { autoLines, linesFromNames, lineupIds, coachLines } from "./lines.js";
import { generateSchedule, lastDay } from "./schedule.js";
import { createGame, simToEnd, applyResult, blankRecord } from "./sim.js";
import { generateDraftClass, createDraftPicks, startDraft, finishDraft, draftDone } from "./draft.js";
import { startPlayoffs, simPlayoffDay } from "./playoffs.js";
import { computeAwards, connSmythe } from "./awards.js";
import { ensureMinimums, counts, sendDown, canSendDown, logTx, IR_GAMES } from "./roster.js";
import { startResign, endResign, startNewSeason, aiManageRoster, ratingLevel } from "./offseason.js";

export function createLeague({ userAbbr = "TOR", mode = "real", difficulty = "normal", seed } = {}) {
  if (seed != null) seedRng(seed);
  const year = FIRST_SEASON;
  const league = {
    version: SAVE_VERSION,
    mode,
    year,
    startYear: year,
    phase: "preseason",
    day: 0,
    settings: { difficulty },
    teams: TEAMS.map((t, i) => ({
      id: i,
      ...t,
      roster: [],
      prospects: [],
      lines: null,
      rec: blankRecord(),
      deadCap: [],
      scoutPts: SCOUT_POINTS_PER_SEASON,
      autoGoalie: true,
      playoffResult: null,
    })),
    players: {},
    freeAgents: [],
    draftPicks: [],
    draftClass: [],
    schedule: [],
    playoffs: null,
    draft: null,
    awards: null,
    history: [],
    retired: [],
    transactions: [],
    inbox: [],
    userTid: 0,
  };
  const user = league.teams.find((t) => t.abbr === userAbbr) || league.teams[0];
  league.userTid = user.id;

  if (mode === "real") loadRealRosters(league);
  else generateRandomRosters(league);

  for (const t of league.teams) {
    const real = mode === "real" ? rosterFile.lines?.[t.abbr] : null;
    addMinorLeaguers(league, t);
    ensureMinimums(league, t);
    trimToLimit(league, t, real ? namedPlayers(league, t, real) : new Set());
    if (real) linesFromNames(league, t, real);
    else autoLines(league, t);
  }
  seedFreeAgents(league);
  league.ratingAnchor = ratingLevel(league);
  for (let y = year + 1; y <= year + 3; y++) createDraftPicks(league, y);
  generateDraftClass(league, year + 1);
  league.schedule = generateSchedule(league.teams);
  league.deadlineDay = Math.floor(lastDay(league.schedule) * 0.78);
  league.inbox.push({ year, day: 0, text: `Welcome, GM of the ${user.city} ${user.name}! Rosters and ratings are from EA SPORTS NHL 27, and every team starts with its real opening-week line combinations. Check the Lines tab, then start the season.` });
  return league;
}

function loadRealRosters(league) {
  for (const t of league.teams) {
    const entries = rosterFile.teams[t.abbr] || [];
    for (const e of entries) {
      const p = createPlayer({ ...e, age: league.year - e.born, tid: t.id }, league.year);
      p.signed = true;
      p.rookie = p.age <= 20;
      league.players[p.id] = p;
      t.roster.push(p.id);
    }
    // Players reported injured (or otherwise unavailable) at the start of the season.
    for (const o of rosterFile.lines?.[t.abbr]?.out || []) {
      const p = t.roster.map((id) => league.players[id]).find((x) => x.name === o.name);
      if (!p) continue;
      p.injury = o.games;
      p.injuryNote = o.note;
    }
  }
}

// Everyone named in a team's real lines or injury list (protected from roster trimming).
function namedPlayers(league, t, real) {
  const names = new Set([...real.F.flat(), ...real.D.flat(), ...real.G, ...(real.out || []).map((o) => o.name)].filter(Boolean));
  return new Set(t.roster.filter((id) => names.has(league.players[id].name)));
}

function generateRandomRosters(league) {
  const shape = [["C", 4], ["LW", 5], ["RW", 5], ["LD", 4], ["RD", 4], ["G", 2]];
  for (const t of league.teams) {
    const strength = gauss(0, 2.2);
    for (const [pos, n] of shape) {
      for (let i = 0; i < n; i++) {
        const tierTop = pos === "G" ? (i === 0 ? 87 : 79) : 90 - i * (pos.length === 2 && pos[1] === "D" ? 3.2 : 3.4);
        const ovr = Math.round(clamp(tierTop + strength + gauss(0, 2.5), 68, 97));
        const p = generatePlayer(pos, ovr, randInt(20, 34), league.year, { tid: t.id });
        p.signed = true;
        p.cap = marketValue(p, league.year);
        p.yrs = randInt(1, 6);
        league.players[p.id] = p;
        t.roster.push(p.id);
      }
    }
  }
}

function addMinorLeaguers(league, t) {
  const shape = ["C", "LW", "RW", "LD", "RD", "G", pick(["C", "LW", "RW"]), pick(["LD", "RD"])];
  for (const pos of shape) {
    const age = randInt(19, 24);
    const p = generatePlayer(pos, randInt(64, 73), age, league.year, { tid: t.id });
    p.pot = clamp(p.ovr + randInt(2, 12) - Math.max(0, age - 21) * 2, p.ovr, 88);
    p.signed = true;
    p.cap = age <= 23 ? 0.95 : minSalaryForYear(league.year);
    p.yrs = randInt(1, 3);
    league.players[p.id] = p;
    t.prospects.push(p.id);
  }
}

// Send the lowest-rated extras to the minors until the roster fits. Players in the
// real opening-night lineup are kept; so is a third goalie if he's not the weakest.
function trimToLimit(league, t, keep = new Set()) {
  let guard = 0;
  while (counts(league, t).active > MAX_ROSTER && guard++ < 12) {
    const ps = t.roster.map((id) => league.players[id]).filter((p) => p.injury < IR_GAMES).sort((a, b) => a.ovr - b.ovr);
    const g = ps.filter((p) => isGoalie(p.pos));
    const extras = ps.filter((p) => !keep.has(p.id) && (!isGoalie(p.pos) || g.length > 2));
    const victim = extras[0] || (g.length > 2 ? g[0] : ps.find((p) => !isGoalie(p.pos)));
    if (canSendDown(victim)) sendDown(league, t, victim.id);
    else {
      t.roster = t.roster.filter((x) => x !== victim.id);
      t.prospects.push(victim.id);
    }
  }
}

function seedFreeAgents(league) {
  for (let i = 0; i < 45; i++) {
    const pos = ["C", "LW", "RW", "LD", "RD", "G", "C", "LD", "RW"][i % 9];
    const p = generatePlayer(pos, randInt(70, 79), randInt(25, 34), league.year);
    p.tid = -1;
    p.signed = true;
    p.mood = 0.5;
    league.players[p.id] = p;
    league.freeAgents.push(p.id);
  }
}

// ---------- Regular season ----------

export const gamesOnDay = (league, day) => league.schedule.filter((g) => g.day === day);

export function userGameOnDay(league, day = league.day) {
  return league.schedule.find((g) => g.day === day && !g.played && (g.h === league.userTid || g.a === league.userTid)) || null;
}

export function seasonOver(league) {
  return league.schedule.every((g) => g.played);
}

export function startRegularSeason(league) {
  league.phase = "regular";
  league.day = 0;
  league.deadlineDay = Math.floor(lastDay(league.schedule) * 0.78);
  logTx(league, `${league.year}-${String(league.year + 1).slice(2)} regular season begins`);
}

function healDay(league, playedTids) {
  for (const id in league.players) {
    const p = league.players[id];
    if (p.injury > 0 && playedTids.has(p.tid)) {
      p.injury--;
      // Back from injury: if he'd lost his spot, he's considered for the lineup again.
      const t = p.injury === 0 && league.teams[p.tid];
      if (t && t.lines && !lineupIds(t.lines).includes(p.id)) (t.linesNew ||= []).push(p.id);
    }
  }
}

export function playScheduledGame(league, g, state) {
  const result = applyResult(league, state, { playoff: false });
  const mine = g.h === league.userTid || g.a === league.userTid;
  Object.assign(g, { played: true, hs: result.hs, as: result.as, ot: result.ot, shots: result.shots, stars: result.stars, gl: result.g });
  if (mine) g.goals = result.goals;
  return result;
}

// Simulate the current day. If `holdUserGame`, the user's game is left for live play.
export function simDay(league, { holdUserGame = false } = {}) {
  if (league.phase !== "regular") return false;
  const todays = gamesOnDay(league, league.day).filter((g) => !g.played);
  const played = new Set();
  for (const t of league.teams) {
    ensureMinimums(league, t, { notify: t.id === league.userTid });
  }
  for (const g of todays) {
    if (holdUserGame && (g.h === league.userTid || g.a === league.userTid)) continue;
    const state = createGame(league, league.teams[g.h], league.teams[g.a], { userTid: league.userTid });
    simToEnd(state);
    playScheduledGame(league, g, state);
    played.add(g.h);
    played.add(g.a);
  }
  if (holdUserGame && userGameOnDay(league)) return true;
  finishDay(league, played);
  return true;
}

export function finishDay(league, played) {
  const ids = played || new Set(gamesOnDay(league, league.day).flatMap((g) => [g.h, g.a]));
  healDay(league, ids);
  // AI rosters adjust to injuries periodically.
  if (league.day % 7 === 0) {
    for (const t of league.teams) {
      if (t.id === league.userTid) continue;
      aiManageRoster(league, t, { inSeason: true });
      if (league.day >= 7) coachLines(league, t);
    }
  }
  league.day++;
  while (league.day <= lastDay(league.schedule) && !gamesOnDay(league, league.day).length) league.day++;
}

export function simDays(league, n, { stopAtUserGame = false } = {}) {
  for (let i = 0; i < n && league.phase === "regular" && !seasonOver(league); i++) {
    if (stopAtUserGame && i > 0 && userGameOnDay(league)) break;
    simDay(league);
  }
}

export function simToDeadline(league) {
  while (league.phase === "regular" && league.day <= league.deadlineDay && !seasonOver(league)) simDay(league);
}

export function simRestOfSeason(league) {
  while (league.phase === "regular" && !seasonOver(league)) simDay(league);
}

export function endRegularSeason(league) {
  league.awards = computeAwards(league);
  startPlayoffs(league);
  league.phase = "playoffs";
  const ut = league.teams[league.userTid];
  if (ut) league.inbox.push({ year: league.year, day: league.day, text: ut.playoffResult ? `The ${ut.name} are in the playoffs! First round starts now.` : `The ${ut.name} missed the playoffs this season.` });
}

// ---------- Playoffs → offseason ----------

export function finishPlayoffs(league) {
  const champ = league.playoffs.champion;
  league.awards.connSmythe = connSmythe(league, champ);
  const final = league.playoffs.rounds[3][0];
  league.history.unshift({
    year: league.year,
    champion: champ,
    runnerUp: final.top === champ ? final.bot : final.top,
    presidents: [...league.teams].sort((a, b) => b.rec.pts - a.rec.pts)[0].id,
    awards: league.awards,
    userRec: league.teams[league.userTid] ? { ...league.teams[league.userTid].rec, playoff: league.teams[league.userTid].playoffResult } : null,
  });
  logTx(league, `The ${league.teams[champ].city} ${league.teams[champ].name} win the Stanley Cup!`);
  startDraft(league);
  league.phase = "draft";
}

export function completeDraft(league) {
  if (!draftDone(league)) return false;
  finishDraft(league);
  startResign(league);
  return true;
}

export function goToFreeAgency(league) {
  endResign(league);
}

export function beginNextSeason(league) {
  startNewSeason(league);
  league.deadlineDay = Math.floor(lastDay(league.schedule) * 0.78);
}

// ---------- Save / load ----------

// Saves are LZ-compressed (roughly 8x smaller) so long dynasties fit in localStorage.
export function serializeLeague(league) {
  return LZString.compressToUTF16(JSON.stringify(league));
}

// Portable export: a small JSON wrapper around base64-compressed league data.
export function exportLeagueText(league) {
  return JSON.stringify({ rinkgm: SAVE_VERSION, league: LZString.compressToBase64(JSON.stringify(league)) });
}

export function deserializeLeague(raw) {
  if (!raw) return null;
  let json;
  if (raw.startsWith("{")) {
    const obj = JSON.parse(raw);
    if (obj && typeof obj.league === "string") json = LZString.decompressFromBase64(obj.league);
    else return obj && obj.version === SAVE_VERSION ? obj : null;
  } else {
    json = LZString.decompressFromUTF16(raw);
  }
  const l = json ? JSON.parse(json) : null;
  return l && l.version === SAVE_VERSION ? l : null;
}

export function saveSummary(league) {
  const t = league.teams[league.userTid];
  return { team: `${t.city} ${t.name}`, year: league.year, phase: league.phase };
}

export function saveLeague(league, key = SAVE_KEY) {
  league.savedAt = Date.now();
  try {
    localStorage.setItem(key, serializeLeague(league));
    return true;
  } catch (e) {
    console.warn("Save failed", e);
    return false;
  }
}

export function loadLeague(key = SAVE_KEY) {
  try {
    return deserializeLeague(localStorage.getItem(key));
  } catch {
    return null;
  }
}

export function hasSave(key = SAVE_KEY) {
  try {
    return !!localStorage.getItem(key);
  } catch {
    return false;
  }
}

export function deleteSave(key = SAVE_KEY) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export { simPlayoffDay, rosterFile };
