import { useState } from "react";
import { apiFetch } from "../../lib/api";
import { parseHands, parseSteps } from "../../lib/format";
import { CaretDown, CaretUp, X } from "../icons";

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
          <button className="modal-close" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="modal-body rule-modal-body">

          <label className="rule-form-label">Game Name *</label>
          <input className="input" value={form.gameName} maxLength={100}
            onChange={(e) => set("gameName", e.target.value)} placeholder="e.g. Hold'Em, Omaha" />

          <label className="rule-form-label">Overview <span className="rule-form-optional">(1-2 sentence summary shown at the top)</span></label>
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
                <button type="button" className="step-move-btn" aria-label="Move consideration up" onClick={() => moveConsideration(i, -1)} disabled={i === 0}><CaretUp /></button>
                <button type="button" className="step-move-btn" aria-label="Move consideration down" onClick={() => moveConsideration(i, 1)} disabled={i === considerations.length - 1}><CaretDown /></button>
                <button type="button" className="step-del-btn" aria-label="Remove consideration" onClick={() => removeConsideration(i)}><X /></button>
              </div>
            ))}
            <button type="button" className="btn btn-ghost step-add-btn" onClick={addConsideration}>+ Add Consideration</button>
          </div>

          <label className="rule-form-label">
            How to Play
            <span className="rule-form-optional">: add each step, toggle BET for betting rounds</span>
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
                <button type="button" className="step-move-btn" aria-label="Move step up" onClick={() => moveStep(i, -1)} disabled={i === 0}><CaretUp /></button>
                <button type="button" className="step-move-btn" aria-label="Move step down" onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1}><CaretDown /></button>
                <button type="button" className="step-del-btn" aria-label="Remove step" onClick={() => removeStep(i)}><X /></button>
              </div>
            ))}
            <button type="button" className="btn btn-ghost step-add-btn" onClick={addStep}>+ Add Step</button>
          </div>

          <label className="rule-form-label">Winning Hierarchy <span className="rule-form-optional">(best to worst, optional)</span></label>
          <div className="hand-editor">
            {hands.map((hand, i) => (
              <div key={i} className="hand-editor-row">
                <span className="hand-rank-num">{i + 1}</span>
                <input className="input hand-name-input" value={hand} maxLength={60}
                  onChange={(e) => updateHand(i, e.target.value)} placeholder="e.g. Royal Flush" />
                <button type="button" className="step-move-btn" aria-label="Move hand up" onClick={() => moveHand(i, -1)} disabled={i === 0}><CaretUp /></button>
                <button type="button" className="step-move-btn" aria-label="Move hand down" onClick={() => moveHand(i, 1)} disabled={i === hands.length - 1}><CaretDown /></button>
                <button type="button" className="step-del-btn" aria-label="Remove hand" onClick={() => removeHand(i)}><X /></button>
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

export default RuleEditModal;
