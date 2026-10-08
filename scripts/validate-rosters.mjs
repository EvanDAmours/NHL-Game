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
console.log(`\n${Object.keys(data.teams).length} teams, ${total} players, ${ea} with official EA NHL 27 overalls, ${total - ea} estimated.`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n- ` + problems.join("\n- "));
  process.exit(1);
}
console.log("Roster file OK.");
