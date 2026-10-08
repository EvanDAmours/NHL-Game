import React, { useState } from "react";
import { useGame, PlayerName, TeamBadge, TeamName, Bar } from "./common.jsx";
import { makePick, currentSlot, draftDone, pickLabel, aiChoose } from "../engine/draft.js";
import { DRAFT_ROUNDS, SCOUT_POINTS_START, SCOUT_POINTS_WEEKLY, SCOUT_POINTS_COMBINE, COMBINE_INVITES } from "../engine/constants.js";
import {
  projection, prospectRead, classPool, csRank, fmtHeight, gradeClass, COMBINE_TESTS, interviewProspect, atCombine, openDraftFloor,
  myList, onMyList, toggleMyList, moveOnMyList, pickTake, teamDraftGrade, SCOUT_GROUPS, SCOUT_ROLES, SCOUT_TRAITS,
  staffWindowOpen, hireScout, releaseScout, swapScoutRoles, scoutGroup,
} from "../engine/scouting.js";
import { Read, DevChip, CovTag, ScoutButton, statText } from "./scoutingBits.jsx";

const POSITIONS = ["all", "C", "LW", "RW", "LD", "RD", "G"];
const PAGE = 50;

// ---------- Big Board rows ----------

function Arrow({ p }) {
  if (!p.cs?.final || p.cs.final === p.cs.mid) return null;
  const up = p.cs.final < p.cs.mid;
  return <span className={`csmove ${up ? "up" : "down"}`} title={`Midterm #${p.cs.mid} → final #${p.cs.final}`}>{up ? "▲" : "▼"}{Math.abs(p.cs.mid - p.cs.final)}</span>;
}

function ProspectRow({ p, onDraft, canDraft }) {
  const { league, commit } = useGame();
  const read = prospectRead(league, p);
  const listed = onMyList(league, p.id);
  const b = p.bio || {};
  const drafted = p.tid !== -2;
  const slot = drafted && league.draft ? league.draft.slots.find((s) => s.pid === p.id) : null;
  const stats = statText(league, p);
  return (
    <div className={`prow${drafted ? " gone" : ""}`}>
      <span className="prank">{csRank(p)}<Arrow p={p} /></span>
      <div className="pwho">
        <div className="pname">
          <button className={`star${listed ? " on" : ""}`} title={listed ? "Remove from your list" : "Add to your list"} aria-label={listed ? "Remove from your list" : "Add to your list"} onClick={() => { toggleMyList(league, p.id); commit(); }}>{listed ? "★" : "☆"}</button>
          <PlayerName p={p} />
          <span className="posbadge">{p.pos}</span>
        </div>
        <div className="tiny muted pmeta">{p.age} · {b.ht ? `${fmtHeight(b.ht)} ${b.wt}` : ""} · {b.team} <span className="dim">({b.lg})</span></div>
        {stats && <div className="tiny muted pmeta">{stats}</div>}
      </div>
      <div className="pread">
        <Read label="OVR" txt={read.ovr} />
        <Read label="POT" txt={read.pot} title={read.tier ? `Projects as ${read.tier}` : undefined} />
        <DevChip dev={read.dev} />
      </div>
      <div className="pact">
        {drafted ? (
          <span className="small muted">{slot ? <>#{slot.overall} <TeamName tid={slot.owner} short /></> : "Drafted"}</span>
        ) : (
          <>
            <CovTag read={read} />
            <ScoutButton p={p} read={read} />
            {onDraft && <button className="tiny primary" disabled={!canDraft} onClick={() => onDraft(p)}>Draft</button>}
          </>
        )}
      </div>
    </div>
  );
}

function Board({ onDraft, canDraft, availableOnly = false, title = "Big Board" }) {
  const { league } = useGame();
  const [pos, setPos] = useState("all");
  const [q, setQ] = useState("");
  const [show, setShow] = useState("all");
  const [hideTaken, setHideTaken] = useState(true);
  const [n, setN] = useState(PAGE);
  const user = league.teams[league.userTid];
  const s = user.scouts || {};
  const myGroups = [s.major?.group, s.minor?.group].filter(Boolean);
  const all = (league.draftClass || []).map((id) => league.players[id]).filter(Boolean);
  // Always Central Scouting order: scouting a player never moves him on the board.
  const list = all
    .filter((p) => !(availableOnly || hideTaken) || p.tid === -2)
    .filter((p) => pos === "all" || p.pos === pos)
    .filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || (p.bio?.team || "").toLowerCase().includes(q.toLowerCase()))
    .filter((p) => show === "all" || (show === "scouted" ? p.scout?.lvl > 0 : show === "unscouted" ? !p.scout?.lvl : show === "list" ? onMyList(league, p.id) : myGroups.includes(scoutGroup(p.pos))))
    .sort((a, b) => csRank(a) - csRank(b));
  return (
    <div className="panel">
      <h3>
        {title}
        <span className="right muted small" style={{ textTransform: "none", letterSpacing: 0 }}>Central Scouting {all.some((p) => p.cs?.final) ? "final" : "midterm"} order</span>
      </h3>
      <div className="row" style={{ gap: 4, marginBottom: 8 }}>
        {POSITIONS.map((x) => (
          <button key={x} className={`small${pos === x ? " primary" : ""}`} onClick={() => { setPos(x); setN(PAGE); }}>{x === "all" ? "All" : x}</button>
        ))}
      </div>
      <div className="row" style={{ gap: 6, marginBottom: 10 }}>
        <input className="search" placeholder="Search name or team" value={q} onChange={(e) => { setQ(e.target.value); setN(PAGE); }} aria-label="Search prospects" />
        <select value={show} onChange={(e) => { setShow(e.target.value); setN(PAGE); }} aria-label="Show">
          <option value="all">Everyone</option>
          <option value="covered">Positions my scouts cover</option>
          <option value="scouted">Scouted</option>
          <option value="unscouted">Not scouted yet</option>
          <option value="list">On my list</option>
        </select>
        {!availableOnly && league.phase === "draft" && (
          <label className="small muted row" style={{ gap: 4 }}>
            <input type="checkbox" checked={hideTaken} onChange={(e) => setHideTaken(e.target.checked)} /> Hide drafted
          </label>
        )}
      </div>
      <div className="plist">
        {list.slice(0, n).map((p) => <ProspectRow key={p.id} p={p} onDraft={onDraft} canDraft={canDraft} />)}
        {!list.length && <div className="dim small">No prospects match.</div>}
      </div>
      {list.length > n && <div style={{ marginTop: 10 }}><button className="small" onClick={() => setN(n + PAGE)}>Show more ({list.length - n} left)</button></div>}
    </div>
  );
}

function Legend() {
  return (
    <div className="legend small muted">
      <span><span className="rd unk"><b>??</b></span> not scouted</span>
      <span><span className="rd gen gb"><b>B+</b></span> a scout's general idea of his ceiling</span>
      <span><span className="rd est"><b>~84</b></span> estimate from a report</span>
      <span><span className="rd exact"><b>84</b></span> exact (major scout's full workup)</span>
    </div>
  );
}

// ---------- Your list ----------

function MyListPanel({ onDraft, canDraft, compact = false }) {
  const { league, commit } = useGame();
  const ids = myList(league).ids.filter((id) => league.players[id]);
  const ps = ids.map((id) => league.players[id]);
  const shown = compact ? ps.filter((p) => p.tid === -2).slice(0, 6) : ps;
  return (
    <div className="panel">
      <h3>Your list <span className="right muted small" style={{ textTransform: "none", letterSpacing: 0 }}>{ps.filter((p) => p.tid === -2).length} available</span></h3>
      {!ps.length && <div className="dim small">Star prospects on the Big Board (☆) to build your own ranking. It stays in the order you set.</div>}
      <div className="list">
        {shown.map((p) => {
          const i = ids.indexOf(p.id);
          const read = prospectRead(league, p);
          const taken = p.tid !== -2;
          const slot = taken && league.draft ? league.draft.slots.find((s) => s.pid === p.id) : null;
          return (
            <div className={`item small mlrow${taken ? " gone" : ""}`} key={p.id}>
              <b className="mono">{i + 1}.</b>
              <span className="posbadge">{p.pos}</span>
              <PlayerName p={p} />
              <span className="muted">CS #{csRank(p)}</span>
              <span className="mlread">
                <Read label="OVR" txt={read.ovr} />
                <Read label="POT" txt={read.pot} />
              </span>
              <span className="mlact">
                {taken ? (
                  <span className="muted">{slot ? `#${slot.overall} ${league.teams[slot.owner].abbr}` : "Drafted"}</span>
                ) : (
                  <>
                    {!compact && <button className="tiny ghost" aria-label="Move up" disabled={i === 0} onClick={() => { moveOnMyList(league, p.id, -1); commit(); }}>▲</button>}
                    {!compact && <button className="tiny ghost" aria-label="Move down" disabled={i === ids.length - 1} onClick={() => { moveOnMyList(league, p.id, 1); commit(); }}>▼</button>}
                    {onDraft && <button className="tiny primary" disabled={!canDraft} onClick={() => onDraft(p)}>Draft</button>}
                  </>
                )}
                {!compact && <button className="tiny ghost" aria-label="Remove from list" onClick={() => { toggleMyList(league, p.id); commit(); }}>✕</button>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Scouting staff ----------

function ScoutCard({ scout, role, children }) {
  return (
    <div className={`scard${scout ? "" : " empty"}`}>
      <div className="row" style={{ gap: 8 }}>
        <span className={`cov ${role}`}>{SCOUT_ROLES[role]?.name || "Available"}</span>
        {scout && <b>{SCOUT_GROUPS[scout.group]}</b>}
      </div>
      {scout ? (
        <>
          <div className="scname">{scout.name}</div>
          <div className="tiny muted">{scout.age} · {scout.bg}</div>
          <div className="row" style={{ gap: 8, marginTop: 4 }}>
            <span className="dlab" style={{ width: 70 }}>Evaluation</span>
            <span style={{ flex: 1 }}><Bar v={scout.eval} /></span>
            <b className="mono">{scout.eval}</b>
          </div>
          {scout.trait ? <div className="small"><span className="pill on">{SCOUT_TRAITS[scout.trait].name}</span> <span className="muted">{SCOUT_TRAITS[scout.trait].desc}</span></div> : <div className="tiny dim">No special trait</div>}
        </>
      ) : (
        <div className="small muted" style={{ marginTop: 6 }}>Vacant. Hire someone from the list below.</div>
      )}
      {children}
    </div>
  );
}

function ScoutsView() {
  const { league, commit, toast } = useGame();
  const user = league.teams[league.userTid];
  const s = user.scouts || {};
  const open = staffWindowOpen(league);
  const act = (r) => {
    toast(r.msg);
    commit();
  };
  const pool = [...(league.scoutPool || [])].sort((a, b) => a.group.localeCompare(b.group) || b.eval - a.eval);
  const blocked = (sc, role) => {
    const other = s[role === "major" ? "minor" : "major"];
    return other && other.group === sc.group ? `Your ${SCOUT_ROLES[role === "major" ? "minor" : "major"].name.toLowerCase()} already covers ${SCOUT_GROUPS[sc.group].toLowerCase()}` : null;
  };
  return (
    <div className="stack">
      <div className="panel">
        <h3>Scouting points <span className="right"><b className="ptsbig">{user.scoutPts || 0}</b></span></h3>
        <div className="muted small">
          You start each season with {SCOUT_POINTS_START}, earn {SCOUT_POINTS_WEEKLY} every week of the regular season, and get {SCOUT_POINTS_COMBINE} more at the Scouting Combine. A scouting report costs 1 point and a full workup 2 more. Unused points expire after the draft.
        </div>
      </div>
      <div className="sgrid">
        {["major", "minor"].map((role) => (
          <ScoutCard key={role} scout={s[role]} role={role}>
            <div className="tiny muted" style={{ marginTop: 6 }}>{SCOUT_ROLES[role].desc}</div>
            {open && s[role] && <div className="row" style={{ marginTop: 8 }}><button className="tiny ghost" onClick={() => act(releaseScout(league, role))}>Let go</button></div>}
          </ScoutCard>
        ))}
      </div>
      {open && (s.major || s.minor) && <div><button className="small" onClick={() => act(swapScoutRoles(league))}>⇄ Swap major and minor roles</button></div>}

      <div className="panel">
        <h3>What your scouts can tell you</h3>
        <div className="tablewrap">
          <table className="t howto">
            <thead>
              <tr><th></th><th>Without a report</th><th>Scouting report (1 pt)</th><th>Full workup (+2 pts)</th></tr>
            </thead>
            <tbody>
              <tr><td><b>Major scout's position</b>{s.major ? <div className="tiny muted">{SCOUT_GROUPS[s.major.group]}</div> : null}</td><td>A general idea of every prospect's ceiling (letter grade)</td><td>Close estimates, tool grades, strengths, an NHL comparable</td><td><b>Exact ratings and his development trait</b></td></tr>
              <tr><td><b>Minor scout's position</b>{s.minor ? <div className="tiny muted">{SCOUT_GROUPS[s.minor.group]}</div> : null}</td><td>A rougher general idea of every prospect's ceiling</td><td>Looser estimates and the full write-up</td><td>Sharper estimates (no development trait)</td></tr>
              <tr><td><b>Other positions</b></td><td>Only Central Scouting's ranking</td><td>A rough estimate from the front office</td><td>A slightly better estimate</td></tr>
            </tbody>
          </table>
        </div>
        <div className="muted small" style={{ marginTop: 8 }}>A scout's Evaluation rating sets how close his reads are. The Big Board never reorders when you scout: it's always in Central Scouting's order, and your own ranking lives in Your list.</div>
      </div>

      <div className="panel">
        <h3>Scouts available</h3>
        {!open && <div className="notice warn" style={{ marginBottom: 10 }}>Your scouts are on the road for the season. You can change your staff after the draft or in the preseason.</div>}
        <div className="sgrid pool">
          {pool.map((sc) => (
            <ScoutCard key={sc.id} scout={sc} role="pool">
              {open && (
                <div className="row" style={{ marginTop: 8, gap: 6 }}>
                  {["major", "minor"].map((role) => (
                    <button key={role} className="tiny" disabled={!!blocked(sc, role)} title={blocked(sc, role) || `Hire him as your ${SCOUT_ROLES[role].name.toLowerCase()}${s[role] ? ` (replacing ${s[role].name})` : ""}`} onClick={() => act(hireScout(league, sc.id, role))}>
                      Hire as {role}
                    </button>
                  ))}
                </div>
              )}
            </ScoutCard>
          ))}
          {!pool.length && <div className="dim small">Nobody's looking for work right now.</div>}
        </div>
      </div>
    </div>
  );
}

// ---------- Scouting Combine ----------

function CombineView() {
  const { league, commit, toast } = useGame();
  const d = league.draft;
  const live = atCombine(league);
  const invited = classPool(league).filter((p) => p.combine).sort((a, b) => csRank(a) - csRank(b));
  const allInvited = (league.draftClass || []).map((id) => league.players[id]).filter((p) => p?.combine).sort((a, b) => csRank(a) - csRank(b));
  const rows = live ? invited : allInvited;
  const [n, setN] = useState(40);
  const interview = (p) => {
    const r = interviewProspect(league, p.id);
    toast(r.msg);
    commit();
  };
  return (
    <div className="stack">
      <div className="dgrid">
        <div className="panel">
          <h3>Results <span className="right muted small" style={{ textTransform: "none", letterSpacing: 0 }}>{COMBINE_INVITES} invited · final Central Scouting order</span></h3>
          <div className="tablewrap">
            <table className="t combine">
              <thead>
                <tr>
                  <th>CS</th><th>Player</th><th>Size</th>
                  {COMBINE_TESTS.map((t) => <th key={t.k} className="num" title={`${t.name}${t.unit ? ` (${t.unit})` : ""}${t.lowGood ? ", lower is better" : ""}`}>{t.short}</th>)}
                  <th>Grade</th><th>Interview</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, n).map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{csRank(p)} <Arrow p={p} /></td>
                    <td><PlayerName p={p} /> <span className="posbadge">{p.pos}</span></td>
                    <td className="nowrap">{p.bio ? `${fmtHeight(p.bio.ht)} ${p.bio.wt}` : ""}</td>
                    {COMBINE_TESTS.map((t) => (
                      <td key={t.k} className={`num${p.combine.pcts[t.k] >= 0.9 ? " top" : ""}`}>{p.combine.tests[t.k].toFixed(t.dp)}</td>
                    ))}
                    <td><span className={`grade ${gradeClass(p.combine.grade)}`}>{p.combine.grade}</span></td>
                    <td className="nowrap">
                      {p.scout?.intv ? (
                        <span title={p.scout.intv.note}>Work ethic <span className={`grade ${gradeClass(p.scout.intv.grade)}`}>{p.scout.intv.grade}</span></span>
                      ) : live ? (
                        <button className="tiny" disabled={!(d.interviewsLeft > 0)} onClick={() => interview(p)}>Interview</button>
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > n && <div style={{ marginTop: 10 }}><button className="small" onClick={() => setN(n + 30)}>Show more ({rows.length - n} left)</button></div>}
          <div className="muted tiny" style={{ marginTop: 6 }}>Highlighted results are in the top 10%. Hover a column for the test; pro agility is timed, so lower is better.</div>
        </div>
        <div className="stack">
          {live && (
            <div className="panel hot">
              <h3>Before the draft</h3>
              <div className="small">Interviews left: <b>{d.interviewsLeft}</b> · Scouting points: <b>{league.teams[league.userTid].scoutPts || 0}</b></div>
              <div className="muted small" style={{ margin: "6px 0 10px" }}>Interviews read a prospect's work ethic, which tends to go with how fast he develops. Spend your last scouting points, then head to the draft floor.</div>
              <button className="primary" onClick={() => { openDraftFloor(league); commit(); }}>Start the draft →</button>
            </div>
          )}
          <div className="panel">
            <h3>Draft buzz</h3>
            <div className="stack" style={{ gap: 6 }}>
              {(d?.buzz || []).map((x, i) => (
                <div key={i} className={`wire buzz ${x.kind}`}>
                  <span className="wtag">{x.kind === "up" ? "RISING" : x.kind === "down" ? "FALLING" : "TOP TEST"}</span>
                  <span className="small">{x.text}</span>
                </div>
              ))}
              {!d?.buzz?.length && <div className="dim small">No buzz yet.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Draft floor ----------

function DraftFloor({ act, onDraft, canDraft }) {
  const { league, commit } = useGame();
  const user = league.teams[league.userTid];
  const d = league.draft;
  const done = draftDone(league);
  const slot = !done ? currentSlot(league) : null;
  const onClock = slot && slot.owner === user.id;
  const [roundSel, setRound] = useState(null);
  const round = roundSel ?? (slot ? slot.round : DRAFT_ROUNDS);
  const upcoming = !done ? d.slots.slice(d.idx + 1, d.idx + 9) : [];
  const listTop = myList(league).ids.map((id) => league.players[id]).find((p) => p && p.tid === -2);
  const bpa = classPool(league).sort((a, b) => csRank(a) - csRank(b))[0];
  const mine = d.slots.filter((s) => s.owner === user.id && s.pid);
  const nextPick = () => {
    if (!slot || onClock) return;
    makePick(league, aiChoose(league, slot.owner));
    commit();
  };
  const slotLine = (s) => {
    const p = s.pid ? league.players[s.pid] : null;
    const now = slot && s.overall === slot.overall;
    return (
      <div key={s.overall} className={`dslot${s.owner === user.id ? " mine" : ""}${now ? " now" : ""}`}>
        <span className="dnum">{s.overall}</span>
        <TeamBadge team={league.teams[s.owner]} size={22} />
        <span className="dslot-main">
          {p ? <><PlayerName p={p} /> <span className="dim small">{p.pos}</span></> : now ? <b>On the clock</b> : <span className="dim">{league.teams[s.owner].abbr} · round {s.round}, pick {((s.overall - 1) % 32) + 1}</span>}
          {s.orig !== s.owner && <span className="dim small"> (from {league.teams[s.orig].abbr})</span>}
        </span>
        {s.grade && <span className={`grade sm ${gradeClass(s.grade)}`} title={pickTake(s.grade, s.overall, s.csr)}>{s.grade}</span>}
      </div>
    );
  };
  const grades = done ? league.teams.map((t) => ({ t, g: teamDraftGrade(league, t.id) })).filter((x) => x.g) : [];
  const order = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D"];
  grades.sort((a, b) => order.indexOf(a.g) - order.indexOf(b.g));

  return (
    <div className="stack">
      {!done && (
        <div className={`otc${onClock ? " you" : ""}`} style={{ "--c1": league.teams[slot.owner].colors[0] }}>
          <TeamBadge team={league.teams[slot.owner]} size={52} />
          <div style={{ minWidth: 0 }}>
            <div className="otc-k">{onClock ? "You're on the clock" : "On the clock"}</div>
            <div className="otc-t">{league.teams[slot.owner].city} {league.teams[slot.owner].name}</div>
            <div className="small muted">
              Pick {slot.overall} overall · round {slot.round}, pick {((slot.overall - 1) % 32) + 1}
              {slot.orig !== slot.owner ? ` · from ${league.teams[slot.orig].abbr}` : ""}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          {onClock ? (
            <div className="row">
              {listTop && <button className="primary" onClick={() => onDraft(listTop)}>Draft {listTop.name} <span className="tiny">(your list)</span></button>}
              {bpa && (!listTop || bpa.id !== listTop.id) && <button className={listTop ? "" : "primary"} onClick={() => onDraft(bpa)}>Draft {bpa.name} <span className="tiny">(CS #{csRank(bpa)})</span></button>}
            </div>
          ) : (
            <div className="row">
              <button onClick={nextPick}>Next pick</button>
              <button className="primary" onClick={act.simToMyPick}>Sim to my pick</button>
            </div>
          )}
        </div>
      )}
      {done && (
        <div className="otc you">
          <div>
            <div className="otc-k">Draft complete</div>
            <div className="otc-t">Your new prospects are in the minors.</div>
            {teamDraftGrade(league, user.id) && <div className="small muted">Analysts give your class a <b>{teamDraftGrade(league, user.id)}</b>.</div>}
          </div>
          <div style={{ flex: 1 }} />
          <button className="primary" onClick={act.toResign}>Continue to re-signing →</button>
        </div>
      )}
      {upcoming.length > 0 && (
        <div className="row small" style={{ gap: 6 }}>
          <span className="muted">Up next:</span>
          {upcoming.map((s) => <span key={s.overall} className={`pill${s.owner === user.id ? " on" : ""}`}>#{s.overall} {league.teams[s.owner].abbr}</span>)}
        </div>
      )}
      {d.lottery?.draws?.length > 0 && d.idx < 32 && (
        <div className="panel">
          <h3>Draft lottery</h3>
          <div className="row" style={{ gap: 14 }}>
            {d.lottery.draws.map((x, i) => (
              <span key={i} className="row" style={{ gap: 6 }}>
                <b>#{i + 1}</b> <TeamBadge team={league.teams[x.id]} size={20} /> <TeamName tid={x.id} />
                <span className="muted small">{x.from > x.to ? `jumped from ${x.from}` : x.to === 1 ? "held the top spot" : "kept its spot"}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="dgrid">
        {!done ? <Board onDraft={onDraft} canDraft={onClock} availableOnly title="Best available" /> : (
          <div className="panel">
            <h3>Draft grades</h3>
            <div className="muted small" style={{ marginBottom: 8 }}>Instant grades compare where each player went with where Central Scouting had him. Analysts don't know what your scouts know.</div>
            <div className="ggrid">
              {grades.map(({ t, g }) => (
                <div key={t.id} className={`gcell${t.id === user.id ? " mine" : ""}`}><TeamBadge team={t} size={22} /> <b>{t.abbr}</b> <span className={`grade ${gradeClass(g)}`}>{g}</span></div>
              ))}
            </div>
          </div>
        )}
        <div className="stack">
          {!done && <MyListPanel onDraft={onDraft} canDraft={onClock} compact />}
          <div className="panel">
            <h3>Draft order</h3>
            <div className="row" style={{ gap: 4, marginBottom: 8 }}>
              {Array.from({ length: DRAFT_ROUNDS }, (_, i) => i + 1).map((r) => (
                <button key={r} className={`small${round === r ? " primary" : ""}`} onClick={() => setRound(r)}>Round {r}</button>
              ))}
            </div>
            <div className="dorder">{d.slots.filter((s) => s.round === round).map(slotLine)}</div>
          </div>
          <div className="panel">
            <h3>Your picks</h3>
            <div className="list">
              {d.slots.filter((s) => s.owner === user.id && !s.pid).map((s) => (
                <div className="item small" key={s.overall}><b>#{s.overall}</b> round {s.round}{s.orig !== user.id ? ` (from ${league.teams[s.orig].abbr})` : ""}</div>
              ))}
              {mine.map((s) => {
                const p = league.players[s.pid];
                return p ? (
                  <div className="item small" key={s.overall}>
                    <b>#{s.overall}</b> <PlayerName p={p} /> <span className="dim">{p.pos}</span>
                    <span className="muted" style={{ marginLeft: "auto" }}>{projection(p.pos, p.pot)}</span>
                    {s.grade && <span className={`grade sm ${gradeClass(s.grade)}`} title={pickTake(s.grade, s.overall, s.csr)}>{s.grade}</span>}
                  </div>
                ) : null;
              })}
              {!d.slots.some((s) => s.owner === user.id) && <div className="dim small">You don't have a pick in this draft.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Page ----------

export default function DraftPage({ act }) {
  const { league, commit, toast } = useGame();
  const user = league.teams[league.userTid];
  const inDraft = league.phase === "draft" && !!league.draft;
  const combine = atCombine(league);
  const hasCombine = (league.draftClass || []).some((id) => league.players[id]?.combine);
  const defaultView = inDraft ? (combine ? "combine" : "floor") : "board";
  // A tab you pick sticks until the draft moves on (combine → draft floor → done).
  const stageKey = `${league.phase}|${league.draft?.stage || ""}`;
  const [sel, setSel] = useState({ v: null, k: stageKey });
  const viewSel = sel.k === stageKey ? sel.v : null;
  const setView = (v) => setSel({ v, k: stageKey });
  const views = [
    inDraft && !combine && ["floor", "Draft floor"],
    ["board", "Big Board"],
    ["list", `Your list (${myList(league).ids.length})`],
    hasCombine && ["combine", "Combine"],
    ["scouts", "Scouts"],
  ].filter(Boolean);
  const view = views.some(([k]) => k === viewSel) ? viewSel : defaultView;
  const year = inDraft ? league.draft.year : league.draftClassYear;
  const done = inDraft && draftDone(league);
  const slot = inDraft && !combine && !done ? currentSlot(league) : null;
  const onClock = !!slot && slot.owner === user.id;
  const futurePicks = league.draftPicks.filter((p) => p.owner === user.id && (!inDraft || p.year !== league.draft.year)).sort((a, b) => a.year - b.year || a.round - b.round);

  const draft = (p) => {
    if (!onClock) return;
    const sl = currentSlot(league);
    if (!makePick(league, p.id)) return;
    toast(`You selected ${p.name}. Analysts: ${sl.grade}. ${pickTake(sl.grade, sl.overall, sl.csr)}`, 5000);
    commit();
  };

  return (
    <div className="stack">
      <div className="pagehead">
        <h2>{combine ? `${year} Scouting Combine` : `${year} NHL Entry Draft`}</h2>
        {slot && <span className="pill on">Round {slot.round} of {DRAFT_ROUNDS}</span>}
        {!inDraft && <span className="pill">{DRAFT_ROUNDS} rounds · {DRAFT_ROUNDS * 32} picks</span>}
        <span className="pill" title="Spend them on scouting reports">Scouting points: {user.scoutPts || 0}</span>
      </div>
      <div className="tabs">
        {views.map(([k, label]) => (
          <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{label}</button>
        ))}
      </div>

      {view === "floor" && <DraftFloor act={act} onDraft={draft} canDraft={onClock} />}
      {view === "board" && (
        <>
          <Legend />
          <div className="dgrid">
            <Board onDraft={slot ? draft : null} canDraft={onClock} />
            <div className="stack">
              <MyListPanel compact />
              <ScoutSummary go={() => setView("scouts")} />
              {!inDraft && (
                <div className="panel">
                  <h3>Your picks</h3>
                  <div className="list">
                    {futurePicks.map((pk) => <div className="item small" key={pk.id}>{pickLabel(league, pk)}</div>)}
                    {!futurePicks.length && <div className="dim small">You don't own any picks.</div>}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
      {view === "list" && <MyListPanel onDraft={slot ? draft : null} canDraft={onClock} />}
      {view === "combine" && <CombineView />}
      {view === "scouts" && <ScoutsView />}
    </div>
  );
}

function ScoutSummary({ go }) {
  const { league } = useGame();
  const s = league.teams[league.userTid].scouts || {};
  return (
    <div className="panel">
      <h3>Your scouts <span className="right"><button className="tiny" onClick={go}>Manage</button></span></h3>
      <div className="list">
        {["major", "minor"].map((role) => (
          <div className="item small" key={role}>
            <span className={`cov ${role}`}>{SCOUT_ROLES[role].short}</span>
            {s[role] ? <><b>{SCOUT_GROUPS[s[role].group]}</b><span className="muted">{s[role].name} · eval {s[role].eval}</span></> : <span className="dim">Vacant</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
