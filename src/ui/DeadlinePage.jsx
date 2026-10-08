import React, { useEffect, useState } from "react";
import { useGame, PlayerName } from "./common.jsx";
import { startDeadline, deadlineTick, userOffers, toggleUserBlock, onBlock, fmtClock, DEADLINE_START, DEADLINE_END } from "../engine/market.js";
import { dayToDate } from "../engine/schedule.js";
import { OfferCard, WireItem, BlockList } from "./TradeBlockPage.jsx";

// Trade Deadline Day: a broadcast-style desk with a running clock, a breaking-news
// feed of deals and rumours, offers for your players, and the best names still out there.
const RUN_MS = 1600; // real time per 10 minutes of deadline day while the clock runs

export default function DeadlinePage() {
  const { league, commit, go } = useGame();
  const [running, setRunning] = useState(false);
  if (league.phase === "regular" && league.day >= league.deadlineDay && (!league.deadline || league.deadline.year !== league.year)) startDeadline(league);
  const dl = league.deadline && league.deadline.year === league.year ? league.deadline : null;
  const done = !dl || dl.done;

  useEffect(() => {
    if (!running || done) return;
    const t = setInterval(() => {
      deadlineTick(league, 10);
      if (league.deadline.done) setRunning(false);
      commit();
    }, RUN_MS);
    return () => clearInterval(t);
  }, [running, done, league, commit]);

  if (!dl) {
    return (
      <div className="stack">
        <div className="pagehead"><h2>Trade Deadline</h2></div>
        <div className="panel muted">The deadline is {dayToDate(league.year, league.deadlineDay)}. When the season reaches it, the sim stops here for Deadline Day.</div>
      </div>
    );
  }

  const advance = (min) => {
    deadlineTick(league, min);
    commit();
  };
  const left = Math.max(0, DEADLINE_END - dl.minute);
  const pct = ((dl.minute - DEADLINE_START) / (DEADLINE_END - DEADLINE_START)) * 100;
  const offers = userOffers(league);
  const user = league.teams[league.userTid];
  const available = (league.block || []).filter((b) => b.tid !== user.id && league.players[b.pid]).sort((a, b) => league.players[b.pid].ovr - league.players[a.pid].ovr);
  const sellable = user.roster.map((id) => league.players[id]).filter((p) => p && p.age >= 24).sort((a, b) => b.ovr - a.ovr).slice(0, 10);
  const userTradesToday = (league.tradeHistory || []).filter((t) => t.year === league.year && t.day === league.day).length;

  return (
    <div className="stack">
      <div className={`dlhero${done ? " done" : ""}`}>
        <div className="dl-l">
          <div className="dl-k">{done ? "Deadline passed" : "Trade Deadline Day"}</div>
          <div className="dl-date">{dayToDate(league.year, league.day)}</div>
        </div>
        <div className="dl-c">
          <div className="dl-clock">{fmtClock(dl.minute)} <span>ET</span></div>
          <div className="dl-left">{done ? "Trading is closed until after the playoffs" : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} to the 3:00 PM deadline`}</div>
        </div>
        <div className="dl-r">
          <div className="dl-n">{dl.trades + userTradesToday}</div>
          <div className="dl-k">trades today</div>
        </div>
        <div className="dl-bar"><i style={{ width: `${Math.min(100, pct)}%` }} /></div>
      </div>

      <div className="row">
        {!done ? (
          <>
            <button className="primary" onClick={() => setRunning((r) => !r)}>{running ? "❚❚ Pause the clock" : "▶ Run the clock"}</button>
            <button onClick={() => advance(10)} disabled={running}>+10 min</button>
            <button onClick={() => advance(60)} disabled={running}>+1 hour</button>
            <button onClick={() => advance(DEADLINE_END - dl.minute)} disabled={running}>Skip to 3:00 PM</button>
            <span className="muted small">Make deals in the Trade Center any time before 3:00 PM. The clock only moves when you move it.</span>
          </>
        ) : (
          <button className="primary" onClick={() => go("dashboard")}>Back to the season →</button>
        )}
      </div>

      <div className="dlgrid">
        <div className="panel">
          <h3>Breaking</h3>
          <div className="stack dlfeed" style={{ gap: 8 }}>
            {dl.feed.map((w, i) => (
              <div key={dl.feed.length - i}>
                <WireItem w={w} />
              </div>
            ))}
          </div>
        </div>
        <div className="stack">
          {offers.length > 0 && (
            <div className="panel hot">
              <h3>Offers for you</h3>
              <div className="stack" style={{ gap: 8 }}>{offers.map((o) => <OfferCard key={o.id} o={o} compact />)}</div>
            </div>
          )}
          <div className="panel">
            <h3>Best available</h3>
            <BlockList entries={available} limit={12} />
          </div>
          {!done && (
            <div className="panel">
              <h3>Shop your players</h3>
              <div className="muted small" style={{ marginBottom: 6 }}>List a player and teams will call with offers as the day goes on.</div>
              <div className="list">
                {sellable.map((p) => (
                  <div className="item small" key={p.id}>
                    <span className="posbadge">{p.pos}</span>
                    <PlayerName p={p} />
                    <span className="dim">{p.ovr} · {p.age}y · {p.yrs <= 1 ? "UFA" : `${p.yrs} yrs`}</span>
                    <button className={`tiny${onBlock(league, p.id) ? " primary" : ""}`} style={{ marginLeft: "auto" }} onClick={() => { toggleUserBlock(league, p.id); commit(); }}>
                      {onBlock(league, p.id) ? "Listed" : "List"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
