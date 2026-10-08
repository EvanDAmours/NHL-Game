import React, { useState } from "react";
import { useGame, TeamBadge, TeamName } from "./common.jsx";
import { dayToDate, lastDay } from "../engine/schedule.js";

export default function SchedulePage() {
  const { league, openBox } = useGame();
  const [view, setView] = useState("mine");
  const [day, setDay] = useState(Math.min(league.day, lastDay(league.schedule)));
  const user = league.teams[league.userTid];
  const mine = league.schedule.filter((g) => g.h === user.id || g.a === user.id);
  const dayGames = league.schedule.filter((g) => g.day === day);
  const days = [...new Set(league.schedule.map((g) => g.day))];

  const result = (g) => {
    if (!g.played) return <span className="dim">—</span>;
    const home = g.h === user.id;
    const us = home ? g.hs : g.as;
    const them = home ? g.as : g.hs;
    const cls = us > them ? "good" : g.ot ? "warn" : "bad";
    return <span className={`link ${cls}`} onClick={() => openBox(g)}>{us > them ? "W" : g.ot ? "OTL" : "L"} {us}-{them}{g.ot ? ` (${g.ot})` : ""}</span>;
  };

  let w = 0, l = 0, o = 0;
  const running = mine.map((g) => {
    if (g.played) {
      const home = g.h === user.id;
      const us = home ? g.hs : g.as;
      const them = home ? g.as : g.hs;
      if (us > them) w++; else if (g.ot) o++; else l++;
    }
    return `${w}-${l}-${o}`;
  });

  return (
    <div className="stack">
      <div className="pagehead">
        <h2>Schedule</h2>
        <div className="tabs" style={{ margin: 0 }}>
          <button className={view === "mine" ? "on" : ""} onClick={() => setView("mine")}>{user.abbr} games</button>
          <button className={view === "day" ? "on" : ""} onClick={() => setView("day")}>Scoreboard</button>
        </div>
        <span className="muted small">Trade deadline: {dayToDate(league.year, league.deadlineDay)}</span>
      </div>

      {view === "mine" && (
        <div className="tablewrap">
          <table className="t">
            <thead>
              <tr><th>#</th><th>Date</th><th>Opponent</th><th>Result</th><th>Record</th><th className="num">Shots</th></tr>
            </thead>
            <tbody>
              {mine.map((g, i) => {
                const home = g.h === user.id;
                const opp = home ? g.a : g.h;
                return (
                  <tr key={g.id} className={g.day === league.day && !g.played && league.phase === "regular" ? "me" : ""}>
                    <td className="dim">{i + 1}</td>
                    <td className="nowrap">{dayToDate(league.year, g.day)}</td>
                    <td><span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>{home ? "vs" : "@"} <TeamBadge team={league.teams[opp]} size={20} /> <TeamName tid={opp} /></span></td>
                    <td>{result(g)}</td>
                    <td className="mono small">{g.played ? running[i] : ""}</td>
                    <td className="num small">{g.played ? `${home ? g.shots.h : g.shots.a}-${home ? g.shots.a : g.shots.h}` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {view === "day" && (
        <>
          <div className="row">
            <button className="small" disabled={days.indexOf(day) <= 0} onClick={() => setDay(days[days.indexOf(day) - 1])}>◀</button>
            <select value={day} onChange={(e) => setDay(Number(e.target.value))}>
              {days.map((d) => <option key={d} value={d}>{dayToDate(league.year, d)}</option>)}
            </select>
            <button className="small" disabled={days.indexOf(day) >= days.length - 1} onClick={() => setDay(days[days.indexOf(day) + 1])}>▶</button>
            <span className="muted small">{dayGames.length} games</span>
          </div>
          <div className="grid g3">
            {dayGames.map((g) => (
              <div key={g.id} className="panel" style={{ padding: 10, cursor: g.played ? "pointer" : "default" }} onClick={() => g.played && openBox(g)}>
                {[["a", g.a, g.as], ["h", g.h, g.hs]].map(([k, tid, sc]) => (
                  <div className="row" key={k} style={{ fontWeight: g.played && ((k === "h" && g.hs > g.as) || (k === "a" && g.as > g.hs)) ? 800 : 500 }}>
                    <TeamBadge team={league.teams[tid]} size={22} />
                    <span>{league.teams[tid].city} {league.teams[tid].name}</span>
                    <span style={{ marginLeft: "auto" }} className="mono">{g.played ? sc : ""}</span>
                  </div>
                ))}
                <div className="small dim" style={{ marginTop: 4 }}>{g.played ? `Final${g.ot ? " / " + g.ot : ""}` : "Scheduled"}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
