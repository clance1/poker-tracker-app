import { useState, useEffect, useRef } from "react";
import { apiFetch } from "../../lib/api";
import { SUIT_COLORS } from "../../lib/constants";
import { parseFrame } from "../../lib/format";
import AchievementImage from "./AchievementImage";
import Avatar from "../Avatar";
import CriteriaEditor from "./CriteriaEditor";
import ImageFramer from "./ImageFramer";
import { Cards, Check, Minus, Plus, Sparkle, X } from "../icons";

// --- Direct image upload + framing controls ---
function DirectImageUpload({ achievementId, currentSrc, frame, uploading, setUploading, onUploaded, onFrameChange, previewName, previewDesc, accentColor }) {
  const fileRef = useRef(null);
  const [error, setError] = useState("");

  const isUrlImage = currentSrc && !currentSrc.trimStart().startsWith('<svg') && !currentSrc.trimStart().startsWith('<SVG');

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError("Image must be under 5MB."); return; }
    setError(""); setUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("imageFrame", JSON.stringify(frame));
      const res = await fetch(`/api/achievements/${achievementId}/upload-image`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Upload failed.");
      onUploaded(result.imageSvg, result.imageFrame);
    } catch (err) { setError(err.message); }
    setUploading(false);
    if (e.target) e.target.value = "";
  };

  return (
    <div className="direct-image-upload">
      <div className={"inspiration-upload-row" + (isUrlImage ? " mb-md" : "")}>
        <label className={"btn btn-ghost btn-sm inspiration-upload-btn" + (uploading ? " disabled" : "")}>
          {uploading ? "Uploading…" : currentSrc ? "Replace Image" : "Upload Image"}
          <input ref={fileRef} type="file" accept="image/*" className="hidden-input"
            onChange={handleFile} disabled={uploading} />
        </label>
        {currentSrc && (
          <span className="muted-note-sm">
            {isUrlImage ? "URL image" : "SVG art"} · {isUrlImage ? "framing controls below" : "upload to replace"}
          </span>
        )}
      </div>
      {error && <p className="error-msg mt-xs">{error}</p>}
      {isUrlImage && (
        <div className="framer-section">
          <div className="framer-with-preview">
            <div className="framer-editor-col">
              <ImageFramer src={currentSrc} frame={frame} onChange={onFrameChange} />
              <button
                className="btn btn-ghost btn-sm framer-reset-btn"
                onClick={() => onFrameChange({ px: 50, py: 50, scale: 1 })}
              >
                Reset framing
              </button>
            </div>
            <div className="framer-preview-col">
              <div className="framer-preview-label">Card Preview</div>
              <div className="framer-preview-card joker-achievement-card joker-earned"
                style={{ "--joker-accent": accentColor || undefined }}>
                <div className="joker-card-header" style={{ "--joker-accent": accentColor || undefined }}>
                  <span className="joker-card-label">JOKER</span>
                </div>
                <div className="joker-image-area">
                  <AchievementImage src={currentSrc} imageFrame={JSON.stringify(frame)} />
                </div>
                <div className="joker-card-footer">
                  <div className="joker-achievement-name">{previewName || "-"}</div>
                  {previewDesc && (
                    <div className="joker-achievement-desc clamp-2">
                      {previewDesc}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- User Assignment Section (inside EditAchievementModal, admin only) ---
function UserAssignmentSection({ achievementId }) {
  const [users, setUsers] = useState(null);
  const [toggling, setToggling] = useState(new Set());
  const [patchingCount, setPatchingCount] = useState(new Set());
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch(`/api/achievements/${achievementId}/users`)
      .then(setUsers)
      .catch(() => setError("Failed to load users."));
  }, [achievementId]);

  const toggle = async (user) => {
    if (toggling.has(user.id)) return;
    setToggling((prev) => { const n = new Set(prev); n.add(user.id); return n; });
    setError("");
    try {
      if (user.earned) {
        await apiFetch(`/api/achievements/${achievementId}/users/${user.id}`, { method: "DELETE" });
        setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, earned: false, earnedAt: null, count: null } : u));
      } else {
        const result = await apiFetch(`/api/achievements/${achievementId}/users/${user.id}`, { method: "POST" });
        setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, earned: true, earnedAt: result.earnedAt, count: result.timesEarned ?? 1 } : u));
      }
    } catch (e) {
      let msg = e.message;
      try { msg = JSON.parse(e.message).error || msg; } catch {}
      setError(msg);
    }
    setToggling((prev) => { const n = new Set(prev); n.delete(user.id); return n; });
  };

  const adjustCount = async (user, delta) => {
    if (patchingCount.has(user.id)) return;
    const newCount = Math.max(1, (user.count ?? 1) + delta);
    // Optimistic update
    setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, count: newCount } : u));
    setPatchingCount((prev) => { const n = new Set(prev); n.add(user.id); return n; });
    try {
      await apiFetch(`/api/achievements/${achievementId}/users/${user.id}/count`, {
        method: "PATCH", body: { count: newCount },
      });
    } catch (e) {
      // Roll back on failure
      setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, count: user.count ?? 1 } : u));
      let msg = e.message;
      try { msg = JSON.parse(e.message).error || msg; } catch {}
      setError(msg);
    }
    setPatchingCount((prev) => { const n = new Set(prev); n.delete(user.id); return n; });
  };

  if (!users) return <div className="muted-note">Loading users…</div>;

  return (
    <>
      {error && <p className="error-msg mb-xs">{error}</p>}
      <div className="user-assignment-list">
        {users.map((u) => (
          <div key={u.id} className="user-assignment-row">
            <Avatar src={u.avatarPath} name={u.username} size={28} />
            <div className="user-assignment-info">
              <span className="user-assignment-name">{u.displayName}</span>
              {u.earned && u.earnedAt && (
                <span className="user-assignment-date">
                  earned {new Date(u.earnedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
              )}
            </div>
            {u.earned && (
              <div className="ua-count-stepper">
                <button
                  className="ua-stepper-btn"
                  onClick={() => adjustCount(u, -1)}
                  disabled={patchingCount.has(u.id) || (u.count ?? 1) <= 1}
                  aria-label="Decrease count"
                ><Minus /></button>
                <span className="ua-stepper-val">{u.count ?? 1}</span>
                <button
                  className="ua-stepper-btn"
                  onClick={() => adjustCount(u, 1)}
                  disabled={patchingCount.has(u.id)}
                  aria-label="Increase count"
                ><Plus /></button>
              </div>
            )}
            <button
              className={"btn btn-sm ua-toggle-btn " + (u.earned ? "btn-danger" : "btn-ghost")}
              onClick={() => toggle(u)}
              disabled={toggling.has(u.id)}
              aria-label={u.earned ? "Revoke" : "Grant"}
            >
              {toggling.has(u.id)
                ? <span className="ua-btn-icon" aria-hidden="true">…</span>
                : u.earned
                  ? (<><span className="ua-btn-text">Revoke</span><X className="ua-btn-icon" aria-hidden="true" /></>)
                  : (<><span className="ua-btn-text">Grant</span><Check className="ua-btn-icon" aria-hidden="true" /></>)
              }
            </button>
          </div>
        ))}
        {users.length === 0 && (
          <p className="muted-note">No users found.</p>
        )}
      </div>
    </>
  );
}

// --- Edit Achievement Modal (admin) ---
function EditAchievementModal({ achievement, onClose, onSaved }) {
  const [name, setName] = useState(achievement.name);
  const [description, setDescription] = useState(achievement.description);
  const [xpValue, setXpValue] = useState(achievement.xpValue ?? 0);
  const [feedback, setFeedback] = useState("");
  const [inspirationFile, setInspirationFile] = useState(null);
  const [inspirationPreview, setInspirationPreview] = useState(null);
  const [previewSvg, setPreviewSvg] = useState(achievement.imageSvg || null);
  const [previewFrame, setPreviewFrame] = useState(() => parseFrame(achievement.imageFrame));
  const [uploadingImage, setUploadingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState("");

  const parsedInitial = (() => {
    try { return achievement.criteriaJson ? JSON.parse(achievement.criteriaJson) : null; } catch { return null; }
  })();
  const [criteriaObj, setCriteriaObj] = useState(parsedInitial || { scope: 'game', conditions: [] });

  const handleInspirationChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setInspirationFile(file);
    setInspirationPreview(URL.createObjectURL(file));
  };

  const handleSave = async () => {
    const n = name.trim();
    if (!n) return setError("Name cannot be empty.");
    setSaving(true); setError("");
    try {
      await apiFetch(`/api/achievements/${achievement.id}`, {
        method: "PATCH",
        body: {
          name: n,
          description: description.trim(),
          xpValue: parseInt(xpValue, 10) || 0,
          imageSvg: previewSvg,
          imageFrame: JSON.stringify(previewFrame),
          criteriaJson: JSON.stringify(criteriaObj),
        },
      });
      onSaved();
    } catch (e) {
      let msg = e.message;
      try { msg = JSON.parse(e.message).error || msg; } catch {}
      setError(msg);
    }
    setSaving(false);
  };

  const handleRegenerate = async () => {
    setRegenerating(true); setError("");
    try {
      await apiFetch(`/api/achievements/${achievement.id}`, {
        method: "PATCH",
        body: { name: name.trim(), description: description.trim() },
      });
      const formData = new FormData();
      if (feedback.trim()) formData.append("feedback", feedback.trim());
      if (inspirationFile) formData.append("inspirationImage", inspirationFile);
      const res = await fetch(`/api/achievements/${achievement.id}/regenerate`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Regenerate failed.");
      setPreviewSvg(result.imageSvg);
      setFeedback("");
      setInspirationFile(null);
      setInspirationPreview(null);
    } catch (e) {
      let msg = e.message;
      try { msg = JSON.parse(e.message).error || msg; } catch {}
      setError(msg);
    }
    setRegenerating(false);
  };

  const colorIdx = name.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % SUIT_COLORS.length;
  const accentColor = SUIT_COLORS[colorIdx];

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-xl">
        <div className="modal-header">
          <h2>Edit Achievement</h2>
          <button className="close-btn" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="modal-body stack-lg">

          {/* Top row: card preview + fields */}
          <div className="row-lg">
            <div className="no-shrink">
              <div className="field-label mb-xs">Preview</div>
              <div className="joker-achievement-card joker-earned joker-preview-card">
                <div className="joker-card-header" style={{ "--joker-accent": accentColor }}>
                  <span className="joker-card-label">JOKER</span>
                </div>
                <div className="joker-image-area">
                  {previewSvg ? (
                    <AchievementImage src={previewSvg} imageFrame={previewFrame ? JSON.stringify(previewFrame) : null} accentColor={accentColor} />
                  ) : (
                    <div className="joker-default-art" style={{ "--joker-accent": accentColor }}>
                      <Cards className="joker-default-symbol" weight="fill" size={34} />
                    </div>
                  )}
                </div>
                <div className="joker-card-footer">
                  <div className="joker-achievement-name">{name || "-"}</div>
                  <div className="joker-achievement-desc clamp-2">
                    {description || "-"}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-fill stack-md">
              <div className="auth-field">
                <label className="field-label">Name</label>
                <input type="text" className="input" maxLength={100}
                  value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="auth-field">
                <label className="field-label">Description</label>
                <textarea className="input" rows={3} maxLength={500}
                  value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div className="auth-field">
                <label className="field-label">XP Value <span className="rule-form-optional">(awarded when earned)</span></label>
                <input type="number" className="input input-w-sm" min={0} max={9999}
                  value={xpValue} onChange={(e) => setXpValue(e.target.value)} />
              </div>
              <div className="auth-field">
                <label className="field-label">
                  Regenerate Art
                  <span className="rule-form-optional ml-xs">optional guidance</span>
                </label>
                <div className="row-sm">
                  <input type="text" className="input" maxLength={300}
                    placeholder='e.g. "Monopoly man with top hat, 64-bit style"'
                    value={feedback} onChange={(e) => setFeedback(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !regenerating && handleRegenerate()} />
                  <button className="btn btn-secondary no-shrink" onClick={handleRegenerate} disabled={regenerating}>
                    {regenerating ? "…" : <><Sparkle weight="fill" /> Gen</>}
                  </button>
                </div>
              </div>
              <div className="auth-field">
                <label className="field-label">
                  Inspiration Image
                  <span className="rule-form-optional ml-xs">visual reference for Gemini</span>
                </label>
                <div className="inspiration-upload-row">
                  <label className="btn btn-ghost btn-sm inspiration-upload-btn">
                    {inspirationFile ? "Change Image" : "Upload Image"}
                    <input type="file" accept="image/*" className="hidden-input" onChange={handleInspirationChange} />
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
          </div>

          {/* Direct image upload + framing */}
          <div className="criteria-section">
            <div className="criteria-section-header">
              <span className="criteria-section-title">Image</span>
              <span className="criteria-section-hint">Upload directly, or generate with Gemini above</span>
            </div>
            <DirectImageUpload
              achievementId={achievement.id}
              currentSrc={previewSvg}
              frame={previewFrame}
              uploading={uploadingImage}
              setUploading={setUploadingImage}
              onUploaded={(imageSvg, imageFrame) => {
                setPreviewSvg(imageSvg);
                setPreviewFrame(parseFrame(imageFrame));
              }}
              onFrameChange={setPreviewFrame}
              previewName={name}
              previewDesc={description}
              accentColor={accentColor}
            />
          </div>

          {/* Criteria logic */}
          <div className="criteria-section">
            <div className="criteria-section-header">
              <span className="criteria-section-title">Criteria Logic</span>
              <span className="criteria-section-hint">Defines when this achievement is auto-awarded</span>
            </div>
            <CriteriaEditor value={criteriaObj} onChange={setCriteriaObj} />
          </div>

          {/* User Assignments */}
          <div className="criteria-section">
            <div className="criteria-section-header">
              <span className="criteria-section-title">User Assignments</span>
              <span className="criteria-section-hint">Manually grant or revoke this achievement for individual users</span>
            </div>
            <UserAssignmentSection achievementId={achievement.id} />
          </div>

        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || regenerating}>
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default EditAchievementModal;
