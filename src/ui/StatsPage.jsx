import React, { useMemo, useState } from "react";
import { useGame, Table, PlayerName, TeamBadge, Ovr, pct, signed, POS_ORDER } from "./common.jsx";
import { isGoalie, isDefense } from "../engine/constants.js";
import { savePct, gaa } from "../engine/players.js";

const toi = (s) => (s.gp ? `${Math.floor(s.toi / s.gp / 60)}:${String(Math.round((s.toi / s.gp) % 60)).padStart(2, "0")}` : "-");

export default function StatsPage() {
  const { league } = useGame();
  const [kind, setKind] = useState("sk");
  const [season, setSeason] = useState(league.phase === "playoffs" ? "po" : "rs");
  const [team, setTeam] = useState("all");
  const [pos, setPos] = useState("all");
  const [rookies, setRookies] = useState(false);
  const key = season === "po" ? "pstats" : "stats";

  const players = useMemo(
    () =>
      Object.values(league.players).filter((p) => {
        if (p.tid < 0 || p[key].gp === 0) return false;
        if (team !== "all" && p.tid !== Number(team)) return false;
        if (rookies && !p.rookie) return false;
        return true;
      }),
    [league, key, team, rookies, league.day, league.phase] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const skaters = players.filter((p) => !isGoalie(p.pos) && (pos === "all" || (pos === "F" ? !isDefense(p.pos) : isDefense(p.pos))));
  const goalies = players.filter((p) => isGoalie(p.pos));
  const S = (p) => p[key];
  const teamCol = { key: "tm", label: "Team", render: (p) => <TeamBadge team={league.teams[p.tid]} size={20} />, sort: (p) => league.teams[p.tid].abbr };

  const skCols = [
    { key: "rk", label: "#", render: (_, i) => <span className="dim">{i + 1}</span> },
    { key: "name", label: "Player", render: (p) => <PlayerName p={p} />, sort: (p) => p.name },
    teamCol,
    { key: "pos", label: "Pos", sort: (p) => POS_ORDER[p.pos] },
    { key: "ovr", label: "OVR", render: (p) => <Ovr v={p.ovr} />, sort: (p) => p.ovr },
    { key: "gp", label: "GP", num: true, render: (p) => S(p).gp, sort: (p) => S(p).gp },
    { key: "g", label: "G", num: true, render: (p) => S(p).g, sort: (p) => S(p).g },
    { key: "a", label: "A", num: true, render: (p) => S(p).a, sort: (p) => S(p).a },
    { key: "pts", label: "P", num: true, render: (p) => <b>{S(p).pts}</b>, sort: (p) => S(p).pts * 1000 + S(p).g },
    { key: "pm", label: "+/-", num: true, render: (p) => signed(S(p).pm), sort: (p) => S(p).pm },
    { key: "pim", label: "PIM", num: true, render: (p) => S(p).pim, sort: (p) => S(p).pim },
    { key: "ppg", label: "PPG", num: true, render: (p) => S(p).ppg, sort: (p) => S(p).ppg },
    { key: "ppp", label: "PPP", num: true, render: (p) => S(p).ppp, sort: (p) => S(p).ppp },
    { key: "shg", label: "SHG", num: true, render: (p) => S(p).shg, sort: (p) => S(p).shg },
    { key: "gwg", label: "GWG", num: true, render: (p) => S(p).gwg, sort: (p) => S(p).gwg },
    { key: "sog", label: "SOG", num: true, render: (p) => S(p).sog, sort: (p) => S(p).sog },
    { key: "shp", label: "S%", num: true, render: (p) => (S(p).sog ? ((S(p).g / S(p).sog) * 100).toFixed(1) : "-"), sort: (p) => (S(p).sog >= 20 ? S(p).g / S(p).sog : 0) },
    { key: "hit", label: "HIT", num: true, render: (p) => S(p).hit, sort: (p) => S(p).hit },
    { key: "blk", label: "BLK", num: true, render: (p) => S(p).blk, sort: (p) => S(p).blk },
    { key: "fo", label: "FO%", num: true, render: (p) => (S(p).fow + S(p).fol >= 20 ? ((S(p).fow / (S(p).fow + S(p).fol)) * 100).toFixed(1) : "-"), sort: (p) => (S(p).fow + S(p).fol >= 100 ? S(p).fow / (S(p).fow + S(p).fol) : 0) },
    { key: "toi", label: "TOI/GP", num: true, render: (p) => toi(S(p)), sort: (p) => (S(p).gp ? S(p).toi / S(p).gp : 0) },
  ];
  const minGp = season === "po" ? 1 : Math.max(1, Math.floor((league.teams[0].rec.gp || 0) * 0.25));
  const gCols = [
    { key: "rk", label: "#", render: (_, i) => <span className="dim">{i + 1}</span> },
    { key: "name", label: "Goalie", render: (p) => <PlayerName p={p} />, sort: (p) => p.name },
    teamCol,
    { key: "ovr", label: "OVR", render: (p) => <Ovr v={p.ovr} />, sort: (p) => p.ovr },
    { key: "gp", label: "GP", num: true, render: (p) => S(p).gp, sort: (p) => S(p).gp },
    { key: "gs", label: "GS", num: true, render: (p) => S(p).gs, sort: (p) => S(p).gs },
    { key: "w", label: "W", num: true, render: (p) => S(p).w, sort: (p) => S(p).w },
    { key: "l", label: "L", num: true, render: (p) => S(p).l, sort: (p) => S(p).l },
    { key: "otl", label: "OTL", num: true, render: (p) => S(p).otl, sort: (p) => S(p).otl },
    { key: "sa", label: "SA", num: true, render: (p) => S(p).sa, sort: (p) => S(p).sa },
    { key: "ga", label: "GA", num: true, render: (p) => S(p).ga, sort: (p) => S(p).ga },
    { key: "sv", label: "SV%", num: true, render: (p) => pct(savePct(S(p))), sort: (p) => (S(p).gp >= minGp ? savePct(S(p)) : 0) },
    { key: "gaa", label: "GAA", num: true, render: (p) => gaa(S(p)).toFixed(2), sort: (p) => (S(p).gp >= minGp ? -gaa(S(p)) : -99) },
    { key: "so", label: "SO", num: true, render: (p) => S(p).so, sort: (p) => S(p).so },
  ];

  return (
    <div className="stack">
      <div className="pagehead">
        <h2>Stats</h2>
        <div className="tabs" style={{ margin: 0 }}>
          <button className={kind === "sk" ? "on" : ""} onClick={() => setKind("sk")}>Skaters</button>
          <button className={kind === "g" ? "on" : ""} onClick={() => setKind("g")}>Goalies</button>
        </div>
        <select value={season} onChange={(e) => setSeason(e.target.value)}>
          <option value="rs">Regular season</option>
          <option value="po">Playoffs</option>
        </select>
        <select value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="all">All teams</option>
          {league.teams.map((t) => <option key={t.id} value={t.id}>{t.city} {t.name}</option>)}
        </select>
        {kind === "sk" && (
          <select value={pos} onChange={(e) => setPos(e.target.value)}>
            <option value="all">All skaters</option>
            <option value="F">Forwards</option>
            <option value="D">Defense</option>
          </select>
        )}
        <label className="row small"><input type="checkbox" checked={rookies} onChange={(e) => setRookies(e.target.checked)} /> Rookies</label>
      </div>
      {kind === "sk" ? (
        <Table columns={skCols} rows={skaters} initialSort={{ key: "pts", dir: "desc" }} limit={150} rowClass={(p) => (p.tid === league.userTid ? "me" : "")} empty="No games played yet." dense />
      ) : (
        <Table columns={gCols} rows={goalies} initialSort={{ key: "w", dir: "desc" }} limit={100} rowClass={(p) => (p.tid === league.userTid ? "me" : "")} empty="No games played yet." dense />
      )}
      {kind === "g" && <div className="muted small">SV% and GAA rankings require {minGp}+ games played.</div>}
    </div>
  );
}
