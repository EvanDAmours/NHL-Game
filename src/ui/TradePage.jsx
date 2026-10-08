import React, { useEffect, useMemo, useState } from "react";
import { useGame, TeamBadge, Ovr, PlayerName, money, POS_ORDER } from "./common.jsx";
import { evaluateTrade, executeTrade, suggestBalance } from "../engine/trade.js";
import { pickLabel } from "../engine/draft.js";
import { capSpace } from "../engine/roster.js";
import { shownRatings } from "../engine/draft.js";
import { dayToDate } from "../engine/schedule.js";

function Assets({ team, sel, setSel, selPicks, setSelPicks, mine }) {
  const { league } = useGame();
  const roster = team.roster.map((id) => league.players[id]).filter(Boolean).sort((a, b) => POS_ORDER[a.pos] - POS_ORDER[b.pos] || b.ovr - a.ovr);
  const minors = team.prospects.map((id) => league.players[id]).filter(Boolean).sort((a, b) => b.pot - a.pot);
  const picks = league.draftPicks.filter((p) => p.owner === team.id).sort((a, b) => a.year - b.year || a.round - b.round);
  const toggle = (arr, set, id) => set(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  const row = (p, minor) => {
    const r = minor && !mine ? shownRatings(p) : { ovr: p.ovr, pot: p.pot };
    return (
      <label key={p.id} className="item" style={{ cursor: "pointer", gap: 8 }}>
        <input type="checkbox" checked={sel.includes(p.id)} onChange={() => toggle(sel, setSel, p.id)} />
        <span className="posbadge">{p.pos}</span>
        <Ovr v={r.ovr} src={minor ? undefined : p.src} />
        <PlayerName p={p} />
        <span className="dim small">{p.age}y · POT {r.pot}</span>
        <span className="small mono" style={{ marginLeft: "auto" }}>{minor && !p.signed ? "unsigned" : `${money(p.cap)}×${p.yrs}`}</span>
      </label>
    );
  };
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="panel" style={{ padding: 10 }}>
        <div className="muted small" style={{ marginBottom: 4 }}>NHL roster</div>
        <div className="list" style={{ maxHeight: 360, overflowY: "auto" }}>{roster.map((p) => row(p, false))}</div>
      </div>
      <div className="panel" style={{ padding: 10 }}>
        <div className="muted small" style={{ marginBottom: 4 }}>Minors & prospects</div>
        <div className="list" style={{ maxHeight: 200, overflowY: "auto" }}>
          {minors.map((p) => row(p, true))}
          {!minors.length && <div className="dim small">None.</div>}
        </div>
      </div>
      <div className="panel" style={{ padding: 10 }}>
        <div className="muted small" style={{ marginBottom: 4 }}>Draft picks</div>
        <div className="row" style={{ gap: 6 }}>
          {picks.map((pk) => (
            <label key={pk.id} className={`pill ${selPicks.includes(pk.id) ? "on" : ""}`} style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={selPicks.includes(pk.id)} onChange={() => toggle(selPicks, setSelPicks, pk.id)} style={{ display: "none" }} />
              {pickLabel(league, pk)}
            </label>
          ))}
          {!picks.length && <span className="dim small">None.</span>}
        </div>
      </div>
    </div>
  );
}

export default function TradePage({ seed }) {
  const { league, commit, toast } = useGame();
  const user = league.teams[league.userTid];
  const others = league.teams.filter((t) => t.id !== user.id);
  const [partner, setPartner] = useState(others[0].id);
  const [give, setGive] = useState([]);
  const [get, setGet] = useState([]);
  const [givePicks, setGivePicks] = useState([]);
  const [getPicks, setGetPicks] = useState([]);

  useEffect(() => {
    if (!seed) return;
    const p = league.players[seed.pid];
    if (p && p.tid !== user.id && p.tid >= 0) {
      setPartner(p.tid);
      setGet([p.id]);
      setGive([]);
      setGivePicks([]);
      setGetPicks([]);
    } else if (p && p.tid === user.id) {
      setGive([p.id]);
    }
  }, [seed]); // eslint-disable-line react-hooks/exhaustive-deps

  const ai = league.teams[partner];
  const offer = { from: user.id, to: ai.id, give, get, givePicks, getPicks };
  const ev = useMemo(() => evaluateTrade(league, offer), [league, partner, give, get, givePicks, getPicks, league.day]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => { setGive([]); setGet([]); setGivePicks([]); setGetPicks([]); };
  const propose = () => {
    if (!ev.accept) {
      toast(ev.problems[0] || `${ai.abbr}: "${ev.mood}"`);
      return;
    }
    executeTrade(league, offer);
    toast(`Trade completed with ${ai.city}!`);
    reset();
    commit();
  };
  const balance = () => {
    const s = suggestBalance(league, offer);
    if (!s) return toast(ev.accept ? "They'd already accept this." : "They don't see anything on your roster that closes the gap.");
    setGive(s.give);
    toast(`${ai.abbr} would want ${league.players[s.give[s.give.length - 1]].name} added.`);
  };

  const meter = Math.max(0, Math.min(1, ev.ratio / 1.4));
  const deadlinePassed = league.phase === "regular" && league.day > league.deadlineDay;

  return (
    <div className="stack">
      <div className="pagehead">
        <h2>Trade Center</h2>
        <select value={partner} onChange={(e) => { setPartner(Number(e.target.value)); setGet([]); setGetPicks([]); }}>
          {others.map((t) => <option key={t.id} value={t.id}>{t.city} {t.name}</option>)}
        </select>
        <span className="pill">{ev.contending ? "Contending — values proven players" : "Rebuilding — values youth & picks"}</span>
        <span className="muted small">{league.phase === "regular" ? `Deadline: ${dayToDate(league.year, league.deadlineDay)}` : ""}</span>
      </div>
      {(deadlinePassed || league.phase === "playoffs") && <div className="notice warn">Trading is frozen until the playoffs end.</div>}
      <div className="panel">
        <div className="row between">
          <div className="row"><TeamBadge team={user} size={26} /> <b>You send</b> <span className="muted small">cap space {money(capSpace(league, user))}</span></div>
          <div className="row"><b>You receive</b> <span className="muted small">{ai.abbr} cap space {money(capSpace(league, ai))}</span> <TeamBadge team={ai} size={26} /></div>
        </div>
        <div style={{ margin: "12px 0 8px" }}>
          <div className="bar" style={{ height: 10 }}>
            <i style={{ width: `${meter * 100}%`, background: ev.accept ? "var(--good)" : ev.ratio > 0.85 ? "var(--warn)" : "var(--bad)" }} />
          </div>
          <div className="row between small" style={{ marginTop: 6 }}>
            <span className="muted">{ai.abbr} GM: <b style={{ color: "var(--text)" }}>“{ev.mood}”</b></span>
            {ev.problems.map((p) => <span key={p} className="bad">{p}</span>)}
          </div>
        </div>
        <div className="row">
          <button className="primary" disabled={!ev.accept} onClick={propose}>Propose Trade</button>
          <button onClick={balance} disabled={!get.length && !getPicks.length}>What would it take?</button>
          <button className="ghost" onClick={reset}>Clear</button>
        </div>
      </div>
      <div className="grid g2">
        <Assets team={user} mine sel={give} setSel={setGive} selPicks={givePicks} setSelPicks={setGivePicks} />
        <Assets team={ai} sel={get} setSel={setGet} selPicks={getPicks} setSelPicks={setGetPicks} />
      </div>
      {league.tradeHistory?.length > 0 && (
        <div className="panel">
          <h3>Your Trades</h3>
          <div className="list">
            {league.tradeHistory.slice(0, 10).map((t, i) => (
              <div className="item small" key={i}>
                <span className="dim">{t.year}</span> {league.teams[t.a].abbr} sent {t.aSends} → {league.teams[t.b].abbr} for {t.bSends}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

