# Rink GM

A browser hockey general-manager game: run an NHL franchise with **2026-27 rosters, real opening-week line combinations and EA SPORTS NHL 27 player ratings**. Set lines, play games live on a rink or simulate them, trade, draft, scout, re-sign and sign free agents, and build a dynasty season after season.

Rink GM follows the game loop of [Gridiron GM](https://github.com/VaultSparkStudios/gridiron-gm) (season → playoffs → draft → free agency → next season, with a live-play mode). It is a separate, original codebase written for hockey, because Gridiron GM's code is proprietary.

## Play

**In your browser, no install:** open the hosted copy at https://claude.ai/artifact/GrqMjREPGaoVBivTUwNiw8. It's private to its owner until shared from the page's Share menu. Your league saves in the browser automatically, and when you're signed in to Claude it's also backed up to your account so you can continue on another device.

**Locally:**

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/ (relative paths, host anywhere)
npm test           # engine tests (schedule, sim calibration, offseason, trades, import, saves)
npm run build:artifact   # one self-contained page: dist/rink-gm.html
```

## Features

- **NHL 27 rosters**: 32 teams and 797 players, with positions (C/LW/RW/LD/RD/G), EA player types (Sniper, Playmaker, Power Forward, Two-Way, Grinder, Enforcer; Offensive/Defensive/Two-Way/Enforcer D; Hybrid/Butterfly/Standup goalies), ages and contracts. A random fictional-league mode is also available.
- **Real line combinations**: every team starts with its actual opening-week 2026-27 lines (forward lines, defence pairs, starter and backup goalie) and its injury list. The Lines tab lays them out like Daily Faceoff's line charts, with LW-C-RW lines, LD-RD pairs, power-play and penalty-kill units, goalies, injuries and scratches. You can browse any team's lines, tap two players to swap them, or reset to the NHL lines. Lines stay set between games: injured players keep their spot while the best healthy scratch fills in, and players coming back from injury or arriving in a trade are worked back into the lineup.
- **EA-style ratings**: every player has 25 EA NHL attributes (skating, shooting, hands, checking, defense, senses; 15 goalie attributes). The overall (OVR) is computed from player-type weights the way EA does it, and attributes are generated so each player's OVR matches their NHL 27 number exactly.
- **Simulation**: a 10-second-step engine with line deployment, power plays and penalty kills, faceoffs, hits, blocks, rebounds, fights, 3-on-3 OT, shootouts, playoff sudden-death OT, goalie pulls and injuries. It's calibrated to roughly NHL averages: about 2.9 goals and 30 shots per team per game, a .903 league save percentage, and 25% of games past regulation.
- **Live games**: watch your games on an animated rink with play-by-play. You control tactics (attack/balanced/defend), ride your top lines, call a timeout and pull your goalie. Live and simulated games share one engine, so live stats count toward the season.
- **Season**: an NHL-format 82-game schedule (41 home games), division and wild-card standings with NHL tiebreakers, a trade deadline, and awards (Hart, Art Ross, Rocket Richard, Norris, Vezina, Calder, Selke, Conn Smythe).
- **Playoffs**: 16 teams, a fixed divisional bracket, best-of-7 series with 2-2-1-1-1 home ice.
- **Front office**: the salary cap ($104M in 2026-27, $113.5M in 2027-28, then growth), a 23-man roster with minors call-ups and send-downs, buyouts with dead cap, re-signing with RFA/UFA and player mood, a 30-day free agency with AI bidding, and trades with an AI that values players, prospects and picks differently when contending or rebuilding.
- **Draft**: an NHL two-draw lottery, 7 rounds, 224 picks, generated prospect classes, and a scouting budget that narrows the uncertainty on prospect ratings.
- **Long-term play**: aging, development and retirement, career stats, league history and transaction logs. Saves are compressed in localStorage, and you can export or import league files.

## About the ratings data

`src/data/nhl27-rosters.json` is the roster file. Each player is tagged with a source:

| `src` | Meaning | Badge in game |
|---|---|---|
| `ea27` | Overall published by EA SPORTS for NHL 27 (Ratings Week, August 2026), as reported by EA and NHL media | **EA** |
| `est` | Estimated overall, not yet checked against EA's database | **EST** |

158 players (mostly the top of EA's top 300) have confirmed EA overalls. The rest are estimates. Rosters include deadline deals, offseason trades, July 1, 2026 signings and moves through the first week of the 2026-27 season that were reported publicly. Depth players and contract figures are best-effort approximations.

**Line combinations:** the `lines` section of the roster file holds each team's opening-week lines (Sept. 29 to Oct. 8, 2026), compiled from published line-combination reports such as Daily Faceoff's: `F` is four LW-C-RW lines, `D` is three LD-RD pairs, `G` is starter and backup, and `out` lists players injured or unavailable at the start of the season (games out are estimates). A `null` slot wasn't reported, and the game fills it from the roster. Power-play and penalty-kill units are picked by the game from each team's dressed skaters.

**Updating ratings:**

1. **In game:** go to *Settings → Ratings Import*, paste `name,ovr` or `name,team,pos,ovr` lines, or a CSV with headers (copied from EA's ratings site or a spreadsheet), preview the matches, and apply. Attributes are rescaled so each OVR matches exactly. You can mark imported ratings as official EA, move players between teams, or add missing players. *Export rosters as JSON* writes the result in the same format as the roster file.
2. **In the repo:** edit `src/data/nhl27-rosters.json` and run `npm run validate:rosters`.

## Project layout

```
src/engine/   game logic (pure JS, no React) — ratings, players, sim, schedule,
              standings, playoffs, draft, roster/cap, offseason, trade, awards,
              importer, league orchestration + save/load
src/ui/       React screens (dashboard, roster, lines, live game, trade, FA, draft…)
src/data/     NHL 27 roster file
tests/        node:test engine tests
scripts/      roster validator
```

## Disclaimer

Rink GM is a non-commercial fan project. It is not affiliated with or endorsed by the NHL, the NHLPA, any NHL club, or Electronic Arts. Team names are used only to identify the teams, and no logos are included. Overall ratings marked EA come from EA SPORTS NHL 27's published ratings. Everything else (attributes, potentials, contracts, simulation results) is generated for gameplay.
