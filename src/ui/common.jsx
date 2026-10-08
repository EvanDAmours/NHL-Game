import React, { createContext, useContext, useMemo, useState } from "react";
import { ratingTier } from "../engine/ratings.js";
import { fmtMoney } from "../engine/players.js";

export const GameCtx = createContext(null);
export const useGame = () => useContext(GameCtx);

export function TeamBadge({ team, size = 28 }) {
  if (!team) return null;
  const [c1, c2] = team.colors;
  return (
    <span
      className="teambadge"
      title={`${team.city} ${team.name}`}
      style={{ width: size, height: size, background: c1, color: readable(c1, c2), fontSize: Math.max(8, size * 0.32) }}
    >
      {team.abbr}
    </span>
  );
}

function luminance(hex) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function readable(bg, preferred) {
  const lb = luminance(bg);
  if (preferred && Math.abs(luminance(preferred) - lb) > 0.35) return preferred;
  return lb > 0.55 ? "#111" : "#fff";
}

export function Ovr({ v, src, title }) {
  return (
    <span className="nowrap" title={title}>
      <span className={`ovr ${ratingTier(v)}`}>{v}</span>
      {src === "ea27" && <span className="src ea" title="Official EA SPORTS NHL 27 rating">EA</span>}
      {src === "est" && <span className="src est" title="Estimated rating (not yet verified against EA's NHL 27 database)">EST</span>}
    </span>
  );
}

export function PlayerName({ p, showInj = true }) {
  const { openPlayer } = useGame();
  if (!p) return <span className="dim">—</span>;
  return (
    <span className="nowrap">
      <span className="link" onClick={() => openPlayer(p.id)}>{p.name}</span>
      {showInj && p.injury > 0 && <span className="inj" title={`${p.injuryNote || "injury"} — out ${p.injury} games`}> +{p.injury}</span>}
    </span>
  );
}

export function TeamName({ tid, short = false }) {
  const { league, openTeam } = useGame();
  const t = league.teams[tid];
  if (!t) return <span className="dim">FA</span>;
  return (
    <span className="link nowrap" onClick={() => openTeam(tid)}>
      {short ? t.abbr : `${t.city} ${t.name}`}
    </span>
  );
}

export const money = fmtMoney;

export function Modal({ title, onClose, children, head }) {
  return (
    <div className="modalbg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog">
        <div className="mhead">
          {head}
          <div style={{ fontWeight: 800, fontSize: 18 }}>{title}</div>
          <button className="close ghost" onClick={onClose}>✕</button>
        </div>
        <div className="mbody">{children}</div>
      </div>
    </div>
  );
}

// Sortable table. columns: [{ key, label, render(row), sort(row) -> value, num, title }]
export function Table({ columns, rows, initialSort, rowClass, limit, empty = "Nothing to show.", dense }) {
  const [sort, setSort] = useState(initialSort || null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col || !col.sort) return rows;
    const arr = [...rows];
    arr.sort((a, b) => {
      const va = col.sort(a);
      const vb = col.sort(b);
      const cmp = typeof va === "string" ? va.localeCompare(vb) : va - vb;
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [rows, sort, columns]);
  const shown = limit ? sorted.slice(0, limit) : sorted;
  return (
    <div className="tablewrap">
      <table className="t" style={dense ? { fontSize: 12 } : undefined}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                title={c.title}
                className={`${c.num ? "num" : ""} ${c.sort ? "sortable" : ""} ${sort?.key === c.key ? "sorted" : ""}`}
                onClick={() => c.sort && setSort((s) => ({ key: c.key, dir: s?.key === c.key && s.dir === "desc" ? "asc" : "desc" }))}
              >
                {c.label}
                {sort?.key === c.key ? (sort.dir === "desc" ? " ▾" : " ▴") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={r.id ?? i} className={rowClass ? rowClass(r, i) : ""}>
              {columns.map((c) => (
                <td key={c.key} className={c.num ? "num" : ""}>
                  {c.render ? c.render(r, i) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
          {!shown.length && (
            <tr>
              <td colSpan={columns.length} className="muted center" style={{ padding: 18 }}>{empty}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Bar({ v, max = 99, color }) {
  const pct = Math.max(0, Math.min(100, (v / max) * 100));
  const c = color || (v >= 90 ? "#f5c542" : v >= 85 ? "#34d399" : v >= 80 ? "#60a5fa" : v >= 70 ? "#64748b" : "#475569");
  return (
    <div className="bar">
      <i style={{ width: pct + "%", background: c }} />
    </div>
  );
}

export function recordStr(rec) {
  return `${rec.w}-${rec.l}-${rec.otl}`;
}

export function pct(x, digits = 3) {
  if (!isFinite(x)) return "-";
  const s = x.toFixed(digits);
  return s.startsWith("0") ? s.slice(1) : s;
}

export function signed(n) {
  return n > 0 ? `+${n}` : `${n}`;
}

export const POS_ORDER = { C: 0, LW: 1, RW: 2, LD: 3, RD: 4, G: 5 };
