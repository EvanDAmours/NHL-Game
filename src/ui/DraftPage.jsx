import React, { useState } from "react";
import { useGame, Table, PlayerName, TeamBadge, TeamName, Ovr, POS_ORDER } from "./common.jsx";
import { shownRatings, scoutProspect, scoutCost, makePick, currentSlot, draftDone, pickLabel } from "../engine/draft.js";
import { ARCHETYPES } from "../engine/constants.js";

export default function DraftPage({ act }) {
  const { league, commit, toast } = useGame();
  const [pos, setPos] = useState("all");
  const user = league.teams[league.userTid];
  const inDraft = league.phase === "draft" && league.draft;
  const slot = inDraft ? currentSlot(league) : null;
  const onClock = slot && slot.owner === user.id;
  const pool = league.draftClass.map((id) => league.players[id]).filter((p) => p && p.tid === -2 && (pos === "all" || p.pos === pos));
  const myPicks = league.draftPicks.filter((p) => p.owner === user.id).sort((a, b) => a.year - b.year || a.round - b.round);

  const scout = (p) => {
    if (!scoutProspect(league, p.id)) toast("Not enough scouting points.");
    commit();
  };
  const draft = (p) => {
    if (!onClock) return;
    makePick(league, p.id);
    toast(`You selected ${p.name}!`);
    commit();
  };

  const rank = (p) => {
    const r = shownRatings(p);
    return r.pot * 0.75 + r.ovr * 0.25;
  };

  return (
    <div className="stack">
      <div className="pagehead">
        <h2>{inDraft ? `${league.draft.year} NHL Entry Draft` : `${league.draftClassYear} Draft Class`}</h2>
        <span className="pill">Scouting points: {user.scoutPts}</span>
        {inDraft && !draftDone(league) && (
          <span className={`pill ${onClock ? "on" : ""}`}>
            Pick #{slot.overall} (Round {slot.round}) — {onClock ? "YOU ARE ON THE CLOCK" : `${league.teams[slot.owner].abbr} on the clock`}
          </span>
        )}
        {inDraft && draftDone(league) && <button className="primary" onClick={act.toResign}>Draft complete — continue →</button>}
      </div>

      {inDraft && league.draft.lottery?.draws?.length > 0 && league.draft.idx < 40 && (
        <div className="panel">
          <h3>Draft Lottery</h3>
          <div className="list">
            {league.draft.lottery.draws.map((d, i) => (
              <div className="item" key={i}>
                <b>#{i + 1} pick:</b> <TeamBadge team={league.teams[d.id]} size={20} /> <TeamName tid={d.id} />
                <span className="muted small">{d.from > d.to ? `jumped from ${d.from} to ${d.to}` : "held the top spot"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid g3">
        <div className="panel" style={{ gridColumn: "span 2" }}>
          <h3>
            {inDraft ? "Available Prospects" : "Scouting"}
            <span className="right">
              <select value={pos} onChange={(e) => setPos(e.target.value)}>
                <option value="all">All positions</option>
                {["C", "LW", "RW", "LD", "RD", "G"].map((x) => <option key={x}>{x}</option>)}
              </select>
            </span>
          </h3>
          <div className="muted small" style={{ marginBottom: 8 }}>
            Ratings shown are your scouts' estimates. Scouting a prospect (1 pt, then 2 pts) narrows the estimate; level 2 reveals his true ratings. Points refresh every season.
          </div>
          <Table
            columns={[
              { key: "rk", label: "#", render: (_, i) => <span className="dim">{i + 1}</span> },
              { key: "name", label: "Prospect", render: (p) => <PlayerName p={p} />, sort: (p) => p.name },
              { key: "pos", label: "Pos", sort: (p) => POS_ORDER[p.pos] },
              { key: "age", label: "Age", num: true, sort: (p) => p.age },
              { key: "nat", label: "Nat", render: (p) => <span className="small muted">{p.nat}</span> },
              { key: "ovr", label: "OVR", render: (p) => <span><Ovr v={shownRatings(p).ovr} />{!shownRatings(p).exact && <span className="dim small"> ±{p.scout.lvl ? 2 : 4}</span>}</span>, sort: (p) => shownRatings(p).ovr },
              { key: "pot", label: "POT", num: true, render: (p) => <span><b>{shownRatings(p).pot}</b>{!shownRatings(p).exact && <span className="dim small"> ±{p.scout.lvl ? 2 : 5}</span>}</span>, sort: (p) => shownRatings(p).pot },
              { key: "type", label: "Type", render: (p) => <span className="small muted">{ARCHETYPES[p.type]?.name}</span> },
              { key: "sc", label: "Scouted", render: (p) => "●".repeat(p.scout.lvl) + "○".repeat(2 - p.scout.lvl), sort: (p) => p.scout.lvl },
              { key: "rank", label: "Value", num: true, render: (p) => rank(p).toFixed(0), sort: rank },
              {
                key: "act",
                label: "",
                render: (p) => (
                  <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                    <button className="tiny" disabled={!scoutCost(p) || user.scoutPts < scoutCost(p)} onClick={() => scout(p)}>Scout ({scoutCost(p) || "✓"})</button>
                    {inDraft && <button className="tiny primary" disabled={!onClock} onClick={() => draft(p)}>Draft</button>}
                  </span>
                ),
              },
            ]}
            rows={pool}
            initialSort={{ key: "rank", dir: "desc" }}
            limit={120}
            empty="No prospects available."
            dense
          />
        </div>
        <div className="stack">
          {inDraft && (
            <div className="panel">
              <h3>Draft Board</h3>
              <div className="list" style={{ maxHeight: 420, overflowY: "auto" }}>
                {league.draft.slots.slice(0, league.draft.idx).reverse().slice(0, 60).map((s) => {
                  const p = league.players[s.pid];
                  return (
                    <div className="item small" key={s.overall}>
                      <span className="dim mono" style={{ width: 30 }}>{s.overall}</span>
                      <TeamBadge team={league.teams[s.owner]} size={18} />
                      {p ? <PlayerName p={p} /> : <span className="dim">—</span>}
                      <span className="muted" style={{ marginLeft: "auto" }}>{p?.pos}</span>
                    </div>
                  );
                })}
                {league.draft.idx === 0 && <div className="dim small">No picks yet.</div>}
              </div>
            </div>
          )}
          <div className="panel">
            <h3>Your Picks</h3>
            <div className="list">
              {inDraft &&
                league.draft.slots
                  .slice(league.draft.idx)
                  .filter((s) => s.owner === user.id)
                  .map((s) => <div className="item small" key={s.overall}>{league.draft.year} · Round {s.round} · #{s.overall}{s.orig !== user.id ? ` (from ${league.teams[s.orig].abbr})` : ""}</div>)}
              {myPicks.filter((pk) => !inDraft || pk.year !== league.draft.year).map((pk) => <div className="item small" key={pk.id}>{pickLabel(league, pk)}</div>)}
              {!myPicks.length && !inDraft && <div className="dim small">You don't own any picks.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
