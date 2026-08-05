import { useState } from "react";
import { storeAvatar, storeRole, storeUsername } from "../lib/api";
import { sanitizeInput } from "../lib/format";

// --- Login Screen ---
function LoginScreen({ onLogin, onRequirePasswordChange }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const switchMode = (m) => { setMode(m); setError(""); setPassword(""); setConfirm(""); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const cleanUser = sanitizeInput(username, 30);
    if (!cleanUser) return setError("Username is required.");
    if (!password) return setError("Password is required.");
    if (mode === "register") {
      if (cleanUser.length < 2) return setError("Username must be at least 2 characters.");
      if (!/^[a-zA-Z0-9_.-]+$/.test(cleanUser))
        return setError("Username may only contain letters, numbers, underscores, hyphens, and dots.");
      if (password.length < 6) return setError("Password must be at least 6 characters.");
      if (password !== confirm) return setError("Passwords don't match.");
    }
    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/api/login" : "/api/register";
      const data = await fetch(endpoint, {
        method: "POST",
        credentials: "include",  // allow the server to set the httpOnly auth cookie
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: cleanUser, password }),
      });
      const json = await data.json();
      if (!data.ok) throw new Error(json.error || "Request failed.");
      if (json.requiresPasswordChange) {
        // Admin with default password — collect new password before issuing session
        onRequirePasswordChange(cleanUser, password);
        return;
      }
      const role = json.role ?? "user";
      const avatarPath = json.avatarPath ?? null;
      storeUsername(json.username);
      storeRole(role);
      storeAvatar(avatarPath);
      // Hand the values to the parent as well — it seeds React state from these,
      // and passing nothing left the app roleless (no Admin tab) until a reload.
      onLogin(json.username, role, avatarPath);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">🃏 Poker Tracker</div>
        <div className="auth-tabs">
          <button className={"auth-tab" + (mode === "login" ? " active" : "")} onClick={() => switchMode("login")}>Sign In</button>
          <button className={"auth-tab" + (mode === "register" ? " active" : "")} onClick={() => switchMode("register")}>Create Account</button>
        </div>
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label className="field-label">Username</label>
            <input type="text" className="input" placeholder="Enter username"
              value={username} onChange={(e) => setUsername(e.target.value)}
              autoFocus autoComplete="username" maxLength={30} />
          </div>
          <div className="auth-field">
            <label className="field-label">Password</label>
            <input type="password" className="input"
              placeholder={mode === "register" ? "Min. 6 characters" : "Enter password"}
              value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"} />
          </div>
          {mode === "register" && (
            <div className="auth-field">
              <label className="field-label">Confirm Password</label>
              <input type="password" className="input" placeholder="Re-enter password"
                value={confirm} onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password" />
            </div>
          )}
          {error && <p className="error-msg">{error}</p>}
          <button className="btn btn-primary login-btn" type="submit" disabled={loading}>
            {loading ? (mode === "login" ? "Signing in..." : "Creating account...") : (mode === "login" ? "Sign In" : "Create Account")}
          </button>
        </form>
      </div>
    </div>
  );
}

export default LoginScreen;
