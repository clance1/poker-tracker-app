import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../../lib/api";
import DuplicateRuleModal from "./DuplicateRuleModal";
import RuleDetail from "./RuleDetail";
import RuleEditModal from "./RuleEditModal";
import { ArrowRight, Copy, X } from "../icons";
import SkeletonTab from "../Skeleton";

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

  if (loading) return <SkeletonTab rows={3} />;

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
                    aria-label={`Duplicate ${r.gameName}`}
                    onClick={(e) => { e.stopPropagation(); setDuplicateTarget(r); }}><Copy /></button>
                  {isAdmin && (
                    <button className="btn-icon delete-btn" title="Delete rule"
                      aria-label={`Delete ${r.gameName}`}
                      onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}><X /></button>
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
                <span className="rule-card-cta">View <ArrowRight /></span>
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

export default RulesTab;
