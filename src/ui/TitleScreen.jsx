import React, { useEffect, useMemo, useState } from "react";
import { TEAMS } from "../engine/teams.js";
import { TeamBadge } from "./common.jsx";
import { createLeague, loadLeague, deleteSave, rosterFile, deserializeLeague, restoreLeague } from "../engine/league.js";
import { DIFFICULTY } from "../engine/constants.js";
import { cloudMeta, cloudLoad } from "../platform.js";

const SEASON = (y) => `${y}-${String(y + 1).slice(2)}`;
const when = (t) => (t ? new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

function teamStrength(abbr) {
  const ps = (rosterFile.teams[abbr] || []).map((p) => p.ovr).sort((a, b) => b - a);
  const top = ps.slice(0, 18);
  const g = (rosterFile.teams[abbr] || []).filter((p) => p.pos === "G").map((p) => p.ovr).sort((a, b) => b - a)[0] || 75;
  return Math.round((top.reduce((a, b) => a + b, 0) / Math.max(1, top.length)) * 0.8 + g * 0.2);
}

export default function TitleScreen({ onStart, ask }) {
  const [local] = useState(() => loadLeague());
  const [cloud, setCloud] = useState(null);
  const [loadingCloud, setLoadingCloud] = useState(false);
  const [step, setStep] = useState(local ? "menu" : "new");
  useEffect(() => {
    let live = true;
    cloudMeta().then((m) => {
      if (!live || !m) return;
      setCloud(m);
      setStep((s) => (s === "new" && !local ? "menu" : s));
    });
    return () => { live = false; };
  }, [local]);
  const [abbr, setAbbr] = useState("TOR");
  const [mode, setMode] = useState("real");
  const [difficulty, setDifficulty] = useState("normal");
  const [err, setErr] = useState(null);
  const strengths = useMemo(() => Object.fromEntries(TEAMS.map((t) => [t.abbr, teamStrength(t.abbr)])), []);
  const ranked = useMemo(() => [...TEAMS].sort((a, b) => strengths[b.abbr] - strengths[a.abbr]).map((t) => t.abbr), [strengths]);
  const eaCount = useMemo(() => Object.values(rosterFile.teams).flat().filter((p) => p.src === "ea27").length, []);
  const total = useMemo(() => Object.values(rosterFile.teams).flat().length, []);

  const cont = () => {
    if (!local) {
      setErr("Couldn't read the saved league. It may be from an older version.");
      return;
    }
    onStart(local);
  };
  const contCloud = async () => {
    setLoadingCloud(true);
    const lg = restoreLeague(await cloudLoad().catch(() => null));
    setLoadingCloud(false);
    if (!lg) return setErr("Couldn't load the cloud backup. Try again in a moment.");
    onStart(lg);
  };
  const cloudNewer = cloud && (!local || (cloud.savedAt || 0) > (local.savedAt || 0) + 5000);

  const importFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    f.text().then((txt) => {
      try {
        const lg = deserializeLeague(txt.trim());
        if (!lg) throw new Error("bad file");
        onStart(lg);
      } catch {
        setErr("That file isn't a Rink GM league export.");
      }
    });
  };

  const start = async () => {
    if ((local || cloud) && !(await ask({ title: "Start a new league?", body: "Your current saved league will be replaced. Export it from Settings first if you want to keep it.", yes: "Start new league", danger: true }))) return;
    deleteSave();
    const lg = createLeague({ userAbbr: abbr, mode, difficulty });
    onStart(lg);
  };

  const sel = TEAMS.find((t) => t.abbr === abbr);

  return (
    <div className="title">
      <div className="titlecard stack">
        <div className="row between">
          <div>
            <div className="logo">RINK <span>GM</span></div>
            <div className="muted" style={{ marginTop: 6 }}>
              Hockey general manager · {rosterFile.season} rosters with <b>{rosterFile.game}</b> ratings
            </div>
          </div>
          {step === "new" && (local || cloud) && <button onClick={() => setStep("menu")}>← Back</button>}
        </div>

        {err && <div className="notice bad">{err}</div>}

        {step === "menu" && (
          <div className="panel stack" style={{ maxWidth: 520 }}>
            {local && (
              <button className={cloudNewer ? "" : "primary"} style={{ padding: 14, fontSize: 15 }} onClick={cont}>
                Continue League <span className="small" style={{ opacity: 0.8, fontWeight: 500 }}>· {local.teams[local.userTid].abbr} {SEASON(local.year)}</span>
              </button>
            )}
            {cloud && (cloudNewer || !local) && (
              <button className="primary" style={{ padding: 14, fontSize: 15 }} onClick={contCloud} disabled={loadingCloud}>
                {loadingCloud ? "Loading cloud backup…" : <>Continue from cloud backup <span className="small" style={{ opacity: 0.85, fontWeight: 500 }}>· {cloud.team} {SEASON(cloud.year)} · saved {when(cloud.savedAt)}</span></>}
              </button>
            )}
            <button onClick={() => setStep("new")}>New League</button>
            <label className="row" style={{ cursor: "pointer" }}>
              <span className="pill">Import league file…</span>
              <input type="file" accept=".rinkgm,.json,.txt" onChange={importFile} style={{ display: "none" }} />
            </label>
          </div>
        )}

        {step === "new" && (
          <>
            <div className="panel">
              <h3>Choose your team <span className="right muted small">sorted by roster strength</span></h3>
              <div className="teamgrid">
                {ranked.map((ab) => {
                  const t = TEAMS.find((x) => x.abbr === ab);
                  return (
                    <button key={ab} className={`teamcard ${abbr === ab ? "sel" : ""}`} onClick={() => setAbbr(ab)}>
                      <TeamBadge team={t} size={34} />
                      <div>
                        <div className="tn">{t.city} {t.name}</div>
                        <div className="tr">{t.div} · Team OVR {strengths[ab]}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid g3">
              <div className="panel">
                <h3>Players</h3>
                <div className="stack" style={{ gap: 8 }}>
                  <label className="row"><input type="radio" checked={mode === "real"} onChange={() => setMode("real")} /> NHL 27 rosters (real players)</label>
                  <label className="row"><input type="radio" checked={mode === "random"} onChange={() => setMode("random")} /> Random fictional players</label>
                  <div className="small muted">
                    {total} real players · {eaCount} with official EA SPORTS NHL 27 overalls (marked <span className="src ea">EA</span>), the rest are
                    estimates (<span className="src est">EST</span>) you can correct in Settings → Ratings Import.
                  </div>
                </div>
              </div>
              <div className="panel">
                <h3>Difficulty</h3>
                <div className="stack" style={{ gap: 8 }}>
                  {Object.entries(DIFFICULTY).map(([k, d]) => (
                    <label key={k} className="row"><input type="radio" checked={difficulty === k} onChange={() => setDifficulty(k)} /> {d.label}</label>
                  ))}
                  <div className="small muted">Harder settings make AI GMs tougher in trades and free agents pricier.</div>
                </div>
              </div>
              <div className="panel stack">
                <h3>Ready?</h3>
                <div className="row">
                  <TeamBadge team={sel} size={44} />
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 16 }}>{sel.city} {sel.name}</div>
                    <div className="muted small">{sel.conf}ern Conference · {sel.div}</div>
                  </div>
                </div>
                <button className="primary" style={{ padding: 12, fontSize: 15 }} onClick={start}>Start {rosterFile.season} Season</button>
              </div>
            </div>
            <div className="small dim">
              Fan-made game, not affiliated with or endorsed by the NHL, NHLPA or Electronic Arts. Team names are used for identification only; no logos are included.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
