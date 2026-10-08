import React, { useEffect, useRef, useState } from "react";
import { useGame, PlayerName, TeamBadge, money } from "./common.jsx";
import { startDeadline, deadlineTick, deadlinePending, userOffers, toggleUserBlock, onBlock, fmtClock, marketStance, DEADLINE_START, DEADLINE_END } from "../engine/market.js";
import { dayToDate } from "../engine/schedule.js";
import { OfferCard, WireItem, BlockList } from "./TradeBlockPage.jsx";

// Trade Deadline Day: a broadcast-style desk with a running clock, a breaking-news
// feed of deals and rumours, offers for your players, buyers and sellers, and the best
// names still out there.
const QUIET_MS = 750; // real time per 10 minutes of deadline day when nothing happened
const BUSY_MS = 1700; // ...and after a tick that produced a trade, so it can be read

// A scrolling news ticker under the top bar while the deadline clock is live.
export function DeadlineTicker({ league, onOpen }) {
  const dl = league.deadline;
  if (!dl) return null;
  const items = dl.feed.filter((f) => f.kind === "trade").slice(0, 10);
  const text = items.length ? items.map((f) => `${f.big ? "BREAKING: " : ""}${f.short || f.text}`).join("   •   ") : "Trade Deadline Day: phones are ringing around the league…";
  return (
    <button type="button" className="ticker" onClick={onOpen} title="Open the deadline desk">
      <span className="ticker-k">⏰ {fmtClock(dl.minute)} ET</span>
      <span className="ticker-win">
        <span className="ticker-track" key={items.length}>{text}</span>
      </span>
    </button>
  );
}

function Stance({ league }) {
  const { buyers, sellers } = marketStance(league);
  const row = (r) => (
    <div key={r.t.id} className={`strow${r.movesLeft === 0 ? " spent" : ""}`} title={r.movesLeft === 0 ? "Out of deadline-day moves" : undefined}>
      <TeamBadge team={r.t} size={20} />
      <b>{r.t.abbr}</b>
      <span className="muted">{r.gap > 0 ? `+${r.gap}` : r.gap} pts</span>
      <span className="muted">{money(r.cap)}</span>
      <span className="muted">{r.movesLeft == null ? "you" : `${r.movesLeft} move${r.movesLeft === 1 ? "" : "s"}`}</span>
    </div>
  );
  return (
    <div className="panel">
      <h3>Buyers & sellers</h3>
      <div className="muted small" style={{ marginBottom: 8 }}>Points above or below the 8th playoff spot in each conference, cap room, and deadline-day moves left (each team gets two).</div>
      <div className="stance">
        <div><div className="dlab">Buyers</div>{buyers.map(row)}</div>
        <div><div className="dlab">Sellers</div>{sellers.map(row)}</div>
      </div>
    </div>
  );
}

export default function DeadlinePage() {
  const { league, commit, go, toast, save } = useGame();
  const [running, setRunning] = useState(false);
  const [tradesOnly, setTradesOnly] = useState(false);
  const [shopAll, setShopAll] = useState(false);
  const timer = useRef(null);
  const dl = league.deadline && league.deadline.year === league.year ? league.deadline : null;
  const done = !dl || dl.done;

  // Opened straight from the nav: start the day (and save that it started).
  useEffect(() => {
    if (deadlinePending(league) && !dl) {
      startDeadline(league);
      commit();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The running clock: quick through quiet stretches, slower after a trade, and it stops
  // when a team calls about one of your players. Saves are batched while it runs.
  useEffect(() => {
    if (!running || done) return;
    const step = () => {
      const before = new Set(userOffers(league).map((o) => o.id));
      const trades = league.deadline.trades;
      deadlineTick(league, 10);
      const fresh = userOffers(league).filter((o) => !before.has(o.id));
      commit(30000);
      if (league.deadline.done) {
        setRunning(false);
        save();
        return;
      }
      if (fresh.length) {
        const o = fresh[0];
        setRunning(false);
        save();
        toast(`📞 ${league.teams[o.tid].city} ${league.teams[o.tid].name} are calling about ${league.players[o.give[0]]?.name}. The clock is paused.`, 5000);
        return;
      }
      timer.current = setTimeout(step, league.deadline.trades > trades ? BUSY_MS : QUIET_MS);
    };
    timer.current = setTimeout(step, QUIET_MS);
    return () => {
      clearTimeout(timer.current);
      save();
    };
  }, [running, done]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const day = dl.day ?? league.deadlineDay;
  const available = (league.block || []).filter((b) => b.tid !== user.id && league.players[b.pid]).sort((a, b) => league.players[b.pid].ovr - league.players[a.pid].ovr);
  const sellable = user.roster.map((id) => league.players[id]).filter(Boolean).sort((a, b) => b.ovr - a.ovr);
  const userTrades = (league.tradeHistory || []).filter((t) => t.year === league.year && t.day === day).length;
  const total = dl.total ?? dl.feed.filter((f) => f.kind === "trade").length;
  const feed = tradesOnly ? dl.feed.filter((f) => f.kind === "trade" || f.kind === "done") : dl.feed;

  return (
    <div className="stack">
      <div className={`dlhero${done ? " done" : ""}`}>
        <div className="dl-l">
          <div className="dl-k">{done ? "Deadline passed" : "Trade Deadline Day"}</div>
          <div className="dl-date">{dayToDate(league.year, day)}</div>
        </div>
        <div className="dl-c">
          <div className="dl-clock">{fmtClock(dl.minute)} <span>ET</span></div>
          <div className="dl-left">{done ? "Trading is closed until after the playoffs" : `${Math.floor(left / 60)}h ${String(left % 60).padStart(2, "0")}m left until the 3:00 PM deadline`}</div>
        </div>
        <div className="dl-r">
          <div className="dl-n">{total}</div>
          <div className="dl-k">trades{userTrades ? ` · ${userTrades} yours` : ""}</div>
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
            <button onClick={() => { setRunning(false); go("trade"); }}>Open the Trade Center</button>
            <span className="muted small">Time only moves when you move it. The clock pauses when a team calls you.</span>
          </>
        ) : (
          <button className="primary" onClick={() => go("dashboard")}>Back to the season →</button>
        )}
      </div>

      {offers.length > 0 && (
        <div className="panel hot">
          <h3>📞 Offers for you <span className="right muted small">They're good until the time shown; every offer ends at 3:00 PM.</span></h3>
          <div className="offergrid">{offers.map((o) => <OfferCard key={o.id} o={o} compact />)}</div>
        </div>
      )}

      <div className="dlgrid">
        <div className="panel">
          <h3>
            {tradesOnly ? "Trade tracker" : "Breaking"}
            <span className="right row" style={{ gap: 4 }}>
              <button className={`tiny${!tradesOnly ? " primary" : ""}`} onClick={() => setTradesOnly(false)}>Everything</button>
              <button className={`tiny${tradesOnly ? " primary" : ""}`} onClick={() => setTradesOnly(true)}>Trades only</button>
            </span>
          </h3>
          <div className="stack dlfeed" style={{ gap: 8 }}>
            {feed.map((w) => (
              <div key={`${dl.feed.length - dl.feed.indexOf(w)}`}>
                <WireItem w={w} />
              </div>
            ))}
            {!feed.length && <div className="dim small">{dl.synthetic ? "This deadline passed before the deadline desk existed, so there's no feed for it." : "Nothing yet."}</div>}
          </div>
        </div>
        <div className="stack">
          {!done && (
            <div className="panel">
              <h3>Best available</h3>
              <BlockList entries={available} limit={12} />
            </div>
          )}
          <Stance league={league} />
          {!done && (
            <div className="panel">
              <h3>Shop your players</h3>
              <div className="muted small" style={{ marginBottom: 6 }}>List a player and interested teams will call with offers as the day goes on.</div>
              <div className="list">
                {(shopAll ? sellable : sellable.slice(0, 12)).map((p) => (
                  <div className="item small" key={p.id}>
                    <span className="posbadge">{p.pos}</span>
                    <PlayerName p={p} />
                    <span className="muted">{p.ovr} · {p.age}y · {p.yrs <= 1 ? "expiring" : `${p.yrs} yrs`}</span>
                    <button className={`tiny${onBlock(league, p.id) ? " primary" : ""}`} style={{ marginLeft: "auto" }} onClick={() => { toggleUserBlock(league, p.id); commit(); }} title={onBlock(league, p.id) ? "Take him off the block" : "Put him on the block"}>
                      {onBlock(league, p.id) ? "Listed ✓" : "List"}
                    </button>
                  </div>
                ))}
              </div>
              {sellable.length > 12 && <button className="small ghost" style={{ marginTop: 6 }} onClick={() => setShopAll(!shopAll)}>{shopAll ? "Show fewer" : `Show all ${sellable.length}`}</button>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
