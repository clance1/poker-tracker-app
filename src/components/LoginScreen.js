import { useState } from "react";
import { storeAvatar, storeRole, storeUsername } from "../lib/api";
import { isValidEmail, sanitizeInput } from "../lib/format";

// --- Login Screen ---
// Sign-in is open to anyone with an account. Creating one requires an invite
// code issued by an admin, plus an email: the email is what lets a guest's
// existing game history transfer onto the new account.
function LoginScreen({ onLogin, onRequirePasswordChange }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [email, setEmail] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const switchMode = (m) => {
    setMode(m);
    setError("");
    setPassword("");
    setConfirm("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const cleanUser = sanitizeInput(username, 30);
    if (!cleanUser) return setError("Username is required.");
    if (!password) return setError("Password is required.");

    const cleanEmail = sanitizeInput(email, 254).toLowerCase();
    const cleanCode = sanitizeInput(inviteCode, 40);

    if (mode === "register") {
      if (!cleanCode) return setError("An invite code is required to create an account.");
      if (cleanUser.length < 2) return setError("Username must be at least 2 characters.");
      if (!/^[a-zA-Z0-9_.-]+$/.test(cleanUser))
        return setError("Username may only contain letters, numbers, underscores, hyphens, and dots.");
      if (!cleanEmail) return setError("An email address is required.");
      if (!isValidEmail(cleanEmail)) return setError("Enter a valid email address.");
      if (password.length < 6) return setError("Password must be at least 6 characters.");
      if (password !== confirm) return setError("Passwords don't match.");
    }

    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/api/login" : "/api/register";
      const payload = mode === "login"
        ? { username: cleanUser, password }
        : { username: cleanUser, password, email: cleanEmail, inviteCode: cleanCode };
      const data = await fetch(endpoint, {
        method: "POST",
        credentials: "include",  // allow the server to set the httpOnly auth cookie
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await data.json();
      if (!data.ok) throw new Error(json.error || "Request failed.");
      if (json.requiresPasswordChange) {
        // Admin with default password: collect a new one before issuing a session.
        onRequirePasswordChange(cleanUser, password);
        return;
      }
      const role = json.role ?? "user";
      const avatarPath = json.avatarPath ?? null;
      storeUsername(json.username);
      storeRole(role);
      storeAvatar(avatarPath);
      // Hand the values to the parent as well: it seeds React state from these,
      // and passing nothing left the app roleless (no Admin tab) until a reload.
      onLogin(json.username, role, avatarPath);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const registering = mode === "register";

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">
          <img src="/favicon.svg" alt="" className="login-mark" width="36" height="36" />
          Carson&rsquo;s Game
        </div>
        <div className="auth-tabs">
          <button type="button" className={"auth-tab" + (!registering ? " active" : "")}
            onClick={() => switchMode("login")}>Sign In</button>
          <button type="button" className={"auth-tab" + (registering ? " active" : "")}
            onClick={() => switchMode("register")}>Create Account</button>
        </div>
        <form onSubmit={handleSubmit} className="auth-form">
          {registering && (
            <div className="auth-field">
              <label className="field-label" htmlFor="invite-code">Invite Code</label>
              <input id="invite-code" type="text" className="input invite-code-input"
                placeholder="XXXX-XXXX-XXXX-XXXX"
                value={inviteCode} onChange={(e) => setInviteCode(e.target.value)}
                autoComplete="off" autoCapitalize="characters" spellCheck="false" maxLength={40} />
              <p className="field-hint">Ask an admin for a current code.</p>
            </div>
          )}

          <div className="auth-field">
            <label className="field-label" htmlFor="username">Username</label>
            <input id="username" type="text" className="input" placeholder="Enter username"
              value={username} onChange={(e) => setUsername(e.target.value)}
              autoFocus autoComplete="username" maxLength={30} />
          </div>

          {registering && (
            <div className="auth-field">
              <label className="field-label" htmlFor="email">Email</label>
              <input id="email" type="email" className="input" placeholder="you@example.com"
                value={email} onChange={(e) => setEmail(e.target.value)}
                autoComplete="email" maxLength={254} />
              <p className="field-hint">
                If you have played as a guest, use the address the admin has on file
                and your game history moves across.
              </p>
            </div>
          )}

          <div className="auth-field">
            <label className="field-label" htmlFor="password">Password</label>
            <input id="password" type="password" className="input"
              placeholder={registering ? "Min. 6 characters" : "Enter password"}
              value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete={registering ? "new-password" : "current-password"} />
          </div>

          {registering && (
            <div className="auth-field">
              <label className="field-label" htmlFor="confirm">Confirm Password</label>
              <input id="confirm" type="password" className="input" placeholder="Re-enter password"
                value={confirm} onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password" />
            </div>
          )}

          {error && <p className="error-msg" role="alert">{error}</p>}
          <button className="btn btn-primary login-btn" type="submit" disabled={loading}>
            {loading
              ? (registering ? "Creating account..." : "Signing in...")
              : (registering ? "Create Account" : "Sign In")}
          </button>
        </form>
      </div>
    </div>
  );
}

export default LoginScreen;
