import { SUIT_COLORS } from "../../lib/constants";
import { getTier } from "../../lib/format";
import AchievementImage from "./AchievementImage";
import { Cards, Check, Diamond, Lock, Medal, PencilSimple, Play } from "../icons";

function JokerCard({ achievement, earned, earnedAt, timesEarned = 1, isAdmin, onEdit, onPreviewToast, staggerIndex = 0 }) {
  const colorIdx = achievement.name.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % SUIT_COLORS.length;
  const accentColor = SUIT_COLORS[colorIdx];
  const tier = earned ? getTier(timesEarned) : null;

  return (
    <div
      // Position in the grid drives the reveal delay. Capped so a large
      // collection does not leave the last card waiting seconds to appear.
      style={{ "--stagger-index": Math.min(staggerIndex, 12) }}
      className={
        "joker-achievement-card" +
        (earned ? " joker-earned" : " joker-locked") +
        (tier ? ` joker-tier-${tier.key}` : "")
      }
    >
      {!earned && <div className="joker-lock-overlay"><Lock weight="fill" size={20} /></div>}
      {tier && (
        <div className="joker-tier-badge">
          {tier.key === "diamond"
            ? <Diamond weight="fill" size={12} className={"joker-tier-icon joker-tier-icon-" + tier.key} />
            : <Medal weight="fill" size={12} className={"joker-tier-icon joker-tier-icon-" + tier.key} />}
          <span className="joker-tier-count">×{timesEarned}</span>
        </div>
      )}
      {isAdmin && (
        <div className="joker-admin-btns">
          <button
            className="joker-edit-btn"
            title="Edit achievement"
            aria-label={`Edit ${achievement.name}`}
            onClick={(e) => { e.stopPropagation(); onEdit(achievement); }}
          ><PencilSimple /></button>
          <button
            className="joker-preview-btn"
            title="Preview earned toast"
            aria-label={`Preview the earned toast for ${achievement.name}`}
            onClick={(e) => { e.stopPropagation(); onPreviewToast(achievement); }}
          ><Play weight="fill" /></button>
        </div>
      )}
      <div className="joker-card-header" style={{ "--joker-accent": accentColor }}>
        <span className="joker-card-label">JOKER</span>
      </div>
      <div className="joker-image-area">
        {achievement.imageSvg ? (
          <AchievementImage src={achievement.imageSvg} imageFrame={achievement.imageFrame} accentColor={accentColor} />
        ) : (
          <div className="joker-default-art" style={{ "--joker-accent": accentColor }}>
            <Cards className="joker-default-symbol" weight="fill" size={34} />
          </div>
        )}
      </div>
      <div className="joker-card-footer">
        <div className="joker-achievement-name">{achievement.name}</div>
        <div className="joker-achievement-desc">{achievement.description}</div>
        {earned && earnedAt && (
          <div className="joker-earned-date">
            <Check weight="bold" /> {new Date(earnedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </div>
        )}
        {!earned && <div className="joker-not-earned">Not yet earned</div>}
      </div>
    </div>
  );
}

export default JokerCard;
