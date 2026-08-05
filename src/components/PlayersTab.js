import { useState } from "react";
import { apiFetch } from "../lib/api";
import { sanitizeInput } from "../lib/format";
import { X } from "./icons";

// --- Players Tab ---
function PlayersTab({ players, onRefresh, isOwner, isAdmin }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const addPlayer = async () => {
    const trimmed = sanitizeInput(name, 50);
    if (!trimmed) return setError("Enter a name.");
    if (players.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) return setError("Player already exists.");
    setSaving(true); setError("");
    try {
      await apiFetch("/api/players", { method: "POST", body: { name: trimmed } });
      setName(""); await onRefresh();
    } catch (e) { setError("Failed to add player."); console.error(e); }
    setSaving(false);
  };

  const deletePlayer = async (id, playerName) => {
    if (!window.confirm(`Remove player "${playerName}"?`)) return;
    setError("");
    try {
      await apiFetch("/api/players/" + id, { method: "DELETE" });
      await onRefresh();
    } catch (e) {
      let msg = e.message;
      try { msg = JSON.parse(e.message).error || msg; } catch {}
      setError(msg);
    }
  };

  return (
    <div className="players-tab">
      {isOwner && (
        <div className="add-player-row">
          <input type="text" className="input" placeholder="Guest player name" value={name} maxLength={50}
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addPlayer()} />
          <button className="btn btn-primary" onClick={addPlayer} disabled={saving}>{saving ? "Adding..." : "Add Player"}</button>
        </div>
      )}
      {error && <p className="error-msg">{error}</p>}
      {players.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">♦</div><p>No players yet.{isOwner ? "" : " Ask an Owner to add players."}</p></div>
      ) : (
        <div className="players-list">
          {players.map((p) => {
            const gameCount = p.games?.items?.length ?? 0;
            const completedCount = p.games?.items?.filter((g) => g.game?.isComplete).length ?? 0;
            const isLinked = !!p.userId;
            // Delete allowed: 0 games → owner/admin; unlinked guest → admin only
            const canDelete = (gameCount === 0 && isOwner) || (!isLinked && isAdmin);
            return (
              <div key={p.id} className="player-row">
                <div className="player-name-group">
                  <span className="player-name-text">{p.name}</span>
                  {!isLinked && (
                    <span className="player-type-badge guest-badge" title="Guest — not linked to an app account">Guest</span>
                  )}
                </div>
                <span className="player-game-count">{completedCount} game{completedCount !== 1 ? "s" : ""}</span>
                {canDelete && (
                  <button className="btn-icon delete-btn" title="Remove player"
                    aria-label={`Remove ${p.name}`}
                    onClick={() => deletePlayer(p.id, p.name)}><X /></button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default PlayersTab;
