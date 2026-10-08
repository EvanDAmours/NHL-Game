import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../src/engine/league.js";
import { generateSchedule } from "../src/engine/schedule.js";
import { TEAMS } from "../src/engine/teams.js";
import { generateAttributes, computeOvr } from "../src/engine/ratings.js";
import { simPlayoffDay } from "../src/engine/playoffs.js";
import { simDraftToUser, draftDone } from "../src/engine/draft.js";
import { simFADay, expiringPlayers } from "../src/engine/offseason.js";
import { counts } from "../src/engine/roster.js";
import { evaluateTrade, executeTrade } from "../src/engine/trade.js";
import { parseRatingsCsv, matchRows, applyRatings } from "../src/engine/importer.js";
import { MAX_ROSTER } from "../src/engine/constants.js";
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
  assert.equal(lg.draft.slots.filter((s) => s.pid).length, 224);
  L.completeDraft(lg);
  assert.equal(lg.phase, "resign");
  const user = lg.teams[lg.userTid];
  assert.ok(expiringPlayers(lg, user).every((p) => p.signed !== false), "unsigned picks are not expiring contracts");
  L.goToFreeAgency(lg);
  while (!simFADay(lg)) {}
  L.beginNextSeason(lg);
  assert.equal(lg.phase, "preseason");
  assert.equal(lg.year, 2027);
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
