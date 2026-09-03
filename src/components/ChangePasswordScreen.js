import { useState } from "react";
import { storeAvatar, storeRole, storeUsername } from "../lib/api";

// --- Change Password Screen (forced rotation for first-time admin login) ---
function ChangePasswordScreen({ username, currentPassword, onSuccess }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < 6) return setError("Password must be at least 6 characters.");
    if (newPassword !== confirm) return setError("Passwords don't match.");
    if (newPassword === currentPassword) return setError("New password must differ from current password.");
    setLoading(true);
    try {
      const res = await fetch("/api/change-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, currentPassword, newPassword }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Password change failed.");
      storeUsername(json.username);
      storeRole(json.role ?? "user");
      storeAvatar(json.avatarPath ?? null);
      onSuccess();
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">🃏 Poker Tracker</div>
        <p className="auth-note">
          You must set a new admin password before continuing.
        </p>
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label className="field-label">New Password</label>
            <input type="password" className="input" placeholder="Min. 6 characters"
              value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              autoFocus autoComplete="new-password" />
          </div>
          <div className="auth-field">
            <label className="field-label">Confirm New Password</label>
            <input type="password" className="input" placeholder="Re-enter new password"
              value={confirm} onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password" />
          </div>
          {error && <p className="error-msg">{error}</p>}
          <button className="btn btn-primary login-btn" type="submit" disabled={loading}>
            {loading ? "Saving..." : "Set New Password & Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default ChangePasswordScreen;
