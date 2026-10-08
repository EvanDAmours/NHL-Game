import React, { useEffect, useMemo, useRef, useState } from "react";
import { useGame, TeamBadge, PlayerName } from "./common.jsx";
import { createGame, stepGame, simToEnd, applyResult, periodLabel, clockLabel } from "../engine/sim.js";
import { playScheduledGame, finishDay } from "../engine/league.js";
import { recordSeriesGame, simPlayoffDay, ROUND_NAMES } from "../engine/playoffs.js";

const SPEEDS = [["Slow", 1100], ["Normal", 550], ["Fast", 200], ["Turbo", 50]];

function colorDist(a, b) {
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

function Rink({ s, home, away, flash }) {
  const homeRight = s.period % 2 === 1;
  const attackRight = (k) => (k === "h" ? homeRight : !homeRight);
  const puck = s.puck || { x: 100, y: 42.5 };
  const poss = s.poss || "h";
  const def = poss === "h" ? "a" : "h";
  const clampX = (x) => Math.max(8, Math.min(192, x));
  const clampY = (y) => Math.max(6, Math.min(79, y));
  const dirA = attackRight(poss) ? 1 : -1;
  const att = [[0, 0], [9, -13], [9, 13], [-20, -18], [-20, 18], [4, 0]];
  const dfn = [[7, 0], [13, -12], [13, 12], [22, -7], [22, 7], [16, 0]];
  const n = (k) => Math.min(6, (k === "h" ? 5 : 5) - Math.min(2, s.pen[k].filter((p) => !p.offset).length) + (s[k].pulled ? 1 : 0));
  const dots = [];
  // Similar primary colors (e.g. two red teams): the road team switches to its alternate.
  const clash = colorDist(home.colors[0], away.colors[0]) < 140;
  const color = { h: home.colors[0], a: clash ? away.colors[1] : away.colors[0] };
  const ring = { h: home.colors[1], a: clash ? away.colors[0] : away.colors[1] };
  for (let i = 0; i < n(poss); i++) {
    const [dx, dy] = att[i];
    dots.push({ k: poss, x: clampX(puck.x + dx * dirA), y: clampY(puck.y + dy) });
  }
  for (let i = 0; i < n(def); i++) {
    const [dx, dy] = dfn[i];
    dots.push({ k: def, x: clampX(puck.x + dx * dirA), y: clampY(puck.y * 0.6 + 42.5 * 0.4 + dy) });
  }
  const goalieX = (k) => (attackRight(k) ? 14 : 186);
  return (
    <div className="rinkwrap">
      <svg viewBox="-4 -4 208 93">
        <rect x="0" y="0" width="200" height="85" rx="28" fill="#eef5fd" stroke="#2a3a5a" strokeWidth="1.6" />
        <text x="100" y="47" textAnchor="middle" fontSize="11" fontWeight="900" fill={home.colors[0]} opacity="0.18">{home.abbr}</text>
        <line x1="11" y1="2" x2="11" y2="83" stroke="#d33" strokeWidth="0.35" />
        <line x1="189" y1="2" x2="189" y2="83" stroke="#d33" strokeWidth="0.35" />
        <line x1="75" y1="0" x2="75" y2="85" stroke="#2b5cd6" strokeWidth="1.2" />
        <line x1="125" y1="0" x2="125" y2="85" stroke="#2b5cd6" strokeWidth="1.2" />
        <line x1="100" y1="0" x2="100" y2="85" stroke="#d33" strokeWidth="1" strokeDasharray="2 1" />
        <circle cx="100" cy="42.5" r="15" fill="none" stroke="#2b5cd6" strokeWidth="0.4" />
        <circle cx="100" cy="42.5" r="0.8" fill="#2b5cd6" />
        {[[31, 20.5], [31, 64.5], [169, 20.5], [169, 64.5]].map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r="15" fill="none" stroke="#d33" strokeWidth="0.4" />
            <circle cx={x} cy={y} r="1" fill="#d33" />
          </g>
        ))}
        {[[80, 20.5], [80, 64.5], [120, 20.5], [120, 64.5]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1" fill="#d33" />)}
        <path d="M11 36.5 A6 6 0 0 1 11 48.5 Z" fill="#9ccaf5" opacity="0.7" />
        <path d="M189 36.5 A6 6 0 0 0 189 48.5 Z" fill="#9ccaf5" opacity="0.7" />
        <rect x="7" y="39.5" width="4" height="6" fill="none" stroke="#c33" strokeWidth="0.6" />
        <rect x="189" y="39.5" width="4" height="6" fill="none" stroke="#c33" strokeWidth="0.6" />
        {["h", "a"].map((k) =>
          s[k].pulled ? null : <circle key={"g" + k} className="skater" cx={goalieX(k)} cy="42.5" r="2.6" fill={color[k]} stroke="#111" strokeWidth="0.7" />
        )}
        {dots.map((d, i) => (
          <circle key={i} className="skater" cx={d.x} cy={d.y} r="2.2" fill={color[d.k]} stroke={ring[d.k]} strokeWidth="0.7" />
        ))}
        <circle className="puck" cx={puck.x} cy={puck.y} r="1.1" fill="#111" />
        {flash && (
          <g className="goalflash">
            <rect x="0" y="0" width="200" height="85" rx="28" fill={flash.color} opacity="0.35" />
            <text x="100" y="50" textAnchor="middle" fontSize="16" fontWeight="900" fill="#fff" stroke="#000" strokeWidth="0.4">GOAL! {flash.abbr}</text>
          </g>
        )}
      </svg>
    </div>
  );
}

export default function LiveGame({ spec, onDone }) {
  const { league } = useGame();
  const home = league.teams[spec.home];
  const away = league.teams[spec.away];
  const stateRef = useRef(null);
  if (!stateRef.current) stateRef.current = createGame(league, home, away, { live: true, userTid: league.userTid, playoff: spec.kind === "playoff" });
  const s = stateRef.current;
  const [, force] = useState(0);
  const [speed, setSpeed] = useState(550);
  const [paused, setPaused] = useState(false);
  const [flash, setFlash] = useState(null);
  const [committed, setCommitted] = useState(false);
  const lastEvCount = useRef(0);
  const me = s.userSide;
  const mySide = me ? s[me] : null;

  useEffect(() => {
    if (paused || s.phase === "final") return;
    const t = setInterval(() => {
      stepGame(s);
      const fresh = s.events.slice(lastEvCount.current);
      lastEvCount.current = s.events.length;
      const g = fresh.find((e) => e.t === "goal");
      if (g) {
        const t2 = g.side === "h" ? home : away;
        setFlash({ color: t2.colors[0], abbr: t2.abbr, n: Date.now() });
        setTimeout(() => setFlash(null), 1300);
      }
      force((x) => x + 1);
    }, speed);
    return () => clearInterval(t);
  }, [paused, speed, s, home, away, s.phase]);

  const finish = () => {
    if (committed) return;
    setCommitted(true);
    if (s.phase !== "final") simToEnd(s);
    if (spec.kind === "regular") {
      const g = league.schedule.find((x) => x.id === spec.gid);
      playScheduledGame(league, g, s);
      finishDay(league);
    } else {
      const result = applyResult(league, s, { playoff: true });
      recordSeriesGame(league, spec.series, s, result);
      simPlayoffDay(league, { skipSeries: spec.series });
    }
    onDone();
  };

  const skipToEnd = () => {
    simToEnd(s);
    force((x) => x + 1);
  };

  const leaders = useMemo(() => {
    const out = { h: [], a: [] };
    for (const k of ["h", "a"]) {
      out[k] = s[k].dressed
        .map((id) => ({ id, b: s.box[id] }))
        .filter((x) => x.b && (x.b.g || x.b.a))
        .sort((x, y) => y.b.g * 2 + y.b.a - (x.b.g * 2 + x.b.a))
        .slice(0, 4);
    }
    return out;
  }, [s, s.events.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const ppSide = (k) => {
    const mine = s.pen[k].filter((p) => !p.offset).length;
    const theirs = s.pen[k === "h" ? "a" : "h"].filter((p) => !p.offset).length;
    return theirs > mine;
  };
  const gsaves = (k) => {
    const gid = s[k === "h" ? "a" : "h"].goalie;
    const b = s.gbox[gid];
    return b ? b.sa - b.ga : 0;
  };
  const feed = [...s.events].reverse().slice(0, 80);
  const title = spec.kind === "playoff" ? `${ROUND_NAMES[spec.series.round]} · Game ${spec.series.games.length + 1} (${league.teams[spec.series.top].abbr} ${spec.series.wTop}-${spec.series.wBot} ${league.teams[spec.series.bot].abbr})` : "Regular season";

  return (
    <div className="stack">
      <div className="pagehead">
        <h2>Live Game</h2>
        <span className="pill">{title}</span>
      </div>
      <div className="scorebug">
        <div className="side away">
          <TeamBadge team={away} size={40} />
          <div>
            <div className="tname" style={{ fontWeight: 800 }}><span className="full">{away.city} {away.name}</span><span className="short">{away.abbr}</span></div>
            <div className="small muted">SOG {s.shots.a} {ppSide("a") && <span className="pp">PP</span>} {s.a.pulled && <span className="pill">EN</span>}</div>
          </div>
          <div className="score" style={{ marginLeft: "auto" }}>{s.score.a}</div>
        </div>
        <div className="clock">
          <div className="t">{s.phase === "final" ? "FINAL" : s.phase === "so" ? "SO" : clockLabel(s.clock)}</div>
          <div className="p">{s.phase === "final" ? s.endedIn || "" : periodLabel(s)}</div>
        </div>
        <div className="side home">
          <div className="score" style={{ marginRight: "auto" }}>{s.score.h}</div>
          <div style={{ textAlign: "right" }}>
            <div className="tname" style={{ fontWeight: 800 }}><span className="full">{home.city} {home.name}</span><span className="short">{home.abbr}</span></div>
            <div className="small muted">{s.h.pulled && <span className="pill">EN</span>} {ppSide("h") && <span className="pp">PP</span>} SOG {s.shots.h}</div>
          </div>
          <TeamBadge team={home} size={40} />
        </div>
      </div>

      <div className="grid livegrid">
        <div className="stack">
          <Rink s={s} home={home} away={away} flash={flash} />
          <div className="panel">
            <div className="row" style={{ gap: 6 }}>
              {s.phase !== "final" ? (
                <>
                  <button onClick={() => setPaused((p) => !p)}>{paused ? "▶ Resume" : "⏸ Pause"}</button>
                  <button onClick={() => { stepGame(s); force((x) => x + 1); }} disabled={!paused}>Step</button>
                  {SPEEDS.map(([l, ms]) => (
                    <button key={l} className={speed === ms ? "primary small" : "small"} onClick={() => setSpeed(ms)}>{l}</button>
                  ))}
                  <div style={{ flex: 1 }} />
                  <button onClick={skipToEnd}>Sim to End ⏭</button>
                </>
              ) : (
                <>
                  <b>Final{s.endedIn ? ` (${s.endedIn})` : ""}: {away.abbr} {s.score.a} – {home.abbr} {s.score.h}</b>
                  <div style={{ flex: 1 }} />
                  <button className="primary" onClick={finish} disabled={committed}>Continue →</button>
                </>
              )}
            </div>
            {mySide && s.phase !== "final" && (
              <div className="row" style={{ marginTop: 10, gap: 6 }}>
                <span className="muted small">Tactics:</span>
                {[["attack", "Attack"], ["balanced", "Balanced"], ["defend", "Defend"]].map(([k, l]) => (
                  <button key={k} className={mySide.tactic === k ? "primary small" : "small"} onClick={() => { mySide.tactic = k; force((x) => x + 1); }}>{l}</button>
                ))}
                <button className={mySide.ride ? "primary small" : "small"} onClick={() => { mySide.ride = !mySide.ride; force((x) => x + 1); }} title="Give your top lines more ice time">Ride top lines</button>
                <button className="small" disabled={mySide.timeout} onClick={() => { mySide.timeout = true; mySide.boost = 6; force((x) => x + 1); }} title="One per game: a short burst of energy">Timeout{mySide.timeout ? " (used)" : ""}</button>
                <button
                  className={mySide.pulled ? "danger small" : "small"}
                  disabled={s.phase === "so"}
                  onClick={() => { mySide.autoPull = false; mySide.pulled = !mySide.pulled; force((x) => x + 1); }}
                >
                  {mySide.pulled ? "Put goalie back" : "Pull goalie"}
                </button>
                <label className="row small"><input type="checkbox" checked={mySide.autoPull} onChange={(e) => { mySide.autoPull = e.target.checked; force((x) => x + 1); }} /> auto-pull</label>
              </div>
            )}
          </div>
          <div className="grid g2">
            {["a", "h"].map((k) => (
              <div className="panel" key={k}>
                <h3>{(k === "h" ? home : away).abbr} game leaders <span className="right muted small">{gsaves(k === "h" ? "a" : "h")} saves</span></h3>
                <div className="list">
                  {leaders[k].map(({ id, b }) => (
                    <div className="item small" key={id}>
                      <PlayerName p={league.players[id]} />
                      <span className="muted" style={{ marginLeft: "auto" }}>{b.g}G {b.a}A · {b.sog} SOG</span>
                    </div>
                  ))}
                  {!leaders[k].length && <div className="dim small">No points yet.</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <h3>Play-by-play</h3>
          <div className="feed">
            {feed.map((e, i) => (
              <div key={s.events.length - i} className={`ev ${e.t}`}>
                <span className="when">{e.phase === "so" ? "SO" : `${e.period > 3 ? (s.playoff ? `${e.period - 3}OT` : "OT") : ["1st", "2nd", "3rd"][e.period - 1]} ${clockLabel(e.clock)}`}</span>
                {e.text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
