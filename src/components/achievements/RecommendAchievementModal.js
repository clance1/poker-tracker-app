import { useState, useRef } from "react";
import { X } from "../icons";

// --- Recommend Achievement Modal ---
function RecommendAchievementModal({ onClose, onSubmitted }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);

  const handleImageSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setError("Image must be under 5MB.");
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setError("");
  };

  const handleSubmit = async () => {
    const n = name.trim();
    const d = description.trim();
    if (!n) return setError("Name is required.");
    if (!d) return setError("Description is required.");
    setSaving(true); setError("");
    try {
      const formData = new FormData();
      formData.append("name", n);
      formData.append("description", d);
      if (imageFile) formData.append("referenceImage", imageFile);
      const res = await fetch("/api/achievements/recommendations", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Submission failed.");
      onSubmitted();
    } catch (e) {
      let msg = e.message;
      try { msg = JSON.parse(e.message).error || msg; } catch {}
      setError(msg);
    }
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-md">
        <div className="modal-header">
          <h2>Suggest an Achievement</h2>
          <button className="close-btn" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="modal-body modal-body-stack">
          <p className="modal-intro">
            Propose a new achievement for the group. Admins will review and approve it.
          </p>
          <div className="auth-field">
            <label className="field-label">Achievement Name</label>
            <input type="text" className="input" maxLength={100} placeholder='e.g. "Last Man Standing"'
              value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="auth-field">
            <label className="field-label">Description</label>
            <textarea className="input" rows={3} maxLength={500}
              placeholder="Describe what you have to do to earn it…"
              value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="auth-field">
            <label className="field-label">Reference Image <span className="rule-form-optional">(optional)</span></label>
            <div className="inspiration-upload-row">
              <label className="btn btn-ghost btn-sm inspiration-upload-btn">
                {imageFile ? "Change Image" : "Upload Image"}
                <input ref={fileRef} type="file" accept="image/*" className="hidden-input"
                  onChange={handleImageSelect} />
              </label>
              {imagePreview && (
                <>
                  <img src={imagePreview} alt="reference" className="inspiration-thumb" />
                  <button className="btn btn-ghost btn-sm"
                    aria-label="Remove reference image"
                    onClick={() => { setImageFile(null); setImagePreview(null); }}><X /></button>
                </>
              )}
            </div>
          </div>
          {error && <p className="error-msg">{error}</p>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? "Submitting…" : "Submit Suggestion"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default RecommendAchievementModal;
