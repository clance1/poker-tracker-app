import { useState } from "react";
import { apiFetch } from "../lib/api";
import { sanitizeInput, todayISO } from "../lib/format";
import { Alarm, Megaphone, X } from "./icons";

// --- Schedule Game Modal ---
function ScheduleGameModal({ onClose, onScheduled }) {
  const tomorrow = () => {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  const [date, setDate] = useState(tomorrow());
  const [time, setTime] = useState("19:00");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSchedule = async () => {
    if (!date) return setError("Pick a date.");
    if (!time) return setError("Pick a time.");
    setSaving(true); setError("");
    try {
      await apiFetch("/api/scheduled-games", {
        method: "POST",
        body: { date, time, location: sanitizeInput(location, 100) || undefined },
      });
      onScheduled();
      onClose();
    } catch (err) {
      let msg = err.message;
      try { msg = JSON.parse(err.message).error || msg; } catch {}
      setError(msg);
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Schedule a Game</h2>
          <button className="close-btn" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="modal-body">
          <div className="row-md">
            <div className="auth-field flex-2">
              <label className="field-label">Date</label>
              <input type="date" className="input" value={date} min={todayISO()}
                onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="auth-field flex-1">
              <label className="field-label">Time</label>
              <input type="time" className="input" value={time}
                onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <div className="auth-field field-gap">
            <label className="field-label">Location <span className="field-optional">(optional)</span></label>
            <input type="text" className="input" placeholder="e.g. Carson's House"
              value={location} onChange={(e) => setLocation(e.target.value)} maxLength={100} />
          </div>
          <div className="tg-help field-gap">
            <span><Megaphone /> Telegram group will be notified immediately.</span>
            <span><Alarm /> A 24-hour reminder is sent automatically.</span>
          </div>
          {error && <p className="error-msg mt-sm">{error}</p>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSchedule} disabled={saving}>
            {saving ? "Scheduling…" : "Schedule Game"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ScheduleGameModal;
