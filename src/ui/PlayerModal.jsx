import React from "react";
import { useGame, Modal, TeamBadge, Ovr, Bar, money, pct, signed } from "./common.jsx";
import { SKATER_ATTRS, GOALIE_ATTRS } from "../engine/ratings.js";
import { isGoalie, ARCHETYPES } from "../engine/constants.js";
import { fullPosName, savePct, gaa, marketValue, isRFA } from "../engine/players.js";
import { shownRatings } from "../engine/draft.js";
import { sendDown, callUp, releasePlayer, canSendDown, hasRoomFor } from "../engine/roster.js";

export default function PlayerModal({ pid }) {
  const { league, closeModal, commit, toast, proposeTradeFor, go, openTeam, ask } = useGame();
  const p = league.players[pid];
  const team = league.teams[p.tid];
  const mine = p.tid === league.userTid;
  const inMinors = team && team.prospects.includes(p.id);
  const hidden = (p.tid === -2 || (inMinors && !mine)) && p.scout;
  const r = hidden ? shownRatings(p) : { ovr: p.ovr, pot: p.pot, exact: true };
  const goalie = isGoalie(p.pos);
  const groups = goalie ? GOALIE_ATTRS : SKATER_ATTRS;
  const s = p.stats;
  const ps = p.pstats;

  const statLine = (st) =>
    goalie
      ? [["GP", st.gp], ["W", st.w], ["L", st.l], ["OTL", st.otl], ["SV%", pct(savePct(st))], ["GAA", gaa(st).toFixed(2)], ["SO", st.so]]
      : [["GP", st.gp], ["G", st.g], ["A", st.a], ["P", st.pts], ["+/-", signed(st.pm)], ["PIM", st.pim], ["SOG", st.sog], ["PPG", st.ppg], ["HIT", st.hit], ["BLK", st.blk]];

  const career = [...p.career].reverse();

  return (
    <Modal
      title={p.name}
      onClose={closeModal}
      head={team ? <TeamBadge team={team} size={36} /> : <span className="pill">{p.tid === -2 ? "Draft prospect" : "Free agent"}</span>}
    >
      <div className="stack">
        <div className="row" style={{ gap: 18, alignItems: "flex-start" }}>
          <div className="stack" style={{ gap: 6, alignItems: "center" }}>
            <span style={{ transform: "scale(1.6)", margin: "8px 10px" }}><Ovr v={r.ovr} /></span>
            <span className="muted small">OVR{hidden && !r.exact ? " (est.)" : ""}</span>
          </div>
          <div className="kv" style={{ flex: 1 }}>
            <span className="k">Position</span><span>{fullPosName(p.pos)} · shoots {p.shoots}{goalie ? "/catches" : ""}</span>
            <span className="k">Type</span><span>{ARCHETYPES[p.type]?.name}</span>
            <span className="k">Age</span><span>{p.age}{p.nat ? ` · ${p.nat}` : ""}</span>
            <span className="k">Potential</span><span>{r.pot}{hidden && !r.exact ? " (scout estimate)" : ""}</span>
            <span className="k">Team</span><span>{team ? <span className="link" onClick={() => openTeam(team.id)}>{team.city} {team.name}</span> : p.tid === -2 ? `${league.draftClassYear} draft class` : "Free agent"}{inMinors ? " (minors)" : ""}</span>
            <span className="k">Contract</span>
            <span>{p.signed === false ? "Unsigned draft pick" : p.yrs > 0 ? `${money(p.cap)} × ${p.yrs} yr${p.yrs > 1 ? "s" : ""} (through ${league.year + p.yrs - 1}-${String(league.year + p.yrs).slice(2)})` : "None"} {p.tid >= 0 && p.yrs <= 1 && p.signed !== false ? <span className="pill">{isRFA(p) ? "RFA" : "UFA"} next summer</span> : null}</span>
            <span className="k">Market value</span><span>{money(marketValue(p, league.year))} / yr</span>
            <span className="k">Rating source</span>
            <span>{p.src === "ea27" ? <><span className="src ea">EA</span> Official EA SPORTS NHL 27 overall</> : p.src === "est" ? <><span className="src est">EST</span> Estimated — update it in Settings → Ratings Import</> : "Generated player"}</span>
            {p.injury > 0 && (<><span className="k">Injury</span><span className="bad">{p.injuryNote} — out {p.injury} game{p.injury > 1 ? "s" : ""}</span></>)}
            {p.draft && (<><span className="k">Drafted</span><span>{p.draft.year} · Round {p.draft.round}, #{p.draft.pick} by {league.teams[p.draft.tid]?.abbr}</span></>)}
          </div>
        </div>

        {!hidden && (
          <div className="panel">
            <h3>Attributes</h3>
            <div className="attrgrid">
              {Object.entries(groups).map(([g, attrs]) => (
                <div key={g}>
                  <div className="muted small" style={{ textTransform: "capitalize", fontWeight: 700, marginBottom: 4 }}>{g}</div>
                  {Object.entries(attrs).map(([k, label]) => (
                    <div className="attr" key={k} style={{ marginBottom: 4 }}>
                      <span>{label}</span>
                      <span className="right mono">{p.attrs[k]}</span>
                      <Bar v={p.attrs[k]} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="panel">
          <h3>{league.year}-{String(league.year + 1).slice(2)} Stats</h3>
          <div className="row" style={{ gap: 18 }}>
            {statLine(s).map(([k, v]) => <div className="stat" key={k}><span className="l">{k}</span><span className="v" style={{ fontSize: 18 }}>{v}</span></div>)}
          </div>
          {ps.gp > 0 && (
            <>
              <div className="muted small" style={{ margin: "10px 0 4px" }}>Playoffs</div>
              <div className="row" style={{ gap: 18 }}>
                {statLine(ps).map(([k, v]) => <div className="stat" key={k}><span className="l">{k}</span><span className="v" style={{ fontSize: 16 }}>{v}</span></div>)}
              </div>
            </>
          )}
        </div>

        {career.length > 0 && (
          <div className="panel">
            <h3>Career (Rink GM)</h3>
            <div className="tablewrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Season</th><th>Team</th><th className="num">OVR</th>
                    {goalie ? <><th className="num">GP</th><th className="num">W</th><th className="num">L</th><th className="num">OTL</th><th className="num">SV%</th><th className="num">GAA</th><th className="num">SO</th></>
                      : <><th className="num">GP</th><th className="num">G</th><th className="num">A</th><th className="num">P</th><th className="num">+/-</th><th className="num">PIM</th></>}
                  </tr>
                </thead>
                <tbody>
                  {career.map((c, i) => (
                    <tr key={i}>
                      <td>{c.y}-{String(c.y + 1).slice(2)}</td><td>{c.t}</td><td className="num">{c.o ?? ""}</td>
                      {goalie ? <><td className="num">{c.s.gp}</td><td className="num">{c.s.w}</td><td className="num">{c.s.l}</td><td className="num">{c.s.otl}</td><td className="num">{pct(savePct(c.s))}</td><td className="num">{gaa(c.s).toFixed(2)}</td><td className="num">{c.s.so}</td></>
                        : <><td className="num">{c.s.gp}</td><td className="num">{c.s.g}</td><td className="num">{c.s.a}</td><td className="num">{c.s.pts}</td><td className="num">{signed(c.s.pm)}</td><td className="num">{c.s.pim}</td></>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="row">
          {mine && !inMinors && (
            <>
              <button disabled={!canSendDown(p)} onClick={() => { sendDown(league, team, p.id); commit(); closeModal(); }}>Send to minors</button>
              <button className="danger" onClick={async () => { if (await ask({ title: `Release ${p.name}?`, body: p.yrs > 0 && p.cap > 0 ? `His buyout leaves ${money(p.cap / 3)} of dead cap for ${p.yrs * 2} season(s).` : "He becomes a free agent.", yes: "Release", danger: true })) { releasePlayer(league, team, p.id); commit(); closeModal(); } }}>Release</button>
              <button onClick={() => proposeTradeFor(p.id, p.tid)}>Put in a trade</button>
            </>
          )}
          {mine && inMinors && (
            <button onClick={() => { if (!hasRoomFor(league, team)) return toast("Roster is full."); callUp(league, team, p.id); commit(); closeModal(); }}>Call up</button>
          )}
          {!mine && p.tid >= 0 && <button className="primary" onClick={() => proposeTradeFor(p.id)}>Trade for {p.name.split(" ").slice(-1)[0]}</button>}
          {p.tid === -1 && <button className="primary" onClick={() => { closeModal(); go("freeagency"); }}>Go to free agency</button>}
        </div>
      </div>
    </Modal>
  );
}
