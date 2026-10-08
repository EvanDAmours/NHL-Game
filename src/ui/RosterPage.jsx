import React, { useState } from "react";
import { useGame, Table, PlayerName, Ovr, money, pct, signed, POS_ORDER } from "./common.jsx";
import { isGoalie, isDefense, capForYear, MAX_ROSTER, ARCHETYPES } from "../engine/constants.js";
import { capSpace, payroll, counts, sendDown, callUp, releasePlayer, canSendDown, rosterIssues, hasRoomFor, ensureMinimums, capYear } from "../engine/roster.js";
import { savePct, gaa } from "../engine/players.js";
import { shownRatings } from "../engine/draft.js";

export default function RosterPage() {
  const { league, commit, toast, ask } = useGame();
  const [view, setView] = useState("roster");
  const user = league.teams[league.userTid];
  const roster = user.roster.map((id) => league.players[id]).filter(Boolean);
  const minors = user.prospects.map((id) => league.players[id]).filter(Boolean);
  const c = counts(league, user);
  const issues = rosterIssues(league, user);

  const doSendDown = (p) => {
    if (!sendDown(league, user, p.id)) return toast("Only players 23 or younger, or earning $1.25M or less, can be sent to the minors.");
    commit();
  };
  const doRelease = async (p) => {
    const dead = p.yrs > 0 && p.cap > 0 ? ` His buyout leaves ${money(p.cap / 3)} of dead cap for ${p.yrs * 2} season(s).` : "";
    if (!(await ask({ title: `Release ${p.name}?`, body: `He becomes a free agent.${dead}`, yes: "Release", danger: true }))) return;
    releasePlayer(league, user, p.id);
    commit();
  };
  const doCallUp = (p) => {
    if (!hasRoomFor(league, user)) return toast(`Roster is full (${MAX_ROSTER} active). Send someone down first.`);
    callUp(league, user, p.id);
    commit();
  };

  const statusCol = { key: "st", label: "", render: (p) => (p.injury > 0 ? <span className="inj">INJ {p.injury}</span> : p.rookie ? <span className="pill">R</span> : null) };
  const base = [
    { key: "name", label: "Player", render: (p) => <PlayerName p={p} />, sort: (p) => p.name },
    { key: "pos", label: "Pos", render: (p) => <span className="posbadge">{p.pos}</span>, sort: (p) => POS_ORDER[p.pos] },
    { key: "age", label: "Age", num: true, sort: (p) => p.age },
    { key: "ovr", label: "OVR", render: (p) => <Ovr v={p.ovr} src={p.src} />, sort: (p) => p.ovr },
    { key: "pot", label: "POT", num: true, sort: (p) => p.pot },
    { key: "type", label: "Type", render: (p) => <span className="small muted">{ARCHETYPES[p.type]?.name}</span>, sort: (p) => p.type },
    { key: "cap", label: "Cap Hit", num: true, render: (p) => money(p.cap), sort: (p) => p.cap },
    { key: "yrs", label: "Yrs", num: true, sort: (p) => p.yrs, title: "Contract years remaining (including this season)" },
  ];
  const skaterStats = [
    { key: "gp", label: "GP", num: true, render: (p) => p.stats.gp, sort: (p) => p.stats.gp },
    { key: "g", label: "G", num: true, render: (p) => p.stats.g, sort: (p) => p.stats.g },
    { key: "a", label: "A", num: true, render: (p) => p.stats.a, sort: (p) => p.stats.a },
    { key: "pts", label: "P", num: true, render: (p) => p.stats.pts, sort: (p) => p.stats.pts },
    { key: "pm", label: "+/-", num: true, render: (p) => signed(p.stats.pm), sort: (p) => p.stats.pm },
  ];
  const goalieStats = [
    { key: "gp", label: "GP", num: true, render: (p) => p.stats.gp, sort: (p) => p.stats.gp },
    { key: "rec", label: "W-L-OT", render: (p) => `${p.stats.w}-${p.stats.l}-${p.stats.otl}` },
    { key: "sv", label: "SV%", num: true, render: (p) => pct(savePct(p.stats)), sort: (p) => savePct(p.stats) },
    { key: "gaa", label: "GAA", num: true, render: (p) => gaa(p.stats).toFixed(2), sort: (p) => gaa(p.stats) },
  ];
  const actions = {
    key: "act",
    label: "",
    render: (p) => (
      <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
        <button className="tiny" disabled={!canSendDown(p)} title={canSendDown(p) ? "Send to the minors" : "Only players ≤23 or earning ≤$1.25M can be sent down"} onClick={() => doSendDown(p)}>↓ Minors</button>
        <button className="tiny danger" onClick={() => doRelease(p)}>Release</button>
      </span>
    ),
  };

  const groups = [
    ["Forwards", roster.filter((p) => !isGoalie(p.pos) && !isDefense(p.pos)), skaterStats],
    ["Defense", roster.filter((p) => isDefense(p.pos)), skaterStats],
    ["Goalies", roster.filter((p) => isGoalie(p.pos)), goalieStats],
  ];

  return (
    <div className="stack">
      <div className="pagehead">
        <h2>Roster</h2>
        <span className="pill">{c.active}/{MAX_ROSTER} active</span>
        <span className="pill">{c.F} F · {c.D} D · {c.G} G</span>
        <span className="pill">Payroll {money(payroll(league, user))} / {money(capForYear(capYear(league)))}</span>
        <span className={`pill ${capSpace(league, user) < 0 ? "bad" : ""}`}>Space {money(capSpace(league, user))}</span>
      </div>
      {issues.length > 0 && (
        <div className="notice warn">
          {issues.map((i) => <div key={i}>⚠️ {i}</div>)}
          {issues.some((i) => i.startsWith("Need")) && (
            <button className="small" style={{ marginTop: 6 }} onClick={() => { ensureMinimums(league, user, { notify: true }); commit(); }}>Auto-fill with call-ups</button>
          )}
        </div>
      )}
      <div className="tabs">
        <button className={view === "roster" ? "on" : ""} onClick={() => setView("roster")}>NHL Roster</button>
        <button className={view === "minors" ? "on" : ""} onClick={() => setView("minors")}>Minors & Prospects ({minors.length})</button>
        <button className={view === "contracts" ? "on" : ""} onClick={() => setView("contracts")}>Contracts</button>
      </div>

      {view === "roster" &&
        groups.map(([title, rows, stats]) => (
          <div key={title}>
            <h3 className="muted small" style={{ textTransform: "uppercase", letterSpacing: 1, margin: "4px 0 8px" }}>{title} ({rows.length})</h3>
            <Table columns={[...base, statusCol, ...stats, actions]} rows={rows} initialSort={{ key: "ovr", dir: "desc" }} />
          </div>
        ))}

      {view === "minors" && (
        <>
          <div className="muted small">Players in the minors don't count against the cap or the 23-man roster. Unsigned draft picks get a 3-year entry-level contract when called up; their rights lapse at age 23.</div>
          <Table
            columns={[
              { key: "name", label: "Player", render: (p) => <PlayerName p={p} />, sort: (p) => p.name },
              { key: "pos", label: "Pos", render: (p) => <span className="posbadge">{p.pos}</span>, sort: (p) => POS_ORDER[p.pos] },
              { key: "age", label: "Age", num: true, sort: (p) => p.age },
              { key: "ovr", label: "OVR", render: (p) => <Ovr v={shownRatings(p).ovr} />, sort: (p) => p.ovr },
              { key: "pot", label: "POT", num: true, render: (p) => shownRatings(p).pot, sort: (p) => p.pot },
              { key: "draft", label: "Drafted", render: (p) => (p.draft ? `${p.draft.year} R${p.draft.round} #${p.draft.pick}` : <span className="dim">—</span>) },
              { key: "k", label: "Contract", render: (p) => (p.signed ? `${money(p.cap)} × ${p.yrs}` : <span className="pill">Unsigned</span>) },
              {
                key: "act",
                label: "",
                render: (p) => (
                  <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                    <button className="tiny" onClick={() => doCallUp(p)}>↑ Call up</button>
                    <button className="tiny danger" onClick={() => doRelease(p)}>Release</button>
                  </span>
                ),
              },
            ]}
            rows={minors}
            initialSort={{ key: "pot", dir: "desc" }}
            empty="No players in the minors."
          />
        </>
      )}

      {view === "contracts" && (
        <div className="grid g2">
          <Table
            columns={[
              { key: "name", label: "Player", render: (p) => <PlayerName p={p} />, sort: (p) => p.name },
              { key: "pos", label: "Pos", sort: (p) => POS_ORDER[p.pos] },
              { key: "age", label: "Age", num: true, sort: (p) => p.age },
              { key: "ovr", label: "OVR", render: (p) => <Ovr v={p.ovr} src={p.src} />, sort: (p) => p.ovr },
              { key: "cap", label: "Cap Hit", num: true, render: (p) => money(p.cap), sort: (p) => p.cap },
              { key: "yrs", label: "Years", num: true, sort: (p) => p.yrs },
              { key: "exp", label: "Expires", render: (p) => (p.yrs > 0 ? `${league.year + p.yrs}` : "—"), sort: (p) => p.yrs },
              { key: "pct", label: "% Cap", num: true, render: (p) => ((p.cap / capForYear(league.year)) * 100).toFixed(1) + "%", sort: (p) => p.cap },
            ]}
            rows={roster}
            initialSort={{ key: "cap", dir: "desc" }}
          />
          <div className="panel">
            <h3>Dead Cap (buyouts)</h3>
            <div className="list">
              {user.deadCap.map((d, i) => (
                <div className="item" key={i}>{d.name}<span style={{ marginLeft: "auto" }} className="mono">{money(d.amt)} × {d.yrs}</span></div>
              ))}
              {!user.deadCap.length && <div className="dim small">None.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
