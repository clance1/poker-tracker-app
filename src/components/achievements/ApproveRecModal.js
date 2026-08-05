import { useState } from "react";
import { apiFetch } from "../../lib/api";
import { X } from "../icons";

// --- Approve Recommendation Modal (admin) ---
function ApproveRecModal({ rec, onClose, onApproved }) {
  const [name, setName] = useState(rec.name);
  const [description, setDescription] = useState(rec.description);
  const [feedback, setFeedback] = useState("");
  const [inspirationFile, setInspirationFile] = useState(null);
  const [inspirationPreview, setInspirationPreview] = useState(null);
  const [saving, setSaving] = useState(null); // null | "art" | "no-art"
  const [error, setError] = useState("");

  const handleApprove = async (generateArt) => {
    setSaving(generateArt ? "art" : "no-art"); setError("");
    try {
      const formData = new FormData();
      formData.append("name", name.trim() || rec.name);
      formData.append("description", description.trim() || rec.description);
      formData.append("generateArt", generateArt ? "true" : "false");
      if (generateArt && feedback.trim()) formData.append("imageFeedback", feedback.trim());
      if (generateArt && inspirationFile) formData.append("inspirationImage", inspirationFile);
      const res = await fetch(`/api/achievements/recommendations/${rec.id}/approve`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Approve failed.");
      onApproved();
    } catch (e) {
      let msg = e.message;
      try { msg = JSON.parse(e.message).error || msg; } catch {}
      setError(msg);
    }
    setSaving(null);
  };

  const handleReject = async () => {
    if (!window.confirm(`Reject "${rec.name}"?`)) return;
    try {
      await apiFetch(`/api/achievements/recommendations/${rec.id}/reject`, { method: "POST" });
      onApproved();
    } catch {}
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg">
        <div className="modal-header">
          <h2>Review Suggestion</h2>
          <button className="close-btn" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="modal-body modal-body-stack">
          <p className="modal-intro">
            Suggested by <strong className="modal-intro-strong">{rec.username}</strong>
          </p>
          <div className="auth-field">
            <label className="field-label">Name</label>
            <input type="text" className="input" maxLength={100} value={name}
              onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="auth-field">
            <label className="field-label">Description</label>
            <textarea className="input" rows={3} maxLength={500} value={description}
              onChange={(e) => setDescription(e.target.value)} />
          </div>
          {rec.referenceImagePath && (
            <div>
              <div className="field-label">Reference Image</div>
              <img src={rec.referenceImagePath} alt="Reference supplied with the suggestion" className="rec-reference-img" />
            </div>
          )}
          <div className="auth-field">
            <label className="field-label">Art Guidance <span className="rule-form-optional">(optional — instructions for Gemini)</span></label>
            <input type="text" className="input" maxLength={300} placeholder='e.g. "dark background, playing card aesthetic"'
              value={feedback} onChange={(e) => setFeedback(e.target.value)} />
          </div>
          <div className="auth-field">
            <label className="field-label">Custom Inspiration Image <span className="rule-form-optional">(optional — overrides reference above)</span></label>
            <div className="inspiration-upload-row">
              <label className="btn btn-ghost btn-sm inspiration-upload-btn">
                {inspirationFile ? "Change" : "Upload"}
                <input type="file" accept="image/*" className="hidden-input"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) { setInspirationFile(f); setInspirationPreview(URL.createObjectURL(f)); }
                  }} />
              </label>
              {inspirationPreview && (
                <>
                  <img src={inspirationPreview} alt="inspiration" className="inspiration-thumb" />
                  <button className="btn btn-ghost btn-sm"
                    aria-label="Remove inspiration image"
                    onClick={() => { setInspirationFile(null); setInspirationPreview(null); }}><X /></button>
                </>
              )}
            </div>
          </div>
          {error && <p className="error-msg">{error}</p>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-danger" onClick={handleReject} disabled={!!saving}>Reject</button>
          <div className="modal-footer-spacer" />
          <button className="btn btn-ghost" onClick={onClose} disabled={!!saving}>Cancel</button>
          <button className="btn btn-ghost" onClick={() => handleApprove(false)} disabled={!!saving}>
            {saving === "no-art" ? "Approving…" : "Approve"}
          </button>
          <button className="btn btn-primary" onClick={() => handleApprove(true)} disabled={!!saving}>
            {saving === "art" ? "Generating…" : "Approve & Generate Art"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ApproveRecModal;
