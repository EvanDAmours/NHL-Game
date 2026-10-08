// Ratings import/export, so players can paste EA SPORTS NHL 27 ratings (or any
// roster update) straight into a league and share roster files.
import { rescaleToOvr } from "./ratings.js";
import { createPlayer } from "./players.js";
import { POSITIONS, ARCHETYPES } from "./constants.js";
import { addToRoster, logTx } from "./roster.js";

export function normName(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const HEADER_ALIASES = {
  name: ["name", "player", "playername", "fullname"],
  ovr: ["ovr", "overall", "rating", "overallrating"],
  team: ["team", "tm", "abbr", "club"],
  pos: ["pos", "position"],
  type: ["type", "playertype", "archetype"],
  age: ["age"],
  born: ["born", "birthyear", "byear"],
  cap: ["cap", "caphit", "aav", "salary"],
  yrs: ["yrs", "years", "term", "contractyears"],
};

const POS_ALIASES = { CEN: "C", CENTER: "C", LW: "LW", LEFTWING: "LW", RW: "RW", RIGHTWING: "RW", LD: "LD", LEFTDEFENSE: "LD", RD: "RD", RIGHTDEFENSE: "RD", D: "LD", DEF: "LD", G: "G", GOALIE: "G", GOALTENDER: "G" };
const TYPE_ALIASES = Object.fromEntries(Object.entries(ARCHETYPES).map(([k, v]) => [v.name.toLowerCase().replace(/[^a-z]/g, ""), k]));

export function parseRatingsCsv(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { rows: [], errors: ["Paste at least one line."] };
  const sep = lines[0].includes("\t") ? "\t" : lines[0].includes(";") ? ";" : ",";
  const split = (l) => l.split(sep).map((x) => x.trim().replace(/^"|"$/g, ""));
  let cols = null;
  const first = split(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const mapped = first.map((h) => Object.keys(HEADER_ALIASES).find((k) => HEADER_ALIASES[k].includes(h)) || null);
  let start = 0;
  if (mapped.includes("name") && mapped.includes("ovr")) {
    cols = mapped;
    start = 1;
  } else {
    // No header: "Name, OVR" or "Name, Team, Pos, OVR".
    const n = first.length;
    cols = n >= 4 ? ["name", "team", "pos", "ovr"] : ["name", "ovr"];
  }
  const rows = [];
  const errors = [];
  for (let i = start; i < lines.length; i++) {
    const cells = split(lines[i]);
    const r = {};
    cols.forEach((c, j) => {
      if (c && cells[j] !== undefined && cells[j] !== "") r[c] = cells[j];
    });
    const ovr = parseInt(r.ovr, 10);
    if (!r.name || !(ovr >= 40 && ovr <= 99)) {
      errors.push(`Line ${i + 1}: needs a name and an OVR between 40 and 99.`);
      continue;
    }
    const row = { name: r.name, ovr };
    if (r.team) row.team = r.team.toUpperCase().slice(0, 3);
    if (r.pos) row.pos = POS_ALIASES[r.pos.toUpperCase().replace(/[^A-Z]/g, "")] || null;
    if (r.type) row.type = ARCHETYPES[r.type.toUpperCase()] ? r.type.toUpperCase() : TYPE_ALIASES[r.type.toLowerCase().replace(/[^a-z]/g, "")] || null;
    if (r.age) row.age = parseInt(r.age, 10) || undefined;
    if (r.born) row.born = parseInt(r.born, 10) || undefined;
    if (r.cap) row.cap = parseFloat(String(r.cap).replace(/[$m,]/gi, "")) || undefined;
    if (r.yrs) row.yrs = parseInt(r.yrs, 10) || undefined;
    rows.push(row);
  }
  return { rows, errors };
}

export function matchRows(league, rows) {
  const index = new Map();
  for (const p of Object.values(league.players)) {
    if (p.tid === -2) continue;
    const k = normName(p.name);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(p);
  }
  return rows.map((r) => {
    const cands = index.get(normName(r.name)) || [];
    let p = cands[0] || null;
    if (cands.length > 1 && r.team) p = cands.find((c) => league.teams[c.tid]?.abbr === r.team) || p;
    return { row: r, player: p };
  });
}

export function applyRatings(league, matches, { markEA = true, moveTeams = false, addMissing = false } = {}) {
  const report = { updated: 0, moved: 0, added: 0, skipped: 0 };
  for (const { row, player } of matches) {
    if (player) {
      if (row.type && row.type !== player.type) player.type = row.type;
      rescaleToOvr(player, row.ovr);
      if (markEA) player.src = "ea27";
      if (row.cap != null) player.cap = row.cap;
      if (row.yrs != null) player.yrs = row.yrs;
      report.updated++;
      if (moveTeams && row.team) {
        const t = league.teams.find((x) => x.abbr === row.team);
        if (t && t.id !== player.tid) {
          const old = league.teams[player.tid];
          if (old) {
            old.roster = old.roster.filter((x) => x !== player.id);
            old.prospects = old.prospects.filter((x) => x !== player.id);
            old.lines = null;
          }
          league.freeAgents = league.freeAgents.filter((x) => x !== player.id);
          addToRoster(league, t, player);
          player.signed = true;
          report.moved++;
        }
      }
    } else if (addMissing && row.team && row.pos && POSITIONS.includes(row.pos)) {
      const t = league.teams.find((x) => x.abbr === row.team);
      if (!t) { report.skipped++; continue; }
      const p = createPlayer({ name: row.name, pos: row.pos, ovr: row.ovr, type: row.type, age: row.age ?? (row.born ? league.year - row.born : 26), cap: row.cap ?? 1, yrs: row.yrs ?? 1, src: markEA ? "ea27" : "est", tid: t.id }, league.year);
      p.signed = true;
      league.players[p.id] = p;
      addToRoster(league, t, p);
      report.added++;
    } else report.skipped++;
  }
  for (const t of league.teams) t.lines = null;
  logTx(league, `Ratings import: ${report.updated} updated, ${report.moved} moved, ${report.added} added`);
  return report;
}

// Export the current league's NHL rosters in the same format as src/data/nhl27-rosters.json.
export function exportRosterFile(league) {
  const teams = {};
  for (const t of league.teams) {
    teams[t.abbr] = t.roster
      .map((id) => league.players[id])
      .filter(Boolean)
      .sort((a, b) => b.ovr - a.ovr)
      .map((p) => ({ name: p.name, pos: p.pos, ovr: p.ovr, born: league.year - p.age, type: p.type, cap: p.cap, yrs: p.yrs, src: p.src === "ea27" ? "ea27" : "est" }));
  }
  return {
    game: "EA SPORTS NHL 27",
    season: `${league.year}-${String(league.year + 1).slice(2)}`,
    updated: new Date().toISOString().slice(0, 10),
    note: "Exported from Rink GM. src 'ea27' = official EA SPORTS NHL 27 overall; 'est' = estimate.",
    teams,
  };
}
