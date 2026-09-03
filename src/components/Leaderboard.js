import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { apiFetch } from "../lib/api";
import { getPlayerColor } from "../lib/constants";
import { calcNet, calcStreak, fmt, fmtDateShort } from "../lib/format";
import Avatar from "./Avatar";
import { CaretDown, CaretUp, CaretUpDown, Lightning, Medal, Trophy } from "./icons";

const LeaderboardCharts = lazy(() => import("./LeaderboardCharts"));

// --- Leaderboard ---
function Leaderboard({ players }) {
  const [view, setView] = useState("game");
  const [gameFilter, setGameFilter] = useState(5);
  const [activeChart, setActiveChart] = useState("bar");
  const [hiddenPlayers, setHiddenPlayers] = useState(new Set());
  const [achCounts, setAchCounts] = useState({});
  const [otherSort, setOtherSort] = useState({ key: "xp", dir: "desc" });
  const [badges, setBadges] = useState({ winner: null, loser: null });

  const allGames = useMemo(() => {
    const map = {};
    players.forEach((p) =>
      (p.games?.items ?? []).filter((gp) => gp.game?.isComplete).forEach((gp) => {
        if (!map[gp.game.id]) map[gp.game.id] = gp.game;
      })
    );
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
  }, [players]);

  const filteredGames = useMemo(
    () => (gameFilter === "all" ? allGames : allGames.slice(-gameFilter)),
    [allGames, gameFilter]
  );
  const filteredIds = useMemo(() => new Set(filteredGames.map((g) => g.id)), [filteredGames]);

  const playerStats = useMemo(() => {
    return players.map((p, ci) => {
      const allDone = (p.games?.items ?? []).filter((gp) => gp.game?.isComplete);
      const inPeriod = allDone.filter((gp) => filteredIds.has(gp.game.id));
      const nets = inPeriod.map(calcNet);
      const net = nets.reduce((s, n) => s + n, 0);
      const wins = nets.filter((n) => n > 0).length;
      const totalIn = inPeriod.reduce((s, gp) => s + gp.buyIn + (gp.rebuys ?? 0), 0);
      const streak = calcStreak(allDone);
      return {
        id: p.id, name: p.name, avatarPath: p.avatarPath ?? null,
        userId: p.userId ?? null,
        color: getPlayerColor(ci),
        xp: p.xp ?? 0,
        net, nets,
        gamesPlayed: inPeriod.length,
        wins, losses: inPeriod.length - wins,
        winRate: inPeriod.length ? wins / inPeriod.length : 0,
        avgNet: inPeriod.length ? net / inPeriod.length : 0,
        best: nets.length ? Math.max(...nets) : 0,
        worst: nets.length ? Math.min(...nets) : 0,
        roi: totalIn > 0 ? (net / totalIn) * 100 : 0,
        streak,
        allTimeGames: allDone.length,
      };
    })
      .filter((p) => p.gamesPlayed > 0)
      .sort((a, b) => b.net - a.net);
  }, [players, filteredIds]);

  useEffect(() => {
    if (view !== "other") return;
    apiFetch("/api/achievements/counts").then((rows) => {
      const map = {};
      rows.forEach((r) => { map[r.userId] = r.achievementCount; });
      setAchCounts(map);
    }).catch(() => {});
  }, [view]);

  useEffect(() => {
    apiFetch("/api/leaderboard/badges")
      .then((data) => setBadges(data))
      .catch(() => {});
  }, [players]);

  const otherStats = useMemo(() => {
    return players
      .filter((p) => p.userId)
      .map((p, ci) => ({
        id: p.id,
        userId: p.userId,
        name: p.name,
        avatarPath: p.avatarPath ?? null,
        color: getPlayerColor(ci),
        xp: p.xp ?? 0,
        achievementCount: achCounts[p.userId] ?? 0,
        gamesPlayed: (p.games?.items ?? []).filter((gp) => gp.game?.isComplete).length,
      }));
  }, [players, achCounts]);

  const sortedOtherStats = useMemo(() => {
    const mul = otherSort.dir === "asc" ? 1 : -1;
    return [...otherStats].sort((a, b) => mul * (a[otherSort.key] - b[otherSort.key]));
  }, [otherStats, otherSort]);

  const cycleOtherSort = (key) => {
    setOtherSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key, dir: "desc" }
    );
  };

  const togglePlayer = (id) =>
    setHiddenPlayers((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const visibleStats = playerStats.filter((p) => !hiddenPlayers.has(p.id));

  const barData = useMemo(() =>
    filteredGames.map((g) => {
      const row = { date: fmtDateShort(g.date) };
      visibleStats.forEach((p) => {
        const gp = players.find((pl) => pl.id === p.id)?.games?.items?.find((x) => x.game?.id === g.id);
        if (gp) row[p.name] = Math.round(calcNet(gp) * 100) / 100;
      });
      return row;
    }),
    [filteredGames, players, visibleStats] // eslint-disable-line
  );

  const lineData = useMemo(() => {
    const totals = {};
    visibleStats.forEach((p) => { totals[p.id] = 0; });
    return filteredGames.map((g) => {
      const row = { date: fmtDateShort(g.date) };
      visibleStats.forEach((p) => {
        const gp = players.find((pl) => pl.id === p.id)?.games?.items?.find((x) => x.game?.id === g.id);
        if (gp) totals[p.id] = Math.round((totals[p.id] + calcNet(gp)) * 100) / 100;
        row[p.name] = totals[p.id];
      });
      return row;
    });
  }, [filteredGames, players, visibleStats]); // eslint-disable-line

  // Rank 1-3 get a tinted medal; everyone else gets a plain number.
  const RANK_TIERS = ["gold", "silver", "bronze"];

  return (
    <div className="lb-v2">
      {/* Game / Other toggle */}
      <div className="lb-view-toggle">
        <button className={"lb-view-btn" + (view === "game" ? " active" : "")} onClick={() => setView("game")}>Game</button>
        <button className={"lb-view-btn" + (view === "other" ? " active" : "")} onClick={() => setView("other")}>Other</button>
      </div>

      {view === "game" && (
      <div className="lb-controls">
        <span className="lb-filter-label">Period</span>
        {[5, 10, 20, "all"].map((f) => (
          <button key={f} className={"lb-filter-btn" + (gameFilter === f ? " active" : "")} onClick={() => setGameFilter(f)}>
            {f === "all" ? "All Time" : `Last ${f}`}
          </button>
        ))}
      </div>
      )}

      {view === "game" && players.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">♠</div>
          <div className="empty-title">No players yet</div>
          <p>Add the people you play with in the Players tab, then start a game to see standings here.</p>
        </div>
      )}
      {view === "game" && players.length > 0 && allGames.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">♣</div>
          <div className="empty-title">No completed games yet</div>
          <p>Standings appear once a game has been ended and everyone has cashed out.</p>
        </div>
      )}

      {view === "game" && players.length > 0 && allGames.length > 0 && <>
      <div className="lb-summary-strip">
        {[
          { val: filteredGames.length, label: gameFilter === "all" ? "Total Games" : "Games Shown" },
          { val: playerStats.length, label: "Players" },
          playerStats[0] && { val: playerStats[0].name, label: "Leading", cls: "profit" },
          playerStats[0] && { val: (playerStats[0].net >= 0 ? "+" : "") + fmt(playerStats[0].net), label: "Top Net", cls: playerStats[0].net >= 0 ? "profit" : "loss" },
        ].filter(Boolean).map((item, i) => (
          <div key={i} className="lb-summary-item">
            <div className={"lb-summary-val " + (item.cls ?? "")}>{item.val}</div>
            <div className="lb-summary-label">{item.label}</div>
          </div>
        ))}
      </div>

      <div className="lb-standings">
        {playerStats.map((p, i) => {
          const streakLabel = p.streak.count > 1 ? `${p.streak.count}${p.streak.type}` : null;
          const streakCls = p.streak.type === "W" ? "profit" : p.streak.type === "L" ? "loss" : "muted";
          return (
            <div key={p.id} className={"lb-card-v2" + (i === 0 && p.net > 0 ? " leader" : "")}
              style={{ borderLeftColor: p.color }}>
              <div className="lb-card-rank">
                {RANK_TIERS[i]
                  ? <Medal weight="fill" size={22} className={"lb-medal lb-medal-" + RANK_TIERS[i]} aria-label={"Rank " + (i + 1)} />
                  : <span className="lb-rank-num">#{i + 1}</span>}
              </div>
              <div className="lb-card-body">
                <div className="lb-card-top">
                  <Avatar src={p.avatarPath} name={p.name} size={28} />
                  <span className="lb-card-name">
                    {p.name}
                    {badges.winner?.userId && p.userId === badges.winner.userId && (
                      <span className="lb-badge lb-badge--crown" title={`Biggest winner last game${badges.winner.streak > 1 ? ` (${badges.winner.streak} in a row)` : ""}`}>
                        👑{badges.winner.streak > 1 && <span className="lb-badge-streak"> x{badges.winner.streak}</span>}
                      </span>
                    )}
                    {badges.loser?.userId && p.userId === badges.loser.userId && (
                      <span className="lb-badge lb-badge--poop" title={`Biggest loser last game${badges.loser.streak > 1 ? ` (${badges.loser.streak} in a row)` : ""}`}>
                        💩{badges.loser.streak > 1 && <span className="lb-badge-streak"> x{badges.loser.streak}</span>}
                      </span>
                    )}
                  </span>
                  {streakLabel && (
                    <span className={"lb-streak " + streakCls} title={`${p.streak.count}-game ${p.streak.type === "W" ? "win" : "loss"} streak`}>
                      {p.streak.type === "W" ? "🔥" : "🧊"} {streakLabel}
                    </span>
                  )}
                  <span className={"lb-card-net " + (p.net >= 0 ? "profit" : "loss")}>
                    {p.net >= 0 ? "+" : ""}{fmt(p.net)}
                  </span>
                </div>
                <div className="lb-winrate-bar-bg">
                  <div className="lb-winrate-bar-fill" style={{ width: (p.winRate * 100) + "%", background: p.color }} />
                </div>
                <div className="lb-card-stats">
                  <span><span className="stat-label">GP</span> {p.gamesPlayed}</span>
                  <span><span className="stat-label">W%</span> {Math.round(p.winRate * 100)}%</span>
                  <span className={p.avgNet >= 0 ? "profit" : "loss"}>
                    <span className="stat-label">avg</span> {p.avgNet >= 0 ? "+" : ""}{fmt(p.avgNet)}
                  </span>
                  {/* Colour by the value, not by the label: a player who won every
                      game has a positive worst, and one who lost every game has a
                      negative best. */}
                  <span className={p.best >= 0 ? "profit" : "loss"}>
                    <span className="stat-label">best</span> {fmt(p.best)}
                  </span>
                  <span className={p.worst >= 0 ? "profit" : "loss"}>
                    <span className="stat-label">worst</span> {fmt(p.worst)}
                  </span>
                  <span className={p.roi >= 0 ? "profit" : "loss"}>
                    <span className="stat-label">ROI</span> {p.roi >= 0 ? "+" : ""}{p.roi.toFixed(0)}%
                  </span>
                  {p.xp > 0 && (
                    <span className="lb-xp-badge"><Lightning weight="fill" /> {p.xp.toLocaleString()}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredGames.length > 0 && (
        <div className="lb-charts-section">
          <div className="lb-chart-header">
            <div className="lb-chart-tabs">
              <button className={"lb-chart-tab" + (activeChart === "bar" ? " active" : "")} onClick={() => setActiveChart("bar")}>Per Game</button>
              <button className={"lb-chart-tab" + (activeChart === "line" ? " active" : "")} onClick={() => setActiveChart("line")}>Running Total</button>
            </div>
            <div className="lb-player-toggles">
              {playerStats.map((p) => (
                <button key={p.id}
                  className={"lb-toggle-btn" + (hiddenPlayers.has(p.id) ? " off" : "")}
                  style={{ "--pc": p.color }}
                  onClick={() => togglePlayer(p.id)}
                  title={hiddenPlayers.has(p.id) ? "Show " + p.name : "Hide " + p.name}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
          <Suspense fallback={<div className="lb-chart lb-chart-loading" aria-busy="true" />}>
            <LeaderboardCharts
              activeChart={activeChart}
              barData={barData}
              lineData={lineData}
              visibleStats={visibleStats}
            />
          </Suspense>
        </div>
      )}
      </>}

      {view === "other" && (
        <div className="lb-other">
          <div className="lb-other-header">
            <span className="lb-other-col-label flex-1">Player</span>
            {[
              { key: "xp", label: "XP" },
              { key: "achievementCount", label: "Achievements" },
              { key: "gamesPlayed", label: "Games" },
            ].map(({ key, label }) => (
              <button key={key}
                className={"lb-other-sort-btn" + (otherSort.key === key ? " active" : "")}
                onClick={() => cycleOtherSort(key)}>
                {label}
                {otherSort.key === key
                  ? (otherSort.dir === "desc" ? <CaretDown /> : <CaretUp />)
                  : <CaretUpDown className="lb-sort-idle" />}
              </button>
            ))}
          </div>
          {sortedOtherStats.map((p, i) => {
            const maxVal = sortedOtherStats.reduce((m, r) => Math.max(m, r[otherSort.key]), 1);
            return (
              <div key={p.id} className={"lb-other-row" + (i === 0 ? " leader" : "")} style={{ borderLeftColor: p.color }}>
                <div className="lb-other-rank">
                  {RANK_TIERS[i]
                    ? <Medal weight="fill" size={20} className={"lb-medal lb-medal-" + RANK_TIERS[i]} aria-label={"Rank " + (i + 1)} />
                    : <span className="lb-rank-num">#{i + 1}</span>}
                </div>
                <div className="lb-other-identity">
                  <Avatar src={p.avatarPath} name={p.name} size={28} />
                  <span className="lb-card-name">{p.name}</span>
                </div>
                <div className="lb-other-xp">
                  <span className="lb-xp-value"><Lightning weight="fill" /> {p.xp.toLocaleString()}</span>
                  <div className="lb-xp-bar-bg">
                    <div className="lb-xp-bar-fill"
                      style={{ width: Math.round((p[otherSort.key] / maxVal) * 100) + "%", background: p.color }} />
                  </div>
                </div>
                <div className="lb-other-ach">
                  <span className="lb-ach-badge"><Trophy weight="fill" /> {p.achievementCount}</span>
                </div>
                <div className="lb-other-games">
                  <span className="lb-games-count">{p.gamesPlayed}</span>
                </div>
              </div>
            );
          })}
          {sortedOtherStats.length === 0 && (
            <div className="empty-state empty-state-compact">
              <div className="empty-title">No linked accounts yet</div>
              <p>XP and achievements are tracked per account. Players linked to an app account show up here.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Leaderboard;
