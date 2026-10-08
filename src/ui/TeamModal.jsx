import React from "react";
import { useGame, Modal, TeamBadge, Table, PlayerName, Ovr, money, recordStr, signed, POS_ORDER } from "./common.jsx";
import { teamRatings } from "../engine/lines.js";
import { payroll, capSpace } from "../engine/roster.js";
import { isGoalie } from "../engine/constants.js";
import { savePct, gaa } from "../engine/players.js";
import { shownRatings } from "../engine/draft.js";

export default function TeamModal({ tid }) {
  const { league, closeModal } = useGame();
  const t = league.teams[tid];
  const tr = teamRatings(league, t);
  const roster = t.roster.map((id) => league.players[id]).filter(Boolean);
  const minors = t.prospects.map((id) => league.players[id]).filter(Boolean);
  const mine = tid === league.userTid;
  return (
    <Modal title={`${t.city} ${t.name}`} onClose={closeModal} head={<TeamBadge team={t} size={40} />}>
      <div className="stack">
        <div className="row">
          <span className="pill">{recordStr(t.rec)} · {t.rec.pts} PTS</span>
          <span className="pill">OVR {tr.ovr} (F {tr.fwd} · D {tr.def} · G {tr.g})</span>
          <span className="pill">Payroll {money(payroll(league, t))}</span>
          <span className="pill">Cap space {money(capSpace(league, t))}</span>
          {t.playoffResult && <span className="pill on">{t.playoffResult}</span>}
        </div>
        <Table
          dense
          columns={[
            { key: "name", label: "Player", render: (p) => <PlayerName p={p} />, sort: (p) => p.name },
            { key: "pos", label: "Pos", sort: (p) => POS_ORDER[p.pos] },
            { key: "age", label: "Age", num: true, sort: (p) => p.age },
            { key: "ovr", label: "OVR", render: (p) => <Ovr v={p.ovr} src={p.src} />, sort: (p) => p.ovr },
            { key: "cap", label: "Cap", num: true, render: (p) => money(p.cap), sort: (p) => p.cap },
            { key: "yrs", label: "Yrs", num: true, sort: (p) => p.yrs },
            { key: "line", label: "Stats", render: (p) => (isGoalie(p.pos) ? `${p.stats.w}-${p.stats.l}-${p.stats.otl}, ${savePct(p.stats).toFixed(3).replace(/^0/, "")}, ${gaa(p.stats).toFixed(2)}` : `${p.stats.gp} GP, ${p.stats.g}-${p.stats.a}-${p.stats.pts}, ${signed(p.stats.pm)}`) },
          ]}
          rows={roster}
          initialSort={{ key: "ovr", dir: "desc" }}
        />
        {minors.length > 0 && (
          <>
            <div className="muted small">Minors & prospects</div>
            <div className="row">
              {minors.sort((a, b) => b.pot - a.pot).map((p) => {
                const r = mine ? p : shownRatings(p);
                return <span key={p.id} className="pill"><PlayerName p={p} /> {p.pos} {r.ovr}/{r.pot}</span>;
              })}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
