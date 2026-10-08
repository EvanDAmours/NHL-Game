// Step-based game simulation. One game = 10-second steps; quick sim runs all
// steps at once, live mode runs them on a timer. Both paths share this code,
// so live games feed season stats exactly like simulated ones.
import { rand, chance, weighted, randInt, randFloat, pick, clamp } from "./rng.js";
import { composites } from "./ratings.js";
import { autoLines, repairLines } from "./lines.js";
import { isForward, isDefense, isGoalie } from "./constants.js";
import { blankStats, chanceInjury, injuryLength } from "./players.js";

const STEP = 10;
const PERIOD = 1200;
const REG_OT = 300;
const F_SHARE = [0.33, 0.29, 0.22, 0.16];
const D_SHARE = [0.4, 0.33, 0.27];
const F_SHARE_CHASE = [0.46, 0.34, 0.15, 0.05];
const PEN_TYPES = ["Tripping", "Hooking", "Holding", "Slashing", "Interference", "Roughing", "High-sticking", "Cross-checking", "Delay of game", "Holding the stick", "Boarding", "Too many men"];
const SHOT_TYPES = ["wrist shot", "snap shot", "slap shot", "one-timer", "backhand", "tip-in", "wraparound"];

export function createGame(league, home, away, opts = {}) {
  const s = {
    playoff: !!opts.playoff,
    live: !!opts.live,
    userSide: opts.userTid === home.id ? "h" : opts.userTid === away.id ? "a" : null,
    h: makeSide(league, home, opts),
    a: makeSide(league, away, opts),
    period: 1,
    clock: PERIOD,
    phase: "reg",
    score: { h: 0, a: 0 },
    shots: { h: 0, a: 0 },
    pen: { h: [], a: [] },
    ppTime: { h: 0, a: 0 },
    goals: [],
    events: [],
    box: {},
    gbox: {},
    so: null,
    winner: null,
    faceoffNext: true,
    puck: { x: 100, y: 42.5 },
    poss: null,
    steps: 0,
  };
  for (const side of [s.h, s.a]) {
    for (const id of side.dressed) s.box[id] = blankStats(league.players[id].pos);
    if (side.goalie) s.gbox[side.goalie] = { sa: 0, ga: 0, toi: 0 };
  }
  if (s.live) push(s, { t: "period", text: `Puck drop! ${home.abbr} vs ${away.abbr} — 1st period underway.` });
  return s;
}

function makeSide(league, team, opts) {
  const userTeam = team.id === opts.userTid;
  const lines = userTeam ? repairLines(league, team) : autoLines(league, team);
  const dressed = [...new Set([...lines.F.flat(), ...lines.D.flat(), ...lines.G].filter(Boolean))];
  const comp = {};
  const pl = {};
  for (const id of dressed) {
    pl[id] = league.players[id];
    comp[id] = composites(pl[id]);
  }
  let goalie = lines.G[0];
  const backup = lines.G[1];
  // Starters play ~65 games; backups get the rest (never in the playoffs).
  const startBackup = !opts.playoff && backup && (userTeam ? team.autoGoalie !== false && chance(0.2) : chance(0.21));
  if (startBackup || !goalie) goalie = backup || goalie;
  return {
    tid: team.id,
    abbr: team.abbr,
    user: userTeam,
    lines,
    dressed,
    pl,
    comp,
    goalie,
    backup: goalie === lines.G[0] ? backup : lines.G[0],
    pulled: false,
    autoPull: true,
    tactic: "balanced",
    ride: false,
    timeout: false,
    boost: 0,
    fIdx: 0,
    dIdx: 0,
    fShift: 0,
    dShift: 0,
    fToi: [0, 0, 0, 0],
    dToi: [0, 0, 0],
  };
}

const other = (k) => (k === "h" ? "a" : "h");
const avg = (arr) => (arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : 0);

function push(s, e) {
  e.period = s.period;
  e.clock = s.clock;
  e.phase = s.phase;
  s.events.push(e);
}

const nameOf = (side, id) => side.pl[id]?.name || "?";
const lastName = (side, id) => {
  const n = nameOf(side, id);
  const i = n.indexOf(" ");
  return i > 0 ? n.slice(i + 1) : n;
};

function strengthPens(s, k) {
  return s.pen[k].filter((p) => !p.offset);
}
function skaterCount(s, k) {
  const own = strengthPens(s, k).length;
  const opp = strengthPens(s, other(k)).length;
  // 3-on-3 OT: the penalized team stays at three, the other side adds a skater.
  if (s.phase === "ot" && !s.playoff) return Math.min(5, 3 + Math.max(0, opp - own));
  return 5 - Math.min(2, own);
}

function chooseLine(toi, share, ride) {
  const total = toi.reduce((a, b) => a + b, 0) || 1;
  let best = 0;
  let bestGap = -Infinity;
  for (let i = 0; i < toi.length; i++) {
    const tgt = ride ? share.ride[i] : share.base[i];
    const gap = tgt - toi[i] / total + rand() * 0.04;
    if (gap > bestGap) { bestGap = gap; best = i; }
  }
  return best;
}

function onIce(s, k) {
  const side = s[k];
  const boxed = new Set(s.pen[k].map((p) => p.pid));
  const free = (id) => id && !boxed.has(id);
  const n = skaterCount(s, k);
  const oppN = skaterCount(s, other(k));
  let ids;
  const pp = n > oppN && n >= 4;
  const pk = n < oppN;
  if (pp && s.phase !== "ot") {
    const unit = s.ppTime[k] < 70 ? side.lines.PP[0] : side.lines.PP[1];
    ids = unit.filter(free);
  } else if (pk && n < 5 && s.phase !== "ot") {
    const unit = s.ppTime[other(k)] < 70 ? side.lines.PK[0] : side.lines.PK[1];
    ids = unit.filter(free);
  } else {
    const f = side.lines.F[side.fIdx].filter(free);
    const d = side.lines.D[side.dIdx].filter(free);
    if (n === 3) ids = [f[1], f[0] ?? f[2], d[0]];
    else if (n === 4) ids = [f[1], f[0] || f[2], d[0], d[1]];
    else ids = [...f, ...d];
  }
  ids = ids.filter(free);
  // Fill short units from the bench by OVR (penalties, injuries, pulled goalie).
  const want = n + (side.pulled ? 1 : 0);
  if (ids.length < want) {
    const bench = side.dressed
      .filter((id) => free(id) && !ids.includes(id) && !isGoalie(side.pl[id].pos))
      .sort((x, y) => side.pl[y].ovr - side.pl[x].ovr);
    while (ids.length < want && bench.length) ids.push(bench.shift());
  }
  return ids.slice(0, want);
}

function rotate(s, k) {
  const side = s[k];
  const chasing = s.period >= 3 && s.score[k] < s.score[other(k)] && s.clock < 420;
  const ride = side.ride || chasing;
  side.fShift -= STEP;
  side.dShift -= STEP;
  if (side.fShift <= 0) {
    side.fIdx = chooseLine(side.fToi, { base: F_SHARE, ride: F_SHARE_CHASE }, ride);
    side.fShift = randInt(4, 5) * STEP;
  }
  if (side.dShift <= 0) {
    side.dIdx = chooseLine(side.dToi, { base: D_SHARE, ride: [0.5, 0.35, 0.15] }, ride);
    side.dShift = randInt(5, 6) * STEP;
  }
  side.fToi[side.fIdx] += STEP;
  side.dToi[side.dIdx] += STEP;
}

function aiTactic(s, k) {
  const side = s[k];
  if (side.user && s.live) return;
  const diff = s.score[k] - s.score[other(k)];
  if (s.period >= 3 && diff < 0) side.tactic = "attack";
  else if (s.period >= 3 && diff >= 2) side.tactic = "defend";
  else side.tactic = side.user && side.pref ? side.pref : "balanced";
}

function maybePull(s, k) {
  const side = s[k];
  if (side.user && s.live && !side.autoPull) return;
  const diff = s.score[k] - s.score[other(k)];
  const late = s.period >= 3 && s.phase === "reg";
  const shouldPull = late && ((diff === -1 && s.clock <= 90) || (diff === -2 && s.clock <= 160)) && strengthPens(s, k).length === 0;
  if (shouldPull && !side.pulled) {
    side.pulled = true;
    if (s.live) push(s, { t: "pull", side: k, text: `${side.abbr} pull ${lastName(side, side.goalie)} for the extra attacker.` });
  } else if (!shouldPull && side.pulled && (diff >= 0 || diff <= -3 || !late)) {
    side.pulled = false;
  }
}

function tacticMult(tactic) {
  if (tactic === "attack") return { for: 1.13, against: 1.08 };
  if (tactic === "defend") return { for: 0.86, against: 0.86 };
  return { for: 1, against: 1 };
}

function addBox(s, id, field, n = 1) {
  const b = s.box[id];
  if (b && field in b) b[field] += n;
}

function zoneX(s, k, depth) {
  // Home attacks right in odd periods; teams switch ends each period.
  const homeRight = s.period % 2 === 1;
  const attacksRight = k === "h" ? homeRight : !homeRight;
  return attacksRight ? 100 + depth : 100 - depth;
}

export function stepGame(s) {
  if (s.phase === "final") return;
  if (s.phase === "so") return shootoutStep(s);
  s.steps++;
  const startEvents = s.events.length;
  for (const k of ["h", "a"]) {
    aiTactic(s, k);
    maybePull(s, k);
    rotate(s, k);
  }
  const ice = { h: onIce(s, "h"), a: onIce(s, "a") };
  for (const k of ["h", "a"]) for (const id of ice[k]) addBox(s, id, "toi", STEP);
  for (const k of ["h", "a"]) {
    const g = s[k].goalie;
    if (!s[k].pulled && s.gbox[g]) s.gbox[g].toi += STEP;
  }

  const rate = (k) => {
    const side = s[k];
    const ids = ice[k];
    return {
      off: avg(ids.map((id) => side.comp[id].off)),
      ctrl: avg(ids.map((id) => side.comp[id].ctrl)),
      def: avg(ids.map((id) => side.comp[id].def)),
      blk: avg(ids.map((id) => side.comp[id].blk)),
      phys: avg(ids.map((id) => side.comp[id].phys)),
      dsc: avg(ids.map((id) => side.comp[id].dsc)),
      n: ids.length,
    };
  };
  const R = { h: rate("h"), a: rate("a") };

  // Faceoffs after stoppages.
  let foWinner = null;
  if (s.faceoffNext || chance(0.16)) {
    s.faceoffNext = false;
    const ch = pickCenter(s.h, ice.h);
    const ca = pickCenter(s.a, ice.a);
    if (ch && ca) {
      const pH = clamp(0.5 + (s.h.comp[ch].fof - s.a.comp[ca].fof) * 0.006, 0.25, 0.75);
      foWinner = chance(pH) ? "h" : "a";
      addBox(s, foWinner === "h" ? ch : ca, "fow");
      addBox(s, foWinner === "h" ? ca : ch, "fol");
      if (s.live && rand() < 0.25) push(s, { t: "fo", side: foWinner, text: `${lastName(s[foWinner], foWinner === "h" ? ch : ca)} wins the draw.`, x: 100, y: 42.5 });
    }
  }

  // Possession: puck control, man advantage, faceoff, home ice.
  let pH = 0.5 + (R.h.ctrl - R.a.ctrl) * 0.006 + (R.h.n - R.a.n) * 0.14 + 0.01;
  if (foWinner) pH += foWinner === "h" ? 0.12 : -0.12;
  pH = clamp(pH, 0.12, 0.88);
  const k = chance(pH) ? "h" : "a";
  const o = other(k);
  s.poss = k;
  if (s.ppTime.h >= 0 && strengthPens(s, "a").length) s.ppTime.h += STEP; else s.ppTime.h = 0;
  if (s.ppTime.a >= 0 && strengthPens(s, "h").length) s.ppTime.a += STEP; else s.ppTime.a = 0;
  s.puck = { x: zoneX(s, k, randFloat(5, 60)), y: randFloat(12, 73) };

  // Hits by the team without the puck (and some by the puck carrier's side).
  for (const hk of ["h", "a"]) {
    const pHit = 0.062 * (R[hk].phys / 78) * (hk === o ? 1.3 : 0.7);
    if (chance(pHit)) {
      const hitter = weighted(ice[hk], (id) => s[hk].comp[id].phys ** 2);
      addBox(s, hitter, "hit");
      if (s.live && rand() < 0.35) {
        const victim = pick(ice[other(hk)]);
        push(s, { t: "hit", side: hk, text: `${lastName(s[hk], hitter)} lays a big hit on ${lastName(s[other(hk)], victim)}.`, x: s.puck.x, y: chance(0.5) ? 4 : 81 });
      }
    }
  }

  // Shot attempt by the possessing side.
  const tk = tacticMult(s[k].tactic);
  const to = tacticMult(s[o].tactic);
  let pAtt = 0.245 * (1 + 0.012 * (R[k].off - R[o].def)) * tk.for * to.against;
  if (R[k].n > R[o].n) pAtt *= 1.4;
  if (R[k].n < R[o].n) pAtt *= 0.55;
  if (s.phase === "ot" && !s.playoff) pAtt *= 1.5;
  if (s[k].boost > 0) pAtt *= 1.1;
  if (s[k].pulled) pAtt *= 1.25;
  if (chance(clamp(pAtt, 0.05, 0.6))) shotAttempt(s, k, ice, R, false);

  // Penalties.
  for (const pk of ["h", "a"]) {
    const pPen = 0.0086 * ((100 - R[pk].dsc) / 24) * (pk === o ? 1.25 : 0.75);
    if (chance(pPen) && s.phase !== "ot") callPenalty(s, pk, ice[pk]);
  }
  // Rare fights (offsetting majors).
  if (s.phase === "reg" && chance(0.00035)) fight(s, ice);

  for (const sk of ["h", "a"]) if (s[sk].boost > 0) s[sk].boost--;
  advanceClock(s);
  if (s.live && s.events.length === startEvents && rand() < 0.3) {
    push(s, { t: "play", side: k, text: flavor(s, k, ice[k]), x: s.puck.x, y: s.puck.y });
  }
}

function pickCenter(side, ids) {
  const fwds = ids.filter((id) => isForward(side.pl[id].pos));
  const pool = fwds.filter((id) => side.pl[id].pos === "C");
  const list = pool.length ? pool : fwds.length ? fwds : ids;
  let best = list[0];
  for (const id of list) if (side.comp[id].fof > side.comp[best].fof) best = id;
  return best;
}

function shotAttempt(s, k, ice, R, rebound) {
  const o = other(k);
  const att = s[k];
  const def = s[o];
  const shooters = ice[k];
  const shooter = rebound
    ? weighted(shooters.filter((id) => isForward(att.pl[id].pos)).concat(shooters).slice(0, 6), (id) => att.comp[id].shoot ** 3)
    : weighted(shooters, (id) => (att.comp[id].shoot / 80) ** 3 * (isDefense(att.pl[id].pos) ? 0.55 : 1));
  const sc = att.comp[shooter];
  const isD = isDefense(att.pl[shooter].pos);
  const x = zoneX(s, k, isD ? randFloat(40, 60) : randFloat(60, 88));
  const y = isD ? randFloat(10, 75) : randFloat(28, 57);
  s.puck = { x, y };

  // Blocked / missed / on goal.
  const pBlock = rebound ? 0.08 : 0.25 * (R[o].blk / 78) * (isD ? 1.3 : 0.9);
  if (chance(pBlock)) {
    const blocker = weighted(ice[o], (id) => def.comp[id].blk ** 2 * (isDefense(def.pl[id].pos) ? 1.6 : 1));
    addBox(s, blocker, "blk");
    if (s.live) push(s, { t: "block", side: o, text: `${lastName(att, shooter)} fires — blocked by ${lastName(def, blocker)}.`, x, y });
    return;
  }
  const pMiss = clamp(0.24 - (sc.shoot - 80) * 0.004, 0.12, 0.34);
  if (chance(pMiss)) {
    if (s.live && rand() < 0.5) push(s, { t: "miss", side: k, text: `${lastName(att, shooter)} ${pick(["misses wide", "rings it off the post", "fires over the net", "can't hit the target"])}.`, x, y });
    return;
  }
  addBox(s, shooter, "sog");
  s.shots[k]++;
  const shotType = isD ? pick(["slap shot", "wrist shot", "one-timer"]) : rebound ? pick(["rebound", "tip-in", "backhand"]) : pick(SHOT_TYPES);
  const empty = def.pulled;
  let scored;
  if (empty) {
    scored = chance(0.72);
  } else {
    const g = def.comp[def.goalie]?.goalie ?? 70;
    let p = 0.089 * Math.exp(0.03 * (sc.shoot - 82)) * Math.exp(-0.024 * (g - 85));
    if (isD) p *= 0.6;
    if (R[k].n > R[o].n) p *= 1.45;
    if (R[k].n < R[o].n) p *= 0.85;
    if (s.phase === "ot" && !s.playoff) p *= 1.5;
    if (rebound) p *= 1.8;
    if (att.boost > 0) p *= 1.05;
    if (s.gbox[def.goalie]) s.gbox[def.goalie].sa++;
    scored = chance(clamp(p, 0.01, 0.6));
  }
  if (scored) {
    goal(s, k, shooter, ice, empty, shotType, x, y);
    return;
  }
  if (s.live) push(s, { t: "save", side: o, text: `${lastName(att, shooter)} ${shotType === "rebound" ? "jams at the rebound" : "with a " + shotType} — save ${lastName(def, def.goalie)}.`, x: zoneX(s, k, 89), y: 42.5 });
  const reb = def.comp[def.goalie]?.reb ?? 75;
  if (!rebound && chance(0.09 * (1 + (80 - reb) / 40))) {
    shotAttempt(s, k, ice, R, true);
  } else if (chance(0.55)) {
    s.faceoffNext = true;
  }
}

function goal(s, k, shooter, ice, empty, shotType, x, y) {
  const o = other(k);
  const att = s[k];
  const def = s[o];
  s.score[k]++;
  if (!empty && s.gbox[def.goalie]) s.gbox[def.goalie].ga++;
  const mates = ice[k].filter((id) => id !== shooter);
  const assists = [];
  const r = rand();
  const nA = r < 0.08 ? 0 : r < 0.32 ? 1 : 2;
  for (let i = 0; i < nA && mates.length; i++) {
    const a = weighted(mates.filter((m) => !assists.includes(m)), (id) => att.comp[id].pass ** 3);
    if (a) assists.push(a);
  }
  const nK = ice[k].length - (att.pulled ? 1 : 0);
  const nO = ice[o].length - (def.pulled ? 1 : 0);
  const type = nK > nO ? "PP" : nK < nO ? "SH" : "EV";
  addBox(s, shooter, "g");
  addBox(s, shooter, "pts");
  for (const a of assists) { addBox(s, a, "a"); addBox(s, a, "pts"); }
  if (type === "PP") { addBox(s, shooter, "ppg"); addBox(s, shooter, "ppp"); for (const a of assists) addBox(s, a, "ppp"); }
  if (type === "SH") addBox(s, shooter, "shg");
  if (type !== "PP") {
    for (const id of ice[k]) addBox(s, id, "pm", 1);
    for (const id of ice[o]) addBox(s, id, "pm", -1);
  }
  // A power-play goal ends the shortest minor.
  if (type === "PP") {
    const minors = strengthPens(s, o).filter((p) => !p.major).sort((a, b) => a.left - b.left);
    if (minors[0]) {
      if (minors[0].left > 120) minors[0].left -= 120; else s.pen[o] = s.pen[o].filter((p) => p !== minors[0]);
    }
  }
  const time = PERIOD - s.clock;
  s.goals.push({ side: k, scorer: shooter, assists, period: s.period, phase: s.phase, time, type: empty ? "EN" : type, score: { ...s.score } });
  s.faceoffNext = true;
  if (s.live) {
    const aTxt = assists.length ? ` (${assists.map((a) => lastName(att, a)).join(", ")})` : " (unassisted)";
    const tag = empty ? " — empty net" : type === "PP" ? " — power play" : type === "SH" ? " — shorthanded!" : "";
    push(s, { t: "goal", side: k, text: `GOAL! ${nameOf(att, shooter)} scores on a ${shotType}${aTxt}${tag}. ${s.h.abbr} ${s.score.h}, ${s.a.abbr} ${s.score.a}`, x: zoneX(s, k, 89), y: 42.5, scorer: shooter });
  }
  if (s.phase === "ot") endGame(s, k);
}

function callPenalty(s, k, ids) {
  const side = s[k];
  const skaters = ids.filter((id) => !s.pen[k].some((p) => p.pid === id));
  if (!skaters.length) return;
  const pid = weighted(skaters, (id) => (100 - side.comp[id].dsc) + side.comp[id].agr * 0.3);
  const type = pick(PEN_TYPES);
  const double = type === "High-sticking" && chance(0.3);
  const len = double ? 240 : 120;
  s.pen[k].push({ pid, left: len, major: false });
  addBox(s, pid, "pim", len / 60);
  s.faceoffNext = true;
  if (s.live) push(s, { t: "pen", side: k, text: `Penalty: ${nameOf(side, pid)} (${side.abbr}) — ${double ? "4 minutes, double minor" : "2 minutes"} for ${type.toLowerCase()}.` });
}

function fight(s, ice) {
  const pickFighter = (k) => weighted(ice[k].filter((id) => !s.pen[k].some((p) => p.pid === id)), (id) => s[k].comp[id].fgt ** 3 / 1e4 + s[k].comp[id].agr);
  const fh = pickFighter("h");
  const fa = pickFighter("a");
  if (!fh || !fa) return;
  s.pen.h.push({ pid: fh, left: 300, major: true, offset: true });
  s.pen.a.push({ pid: fa, left: 300, major: true, offset: true });
  addBox(s, fh, "pim", 5);
  addBox(s, fa, "pim", 5);
  s.faceoffNext = true;
  if (s.live) push(s, { t: "fight", text: `The gloves are off! ${nameOf(s.h, fh)} and ${nameOf(s.a, fa)} drop 'em — five for fighting each.` });
}

function advanceClock(s) {
  s.clock -= STEP;
  for (const k of ["h", "a"]) {
    for (const p of s.pen[k]) p.left -= STEP;
    s.pen[k] = s.pen[k].filter((p) => p.left > 0);
  }
  if (s.clock > 0) return;
  // End of period.
  if (s.phase === "reg" && s.period < 3) {
    s.period++;
    s.clock = PERIOD;
    s.faceoffNext = true;
    if (s.live) push(s, { t: "period", text: `End of the ${ordinal(s.period - 1)}. ${s.h.abbr} ${s.score.h}, ${s.a.abbr} ${s.score.a}.` });
    return;
  }
  if (s.score.h !== s.score.a) return endGame(s, s.score.h > s.score.a ? "h" : "a");
  if (s.playoff) {
    s.phase = "ot";
    s.period++;
    s.clock = PERIOD;
    s.faceoffNext = true;
    if (s.live) push(s, { t: "period", text: `Tied after ${s.period - 1}. Sudden-death overtime!` });
    return;
  }
  if (s.phase === "reg") {
    s.phase = "ot";
    s.period = 4;
    s.clock = REG_OT;
    s.faceoffNext = true;
    for (const k of ["h", "a"]) s[k].pulled = false;
    if (s.live) push(s, { t: "period", text: "Tied after regulation — 3-on-3 overtime!" });
    return;
  }
  // Regular-season OT expired: shootout.
  s.phase = "so";
  s.so = { round: 0, h: 0, a: 0, hShooters: shootoutOrder(s.h), aShooters: shootoutOrder(s.a), turn: "a", taken: { h: 0, a: 0 } };
  if (s.live) push(s, { t: "period", text: "Still tied. We're going to a shootout!" });
}

function shootoutOrder(side) {
  return side.dressed
    .filter((id) => !isGoalie(side.pl[id].pos))
    .sort((x, y) => side.comp[y].dek + side.comp[y].shoot - (side.comp[x].dek + side.comp[x].shoot));
}

function shootoutStep(s) {
  const so = s.so;
  const k = so.turn;
  const o = other(k);
  const shooter = so[k + "Shooters"][so.taken[k] % so[k + "Shooters"].length];
  const sc = s[k].comp[shooter];
  const g = s[o].comp[s[o].goalie];
  const p = clamp(0.33 * Math.exp(0.035 * ((sc.dek + sc.shoot) / 2 - 85)) * Math.exp(-0.05 * (((g?.goalie ?? 75) + (g?.brk ?? 75)) / 2 - 85)), 0.1, 0.65);
  const scored = chance(p);
  so.taken[k]++;
  if (scored) so[k]++;
  if (s.live) push(s, { t: scored ? "so-goal" : "so-miss", side: k, text: `${nameOf(s[k], shooter)} ${scored ? "scores!" : "is stopped by " + lastName(s[o], s[o].goalie) + "."} (${s.a.abbr} ${so.a} – ${s.h.abbr} ${so.h})`, x: zoneX(s, k, 89), y: 42.5 });
  so.turn = o;
  const ta = so.taken.a;
  const th = so.taken.h;
  if (ta <= 3 && th <= 3) {
    const remA = 3 - ta;
    const remH = 3 - th;
    if (so.a + remA < so.h || so.h + remH < so.a) return finishShootout(s);
    if (ta === 3 && th === 3 && so.a !== so.h) return finishShootout(s);
  } else if (ta === th && so.a !== so.h) {
    return finishShootout(s);
  }
}

function finishShootout(s) {
  const w = s.so.h > s.so.a ? "h" : "a";
  s.score[w]++;
  endGame(s, w);
}

function endGame(s, winner) {
  s.winner = winner;
  const endedIn = s.phase;
  s.phase = "final";
  s.endedIn = endedIn === "so" ? "SO" : endedIn === "ot" ? (s.playoff && s.period > 4 ? `${s.period - 3}OT` : "OT") : "";
  if (s.live) push(s, { t: "final", text: `Final${s.endedIn ? " (" + s.endedIn + ")" : ""}: ${s.h.abbr} ${s.score.h}, ${s.a.abbr} ${s.score.a}.` });
}

export function simToEnd(s) {
  let guard = 0;
  while (s.phase !== "final" && guard++ < 5000) stepGame(s);
  if (s.phase !== "final") endGame(s, chance(0.5) ? "h" : "a");
  return s;
}

function ordinal(n) {
  return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : n + "th";
}

export function periodLabel(s) {
  if (s.phase === "so") return "SO";
  if (s.phase === "ot" || s.period > 3) return s.playoff ? `${s.period - 3}OT` : "OT";
  return ordinal(s.period);
}

export function clockLabel(sec) {
  const m = Math.floor(Math.max(0, sec) / 60);
  const ss = Math.max(0, sec) % 60;
  return `${m}:${String(ss).padStart(2, "0")}`;
}

function flavor(s, k, ids) {
  const side = s[k];
  const id = pick(ids);
  const n = lastName(side, id);
  return pick([
    `${n} carries it into the zone.`,
    `${n} cycles low along the boards.`,
    `${n} chips it deep and ${side.abbr} go to work on the forecheck.`,
    `${n} threads a pass through the neutral zone.`,
    `${side.abbr} change on the fly.`,
    `${n} wins a puck battle in the corner.`,
    `${n} quarterbacks from the point.`,
  ]);
}

// Apply a finished game to the league: player/goalie stats, team records,
// injuries. Returns a compact result for the schedule/box score.
export function applyResult(league, s, { playoff = false } = {}) {
  const h = league.teams[s.h.tid];
  const a = league.teams[s.a.tid];
  const statKey = playoff ? "pstats" : "stats";
  const winner = s.winner;
  const loser = other(winner);

  for (const id in s.box) {
    const p = league.players[id];
    if (!p || isGoalie(p.pos)) continue;
    const b = s.box[id];
    const st = p[statKey];
    st.gp++;
    for (const f in b) if (f !== "gp" && f in st) st[f] += b[f];
  }
  // Game-winning goal: the goal that put the winner one ahead of the loser's final total.
  if (s.endedIn !== "SO") {
    const loserFinal = s.score[loser];
    const gw = s.goals.filter((g) => g.side === winner)[loserFinal];
    if (gw) {
      const p = league.players[gw.scorer];
      if (p) p[statKey].gwg++;
    }
  }
  for (const k of ["h", "a"]) {
    const side = s[k];
    for (const gid in s.gbox) {
      if (!side.pl[gid]) continue;
      const gb = s.gbox[gid];
      const p = league.players[gid];
      if (!p || gb.toi <= 0) continue;
      const st = p[statKey];
      st.gp++;
      if (gid === side.goalie) st.gs++;
      st.sa += gb.sa;
      st.ga += gb.ga;
      st.toi += gb.toi;
      if (gid === side.goalie) {
        if (k === winner) { st.w++; if (s.score[other(k)] === 0) st.so++; }
        else if (s.endedIn && !playoff) st.otl++;
        else st.l++;
      }
    }
  }
  if (!playoff) {
    updateRecord(h, s, "h");
    updateRecord(a, s, "a");
  }
  // Injuries (regular season and playoffs).
  for (const k of ["h", "a"]) {
    for (const id of s[k].dressed) {
      const p = league.players[id];
      if (p && chance(chanceInjury(p))) {
        p.injury = injuryLength();
        p.injuryNote = pick(["upper-body", "lower-body", "knee", "shoulder", "concussion", "ankle", "hand"]);
        if (p.tid === league.userTid) league.inbox?.push({ year: league.year, day: league.day, text: `${p.name} (${p.injuryNote}) is out about ${p.injury} game${p.injury > 1 ? "s" : ""}.` });
      }
    }
  }
  return {
    hs: s.score.h,
    as: s.score.a,
    ot: s.endedIn,
    shots: { ...s.shots },
    stars: threeStars(league, s),
    goals: s.goals.map((g) => ({ s: g.side, p: g.scorer, a: g.assists, per: g.period, t: g.time, ty: g.type })),
    g: { h: s.h.goalie, a: s.a.goalie },
  };
}

function updateRecord(team, s, k) {
  const r = team.rec;
  const won = s.winner === k;
  const gf = s.score[k];
  const ga = s.score[other(k)];
  r.gp++;
  r.gf += gf;
  r.ga += ga;
  const where = k === "h" ? r.home : r.away;
  let res;
  if (won) {
    r.w++;
    r.pts += 2;
    where.w++;
    if (!s.endedIn) r.rw++;
    if (s.endedIn !== "SO") r.row++;
    res = "W";
  } else if (s.endedIn) {
    r.otl++;
    r.pts += 1;
    where.otl++;
    res = "O";
  } else {
    r.l++;
    where.l++;
    res = "L";
  }
  r.last10 = (r.last10 + res).slice(-10);
  const kind = res === "W" ? "W" : res === "L" ? "L" : "OT";
  if (r.streak && r.streak[0] === kind) r.streak = [kind, r.streak[1] + 1];
  else r.streak = [kind, 1];
}

export function blankRecord() {
  return { gp: 0, w: 0, l: 0, otl: 0, pts: 0, gf: 0, ga: 0, rw: 0, row: 0, home: { w: 0, l: 0, otl: 0 }, away: { w: 0, l: 0, otl: 0 }, last10: "", streak: null };
}

function threeStars(league, s) {
  const scores = [];
  for (const id in s.box) {
    const b = s.box[id];
    const p = league.players[id];
    if (!p || isGoalie(p.pos)) continue;
    const v = b.g * 3 + b.a * 1.8 + b.pm * 0.4 + b.sog * 0.15 + b.hit * 0.05 + b.blk * 0.1 + rand() * 0.3;
    if (v > 0.5) scores.push([id, v]);
  }
  for (const gid in s.gbox) {
    const gb = s.gbox[gid];
    if (gb.toi < 1800) continue;
    const saves = gb.sa - gb.ga;
    const side = s.h.pl[gid] ? "h" : "a";
    const v = saves * 0.13 - gb.ga * 0.6 + (s.winner === side ? 1.5 : 0) + (gb.ga === 0 ? 2 : 0);
    scores.push([gid, v]);
  }
  return scores.sort((x, y) => y[1] - x[1]).slice(0, 3).map((x) => x[0]);
}

// Convenience: build + sim + apply in one call.
export function playGame(league, home, away, opts = {}) {
  const s = createGame(league, home, away, opts);
  simToEnd(s);
  return { state: s, result: applyResult(league, s, opts) };
}
