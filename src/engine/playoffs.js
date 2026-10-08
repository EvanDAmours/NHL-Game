// Stanley Cup Playoffs: 16 teams, four best-of-seven rounds, fixed bracket.
import { playoffPicture, compareTeams } from "./standings.js";
import { createGame, simToEnd, applyResult } from "./sim.js";

const HOME_PATTERN = [true, true, false, false, true, false, true]; // 2-2-1-1-1 from the top seed's view

function series(league, round, a, b, conf) {
  // Higher regular-season finish gets home ice.
  const [top, bot] = compareTeams(league.teams[a], league.teams[b]) <= 0 ? [a, b] : [b, a];
  return { round, conf, top, bot, wTop: 0, wBot: 0, games: [], winner: null };
}

export function startPlayoffs(league) {
  const r1 = [];
  for (const conf of ["East", "West"]) {
    const pic = playoffPicture(league, conf);
    const [d1, d2] = pic.order;
    const w1 = pic.divs[d1][0];
    const w2 = pic.divs[d2][0];
    const [wc1, wc2] = pic.wildcards;
    // The better division winner faces the lower wild card.
    const d1Better = compareTeams(w1, w2) <= 0;
    const opp1 = d1Better ? wc2 : wc1;
    const opp2 = d1Better ? wc1 : wc2;
    r1.push(series(league, 0, w1.id, opp1.id, conf));
    r1.push(series(league, 0, pic.divs[d1][1].id, pic.divs[d1][2].id, conf));
    r1.push(series(league, 0, w2.id, opp2.id, conf));
    r1.push(series(league, 0, pic.divs[d2][1].id, pic.divs[d2][2].id, conf));
  }
  league.playoffs = { rounds: [r1], round: 0, champion: null, seeds: seedMap(league, r1) };
  for (const t of league.teams) t.playoffResult = null;
  for (const s of r1) {
    league.teams[s.top].playoffResult = "R1";
    league.teams[s.bot].playoffResult = "R1";
  }
  return league.playoffs;
}

function seedMap(league, r1) {
  const m = {};
  for (const s of r1) {
    m[s.top] = true;
    m[s.bot] = true;
  }
  return m;
}

export const ROUND_NAMES = ["First Round", "Second Round", "Conference Final", "Stanley Cup Final"];

export function currentRound(league) {
  const po = league.playoffs;
  return po ? po.rounds[po.round] : [];
}

export function seriesHome(s) {
  const gameNo = s.games.length;
  return HOME_PATTERN[gameNo] ? s.top : s.bot;
}

// Next unplayed game of a series, as { home, away }.
export function nextGame(league, s) {
  if (s.winner != null) return null;
  const home = seriesHome(s);
  const away = home === s.top ? s.bot : s.top;
  return { home, away };
}

export function recordSeriesGame(league, s, state, result) {
  const winnerTid = state.winner === "h" ? state.h.tid : state.a.tid;
  s.games.push({ h: state.h.tid, a: state.a.tid, hs: result.hs, as: result.as, ot: result.ot, stars: result.stars });
  if (winnerTid === s.top) s.wTop++;
  else s.wBot++;
  if (s.wTop === 4 || s.wBot === 4) {
    s.winner = s.wTop === 4 ? s.top : s.bot;
    const loser = s.winner === s.top ? s.bot : s.top;
    league.teams[loser].playoffResult = `Lost ${ROUND_NAMES[s.round]}`;
    const next = ["R2", "R3", "Final", "Champion"][s.round];
    league.teams[s.winner].playoffResult = next;
  }
}

// Play one game in every live series of the current round. `skip` lets the UI
// hold back the user's game for live play.
export function simPlayoffDay(league, { skipSeries = null } = {}) {
  const po = league.playoffs;
  if (!po || po.champion != null) return false;
  const round = po.rounds[po.round];
  for (const s of round) {
    if (s.winner != null || s === skipSeries) continue;
    const g = nextGame(league, s);
    const state = createGame(league, league.teams[g.home], league.teams[g.away], { playoff: true, userTid: league.userTid });
    simToEnd(state);
    const result = applyResult(league, state, { playoff: true });
    recordSeriesGame(league, s, state, result);
  }
  advanceRoundIfDone(league);
  return true;
}

export function advanceRoundIfDone(league) {
  const po = league.playoffs;
  const round = po.rounds[po.round];
  if (round.some((s) => s.winner == null)) return false;
  if (po.round === 3) {
    po.champion = round[0].winner;
    return true;
  }
  const next = [];
  for (let i = 0; i < round.length; i += 2) {
    const a = round[i].winner;
    const b = round[i + 1].winner;
    const conf = po.round === 2 ? "Final" : round[i].conf;
    next.push(series(league, po.round + 1, a, b, conf));
  }
  po.rounds.push(next);
  po.round++;
  return true;
}

export function userSeries(league) {
  const round = currentRound(league);
  return round.find((s) => s.winner == null && (s.top === league.userTid || s.bot === league.userTid)) || null;
}
