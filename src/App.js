import React, { useState, useEffect, useCallback } from "react";
import "./App.css";
import "@aws-amplify/ui-react/styles.css";
import { generateClient } from "aws-amplify/api";
import { withAuthenticator } from "@aws-amplify/ui-react";
import * as ops from "./graphql/operations";

const client = generateClient();

// --- Helpers ---

const fmt = (amount) => {
  if (amount === null || amount === undefined) return "$0";
  const abs = Math.abs(amount);
  const str = Number.isInteger(abs) ? abs.toFixed(0) : abs.toFixed(2);
  return (amount < 0 ? "-$" : "$") + str;
};

const fmtDate = (dateStr) => {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
};

const todayISO = () => new Date().toISOString().split("T")[0];
const calcNet = (gp) => (gp.cashOut ?? 0) - gp.buyIn - (gp.rebuys ?? 0);
const totalPot = (gps) => gps.reduce((s, gp) => s + gp.buyIn + (gp.rebuys ?? 0), 0);

// --- Leaderboard ---

function Leaderboard({ players }) {
  const stats = players
    .map((p) => {
      const completed = (p.games?.items ?? []).filter((gp) => gp.game?.isComplete);
      const net = completed.reduce((s, gp) => s + calcNet(gp), 0);
      const wins = completed.filter((gp) => calcNet(gp) > 0).length;
      const nets = completed.map(calcNet);
      return {
        id: p.id, name: p.name, net,
        gamesPlayed: completed.length,
        winRate: completed.length ? Math.round((wins / completed.length) * 100) : 0,
        best: nets.length ? Math.max(...nets) : 0,
        worst: nets.length ? Math.min(...nets) : 0,
      };
    })
    .sort((a, b) => b.net - a.net);

  if (stats.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">spade</div>
        <p>No players yet. Add some in the Players tab to get started.</p>
      </div>
    );
  }

  const medals = ["1st", "2nd", "3rd"];

  return (
    <div className="leaderboard">
      {stats.map((p, i) => (
        <div key={p.id} className={"lb-card" + (i === 0 && p.net > 0 ? " leader" : "")}>
          <div className="lb-rank">{medals[i] || ("#" + (i + 1))}</div>
          <div className="lb-name">{p.name}</div>
          <div className={"lb-net " + (p.net >= 0 ? "profit" : "loss")}>
            {p.net >= 0 ? "+" : ""}{fmt(p.net)}
          </div>
          <div className="lb-stats">
            <span>{p.gamesPlayed}g</span>
            <span>{p.winRate}% W</span>
            <span>Best: {fmt(p.best)}</span>
            <span>Worst: {fmt(p.worst)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Game History ---

function GameHistory({ games, onSelectGame, onNewGame }) {
  const sorted = [...games].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div className="game-history">
      <button className="btn btn-primary new-game-btn" onClick={onNewGame}>+ New Game</button>
      {sorted.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">club</div>
          <p>No games recorded yet. Start your first game!</p>
        </div>
      ) : sorted.map((g) => {
        const pot = totalPot(g.players?.items ?? []);
        const playerNames = (g.players?.items ?? []).map((gp) => gp.player?.name).filter(Boolean).join(", ");
        return (
          <div key={g.id} className={"game-card " + (g.isComplete ? "complete" : "active-game")} onClick={() => onSelectGame(g)}>
            <div className="game-card-header">
              <span className="game-date">{fmtDate(g.date)}</span>
              <span className={"game-status " + (g.isComplete ? "" : "badge-active")}>
                {g.isComplete ? "Completed" : "In Progress"}
              </span>
            </div>
            <div className="game-players-preview">{playerNames}</div>
            <div className="game-pot">Pot: {fmt(pot)}</div>
          </div>
        );
      })}
    </div>
  );
}

// --- New Game Modal ---

function NewGameModal({ players, onClose, onCreate }) {
  const [date, setDate] = useState(todayISO());
  const [selected, setSelected] = useState({});
  const [buyIns, setBuyIns] = useState({});
  const [defaultBuyIn, setDefaultBuyIn] = useState("20");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const togglePlayer = (id) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id]; else next[id] = true;
      return next;
    });
    if (!buyIns[id]) setBuyIns((prev) => ({ ...prev, [id]: defaultBuyIn }));
  };

  const selectedIds = Object.keys(selected);

  const handleCreate = async () => {
    if (!date) return setError("Please pick a date.");
    if (selectedIds.length < 2) return setError("Select at least 2 players.");
    for (const id of selectedIds) {
      const val = parseFloat(buyIns[id] ?? defaultBuyIn);
      if (isNaN(val) || val <= 0) return setError("All buy-ins must be > $0.");
    }
    setSaving(true); setError("");
    try {
      const gameRes = await client.graphql({ query: ops.CREATE_GAME, variables: { input: { date, isComplete: false } } });
      const gameID = gameRes.data.createGame.id;
      await Promise.all(selectedIds.map((playerID) =>
        client.graphql({ query: ops.CREATE_GAME_PLAYER, variables: { input: { gameID, playerID, buyIn: parseFloat(buyIns[playerID] ?? defaultBuyIn), rebuys: 0 } } })
      ));
      await onCreate();
    } catch (e) { setError("Failed to create game. See console."); console.error(e); setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>New Game</h2>
          <button className="close-btn" onClick={onClose}>X</button>
        </div>
        <div className="modal-body">
          <label className="field-label">Date</label>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          <label className="field-label" style={{ marginTop: 16 }}>Default Buy-In ($)</label>
          <input type="number" className="input" value={defaultBuyIn} min="1"
            onChange={(e) => { setDefaultBuyIn(e.target.value); const next = { ...buyIns }; selectedIds.forEach((id) => { next[id] = e.target.value; }); setBuyIns(next); }} />
          <label className="field-label" style={{ marginTop: 16 }}>Players</label>
          {players.length === 0 && <p className="hint">Add players in the Players tab first.</p>}
          <div className="player-select-grid">
            {players.map((p) => (
              <div key={p.id} className="player-select-row">
                <button className={"player-toggle " + (selected[p.id] ? "selected" : "")} onClick={() => togglePlayer(p.id)}>
                  {selected[p.id] ? "On " : "+ "}{p.name}
                </button>
                {selected[p.id] && (
                  <input type="number" className="input buy-in-input" value={buyIns[p.id] ?? defaultBuyIn} min="1"
                    onChange={(e) => setBuyIns((prev) => ({ ...prev, [p.id]: e.target.value }))} placeholder="$" />
                )}
              </div>
            ))}
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

function GameDetail({ game, onBack, onRefresh }) {
  const [gamePlayers, setGamePlayers] = useState(game.players?.items ?? []);
  const [cashOuts, setCashOuts] = useState({});
  const [saving, setSaving] = useState(false);
  const [endError, setEndError] = useState("");
  const [notes, setNotes] = useState(game.notes ?? "");

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

  const addRebuy = async (gp) => {
    const raw = window.prompt("Rebuy amount for " + gp.player?.name + "?", "20");
    if (raw === null) return;
    const amount = parseFloat(raw);
    if (isNaN(amount) || amount <= 0) return;
    setSaving(true);
    try {
      const newRebuys = (gp.rebuys ?? 0) + amount;
      await client.graphql({ query: ops.UPDATE_GAME_PLAYER, variables: { input: { id: gp.id, rebuys: newRebuys } } });
      setGamePlayers((prev) => prev.map((p) => p.id === gp.id ? { ...p, rebuys: newRebuys } : p));
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  const cashOutTotal = gamePlayers.reduce((s, gp) => { const co = parseFloat(cashOuts[gp.id] ?? 0); return s + (isNaN(co) ? 0 : co); }, 0);
  const potDiff = cashOutTotal - pot;

  const handleEndGame = async () => {
    setEndError("");
    if (Math.abs(potDiff) > 0.01) return setEndError("Cash-outs (" + fmt(cashOutTotal) + ") must equal the pot (" + fmt(pot) + ").");
    setSaving(true);
    try {
      await Promise.all(gamePlayers.map((gp) =>
        client.graphql({ query: ops.UPDATE_GAME_PLAYER, variables: { input: { id: gp.id, cashOut: parseFloat(cashOuts[gp.id] ?? 0) } } })
      ));
      await client.graphql({ query: ops.UPDATE_GAME, variables: { input: { id: game.id, isComplete: true, notes } } });
      await onRefresh();
    } catch (e) { setEndError("Save failed. Check console."); console.error(e); setSaving(false); }
  };

  return (
    <div className="game-detail">
      <button className="back-btn" onClick={onBack}>Back</button>
      <div className="detail-header">
        <h2>{fmtDate(game.date)}</h2>
        <span className={"game-status " + (game.isComplete ? "" : "badge-active")}>{game.isComplete ? "Completed" : "In Progress"}</span>
      </div>
      <div className="pot-summary">
        <div className="pot-label">Total Pot</div>
        <div className="pot-amount">{fmt(pot)}</div>
      </div>
      <div className="players-table">
        <div className="table-head">
          <span>Player</span><span>Buy-In</span><span>Rebuys</span><span>Total In</span><span>Cash Out</span><span>Net</span>
        </div>
        {gamePlayers.map((gp) => {
          const totalIn = gp.buyIn + (gp.rebuys ?? 0);
          const co = game.isComplete ? gp.cashOut ?? 0 : (parseFloat(cashOuts[gp.id] ?? "") || null);
          const net = co !== null ? co - totalIn : null;
          return (
            <div key={gp.id} className="table-row">
              <span className="player-cell">{gp.player?.name ?? "?"}</span>
              <span>{fmt(gp.buyIn)}</span>
              <span className="rebuy-cell">
                {fmt(gp.rebuys ?? 0)}
                {!game.isComplete && <button className="rebuy-btn" onClick={() => addRebuy(gp)} title="Add rebuy">+</button>}
              </span>
              <span>{fmt(totalIn)}</span>
              <span>
                {game.isComplete ? fmt(gp.cashOut ?? 0) : (
                  <input type="number" className="input cashout-input" placeholder="$0" value={cashOuts[gp.id] ?? ""}
                    min="0" onChange={(e) => setCashOuts((prev) => ({ ...prev, [gp.id]: e.target.value }))} />
                )}
              </span>
              <span className={net !== null ? (net >= 0 ? "profit" : "loss") : "muted"}>
                {net !== null ? (net >= 0 ? "+" : "") + fmt(net) : "--"}
              </span>
            </div>
          );
        })}
      </div>
      {!game.isComplete && (
        <div className="end-game-section">
          <div className={"pot-diff " + (Math.abs(potDiff) < 0.01 ? "balanced" : "unbalanced")}>
            {Math.abs(potDiff) < 0.01 ? "Pot balanced" : ((potDiff > 0 ? "Over" : "Under") + " by " + fmt(Math.abs(potDiff)))}
          </div>
          <label className="field-label">Notes (optional)</label>
          <textarea className="input notes-input" placeholder="Any notes about this game..." value={notes} onChange={(e) => setNotes(e.target.value)} />
          {endError && <p className="error-msg">{endError}</p>}
          <button className="btn btn-danger end-game-btn" onClick={handleEndGame} disabled={saving || Math.abs(potDiff) > 0.01}>
            {saving ? "Saving..." : "End Game"}
          </button>
        </div>
      )}
      {game.isComplete && game.notes && <div className="game-notes"><strong>Notes:</strong> {game.notes}</div>}
    </div>
  );
}

// --- Players Tab ---

function PlayersTab({ players, onRefresh }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const addPlayer = async () => {
    const trimmed = name.trim();
    if (!trimmed) return setError("Enter a player name.");
    if (players.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) return setError("Player already exists.");
    setSaving(true); setError("");
    try {
      await client.graphql({ query: ops.CREATE_PLAYER, variables: { input: { name: trimmed } } });
      setName("");
      await onRefresh();
    } catch (e) { setError("Failed to add player."); console.error(e); }
    setSaving(false);
  };

  const deletePlayer = async (id) => {
    if (!window.confirm("Remove this player? Their game history will be preserved.")) return;
    try {
      await client.graphql({ query: ops.DELETE_PLAYER, variables: { input: { id } } });
      await onRefresh();
    } catch (e) { console.error(e); }
  };

  return (
    <div className="players-tab">
      <div className="add-player-row">
        <input type="text" className="input" placeholder="Player name" value={name}
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addPlayer()} />
        <button className="btn btn-primary" onClick={addPlayer} disabled={saving}>{saving ? "Adding..." : "Add Player"}</button>
      </div>
      {error && <p className="error-msg">{error}</p>}
      {players.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">diamond</div>
          <p>No players yet. Add your crew above!</p>
        </div>
      ) : (
        <div className="players-list">
          {players.map((p) => (
            <div key={p.id} className="player-row">
              <span className="player-name-text">{p.name}</span>
              <span className="player-game-count">{p.games?.items?.filter((g) => g.game?.isComplete).length ?? 0} games</span>
              <button className="btn-icon delete-btn" onClick={() => deletePlayer(p.id)} title="Remove player">X</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Main App ---

const TABS = [
  { id: "leaderboard", label: "Standings" },
  { id: "games", label: "Games" },
  { id: "players", label: "Players" },
];

function App({ signOut }) {
  const [tab, setTab] = useState("leaderboard");
  const [players, setPlayers] = useState([]);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [selectedGame, setSelectedGame] = useState(null);
  const [showNewGame, setShowNewGame] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [pRes, gRes] = await Promise.all([
        client.graphql({ query: ops.LIST_PLAYERS }),
        client.graphql({ query: ops.LIST_GAMES }),
      ]);
      setPlayers(pRes.data.listPlayers.items);
      setGames(gRes.data.listGames.items);
      setFetchError("");
    } catch (e) {
      setFetchError("Failed to load data. Make sure your Amplify backend is deployed.");
      console.error(e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSelectGame = (game) => {
    setSelectedGame(games.find((g) => g.id === game.id) ?? game);
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

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <span className="logo">Poker Tracker</span>
          {activeGame && (
            <button className="active-game-pill" onClick={() => handleSelectGame(activeGame)}>Live Game</button>
          )}
        </div>
        <button className="sign-out-btn" onClick={signOut}>Sign Out</button>
      </header>

      {!selectedGame && (
        <nav className="tab-nav">
          {TABS.map((t) => (
            <button key={t.id} className={"tab-btn " + (tab === t.id ? "active" : "")} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      )}

      <main className="app-main">
        {loading ? (
          <div className="loading"><span className="loading-icon">Loading...</span></div>
        ) : fetchError ? (
          <div className="error-banner">
            <p>{fetchError}</p>
            <button className="btn btn-ghost" onClick={fetchData}>Retry</button>
          </div>
        ) : selectedGame ? (
          <GameDetail game={selectedGame} onBack={() => setSelectedGame(null)} onRefresh={handleRefreshAndBack} />
        ) : (
          <>
            {tab === "leaderboard" && <Leaderboard players={players} />}
            {tab === "games" && <GameHistory games={games} onSelectGame={handleSelectGame} onNewGame={() => setShowNewGame(true)} />}
            {tab === "players" && <PlayersTab players={players} onRefresh={fetchData} />}
          </>
        )}
      </main>

      {showNewGame && (
        <NewGameModal players={players} onClose={() => setShowNewGame(false)} onCreate={handleNewGameCreated} />
      )}
    </div>
  );
}

export default withAuthenticator(App);
