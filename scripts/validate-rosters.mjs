// Validate src/data/nhl27-rosters.json after editing it by hand.
//   npm run validate:rosters
import { readFileSync } from "node:fs";

const file = new URL("../src/data/nhl27-rosters.json", import.meta.url);
const data = JSON.parse(readFileSync(file, "utf8"));
const POS = ["C", "LW", "RW", "LD", "RD", "G"];
const TYPES = ["SNP", "PLY", "PWF", "TWF", "GRN", "ENF", "OFD", "DFD", "TWD", "END", "HYB", "BFY", "STD"];
const problems = [];
const seen = new Map();
let total = 0;
let ea = 0;

for (const [abbr, players] of Object.entries(data.teams)) {
  const n = (pred) => players.filter(pred).length;
  const f = n((p) => ["C", "LW", "RW"].includes(p.pos));
  const d = n((p) => p.pos === "LD" || p.pos === "RD");
  const g = n((p) => p.pos === "G");
  if (f < 12 || d < 6 || g < 2) problems.push(`${abbr}: needs 12 F / 6 D / 2 G (has ${f}/${d}/${g})`);
  const cap = players.reduce((s, p) => s + p.cap, 0);
  for (const p of players) {
    total++;
    if (p.src === "ea27") ea++;
    if (!POS.includes(p.pos)) problems.push(`${abbr} ${p.name}: bad pos ${p.pos}`);
    if (!TYPES.includes(p.type)) problems.push(`${abbr} ${p.name}: bad type ${p.type}`);
    if (!(p.ovr >= 40 && p.ovr <= 99)) problems.push(`${abbr} ${p.name}: bad ovr ${p.ovr}`);
    if (!(p.born > 1980 && p.born < 2012)) problems.push(`${abbr} ${p.name}: bad born ${p.born}`);
    if (!(p.cap >= 0 && p.cap < 25) || !(p.yrs >= 0 && p.yrs <= 8)) problems.push(`${abbr} ${p.name}: bad contract`);
    if (!["ea27", "est"].includes(p.src)) problems.push(`${abbr} ${p.name}: src must be ea27 or est`);
    if (seen.has(p.name)) problems.push(`${p.name} is on both ${seen.get(p.name)} and ${abbr}`);
    seen.set(p.name, abbr);
  }
  console.log(`${abbr}  ${String(players.length).padStart(2)} players  ${f}F ${d}D ${g}G  cap $${cap.toFixed(1)}M`);
}
// Real line combinations: every named player must be on that team, once.
const GROUP = { F: ["C", "LW", "RW"], D: ["LD", "RD"], G: ["G"] };
for (const [abbr, l] of Object.entries(data.lines || {})) {
  const team = data.teams[abbr];
  if (!team) { problems.push(`lines for unknown team ${abbr}`); continue; }
  const shape = [["F", 4, 3], ["D", 3, 2]];
  for (const [k, rows, cols] of shape) {
    if (l[k]?.length !== rows || l[k].some((r) => r.length !== cols)) problems.push(`${abbr} lines: ${k} must be ${rows}x${cols}`);
  }
  if (l.G?.length !== 2) problems.push(`${abbr} lines: G must list 2 goalies`);
  const named = [];
  for (const k of ["F", "D", "G"]) for (const name of (l[k] || []).flat()) if (name) named.push([name, k]);
  for (const o of l.out || []) {
    named.push([o.name, null]);
    if (!(o.games > 0 && o.games < 83)) problems.push(`${abbr} out: ${o.name} games must be 1-82`);
  }
  const seenHere = new Set();
  for (const [name, k] of named) {
    const p = team.find((x) => x.name === name);
    if (!p) problems.push(`${abbr} lines: ${name} is not on the ${abbr} roster`);
    else if (k && !GROUP[k].includes(p.pos)) problems.push(`${abbr} lines: ${name} (${p.pos}) is listed in ${k}`);
    if (seenHere.has(name)) problems.push(`${abbr} lines: ${name} appears twice`);
    seenHere.add(name);
  }
}

console.log(`\n${Object.keys(data.teams).length} teams, ${total} players, ${ea} with official EA NHL 27 overalls, ${total - ea} estimated.`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n- ` + problems.join("\n- "));
  process.exit(1);
}
console.log("Roster file OK.");
