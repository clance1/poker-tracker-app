import { useState, useEffect, useRef } from "react";
import { apiFetch } from "../../lib/api";
import CardPicker from "./CardPicker";

function ColoredOuts({ text }) {
  if (!text || text.toLowerCase() === 'none' || text === '-') return <span>{text || '-'}</span>;
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
              type="number" className="input input-w-xs"
              min={2} max={10} value={playerCount}
              onChange={(e) => setPlayerCount(e.target.value)}
              onBlur={() => setPlayerCount(Math.min(10, Math.max(2, parseInt(playerCount) || 2)))}
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
              Board Cards: {street === "flop" ? "Flop" : street === "turn" ? "Flop + Turn" : "Flop + Turn + River"}
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

        {hasDuplicates && <p className="error-msg">Duplicate cards detected. Each card can only appear once.</p>}
        {error && <p className="error-msg">{error}</p>}

        <button
          className="btn btn-primary mt-xs"
          onClick={handleAnalyze}
          disabled={!canSubmit}
        >
          {analyzing ? "Analyzing..." : "Analyze Hand"}
        </button>
      </div>

      {(rawText || analyzing) && (
        <div className="ask-claude-result" ref={resultRef}>
          {analyzing && !rawText && (
            <p className="text-muted thinking-note">Claude is thinking&hellip;</p>
          )}

          {parsed ? (
            <>
              <div className="analysis-stats">
                <div className="stat-card">
                  <div className="stat-label">Win Probability</div>
                  <div className="stat-value">{parsed.probability || "-"}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Outs</div>
                  <div className="stat-value stat-outs"><ColoredOuts text={parsed.outs} /></div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Recommendation</div>
                  <div className={"stat-value " + recColor(parsed.recommendation)}>{parsed.recommendation || "-"}</div>
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

export default AskClaudeTab;
