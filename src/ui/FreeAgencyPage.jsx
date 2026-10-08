import React, { useState } from "react";
import { useGame, Table, PlayerName, Ovr, money, POS_ORDER, Modal } from "./common.jsx";
import { faAsk, offerContract, expiringPlayers, resignAsk, resignPlayer, letWalk } from "../engine/offseason.js";
import { capSpace, counts, capYear } from "../engine/roster.js";
import { MAX_ROSTER, FA_DAYS, ARCHETYPES, capForYear } from "../engine/constants.js";
import { isRFA } from "../engine/players.js";

function OfferModal({ p, onClose }) {
  const { league, commit, toast } = useGame();
  const ask = faAsk(league, p);
  const [yrs, setYrs] = useState(ask.yrs);
  const askY = faAsk(league, p, yrs);
  const [aav, setAav] = useState(askY.aav);
  const user = league.teams[league.userTid];
  const submit = () => {
    const r = offerContract(league, p.id, Number(aav), yrs);
    toast(r.msg, 4500);
    if (r.ok) {
      commit();
      onClose();
    }
  };
  return (
    <Modal title={`Offer — ${p.name}`} onClose={onClose}>
      <div className="stack">
        <div className="row"><Ovr v={p.ovr} src={p.src} /> <span className="muted">{p.pos} · {p.age} yrs · POT {p.pot} · {ARCHETYPES[p.type]?.name}</span></div>
        <div className="kv">
          <span className="k">Asking</span><span>{money(askY.aav)} × {yrs} yr{yrs > 1 ? "s" : ""} (prefers {ask.prefYrs})</span>
          <span className="k">Your cap space</span><span>{money(capSpace(league, user))}</span>
          <span className="k">Roster</span><span>{counts(league, user).active}/{MAX_ROSTER}</span>
        </div>
        <div className="row">
          <label className="row small">Years
            <select value={yrs} onChange={(e) => { const y = Number(e.target.value); setYrs(y); setAav(faAsk(league, p, y).aav); }}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label className="row small">AAV ($M)
            <input type="number" step="0.05" min="0.85" value={aav} onChange={(e) => setAav(e.target.value)} style={{ width: 100 }} />
          </label>
          <button className="primary" onClick={submit}>Make Offer</button>
        </div>
        <div className="muted small">Better teams get a small discount. Asking prices drop as free agency goes on.</div>
      </div>
    </Modal>
  );
}

function ResignView() {
  const { league, commit, toast } = useGame();
  const user = league.teams[league.userTid];
  const expiring = expiringPlayers(league, user);
  const [terms, setTerms] = useState({});
  const termFor = (p) => terms[p.id] ?? resignAsk(league, p).prefYrs;
  const doSign = (p) => {
    const r = resignPlayer(league, p.id, termFor(p));
    if (!r.ok) toast(r.msg, 4500);
    commit();
  };
  const walk = (p) => {
    letWalk(league, p.id);
    commit();
  };
  const signed = user.roster.map((id) => league.players[id]).filter((p) => p && p.yrs > 0);
  return (
    <div className="stack">
      <div className="notice">
        Contracts expiring this summer. Re-sign the players you want to keep; anyone left unsigned becomes a free agent when you proceed. Young players (25 and under) are restricted free agents and always negotiate.
      </div>
      <Table
        columns={[
          { key: "name", label: "Player", render: (p) => <PlayerName p={p} />, sort: (p) => p.name },
          { key: "pos", label: "Pos", sort: (p) => POS_ORDER[p.pos] },
          { key: "age", label: "Age", num: true, render: (p) => p.age + 1, sort: (p) => p.age, title: "Age next season" },
          { key: "ovr", label: "OVR", render: (p) => <Ovr v={p.ovr} src={p.src} />, sort: (p) => p.ovr },
          { key: "pot", label: "POT", num: true, sort: (p) => p.pot },
          { key: "prev", label: "Old Cap", num: true, render: (p) => money(p.prevCap), sort: (p) => p.prevCap || 0 },
          { key: "st", label: "Status", render: (p) => (isRFA(p) ? <span className="pill">RFA</span> : <span className="pill">UFA</span>) },
          { key: "mood", label: "Mood", render: (p) => (p.willing ? (p.mood > 0.6 ? <span className="good">Happy</span> : p.mood > 0.35 ? "Open" : <span className="warn">Lukewarm</span>) : <span className="bad">Testing FA</span>) },
          {
            key: "term",
            label: "Term",
            render: (p) => (
              <select value={termFor(p)} onChange={(e) => setTerms({ ...terms, [p.id]: Number(e.target.value) })} disabled={!p.willing}>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((y) => <option key={y} value={y}>{y} yr</option>)}
              </select>
            ),
          },
          { key: "ask", label: "Ask (AAV)", num: true, render: (p) => (p.willing ? money(resignAsk(league, p, termFor(p)).aav) : "—") },
          {
            key: "act",
            label: "",
            render: (p) => (
              <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                <button className="tiny primary" disabled={!p.willing} onClick={() => doSign(p)}>Re-sign</button>
                <button className="tiny" onClick={() => walk(p)}>Let walk</button>
              </span>
            ),
          },
        ]}
        rows={expiring}
        initialSort={{ key: "ovr", dir: "desc" }}
        empty="No expiring contracts left to decide on."
      />
      <div className="muted small">{signed.length} players under contract for next season · Cap {money(capForYear(capYear(league)))} · Space {money(capSpace(league, user))}</div>
    </div>
  );
}

export default function FreeAgencyPage() {
  const { league } = useGame();
  const [offerFor, setOfferFor] = useState(null);
  const [pos, setPos] = useState("all");
  const user = league.teams[league.userTid];
  const fas = league.freeAgents.map((id) => league.players[id]).filter((p) => p && (pos === "all" || p.pos === pos));
  const open = league.phase !== "draft" && league.phase !== "resign" && league.phase !== "playoffs";
  return (
    <div className="stack">
      <div className="pagehead">
        <h2>{league.phase === "resign" ? "Re-sign Players" : "Free Agency"}</h2>
        {league.phase === "freeagency" && <span className="pill on">Day {league.fa.day}/{FA_DAYS}</span>}
        <span className="pill">Cap space {money(capSpace(league, user))}</span>
        <span className="pill">Roster {counts(league, user).active}/{MAX_ROSTER}</span>
      </div>
      {league.phase === "resign" && <ResignView />}
      <div className="row between">
        <h3 className="muted small" style={{ textTransform: "uppercase", letterSpacing: 1, margin: 0 }}>Available free agents ({fas.length})</h3>
        <select value={pos} onChange={(e) => setPos(e.target.value)}>
          <option value="all">All positions</option>
          {["C", "LW", "RW", "LD", "RD", "G"].map((x) => <option key={x}>{x}</option>)}
        </select>
      </div>
      {!open && <div className="notice warn">The free-agent market opens after the draft and re-signing period. You can browse the pool now.</div>}
      <Table
        columns={[
          { key: "name", label: "Player", render: (p) => <PlayerName p={p} />, sort: (p) => p.name },
          { key: "pos", label: "Pos", sort: (p) => POS_ORDER[p.pos] },
          { key: "age", label: "Age", num: true, sort: (p) => p.age },
          { key: "ovr", label: "OVR", render: (p) => <Ovr v={p.ovr} src={p.src} />, sort: (p) => p.ovr },
          { key: "pot", label: "POT", num: true, sort: (p) => p.pot },
          { key: "type", label: "Type", render: (p) => <span className="small muted">{ARCHETYPES[p.type]?.name}</span> },
          { key: "ask", label: "Asking", num: true, render: (p) => `${money(faAsk(league, p).aav)} × ${faAsk(league, p).yrs}`, sort: (p) => faAsk(league, p).aav },
          { key: "act", label: "", render: (p) => <button className="tiny primary" disabled={!open} onClick={() => setOfferFor(p.id)}>Offer</button> },
        ]}
        rows={fas}
        initialSort={{ key: "ovr", dir: "desc" }}
        limit={200}
        empty="No free agents available."
      />
      {offerFor && league.players[offerFor] && <OfferModal p={league.players[offerFor]} onClose={() => setOfferFor(null)} />}
    </div>
  );
}
