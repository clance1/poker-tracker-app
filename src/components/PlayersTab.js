import { useState, Fragment } from "react";
import { apiFetch } from "../lib/api";
import { sanitizeInput } from "../lib/format";
import Avatar from "./Avatar";
import PlayerHoverCard from "./PlayerHoverCard";
import { Check, PencilSimple, X } from "./icons";

// --- Players Tab ---
function PlayersTab({ players, onRefresh, isOwner, isAdmin }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Which guest is having its claim email edited, and the in-progress value.
  const [claimTarget, setClaimTarget] = useState(null);
  const [claimEmail, setClaimEmail] = useState("");
  const [claimSaving, setClaimSaving] = useState(false);

  const readError = (e) => {
    try { return JSON.parse(e.message).error || e.message; } catch { return e.message; }
  };

  const openClaim = (p) => { setClaimTarget(p.id); setClaimEmail(p.claimEmail ?? ""); setError(""); };
  const closeClaim = () => { setClaimTarget(null); setClaimEmail(""); };

  // Attaching an email means: whoever registers with it inherits this guest's
  // entire game history, and the guest row becomes their account.
  const saveClaim = async (p) => {
    setClaimSaving(true); setError("");
    try {
      await apiFetch("/api/players/" + p.id, {
        method: "PATCH",
        body: { claimEmail: sanitizeInput(claimEmail, 254).toLowerCase() },
      });
      closeClaim();
      await onRefresh();
    } catch (e) { setError(readError(e)); }
    setClaimSaving(false);
  };

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
        <div className="empty-state">
          <div className="empty-icon">♦</div>
          <div className="empty-title">No players yet</div>
          <p>{isOwner ? "Add a name above for each person who plays. Guests do not need an account." : "An Owner adds players. Ask one to add you."}</p>
        </div>
      ) : (
        <div className="players-list">
          {players.map((p) => {
            const gameCount = p.games?.items?.length ?? 0;
            const completedCount = p.games?.items?.filter((g) => g.game?.isComplete).length ?? 0;
            const isLinked = !!p.userId;
            // Delete allowed: 0 games → owner/admin; unlinked guest → admin only
            const canDelete = (gameCount === 0 && isOwner) || (!isLinked && isAdmin);
            return (
              <Fragment key={p.id}>
                <div className="player-row">
                  <div className="player-name-group">
                    <PlayerHoverCard player={p}>
                      <Avatar src={p.avatarPath} name={p.name} size={28} />
                      <span className="player-name-text">{p.name}</span>
                    </PlayerHoverCard>
                    {!isLinked && (
                      <span className="player-type-badge guest-badge" title="Guest, not linked to an app account">Guest</span>
                    )}
                    {!isLinked && p.claimEmail && (
                      <span className="player-type-badge claim-badge" title={`Claimable by ${p.claimEmail}`}>
                        <Check /> {p.claimEmail}
                      </span>
                    )}
                  </div>
                  <span className="player-game-count">{completedCount} game{completedCount !== 1 ? "s" : ""}</span>
                  {isAdmin && !isLinked && (
                    <button className="btn btn-ghost btn-sm claim-btn"
                      onClick={() => (claimTarget === p.id ? closeClaim() : openClaim(p))}
                      aria-expanded={claimTarget === p.id}
                      title="Attach an email so this guest can be claimed on sign-up">
                      <PencilSimple /> {p.claimEmail ? "Edit email" : "Claim email"}
                    </button>
                  )}
                  {canDelete && (
                    <button className="btn-icon delete-btn" title="Remove player"
                      aria-label={`Remove ${p.name}`}
                      onClick={() => deletePlayer(p.id, p.name)}><X /></button>
                  )}
                </div>

                {claimTarget === p.id && (
                  <div className="claim-drawer">
                    <label className="field-label" htmlFor={`claim-${p.id}`}>
                      Claim email for {p.name}
                    </label>
                    <p className="field-hint">
                      When someone creates an account with this address, {p.name}&rsquo;s
                      {" "}{completedCount} game{completedCount !== 1 ? "s" : ""} move to it and the
                      guest becomes their account. Leave blank to clear.
                    </p>
                    <div className="claim-drawer-row">
                      <input
                        id={`claim-${p.id}`} type="email" className="input"
                        placeholder="player@example.com" value={claimEmail} maxLength={254}
                        autoFocus autoComplete="off"
                        onChange={(e) => setClaimEmail(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveClaim(p);
                          if (e.key === "Escape") closeClaim();
                        }}
                      />
                      <button className="btn btn-primary btn-sm" disabled={claimSaving}
                        onClick={() => saveClaim(p)}>
                        {claimSaving ? "Saving…" : "Save"}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={closeClaim}>Cancel</button>
                    </div>
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default PlayersTab;
