// The trade market: a league-wide trade block that turns over every week, AI-to-AI
// trades built around it, offers for players the user lists, and Trade Deadline Day,
// a live, clock-driven frenzy of deals that ends at 3:00 PM ET.
import { isContending, assetValue, pickValue, evaluateTrade, executeTrade, tradingClosed } from "./trade.js";
import { lineupIds } from "./lines.js";
import { capSpace, counts, logTx, ensureMinimums } from "./roster.js";
import { chance, pick, shuffle, rand, randFloat, weighted } from "./rng.js";
import { MAX_ROSTER, isGoalie, isDefense } from "./constants.js";
import { pickLabel } from "./draft.js";

export const DEADLINE_START = 8 * 60; // 8:00 AM ET
export const DEADLINE_END = 15 * 60; // 3:00 PM ET
const TICK = 10; // minutes of deadline day per tick
const WIRE_MAX = 80;

const groupOf = (p) => (isGoalie(p.pos) ? "G" : isDefense(p.pos) ? "D" : "F");
const players = (league, ids) => ids.map((id) => league.players[id]).filter(Boolean);

export function fmtClock(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

function wire(league, item) {
  league.wire = league.wire || [];
  league.wire.unshift({ year: league.year, day: league.day, ...item });
  if (league.wire.length > WIRE_MAX) league.wire.length = WIRE_MAX;
  const dl = league.deadline;
  if (dl && dl.year === league.year && !dl.done && league.phase === "regular" && league.day >= league.deadlineDay) {
    dl.feed.unshift({ min: dl.minute, ...item });
  }
}

// ---------- Trade block ----------

function blockCandidates(league, t, deadline) {
  const roster = players(league, t.roster);
  const contending = isContending(league, t);
  const lineup = new Set(t.lines ? lineupIds(t.lines) : []);
  const out = [];
  const add = (p, reason, w) => out.push({ p, reason, w });
  // Early in the season everyone still thinks they're a contender.
  const selling = !contending && (deadline || t.rec.gp >= 15);
  // Franchise players aren't shopped unless they ask out.
  const cornerstones = new Set([...roster].sort((a, b) => b.ovr - a.ovr).slice(0, 2).map((p) => p.id));
  for (const p of roster) {
    if (p.wantsTrade) add(p, "Requested a trade", 200 + p.ovr);
    else if (cornerstones.has(p.id) || p.ovr >= 90) continue;
    else if (selling && p.age >= 27 && p.ovr >= 77 && p.yrs <= 1) add(p, "Pending UFA", 100 + p.ovr);
    else if (selling && p.age >= 29 && p.ovr >= 79 && p.yrs <= 3) add(p, "Rebuilding", 90 + p.ovr);
    else if (!lineup.has(p.id) && p.injury <= 0 && p.ovr >= 76 && p.age >= 24 && !isGoalie(p.pos)) add(p, "Wants a bigger role", 60 + p.ovr);
  }
  const goalies = roster.filter((p) => isGoalie(p.pos)).sort((a, b) => a.ovr - b.ovr);
  if (goalies.length >= 3) {
    const g = goalies.find((x) => !lineup.has(x.id) && !x.wantsTrade);
    if (g) add(g, "Surplus in goal", 70 + g.ovr);
  }
  if (capSpace(league, t) < 1) {
    const top = new Set([...roster].sort((a, b) => b.ovr - a.ovr).slice(0, 4).map((p) => p.id));
    const p = roster.filter((x) => !top.has(x.id) && x.cap >= 2.5 && x.ovr < 85).sort((a, b) => b.cap - a.cap)[0];
    if (p) add(p, "Cap crunch", 80 + p.ovr);
  }
  return out.sort((a, b) => b.w - a.w);
}

// Teams likely to call about a player: contenders (or anyone, at the deadline) who
// can fit him and would put him in their lineup.
export function interestedTeams(league, pid, { limit = 3 } = {}) {
  const p = league.players[pid];
  if (!p) return [];
  const grp = groupOf(p);
  const scored = [];
  for (const t of league.teams) {
    if (t.id === p.tid || t.id === league.userTid) continue;
    const contending = isContending(league, t);
    if (!contending && p.age >= 28) continue;
    if (capSpace(league, t) < p.cap - 3) continue;
    const mates = players(league, t.lines ? lineupIds(t.lines) : t.roster).filter((x) => groupOf(x) === grp);
    const n = grp === "F" ? 6 : grp === "D" ? 4 : 1; // top six / top four / starter
    const bar = mates.sort((a, b) => b.ovr - a.ovr).slice(0, n);
    const ref = bar.length ? bar[bar.length - 1].ovr : 70;
    const fit = p.ovr - ref + (contending ? 3 : -2) + randFloat(-2, 2) - (grp === "G" ? 4 : 0) - 1.5 * tradesThisSeason(league, t);
    if (fit > 0) scored.push({ tid: t.id, fit });
  }
  return scored.sort((a, b) => b.fit - a.fit).slice(0, limit).map((x) => x.tid);
}

export function refreshBlock(league, { deadline = false } = {}) {
  league.block = league.block || [];
  if (tradingClosed(league)) {
    league.block = league.block.filter((b) => b.tid === league.userTid);
    return league.block;
  }
  league.block = league.block.filter((b) => {
    const p = league.players[b.pid];
    if (!p || p.tid !== b.tid) return false;
    if (b.tid === league.userTid || p.wantsTrade) return true;
    // Names come and go: older listings drop off.
    return league.day - b.day < 28 || (b.year === league.year && chance(0.4));
  });
  const listed = new Set(league.block.map((b) => b.pid));
  for (const t of league.teams) {
    if (t.id === league.userTid) continue;
    const cap = deadline ? 3 : 2;
    let have = league.block.filter((b) => b.tid === t.id).length;
    for (const c of blockCandidates(league, t, deadline)) {
      if (have >= cap) break;
      if (listed.has(c.p.id)) continue;
      if (!deadline && c.reason !== "Requested a trade" && !chance(0.55)) continue;
      league.block.push({ pid: c.p.id, tid: t.id, reason: c.reason, day: league.day, year: league.year });
      listed.add(c.p.id);
      have++;
    }
  }
  for (const b of league.block) b.interest = interestedTeams(league, b.pid);
  return league.block;
}

export function onBlock(league, pid) {
  return (league.block || []).some((b) => b.pid === pid);
}

export function toggleUserBlock(league, pid) {
  const p = league.players[pid];
  if (!p || p.tid !== league.userTid) return false;
  league.block = league.block || [];
  if (onBlock(league, pid)) {
    league.block = league.block.filter((b) => b.pid !== pid);
    league.offers = (league.offers || []).filter((o) => !o.give.includes(pid));
    return false;
  }
  league.block.push({ pid, tid: league.userTid, reason: "Listed by you", day: league.day, year: league.year, interest: interestedTeams(league, pid) });
  return true;
}

// ---------- Building packages ----------

// What `buyer` could send to `seller` for player `pid`: the seller values youth and picks
// when rebuilding, roster players when contending. Returns asset lists or null.
// Assets are valued by `valuer` (the team that has to accept: the seller in AI deals,
// the buyer itself when it's making an offer to the user).
function buildPackage(league, buyer, seller, pid, { target, max = 3, under = false, valuer = seller }) {
  const sellerContending = isContending(league, seller);
  const valuerContending = isContending(league, valuer);
  const core = new Set(players(league, buyer.roster).sort((a, b) => b.ovr - a.ovr).slice(0, 5).map((p) => p.id));
  if (buyer.lines) buyer.lines.G.forEach((id) => id && core.add(id));
  const p = league.players[pid];
  const assets = [];
  for (const id of buyer.prospects) {
    const v = assetValue(league, id, valuer);
    if (v > 0.25) assets.push({ kind: "p", id, v });
  }
  for (const id of buyer.roster) {
    if (core.has(id)) continue;
    const q = league.players[id];
    // A rebuilding team doesn't want older players back; same-position swaps are easiest.
    if (!sellerContending && q.age >= 28) continue;
    const v = assetValue(league, id, valuer) * (groupOf(q) === groupOf(p) ? 1 : 0.9);
    if (v > 0.4) assets.push({ kind: "p", id, v });
  }
  for (const pk of league.draftPicks) {
    if (pk.owner !== buyer.id || pk.year <= league.year) continue;
    assets.push({ kind: "pick", id: pk.id, v: pickValue(league, pk, { contending: valuerContending }) });
  }
  const chosen = [];
  let total = 0;
  if (under) {
    // Offer as much as possible without going over `target`.
    for (const a of [...assets].sort((x, y) => y.v - x.v)) {
      if (chosen.length >= max) break;
      if (total + a.v <= target) { chosen.push(a); total += a.v; }
    }
    if (total < target * 0.55) return null;
  } else {
    while (total < target && chosen.length < max) {
      const left = assets.filter((a) => !chosen.includes(a));
      const need = target - total;
      const next = left.filter((a) => a.v >= need).sort((x, y) => x.v - y.v)[0] || left.sort((x, y) => y.v - x.v)[0];
      if (!next) break;
      chosen.push(next);
      total += next.v;
    }
    if (total < target || total > target * 1.6) return null;
  }
  return {
    ids: chosen.filter((a) => a.kind === "p").map((a) => a.id),
    picks: chosen.filter((a) => a.kind === "pick").map((a) => a.id),
    total,
  };
}

function assetLabel(league, id, kind) {
  if (kind === "pick") return pickLabel(league, league.draftPicks.find((pk) => pk.id === id));
  const p = league.players[id];
  return p ? `${p.name} (${p.pos}, ${p.ovr})` : "?";
}

// AI GMs make a handful of moves a season, not a dozen.
const SEASON_TRADE_LIMIT = 4;
const DEADLINE_DAY_LIMIT = 2;
function tradesThisSeason(league, t) {
  return t.trades?.year === league.year ? t.trades.n : 0;
}
function tooBusy(league, t) {
  if (tradesThisSeason(league, t) >= SEASON_TRADE_LIMIT) return true;
  return deadlineActive(league) && t.trades?.year === league.year && (t.trades.dl || 0) >= DEADLINE_DAY_LIMIT;
}
function countTrade(league, t) {
  const same = t.trades?.year === league.year;
  t.trades = { year: league.year, n: tradesThisSeason(league, t) + 1, dl: (same ? t.trades.dl || 0 : 0) + (deadlineActive(league) ? 1 : 0) };
}

// Keep rosters legal after a trade: extras go to the minors; short teams call up.
export function fitRoster(league, t) {
  let guard = 0;
  while (counts(league, t).active > MAX_ROSTER && guard++ < 6) {
    const lineup = new Set(t.lines ? lineupIds(t.lines) : []);
    // Never send down someone needed to dress a full lineup (e.g. the emergency goalie).
    const healthy = counts(league, t, { healthyOnly: true });
    const spare = (p) => p.injury > 0 || (groupOf(p) === "G" ? healthy.G > 2 : groupOf(p) === "D" ? healthy.D > 6 : healthy.F > 12);
    const extra = players(league, t.roster).filter((p) => !lineup.has(p.id) && p.injury < 7 && spare(p)).sort((a, b) => a.ovr - b.ovr)[0];
    if (!extra) break;
    t.roster = t.roster.filter((x) => x !== extra.id);
    t.prospects.push(extra.id);
  }
  ensureMinimums(league, t);
}

// Try to move a block player from one AI team to another. Returns a description or null.
function aiTradeFor(league, entry) {
  const seller = league.teams[entry.tid];
  const p = league.players[entry.pid];
  if (!seller || !p || p.tid !== seller.id || seller.id === league.userTid) return null;
  if (tooBusy(league, seller)) return null;
  const buyers = shuffle([...(entry.interest?.length ? entry.interest : interestedTeams(league, p.id))]);
  for (const bid of buyers) {
    const buyer = league.teams[bid];
    if (!buyer || buyer.id === league.userTid || buyer.id === seller.id) continue;
    if (tooBusy(league, buyer)) continue;
    const want = assetValue(league, p.id, seller) * (p.wantsTrade ? 0.85 : 1.02);
    const pkg = buildPackage(league, buyer, seller, p.id, { target: want });
    if (!pkg) continue;
    // The buyer has to like it too.
    const buyerContending = isContending(league, buyer);
    const worth = assetValue(league, p.id, buyer);
    const cost = pkg.ids.reduce((s, id) => s + assetValue(league, id, buyer), 0) + pkg.picks.reduce((s, id) => s + pickValue(league, league.draftPicks.find((pk) => pk.id === id), { contending: buyerContending }), 0);
    if (worth < cost * 0.85) continue;
    const offer = { from: buyer.id, to: seller.id, give: pkg.ids, givePicks: pkg.picks, get: [p.id], getPicks: [], margin: 1 };
    // Leave a little cap room for call-ups.
    const outCap = pkg.ids.reduce((s, id) => s + (buyer.roster.includes(id) ? league.players[id].cap : 0), 0);
    if (capSpace(league, buyer) + outCap - p.cap < 0.75) continue;
    if (!evaluateTrade(league, offer).accept) continue;
    const gets = [...pkg.ids.map((id) => assetLabel(league, id, "p")), ...pkg.picks.map((id) => assetLabel(league, id, "pick"))];
    executeTrade(league, offer, { record: false });
    countTrade(league, buyer);
    countTrade(league, seller);
    fitRoster(league, buyer);
    fitRoster(league, seller);
    const text = `${buyer.city} acquire ${p.name} (${p.pos}, ${p.ovr}) from ${seller.city} for ${gets.join(", ")}.`;
    wire(league, { kind: "trade", text, tids: [buyer.id, seller.id], a: buyer.id, b: seller.id, aGets: [`${p.name} (${p.pos}, ${p.ovr})`], bGets: gets });
    return text;
  }
  return null;
}

// ---------- Offers to the user ----------

function offerFor(league, pid, { unsolicited = false, expMin = null } = {}) {
  const user = league.teams[league.userTid];
  const p = league.players[pid];
  if (!p || p.tid !== user.id) return null;
  const taken = new Set((league.offers || []).filter((o) => o.give.includes(pid)).map((o) => o.tid));
  const buyers = interestedTeams(league, pid, { limit: 4 }).filter((tid) => !taken.has(tid));
  for (const bid of shuffle(buyers)) {
    const buyer = league.teams[bid];
    const margin = 1.05;
    // AI GMs open a little under what they'd actually pay.
    const target = (assetValue(league, pid, buyer) / margin) * randFloat(0.82, 0.98);
    const pkg = buildPackage(league, buyer, user, pid, { target, under: true, valuer: buyer });
    if (!pkg || (!pkg.ids.length && !pkg.picks.length)) continue;
    const offer = { from: user.id, to: buyer.id, give: [pid], givePicks: [], get: pkg.ids, getPicks: pkg.picks };
    if (!evaluateTrade(league, offer).accept) continue;
    const o = {
      id: `o${Date.now().toString(36)}${Math.floor(rand() * 1e6).toString(36)}`,
      tid: buyer.id,
      ...offer,
      day: league.day,
      expDay: league.day + 5,
      expMin,
      unsolicited,
    };
    league.offers = league.offers || [];
    league.offers.push(o);
    const what = [...pkg.ids.map((id) => assetLabel(league, id, "p")), ...pkg.picks.map((id) => assetLabel(league, id, "pick"))].join(", ");
    const text = `${buyer.city} offer ${what} for your ${p.name}.`;
    if (!deadlineActive(league)) league.inbox.push({ year: league.year, day: league.day, text: `Trade offer: ${text} See the Trade Block.` });
    wire(league, { kind: "offer", text, tids: [buyer.id, user.id], offerId: o.id });
    return o;
  }
  return null;
}

export function userOffers(league) {
  return (league.offers || []).filter((o) => offerValid(league, o));
}

function offerValid(league, o) {
  if (tradingClosed(league)) return false;
  if (league.day > o.expDay) return false;
  const dl = league.deadline;
  if (o.expMin != null && dl && dl.year === league.year && !dl.done && dl.minute > o.expMin) return false;
  const user = league.teams[league.userTid];
  const ai = league.teams[o.tid];
  return o.give.every((id) => league.players[id]?.tid === user.id) && o.get.every((id) => league.players[id]?.tid === ai.id) && o.getPicks.every((id) => league.draftPicks.some((pk) => pk.id === id && pk.owner === ai.id));
}

export function acceptOffer(league, offerId) {
  const o = (league.offers || []).find((x) => x.id === offerId);
  if (!o || !offerValid(league, o)) return { ok: false, msg: "That offer is no longer on the table." };
  const ev = evaluateTrade(league, o);
  if (!ev.accept) return { ok: false, msg: ev.problems[0] || "They've cooled on the deal." };
  const r = executeTrade(league, o);
  league.offers = league.offers.filter((x) => x.id !== offerId && x.give.every((id) => !o.give.includes(id)));
  fitRoster(league, league.teams[o.tid]);
  const ai = league.teams[o.tid];
  wire(league, { kind: "trade", text: `${ai.city} acquire ${r.aSends} from your club for ${r.bSends}.`, tids: [ai.id, league.userTid], a: ai.id, b: league.userTid, aGets: [r.aSends], bGets: [r.bSends], mine: true });
  return { ok: true, msg: `Trade done: you get ${r.bSends}.` };
}

// Trades the user makes in the Trade Center also hit the wire (and the deadline feed).
export function noteUserTrade(league, offer, r) {
  const ai = league.teams[offer.to];
  wire(league, { kind: "trade", text: `${ai.city} acquire ${r.aSends} from your club for ${r.bSends}.`, tids: [ai.id, league.userTid], a: ai.id, b: league.userTid, aGets: [r.aSends], bGets: [r.bSends], mine: true });
}

export function declineOffer(league, offerId) {
  league.offers = (league.offers || []).filter((x) => x.id !== offerId);
}

// ---------- Weekly market ----------

export function marketWeek(league) {
  if (league.phase !== "regular" || tradingClosed(league)) return;
  league.offers = (league.offers || []).filter((o) => offerValid(league, o));
  refreshBlock(league);
  // Activity builds toward the deadline.
  const pace = Math.min(1, league.day / Math.max(1, league.deadlineDay));
  for (const b of shuffle([...league.block])) {
    if (b.tid === league.userTid) continue;
    if (chance(0.008 + 0.035 * pace * pace)) aiTradeFor(league, b);
  }
  for (const b of league.block.filter((x) => x.tid === league.userTid)) if (chance(0.6)) offerFor(league, b.pid);
  // A rumour or two for the wire.
  const pool = league.block.filter((b) => b.tid !== league.userTid && b.interest?.length);
  if (pool.length && chance(0.7)) rumor(league, pick(pool));
}

function rumor(league, b) {
  const p = league.players[b.pid];
  const team = league.teams[b.tid];
  if (!p || !team) return;
  const names = b.interest.map((tid) => league.teams[tid].city);
  const lines = [
    `${names[0]} among the teams checking in on ${team.city}'s ${p.name}.`,
    `${p.name} (${p.pos}, ${p.ovr}) drawing interest from ${names.slice(0, 2).join(" and ")}.`,
    `Sources: ${team.city} listening on ${p.name}. ${names[0]} ${names.length > 1 ? "and " + names[1] + " have" : "has"} called.`,
    `${team.city} asking price on ${p.name} said to be high; ${names[0]} remain in the mix.`,
  ];
  wire(league, { kind: "rumor", text: pick(lines), tids: [team.id, ...b.interest] });
}

// ---------- Trade Deadline Day ----------

export function deadlinePending(league) {
  if (league.phase !== "regular" || league.day < league.deadlineDay) return false;
  const dl = league.deadline;
  return !(dl && dl.year === league.year && dl.done);
}

export function deadlineActive(league) {
  const dl = league.deadline;
  return !!dl && dl.year === league.year && !dl.done && league.phase === "regular";
}

export function startDeadline(league) {
  if (league.deadline && league.deadline.year === league.year) return league.deadline;
  league.deadline = { year: league.year, minute: DEADLINE_START, done: false, feed: [], trades: 0 };
  refreshBlock(league, { deadline: true });
  const top = league.block.filter((b) => b.tid !== league.userTid).map((b) => league.players[b.pid]).filter(Boolean).sort((a, b) => b.ovr - a.ovr).slice(0, 3);
  league.deadline.feed.unshift({ min: DEADLINE_START, kind: "info", text: `It's Trade Deadline Day! Teams have until 3:00 PM ET to make deals.${top.length ? ` Biggest names available: ${top.map((p) => p.name).join(", ")}.` : ""}` });
  return league.deadline;
}

// Advance the deadline-day clock. Deals come faster as 3:00 PM approaches.
export function deadlineTick(league, minutes = TICK) {
  const dl = league.deadline;
  if (!dl || dl.done) return dl;
  for (let m = 0; m < minutes && !dl.done; m += TICK) {
    dl.minute += TICK;
    const progress = (dl.minute - DEADLINE_START) / (DEADLINE_END - DEADLINE_START);
    if (dl.minute % 60 === 0) refreshInterest(league);
    // Phones ring all day; the last hour is a scramble.
    const pTrade = 0.22 + 0.45 * progress * progress + (progress > 0.86 ? 0.6 : 0);
    for (let tries = progress > 0.86 ? 3 : 1; tries > 0; tries--) {
      if (!chance(Math.min(0.95, pTrade))) continue;
      const pool = league.block.filter((b) => b.tid !== league.userTid);
      const b = pool.length && weighted(pool, (x) => Math.exp(((league.players[x.pid]?.ovr || 70) - 75) / 5));
      if (b && aiTradeFor(league, b)) dl.trades++;
    }
    if (chance(0.25)) {
      const pool = league.block.filter((b) => b.tid !== league.userTid && b.interest?.length);
      if (pool.length) rumor(league, pick(pool));
    }
    const mine = league.block.filter((b) => b.tid === league.userTid);
    if (mine.length && chance(0.12 + 0.05 * mine.length)) offerFor(league, pick(mine).pid, { expMin: dl.minute + 60 });
    // Contenders also call about your pending free agents.
    if (chance(0.05)) {
      const user = league.teams[league.userTid];
      const vets = players(league, user.roster).filter((p) => p.age >= 27 && p.yrs <= 1 && p.ovr >= 78 && !onBlock(league, p.id));
      if (vets.length) offerFor(league, pick(vets).id, { unsolicited: true, expMin: dl.minute + 60 });
    }
    if (dl.minute >= DEADLINE_END) {
      dl.done = true;
      const n = dl.trades + (league.tradeHistory || []).filter((t) => t.year === league.year && t.day === league.day).length;
      dl.feed.unshift({ min: dl.minute, kind: "done", text: `3:00 PM — the trade deadline has passed. ${n} trade${n === 1 ? "" : "s"} today.` });
      logTx(league, `Trade deadline passed (${n} trades on deadline day)`);
      league.offers = [];
      league.block = (league.block || []).filter((b) => b.tid === league.userTid);
    }
  }
  return dl;
}

function refreshInterest(league) {
  for (const b of league.block || []) b.interest = interestedTeams(league, b.pid);
}

export function skipDeadline(league) {
  startDeadline(league);
  while (!league.deadline.done) deadlineTick(league);
}
