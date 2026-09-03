import { apiFetch } from "../lib/api";
import { fmt, fmtDate, totalPot } from "../lib/format";
import { CalendarBlank, Clock, MapPin, X } from "./icons";

// --- Game History ---
function GameHistory({ games, scheduledGames, onSelectGame, onNewGame, onScheduleGame, isOwner, isAdmin, onRefresh }) {
  const sorted = [...games].sort((a, b) => b.date.localeCompare(a.date));

  const deleteGame = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm("Permanently delete this game? This cannot be undone.")) return;
    try {
      await apiFetch(`/api/games/${id}`, { method: "DELETE" });
      await onRefresh();
    } catch (err) {
      let msg = err.message;
      try { msg = JSON.parse(err.message).error || msg; } catch {}
      alert(msg);
    }
  };

  const deleteScheduled = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm("Cancel this scheduled game?")) return;
    try {
      await apiFetch(`/api/scheduled-games/${id}`, { method: "DELETE" });
      await onRefresh();
    } catch (_e) {}
  };

  const fmtScheduledDate = (date, time) => {
    const dt = new Date(`${date}T${time}:00`);
    return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
      + " · " + dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  return (
    <div className="game-history">
      {isOwner && (
        <div className="game-history-actions">
          <button className="btn btn-primary new-game-btn" onClick={onNewGame}>+ New Game</button>
          <button className="btn btn-ghost new-game-btn" onClick={onScheduleGame}><CalendarBlank /> Schedule</button>
        </div>
      )}

      {/* Upcoming scheduled games */}
      {scheduledGames && scheduledGames.length > 0 && (
        <div className="scheduled-games-section">
          <div className="scheduled-games-label">Upcoming</div>
          {scheduledGames.map((sg) => (
            <div key={sg.id} className="scheduled-game-card">
              <CalendarBlank className="scheduled-game-icon" size={20} />
              <div className="scheduled-game-info">
                <div className="scheduled-game-datetime">{fmtScheduledDate(sg.scheduledDate, sg.scheduledTime)}</div>
                {sg.location && <div className="scheduled-game-location"><MapPin /> {sg.location}</div>}
              </div>
              {isOwner && (
                <button className="btn-icon delete-btn" title="Cancel scheduled game"
                  aria-label="Cancel scheduled game"
                  onClick={(e) => deleteScheduled(e, sg.id)}><X /></button>
              )}
            </div>
          ))}
        </div>
      )}
      {sorted.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">♣</div>
          <div className="empty-title">No games yet</div>
          <p>{isOwner ? "Use New Game above to set the date, buy-ins and who is playing." : "An Owner needs to start the first game before anything shows up here."}</p>
        </div>
      ) : sorted.map((g) => {
        const pot = totalPot(g.players?.items ?? []);
        const names = (g.players?.items ?? []).map((gp) => gp.player?.name).filter(Boolean).join(", ");
        return (
          <div key={g.id} className={"game-card " + (g.isComplete ? "complete" : "active-game")} onClick={() => onSelectGame(g)}>
            <div className="game-card-header">
              <span className="game-date">{fmtDate(g.date)}</span>
              <div className="game-card-status-group">
                <span className={"game-status " + (g.isComplete ? "" : "badge-active")}>{g.isComplete ? "Completed" : "In Progress"}</span>
                {isAdmin && (
                  <button className="btn-icon delete-btn" title="Delete game"
                    aria-label={`Delete game on ${fmtDate(g.date)}`}
                    onClick={(e) => deleteGame(e, g.id)}><X /></button>
                )}
              </div>
            </div>
            <div className="game-players-preview">{names}</div>
            <div className="game-card-meta-row">
              {g.location && <span className="game-card-meta"><MapPin /> {g.location}</span>}
              {g.startTime && <span className="game-card-meta"><Clock /> {g.startTime}{g.endTime ? ` to ${g.endTime}` : ""}</span>}
            </div>
            <div className="game-pot">Pot: {fmt(pot)}</div>
          </div>
        );
      })}
    </div>
  );
}

export default GameHistory;
