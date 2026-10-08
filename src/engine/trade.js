// Trades: asset valuation and AI acceptance. AI teams weigh players, prospects
// and picks differently depending on whether they're contending or rebuilding.
import { tradeValue, prospectValue } from "./players.js";
import { DIFFICULTY, MAX_ROSTER, isGoalie, isDefense, capForYear } from "./constants.js";
import { capSpace, counts, logTx, queueForLines } from "./roster.js";
import { leagueTable } from "./standings.js";
import { teamRatings } from "./lines.js";
import { pickLabel } from "./draft.js";

export function isContending(league, team) {
  const ranked = [...league.teams].map((t) => ({ id: t.id, r: teamRatings(league, t).ovr + (t.rec.gp ? (t.rec.pts / (2 * t.rec.gp) - 0.5) * 20 : 0) })).sort((a, b) => b.r - a.r);
  return ranked.findIndex((x) => x.id === team.id) < 14;
}

export function projectedPickSlot(league, pk) {
  if (pk.year !== league.year + 1 || !league.teams[pk.orig].rec.gp) return 16;
  const table = leagueTable(league).reverse();
  return table.findIndex((t) => t.id === pk.orig) + 1;
}

export function pickValue(league, pk, { contending = false } = {}) {
  const slot = projectedPickSlot(league, pk);
  const base = { 1: 3 + 22 * Math.exp(-(slot - 1) / 9), 2: 2.0, 3: 1.2, 4: 0.8, 5: 0.45, 6: 0.35, 7: 0.25 }[pk.round] ?? 0.2;
  const yearsOut = Math.max(0, pk.year - (league.year + 1));
  return base * Math.pow(0.92, yearsOut) * (contending ? 0.85 : 1.15);
}

export function assetValue(league, id, viewer) {
  const p = league.players[id];
  if (!p) return 0;
  const contending = isContending(league, viewer);
  const owner = league.teams[p.tid];
  const inMinors = owner && owner.prospects.includes(id);
  const v = inMinors && p.age <= 23 ? Math.max(prospectValue(p, { contending }), tradeValue(p, league.year, { contending })) : tradeValue(p, league.year, { contending });
  return v;
}

// Franchise cornerstones cost extra to pry loose.
function cornerstonePremium(league, team, id) {
  const top = team.roster.map((x) => league.players[x]).filter(Boolean).sort((a, b) => b.ovr - a.ovr).slice(0, 2).map((p) => p.id);
  return top.includes(id) ? 1.3 : 1;
}

export function evaluateTrade(league, offer) {
  const user = league.teams[offer.from];
  const ai = league.teams[offer.to];
  const margin = (DIFFICULTY[league.settings.difficulty] || DIFFICULTY.normal).tradeMargin;
  const contending = isContending(league, ai);

  const incoming = offer.give.map((id) => assetValue(league, id, ai));
  const outgoing = offer.get.map((id) => assetValue(league, id, ai) * cornerstonePremium(league, ai, id));
  // Consolidation tax: extra roster bodies are worth less to the receiver.
  const extra = Math.max(0, offer.give.length - offer.get.length);
  let valIn = incoming.reduce((a, b) => a + b, 0) - extra * 0.8;
  let valOut = outgoing.reduce((a, b) => a + b, 0);
  const pickIn = offer.givePicks.map((pid) => league.draftPicks.find((p) => p.id === pid)).filter(Boolean);
  const pickOut = offer.getPicks.map((pid) => league.draftPicks.find((p) => p.id === pid)).filter(Boolean);
  valIn += pickIn.reduce((a, pk) => a + pickValue(league, pk, { contending }), 0);
  valOut += pickOut.reduce((a, pk) => a + pickValue(league, pk, { contending }), 0);

  const problems = [];
  const blocked = league.phase === "playoffs" || (league.phase === "regular" && league.day > league.deadlineDay);
  if (blocked) problems.push("The trade deadline has passed.");
  if (!offer.give.length && !offer.get.length && !pickIn.length && !pickOut.length) problems.push("Add something to the deal.");

  // Cap & roster checks for both sides (roster players only; prospects don't count).
  const capHit = (ids, team) => ids.reduce((s, id) => s + (team.roster.includes(id) ? league.players[id].cap : 0), 0);
  const rosterCount = (ids, team) => ids.filter((id) => team.roster.includes(id)).length;
  const userAfter = capSpace(league, user) + capHit(offer.give, user) - capHit(offer.get, ai);
  const aiAfter = capSpace(league, ai) + capHit(offer.get, ai) - capHit(offer.give, user);
  if (aiAfter < 0) problems.push(`${ai.abbr} can't fit the incoming salary under the cap.`);
  if (userAfter < 0) problems.push("You'd be over the salary cap after this deal.");
  const aiRosterAfter = counts(league, ai).active - rosterCount(offer.get, ai) + rosterCount(offer.give, user);
  if (aiRosterAfter > MAX_ROSTER + 1) problems.push(`${ai.abbr} don't have roster room for that many players.`);
  const posLeft = (team, out, inn, test) =>
    team.roster.filter((id) => !out.includes(id) && test(league.players[id])).length +
    inn.filter((id) => test(league.players[id]) && (user.roster.includes(id) || ai.roster.includes(id))).length;
  if (posLeft(ai, offer.get, offer.give, (p) => isGoalie(p.pos)) < 2) problems.push(`${ai.abbr} need two goalies.`);
  if (posLeft(ai, offer.get, offer.give, (p) => isDefense(p.pos)) < 6) problems.push(`${ai.abbr} would be too thin on defense.`);

  const ratio = valOut > 0 ? valIn / (valOut * margin) : valIn > 0 ? 9 : 0;
  const accept = problems.length === 0 && valIn >= valOut * margin && valIn > 0;
  let mood;
  if (ratio >= 1) mood = "We have a deal.";
  else if (ratio >= 0.85) mood = "Close — sweeten it a little.";
  else if (ratio >= 0.6) mood = "Not enough coming back.";
  else mood = "Not even close.";
  return { accept, ratio: Math.min(ratio, 2), valIn, valOut, problems, mood, contending };
}

export function executeTrade(league, offer) {
  const user = league.teams[offer.from];
  const ai = league.teams[offer.to];
  const move = (id, fromT, toT) => {
    const p = league.players[id];
    const wasProspect = fromT.prospects.includes(id);
    fromT.roster = fromT.roster.filter((x) => x !== id);
    fromT.prospects = fromT.prospects.filter((x) => x !== id);
    p.tid = toT.id;
    if (wasProspect) toT.prospects.push(id);
    else toT.roster.push(id);
  };
  offer.give.forEach((id) => move(id, user, ai));
  offer.get.forEach((id) => move(id, ai, user));
  const movePick = (pid, owner) => {
    const pk = league.draftPicks.find((p) => p.id === pid);
    if (!pk) return;
    pk.owner = owner;
    // Mid-draft trades of this year's picks also move the draft slot.
    const slot = league.draft?.year === pk.year && league.draft.slots.find((s) => s.round === pk.round && s.orig === pk.orig && s.pid == null);
    if (slot) slot.owner = owner;
  };
  offer.givePicks.forEach((pid) => movePick(pid, ai.id));
  offer.getPicks.forEach((pid) => movePick(pid, user.id));
  queueForLines(league, user, offer.get);
  queueForLines(league, ai, offer.give);
  const names = (ids) => ids.map((id) => league.players[id].name);
  const picks = (ids) => ids.map((pid) => pickLabel(league, league.draftPicks.find((p) => p.id === pid)));
  const userSends = [...names(offer.give), ...picks(offer.givePicks)].join(", ") || "nothing";
  const aiSends = [...names(offer.get), ...picks(offer.getPicks)].join(", ") || "nothing";
  logTx(league, `TRADE: ${user.abbr} send ${userSends} to ${ai.abbr} for ${aiSends}`, [user.id, ai.id]);
  league.tradeHistory = league.tradeHistory || [];
  league.tradeHistory.unshift({ year: league.year, day: league.day, a: user.id, b: ai.id, aSends: userSends, bSends: aiSends });
}

// Ask the AI what it would want added from the user's side to balance a deal.
export function suggestBalance(league, offer) {
  const user = league.teams[offer.from];
  const ai = league.teams[offer.to];
  const ev = evaluateTrade(league, offer);
  if (ev.accept) return null;
  const margin = (DIFFICULTY[league.settings.difficulty] || DIFFICULTY.normal).tradeMargin;
  let need = ev.valOut * margin - ev.valIn;
  const candidates = [...user.roster, ...user.prospects]
    .filter((id) => !offer.give.includes(id))
    .map((id) => ({ id, v: assetValue(league, id, ai) }))
    .filter((x) => x.v > 0.5)
    .sort((a, b) => a.v - b.v);
  const pick = candidates.find((x) => x.v >= need) || candidates[candidates.length - 1];
  if (!pick) return null;
  return { ...offer, give: [...offer.give, pick.id] };
}

export function capAfterTradeLabel(league, team) {
  return capForYear(league.year) - capSpace(league, team);
}
