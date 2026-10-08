// League-wide rules. Cap figures follow the NHL/NHLPA schedule
// ($104.0M for 2026-27, $113.5M for 2027-28); later years grow ~4%.

export const FIRST_SEASON = 2026; // season label 2026-27
export const SAVE_KEY = "rinkgm_save_v1";
export const SAVE_VERSION = 1;

const CAP_TABLE = { 2025: 95.5, 2026: 104.0, 2027: 113.5 };

export function capForYear(year) {
  if (CAP_TABLE[year]) return CAP_TABLE[year];
  if (year < 2025) return 95.5;
  return Math.round(113.5 * Math.pow(1.04, year - 2027) * 10) / 10;
}
export const capFloorForYear = (year) => Math.round(capForYear(year) * 0.74 * 10) / 10;
export const minSalaryForYear = (year) => (year <= 2026 ? 0.85 : year === 2027 ? 0.9 : Math.round(0.9 * Math.pow(1.03, year - 2027) * 100) / 100);
export const maxSalaryForYear = (year) => Math.round(capForYear(year) * 0.2 * 100) / 100;
export const ELC_SALARY = 0.975;

export const MAX_ROSTER = 23;
export const MIN_FORWARDS = 12;
export const MIN_DEFENSE = 6;
export const MIN_GOALIES = 2;
export const MAX_PROSPECTS = 20;

export const GAMES_PER_TEAM = 82;
export const DRAFT_ROUNDS = 4;
export const FA_DAYS = 30;
export const SCOUT_POINTS_START = 6; // in the bank when a new draft class is announced
export const SCOUT_POINTS_WEEKLY = 1; // earned each week of the regular season
export const SCOUT_POINTS_COMBINE = 4; // extra budget at the Scouting Combine
export const COMBINE_INVITES = 100;
export const COMBINE_INTERVIEWS = 3;

export const POSITIONS = ["C", "LW", "RW", "LD", "RD", "G"];
export const FORWARD_POS = ["C", "LW", "RW"];
export const DEFENSE_POS = ["LD", "RD"];
export const isForward = (pos) => pos === "C" || pos === "LW" || pos === "RW";
export const isDefense = (pos) => pos === "LD" || pos === "RD";
export const isGoalie = (pos) => pos === "G";
export const posGroup = (pos) => (isGoalie(pos) ? "G" : isDefense(pos) ? "D" : "F");

// EA SPORTS NHL player types.
export const ARCHETYPES = {
  SNP: { name: "Sniper", group: "F" },
  PLY: { name: "Playmaker", group: "F" },
  PWF: { name: "Power Forward", group: "F" },
  TWF: { name: "Two-Way Forward", group: "F" },
  GRN: { name: "Grinder", group: "F" },
  ENF: { name: "Enforcer", group: "F" },
  OFD: { name: "Offensive Defenseman", group: "D" },
  DFD: { name: "Defensive Defenseman", group: "D" },
  TWD: { name: "Two-Way Defenseman", group: "D" },
  END: { name: "Enforcer Defenseman", group: "D" },
  HYB: { name: "Hybrid", group: "G" },
  BFY: { name: "Butterfly", group: "G" },
  STD: { name: "Standup", group: "G" },
};

export const PHASES = {
  preseason: "Preseason",
  regular: "Regular Season",
  playoffs: "Playoffs",
  draft: "Entry Draft",
  resign: "Re-sign Players",
  freeagency: "Free Agency",
};

export const DIFFICULTY = {
  easy: { label: "Easy", tradeMargin: 0.95, faAskMult: 0.9, progressionBonus: 0.4 },
  normal: { label: "Normal", tradeMargin: 1.05, faAskMult: 1.0, progressionBonus: 0 },
  hard: { label: "Hard", tradeMargin: 1.18, faAskMult: 1.1, progressionBonus: -0.3 },
};
