import React, { useState } from "react";
import { useGame, Table, TeamBadge, TeamName, PlayerName, recordStr, money } from "./common.jsx";
import { teamRatings } from "../engine/lines.js";
import { payroll, capSpace } from "../engine/roster.js";
import { AWARD_NAMES } from "../engine/awards.js";
import { leagueTable } from "../engine/standings.js";

export default function LeaguePage() {
  const { league, openTeam } = useGame();
  const [view, setView] = useState("teams");
  const awardsNow = league.awards;
  return (
    <div className="stack">
      <div className="pagehead">
        <h2>League</h2>
        <div className="tabs" style={{ margin: 0 }}>
          {[["teams", "Teams"], ["awards", "Awards & History"], ["tx", "Transactions"], ["retired", "Retired"]].map(([k, l]) => (
            <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{l}</button>
          ))}
        </div>
      </div>

      {view === "teams" && (
        <Table
          columns={[
            { key: "t", label: "Team", render: (t) => <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}><TeamBadge team={t} size={22} /><TeamName tid={t.id} /></span>, sort: (t) => t.city },
            { key: "div", label: "Division", sort: (t) => t.div },
            { key: "rec", label: "Record", render: (t) => recordStr(t.rec), sort: (t) => t.rec.pts },
            { key: "pts", label: "PTS", num: true, render: (t) => t.rec.pts, sort: (t) => t.rec.pts },
            { key: "ovr", label: "OVR", num: true, render: (t) => teamRatings(league, t).ovr, sort: (t) => teamRatings(league, t).ovr },
            { key: "f", label: "F", num: true, render: (t) => teamRatings(league, t).fwd, sort: (t) => teamRatings(league, t).fwd },
            { key: "d", label: "D", num: true, render: (t) => teamRatings(league, t).def, sort: (t) => teamRatings(league, t).def },
            { key: "g", label: "G", num: true, render: (t) => teamRatings(league, t).g, sort: (t) => teamRatings(league, t).g },
            { key: "pay", label: "Payroll", num: true, render: (t) => money(payroll(league, t)), sort: (t) => payroll(league, t) },
            { key: "space", label: "Cap Space", num: true, render: (t) => money(capSpace(league, t)), sort: (t) => capSpace(league, t) },
            { key: "go", label: "", render: (t) => <button className="tiny" onClick={() => openTeam(t.id)}>Roster</button> },
          ]}
          rows={leagueTable(league)}
          initialSort={{ key: "ovr", dir: "desc" }}
          rowClass={(t) => (t.id === league.userTid ? "me" : "")}
        />
      )}

      {view === "awards" && (
        <div className="stack">
          {awardsNow && (
            <div className="panel">
              <h3>{league.year}-{String(league.year + 1).slice(2)} Awards</h3>
              <div className="list">
                {Object.entries(awardsNow).map(([k, a]) => a && (
                  <div className="item" key={k}>
                    <span className="muted small" style={{ width: 250 }}>{AWARD_NAMES[k]}</span>
                    <TeamBadge team={league.teams[a.tid]} size={20} />
                    {league.players[a.pid] ? <PlayerName p={league.players[a.pid]} /> : <b>{a.name}</b>}
                    <span className="muted small" style={{ marginLeft: "auto" }}>{a.why}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <Table
            columns={[
              { key: "y", label: "Season", render: (h) => `${h.year}-${String(h.year + 1).slice(2)}` },
              { key: "c", label: "Stanley Cup", render: (h) => <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}><TeamBadge team={league.teams[h.champion]} size={20} /><TeamName tid={h.champion} /></span> },
              { key: "r", label: "Runner-up", render: (h) => <TeamName tid={h.runnerUp} short /> },
              { key: "p", label: "Presidents' Trophy", render: (h) => <TeamName tid={h.presidents} short /> },
              { key: "hart", label: "Hart", render: (h) => h.awards.hart?.name || "—" },
              { key: "vez", label: "Vezina", render: (h) => h.awards.vezina?.name || "—" },
              { key: "nor", label: "Norris", render: (h) => h.awards.norris?.name || "—" },
              { key: "cs", label: "Conn Smythe", render: (h) => h.awards.connSmythe?.name || "—" },
              { key: "me", label: "Your season", render: (h) => (h.userRec ? `${recordStr(h.userRec)}${h.userRec.playoff ? " · " + h.userRec.playoff : " · missed playoffs"}` : "—") },
            ]}
            rows={league.history}
            empty="No completed seasons yet."
          />
        </div>
      )}

      {view === "tx" && (
        <div className="panel">
          <div className="list">
            {league.transactions.slice(0, 250).map((t, i) => (
              <div className={`item small ${t.tids?.includes(league.userTid) ? "" : "muted"}`} key={i}>
                <span className="dim" style={{ width: 46 }}>{t.year}</span>
                {t.text}
              </div>
            ))}
            {!league.transactions.length && <div className="dim small">Nothing yet.</div>}
          </div>
        </div>
      )}

      {view === "retired" && (
        <Table
          columns={[
            { key: "name", label: "Player", sort: (r) => r.name },
            { key: "pos", label: "Pos" },
            { key: "year", label: "Retired", num: true, sort: (r) => r.year },
            { key: "age", label: "Age", num: true },
            { key: "gp", label: "GP", num: true, sort: (r) => r.gp },
            { key: "g", label: "G", num: true, render: (r) => (r.pos === "G" ? "—" : r.g), sort: (r) => r.g },
            { key: "pts", label: "PTS", num: true, render: (r) => (r.pos === "G" ? "—" : r.g + r.a), sort: (r) => r.g + r.a },
            { key: "w", label: "W", num: true, render: (r) => (r.pos === "G" ? r.w : "—"), sort: (r) => r.w },
            { key: "peak", label: "Peak OVR", num: true, sort: (r) => r.peak },
          ]}
          rows={league.retired}
          initialSort={{ key: "year", dir: "desc" }}
          empty="No notable retirements yet."
        />
      )}
    </div>
  );
}
