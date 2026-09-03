import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../lib/api";
import { ROLE_CLASS, ROLE_LABEL } from "../lib/constants";
import Avatar from "./Avatar";
import EditAchievementModal from "./achievements/EditAchievementModal";
import { ArrowRight, PencilSimple, X } from "./icons";
import InviteCodes from "./InviteCodes";
import SkeletonTab from "./Skeleton";

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

  if (loading) return <SkeletonTab rows={5} />;
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
              {/* Role buttons: show the two roles they are NOT currently */}
              {["admin", "owner", "user"].filter((r) => r !== (u.role ?? "user")).map((r) => (
                <button key={r} className="btn btn-ghost btn-sm" onClick={() => changeRole(u.id, r)}>
                  <ArrowRight /> {ROLE_LABEL[r]}
                </button>
              ))}
              <button className="btn btn-ghost btn-sm" onClick={() => openReset(u)}>Reset PW</button>
              <button className="btn btn-danger btn-sm" onClick={() => deleteUser(u.id, u.username)}>Delete</button>
            </div>
          </div>
        ))}
      </div>

      <InviteCodes />

      {xpConfig.length > 0 && (
        <div className="xp-settings-section">
          <h3 className="admin-title section-gap">XP Settings</h3>
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
          <div className="row-sm-center mt-sm">
            <button className="btn btn-primary btn-sm" onClick={saveXpConfig} disabled={xpSaving}>
              {xpSaving ? "Saving…" : "Save XP Config"}
            </button>
            {xpSaveMsg && <span className="muted-note" role="status">{xpSaveMsg}</span>}
          </div>
        </div>
      )}

      {adminAchs.length > 0 && (
        <div className="admin-ach-section">
          <h3 className="admin-title section-gap">Achievements</h3>
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
                      <td className="admin-ach-xp">{a.xpValue > 0 ? `${a.xpValue} XP` : "-"}</td>
                      <td className="admin-ach-criteria">{criteriaLabel}</td>
                      <td className="admin-ach-users">{a.earnerCount ?? 0} / {users.length}</td>
                      <td className="admin-ach-edit-cell">
                        <button
                          className="btn btn-ghost btn-sm admin-ach-edit-btn"
                          title="Edit achievement"
                          onClick={() => setAchEditTarget(a)}
                          aria-label={`Edit ${a.name}`}
                        ><PencilSimple /></button>
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
          <div className="modal modal-xs" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Reset Password</h2>
              <button className="close-btn" onClick={() => setResetTarget(null)} aria-label="Close"><X /></button>
            </div>
            <div className="modal-body">
              <p className="muted-note mb-md">
                New password for <strong className="text-strong">{resetTarget.username}</strong>
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

export default AdminPanel;
