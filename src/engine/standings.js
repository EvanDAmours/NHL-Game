// Standings, NHL tiebreakers and the divisional/wild-card playoff format.
import { DIVISIONS } from "./teams.js";

const ptsPct = (t) => (t.rec.gp ? t.rec.pts / (2 * t.rec.gp) : 0);

export function compareTeams(a, b) {
  return (
    b.rec.pts - a.rec.pts ||
    ptsPct(b) - ptsPct(a) ||
    b.rec.rw - a.rec.rw ||
    b.rec.row - a.rec.row ||
    b.rec.w - a.rec.w ||
    b.rec.gf - b.rec.ga - (a.rec.gf - a.rec.ga) ||
    b.rec.gf - a.rec.gf ||
    a.id - b.id
  );
}

export function divisionTable(league, div) {
  return league.teams.filter((t) => t.div === div).sort(compareTeams);
}

export function conferenceTable(league, conf) {
  return league.teams.filter((t) => t.conf === conf).sort(compareTeams);
}

export function leagueTable(league) {
  return [...league.teams].sort(compareTeams);
}

// Top three in each division plus two wild cards per conference.
export function playoffPicture(league, conf) {
  const [d1, d2] = DIVISIONS[conf];
  const A = divisionTable(league, d1);
  const B = divisionTable(league, d2);
  const top = new Set([...A.slice(0, 3), ...B.slice(0, 3)].map((t) => t.id));
  const wc = conferenceTable(league, conf).filter((t) => !top.has(t.id));
  return { divs: { [d1]: A.slice(0, 3), [d2]: B.slice(0, 3) }, wildcards: wc.slice(0, 2), out: wc.slice(2), order: [d1, d2] };
}

export function playoffTeams(league) {
  const ids = new Set();
  for (const conf of ["East", "West"]) {
    const pic = playoffPicture(league, conf);
    for (const d of pic.order) pic.divs[d].forEach((t) => ids.add(t.id));
    pic.wildcards.forEach((t) => ids.add(t.id));
  }
  return ids;
}

// Clinch / elimination markers for the standings page (x = clinched playoffs, e = eliminated).
export function clinchStatus(league) {
  const left = {};
  for (const t of league.teams) left[t.id] = 82 - t.rec.gp;
  const status = {};
  for (const conf of ["East", "West"]) {
    const table = conferenceTable(league, conf);
    const cut = table[7];
    const firstOut = table[8];
    for (const t of table) {
      const max = t.rec.pts + 2 * left[t.id];
      if (firstOut && t.rec.pts > firstOut.rec.pts + 2 * left[firstOut.id]) status[t.id] = "x";
      else if (cut && max < cut.rec.pts) status[t.id] = "e";
    }
  }
  return status;
}
