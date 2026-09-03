import { useState, useEffect } from "react";
import JokerCard from "./JokerCard";
import { CaretLeft, CaretRight, Trophy, X } from "../icons";

// --- Achievement Toast Notification ---
function AchievementToast({ achievements, onDismiss, onViewAll }) {
  const [visible, setVisible] = useState(false);
  const [idx, setIdx] = useState(0);
  const [animDir, setAnimDir] = useState(null); // 'next' | 'prev'

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, []);

  const dismiss = () => {
    setVisible(false);
    setTimeout(onDismiss, 350);
  };

  const goToAchievements = () => {
    setVisible(false);
    setTimeout(() => { onDismiss(); onViewAll(); }, 350);
  };

  const navigate = (dir) => {
    const next = dir === "next" ? Math.min(idx + 1, achievements.length - 1) : Math.max(idx - 1, 0);
    if (next === idx) return;
    setAnimDir(dir);
    setIdx(next);
    setTimeout(() => setAnimDir(null), 320);
  };

  const achievement = achievements[idx] ?? achievements[0];
  const total = achievements.length;

  return (
    <div className={"achievement-toast-overlay" + (visible ? " visible" : "")} onClick={dismiss}>
      <div className="achievement-toast-card" onClick={(e) => e.stopPropagation()}>
        {/* Sparkle particles */}
        {[...Array(8)].map((_, i) => (
          <div key={i} className={`ach-sparkle ach-sparkle-${i + 1}`} />
        ))}

        <button className="achievement-toast-close" onClick={dismiss} aria-label="Close"><X /></button>

        <div className="achievement-toast-header">
          <Trophy className="achievement-toast-crown" weight="fill" size={22} />
          <span className="achievement-toast-title">
            {total > 1 ? `${total} Achievements Unlocked!` : "Achievement Unlocked!"}
          </span>
        </div>

        {/* Carousel */}
        <div className="achievement-toast-carousel">
          {total > 1 && (
            <button className="ach-nav-btn" onClick={() => navigate("prev")} disabled={idx === 0} aria-label="Previous achievement"><CaretLeft /></button>
          )}

          <div key={idx} className={"achievement-toast-joker-wrap" + (animDir ? ` slide-${animDir}` : "")}>
            <JokerCard
              achievement={{
                id: achievement.achievementId,
                name: achievement.name,
                description: achievement.description,
                imageSvg: achievement.imageSvg,
                imageFrame: achievement.imageFrame,
                xpValue: achievement.xpValue,
              }}
              earned={true}
              earnedAt={achievement.earnedAt}
              timesEarned={achievement.count ?? 1}
              isAdmin={false}
              onEdit={() => {}}
              onPreviewToast={() => {}}
            />
          </div>

          {total > 1 && (
            <button className="ach-nav-btn" onClick={() => navigate("next")} disabled={idx === total - 1} aria-label="Next achievement"><CaretRight /></button>
          )}
        </div>

        {/* Dot indicators */}
        {total > 1 && (
          <div className="achievement-toast-dots">
            {achievements.map((_, i) => (
              <button key={i} className={"ach-dot" + (i === idx ? " active" : "")}
                onClick={() => { setAnimDir(i > idx ? "next" : "prev"); setIdx(i); setTimeout(() => setAnimDir(null), 320); }} />
            ))}
          </div>
        )}

        <div className="achievement-toast-name">{achievement.name}</div>
        <div className="achievement-toast-desc">{achievement.description}</div>
        {achievement.xpValue > 0 && (
          <div className="achievement-toast-xp">+{achievement.xpValue} XP</div>
        )}

        <div className="achievement-toast-actions">
          <button className="btn btn-ghost btn-sm" onClick={dismiss}>Got it</button>
          <button className="btn btn-primary btn-sm" onClick={goToAchievements}>View Achievements</button>
        </div>
      </div>
    </div>
  );
}

export default AchievementToast;
