import React from "react";
import { useGame, Bar } from "./common.jsx";
import { fullPosName } from "../engine/players.js";
import { isGoalie, COMBINE_INVITES } from "../engine/constants.js";
import { makePick, currentSlot, draftDone } from "../engine/draft.js";
import {
  prospectRead, bioStats, csRank, fmtHeight, riskLabel, skillsFor, gradeClass, COMBINE_TESTS, interviewProspect,
  atCombine, onMyList, toggleMyList, pickTake, SCOUT_GROUPS, scoutGroup,
} from "../engine/scouting.js";
import { Read, DevChip, CovTag, ScoutButton } from "./scoutingBits.jsx";

function explain(read, p) {
  const grp = SCOUT_GROUPS[scoutGroup(p.pos)].toLowerCase();
  const pm = (sd) => `usually within ±${Math.max(1, Math.round(sd))}`;
  if (read.lvl >= 2) return read.exact ? "Full workup: these are his exact ratings." : `Full workup: estimates are ${pm(read.sd)}. Only a major scout gets to exact numbers.`;
  if (read.lvl === 1) {
    const next = read.cov === "major" ? "A full workup (2 points) gives exact ratings and his development trait." : read.cov === "minor" ? "A full workup (2 points) sharpens the estimates." : "A follow-up (2 points) sharpens the estimates a little.";
    return `Scouting report: estimates are ${pm(read.sd)}. ${next}`;
  }
  if (read.cov === "major") return `Your major scout's general idea of him is a ${read.pot} ceiling. A report (1 point) gives close estimates; a full workup (2 more) gives exact ratings and his development trait.`;
  if (read.cov === "minor") return `Your minor scout's general idea of him is a ${read.pot} ceiling. A report (1 point) gives estimates and a workup (2 more) sharpens them. Minor scouts don't see development traits.`;
  return `None of your scouts covers ${grp}. Your front office can still file a rough report (1 point) and a follow-up (2 more), but never exact numbers or a development trait.`;
}

export default function ProspectProfile({ p }) {
  const { league, commit, toast, openPlayer, closeModal } = useGame();
  const user = league.teams[league.userTid];
  const read = prospectRead(league, p);
  const s = p.scout || {};
  const b = p.bio || {};
  const stats = bioStats(league, p);
  const goalie = isGoalie(p.pos);
  const d = league.draft;
  const live = league.phase === "draft" && d && d.stage !== "combine" && !draftDone(league);
  const slot = live ? currentSlot(league) : null;
  const onClock = !!slot && slot.owner === user.id;
  const combine = atCombine(league);
  const listed = onMyList(league, p.id);

  const draft = () => {
    const sl = currentSlot(league);
    if (!makePick(league, p.id)) return;
    toast(`You selected ${p.name}. Analysts: ${sl.grade}. ${pickTake(sl.grade, sl.overall, sl.csr)}`, 5000);
    commit();
    closeModal();
  };
  const interview = () => {
    const r = interviewProspect(league, p.id);
    toast(r.msg);
    commit();
  };

  const statLine = !stats
    ? "The junior season hasn't started"
    : goalie
      ? `${stats.gp} GP · ${stats.w} W · ${stats.svp.toFixed(3).slice(1)} SV% · ${stats.gaa.toFixed(2)} GAA · ${stats.so} SO`
      : `${stats.gp} GP · ${stats.g} G · ${stats.a} A · ${stats.pts} PTS · ${stats.pim} PIM`;

  return (
    <div className="stack">
      <div className="row" style={{ gap: 16, alignItems: "flex-start" }}>
        <div className="ppcs">
          <span className="dlab">Central Scouting</span>
          <b>#{csRank(p)}</b>
          <span className="tiny muted">{p.cs?.final ? `final · midterm #${p.cs.mid}` : "midterm ranking"}</span>
        </div>
        <div className="kv" style={{ flex: 1, minWidth: 220 }}>
          <span className="k">Position</span><span>{fullPosName(p.pos)} · {goalie ? "catches" : "shoots"} {p.shoots}</span>
          <span className="k">Age</span><span>{p.age}{b.town ? ` · from ${b.town}` : ""}{p.nat ? ` (${p.nat})` : ""}</span>
          {b.ht && (<><span className="k">Size</span><span>{fmtHeight(b.ht)} · {b.wt} lbs</span></>)}
          {b.team && (<><span className="k">Team</span><span>{b.team} ({b.lg})</span></>)}
          <span className="k">This season</span><span>{statLine}</span>
        </div>
      </div>

      <div className="panel">
        <h3>Your read <span className="right"><CovTag read={read} /></span></h3>
        <div className="row" style={{ gap: 12 }}>
          <Read label="OVR" txt={read.ovr} />
          <Read label="POT" txt={read.pot} />
          <DevChip dev={read.dev} />
          {read.tier && <span className="small">Projects as <b>{read.tier}</b></span>}
          {read.lvl > 0 && <span className="pill">{riskLabel(s.eOvr, s.ePot)}</span>}
        </div>
        <div className="muted small" style={{ margin: "10px 0" }}>{explain(read, p)}</div>
        <div className="row">
          <ScoutButton p={p} read={read} className="small primary" />
          <span className="muted small">{user.scoutPts || 0} scouting point{user.scoutPts === 1 ? "" : "s"} left</span>
        </div>
      </div>

      {read.lvl > 0 && s.skills && (
        <div className="panel">
          <h3>Scouting report <span className="right muted small" style={{ textTransform: "none", letterSpacing: 0 }}>by {s.who}</span></h3>
          <div className="skillgrid">
            {Object.entries(skillsFor(p.pos)).map(([k, sk]) => (
              <div className="skill" key={k}>
                <span>{sk.name}</span>
                <span className={`grade ${gradeClass(s.skills[k]?.g)}`}>{s.skills[k]?.g}</span>
              </div>
            ))}
          </div>
          <div className="muted tiny" style={{ marginTop: 4 }}>Tools graded at his projected NHL level.</div>
          <div className="grid g2" style={{ marginTop: 10 }}>
            <div>
              <div className="dlab">Strengths</div>
              {s.notes?.strengths.map((x) => <div key={x} className="small">+ {x}</div>)}
            </div>
            <div>
              <div className="dlab">Concerns</div>
              {s.notes?.weaknesses.map((x) => <div key={x} className="small">– {x}</div>)}
            </div>
          </div>
          {s.comp && (
            <div className="small" style={{ marginTop: 10 }}>
              NHL comparable:{" "}
              {league.players[s.comp.pid] ? <span className="link" onClick={() => openPlayer(s.comp.pid)}>{s.comp.name}</span> : <b>{s.comp.name}</b>} ({s.comp.abbr})
            </div>
          )}
        </div>
      )}

      {p.combine && (
        <div className="panel">
          <h3>Scouting Combine <span className={`grade ${gradeClass(p.combine.grade)}`}>{p.combine.grade}</span></h3>
          <div className="ctests">
            {COMBINE_TESTS.map((t) => (
              <div className="ctest" key={t.k}>
                <span className="dlab">{t.name}</span>
                <b className="mono">{p.combine.tests[t.k].toFixed(t.dp)}{t.unit ? ` ${t.unit}` : ""}</b>
                <Bar v={Math.round(p.combine.pcts[t.k] * 99)} />
              </div>
            ))}
          </div>
          <div className="muted tiny" style={{ marginTop: 6 }}>Bars show where he ranked among the {COMBINE_INVITES} invited prospects.</div>
          {s.intv ? (
            <div className="intv">
              <span className="dlab">Your interview</span>
              <div>Work ethic <span className={`grade ${gradeClass(s.intv.grade)}`}>{s.intv.grade}</span> · <i>"{s.intv.note}"</i></div>
            </div>
          ) : (
            combine && (
              <div className="row" style={{ marginTop: 8 }}>
                <button className="small" disabled={!(d.interviewsLeft > 0)} onClick={interview}>Interview him</button>
                <span className="muted small">{d.interviewsLeft} interview{d.interviewsLeft === 1 ? "" : "s"} left. Work ethic tends to go with how fast a player develops.</span>
              </div>
            )
          )}
        </div>
      )}

      <div className="row">
        <button onClick={() => { toggleMyList(league, p.id); commit(); }}>{listed ? "★ On your list" : "☆ Add to your list"}</button>
        {live && <button className="primary" disabled={!onClock} title={onClock ? "" : "Wait until you're on the clock"} onClick={draft}>Draft {p.name}</button>}
      </div>
    </div>
  );
}
