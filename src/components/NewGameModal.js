import { useState, useEffect } from "react";
import { apiFetch } from "../lib/api";
import { nowTime, sanitizeInput, todayISO } from "../lib/format";
import Avatar from "./Avatar";
import { Check, X } from "./icons";

// --- New Game Modal ---
function NewGameModal({ players, onClose, onCreate }) {
  const [date, setDate] = useState(todayISO());
  const [startTime, setStartTime] = useState(nowTime());
  const [location, setLocation] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [ownerOptions, setOwnerOptions] = useState([]);
  const [selected, setSelected] = useState({});
  const [buyIns, setBuyIns] = useState({});
  const [defaultBuyIn, setDefaultBuyIn] = useState("20");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/api/owners").then((d) => {
      setOwnerOptions(d.owners ?? []);
      if (d.owners?.length) setOwnerId(d.owners[0].id);
    }).catch(() => {});
  }, []);

  const togglePlayer = (id) => {
    setSelected((prev) => { const n = { ...prev }; if (n[id]) delete n[id]; else n[id] = true; return n; });
    if (!buyIns[id]) setBuyIns((prev) => ({ ...prev, [id]: defaultBuyIn }));
  };
  const selectedIds = Object.keys(selected);

  const handleCreate = async () => {
    if (!date) return setError("Pick a date.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError("Invalid date format.");
    if (selectedIds.length < 2) return setError("Select at least 2 players.");
    for (const id of selectedIds) {
      if (isNaN(parseFloat(buyIns[id])) || parseFloat(buyIns[id]) <= 0) return setError("All buy-ins must be > $0.");
    }
    setSaving(true); setError("");
    try {
      const game = await apiFetch("/api/games", {
        method: "POST",
        body: {
          date,
          isComplete: false,
          ownerId: ownerId || undefined,
          location: sanitizeInput(location, 100) || undefined,
          startTime: startTime || undefined,
        },
      });
      await Promise.all(selectedIds.map((playerID) =>
        apiFetch("/api/game-players", { method: "POST", body: { gameID: game.id, playerID, buyIn: parseFloat(buyIns[playerID] ?? defaultBuyIn), rebuys: 0 } })
      ));
      await onCreate();
    } catch (e) { setError("Failed to create game."); console.error(e); setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2>New Game</h2><button className="close-btn" onClick={onClose} aria-label="Close"><X /></button></div>
        <div className="modal-body">
          {/* Date + Start Time */}
          <div className="row-md">
            <div className="auth-field flex-2">
              <label className="field-label">Date</label>
              <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="auth-field flex-1">
              <label className="field-label">Start Time</label>
              <input type="time" className="input" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
          </div>

          {/* Owner */}
          {ownerOptions.length > 0 && (
            <div className="auth-field field-gap">
              <label className="field-label">Game Owner</label>
              <select className="input" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                {ownerOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.firstName ? `${u.firstName} ${u.lastName ?? ""}`.trim() : u.username}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Location */}
          <div className="auth-field field-gap">
            <label className="field-label">Location (optional)</label>
            <input type="text" className="input" placeholder="e.g. Carson's Place"
              value={location} onChange={(e) => setLocation(e.target.value)} maxLength={100} />
          </div>

          {/* Default buy-in */}
          <div className="auth-field field-gap">
            <label className="field-label">Default Buy-In ($)</label>
            <input type="number" className="input" value={defaultBuyIn} min="1"
              onChange={(e) => {
                setDefaultBuyIn(e.target.value);
                const n = { ...buyIns };
                selectedIds.forEach((id) => { n[id] = e.target.value; });
                setBuyIns(n);
              }} />
          </div>

          {/* Players */}
          <div className="auth-field field-gap">
            <label className="field-label">Players</label>
            {players.length === 0 && <p className="hint">Add players in the Players tab first.</p>}
            <div className="player-select-grid">
              {players.map((p) => (
                <div key={p.id} className="player-select-row">
                  <button className={"player-toggle " + (selected[p.id] ? "selected" : "")} onClick={() => togglePlayer(p.id)}>
                    <Avatar src={p.avatarPath} name={p.name} size={22} />
                    {selected[p.id] && <Check weight="bold" />}{p.name}
                  </button>
                  {selected[p.id] && (
                    <input type="number" className="input buy-in-input" value={buyIns[p.id] ?? defaultBuyIn} min="1"
                      onChange={(e) => setBuyIns((prev) => ({ ...prev, [p.id]: e.target.value }))} placeholder="$" />
                  )}
                </div>
              ))}
            </div>
          </div>

          {error && <p className="error-msg">{error}</p>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={saving}>{saving ? "Creating..." : "Start Game"}</button>
        </div>
      </div>
    </div>
  );
}

export default NewGameModal;
