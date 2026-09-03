import { useState } from "react";
import { apiFetch } from "../../lib/api";
import { sanitizeInput } from "../../lib/format";
import { X } from "../icons";

function DuplicateRuleModal({ rule, existingNames, onClose, onDuplicated }) {
  const suggestName = () => {
    const taken = new Set(existingNames.map((n) => n.toLowerCase()));
    const base = rule.gameName + " (Copy)";
    if (!taken.has(base.toLowerCase())) return base;
    let i = 2;
    while (taken.has((rule.gameName + " (Copy " + i + ")").toLowerCase())) i++;
    return rule.gameName + " (Copy " + i + ")";
  };

  const [name, setName] = useState(suggestName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const duplicate = async () => {
    const trimmed = sanitizeInput(name, 100);
    if (!trimmed) return setError("Game name is required.");
    setSaving(true); setError("");
    try {
      await apiFetch("/api/rules/" + rule.id + "/duplicate", { method: "POST", body: { gameName: trimmed } });
      onDuplicated();
    } catch (e) {
      let msg = e.message;
      try { msg = JSON.parse(e.message).error || msg; } catch {}
      setError(msg);
    }
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">Duplicate Rule</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="modal-body">
          <p className="dupe-source-label">Duplicating: <strong>{rule.gameName}</strong></p>
          <label className="rule-form-label">New Rule Name *</label>
          <input className="input" value={name} maxLength={100} autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && duplicate()} />
          {error && <p className="error-msg">{error}</p>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={duplicate} disabled={saving}>
            {saving ? "Duplicating…" : "Duplicate"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default DuplicateRuleModal;
