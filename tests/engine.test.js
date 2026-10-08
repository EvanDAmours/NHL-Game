import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../src/engine/league.js";
import { generateSchedule } from "../src/engine/schedule.js";
import { TEAMS } from "../src/engine/teams.js";
import { generateAttributes, computeOvr } from "../src/engine/ratings.js";
import { simPlayoffDay } from "../src/engine/playoffs.js";
import { simDraftToUser, draftDone } from "../src/engine/draft.js";
import { simFADay, expiringPlayers } from "../src/engine/offseason.js";
import { counts, capSpace, canSendDown, releasePlayer, payroll } from "../src/engine/roster.js";
import { marketValue } from "../src/engine/players.js";
import { faAsk } from "../src/engine/offseason.js";
import { restShare } from "../src/engine/sim.js";
import { gameLines, syncLines, lineupIds } from "../src/engine/lines.js";
import { evaluateTrade, executeTrade, tradingClosed, isContending } from "../src/engine/trade.js";
import { toggleUserBlock, onBlock, deadlinePending, startDeadline, deadlineTick, userOffers, acceptOffer, DEADLINE_START, DEADLINE_END } from "../src/engine/market.js";
import { conferenceTable } from "../src/engine/standings.js";
import { parseRatingsCsv, matchRows, applyRatings } from "../src/engine/importer.js";
import { MAX_ROSTER, capFloorForYear, SCOUT_POINTS_START, SCOUT_POINTS_COMBINE, COMBINE_INVITES, COMBINE_INTERVIEWS } from "../src/engine/constants.js";
import { classPool, csRank, scoutGroup, prospectRead, scoutProspect, scoutCost, hireScout, staffWindowOpen, atCombine, interviewProspect, pickGrade } from "../src/engine/scouting.js";
import rosterFile from "../src/data/nhl27-rosters.json" with { type: "json" };

test("roster file: 32 teams, valid entries, no duplicates", () => {
  const abbrs = Object.keys(rosterFile.teams);
  assert.equal(abbrs.length, 32);
  assert.deepEqual([...abbrs].sort(), TEAMS.map((t) => t.abbr).sort());
  const names = new Set();
  for (const [ab, ps] of Object.entries(rosterFile.teams)) {
    assert.ok(ps.filter((p) => ["C", "LW", "RW"].includes(p.pos)).length >= 12, `${ab} forwards`);
    assert.ok(ps.filter((p) => ["LD", "RD"].includes(p.pos)).length >= 6, `${ab} defense`);
    assert.ok(ps.filter((p) => p.pos === "G").length >= 2, `${ab} goalies`);
    for (const p of ps) {
      assert.ok(p.ovr >= 60 && p.ovr <= 99, `${p.name} ovr`);
      assert.ok(["ea27", "est"].includes(p.src));
      assert.ok(!names.has(p.name), `duplicate ${p.name}`);
      names.add(p.name);
    }
  }
});

test("attribute generation reproduces the target OVR exactly", () => {
  for (const [type, pos] of [["SNP", "RW"], ["PLY", "C"], ["DFD", "LD"], ["OFD", "RD"], ["BFY", "G"], ["ENF", "LW"]]) {
    for (const ovr of [62, 75, 84, 91, 97, 99]) {
      assert.equal(computeOvr(generateAttributes(ovr, type, pos), type), ovr, `${type} ${ovr}`);
    }
  }
});

test("EA ratings survive league creation", () => {
  const lg = L.createLeague({ userAbbr: "EDM", seed: 1 });
  const mcdavid = Object.values(lg.players).find((p) => p.name === "Connor McDavid");
  assert.equal(mcdavid.ovr, 99);
  assert.equal(mcdavid.src, "ea27");
  assert.equal(lg.teams[mcdavid.tid].abbr, "EDM");
  for (const t of lg.teams) assert.ok(counts(lg, t).active <= MAX_ROSTER, `${t.abbr} roster size`);
});

test("schedule: 82 games per team, 41 at home, no team twice a day", () => {
  const teams = TEAMS.map((t, i) => ({ ...t, id: i }));
  const sched = generateSchedule(teams);
  assert.equal(sched.length, 32 * 41);
  for (const t of teams) {
    assert.equal(sched.filter((g) => g.h === t.id || g.a === t.id).length, 82);
    assert.equal(sched.filter((g) => g.h === t.id).length, 41);
  }
  const byDay = new Map();
  for (const g of sched) {
    const set = byDay.get(g.day) || new Set();
    assert.ok(!set.has(g.h) && !set.has(g.a), "team plays twice on one day");
    set.add(g.h);
    set.add(g.a);
    byDay.set(g.day, set);
  }
});

test("a simulated season produces NHL-like scoring", () => {
  const lg = L.createLeague({ userAbbr: "TOR", seed: 42 });
  L.startRegularSeason(lg);
  L.simRestOfSeason(lg);
  assert.ok(L.seasonOver(lg));
  const games = lg.schedule;
  const goals = games.reduce((s, g) => s + g.hs + g.as, 0) / games.length / 2;
  const shots = games.reduce((s, g) => s + g.shots.h + g.shots.a, 0) / games.length / 2;
  const extra = games.filter((g) => g.ot).length / games.length;
  assert.ok(goals > 2.5 && goals < 3.5, `goals/team/game ${goals}`);
  assert.ok(shots > 26 && shots < 34, `shots/team/game ${shots}`);
  assert.ok(extra > 0.15 && extra < 0.35, `OT/SO share ${extra}`);
  for (const t of lg.teams) {
    assert.equal(t.rec.gp, 82);
    assert.equal(t.rec.pts, t.rec.w * 2 + t.rec.otl);
    assert.ok(t.rec.pts > 40 && t.rec.pts < 140, `${t.abbr} ${t.rec.pts} pts`);
  }
});

test("full offseason cycle: playoffs, draft, re-sign, free agency, new season", () => {
  const lg = L.createLeague({ userAbbr: "NYR", seed: 9 });
  L.startRegularSeason(lg);
  L.simRestOfSeason(lg);
  L.endRegularSeason(lg);
  assert.equal(lg.playoffs.rounds[0].length, 8);
  let guard = 0;
  while (lg.playoffs.champion == null && guard++ < 100) simPlayoffDay(lg);
  assert.ok(lg.playoffs.champion != null);
  L.finishPlayoffs(lg);
  assert.equal(lg.phase, "draft");
  simDraftToUser(lg, { all: true });
  assert.ok(draftDone(lg));
  assert.equal(lg.draft.slots.filter((s) => s.pid).length, 128);
  L.completeDraft(lg);
  assert.equal(lg.phase, "resign");
  const user = lg.teams[lg.userTid];
  assert.ok(expiringPlayers(lg, user).every((p) => p.signed !== false), "unsigned picks are not expiring contracts");
  L.goToFreeAgency(lg);
  while (!simFADay(lg)) {}
  L.beginNextSeason(lg);
  assert.equal(lg.phase, "preseason");
  assert.equal(lg.year, 2027);
  // Every AI club reaches the cap floor (by signing players or paying the shortfall).
  for (const t of lg.teams) if (t.id !== lg.userTid) assert.ok(payroll(lg, t) >= capFloorForYear(lg.year) - 0.01, `${t.abbr} under the floor`);
  assert.equal(lg.history.length, 1);
  for (const t of lg.teams) {
    if (t.id === lg.userTid) continue;
    const c = counts(lg, t);
    assert.ok(c.active <= MAX_ROSTER && c.F >= 12 && c.D >= 6 && c.G >= 2, `${t.abbr} roster ${JSON.stringify(c)}`);
  }
});

test("trade AI refuses lopsided deals and accepts fair value", () => {
  const lg = L.createLeague({ userAbbr: "CHI", seed: 5 });
  const chi = lg.teams.find((t) => t.abbr === "CHI");
  const edm = lg.teams.find((t) => t.abbr === "EDM");
  const mcdavid = edm.roster.find((id) => lg.players[id].name === "Connor McDavid");
  const scrub = chi.roster.map((id) => lg.players[id]).sort((a, b) => a.ovr - b.ovr)[0];
  const bad = evaluateTrade(lg, { from: chi.id, to: edm.id, give: [scrub.id], get: [mcdavid], givePicks: [], getPicks: [] });
  assert.equal(bad.accept, false);
  const firsts = lg.draftPicks.filter((p) => p.owner === chi.id && p.round <= 2).map((p) => p.id);
  const depth = edm.roster.map((id) => lg.players[id]).sort((a, b) => a.ovr - b.ovr)[0];
  const good = evaluateTrade(lg, { from: chi.id, to: edm.id, give: [], get: [depth.id], givePicks: firsts, getPicks: [] });
  assert.equal(good.accept, true, good.problems.join(";"));
  executeTrade(lg, { from: chi.id, to: edm.id, give: [], get: [depth.id], givePicks: firsts, getPicks: [] });
  assert.equal(lg.players[depth.id].tid, chi.id);
  assert.ok(lg.draftPicks.filter((p) => firsts.includes(p.id)).every((p) => p.owner === edm.id));
});

test("ratings import updates OVR and marks players as EA", () => {
  const lg = L.createLeague({ userAbbr: "TOR", seed: 3 });
  const { rows, errors } = parseRatingsCsv("name,team,pos,ovr\nMorgan Rielly,TOR,LD,86\nNot A Player,TOR,C,80");
  assert.equal(errors.length, 0);
  const matches = matchRows(lg, rows);
  assert.ok(matches[0].player);
  assert.equal(matches[1].player, null);
  const rep = applyRatings(lg, matches, { markEA: true });
  assert.equal(rep.updated, 1);
  const rielly = Object.values(lg.players).find((p) => p.name === "Morgan Rielly");
  assert.equal(rielly.ovr, 86);
  assert.equal(rielly.src, "ea27");
});

test("save round-trips through compression", () => {
  const lg = L.createLeague({ userAbbr: "MTL", seed: 4 });
  const back = L.deserializeLeague(L.serializeLeague(lg));
  assert.equal(back.teams.length, 32);
  assert.equal(Object.keys(back.players).length, Object.keys(lg.players).length);
});

test("real NHL line combinations are set at league creation", () => {
  const lg = L.createLeague({ userAbbr: "TOR", seed: 5 });
  for (const t of lg.teams) {
    const real = rosterFile.lines[t.abbr];
    assert.ok(real, `${t.abbr} has real lines`);
    const name = (id) => lg.players[id]?.name ?? null;
    real.F.forEach((line, i) => line.forEach((n, j) => n && assert.equal(name(t.lines.F[i][j]), n, `${t.abbr} F${i + 1}`)));
    real.D.forEach((pair, i) => pair.forEach((n, j) => n && assert.equal(name(t.lines.D[i][j]), n, `${t.abbr} D${i + 1}`)));
    real.G.forEach((n, j) => n && assert.equal(name(t.lines.G[j]), n, `${t.abbr} G${j + 1}`));
    const ids = lineupIds(t.lines);
    assert.equal(ids.length, 20, `${t.abbr} dresses 20`);
    assert.equal(new Set(ids).size, 20, `${t.abbr} no duplicates`);
    for (const o of real.out) assert.ok(t.roster.map((id) => lg.players[id]).find((p) => p.name === o.name)?.injury > 0, `${o.name} starts injured`);
    assert.ok(counts(lg, t).active <= MAX_ROSTER, `${t.abbr} roster size`);
    assert.ok(capSpace(lg, t) >= 0, `${t.abbr} under the cap`);
  }
});

test("lines survive injuries and roster moves; returning players get their spot back", () => {
  const lg = L.createLeague({ userAbbr: "DET", seed: 6 });
  const det = lg.teams[lg.userTid];
  const before = JSON.stringify(det.lines);
  const top = det.lines.F[0][1];
  lg.players[top].injury = 3;
  const g = gameLines(lg, det);
  assert.notEqual(g.F[0][1], top, "injured centre sits");
  assert.ok(!lineupIds(g).some((id) => lg.players[id].injury > 0), "no injured player dressed");
  assert.equal(JSON.stringify(det.lines), before, "saved lines unchanged");
  lg.players[top].injury = 0;

  // Larkin starts the season hurt; when healthy he goes straight to the top line.
  const larkin = det.roster.map((id) => lg.players[id]).find((p) => p.name === "Dylan Larkin");
  assert.ok(larkin.injury > 0 && !lineupIds(det.lines).includes(larkin.id));
  larkin.injury = 0;
  det.linesNew = [larkin.id];
  syncLines(lg, det);
  assert.ok(det.lines.F.slice(0, 2).some((line) => line.includes(larkin.id)), "Larkin back in the top six");
  assert.equal(new Set(lineupIds(det.lines)).size, 20);

  // Trading away a lined player keeps the other combinations intact.
  const tor = lg.teams.find((t) => t.abbr === "TOR");
  const torBefore = tor.lines.F.map((l) => [...l]);
  const gone = tor.lines.F[2][0];
  tor.roster = tor.roster.filter((id) => id !== gone);
  syncLines(lg, tor);
  assert.deepEqual(tor.lines.F[0], torBefore[0]);
  assert.deepEqual(tor.lines.F[1], torBefore[1]);
  assert.ok(tor.lines.F[2][0] && tor.lines.F[2][0] !== gone);
});

test("trade block circulates, AI teams deal, and Deadline Day closes trading at 3 PM", () => {
  const lg = L.createLeague({ userAbbr: "CHI", seed: 21 });
  assert.ok(lg.block.some((b) => lg.players[b.pid].name === "Connor Hellebuyck" && b.reason === "Requested a trade"));
  const user = lg.teams[lg.userTid];
  const listed = user.roster.map((id) => lg.players[id]).filter((p) => p.age >= 26).sort((a, b) => b.ovr - a.ovr).slice(2, 5);
  for (const p of listed) toggleUserBlock(lg, p.id);
  L.startRegularSeason(lg);
  while (!deadlinePending(lg)) L.simDay(lg);
  assert.ok(lg.wire.some((w) => w.kind === "trade"), "AI trades before the deadline");
  for (const t of lg.teams) if (t.id !== lg.userTid) assert.ok(counts(lg, t).active <= MAX_ROSTER, `${t.abbr} roster size`);

  startDeadline(lg);
  assert.equal(lg.deadline.minute, DEADLINE_START);
  let offers = 0;
  while (!lg.deadline.done) {
    deadlineTick(lg);
    const o = userOffers(lg)[0];
    if (o && !offers) {
      const gave = o.give[0];
      assert.ok(acceptOffer(lg, o.id).ok);
      assert.equal(lg.players[gave].tid, o.tid, "accepted offer moves the player");
    }
    offers += userOffers(lg).length;
  }
  assert.equal(lg.deadline.minute, DEADLINE_END);
  assert.ok(lg.deadline.trades >= 3, `deadline trades: ${lg.deadline.trades}`);
  assert.ok(tradingClosed(lg));
  const other = lg.teams.find((t) => t.id !== lg.userTid);
  const ev = evaluateTrade(lg, { from: lg.userTid, to: other.id, give: [user.roster[0]], get: [other.roster[0]], givePicks: [], getPicks: [] });
  assert.ok(ev.problems.includes("The trade deadline has passed."));
  // The rest of the season sims normally after the deadline.
  L.simRestOfSeason(lg);
  assert.ok(L.seasonOver(lg));
});

test("trade market review fixes: goalies move, no buried vets, standings-based buyers, clean block", () => {
  const lg = L.createLeague({ userAbbr: "TOR", seed: 5 });
  const startMinors = new Set(lg.teams.flatMap((t) => t.prospects));
  const user = lg.teams[lg.userTid];
  const listed = user.roster.map((id) => lg.players[id]).filter((p) => p.age >= 26).sort((a, b) => b.ovr - a.ovr)[4];
  toggleUserBlock(lg, listed.id);
  L.startRegularSeason(lg);
  while (!deadlinePending(lg)) L.simDay(lg);
  // Veterans who can't legally be sent down are never hidden in an AI team's minors.
  for (const t of lg.teams) {
    if (t.id === lg.userTid) continue;
    for (const id of t.prospects) {
      const p = lg.players[id];
      if (!startMinors.has(id) && p.signed !== false) assert.ok(canSendDown(p), `${t.abbr} buried ${p.name}`);
    }
  }
  // Buyers and sellers follow the standings: every team in a playoff spot is buying.
  for (const conf of ["East", "West"]) conferenceTable(lg, conf).slice(0, 8).forEach((t) => assert.ok(isContending(lg, t), `${t.abbr} should be a buyer`));
  startDeadline(lg);
  while (!lg.deadline.done) deadlineTick(lg);
  assert.equal(lg.deadline.total, lg.deadline.feed.filter((f) => f.kind === "trade").length);
  assert.ok(lg.deadline.feed.some((f) => f.talks), "talks are reported before deals");
  // Goalies can change hands between AI teams (Hellebuyck asked out).
  const helle = Object.values(lg.players).find((p) => p.name === "Connor Hellebuyck");
  assert.notEqual(lg.teams[helle.tid].abbr, "WPG", "Hellebuyck traded");
  // A listed player who leaves without a trade can still be taken off the block.
  if (lg.players[listed.id].tid === user.id) {
    toggleUserBlock(lg, listed.id);
    toggleUserBlock(lg, listed.id);
    releasePlayer(lg, user, listed.id);
    assert.ok(onBlock(lg, listed.id));
    toggleUserBlock(lg, listed.id);
    assert.ok(!onBlock(lg, listed.id), "Remove works after release");
  }
  // Plain-JSON league files are migrated like any other save.
  const copy = JSON.parse(JSON.stringify(lg));
  delete copy.block;
  copy.draftPicks.push({ id: "old-7", year: copy.year + 2, round: 7, orig: 0, owner: 0 });
  const back = L.deserializeLeague(JSON.stringify(copy));
  assert.ok(Array.isArray(back.block));
  assert.ok(!back.draftPicks.some((pk) => pk.round > 4));
  // After the Final, trading reopens and the block fills up again.
  L.simRestOfSeason(lg);
  L.endRegularSeason(lg);
  while (lg.playoffs.champion == null) simPlayoffDay(lg);
  L.finishPlayoffs(lg);
  assert.ok(!tradingClosed(lg));
  assert.ok(lg.block.filter((b) => b.tid !== lg.userTid).length > 0, "off-season block");
});

test("contracts look like the NHL's, and the goalie rest setting is honoured", () => {
  const lg = L.createLeague({ userAbbr: "BOS", seed: 8 });
  const find = (n) => Object.values(lg.players).find((p) => p.name === n);
  // Stars get star money, even in their 30s; depth players get close to the minimum.
  assert.ok(marketValue(find("Nikita Kucherov"), 2027) >= 12, "Kucherov");
  assert.ok(marketValue(find("Connor McDavid"), 2027) >= 15, "McDavid");
  assert.ok(marketValue(find("Auston Matthews"), 2027) >= 11, "Matthews");
  const depth = Object.values(lg.players).find((p) => p.tid >= 0 && p.ovr <= 72 && p.age >= 25);
  assert.ok(marketValue(depth, 2027) <= 1.2, "depth");
  // A free agent's ask never collapses: on the last day of free agency a star still wants 90%+.
  const kuch = find("Nikita Kucherov");
  lg.phase = "freeagency";
  lg.fa = { day: 0 };
  const open = faAsk(lg, kuch).aav;
  lg.fa.day = 30;
  assert.ok(faAsk(lg, kuch).aav >= open * 0.9, "ask holds");
  lg.phase = "preseason";
  delete lg.fa;
  // Goalie rest: the user's choice drives starts; AI tandems split more evenly.
  const user = lg.teams[lg.userTid];
  user.restPct = 40;
  assert.equal(restShare(lg, user), 0.4);
  L.startRegularSeason(lg);
  L.simRestOfSeason(lg);
  const starter = lg.players[user.lines.G[0]];
  const backup = lg.players[user.lines.G[1]];
  assert.ok(backup.stats.gp >= 25 && starter.stats.gp <= 57, `starts ${starter.stats.gp}/${backup.stats.gp}`);
});

test("injuries heal in the playoffs; scouting: stable board, two scouts, the Combine, pick grades", () => {
  const lg = L.createLeague({ userAbbr: "EDM", seed: 21 });
  const user = lg.teams[lg.userTid];
  // A major and a minor scout on different positions; you can't double up.
  assert.ok(user.scouts.major && user.scouts.minor && user.scouts.major.group !== user.scouts.minor.group);
  assert.equal(user.scoutPts, SCOUT_POINTS_START);
  const dup = lg.scoutPool.find((s) => s.group === user.scouts.major.group);
  assert.equal(hireScout(lg, dup.id, "minor").ok, false);
  const gScout = lg.scoutPool.find((s) => s.group === "G");
  assert.ok(hireScout(lg, gScout.id, "minor").ok);
  assert.equal(user.scouts.minor.group, "G");

  // The board is in Central Scouting order and scouting never moves anyone.
  const order = () => classPool(lg).sort((a, b) => csRank(a) - csRank(b)).map((p) => p.id);
  const before = order();
  user.scoutPts = 50;
  const majorP = classPool(lg).find((p) => scoutGroup(p.pos) === user.scouts.major.group);
  const minorP = classPool(lg).find((p) => scoutGroup(p.pos) === "G");
  const officeP = classPool(lg).find((p) => !["G", user.scouts.major.group].includes(scoutGroup(p.pos)));
  assert.ok(prospectRead(lg, majorP).general && prospectRead(lg, minorP).general, "general idea at covered positions");
  assert.ok(!prospectRead(lg, officeP).general && prospectRead(lg, officeP).ovr === "??", "nothing at uncovered positions");
  for (const p of [majorP, minorP, officeP]) {
    assert.ok(scoutProspect(lg, p.id).ok);
    assert.ok(scoutProspect(lg, p.id).ok);
    assert.equal(scoutCost(p), 0);
  }
  assert.deepEqual(order(), before, "board order unchanged by scouting");
  assert.equal(user.scoutPts, 50 - 9);
  // Only the major scout gets exact numbers and the development trait.
  assert.deepEqual([majorP.scout.eOvr, majorP.scout.ePot, majorP.scout.dev], [majorP.ovr, majorP.pot, majorP.dev]);
  assert.ok(!minorP.scout.exact && !officeP.scout.exact && officeP.scout.dev == null);
  assert.ok(majorP.bio.team && majorP.bio.ht && majorP.cs.mid >= 1 && majorP.scout.skills && majorP.scout.notes.strengths.length);

  // Staff is locked during the season; points come in weekly.
  L.startRegularSeason(lg);
  assert.ok(!staffWindowOpen(lg));
  assert.equal(hireScout(lg, lg.scoutPool[0].id, "major").ok, false);
  user.scoutPts = 0;
  L.simDays(lg, 30);
  assert.ok(user.scoutPts >= 4 && user.scoutPts <= 6, `weekly points ${user.scoutPts}`);

  // A player hurt for two games misses two playoff games, then he's back.
  L.simRestOfSeason(lg);
  L.endRegularSeason(lg);
  const s0 = lg.playoffs.rounds[0][0];
  const hurt = lg.teams[s0.top].roster.map((id) => lg.players[id]).find((p) => p.injury === 0 && p.pos !== "G");
  hurt.injury = 2;
  simPlayoffDay(lg);
  simPlayoffDay(lg);
  assert.equal(hurt.injury, 0, "playoff injuries heal");

  // The Combine: tests for the top prospects, final rankings, interviews and extra points.
  while (lg.playoffs.champion == null) simPlayoffDay(lg);
  const pts = user.scoutPts;
  L.finishPlayoffs(lg);
  assert.ok(atCombine(lg));
  const guru = user.scouts.major?.trait === "combine" || user.scouts.minor?.trait === "combine";
  assert.equal(user.scoutPts, pts + SCOUT_POINTS_COMBINE + (guru ? 3 : 0));
  const invited = classPool(lg).filter((p) => p.combine);
  assert.equal(invited.length, COMBINE_INVITES);
  assert.ok(classPool(lg).every((p) => p.cs.final >= 1));
  assert.ok(interviewProspect(lg, invited[0].id).ok);
  assert.ok(invited[0].scout.intv.grade);
  assert.equal(lg.draft.interviewsLeft, COMBINE_INTERVIEWS - 1);
  assert.ok(lg.draft.buzz.length > 0);

  // The draft: AI teams mostly follow the board, and every pick gets an analyst grade.
  simDraftToUser(lg, { all: true });
  assert.ok(!atCombine(lg) && draftDone(lg));
  assert.ok(lg.draft.slots.every((s) => s.pid && s.grade && s.csr >= 1));
  const r1 = lg.draft.slots.filter((s) => s.round === 1).map((s) => s.csr);
  assert.ok(r1.reduce((a, b) => a + b, 0) / r1.length < 24 && Math.max(...r1) <= 80, `round 1 CS ranks ${r1}`);
  assert.equal(pickGrade(1, 1), "A");
  assert.equal(pickGrade(12, 12), "B+");
  assert.equal(pickGrade(40, 10), "A+");
  assert.equal(pickGrade(5, 40), "D");
  assert.ok(staffWindowOpen(lg), "staff window opens after the draft");
  const back = L.deserializeLeague(L.serializeLeague(lg));
  assert.equal(back.teams[back.userTid].scouts.minor.group, "G");

  // Old saves pick up scouts, development traits, bios and Central Scouting ranks.
  const old = JSON.parse(JSON.stringify(L.createLeague({ userAbbr: "MTL", seed: 3 })));
  delete old.teams[old.userTid].scouts;
  delete old.scoutPool;
  for (const id of old.draftClass) {
    const p = old.players[id];
    delete p.bio;
    delete p.cs;
    delete p.dev;
    p.scout = { lvl: 1, eOvr: p.ovr + 1, ePot: p.pot - 1 };
  }
  const mig = L.restoreLeague(old);
  assert.ok(mig.teams[mig.userTid].scouts.major && mig.scoutPool.length);
  const mp = mig.players[mig.draftClass[0]];
  assert.ok(mp.bio && mp.cs.mid >= 1 && mp.dev && mp.scout.base && mp.scout.lvl === 1 && !mp.scout.exact);
});
