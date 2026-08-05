import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../../lib/api";
import ApproveRecModal from "./ApproveRecModal";
import EditAchievementModal from "./EditAchievementModal";
import JokerCard from "./JokerCard";
import RecommendAchievementModal from "./RecommendAchievementModal";
import { Trophy } from "../icons";
import SkeletonTab from "../Skeleton";

// --- Achievements Tab ---
function AchievementsTab({ isAdmin, onPreviewToast }) {
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

  if (loading) return <SkeletonTab rows={4} />;
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
          <div className="pending-rec-list">
            {recommendations.map((r) => (
              <div key={r.id} className="user-assignment-row pending-rec-row">
                <div className="pending-rec-info">
                  <span className="pending-rec-name">{r.name}</span>
                  <span className="pending-rec-desc">{r.description}</span>
                  <span className="pending-rec-by">by {r.username}</span>
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
                onPreviewToast={onPreviewToast}
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
                onPreviewToast={onPreviewToast}
              />
            ))}
          </div>
        </div>
      )}

      {achievements.length === 0 && (
        <div className="empty-state">
          <Trophy className="empty-icon" weight="fill" size={48} />
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

export default AchievementsTab;
