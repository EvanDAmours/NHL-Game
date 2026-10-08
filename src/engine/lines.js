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
  return team.lines;
}

// Special teams are drawn only from the 18 skaters dressed in the lineup.
function dressedSkaters(league, F, D) {
  return [...F.flat(), ...D.flat()].filter(Boolean).map((id) => league.players[id]).filter(Boolean);
}

function specialTeams(avail) {
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

// Keep user-set lines but replace anyone injured/gone with the best substitute.
export function repairLines(league, team) {
  if (!team.lines) return autoLines(league, team);
  const avail = healthy(league, team);
  const ok = new Set(avail.map((p) => p.id));
  const used = new Set();
  const all = [...team.lines.F.flat(), ...team.lines.D.flat(), ...team.lines.G];
  for (const id of all) if (id && ok.has(id)) used.add(id);
  const spare = (pred) => {
    const p = avail.filter((x) => !used.has(x.id) && pred(x)).sort(byOvr)[0];
    if (p) used.add(p.id);
    return p ? p.id : null;
  };
  let broken = false;
  const fix = (id, pred) => {
    if (id && ok.has(id)) return id;
    broken = true;
    return spare(pred) || spare((x) => !isGoalie(x.pos));
  };
  const fixedF = team.lines.F.map((line) => line.map((id, j) => fix(id, (x) => (j === 1 ? x.pos === "C" : isForward(x.pos)))));
  const fixedD = team.lines.D.map((pair) => pair.map((id) => fix(id, (x) => isDefense(x.pos))));
  let G = team.lines.G.map((id) => (id && ok.has(id) ? id : null));
  if (!G[0] || !G[1]) {
    const gs = avail.filter((x) => isGoalie(x.pos) && !G.includes(x.id)).sort(byOvr);
    if (!G[0]) G[0] = (gs.shift() || {}).id || null;
    if (!G[1]) G[1] = (gs.shift() || {}).id || null;
  }
  team.lines.F = fixedF;
  team.lines.D = fixedD;
  team.lines.G = G;
  const dressed = new Set([...fixedF.flat(), ...fixedD.flat()]);
  const stOk = [...team.lines.PP.flat(), ...team.lines.PK.flat()].every((id) => dressed.has(id));
  if (broken || !stOk) Object.assign(team.lines, specialTeams(dressedSkaters(league, fixedF, fixedD)));
  return team.lines;
}

export function lineupIds(lines) {
  return [...lines.F.flat(), ...lines.D.flat(), ...lines.G].filter(Boolean);
}

// Team strength snapshot used by standings previews, trade AI and the hub.
export function teamRatings(league, team) {
  const lines = team.lines || autoLines(league, team);
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
