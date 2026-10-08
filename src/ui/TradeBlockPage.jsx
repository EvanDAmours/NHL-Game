import React, { useState } from "react";
import { useGame, TeamBadge, Ovr, PlayerName, money } from "./common.jsx";
import { refreshBlock, toggleUserBlock, userOffers, acceptOffer, declineOffer, deadlineActive, fmtClock, DEADLINE_END } from "../engine/market.js";
import { tradingClosed } from "../engine/trade.js";
import { pickLabel } from "../engine/draft.js";
import { isGoalie, isDefense } from "../engine/constants.js";
import { dayToDate } from "../engine/schedule.js";

const grp = (p) => (isGoalie(p.pos) ? "G" : isDefense(p.pos) ? "D" : "F");
const LINKED_TIP = "Teams reported to be interested";

export function OfferCard({ o, compact = false }) {
  const { league, commit, toast, counterOffer } = useGame();
  const ai = league.teams[o.tid];
  const label = (id) => {
    const p = league.players[id];
    return p ? `${p.name} (${p.pos}, ${p.ovr}${p.yrs ? `, ${money(p.cap)}×${p.yrs}` : ""})` : "?";
  };
  const picks = (ids) => ids.map((id) => pickLabel(league, league.draftPicks.find((pk) => pk.id === id)));
  const accept = () => {
    const r = acceptOffer(league, o.id);
    toast(r.msg, 4500);
    commit();
  };
  const until = deadlineActive(league) ? `until ${fmtClock(Math.min(o.expMin ?? DEADLINE_END, DEADLINE_END))}` : `expires ${dayToDate(league.year, o.expDay)}`;
  return (
    <div className={`offercard${compact ? " compact" : ""}`}>
      <div className="row" style={{ gap: 8 }}>
        <TeamBadge team={ai} size={26} />
        <b>{ai.city} {ai.name}</b>
        {o.unsolicited && <span className="pill">called you</span>}
        <span className="muted small" style={{ marginLeft: "auto" }}>{until}</span>
      </div>
      <div className="offer-sides">
        <div><span className="dlab">You get</span>{[...o.get.map(label), ...picks(o.getPicks)].map((x) => <div key={x}>{x}</div>)}</div>
        <div><span className="dlab">You give</span>{[...o.give.map(label), ...picks(o.givePicks)].map((x) => <div key={x}>{x}</div>)}</div>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <button className="primary small" onClick={accept}>Accept</button>
        <button className="small" onClick={() => counterOffer(o)} title="Open this deal in the Trade Center to change it">Counter…</button>
        <button className="small ghost" onClick={() => { declineOffer(league, o.id); commit(); }}>Decline</button>
      </div>
    </div>
  );
}

export function WireItem({ w, showWhen = true }) {
  const { league } = useGame();
  const when = w.min != null ? fmtClock(w.min) : w.phase && w.phase !== "regular" ? `${w.year + 1} off-season` : dayToDate(w.year, w.day);
  if (w.kind === "trade" && w.a != null) {
    const A = league.teams[w.a];
    const B = league.teams[w.b];
    return (
      <div className={`wire trade${w.mine ? " mine" : ""}${w.big && !w.mine ? " big" : ""}`}>
        <div className="wire-h">
          <span className="wtag">{w.mine ? "YOUR TRADE" : w.big ? "BREAKING" : "TRADE"}</span>
          {showWhen && <span className="muted small">{when}</span>}
        </div>
        <div className="wire-sides">
          <div><div className="row" style={{ gap: 6 }}><TeamBadge team={A} size={20} /><b>{A.abbr} get</b></div>{w.aGets.map((x) => <div key={x} className="small">{x}</div>)}</div>
          <div><div className="row" style={{ gap: 6 }}><TeamBadge team={B} size={20} /><b>{B.abbr} get</b></div>{w.bGets.map((x) => <div key={x} className="small">{x}</div>)}</div>
        </div>
      </div>
    );
  }
  return (
    <div className={`wire ${w.kind}${w.talks ? " talks" : ""}`}>
      <span className="wtag">{w.kind === "rumor" ? (w.talks ? "TALKS" : "RUMOR") : w.kind === "offer" ? "OFFER" : w.kind === "done" ? "FINAL" : "NEWS"}</span>
      {showWhen && <span className="muted small">{when}</span>}
      <span>{w.text}</span>
    </div>
  );
}

export function BlockList({ entries, limit = 200 }) {
  const { league, proposeTradeFor } = useGame();
  return (
    <div className="blist">
      {entries.slice(0, limit).map((b) => {
        const p = league.players[b.pid];
        const t = league.teams[b.tid];
        if (!p || !t) return null;
        const mine = b.tid === league.userTid;
        const fresh = league.phase === "regular" && b.year === league.year && league.day - b.day <= 7;
        return (
          <div key={b.pid} className="brow">
            <TeamBadge team={t} size={30} />
            <div className="bwho">
              <div className="row" style={{ gap: 6 }}><PlayerName p={p} /> <Ovr v={p.ovr} src={p.src} />{fresh && <span className="pill new">NEW</span>}</div>
              <div className="small muted">{p.pos} · {p.age} · {money(p.cap)}{p.yrs ? ` × ${p.yrs} yr${p.yrs > 1 ? "s" : ""}` : ""} · {t.abbr}</div>
            </div>
            <div className="bwhy">
              <span className={`pill${b.reason === "Requested a trade" ? " hot" : ""}`}>{b.reason}</span>
              {b.interest?.length > 0 && <div className="tiny muted" title={LINKED_TIP}>Interested: {b.interest.map((tid) => league.teams[tid].abbr).join(" · ")}</div>}
            </div>
            {!mine && <button className="small" onClick={() => proposeTradeFor(p.id, t.id)} title="Open the Trade Center with him selected">Make offer</button>}
          </div>
        );
      })}
      {!entries.length && <div className="dim small">Nobody's on the block right now.</div>}
    </div>
  );
}

export default function TradeBlockPage() {
  const { league, commit, toast } = useGame();
  const [pos, setPos] = useState("all");
  const [add, setAdd] = useState("");
  const [all, setAll] = useState(false);
  const user = league.teams[league.userTid];
  if (!league.block) refreshBlock(league);
  const closed = tradingClosed(league);
  const inSeason = league.phase === "regular";
  const others = (league.block || [])
    .filter((b) => b.tid !== user.id && league.players[b.pid])
    .filter((b) => pos === "all" || grp(league.players[b.pid]) === pos)
    .sort((a, b) => league.players[b.pid].ovr - league.players[a.pid].ovr);
  // Only players who are still yours (a listed player may have been released or walked).
  const mine = (league.block || []).filter((b) => b.tid === user.id && league.players[b.pid]?.tid === user.id);
  const offers = userOffers(league);
  const roster = user.roster.map((id) => league.players[id]).filter((p) => p && !mine.some((b) => b.pid === p.id)).sort((a, b) => b.ovr - a.ovr);
  const wireItems = (league.wire || []).filter((w) => w.kind !== "offer").slice(0, 30);
  const callsText = closed
    ? league.phase === "playoffs"
      ? "Trading reopens after the playoffs."
      : "The deadline has passed; trading reopens after the playoffs."
    : inSeason
      ? "Interested teams will call, usually within a week or two."
      : "Teams can still call in the off-season, though less often than during the season.";

  return (
    <div className="stack">
      <div className="pagehead">
        <h2>Trade Block</h2>
        <span className="pill">{others.length} available</span>
        {offers.length > 0 && <span className="pill on">{offers.length} offer{offers.length > 1 ? "s" : ""} for you</span>}
        {inSeason && <span className="muted small">Deadline: {dayToDate(league.year, league.deadlineDay)}</span>}
      </div>
      {closed && <div className="notice warn">{league.phase === "playoffs" ? "Trading is closed during the playoffs." : "The trade deadline has passed. Trading reopens after the playoffs."}</div>}
      <div className="muted small">
        Teams shop players who don't fit their plans: veterans on clubs falling out of the race, pending free agents, cap casualties, extra goalies, healthy scratches, and players who've asked out. The list changes every week, "Interested" shows the teams reported to be calling, and deals happen around the league as the deadline gets closer.
      </div>

      {offers.length > 0 && (
        <div className="panel hot">
          <h3>📞 Offers for you</h3>
          <div className="offergrid">{offers.map((o) => <OfferCard key={o.id} o={o} />)}</div>
        </div>
      )}

      <div className="tbgrid">
        <div className="panel">
          <h3>
            Around the league
            <span className="right row" style={{ gap: 4 }}>
              {[["all", "All"], ["F", "Forwards"], ["D", "Defense"], ["G", "Goalies"]].map(([k, l]) => (
                <button key={k} className={`tiny${pos === k ? " primary" : ""}`} onClick={() => setPos(k)}>{l}</button>
              ))}
            </span>
          </h3>
          <BlockList entries={others} limit={all ? 500 : 12} />
          {others.length > 12 && (
            <button className="small ghost" style={{ marginTop: 8 }} onClick={() => setAll(!all)}>{all ? "Show the top 12" : `Show all ${others.length}`}</button>
          )}
        </div>

        <div className="stack">
          <div className="panel">
            <h3>Your block</h3>
            <div className="list">
              {mine.map((b) => {
                const p = league.players[b.pid];
                return (
                  <div className="item small" key={b.pid}>
                    <span className="posbadge">{p.pos}</span><PlayerName p={p} /> <Ovr v={p.ovr} />
                    {b.reason === "Requested a trade" && <span className="pill hot">asked out</span>}
                    <span className="tiny muted" title={LINKED_TIP}>{b.interest?.length ? `Interested: ${b.interest.map((t) => league.teams[t].abbr).join(", ")}` : "No interest yet"}</span>
                    <button className="tiny ghost" style={{ marginLeft: "auto" }} onClick={() => { toggleUserBlock(league, p.id); commit(); }}>Remove</button>
                  </div>
                );
              })}
              {!mine.length && <div className="dim small">You haven't listed anyone.</div>}
            </div>
            {!closed && (
              <>
                <div className="row" style={{ marginTop: 10 }}>
                  <select value={add} onChange={(e) => setAdd(e.target.value)} style={{ flex: 1, minWidth: 0 }} aria-label="Player to list">
                    <option value="">Choose a player to list…</option>
                    {roster.map((p) => <option key={p.id} value={p.id}>{p.ovr} · {p.name} ({p.pos}, {p.age})</option>)}
                  </select>
                  <button className="small" disabled={!add} onClick={() => { toggleUserBlock(league, add); setAdd(""); toast(`Listed. ${callsText}`); commit(); }}>List</button>
                </div>
                <div className="muted small" style={{ marginTop: 6 }}>{callsText}</div>
              </>
            )}
          </div>
          <div className="panel">
            <h3>Trade wire</h3>
            <div className="stack" style={{ gap: 6 }}>
              {wireItems.map((w, i) => <WireItem key={i} w={w} />)}
              {!wireItems.length && <div className="dim small">Quiet so far.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
