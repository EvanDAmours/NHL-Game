import React from "react";
import { useGame } from "./common.jsx";
import { DEV_TRAITS } from "../engine/players.js";
import { scoutProspect, bioStats, gradeClass, SCOUT_ROLES, SCOUT_GROUPS } from "../engine/scouting.js";
import { isGoalie } from "../engine/constants.js";

// One of your reads: "??" (no idea), "B+" (a scout's general idea), "~72" (a report) or "72" (exact).
export function Read({ label, txt, title }) {
  const kind = txt === "??" ? "unk" : txt.startsWith("~") ? "est" : /^[A-D]/.test(txt) ? `gen ${gradeClass(txt)}` : "exact";
  return (
    <span className={`rd ${kind}`} title={title}>
      <span className="rdl">{label}</span>
      <b>{txt}</b>
    </span>
  );
}

export function DevChip({ dev, unknown = "?" }) {
  if (!dev) return <span className="dev unk" title="Development trait unknown. Your major scout reveals it with a full workup.">Dev {unknown}</span>;
  return <span className={`dev ${dev}`} title={DEV_TRAITS[dev].desc}>{DEV_TRAITS[dev].name}</span>;
}

export function CovTag({ read }) {
  const role = read.cov;
  const title = read.scout ? `${SCOUT_ROLES[role].name}: ${read.scout.name} (${SCOUT_GROUPS[read.scout.group].toLowerCase()})` : "None of your scouts covers this position, so your front office's generalists file the reports.";
  return <span className={`cov ${role}`} title={title}>{role === "office" ? "No scout" : SCOUT_ROLES[role].short}</span>;
}

export function scoutLabel(read) {
  return read.lvl === 0 ? "Scout" : read.lvl === 1 ? "Workup" : "Scouted";
}

export function ScoutButton({ p, read, className = "tiny" }) {
  const { league, commit, toast } = useGame();
  const pts = league.teams[league.userTid].scoutPts || 0;
  const cost = read.cost;
  const tip = !cost
    ? "Fully scouted"
    : read.lvl === 0
      ? `File a scouting report (${cost} point)`
      : read.cov === "major"
        ? `Full workup (${cost} points): exact ratings and his development trait`
        : `Full workup (${cost} points): a sharper read`;
  return (
    <button
      className={`${className}${cost ? "" : " ghost"}`}
      disabled={!cost || pts < cost}
      title={tip}
      onClick={(e) => {
        e.stopPropagation();
        const r = scoutProspect(league, p.id);
        toast(r.msg);
        commit();
      }}
    >
      {cost ? `${scoutLabel(read)} · ${cost}` : "✓ Scouted"}
    </button>
  );
}

export function statText(league, p) {
  const s = bioStats(league, p);
  if (!s) return null;
  if (isGoalie(p.pos)) return `${s.gp} GP · ${s.svp.toFixed(3).slice(1)} SV% · ${s.gaa.toFixed(2)} GAA`;
  return `${s.gp} GP · ${s.g}-${s.a}-${s.pts}`;
}
