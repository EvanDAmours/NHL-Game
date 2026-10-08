// 82-game schedule using the NHL formula:
//   division:      5 opponents x 4 games + 2 opponents x 3 games = 26
//   conference:    8 opponents (other division) x 3 games         = 24
//   other conf:   16 opponents x 2 games (home and away)           = 32
// Every team gets exactly 41 home games.
import { shuffle, rand, randInt } from "./rng.js";

export function generateSchedule(teams) {
  const games = [];
  const add = (h, a) => games.push({ h, a });
  const byDiv = {};
  for (const t of teams) (byDiv[t.div] ||= []).push(t.id);

  for (const div in byDiv) {
    const ids = shuffle([...byDiv[div]]);
    const n = ids.length;
    // Cycle neighbours play 3 times; the "earlier" team in the cycle gets 2 home games.
    const three = new Map();
    for (let k = 0; k < n; k++) three.set(key(ids[k], ids[(k + 1) % n]), ids[k]);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = ids[i];
        const b = ids[j];
        const heavy = three.get(key(a, b)) ?? three.get(key(b, a));
        if (heavy !== undefined) {
          const other = heavy === a ? b : a;
          add(heavy, other); add(heavy, other); add(other, heavy);
        } else {
          add(a, b); add(a, b); add(b, a); add(b, a);
        }
      }
    }
  }

  const confs = {};
  for (const t of teams) (confs[t.conf] ||= new Set()).add(t.div);
  for (const conf in confs) {
    const [d1, d2] = [...confs[conf]];
    const A = byDiv[d1];
    const B = byDiv[d2];
    for (let i = 0; i < A.length; i++) {
      for (let j = 0; j < B.length; j++) {
        if ((i + j) % 2 === 0) { add(A[i], B[j]); add(A[i], B[j]); add(B[j], A[i]); }
        else { add(B[j], A[i]); add(B[j], A[i]); add(A[i], B[j]); }
      }
    }
  }

  const east = teams.filter((t) => t.conf === "East").map((t) => t.id);
  const west = teams.filter((t) => t.conf === "West").map((t) => t.id);
  for (const e of east) for (const w of west) { add(e, w); add(w, e); }

  return packDays(games, teams.length);
}

const key = (a, b) => a + ":" + b;

function packDays(games, nTeams) {
  let remaining = shuffle(games.map((g, i) => ({ ...g, id: i })));
  const left = new Array(nTeams).fill(0);
  for (const g of remaining) { left[g.h]++; left[g.a]++; }
  const played = new Array(nTeams).fill(null).map(() => []);
  const out = [];
  let day = 0;
  while (remaining.length) {
    const dow = day % 7;
    const target = dow === 5 || dow === 1 ? randInt(10, 14) : randInt(5, 10);
    const busy = new Set();
    const prio = remaining.map((g) => ({ g, k: left[g.h] + left[g.a] + rand() * 8 })).sort((x, y) => y.k - x.k);
    const today = [];
    for (const { g } of prio) {
      if (today.length >= target) break;
      if (busy.has(g.h) || busy.has(g.a)) continue;
      if (threeInThree(played[g.h], day) || threeInThree(played[g.a], day)) continue;
      today.push(g);
      busy.add(g.h);
      busy.add(g.a);
    }
    const ids = new Set(today.map((g) => g.id));
    for (const g of today) {
      left[g.h]--;
      left[g.a]--;
      played[g.h].push(day);
      played[g.a].push(day);
      out.push({ id: out.length, day, h: g.h, a: g.a, played: false });
    }
    remaining = remaining.filter((g) => !ids.has(g.id));
    day++;
    if (day > 400) throw new Error("schedule packing failed");
  }
  return out;
}

function threeInThree(days, day) {
  const n = days.length;
  return n >= 2 && days[n - 1] === day - 1 && days[n - 2] === day - 2;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dayToDate(year, day) {
  const d = new Date(Date.UTC(year, 9, 7 + day));
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
export function lastDay(schedule) {
  return schedule.reduce((m, g) => Math.max(m, g.day), 0);
}
