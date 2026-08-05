import { useState } from "react";
import { apiFetch } from "../../lib/api";
import { parseHands, parseSteps, sanitizeInput } from "../../lib/format";
import Avatar from "../Avatar";
import { ArrowLeft, CaretDown, CaretUp, X } from "../icons";

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
        <button className="back-btn" onClick={onBack}><ArrowLeft /> Rules</button>
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
                    <span className="version-chevron">{expanded ? <CaretUp /> : <CaretDown />}</span>
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
                    <button className="btn-icon delete-btn" title="Delete comment"
                      aria-label={`Delete comment by ${c.username}`}
                      onClick={() => deleteComment(c.id)}><X /></button>
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

export default RuleDetail;
