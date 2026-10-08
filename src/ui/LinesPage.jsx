import React, { useState } from "react";
import { useGame, Ovr, TeamBadge } from "./common.jsx";
import { autoLines, resetNhlLines, syncLines, gameLines, healthy, teamRatings, lineupIds } from "../engine/lines.js";
import { isGoalie, isForward } from "../engine/constants.js";
import { restShare, REST_OPTIONS } from "../engine/sim.js";

// Daily Faceoff-style line chart: forward lines, defence pairs, special-teams units,
// goalies and the injury list. Tap one player, then another, to swap them.

const F_POS = ["LW", "C", "RW"];
const D_POS = ["LD", "RD"];

const splitName = (name) => {
  const i = name.indexOf(" ");
  return i < 0 ? ["", name] : [name.slice(0, i), name.slice(i + 1)];
};
const initials = (name) => {
  const [a, b] = splitName(name);
  return ((a[0] || "") + (b.replace(/^(van|de|del|la|le)\s+/i, "")[0] || "")).toUpperCase();
};
const avg = (ps) => (ps.length ? Math.round(ps.reduce((s, p) => s + p.ovr, 0) / ps.length) : "–");
const sameLines = (a, b) => !!a && !!b && JSON.stringify([a.F, a.D, a.G]) === JSON.stringify([b.F, b.D, b.G]);

export default function LinesPage() {
  const { league, commit, openPlayer, toast } = useGame();
  const [viewTid, setViewTid] = useState(league.userTid);
  const [sel, setSel] = useState(null);
  const team = league.teams[viewTid];
  const mine = viewTid === league.userTid;
  if (!team.lines) syncLines(league, team);
  const L = team.lines;
  const game = gameLines(league, team);
  const get = (id) => (id ? league.players[id] : null);
  const tr = teamRatings(league, team);
  const [c1, c2] = team.colors;

  // ---- slot addressing: {g:"F"|"D"|"PP"|"PK", i, j} | {g:"G", i} | {g:"X", id} (bench) ----
  const read = (a) => (a.g === "X" ? a.id : a.g === "G" ? L.G[a.i] : L[a.g][a.i][a.j]);
  const write = (a, id) => {
    if (a.g === "G") L.G[a.i] = id;
    else L[a.g][a.i][a.j] = id;
  };
  const kind = (a) => (a.g === "PP" || a.g === "PK" ? a.g : a.g === "X" ? a.k : a.g === "G" ? "G" : "ES");
  const same = (a, b) => a && b && a.g === b.g && a.i === b.i && a.j === b.j && a.id === b.id;

  const act = (a) => {
    if (!mine) return;
    if (!sel) return setSel(a);
    if (same(sel, a)) return setSel(null);
    const ka = kind(sel);
    const kb = kind(a);
    const goalieA = isGoalie(get(read(sel))?.pos || (ka === "G" ? "G" : ""));
    const goalieB = isGoalie(get(read(a))?.pos || (kb === "G" ? "G" : ""));
    const ok = ka === kb || (ka === "ES" && kb === "G" && goalieA) || (ka === "G" && kb === "ES" && goalieB);
    if (!ok || (sel.g === "X" && a.g === "X")) return setSel(a);
    if (goalieA !== goalieB && ka !== "PP" && ka !== "PK") {
      toast("Goalies can only swap with goalies.");
      return setSel(null);
    }
    const x = read(sel);
    const y = read(a);
    if (sel.g !== "X") write(sel, y);
    if (a.g !== "X") write(a, x);
    setSel(null);
    syncLines(league, team);
    commit();
  };

  const card = (a, label, { big = false } = {}) => {
    const id = read(a);
    const p = get(id);
    const isSel = same(sel, a);
    let subName = null;
    if (p && p.injury > 0 && (a.g === "F" || a.g === "D")) subName = get(game[a.g][a.i][a.j])?.name;
    if (p && p.injury > 0 && a.g === "G") subName = get(game.G[a.i])?.name;
    const off = p && label && p.pos !== label && !(label !== "C" && isForward(p.pos) && p.pos !== "C") && !["PP", "PK", "G"].includes(label);
    const [first, last] = p ? splitName(p.name) : ["", "Empty"];
    return (
      <button
        type="button"
        key={`${a.g}${a.i}${a.j ?? ""}`}
        className={`lcard${isSel ? " sel" : ""}${p?.injury > 0 ? " out" : ""}${big ? " big" : ""}${mine ? "" : " ro"}`}
        onClick={() => act(a)}
        title={p ? `${p.name} · ${p.pos} · ${p.ovr} OVR` : "Empty slot"}
      >
        <span className="lav" style={{ background: c1, color: c2 }}>{p ? initials(p.name) : "?"}</span>
        <span className="lnm">
          <span className="lfirst">{first}</span>
          <span className="llast">{last}</span>
        </span>
        <span className="lmeta">
          {p && <Ovr v={p.ovr} src={p.src} />}
          {p && <span className={`lposb${off ? " warn" : ""}`}>{p.pos}</span>}
        </span>
        {p?.injury > 0 && (
          <span className="lout">
            OUT {p.injury}g{subName ? ` · ${splitName(subName)[1]} plays` : ""}
          </span>
        )}
      </button>
    );
  };

  const section = (title, sub, body, extra) => (
    <div className="panel lsec">
      <div className="lsech" style={{ borderColor: c1 }}>
        <h3>{title}</h3>
        {sub && <span className="small muted">{sub}</span>}
        {extra}
      </div>
      {body}
    </div>
  );

  const roster = team.roster.map(get).filter(Boolean);
  const inLineup = new Set(lineupIds(L));
  const dressedIds = new Set([...L.F.flat(), ...L.D.flat()]);
  const injured = roster.filter((p) => p.injury > 0).sort((a, b) => b.injury - a.injury);
  const scratches = healthy(league, team).filter((p) => !inLineup.has(p.id)).sort((a, b) => b.ovr - a.ovr);
  const benchFor = (k) =>
    k === "PP" || k === "PK"
      ? [...dressedIds].map(get).filter((p) => p && !L[k].flat().includes(p.id)).sort((a, b) => b.ovr - a.ovr)
      : scratches;

  const chip = (p, k) => {
    const a = { g: "X", id: p.id, k };
    return (
      <button type="button" key={`${k}${p.id}`} className={`lchip${same(sel, a) ? " sel" : ""}${mine ? "" : " ro"}`} onClick={() => act(a)}>
        <Ovr v={p.ovr} /> {p.name} <span className="dim">{p.pos}</span>
      </button>
    );
  };
  const selKind = sel ? kind(sel) : null;
  const benchHint = (k) => mine && selKind === k && sel.g !== "X";

  const nhl = team.nhlLines;
  const matchesNhl = sameLines(L, nhl);
  const selPlayer = sel ? get(read(sel)) : null;

  return (
    <div className="stack lines" style={{ "--c1": c1, "--c2": c2 }}>
      <div className="lhero">
        <TeamBadge team={team} size={44} />
        <div style={{ minWidth: 0 }}>
          <div className="lhero-t">{team.city} {team.name}</div>
          <div className="small muted">
            Line combinations · {league.year}-{String(league.year + 1).slice(2)}
            {nhl && (matchesNhl ? " · opening-night NHL lines" : " · changed from opening night")}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <select value={viewTid} onChange={(e) => { setViewTid(Number(e.target.value)); setSel(null); }} aria-label="Team">
          {[...league.teams].sort((a, b) => a.city.localeCompare(b.city)).map((t) => (
            <option key={t.id} value={t.id}>{t.city} {t.name}{t.id === league.userTid ? " (you)" : ""}</option>
          ))}
        </select>
      </div>

      <div className="row">
        <span className="pill">Team {tr.ovr}</span>
        <span className="pill">Forwards {tr.fwd}</span>
        <span className="pill">Defense {tr.def}</span>
        <span className="pill">Goalie {tr.g}</span>
        <div style={{ flex: 1 }} />
        {mine && nhl && !matchesNhl && (
          <button className="small" onClick={() => { resetNhlLines(league, team); setSel(null); commit(); toast("Back to the opening-night NHL lines."); }}>
            Reset to NHL lines
          </button>
        )}
        {mine && (
          <button className="small" onClick={() => { autoLines(league, team); setSel(null); commit(); toast("Lines set by rating."); }}>
            Auto-set by rating
          </button>
        )}
      </div>
      <div className="muted small">
        {mine
          ? "Tap a player, then tap another to swap them — or tap a scratch to put him in. Injured players keep their spot; the best healthy scratch plays until they're back."
          : "Viewing another team's lines. Their coach adjusts them for injuries, trades and call-ups during the season."}
      </div>

      <div className="lmain">
        {section(
          "Forwards",
          null,
          <div className="lgrid f">
            <div className="lhead" />
            {F_POS.map((x) => <div key={x} className="lhead">{x}</div>)}
            {L.F.map((line, i) => (
              <React.Fragment key={i}>
                <div className="llabel">
                  <span>Line {i + 1}</span>
                  <span className="dim">{avg(game.F[i].map(get).filter(Boolean))}</span>
                </div>
                {line.map((_, j) => card({ g: "F", i, j }, F_POS[j]))}
              </React.Fragment>
            ))}
          </div>
        )}
        <div className="stack">
          {section(
            "Defensive pairings",
            null,
            <div className="lgrid d">
              <div className="lhead" />
              {D_POS.map((x) => <div key={x} className="lhead">{x}</div>)}
              {L.D.map((pair, i) => (
                <React.Fragment key={i}>
                  <div className="llabel">
                    <span>Pair {i + 1}</span>
                    <span className="dim">{avg(game.D[i].map(get).filter(Boolean))}</span>
                  </div>
                  {pair.map((_, j) => card({ g: "D", i, j }, D_POS[j]))}
                </React.Fragment>
              ))}
            </div>
          )}
          {section(
            "Goalies",
            null,
            <div className="lgrid g">
              <div className="lhead">Starter</div>
              <div className="lhead">Backup</div>
              {card({ g: "G", i: 0 }, "G", { big: true })}
              {card({ g: "G", i: 1 }, "G", { big: true })}
            </div>,
            mine ? (
              <label className="row small" style={{ marginLeft: "auto" }} title="How often your backup starts in the regular season. The starter plays every playoff game.">
                Starter rests
                <select value={Math.round(restShare(league, team) * 100)} onChange={(e) => { team.restPct = Number(e.target.value); team.autoGoalie = team.restPct > 0; commit(); }} aria-label="How often the starter rests">
                  {REST_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r === 0 ? "never" : `${r}%`} · ~{Math.round(82 * (1 - r / 100))} starts{r === 20 ? " (typical)" : r >= 40 ? " (1A/1B)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="muted small" style={{ marginLeft: "auto" }}>
                {Math.round(restShare(league, team) * 100) >= 40 ? "1A/1B tandem" : `Backup starts ~${Math.round(restShare(league, team) * 100)}%`}
              </span>
            )
          )}
        </div>
      </div>

      <div className="grid g2">
        {["PP", "PK"].map((k) =>
          <React.Fragment key={k}>
            {section(
              k === "PP" ? "Power play" : "Penalty kill",
              k === "PP" ? "from dressed skaters" : null,
              <div className="stack" style={{ gap: 10 }}>
                {L[k].map((unit, i) => (
                  <div key={i}>
                    <div className="llabel row">
                      <span>{i === 0 ? "1st" : "2nd"} unit</span>
                      <span className="dim">{avg(unit.map(get).filter(Boolean))}</span>
                    </div>
                    <div className={`lunit n${unit.length}`}>{unit.map((_, j) => card({ g: k, i, j }, k))}</div>
                  </div>
                ))}
                {benchHint(k) && (
                  <div className="lbench">
                    <div className="small muted">Put in instead:</div>
                    <div className="row">{benchFor(k).slice(0, 10).map((p) => chip(p, k))}</div>
                  </div>
                )}
              </div>
            )}
          </React.Fragment>
        )}
      </div>

      <div className="grid g2">
        {section(
          "Injuries",
          injured.length ? `${injured.length} out` : null,
          injured.length ? (
            <div className="stack" style={{ gap: 6 }}>
              {injured.map((p) => (
                <div key={p.id} className="linj">
                  <span className="lposb">{p.pos}</span>
                  <span className="link" onClick={() => openPlayer(p.id)}>{p.name}</span>
                  <span className="dim small">{p.injuryNote || "injury"}</span>
                  <span className="bad small" style={{ marginLeft: "auto" }}>Out {p.injury} game{p.injury === 1 ? "" : "s"}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="dim small">No injuries.</div>
          )
        )}
        {section(
          "Healthy scratches",
          mine && sel && selKind === "ES" ? "tap one to put him in" : null,
          scratches.length ? <div className="row">{scratches.map((p) => chip(p, isGoalie(p.pos) ? "G" : "ES"))}</div> : <div className="dim small">None.</div>
        )}
      </div>

      {mine && selPlayer && (
        <div className="lselbar">
          <span><b>{selPlayer.name}</b> selected — tap another player to swap.</span>
          <div style={{ flex: 1 }} />
          <button className="small" onClick={() => openPlayer(selPlayer.id)}>Profile</button>
          <button className="small ghost" onClick={() => setSel(null)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
