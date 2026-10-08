import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GameCtx, TeamBadge, recordStr, money } from "./ui/common.jsx";
import TitleScreen from "./ui/TitleScreen.jsx";
import Dashboard from "./ui/Dashboard.jsx";
import RosterPage from "./ui/RosterPage.jsx";
import LinesPage from "./ui/LinesPage.jsx";
import SchedulePage from "./ui/SchedulePage.jsx";
import StandingsPage from "./ui/StandingsPage.jsx";
import StatsPage from "./ui/StatsPage.jsx";
import PlayoffsPage from "./ui/PlayoffsPage.jsx";
import TradePage from "./ui/TradePage.jsx";
import FreeAgencyPage from "./ui/FreeAgencyPage.jsx";
import DraftPage from "./ui/DraftPage.jsx";
import LeaguePage from "./ui/LeaguePage.jsx";
import SettingsPage from "./ui/SettingsPage.jsx";
import LiveGame from "./ui/LiveGame.jsx";
import PlayerModal from "./ui/PlayerModal.jsx";
import TeamModal from "./ui/TeamModal.jsx";
import BoxScoreModal from "./ui/BoxScoreModal.jsx";
import * as L from "./engine/league.js";
import { PHASES, FA_DAYS } from "./engine/constants.js";
import { dayToDate } from "./engine/schedule.js";
import { capSpace, rosterIssues } from "./engine/roster.js";
import { simPlayoffDay, userSeries, nextGame } from "./engine/playoffs.js";
import { simDraftToUser, draftDone, currentSlot } from "./engine/draft.js";
import { simFADay } from "./engine/offseason.js";

const NAV = [
  { id: "dashboard", label: "Dashboard", ico: "🏠" },
  { id: "roster", label: "Roster", ico: "👥" },
  { id: "lines", label: "Lines", ico: "🧩" },
  { id: "schedule", label: "Schedule", ico: "📅" },
  { id: "standings", label: "Standings", ico: "📊" },
  { id: "stats", label: "Stats", ico: "📈" },
  { id: "playoffs", label: "Playoffs", ico: "🏆" },
  { sep: true },
  { id: "trade", label: "Trade", ico: "🔁" },
  { id: "freeagency", label: "Free Agency", ico: "✍️" },
  { id: "draft", label: "Draft & Scouting", ico: "🎯" },
  { sep: true },
  { id: "league", label: "League", ico: "🌐" },
  { id: "settings", label: "Settings", ico: "⚙️" },
];

export default function App() {
  const leagueRef = useRef(null);
  const [, setRev] = useState(0);
  const [screen, setScreen] = useState("title");
  const [tab, setTab] = useState("dashboard");
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState(null);
  const [live, setLive] = useState(null);
  const [tradeSeed, setTradeSeed] = useState(null);
  const saveTimer = useRef(null);
  const cancelRef = useRef(false);
  const league = leagueRef.current;

  const showToast = useCallback((msg, ms = 3200) => {
    setToast(msg);
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => setToast(null), ms);
  }, []);

  const flushSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (leagueRef.current && !L.saveLeague(leagueRef.current)) showToast("⚠️ Couldn't auto-save (browser storage full?). Export your league from Settings.", 6000);
  }, [showToast]);

  // Throttled autosave: at most one write per 400ms, never more than 400ms behind.
  const commit = useCallback(() => {
    setRev((r) => r + 1);
    if (!saveTimer.current) saveTimer.current = setTimeout(flushSave, 400);
  }, [flushSave]);

  useEffect(() => {
    const flush = () => saveTimer.current && flushSave();
    const onHide = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flushSave]);

  const startLeague = (lg) => {
    leagueRef.current = lg;
    setScreen("game");
    setTab("dashboard");
    commit();
  };

  // Run a long simulation in small chunks so the page stays responsive.
  const runChunked = useCallback((label, step, done) => {
    cancelRef.current = false;
    setBusy({ label: label() });
    const tick = () => {
      const t0 = performance.now();
      let more = true;
      while (more && performance.now() - t0 < 45) more = step();
      setBusy({ label: label(), cancel: true });
      if (more && !cancelRef.current) setTimeout(tick, 0);
      else {
        setBusy(null);
        done?.();
        commit();
      }
    };
    setTimeout(tick, 20);
  }, [commit]);

  useEffect(() => {
    document.documentElement.style.setProperty("--team", league ? league.teams[league.userTid].colors[0] : "#4ea1ff");
  });

  const ctx = useMemo(
    () => ({
      league: leagueRef.current,
      commit,
      toast: showToast,
      go: setTab,
      openPlayer: (id) => setModal({ type: "player", id }),
      openTeam: (tid) => setModal({ type: "team", tid }),
      openBox: (game) => setModal({ type: "box", game }),
      closeModal: () => setModal(null),
      proposeTradeFor: (pid, tid) => {
        setTradeSeed({ pid, tid, n: Date.now() });
        setModal(null);
        setTab("trade");
      },
      newGame: () => {
        leagueRef.current = null;
        setScreen("title");
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leagueRef.current, commit, showToast]
  );

  if (screen === "title" || !league) {
    return <TitleScreen onStart={startLeague} />;
  }

  const user = league.teams[league.userTid];

  // ---------- Phase actions ----------
  const blockers = () => {
    const issues = rosterIssues(league, user).filter((x) => !x.startsWith("Need"));
    if (issues.length) {
      showToast(issues[0], 5000);
      setTab("roster");
      return true;
    }
    return false;
  };

  const act = {
    startSeason: () => {
      if (blockers()) return;
      L.startRegularSeason(league);
      commit();
    },
    simDay: () => {
      if (blockers()) return;
      L.simDay(league);
      commit();
    },
    simDays: (n, label) => {
      if (blockers()) return;
      let i = 0;
      runChunked(
        () => `${label} — ${dayToDate(league.year, league.day)}`,
        () => {
          if (league.phase !== "regular" || L.seasonOver(league) || i >= n) return false;
          L.simDay(league);
          i++;
          return true;
        }
      );
    },
    simToDeadline: () => {
      if (blockers()) return;
      runChunked(
        () => `Simulating to the trade deadline — ${dayToDate(league.year, league.day)}`,
        () => {
          if (league.phase !== "regular" || L.seasonOver(league) || league.day > league.deadlineDay) return false;
          L.simDay(league);
          return true;
        }
      );
    },
    simToEnd: () => {
      if (blockers()) return;
      runChunked(
        () => `Simulating the regular season — ${dayToDate(league.year, league.day)}`,
        () => {
          if (league.phase !== "regular" || L.seasonOver(league)) return false;
          L.simDay(league);
          return true;
        }
      );
    },
    playLive: () => {
      if (blockers()) return;
      const g = L.userGameOnDay(league);
      if (!g) return;
      L.simDay(league, { holdUserGame: true });
      setLive({ kind: "regular", gid: g.id, home: g.h, away: g.a });
      commit();
    },
    startPlayoffs: () => {
      L.endRegularSeason(league);
      setTab("playoffs");
      commit();
    },
    simPlayoffDay: () => {
      simPlayoffDay(league);
      commit();
    },
    simPlayoffRound: () => {
      const r = league.playoffs.round;
      runChunked(
        () => "Simulating the playoffs…",
        () => league.playoffs.champion == null && league.playoffs.round === r && simPlayoffDay(league)
      );
    },
    simPlayoffsAll: () => {
      runChunked(
        () => "Simulating the playoffs…",
        () => league.playoffs.champion == null && simPlayoffDay(league)
      );
    },
    playPlayoffLive: () => {
      const s = userSeries(league);
      if (!s) return;
      const g = nextGame(league, s);
      setLive({ kind: "playoff", series: s, home: g.home, away: g.away });
    },
    toDraft: () => {
      L.finishPlayoffs(league);
      setTab("draft");
      commit();
    },
    simToMyPick: () => {
      simDraftToUser(league);
      commit();
    },
    autoDraft: () => {
      simDraftToUser(league, { all: true });
      commit();
    },
    toResign: () => {
      L.completeDraft(league);
      setTab("freeagency");
      commit();
    },
    toFA: () => {
      L.goToFreeAgency(league);
      setTab("freeagency");
      commit();
    },
    faDay: () => {
      simFADay(league);
      commit();
    },
    faToEnd: () => {
      while (league.fa && league.fa.day < FA_DAYS) simFADay(league);
      commit();
    },
    nextSeason: () => {
      runChunked(
        () => "Aging players and building the new season…",
        () => {
          while (league.fa && league.fa.day < FA_DAYS) simFADay(league);
          L.beginNextSeason(league);
          return false;
        },
        () => setTab("dashboard")
      );
    },
  };

  const onLiveDone = () => {
    setLive(null);
    commit();
  };

  // ---------- Top bar ----------
  const phaseLabel = (() => {
    const season = `${league.year}-${String(league.year + 1).slice(2)}`;
    if (league.phase === "regular") return `${season} · ${dayToDate(league.year, league.day)}`;
    if (league.phase === "playoffs") return `${season} · Playoffs`;
    if (league.phase === "freeagency") return `${league.year + 1} Free Agency · Day ${league.fa?.day ?? 0}/${FA_DAYS}`;
    if (league.phase === "draft") return `${league.year + 1} Entry Draft`;
    if (league.phase === "resign") return `${league.year + 1} Off-season · Re-sign`;
    return `${season} · ${PHASES[league.phase]}`;
  })();

  const actions = [];
  if (league.phase === "preseason") actions.push(<button key="s" className="primary" onClick={act.startSeason}>Start Season ▶</button>);
  if (league.phase === "regular") {
    if (L.seasonOver(league)) actions.push(<button key="po" className="primary" onClick={act.startPlayoffs}>Start Playoffs 🏆</button>);
    else {
      const ug = L.userGameOnDay(league);
      if (ug) {
        const opp = league.teams[ug.h === user.id ? ug.a : ug.h];
        actions.push(<button key="live" className="primary" onClick={act.playLive}>▶ Play Live {ug.h === user.id ? "vs" : "@"} {opp.abbr}</button>);
        actions.push(<button key="sg" onClick={act.simDay}>Sim Game</button>);
      } else actions.push(<button key="sd" onClick={act.simDay}>Sim Day</button>);
      actions.push(<button key="sw" onClick={() => act.simDays(7, "Simulating a week")}>Week</button>);
      if (league.day <= league.deadlineDay) actions.push(<button key="dl" onClick={act.simToDeadline} title="Sim to the trade deadline">To Deadline</button>);
      actions.push(<button key="se" onClick={act.simToEnd}>To End</button>);
    }
  }
  if (league.phase === "playoffs") {
    if (league.playoffs.champion != null) actions.push(<button key="d" className="primary" onClick={act.toDraft}>Go to the Draft →</button>);
    else {
      if (userSeries(league)) actions.push(<button key="pl" className="primary" onClick={act.playPlayoffLive}>▶ Play Live</button>);
      actions.push(<button key="pd" onClick={act.simPlayoffDay}>Sim Day</button>);
      actions.push(<button key="pr" onClick={act.simPlayoffRound}>Sim Round</button>);
      actions.push(<button key="pa" onClick={act.simPlayoffsAll}>Sim All</button>);
    }
  }
  if (league.phase === "draft") {
    if (draftDone(league)) actions.push(<button key="rs" className="primary" onClick={act.toResign}>Continue to Re-signing →</button>);
    else {
      const slot = currentSlot(league);
      if (slot.owner !== user.id) actions.push(<button key="mp" className="primary" onClick={act.simToMyPick}>Sim to My Pick</button>);
      actions.push(<button key="ad" onClick={act.autoDraft}>Auto-Draft Rest</button>);
    }
  }
  if (league.phase === "resign") actions.push(<button key="fa" className="primary" onClick={act.toFA}>Proceed to Free Agency →</button>);
  if (league.phase === "freeagency") {
    if (league.fa.day < FA_DAYS) {
      actions.push(<button key="fd" onClick={act.faDay}>Next Day</button>);
      actions.push(<button key="fe" onClick={act.faToEnd}>Sim to End</button>);
    }
    actions.push(<button key="ns" className="primary" onClick={act.nextSeason}>Start {league.year + 1}-{String(league.year + 2).slice(2)} Season →</button>);
  }

  const space = capSpace(league, user);
  const badgeFor = (id) => {
    if (id === "draft" && league.phase === "draft") return "LIVE";
    if (id === "freeagency" && (league.phase === "resign" || league.phase === "freeagency")) return "OPEN";
    if (id === "playoffs" && league.phase === "playoffs") return "ON";
    return null;
  };

  return (
    <GameCtx.Provider value={ctx}>
      <div className="app">
        <div className="topbar">
          <div className="brand">RINK GM</div>
          <div className="teaminfo">
            <TeamBadge team={user} size={34} />
            <div>
              <div className="name">{user.city} {user.name}</div>
              <div className="meta">
                {recordStr(user.rec)} · {user.rec.pts} PTS · Cap space <span className={space < 0 ? "bad" : ""}>{money(space)}</span> · {phaseLabel}
              </div>
            </div>
          </div>
          <div className="spacer" />
          {!live && <div className="actions">{actions}</div>}
        </div>
        <div className="body">
          <div className="nav">
            {NAV.map((n, i) =>
              n.sep ? (
                <div key={"sep" + i} className="sep" />
              ) : (
                <button key={n.id} className={tab === n.id && !live ? "active" : ""} disabled={!!live} onClick={() => setTab(n.id)}>
                  <span className="ico">{n.ico}</span>
                  {n.label}
                  {badgeFor(n.id) && <span className="badge">{badgeFor(n.id)}</span>}
                </button>
              )
            )}
          </div>
          <div className="main">
            {live ? (
              <LiveGame spec={live} onDone={onLiveDone} />
            ) : (
              <>
                {tab === "dashboard" && <Dashboard act={act} />}
                {tab === "roster" && <RosterPage />}
                {tab === "lines" && <LinesPage />}
                {tab === "schedule" && <SchedulePage />}
                {tab === "standings" && <StandingsPage />}
                {tab === "stats" && <StatsPage />}
                {tab === "playoffs" && <PlayoffsPage act={act} />}
                {tab === "trade" && <TradePage seed={tradeSeed} />}
                {tab === "freeagency" && <FreeAgencyPage />}
                {tab === "draft" && <DraftPage act={act} />}
                {tab === "league" && <LeaguePage />}
                {tab === "settings" && <SettingsPage />}
              </>
            )}
          </div>
        </div>
        {modal?.type === "player" && league.players[modal.id] && <PlayerModal pid={modal.id} />}
        {modal?.type === "team" && <TeamModal tid={modal.tid} />}
        {modal?.type === "box" && <BoxScoreModal game={modal.game} />}
        {busy && (
          <div className="overlay">
            <div className="box">
              <div className="spinner" />
              <div>{busy.label}</div>
              {busy.cancel && (
                <button className="small" style={{ marginTop: 12 }} onClick={() => (cancelRef.current = true)}>
                  Stop
                </button>
              )}
            </div>
          </div>
        )}
        {toast && <div className="toast">{toast}</div>}
      </div>
    </GameCtx.Provider>
  );
}

