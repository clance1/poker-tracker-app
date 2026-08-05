import { useState, useEffect } from "react";
import { apiFetch } from "../lib/api";
import SkeletonTab from "./Skeleton";

// --- Root App ---
// --- Stats Tab (personal game history & summary) ---
function StatsTab() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/api/profile/stats")
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const fmtMoney = (v) => (v == null ? "—" : "$" + Number(v).toFixed(0));
  const fmtMoneySign = (v) => {
    if (v == null) return "—";
    const n = Number(v);
    return (n >= 0 ? "+" : "") + "$" + Math.abs(n).toFixed(0);
  };
  const fmtDuration = (start, end) => {
    if (!start || !end) return "—";
    const ms = new Date(end) - new Date(start);
    if (ms <= 0) return "—";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h === 0) return `${m}m`;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  };
  const fmtDate = (d) => d
    ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })
    : "—";

  if (loading) return <SkeletonTab rows={4} />;
  if (!stats?.summary || stats.summary.gamesPlayed === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">♦</div>
        <p>No completed games yet. Stats will appear after your first game.</p>
      </div>
    );
  }

  return (
    <div className="stats-tab">
      <h2 className="section-title">My Stats</h2>
      <div className="profile-stats-grid">
        <div className="stat-card">
          <span className="stat-label">Games Played</span>
          <span className="stat-value">{stats.summary.gamesPlayed}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Avg Buy-In / Game</span>
          <span className="stat-value">{fmtMoney(stats.summary.avgBuyIn)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Buy-In</span>
          <span className="stat-value">{fmtMoney(stats.summary.totalBuyIn)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Cash-Out</span>
          <span className={"stat-value " + (stats.summary.totalCashOut >= stats.summary.totalBuyIn ? "stat-profit" : "stat-loss")}>
            {fmtMoney(stats.summary.totalCashOut)}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Avg Cash-Out / Game</span>
          <span className="stat-value">{fmtMoney(stats.summary.avgCashOut)}</span>
        </div>
        <div className="stat-card stat-card-net">
          <span className="stat-label">Net Profit / Loss</span>
          <span className={"stat-value stat-value-lg " + (stats.summary.totalCashOut - stats.summary.totalBuyIn >= 0 ? "stat-profit" : "stat-loss")}>
            {fmtMoneySign(stats.summary.totalCashOut - stats.summary.totalBuyIn)}
          </span>
        </div>
      </div>

      <h3 className="profile-history-title">History</h3>
      <div className="profile-history">
        <div className="history-header">
          <span>Date</span>
          <span>Buy In</span>
          <span>Re-Buys</span>
          <span>Cash Out</span>
          <span>Time</span>
        </div>
        {stats.history.map((g, i) => {
          const invested = (g.buyIn || 0) + (g.rebuys || 0);
          const net = g.cashOut != null ? g.cashOut - invested : null;
          return (
            <div key={i} className={"history-row" + (net == null ? "" : net >= 0 ? " history-profit" : " history-loss")}>
              <span className="history-date">{fmtDate(g.date)}{g.location ? ` · ${g.location}` : ""}</span>
              <span>{fmtMoney(g.buyIn)}</span>
              <span>{g.rebuys ? fmtMoney(g.rebuys) : "—"}</span>
              <span>{g.cashOut != null ? fmtMoney(g.cashOut) : "—"}</span>
              <span>{fmtDuration(g.startTime, g.endTime)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default StatsTab;
