// Line combinations: 4 forward lines (LW-C-RW), 3 defense pairs (LD-RD),
// a goalie tandem, and two power-play and penalty-kill units.
import { composites } from "./ratings.js";
import { isForward, isDefense, isGoalie } from "./constants.js";

export function rosterPlayers(league, team) {
  return team.roster.map((id) => league.players[id]).filter(Boolean);
}

export function healthy(league, team) {
  return rosterPlayers(league, team).filter((p) => p.injury <= 0);
}

const byOvr = (a, b) => b.ovr - a.ovr;

export function autoLines(league, team) {
  const avail = healthy(league, team);
  const fwds = avail.filter((p) => isForward(p.pos)).sort(byOvr);
  const dmen = avail.filter((p) => isDefense(p.pos)).sort(byOvr);
  const goalies = avail.filter((p) => isGoalie(p.pos)).sort(byOvr);
  const used = new Set();
  const take = (list, pred) => {
    const p = list.find((x) => !used.has(x.id) && (!pred || pred(x)));
    if (p) used.add(p.id);
    return p ? p.id : null;
  };

  const F = [];
  for (let i = 0; i < 4; i++) {
    const c = take(fwds, (p) => p.pos === "C") || take(fwds);
    const lw = take(fwds, (p) => p.pos === "LW") || take(fwds, (p) => p.pos === "RW") || take(fwds);
    const rw = take(fwds, (p) => p.pos === "RW") || take(fwds, (p) => p.pos === "LW") || take(fwds);
    F.push([lw, c, rw]);
  }
  const D = [];
  for (let i = 0; i < 3; i++) {
    const ld = take(dmen, (p) => p.pos === "LD") || take(dmen);
    const rd = take(dmen, (p) => p.pos === "RD") || take(dmen);
    D.push([ld, rd]);
  }
  // Emergency: dress forwards on defense (or vice versa) if short-handed.
  for (const pair of D) for (let j = 0; j < 2; j++) if (!pair[j]) pair[j] = take(fwds);
  for (const line of F) for (let j = 0; j < 3; j++) if (!line[j]) line[j] = take(dmen);

  const G = [goalies[0]?.id || null, goalies[1]?.id || null];
  team.lines = { F, D, G, ...specialTeams(dressedSkaters(league, F, D)) };
  team.linesNew = [];
  return team.lines;
}

// Special teams are drawn only from the 18 skaters dressed in the lineup.
export function dressedSkaters(league, F, D) {
  return [...F.flat(), ...D.flat()].filter(Boolean).map((id) => league.players[id]).filter(Boolean);
}

export function specialTeams(avail) {
  const fwds = avail.filter((p) => isForward(p.pos)).map((p) => ({ p, c: composites(p) }));
  const dmen = avail.filter((p) => isDefense(p.pos)).map((p) => ({ p, c: composites(p) }));
  const off = (x) => x.c.off * 0.7 + x.p.ovr * 0.3;
  const def = (x) => x.c.def * 0.7 + x.p.ovr * 0.3;
  const fOff = [...fwds].sort((a, b) => off(b) - off(a));
  const dOff = [...dmen].sort((a, b) => off(b) - off(a));
  const fDef = [...fwds].sort((a, b) => def(b) - def(a));
  const dDef = [...dmen].sort((a, b) => def(b) - def(a));
  const ids = (arr) => arr.filter(Boolean).map((x) => x.p.id);
  return {
    PP: [ids([fOff[0], fOff[1], fOff[2], fOff[3], dOff[0]]), ids([fOff[4], fOff[5], fOff[6], dOff[1], fOff[7] || dOff[2]])],
    PK: [ids([fDef[0], fDef[1], dDef[0], dDef[1]]), ids([fDef[2], fDef[3], dDef[2], dDef[3]])],
  };
}

const groupOf = (pos) => (isGoalie(pos) ? "G" : isDefense(pos) ? "D" : "F");
const normName = (s) => String(s).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const COLUMN = { LW: 0, C: 1, RW: 2, LD: 0, RD: 1 };
const slotPred = (grp, j) => (grp === "G" ? (x) => isGoalie(x.pos) : grp === "D" ? (x) => isDefense(x.pos) : j === 1 ? (x) => x.pos === "C" : (x) => isForward(x.pos));
const clone = (L) => ({ F: L.F.map((l) => [...l]), D: L.D.map((l) => [...l]), G: [...L.G], PP: (L.PP || [[], []]).map((u) => [...u]), PK: (L.PK || [[], []]).map((u) => [...u]) });

// Best healthy player not yet used, matching the slot (C slot prefers centres).
function spareFinder(league, team, used) {
  const avail = healthy(league, team).sort(byOvr);
  const take = (pred) => {
    const p = avail.find((x) => !used.has(x.id) && pred(x));
    if (p) used.add(p.id);
    return p ? p.id : null;
  };
  return (grp, j) => take(slotPred(grp, j)) || (grp === "G" ? null : take(slotPred(grp, 0)) || take((x) => !isGoalie(x.pos)));
}

// Set lines from player names (the real NHL combinations in the roster file).
// Unreported slots (null) are filled with the best healthy player left.
export function linesFromNames(league, team, spec) {
  const roster = rosterPlayers(league, team);
  const used = new Set();
  const find = (name, grp) => {
    if (!name) return null;
    const n = normName(name);
    const hit = roster.find((p) => !used.has(p.id) && normName(p.name) === n && groupOf(p.pos) === grp) || roster.find((p) => !used.has(p.id) && normName(p.name) === n);
    if (hit) used.add(hit.id);
    return hit ? hit.id : null;
  };
  const F = [0, 1, 2, 3].map((i) => [0, 1, 2].map((j) => find(spec.F?.[i]?.[j], "F")));
  const D = [0, 1, 2].map((i) => [0, 1].map((j) => find(spec.D?.[i]?.[j], "D")));
  const G = [0, 1].map((j) => find(spec.G?.[j], "G"));
  team.lines = { F, D, G, PP: [[], []], PK: [[], []] };
  team.linesNew = [];
  syncLines(league, team);
  team.nhlLines = clone(team.lines);
  return team.lines;
}

// Go back to the opening-night NHL combinations (players who have left are replaced).
export function resetNhlLines(league, team) {
  if (!team.nhlLines) return autoLines(league, team);
  team.lines = clone(team.nhlLines);
  team.lines.PP = [[], []];
  team.lines.PK = [[], []];
  return syncLines(league, team);
}

// After roster moves: replace players who have left the team, fill empty slots,
// and work newly arrived or newly healthy players (team.linesNew) into the lineup.
// Injured players keep their spot; gameLines() covers for them game by game.
export function syncLines(league, team) {
  if (!team.lines) {
    team.linesNew = [];
    return autoLines(league, team);
  }
  const L = team.lines;
  const on = new Set(team.roster);
  const used = new Set(lineupIds(L).filter((id) => on.has(id)));
  const spare = spareFinder(league, team, used);
  let changed = false;
  const keep = (id, grp, j) => {
    if (id && on.has(id)) return id;
    const sub = spare(grp, j);
    if (sub) changed = true;
    return sub;
  };
  L.F = L.F.map((line) => line.map((id, j) => keep(id, "F", j)));
  L.D = L.D.map((pair) => pair.map((id, j) => keep(id, "D", j)));
  L.G = L.G.map((id) => keep(id, "G", 0));
  if (!L.G[0] && L.G[1]) L.G = [L.G[1], null];

  const queue = (team.linesNew || []).filter((id) => on.has(id));
  team.linesNew = [];
  for (const id of queue) {
    const p = league.players[id];
    if (!p || p.injury > 0 || lineupIds(L).includes(id)) continue;
    if (slotIn(league, team, p)) {
      changed = true;
      if (team.id === league.userTid) league.inbox?.push({ year: league.year, day: league.day, text: `${p.name} slots into your lineup. Check the Lines tab.` });
    }
  }
  if (!L.PP?.[0]?.length || !L.PK?.[0]?.length || (changed && team.id !== league.userTid)) Object.assign(L, specialTeams(dressedSkaters(league, L.F, L.D)));
  else patchSpecialTeams(league, L);
  return L;
}

// Keep custom PP/PK units, swapping out only players who are no longer dressed.
export function patchSpecialTeams(league, L) {
  const dressed = dressedSkaters(league, L.F, L.D).map((p) => ({ p, c: composites(p) }));
  const score = { PP: (x) => x.c.off * 0.7 + x.p.ovr * 0.3, PK: (x) => x.c.def * 0.7 + x.p.ovr * 0.3 };
  const ids = new Set(dressed.map((x) => x.p.id));
  for (const k of ["PP", "PK"]) {
    const units = L[k];
    for (const unit of units) {
      unit.forEach((id, j) => {
        if (ids.has(id)) return;
        const inUse = new Set(units.flat());
        const wasD = isDefense(league.players[id]?.pos);
        const pool = dressed.filter((x) => !inUse.has(x.p.id)).sort((a, b) => score[k](b) - score[k](a));
        const pick = pool.find((x) => isDefense(x.p.pos) === wasD) || pool[0];
        unit[j] = pick ? pick.p.id : null;
      });
    }
    L[k] = units.map((u) => u.filter(Boolean));
  }
}

// Put a player into the lineup if he beats the bottom of his column (4th-line C for a
// centre, 3rd-pair RD for a right D...), then move him up past anyone he's better than.
export function slotIn(league, team, p, { margin = 0 } = {}) {
  const L = team.lines;
  if (!L || !p) return false;
  const on = new Set(team.roster);
  const grp = groupOf(p.pos);
  // A defenceman filling in at forward (or vice versa) is always the first to make way.
  const val = (id) => (id && on.has(id) && league.players[id] && groupOf(league.players[id].pos) === grp ? league.players[id].ovr : -1);
  if (isGoalie(p.pos)) {
    if (p.ovr <= val(L.G[1]) + margin) return false;
    L.G[1] = p.id;
    if (p.ovr > val(L.G[0]) + 2) L.G = [L.G[1], L.G[0]];
    return true;
  }
  const rows = isDefense(p.pos) ? L.D : L.F;
  const col = COLUMN[p.pos] ?? 0;
  const last = rows.length - 1;
  if (p.ovr > val(rows[last][col]) + margin) {
    rows[last][col] = p.id;
    for (let i = last; i > 0 && p.ovr > val(rows[i - 1][col]); i--) {
      [rows[i - 1][col], rows[i][col]] = [rows[i][col], rows[i - 1][col]];
    }
    return true;
  }
  let worst = null;
  rows.forEach((r, i) => r.forEach((id, j) => {
    const v = val(id);
    if (!worst || v < worst.v) worst = { i, j, v };
  }));
  if (worst && p.ovr > worst.v + margin + 2) {
    rows[worst.i][worst.j] = p.id;
    return true;
  }
  return false;
}

// AI coaches look at their scratches about once a week and dress anyone clearly better.
export function coachLines(league, team) {
  const L = syncLines(league, team);
  const inLineup = new Set(lineupIds(L));
  const spares = healthy(league, team).filter((p) => !inLineup.has(p.id)).sort(byOvr);
  let moved = 0;
  for (const p of spares) {
    if (moved >= 3) break;
    if (slotIn(league, team, p, { margin: 4 })) moved++;
  }
  if (moved) Object.assign(L, specialTeams(dressedSkaters(league, L.F, L.D)));
  return L;
}

// The lineup actually dressed for a game: injured or departed players are covered by the
// best healthy scratch, without changing the saved lines.
export function gameLines(league, team) {
  const L = team.lines || syncLines(league, team);
  const on = new Set(team.roster);
  const ok = (id) => id && on.has(id) && league.players[id] && league.players[id].injury <= 0;
  const used = new Set(lineupIds(L).filter(ok));
  const spare = spareFinder(league, team, used);
  let subbed = false;
  const fix = (id, grp, j) => {
    if (ok(id)) return id;
    subbed = true;
    return spare(grp, j);
  };
  const F = L.F.map((line) => line.map((id, j) => fix(id, "F", j)));
  const D = L.D.map((pair) => pair.map((id, j) => fix(id, "D", j)));
  let G = L.G.map((id) => (ok(id) ? id : spare("G", 0)));
  if (!G[0] && G[1]) G = [G[1], null];
  const dressed = new Set([...F.flat(), ...D.flat()].filter(Boolean));
  const st = [...(L.PP || []).flat(), ...(L.PK || []).flat()];
  const stOk = L.PP?.[0]?.length && L.PK?.[0]?.length && st.every((id) => dressed.has(id));
  const special = subbed || !stOk ? specialTeams(dressedSkaters(league, F, D)) : { PP: L.PP, PK: L.PK };
  return { F, D, G, ...special };
}

export function lineupIds(lines) {
  return [...lines.F.flat(), ...lines.D.flat(), ...lines.G].filter(Boolean);
}

// Team strength snapshot used by standings previews, trade AI and the hub.
export function teamRatings(league, team) {
  const lines = gameLines(league, team);
  const get = (id) => league.players[id];
  const lineAvg = (ids) => {
    const ps = ids.map(get).filter(Boolean);
    return ps.length ? ps.reduce((s, p) => s + p.ovr, 0) / ps.length : 60;
  };
  const fw = [0.36, 0.3, 0.21, 0.13];
  const dw = [0.42, 0.34, 0.24];
  const fwd = lines.F.reduce((s, l, i) => s + lineAvg(l) * fw[i], 0);
  const def = lines.D.reduce((s, l, i) => s + lineAvg(l) * dw[i], 0);
  const g = get(lines.G[0])?.ovr ?? 70;
  const overall = fwd * 0.45 + def * 0.3 + g * 0.25;
  return { fwd: Math.round(fwd), def: Math.round(def), g: Math.round(g), ovr: Math.round(overall) };
}
