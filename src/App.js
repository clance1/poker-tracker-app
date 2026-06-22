import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import "./App.css";

const API = "";

// --- Auth helpers ---
// JWT is stored in an httpOnly cookie (not accessible to JS); only non-sensitive
// display state (username, role, avatar) is kept in localStorage.
const getStoredUsername = () => localStorage.getItem("poker_username");
const storeUsername = (u) => localStorage.setItem("poker_username", u);
const clearUsername = () => localStorage.removeItem("poker_username");
const getRole = () => localStorage.getItem("poker_role") || "user";
const storeRole = (r) => localStorage.setItem("poker_role", r);
const clearRole = () => localStorage.removeItem("poker_role");
const getStoredAvatar = () => localStorage.getItem("poker_avatar") || null;
const storeAvatar = (v) => v ? localStorage.setItem("poker_avatar", v) : localStorage.removeItem("poker_avatar");

// Role helpers
const roleIsAdmin = (r) => r === "admin";
const roleIsOwner = (r) => r === "admin" || r === "owner";

// --- Client-side sanitization ---
const sanitizeInput = (val, maxLen = 100) =>
  typeof val === "string" ? val.trim().slice(0, maxLen) : "";

const isValidEmail = (val) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val.trim());

async function apiFetch(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    credentials: "include",  // send the httpOnly auth_token cookie automatically
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401) {
    // Session expired — clear display state and reload to login screen
    clearUsername();
    clearRole();
    storeAvatar(null);
    window.location.reload();
  }
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// --- Helpers ---
const fmt = (amount) => {
  if (amount === null || amount === undefined) return "$0";
  const abs = Math.abs(amount);
  const str = Number.isInteger(abs) ? abs.toFixed(0) : abs.toFixed(2);
  return (amount < 0 ? "-$" : "$") + str;
};
const fmtDate = (dateStr) => {
  if (!dateStr) return "";
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
};
const todayISO = () => new Date().toISOString().split("T")[0];
const calcNet = (gp) => (gp.cashOut ?? 0) - gp.buyIn - (gp.rebuys ?? 0);
const totalPot = (gps) => gps.reduce((s, gp) => s + gp.buyIn + (gp.rebuys ?? 0), 0);

const ROLE_LABEL = { admin: "Admin", owner: "Owner", user: "User" };
const ROLE_CLASS = { admin: "badge-admin", owner: "badge-owner", user: "badge-user" };

// --- Avatar ---
function Avatar({ src, name, size = 32 }) {
  const initials = (name || "?").slice(0, 1).toUpperCase();
  if (src) {
    return (
      <img
        src={src} alt={name}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", display: "block" }}
      />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: "var(--accent)", color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.45, fontWeight: 700, flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

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
        onRequirePasswordChange({ username: cleanUser, currentPassword: password });
        return;
      }
      storeUsername(json.username);
      storeRole(json.role ?? "user");
      storeAvatar(json.avatarPath ?? null);
      onLogin();
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
        <p style={{ textAlign: "center", marginBottom: 16, color: "var(--text-muted)" }}>
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

// --- Profile Modal ---
function ProfileModal({ onClose, onAvatarChange, onSignOut }) {
  const [profileTab, setProfileTab] = useState("profile"); // "profile" | "xp"
  const [profile, setProfile] = useState(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
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
      setNewPassword(""); setConfirmPassword(""); setShowPwSection(false);
      setSuccess("Profile saved.");
    } catch (err) {
      let msg = err.message;
      try { msg = JSON.parse(err.message).error || msg; } catch {}
      setError(msg);
    }
    setSaving(false);
  };

  const fmtMoney = (v) => (v == null ? "—" : "$" + Number(v).toFixed(0));
  const fmtMoneySign = (v) => {
    if (v == null) return "—";
    const n = Number(v);
    return (n >= 0 ? "+" : "") + "$" + Math.abs(n).toFixed(0);
  };
  const fmtDuration = (start, end) => {
    if (!start || !end) return "—";
    const ms = new Date(end) - new Date(start);
    if (ms <= 0) return "—";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h === 0) return `${m}m`;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  };
  const fmtDate = (d) => d
    ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })
    : "—";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal profile-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>My Profile</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Tab bar */}
        <div className="profile-tab-bar">
          <button className={"profile-tab" + (profileTab === "profile" ? " active" : "")} onClick={() => setProfileTab("profile")}>Profile</button>
          <button className={"profile-tab" + (profileTab === "xp" ? " active" : "")} onClick={() => setProfileTab("xp")}>
            ⚡ XP{profile?.xp ? ` · ${profile.xp.toLocaleString()}` : ""}
          </button>
        </div>

        <div className="modal-body">
          {profileTab === "profile" ? (
            <>
              <div className="profile-avatar-section">
                <button className="profile-avatar-btn" onClick={() => fileInputRef.current?.click()} title="Change photo">
                  <Avatar src={avatarPreview} name={profile?.username} size={80} />
                  <span className="profile-avatar-overlay">📷</span>
                </button>
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp"
                  style={{ display: "none" }} onChange={handleAvatarSelect} />
                <div className="profile-avatar-info">
                  <div className="profile-username">{profile?.username}</div>
                  {profile?.role && (
                    <span className={"role-badge " + ROLE_CLASS[profile.role]}>{ROLE_LABEL[profile.role]}</span>
                  )}
                  {profile?.xp > 0 && (
                    <span className="profile-xp-badge">⚡ {profile.xp.toLocaleString()} XP</span>
                  )}
                </div>
              </div>

              <div className="profile-name-row">
                <div className="auth-field" style={{ flex: 1 }}>
                  <label className="field-label">First Name</label>
                  <input type="text" className="input" placeholder="First name"
                    value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={50} />
                </div>
                <div className="auth-field" style={{ flex: 1 }}>
                  <label className="field-label">Last Name</label>
                  <input type="text" className="input" placeholder="Last name"
                    value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={50} />
                </div>
              </div>

              <div className="auth-field">
                <label className="field-label">Email</label>
                <input type="email" className="input" placeholder="your@email.com"
                  value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
              </div>

              <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}
                onClick={() => { setShowPwSection((v) => !v); setNewPassword(""); setConfirmPassword(""); }}>
                {showPwSection ? "Cancel password change" : "Change Password"}
              </button>

              {showPwSection && (
                <div style={{ marginTop: 12 }}>
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
                <span className="xp-history-total-icon">⚡</span>
                <span className="xp-history-total-val">{(profile?.xp ?? 0).toLocaleString()}</span>
                <span className="xp-history-total-label">Total XP</span>
              </div>
              {xpHistoryLoading ? (
                <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "24px 0" }}>Loading…</p>
              ) : xpHistory.length === 0 ? (
                <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "24px 0" }}>No XP events yet.</p>
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
          <div style={{ flex: 1 }} />
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

// --- Leaderboard helpers ---
const PLAYER_COLORS = ["#d4af37","#3fb950","#58a6ff","#f85149","#a855f7","#f97316","#06b6d4","#ec4899"];

const fmtDateShort = (dateStr) => {
  if (!dateStr) return "";
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const calcStreak = (completedGames) => {
  if (!completedGames.length) return { count: 0, type: null };
  const sorted = [...completedGames].sort((a, b) => b.game.date.localeCompare(a.game.date));
  const firstType = calcNet(sorted[0]) > 0 ? "W" : calcNet(sorted[0]) < 0 ? "L" : "E";
  let count = 0;
  for (const g of sorted) {
    const t = calcNet(g) > 0 ? "W" : calcNet(g) < 0 ? "L" : "E";
    if (t === firstType) count++;
    else break;
  }
  return { count, type: firstType };
};

const chartTooltipStyle = {
  background: "#1c2128", border: "1px solid #30363d",
  borderRadius: 8, fontSize: 13, boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
};

// --- Leaderboard ---
function Leaderboard({ players }) {
  const [gameFilter, setGameFilter] = useState(5);
  const [activeChart, setActiveChart] = useState("bar");
  const [hiddenPlayers, setHiddenPlayers] = useState(new Set());

  const allGames = useMemo(() => {
    const map = {};
    players.forEach((p) =>
      (p.games?.items ?? []).filter((gp) => gp.game?.isComplete).forEach((gp) => {
        if (!map[gp.game.id]) map[gp.game.id] = gp.game;
      })
    );
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
  }, [players]);

  const filteredGames = useMemo(
    () => (gameFilter === "all" ? allGames : allGames.slice(-gameFilter)),
    [allGames, gameFilter]
  );
  const filteredIds = useMemo(() => new Set(filteredGames.map((g) => g.id)), [filteredGames]);

  const playerStats = useMemo(() => {
    return players.map((p, ci) => {
      const allDone = (p.games?.items ?? []).filter((gp) => gp.game?.isComplete);
      const inPeriod = allDone.filter((gp) => filteredIds.has(gp.game.id));
      const nets = inPeriod.map(calcNet);
      const net = nets.reduce((s, n) => s + n, 0);
      const wins = nets.filter((n) => n > 0).length;
      const totalIn = inPeriod.reduce((s, gp) => s + gp.buyIn + (gp.rebuys ?? 0), 0);
      const streak = calcStreak(allDone);
      return {
        id: p.id, name: p.name, avatarPath: p.avatarPath ?? null,
        color: PLAYER_COLORS[ci % PLAYER_COLORS.length],
        xp: p.xp ?? 0,
        net, nets,
        gamesPlayed: inPeriod.length,
        wins, losses: inPeriod.length - wins,
        winRate: inPeriod.length ? wins / inPeriod.length : 0,
        avgNet: inPeriod.length ? net / inPeriod.length : 0,
        best: nets.length ? Math.max(...nets) : 0,
        worst: nets.length ? Math.min(...nets) : 0,
        roi: totalIn > 0 ? (net / totalIn) * 100 : 0,
        streak,
        allTimeGames: allDone.length,
      };
    })
      .filter((p) => p.gamesPlayed > 0)
      .sort((a, b) => b.net - a.net);
  }, [players, filteredIds]);

  const togglePlayer = (id) =>
    setHiddenPlayers((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const visibleStats = playerStats.filter((p) => !hiddenPlayers.has(p.id));

  const barData = useMemo(() =>
    filteredGames.map((g) => {
      const row = { date: fmtDateShort(g.date) };
      visibleStats.forEach((p) => {
        const gp = players.find((pl) => pl.id === p.id)?.games?.items?.find((x) => x.game?.id === g.id);
        if (gp) row[p.name] = Math.round(calcNet(gp) * 100) / 100;
      });
      return row;
    }),
    [filteredGames, players, visibleStats] // eslint-disable-line
  );

  const lineData = useMemo(() => {
    const totals = {};
    visibleStats.forEach((p) => { totals[p.id] = 0; });
    return filteredGames.map((g) => {
      const row = { date: fmtDateShort(g.date) };
      visibleStats.forEach((p) => {
        const gp = players.find((pl) => pl.id === p.id)?.games?.items?.find((x) => x.game?.id === g.id);
        if (gp) totals[p.id] = Math.round((totals[p.id] + calcNet(gp)) * 100) / 100;
        row[p.name] = totals[p.id];
      });
      return row;
    });
  }, [filteredGames, players, visibleStats]); // eslint-disable-line

  const medals = ["🥇", "🥈", "🥉"];

  if (players.length === 0)
    return <div className="empty-state"><div className="empty-icon">♠</div><p>No players yet. Add some in the Players tab.</p></div>;
  if (allGames.length === 0)
    return <div className="empty-state"><div className="empty-icon">♣</div><p>No completed games yet.</p></div>;

  return (
    <div className="lb-v2">
      <div className="lb-controls">
        <span className="lb-filter-label">Period</span>
        {[5, 10, 20, "all"].map((f) => (
          <button key={f} className={"lb-filter-btn" + (gameFilter === f ? " active" : "")} onClick={() => setGameFilter(f)}>
            {f === "all" ? "All Time" : `Last ${f}`}
          </button>
        ))}
      </div>

      <div className="lb-summary-strip">
        {[
          { val: filteredGames.length, label: gameFilter === "all" ? "Total Games" : "Games Shown" },
          { val: playerStats.length, label: "Players" },
          playerStats[0] && { val: playerStats[0].name, label: "Leading", cls: "profit" },
          playerStats[0] && { val: (playerStats[0].net >= 0 ? "+" : "") + fmt(playerStats[0].net), label: "Top Net", cls: playerStats[0].net >= 0 ? "profit" : "loss" },
        ].filter(Boolean).map((item, i) => (
          <div key={i} className="lb-summary-item">
            <div className={"lb-summary-val " + (item.cls ?? "")}>{item.val}</div>
            <div className="lb-summary-label">{item.label}</div>
          </div>
        ))}
      </div>

      <div className="lb-standings">
        {playerStats.map((p, i) => {
          const streakLabel = p.streak.count > 1 ? `${p.streak.count}${p.streak.type}` : null;
          const streakCls = p.streak.type === "W" ? "profit" : p.streak.type === "L" ? "loss" : "muted";
          return (
            <div key={p.id} className={"lb-card-v2" + (i === 0 && p.net > 0 ? " leader" : "")}
              style={{ borderLeftColor: p.color }}>
              <div className="lb-card-rank">
                {medals[i] ?? <span className="lb-rank-num">#{i + 1}</span>}
              </div>
              <div className="lb-card-body">
                <div className="lb-card-top">
                  <Avatar src={p.avatarPath} name={p.name} size={28} />
                  <span className="lb-card-name">{p.name}</span>
                  {streakLabel && (
                    <span className={"lb-streak " + streakCls} title={`${p.streak.count}-game ${p.streak.type === "W" ? "win" : "loss"} streak`}>
                      {p.streak.type === "W" ? "🔥" : "🧊"} {streakLabel}
                    </span>
                  )}
                  <span className={"lb-card-net " + (p.net >= 0 ? "profit" : "loss")}>
                    {p.net >= 0 ? "+" : ""}{fmt(p.net)}
                  </span>
                </div>
                <div className="lb-winrate-bar-bg">
                  <div className="lb-winrate-bar-fill" style={{ width: (p.winRate * 100) + "%", background: p.color }} />
                </div>
                <div className="lb-card-stats">
                  <span><span className="stat-label">GP</span> {p.gamesPlayed}</span>
                  <span><span className="stat-label">W%</span> {Math.round(p.winRate * 100)}%</span>
                  <span className={p.avgNet >= 0 ? "profit" : "loss"}>
                    <span className="stat-label">avg</span> {p.avgNet >= 0 ? "+" : ""}{fmt(p.avgNet)}
                  </span>
                  <span className="profit"><span className="stat-label">best</span> {fmt(p.best)}</span>
                  <span className="loss"><span className="stat-label">worst</span> {fmt(p.worst)}</span>
                  <span className={p.roi >= 0 ? "profit" : "loss"}>
                    <span className="stat-label">ROI</span> {p.roi >= 0 ? "+" : ""}{p.roi.toFixed(0)}%
                  </span>
                  {p.xp > 0 && (
                    <span className="lb-xp-badge">⚡ {p.xp.toLocaleString()}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredGames.length > 0 && (
        <div className="lb-charts-section">
          <div className="lb-chart-header">
            <div className="lb-chart-tabs">
              <button className={"lb-chart-tab" + (activeChart === "bar" ? " active" : "")} onClick={() => setActiveChart("bar")}>Per Game</button>
              <button className={"lb-chart-tab" + (activeChart === "line" ? " active" : "")} onClick={() => setActiveChart("line")}>Running Total</button>
            </div>
            <div className="lb-player-toggles">
              {playerStats.map((p) => (
                <button key={p.id}
                  className={"lb-toggle-btn" + (hiddenPlayers.has(p.id) ? " off" : "")}
                  style={{ "--pc": p.color }}
                  onClick={() => togglePlayer(p.id)}
                  title={hiddenPlayers.has(p.id) ? "Show " + p.name : "Hide " + p.name}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
          <div className="lb-chart">
            {activeChart === "bar" ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={barData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#30363d" vertical={false} />
                  <XAxis dataKey="date" stroke="#8b949e" fontSize={11} tick={{ fill: "#8b949e" }} />
                  <YAxis stroke="#8b949e" fontSize={11} tick={{ fill: "#8b949e" }} tickFormatter={(v) => "$" + v} width={52} />
                  <ReferenceLine y={0} stroke="#40464e" />
                  <Tooltip contentStyle={chartTooltipStyle} formatter={(v, name) => [fmt(v), name]}
                    labelStyle={{ color: "#e6edf3", fontWeight: 600, marginBottom: 4 }} />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
                  {visibleStats.map((p) => (
                    <Bar key={p.id} dataKey={p.name} fill={p.color} radius={[3, 3, 0, 0]} maxBarSize={36} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={lineData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#30363d" vertical={false} />
                  <XAxis dataKey="date" stroke="#8b949e" fontSize={11} tick={{ fill: "#8b949e" }} />
                  <YAxis stroke="#8b949e" fontSize={11} tick={{ fill: "#8b949e" }} tickFormatter={(v) => "$" + v} width={52} />
                  <ReferenceLine y={0} stroke="#40464e" />
                  <Tooltip contentStyle={chartTooltipStyle} formatter={(v, name) => [fmt(v), name]}
                    labelStyle={{ color: "#e6edf3", fontWeight: 600, marginBottom: 4 }} />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
                  {visibleStats.map((p) => (
                    <Line key={p.id} type="monotone" dataKey={p.name} stroke={p.color}
                      strokeWidth={2} dot={{ fill: p.color, r: 3, strokeWidth: 0 }} activeDot={{ r: 5 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Game History ---
function GameHistory({ games, onSelectGame, onNewGame, isOwner, isAdmin, onRefresh }) {
  const sorted = [...games].sort((a, b) => b.date.localeCompare(a.date));

  const deleteGame = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm("Permanently delete this game? This cannot be undone.")) return;
    try {
      await apiFetch(`/api/games/${id}`, { method: "DELETE" });
      await onRefresh();
    } catch (err) {
      let msg = err.message;
      try { msg = JSON.parse(err.message).error || msg; } catch {}
      alert(msg);
    }
  };

  return (
    <div className="game-history">
      {isOwner && (
        <button className="btn btn-primary new-game-btn" onClick={onNewGame}>+ New Game</button>
      )}
      {sorted.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">♣</div><p>No games yet. {isOwner ? "Start one!" : "Ask an Owner to create one."}</p></div>
      ) : sorted.map((g) => {
        const pot = totalPot(g.players?.items ?? []);
        const names = (g.players?.items ?? []).map((gp) => gp.player?.name).filter(Boolean).join(", ");
        return (
          <div key={g.id} className={"game-card " + (g.isComplete ? "complete" : "active-game")} onClick={() => onSelectGame(g)}>
            <div className="game-card-header">
              <span className="game-date">{fmtDate(g.date)}</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className={"game-status " + (g.isComplete ? "" : "badge-active")}>{g.isComplete ? "Completed" : "In Progress"}</span>
                {isAdmin && (
                  <button className="btn-icon delete-btn" title="Delete game"
                    onClick={(e) => deleteGame(e, g.id)}>✕</button>
                )}
              </div>
            </div>
            <div className="game-players-preview">{names}</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 2 }}>
              {g.location && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>📍 {g.location}</span>}
              {g.startTime && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>🕐 {g.startTime}{g.endTime ? ` – ${g.endTime}` : ""}</span>}
            </div>
            <div className="game-pot">Pot: {fmt(pot)}</div>
          </div>
        );
      })}
    </div>
  );
}

const nowTime = () => new Date().toTimeString().slice(0, 5);

// --- New Game Modal ---
const REBUY_PRESETS = [10, 20, 40];

function NewGameModal({ players, onClose, onCreate }) {
  const [date, setDate] = useState(todayISO());
  const [startTime, setStartTime] = useState(nowTime());
  const [location, setLocation] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [ownerOptions, setOwnerOptions] = useState([]);
  const [selected, setSelected] = useState({});
  const [buyIns, setBuyIns] = useState({});
  const [defaultBuyIn, setDefaultBuyIn] = useState("20");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/api/owners").then((d) => {
      setOwnerOptions(d.owners ?? []);
      if (d.owners?.length) setOwnerId(d.owners[0].id);
    }).catch(() => {});
  }, []);

  const togglePlayer = (id) => {
    setSelected((prev) => { const n = { ...prev }; if (n[id]) delete n[id]; else n[id] = true; return n; });
    if (!buyIns[id]) setBuyIns((prev) => ({ ...prev, [id]: defaultBuyIn }));
  };
  const selectedIds = Object.keys(selected);

  const handleCreate = async () => {
    if (!date) return setError("Pick a date.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError("Invalid date format.");
    if (selectedIds.length < 2) return setError("Select at least 2 players.");
    for (const id of selectedIds) {
      if (isNaN(parseFloat(buyIns[id])) || parseFloat(buyIns[id]) <= 0) return setError("All buy-ins must be > $0.");
    }
    setSaving(true); setError("");
    try {
      const game = await apiFetch("/api/games", {
        method: "POST",
        body: {
          date,
          isComplete: false,
          ownerId: ownerId || undefined,
          location: sanitizeInput(location, 100) || undefined,
          startTime: startTime || undefined,
        },
      });
      await Promise.all(selectedIds.map((playerID) =>
        apiFetch("/api/game-players", { method: "POST", body: { gameID: game.id, playerID, buyIn: parseFloat(buyIns[playerID] ?? defaultBuyIn), rebuys: 0 } })
      ));
      await onCreate();
    } catch (e) { setError("Failed to create game."); console.error(e); setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2>New Game</h2><button className="close-btn" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          {/* Date + Start Time */}
          <div style={{ display: "flex", gap: 12 }}>
            <div className="auth-field" style={{ flex: 2 }}>
              <label className="field-label">Date</label>
              <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="auth-field" style={{ flex: 1 }}>
              <label className="field-label">Start Time</label>
              <input type="time" className="input" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
          </div>

          {/* Owner */}
          {ownerOptions.length > 0 && (
            <div className="auth-field" style={{ marginTop: 14 }}>
              <label className="field-label">Game Owner</label>
              <select className="input" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                {ownerOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.firstName ? `${u.firstName} ${u.lastName ?? ""}`.trim() : u.username}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Location */}
          <div className="auth-field" style={{ marginTop: 14 }}>
            <label className="field-label">Location (optional)</label>
            <input type="text" className="input" placeholder="e.g. Carson's Place"
              value={location} onChange={(e) => setLocation(e.target.value)} maxLength={100} />
          </div>

          {/* Default buy-in */}
          <div className="auth-field" style={{ marginTop: 14 }}>
            <label className="field-label">Default Buy-In ($)</label>
            <input type="number" className="input" value={defaultBuyIn} min="1"
              onChange={(e) => {
                setDefaultBuyIn(e.target.value);
                const n = { ...buyIns };
                selectedIds.forEach((id) => { n[id] = e.target.value; });
                setBuyIns(n);
              }} />
          </div>

          {/* Players */}
          <div className="auth-field" style={{ marginTop: 14 }}>
            <label className="field-label">Players</label>
            {players.length === 0 && <p className="hint">Add players in the Players tab first.</p>}
            <div className="player-select-grid">
              {players.map((p) => (
                <div key={p.id} className="player-select-row">
                  <button className={"player-toggle " + (selected[p.id] ? "selected" : "")} onClick={() => togglePlayer(p.id)}>
                    <Avatar src={p.avatarPath} name={p.name} size={22} />
                    {selected[p.id] ? "✓ " : ""}{p.name}
                  </button>
                  {selected[p.id] && (
                    <input type="number" className="input buy-in-input" value={buyIns[p.id] ?? defaultBuyIn} min="1"
                      onChange={(e) => setBuyIns((prev) => ({ ...prev, [p.id]: e.target.value }))} placeholder="$" />
                  )}
                </div>
              ))}
            </div>
          </div>

          {error && <p className="error-msg">{error}</p>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={saving}>{saving ? "Creating..." : "Start Game"}</button>
        </div>
      </div>
    </div>
  );
}

// --- Game Detail ---
function GameDetail({ game, onBack, onRefresh, isOwner, isAdmin, allPlayers }) {
  const [gamePlayers, setGamePlayers] = useState(game.players?.items ?? []);
  const [cashOuts, setCashOuts] = useState({});
  const [saving, setSaving] = useState(false);
  const [endError, setEndError] = useState("");
  const [notes, setNotes] = useState(game.notes ?? "");
  const [rebuyOpen, setRebuyOpen] = useState(null);
  const [rebuyCustom, setRebuyCustom] = useState("");
  const [addPlayerOpen, setAddPlayerOpen] = useState(false);
  const [addPlayerID, setAddPlayerID] = useState("");
  const [addBuyIn, setAddBuyIn] = useState("20");
  const [addError, setAddError] = useState("");

  useEffect(() => {
    const initial = {};
    (game.players?.items ?? []).forEach((gp) => {
      if (gp.cashOut !== null && gp.cashOut !== undefined) initial[gp.id] = gp.cashOut.toString();
    });
    setCashOuts(initial);
    setGamePlayers(game.players?.items ?? []);
    setNotes(game.notes ?? "");
  }, [game]);

  const pot = totalPot(gamePlayers);

  const openRebuy = (gpId) => { setRebuyOpen(gpId); setRebuyCustom(""); };
  const closeRebuy = () => setRebuyOpen(null);

  const confirmRebuy = async (gp, amount) => {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return;
    closeRebuy();
    setSaving(true);
    try {
      const newRebuys = (gp.rebuys ?? 0) + amt;
      await apiFetch("/api/game-players/" + gp.id, { method: "PUT", body: { rebuys: newRebuys } });
      setGamePlayers((prev) => prev.map((p) => p.id === gp.id ? { ...p, rebuys: newRebuys } : p));
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  const cashOutTotal = gamePlayers.reduce((s, gp) => {
    const co = parseFloat(cashOuts[gp.id] ?? 0);
    return s + (isNaN(co) ? 0 : co);
  }, 0);
  const potDiff = cashOutTotal - pot;

  const handleEndGame = async () => {
    setEndError("");
    if (Math.abs(potDiff) > 0.01) return setEndError("Cash-outs (" + fmt(cashOutTotal) + ") must equal the pot (" + fmt(pot) + ").");
    setSaving(true);
    try {
      await Promise.all(gamePlayers.map((gp) =>
        apiFetch("/api/game-players/" + gp.id, { method: "PUT", body: { cashOut: parseFloat(cashOuts[gp.id] ?? 0) } })
      ));
      await apiFetch("/api/games/" + game.id, { method: "PUT", body: { isComplete: true, notes: sanitizeInput(notes, 1000), endTime: nowTime() } });
      await onRefresh();
    } catch (e) { setEndError("Save failed."); console.error(e); setSaving(false); }
  };

  const handleAddPlayer = async () => {
    setAddError("");
    if (!addPlayerID) return setAddError("Select a player.");
    const buyIn = parseFloat(addBuyIn);
    if (isNaN(buyIn) || buyIn <= 0) return setAddError("Buy-in must be > $0.");
    setSaving(true);
    try {
      const gp = await apiFetch("/api/game-players", {
        method: "POST",
        body: { gameID: game.id, playerID: addPlayerID, buyIn, rebuys: 0 },
      });
      const player = allPlayers.find((p) => p.id === addPlayerID);
      setGamePlayers((prev) => [...prev, { ...gp, player: { id: addPlayerID, name: player?.name ?? "" } }]);
      setAddPlayerID(""); setAddBuyIn("20"); setAddPlayerOpen(false);
    } catch (e) {
      let msg = e.message;
      try { msg = JSON.parse(e.message).error || msg; } catch {}
      setAddError(msg);
    }
    setSaving(false);
  };

  const availablePlayers = (allPlayers ?? []).filter(
    (p) => !gamePlayers.some((gp) => gp.player?.id === p.id)
  );

  const currentUsername = getStoredUsername();

  return (
    <div className="game-detail">
      <button className="back-btn" onClick={onBack}>← Back</button>
      <div className="detail-header">
        <h2>{fmtDate(game.date)}</h2>
        <span className={"game-status " + (game.isComplete ? "" : "badge-active")}>{game.isComplete ? "Completed" : "In Progress"}</span>
      </div>

      {/* Game metadata strip */}
      {(game.owner || game.location || game.startTime || game.endTime) && (
        <div className="game-meta">
          {game.owner && (
            <span className="game-meta-item">
              <span className="game-meta-icon">👤</span>
              {game.owner.firstName ? `${game.owner.firstName} ${game.owner.lastName ?? ""}`.trim() : game.owner.username}
            </span>
          )}
          {game.location && (
            <span className="game-meta-item">
              <span className="game-meta-icon">📍</span>{game.location}
            </span>
          )}
          {game.startTime && (
            <span className="game-meta-item">
              <span className="game-meta-icon">🕐</span>Start: {game.startTime}
            </span>
          )}
          {game.endTime && (
            <span className="game-meta-item">
              <span className="game-meta-icon">🏁</span>End: {game.endTime}
            </span>
          )}
        </div>
      )}

      {/* Balatro-style player cards */}
      <div className="player-cards-strip">
        {gamePlayers.map((gp) => {
          const totalIn = gp.buyIn + (gp.rebuys ?? 0);
          const co = game.isComplete
            ? (gp.cashOut ?? 0)
            : (parseFloat(cashOuts[gp.id] ?? "") || null);
          const net = co !== null ? co - totalIn : null;
          const isMe = gp.player?.name?.toLowerCase() === currentUsername?.toLowerCase();
          return (
            <div key={gp.id} className={"player-joker-card" + (isMe ? " player-joker-card-me" : "") + (net !== null && net > 0 ? " joker-winner" : net !== null && net < 0 ? " joker-loser" : "")}>
              <div className="joker-card-inner">
                <div className="joker-avatar-wrap">
                  <Avatar src={gp.player?.avatarPath} name={gp.player?.name} size={38} />
                </div>
                <div className="joker-player-name">{gp.player?.name ?? "?"}</div>
                <div className="joker-buy-in">
                  <span className="joker-stat-label">In</span>
                  <span className="joker-stat-val">{fmt(totalIn)}</span>
                </div>
                {game.isComplete && net !== null ? (
                  <div className={"joker-result " + (net >= 0 ? "joker-profit" : "joker-loss")}>
                    <div className="joker-cashout">{fmt(co)}</div>
                    <div className="joker-net">{net >= 0 ? "+" : ""}{fmt(net)}</div>
                  </div>
                ) : !game.isComplete && (
                  <div className="joker-live-badge">▶ Live</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Total Pot + User Contribution */}
      <div className="pot-contribution-row">
        <div className="pot-summary">
          <div className="pot-label">Total Pot</div>
          <div className="pot-amount">{fmt(pot)}</div>
        </div>
        {(() => {
          const myGp = gamePlayers.find(gp => gp.player?.name?.toLowerCase() === currentUsername?.toLowerCase());
          if (!myGp) return null;
          const myIn = myGp.buyIn + (myGp.rebuys ?? 0);
          const pct = pot > 0 ? Math.round((myIn / pot) * 100) : 0;
          return (
            <div className="my-contribution">
              <div className="pot-label">Your Contribution</div>
              <div className="pot-amount">{fmt(myIn)} <span className="contribution-pct">({pct}%)</span></div>
            </div>
          );
        })()}
      </div>
      <div className="players-table" style={{ marginTop: 16 }}>
        <div className="table-head"><span>Player</span><span>Buy-In</span><span>Rebuys</span><span>Total In</span><span>Cash Out</span><span>Net</span></div>
        {gamePlayers.map((gp) => {
          const totalIn = gp.buyIn + (gp.rebuys ?? 0);
          const co = game.isComplete ? gp.cashOut ?? 0 : (parseFloat(cashOuts[gp.id] ?? "") || null);
          const net = co !== null ? co - totalIn : null;
          const isRebuyOpen = rebuyOpen === gp.id;
          return (
            <React.Fragment key={gp.id}>
              <div className="table-row">
                <span className="player-cell">
                  <Avatar src={gp.player?.avatarPath} name={gp.player?.name} size={24} />
                  {gp.player?.name ?? "?"}
                </span>
                <span>{fmt(gp.buyIn)}</span>
                <span className="rebuy-cell">
                  <span className="rebuy-amount">{fmt(gp.rebuys ?? 0)}</span>
                  {!game.isComplete && (
                    <button
                      className={"rebuy-btn" + (isRebuyOpen ? " active" : "")}
                      onClick={() => isRebuyOpen ? closeRebuy() : openRebuy(gp.id)}
                      disabled={saving} title="Add rebuy"
                    >
                      {isRebuyOpen ? "✕" : "+"}
                    </button>
                  )}
                </span>
                <span>{fmt(totalIn)}</span>
                <span>
                  {game.isComplete ? fmt(gp.cashOut ?? 0) : (
                    <input type="number" className="input cashout-input" placeholder="$0"
                      value={cashOuts[gp.id] ?? ""} min="0"
                      onChange={(e) => setCashOuts((prev) => ({ ...prev, [gp.id]: e.target.value }))} />
                  )}
                </span>
                <span className={net !== null ? (net >= 0 ? "profit" : "loss") : "muted"}>
                  {net !== null ? (net >= 0 ? "+" : "") + fmt(net) : "--"}
                </span>
              </div>
              {isRebuyOpen && (
                <div className="rebuy-drawer">
                  <span className="rebuy-drawer-label">Rebuy for <strong>{gp.player?.name}</strong></span>
                  <div className="rebuy-presets">
                    {REBUY_PRESETS.map((amt) => (
                      <button key={amt} className="rebuy-preset-btn" onClick={() => confirmRebuy(gp, amt)}>+${amt}</button>
                    ))}
                  </div>
                  <div className="rebuy-custom-row">
                    <span className="rebuy-custom-label">Custom</span>
                    <div className="rebuy-custom-input-group">
                      <span className="input-prefix">$</span>
                      <input type="number" className="input rebuy-custom-input" placeholder="0" min="1"
                        value={rebuyCustom} onChange={(e) => setRebuyCustom(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") confirmRebuy(gp, rebuyCustom); if (e.key === "Escape") closeRebuy(); }}
                        autoFocus />
                      <button className="btn btn-primary btn-sm" onClick={() => confirmRebuy(gp, rebuyCustom)} disabled={!rebuyCustom}>Add</button>
                    </div>
                  </div>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Add player to active game */}
      {!game.isComplete && availablePlayers.length > 0 && (
        <div className="add-to-game-section">
          {!addPlayerOpen ? (
            <button className="btn btn-ghost btn-sm" onClick={() => setAddPlayerOpen(true)}>+ Add Player to Game</button>
          ) : (
            <div className="add-to-game-form">
              <span className="field-label">Add Player</span>
              <select className="input" value={addPlayerID} onChange={(e) => setAddPlayerID(e.target.value)}>
                <option value="">Select player...</option>
                {availablePlayers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className="input-prefix">$</span>
                <input type="number" className="input" placeholder="Buy-in" value={addBuyIn} min="1"
                  onChange={(e) => setAddBuyIn(e.target.value)} style={{ width: 100 }} />
                <button className="btn btn-primary btn-sm" onClick={handleAddPlayer} disabled={saving}>Add</button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setAddPlayerOpen(false); setAddError(""); }}>Cancel</button>
              </div>
              {addError && <p className="error-msg">{addError}</p>}
            </div>
          )}
        </div>
      )}

      {!game.isComplete && (
        <div className="end-game-section">
          <div className={"pot-diff " + (Math.abs(potDiff) < 0.01 ? "balanced" : "unbalanced")}>
            {Math.abs(potDiff) < 0.01 ? "✓ Pot balanced" : ((potDiff > 0 ? "Over" : "Under") + " by " + fmt(Math.abs(potDiff)))}
          </div>
          {isOwner && (
            <>
              <label className="field-label">Notes (optional)</label>
              <textarea className="input notes-input" placeholder="Any notes about this game..."
                value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
              {endError && <p className="error-msg">{endError}</p>}
              <button className="btn btn-danger end-game-btn" onClick={handleEndGame}
                disabled={saving || Math.abs(potDiff) > 0.01}>
                {saving ? "Saving..." : "End Game"}
              </button>
            </>
          )}
        </div>
      )}

      {game.isComplete && game.notes && <div className="game-notes"><strong>Notes:</strong> {game.notes}</div>}
    </div>
  );
}

// --- Players Tab ---
function PlayersTab({ players, onRefresh, isOwner, isAdmin }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const addPlayer = async () => {
    const trimmed = sanitizeInput(name, 50);
    if (!trimmed) return setError("Enter a name.");
    if (players.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) return setError("Player already exists.");
    setSaving(true); setError("");
    try {
      await apiFetch("/api/players", { method: "POST", body: { name: trimmed } });
      setName(""); await onRefresh();
    } catch (e) { setError("Failed to add player."); console.error(e); }
    setSaving(false);
  };

  const deletePlayer = async (id, playerName) => {
    if (!window.confirm(`Remove player "${playerName}"?`)) return;
    setError("");
    try {
      await apiFetch("/api/players/" + id, { method: "DELETE" });
      await onRefresh();
    } catch (e) {
      let msg = e.message;
      try { msg = JSON.parse(e.message).error || msg; } catch {}
      setError(msg);
    }
  };

  return (
    <div className="players-tab">
      {isOwner && (
        <div className="add-player-row">
          <input type="text" className="input" placeholder="Guest player name" value={name} maxLength={50}
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addPlayer()} />
          <button className="btn btn-primary" onClick={addPlayer} disabled={saving}>{saving ? "Adding..." : "Add Player"}</button>
        </div>
      )}
      {error && <p className="error-msg">{error}</p>}
      {players.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">♦</div><p>No players yet.{isOwner ? "" : " Ask an Owner to add players."}</p></div>
      ) : (
        <div className="players-list">
          {players.map((p) => {
            const gameCount = p.games?.items?.length ?? 0;
            const completedCount = p.games?.items?.filter((g) => g.game?.isComplete).length ?? 0;
            const isLinked = !!p.userId;
            // Delete allowed: 0 games → owner/admin; unlinked guest → admin only
            const canDelete = (gameCount === 0 && isOwner) || (!isLinked && isAdmin);
            return (
              <div key={p.id} className="player-row">
                <div className="player-name-group">
                  <span className="player-name-text">{p.name}</span>
                  {!isLinked && (
                    <span className="player-type-badge guest-badge" title="Guest — not linked to an app account">Guest</span>
                  )}
                </div>
                <span className="player-game-count">{completedCount} game{completedCount !== 1 ? "s" : ""}</span>
                {canDelete && (
                  <button className="btn-icon delete-btn" title="Remove player" onClick={() => deletePlayer(p.id, p.name)}>✕</button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Rules Tab ---

const parseSteps = (raw) => {
  if (!raw) return [];
  try { const p = JSON.parse(raw); if (Array.isArray(p)) return p; } catch {}
  return [];
};

const parseHands = (raw) => {
  if (!raw) return [];
  try { const p = JSON.parse(raw); if (Array.isArray(p)) return p; } catch {}
  return raw.split(/->|›|\n/).map((s) => s.replace(/^\d+\.\s*/, "").trim()).filter(Boolean);
};

function RuleEditModal({ rule, onClose, onSaved }) {
  const isNew = !rule;
  const [form, setForm] = useState({
    gameName: rule?.gameName || "",
    overview: rule?.overview || "",
    minPlayers: rule?.minPlayers ?? "",
    cardsDealt: rule?.cardsDealt ?? "",
    bettingType: rule?.bettingType || "",
    setupInstructions: rule?.setupInstructions || "",
    howItEnds: rule?.howItEnds || "",
  });
  const [steps, setSteps] = useState(() => parseSteps(rule?.howToPlay));
  const [hands, setHands] = useState(() => parseHands(rule?.winningHierarchy));
  const [considerations, setConsiderations] = useState(() => {
    if (!rule?.keyConsiderations) return [];
    try { const p = JSON.parse(rule.keyConsiderations); return Array.isArray(p) ? p : []; } catch { return []; }
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Step helpers
  const addStep = () => setSteps((s) => [...s, { text: "", isBet: false }]);
  const removeStep = (i) => setSteps((s) => s.filter((_, idx) => idx !== i));
  const updateStep = (i, key, val) => setSteps((s) => s.map((st, idx) => idx === i ? { ...st, [key]: val } : st));
  const moveStep = (i, dir) => setSteps((s) => {
    const a = [...s]; const j = i + dir;
    if (j < 0 || j >= a.length) return a;
    [a[i], a[j]] = [a[j], a[i]]; return a;
  });

  // Consideration helpers
  const addConsideration = () => setConsiderations((c) => [...c, ""]);
  const removeConsideration = (i) => setConsiderations((c) => c.filter((_, idx) => idx !== i));
  const updateConsideration = (i, val) => setConsiderations((c) => c.map((item, idx) => idx === i ? val : item));
  const moveConsideration = (i, dir) => setConsiderations((c) => {
    const a = [...c]; const j = i + dir;
    if (j < 0 || j >= a.length) return a;
    [a[i], a[j]] = [a[j], a[i]]; return a;
  });

  // Hand helpers
  const addHand = () => setHands((h) => [...h, ""]);
  const removeHand = (i) => setHands((h) => h.filter((_, idx) => idx !== i));
  const updateHand = (i, val) => setHands((h) => h.map((hd, idx) => idx === i ? val : hd));
  const moveHand = (i, dir) => setHands((h) => {
    const a = [...h]; const j = i + dir;
    if (j < 0 || j >= a.length) return a;
    [a[i], a[j]] = [a[j], a[i]]; return a;
  });

  const save = async () => {
    if (!form.gameName.trim()) return setError("Game name is required.");
    setSaving(true); setError("");
    try {
      const body = {
        ...form,
        howToPlay: JSON.stringify(steps.filter((s) => s.text.trim())),
        winningHierarchy: JSON.stringify(hands.filter(Boolean)),
        keyConsiderations: JSON.stringify(considerations.filter((c) => c.trim())),
      };
      if (isNew) {
        await apiFetch("/api/rules", { method: "POST", body });
      } else {
        await apiFetch("/api/rules/" + rule.id, { method: "PUT", body });
      }
      onSaved();
    } catch (e) {
      let msg = e.message;
      try { msg = JSON.parse(e.message).error || msg; } catch {}
      setError(msg);
    }
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal rule-edit-modal">
        <div className="modal-header">
          <h2 className="modal-title">{isNew ? "New Game Rule" : "Edit Rule"}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body rule-modal-body">

          <label className="rule-form-label">Game Name *</label>
          <input className="input" value={form.gameName} maxLength={100}
            onChange={(e) => set("gameName", e.target.value)} placeholder="e.g. Hold'Em, Omaha" />

          <label className="rule-form-label">Overview <span className="rule-form-optional">(1–2 sentence summary shown at the top)</span></label>
          <textarea className="input rule-textarea" value={form.overview} maxLength={500}
            rows={2} onChange={(e) => set("overview", e.target.value)}
            placeholder="e.g. Community card game where each player gets 2 hole cards and shares 5 board cards to make the best 5-card hand." />

          <div className="rule-form-row">
            <div>
              <label className="rule-form-label">Min Players</label>
              <input className="input" type="number" min="1" max="20" value={form.minPlayers}
                onChange={(e) => set("minPlayers", e.target.value)} placeholder="2" />
            </div>
            <div>
              <label className="rule-form-label">Cards Dealt Per Player</label>
              <input className="input" type="number" min="1" max="20" value={form.cardsDealt}
                onChange={(e) => set("cardsDealt", e.target.value)} placeholder="e.g. 2" />
            </div>
            <div>
              <label className="rule-form-label">Betting Type</label>
              <input className="input" value={form.bettingType} maxLength={100}
                onChange={(e) => set("bettingType", e.target.value)} placeholder="e.g. Bomb Pot, NLH" />
            </div>
          </div>

          <label className="rule-form-label">Setup Instructions <span className="rule-form-optional">(initial deal &amp; antes)</span></label>
          <textarea className="input rule-textarea" value={form.setupInstructions} maxLength={2000}
            rows={3} onChange={(e) => set("setupInstructions", e.target.value)}
            placeholder="e.g. Dealer pays ante, deals 2 cards clockwise..." />

          <label className="rule-form-label">Key Considerations <span className="rule-form-optional">(important things to remember while playing)</span></label>
          <div className="step-builder">
            {considerations.map((item, i) => (
              <div key={i} className="step-builder-row consideration-row">
                <span className="consideration-marker">!</span>
                <input className="input step-text-input" value={item} maxLength={300}
                  onChange={(e) => updateConsideration(i, e.target.value)}
                  placeholder="e.g. Dealer must announce the pot before betting begins…" />
                <button type="button" className="step-move-btn" onClick={() => moveConsideration(i, -1)} disabled={i === 0}>↑</button>
                <button type="button" className="step-move-btn" onClick={() => moveConsideration(i, 1)} disabled={i === considerations.length - 1}>↓</button>
                <button type="button" className="step-del-btn" onClick={() => removeConsideration(i)}>✕</button>
              </div>
            ))}
            <button type="button" className="btn btn-ghost step-add-btn" onClick={addConsideration}>+ Add Consideration</button>
          </div>

          <label className="rule-form-label">
            How to Play
            <span className="rule-form-optional"> — add each step; toggle BET for betting rounds</span>
          </label>
          <div className="step-builder">
            {steps.map((step, i) => (
              <div key={i} className={"step-builder-row" + (step.isBet ? " is-bet" : "")}>
                <span className="step-num-label">{i + 1}</span>
                <input className="input step-text-input" value={step.text} maxLength={200}
                  onChange={(e) => updateStep(i, "text", e.target.value)}
                  placeholder={step.isBet ? "Betting round…" : "Step description…"} />
                <button type="button"
                  className={"step-bet-toggle" + (step.isBet ? " active" : "")}
                  onClick={() => updateStep(i, "isBet", !step.isBet)}
                  title="Mark as betting round">BET</button>
                <button type="button" className="step-move-btn" onClick={() => moveStep(i, -1)} disabled={i === 0}>↑</button>
                <button type="button" className="step-move-btn" onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1}>↓</button>
                <button type="button" className="step-del-btn" onClick={() => removeStep(i)}>✕</button>
              </div>
            ))}
            <button type="button" className="btn btn-ghost step-add-btn" onClick={addStep}>+ Add Step</button>
          </div>

          <label className="rule-form-label">Winning Hierarchy <span className="rule-form-optional">(best → worst, optional)</span></label>
          <div className="hand-editor">
            {hands.map((hand, i) => (
              <div key={i} className="hand-editor-row">
                <span className="hand-rank-num">{i + 1}</span>
                <input className="input hand-name-input" value={hand} maxLength={60}
                  onChange={(e) => updateHand(i, e.target.value)} placeholder="e.g. Royal Flush" />
                <button type="button" className="step-move-btn" onClick={() => moveHand(i, -1)} disabled={i === 0}>↑</button>
                <button type="button" className="step-move-btn" onClick={() => moveHand(i, 1)} disabled={i === hands.length - 1}>↓</button>
                <button type="button" className="step-del-btn" onClick={() => removeHand(i)}>✕</button>
              </div>
            ))}
            <button type="button" className="btn btn-ghost step-add-btn" onClick={addHand}>+ Add Hand</button>
          </div>

          <label className="rule-form-label">How It Ends</label>
          <textarea className="input rule-textarea" value={form.howItEnds} maxLength={2000}
            rows={2} onChange={(e) => set("howItEnds", e.target.value)}
            placeholder="e.g. Last player with chips wins…" />

          {error && <p className="error-msg">{error}</p>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving..." : isNew ? "Create Rule" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RuleDetail({ rule, isOwner, isAdmin, onBack, onEdit, onRefresh }) {
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [commentError, setCommentError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [expandedVersions, setExpandedVersions] = useState(new Set());

  const formatTs = (ts) => {
    if (!ts) return "—";
    return new Date(ts).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  };

  const toggleVersion = (id) =>
    setExpandedVersions((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const submitComment = async () => {
    const body = sanitizeInput(comment, 1000);
    if (!body) return setCommentError("Comment cannot be empty.");
    setSubmitting(true); setCommentError("");
    try {
      await apiFetch("/api/rules/" + rule.id + "/comments", { method: "POST", body: { body } });
      setComment(""); await onRefresh();
    } catch (e) {
      let msg = e.message;
      try { msg = JSON.parse(e.message).error || msg; } catch {}
      setCommentError(msg);
    }
    setSubmitting(false);
  };

  const deleteComment = async (commentId) => {
    if (!window.confirm("Delete this comment?")) return;
    setDeleteError("");
    try {
      await apiFetch("/api/rules/" + rule.id + "/comments/" + commentId, { method: "DELETE" });
      await onRefresh();
    } catch (e) {
      let msg = e.message;
      try { msg = JSON.parse(e.message).error || msg; } catch {}
      setDeleteError(msg);
    }
  };

  return (
    <div className="rule-detail">
      <div className="rule-detail-header">
        <button className="back-btn" onClick={onBack}>← Rules</button>
        <h2 className="rule-detail-title">{rule.gameName}</h2>
        <button className="btn btn-secondary" onClick={() => onEdit(rule)}>Edit</button>
      </div>

      <div className="rule-meta-strip">
        {rule.minPlayers && (
          <span className="rule-meta-chip"><span className="rule-meta-label">Min Players</span>{rule.minPlayers}</span>
        )}
        {rule.cardsDealt && (
          <span className="rule-meta-chip"><span className="rule-meta-label">Cards Dealt</span>{rule.cardsDealt}</span>
        )}
        {rule.bettingType && (
          <span className="rule-meta-chip"><span className="rule-meta-label">Betting</span>{rule.bettingType}</span>
        )}
        <span className="rule-meta-chip">
          <span className="rule-meta-label">Updated</span>{formatTs(rule.lastUpdated || rule.createdAt)}
        </span>
      </div>

      {rule.overview && (
        <div className="rule-overview">{rule.overview}</div>
      )}

      {(() => {
        if (!rule.keyConsiderations) return null;
        let items = [];
        try { items = JSON.parse(rule.keyConsiderations); } catch { return null; }
        if (!Array.isArray(items) || !items.length) return null;
        return (
          <section className="rule-section rule-considerations-section">
            <h3 className="rule-section-title">Key Considerations</h3>
            <div className="considerations-list">
              {items.map((item, i) => (
                <div key={i} className="consideration-card">
                  <span className="consideration-icon">!</span>
                  <span className="consideration-text">{item}</span>
                </div>
              ))}
            </div>
          </section>
        );
      })()}

      {rule.setupInstructions && (
        <section className="rule-section">
          <h3 className="rule-section-title">Setup Instructions</h3>
          <p className="rule-section-body">{rule.setupInstructions}</p>
        </section>
      )}

      {(() => {
        const steps = parseSteps(rule.howToPlay);
        if (!steps.length) return null;
        return (
          <section className="rule-section">
            <h3 className="rule-section-title">How to Play</h3>
            <div className="htp-steps">
              {steps.map((step, i) => (
                <div key={i} className={"htp-step" + (step.isBet ? " htp-bet" : "")}>
                  <span className="htp-num">{i + 1}</span>
                  <span className="htp-text">{step.text}</span>
                  {step.isBet && <span className="htp-badge">BET</span>}
                </div>
              ))}
            </div>
          </section>
        );
      })()}

      {(() => {
        const hands = parseHands(rule.winningHierarchy);
        if (!hands.length) return null;
        const half = Math.ceil(hands.length / 2);
        return (
          <section className="rule-section">
            <h3 className="rule-section-title">Winning Hierarchy</h3>
            <div className="hierarchy-cols">
              <div className="hierarchy-col">
                {hands.slice(0, half).map((h, i) => (
                  <div key={i} className="hierarchy-hand">
                    <span className="hand-rank-badge">{i + 1}</span>
                    <span className="hand-name">{h}</span>
                  </div>
                ))}
              </div>
              <div className="hierarchy-col">
                {hands.slice(half).map((h, i) => (
                  <div key={i} className="hierarchy-hand">
                    <span className="hand-rank-badge">{half + i + 1}</span>
                    <span className="hand-name">{h}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        );
      })()}

      {rule.howItEnds && (
        <section className="rule-section">
          <h3 className="rule-section-title">How It Ends</h3>
          <p className="rule-section-body">{rule.howItEnds}</p>
        </section>
      )}

      <section className="rule-section">
        <h3 className="rule-section-title">
          Version History
          <span className="rule-version-count">{rule.versions?.length ?? 0} version{rule.versions?.length !== 1 ? "s" : ""}</span>
        </h3>
        {!rule.versions?.length ? (
          <p className="rule-section-body muted">No version history yet.</p>
        ) : (
          <div className="version-list">
            {rule.versions.map((v) => {
              const expanded = expandedVersions.has(v.id);
              return (
                <div key={v.id} className={"version-item" + (expanded ? " expanded" : "")}>
                  <button className="version-toggle" onClick={() => toggleVersion(v.id)}>
                    <span className="version-badge">v{v.version}</span>
                    <span className="version-meta">{v.editedByUsername} · {formatTs(v.editedAt)}</span>
                    <span className="version-chevron">{expanded ? "▲" : "▼"}</span>
                  </button>
                  {expanded && (
                    <div className="version-snapshot">
                      {v.gameName && <div className="snap-row"><span className="snap-label">Game</span><span>{v.gameName}</span></div>}
                      {v.minPlayers != null && <div className="snap-row"><span className="snap-label">Min Players</span><span>{v.minPlayers}</span></div>}
                      {v.bettingType && <div className="snap-row"><span className="snap-label">Betting Type</span><span>{v.bettingType}</span></div>}
                      {v.setupInstructions && <div className="snap-row"><span className="snap-label">Setup</span><span>{v.setupInstructions}</span></div>}
                      {v.winningHierarchy && <div className="snap-row"><span className="snap-label">Hierarchy</span><span>{v.winningHierarchy}</span></div>}
                      {v.howItEnds && <div className="snap-row"><span className="snap-label">How It Ends</span><span>{v.howItEnds}</span></div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rule-section">
        <h3 className="rule-section-title">Discussion</h3>
        {deleteError && <p className="error-msg">{deleteError}</p>}
        {!rule.comments?.length ? (
          <p className="rule-section-body muted">No comments yet. Be the first to start a discussion.</p>
        ) : (
          <div className="rule-comments-list">
            {rule.comments.map((c) => (
              <div key={c.id} className="rule-comment">
                <div className="rule-comment-header">
                  <Avatar src={null} name={c.username} size={28} />
                  <span className="rule-comment-username">{c.username}</span>
                  <span className="rule-comment-ts">{formatTs(c.createdAt)}</span>
                  {isAdmin && (
                    <button className="btn-icon delete-btn" title="Delete comment" onClick={() => deleteComment(c.id)}>✕</button>
                  )}
                </div>
                <p className="rule-comment-body">{c.body}</p>
              </div>
            ))}
          </div>
        )}
        <div className="rule-comment-input-row">
          <textarea className="input rule-comment-input" rows={2} value={comment} maxLength={1000}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) submitComment(); }}
            placeholder="Add a comment or suggestion… (Ctrl+Enter to post)" />
          <button className="btn btn-primary" onClick={submitComment} disabled={submitting}>
            {submitting ? "…" : "Post"}
          </button>
        </div>
        {commentError && <p className="error-msg">{commentError}</p>}
      </section>
    </div>
  );
}

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
          <button className="modal-close" onClick={onClose}>✕</button>
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

function RulesTab({ isOwner, isAdmin }) {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [showEdit, setShowEdit] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [duplicateTarget, setDuplicateTarget] = useState(null);

  const fetchRules = useCallback(async () => {
    setLoading(true); setError("");
    try { setRules(await apiFetch("/api/rules")); }
    catch { setError("Failed to load rules."); }
    setLoading(false);
  }, []);

  const fetchSelected = useCallback(async (id) => {
    try { setSelected(await apiFetch("/api/rules/" + id)); }
    catch { setError("Failed to load rule."); }
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const handleSaved = async () => {
    setShowEdit(false);
    if (selected) await fetchSelected(selected.id);
    else await fetchRules();
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this game rule and all its history? This cannot be undone.")) return;
    try { await apiFetch("/api/rules/" + id, { method: "DELETE" }); await fetchRules(); }
    catch (e) {
      let msg = e.message;
      try { msg = JSON.parse(e.message).error || msg; } catch {}
      setError(msg);
    }
  };

  const formatDate = (ts) => ts
    ? new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—";

  if (loading) return <div className="loading"><p>Loading rules…</p></div>;

  if (selected) {
    return (
      <>
        <RuleDetail
          rule={selected}
          isOwner={isOwner}
          isAdmin={isAdmin}
          onBack={() => { setSelected(null); fetchRules(); }}
          onEdit={(r) => { setEditTarget(r); setShowEdit(true); }}
          onRefresh={() => fetchSelected(selected.id)}
        />
        {showEdit && (
          <RuleEditModal rule={editTarget} onClose={() => setShowEdit(false)} onSaved={handleSaved} />
        )}
      </>
    );
  }

  return (
    <div className="rules-tab">
      <div className="rules-tab-header">
        <div>
          <h2 className="rules-tab-title">Game Rules</h2>
          <p className="rules-tab-subtitle">Reference rules for the games we play</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setEditTarget(null); setShowEdit(true); }}>+ New Rule</button>
      </div>
      {error && <p className="error-msg">{error}</p>}
      {rules.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">♠</div>
          <p>No game rules yet. Click "+ New Rule" to add the first one.</p>
        </div>
      ) : (
        <div className="rules-grid">
          {rules.map((r) => (
            <div key={r.id} className="rule-card" onClick={() => fetchSelected(r.id)}>
              <div className="rule-card-top">
                <h3 className="rule-card-name">{r.gameName}</h3>
                <div className="rule-card-actions">
                  <button className="btn-icon dupe-btn" title="Duplicate rule"
                    onClick={(e) => { e.stopPropagation(); setDuplicateTarget(r); }}>⧉</button>
                  {isAdmin && (
                    <button className="btn-icon delete-btn" title="Delete rule"
                      onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}>✕</button>
                  )}
                </div>
              </div>
              <div className="rule-card-chips">
                {r.minPlayers && <span className="rule-chip"><span className="rule-chip-label">Min</span>{r.minPlayers}p</span>}
                {r.cardsDealt && <span className="rule-chip"><span className="rule-chip-label">Cards</span>{r.cardsDealt}</span>}
                {r.bettingType && <span className="rule-chip"><span className="rule-chip-label">Bet</span>{r.bettingType}</span>}
              </div>
              {(r.overview || r.setupInstructions) && (
                <p className="rule-card-preview">
                  {(r.overview || r.setupInstructions).slice(0, 130)}
                  {(r.overview || r.setupInstructions).length > 130 ? "…" : ""}
                </p>
              )}
              <div className="rule-card-footer">
                <span className="rule-card-updated">Updated {formatDate(r.lastUpdated || r.createdAt)}</span>
                <span className="rule-card-cta">View →</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {showEdit && (
        <RuleEditModal rule={editTarget} onClose={() => setShowEdit(false)} onSaved={handleSaved} />
      )}
      {duplicateTarget && (
        <DuplicateRuleModal
          rule={duplicateTarget}
          existingNames={rules.map((r) => r.gameName)}
          onClose={() => setDuplicateTarget(null)}
          onDuplicated={async () => { setDuplicateTarget(null); await fetchRules(); }}
        />
      )}
    </div>
  );
}

// --- Admin Panel ---
function AdminPanel() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resetTarget, setResetTarget] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetSaving, setResetSaving] = useState(false);
  const [xpConfig, setXpConfig] = useState([]);
  const [xpEdits, setXpEdits] = useState({});
  const [xpSaving, setXpSaving] = useState(false);
  const [xpSaveMsg, setXpSaveMsg] = useState("");
  const [adminAchs, setAdminAchs] = useState([]);
  const [achEditTarget, setAchEditTarget] = useState(null);

  const fetchUsers = useCallback(async () => {
    try {
      const data = await apiFetch("/api/users");
      setUsers(data.users);
    } catch { setError("Failed to load users."); }
    setLoading(false);
  }, []);

  const fetchXpConfig = useCallback(async () => {
    try {
      const data = await apiFetch("/api/admin/xp-config");
      setXpConfig(data);
      const initial = {};
      data.forEach((r) => { initial[r.key] = String(r.value); });
      setXpEdits(initial);
    } catch {}
  }, []);

  const fetchAdminAchs = useCallback(async () => {
    try {
      const data = await apiFetch("/api/achievements");
      setAdminAchs(data);
    } catch (_e) {}
  }, []);

  useEffect(() => { fetchUsers(); fetchXpConfig(); fetchAdminAchs(); }, [fetchUsers, fetchXpConfig, fetchAdminAchs]);

  const saveXpConfig = async () => {
    setXpSaving(true); setXpSaveMsg("");
    const body = {};
    for (const [key, val] of Object.entries(xpEdits)) body[key] = parseInt(val, 10);
    try {
      const updated = await apiFetch("/api/admin/xp-config", { method: "PATCH", body });
      setXpConfig(updated);
      setXpSaveMsg("Saved!");
      setTimeout(() => setXpSaveMsg(""), 2000);
    } catch { setXpSaveMsg("Save failed."); }
    setXpSaving(false);
  };

  const deleteUser = async (id, username) => {
    if (!window.confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    try {
      await apiFetch(`/api/users/${id}`, { method: "DELETE" });
      setUsers((prev) => prev.filter((u) => u.id !== id));
    } catch (e) {
      let msg = e.message;
      try { msg = JSON.parse(e.message).error || msg; } catch {}
      alert(msg);
    }
  };

  const changeRole = async (id, newRole) => {
    try {
      const updated = await apiFetch(`/api/users/${id}`, { method: "PATCH", body: { role: newRole } });
      setUsers((prev) => prev.map((u) => u.id === id ? { ...u, role: updated.role } : u));
    } catch (e) {
      let msg = e.message;
      try { msg = JSON.parse(e.message).error || msg; } catch {}
      alert(msg);
    }
  };

  const openReset = (user) => { setResetTarget(user); setNewPassword(""); setResetError(""); };

  const submitReset = async () => {
    if (newPassword.length < 6) return setResetError("Password must be at least 6 characters.");
    setResetSaving(true); setResetError("");
    try {
      await apiFetch(`/api/users/${resetTarget.id}`, { method: "PATCH", body: { password: newPassword } });
      setResetTarget(null);
    } catch (e) {
      let msg = e.message;
      try { msg = JSON.parse(e.message).error || msg; } catch {}
      setResetError(msg);
    }
    setResetSaving(false);
  };

  if (loading) return <div className="loading"><p>Loading users...</p></div>;
  if (error) return <div className="error-banner"><p>{error}</p><button className="btn btn-ghost" onClick={fetchUsers}>Retry</button></div>;

  return (
    <div className="admin-panel">
      <h2 className="admin-title">User Management</h2>
      <div className="admin-users-list">
        {users.map((u) => (
          <div key={u.id} className="admin-user-row">
            <div className="admin-user-info">
              <Avatar src={u.avatarPath} name={u.username} size={36} />
              <div className="admin-user-details">
                <div className="admin-user-name-row">
                  <span className="admin-username">{u.username}</span>
                  {(u.firstName || u.lastName) && (
                    <span className="admin-fullname">{[u.firstName, u.lastName].filter(Boolean).join(" ")}</span>
                  )}
                  <span className={"role-badge " + ROLE_CLASS[u.role ?? "user"]}>
                    {ROLE_LABEL[u.role ?? "user"]}
                  </span>
                </div>
                {u.email && <span className="admin-email">{u.email}</span>}
                <span className="admin-joined">since {new Date(u.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
            <div className="admin-user-actions">
              {/* Role buttons — show the two roles they're NOT currently */}
              {["admin", "owner", "user"].filter((r) => r !== (u.role ?? "user")).map((r) => (
                <button key={r} className="btn btn-ghost btn-sm" onClick={() => changeRole(u.id, r)}>
                  → {ROLE_LABEL[r]}
                </button>
              ))}
              <button className="btn btn-ghost btn-sm" onClick={() => openReset(u)}>Reset PW</button>
              <button className="btn btn-danger btn-sm" onClick={() => deleteUser(u.id, u.username)}>Delete</button>
            </div>
          </div>
        ))}
      </div>

      {xpConfig.length > 0 && (
        <div className="xp-settings-section">
          <h3 className="admin-title" style={{ marginTop: 32 }}>XP Settings</h3>
          <div className="xp-settings-list">
            {xpConfig.map((row) => (
              <div key={row.key} className="xp-settings-row">
                <span className="xp-settings-label">{row.label}</span>
                <input
                  type="number"
                  className="input xp-settings-input"
                  value={xpEdits[row.key] ?? String(row.value)}
                  onChange={(e) => setXpEdits((prev) => ({ ...prev, [row.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
            <button className="btn btn-primary btn-sm" onClick={saveXpConfig} disabled={xpSaving}>
              {xpSaving ? "Saving…" : "Save XP Config"}
            </button>
            {xpSaveMsg && <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{xpSaveMsg}</span>}
          </div>
        </div>
      )}

      {adminAchs.length > 0 && (
        <div className="admin-ach-section">
          <h3 className="admin-title" style={{ marginTop: 32 }}>Achievements</h3>
          <div className="admin-ach-scroll">
            <table className="admin-ach-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th>XP</th>
                  <th>Criteria</th>
                  <th>Users</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {adminAchs.map((a) => {
                  let criteriaLabel = "None";
                  if (a.criteriaJson) {
                    try {
                      const c = JSON.parse(a.criteriaJson);
                      if (c.scope === "streak") criteriaLabel = `${c.streakLength}-game streak`;
                      else if (c.conditions?.length) criteriaLabel = `${c.conditions.length} condition${c.conditions.length !== 1 ? "s" : ""}`;
                      else criteriaLabel = a.criteria || "None";
                    } catch (_e) { criteriaLabel = a.criteria || "None"; }
                  } else if (a.criteria) {
                    criteriaLabel = a.criteria;
                  }
                  return (
                    <tr key={a.id}>
                      <td className="admin-ach-name" title={a.name}>{a.name}</td>
                      <td className="admin-ach-desc" title={a.description}>
                        {a.description.length > 60 ? a.description.slice(0, 58) + "…" : a.description}
                      </td>
                      <td className="admin-ach-xp">{a.xpValue > 0 ? `${a.xpValue} XP` : "—"}</td>
                      <td className="admin-ach-criteria">{criteriaLabel}</td>
                      <td className="admin-ach-users">{a.earnerCount ?? 0} / {users.length}</td>
                      <td className="admin-ach-edit-cell">
                        <button
                          className="btn btn-ghost btn-sm admin-ach-edit-btn"
                          title="Edit achievement"
                          onClick={() => setAchEditTarget(a)}
                        >✎</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {achEditTarget && (
        <EditAchievementModal
          achievement={achEditTarget}
          onClose={() => setAchEditTarget(null)}
          onSaved={() => { setAchEditTarget(null); fetchAdminAchs(); }}
        />
      )}

      {resetTarget && (
        <div className="modal-overlay" onClick={() => setResetTarget(null)}>
          <div className="modal" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Reset Password</h2>
              <button className="close-btn" onClick={() => setResetTarget(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: 14, color: "var(--text-muted)" }}>
                New password for <strong style={{ color: "var(--text)" }}>{resetTarget.username}</strong>
              </p>
              <label className="field-label">New Password</label>
              <input type="password" className="input" placeholder="Min. 6 characters"
                value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitReset()} autoFocus />
              {resetError && <p className="error-msg">{resetError}</p>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setResetTarget(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={submitReset} disabled={resetSaving}>
                {resetSaving ? "Saving..." : "Update Password"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Ask Claude Tab ---
const CARD_RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const CARD_SUITS = [
  { value: '♠', label: '♠ Spades' },
  { value: '♥', label: '♥ Hearts' },
  { value: '♦', label: '♦ Diamonds' },
  { value: '♣', label: '♣ Clubs' },
];
const RED_SUITS = new Set(['♥', '♦']);

function PlayingCard({ rank, suit, size = "md", faceDown = false, selected = false }) {
  const isRed = RED_SUITS.has(suit);
  const sizeClass = size === "sm" ? " playing-card-sm" : size === "lg" ? " playing-card-lg" : "";
  const suitSymbol = { "♠": "♠", "♥": "♥", "♦": "♦", "♣": "♣" }[suit] || "";
  if (faceDown) {
    return <div className={"playing-card playing-card-back" + sizeClass} />;
  }
  if (!rank || !suit) {
    return <div className={"playing-card playing-card-empty" + sizeClass} />;
  }
  return (
    <div className={"playing-card" + (isRed ? " card-red" : " card-black") + sizeClass + (selected ? " card-selected" : "")}>
      <div className="card-corner card-corner-tl">
        <span className="card-rank">{rank}</span>
        <span className="card-suit-corner">{suitSymbol}</span>
      </div>
      <div className="card-center-suit">{suitSymbol}</div>
      <div className="card-corner card-corner-br">
        <span className="card-rank">{rank}</span>
        <span className="card-suit-corner">{suitSymbol}</span>
      </div>
    </div>
  );
}

function CardPicker({ card, label, onChange, duplicate }) {
  return (
    <div className={"card-picker" + (duplicate ? " card-picker-dup" : "")}>
      <div className="card-picker-label">{label}</div>
      <PlayingCard rank={card.rank} suit={card.suit} size="md" />
      <div className="card-picker-selects">
        <select
          className="card-select"
          value={card.rank}
          onChange={(e) => onChange("rank", e.target.value)}
        >
          <option value="">Rank</option>
          {CARD_RANKS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select
          className="card-select"
          value={card.suit}
          onChange={(e) => onChange("suit", e.target.value)}
        >
          <option value="">Suit</option>
          {CARD_SUITS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      {duplicate && <div className="card-dup-warn">Duplicate!</div>}
    </div>
  );
}

function ColoredOuts({ text }) {
  if (!text || text.toLowerCase() === 'none' || text === '—') return <span>{text || '—'}</span>;
  const tokens = text.split(/\s+/);
  return (
    <>
      {tokens.map((token, i) => (
        <span key={i} style={{ color: /[♥♦]/.test(token) ? 'var(--loss)' : 'var(--text)', marginRight: i < tokens.length - 1 ? 5 : 0 }}>
          {token}
        </span>
      ))}
    </>
  );
}

function AskClaudeTab() {
  const [rules, setRules] = useState([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [selectedGameId, setSelectedGameId] = useState("");
  const [playerCount, setPlayerCount] = useState(4);
  const [street, setStreet] = useState("preflop");
  const [holeCards, setHoleCards] = useState([
    { rank: "", suit: "" },
    { rank: "", suit: "" },
  ]);
  const [boardCards, setBoardCards] = useState([
    { rank: "", suit: "" },
    { rank: "", suit: "" },
    { rank: "", suit: "" },
    { rank: "", suit: "" },
    { rank: "", suit: "" },
  ]);
  const [rawText, setRawText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const resultRef = useRef(null);

  useEffect(() => {
    apiFetch("/api/rules")
      .then((r) => { setRules(r); setRulesLoading(false); })
      .catch(() => setRulesLoading(false));
  }, []);

  useEffect(() => {
    if (resultRef.current) resultRef.current.scrollTop = resultRef.current.scrollHeight;
  }, [rawText]);

  const parseAnalysis = (text) => {
    const sep = text.indexOf('\n---\n');
    if (sep === -1) return null;
    const header = text.slice(0, sep);
    const fullAnalysis = text.slice(sep + 5).trim();
    const getVal = (key) => {
      const m = header.match(new RegExp(`^${key}:\\s*(.+)`, 'm'));
      return m ? m[1].trim() : '';
    };
    return {
      probability: getVal('PROBABILITY'),
      outs: getVal('OUTS'),
      recommendation: getVal('RECOMMENDATION'),
      bottomLine: getVal('BOTTOM LINE'),
      fullAnalysis,
    };
  };

  const parsed = parseAnalysis(rawText);

  const recColor = (rec) => {
    const r = (rec || '').toLowerCase();
    if (r === 'fold') return 'rec-fold';
    if (r === 'bet' || r === 'raise') return 'rec-bet';
    return 'rec-check';
  };

  const boardCount = { preflop: 0, flop: 3, turn: 4, river: 5 }[street] || 0;
  const selectedGame = rules.find((r) => r.id === selectedGameId);
  const holeCardCount = selectedGame?.cardsDealt || 2;

  useEffect(() => {
    setHoleCards((prev) => {
      if (prev.length === holeCardCount) return prev;
      if (prev.length < holeCardCount)
        return [...prev, ...Array(holeCardCount - prev.length).fill(null).map(() => ({ rank: "", suit: "" }))];
      return prev.slice(0, holeCardCount);
    });
  }, [holeCardCount]);

  const isDuplicate = (card, idx, src) => {
    if (!card.rank || !card.suit) return false;
    const key = card.rank + card.suit;
    const all = [
      ...holeCards.map((c, i) => ({ ...c, src: "hole", i })),
      ...boardCards.slice(0, boardCount).map((c, i) => ({ ...c, src: "board", i })),
    ];
    return all.filter((c) => c.rank + c.suit === key && !(c.src === src && c.i === idx)).length > 0;
  };

  const updateHole = (idx, field, val) =>
    setHoleCards((prev) => prev.map((c, i) => i === idx ? { ...c, [field]: val } : c));
  const updateBoard = (idx, field, val) =>
    setBoardCards((prev) => prev.map((c, i) => i === idx ? { ...c, [field]: val } : c));

  const allCards = [
    ...holeCards.filter((c) => c.rank && c.suit),
    ...boardCards.slice(0, boardCount).filter((c) => c.rank && c.suit),
  ];
  const hasDuplicates = allCards.length !== new Set(allCards.map((c) => c.rank + c.suit)).size;

  const boardReady = boardCount === 0 ||
    boardCards.slice(0, boardCount).every((c) => c.rank && c.suit);

  const canSubmit = !analyzing
    && selectedGameId
    && parseInt(playerCount) >= 2 && parseInt(playerCount) <= 10
    && holeCards.every((c) => c.rank && c.suit)
    && boardReady
    && !hasDuplicates;

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setError("");
    setRawText("");
    try {
      const response = await fetch("/api/ask-claude", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          gameName: selectedGame?.gameName,
          gameRules: [selectedGame?.overview, selectedGame?.howToPlay, selectedGame?.winningHierarchy]
            .filter(Boolean).join("\n\n"),
          playerCount: parseInt(playerCount),
          holeCards,
          boardCards: boardCards.slice(0, boardCount),
          street,
        }),
      });

      if (!response.ok) {
        const txt = await response.text();
        let msg;
        try { msg = JSON.parse(txt).error; } catch { msg = txt; }
        throw new Error(msg || "Request failed");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.text) setRawText((prev) => prev + parsed.text);
          } catch (e) {
            if (e.message && e.message !== "Unexpected end of JSON input") throw e;
          }
        }
      }
    } catch (e) {
      setError(e.message || "Analysis failed. Please try again.");
    }
    setAnalyzing(false);
  };

  return (
    <div className="ask-claude-tab">
      <h2 className="section-title">Ask Claude</h2>
      <p className="ask-claude-subtitle">AI-powered poker hand analysis. Select your game and cards to get strategic advice.</p>

      <div className="ask-claude-form">
        <div className="form-row-two">
          <div className="form-group">
            <label className="field-label">Game</label>
            {rulesLoading ? (
              <span className="text-muted">Loading...</span>
            ) : (
              <select className="input" value={selectedGameId} onChange={(e) => setSelectedGameId(e.target.value)}>
                <option value="">Select a game...</option>
                {rules.map((r) => <option key={r.id} value={r.id}>{r.gameName}</option>)}
              </select>
            )}
          </div>
          <div className="form-group">
            <label className="field-label">Players Dealt In</label>
            <input
              type="number" className="input"
              min={2} max={10} value={playerCount}
              onChange={(e) => setPlayerCount(e.target.value)}
              onBlur={() => setPlayerCount(Math.min(10, Math.max(2, parseInt(playerCount) || 2)))}
              style={{ width: 80 }}
            />
          </div>
        </div>

        <div className="form-group">
          <label className="field-label">Street</label>
          <div className="street-btns">
            {[
              { id: "preflop", label: "Pre-flop" },
              { id: "flop",    label: "Flop" },
              { id: "turn",    label: "Turn" },
              { id: "river",   label: "River" },
            ].map((s) => (
              <button
                key={s.id}
                className={"street-btn" + (street === s.id ? " active" : "")}
                onClick={() => setStreet(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label className="field-label">Your Hole Cards <span className="rule-form-optional">({holeCardCount} cards)</span></label>
          <div className="cards-row">
            {holeCards.map((card, i) => (
              <CardPicker
                key={i} card={card} label={`Card ${i + 1}`}
                onChange={(f, v) => updateHole(i, f, v)}
                duplicate={isDuplicate(card, i, "hole")}
              />
            ))}
          </div>
        </div>

        {boardCount > 0 && (
          <div className="form-group">
            <label className="field-label">
              Board Cards — {street === "flop" ? "Flop" : street === "turn" ? "Flop + Turn" : "Flop + Turn + River"}
            </label>
            <div className="cards-row">
              {boardCards.slice(0, boardCount).map((card, i) => (
                <CardPicker
                  key={i} card={card}
                  label={i < 3 ? `Flop ${i + 1}` : i === 3 ? "Turn" : "River"}
                  onChange={(f, v) => updateBoard(i, f, v)}
                  duplicate={isDuplicate(card, i, "board")}
                />
              ))}
            </div>
          </div>
        )}

        {hasDuplicates && <p className="error-msg">Duplicate cards detected — each card can only appear once.</p>}
        {error && <p className="error-msg">{error}</p>}

        <button
          className="btn btn-primary"
          onClick={handleAnalyze}
          disabled={!canSubmit}
          style={{ marginTop: 8 }}
        >
          {analyzing ? "Analyzing..." : "Analyze Hand"}
        </button>
      </div>

      {(rawText || analyzing) && (
        <div className="ask-claude-result" ref={resultRef}>
          {analyzing && !rawText && (
            <p className="text-muted" style={{ fontStyle: "italic", padding: "12px 0" }}>Claude is thinking...</p>
          )}

          {parsed ? (
            <>
              <div className="analysis-stats">
                <div className="stat-card">
                  <div className="stat-label">Win Probability</div>
                  <div className="stat-value">{parsed.probability || "—"}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Outs</div>
                  <div className="stat-value stat-outs"><ColoredOuts text={parsed.outs} /></div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Recommendation</div>
                  <div className={"stat-value " + recColor(parsed.recommendation)}>{parsed.recommendation || "—"}</div>
                </div>
              </div>

              {parsed.bottomLine && (
                <div className="analysis-bottom-line">
                  <span className="bottom-line-label">Bottom Line</span>
                  <span className="bottom-line-text">{parsed.bottomLine}</span>
                </div>
              )}

              {(parsed.fullAnalysis || analyzing) && (
                <div className="analysis-full">
                  <div className="analysis-full-label">Full Analysis</div>
                  <pre className="result-text">{parsed.fullAnalysis}{analyzing ? "▍" : ""}</pre>
                </div>
              )}
            </>
          ) : rawText ? (
            <pre className="result-text">{rawText}</pre>
          ) : null}
        </div>
      )}
    </div>
  );
}

// Parse imageFrame JSON safely. New format: { x, y, scale } where x/y are
// fractional offsets from center (-1..1). Legacy posX/posY (0-100%) converted.
function parseFrame(raw) {
  const def = { x: 0, y: 0, scale: 1 };
  if (!raw) return def;
  try {
    const p = JSON.parse(raw);
    if ('posX' in p || 'posY' in p) {
      // Migrate old slider format
      return { x: ((p.posX ?? 50) - 50) / 100, y: ((p.posY ?? 50) - 50) / 100, scale: p.scale ?? 1 };
    }
    return { ...def, ...p };
  } catch { return def; }
}

// --- Achievement image renderer (handles SVG markup and URL images with frame) ---
function AchievementImage({ src, imageFrame, className = "" }) {
  if (!src) return null;
  const isSvg = src.trimStart().startsWith('<svg') || src.trimStart().startsWith('<SVG');
  if (isSvg) {
    return <div className={"joker-svg-art " + className} dangerouslySetInnerHTML={{ __html: src }} />;
  }
  const f = parseFrame(imageFrame);
  return (
    <div className={"joker-img-wrap " + className}>
      <img
        src={src}
        alt="achievement art"
        draggable={false}
        style={{
          position: "absolute",
          top: `calc(50% + ${f.y * 100}%)`,
          left: `calc(50% + ${f.x * 100}%)`,
          transform: `translate(-50%, -50%) scale(${f.scale})`,
          width: "auto",
          height: "auto",
          minWidth: "100%",
          minHeight: "100%",
          maxWidth: "none",
          objectFit: "none",
          userSelect: "none",
        }}
      />
    </div>
  );
}

// --- Interactive image framer (drag to pan, pinch/scroll to zoom) ---
function ImageFramer({ src, frame, onChange }) {
  const ref = useRef(null);
  // Keep latest frame + onChange in refs so event listeners don't go stale
  const frameRef = useRef(frame);
  const onChangeRef = useRef(onChange);
  useEffect(() => { frameRef.current = frame; }, [frame]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const gestureRef = useRef(null);

  const pinchDist = (touches) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };
  const pinchMid = (touches) => ({
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  });
  const containerSize = () => ref.current
    ? { w: ref.current.offsetWidth, h: ref.current.offsetHeight }
    : { w: 240, h: 240 };

  // ── Mouse drag ───────────────────────────────────────────────────────────
  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    const f = frameRef.current;
    gestureRef.current = { type: "drag", sx: e.clientX, sy: e.clientY, fx: f.x, fy: f.y };

    const onMove = (me) => {
      const g = gestureRef.current;
      if (!g) return;
      const { w, h } = containerSize();
      onChangeRef.current({
        ...frameRef.current,
        x: g.fx + (me.clientX - g.sx) / w,
        y: g.fy + (me.clientY - g.sy) / h,
      });
    };
    const onUp = () => {
      gestureRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  // ── Scroll-wheel zoom ────────────────────────────────────────────────────
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const f = frameRef.current;
      const factor = e.deltaY > 0 ? 0.93 : 1.08;
      onChangeRef.current({ ...f, scale: Math.max(0.25, Math.min(6, f.scale * factor)) });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ── Touch: pan (1 finger) + pinch zoom (2 fingers) ─────────────────────
  // Must use addEventListener with { passive: false } so preventDefault()
  // actually blocks page scroll — React JSX touch handlers are passive.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onTouchStart = (e) => {
      e.preventDefault();
      const t = e.touches;
      const f = frameRef.current;
      if (t.length === 1) {
        gestureRef.current = { type: "drag", sx: t[0].clientX, sy: t[0].clientY, fx: f.x, fy: f.y };
      } else if (t.length === 2) {
        gestureRef.current = {
          type: "pinch",
          startDist: pinchDist(t),
          startScale: f.scale,
          startMid: pinchMid(t),
          fx: f.x, fy: f.y,
        };
      }
    };

    const onTouchMove = (e) => {
      e.preventDefault();
      const g = gestureRef.current;
      if (!g) return;
      const t = e.touches;
      const { w, h } = containerSize();
      const f = frameRef.current;
      if (g.type === "drag" && t.length === 1) {
        onChangeRef.current({
          ...f,
          x: g.fx + (t[0].clientX - g.sx) / w,
          y: g.fy + (t[0].clientY - g.sy) / h,
        });
      } else if (g.type === "pinch" && t.length === 2) {
        const newScale = Math.max(0.25, Math.min(6, g.startScale * (pinchDist(t) / g.startDist)));
        const m = pinchMid(t);
        onChangeRef.current({
          ...f,
          scale: newScale,
          x: g.fx + (m.x - g.startMid.x) / w,
          y: g.fy + (m.y - g.startMid.y) / h,
        });
      }
    };

    const onTouchEnd = () => { gestureRef.current = null; };

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove",  onTouchMove,  { passive: false });
    el.addEventListener("touchend",   onTouchEnd,   { passive: false });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove",  onTouchMove);
      el.removeEventListener("touchend",   onTouchEnd);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- handlers only use stable refs

  const f = frame || { x: 0, y: 0, scale: 1 };
  return (
    <div className="image-framer-outer">
      <div
        ref={ref}
        className="image-framer"
        onMouseDown={onMouseDown}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            top: `calc(50% + ${f.y * 100}%)`,
            left: `calc(50% + ${f.x * 100}%)`,
            transform: `translate(-50%, -50%) scale(${f.scale})`,
            width: "auto",
            height: "auto",
            minWidth: "100%",
            minHeight: "100%",
            maxWidth: "none",
            objectFit: "none",
            userSelect: "none",
            pointerEvents: "none",
          }}
        />
        {/* Frame guide — sits above image in stacking order, marks the exact card boundary */}
        <div className="image-framer-guide" aria-hidden="true" />
        <div className="image-framer-hint">drag · scroll · pinch</div>
      </div>
    </div>
  );
}

// --- Achievement Joker Card ---
const TIER_CONFIG = [
  { min: 5, key: "diamond", badge: "💎", label: "×{n}" },
  { min: 4, key: "gold",    badge: "🥇", label: "×{n}" },
  { min: 3, key: "silver",  badge: "🥈", label: "×{n}" },
  { min: 2, key: "bronze",  badge: "🥉", label: "×{n}" },
];

function getTier(timesEarned) {
  if (!timesEarned || timesEarned < 2) return null;
  return TIER_CONFIG.find(t => timesEarned >= t.min) ?? null;
}

function JokerCard({ achievement, earned, earnedAt, timesEarned = 1, isAdmin, onEdit }) {
  const SUIT_COLORS = ["#d4af37", "#a855f7", "#3fb950", "#58a6ff", "#f97316"];
  const colorIdx = achievement.name.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % SUIT_COLORS.length;
  const accentColor = SUIT_COLORS[colorIdx];
  const tier = earned ? getTier(timesEarned) : null;

  return (
    <div className={
      "joker-achievement-card" +
      (earned ? " joker-earned" : " joker-locked") +
      (tier ? ` joker-tier-${tier.key}` : "")
    }>
      {!earned && <div className="joker-lock-overlay">🔒</div>}
      {tier && (
        <div className="joker-tier-badge">
          <span className="joker-tier-icon">{tier.badge}</span>
          <span className="joker-tier-count">×{timesEarned}</span>
        </div>
      )}
      {isAdmin && (
        <button
          className="joker-edit-btn"
          title="Edit achievement"
          onClick={(e) => { e.stopPropagation(); onEdit(achievement); }}
        >✎</button>
      )}
      <div className="joker-card-header" style={{ borderColor: accentColor }}>
        <span className="joker-card-label" style={{ color: accentColor }}>JOKER</span>
      </div>
      <div className="joker-image-area">
        {achievement.imageSvg ? (
          <AchievementImage src={achievement.imageSvg} imageFrame={achievement.imageFrame} accentColor={accentColor} />
        ) : (
          <div className="joker-default-art" style={{ background: accentColor + "22", borderColor: accentColor + "44" }}>
            <span className="joker-default-symbol" style={{ color: accentColor }}>🃏</span>
          </div>
        )}
      </div>
      <div className="joker-card-footer">
        <div className="joker-achievement-name">{achievement.name}</div>
        <div className="joker-achievement-desc">{achievement.description}</div>
        {earned && earnedAt && (
          <div className="joker-earned-date">
            ✓ {new Date(earnedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </div>
        )}
        {!earned && <div className="joker-not-earned">Not yet earned</div>}
      </div>
    </div>
  );
}

// ── Criteria rule-builder constants ───────────────────────────────────────────
const CRITERIA_METRICS = [
  { value: 'total_invested',  label: 'Buy-In + Rebuys' },
  { value: 'cash_out',        label: 'Cash Out' },
  { value: 'net_profit',      label: 'Net Profit ($)' },
  { value: 'buy_in',          label: 'Initial Buy-In' },
  { value: 'rebuy_amount',    label: 'Rebuys Total ($)' },
  { value: 'net_profit_rank', label: 'Profit Rank (1 = winner)' },
];

const CRITERIA_OPS = [
  { value: '>=', label: '≥' },
  { value: '>',  label: '>' },
  { value: '<=', label: '≤' },
  { value: '<',  label: '<' },
  { value: '=',  label: '=' },
  { value: '!=', label: '≠' },
];

const CRITERIA_BASES = [
  { value: 'own_total_invested', label: "player's Total Invested" },
  { value: 'own_buy_in',         label: "player's Initial Buy-In" },
  { value: 'game_min_buy_in',    label: 'Min Buy-In in game' },
  { value: 'game_max_buy_in',    label: 'Max Buy-In in game' },
  { value: 'game_avg_buy_in',    label: 'Avg Buy-In in game' },
  { value: 'game_pot',           label: 'Total Pot' },
];

const DEFAULT_CONDITION = {
  left: 'cash_out', op: '>=', rightType: 'number', rightValue: 0,
  rightMetric: 'total_invested', rightMultiplier: 2, rightBase: 'own_total_invested',
};

// Human-readable summary of one condition
function conditionLabel(cond) {
  const left = CRITERIA_METRICS.find(m => m.value === cond.left)?.label ?? cond.left;
  const op = CRITERIA_OPS.find(o => o.value === cond.op)?.label ?? cond.op;
  let right = '';
  if (cond.rightType === 'number') right = String(cond.rightValue ?? 0);
  else if (cond.rightType === 'metric') right = CRITERIA_METRICS.find(m => m.value === cond.rightMetric)?.label ?? cond.rightMetric;
  else if (cond.rightType === 'multiplier') {
    const base = CRITERIA_BASES.find(b => b.value === cond.rightBase)?.label ?? cond.rightBase;
    right = `${cond.rightMultiplier ?? 1}× ${base}`;
  }
  return `${left} ${op} ${right}`;
}

// ── CriteriaEditor ─────────────────────────────────────────────────────────────
function CriteriaEditor({ value, onChange }) {
  const criteria = value && typeof value === 'object' ? value : { scope: 'game', conditions: [] };

  const setScope = (scope) => {
    if (scope === 'game') {
      onChange({ scope: 'game', conditions: criteria.conditions?.length ? criteria.conditions : [{ ...DEFAULT_CONDITION }] });
    } else {
      onChange({ scope: 'streak', streakLength: criteria.streakLength ?? 3, streakCondition: criteria.streakCondition ?? 'profit' });
    }
  };

  const updateCond = (i, patch) => {
    const conditions = criteria.conditions.map((c, idx) => idx === i ? { ...c, ...patch } : c);
    onChange({ ...criteria, conditions });
  };

  const addCond = () => {
    onChange({ ...criteria, conditions: [...(criteria.conditions || []), { ...DEFAULT_CONDITION }] });
  };

  const removeCond = (i) => {
    onChange({ ...criteria, conditions: criteria.conditions.filter((_, idx) => idx !== i) });
  };

  return (
    <div className="criteria-editor">
      {/* Scope */}
      <div className="criteria-row criteria-scope-row">
        <label className="criteria-label">Scope</label>
        <select className="input criteria-select"
          value={criteria.scope}
          onChange={(e) => setScope(e.target.value)}>
          <option value="game">Game — evaluated when a game completes</option>
          <option value="streak">Streak — consecutive games</option>
        </select>
      </div>

      {criteria.scope === 'game' && (
        <>
          <div className="criteria-conditions-header">
            <span className="criteria-label">Conditions <span className="criteria-label-hint">(ALL must be true)</span></span>
          </div>
          {(criteria.conditions || []).map((cond, i) => (
            <div key={i} className="criteria-condition-row">
              {/* Left metric */}
              <select className="input criteria-select criteria-select-sm"
                value={cond.left}
                onChange={(e) => updateCond(i, { left: e.target.value })}>
                {CRITERIA_METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>

              {/* Operator */}
              <select className="input criteria-select criteria-select-op"
                value={cond.op}
                onChange={(e) => updateCond(i, { op: e.target.value })}>
                {CRITERIA_OPS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>

              {/* Right type */}
              <select className="input criteria-select criteria-select-sm"
                value={cond.rightType}
                onChange={(e) => updateCond(i, { rightType: e.target.value })}>
                <option value="number">Number</option>
                <option value="metric">Metric</option>
                <option value="multiplier">N× Multiplier</option>
              </select>

              {/* Right value inputs */}
              {cond.rightType === 'number' && (
                <input type="number" className="input criteria-number-input"
                  value={cond.rightValue ?? 0}
                  onChange={(e) => updateCond(i, { rightValue: parseFloat(e.target.value) || 0 })} />
              )}
              {cond.rightType === 'metric' && (
                <select className="input criteria-select criteria-select-sm"
                  value={cond.rightMetric ?? 'total_invested'}
                  onChange={(e) => updateCond(i, { rightMetric: e.target.value })}>
                  {CRITERIA_METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              )}
              {cond.rightType === 'multiplier' && (
                <>
                  <input type="number" className="input criteria-number-input"
                    value={cond.rightMultiplier ?? 2} min={0.1} step={0.5}
                    onChange={(e) => updateCond(i, { rightMultiplier: parseFloat(e.target.value) || 1 })} />
                  <span className="criteria-times">×</span>
                  <select className="input criteria-select criteria-select-sm"
                    value={cond.rightBase ?? 'own_total_invested'}
                    onChange={(e) => updateCond(i, { rightBase: e.target.value })}>
                    {CRITERIA_BASES.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
                  </select>
                </>
              )}

              <button className="criteria-remove-btn" title="Remove condition"
                onClick={() => removeCond(i)}>✕</button>
            </div>
          ))}
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={addCond}>
            + Add Condition
          </button>
        </>
      )}

      {criteria.scope === 'streak' && (
        <div className="criteria-streak-row">
          <label className="criteria-label">Win</label>
          <input type="number" className="input criteria-number-input" min={2} max={20}
            value={criteria.streakLength ?? 3}
            onChange={(e) => onChange({ ...criteria, streakLength: parseInt(e.target.value) || 3 })} />
          <label className="criteria-label">consecutive games with</label>
          <select className="input criteria-select"
            value={criteria.streakCondition ?? 'profit'}
            onChange={(e) => onChange({ ...criteria, streakCondition: e.target.value })}>
            <option value="profit">net profit &gt; 0 (win)</option>
            <option value="loss">net profit &lt; 0 (loss)</option>
          </select>
        </div>
      )}

      {/* Human-readable summary */}
      {criteria.scope === 'game' && criteria.conditions?.length > 0 && (
        <div className="criteria-summary">
          {criteria.conditions.map((c, i) => (
            <div key={i} className="criteria-summary-line">
              {i > 0 && <span className="criteria-and">AND</span>}
              <span>{conditionLabel(c)}</span>
            </div>
          ))}
        </div>
      )}
      {criteria.scope === 'streak' && (
        <div className="criteria-summary">
          <span>Win <strong>{criteria.streakLength ?? 3}</strong> consecutive games where net profit {criteria.streakCondition === 'profit' ? '> 0' : '< 0'}</span>
        </div>
      )}
    </div>
  );
}

// --- Direct image upload + framing controls ---
function DirectImageUpload({ achievementId, currentSrc, frame, uploading, setUploading, onUploaded, onFrameChange }) {
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
      <div className="inspiration-upload-row" style={{ marginBottom: isUrlImage ? 16 : 0 }}>
        <label className={"btn btn-ghost btn-sm inspiration-upload-btn" + (uploading ? " disabled" : "")}>
          {uploading ? "Uploading…" : currentSrc ? "Replace Image" : "Upload Image"}
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
            onChange={handleFile} disabled={uploading} />
        </label>
        {currentSrc && (
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {isUrlImage ? "URL image" : "SVG art"} · {isUrlImage ? "framing controls below" : "upload to replace"}
          </span>
        )}
      </div>
      {error && <p className="error-msg" style={{ marginTop: 6 }}>{error}</p>}
      {isUrlImage && (
        <div className="framer-section">
          <ImageFramer src={currentSrc} frame={frame} onChange={onFrameChange} />
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 8, alignSelf: "flex-start" }}
            onClick={() => onFrameChange({ x: 0, y: 0, scale: 1 })}
          >
            Reset framing
          </button>
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

  if (!users) return <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading users…</div>;

  return (
    <>
      {error && <p className="error-msg" style={{ marginBottom: 8 }}>{error}</p>}
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
                >−</button>
                <span className="ua-stepper-val">{u.count ?? 1}</span>
                <button
                  className="ua-stepper-btn"
                  onClick={() => adjustCount(u, 1)}
                  disabled={patchingCount.has(u.id)}
                  aria-label="Increase count"
                >+</button>
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
                  ? (<><span className="ua-btn-text">Revoke</span><span className="ua-btn-icon" aria-hidden="true">✕</span></>)
                  : (<><span className="ua-btn-text">Grant</span><span className="ua-btn-icon" aria-hidden="true">✓</span></>)
              }
            </button>
          </div>
        ))}
        {users.length === 0 && (
          <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>No users found.</p>
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

  const SUIT_COLORS = ["#d4af37", "#a855f7", "#3fb950", "#58a6ff", "#f97316"];
  const colorIdx = name.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % SUIT_COLORS.length;
  const accentColor = SUIT_COLORS[colorIdx];

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 740 }}>
        <div className="modal-header">
          <h2>Edit Achievement</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Top row: card preview + fields */}
          <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
            <div style={{ flexShrink: 0 }}>
              <div className="field-label" style={{ marginBottom: 8 }}>Preview</div>
              <div className="joker-achievement-card joker-earned" style={{ width: 148, cursor: "default" }}>
                <div className="joker-card-header" style={{ borderColor: accentColor }}>
                  <span className="joker-card-label" style={{ color: accentColor }}>JOKER</span>
                </div>
                <div className="joker-image-area">
                  {previewSvg ? (
                    <AchievementImage src={previewSvg} imageFrame={previewFrame ? JSON.stringify(previewFrame) : null} accentColor={accentColor} />
                  ) : (
                    <div className="joker-default-art" style={{ background: accentColor + "22", borderColor: accentColor + "44" }}>
                      <span className="joker-default-symbol" style={{ color: accentColor }}>🃏</span>
                    </div>
                  )}
                </div>
                <div className="joker-card-footer">
                  <div className="joker-achievement-name">{name || "—"}</div>
                  <div className="joker-achievement-desc" style={{ WebkitLineClamp: 2, overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical" }}>
                    {description || "—"}
                  </div>
                </div>
              </div>
            </div>

            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
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
                <input type="number" className="input" min={0} max={9999} style={{ width: 110 }}
                  value={xpValue} onChange={(e) => setXpValue(e.target.value)} />
              </div>
              <div className="auth-field">
                <label className="field-label">
                  Regenerate Art
                  <span className="rule-form-optional" style={{ marginLeft: 6 }}>optional guidance</span>
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="text" className="input" maxLength={300}
                    placeholder='e.g. "Monopoly man with top hat, 64-bit style"'
                    value={feedback} onChange={(e) => setFeedback(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !regenerating && handleRegenerate()} />
                  <button className="btn btn-secondary" onClick={handleRegenerate} disabled={regenerating} style={{ flexShrink: 0 }}>
                    {regenerating ? "…" : "✦ Gen"}
                  </button>
                </div>
              </div>
              <div className="auth-field">
                <label className="field-label">
                  Inspiration Image
                  <span className="rule-form-optional" style={{ marginLeft: 6 }}>visual reference for Gemini</span>
                </label>
                <div className="inspiration-upload-row">
                  <label className="btn btn-ghost btn-sm inspiration-upload-btn">
                    {inspirationFile ? "Change Image" : "Upload Image"}
                    <input type="file" accept="image/*" style={{ display: "none" }} onChange={handleInspirationChange} />
                  </label>
                  {inspirationPreview && (
                    <>
                      <img src={inspirationPreview} alt="inspiration" className="inspiration-thumb" />
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => { setInspirationFile(null); setInspirationPreview(null); }}>✕</button>
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
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2>Suggest an Achievement</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ color: "var(--text-muted)", fontSize: 14, margin: 0 }}>
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
                <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
                  onChange={handleImageSelect} />
              </label>
              {imagePreview && (
                <>
                  <img src={imagePreview} alt="reference" className="inspiration-thumb" />
                  <button className="btn btn-ghost btn-sm"
                    onClick={() => { setImageFile(null); setImagePreview(null); }}>✕</button>
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
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h2>Review Suggestion</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
            Suggested by <strong style={{ color: "var(--text)" }}>{rec.username}</strong>
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
              <div className="field-label" style={{ marginBottom: 6 }}>Reference Image</div>
              <img src={rec.referenceImagePath} alt="reference" style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 8, objectFit: "contain", background: "rgba(0,0,0,0.2)" }} />
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
                <input type="file" accept="image/*" style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) { setInspirationFile(f); setInspirationPreview(URL.createObjectURL(f)); }
                  }} />
              </label>
              {inspirationPreview && (
                <>
                  <img src={inspirationPreview} alt="inspiration" className="inspiration-thumb" />
                  <button className="btn btn-ghost btn-sm"
                    onClick={() => { setInspirationFile(null); setInspirationPreview(null); }}>✕</button>
                </>
              )}
            </div>
          </div>
          {error && <p className="error-msg">{error}</p>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-danger" onClick={handleReject} disabled={!!saving}>Reject</button>
          <div style={{ flex: 1 }} />
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

// --- Achievements Tab ---
function AchievementsTab({ isAdmin }) {
  const [achievements, setAchievements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editTarget, setEditTarget] = useState(null);
  const [showRecommend, setShowRecommend] = useState(false);
  const [recommendations, setRecommendations] = useState([]);
  const [recTarget, setRecTarget] = useState(null);

  const fetchAchievements = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch("/api/achievements");
      setAchievements(data);
    } catch { setError("Failed to load achievements."); }
    setLoading(false);
  }, []);

  const fetchRecs = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const data = await apiFetch("/api/achievements/recommendations");
      setRecommendations(data.filter((r) => r.status === "pending"));
    } catch {}
  }, [isAdmin]);

  useEffect(() => {
    fetchAchievements();
    fetchRecs();
  }, [fetchAchievements, fetchRecs]);

  const earned = achievements.filter((a) => a.earned);
  const locked = achievements.filter((a) => !a.earned);

  if (loading) return <div className="loading"><p>Loading achievements…</p></div>;
  if (error) return <div className="error-banner"><p>{error}</p><button className="btn btn-ghost" onClick={fetchAchievements}>Retry</button></div>;

  return (
    <div className="achievements-tab">
      <div className="achievements-header">
        <div>
          <h2 className="achievements-title">Achievements</h2>
          <p className="achievements-subtitle">
            {earned.length} of {achievements.length} earned
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowRecommend(true)}>
          + Suggest Achievement
        </button>
      </div>

      {/* Admin: pending recommendations */}
      {isAdmin && recommendations.length > 0 && (
        <div className="achievements-section">
          <div className="achievements-section-title">Pending Suggestions ({recommendations.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {recommendations.map((r) => (
              <div key={r.id} className="user-assignment-row" style={{ justifyContent: "space-between" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>{r.name}</span>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{r.description}</span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>by {r.username}</span>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setRecTarget(r)}>Review</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Earned */}
      {earned.length > 0 && (
        <div className="achievements-section">
          <div className="achievements-section-title">Earned — {earned.length}</div>
          <div className="joker-cards-grid">
            {earned.map((a) => (
              <JokerCard
                key={a.id}
                achievement={a}
                earned={true}
                earnedAt={a.earnedAt}
                timesEarned={a.timesEarned ?? 1}
                isAdmin={isAdmin}
                onEdit={setEditTarget}
              />
            ))}
          </div>
        </div>
      )}

      {/* Locked */}
      {locked.length > 0 && (
        <div className="achievements-section">
          <div className="achievements-section-title">Locked — {locked.length}</div>
          <div className="joker-cards-grid">
            {locked.map((a) => (
              <JokerCard
                key={a.id}
                achievement={a}
                earned={false}
                earnedAt={null}
                isAdmin={isAdmin}
                onEdit={setEditTarget}
              />
            ))}
          </div>
        </div>
      )}

      {achievements.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🏆</div>
          <p>No achievements yet.</p>
        </div>
      )}

      {editTarget && (
        <EditAchievementModal
          achievement={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); fetchAchievements(); }}
        />
      )}

      {showRecommend && (
        <RecommendAchievementModal
          onClose={() => setShowRecommend(false)}
          onSubmitted={() => setShowRecommend(false)}
        />
      )}

      {recTarget && (
        <ApproveRecModal
          rec={recTarget}
          onClose={() => setRecTarget(null)}
          onApproved={() => { setRecTarget(null); fetchAchievements(); fetchRecs(); }}
        />
      )}
    </div>
  );
}

// --- Root App ---
// --- Stats Tab (personal game history & summary) ---
function StatsTab() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/api/profile/stats")
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const fmtMoney = (v) => (v == null ? "—" : "$" + Number(v).toFixed(0));
  const fmtMoneySign = (v) => {
    if (v == null) return "—";
    const n = Number(v);
    return (n >= 0 ? "+" : "") + "$" + Math.abs(n).toFixed(0);
  };
  const fmtDuration = (start, end) => {
    if (!start || !end) return "—";
    const ms = new Date(end) - new Date(start);
    if (ms <= 0) return "—";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h === 0) return `${m}m`;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  };
  const fmtDate = (d) => d
    ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })
    : "—";

  if (loading) return <div className="loading"><p>Loading stats…</p></div>;
  if (!stats?.summary || stats.summary.gamesPlayed === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">♦</div>
        <p>No completed games yet. Stats will appear after your first game.</p>
      </div>
    );
  }

  return (
    <div className="stats-tab">
      <h2 className="section-title">My Stats</h2>
      <div className="profile-stats-grid">
        <div className="stat-card">
          <span className="stat-label">Games Played</span>
          <span className="stat-value">{stats.summary.gamesPlayed}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Avg Buy-In / Game</span>
          <span className="stat-value">{fmtMoney(stats.summary.avgBuyIn)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Buy-In</span>
          <span className="stat-value">{fmtMoney(stats.summary.totalBuyIn)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Cash-Out</span>
          <span className={"stat-value " + (stats.summary.totalCashOut >= stats.summary.totalBuyIn ? "stat-profit" : "stat-loss")}>
            {fmtMoney(stats.summary.totalCashOut)}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Avg Cash-Out / Game</span>
          <span className="stat-value">{fmtMoney(stats.summary.avgCashOut)}</span>
        </div>
        <div className="stat-card stat-card-net">
          <span className="stat-label">Net Profit / Loss</span>
          <span className={"stat-value stat-value-lg " + (stats.summary.totalCashOut - stats.summary.totalBuyIn >= 0 ? "stat-profit" : "stat-loss")}>
            {fmtMoneySign(stats.summary.totalCashOut - stats.summary.totalBuyIn)}
          </span>
        </div>
      </div>

      <h3 className="profile-history-title">History</h3>
      <div className="profile-history">
        <div className="history-header">
          <span>Date</span>
          <span>Buy In</span>
          <span>Re-Buys</span>
          <span>Cash Out</span>
          <span>Time</span>
        </div>
        {stats.history.map((g, i) => {
          const invested = (g.buyIn || 0) + (g.rebuys || 0);
          const net = g.cashOut != null ? g.cashOut - invested : null;
          return (
            <div key={i} className={"history-row" + (net == null ? "" : net >= 0 ? " history-profit" : " history-loss")}>
              <span className="history-date">{fmtDate(g.date)}{g.location ? ` · ${g.location}` : ""}</span>
              <span>{fmtMoney(g.buyIn)}</span>
              <span>{g.rebuys ? fmtMoney(g.rebuys) : "—"}</span>
              <span>{g.cashOut != null ? fmtMoney(g.cashOut) : "—"}</span>
              <span>{fmtDuration(g.startTime, g.endTime)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TABS = [
  { id: "leaderboard",  label: "Leaderboard" },
  { id: "games",        label: "Games" },
  { id: "players",      label: "Players" },
  { id: "rules",        label: "Rules" },
  { id: "achievements", label: "Achievements" },
  { id: "stats",        label: "Stats" },
];

function App() {
  // isLoggedIn is seeded from stored username (non-sensitive display state).
  // If the httpOnly cookie has actually expired the first apiFetch will 401 and reload.
  const [isLoggedIn, setIsLoggedIn] = useState(!!getStoredUsername());
  const [pendingPasswordChange, setPendingPasswordChange] = useState(null); // { username, currentPassword }
  const [tab, setTab] = useState("leaderboard");
  const [players, setPlayers] = useState([]);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [selectedGame, setSelectedGame] = useState(null);
  const [showNewGame, setShowNewGame] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [currentUsername, setCurrentUsername] = useState(getStoredUsername);
  const [currentRole, setCurrentRole] = useState(getRole);
  const [currentAvatar, setCurrentAvatar] = useState(getStoredAvatar);

  const isAdmin = roleIsAdmin(currentRole);
  const isOwner = roleIsOwner(currentRole);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setFetchError("");
    try {
      const [playersData, gamesData] = await Promise.all([
        apiFetch("/api/players"),
        apiFetch("/api/games"),
      ]);
      setPlayers(playersData.items);
      setGames(gamesData.items ?? []);
    } catch (e) {
      setFetchError(e.message || "Failed to load data.");
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (isLoggedIn) fetchData(); }, [isLoggedIn, fetchData]);

  const handleLogin = (username, role, avatarPath) => {
    setCurrentUsername(username);
    setCurrentRole(role);
    setCurrentAvatar(avatarPath);
    setIsLoggedIn(true);
  };

  const signOut = async () => {
    try { await apiFetch("/api/logout", { method: "POST" }); } catch {}
    clearUsername(); clearRole(); storeAvatar(null);
    setIsLoggedIn(false);
    setCurrentUsername(null);
    setCurrentRole(null);
    setCurrentAvatar(null);
    setPlayers([]);
    setGames([]);
    setSelectedGame(null);
    setTab("leaderboard");
  };

  const handleSelectGame = (game) => {
    const fresh = games.find((g) => g.id === game.id) || game;
    setSelectedGame(fresh);
  };

  const handleNewGameCreated = async () => {
    await fetchData();
    setShowNewGame(false);
    setTab("games");
  };

  const handleRefreshAndBack = async () => {
    await fetchData();
    setSelectedGame(null);
  };

  const activeGame = games.find((g) => !g.isComplete);

  if (!isLoggedIn && pendingPasswordChange) {
    return (
      <ChangePasswordScreen
        username={pendingPasswordChange.username}
        currentPassword={pendingPasswordChange.currentPassword}
        onSuccess={() => {
          setPendingPasswordChange(null);
          setIsLoggedIn(true);
          setCurrentUsername(getStoredUsername());
          setCurrentRole(getRole());
          setCurrentAvatar(getStoredAvatar());
        }}
      />
    );
  }

  if (!isLoggedIn) return <LoginScreen onLogin={handleLogin} onRequirePasswordChange={(u, p) => setPendingPasswordChange({ username: u, currentPassword: p })} />;

  const allTabs = [
    ...TABS,
    ...(isAdmin ? [{ id: "ask-claude", label: "Ask Claude" }] : []),
    ...(isAdmin ? [{ id: "admin", label: "Admin" }] : []),
  ];

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <span className="logo">🃏 Poker Tracker</span>
          {activeGame && !selectedGame && (
            <button className="active-game-pill" onClick={() => handleSelectGame(activeGame)}>
              Live
            </button>
          )}
        </div>
        <div className="header-right">
          <button
            className="btn btn-ghost btn-sm header-stats-btn"
            onClick={() => { setSelectedGame(null); setTab("stats"); }}
          >
            Stats
          </button>
          <button
            className="profile-btn"
            onClick={() => setShowProfile(true)}
            title="Profile"
          >
            <Avatar src={currentAvatar} name={currentUsername} size={28} />
            <span className="header-username">{currentUsername}</span>
          </button>
        </div>
      </header>

      {!selectedGame && (
        <nav className="tab-nav">
          {allTabs.map((t) => (
            <button
              key={t.id}
              className={"tab-btn" + (tab === t.id ? " active" : "")}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      )}

      <main className="app-main">
        {loading ? (
          <div className="loading"><p>Loading…</p></div>
        ) : fetchError ? (
          <div className="error-banner">
            <p>{fetchError}</p>
            <button className="btn btn-ghost" onClick={fetchData}>Retry</button>
          </div>
        ) : selectedGame ? (
          <GameDetail
            game={selectedGame}
            onBack={() => setSelectedGame(null)}
            onRefresh={handleRefreshAndBack}
            isOwner={isOwner}
            isAdmin={isAdmin}
            allPlayers={players}
          />
        ) : (
          <>
            {tab === "leaderboard"  && <Leaderboard players={players} />}
            {tab === "games"        && (
              <GameHistory
                games={games}
                onSelectGame={handleSelectGame}
                onNewGame={() => setShowNewGame(true)}
                isOwner={isOwner}
                isAdmin={isAdmin}
                onRefresh={fetchData}
              />
            )}
            {tab === "players"      && <PlayersTab players={players} onRefresh={fetchData} isOwner={isOwner} isAdmin={isAdmin} />}
            {tab === "rules"        && <RulesTab isOwner={isOwner} isAdmin={isAdmin} />}
            {tab === "achievements" && <AchievementsTab isAdmin={isAdmin} />}
            {tab === "stats"        && <StatsTab />}
            {tab === "ask-claude"   && isAdmin && <AskClaudeTab />}
            {tab === "admin"        && isAdmin && <AdminPanel />}
          </>
        )}
      </main>

      {showNewGame && (
        <NewGameModal
          players={players}
          onClose={() => setShowNewGame(false)}
          onCreate={handleNewGameCreated}
        />
      )}

      {showProfile && (
        <ProfileModal
          onClose={() => setShowProfile(false)}
          onAvatarChange={(path) => {
            setCurrentAvatar(path);
            storeAvatar(path);
          }}
          onSignOut={() => { setShowProfile(false); signOut(); }}
        />
      )}
    </div>
  );
}

export default App;
