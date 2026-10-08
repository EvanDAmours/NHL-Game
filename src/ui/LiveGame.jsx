import React, { useEffect, useMemo, useRef, useState } from "react";
import { useGame, TeamBadge, PlayerName } from "./common.jsx";
import { createGame, stepGame, simToEnd, applyResult, periodLabel, clockLabel } from "../engine/sim.js";
import { playScheduledGame, finishDay } from "../engine/league.js";
import { recordSeriesGame, simPlayoffDay, ROUND_NAMES } from "../engine/playoffs.js";

const SPEEDS = [["Slow", 2000], ["Normal", 1200], ["Fast", 450], ["Turbo", 70]];
const SPEED_KEY = "rinkgm_live_speed";
const STEP_SEC = 10;

function colorDist(a, b) {
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
const clampX = (x) => Math.max(9, Math.min(191, x));
const clampY = (y) => Math.max(6, Math.min(79, y));

// Skater roles: 0 C, 1 LW, 2 RW, 3 LD, 4 RD, 5 extra attacker. Each dot keeps its role,
// so players glide between spots instead of swapping places when the puck changes hands.
const O_ZONE = [[72, 42.5], [70, 20], [70, 65], [52, 24], [52, 61], [82, 50]];
const D_ZONE = [[70, 42.5], [58, 24], [58, 61], [80, 35], [80, 50], [80, 42.5]];

function skatersOn(s, k) {
  const base = s.phase === "ot" && !s.playoff ? 3 : 5;
  const boxed = Math.min(2, s.pen[k].filter((p) => !p.offset).length);
  return Math.max(3, base - boxed) + (s[k].pulled ? 1 : 0);
}
function rolesOn(n) {
  if (n >= 6) return [0, 1, 2, 3, 4, 5];
  if (n === 5) return [0, 1, 2, 3, 4];
  if (n === 4) return [0, 1, 3, 4];
  return [0, 3, 4];
}

// Where everyone should be right now, in rink coordinates (200 x 85).
function targetsFor(s, homeRight) {
  const dir = (k) => ((k === "h") === homeRight ? 1 : -1);
  const puck = s.puck || { x: 100, y: 42.5 };
  const P = s.poss || "h";
  const D = P === "h" ? "a" : "h";
  const dP = dir(P) * (puck.x - 100);
  const at = (depth, y) => ({ x: clampX(100 + dir(P) * depth), y: clampY(y) });
  const out = { h: [], a: [] };
  const inZone = dP > 45;
  // Attackers.
  const attHome = inZone
    ? O_ZONE.map(([d, y]) => [d, y])
    : [[dP, puck.y], [dP + 8, 18], [dP + 8, 67], [dP - 18, 30], [dP - 18, 55], [dP + 4, 42.5]];
  const onP = rolesOn(skatersOn(s, P));
  let carrier = onP[0];
  let best = Infinity;
  for (const r of onP) {
    const h = at(...attHome[r]);
    const dd = Math.hypot(h.x - puck.x, h.y - puck.y);
    if (dd < best) { best = dd; carrier = r; }
  }
  for (let r = 0; r < 6; r++) {
    const on = onP.includes(r);
    const p = r === carrier ? { x: clampX(puck.x - dir(P) * 1.6), y: clampY(puck.y + 1.2) } : at(...attHome[r]);
    out[P].push({ ...p, on });
  }
  // Defenders sit between the puck and their own net.
  const onD = rolesOn(skatersOn(s, D));
  const defHome = inZone
    ? D_ZONE.map(([d, y], r) => (r === 0 ? [Math.min(dP + 6, 84), puck.y * 0.7 + 42.5 * 0.3] : [d, y]))
    : [[dP + 8, puck.y], [dP + 14, 22], [dP + 14, 63], [dP + 30, 33], [dP + 30, 52], [dP + 22, 42.5]];
  for (let r = 0; r < 6; r++) {
    const [d, y] = defHome[r];
    out[D].push({ ...at(Math.min(d, 84), y), on: onD.includes(r) });
  }
  const goalie = (k) => {
    const x = 100 - dir(k) * 86;
    const near = dir(k) * (puck.x - 100) < -40;
    return { x, y: 42.5 + (near ? (puck.y - 42.5) * 0.18 : 0), on: !s[k].pulled };
  };
  return { puck, h: out.h, a: out.a, gh: goalie("h"), ga: goalie("a"), netX: (k) => 100 + dir(k) * 89 };
}

function Rink({ s, home, away, stepInfo, clockRef, banner }) {
  const clash = colorDist(home.colors[0], away.colors[0]) < 140;
  const color = { h: home.colors[0], a: clash ? away.colors[1] : away.colors[0] };
  const ring = { h: home.colors[1], a: clash ? away.colors[0] : away.colors[1] };
  const els = useRef({ h: [], a: [], gh: null, ga: null, puck: null });
  const pos = useRef(null);

  useEffect(() => {
    let raf;
    let last = performance.now();
    const set = (el, p) => {
      if (!el) return;
      el.setAttribute("transform", `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})`);
      el.style.opacity = p.on === false ? "0" : "1";
    };
    const frame = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const info = stepInfo.current;
      const frac = Math.min(1, (now - info.at) / Math.max(1, info.dur));
      const T = targetsFor(s, s.period % 2 === 1);
      // A shot: the puck goes to the shooter first, then to the net.
      let puckT = T.puck;
      if (info.shot && frac > 0.45) puckT = info.shot;
      if (!pos.current) {
        pos.current = { puck: { ...puckT }, h: T.h.map((p) => ({ ...p })), a: T.a.map((p) => ({ ...p })), gh: { ...T.gh }, ga: { ...T.ga } };
      }
      const P = pos.current;
      const tau = Math.max(0.05, Math.min(0.55, (info.dur / 1000) * 0.42));
      const kS = 1 - Math.exp(-dt / tau);
      const kP = 1 - Math.exp(-dt / (tau * 0.55));
      const ease = (p, t, k) => {
        p.x += (t.x - p.x) * k;
        p.y += (t.y - p.y) * k;
        p.on = t.on;
      };
      ease(P.puck, puckT, kP);
      for (const side of ["h", "a"]) T[side].forEach((t, i) => ease(P[side][i], t, kS));
      ease(P.gh, T.gh, kS);
      ease(P.ga, T.ga, kS);
      const E = els.current;
      for (const side of ["h", "a"]) P[side].forEach((p, i) => set(E[side][i], s.phase === "so" ? { ...p, on: false } : p));
      set(E.gh, P.gh);
      set(E.ga, P.ga);
      set(E.puck, P.puck);
      // Game clock ticks down smoothly between 10-second steps.
      if (clockRef.current) {
        let txt;
        if (s.phase === "final") txt = "FINAL";
        else if (s.phase === "so") txt = "SO";
        else if (info.periodEnd) txt = "0:00";
        else txt = clockLabel(Math.round(s.clock + STEP_SEC * (1 - (info.paused ? 1 : frac))));
        if (clockRef.current.textContent !== txt) clockRef.current.textContent = txt;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [s, stepInfo, clockRef]);

  const dot = (k, i) => (
    <g key={k + i} ref={(el) => (els.current[k][i] = el)} className="sk">
      <circle r="2.3" fill={color[k]} stroke={ring[k]} strokeWidth="0.7" />
    </g>
  );
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
        <g ref={(el) => (els.current.gh = el)} className="sk"><circle r="2.7" fill={color.h} stroke="#111" strokeWidth="0.7" /></g>
        <g ref={(el) => (els.current.ga = el)} className="sk"><circle r="2.7" fill={color.a} stroke="#111" strokeWidth="0.7" /></g>
        {[0, 1, 2, 3, 4, 5].map((i) => dot("a", i))}
        {[0, 1, 2, 3, 4, 5].map((i) => dot("h", i))}
        <g ref={(el) => (els.current.puck = el)}><circle r="1.15" fill="#111" /></g>
      </svg>
      {banner && (
        <div className={`rinkbanner ${banner.kind}`} style={{ "--bc": banner.color || "var(--accent2)" }} key={banner.n}>
          <div className="rb-k">{banner.title}</div>
          {banner.sub && <div className="rb-s">{banner.sub}</div>}
        </div>
      )}
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
  const [speed, setSpeedState] = useState(() => {
    try {
      const v = Number(localStorage.getItem(SPEED_KEY));
      return SPEEDS.some(([, ms]) => ms === v) ? v : 1200;
    } catch {
      return 1200;
    }
  });
  const setSpeed = (ms) => {
    setSpeedState(ms);
    try { localStorage.setItem(SPEED_KEY, String(ms)); } catch { /* private mode */ }
  };
  const [paused, setPaused] = useState(false);
  const [banner, setBanner] = useState(null);
  const [committed, setCommitted] = useState(false);
  const stepInfo = useRef({ at: performance.now(), dur: 1200, shot: null, periodEnd: false, paused: true });
  const clockRef = useRef(null);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const me = s.userSide;
  const mySide = me ? s[me] : null;

  // One 10-second step of the game; returns how long to hold before the next one
  // (a moment to take in a goal or the end of a period).
  const doStep = () => {
    const before = s.events.length;
    stepGame(s);
    const fresh = s.events.slice(before);
    const ms = speedRef.current;
    const shotEv = [...fresh].reverse().find((e) => ["goal", "save", "so-goal", "so-miss"].includes(e.t));
    const periodEv = fresh.find((e) => e.t === "period" || e.t === "final");
    stepInfo.current = { at: performance.now(), dur: ms, shot: shotEv ? { x: shotEv.x, y: shotEv.y } : null, periodEnd: !!periodEv && s.phase !== "so", paused: false };
    const goalEv = fresh.find((e) => e.t === "goal");
    const calm = ms >= 400;
    let hold = 0;
    if (goalEv) {
      const t = goalEv.side === "h" ? home : away;
      const parts = goalEv.text.replace(/^GOAL! /, "").split(". ");
      setBanner({ kind: "goal", title: `GOAL — ${t.abbr}`, sub: parts[0], color: t.colors[0], n: Date.now() });
      hold = calm ? Math.min(3400, Math.max(2000, ms * 2)) : 500;
    } else if (periodEv) {
      setBanner({ kind: "period", title: periodEv.text, n: Date.now() });
      hold = calm ? 2400 : 300;
    } else if (fresh.some((e) => e.t === "so-goal" || e.t === "so-miss")) {
      hold = calm ? 900 : 0;
    }
    if (hold) setTimeout(() => setBanner((b) => (b && Date.now() - b.n >= hold - 50 ? null : b)), hold);
    force((x) => x + 1);
    return hold;
  };

  useEffect(() => {
    if (paused || s.phase === "final") {
      stepInfo.current = { ...stepInfo.current, paused: true };
      return;
    }
    let timer;
    const run = (delay) => {
      timer = setTimeout(() => {
        const hold = doStep();
        if (s.phase !== "final") run(speedRef.current + hold);
        else force((x) => x + 1);
      }, delay);
    };
    run(speedRef.current);
    return () => clearTimeout(timer);
  }, [paused, speed, s]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setBanner(null);
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
  const lastPlay = feed.find((e) => e.t !== "fo");
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
          <div className="t" ref={clockRef}>{s.phase === "final" ? "FINAL" : s.phase === "so" ? "SO" : clockLabel(s.clock)}</div>
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
          <Rink s={s} home={home} away={away} stepInfo={stepInfo} clockRef={clockRef} banner={banner} />
          {lastPlay && (
            <div className={`lastplay ${lastPlay.t}`} key={s.events.length}>
              <span className="when">{lastPlay.phase === "so" ? "SO" : `${lastPlay.period > 3 ? (s.playoff ? `${lastPlay.period - 3}OT` : "OT") : ["1st", "2nd", "3rd"][lastPlay.period - 1]} ${clockLabel(lastPlay.clock)}`}</span>
              <span>{lastPlay.text}</span>
            </div>
          )}
          <div className="panel">
            <div className="row" style={{ gap: 6 }}>
              {s.phase !== "final" ? (
                <>
                  <button onClick={() => setPaused((p) => !p)}>{paused ? "▶ Resume" : "⏸ Pause"}</button>
                  <button onClick={() => { doStep(); stepInfo.current.paused = true; }} disabled={!paused}>Step</button>
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
