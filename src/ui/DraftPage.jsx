import React, { useState } from "react";
import { useGame, PlayerName, TeamBadge, TeamName } from "./common.jsx";
import { shownRatings, scoutProspect, scoutCost, makePick, currentSlot, draftDone, pickLabel, aiChoose, potentialTier, ratingRange } from "../engine/draft.js";
import { ARCHETYPES, DRAFT_ROUNDS } from "../engine/constants.js";

const POSITIONS = ["all", "C", "LW", "RW", "LD", "RD", "G"];
const SORTS = {
  board: { label: "Scouts' board", key: (p) => { const r = shownRatings(p); return r.pot * 0.75 + r.ovr * 0.25; } },
  pot: { label: "Highest ceiling", key: (p) => shownRatings(p).pot },
  ovr: { label: "Most NHL-ready", key: (p) => shownRatings(p).ovr },
};
const range = ([a, b]) => (a === b ? `${a}` : `${a}–${b}`);
const tierClass = (pot) => (pot >= 90 ? "elite" : pot >= 86 ? "great" : pot >= 82 ? "good" : pot >= 78 ? "avg" : "low");

export default function DraftPage({ act }) {
  const { league, commit, toast } = useGame();
  const [pos, setPos] = useState("all");
  const [sort, setSort] = useState("board");
  const [shown, setShown] = useState(40);
  const user = league.teams[league.userTid];
  const inDraft = league.phase === "draft" && league.draft;
  const done = inDraft && draftDone(league);
  const slot = inDraft && !done ? currentSlot(league) : null;
  const onClock = slot && slot.owner === user.id;
  const [roundSel, setRound] = useState(null);
  const round = roundSel ?? (slot ? slot.round : DRAFT_ROUNDS);
  const year = inDraft ? league.draft.year : league.draftClassYear;

  const pool = league.draftClass
    .map((id) => league.players[id])
    .filter((p) => p && p.tid === -2)
    .sort((a, b) => SORTS[sort].key(b) - SORTS[sort].key(a));
  const boardRank = new Map([...pool].sort((a, b) => SORTS.board.key(b) - SORTS.board.key(a)).map((p, i) => [p.id, i + 1]));
  const list = pool.filter((p) => pos === "all" || p.pos === pos);

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
  const nextPick = () => {
    if (!slot || onClock) return;
    makePick(league, aiChoose(league, slot.owner));
    commit();
  };

  const slotLine = (s) => {
    const p = s.pid ? league.players[s.pid] : null;
    const mine = s.owner === user.id;
    const now = slot && s.overall === slot.overall;
    const pickInRound = ((s.overall - 1) % 32) + 1;
    return (
      <div key={s.overall} className={`dslot${mine ? " mine" : ""}${now ? " now" : ""}`}>
        <span className="dnum">{s.overall}</span>
        <TeamBadge team={league.teams[s.owner]} size={22} />
        <span className="dslot-main">
          {p ? (
            <>
              <PlayerName p={p} /> <span className="dim small">{p.pos}</span>
            </>
          ) : now ? (
            <b>On the clock</b>
          ) : (
            <span className="dim">{league.teams[s.owner].abbr} · round {s.round}, pick {pickInRound}</span>
          )}
          {s.orig !== s.owner && <span className="dim small"> (from {league.teams[s.orig].abbr})</span>}
        </span>
      </div>
    );
  };

  const upcoming = inDraft && !done ? league.draft.slots.slice(league.draft.idx + 1, league.draft.idx + 9) : [];
  const myUpcoming = inDraft ? league.draft.slots.slice(league.draft.idx).filter((s) => s.owner === user.id) : [];
  const futurePicks = league.draftPicks.filter((p) => p.owner === user.id && (!inDraft || p.year !== league.draft.year)).sort((a, b) => a.year - b.year || a.round - b.round);
  const best = list[0];

  return (
    <div className="stack">
      <div className="pagehead">
        <h2>{year} NHL Entry Draft</h2>
        {inDraft && !done && <span className="pill on">Round {slot.round} of {DRAFT_ROUNDS}</span>}
        {!inDraft && <span className="pill">{DRAFT_ROUNDS} rounds · {DRAFT_ROUNDS * 32} picks</span>}
        <span className="pill">Scouting points: {user.scoutPts}</span>
      </div>

      {inDraft && !done && (
        <div className={`otc${onClock ? " you" : ""}`} style={{ "--c1": league.teams[slot.owner].colors[0] }}>
          <TeamBadge team={league.teams[slot.owner]} size={52} />
          <div style={{ minWidth: 0 }}>
            <div className="otc-k">{onClock ? "You're on the clock" : "On the clock"}</div>
            <div className="otc-t">{league.teams[slot.owner].city} {league.teams[slot.owner].name}</div>
            <div className="small muted">
              Pick {slot.overall} overall · round {slot.round}, pick {((slot.overall - 1) % 32) + 1}
              {slot.orig !== slot.owner ? ` · from ${league.teams[slot.orig].abbr}` : ""}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          {onClock ? (
            best && <button className="primary" onClick={() => draft(best)}>Draft {best.name}</button>
          ) : (
            <div className="row">
              <button onClick={nextPick}>Next pick</button>
              <button className="primary" onClick={act.simToMyPick}>Sim to my pick</button>
            </div>
          )}
        </div>
      )}
      {done && (
        <div className="otc you">
          <div>
            <div className="otc-k">Draft complete</div>
            <div className="otc-t">Your new prospects are in the minors.</div>
          </div>
          <div style={{ flex: 1 }} />
          <button className="primary" onClick={act.toResign}>Continue to re-signing →</button>
        </div>
      )}
      {upcoming.length > 0 && (
        <div className="row small" style={{ gap: 6 }}>
          <span className="muted">Up next:</span>
          {upcoming.map((s) => (
            <span key={s.overall} className={`pill${s.owner === user.id ? " on" : ""}`}>#{s.overall} {league.teams[s.owner].abbr}</span>
          ))}
        </div>
      )}

      {inDraft && league.draft.lottery?.draws?.length > 0 && league.draft.idx < 32 && (
        <div className="panel">
          <h3>Draft lottery</h3>
          <div className="row" style={{ gap: 14 }}>
            {league.draft.lottery.draws.map((d, i) => (
              <span key={i} className="row" style={{ gap: 6 }}>
                <b>#{i + 1}</b> <TeamBadge team={league.teams[d.id]} size={20} /> <TeamName tid={d.id} />
                <span className="muted small">{d.from > d.to ? `jumped from ${d.from}` : d.to === 1 ? "held the top spot" : "kept its spot"}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="dgrid">
        <div className="panel">
          <h3>
            {inDraft ? "Best available" : "Prospect rankings"}
            <span className="right">
              <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
                {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </span>
          </h3>
          <div className="row" style={{ gap: 4, marginBottom: 8 }}>
            {POSITIONS.map((x) => (
              <button key={x} className={`small${pos === x ? " primary" : ""}`} onClick={() => setPos(x)}>{x === "all" ? "All" : x}</button>
            ))}
          </div>
          <div className="muted small" style={{ marginBottom: 10 }}>
            <b>Now</b> is how good he is today; <b>Ceiling</b> is how good he could become. Ranges are your scouts' estimates. Scouting him (1 point, then 2) narrows them; two levels reveal the true numbers.
          </div>
          <div className="dlist">
            {list.slice(0, shown).map((p) => {
              const r = shownRatings(p);
              return (
                <div key={p.id} className="drow">
                  <span className="drank">{boardRank.get(p.id)}</span>
                  <div className="dwho">
                    <div className="dname"><PlayerName p={p} /></div>
                    <div className="small muted">{p.pos} · {p.age} · {p.nat} · {ARCHETYPES[p.type]?.name}</div>
                  </div>
                  <div className="dval">
                    <span className="dlab">Now</span>
                    <span className="dnumv">{range(ratingRange(p, "ovr"))}</span>
                  </div>
                  <div className="dval">
                    <span className="dlab">Ceiling</span>
                    <span className="dnumv"><span className={`ovr ${tierClass(r.pot)}`}>{range(ratingRange(p, "pot"))}</span></span>
                    <span className="dtier">{potentialTier(r.pot)}</span>
                  </div>
                  <div className="dact">
                    <span className="dscout" title={`Scouted ${p.scout.lvl} of 2`}>{"●".repeat(p.scout.lvl)}{"○".repeat(2 - p.scout.lvl)}</span>
                    <button className="tiny" disabled={!scoutCost(p) || user.scoutPts < scoutCost(p)} onClick={() => scout(p)}>
                      {scoutCost(p) ? `Scout (${scoutCost(p)})` : "Scouted"}
                    </button>
                    {inDraft && <button className="tiny primary" disabled={!onClock} onClick={() => draft(p)}>Draft</button>}
                  </div>
                </div>
              );
            })}
            {!list.length && <div className="dim small">No prospects left at this position.</div>}
          </div>
          {list.length > shown && (
            <div style={{ marginTop: 10 }}><button className="small" onClick={() => setShown(shown + 40)}>Show more ({list.length - shown} left)</button></div>
          )}
        </div>

        <div className="stack">
          {inDraft && (
            <div className="panel">
              <h3>Draft order</h3>
              <div className="row" style={{ gap: 4, marginBottom: 8 }}>
                {Array.from({ length: DRAFT_ROUNDS }, (_, i) => i + 1).map((r) => (
                  <button key={r} className={`small${round === r ? " primary" : ""}`} onClick={() => setRound(r)}>Round {r}</button>
                ))}
              </div>
              <div className="dorder">{league.draft.slots.filter((s) => s.round === round).map(slotLine)}</div>
            </div>
          )}
          <div className="panel">
            <h3>Your picks</h3>
            <div className="list">
              {myUpcoming.map((s) => (
                <div className="item small" key={s.overall}>
                  <b>#{s.overall}</b> round {s.round}{s.orig !== user.id ? ` (from ${league.teams[s.orig].abbr})` : ""}
                </div>
              ))}
              {futurePicks.map((pk) => <div className="item small" key={pk.id}>{pickLabel(league, pk)}</div>)}
              {!myUpcoming.length && !futurePicks.length && <div className="dim small">You don't own any picks.</div>}
            </div>
            {inDraft && league.draft.slots.some((s) => s.owner === user.id && s.pid) && (
              <>
                <div className="muted small" style={{ margin: "10px 0 4px" }}>Drafted</div>
                <div className="list">
                  {league.draft.slots.filter((s) => s.owner === user.id && s.pid).map((s) => {
                    const p = league.players[s.pid];
                    return (
                      <div className="item small" key={s.overall}>
                        <b>#{s.overall}</b> <PlayerName p={p} /> <span className="dim">{p.pos}</span>
                        <span className="muted" style={{ marginLeft: "auto" }}>{potentialTier(shownRatings(p).pot)}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
