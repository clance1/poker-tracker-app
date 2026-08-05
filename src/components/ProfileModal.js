import { useState, useEffect, useRef } from "react";
import { apiFetch, storeAvatar } from "../lib/api";
import { ROLE_CLASS, ROLE_LABEL } from "../lib/constants";
import { isValidEmail, sanitizeInput } from "../lib/format";
import Avatar from "./Avatar";
import { Camera, Lightning, X } from "./icons";

// --- Profile Modal ---
function ProfileModal({ onClose, onAvatarChange, onSignOut }) {
  const [profileTab, setProfileTab] = useState("profile"); // "profile" | "xp"
  const [profile, setProfile] = useState(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [telegramUserId, setTelegramUserId] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPwSection, setShowPwSection] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [xpHistory, setXpHistory] = useState([]);
  const [xpHistoryLoading, setXpHistoryLoading] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    apiFetch("/api/profile").then((p) => {
      setProfile(p);
      setFirstName(p.firstName ?? "");
      setLastName(p.lastName ?? "");
      setEmail(p.email ?? "");
      setTelegramUserId(p.telegramUserId ?? "");
      setAvatarPreview(p.avatarPath ?? null);
    }).catch(() => setError("Failed to load profile."));
  }, []);

  useEffect(() => {
    if (profileTab !== "xp") return;
    setXpHistoryLoading(true);
    apiFetch("/api/xp/history")
      .then(setXpHistory)
      .catch(() => {})
      .finally(() => setXpHistoryLoading(false));
  }, [profileTab]);

  const handleAvatarSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setError("Image must be under 5MB.");
    setAvatarPreview(URL.createObjectURL(file));
    const formData = new FormData();
    formData.append("avatar", file);
    try {
      const res = await fetch("/api/profile/avatar", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed.");
      storeAvatar(json.avatarPath);
      onAvatarChange(json.avatarPath);
      setSuccess("Avatar updated.");
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSave = async () => {
    setError(""); setSuccess("");
    const body = {};
    const fn = sanitizeInput(firstName, 50);
    const ln = sanitizeInput(lastName, 50);
    const em = sanitizeInput(email, 254);
    body.firstName = fn;
    body.lastName = ln;
    if (em && !isValidEmail(em)) return setError("Invalid email address.");
    body.email = em;
    const tg = telegramUserId.trim();
    if (tg && !/^\d{1,15}$/.test(tg)) return setError("Telegram user ID must be a number (find yours at @userinfobot).");
    body.telegramUserId = tg;
    if (showPwSection) {
      if (!newPassword) return setError("Enter a new password.");
      if (newPassword.length < 6) return setError("Password must be at least 6 characters.");
      if (newPassword !== confirmPassword) return setError("Passwords don't match.");
      body.password = newPassword;
    }
    setSaving(true);
    try {
      const updated = await apiFetch("/api/profile", { method: "PATCH", body });
      setProfile(updated);
      setTelegramUserId(updated.telegramUserId ?? "");
      setNewPassword(""); setConfirmPassword(""); setShowPwSection(false);
      setSuccess(updated.telegramUserId && !profile?.telegramUserId ? "Profile saved. Check Telegram — the bot will DM you shortly!" : "Profile saved.");
    } catch (err) {
      let msg = err.message;
      try { msg = JSON.parse(err.message).error || msg; } catch {}
      setError(msg);
    }
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal profile-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>My Profile</h2>
          <button className="close-btn" onClick={onClose} aria-label="Close"><X /></button>
        </div>

        {/* Tab bar */}
        <div className="profile-tab-bar">
          <button className={"profile-tab" + (profileTab === "profile" ? " active" : "")} onClick={() => setProfileTab("profile")}>Profile</button>
          <button className={"profile-tab" + (profileTab === "xp" ? " active" : "")} onClick={() => setProfileTab("xp")}>
            <Lightning weight="fill" /> XP{profile?.xp ? ` · ${profile.xp.toLocaleString()}` : ""}
          </button>
        </div>

        <div className="modal-body">
          {profileTab === "profile" ? (
            <>
              <div className="profile-avatar-section">
                <button className="profile-avatar-btn" onClick={() => fileInputRef.current?.click()} title="Change photo">
                  <Avatar src={avatarPreview} name={profile?.username} size={80} />
                  <span className="profile-avatar-overlay"><Camera weight="fill" size={18} /></span>
                </button>
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp"
                  className="hidden-input" onChange={handleAvatarSelect} />
                <div className="profile-avatar-info">
                  <div className="profile-username">{profile?.username}</div>
                  {profile?.role && (
                    <span className={"role-badge " + ROLE_CLASS[profile.role]}>{ROLE_LABEL[profile.role]}</span>
                  )}
                  {profile?.xp > 0 && (
                    <span className="profile-xp-badge"><Lightning weight="fill" /> {profile.xp.toLocaleString()} XP</span>
                  )}
                </div>
              </div>

              <div className="profile-name-row">
                <div className="auth-field flex-1">
                  <label className="field-label">First Name</label>
                  <input type="text" className="input" placeholder="First name"
                    value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={50} />
                </div>
                <div className="auth-field flex-1">
                  <label className="field-label">Last Name</label>
                  <input type="text" className="input" placeholder="Last name"
                    value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={50} />
                </div>
              </div>

              <div className="auth-field">
                <label className="field-label">Email <span className="field-optional">(optional)</span></label>
                <input type="email" className="input" placeholder="your@email.com"
                  value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
              </div>

              <div className="auth-field">
                <label className="field-label">
                  Telegram User ID <span className="field-optional">(optional)</span>
                  {telegramUserId && profile?.telegramUserId === telegramUserId && (
                    <span className="tg-linked-badge">Linked</span>
                  )}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  className="input"
                  placeholder="e.g. 123456789"
                  value={telegramUserId}
                  onChange={(e) => setTelegramUserId(e.target.value.replace(/\D/g, ""))}
                  maxLength={15}
                />
                <div className="tg-help">
                  <span>1. Message <b>@userinfobot</b> on Telegram to get your numeric ID.</span>
                  <span>2. Start a chat with the poker bot so it can DM you.</span>
                  <span>3. Save — the bot will add you to the group automatically.</span>
                </div>
              </div>

              <button className="btn btn-ghost btn-sm mt-xs"
                onClick={() => { setShowPwSection((v) => !v); setNewPassword(""); setConfirmPassword(""); }}>
                {showPwSection ? "Cancel password change" : "Change Password"}
              </button>

              {showPwSection && (
                <div className="mt-sm">
                  <div className="auth-field">
                    <label className="field-label">New Password</label>
                    <input type="password" className="input" placeholder="Min. 6 characters"
                      value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoFocus />
                  </div>
                  <div className="auth-field">
                    <label className="field-label">Confirm New Password</label>
                    <input type="password" className="input" placeholder="Re-enter password"
                      value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                  </div>
                </div>
              )}

              {error && <p className="error-msg">{error}</p>}
              {success && <p className="success-msg">{success}</p>}
            </>
          ) : (
            <div className="xp-history-tab">
              <div className="xp-history-total">
                <Lightning className="xp-history-total-icon" weight="fill" size={20} />
                <span className="xp-history-total-val">{(profile?.xp ?? 0).toLocaleString()}</span>
                <span className="xp-history-total-label">Total XP</span>
              </div>
              {xpHistoryLoading ? (
                <p className="xp-history-empty">Loading…</p>
              ) : xpHistory.length === 0 ? (
                <p className="xp-history-empty">No XP events yet.</p>
              ) : (
                <div className="xp-history-list">
                  {xpHistory.map((ev) => (
                    <div key={ev.id} className="xp-history-row">
                      <span className={"xp-history-amount " + (ev.amount >= 0 ? "xp-positive" : "xp-negative")}>
                        {ev.amount >= 0 ? "+" : ""}{ev.amount}
                      </span>
                      <span className="xp-history-reason">{ev.reason}</span>
                      <span className="xp-history-date">
                        {new Date(ev.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer profile-modal-footer">
          <button className="btn btn-danger btn-sm profile-signout-btn" onClick={onSignOut}>Sign Out</button>
          <div className="flex-1" />
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          {profileTab === "profile" && (
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ProfileModal;
