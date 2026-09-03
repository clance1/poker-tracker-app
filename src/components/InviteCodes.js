import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../lib/api";
import { ArrowRight, Check, Copy, Plus, X } from "./icons";

// Admin management of the codes that gate account creation.
// Regenerating revokes the old string and issues a replacement carrying the
// same label and cap, so anyone still holding the old one is locked out.
function InviteCodes() {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [copiedId, setCopiedId] = useState(null);

  const fetchCodes = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch("/api/admin/invite-codes");
      setCodes(data.codes ?? []);
      setError("");
    } catch {
      setError("Failed to load invite codes.");
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchCodes(); }, [fetchCodes]);

  const readError = (e) => {
    try { return JSON.parse(e.message).error || e.message; } catch { return e.message; }
  };

  const create = async () => {
    setCreating(true); setError("");
    try {
      await apiFetch("/api/admin/invite-codes", {
        method: "POST",
        body: { label: label.trim() || undefined, maxUses: maxUses === "" ? undefined : maxUses },
      });
      setLabel(""); setMaxUses("");
      await fetchCodes();
    } catch (e) { setError(readError(e)); }
    setCreating(false);
  };

  const act = async (id, path, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusyId(id); setError("");
    try {
      await apiFetch(`/api/admin/invite-codes/${id}/${path}`, { method: "POST" });
      await fetchCodes();
    } catch (e) { setError(readError(e)); }
    setBusyId(null);
  };

  const copy = async (code, id) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1800);
    } catch {
      setError("Could not copy to the clipboard. Select the code and copy it manually.");
    }
  };

  const usesLabel = (c) =>
    c.maxUses == null ? `${c.useCount} used` : `${c.useCount} of ${c.maxUses} used`;

  return (
    <div className="invite-section">
      <h3 className="admin-title section-gap">Invite Codes</h3>
      <p className="muted-note mb-md">
        A code is required to create an account. Signing in is unaffected.
      </p>

      <div className="invite-create-row">
        <input
          type="text" className="input" placeholder="Label (optional), e.g. Autumn 2026"
          value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60}
          aria-label="Invite code label"
        />
        <input
          type="number" className="input input-w-sm" placeholder="Max uses" min="1"
          value={maxUses} onChange={(e) => setMaxUses(e.target.value)}
          aria-label="Maximum uses, leave blank for unlimited"
        />
        <button className="btn btn-primary no-shrink" onClick={create} disabled={creating}>
          <Plus /> {creating ? "Generating…" : "Generate"}
        </button>
      </div>

      {error && <p className="error-msg" role="alert">{error}</p>}

      {loading ? (
        <p className="muted-note mt-sm">Loading invite codes…</p>
      ) : codes.length === 0 ? (
        <div className="empty-state empty-state-compact">
          <div className="empty-title">No invite codes yet</div>
          <p>Generate one above, then share it with whoever should be able to join.</p>
        </div>
      ) : (
        <div className="invite-list">
          {codes.map((c) => (
            <div key={c.id} className={"invite-row" + (c.active ? "" : " invite-row-inactive")}>
              <div className="invite-main">
                <code className="invite-code">{c.code}</code>
                <div className="invite-meta">
                  <span className={"invite-status " + (c.active ? "is-active" : "is-revoked")}>
                    {c.active ? "Active" : c.revokedAt ? "Revoked" : "Used up"}
                  </span>
                  <span className="invite-uses">{usesLabel(c)}</span>
                  {c.label && <span className="invite-label">{c.label}</span>}
                </div>
                {c.redemptions.length > 0 && (
                  <div className="invite-redeemers">
                    Claimed by {c.redemptions.map((r) => r.username).join(", ")}
                  </div>
                )}
              </div>
              <div className="invite-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => copy(c.code, c.id)}
                  aria-label={`Copy ${c.code}`}>
                  {copiedId === c.id ? <><Check /> Copied</> : <><Copy /> Copy</>}
                </button>
                <button className="btn btn-ghost btn-sm" disabled={busyId === c.id}
                  onClick={() => act(c.id, "regenerate",
                    "Regenerate this code? The current one stops working immediately.")}>
                  <ArrowRight /> Regenerate
                </button>
                {c.active && (
                  <button className="btn btn-danger btn-sm" disabled={busyId === c.id}
                    onClick={() => act(c.id, "revoke",
                      "Revoke this code? Nobody will be able to register with it.")}>
                    <X /> Revoke
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default InviteCodes;
