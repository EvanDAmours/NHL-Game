import React from "react";
import { useGame, TeamBadge, TeamName } from "./common.jsx";
import { ROUND_NAMES } from "../engine/playoffs.js";
import { playoffPicture } from "../engine/standings.js";

function SeriesCard({ s }) {
  const { league, openBox } = useGame();
  const me = s.top === league.userTid || s.bot === league.userTid;
  const row = (tid, w) => (
    <div className={`tm ${s.winner != null ? (s.winner === tid ? "won" : "lost") : ""}`}>
      <TeamBadge team={league.teams[tid]} size={20} />
      <TeamName tid={tid} short />
      <span className="dim small">{league.teams[tid].rec.pts}</span>
      <span className="w">{w}</span>
    </div>
  );
  return (
    <div className={`series ${me ? "me" : ""}`}>
      {row(s.top, s.wTop)}
      {row(s.bot, s.wBot)}
      {s.games.length > 0 && (
        <div className="row" style={{ gap: 4, marginTop: 4 }}>
          {s.games.map((g, i) => (
            <span key={i} className="pill link" title="Box score" onClick={() => openBox({ ...g, day: null, shots: null })}>
              G{i + 1} {league.teams[g.a].abbr} {g.as}-{g.hs} {league.teams[g.h].abbr}{g.ot ? ` ${g.ot}` : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PlayoffsPage({ act }) {
  const { league } = useGame();
  const po = league.playoffs;
  if (!po) {
    return (
      <div className="stack">
        <div className="pagehead"><h2>Playoff Picture</h2><span className="muted">The top three in each division plus two wild cards per conference qualify.</span></div>
        <div className="grid g2">
          {["East", "West"].map((c) => {
            const pic = playoffPicture(league, c);
            return (
              <div className="panel" key={c}>
                <h3>{c}ern Conference</h3>
                {pic.order.map((d) => (
                  <div key={d} style={{ marginBottom: 10 }}>
                    <div className="muted small">{d}</div>
                    {pic.divs[d].map((t, i) => (
                      <div className="row" key={t.id} style={{ padding: "3px 0", fontWeight: t.id === league.userTid ? 800 : 500 }}>
                        <span className="dim small">{d[0]}{i + 1}</span><TeamBadge team={t} size={20} /><TeamName tid={t.id} /><span className="mono" style={{ marginLeft: "auto" }}>{t.rec.pts}</span>
                      </div>
                    ))}
                  </div>
                ))}
                <div className="muted small">Wild cards</div>
                {pic.wildcards.map((t, i) => (
                  <div className="row" key={t.id} style={{ padding: "3px 0", fontWeight: t.id === league.userTid ? 800 : 500 }}>
                    <span className="dim small">WC{i + 1}</span><TeamBadge team={t} size={20} /><TeamName tid={t.id} /><span className="mono" style={{ marginLeft: "auto" }}>{t.rec.pts}</span>
                  </div>
                ))}
                <div className="muted small" style={{ marginTop: 8 }}>Chasing</div>
                {pic.out.slice(0, 4).map((t) => (
                  <div className="row dim" key={t.id} style={{ padding: "3px 0" }}>
                    <TeamBadge team={t} size={18} /><TeamName tid={t.id} short /><span className="mono" style={{ marginLeft: "auto" }}>{t.rec.pts}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const cols = [0, 1, 2, 3].map((r) => po.rounds[r] || []);
  const champ = po.champion != null ? league.teams[po.champion] : null;
  return (
    <div className="stack">
      <div className="pagehead">
        <h2>Stanley Cup Playoffs</h2>
        <span className="pill on">{champ ? "Complete" : ROUND_NAMES[po.round]}</span>
      </div>
      {champ && (
        <div className="panel row" style={{ gap: 16 }}>
          <span style={{ fontSize: 40 }}>🏆</span>
          <TeamBadge team={champ} size={52} />
          <div>
            <div style={{ fontSize: 22, fontWeight: 900 }}>{champ.city} {champ.name}</div>
            <div className="muted">{league.year}-{String(league.year + 1).slice(2)} Stanley Cup Champions{league.awards?.connSmythe ? ` · Conn Smythe: ${league.awards.connSmythe.name} (${league.awards.connSmythe.why})` : ""}</div>
          </div>
          <div style={{ flex: 1 }} />
          {act && league.phase === "playoffs" && <button className="primary" onClick={act.toDraft}>Go to the Draft →</button>}
        </div>
      )}
      <div className="bracket" style={{ marginBottom: -4 }}>
        {cols.map((_, r) => <div key={r} className="muted small center" style={{ fontWeight: 700 }}>{ROUND_NAMES[r]}</div>)}
      </div>
      <div className="bracket">
        {cols.map((round, r) => (
          <div className="col" key={r}>
            {round.map((s, i) => <SeriesCard key={i} s={s} />)}
            {!round.length && <div className="dim small center">TBD</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
