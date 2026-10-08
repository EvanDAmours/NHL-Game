import React from "react";
import { useGame, Modal, TeamBadge, PlayerName } from "./common.jsx";
import { dayToDate } from "../engine/schedule.js";
import { clockLabel } from "../engine/sim.js";

export default function BoxScoreModal({ game }) {
  const { league, closeModal } = useGame();
  const g = game;
  const H = league.teams[g.h];
  const A = league.teams[g.a];
  const name = (id) => league.players[id] || null;
  const perLabel = (n) => (n <= 3 ? ["1st", "2nd", "3rd"][n - 1] : "OT");
  return (
    <Modal title={`${A.abbr} ${g.as} @ ${H.abbr} ${g.hs}${g.ot ? ` (${g.ot})` : ""}`} onClose={closeModal}>
      <div className="stack">
        <div className="row" style={{ justifyContent: "center", gap: 28 }}>
          {[[A, g.as, g.shots?.a], [H, g.hs, g.shots?.h]].map(([t, sc, sh], i) => (
            <div key={i} className="stack center" style={{ gap: 4, alignItems: "center" }}>
              <TeamBadge team={t} size={46} />
              <div style={{ fontSize: 30, fontWeight: 900 }}>{sc}</div>
              <div className="muted small">{sh ?? "-"} shots</div>
            </div>
          ))}
        </div>
        <div className="muted small center">{g.day != null ? dayToDate(league.year, g.day) : "Playoffs"}</div>
        {g.goals && (
          <div className="panel">
            <h3>Scoring</h3>
            <div className="list">
              {g.goals.map((x, i) => (
                <div className="item small" key={i}>
                  <span className="dim mono" style={{ width: 64 }}>{perLabel(x.per)} {clockLabel(x.t)}</span>
                  <TeamBadge team={x.s === "h" ? H : A} size={18} />
                  <PlayerName p={name(x.p)} />
                  <span className="muted">{x.a?.length ? `(${x.a.map((id) => name(id)?.name.split(" ").slice(-1)[0] || "?").join(", ")})` : "(unassisted)"}</span>
                  {x.ty !== "EV" && <span className="pill">{x.ty}</span>}
                </div>
              ))}
              {!g.goals.length && <div className="dim small">No goals.</div>}
            </div>
          </div>
        )}
        {g.stars?.length > 0 && (
          <div className="panel">
            <h3>Three Stars</h3>
            <div className="list">
              {g.stars.map((id, i) => (
                <div className="item" key={id}>
                  <span>{"⭐".repeat(3 - i)}</span>
                  <PlayerName p={name(id)} />
                  <span className="muted small">{name(id) ? league.teams[name(id).tid]?.abbr : ""}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
