import { CRITERIA_BASES, CRITERIA_METRICS, CRITERIA_OPS, DEFAULT_CONDITION } from "../../lib/constants";
import { conditionLabel } from "../../lib/format";
import { X } from "../icons";

// ── CriteriaEditor ─────────────────────────────────────────────────────────────
function CriteriaEditor({ value, onChange }) {
  const criteria = value && typeof value === 'object' ? value : { scope: 'game', conditions: [] };

  const setScope = (scope) => {
    if (scope === 'game') {
      onChange({ scope: 'game', conditions: criteria.conditions?.length ? criteria.conditions : [{ ...DEFAULT_CONDITION }] });
    } else if (scope === 'streak') {
      onChange({ scope: 'streak', streakLength: criteria.streakLength ?? 3, streakCondition: criteria.streakCondition ?? 'profit' });
    } else {
      onChange({ scope: 'profile', trigger: criteria.trigger ?? 'profile_created' });
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
          <option value="profile">Profile — awarded on profile actions</option>
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
                aria-label="Remove condition"
                onClick={() => removeCond(i)}><X /></button>
            </div>
          ))}
          <button className="btn btn-ghost btn-sm criteria-add-btn" onClick={addCond}>
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

      {criteria.scope === 'profile' && (
        <div className="criteria-streak-row">
          <label className="criteria-label">Trigger</label>
          <select className="input criteria-select"
            value={criteria.trigger ?? 'profile_created'}
            onChange={(e) => onChange({ ...criteria, trigger: e.target.value })}>
            <option value="profile_created">Account created</option>
            <option value="profile_avatar">Profile picture uploaded</option>
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
      {criteria.scope === 'profile' && (
        <div className="criteria-summary">
          <span>Awarded once when: <strong>
            {criteria.trigger === 'profile_avatar' ? 'user uploads a profile picture' : 'user creates their account'}
          </strong></span>
        </div>
      )}
    </div>
  );
}

export default CriteriaEditor;
