import React, { useState } from "react";
import { useGame, TeamBadge, TeamName } from "./common.jsx";
import { divisionTable, conferenceTable, leagueTable, playoffPicture, clinchStatus } from "../engine/standings.js";
import { DIVISIONS } from "../engine/teams.js";
import { teamRatings } from "../engine/lines.js";

function StandTable({ teams, cutAfter, title }) {
  const { league } = useGame();
  const status = clinchStatus(league);
  return (
    <div>
      {title && <h3 className="muted small" style={{ textTransform: "uppercase", letterSpacing: 1, margin: "4px 0 8px" }}>{title}</h3>}
      <div className="tablewrap">
        <table className="t">
          <thead>
            <tr>
              <th>#</th><th>Team</th><th className="num">GP</th><th className="num">W</th><th className="num">L</th><th className="num">OTL</th>
              <th className="num">PTS</th><th className="num">P%</th><th className="num">RW</th><th className="num">ROW</th><th className="num">GF</th>
              <th className="num">GA</th><th className="num">DIFF</th><th>Home</th><th>Away</th><th>L10</th><th>Strk</th><th className="num">OVR</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t, i) => {
              const r = t.rec;
              const l10 = r.last10.split("");
              const st = status[t.id];
              return (
                <tr key={t.id} className={`${t.id === league.userTid ? "me" : ""} ${cutAfter != null && i === cutAfter - 1 ? "cut" : ""}`}>
                  <td className="dim">{i + 1}</td>
                  <td>
                    <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                      <TeamBadge team={t} size={20} /> <TeamName tid={t.id} />
                      {st && <span className={`pill ${st === "x" ? "good" : "bad"}`} title={st === "x" ? "Clinched playoff spot" : "Eliminated"}>{st}</span>}
                    </span>
                  </td>
                  <td className="num">{r.gp}</td><td className="num">{r.w}</td><td className="num">{r.l}</td><td className="num">{r.otl}</td>
                  <td className="num"><b>{r.pts}</b></td>
                  <td className="num">{r.gp ? (r.pts / (2 * r.gp)).toFixed(3).replace(/^0/, "") : "-"}</td>
                  <td className="num">{r.rw}</td><td className="num">{r.row}</td><td className="num">{r.gf}</td><td className="num">{r.ga}</td>
                  <td className={`num ${r.gf - r.ga > 0 ? "good" : r.gf - r.ga < 0 ? "bad" : ""}`}>{r.gf - r.ga > 0 ? "+" : ""}{r.gf - r.ga}</td>
                  <td className="small">{r.home.w}-{r.home.l}-{r.home.otl}</td>
                  <td className="small">{r.away.w}-{r.away.l}-{r.away.otl}</td>
                  <td className="small">{l10.filter((x) => x === "W").length}-{l10.filter((x) => x === "L").length}-{l10.filter((x) => x === "O").length}</td>
                  <td className="small">{r.streak ? `${r.streak[0]}${r.streak[1]}` : "-"}</td>
                  <td className="num">{teamRatings(league, t).ovr}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function StandingsPage() {
  const { league } = useGame();
  const [view, setView] = useState("wild");
  return (
    <div className="stack">
      <div className="pagehead">
        <h2>Standings</h2>
        <div className="tabs" style={{ margin: 0 }}>
          {[["wild", "Wild Card"], ["div", "Division"], ["conf", "Conference"], ["league", "League"]].map(([k, l]) => (
            <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{l}</button>
          ))}
        </div>
      </div>
      {view === "div" && Object.entries(DIVISIONS).flatMap(([conf, divs]) => divs.map((d) => <StandTable key={d} title={`${d} Division`} teams={divisionTable(league, d)} cutAfter={3} />))}
      {view === "conf" && ["East", "West"].map((c) => <StandTable key={c} title={`${c}ern Conference`} teams={conferenceTable(league, c)} cutAfter={8} />)}
      {view === "league" && <StandTable teams={leagueTable(league)} />}
      {view === "wild" &&
        ["East", "West"].map((c) => {
          const pic = playoffPicture(league, c);
          return (
            <div key={c} className="stack">
              <h2 style={{ margin: "6px 0 0", fontSize: 17 }}>{c}ern Conference</h2>
              {pic.order.map((d) => <StandTable key={d} title={`${d} — top 3`} teams={pic.divs[d]} />)}
              <StandTable title="Wild Card" teams={[...pic.wildcards, ...pic.out]} cutAfter={2} />
            </div>
          );
        })}
      <div className="muted small">Tiebreakers: points, points %, regulation wins, regulation + OT wins, wins, goal differential. x = clinched, e = eliminated.</div>
    </div>
  );
}
