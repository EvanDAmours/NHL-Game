// Scouting: your scouting staff (a major and a minor scout), what they can tell you about
// draft prospects, prospect bios, NHL Central Scouting's rankings, the Scouting Combine,
// and the analysts' instant grades on draft day.
//
// Everything here that's random draws from keyed streams (rng.stream), so a prospect's bio
// or a scout's read never changes between renders and the main game stream is untouched.
import { clamp, stream, hashStr } from "./rng.js";
import { randomNameWith } from "./names.js";
import { lastDay } from "./schedule.js";
import { rollDev } from "./players.js";
import { isGoalie, isDefense, posGroup, SCOUT_POINTS_WEEKLY, SCOUT_POINTS_COMBINE, COMBINE_INVITES, COMBINE_INTERVIEWS } from "./constants.js";

// ---------- Scouting staff ----------

export const SCOUT_GROUPS = { C: "Centers", W: "Wingers", D: "Defensemen", G: "Goalies" };
export const scoutGroup = (pos) => (pos === "C" ? "C" : pos === "LW" || pos === "RW" ? "W" : isDefense(pos) ? "D" : "G");

export const SCOUT_ROLES = {
  major: { name: "Major scout", short: "Major", desc: "Covers one position in depth: sharp reports, exact ratings after a full workup, and development traits." },
  minor: { name: "Minor scout", short: "Minor", desc: "Covers a different position more loosely: a general idea of every prospect there and rougher reports. No development traits." },
};

export const SCOUT_TRAITS = {
  workhorse: { name: "Road warrior", desc: "+1 scouting point every 4 weeks of the season." },
  sharp: { name: "Sharp eye", desc: "His reads are more accurate (+8 evaluation)." },
  projector: { name: "Projector", desc: "Spots development traits a step earlier." },
  combine: { name: "Combine guru", desc: "+3 scouting points at the Scouting Combine." },
  europe: { name: "Overseas network", desc: "Far more accurate on prospects playing in Europe." },
};

const BACKGROUNDS = [
  (r) => `Former ${r.pick(["OHL", "WHL", "QMJHL", "USHL"])} head coach`,
  (r) => `Ex-NHL ${r.pick(["defenseman", "winger", "center", "goalie"])}, ${r.int(110, 940)} games`,
  (r) => `${r.int(8, 31)} years as an amateur scout`,
  (r) => `Former ${r.pick(["AHL", "ECHL", "USHL"])} general manager`,
  (r) => `Ex-NCAA assistant coach (${r.pick(["Boston University", "Michigan", "North Dakota", "Denver", "Minnesota"])})`,
  (r) => `Former ${r.pick(["Swedish", "Finnish", "Czech", "Swiss", "Canadian", "U.S."])} junior national team coach`,
  () => "Video coach turned scout",
  (r) => `Former ${r.pick(["SHL", "Liiga", "KHL"])} player and coach`,
];

function makeScout(key, group, evalMean = 72) {
  const r = stream(key);
  const { name, nat } = randomNameWith(r);
  return {
    id: `sc${hashStr(key).toString(36)}`,
    name,
    nat,
    age: r.int(36, 67),
    group,
    eval: clamp(Math.round(r.gauss(evalMean, 9)), 50, 95),
    trait: r.chance(0.55) ? r.pick(Object.keys(SCOUT_TRAITS)) : null,
    bg: r.pick(BACKGROUNDS)(r),
  };
}

// Scouts looking for work: two for each position.
export function refreshScoutPool(league) {
  const tag = `${league.year}|${league.phase}|${league.scoutPoolN = (league.scoutPoolN || 0) + 1}`;
  league.scoutPool = ["C", "W", "D", "G", "C", "W", "D", "G"].map((g, i) => makeScout(`${tag}|pool|${i}`, g, i < 4 ? 75 : 68));
  return league.scoutPool;
}

export function defaultScouts(league) {
  return { major: makeScout(`${league.year}|staff|major`, "C", 70), minor: makeScout(`${league.year}|staff|minor`, "D", 64) };
}

// Staff changes happen in the off-season and preseason, not while the scouts are on the road.
export function staffWindowOpen(league) {
  if (league.phase === "preseason" || league.phase === "resign" || league.phase === "freeagency") return true;
  return league.phase === "draft" && !!league.draft && league.draft.idx >= league.draft.slots.length;
}

const otherRole = (role) => (role === "major" ? "minor" : "major");

export function hireScout(league, scoutId, role) {
  const t = league.teams[league.userTid];
  if (!staffWindowOpen(league)) return { ok: false, msg: "Your scouts are on the road. You can change your staff after the draft or in the preseason." };
  const s = (league.scoutPool || []).find((x) => x.id === scoutId);
  if (!s || !SCOUT_ROLES[role]) return { ok: false, msg: "That scout isn't available." };
  t.scouts ||= { major: null, minor: null };
  const other = t.scouts[otherRole(role)];
  if (other && other.group === s.group) {
    return { ok: false, msg: `Your ${SCOUT_ROLES[otherRole(role)].name.toLowerCase()} already covers ${SCOUT_GROUPS[s.group].toLowerCase()}. Your two scouts need different positions.` };
  }
  const old = t.scouts[role];
  t.scouts[role] = s;
  league.scoutPool = league.scoutPool.filter((x) => x.id !== s.id);
  if (old) league.scoutPool.push(old);
  return { ok: true, msg: `${s.name} is your new ${SCOUT_ROLES[role].name.toLowerCase()} (${SCOUT_GROUPS[s.group].toLowerCase()}).` };
}

export function releaseScout(league, role) {
  const t = league.teams[league.userTid];
  if (!staffWindowOpen(league)) return { ok: false, msg: "Your scouts are on the road. You can change your staff after the draft or in the preseason." };
  const old = t.scouts?.[role];
  if (!old) return { ok: false, msg: "That job is already open." };
  t.scouts[role] = null;
  (league.scoutPool ||= []).push(old);
  return { ok: true, msg: `${old.name} has been let go.` };
}

export function swapScoutRoles(league) {
  const t = league.teams[league.userTid];
  if (!staffWindowOpen(league)) return { ok: false, msg: "Your scouts are on the road. You can change your staff after the draft or in the preseason." };
  const s = t.scouts || {};
  t.scouts = { major: s.minor || null, minor: s.major || null };
  return { ok: true, msg: "Your scouts have switched roles." };
}

// Scouting points: some in the bank when the class is announced, one a week through the
// regular season, more at the Combine. Weeks are credited even if the sim skips a day.
export function scoutWeek(league) {
  const t = league.teams[league.userTid];
  if (!t) return;
  const week = Math.floor(league.day / 7);
  const paid = t.scoutWeekPaid ?? -1;
  const s = t.scouts || {};
  const workhorse = s.major?.trait === "workhorse" || s.minor?.trait === "workhorse";
  for (let w = paid + 1; w <= week; w++) {
    t.scoutPts = (t.scoutPts || 0) + SCOUT_POINTS_WEEKLY;
    if (workhorse && w > 0 && w % 4 === 0) t.scoutPts++;
  }
  t.scoutWeekPaid = Math.max(paid, week);
}

// ---------- What your scouts know ----------

const EURO_LEAGUES = new Set(["SHL", "J20 Nationell", "HockeyAllsvenskan", "Liiga", "U20 SM-sarja", "Mestis", "KHL", "MHL", "VHL", "Czechia", "Czechia U20", "Slovakia", "Slovakia U20", "NL", "U20-Elit", "DEL", "DNL U20"]);
const OFFICE_EVAL = 60;

// Which of your scouts covers a prospect: "major", "minor", or "office" (nobody, so the
// front office's generalists handle it).
export function coverage(league, p) {
  const s = league.teams[league.userTid]?.scouts || {};
  const g = scoutGroup(p.pos);
  if (s.major?.group === g) return { role: "major", scout: s.major };
  if (s.minor?.group === g) return { role: "minor", scout: s.minor };
  return { role: "office", scout: null };
}

export function scoutEval(scout, p) {
  if (!scout) return OFFICE_EVAL;
  let e = scout.eval;
  if (scout.trait === "sharp") e += 8;
  if (scout.trait === "europe" && p && EURO_LEAGUES.has(p.bio?.lg)) e += 12;
  return clamp(e, 40, 99);
}

// How far off a read on POT can be (OVR reads are a bit tighter). Level 0 is the passive
// "general idea" a scout has of everyone at his position; 1 is a scouting report; 2 is a
// full workup. Nobody but the major scout gets to exact numbers.
export function readSd(role, lvl, ev) {
  const a = (100 - ev) / 50;
  if (role === "major") return lvl >= 2 ? 0 : lvl === 1 ? 0.9 + 1.6 * a : 2.2 + 2.6 * a;
  if (role === "minor") return lvl >= 2 ? 1 + 1.4 * a : lvl === 1 ? 1.8 + 2.4 * a : 3.2 + 3 * a;
  return lvl >= 2 ? 2.6 : lvl === 1 ? 4.2 : Infinity;
}

export function scoutCost(p) {
  const l = p?.scout?.lvl || 0;
  return l === 0 ? 1 : l === 1 ? 2 : 0;
}

// Would the next report on this prospect reveal his development trait?
function seesDev(cov, lvl) {
  if (cov.role === "major") return lvl >= 2 || cov.scout.trait === "projector";
  if (cov.role === "minor") return lvl >= 2 && cov.scout.trait === "projector";
  return false;
}

export function scoutProspect(league, pid) {
  const p = league.players[pid];
  const t = league.teams[league.userTid];
  if (!p || p.tid !== -2 || !p.scout) return { ok: false, msg: "You can only scout prospects in the upcoming draft." };
  const cost = scoutCost(p);
  if (!cost) return { ok: false, msg: `${p.name} is already fully scouted.` };
  if ((t.scoutPts || 0) < cost) return { ok: false, msg: `Not enough scouting points (that takes ${cost}).` };
  t.scoutPts -= cost;
  fileReport(league, p, p.scout.lvl + 1);
  return { ok: true, msg: `${p.scout.who} filed a ${p.scout.lvl >= 2 ? "full workup" : "scouting report"} on ${p.name}.` };
}

function fileReport(league, p, lvl) {
  const cov = coverage(league, p);
  const ev = scoutEval(cov.scout, p);
  const sd = readSd(cov.role, lvl, ev);
  const r = stream(`${p.id}|${cov.scout?.id || "office"}|${lvl}`);
  const n = (s) => (s ? clamp(r.gauss(0, s), -1.6 * s, 1.6 * s) : 0);
  const eOvr = clamp(Math.round(p.ovr + n(sd * 0.8)), 40, 99);
  const ePot = clamp(Math.max(eOvr + (sd ? 1 : 0), Math.round(p.pot + n(sd))), eOvr, 99);
  const skills = skillReads(p, sd, ePot - eOvr, r);
  Object.assign(p.scout, {
    lvl,
    eOvr,
    ePot,
    sd,
    exact: sd === 0,
    by: cov.role,
    who: cov.scout?.name || "Your front office",
    dev: seesDev(cov, lvl) ? p.dev : p.scout.dev || null,
    skills,
    notes: notesFor(p, skills, r),
    comp: comparable(league, p, ePot),
  });
}

// The general idea a scout has of every prospect at his position, without a report.
export function generalIdea(league, p) {
  const cov = coverage(league, p);
  if (cov.role === "office") return null;
  const sd = readSd(cov.role, 0, scoutEval(cov.scout, p));
  const r = stream(`${p.id}|${cov.scout.id}|gen`);
  const pot = p.pot + clamp(r.gauss(0, sd), -1.6 * sd, 1.6 * sd);
  return { pot, grade: potGrade(pot), tier: projection(p.pos, pot), by: cov.role, who: cov.scout.name };
}

// Everything the UI shows about a prospect, from your point of view.
export function prospectRead(league, p) {
  const s = p.scout || { lvl: 0 };
  const cov = coverage(league, p);
  const has = s.lvl > 0 && s.eOvr != null;
  const gen = has ? null : generalIdea(league, p);
  const potV = has ? s.ePot : gen ? gen.pot : null;
  return {
    lvl: s.lvl || 0,
    cov: cov.role,
    scout: cov.scout,
    ovr: has ? (s.exact ? `${s.eOvr}` : `~${s.eOvr}`) : "??",
    pot: has ? (s.exact ? `${s.ePot}` : `~${s.ePot}`) : gen ? gen.grade : "??",
    ovrV: has ? s.eOvr : null,
    potV,
    exact: !!s.exact,
    general: !!gen,
    grade: potV != null ? potGrade(potV) : null,
    tier: potV != null ? projection(p.pos, potV) : null,
    dev: s.dev || null,
    sd: has ? s.sd ?? null : null,
    by: s.by || null,
    who: s.who || gen?.who || null,
    cost: scoutCost(p),
  };
}

// ---------- Grades, projections and reports ----------

const LETTERS = [[92, "A+"], [89, "A"], [86, "A-"], [83, "B+"], [80, "B"], [77, "B-"], [74, "C+"], [71, "C"], [68, "C-"], [-Infinity, "D"]];
export function potGrade(v) {
  for (const [min, g] of LETTERS) if (v >= min) return g;
  return "D";
}
export const gradeClass = (g) => (!g ? "" : g[0] === "A" ? "ga" : g[0] === "B" ? "gb" : g[0] === "C" ? "gc" : "gd");

export function projection(pos, pot) {
  if (isGoalie(pos)) return pot >= 90 ? "Franchise goalie" : pot >= 86 ? "Starting goalie" : pot >= 82 ? "1B / tandem goalie" : pot >= 78 ? "NHL backup" : "Long shot";
  if (isDefense(pos)) return pot >= 91 ? "Franchise defenseman" : pot >= 87 ? "Top-pair defenseman" : pot >= 83 ? "Top-four defenseman" : pot >= 79 ? "Third-pair defenseman" : pot >= 75 ? "Depth defenseman" : "Long shot";
  const who = pos === "C" ? "center" : "winger";
  return pot >= 92 ? `Franchise ${who}` : pot >= 88 ? `First-line ${who}` : pot >= 84 ? `Top-six ${who}` : pot >= 80 ? `Middle-six ${who}` : pot >= 76 ? "Bottom-six forward" : "Long shot";
}

export function riskLabel(eOvr, ePot) {
  const gap = ePot - eOvr;
  return gap >= 18 ? "High risk, high reward" : gap >= 13 ? "Some risk" : "Safe bet";
}

const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

export const SKATER_SKILLS = {
  skating: { name: "Skating", keys: ["spd", "acc", "agi", "bal"], hi: ["Explosive first three strides", "Effortless, efficient stride", "Elite edges and lateral quickness", "Pulls away from defenders in open ice"], lo: ["Heavy first step; skating needs work", "Choppy stride limits his pace", "Gets beaten wide by quicker players"] },
  shooting: { name: "Shooting", keys: ["wac", "wpw", "sac", "spw"], hi: ["Quick, deceptive release", "Heavy shot that beats goalies from distance", "Picks corners in stride", "One-timer is already a weapon"], lo: ["Shot doesn't scare goalies yet", "Needs more velocity on his shot", "Release is slow and easy to read"] },
  hands: { name: "Puck skills", keys: ["dek", "hey", "puc"], hi: ["Dangles in a phone booth", "Silky hands at full speed", "Protects the puck like a veteran"], lo: ["Fumbles passes at speed", "Hands don't keep up with his feet", "Coughs it up under pressure"] },
  sense: { name: "Hockey sense", keys: ["pas", "oaw", "poi"], hi: ["Sees plays before they develop", "Threads seam passes through traffic", "Elite hockey IQ in the offensive zone", "Poised with the puck on his stick"], lo: ["Forces passes into traffic", "Decision-making lags behind his tools", "Tunnel vision with the puck"] },
  defense: { name: "Defense", keys: ["daw", "stk", "blk"], hi: ["Reliable in his own end", "Active stick breaks up plays", "Reads the rush and kills plays early", "Fearless shot blocker"], lo: ["Coverage lapses in his own zone", "Puck-watches away from the play", "A long way to go defensively"] },
  compete: { name: "Compete", keys: ["bch", "str", "agr"], hi: ["Wins puck battles along the wall", "Plays bigger than his size", "Punishing open-ice hitter", "Relentless forechecker"], lo: ["Gets pushed off the puck", "Avoids the dirty areas", "Needs to add strength"] },
};
export const GOALIE_SKILLS = {
  positioning: { name: "Positioning", keys: ["pos", "vis"], hi: ["Always square to the shooter", "Calm, economical movement", "Reads plays and gets set early"], lo: ["Drifts out of the blue paint", "Overcommits on lateral plays"] },
  reflexes: { name: "Reflexes", keys: ["sth", "stl", "fiv"], hi: ["Lightning-quick pads", "Elite reflexes in tight", "Seals the ice on low shots"], lo: ["Beaten low too often", "Slow to react to tips and deflections"] },
  glove: { name: "Glove", keys: ["glh", "gll"], hi: ["Snaps up everything glove side", "Highlight-reel glove hand"], lo: ["Glove hand is a weakness up high", "Shooters pick on his glove side"] },
  rebounds: { name: "Rebound control", keys: ["reb", "pok"], hi: ["Swallows pucks and kills rebounds", "Steers rebounds to safe areas"], lo: ["Gives up juicy rebounds", "Rebound control is a work in progress"] },
  athleticism: { name: "Athleticism", keys: ["spd", "agi"], hi: ["Explosive post to post", "Acrobatic second-save ability"], lo: ["Lacks explosiveness side to side", "Struggles to recover on second chances"] },
  composure: { name: "Composure", keys: ["poi", "brk"], hi: ["Unflappable under pressure", "Shakes off bad goals instantly"], lo: ["Loses focus after a bad goal", "Rattled by traffic in front"] },
};
export const skillsFor = (pos) => (isGoalie(pos) ? GOALIE_SKILLS : SKATER_SKILLS);

// Tool grades, projected to his NHL ceiling: today's skill plus the growth the scout expects.
function skillReads(p, sd, growth, r) {
  const out = {};
  for (const [k, sk] of Object.entries(skillsFor(p.pos))) {
    const now = avg(sk.keys.map((x) => p.attrs[x] ?? 50));
    const noise = sd ? clamp(r.gauss(0, sd * 0.9 + 0.8), -6, 6) : 0;
    const v = now + Math.max(0, growth) + noise;
    out[k] = { v: Math.round(v), g: potGrade(v) };
  }
  return out;
}

function notesFor(p, skills, r) {
  const defs = skillsFor(p.pos);
  const order = Object.keys(skills).sort((a, b) => skills[b].v - skills[a].v);
  const strengths = order.slice(0, 2).map((k) => r.pick(defs[k].hi));
  const weaknesses = order.slice(-1).map((k) => r.pick(defs[k].lo));
  return { strengths, weaknesses };
}

// The NHL player whose game his most resembles, at about the level he projects to.
export function comparable(league, p, ePot) {
  const grp = posGroup(p.pos);
  const keys = Object.keys(p.attrs).filter((k) => k !== "fgt" && k !== "fof");
  const mean = (x) => avg(keys.map((k) => x.attrs[k] ?? 50));
  const mp = mean(p);
  for (const band of [[4, 3], [7, 6]]) {
    let best = null;
    let bestD = Infinity;
    for (const t of league.teams) {
      for (const id of t.roster) {
        const c = league.players[id];
        if (!c || posGroup(c.pos) !== grp || c.ovr < ePot - band[0] || c.ovr > ePot + band[1]) continue;
        const mc = mean(c);
        let d = 0;
        for (const k of keys) {
          const x = (p.attrs[k] ?? 50) - mp - ((c.attrs[k] ?? 50) - mc);
          d += x * x;
        }
        if (c.type !== p.type) d *= 1.25;
        if (grp === "F" && (c.pos === "C") !== (p.pos === "C")) d *= 1.1;
        if (c.src !== "ea27") d *= 1.3;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    if (best) return { name: best.name, pid: best.id, abbr: league.teams[best.tid]?.abbr || "" };
  }
  return null;
}

// ---------- Prospect bios ----------

const LG = {
  OHL: { f: 1, gp: [58, 68], teams: ["London Knights", "Kitchener Rangers", "Ottawa 67's", "Oshawa Generals", "Sudbury Wolves", "Saginaw Spirit", "Windsor Spitfires", "Barrie Colts", "Brampton Steelheads", "Brantford Bulldogs", "Erie Otters", "Flint Firebirds", "Guelph Storm", "Kingston Frontenacs", "North Bay Battalion", "Owen Sound Attack", "Peterborough Petes", "Sarnia Sting", "Sault Ste. Marie Greyhounds", "Niagara IceDogs"] },
  WHL: { f: 1, gp: [58, 68], teams: ["Medicine Hat Tigers", "Everett Silvertips", "Portland Winterhawks", "Kamloops Blazers", "Calgary Hitmen", "Edmonton Oil Kings", "Saskatoon Blades", "Spokane Chiefs", "Prince Albert Raiders", "Brandon Wheat Kings", "Regina Pats", "Kelowna Rockets", "Red Deer Rebels", "Seattle Thunderbirds", "Vancouver Giants", "Lethbridge Hurricanes", "Moose Jaw Warriors", "Wenatchee Wild", "Tri-City Americans", "Victoria Royals", "Prince George Cougars", "Swift Current Broncos"] },
  QMJHL: { f: 1.02, gp: [56, 66], teams: ["Rimouski Océanic", "Moncton Wildcats", "Halifax Mooseheads", "Drummondville Voltigeurs", "Saint John Sea Dogs", "Sherbrooke Phoenix", "Baie-Comeau Drakkar", "Chicoutimi Saguenéens", "Québec Remparts", "Val-d'Or Foreurs", "Gatineau Olympiques", "Blainville-Boisbriand Armada", "Victoriaville Tigres", "Shawinigan Cataractes", "Rouyn-Noranda Huskies", "Cape Breton Eagles", "Charlottetown Islanders"] },
  USHL: { f: 0.85, gp: [50, 62], teams: ["Sioux City Musketeers", "Chicago Steel", "Green Bay Gamblers", "Waterloo Black Hawks", "Tri-City Storm", "Muskegon Lumberjacks", "Dubuque Fighting Saints", "Youngstown Phantoms", "Lincoln Stars", "Fargo Force", "Sioux Falls Stampede", "Madison Capitols", "Cedar Rapids RoughRiders", "Des Moines Buccaneers"] },
  USNTDP: { f: 0.95, gp: [55, 64], teams: ["U.S. National U18 Team"] },
  NCAA: { f: 0.6, gp: [30, 38], teams: ["Boston University", "Michigan", "Minnesota", "Boston College", "North Dakota", "Denver", "Wisconsin", "Michigan State", "Notre Dame", "Harvard", "Providence", "Penn State", "Quinnipiac", "UMass", "Western Michigan", "Cornell"] },
  SHL: { f: 0.3, gp: [30, 52], teams: ["Frölunda HC", "Djurgårdens IF", "Färjestad BK", "Skellefteå AIK", "Luleå HF", "HV71", "Rögle BK", "Brynäs IF", "Växjö Lakers", "Linköping HC", "Örebro HK", "Leksands IF", "Malmö Redhawks", "Timrå IK"] },
  "J20 Nationell": { f: 0.95, gp: [36, 46], teams: ["Frölunda HC J20", "Djurgårdens IF J20", "Färjestad BK J20", "Skellefteå AIK J20", "Luleå HF J20", "HV71 J20", "Rögle BK J20", "Brynäs IF J20", "Växjö Lakers J20", "Linköping HC J20", "MoDo Hockey J20", "Leksands IF J20"] },
  HockeyAllsvenskan: { f: 0.45, gp: [36, 52], teams: ["MoDo Hockey", "AIK", "IF Björklöven", "Södertälje SK", "Västerås IK", "Mora IK", "Almtuna IS", "Västerviks IK"] },
  Liiga: { f: 0.35, gp: [36, 58], teams: ["Tappara", "Kärpät", "HIFK", "TPS", "Ilves", "JYP", "KalPa", "Lukko", "Pelicans", "HPK", "Jukurit", "SaiPa", "Ässät", "KooKoo", "Sport"] },
  "U20 SM-sarja": { f: 0.95, gp: [36, 48], teams: ["Tappara U20", "Kärpät U20", "HIFK U20", "TPS U20", "Ilves U20", "JYP U20", "KalPa U20", "Lukko U20", "Pelicans U20", "HPK U20", "Jokerit U20"] },
  Mestis: { f: 0.5, gp: [36, 48], teams: ["Jokerit", "TUTO Hockey", "Kiekko-Espoo", "Hermes", "KeuPa HT"] },
  KHL: { f: 0.25, gp: [20, 56], teams: ["SKA St. Petersburg", "CSKA Moscow", "Lokomotiv Yaroslavl", "Ak Bars Kazan", "Avangard Omsk", "Dynamo Moscow", "Metallurg Magnitogorsk", "Traktor Chelyabinsk", "Spartak Moscow", "Salavat Yulaev Ufa"] },
  MHL: { f: 0.9, gp: [40, 58], teams: ["SKA-1946", "Krasnaya Armiya", "Loko Yaroslavl", "Irbis Kazan", "Omskie Yastreby", "MHC Dynamo", "Stalnye Lisy", "Belye Medvedi", "MHC Spartak", "Tolpar Ufa"] },
  VHL: { f: 0.45, gp: [30, 50], teams: ["SKA-Neva", "Zvezda Moscow", "HC Ryazan", "Dynamo St. Petersburg", "Izhstal"] },
  Czechia: { f: 0.33, gp: [30, 52], teams: ["HC Sparta Praha", "HC Oceláři Třinec", "HC Dynamo Pardubice", "Bílí Tygři Liberec", "HC Vítkovice", "HC Kometa Brno", "Rytíři Kladno", "Mountfield HK"] },
  "Czechia U20": { f: 0.95, gp: [36, 46], teams: ["HC Sparta Praha U20", "HC Oceláři Třinec U20", "HC Dynamo Pardubice U20", "Bílí Tygři Liberec U20", "HC Vítkovice U20", "HC Kometa Brno U20"] },
  Slovakia: { f: 0.42, gp: [36, 52], teams: ["HC Slovan Bratislava", "HC Košice", "HK Nitra", "HC '05 Banská Bystrica", "HK Dukla Trenčín", "HKM Zvolen"] },
  "Slovakia U20": { f: 0.95, gp: [36, 46], teams: ["HC Slovan Bratislava U20", "HC Košice U20", "HK Nitra U20", "HK Dukla Trenčín U20"] },
  NL: { f: 0.3, gp: [30, 52], teams: ["ZSC Lions", "HC Davos", "EV Zug", "SC Bern", "HC Lugano", "Genève-Servette HC", "Lausanne HC", "EHC Biel"] },
  "U20-Elit": { f: 0.95, gp: [36, 46], teams: ["ZSC Lions U20", "HC Davos U20", "EV Zug U20", "SC Bern U20", "HC Lugano U20", "Genève-Servette HC U20"] },
  DEL: { f: 0.3, gp: [30, 52], teams: ["Eisbären Berlin", "Adler Mannheim", "EHC Red Bull München", "Kölner Haie", "Augsburger Panther", "ERC Ingolstadt", "Grizzlys Wolfsburg"] },
  "DNL U20": { f: 1, gp: [30, 40], teams: ["Jungadler Mannheim", "Red Bull Akademie München", "Eisbären Juniors Berlin", "Kölner Junghaie"] },
};
const MENS = new Set(["SHL", "HockeyAllsvenskan", "Liiga", "Mestis", "KHL", "VHL", "Czechia", "Slovakia", "NL", "DEL", "NCAA"]);
const NATION_LEAGUES = {
  CAN: [["OHL", 36], ["WHL", 30], ["QMJHL", 20], ["USHL", 6], ["NCAA", 8]],
  USA: [["USNTDP", 20], ["USHL", 32], ["NCAA", 26], ["OHL", 11], ["WHL", 11]],
  SWE: [["J20 Nationell", 50], ["SHL", 30], ["HockeyAllsvenskan", 20]],
  FIN: [["U20 SM-sarja", 50], ["Liiga", 32], ["Mestis", 18]],
  RUS: [["MHL", 55], ["KHL", 25], ["VHL", 20]],
  CZE: [["Czechia", 30], ["Czechia U20", 35], ["OHL", 15], ["WHL", 10], ["QMJHL", 10]],
  SVK: [["Slovakia", 35], ["Slovakia U20", 25], ["OHL", 20], ["QMJHL", 20]],
  SUI: [["NL", 45], ["U20-Elit", 40], ["QMJHL", 15]],
  GER: [["DEL", 45], ["DNL U20", 35], ["OHL", 20]],
};
const TOWNS = {
  CAN: ["Toronto, ON", "Mississauga, ON", "Ottawa, ON", "London, ON", "Sudbury, ON", "Montréal, QC", "Québec City, QC", "Calgary, AB", "Edmonton, AB", "Winnipeg, MB", "Saskatoon, SK", "Regina, SK", "Vancouver, BC", "Kelowna, BC", "Halifax, NS"],
  USA: ["Minneapolis, MN", "Duluth, MN", "Boston, MA", "Detroit, MI", "Chicago, IL", "Buffalo, NY", "St. Louis, MO", "Pittsburgh, PA", "Denver, CO", "Dallas, TX", "Scottsdale, AZ", "Grand Forks, ND"],
  SWE: ["Stockholm", "Göteborg", "Malmö", "Luleå", "Skellefteå", "Karlstad", "Linköping", "Örnsköldsvik", "Jönköping"],
  FIN: ["Helsinki", "Tampere", "Turku", "Oulu", "Espoo", "Jyväskylä", "Kuopio", "Lahti", "Pori"],
  RUS: ["Moscow", "St. Petersburg", "Kazan", "Yaroslavl", "Omsk", "Chelyabinsk", "Magnitogorsk", "Ufa", "Nizhny Novgorod"],
  CZE: ["Prague", "Brno", "Ostrava", "Pardubice", "Plzeň", "Třinec", "Liberec", "Kladno"],
  SVK: ["Bratislava", "Košice", "Nitra", "Trenčín", "Zvolen"],
  SUI: ["Zürich", "Bern", "Davos", "Lugano", "Zug", "Geneva"],
  GER: ["Berlin", "Mannheim", "Munich", "Cologne", "Augsburg", "Ingolstadt"],
};

export function makeBio(p) {
  const r = stream(`${p.id}|bio`);
  const a = p.attrs;
  const opts = NATION_LEAGUES[p.nat] || NATION_LEAGUES.CAN;
  // Men's leagues and college are mostly for older or more developed prospects.
  const ready = (p.age >= 19 ? 1 : 0) + (p.ovr >= 76 ? 1 : 0);
  const lg = r.weighted(opts, ([name, w]) => (MENS.has(name) ? w * [0.45, 1, 1.6][ready] : w))[0];
  const L = LG[lg];
  const g = isGoalie(p.pos);
  const typeAdj = { PWF: 1, ENF: 1.5, END: 1.2, DFD: 0.6, SNP: -0.3, PLY: -0.7 }[p.type] || 0;
  const ht = clamp(Math.round((g ? 74.6 : isDefense(p.pos) ? 73.6 : 72.6) + typeAdj + r.gauss(0, 1.8)), 67, 79);
  const wt = clamp(Math.round(150 + (ht - 66) * 5 + ((a.str ?? 62) - 62) * 0.7 + r.gauss(0, 6)), 152, 235);
  const bio = { lg, team: r.pick(L.teams), town: r.pick(TOWNS[p.nat] || TOWNS.CAN), ht, wt };
  if (g) {
    const gc = avg([a.glh, a.gll, a.sth, a.stl, a.fiv]) * 0.55 + a.pos * 0.25 + a.reb * 0.1 + avg([a.spd, a.agi]) * 0.1;
    const svp = clamp(0.882 + (gc - 65) * 0.0017 + (L.f < 0.7 ? 0.006 : 0) + r.gauss(0, 0.006), 0.862, 0.938);
    const gp = Math.round(L.gp[1] * r.int(55, 85) / 100);
    Object.assign(bio, {
      gp,
      w: Math.round(gp * clamp(0.38 + (gc - 62) * 0.012 + r.gauss(0, 0.06), 0.2, 0.8)),
      svp: Math.round(svp * 1000) / 1000,
      gaa: Math.round(clamp(3.55 - (svp - 0.882) * 30 + r.gauss(0, 0.15), 1.6, 4.4) * 100) / 100,
      so: r.int(0, Math.max(1, Math.round(gp / 12))),
    });
  } else {
    const off = avg([a.wac, a.wpw]) * 0.35 + avg([a.dek, a.hey, a.puc]) * 0.25 + a.oaw * 0.25 + avg([a.spd, a.acc]) * 0.15;
    const x = off * 0.6 + p.ovr * 0.4;
    const ppg = clamp(0.2 + 0.55 * Math.exp((x - 60) / 16), 0.15, 2.7) * (isDefense(p.pos) ? 0.55 : 1) * L.f * (1 + r.gauss(0, 0.12));
    const gp = r.int(L.gp[0], L.gp[1]);
    const pts = Math.max(0, Math.round(ppg * gp));
    const share = isDefense(p.pos) ? (p.type === "OFD" ? 0.27 : 0.22) : { SNP: 0.52, PWF: 0.47, PLY: 0.33, GRN: 0.45, ENF: 0.45 }[p.type] || 0.42;
    const goals = clamp(Math.round(pts * share * (1 + r.gauss(0, 0.1))), 0, pts);
    Object.assign(bio, { gp, g: goals, a: pts - goals, pim: Math.max(2, Math.round(gp * clamp(0.25 + ((a.agr ?? 60) - 55) * 0.02 + ((a.fgt ?? 50) > 70 ? 0.4 : 0), 0.05, 2.2))) });
  }
  return bio;
}

export const fmtHeight = (ht) => `${Math.floor(ht / 12)}'${ht % 12}"`;
export const isEuropean = (p) => EURO_LEAGUES.has(p.bio?.lg);

// How much of the junior season has been played (stats on the board are season-to-date).
export function seasonShare(league) {
  if (league.phase === "preseason") return 0;
  if (league.phase === "regular") return clamp(league.day / Math.max(1, lastDay(league.schedule)), 0.03, 1);
  return 1;
}

export function bioStats(league, p) {
  const b = p.bio;
  if (!b) return null;
  const f = seasonShare(league);
  if (!f) return null;
  const k = (x) => Math.round(x * f);
  if (isGoalie(p.pos)) return { gp: Math.max(1, k(b.gp)), w: k(b.w), svp: b.svp, gaa: b.gaa, so: Math.min(b.so, k(b.so + 0.4)) };
  const g = k(b.g);
  const a = k(b.a);
  return { gp: Math.max(1, k(b.gp)), g, a, pts: g + a, pim: k(b.pim) };
}

// ---------- NHL Central Scouting ----------

// Midterm rankings come out with the class; final rankings after the Combine. The Big Board
// is always in this order, whatever your scouts find.
export function rankClass(league, ids) {
  const ps = ids.map((id) => league.players[id]).filter(Boolean);
  for (const p of ps) {
    p.bio ||= makeBio(p);
    p.cs ||= { score: p.pot * 0.78 + p.ovr * 0.22 + stream(`${p.id}|cs`).gauss(0, 2.4) };
  }
  [...ps].sort((a, b) => b.cs.score - a.cs.score).forEach((p, i) => (p.cs.mid = i + 1));
}

export const csRank = (p) => p.cs?.final ?? p.cs?.mid ?? 999;
export const csScore = (p) => p.cs?.fscore ?? p.cs?.score ?? p.pot * 0.78 + p.ovr * 0.22;

export function classPool(league) {
  return (league.draftClass || []).map((id) => league.players[id]).filter((p) => p && p.tid === -2);
}

// ---------- Scouting Combine ----------

export const COMBINE_TESTS = [
  { k: "wingate", name: "Wingate peak power", short: "Wingate", unit: "W/kg", dp: 1 },
  { k: "vo2", name: "VO2 max", short: "VO2", unit: "ml/kg/min", dp: 1 },
  { k: "jump", name: "Standing long jump", short: "Jump", unit: "in", dp: 0 },
  { k: "agility", name: "Pro agility", short: "Agility", unit: "s", dp: 2, lowGood: true },
  { k: "bench", name: "Bench press", short: "Bench", unit: "reps", dp: 0 },
  { k: "pullups", name: "Pull-ups", short: "Pull-ups", unit: "", dp: 0 },
];

function combineTests(p) {
  const a = p.attrs;
  const r = stream(`${p.id}|combine`);
  const spd = a.spd ?? 65;
  const acc = a.acc ?? a.agi ?? 65;
  const agi = a.agi ?? 65;
  const end = a.end ?? 75;
  const str = a.str ?? 58 + ((a.dur ?? 75) - 75) * 0.4;
  const rd = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
  return {
    wingate: rd(clamp(12 + ((acc + spd) / 2 - 60) * 0.11 + r.gauss(0, 0.6), 10, 17.5), 1),
    vo2: rd(clamp(47 + (end - 75) * 0.35 + r.gauss(0, 2.2), 40, 62), 1),
    jump: Math.round(clamp(100 + ((spd + acc) / 2 - 60) * 0.55 + r.gauss(0, 3.5), 86, 124)),
    agility: rd(clamp(4.62 - (agi - 60) * 0.009 + r.gauss(0, 0.07), 4.15, 5.05), 2),
    bench: Math.round(clamp(6 + (str - 60) * 0.22 + r.gauss(0, 2), 0, 18)),
    pullups: Math.round(clamp(7 + (str - 60) * 0.2 + r.gauss(0, 2.2), 0, 20)),
  };
}

const COMBINE_LETTERS = [[0.95, "A+"], [0.85, "A"], [0.75, "A-"], [0.65, "B+"], [0.55, "B"], [0.45, "B-"], [0.35, "C+"], [0.25, "C"], [0.15, "C-"], [-1, "D"]];

// After the Stanley Cup Final: the top prospects test at the Combine, Central Scouting
// publishes its final rankings, and you get interview slots and a little more budget.
export function runCombine(league) {
  const d = league.draft;
  const pool = classPool(league).sort((a, b) => (a.cs?.mid ?? 999) - (b.cs?.mid ?? 999));
  if (pool.some((p) => !p.cs)) rankClass(league, pool.map((p) => p.id));
  const invited = pool.slice(0, COMBINE_INVITES);
  for (const p of invited) p.combine = { tests: combineTests(p) };
  for (const test of COMBINE_TESTS) {
    const sorted = [...invited].sort((a, b) => (test.lowGood ? b.combine.tests[test.k] - a.combine.tests[test.k] : a.combine.tests[test.k] - b.combine.tests[test.k]));
    sorted.forEach((p, i) => ((p.combine.pcts ||= {})[test.k] = sorted.length > 1 ? i / (sorted.length - 1) : 0.5));
  }
  for (const p of invited) {
    p.combine.pct = avg(Object.values(p.combine.pcts));
    p.combine.grade = COMBINE_LETTERS.find(([min]) => p.combine.pct >= min)[1];
  }
  for (const p of pool) p.cs.fscore = p.cs.score + (p.combine ? (p.combine.pct - 0.5) * 2.6 : -0.4) + stream(`${p.id}|final`).gauss(0, 0.9);
  [...pool].sort((a, b) => b.cs.fscore - a.cs.fscore).forEach((p, i) => (p.cs.final = i + 1));
  if (d) {
    d.stage = "combine";
    d.interviewsLeft = COMBINE_INTERVIEWS;
    d.buzz = combineBuzz(pool, invited);
  }
  const t = league.teams[league.userTid];
  const s = t.scouts || {};
  const bonus = SCOUT_POINTS_COMBINE + (s.major?.trait === "combine" || s.minor?.trait === "combine" ? 3 : 0);
  t.scoutPts = (t.scoutPts || 0) + bonus;
  league.inbox?.push({ year: league.year, day: league.day, text: `The Scouting Combine is done: test results and Central Scouting's final rankings are out. You have ${COMBINE_INTERVIEWS} interview slots and ${bonus} extra scouting points before the draft.` });
}

function combineBuzz(pool, invited) {
  const top = pool.filter((p) => p.cs.mid <= 128 || p.cs.final <= 96);
  const short = (p) => `${p.name} (${p.pos}, ${p.bio?.team || "?"})`;
  const up = [...top].sort((a, b) => b.cs.mid - b.cs.final - (a.cs.mid - a.cs.final)).slice(0, 5).filter((p) => p.cs.mid > p.cs.final);
  const down = [...top].sort((a, b) => a.cs.mid - a.cs.final - (b.cs.mid - b.cs.final)).slice(0, 4).filter((p) => p.cs.final > p.cs.mid);
  const buzz = [];
  for (const p of up) buzz.push({ kind: "up", pid: p.id, text: `${short(p)} climbs from #${p.cs.mid} to #${p.cs.final}${p.combine ? ` after ${p.combine.grade[0] === "A" ? "an eye-opening" : "a solid"} Combine (${p.combine.grade})` : ""}.` });
  for (const p of down) buzz.push({ kind: "down", pid: p.id, text: `${short(p)} slides from #${p.cs.mid} to #${p.cs.final}${p.combine ? `; his ${p.combine.grade} Combine raised questions` : "; he wasn't invited to the Combine"}.` });
  for (const test of COMBINE_TESTS.slice(0, 4)) {
    const best = [...invited].sort((a, b) => (test.lowGood ? a.combine.tests[test.k] - b.combine.tests[test.k] : b.combine.tests[test.k] - a.combine.tests[test.k]))[0];
    if (best) buzz.push({ kind: "best", pid: best.id, text: `${short(best)} topped the ${test.name.toLowerCase()} (${best.combine.tests[test.k].toFixed(test.dp)}${test.unit ? ` ${test.unit}` : ""}).` });
  }
  return buzz;
}

const INTERVIEW_NOTES = {
  high: ["Rink rat: first on the ice, last off it.", "Obsessed with getting better; already has a summer training plan.", "Mature beyond his years. Teammates rave about him.", "Asked our staff more questions than we asked him."],
  mid: ["Polite, coachable, a little reserved.", "Says the right things; work habits look solid.", "Knows what he needs to improve and has a plan for it."],
  low: ["Coaches question his consistency.", "Needs to grow up away from the rink.", "Struggled to name anything in his game he needs to work on.", "The talent is there; the habits aren't yet."],
};

// A sit-down at the Combine: a read on his work ethic, which tends to go with how fast he develops.
export function interviewProspect(league, pid) {
  const d = league.draft;
  const p = league.players[pid];
  if (!d || d.stage !== "combine") return { ok: false, msg: "Interviews happen at the Scouting Combine, before the draft starts." };
  if (!p || p.tid !== -2 || !p.combine) return { ok: false, msg: "He wasn't invited to the Combine." };
  if (p.scout?.intv) return { ok: false, msg: "You've already interviewed him." };
  if ((d.interviewsLeft ?? 0) <= 0) return { ok: false, msg: "You've used all your interview slots." };
  d.interviewsLeft--;
  const r = stream(`${p.id}|intv`);
  const v = ({ superstar: 90, star: 85, normal: 77, late: 73 }[p.dev] ?? 77) + r.gauss(0, 3.5);
  (p.scout ||= { lvl: 0 }).intv = { grade: potGrade(v), note: r.pick(INTERVIEW_NOTES[v >= 85 ? "high" : v >= 77 ? "mid" : "low"]) };
  return { ok: true, msg: `Interview with ${p.name}: work ethic ${p.scout.intv.grade}.` };
}

export function openDraftFloor(league) {
  if (league.draft && league.draft.stage === "combine") league.draft.stage = "live";
}
export const atCombine = (league) => league.phase === "draft" && league.draft?.stage === "combine";

// ---------- Draft-day grades ----------

const GRADE_ORDER = ["D", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"];

// The analysts' instant grade: where he went against where Central Scouting had him.
export function pickGrade(overall, rank) {
  if (overall <= 3 && rank <= overall) return "A";
  const rel = (overall - rank) / Math.max(3, overall * 0.3);
  return rel >= 1.2 ? "A+" : rel >= 0.45 ? "A" : rel >= 0.1 ? "A-" : rel >= -0.25 ? "B+" : rel >= -0.6 ? "B" : rel >= -1 ? "B-" : rel >= -1.5 ? "C+" : rel >= -2.2 ? "C" : rel >= -3 ? "C-" : "D";
}

export function pickTake(grade, overall, rank) {
  if (grade === "A+") return `Steal. Central Scouting had him #${rank}.`;
  if (grade === "A") return overall <= rank ? `The best player available (Central Scouting #${rank}).` : `Great value at #${overall} (Central Scouting #${rank}).`;
  if (grade === "A-" || grade === "B+") return `About where he was expected to go (Central Scouting #${rank}).`;
  if (grade === "B" || grade === "B-") return `A bit of a reach, but there's plenty to like (Central Scouting #${rank}).`;
  if (grade[0] === "C") return `A reach. Most boards had him around #${rank}.`;
  return `Head-scratcher. Central Scouting ranked him #${rank}.`;
}

export function teamDraftGrade(league, tid) {
  const slots = (league.draft?.slots || []).filter((s) => s.owner === tid && s.pid && s.grade);
  if (!slots.length) return null;
  const i = Math.round(avg(slots.map((s) => GRADE_ORDER.indexOf(s.grade))));
  return GRADE_ORDER[clamp(i, 0, GRADE_ORDER.length - 1)];
}

// ---------- Your list ----------

export function myList(league) {
  const year = league.draftClassYear;
  if (!league.myList || league.myList.year !== year) league.myList = { year, ids: [] };
  return league.myList;
}
export const onMyList = (league, pid) => myList(league).ids.includes(pid);
export function toggleMyList(league, pid) {
  const l = myList(league);
  l.ids = l.ids.includes(pid) ? l.ids.filter((x) => x !== pid) : [...l.ids, pid];
}
export function moveOnMyList(league, pid, dir) {
  const l = myList(league);
  const i = l.ids.indexOf(pid);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= l.ids.length) return;
  [l.ids[i], l.ids[j]] = [l.ids[j], l.ids[i]];
}

// ---------- Old saves ----------

export function migrateScouting(l) {
  const user = l.teams[l.userTid];
  if (user && !("scouts" in user)) user.scouts = defaultScouts(l);
  if (!Array.isArray(l.scoutPool)) refreshScoutPool(l);
  for (const id in l.players) {
    const p = l.players[id];
    if (!p.dev) p.dev = rollDev(p.id, p.pot);
    if (!p.scout) continue;
    // Old reads: { lvl, eOvr, ePot } with lvl 2 meaning exact.
    if (!p.scout.base) {
      const old = { eOvr: p.scout.eOvr ?? p.ovr, ePot: p.scout.ePot ?? p.pot };
      p.scout.base = old;
      if (!p.scout.lvl) {
        delete p.scout.eOvr;
        delete p.scout.ePot;
      } else {
        p.scout.exact = p.scout.lvl >= 2;
        p.scout.sd = p.scout.lvl >= 2 ? 0 : 2;
        p.scout.by ||= "office";
        p.scout.who ||= "Your front office";
      }
    }
  }
  const cls = (l.draftClass || []).filter((id) => l.players[id]);
  if (cls.some((id) => !l.players[id].cs)) rankClass(l, cls);
  if (l.draft && !l.draft.stage) l.draft.stage = "live";
}
