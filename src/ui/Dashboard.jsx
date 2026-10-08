import React from "react";
import { useGame, TeamBadge, PlayerName, TeamName, recordStr, money, Ovr, pct, signed } from "./common.jsx";
import { divisionTable } from "../engine/standings.js";
import { teamRatings } from "../engine/lines.js";
import { capSpace, payroll, rosterIssues } from "../engine/roster.js";
import { capForYear, isGoalie } from "../engine/constants.js";
import { dayToDate } from "../engine/schedule.js";
import { savePct } from "../engine/players.js";
import { userGameOnDay, seasonOver } from "../engine/league.js";
import { userSeries } from "../engine/playoffs.js";

export default function Dashboard({ act }) {
  const { league, go, openBox } = useGame();
  const user = league.teams[league.userTid];
  const tr = teamRatings(league, user);
  const div = divisionTable(league, user.div);
  const roster = user.roster.map((id) => league.players[id]).filter(Boolean);
  const skaters = roster.filter((p) => !isGoalie(p.pos));
  const goalies = roster.filter((p) => isGoalie(p.pos));
  const leaders = [
    ["Points", [...skaters].sort((a, b) => b.stats.pts - a.stats.pts)[0], (p) => `${p.stats.pts} PTS`],
    ["Goals", [...skaters].sort((a, b) => b.stats.g - a.stats.g)[0], (p) => `${p.stats.g} G`],
    ["Assists", [...skaters].sort((a, b) => b.stats.a - a.stats.a)[0], (p) => `${p.stats.a} A`],
    ["Plus/Minus", [...skaters].sort((a, b) => b.stats.pm - a.stats.pm)[0], (p) => signed(p.stats.pm)],
    ["Goalie", [...goalies].sort((a, b) => b.stats.gp - a.stats.gp)[0], (p) => `${p.stats.w}-${p.stats.l}-${p.stats.otl}, ${pct(savePct(p.stats))}`],
  ];
  const myGames = league.schedule.filter((g) => g.h === user.id || g.a === user.id);
  const recent = myGames.filter((g) => g.played).slice(-5).reverse();
  const upcoming = myGames.filter((g) => !g.played).slice(0, 5);
  const today = userGameOnDay(league);
  const issues = rosterIssues(league, user);
  const inbox = league.inbox.slice(-8).reverse();
  const tx = league.transactions.slice(0, 8);
  const series = league.phase === "playoffs" ? userSeries(league) : null;

  const allSk = Object.values(league.players).filter((p) => p.tid >= 0 && !isGoalie(p.pos) && p.stats.gp > 0);
  const lgLeaders = [...allSk].sort((a, b) => b.stats.pts - a.stats.pts || b.stats.g - a.stats.g).slice(0, 5);

  const res = (g) => {
    const home = g.h === user.id;
    const us = home ? g.hs : g.as;
    const them = home ? g.as : g.hs;
    const w = us > them;
    return <span className={w ? "good" : g.ot ? "warn" : "bad"}>{w ? "W" : g.ot ? "OTL" : "L"} {us}-{them}{g.ot ? ` ${g.ot}` : ""}</span>;
  };

  return (
    <div className="stack">
      <div className="pagehead">
        <TeamBadge team={user} size={48} />
        <div>
          <h2>{user.city} {user.name}</h2>
          <div className="sub">{user.conf}ern Conference · {user.div} Division · Team OVR {tr.ovr}</div>
        </div>
      </div>

      {issues.length > 0 && (
        <div className="notice warn">
          {issues.map((i) => <div key={i}>⚠️ {i}</div>)}
          <div style={{ marginTop: 6 }}><button className="small" onClick={() => go("roster")}>Go to roster</button></div>
        </div>
      )}

      {league.phase === "preseason" && (
        <div className="notice">
          Preseason {league.year}-{String(league.year + 1).slice(2)}: review your <a href="#" onClick={(e) => { e.preventDefault(); go("lines"); }}>lines</a>, make trades or sign free agents, then press <b>Start Season</b>.
        </div>
      )}
      {league.phase === "regular" && seasonOver(league) && <div className="notice">The regular season is complete. Press <b>Start Playoffs</b>.</div>}
      {league.phase === "playoffs" && league.playoffs.champion != null && (
        <div className="notice">🏆 The {league.teams[league.playoffs.champion].city} {league.teams[league.playoffs.champion].name} are Stanley Cup champions!</div>
      )}
      {(league.phase === "draft" || league.phase === "resign" || league.phase === "freeagency") && (
        <div className="notice">
          Off-season: {league.phase === "draft" ? "the Entry Draft is underway." : league.phase === "resign" ? "decide which expiring contracts to re-sign." : "free agency is open."}{" "}
          <a href="#" onClick={(e) => { e.preventDefault(); go(league.phase === "draft" ? "draft" : "freeagency"); }}>Open →</a>
        </div>
      )}

      <div className="grid g4">
        <div className="panel stat"><span className="l">Record</span><span className="v">{recordStr(user.rec)}</span><span className="muted small">{user.rec.pts} points · {user.rec.gp} GP</span></div>
        <div className="panel stat"><span className="l">Goal Diff</span><span className={`v ${user.rec.gf - user.rec.ga >= 0 ? "good" : "bad"}`}>{signed(user.rec.gf - user.rec.ga)}</span><span className="muted small">{user.rec.gf} GF · {user.rec.ga} GA</span></div>
        <div className="panel stat"><span className="l">Team Ratings</span><span className="v">{tr.ovr}</span><span className="muted small">F {tr.fwd} · D {tr.def} · G {tr.g}</span></div>
        <div className="panel stat"><span className="l">Cap Space</span><span className={`v ${capSpace(league, user) < 0 ? "bad" : ""}`}>{money(capSpace(league, user))}</span><span className="muted small">{money(payroll(league, user))} of {money(capForYear(league.year))}</span></div>
      </div>

      <div className="grid g3">
        <div className="panel">
          <h3>{league.phase === "playoffs" ? "Playoff Series" : "Next Game"}</h3>
          {league.phase === "regular" && today && (
            <div className="stack" style={{ gap: 10 }}>
              <div className="row">
                <TeamBadge team={league.teams[today.a]} size={36} />
                <b>@</b>
                <TeamBadge team={league.teams[today.h]} size={36} />
                <div className="muted small">{dayToDate(league.year, today.day)} · {today.h === user.id ? "Home" : "Away"}</div>
              </div>
              <div className="row">
                <button className="primary" onClick={act.playLive}>▶ Play Live</button>
                <button onClick={act.simDay}>Sim Game</button>
              </div>
            </div>
          )}
          {league.phase === "regular" && !today && upcoming[0] && (
            <div className="muted">No game today. Next: {upcoming[0].h === user.id ? "vs" : "@"} <TeamName tid={upcoming[0].h === user.id ? upcoming[0].a : upcoming[0].h} /> on {dayToDate(league.year, upcoming[0].day)}.</div>
          )}
          {league.phase === "preseason" && upcoming[0] && (
            <div className="muted">Opening night: {upcoming[0].h === user.id ? "vs" : "@"} <TeamName tid={upcoming[0].h === user.id ? upcoming[0].a : upcoming[0].h} /> on {dayToDate(league.year, upcoming[0].day)}.</div>
          )}
          {league.phase === "playoffs" && series && (
            <div className="stack" style={{ gap: 10 }}>
              <div className="row">
                <TeamBadge team={league.teams[series.top]} size={32} /> <b>{series.wTop}</b> – <b>{series.wBot}</b> <TeamBadge team={league.teams[series.bot]} size={32} />
              </div>
              <div className="row"><button className="primary" onClick={act.playPlayoffLive}>▶ Play Next Game Live</button><button onClick={act.simPlayoffDay}>Sim Day</button></div>
            </div>
          )}
          {league.phase === "playoffs" && !series && <div className="muted">{user.playoffResult ? `Season over: ${user.playoffResult}.` : "Missed the playoffs."}</div>}
          {recent.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="muted small" style={{ marginBottom: 4 }}>Recent results</div>
              <div className="list">
                {recent.map((g) => (
                  <div className="item" key={g.id}>
                    <span className="small dim" style={{ width: 52 }}>{dayToDate(league.year, g.day)}</span>
                    <span>{g.h === user.id ? "vs" : "@"} <TeamName tid={g.h === user.id ? g.a : g.h} short /></span>
                    <span style={{ marginLeft: "auto" }} className="link" onClick={() => openBox(g)}>{res(g)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="panel">
          <h3>{user.div} Division <span className="right"><a href="#" className="small" onClick={(e) => { e.preventDefault(); go("standings"); }}>All →</a></span></h3>
          <div className="list">
            {div.map((t, i) => (
              <div className="item" key={t.id} style={t.id === user.id ? { fontWeight: 800 } : undefined}>
                <span className="dim" style={{ width: 14 }}>{i + 1}</span>
                <TeamBadge team={t} size={22} />
                <TeamName tid={t.id} short />
                <span className="muted small">{recordStr(t.rec)}</span>
                <span style={{ marginLeft: "auto" }} className="mono">{t.rec.pts}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <h3>Team Leaders</h3>
          <div className="list">
            {leaders.map(([lab, p, f]) => (
              <div className="item" key={lab}>
                <span className="muted small" style={{ width: 74 }}>{lab}</span>
                {p ? <><PlayerName p={p} /><span style={{ marginLeft: "auto" }} className="mono small">{f(p)}</span></> : <span className="dim">—</span>}
              </div>
            ))}
          </div>
          <div className="muted small" style={{ margin: "12px 0 4px" }}>League scoring leaders</div>
          <div className="list">
            {lgLeaders.map((p) => (
              <div className="item" key={p.id}>
                <TeamBadge team={league.teams[p.tid]} size={18} />
                <PlayerName p={p} />
                <span style={{ marginLeft: "auto" }} className="mono small">{p.stats.g}-{p.stats.a}-{p.stats.pts}</span>
              </div>
            ))}
            {!lgLeaders.length && <div className="dim small">No games played yet.</div>}
          </div>
        </div>
      </div>

      <div className="grid g2">
        <div className="panel">
          <h3>Inbox</h3>
          <div className="list">
            {inbox.map((m, i) => <div className="item small" key={i}>{m.text}</div>)}
            {!inbox.length && <div className="dim small">Nothing new.</div>}
          </div>
        </div>
        <div className="panel">
          <h3>League Transactions</h3>
          <div className="list">
            {tx.map((t, i) => <div className={`item small ${t.tids?.includes(user.id) ? "" : "muted"}`} key={i}>{t.text}</div>)}
            {!tx.length && <div className="dim small">No transactions yet.</div>}
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>Top of the Roster</h3>
        <div className="row" style={{ gap: 14 }}>
          {[...roster].sort((a, b) => b.ovr - a.ovr).slice(0, 8).map((p) => (
            <div key={p.id} className="row" style={{ gap: 6 }}>
              <Ovr v={p.ovr} src={p.src} />
              <PlayerName p={p} />
              <span className="dim small">{p.pos}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

