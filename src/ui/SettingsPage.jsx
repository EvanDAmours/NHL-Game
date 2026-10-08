import React, { useState } from "react";
import { useGame, Ovr } from "./common.jsx";
import { DIFFICULTY } from "../engine/constants.js";
import { saveLeague, serializeLeague, deserializeLeague, deleteSave } from "../engine/league.js";
import { parseRatingsCsv, matchRows, applyRatings, exportRosterFile } from "../engine/importer.js";

function download(name, text, type = "application/octet-stream") {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}

const SAMPLE = `name,team,pos,ovr
Connor McDavid,EDM,C,99
Nathan MacKinnon,COL,C,97`;

export default function SettingsPage() {
  const { league, commit, toast, newGame } = useGame();
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState(null);
  const [opts, setOpts] = useState({ markEA: true, moveTeams: false, addMissing: false });

  const doPreview = () => {
    const { rows, errors } = parseRatingsCsv(csv);
    const matches = matchRows(league, rows);
    setPreview({ matches, errors });
  };
  const doApply = () => {
    if (!preview) return;
    const r = applyRatings(league, preview.matches, opts);
    toast(`Ratings import: ${r.updated} updated, ${r.moved} moved, ${r.added} added, ${r.skipped} skipped.`, 5000);
    setPreview(null);
    setCsv("");
    commit();
  };
  const importSave = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    f.text().then((txt) => {
      const lg = deserializeLeague(txt.trim());
      if (!lg) return toast("That file isn't a Rink GM league export.");
      saveLeague(lg);
      window.location.reload();
    });
  };

  const eaCount = Object.values(league.players).filter((p) => p.src === "ea27" && p.tid >= 0).length;
  const estCount = Object.values(league.players).filter((p) => p.src === "est" && p.tid >= 0).length;

  return (
    <div className="stack">
      <div className="pagehead"><h2>Settings</h2></div>
      <div className="grid g2">
        <div className="panel stack">
          <h3>League</h3>
          <label className="row">Difficulty
            <select value={league.settings.difficulty} onChange={(e) => { league.settings.difficulty = e.target.value; commit(); }}>
              {Object.entries(DIFFICULTY).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
            </select>
          </label>
          <div className="row">
            <button onClick={() => toast(saveLeague(league) ? "League saved." : "Save failed — try exporting instead.")}>Save now</button>
            <button onClick={() => download(`rinkgm-${league.teams[league.userTid].abbr}-${league.year}.rinkgm`, serializeLeague(league))}>Export league file</button>
            <label className="row" style={{ cursor: "pointer" }}>
              <span className="pill">Import league file…</span>
              <input type="file" accept=".rinkgm,.json,.txt" onChange={importSave} style={{ display: "none" }} />
            </label>
          </div>
          <div className="row">
            <button onClick={newGame}>Back to title</button>
            <button className="danger" onClick={() => { if (window.confirm("Delete this league from the browser? Export it first if you want to keep it.")) { deleteSave(); window.location.reload(); } }}>Delete saved league</button>
          </div>
          <div className="muted small">Your league auto-saves in this browser after every action.</div>
        </div>
        <div className="panel stack">
          <h3>Ratings data</h3>
          <div>
            <span className="src ea">EA</span> {eaCount} players carry official EA SPORTS NHL 27 overalls. <span className="src est">EST</span> {estCount} are estimates.
          </div>
          <div className="muted small">
            Paste ratings from EA's NHL 27 ratings site (or any spreadsheet) below to replace estimates or apply EA's in-season roster updates. Attributes are re-scaled so each player's overall matches exactly.
          </div>
          <button onClick={() => download(`nhl27-rosters-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(exportRosterFile(league), null, 1), "application/json")}>
            Export rosters as JSON
          </button>
        </div>
      </div>

      <div className="panel stack">
        <h3>Ratings Import</h3>
        <div className="muted small">
          Accepted formats: a header row with <code>name</code> and <code>ovr</code> (optional <code>team</code>, <code>pos</code>, <code>type</code>, <code>age</code>, <code>cap</code>, <code>yrs</code>), or plain lines of <code>Name, OVR</code> / <code>Name, Team, Pos, OVR</code>. Comma, tab or semicolon separated.
        </div>
        <textarea rows={8} value={csv} placeholder={SAMPLE} onChange={(e) => { setCsv(e.target.value); setPreview(null); }} />
        <div className="row">
          <label className="row small"><input type="checkbox" checked={opts.markEA} onChange={(e) => setOpts({ ...opts, markEA: e.target.checked })} /> Mark as official EA ratings</label>
          <label className="row small"><input type="checkbox" checked={opts.moveTeams} onChange={(e) => setOpts({ ...opts, moveTeams: e.target.checked })} /> Move players to the listed team</label>
          <label className="row small"><input type="checkbox" checked={opts.addMissing} onChange={(e) => setOpts({ ...opts, addMissing: e.target.checked })} /> Add unknown players (needs team + pos)</label>
        </div>
        <div className="row">
          <button onClick={doPreview} disabled={!csv.trim()}>Preview</button>
          <button className="primary" onClick={doApply} disabled={!preview || !preview.matches.length}>Apply {preview ? `(${preview.matches.length})` : ""}</button>
        </div>
        {preview && (
          <div className="stack" style={{ gap: 6 }}>
            {preview.errors.slice(0, 5).map((e) => <div key={e} className="bad small">{e}</div>)}
            <div className="small muted">
              {preview.matches.filter((m) => m.player).length} matched · {preview.matches.filter((m) => !m.player).length} not found
            </div>
            <div className="tablewrap" style={{ maxHeight: 300, overflowY: "auto" }}>
              <table className="t">
                <thead><tr><th>Name</th><th>Match</th><th className="num">Current</th><th className="num">New</th></tr></thead>
                <tbody>
                  {preview.matches.slice(0, 300).map((m, i) => (
                    <tr key={i}>
                      <td>{m.row.name}{m.row.team ? ` (${m.row.team})` : ""}</td>
                      <td>{m.player ? `${m.player.name} · ${league.teams[m.player.tid]?.abbr || "FA"}` : <span className="warn">not found</span>}</td>
                      <td className="num">{m.player ? <Ovr v={m.player.ovr} src={m.player.src} /> : "-"}</td>
                      <td className="num"><Ovr v={m.row.ovr} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="panel small muted">
        Rink GM is a fan-made game and is not affiliated with or endorsed by the NHL, the NHLPA or Electronic Arts. Player overall ratings marked EA are taken from EA SPORTS NHL 27's published ratings; all other ratings, attributes and contracts are estimates for gameplay.
      </div>
    </div>
  );
}
