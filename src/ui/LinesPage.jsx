import React from "react";
import { useGame, Ovr, PlayerName } from "./common.jsx";
import { autoLines, repairLines, healthy, teamRatings } from "../engine/lines.js";
import { isGoalie, isDefense, isForward } from "../engine/constants.js";

const F_LABELS = ["LW", "C", "RW"];
const D_LABELS = ["LD", "RD"];

export default function LinesPage() {
  const { league, commit } = useGame();
  const user = league.teams[league.userTid];
  if (!user.lines) autoLines(league, user);
  else repairLines(league, user);
  const lines = user.lines;
  const avail = healthy(league, user).sort((a, b) => b.ovr - a.ovr);
  const get = (id) => league.players[id];
  const tr = teamRatings(league, user);

  // Assign a player to a slot within a group; if he's already in that group, swap.
  const assign = (group, i, j, id) => {
    const L = user.lines;
    const groups = group === "F" || group === "D" || group === "G" ? ["F", "D", "G"] : [group];
    let from = null;
    for (const gname of groups) {
      const arr = L[gname];
      if (gname === "G") {
        const k = arr.indexOf(id);
        if (k >= 0) from = { g: "G", i: k };
      } else {
        arr.forEach((line, a) => line.forEach((x, b) => { if (x === id) from = { g: gname, i: a, j: b }; }));
      }
    }
    const cur = group === "G" ? L.G[i] : L[group][i][j];
    if (group === "G") L.G[i] = id; else L[group][i][j] = id;
    if (from) {
      if (from.g === "G") L.G[from.i] = cur; else L[from.g][from.i][from.j] = cur;
    }
    commit();
  };

  const slot = (group, i, j, label, filter) => {
    const id = group === "G" ? lines.G[i] : lines[group][i][j];
    const p = get(id);
    const options = avail.filter(filter);
    return (
      <div className="row" style={{ gap: 6, flexWrap: "nowrap" }} key={`${group}${i}${j}`}>
        <span className="posbadge" style={{ width: 26 }}>{label}</span>
        <select value={id || ""} onChange={(e) => assign(group, i, j, e.target.value)} style={{ flex: 1, minWidth: 0 }}>
          {!p && <option value="">— empty —</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.ovr} · {o.name} ({o.pos})
            </option>
          ))}
        </select>
        {p && <Ovr v={p.ovr} />}
      </div>
    );
  };

  const lineAvg = (ids) => {
    const ps = ids.map(get).filter(Boolean);
    return ps.length ? Math.round(ps.reduce((s, p) => s + p.ovr, 0) / ps.length) : "-";
  };
  const offPos = (id, want) => {
    const p = get(id);
    return p && want && p.pos !== want && !(isForward(p.pos) && want !== "C" && p.pos !== "C") ? "⚠" : "";
  };

  const usedES = new Set([...lines.F.flat(), ...lines.D.flat()]);
  const scratches = avail.filter((p) => !usedES.has(p.id) && !isGoalie(p.pos));

  return (
    <div className="stack">
      <div className="pagehead">
        <h2>Lines</h2>
        <span className="pill">Team OVR {tr.ovr}</span>
        <span className="pill">Forwards {tr.fwd}</span>
        <span className="pill">Defense {tr.def}</span>
        <span className="pill">Goalie {tr.g}</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => { autoLines(league, user); commit(); }}>Auto-set lines</button>
      </div>
      <div className="muted small">
        Ice time: top line ≈33%, 2nd ≈29%, 3rd ≈22%, 4th ≈16%. Power-play and penalty-kill units are picked from your dressed skaters. Choosing a player who's already in another slot swaps them.
      </div>
      <div className="grid g2">
        <div className="panel">
          <h3>Forward Lines</h3>
          <div className="stack" style={{ gap: 12 }}>
            {lines.F.map((line, i) => (
              <div key={i}>
                <div className="row between small muted" style={{ marginBottom: 4 }}>
                  <span>Line {i + 1}</span>
                  <span>Avg {lineAvg(line)} {line.map((id, j) => offPos(id, F_LABELS[j])).join("")}</span>
                </div>
                <div className="stack" style={{ gap: 4 }}>
                  {line.map((_, j) => slot("F", i, j, F_LABELS[j], (p) => !isGoalie(p.pos)))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="stack">
          <div className="panel">
            <h3>Defense Pairs</h3>
            <div className="stack" style={{ gap: 12 }}>
              {lines.D.map((pair, i) => (
                <div key={i}>
                  <div className="row between small muted" style={{ marginBottom: 4 }}>
                    <span>Pair {i + 1}</span>
                    <span>Avg {lineAvg(pair)}</span>
                  </div>
                  <div className="stack" style={{ gap: 4 }}>{pair.map((_, j) => slot("D", i, j, D_LABELS[j], (p) => !isGoalie(p.pos)))}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="panel">
            <h3>Goalies</h3>
            <div className="stack" style={{ gap: 4 }}>
              {slot("G", 0, 0, "G1", (p) => isGoalie(p.pos))}
              {slot("G", 1, 0, "G2", (p) => isGoalie(p.pos))}
            </div>
            <label className="row small" style={{ marginTop: 10 }}>
              <input type="checkbox" checked={user.autoGoalie !== false} onChange={(e) => { user.autoGoalie = e.target.checked; commit(); }} />
              Rest the starter automatically (backup starts ~20% of regular-season games)
            </label>
          </div>
          <div className="panel">
            <h3>Scratches</h3>
            <div className="row">
              {scratches.map((p) => <span key={p.id} className="pill"><PlayerName p={p} /> {p.ovr}</span>)}
              {!scratches.length && <span className="dim small">None.</span>}
            </div>
          </div>
        </div>
      </div>
      <div className="grid g2">
        {["PP", "PK"].map((g) => (
          <div className="panel" key={g}>
            <h3>{g === "PP" ? "Power Play" : "Penalty Kill"} Units</h3>
            <div className="grid g2">
              {lines[g].map((unit, i) => (
                <div key={i}>
                  <div className="small muted" style={{ marginBottom: 4 }}>Unit {i + 1} · Avg {lineAvg(unit)}</div>
                  <div className="stack" style={{ gap: 4 }}>
                    {unit.map((_, j) => slot(g, i, j, isDefense(get(unit[j])?.pos) ? "D" : "F", (p) => !isGoalie(p.pos) && usedES.has(p.id)))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
