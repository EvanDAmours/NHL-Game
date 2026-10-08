// The trade market: a league-wide trade block that turns over every week, AI-to-AI
// trades built around it, offers for players the user lists, and Trade Deadline Day,
// a live, clock-driven frenzy of deals (talks reported first, then done) that ends at
// 3:00 PM ET with a recap.
import { isContending, assetValue, pickValue, evaluateTrade, executeTrade, tradingClosed } from "./trade.js";
import { lineupIds } from "./lines.js";
import { capSpace, counts, logTx, ensureMinimums, canSendDown, sendDown, releasePlayer } from "./roster.js";
import { chance, pick, shuffle, rand, randFloat, randInt, weighted } from "./rng.js";
import { MAX_ROSTER, MIN_FORWARDS, MIN_DEFENSE, MIN_GOALIES, isGoalie, isDefense } from "./constants.js";
import { isRFA } from "./players.js";
import { pickLabel } from "./draft.js";
import { conferenceTable } from "./standings.js";

export const DEADLINE_START = 8 * 60; // 8:00 AM ET
export const DEADLINE_END = 15 * 60; // 3:00 PM ET
const TICK = 10; // minutes of deadline day per tick
const WIRE_MAX = 80;
const SELLER_REASONS = new Set(["Pending UFA", "Rebuilding"]);
const MINIMUM = { F: MIN_FORWARDS, D: MIN_DEFENSE, G: MIN_GOALIES };

const groupOf = (p) => (isGoalie(p.pos) ? "G" : isDefense(p.pos) ? "D" : "F");
const players = (league, ids) => ids.map((id) => league.players[id]).filter(Boolean);

export function fmtClock(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

// "Toronto", but "NY Rangers" / "NY Islanders" where two clubs share a city.
export function place(league, t) {
  if (!t) return "?";
  const shared = league.teams.some((x) => x.id !== t.id && x.city === t.city);
  return shared ? `${t.city === "New York" ? "NY" : t.city} ${t.name}` : t.city;
}

const poss = (name) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

function wire(league, item) {
  league.wire = league.wire || [];
  league.wire.unshift({ year: league.year, day: league.day, phase: league.phase, ...item });
  if (league.wire.length > WIRE_MAX) league.wire.length = WIRE_MAX;
  if (deadlineActive(league) && league.day >= league.deadlineDay) league.deadline.feed.unshift({ min: league.deadline.minute, ...item });
}

// Stable per-player, per-team noise, so the teams linked to a player don't reshuffle
// randomly every week; they change when rosters, cap room or standings change.
function jitter(pid, tid, year) {
  let h = 2166136261;
  for (const ch of `${pid}|${tid}|${year}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) / 4294967295) * 4 - 2;
}

function assetLabel(league, id, kind) {
  if (kind === "pick") return pickLabel(league, league.draftPicks.find((pk) => pk.id === id));
  const p = league.players[id];
  if (!p) return "?";
  const term = p.signed !== false && p.yrs <= 1 ? (isRFA(p) ? ", RFA" : ", UFA") : "";
  return `${p.name} (${p.pos}, ${p.ovr}${term})`;
}

function labels(league, ids = [], picks = []) {
  return [...ids.map((id) => assetLabel(league, id, "p")), ...picks.map((id) => assetLabel(league, id, "pick"))];
}

// A deal worth a red BREAKING banner: a star, or two first-round picks going the other way.
function isBlockbuster(league, starOvr, picks) {
  const firsts = picks.filter((id) => league.draftPicks.find((pk) => pk.id === id)?.round === 1).length;
  return starOvr >= 85 || firsts >= 2;
}

// ---------- Trade block ----------

function blockCandidates(league, t, deadline) {
  const roster = players(league, t.roster);
  const contending = isContending(league, t);
  const lineup = new Set(t.lines ? lineupIds(t.lines) : []);
  const inSeason = league.phase === "regular";
  const out = [];
  const add = (p, reason, w) => out.push({ p, reason, w });
  // Early in the season (and in preseason) everyone still thinks they're a contender;
  // after the playoffs, clubs that missed are open to moving veterans with term.
  const selling = !contending && (deadline || (inSeason ? t.rec.gp >= 15 : league.phase !== "preseason"));
  // Franchise players aren't shopped unless they ask out.
  const cornerstones = new Set([...roster].sort((a, b) => b.ovr - a.ovr).slice(0, 2).map((p) => p.id));
  for (const p of roster) {
    if (p.wantsTrade) add(p, "Requested a trade", 200 + p.ovr);
    else if (cornerstones.has(p.id) || p.ovr >= 90) continue;
    else if (inSeason && selling && p.age >= 27 && p.ovr >= 77 && p.yrs <= 1) add(p, "Pending UFA", 100 + p.ovr);
    else if (selling && p.age >= 29 && p.ovr >= 79 && p.yrs <= 3 && (inSeason || p.yrs >= 2)) add(p, "Rebuilding", 90 + p.ovr);
    else if (inSeason && (deadline || t.rec.gp >= 10) && !lineup.has(p.id) && p.injury <= 0 && p.ovr >= 76 && p.age >= 24 && !isGoalie(p.pos)) add(p, "Wants a bigger role", 60 + p.ovr);
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

// Teams likely to call about a player: contenders (or anyone, for younger players) who
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
    const fit = p.ovr - ref + (contending ? 3 : -2) + jitter(pid, t.id, league.year) - (grp === "G" ? 4 : 0) - 1.5 * tradesThisSeason(league, t);
    if (fit > 0) scored.push({ tid: t.id, fit });
  }
  return scored.sort((a, b) => b.fit - a.fit).slice(0, limit).map((x) => x.tid);
}

// Turn the block over. Returns the entries added this time.
export function refreshBlock(league, { deadline = false } = {}) {
  league.block = league.block || [];
  const stillMine = (b) => b.tid === league.userTid && league.players[b.pid]?.tid === league.userTid;
  if (tradingClosed(league)) {
    league.block = league.block.filter(stillMine);
    return [];
  }
  league.block = league.block.filter((b) => {
    const p = league.players[b.pid];
    if (!p || p.tid !== b.tid) return false;
    if (b.tid === league.userTid || p.wantsTrade) return true;
    // A team that has played its way into the race stops selling.
    if (SELLER_REASONS.has(b.reason) && isContending(league, league.teams[b.tid])) return false;
    // Names come and go: older listings drop off.
    return league.day - b.day < 28 || (b.year === league.year && chance(0.4));
  });
  const listed = new Set(league.block.map((b) => b.pid));
  const added = [];
  for (const t of league.teams) {
    if (t.id === league.userTid) continue;
    const cap = deadline ? 3 : 2;
    let have = league.block.filter((b) => b.tid === t.id).length;
    for (const c of blockCandidates(league, t, deadline)) {
      if (have >= cap) break;
      if (listed.has(c.p.id)) continue;
      if (!deadline && c.reason !== "Requested a trade" && !chance(0.55)) continue;
      const entry = { pid: c.p.id, tid: t.id, reason: c.reason, day: league.day, year: league.year };
      league.block.push(entry);
      added.push(entry);
      listed.add(c.p.id);
      have++;
    }
  }
  for (const b of league.block) b.interest = interestedTeams(league, b.pid);
  return added;
}

export function onBlock(league, pid) {
  return (league.block || []).some((b) => b.pid === pid);
}

export function toggleUserBlock(league, pid) {
  league.block = league.block || [];
  // Removing always works, even if the player has since left the team.
  if (onBlock(league, pid)) {
    league.block = league.block.filter((b) => b.pid !== pid);
    league.offers = (league.offers || []).filter((o) => !o.give.includes(pid));
    return false;
  }
  const p = league.players[pid];
  if (!p || p.tid !== league.userTid) return false;
  league.block.push({ pid, tid: league.userTid, reason: "Listed by you", day: league.day, year: league.year, interest: interestedTeams(league, pid) });
  return true;
}

// Your own players who have asked out start on your block, with a note in the inbox.
export function seedUserRequests(league) {
  const user = league.teams[league.userTid];
  for (const p of players(league, user.roster)) {
    if (!p.wantsTrade || onBlock(league, p.id)) continue;
    league.block.push({ pid: p.id, tid: user.id, reason: "Requested a trade", day: league.day, year: league.year, interest: interestedTeams(league, p.id) });
    league.inbox.push({ year: league.year, day: league.day, text: `${p.name} has asked for a trade. He's on your trade block, so teams will call; remove him from the block if you want to keep him.` });
  }
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

// AI GMs make a handful of moves a season, not a dozen.
const SEASON_TRADE_LIMIT = 4;
const DEADLINE_DAY_LIMIT = 2;
function tradesThisSeason(league, t) {
  return t.trades?.year === league.year ? t.trades.n : 0;
}
export function deadlineMovesUsed(league, t) {
  return t.trades?.year === league.year ? t.trades.dl || 0 : 0;
}
function tooBusy(league, t) {
  if (tradesThisSeason(league, t) >= SEASON_TRADE_LIMIT) return true;
  return deadlineActive(league) && deadlineMovesUsed(league, t) >= DEADLINE_DAY_LIMIT;
}
function countTrade(league, t) {
  t.trades = { year: league.year, n: tradesThisSeason(league, t) + 1, dl: deadlineMovesUsed(league, t) + (deadlineActive(league) ? 1 : 0) };
}

// Cap a team needs for the emergency call-ups a trade forces (a position group left
// short of a dressable lineup), so deals don't push teams over the cap afterwards.
function callUpCost(league, t, outIds, inIds) {
  const healthy = { F: 0, D: 0, G: 0 };
  for (const id of t.roster) {
    const q = league.players[id];
    if (q && !outIds.includes(id) && q.injury <= 0) healthy[groupOf(q)]++;
  }
  for (const id of inIds) {
    const q = league.players[id];
    if (q && q.injury <= 0) healthy[groupOf(q)]++;
  }
  let need = 0;
  for (const g of ["F", "D", "G"]) need += Math.max(0, MINIMUM[g] - healthy[g]);
  return need * 1.0;
}

// Keep AI rosters legal: fill holes first, then send extras who can legally go to the
// minors. Veterans who can't be sent down stay up (the weekly roster pass handles them).
export function fitRoster(league, t) {
  ensureMinimums(league, t);
  let guard = 0;
  while (counts(league, t).active > MAX_ROSTER && guard++ < 6) {
    const lineup = new Set(t.lines ? lineupIds(t.lines) : []);
    // Never send down someone needed to dress a full lineup (e.g. the emergency goalie).
    const healthy = counts(league, t, { healthyOnly: true });
    const spare = (p) => (groupOf(p) === "G" ? healthy.G > MIN_GOALIES : groupOf(p) === "D" ? healthy.D > MIN_DEFENSE : healthy.F > MIN_FORWARDS);
    const bench = players(league, t.roster).filter((p) => !lineup.has(p.id) && p.injury < 7).sort((a, b) => a.ovr - b.ovr);
    // Injured players don't count toward dressing a lineup, so they can always go down.
    const down = bench.find((p) => canSendDown(p) && (p.injury > 0 || spare(p)));
    if (down) {
      sendDown(league, t, down.id);
      continue;
    }
    // A veteran who can't be sent down is released, as the weekly roster pass would.
    const cut = bench.find((p) => p.injury <= 0 && spare(p));
    if (!cut) break;
    releasePlayer(league, t, cut.id);
  }
}

// Find a deal that moves a block player from one AI team to another (nothing changes yet).
function findDeal(league, entry, { onlyBuyer = null } = {}) {
  const seller = league.teams[entry.tid];
  const p = league.players[entry.pid];
  if (!seller || !p || p.tid !== seller.id || seller.id === league.userTid) return null;
  if (tooBusy(league, seller)) return null;
  if (SELLER_REASONS.has(entry.reason) && isContending(league, seller)) return null;
  const pool = onlyBuyer != null ? [onlyBuyer] : shuffle([...(entry.interest?.length ? entry.interest : interestedTeams(league, p.id))]);
  for (const bid of pool) {
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
    // Both sides stay under the cap, including any call-ups the deal forces.
    const pkgRoster = pkg.ids.filter((id) => buyer.roster.includes(id));
    const outCap = pkgRoster.reduce((s, id) => s + league.players[id].cap, 0);
    if (capSpace(league, buyer) + outCap - p.cap - callUpCost(league, buyer, pkgRoster, [p.id]) < 0.75) continue;
    if (capSpace(league, seller) + p.cap - outCap - callUpCost(league, seller, [p.id], pkgRoster) < 0.25) continue;
    if (!evaluateTrade(league, offer).accept) continue;
    return { offer, buyer, seller, p, aGets: [assetLabel(league, p.id, "p")], bGets: labels(league, pkg.ids, pkg.picks), big: isBlockbuster(league, p.ovr, pkg.picks) };
  }
  return null;
}

function doDeal(league, d) {
  executeTrade(league, d.offer, { record: false });
  countTrade(league, d.buyer);
  countTrade(league, d.seller);
  fitRoster(league, d.buyer);
  fitRoster(league, d.seller);
  const B = place(league, d.buyer);
  const S = place(league, d.seller);
  const text = `${B} acquire ${d.aGets[0]} from ${S} for ${d.bGets.join(", ")}.`;
  wire(league, {
    kind: "trade",
    text,
    tids: [d.buyer.id, d.seller.id],
    a: d.buyer.id,
    b: d.seller.id,
    aGets: d.aGets,
    bGets: d.bGets,
    star: { name: d.p.name, ovr: d.p.ovr, to: d.buyer.id },
    big: d.big,
    short: `${d.buyer.abbr} acquire ${d.p.name} from ${d.seller.abbr}`,
  });
  return text;
}

function aiTradeFor(league, entry) {
  const d = findDeal(league, entry);
  return d ? doDeal(league, d) : null;
}

// ---------- Offers to the user ----------

// Where we are on the calendar for "two weeks": game days in season, FA days after.
const clock = (league) => (league.phase === "freeagency" ? 1000 + (league.fa?.day ?? 0) : league.day);
function recentlyDeclined(league, tid, pid) {
  return (league.declined || []).some((d) => d.tid === tid && d.pid === pid && d.year === league.year && d.phase === league.phase && Math.abs(clock(league) - d.at) < (league.phase === "freeagency" ? 7 : 14));
}

function offerFor(league, pid, { unsolicited = false, expMin = null } = {}) {
  const user = league.teams[league.userTid];
  const p = league.players[pid];
  if (!p || p.tid !== user.id) return null;
  const taken = new Set((league.offers || []).filter((o) => o.give.includes(pid)).map((o) => o.tid));
  const buyers = interestedTeams(league, pid, { limit: 4 }).filter((tid) => !taken.has(tid) && !recentlyDeclined(league, tid, pid));
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
      id: `o${league.year}${league.day}${Math.floor(rand() * 1e9).toString(36)}`,
      tid: buyer.id,
      ...offer,
      day: league.day,
      // Each phase has its own clock: game days in season, FA days in free agency.
      expDay: league.phase === "regular" ? league.day + 5 : null,
      expFa: league.phase === "freeagency" ? (league.fa?.day ?? 0) + 7 : null,
      expMin,
      unsolicited,
      phase: league.phase,
    };
    league.offers = league.offers || [];
    league.offers.push(o);
    const text = `${place(league, buyer)} offer ${labels(league, pkg.ids, pkg.picks).join(", ")} for your ${p.name}.`;
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
  if (o.expDay != null && league.day > o.expDay) return false;
  if (o.expFa != null && (league.phase !== "freeagency" || (league.fa?.day ?? 0) > o.expFa)) return false;
  // Off-season offers end when the phase changes (draft and re-signing have no clock).
  if (o.expDay == null && o.expFa == null && o.phase && o.phase !== league.phase) return false;
  const dl = league.deadline;
  if (o.expMin != null && dl && dl.year === league.year && !dl.done && dl.minute > o.expMin) return false;
  const user = league.teams[league.userTid];
  const ai = league.teams[o.tid];
  return o.give.every((id) => league.players[id]?.tid === user.id) && o.get.every((id) => league.players[id]?.tid === ai.id) && o.getPicks.every((id) => league.draftPicks.some((pk) => pk.id === id && pk.owner === ai.id));
}

function pruneOffers(league) {
  league.offers = (league.offers || []).filter((o) => offerValid(league, o));
}

export function acceptOffer(league, offerId) {
  const o = (league.offers || []).find((x) => x.id === offerId);
  const drop = () => (league.offers = (league.offers || []).filter((x) => x.id !== offerId));
  if (!o || !offerValid(league, o)) {
    drop();
    return { ok: false, msg: "That offer is no longer on the table." };
  }
  // A team stands by the value it offered; only the cap and roster rules can stop it now.
  const ev = evaluateTrade(league, { ...o, margin: 0 });
  if (!ev.accept) {
    drop();
    return { ok: false, msg: `${ev.problems[0] || "The deal can't go through."} The offer is off the table.` };
  }
  const aGets = labels(league, o.give, o.givePicks);
  const bGets = labels(league, o.get, o.getPicks);
  executeTrade(league, o);
  league.offers = league.offers.filter((x) => x.id !== offerId && x.give.every((id) => !o.give.includes(id)));
  fitRoster(league, league.teams[o.tid]);
  noteTrade(league, o.tid, aGets, bGets);
  return { ok: true, msg: `Trade done: you get ${bGets.join(", ")}.` };
}

function noteTrade(league, aiTid, aGets, bGets) {
  const ai = league.teams[aiTid];
  const user = league.teams[league.userTid];
  const star = [...aGets.map((s) => ({ s, to: ai.id })), ...bGets.map((s) => ({ s, to: user.id }))].map((x) => ({ ...x, ovr: Number((/, (\d+)/.exec(x.s) || [])[1] || 0) })).sort((a, b) => b.ovr - a.ovr)[0];
  wire(league, {
    kind: "trade",
    text: `${place(league, ai)} acquire ${aGets.join(", ")} from ${place(league, user)} for ${bGets.join(", ")}.`,
    tids: [ai.id, user.id],
    a: ai.id,
    b: user.id,
    aGets,
    bGets,
    mine: true,
    big: true,
    star: star ? { name: star.s.replace(/ \(.*$/, ""), ovr: star.ovr, to: star.to } : null,
    short: `${ai.abbr} and ${user.abbr} make a trade`,
  });
}

// Labels for a trade the user is about to make in the Trade Center (call before executing it).
export function tradeLabels(league, offer) {
  return { aGets: labels(league, offer.give, offer.givePicks), bGets: labels(league, offer.get, offer.getPicks) };
}

// Trades the user makes in the Trade Center also hit the wire (and the deadline feed).
export function noteUserTrade(league, offer, lbl) {
  noteTrade(league, offer.to, lbl.aGets, lbl.bGets);
}

export function declineOffer(league, offerId) {
  const o = (league.offers || []).find((x) => x.id === offerId);
  league.offers = (league.offers || []).filter((x) => x.id !== offerId);
  if (!o) return;
  // The same team won't come back with the same pitch for a couple of weeks.
  league.declined = [...(league.declined || []).filter((d) => d.year === league.year && d.phase === league.phase && Math.abs(clock(league) - d.at) < 14), { tid: o.tid, pid: o.give[0], at: clock(league), phase: league.phase, year: league.year }];
}

// ---------- Weekly market ----------

function offerSummary(league, made) {
  if (!made.length) return;
  const names = [...new Set(made.map((o) => league.players[o.give[0]]?.name).filter(Boolean))];
  league.inbox.push({ year: league.year, day: league.day, text: `${made.length} new trade offer${made.length > 1 ? "s" : ""} for ${names.join(", ")}. See the Trade Block.` });
}

export function marketWeek(league) {
  if (league.phase !== "regular" || tradingClosed(league)) return;
  pruneOffers(league);
  refreshBlock(league);
  // Activity builds toward the deadline.
  const pace = Math.min(1, league.day / Math.max(1, league.deadlineDay));
  for (const b of shuffle([...league.block])) {
    if (b.tid === league.userTid) continue;
    if (chance(0.008 + 0.035 * pace * pace)) aiTradeFor(league, b);
  }
  const made = [];
  for (const b of league.block.filter((x) => x.tid === league.userTid)) {
    if (chance(0.6)) {
      const o = offerFor(league, b.pid);
      if (o) made.push(o);
    }
  }
  offerSummary(league, made);
  // A rumour or two for the wire.
  const pool = league.block.filter((b) => b.tid !== league.userTid && b.interest?.length);
  if (pool.length && chance(0.7)) rumor(league, pick(pool));
}

// Off-season (draft, re-signing, free agency): trading is open, so listed players still
// draw the occasional call. Called once per free-agency day.
export function marketOffseasonDay(league) {
  if (league.phase === "regular" || tradingClosed(league)) return;
  pruneOffers(league);
  const made = [];
  for (const b of (league.block || []).filter((x) => x.tid === league.userTid)) {
    if (chance(0.2)) {
      const o = offerFor(league, b.pid);
      if (o) made.push(o);
    }
  }
  offerSummary(league, made);
}

function rumor(league, b) {
  const p = league.players[b.pid];
  const team = league.teams[b.tid];
  if (!p || !team || !b.interest?.length) return;
  const names = b.interest.map((tid) => place(league, league.teams[tid]));
  const T = place(league, team);
  const lines = [
    `${names[0]} among the teams checking in on ${poss(T)} ${p.name}.`,
    `${p.name} (${p.pos}, ${p.ovr}) drawing interest from ${names.slice(0, 2).join(" and ")}.`,
    `Sources: ${T} listening on ${p.name}. ${names[0]} ${names.length > 1 ? "and " + names[1] + " have" : "has"} called.`,
    `${poss(T)} asking price on ${p.name} said to be high; ${names[0]} remain in the mix.`,
    `Hearing ${poss(p.name)} camp expects a move. ${names.join(", ")} the names to watch.`,
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
  league.deadline = { year: league.year, day: league.day, minute: DEADLINE_START, done: false, feed: [], trades: 0, pending: [] };
  refreshBlock(league, { deadline: true });
  const top = league.block.filter((b) => b.tid !== league.userTid).map((b) => league.players[b.pid]).filter(Boolean).sort((a, b) => b.ovr - a.ovr).slice(0, 3);
  league.deadline.feed.unshift({ min: DEADLINE_START, kind: "info", text: `It's Trade Deadline Day! Teams have until 3:00 PM ET to make deals.${top.length ? ` Biggest names available: ${top.map((p) => p.name).join(", ")}.` : ""}` });
  return league.deadline;
}

// Talks first, then the deal: half the deals found are reported as "in talks" and close
// (or fall apart) 10-30 minutes later.
function startTalks(league, d) {
  const dl = league.deadline;
  dl.pending.push({ pid: d.p.id, seller: d.seller.id, buyer: d.buyer.id, at: Math.min(DEADLINE_END, dl.minute + randInt(1, 3) * TICK) });
  const B = place(league, d.buyer);
  const S = place(league, d.seller);
  const lines = [
    `Hearing ${B} and ${S} are deep in talks on ${d.p.name}.`,
    `${d.p.name} (${d.p.pos}, ${d.p.ovr}) could be on the move: ${B} closing in, per sources.`,
    `Sources: ${S} have narrowed the ${d.p.name} talks to ${B}.`,
  ];
  wire(league, { kind: "rumor", text: pick(lines), tids: [d.buyer.id, d.seller.id], talks: true });
}

function resolveTalks(league) {
  const dl = league.deadline;
  const due = dl.pending.filter((x) => x.at <= dl.minute);
  dl.pending = dl.pending.filter((x) => x.at > dl.minute);
  for (const t of due) {
    const entry = (league.block || []).find((b) => b.pid === t.pid && b.tid === t.seller) || { pid: t.pid, tid: t.seller, reason: "Talks" };
    const d = findDeal(league, entry, { onlyBuyer: t.buyer });
    if (d) {
      doDeal(league, d);
      dl.trades++;
    } else {
      const p = league.players[t.pid];
      if (p) wire(league, { kind: "rumor", text: `Talks between ${place(league, league.teams[t.buyer])} and ${place(league, league.teams[t.seller])} on ${p.name} have stalled.`, tids: [t.buyer, t.seller] });
    }
  }
}

// Advance the deadline-day clock. Deals come faster as 3:00 PM approaches.
export function deadlineTick(league, minutes = TICK) {
  const dl = league.deadline;
  if (!dl || dl.done) return dl;
  dl.pending = dl.pending || [];
  for (let m = 0; m < minutes && !dl.done; m += TICK) {
    dl.minute += TICK;
    pruneOffers(league);
    const progress = (dl.minute - DEADLINE_START) / (DEADLINE_END - DEADLINE_START);
    if (dl.minute % 60 === 0) refreshInterest(league);
    // Late-morning and early-afternoon: new names hit the market.
    if (dl.minute === 11 * 60 || dl.minute === 13 * 60) {
      const added = refreshBlock(league, { deadline: true }).filter((b) => b.tid !== league.userTid);
      if (added.length) {
        const names = added.map((b) => `${league.players[b.pid].name} (${league.teams[b.tid].abbr})`).slice(0, 5);
        wire(league, { kind: "info", text: `New to the market: ${names.join(", ")}.`, tids: added.map((b) => b.tid) });
      }
    }
    resolveTalks(league);
    // Phones ring all day; the last hour is a scramble.
    const pTrade = 0.35 + 0.35 * progress * progress + (progress > 0.86 ? 0.5 : 0);
    for (let rolls = progress > 0.86 ? 3 : 1; rolls > 0; rolls--) {
      if (!chance(Math.min(0.95, pTrade))) continue;
      const busy = new Set(dl.pending.map((x) => x.pid));
      const pool = league.block.filter((b) => b.tid !== league.userTid && !busy.has(b.pid));
      // Try a few names until one gets done.
      for (let tries = 0; tries < 4 && pool.length; tries++) {
        const b = weighted(pool, (x) => Math.exp(((league.players[x.pid]?.ovr || 70) - 75) / 8));
        pool.splice(pool.indexOf(b), 1);
        const d = findDeal(league, b);
        if (!d) continue;
        if (progress < 0.9 && chance(0.5)) startTalks(league, d);
        else {
          doDeal(league, d);
          dl.trades++;
        }
        break;
      }
    }
    if (chance(0.22)) {
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
    if (dl.minute >= DEADLINE_END) finishDeadline(league);
  }
  return dl;
}

function finishDeadline(league) {
  const dl = league.deadline;
  dl.done = true;
  dl.pending = [];
  const trades = dl.feed.filter((f) => f.kind === "trade");
  const n = trades.length;
  dl.total = n;
  const recap = [`3:00 PM — the trade deadline has passed. ${n} trade${n === 1 ? "" : "s"} today.`];
  const star = trades.filter((f) => f.star).sort((a, b) => b.star.ovr - a.star.ovr)[0];
  if (star) recap.push(`Biggest name moved: ${star.star.name} (${star.star.ovr}) to ${place(league, league.teams[star.star.to ?? star.a])}.`);
  const activity = {};
  for (const f of trades) for (const tid of [f.a, f.b]) activity[tid] = (activity[tid] || 0) + 1;
  const most = Object.entries(activity).sort((a, b) => b[1] - a[1])[0];
  if (most && most[1] > 1) recap.push(`Busiest team: ${place(league, league.teams[most[0]])} (${most[1]} deals).`);
  dl.feed.unshift({ min: dl.minute, kind: "done", text: recap.join(" ") });
  logTx(league, `Trade deadline passed (${n} trades on deadline day)`);
  league.offers = [];
  league.block = (league.block || []).filter((b) => b.tid === league.userTid && league.players[b.pid]?.tid === league.userTid);
}

function refreshInterest(league) {
  for (const b of league.block || []) b.interest = interestedTeams(league, b.pid);
}

export function skipDeadline(league) {
  startDeadline(league);
  while (!league.deadline.done) deadlineTick(league);
}

// Buyers and sellers for the deadline desk: who's in the race, how far from a playoff
// spot, how much cap room, and how many deadline-day moves are left.
export function marketStance(league) {
  const rows = [];
  for (const conf of ["East", "West"]) {
    const table = conferenceTable(league, conf);
    const cut = table[7];
    for (const t of table) {
      rows.push({
        t,
        conf,
        buyer: isContending(league, t),
        gap: cut ? t.rec.pts - cut.rec.pts : 0,
        cap: capSpace(league, t),
        movesLeft: t.id === league.userTid ? null : Math.max(0, Math.min(DEADLINE_DAY_LIMIT - deadlineMovesUsed(league, t), SEASON_TRADE_LIMIT - tradesThisSeason(league, t))),
      });
    }
  }
  return { buyers: rows.filter((r) => r.buyer).sort((a, b) => b.gap - a.gap), sellers: rows.filter((r) => !r.buyer).sort((a, b) => a.gap - b.gap) };
}
