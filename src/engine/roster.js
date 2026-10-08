// Team management: payroll, roster limits, signing, releasing, call-ups.
import { capForYear, capFloorForYear, MAX_ROSTER, MIN_FORWARDS, MIN_DEFENSE, MIN_GOALIES, isForward, isDefense, isGoalie, ELC_SALARY, minSalaryForYear } from "./constants.js";
import { generatePlayer, marketValue, round2 } from "./players.js";
import { randInt, pick } from "./rng.js";
import { syncLines } from "./lines.js";

export const IR_GAMES = 7; // players out this long don't count against the 23-man limit

// During the re-sign and free-agency phases teams are budgeting for next season.
export function capYear(league) {
  return league.phase === "resign" || league.phase === "freeagency" ? league.year + 1 : league.year;
}

export function payroll(league, team) {
  let sum = 0;
  for (const id of team.roster) sum += league.players[id]?.cap || 0;
  for (const d of team.deadCap || []) sum += d.amt;
  return round2(sum);
}

export function capSpace(league, team) {
  return round2(capForYear(capYear(league)) - payroll(league, team));
}

export function counts(league, team, { healthyOnly = false } = {}) {
  const c = { F: 0, D: 0, G: 0, total: 0, active: 0 };
  for (const id of team.roster) {
    const p = league.players[id];
    if (!p) continue;
    if (healthyOnly && p.injury > 0) continue;
    c.total++;
    if (p.injury < IR_GAMES) c.active++;
    if (isGoalie(p.pos)) c.G++;
    else if (isDefense(p.pos)) c.D++;
    else c.F++;
  }
  return c;
}

export function rosterIssues(league, team) {
  const issues = [];
  const h = counts(league, team, { healthyOnly: true });
  const all = counts(league, team);
  if (h.F < MIN_FORWARDS) issues.push(`Need ${MIN_FORWARDS} healthy forwards (have ${h.F}).`);
  if (h.D < MIN_DEFENSE) issues.push(`Need ${MIN_DEFENSE} healthy defensemen (have ${h.D}).`);
  if (h.G < MIN_GOALIES) issues.push(`Need ${MIN_GOALIES} healthy goalies (have ${h.G}).`);
  if (all.active > MAX_ROSTER) issues.push(`Roster has ${all.active} active players (max ${MAX_ROSTER}). Send someone to the minors or release.`);
  if (capSpace(league, team) < 0) issues.push(`Over the salary cap by $${(-capSpace(league, team)).toFixed(2)}M.`);
  return issues;
}

// How far a team's payroll is under the cap floor (0 if it's above it).
export function capFloorGap(league, team) {
  return round2(Math.max(0, capFloorForYear(capYear(league)) - payroll(league, team)));
}

export function hasRoomFor(league, team, extra = 1) {
  return counts(league, team).active + extra <= MAX_ROSTER;
}

export function addToRoster(league, team, p) {
  p.tid = team.id;
  team.prospects = team.prospects.filter((x) => x !== p.id);
  if (!team.roster.includes(p.id)) team.roster.push(p.id);
  queueForLines(league, team, [p.id]);
}

// New arrivals are worked into the lineup if they're better than who's there.
export function queueForLines(league, team, ids) {
  team.linesNew = [...(team.linesNew || []), ...ids];
  syncLines(league, team);
}

export function signPlayer(league, team, p, aav, yrs) {
  league.freeAgents = league.freeAgents.filter((x) => x !== p.id);
  p.cap = round2(aav);
  p.yrs = yrs;
  p.signed = true;
  p.mood = undefined;
  addToRoster(league, team, p);
  logTx(league, `${team.abbr} sign ${p.name} (${p.pos}, ${p.ovr}) — ${yrs} yr${yrs > 1 ? "s" : ""}, $${p.cap.toFixed(2)}M AAV`, [team.id]);
}

// Release: buyout at one-third of the cap hit for twice the remaining term.
export function releasePlayer(league, team, pid) {
  const p = league.players[pid];
  if (!p) return;
  team.roster = team.roster.filter((x) => x !== pid);
  team.prospects = team.prospects.filter((x) => x !== pid);
  if (p.yrs > 0 && p.cap > 0 && p.signed !== false) {
    const amt = round2(p.cap / 3);
    if (amt >= 0.05) team.deadCap.push({ name: p.name, amt, yrs: p.yrs * 2 });
  }
  p.tid = -1;
  p.yrs = 0;
  p.cap = 0;
  if (!league.freeAgents.includes(pid)) league.freeAgents.push(pid);
  syncLines(league, team);
  logTx(league, `${team.abbr} release ${p.name}`, [team.id]);
}

// Minors: young/cheap players can be sent down; their cap hit leaves the books.
export function canSendDown(p) {
  return p.age <= 23 || p.cap <= 1.25;
}

export function sendDown(league, team, pid) {
  const p = league.players[pid];
  if (!p || !canSendDown(p)) return false;
  team.roster = team.roster.filter((x) => x !== pid);
  if (!team.prospects.includes(pid)) team.prospects.push(pid);
  syncLines(league, team);
  return true;
}

// Call up from the minors; unsigned draft picks get an entry-level deal.
export function callUp(league, team, pid) {
  const p = league.players[pid];
  if (!p || !team.prospects.includes(pid)) return false;
  if (!p.signed) {
    p.cap = p.age <= 24 ? ELC_SALARY : minSalaryForYear(league.year);
    p.yrs = 3;
    p.signed = true;
    logTx(league, `${team.abbr} sign ${p.name} to an entry-level contract`, [team.id]);
  }
  addToRoster(league, team, p);
  return true;
}

export function logTx(league, text, tids = []) {
  league.transactions.unshift({ year: league.year, day: league.day, phase: league.phase, text, tids });
  if (league.transactions.length > 600) league.transactions.length = 600;
}

// Keep a team dressable: promote, sign or generate depth when injuries pile up.
export function ensureMinimums(league, team, { notify = false } = {}) {
  const need = () => {
    const h = counts(league, team, { healthyOnly: true });
    if (h.G < MIN_GOALIES) return "G";
    if (h.D < MIN_DEFENSE) return "D";
    if (h.F < MIN_FORWARDS) return "F";
    return null;
  };
  let guard = 0;
  let grp;
  while ((grp = need()) && guard++ < 10) {
    const fits = (p) => (grp === "G" ? isGoalie(p.pos) : grp === "D" ? isDefense(p.pos) : isForward(p.pos));
    // Best prospect who fits under the cap (an unsigned pick comes up on an entry-level deal).
    const room = Math.max(capSpace(league, team), ELC_SALARY);
    const ready = team.prospects.map((id) => league.players[id]).filter((p) => p && fits(p) && p.injury <= 0 && p.ovr >= 60).sort((a, b) => b.ovr - a.ovr);
    const prospect = ready.find((p) => (p.signed === false ? ELC_SALARY : p.cap) <= room) || ready[0];
    if (prospect) {
      callUp(league, team, prospect.id);
      if (notify) league.inbox.push({ year: league.year, day: league.day, text: `Emergency call-up: ${prospect.name} (${prospect.pos}, ${prospect.ovr}) joins the roster.` });
      continue;
    }
    const fa = league.freeAgents.map((id) => league.players[id]).filter((p) => p && fits(p) && p.injury <= 0).sort((a, b) => b.ovr - a.ovr).find((p) => marketValue(p, league.year) <= Math.max(1.0, capSpace(league, team)));
    if (fa) {
      signPlayer(league, team, fa, Math.min(marketValue(fa, league.year), Math.max(minSalaryForYear(league.year), capSpace(league, team))), 1);
      if (notify) league.inbox.push({ year: league.year, day: league.day, text: `Emergency signing: ${fa.name} (${fa.pos}, ${fa.ovr}).` });
      continue;
    }
    const pos = grp === "G" ? "G" : grp === "D" ? pick(["LD", "RD"]) : pick(["C", "LW", "RW"]);
    const p = generatePlayer(pos, randInt(69, 74), randInt(22, 29), league.year);
    league.players[p.id] = p;
    p.cap = minSalaryForYear(league.year);
    p.yrs = 1;
    p.signed = true;
    addToRoster(league, team, p);
    logTx(league, `${team.abbr} call up ${p.name} (${p.pos}) from the AHL`, [team.id]);
  }
  syncLines(league, team);
}

export function topPlayers(league, team, n = 3) {
  return team.roster.map((id) => league.players[id]).filter(Boolean).sort((a, b) => b.ovr - a.ovr).slice(0, n);
}

export function payrollBreakdown(league, team) {
  return team.roster.map((id) => league.players[id]).filter(Boolean).sort((a, b) => b.cap - a.cap);
}

export { round2 };
